defmodule CoordinatorWeb.OpsStatus do
  @moduledoc """
  The three keys `GET /api/status` (admin only) adds to `Coordinator.Queue.status/0`
  for the operator page (`priv/static/index.html`; docs/ops-dashboard-2026-10-18.md):

    * `limits`: the island table's size (`islands`) and the island limits as
      configured (README "Island limits"): `maxIslands`, `islandMaxPending`,
      `islandPruneAfterMs`, `islandPruneGraceMs`, `budgets` (`join`, `next`,
      `segment`, `requests`, each `{limit, windowMs}`, `limit` `nil` when off)
      and `gardenIslandToken`, whether a garden island token is configured (a
      boolean; the token is never sent). Read from config at call time, with no
      default of its own: a key missing from config is `nil` here and is named
      in `unset` (the config key names, present only when one is missing), since
      its consumer (`Coordinator.IslandLimiter`, `Coordinator.Queue`) then
      applies a built-in default that is not "off" (`island_requests_per_address`
      has none: missing is off, so it is never named). A value that is neither
      an integer nor `nil` is `nil` here and is named in `invalid` (present only
      when one is), so a malformed setting cannot break the response; so is a
      window set to `nil`, since a window has no "off" (IslandLimiter's
      arithmetic on it raises). `Coordinator.ConfigCheck` refuses a malformed
      value at start, so `invalid` can only come from a later
      `Application.put_env/3`.
    * `capabilityNeeds`: experiment name => condition => the sorted
      capabilities an island must advertise to be offered that run's segments.
    * `islandCapabilities`: the islands by the capabilities each last
      advertised (the Queue's recorded copy, `islands[].capabilities`,
      docs/coordinator-hardening-2026-10-18.md): `byCapability`, name =>
      `{islands, live, known}` (`live`: not `stale`; `known`: the Queue gates
      on the name; every such name, and at most 50 others, those on the most
      islands), `omittedNames`, how many other names were left out, and
      `none`, `{islands, live}`, the islands with no recorded capabilities
      (after an upgrade, an island counts here until its next `/api/next`). A recorded list is as of the island's last ask, never a
      promise: work is gated on each request.

  Computed here, from the Queue's status and config, outside the Queue
  process. Nothing counts refusals (429s, the 503 at the island bound) or
  forgotten islands, so neither is reported.

  `needs/2` is a second copy of `Coordinator.Queue`'s private capability
  gating (`gated_experiments/2` and `gated?/3`, see its moduledoc);
  `test/coordinator_web/ops_status_test.exs` holds it to `Queue.next_task/2`.
  """

  # Coordinator.Queue's gating constants, copied (see the moduledoc).
  @pond_capability "ponds-v1"
  @current_capability "ponds-v2"
  @current_conditions ~w(pond-nat pond-shuf)
  @interventions_capability "interventions-v1"
  @breed_capability "breed-v1"
  @sun_capability "sun-v1"
  @breed_condition_prefixes ~w(pond-breed- pond-mass- pond-drift-)

  # The most names `islandCapabilities.byCapability` lists that the Queue does
  # not gate on: each island may record four (`Coordinator.Queue`), so across
  # the island table there could be tens of thousands.
  @shown_unknown_max 50

  @doc "`status` (from `Coordinator.Queue.status/0`) with `limits`, `capabilityNeeds` and `islandCapabilities` added."
  @spec extend(map) :: map
  def extend(%{} = status) do
    islands = Map.get(status, :islands, [])

    status
    |> Map.put(:limits, limits(length(islands)))
    |> Map.put(:capabilityNeeds, capability_needs(Map.get(status, :experiments, %{})))
    |> Map.put(:islandCapabilities, island_capabilities(islands))
  end

  @doc """
  The islands (`Coordinator.Queue.status/0`'s, each with `:stale` and, when
  recorded, `:capabilities`) counted by recorded capability, and those with none.
  """
  @spec island_capabilities([map]) :: map
  def island_capabilities(islands) do
    known = Coordinator.Queue.known_capabilities()

    counted =
      Enum.reduce(islands, %{byCapability: %{}, none: %{islands: 0, live: 0}}, fn island, acc ->
        live = if island[:stale], do: 0, else: 1

        case island[:capabilities] do
          [_ | _] = names ->
            by =
              Enum.reduce(Enum.uniq(names), acc.byCapability, fn name, by ->
                Map.update(
                  by,
                  name,
                  %{islands: 1, live: live, known: name in known},
                  &%{&1 | islands: &1.islands + 1, live: &1.live + live}
                )
              end)

            %{acc | byCapability: by}

          _ ->
            %{acc | none: %{islands: acc.none.islands + 1, live: acc.none.live + live}}
        end
      end)

    # Every gated name, and the `@shown_unknown_max` other names on the most
    # islands (then by name); `omittedNames` counts the rest.
    {gated, other} = Enum.split_with(counted.byCapability, fn {_, c} -> c.known end)

    {shown, omitted} =
      other
      |> Enum.sort_by(fn {name, c} -> {-c.islands, name} end)
      |> Enum.split(@shown_unknown_max)

    %{counted | byCapability: Map.new(gated ++ shown)}
    |> Map.put(:omittedNames, length(omitted))
  end

  # Every config key `limits/1` reads, besides the garden island token.
  @limit_keys ~w(max_islands island_max_pending island_prune_after_ms island_prune_grace_ms
                 island_joins_per_address island_join_window_ms island_next_per_island
                 island_next_window_ms island_segment_requests_per_island
                 island_segment_window_ms island_requests_per_address
                 island_requests_window_ms)a
  # Of those, the one whose consumer's default is "off" (`IslandLimiter.limit(:requests)`).
  @off_by_default [:island_requests_per_address]
  # Of those, the budget windows: `nil` is not "off" for these (`IslandLimiter.window_ms/1`).
  @window_keys ~w(island_join_window_ms island_next_window_ms island_segment_window_ms
                  island_requests_window_ms)a

  @doc "The configured island limits and the island table's size (`islands`)."
  @spec limits(non_neg_integer) :: map
  def limits(islands) do
    token = env(:garden_island_token)

    unset =
      for key <- @limit_keys -- @off_by_default,
          Application.fetch_env(:coordinator, key) == :error,
          do: Atom.to_string(key)

    invalid =
      for key <- @limit_keys,
          {:ok, v} <- [Application.fetch_env(:coordinator, key)],
          not (is_integer(v) or (is_nil(v) and key not in @window_keys)),
          do: Atom.to_string(key)

    %{
      islands: islands,
      maxIslands: int_env(:max_islands),
      islandMaxPending: int_env(:island_max_pending),
      islandPruneAfterMs: int_env(:island_prune_after_ms),
      islandPruneGraceMs: int_env(:island_prune_grace_ms),
      budgets: %{
        join: budget(:island_joins_per_address, :island_join_window_ms),
        next: budget(:island_next_per_island, :island_next_window_ms),
        segment: budget(:island_segment_requests_per_island, :island_segment_window_ms),
        requests: budget(:island_requests_per_address, :island_requests_window_ms)
      },
      # The Queue's own test (`garden_token_ok?/1`): a non-empty string.
      gardenIslandToken: is_binary(token) and token != ""
    }
    |> put_unless_empty(:unset, unset)
    |> put_unless_empty(:invalid, invalid)
  end

  @doc "Experiment name => condition => the sorted capabilities its run needs."
  @spec capability_needs(%{optional(String.t()) => map}) :: map
  def capability_needs(experiments) do
    Map.new(experiments, fn {name, spec} ->
      conditions = if is_list(spec["conditions"]), do: spec["conditions"], else: []
      {name, Map.new(conditions, &{&1, needs(spec, &1)})}
    end)
  end

  @doc "The sorted capabilities a segment of `spec`'s run under `condition` needs."
  @spec needs(map, String.t()) :: [String.t()]
  def needs(spec, condition) do
    preset = spec["presetId"]

    [
      {preset in env_list(:pond_presets), @pond_capability},
      {preset in env_list(:breed_presets), @breed_capability},
      {spec["interventions"] != nil, @interventions_capability},
      {sun_schedule?(spec["interventions"]), @sun_capability},
      {condition in @current_conditions, @current_capability},
      {breed_condition?(condition), @breed_capability}
    ]
    |> Enum.flat_map(fn {needed?, cap} -> if needed?, do: [cap], else: [] end)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp sun_schedule?(list) when is_list(list),
    do: Enum.any?(list, &(is_map(&1) and &1["kind"] == "sun"))

  defp sun_schedule?(_), do: false

  defp breed_condition?(condition),
    do: is_binary(condition) and String.starts_with?(condition, @breed_condition_prefixes)

  defp put_unless_empty(map, _key, []), do: map
  defp put_unless_empty(map, key, keys), do: Map.put(map, key, keys)

  defp budget(limit, window), do: %{limit: int_env(limit), windowMs: int_env(window)}
  # An integer setting as configured; anything else (named in `invalid`) as nil.
  defp int_env(key) do
    case Application.get_env(:coordinator, key) do
      v when is_integer(v) -> v
      _ -> nil
    end
  end

  defp env(key), do: Application.get_env(:coordinator, key)
  defp env_list(key), do: Application.get_env(:coordinator, key, [])
end
