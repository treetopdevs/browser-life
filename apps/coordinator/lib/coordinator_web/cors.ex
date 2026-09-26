defmodule CoordinatorWeb.CORS do
  @moduledoc "Lets lab pages on other origins act as islands. Origins come from config (:cors_origins)."
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    allowed = Application.get_env(:coordinator, :cors_origins, [])
    origin = get_req_header(conn, "origin") |> List.first()

    conn =
      if origin && ("*" in allowed or origin in allowed) do
        conn
        |> put_resp_header("access-control-allow-origin", origin)
        |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, OPTIONS")
        |> put_resp_header("access-control-allow-headers", "content-type, authorization")
        |> put_resp_header("vary", "origin")
      else
        conn
      end

    if conn.method == "OPTIONS", do: conn |> send_resp(204, "") |> halt(), else: conn
  end
end
