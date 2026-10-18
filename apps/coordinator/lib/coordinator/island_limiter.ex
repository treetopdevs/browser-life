defmodule Coordinator.IslandLimiter do
  @moduledoc """
  The island routes' budgets and the public status cache, kept *outside*
  `Coordinator.Queue` the way `Coordinator.LetterLimiter` keeps the garden's:
  a refused request never reaches the one serialized process that hands
  islands their work, and a flood of status reads costs it about one call per
  cache period.

  This process owns one public named ETS table and sweeps it; every read and
  write on the hot path goes straight to ETS from the caller
  (`:ets.update_counter/4` is atomic). It is started by
  `Coordinator.Application` unconditionally, so it also exists in tests where
  `start_queue` is false.

  ## Budgets

  `take/2` charges one request of a kind to a key:

    * `:join` (`POST /api/islands`): `island_joins_per_address` per
      `island_join_window_ms`, keyed on the client address;
    * `:next` (`POST /api/next`): `island_next_per_island` per
      `island_next_window_ms`, keyed on the *authenticated island id* (charged
      only after the island authenticates, so a 401 costs nothing);
    * `:segment` (heartbeat, complete, reject, fail, checkpoint and file
      uploads, checkpoint downloads, an island's file downloads): `island_segment_requests_per_island` per
      `island_segment_window_ms`, keyed on the *authenticated island id*, like
      `:next` (most of these rewrite the Queue's whole state file);
    * `:requests` (every island route but file downloads): `island_requests_per_address` per
      `island_requests_window_ms`, keyed on the client address; `nil` (the
      default) turns it off.

  Any limit may be `nil` (off); `:join` is off in production until the proxy
  passes on client addresses (config/prod.exs).

  Addresses are budgeted exactly as the letter budget does it: the key is
  `{sha256(boot_salt <> :erlang.term_to_binary(bucket)), kind, ends_at}`, where
  `bucket` is `Coordinator.LetterLimiter.network/1` of the address (an IPv6
  address is its /64, an IPv4-mapped address its IPv4 address) and the island
  id for `:next` and `:segment`. The salt is 16 random bytes drawn when this process starts,
  kept only in ETS, never persisted or logged, so nothing here can be linked
  back to an address after a restart. `ends_at` is the end (ms, on
  `Coordinator.Clock`) of the fixed window the request falls in, so the
  `Retry-After` is `ends_at - now` and one sweep drops every past window of
  every kind. Windows are fixed, not sliding, as the letter budget's are: a
  client can spend a budget at the end of one window and again at the start of
  the next. The table is capped (`island_limit_table_max` rows): past the cap
  a *new key* (address or island id) is refused until the sweep (keys
  already counted keep working), so a flood of distinct addresses (an IPv6 attacker rotating /64s)
  can lock out new joiners until its window ends, as with the letter budget.
  The cap is soft: first-seen addresses arriving at the same instant may each
  pass the check before any is inserted. The cap applies to island-id keys too:
  `max_islands` bounds the islands alive at once, not the ids seen in one
  window (an island forgotten at the bound leaves its counters until the
  sweep), so without it a stream of join-then-next could grow the table without
  limit. The default cap (200,000) is ten times the default island bound, with
  at most two island-keyed rows per island per window.

  Config is read at call time with `Application.get_env/3`, never at compile
  time. If the table is missing (this process is restarting) every budget
  fails open and the cache reports a miss.

  ## The public status cache

  `cached_public_status/1` holds the public status body for
  `public_status_cache_ms` (2 s by default; 0 or less turns it off), counted
  from when the computation *finished*. Misses are coalesced the way
  `Coordinator.LetterLimiter`'s garden views are: the one caller that wins
  `:ets.insert_new/2` on a refresh marker computes; meanwhile everyone else is
  served the expired entry if there is one, or (a cold cache) polls for the
  winner's entry for up to `public_status_wait_ms` (2 s) and only then computes
  itself, so `/healthz` never answers an error for a slow Queue. A marker older
  than 5 s belongs to a refresher that died and may be taken over.
  """
  use GenServer

  alias Coordinator.{Clock, LetterLimiter}

  @table :coordinator_island_limits
  @salt_key :boot_salt
  @status_key :public_status
  @marker_key {:refresh, :public_status}
  # A refresh marker older than this belongs to a refresher that died.
  @marker_ms 5_000
  @poll_ms 10
  @sweep_max_ms 60_000
  @kinds [:join, :next, :segment, :requests]
  # Kinds keyed on an authenticated island id rather than a client address.
  @island_kinds [:next, :segment]

  @type kind :: :join | :next | :segment | :requests

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  Charges one request of `kind` to `key` (an IP tuple for `:join` and
  `:requests`, an island id for `:next` and `:segment`): `:ok`, or `{:error, retry_after_ms}`
  when the key has used its budget in this window (or is a new key while
  the table is full). A refused request never counts. A kind whose limit is
  `nil` is always `:ok` and stores nothing.
  """
  @spec take(kind, term) :: :ok | {:error, pos_integer}
  def take(kind, key) when kind in @kinds do
    case limit(kind) do
      nil ->
        :ok

      limit ->
        now = Clock.now()
        window_ms = window_ms(kind)
        ends_at = (Integer.floor_div(now, window_ms) + 1) * window_ms
        reset_in = max(ends_at - now, 1)
        row = {hash(kind, key), kind, ends_at}

        cond do
          full_for_new?(row) ->
            {:error, reset_in}

          :ets.update_counter(@table, row, {2, 1}, {row, 0}) <= limit ->
            :ok

          true ->
            # Over: give the charge back, so a refused request never counts.
            :ets.update_counter(@table, row, {2, -1, 0, 0}, {row, 0})
            {:error, reset_in}
        end
    end
  rescue
    # Table gone (restarting): fail open.
    ArgumentError -> :ok
  end

  @doc """
  The public status body: the cached one while it is fresh, else (coalesced,
  see the moduledoc) `compute.()`, stored for `public_status_cache_ms` from
  when it finished. With the cache off, every call is `compute.()`.
  """
  @spec cached_public_status((-> map)) :: map
  def cached_public_status(compute) do
    ttl = Application.get_env(:coordinator, :public_status_cache_ms, 2_000)

    if ttl > 0 do
      case status_entry() do
        {:fresh, body} ->
          body

        {:stale, body} ->
          case claim() do
            {:won, marker} -> refresh(compute, ttl, marker)
            :lost -> body
          end

        :none ->
          wait(compute, ttl, mono() + wait_ms())
      end
    else
      compute.()
    end
  end

  @doc "Deletes every counter and the cached status (tests); the boot salt stays."
  @spec reset() :: :ok
  def reset do
    :ets.select_delete(@table, [{{{:_, :_, :_}, :_}, [], [true]}])
    :ets.delete(@table, @status_key)
    :ets.delete(@table, @marker_key)
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Deletes the counters of windows that have ended (also run on a timer)."
  @spec sweep() :: :ok
  def sweep do
    now = Clock.now()
    :ets.select_delete(@table, [{{{:_, :_, :"$1"}, :_}, [{:"=<", :"$1", now}], [true]}])
    :ok
  rescue
    ArgumentError -> :ok
  end

  # ---- server ----

  @impl true
  def init(_opts) do
    # Built under a private name with the salt in it, then renamed, so no
    # reader ever sees the table without its salt.
    building =
      :ets.new(:coordinator_island_limits_building, [
        :named_table,
        :public,
        :set,
        write_concurrency: true,
        read_concurrency: true
      ])

    :ets.insert(building, {@salt_key, :crypto.strong_rand_bytes(16)})
    :ets.rename(building, @table)
    schedule_sweep()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:sweep, state) do
    sweep()
    schedule_sweep()
    {:noreply, state}
  end

  def handle_info(_other, state), do: {:noreply, state}

  # ---- helpers ----

  defp schedule_sweep do
    shortest = @kinds |> Enum.map(&window_ms/1) |> Enum.min()
    Process.send_after(self(), :sweep, min(shortest, @sweep_max_ms))
  end

  # Cold cache: refresh if we can claim it, else wait for whoever did; past the
  # wait, compute anyway (an answer, never an error, for /healthz).
  defp wait(compute, ttl, deadline) do
    case status_entry() do
      {_, body} ->
        body

      :none ->
        case claim() do
          {:won, marker} ->
            refresh(compute, ttl, marker)

          :lost ->
            if mono() < deadline do
              Process.sleep(@poll_ms)
              wait(compute, ttl, deadline)
            else
              compute.()
            end
        end
    end
  end

  defp refresh(compute, ttl, marker) do
    # Someone may have filled the cache between our look and our claim.
    case status_entry() do
      {:fresh, body} ->
        body

      _ ->
        body = compute.()
        store({@status_key, body, mono() + ttl})
        body
    end
  after
    release(marker)
  end

  defp status_entry do
    case lookup(@status_key) do
      [{_, body, expires}] -> if mono() < expires, do: {:fresh, body}, else: {:stale, body}
      _ -> :none
    end
  end

  # `{:won, marker}` if this caller is now the one refreshing; `:lost` if a live
  # refresh holds it. A marker older than `@marker_ms` is taken over.
  defp claim do
    marker = {@marker_key, mono(), make_ref()}

    if :ets.insert_new(@table, marker) do
      {:won, marker}
    else
      case :ets.lookup(@table, @marker_key) do
        [{_, at, _} = old] when at + @marker_ms <= elem(marker, 1) ->
          :ets.delete_object(@table, old)
          if :ets.insert_new(@table, marker), do: {:won, marker}, else: :lost

        [] ->
          if :ets.insert_new(@table, marker), do: {:won, marker}, else: :lost

        _ ->
          :lost
      end
    end
  rescue
    # Table gone (restarting): no cache to coalesce on, ask directly.
    ArgumentError -> {:won, nil}
  end

  defp release(nil), do: :ok

  defp release(marker) do
    :ets.delete_object(@table, marker)
    :ok
  rescue
    ArgumentError -> :ok
  end

  defp hash(kind, key) do
    bucket = if kind in @island_kinds, do: {:island, key}, else: LetterLimiter.network(key)

    case :ets.lookup(@table, @salt_key) do
      [{@salt_key, salt}] -> :crypto.hash(:sha256, [salt, :erlang.term_to_binary(bucket)])
      [] -> raise ArgumentError, "the island limits have no salt yet"
    end
  end

  # The counter rows: the table's size less the salt, the cached status and
  # its refresh marker.
  defp counter_rows do
    others = Enum.count([@status_key, @marker_key], &:ets.member(@table, &1))

    case :ets.info(@table, :size) do
      # The table went away between the two looks (this process restarting):
      # the same ArgumentError as any other access, so `take/2` fails open.
      :undefined -> raise ArgumentError, "the island limits table is gone"
      size -> size - 1 - others
    end
  end

  defp full_for_new?(row), do: counter_rows() >= table_max() and not :ets.member(@table, row)

  defp lookup(key) do
    :ets.lookup(@table, key)
  rescue
    ArgumentError -> []
  end

  defp store(row) do
    :ets.insert(@table, row)
  rescue
    ArgumentError -> true
  end

  defp limit(:join), do: Application.get_env(:coordinator, :island_joins_per_address, 20)
  defp limit(:next), do: Application.get_env(:coordinator, :island_next_per_island, 120)

  defp limit(:segment),
    do: Application.get_env(:coordinator, :island_segment_requests_per_island, 600)

  defp limit(:requests), do: Application.get_env(:coordinator, :island_requests_per_address)

  defp window_ms(:join), do: window(:island_join_window_ms, 3_600_000)
  defp window_ms(:next), do: window(:island_next_window_ms, 60_000)
  defp window_ms(:segment), do: window(:island_segment_window_ms, 60_000)
  defp window_ms(:requests), do: window(:island_requests_window_ms, 60_000)
  defp window(key, default), do: max(Application.get_env(:coordinator, key, default), 1)

  defp wait_ms, do: Application.get_env(:coordinator, :public_status_wait_ms, 2_000)
  defp table_max, do: Application.get_env(:coordinator, :island_limit_table_max, 200_000)
  defp mono, do: System.monotonic_time(:millisecond)
end
