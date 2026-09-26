defmodule CoordinatorWeb.ApiControllerTest do
  use CoordinatorWeb.ConnCase, async: false
  alias Coordinator.Queue

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-api-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    on_exit(fn -> File.rm_rf!(dir) end)
    :ok
  end

  @spec_ok %{
    "experiment" => "api",
    "presetId" => "spots",
    "conditions" => ["treatment"],
    "seeds" => [1],
    "steps" => 1000,
    "segmentSteps" => 500,
    "censusEvery" => 100
  }

  defp join(conn) do
    body = conn |> post("/api/islands", %{"adapter" => "test"}) |> json_response(200)
    {body["id"], body["token"]}
  end

  defp authed(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  test "island routes require the private token", %{conn: conn} do
    {id, token} = join(conn)
    assert %{"error" => _} = build_conn() |> post("/api/next?island=#{id}") |> json_response(401)
    assert build_conn() |> authed("wrong") |> post("/api/next?island=#{id}") |> json_response(401)

    assert %{"kind" => "idle"} =
             build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)

    refute Enum.any?(Queue.status().islands, &Map.has_key?(&1, :token))
  end

  # `/api/islands/me` is the probe an auto-rejoining island uses to check a
  # remembered identity before reusing it -- it must be a plain read (same
  # 401-on-bad-auth behavior as every other island route), never leak the
  # token/token_hash, and -- unlike `/api/next` -- never claim a task or
  # touch the island's `last_seen`, since it's meant to be safe to call
  # speculatively (possibly repeatedly, with retries) without consequence.
  # Work exists *before* probing so a bug that claims it would be caught.
  test "GET /api/islands/me is a side-effect-free identity check", %{conn: conn} do
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {id, token} = join(conn)
    :sys.replace_state(Queue, &put_in(&1, [:islands, id, :last_seen], 0))

    assert build_conn() |> get("/api/islands/me?island=#{id}") |> json_response(401)

    assert build_conn()
           |> authed("wrong")
           |> get("/api/islands/me?island=#{id}")
           |> json_response(401)

    me =
      build_conn() |> authed(token) |> get("/api/islands/me?island=#{id}") |> json_response(200)

    assert me["id"] == id
    assert me["adapter"] == "test"
    refute Map.has_key?(me, "token")
    refute Map.has_key?(me, "token_hash")

    # last_seen is untouched by any of the calls above (all four, including
    # the two 401s) ...
    assert Queue.island_info(id).last_seen == 0

    # ... and the pending segment created above is still there for /api/next
    # to hand out -- the probe did not claim it.
    assert %{"kind" => "run"} =
             build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
  end

  test "without a token, local administration must be explicitly enabled", %{conn: conn} do
    Application.put_env(:coordinator, :allow_local_admin, false)
    on_exit(fn -> Application.put_env(:coordinator, :allow_local_admin, true) end)
    assert conn |> post("/api/experiments", @spec_ok) |> json_response(401)
  end

  test "admin token gates experiment creation when configured", %{conn: conn} do
    assert %{"segments" => 2} = conn |> post("/api/experiments", @spec_ok) |> json_response(200)
    Application.put_env(:coordinator, :admin_token, "s3cret")
    on_exit(fn -> Application.put_env(:coordinator, :admin_token, nil) end)

    assert build_conn()
           |> post("/api/experiments", %{@spec_ok | "experiment" => "b"})
           |> json_response(401)

    assert build_conn()
           |> authed("s3cret")
           |> post("/api/experiments", %{@spec_ok | "experiment" => "b"})
           |> json_response(200)
  end

  test "uploads need the current lease and a valid checkpoint", %{conn: conn} do
    conn |> post("/api/experiments", @spec_ok) |> json_response(200)
    {id, token} = join(conn)
    task = build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
    seg = task["segment"]["id"]

    put = fn path, body ->
      build_conn()
      |> authed(token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put(path, body)
    end

    assert %{"error" => "invalid checkpoint" <> _} =
             put.(
               "/api/segments/#{seg}/checkpoint?island=#{id}&lease=#{task["lease"]}",
               "garbage"
             )
             |> json_response(409)

    assert %{"error" => "lease lost"} =
             put.("/api/segments/#{seg}/files/series.jsonl?island=#{id}&lease=wrong", "{}")
             |> json_response(409)

    assert %{"ok" => true} =
             put.(
               "/api/segments/#{seg}/files/series.jsonl?island=#{id}&lease=#{task["lease"]}",
               "{}"
             )
             |> json_response(200)

    assert %{"error" => "bad file name"} =
             put.(
               "/api/segments/#{seg}/files/..%2Fx.json?island=#{id}&lease=#{task["lease"]}",
               "{}"
             )
             |> json_response(409)

    assert %{"error" => _} =
             build_conn()
             |> authed(token)
             |> post("/api/segments/#{seg}/complete?island=#{id}", %{
               "kind" => "run",
               "endHash" => "0123456789abcdef",
               "lease" => task["lease"]
             })
             |> json_response(409)
  end

  test "a run's checkpoint is content-addressed and its predecessor is fetched by that digest", %{
    conn: conn
  } do
    conn |> post("/api/experiments", @spec_ok) |> json_response(200)
    {id, token} = join(conn)

    put = fn path, body ->
      build_conn()
      |> authed(token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put(path, body)
    end

    t1 = build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
    seg1 = t1["segment"]["id"]
    bin1 = Coordinator.CheckpointTest.build(500, seed: 1)

    assert %{"digest" => digest1} =
             put.("/api/segments/#{seg1}/checkpoint?island=#{id}&lease=#{t1["lease"]}", bin1)
             |> json_response(200)

    assert %{"ok" => true} =
             put.(
               "/api/segments/#{seg1}/files/series.jsonl?island=#{id}&lease=#{t1["lease"]}",
               "row\n"
             )
             |> json_response(200)

    assert build_conn()
           |> authed(token)
           |> post("/api/segments/#{seg1}/complete?island=#{id}", %{
             "kind" => "run",
             "endHash" => digest1,
             "lease" => t1["lease"]
           })
           |> json_response(200) == %{"status" => "done"}

    t2 = build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
    assert t2["startFrom"] == seg1

    start = build_conn() |> authed(token) |> get("/api/segments/#{seg1}/start?island=#{id}")
    assert response(start, 200) == bin1

    assert %{"spec" => %{"steps" => 1000}, "segments" => [s1, s2]} =
             build_conn() |> get("/api/experiments/api") |> json_response(200)

    assert %{"id" => ^seg1, "index" => 0, "startStep" => 0, "steps" => 500, "status" => "done"} =
             s1

    assert %{"digest" => ^digest1, "producedBy" => "test", "verifiedBy" => nil, "last" => false} =
             s1

    assert %{
             "index" => 1,
             "startStep" => 500,
             "status" => "assigned",
             "digest" => nil,
             "last" => true
           } = s2

    assert build_conn() |> get("/api/experiments/nope") |> json_response(404)

    # Export (tools/stitch.ts) is administrative: listing and bundle files.
    Application.put_env(:coordinator, :admin_token, "s3cret")
    on_exit(fn -> Application.put_env(:coordinator, :admin_token, nil) end)
    assert build_conn() |> get("/api/experiments/api") |> json_response(401)
    assert build_conn() |> authed("s3cret") |> get("/api/experiments/api") |> json_response(200)
    assert build_conn() |> get("/api/segments/#{seg1}/files/series.jsonl") |> json_response(401)

    assert build_conn()
           |> authed("s3cret")
           |> get("/api/segments/#{seg1}/files/series.jsonl")
           |> response(200) == "row\n"

    assert build_conn()
           |> authed("s3cret")
           |> get("/api/segments/#{seg1}/files/life.jsonl")
           |> json_response(404)
  end
end
