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
  # Bumped whenever `state.bin`'s shape changes incompatibly (see `init/1`).
  @state_version 3

  # ---- client API ----

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  def join(info), do: GenServer.call(__MODULE__, {:join, info})
  def authenticate(island, token), do: GenServer.call(__MODULE__, {:auth, island, token})
  def create_experiment(spec), do: GenServer.call(__MODULE__, {:create, spec})
  def next_task(island), do: GenServer.call(__MODULE__, {:next, island})

  def heartbeat(seg_id, island, lease),
    do: GenServer.call(__MODULE__, {:heartbeat, seg_id, island, lease})

  @doc "kind is \"run\" or \"verify\"; `end_hash` is `artifactDigest` (physics + observer), the same digest a run attempt's checkpoint was published under."
  def complete(seg_id, island, lease, kind, end_hash, summary),
    do: GenServer.call(__MODULE__, {:complete, seg_id, island, lease, kind, end_hash, summary})

  def reject(seg_id, island, lease, reason),
    do: GenServer.call(__MODULE__, {:reject, seg_id, island, lease, reason})

  @doc "Publishes a validated checkpoint into the content-addressed store, if `lease` is still the segment's current run attempt."
  def publish_checkpoint(seg_id, island, lease, staged, digest, state_hash),
    do:
      GenServer.call(
        __MODULE__,
        {:publish_checkpoint, seg_id, island, lease, staged, digest, state_hash}
      )

  @doc "Publishes a bundle file (not content-addressed) to `dest_fun`'s path, if `lease` is still current for `seg_id`."
  def publish_file(seg_id, island, lease, staged, dest_fun),
    do: GenServer.call(__MODULE__, {:publish_file, seg_id, island, lease, staged, dest_fun})

  def status, do: GenServer.call(__MODULE__, :status)
  def segment(seg_id), do: GenServer.call(__MODULE__, {:segment, seg_id})
  def data_dir, do: GenServer.call(__MODULE__, :data_dir)

  @doc "Directory for a segment's bundle files (server-generated id only; not content-addressed)."
  def files_dir(dir, seg_id), do: Path.join([dir, "segments", seg_id])

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
    with seg when not is_nil(seg) <- s.segments[seg_id],
         kind = if(seg.status == "done", do: "verify", else: "run"),
         {:ok, seg} <- Segment.heartbeat(seg, kind, island, lease, now()) do
      {:reply, :ok, persist(put_in(s, [:segments, seg_id], seg))}
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
  def handle_call({:publish_file, seg_id, island, lease, staged, dest_fun}, _from, s) do
    seg = s.segments[seg_id]
    active? = seg && Attempt.active?(current_run(seg), island, lease)

    cond do
      is_nil(seg) ->
        File.rm(staged)
        {:reply, {:error, "unknown segment"}, s}

      not active? ->
        File.rm(staged)
        {:reply, {:error, "lease lost"}, s}

      true ->
        dest = dest_fun.(s.dir)

        if contained?(s.dir, dest) do
          File.mkdir_p!(Path.dirname(dest))
          File.rename!(staged, dest)
          {:reply, :ok, s}
        else
          File.rm(staged)
          {:reply, {:error, "bad destination"}, s}
        end
    end
  end

  def handle_call({:complete, seg_id, island_id, lease, kind, end_hash, summary}, _from, s) do
    seg = s.segments[seg_id]

    result =
      case {seg, kind} do
        {nil, _} -> {:error, "unknown segment"}
        {seg, "run"} -> Segment.complete_run(seg, island_id, lease, end_hash, summary)
        {seg, "verify"} -> Segment.complete_verify(seg, island_id, lease, end_hash)
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

    islands = for i <- Map.values(s.islands), do: Map.drop(i, [:token_hash])

    {:reply,
     %{
       experiments: Map.new(s.experiments, fn {k, v} -> {k, v.spec} end),
       counts: counts,
       runs: runs,
       islands: islands,
       divergences: divergences,
       devices:
         islands
         |> Enum.filter(&(&1.runs + &1.verifies > 0))
         |> Enum.map(& &1.adapter)
         |> Enum.uniq()
     }, s}
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

        {:ok, Map.merge(%{"deepEvery" => 10, "verifyFraction" => 0.1}, Map.take(spec, keep))}
    end
  end

  defp validate(_), do: {:error, "spec must be an object"}

  # Conditions that remove something the preset does not have (see
  # packages/runner/src/conditions.ts) would fail on every island.
  defp incompatible(preset, conditions) do
    table = Application.get_env(:coordinator, :incompatible, %{})
    Enum.find(conditions, fn c -> preset in Map.get(table, c, []) end)
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
          Segment.accepted_island(seg) != island
      end)

    runnable =
      Enum.find(segs, fn seg ->
        seg.status == "pending" and (seg.index == 0 or prev_done?(s, seg))
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

  defp contained?(dir, path), do: String.starts_with?(Path.expand(path), Path.expand(dir) <> "/")
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
