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
      # The registry outlives the Queue (it is a persistent term): leave none behind.
      Coordinator.LetterLimiter.set_gardens(%{})
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

    test "founding takes sun true or false and refuses anything else" do
      for not_bool <- ["no", 0, nil, "false"] do
        assert {:error, "sun must be true or false"} =
                 Queue.create_garden(params(%{"sun" => not_bool}))
      end

      assert Queue.garden_view("g1") == nil
      assert Queue.experiment("g1") == nil

      assert {:ok, 5} = Queue.create_garden(params(%{"sun" => false}))
      assert %{enabled: false, percents: [], nextLanding: nil} = view().sun

      assert {:error, {:invalid, "this garden takes no sun letters"}} =
               Queue.post_letter("g1", %{kind: "sun", percent: 50})

      assert live_list() == @founding
      assert view().letters.waiting == []
      # A stone still lands.
      assert {:ok, _} = Queue.post_letter("g1", letter(1))

      assert {:ok, 5} = Queue.create_garden(params(%{"name" => "g2", "sun" => true}))
      assert %{enabled: true, percents: [50, 75, 125]} = Queue.garden_view("g2").sun
      assert {:ok, 5} = Queue.create_garden(params(%{"name" => "g3"}))
      assert %{enabled: true} = Queue.garden_view("g3").sun
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

  # ---- food (docs/garden-food-2026-10-18.md) ----

  describe "food" do
    defp fed(over \\ %{}),
      do: params(Map.merge(%{"food" => true, "foodAsks" => 2, "foodEveryDays" => 1}, over))

    defp hand(i, name \\ "g1") do
      {:ok, key} = Coordinator.LetterLimiter.hand_key({10, 0, 0, i})
      Queue.ask_food(name, key)
    end

    defp record(name \\ "g1"), do: :sys.get_state(Queue).gardens[name]

    test "founding keys and their ranges; the defaults come from config" do
      bad = fn over -> Queue.create_garden(params(over)) end

      assert {:error, "foodAsks must be an integer in 2..1000" <> _} =
               bad.(%{"food" => true, "foodAsks" => 1})

      assert {:error, "foodAsks must be" <> _} = bad.(%{"food" => true, "foodAsks" => 1001})
      assert {:error, "foodAsks must be" <> _} = bad.(%{"food" => true, "foodAsks" => 2.0})

      assert {:error, "foodEveryDays must be" <> _} =
               bad.(%{"food" => true, "foodEveryDays" => 0})

      assert {:error, "foodEveryDays must be" <> _} =
               bad.(%{"food" => true, "foodEveryDays" => 366})

      assert {:error, "foodAsks and foodEveryDays are for" <> _} = bad.(%{"foodAsks" => 5})

      assert {:error, "foodAsks and foodEveryDays are for" <> _} =
               bad.(%{"food" => false, "foodEveryDays" => 5})

      assert {:error, "food must be true or false"} = bad.(%{"food" => "yes"})
      assert Queue.garden_view("g1") == nil

      saved =
        for k <- [:garden_food_asks, :garden_food_every_days],
            do: {k, Application.get_env(:coordinator, k)}

      Application.put_env(:coordinator, :garden_food_asks, 4)
      Application.put_env(:coordinator, :garden_food_every_days, 3)

      try do
        assert {:ok, 5} = Queue.create_garden(params(%{"food" => true}))
        assert record().food == %{asks: 4, every_days: 3, amount: 16, r: 32, x: 128, y: 128}
        assert record().foods == [] and record().next_food == 1
        assert %{enabled: true, asks: 4, everyDays: 3, place: %{x: 128, y: 128}} = view().food
      after
        for {k, v} <- saved, do: Application.put_env(:coordinator, k, v)
      end

      # Without food the record has no food keys at all.
      assert {:ok, 5} = Queue.create_garden(params(%{"name" => "plain"}))
      refute Map.has_key?(record("plain"), :food) or Map.has_key?(record("plain"), :foods)
      assert Queue.garden_view("plain").food.closed == "off"
    end

    test "the founding ranges are ConfigCheck.food_range/1's, at both ends, in garden_spec's words" do
      range_error =
        ~r/^(foodAsks|foodEveryDays|the coordinator's garden_food_(amount|radius)) must/

      # A value in range passes the range checks (a later check, like the matter bound, may still refuse).
      passes? = fn
        {:error, m} when is_binary(m) -> not (m =~ range_error)
        _ -> true
      end

      # The keeper's own foodAsks and foodEveryDays.
      for {key, param, words} <- [
            {:garden_food_asks, "foodAsks", "foodAsks must be an integer in"},
            {:garden_food_every_days, "foodEveryDays", "foodEveryDays must be an integer in"}
          ] do
        r = Coordinator.ConfigCheck.food_range(key)

        for v <- [r.first - 1, r.last + 1] do
          assert {:error, msg} = Queue.create_garden(fed(%{param => v}))
          assert String.starts_with?(msg, "#{words} #{inspect(r)}"), "#{param} #{v}: #{msg}"
        end

        for v <- [r.first, r.last],
            do: assert(passes?.(Queue.create_garden(fed(%{"name" => "e#{v}", param => v}))))
      end

      # The coordinator's own amount and radius.
      keys = [
        :garden_food_asks,
        :garden_food_every_days,
        :garden_food_amount,
        :garden_food_radius
      ]

      saved = for k <- keys, do: {k, Application.get_env(:coordinator, k)}

      try do
        for {key, words} <- [
              {:garden_food_amount, "the coordinator's garden_food_amount must be an integer in"},
              {:garden_food_radius, "the coordinator's garden_food_radius must be an integer in"}
            ] do
          r = Coordinator.ConfigCheck.food_range(key)

          for v <- [r.first - 1, r.last + 1] do
            Application.put_env(:coordinator, key, v)
            assert {:error, "#{words} #{inspect(r)}"} == Queue.create_garden(fed())
          end

          for v <- [r.first, r.last] do
            Application.put_env(:coordinator, key, v)
            assert passes?.(Queue.create_garden(fed(%{"name" => "c#{key}#{v}"})))
          end

          case List.keyfind(saved, key, 0) do
            {_, nil} -> Application.delete_env(:coordinator, key)
            {_, old} -> Application.put_env(:coordinator, key, old)
          end
        end

        # With the four keys unset, garden_spec's built-in defaults sit in range.
        for k <- keys, do: Application.delete_env(:coordinator, k)

        assert passes?.(Queue.create_garden(params(%{"name" => "defaults", "food" => true})))
      after
        for {k, v} <- saved,
            do:
              if(v == nil,
                do: Application.delete_env(:coordinator, k),
                else: Application.put_env(:coordinator, k, v)
              )
      end
    end

    test "the matter bound: a founding that could pass MATTER_MAX is a 422 naming the numbers" do
      # The storm with a big founding feed and a food a day for a year cannot fit.
      greedy = [
        %{"step" => 0, "kind" => "feed", "x" => 256, "y" => 256, "r" => 255, "amount" => 64}
      ]

      assert {:error, why} =
               Queue.create_garden(%{
                 "name" => "greedy",
                 "seed" => 1,
                 "founding" => greedy,
                 "food" => true,
                 "foodEveryDays" => 1
               })

      # 512^2 * 128 + 64 * 511^2 + 365 * 16 * 65^2.
      assert why =~
               "food: the worst case is #{33_554_432 + 64 * 261_121 + 365 * 16 * 4225} quanta"

      assert why =~ "start allowance 33554432"
      assert why =~ "founding feeds #{64 * 261_121}"
      assert why =~ "365 foods of at most 67600"
      assert why =~ "MATTER_MAX 67108864"
      assert Queue.garden_view("greedy") == nil

      # The commons' founding passes, at the default N and at N = 1.
      commons = [
        %{"step" => 0, "kind" => "feed", "x" => 256, "y" => 256, "r" => 255, "amount" => 16}
      ]

      for every <- [7, 1] do
        assert {:ok, 365} =
                 Queue.create_garden(%{
                   "name" => "commons-#{every}",
                   "seed" => 1,
                   "founding" => commons,
                   "food" => true,
                   "foodEveryDays" => every
                 })
      end

      # A garden without food is never held to it.
      assert {:ok, 365} =
               Queue.create_garden(%{"name" => "plain-greedy", "seed" => 1, "founding" => greedy})
    end

    test "K hands call a food: the schedule carries it, and state.bin never holds a hand", %{
      dir: dir
    } do
      {:ok, 5} = Queue.create_garden(fed())
      read = fn -> dir |> Path.join("state.bin") |> File.read!() |> :erlang.binary_to_term() end
      bin = fn -> dir |> Path.join("state.bin") |> File.read!() end

      assert {:ok, :counted, nil, %{hands: 1, open: true}} = hand(1)
      assert view().food.hands == 1
      assert {:ok, :repeat, %{hands: 1}} = hand(1)
      {:ok, key1} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 1})

      # A count alone is not persisted (state.bin is not rewritten for it; the
      # hashes are checked once it is, below).
      refute Map.has_key?(read.(), :food_hands)

      assert {:ok, :counted, %{id: "food-1", day: 0, landsAtStep: @d, status: "waiting"} = food,
              %{hands: 0, open: false, closed: "cooldown", opensAtDay: 1}} = hand(2)

      assert food.x == 128 and food.y == 128 and food.r == 32 and food.amount == 16

      assert live_list() ==
               @founding ++
                 [
                   %{
                     "step" => @d,
                     "kind" => "feed",
                     "x" => 128,
                     "y" => 128,
                     "r" => 32,
                     "amount" => 16
                   }
                 ]

      state = read.()
      refute Map.has_key?(state, :food_hands)
      assert [%{id: "food-1"}] = state.gardens["g1"].foods
      {:ok, key2} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 2})
      for k <- [key1, key2], do: assert(:binary.match(bin.(), elem(k, 1)) == :nomatch)

      assert {:error, {:closed, "cooldown", 1, words}} = hand(3)
      assert words =~ "a food lands at most once every 1 day;"
      assert words =~ "day 1 at the earliest"
      assert [%{day: 0, food: "food-1"}] = view().days
    end

    test "a Queue restart zeroes the count and keeps a called food", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(fed(%{"foodAsks" => 3, "days" => 5}))
      {:ok, :counted, nil, _} = hand(1)
      {:ok, :counted, nil, _} = hand(2)
      {:ok, :counted, %{id: "food-1"}, _} = hand(3)
      a = join("A")
      # Day 0 carries the food: it waits one dawn period (the veto window).
      TestClock.advance(@day)
      t0 = next(a)
      assert t0.segment.index == 0
      # The frontier is now day 1, which a food at day 0 does not crowd at N = 1.
      {:ok, :counted, nil, %{hands: 1}} = hand(4)
      assert view().food.hands == 1

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})

      assert %{hands: 0, open: true, foods: [%{id: "food-1", status: "sealed"}]} = view().food
      assert live_list() |> Enum.count(&(&1["kind"] == "feed")) == 1
      # Ids continue, and network 4's hand counts again (its hand was forgotten).
      {:ok, :counted, nil, %{hands: 1}} = hand(4)
    end

    test "a hand of an unknown garden, or a malformed key, is not found" do
      assert {:error, :not_found} = hand(1, "nope")
      {:ok, 5} = Queue.create_garden(fed())
      assert {:error, :not_found} = Queue.ask_food("g1", :nonsense)

      assert {:error, {:closed, "off", nil, _}} =
               (fn ->
                  {:ok, 5} = Queue.create_garden(params(%{"name" => "plain"}))
                  hand(1, "plain")
                end).()
    end

    test "a key of a limiter incarnation that is gone is stale: nothing is counted" do
      {:ok, 5} = Queue.create_garden(fed(%{"foodAsks" => 3}))
      {:ok, old} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 1})
      Coordinator.LetterLimiter.reset()
      assert {:error, :stale} = Queue.ask_food("g1", old)
      assert view().food.hands == 0
      assert {:ok, :counted, nil, %{hands: 1}} = hand(1)
    end

    test "hashes never show in a status report, and past periods' hands are swept" do
      {:ok, 5} = Queue.create_garden(fed(%{"foodAsks" => 3}))
      {:ok, :counted, nil, _} = hand(1)
      {:ok, {_e, hash} = key} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 1})

      holds? = fn holds?, term ->
        cond do
          term == hash -> true
          is_map(term) and not is_struct(term) -> Enum.any?(term, &holds?.(holds?, &1))
          is_struct(term, MapSet) -> Enum.any?(term, &holds?.(holds?, &1))
          is_list(term) -> Enum.any?(term, &holds?.(holds?, &1))
          is_tuple(term) -> term |> Tuple.to_list() |> Enum.any?(&holds?.(holds?, &1))
          true -> false
        end
      end

      assert holds?.(holds?, :sys.get_state(Queue).food_hands)
      refute holds?.(holds?, :sys.get_status(Queue))

      redacted =
        Queue.format_status(%{
          state: :sys.get_state(Queue),
          message: {:ask_food, "g1", key},
          log: [{:in, {:ask_food, "g1", key}}]
        })

      refute holds?.(holds?, redacted)
      assert redacted.message == {:ask_food, "g1", :redacted}
      assert %{"g1" => %{count: 1}} = redacted.state.food_hands

      # Within the period the sweep keeps them; past the dawn it forgets them.
      send(Queue, :expire_hands)
      assert map_size(:sys.get_state(Queue).food_hands) == 1
      TestClock.advance(@day)
      send(Queue, :expire_hands)
      assert :sys.get_state(Queue).food_hands == %{}
    end

    test "founding refusals: a pond preset, and the coordinator's food amount and radius ranges" do
      saved =
        for k <- [:pond_presets, :garden_food_amount, :garden_food_radius],
            do: {k, Application.get_env(:coordinator, k)}

      put = fn k, v -> Application.put_env(:coordinator, k, v) end

      try do
        put.(:pond_presets, ["spots"])
        assert {:error, "food is not defined for pond worlds" <> _} = Queue.create_garden(fed())
        # Without food a pond garden is not refused for food.
        refute match?(
                 {:error, "food is" <> _},
                 Queue.create_garden(params(%{"name" => "pondless"}))
               )

        put.(:pond_presets, [])

        for amount <- [0, 65, 1.5] do
          put.(:garden_food_amount, amount)

          assert {:error, "the coordinator's garden_food_amount must be an integer in 1..64"} =
                   Queue.create_garden(fed())
        end

        put.(:garden_food_amount, 16)

        for r <- [0, 33] do
          put.(:garden_food_radius, r)

          assert {:error, "the coordinator's garden_food_radius must be an integer in 1..32"} =
                   Queue.create_garden(fed())
        end
      after
        for {k, v} <- saved,
            do:
              if(v == nil,
                do: Application.delete_env(:coordinator, k),
                else: Application.put_env(:coordinator, k, v)
              )
      end

      assert Queue.garden_view("g1") == nil
    end

    test "a food's day is not run until one dawn period after the call; the keeper can drop it meanwhile" do
      {:ok, 5} = Queue.create_garden(fed())
      a = join("A")
      {:ok, :counted, nil, _} = hand(1)
      {:ok, :counted, %{id: "food-1", day: 0, noticeUntil: until, calledAt: called}, _} = hand(2)
      assert until == called + @day

      # Day 0 is released and idle, but it carries the food: no island gets it yet.
      assert %{kind: "idle"} = next(a)
      TestClock.advance(@day - 1)
      assert %{kind: "idle"} = next(a)
      # The veto still works the whole time.
      assert [%{status: "waiting"}] = view().food.foods
      TestClock.advance(1)
      t0 = next(a)
      assert t0.segment.index == 0
      assert %{"kind" => "feed", "step" => @d} = List.last(t0.spec.interventions)

      assert {:error, {:refused, "the food's day has been assigned"}} =
               Queue.drop_letter("g1", "food-1")
    end

    test "a reject reopens a food's day: the food waits again, the ask stays closed, the schedule keeps it",
         %{dir: dir} do
      {:ok, 5} = Queue.create_garden(fed())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      assert t1.segment.index == 1

      # The frontier is day 2: the food is called onto it.
      {:ok, :counted, nil, _} = hand(1)
      {:ok, :counted, %{id: "food-1", day: 2}, _} = hand(2)

      feed = %{
        "step" => 3 * @d,
        "kind" => "feed",
        "x" => 128,
        "y" => 128,
        "r" => 32,
        "amount" => 16
      }

      finish(dir, a, t1)
      TestClock.advance(@day)
      t2 = next(a)
      assert t2.segment.index == 2
      assert List.last(t2.spec.interventions) == feed
      assert [%{status: "sealed"}] = view().food.foods

      # Day 2's island rejects day 1: day 2 is reopened, and so is its food.
      assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "does not match", "own")

      assert %{
               closed: "cooldown",
               opensAtDay: 3,
               foods: [%{id: "food-1", status: "waiting", day: 2}]
             } =
               view().food

      assert List.last(live_list()) == feed
      assert Enum.count(live_list(), &(&1["kind"] == "feed")) == 1
      # A new network cannot call a second food beside it.
      assert {:error, {:closed, "cooldown", 3, _}} = hand(3)
      # And the keeper can veto it again, its day being unassigned.
      assert {:ok, %{status: "dropped"}} = Queue.drop_letter("g1", "food-1")
      refute Enum.any?(live_list(), &(&1["kind"] == "feed"))
    end

    test "the keeper's veto drops a waiting food" do
      {:ok, 5} = Queue.create_garden(fed())
      {:ok, :counted, nil, _} = hand(1)
      {:ok, :counted, %{id: "food-1"}, _} = hand(2)

      assert {:ok, %{id: "food-1", status: "dropped", droppedAt: at}} =
               Queue.drop_letter("g1", "food-1")

      assert is_integer(at)
      assert live_list() == @founding
      assert %{open: true, closed: nil} = view().food
    end
  end

  describe "meteor" do
    defp metp(over \\ %{}),
      do: params(Map.merge(%{"meteor" => true, "meteorAsks" => 2, "meteorEveryDays" => 1}, over))

    defp mhand(i, name \\ "g1") do
      {:ok, key} = Coordinator.LetterLimiter.hand_key({10, 0, 0, i})
      Queue.ask_meteor(name, key)
    end

    # The rule's place, from the note's words (docs/garden-meteor-2026-10-18.md, section 2).
    defp mplace(name, n) do
      <<x::unsigned-big-32, y::unsigned-big-32, _::binary>> =
        :crypto.hash(:sha256, "#{name}/seed-1/meteor-#{n}")

      {rem(x, 256), rem(y, 256)}
    end

    defp with_env(pairs, fun) do
      saved = for {k, _} <- pairs, do: {k, Application.get_env(:coordinator, k)}
      for {k, v} <- pairs, do: Application.put_env(:coordinator, k, v)

      try do
        fun.()
      after
        for {k, v} <- saved,
            do:
              if(v == nil,
                do: Application.delete_env(:coordinator, k),
                else: Application.put_env(:coordinator, k, v)
              )
      end
    end

    test "meteor founding keys and ranges are 422s" do
      bad = fn over -> Queue.create_garden(params(over)) end

      assert {:error, "meteor must be true or false"} = bad.(%{"meteor" => "yes"})

      assert {:error, "meteorAsks must be an integer in 2..1000" <> _} =
               bad.(%{"meteor" => true, "meteorAsks" => 1})

      assert {:error, "meteorAsks must be" <> _} =
               bad.(%{"meteor" => true, "meteorAsks" => 1001})

      assert {:error, "meteorEveryDays must be an integer in 1..365"} =
               bad.(%{"meteor" => true, "meteorEveryDays" => 0})

      assert {:error, "meteorEveryDays must be" <> _} =
               bad.(%{"meteor" => true, "meteorEveryDays" => 366})

      assert {:error, "meteorAsks and meteorEveryDays are for" <> _} =
               bad.(%{"meteorAsks" => 5})

      assert {:error, "meteorAsks and meteorEveryDays are for" <> _} =
               bad.(%{"meteor" => false, "meteorEveryDays" => 5})

      # Food's keys say nothing about the meteor, nor the meteor's about food.
      assert {:error, "foodAsks and foodEveryDays are for" <> _} =
               bad.(%{"meteor" => true, "foodAsks" => 5})

      assert Queue.garden_view("g1") == nil

      # The ranges are ConfigCheck.range/1's, at both ends.
      for {key, param} <- [
            {:garden_meteor_asks, "meteorAsks"},
            {:garden_meteor_every_days, "meteorEveryDays"}
          ] do
        r = Coordinator.ConfigCheck.range(key)

        for v <- [r.first - 1, r.last + 1] do
          assert {:error, msg} = Queue.create_garden(metp(%{param => v}))
          assert String.starts_with?(msg, "#{param} must be an integer in #{inspect(r)}"), msg
        end

        for v <- [r.first, r.last],
            do:
              assert({:ok, 5} = Queue.create_garden(metp(%{"name" => "m#{key}#{v}", param => v})))
      end

      # The coordinator's own radius, 33..255.
      for r <- [32, 256, 1.5] do
        with_env([garden_meteor_radius: r], fn ->
          assert {:error, "the coordinator's garden_meteor_radius must be an integer in 33..255"} =
                   Queue.create_garden(metp())
        end)
      end

      # The defaults come from config and are copied into the record.
      with_env([garden_meteor_asks: 4, garden_meteor_every_days: 3], fn ->
        assert {:ok, 5} = Queue.create_garden(params(%{"meteor" => true}))
        assert record().meteor == %{asks: 4, every_days: 3, r: 64}
        assert record().meteors == [] and record().next_meteor == 1

        {x, y} = mplace("g1", 1)

        assert %{enabled: true, asks: 4, everyDays: 3, r: 64, place: %{x: ^x, y: ^y}} =
                 view().meteor
      end)

      # Without meteor the record has no meteor keys at all, food or not.
      assert {:ok, 5} = Queue.create_garden(params(%{"name" => "plain", "food" => true}))
      refute Map.has_key?(record("plain"), :meteor) or Map.has_key?(record("plain"), :meteors)
      assert Queue.garden_view("plain").meteor.closed == "off"
    end

    test "a meteor radius past the world is a 422 naming the numbers (spots, radius 128); the commons passes at 64" do
      with_env([garden_meteor_radius: 128], fn ->
        assert {:error, why} = Queue.create_garden(metp())
        assert why =~ "garden_meteor_radius 128"
        assert why =~ "256 x 256"
        assert why =~ ~r/127$/
        assert Queue.garden_view("g1") == nil
        # Without meteor the radius is never looked at.
        assert {:ok, 5} = Queue.create_garden(params(%{"name" => "plain"}))
      end)

      with_env([garden_meteor_radius: 127], fn ->
        assert {:ok, 5} = Queue.create_garden(metp(%{"name" => "edge"}))
        assert record("edge").meteor.r == 127
      end)

      # The commons' founding (the big storm, 512 x 512) at the default radius.
      commons = [
        %{"step" => 0, "kind" => "feed", "x" => 256, "y" => 256, "r" => 255, "amount" => 16}
      ]

      assert {:ok, 365} =
               Queue.create_garden(%{
                 "name" => "commons",
                 "seed" => 1,
                 "founding" => commons,
                 "food" => true,
                 "meteor" => true
               })

      assert record("commons").meteor == %{asks: 5, every_days: 7, r: 64}

      # A pond world is many tiles: no meteor there.
      with_env([pond_presets: ["spots"]], fn ->
        assert {:error, "meteor is not defined for pond worlds" <> _} =
                 Queue.create_garden(metp(%{"name" => "pond"}))
      end)
    end

    test "state.bin never holds meteor hands", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(metp())
      read = fn -> dir |> Path.join("state.bin") |> File.read!() |> :erlang.binary_to_term() end
      bin = fn -> dir |> Path.join("state.bin") |> File.read!() end

      assert {:ok, :counted, nil, %{hands: 1, open: true}} = mhand(1)
      assert view().meteor.hands == 1 and view().food.hands == 0
      assert {:ok, :repeat, %{hands: 1}} = mhand(1)
      refute Map.has_key?(read.(), :meteor_hands)

      {x, y} = mplace("g1", 1)

      assert {:ok, :counted,
              %{id: "meteor-1", day: 0, landsAtStep: @d, status: "waiting", r: 64} = m,
              %{hands: 0, open: false, closed: "cooldown", opensAtDay: 1}} = mhand(2)

      assert {m.x, m.y} == {x, y}

      assert live_list() ==
               @founding ++ [%{"step" => @d, "kind" => "lesion", "x" => x, "y" => y, "r" => 64}]

      state = read.()
      refute Map.has_key?(state, :meteor_hands) or Map.has_key?(state, :food_hands)
      assert [%{id: "meteor-1"}] = state.gardens["g1"].meteors

      for i <- [1, 2] do
        {:ok, {_e, hash}} = Coordinator.LetterLimiter.hand_key({10, 0, 0, i})
        assert :binary.match(bin.(), hash) == :nomatch
      end

      assert {:error, {:closed, "cooldown", 1, words}} = mhand(3)
      assert words =~ "a meteor lands at most once every 1 day;"
      assert words =~ "day 1 at the earliest"
      assert [%{day: 0, meteor: "meteor-1", food: nil}] = view().days

      # Unknown garden, a malformed key, a garden without meteor.
      assert {:error, :not_found} = mhand(1, "nope")
      assert {:error, :not_found} = Queue.ask_meteor("g1", :nonsense)
      {:ok, 5} = Queue.create_garden(params(%{"name" => "plain"}))
      assert {:error, {:closed, "off", nil, "this garden takes no meteor"}} = mhand(1, "plain")
    end

    test "a stale limiter key is not counted for a meteor" do
      {:ok, 5} = Queue.create_garden(metp(%{"meteorAsks" => 3}))
      {:ok, old} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 1})
      Coordinator.LetterLimiter.reset()
      assert {:error, :stale} = Queue.ask_meteor("g1", old)
      assert view().meteor.hands == 0
      assert {:ok, :counted, nil, %{hands: 1}} = mhand(1)
    end

    test "a restart zeroes the meteor count and keeps a called meteor", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(metp(%{"meteorAsks" => 3}))
      {:ok, :counted, nil, _} = mhand(1)
      {:ok, :counted, nil, _} = mhand(2)
      {:ok, :counted, %{id: "meteor-1"}, _} = mhand(3)
      a = join("A")
      TestClock.advance(@day)
      t0 = next(a)
      assert t0.segment.index == 0
      {:ok, :counted, nil, %{hands: 1}} = mhand(4)
      assert view().meteor.hands == 1

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})

      assert %{hands: 0, open: true, meteors: [%{id: "meteor-1", status: "sealed"}]} =
               view().meteor

      assert live_list() |> Enum.count(&(&1["r"] == 64)) == 1
      assert :sys.get_state(Queue).meteor_hands == %{}
      {:ok, :counted, nil, %{hands: 1}} = mhand(4)
    end

    test "a restart before a called meteor's day is assigned keeps it waiting, then lands it once",
         %{dir: dir} do
      {:ok, 5} = Queue.create_garden(metp())
      {:ok, :counted, nil, _} = mhand(1)

      {:ok, :counted, %{id: "meteor-1", day: 0, noticeUntil: until, calledAt: called}, _} =
        mhand(2)

      before = record()
      before_list = live_list()
      {x, y} = mplace("g1", 1)
      lesion = %{"step" => @d, "kind" => "lesion", "x" => x, "y" => y, "r" => 64}
      assert List.last(before_list) == lesion

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})

      # The record, the schedule and the counter survive; the hands do not.
      assert record().meteors == before.meteors
      assert record().next_meteor == 2
      assert live_list() == before_list
      assert :sys.get_state(Queue).meteor_hands == %{}

      assert [%{id: "meteor-1", status: "waiting", noticeUntil: ^until, calledAt: ^called}] =
               view().meteor.meteors

      # Forgotten hands cannot call a second meteor inside the spacing.
      assert {:error, {:closed, "cooldown", 1, _}} = mhand(1)
      assert {:error, {:closed, "cooldown", 1, _}} = mhand(3)

      a = join("A")
      TestClock.advance(@day - 1)
      assert %{kind: "idle"} = next(a)
      TestClock.advance(1)
      t0 = next(a)
      assert t0.segment.index == 0
      assert List.last(t0.spec.interventions) == lesion
      assert Enum.count(t0.spec.interventions, &(&1 == lesion)) == 1
    end

    test "a meteor called before a restart can still be set aside after it", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(metp())
      {:ok, :counted, nil, _} = mhand(1)
      {:ok, :counted, %{id: "meteor-1"}, _} = mhand(2)

      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: dir})

      assert {:ok, %{id: "meteor-1", status: "dropped"}} = Queue.drop_letter("g1", "meteor-1")
      assert live_list() == @founding
      assert record().next_meteor == 2
    end

    test "a meteor's day is idle until noticeUntil, then assigned with the lesion in interventions" do
      {:ok, 5} = Queue.create_garden(metp())
      a = join("A")
      {:ok, :counted, nil, _} = mhand(1)

      {:ok, :counted, %{id: "meteor-1", day: 0, noticeUntil: until, calledAt: called}, _} =
        mhand(2)

      assert until == called + @day
      assert %{kind: "idle"} = next(a)
      TestClock.advance(@day - 1)
      assert %{kind: "idle"} = next(a)
      assert [%{status: "waiting"}] = view().meteor.meteors
      TestClock.advance(1)
      t0 = next(a)
      assert t0.segment.index == 0
      {x, y} = mplace("g1", 1)

      assert List.last(t0.spec.interventions) ==
               %{"step" => @d, "kind" => "lesion", "x" => x, "y" => y, "r" => 64}

      assert {:error, {:refused, "the meteor's day has been assigned"}} =
               Queue.drop_letter("g1", "meteor-1")
    end

    test "a called meteor keeps the radius copied at founding, whatever config says later" do
      with_env([garden_meteor_radius: 100], fn ->
        assert {:ok, 5} = Queue.create_garden(metp())
      end)

      assert record().meteor.r == 100

      with_env([garden_meteor_radius: 80], fn ->
        a = join("A")
        {:ok, :counted, nil, _} = mhand(1)
        {:ok, :counted, %{id: "meteor-1", r: 100}, %{r: 100}} = mhand(2)
        assert %{r: 100, meteors: [%{r: 100}]} = view().meteor
        TestClock.advance(@day)
        t0 = next(a)
        assert %{"kind" => "lesion", "r" => 100} = List.last(t0.spec.interventions)
      end)
    end

    test "a reject that reopens a meteor's day: waiting, scheduled, droppable", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(metp())
      a = join("A")
      b = join("B")

      t0 = next(a)
      finish(dir, a, t0)
      {:ok, "verified"} = verify(next(b), b)
      TestClock.advance(@day)
      t1 = next(a)
      assert t1.segment.index == 1

      {:ok, :counted, nil, _} = mhand(1)
      {:ok, :counted, %{id: "meteor-1", day: 2}, _} = mhand(2)
      {x, y} = mplace("g1", 1)
      lesion = %{"step" => 3 * @d, "kind" => "lesion", "x" => x, "y" => y, "r" => 64}

      finish(dir, a, t1)
      TestClock.advance(@day)
      t2 = next(a)
      assert t2.segment.index == 2
      assert List.last(t2.spec.interventions) == lesion
      assert [%{status: "sealed"}] = view().meteor.meteors

      assert :ok = Queue.reject(t2.segment.id, a, t2.lease, "does not match", "own")

      assert %{
               closed: "cooldown",
               opensAtDay: 3,
               meteors: [%{id: "meteor-1", status: "waiting", day: 2}]
             } = view().meteor

      assert List.last(live_list()) == lesion
      assert {:error, {:closed, "cooldown", 3, _}} = mhand(3)
      assert {:ok, %{id: "meteor-1", status: "dropped"}} = Queue.drop_letter("g1", "meteor-1")
      refute Enum.any?(live_list(), &(&1["r"] == 64))
      # The next meteor is meteor-2, at its own place.
      {x2, y2} = mplace("g1", 2)
      assert %{open: true, place: %{x: ^x2, y: ^y2}} = view().meteor
    end

    test "format_status redacts meteor hands and {:ask_meteor, …}" do
      {:ok, 5} = Queue.create_garden(metp(%{"meteorAsks" => 3}))
      {:ok, :counted, nil, _} = mhand(1)
      {:ok, {_e, hash} = key} = Coordinator.LetterLimiter.hand_key({10, 0, 0, 1})

      holds? = fn holds?, term ->
        cond do
          term == hash -> true
          is_map(term) and not is_struct(term) -> Enum.any?(term, &holds?.(holds?, &1))
          is_struct(term, MapSet) -> Enum.any?(term, &holds?.(holds?, &1))
          is_list(term) -> Enum.any?(term, &holds?.(holds?, &1))
          is_tuple(term) -> term |> Tuple.to_list() |> Enum.any?(&holds?.(holds?, &1))
          true -> false
        end
      end

      assert holds?.(holds?, :sys.get_state(Queue).meteor_hands)
      refute holds?.(holds?, :sys.get_status(Queue))

      redacted =
        Queue.format_status(%{
          state: :sys.get_state(Queue),
          message: {:ask_meteor, "g1", key},
          log: [{:in, {:ask_meteor, "g1", key}}]
        })

      refute holds?.(holds?, redacted)
      assert redacted.message == {:ask_meteor, "g1", :redacted}
      assert %{"g1" => %{count: 1}} = redacted.state.meteor_hands
    end

    test "the sweep forgets a past period's meteor hands" do
      {:ok, 5} = Queue.create_garden(metp(%{"meteorAsks" => 3}))
      {:ok, :counted, nil, _} = mhand(1)
      send(Queue, :expire_hands)
      assert map_size(:sys.get_state(Queue).meteor_hands) == 1
      TestClock.advance(@day)
      send(Queue, :expire_hands)
      assert :sys.get_state(Queue).meteor_hands == %{}
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

    test "a state.bin whose garden has no sun key loads and takes a sun", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params())
      :ok = stop_supervised(Queue)

      path = Path.join(dir, "state.bin")
      state = path |> File.read!() |> :erlang.binary_to_term()
      assert %{"g1" => %{sun: true}} = state.gardens
      legacy = update_in(state, [:gardens, "g1"], &Map.delete(&1, :sun))
      refute Map.has_key?(legacy.gardens["g1"], :sun)
      File.write!(path, :erlang.term_to_binary(legacy))

      start_supervised!({Queue, data_dir: dir})
      assert %{enabled: true, percents: [50, 75, 125]} = view().sun
      assert {:ok, %{kind: "sun"}} = Queue.post_letter("g1", %{kind: "sun", percent: 50})
      assert [%{"kind" => "sun", "percent" => 50}] = live_list() -- @founding
    end

    test "a garden founded with sun false stays without suns across a restart", %{dir: dir} do
      {:ok, 5} = Queue.create_garden(params(%{"sun" => false}))
      :ok = stop_supervised(Queue)

      assert %{"g1" => %{sun: false}} =
               Path.join(dir, "state.bin")
               |> File.read!()
               |> :erlang.binary_to_term()
               |> Map.fetch!(:gardens)

      start_supervised!({Queue, data_dir: dir})
      assert %{enabled: false, percents: [], nextLanding: nil} = view().sun

      assert {:error, {:invalid, "this garden takes no sun letters"}} =
               Queue.post_letter("g1", %{kind: "sun", percent: 50})

      assert live_list() == @founding
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
