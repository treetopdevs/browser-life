defmodule CoordinatorWeb.DiscoveryController do
  @moduledoc """
  HTTP API of the discovery plane (`Coordinator.Discovery`), under
  `/api/discovery`. Separate from the registered queue's routes, tokens and
  data directory.

  Authentication: an administrator (the existing admin token, or loopback
  when `:allow_local_admin`) registers campaigns, uploads frozen blobs and
  exports; a worker joins with the research join token
  (`:discovery_join_token`, env `BL_DISCOVERY_JOIN_TOKEN`; unset: loopback
  only) and then authenticates as `Bearer <workerId>:<token>`. Admin
  credentials never reach workers.

  Hashing, staging and the TypeScript validator (`:discovery_validator`, a
  command plus arguments; `tools/discovery.ts check-attempt`) run here in the
  request process, never inside the serialized queue process.
  """
  use CoordinatorWeb, :controller
  alias Coordinator.Discovery

  @max_blob 256 * 1024 * 1024
  @max_small 4 * 1024 * 1024
  @limits ~w(concurrentCasesPerHost caseWallSeconds campaignWallSeconds campaignBytes attemptsPerCasePerRole)

  plug :require_admin when action in [:register, :put_blob, :index, :status]
  plug :require_join when action in [:join]
  plug :require_worker when action in [:next, :heartbeat, :put_file, :complete]
  plug :require_worker_or_admin when action in [:get_blob]

  # ---- admin ----

  def put_blob(conn, %{"sha" => sha}) do
    if Discovery.hex64?(sha) do
      with_staged(conn, @max_blob, fn path, size ->
        if Coordinator.Store.sha256_file(path) == sha do
          publish_blob(sha, path)
          {:ok, %{sha: sha, bytes: size}}
        else
          {:error, "body does not hash to #{sha}"}
        end
      end)
    else
      bad(conn, "sha must be 64 hex digits")
    end
  end

  def register(conn, params) do
    case build_campaign(params) do
      {:ok, c} ->
        {:ok, what} = Discovery.register_campaign(c)
        json(conn, %{status: what, manifestDigest: c.manifest_digest, cases: length(c.case_ids)})

      {:error, why} ->
        bad(conn, why)
    end
  end

  def index(conn, %{"md" => md}) do
    case Discovery.campaign_index(md) do
      nil -> conn |> put_status(404) |> json(%{error: "unknown campaign"})
      idx -> json(conn, idx)
    end
  end

  def status(conn, _),
    do: conn |> put_resp_header("cache-control", "no-store") |> json(Discovery.status())

  # ---- workers ----

  def join(conn, p) do
    envelope = Application.get_env(:coordinator, :discovery_cloud_envelope)

    cond do
      not Discovery.valid_label?(p["physicalHostId"]) ->
        bad(
          conn,
          "physicalHostId must be a lowercase label (operator-assigned, one per physical machine)"
        )

      not Discovery.valid_label?(p["label"]) ->
        bad(conn, "label must be a lowercase label")

      not Discovery.hex64?(p["sourceClosureDigest"]) ->
        bad(conn, "sourceClosureDigest must be 64 hex digits")

      p["environment"] == "cloud" and envelope == nil ->
        conn
        |> put_status(403)
        |> json(%{
          error:
            "cloud workers need a configured launch envelope (region, instance, count, lifetime, maximum spend); the cloud allowance is zero"
        })

      true ->
        case Discovery.join(%{
               label: p["label"],
               host: p["physicalHostId"],
               backend: clip(p["backend"]),
               closure: p["sourceClosureDigest"],
               runtime: clip(p["runtime"]),
               concurrency: clamp(p["concurrency"], 1, 64)
             }) do
          {:ok, cred} ->
            json(conn, cred)

          {:error, :too_many_workers} ->
            conn |> put_status(429) |> json(%{error: "too many workers have joined; try later"})
        end
    end
  end

  def next(conn, _), do: json(conn, elem(Discovery.next(conn.assigns.worker.id), 1))

  def heartbeat(conn, %{"id" => lease}) do
    case Discovery.heartbeat(lease, conn.assigns.worker.id) do
      {:ok, exp} -> json(conn, %{ok: true, expiresAt: exp})
      {:error, why} -> conn |> put_status(409) |> json(%{error: why})
    end
  end

  def put_file(conn, %{"id" => lease, "name" => name}) do
    wid = conn.assigns.worker.id

    cond do
      name not in Discovery.file_names() ->
        bad(conn, "unknown file #{name}")

      true ->
        case Discovery.upload_target(lease, wid) do
          {:ok, _status} ->
            max = if name == "end.blck", do: @max_blob, else: @max_small

            with_staged(conn, max, fn path, size ->
              sha = Coordinator.Store.sha256_file(path)

              # Admit first (attempt state, conflicts, storage cap); only admitted bytes are published.
              # Two phases: reserve, publish durably, then make the reference visible.
              with :ok <- Discovery.admit_file(lease, wid, name, sha, size),
                   :ok <- publish_blob(sha, path),
                   :ok <- Discovery.commit_file(lease, wid, name, sha) do
                {:ok, %{sha: sha, bytes: size}}
              end
            end)

          {:error, why} ->
            conn |> put_status(409) |> json(%{error: why})
        end
    end
  end

  def complete(conn, %{"id" => lease}) do
    wid = conn.assigns.worker.id

    case Discovery.completion(lease, wid) do
      {:done, reply} ->
        json(conn, reply)

      {:error, why} ->
        conn |> put_status(409) |> json(%{error: why})

      {:ok, info} ->
        verdict = check(info)
        {:ok, reply} = Discovery.finalize(lease, wid, verdict)
        json(conn, reply)
    end
  end

  def get_blob(conn, %{"sha" => sha}) do
    path = if Discovery.hex64?(sha), do: Discovery.blob_path(Discovery.data_dir(), sha)

    if path && File.exists?(path) do
      conn |> put_resp_content_type("application/octet-stream") |> send_file(200, path)
    else
      conn |> put_status(404) |> json(%{error: "not found"})
    end
  end

  # ---- validation (outside the queue process) ----

  defp check(%{attempt: a} = info) do
    missing = Enum.reject(Discovery.file_names(), &Map.has_key?(a.files, &1))
    dir = Discovery.data_dir()

    with [] <- missing,
         {:ok, result} <- read_json(Discovery.blob_path(dir, a.files["result.json"])),
         [] <- identity_errors(result, info),
         {:ok, verdict} <- run_validator(info) do
      verdict
    else
      list when is_list(list) and missing != [] ->
        %{valid: false, errors: Enum.map(list, &"missing #{&1}"), canonical: nil}

      list when is_list(list) ->
        %{valid: false, errors: list, canonical: nil}

      {:error, why} ->
        %{valid: false, errors: [why], canonical: nil}
    end
  end

  # What only the coordinator knows: which attempt, role and host this lease is.
  defp identity_errors(%{"canonical" => c, "execution" => e}, %{attempt: a} = info)
       when is_map(c) and is_map(e) do
    want_role = if a.role == "qualify", do: "primary", else: a.role

    [
      {e["attemptId"] == a.attempt_id,
       "result names attempt #{inspect(e["attemptId"])}, the lease is #{a.attempt_id}"},
      {e["role"] == want_role,
       "result role #{inspect(e["role"])} is not the leased role #{want_role}"},
      {e["workerId"] == a.worker,
       "result names worker #{inspect(e["workerId"])}, the lease belongs to #{a.worker}"},
      {e["leaseId"] == a.lease, "result names lease #{inspect(e["leaseId"])}, not #{a.lease}"},
      {e["physicalHostId"] == info.host,
       "result host #{inspect(e["physicalHostId"])} is not the worker's #{info.host}"},
      {c["caseId"] == a.case_id, "result names a different case"},
      {e["sourceClosureDigest"] == info.closure,
       "result was produced by a different source closure"},
      {is_map(e["files"]) and
         Enum.all?(Discovery.file_names() -- ["result.json"], &(e["files"][&1] == a.files[&1])),
       "recorded file digests differ from the uploaded bytes (corrupt bytes)"}
    ]
    |> Enum.reject(&elem(&1, 0))
    |> Enum.map(&elem(&1, 1))
  end

  defp identity_errors(_, _), do: ["result.json is not a result manifest"]

  defp run_validator(%{attempt: a} = info) do
    case Application.get_env(:coordinator, :discovery_validator) do
      [cmd | args] ->
        dir = Discovery.data_dir()

        tmp =
          Path.join([
            dir,
            "tmp",
            "val-" <> Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)
          ])

        File.mkdir_p!(Path.join(tmp, "attempt"))

        try do
          File.cp!(Discovery.blob_path(dir, info.manifest_sha), Path.join(tmp, "manifest.json"))
          File.cp!(Discovery.blob_path(dir, info.case_sha), Path.join(tmp, "case.json"))
          File.cp!(Discovery.blob_path(dir, info.initial_sha), Path.join(tmp, "initial.blck"))

          for {name, sha} <- a.files,
              do: File.cp!(Discovery.blob_path(dir, sha), Path.join([tmp, "attempt", name]))

          argv =
            args ++
              [
                "--manifest",
                Path.join(tmp, "manifest.json"),
                "--case",
                Path.join(tmp, "case.json"),
                "--initial",
                Path.join(tmp, "initial.blck"),
                "--attempt",
                Path.join(tmp, "attempt")
              ]

          task = Task.async(fn -> System.cmd(cmd, argv, stderr_to_stdout: false) end)

          case Task.yield(task, 300_000) || Task.shutdown(task, :brutal_kill) do
            {:ok, {out, 0}} ->
              case Jason.decode(out |> String.split("\n", trim: true) |> List.last() || "") do
                {:ok, %{"valid" => v, "errors" => errs} = m}
                when is_boolean(v) and is_list(errs) ->
                  {:ok, %{valid: v, errors: errs, canonical: if(v, do: m["canonical"])}}

                _ ->
                  {:error, "validator printed no verdict"}
              end

            {:ok, {out, code}} ->
              {:error, "validator exited #{code}: #{String.slice(out, 0, 500)}"}

            nil ->
              {:error, "validator timed out"}
          end
        after
          File.rm_rf(tmp)
        end

      _ ->
        {:error, "no discovery validator is configured; results stay unaccepted"}
    end
  end

  defp read_json(path) do
    with {:ok, %{size: n}} when n <= @max_small <- File.stat(path),
         {:ok, bin} <- File.read(path),
         {:ok, m} <- Jason.decode(bin) do
      {:ok, m}
    else
      _ -> {:error, "result.json is missing, too large or not JSON"}
    end
  end

  # ---- registration ----

  defp build_campaign(
         %{"manifest" => mtext, "protocol" => ptext, "sourceClosure" => ctext, "cases" => cases} =
           p
       )
       when is_binary(mtext) and is_binary(ptext) and is_binary(ctext) and is_map(cases) do
    md = sha256(mtext)
    dir = Discovery.data_dir()

    with {:ok, m} <- Jason.decode(mtext),
         ids when is_list(ids) <- m["orderedCaseIds"],
         true <-
           Enum.sort(ids) == Enum.sort(Map.keys(cases)) ||
             "cases do not match the manifest's ordered set",
         true <-
           Enum.all?(cases, fn {id, t} -> is_binary(t) and sha256(t) == id end) ||
             "a case.json does not hash to its case ID",
         {:ok, initials} <- initials(cases, dir),
         true <- Discovery.hex64?(m["sourceClosureDigest"]) || "manifest has no source closure",
         limits when is_map(limits) <- m["resourceLimits"],
         true <-
           Enum.all?(@limits, &(is_integer(limits[&1]) and limits[&1] > 0)) ||
             "bad resource limits",
         {:ok, q} <- qualification(p["qualification"], ids) do
      frozen =
        for {name, text} <- [
              {"manifest.json", mtext},
              {"protocol.json", ptext},
              {"source-closure.json", ctext}
            ],
            into: %{} do
          sha = sha256(text)
          write_blob(dir, sha, text)
          {name, sha}
        end

      for {id, t} <- cases, do: write_blob(dir, id, t)

      {:ok,
       %{
         name: to_string(m["campaign"]),
         manifest_digest: md,
         source_closure: m["sourceClosureDigest"],
         observer_version: m["observerVersion"],
         readout_version: m["readoutVersion"],
         case_ids: ids,
         cases: initials,
         limits: Map.take(limits, @limits),
         qualification: q,
         frozen: frozen,
         bytes:
           Enum.sum(Enum.map([mtext, ptext, ctext | Map.values(cases)], &byte_size/1)) +
             (initials
              |> Map.values()
              |> Enum.uniq()
              |> Enum.map(&File.stat!(Discovery.blob_path(dir, &1)).size)
              |> Enum.sum())
       }}
    else
      {:error, %Jason.DecodeError{}} -> {:error, "manifest is not JSON"}
      {:error, why} when is_binary(why) -> {:error, why}
      why when is_binary(why) -> {:error, why}
      _ -> {:error, "malformed campaign"}
    end
  end

  defp build_campaign(_), do: {:error, "expected manifest, protocol, sourceClosure and cases"}

  defp initials(cases, dir) do
    Enum.reduce_while(cases, {:ok, %{}}, fn {id, t}, {:ok, acc} ->
      with {:ok, spec} <- Jason.decode(t),
           sha when is_binary(sha) <- spec["initialArtifactDigest"],
           true <- Discovery.hex64?(sha),
           path = Discovery.blob_path(dir, sha),
           true <- File.exists?(path) and Coordinator.Store.sha256_file(path) == sha do
        {:cont, {:ok, Map.put(acc, id, sha)}}
      else
        _ ->
          {:halt,
           {:error,
            "case #{id}: its initial artifact must be uploaded first (PUT /api/discovery/blobs/<sha>)"}}
      end
    end)
  end

  defp qualification(%{"caseId" => id, "canonical" => c}, ids) when is_map(c) do
    if id in ids and c["caseId"] == id,
      do: {:ok, %{"caseId" => id, "canonical" => c}},
      else:
        {:error, "qualification must name a case of the campaign and its pinned canonical result"}
  end

  defp qualification(_, _),
    do: {:error, "a qualification case with its pinned canonical result is required"}

  # ---- storage ----

  defp publish_blob(sha, staged) do
    dest = Discovery.blob_path(Discovery.data_dir(), sha)

    if File.exists?(dest) and Coordinator.Store.sha256_file(dest) == sha do
      # Another request may still be publishing it: flush before acknowledging.
      File.rm(staged)
      Coordinator.Discovery.Disk.sync_file!(dest)

      # The prefix directory, blobs/ and the data root: whichever of them the first publisher created.
      prefix = Path.dirname(dest)
      blobs = Path.dirname(prefix)
      Coordinator.Discovery.Disk.sync_dirs!([prefix, blobs, Path.dirname(blobs)])
    else
      Coordinator.Discovery.Disk.publish!(staged, dest)
    end

    :ok
  end

  defp write_blob(dir, sha, text) do
    dest = Discovery.blob_path(dir, sha)

    unless File.exists?(dest) and Coordinator.Store.sha256_file(dest) == sha do
      File.mkdir_p!(Path.join(dir, "tmp"))
      tmp = Path.join([dir, "tmp", sha <> ".reg"])
      File.write!(tmp, text)
      Coordinator.Discovery.Disk.publish!(tmp, dest)
    end
  end

  defp with_staged(conn, max, fun) do
    dir = Path.join(Discovery.data_dir(), "tmp")
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

      with {:ok, conn, size} <- streamed,
           {:ok, body} <- fun.(path, size) do
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
          if status == :ok, do: {:ok, conn, size}, else: stream(conn, io, size, max)
        end

      {:error, _} = e ->
        e
    end
  end

  # ---- auth ----

  defp require_admin(conn, _), do: if(admin?(conn), do: conn, else: deny(conn))

  defp require_join(conn, _) do
    token = Application.get_env(:coordinator, :discovery_join_token)

    ok =
      if is_binary(token) and token != "",
        do: is_binary(bearer(conn)) and Plug.Crypto.secure_compare(bearer(conn), token),
        else: loopback?(conn.remote_ip)

    if ok, do: conn, else: deny(conn)
  end

  defp require_worker(conn, _) do
    case worker(conn) do
      {:ok, w} -> assign(conn, :worker, w)
      _ -> deny(conn)
    end
  end

  defp require_worker_or_admin(conn, _) do
    cond do
      admin?(conn) -> conn
      match?({:ok, _}, worker(conn)) -> conn
      true -> deny(conn)
    end
  end

  defp worker(conn) do
    with "" <> b <- bearer(conn),
         [id, token] <- String.split(b, ":", parts: 2) do
      Discovery.auth(id, token)
    else
      _ -> :error
    end
  end

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

  defp deny(conn), do: conn |> put_status(401) |> json(%{error: "unauthorized"}) |> halt()
  defp bad(conn, why), do: conn |> put_status(422) |> json(%{error: why})
  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
  defp clip(v) when is_binary(v), do: String.slice(v, 0, 200)
  defp clip(_), do: "?"
  defp clamp(v, lo, hi) when is_integer(v), do: v |> max(lo) |> min(hi)
  defp clamp(_, lo, _), do: lo
end
