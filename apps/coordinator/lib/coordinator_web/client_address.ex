defmodule CoordinatorWeb.ClientAddress do
  @moduledoc """
  The network address a per-address budget is kept against, by the same rule
  as the garden's letter budget (`CoordinatorWeb.GardenController`'s
  `address/1`): the peer, or (only when a reverse proxy we trust sets it,
  `:trust_forwarded_for`) the right-most entry of `X-Forwarded-For`, which is
  the one that proxy appended. If that entry is not an address the peer is
  used: an entry further left was written by the client, and is never a
  fallback. (The origin port must then only be reachable through the proxy,
  or a client names itself; see deploy/README.md for what the deployed proxy
  chain actually sends.)
  """
  import Plug.Conn

  @doc "The client address of `conn` (an IP tuple)."
  @spec of(Plug.Conn.t()) :: :inet.ip_address()
  def of(conn) do
    if Application.get_env(:coordinator, :trust_forwarded_for, false) do
      conn
      |> get_req_header("x-forwarded-for")
      |> Enum.flat_map(&String.split(&1, ","))
      |> List.last()
      |> parse_ip()
      |> Kernel.||(conn.remote_ip)
    else
      conn.remote_ip
    end
  end

  defp parse_ip(nil), do: nil

  defp parse_ip(entry) do
    case :inet.parse_address(entry |> String.trim() |> String.to_charlist()) do
      {:ok, ip} -> ip
      _ -> nil
    end
  end
end
