defmodule Coordinator.QueueTest do
  use ExUnit.Case, async: false
  alias Coordinator.Queue

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-queue-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  @spec_ok %{
    "experiment" => "t1",
    "presetId" => "spots",
    "conditions" => ["treatment"],
    "seeds" => [1],
    "steps" => 1500,
    "segmentSteps" => 500,
    "censusEvery" => 100,
    "verifyFraction" => 1.0
  }

  # Publishes a stand-in artifact under the task's run lease, into the
  # content-addressed store, with the given digest (and physics-only digest,
  # for the next segment's startHash).
  defp upload(dir, task, island, digest, state_hash \\ "0000000000000000") do
    staged = Path.join(dir, "cp-#{System.unique_integer([:positive])}")
    File.write!(staged, "x")

    :ok =
      Queue.publish_checkpoint(task.segment.id, island, task.lease, staged, digest, state_hash)
  end

  defp done(t, island, digest),
    do: Queue.complete(t.segment.id, island, t.lease, "run", digest, %{})

  test "validates specs before any arithmetic or allocation" do
    assert {:ok, 3} = Queue.create_experiment(@spec_ok)
    assert {:error, "experiment exists"} = Queue.create_experiment(@spec_ok)

    bad = fn changes ->
      Queue.create_experiment(Map.merge(%{@spec_ok | "experiment" => "t2"}, changes))
    end

    assert {:error, _} = bad.(%{"censusEvery" => 0})
    assert {:error, _} = bad.(%{"segmentSteps" => 0})
    assert {:error, _} = bad.(%{"segmentSteps" => 333})
    assert {:error, _} = bad.(%{"presetId" => "../../../../escape"})
    assert {:error, _} = bad.(%{"conditions" => ["../x"]})
    assert {:error, _} = bad.(%{"seeds" => [1, 1]})
    assert {:error, _} = bad.(%{"seeds" => ["1"]})
    assert {:error, _} = bad.(%{"steps" => 1_000_000_000, "segmentSteps" => 100})
    assert {:error, _} = Queue.create_experiment("nope")
  end

  test "segments run in order, are verified elsewhere, and divergence blocks the run", %{dir: dir} do
    {:ok, 3} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
    {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})

    {:ok, t1} = Queue.next_task(a)
    assert t1.kind == "run" and t1.segment.index == 0 and t1.startFrom == nil
    assert {:ok, %{kind: "idle"}} = Queue.next_task(b)
    assert {:error, _} = done(t1, a, "h0")
    upload(dir, t1, a, "h0")
    assert {:error, "endHash" <> _} = done(t1, a, "other")
    assert {:ok, "done"} = done(t1, a, "h0")

    {:ok, v} = Queue.next_task(b)
    assert v.kind == "verify" and v.segment.id == t1.segment.id
    {:ok, t2} = Queue.next_task(a)

    assert t2.kind == "run" and t2.startFrom == t1.segment.id and
             t2.startHash == "0000000000000000"

    {:ok, "verified"} = Queue.complete(v.segment.id, b, v.lease, "verify", "h0", %{})

    upload(dir, t2, a, "h1")
    {:ok, "done"} = done(t2, a, "h1")
    {:ok, v2} = Queue.next_task(b)
    assert v2.segment.id == t2.segment.id
    {:ok, t3} = Queue.next_task(a)
    assert t3.segment.index == 2

    {:ok, "diverged"} = Queue.complete(v2.segment.id, b, v2.lease, "verify", "other", %{})

    # The running descendant was blocked: its lease is dead and nothing else can run.
    assert {:error, _} = Queue.heartbeat(t3.segment.id, a, t3.lease)
    assert {:error, _} = done(t3, a, "h2")
    assert {:ok, %{kind: "idle"}} = Queue.next_task(a)
    st = Queue.status()
    assert st.counts["verified"] == 1 and st.counts["diverged"] == 1 and st.counts["blocked"] == 1
  end

  test "leases gate completion and publication", %{dir: dir} do
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "xx")
    assert {:error, _} = Queue.complete(t.segment.id, b, t.lease, "run", "xx", %{})
    assert {:error, _} = Queue.complete(t.segment.id, a, "wrong", "run", "xx", %{})

    staged = Path.join(dir, "staged")
    File.write!(staged, "data")

    assert {:error, "lease lost"} =
             Queue.publish_checkpoint(t.segment.id, a, "wrong", staged, "y", "y")

    refute File.exists?(staged)
    assert :ok = Queue.heartbeat(t.segment.id, a, t.lease)
  end

  test "a reclaimed lease does not inherit the expired assignee's artifacts", %{dir: dir} do
    Application.put_env(:coordinator, :lease_ms, 0)
    on_exit(fn -> Application.delete_env(:coordinator, :lease_ms) end)
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "aaaaaaaaaaaaaaaa")
    Process.sleep(2)
    {:ok, t2} = Queue.next_task(b)
    assert t2.segment.id == t.segment.id and t2.lease != t.lease
    Application.put_env(:coordinator, :lease_ms, 60_000)
    assert {:error, _} = done(t2, b, "aaaaaaaaaaaaaaaa")
    upload(dir, t2, b, "bbbbbbbbbbbbbbbb")
    assert {:ok, _} = done(t2, b, "bbbbbbbbbbbbbbbb")
  end

  test "a rejected start checkpoint requeues the producing segment", %{dir: dir} do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 0.0})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, t2} = Queue.next_task(b)
    assert t2.startFrom == t1.segment.id
    assert :ok = Queue.reject(t2.segment.id, b, t2.lease, "digest mismatch")
    assert %{status: "pending", rejected: 1} = Queue.segment(t1.segment.id)
    assert %{status: "pending"} = Queue.segment(t2.segment.id)
    {:ok, again} = Queue.next_task(b)
    assert again.segment.id == t1.segment.id
  end

  defp publish_file(dir, task, island, name, content) do
    staged = Path.join(dir, "bundle-#{System.unique_integer([:positive])}")
    File.write!(staged, content)
    sha = Coordinator.Store.sha256_file(staged)
    :ok = Queue.publish_file(task.segment.id, island, task.lease, staged, name, sha)
    sha
  end

  # Bundle files are content-addressed and recorded per attempt: after a
  # rejected segment is redone, only the redo's uploads are its files (the
  # rejected attempt's upload -- including a name the redo never rewrites --
  # is unreachable), and a verification of the rejected result no longer
  # vouches for the segment.
  test "a redone segment exposes only the redo's files and no stale verification", %{dir: dir} do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0})
    {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
    {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})
    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    old = publish_file(dir, t1, a, "series.jsonl", "old\n")
    publish_file(dir, t1, a, "life.jsonl", "only in the rejected attempt\n")
    assert {:error, "lease lost"} = Queue.publish_file(t1.segment.id, b, t1.lease, "x", "n", old)
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, v1} = Queue.next_task(b)
    {:ok, "verified"} = Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", %{})

    [s0 | _] = Queue.experiment("t1").segments

    assert %{digest: "h0", files: %{"series.jsonl" => ^old}, producedBy: "A", verifiedBy: "B"} =
             s0

    assert File.read!(Coordinator.Store.blob_path(dir, old)) == "old\n"

    {:ok, t2} = Queue.next_task(a)
    upload(dir, t2, a, "h1")
    {:ok, "done"} = done(t2, a, "h1")
    {:ok, v2} = Queue.next_task(b)
    :ok = Queue.reject(v2.segment.id, b, v2.lease, "bad start")

    {:ok, redo} = Queue.next_task(a)
    assert redo.segment.id == t1.segment.id
    upload(dir, redo, a, "h0b")
    new = publish_file(dir, redo, a, "series.jsonl", "new\n")
    {:ok, "done"} = done(redo, a, "h0b")

    [s0 | _] = Queue.experiment("t1").segments
    assert %{status: "done", digest: "h0b", files: files, verifiedBy: nil} = s0
    assert files == %{"series.jsonl" => new}
    assert Queue.experiment("nope") == nil
  end

  test "island tokens authenticate and state survives a restart", %{dir: dir} do
    {:ok, %{id: a, token: tok}} = Queue.join(%{})
    assert Queue.authenticate(a, tok)
    refute Queue.authenticate(a, "nope")
    refute Queue.authenticate("isl-x", tok)
    {:ok, _} = Queue.create_experiment(@spec_ok)
    stop_supervised!(Queue)
    start_supervised!({Queue, data_dir: dir})
    assert Map.has_key?(Queue.status().experiments, "t1")
    assert Queue.authenticate(a, tok)
    assert {:ok, %{kind: "run", segment: %{index: 0}}} = Queue.next_task(a)
    refute Enum.any?(Queue.status().islands, &Map.has_key?(&1, :token_hash))
  end

  # A silent island (e.g. a browser tab that reloaded and dropped back to the
  # Join screen) should be visible on the status page instead of just quietly
  # not showing up in `next` calls -- see `Coordinator.Queue`'s `@stale_ms`.
  # Checked at the actual boundary (just under vs just over), not with an
  # arbitrarily ancient timestamp, so this would catch an off-by-one in the
  # comparison itself.
  test "status flags an island stale right at the threshold, not before" do
    {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
    threshold = Queue.stale_ms()
    now = System.system_time(:millisecond)

    :sys.replace_state(Queue, &put_in(&1, [:islands, a, :last_seen], now - threshold + 1_000))
    refute Enum.find(Queue.status().islands, &(&1.id == a)).stale

    :sys.replace_state(Queue, &put_in(&1, [:islands, a, :last_seen], now - threshold - 1_000))
    assert Enum.find(Queue.status().islands, &(&1.id == a)).stale
  end

  # `stale?/2` takes both timestamps as arguments (instead of reading the
  # clock itself) precisely so the exact boundary can be pinned down without
  # a wall-clock race between setting a fixture and `status/0` reading
  # `System.system_time/1` moments later. Elapsed exactly equal to the
  # threshold must not be stale -- the comparison is `>`, not `>=`.
  test "stale?/2 treats the threshold itself as exclusive" do
    threshold = Queue.stale_ms()
    refute Queue.stale?(0, threshold)
    refute Queue.stale?(0, threshold - 1)
    assert Queue.stale?(0, threshold + 1)
  end

  # Heartbeats keep a long-running task's segment alive but, before this
  # fix, never touched the island's own `last_seen` -- so a healthy island
  # busy between `/next` calls (a task can run far longer than `@stale_ms`)
  # looked stale on the status page the whole time.
  test "a lease-current heartbeat also refreshes the island's last_seen" do
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)

    :sys.replace_state(Queue, &put_in(&1, [:islands, a, :last_seen], 0))
    assert :ok = Queue.heartbeat(t.segment.id, a, t.lease)
    refute Enum.find(Queue.status().islands, &(&1.id == a)).stale
  end

  test "a state.bin from an incompatible schema version refuses to load" do
    dir =
      Path.join(System.tmp_dir!(), "bl-queue-incompatible-#{System.unique_integer([:positive])}")

    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    File.write!(
      Path.join(dir, "state.bin"),
      :erlang.term_to_binary(%{experiments: %{}, segments: %{}, islands: %{}, next_seg: 1})
    )

    Process.flag(:trap_exit, true)
    assert {:error, _} = Queue.start_link(data_dir: dir, name: :incompatible_state_test)
  end

  test "observer mismatch (a different artifact digest) on replay is a divergence, and the final segment is always verified",
       %{
         dir: dir
       } do
    {:ok, 1} = Queue.create_experiment(%{@spec_ok | "steps" => 500, "verifyFraction" => 0.0})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "h0")
    {:ok, "done"} = done(t, a, "h0")
    {:ok, v} = Queue.next_task(b)
    assert v.kind == "verify"

    assert {:ok, "diverged"} =
             Queue.complete(v.segment.id, b, v.lease, "verify", "different-hash", %{})
  end

  test "a verifier can reject an inconsistent predecessor" do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t1} = Queue.next_task(a)
    dir = Queue.data_dir()
    upload(dir, t1, a, "h0")
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, t2} = Queue.next_task(a)
    upload(dir, t2, a, "h1")
    {:ok, "done"} = done(t2, a, "h1")
    # b verifies segment 0 first, then segment 1 whose start (segment 0) it finds bad.
    {:ok, v1} = Queue.next_task(b)

    {:ok, "verified"} = Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", %{})

    {:ok, v2} = Queue.next_task(b)
    assert v2.segment.id == t2.segment.id
    assert :ok = Queue.reject(v2.segment.id, b, v2.lease, "bad start")
    assert %{status: "pending", rejected: 1} = Queue.segment(t1.segment.id)
    assert %{status: "pending"} = Queue.segment(t2.segment.id)
  end

  test "incompatible preset/condition combinations are refused" do
    assert {:error, "condition uniform-light" <> _} =
             Queue.create_experiment(%{@spec_ok | "conditions" => ["uniform-light"]})

    assert {:error, "condition fixed-env" <> _} =
             Queue.create_experiment(%{@spec_ok | "conditions" => ["fixed-env"]})

    assert {:ok, _} =
             Queue.create_experiment(%{
               @spec_ok
               | "presetId" => "gradient",
                 "conditions" => ["uniform-light"]
             })
  end

  test "large experiments stay responsive" do
    {:ok, 20_000} =
      Queue.create_experiment(%{
        @spec_ok
        | "seeds" => Enum.to_list(1..100),
          "steps" => 20_000,
          "segmentSteps" => 100
      })

    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, _} = Queue.next_task(a)
    {us, {:ok, _}} = :timer.tc(fn -> Queue.next_task(a) end)
    assert us < 2_000_000
  end
end
