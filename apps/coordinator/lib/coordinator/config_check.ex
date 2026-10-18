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
  """

  @positive ~w(island_join_window_ms island_next_window_ms island_segment_window_ms
               island_requests_window_ms island_limit_table_max max_islands lease_ms
               discovery_lease_ms garden_letter_window_ms garden_letter_table_max)a
  @budget ~w(island_joins_per_address island_next_per_island island_segment_requests_per_island
             island_requests_per_address island_max_pending)a
  @non_negative ~w(island_prune_after_ms island_prune_grace_ms public_status_wait_ms
                   garden_cache_wait_ms garden_letters_per_address garden_refusals_per_address)a
  @any_integer ~w(public_status_cache_ms garden_cache_ms)a

  @doc "Every key this module checks."
  @spec keys() :: [atom]
  def keys, do: @positive ++ @budget ++ @non_negative ++ @any_integer

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

  # `is_integer/1` is false for booleans, floats, strings and everything else.
  defp allowed?(:positive, v), do: is_integer(v) and v > 0
  defp allowed?(:budget, v), do: is_nil(v) or (is_integer(v) and v > 0)
  defp allowed?(:non_negative, v), do: is_integer(v) and v >= 0
  defp allowed?(:any_integer, v), do: is_integer(v)

  defp describe(:positive), do: "a positive whole number"
  defp describe(:budget), do: "nil (off) or a positive whole number"
  defp describe(:non_negative), do: "a whole number of 0 or more"
  defp describe(:any_integer), do: "a whole number (0 or less turns the cache off)"
end
