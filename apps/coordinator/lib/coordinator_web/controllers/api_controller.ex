defmodule CoordinatorWeb.ApiController do
  use CoordinatorWeb, :controller
  alias Coordinator.{Checkpoint, Queue, Segment, Store}

  @max_checkpoint 256 * 1024 * 1024
  @max_file 64 * 1024 * 1024

  plug :require_island
       when action in [
              :next,
              :complete,
              :heartbeat,
              :reject,
              :put_checkpoint,
              :put_file,
              :get_checkpoint,
              :get_file
            ]

  plug :require_admin when action in [:create_experiment]

  def status(conn, _), do: json(conn, Queue.status())

  def join(conn, params) do
    {:ok, cred} = Queue.join(params)
    json(conn, cred)
  end

  def create_experiment(conn, params) do
    case Queue.create_experiment(params) do
      {:ok, n} -> json(conn, %{segments: n})
      {:error, why} -> conn |> put_status(422) |> json(%{error: why})
    end
  end

  def next(conn, _) do
    {:ok, task} = Queue.next_task(conn.assigns.island)
    json(conn, task)
  end

  def heartbeat(conn, %{"id" => id, "lease" => lease}) when is_binary(lease) do
    case Queue.heartbeat(id, conn.assigns.island, lease) do
      :ok -> json(conn, %{ok: true})
      {:error, why} -> conn |> put_status(409) |> json(%{error: why})
    end
  end

  def heartbeat(conn, _), do: bad(conn, "expected lease")

  def complete(
        conn,
        %{"id" => id, "kind" => kind, "endHash" => hash, "lease" => lease} = p
      )
      when kind in ["run", "verify"] and is_binary(hash) and is_binary(lease) do
    summary = if is_map(p["summary"]), do: p["summary"], else: nil

    cond do
      not hex16?(hash) ->
        bad(conn, "endHash must be 16 hex digits")

      summary && byte_size(Jason.encode!(summary)) > 16_384 ->
        bad(conn, "summary too large")

      true ->
        reply(conn, Queue.complete(id, conn.assigns.island, lease, kind, hash, summary))
    end
  end

  def complete(conn, _),
    do: bad(conn, "expected kind (run|verify), endHash and lease")

  def reject(conn, %{"id" => id, "lease" => lease} = p) when is_binary(lease) do
    case Queue.reject(id, conn.assigns.island, lease, to_string(p["reason"] || "")) do
      :ok -> json(conn, %{ok: true})
      {:error, why} -> conn |> put_status(409) |> json(%{error: why})
    end
  end

  def reject(conn, _), do: bad(conn, "expected lease")

  # End checkpoint (physics + observer, one artifact) of a run task. The body
  # is staged, validated (structure, versions, checksum, end step, seed) and
  # digested twice — the physics-only `state_digest` (for the *next*
  # segment's `startHash` continuity) and the whole-artifact `artifact_digest`
  # (what this attempt's own `complete`/verification are bound to) — then
  # published into the content-addressed store only if the lease is still
  # current.
  def put_checkpoint(conn, %{"id" => id, "lease" => lease}) when is_binary(lease) do
    case Queue.segment(id) do
      nil ->
        conn |> put_status(404) |> json(%{error: "unknown segment"})

      seg ->
        with_staged(conn, @max_checkpoint, fn staged ->
          with {:ok, info} <-
                 Checkpoint.validate(File.read!(staged), seg.start_step + seg.steps, seg.seed),
               digest = Checkpoint.artifact_digest(info),
               state_hash = Checkpoint.state_digest(info),
               :ok <-
                 Queue.publish_checkpoint(
                   id,
                   conn.assigns.island,
                   lease,
                   staged,
                   digest,
                   state_hash
                 ) do
            {:ok, %{ok: true, digest: digest}}
          else
            {:error, why} -> {:error, "invalid checkpoint or lease: #{why}"}
          end
        end)
    end
  end

  def put_checkpoint(conn, _), do: bad(conn, "expected lease")

  # Bundle files (series.jsonl and friends) are not content-addressed: named
  # by the caller, kept per segment. No file gets special-cased for a digest
  # any more — that was only ever `observer.json`, which no longer exists as
  # a separate upload (see `put_checkpoint/2`).
  def put_file(conn, %{"id" => id, "name" => name, "lease" => lease}) when is_binary(lease) do
    cond do
      not Regex.match?(~r/^[a-z0-9_-]{1,64}\.(jsonl|tsv|json)$/, name) ->
        conn |> put_status(409) |> json(%{error: "bad file name"})

      Queue.segment(id) == nil ->
        conn |> put_status(404) |> json(%{error: "unknown segment"})

      true ->
        with_staged(conn, @max_file, fn staged ->
          case Queue.publish_file(
                 id,
                 conn.assigns.island,
                 lease,
                 staged,
                 &Path.join(Queue.files_dir(&1, id), name)
               ) do
            :ok -> {:ok, %{ok: true}}
            e -> e
          end
        end)
    end
  end

  def put_file(conn, _), do: bad(conn, "expected lease")

  # Start state of a segment = the accepted end artifact of its predecessor,
  # fetched from the content-addressed store by that artifact's own digest.
  def get_checkpoint(conn, %{"id" => id}) do
    with seg when not is_nil(seg) <- Queue.segment(safe_id!(id)),
         digest when not is_nil(digest) <- Segment.accepted_digest(seg) do
      path = Store.path(Queue.data_dir(), digest)

      if File.exists?(path),
        do: conn |> put_resp_content_type("application/octet-stream") |> send_file(200, path),
        else: not_found(conn)
    else
      _ -> not_found(conn)
    end
  end

  def get_file(conn, %{"id" => id, "name" => name}) do
    if Regex.match?(~r/^[a-z0-9_-]{1,64}\.(jsonl|tsv|json)$/, name) do
      path = Path.join(Queue.files_dir(Queue.data_dir(), safe_id!(id)), name)

      type =
        if String.ends_with?(name, ".tsv"),
          do: "text/tab-separated-values",
          else: "application/json"

      if File.exists?(path),
        do: conn |> put_resp_content_type(type) |> send_file(200, path),
        else: not_found(conn)
    else
      not_found(conn)
    end
  end

  # ---- plugs ----

  defp require_island(conn, _) do
    island = conn.params["island"]
    token = bearer(conn)

    if is_binary(island) and Queue.authenticate(island, token) do
      assign(conn, :island, island)
    else
      conn |> put_status(401) |> json(%{error: "island authentication required"}) |> halt()
    end
  end

  # A configured admin token is always required. Without one, experiment
  # creation is refused unless tokenless local administration is explicitly
  # enabled (dev and test only; behind a reverse proxy every peer is loopback).
  defp require_admin(conn, _) do
    admin = Application.get_env(:coordinator, :admin_token)

    allowed =
      cond do
        is_binary(admin) and admin != "" ->
          is_binary(bearer(conn)) and Plug.Crypto.secure_compare(bearer(conn), admin)

        Application.get_env(:coordinator, :allow_local_admin, false) ->
          loopback?(conn.remote_ip)

        true ->
          false
      end

    if allowed,
      do: conn,
      else: conn |> put_status(401) |> json(%{error: "admin authentication required"}) |> halt()
  end

  defp bearer(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> t] -> t
      _ -> nil
    end
  end

  defp loopback?({127, _, _, _}), do: true
  defp loopback?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback?(_), do: false

  # ---- helpers ----

  defp reply(conn, {:ok, status}), do: json(conn, %{status: status})
  defp reply(conn, {:error, why}), do: conn |> put_status(409) |> json(%{error: why})
  defp bad(conn, why), do: conn |> put_status(422) |> json(%{error: why})
  defp not_found(conn), do: conn |> put_status(404) |> json(%{error: "not found"})

  defp safe_id!(id) do
    if is_binary(id) and Regex.match?(~r/^seg-[0-9]{1,9}$/, id), do: id, else: "seg-0"
  end

  defp hex16?(v), do: Regex.match?(~r/^[0-9a-f]{16}$/, v)

  # Streams the request body to a temporary file (at most `max` bytes), runs
  # `fun` on it, and always removes the temporary file afterwards (publishing
  # renames it away first).
  defp with_staged(conn, max, fun) do
    dir = Path.join(Queue.data_dir(), "tmp")
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
