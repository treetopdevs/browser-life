defmodule Coordinator.Store do
  @moduledoc """
  Content-addressed artifact storage: an uploaded checkpoint is kept once,
  under its own digest — `data_dir/objects/<digest[0..1]>/<digest>.blck`, a
  two-level fan-out (standard git-style, keeps any one directory small) —
  written once via rename-from-tmp. A second write of an already-known digest
  is a no-op while the stored object is intact (it still parses and still
  has that digest); a stored object damaged out of band is replaced by the
  fresh, validated upload, so an honest recomputation always heals it.

  Bundle files (`series.jsonl` and friends) are *not* content-addressed —
  they are per-attempt, appended to, and named by the caller, so they keep
  their existing segment/attempt-scoped path (`Queue.files_dir/2`); only the
  single physics+observer checkpoint artifact lives here.
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
end
