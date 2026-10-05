defmodule Coordinator.Discovery.Disk do
  @moduledoc """
  Durable file operations for the discovery plane (DESIGN section 7: stage,
  validate, publish atomically, then durably acknowledge).

  A rename is durable only once its directory is flushed. Erlang cannot open
  a directory for `fsync` (`:file.open/2` returns `:eisdir`), so directory
  flushes go through Perl, which every supported host has (macOS, and
  `perl-base` in the Debian images the coordinator ships on). Every failure
  raises: an acknowledgment is never sent for state that might not survive a
  power loss.
  """

  @sync_script ~S"""
  use IO::Handle;
  for my $d (@ARGV) { open(my $h, "<", $d) or die "open $d: $!\n"; $h->sync or die "fsync $d: $!\n"; close $h; }
  """

  @doc "Flushes directory entries (creations, renames) of each directory to stable storage."
  def sync_dirs!(dirs) do
    dirs = Enum.uniq(dirs)

    case System.cmd("perl", ["-e", @sync_script | dirs], stderr_to_stdout: true) do
      {_, 0} -> :ok
      {out, code} -> raise "directory fsync failed (#{code}): #{String.trim(out)}"
    end
  end

  @doc "Flushes a file's contents to stable storage."
  def sync_file!(path) do
    {:ok, fd} = :file.open(path, [:read, :write, :binary, :raw])

    try do
      :ok = :file.sync(fd)
    after
      :file.close(fd)
    end
  end

  @doc "Replaces `path` atomically and durably: temporary file, fsync, rename, directory fsync."
  def write_atomic!(path, bin) do
    tmp = path <> ".tmp"
    {:ok, fd} = :file.open(tmp, [:write, :binary, :raw])

    try do
      :ok = :file.write(fd, bin)
      :ok = :file.sync(fd)
    after
      :file.close(fd)
    end

    :ok = :file.rename(tmp, path)
    sync_dirs!([Path.dirname(path)])
  end

  @doc "Creates a directory and any missing ancestors, flushing each new entry into its parent."
  def mkdir_durable!(dir) do
    created = missing_ancestors(dir)
    File.mkdir_p!(dir)
    if created != [], do: sync_dirs!(Enum.map(created, &Path.dirname/1))
    :ok
  end

  @doc """
  Moves a staged file to `dest` durably: the file is flushed, every directory
  the move creates is flushed into its parent, and the rename is flushed.
  """
  def publish!(staged, dest) do
    sync_file!(staged)
    created = missing_ancestors(Path.dirname(dest))
    File.mkdir_p!(Path.dirname(dest))
    File.rename!(staged, dest)
    sync_dirs!([Path.dirname(dest) | Enum.map(created, &Path.dirname/1)])
  end

  defp missing_ancestors(dir) do
    if File.dir?(dir), do: [], else: [dir | missing_ancestors(Path.dirname(dir))]
  end

  @doc """
  The real path of `path`: symlinks resolved through its deepest existing
  ancestor, the rest appended. Two directories overlap only if their real
  paths do.
  """
  def real_path(path), do: resolve(Path.expand(path), 0)

  defp resolve(_path, depth) when depth > 40, do: raise("too many symbolic links")

  defp resolve(path, depth) do
    case Path.split(path) do
      ["/" | parts] -> walk("/", parts, depth)
      parts -> walk(File.cwd!(), parts, depth)
    end
  end

  defp walk(acc, [], _depth), do: acc

  defp walk(acc, [p | rest], depth) do
    next = Path.join(acc, p)

    case File.read_link(next) do
      {:ok, target} -> resolve(Path.join([Path.expand(target, acc) | rest]), depth + 1)
      _ -> walk(next, rest, depth)
    end
  end
end
