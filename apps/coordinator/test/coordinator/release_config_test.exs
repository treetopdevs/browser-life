defmodule Coordinator.ReleaseConfigTest do
  @moduledoc """
  The production configuration, read the way a release reads it
  (`Config.Reader`): who may call the coordinator cross-origin, and what
  production refuses to start without. Nothing here changes the running
  application's config; environment variables are restored.
  """
  use ExUnit.Case, async: false

  @vars ~w(SECRET_KEY_BASE BL_ADMIN_TOKEN BL_CORS_ORIGINS BL_ISLAND_JOINS_PER_ADDRESS BL_MAX_ISLANDS BL_TRUST_FORWARDED_FOR)

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
          "https://Cadence.Garden"
        ] do
      System.put_env("BL_CORS_ORIGINS", bad)
      assert_raise RuntimeError, ~r/BL_CORS_ORIGINS/, fn -> prod_runtime() end
    end

    prod_env("https://a.example:8443")
    assert prod_runtime()[:coordinator][:cors_origins] == ["https://a.example:8443"]

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
end
