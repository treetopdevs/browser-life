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

  test "a second write of an already-known digest is a no-op, not an overwrite", %{dir: dir} do
    digest = "abcdefabcdefabcd"
    assert :ok = Store.put(dir, digest, staged(dir, "first"))
    second = staged(dir, "second (should be discarded)")
    assert :ok = Store.put(dir, digest, second)
    refute File.exists?(second)
    assert File.read!(Store.path(dir, digest)) == "first"
  end

  test "different digests never collide", %{dir: dir} do
    assert :ok = Store.put(dir, "aaaaaaaaaaaaaaaa", staged(dir, "a"))
    assert :ok = Store.put(dir, "aabbbbbbbbbbbbbb", staged(dir, "b"))
    assert File.read!(Store.path(dir, "aaaaaaaaaaaaaaaa")) == "a"
    assert File.read!(Store.path(dir, "aabbbbbbbbbbbbbb")) == "b"
  end
end
