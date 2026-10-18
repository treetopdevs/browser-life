defmodule Coordinator.ReleaseConfigTest do
  @moduledoc """
  The production configuration, read the way a release reads it
  (`Config.Reader`): who may call the coordinator cross-origin, and what
  production refuses to start without. Nothing here changes the running
  application's config; environment variables are restored.
  """
  use ExUnit.Case, async: false

  @vars ~w(SECRET_KEY_BASE BL_ADMIN_TOKEN BL_CORS_ORIGINS BL_ISLAND_JOINS_PER_ADDRESS BL_MAX_ISLANDS BL_TRUST_FORWARDED_FOR BL_GARDEN_ISLAND_TOKEN BL_DISCOVERY_LEASE_MS)

  setup do
    saved = for v <- @vars, do: {v, System.get_env(v)}

    on_exit(fn ->
      for {v, val} <- saved,
          do: if(val, do: System.put_env(v, val), else: System.delete_env(v))
    end)

    for v <- @vars, do: System.delete_env(v)
    :ok
  end

  defp prod_config, do: Config.Reader.read!("config/config.exs", env: :prod)
  defp prod_runtime, do: Config.Reader.read!("config/runtime.exs", env: :prod)

  defp prod_env(cors \\ nil) do
    System.put_env("SECRET_KEY_BASE", String.duplicate("k", 64))
    System.put_env("BL_ADMIN_TOKEN", "admin")
    if cors, do: System.put_env("BL_CORS_ORIGINS", cors)
  end

  test "prod allows no cross-origin callers by default and keeps tokenless local administration off" do
    coordinator = prod_config()[:coordinator]
    assert coordinator[:cors_origins] == []
    assert coordinator[:allow_local_admin] == false
    assert coordinator[:trust_forwarded_for] == false
    assert coordinator[:island_requests_per_address] == nil
    # Off until the proxy passes on client addresses (every visitor is one address).
    assert coordinator[:island_joins_per_address] == nil
    assert coordinator[:island_next_per_island] == 120
    assert coordinator[:island_segment_requests_per_island] == 600
    assert coordinator[:island_max_pending] == 4
    assert coordinator[:max_islands] == 20_000

    prod_env()
    refute Keyword.has_key?(prod_runtime()[:coordinator], :cors_origins)
  end

  # Slice 15 (docs/garden-hardening-2026-10-18.md, item 3): production founds
  # big-storm gardens only (a `spots` garden is a dev and test convenience), and
  # nothing at runtime widens that. garden_prod_presets_test.exs founds one over
  # HTTP under this same value.
  test "prod garden presets are the big storm only, and no garden island token by default" do
    coordinator = prod_config()[:coordinator]
    assert coordinator[:garden_presets] == ["wild-storm-large"]
    assert coordinator[:garden_island_token] == nil

    # The reader does follow the environment (dev.exs widens the list), so the
    # check above is not vacuous.
    assert "spots" in Config.Reader.read!("config/config.exs", env: :dev)[:coordinator][
             :garden_presets
           ]

    prod_env()
    refute Keyword.has_key?(prod_runtime()[:coordinator], :garden_presets)
    refute Keyword.has_key?(prod_runtime()[:coordinator], :garden_island_token)

    System.put_env("BL_GARDEN_ISLAND_TOKEN", "t")
    assert prod_runtime()[:coordinator][:garden_island_token] == "t"

    # And no variable at all can widen it: runtime.exs never names the key
    # (a check on the variables above would miss a new one).
    refute File.read!("config/runtime.exs") =~ "garden_presets"
  end

  # Slice 18 (docs/garden-food-2026-10-18.md, section 4): the food defaults a
  # garden founded with food copies into its record, and nothing at runtime
  # changes them.
  test "prod food defaults: 5 networks, one food per 7 days, 16 quanta per cell over radius 32" do
    coordinator = prod_config()[:coordinator]
    assert coordinator[:garden_food_asks] == 5
    assert coordinator[:garden_food_every_days] == 7
    assert coordinator[:garden_food_amount] == 16
    assert coordinator[:garden_food_radius] == 32
    refute File.read!("config/runtime.exs") =~ "garden_food"
  end

  # D-17 and D-24: until the proxy passes client addresses every visitor is one
  # address, and the food block says so; BL_TRUST_FORWARDED_FOR=1 (set with the
  # Caddy fix) clears it.
  test "prod says visitors share one address to the food ask until BL_TRUST_FORWARDED_FOR=1" do
    assert prod_config()[:coordinator][:garden_shared_address] == true

    assert Config.Reader.read!("config/config.exs", env: :dev)[:coordinator][
             :garden_shared_address
           ] == false

    prod_env()
    refute Keyword.has_key?(prod_runtime()[:coordinator], :garden_shared_address)
    System.put_env("BL_TRUST_FORWARDED_FOR", "1")
    assert prod_runtime()[:coordinator][:garden_shared_address] == false
    assert prod_runtime()[:coordinator][:trust_forwarded_for] == true
  end

  # A garden island token is a join-body parameter (`gardenToken`); Phoenix's
  # parameter filter matches case-sensitively, and its default is ["password"]
  # alone. garden_api_test.exs checks an actual join's log line.
  test "the parameter filter hides a garden island token" do
    filter = prod_config()[:phoenix][:filter_parameters]

    assert Phoenix.Logger.filter_values(%{"gardenToken" => "x", "adapter" => "A"}, filter) ==
             %{"gardenToken" => "[FILTERED]", "adapter" => "A"}

    assert Phoenix.Logger.filter_values(%{"token" => "x", "password" => "y"}, filter) ==
             %{"token" => "[FILTERED]", "password" => "[FILTERED]"}

    # Values match a pattern followed by "=" only (Phoenix appends it), so
    # config.exs's comment says "token=", not any value containing "Token".
    assert Phoenix.Logger.filter_values(%{"a" => "Token=x", "b" => "Token x"}, filter) ==
             %{"a" => "[FILTERED]", "b" => "Token x"}

    # A bare string in a list is never value-matched; a map in a list is
    # filtered by key as anywhere else.
    assert Phoenix.Logger.filter_values(
             %{"a" => ["Token=x"], "b" => [%{"gardenToken" => "x"}]},
             filter
           ) ==
             %{"a" => ["Token=x"], "b" => [%{"gardenToken" => "[FILTERED]"}]}
  end

  test "prod runtime requires SECRET_KEY_BASE" do
    System.put_env("BL_ADMIN_TOKEN", "admin")
    assert_raise RuntimeError, ~r/SECRET_KEY_BASE/, fn -> prod_runtime() end
  end

  test "prod runtime requires BL_ADMIN_TOKEN" do
    System.put_env("SECRET_KEY_BASE", String.duplicate("k", 64))
    assert_raise RuntimeError, ~r/BL_ADMIN_TOKEN/, fn -> prod_runtime() end
    System.put_env("BL_ADMIN_TOKEN", "")
    assert_raise RuntimeError, ~r/BL_ADMIN_TOKEN/, fn -> prod_runtime() end
  end

  test "prod runtime refuses a wildcard origin" do
    prod_env("*")
    assert_raise RuntimeError, ~r/BL_CORS_ORIGINS/, fn -> prod_runtime() end
    prod_env("https://a.example, *")
    assert_raise RuntimeError, ~r/BL_CORS_ORIGINS/, fn -> prod_runtime() end
  end

  test "prod runtime refuses an http origin, and takes named https ones" do
    prod_env("http://cadence.garden")
    assert_raise RuntimeError, ~r/BL_CORS_ORIGINS/, fn -> prod_runtime() end

    # Not whole origins as a browser sends them: never matched, or too broad.
    for bad <- [
          "https://",
          "https://*",
          "https://*.example",
          "https://cadence.garden/",
          "https://cadence.garden/lab",
          "https://cadence.garden?x=1",
          "https://cadence.garden#x",
          "https://user@cadence.garden",
          "https://cadence.garden:443",
          "HTTPS://cadence.garden",
          "https://Cadence.Garden",
          # Codex pass 3: spellings a browser serializes differently, and bad ports.
          "https://[2001:db8:0:0:0:0:0:1]",
          "https://[2001:DB8::1]",
          "https://[::ffff:1.2.3.4]",
          "https://127.1",
          "https://0x7f.0.0.1",
          "https://010.0.0.1",
          "https://b\u00fccher.example",
          "https://a_b.example",
          "https://lab.example:65536",
          "https://lab.example:0"
        ] do
      System.put_env("BL_CORS_ORIGINS", bad)
      assert_raise RuntimeError, ~r/BL_CORS_ORIGINS/, fn -> prod_runtime() end
    end

    prod_env("https://a.example:8443")
    assert prod_runtime()[:coordinator][:cors_origins] == ["https://a.example:8443"]

    for good <- [
          "https://[2001:db8::1]",
          "https://[2001:db8:0:1:1:1:1:1]",
          "https://192.0.2.1:8443",
          "https://xn--bcher-kva.example",
          "https://a-1.example:65535"
        ] do
      prod_env(good)
      assert prod_runtime()[:coordinator][:cors_origins] == [good]
    end

    prod_env("https://a.example, https://b.example")

    assert prod_runtime()[:coordinator][:cors_origins] == [
             "https://a.example",
             "https://b.example"
           ]
  end

  test "BL_ISLAND_JOINS_PER_ADDRESS sets, switches off or leaves the join budget, and a bad value stops the boot by name" do
    prod_env()

    joins = fn v ->
      System.put_env("BL_ISLAND_JOINS_PER_ADDRESS", v)
      Keyword.fetch(prod_runtime()[:coordinator], :island_joins_per_address)
    end

    assert joins.("500") == {:ok, 500}
    assert joins.(" 20 ") == {:ok, 20}
    assert joins.("off") == {:ok, nil}
    assert joins.("0") == {:ok, nil}
    # Blank (a compose `${VAR:-}`) is unset: the config file's value stands.
    assert joins.("") == :error
    assert joins.("  ") == :error

    for bad <- ["-5", "abc", "1.5", "20x"] do
      System.put_env("BL_ISLAND_JOINS_PER_ADDRESS", bad)
      assert_raise RuntimeError, ~r/BL_ISLAND_JOINS_PER_ADDRESS/, fn -> prod_runtime() end
    end
  end

  test "BL_MAX_ISLANDS sets the island bound; it cannot be switched off" do
    prod_env()
    System.put_env("BL_MAX_ISLANDS", "50000")
    assert prod_runtime()[:coordinator][:max_islands] == 50_000

    for bad <- ["off", "0", "lots"] do
      System.put_env("BL_MAX_ISLANDS", bad)
      assert_raise RuntimeError, ~r/BL_MAX_ISLANDS/, fn -> prod_runtime() end
    end
  end

  # It was `String.to_integer/1`, a bare ArgumentError (docs/coordinator-hardening-2026-10-18.md).
  test "BL_DISCOVERY_LEASE_MS sets the lease, and a bad value stops the boot by name" do
    prod_env()

    lease = fn v ->
      System.put_env("BL_DISCOVERY_LEASE_MS", v)
      Keyword.fetch(prod_runtime()[:coordinator], :discovery_lease_ms)
    end

    assert lease.("60000") == {:ok, 60_000}
    assert lease.("") == :error

    for bad <- ["abc", "1.5", "0", "-5", "off"] do
      System.put_env("BL_DISCOVERY_LEASE_MS", bad)
      assert_raise RuntimeError, ~r/BL_DISCOVERY_LEASE_MS/, fn -> prod_runtime() end
    end
  end

  test "the production config, with its runtime and the limit variables set, passes Coordinator.ConfigCheck" do
    prod_env()

    for {var, v} <- [
          {"BL_ISLAND_JOINS_PER_ADDRESS", "20"},
          {"BL_MAX_ISLANDS", "50000"},
          {"BL_DISCOVERY_LEASE_MS", "60000"}
        ],
        do: System.put_env(var, v)

    merged = Config.Reader.merge(prod_config(), prod_runtime())
    assert Coordinator.ConfigCheck.errors(merged[:coordinator]) == []

    # "off" is a nil budget, which the check allows.
    System.put_env("BL_ISLAND_JOINS_PER_ADDRESS", "off")
    merged = Config.Reader.merge(prod_config(), prod_runtime())
    assert merged[:coordinator][:island_joins_per_address] == nil
    assert Coordinator.ConfigCheck.errors(merged[:coordinator]) == []
  end
end
