defmodule Coordinator.ConfigCheck do
  @moduledoc """
  Refuses to start the coordinator on a limit, window, cap or cache setting of
  the wrong shape (docs/coordinator-hardening-2026-10-18.md, item 1).

  `Coordinator.Application.start/2` calls `check!/0` before it starts any
  child, in every environment, so a value such as
  `config :coordinator, island_next_window_ms: 1.5` (or `nil`) stops the boot
  with a message that names the key, instead of crashing
  `Coordinator.IslandLimiter` on its first request. The environment variables
  that set some of these in production (`BL_ISLAND_JOINS_PER_ADDRESS`,
  `BL_MAX_ISLANDS`, `BL_DISCOVERY_LEASE_MS`) are refused earlier, by name, in
  `config/runtime.exs`.

  A key that is absent passes: its consumer applies its own built-in default.
  Only numeric keys are checked, so a message can never print a token. The
  check runs once, at start: a value changed later with `Application.put_env/3`
  is not checked again (`CoordinatorWeb.OpsStatus`'s `limits.invalid` still
  reports such a change; its `limits.unset` names an absent key, which passes
  here, so it can appear from the first boot).

  `true` and `false` are never integers here. An island budget limit of `0` is
  refused: `nil` switches a budget off, as `"off"` (or `"0"`) does in the
  environment variables, so a config `0` that would refuse every request is
  not confused with it. The garden letter counts are different: they have no
  "off", and `garden_letters_per_address: 0` (or `garden_refusals_per_address:
  0`) closes the letter box, as it did before this check, so `0` passes there.
  A window of `0`, which consumers used to clamp to 1 ms, is refused.

  The garden's `garden_hands_sweep_ms` and `garden_call_timeout_ms` must be
  positive whole numbers here. The garden food keys must sit in their ranges
  (`food_range/1`: `garden_food_asks` 2..1000, `garden_food_every_days`
  1..365, `garden_food_amount` 1..64, `garden_food_radius` 1..32), so an
  out-of-range value is refused at boot, by name, not first when a garden is
  founded with food. `Coordinator.Queue`'s `garden_spec` reads the same
  ranges from `food_range/1` for each garden founded with food, where a
  keeper's own `foodAsks` and `foodEveryDays` replace the first two.

  The garden meteor keys (docs/garden-meteor-2026-10-18.md) are ranged the
  same way (`range/1`: `garden_meteor_asks` 2..1000, `garden_meteor_every_days`
  1..365, `garden_meteor_radius` 33..255), and `garden_spec` reads them from
  `range/1` for each garden founded with meteor.
  """

  # The one table of the garden food ranges (see `food_range/1`).
  @food_ranges %{
    garden_food_asks: 2..1000,
    garden_food_every_days: 1..365,
    garden_food_amount: 1..64,
    garden_food_radius: 1..32
  }
  # The garden meteor ranges (see `range/1`).
  @meteor_ranges %{
    garden_meteor_asks: 2..1000,
    garden_meteor_every_days: 1..365,
    garden_meteor_radius: 33..255
  }
  @ranges Map.merge(@food_ranges, @meteor_ranges)
  @food_ranged Map.keys(@food_ranges)
  @ranged Map.keys(@ranges)

  @positive ~w(island_join_window_ms island_next_window_ms island_segment_window_ms
               island_requests_window_ms island_limit_table_max max_islands lease_ms
               discovery_lease_ms garden_letter_window_ms garden_letter_table_max
               garden_hands_sweep_ms garden_call_timeout_ms)a
  @budget ~w(island_joins_per_address island_next_per_island island_segment_requests_per_island
             island_requests_per_address island_max_pending)a
  @non_negative ~w(island_prune_after_ms island_prune_grace_ms public_status_wait_ms
                   garden_cache_wait_ms garden_letters_per_address garden_refusals_per_address)a
  @any_integer ~w(public_status_cache_ms garden_cache_ms)a

  @doc "Every key this module checks."
  @spec keys() :: [atom]
  def keys, do: @positive ++ @budget ++ @non_negative ++ @any_integer ++ @ranged

  @doc """
  The allowed range of a garden food key (`garden_food_asks`,
  `garden_food_every_days`, `garden_food_amount`, `garden_food_radius`), as
  checked at boot. `Coordinator.Queue`'s `garden_spec` checks a garden's
  `foodAsks`, `foodEveryDays`, amount and radius against it too.
  """
  @spec food_range(atom) :: Range.t()
  def food_range(key) when key in @food_ranged, do: range(key)

  @doc """
  The allowed range of a ranged garden key, food's (`food_range/1`) or the
  meteor's (`garden_meteor_asks`, `garden_meteor_every_days`,
  `garden_meteor_radius`), as checked at boot and by `garden_spec`.
  """
  @spec range(atom) :: Range.t()
  def range(key) when key in @ranged, do: Map.fetch!(@ranges, key)

  @doc """
  The errors in `env` (a keyword list or map of `:coordinator` config), one
  message per bad key, in `keys/0` order; `[]` when every checked key present
  has an allowed value.
  """
  @spec errors(Enumerable.t()) :: [String.t()]
  def errors(env) do
    env = Map.new(env)

    # A generator, not a `value = ...` filter: a filter that is `nil` or
    # `false` drops the key, and those are exactly values to refuse.
    for key <- keys(),
        {:ok, value} <- [Map.fetch(env, key)],
        not allowed?(shape(key), value) do
      "config :coordinator, #{key}: #{inspect(value)} is not #{describe(shape(key))}"
    end
  end

  @doc "Raises one `RuntimeError` naming every bad key in the `:coordinator` env; `:ok` otherwise."
  @spec check!() :: :ok
  def check! do
    case errors(Application.get_all_env(:coordinator)) do
      [] ->
        :ok

      errors ->
        raise "the coordinator will not start with these settings:\n  " <>
                Enum.join(errors, "\n  ")
    end
  end

  defp shape(key) when key in @positive, do: :positive
  defp shape(key) when key in @budget, do: :budget
  defp shape(key) when key in @non_negative, do: :non_negative
  defp shape(key) when key in @any_integer, do: :any_integer
  defp shape(key) when key in @ranged, do: {:range, range(key)}

  # `is_integer/1` is false for booleans, floats, strings and everything else.
  defp allowed?(:positive, v), do: is_integer(v) and v > 0
  defp allowed?(:budget, v), do: is_nil(v) or (is_integer(v) and v > 0)
  defp allowed?(:non_negative, v), do: is_integer(v) and v >= 0
  defp allowed?(:any_integer, v), do: is_integer(v)
  defp allowed?({:range, r}, v), do: is_integer(v) and v in r

  defp describe(:positive), do: "a positive whole number"
  defp describe(:budget), do: "nil (off) or a positive whole number"
  defp describe(:non_negative), do: "a whole number of 0 or more"
  defp describe(:any_integer), do: "a whole number (0 or less turns the cache off)"
  defp describe({:range, r}), do: "a whole number in #{inspect(r)}"
end
