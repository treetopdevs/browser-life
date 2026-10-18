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

  test "public status exposes only aggregates and detailed status requires admin", %{conn: conn} do
    previous = Application.get_env(:coordinator, :admin_token)
    Application.put_env(:coordinator, :admin_token, "test-admin")

    on_exit(fn ->
      if previous,
        do: Application.put_env(:coordinator, :admin_token, previous),
        else: Application.delete_env(:coordinator, :admin_token)
    end)

    assert {:ok, 2} = Queue.create_experiment(@spec_ok)
    {id, _token} = join(conn)
    assert is_binary(id)

    public_conn = build_conn() |> get("/api/public/status")
    assert get_resp_header(public_conn, "cache-control") == ["no-store"]
    public = json_response(public_conn, 200)

    assert Map.keys(public) |> Enum.sort() == [
             "activeIslands",
             "counts",
             "deviceTypes",
             "updatedAt"
           ]

    assert public["activeIslands"] == 1
    assert public["counts"]["pending"] == 2
    assert public["deviceTypes"] == 0
    refute Map.has_key?(public, "islands")
    refute Map.has_key?(public, "experiments")
    assert build_conn() |> get("/api/status") |> json_response(401)

    detail_conn = build_conn() |> authed("test-admin") |> get("/api/status")
    assert get_resp_header(detail_conn, "cache-control") == ["no-store"]
    detail = json_response(detail_conn, 200)
    assert length(detail["islands"]) == 1
    assert public["counts"] == detail["counts"]
  end

  test "operator views need the admin token, and the public status names no island, adapter or experiment",
       %{conn: conn} do
    saved =
      for k <- [:admin_token, :allow_local_admin], do: {k, Application.fetch_env(:coordinator, k)}

    on_exit(fn ->
      for {k, v} <- saved do
        case v do
          {:ok, val} -> Application.put_env(:coordinator, k, val)
          :error -> Application.delete_env(:coordinator, k)
        end
      end
    end)

    ddir = Path.join(System.tmp_dir!(), "bl-api-disc-#{System.unique_integer([:positive])}")

    start_supervised!(
      {Coordinator.Discovery, data_dir: ddir, queue_data_dir: ddir <> "-queue", lease_ms: 60_000}
    )

    on_exit(fn -> File.rm_rf!(ddir) end)

    assert {:ok, 2} = Queue.create_experiment(@spec_ok)

    {id, token} =
      conn
      |> post("/api/islands", %{"adapter" => "Secret GPU 9000", "userAgent" => "Agent/1"})
      |> json_response(200)
      |> then(&{&1["id"], &1["token"]})

    # The island holds a task, so the experiment and island are live state.
    assert %{"kind" => "run"} =
             build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)

    operator = ["/api/status", "/api/experiments/api", "/api/discovery/status"]

    # With a token configured: no header, a wrong one, and loopback without one are all 401.
    Application.put_env(:coordinator, :admin_token, "test-admin")
    Application.put_env(:coordinator, :allow_local_admin, true)

    for path <- operator do
      denied = build_conn() |> get(path)
      assert json_response(denied, 401), path

      # A refusal says nothing about the state behind it.
      for secret <- [
            id,
            token,
            "Secret GPU 9000",
            "Agent/1",
            "test-admin",
            @spec_ok["experiment"]
          ],
          do: refute(denied.resp_body =~ secret, "#{path} 401 body names #{secret}")

      assert build_conn() |> authed("wrong") |> get(path) |> json_response(401), path
      assert build_conn() |> authed("test-admin ") |> get(path) |> json_response(401), path
      assert build_conn() |> authed("test-admin") |> get(path) |> json_response(200), path
    end

    detail = build_conn() |> authed("test-admin") |> get("/api/status") |> json_response(200)
    assert Map.has_key?(detail, "islands") and Map.has_key?(detail, "experiments")

    # No token configured and local administration off (production's shape
    # behind a proxy, where every peer is loopback): nobody is an operator.
    Application.delete_env(:coordinator, :admin_token)
    Application.put_env(:coordinator, :allow_local_admin, false)

    for path <- operator,
        do: assert(build_conn() |> get(path) |> json_response(401), path)

    raw = build_conn() |> get("/api/public/status") |> response(200)
    public = Jason.decode!(raw)

    assert Map.keys(public) |> Enum.sort() == ~w(activeIslands counts deviceTypes updatedAt)
    assert is_integer(public["deviceTypes"]) and public["activeIslands"] == 1

    assert Enum.all?(public["counts"], fn {k, v} ->
             k in ~w(pending assigned done verified diverged blocked failed) and is_integer(v)
           end)

    for secret <- ["isl-", id, token, "Secret GPU", "Agent/1", "api", "spots", "treatment"],
        do: refute(raw =~ secret, secret)
  end

  test "island routes require the private token", %{conn: conn} do
    {id, token} = join(conn)
    assert %{"error" => _} = build_conn() |> post("/api/next?island=#{id}") |> json_response(401)
    assert build_conn() |> authed("wrong") |> post("/api/next?island=#{id}") |> json_response(401)

    assert %{"kind" => "idle"} =
             build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)

    refute Enum.any?(Queue.status().islands, &Map.has_key?(&1, :token))
  end

  # ---- the garden token is a body parameter (docs/coordinator-hardening-2026-10-18.md, item 2) ----

  describe "a gardenToken in the join URL" do
    setup do
      saved = Application.fetch_env(:coordinator, :garden_island_token)
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")

      on_exit(fn ->
        case saved do
          {:ok, v} -> Application.put_env(:coordinator, :garden_island_token, v)
          :error -> Application.delete_env(:coordinator, :garden_island_token)
        end
      end)

      :ok
    end

    @refusal %{
      "error" => "gardenToken belongs in the JSON body of POST /api/islands, never in the URL"
    }

    # Through the body parser, as the runner sends a join (a map passed to
    # `post/3` would skip `CoordinatorWeb.IslandBodyLimit`).
    defp post_join(path, body) do
      build_conn()
      |> put_req_header("content-type", "application/json")
      |> post(path, Jason.encode!(body))
    end

    defp island_count, do: length(Queue.status().islands)

    test "is refused, never echoed, and joins nothing" do
      before = island_count()
      conn = post_join("/api/islands?gardenToken=open-sesame", %{"adapter" => "A"})
      assert json_response(conn, 400) == @refusal
      refute response(conn, 400) =~ "open-sesame"
      assert island_count() == before
    end

    test "is refused when the body carries the token as well" do
      conn =
        post_join("/api/islands?gardenToken=open-sesame", %{
          "adapter" => "A",
          "gardenToken" => "open-sesame"
        })

      assert json_response(conn, 400) == @refusal
      refute Enum.any?(Queue.status().islands, &(&1[:garden] == true))
      assert island_count() == 0
    end

    test "is refused with an empty value, a wrong one, a percent-encoded key, or no body at all" do
      for path <- [
            "/api/islands?gardenToken=",
            "/api/islands?gardenToken",
            "/api/islands?gardenToken=nope&adapter=A",
            "/api/islands?garden%54oken=open-sesame",
            "/api/islands?gardenToken[x]=open-sesame"
          ] do
        assert json_response(post_join(path, %{"adapter" => "A"}), 400) == @refusal, path
        # An older client's join: no content type, no body.
        assert json_response(build_conn() |> post(path), 400) == @refusal, path
      end

      assert island_count() == 0
    end

    # The request's log lines (the path, and the debug `Parameters:` line,
    # which merges the query) never print the refused value.
    test "is never logged, under its plain or percent-encoded key" do
      # The level is global (test.exs sets :warning), so it is put back at once.
      previous = Logger.level()
      Logger.configure(level: :debug)

      log =
        try do
          ExUnit.CaptureLog.capture_log([level: :debug], fn ->
            for path <- [
                  "/api/islands?gardenToken=open-sesame-q1",
                  "/api/islands?garden%54oken=open-sesame-q2"
                ] do
              assert json_response(post_join(path, %{"adapter" => "A"}), 400) == @refusal
            end
          end)
        after
          Logger.configure(level: previous)
        end

      assert log =~ "POST /api/islands"
      assert log =~ "Parameters:"
      refute log =~ "open-sesame"
    end

    test "a body-only token still makes a garden island, and a join with no token is unchanged" do
      body = post_join("/api/islands", %{"adapter" => "A", "gardenToken" => "open-sesame"})
      %{"id" => garden_island} = json_response(body, 200)
      assert Queue.island_info(garden_island)[:garden] == true

      %{"id" => plain} = json_response(post_join("/api/islands", %{"adapter" => "B"}), 200)
      refute Map.has_key?(Queue.island_info(plain), :garden)

      # A query parameter under another name (here a case variant) is not the
      # token: it is not honoured, and the join goes ahead without it.
      %{"id" => variant} =
        json_response(post_join("/api/islands?gardentoken=open-sesame", %{"adapter" => "C"}), 200)

      refute Map.has_key?(Queue.island_info(variant), :garden)
    end

    # Over HTTP a join body is JSON or nothing (`CoordinatorWeb.IslandBodyLimit`),
    # so a token in a form or multipart body never reaches `join/2`. (A map
    # passed to `post/3` would skip that plug, so the bodies are sent raw.)
    test "in a form-encoded or multipart body is answered 415, never echoed, and joins nothing" do
      for {type, body} <- [
            {"application/x-www-form-urlencoded", "adapter=A&gardenToken=open-sesame"},
            {"multipart/form-data; boundary=b",
             "--b\r\ncontent-disposition: form-data; name=\"gardenToken\"\r\n\r\nopen-sesame\r\n--b--\r\n"}
          ] do
        conn =
          assert_error_sent(415, fn ->
            build_conn() |> put_req_header("content-type", type) |> post("/api/islands", body)
          end)

        {415, _headers, sent} = conn
        refute sent =~ "open-sesame", type
      end

      assert island_count() == 0
    end
  end

  test "GET /api/islands/me never shows the recorded capabilities", %{conn: conn} do
    {id, token} = join(conn)

    assert %{"kind" => "idle"} =
             build_conn()
             |> authed(token)
             |> put_req_header("content-type", "application/json")
             |> post("/api/next?island=#{id}", Jason.encode!(%{"capabilities" => ["ponds-v1"]}))
             |> json_response(200)

    assert [%{capabilities: ["ponds-v1"]}] = Queue.status().islands

    me =
      build_conn() |> authed(token) |> get("/api/islands/me?island=#{id}") |> json_response(200)

    refute Map.has_key?(me, "capabilities")
    refute Map.has_key?(Queue.island_info(id), :capabilities)

    # Nor does the public status, and the full one needs an operator.
    raw = build_conn() |> get("/api/public/status") |> response(200)
    refute raw =~ "ponds-v1"
    refute raw =~ "apabilit"

    saved =
      {Application.fetch_env(:coordinator, :admin_token),
       Application.fetch_env(:coordinator, :allow_local_admin)}

    on_exit(fn ->
      for {key, value} <- Enum.zip([:admin_token, :allow_local_admin], Tuple.to_list(saved)) do
        case value do
          {:ok, v} -> Application.put_env(:coordinator, key, v)
          :error -> Application.delete_env(:coordinator, key)
        end
      end
    end)

    Application.put_env(:coordinator, :admin_token, "test-admin")
    Application.put_env(:coordinator, :allow_local_admin, false)
    unauthed = build_conn() |> get("/api/status")
    assert json_response(unauthed, 401)
    refute response(unauthed, 401) =~ "ponds-v1"

    detail = build_conn() |> authed("test-admin") |> get("/api/status") |> json_response(200)
    assert [%{"capabilities" => ["ponds-v1"]}] = detail["islands"]
    assert %{"ponds-v1" => %{"islands" => 1}} = detail["islandCapabilities"]["byCapability"]
  end

  test "a capabilities list the controller counts as none (17 entries, a non-list, no body) removes the record",
       %{conn: conn} do
    {id, token} = join(conn)

    next = fn body ->
      c = build_conn() |> authed(token)

      c =
        if body,
          do:
            c
            |> put_req_header("content-type", "application/json")
            |> post("/api/next?island=#{id}", Jason.encode!(body)),
          else: post(c, "/api/next?island=#{id}")

      json_response(c, 200)
    end

    recorded = fn -> hd(Queue.status().islands)[:capabilities] end

    for body <- [
          %{"capabilities" => ["ponds-v1" | for(n <- 1..16, do: "x-#{n}")]},
          %{"capabilities" => "ponds-v1"},
          %{"capabilities" => ["ponds-v1", 7]},
          %{},
          nil
        ] do
      next.(%{"capabilities" => ["ponds-v1"]})
      assert recorded.() == ["ponds-v1"]
      next.(body)
      assert recorded.() == nil, inspect(body)
    end

    # 16 entries is within the controller's bound: recorded (known names, then four others).
    next.(%{"capabilities" => ["ponds-v1" | for(n <- 1..15, do: "x-#{n}")]})
    assert recorded.() == ["ponds-v1", "x-1", "x-10", "x-11", "x-12"]
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

  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)

  test "a verify completion's observationDigests must be well-formed, and valid ones surface as observationsVerified",
       %{conn: conn} do
    conn
    |> post(
      "/api/experiments",
      Map.merge(@spec_ok, %{"experiment" => "obs", "verifyFraction" => 0.0, "steps" => 500})
    )
    |> json_response(200)

    {a, token_a} = join(conn)
    {b, token_b} = join(build_conn())

    put = fn token, path, body ->
      build_conn()
      |> authed(token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put(path, body)
    end

    t1 = build_conn() |> authed(token_a) |> post("/api/next?island=#{a}") |> json_response(200)
    seg1 = t1["segment"]["id"]
    bin1 = Coordinator.CheckpointTest.build(500, seed: 1)

    assert %{"digest" => digest1} =
             put.(
               token_a,
               "/api/segments/#{seg1}/checkpoint?island=#{a}&lease=#{t1["lease"]}",
               bin1
             )
             |> json_response(200)

    for name <- @observation_files do
      assert %{"ok" => true} =
               put.(
                 token_a,
                 "/api/segments/#{seg1}/files/#{name}?island=#{a}&lease=#{t1["lease"]}",
                 name
               )
               |> json_response(200)
    end

    assert build_conn()
           |> authed(token_a)
           |> post("/api/segments/#{seg1}/complete?island=#{a}", %{
             "kind" => "run",
             "endHash" => digest1,
             "lease" => t1["lease"]
           })
           |> json_response(200) == %{"status" => "done"}

    t2 = build_conn() |> authed(token_b) |> post("/api/next?island=#{b}") |> json_response(200)
    assert t2["kind"] == "verify" and t2["segment"]["id"] == seg1

    complete_verify = fn body ->
      build_conn()
      |> authed(token_b)
      |> post(
        "/api/segments/#{seg1}/complete?island=#{b}",
        Map.merge(%{"kind" => "verify", "endHash" => digest1, "lease" => t2["lease"]}, body)
      )
    end

    # Each file's content is its own name (see the PUT loop above): the
    # accepted SHA-256 is just that string's hash.
    sha = fn s -> :crypto.hash(:sha256, s) |> Base.encode16(case: :lower) end
    good = Map.new(@observation_files, &{&1, sha.(&1)})

    assert %{"error" => "observationDigests" <> _} =
             complete_verify.(%{
               "observationDigests" => Map.put(good, "manifest.json", sha.("x"))
             })
             |> json_response(422)

    assert %{"error" => "observationDigests" <> _} =
             complete_verify.(%{"observationDigests" => %{"series.jsonl" => "not-64-hex"}})
             |> json_response(422)

    assert %{"error" => "observationDigests" <> _} =
             complete_verify.(%{"observationDigests" => "nope"}) |> json_response(422)

    # Absent is fine (an older island): the verify still completes, just
    # without an observations comparison (see `Coordinator.Segment`).
    assert complete_verify.(%{}) |> json_response(200) == %{"status" => "verified"}
  end

  @pond_spec %{
    "experiment" => "pond",
    "presetId" => "ponds-small",
    "conditions" => ["treatment"],
    "seeds" => [1],
    "steps" => 2000,
    "segmentSteps" => 1000,
    "censusEvery" => 100,
    "verifyFraction" => 1.0
  }

  # What packages/runner/src/island.ts's runIsland sends: a JSON body.
  defp next_with(id, token, body) do
    build_conn()
    |> authed(token)
    |> put_req_header("content-type", "application/json")
    |> post("/api/next?island=#{id}", Jason.encode!(body))
    |> json_response(200)
  end

  test "/api/next offers pond work only with \"ponds-v1\" in a well-formed capabilities list, and never blocks other work",
       %{conn: conn} do
    # "a-pond" sorts ahead of "b-plain" in pick_task's order.
    conn
    |> post("/api/experiments", %{@pond_spec | "experiment" => "a-pond"})
    |> json_response(200)

    conn
    |> post("/api/experiments", %{@spec_ok | "experiment" => "b-plain"})
    |> json_response(200)

    {old, old_token} = join(conn)
    {odd, odd_token} = join(build_conn())
    {new, new_token} = join(build_conn())

    # No body at all (an island from before capabilities): non-pond work.
    t = build_conn() |> authed(old_token) |> post("/api/next?island=#{old}") |> json_response(200)
    assert t["kind"] == "run" and String.starts_with?(t["segment"]["run"], "b-plain/")

    # Malformed values count as no capabilities, even when they mention "ponds-v1".
    for caps <- [
          nil,
          [],
          "ponds-v1",
          %{"ponds-v1" => true},
          ["ponds-v1", 1],
          ["ponds-v1", String.duplicate("x", 65)],
          ["ponds-v1" | List.duplicate("other", 16)]
        ] do
      assert %{"kind" => "idle"} = next_with(odd, odd_token, %{"capabilities" => caps})
    end

    assert %{"kind" => "idle"} = next_with(odd, odd_token, %{})

    p = next_with(new, new_token, %{"capabilities" => ["ponds-v1"]})
    assert p["kind"] == "run" and String.starts_with?(p["segment"]["run"], "a-pond/ponds-small/")
    assert p["spec"]["presetId"] == "ponds-small"
  end

  test "/api/next offers a nat run only when the capabilities list carries \"ponds-v2\" as well",
       %{conn: conn} do
    # config.exs's `:conditions` does not list the hunt's conditions; add them for this test.
    conditions = Application.get_env(:coordinator, :conditions)
    Application.put_env(:coordinator, :conditions, conditions ++ ~w(pond-nat))
    on_exit(fn -> Application.put_env(:coordinator, :conditions, conditions) end)

    conn
    |> post("/api/experiments", %{
      @pond_spec
      | "experiment" => "a-nat",
        "conditions" => ["pond-nat"]
    })
    |> json_response(200)

    {old, old_token} = join(conn)
    {new, new_token} = join(build_conn())

    for caps <- [["ponds-v1"], ["ponds-v2"], ["ponds-v1", 2]] do
      assert %{"kind" => "idle"} = next_with(old, old_token, %{"capabilities" => caps})
    end

    p = next_with(new, new_token, %{"capabilities" => ["ponds-v1", "ponds-v2"]})
    assert p["kind"] == "run" and p["spec"]["condition"] == "pond-nat"
    assert String.starts_with?(p["segment"]["run"], "a-nat/ponds-small/pond-nat/")
  end

  test "a verify completion's ponds.tsv digest is accepted and compared like the other optional files",
       %{conn: conn} do
    conn |> post("/api/experiments", @pond_spec) |> json_response(200)
    {a, token_a} = join(conn)
    {b, token_b} = join(build_conn())
    caps = %{"capabilities" => ["ponds-v1"]}
    names = @observation_files ++ ["ponds.tsv"]
    sha = fn s -> :crypto.hash(:sha256, s) |> Base.encode16(case: :lower) end

    put = fn path, body ->
      build_conn()
      |> authed(token_a)
      |> put_req_header("content-type", "application/octet-stream")
      |> put(path, body)
    end

    # Runs segment `index` on island a (each file's content is its own name),
    # then verifies it on island b, reporting `reported` as its file digests.
    run_and_verify = fn index, reported ->
      t = next_with(a, token_a, caps)
      assert t["kind"] == "run" and t["segment"]["index"] == index
      q = "island=#{a}&lease=#{t["lease"]}"
      bin = Coordinator.CheckpointTest.build(1000 * (index + 1), seed: 1)

      assert %{"digest" => digest} =
               put.("/api/segments/#{t["segment"]["id"]}/checkpoint?#{q}", bin)
               |> json_response(200)

      for name <- names do
        assert %{"ok" => true} =
                 put.("/api/segments/#{t["segment"]["id"]}/files/#{name}?#{q}", name)
                 |> json_response(200)
      end

      assert build_conn()
             |> authed(token_a)
             |> post("/api/segments/#{t["segment"]["id"]}/complete?island=#{a}", %{
               "kind" => "run",
               "endHash" => digest,
               "lease" => t["lease"]
             })
             |> json_response(200) == %{"status" => "done"}

      v = next_with(b, token_b, caps)
      assert v["kind"] == "verify" and v["segment"]["id"] == t["segment"]["id"]

      assert build_conn()
             |> authed(token_b)
             |> post("/api/segments/#{v["segment"]["id"]}/complete?island=#{b}", %{
               "kind" => "verify",
               "endHash" => digest,
               "lease" => v["lease"],
               "observationDigests" => reported
             })
             |> json_response(200) == %{"status" => "verified"}
    end

    good = Map.new(names, &{&1, sha.(&1)})
    run_and_verify.(0, good)
    run_and_verify.(1, %{good | "ponds.tsv" => sha.("other rows")})

    assert %{"segments" => [s0, s1]} =
             build_conn() |> get("/api/experiments/pond") |> json_response(200)

    assert s0["observationsVerified"] == true
    # The six agree; only ponds.tsv differs, and that is a mismatch.
    assert s1["observationsVerified"] == false
  end

  # `manifest.json`'s metricsVersion is extracted and size-bounded in this
  # controller, outside Coordinator.Queue's shared GenServer (see its
  # moduledoc and Coordinator.Attempt's `manifest_metrics_version`) -- these
  # tests exercise that extraction over the real HTTP upload path, not
  # Coordinator.Queue directly (see queue_test.exs's "put_manifest" helper
  # for the Queue-level equivalent).
  describe "manifest.json's metrics version (upload-time extraction)" do
    setup do
      Application.put_env(:coordinator, :metrics_version, 2)
      on_exit(fn -> Application.put_env(:coordinator, :metrics_version, 1) end)
      :ok
    end

    # A minimal end-to-end setup shared by the tests below: creates a v2
    # experiment, joins one island, gets its (only) segment's run task and
    # uploads a valid checkpoint -- everything short of manifest.json and
    # completion, which each test provides itself.
    defp gated_task(conn) do
      conn
      |> post(
        "/api/experiments",
        %{
          @spec_ok
          | "experiment" => "gated-#{System.unique_integer([:positive])}",
            "steps" => 500,
            "segmentSteps" => 500
        }
      )
      |> json_response(200)

      # Declares the matching metrics version (2, this describe block's
      # config) at join, or pick_task would never offer it this experiment's
      # segment at all (see Coordinator.Queue's moduledoc) -- these tests are
      # about the *completion*-time check, not the assignment-time gate.
      body =
        build_conn()
        |> post("/api/islands", %{"adapter" => "test", "metricsVersion" => 2})
        |> json_response(200)

      {id, token} = {body["id"], body["token"]}
      t = build_conn() |> authed(token) |> post("/api/next?island=#{id}") |> json_response(200)
      seg = t["segment"]["id"]
      bin = Coordinator.CheckpointTest.build(500, seed: 1)

      assert %{"digest" => digest} =
               build_conn()
               |> authed(token)
               |> put_req_header("content-type", "application/octet-stream")
               |> put("/api/segments/#{seg}/checkpoint?island=#{id}&lease=#{t["lease"]}", bin)
               |> json_response(200)

      %{id: id, token: token, seg: seg, lease: t["lease"], digest: digest}
    end

    defp put_manifest(t, name \\ "manifest.json", body) do
      build_conn()
      |> authed(t.token)
      |> put_req_header("content-type", "application/octet-stream")
      |> put("/api/segments/#{t.seg}/files/#{name}?island=#{t.id}&lease=#{t.lease}", body)
    end

    defp complete(t) do
      build_conn()
      |> authed(t.token)
      |> post("/api/segments/#{t.seg}/complete?island=#{t.id}", %{
        "kind" => "run",
        "endHash" => t.digest,
        "lease" => t.lease
      })
    end

    test "an oversized manifest.json is refused at upload, before any parsing", %{conn: conn} do
      t = gated_task(conn)

      oversized =
        Jason.encode!(%{
          "metricsVersion" => 2,
          "padding" => String.duplicate("x", 2 * 1024 * 1024)
        })

      assert %{"error" => "body too large"} = put_manifest(t, oversized) |> json_response(409)
    end

    test "a manifest.json that isn't valid JSON is refused at upload", %{conn: conn} do
      t = gated_task(conn)

      assert %{"error" => "manifest.json is not valid JSON"} =
               put_manifest(t, "not json") |> json_response(409)
    end

    test "a manifest.json that decodes but isn't a JSON object is refused at upload", %{
      conn: conn
    } do
      t = gated_task(conn)

      assert %{"error" => "manifest.json must decode to a JSON object"} =
               put_manifest(t, "[1,2,3]") |> json_response(409)
    end

    test "a run completion with no recorded metrics version (manifest.json never uploaded) is refused on a v2 experiment",
         %{conn: conn} do
      t = gated_task(conn)
      # Every other bundle file is uploaded; manifest.json specifically is not.
      assert %{"ok" => true} = put_manifest(t, "series.jsonl", "row\n") |> json_response(200)

      assert %{"error" => "uploaded manifest's metrics version 1" <> _} =
               complete(t) |> json_response(409)

      # Refused, not consumed: the same attempt can still complete once fixed.
      assert %{"ok" => true} = put_manifest(t, "{\"metricsVersion\":2}") |> json_response(200)
      assert complete(t) |> json_response(200) == %{"status" => "done"}
    end

    test "happy path: a manifest.json whose metricsVersion matches the experiment's required one completes normally",
         %{conn: conn} do
      t = gated_task(conn)
      assert %{"ok" => true} = put_manifest(t, "{\"metricsVersion\":2}") |> json_response(200)
      assert complete(t) |> json_response(200) == %{"status" => "done"}
    end

    test "a manifest.json whose metricsVersion mismatches the experiment's required one is refused at completion",
         %{conn: conn} do
      t = gated_task(conn)
      assert %{"ok" => true} = put_manifest(t, "{\"metricsVersion\":1}") |> json_response(200)

      assert %{"error" => "uploaded manifest's metrics version 1" <> _} =
               complete(t) |> json_response(409)
    end
  end

  # Scheduled interventions over the wire (see Coordinator.Queue's moduledoc and
  # queue_test.exs's "scheduled interventions" for the rules themselves): the
  # JSON an administrator posts, the 422 a bad schedule gets, the task spec an
  # island receives, the gate on "interventions-v1", and a verify completion's
  # interventions.jsonl digest compared like the other optional files.
  describe "scheduled interventions" do
    @schedule [
      %{"step" => 0, "kind" => "lesion", "x" => 1, "y" => 2, "r" => 6},
      %{"step" => 700, "kind" => "lesion", "x" => 20, "y" => 20, "r" => 4},
      %{
        "step" => 1000,
        "kind" => "feed",
        "x" => 30,
        "y" => 30,
        "r" => 3,
        "amount" => 16
      }
    ]
    @wounded Map.merge(%{@spec_ok | "experiment" => "a-wounded"}, %{
               "verifyFraction" => 1.0,
               "interventions" => @schedule
             })

    test "a schedule is accepted, a feed in a pond world is refused with the runner's reason, and the listing carries it",
         %{conn: conn} do
      assert %{"segments" => 2} = conn |> post("/api/experiments", @wounded) |> json_response(200)

      assert %{"error" => "interventions[2]: feeding is not defined for pond worlds" <> _} =
               conn
               |> post("/api/experiments", %{
                 @wounded
                 | "experiment" => "pond-fed",
                   "presetId" => "ponds-small",
                   "segmentSteps" => 1000,
                   "censusEvery" => 100,
                   "steps" => 1000
               })
               |> json_response(422)

      assert %{"error" => "interventions[1]: a lesion has no key \"amount\"" <> _} =
               conn
               |> post("/api/experiments", %{
                 @wounded
                 | "experiment" => "odd",
                   "interventions" => [
                     Enum.at(@schedule, 0),
                     Map.put(Enum.at(@schedule, 1), "amount", 4)
                   ]
               })
               |> json_response(422)

      assert %{"spec" => %{"interventions" => @schedule}} =
               build_conn() |> get("/api/experiments/a-wounded") |> json_response(200)
    end

    test "POST /api/segments/:id/fail: the island token, a lease and the reject's lease rule; the failure reaches /api/status, the listing, and no further /api/next",
         %{conn: conn} do
      conn |> post("/api/experiments", @wounded) |> json_response(200)
      {a, token_a} = join(conn)
      {b, token_b} = join(build_conn())
      caps = %{"capabilities" => ["interventions-v1"]}
      t = next_with(a, token_a, caps)
      assert t["kind"] == "run" and t["segment"]["index"] == 0
      id = t["segment"]["id"]

      reason =
        "the feed at t=0 failed: feed refused: 128614400 quanta would take the world past MATTER_MAX (67108864); it holds 2621440"

      fail = fn conn, island, body ->
        post(conn, "/api/segments/#{id}/fail?island=#{island}", body)
      end

      assert build_conn()
             |> fail.(a, %{"lease" => t["lease"], "reason" => reason})
             |> json_response(401)

      assert %{"error" => "expected lease"} =
               build_conn()
               |> authed(token_a)
               |> fail.(a, %{"reason" => reason})
               |> json_response(422)

      assert %{"error" => "segment not assigned" <> _} =
               build_conn()
               |> authed(token_b)
               |> fail.(b, %{"lease" => t["lease"], "reason" => reason})
               |> json_response(409)

      assert %{"error" => "segment not assigned" <> _} =
               build_conn()
               |> authed(token_a)
               |> fail.(a, %{"lease" => "wrong", "reason" => reason})
               |> json_response(409)

      assert %{"error" => "unknown segment"} =
               build_conn()
               |> authed(token_a)
               |> post("/api/segments/seg-999/fail?island=#{a}", %{"lease" => t["lease"]})
               |> json_response(409)

      assert %{"ok" => true} =
               build_conn()
               |> authed(token_a)
               |> fail.(a, %{"lease" => t["lease"], "reason" => reason})
               |> json_response(200)

      # The lease is spent: a second report is refused.
      assert %{"error" => "segment not assigned" <> _} =
               build_conn()
               |> authed(token_a)
               |> fail.(a, %{"lease" => t["lease"], "reason" => reason})
               |> json_response(409)

      status = build_conn() |> get("/api/status") |> json_response(200)
      assert status["counts"] == %{"failed" => 1, "blocked" => 1}
      assert [%{"failed" => 1, "blocked" => 1, "verified" => 0, "diverged" => 0}] = status["runs"]

      assert [
               %{
                 "segment" => ^id,
                 "index" => 0,
                 "kind" => "run",
                 "island" => ^a,
                 "by" => "test",
                 "reason" => ^reason,
                 "failedAt" => at
               }
             ] =
               status["failures"]

      assert is_integer(at) and at > 0

      listing = build_conn() |> get("/api/experiments/a-wounded") |> json_response(200)
      [first, second] = listing["segments"]
      assert first["status"] == "failed"

      assert first["failure"] == %{
               "kind" => "run",
               "island" => a,
               "by" => "test",
               "reason" => reason,
               "failedAt" => at
             }

      assert second["status"] == "blocked"
      refute Map.has_key?(second, "failure")

      assert %{"kind" => "idle"} = next_with(a, token_a, caps)
      assert %{"kind" => "idle"} = next_with(b, token_b, caps)
    end

    test "a /fail reason that is not a string counts as none, and one of stacked combining marks is stored bounded in bytes",
         %{conn: conn} do
      conn |> post("/api/experiments", @wounded) |> json_response(200)

      conn
      |> post("/api/experiments", %{@spec_ok | "experiment" => "b-plain"})
      |> json_response(200)

      {a, token_a} = join(conn)
      caps = %{"capabilities" => ["interventions-v1"]}
      t = next_with(a, token_a, caps)

      assert %{"ok" => true} =
               build_conn()
               |> authed(token_a)
               |> post("/api/segments/#{t["segment"]["id"]}/fail?island=#{a}", %{
                 "lease" => t["lease"],
                 "reason" => %{"deep" => [1]}
               })
               |> json_response(200)

      t2 = next_with(a, token_a, caps)
      assert String.starts_with?(t2["segment"]["run"], "b-plain/")

      assert %{"ok" => true} =
               build_conn()
               |> authed(token_a)
               |> post("/api/segments/#{t2["segment"]["id"]}/fail?island=#{a}", %{
                 "lease" => t2["lease"],
                 "reason" => "x" <> String.duplicate("́", 100_000)
               })
               |> json_response(200)

      failures = (build_conn() |> get("/api/status") |> json_response(200))["failures"]
      assert [none, stacked] = Enum.sort_by(failures, & &1["run"])
      assert none["reason"] == ""
      assert String.valid?(stacked["reason"]) and byte_size(stacked["reason"]) <= 2000
      assert String.starts_with?(stacked["reason"], "x́")
    end

    test "/api/next hands scheduled work only with \"interventions-v1\", with the whole schedule in the task spec",
         %{conn: conn} do
      # "a-wounded" sorts ahead of "b-plain" in pick_task's order.
      conn |> post("/api/experiments", @wounded) |> json_response(200)

      conn
      |> post("/api/experiments", %{@spec_ok | "experiment" => "b-plain"})
      |> json_response(200)

      {old, old_token} = join(conn)
      {new, new_token} = join(build_conn())

      t = next_with(old, old_token, %{"capabilities" => ["ponds-v1", "ponds-v2"]})
      assert t["kind"] == "run" and String.starts_with?(t["segment"]["run"], "b-plain/")
      refute Map.has_key?(t["spec"], "interventions")
      assert %{"kind" => "idle"} = next_with(old, old_token, %{"capabilities" => ["ponds-v1"]})

      w = next_with(new, new_token, %{"capabilities" => ["interventions-v1"]})
      assert w["kind"] == "run" and String.starts_with?(w["segment"]["run"], "a-wounded/spots/")
      assert w["spec"]["interventions"] == @schedule
      assert w["spec"]["steps"] == 500
    end

    test "a verify completion's interventions.jsonl digest is accepted and compared like the other optional files",
         %{conn: conn} do
      conn |> post("/api/experiments", @wounded) |> json_response(200)
      {a, token_a} = join(conn)
      {b, token_b} = join(build_conn())
      caps = %{"capabilities" => ["interventions-v1"]}
      names = @observation_files ++ ["interventions.jsonl"]
      sha = fn s -> :crypto.hash(:sha256, s) |> Base.encode16(case: :lower) end

      put = fn path, body ->
        build_conn()
        |> authed(token_a)
        |> put_req_header("content-type", "application/octet-stream")
        |> put(path, body)
      end

      run_and_verify = fn index, reported ->
        t = next_with(a, token_a, caps)
        assert t["kind"] == "run" and t["segment"]["index"] == index
        q = "island=#{a}&lease=#{t["lease"]}"
        bin = Coordinator.CheckpointTest.build(500 * (index + 1), seed: 1)

        assert %{"digest" => digest} =
                 put.("/api/segments/#{t["segment"]["id"]}/checkpoint?#{q}", bin)
                 |> json_response(200)

        for name <- names do
          assert %{"ok" => true} =
                   put.("/api/segments/#{t["segment"]["id"]}/files/#{name}?#{q}", name)
                   |> json_response(200)
        end

        assert build_conn()
               |> authed(token_a)
               |> post("/api/segments/#{t["segment"]["id"]}/complete?island=#{a}", %{
                 "kind" => "run",
                 "endHash" => digest,
                 "lease" => t["lease"]
               })
               |> json_response(200) == %{"status" => "done"}

        v = next_with(b, token_b, caps)
        assert v["kind"] == "verify" and v["segment"]["id"] == t["segment"]["id"]
        assert v["spec"]["interventions"] == @schedule

        assert build_conn()
               |> authed(token_b)
               |> post("/api/segments/#{v["segment"]["id"]}/complete?island=#{b}", %{
                 "kind" => "verify",
                 "endHash" => digest,
                 "lease" => v["lease"],
                 "observationDigests" => reported
               })
               |> json_response(200) == %{"status" => "verified"}
      end

      good = Map.new(names, &{&1, sha.(&1)})
      run_and_verify.(0, good)
      run_and_verify.(1, %{good | "interventions.jsonl" => sha.("another wound")})

      assert %{"segments" => [s0, s1]} =
               build_conn() |> get("/api/experiments/a-wounded") |> json_response(200)

      assert s0["observationsVerified"] == true
      assert s0["files"]["interventions.jsonl"] == sha.("interventions.jsonl")
      # The six agree; only interventions.jsonl differs, and that is a mismatch.
      assert s1["observationsVerified"] == false
    end
  end
end
