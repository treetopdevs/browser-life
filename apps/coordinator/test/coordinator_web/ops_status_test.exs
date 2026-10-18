defmodule CoordinatorWeb.OpsStatusTest do
  @moduledoc """
  The operator page's additions to `GET /api/status` (`CoordinatorWeb.OpsStatus`;
  docs/ops-dashboard-2026-10-18.md): `limits` as configured and never a token,
  `capabilityNeeds` held to the Queue's real gating, and the page's fixture
  (`test/fixtures/ops-status.example.json`, what the Playwright check serves)
  held to the keys of a real response.
  """
  use CoordinatorWeb.ConnCase, async: false
  import CoordinatorWeb.GardenHelpers, only: [snapshot_env: 1, restore_env: 1]
  alias Coordinator.Queue

  @fixture Path.expand("../fixtures/ops-status.example.json", __DIR__)
  @caps ~w(breed-v1 interventions-v1 ponds-v1 ponds-v2)
  @env [
    :admin_token,
    :allow_local_admin,
    :garden_island_token,
    :max_islands,
    :island_max_pending,
    :island_requests_per_address,
    :island_requests_window_ms,
    :island_next_per_island,
    :island_next_window_ms,
    :island_segment_requests_per_island,
    :island_prune_grace_ms,
    :conditions
  ]

  setup do
    dir = Path.join(System.tmp_dir!(), "bl-ops-#{System.unique_integer([:positive])}")
    saved = snapshot_env(@env)

    on_exit(fn ->
      # The letter registry outlives the Queue (a persistent term): leave none behind.
      Coordinator.LetterLimiter.set_gardens(%{})
      restore_env(saved)
      File.rm_rf!(dir)
    end)

    start_supervised!({Queue, data_dir: dir})
    %{dir: dir}
  end

  defp authed(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  defp join(conn, adapter, user_agent) do
    body =
      conn
      |> put_req_header("content-type", "application/json")
      |> post("/api/islands", Jason.encode!(%{"adapter" => adapter, "userAgent" => user_agent}))
      |> json_response(200)

    {body["id"], body["token"]}
  end

  defp next(island, token, caps) do
    build_conn()
    |> authed(token)
    |> put_req_header("content-type", "application/json")
    |> post("/api/next?island=#{island}", Jason.encode!(%{"capabilities" => caps}))
    |> json_response(200)
  end

  test "limits reports configured island budgets and the island count, and never a token",
       %{conn: conn} do
    Application.put_env(:coordinator, :allow_local_admin, true)
    Application.delete_env(:coordinator, :admin_token)
    Application.put_env(:coordinator, :garden_island_token, nil)
    Application.put_env(:coordinator, :max_islands, 7)
    Application.put_env(:coordinator, :island_max_pending, 3)
    Application.put_env(:coordinator, :island_requests_per_address, 5)
    Application.put_env(:coordinator, :island_requests_window_ms, 1234)
    Application.put_env(:coordinator, :island_next_per_island, nil)
    Application.put_env(:coordinator, :island_prune_grace_ms, 4321)

    join(conn, "GPU A", "Agent/1")
    join(build_conn(), "GPU B", "deno 2.5.4")

    limits = (build_conn() |> get("/api/status") |> json_response(200))["limits"]

    assert limits["islands"] == 2
    assert limits["maxIslands"] == 7
    assert limits["islandMaxPending"] == 3
    assert limits["islandPruneGraceMs"] == 4321

    assert limits["islandPruneAfterMs"] ==
             Application.get_env(:coordinator, :island_prune_after_ms)

    assert limits["budgets"]["requests"] == %{"limit" => 5, "windowMs" => 1234}
    assert limits["budgets"]["next"]["limit"] == nil

    assert limits["budgets"]["segment"] == %{
             "limit" => Application.get_env(:coordinator, :island_segment_requests_per_island),
             "windowMs" => Application.get_env(:coordinator, :island_segment_window_ms)
           }

    assert limits["budgets"]["join"]["limit"] ==
             Application.get_env(:coordinator, :island_joins_per_address)

    assert limits["gardenIslandToken"] == false
    # Every key is configured (an explicit nil included): nothing is unset.
    refute Map.has_key?(limits, "unset")

    # A key missing from config is not "off": its consumer applies its own
    # default, so the key is named in `unset`.
    Application.delete_env(:coordinator, :island_segment_requests_per_island)
    limits = (build_conn() |> get("/api/status") |> json_response(200))["limits"]
    assert limits["unset"] == ["island_segment_requests_per_island"]
    assert limits["budgets"]["segment"]["limit"] == nil
    assert limits["budgets"]["next"]["limit"] == nil
    refute Map.has_key?(limits, "invalid")

    # The address budget's built-in default is off, so a missing key is not named.
    Application.delete_env(:coordinator, :island_requests_per_address)
    limits = (build_conn() |> get("/api/status") |> json_response(200))["limits"]
    assert limits["unset"] == ["island_segment_requests_per_island"]
    assert limits["budgets"]["requests"]["limit"] == nil

    # A malformed setting (here a keyword list, which JSON cannot encode) is
    # named in `invalid` and sent as null; the status still answers.
    Application.put_env(:coordinator, :island_next_per_island, limit: 120)
    Application.put_env(:coordinator, :max_islands, "many")
    limits = (build_conn() |> get("/api/status") |> json_response(200))["limits"]
    assert limits["invalid"] == ["max_islands", "island_next_per_island"]
    assert limits["budgets"]["next"]["limit"] == nil
    assert limits["maxIslands"] == nil
    Application.put_env(:coordinator, :island_next_per_island, nil)
    Application.put_env(:coordinator, :max_islands, 7)

    # A window has no "off": an explicit nil window is named in `invalid` too.
    window = Application.get_env(:coordinator, :island_next_window_ms)
    Application.put_env(:coordinator, :island_next_window_ms, nil)
    limits = (build_conn() |> get("/api/status") |> json_response(200))["limits"]
    assert limits["invalid"] == ["island_next_window_ms"]
    assert limits["budgets"]["next"]["windowMs"] == nil
    Application.put_env(:coordinator, :island_next_window_ms, window)

    # An empty token is no token (the Queue's own rule).
    Application.put_env(:coordinator, :garden_island_token, "")

    refute (build_conn()
            |> get("/api/status")
            |> json_response(200))["limits"]["gardenIslandToken"]

    # With both tokens configured: the flag turns true and neither token is in the body.
    Application.put_env(:coordinator, :garden_island_token, "garden-secret-7f3a")
    Application.put_env(:coordinator, :admin_token, "admin-secret-9c1d")

    refused = build_conn() |> get("/api/status")
    assert json_response(refused, 401) == %{"error" => "admin authentication required"}

    ok = build_conn() |> authed("admin-secret-9c1d") |> get("/api/status")
    raw = response(ok, 200)
    assert Jason.decode!(raw)["limits"]["gardenIslandToken"] == true
    refute raw =~ "garden-secret-7f3a"
    refute raw =~ "admin-secret-9c1d"
  end

  # Each case: the spec, the run's condition, and the needs the Queue's rules give it.
  @cases [
    {"plain spots",
     %{
       "presetId" => "spots",
       "conditions" => ["treatment"],
       "steps" => 100,
       "segmentSteps" => 100,
       "censusEvery" => 10
     }, []},
    {"spots with interventions",
     %{
       "presetId" => "spots",
       "conditions" => ["treatment"],
       "steps" => 100,
       "segmentSteps" => 100,
       "censusEvery" => 10,
       "interventions" => [%{"step" => 50, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]
     }, ["interventions-v1"]},
    {"ponds-small treatment",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["treatment"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100
     }, ["ponds-v1"]},
    {"ponds-small pond-nat",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["pond-nat"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100
     }, ["ponds-v1", "ponds-v2"]},
    {"ponds-small pond-breed-mass",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["pond-breed-mass"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100
     }, ["breed-v1", "ponds-v1"]},
    {"ponds-small pond-mass-mass",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["pond-mass-mass"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100
     }, ["breed-v1", "ponds-v1"]},
    {"ponds-small pond-drift-mass",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["pond-drift-mass"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100
     }, ["breed-v1", "ponds-v1"]},
    {"ponds-small treatment with interventions",
     %{
       "presetId" => "ponds-small",
       "conditions" => ["treatment"],
       "steps" => 1000,
       "segmentSteps" => 1000,
       "censusEvery" => 100,
       "interventions" => [%{"step" => 500, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]
     }, ["interventions-v1", "ponds-v1"]},
    {"breeder treatment with interventions",
     %{
       "presetId" => "breeder",
       "conditions" => ["treatment"],
       "steps" => 5000,
       "segmentSteps" => 5000,
       "censusEvery" => 100,
       "interventions" => [%{"step" => 2500, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}]
     }, ["breed-v1", "interventions-v1", "ponds-v1"]},
    {"breeder treatment",
     %{
       "presetId" => "breeder",
       "conditions" => ["treatment"],
       "steps" => 5000,
       "segmentSteps" => 5000,
       "censusEvery" => 100
     }, ["breed-v1", "ponds-v1"]}
  ]

  defp subsets([]), do: [[]]
  defp subsets([h | t]), do: for(s <- subsets(t), x <- [[h | s], s], do: x)

  test "capabilityNeeds agrees with Queue.next_task for every capability subset", %{dir: dir} do
    # The hunt's arms are outside config's :conditions (queue_test.exs adds them the same way).
    conditions = Application.get_env(:coordinator, :conditions)
    Application.put_env(:coordinator, :conditions, conditions ++ ~w(pond-nat pond-shuf))
    assert length(subsets(@caps)) == 16

    for {{label, spec, expected}, n} <- Enum.with_index(@cases) do
      # A fresh queue per case: one experiment, one seed, one segment.
      stop_supervised!(Queue)
      start_supervised!({Queue, data_dir: "#{dir}-#{n}"})
      on_exit(fn -> File.rm_rf!("#{dir}-#{n}") end)

      spec = Map.merge(spec, %{"experiment" => "case-#{n}", "seeds" => [1]})
      assert {:ok, 1} = Queue.create_experiment(spec), label
      [condition] = spec["conditions"]

      needs = CoordinatorWeb.OpsStatus.extend(Queue.status()).capabilityNeeds
      assert needs == %{"case-#{n}" => %{condition => expected}}, label

      # Every subset that lacks a need: a new island is given nothing.
      for caps <- subsets(@caps), not Enum.all?(expected, &(&1 in caps)) do
        {:ok, %{id: island}} = Queue.join(%{"adapter" => "probe"})

        assert {:ok, %{kind: "idle"}} = Queue.next_task(island, caps),
               "#{label}: #{inspect(caps)} should be idle"
      end

      # Exactly the reported set: the run.
      {:ok, %{id: island}} = Queue.join(%{"adapter" => "probe"})
      assert {:ok, task} = Queue.next_task(island, expected)
      assert task.kind == "run" and task.spec.condition == condition, label
    end
  end

  test "capabilityNeeds agrees with Queue.next_task for a garden's day" do
    # A garden's founding schedule is its experiment's `interventions`.
    Application.put_env(:coordinator, :garden_island_token, nil)

    assert {:ok, 3} =
             Queue.create_garden(%{
               "name" => "g-ops",
               "presetId" => "spots",
               "seed" => 1,
               "founding" => [%{"step" => 0, "kind" => "lesion", "x" => 10, "y" => 10, "r" => 3}],
               "stepsPerDay" => 20,
               "censusEvery" => 10,
               "days" => 3
             })

    expected = ["interventions-v1"]
    needs = CoordinatorWeb.OpsStatus.extend(Queue.status()).capabilityNeeds
    assert needs == %{"g-ops" => %{"treatment" => expected}}

    for caps <- subsets(@caps), not Enum.all?(expected, &(&1 in caps)) do
      {:ok, %{id: island}} = Queue.join(%{"adapter" => "probe"})
      assert {:ok, %{kind: "idle"}} = Queue.next_task(island, caps), inspect(caps)
    end

    {:ok, %{id: island}} = Queue.join(%{"adapter" => "probe"})
    assert {:ok, task} = Queue.next_task(island, expected)
    assert task.kind == "run" and task.segment.run =~ ~r{^g-ops/} and task.segment.index == 0
  end

  # Objects keyed by data (experiment names, conditions, statuses), not by schema:
  # their values are compared merged, as one collection.
  @dictionaries ["$.experiments", "$.counts", "$.capabilityNeeds", "$.capabilityNeeds.*"]
  # Keys a real response carries only in some states, each with the test a
  # value must pass wherever it appears (on either side, even when the other
  # side lacks the key): `garden` only on an island that showed a configured
  # garden token; `amount` only on a feed (a lesion has none; feeds are held to
  # it by `feeds_have_amounts/2`); `unset` and `invalid` only while a limit key
  # is missing from config or malformed.
  @optional %{
    "$.islands[].garden" => &is_boolean/1,
    "$.experiments.*.interventions[].amount" => &is_integer/1,
    "$.limits.unset" => &__MODULE__.key_names?/1,
    "$.limits.invalid" => &__MODULE__.key_names?/1
  }
  # Keys some elements of a list or dictionary carry and others do not (an
  # experiment's `garden` and `interventions`): each element may lack them,
  # but the merged elements of both sides must have them.
  @sometimes ["$.experiments.*.garden", "$.experiments.*.interventions"]
  # The only paths where either side may be `null` (a budget switched off).
  @nullable ["$.limits.budgets.join.limit", "$.limits.budgets.requests.limit"]
  @observation_files ~w(series.jsonl lineages.tsv mutations.tsv heredity.tsv life.jsonl activity-final.json)

  test "the ops fixture has the keys of a real /api/status", %{conn: conn, dir: dir} do
    Application.put_env(:coordinator, :allow_local_admin, true)
    Application.delete_env(:coordinator, :admin_token)

    admin = fn path, body ->
      build_conn()
      |> put_req_header("content-type", "application/json")
      |> post(path, Jason.encode!(body))
      |> json_response(200)
    end

    admin.("/api/experiments", %{
      "experiment" => "plain",
      "presetId" => "spots",
      "conditions" => ["treatment"],
      "seeds" => [1, 2],
      "steps" => 200,
      "segmentSteps" => 100,
      "censusEvery" => 10
    })

    admin.("/api/gardens", %{
      "name" => "commons",
      "presetId" => "spots",
      "seed" => 1,
      "stepsPerDay" => 20,
      "censusEvery" => 10,
      "days" => 3,
      "founding" => [
        %{"step" => 0, "kind" => "feed", "x" => 128, "y" => 128, "r" => 50, "amount" => 16}
      ]
    })

    admin.("/api/experiments", %{
      "experiment" => "checked",
      "presetId" => "spots",
      "conditions" => ["treatment"],
      "seeds" => [1, 2],
      "steps" => 100,
      "segmentSteps" => 100,
      "censusEvery" => 10,
      "verifyFraction" => 1.0
    })

    # "checked" (first in run order): c runs both seeds; d's replay of seed-1 diverges, and
    # its replay of seed-2 matches the physics but not the observation files.
    {:ok, %{id: c}} = Queue.join(%{"adapter" => "GPU C"})
    {:ok, %{id: d}} = Queue.join(%{"adapter" => "GPU D"})

    for {seed, verdict} <- [{1, :diverge}, {2, :mismatch}] do
      {:ok, t} = Queue.next_task(c, [])
      assert t.kind == "run" and t.segment.run == "checked/spots/treatment/seed-#{seed}"
      digest = "00000000000000c#{seed}"
      staged = Path.join(dir, "cp-checked-#{seed}")
      File.write!(staged, "x")
      :ok = Queue.publish_checkpoint(t.segment.id, c, t.lease, staged, digest, "0000000000000000")

      for name <- @observation_files do
        file = Path.join(dir, "obs-#{seed}-#{name}")
        File.write!(file, name)
        sha = Coordinator.Store.sha256_file(file)
        :ok = Queue.publish_file(t.segment.id, c, t.lease, file, name, sha)
      end

      assert {:ok, "done"} = Queue.complete(t.segment.id, c, t.lease, "run", digest, %{})
      {:ok, v} = Queue.next_task(d, [])
      assert v.kind == "verify" and v.segment.id == t.segment.id

      case verdict do
        :diverge ->
          assert {:ok, "diverged"} =
                   Queue.complete(v.segment.id, d, v.lease, "verify", "00000000000000ff", %{})

        :mismatch ->
          bad = Map.new(@observation_files, &{&1, String.duplicate("f", 64)})

          assert {:ok, "verified"} =
                   Queue.complete(v.segment.id, d, v.lease, "verify", digest, %{}, bad)
      end
    end

    {a, token_a} = join(conn, "GPU A", "Mozilla/5.0")
    {b, token_b} = join(build_conn(), "GPU B", "deno 2.5.4")

    # a fails seed-1's first segment (its second is blocked); b holds seed-2's.
    t = next(a, token_a, [])
    assert t["segment"]["run"] == "plain/spots/treatment/seed-1"

    assert %{"ok" => true} =
             build_conn()
             |> authed(token_a)
             |> put_req_header("content-type", "application/json")
             |> post(
               "/api/segments/#{t["segment"]["id"]}/fail?island=#{a}",
               Jason.encode!(%{"lease" => t["lease"], "reason" => "feed refused"})
             )
             |> json_response(200)

    # b runs seed-2's first segment to done (so it is a device type), then holds the second.
    t = next(b, token_b, [])
    assert t["segment"]["run"] == "plain/spots/treatment/seed-2"
    staged = Path.join(dir, "cp-ops")
    File.write!(staged, "x")
    digest = "00000000000000a0"
    {seg, lease} = {t["segment"]["id"], t["lease"]}
    :ok = Queue.publish_checkpoint(seg, b, lease, staged, digest, "0000000000000000")
    assert {:ok, "done"} = Queue.complete(seg, b, lease, "run", digest, %{})
    assert %{"kind" => "run", "segment" => %{"index" => 1}} = next(b, token_b, [])

    got = build_conn() |> get("/api/status") |> json_response(200)
    assert got["counts"]["failed"] == 1 and got["counts"]["blocked"] == 1
    assert got["counts"]["assigned"] == 1 and got["counts"]["done"] == 1
    assert Enum.sort(got["devices"]) == ["GPU B", "GPU C", "GPU D"]
    assert [%{"run" => "checked/spots/treatment/seed-1"}] = got["divergences"]
    assert [%{"run" => "checked/spots/treatment/seed-2"}] = got["observationMismatches"]

    fixture = @fixture |> File.read!() |> Jason.decode!()
    # Nulls first, on every element of both sides (merging below would hide one).
    no_nulls("$", got)
    no_nulls("$", fixture)
    feeds_have_amounts("$", got)
    feeds_have_amounts("fixture", fixture)
    compare("$", got, fixture)
  end

  @doc false
  test "the fixture comparison holds a null budget limit's other side to an integer" do
    for path <- @nullable,
        {got, want} <- [{nil, 120}, {120, nil}, {nil, nil}],
        do: compare(path, got, want)

    for path <- @nullable,
        bad <- ["off", true, 1.5, [12], %{"wrong" => 12}],
        {got, want} <- [{nil, bad}, {bad, nil}] do
      assert_raise ExUnit.AssertionError, ~r/an integer or null/, fn ->
        compare(path, got, want)
      end
    end
  end

  def key_names?(v), do: is_list(v) and v != [] and Enum.all?(v, &is_binary/1)

  defp feeds_have_amounts(side, status) do
    for {name, spec} <- status["experiments"],
        %{"kind" => "feed"} = feed <- spec["interventions"] || [] do
      assert is_integer(feed["amount"]), "#{side}: #{name} has a feed without an amount"
    end
  end

  # ---- structural comparison (as garden_contract_test.exs does) ----

  # `null` anywhere but @nullable fails: every value of both sides is walked,
  # with paths named as compare/3 names them (`[]` for an element, `*` for a
  # dictionary's value).
  defp no_nulls(path, nil),
    do: assert(path in @nullable, "#{path} is null; only #{inspect(@nullable)} may be")

  defp no_nulls(path, m) when is_map(m) do
    for {k, v} <- m,
        do: no_nulls(if(path in @dictionaries, do: path <> ".*", else: "#{path}.#{k}"), v)
  end

  defp no_nulls(path, l) when is_list(l), do: Enum.each(l, &no_nulls(path <> "[]", &1))
  defp no_nulls(_path, _scalar), do: :ok

  # `element?`: one side is a single element of a list or dictionary, the other
  # the merged elements of the other side, so its @sometimes keys may be absent
  # and, for a list, it may be empty.
  defp compare(path, got, want, element? \\ false)

  defp compare(path, got, want, element?) when path in @dictionaries do
    assert is_map(got) and is_map(want), "#{path} should be an object in both"

    unless element? do
      refute map_size(got) == 0, "#{path} is empty in the driven state"
      refute map_size(want) == 0, "#{path} is empty in the fixture"
    end

    elements(path <> ".*", Map.values(got), Map.values(want), element?)
  end

  defp compare(path, got, want, element?) when is_map(got) and is_map(want) do
    relaxed = if element?, do: @sometimes, else: []

    optional =
      for k <- Map.keys(got) ++ Map.keys(want),
          p = "#{path}.#{k}",
          Map.has_key?(@optional, p) or p in relaxed,
          do: k

    got_keys = got |> Map.keys() |> Enum.sort()
    want_keys = want |> Map.keys() |> Enum.sort()

    assert got_keys -- optional == want_keys -- optional,
           "#{path}: real keys #{inspect(got_keys)}, fixture keys #{inspect(want_keys)}"

    # An optional key on one side only is still held to its test.
    for {side, m, other} <- [{"real", got, want}, {"fixture", want, got}],
        {k, v} <- m,
        not Map.has_key?(other, k),
        test = @optional["#{path}.#{k}"],
        test != nil,
        do: assert(test.(v), "#{path}.#{k}: #{side} #{inspect(v)} fails its test")

    for {k, v} <- want, Map.has_key?(got, k), do: compare("#{path}.#{k}", got[k], v)
  end

  defp compare(path, got, want, element?) when is_list(got) and is_list(want) do
    cond do
      element? and (got == [] or want == []) -> :ok
      want == [] -> flunk("#{path} is empty in the fixture")
      got == [] -> flunk("#{path} is empty in the driven state")
      true -> elements(path <> "[]", got, want, element?)
    end
  end

  defp compare(path, got, want, _element?), do: compare_scalar(path, got, want)

  # Element by element first, each against the other side's merged elements:
  # merging alone would let one element's key or value stand in for another's
  # missing or mistyped one. Then the merged elements against each other (as
  # leniently as their container was compared).
  defp elements(path, got, want, element?) do
    {got_all, want_all} = {merge(got), merge(want)}
    for g <- got, do: compare(path, g, want_all, true)
    for w <- want, do: compare(path, got_all, w, true)
    compare(path, got_all, want_all, element?)
  end

  # A @nullable path (a budget limit, null when off) is otherwise an integer.
  defp compare_scalar(path, got, want) when is_nil(got) or is_nil(want) do
    assert path in @nullable,
           "#{path} is null (real #{inspect(got)}, fixture #{inspect(want)}); only #{inspect(@nullable)} may be"

    assert (is_nil(got) or is_integer(got)) and (is_nil(want) or is_integer(want)),
           "#{path}: real #{inspect(got)}, fixture #{inspect(want)}; it is an integer or null"
  end

  defp compare_scalar(path, got, want) do
    assert type(got) == type(want),
           "#{path}: real #{inspect(got)} (#{type(got)}), fixture #{inspect(want)} (#{type(want)})"
  end

  # Merged elements: for an object, every key any element has (lists under one
  # key concatenated, otherwise the first non-null value); for a list, the
  # concatenation; for a scalar, the first non-null.
  defp merge([]), do: nil

  defp merge(values) do
    cond do
      Enum.all?(values, &is_map/1) ->
        Enum.reduce(values, %{}, fn m, acc ->
          Map.merge(acc, m, fn
            _k, a, b when is_list(a) and is_list(b) -> a ++ b
            _k, nil, b -> b
            _k, a, _b -> a
          end)
        end)

      Enum.all?(values, &is_list/1) ->
        Enum.concat(values)

      true ->
        Enum.find(values, &(not is_nil(&1)))
    end
  end

  defp type(v) when is_boolean(v), do: :boolean
  defp type(v) when is_number(v), do: :number
  defp type(v) when is_binary(v), do: :string
  defp type(v) when is_list(v), do: :array
  defp type(v) when is_map(v), do: :object
end
