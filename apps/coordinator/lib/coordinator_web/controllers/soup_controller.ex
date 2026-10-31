defmodule CoordinatorWeb.SoupController do
  @moduledoc """
  HTTP API of the shared soup (`Coordinator.Soup`), under `/api/soup`.

  An administrator (the admin token, or loopback with `:allow_local_admin`)
  registers worlds and reads the status. Islands are the queue's islands: they
  join through `POST /api/islands` and authenticate here the same way, with
  `?island=<id>` and `Authorization: Bearer <token>` (`Queue.authenticate/2`),
  charged to the same island budgets. Authentication is one queue call that
  also records the island as seen (`Queue.authenticate_and_hold/3`); before
  `next` it also holds the island for a lease's length, and after a lease is
  granted to the lease's exact end, so the island table's pruning never
  forgets an island in the middle of soup work, and a lease is never granted
  to credentials pruned a moment before.

  Uploads are streamed to a staging file under the soup's data directory (at
  most the world's exact snapshot size), their header is checked against the
  segment and they are hashed here in the request process; the soup process
  only records the hash and publishes the file.
  """
  use CoordinatorWeb, :controller
  alias Coordinator.{Queue, Soup, Store}

  import CoordinatorWeb.IslandLimit,
    only: [limit_next: 2, limit_segment: 2, limit_island_download: 2, limit_requests: 2]

  @island_actions [:next, :start, :snapshot, :put_snapshot, :complete]

  plug :limit_requests when action in @island_actions
  plug :require_admin when action in [:register, :status]
  plug :require_island when action in [:next, :start, :put_snapshot, :complete]
  # The accepted end snapshot: an island continuing the chain or the administrator exporting it.
  plug :require_island_or_admin when action == :snapshot
  plug :limit_next when action == :next
  plug :limit_segment when action in [:start, :put_snapshot, :complete]
  # An island's download is a segment request; the administrator's export is not.
  plug :limit_island_download when action == :snapshot

  # ---- admin ----

  def register(conn, params) do
    case Soup.register(Map.drop(params, ["island"])) do
      {:ok, what} -> json(conn, %{status: what, name: params["name"]})
      {:error, why} -> conn |> put_status(422) |> json(%{error: why})
    end
  end

  def status(conn, _),
    do: conn |> put_resp_header("cache-control", "no-store") |> json(Soup.status())

  # ---- island ----

  def next(conn, _) do
    {:ok, reply} = Soup.next(conn.assigns.island)
    # Top the hold up to the lease's exact end (the island is held already).
    if reply[:expiresAt], do: Queue.hold(conn.assigns.island, reply.expiresAt)
    json(conn, reply)
  end

  def start(conn, %{"id" => id}), do: send_snapshot(conn, Soup.start_path(id))

  def snapshot(conn, %{"id" => id}), do: send_snapshot(conn, Soup.end_path(id))

  def put_snapshot(conn, %{"id" => id, "lease" => lease}) when is_binary(lease) do
    island = conn.assigns.island

    case Soup.upload_target(id, island, lease) do
      {:ok, world, epoch} ->
        with_staged(conn, 64 + world["num"] * 64, fn staged ->
          with :ok <- Soup.check_snapshot(staged, world, epoch),
               sha = Store.sha256_file(staged),
               :ok <- Soup.record_upload(id, island, lease, sha, staged) do
            {:ok, %{ok: true, sha: sha}}
          end
        end)

      {:error, why} ->
        conn |> put_status(409) |> json(%{error: why})
    end
  end

  def put_snapshot(conn, _), do: bad(conn, "expected lease")

  def complete(conn, %{"id" => id, "lease" => lease, "sha" => sha})
      when is_binary(lease) and is_binary(sha) do
    if Regex.match?(~r/^[0-9a-f]{64}$/, sha) do
      case Soup.complete(id, conn.assigns.island, lease, sha) do
        {:ok, status} -> json(conn, %{status: status})
        {:error, why} -> conn |> put_status(409) |> json(%{error: why})
      end
    else
      bad(conn, "sha must be 64 lowercase hex digits")
    end
  end

  def complete(conn, _), do: bad(conn, "expected lease and sha")

  # ---- plugs and helpers ----

  defp require_island(conn, _) do
    island = conn.params["island"]

    # Before `next` the island is held for a whole lease, in the same call that
    # authenticates it, so it cannot be pruned between here and the grant.
    hold =
      if action_name(conn) == :next, do: Coordinator.Clock.now() + Soup.lease_ms()

    if is_binary(island) and
         Queue.authenticate_and_hold(island, CoordinatorWeb.Auth.bearer(conn), hold) == :ok do
      assign(conn, :island, island)
    else
      conn |> put_status(401) |> json(%{error: "island authentication required"}) |> halt()
    end
  end

  defp require_admin(conn, opts), do: CoordinatorWeb.Auth.require_admin(conn, opts)

  defp require_island_or_admin(conn, opts),
    do: if(CoordinatorWeb.Auth.admin?(conn), do: conn, else: require_island(conn, opts))

  # Streams from an open descriptor: a snapshot the soup deletes mid-download
  # (Coordinator.Soup's collection) stays readable once opened.
  defp send_snapshot(conn, {:ok, path}) do
    case File.open(path, [:read, :raw, :binary]) do
      {:ok, fd} ->
        try do
          conn
          |> put_resp_content_type("application/octet-stream")
          |> send_chunked(200)
          |> stream_fd(fd)
        after
          File.close(fd)
        end

      {:error, _} ->
        conn |> put_status(404) |> json(%{error: "snapshot missing from the store"})
    end
  end

  defp send_snapshot(conn, {:error, why}), do: conn |> put_status(404) |> json(%{error: why})

  defp stream_fd(conn, fd) do
    case :file.read(fd, 1_048_576) do
      {:ok, data} ->
        case chunk(conn, data) do
          {:ok, conn} -> stream_fd(conn, fd)
          {:error, _} -> conn
        end

      _ ->
        conn
    end
  end

  defp bad(conn, why), do: conn |> put_status(422) |> json(%{error: why})

  # Streams the request body to a temporary file (at most `max` bytes), runs
  # `fun` on it, and always removes the temporary file afterwards (publishing
  # renames it away first). As in `CoordinatorWeb.ApiController`.
  defp with_staged(conn, max, fun) do
    dir = Path.join(Soup.data_dir(), "tmp")
    File.mkdir_p!(dir)
    path = Path.join(dir, Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false))

    try do
      {:ok, io} = File.open(path, [:write, :binary])

      streamed =
        try do
          stream(conn, io, 0, max)
        after
          File.close(io)
        end

      with {:ok, conn} <- streamed,
           {:ok, body} <- fun.(path) do
        json(conn, body)
      else
        {:error, why} -> conn |> put_status(409) |> json(%{error: why})
      end
    after
      File.rm(path)
    end
  end

  defp stream(conn, io, size, max) do
    case Plug.Conn.read_body(conn, length: 4_000_000) do
      {status, chunk, conn} when status in [:ok, :more] ->
        size = size + byte_size(chunk)

        if size > max do
          {:error, "body too large"}
        else
          IO.binwrite(io, chunk)
          if status == :ok, do: {:ok, conn}, else: stream(conn, io, size, max)
        end

      {:error, _} = e ->
        e
    end
  end
end
