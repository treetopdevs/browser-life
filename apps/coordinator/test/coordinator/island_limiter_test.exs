defmodule Coordinator.IslandLimiterTest do
  @moduledoc """
  The island routes' budgets and the public status cache, without HTTP (the
  routes' use of them is `CoordinatorWeb.IslandLimitsTest`).
  """
  use ExUnit.Case, async: false
  alias Coordinator.{IslandLimiter, TestClock}

  @env [
    :island_joins_per_address,
    :island_join_window_ms,
    :island_next_per_island,
    :island_next_window_ms,
    :island_segment_requests_per_island,
    :island_requests_per_address,
    :island_limit_table_max,
    :public_status_cache_ms,
    :public_status_wait_ms
  ]
  @table :coordinator_island_limits
  @hour 3_600_000
  # 100 days and 5 s past the epoch: 5 s into an hour window.
  @t0 100 * 86_400_000 + 5_000

  setup do
    saved = for k <- @env, do: {k, Application.fetch_env(:coordinator, k)}
    TestClock.install(@t0)
    IslandLimiter.reset()

    on_exit(fn ->
      IslandLimiter.reset()
      TestClock.uninstall()

      for {k, v} <- saved do
        case v do
          {:ok, val} -> Application.put_env(:coordinator, k, val)
          :error -> Application.delete_env(:coordinator, k)
        end
      end
    end)
  end

  defp put(k, v), do: Application.put_env(:coordinator, k, v)
  defp counters, do: :ets.select(@table, [{{{:_, :_, :_}, :_}, [], [:"$_"]}])

  test "allows the limit per window, then answers the time to the window's end" do
    put(:island_joins_per_address, 3)
    put(:island_join_window_ms, @hour)

    for _ <- 1..3, do: assert(:ok = IslandLimiter.take(:join, {10, 0, 0, 1}))
    assert {:error, ms} = IslandLimiter.take(:join, {10, 0, 0, 1})
    assert ms == @hour - 5_000
    # A refused attempt never counts: the row still says 3.
    assert [{_, 3}] = counters()

    TestClock.advance(ms)
    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 1})
  end

  test "addresses are kept hashed by network: no IP tuple in the table; one IPv6 /64 shares a budget; an IPv4-mapped address is its IPv4 address" do
    put(:island_joins_per_address, 1)

    assert :ok = IslandLimiter.take(:join, {0x2001, 0xDB8, 1, 2, 3, 4, 5, 6})
    assert {:error, _} = IslandLimiter.take(:join, {0x2001, 0xDB8, 1, 2, 9, 9, 9, 9})
    assert :ok = IslandLimiter.take(:join, {0x2001, 0xDB8, 1, 3, 3, 4, 5, 6})

    assert :ok = IslandLimiter.take(:join, {192, 168, 1, 2})
    assert {:error, _} = IslandLimiter.take(:join, {0, 0, 0, 0, 0, 0xFFFF, 0xC0A8, 0x0102})

    for {{hash, kind, ends_at}, _n} <- counters() do
      assert is_binary(hash) and byte_size(hash) == 32
      assert kind == :join
      assert is_integer(ends_at)
    end

    dump = :ets.tab2list(@table)
    refute Enum.any?(dump, &match?({{{192, 168, 1, 2}, _, _}, _}, &1))
    refute inspect(dump, limit: :infinity) =~ "192, 168"
  end

  test "next is budgeted per island id, and kinds do not share a budget" do
    put(:island_next_per_island, 2)
    put(:island_joins_per_address, 1)

    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert {:error, ms} = IslandLimiter.take(:next, "isl-a")
    assert ms <= 60_000
    assert :ok = IslandLimiter.take(:next, "isl-b")
    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 1})
    refute inspect(:ets.tab2list(@table), limit: :infinity) =~ "isl-"
  end

  test "a kind whose limit is nil is always allowed and stores nothing" do
    put(:island_requests_per_address, nil)
    for _ <- 1..50, do: assert(:ok = IslandLimiter.take(:requests, {10, 0, 0, 1}))
    assert counters() == []

    put(:island_requests_per_address, 2)
    assert :ok = IslandLimiter.take(:requests, {10, 0, 0, 1})
    assert :ok = IslandLimiter.take(:requests, {10, 0, 0, 1})
    assert {:error, _} = IslandLimiter.take(:requests, {10, 0, 0, 1})
  end

  test "a full table refuses a new address and keeps counting a known one" do
    put(:island_joins_per_address, 5)
    put(:island_limit_table_max, 2)

    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 1})
    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 2})
    assert {:error, _} = IslandLimiter.take(:join, {10, 0, 0, 3})
    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 1})
    # A new island id is a new key too: islands forgotten at the island bound
    # leave their counters until the sweep, so the cap bounds them as well.
    assert {:error, _} = IslandLimiter.take(:next, "isl-a")
    assert {:error, _} = IslandLimiter.take(:segment, "isl-a")
  end

  test "island-id keys count toward the cap and are refused past it; a known island keeps working" do
    put(:island_next_per_island, 5)
    put(:island_segment_requests_per_island, 5)
    put(:island_limit_table_max, 2)

    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert :ok = IslandLimiter.take(:segment, "isl-a")
    assert {:error, _} = IslandLimiter.take(:next, "isl-b")
    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert :ok = IslandLimiter.take(:segment, "isl-a")
  end

  test "sweep drops past windows" do
    put(:island_join_window_ms, @hour)
    put(:island_next_window_ms, 60_000)

    assert :ok = IslandLimiter.take(:join, {10, 0, 0, 1})
    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert length(counters()) == 2

    TestClock.advance(60_000)
    IslandLimiter.sweep()
    assert [{{_, :join, _}, 1}] = counters()

    TestClock.advance(@hour)
    IslandLimiter.sweep()
    assert counters() == []
  end

  test "public status cache: served within the ttl, recomputed after it, off at 0" do
    counter = :counters.new(1, [])

    compute = fn ->
      :counters.add(counter, 1, 1)
      %{n: :counters.get(counter, 1)}
    end

    put(:public_status_cache_ms, 60_000)
    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(compute)
    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(compute)

    put(:public_status_cache_ms, 1)
    IslandLimiter.reset()
    assert {:ok, %{n: 2}} = IslandLimiter.cached_public_status(compute)
    Process.sleep(5)
    assert {:ok, %{n: 3}} = IslandLimiter.cached_public_status(compute)

    put(:public_status_cache_ms, 0)
    assert {:ok, %{n: 4}} = IslandLimiter.cached_public_status(compute)
    assert {:ok, %{n: 5}} = IslandLimiter.cached_public_status(compute)
  end

  test "segment requests are budgeted per island id, apart from next" do
    put(:island_segment_requests_per_island, 2)
    put(:island_next_per_island, 1)

    assert :ok = IslandLimiter.take(:segment, "isl-a")
    assert :ok = IslandLimiter.take(:segment, "isl-a")
    assert {:error, ms} = IslandLimiter.take(:segment, "isl-a")
    assert ms <= 60_000
    assert :ok = IslandLimiter.take(:next, "isl-a")
    assert :ok = IslandLimiter.take(:segment, "isl-b")
  end

  test "concurrent charges against one key allow exactly the limit" do
    put(:island_joins_per_address, 20)

    results =
      1..200
      |> Enum.map(fn _ ->
        Task.async(fn -> IslandLimiter.take(:join, {10, 0, 0, 1}) end)
      end)
      |> Enum.map(&Task.await(&1, 30_000))

    assert Enum.count(results, &(&1 == :ok)) == 20
    assert [{_, 20}] = counters()
  end

  test "public status cache: concurrent misses on a cold cache compute once" do
    put(:public_status_cache_ms, 60_000)
    put(:public_status_wait_ms, 30_000)
    counter = :counters.new(1, [])

    compute = fn ->
      :counters.add(counter, 1, 1)
      Process.sleep(200)
      %{n: :counters.get(counter, 1)}
    end

    bodies =
      1..12
      |> Enum.map(fn _ -> Task.async(fn -> IslandLimiter.cached_public_status(compute) end) end)
      |> Enum.map(&Task.await(&1, 60_000))

    assert :counters.get(counter, 1) == 1
    assert Enum.uniq(bodies) == [{:ok, %{n: 1}}]
  end

  test "public status cache: while one caller refreshes an expired entry, the others are served it" do
    put(:public_status_cache_ms, 1)
    assert {:ok, %{n: 0}} = IslandLimiter.cached_public_status(fn -> %{n: 0} end)
    Process.sleep(5)

    parent = self()

    slow =
      Task.async(fn ->
        IslandLimiter.cached_public_status(fn ->
          send(parent, :refreshing)

          receive do
            :go -> %{n: 1}
          end
        end)
      end)

    assert_receive :refreshing, 30_000
    # The refresher holds the marker: everyone else gets the expired entry, now.
    assert {:ok, %{n: 0}} = IslandLimiter.cached_public_status(fn -> flunk("computed twice") end)
    send(slow.pid, :go)
    assert {:ok, %{n: 1}} = Task.await(slow, 30_000)
  end

  test "public status cache: a cold cache's waiters never compute, even past the wait" do
    put(:public_status_cache_ms, 60_000)
    put(:public_status_wait_ms, 50)
    counter = :counters.new(1, [])
    parent = self()

    compute = fn ->
      :counters.add(counter, 1, 1)
      send(parent, :refreshing)

      receive do
        :go -> %{n: 1}
      end
    end

    owner = Task.async(fn -> IslandLimiter.cached_public_status(compute) end)
    assert_receive :refreshing, 30_000

    # The Queue is slow: twelve readers wait past public_status_wait_ms and
    # answer :unavailable without asking it again.
    waiters =
      1..12
      |> Enum.map(fn _ -> Task.async(fn -> IslandLimiter.cached_public_status(compute) end) end)
      |> Enum.map(&Task.await(&1, 60_000))

    assert Enum.uniq(waiters) == [:unavailable]
    assert :counters.get(counter, 1) == 1
    send(owner.pid, :go)
    assert {:ok, %{n: 1}} = Task.await(owner, 30_000)
    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(compute)
    assert :counters.get(counter, 1) == 1
  end

  test "public status cache: a computation that exits is :unavailable cold, the expired entry warm, and stores nothing" do
    put(:public_status_cache_ms, 1)

    exits = fn ->
      exit({:timeout, {GenServer, :call, [Coordinator.Queue, :public_status, 5000]}})
    end

    assert :unavailable = IslandLimiter.cached_public_status(exits)
    assert {:ok, %{n: 0}} = IslandLimiter.cached_public_status(fn -> %{n: 0} end)
    Process.sleep(5)
    assert {:ok, %{n: 0}} = IslandLimiter.cached_public_status(exits)
    # The marker was released and nothing was stored: the next reader refreshes.
    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(fn -> %{n: 1} end)

    put(:public_status_cache_ms, 0)
    assert :unavailable = IslandLimiter.cached_public_status(exits)
  end

  test "public status cache: the ttl counts from when the computation finished" do
    put(:public_status_cache_ms, 1_000)
    counter = :counters.new(1, [])

    compute = fn ->
      :counters.add(counter, 1, 1)
      Process.sleep(1_200)
      %{n: :counters.get(counter, 1)}
    end

    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(compute)
    assert {:ok, %{n: 1}} = IslandLimiter.cached_public_status(compute)
  end
end
