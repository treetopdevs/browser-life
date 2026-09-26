defmodule Coordinator.Store do
  @moduledoc """
  Content-addressed artifact storage: an uploaded checkpoint is kept once,
  under its own digest — `data_dir/objects/<digest[0..1]>/<digest>.blck`, a
  two-level fan-out (standard git-style, keeps any one directory small) —
  written once via rename-from-tmp and never overwritten. A second write of
  an already-known digest is a no-op, not an error: the content is already
  known-identical, since the digest is derived from it.

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
  into the store. If an object already exists at that digest, `staged` is
  discarded instead of overwriting it; otherwise it is moved into place.
  """
  def put(dir, digest, staged) do
    dest = path(dir, digest)

    if File.exists?(dest) do
      File.rm(staged)
    else
      File.mkdir_p!(Path.dirname(dest))
      File.rename!(staged, dest)
    end

    :ok
  end

  def exists?(dir, digest), do: File.exists?(path(dir, digest))
end
