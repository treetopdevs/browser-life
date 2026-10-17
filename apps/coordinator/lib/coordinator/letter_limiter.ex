defmodule Coordinator.LetterLimiter do
  @moduledoc """
  Everything the public garden routes keep *outside* `Coordinator.Queue`, so a
  flood of visitors never queues behind (or in front of) the one serialized
  process that hands islands their work: the per-address letter budget, and a
  short-lived cache of the encoded public view, plus the registry of gardens.

  This process only owns two public named ETS tables and sweeps one of them;
  every read and write on the hot path goes straight to ETS from the caller
  (`:ets.update_counter/4` is atomic), never through a message to this
  process. It is started by `Coordinator.Application` unconditionally, ahead of
  the endpoint, so it also exists in tests where `start_queue` is false.

  ## The letter budget

  `take/1` charges one letter to an address and `refund/1` gives it back (the
  controller refunds when the Queue refuses the letter, so a visitor is not
  charged for a letter that was never written). The address is whatever term
  the caller supplies (an IP tuple); it is never stored as given. The counter
  key is `{sha256(boot_salt <> :erlang.term_to_binary(bucket)), window}`:

    * `bucket` is the address's *network*, not the address: an IPv6 address is
      masked to its /64 (a home line or a VPS holds 2^64 of them, and a budget
      per /128 is no budget) and an IPv4-mapped IPv6 address is its IPv4
      address. IPv4 is kept whole;
    * the salt is 16 random bytes drawn when this process starts, kept only in
      ETS, never persisted and never logged, so nothing recorded here can be
      linked back to an address after a restart (and a restart forgets the
      budgets, which is the privacy the README promises);
    * `window` is `div(Coordinator.Clock.now(), garden_letter_window_ms)`, a
      fixed window (not a sliding one: an address is limited to
      `garden_letters_per_address` letters per window, and the window's end is
      the exact `Retry-After`);
    * old windows are swept on a timer, so an address lives in memory for at
      most about one window. The table is also capped
      (`garden_letter_table_max` rows): past the cap a *new* address is refused
      until the sweep (addresses already counted keep working), so a flood of
      distinct addresses can fill memory to the cap and no further. A row that
      a refund brings back to zero is deleted at once.

  ### Refusals

  A refund makes a refused letter free, which would also make a stream of
  letters the Queue is bound to refuse (a full queue, a stopped garden) free
  to send, and every one of them is a call into the one serialized process
  that hands islands their work. So a refusal is metered separately:
  `refuse/1` refunds the letter and charges one *refusal* to the same
  address, and once an address has `garden_refusals_per_address` refusals in
  the window `take/1` answers 429 before the Queue is reached. Whatever can be
  answered without the Queue (a garden that does not exist, a centre outside
  its world; see `garden_world/1`) never charges anything.

  Config (`garden_letters_per_address`, `garden_refusals_per_address`,
  `garden_letter_window_ms`, `garden_letter_table_max`) is read at call time,
  never at compile time.

  ## The garden registry

  The Queue publishes the name and world size of every garden it holds
  (`set_gardens/1` when it starts, `register_garden/3` when one is founded), so
  the controller can answer an unknown name or a centre outside the world
  without a Queue call, and so a name an attacker chooses never becomes a key
  in any table: the cache below only ever holds gardens that exist.

  The registry is one `:persistent_term` (the whole `%{name => {w, h}}` map),
  not a table of this process: it is written only by the Queue, once at start
  and once per founding, and it must survive a restart of this process (the
  Queue would not republish it, and every garden would 404). A Queue restart
  replaces it whole.

  ## The cache

  `cached_view/1`, `put_view/3` and `invalidate/1` hold the *encoded JSON* of a
  garden's public view for `garden_cache_ms` (2 s by default; 0 or less turns the
  cache off); `cached_checkpoints/1` and `put_checkpoints/3` hold the
  `%{digest => path}` of its servable checkpoints the same way, so the
  checkpoint route costs the Queue about one call per cache period too. Each
  garden has a generation number that `invalidate/1` bumps. A reader takes the
  generation *before* asking the Queue and an entry carries it, so an answer
  computed before a letter was posted can neither be stored over the
  invalidation nor served after it.

  A generation is `{incarnation, n}`: `incarnation` is drawn when this process
  creates its tables, so the counters a restart starts again from zero can
  never make an answer read before the restart look current after it.

  `fetch_view/2` and `fetch_checkpoints/2` are what the controller uses: they
  coalesce misses so a crowd arriving at once costs the Queue one call, not one
  each. The one request that wins `:ets.insert_new/2` on a refresh marker
  checks the cache again (it may have been filled since it looked) and only
  then asks the Queue; meanwhile, if an entry of the current generation exists
  but has expired, everyone else is served it as it is; if there is none (a
  cold cache, or just after an invalidation), everyone else polls for the
  winner's entry for up to `garden_cache_wait_ms` (2 s by default) and then
  answers `:busy` (the controller's 503 with `Retry-After: 1`). Nobody but the
  marker's holder asks the Queue while the marker is live; a marker older than
  5 s (its refresher crashed or is stuck) may be taken over by one caller.
  What remains stale: an expired entry may be served for as long as the
  refresh takes (on top of `garden_cache_ms`), but never across an
  invalidation, since `invalidate/1` deletes the entry and the marker and bumps
  the generation every read checks.

  If the tables are missing (this process is restarting) the limiter fails
  open and the cache reports a miss: a supervisor hiccup must not turn into a
  500 on a public page.
  """
  use GenServer

  alias Coordinator.Clock

  @counters :coordinator_letter_counters
  @views :coordinator_garden_views
  @gardens {__MODULE__, :gardens}
  @salt_key :boot_salt
  # Kept beside the salt, so `reset/0` (which clears the views) keeps it.
  @incarnation_key :incarnation
  # How often the sweep runs at most; a shorter window sweeps as often as that.
  @sweep_max_ms 60_000
  # A refresh marker older than this belongs to a refresher that died.
  @marker_ms 5_000
  # How long a request on a cold key waits for another's refresh (default).
  @wait_ms 2_000
  @poll_ms 10

  # ---- client API: the budget ----

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  Charges one letter to `address`. `{:ok, token}` (give the token to `refund/1`
  or `refuse/1` if the letter is then not written) or `{:error, retry_after_ms}`
  when the address has used its `garden_letters_per_address` letters in this
  window, has spent its `garden_refusals_per_address` refusals, or is new while
  the counter table is full; a refused attempt never counts.
  """
  @spec take(term) :: {:ok, term} | {:error, pos_integer}
  def take(address) do
    now = Clock.now()
    window_ms = window_ms()
    window = Integer.floor_div(now, window_ms)
    reset_in = max((window + 1) * window_ms - now, 1)
    hash = address_hash(address)
    key = {hash, window}
    refusal_key = {{:refusal, hash}, window}

    cond do
      count(refusal_key) >= refusal_limit() ->
        {:error, reset_in}

      full_for_new?(key) ->
        {:error, reset_in}

      true ->
        if :ets.update_counter(@counters, key, {2, 1}, {key, 0}) <= limit() do
          {:ok, {:token, key, refusal_key}}
        else
          decrement(key)
          {:error, reset_in}
        end
    end
  rescue
    # Tables gone (restarting): fail open, nothing to refund.
    ArgumentError -> {:ok, nil}
  end

  @doc "Gives back one letter charged by `take/1`; never takes a counter below zero."
  @spec refund(term) :: :ok
  def refund({:token, key, _refusal_key}) do
    decrement(key)
    :ok
  rescue
    ArgumentError -> :ok
  end

  def refund(_token), do: :ok

  @doc """
  The Queue refused a letter `take/1` had charged: gives the letter back and
  charges the address one refusal instead (see the moduledoc, "Refusals").
  """
  @spec refuse(term) :: :ok
  def refuse({:token, key, refusal_key}) do
    decrement(key)
    :ets.update_counter(@counters, refusal_key, {2, 1}, {refusal_key, 0})
    :ok
  rescue
    ArgumentError -> :ok
  end

  def refuse(_token), do: :ok

  @doc """
  The network an address is budgeted as: an IPv6 address is its /64 (the low
  four groups zeroed), an IPv4-mapped IPv6 address is the IPv4 address, anything
  else is itself.
  """
  @spec network(term) :: term
  def network({0, 0, 0, 0, 0, 0xFFFF, hi, lo}),
    do: {div(hi, 256), rem(hi, 256), div(lo, 256), rem(lo, 256)}

  def network({a, b, c, d, _, _, _, _}), do: {a, b, c, d, 0, 0, 0, 0}
  def network(other), do: other

  # ---- client API: the registry of gardens ----

  @doc "Replaces the registry with `gardens` (`%{name => {width, height}}`); the Queue calls it when it starts."
  @spec set_gardens(%{String.t() => {pos_integer, pos_integer}}) :: :ok
  def set_gardens(gardens) when is_map(gardens) do
    :persistent_term.put(@gardens, gardens)
    :ok
  end

  @doc "Adds a garden to the registry (the Queue calls it when one is founded)."
  @spec register_garden(String.t(), pos_integer, pos_integer) :: :ok
  def register_garden(name, width, height) do
    # Read-modify-write is safe: the Queue is the only writer.
    :persistent_term.put(@gardens, Map.put(gardens(), name, {width, height}))
    :ok
  end

  @doc "`{width, height}` of garden `name`'s world, or `nil` if the Queue holds no such garden."
  @spec garden_world(String.t()) :: {pos_integer, pos_integer} | nil
  def garden_world(name), do: Map.get(gardens(), name)

  defp gardens, do: :persistent_term.get(@gardens, %{})

  # ---- client API: the cache ----

  @typedoc "A cache generation: this process's incarnation and a count of invalidations."
  @type gen :: {term, non_neg_integer}

  @doc "The cache generation of garden `name`: read it *before* asking the Queue, and hand it back to `put_view/3` or `put_checkpoints/3`."
  @spec generation(String.t()) :: gen
  def generation(name) do
    [{_, incarnation}] = :ets.lookup(@counters, @incarnation_key)

    case :ets.lookup(@views, {:gen, name}) do
      [{_, n}] -> {incarnation, n}
      _ -> {incarnation, 0}
    end
  rescue
    # Tables gone (restarting): a generation no entry can carry.
    _ in [ArgumentError, MatchError] -> {nil, 0}
  end

  @doc "The cached encoded view of garden `name`, if there is a fresh one."
  @spec cached_view(String.t()) :: {:ok, binary} | :miss
  def cached_view(name), do: cached(name, name)

  @doc "Caches the encoded view `body` of an existing garden `name` for `garden_cache_ms`, unless `invalidate/1` ran since `gen` was read."
  @spec put_view(String.t(), binary, gen) :: :ok
  def put_view(name, body, gen) when is_binary(body), do: put(name, name, body, gen)

  @doc "The cached `%{digest => path}` of garden `name`'s servable checkpoints, if there is a fresh one."
  @spec cached_checkpoints(String.t()) :: {:ok, %{String.t() => String.t()}} | :miss
  def cached_checkpoints(name), do: cached(name, {:cps, name})

  @doc "Caches `checkpoints` (as `cached_checkpoints/1` returns them); like `put_view/3`."
  @spec put_checkpoints(String.t(), map, gen) :: :ok
  def put_checkpoints(name, checkpoints, gen) when is_map(checkpoints),
    do: put(name, {:cps, name}, checkpoints, gen)

  @doc """
  The encoded view of garden `name`, from the cache or (coalesced, see the
  moduledoc) from `compute`, which returns `{:cache, body}` (stored) or
  `{:skip, value}` (returned as it is, not stored); `:busy` when another
  request has held the refresh for longer than the wait. With the cache off
  every call is `compute`.
  """
  @spec fetch_view(String.t(), (-> {:cache, binary} | {:skip, term})) :: term | :busy
  def fetch_view(name, compute), do: fetch(name, name, compute)

  @doc "The servable checkpoints of garden `name`, like `fetch_view/2`."
  @spec fetch_checkpoints(String.t(), (-> {:cache, map} | {:skip, term})) :: term | :busy
  def fetch_checkpoints(name, compute), do: fetch(name, {:cps, name}, compute)

  @doc "Forgets the cached view and checkpoints of `name` and bumps its generation (a letter was posted or dropped, or the garden founded)."
  @spec invalidate(String.t()) :: :ok
  def invalidate(name) do
    :ets.update_counter(@views, {:gen, name}, 1, {{:gen, name}, 0})
    :ets.delete(@views, name)
    :ets.delete(@views, {:cps, name})
    # A refresh begun before this cannot store its answer (the generation
    # moved), so nobody should wait for it.
    :ets.delete(@views, {:refresh, name})
    :ets.delete(@views, {:refresh, {:cps, name}})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Deletes every counter, cached view and refresh marker, and starts a new incarnation of the generations (tests); the boot salt stays, and so does the registry (it is not in these tables)."
  @spec reset() :: :ok
  def reset do
    :ets.select_delete(@counters, [{{{:_, :_}, :_}, [], [true]}])
    :ets.delete_all_objects(@views)
    :ets.insert(@counters, {@incarnation_key, make_ref()})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Deletes the counters of windows before the current one (also run on a timer)."
  @spec sweep() :: :ok
  def sweep do
    current = Integer.floor_div(Clock.now(), window_ms())
    :ets.select_delete(@counters, [{{{:_, :"$1"}, :_}, [{:<, :"$1", current}], [true]}])
    :ok
  rescue
    ArgumentError -> :ok
  end

  # ---- server ----

  @impl true
  def init(_opts) do
    :ets.new(@counters, [:named_table, :public, :set, write_concurrency: true])
    :ets.new(@views, [:named_table, :public, :set, read_concurrency: true])
    :ets.insert(@counters, {@salt_key, :crypto.strong_rand_bytes(16)})
    :ets.insert(@counters, {@incarnation_key, make_ref()})
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

  defp schedule_sweep, do: Process.send_after(self(), :sweep, min(window_ms(), @sweep_max_ms))

  defp cached(name, key) do
    if ttl() > 0 do
      case :ets.lookup(@views, key) do
        [{^key, value, expires, gen}] ->
          if mono() < expires and gen == generation(name), do: {:ok, value}, else: :miss

        _ ->
          :miss
      end
    else
      :miss
    end
  rescue
    ArgumentError -> :miss
  end

  defp put(name, key, value, gen) do
    ttl = ttl()

    if ttl > 0 and gen == generation(name),
      do: :ets.insert(@views, {key, value, mono() + ttl, gen})

    :ok
  rescue
    ArgumentError -> :ok
  end

  defp fetch(name, key, compute) do
    if ttl() > 0, do: coalesce(name, key, compute), else: compute.() |> elem(1)
  end

  defp coalesce(name, key, compute) do
    case entry(name, key) do
      {:fresh, value} ->
        value

      {:stale, value} ->
        # Someone else is refreshing: the expired entry (same generation) will do.
        case claim(key) do
          {:won, marker} -> refresh(name, key, compute, marker)
          :lost -> value
        end

      :none ->
        wait(name, key, compute, mono() + wait_ms())
    end
  end

  # Cold key: refresh if we can claim it, else wait for whoever did. Stops
  # waiting as soon as an entry appears or the marker is gone (its refresher
  # finished without storing, e.g. an invalidation moved the generation; then
  # one waiter claims it). While a live marker stands nobody else asks the
  # Queue: past the wait the answer is `:busy`.
  defp wait(name, key, compute, deadline) do
    case entry(name, key) do
      {_, value} ->
        value

      :none ->
        case claim(key) do
          {:won, marker} ->
            refresh(name, key, compute, marker)

          :lost ->
            if mono() < deadline do
              Process.sleep(@poll_ms)
              wait(name, key, compute, deadline)
            else
              :busy
            end
        end
    end
  end

  defp refresh(name, key, compute, marker) do
    # Read before the Queue is asked: an invalidation meanwhile refuses the put.
    gen = generation(name)

    try do
      # Someone may have filled the cache between our look and our claim.
      case entry(name, key) do
        {:fresh, value} ->
          value

        _ ->
          case compute.() do
            {:cache, value} ->
              put(name, key, value, gen)
              value

            {:skip, value} ->
              value
          end
      end
    after
      # Exactly our marker: a newer one (after an invalidation) is not ours.
      release(marker)
    end
  end

  defp release(nil), do: :ok

  defp release(marker) do
    :ets.delete_object(@views, marker)
    :ok
  rescue
    ArgumentError -> :ok
  end

  # `{:won, marker}` if this caller is now the one refreshing `key`; `:lost` if
  # a live refresh holds it. A marker older than `@marker_ms` is taken over.
  defp claim(key) do
    marker = {{:refresh, key}, mono(), make_ref()}

    if :ets.insert_new(@views, marker) do
      {:won, marker}
    else
      case :ets.lookup(@views, {:refresh, key}) do
        [{_, at, _} = old] when at + @marker_ms <= elem(marker, 1) ->
          :ets.delete_object(@views, old)
          if :ets.insert_new(@views, marker), do: {:won, marker}, else: :lost

        [] ->
          if :ets.insert_new(@views, marker), do: {:won, marker}, else: :lost

        _ ->
          :lost
      end
    end
  rescue
    # Tables gone (restarting): no cache to coalesce on, ask directly.
    ArgumentError -> {:won, nil}
  end

  # The entry of `key` if it is of the current generation, fresh or expired.
  defp entry(name, key) do
    case :ets.lookup(@views, key) do
      [{^key, value, expires, gen}] ->
        cond do
          gen != generation(name) -> :none
          mono() < expires -> {:fresh, value}
          true -> {:stale, value}
        end

      _ ->
        :none
    end
  rescue
    ArgumentError -> :none
  end

  defp count(key) do
    case :ets.lookup(@counters, key) do
      [{_, n}] -> n
      [] -> 0
    end
  end

  # A counter is only ever created by `take/1`, so a new address is the only
  # thing the cap can stop.
  defp full_for_new?(key),
    do: :ets.info(@counters, :size) >= table_max() and not :ets.member(@counters, key)

  # One back, never below zero; a row at zero is deleted (the delete matches
  # only a row that is exactly zero, so a concurrent charge keeps its row).
  defp decrement(key) do
    :ets.update_counter(@counters, key, {2, -1, 0, 0}, {key, 0})
    :ets.select_delete(@counters, [{{key, 0}, [], [true]}])
  end

  defp address_hash(address) do
    [{@salt_key, salt}] = :ets.lookup(@counters, @salt_key)
    :crypto.hash(:sha256, [salt, :erlang.term_to_binary(network(address))])
  end

  defp limit, do: Application.get_env(:coordinator, :garden_letters_per_address, 3)
  defp refusal_limit, do: Application.get_env(:coordinator, :garden_refusals_per_address, 20)
  defp table_max, do: Application.get_env(:coordinator, :garden_letter_table_max, 200_000)

  defp window_ms,
    do: max(Application.get_env(:coordinator, :garden_letter_window_ms, 3_600_000), 1)

  defp ttl, do: Application.get_env(:coordinator, :garden_cache_ms, 2_000)
  defp wait_ms, do: Application.get_env(:coordinator, :garden_cache_wait_ms, @wait_ms)
  defp mono, do: System.monotonic_time(:millisecond)
end
