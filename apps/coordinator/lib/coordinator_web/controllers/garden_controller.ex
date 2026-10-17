defmodule CoordinatorWeb.GardenController do
  @moduledoc """
  The garden's HTTP surface (README "The garden", contract `garden-v1`).

  Public, unauthenticated: the view (`show`), posting a letter (`post_letter`)
  and a verified day's end checkpoint (`checkpoint`). Keeper (admin): founding
  a garden (`create`), the veto (`drop`) and requeueing a failed or diverged
  day (`requeue`).

  Everything that can be answered without the serialized `Coordinator.Queue`
  process is answered before it, because every public request that reaches the
  Queue queues in front of or behind an island's `/api/next`. Names, letter ids
  and digests are shape-checked; whether the garden exists and how big its world
  is come from `Coordinator.LetterLimiter`'s registry (so an unknown name is a
  404 and a centre outside the world a 422 with no Queue call); a letter's body
  is validated purely (`Coordinator.Garden.parse_letter/1`) and its size is
  capped before it is parsed (`CoordinatorWeb.LetterBodyLimit`); and only then
  does a request pay the rate limiter and, last, the Queue. The public view and
  the checkpoint lookup are served from the limiter's short-lived ETS cache,
  with concurrent misses coalesced into one Queue call, so a crowd reading the
  page costs the Queue about one call per cache period.

  The unnamed public routes serve the configured `:public_garden` and nothing
  else: a `name` in the query string or the body is not a garden name.
  """
  use CoordinatorWeb, :controller
  alias Coordinator.{Garden, LetterLimiter, Queue}

  import CoordinatorWeb.Auth, only: [require_admin: 2]

  plug :require_admin when action in [:create, :drop, :requeue]

  @name_re ~r/^[a-z0-9][a-z0-9_-]{0,63}$/
  @letter_re ~r/^ltr-[0-9]{1,9}$/
  @digest_re ~r/^[0-9a-f]{16}$/
  @day_re ~r/^[0-9]{1,9}$/

  # ---- public ----

  # `GET /api/public/garden` (the configured public garden) and
  # `GET /api/public/gardens/:name`. The body is cached already encoded; a
  # crowd missing the cache together makes one Queue call
  # (`LetterLimiter.fetch_view/2`).
  def show(conn, _params) do
    with {:ok, name} <- garden_name(conn),
         {_w, _h} <- LetterLimiter.garden_world(name),
         body when is_binary(body) <- LetterLimiter.fetch_view(name, fn -> view(name) end) do
      send_view(conn, body)
    else
      _ -> not_found(conn)
    end
  end

  # `POST /api/public/garden/letters` and `POST /api/public/gardens/:name/letters`.
  # Order: shape (422), the garden (404) and its world (422), the address's
  # budget (429), then the Queue (409 for a garden that takes no letters). A
  # letter the Queue refuses is given back, but the refusal is charged to the
  # address (`LetterLimiter.refuse/1`), so refused letters are not a free way
  # to keep the Queue busy.
  def post_letter(conn, _params) do
    with {:ok, name} <- garden_name(conn),
         {:ok, letter} <- parse(conn),
         {:ok, world} <- world(name),
         :ok <- in_world(world, letter),
         {:ok, token} <- take(conn) do
      case Queue.post_letter(name, letter) do
        {:ok, view} ->
          LetterLimiter.invalidate(name)
          conn |> put_status(201) |> json(%{letter: view})

        {:error, :not_found} ->
          LetterLimiter.refuse(token)
          not_found(conn)

        {:error, {:invalid, why}} ->
          LetterLimiter.refuse(token)
          error(conn, 422, why)

        {:error, {:refused, why}} ->
          LetterLimiter.refuse(token)
          error(conn, 409, why)
      end
    else
      :error ->
        not_found(conn)

      {:error, :invalid, why} ->
        error(conn, 422, why)

      {:error, :limited, retry_after_ms} ->
        conn
        |> put_resp_header("retry-after", Integer.to_string(div(retry_after_ms + 999, 1000)))
        |> put_status(429)
        |> json(%{error: "too many letters from this address", retryAfterMs: retry_after_ms})
    end
  end

  # `GET /api/public/gardens/:name/checkpoints/:digest`: the end checkpoint of a
  # verified day, by its digest, and nothing else (the Queue says which digests
  # those are; the answer is cached like the view).
  def checkpoint(conn, %{"name" => name, "digest" => digest}) do
    with true <- name?(name),
         true <- is_binary(digest) and Regex.match?(@digest_re, digest),
         {_w, _h} <- LetterLimiter.garden_world(name),
         path when is_binary(path) <- Map.get(checkpoints(name), digest) do
      conn |> put_resp_content_type("application/octet-stream") |> send_file(200, path)
    else
      _ -> not_found(conn)
    end
  end

  def checkpoint(conn, _params), do: not_found(conn)

  # ---- keeper ----

  # `POST /api/gardens`: the body, not the merged params (no path or query key
  # can reach the garden's parameters).
  def create(conn, _params) do
    body = body_map(conn)

    case Queue.create_garden(body) do
      {:ok, days} ->
        name = body["name"]
        LetterLimiter.invalidate(name)
        json(conn, %{garden: name, days: days})

      {:error, why} ->
        error(conn, 422, why)
    end
  end

  # `POST /api/gardens/:name/letters/:id/drop`.
  def drop(conn, %{"name" => name, "id" => id}) do
    with true <- name?(name),
         true <- is_binary(id) and Regex.match?(@letter_re, id),
         {:ok, view} <- drop_letter(name, id) do
      LetterLimiter.invalidate(name)
      json(conn, %{letter: view})
    else
      {:error, {:refused, why}} -> error(conn, 409, why)
      _ -> not_found(conn)
    end
  end

  # `POST /api/gardens/:name/days/:index/requeue`: the keeper puts a failed or
  # diverged day back in the queue (and the days behind it, blocked by it, back
  # to waiting), so that one volunteer's bad report does not end the garden for
  # good. The day's letters stay as they were: the slice it owns is frozen.
  def requeue(conn, %{"name" => name, "index" => index}) do
    with true <- name?(name),
         true <- is_binary(index) and Regex.match?(@day_re, index),
         {:ok, status} <- Queue.requeue_garden_day(name, String.to_integer(index)) do
      LetterLimiter.invalidate(name)
      json(conn, %{day: String.to_integer(index), status: status})
    else
      {:error, {:refused, why}} -> error(conn, 409, why)
      _ -> not_found(conn)
    end
  end

  defp drop_letter(name, id) do
    case Queue.drop_letter(name, id) do
      {:ok, view} -> {:ok, view}
      {:error, {:refused, why}} -> {:error, {:refused, why}}
      {:error, _} -> :error
    end
  end

  # ---- helpers ----

  # The garden a request names: the route's own `:name`, or (the unnamed public
  # routes) the configured `:public_garden`; `:error` if it is not shaped like
  # one. Only the path is read: a `name` in the query string or the body is
  # data, not a different garden.
  defp garden_name(conn) do
    name = Map.get(conn.path_params, "name") || Application.get_env(:coordinator, :public_garden)
    if name?(name), do: {:ok, name}, else: :error
  end

  defp name?(name), do: is_binary(name) and Regex.match?(@name_re, name)

  defp world(name) do
    case LetterLimiter.garden_world(name) do
      {_w, _h} = world -> {:ok, world}
      nil -> :error
    end
  end

  # The garden's own bounds check, on the registry's copy of its size, so a
  # centre outside the world never reaches the Queue.
  defp in_world({width, height}, letter) do
    case Garden.check_bounds(%{width: width, height: height}, letter) do
      :ok -> :ok
      {:error, why} -> {:error, :invalid, why}
    end
  end

  # The encoded view, for `LetterLimiter.fetch_view/2`: an unknown garden is
  # not cached.
  defp view(name) do
    case Queue.garden_view(name) do
      nil -> {:skip, nil}
      view -> {:cache, view |> Jason.encode_to_iodata!() |> IO.iodata_to_binary()}
    end
  end

  # `%{digest => path}` of the garden's servable checkpoints, from the cache or
  # (one coalesced call per cache period) the Queue.
  defp checkpoints(name),
    do: LetterLimiter.fetch_checkpoints(name, fn -> {:cache, Queue.garden_checkpoints(name)} end)

  # A letter body: exactly what the JSON parser decoded (not `params`, which also
  # holds the path's name and the query string).
  defp parse(conn) do
    case Garden.parse_letter(body_map(conn)) do
      {:ok, letter} -> {:ok, letter}
      {:error, why} -> {:error, :invalid, why}
    end
  end

  defp take(conn) do
    case LetterLimiter.take(address(conn)) do
      {:ok, token} -> {:ok, token}
      {:error, retry_after_ms} -> {:error, :limited, retry_after_ms}
    end
  end

  defp body_map(%Plug.Conn{body_params: %Plug.Conn.Unfetched{}}), do: %{}
  defp body_map(%Plug.Conn{body_params: body}) when is_map(body), do: body
  defp body_map(_), do: %{}

  # The network address the letter budget is kept against: the peer, or (only
  # when a reverse proxy we trust sets it, `:trust_forwarded_for`) the right-most
  # entry of X-Forwarded-For, which is the one that proxy appended. If that entry
  # is not an address the peer is used: an entry further left was written by the
  # client, and is never a fallback. (The origin port must then only be
  # reachable through the proxy, or a client names itself.)
  defp address(conn) do
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

  defp send_view(conn, body) do
    conn
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_content_type("application/json")
    |> send_resp(200, body)
  end

  defp error(conn, status, why), do: conn |> put_status(status) |> json(%{error: why})
  defp not_found(conn), do: error(conn, 404, "not found")
end
