defmodule Coordinator.DiscoveryTest do
  use ExUnit.Case, async: false
  alias Coordinator.Discovery

  @closure String.duplicate("c", 64)
  @md String.duplicate("a", 64)
  @ids for(i <- 1..3, do: String.duplicate(Integer.to_string(i), 64))
  @limits %{
    "concurrentCasesPerHost" => 4,
    "caseWallSeconds" => 600,
    "campaignWallSeconds" => 7200,
    "campaignBytes" => 2_000_000_000,
    "attemptsPerCasePerRole" => 3
  }

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-discovery-#{System.unique_integer([:positive])}")

    start_supervised!(
      {Discovery, data_dir: dir, queue_data_dir: dir <> "-queue", lease_ms: 60_000}
    )

    on_exit(fn -> File.rm_rf!(dir) end)

    {:ok, :registered} =
      Discovery.register_campaign(%{
        name: "engineering-v1",
        manifest_digest: @md,
        source_closure: @closure,
        observer_version: "exact-ledger-v1",
        readout_version: "engineering-readout-v1",
        case_ids: @ids,
        cases: Map.new(@ids, &{&1, String.duplicate("f", 64)}),
        limits: @limits,
        qualification: %{"caseId" => hd(@ids), "canonical" => canonical(hd(@ids))},
        frozen: %{"manifest.json" => @md},
        bytes: 1000
      })

    %{dir: dir}
  end

  defp register(limit_overrides) do
    {:ok, :registered} =
      Discovery.register_campaign(%{
        name: "e",
        manifest_digest: @md,
        source_closure: @closure,
        observer_version: "x",
        readout_version: "y",
        case_ids: @ids,
        cases: Map.new(@ids, &{&1, String.duplicate("f", 64)}),
        limits: Map.merge(@limits, limit_overrides),
        qualification: %{"caseId" => hd(@ids), "canonical" => canonical(hd(@ids))},
        frozen: %{"manifest.json" => @md},
        bytes: 1000
      })
  end

  defp canonical(id, variant \\ 0), do: %{"caseId" => id, "endStateHash" => "#{variant}"}

  defp worker(host, opts \\ []) do
    {:ok, %{workerId: id}} =
      Discovery.join(%{
        label: host,
        host: host,
        backend: Keyword.get(opts, :backend, "cpu-ref-v1"),
        closure: Keyword.get(opts, :closure, @closure),
        runtime: "test",
        concurrency: Keyword.get(opts, :concurrency, 4)
      })

    id
  end

  defp ok(canonical), do: %{valid: true, errors: [], canonical: canonical}

  defp qualified(host) do
    w = worker(host)
    {:ok, %{role: "qualify", leaseId: l, caseId: id}} = Discovery.next(w)
    {:ok, %{status: "valid", qualified: true}} = Discovery.finalize(l, w, ok(canonical(id)))
    w
  end

  defp run(w, verdict_fun) do
    {:ok, t} = Discovery.next(w)
    {:ok, v} = Discovery.finalize(t.leaseId, w, verdict_fun.(t))
    {t, v}
  end

  test "a worker gets research work only after reproducing the pinned qualification result" do
    w = worker("mac")
    {:ok, t} = Discovery.next(w)
    assert t.role == "qualify" and t.caseId == hd(@ids)
    assert {:ok, %{idle: true, reason: "qualification in progress"}} = Discovery.next(w)
    {:ok, v} = Discovery.finalize(t.leaseId, w, ok(canonical(t.caseId, 9)))
    assert v.status == "rejected" and not v.qualified
    assert v.errors == ["qualification result differs from the pinned reference"]
    {:ok, t2} = Discovery.next(w)
    assert t2.role == "qualify"
    {:ok, %{qualified: true}} = Discovery.finalize(t2.leaseId, w, ok(canonical(t2.caseId)))
    {:ok, t3} = Discovery.next(w)
    assert t3.role == "primary" and t3.caseId == hd(@ids) and t3.attemptId == "mac.primary.1"
  end

  test "a worker that fails qualification three times is told why and stops getting qualification work" do
    w = worker("bad")
    assert w =~ ~r/^dw-[0-9a-f]{12}$/

    for _ <- 1..3 do
      {:ok, t} = Discovery.next(w)
      assert t.role == "qualify"

      {:ok, %{status: "rejected"}} =
        Discovery.finalize(t.leaseId, w, %{
          valid: false,
          errors: ["workerId: bad"],
          canonical: nil
        })
    end

    assert {:ok, %{idle: true, reason: reason}} = Discovery.next(w)
    assert reason =~ "qualification failed 3 times: workerId: bad"
  end

  test "an incapable worker is told why and never leased" do
    w = worker("old", closure: String.duplicate("d", 64))
    assert {:ok, %{idle: true, reason: reason}} = Discovery.next(w)
    assert reason =~ "source closure"
    w2 = worker("gpu", backend: "webgpu-v1")
    assert {:ok, %{idle: true, reason: r2}} = Discovery.next(w2)
    assert r2 =~ "backend cpu-ref-v1"
  end

  test "replays go only to a different physical host; agreement accepts the case" do
    a = qualified("mac")
    b = qualified("m3pro")
    {t, v} = run(a, &ok(canonical(&1.caseId)))
    assert t.role == "primary" and v.decision == "pending-replay"
    # mac's next task is another case's primary, never a replay of its own primary.
    {:ok, t2} = Discovery.next(a)
    assert t2.role == "primary" and t2.caseId != t.caseId
    {:ok, r} = Discovery.next(b)
    assert r.role == "replay" and r.caseId == t.caseId and r.attemptId == "m3pro.replay.1"
    {:ok, rv} = Discovery.finalize(r.leaseId, b, ok(canonical(r.caseId)))
    assert rv.decision == "accepted"
  end

  test "disagreeing valid results quarantine the case and keep every attempt" do
    a = qualified("mac")
    b = qualified("m3pro")
    {t, _} = run(a, &ok(canonical(&1.caseId)))
    {:ok, r} = Discovery.next(b)
    assert r.caseId == t.caseId
    {:ok, rv} = Discovery.finalize(r.leaseId, b, ok(canonical(r.caseId, 1)))
    assert rv.decision == "quarantined"
    idx = Discovery.campaign_index(@md)
    c = Enum.find(idx.cases, &(&1.caseId == t.caseId))
    assert length(c.attempts) == 2 and c.decision.decision == "quarantined"
  end

  test "a lost completion response is retried idempotently" do
    a = qualified("mac")
    {:ok, t} = Discovery.next(a)
    {:ok, v1} = Discovery.finalize(t.leaseId, a, ok(canonical(t.caseId)))

    {:ok, v2} =
      Discovery.finalize(t.leaseId, a, %{valid: false, errors: ["different"], canonical: nil})

    assert v1 == v2
    assert {:done, ^v1} = Discovery.completion(t.leaseId, a)
  end

  test "an expired lease is reassigned, and its late completion cannot replace the new result" do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-discovery-short-#{System.unique_integer([:positive])}")
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 50})
    on_exit(fn -> File.rm_rf!(dir) end)

    {:ok, :registered} =
      Discovery.register_campaign(%{
        name: "e",
        manifest_digest: @md,
        source_closure: @closure,
        observer_version: "x",
        readout_version: "y",
        case_ids: @ids,
        cases: Map.new(@ids, &{&1, String.duplicate("f", 64)}),
        limits: @limits,
        qualification: nil,
        frozen: %{"manifest.json" => @md},
        bytes: 1000
      })

    # Without a qualification case nobody is leased anything.
    w = worker("mac")
    assert {:ok, %{idle: true, reason: "campaign has no qualification case"}} = Discovery.next(w)
  end

  test "lease expiry, heartbeats and late uploads", %{dir: _} do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-discovery-exp-#{System.unique_integer([:positive])}")
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 150})
    on_exit(fn -> File.rm_rf!(dir) end)

    {:ok, :registered} =
      Discovery.register_campaign(%{
        name: "e",
        manifest_digest: @md,
        source_closure: @closure,
        observer_version: "x",
        readout_version: "y",
        case_ids: @ids,
        cases: Map.new(@ids, &{&1, String.duplicate("f", 64)}),
        limits: @limits,
        qualification: %{"caseId" => hd(@ids), "canonical" => canonical(hd(@ids))},
        frozen: %{"manifest.json" => @md},
        bytes: 1000
      })

    a = qualified("mac")
    b = qualified("m3pro")
    {:ok, t} = Discovery.next(a)
    assert {:ok, _} = Discovery.heartbeat(t.leaseId, a)
    Process.sleep(400)
    assert {:error, "lease expired"} = Discovery.heartbeat(t.leaseId, a)
    # The case is offered again, to anyone (here the other host).
    {:ok, t2} = Discovery.next(b)
    assert t2.caseId == t.caseId and t2.role == "primary"
    {:ok, v2} = Discovery.finalize(t2.leaseId, b, ok(canonical(t2.caseId)))
    assert v2.status == "valid"
    # The late completion is kept and rejected; it replaces nothing.
    {:ok, late} = Discovery.finalize(t.leaseId, a, ok(canonical(t.caseId, 5)))
    assert late.status == "rejected"
    assert hd(late.errors) =~ "lease expired before completion"
    assert late.decision == "pending-replay"
  end

  test "state survives a restart: campaigns, workers, leases and verdicts", %{dir: dir} do
    a = qualified("mac")
    {:ok, t} = Discovery.next(a)
    {:ok, open} = Discovery.next(a)
    stop_supervised!(Discovery)

    start_supervised!(
      {Discovery, data_dir: dir, queue_data_dir: dir <> "-queue", lease_ms: 60_000}
    )

    {:ok, v} = Discovery.finalize(t.leaseId, a, ok(canonical(t.caseId)))
    assert v.status == "valid"
    assert {:ok, _} = Discovery.heartbeat(open.leaseId, a)
    assert Discovery.campaign_index(@md).campaign == "engineering-v1"
  end

  test "attempts per case per role are capped, and per-host leases are capped" do
    a = qualified("mac")

    for k <- 1..3 do
      {:ok, t} = Discovery.next(a)
      assert t.caseId == hd(@ids) and t.attemptId == "mac.primary.#{k}"

      {:ok, %{status: "rejected"}} =
        Discovery.finalize(t.leaseId, a, %{valid: false, errors: ["corrupt"], canonical: nil})
    end

    {:ok, t4} = Discovery.next(a)
    assert t4.caseId == Enum.at(@ids, 1)

    b = worker("busy", concurrency: 64)
    # Fill the per-host cap (4) with qualification excluded: qualify first.
    {:ok, q} = Discovery.next(b)
    {:ok, _} = Discovery.finalize(q.leaseId, b, ok(canonical(q.caseId)))
    leased = for _ <- 1..4, do: Discovery.next(b)
    assert Enum.count(leased, fn {:ok, t} -> Map.has_key?(t, :leaseId) end) <= 4
    assert Enum.any?(leased, fn {:ok, t} -> Map.get(t, :idle) end) or length(@ids) < 4
  end

  test "refuses a data directory that overlaps the registered queue's" do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-overlap-#{System.unique_integer([:positive])}")
    Process.flag(:trap_exit, true)

    assert {:error, {%RuntimeError{message: msg}, _}} =
             Discovery.start_link(data_dir: Path.join(dir, "sub"), queue_data_dir: dir)

    assert msg =~ "overlaps the registered queue"
  end

  test "refuses a data directory that reaches the registered queue's through a symlink" do
    stop_supervised!(Discovery)
    base = Path.join(System.tmp_dir!(), "bl-alias-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(base, "queue"))
    File.ln_s!(Path.join(base, "queue"), Path.join(base, "link"))
    on_exit(fn -> File.rm_rf!(base) end)
    Process.flag(:trap_exit, true)

    assert {:error, {%RuntimeError{message: msg}, _}} =
             Discovery.start_link(
               data_dir: Path.join(base, "link/discovery"),
               queue_data_dir: Path.join(base, "queue")
             )

    assert msg =~ "overlaps the registered queue"
  end

  test "an unreadable state file stops startup instead of starting an empty plane", %{dir: dir} do
    stop_supervised!(Discovery)
    path = Path.join(dir, "state.bin")
    File.chmod!(path, 0o000)
    on_exit(fn -> File.chmod(path, 0o600) end)
    Process.flag(:trap_exit, true)

    assert {:error, {%RuntimeError{message: msg}, _}} =
             Discovery.start_link(data_dir: dir, queue_data_dir: dir <> "-queue")

    assert msg =~ "refusing to start empty"
  end

  test "after a restart an active lease keeps a full lease period, so acknowledged heartbeats are not lost" do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-discovery-grace-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 300})
    register(%{})
    a = qualified("mac")
    {:ok, t} = Discovery.next(a)
    Process.sleep(200)
    {:ok, _} = Discovery.heartbeat(t.leaseId, a)
    # Past the original expiry, then a restart: the extension must survive.
    Process.sleep(200)
    stop_supervised!(Discovery)
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 300})
    assert {:ok, _} = Discovery.heartbeat(t.leaseId, a)
    {:ok, v} = Discovery.finalize(t.leaseId, a, ok(canonical(t.caseId)))
    assert v.status == "valid"
  end

  test "uploads are admitted against the campaign's storage cap before any byte is published" do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-discovery-bytes-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 60_000})
    register(%{"campaignBytes" => 1500})
    a = qualified("mac")
    {:ok, t} = Discovery.next(a)
    assert :ok = Discovery.admit_file(t.leaseId, a, "end.blck", String.duplicate("e", 64), 400)
    assert :ok = Discovery.admit_file(t.leaseId, a, "end.blck", String.duplicate("e", 64), 400)

    assert {:error, msg} =
             Discovery.admit_file(t.leaseId, a, "end.blck", String.duplicate("f", 64), 10)

    assert msg =~ "different bytes"

    assert {:error, cap} =
             Discovery.admit_file(t.leaseId, a, "readout.json", String.duplicate("d", 64), 200)

    assert cap =~ "storage cap"
    {:ok, _} = Discovery.finalize(t.leaseId, a, ok(canonical(t.caseId)))

    assert {:error, "attempt already completed"} =
             Discovery.admit_file(t.leaseId, a, "result.json", String.duplicate("a", 64), 1)
  end

  test "an admitted file becomes visible only once committed after publication" do
    a = qualified("mac")
    {:ok, t} = Discovery.next(a)
    sha = String.duplicate("e", 64)
    assert :ok = Discovery.admit_file(t.leaseId, a, "end.blck", sha, 10)

    files = fn ->
      hd(Enum.find(Discovery.campaign_index(@md).cases, &(&1.caseId == t.caseId)).attempts).files
    end

    assert files.() == %{}

    assert {:error, _} =
             Discovery.commit_file(t.leaseId, a, "end.blck", String.duplicate("f", 64))

    assert :ok = Discovery.commit_file(t.leaseId, a, "end.blck", sha)
    assert files.() == %{"end.blck" => sha}
  end

  test "the campaign wall-time cap stops new leases and bounds running ones" do
    stop_supervised!(Discovery)
    dir = Path.join(System.tmp_dir!(), "bl-discovery-wall-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)
    start_supervised!({Discovery, data_dir: dir, queue_data_dir: dir <> "-q", lease_ms: 60_000})
    register(%{"campaignWallSeconds" => 1})
    a = worker("mac")
    {:ok, q} = Discovery.next(a)
    assert q.remainingMs <= 1000
    {:ok, _} = Discovery.finalize(q.leaseId, a, ok(canonical(q.caseId)))
    Process.sleep(1100)
    assert {:ok, %{idle: true, reason: reason}} = Discovery.next(a)
    assert reason =~ "wall-time cap reached"
  end

  test "the acceptance rule matches the TypeScript decideCase" do
    v = fn role, host, c -> %{status: :valid, role: role, host: host, canonical: c} end
    assert Discovery.decide([]).decision == "missing"
    assert Discovery.decide([v.("primary", "a", 1)]).decision == "pending-replay"

    assert Discovery.decide([v.("primary", "a", 1), v.("replay", "a", 1)]).decision ==
             "pending-replay"

    assert Discovery.decide([v.("primary", "a", 1), v.("replay", "b", 1)]).decision == "accepted"

    assert Discovery.decide([v.("primary", "a", 1), v.("primary", "b", 1)]).decision ==
             "pending-replay"

    assert Discovery.decide([v.("primary", "a", 1), v.("replay", "b", 2)]).decision ==
             "quarantined"

    assert Discovery.decide([%{status: :rejected, role: "primary", host: "a", canonical: nil}]).decision ==
             "missing"
  end
end
