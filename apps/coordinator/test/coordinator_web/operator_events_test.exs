defmodule CoordinatorWeb.OperatorEventsTest do
  use CoordinatorWeb.ConnCase, async: false
  alias Coordinator.{IslandLimiter, OperatorEvents, Queue}
  import CoordinatorWeb.GardenHelpers, only: [snapshot_env: 1, restore_env: 1]

  @env ~w(admin_token allow_local_admin max_islands island_joins_per_address island_next_per_island island_segment_requests_per_island island_requests_per_address)a
  setup do
    saved = snapshot_env(@env)
    dir = Path.join(System.tmp_dir!(), "bl-events-#{System.unique_integer([:positive])}")

    on_exit(fn ->
      restore_env(saved)

      for child <- [OperatorEvents, IslandLimiter] do
        case Supervisor.restart_child(Coordinator.Supervisor, child) do
          {:ok, _} -> :ok
          {:error, :running} -> :ok
        end
      end

      IslandLimiter.reset()
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    :ok = Supervisor.terminate_child(Coordinator.Supervisor, OperatorEvents)
    {:ok, _} = Supervisor.restart_child(Coordinator.Supervisor, OperatorEvents)
    IslandLimiter.reset()

    for k <- [
          :island_joins_per_address,
          :island_next_per_island,
          :island_segment_requests_per_island,
          :island_requests_per_address
        ],
        do: set(k, nil)

    :ok
  end

  defp set(k, v), do: Application.put_env(:coordinator, k, v)
  defp join, do: post(build_conn(), "/api/islands", %{"adapter" => "test"})
  defp auth(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  test "zero counters are admin-only and contain an ISO epoch" do
    set(:admin_token, "test-admin")
    set(:allow_local_admin, false)
    assert build_conn() |> get("/api/status") |> json_response(401)

    refute build_conn()
           |> get("/api/public/status")
           |> json_response(200)
           |> Map.has_key?("operatorEvents")

    events =
      build_conn()
      |> auth("test-admin")
      |> get("/api/status")
      |> json_response(200)
      |> Map.fetch!("operatorEvents")

    assert {:ok, _, 0} = DateTime.from_iso8601(events["since"])

    assert Map.delete(events, "since") == %{
             "rateRefusals" => %{"join" => 0, "next" => 0, "segment" => 0, "requests" => 0},
             "capacityRefusals" => 0,
             "prunedIslands" => 0
           }
  end

  test "concurrent HTTP refusals count once; coarse refusal does not double-charge join" do
    set(:island_joins_per_address, 1)
    assert join().status == 200

    1..40
    |> Task.async_stream(fn _ -> join().status end, max_concurrency: 20)
    |> Enum.each(fn result -> assert result == {:ok, 429} end)

    assert OperatorEvents.snapshot().rateRefusals.join == 40
    set(:island_requests_per_address, 1)
    assert join().status == 429
    assert join().status == 429
    assert OperatorEvents.snapshot().rateRefusals == %{join: 41, next: 0, segment: 0, requests: 1}
    assert OperatorEvents.snapshot().capacityRefusals == 0
  end

  test "next and segment decisions count; unauthorized requests do not" do
    %{"id" => id, "token" => token} = join() |> json_response(200)
    set(:island_next_per_island, 1)
    set(:island_segment_requests_per_island, 1)

    for _ <- 1..2 do
      build_conn() |> auth(token) |> post("/api/next?island=#{id}", %{})
      build_conn() |> auth(token) |> post("/api/segments/missing/heartbeat?island=#{id}", %{})
    end

    assert build_conn() |> post("/api/next?island=#{id}", %{}) |> json_response(401)

    assert build_conn()
           |> post("/api/segments/missing/heartbeat?island=#{id}", %{})
           |> json_response(401)

    assert OperatorEvents.snapshot().rateRefusals == %{join: 0, next: 1, segment: 1, requests: 0}
  end

  test "island download refusals count but administrator and unauthorized downloads do not" do
    %{"id" => id, "token" => token} = join() |> json_response(200)
    set(:admin_token, "test-admin")
    set(:allow_local_admin, false)
    set(:island_segment_requests_per_island, 1)
    path = "/api/segments/missing/files/series.jsonl?island=#{id}"
    assert build_conn() |> auth(token) |> get(path) |> json_response(404)
    assert build_conn() |> auth(token) |> get(path) |> json_response(429)
    before = OperatorEvents.snapshot()
    assert before.rateRefusals.segment == 1
    assert build_conn() |> get(path) |> json_response(401)
    assert build_conn() |> auth("wrong") |> get(path) |> json_response(401)

    for _ <- 1..3 do
      assert build_conn() |> auth("test-admin") |> get(path) |> json_response(404)
    end

    assert OperatorEvents.snapshot() == before
  end

  test "failed persistence does not count candidate pruning" do
    set(:max_islands, 1)
    assert join().status == 200

    :sys.replace_state(Queue, fn s ->
      %{s | islands: Map.new(s.islands, fn {id, i} -> {id, %{i | last_seen: 0}} end)}
    end)

    # A directory at the temporary write path forces persist/1 to fail,
    # even under privileged test users. The last successful state.bin survives.
    blocked_path = Path.join(:sys.get_state(Queue).dir, "state.bin.tmp")
    File.mkdir!(blocked_path)
    before = OperatorEvents.snapshot()

    ExUnit.CaptureLog.capture_log(fn ->
      assert catch_exit(Queue.join(%{"adapter" => "test"}))
    end)

    assert OperatorEvents.snapshot() == before
    File.rmdir!(blocked_path)
  end

  test "capacity rejection preserves islands; successful join counts exactly removed islands" do
    set(:max_islands, 2)
    assert join().status == 200
    assert join().status == 200
    original = :sys.get_state(Queue).islands
    assert join().status == 503
    assert :sys.get_state(Queue).islands == original
    assert OperatorEvents.snapshot().capacityRefusals == 1
    assert OperatorEvents.snapshot().prunedIslands == 0

    :sys.replace_state(Queue, fn s ->
      %{s | islands: Map.new(s.islands, fn {id, i} -> {id, %{i | last_seen: 0}} end)}
    end)

    assert join().status == 200
    assert length(Queue.status().islands) == 1
    assert OperatorEvents.snapshot().prunedIslands == 2
    assert join().status == 200
    assert OperatorEvents.snapshot().prunedIslands == 2
  end

  test "owner restart resets epoch; limiter restart does not; unavailable counters cannot fail traffic" do
    OperatorEvents.rate_refusal(:join)
    before = OperatorEvents.snapshot()
    :ok = Supervisor.terminate_child(Coordinator.Supervisor, IslandLimiter)
    {:ok, _} = Supervisor.restart_child(Coordinator.Supervisor, IslandLimiter)
    assert OperatorEvents.snapshot() == before
    queue_dir = :sys.get_state(Queue).dir
    stop_supervised!(Queue)
    start_supervised!({Queue, data_dir: queue_dir})
    assert OperatorEvents.snapshot() == before
    :ok = Supervisor.terminate_child(Coordinator.Supervisor, OperatorEvents)
    assert OperatorEvents.snapshot() == nil
    assert OperatorEvents.rate_refusal(:next) == :ok
    assert join().status == 200
    set(:admin_token, "test-admin")
    set(:allow_local_admin, false)
    status = build_conn() |> auth("test-admin") |> get("/api/status") |> json_response(200)
    assert Map.has_key?(status, "operatorEvents")
    assert status["operatorEvents"] == nil
    set(:island_joins_per_address, 1)
    assert join() |> json_response(200)
    assert join() |> json_response(429)
    set(:island_joins_per_address, nil)
    set(:max_islands, 2)
    assert join() |> json_response(503)
    {:ok, _} = Supervisor.restart_child(Coordinator.Supervisor, OperatorEvents)
    after_restart = OperatorEvents.snapshot()
    refute after_restart.since == before.since
    assert after_restart.rateRefusals.join == 0
    assert after_restart.prunedIslands == 0
    assert after_restart.capacityRefusals == 0
  end
end
