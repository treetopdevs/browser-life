defmodule CoordinatorWeb.GardenContractTest do
  @moduledoc """
  The frozen JSON contract (`garden-v1`) against the real thing: drives a
  garden into a state with a verified day, a done-but-unverified day, letters
  that are waiting, dropped, landed and verified, GETs `/api/public/garden`
  and compares the response with `priv/static/garden-contract.example.json`.

  The comparison is structural. Objects must have the same keys, recursively;
  a scalar the fixture shows must have the same JSON type in the response. An
  array of objects is checked element by element against the fixture's elements
  *merged* (for every key, the first non-null value any element shows), so a
  field that is `null` in the fixture's first day or letter is still typed by
  the one that has a value. A response value may be `null` only at the exact
  paths in `@nullable` (the README's "or `null`" fields, spelled out in full:
  `$.verification` is an object and may never be `null`, while
  `$.days[].verification` may). The state driven here is one where the values
  the front end leans on (census, tip, fork, the next release, the next
  landing) are all present, so those are required to be non-null. The
  enumerated strings (`state`, day and letter `status`, the verification kinds,
  the food ask's `closed` codes and a food's `status`) are checked against the
  README's lists. The garden is founded with food (docs/garden-food-2026-10-18.md):
  a food called by two hands lands on day 1, and one more hand is on the open ask.
  """
  use CoordinatorWeb.ConnCase, async: false
  import CoordinatorWeb.GardenHelpers
  alias Coordinator.{LetterLimiter, Queue, TestClock}

  @d 20
  @fixture Path.expand("../../priv/static/garden-contract.example.json", __DIR__)
  @env [:lease_ms, :garden_cache_ms, :garden_letters_per_address]

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-garden-contract-#{System.unique_integer([:positive])}")
    saved = snapshot_env(@env)
    Application.put_env(:coordinator, :lease_ms, 1_000 * day_ms())
    # One visitor writes seven letters here; the budget is not what is tested.
    Application.put_env(:coordinator, :garden_letters_per_address, 100)
    TestClock.install(100 * day_ms() + 3_600_000)
    LetterLimiter.reset()

    on_exit(fn ->
      LetterLimiter.reset()
      # The registry outlives the Queue (it is a persistent term): leave none behind.
      LetterLimiter.set_gardens(%{})
      TestClock.uninstall()
      restore_env(saved)
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    %{dir: dir}
  end

  # Day 0 verified; day 1 done (not replayed); day 2 not yet released. Letters:
  # ltr-1/2 on day 0 (verified), ltr-3 dropped, ltr-4 on day 1 (landed),
  # ltr-5/6 on day 2 (waiting, the day's budget full) and ltr-7 on day 3. Food:
  # food-1 on day 1 (landed), and one hand on the ask, which is open for day 2.
  defp drive(dir, conn) do
    founding = [
      %{"step" => 0, "kind" => "feed", "x" => 128, "y" => 128, "r" => 50, "amount" => 16}
    ]

    {:ok, 5} =
      Queue.create_garden(%{
        "name" => "commons",
        "presetId" => "spots",
        "seed" => 1,
        "founding" => founding,
        "stepsPerDay" => @d,
        "censusEvery" => 10,
        "days" => 5,
        "lettersPerDay" => 2,
        "queueMax" => 10,
        "food" => true,
        "foodAsks" => 2,
        "foodEveryDays" => 1
      })

    hand = fn ip ->
      %{conn | remote_ip: ip}
      |> put_req_header("content-type", "application/json")
      |> post("/api/public/garden/food/hands", "{}")
      |> json_response(201)
    end

    letter = fn x ->
      conn
      |> put_req_header("content-type", "application/json")
      |> post(
        "/api/public/garden/letters",
        Jason.encode!(%{"kind" => "stone", "x" => x, "y" => 7, "r" => 3})
      )
      |> json_response(201)
    end

    for x <- 1..4, do: letter.(x)
    drop = post(conn, "/api/gardens/commons/letters/ltr-3/drop")
    assert %{"letter" => %{"status" => "dropped"}} = json_response(drop, 200)
    # ltr-3 and ltr-4 were on day 1; one dropped, one stays.

    a = join("Contract-GPU-A")
    b = join("Contract-GPU-B")
    run_and_verify(dir, a, b)

    # Two networks call a food onto the frontier day, day 1, before it is assigned.
    assert %{"called" => nil} = hand.({10, 0, 0, 1})
    assert %{"called" => %{"id" => "food-1", "day" => 1}} = hand.({10, 0, 0, 2})

    TestClock.advance(day_ms())
    t1 = next(a)
    assert t1.segment.index == 1
    finish(dir, a, t1)

    for x <- 5..7, do: letter.(x)
    # A new dawn period: one hand on the ask, open for day 2.
    assert %{"called" => nil, "food" => %{"hands" => 1}} = hand.({10, 0, 0, 3})
    TestClock.advance(60_000)
    :ok
  end

  test "the public view has exactly the frozen contract's shape", %{conn: conn, dir: dir} do
    drive(dir, conn)
    fixture = @fixture |> File.read!() |> Jason.decode!()

    c = get(conn, "/api/public/garden")
    body = response(c, 200)
    got = Jason.decode!(body)

    compare("$", got, fixture)
    check_enums(got)

    # What the front end leans on is present in this state.
    for {label, value} <- [
          {"world", got["world"]},
          {"pace", got["pace"]},
          {"clock", got["clock"]},
          {"tending", got["tending"]},
          {"verification", got["verification"]},
          {"limits", got["limits"]},
          {"letters", got["letters"]},
          {"census", got["census"]},
          {"tip", got["tip"]},
          {"fork", got["fork"]},
          {"pace.nextReleaseAt", got["pace"]["nextReleaseAt"]},
          {"letters.nextLanding", got["letters"]["nextLanding"]},
          {"clock.lastMovedAt", got["clock"]["lastMovedAt"]},
          {"verification.share", got["verification"]["share"]},
          {"food", got["food"]},
          {"food.landing", got["food"]["landing"]},
          {"food.place", got["food"]["place"]},
          {"food.foods[0].landedIn", hd(got["food"]["foods"])["landedIn"]}
        ] do
      refute is_nil(value), "#{label} should be present in the driven state"
    end

    # And the state is the one we meant to drive.
    assert got["contract"] == "garden-v1"
    assert got["world"] == %{"width" => 256, "height" => 256}
    assert hd(got["founding"])["amount"] == 16
    assert got["tip"] == %{"day" => 1, "step" => 2 * @d, "digest" => dg(1), "verified" => false}
    assert got["fork"]["day"] == 0 and got["fork"]["digest"] == dg(0)
    assert got["fork"]["checkpoint"] == "/api/public/gardens/commons/checkpoints/#{dg(0)}"
    assert got["census"]["verified"] == false and got["census"]["individuals"] == 5
    assert got["clock"]["verifiedStep"] == @d and got["clock"]["step"] == 2 * @d

    assert Enum.map(got["days"], &{&1["day"], &1["status"]}) == [{1, "done"}, {0, "verified"}]
    assert Enum.map(got["days"], & &1["letters"]) == [["ltr-4"], ["ltr-1", "ltr-2"]]

    statuses = fn list -> Map.new(list, &{&1["id"], &1["status"]}) end

    assert statuses.(got["letters"]["waiting"]) == %{
             "ltr-5" => "waiting",
             "ltr-6" => "waiting",
             "ltr-7" => "waiting"
           }

    assert statuses.(got["letters"]["recent"]) ==
             %{
               "ltr-4" => "landed",
               "ltr-3" => "dropped",
               "ltr-2" => "verified",
               "ltr-1" => "verified"
             }

    assert Enum.map(got["letters"]["recent"], & &1["id"]) == ["ltr-4", "ltr-3", "ltr-2", "ltr-1"]
    assert Map.new(got["letters"]["recent"], &{&1["id"], &1["landedIn"]})["ltr-4"] == dg(1)
    assert got["letters"]["nextLanding"] == %{"day" => 3, "step" => 4 * @d, "open" => 1}

    # The food: landed on day 1, one hand on the open ask, never among the letters.
    assert %{
             "enabled" => true,
             "asks" => 2,
             "everyDays" => 1,
             "amount" => 16,
             "r" => 32,
             "place" => %{"x" => 128, "y" => 128},
             "hands" => 1,
             "open" => true,
             "closed" => nil,
             "opensAtDay" => nil,
             "landing" => landing,
             "foods" => [food]
           } = got["food"]

    assert landing == %{"day" => 2, "step" => 3 * @d}

    assert got["food"]["expiresAt"] == got["pace"]["nextDawnAt"]

    assert %{"id" => "food-1", "day" => 1, "status" => "landed", "hands" => 2} = food
    assert food["landsAtStep"] == 2 * @d
    # Its day was not run before a whole dawn period after the call.
    assert food["noticeUntil"] == food["calledAt"] + day_ms()
    assert got["food"]["sharedAddress"] == false

    assert food["landedIn"] == dg(1)
    assert Enum.map(got["days"], & &1["food"]) == ["food-1", nil]
    letters = got["letters"]["waiting"] ++ got["letters"]["recent"]
    assert Enum.all?(letters, &String.starts_with?(&1["id"], "ltr-"))

    # Nothing about who tends the garden is in it.
    refute body =~ "Contract-GPU"
  end

  test "the fixture's foods keep a timeline the scheduler can produce" do
    fixture = @fixture |> File.read!() |> Jason.decode!()
    period = fixture["pace"]["dawnPeriodMs"]
    days = Map.new(fixture["days"], &{&1["day"], &1})

    for f <- fixture["food"]["foods"] do
      assert f["noticeUntil"] == f["calledAt"] + period, f["id"]

      # A day carrying a food is not given to an island before its notice ends.
      with %{"doneAt" => done} when is_integer(done) <- days[f["day"]] do
        assert f["noticeUntil"] <= done, "#{f["id"]}: day #{f["day"]} done inside its notice"
      end
    end
  end

  test "the same shape on a garden nothing has happened to", %{conn: conn} do
    {:ok, _} =
      Queue.create_garden(%{
        "name" => "commons",
        "presetId" => "spots",
        "seed" => 1,
        "founding" => [%{"step" => 0, "kind" => "lesion", "x" => 1, "y" => 1, "r" => 2}],
        "stepsPerDay" => @d,
        "censusEvery" => 10,
        "days" => 3
      })

    got = conn |> get("/api/public/garden") |> json_response(200)
    fixture = @fixture |> File.read!() |> Jason.decode!()
    check_enums(got)
    assert got["state"] == "waiting-for-island"
    assert is_map(got["verification"]) and is_map(got["tending"]) and is_map(got["limits"])

    # Key sets of every object (the values that depend on state are null here).
    assert Enum.sort(Map.keys(got)) == Enum.sort(Map.keys(fixture))

    for k <- ~w(pace clock tending verification limits letters food) do
      assert Enum.sort(Map.keys(got[k])) == Enum.sort(Map.keys(fixture[k])), "$.#{k}"
    end

    assert got["census"] == nil and got["tip"] == nil and got["fork"] == nil
    assert got["verification"]["share"] == nil
    assert got["clock"]["lastMovedAt"] == nil and got["clock"]["sleptMs"] == nil
    assert got["letters"]["queued"] == 0 and got["letters"]["waiting"] == []
    # A garden founded without food: the block is there, off.
    assert %{"enabled" => false, "closed" => "off", "open" => false, "hands" => 0, "foods" => []} =
             got["food"]

    assert [%{"day" => 0, "status" => "waiting"}] = got["days"]
    assert Enum.sort(Map.keys(hd(got["days"]))) == Enum.sort(Map.keys(hd(fixture["days"])))
  end

  # ---- structural comparison ----

  # The README's enumerations.
  @states ~w(growing waiting-for-island resting stopped finished)
  @day_statuses ~w(waiting growing done verified diverged failed blocked)
  @letter_statuses ~w(waiting sealed landed verified dropped stalled)
  @kinds ~w(different-device-type same-device-type)
  @closed ~w(off stopped finished horizon log-full cooldown)

  defp check_enums(got) do
    assert got["contract"] == "garden-v1"
    assert got["state"] in @states, "state #{inspect(got["state"])}"

    for day <- got["days"] do
      assert day["status"] in @day_statuses, "days[].status #{inspect(day["status"])}"
      assert day["verification"] in [nil | @kinds]
    end

    for letter <- got["letters"]["waiting"] ++ got["letters"]["recent"] do
      assert letter["status"] in @letter_statuses, "letter status #{inspect(letter["status"])}"
      assert letter["kind"] == "stone"
    end

    assert Enum.all?(got["letters"]["waiting"], &(&1["status"] == "waiting"))
    assert Enum.all?(got["letters"]["recent"], &(&1["status"] != "waiting"))
    if got["census"], do: assert(got["census"]["source"] == "producer")

    food = got["food"]

    assert is_boolean(food["enabled"]) and is_boolean(food["open"]) and
             is_boolean(food["sharedAddress"])

    assert food["closed"] in [nil | @closed], "food.closed #{inspect(food["closed"])}"
    assert food["open"] == (food["closed"] == nil)
    assert food["closed"] == "cooldown" == is_integer(food["opensAtDay"])

    for f <- food["foods"] do
      assert f["status"] in @letter_statuses, "food status #{inspect(f["status"])}"
      assert String.starts_with?(f["id"], "food-")
    end

    :ok
  end

  # Where the README allows `null`, by full path (array positions written `[]`).
  @nullable [
    "$.census",
    "$.tip",
    "$.fork",
    "$.pace.nextReleaseAt",
    "$.clock.lastMovedAt",
    "$.clock.sleptMs",
    "$.verification.share",
    "$.letters.nextLanding",
    "$.days[].doneAt",
    "$.days[].verifiedAt",
    "$.days[].digest",
    "$.days[].verification",
    "$.days[].census",
    "$.letters.waiting[].droppedAt",
    "$.letters.waiting[].landedIn",
    "$.letters.recent[].droppedAt",
    "$.letters.recent[].landedIn",
    "$.days[].food",
    "$.food.asks",
    "$.food.everyDays",
    "$.food.amount",
    "$.food.r",
    "$.food.place",
    "$.food.closed",
    "$.food.opensAtDay",
    "$.food.landing",
    "$.food.foods[].landedIn",
    "$.food.foods[].droppedAt"
  ]

  defp generic(path), do: Regex.replace(~r/\[\d+\]/, path, "[]")

  # A response `null` is allowed only at a path in `@nullable`; a fixture value
  # that is `null` constrains nothing (the parent checked the key is there).
  defp compare(_path, nil, nil), do: :ok

  defp compare(path, nil, _want) do
    assert generic(path) in @nullable, "#{path}: null where the contract has a value"
  end

  defp compare(path, got, want) when is_map(want) do
    assert is_map(got), "#{path}: expected an object, got #{inspect(got)}"

    assert Enum.sort(Map.keys(got)) == Enum.sort(Map.keys(want)),
           "#{path}: keys differ (got #{inspect(Enum.sort(Map.keys(got)))}, fixture #{inspect(Enum.sort(Map.keys(want)))})"

    for {k, w} <- want, do: compare("#{path}.#{k}", got[k], w)
    :ok
  end

  defp compare(path, got, [_ | _] = want) do
    assert is_list(got), "#{path}: expected an array, got #{inspect(got)}"
    shape = Enum.reduce(want, nil, &merge(&2, &1))
    got |> Enum.with_index() |> Enum.each(fn {g, i} -> compare("#{path}[#{i}]", g, shape) end)
  end

  defp compare(path, got, []), do: assert(is_list(got), "#{path}: expected an array")

  # The fixture shows null at this path in every element: the key's presence
  # (checked by the parent) is all.
  defp compare(_path, _got, nil), do: :ok

  defp compare(path, got, want) do
    assert kind(got) == kind(want),
           "#{path}: expected a #{kind(want)}, got #{inspect(got)}"
  end

  # The fixture's elements as one: per key, the first non-null value any shows.
  defp merge(nil, b), do: b
  defp merge(a, nil), do: a

  defp merge(a, b) when is_map(a) and is_map(b),
    do: Map.merge(a, b, fn _k, x, y -> merge(x, y) end)

  defp merge(a, b) when is_list(a) and is_list(b), do: a ++ b
  defp merge(a, _b), do: a

  defp kind(v) when is_boolean(v), do: :boolean
  defp kind(v) when is_number(v), do: :number
  defp kind(v) when is_binary(v), do: :string
  defp kind(nil), do: :null
  defp kind(v) when is_list(v), do: :array
  defp kind(v) when is_map(v), do: :object
end
