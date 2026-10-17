defmodule CoordinatorWeb.LetterBodyLimit do
  @moduledoc """
  Parses the body of the public letter routes with a tiny length limit, ahead
  of the endpoint's own `Plug.Parsers` (8 MB by default, right for the
  island routes that carry summaries and manifests).

  A letter is `{"kind":"stone","x":1,"y":2,"r":3}`: about 40 bytes. These
  routes are unauthenticated, so without a limit of their own a visitor could
  make the server read, decode and copy megabytes (a JSON integer of a million
  digits is a bignum) before the controller says 422. Here a body past
  1024 bytes raises `Plug.Parsers.RequestTooLargeError` (413) after at most
  that many bytes have been read, and only JSON is parsed at all: any other
  content type leaves the letter's body empty, which the controller refuses.

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
      pass: ["*/*"],
      json_decoder: Phoenix.json_library(),
      length: @max_bytes
    )
  end

  @impl true
  def call(
        %Plug.Conn{method: "POST", path_info: ["api", "public", "garden", "letters"]} = conn,
        parsers
      ),
      do: Plug.Parsers.call(conn, parsers)

  def call(
        %Plug.Conn{method: "POST", path_info: ["api", "public", "gardens", _name, "letters"]} =
          conn,
        parsers
      ),
      do: Plug.Parsers.call(conn, parsers)

  def call(conn, _parsers), do: conn
end
