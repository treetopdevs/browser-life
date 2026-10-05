defmodule Coordinator.Discovery do
  @moduledoc """
  The discovery plane's queue (docs/evolvability-discovery-2026-10-04, DESIGN
  section 6, PLAN Stage 3b). It hands frozen `discovery-v1` cases to browser
  and command-line workers, and wraps the same runner, validator and reducer
  as the local shard path (`tools/discovery.ts`): case identities never
  change, and an export of a campaign is a shard-layout root that
  `tools/discovery.ts validate` and `reduce` read exactly as they read a
  local one.

  Isolation (PRD O9). This process owns its own data directory
  (`:discovery_data_dir`, default `data-discovery`) and its own state file,
  shares no state with `Coordinator.Queue`, and refuses a directory that is,
  contains or lies inside the registered queue's `:data_dir`. Research cases
  never enter the registered or public queue.

  Identity. A campaign is registered with its frozen files' exact bytes. The
  manifest is filed under the SHA-256 of `manifest.json`, which is the
  campaign's manifest digest; every `case.json` must hash to its case ID and
  every initial artifact to its digest. The coordinator treats these as
  opaque frozen artifacts: canonical form and the campaign-core digest are
  checked by the TypeScript validator.

  Acceptance (DESIGN section 7). Execution is at least once; acceptance is a
  separately persisted record. A completed attempt is provisional until its
  files, identity and digests check out here and the TypeScript validator
  (`tools/discovery.ts check-attempt`, run outside this process by
  `CoordinatorWeb.DiscoveryController`) has re-derived it. A case is
  accepted when every valid attempt agrees canonically and the agreeing set
  includes a primary and a replay from two different physical hosts; any
  disagreement quarantines it and keeps every attempt. A lease that expired
  before its completion cannot replace anything: its uploads are kept and the
  attempt is rejected as late. A repeated completion returns the recorded
  verdict.

  Workers. A worker joins with the research join token, its operator-assigned
  physical host ID, backend and source-closure digest. It must run the
  campaign's qualification case and reproduce the pinned canonical result
  before it gets research work. Leases are capped per physical host
  (`concurrentCasesPerHost`) and attempts per case per role
  (`attemptsPerCasePerRole`). A worker that declares itself a cloud instance
  is refused unless a cloud envelope is configured (`:discovery_cloud_envelope`,
  absent by default: the cloud allowance is zero).
  """
  use GenServer
  require Logger
  alias Coordinator.Discovery.Disk

  @max_workers 1024
  @stale_worker_ms 24 * 3_600_000

  @state_version 1
  @roles ~w(primary replay)
  @files ~w(observations.jsonl readout.json end.blck result.json)
  @hex64 ~r/^[0-9a-f]{64}$/
  @label ~r/^[a-z0-9][a-z0-9-]{0,31}$/

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def data_dir, do: GenServer.call(__MODULE__, :data_dir)
  def register_campaign(c), do: GenServer.call(__MODULE__, {:register, c})
  def join(info), do: GenServer.call(__MODULE__, {:join, info})
  def auth(worker_id, token), do: GenServer.call(__MODULE__, {:auth, worker_id, token})
  def next(worker_id), do: GenServer.call(__MODULE__, {:next, worker_id})
  def heartbeat(lease, worker_id), do: GenServer.call(__MODULE__, {:heartbeat, lease, worker_id})

  def upload_target(lease, worker_id),
    do: GenServer.call(__MODULE__, {:upload_target, lease, worker_id})

  def admit_file(lease, worker_id, name, sha, size),
    do: GenServer.call(__MODULE__, {:admit_file, lease, worker_id, name, sha, size})

  def commit_file(lease, worker_id, name, sha),
    do: GenServer.call(__MODULE__, {:commit_file, lease, worker_id, name, sha})

  def completion(lease, worker_id),
    do: GenServer.call(__MODULE__, {:completion, lease, worker_id})

  def finalize(lease, worker_id, verdict),
    do: GenServer.call(__MODULE__, {:finalize, lease, worker_id, verdict})

  def campaign_index(md), do: GenServer.call(__MODULE__, {:index, md})
  def status, do: GenServer.call(__MODULE__, :status)
  def blob_path(dir, sha), do: Path.join([dir, "blobs", binary_part(sha, 0, 2), sha])
  def file_names, do: @files

  # ---- server ----

  @impl true
  def init(opts) do
    dir = Path.expand(Keyword.fetch!(opts, :data_dir))
    queue_dir = Path.expand(Keyword.get(opts, :queue_data_dir, "data"))
    # Compare real paths, so a symlink cannot alias the registered queue's storage.
    inside? = fn a, b ->
      {a, b} = {Disk.real_path(a), Disk.real_path(b)}
      a == b or String.starts_with?(a, b <> "/")
    end

    if inside?.(dir, queue_dir) or inside?.(queue_dir, dir),
      do:
        raise(
          "discovery data dir #{dir} overlaps the registered queue's #{queue_dir}; research data must stay separate"
        )

    Disk.mkdir_durable!(dir)

    state =
      case File.read(Path.join(dir, "state.bin")) do
        {:ok, bin} ->
          case :erlang.binary_to_term(bin, [:safe]) do
            %{version: @state_version} = s -> s
            _ -> raise "discovery: #{dir}/state.bin is not v#{@state_version} state"
          end

        # Only a missing file means a fresh plane; any other read error must not erase history.
        {:error, :enoent} ->
          %{version: @state_version, campaigns: %{}, attempts: %{}, workers: %{}, leases: %{}}

        {:error, why} ->
          raise "discovery: cannot read #{dir}/state.bin (#{inspect(why)}); refusing to start empty"
      end

    lease_ms = Keyword.get(opts, :lease_ms, 120_000)

    # Heartbeats are not persisted one by one. After a restart every active
    # lease gets a full lease period from now, so an extension acknowledged
    # before the restart is never lost.
    t = now()

    state =
      update_in(state.leases, fn leases ->
        Map.new(leases, fn
          {id, %{status: :active} = l} -> {id, %{l | expires_at: max(l.expires_at, t + lease_ms)}}
          other -> other
        end)
      end)

    {:ok, state |> Map.put(:dir, dir) |> Map.put(:lease_ms, lease_ms)}
  end

  @impl true
  def handle_call(:data_dir, _from, s), do: {:reply, s.dir, s}

  def handle_call({:register, c}, _from, s) do
    md = c.manifest_digest

    cond do
      Map.has_key?(s.campaigns, md) ->
        {:reply, {:ok, :exists}, s}

      true ->
        campaign = %{
          name: c.name,
          manifest_digest: md,
          source_closure: c.source_closure,
          observer_version: c.observer_version,
          readout_version: c.readout_version,
          case_ids: c.case_ids,
          cases: c.cases,
          limits: c.limits,
          qualification: c.qualification,
          frozen: c.frozen,
          registered_at: now(),
          started_at: nil,
          bytes_used: c.bytes
        }

        s = put_in(s.campaigns[md], campaign) |> persist()
        Logger.info("discovery: registered #{c.name} (#{md}), #{length(c.case_ids)} cases")
        {:reply, {:ok, :registered}, s}
    end
  end

  def handle_call({:join, info}, _from, s) do
    s = prune_workers(s)

    if map_size(s.workers) >= @max_workers,
      do: {:reply, {:error, :too_many_workers}, s},
      else: join(s, info)
  end

  def handle_call({:auth, id, token}, _from, s) do
    case s.workers[id] do
      %{token_hash: h} = w ->
        if Plug.Crypto.secure_compare(h, :crypto.hash(:sha256, token)),
          do: {:reply, {:ok, w}, put_in(s.workers[id].last_seen, now())},
          else: {:reply, :error, s}

      _ ->
        {:reply, :error, s}
    end
  end

  def handle_call({:next, wid}, _from, s) do
    s = sweep(s)
    w = s.workers[wid]

    case pick(s, w) do
      {:task, md, case_id, role} ->
        {s, task} = lease(s, w, md, case_id, role)
        {:reply, {:ok, task}, persist(s)}

      {:idle, why} ->
        {:reply, {:ok, %{idle: true, reason: why, retryAfterMs: 2_000}}, s}
    end
  end

  def handle_call({:heartbeat, lease_id, wid}, _from, s) do
    s = sweep(s)

    case s.leases[lease_id] do
      %{worker: ^wid, status: :active} = l ->
        l = %{l | expires_at: now() + s.lease_ms}
        {:reply, {:ok, l.expires_at}, put_in(s.leases[lease_id], l)}

      %{worker: ^wid, status: st} ->
        {:reply, {:error, "lease #{st}"}, s}

      _ ->
        {:reply, {:error, "unknown lease"}, s}
    end
  end

  def handle_call({:upload_target, lease_id, wid}, _from, s) do
    case s.leases[lease_id] do
      %{worker: ^wid} = l -> {:reply, {:ok, l.status}, s}
      _ -> {:reply, {:error, "unknown lease"}, s}
    end
  end

  # Admission happens before the controller publishes any bytes: a refused
  # upload leaves nothing behind, and accepted bytes count against the
  # campaign's storage cap (uploads are counted as sent, never deduplicated).
  def handle_call({:admit_file, lease_id, wid, name, sha, size}, _from, s) do
    case s.leases[lease_id] do
      %{worker: ^wid} = l ->
        key = l.attempt
        a = s.attempts[key]
        c = s.campaigns[a.md]
        pending = Map.get(a, :pending, %{})
        known = Map.merge(pending, a.files)

        cond do
          a.status in [:valid, :rejected] ->
            {:reply, {:error, "attempt already completed"}, s}

          Map.get(known, name) == sha ->
            {:reply, :ok, s}

          Map.has_key?(known, name) ->
            {:reply, {:error, "#{name} was already uploaded with different bytes"}, s}

          c.bytes_used + size > c.limits["campaignBytes"] ->
            {:reply,
             {:error,
              "campaign storage cap (#{c.limits["campaignBytes"]} bytes) would be exceeded; the campaign stays incomplete"},
             s}

          true ->
            # Reserve only: the reference becomes visible (commit_file) after durable publication.
            a =
              Map.merge(a, %{
                pending: Map.put(pending, name, sha),
                sizes: Map.put(a.sizes, name, size)
              })

            s = put_in(s.attempts[key], a)
            s = put_in(s.campaigns[a.md].bytes_used, c.bytes_used + size)
            {:reply, :ok, persist(s)}
        end

      _ ->
        {:reply, {:error, "unknown lease"}, s}
    end
  end

  def handle_call({:commit_file, lease_id, wid, name, sha}, _from, s) do
    case s.leases[lease_id] do
      %{worker: ^wid} = l ->
        key = l.attempt
        a = s.attempts[key]
        pending = Map.get(a, :pending, %{})

        cond do
          Map.get(a.files, name) == sha ->
            {:reply, :ok, s}

          a.status in [:valid, :rejected] ->
            {:reply, {:error, "attempt already completed"}, s}

          Map.get(pending, name) == sha ->
            a =
              %{a | files: Map.put(a.files, name, sha)}
              |> Map.put(:pending, Map.delete(pending, name))

            {:reply, :ok, put_in(s.attempts[key], a) |> persist()}

          true ->
            {:reply, {:error, "#{name} was not admitted with these bytes"}, s}
        end

      _ ->
        {:reply, {:error, "unknown lease"}, s}
    end
  end

  def handle_call({:completion, lease_id, wid}, _from, s) do
    s = sweep(s)

    case s.leases[lease_id] do
      %{worker: ^wid} = l ->
        a = s.attempts[l.attempt]
        c = s.campaigns[a.md]

        if a.status in [:valid, :rejected] do
          {:reply, {:done, verdict_reply(s, a)}, s}
        else
          {:reply,
           {:ok,
            %{
              attempt: a,
              lease_status: l.status,
              manifest_sha: c.frozen["manifest.json"],
              case_sha: a.case_id,
              initial_sha: c.cases[a.case_id],
              closure: c.source_closure,
              qualification: c.qualification,
              host: s.workers[wid].host
            }}, s}
        end

      _ ->
        {:reply, {:error, "unknown lease"}, s}
    end
  end

  def handle_call({:finalize, lease_id, wid, verdict}, _from, s) do
    s = sweep(s)

    case s.leases[lease_id] do
      %{worker: ^wid} = l ->
        a = s.attempts[l.attempt]

        if a.status in [:valid, :rejected] do
          {:reply, {:ok, verdict_reply(s, a)}, s}
        else
          {status, errors} =
            cond do
              l.status != :active ->
                {:rejected, ["lease #{l.status} before completion: kept as a late attempt"]}

              verdict.valid ->
                {:valid, []}

              true ->
                {:rejected, verdict.errors}
            end

          a = %{
            a
            | status: status,
              errors: errors,
              canonical: if(status == :valid, do: verdict.canonical),
              completed_at: now()
          }

          l = if l.status == :active, do: %{l | status: :completed}, else: l
          s = put_in(s.attempts[l.attempt], a)
          s = put_in(s.leases[lease_id], l)
          s = if a.role == "qualify", do: qualify(s, a), else: s
          s = persist(s)
          {:reply, {:ok, verdict_reply(s, s.attempts[l.attempt])}, s}
        end

      _ ->
        {:reply, {:error, "unknown lease"}, s}
    end
  end

  def handle_call({:index, md}, _from, s) do
    case s.campaigns[md] do
      nil ->
        {:reply, nil, s}

      c ->
        atts = for {_, a} <- s.attempts, a.md == md, do: a

        cases =
          for id <- c.case_ids do
            mine = Enum.filter(atts, &(&1.case_id == id and &1.role in @roles))

            %{
              caseId: id,
              initial: c.cases[id],
              decision: decide(mine),
              attempts: Enum.map(Enum.sort_by(mine, & &1.attempt_id), &attempt_json/1)
            }
          end

        quals = atts |> Enum.filter(&(&1.role == "qualify")) |> Enum.sort_by(& &1.attempt_id)

        {:reply,
         %{
           campaign: c.name,
           manifestDigest: md,
           frozen: c.frozen,
           sourceClosureDigest: c.source_closure,
           cases: cases,
           qualifications: Enum.map(quals, &attempt_json/1)
         }, s}
    end
  end

  def handle_call(:status, _from, s) do
    s = sweep(s)

    campaigns =
      for {md, c} <- s.campaigns do
        atts = for {_, a} <- s.attempts, a.md == md and a.role in @roles, do: a
        by_case = Enum.group_by(atts, & &1.case_id)
        decisions = Enum.map(c.case_ids, &decide(Map.get(by_case, &1, [])).decision)

        %{
          campaign: c.name,
          manifestDigest: md,
          cases: length(c.case_ids),
          decisions: Enum.frequencies(decisions),
          activeLeases: Enum.count(s.leases, fn {_, l} -> l.md == md and l.status == :active end)
        }
      end

    workers =
      for {_, w} <- s.workers,
          do: %{
            id: w.id,
            label: w.label,
            host: w.host,
            backend: w.backend,
            qualified: w.qualified,
            lastSeen: w.last_seen
          }

    {:reply, %{campaigns: campaigns, workers: workers}, s}
  end

  defp join(s, info) do
    # Lowercase hex: worker IDs appear in result manifests, whose labels are lowercase.
    id = "dw-" <> Base.encode16(:crypto.strong_rand_bytes(6), case: :lower)
    token = rand(32)

    w = %{
      id: id,
      token_hash: :crypto.hash(:sha256, token),
      label: info.label,
      host: info.host,
      backend: info.backend,
      closure: info.closure,
      runtime: info.runtime,
      concurrency: info.concurrency,
      qualified: [],
      joined_at: now(),
      last_seen: now()
    }

    s = put_in(s.workers[id], w) |> persist()
    {:reply, {:ok, %{workerId: id, token: token, leaseMs: s.lease_ms}}, s}
  end

  defp prune_workers(s) do
    t = now()
    busy = for {_, l} <- s.leases, l.status == :active, into: MapSet.new(), do: l.worker

    update_in(s.workers, fn ws ->
      Map.reject(ws, fn {id, w} -> t - w.last_seen > @stale_worker_ms and id not in busy end)
    end)
  end

  # ---- scheduling ----

  defp pick(s, w) do
    campaigns = s.campaigns |> Map.values() |> Enum.sort_by(& &1.registered_at)

    Enum.reduce_while(campaigns, {:idle, "no work"}, fn c, acc ->
      case pick_in(s, w, c) do
        {:task, _, _, _} = t -> {:halt, t}
        {:idle, why} -> {:cont, if(acc == {:idle, "no work"}, do: {:idle, why}, else: acc)}
      end
    end)
  end

  defp pick_in(s, w, c) do
    md = c.manifest_digest
    active = for {_, l} <- s.leases, l.status == :active, do: l
    host_active = Enum.count(active, &(&1.md == md and s.workers[&1.worker].host == w.host))
    worker_active = Enum.count(active, &(&1.worker == w.id))
    limits = c.limits

    cond do
      w.closure != c.source_closure ->
        {:idle,
         "this worker's source closure #{w.closure} differs from the campaign's #{c.source_closure}"}

      w.backend != "cpu-ref-v1" ->
        {:idle, "the campaign needs backend cpu-ref-v1; this worker offers #{w.backend}"}

      worker_active >= max(1, w.concurrency) ->
        {:idle, "worker concurrency limit reached"}

      host_active >= limits["concurrentCasesPerHost"] ->
        {:idle, "per-host concurrency cap reached"}

      c.started_at != nil and now() >= c.started_at + limits["campaignWallSeconds"] * 1000 ->
        {:idle, "campaign wall-time cap reached; the campaign stays incomplete"}

      c.bytes_used >= limits["campaignBytes"] ->
        {:idle, "campaign storage cap reached; the campaign stays incomplete"}

      md not in w.qualified ->
        q = c.qualification
        qualifying = Enum.any?(active, &(&1.worker == w.id and &1.role == "qualify"))

        failed =
          for {_, a} <- s.attempts,
              a.md == md and a.worker == w.id and a.role == "qualify" and
                a.status in [:rejected, :expired],
              do: a

        cond do
          qualifying ->
            {:idle, "qualification in progress"}

          q == nil ->
            {:idle, "campaign has no qualification case"}

          length(failed) >= 3 ->
            {:idle,
             "qualification failed #{length(failed)} times: #{Enum.join(hd(Enum.sort_by(failed, & &1.completed_at, :desc)).errors, "; ")}"}

          true ->
            {:task, md, q["caseId"], "qualify"}
        end

      true ->
        pick_case(s, w, c, active)
    end
  end

  defp pick_case(s, w, c, active) do
    md = c.manifest_digest
    cap = c.limits["attemptsPerCasePerRole"]
    atts = for {_, a} <- s.attempts, a.md == md and a.role in @roles, do: a
    by_case = Enum.group_by(atts, & &1.case_id)

    found =
      Enum.find_value(c.case_ids, fn id ->
        mine = Map.get(by_case, id, [])
        leased = Enum.filter(active, &(&1.md == md and &1.case_id == id))
        valid = Enum.filter(mine, &(&1.status == :valid))
        count = fn role -> Enum.count(mine, &(&1.role == role)) end
        dec = decide(mine).decision

        cond do
          dec in ["accepted", "quarantined"] ->
            nil

          valid == [] and not Enum.any?(leased, &(&1.role == "primary")) and
              count.("primary") < cap ->
            {md, id, "primary"}

          dec == "pending-replay" and
            Enum.any?(valid, &(&1.role == "primary" and &1.host != w.host)) and
            not Enum.any?(valid, &(&1.role == "replay" and &1.host == w.host)) and
            not Enum.any?(leased, &(&1.role == "replay")) and
              count.("replay") < cap ->
            {md, id, "replay"}

          true ->
            nil
        end
      end)

    case found do
      {md, id, role} -> {:task, md, id, role}
      nil -> {:idle, "no case of #{c.name} needs this host now"}
    end
  end

  defp lease(s, w, md, case_id, role) do
    c = s.campaigns[md]

    n =
      Enum.count(s.attempts, fn {{m, cid, _}, a} ->
        m == md and cid == case_id and a.role == role and a.host == w.host
      end)

    attempt_id = "#{w.host}.#{role}.#{n + 1}"
    # The campaign's wall-time cap runs from its first lease, outages included.
    started = c.started_at || now()
    campaign_end = started + c.limits["campaignWallSeconds"] * 1000
    lease_id = "dl-" <> rand(12)
    key = {md, case_id, attempt_id}
    expires = now() + s.lease_ms

    a = %{
      md: md,
      case_id: case_id,
      attempt_id: attempt_id,
      role: role,
      worker: w.id,
      host: w.host,
      lease: lease_id,
      status: :leased,
      files: %{},
      sizes: %{},
      canonical: nil,
      errors: [],
      created_at: now(),
      completed_at: nil
    }

    l = %{
      id: lease_id,
      md: md,
      case_id: case_id,
      role: role,
      worker: w.id,
      attempt: key,
      expires_at: expires,
      status: :active
    }

    s =
      s
      |> put_in([:attempts, key], a)
      |> put_in([:leases, lease_id], l)
      |> put_in([:campaigns, md, :started_at], started)

    task = %{
      leaseId: lease_id,
      attemptId: attempt_id,
      role: role,
      caseId: case_id,
      manifestDigest: md,
      manifestSha: c.frozen["manifest.json"],
      initialSha: c.cases[case_id],
      expiresAt: expires,
      leaseMs: s.lease_ms,
      caseWallSeconds: c.limits["caseWallSeconds"],
      # Milliseconds this case may run before the campaign's wall-time cap; workers stop it then.
      remainingMs: max(0, campaign_end - now())
    }

    {s, task}
  end

  defp sweep(s) do
    t = now()

    expired =
      for {id, l} <- s.leases, l.status == :active and l.expires_at < t, do: id

    if expired == [] do
      s
    else
      s =
        Enum.reduce(expired, s, fn id, s ->
          l = s.leases[id]
          s = put_in(s.leases[id].status, :expired)
          a = s.attempts[l.attempt]

          if a.status == :leased,
            do: put_in(s.attempts[l.attempt], %{a | status: :expired, errors: ["lease expired"]}),
            else: s
        end)

      persist(s)
    end
  end

  defp qualify(s, a) do
    c = s.campaigns[a.md]
    expected = c.qualification && c.qualification["canonical"]
    w = s.workers[a.worker]

    if a.status == :valid and expected != nil and a.canonical == expected do
      put_in(s.workers[a.worker].qualified, Enum.uniq([a.md | w.qualified]))
    else
      a =
        if a.status == :valid,
          do: %{
            a
            | status: :rejected,
              errors: ["qualification result differs from the pinned reference"]
          },
          else: a

      put_in(s.attempts[{a.md, a.case_id, a.attempt_id}], a)
    end
  end

  @doc """
  The acceptance rule, identical to `decideCase` in packages/runner/src/discovery.ts:
  valid attempts must agree canonically, and the agreeing set needs a primary
  and a replay spanning two physical hosts.
  """
  def decide(attempts) do
    valid = Enum.filter(attempts, &(&1.status == :valid and &1.role in @roles))
    groups = Enum.group_by(valid, & &1.canonical)

    cond do
      map_size(groups) > 1 ->
        %{decision: "quarantined", reason: "valid attempts disagree"}

      valid == [] ->
        %{
          decision: "missing",
          reason: if(attempts == [], do: "no attempt", else: "no valid attempt")
        }

      true ->
        hosts = valid |> Enum.map(& &1.host) |> Enum.uniq()
        primary = Enum.any?(valid, &(&1.role == "primary"))
        replay = Enum.any?(valid, &(&1.role == "replay"))

        if primary and replay and length(hosts) >= 2,
          do: %{
            decision: "accepted",
            reason: "#{length(valid)} agreeing attempts on #{length(hosts)} hosts"
          },
          else: %{
            decision: "pending-replay",
            reason: "needs an agreeing replay from a different physical host"
          }
    end
  end

  defp verdict_reply(s, a) do
    mine =
      for {_, x} <- s.attempts,
          x.md == a.md and x.case_id == a.case_id and x.role in @roles,
          do: x

    %{
      attemptId: a.attempt_id,
      status: Atom.to_string(a.status),
      errors: a.errors,
      decision: decide(mine).decision,
      qualified: a.md in (s.workers[a.worker] || %{qualified: []}).qualified
    }
  end

  defp attempt_json(a) do
    %{
      attemptId: a.attempt_id,
      role: a.role,
      host: a.host,
      worker: a.worker,
      status: Atom.to_string(a.status),
      errors: a.errors,
      files: a.files
    }
  end

  # ---- helpers ----

  @doc false
  def valid_label?(v), do: is_binary(v) and Regex.match?(@label, v)
  @doc false
  def hex64?(v), do: is_binary(v) and Regex.match?(@hex64, v)

  defp now, do: System.system_time(:millisecond)
  defp rand(n), do: Base.url_encode64(:crypto.strong_rand_bytes(n), padding: false)

  # The directory is flushed too (Disk.write_atomic!), so an acknowledged change survives power loss.
  defp persist(s) do
    Disk.write_atomic!(
      Path.join(s.dir, "state.bin"),
      :erlang.term_to_binary(Map.drop(s, [:dir, :lease_ms]))
    )

    s
  end
end
