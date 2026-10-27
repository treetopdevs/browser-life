defmodule Coordinator.ConfigCheckTest do
  @moduledoc """
  `Coordinator.ConfigCheck` (docs/coordinator-hardening-2026-10-18.md, item 1):
  every limit, window, cap and cache key refuses each value of the wrong shape
  by name and accepts its allowed values; the config files themselves pass; and
  `Coordinator.Application.start/2` raises on a bad value before it starts
  anything. The production runtime (`BL_*` variables) is in
  `release_config_test.exs`.
  """
  use ExUnit.Case, async: false
  alias Coordinator.ConfigCheck

  # Each key's shape, written out here rather than read from the module, so a
  # key moved to another shape (or dropped) fails this test.
  @positive ~w(island_join_window_ms island_next_window_ms island_segment_window_ms
               island_requests_window_ms island_limit_table_max max_islands lease_ms
               discovery_lease_ms garden_letter_window_ms garden_letter_table_max
               garden_hands_sweep_ms garden_call_timeout_ms)a
  @budget ~w(island_joins_per_address island_next_per_island island_segment_requests_per_island
             island_requests_per_address island_max_pending)a
  @non_negative ~w(island_prune_after_ms island_prune_grace_ms public_status_wait_ms
                   garden_cache_wait_ms garden_letters_per_address garden_refusals_per_address)a
  @any_integer ~w(public_status_cache_ms garden_cache_ms)a
  # The garden food and meteor keys and their ranges, written out by hand: a
  # moved bound fails here.
  @food_ranged %{
    garden_food_asks: {2, 1000},
    garden_food_every_days: {1, 365},
    garden_food_amount: {1, 64},
    garden_food_radius: {1, 32}
  }
  @ranged Map.merge(@food_ranged, %{
            garden_meteor_asks: {2, 1000},
            garden_meteor_every_days: {1, 365},
            garden_meteor_radius: {33, 255}
          })

  @values [nil, 0, -1, 1.5, "120", true, false, [limit: 120], %{}, 1]

  defp allowed(key) when key in @positive, do: [1]
  defp allowed(key) when key in @budget, do: [nil, 1]
  defp allowed(key) when key in @non_negative, do: [0, 1]
  defp allowed(key) when key in @any_integer, do: [-1, 0, 1]
  defp allowed(key) when is_map_key(@ranged, key), do: Tuple.to_list(@ranged[key])

  defp all_keys, do: @positive ++ @budget ++ @non_negative ++ @any_integer ++ Map.keys(@ranged)

  test "the module checks exactly the keys of the note's table" do
    assert Enum.sort(ConfigCheck.keys()) == Enum.sort(all_keys())
  end

  # Limit-shaped atoms in `lib/` that are not config keys, each reviewed. None
  # may be read as `:coordinator` config (the literal-read test below would then
  # need it classified, and it is not in @not_limits).
  @shaped_not_config ~w(
    letters_per_address
  )a
  # `letters_per_address`: a field of `Coordinator.Garden`'s view env (its
  # `@type env`), filled by the Queue from config `garden_letters_per_address`.

  # A limit-shaped config key a module reads (a window, budget, cap, cache or
  # lease) that the check does not know would go unchecked: the source is
  # scanned for such atoms, so adding one without `ConfigCheck` fails here.
  test "every limit-shaped key the code names is checked" do
    shaped =
      ~r/(?<![a-z_0-9:]):([a-z][a-z_0-9]*(?:_window_ms|_per_address|_per_island|_table_max|_max_pending|_cache_ms|_wait_ms|_lease_ms|_after_ms|_grace_ms)|lease_ms|max_islands)\b/

    named =
      for file <- Path.wildcard("lib/**/*.ex"),
          [_, key] <- Regex.scan(shaped, File.read!(file)),
          uniq: true,
          do: String.to_atom(key)

    assert named != []
    assert Enum.sort(named -- (ConfigCheck.keys() ++ @shaped_not_config)) == []

    assert Enum.sort(@shaped_not_config -- named) == [],
           "@shaped_not_config names atoms no code names"

    assert ConfigCheck.keys() -- @shaped_not_config == ConfigCheck.keys()
  end

  # The scan above only sees names of a limit-like shape, so a new numeric key
  # with another name (say `:upload_max_bytes`) would slip past it. The tests
  # below close that gap: every key read by a literal atom must be classified,
  # either checked or listed below as not a limit; a read by a variable key may
  # sit only in the reviewed files, at a pinned number of places; and the keys
  # those files pass to their variable-key helpers must be classified too.
  #
  # The scanners assume parenthesised calls: `mix precommit` runs `mix format`,
  # which adds parentheses to every remote call (`Application.get_env
  # :coordinator, :k` becomes `Application.get_env(:coordinator, :k)`). They do
  # not see a quoted key atom (`:"a-b"`; no config key is one) or a read
  # through `import Application` or an alias of it (`lib/` has neither).

  # Keys the code reads that are not limits, windows, caps or caches, so
  # `ConfigCheck` leaves them alone: tokens, paths, lists, maps, flags,
  # versions, injected modules.
  @not_limits ~w(admin_token allow_local_admin breed_presets clock conditions cors_origins
                 data_dir discovery_cloud_envelope discovery_data_dir discovery_join_token
                 discovery_validator dns_cluster_query garden_island_token garden_presets
                 garden_shared_address garden_scheduling
                 incompatible light_conditions metrics_version migration_period pond_period
                 pond_presets presets public_garden rule_version start_discovery start_queue
                 trust_forwarded_for world_light world_size)a

  # Files that read `:coordinator` config by a variable key, each reviewed, with
  # the number of such reads in it. A new variable-key read (a new helper, say)
  # changes the count: check where its keys come from, then add those call
  # sites to `@key_sites` below and update the count.
  @indirect_readers %{
    # `check!/0` reads the whole env to check it.
    "lib/coordinator/config_check.ex" => 1,
    # `window/2`.
    "lib/coordinator/island_limiter.ex" => 1,
    # `limits/1` (two, over `@limit_keys`), `int_env/1`, `env/1`, `env_list/1`.
    "lib/coordinator_web/ops_status.ex" => 5
  }

  # Where the reviewed files name the keys their variable-key reads take: calls
  # to the helpers with a literal key, and `~w(...)a` key tables.
  @key_sites %{
    "lib/coordinator/island_limiter.ex" => [~r/\bwindow\(\s*:([a-z][a-z_0-9]*[?!]?)/],
    "lib/coordinator_web/ops_status.ex" => [
      ~r/\b(?:int_env|env|env_list)\(\s*:([a-z][a-z_0-9]*[?!]?)/,
      ~r/\bbudget\(\s*:([a-z][a-z_0-9]*[?!]?)\s*,\s*:([a-z][a-z_0-9]*[?!]?)/,
      ~r/~w\(([^)]*)\)a/
    ]
  }

  @literal_read ~r/Application\s*\.\s*(?:get_env|fetch_env!?|compile_env!?)\(\s*:coordinator\s*,\s*:([a-z][a-z_0-9]*[?!]?)/
  @indirect_read ~r/Application\s*\.\s*(?:get_env|fetch_env!?|compile_env!?|get_all_env)\(\s*:coordinator\s*(?:\)|,\s*[^:\s])/

  defp literal_keys(source),
    do: for([_, key] <- Regex.scan(@literal_read, source), uniq: true, do: String.to_atom(key))

  defp site_keys(source, regexes) do
    for re <- regexes,
        [_ | captures] <- Regex.scan(re, source),
        capture <- captures,
        key <- String.split(capture),
        uniq: true,
        do: String.to_atom(key)
  end

  defp classified, do: ConfigCheck.keys() ++ @not_limits

  test "the read scanners find every form of a config read" do
    sample = """
    Application.get_env(:coordinator, :upload_max_bytes, 16_384)
    Application.fetch_env!(
      :coordinator,
      :retry_budget
    )
    Application.compile_env(:coordinator, :batch_size)
    Application.fetch_env(:coordinator, :ready?)
    Application.get_env(:coordinator, key, 1)
    Application.get_env(:coordinator, Coordinator.Thing)[:max]
    Application.get_all_env(:coordinator)
    """

    assert literal_keys(sample) == [:upload_max_bytes, :retry_budget, :batch_size, :ready?]
    assert length(Regex.scan(@indirect_read, sample)) == 3

    limiter = @key_sites["lib/coordinator/island_limiter.ex"]

    assert site_keys(
             "defp window_ms(:retry), do: window(:retry_interval, 60_000)\n" <>
               "defp window(key, default), do: max(Application.get_env(:coordinator, key, default), 1)",
             limiter
           ) == [:retry_interval]

    ops = @key_sites["lib/coordinator_web/ops_status.ex"]

    assert site_keys(
             "int_env(:a_cap) env(:a_token) env_list(:a_list) budget(:a_limit, :a_window)\n" <>
               "@keys ~w(a_key b_key)a\n@names ~w(pond-nat)",
             ops
           ) == [:a_cap, :a_token, :a_list, :a_limit, :a_window, :a_key, :b_key]
  end

  test "every config key the code reads by name is checked or listed as not a limit" do
    read =
      for file <- Path.wildcard("lib/**/*.ex"),
          key <- literal_keys(File.read!(file)),
          uniq: true,
          do: key

    unclassified = read -- classified()

    assert unclassified == [],
           "classify #{inspect(unclassified)}: add a shape to Coordinator.ConfigCheck, " <>
             "or list it in @not_limits if it is not a limit"

    assert Enum.sort(@not_limits -- read) == [], "@not_limits names keys no code reads"
    assert ConfigCheck.keys() -- @not_limits == ConfigCheck.keys()
  end

  test "config is read by a variable key only in the reviewed files, at the reviewed places" do
    readers =
      for file <- Path.wildcard("lib/**/*.ex"),
          (count = length(Regex.scan(@indirect_read, File.read!(file)))) > 0,
          into: %{},
          do: {file, count}

    assert readers == @indirect_readers,
           "a variable-key read of :coordinator config was added or removed: check its " <>
             "keys are in Coordinator.ConfigCheck (or not limits), add their call sites " <>
             "to @key_sites, then update @indirect_readers"
  end

  test "the keys the reviewed files pass to their variable-key reads are classified" do
    for {file, regexes} <- @key_sites do
      keys = site_keys(File.read!(file), regexes)
      assert keys != [], "#{file}: no key sites found"

      assert keys -- classified() == [],
             "#{file}: classify #{inspect(keys -- classified())} in Coordinator.ConfigCheck " <>
               "or @not_limits"
    end
  end

  test "a garden letter count of 0 passes (it closes the letter box, as before); a window of 0 does not" do
    assert ConfigCheck.errors(garden_letters_per_address: 0, garden_refusals_per_address: 0) == []
    assert [message] = ConfigCheck.errors(garden_letter_window_ms: 0)
    assert message =~ "garden_letter_window_ms: 0 is not a positive whole number"
  end

  test "every limit key refuses each wrong shape by name" do
    for key <- all_keys(), v <- @values, v not in allowed(key) do
      assert [message] = ConfigCheck.errors([{key, v}]), "#{key}: #{inspect(v)} should be refused"
      assert message =~ "config :coordinator, #{key}: #{inspect(v)} is not "
    end
  end

  test "every limit key accepts its allowed values, and larger ones (a ranged key only its own)" do
    for key <- all_keys(),
        v <- allowed(key) ++ if(is_map_key(@ranged, key), do: [], else: [3_600_000]) do
      assert ConfigCheck.errors([{key, v}]) == [], "#{key}: #{inspect(v)} should pass"
    end
  end

  test "each garden food and meteor key refuses a value just outside its range, by name, at boot" do
    for {key, {lo, hi}} <- @ranged do
      assert ConfigCheck.range(key) == lo..hi

      for v <- [lo, div(lo + hi, 2), hi],
          do: assert(ConfigCheck.errors([{key, v}]) == [], "#{key}: #{v} should pass")

      for v <- [lo - 1, hi + 1] do
        assert ConfigCheck.errors([{key, v}]) == [
                 "config :coordinator, #{key}: #{v} is not a whole number in #{lo}..#{hi}"
               ]
      end
    end

    assert ConfigCheck.errors(garden_food_radius: 33) == [
             "config :coordinator, garden_food_radius: 33 is not a whole number in 1..32"
           ]

    assert ConfigCheck.errors(garden_food_asks: 1) == [
             "config :coordinator, garden_food_asks: 1 is not a whole number in 2..1000"
           ]

    assert_raise FunctionClauseError, fn -> ConfigCheck.food_range(:garden_hands_sweep_ms) end

    assert ConfigCheck.errors(garden_meteor_radius: 32) == [
             "config :coordinator, garden_meteor_radius: 32 is not a whole number in 33..255"
           ]

    assert ConfigCheck.errors(garden_meteor_radius: 256) == [
             "config :coordinator, garden_meteor_radius: 256 is not a whole number in 33..255"
           ]

    assert_raise FunctionClauseError, fn -> ConfigCheck.range(:garden_hands_sweep_ms) end
  end

  test "range/1 equals food_range/1 for the food keys; food_range/1 takes no meteor key" do
    for {key, {lo, hi}} <- @food_ranged,
        do:
          assert(
            ConfigCheck.food_range(key) == ConfigCheck.range(key) and
              lo..hi == ConfigCheck.range(key)
          )

    for key <- Map.keys(@ranged) -- Map.keys(@food_ranged),
        do: assert_raise(FunctionClauseError, fn -> ConfigCheck.food_range(key) end)
  end

  # garden_spec (lib/coordinator/queue.ex) reads these ranges from
  # `food_range/1`; garden_queue_test.exs checks its refusals at both ends.

  test "absent keys pass, and keys outside the table are not looked at" do
    assert ConfigCheck.errors([]) == []
    assert ConfigCheck.errors(%{}) == []
    assert ConfigCheck.errors(presets: "anything", rule_version: 1.5, admin_token: nil) == []
  end

  test "several bad keys are each named, in one list" do
    errors =
      ConfigCheck.errors(island_next_window_ms: 1.5, max_islands: nil, island_max_pending: 0)

    assert length(errors) == 3
    assert Enum.any?(errors, &(&1 =~ "island_next_window_ms: 1.5"))
    assert Enum.any?(errors, &(&1 =~ "max_islands: nil"))
    assert Enum.any?(errors, &(&1 =~ "island_max_pending: 0"))
  end

  test "no checked key is a token, so no message can print one" do
    for key <- ConfigCheck.keys(), do: refute(Atom.to_string(key) =~ ~r/token|secret/i)
  end

  test "the config files pass for dev, test and prod" do
    for env <- [:dev, :test, :prod] do
      coordinator = Config.Reader.read!("config/config.exs", env: env)[:coordinator]
      assert ConfigCheck.errors(coordinator) == [], "config.exs with #{env}"
    end
  end

  test "the running application's config passes" do
    assert ConfigCheck.check!() == :ok
  end

  describe "at application start" do
    setup do
      saved =
        for key <- [:island_next_window_ms, :garden_food_amount],
            do: {key, Application.fetch_env(:coordinator, key)}

      on_exit(fn ->
        for {key, value} <- saved do
          case value do
            {:ok, v} -> Application.put_env(:coordinator, key, v)
            :error -> Application.delete_env(:coordinator, key)
          end
        end
      end)

      :ok
    end

    test "a decimal or nil budget window stops Application.start by name before anything starts" do
      supervisor = Process.whereis(Coordinator.Supervisor)
      assert is_pid(supervisor)

      for bad <- [1.5, nil] do
        Application.put_env(:coordinator, :island_next_window_ms, bad)

        error =
          assert_raise RuntimeError, fn -> Coordinator.Application.start(:normal, []) end

        assert error.message =~
                 "island_next_window_ms: #{inspect(bad)} is not a positive whole number"

        assert_raise RuntimeError, ~r/island_next_window_ms/, &ConfigCheck.check!/0
      end

      # Nothing was started or replaced: the running supervisor is the same one.
      assert Process.whereis(Coordinator.Supervisor) == supervisor
    end

    test "a garden food amount out of its range stops Application.start by name" do
      supervisor = Process.whereis(Coordinator.Supervisor)
      Application.put_env(:coordinator, :garden_food_amount, 65)

      error = assert_raise RuntimeError, fn -> Coordinator.Application.start(:normal, []) end
      assert error.message =~ "garden_food_amount: 65 is not a whole number in 1..64"
      assert Process.whereis(Coordinator.Supervisor) == supervisor
    end
  end
end
