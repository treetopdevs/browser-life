defmodule Coordinator.StoreTest do
  use ExUnit.Case, async: true
  alias Coordinator.Store

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-store-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  defp staged(dir, content) do
    path = Path.join(dir, "staged-#{System.unique_integer([:positive])}")
    File.write!(path, content)
    path
  end

  test "stores content under a two-level fan-out of its own digest", %{dir: dir} do
    digest = "0123456789abcdef"
    assert :ok = Store.put(dir, digest, staged(dir, "hello"))
    assert Store.exists?(dir, digest)
    assert Store.path(dir, digest) == Path.join([dir, "objects", "01", digest <> ".blck"])
    assert File.read!(Store.path(dir, digest)) == "hello"
  end

  defp fixture do
    bin = File.read!(Path.join(__DIR__, "../fixtures/small.blck"))
    {:ok, info} = Coordinator.Checkpoint.validate(bin, 12)
    {bin, Coordinator.Checkpoint.artifact_digest(info)}
  end

  test "a second write of an intact known digest is a no-op, not an overwrite", %{dir: dir} do
    {bin, digest} = fixture()
    assert :ok = Store.put(dir, digest, staged(dir, bin))
    second = staged(dir, "second (should be discarded)")
    assert :ok = Store.put(dir, digest, second)
    refute File.exists?(second)
    assert File.read!(Store.path(dir, digest)) == bin
  end

  test "a stored object damaged out of band is replaced by a fresh upload", %{dir: dir} do
    {bin, digest} = fixture()
    assert :ok = Store.put(dir, digest, staged(dir, bin))
    <<head::binary-size(400), b, rest::binary>> = bin
    File.write!(Store.path(dir, digest), head <> <<Bitwise.bxor(b, 1)>> <> rest)
    assert :ok = Store.put(dir, digest, staged(dir, bin))
    assert File.read!(Store.path(dir, digest)) == bin
  end

  test "different digests never collide", %{dir: dir} do
    assert :ok = Store.put(dir, "aaaaaaaaaaaaaaaa", staged(dir, "a"))
    assert :ok = Store.put(dir, "aabbbbbbbbbbbbbb", staged(dir, "b"))
    assert File.read!(Store.path(dir, "aaaaaaaaaaaaaaaa")) == "a"
    assert File.read!(Store.path(dir, "aabbbbbbbbbbbbbb")) == "b"
  end
end
