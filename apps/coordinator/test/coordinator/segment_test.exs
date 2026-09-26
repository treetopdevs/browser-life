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

  test "block_descendants resets and blocks every later segment of the run, including done and verified ones, and nothing from another run" do
    pending = seg(1)
    done = done_run() |> Map.merge(%{id: "seg-2", index: 2})
    {:ok, verified} = Segment.assign_verify(done_run(), "b", "v", 0)
    {:ok, verified} = Segment.complete_verify(verified, "b", "v", "digest1")
    verified = Map.merge(verified, %{id: "seg-3", index: 3})
    other_run = Segment.new("seg-9", "other/p/c/seed-2", "e", "c", 2, 5, false, 500, 100)

    segments = %{"seg-1" => pending, "seg-2" => done, "seg-3" => verified, "seg-9" => other_run}
    blocked = Segment.block_descendants(segments, "r/p/c/seed-1", 0)

    assert blocked["seg-1"].status == "blocked"
    assert blocked["seg-2"].status == "blocked"
    assert blocked["seg-2"].attempts == []
    assert blocked["seg-3"].status == "blocked"
    assert blocked["seg-9"].status == "pending"
  end

  test "unblock_after resets blocked descendants of a run back to pending, and nothing else" do
    blocked = Segment.block(seg(1))
    still_pending = seg(2)
    segments = %{"seg-1" => blocked, "seg-2" => still_pending}
    unblocked = Segment.unblock_after(segments, "r/p/c/seed-1", 0)
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
end
