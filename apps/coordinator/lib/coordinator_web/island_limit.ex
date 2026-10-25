defmodule CoordinatorWeb.IslandLimit do
  @moduledoc """
  Function plugs that charge the island routes' budgets
  (`Coordinator.IslandLimiter`) before the Queue is called, and answer 429 the
  way the garden's letter routes do: a `retry-after` header in whole seconds
  (rounded up) and `{"error": ..., "retryAfterMs": n}`.

    * `limit_join/2`: the join budget of the client address
      (`CoordinatorWeb.ClientAddress`);
    * `limit_next/2`: the next budget of the authenticated island (put it after
      the island is authenticated, so a 401 charges nothing);
    * `limit_segment/2`: the segment-route budget of the authenticated island
      (heartbeat, complete, reject, fail, uploads, checkpoint downloads), after
      authentication like `limit_next/2`;
    * `limit_island_download/2`: file downloads (`get_file`), charged to the
      same segment budget when an island made them and never when the
      administrator did (`tools/stitch.ts` exports); put it after
      `require_island_or_admin`, which assigns `:island` only to an island;
    * `limit_requests/2`: the coarse per-address ceiling, a no-op while
      `island_requests_per_address` is `nil`.
  """
  import Plug.Conn
  alias Coordinator.IslandLimiter
  alias CoordinatorWeb.ClientAddress

  @spec limit_join(Plug.Conn.t(), term) :: Plug.Conn.t()
  def limit_join(conn, _opts),
    do: charge(conn, :join, ClientAddress.of(conn), "too many joins from this address")

  @spec limit_next(Plug.Conn.t(), term) :: Plug.Conn.t()
  def limit_next(conn, _opts),
    do: charge(conn, :next, conn.assigns.island, "too many task requests from this island")

  @spec limit_segment(Plug.Conn.t(), term) :: Plug.Conn.t()
  def limit_segment(conn, _opts),
    do: charge(conn, :segment, conn.assigns.island, "too many segment requests from this island")

  @spec limit_island_download(Plug.Conn.t(), term) :: Plug.Conn.t()
  def limit_island_download(%{assigns: %{island: island}} = conn, _opts) when is_binary(island),
    do: charge(conn, :segment, island, "too many segment requests from this island")

  def limit_island_download(conn, _opts), do: conn

  @spec limit_requests(Plug.Conn.t(), term) :: Plug.Conn.t()
  def limit_requests(conn, _opts),
    do: charge(conn, :requests, ClientAddress.of(conn), "too many requests from this address")

  defp charge(conn, kind, key, message) do
    case IslandLimiter.take(kind, key) do
      :ok ->
        conn

      {:error, retry_after_ms} ->
        Coordinator.OperatorEvents.rate_refusal(kind)

        conn
        |> put_resp_header("retry-after", Integer.to_string(div(retry_after_ms + 999, 1000)))
        |> put_status(429)
        |> Phoenix.Controller.json(%{error: message, retryAfterMs: retry_after_ms})
        |> halt()
    end
  end
end
