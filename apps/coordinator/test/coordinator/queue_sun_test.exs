defmodule Coordinator.QueueSunTest do
  # A scheduled sun (docs/garden-sun-2026-10-18.md): the runner's shape and world rules at creation, and
  # `sun-v1` gating, so no island that cannot run a sun is ever handed one.
  use ExUnit.Case, async: false
  alias Coordinator.Queue

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-queue-sun-#{System.unique_integer([:positive])}")
    start_supervised!({Queue, data_dir: dir})
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  @spec_ok %{
    "experiment" => "sunned",
    "presetId" => "spots",
    "conditions" => ["treatment"],
    "seeds" => [1],
    "steps" => 1500,
    "segmentSteps" => 500,
    "censusEvery" => 100,
    "verifyFraction" => 0.0
  }
  @sun %{"step" => 500, "kind" => "sun", "percent" => 75, "span" => 500}

  defp with_schedule(list, changes \\ %{}),
    do: Queue.create_experiment(@spec_ok |> Map.merge(changes) |> Map.put("interventions", list))

  test "a sun is accepted beside lesions and feeds, and carried whole into every task" do
    list = [
      %{"step" => 0, "kind" => "lesion", "x" => 1, "y" => 1, "r" => 2},
      @sun,
      %{@sun | "step" => 1000, "percent" => 125}
    ]

    assert {:ok, 3} = with_schedule(list)
    {:ok, %{id: island}} = Queue.join(%{"adapter" => "A"})
    {:ok, t} = Queue.next_task(island, ["interventions-v1", "sun-v1"])
    assert t.kind == "run" and t.spec.interventions == list
  end

  test "the runner's shape rules for a sun" do
    assert {:error,
            "interventions[0]: a sun has no key \"x\" (its keys are step, kind, percent, span)"} =
             with_schedule([Map.put(@sun, "x", 1)])

    assert {:error, "interventions[0]: a sun needs the key \"span\""} =
             with_schedule([Map.delete(@sun, "span")])

    for p <- [0, 100, 60, 75.0, "75", nil] do
      assert {:error, "interventions[0]: a sun's percent must be one of 50, 75, 125, 150"} =
               with_schedule([%{@sun | "percent" => p}]),
             inspect(p)
    end

    for n <- [0, -1, 1.5, 16_777_217, "2"] do
      assert {:error, "interventions[0]: a sun's span must be an integer in 1..16777216"} =
               with_schedule([%{@sun | "span" => n}]),
             inspect(n)
    end

    assert {:error,
            "interventions[1]: a sun at t=900 starts before the previous sun ends (t=1000); suns do not overlap"} =
             with_schedule([@sun, %{@sun | "step" => 900}])

    # Back to back is fine.
    assert {:ok, 3} = with_schedule([@sun, %{@sun | "step" => 1000}])
  end

  test "a sun sets inside its run and inside its world's light" do
    assert {:error,
            "interventions[0]: a sun at t=1000 for 600 steps ends at t=1600, after the run's last step (steps 1500)" <>
              _} =
             with_schedule([%{@sun | "step" => 1000, "span" => 600}])

    assert {:error,
            "interventions[0]: this world's light cannot take a sun of 150%: it would be 60 + 240 + 0"} =
             with_schedule([%{@sun | "percent" => 150}])

    assert {:error,
            "interventions[0]: this world's light cannot take a sun of 125%: it would be 25 + 275 + 0"} =
             with_schedule([%{@sun | "percent" => 125}], %{"presetId" => "gradient"})

    assert {:error,
            "interventions[0]: a sun is checked against the preset's own light, and one of this experiment's conditions changes it"} =
             with_schedule([@sun], %{
               "presetId" => "gradient",
               "conditions" => ["treatment", "uniform-light"]
             })
  end

  test "Queue.sun_percents/1 is what each preset's light takes" do
    assert Queue.sun_percents("spots") == [50, 75, 125]
    assert Queue.sun_percents("gradient") == [50, 75]
    assert Queue.sun_percents("wild-storm-large") == [50, 75]
    assert Queue.sun_percents("nowhere") == []
  end

  test "a sunned experiment goes only to an island that advertises sun-v1" do
    assert {:ok, 3} = with_schedule([@sun])
    {:ok, %{id: old}} = Queue.join(%{"adapter" => "Old"})
    {:ok, %{id: new}} = Queue.join(%{"adapter" => "New"})

    for caps <- [
          [],
          ["interventions-v1"],
          ["sun-v1"],
          ["ponds-v1", "ponds-v2", "interventions-v1", "breed-v1"]
        ] do
      assert {:ok, %{kind: "idle"}} = Queue.next_task(old, caps), inspect(caps)
    end

    {:ok, t} = Queue.next_task(new, ["interventions-v1", "sun-v1"])
    assert t.kind == "run"
  end

  test "an experiment with lesions and feeds only still goes to an interventions-v1 island" do
    assert {:ok, 3} =
             with_schedule([%{"step" => 0, "kind" => "lesion", "x" => 1, "y" => 1, "r" => 2}])

    {:ok, %{id: island}} = Queue.join(%{"adapter" => "A"})
    {:ok, t} = Queue.next_task(island, ["interventions-v1"])
    assert t.kind == "run"
  end

  test "sun-v1 is a known capability, kept in an island's recorded copy" do
    assert "sun-v1" in Queue.known_capabilities()
  end

  test "a garden is not founded with a sun: its suns are its letters" do
    assert {:error, "founding" <> _} =
             Queue.create_garden(%{
               "name" => "commons",
               "presetId" => "spots",
               "seed" => 1,
               "founding" => [%{"step" => 0, "kind" => "sun", "percent" => 50, "span" => 20}],
               "stepsPerDay" => 20,
               "censusEvery" => 10,
               "days" => 3
             })
  end
end
