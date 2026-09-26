defmodule Coordinator.Store do
  @moduledoc """
  Content-addressed artifact storage: an uploaded checkpoint is kept once,
  under its own digest — `data_dir/objects/<digest[0..1]>/<digest>.blck`, a
  two-level fan-out (standard git-style, keeps any one directory small) —
  written once via rename-from-tmp. A second write of an already-known digest
  is a no-op while the stored object is intact (it still parses and still
  has that digest); a stored object damaged out of band is replaced by the
  fresh, validated upload, so an honest recomputation always heals it.

  Bundle files (`series.jsonl` and friends) are content-addressed too, by
  their SHA-256 — `data_dir/files/<sha[0..1]>/<sha>` — and the run attempt
  that uploaded each one records its name and digest
  (`Coordinator.Segment.publish_file/5`). A segment's files are served only
  through its accepted attempt's record, so an abandoned or rejected
  attempt's uploads can never be mistaken for the accepted history's.
  """

  @doc "Where an artifact with this digest is (or would be) stored."
  def path(dir, digest),
    do: Path.join([dir, "objects", binary_part(digest, 0, 2), digest <> ".blck"])

  @doc """
  Publishes `staged` (a path to bytes already validated against `digest`)
  into the store. If an intact object already exists at that digest,
  `staged` is discarded; otherwise it is moved into place (atomically
  replacing a damaged object).
  """
  def put(dir, digest, staged) do
    dest = path(dir, digest)

    if intact?(dest, digest) do
      File.rm(staged)
    else
      File.mkdir_p!(Path.dirname(dest))
      File.rename!(staged, dest)
    end

    :ok
  end

  # The stored bytes still validate and still carry the digest they are filed under.
  defp intact?(dest, digest) do
    with {:ok, bin} <- File.read(dest),
         <<_::binary-size(12), step::little-32, _::binary>> <- bin,
         {:ok, info} <- Coordinator.Checkpoint.validate(bin, step) do
      Coordinator.Checkpoint.artifact_digest(info) == digest
    else
      _ -> false
    end
  end

  def exists?(dir, digest), do: File.exists?(path(dir, digest))

  @doc "Where a bundle file with this SHA-256 (lowercase hex) is (or would be) stored."
  def blob_path(dir, sha), do: Path.join([dir, "files", binary_part(sha, 0, 2), sha])

  @doc "Publishes `staged` as the bundle file whose SHA-256 is `sha` (see `sha256_file/1`)."
  def put_blob(dir, sha, staged) do
    dest = blob_path(dir, sha)

    if File.exists?(dest) and sha256_file(dest) == sha do
      File.rm(staged)
    else
      File.mkdir_p!(Path.dirname(dest))
      File.rename!(staged, dest)
    end

    :ok
  end

  @doc "Lowercase hex SHA-256 of a file's contents."
  def sha256_file(path) do
    path
    |> File.stream!(65_536)
    |> Enum.reduce(:crypto.hash_init(:sha256), &:crypto.hash_update(&2, &1))
    |> :crypto.hash_final()
    |> Base.encode16(case: :lower)
  end
end
