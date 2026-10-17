defmodule Coordinator.LetterLimiterTest do
  @moduledoc """
  The public garden routes' budget and cache, without HTTP: how addresses are
  bucketed, what a refund and a refusal do to the counters, the table cap, and
  the cache generation. (The routes' use of it is `CoordinatorWeb.GardenApiTest`.)
  """
  use ExUnit.Case, async: false
  alias Coordinator.{LetterLimiter, TestClock}

  @env [
    :garden_letters_per_address,
    :garden_refusals_per_address,
    :garden_letter_window_ms,
    :garden_letter_table_max,
    :garden_cache_ms
  ]
  @counters :coordinator_letter_counters

  setup do
    saved = for k <- @env, do: {k, Application.fetch_env(:coordinator, k)}
    TestClock.install(100 * 86_400_000 + 5_000)
    LetterLimiter.reset()

    on_exit(fn ->
      LetterLimiter.reset()
      LetterLimiter.set_gardens(%{})
      TestClock.uninstall()

      for {k, v} <- saved do
        case v do
          {:ok, val} -> Application.put_env(:coordinator, k, val)
          :error -> Application.delete_env(:coordinator, k)
        end
      end
    end)
  end

  defp rows, do: :ets.info(@counters, :size)

  describe "network/1" do
    test "IPv6 is its /64, IPv4-mapped is the IPv4 address, IPv4 is whole" do
      assert LetterLimiter.network({0x2001, 0xDB8, 1, 2, 3, 4, 5, 6}) ==
               {0x2001, 0xDB8, 1, 2, 0, 0, 0, 0}

      assert LetterLimiter.network({0, 0, 0, 0, 0, 0xFFFF, 0xC0A8, 0x0102}) == {192, 168, 1, 2}
      assert LetterLimiter.network({10, 1, 2, 3}) == {10, 1, 2, 3}
      assert LetterLimiter.network(:something_else) == :something_else
    end
  end

  describe "take/1, refund/1 and refuse/1" do
    test "a budget per network: the /128s of one /64 share it" do
      Application.put_env(:coordinator, :garden_letters_per_address, 3)

      for low <- 1..3,
          do: assert({:ok, _} = LetterLimiter.take({0x2001, 0xDB8, 0, 0, 0, 0, 0, low}))

      assert {:error, ms} = LetterLimiter.take({0x2001, 0xDB8, 0, 0, 9, 9, 9, 9})
      assert ms == 3_600_000 - rem(100 * 86_400_000 + 5_000, 3_600_000)
      assert {:ok, _} = LetterLimiter.take({0x2001, 0xDB8, 0, 1, 0, 0, 0, 1})
    end

    test "a refund returns the letter, and a counter back at zero leaves no row" do
      Application.put_env(:coordinator, :garden_letters_per_address, 1)
      before = rows()
      assert {:ok, token} = LetterLimiter.take({10, 0, 0, 1})
      assert rows() == before + 1
      assert {:error, _} = LetterLimiter.take({10, 0, 0, 1})
      # The refused attempt wrote nothing more than the one row.
      assert rows() == before + 1

      LetterLimiter.refund(token)
      assert rows() == before
      # Idempotent, and never below zero.
      LetterLimiter.refund(token)
      LetterLimiter.refund(nil)
      assert rows() == before
      assert {:ok, _} = LetterLimiter.take({10, 0, 0, 1})
    end

    test "a refusal gives the letter back and counts against the refusal budget" do
      Application.put_env(:coordinator, :garden_letters_per_address, 5)
      Application.put_env(:coordinator, :garden_refusals_per_address, 2)

      for _ <- 1..2 do
        assert {:ok, token} = LetterLimiter.take({10, 0, 0, 1})
        LetterLimiter.refuse(token)
      end

      assert {:error, _} = LetterLimiter.take({10, 0, 0, 1})
      # Another address is untouched, and a new window starts again.
      assert {:ok, _} = LetterLimiter.take({10, 0, 0, 2})
      TestClock.advance(3_600_000)
      assert {:ok, _} = LetterLimiter.take({10, 0, 0, 1})
    end

    test "the table is capped: a new address is refused past it, a counted one is not" do
      Application.put_env(:coordinator, :garden_letters_per_address, 5)
      # The salt row counts too; leave room for exactly three addresses.
      Application.put_env(:coordinator, :garden_letter_table_max, rows() + 3)

      for n <- 1..3, do: assert({:ok, _} = LetterLimiter.take({10, 0, 0, n}))
      assert {:error, ms} = LetterLimiter.take({10, 0, 0, 4})
      assert ms > 0
      assert rows() == Application.get_env(:coordinator, :garden_letter_table_max)

      # An address already in the table keeps its budget...
      assert {:ok, _} = LetterLimiter.take({10, 0, 0, 1})
      # ...and the sweep at the window's end frees the room.
      TestClock.advance(3_600_000)
      LetterLimiter.sweep()
      assert {:ok, _} = LetterLimiter.take({10, 0, 0, 4})
    end

    test "2,000 distinct addresses of one /64 are one row" do
      Application.put_env(:coordinator, :garden_letters_per_address, 1_000_000)
      before = rows()

      for n <- 1..2_000,
          do: LetterLimiter.take({0x2001, 0xDB8, 0, 0, 0, 0, div(n, 65_536), rem(n, 65_536)})

      assert rows() == before + 1
    end
  end

  describe "the registry" do
    test "set_gardens replaces what was there; register_garden adds" do
      LetterLimiter.set_gardens(%{"a" => {10, 20}, "b" => {30, 40}})
      assert LetterLimiter.garden_world("a") == {10, 20}
      LetterLimiter.set_gardens(%{"b" => {31, 41}})
      assert LetterLimiter.garden_world("a") == nil
      assert LetterLimiter.garden_world("b") == {31, 41}
      LetterLimiter.register_garden("c", 5, 6)
      assert LetterLimiter.garden_world("c") == {5, 6}
      LetterLimiter.set_gardens(%{})
      assert LetterLimiter.garden_world("c") == nil
    end
  end

  describe "the cache" do
    test "an entry read under an older generation is neither stored nor served" do
      Application.put_env(:coordinator, :garden_cache_ms, 600_000)

      gen = LetterLimiter.generation("g")
      LetterLimiter.put_view("g", "v1", gen)
      assert LetterLimiter.cached_view("g") == {:ok, "v1"}
      LetterLimiter.put_checkpoints("g", %{"d" => "/p"}, gen)
      assert LetterLimiter.cached_checkpoints("g") == {:ok, %{"d" => "/p"}}

      LetterLimiter.invalidate("g")
      assert LetterLimiter.cached_view("g") == :miss
      assert LetterLimiter.cached_checkpoints("g") == :miss
      assert LetterLimiter.generation("g") == gen + 1

      # The slow reader that took `gen` before the invalidation arrives late.
      LetterLimiter.put_view("g", "stale", gen)
      LetterLimiter.put_checkpoints("g", %{"x" => "/q"}, gen)
      assert LetterLimiter.cached_view("g") == :miss
      assert LetterLimiter.cached_checkpoints("g") == :miss
    end

    test "with a ttl of zero nothing is cached" do
      Application.put_env(:coordinator, :garden_cache_ms, 0)
      LetterLimiter.put_view("g", "v", LetterLimiter.generation("g"))
      assert LetterLimiter.cached_view("g") == :miss
    end
  end
end
