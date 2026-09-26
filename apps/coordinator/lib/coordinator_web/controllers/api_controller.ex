defmodule CoordinatorWeb.ApiController do
  use CoordinatorWeb, :controller
  alias Coordinator.{Checkpoint, Queue, Segment, Store}

  @max_checkpoint 256 * 1024 * 1024
  @max_file 64 * 1024 * 1024
  # manifest.json is a small, fixed-shape object (spec/config/summary; a real
  # one is a few KB even for a long run — coordinator-driven segments always
  # write `checkpoints: []`, see `Coordinator.Queue`'s `task/4`) — nowhere
  # near `@max_file`. Bounding it separately, and well below that, keeps
  # `manifest_metrics_version/2`'s parse (the only file we ever decode here)
  # cheap regardless of what an island uploads.
  @max_manifest 1024 * 1024
  # Must match packages/runner/src/stitch.ts's VERIFIED_FILES (BUNDLE_FILES
  # minus manifest.json, plus the optional migrations.tsv and exchanges.tsv)
  # and Coordinator.Segment's @observation_files ++ @optional_observation_files.
  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json migrations.tsv exchanges.tsv)

  plug :require_island
       when action in [
              :me,
              :next,
              :complete,
              :heartbeat,
              :reject,
              :put_checkpoint,
              :put_file,
              :get_checkpoint
            ]

  plug :require_admin when action in [:create_experiment, :experiment]
  # Islands read files to continue runs; administrators to export them (tools/stitch.ts).
  plug :require_island_or_admin when action in [:get_file]

  def status(conn, _), do: json(conn, Queue.status())

  def experiment(conn, %{"name" => name}) do
    case Queue.experiment(name) do
      nil -> not_found(conn)
      exp -> json(conn, exp)
    end
  end

  def join(conn, params) do
    {:ok, cred} = Queue.join(params)
    json(conn, cred)
  end

  # Side-effect-free identity check for a rejoin after e.g. a page reload:
  # same authentication as every other island call (401 for an unknown or
  # invalid token), but reads state instead of claiming a task, so probing it
  # never strands a task assignment the caller is about to drop. Never
  # includes the token/token_hash.
  def me(conn, _), do: json(conn, Queue.island_info(conn.assigns.island))

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
    observations = p["observationDigests"]

    cond do
      not hex16?(hash) ->
        bad(conn, "endHash must be 16 hex digits")

      summary && byte_size(Jason.encode!(summary)) > 16_384 ->
        bad(conn, "summary too large")

      not valid_observation_digests?(observations) ->
        bad(conn, "observationDigests must map known file names to 64-hex-digit SHA-256 values")

      true ->
        reply(
          conn,
          Queue.complete(id, conn.assigns.island, lease, kind, hash, summary, observations)
        )
    end
  end

  def complete(conn, _),
    do: bad(conn, "expected kind (run|verify), endHash and lease")

  def reject(conn, %{"id" => id, "lease" => lease} = p) when is_binary(lease) do
    predecessor = if p["predecessor"] == "import", do: "import", else: "own"

    case Queue.reject(id, conn.assigns.island, lease, to_string(p["reason"] || ""), predecessor) do
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
  # a separate upload (see `put_checkpoint/2`). `manifest.json` alone also
  # gets a stricter size cap and a JSON parse, here — a plain per-request
  # process, not `Coordinator.Queue`'s shared singleton GenServer (see its
  # moduledoc) — so its `metricsVersion` can be recorded on the run attempt
  # ahead of time and compared cheaply, in-memory, at completion.
  def put_file(conn, %{"id" => id, "name" => name, "lease" => lease}) when is_binary(lease) do
    cond do
      not Regex.match?(~r/^[a-z0-9_-]{1,64}\.(jsonl|tsv|json)$/, name) ->
        conn |> put_status(409) |> json(%{error: "bad file name"})

      Queue.segment(id) == nil ->
        conn |> put_status(404) |> json(%{error: "unknown segment"})

      true ->
        max = if name == "manifest.json", do: @max_manifest, else: @max_file

        with_staged(conn, max, fn staged ->
          with {:ok, metrics_version} <- manifest_metrics_version(name, staged) do
            case Queue.publish_file(
                   id,
                   conn.assigns.island,
                   lease,
                   staged,
                   name,
                   Store.sha256_file(staged),
                   metrics_version
                 ) do
              :ok -> {:ok, %{ok: true}}
              e -> e
            end
          end
        end)
    end
  end

  def put_file(conn, _), do: bad(conn, "expected lease")

  # `nil` for every file except `manifest.json` — nothing to extract, and
  # `Coordinator.Segment.publish_file/6` leaves `manifest_metrics_version`
  # untouched on `nil` (never clobbers a previously recorded value with
  # "unknown" just because some other file was uploaded afterward). For
  # `manifest.json` itself: a parse failure (refused at upload, staying below
  # `@max_manifest` bytes, so this decode is always cheap) is an error, not a
  # silent version-1 fallback — only a *valid* manifest that merely lacks or
  # malforms the field itself falls back to version 1, same convention as
  # everywhere else in this feature.
  defp manifest_metrics_version("manifest.json", staged) do
    case File.read(staged) do
      {:ok, bin} ->
        case Jason.decode(bin) do
          {:ok, %{"metricsVersion" => v}} when is_integer(v) and v > 0 -> {:ok, v}
          {:ok, m} when is_map(m) -> {:ok, 1}
          {:ok, _} -> {:error, "manifest.json must decode to a JSON object"}
          {:error, _} -> {:error, "manifest.json is not valid JSON"}
        end

      {:error, reason} ->
        {:error, "could not read staged manifest.json: #{inspect(reason)}"}
    end
  end

  defp manifest_metrics_version(_name, _staged), do: {:ok, nil}

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

  # Only the accepted run attempt's own uploads are served (see `Coordinator.Store`).
  def get_file(conn, %{"id" => id, "name" => name}) do
    with seg when not is_nil(seg) <- Queue.segment(safe_id!(id)),
         sha when is_binary(sha) <- (Segment.accepted_files(seg) || %{})[name],
         path = Store.blob_path(Queue.data_dir(), sha),
         true <- File.exists?(path) do
      type =
        if String.ends_with?(name, ".tsv"),
          do: "text/tab-separated-values",
          else: "application/json"

      conn |> put_resp_content_type(type) |> send_file(200, path)
    else
      _ -> not_found(conn)
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
  # creation and export are refused unless tokenless local administration is
  # explicitly enabled (dev and test only; behind a reverse proxy every peer is
  # loopback).
  defp require_admin(conn, _) do
    if admin?(conn),
      do: conn,
      else: conn |> put_status(401) |> json(%{error: "admin authentication required"}) |> halt()
  end

  defp require_island_or_admin(conn, opts),
    do: if(admin?(conn), do: conn, else: require_island(conn, opts))

  defp admin?(conn) do
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
  defp hex64?(v), do: is_binary(v) and Regex.match?(~r/^[0-9a-f]{64}$/, v)

  # Tolerant of absence (a run attempt, or an older island, sends none):
  # nil is always valid. When present, every key must be one of the known
  # observation file names and every value a 64-hex-digit SHA-256 — which,
  # together with there being at most that many keys, bounds the whole
  # payload's size without a separate byte-size check.
  defp valid_observation_digests?(nil), do: true

  defp valid_observation_digests?(m) when is_map(m) do
    map_size(m) <= length(@observation_files) and
      Enum.all?(m, fn {k, v} -> k in @observation_files and hex64?(v) end)
  end

  defp valid_observation_digests?(_), do: false

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
