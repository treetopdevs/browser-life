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

  # Publishes stand-in artifacts under the task's lease with the given digests.
  defp upload(dir, task, island, hash, ohash \\ "0000000000000000") do
    seg = task.segment.id

    for {name, meta} <- [{"cp", %{checkpoint_hash: hash}}, {"ob", %{observer_hash: ohash}}] do
      staged = Path.join(dir, "#{name}-#{System.unique_integer([:positive])}")
      File.write!(staged, "x")

      :ok =
        Queue.publish(
          seg,
          island,
          task.lease,
          staged,
          &Path.join(Queue.files_dir(&1, seg), name),
          meta
        )
    end
  end

  defp done(t, island, hash, ohash \\ "0000000000000000"),
    do: Queue.complete(t.segment.id, island, t.lease, "run", hash, ohash, %{})

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
    assert {:error, "observerHash" <> _} = done(t1, a, "h0", "1111111111111111")
    assert {:ok, "done"} = done(t1, a, "h0")

    {:ok, v} = Queue.next_task(b)
    assert v.kind == "verify" and v.segment.id == t1.segment.id
    {:ok, t2} = Queue.next_task(a)
    assert t2.kind == "run" and t2.startFrom == t1.segment.id and t2.startHash == "h0"

    {:ok, "verified"} =
      Queue.complete(v.segment.id, b, v.lease, "verify", "h0", "0000000000000000", %{})

    upload(dir, t2, a, "h1")
    {:ok, "done"} = done(t2, a, "h1")
    {:ok, v2} = Queue.next_task(b)
    assert v2.segment.id == t2.segment.id
    {:ok, t3} = Queue.next_task(a)
    assert t3.segment.index == 2

    {:ok, "diverged"} =
      Queue.complete(v2.segment.id, b, v2.lease, "verify", "other", "0000000000000000", %{})

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
    upload(dir, t, a, "x")
    assert {:error, _} = done(%{t | lease: t.lease}, b, "x")

    assert {:error, _} =
             Queue.complete(t.segment.id, a, "wrong", "run", "x", "0000000000000000", %{})

    staged = Path.join(dir, "staged")
    File.write!(staged, "data")

    assert {:error, "lease lost"} =
             Queue.publish(
               t.segment.id,
               a,
               "wrong",
               staged,
               &Queue.checkpoint_path(&1, t.segment.id)
             )

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

  test "observer mismatch on replay is a divergence, and the final segment is always verified", %{
    dir: dir
  } do
    {:ok, 1} = Queue.create_experiment(%{@spec_ok | "steps" => 500, "verifyFraction" => 0.0})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "h0", "aaaaaaaaaaaaaaaa")
    {:ok, "done"} = done(t, a, "h0", "aaaaaaaaaaaaaaaa")
    {:ok, v} = Queue.next_task(b)
    assert v.kind == "verify"

    assert {:ok, "diverged"} =
             Queue.complete(v.segment.id, b, v.lease, "verify", "h0", "bbbbbbbbbbbbbbbb", %{})
  end

  test "a verifier can reject an inconsistent predecessor", %{dir: dir} do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, t2} = Queue.next_task(a)
    upload(dir, t2, a, "h1")
    {:ok, "done"} = done(t2, a, "h1")
    # b verifies segment 0 first, then segment 1 whose start (segment 0) it finds bad.
    {:ok, v1} = Queue.next_task(b)

    {:ok, "verified"} =
      Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", "0000000000000000", %{})

    {:ok, v2} = Queue.next_task(b)
    assert v2.segment.id == t2.segment.id
    assert :ok = Queue.reject(v2.segment.id, b, v2.lease, "bad start")
    assert %{status: "pending", rejected: 1} = Queue.segment(t1.segment.id)
    assert %{status: "pending", verify: nil} = Queue.segment(t2.segment.id)
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
