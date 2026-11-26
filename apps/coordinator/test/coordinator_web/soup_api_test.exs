defmodule CoordinatorWeb.SoupApiTest do
  # The shared soup over HTTP, with fake islands: Elixir computes no soups, so
  # an "honest" island uploads fixed bytes under a valid header and a verifier
  # reports the hash it would have computed.
  use CoordinatorWeb.ConnCase, async: false
  alias Coordinator.{Queue, Soup}
  @moduletag :capture_log

  @world %{
    "name" => "web",
    "seed" => 5,
    "width" => 4,
    "height" => 4,
    "epochsPerSegment" => 8,
    "segments" => 3,
    "verifyEvery" => 2
  }

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-soup-api-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir <> "-queue"})
    start_supervised!({Soup, data_dir: dir, queue_data_dir: dir <> "-queue", lease_ms: 60_000})

    on_exit(fn ->
      File.rm_rf!(dir)
      File.rm_rf!(dir <> "-queue")
    end)

    %{dir: dir}
  end

  defp join do
    body = build_conn() |> post("/api/islands", %{"adapter" => "test"}) |> json_response(200)
    %{id: body["id"], token: body["token"]}
  end

  defp authed(conn, i), do: put_req_header(conn, "authorization", "Bearer " <> i.token)

  defp next(i),
    do: build_conn() |> authed(i) |> post("/api/soup/next?island=#{i.id}") |> json_response(200)

  defp put_snapshot(i, t, bin) do
    build_conn()
    |> authed(i)
    |> put_req_header("content-type", "application/octet-stream")
    |> put("/api/soup/segments/#{t["segment"]}/snapshot?island=#{i.id}&lease=#{t["lease"]}", bin)
  end

  defp complete(i, t, sha) do
    build_conn()
    |> authed(i)
    |> post("/api/soup/segments/#{t["segment"]}/complete?island=#{i.id}", %{
      "lease" => t["lease"],
      "sha" => sha
    })
  end

  defp world, do: hd(Soup.status().worlds)

  # A snapshot with a valid header for task `t`'s end; the program bytes are `fill`.
  defp snapshot(t, fill) do
    p = t["params"]

    <<"BLSOUP\0\0", 1::little-32, p["seed"]::little-32, p["num"]::little-32,
      p["width"]::little-32, p["height"]::little-32, p["radius"]::little-32,
      p["mutation"]::little-32, 0::little-32, t["endEpoch"]::little-64, 0::128>> <>
      :binary.copy(<<fill>>, p["num"] * 64)
  end

  defp sha(bin), do: :crypto.hash(:sha256, bin) |> Base.encode16(case: :lower)

  # A run task end to end: upload, then complete with the upload's hash.
  defp run(i, fill) do
    t = next(i)
    assert t["kind"] == "run"
    bin = snapshot(t, fill)
    assert %{"sha" => s} = put_snapshot(i, t, bin) |> json_response(200)
    assert s == sha(bin)
    assert %{"status" => "done"} = complete(i, t, s) |> json_response(200)
    {t, bin}
  end

  test "registration and status need the admin; island routes need an island" do
    saved = Application.get_env(:coordinator, :admin_token)
    Application.put_env(:coordinator, :admin_token, "soup-admin")

    on_exit(fn ->
      if saved,
        do: Application.put_env(:coordinator, :admin_token, saved),
        else: Application.delete_env(:coordinator, :admin_token)
    end)

    assert build_conn() |> post("/api/soup/worlds", @world) |> json_response(401)
    assert build_conn() |> get("/api/soup/status") |> json_response(401)

    admin = build_conn() |> put_req_header("authorization", "Bearer soup-admin")

    assert %{"status" => "registered"} =
             admin |> post("/api/soup/worlds", @world) |> json_response(200)

    assert %{"error" => _} =
             build_conn()
             |> put_req_header("authorization", "Bearer soup-admin")
             |> post("/api/soup/worlds", %{@world | "seed" => 6})
             |> json_response(422)

    assert build_conn() |> post("/api/soup/next?island=nobody") |> json_response(401)
    i = join()
    assert build_conn() |> post("/api/soup/next?island=#{i.id}") |> json_response(401)
    assert next(i)["kind"] == "run"
    assert build_conn() |> get("/api/soup/segments/web.0/snapshot") |> json_response(401)
  end

  test "two islands run and verify a chain over HTTP; the start and end snapshots are served" do
    assert %{"status" => "registered"} =
             build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)

    a = join()
    b = join()

    {t0, bin0} = run(a, 1)
    assert t0["segment"] == "web.0" and t0["start"] == nil and t0["startEpoch"] == 0

    # "a" is offered segment 1 and fetches its start: segment 0's snapshot.
    t1 = next(a)
    assert t1["kind"] == "run" and t1["startSha"] == sha(bin0)
    start = build_conn() |> authed(a) |> get(t1["start"] <> "?island=#{a.id}")
    assert start.status == 200 and start.resp_body == bin0

    # "b" verifies segment 0 (it uploads nothing) and matches.
    v0 = next(b)
    assert {v0["kind"], v0["segment"]} == {"verify", "web.0"}
    assert put_snapshot(b, v0, bin0) |> json_response(409)
    assert %{"status" => "verified"} = complete(b, v0, sha(bin0)) |> json_response(200)

    bin1 = snapshot(t1, 2)
    assert put_snapshot(a, t1, bin1) |> json_response(200)
    assert %{"status" => "done"} = complete(a, t1, sha(bin1)) |> json_response(200)
    {_t2, bin2} = run(b, 3)
    v2 = next(a)
    assert {v2["kind"], v2["segment"]} == {"verify", "web.2"}
    assert %{"status" => "verified"} = complete(a, v2, sha(bin2)) |> json_response(200)

    assert %{"idle" => true, "finished" => true} = next(b)
    status = build_conn() |> get("/api/soup/status") |> json_response(200)
    [w] = status["worlds"]
    assert Enum.map(w["chain"], & &1["status"]) == ~w(verified done verified)
    assert w["head"] == %{"index" => 2, "sha" => sha(bin2)}

    last = build_conn() |> get("/api/soup/segments/web.2/snapshot")
    assert last.status == 200 and last.resp_body == bin2

    # A snapshot gone from the store is a 404, not a crash.
    File.rm!(Coordinator.Store.blob_path(Soup.data_dir(), sha(bin2)))
    assert build_conn() |> get("/api/soup/segments/web.2/snapshot") |> json_response(404)
  end

  test "an upload must match the segment's header, size and lease" do
    build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)
    a = join()
    b = join()
    t = next(a)

    assert %{"error" => "snapshot header does not match the segment: epoch"} =
             put_snapshot(a, t, snapshot(%{t | "endEpoch" => 7}, 0)) |> json_response(409)

    assert %{"error" => "snapshot header does not match the segment: seed"} =
             put_snapshot(a, t, snapshot(put_in(t["params"]["seed"], 9), 0)) |> json_response(409)

    assert %{"error" => "body too large"} =
             put_snapshot(a, t, snapshot(t, 0) <> <<0>>) |> json_response(409)

    assert %{"error" => "snapshot is " <> _} =
             put_snapshot(a, t, binary_part(snapshot(t, 0), 0, 100)) |> json_response(409)

    assert %{"error" => "lease is not current"} =
             put_snapshot(b, t, snapshot(t, 0)) |> json_response(409)

    assert %{"error" => "no snapshot uploaded on this lease"} =
             complete(a, t, String.duplicate("a", 64)) |> json_response(409)

    assert complete(a, t, "nothex") |> json_response(422)
    # Nothing refused reached the store.
    refute File.exists?(Path.join(Soup.data_dir(), "files"))
    assert Path.wildcard(Path.join([Soup.data_dir(), "tmp", "*"])) == []
  end

  test "a lying runner is caught by the verifier and later segments are blocked" do
    build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)
    a = join()
    b = join()
    run(a, 1)
    t1 = next(a)
    v0 = next(b)
    # The honest replay disagrees with what "a" uploaded.
    assert %{"status" => "diverged"} = complete(b, v0, sha(snapshot(v0, 9))) |> json_response(200)
    assert complete(a, t1, String.duplicate("0", 64)) |> json_response(409)

    assert build_conn()
           |> authed(a)
           |> get(t1["start"] <> "?island=#{a.id}")
           |> json_response(404)

    assert %{"idle" => true, "finished" => true} = next(a)
    assert world()["counts"] == %{"diverged" => 1, "blocked" => 2}
  end

  defp with_env(pairs) do
    saved = for {k, _} <- pairs, do: {k, Application.fetch_env(:coordinator, k)}
    for {k, v} <- pairs, do: Application.put_env(:coordinator, k, v)

    on_exit(fn ->
      for {k, v} <- saved do
        case v do
          {:ok, val} -> Application.put_env(:coordinator, k, val)
          :error -> Application.delete_env(:coordinator, k)
        end
      end
    end)
  end

  test "soup work keeps an island seen, so the island bound forgets an idle one instead" do
    Coordinator.TestClock.install(10_000_000)
    on_exit(&Coordinator.TestClock.uninstall/0)
    with_env(max_islands: 2, island_prune_after_ms: 86_400_000, island_prune_grace_ms: 600_000)
    build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)

    # "a" joins first, so without soup activity it would be the oldest.
    a = join()
    Coordinator.TestClock.advance(1)
    b = join()
    Coordinator.TestClock.advance(700_000)
    assert next(a)["kind"] == "run"

    # The table is full: a third join forgets the island not seen within the grace.
    _c = join()
    # "a" still holds segment 0, so it is idle, but still known.
    assert next(a)["idle"]

    assert build_conn()
           |> authed(b)
           |> post("/api/soup/next?island=#{b.id}")
           |> json_response(401)
  end

  # A full island table (2), a soup lease of an hour and a fake clock: "a"
  # joins and takes a lease, then "b" joins, so "a" is the least recently seen.
  defp lease_holder_setup(dir) do
    Coordinator.TestClock.install(10_000_000)
    on_exit(&Coordinator.TestClock.uninstall/0)
    with_env(max_islands: 2, island_prune_after_ms: 86_400_000, island_prune_grace_ms: 600_000)
    stop_supervised!(Soup)
    start_supervised!(soup_spec(dir, 3_600_000))
    build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)
    a = join()
    assert next(a)["kind"] == "run"
    Coordinator.TestClock.advance(1)
    b = join()
    {a, b}
  end

  defp soup_spec(dir, lease_ms),
    do: {Soup, data_dir: dir, queue_data_dir: dir <> "-queue", lease_ms: lease_ms}

  defp refused?(i),
    do:
      build_conn() |> authed(i) |> post("/api/soup/next?island=#{i.id}") |> Map.get(:status) ==
        401

  test "a lease holder past the prune grace but within its lease is not pruned", %{dir: dir} do
    {a, b} = lease_holder_setup(dir)
    # Past the grace, well within the lease; "a" has not been seen since its next.
    Coordinator.TestClock.advance(700_000)
    _c = join()
    refute refused?(a)
    assert refused?(b)
  end

  test "after a restart, the soup holds its lease holders again, even if the queue lost the hold",
       %{dir: dir} do
    {a, b} = lease_holder_setup(dir)
    stop_supervised!(Soup)
    stop_supervised!(Queue)

    # The queue's state without any hold (as if it had not been written yet).
    path = Path.join(dir <> "-queue", "state.bin")
    st = path |> File.read!() |> :erlang.binary_to_term()
    st = update_in(st.islands, &Map.new(&1, fn {id, i} -> {id, Map.delete(i, :held_until)} end))
    File.write!(path, :erlang.term_to_binary(st))

    start_supervised!({Queue, data_dir: dir <> "-queue"})
    start_supervised!(soup_spec(dir, 3_600_000))
    Coordinator.TestClock.advance(700_000)
    _c = join()
    refute refused?(a)
    assert refused?(b)
  end

  test "an island pruned before it asks is refused and granted no lease" do
    Coordinator.TestClock.install(10_000_000)
    on_exit(&Coordinator.TestClock.uninstall/0)
    with_env(max_islands: 2, island_prune_after_ms: 86_400_000, island_prune_grace_ms: 600_000)
    build_conn() |> post("/api/soup/worlds", @world) |> json_response(200)
    a = join()
    Coordinator.TestClock.advance(1)
    _b = join()
    Coordinator.TestClock.advance(700_000)
    _c = join()

    assert :error = Queue.authenticate_and_hold(a.id, a.token, Coordinator.Clock.now() + 1000)
    assert :error = Queue.hold(a.id, Coordinator.Clock.now() + 1000)
    assert refused?(a)
    assert Enum.all?(world()["chain"], &is_nil(&1.lease))
  end

  test "an island's snapshot download is charged to its segment budget; the administrator's is not" do
    # Every test conn is loopback: with local administration on, an island would count as the admin.
    with_env(
      island_segment_requests_per_island: 1,
      island_segment_window_ms: 3_600_000,
      allow_local_admin: false,
      admin_token: "soup-admin"
    )

    admin = fn -> build_conn() |> put_req_header("authorization", "Bearer soup-admin") end
    admin.() |> post("/api/soup/worlds", @world) |> json_response(200)
    a = join()
    get_snap = fn conn -> get(conn, "/api/soup/segments/web.0/snapshot?island=#{a.id}") end

    assert build_conn() |> authed(a) |> get_snap.() |> json_response(404)
    assert build_conn() |> authed(a) |> get_snap.() |> json_response(429)

    for _ <- 1..3,
        do: assert(admin.() |> get("/api/soup/segments/web.0/snapshot") |> json_response(404))
  end
end
