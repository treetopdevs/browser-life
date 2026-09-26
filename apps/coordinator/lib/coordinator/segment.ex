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

  `block_descendants/3` resets and blocks every later segment of the same run
  — pending, assigned, `done` *and* `verified` alike, cancelling any of their
  own in-flight or completed verify attempts — matching `Queue.block_descendants/2`
  before this refactor; narrowing this to only not-yet-done descendants would
  be a regression (an earlier draft of this plan did that by mistake).
  """

  alias Coordinator.Attempt

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
          rejected: integer
        }

  @spec new(
          String.t(),
          String.t(),
          String.t(),
          String.t(),
          integer,
          integer,
          boolean,
          integer,
          integer
        ) :: t
  def new(id, run, experiment, condition, seed, index, last, start_step, steps) do
    %{
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

  @doc "The most recent verify attempt (for status/divergence reporting), if any was ever assigned."
  def last_verify_attempt(seg), do: find_last(seg, &(&1.kind == "verify"))

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
  def complete_verify(%{status: "done"} = seg, island, lease, reported_digest) do
    case find_attempt(seg, "verify", island, lease) do
      nil ->
        {:error, "segment not assigned to this island/lease"}

      a ->
        match = reported_digest == accepted_digest(seg)

        done = %{
          a
          | outcome: if(match, do: "done", else: "diverged"),
            reported_digest: reported_digest
        }

        seg = %{seg | attempts: replace_attempt(seg.attempts, a.id, fn _ -> done end)}
        {:ok, %{seg | status: if(match, do: "verified", else: "diverged")}}
    end
  end

  def complete_verify(_seg, _island, _lease, _reported_digest), do: {:error, "segment not done"}

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

  @doc "A diverged or rejected segment invalidates everything computed from its end state: later segments of the same run are blocked, done and verified ones included."
  def block_descendants(segments, run, after_index) do
    Map.new(segments, fn {id, s} ->
      if s.run == run and s.index > after_index and s.status != "blocked",
        do: {id, block(s)},
        else: {id, s}
    end)
  end

  @doc "After a requeue, blocked descendants become pending again; they run from the new predecessor state once it completes."
  def unblock_after(segments, run, after_index) do
    Map.new(segments, fn {id, s} ->
      if s.run == run and s.index > after_index and s.status == "blocked",
        do: {id, reset(s)},
        else: {id, s}
    end)
  end

  @doc "Stale-lease reclamation across every segment (see `reclaim/3`)."
  def reclaim_stale(segments, now, lease_ms),
    do: Map.new(segments, fn {id, s} -> {id, reclaim(s, now, lease_ms)} end)
end
