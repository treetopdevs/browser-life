defmodule Coordinator.GardenSunTest do
  # The sun letter (docs/garden-sun-2026-10-18.md), pure: its body, where it lands (a letter place, one a day, never the
  # last day), its place in the schedule, and the keeper's veto at or beyond the frontier.
  use ExUnit.Case, async: true
  alias Coordinator.{Garden, Segment}

  @d 100
  @t0 100 * 86_400_000 + 3_600_000

  defp garden(opts \\ []) do
    %{
      name: "commons",
      preset_id: "spots",
      seed: 1,
      steps_per_day: @d,
      days_total: 4,
      letters_per_day: 2,
      queue_max: 10,
      dawn_period_ms: 86_400_000,
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
         i * @d,
         @d
       )}
    end
  end

  defp assigned(segs, i) do
    {:ok, s} = Segment.assign_run(segs[i], "isle", "lease-#{i}", @t0)
    Map.put(segs, i, s)
  end

  defp post!(g, segs, letter) do
    {:ok, g, record} = Garden.post_letter(g, letter, segs, @t0)
    {g, record}
  end

  test "parse_letter takes exactly kind and percent, a percent of the set" do
    assert {:ok, %{kind: "sun", percent: 75}} =
             Garden.parse_letter(%{"kind" => "sun", "percent" => 75})

    assert {:error, "a sun letter has exactly the keys kind and percent"} =
             Garden.parse_letter(%{"kind" => "sun", "percent" => 75, "span" => 5})

    assert {:error, "a sun letter has exactly the keys kind and percent"} =
             Garden.parse_letter(%{"kind" => "sun"})

    for p <- [0, 100, 75.0, "75", nil],
        do:
          assert(
            {:error, "percent must be one of 50, 75, 125, 150"} =
              Garden.parse_letter(%{"kind" => "sun", "percent" => p})
          )

    assert {:error, ~s(kind must be "stone" or "sun")} =
             Garden.parse_letter(%{"kind" => "moon", "x" => 1, "y" => 1, "r" => 1})

    # A stone is what it was.
    assert {:ok, %{x: 1, y: 2, r: 3}} =
             Garden.parse_letter(%{"kind" => "stone", "x" => 1, "y" => 2, "r" => 3})

    assert :ok = Garden.check_bounds(garden(), %{kind: "sun", percent: 50})
  end

  test "a sun lands at the end of the first open day, shines one day, and takes a letter place" do
    g = garden()
    segs = fresh(g)
    {g, sun} = post!(g, segs, %{kind: "sun", percent: 50})
    assert %{kind: "sun", percent: 50, span: @d, day: 0, step: @d} = sun
    refute Map.has_key?(sun, :x)
    # The stone that follows takes day 0's second place; the next stone goes to day 1.
    {g, s1} = post!(g, segs, %{x: 1, y: 1, r: 2})
    {_g, s2} = post!(g, segs, %{x: 1, y: 1, r: 2})
    assert {s1.day, s2.day} == {0, 1}
  end

  test "at most one sun a day, never on the last day, and only a percent the garden's light takes" do
    g = garden()
    segs = fresh(g)
    {g, a} = post!(g, segs, %{kind: "sun", percent: 50})
    {g, b} = post!(g, segs, %{kind: "sun", percent: 75})
    {g, c} = post!(g, segs, %{kind: "sun", percent: 125})
    assert {a.day, b.day, c.day} == {0, 1, 2}

    assert {:error, {:refused, "no day before the last has room for a sun"}} =
             Garden.post_letter(g, %{kind: "sun", percent: 50}, segs, @t0)

    assert Garden.next_sun_landing(g, segs) == nil
    # Stones still land on the last day.
    assert {:ok, _g, %{day: 0}} = Garden.post_letter(g, %{x: 1, y: 1, r: 1}, segs, @t0)

    assert {:error, {:invalid, "this garden's light takes a sun of 50 or 75 or 125 percent"}} =
             Garden.post_letter(garden(), %{kind: "sun", percent: 150}, fresh(garden()), @t0)

    storm = garden(preset_id: "wild-storm-large", width: 512, height: 512)
    assert Garden.sun_percents(storm) == [50, 75]
    assert Garden.sun_percents(garden(preset_id: "nowhere")) == []
    # A garden whose light takes no sun has no landing for one, though its days have room.
    assert Garden.next_sun_landing(garden(preset_id: "nowhere"), fresh(garden())) == nil
    assert %{day: 0} = Garden.next_sun_landing(garden(), fresh(garden()))

    assert {:error, {:invalid, "this garden's light takes no sun"}} =
             Garden.post_letter(
               garden(preset_id: "nowhere"),
               %{kind: "sun", percent: 50},
               fresh(garden()),
               @t0
             )
  end

  test "a sun lands at or beyond the frontier" do
    g = garden()
    segs = fresh(g) |> assigned(0)
    {_g, sun} = post!(g, segs, %{kind: "sun", percent: 50})
    assert sun.day == 1 and sun.step == 2 * @d
  end

  test "the schedule: stones, then foods, then suns at one step, each by seq" do
    g = garden(food: %{asks: 1, every_days: 1, amount: 4, r: 3})
    segs = fresh(g)
    {g, _} = post!(g, segs, %{kind: "sun", percent: 75})
    {g, _} = post!(g, segs, %{x: 3, y: 4, r: 2})
    # One hand calls a food onto the frontier day, day 0, landing at the same step.
    {:called, g, _hands, food} = Garden.add_hand(g, nil, {:epoch, "hash"}, segs, @t0)
    assert food.step == @d

    entries = Garden.schedule(g)
    assert hd(entries) == hd(g.founding)
    kinds = for e <- tl(entries), e["step"] == @d, do: e["kind"]
    assert kinds == ["lesion", "feed", "sun"]
    assert %{"step" => @d, "kind" => "sun", "percent" => 75, "span" => @d} = List.last(entries)
    assert Enum.sort(Map.keys(List.last(entries))) == ["kind", "percent", "span", "step"]
  end

  test "the keeper drops a sun at or beyond the frontier, and not once its day is assigned" do
    g = garden()
    segs = fresh(g)
    {g, sun} = post!(g, segs, %{kind: "sun", percent: 50})
    assert {:error, {:refused, _}} = Garden.drop_letter(g, sun.id, assigned(segs, 0), @t0 + 1)
    {:ok, g, dropped} = Garden.drop_letter(g, sun.id, segs, @t0 + 1)
    assert dropped.dropped_at == @t0 + 1
    assert Garden.schedule(g) == g.founding
    # Its day is free for a sun again.
    assert %{day: 0} = Garden.next_sun_landing(g, segs)
  end

  test "a letter's view has every key: a sun's x, y, r null, a stone's percent and span null" do
    g = garden()
    segs = fresh(g)
    {g, sun} = post!(g, segs, %{kind: "sun", percent: 50})
    {g, stone} = post!(g, segs, %{x: 1, y: 2, r: 3})
    sv = Garden.letter_view(g, sun, segs)
    tv = Garden.letter_view(g, stone, segs)
    assert Enum.sort(Map.keys(sv)) == Enum.sort(Map.keys(tv))
    assert %{x: nil, y: nil, r: nil, percent: 50, span: @d, kind: "sun", status: "waiting"} = sv
    assert %{x: 1, y: 2, r: 3, percent: nil, span: nil} = tv
  end
end
