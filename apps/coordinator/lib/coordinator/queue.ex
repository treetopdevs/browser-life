defmodule Coordinator.Queue do
  @moduledoc """
  Experiment queue for the archipelago.

  Each run (experiment/preset/condition/seed) is split into segments of a
  fixed number of steps. Segment *k* starts from the end checkpoint and
  observer state of segment *k - 1* (segment 0 starts from the deterministic
  initial world), so any island can continue any run.

  Integrity:

    * A run completion is bound to the uploaded artifacts: the reported end
      hash must equal the canonical state digest the coordinator computed from
      the checkpoint, and the reported observer hash must equal the digest of
      the uploaded observer state.
    * A deterministic fraction of segments, and the final segment of every run,
      is replayed by a *different* island; physics and observations must both
      match. A mismatch marks the segment `diverged` and blocks the rest of the run.
    * An island (running or verifying) that finds its start checkpoint or
      observer inconsistent rejects it, which invalidates and requeues the
      producing segment.

  Islands authenticate with a private token issued at join; every assignment
  carries a lease that must accompany uploads, heartbeats and completion.
  Artifacts are stored under server-generated segment ids only. State is
  persisted to `data_dir/state.bin` after every change.
  """
  use GenServer
  require Logger

  # Leases expire after this long without a heartbeat (configurable for tests).
  defp lease_ms, do: Application.get_env(:coordinator, :lease_ms, 10 * 60 * 1000)
  @max_segments 100_000

  # ---- client API ----

  def start_link(opts),
    do: GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))

  def join(info), do: GenServer.call(__MODULE__, {:join, info})
  def authenticate(island, token), do: GenServer.call(__MODULE__, {:auth, island, token})
  def create_experiment(spec), do: GenServer.call(__MODULE__, {:create, spec})
  def next_task(island), do: GenServer.call(__MODULE__, {:next, island})

  def heartbeat(seg_id, island, lease),
    do: GenServer.call(__MODULE__, {:heartbeat, seg_id, island, lease})

  def complete(seg_id, island, lease, kind, end_hash, observer_hash, summary),
    do:
      GenServer.call(
        __MODULE__,
        {:complete, seg_id, island, lease, kind, end_hash, observer_hash, summary}
      )

  def reject(seg_id, island, lease, reason),
    do: GenServer.call(__MODULE__, {:reject, seg_id, island, lease, reason})

  @doc """
  Atomically publish a staged upload if `lease` is still the current run
  lease of `seg_id`, recording `meta` (artifact digests) on the segment.
  """
  def publish(seg_id, island, lease, staged, dest_fun, meta \\ %{}),
    do: GenServer.call(__MODULE__, {:publish, seg_id, island, lease, staged, dest_fun, meta})

  def status, do: GenServer.call(__MODULE__, :status)
  def segment(seg_id), do: GenServer.call(__MODULE__, {:segment, seg_id})
  def data_dir, do: GenServer.call(__MODULE__, :data_dir)

  @doc "End checkpoint written by a segment's run task (server-generated id only)."
  def checkpoint_path(dir, seg_id), do: Path.join([dir, "checkpoints", "#{seg_id}.blck"])

  @doc "Directory for a segment's bundle files (server-generated id only)."
  def files_dir(dir, seg_id), do: Path.join([dir, "segments", seg_id])

  # ---- server ----

  @impl true
  def init(opts) do
    dir = Path.expand(Keyword.fetch!(opts, :data_dir))
    File.mkdir_p!(dir)

    state =
      case File.read(Path.join(dir, "state.bin")) do
        {:ok, bin} -> :erlang.binary_to_term(bin, [:safe])
        _ -> %{experiments: %{}, segments: %{}, islands: %{}, next_seg: 1}
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
    s = s |> reclaim_stale(now) |> put_in([:islands, island_id, :last_seen], now)
    {task, s} = pick_task(s, island_id, now)
    {:reply, {:ok, task}, persist(s)}
  end

  def handle_call({:heartbeat, seg_id, island, lease}, _from, s) do
    case s.segments[seg_id] do
      %{status: "assigned", island: ^island, lease: ^lease} = seg ->
        {:reply, :ok, persist(put_in(s, [:segments, seg_id], %{seg | assigned_at: now()}))}

      %{status: "done", verify: %{status: "assigned", island: ^island, lease: ^lease} = v} = seg ->
        {:reply, :ok,
         persist(put_in(s, [:segments, seg_id], %{seg | verify: %{v | assigned_at: now()}}))}

      _ ->
        {:reply, {:error, "lease lost"}, s}
    end
  end

  def handle_call({:publish, seg_id, island, lease, staged, dest_fun, meta}, _from, s) do
    case s.segments[seg_id] do
      %{status: "assigned", island: ^island, lease: ^lease} = seg ->
        dest = dest_fun.(s.dir)

        if contained?(s.dir, dest) do
          File.mkdir_p!(Path.dirname(dest))
          File.rename!(staged, dest)
          {:reply, :ok, persist(put_in(s, [:segments, seg_id], Map.merge(seg, meta)))}
        else
          File.rm(staged)
          {:reply, {:error, "bad destination"}, s}
        end

      _ ->
        File.rm(staged)
        {:reply, {:error, "lease lost"}, s}
    end
  end

  def handle_call(
        {:complete, seg_id, island_id, lease, kind, end_hash, observer_hash, summary},
        _from,
        s
      ) do
    seg = s.segments[seg_id]

    cond do
      is_nil(seg) ->
        {:reply, {:error, "unknown segment"}, s}

      kind == "run" and seg.status == "assigned" and seg.island == island_id and
          seg.lease == lease ->
        complete_run(s, seg, island_id, end_hash, observer_hash, summary)

      kind == "verify" and seg.status == "done" and
          match?(%{status: "assigned", island: ^island_id, lease: ^lease}, seg.verify) ->
        complete_verify(s, seg, island_id, end_hash, observer_hash)

      true ->
        {:reply, {:error, "segment not assigned to this island/lease"}, s}
    end
  end

  # The island assigned `seg_id` (to run it or to verify it) found its start
  # checkpoint or observer state inconsistent with the predecessor's report:
  # invalidate the predecessor, requeue it, and reset everything after it.
  def handle_call({:reject, seg_id, island_id, lease, reason}, _from, s) do
    seg = s.segments[seg_id]

    assigned? =
      match?(%{status: "assigned", island: ^island_id, lease: ^lease}, seg) or
        (match?(%{status: "done"}, seg) and
           match?(%{status: "assigned", island: ^island_id, lease: ^lease}, seg.verify))

    with true <- assigned?,
         prev when not is_nil(prev) <- prev_seg(s, seg) do
      Logger.error("segment #{prev.id} rejected by #{island_id}: #{clip(reason)}")
      File.rm(checkpoint_path(s.dir, prev.id))
      File.rm_rf(files_dir(s.dir, prev.id))

      s =
        s
        |> block_descendants(prev)
        |> put_in([:segments, prev.id], reset(prev) |> Map.put(:rejected, prev.rejected + 1))
        |> unblock_after(prev)

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
        %{
          segment: seg.id,
          run: seg.run,
          index: seg.index,
          a: host(s, seg.island),
          b: host(s, seg.verify.island),
          hash_a: seg.end_hash,
          hash_b: seg.verify.hash
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

  # ---- completion ----

  defp complete_run(s, seg, island_id, end_hash, observer_hash, summary) do
    cond do
      seg.checkpoint_hash == nil or seg.observer_hash == nil ->
        {:reply, {:error, "upload the end checkpoint and observer state before completing a run"},
         s}

      seg.checkpoint_hash != end_hash ->
        {:reply,
         {:error,
          "endHash #{end_hash} does not match the uploaded checkpoint (#{seg.checkpoint_hash})"},
         s}

      seg.observer_hash != observer_hash ->
        {:reply, {:error, "observerHash does not match the uploaded observer state"}, s}

      true ->
        seg = %{
          seg
          | status: "done",
            end_hash: end_hash,
            summary: summary,
            finished_at: now(),
            lease: nil
        }

        seg = maybe_verify(seg, s)

        s =
          s
          |> put_in([:segments, seg.id], seg)
          |> update_in([:islands, island_id, :runs], &(&1 + 1))

        {:reply, {:ok, seg.status}, persist(s)}
    end
  end

  # Replay must reproduce both the physics and the observations.
  defp complete_verify(s, seg, island_id, end_hash, observer_hash) do
    match = end_hash == seg.end_hash and observer_hash == seg.observer_hash
    verify = %{seg.verify | status: "done", hash: end_hash, match: match, lease: nil}
    seg = %{seg | verify: verify, status: if(match, do: "verified", else: "diverged")}

    s =
      s
      |> put_in([:segments, seg.id], seg)
      |> update_in([:islands, island_id, :verifies], &(&1 + 1))

    s =
      if match do
        s
      else
        Logger.error(
          "segment #{seg.id} (#{seg.run}##{seg.index}) diverged: #{seg.end_hash} (#{seg.island}) vs #{end_hash} (#{island_id})"
        )

        block_descendants(s, seg)
      end

    {:reply, {:ok, seg.status}, persist(s)}
  end

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

        seg = %{
          id: id,
          run: "#{spec["experiment"]}/#{spec["presetId"]}/#{cond}/seed-#{seed}",
          experiment: spec["experiment"],
          condition: cond,
          seed: seed,
          index: k,
          last: k == count - 1,
          start_step: k * per,
          steps: min(per, spec["steps"] - k * per),
          status: "pending",
          island: nil,
          lease: nil,
          assigned_at: nil,
          finished_at: nil,
          end_hash: nil,
          checkpoint_hash: nil,
          observer_hash: nil,
          summary: nil,
          verify: nil,
          rejected: 0
        }

        {Map.put(acc, id, seg), n + 1}
    end
  end

  # {run, index} -> segment id, so predecessor lookups are O(1).
  defp reindex(s),
    do: Map.put(s, :index, Map.new(s.segments, fn {id, seg} -> {{seg.run, seg.index}, id} end))

  defp reclaim_stale(s, now) do
    segments =
      Map.new(s.segments, fn {id, seg} ->
        seg =
          cond do
            # Artifacts published under the expired lease are not the next
            # assignee's; it must upload its own before completing.
            seg.status == "assigned" and now - seg.assigned_at > lease_ms() ->
              reset(seg)

            match?(%{status: "assigned"}, seg.verify) and
                now - seg.verify.assigned_at > lease_ms() ->
              %{
                seg
                | verify: %{
                    seg.verify
                    | status: "pending",
                      island: nil,
                      lease: nil,
                      assigned_at: nil
                  }
              }

            true ->
              seg
          end

        {id, seg}
      end)

    %{s | segments: segments}
  end

  # Verification first (by a different island), then runnable segments in run
  # order; segment k is runnable once k - 1 is done or verified.
  defp pick_task(s, island, now) do
    segs = s.segments |> Map.values() |> Enum.sort_by(&{&1.run, &1.index})

    verify =
      Enum.find(segs, fn seg ->
        seg.status == "done" and match?(%{status: "pending"}, seg.verify) and seg.island != island
      end)

    runnable =
      Enum.find(segs, fn seg ->
        seg.status == "pending" and (seg.index == 0 or prev_done?(s, seg))
      end)

    lease = rand(12)

    cond do
      verify ->
        seg = %{
          verify
          | verify: %{
              verify.verify
              | status: "assigned",
                island: island,
                lease: lease,
                assigned_at: now
            }
        }

        {task("verify", seg, lease, s), put_in(s, [:segments, seg.id], seg)}

      runnable ->
        seg = %{
          reset(runnable)
          | status: "assigned",
            island: island,
            lease: lease,
            assigned_at: now
        }

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
      startHash: prev && prev.end_hash
    }
  end

  # A diverged or rejected segment invalidates everything computed from its end
  # state: later segments of the run are blocked (including completed ones) and
  # their pending or running verifications are cancelled.
  defp block_descendants(s, seg) do
    segments =
      Map.new(s.segments, fn {id, p} ->
        if p.run == seg.run and p.index > seg.index and p.status != "blocked",
          do: {id, %{reset(p) | status: "blocked"}},
          else: {id, p}
      end)

    %{s | segments: segments}
  end

  # After a requeue, blocked descendants become pending again; they run from the
  # new predecessor state once it completes.
  defp unblock_after(s, seg) do
    segments =
      Map.new(s.segments, fn {id, p} ->
        if p.run == seg.run and p.index > seg.index and p.status == "blocked",
          do: {id, reset(p)},
          else: {id, p}
      end)

    %{s | segments: segments}
  end

  # Clears assignment, results and artifact digests of a segment.
  defp reset(seg) do
    %{
      seg
      | status: "pending",
        island: nil,
        lease: nil,
        assigned_at: nil,
        end_hash: nil,
        checkpoint_hash: nil,
        observer_hash: nil,
        summary: nil,
        verify: nil
    }
  end

  # A deterministic fraction of segments is replayed, and the final segment of
  # every run always is (nothing downstream would ever check it).
  defp maybe_verify(seg, s) do
    frac = s.experiments[seg.experiment].spec["verifyFraction"]
    <<h::32, _::binary>> = :crypto.hash(:sha256, seg.id)

    if seg.last or h / 4_294_967_296 < frac do
      %{
        seg
        | verify: %{
            status: "pending",
            island: nil,
            lease: nil,
            assigned_at: nil,
            hash: nil,
            match: nil
          }
      }
    else
      seg
    end
  end

  defp contained?(dir, path), do: String.starts_with?(Path.expand(path), Path.expand(dir) <> "/")
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
