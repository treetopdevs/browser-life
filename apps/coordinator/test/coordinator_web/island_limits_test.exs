defmodule CoordinatorWeb.IslandLimitsTest do
  @moduledoc """
  The island routes' abuse controls over HTTP: the join budget per client
  address, the next budget per authenticated island, the coarse per-address
  ceiling, the join/next body limits (`Coordinator.IslandLimiter`,
  `CoordinatorWeb.IslandLimit`, `CoordinatorWeb.IslandBodyLimit`), the segment
  budget per island, the island-table bound's 503, the cached public status
  and CORS.
  """
  use CoordinatorWeb.ConnCase, async: false
  alias Coordinator.{IslandLimiter, Queue}

  @env [
    :island_joins_per_address,
    :island_next_per_island,
    :island_requests_per_address,
    :island_segment_requests_per_island,
    :max_islands,
    :public_status_cache_ms,
    :public_status_wait_ms,
    :trust_forwarded_for,
    :cors_origins,
    :admin_token
  ]

  setup do
    saved = for k <- @env, do: {k, Application.fetch_env(:coordinator, k)}
    dir = Path.join(System.tmp_dir!(), "bl-limits-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    IslandLimiter.reset()

    on_exit(fn ->
      IslandLimiter.reset()
      File.rm_rf!(dir)

      for {k, v} <- saved do
        case v do
          {:ok, val} -> Application.put_env(:coordinator, k, val)
          :error -> Application.delete_env(:coordinator, k)
        end
      end
    end)

    :ok
  end

  defp set(k, v), do: Application.put_env(:coordinator, k, v)
  defp from(conn, ip), do: %{conn | remote_ip: ip}
  defp authed(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)
  defp islands, do: length(Queue.status().islands)

  defp join(conn), do: post(conn, "/api/islands", %{"adapter" => "test"})

  defp joined(conn) do
    body = conn |> join() |> json_response(200)
    {body["id"], body["token"]}
  end

  defp next(conn, id, token),
    do: conn |> authed(token) |> post("/api/next?island=#{id}", %{})

  test "join past the budget answers 429 with Retry-After and retryAfterMs, and the island count is unchanged" do
    set(:island_joins_per_address, 2)
    ip = {203, 0, 113, 7}

    for _ <- 1..2, do: assert(build_conn() |> from(ip) |> join() |> json_response(200))
    assert islands() == 2

    c = build_conn() |> from(ip) |> join()
    assert %{"error" => _, "retryAfterMs" => ms} = json_response(c, 429)
    assert is_integer(ms) and ms > 0 and ms <= 3_600_000
    assert get_resp_header(c, "retry-after") == [Integer.to_string(div(ms + 999, 1000))]
    assert islands() == 2
  end

  test "another address keeps its own join budget" do
    set(:island_joins_per_address, 1)

    assert build_conn() |> from({203, 0, 113, 7}) |> join() |> json_response(200)
    assert build_conn() |> from({203, 0, 113, 7}) |> join() |> json_response(429)
    assert build_conn() |> from({198, 51, 100, 1}) |> join() |> json_response(200)
    assert islands() == 2
  end

  test "with trust_forwarded_for, the right-most X-Forwarded-For entry is the address; a client-written left entry does not escape; an unparsable right-most entry falls back to the peer" do
    set(:island_joins_per_address, 1)
    set(:trust_forwarded_for, true)
    proxy = {172, 18, 0, 3}
    xff = fn v -> build_conn() |> from(proxy) |> put_req_header("x-forwarded-for", v) end

    assert xff.("203.0.113.7") |> join() |> json_response(200)
    # The client writes a fresh left entry each time; the proxy's own entry is the same.
    assert xff.("1.1.1.1, 203.0.113.7") |> join() |> json_response(429)
    assert xff.("2.2.2.2,203.0.113.7") |> join() |> json_response(429)
    # A different client behind the same proxy has its own budget.
    assert xff.("198.51.100.1") |> join() |> json_response(200)
    # Garbage on the right: the peer (the proxy) is the address, once.
    assert xff.("203.0.113.9, not-an-ip") |> join() |> json_response(200)
    assert build_conn() |> from(proxy) |> join() |> json_response(429)
  end

  test "without trust_forwarded_for, X-Forwarded-For is ignored" do
    set(:island_joins_per_address, 1)
    set(:trust_forwarded_for, false)
    peer = {172, 18, 0, 3}

    assert build_conn()
           |> from(peer)
           |> put_req_header("x-forwarded-for", "203.0.113.7")
           |> join()
           |> json_response(200)

    assert build_conn()
           |> from(peer)
           |> put_req_header("x-forwarded-for", "198.51.100.1")
           |> join()
           |> json_response(429)
  end

  test "next past the per-island budget answers 429; another island is unaffected; a 401 charges nothing" do
    {a, a_token} = joined(build_conn())
    {b, b_token} = joined(build_conn())
    set(:island_next_per_island, 2)

    # Failed authentication first: these must not use a's budget.
    for _ <- 1..5, do: assert(build_conn() |> next(a, "wrong") |> json_response(401))

    assert %{"kind" => "idle"} = build_conn() |> next(a, a_token) |> json_response(200)
    assert %{"kind" => "idle"} = build_conn() |> next(a, a_token) |> json_response(200)

    c = build_conn() |> next(a, a_token)
    assert %{"error" => _, "retryAfterMs" => ms} = json_response(c, 429)
    assert ms > 0 and ms <= 60_000
    assert [_] = get_resp_header(c, "retry-after")

    assert %{"kind" => "idle"} = build_conn() |> next(b, b_token) |> json_response(200)
  end

  test "the coarse per-address ceiling is off by default and applies when set" do
    {id, token} = joined(build_conn())
    ip = {203, 0, 113, 7}

    for _ <- 1..10,
        do:
          assert(
            build_conn()
            |> from(ip)
            |> authed(token)
            |> get("/api/islands/me?island=#{id}")
            |> json_response(200)
          )

    set(:island_requests_per_address, 3)
    IslandLimiter.reset()

    for _ <- 1..3,
        do:
          assert(
            build_conn()
            |> from(ip)
            |> authed(token)
            |> get("/api/islands/me?island=#{id}")
            |> json_response(200)
          )

    assert %{"retryAfterMs" => _} =
             build_conn()
             |> from(ip)
             |> authed(token)
             |> get("/api/islands/me?island=#{id}")
             |> json_response(429)

    # It covers join too, and charges before authentication.
    assert build_conn() |> from(ip) |> join() |> json_response(429)
    assert build_conn() |> from({198, 51, 100, 1}) |> join() |> json_response(200)
  end

  test "join and next bodies over 16 KB are 413; a form body is 415" do
    {id, token} = joined(build_conn())
    big = Jason.encode!(%{"adapter" => String.duplicate("a", 17_000)})
    json = fn c -> put_req_header(c, "content-type", "application/json") end

    assert_error_sent 413, fn -> build_conn() |> json.() |> post("/api/islands", big) end
    # The same path, percent-encoded, is the same route.
    assert_error_sent 413, fn -> build_conn() |> json.() |> post("/api/isl%61nds", big) end
    # A malformed escape is not a crash: `URI.decode/1` (here, in the letter
    # plug and in the router) leaves it as written, so the path is just unknown.
    for path <- ["/api/%zz", "/api/isl%zznds", "/api/public/garden/%zz", "/elsewhere/%"] do
      assert build_conn() |> json.() |> post(path, "{}") |> response(404)
    end

    assert_error_sent 413, fn ->
      build_conn() |> json.() |> authed(token) |> post("/api/next?island=#{id}", big)
    end

    form = "adapter=test&pad=" <> String.duplicate("a", 100)

    assert_error_sent 415, fn ->
      build_conn()
      |> put_req_header("content-type", "application/x-www-form-urlencoded")
      |> post("/api/islands", form)
    end

    assert_error_sent 415, fn ->
      build_conn()
      |> put_req_header("content-type", "text/plain")
      |> authed(token)
      |> post("/api/next?island=#{id}", "hi")
    end

    # No content type is not a way round the limit: the body is read up to it
    # and refused past it. (Phoenix.ConnTest insists on a content type for a
    # body, so these go through Plug.Test and the endpoint directly.)
    untyped = fn path, body, headers ->
      conn =
        Enum.reduce(headers, Plug.Test.conn(:post, path, body), fn {k, v}, c ->
          put_req_header(c, k, v)
        end)

      @endpoint.call(conn, @endpoint.init([]))
    end

    assert_error_sent 413, fn -> untyped.("/api/islands", big, []) end

    assert_error_sent 413, fn ->
      untyped.("/api/next?island=#{id}", big, [{"authorization", "Bearer " <> token}])
    end

    # Within it, an untyped body is read and dropped: the join still works,
    # with empty params, as it did before.
    assert %{"id" => _} = untyped.("/api/islands", "hello", []) |> json_response(200)

    # A small JSON body is fine, and so is no body at all (an older island).
    assert build_conn()
           |> json.()
           |> post("/api/islands", Jason.encode!(%{"adapter" => "test"}))
           |> json_response(200)

    assert build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
  end

  test "a CORS preflight on the join route answers 204 for an allowed origin and echoes nothing for others" do
    set(:cors_origins, ["https://lab.example"])

    acao = fn origin ->
      c = build_conn() |> put_req_header("origin", origin) |> options("/api/islands")
      assert c.status == 204
      get_resp_header(c, "access-control-allow-origin")
    end

    c = build_conn() |> put_req_header("origin", "https://lab.example") |> options("/api/islands")
    assert c.status == 204
    assert get_resp_header(c, "access-control-allow-origin") == ["https://lab.example"]
    assert get_resp_header(c, "vary") == ["origin"]

    # Exact match only: no prefix, suffix, scheme, port, case or slash variant.
    for origin <- [
          "https://evil.example",
          "null",
          "https://lab.example/",
          "https://lab.example.evil.example",
          "https://evil-lab.example",
          "https://xlab.example",
          "http://lab.example",
          "https://lab.example:8443",
          "HTTPS://LAB.EXAMPLE"
        ],
        do: assert(acao.(origin) == [], origin)

    # Production's default: nobody.
    set(:cors_origins, [])
    assert acao.("https://lab.example") == []
    assert acao.("https://cadence.garden") == []
  end

  test "segment routes past the per-island budget answer 429; a 401 charges nothing; another island is unaffected" do
    {a, a_token} = joined(build_conn())
    {b, b_token} = joined(build_conn())
    set(:island_segment_requests_per_island, 2)

    beat = fn id, token ->
      build_conn()
      |> authed(token)
      |> post("/api/segments/seg-none/heartbeat?island=#{id}", %{"lease" => "x"})
    end

    for _ <- 1..5, do: assert(beat.(a, "wrong").status == 401)
    # Unknown segment: answered (not 429) and charged.
    for _ <- 1..2, do: refute(beat.(a, a_token).status == 429)

    c = beat.(a, a_token)
    assert %{"error" => _, "retryAfterMs" => _} = json_response(c, 429)
    assert [_] = get_resp_header(c, "retry-after")

    c =
      build_conn()
      |> authed(a_token)
      |> post("/api/segments/seg-none/complete?island=#{a}", %{"lease" => "x"})

    assert c.status == 429
    refute beat.(b, b_token).status == 429
  end

  test "the coarse ceiling covers every island route but file downloads" do
    {id, token} = joined(build_conn())
    set(:island_requests_per_address, 1)
    ip = {203, 0, 113, 7}
    q = "?island=#{id}"

    routes = [
      {:post, "/api/islands"},
      {:get, "/api/islands/me" <> q},
      {:post, "/api/next" <> q},
      {:post, "/api/segments/seg-none/heartbeat" <> q},
      {:post, "/api/segments/seg-none/complete" <> q},
      {:post, "/api/segments/seg-none/reject" <> q},
      {:post, "/api/segments/seg-none/fail" <> q},
      {:put, "/api/segments/seg-none/checkpoint" <> q},
      {:put, "/api/segments/seg-none/files/series.jsonl" <> q},
      {:get, "/api/segments/seg-none/start" <> q}
    ]

    hit = fn {method, path} ->
      build_conn() |> from(ip) |> authed(token) |> dispatch(@endpoint, method, path, nil)
    end

    for route <- routes do
      IslandLimiter.reset()
      refute hit.(route).status == 429, inspect(route)
      assert hit.(route).status == 429, inspect(route)
    end

    IslandLimiter.reset()
    get_file = {:get, "/api/segments/seg-none/files/series.jsonl" <> q}
    for _ <- 1..5, do: refute(hit.(get_file).status == 429)
  end

  test "an island's file downloads are charged to its segment budget; the administrator's are not" do
    {id, token} = joined(build_conn())
    set(:admin_token, "test-admin")
    set(:island_segment_requests_per_island, 2)
    path = "/api/segments/seg-none/files/series.jsonl?island=#{id}"

    download = fn bearer ->
      build_conn() |> from({203, 0, 113, 9}) |> authed(bearer) |> get(path)
    end

    for _ <- 1..2, do: refute(download.(token).status == 429)
    c = download.(token)
    assert %{"retryAfterMs" => _} = json_response(c, 429)

    # One budget: the island's other segment requests are over it too.
    assert build_conn()
           |> authed(token)
           |> post("/api/segments/seg-none/heartbeat?island=#{id}", %{"lease" => "x"})
           |> Map.fetch!(:status) == 429

    # A wrong token is a 401 and charges nothing; the administrator is never charged.
    assert download.("wrong").status == 401
    for _ <- 1..5, do: refute(download.("test-admin").status == 429)
  end

  test "a join when every island did work or holds an attempt answers 503 and adds no island" do
    {:ok, 3} =
      Queue.create_experiment(%{
        "experiment" => "t1",
        "presetId" => "spots",
        "conditions" => ["treatment"],
        "seeds" => [1],
        "steps" => 1500,
        "segmentSteps" => 500,
        "censusEvery" => 100,
        "verifyFraction" => 1.0
      })

    {id, token} = joined(build_conn())
    assert %{"kind" => "run"} = build_conn() |> next(id, token) |> json_response(200)
    set(:max_islands, 1)

    assert %{"error" => "the coordinator has no room for new islands"} =
             build_conn() |> join() |> json_response(503)

    assert islands() == 1
  end

  test "me answers 401, not a crash, for an island forgotten after it authenticated" do
    assert %{"error" => _} =
             build_conn()
             |> Plug.Conn.assign(:island, "isl-forgotten")
             |> CoordinatorWeb.ApiController.me(%{})
             |> json_response(401)
  end

  test "public status over HTTP is served from the cache within its ttl" do
    set(:public_status_cache_ms, 60_000)
    IslandLimiter.reset()

    first = build_conn() |> get("/api/public/status") |> json_response(200)
    _ = joined(build_conn())
    second = build_conn() |> get("/api/public/status") |> json_response(200)
    assert second == first

    IslandLimiter.reset()
    third = build_conn() |> get("/api/public/status") |> json_response(200)
    assert Map.keys(third) |> Enum.sort() == ~w(activeIslands counts deviceTypes updatedAt)
    assert third["activeIslands"] == first["activeIslands"] + 1
  end

  test "public status over HTTP: a cold cache behind a slow Queue answers 503 with Retry-After, not a second Queue call" do
    set(:public_status_cache_ms, 60_000)
    set(:public_status_wait_ms, 50)
    events_before = Coordinator.OperatorEvents.snapshot()
    IslandLimiter.reset()
    :sys.suspend(Queue)

    try do
      # The first reader owns the refresh and waits on the (suspended) Queue.
      owner = Task.async(fn -> build_conn() |> get("/api/public/status") end)
      wait_until(fn -> :ets.member(:coordinator_island_limits, {:refresh, :public_status}) end)

      c = build_conn() |> get("/api/public/status")
      assert %{"error" => _} = json_response(c, 503)
      assert get_resp_header(c, "retry-after") == ["1"]
      assert get_resp_header(c, "cache-control") == ["no-store"]
      assert Coordinator.OperatorEvents.snapshot() == events_before

      :sys.resume(Queue)
      assert %{"counts" => _} = owner |> Task.await(30_000) |> json_response(200)
    after
      # Harmless if already resumed.
      :sys.resume(Queue)
    end
  end

  defp wait_until(f, tries \\ 3_000) do
    cond do
      f.() -> :ok
      tries == 0 -> flunk("timed out waiting")
      true -> Process.sleep(10) && wait_until(f, tries - 1)
    end
  end
end
