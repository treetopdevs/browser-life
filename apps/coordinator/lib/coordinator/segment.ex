defmodule Coordinator.Segment do
  @moduledoc """
  Pure functions over a segment and its attempts: the state table described in
  `docs/refactor-v3-workflow.md`'s Part B. None of these touch the network,
  the filesystem or `GenServer` state — `Coordinator.Queue`'s `handle_call`
  clauses validate auth/lease-shaped input, build an event, call one of these,
  persist the result and reply.

  A segment's `status` (`"pending" | "assigned" | "done" | "verified" |
  "diverged" | "blocked"`) and its `attempts` (a list of `Coordinator.Attempt`,
  oldest first) are tracked together. Verification does **not** move a segment
  out of `"done"`: a completed run stays `"done"` (successors may start)
  while its verify attempt is assigned, heartbeats, is abandoned and
  reassigned, or completes — verification is an attempt *on* a done segment,
  not a segment-status transition. Only a verify attempt's own *completion*
  changes the segment's status, to `"verified"` or `"diverged"`.

  | Segment state | Event | Guard | Next state |
  |---|---|---|---|
  | pending | assign_run | - | assigned (+run attempt) |
  | assigned | heartbeat/publish | lease matches the run attempt | assigned |
  | assigned | lease expired | - | pending (run attempt -> abandoned) |
  | assigned | complete_run | lease matches, uploaded == reported | done |
  | assigned | complete_run (reject path) | - | requeue predecessor, see below |
  | done | assign_verify | no attempt already pending/assigned, different island | done (+verify attempt) |
  | done (verify) | heartbeat | lease matches | done |
  | done (verify) | lease expired | - | done (verify attempt -> abandoned) |
  | done (verify) | complete_verify, match | reported == accepted run digest | verified |
  | done (verify) | complete_verify, mismatch | - | diverged (+ block_descendants) |
  | blocked | admin unblock | (existing admin policy, unchanged) | pending |

  `block_descendants/2` blocks every segment *reachable* from a diverged or
  rejected one — pending, assigned, `done` *and* `verified` alike, cancelling
  any of their own in-flight or completed verify attempts — matching
  `Queue.block_descendants/2` before this refactor; narrowing this to only
  not-yet-done descendants would be a regression (an earlier draft of this
  plan did that by mistake). "Reachable" is no longer just "later in the same
  run": a metapopulation segment's `import_from` (the ring-predecessor's
  segment this one imported a cross-run exchange packet from — see
  `Coordinator.Queue`'s `:metapopulation` spec and
  packages/schema/src/exchange.ts) is a second edge kind a divergence
  propagates across, so `dependents_graph/1` builds the combined graph
  (same-run successor edges + cross-run `import_from` edges) and `reachable/2`
  is a plain BFS over it — see their own docs for why they're pure and
  independently tested against hand-built graphs, not just through
  `block_descendants`/`unblock_after`.
  """

  alias Coordinator.Attempt

  # The observation files a run bundle carries (see packages/runner/src/stitch.ts's
  # BUNDLE_FILES); manifest.json is excluded on purpose (timestamps/host).
  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)
  # Optional: only a migration-enabled run writes migrations.tsv (see
  # stitch.ts's MIGRATIONS_FILE), only a metapopulation run writes
  # exchanges.tsv (see stitch.ts's EXCHANGES_FILE), only a run with
  # RunSpec.speciesCensus writes species.tsv (see stitch.ts's SPECIES_FILE),
  # and only a pond run writes ponds.tsv (see stitch.ts's PONDS_FILE).
  # Compared whenever either side has it. Together with @observation_files,
  # must equal stitch.ts's VERIFIED_FILES
  # (packages/runner/test/coordinator-files.test.ts checks it).
  @optional_observation_files ~w(migrations.tsv exchanges.tsv species.tsv ponds.tsv)

  @type status :: String.t()
  @type t :: %{
          id: String.t(),
          run: String.t(),
          experiment: String.t(),
          condition: String.t(),
          seed: integer,
          index: integer,
          last: boolean,
          start_step: integer,
          steps: integer,
          status: status,
          attempts: [Attempt.t()],
          rejected: integer,
          import_from: String.t() | nil
        }

  # `import_from` is only actually present in the map when set (see `new/10`)
  # -- always read it via `Map.get(seg, :import_from)`, never `seg.import_from`.

  @spec new(
          String.t(),
          String.t(),
          String.t(),
          String.t(),
          integer,
          integer,
          boolean,
          integer,
          integer,
          String.t() | nil
        ) :: t
  def new(
        id,
        run,
        experiment,
        condition,
        seed,
        index,
        last,
        start_step,
        steps,
        import_from \\ nil
      ) do
    base = %{
      id: id,
      run: run,
      experiment: experiment,
      condition: condition,
      seed: seed,
      index: index,
      last: last,
      start_step: start_step,
      steps: steps,
      status: "pending",
      attempts: [],
      rejected: 0
    }

    # `import_from` is set only when there's an actual cross-run predecessor:
    # an ordinary (non-metapopulation) segment must stay byte-identical
    # (persisted `state.bin`, equality checks) to a segment that never had
    # this key at all, from before metapopulation existed (review P2) --
    # so it's omitted rather than set to `nil`. Every read goes through
    # `Map.get(seg, :import_from)`, never `seg.import_from`, so a legacy
    # segment map loaded from disk without the key at all is handled the
    # same way (review P1).
    if import_from, do: Map.put(base, :import_from, import_from), else: base
  end

  # ---- queries ----

  @doc "The run attempt whose completion this segment's `\"done\"`/`\"verified\"`/`\"diverged\"` status is bound to, if any."
  def accepted_run_attempt(seg),
    do: find_last(seg, fn a -> a.kind == "run" and a.outcome == "done" end)

  @doc "Artifact digest (`artifactDigest`: physics + observer) the next segment's verifier/successor must match."
  def accepted_digest(seg), do: (a = accepted_run_attempt(seg)) && a.uploaded_digest

  @doc "Physics-only digest (`stateHash`) of the accepted artifact, for the next segment's `startHash`/`startFrom` continuity check."
  def accepted_state_hash(seg), do: (a = accepted_run_attempt(seg)) && a.state_hash

  @doc "The island whose run attempt produced this segment's accepted result (verifiers must differ from it)."
  def accepted_island(seg), do: (a = accepted_run_attempt(seg)) && a.island

  @doc "Bundle file name -> SHA-256 uploaded by the accepted run attempt (`nil` without one; attempts persisted before files were recorded have none)."
  def accepted_files(seg), do: (a = accepted_run_attempt(seg)) && Map.get(a, :files, %{})

  @doc "The most recent verify attempt (for status/divergence reporting), if any was ever assigned."
  def last_verify_attempt(seg), do: find_last(seg, &(&1.kind == "verify"))

  @doc """
  The last verify attempt's observation comparison (`\"match\" | \"mismatch\" |
  nil`), but only if it was made against the segment's *currently* accepted
  run attempt — `requeue/1` keeps a completed verify attempt's record as-is
  even after the run attempt it compared against is superseded (marked
  `\"rejected\"` and replaced by a redo), so a stale comparison must not be
  attributed to whichever attempt now happens to be accepted. A same-content
  redo can even keep the *same* `accepted_digest` (physics+observer only —
  bundle files aren't part of it), so binding on `accepted_digest` would not
  catch this; binding on the accepted run attempt's own identity (`id`, i.e.
  its lease) does. `nil` whenever there is no verify attempt, no accepted run
  attempt, or the verify's own recorded target (`observations_for`, absent on
  attempts persisted before this field existed) doesn't match the current one.
  """
  def current_observations(seg) do
    with verify when not is_nil(verify) <- last_verify_attempt(seg),
         accepted when not is_nil(accepted) <- accepted_run_attempt(seg),
         true <- Map.get(verify, :observations_for) == accepted.id do
      Map.get(verify, :observations)
    else
      _ -> nil
    end
  end

  def pending_or_assigned_verify?(seg),
    do: Enum.any?(seg.attempts, &(&1.kind == "verify" and Attempt.pending?(&1)))

  defp find_attempt(seg, kind, island, lease),
    do: Enum.find(seg.attempts, fn a -> a.kind == kind and Attempt.active?(a, island, lease) end)

  defp find_last(seg, pred), do: seg.attempts |> Enum.reverse() |> Enum.find(pred)

  defp replace_attempt(attempts, id, fun),
    do: Enum.map(attempts, fn a -> if a.id == id, do: fun.(a), else: a end)

  # ---- single-segment events ----

  @doc "Assigns a run attempt. Only a `\"pending\"` segment (segment 0, or one whose predecessor is done/verified — checked by the caller) may run."
  def assign_run(%{status: "pending"} = seg, island, lease, now) do
    {:ok,
     %{
       seg
       | status: "assigned",
         attempts: seg.attempts ++ [Attempt.new("run", lease, island, now)]
     }}
  end

  def assign_run(_seg, _island, _lease, _now), do: {:error, "segment not pending"}

  @doc "Assigns a verify attempt on an already-`\"done\"` segment; does not change its status."
  def assign_verify(%{status: "done"} = seg, island, lease, now) do
    cond do
      pending_or_assigned_verify?(seg) ->
        {:error, "verify already assigned"}

      accepted_island(seg) == island ->
        {:error, "the producing island cannot verify its own segment"}

      true ->
        {:ok, %{seg | attempts: seg.attempts ++ [Attempt.new("verify", lease, island, now)]}}
    end
  end

  def assign_verify(_seg, _island, _lease, _now), do: {:error, "segment not done"}

  @doc "Refreshes the heartbeat of the run or verify attempt this island/lease currently owns."
  def heartbeat(seg, kind, island, lease, now) do
    case find_attempt(seg, kind, island, lease) do
      nil ->
        {:error, "lease lost"}

      a ->
        {:ok, %{seg | attempts: replace_attempt(seg.attempts, a.id, &%{&1 | heartbeat_at: now})}}
    end
  end

  @doc "Records the digest of a just-published checkpoint on the run attempt that owns this lease (only run attempts upload)."
  def publish(seg, island, lease, digest, state_hash) do
    case find_attempt(seg, "run", island, lease) do
      nil ->
        {:error, "lease lost"}

      a ->
        {:ok,
         %{
           seg
           | attempts:
               replace_attempt(
                 seg.attempts,
                 a.id,
                 &%{&1 | uploaded_digest: digest, state_hash: state_hash}
               )
         }}
    end
  end

  @doc """
  Records a just-published bundle file (name and SHA-256) on the run attempt
  that owns this lease. `metrics_version` is only ever meaningful for
  `name == "manifest.json"` (only ever computed outside this module — see
  `Coordinator.Attempt`'s moduledoc) and every other file name ignores it,
  leaving whatever `manifest_metrics_version` was recorded before untouched
  (publishing an unrelated file must never clobber it).

  For `"manifest.json"` itself, a valid `metrics_version` (a positive
  integer) is *required*: that clause below always overwrites
  `manifest_metrics_version` in the very same update as the file's digest,
  so the two can never drift apart — a caller (in practice only
  `CoordinatorWeb.ApiController.put_file/2`) that publishes a new manifest
  without a validated version is refused outright rather than silently
  leaving the *previous* manifest's version paired with the *new* manifest's
  digest.
  """
  def publish_file(seg, island, lease, name, sha, metrics_version \\ nil)

  def publish_file(seg, island, lease, "manifest.json" = name, sha, metrics_version)
      when is_integer(metrics_version) and metrics_version > 0 do
    case find_attempt(seg, "run", island, lease) do
      nil ->
        {:error, "lease lost"}

      a ->
        record = fn attempt ->
          attempt
          |> Map.put(:files, Map.put(Map.get(attempt, :files, %{}), name, sha))
          |> Map.put(:manifest_metrics_version, metrics_version)
        end

        {:ok, %{seg | attempts: replace_attempt(seg.attempts, a.id, record)}}
    end
  end

  def publish_file(_seg, _island, _lease, "manifest.json", _sha, _metrics_version),
    do: {:error, "manifest.json requires a valid (positive integer) metrics version"}

  def publish_file(seg, island, lease, name, sha, _metrics_version) do
    case find_attempt(seg, "run", island, lease) do
      nil ->
        {:error, "lease lost"}

      a ->
        record = &Map.put(&1, :files, Map.put(Map.get(&1, :files, %{}), name, sha))
        {:ok, %{seg | attempts: replace_attempt(seg.attempts, a.id, record)}}
    end
  end

  @doc """
  Completes a run attempt: the reported digest must equal the one this same
  attempt uploaded (an attempt can only complete with the artifact it itself
  published — never a digest of some other upload). Segment -> `\"done\"`.
  """
  def complete_run(seg, island, lease, reported_digest, summary) do
    case find_attempt(seg, "run", island, lease) do
      nil ->
        {:error, "segment not assigned to this island/lease"}

      %{uploaded_digest: nil} ->
        {:error, "upload the end checkpoint before completing a run"}

      %{uploaded_digest: uploaded} when uploaded != reported_digest ->
        {:error,
         "endHash #{reported_digest} does not match the uploaded checkpoint (#{uploaded})"}

      a ->
        done = %{a | outcome: "done", reported_digest: reported_digest, summary: summary}

        {:ok,
         %{seg | status: "done", attempts: replace_attempt(seg.attempts, a.id, fn _ -> done end)}}
    end
  end

  @doc """
  Completes a verify attempt: its reported digest is compared against the
  segment's *accepted run attempt's* `uploaded_digest`, since a verify attempt
  uploads nothing of its own to compare against. Segment -> `\"verified\"` on a
  match, `\"diverged\"` on a mismatch (the caller must then call
  `block_descendants/3`).

  `reported_observations` (optional; `nil` from an island that doesn't send
  it) is the verify attempt's own `{name => SHA-256}` of its regenerated
  observation files (`series.jsonl` and friends — never `manifest.json`,
  which carries timestamps/host and can never match). It is compared against
  the segment's `accepted_files/1` and the result recorded on the attempt as
  `observations` (`\"match\" | \"mismatch\" | nil` — `nil` when either side is
  missing any of the six names, e.g. an older upload or island). This is
  purely informational: unlike the physics+observer digest above, it never
  changes the segment's status or blocks descendants — run correctness is
  established by the digest alone; this only tells humans whether the
  *observation* files an island would regenerate also match, now that
  `compressionRatio` is deterministic across engines (see `@bl/metrics`).

  Requires the segment to still be `\"done\"` (the same guard `assign_verify/4`
  applies): a verify attempt whose predecessor-producing run got rejected and
  requeued out from under it (see `requeue/1`, which abandons any in-flight
  verify attempt precisely to avoid this) must not be able to complete
  against a segment that is back to `\"pending\"` — its accepted run attempt no
  longer has outcome `\"done\"`, so `accepted_digest/1` would return `nil` and
  every reported digest would "mismatch" it, corrupting a merely-requeued
  segment into `\"diverged\"` (and blocking every descendant) instead of
  leaving it reassignable.
  """
  def complete_verify(seg, island, lease, reported_digest, reported_observations \\ nil)

  def complete_verify(
        %{status: "done"} = seg,
        island,
        lease,
        reported_digest,
        reported_observations
      ) do
    case find_attempt(seg, "verify", island, lease) do
      nil ->
        {:error, "segment not assigned to this island/lease"}

      a ->
        match = reported_digest == accepted_digest(seg)
        accepted = accepted_run_attempt(seg)

        observations =
          compare_observations(accepted && Map.get(accepted, :files, %{}), reported_observations)

        done =
          %{
            a
            | outcome: if(match, do: "done", else: "diverged"),
              reported_digest: reported_digest
          }
          |> Map.put(:observations, observations)
          # Which run attempt this comparison was made against — read back by
          # `current_observations/1`, never trust `observations` alone once a
          # requeue may have replaced the accepted run attempt since.
          |> Map.put(:observations_for, accepted && accepted.id)

        seg = %{seg | attempts: replace_attempt(seg.attempts, a.id, fn _ -> done end)}
        {:ok, %{seg | status: if(match, do: "verified", else: "diverged")}}
    end
  end

  def complete_verify(_seg, _island, _lease, _reported_digest, _reported_observations),
    do: {:error, "segment not done"}

  # `nil` (rather than "mismatch") whenever either side is missing any of the
  # six names (or an optional one the other side has): an accepted run attempt uploaded before file digests were
  # recorded, or a verify attempt from an island that doesn't report them yet
  # — absence of evidence, not evidence of a mismatch.
  defp compare_observations(accepted_files, reported) do
    accepted_files = accepted_files || %{}
    reported = reported || %{}

    # An optional file present on either side must be compared, so it joins
    # the required set for this comparison; present on only one side, the
    # result is nil (missing coverage), never "match".
    optional =
      Enum.filter(
        @optional_observation_files,
        &(Map.has_key?(accepted_files, &1) or Map.has_key?(reported, &1))
      )

    names = @observation_files ++ optional

    if Enum.all?(names, &(Map.has_key?(accepted_files, &1) and Map.has_key?(reported, &1))) do
      if Enum.all?(names, &(Map.get(accepted_files, &1) == Map.get(reported, &1))),
        do: "match",
        else: "mismatch"
    end
  end

  @doc """
  Marks the accepted run attempt's outcome `\"rejected\"` (in place — its
  record, lease and digests are kept, not discarded, same as an `:abandoned`
  attempt) and returns the segment to `\"pending\"`, bumping the reject
  counter. Used on the *predecessor* a run or verify attempt found
  inconsistent.

  Also abandons any verify attempt still pending against this segment: it was
  assigned to check the run result this call just invalidated, so letting it
  complete later would either find no accepted run attempt to compare against
  (`accepted_digest/1` returns `nil` once the run attempt above is no longer
  `\"done\"`, so *every* reported digest "mismatches" it) or, worse, block a
  legitimate future verify assignment once the segment is redone and `\"done\"`
  again (`assign_verify/4` refuses while any verify attempt is still
  `\"pending\"`). `complete_verify/4` also guards on `status == \"done\"` as a
  second line of defense, but there is no reason to leave a moot attempt
  sitting there pending either way.
  """
  def requeue(seg) do
    attempts =
      case accepted_run_attempt(seg) do
        nil -> seg.attempts
        a -> replace_attempt(seg.attempts, a.id, &%{&1 | outcome: "rejected"})
      end

    attempts =
      case Enum.reverse(attempts) |> Enum.find(&(&1.kind == "verify" and Attempt.pending?(&1))) do
        nil -> attempts
        v -> replace_attempt(attempts, v.id, &%{&1 | outcome: "abandoned"})
      end

    %{seg | status: "pending", attempts: attempts, rejected: seg.rejected + 1}
  end

  @doc "Clears every in-flight/result attempt and returns the segment to `\"pending\"` (used by admin unblock and by `unblock_after/3`)."
  def reset(seg), do: %{seg | status: "pending", attempts: []}

  @doc "Marks a descendant `\"blocked\"`, discarding its attempts (used by `block_descendants/3`)."
  def block(seg), do: %{reset(seg) | status: "blocked"}

  @doc """
  Expires attempts whose heartbeat is older than `lease_ms`: a stale *run*
  attempt's own outcome becomes `\"abandoned\"` (its record — lease, upload
  digest, summary — is kept, not discarded; only the *segment* returns to
  `\"pending\"` so it can be reassigned, its artifacts not the next
  assignee's — it must upload its own before completing); a stale *verify*
  attempt is likewise marked `\"abandoned\"` in place, and the segment
  (already `\"done\"`) is re-verifiable later without disturbing its accepted
  result.
  """
  def reclaim(seg, now, lease_ms) do
    run = find_last(seg, &(&1.kind == "run" and Attempt.pending?(&1)))

    if run && now - run.heartbeat_at > lease_ms do
      abandoned = %{run | outcome: "abandoned"}

      %{
        seg
        | status: "pending",
          attempts: replace_attempt(seg.attempts, run.id, fn _ -> abandoned end)
      }
    else
      verify = find_last(seg, &(&1.kind == "verify" and Attempt.pending?(&1)))

      if verify && now - verify.heartbeat_at > lease_ms do
        abandoned = %{verify | outcome: "abandoned"}
        %{seg | attempts: replace_attempt(seg.attempts, verify.id, fn _ -> abandoned end)}
      else
        seg
      end
    end
  end

  # ---- whole-run (cross-segment) events ----

  @doc """
  BFS reachable set from `start` over `graph` (`%{node => [neighbor]}`,
  a missing key treated as no outgoing edges), *including* `start` itself.
  Pure and deliberately decoupled from `Coordinator.Segment`'s own data shapes
  (a plain node -> neighbors map in, a `MapSet` out) so taint propagation's
  graph logic can be exercised directly against small hand-built graphs
  (chains, rings, diamonds, ...) without a real segments map — see
  `Coordinator.SegmentTest`. Terminates on a cyclic graph (a ring) by tracking
  visited nodes instead of recursing per edge.
  """
  def reachable(graph, start), do: reachable_acc(graph, [start], MapSet.new())

  defp reachable_acc(_graph, [], seen), do: seen

  defp reachable_acc(graph, [n | rest], seen) do
    if MapSet.member?(seen, n),
      do: reachable_acc(graph, rest, seen),
      else: reachable_acc(graph, Map.get(graph, n, []) ++ rest, MapSet.put(seen, n))
  end

  @doc """
  The dependency graph for taint propagation: segment `id` points to every
  segment whose correctness assumes `id`'s is correct -- the same-run next
  segment (`index + 1`) and every segment (in any run) whose `import_from` is
  `id`. Built in a single pass over `segments` (review P2: the previous
  version re-scanned the *entire* `segments` map once per vertex to find its
  importers -- O(n^2) -- which measured 5.8s at 10,000 segments inside this
  GenServer's own call, against a 5s call timeout and a 100k-segment/
  experiment system limit; this version is O(n)). `Map.get(o, :import_from)`
  (not `o.import_from`) so a segment map loaded from before `import_from`
  existed, which omits the key entirely, doesn't crash (review P1). Segments
  rarely number more than a few thousand per experiment and divergence is the
  rare, not-hot path, so this is still built fresh rather than incrementally
  maintained -- just no longer quadratically.
  """
  def dependents_graph(segments) do
    by_run_index = Map.new(segments, fn {id, s} -> {{s.run, s.index}, id} end)
    empty = Map.new(segments, fn {id, _} -> {id, []} end)

    Enum.reduce(segments, empty, fn {id, s}, graph ->
      graph =
        case Map.get(by_run_index, {s.run, s.index - 1}) do
          nil -> graph
          pred -> Map.update(graph, pred, [id], &[id | &1])
        end

      case Map.get(s, :import_from) do
        nil -> graph
        pred -> Map.update(graph, pred, [id], &[id | &1])
      end
    end)
  end

  # `segments` restricted to `experiment` -- taint never crosses experiments
  # (cross-run `import_from` edges only ever point within the same
  # metapopulation experiment), so scoping down before building
  # `dependents_graph/1` avoids paying for every OTHER experiment's segments
  # too when a coordinator is running many at once (review P2).
  defp scoped_to_experiment(segments, experiment) do
    for {id, s} <- segments, s.experiment == experiment, into: %{}, do: {id, s}
  end

  @doc "A diverged or rejected segment invalidates everything reachable from it (`dependents_graph/1` + `reachable/2`; see the moduledoc) — same-run descendants and, transitively, any segment across any run whose cross-run import chain leads back to it. `seg_id` itself is left as-is; only what depends on it is blocked."
  def block_descendants(segments, seg_id) do
    scoped = scoped_to_experiment(segments, segments[seg_id].experiment)
    tainted = scoped |> dependents_graph() |> reachable(seg_id) |> MapSet.delete(seg_id)

    Map.new(segments, fn {id, s} ->
      if MapSet.member?(tainted, id) and s.status != "blocked", do: {id, block(s)}, else: {id, s}
    end)
  end

  @doc """
  After a requeue, every `\"blocked\"` segment reachable from `seg_id` becomes
  `\"pending\"` again -- not yet *runnable*: `Coordinator.Queue.pick_task/4`
  re-checks each segment's own predecessor and `import_from` (if any) fresh
  against live status every time it looks for work, so a segment reset here
  before its actual dependencies are redone simply stays un-picked rather than
  running prematurely (the same reasoning the pre-existing same-run-only
  version relied on; a diamond -- one segment blocked via two different
  paths, only one of which has been redone -- is safe for the same reason,
  not because this function tracks it).
  """
  def unblock_after(segments, seg_id) do
    scoped = scoped_to_experiment(segments, segments[seg_id].experiment)
    candidates = scoped |> dependents_graph() |> reachable(seg_id) |> MapSet.delete(seg_id)

    Map.new(segments, fn {id, s} ->
      if MapSet.member?(candidates, id) and s.status == "blocked",
        do: {id, reset(s)},
        else: {id, s}
    end)
  end

  @doc """
  The full reject-handling taint transition -- block everything reachable
  from `seg_id`, requeue `seg_id` itself (`requeue/1`), then unblock
  everything reachable from it again -- in one call. Equivalent to calling
  `block_descendants/2`, `requeue/1` and `unblock_after/2` in sequence (the
  same three-step shape `Coordinator.Queue`'s reject handler used to spell
  out), but builds `dependents_graph/1` exactly once instead of twice (review
  P2: it was built fresh, from scratch, inside *each* of those two calls,
  every rejection).
  """
  def redo(segments, seg_id) do
    experiment = segments[seg_id].experiment
    scoped = scoped_to_experiment(segments, experiment)
    reachable_set = scoped |> dependents_graph() |> reachable(seg_id) |> MapSet.delete(seg_id)

    segments =
      Map.new(segments, fn {id, s} ->
        if MapSet.member?(reachable_set, id) and s.status != "blocked",
          do: {id, block(s)},
          else: {id, s}
      end)

    segments = Map.put(segments, seg_id, requeue(segments[seg_id]))

    Map.new(segments, fn {id, s} ->
      if MapSet.member?(reachable_set, id) and s.status == "blocked",
        do: {id, reset(s)},
        else: {id, s}
    end)
  end

  @doc "Stale-lease reclamation across every segment (see `reclaim/3`)."
  def reclaim_stale(segments, now, lease_ms),
    do: Map.new(segments, fn {id, s} -> {id, reclaim(s, now, lease_ms)} end)
end
