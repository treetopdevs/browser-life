defmodule CoordinatorWeb.GardenApiTest do
  @moduledoc """
  The garden's HTTP surface: the public view and its cache, letters (422, 429,
  409, 404 and the refund), the verified-day checkpoint, and the keeper's
  routes. A real `Coordinator.Queue` on a hand-moved clock, on `spots` with a
  20-step day.
  """
  use CoordinatorWeb.ConnCase, async: false
  import CoordinatorWeb.GardenHelpers
  alias Coordinator.{LetterLimiter, Queue, TestClock}

  @d 20
  @founding [%{"step" => 0, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]
  @env [
    :lease_ms,
    :garden_letters_per_address,
    :garden_refusals_per_address,
    :garden_letter_window_ms,
    :garden_cache_ms,
    :garden_cache_wait_ms,
    :trust_forwarded_for,
    :public_garden,
    :admin_token,
    :allow_local_admin,
    :cors_origins,
    :garden_island_token
  ]

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-garden-api-#{System.unique_integer([:positive])}")
    saved = snapshot_env(@env)
    # Advancing a dawn must not expire leases; and mid-window, so a Retry-After
    # is not a whole window.
    Application.put_env(:coordinator, :lease_ms, 1_000 * day_ms())
    TestClock.install(100 * day_ms() + 3_600_000 + 1_234)
    LetterLimiter.reset()

    on_exit(fn ->
      LetterLimiter.reset()
      # The registry outlives the Queue (it is a persistent term): leave none behind.
      LetterLimiter.set_gardens(%{})
      TestClock.uninstall()
      restore_env(saved)
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    %{dir: dir}
  end

  # ---- helpers ----

  defp params(over \\ %{}) do
    Map.merge(
      %{
        "name" => "commons",
        "presetId" => "spots",
        "seed" => 1,
        "founding" => @founding,
        "stepsPerDay" => @d,
        "censusEvery" => 10,
        "days" => 5,
        "lettersPerDay" => 8,
        "queueMax" => 50
      },
      over
    )
  end

  defp garden!(over \\ %{}), do: {:ok, _} = Queue.create_garden(params(over))

  defp post_json(conn, path, body) do
    conn
    |> put_req_header("content-type", "application/json")
    |> post(path, if(is_binary(body), do: body, else: Jason.encode!(body)))
  end

  defp stone(over \\ %{}),
    do: Map.merge(%{"kind" => "stone", "x" => 30, "y" => 40, "r" => 5}, over)

  defp from(conn, ip), do: %{conn | remote_ip: ip}
  defp letters_path(name \\ "commons"), do: "/api/public/gardens/#{name}/letters"

  # ---- the public view ----

  describe "GET the view" do
    test "no authentication, no-store, JSON; the unnamed route is the configured garden", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :allow_local_admin, false)
      Application.put_env(:coordinator, :admin_token, "secret")
      garden!()
      garden!(%{"name" => "other", "seed" => 2})

      for path <- ["/api/public/garden", "/api/public/gardens/commons"] do
        c = get(conn, path)
        assert %{"contract" => "garden-v1", "name" => "commons"} = json_response(c, 200)
        assert get_resp_header(c, "cache-control") == ["no-store"]
        assert [type] = get_resp_header(c, "content-type")
        assert type =~ "application/json"
      end

      assert %{"name" => "other"} = conn |> get("/api/public/gardens/other") |> json_response(200)

      Application.put_env(:coordinator, :public_garden, "other")
      assert %{"name" => "other"} = conn |> get("/api/public/garden") |> json_response(200)
    end

    test "404 for no such garden, and for a name no garden could have", %{conn: conn} do
      assert %{"error" => "not found"} = conn |> get("/api/public/garden") |> json_response(404)
      garden!()

      for name <- ["nope", "Commons", "..", "a b", String.duplicate("a", 65)] do
        assert %{"error" => "not found"} =
                 conn |> get("/api/public/gardens/#{URI.encode(name)}") |> json_response(404)
      end
    end

    test "never carries an island id or an adapter string", %{conn: conn, dir: dir} do
      garden!()
      a = join("Secret-GPU-A")
      b = join("Secret-GPU-B")
      run_and_verify(dir, a, b)

      body = conn |> get("/api/public/garden") |> response(200)
      refute body =~ "Secret-GPU"
      refute body =~ a
      refute body =~ b
    end

    test "is served from a cache outside the queue until a letter invalidates it", %{conn: conn} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()

      queued = fn c ->
        c |> get("/api/public/garden") |> json_response(200) |> get_in(["letters", "queued"])
      end

      assert queued.(conn) == 0
      # A write that bypasses the controller is invisible until the entry expires...
      {:ok, _} = Queue.post_letter("commons", %{x: 5, y: 5, r: 2})
      assert queued.(conn) == 0

      # ...but a letter posted over HTTP invalidates the entry, so the poster sees it.
      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
      assert queued.(conn) == 2

      # A drop does too.
      assert %{"letter" => %{"status" => "dropped"}} =
               conn |> post("/api/gardens/commons/letters/ltr-1/drop") |> json_response(200)

      assert queued.(conn) == 1
    end

    test "with the cache off every read is live", %{conn: conn} do
      garden!()
      {:ok, _} = Queue.post_letter("commons", %{x: 5, y: 5, r: 2})

      assert %{"letters" => %{"queued" => 1}} =
               conn |> get("/api/public/garden") |> json_response(200)

      {:ok, _} = Queue.post_letter("commons", %{x: 6, y: 5, r: 2})

      assert %{"letters" => %{"queued" => 2}} =
               conn |> get("/api/public/garden") |> json_response(200)
    end

    test "CORS is the existing policy: an allowed origin is echoed, others get nothing", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :cors_origins, ["http://localhost:5173"])
      garden!()

      c = conn |> put_req_header("origin", "http://localhost:5173") |> get("/api/public/garden")
      assert get_resp_header(c, "access-control-allow-origin") == ["http://localhost:5173"]

      c = conn |> put_req_header("origin", "http://evil.example") |> get("/api/public/garden")
      assert get_resp_header(c, "access-control-allow-origin") == []

      c =
        conn
        |> put_req_header("origin", "http://localhost:5173")
        |> options("/api/public/garden/letters")

      assert c.status == 204
    end
  end

  # ---- posting a letter ----

  describe "POST a letter" do
    test "201 with the waiting letter, its day and landing step; the view shows it", %{conn: conn} do
      garden!()

      c = post_json(conn, letters_path(), stone())
      assert %{"letter" => letter} = json_response(c, 201)

      assert %{
               "id" => "ltr-1",
               "kind" => "stone",
               "x" => 30,
               "y" => 40,
               "r" => 5,
               "status" => "waiting",
               "day" => 0,
               "landsAtStep" => @d,
               "landedIn" => nil,
               "droppedAt" => nil
             } = letter

      assert is_integer(letter["postedAt"])
      # The unnamed route posts to the configured garden.
      assert %{"letter" => %{"id" => "ltr-2"}} =
               conn |> post_json("/api/public/garden/letters", stone()) |> json_response(201)

      view = conn |> get("/api/public/garden") |> json_response(200)
      assert Enum.map(view["letters"]["waiting"], & &1["id"]) == ["ltr-1", "ltr-2"]
    end

    test "422 for anything but exactly a stone", %{conn: conn} do
      garden!()

      bad = [
        # floats, strings, booleans, nulls
        stone(%{"x" => 1.5}),
        stone(%{"x" => "30"}),
        stone(%{"y" => true}),
        stone(%{"r" => nil}),
        stone(%{"r" => 5.0}),
        # extra and missing keys
        stone(%{"name" => "ada"}),
        Map.delete(stone(), "kind"),
        %{},
        # not a stone
        stone(%{"kind" => "feed"}),
        stone(%{"kind" => 7}),
        # radius out of range
        stone(%{"r" => 0}),
        stone(%{"r" => 33}),
        stone(%{"r" => -1}),
        # out of the world
        stone(%{"x" => -1}),
        stone(%{"x" => 256}),
        stone(%{"y" => 256}),
        stone(%{"y" => 10_000_000_000_000_000_000_000})
      ]

      for body <- bad do
        assert %{"error" => why} = conn |> post_json(letters_path(), body) |> json_response(422)
        assert is_binary(why)
      end

      # Not an object at all, or not JSON.
      for raw <- ["[1,2]", "7", "\"stone\"", "null"] do
        assert %{"error" => _} = conn |> post_json(letters_path(), raw) |> json_response(422)
      end

      # Query and path parameters never count as letter keys.
      assert %{"error" => _} =
               conn
               |> post_json(letters_path() <> "?kind=stone&x=1&y=1&r=1", %{})
               |> json_response(422)

      assert %{"letter" => _} =
               conn |> post_json(letters_path() <> "?foo=bar", stone()) |> json_response(201)

      # Edges of the world and radius are fine.
      assert conn
             |> post_json(letters_path(), stone(%{"x" => 0, "y" => 255, "r" => 32}))
             |> json_response(201)

      assert conn
             |> post_json(letters_path(), stone(%{"x" => 255, "y" => 0, "r" => 1}))
             |> json_response(201)
    end

    test "invalid bodies cost nothing against the address's budget", %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()

      for _ <- 1..5,
          do: assert(conn |> post_json(letters_path(), stone(%{"r" => 0})) |> json_response(422))

      for _ <- 1..5,
          do:
            assert(conn |> post_json(letters_path(), stone(%{"x" => 999})) |> json_response(422))

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
    end

    test "429 after the per-address budget, with a Retry-After that matches the body", %{
      conn: conn
    } do
      garden!()

      for _ <- 1..3, do: assert(conn |> post_json(letters_path(), stone()) |> json_response(201))
      c = post_json(conn, letters_path(), stone())
      assert %{"error" => _, "retryAfterMs" => ms} = json_response(c, 429)
      # Mid-window: 1,234 ms into the hour.
      assert ms == 3_600_000 - 1_234
      assert get_resp_header(c, "retry-after") == [Integer.to_string(div(ms + 999, 1000))]
      assert get_resp_header(c, "retry-after") == ["3599"]

      # The refused attempt wrote nothing.
      assert get(conn, "/api/public/garden")
             |> json_response(200)
             |> get_in(["letters", "queued"]) == 3

      # Another address is untouched.
      other = from(conn, {10, 0, 0, 2})
      assert other |> post_json(letters_path(), stone()) |> json_response(201)

      # The window ends: the first address may write again.
      TestClock.advance(ms)
      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
    end

    test "the budget is per address, not per garden", %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()
      garden!(%{"name" => "other", "seed" => 2})

      assert conn |> post_json(letters_path("commons"), stone()) |> json_response(201)
      assert conn |> post_json(letters_path("other"), stone()) |> json_response(429)
    end

    test "409 when the garden takes no letters, and the refused letter is refunded", %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 2)
      garden!(%{"queueMax" => 1})

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
      # The queue is full: 409, every time, never 429 (each refusal gave its token back).
      for _ <- 1..5 do
        assert %{"error" => _} = conn |> post_json(letters_path(), stone()) |> json_response(409)
      end

      # And the budget really was kept: with the queue drained, one more letter is allowed.
      assert conn |> post("/api/gardens/commons/letters/ltr-1/drop") |> json_response(200)
      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
      assert conn |> post_json(letters_path(), stone()) |> json_response(429)
    end

    test "422 from the queue (a centre outside this garden's world) is refunded too", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()

      for _ <- 1..3 do
        assert conn |> post_json(letters_path(), stone(%{"x" => 300})) |> json_response(422)
      end

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
    end

    @tag :capture_log
    test "409 for a stopped garden", %{conn: conn} do
      garden!()
      a = join("A")
      task = next(a)
      assert :ok = Queue.fail(task.segment.id, a, task.lease, "cannot run")

      assert %{"error" => _} = conn |> post_json(letters_path(), stone()) |> json_response(409)

      assert conn |> get("/api/public/garden") |> json_response(200) |> Map.fetch!("state") ==
               "stopped"
    end

    test "404 for no such garden or a bad name; nothing is charged", %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()

      for _ <- 1..3 do
        assert %{"error" => "not found"} =
                 conn |> post_json(letters_path("nope"), stone()) |> json_response(404)
      end

      assert conn |> post_json(letters_path("Bad_Name"), stone()) |> json_response(404)
      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
    end

    test "the address is the peer unless the proxy header is trusted", %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()
      xff = fn c, v -> put_req_header(c, "x-forwarded-for", v) end

      # Untrusted: the header is just text, one peer one budget.
      assert conn |> xff.("1.1.1.1") |> post_json(letters_path(), stone()) |> json_response(201)
      assert conn |> xff.("2.2.2.2") |> post_json(letters_path(), stone()) |> json_response(429)

      # Trusted: the right-most parseable entry is the address.
      LetterLimiter.reset()
      Application.put_env(:coordinator, :trust_forwarded_for, true)

      assert conn
             |> xff.("9.9.9.9, 1.1.1.1")
             |> post_json(letters_path(), stone())
             |> json_response(201)

      assert conn
             |> xff.("8.8.8.8, 1.1.1.1")
             |> post_json(letters_path(), stone())
             |> json_response(429)

      assert conn |> xff.("1.1.1.2") |> post_json(letters_path(), stone()) |> json_response(201)
      # An unparseable right-most entry is not an address: the peer is used,
      # never an entry further left (the client wrote those)...
      assert conn
             |> xff.("1.1.1.1, not-an-ip")
             |> post_json(letters_path(), stone())
             |> json_response(201)

      assert conn
             |> xff.("1.1.1.9, ")
             |> post_json(letters_path(), stone())
             |> json_response(429)

      # ...IPv6 parses...
      assert conn |> xff.("::1") |> post_json(letters_path(), stone()) |> json_response(201)
      assert conn |> xff.("::1") |> post_json(letters_path(), stone()) |> json_response(429)
      # ...no entry at all falls back to the peer (spent above)...
      assert conn |> xff.("garbage") |> post_json(letters_path(), stone()) |> json_response(429)
      assert conn |> post_json(letters_path(), stone()) |> json_response(429)
      # ...and several header lines are one list, the last line's last entry winning.
      two = %{
        conn
        | req_headers: [{"x-forwarded-for", "3.3.3.3"}, {"x-forwarded-for", "4.4.4.4"}]
      }

      assert two |> post_json(letters_path(), stone()) |> json_response(201)
      assert conn |> xff.("4.4.4.4") |> post_json(letters_path(), stone()) |> json_response(429)
    end
  end

  # ---- the checkpoint ----

  describe "GET a checkpoint" do
    test "only a verified day's digest is served", %{conn: conn, dir: dir} do
      garden!()
      a = join("A")
      b = join("B")
      run_and_verify(dir, a, b)

      # Day 1: run, not yet replayed.
      TestClock.advance(day_ms())
      t1 = next(a)
      assert t1.segment.index == 1
      finish(dir, a, t1)

      path = fn name, digest -> "/api/public/gardens/#{name}/checkpoints/#{digest}" end

      c = get(conn, path.("commons", dg(0)))
      assert response(c, 200) == "x"
      assert get_resp_header(c, "content-type") |> hd() =~ "application/octet-stream"

      # Done but not verified; a day that does not exist; not hex; the wrong garden.
      for p <- [
            path.("commons", dg(1)),
            path.("commons", dg(4)),
            path.("commons", "0000000000000000"),
            path.("commons", "..%2F..%2Fstate.bin"),
            path.("commons", String.upcase(dg(0))),
            path.("commons", String.slice(dg(0), 0, 15)),
            path.("nope", dg(0))
          ] do
        assert %{"error" => "not found"} = conn |> get(p) |> json_response(404)
      end

      # Once the replay lands it is served.
      v1 = next(b)
      assert v1.kind == "verify" and v1.segment.index == 1
      {:ok, "verified"} = verify(v1, b)
      assert conn |> get(path.("commons", dg(1))) |> response(200) == "x"
    end

    # Slice 15 (docs/garden-hardening-2026-10-18.md, item 2): a day becoming
    # verified invalidates the garden's cache from the Queue, so a view naming
    # the new fork is never followed by a cached 404 for its checkpoint.
    test "the fork the view names is served at once, even after a cached 404", %{
      conn: conn,
      dir: dir
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      a = join("A")
      b = join("B")

      t0 = next(a)
      assert t0.segment.index == 0
      finish(dir, a, t0)

      # Before the replay: no fork, and day 0's digest is not served. Both
      # answers are now cached for ten minutes.
      assert %{"fork" => nil} = conn |> get("/api/public/garden") |> json_response(200)

      assert %{"error" => "not found"} =
               conn
               |> get("/api/public/gardens/commons/checkpoints/#{dg(0)}")
               |> json_response(404)

      assert {:ok, %{}} = LetterLimiter.cached_checkpoints("commons")

      v0 = next(b)
      assert v0.kind == "verify" and v0.segment.index == 0
      {:ok, "verified"} = verify(v0, b)

      # The verification itself (not a controller) dropped both entries.
      assert LetterLimiter.cached_checkpoints("commons") == :miss
      assert LetterLimiter.cached_view("commons") == :miss

      fork = conn |> get("/api/public/garden") |> json_response(200) |> Map.fetch!("fork")
      assert %{"day" => 0, "digest" => digest, "checkpoint" => checkpoint} = fork
      assert digest == dg(0)
      assert conn |> get(checkpoint) |> response(200) == "x"
    end

    # The exact shape of the bug: only the checkpoint set was cached before the
    # replay, so the first view after it is computed fresh and names the new
    # fork. Without the invalidation the checkpoint route answered that fork
    # from the cached set: a 404 for up to `garden_cache_ms`.
    test "a fresh view's fork is served even when only the checkpoint set was cached", %{
      conn: conn,
      dir: dir
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      path = "/api/public/gardens/commons/checkpoints/#{dg(0)}"
      assert conn |> get(path) |> json_response(404)
      assert {:ok, %{}} = LetterLimiter.cached_checkpoints("commons")
      assert LetterLimiter.cached_view("commons") == :miss

      v0 = next(b)
      {:ok, "verified"} = verify(v0, b)

      assert %{"day" => 0, "checkpoint" => ^path} =
               conn |> get("/api/public/garden") |> json_response(200) |> Map.fetch!("fork")

      assert conn |> get(path) |> response(200) == "x"
    end
  end

  # ---- who may tend ----

  # Slice 15 (docs/garden-hardening-2026-10-18.md, item 1): the island client
  # sends `gardenToken` in its join body; over HTTP the coordinator honours it
  # exactly as `Queue.join/1` does (garden_queue_test.exs pins the Queue side).
  describe "joining with a garden island token" do
    test "an island joined over HTTP with gardenToken is offered day 0; one without is idle", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")
      garden!()

      join_http = fn body ->
        %{"id" => id, "token" => token} =
          build_conn() |> post_json("/api/islands", body) |> json_response(200)

        assert is_binary(token)
        id
      end

      base = %{"adapter" => "A", "userAgent" => "t"}
      tokened = join_http.(Map.put(base, "gardenToken", "open-sesame"))
      untokened = join_http.(base)
      wrong = join_http.(Map.put(base, "gardenToken", "nope"))

      assert %{kind: "idle"} = next(untokened)
      assert %{kind: "idle"} = next(wrong)
      assert %{kind: "run", segment: %{index: 0, run: "commons" <> _}} = next(tokened)

      # The token is never echoed back, nor shown in the island's own record.
      refute conn |> get("/api/status") |> response(200) =~ "open-sesame"
      refute inspect(Queue.island_info(tokened)) =~ "open-sesame"
    end

    # The token is checked before the Queue call (Queue.join/1), so the Queue's
    # mailbox, and with it any crash report that prints its last message, never
    # holds it; only whether it matched.
    test "the token never reaches the Queue process", %{conn: _conn} do
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")
      queue = Process.whereis(Queue)
      :ok = :sys.suspend(queue)

      task =
        try do
          task =
            Task.async(fn ->
              build_conn()
              |> post_json("/api/islands", %{"adapter" => "A", "gardenToken" => "open-sesame"})
              |> json_response(200)
            end)

          wait = fn wait, n ->
            {:messages, msgs} = Process.info(queue, :messages)

            cond do
              Enum.any?(msgs, &match?({:"$gen_call", _, {:join, _, _}}, &1)) ->
                msgs

              n == 0 ->
                flunk("the join never reached the Queue")

              true ->
                Process.sleep(10)
                wait.(wait, n - 1)
            end
          end

          msgs = wait.(wait, 500)
          refute inspect(msgs, limit: :infinity, printable_limit: :infinity) =~ "open-sesame"
          # Any other message (a timer, say) may sit beside the join.
          assert {:"$gen_call", _, {:join, %{"adapter" => "A"} = info, true}} =
                   Enum.find(msgs, &match?({:"$gen_call", _, {:join, _, _}}, &1))

          refute Map.has_key?(info, "gardenToken")
          task
        after
          :sys.resume(queue)
        end

      assert %{"id" => id} = Task.await(task)
      assert Queue.island_info(id).garden == true
    end

    # A join's debug log line prints its parameters through Phoenix's filter.
    test "a join's logged parameters hide the token", %{conn: _conn} do
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")
      # The level is global (test.exs sets :warning; a process level does not
      # reach the capture), so it is put back at once.
      previous = Logger.level()
      Logger.configure(level: :debug)

      log =
        try do
          ExUnit.CaptureLog.capture_log([level: :debug], fn ->
            build_conn()
            |> post_json("/api/islands", %{"adapter" => "A", "gardenToken" => "open-sesame"})
            |> json_response(200)
          end)
        after
          Logger.configure(level: previous)
        end

      assert log =~ "Parameters:"
      assert log =~ ~s("gardenToken" => "[FILTERED]")
      refute log =~ "open-sesame"
    end
  end

  # ---- the keeper ----

  describe "keeper routes" do
    test "founding a garden over HTTP, then reading it", %{conn: conn} do
      body = params() |> Map.put("name", "made")

      assert %{"garden" => "made", "days" => 5} =
               conn |> post_json("/api/gardens", body) |> json_response(200)

      assert %{"name" => "made", "contract" => "garden-v1"} =
               conn |> get("/api/public/gardens/made") |> json_response(200)

      assert %{"error" => "garden exists"} =
               conn |> post_json("/api/gardens", body) |> json_response(422)

      assert %{"error" => "presetId" <> _} =
               conn
               |> post_json("/api/gardens", %{body | "name" => "x2", "presetId" => "gradient"})
               |> json_response(422)

      assert %{"error" => _} = conn |> post_json("/api/gardens", "[1]") |> json_response(422)
      assert %{"error" => _} = conn |> post_json("/api/gardens", %{}) |> json_response(422)
    end

    test "a cached 'not found' never hides a garden just founded", %{conn: conn} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      assert conn |> get("/api/public/gardens/made") |> json_response(404)
      assert conn |> post_json("/api/gardens", params(%{"name" => "made"})) |> json_response(200)
      assert conn |> get("/api/public/gardens/made") |> json_response(200)
    end

    test "admin routes need the admin; the public routes never do", %{conn: conn} do
      Application.put_env(:coordinator, :allow_local_admin, false)
      Application.put_env(:coordinator, :admin_token, "keeper")
      authed = put_req_header(conn, "authorization", "Bearer keeper")

      assert %{"error" => "admin authentication required"} =
               conn |> post_json("/api/gardens", params()) |> json_response(401)

      assert conn
             |> put_req_header("authorization", "Bearer wrong")
             |> post_json("/api/gardens", params())
             |> json_response(401)

      assert authed |> post_json("/api/gardens", params()) |> json_response(200)

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
      assert conn |> post("/api/gardens/commons/letters/ltr-1/drop") |> json_response(401)
      assert authed |> post("/api/gardens/commons/letters/ltr-1/drop") |> json_response(200)
      assert conn |> get("/api/public/garden") |> json_response(200)
    end

    test "local administration works without a token only where enabled", %{conn: conn} do
      Application.put_env(:coordinator, :allow_local_admin, true)
      assert conn |> post_json("/api/gardens", params()) |> json_response(200)

      assert conn
             |> from({10, 0, 0, 9})
             |> post("/api/gardens/commons/letters/ltr-1/drop")
             |> json_response(401)
    end

    test "drop: 200 (again too), 409 once the day is assigned, 404 for the unknown", %{
      conn: conn
    } do
      garden!()
      for x <- [1, 2], do: {:ok, _} = Queue.post_letter("commons", %{x: x, y: 1, r: 1})
      drop = fn id -> post(conn, "/api/gardens/commons/letters/#{id}/drop") end

      assert %{"letter" => %{"id" => "ltr-1", "status" => "dropped", "droppedAt" => at}} =
               json_response(drop.("ltr-1"), 200)

      assert is_integer(at)
      # Dropping it again is the same answer (a keeper's retry), not a 409.
      assert %{"letter" => %{"id" => "ltr-1", "status" => "dropped", "droppedAt" => ^at}} =
               json_response(drop.("ltr-1"), 200)

      # Day 0 is taken: ltr-2 is sealed.
      a = join("A")
      assert %{kind: "run"} = next(a)
      assert %{"error" => _} = json_response(drop.("ltr-2"), 409)

      for id <- ["ltr-99", "ltr-0", "x", "ltr-", "ltr-1234567890", "LTR-1"] do
        assert json_response(drop.(id), 404)
      end

      assert conn |> post("/api/gardens/nope/letters/ltr-1/drop") |> json_response(404)
      assert conn |> post("/api/gardens/Bad_Name/letters/ltr-1/drop") |> json_response(404)
    end
  end

  # ---- what the public cannot make the queue do ----

  describe "public traffic that never reaches the queue" do
    # A suspended Queue answers nothing: a request that needed it would hang
    # until the call timed out, so a prompt answer proves it was never asked.
    defp without_queue(fun) do
      :ok = :sys.suspend(Queue)

      try do
        fun.()
      after
        :sys.resume(Queue)
      end
    end

    test "an unknown garden: view, letters and checkpoints are 404s with no queue call", %{
      conn: conn
    } do
      garden!()

      without_queue(fn ->
        assert conn |> get("/api/public/gardens/nope") |> json_response(404)
        assert conn |> get("/api/public/gardens/nope/checkpoints/#{dg(0)}") |> json_response(404)
        assert conn |> post_json(letters_path("nope"), stone()) |> json_response(404)
      end)
    end

    test "a centre outside the world is a 422 with no queue call, and costs nothing", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()

      without_queue(fn ->
        for _ <- 1..10 do
          assert %{"error" => "x must be in 0..255"} =
                   conn |> post_json(letters_path(), stone(%{"x" => 256})) |> json_response(422)

          assert conn |> post_json(letters_path(), stone(%{"y" => -1})) |> json_response(422)
        end
      end)

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)
    end

    test "refused letters are given back but metered: past the refusal budget it is a 429 with no queue call",
         %{conn: conn} do
      Application.put_env(:coordinator, :garden_letters_per_address, 2)
      Application.put_env(:coordinator, :garden_refusals_per_address, 3)
      garden!(%{"queueMax" => 1})

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)

      for _ <- 1..3,
          do: assert(conn |> post_json(letters_path(), stone()) |> json_response(409))

      without_queue(fn ->
        for _ <- 1..20 do
          assert %{"retryAfterMs" => ms} =
                   conn |> post_json(letters_path(), stone()) |> json_response(429)

          assert ms == 3_600_000 - 1_234
        end
      end)

      # Another address still reaches the queue (and is refused by it, 409).
      assert from(conn, {10, 0, 0, 2}) |> post_json(letters_path(), stone()) |> json_response(409)

      # The window ends: both budgets start again.
      TestClock.advance(3_600_000)
      assert conn |> post_json(letters_path(), stone()) |> json_response(409)
    end

    test "an IPv6 address is budgeted as its /64; an IPv4-mapped one as its IPv4 address", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      garden!()

      a = {0x2001, 0xDB8, 1, 2, 0, 0, 0, 1}
      same_net = {0x2001, 0xDB8, 1, 2, 0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD}
      other_net = {0x2001, 0xDB8, 1, 3, 0, 0, 0, 1}

      assert from(conn, a) |> post_json(letters_path(), stone()) |> json_response(201)
      assert from(conn, a) |> post_json(letters_path(), stone()) |> json_response(429)
      assert from(conn, same_net) |> post_json(letters_path(), stone()) |> json_response(429)
      assert from(conn, other_net) |> post_json(letters_path(), stone()) |> json_response(201)

      mapped = {0, 0, 0, 0, 0, 0xFFFF, 0x0A00, 0x0003}
      assert from(conn, {10, 0, 0, 3}) |> post_json(letters_path(), stone()) |> json_response(201)
      assert from(conn, mapped) |> post_json(letters_path(), stone()) |> json_response(429)
    end

    test "the unnamed routes are the configured garden whatever ?name= or the body says", %{
      conn: conn
    } do
      garden!()
      garden!(%{"name" => "other", "seed" => 2})

      assert %{"name" => "commons"} =
               conn |> get("/api/public/garden?name=other") |> json_response(200)

      assert conn
             |> post_json("/api/public/garden/letters?name=other", stone(%{"name" => "other"}))
             |> json_response(422)

      assert conn
             |> post_json("/api/public/garden/letters?name=other", stone())
             |> json_response(201)

      assert %{"letters" => %{"queued" => 1}} =
               conn |> get("/api/public/gardens/commons") |> json_response(200)

      assert %{"letters" => %{"queued" => 0}} =
               conn |> get("/api/public/gardens/other") |> json_response(200)
    end

    test "a letter body over 1 KB is a 413 before it is parsed", %{conn: conn} do
      garden!()
      big = stone(%{"pad" => String.duplicate("a", 2_000)})

      huge_x =
        Jason.encode!(%{"kind" => "stone", "x" => 0, "y" => 0, "r" => 1})
        |> String.replace("\"x\":0", "\"x\":" <> String.duplicate("9", 4_000))

      assert_error_sent 413, fn -> post_json(conn, letters_path(), big) end
      assert_error_sent 413, fn -> post_json(conn, "/api/public/garden/letters", huge_x) end

      # A small bignum that fits is refused as out of range, not parsed into the garden.
      small = ~s({"kind":"stone","x":#{String.duplicate("9", 60)},"y":0,"r":1})

      assert %{"error" => "x is out of range"} =
               conn |> post_json(letters_path(), small) |> json_response(422)

      # The island routes keep their own, larger, limit.
      assert conn
             |> post_json("/api/islands", %{"adapter" => String.duplicate("a", 5_000)})
             |> json_response(200)
    end

    test "the 1 KB limit holds however the letter route's path is spelled", %{conn: conn} do
      garden!()
      big = stone(%{"pad" => String.duplicate("a", 2_000)})

      # Phoenix routes on decoded segments, so these all reach `post_letter`.
      for path <- [
            "/api/public/gard%65n/letters",
            "/api/public/garden/%6cetters",
            "/api/public/gardens/commons/%6cetters",
            "/api/public/gardens/%63ommons/letters",
            "/api/%70ublic/gardens/commons/letters"
          ] do
        assert_error_sent 413, fn -> post_json(conn, path, big) end
      end

      # ...and an ordinary letter on an encoded path is still a letter.
      assert conn
             |> post_json("/api/public/gardens/%63ommons/letters", stone())
             |> json_response(201)
    end

    test "a letter route refuses forms and multipart (415) before reading them", %{conn: conn} do
      garden!()
      form = "kind=stone&x=1&y=2&r=3&pad=" <> String.duplicate("a", 2_000)

      multipart =
        "--b\r\ncontent-disposition: form-data; name=\"kind\"\r\n\r\nstone\r\n--b--\r\n"

      for path <- [letters_path(), "/api/public/garden/letters", "/api/public/gard%65n/letters"] do
        assert_error_sent 415, fn ->
          conn
          |> put_req_header("content-type", "application/x-www-form-urlencoded")
          |> post(path, form)
        end

        assert_error_sent 415, fn ->
          conn
          |> put_req_header("content-type", "multipart/form-data; boundary=b")
          |> post(path, multipart)
        end

        assert_error_sent 415, fn ->
          conn |> put_req_header("content-type", "text/plain") |> post(path, "hi")
        end
      end

      # JSON with a charset is JSON.
      assert conn
             |> put_req_header("content-type", "application/json; charset=utf-8")
             |> post(letters_path(), Jason.encode!(stone()))
             |> json_response(201)
    end

    test "a view read before a letter and stored after it is not served", %{conn: _conn} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()

      gen = LetterLimiter.generation("commons")
      LetterLimiter.invalidate("commons")
      LetterLimiter.put_view("commons", "stale", gen)
      assert LetterLimiter.cached_view("commons") == :miss

      LetterLimiter.put_view("commons", "fresh", LetterLimiter.generation("commons"))
      assert LetterLimiter.cached_view("commons") == {:ok, "fresh"}
      LetterLimiter.invalidate("commons")
      assert LetterLimiter.cached_view("commons") == :miss
    end

    test "checkpoint lookups are cached outside the queue until the garden is invalidated", %{
      conn: conn,
      dir: dir
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      a = join("A")
      b = join("B")
      run_and_verify(dir, a, b)

      path = "/api/public/gardens/commons/checkpoints/#{dg(0)}"
      assert conn |> get(path) |> response(200) == "x"

      without_queue(fn ->
        assert conn |> get(path) |> response(200) == "x"
        # A digest nobody has is answered from the same cached set.
        assert conn
               |> get("/api/public/gardens/commons/checkpoints/#{dg(3)}")
               |> json_response(404)
      end)
    end
  end

  # ---- a crowd at the cache, and the limiter restarting ----

  describe "a crowd missing the cache together" do
    defp crowd(n, path), do: for(_ <- 1..n, do: Task.async(fn -> get(build_conn(), path) end))

    defp mailbox, do: Queue |> Process.whereis() |> Process.info(:message_queue_len) |> elem(1)

    defp until(fun, deadline \\ System.monotonic_time(:millisecond) + 5_000) do
      cond do
        fun.() -> :ok
        System.monotonic_time(:millisecond) > deadline -> flunk("timed out")
        true -> until_after_sleep(fun, deadline)
      end
    end

    defp until_after_sleep(fun, deadline) do
      Process.sleep(5)
      until(fun, deadline)
    end

    # Runs `fun` with the Queue suspended, so every call into it waits in its
    # mailbox and can be counted there.
    defp counting_queue_calls(fun) do
      :ok = :sys.suspend(Queue)

      try do
        fun.()
      after
        :sys.resume(Queue)
      end
    end

    test "on a cold key: one queue call, everyone else waits for its answer", %{conn: _conn} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      path = "/api/public/gardens/commons"

      tasks =
        counting_queue_calls(fn ->
          tasks = crowd(100, path)
          until(fn -> mailbox() >= 1 end)
          Process.sleep(200)
          assert mailbox() == 1
          tasks
        end)

      bodies = tasks |> Task.await_many(10_000) |> Enum.map(&response(&1, 200))
      assert [body] = Enum.uniq(bodies)
      assert %{"name" => "commons"} = Jason.decode!(body)
    end

    test "on an expired entry: one queue call, everyone else gets the old entry at once", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 50)
      garden!()
      path = "/api/public/gardens/commons"
      queued = &(&1 |> response(200) |> Jason.decode!() |> get_in(["letters", "queued"]))

      assert conn |> get(path) |> queued.() == 0
      # Not through the controller, so nothing invalidates the entry; it only expires.
      {:ok, _} = Queue.post_letter("commons", %{x: 5, y: 5, r: 2})
      Process.sleep(80)

      {served, [refresher]} =
        counting_queue_calls(fn ->
          tasks = crowd(100, path)
          until(fn -> mailbox() >= 1 end)
          done = Task.yield_many(tasks, 2_000)
          assert mailbox() == 1
          {for({_, {:ok, c}} <- done, do: c), for({t, nil} <- done, do: t)}
        end)

      assert length(served) == 99
      assert Enum.all?(served, &(queued.(&1) == 0))
      assert refresher |> Task.await(10_000) |> queued.() == 1
      assert conn |> get(path) |> queued.() == 1
    end

    test "checkpoint lookups are coalesced the same way", %{conn: _conn, dir: dir} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      run_and_verify(dir, join("A"), join("B"))
      path = "/api/public/gardens/commons/checkpoints/#{dg(0)}"

      tasks =
        counting_queue_calls(fn ->
          tasks = crowd(50, path)
          until(fn -> mailbox() >= 1 end)
          Process.sleep(200)
          assert mailbox() == 1
          tasks
        end)

      assert tasks |> Task.await_many(10_000) |> Enum.all?(&(response(&1, 200) == "x"))
    end

    test "a refresh outlasting the wait: the others get a 503, and never ask the queue", %{
      conn: _conn,
      dir: dir
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      Application.put_env(:coordinator, :garden_cache_wait_ms, 300)
      garden!()
      run_and_verify(dir, join("A"), join("B"))

      for path <- [
            "/api/public/gardens/commons",
            "/api/public/gardens/commons/checkpoints/#{dg(0)}"
          ] do
        {[winner], waiters} =
          counting_queue_calls(fn ->
            winner = crowd(1, path)
            until(fn -> mailbox() >= 1 end)
            waiters = 20 |> crowd(path) |> Task.await_many(10_000)
            assert mailbox() == 1
            {winner, waiters}
          end)

        for c <- waiters do
          assert %{"error" => "the garden is busy; retry shortly"} = json_response(c, 503)
          assert get_resp_header(c, "retry-after") == ["1"]
        end

        assert winner |> Task.await(10_000) |> response(200)
      end
    end

    test "a refresh marker that outlives its refresher blocks only until it expires", %{
      conn: conn
    } do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      Application.put_env(:coordinator, :garden_cache_wait_ms, 100)
      garden!()
      views = :coordinator_garden_views
      now = System.monotonic_time(:millisecond)

      # A refresher that died holding the marker: nobody asks the queue.
      :ets.insert(views, {{:refresh, "commons"}, now, make_ref()})

      without_queue(fn ->
        assert conn |> get("/api/public/gardens/commons") |> json_response(503)
      end)

      # Five seconds on, the marker is taken over and the view fetched.
      :ets.insert(views, {{:refresh, "commons"}, now - 5_001, make_ref()})

      assert %{"name" => "commons"} =
               conn |> get("/api/public/gardens/commons") |> json_response(200)
    end

    test "a letter posted over HTTP is still seen by its poster", %{conn: conn} do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)
      garden!()
      path = "/api/public/gardens/commons"

      assert conn |> get(path) |> json_response(200) |> get_in(["letters", "queued"]) == 0
      assert conn |> post_json(letters_path(), stone()) |> json_response(201)

      for c <- 20 |> crowd(path) |> Task.await_many(10_000),
          do: assert(c |> json_response(200) |> get_in(["letters", "queued"]) == 1)
    end
  end

  describe "the limiter restarting" do
    test "loses no garden: the view, a letter and a checkpoint still work", %{
      conn: conn,
      dir: dir
    } do
      garden!()
      run_and_verify(dir, join("A"), join("B"))

      :ok = Supervisor.terminate_child(Coordinator.Supervisor, LetterLimiter)
      {:ok, _} = Supervisor.restart_child(Coordinator.Supervisor, LetterLimiter)

      assert %{"name" => "commons"} =
               conn |> get("/api/public/gardens/commons") |> json_response(200)

      assert conn |> post_json(letters_path(), stone()) |> json_response(201)

      assert conn
             |> get("/api/public/gardens/commons/checkpoints/#{dg(0)}")
             |> response(200) == "x"

      assert conn |> get("/api/public/gardens/nope") |> json_response(404)
    end
  end

  # ---- the keeper's recovery ----

  describe "requeue" do
    @tag :capture_log
    test "puts a failed day back (admin only); other days are refused", %{conn: conn} do
      garden!()
      path = fn name, i -> "/api/gardens/#{name}/days/#{i}/requeue" end

      a = join("A")
      task = next(a)
      assert :ok = Queue.fail(task.segment.id, a, task.lease, "cannot run")

      assert conn |> get("/api/public/garden") |> json_response(200) |> Map.fetch!("state") ==
               "stopped"

      Application.put_env(:coordinator, :allow_local_admin, false)
      Application.put_env(:coordinator, :admin_token, "secret")
      assert conn |> post(path.("commons", 0)) |> json_response(401)
      assert conn |> from({10, 0, 0, 9}) |> post(path.("commons", 0)) |> json_response(401)

      keeper = put_req_header(conn, "authorization", "Bearer secret")

      assert %{"day" => 0, "status" => "pending"} =
               keeper |> post(path.("commons", 0)) |> json_response(200)

      assert conn |> get("/api/public/garden") |> json_response(200) |> Map.fetch!("state") ==
               "waiting-for-island"

      # Not failed any more: refused; unknown day, garden or a bad index: not found.
      assert %{"error" => "day 0 is pending" <> _} =
               keeper |> post(path.("commons", 0)) |> json_response(409)

      assert keeper |> post(path.("commons", 99)) |> json_response(404)
      assert keeper |> post(path.("nope", 0)) |> json_response(404)
      assert keeper |> post(path.("commons", "x")) |> json_response(404)
    end
  end
end
