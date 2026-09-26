defmodule Coordinator.Queue do
  @moduledoc """
  Experiment queue for the archipelago.

  Each run (experiment/preset/condition/seed) is split into segments of a
  fixed number of steps. Segment *k* starts from the end checkpoint (and
  embedded observer state, one artifact — see `Coordinator.Checkpoint`) of
  segment *k - 1* (segment 0 starts from the deterministic initial world), so
  any island can continue any run.

  Integrity:

    * A run completion is bound to the artifact uploaded under *that*
      island's own attempt: `Coordinator.Segment.complete_run/5` requires the
      reported end hash to equal the digest that same attempt itself
      published (`Coordinator.Checkpoint.artifact_digest/1`), never a digest
      left over from a different attempt.
    * A deterministic fraction of segments, and the final segment of every
      run, is replayed by a *different* island (a `:verify` attempt on the
      already-`"done"` segment); physics and observations must both match. A
      mismatch marks the segment `"diverged"` and blocks every later segment
      of the run, `"done"`/`"verified"` ones included.
    * An island (running or verifying) that finds its start checkpoint
      inconsistent rejects it, which invalidates and requeues the producing
      segment (see `handle_call({:reject, ...})`).
    * Metrics-version compatibility (`packages/schema`'s `METRICS_VERSION`,
      e.g. `compressionRatio`'s compressor definition): an island declares
      its own at `join/1` (`:metricsVersion`, missing ⇒ version 1 — an old
      island that predates the field); an experiment records its *required*
      version at creation (`:metrics_version` config, default current);
      `pick_task/3` only offers an experiment's segments (run or verify) to
      an island whose declared version matches (others go idle *for that
      experiment*, not necessarily idle overall). That alone cannot stop an
      island lying about — or simply predating — the concept, so a run
      attempt's completion is bound to the *actual* version of the
      `manifest.json` it uploaded (ground truth: what the runner code that
      produced it actually computed), extracted and size-bounded once,
      *outside* this GenServer, when that file is `PUT`
      (`CoordinatorWeb.ApiController.put_file/2`) — parsing an
      island-controlled upload inside the single serialized queue process
      that every island's joins, heartbeats and assignments share would let
      one slow or oversized manifest stall all of them; see
      `Coordinator.Attempt`'s `manifest_metrics_version` field. A `"run"`
      completion then only compares that already-recorded integer against
      the experiment's required version — no file I/O, no JSON parsing —
      and only after confirming the attempt uploaded its checkpoint at all.

  Islands authenticate with a private token issued at join; every assignment
  carries a lease (`Coordinator.Attempt.id`) that must accompany uploads,
  heartbeats and completion. The end checkpoint of every accepted run attempt
  is kept once, content-addressed by its own digest, under
  `data_dir/objects/` (see `Coordinator.Store`) — segment ids never key
  storage themselves. State is persisted to `data_dir/state.bin` after every
  change; see `init/1` for the version tag that refuses to load
  incompatible (pre-v3) data.
  """
  use GenServer
  require Logger
  alias Coordinator.{Attempt, Segment, Store}

  # Leases expire after this long without a heartbeat (configurable for tests).
  defp lease_ms, do: Application.get_env(:coordinator, :lease_ms, 10 * 60 * 1000)
  @max_segments 100_000
  # An island that hasn't called `/api/next` or sent a valid heartbeat in
  # this long is flagged `stale` in `status/0` -- e.g. a browser tab whose
  # page reloaded and dropped back to the Join screen without anyone
  # noticing (see the auto-rejoin in apps/lab). Purely a status-page hint: it
  # doesn't affect scheduling. Public so tests can assert against the actual
  # threshold instead of a copy of the literal.
  @stale_ms 2 * 60 * 1000
  def stale_ms, do: @stale_ms

  @doc "Whether `last_seen` (ms since epoch) is stale as of `now` (defaults to the real clock). A pure function of both timestamps (rather than reading the clock internally) so tests can pin the exact threshold -- exclusive, `>` not `>=` -- without a wall-clock race."
  def stale?(last_seen, now \\ now()), do: now - last_seen > @stale_ms
  # Bumped whenever `state.bin`'s shape changes incompatibly (see `init/1`).
  @state_version 3

  # ---- client API ----

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  def join(info), do: GenServer.call(__MODULE__, {:join, info})
  def authenticate(island, token), do: GenServer.call(__MODULE__, {:auth, island, token})

  @doc "Public info for an already-authenticated island (never the token/token_hash); a read, not a claim -- see ApiController.me/2. Doesn't touch last_seen: authenticate/2 doesn't either, and this shouldn't add state a bare probe wouldn't otherwise have."
  def island_info(id), do: GenServer.call(__MODULE__, {:island_info, id})
  def create_experiment(spec), do: GenServer.call(__MODULE__, {:create, spec})
  def next_task(island), do: GenServer.call(__MODULE__, {:next, island})

  def heartbeat(seg_id, island, lease),
    do: GenServer.call(__MODULE__, {:heartbeat, seg_id, island, lease})

  @doc """
  kind is "run" or "verify"; `end_hash` is `artifactDigest` (physics +
  observer), the same digest a run attempt's checkpoint was published under.
  `observation_digests` (optional; only meaningful for a `"verify"`
  completion) is the `{name => SHA-256}` of the observation files the
  verifying island regenerated — see `Coordinator.Segment.complete_verify/5`.
  """
  def complete(seg_id, island, lease, kind, end_hash, summary, observation_digests \\ nil),
    do:
      GenServer.call(
        __MODULE__,
        {:complete, seg_id, island, lease, kind, end_hash, summary, observation_digests}
      )

  def reject(seg_id, island, lease, reason),
    do: GenServer.call(__MODULE__, {:reject, seg_id, island, lease, reason})

  @doc "Publishes a validated checkpoint into the content-addressed store, if `lease` is still the segment's current run attempt."
  def publish_checkpoint(seg_id, island, lease, staged, digest, state_hash),
    do:
      GenServer.call(
        __MODULE__,
        {:publish_checkpoint, seg_id, island, lease, staged, digest, state_hash}
      )

  @doc """
  Publishes a bundle file (content-addressed by `sha`, its SHA-256) and
  records it on `seg_id`'s run attempt, if `lease` is still current.
  `metrics_version` (optional; meaningful only for `name == "manifest.json"`)
  is that manifest's own already-extracted, already-validated
  `metricsVersion` field — the caller (`CoordinatorWeb.ApiController.put_file/2`)
  parses it outside this GenServer under a manifest-specific size limit, so
  this call never itself reads or decodes the upload.
  """
  def publish_file(seg_id, island, lease, staged, name, sha, metrics_version \\ nil),
    do:
      GenServer.call(
        __MODULE__,
        {:publish_file, seg_id, island, lease, staged, name, sha, metrics_version}
      )

  def status, do: GenServer.call(__MODULE__, :status)

  @doc "An experiment's spec and every segment in run order, with its accepted digest and producing/verifying hosts (`nil` if unknown)."
  def experiment(name), do: GenServer.call(__MODULE__, {:experiment, name})
  def segment(seg_id), do: GenServer.call(__MODULE__, {:segment, seg_id})
  def data_dir, do: GenServer.call(__MODULE__, :data_dir)

  @doc "Directory for a segment's bundle files (server-generated id only; not content-addressed)."

  # ---- server ----

  @impl true
  def init(opts) do
    dir = Path.expand(Keyword.fetch!(opts, :data_dir))
    File.mkdir_p!(dir)

    # `:erlang.binary_to_term(_, [:safe])` refuses to create atoms it hasn't
    # already seen — safe only for atoms some *already-loaded* module's own
    # compiled code happens to mention. `Coordinator.Queue` (this module) is
    # trivially loaded already (its own `init/1` is what's running), so its
    # own literal atoms (`:version`, `:experiments`, `:segments`, ...) are
    # fine either way; `Attempt`/`Segment`'s atoms (`:uploaded_digest`,
    # `:heartbeat_at`, ...) live only in *their* modules, which nothing has
    # forced the code server to load yet on a cold boot — ensure they are,
    # before the decode below, or a fresh process (unlike a warm `mix test`
    # VM where some earlier test already touched these modules) refuses to
    # load a state.bin containing any in-flight attempt.
    Code.ensure_loaded!(Coordinator.Attempt)
    Code.ensure_loaded!(Coordinator.Segment)

    state =
      case File.read(Path.join(dir, "state.bin")) do
        {:ok, bin} ->
          case :erlang.binary_to_term(bin, [:safe]) do
            %{version: @state_version} = s ->
              s

            _ ->
              raise """
              coordinator: #{Path.join(dir, "state.bin")} is not v#{@state_version} state.
              This is pre-launch infrastructure with no production data to migrate: \
              delete #{dir} to start fresh against this branch.
              """
          end

        _ ->
          %{version: @state_version, experiments: %{}, segments: %{}, islands: %{}, next_seg: 1}
      end

    {:ok, state |> Map.put(:dir, dir) |> reindex()}
  end

  @impl true
  def handle_call({:join, info}, _from, s) do
    id = "isl-" <> rand(9)
    token = rand(32)
    now = now()

    island = %{
      id: id,
      token_hash: :crypto.hash(:sha256, token),
      adapter: clip(info["adapter"]),
      user_agent: clip(info["userAgent"]),
      # The metrics version this island's runner code computes (see the
      # moduledoc); an island that doesn't declare one predates the concept.
      metrics_version: metrics_version_of(info),
      joined_at: now,
      last_seen: now,
      runs: 0,
      verifies: 0
    }

    s = put_in(s, [:islands, id], island)
    {:reply, {:ok, %{id: id, token: token}}, persist(s)}
  end

  def handle_call({:auth, id, token}, _from, s) do
    ok =
      case s.islands[id] do
        %{token_hash: h} when is_binary(token) ->
          Plug.Crypto.secure_compare(h, :crypto.hash(:sha256, token))

        _ ->
          false
      end

    {:reply, ok, s}
  end

  def handle_call({:island_info, id}, _from, s) do
    info = s.islands[id] && Map.drop(s.islands[id], [:token_hash])
    {:reply, info, s}
  end

  def handle_call({:create, spec}, _from, s) do
    with {:ok, spec} <- validate(spec),
         :ok <-
           if(Map.has_key?(s.experiments, spec["experiment"]),
             do: {:error, "experiment exists"},
             else: :ok
           ) do
      {segments, next} = build_segments(spec, s.next_seg)
      s = reindex(%{s | segments: Map.merge(s.segments, segments), next_seg: next})
      s = put_in(s, [:experiments, spec["experiment"]], %{spec: spec, created_at: now()})
      {:reply, {:ok, map_size(segments)}, persist(s)}
    else
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call({:next, island_id}, _from, s) do
    now = now()

    s =
      %{s | segments: Segment.reclaim_stale(s.segments, now, lease_ms())}
      |> put_in([:islands, island_id, :last_seen], now)

    {task, s} = pick_task(s, island_id, now)
    {:reply, {:ok, task}, persist(s)}
  end

  def handle_call({:heartbeat, seg_id, island, lease}, _from, s) do
    now = now()

    with seg when not is_nil(seg) <- s.segments[seg_id],
         kind = if(seg.status == "done", do: "verify", else: "run"),
         {:ok, seg} <- Segment.heartbeat(seg, kind, island, lease, now) do
      # A valid (lease-current) heartbeat is as much evidence the island is
      # alive as `/api/next` -- a long-running task's island otherwise looks
      # `stale` in `status/0` the whole time it's busy, between `/next` calls.
      s =
        s
        |> put_in([:segments, seg_id], seg)
        |> put_in([:islands, island, :last_seen], now)

      {:reply, :ok, persist(s)}
    else
      nil -> {:reply, {:error, "unknown segment"}, s}
      {:error, why} -> {:reply, {:error, why}, s}
    end
  end

  def handle_call(
        {:publish_checkpoint, seg_id, island, lease, staged, digest, state_hash},
        _from,
        s
      ) do
    with seg when not is_nil(seg) <- s.segments[seg_id],
         {:ok, seg} <- Segment.publish(seg, island, lease, digest, state_hash) do
      :ok = Store.put(s.dir, digest, staged)
      {:reply, :ok, persist(put_in(s, [:segments, seg_id], seg))}
    else
      nil ->
        File.rm(staged)
        {:reply, {:error, "unknown segment"}, s}

      {:error, why} ->
        File.rm(staged)
        {:reply, {:error, why}, s}
    end
  end

  # Only a `:run` attempt ever uploads anything — a bundle file included: a
  # verify attempt replays and reports a digest, nothing else (see
  # `Coordinator.Attempt`'s moduledoc). Authorizing a verify attempt's lease
  # here too would let a verifier silently rewrite the accepted producer's
  # `series.jsonl`/`manifest.json`/etc. while still reporting a matching
  # digest and leaving the segment `"verified"`.
  def handle_call(
        {:publish_file, seg_id, island, lease, staged, name, sha, metrics_version},
        _from,
        s
      ) do
    with seg when not is_nil(seg) <- s.segments[seg_id],
         {:ok, seg} <- Segment.publish_file(seg, island, lease, name, sha, metrics_version) do
      :ok = Store.put_blob(s.dir, sha, staged)
      {:reply, :ok, persist(put_in(s, [:segments, seg_id], seg))}
    else
      nil ->
        File.rm(staged)
        {:reply, {:error, "unknown segment"}, s}

      {:error, why} ->
        File.rm(staged)
        {:reply, {:error, why}, s}
    end
  end

  def handle_call(
        {:complete, seg_id, island_id, lease, kind, end_hash, summary, observation_digests},
        _from,
        s
      ) do
    seg = s.segments[seg_id]

    result =
      case {seg, kind} do
        {nil, _} ->
          {:error, "unknown segment"}

        {seg, "run"} ->
          # Checkpoint-uploaded is checked first (by deferring to
          # `Segment.complete_run/5` for its own "upload the end checkpoint"
          # error whenever there's no active, checkpoint-bearing attempt to
          # compare a metrics version against) — cheaper, and the more
          # fundamental defect, ahead of a metrics-version mismatch. Both
          # checks read only in-memory attempt state: no file I/O or JSON
          # parsing happens in this GenServer (see the moduledoc).
          case current_run_attempt(seg, island_id, lease) do
            %{uploaded_digest: digest} = attempt when not is_nil(digest) ->
              required = experiment_metrics_version(s, seg.experiment)
              got = Map.get(attempt, :manifest_metrics_version) || 1

              if got == required do
                Segment.complete_run(seg, island_id, lease, end_hash, summary)
              else
                {:error,
                 "uploaded manifest's metrics version #{got} does not match this experiment's required #{required}"}
              end

            _ ->
              Segment.complete_run(seg, island_id, lease, end_hash, summary)
          end

        {seg, "verify"} ->
          Segment.complete_verify(seg, island_id, lease, end_hash, observation_digests)
      end

    case result do
      {:error, why} ->
        {:reply, {:error, why}, s}

      {:ok, seg} ->
        s = put_in(s, [:segments, seg_id], seg)

        s =
          case {kind, seg.status} do
            {"run", "done"} ->
              update_in(s, [:islands, island_id, :runs], &(&1 + 1))

            {"verify", status} when status in ["verified", "diverged"] ->
              update_in(s, [:islands, island_id, :verifies], &(&1 + 1))

            _ ->
              s
          end

        s =
          if kind == "verify" and seg.status == "diverged" do
            Logger.error(
              "segment #{seg.id} (#{seg.run}##{seg.index}) diverged: #{Segment.accepted_digest(seg)} (#{Segment.accepted_island(seg)}) vs #{end_hash} (#{island_id})"
            )

            %{s | segments: Segment.block_descendants(s.segments, seg.run, seg.index)}
          else
            s
          end

        {:reply, {:ok, seg.status}, persist(s)}
    end
  end

  # The island assigned `seg_id` (to run it or to verify it) found its start
  # checkpoint inconsistent with the predecessor's report: invalidate the
  # predecessor, requeue it, and reset everything after it. `seg_id` itself is
  # left as-is (its own lease simply runs out and is reclaimed in due course);
  # only the predecessor is acted on here.
  def handle_call({:reject, seg_id, island_id, lease, reason}, _from, s) do
    seg = s.segments[seg_id]

    assigned? =
      seg &&
        (Attempt.active?(current_run(seg), island_id, lease) ||
           Attempt.active?(current_verify(seg), island_id, lease))

    with true <- assigned?,
         prev when not is_nil(prev) <- prev_seg(s, seg) do
      Logger.error("segment #{prev.id} rejected by #{island_id}: #{clip(reason)}")

      # Nothing to clean up: the rejected attempt's checkpoint and bundle
      # files are content-addressed (and possibly shared), and files are only
      # ever served through a segment's accepted attempt's own record.
      s =
        %{s | segments: Segment.block_descendants(s.segments, prev.run, prev.index)}
        |> put_in([:segments, prev.id], Segment.requeue(prev))
        |> then(&%{&1 | segments: Segment.unblock_after(&1.segments, prev.run, prev.index)})

      {:reply, :ok, persist(s)}
    else
      _ -> {:reply, {:error, "segment not assigned to this island/lease"}, s}
    end
  end

  def handle_call(:status, _from, s) do
    by = Enum.group_by(Map.values(s.segments), & &1.status)
    counts = Map.new(by, fn {k, v} -> {k, length(v)} end)

    runs =
      s.segments
      |> Map.values()
      |> Enum.group_by(& &1.run)
      |> Enum.map(fn {run, segs} ->
        %{
          run: run,
          segments: length(segs),
          done: Enum.count(segs, &(&1.status in ["done", "verified"])),
          verified: Enum.count(segs, &(&1.status == "verified")),
          diverged: Enum.count(segs, &(&1.status == "diverged")),
          blocked: Enum.count(segs, &(&1.status == "blocked"))
        }
      end)
      |> Enum.sort_by(& &1.run)

    divergences =
      for seg <- Map.values(s.segments), seg.status == "diverged" do
        verify = Segment.last_verify_attempt(seg)

        %{
          segment: seg.id,
          run: seg.run,
          index: seg.index,
          a: host(s, Segment.accepted_island(seg)),
          b: host(s, verify && verify.island),
          hash_a: Segment.accepted_digest(seg),
          hash_b: verify && verify.reported_digest
        }
      end

    now = now()

    islands =
      for i <- Map.values(s.islands) do
        i |> Map.drop([:token_hash]) |> Map.put(:stale, stale?(i.last_seen, now))
      end

    # A segment whose verify attempt's regenerated observation files disagree
    # with the accepted run attempt's — independent of `divergences` above,
    # which is about the physics+observer digest: a segment can be "verified"
    # (matching digest) and still show up here (mismatching observations), or
    # vice versa. Purely informational (see `Coordinator.Segment.complete_verify/5`).
    # `current_observations/1` (not raw `Map.get(verify, :observations)`)
    # so a requeue-and-redo can't attribute a stale comparison, made against
    # a since-superseded run attempt, to whichever attempt is accepted now.
    observation_mismatches =
      for seg <- Map.values(s.segments),
          Segment.current_observations(seg) == "mismatch" do
        verify = Segment.last_verify_attempt(seg)

        %{
          segment: seg.id,
          run: seg.run,
          index: seg.index,
          producer: host(s, Segment.accepted_island(seg)),
          verifier: host(s, verify.island)
        }
      end

    {:reply,
     %{
       experiments: Map.new(s.experiments, fn {k, v} -> {k, v.spec} end),
       counts: counts,
       runs: runs,
       islands: islands,
       divergences: divergences,
       observationMismatches: observation_mismatches,
       devices:
         islands
         |> Enum.filter(&(&1.runs + &1.verifies > 0))
         |> Enum.map(& &1.adapter)
         |> Enum.uniq()
     }, s}
  end

  def handle_call({:experiment, name}, _from, s) do
    case s.experiments[name] do
      nil ->
        {:reply, nil, s}

      exp ->
        segments =
          for seg <- Map.values(s.segments),
              seg.experiment == name do
            digest = Segment.accepted_digest(seg)
            verify = Segment.last_verify_attempt(seg)

            # Requeueing keeps old verify attempts: only a match against the
            # *current* accepted digest vouches for it.
            verified =
              seg.status == "verified" and verify != nil and verify.outcome == "done" and
                verify.reported_digest == digest

            # true only when the segment is verified (above) AND that same
            # verifying attempt's regenerated observation files also matched
            # *the segment's currently accepted run attempt* — nil (not
            # false) when verified but the observation comparison was never
            # made (old attempt or island, see `Coordinator.Attempt`) or was
            # made against a run attempt since superseded by a redo
            # (`Segment.current_observations/1` catches that; a same-content
            # redo can keep the same accepted digest, so `verified` above
            # alone would not).
            observationsVerified =
              if verified do
                case Segment.current_observations(seg) do
                  "match" -> true
                  "mismatch" -> false
                  nil -> nil
                end
              end

            %{
              id: seg.id,
              run: seg.run,
              condition: seg.condition,
              seed: seg.seed,
              index: seg.index,
              last: seg.last,
              startStep: seg.start_step,
              steps: seg.steps,
              status: seg.status,
              digest: digest,
              files: Segment.accepted_files(seg),
              producedBy: if(a = Segment.accepted_island(seg), do: host(s, a)),
              verifiedBy: if(verified, do: host(s, verify.island)),
              observationsVerified: observationsVerified
            }
          end

        {:reply, %{spec: exp.spec, segments: Enum.sort_by(segments, &{&1.run, &1.index})}, s}
    end
  end

  def handle_call({:segment, id}, _from, s), do: {:reply, s.segments[id], s}
  def handle_call(:data_dir, _from, s), do: {:reply, s.dir, s}

  # ---- validation ----

  defp validate(spec) when is_map(spec) do
    presets = Application.get_env(:coordinator, :presets)
    conditions = Application.get_env(:coordinator, :conditions)
    int_in? = fn v, lo, hi -> is_integer(v) and v >= lo and v <= hi end
    frac = Map.get(spec, "verifyFraction", 0.1)

    cond do
      not (is_binary(spec["experiment"]) and
               Regex.match?(~r/^[a-z0-9][a-z0-9_-]{0,63}$/, spec["experiment"])) ->
        {:error, "experiment must match [a-z0-9][a-z0-9_-]{0,63}"}

      spec["presetId"] not in presets ->
        {:error, "presetId must be one of #{Enum.join(presets, ", ")}"}

      not unique_list?(spec["conditions"], 16, &(&1 in conditions)) ->
        {:error, "conditions must be 1..16 unique values from #{Enum.join(conditions, ", ")}"}

      (bad = incompatible(spec["presetId"], spec["conditions"])) != nil ->
        {:error, "condition #{bad} does not apply to preset #{spec["presetId"]}"}

      not unique_list?(spec["seeds"], 1000, &int_in?.(&1, 0, 4_294_967_295)) ->
        {:error, "seeds must be 1..1000 unique u32 integers"}

      not int_in?.(spec["steps"], 1, 1_000_000_000) ->
        {:error, "steps must be an integer in 1..1e9"}

      not int_in?.(spec["censusEvery"], 1, 1_000_000) ->
        {:error, "censusEvery must be an integer in 1..1e6"}

      not int_in?.(spec["segmentSteps"], spec["censusEvery"], 10_000_000) or
          rem(spec["segmentSteps"], spec["censusEvery"]) != 0 ->
        {:error, "segmentSteps must be a multiple of censusEvery, at most 1e7"}

      # Cadence the runner will actually reject at runtime (packages/runner/src/runner.ts
      # requires migrationPeriod to be a multiple of censusEvery), checked here so a whole
      # experiment's islands don't get assigned segments they can only fail. Checked per
      # *condition*, not once for the whole spec: each condition in `spec["conditions"]`
      # becomes its own separate run (build_segments/2 below), and only "no-migration"
      # (packages/runner/src/conditions.ts) disables migration for the run it produces --
      # every other condition (including "treatment") runs the preset's migrationPeriod
      # unchanged. Exempting the whole spec because *any* of its conditions was
      # "no-migration" would silently let an incompatible cadence through for the
      # *other* conditions' runs, which still migrate. This can't read packages/schema
      # itself (a separate app), so `:migration_period` in config.exs is a duplicated
      # fact that must be kept in sync with the preset it names -- like `:presets`/
      # `:conditions`/`:incompatible` above already are.
      (bad =
         incompatible_cadence(
           spec["presetId"],
           spec["conditions"],
           spec["censusEvery"],
           spec["segmentSteps"]
         )) !=
          nil ->
        {:error, bad}

      not int_in?.(Map.get(spec, "deepEvery", 10), 1, 1000) ->
        {:error, "deepEvery must be an integer in 1..1000"}

      not (is_number(frac) and frac >= 0 and frac <= 1) ->
        {:error, "verifyFraction must be in 0..1"}

      length(spec["conditions"]) * length(spec["seeds"]) *
        div(spec["steps"] + spec["segmentSteps"] - 1, spec["segmentSteps"]) > @max_segments ->
        {:error, "too many segments (max #{@max_segments})"}

      true ->
        keep =
          ~w(experiment presetId conditions seeds steps segmentSteps censusEvery deepEvery verifyFraction)

        # "metricsVersion" is deliberately not in `keep`: it is the
        # coordinator's own required version at creation time (like
        # `:rule_version`), never client-supplied — `Map.take/2` above drops
        # any value the client tried to set, and the default below always wins.
        {:ok,
         Map.merge(
           %{
             "deepEvery" => 10,
             "verifyFraction" => 0.1,
             "metricsVersion" => Application.get_env(:coordinator, :metrics_version, 1)
           },
           Map.take(spec, keep)
         )}
    end
  end

  defp validate(_), do: {:error, "spec must be an object"}

  # Conditions that remove something the preset does not have (see
  # packages/runner/src/conditions.ts) would fail on every island.
  defp incompatible(preset, conditions) do
    table = Application.get_env(:coordinator, :incompatible, %{})
    Enum.find(conditions, fn c -> preset in Map.get(table, c, []) end)
  end

  # The migrationPeriod one (preset, condition) run will actually run with: 0
  # if the preset has none configured, or if `condition` is "no-migration" --
  # every other condition (packages/runner/src/conditions.ts) leaves
  # migrationPeriod/migrantCount untouched, since only "no-migration" itself
  # overrides them. See config.exs's `:migration_period` doc.
  defp effective_migration_period(_preset, "no-migration"), do: 0

  defp effective_migration_period(preset, _condition),
    do: Map.get(Application.get_env(:coordinator, :migration_period, %{}), preset, 0)

  # The first cadence error among `conditions`' own runs (each condition is a
  # separate run against `preset`, at the same censusEvery/segmentSteps -- see
  # build_segments/2), or nil if every one of them is compatible. Defensive
  # against a malformed `conditions` (not yet known to be a list at every call
  # site: this is also used by the `cond` clause that establishes that), so it
  # never raises on bad input -- it just reports no incompatibility, and an
  # earlier/later clause rejects the spec on its own terms.
  defp incompatible_cadence(preset, conditions, census_every, segment_steps) do
    if is_list(conditions) do
      Enum.find_value(conditions, fn condition ->
        period = effective_migration_period(preset, condition)

        cond do
          period == 0 ->
            nil

          rem(period, census_every) != 0 ->
            "migrationPeriod #{period} (condition #{condition}) must be a multiple of censusEvery"

          rem(segment_steps, period) != 0 ->
            "segmentSteps must be a multiple of migrationPeriod #{period} (condition #{condition})"

          true ->
            nil
        end
      end)
    end
  end

  defp unique_list?(v, max, ok?) do
    is_list(v) and v != [] and length(v) <= max and Enum.all?(v, ok?) and
      length(Enum.uniq(v)) == length(v)
  end

  # ---- segments ----

  defp build_segments(spec, next) do
    per = spec["segmentSteps"]
    count = div(spec["steps"] + per - 1, per)

    for cond <- spec["conditions"],
        seed <- spec["seeds"],
        k <- 0..(count - 1),
        reduce: {%{}, next} do
      {acc, n} ->
        id = "seg-#{n}"
        run = "#{spec["experiment"]}/#{spec["presetId"]}/#{cond}/seed-#{seed}"
        steps = min(per, spec["steps"] - k * per)

        seg =
          Segment.new(id, run, spec["experiment"], cond, seed, k, k == count - 1, k * per, steps)

        {Map.put(acc, id, seg), n + 1}
    end
  end

  # {run, index} -> segment id, so predecessor lookups are O(1).
  defp reindex(s),
    do: Map.put(s, :index, Map.new(s.segments, fn {id, seg} -> {{seg.run, seg.index}, id} end))

  # Verification first (by a different island), then runnable segments in run
  # order; segment k is runnable once k - 1 is done or verified.
  defp pick_task(s, island, now) do
    segs = s.segments |> Map.values() |> Enum.sort_by(&{&1.run, &1.index})

    verify =
      Enum.find(segs, fn seg ->
        seg.status == "done" and maybe_verify?(seg, s) and
          not Segment.pending_or_assigned_verify?(seg) and
          Segment.accepted_island(seg) != island and
          metrics_version_compatible?(s, seg, island)
      end)

    runnable =
      Enum.find(segs, fn seg ->
        seg.status == "pending" and (seg.index == 0 or prev_done?(s, seg)) and
          metrics_version_compatible?(s, seg, island)
      end)

    lease = rand(12)

    cond do
      verify ->
        {:ok, seg} = Segment.assign_verify(verify, island, lease, now)
        {task("verify", seg, lease, s), put_in(s, [:segments, seg.id], seg)}

      runnable ->
        {:ok, seg} = Segment.assign_run(runnable, island, lease, now)
        {task("run", seg, lease, s), put_in(s, [:segments, seg.id], seg)}

      true ->
        {%{kind: "idle"}, s}
    end
  end

  defp prev_seg(s, seg) do
    case s.index[{seg.run, seg.index - 1}] do
      nil -> nil
      id -> s.segments[id]
    end
  end

  defp prev_done?(s, seg) do
    case prev_seg(s, seg) do
      %{status: st} when st in ["done", "verified"] -> true
      _ -> false
    end
  end

  defp task(kind, seg, lease, s) do
    spec = s.experiments[seg.experiment].spec
    prev = if seg.index == 0, do: nil, else: prev_seg(s, seg)

    %{
      kind: kind,
      lease: lease,
      segment: %{
        id: seg.id,
        run: seg.run,
        index: seg.index,
        startStep: seg.start_step,
        steps: seg.steps
      },
      spec: %{
        experiment: spec["experiment"],
        presetId: spec["presetId"],
        condition: seg.condition,
        seed: seg.seed,
        steps: seg.steps,
        censusEvery: spec["censusEvery"],
        deepEvery: spec["deepEvery"],
        checkpointEvery: 0
      },
      startFrom: prev && prev.id,
      startHash: prev && Segment.accepted_state_hash(prev)
    }
  end

  # A deterministic fraction of segments is replayed, and the final segment of
  # every run always is. Purely a function of the segment id (hashed) and the
  # run's `verifyFraction`, so it is safe to recompute on every `pick_task/3`
  # call instead of deciding it once at completion time and storing the
  # answer — same result either way, one fewer thing to persist.
  defp maybe_verify?(seg, s) do
    frac = s.experiments[seg.experiment].spec["verifyFraction"]
    <<h::32, _::binary>> = :crypto.hash(:sha256, seg.id)
    seg.last or h / 4_294_967_296 < frac
  end

  defp current_run(seg), do: Enum.find(seg.attempts, &(&1.kind == "run" and Attempt.pending?(&1)))

  defp current_verify(seg),
    do: Enum.find(seg.attempts, &(&1.kind == "verify" and Attempt.pending?(&1)))

  # ---- metrics-version gating (see moduledoc) ----

  # A join's self-declared metrics version; missing/malformed ⇒ 1 (an island
  # that predates the field can only ever have computed version 1's metrics).
  defp metrics_version_of(info) do
    case info["metricsVersion"] do
      v when is_integer(v) and v > 0 -> v
      _ -> 1
    end
  end

  # An already-registered island's declared version; absent (registered by
  # server code before this field existed) ⇒ 1, same fallback as `metrics_version_of/1`.
  defp island_metrics_version(s, island_id),
    do: Map.get(s.islands[island_id] || %{}, :metrics_version, 1)

  # An experiment's required version, as recorded on its spec at creation
  # (`validate/1`); an experiment created before this field existed ⇒ 1.
  defp experiment_metrics_version(s, experiment) do
    case s.experiments[experiment] do
      nil -> Application.get_env(:coordinator, :metrics_version, 1)
      exp -> exp.spec["metricsVersion"] || 1
    end
  end

  defp metrics_version_compatible?(s, seg, island_id),
    do: island_metrics_version(s, island_id) == experiment_metrics_version(s, seg.experiment)

  # The active run attempt this island/lease currently owns, if any — no
  # file I/O, just the in-memory attempt record (which, for `manifest.json`,
  # already carries whatever `metrics_version` `publish_file/7` was given —
  # see `Coordinator.Attempt`'s moduledoc for where that comes from).
  defp current_run_attempt(seg, island_id, lease),
    do: Enum.find(seg.attempts, &(&1.kind == "run" and Attempt.active?(&1, island_id, lease)))

  defp host(_s, nil), do: "?"
  defp host(s, id), do: (s.islands[id] || %{adapter: "?"}).adapter
  defp now, do: System.system_time(:millisecond)
  defp rand(n), do: Base.url_encode64(:crypto.strong_rand_bytes(n), padding: false)
  defp clip(v) when is_binary(v), do: String.slice(v, 0, 200)
  defp clip(_), do: "?"

  defp persist(s) do
    path = Path.join(s.dir, "state.bin")
    tmp = path <> ".tmp"
    File.write!(tmp, :erlang.term_to_binary(Map.drop(s, [:dir, :index])))
    File.rename!(tmp, path)
    s
  end
end
