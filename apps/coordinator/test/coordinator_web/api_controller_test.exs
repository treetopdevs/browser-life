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
               "observerHash" => "0123456789abcdef",
               "lease" => task["lease"]
             })
             |> json_response(409)
  end
end
