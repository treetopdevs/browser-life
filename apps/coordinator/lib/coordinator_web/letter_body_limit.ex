defmodule CoordinatorWeb.LetterBodyLimit do
  @moduledoc """
  Parses the body of the public letter routes (and the food hands route) with a tiny length limit, ahead
  of the endpoint's own `Plug.Parsers` (8 MB by default, right for the
  island routes that carry summaries and manifests).

  A letter is `{"kind":"stone","x":1,"y":2,"r":3}`: about 40 bytes. These
  routes are unauthenticated, so without a limit of their own a visitor could
  make the server read, decode and copy megabytes (a JSON integer of a million
  digits is a bignum) before the controller says 422. Here a body past
  1024 bytes raises `Plug.Parsers.RequestTooLargeError` (413) after at most
  that many bytes have been read, and only JSON is accepted at all: any other
  content type (a form, multipart) raises `Plug.Parsers.UnsupportedMediaTypeError`
  (415) before its body is read. (A request with no content type is not parsed
  by either parser; its letter is empty and the controller says 422.)

  The route is recognised the way `Phoenix.Router` recognises it, on
  URI-decoded path segments, so `/api/public/gard%65n/letters` is a letter
  route here too and does not reach the general parser.

  The result is stored in the connection exactly where `Plug.Parsers` stores
  it, and `Plug.Parsers` does not read a body it finds parsed already, so nothing
  downstream changes.
  """
  @behaviour Plug

  @max_bytes 1024

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
    # As `Phoenix.Router.call/2` decodes them; a malformed escape raises here
    # just as it would there, before any parser reads the body.
    if letter_route?(Enum.map(path_info, &URI.decode/1)),
      do: Plug.Parsers.call(conn, parsers),
      else: conn
  end

  def call(conn, _parsers), do: conn

  defp letter_route?(["api", "public", "garden", "letters"]), do: true
  defp letter_route?(["api", "public", "gardens", _name, "letters"]), do: true
  # A food hand (`{}`) is held to the same limits.
  defp letter_route?(["api", "public", "garden", "food", "hands"]), do: true
  defp letter_route?(["api", "public", "gardens", _name, "food", "hands"]), do: true
  # So is a meteor hand.
  defp letter_route?(["api", "public", "garden", "meteor", "hands"]), do: true
  defp letter_route?(["api", "public", "gardens", _name, "meteor", "hands"]), do: true
  defp letter_route?(_), do: false
end
