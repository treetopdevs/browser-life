defmodule CoordinatorWeb.Auth do
  @moduledoc """
  Keeper (administrator) authentication, shared by the controllers that have
  admin routes (`ApiController`: creating an experiment, exporting; and
  `GardenController`: founding a garden, dropping a letter).

  A configured admin token is always required. Without one, admin routes are
  refused unless tokenless local administration is explicitly enabled
  (`allow_local_admin`, dev and test only; behind a reverse proxy every peer is
  loopback, so it must stay off in production, where `BL_ADMIN_TOKEN` is
  required anyway).
  """
  import Plug.Conn

  @doc "Whether the request carries the admin token, or comes from loopback with local administration enabled."
  @spec admin?(Plug.Conn.t()) :: boolean
  def admin?(conn) do
    admin = Application.get_env(:coordinator, :admin_token)

    cond do
      is_binary(admin) and admin != "" ->
        is_binary(bearer(conn)) and Plug.Crypto.secure_compare(bearer(conn), admin)

      Application.get_env(:coordinator, :allow_local_admin, false) ->
        loopback?(conn.remote_ip)

      true ->
        false
    end
  end

  @doc "The `Authorization: Bearer` token of the request, or nil."
  @spec bearer(Plug.Conn.t()) :: String.t() | nil
  def bearer(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> t] -> t
      _ -> nil
    end
  end

  @doc "A function plug: 401 `{\"error\": \"admin authentication required\"}` unless `admin?/1`."
  @spec require_admin(Plug.Conn.t(), term) :: Plug.Conn.t()
  def require_admin(conn, _opts) do
    if admin?(conn) do
      conn
    else
      conn
      |> put_status(401)
      |> Phoenix.Controller.json(%{error: "admin authentication required"})
      |> halt()
    end
  end

  defp loopback?({127, _, _, _}), do: true
  defp loopback?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback?(_), do: false
end
