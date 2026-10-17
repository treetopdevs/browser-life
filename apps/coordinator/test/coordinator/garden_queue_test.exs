defmodule Coordinator.GardenQueueTest do
  @moduledoc """
  The garden inside `Coordinator.Queue`: creation, the release gate, letters
  rewriting the experiment's schedule, and the one invariant that makes that
  sound (a letter never changes what any ever-assigned day owns). Pure garden
  rules are `Coordinator.GardenTest`; this file drives a real Queue process on
  a hand-moved clock (`Coordinator.TestClock`), on `spots` with a 20-step day.
  """
  use ExUnit.Case, async: false
  alias Coordinator.{Queue, TestClock}

  @day 86_400_000
  @d 20
  @caps ["interventions-v1"]
  @founding [%{"step" => 0, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]
  @summary %{
    "finalIndividuals" => 5,
    "finalLineages" => 2,
    "maxGeneration" => 3,
    "mutations" => 4,
    "extinct" => false,
    "conservationOk" => true
  }

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-garden-queue-#{System.unique_integer([:positive])}")
    # Advancing a dawn (a day of fake time) would expire every default lease;
    # these tests move time deliberately and never want a reclaim.
    Application.put_env(:coordinator, :lease_ms, 1_000 * @day)
    TestClock.install(100 * @day + 3_600_000)

    on_exit(fn ->
      TestClock.uninstall()
      Application.delete_env(:coordinator, :lease_ms)
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    %{dir: dir}
  end

  # ---- helpers ----

  defp params(over \\ %{}) do
    Map.merge(
      %{
        "name" => "g1",
        "presetId" => "spots",
        "seed" => 1,
        "founding" => @founding,
        "stepsPerDay" => @d,
        "censusEvery" => 10,
        "days" => 5,
        "lettersPerDay" => 2,
        "queueMax" => 4
      },
      over
    )
  end

  defp join(adapter) do
    {:ok, %{id: id}} = Queue.join(%{"adapter" => adapter})
    id
  end

  defp next(island) do
    {:ok, task} = Queue.next_task(island, @caps)
    task
  end

  # A 16-hex digest per day (the checkpoint route only serves those).
  defp dg(day),
    do: (0xA0 + day) |> Integer.to_string(16) |> String.downcase() |> String.pad_leading(16, "0")

  defp finish(dir, island, task, summary \\ @summary) do
    staged = Path.join(dir, "cp-#{System.unique_integer([:positive])}")
    File.write!(staged, "x")
    digest = dg(task.segment.index)

    :ok =
      Queue.publish_checkpoint(
        task.segment.id,
        island,
        task.lease,
        staged,
        digest,
        "0000000000000000"
      )

    {:ok, "done"} = Queue.complete(task.segment.id, island, task.lease, "run", digest, summary)
    :ok
  end

  defp verify(task, island),
    do:
      Queue.complete(
        task.segment.id,
        island,
        task.lease,
        "verify",
        dg(task.segment.index),
        %{}
      )

  # What a segment (start, steps) owns of an intervention list: step s belongs
  # to the segment that stepped to s, plus step 0 for the first.
  defp owned(list, start, steps),
    do:
      Enum.filter(list, fn e ->
        (e["step"] > start and e["step"] <= start + steps) or (start == 0 and e["step"] == 0)
      end)

  defp owned(task), do: owned(task.spec.interventions, task.segment.startStep, task.segment.steps)

  defp live_list(name \\ "g1"), do: Queue.experiment(name).spec["interventions"]
  defp live_owned(day), do: owned(live_list(), day * @d, @d)

  defp letter(x), do: %{x: x, y: 5, r: 2}
  defp view, do: Queue.garden_view("g1")

  # ---- creation ----

  describe "create_garden/1" do
    test "builds the experiment underneath and the garden record; the founding is the schedule" do
      assert {:ok, 5} = Queue.create_garden(params())

      %{spec: spec, segments: segments} = Queue.experiment("g1")
      assert spec["garden"] == true
      assert spec["interventions"] == @founding
      assert spec["segmentSteps"] == @d and spec["steps"] == 5 * @d
      assert spec["verifyFraction"] == 1.0 and spec["conditions"] == ["treatment"]
      assert Enum.map(segments, & &1.run) |> Enum.uniq() == ["g1/spots/treatment/seed-1"]
      assert length(segments) == 5

      v = view()
      assert v.contract == "garden-v1" and v.name == "g1"
      assert v.world == %{width: 256, height: 256}
      assert v.clock.daysTotal == 5 and v.clock.releasedStep == @d
      assert v.state == "waiting-for-island"
      # The whole view is plain JSON data.
      assert {:ok, _} = Jason.encode(v)
      assert Queue.garden_view("nope") == nil
    end

    test "defaults: the production preset, a daily dawn" do
      assert {:error, why} = Queue.create_garden(%{"name" => "g1", "seed" => 1})
      assert why =~ "founding"
      # No `presetId` means wild-storm-large (a garden preset, on a 512x512 world).
      assert {:ok, 365} =
               Queue.create_garden(%{"name" => "commons", "seed" => 1, "founding" => @founding})

      v = Queue.garden_view("commons")
      assert v.presetId == "wild-storm-large"
      assert v.world == %{width: 512, height: 512}
      assert v.pace.stepsPerDay == 131_072 and v.pace.dawnPeriodMs == @day
      assert v.letters.perDay == 8 and v.letters.queueMax == 64
    end

    test "refuses what it cannot run, and leaves nothing behind" do
      bad = fn over -> Queue.create_garden(params(over)) end

      assert {:error, "presetId must be one of" <> _} = bad.(%{"presetId" => "gradient"})
      assert {:error, "presetId must be one of" <> _} = bad.(%{"presetId" => 7})
      assert {:error, "name must match" <> _} = bad.(%{"name" => "../x"})
      assert {:error, "name must match" <> _} = bad.(%{"name" => nil})
      assert {:error, "seed must be a u32" <> _} = bad.(%{"seed" => -1})
      assert {:error, "seed must be a u32" <> _} = bad.(%{"seed" => 1.0})
      assert {:error, "founding must be a non-empty" <> _} = bad.(%{"founding" => []})
      assert {:error, "founding must be a non-empty" <> _} = bad.(%{"founding" => nil})
      assert {:error, "founding must be a non-empty" <> _} = bad.(%{"founding" => "stone"})
      assert {:error, "censusEvery must be" <> _} = bad.(%{"censusEvery" => 7})
      assert {:error, "censusEvery must be" <> _} = bad.(%{"censusEvery" => 40})
      assert {:error, "days must be" <> _} = bad.(%{"days" => 0})
      assert {:error, "days must be" <> _} = bad.(%{"days" => 1_000_000_000})
      assert {:error, "stepsPerDay must be" <> _} = bad.(%{"stepsPerDay" => 0})
      assert {:error, "deepEvery must be" <> _} = bad.(%{"deepEvery" => 0})
      assert {:error, "lettersPerDay must be" <> _} = bad.(%{"lettersPerDay" => 65})
      assert {:error, "queueMax must be" <> _} = bad.(%{"queueMax" => 1001})
      assert {:error, "dawnPeriodMs must be" <> _} = bad.(%{"dawnPeriodMs" => 999})
      assert {:error, "dawnPeriodMs must be" <> _} = bad.(%{"dawnPeriodMs" => 8 * @day})
      assert {:error, "dawnOffsetMs must be" <> _} = bad.(%{"dawnOffsetMs" => @day})
      assert {:error, "dawnOffsetMs must be" <> _} = bad.(%{"dawnOffsetMs" => -1})
      assert {:error, "a garden has no key \"dawn\"" <> _} = bad.(%{"dawn" => 1})
      assert {:error, "a garden must be an object"} = Queue.create_garden("garden")

      # The founding schedule is held to the runner's rules, worded for `founding`.
      assert {:error, "founding[0]: x 256 is outside the world" <> _} =
               bad.(%{"founding" => [%{hd(@founding) | "x" => 256}]})

      assert {:error, "founding[0]: a lesion needs" <> _} =
               bad.(%{"founding" => [%{"step" => 0, "kind" => "lesion", "x" => 1}]})

      # ...and must all be at step 0.
      assert {:error, "founding[1]: step must be 0" <> _} =
               bad.(%{"founding" => @founding ++ [%{hd(@founding) | "step" => 20}]})

      assert Queue.garden_view("g1") == nil
      assert Queue.experiment("g1") == nil
      assert Queue.status().counts == %{}
    end

    test "an experiment and a garden never share a name" do
      spec = %{
        "experiment" => "g1",
        "presetId" => "spots",
        "conditions" => ["treatment"],
        "seeds" => [1],
        "steps" => 60,
        "segmentSteps" => 20,
        "censusEvery" => 10
      }

      {:ok, 3} = Queue.create_experiment(spec)
      assert {:error, "experiment exists"} = Queue.create_garden(params())
      assert Queue.garden_view("g1") == nil

      assert {:ok, 5} = Queue.create_garden(params(%{"name" => "g2"}))
      assert {:error, "garden exists"} = Queue.create_garden(params(%{"name" => "g2"}))

      assert {:error, "experiment exists"} =
               Queue.create_experiment(%{spec | "experiment" => "g2"})

      # The failed attempts did not disturb the garden.
      assert Queue.garden_view("g2").name == "g2"
    end

    test "a client cannot make an experiment a garden" do
      spec = %{
        "experiment" => "sneaky",
        "garden" => true,
        "presetId" => "spots",
        "conditions" => ["treatment"],
        "seeds" => [1],
        "steps" => 60,
        "segmentSteps" => 20,
        "censusEvery" => 10
      }

      {:ok, 3} = Queue.create_experiment(spec)
      refute Map.has_key?(Queue.experiment("sneaky").spec, "garden")
      assert Queue.garden_view("sneaky") == nil
    end
  end

  # ---- the release gate ----

  describe "release" do
    test "day 1 is not offered until day 0 is done and a dawn has passed", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      # An island that cannot apply interventions is never handed a garden's work.
      assert {:ok, %{kind: "idle"}} = Queue.next_task(a)

      t0 = next(a)
      assert t0.kind == "run" and t0.segment.index == 0
      assert t0.spec.interventions == @founding
      # A dawn passes while day 0 is still being grown: nothing new to offer.
      TestClock.advance(@day)
      assert %{kind: "idle"} = next(b)

      finish(dir, a, t0)
      # Day 0 is done, and a dawn has passed since it was released -- but
      # only the verifier is wanted first.
      v0 = next(b)
      assert v0.kind == "verify" and v0.segment.index == 0
      {:ok, "verified"} = verify(v0, b)

      # The dawn that passed during day 0 released day 1 at b's ask (the
      # replay still went first), so the producer is handed it now.
      t1 = next(a)
      assert t1.kind == "run" and t1.segment.index == 1
    end

    test "the release gate holds a done day's successor until the next dawn", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)

      # Same dawn period: the producer has nothing to do (it cannot verify its
      # own day, and day 1 is not released), the verifier gets the replay.
      assert %{kind: "idle"} = next(a)
      v0 = next(b)
      assert v0.kind == "verify"
      {:ok, "verified"} = verify(v0, b)
      assert %{kind: "idle"} = next(a)
      assert %{kind: "idle"} = next(b)
      assert view().clock.releasedStep == @d
      assert view().pace.releaseDue == false
      next_release = view().pace.nextReleaseAt
      assert next_release == view().pace.nextDawnAt

      # One dawn later the release is due, visible before any island asks.
      TestClock.set(next_release)
      assert view().pace.releaseDue == true
      assert view().state == "waiting-for-island"
      assert view().clock.releasedStep == @d

      t1 = next(b)
      assert t1.kind == "run" and t1.segment.index == 1
      assert view().clock.releasedStep == 2 * @d
      assert view().days |> hd() |> Map.fetch!(:releasedAt) == next_release
    end

    test "missed dawns do not bank: one release per ask", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)

      TestClock.advance(10 * @day)
      t1 = next(a)
      assert t1.segment.index == 1
      finish(dir, a, t1)
      {:ok, "verified"} = verify(next(b), b)

      # Ten dawns went by, one day was released; day 2 waits for a dawn after day 1.
      assert %{kind: "idle"} = next(a)
      assert %{kind: "idle"} = next(b)
      assert view().clock.releasedStep == 2 * @d

      TestClock.advance(@day)
      t2 = next(b)
      assert t2.segment.index == 2
      assert view().clock.releasedStep == 3 * @d
    end

    test "release times and done/verified stamps are recorded", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      created = TestClock.now()

      t0 = next(a)
      TestClock.advance(5_000)
      finish(dir, a, t0)
      done_at = TestClock.now()
      TestClock.advance(7_000)
      {:ok, "verified"} = verify(next(b), b)

      [day0] = view().days
      assert day0.releasedAt == created
      assert day0.doneAt == done_at
      assert day0.verifiedAt == done_at + 7_000
      assert day0.status == "verified" and day0.digest == dg(0)
    end
  end

  # ---- letters and the invariant ----

  describe "letters" do
    test "THE INVARIANT: a letter never changes what any assigned day owns", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      # What each assigned day owned when its first task was handed out.
      sealed = fn tasks -> Map.new(tasks, fn {day, t} -> {day, owned(t)} end) end

      # Day 0 is assigned: a letter posted now cannot go on it. It lands on day 1.
      t0 = next(a)
      assert owned(t0) == @founding
      {:ok, l1} = Queue.post_letter("g1", letter(1))
      assert l1.id == "ltr-1" and l1.day == 1 and l1.landsAtStep == 2 * @d
      assert l1.status == "waiting"
      assert live_owned(0) == owned(t0)

      finish(dir, a, t0)
      v0 = next(b)
      assert v0.kind == "verify" and v0.segment.index == 0
      assert owned(v0) == owned(t0)
      {:ok, "verified"} = verify(v0, b)

      # Day 1: its run carries the letter, because the letter was posted before.
      TestClock.advance(@day)
      t1 = next(a)
      assert t1.segment.index == 1
      assert [%{"step" => 40, "kind" => "lesion", "x" => 1, "y" => 5, "r" => 2}] = owned(t1)

      assert view().letters.recent |> Enum.find(&(&1.id == "ltr-1")) |> Map.fetch!(:status) ==
               "sealed"

      # While day 1 is assigned, more letters arrive. They go to day 2 and 3
      # (two a day), never to day 1 or 0.
      {:ok, l2} = Queue.post_letter("g1", letter(2))
      {:ok, l3} = Queue.post_letter("g1", letter(3))
      {:ok, l4} = Queue.post_letter("g1", letter(4))
      {:ok, l5} = Queue.post_letter("g1", letter(5))
      assert [l2.day, l3.day, l4.day, l5.day] == [2, 2, 3, 3]
      assert [l2.landsAtStep, l4.landsAtStep] == [3 * @d, 4 * @d]

      # The queue is full (four waiting); a refusal changes nothing.
      list_before = live_list()
      assert {:error, {:refused, "the letter queue is full"}} = Queue.post_letter("g1", letter(6))
      assert live_list() == list_before

      # A veto of a waiting letter on an unassigned day is fine.
      assert {:ok, %{status: "dropped", id: "ltr-3"}} = Queue.drop_letter("g1", "ltr-3")

      snapshot = sealed.(%{0 => t0, 1 => t1})
      assert live_owned(0) == snapshot[0]
      assert live_owned(1) == snapshot[1]
      # The live list moved, though: it holds the new letters at their own steps.
      assert length(live_list()) == 1 + 1 + 3
      refute live_list() == t1.spec.interventions

      # Day 1 finishes and is replayed by another island *with the new list*.
      finish(dir, a, t1)
      v1 = next(b)
      assert v1.kind == "verify" and v1.segment.index == 1
      refute v1.spec.interventions == t1.spec.interventions
      assert owned(v1) == owned(t1)
      assert v1.spec.interventions == live_list()
      {:ok, "verified"} = verify(v1, b)

      # Day 2 rides with its letters, and from then on is sealed too.
      TestClock.advance(@day)
      t2 = next(a)
      assert t2.segment.index == 2
      assert [%{"step" => 60, "x" => 2}] = owned(t2)

      assert {:error, {:refused, "the letter's day has been assigned"}} =
               Queue.drop_letter("g1", "ltr-2")

      # Day 3's letters are still free to go; a new one fills the freed slot.
      assert {:ok, %{status: "dropped"}} = Queue.drop_letter("g1", "ltr-4")
      # Dropping again is the same answer, not a refusal (a keeper's retry).
      assert {:ok, %{status: "dropped", id: "ltr-4"}} = Queue.drop_letter("g1", "ltr-4")
      # (The refused letter above took no id: this one is ltr-6.)
      {:ok, l6} = Queue.post_letter("g1", letter(7))
      assert l6.id == "ltr-6" and l6.day == 3

      snapshot = sealed.(%{0 => t0, 1 => t1, 2 => t2})
      for day <- 0..2, do: assert(live_owned(day) == snapshot[day])

      # The view tells the same story.
      by_id = Map.new(view().letters.recent ++ view().letters.waiting, &{&1.id, &1})
      assert by_id["ltr-1"].status == "verified" and by_id["ltr-1"].landedIn == dg(1)
      assert by_id["ltr-2"].status == "sealed" and by_id["ltr-2"].landedIn == nil
      assert by_id["ltr-3"].status == "dropped" and is_integer(by_id["ltr-3"].droppedAt)
      assert by_id["ltr-5"].status == "waiting"
      assert Enum.map(view().letters.waiting, & &1.id) == ["ltr-5", "ltr-6"]
    end

    test "the letter rides in the task of the day it lands on", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      {:ok, l} = Queue.post_letter("g1", %{x: 9, y: 8, r: 7})
      assert l.day == 2
      finish(dir, a, t1)
      {:ok, "verified"} = verify(next(b), b)

      TestClock.advance(@day)
      t2 = next(a)
      assert t2.segment.index == 2
      lesion = %{"step" => 60, "kind" => "lesion", "x" => 9, "y" => 8, "r" => 7}
      assert owned(t2) == [lesion]
      # The whole list rides in every task, the founding step 0 too.
      assert t2.spec.interventions == @founding ++ [lesion]
      assert Enum.map(t2.spec.interventions, & &1["step"]) == [0, 60]
    end

    test "a reject resets later days: the frontier retreats, attempted days stay sealed",
         %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      # Day 1 is done and not (yet) replayed: only a verified garden day is
      # protected from a reject.
      finish(dir, a, t1)
      TestClock.advance(@day)
      t2 = next(a)
      assert t2.segment.index == 2

      # Day 2 is assigned, so a new letter goes to day 3.
      {:ok, on3} = Queue.post_letter("g1", letter(1))
      assert on3.day == 3

      sealed_0 = live_owned(0)
      sealed_1 = live_owned(1)

      # Day 2's island finds day 1's checkpoint inconsistent: day 1 is
      # requeued, day 2's attempt is gone.
      assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "does not match", "own")
      statuses = Queue.experiment("g1").segments |> Map.new(&{&1.index, &1.status})
      assert statuses[1] == "pending" and statuses[2] == "pending"

      # Day 2 has no attempt any more: a letter can go there, and one already
      # there could be dropped.
      {:ok, on2} = Queue.post_letter("g1", letter(2))
      assert on2.day == 2
      assert live_owned(0) == sealed_0
      assert live_owned(1) == sealed_1

      # Day 1 (requeued, its attempts kept) is still sealed: no letter lands on it.
      for x <- 3..4 do
        assert {:ok, %{day: day}} = Queue.post_letter("g1", letter(x))
        assert day >= 2
      end

      assert live_owned(1) == sealed_1

      # The redo of day 1 replays the same slice.
      t1b = next(b)
      assert t1b.segment.index == 1
      assert owned(t1b) == owned(t1)
      assert owned(t1b) == sealed_1
    end

    test "refuses what it should, and survives hostile callers" do
      {:ok, 5} = Queue.create_garden(params())

      assert {:error, :not_found} = Queue.post_letter("nope", letter(1))
      assert {:error, :not_found} = Queue.drop_letter("nope", "ltr-1")
      assert {:error, :not_found} = Queue.drop_letter("g1", "ltr-99")
      assert {:error, {:invalid, "x must be in 0..255"}} = Queue.post_letter("g1", letter(256))

      assert {:error, {:invalid, "y must be in 0..255"}} =
               Queue.post_letter("g1", %{x: 0, y: 256, r: 1})

      for bad <- [%{x: 1.5, y: 2, r: 3}, %{x: 1, y: 2, r: 99}, %{x: 1, y: 2}, "x", nil, %{}] do
        assert {:error, {:invalid, msg}} = Queue.post_letter("g1", bad)
        assert is_binary(msg)
      end

      # Nothing was stored, and the queue process is still serving.
      assert Queue.experiment("g1").spec["interventions"] == @founding
      assert view().letters.queued == 0
    end

    test "a stopped garden takes no letters", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      t0 = next(a)
      finish(dir, a, t0)
      v0 = next(b)
      {:ok, "diverged"} = Queue.complete(v0.segment.id, b, v0.lease, "verify", dg(77), %{})

      assert view().state == "stopped"

      assert {:error, {:refused, "the garden has stopped" <> _}} =
               Queue.post_letter("g1", letter(1))

      assert view().letters.nextLanding == nil
    end
  end

  # ---- checkpoint ----

  describe "garden_checkpoint/2" do
    test "serves only a verified day's digest, from the store", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      assert Queue.garden_checkpoint("g1", dg(0)) == nil
      t0 = next(a)
      finish(dir, a, t0)
      # Done, not verified: not served.
      assert Queue.garden_checkpoint("g1", dg(0)) == nil

      v0 = next(b)
      {:ok, "verified"} = verify(v0, b)
      path = Queue.garden_checkpoint("g1", dg(0))
      assert is_binary(path) and File.read!(path) == "x"
      assert path == Coordinator.Store.path(Queue.data_dir(), dg(0))

      # Not other digests, other gardens, or anything that is not a 16-hex digest.
      assert Queue.garden_checkpoint("g1", dg(1)) == nil
      assert Queue.garden_checkpoint("nope", dg(0)) == nil
      assert Queue.garden_checkpoint("g1", "../../state.bin") == nil
      assert Queue.garden_checkpoint("g1", String.upcase(dg(0))) == nil
      assert Queue.garden_checkpoint("g1", nil) == nil
      assert Queue.garden_checkpoint("g1", 5) == nil
    end
  end

  # ---- the verified prefix ----

  describe "garden_checkpoints/1" do
    test "only the verified prefix's end checkpoints, never a day behind an unreplayed one", %{
      dir: dir
    } do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      c = join("C")

      assert Queue.garden_checkpoints("g1") == %{}
      assert Queue.garden_checkpoints("nope") == %{}

      # Day 0: run by A, its replay handed to B and then left in flight.
      t0 = next(a)
      finish(dir, a, t0)
      v0 = next(b)
      assert v0.kind == "verify" and v0.segment.index == 0

      # Dawn: day 1 is run by C and replayed by A, while day 0 is still only
      # "done" (B's replay is outstanding).
      TestClock.advance(@day)
      t1 = next(c)
      assert t1.kind == "run" and t1.segment.index == 1
      finish(dir, c, t1)
      v1 = next(a)
      assert v1.kind == "verify" and v1.segment.index == 1
      {:ok, "verified"} = verify(v1, a)

      # Day 1 is verified on its own, but its ancestor is not: nothing is served,
      # and the view's fork agrees.
      assert Queue.garden_checkpoints("g1") == %{}
      assert Queue.garden_checkpoint("g1", dg(1)) == nil
      assert view().fork == nil and view().clock.verifiedStep == 0

      # B's replay lands: both days are the verified prefix.
      {:ok, "verified"} = verify(v0, b)
      served = Queue.garden_checkpoints("g1")
      assert Map.keys(served) |> Enum.sort() == [dg(0), dg(1)]
      assert served[dg(1)] == Queue.garden_checkpoint("g1", dg(1))
      assert view().fork.day == 1 and view().clock.verifiedStep == 2 * @d
    end
  end

  # ---- recovery and who may tend it ----

  describe "requeue_garden_day/2" do
    test "puts a failed day back, unblocks its successors, and leaves the letters alone", %{
      dir: dir
    } do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      {:ok, _} = Queue.post_letter("g1", letter(1))
      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)

      # A volunteer fails day 1: the garden is stopped for good, as far as the
      # public routes can tell.
      t1 = next(a)
      assert t1.segment.index == 1
      :ok = Queue.fail(t1.segment.id, a, t1.lease, "cannot run")
      assert view().state == "stopped"

      assert {:error, {:refused, "the garden has stopped" <> _}} =
               Queue.post_letter("g1", letter(2))

      owned_before = owned(t1)

      # Only a failed or diverged day is requeued; unknown days and gardens are 404s.
      assert {:error, {:refused, "day 0 is verified" <> _}} = Queue.requeue_garden_day("g1", 0)
      assert {:error, {:refused, "day 2 is blocked" <> _}} = Queue.requeue_garden_day("g1", 2)
      assert {:error, :not_found} = Queue.requeue_garden_day("g1", 99)
      assert {:error, :not_found} = Queue.requeue_garden_day("nope", 1)

      assert {:ok, "pending"} = Queue.requeue_garden_day("g1", 1)
      assert view().state == "waiting-for-island"
      assert {:ok, %{status: "waiting"}} = Queue.post_letter("g1", letter(2))

      # Another island takes the day again, with the slice it owned the first time.
      t1b = next(b)
      assert t1b.kind == "run" and t1b.segment.index == 1
      assert owned(t1b) == owned_before
      finish(dir, b, t1b)
      {:ok, "verified"} = verify(next(a), a)
      assert view().clock.verifiedStep == 2 * @d
    end

    test "a diverged day can be requeued too", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      t0 = next(a)
      finish(dir, a, t0)
      v0 = next(b)
      {:ok, "diverged"} = Queue.complete(v0.segment.id, b, v0.lease, "verify", dg(77), %{})
      assert view().state == "stopped"

      assert {:ok, "pending"} = Queue.requeue_garden_day("g1", 0)
      assert view().state == "waiting-for-island"
      assert view().verification.diverged == 0
    end
  end

  describe "who may tend a garden" do
    setup do
      on_exit(fn -> Application.delete_env(:coordinator, :garden_island_token) end)
    end

    test "with a garden island token only islands that joined with it are offered a garden's days",
         %{dir: dir} do
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")
      {:ok, 5} = Queue.create_garden(params())

      {:ok, %{id: stranger}} = Queue.join(%{"adapter" => "S"})
      {:ok, %{id: wrong}} = Queue.join(%{"adapter" => "W", "gardenToken" => "nope"})
      {:ok, %{id: a}} = Queue.join(%{"adapter" => "A", "gardenToken" => "open-sesame"})
      {:ok, %{id: b}} = Queue.join(%{"adapter" => "B", "gardenToken" => "open-sesame"})

      assert {:ok, %{kind: "idle"}} = Queue.next_task(stranger, @caps)
      assert {:ok, %{kind: "idle"}} = Queue.next_task(wrong, @caps)

      t0 = next(a)
      assert t0.kind == "run"
      finish(dir, a, t0)

      # The replay too: an outsider is not handed it, an insider is.
      assert {:ok, %{kind: "idle"}} = Queue.next_task(stranger, @caps)
      v0 = next(b)
      assert v0.kind == "verify"
      {:ok, "verified"} = verify(v0, b)

      # The token is not kept anywhere an island can read it back.
      refute inspect(Queue.island_info(a)) =~ "open-sesame"
      assert Queue.island_info(a).garden == true
      refute Map.has_key?(Queue.island_info(stranger), :garden)
    end

    test "without one, any island may; an ordinary experiment is never gated", %{dir: _dir} do
      Application.put_env(:coordinator, :garden_island_token, "open-sesame")

      {:ok, 3} =
        Queue.create_experiment(%{
          "experiment" => "plain",
          "presetId" => "spots",
          "conditions" => ["treatment"],
          "seeds" => [1],
          "steps" => 60,
          "segmentSteps" => 20,
          "censusEvery" => 10
        })

      outsider = join("S")
      assert %{kind: "run"} = next(outsider)

      Application.delete_env(:coordinator, :garden_island_token)
      {:ok, 5} = Queue.create_garden(params())
      assert %{kind: "run", segment: %{run: "g1" <> _}} = next(join("T"))
    end

    test "a verified day of a garden cannot be rejected by a later day's island", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")
      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      assert t1.segment.index == 1

      assert {:error, "the predecessor is a verified day of a garden" <> _} =
               Queue.reject(t1.segment.id, a, t1.lease, "bad start", "own")

      assert view().clock.verifiedStep == @d
      assert view().days |> Enum.find(&(&1.day == 0)) |> Map.fetch!(:status) == "verified"
    end

    test "a day that is only done can still be rejected (the existing rule)", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      t0 = next(a)
      finish(dir, a, t0)
      TestClock.advance(@day)
      # Day 0 is done, not verified: an island on day 1 may still reject it.
      b = join("B")
      c = join("C")
      assert next(b).kind == "verify"
      t1 = next(c)
      assert t1.kind == "run" and t1.segment.index == 1
      assert :ok = Queue.reject(t1.segment.id, c, t1.lease, "bad start", "own")
    end
  end

  describe "the registry the web layer reads" do
    test "knows a garden's world once founded, and again after a restart", %{dir: dir} do
      alias Coordinator.LetterLimiter
      assert LetterLimiter.garden_world("g1") == nil
      {:ok, 5} = Queue.create_garden(params())
      assert LetterLimiter.garden_world("g1") == {256, 256}

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})
      assert LetterLimiter.garden_world("g1") == {256, 256}
    end
  end

  # ---- the view's liveness ----

  describe "garden_view/1" do
    test "an unreclaimed dead lease reads as waiting, not growing" do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      Application.put_env(:coordinator, :lease_ms, 60_000)
      _t0 = next(a)
      assert view().state == "growing"
      assert view().tending.activeNow == 1
      assert [%{status: "growing"}] = view().days

      TestClock.advance(121_000)
      v = view()
      assert v.state == "waiting-for-island"
      assert v.tending.activeNow == 0
      assert [%{status: "waiting"}] = v.days
      assert v.asleep == true

      # The lease has not been reclaimed (nobody asked), yet the attempt is
      # not alive: no leaked island ids or adapters in the output.
      refute Jason.encode!(v) =~ a
      refute Jason.encode!(v) =~ "A\""
    end
  end

  # ---- persistence ----

  describe "persistence" do
    test "a restart keeps gardens, letters and release times", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      a = join("A")
      b = join("B")

      t0 = next(a)
      {:ok, _} = Queue.post_letter("g1", letter(1))
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      assert t1.segment.index == 1
      {:ok, _} = Queue.post_letter("g1", letter(2))
      {:ok, _} = Queue.drop_letter("g1", "ltr-2")

      before_view = view()
      before_list = live_list()
      assert before_view.clock.releasedStep == 2 * @d

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})

      assert view() == before_view
      assert live_list() == before_list
      assert Queue.experiment("g1").spec["garden"] == true

      # The restarted garden still keeps its pace: day 2 waits for day 1 and a dawn.
      c = join("C")
      assert {:ok, %{kind: "idle"}} = Queue.next_task(c, @caps)
      # ...and ids continue where they left off.
      assert {:ok, %{id: "ltr-3"}} = Queue.post_letter("g1", letter(3))
    end

    test "the file has no :gardens key until one exists", %{dir: dir} do
      read = fn -> dir |> Path.join("state.bin") |> File.read!() |> :erlang.binary_to_term() end

      {:ok, 3} =
        Queue.create_experiment(%{
          "experiment" => "plain",
          "presetId" => "spots",
          "conditions" => ["treatment"],
          "seeds" => [1],
          "steps" => 60,
          "segmentSteps" => 20,
          "censusEvery" => 10
        })

      refute Map.has_key?(read.(), :gardens)

      {:ok, 5} = Queue.create_garden(params())
      assert %{"g1" => %{name: "g1"}} = read.().gardens
    end

    test "a state.bin from before gardens loads, and a garden can then be founded", %{dir: dir} do
      :ok = stop_supervised(Queue)

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
        segments: %{
          "seg-legacy-0" => %{
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
        },
        islands: %{},
        next_seg: 1
      }

      File.write!(Path.join(dir, "state.bin"), :erlang.term_to_binary(legacy_state))
      start_supervised!({Queue, data_dir: dir})

      island = join("legacy-test")
      assert {:ok, task} = Queue.next_task(island, @caps)
      assert task.segment.id == "seg-legacy-0"
      # An ordinary experiment is never held back by the release gate.
      assert Queue.garden_view("legacy") == nil
      assert {:ok, 5} = Queue.create_garden(params())
      assert view().name == "g1"
    end
  end
end
