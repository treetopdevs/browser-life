defmodule CoordinatorWeb.IslandBodyLimit do
  @moduledoc """
  Parses the body of `POST /api/islands` (join) and `POST /api/next` with a
  small length limit, ahead of the endpoint's own `Plug.Parsers` (8 MB by
  default, right for the routes that carry summaries and manifests), the way
  `CoordinatorWeb.LetterBodyLimit` does for the garden's letters.

  A join body is `{"adapter": ..., "userAgent": ..., "metricsVersion": n,
  "gardenToken": ...}` (both strings clipped to 200 characters by the Queue)
  and a next body is `{"capabilities": [...]}` (at most 16 strings of at most
  64 bytes): well under a kilobyte each. Join is unauthenticated, so without a
  limit of its own a client could make the server read and decode megabytes
  before anything looks at them. The limit is 16 KB, not tighter: an island
  that sends a long adapter description is clipped by the Queue, not refused
  (`CoordinatorWeb.GardenApiTest` posts a 5,000-byte one). A body past it raises
  `Plug.Parsers.RequestTooLargeError` (413) after at most that many bytes have
  been read, and only JSON is accepted: any other content type raises
  `Plug.Parsers.UnsupportedMediaTypeError` (415) before its body is read. A
  request with no content type is not parsed (its params are empty, as before;
  older islands send no body at all), but its body is still read here, up to
  the same limit, and discarded: `Plug.Parsers` leaves such a body unread, and
  the server would otherwise drain it after the reply with its own, much
  larger, allowance. Past the limit it is the same 413.

  Routes are recognised on URI-decoded path segments, as `Phoenix.Router` does.
  The result is stored where `Plug.Parsers` stores it, and `Plug.Parsers` does
  not read a body it finds parsed already.
  """
  @behaviour Plug

  @max_bytes 16_384

  @impl true
  def init(_opts) do
    Plug.Parsers.init(
      parsers: [:json],
      pass: [],
      json_decoder: Phoenix.json_library(),
      length: @max_bytes
    )
  end

  @impl true
  def call(%Plug.Conn{method: "POST", path_info: path_info} = conn, parsers) do
    if island_route?(Enum.map(path_info, &URI.decode/1)),
      do: conn |> drain_untyped() |> Plug.Parsers.call(parsers),
      else: conn
  end

  def call(conn, _parsers), do: conn

  # A body with no content type, read (and dropped) within the limit; chunked
  # bodies included, since the read stops at the limit whatever the framing.
  defp drain_untyped(conn) do
    if Plug.Conn.get_req_header(conn, "content-type") == [] do
      case Plug.Conn.read_body(conn, length: @max_bytes, read_length: @max_bytes) do
        {:ok, _body, conn} -> conn
        {:more, _partial, _conn} -> raise Plug.Parsers.RequestTooLargeError
        {:error, :timeout} -> raise Plug.TimeoutError
        {:error, _} -> raise Plug.BadRequestError
      end
    else
      conn
    end
  end

  defp island_route?(["api", "islands"]), do: true
  defp island_route?(["api", "next"]), do: true
  defp island_route?(_), do: false
end
