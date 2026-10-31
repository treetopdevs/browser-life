defmodule Coordinator.Soup do
  @moduledoc """
  The shared program soup (docs/soup-garden-2026-10-31.md, Part B): a BFF soup
  (`tools/soup/*`) run as a chain of segments by islands, each checked by a
  second island.

  Why a separate plane. The soup's snapshots are opaque `BLSOUP` blobs, not
  `.blck` checkpoints, and none of the queue's observers, bundles, ponds or
  gardens apply. Like `Coordinator.Discovery`, this process owns its own data
  directory (`:soup_data_dir`, default `data-soup`, never overlapping the
  queue's `:data_dir`) and its own state file (`state.json`, replaced
  atomically and durably on every change), and shares no state with
  `Coordinator.Queue`. Islands are the queue's: they join through
  `POST /api/islands` and the controller authenticates them there.

  Model. A world (seed, grid or well-mixed size, mutation, lang,
  `epochsPerSegment` N, `segments`, `verifyEvery`) is a chain: segment k runs
  epochs `[k*N, (k+1)*N)` from segment k-1's accepted snapshot (segment 0 from
  the seed). A segment is `pending`, `leased`, `done`, `verified` or
  `diverged`. `next/1` leases the lowest verify an island did not run itself,
  else the lowest pending segment whose predecessor is done. A run uploads its
  end snapshot (the header is checked against the world by `check_snapshot/3`
  in the caller's process, never here) and completes with that upload's
  SHA-256. Segment k is verified when `k % verifyEvery == 0`, and the last one
  always: another island recomputes it from the same start and reports its
  hash. A match is `verified`; a mismatch is `diverged`, and every later
  segment is `blocked` (and loses its lease), so a bad history stops there.

  Leases carry a random id and expire after `:lease_ms` (`:soup_lease_ms`). An
  expired run lease returns its segment to pending, an expired verify lease
  frees the verify, and a completion or upload on a lease that is no longer
  current is refused. Time is `Coordinator.Clock`.

  Storage. A run lease takes one upload (the same bytes again are a no-op,
  other bytes are refused). Snapshots are published durably before the state
  that names them is written, and a snapshot no longer needed (an expired or
  blocked attempt's upload, a diverged segment's) is deleted once the state
  without it is written, unless an accepted segment holds the same bytes.
  """
  use GenServer
  require Logger
  alias Coordinator.Discovery.Disk
  alias Coordinator.Store

  @state_version 1
  @magic "BLSOUP\0\0"
  @header 64
  @tape 64
  @default_mutation 262_144
  # Snapshots stay within the 64 MB upload cap (64 + num * 64 bytes).
  @max_num 1_048_576
  @max_epochs 2_147_483_647
  @label ~r/^[a-z0-9][a-z0-9-]{0,31}$/
  @langs %{"noheads" => 0, "heads" => 1}

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def data_dir, do: GenServer.call(__MODULE__, :data_dir)
  def lease_ms, do: GenServer.call(__MODULE__, :lease_ms)

  @doc """
  Registers a world from `POST /api/soup/worlds` params (string keys).
  `{:ok, :registered}`, `{:ok, :exists}` for the same parameters again, or
  `{:error, why}`.
  """
  def register(params) do
    with {:ok, w} <- validate(params), do: GenServer.call(__MODULE__, {:register, w})
  end

  def next(island), do: GenServer.call(__MODULE__, {:next, island})

  @doc "The world and end epoch an upload on this run lease must carry, or `{:error, why}`."
  def upload_target(id, island, lease),
    do: GenServer.call(__MODULE__, {:upload_target, id, island, lease})

  @doc "Publishes a checked, hashed staged upload as this run lease's snapshot."
  def record_upload(id, island, lease, sha, staged),
    do: GenServer.call(__MODULE__, {:record_upload, id, island, lease, sha, staged})

  def complete(id, island, lease, sha),
    do: GenServer.call(__MODULE__, {:complete, id, island, lease, sha})

  @doc "The stored start snapshot of a segment (its predecessor's accepted one)."
  def start_path(id), do: GenServer.call(__MODULE__, {:snapshot_path, id, :start})

  @doc "The stored accepted end snapshot of a segment."
  def end_path(id), do: GenServer.call(__MODULE__, {:snapshot_path, id, :end})

  def status, do: GenServer.call(__MODULE__, :status)

  @doc """
  Checks a staged snapshot against a world and the expected end epoch: magic,
  version, seed, num, grid, mutation, lang, epoch, zero reserved bytes and
  exact length. Reads only the 64-byte header and the file size, in the
  caller's process.
  """
  def check_snapshot(path, w, epoch) do
    expected = @header + w["num"] * @tape

    with {:ok, %{size: size}} <- File.stat(path),
         true <- size == expected || {:error, "snapshot is #{size} bytes, expected #{expected}"},
         {:ok, header} <- read_header(path) do
      want =
        <<@magic, 1::little-32, w["seed"]::little-32, w["num"]::little-32, w["width"]::little-32,
          w["height"]::little-32, w["radius"]::little-32, w["mutation"]::little-32,
          @langs[w["lang"]]::little-32, epoch::little-64, 0::128>>

      if header == want, do: :ok, else: {:error, header_error(header, want)}
    else
      {:error, why} when is_binary(why) -> {:error, why}
      {:error, why} -> {:error, "cannot read snapshot: #{inspect(why)}"}
    end
  end

  defp read_header(path) do
    File.open(path, [:read, :binary], fn io -> IO.binread(io, @header) end)
  end

  @fields ~w(magic version seed num width height radius mutation lang epoch reserved)
  defp header_error(got, want) do
    split = fn <<m::binary-8, rest::binary-32, e::binary-8, r::binary-16>> ->
      [m | for(<<x::binary-4 <- rest>>, do: x)] ++ [e, r]
    end

    bad =
      Enum.zip([@fields, split.(got), split.(want)])
      |> Enum.reject(fn {_, a, b} -> a == b end)
      |> Enum.map(&elem(&1, 0))

    "snapshot header does not match the segment: #{Enum.join(bad, ", ")}"
  end

  @doc "A segment's id: the world name (no dots) and its index."
  def segment_id(name, k), do: "#{name}.#{k}"

  # ---- validation (caller's process) ----

  defp validate(p) when is_map(p) do
    grid? = Map.has_key?(p, "width") or Map.has_key?(p, "height")
    int = fn k, lo, hi, default -> int(p, k, lo, hi, default) end

    with {:ok, name} <- name(p["name"]),
         {:ok, seed} <- int.("seed", 0, 4_294_967_295, nil),
         {:ok, {num, width, height, radius}} <- shape(p, grid?),
         {:ok, mutation} <- int.("mutation", 0, 1_073_741_824, @default_mutation),
         {:ok, lang} <- lang(Map.get(p, "lang", "noheads")),
         {:ok, n} <- int.("epochsPerSegment", 1, 1_000_000, nil),
         {:ok, segs} <- int.("segments", 1, 10_000, nil),
         {:ok, every} <- int.("verifyEvery", 1, 10_000, 1),
         true <- n * segs <= @max_epochs || {:error, "epochsPerSegment * segments is too large"} do
      {:ok,
       %{
         "name" => name,
         "seed" => seed,
         "num" => num,
         "width" => width,
         "height" => height,
         "radius" => radius,
         "mutation" => mutation,
         "lang" => lang,
         "epochsPerSegment" => n,
         "segments" => segs,
         "verifyEvery" => every
       }}
    end
  end

  defp validate(_), do: {:error, "expected a JSON object"}

  defp name(n) when is_binary(n) do
    if Regex.match?(@label, n),
      do: {:ok, n},
      else: {:error, "name must be 1-32 of a-z, 0-9 and -, starting with a letter or digit"}
  end

  defp name(_), do: {:error, "name is required"}

  defp shape(p, true) do
    with {:ok, w} <- int(p, "width", 1, @max_num, nil),
         {:ok, h} <- int(p, "height", 1, @max_num, nil),
         {:ok, r} <- int(p, "radius", 1, 64, 2),
         num = w * h,
         true <- num <= @max_num || {:error, "width * height must be at most #{@max_num}"},
         true <- rem(num, 2) == 0 || {:error, "width * height must be even"},
         true <- p["num"] in [nil, num] || {:error, "num must equal width * height"} do
      {:ok, {num, w, h, r}}
    end
  end

  defp shape(p, false) do
    with {:ok, num} <- int(p, "num", 2, @max_num, nil),
         true <- rem(num, 2) == 0 || {:error, "num must be even"},
         true <- p["radius"] in [nil, 0] || {:error, "radius needs a grid (width, height)"} do
      {:ok, {num, 0, 0, 0}}
    end
  end

  defp lang(l) when is_map_key(@langs, l), do: {:ok, l}
  defp lang(_), do: {:error, "lang must be noheads or heads"}

  defp int(p, k, lo, hi, default) do
    case Map.get(p, k, default) do
      v when is_integer(v) and v >= lo and v <= hi -> {:ok, v}
      nil -> {:error, "#{k} is required"}
      _ -> {:error, "#{k} must be an integer in #{lo}..#{hi}"}
    end
  end

  # ---- server ----

  @impl true
  def init(opts) do
    dir = Path.expand(Keyword.fetch!(opts, :data_dir))
    queue_dir = Path.expand(Keyword.get(opts, :queue_data_dir, "data"))

    inside? = fn a, b ->
      {a, b} = {Disk.real_path(a), Disk.real_path(b)}
      a == b or String.starts_with?(a, b <> "/")
    end

    if inside?.(dir, queue_dir) or inside?.(queue_dir, dir),
      do: raise("soup data dir #{dir} overlaps the registered queue's #{queue_dir}")

    Disk.mkdir_durable!(dir)
    file = Path.join(dir, "state.json")

    state =
      case File.read(file) do
        {:ok, bin} ->
          case Jason.decode!(bin) do
            %{"version" => @state_version} = s -> s
            _ -> raise "soup: #{file} is not v#{@state_version} state"
          end

        # Only a missing file means a fresh plane; any other read error must not erase history.
        {:error, :enoent} ->
          %{"version" => @state_version, "worlds" => %{}, "order" => []}

        {:error, why} ->
          raise "soup: cannot read #{file} (#{inspect(why)}); refusing to start empty"
      end

    st = %{dir: dir, lease_ms: Keyword.get(opts, :lease_ms, 600_000), s: state}
    reassert_holds(st.s)
    {:ok, collect_orphans(st)}
  end

  @impl true
  def handle_call(:data_dir, _from, st), do: {:reply, st.dir, st}
  def handle_call(:lease_ms, _from, st), do: {:reply, st.lease_ms, st}

  def handle_call({:register, w}, _from, st) do
    case st.s["worlds"][w["name"]] do
      nil ->
        chain = for _ <- 1..w["segments"], do: fresh_segment()
        world = Map.merge(w, %{"registeredAt" => now(), "chain" => chain})

        s =
          st.s
          |> put_in(["worlds", w["name"]], world)
          |> Map.update!("order", &(&1 ++ [w["name"]]))

        Logger.info("soup: registered #{w["name"]}, #{w["segments"]} segments")
        {:reply, {:ok, :registered}, persist(%{st | s: s})}

      existing ->
        if Map.take(existing, Map.keys(w)) == w,
          do: {:reply, {:ok, :exists}, st},
          else: {:reply, {:error, "world #{w["name"]} exists with other parameters"}, st}
    end
  end

  def handle_call({:next, island}, _from, st) do
    st = sweep(st)

    case pick(st.s, island) do
      {name, k, role} ->
        lease = %{
          "id" => Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false),
          "island" => island,
          "role" => role,
          "expiresAt" => now() + st.lease_ms
        }

        st =
          update_seg(st, name, k, fn seg ->
            seg = Map.put(seg, "lease", lease)
            if role == "run", do: Map.put(seg, "status", "leased"), else: seg
          end)

        {:reply, {:ok, task(st.s["worlds"][name], k, lease)}, persist(st)}

      nil ->
        {:reply, {:ok, %{idle: true, retryAfterMs: 2_000, finished: finished?(st.s)}}, st}
    end
  end

  def handle_call({:upload_target, id, island, lease}, _from, st) do
    st = sweep(st)

    reply =
      with {:ok, w, k, _seg} <- current(st.s, id, island, lease, "run") do
        {:ok, w, (k + 1) * w["epochsPerSegment"]}
      end

    {:reply, reply, st}
  end

  # The bytes were checked and hashed by the caller; publishing here keeps a
  # refused or stale upload out of the store.
  def handle_call({:record_upload, id, island, lease, sha, staged}, _from, st) do
    st = sweep(st)

    case current(st.s, id, island, lease, "run") do
      # One upload per lease: a repeat of the same bytes is a no-op.
      {:ok, _w, _k, %{"lease" => %{"upload" => ^sha}}} ->
        File.rm(staged)
        {:reply, :ok, st}

      {:ok, _w, _k, %{"lease" => %{"upload" => up}}} when is_binary(up) ->
        {:reply, {:error, "this lease already uploaded a different snapshot"}, st}

      {:ok, w, k, _seg} ->
        publish!(st.dir, sha, staged)
        st = update_seg(st, w["name"], k, &put_in(&1, ["lease", "upload"], sha))
        {:reply, :ok, persist(st)}

      err ->
        {:reply, err, st}
    end
  end

  def handle_call({:complete, id, island, lease, sha}, _from, st) do
    st = sweep(st)

    case current(st.s, id, island, lease, nil) do
      {:ok, w, k, %{"lease" => %{"role" => "run"} = l}} ->
        if l["upload"] == sha do
          st =
            update_seg(st, w["name"], k, fn seg ->
              %{seg | "status" => "done", "sha" => sha, "ranBy" => island, "lease" => nil}
            end)

          {:reply, {:ok, "done"}, persist(st)}
        else
          {:reply,
           {:error,
            if(l["upload"],
              do: "hash does not match this attempt's upload",
              else: "no snapshot uploaded on this lease"
            )}, st}
        end

      {:ok, w, k, %{"lease" => %{"role" => "verify"}} = seg} ->
        status = if seg["sha"] == sha, do: "verified", else: "diverged"

        st =
          update_seg(st, w["name"], k, fn seg ->
            seg
            |> Map.merge(%{"status" => status, "verifiedBy" => island, "lease" => nil})
            |> then(&if(status == "diverged", do: Map.put(&1, "verifyHash", sha), else: &1))
          end)

        st = if status == "diverged", do: block_after(st, w["name"], k), else: st

        if status == "diverged",
          do:
            Logger.warning("soup: #{id} diverged (ran by #{seg["ranBy"]}, checked by #{island})")

        {:reply, {:ok, status}, persist(st)}

      err ->
        {:reply, err, st}
    end
  end

  def handle_call({:snapshot_path, id, which}, _from, st) do
    reply =
      with {:ok, w, k} <- locate(st.s, id),
           k = if(which == :start, do: k - 1, else: k),
           true <- k >= 0 || {:error, "segment 0 starts from the seed"},
           %{"status" => s, "sha" => sha} when s in ["done", "verified"] <-
             Enum.at(w["chain"], k) do
        {:ok, Store.blob_path(st.dir, sha)}
      else
        {:error, _} = e -> e
        _ -> {:error, "no accepted snapshot"}
      end

    {:reply, reply, st}
  end

  def handle_call(:status, _from, st) do
    st = sweep(st)
    worlds = for name <- st.s["order"], do: world_json(st.s["worlds"][name])
    {:reply, %{worlds: worlds, finished: finished?(st.s)}, st}
  end

  # ---- helpers ----

  # After a restart, every live lease's island is held again until the lease
  # ends (Queue.hold/2), so the island table's pruning cannot forget it. The
  # queue starts first (Coordinator.Application) and never calls this process,
  # so the call cannot deadlock; without a queue (tests) there is nothing to hold.
  defp reassert_holds(s) do
    if Process.whereis(Coordinator.Queue) do
      t = now()

      for {_, w} <- s["worlds"],
          %{"lease" => %{"island" => i, "expiresAt" => e}} <- w["chain"],
          e > t,
          do: Coordinator.Queue.hold(i, e)
    end

    :ok
  end

  defp now, do: Coordinator.Clock.now()

  defp fresh_segment,
    do: %{
      "status" => "pending",
      "blocked" => false,
      "sha" => nil,
      "ranBy" => nil,
      "verifiedBy" => nil,
      "lease" => nil
    }

  defp verify?(w, k), do: rem(k, w["verifyEvery"]) == 0 or k == w["segments"] - 1

  defp locate(s, id) when is_binary(id) do
    with [name, ks] <- String.split(id, ".", parts: 2),
         %{} = w <- s["worlds"][name],
         {k, ""} when k >= 0 <- Integer.parse(ks),
         true <- k < w["segments"] do
      {:ok, w, k}
    else
      _ -> {:error, "unknown segment"}
    end
  end

  defp locate(_, _), do: {:error, "unknown segment"}

  # The segment's lease, if `lease` is it, held by `island`, for `role` (nil: any).
  defp current(s, id, island, lease, role) do
    with {:ok, w, k} <- locate(s, id) do
      case Enum.at(w["chain"], k) do
        %{"lease" => %{"id" => ^lease, "island" => ^island, "role" => r}} = seg
        when role == nil or r == role ->
          {:ok, w, k, seg}

        _ ->
          {:error, "lease is not current"}
      end
    end
  end

  defp update_seg(st, name, k, fun) do
    %{st | s: update_in(st.s, ["worlds", name, "chain"], &List.update_at(&1, k, fun))}
  end

  # A divergence blocks every later segment and drops its lease.
  defp block_after(st, name, k) do
    chain =
      st.s["worlds"][name]["chain"]
      |> Enum.with_index()
      |> Enum.map(fn
        {seg, j} when j > k ->
          seg = %{seg | "blocked" => true, "lease" => nil}
          if seg["status"] == "leased", do: %{seg | "status" => "pending"}, else: seg

        {seg, _} ->
          seg
      end)

    %{st | s: put_in(st.s, ["worlds", name, "chain"], chain)}
  end

  defp sweep(st) do
    t = now()

    {worlds, changed} =
      Enum.map_reduce(st.s["worlds"], false, fn {name, w}, changed ->
        {chain, c} =
          Enum.map_reduce(w["chain"], changed, fn
            %{"lease" => %{"expiresAt" => e} = l} = seg, _ when e <= t ->
              seg = %{seg | "lease" => nil}
              seg = if l["role"] == "run", do: %{seg | "status" => "pending"}, else: seg
              {seg, true}

            seg, c ->
              {seg, c}
          end)

        {{name, %{w | "chain" => chain}}, c}
      end)

    if changed, do: persist(%{st | s: %{st.s | "worlds" => Map.new(worlds)}}), else: st
  end

  # Verifies first (an island never checks its own run), then the lowest runnable segment.
  defp pick(s, island) do
    Enum.find_value(s["order"], fn name ->
      w = s["worlds"][name]
      chain = Enum.with_index(w["chain"])
      live = Enum.reject(chain, fn {seg, _} -> seg["blocked"] end)

      verify =
        Enum.find(live, fn {seg, k} ->
          seg["status"] == "done" and seg["lease"] == nil and seg["ranBy"] != island and
            verify?(w, k)
        end)

      run =
        Enum.find(live, fn {seg, k} ->
          seg["status"] == "pending" and
            (k == 0 or Enum.at(w["chain"], k - 1)["status"] in ["done", "verified"])
        end)

      case {verify, run} do
        {{_, k}, _} -> {name, k, "verify"}
        {nil, {_, k}} -> {name, k, "run"}
        _ -> nil
      end
    end)
  end

  # Nothing left to run or check anywhere (a blocked segment counts as settled).
  # With no world yet nothing is finished, so an island started first waits.
  defp finished?(s) do
    map_size(s["worlds"]) > 0 and
      Enum.all?(s["worlds"], fn {_, w} ->
        w["chain"]
        |> Enum.with_index()
        |> Enum.all?(fn {seg, k} ->
          seg["blocked"] or seg["status"] in ["verified", "diverged"] or
            (seg["status"] == "done" and not verify?(w, k))
        end)
      end)
  end

  defp params_json(w), do: Map.take(w, ~w(seed num width height radius mutation lang))

  defp task(w, k, lease) do
    n = w["epochsPerSegment"]
    id = segment_id(w["name"], k)

    %{
      kind: lease["role"],
      segment: id,
      lease: lease["id"],
      expiresAt: lease["expiresAt"],
      world: w["name"],
      params: params_json(w),
      startEpoch: k * n,
      epochs: n,
      endEpoch: (k + 1) * n,
      # Segment 0 starts from the seed.
      start: if(k > 0, do: "/api/soup/segments/#{id}/start"),
      startSha: if(k > 0, do: Enum.at(w["chain"], k - 1)["sha"])
    }
  end

  defp world_json(w) do
    segments =
      w["chain"]
      |> Enum.with_index()
      |> Enum.map(fn {seg, k} ->
        %{
          id: segment_id(w["name"], k),
          index: k,
          status: seg["status"],
          blocked: seg["blocked"],
          sha: seg["sha"],
          ranBy: seg["ranBy"],
          verifiedBy: seg["verifiedBy"],
          verifyHash: seg["verifyHash"],
          verify: verify?(w, k),
          lease: seg["lease"] && Map.take(seg["lease"], ~w(island role expiresAt))
        }
      end)

    head =
      w["chain"]
      |> Enum.with_index()
      |> Enum.take_while(fn {seg, _} -> seg["status"] in ["done", "verified"] end)
      |> List.last()

    w
    |> Map.drop(["chain"])
    |> Map.merge(%{
      "params" => params_json(w),
      "chain" => segments,
      "head" => head && %{index: elem(head, 1), sha: elem(head, 0)["sha"]},
      "counts" =>
        Enum.frequencies_by(w["chain"], &if(&1["blocked"], do: "blocked", else: &1["status"]))
    })
  end

  # Blobs are published durably (fsync file, rename, fsync directory) before
  # any state that names them is written, so an acknowledged segment never
  # points at a missing or torn snapshot.
  defp publish!(dir, sha, staged) do
    dest = Store.blob_path(dir, sha)

    if File.exists?(dest) and Store.sha256_file(dest) == sha,
      do: File.rm(staged),
      else: Disk.publish!(staged, dest)
  end

  # The snapshots the state still needs: accepted segments' (done or verified,
  # blocked ones included, since they are still served) and live run leases'
  # uploads. A diverged segment's snapshot is not among them.
  defp refs(s) do
    for {_, w} <- s["worlds"], seg <- w["chain"], reduce: MapSet.new() do
      acc ->
        acc = if seg["status"] in ["done", "verified"], do: MapSet.put(acc, seg["sha"]), else: acc

        case seg["lease"] do
          %{"upload" => up} when is_binary(up) -> MapSet.put(acc, up)
          _ -> acc
        end
    end
  end

  # Writes the state, then deletes every blob the previous state needed and this
  # one does not (an expired, replaced, blocked or diverged attempt's upload),
  # unless another segment still names the same bytes.
  defp persist(st) do
    Disk.write_atomic!(Path.join(st.dir, "state.json"), Jason.encode!(st.s))
    now = refs(st.s)

    for sha <- MapSet.difference(Map.get(st, :refs, now), now),
        do: File.rm(Store.blob_path(st.dir, sha))

    Map.put(st, :refs, now)
  end

  # At start: blobs a crash left published but never recorded (or recorded and
  # then dropped) are removed. Staging files belong to request processes and
  # are left alone.
  defp collect_orphans(st) do
    refs = refs(st.s)

    for path <- Path.wildcard(Path.join([st.dir, "files", "*", "*"])),
        not MapSet.member?(refs, Path.basename(path)),
        do: File.rm(path)

    Map.put(st, :refs, refs)
  end
end
