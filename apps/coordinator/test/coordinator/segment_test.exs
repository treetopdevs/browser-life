defmodule Coordinator.SegmentTest do
  use ExUnit.Case, async: true
  alias Coordinator.Segment

  defp seg(index \\ 0, last \\ false),
    do: Segment.new("seg-#{index}", "r/p/c/seed-1", "e", "c", 1, index, last, index * 100, 100)

  test "assign_run only accepts a pending segment" do
    s = seg()
    assert {:ok, assigned} = Segment.assign_run(s, "a", "lease1", 0)
    assert assigned.status == "assigned"
    assert [%{kind: "run", island: "a", id: "lease1", outcome: "pending"}] = assigned.attempts
    assert {:error, "segment not pending"} = Segment.assign_run(assigned, "b", "lease2", 0)
  end

  test "heartbeat and publish only accept the current run attempt's lease" do
    {:ok, s} = Segment.assign_run(seg(), "a", "lease1", 0)
    assert {:ok, s} = Segment.heartbeat(s, "run", "a", "lease1", 10)
    assert [%{heartbeat_at: 10}] = s.attempts
    assert {:error, "lease lost"} = Segment.heartbeat(s, "run", "a", "wrong", 20)
    assert {:error, "lease lost"} = Segment.heartbeat(s, "run", "b", "lease1", 20)

    assert {:ok, s} = Segment.publish(s, "a", "lease1", "digest1", "state1")
    assert [%{uploaded_digest: "digest1", state_hash: "state1"}] = s.attempts
    assert {:error, "lease lost"} = Segment.publish(s, "a", "wrong", "digest2", "state2")
  end

  # Review finding: publish_file/6 must not let manifest.json's digest and
  # its manifest_metrics_version drift apart. A caller that omits (or
  # botches) the version for a manifest.json (re)upload is refused outright,
  # rather than silently recording the *new* file's SHA-256 paired with
  # whatever version an *earlier* upload happened to leave behind.
  test "publish_file requires a valid metrics version for manifest.json, and always overwrites it together with the digest" do
    {:ok, s} = Segment.assign_run(seg(), "a", "lease1", 0)

    # No version at all (the 5-arg call, i.e. the controller's own path
    # skipped): refused, not recorded with a stale/missing version.
    assert {:error, "manifest.json requires a valid" <> _} =
             Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v2")

    # An explicit but invalid version (zero, negative, non-integer): also refused.
    assert {:error, "manifest.json requires a valid" <> _} =
             Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v2", 0)

    assert {:error, "manifest.json requires a valid" <> _} =
             Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v2", -1)

    assert {:error, "manifest.json requires a valid" <> _} =
             Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v2", "2")

    # A valid publish succeeds and pairs the digest with its version.
    assert {:ok, s} = Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v2", 2)
    attempt = Enum.find(s.attempts, &(&1.kind == "run"))
    assert attempt.files["manifest.json"] == "sha-v2"
    assert attempt.manifest_metrics_version == 2

    # A later, different upload overwrites BOTH together -- the digest can
    # never end up paired with a stale version (the exact scenario the
    # review reproduced by calling this function directly).
    assert {:ok, s} = Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v1", 1)
    attempt = Enum.find(s.attempts, &(&1.kind == "run"))
    assert attempt.files["manifest.json"] == "sha-v1"
    assert attempt.manifest_metrics_version == 1

    # An invalid re-upload attempt (still no version) leaves the previously
    # recorded, valid pairing untouched rather than corrupting it.
    assert {:error, "manifest.json requires a valid" <> _} =
             Segment.publish_file(s, "a", "lease1", "manifest.json", "sha-v3")

    attempt = Enum.find(s.attempts, &(&1.kind == "run"))
    assert attempt.files["manifest.json"] == "sha-v1"
    assert attempt.manifest_metrics_version == 1

    # Every other file name ignores metrics_version entirely and never
    # touches manifest_metrics_version, whether given one or not.
    assert {:ok, s} = Segment.publish_file(s, "a", "lease1", "series.jsonl", "sha-series")
    attempt = Enum.find(s.attempts, &(&1.kind == "run"))
    assert attempt.files["series.jsonl"] == "sha-series"
    assert attempt.manifest_metrics_version == 1
  end

  test "complete_run requires an upload from the same attempt, and the reported digest to match it" do
    {:ok, s} = Segment.assign_run(seg(), "a", "lease1", 0)

    assert {:error, "upload the end checkpoint before completing a run"} =
             Segment.complete_run(s, "a", "lease1", "digest1", %{})

    {:ok, s} = Segment.publish(s, "a", "lease1", "digest1", "state1")

    assert {:error, "endHash other does not match the uploaded checkpoint (digest1)"} =
             Segment.complete_run(s, "a", "lease1", "other", %{})

    assert {:error, "segment not assigned to this island/lease"} =
             Segment.complete_run(s, "b", "lease1", "digest1", %{})

    assert {:ok, done} = Segment.complete_run(s, "a", "lease1", "digest1", %{steps: 100})
    assert done.status == "done"

    assert [%{outcome: "done", reported_digest: "digest1", summary: %{steps: 100}}] =
             done.attempts

    assert Segment.accepted_digest(done) == "digest1"
    assert Segment.accepted_state_hash(done) == "state1"
    assert Segment.accepted_island(done) == "a"

    # A double-complete on the same attempt is refused: it is no longer pending.
    assert {:error, "segment not assigned to this island/lease"} =
             Segment.complete_run(done, "a", "lease1", "digest1", %{})
  end

  defp done_run(island \\ "a", lease \\ "lease1", digest \\ "digest1") do
    {:ok, s} = Segment.assign_run(seg(), island, lease, 0)
    {:ok, s} = Segment.publish(s, island, lease, digest, "state1")
    {:ok, s} = Segment.complete_run(s, island, lease, digest, %{})
    s
  end

  test "a done segment stays runnable-successor-eligible while a verify attempt is assigned, heartbeats, or is reassigned after expiry" do
    s = done_run()
    assert {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
    assert s.status == "done"
    assert [_run, %{kind: "verify", island: "b", outcome: "pending"}] = s.attempts

    assert {:error, "verify already assigned"} = Segment.assign_verify(s, "c", "vlease2", 100)

    assert {:error, "the producing island cannot verify its own segment"} =
             Segment.assign_verify(done_run(), "a", "x", 0)

    assert {:ok, s} = Segment.heartbeat(s, "verify", "b", "vlease", 110)
    assert s.status == "done"

    # The verify attempt's lease goes stale: it is abandoned, the segment
    # untouched and still `"done"`, and re-verifiable.
    s = Segment.reclaim(s, 100_000, 1000)
    assert s.status == "done"
    assert [%{outcome: "done"}, %{outcome: "abandoned"}] = s.attempts
    refute Segment.pending_or_assigned_verify?(s)
    assert {:ok, s} = Segment.assign_verify(s, "c", "vlease2", 100_000)
    assert [_, _, %{kind: "verify", island: "c", outcome: "pending"}] = s.attempts
  end

  test "complete_verify compares against the accepted RUN attempt's digest, not anything the verifier uploaded" do
    s = done_run("a", "lease1", "digest1")
    {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)

    assert {:ok, verified} = Segment.complete_verify(s, "b", "vlease", "digest1")
    assert verified.status == "verified"
    assert Enum.find(verified.attempts, &(&1.kind == "verify")).outcome == "done"

    s2 = done_run("a", "lease1", "digest1")
    {:ok, s2} = Segment.assign_verify(s2, "b", "vlease", 100)
    assert {:ok, diverged} = Segment.complete_verify(s2, "b", "vlease", "other-digest")
    assert diverged.status == "diverged"
    assert Enum.find(diverged.attempts, &(&1.kind == "verify")).outcome == "diverged"
  end

  @obs_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)
  defp obs_digests(fill \\ "a"), do: Map.new(@obs_files, &{&1, String.duplicate(fill, 64)})

  defp done_run_with_files(files \\ obs_digests()) do
    {:ok, s} = Segment.assign_run(seg(), "a", "lease1", 0)
    {:ok, s} = Segment.publish(s, "a", "lease1", "digest1", "state1")

    s =
      Enum.reduce(files, s, fn {name, sha}, s ->
        {:ok, s} = Segment.publish_file(s, "a", "lease1", name, sha)
        s
      end)

    {:ok, s} = Segment.complete_run(s, "a", "lease1", "digest1", %{})
    s
  end

  test "complete_verify's observations field is independent of the physics digest match: it compares reported file hashes against the accepted run attempt's, and never changes segment status or blocking" do
    accepted = obs_digests("a")
    s = done_run_with_files(accepted)
    {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)

    assert {:ok, matched} = Segment.complete_verify(s, "b", "vlease", "digest1", accepted)
    assert matched.status == "verified"
    assert Enum.find(matched.attempts, &(&1.kind == "verify")).observations == "match"

    s2 = done_run_with_files(accepted)
    {:ok, s2} = Segment.assign_verify(s2, "b", "vlease", 100)
    mismatched = obs_digests("b")
    # Physics digest still matches (segment verifies) even though the
    # observation files reported differ: the two comparisons are independent.
    assert {:ok, verified_but_mismatched} =
             Segment.complete_verify(s2, "b", "vlease", "digest1", mismatched)

    assert verified_but_mismatched.status == "verified"

    assert Enum.find(verified_but_mismatched.attempts, &(&1.kind == "verify")).observations ==
             "mismatch"

    s3 = done_run_with_files(accepted)
    {:ok, s3} = Segment.assign_verify(s3, "b", "vlease", 100)
    # Physics diverges while observations happen to match: still independent,
    # and the segment still diverges (observations never gate status).
    assert {:ok, diverged_but_matched} =
             Segment.complete_verify(s3, "b", "vlease", "other-digest", accepted)

    assert diverged_but_matched.status == "diverged"

    assert Enum.find(diverged_but_matched.attempts, &(&1.kind == "verify")).observations ==
             "match"
  end

  test "complete_verify's observations is nil (not \"mismatch\") when either side lacks any of the six file digests" do
    # No file digests recorded on the accepted run attempt at all.
    s = done_run()
    {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
    assert {:ok, verified} = Segment.complete_verify(s, "b", "vlease", "digest1", obs_digests())
    assert is_nil(Enum.find(verified.attempts, &(&1.kind == "verify")).observations)

    # Accepted files complete, but the verify attempt reports none (older island).
    s2 = done_run_with_files()
    {:ok, s2} = Segment.assign_verify(s2, "b", "vlease", 100)
    assert {:ok, verified2} = Segment.complete_verify(s2, "b", "vlease", "digest1")
    assert is_nil(Enum.find(verified2.attempts, &(&1.kind == "verify")).observations)

    # Accepted files complete, verify attempt reports a partial set.
    s3 = done_run_with_files()
    {:ok, s3} = Segment.assign_verify(s3, "b", "vlease", 100)
    partial = Map.take(obs_digests(), Enum.take(@obs_files, 3))
    assert {:ok, verified3} = Segment.complete_verify(s3, "b", "vlease", "digest1", partial)
    assert is_nil(Enum.find(verified3.attempts, &(&1.kind == "verify")).observations)
  end

  test "complete_verify compares the optional migrations.tsv whenever either side has it" do
    mig = fn fill -> Map.put(obs_digests(), "migrations.tsv", String.duplicate(fill, 64)) end
    obs = fn s -> Enum.find(s.attempts, &(&1.kind == "verify")).observations end

    verify = fn accepted, reported ->
      s = done_run_with_files(accepted)
      {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
      {:ok, s} = Segment.complete_verify(s, "b", "vlease", "digest1", reported)
      s
    end

    assert obs.(verify.(mig.("c"), mig.("c"))) == "match"
    # The six agree but the migration log differs: a mismatch, not a match.
    assert obs.(verify.(mig.("c"), mig.("d"))) == "mismatch"
    # Present on only one side: missing coverage, never "match".
    assert is_nil(obs.(verify.(mig.("c"), obs_digests())))
    assert is_nil(obs.(verify.(obs_digests(), mig.("c"))))
    # Absent on both (a migration-disabled run): the six alone decide.
    assert obs.(verify.(obs_digests(), obs_digests())) == "match"
  end

  test "complete_verify compares the optional exchanges.tsv the same way, whenever either side has it" do
    xchg = fn fill -> Map.put(obs_digests(), "exchanges.tsv", String.duplicate(fill, 64)) end
    obs = fn s -> Enum.find(s.attempts, &(&1.kind == "verify")).observations end

    verify = fn accepted, reported ->
      s = done_run_with_files(accepted)
      {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
      {:ok, s} = Segment.complete_verify(s, "b", "vlease", "digest1", reported)
      s
    end

    assert obs.(verify.(xchg.("c"), xchg.("c"))) == "match"
    assert obs.(verify.(xchg.("c"), xchg.("d"))) == "mismatch"
    assert is_nil(obs.(verify.(xchg.("c"), obs_digests())))
    assert is_nil(obs.(verify.(obs_digests(), xchg.("c"))))
    assert obs.(verify.(obs_digests(), obs_digests())) == "match"
  end

  test "complete_verify compares migrations.tsv and exchanges.tsv independently -- one mismatching does not mask the other matching" do
    both = fn migFill, xchgFill ->
      obs_digests()
      |> Map.put("migrations.tsv", String.duplicate(migFill, 64))
      |> Map.put("exchanges.tsv", String.duplicate(xchgFill, 64))
    end

    obs = fn s -> Enum.find(s.attempts, &(&1.kind == "verify")).observations end

    verify = fn accepted, reported ->
      s = done_run_with_files(accepted)
      {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
      {:ok, s} = Segment.complete_verify(s, "b", "vlease", "digest1", reported)
      s
    end

    assert obs.(verify.(both.("m", "x"), both.("m", "x"))) == "match"
    assert obs.(verify.(both.("m", "x"), both.("m", "y"))) == "mismatch"
    assert obs.(verify.(both.("m", "x"), both.("n", "x"))) == "mismatch"
  end

  # Review finding: `last_verify_attempt/1` (and hence a raw `.observations`
  # read) doesn't know a completed verify attempt's comparison target was
  # ever superseded. `requeue/1` keeps that attempt's record untouched even
  # after the run attempt it compared against is marked "rejected" and
  # replaced by a redo -- including a redo that happens to keep the *same*
  # accepted digest (physics+observer only; bundle files aren't part of it),
  # which is exactly the case a naive `verify.reported_digest == accepted_digest(seg)`
  # guard would fail to catch. `current_observations/1` must return `nil`
  # once the accepted run attempt has changed, never attribute B's old
  # comparison (against A's files) to the new producer C.
  test "current_observations forgets a verify's comparison once the run attempt it targeted is superseded by a redo, even at the same accepted digest" do
    accepted_a = obs_digests("a")
    s = done_run_with_files(accepted_a)
    a_attempt_id = Segment.accepted_run_attempt(s).id

    {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
    mismatched = obs_digests("b")
    {:ok, s} = Segment.complete_verify(s, "b", "vlease", "digest1", mismatched)
    assert s.status == "verified"
    assert Segment.current_observations(s) == "mismatch"

    # Producer A is invalidated and the segment redone by producer C, at the
    # *same* accepted digest but different (unreported) file content.
    requeued = Segment.requeue(s)
    assert requeued.status == "pending"
    {:ok, redone} = Segment.assign_run(requeued, "c", "lease-c", 200)
    {:ok, redone} = Segment.publish(redone, "c", "lease-c", "digest1", "state-c")

    redone =
      Enum.reduce(obs_digests("c"), redone, fn {name, sha}, seg ->
        {:ok, seg} = Segment.publish_file(seg, "c", "lease-c", name, sha)
        seg
      end)

    {:ok, redone} = Segment.complete_run(redone, "c", "lease-c", "digest1", %{})
    assert redone.status == "done"
    c_attempt_id = Segment.accepted_run_attempt(redone).id
    assert c_attempt_id != a_attempt_id
    assert Segment.accepted_digest(redone) == "digest1"

    # B's verify attempt is still `last_verify_attempt/1` (no new verify has
    # happened yet) -- proving this exercises the binding, not just staleness
    # by absence -- but its comparison must no longer count.
    assert Segment.last_verify_attempt(redone).id == "vlease"
    assert Enum.find(redone.attempts, &(&1.kind == "verify")).observations == "mismatch"
    assert is_nil(Segment.current_observations(redone))

    # A fresh verify against the *new* accepted files is attributed correctly.
    {:ok, reverified_seg} = Segment.assign_verify(redone, "d", "vlease2", 300)

    {:ok, reverified_seg} =
      Segment.complete_verify(reverified_seg, "d", "vlease2", "digest1", obs_digests("c"))

    assert Segment.current_observations(reverified_seg) == "match"
  end

  test "a stale run attempt's lease expiring returns the segment to pending, marking (not discarding) its own attempt abandoned" do
    {:ok, s} = Segment.assign_run(seg(), "a", "lease1", 0)
    {:ok, s} = Segment.publish(s, "a", "lease1", "digest1", "state1")
    reclaimed = Segment.reclaim(s, 100_000, 1000)
    assert reclaimed.status == "pending"

    assert [%{outcome: "abandoned", uploaded_digest: "digest1", island: "a", id: "lease1"}] =
             reclaimed.attempts

    # The abandoned attempt is no longer active, so the segment is reassignable.
    assert {:ok, reassigned} = Segment.assign_run(reclaimed, "b", "lease2", 200)

    assert [_, %{kind: "run", island: "b", id: "lease2", outcome: "pending"}] =
             reassigned.attempts
  end

  test "requeue marks the predecessor's accepted attempt rejected (preserving its record) and bumps the reject counter" do
    s = done_run()
    requeued = Segment.requeue(s)
    assert requeued.status == "pending"

    assert [%{outcome: "rejected", uploaded_digest: "digest1", island: "a", id: "lease1"}] =
             requeued.attempts

    assert requeued.rejected == 1
    # Already-rejected (no "done" attempt left to flip): requeue again just bumps the counter.
    assert Segment.requeue(requeued).rejected == 2
  end

  # Review 1 finding #2: a verify attempt assigned against a run result that
  # a *later* segment's island then rejects (invalidating the run attempt the
  # verify was checking) used to stay "pending" through `requeue/1`. If its
  # `complete_verify` call landed after that, it would find the segment back
  # to "pending" but its `accepted_digest` now `nil` (the run attempt was
  # flipped to "rejected"), so *any* reported digest "mismatched" it --
  # corrupting a merely-requeued, about-to-be-redone segment into
  # "diverged" and blocking every descendant.
  test "requeue abandons an in-flight verify attempt instead of leaving it able to corrupt the segment later" do
    s = done_run()
    {:ok, s} = Segment.assign_verify(s, "b", "vlease", 100)
    assert [_run, %{kind: "verify", outcome: "pending", id: "vlease"}] = s.attempts

    requeued = Segment.requeue(s)
    assert requeued.status == "pending"

    assert [%{outcome: "rejected"}, %{kind: "verify", outcome: "abandoned", id: "vlease"}] =
             requeued.attempts

    # The stale verify lease can no longer complete against the requeued
    # segment: `complete_verify/4` now refuses outright since the segment
    # isn't "done", instead of "succeeding" into a corrupt "diverged" status.
    assert {:error, "segment not done"} =
             Segment.complete_verify(requeued, "b", "vlease", "digest1")

    # And once the predecessor is redone (a fresh run attempt completes),
    # a new verify can be assigned immediately -- the old, abandoned attempt
    # no longer counts as "pending" and blocking `assign_verify/4`.
    {:ok, reassigned} = Segment.assign_run(requeued, "c", "lease2", 200)
    {:ok, republished} = Segment.publish(reassigned, "c", "lease2", "digest2", "state2")
    {:ok, redone} = Segment.complete_run(republished, "c", "lease2", "digest2", %{})
    refute Segment.pending_or_assigned_verify?(redone)
    assert {:ok, _} = Segment.assign_verify(redone, "d", "vlease2", 300)
  end

  test "complete_verify refuses a segment that is not (or no longer) \"done\", even with an otherwise-active lease" do
    {:ok, assigned} = Segment.assign_run(seg(), "a", "lease1", 0)

    assert {:error, "segment not done"} =
             Segment.complete_verify(assigned, "a", "lease1", "digest1")
  end

  test "block_descendants blocks every same-run segment after the given one, including done and verified ones, and nothing from another unconnected run" do
    origin = seg(0)
    pending = seg(1)
    done = done_run() |> Map.merge(%{id: "seg-2", index: 2})
    {:ok, verified} = Segment.assign_verify(done_run(), "b", "v", 0)
    {:ok, verified} = Segment.complete_verify(verified, "b", "v", "digest1")
    verified = Map.merge(verified, %{id: "seg-3", index: 3})
    other_run = Segment.new("seg-9", "other/p/c/seed-2", "e", "c", 2, 5, false, 500, 100)

    segments = %{
      "seg-0" => origin,
      "seg-1" => pending,
      "seg-2" => done,
      "seg-3" => verified,
      "seg-9" => other_run
    }

    blocked = Segment.block_descendants(segments, "seg-0")

    assert blocked["seg-0"].status == origin.status
    assert blocked["seg-1"].status == "blocked"
    assert blocked["seg-2"].status == "blocked"
    assert blocked["seg-2"].attempts == []
    assert blocked["seg-3"].status == "blocked"
    assert blocked["seg-9"].status == "pending"
  end

  test "block_descendants also blocks a segment reachable only via a cross-run import_from edge, and transitively its own successors" do
    origin = seg(0)
    # A different run's segment 1 imports from "seg-0"; its own segment 2 is
    # not reachable via import_from, only via that run's own successor edge.
    importer = Segment.new("seg-b1", "other/p/c/seed-2", "e", "c", 2, 1, false, 100, 100, "seg-0")
    importer_next = Segment.new("seg-b2", "other/p/c/seed-2", "e", "c", 2, 2, false, 200, 100)
    unrelated = Segment.new("seg-c0", "third/p/c/seed-3", "e", "c", 3, 0, false, 0, 100)

    segments = %{
      "seg-0" => origin,
      "seg-b1" => importer,
      "seg-b2" => importer_next,
      "seg-c0" => unrelated
    }

    blocked = Segment.block_descendants(segments, "seg-0")
    assert blocked["seg-b1"].status == "blocked"
    assert blocked["seg-b2"].status == "blocked"
    assert blocked["seg-c0"].status == "pending"
  end

  test "unblock_after resets every blocked segment reachable from the given one back to pending, and nothing else" do
    origin = Segment.block(seg(0))
    blocked = Segment.block(seg(1))
    still_pending = seg(2)
    segments = %{"seg-0" => origin, "seg-1" => blocked, "seg-2" => still_pending}
    unblocked = Segment.unblock_after(segments, "seg-0")
    assert unblocked["seg-0"].status == "blocked"
    assert unblocked["seg-1"].status == "pending"
    assert unblocked["seg-2"].status == "pending"
  end

  test "reclaim_stale sweeps every segment in the map" do
    {:ok, a} = Segment.assign_run(seg(0), "a", "l1", 0)
    b = seg(1)
    segments = %{"seg-0" => a, "seg-1" => b}
    reclaimed = Segment.reclaim_stale(segments, 100_000, 1000)
    assert reclaimed["seg-0"].status == "pending"
    assert reclaimed["seg-1"].status == "pending"
  end

  # `reachable/2` is a pure BFS over an arbitrary `%{node => [neighbor]}`
  # graph, decoupled from segments entirely -- see its own doc for why:
  # taint propagation's graph logic (same-run successor edges plus cross-run
  # import_from edges) can be exercised directly against small hand-built
  # graphs, independent of block_descendants/unblock_after's own tests above
  # (which check the *wiring* from real segments into this function).
  describe "reachable/2 (pure graph reachability)" do
    test "a simple chain" do
      graph = %{"a" => ["b"], "b" => ["c"], "c" => []}
      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b", "c"])
      assert Segment.reachable(graph, "b") == MapSet.new(["b", "c"])
      assert Segment.reachable(graph, "c") == MapSet.new(["c"])
    end

    test "a ring terminates instead of looping forever, and reaches every node" do
      graph = %{"a" => ["b"], "b" => ["c"], "c" => ["a"]}
      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b", "c"])
    end

    test "two rings connected by a single cross edge: reaching into one ring reaches the other too" do
      graph = %{
        "a" => ["b"],
        "b" => ["c"],
        "c" => ["a", "x"],
        "x" => ["y"],
        "y" => ["z"],
        "z" => ["x"]
      }

      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b", "c", "x", "y", "z"])
      # The cross edge is one-directional: the second ring can't reach the first.
      assert Segment.reachable(graph, "x") == MapSet.new(["x", "y", "z"])
    end

    test "a diamond: a node reachable via two different paths appears exactly once" do
      graph = %{"a" => ["b", "c"], "b" => ["d"], "c" => ["d"], "d" => []}
      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b", "c", "d"])
    end

    test "a node reachable both via a same-run-style edge and an import-style edge" do
      # "d" has two incoming edges from "a": one direct (as if a same-run
      # successor two steps down an unrelated path) and one via "c" (as if a
      # different run's import_from chain) -- both must land on exactly "d".
      graph = %{"a" => ["b", "c"], "b" => [], "c" => ["d"], "d" => []}
      # Re-point "b" at "d" too, so "d" is reached by both of "a"'s branches.
      graph = %{graph | "b" => ["d"]}
      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b", "c", "d"])
    end

    test "an empty/absent start node has no neighbors but is still in the result" do
      assert Segment.reachable(%{}, "lonely") == MapSet.new(["lonely"])
    end

    test "unreachable nodes are excluded" do
      graph = %{"a" => ["b"], "b" => [], "unrelated" => ["also-unrelated"]}
      assert Segment.reachable(graph, "a") == MapSet.new(["a", "b"])
    end
  end

  describe "dependents_graph/1 (real segments -> graph)" do
    test "same-run successor and cross-run import_from edges, combined" do
      a0 = seg(0)
      a1 = seg(1)
      # b0 imports from a0; b1 is only b0's own-run successor.
      b0 = Segment.new("seg-b0", "other/p/c/seed-2", "e", "c", 2, 0, false, 0, 100, "seg-0")
      b1 = Segment.new("seg-b1", "other/p/c/seed-2", "e", "c", 2, 1, false, 100, 100)

      segments = %{"seg-0" => a0, "seg-1" => a1, "seg-b0" => b0, "seg-b1" => b1}
      graph = Segment.dependents_graph(segments)

      assert graph["seg-0"] |> Enum.sort() == ["seg-1", "seg-b0"]
      assert graph["seg-1"] == []
      assert graph["seg-b0"] == ["seg-b1"]
      assert graph["seg-b1"] == []
    end

    # Review P2: the previous `dependents_graph/1` re-scanned the *entire*
    # segments map once per vertex to find its importers -- O(n^2) -- which
    # measured 5.8s at 10,000 segments inside `Coordinator.Queue`'s own
    # GenServer call (a 5s call timeout, and the system's own
    # 100k-segments/experiment limit). This pins that it now stays well
    # under a second at that limit.
    test "stays well under a second at 100,000 segments (was O(n^2): 5.8s at 10,000)" do
      segments =
        for run <- 0..999, index <- 0..99, into: %{} do
          id = "seg-r#{run}-s#{index}"
          import_from = if run > 0 and index == 0, do: "seg-r#{run - 1}-s99"

          seg =
            Segment.new(
              id,
              "run-#{run}",
              "perf",
              "c",
              run,
              index,
              index == 99,
              index * 100,
              100,
              import_from
            )

          {id, seg}
        end

      assert map_size(segments) == 100_000

      {graph_us, graph} = :timer.tc(fn -> Segment.dependents_graph(segments) end)
      assert map_size(graph) == 100_000
      assert graph_us < 1_000_000, "dependents_graph/1 took #{graph_us}us for 100,000 segments"

      {block_us, _blocked} = :timer.tc(fn -> Segment.block_descendants(segments, "seg-r0-s0") end)
      assert block_us < 1_000_000, "block_descendants/2 took #{block_us}us for 100,000 segments"
    end
  end
end
