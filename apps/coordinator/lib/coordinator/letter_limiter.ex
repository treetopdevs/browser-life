defmodule Coordinator.LetterLimiter do
  @moduledoc """
  Everything the public garden routes keep *outside* `Coordinator.Queue`, so a
  flood of visitors never queues behind (or in front of) the one serialized
  process that hands islands their work: the per-address letter budget, and a
  short-lived cache of the encoded public view.

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

  ## The cache

  `cached_view/1`, `put_view/3` and `invalidate/1` hold the *encoded JSON* of a
  garden's public view for `garden_cache_ms` (2 s by default; 0 or less turns the
  cache off); `cached_checkpoints/1` and `put_checkpoints/3` hold the
  `%{digest => path}` of its servable checkpoints the same way, so the
  checkpoint route costs the Queue about one call per cache period too. Each
  garden has a generation number that `invalidate/1` bumps. A reader takes the
  generation *before* asking the Queue and an entry carries it, so an answer
  computed before a letter was posted can neither be stored over the
  invalidation nor served after it. A stampede at the instant of expiry is
  possible and accepted: it is a handful of Queue calls, not a flood.

  If the tables are missing (this process is restarting) the limiter fails
  open and the cache reports a miss: a supervisor hiccup must not turn into a
  500 on a public page.
  """
  use GenServer

  alias Coordinator.Clock

  @counters :coordinator_letter_counters
  @views :coordinator_garden_views
  @gardens :coordinator_gardens
  @salt_key :boot_salt
  # How often the sweep runs at most; a shorter window sweeps as often as that.
  @sweep_max_ms 60_000

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
    for {name, {w, h}} <- gardens, do: :ets.insert(@gardens, {name, w, h})

    for name <- :ets.select(@gardens, [{{:"$1", :_, :_}, [], [:"$1"]}]),
        not Map.has_key?(gardens, name),
        do: :ets.delete(@gardens, name)

    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Adds a garden to the registry (the Queue calls it when one is founded)."
  @spec register_garden(String.t(), pos_integer, pos_integer) :: :ok
  def register_garden(name, width, height) do
    :ets.insert(@gardens, {name, width, height})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "`{width, height}` of garden `name`'s world, or `nil` if the Queue holds no such garden."
  @spec garden_world(String.t()) :: {pos_integer, pos_integer} | nil
  def garden_world(name) do
    case :ets.lookup(@gardens, name) do
      [{^name, w, h}] -> {w, h}
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  # ---- client API: the cache ----

  @doc "The cache generation of garden `name`: read it *before* asking the Queue, and hand it back to `put_view/3` or `put_checkpoints/3`."
  @spec generation(String.t()) :: non_neg_integer
  def generation(name) do
    case :ets.lookup(@views, {:gen, name}) do
      [{_, n}] -> n
      _ -> 0
    end
  rescue
    ArgumentError -> 0
  end

  @doc "The cached encoded view of garden `name`, if there is a fresh one."
  @spec cached_view(String.t()) :: {:ok, binary} | :miss
  def cached_view(name), do: cached(name, name)

  @doc "Caches the encoded view `body` of an existing garden `name` for `garden_cache_ms`, unless `invalidate/1` ran since `gen` was read."
  @spec put_view(String.t(), binary, non_neg_integer) :: :ok
  def put_view(name, body, gen) when is_binary(body), do: put(name, name, body, gen)

  @doc "The cached `%{digest => path}` of garden `name`'s servable checkpoints, if there is a fresh one."
  @spec cached_checkpoints(String.t()) :: {:ok, %{String.t() => String.t()}} | :miss
  def cached_checkpoints(name), do: cached(name, {:cps, name})

  @doc "Caches `checkpoints` (as `cached_checkpoints/1` returns them); like `put_view/3`."
  @spec put_checkpoints(String.t(), map, non_neg_integer) :: :ok
  def put_checkpoints(name, checkpoints, gen) when is_map(checkpoints),
    do: put(name, {:cps, name}, checkpoints, gen)

  @doc "Forgets the cached view and checkpoints of `name` and bumps its generation (a letter was posted or dropped, or the garden founded)."
  @spec invalidate(String.t()) :: :ok
  def invalidate(name) do
    :ets.update_counter(@views, {:gen, name}, 1, {{:gen, name}, 0})
    :ets.delete(@views, name)
    :ets.delete(@views, {:cps, name})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @doc "Deletes every counter and cached view (tests); the boot salt and the registry stay."
  @spec reset() :: :ok
  def reset do
    :ets.select_delete(@counters, [{{{:_, :_}, :_}, [], [true]}])
    :ets.delete_all_objects(@views)
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
    :ets.new(@gardens, [:named_table, :public, :set, read_concurrency: true])
    :ets.insert(@counters, {@salt_key, :crypto.strong_rand_bytes(16)})
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
  defp mono, do: System.monotonic_time(:millisecond)
end
