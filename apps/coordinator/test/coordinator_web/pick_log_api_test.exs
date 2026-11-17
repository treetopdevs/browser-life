defmodule CoordinatorWeb.PickLogApiTest do
  # PUT/GET /api/pick-logs/:sha (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02): who may store and read a
  # pick log, what is refused, and that an ordinary experiment's payloads are untouched.
  use CoordinatorWeb.ConnCase, async: false
  alias Coordinator.{PickLog, Queue}

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-picklog-api-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    on_exit(fn -> File.rm_rf!(dir) end)
    :ok
  end

  @log ~s({"step":5000,"kind":"pick","cycle":1,"donors":[2,0]}\n{"step":10000,"kind":"pick","cycle":2,"donors":[1]}\n)

  defp admin_token!(token \\ "test-admin") do
    previous = Application.get_env(:coordinator, :admin_token)
    Application.put_env(:coordinator, :admin_token, token)

    on_exit(fn ->
      if previous,
        do: Application.put_env(:coordinator, :admin_token, previous),
        else: Application.delete_env(:coordinator, :admin_token)
    end)
  end

  defp octet(conn), do: put_req_header(conn, "content-type", "application/octet-stream")
  defp bearer(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  defp put_log(conn, sha, body), do: conn |> octet() |> put("/api/pick-logs/#{sha}", body)

  defp join(conn) do
    body = conn |> post("/api/islands", %{"adapter" => "test"}) |> json_response(200)
    {body["id"], body["token"]}
  end

  defp island(conn, {id, token}), do: conn |> bearer(token) |> put_req_header("x-island-id", id)

  test "put stores once, is idempotent, and get serves the same bytes", %{conn: conn} do
    sha = PickLog.sha256(@log)

    assert %{"ok" => true, "sha256" => ^sha, "picks" => 2} =
             build_conn() |> put_log(sha, @log) |> json_response(200)

    assert %{"ok" => true, "picks" => 2} =
             build_conn() |> put_log(sha, @log) |> json_response(200)

    assert File.exists?(Coordinator.Store.blob_path(Queue.data_dir(), sha))

    got = conn |> get("/api/pick-logs/#{sha}")
    assert response(got, 200) == @log
    assert get_resp_header(got, "content-type") |> hd() =~ "application/octet-stream"
  end

  test "a wrong digest, an unsorted log and an oversize body are refused and nothing is stored" do
    sha = PickLog.sha256(@log)

    assert %{"error" => "pick log hashes to" <> _} =
             build_conn() |> put_log(String.duplicate("a", 64), @log) |> json_response(409)

    refute File.exists?(Coordinator.Store.blob_path(Queue.data_dir(), String.duplicate("a", 64)))

    unsorted =
      ~s({"step":10000,"kind":"pick","cycle":2,"donors":[1]}\n{"step":5000,"kind":"pick","cycle":1,"donors":[0]}\n)

    assert %{"error" => "pick log line 2" <> _} =
             build_conn() |> put_log(PickLog.sha256(unsorted), unsorted) |> json_response(409)

    big = String.duplicate("x", PickLog.max_bytes() + 1)

    assert %{"error" => "body too large"} =
             build_conn() |> put_log(PickLog.sha256(big), big) |> json_response(409)

    refute File.exists?(Coordinator.Store.blob_path(Queue.data_dir(), sha))
  end

  test "a malformed digest is refused on PUT (422) and is a 404 on GET, before it names any path",
       %{conn: conn} do
    for bad <- ["abc", String.duplicate("A", 64), "..%2F..%2Fstate", String.duplicate("g", 64)] do
      assert %{"error" => _} = build_conn() |> put_log(bad, @log) |> json_response(422)

      assert %{"error" => "not found"} =
               build_conn() |> get("/api/pick-logs/#{bad}") |> json_response(404)
    end

    assert %{"error" => "not found"} =
             conn |> get("/api/pick-logs/#{String.duplicate("0", 64)}") |> json_response(404)
  end

  test "GET does not serve a stored file that no longer validates against its name" do
    sha = PickLog.sha256(@log)
    path = Coordinator.Store.blob_path(Queue.data_dir(), sha)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "damaged\n")

    assert %{"error" => "not found"} =
             build_conn() |> get("/api/pick-logs/#{sha}") |> json_response(404)
  end

  test "auth: PUT is admin only; GET is admin or an island; tokenless local admin works in dev/test only when no token is set" do
    sha = PickLog.sha256(@log)

    # No admin token configured and local admin on (the test config): loopback is the administrator.
    assert build_conn() |> put_log(sha, @log) |> json_response(200)

    admin_token!()

    assert %{"error" => "admin authentication required"} =
             build_conn() |> put_log(sha, @log) |> json_response(401)

    assert build_conn() |> bearer("wrong") |> put_log(sha, @log) |> json_response(401)
    assert build_conn() |> bearer("test-admin") |> put_log(sha, @log) |> json_response(200)

    {id, token} = join(build_conn())
    # An island may not store a pick log.
    assert build_conn() |> island({id, token}) |> put_log(sha, @log) |> json_response(401)

    # GET: unauthenticated refused, administrator and an authenticated island served.
    assert build_conn() |> get("/api/pick-logs/#{sha}") |> json_response(401)

    assert build_conn() |> bearer("test-admin") |> get("/api/pick-logs/#{sha}") |> response(200) ==
             @log

    assert build_conn()
           |> bearer(token)
           |> get("/api/pick-logs/#{sha}?island=#{id}")
           |> response(200) == @log

    assert build_conn()
           |> bearer("not-a-token")
           |> get("/api/pick-logs/#{sha}?island=#{id}")
           |> json_response(401)
  end

  test "an ordinary experiment's task payload carries no pick keys and its status is unchanged" do
    assert {:ok, 2} =
             Queue.create_experiment(%{
               "experiment" => "plain",
               "presetId" => "spots",
               "conditions" => ["treatment"],
               "seeds" => [1],
               "steps" => 1000,
               "segmentSteps" => 500,
               "censusEvery" => 100
             })

    {id, token} = join(build_conn())

    task =
      build_conn()
      |> bearer(token)
      |> post("/api/next?island=#{id}", %{"capabilities" => ["ponds-v1", "breed-v1", "picks-v1"]})
      |> json_response(200)

    assert Map.keys(task["spec"]) |> Enum.sort() ==
             ~w(censusEvery checkpointEvery condition deepEvery experiment presetId seed steps)

    refute Map.has_key?(Queue.experiment("plain").spec, "pickLog")
  end
end
