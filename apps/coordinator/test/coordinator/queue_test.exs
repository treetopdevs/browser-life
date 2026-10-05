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

  test "an ordinary (non-metapopulation) experiment's task payload has no metapopulation/importFrom/importHash keys at all (review P2)" do
    {:ok, 3} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: island}} = Queue.join(%{"adapter" => "A"})
    {:ok, task} = Queue.next_task(island)
    refute Map.has_key?(task.spec, :metapopulation)
    refute Map.has_key?(task, :importFrom)
    refute Map.has_key?(task, :importHash)
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
    public = Queue.public_status()
    assert public.counts == st.counts
    assert public.activeIslands == 2
    assert public.deviceTypes == 2
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

  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)

  # Uploads all six observation files under `task`'s run lease, each file's
  # content its own name (deterministic, so the same publish reproduces the
  # same SHA-256), and returns {name => sha}.
  defp publish_observation_files(dir, task, island),
    do: Map.new(@observation_files, &{&1, publish_file(dir, task, island, &1, &1)})

  test "observationsVerified reflects a verify attempt's reported file digests, independent of physics verification, and mismatches surface in /api/status",
       %{
         dir: dir
       } do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0})
    {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
    {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})

    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    digests1 = publish_observation_files(dir, t1, a)
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, v1} = Queue.next_task(b)

    assert {:ok, "verified"} =
             Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", %{}, digests1)

    segs = Queue.experiment("t1").segments
    seg0 = Enum.find(segs, &(&1.index == 0))
    assert %{status: "verified", observationsVerified: true} = seg0
    assert Queue.status().observationMismatches == []

    {:ok, t2} = Queue.next_task(a)
    upload(dir, t2, a, "h1")
    publish_observation_files(dir, t2, a)
    {:ok, "done"} = done(t2, a, "h1")
    {:ok, v2} = Queue.next_task(b)
    # The physics digest still matches (the segment verifies) even though the
    # reported observation files do not: the two checks are independent, and
    # only the second surfaces here.
    bad_digests = Map.new(@observation_files, &{&1, String.duplicate("f", 64)})

    assert {:ok, "verified"} =
             Queue.complete(v2.segment.id, b, v2.lease, "verify", "h1", %{}, bad_digests)

    segs_after = Queue.experiment("t1").segments
    seg0_after = Enum.find(segs_after, &(&1.index == 0))
    seg1_after = Enum.find(segs_after, &(&1.index == 1))
    assert %{status: "verified", observationsVerified: true} = seg0_after
    assert %{status: "verified", observationsVerified: false} = seg1_after

    assert [mismatch] = Queue.status().observationMismatches
    assert mismatch.segment == seg1_after.id and mismatch.index == 1
    assert mismatch.producer == "A" and mismatch.verifier == "B"
  end

  # Review finding: after a requeue-and-redo, a completed verify attempt's
  # comparison must not be attributed to the new accepted attempt just
  # because it happens to still be `last_verify_attempt/1` and the redo kept
  # the *same* accepted digest (bundle files aren't part of that digest, so
  # this is a real, not merely hypothetical, case).
  test "a stale observation mismatch is not attributed to a redo's producer, even at the same accepted digest, and a fresh verify re-establishes it correctly",
       %{dir: dir} do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0})
    {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
    {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})
    {:ok, %{id: c}} = Queue.join(%{"adapter" => "C"})

    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    publish_observation_files(dir, t1, a)
    {:ok, "done"} = done(t1, a, "h0")

    {:ok, v1} = Queue.next_task(b)
    bad_digests = Map.new(@observation_files, &{&1, String.duplicate("z", 64)})

    assert {:ok, "verified"} =
             Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", %{}, bad_digests)

    segs = Queue.experiment("t1").segments
    seg0 = Enum.find(segs, &(&1.index == 0))
    assert %{status: "verified", observationsVerified: false} = seg0
    assert [mismatch] = Queue.status().observationMismatches
    assert mismatch.segment == seg0.id and mismatch.producer == "A" and mismatch.verifier == "B"

    # Island A itself finds segment 0's checkpoint (its own predecessor,
    # started from directly) inconsistent while trying segment 1 -- requeues
    # segment 0 -- and then redoes it, uploading the *same* accepted digest
    # ("h0") but different, unreported observation-file content.
    {:ok, t2} = Queue.next_task(a)
    assert t2.startFrom == seg0.id
    assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "bad start")
    assert %{status: "pending", rejected: 1} = Queue.segment(seg0.id)

    {:ok, redo} = Queue.next_task(a)
    assert redo.segment.id == seg0.id
    upload(dir, redo, a, "h0")

    redo_digests =
      Map.new(@observation_files, &{&1, publish_file(dir, redo, a, &1, &1 <> "-redo")})

    {:ok, "done"} = done(redo, a, "h0")

    # The stale mismatch (B, against A's original files) must not survive the
    # redo -- neither attributed to it in /api/status nor in the listing,
    # even though nothing has re-verified the redo yet.
    assert Queue.status().observationMismatches == []
    segs_after_redo = Queue.experiment("t1").segments
    seg0_after_redo = Enum.find(segs_after_redo, &(&1.index == 0))
    assert %{status: "done", observationsVerified: nil} = seg0_after_redo

    # A fresh verify against the redo's *actual* files is attributed
    # correctly, proving this isn't merely "nothing shows up because nobody
    # asked": the machinery still works once there is something real to bind to.
    {:ok, v2} = Queue.next_task(c)
    assert v2.kind == "verify" and v2.segment.id == seg0.id

    assert {:ok, "verified"} =
             Queue.complete(v2.segment.id, c, v2.lease, "verify", "h0", %{}, redo_digests)

    segs_final = Queue.experiment("t1").segments
    seg0_final = Enum.find(segs_final, &(&1.index == 0))
    assert %{status: "verified", observationsVerified: true} = seg0_final
    assert Queue.status().observationMismatches == []
  end

  test "observationsVerified is nil when the verify attempt reports no file digests (an older island), and Queue.complete/6 (no observation digests) still works",
       %{
         dir: dir
       } do
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "verifyFraction" => 1.0, "steps" => 500})
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, %{id: b}} = Queue.join(%{})
    {:ok, t1} = Queue.next_task(a)
    upload(dir, t1, a, "h0")
    publish_observation_files(dir, t1, a)
    {:ok, "done"} = done(t1, a, "h0")
    {:ok, v1} = Queue.next_task(b)
    assert {:ok, "verified"} = Queue.complete(v1.segment.id, b, v1.lease, "verify", "h0", %{})

    [s0] = Queue.experiment("t1").segments
    assert %{status: "verified", observationsVerified: nil} = s0
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
    assert Queue.public_status().activeIslands == 1

    :sys.replace_state(Queue, &put_in(&1, [:islands, a, :last_seen], now - threshold - 1_000))
    assert Enum.find(Queue.status().islands, &(&1.id == a)).stale
    assert Queue.public_status().activeIslands == 0
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

  test "an island's join-time metrics version gates task assignment: mismatched islands idle for that experiment, a matching one is offered it" do
    Application.put_env(:coordinator, :metrics_version, 2)
    on_exit(fn -> Application.put_env(:coordinator, :metrics_version, 1) end)
    {:ok, _} = Queue.create_experiment(@spec_ok)

    {:ok, %{id: old}} = Queue.join(%{"adapter" => "old"})
    {:ok, %{id: wrong}} = Queue.join(%{"adapter" => "wrong", "metricsVersion" => 1})
    {:ok, %{id: current}} = Queue.join(%{"adapter" => "current", "metricsVersion" => 2})

    # An island that never declares one defaults to version 1, same as an
    # island that explicitly (and wrongly) declares 1.
    assert {:ok, %{kind: "idle"}} = Queue.next_task(old)
    assert {:ok, %{kind: "idle"}} = Queue.next_task(wrong)
    assert {:ok, %{kind: "run", segment: %{index: 0}}} = Queue.next_task(current)
  end

  test "a version-mismatched island is idle only for that experiment, not globally: it still gets a different, matching-version experiment's work" do
    Application.put_env(:coordinator, :metrics_version, 1)
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "experiment" => "v1exp"})
    Application.put_env(:coordinator, :metrics_version, 2)
    on_exit(fn -> Application.put_env(:coordinator, :metrics_version, 1) end)
    {:ok, _} = Queue.create_experiment(%{@spec_ok | "experiment" => "v2exp"})

    {:ok, %{id: old}} = Queue.join(%{})
    assert {:ok, %{kind: "run", segment: %{run: run}}} = Queue.next_task(old)
    assert String.starts_with?(run, "v1exp/")
  end

  test "complete_run refuses a completion whose uploaded manifest's metrics version differs from the experiment's required one, even though the island was assigned the task",
       %{dir: dir} do
    Application.put_env(:coordinator, :metrics_version, 2)
    on_exit(fn -> Application.put_env(:coordinator, :metrics_version, 1) end)
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{"metricsVersion" => 2})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "h0")
    put_manifest(dir, t, a, %{"metricsVersion" => 1})

    assert {:error, "uploaded manifest's metrics version 1" <> _} =
             Queue.complete(t.segment.id, a, t.lease, "run", "h0", %{})

    # Refused, not merely delayed: the segment is still assigned to the same
    # attempt, which may retry (e.g. re-upload a corrected manifest).
    assert %{status: "assigned"} = Queue.segment(t.segment.id)
  end

  test "complete_run accepts a completion whose uploaded manifest's metrics version matches the experiment's required one",
       %{dir: dir} do
    Application.put_env(:coordinator, :metrics_version, 2)
    on_exit(fn -> Application.put_env(:coordinator, :metrics_version, 1) end)
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{"metricsVersion" => 2})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "h0")
    put_manifest(dir, t, a, %{"metricsVersion" => 2})

    assert {:ok, "done"} = Queue.complete(t.segment.id, a, t.lease, "run", "h0", %{})
  end

  test "complete_run treats an uploaded manifest with no metricsVersion field as version 1", %{
    dir: dir
  } do
    Application.put_env(:coordinator, :metrics_version, 1)
    {:ok, _} = Queue.create_experiment(@spec_ok)
    {:ok, %{id: a}} = Queue.join(%{})
    {:ok, t} = Queue.next_task(a)
    upload(dir, t, a, "h0")
    put_manifest(dir, t, a, %{})

    assert {:ok, "done"} = Queue.complete(t.segment.id, a, t.lease, "run", "h0", %{})
  end

  # Mimics what CoordinatorWeb.ApiController.put_file/2 does for
  # "manifest.json" (parse it, extract+validate metricsVersion, pass the
  # result to Queue.publish_file/7) -- these tests call Queue directly,
  # bypassing the controller, so they must do that extraction themselves.
  defp put_manifest(dir, task, island, manifest) do
    staged = Path.join(dir, "manifest-#{System.unique_integer([:positive])}")
    File.write!(staged, Jason.encode!(manifest))
    sha = Coordinator.Store.sha256_file(staged)

    metrics_version =
      case manifest do
        %{"metricsVersion" => v} when is_integer(v) and v > 0 -> v
        _ -> 1
      end

    :ok =
      Queue.publish_file(
        task.segment.id,
        island,
        task.lease,
        staged,
        "manifest.json",
        sha,
        metrics_version
      )
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

  test "loads a state.bin persisted before import_from existed (the parent, pre-metapopulation shape) and schedules without crashing (review P1)",
       %{dir: dir} do
    # `dir`'s already-running Queue (from `setup`) hasn't persisted anything
    # yet -- stop it, drop a hand-crafted v3 state.bin whose segment map is
    # exactly the parent commit's shape (no `import_from` key at all, not
    # even `nil`: `Segment.new/10` before this feature existed never had the
    # field), then restart against the same dir and confirm `/api/next`
    # (`next_task/1`) schedules it instead of raising `KeyError` on
    # `seg.import_from`.
    :ok = stop_supervised(Queue)

    legacy_segment = %{
      id: "seg-legacy-0",
      run: "legacy/spots/treatment/seed-1",
      experiment: "legacy",
      condition: "treatment",
      seed: 1,
      index: 0,
      last: true,
      start_step: 0,
      steps: 500,
      status: "pending",
      attempts: [],
      rejected: 0
    }

    legacy_state = %{
      version: 3,
      experiments: %{
        "legacy" => %{
          spec: %{
            "experiment" => "legacy",
            "presetId" => "spots",
            "conditions" => ["treatment"],
            "seeds" => [1],
            "steps" => 500,
            "segmentSteps" => 500,
            "censusEvery" => 100
          },
          created_at: 0
        }
      },
      segments: %{"seg-legacy-0" => legacy_segment},
      islands: %{},
      next_seg: 1
    }

    File.write!(Path.join(dir, "state.bin"), :erlang.term_to_binary(legacy_state))
    start_supervised!({Queue, data_dir: dir})

    {:ok, %{id: island}} = Queue.join(%{"adapter" => "restart-test"})
    assert {:ok, task} = Queue.next_task(island)
    assert task.segment.id == "seg-legacy-0"
    # An ordinary run's task payload stays exactly its pre-metapopulation
    # shape: no importFrom/importHash/metapopulation keys at all (review P2).
    refute Map.has_key?(task, :importFrom)
    refute Map.has_key?(task, :importHash)
    refute Map.has_key?(task.spec, :metapopulation)

    # The reject path (which reads import_from for the "import" predecessor)
    # must likewise tolerate the missing key instead of raising KeyError --
    # segment 0 has no "own" predecessor either, so the *expected* outcome is
    # the ordinary "no such predecessor" error, not a crash.
    assert {:error, "segment not assigned to this island/lease, or no such predecessor"} =
             Queue.reject(task.segment.id, island, task.lease, "legacy state sanity", "import")
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

  # The "no-migration" control (packages/runner/src/conditions.ts) only makes
  # sense on a preset that has migration configured in the first place (see
  # packages/schema/src/presets.ts's "archipelago" preset) -- same shape as
  # the uniform-light/fixed-env checks above, via the same `incompatible`
  # table (config/config.exs).
  test "the no-migration control is refused on presets without migration configured" do
    assert {:error, "condition no-migration" <> _} =
             Queue.create_experiment(%{@spec_ok | "conditions" => ["no-migration"]})

    assert {:ok, _} =
             Queue.create_experiment(%{
               @spec_ok
               | "presetId" => "archipelago",
                 "conditions" => ["no-migration"]
             })
  end

  # Cadence the runner will reject at runtime (packages/runner/src/runner.ts
  # requires migrationPeriod % censusEvery == 0) must be caught at experiment
  # creation instead of assigned to islands that can only fail (review 6).
  describe "migration cadence" do
    test "censusEvery must divide the preset's migrationPeriod" do
      assert {:error, "migrationPeriod 200" <> _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "presetId" => "archipelago",
                   "censusEvery" => 300,
                   "segmentSteps" => 600
               })
    end

    test "segmentSteps must be a multiple of the preset's migrationPeriod" do
      assert {:error, "segmentSteps must be a multiple" <> _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "presetId" => "archipelago",
                   "censusEvery" => 100,
                   "segmentSteps" => 300
               })
    end

    test "a compatible cadence is accepted" do
      assert {:ok, _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "presetId" => "archipelago",
                   "censusEvery" => 100,
                   "segmentSteps" => 400
               })
    end

    test "the no-migration control exempts its own run from the cadence checks" do
      assert {:ok, _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "presetId" => "archipelago",
                   "conditions" => ["no-migration"],
                   "censusEvery" => 300,
                   "segmentSteps" => 600
               })
    end

    # Review: conditions each become their own separate run (build_segments/2)
    # against the same censusEvery/segmentSteps, so "no-migration" among a
    # spec's conditions must exempt only *its own* run, not the whole spec --
    # otherwise this would wrongly accept an experiment whose "treatment" runs
    # (which still migrate at the preset's own cadence) fail on every island.
    test "no-migration exempts only its own run, not sibling conditions that still migrate" do
      assert {:error, "migrationPeriod 200 (condition treatment)" <> _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "presetId" => "archipelago",
                   "conditions" => ["treatment", "no-migration"],
                   "censusEvery" => 300,
                   "segmentSteps" => 600
               })
    end

    test "a preset without migration configured is never subject to the cadence checks" do
      assert {:ok, _} =
               Queue.create_experiment(%{
                 @spec_ok
                 | "censusEvery" => 300,
                   "segmentSteps" => 900
               })
    end
  end

  # The pond presets (config.exs's `:pond_presets`; packages/schema/src/presets.ts)
  # and the pond conditions (packages/runner/src/conditions.ts): refusals at
  # creation mirror what the TypeScript runner throws on, and pond work goes
  # only to islands that advertise "ponds-v1" (see Coordinator.Queue's moduledoc).
  describe "ponds" do
    @pond_spec %{
      "experiment" => "pond",
      "presetId" => "ponds-small",
      "conditions" => ["treatment", "pond-rand", "pond-cont"],
      "seeds" => [1],
      "steps" => 4000,
      "segmentSteps" => 2000,
      "censusEvery" => 100,
      "verifyFraction" => 1.0
    }

    test "a valid ponds-small spec with treatment, pond-rand and pond-cont is accepted" do
      assert {:ok, 6} = Queue.create_experiment(@pond_spec)

      assert {:ok, 1} =
               Queue.create_experiment(%{
                 @pond_spec
                 | "experiment" => "pond-main",
                   "presetId" => "ponds",
                   "steps" => 10_000,
                   "segmentSteps" => 10_000,
                   "censusEvery" => 1000,
                   "conditions" => ["pond-cont"]
               })
    end

    test "a pond preset with a metapopulation is refused" do
      for preset <- ~w(ponds-small ponds) do
        assert {:error, "preset " <> rest} =
                 Queue.create_experiment(
                   %{
                     @pond_spec
                     | "presetId" => preset,
                       "seeds" => [1, 2],
                       "segmentSteps" => 10_000,
                       "steps" => 10_000
                   }
                   |> Map.put("metapopulation", %{"topology" => "ring", "migrantCount" => 4})
                 )

        assert rest =~ "cannot have a metapopulation"
      end
    end

    test "pond-rand and pond-cont are refused on every non-pond preset" do
      pond_presets = Application.get_env(:coordinator, :pond_presets)

      for preset <- Application.get_env(:coordinator, :presets) -- pond_presets,
          c <- ~w(pond-rand pond-cont) do
        assert {:error, "condition " <> ^c <> " does not apply to preset " <> ^preset} =
                 Queue.create_experiment(%{
                   @spec_ok
                   | "presetId" => preset,
                     "conditions" => ["treatment", c],
                     "segmentSteps" => 600,
                     "steps" => 600
                 })
      end
    end

    # The existing controls that throw on a pond preset in TypeScript
    # (uniform light, no seasons, no migration and no metapopulation).
    test "uniform-light, fixed-env and no-migration are refused on a pond preset" do
      for preset <- ~w(ponds-small ponds), c <- ~w(uniform-light fixed-env no-migration) do
        assert {:error, "condition " <> ^c <> " does not apply to preset " <> ^preset} =
                 Queue.create_experiment(%{
                   @pond_spec
                   | "presetId" => preset,
                     "conditions" => [c],
                     "segmentSteps" => 10_000,
                     "steps" => 10_000
                 })
      end
    end

    test "segmentSteps must be a multiple of the pond period, for every condition" do
      for c <- ~w(treatment pond-rand pond-cont) do
        assert {:error, msg} =
                 Queue.create_experiment(%{
                   @pond_spec
                   | "conditions" => [c],
                     "segmentSteps" => 1500
                 })

        assert msg == "segmentSteps must be a multiple of pondPeriod 1000 (condition #{c})"
      end

      assert {:error, "segmentSteps must be a multiple of pondPeriod 10000" <> _} =
               Queue.create_experiment(%{
                 @pond_spec
                 | "presetId" => "ponds",
                   "steps" => 10_000,
                   "segmentSteps" => 5000
               })
    end

    test "the pond period must be a multiple of censusEvery" do
      assert {:error, "pondPeriod 1000 (condition treatment) must be a multiple of censusEvery"} =
               Queue.create_experiment(%{
                 @pond_spec
                 | "censusEvery" => 300,
                   "segmentSteps" => 3000,
                   "steps" => 3000
               })

      assert {:error, "pondPeriod 1000 (condition pond-cont) must be a multiple of censusEvery"} =
               Queue.create_experiment(%{
                 @pond_spec
                 | "conditions" => ["pond-cont"],
                   "censusEvery" => 300,
                   "segmentSteps" => 3000,
                   "steps" => 3000
               })
    end

    test "an island without ponds-v1 never gets a pond segment, while non-pond work still flows to it",
         %{dir: dir} do
      # "a-pond" sorts first, so its pending segment 0 is ahead of every
      # "b-plain" segment in pick_task's order.
      {:ok, 2} =
        Queue.create_experiment(%{
          @pond_spec
          | "experiment" => "a-pond",
            "conditions" => ["treatment"],
            "steps" => 2000,
            "segmentSteps" => 1000
        })

      # No verify of "b-plain" segment 0 (verification comes first in
      # pick_task), so the capable island's next task below is a run.
      {:ok, 3} =
        Queue.create_experiment(%{@spec_ok | "experiment" => "b-plain", "verifyFraction" => 0.0})

      {:ok, %{id: old}} = Queue.join(%{"adapter" => "old"})
      {:ok, %{id: new}} = Queue.join(%{"adapter" => "new"})

      # Default (no capabilities), an empty list and unrelated capabilities
      # are all the same: the pond segment is skipped, not waited for.
      {:ok, t1} = Queue.next_task(old)
      assert t1.kind == "run" and String.starts_with?(t1.segment.run, "b-plain/")
      assert {:ok, %{kind: "idle"}} = Queue.next_task(old, [])
      assert {:ok, %{kind: "idle"}} = Queue.next_task(old, ["ponds-v0", "other"])

      upload(dir, t1, old, "p0")
      {:ok, "done"} = done(t1, old, "p0")
      {:ok, t2} = Queue.next_task(old, [])
      assert t2.kind == "run" and t2.segment.run == t1.segment.run and t2.segment.index == 1

      # An island that advertises it gets the pond work, among other capabilities.
      {:ok, p} = Queue.next_task(new, ["other", "ponds-v1"])
      assert p.kind == "run" and String.starts_with?(p.segment.run, "a-pond/ponds-small/")
      assert p.spec.presetId == "ponds-small"

      # Never persisted: nothing about the request sticks to the island.
      refute Map.has_key?(Queue.island_info(new), :capabilities)
    end

    test "an island without ponds-v1 is never given a pond verify task", %{dir: dir} do
      {:ok, 1} =
        Queue.create_experiment(%{
          @pond_spec
          | "experiment" => "a-pond",
            "conditions" => ["treatment"],
            "steps" => 2000,
            "segmentSteps" => 2000
        })

      {:ok, %{id: producer}} = Queue.join(%{"adapter" => "producer"})
      {:ok, %{id: old}} = Queue.join(%{"adapter" => "old"})
      {:ok, %{id: new}} = Queue.join(%{"adapter" => "new"})

      {:ok, t} = Queue.next_task(producer, ["ponds-v1"])
      upload(dir, t, producer, "p0")
      {:ok, "done"} = done(t, producer, "p0")

      # The final segment always needs a verify by a different island: the
      # one without the capability idles, even with nothing else to do ...
      assert {:ok, %{kind: "idle"}} = Queue.next_task(old)
      assert {:ok, %{kind: "idle"}} = Queue.next_task(old, [])

      # ... while non-pond work created afterwards still reaches it ahead of
      # the waiting pond verify.
      {:ok, 3} = Queue.create_experiment(%{@spec_ok | "experiment" => "b-plain"})
      {:ok, plain} = Queue.next_task(old)
      assert plain.kind == "run" and String.starts_with?(plain.segment.run, "b-plain/")

      {:ok, v} = Queue.next_task(new, ["ponds-v1"])
      assert v.kind == "verify" and v.segment.id == t.segment.id
      assert {:ok, "verified"} = Queue.complete(v.segment.id, new, v.lease, "verify", "p0", %{})
    end
  end

  # The transition hunt's arms (WorldConfig.pondArm nat and shuf; the conditions pond-nat and
  # pond-shuf in packages/runner/src/conditions.ts) need "ponds-v2" on top of "ponds-v1": a run of
  # either, segment or verify, goes only to an island that advertises both. config.exs's
  # `:conditions` does not list them, so these tests add them for their own duration.
  describe "ponds, the hunt's arms" do
    @hunt_spec %{
      "experiment" => "a-hunt",
      "presetId" => "ponds-small",
      "conditions" => ["pond-nat", "pond-shuf"],
      "seeds" => [1],
      "steps" => 1000,
      "segmentSteps" => 1000,
      "censusEvery" => 100,
      "verifyFraction" => 1.0
    }

    setup do
      conditions = Application.get_env(:coordinator, :conditions)
      Application.put_env(:coordinator, :conditions, conditions ++ ~w(pond-nat pond-shuf))
      on_exit(fn -> Application.put_env(:coordinator, :conditions, conditions) end)
    end

    test "a run of nat or shuf is not handed to a ponds-v1 island, and is to one with both capabilities" do
      assert {:ok, 2} = Queue.create_experiment(@hunt_spec)
      {:ok, %{id: v1}} = Queue.join(%{"adapter" => "v1"})
      {:ok, %{id: v2}} = Queue.join(%{"adapter" => "v2"})

      # Nothing, only ponds-v1, only ponds-v2 (it extends ponds-v1, never replaces it) or an
      # unrelated capability: the segments are skipped, not waited for.
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1)
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, [])
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v1"])
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v1", "other"])
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v2"])

      {:ok, nat} = Queue.next_task(v2, ["ponds-v1", "ponds-v2"])
      assert nat.kind == "run" and nat.segment.run == "a-hunt/ponds-small/pond-nat/seed-1"
      assert nat.spec.condition == "pond-nat"

      {:ok, shuf} = Queue.next_task(v2, ["other", "ponds-v2", "ponds-v1"])
      assert shuf.kind == "run" and shuf.spec.condition == "pond-shuf"

      refute Map.has_key?(Queue.island_info(v2), :capabilities)
    end

    test "the gate is per condition: v1 conditions of the same experiment still go to a ponds-v1 island" do
      assert {:ok, 4} =
               Queue.create_experiment(%{
                 @hunt_spec
                 | "conditions" => ["treatment", "pond-cont", "pond-nat", "pond-rand"]
               })

      {:ok, %{id: v1}} = Queue.join(%{"adapter" => "v1"})
      {:ok, %{id: v2}} = Queue.join(%{"adapter" => "v2"})

      # Runs go in run-id order; the nat run sits between pond-cont and pond-rand and is skipped.
      taken =
        for _ <- 1..3 do
          {:ok, t} = Queue.next_task(v1, ["ponds-v1"])
          assert t.kind == "run"
          t.spec.condition
        end

      assert taken == ["pond-cont", "pond-rand", "treatment"]
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v1"])

      {:ok, nat} = Queue.next_task(v2, ["ponds-v1", "ponds-v2"])
      assert nat.kind == "run" and nat.spec.condition == "pond-nat"
    end

    test "scaf, rand and cont runs go to a ponds-v1 island as before, with or without ponds-v2" do
      assert {:ok, 3} =
               Queue.create_experiment(%{
                 @hunt_spec
                 | "experiment" => "a-v1",
                   "conditions" => ["treatment", "pond-rand", "pond-cont"]
               })

      {:ok, %{id: v1}} = Queue.join(%{"adapter" => "v1"})
      {:ok, %{id: v2}} = Queue.join(%{"adapter" => "v2"})
      {:ok, %{id: odd}} = Queue.join(%{"adapter" => "odd"})

      assert {:ok, %{kind: "idle"}} = Queue.next_task(odd, ["ponds-v2"])
      {:ok, a} = Queue.next_task(v1, ["ponds-v1"])
      {:ok, b} = Queue.next_task(v2, ["ponds-v1", "ponds-v2"])
      {:ok, c} = Queue.next_task(v1, ["ponds-v1"])

      assert Enum.sort([a.spec.condition, b.spec.condition, c.spec.condition]) == [
               "pond-cont",
               "pond-rand",
               "treatment"
             ]
    end

    test "a nat run's verify goes only to an island with ponds-v2 as well", %{dir: dir} do
      {:ok, 1} = Queue.create_experiment(%{@hunt_spec | "conditions" => ["pond-nat"]})

      {:ok, %{id: producer}} = Queue.join(%{"adapter" => "producer"})
      {:ok, %{id: v1}} = Queue.join(%{"adapter" => "v1"})
      {:ok, %{id: v2}} = Queue.join(%{"adapter" => "v2"})

      {:ok, t} = Queue.next_task(producer, ["ponds-v1", "ponds-v2"])
      upload(dir, t, producer, "p0")
      {:ok, "done"} = done(t, producer, "p0")

      # The final segment always needs a verify by a different island: ponds-v1 alone idles ...
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v1"])
      assert {:ok, %{kind: "idle"}} = Queue.next_task(v1, ["ponds-v2"])

      # ... and an island with both gets it.
      {:ok, v} = Queue.next_task(v2, ["ponds-v1", "ponds-v2"])
      assert v.kind == "verify" and v.segment.id == t.segment.id
      assert {:ok, "verified"} = Queue.complete(v.segment.id, v2, v.lease, "verify", "p0", %{})
    end
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

  describe "metapopulation" do
    @metapop_spec Map.merge(@spec_ok, %{
                    "seeds" => [1, 2],
                    "steps" => 200,
                    "segmentSteps" => 100,
                    "censusEvery" => 100,
                    "metapopulation" => %{"topology" => "ring", "migrantCount" => 4}
                  })

    test "wires import_from to the ring-predecessor seed's same-index segment; segment 0 never imports" do
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m1"})
      seg1 = Queue.segment("seg-1")
      seg2 = Queue.segment("seg-2")
      seg3 = Queue.segment("seg-3")
      seg4 = Queue.segment("seg-4")

      assert seg1.seed == 1 and seg1.index == 0
      assert seg3.seed == 2 and seg3.index == 0
      assert Map.get(seg1, :import_from) == nil
      assert Map.get(seg3, :import_from) == nil
      # A 2-seed ring: each seed's predecessor is the other.
      assert Map.get(seg2, :import_from) == seg3.id
      assert Map.get(seg4, :import_from) == seg1.id
    end

    test "resolves and stores a salt (deterministically, absent an explicit one) in the experiment record" do
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m2"})
      %{spec: spec} = Queue.experiment("m2")
      assert is_integer(spec["metapopulation"]["salt"])

      assert spec["metapopulation"]["salt"] >= 0 and
               spec["metapopulation"]["salt"] <= 4_294_967_295

      assert spec["metapopulation"]["topology"] == "ring"
      assert spec["metapopulation"]["migrantCount"] == 4
      # Deterministic given the experiment's own identity (its name), not
      # wall-clock or process state: recomputing it the same way Queue does
      # (a hash of the experiment name) gives the same stored value, so a
      # replay never depends on when/where it was first resolved.
      assert spec["metapopulation"]["salt"] == :erlang.phash2("m2", 4_294_967_296)
    end

    test "an explicit salt is kept as given, not overridden" do
      spec = %{
        @metapop_spec
        | "experiment" => "m3",
          "metapopulation" => %{"topology" => "ring", "migrantCount" => 4, "salt" => 777}
      }

      {:ok, 4} = Queue.create_experiment(spec)
      %{spec: stored} = Queue.experiment("m3")
      assert stored["metapopulation"]["salt"] == 777
    end

    test "requires at least 2 seeds" do
      assert {:error, "metapopulation requires at least 2 seeds" <> _} =
               Queue.create_experiment(%{@metapop_spec | "experiment" => "m4", "seeds" => [1]})
    end

    test "rejects a bad topology or migrantCount" do
      assert {:error, "metapopulation.topology" <> _} =
               Queue.create_experiment(%{
                 @metapop_spec
                 | "experiment" => "m5",
                   "metapopulation" => %{"topology" => "star", "migrantCount" => 4}
               })

      assert {:error, "metapopulation.migrantCount" <> _} =
               Queue.create_experiment(%{
                 @metapop_spec
                 | "experiment" => "m6",
                   "metapopulation" => %{"topology" => "ring", "migrantCount" => 0}
               })
    end

    test "\"no-migration\" runs get no import_from wiring even within a metapopulation experiment (the metapopulation-level control)" do
      spec = %{
        @metapop_spec
        | "experiment" => "m7",
          "conditions" => ["treatment", "no-migration"]
      }

      {:ok, 8} = Queue.create_experiment(spec)

      # Fetch every segment via the experiment listing instead of guessing ids.
      %{segments: segs} = Queue.experiment("m7")
      no_migration_segs = Enum.filter(segs, &(&1.condition == "no-migration"))
      treatment_segs = Enum.filter(segs, &(&1.condition == "treatment"))
      assert length(no_migration_segs) == 4
      assert length(treatment_segs) == 4

      for s <- no_migration_segs, s.index > 0 do
        seg = Queue.segment(s.id)
        assert Map.get(seg, :import_from) == nil
      end

      assert Enum.any?(treatment_segs, fn s ->
               s.index > 0 && Map.get(Queue.segment(s.id), :import_from) != nil
             end)
    end

    test "the barrier: a run's segment 1 isn't offered until its ring-predecessor's segment 0 is done, even though its own chain is ready first",
         %{dir: dir} do
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m8"})
      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})

      {:ok, t1} = Queue.next_task(a)
      assert t1.segment.id == "seg-1"
      upload(dir, t1, a, "h1")
      {:ok, "done"} = done(t1, a, "h1")

      # seg-2 (seed 1, index 1)'s own predecessor (seg-1) is done, but its
      # cross-run predecessor (seg-3, seed 2's segment 0) is still pending --
      # the barrier must skip it and offer seg-3 instead.
      {:ok, t3} = Queue.next_task(a)
      assert t3.segment.id == "seg-3"
      upload(dir, t3, a, "h3")
      {:ok, "done"} = done(t3, a, "h3")

      # Now both of seg-2's dependencies are done: the barrier clears.
      {:ok, t2} = Queue.next_task(a)
      assert t2.segment.id == "seg-2"
      assert t2.importFrom == "seg-3"
      assert is_binary(t2.importHash)
    end

    test "rejecting with predecessor \"import\" requeues the cross-run predecessor, not the own-run one",
         %{dir: dir} do
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m9"})
      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})

      {:ok, t1} = Queue.next_task(a)
      upload(dir, t1, a, "h1")
      {:ok, "done"} = done(t1, a, "h1")
      {:ok, t3} = Queue.next_task(a)
      upload(dir, t3, a, "h3")
      {:ok, "done"} = done(t3, a, "h3")
      {:ok, t2} = Queue.next_task(a)
      assert t2.importFrom == "seg-3"

      assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "bad import", "import")
      # seg-3 (the import source) is the one invalidated and requeued.
      assert %{status: "pending", rejected: 1} = Queue.segment("seg-3")
      # seg-1 (t2's own-run predecessor) is untouched.
      assert %{status: "done"} = Queue.segment("seg-1")
      # seg-2 itself is reachable from seg-3 (via import_from) and so was
      # blocked then immediately unblocked back to pending, ready to be
      # reassigned once seg-3 is redone.
      assert %{status: "pending"} = Queue.segment("seg-2")
    end

    test "a source redo with a changed digest: the ring successor's next task carries the NEW digest, never the stale one (coverage: source redo)",
         %{dir: dir} do
      # Coverage the review asked for (a two-island concurrent-GPU scenario
      # was judged too large/heavy for this suite -- see the mix-test-level
      # coverage note in the handoff): the redo/stale-digest transition
      # itself, exercised here through Coordinator.Queue's own API, the same
      # way "rejecting with predecessor \"import\" requeues..." above does,
      # just carried one step further through the actual redo.
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m11"})
      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})

      {:ok, t1} = Queue.next_task(a)
      upload(dir, t1, a, "h1")
      {:ok, "done"} = done(t1, a, "h1")
      {:ok, t3} = Queue.next_task(a)
      # importHash is the physics-only state hash (Segment.accepted_state_hash),
      # not the artifact digest passed to `done` -- upload's own 5th argument.
      upload(dir, t3, a, "h3-v1", "s3-v1")
      {:ok, "done"} = done(t3, a, "h3-v1")
      {:ok, t2} = Queue.next_task(a)
      assert t2.importFrom == "seg-3"
      assert t2.importHash == "s3-v1"

      # seg-3 (the import source) is rejected and redone with a DIFFERENT
      # accepted digest -- as a real recomputation after a genuine defect
      # (not merely a retry of the same result) would produce.
      assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "bad import", "import")
      assert %{status: "pending"} = Queue.segment("seg-3")
      {:ok, t3v2} = Queue.next_task(a)
      assert t3v2.segment.id == "seg-3"
      upload(dir, t3v2, a, "h3-v2", "s3-v2")
      {:ok, "done"} = done(t3v2, a, "h3-v2")

      # seg-2's next offered task must carry the NEW digest -- Segment.accepted_state_hash
      # reads the segment's *current* accepted attempt, not whatever an
      # earlier (now-superseded, now-attemptless after being blocked/reset)
      # task response happened to say.
      {:ok, t2v2} = Queue.next_task(a)
      assert t2v2.segment.id == "seg-2"
      assert t2v2.importFrom == "seg-3"
      assert t2v2.importHash == "s3-v2"
      refute t2v2.importHash == t2.importHash
    end

    test "a divergence propagates across the ring: the diverged segment's own successor and the run importing from it both block",
         %{dir: dir} do
      {:ok, 4} = Queue.create_experiment(%{@metapop_spec | "experiment" => "m10"})
      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A"})
      {:ok, %{id: b}} = Queue.join(%{"adapter" => "B"})

      {:ok, t1} = Queue.next_task(a)
      upload(dir, t1, a, "h1")
      {:ok, "done"} = done(t1, a, "h1")
      {:ok, t3} = Queue.next_task(a)
      upload(dir, t3, a, "h3")
      {:ok, "done"} = done(t3, a, "h3")

      {:ok, v} = Queue.next_task(b)
      assert v.kind == "verify"
      assert v.segment.id == "seg-1"

      assert {:ok, "diverged"} =
               Queue.complete(v.segment.id, b, v.lease, "verify", "wrong-digest", nil)

      # seg-2: seg-1's own-run successor.
      assert %{status: "blocked"} = Queue.segment("seg-2")
      # seg-4: seed 2's segment 1, which imports from seg-1.
      assert %{status: "blocked"} = Queue.segment("seg-4")
      # seg-3 has no edge from seg-1 (only an edge *into* seg-2), so it's unaffected.
      assert %{status: "done"} = Queue.segment("seg-3")
    end
  end
end
