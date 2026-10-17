defmodule Coordinator.GardenTest do
  # Pure functions only: segments are built with the real `Coordinator.Segment`
  # transitions, so a garden is exercised against exactly the statuses the Queue
  # would produce, with no Queue and no clock.
  use ExUnit.Case, async: true
  alias Coordinator.{Garden, Segment}

  @d 100
  @period 86_400_000
  # Dawn 100 is at 100 * @period; the garden is created an hour into that period.
  @t0 100 * @period + 3_600_000
  @env %{lease_ms: 600_000, stale_ms: 120_000, letters_per_address: 3}
  @fixture Path.expand("../../priv/static/garden-contract.example.json", __DIR__)

  # ---- builders ----

  defp garden(opts \\ []) do
    %{
      name: "commons",
      preset_id: "spots",
      seed: 1,
      steps_per_day: @d,
      days_total: 6,
      letters_per_day: 2,
      queue_max: 5,
      dawn_period_ms: @period,
      dawn_offset_ms: 0,
      founding: [%{"step" => 0, "kind" => "feed", "x" => 10, "y" => 10, "r" => 5, "amount" => 16}],
      width: 256,
      height: 256
    }
    |> Map.merge(Map.new(opts))
    |> Garden.new(@t0)
  end

  defp fresh(g) do
    for i <- 0..(g.days_total - 1), into: %{} do
      {i,
       Segment.new(
         "seg-#{i}",
         Garden.run_id(g),
         g.name,
         "treatment",
         g.seed,
         i,
         i == g.days_total - 1,
         i * g.steps_per_day,
         g.steps_per_day
       )}
    end
  end

  defp digest(i),
    do: Integer.to_string(0xA0000000 + i, 16) |> String.downcase() |> String.pad_leading(16, "0")

  defp summary(i) do
    %{
      "finalIndividuals" => 100 + i,
      "finalLineages" => 50 + i,
      "maxGeneration" => 10 + i,
      "mutations" => 1000 + i,
      "extinct" => false,
      "conservationOk" => true,
      "steps" => 100
    }
  end

  defp lease(prefix), do: "#{prefix}-#{System.unique_integer([:positive])}"

  defp assigned(segs, i, island, now) do
    {:ok, s} = Segment.assign_run(segs[i], island, lease("run"), now)
    Map.put(segs, i, s)
  end

  defp done(segs, i, island, now, summary \\ nil) do
    segs = if segs[i].status == "pending", do: assigned(segs, i, island, now), else: segs
    %{id: id} = Enum.find(segs[i].attempts, &(&1.kind == "run" and &1.outcome == "pending"))
    {:ok, s} = Segment.publish(segs[i], island, id, digest(i), "state-#{i}")
    {:ok, s} = Segment.complete_run(s, island, id, digest(i), summary || summary(i))
    Map.put(segs, i, s)
  end

  defp verified(segs, i, island, now, reported \\ nil) do
    id = lease("ver")
    {:ok, s} = Segment.assign_verify(segs[i], island, id, now)
    {:ok, s} = Segment.complete_verify(s, island, id, reported || digest(i))
    Map.put(segs, i, s)
  end

  defp put_seg(segs, i, fun), do: Map.update!(segs, i, fun)

  # Garden bookkeeping a Queue would have done: day `i` released at `at`.
  defp release(g, i, at),
    do: %{g | days: Map.put(g.days, i, %{released_at: at, done_at: nil, verified_at: nil})}

  defp letter(day, seq, opts \\ []) do
    %{
      id: "ltr-#{seq}",
      seq: seq,
      kind: "stone",
      x: 20 + seq,
      y: 30 + seq,
      r: 4,
      step: (day + 1) * @d,
      day: day,
      posted_at: @t0 + seq,
      dropped_at: opts[:dropped_at]
    }
  end

  defp with_letters(g, letters), do: %{g | letters: letters, next_letter: length(letters) + 1}

  defp islands,
    do: %{
      "a" => %{adapter: "ADAPTER-SECRET-A"},
      "b" => %{adapter: "ADAPTER-SECRET-B"},
      "c" => %{adapter: "ADAPTER-SECRET-A"}
    }

  defp post!(g, segs, x, y, r, now \\ @t0) do
    {:ok, g, letter} = Garden.post_letter(g, %{x: x, y: y, r: r}, segs, now)
    {g, letter}
  end

  defp json(view), do: view |> Jason.encode!() |> Jason.decode!()

  # The entries of `schedule` that day `i` owns: step in (start, start + D], plus step 0 for day 0.
  defp owned(schedule, i) do
    start = i * @d

    Enum.filter(schedule, fn e ->
      (e["step"] > start and e["step"] <= start + @d) or (i == 0 and e["step"] == 0)
    end)
  end

  # A garden in roughly the fixture's state: day 0 verified by a different device type, day 1 verified
  # by the same device type, day 2 done and unverified with its next release due, letters waiting,
  # landed, verified and dropped (the fixture's state).
  defp scenario do
    g = garden(days_total: 8, letters_per_day: 3, queue_max: 10)
    segs = fresh(g)

    segs = segs |> done(0, "a", @t0 + 500) |> verified(0, "b", @t0 + 900)
    g = g |> Garden.record_done(0, @t0 + 1_000) |> Garden.record_verified(0, @t0 + 2_000)

    r1 = Garden.dawn_at(g, 101) + 5_000
    g = release(g, 1, r1)
    segs = segs |> done(1, "a", r1 + 100) |> verified(1, "c", r1 + 400)
    g = g |> Garden.record_done(1, r1 + 500) |> Garden.record_verified(1, r1 + 800)

    r2 = Garden.dawn_at(g, 102) + 5_000
    g = release(g, 2, r2)
    segs = done(segs, 2, "a", r2 + 100)
    g = Garden.record_done(g, 2, r2 + 500)

    g =
      with_letters(g, [
        letter(1, 1),
        letter(2, 2),
        letter(3, 3, dropped_at: r2 + 10),
        letter(3, 4),
        letter(3, 5),
        letter(4, 6)
      ])

    # Dawn 103 has passed and nobody has asked: the next day is due.
    {g, segs, Garden.dawn_at(g, 103) + 10_000_000}
  end

  # ---- the dawn grid ----

  describe "dawn grid" do
    test "dawn_index is floor division on the grid, dawn_at its inverse" do
      g = garden()
      assert Garden.dawn_index(g, 100 * @period) == 100
      assert Garden.dawn_index(g, 100 * @period - 1) == 99
      assert Garden.dawn_index(g, 101 * @period - 1) == 100
      assert Garden.dawn_at(g, 100) == 100 * @period
      assert Garden.dawn_at(g, Garden.dawn_index(g, @t0) + 1) == 101 * @period
    end

    test "a negative time (or one before the offset) floors rather than truncates" do
      g = garden(dawn_offset_ms: 5_000)
      assert Garden.dawn_index(g, 4_999) == -1
      assert Garden.dawn_index(g, 5_000) == 0
      assert Garden.dawn_index(g, -@period + 5_000) == -1
      assert Garden.dawn_index(g, -@period + 4_999) == -2
      assert Garden.dawn_at(g, -1) == 5_000 - @period
    end

    test "the offset shifts the whole grid" do
      g = garden(dawn_offset_ms: 3_600_000 * 7)
      assert Garden.dawn_at(g, 0) == 7 * 3_600_000
      assert Garden.dawn_index(g, 7 * 3_600_000 - 1) == -1
      assert Garden.dawn_index(g, 7 * 3_600_000 + @period) == 1
    end
  end

  describe "new/2" do
    test "day 0 is released at creation and the schedule is the founding alone" do
      g = garden()
      assert Garden.released?(g, 0)
      refute Garden.released?(g, 1)
      assert Garden.released_at(g, 0) == @t0
      assert Garden.released_at(g, 1) == nil
      assert Garden.newest_released(g) == 0
      assert Garden.run_id(g) == "commons/spots/treatment/seed-1"
      assert Garden.schedule(g) == g.founding
      assert g.letters == [] and g.next_letter == 1 and g.created_at == @t0
    end
  end

  # ---- release ----

  describe "release rule" do
    test "needs the newest day done or verified" do
      g = garden()
      later = Garden.dawn_at(g, 105)
      assert :none = Garden.maybe_release(g, "pending", later)
      assert :none = Garden.maybe_release(g, "assigned", later)
      assert :none = Garden.maybe_release(g, "diverged", later)
      assert :none = Garden.maybe_release(g, "blocked", later)
      assert :none = Garden.maybe_release(g, nil, later)
      assert {:released, _} = Garden.maybe_release(g, "done", later)
      assert {:released, _} = Garden.maybe_release(g, "verified", later)
    end

    test "needs a dawn since the day was actually released, not just a period's worth of time" do
      g = garden()
      # Released an hour into dawn period 100: still period 100 until dawn 101.
      assert :none = Garden.maybe_release(g, "done", Garden.dawn_at(g, 101) - 1)
      assert {:released, g1} = Garden.maybe_release(g, "done", Garden.dawn_at(g, 101))
      assert Garden.released_at(g1, 1) == Garden.dawn_at(g, 101)
      assert Garden.newest_released(g1) == 1
    end

    test "missed dawns do not bank: ten dawns later is one release, then one more only after the next dawn" do
      g = garden()
      long_after = Garden.dawn_at(g, 110) + 777
      assert {:released, g1} = Garden.maybe_release(g, "done", long_after)
      assert Garden.newest_released(g1) == 1
      assert Garden.released_at(g1, 1) == long_after
      assert :none = Garden.maybe_release(g1, "done", long_after)
      assert :none = Garden.maybe_release(g1, "verified", Garden.dawn_at(g, 111) - 1)
      assert {:released, g2} = Garden.maybe_release(g1, "done", Garden.dawn_at(g, 111))
      assert Garden.newest_released(g2) == 2
    end

    test "never beyond the horizon" do
      g = garden(days_total: 2)
      assert {:released, g1} = Garden.maybe_release(g, "done", Garden.dawn_at(g, 105))
      assert :none = Garden.maybe_release(g1, "verified", Garden.dawn_at(g, 200))
      assert Garden.newest_released(g1) == 1
    end

    test "record_done stamps the day and clears a stale verified_at; record_verified stamps it" do
      g = garden()
      g = g |> Garden.record_done(0, 10) |> Garden.record_verified(0, 20)
      assert g.days[0] == %{released_at: @t0, done_at: 10, verified_at: 20}
      g = Garden.record_done(g, 0, 30)
      assert g.days[0] == %{released_at: @t0, done_at: 30, verified_at: nil}
      # An unreleased day is not invented.
      assert Garden.record_done(g, 3, 40) == g
      assert Garden.record_verified(g, 3, 40) == g
    end
  end

  # ---- letters: validation ----

  describe "parse_letter/1" do
    test "accepts exactly kind/x/y/r with integers and a stone radius" do
      body = %{"kind" => "stone", "x" => 1, "y" => 2, "r" => 3}
      assert {:ok, %{x: 1, y: 2, r: 3}} = Garden.parse_letter(body)
      assert {:ok, %{r: 1}} = Garden.parse_letter(%{body | "r" => 1})
      assert {:ok, %{r: 32}} = Garden.parse_letter(%{body | "r" => 32})
    end

    test "rejects everything else with a message that does not echo the body" do
      ok = %{"kind" => "stone", "x" => 1, "y" => 2, "r" => 3}

      bad = [
        %{},
        Map.delete(ok, "r"),
        Map.put(ok, "extra", 1),
        Map.put(ok, "name", "mallory"),
        %{ok | "kind" => "feed"},
        %{ok | "kind" => 7},
        %{ok | "x" => 1.0},
        %{ok | "x" => "1"},
        %{ok | "y" => true},
        %{ok | "y" => nil},
        %{ok | "r" => 2.5},
        %{ok | "r" => 0},
        %{ok | "r" => 33},
        %{ok | "r" => -1},
        %{"_json" => [1, 2, 3]},
        "stone",
        [1, 2],
        nil,
        42
      ]

      for body <- bad do
        assert {:error, msg} = Garden.parse_letter(body)
        assert is_binary(msg)
        refute msg =~ "mallory"
      end
    end

    test "a bignum coordinate is refused before it can travel anywhere" do
      ok = %{"kind" => "stone", "x" => 1, "y" => 2, "r" => 3}
      huge = String.to_integer(String.duplicate("9", 400))

      assert {:error, "x is out of range"} = Garden.parse_letter(%{ok | "x" => huge})
      assert {:error, "y is out of range"} = Garden.parse_letter(%{ok | "y" => -huge})
      assert {:error, "x is out of range"} = Garden.parse_letter(%{ok | "x" => 2_147_483_648})
      # Anything a world could hold still reaches the garden's own bounds check.
      assert {:ok, _} = Garden.parse_letter(%{ok | "x" => -5, "y" => 2_147_483_647})
    end

    test "atom keys are not a letter (only a decoded JSON body is)" do
      assert {:error, _} = Garden.parse_letter(%{kind: "stone", x: 1, y: 2, r: 3})
    end
  end

  describe "check_bounds/2" do
    test "the centre must be inside the world" do
      g = garden(width: 256, height: 128)
      assert :ok = Garden.check_bounds(g, %{x: 0, y: 0})
      assert :ok = Garden.check_bounds(g, %{x: 255, y: 127})
      assert {:error, "x must be in 0..255"} = Garden.check_bounds(g, %{x: 256, y: 0})
      assert {:error, "x must be in 0..255"} = Garden.check_bounds(g, %{x: -1, y: 0})
      assert {:error, "y must be in 0..127"} = Garden.check_bounds(g, %{x: 0, y: 128})
      assert {:error, _} = Garden.check_bounds(g, %{x: 0, y: -1})
      assert {:error, _} = Garden.check_bounds(g, %{x: 1_000_000_000_000_000_000_000, y: 0})
    end

    test "post_letter reports an out-of-world centre as invalid (422), before any refusal" do
      g = garden()
      segs = fresh(g)

      assert {:error, {:invalid, "x must be in 0..255"}} =
               Garden.post_letter(g, %{x: 256, y: 0, r: 3}, segs, @t0)

      full = %{segs | 0 => put_in(segs[0].status, "diverged")}
      assert {:error, {:invalid, _}} = Garden.post_letter(g, %{x: 256, y: 0, r: 3}, full, @t0)
    end
  end

  # ---- the frontier and placement ----

  describe "frontier_day/2" do
    test "none attempted is 0; one past the highest day with any attempt otherwise" do
      g = garden()
      segs = fresh(g)
      assert Garden.frontier_day(g, segs) == 0
      segs = assigned(segs, 0, "a", @t0)
      assert Garden.frontier_day(g, segs) == 1
      segs = segs |> done(0, "a", @t0) |> verified(0, "b", @t0)
      assert Garden.frontier_day(g, segs) == 1
      segs = assigned(segs, 1, "a", @t0)
      assert Garden.frontier_day(g, segs) == 2
    end

    test "a verify attempt, an abandoned or a rejected run attempt all count" do
      g = garden()
      segs = fresh(g) |> done(0, "a", @t0)
      assert Garden.frontier_day(g, segs) == 1

      # The lease expires: the segment is pending again but the island was assigned it.
      segs = put_seg(segs, 0, fn _ -> Segment.new("seg-0", "r", "e", "c", 1, 0, false, 0, @d) end)
      {:ok, s} = Segment.assign_run(segs[0], "a", "x", @t0)
      segs = Map.put(segs, 0, Segment.reclaim(s, @t0 + 10_000_000, 600_000))
      assert segs[0].status == "pending" and segs[0].attempts != []
      assert Garden.frontier_day(g, segs) == 1

      requeued = fresh(g) |> done(0, "a", @t0) |> put_seg(0, &Segment.requeue/1)
      assert requeued[0].status == "pending"
      assert Garden.frontier_day(g, requeued) == 1
    end

    test "a reset (an upstream reject) retreats it, and the retreat is recomputed, never stored" do
      g = garden()
      segs = fresh(g) |> done(0, "a", @t0) |> assigned(1, "a", @t0)
      assert Garden.frontier_day(g, segs) == 2
      assert Garden.frontier_day(g, put_seg(segs, 1, &Segment.reset/1)) == 1
      assert Garden.frontier_day(g, put_seg(segs, 1, &Segment.block/1)) == 1
    end
  end

  describe "post_letter/4" do
    test "lands on the frontier day's end step, ids and seq counting up" do
      g = garden()
      segs = fresh(g)
      {g, l1} = post!(g, segs, 5, 6, 7, 1234)

      assert l1 == %{
               id: "ltr-1",
               seq: 1,
               kind: "stone",
               x: 5,
               y: 6,
               r: 7,
               step: @d,
               day: 0,
               posted_at: 1234,
               dropped_at: nil
             }

      assert g.next_letter == 2

      segs = assigned(segs, 0, "a", @t0)
      {_g, l2} = post!(g, segs, 5, 6, 7)
      assert %{id: "ltr-2", seq: 2, day: 1, step: 200} = l2
    end

    test "a day's budget overflows to the next day" do
      g = garden(letters_per_day: 2, queue_max: 10)
      segs = fresh(g)
      {g, a} = post!(g, segs, 1, 1, 1)
      {g, b} = post!(g, segs, 2, 2, 2)
      {g, c} = post!(g, segs, 3, 3, 3)
      {g, d} = post!(g, segs, 4, 4, 4)
      {_g, e} = post!(g, segs, 5, 5, 5)
      assert Enum.map([a, b, c, d, e], & &1.day) == [0, 0, 1, 1, 2]
      assert Enum.map([a, b, c, d, e], & &1.step) == [100, 100, 200, 200, 300]
    end

    test "queue_max waiting letters refuse the next; a drop frees the slot" do
      g = garden(letters_per_day: 2, queue_max: 3)
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, _} = post!(g, segs, 2, 2, 2)
      {g, _} = post!(g, segs, 3, 3, 3)

      assert {:error, {:refused, "the letter queue is full"}} =
               Garden.post_letter(g, %{x: 4, y: 4, r: 4}, segs, @t0)

      assert Garden.next_landing(g, segs) == nil
      {:ok, g, _} = Garden.drop_letter(g, "ltr-2", segs, @t0)
      assert {:ok, _, %{day: 0}} = Garden.post_letter(g, %{x: 4, y: 4, r: 4}, segs, @t0)
    end

    test "the log is full at logMax (founding plus live letters)" do
      founding =
        for i <- 1..9_999,
            do: %{"step" => 0, "kind" => "lesion", "x" => rem(i, 256), "y" => 1, "r" => 1}

      g = garden(founding: founding, letters_per_day: 64, queue_max: 1000)
      segs = fresh(g)
      assert %{day: 0} = Garden.next_landing(g, segs)
      {g, _} = post!(g, segs, 1, 1, 1)

      assert {:error, {:refused, "the garden's log is full"}} =
               Garden.post_letter(g, %{x: 2, y: 2, r: 2}, segs, @t0)

      assert Garden.next_landing(g, segs) == nil
      # A drop frees a place in the log.
      {:ok, g, _} = Garden.drop_letter(g, "ltr-1", segs, @t0)
      assert {:ok, _, _} = Garden.post_letter(g, %{x: 2, y: 2, r: 2}, segs, @t0)
    end

    test "no day left before the horizon" do
      g = garden(days_total: 2, letters_per_day: 1, queue_max: 10)
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, last} = post!(g, segs, 2, 2, 2)
      assert last.day == 1

      assert {:error, {:refused, "no day is left before the horizon"}} =
               Garden.post_letter(g, %{x: 3, y: 3, r: 3}, segs, @t0)

      # With day 0 attempted, the frontier leaves one open day only.
      g = garden(days_total: 2, letters_per_day: 1, queue_max: 10)
      segs = assigned(fresh(g), 0, "a", @t0)
      {g, one} = post!(g, segs, 1, 1, 1)
      assert one.day == 1
      assert {:error, {:refused, _}} = Garden.post_letter(g, %{x: 3, y: 3, r: 3}, segs, @t0)
    end

    test "a stopped or finished garden takes no letters" do
      g = garden(days_total: 2)

      for status <- ["diverged", "failed", "blocked"] do
        segs = fresh(g) |> put_seg(1, &%{&1 | status: status})

        assert {:error, {:refused, "the garden has stopped" <> _}} =
                 Garden.post_letter(g, %{x: 1, y: 1, r: 1}, segs, @t0)

        assert Garden.next_landing(g, segs) == nil
        assert Garden.stopped?(segs)
      end

      segs = fresh(g) |> done(0, "a", @t0) |> done(1, "a", @t0)
      assert Garden.finished?(g, segs)

      assert {:error, {:refused, "the garden has finished"}} =
               Garden.post_letter(g, %{x: 1, y: 1, r: 1}, segs, @t0)

      refute Garden.finished?(g, fresh(g) |> done(0, "a", @t0))
      refute Garden.stopped?(fresh(g))
    end

    test "next_landing reports the day, its end step and the slots left" do
      g = garden(letters_per_day: 3, queue_max: 10)
      segs = fresh(g)
      assert Garden.next_landing(g, segs) == %{day: 0, step: 100, open: 3}
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, _} = post!(g, segs, 1, 1, 1)
      assert Garden.next_landing(g, segs) == %{day: 0, step: 100, open: 1}
      {g, _} = post!(g, segs, 1, 1, 1)
      assert Garden.next_landing(g, segs) == %{day: 1, step: 200, open: 3}
      assert Garden.next_landing(g, assigned(segs, 0, "a", @t0)) == %{day: 1, step: 200, open: 3}
    end
  end

  describe "drop_letter/4" do
    test "drops a waiting letter, stamps it, and removes it from the schedule" do
      g = garden()
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, _} = post!(g, segs, 2, 2, 2)
      assert length(Garden.schedule(g)) == 3
      assert {:ok, g, dropped} = Garden.drop_letter(g, "ltr-1", segs, 999)
      assert dropped.dropped_at == 999
      assert length(Garden.schedule(g)) == 2
      assert Garden.letter_status(g, dropped, segs) == "dropped"
    end

    test "unknown and assigned-day letters are refused; an already dropped one is a no-op" do
      g = garden()
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      assert {:error, :not_found} = Garden.drop_letter(g, "ltr-99", segs, 1)
      assert {:error, :not_found} = Garden.drop_letter(g, "nonsense", segs, 1)
      {:ok, dropped_g, dropped} = Garden.drop_letter(g, "ltr-1", segs, 1)

      # Idempotent: a keeper's retry gets the letter as it was dropped (the
      # first drop time stays), and the garden is unchanged.
      assert {:ok, ^dropped_g, ^dropped} = Garden.drop_letter(dropped_g, "ltr-1", segs, 2)
      assert dropped.dropped_at == 1

      sealed = assigned(segs, 0, "a", @t0)

      assert {:error, {:refused, "the letter's day has been assigned"}} =
               Garden.drop_letter(g, "ltr-1", sealed, 1)
    end

    test "a letter on a later day is still droppable while an earlier day runs" do
      g = garden(letters_per_day: 1, queue_max: 10)
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, _} = post!(g, segs, 2, 2, 2)
      segs = assigned(segs, 0, "a", @t0)
      assert {:error, {:refused, _}} = Garden.drop_letter(g, "ltr-1", segs, 1)
      assert {:ok, _, _} = Garden.drop_letter(g, "ltr-2", segs, 1)
    end
  end

  describe "schedule/1" do
    test "founding first exactly as given, then live letters by {step, seq} as lesions" do
      founding = [
        %{"step" => 0, "kind" => "feed", "x" => 1, "y" => 2, "r" => 3, "amount" => 4},
        %{"step" => 0, "kind" => "lesion", "x" => 9, "y" => 9, "r" => 9}
      ]

      g = garden(founding: founding, letters_per_day: 2, queue_max: 10)
      segs = fresh(g)
      {g, _} = post!(g, segs, 1, 1, 1)
      {g, _} = post!(g, segs, 2, 2, 2)
      {g, _} = post!(g, segs, 3, 3, 3)
      {:ok, g, _} = Garden.drop_letter(g, "ltr-1", segs, 5)
      # Day 0 has room again: ltr-4 (seq 4, step 100) now sorts before ltr-3 (seq 3, step 200).
      {g, l4} = post!(g, segs, 4, 4, 4)
      assert l4.day == 0

      schedule = Garden.schedule(g)
      assert Enum.take(schedule, 2) == founding

      assert Enum.drop(schedule, 2) == [
               %{"step" => 100, "kind" => "lesion", "x" => 2, "y" => 2, "r" => 2},
               %{"step" => 100, "kind" => "lesion", "x" => 4, "y" => 4, "r" => 4},
               %{"step" => 200, "kind" => "lesion", "x" => 3, "y" => 3, "r" => 3}
             ]

      steps = Enum.map(schedule, & &1["step"])
      assert steps == Enum.sort(steps)
    end
  end

  # ---- THE invariant ----

  describe "the owned-slice invariant" do
    test "a letter posted while day 1 is assigned goes to day 2 and day 1's slice is unchanged" do
      g = garden(days_total: 5, letters_per_day: 2, queue_max: 10)
      segs = fresh(g) |> done(0, "a", @t0) |> assigned(1, "b", @t0)
      {g, _} = post!(g, fresh(g), 1, 1, 1)
      before_1 = owned(Garden.schedule(g), 1)
      before_0 = owned(Garden.schedule(g), 0)

      {g, landed} = post!(g, segs, 7, 7, 7)
      assert landed.day == 2
      assert owned(Garden.schedule(g), 1) == before_1
      assert owned(Garden.schedule(g), 0) == before_0
      assert [%{"step" => 300, "x" => 7}] = owned(Garden.schedule(g), 2)
    end

    test "random posts, drops, runs, replays and rejects never change what an attempted day owns" do
      :rand.seed(:exsss, {11, 22, 33})
      days = 12
      g = garden(days_total: days, letters_per_day: 2, queue_max: 8)
      init = %{g: g, segs: fresh(g), snap: %{}, posted: 0, dropped: 0, advanced: 0, rejected: 0}

      final =
        Enum.reduce(1..600, init, fn n, st ->
          st = step(st, n, days)
          check_invariant!(st, days)
        end)

      # Not vacuous: the walk really posted, dropped, ran, replayed and rejected.
      assert final.posted > 20 and final.dropped > 3 and final.advanced > 10 and
               final.rejected > 2

      assert map_size(final.snap) > 3
    end

    defp step(st, n, days) do
      case :rand.uniform(12) do
        k when k <= 5 ->
          x = :rand.uniform(256) - 1
          y = :rand.uniform(256) - 1
          r = :rand.uniform(32)

          case Garden.post_letter(st.g, %{x: x, y: y, r: r}, st.segs, n) do
            {:ok, g, _} -> %{st | g: g, posted: st.posted + 1}
            {:error, _} -> st
          end

        k when k <= 8 ->
          ids = Enum.map(st.g.letters, & &1.id)
          id = Enum.random(["ltr-9999" | ids])

          case Garden.drop_letter(st.g, id, st.segs, n) do
            {:ok, g, _} -> %{st | g: g, dropped: st.dropped + 1}
            {:error, _} -> st
          end

        k when k <= 11 ->
          advance(st, days)

        _ ->
          reject(st, days)
      end
    end

    # Moves the first unfinished day one stage: assign, complete, then (half the time) verify.
    defp advance(st, days) do
      i = Enum.find(0..(days - 1), fn i -> st.segs[i].status not in ["done", "verified"] end)

      segs =
        cond do
          i == nil -> nil
          st.segs[i].status == "pending" -> assigned(st.segs, i, "a", 1)
          st.segs[i].status == "assigned" -> done(st.segs, i, "a", 1)
          true -> nil
        end

      segs =
        case segs do
          nil ->
            nil

          segs ->
            if segs[i].status == "done" and :rand.uniform(2) == 1,
              do: verified(segs, i, "b", 1),
              else: segs
        end

      if segs, do: %{st | segs: segs, advanced: st.advanced + 1}, else: st
    end

    # An upstream reject: day k is requeued (attempts kept), every later day is reset (attempts cleared).
    defp reject(st, days) do
      done_days = for i <- 0..(days - 1), st.segs[i].status in ["done", "verified"], do: i

      case done_days do
        [] ->
          st

        _ ->
          k = Enum.random(done_days)

          segs =
            Enum.reduce(0..(days - 1), st.segs, fn
              ^k, acc -> put_seg(acc, k, &Segment.requeue/1)
              i, acc when i > k -> put_seg(acc, i, &Segment.reset/1)
              _, acc -> acc
            end)

          %{st | segs: segs, rejected: st.rejected + 1}
      end
    end

    defp check_invariant!(st, days) do
      schedule = Garden.schedule(st.g)
      steps = Enum.map(schedule, & &1["step"])
      assert steps == Enum.sort(steps), "schedule steps must be non-decreasing"

      attempted = for i <- 0..(days - 1), st.segs[i].attempts != [], do: i

      # A day whose attempts a reject cleared may be re-attempted under a new list: forget its snapshot.
      snap = Map.take(st.snap, attempted)

      snap =
        Enum.reduce(attempted, snap, fn i, acc ->
          slice = owned(schedule, i)

          case acc do
            %{^i => before} ->
              assert slice == before,
                     "day #{i} owned #{inspect(before)}, now owns #{inspect(slice)}"

              acc

            _ ->
              Map.put(acc, i, slice)
          end
        end)

      %{st | snap: snap}
    end
  end

  # ---- letter statuses ----

  describe "letter statuses" do
    test "by the carrying day's segment, in the documented order" do
      g = garden(days_total: 9)
      segs = fresh(g)
      segs = segs |> done(0, "a", @t0) |> verified(0, "b", @t0)
      segs = done(segs, 1, "a", @t0)
      segs = assigned(segs, 2, "a", @t0)
      segs = segs |> done(3, "a", @t0) |> verified(3, "b", @t0, "ffffffffffffffff")

      segs =
        put_seg(
          segs,
          4,
          &%{
            &1
            | status: "failed",
              attempts: [%{kind: "run", outcome: "failed", island: "a", id: "f", heartbeat_at: 0}]
          }
        )

      segs = put_seg(segs, 5, &Segment.block/1)
      # Day 6 was assigned and the lease expired: pending, but an island had it.
      {:ok, s6} = Segment.assign_run(segs[6], "a", "x", @t0)
      segs = Map.put(segs, 6, Segment.reclaim(s6, @t0 + 10_000_000, 600_000))
      # Day 7: nothing ever; day 8: reset by a reject.
      segs = segs |> assigned(8, "a", @t0) |> put_seg(8, &Segment.reset/1)

      expect = %{
        0 => "verified",
        1 => "landed",
        2 => "sealed",
        3 => "stalled",
        4 => "stalled",
        5 => "stalled",
        6 => "sealed",
        7 => "waiting",
        8 => "waiting"
      }

      assert segs[3].status == "diverged"

      for {day, status} <- expect do
        assert Garden.letter_status(g, letter(day, day + 1), segs) == status, "day #{day}"
      end

      # A dropped letter keeps "dropped" whatever its day does.
      assert Garden.letter_status(g, letter(0, 1, dropped_at: 5), segs) == "dropped"
      assert Garden.letter_status(g, letter(5, 1, dropped_at: 5), segs) == "dropped"
    end

    test "a reject that resets a later day returns its letters to waiting, droppable and re-fillable" do
      g = garden(days_total: 4, letters_per_day: 1, queue_max: 10)
      base = fresh(g) |> done(0, "a", @t0) |> done(1, "a", @t0)
      {g, l1} = post!(g, base, 1, 1, 1)
      {g, l2} = post!(g, base, 2, 2, 2)
      assert {l1.day, l2.day} == {2, 3}

      sealed = assigned(base, 2, "b", @t0)
      assert Garden.letter_status(g, l1, sealed) == "sealed"
      assert Garden.letter_status(g, l2, sealed) == "waiting"
      assert {:error, {:refused, _}} = Garden.drop_letter(g, "ltr-1", sealed, 3)
      before_1 = owned(Garden.schedule(g), 1)

      # Day 1 is rejected: it is requeued (its attempts stay), everything after it is reset.
      rejected =
        sealed
        |> put_seg(1, &Segment.requeue/1)
        |> put_seg(2, &Segment.reset/1)
        |> put_seg(3, &Segment.reset/1)

      assert Garden.frontier_day(g, rejected) == 2
      assert Garden.letter_status(g, l1, rejected) == "waiting"
      assert owned(Garden.schedule(g), 1) == before_1
      assert {:ok, dropped_g, _} = Garden.drop_letter(g, "ltr-1", rejected, 3)
      assert {:ok, _, %{day: 2}} = Garden.post_letter(dropped_g, %{x: 3, y: 3, r: 3}, rejected, 3)
    end

    test "landedIn is the day's accepted digest once done, else nil" do
      g = garden()
      segs = fresh(g) |> done(0, "a", @t0) |> assigned(1, "a", @t0)
      assert %{status: "landed", landedIn: landed} = Garden.letter_view(g, letter(0, 1), segs)
      assert landed == digest(0)
      assert %{status: "sealed", landedIn: nil} = Garden.letter_view(g, letter(1, 2), segs)
      assert %{status: "waiting", landedIn: nil} = Garden.letter_view(g, letter(2, 3), segs)

      assert %{status: "dropped", landedIn: nil, droppedAt: 7} =
               Garden.letter_view(g, letter(0, 4, dropped_at: 7), segs)
    end
  end

  # ---- verified_digest?/3 ----

  describe "verified_digest?/3" do
    test "true only for the accepted digest of a day a different island's replay matched" do
      g = garden()

      segs =
        fresh(g)
        |> done(0, "a", @t0)
        |> verified(0, "b", @t0)
        |> done(1, "a", @t0)
        |> assigned(2, "a", @t0)

      assert Garden.verified_digest?(g, segs, digest(0))
      refute Garden.verified_digest?(g, segs, digest(1))
      refute Garden.verified_digest?(g, segs, digest(2))
      refute Garden.verified_digest?(g, segs, "0000000000000000")
      refute Garden.verified_digest?(g, segs, nil)
      refute Garden.verified_digest?(g, segs, 5)
    end

    test "not for a day that diverged" do
      g = garden()
      segs = fresh(g) |> done(0, "a", @t0) |> verified(0, "b", @t0, "ffffffffffffffff")
      refute Garden.verified_digest?(g, segs, digest(0))
    end

    test "not for a verified day behind a day nobody has replayed (the verified prefix)" do
      g = garden() |> release(1, @t0)

      # Day 1 was replayed (by "a") from day 0's checkpoint, which only "a"'s
      # producer has seen: day 0 is done, its replay is in flight or lost.
      segs =
        fresh(g)
        |> done(0, "a", @t0)
        |> done(1, "b", @t0)
        |> verified(1, "a", @t0)

      assert segs[1].status == "verified"
      assert Segment.accepted_digest(segs[1]) == digest(1)
      refute Garden.verified_digest?(g, segs, digest(1))
      refute Garden.verified_digest?(g, segs, digest(0))
      assert Garden.verified_digests(segs) == []

      v = Garden.view(g, segs, islands(), @t0 + 1_000, @env)
      assert v.clock.verifiedStep == 0
      assert v.fork == nil
      # The day's own replay is still reported as what it is.
      assert Enum.find(v.days, &(&1.day == 1)).status == "verified"

      # Once day 0 is replayed too, both are served, in day order.
      segs = verified(segs, 0, "b", @t0)
      assert Garden.verified_digests(segs) == [digest(0), digest(1)]
      assert Garden.verified_digest?(g, segs, digest(1))
      v = Garden.view(g, segs, islands(), @t0 + 1_000, @env)
      assert v.fork.day == 1 and v.fork.digest == digest(1)
    end
  end

  # ---- the view ----

  describe "view/5" do
    test "a young garden: day 0 released and untaken" do
      g = garden()
      v = Garden.view(g, fresh(g), %{}, @t0 + 5_000, @env)

      assert %{
               contract: "garden-v1",
               name: "commons",
               presetId: "spots",
               seed: 1,
               world: %{width: 256, height: 256},
               createdAt: @t0,
               now: nl,
               state: "waiting-for-island",
               census: nil,
               tip: nil,
               fork: nil
             } = v

      assert nl == @t0 + 5_000
      assert v.founding == g.founding

      assert v.pace == %{
               stepsPerDay: @d,
               dawnPeriodMs: @period,
               dawnOffsetMs: 0,
               nextReleaseAt: nil,
               releaseDue: false,
               nextDawnAt: 101 * @period
             }

      assert v.clock == %{
               step: 0,
               verifiedStep: 0,
               releasedStep: @d,
               horizonStep: 6 * @d,
               daysDone: 0,
               daysTotal: 6,
               lastMovedAt: nil,
               sleptMs: nil
             }

      assert v.tending == %{
               windowMs: @period,
               islandsToday: 0,
               deviceTypesToday: 0,
               deviceTypesEver: 0,
               activeNow: 0
             }

      assert v.verification == %{
               daysDone: 0,
               daysVerified: 0,
               byDifferentDeviceType: 0,
               bySameDeviceType: 0,
               diverged: 0,
               failed: 0,
               share: nil
             }

      assert [
               %{
                 day: 0,
                 status: "waiting",
                 startStep: 0,
                 endStep: @d,
                 releasedAt: @t0,
                 doneAt: nil,
                 verifiedAt: nil,
                 digest: nil,
                 verification: nil,
                 letters: [],
                 census: nil
               }
             ] = v.days

      assert v.letters == %{
               perDay: 2,
               queueMax: 5,
               queued: 0,
               nextLanding: %{day: 0, step: @d, open: 2},
               waiting: [],
               recent: []
             }

      assert v.limits == %{
               stoneRadius: %{min: 1, max: 32},
               lettersPerAddressPerHour: 3,
               logMax: 10_000
             }
    end

    test "the scenario: verified (both kinds of device), done with the next release due, with letters" do
      {g, segs, now} = scenario()
      v = Garden.view(g, segs, islands(), now, @env)

      assert v.state == "waiting-for-island"
      assert v.asleep
      assert v.clock.step == 3 * @d
      assert v.clock.verifiedStep == 2 * @d
      assert v.clock.releasedStep == 3 * @d
      assert v.pace.nextReleaseAt == Garden.dawn_at(g, 103)
      assert v.pace.releaseDue
      assert v.clock.daysDone == 3
      assert v.clock.lastMovedAt == g.days[2].done_at
      assert v.clock.sleptMs == now - g.days[2].done_at

      assert v.verification == %{
               daysDone: 3,
               daysVerified: 2,
               byDifferentDeviceType: 1,
               bySameDeviceType: 1,
               diverged: 0,
               failed: 0,
               share: 0.6667
             }

      assert v.tending.deviceTypesEver == 2
      assert v.tending.activeNow == 0

      assert %{
               day: 2,
               step: 300,
               verified: false,
               source: "producer",
               individuals: 102,
               lineages: 52,
               maxGeneration: 12,
               mutations: 1002,
               extinct: false,
               conservationOk: true
             } = v.census

      assert v.tip == %{day: 2, step: 3 * @d, digest: digest(2), verified: false}

      assert v.fork == %{
               day: 1,
               step: 2 * @d,
               digest: digest(1),
               checkpoint: "/api/public/gardens/commons/checkpoints/#{digest(1)}"
             }

      assert Enum.map(v.days, & &1.day) == [2, 1, 0]
      assert Enum.map(v.days, & &1.status) == ["done", "verified", "verified"]

      assert Enum.map(v.days, & &1.verification) == [
               nil,
               "same-device-type",
               "different-device-type"
             ]

      assert Enum.map(v.days, & &1.letters) == [["ltr-2"], ["ltr-1"], []]
      [d2, d1, _d0] = v.days
      assert d2.doneAt == g.days[2].done_at and d2.verifiedAt == nil and d2.digest == digest(2)
      assert d1.verifiedAt == g.days[1].verified_at

      assert v.letters.queued == 3
      assert Enum.map(v.letters.waiting, & &1.id) == ["ltr-4", "ltr-5", "ltr-6"]

      assert Enum.map(v.letters.recent, &{&1.id, &1.status}) == [
               {"ltr-3", "dropped"},
               {"ltr-2", "landed"},
               {"ltr-1", "verified"}
             ]

      assert [%{landedIn: nil, droppedAt: dropped}, %{landedIn: l2}, %{landedIn: l1}] =
               v.letters.recent

      assert is_integer(dropped) and l2 == digest(2) and l1 == digest(1)

      # Day 3 (not yet released) carries ltr-4 and ltr-5 of its 3 slots (ltr-3 was dropped, freeing one).
      assert v.letters.nextLanding == %{day: 3, step: 4 * @d, open: 1}
    end

    test "release due, resting, finished, stopped" do
      g = garden(days_total: 3)
      segs = fresh(g) |> done(0, "a", @t0 + 100)
      g = Garden.record_done(g, 0, @t0 + 200)

      resting = Garden.view(g, segs, islands(), @t0 + 10_000, @env)
      assert resting.state == "resting"
      refute resting.asleep
      assert resting.pace.nextReleaseAt == 101 * @period
      refute resting.pace.releaseDue
      assert resting.clock.sleptMs == 10_000 - 200

      due = Garden.view(g, segs, islands(), 101 * @period + 5, @env)
      assert due.state == "waiting-for-island"
      assert due.pace.releaseDue
      assert due.pace.nextReleaseAt == 101 * @period
      assert due.pace.nextDawnAt == 102 * @period

      g2 = release(g, 1, 101 * @period) |> release(2, 102 * @period)
      all_done = segs |> done(1, "a", 1) |> done(2, "a", 1)
      fin = Garden.view(g2, all_done, islands(), 103 * @period, @env)
      assert fin.state == "finished"
      assert fin.pace.nextReleaseAt == nil
      assert fin.letters.nextLanding == nil
      refute fin.asleep

      stopped =
        Garden.view(
          g,
          put_seg(segs, 1, &%{&1 | status: "diverged"}),
          islands(),
          101 * @period + 5,
          @env
        )

      assert stopped.state == "stopped"
      assert stopped.pace.nextReleaseAt == nil
      assert stopped.letters.nextLanding == nil
    end

    test "growing with a live lease; an expired lease is waiting, not growing or active" do
      g = garden()
      now = @t0 + 3_000_000
      live = assigned(fresh(g), 0, "a", now - 1_000)
      v = Garden.view(g, live, islands(), now, @env)
      assert v.state == "growing"
      assert v.clock.sleptMs == nil
      assert v.tending.activeNow == 1
      assert [%{status: "growing"}] = v.days
      refute v.asleep

      dead = assigned(fresh(g), 0, "a", now - 600_001)
      v = Garden.view(g, dead, islands(), now, @env)
      assert v.state == "waiting-for-island"
      assert v.tending.activeNow == 0
      assert [%{status: "waiting"}] = v.days
      assert v.asleep

      edge = assigned(fresh(g), 0, "a", now - 600_000)
      assert Garden.view(g, edge, islands(), now, @env).state == "growing"
    end

    test "growing: sleptMs is 0 once the garden has moved" do
      g = garden() |> Garden.record_done(0, @t0 + 10)
      segs = fresh(g) |> done(0, "a", @t0)
      g = release(g, 1, 101 * @period)
      now = 101 * @period + 1000
      segs = assigned(segs, 1, "b", now - 10)
      v = Garden.view(g, segs, islands(), now, @env)
      assert v.state == "growing"
      assert v.clock.sleptMs == 0
      assert v.clock.lastMovedAt == @t0 + 10
    end

    test "asleep: waiting-for-island and nothing heard from the garden within stale_ms" do
      g = garden()
      now = @t0 + 10_000_000
      # An old attempt (lease expired) whose island last spoke a while ago.
      old = assigned(fresh(g), 0, "a", now - 1_000_000)
      assert Garden.view(g, old, islands(), now, @env).asleep
      recent = assigned(fresh(g), 0, "a", now - 120_000)

      # Heard from 2 minutes ago exactly: not stale (the Queue's stale? is exclusive), and the lease is live.
      refute Garden.view(g, recent, islands(), now, @env).asleep
      # Not waiting-for-island: never asleep.
      resting = garden()

      refute Garden.view(
               Garden.record_done(resting, 0, 1),
               fresh(resting) |> done(0, "a", 1),
               islands(),
               @t0 + 5,
               @env
             ).asleep
    end

    test "tending counts distinct islands and device types, never names them" do
      g = garden()
      now = @t0 + 100_000
      segs = fresh(g) |> done(0, "a", now - 80_000_000) |> verified(0, "b", now - 30_000)
      segs = assigned(segs, 1, "c", now - 5_000)
      g1 = release(g, 1, now - 6_000)
      v = Garden.view(g1, segs, islands(), now, @env)

      # Heartbeats: a at now-80M (inside 24h), b and c recent: 3 islands; a and c share an adapter: 2 types.
      assert v.tending.islandsToday == 3
      assert v.tending.deviceTypesToday == 2
      assert v.tending.deviceTypesEver == 2
      assert v.tending.activeNow == 1

      # Outside the window: gone from "today", kept in "ever".
      v = Garden.view(g1, segs, islands(), now + 90_000_000, @env)
      assert v.tending.islandsToday == 0
      assert v.tending.deviceTypesToday == 0
      assert v.tending.deviceTypesEver == 2
    end

    test "an island the Queue forgot counts as one unnamed device type" do
      g = garden()
      segs = fresh(g) |> done(0, "x", @t0) |> verified(0, "y", @t0)
      v = Garden.view(g, segs, %{}, @t0 + 10, @env)
      assert v.verification.bySameDeviceType == 1
      assert v.tending.deviceTypesEver == 1
    end

    test "share is rounded to four places and nil before any day is done" do
      g = garden(days_total: 7)
      segs = fresh(g)
      segs = Enum.reduce(0..2, segs, fn i, acc -> done(acc, i, "a", @t0) end)
      segs = segs |> verified(0, "b", @t0)
      g = Enum.reduce(1..2, g, fn i, acc -> release(acc, i, @t0 + i) end)
      assert Garden.view(g, segs, islands(), @t0 + 5, @env).verification.share == 0.3333
      segs = verified(segs, 1, "b", @t0)
      assert Garden.view(g, segs, islands(), @t0 + 5, @env).verification.share == 0.6667
      segs = verified(segs, 2, "b", @t0)
      assert Garden.view(g, segs, islands(), @t0 + 5, @env).verification.share == 1.0
    end

    test "a diverged day is counted apart and is not a day done" do
      g = garden()
      segs = fresh(g) |> done(0, "a", @t0) |> verified(0, "b", @t0, "ffffffffffffffff")
      v = Garden.view(g, segs, islands(), @t0 + 5, @env)
      assert v.verification.diverged == 1
      assert v.verification.daysDone == 0
      assert v.state == "stopped"
      assert [%{status: "diverged"}] = v.days
      assert v.tip == nil and v.fork == nil
    end

    test "days shows the newest 14 released, newest first" do
      g = garden(days_total: 40)
      g = Enum.reduce(1..20, g, fn i, acc -> release(acc, i, @t0 + i) end)
      v = Garden.view(g, fresh(g), %{}, @t0 + 100, @env)
      assert Enum.map(v.days, & &1.day) == Enum.to_list(20..7//-1)
    end

    test "letters.recent is the newest 32 non-waiting, newest first; waiting is oldest first" do
      g = garden(days_total: 8)
      dropped = for n <- 1..40, do: letter(0, n, dropped_at: n)
      waiting = for n <- 41..43, do: letter(1, n)
      g = with_letters(g, dropped ++ waiting)
      v = Garden.view(g, fresh(g), %{}, @t0 + 100, @env)
      assert Enum.map(v.letters.waiting, & &1.id) == ["ltr-41", "ltr-42", "ltr-43"]
      assert length(v.letters.recent) == 32
      assert hd(v.letters.recent).id == "ltr-40"
      assert List.last(v.letters.recent).id == "ltr-9"
    end

    test "after a redo the day's doneAt, digest and census go away until it is done again" do
      g = garden() |> Garden.record_done(0, @t0 + 5) |> Garden.record_verified(0, @t0 + 9)
      segs = fresh(g) |> done(0, "a", @t0) |> verified(0, "b", @t0)
      v = Garden.view(g, segs, islands(), @t0 + 50, @env)
      assert [%{status: "verified", doneAt: done_at, verifiedAt: ver_at}] = v.days
      assert done_at == @t0 + 5 and ver_at == @t0 + 9

      redone = put_seg(segs, 0, &Segment.requeue/1)
      v = Garden.view(g, redone, islands(), @t0 + 50, @env)

      assert [
               %{
                 status: "waiting",
                 doneAt: nil,
                 verifiedAt: nil,
                 digest: nil,
                 verification: nil,
                 census: nil
               }
             ] = v.days

      assert v.census == nil and v.tip == nil and v.fork == nil
      assert v.clock.daysDone == 0

      # Done again: the record is stamped afresh and the old verified_at is gone.
      g = Garden.record_done(g, 0, @t0 + 30)
      again = redone |> assigned(0, "c", @t0 + 20) |> done(0, "c", @t0 + 20)
      assert Segment.accepted_island(again[0]) == "c"
      v = Garden.view(g, again, islands(), @t0 + 50, @env)
      assert [%{status: "done", doneAt: d, verifiedAt: nil}] = v.days
      assert d == @t0 + 30
    end
  end

  # ---- sanitising and privacy ----

  describe "census sanitising" do
    defp census_of(summary) do
      g = garden() |> Garden.record_done(0, @t0 + 5)
      segs = fresh(g) |> done(0, "a", @t0, summary)
      Garden.view(g, segs, islands(), @t0 + 50, @env)
    end

    test "reads the six known keys, type-checked, and nothing else" do
      v =
        census_of(%{
          "finalIndividuals" => 7,
          "finalLineages" => "many",
          "maxGeneration" => 3.5,
          "mutations" => -1,
          "extinct" => "yes",
          "conservationOk" => true,
          "CANARY" => "do-not-leak",
          "nested" => %{"CANARY" => "do-not-leak"}
        })

      day_census = hd(v.days).census

      assert day_census == %{
               individuals: 7,
               lineages: nil,
               maxGeneration: nil,
               mutations: nil,
               extinct: nil,
               conservationOk: true
             }

      assert Map.take(v.census, [
               :individuals,
               :lineages,
               :maxGeneration,
               :mutations,
               :extinct,
               :conservationOk
             ]) == day_census

      refute Jason.encode!(v) =~ "CANARY"
    end

    test "huge or odd numbers become nil; the bounds are exact" do
      max = 9_007_199_254_740_991

      assert hd(census_of(%{"finalIndividuals" => max, "mutations" => max + 1}).days).census
             |> Map.take([:individuals, :mutations]) == %{individuals: max, mutations: nil}

      big = Integer.pow(10, 5_000)

      c =
        hd(
          census_of(%{"finalIndividuals" => big, "finalLineages" => 0, "maxGeneration" => nil}).days
        ).census

      assert c.individuals == nil and c.lineages == 0 and c.maxGeneration == nil
    end

    test "a non-map or missing summary gives an all-nil census, never an error" do
      all_nil = %{
        individuals: nil,
        lineages: nil,
        maxGeneration: nil,
        mutations: nil,
        extinct: nil,
        conservationOk: nil
      }

      for hostile <- [[1, 2, 3], "text", 42, %{}, %{"finalIndividuals" => %{"x" => 1}}] do
        v = census_of(hostile)
        assert hd(v.days).census == all_nil, inspect(hostile)
        assert Map.take(v.census, Map.keys(all_nil)) == all_nil
      end

      # nil falls back to summary(0) in the builder, so build the nil case by hand.
      g = garden() |> Garden.record_done(0, @t0 + 5)
      segs = fresh(g)
      {:ok, s} = Segment.assign_run(segs[0], "a", "run-0", @t0)
      {:ok, s} = Segment.publish(s, "a", "run-0", digest(0), "s")
      {:ok, s} = Segment.complete_run(s, "a", "run-0", digest(0), nil)
      v = Garden.view(g, %{segs | 0 => s}, islands(), @t0 + 50, @env)
      assert hd(v.days).census == all_nil
    end
  end

  describe "privacy" do
    test "no island id, adapter string, lease or raw summary reaches the encoded view" do
      {g, segs, now} = scenario()

      segs =
        put_seg(segs, 2, fn s ->
          %{
            s
            | attempts:
                Enum.map(
                  s.attempts,
                  &Map.put(&1, :summary, Map.put(summary(2), "adapter", "ADAPTER-SECRET-A"))
                )
          }
        end)

      encoded = Garden.view(g, segs, islands(), now, @env) |> Jason.encode!()

      for secret <- [
            "ADAPTER-SECRET",
            "run-",
            "ver-",
            "\"a\"",
            "\"b\"",
            "\"c\"",
            "state-",
            "adapter",
            "heartbeat"
          ] do
        refute encoded =~ secret, "leaked #{secret}"
      end
    end

    test "the view is a plain map ready for JSON: no tuples, structs or pids anywhere" do
      {g, segs, now} = scenario()
      assert is_map(json(Garden.view(g, segs, islands(), now, @env)))
    end
  end

  # ---- the frozen contract ----

  describe "contract fixture" do
    # Objects: equal key sets, recursively. Arrays of objects: every element against the fixture's first.
    # Scalars: same JSON type unless either side is null (siblings differ: a landed letter has a landedIn, a
    # dropped one a droppedAt). The tests assert the null-allowed blocks are present separately.
    defp assert_shape(_fixture, nil, _path), do: :ok

    defp assert_shape(fixture, actual, path) when is_map(fixture) and is_map(actual) do
      assert Enum.sort(Map.keys(fixture)) == Enum.sort(Map.keys(actual)), "keys differ at #{path}"
      for {k, fv} <- fixture, do: assert_shape(fv, actual[k], "#{path}.#{k}")
    end

    defp assert_shape([first | _], actual, path) when is_list(actual) do
      for {el, i} <- Enum.with_index(actual), do: assert_shape(first, el, "#{path}[#{i}]")
    end

    defp assert_shape(nil, _actual, _path), do: :ok

    defp assert_shape(fv, av, path) when is_number(fv),
      do: assert(is_number(av), "#{path} should be a number")

    defp assert_shape(fv, av, path) when is_binary(fv),
      do: assert(is_binary(av), "#{path} should be a string")

    defp assert_shape(fv, av, path) when is_boolean(fv),
      do: assert(is_boolean(av), "#{path} should be a boolean")

    defp assert_shape([], av, path), do: assert(is_list(av), "#{path} should be a list")

    test "the scenario's view has the fixture's keys and types everywhere" do
      fixture = @fixture |> File.read!() |> Jason.decode!()
      {g, segs, now} = scenario()
      view = Garden.view(g, segs, islands(), now, @env) |> json()

      # The state is driven so that the null-allowed blocks are present.
      for key <- ["census", "tip", "fork"],
          do: assert(is_map(view[key]), "#{key} should be present")

      assert is_map(view["letters"]["nextLanding"])
      assert_shape(fixture, view, "$")
    end

    test "a young garden's view has the same keys, the null blocks aside" do
      fixture = @fixture |> File.read!() |> Jason.decode!()
      g = garden()
      view = Garden.view(g, fresh(g), %{}, @t0, @env) |> json()
      assert Enum.sort(Map.keys(view)) == Enum.sort(Map.keys(fixture))

      for k <- ["pace", "clock", "tending", "verification", "limits"],
          do: assert_shape(fixture[k], view[k], k)
    end
  end
end
