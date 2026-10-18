defmodule Coordinator.Garden do
  @moduledoc """
  A garden: one shared, open-ended world tended by volunteer islands, paced by
  real dawns and written to by visitors' letters (README "The garden", contract
  `garden-v1`). Underneath it is an ordinary one-run experiment (condition
  `treatment`, one seed, `segmentSteps` = one day, `verifyFraction` 1) whose
  `interventions` are the founding schedule plus the letters, so everything an
  island does with it is the existing segment machinery. This module is only
  the garden's own bookkeeping, and like `Coordinator.Segment` it is pure: no
  process, no clock, no I/O. `Coordinator.Queue` owns the state, calls these
  functions inside its `handle_call`s with the time it read from
  `Coordinator.Clock`, and persists the record (inside its own `state.bin`,
  under `:gardens`).

  ## The record

  An atom-key map, no struct (the Queue persists it whole with
  `:erlang.term_to_binary/1` and loads it with `[:safe]`, so every atom in it
  must already exist: they are all literals in this module, which the Queue
  loads in `init/1`):

      %{name, created_at, preset_id, seed, steps_per_day, days_total,
        letters_per_day, queue_max, dawn_period_ms, dawn_offset_ms,
        width, height, founding: [intervention maps as the keeper gave them],
        letters: [%{id: "ltr-N", seq: N, kind: "stone", x, y, r, step, day,
                    posted_at, dropped_at: nil | ms} |
                  %{id: "ltr-N", seq: N, kind: "sun", percent, span, step, day,
                    posted_at, dropped_at: nil | ms}],
        next_letter: N, days: %{index => %{released_at, done_at, verified_at}}}

  A garden founded with food (`"food": true`, docs/garden-food-2026-10-18.md)
  also holds, and only then (a garden without food has exactly the keys above,
  so its record and its schedule are what they were before food existed):

      food: %{asks: K, every_days: N, amount, r, x, y},
      foods: [%{id: "food-N", seq: N, x, y, r, amount, step, day, called_at,
                notice_until, hands, dropped_at: nil | ms}],
      next_food: N

  A day's entry may also carry `leaders` (docs/garden-predictions-2026-10-18.md):
  `%{status, ref, for, census, lines}`, the day's block of who held the field,
  put once the day is verified (`pending_leaders/4`, `accept_leaders/6`,
  `put_leaders/3`). `ref` is the Queue's token for the task now counting it and
  `for` the accepted run attempt's id the block is about; neither is shown. An
  entry from before has no such key, so it is read with `Map.get/2`.

  `days` holds only released days (day 0 at creation). `width` and `height` are
  the preset's world size at creation, copied so a letter can be bounds-checked
  without the config. Segments are not in the record: every function that needs
  them takes `segs`, a `%{day_index => segment}` map of the garden's segments
  that exist (all of them, in the Queue; any subset in a test).

  ## Time

  A *dawn* is a point on a fixed grid, `dawn_offset_ms + n * dawn_period_ms`.
  Day 0 is released at creation; day *d*+1 may be released once day *d* is
  done or verified **and** a dawn has passed since day *d* was *actually*
  released (`maybe_release/3`). One release per call, so missed dawns do not
  bank: a keeper who returns after a week gets one day.

  ## The invariant

  Letters are the garden's only mutable input, and the coordinator hands the
  experiment's whole `interventions` list to every run and verify task. The
  runner applies only the entries a segment *owns* (step *s* belongs to the
  segment that stepped to *s*: `(start, start + steps]`, plus step 0 for the
  first). So a run and its replay agree on what they apply iff the slice a
  segment owns never changes while the segment holds any attempt. That is what
  the *frontier* guarantees: `frontier_day/2` is one past the highest day that
  holds an attempt, a letter is only ever placed on or dropped from a day at or
  beyond it, and a letter on day *d* lands at step `(d + 1) * D`, owned by day
  *d* itself. A day's letters are therefore fixed for as long as it holds any
  attempt. That is not forever: an upstream reject resets the later days
  (their attempts cleared, their results discarded), so the frontier can
  retreat and a reset day is open again, its letters `"waiting"`, droppable and
  re-fillable. That is sound because nothing attempted is left on the days it
  frees: every run and replay of a day, before or after a reset, carries the
  letters the day held while that attempt existed, so a run and its replay
  still always carry the same letters. The frontier is always computed fresh
  from `segs`, never stored.

  ## Known limits

  *Stitching.* Every task carries the schedule as it stood when it was
  assigned, so segments of one garden record different `interventions` in their
  manifests (a letter posted after day 0 was assigned is in day 1's manifest and
  not day 0's). The digest ignores the manifest and each day's owned slice is
  frozen, so verification and forking are unaffected. `tools/stitch.ts` exports
  a garden's verified prefix with `stitchRun`'s garden mode
  (`packages/runner/src/stitch.ts`): each day's log is checked against its own
  list, no day's list may rewrite an earlier day's entries, and the union of
  what the days applied must equal this experiment's current `interventions`
  over the exported range (docs/garden-stitch-rule-2026-10-17.md). Nothing in
  this application changed for it.

  *Who tends it.* Islands join without credentials, so, unless
  `:garden_island_token` is configured (then only islands that joined with it are
  offered a garden's days), any visitor can run a day, replay one with a second
  island id, or fail one. "Verified" therefore means two islands agreed, not
  that either is trusted; a failed or diverged day is recoverable by the keeper
  (`Queue.requeue_garden_day/2`). An island may also reject its predecessor,
  which the Queue lets it do for any day that is not *verified* (see the reject
  handler); that retreats the frontier, which is sound (nothing attempted
  keeps a letter it did not carry) but visible to the public as letters
  going back to `"waiting"`.

  ## Food

  A food is the existing `feed` intervention, called by visitors together: one
  hand per network per dawn period (`add_hand/5`; the Queue keeps the hands, in
  memory only, and passes them in), and the K-th hand of a period calls a food
  onto the frontier day, landing at its end step like a stone, at the world's
  centre, with the garden's fixed radius and amount. A day may carry a food only
  if every live food's day is at least N days away (`food_landing/2`), so at
  most one food is ever waiting. Foods obey the frontier exactly as letters do
  (`letter_status/3` and the drop rule read only `:day` and `:dropped_at`), and
  in the schedule they follow that step's stones. A food's day is not handed to
  an island to run until one dawn period after the call (`food_hold?/3`, read by
  the Queue's task picker), so the keeper's veto always has that long. The rules, the matter bound
  (checked by the Queue at founding) and the limits are pre-stated in
  docs/garden-food-2026-10-18.md.

  ## The sun

  A sun letter (docs/garden-sun-2026-10-18.md) is the body
  `{"kind": "sun", "percent": p}`: from the end of its landing day the world's
  light is `p` percent of its own (base, amplitude and season, floored) for
  one garden day, then its own returns. `p` is one the preset's light takes
  (`Coordinator.Queue.sun_percents/1`, from `:world_light`). A sun takes one of
  its day's letter places and the same per-address budget as a stone, at most
  one sun lands on a day, and never on the last day (it would shine past the
  horizon). In the schedule it is `{step, "sun", percent, span}` after that
  step's stones and foods. A sun on day `d` lands at `(d + 1) * D`, owned by
  day `d`, and governs day `d + 1`, which inherits it from day `d`'s final
  observer: both days are beyond the frontier when it is posted or dropped,
  so no attempted day's history changes. Its record has `percent` and `span`
  in place of `x`, `y`, `r`. Every letter's view has all five keys: a sun's
  `x`, `y` and `r` are null, a stone's `percent` and `span` are.

  ## The view

  `view/5` is the public JSON map, exactly the README's table, every key always
  present. It never echoes an island id, an adapter string or an
  island-reported map: the census numbers are read from known keys of the
  accepted run attempt's summary, type-checked (a count is an integer in
  `0..2^53-1`, a flag a boolean, anything else `nil`), and tending is counts
  of distinct ids and of distinct adapter descriptions, nothing more.
  """

  alias Coordinator.{Attempt, GardenLeaders, Segment}

  @window_ms 86_400_000
  @log_max 10_000
  # Dropped letters kept (the newest, by `seq`); older ones are forgotten.
  @dropped_max 256
  @radius_min 1
  @radius_max 32
  # packages/schema/src/sun.ts's SUN_PERCENTS.
  @sun_percents [50, 75, 125, 150]
  @days_shown 14
  @recent_max 32
  @int_max 9_007_199_254_740_991
  # No world is anywhere near this; the bound only keeps a bignum from ever
  # leaving the request that carried it. The garden's own `check_bounds/2` is
  # the real test.
  @coord_max 2_147_483_647
  @stalled ["diverged", "failed", "blocked"]
  @finished ["done", "verified"]

  @type t :: map
  @type segs :: %{optional(non_neg_integer) => Segment.t()}
  @type env :: %{
          required(:lease_ms) => integer,
          required(:stale_ms) => integer,
          required(:letters_per_address) => integer,
          optional(:food_hands) => hands_summary | nil,
          optional(:food_epoch) => term,
          optional(:shared_address) => boolean
        }
  @typedoc "A garden's hands this dawn period, as the Queue keeps them (in memory only)."
  @type hands :: %{dawn: integer, epoch: term, seen: MapSet.t(), count: non_neg_integer}
  @typedoc "`hands` without the hashes: what the view needs."
  @type hands_summary :: %{dawn: integer, epoch: term, count: non_neg_integer}
  @typedoc "Why the food ask is closed, and with `\"cooldown\"` the first day a food could land."
  @type closed :: {String.t(), non_neg_integer | nil}

  # Foods shown in the view (the newest, live and dropped).
  @foods_shown 32

  # ---- construction and the dawn grid ----

  @doc """
  A fresh garden at `now`, day 0 released. `params` carries `name`,
  `preset_id`, `seed`, `steps_per_day`, `days_total`, `letters_per_day`,
  `queue_max`, `dawn_period_ms`, `dawn_offset_ms`, `founding`, `width` and
  `height` (atom keys; the Queue has validated them), and optionally `food`:
  `nil` (no food) or `%{asks, every_days, amount, r}`, which puts the food keys
  on the record (the place is the world's centre).
  """
  @spec new(map, integer) :: t
  def new(params, now) do
    %{
      name: params.name,
      created_at: now,
      preset_id: params.preset_id,
      seed: params.seed,
      steps_per_day: params.steps_per_day,
      days_total: params.days_total,
      letters_per_day: params.letters_per_day,
      queue_max: params.queue_max,
      dawn_period_ms: params.dawn_period_ms,
      dawn_offset_ms: params.dawn_offset_ms,
      width: params.width,
      height: params.height,
      founding: params.founding,
      letters: [],
      next_letter: 1,
      days: %{0 => day_entry(now)}
    }
    |> put_food(Map.get(params, :food))
  end

  # Food keys only when the keeper founded the garden with food, so a garden
  # without it has the record (and the schedule) it always had.
  defp put_food(g, nil), do: g

  defp put_food(g, %{asks: asks, every_days: every, amount: amount, r: r}) do
    Map.merge(g, %{
      food: %{
        asks: asks,
        every_days: every,
        amount: amount,
        r: r,
        x: div(g.width, 2),
        y: div(g.height, 2)
      },
      foods: [],
      next_food: 1
    })
  end

  defp day_entry(released_at), do: %{released_at: released_at, done_at: nil, verified_at: nil}

  @doc "The run's name, as `Coordinator.Queue` builds it: `name/preset/treatment/seed-N`. The Queue's `{run, index}` index finds a day's segment by it."
  @spec run_id(t) :: String.t()
  def run_id(g), do: "#{g.name}/#{g.preset_id}/treatment/seed-#{g.seed}"

  @doc "Which dawn period `t` falls in: the index of the last dawn at or before it (negative before the first; floor division, never `div/2`)."
  @spec dawn_index(t, integer) :: integer
  def dawn_index(g, t), do: Integer.floor_div(t - g.dawn_offset_ms, g.dawn_period_ms)

  @doc "The time of dawn number `n`."
  @spec dawn_at(t, integer) :: integer
  def dawn_at(g, n), do: g.dawn_offset_ms + n * g.dawn_period_ms

  # ---- release ----

  @doc "The highest released day."
  @spec newest_released(t) :: non_neg_integer
  def newest_released(g), do: g.days |> Map.keys() |> Enum.max()

  @doc "Whether `day` has been released."
  @spec released?(t, integer) :: boolean
  def released?(g, day), do: Map.has_key?(g.days, day)

  @doc "When `day` was actually released, or `nil`."
  @spec released_at(t, integer) :: integer | nil
  def released_at(g, day) do
    case g.days do
      %{^day => %{released_at: at}} -> at
      _ -> nil
    end
  end

  @doc """
  Releases the next day if the rule allows it: the newest released day's
  segment status (`newest_status`, passed in so this stays pure) is `"done"` or
  `"verified"`, a day is left before the horizon, and a dawn has passed since
  that day was released (compared by dawn index, from its *actual* release
  time, so a day released late in a period still waits for the next dawn).
  `{:released, garden}` for at most one day per call, else `:none`.
  """
  @spec maybe_release(t, String.t() | nil, integer) :: {:released, t} | :none
  def maybe_release(g, newest_status, now) do
    newest = newest_released(g)

    if newest_status in @finished and newest + 1 < g.days_total and
         dawn_index(g, now) > dawn_index(g, released_at(g, newest)) do
      {:released, %{g | days: Map.put(g.days, newest + 1, day_entry(now))}}
    else
      :none
    end
  end

  @doc "Records that `day`'s run completed at `now` (clearing any `verified_at` from before a redo)."
  @spec record_done(t, integer, integer) :: t
  def record_done(g, day, now), do: touch_day(g, day, %{done_at: now, verified_at: nil})

  @doc "Records that `day` was verified at `now`."
  @spec record_verified(t, integer, integer) :: t
  def record_verified(g, day, now), do: touch_day(g, day, %{verified_at: now})

  defp touch_day(g, day, changes) do
    case g.days do
      %{^day => entry} -> %{g | days: Map.put(g.days, day, Map.merge(entry, changes))}
      _ -> g
    end
  end

  # ---- segment queries ----

  @doc """
  One past the highest day that holds any attempt (run or verify, any
  outcome), 0 if none: letters may only be placed on or dropped from days at or
  beyond it. It can retreat: an upstream reject clears the later days'
  attempts, which reopens them.
  """
  @spec frontier_day(t, segs) :: non_neg_integer
  def frontier_day(_g, segs) do
    segs
    |> Enum.filter(fn {_i, seg} -> seg.attempts != [] end)
    |> Enum.map(fn {i, _seg} -> i end)
    |> Enum.max(fn -> -1 end)
    |> Kernel.+(1)
  end

  @doc "Whether any day diverged, failed or is blocked behind one: nothing after it runs."
  @spec stopped?(segs) :: boolean
  def stopped?(segs), do: Enum.any?(segs, fn {_i, seg} -> seg.status in @stalled end)

  @doc "Whether every day of the horizon is done or verified."
  @spec finished?(t, segs) :: boolean
  def finished?(g, segs) do
    map_size(segs) == g.days_total and
      Enum.all?(segs, fn {_i, seg} -> seg.status in @finished end)
  end

  @doc """
  Whether `digest` is the accepted digest of a day of the *verified prefix*
  (`verified_prefix/1`): the only digests whose checkpoints are served.

  Per-day verification is not enough. A day is replayed from its predecessor's
  checkpoint, so a day verified while an earlier day is still unreplayed (or
  its replay is lost, or in flight) only proves the later day follows from a
  checkpoint nobody has checked. Offering that as "verified" and then
  withdrawing it when the ancestor diverges is exactly what the public must
  not be handed, so a day counts only once every day before it does too.
  `tip.verified` and `days[].status` stay per-day on purpose: they describe
  that day's own replay.
  """
  @spec verified_digest?(t, segs, String.t()) :: boolean
  def verified_digest?(_g, segs, digest) when is_binary(digest) do
    verified_digests(segs) |> Enum.any?(&(&1 == digest))
  end

  def verified_digest?(_g, _segs, _digest), do: false

  @doc "The accepted digests of the verified prefix, in day order."
  @spec verified_digests(segs) :: [String.t()]
  def verified_digests(segs) do
    for i <- 0..(verified_prefix(segs) - 1)//1, do: Segment.accepted_digest(segs[i])
  end

  # A verified day whose last verify attempt really did match the accepted
  # digest (the same test `Queue.experiment/1` applies: a requeue keeps old
  # verify attempts, so the status alone is not what vouches for it).
  defp verified?(%{status: "verified"} = seg) do
    verify = Segment.last_verify_attempt(seg)
    digest = Segment.accepted_digest(seg)

    is_binary(digest) and verify != nil and verify.outcome == "done" and
      verify.reported_digest == digest
  end

  defp verified?(_seg), do: false

  # ---- letters ----

  @doc """
  Checks a posted body's shape, with no knowledge of any garden: exactly the
  keys `kind`, `x`, `y`, `r`; `kind` is `"stone"`; all three numbers are
  integers (not floats, strings or booleans); `r` is within the stone radius
  limits. The world bounds are `check_bounds/2`'s, which needs the garden.
  Error strings never echo the body.
  """
  @spec parse_letter(term) ::
          {:ok, %{x: integer, y: integer, r: integer} | %{kind: String.t(), percent: integer}}
          | {:error, String.t()}
  def parse_letter(%{"kind" => "sun"} = body) do
    cond do
      Enum.sort(Map.keys(body)) != ["kind", "percent"] ->
        {:error, "a sun letter has exactly the keys kind and percent"}

      not is_integer(body["percent"]) or body["percent"] not in @sun_percents ->
        {:error, "percent must be one of #{Enum.join(@sun_percents, ", ")}"}

      true ->
        {:ok, %{kind: "sun", percent: body["percent"]}}
    end
  end

  def parse_letter(%{} = body) do
    cond do
      Enum.sort(Map.keys(body)) != ["kind", "r", "x", "y"] ->
        {:error, "a letter has exactly the keys kind, x, y and r"}

      body["kind"] != "stone" ->
        {:error, ~s(kind must be "stone" or "sun")}

      not is_integer(body["x"]) ->
        {:error, "x must be an integer"}

      not is_integer(body["y"]) ->
        {:error, "y must be an integer"}

      not is_integer(body["r"]) ->
        {:error, "r must be an integer"}

      abs(body["x"]) > @coord_max ->
        {:error, "x is out of range"}

      abs(body["y"]) > @coord_max ->
        {:error, "y is out of range"}

      body["r"] < @radius_min or body["r"] > @radius_max ->
        {:error, "r must be in #{@radius_min}..#{@radius_max}"}

      true ->
        {:ok, %{x: body["x"], y: body["y"], r: body["r"]}}
    end
  end

  def parse_letter(_body), do: {:error, "a letter is an object with the keys kind, x, y and r"}

  @doc "Checks a parsed letter's centre lies inside this garden's world."
  @spec check_bounds(t | map, map) :: :ok | {:error, String.t()}
  def check_bounds(_g, %{kind: "sun"}), do: :ok

  def check_bounds(g, %{x: x, y: y}) do
    cond do
      x < 0 or x >= g.width -> {:error, "x must be in 0..#{g.width - 1}"}
      y < 0 or y >= g.height -> {:error, "y must be in 0..#{g.height - 1}"}
      true -> :ok
    end
  end

  @doc """
  Posts a (parsed) letter at `now`: onto the first day at or beyond the
  frontier with room (`letters_per_day`), landing at that day's end step.
  `{:error, {:invalid, msg}}` (422) if its centre is outside the world;
  `{:error, {:refused, msg}}` (409) if the garden takes no letters now (stopped,
  finished, `queue_max` letters waiting, the log full, or no day left before
  the horizon). Returns the stored letter record; `letter_view/3` renders it.
  """
  @spec post_letter(t, map, segs, integer) ::
          {:ok, t, map} | {:error, {:invalid | :refused, String.t()}}
  def post_letter(g, %{kind: "sun", percent: p}, segs, now) do
    with :ok <- invalid(sun_percent(g, p)),
         {:ok, day} <- refused(sun_landing(g, segs)) do
      n = g.next_letter

      record = %{
        id: "ltr-#{n}",
        seq: n,
        kind: "sun",
        percent: p,
        span: g.steps_per_day,
        step: (day + 1) * g.steps_per_day,
        day: day,
        posted_at: now,
        dropped_at: nil
      }

      {:ok, %{g | letters: g.letters ++ [record], next_letter: n + 1}, record}
    end
  end

  def post_letter(g, %{x: _, y: _, r: _} = letter, segs, now) do
    with :ok <- invalid(check_bounds(g, letter)),
         {:ok, day} <- refused(landing(g, segs)) do
      n = g.next_letter

      record = %{
        id: "ltr-#{n}",
        seq: n,
        kind: "stone",
        x: letter.x,
        y: letter.y,
        r: letter.r,
        step: (day + 1) * g.steps_per_day,
        day: day,
        posted_at: now,
        dropped_at: nil
      }

      {:ok, %{g | letters: g.letters ++ [record], next_letter: n + 1}, record}
    end
  end

  @doc "The percents a sun letter may take in this garden: those its preset's light takes (`Coordinator.Queue.sun_percents/1`)."
  @spec sun_percents(t) :: [integer]
  def sun_percents(g), do: Coordinator.Queue.sun_percents(g.preset_id)

  defp sun_percent(g, p) do
    case sun_percents(g) do
      [] ->
        {:error, "this garden's light takes no sun"}

      ok ->
        if p in ok,
          do: :ok,
          else: {:error, "this garden's light takes a sun of #{Enum.join(ok, " or ")} percent"}
    end
  end

  # Where a sun posted now would go: the first day at or beyond the frontier
  # with a letter place, no live sun and a day after it before the horizon.
  defp sun_landing(g, segs) do
    case landing(g, segs) do
      {:ok, _} ->
        counts = g |> live() |> Enum.frequencies_by(& &1.day)
        sunned = for %{kind: "sun", day: d} <- live(g), into: MapSet.new(), do: d
        from = frontier_day(g, segs)

        case Enum.find(
               from..(g.days_total - 2)//1,
               &(Map.get(counts, &1, 0) < g.letters_per_day and not MapSet.member?(sunned, &1))
             ) do
          nil -> {:error, "no day before the last has room for a sun"}
          day -> {:ok, day}
        end

      error ->
        error
    end
  end

  @doc """
  Where a sun posted now would go: `%{day, step}` (it shines from `step` for one day), or `nil`: no day has room for
  one, or the garden's light takes no sun (`sun_percents/1` is `[]`), so every sun letter would be refused.
  """
  @spec next_sun_landing(t, segs) :: %{day: integer, step: integer} | nil
  def next_sun_landing(g, segs) do
    case sun_percents(g) != [] and sun_landing(g, segs) do
      false -> nil
      {:ok, day} -> %{day: day, step: (day + 1) * g.steps_per_day}
      {:error, _} -> nil
    end
  end

  defp invalid(:ok), do: :ok
  defp invalid({:error, msg}), do: {:error, {:invalid, msg}}
  defp refused({:ok, _} = ok), do: ok
  defp refused({:error, msg}), do: {:error, {:refused, msg}}

  @doc """
  The keeper's veto: drops a live letter whose day is at or beyond the
  frontier (never assigned). Dropping a letter that is already dropped is a
  no-op that returns it (so a retry is safe). `{:error, :not_found}` for an
  unknown id; `{:error, {:refused, msg}}` (409) for a letter whose day has
  been assigned.

  A dropped letter is a tombstone that counts against nothing (`logMax` counts
  live letters), so only the newest #{@dropped_max} of them (by `seq`) are
  kept: a drop forgets the oldest past that, and dropping a forgotten id is then
  `{:error, :not_found}`. Ids stay unique (`next_letter` only grows).
  """
  @spec drop_letter(t, String.t(), segs, integer) ::
          {:ok, t, map} | {:error, :not_found | {:refused, String.t()}}
  def drop_letter(g, "food-" <> _ = id, segs, now) do
    # A food is vetoed exactly as a letter is (docs/garden-food-2026-10-18.md,
    # section 4); a garden without food has no food to find.
    case drop_in(Map.get(g, :foods, []), id, segs, g, now, "food") do
      {:ok, foods, record} -> {:ok, %{g | foods: foods}, record}
      error -> error
    end
  end

  def drop_letter(g, id, segs, now) do
    case drop_in(g.letters, id, segs, g, now, "letter") do
      {:ok, letters, record} -> {:ok, %{g | letters: letters}, record}
      error -> error
    end
  end

  defp drop_in(records, id, segs, g, now, what) do
    case Enum.find(records, &(&1.id == id)) do
      nil ->
        {:error, :not_found}

      %{dropped_at: at} = record when is_integer(at) ->
        # Idempotent: a keeper whose retry follows a lost reply gets the
        # letter as dropped, not a 409 that reads like "too late".
        {:ok, records, record}

      record ->
        if record.day >= frontier_day(g, segs) do
          dropped = %{record | dropped_at: now}
          records = Enum.map(records, &if(&1.id == id, do: dropped, else: &1))
          {:ok, prune_dropped(records), dropped}
        else
          {:error, {:refused, "the #{what}'s day has been assigned"}}
        end
    end
  end

  # Keeps the newest `@dropped_max` dropped letters (by `seq`), so a post and
  # drop repeated forever does not grow the record without bound.
  defp prune_dropped(letters) do
    seqs = for %{dropped_at: at, seq: seq} <- letters, is_integer(at), do: seq

    if length(seqs) > @dropped_max do
      cutoff = seqs |> Enum.sort(:desc) |> Enum.at(@dropped_max - 1)
      Enum.reject(letters, &(is_integer(&1.dropped_at) and &1.seq < cutoff))
    else
      letters
    end
  end

  defp live(g), do: Enum.reject(g.letters, &is_integer(&1.dropped_at))

  defp live_foods(g), do: g |> Map.get(:foods, []) |> Enum.reject(&is_integer(&1.dropped_at))

  # Founding, live letters and live foods: what the experiment's schedule holds.
  defp log_count(g), do: length(g.founding) + length(live(g)) + length(live_foods(g))

  defp waiting_count(g, segs),
    do: Enum.count(live(g), &(letter_status(g, &1, segs) == "waiting"))

  # Where a letter posted now would go, or why none can.
  defp landing(g, segs) do
    cond do
      stopped?(segs) ->
        {:error, "the garden has stopped; nothing after the stopped day runs"}

      finished?(g, segs) ->
        {:error, "the garden has finished"}

      waiting_count(g, segs) >= g.queue_max ->
        {:error, "the letter queue is full"}

      log_count(g) >= @log_max ->
        {:error, "the garden's log is full"}

      true ->
        counts = g |> live() |> Enum.frequencies_by(& &1.day)
        from = frontier_day(g, segs)

        # Bounded: at most `queue_max` waiting letters can fill the days
        # beyond the frontier, so a day with room turns up within that many.
        case Enum.find(from..(g.days_total - 1)//1, &(Map.get(counts, &1, 0) < g.letters_per_day)) do
          nil -> {:error, "no day is left before the horizon"}
          day -> {:ok, day}
        end
    end
  end

  @doc """
  Where a letter posted now would go: `%{day, step, open}` (`open` = slots left
  on that day), or `nil` when the garden takes no letters.
  """
  @spec next_landing(t, segs) :: %{day: integer, step: integer, open: integer} | nil
  def next_landing(g, segs) do
    case landing(g, segs) do
      {:ok, day} ->
        used = Enum.count(live(g), &(&1.day == day))
        %{day: day, step: (day + 1) * g.steps_per_day, open: g.letters_per_day - used}

      {:error, _} ->
        nil
    end
  end

  @doc """
  The experiment's whole `interventions` list: the founding schedule exactly as
  the keeper gave it, then the live letters as lesions and the live foods as
  feeds, by step (at one step, stones by `seq`, then foods by `seq`). The Queue
  stores it as the spec's `interventions` after every add or drop.
  """
  @spec schedule(t) :: [map]
  def schedule(g) do
    stones = for l <- live(g), l.kind != "sun", do: {{l.step, 0, l.seq}, lesion_entry(l)}
    foods = for f <- live_foods(g), do: {{f.step, 1, f.seq}, feed_entry(f)}
    suns = for l <- live(g), l.kind == "sun", do: {{l.step, 2, l.seq}, sun_entry(l)}

    # At one step the stones come first (by seq), then the foods (by seq), then
    # the suns. A garden without food or suns has none, so its schedule is what
    # it always was.
    entries = (stones ++ foods ++ suns) |> Enum.sort_by(&elem(&1, 0)) |> Enum.map(&elem(&1, 1))
    g.founding ++ entries
  end

  defp sun_entry(l),
    do: %{"step" => l.step, "kind" => "sun", "percent" => l.percent, "span" => l.span}

  defp lesion_entry(l),
    do: %{"step" => l.step, "kind" => "lesion", "x" => l.x, "y" => l.y, "r" => l.r}

  # No `matter`: the runner logs the matter it moved, and a replay must reproduce it.
  defp feed_entry(f),
    do: %{
      "step" => f.step,
      "kind" => "feed",
      "x" => f.x,
      "y" => f.y,
      "r" => f.r,
      "amount" => f.amount
    }

  @doc """
  A letter's public status: `"dropped"`; `"stalled"` (its day diverged, failed
  or is blocked); `"verified"`; `"landed"` (its day is done); `"waiting"` (its
  day has never had an attempt: the keeper may drop it); else `"sealed"`.
  """
  @spec letter_status(t, map, segs) :: String.t()
  def letter_status(_g, %{dropped_at: at}, _segs) when is_integer(at), do: "dropped"

  def letter_status(_g, letter, segs) do
    case Map.get(segs, letter.day) do
      nil -> "waiting"
      %{status: status} when status in @stalled -> "stalled"
      %{status: "verified"} -> "verified"
      %{status: "done"} -> "landed"
      %{attempts: []} -> "waiting"
      _ -> "sealed"
    end
  end

  @doc "A letter as the public sees it."
  @spec letter_view(t, map, segs) :: map
  def letter_view(g, letter, segs) do
    status = letter_status(g, letter, segs)

    landed_in =
      if status in ["landed", "verified"], do: accepted_digest(Map.get(segs, letter.day))

    %{
      id: letter.id,
      kind: letter.kind,
      x: Map.get(letter, :x),
      y: Map.get(letter, :y),
      r: Map.get(letter, :r),
      postedAt: letter.posted_at,
      landsAtStep: letter.step,
      day: letter.day,
      status: status,
      landedIn: landed_in,
      droppedAt: letter.dropped_at,
      # Every letter has every key: a sun's `x`, `y` and `r` are null (it has no
      # place), a stone's `percent` and `span` are.
      percent: Map.get(letter, :percent),
      span: Map.get(letter, :span)
    }
  end

  # ---- food (docs/garden-food-2026-10-18.md) ----

  @doc "Whether the garden was founded with food."
  @spec food?(t) :: boolean
  def food?(g), do: Map.has_key?(g, :food)

  @doc """
  The day a food called now would land on, or why none can: `{:ok, day}` (the
  frontier day) or `{:error, {code, opens_at_day}}`, `code` one of `"off"` (the
  garden has no food), `"stopped"`, `"finished"`, `"log-full"`, `"horizon"` (no
  day is left before it, or the first day the spacing allows is past it) and
  `"cooldown"` (a live food is fewer than N days from the frontier day;
  `opens_at_day` is then the first day a food could land, else `nil`).

  The spacing rule is `|d - f| >= N` for every live food's day `f`, whatever
  that food's status, so a frontier retreat never lets a second food in closer
  than N; and while a live food is waiting (its day at or beyond the frontier)
  the ask stays closed until the frontier is N days past it, so a retreat never
  lets a second food wait beside it either.
  """
  @spec food_landing(t, segs) :: {:ok, non_neg_integer} | {:error, closed}
  def food_landing(g, segs) do
    cond do
      not food?(g) ->
        {:error, {"off", nil}}

      stopped?(segs) ->
        {:error, {"stopped", nil}}

      finished?(g, segs) ->
        {:error, {"finished", nil}}

      log_count(g) >= @log_max ->
        {:error, {"log-full", nil}}

      true ->
        d = frontier_day(g, segs)
        n = g.food.every_days
        days = g |> live_foods() |> Enum.map(& &1.day)
        # A food at or beyond the frontier is waiting: nothing is called until
        # the frontier is N past it, even after a retreat left room before it,
        # so at most one food is ever waiting.
        start = Enum.max([d | for(f <- days, f >= d, do: f + n)])
        free = first_free_day(start, days, n)

        cond do
          free >= g.days_total -> {:error, {"horizon", nil}}
          free == d -> {:ok, d}
          true -> {:error, {"cooldown", free}}
        end
    end
  end

  # The first day at or after `d` at least `n` days from every day in `days`.
  # Each pass moves past at least one food's day, so it takes at most
  # `length(days) + 1` passes.
  defp first_free_day(d, days, n) do
    case Enum.filter(days, &(abs(d - &1) < n)) do
      [] -> d
      near -> near |> Enum.map(&(&1 + n)) |> Enum.max() |> first_free_day(days, n)
    end
  end

  @doc """
  A visitor's hand on the food ask at `now`. `hands` is this garden's hands
  record as the Queue keeps it (or `nil`), `key` the hand's `{epoch, hash}` (the
  limiter's incarnation and the salted hash of the network). Hands of another
  dawn period or another limiter incarnation are discarded first: hands expire
  at the garden's next dawn, and a limiter restart (a new salt) cannot count
  one network twice.

    * `{:error, {:refused, closed}}`: the ask is closed (`food_landing/2`).
    * `{:repeat, hands}`: this network already gave a hand this period (also
      after a call: the networks seen stay remembered until the dawn).
    * `{:counted, hands}`: one more hand, short of K.
    * `{:called, g, hands, food}`: the K-th hand: the food is written onto the
      frontier day, landing at its end step, and the period's count is back at
      zero.
  """
  @spec add_hand(t, hands | nil, {term, binary}, segs, integer) ::
          {:error, {:refused, closed}}
          | {:repeat, hands}
          | {:counted, hands}
          | {:called, t, hands, map}
  def add_hand(g, hands, {epoch, hash}, segs, now) do
    hands = current_hands(g, hands, epoch, now)

    # A repeat is answered before the ask's state: a network whose hand is in
    # learns so even after the K-th hand closed the ask (amendment 2026-10-18,
    # after the second review).
    if MapSet.member?(hands.seen, hash) do
      {:repeat, hands}
    else
      with {:ok, day} <- refused_food(food_landing(g, segs)) do
        if hands.count + 1 >= g.food.asks do
          {g, food} = call_food(g, day, hands.count + 1, now)
          {:called, g, %{hands | seen: MapSet.put(hands.seen, hash), count: 0}, food}
        else
          {:counted, %{hands | seen: MapSet.put(hands.seen, hash), count: hands.count + 1}}
        end
      end
    end
  end

  defp refused_food({:ok, _} = ok), do: ok
  defp refused_food({:error, closed}), do: {:error, {:refused, closed}}

  defp current_hands(g, %{dawn: dawn, epoch: epoch} = hands, epoch, now) do
    if dawn == dawn_index(g, now), do: hands, else: fresh_hands(g, epoch, now)
  end

  defp current_hands(g, _hands, epoch, now), do: fresh_hands(g, epoch, now)

  defp fresh_hands(g, epoch, now),
    do: %{dawn: dawn_index(g, now), epoch: epoch, seen: MapSet.new(), count: 0}

  @doc "This period's hand count from a hands record (or summary), 0 if it is of another period or limiter incarnation."
  @spec hands_count(t, map | nil, term, integer) :: non_neg_integer
  def hands_count(g, %{dawn: dawn, epoch: epoch, count: count}, epoch, now) do
    if dawn == dawn_index(g, now), do: count, else: 0
  end

  def hands_count(_g, _hands, _epoch, _now), do: 0

  defp call_food(g, day, hands, now) do
    n = g.next_food
    f = g.food

    record = %{
      id: "food-#{n}",
      seq: n,
      x: f.x,
      y: f.y,
      r: f.r,
      amount: f.amount,
      step: (day + 1) * g.steps_per_day,
      day: day,
      called_at: now,
      # The keeper's veto window: the day is not run before this
      # (`food_hold?/3`).
      notice_until: now + g.dawn_period_ms,
      hands: hands,
      dropped_at: nil
    }

    {%{g | foods: g.foods ++ [record], next_food: n + 1}, record}
  end

  @doc """
  Whether `day` may not be handed to an island to run at `now`: a live food on
  it was called less than one dawn period ago (its `notice_until` is still
  ahead), so the keeper's veto (`drop_letter/4`, which works only until the day
  is assigned) has that whole period. A reject that reopens the day does not
  restart the notice: the food was already public that long. A garden without
  food holds nothing.
  """
  @spec food_hold?(t, non_neg_integer, integer) :: boolean
  def food_hold?(g, day, now) do
    g
    |> live_foods()
    |> Enum.any?(&(&1.day == day and notice_until(g, &1) > now))
  end

  # A food's veto deadline. A food record written before foods carried one has
  # the same rule's value, one dawn period from its call, for the hold and the
  # view alike.
  defp notice_until(_g, %{notice_until: t}) when is_integer(t), do: t
  defp notice_until(g, food), do: food.called_at + g.dawn_period_ms

  @doc "A food as the public sees it."
  @spec food_record_view(t, map, segs) :: map
  def food_record_view(g, food, segs) do
    status = letter_status(g, food, segs)

    %{
      id: food.id,
      x: food.x,
      y: food.y,
      r: food.r,
      amount: food.amount,
      calledAt: food.called_at,
      noticeUntil: notice_until(g, food),
      hands: food.hands,
      landsAtStep: food.step,
      day: food.day,
      status: status,
      landedIn:
        if(status in ["landed", "verified"], do: accepted_digest(Map.get(segs, food.day))),
      droppedAt: food.dropped_at
    }
  end

  @doc "A letter or a food (by its id) as the public sees it."
  @spec record_view(t, map, segs) :: map
  def record_view(g, %{id: "food-" <> _} = food, segs), do: food_record_view(g, food, segs)
  def record_view(g, letter, segs), do: letter_view(g, letter, segs)

  @doc """
  The view's `food` block (always present): the ask's rule, this period's hand
  count (`count`, from the Queue's in-memory hands), when those hands expire,
  whether a hand can be added now and why not, where a food called now would
  land, and the newest #{@foods_shown} foods, newest first. `shared_address`
  (`sharedAddress`) says that every visitor reaches the coordinator as one
  address (config `garden_shared_address`: production until the proxy passes
  client addresses, D-17), so the ask can hold one hand at most.
  """
  @spec food_view(t, segs, non_neg_integer, integer, boolean) :: map
  def food_view(g, segs, count, now, shared_address \\ false) do
    expires_at = dawn_at(g, dawn_index(g, now) + 1)

    if food?(g) do
      f = g.food

      {open, closed, opens, landing} =
        case food_landing(g, segs) do
          {:ok, day} -> {true, nil, nil, %{day: day, step: (day + 1) * g.steps_per_day}}
          {:error, {code, opens}} -> {false, code, opens, nil}
        end

      %{
        enabled: true,
        asks: f.asks,
        everyDays: f.every_days,
        amount: f.amount,
        r: f.r,
        place: %{x: f.x, y: f.y},
        hands: count,
        expiresAt: expires_at,
        sharedAddress: shared_address,
        open: open,
        closed: closed,
        opensAtDay: opens,
        landing: landing,
        foods:
          g.foods
          |> Enum.sort_by(& &1.seq, :desc)
          |> Enum.take(@foods_shown)
          |> Enum.map(&food_record_view(g, &1, segs))
      }
    else
      %{
        enabled: false,
        asks: nil,
        everyDays: nil,
        amount: nil,
        r: nil,
        place: nil,
        hands: 0,
        expiresAt: expires_at,
        sharedAddress: shared_address,
        open: false,
        closed: "off",
        opensAtDay: nil,
        landing: nil,
        foods: []
      }
    end
  end

  defp day_food(g, day) do
    case Enum.find(live_foods(g), &(&1.day == day)) do
      nil -> nil
      f -> f.id
    end
  end

  # ---- who held the field (docs/garden-predictions-2026-10-18.md) ----

  @doc """
  What to do about `day`'s leaders block now that it may be verified:

    * `:skip`: the day is not verified (no block);
    * `{:unchecked, for}`: it is verified, but its replay did not regenerate the
      observation files byte for byte for the accepted run attempt (`for`), or
      the producer uploaded no `lineages.tsv` or `mutations.tsv`: no numbers;
    * `{:start, job}`: count it from the files. `job` holds `for`, the `paths`
      and the `ctx` `Coordinator.GardenLeaders.compute/2` takes; the lines into
      the day are asked for only when day *B = day - 1* has an `ok` block for
      its own accepted run attempt (else `mutations_b` is `nil`).

  `blob` maps a SHA-256 to its path in the store (`Coordinator.Store.blob_path/2`).
  """
  @spec leaders_job(t, segs, non_neg_integer, (String.t() -> String.t())) ::
          :skip | {:unchecked, term} | {:start, map}
  def leaders_job(g, segs, day, blob) do
    seg = Map.get(segs, day)

    cond do
      seg == nil or seg.status != "verified" ->
        :skip

      not files_match?(seg) ->
        {:unchecked, accepted_id(seg)}

      true ->
        files = Segment.accepted_files(seg)
        b = ok_leaders(g, segs, day - 1)

        {:start,
         %{
           for: accepted_id(seg),
           paths: %{
             lineages: blob.(files["lineages.tsv"]),
             mutations: blob.(files["mutations.tsv"]),
             mutations_b: b && blob.(Segment.accepted_files(segs[day - 1])["mutations.tsv"])
           },
           ctx: %{
             day: day,
             end_step: (day + 1) * g.steps_per_day,
             width: g.width,
             cells: g.width * g.height,
             start_b: (day - 1) * g.steps_per_day,
             top_b: if(b, do: Enum.map(b.census.top, & &1.key), else: [])
           }
         }}
    end
  end

  # The gate (note section 2): verified by a matching replay, and that replay's
  # regenerated observation files equal the producer's uploads for the accepted
  # run attempt, both files the block reads among them.
  defp files_match?(seg) do
    files = Segment.accepted_files(seg) || %{}

    verified?(seg) and Segment.current_observations(seg) == "match" and
      is_binary(files["lineages.tsv"]) and is_binary(files["mutations.tsv"])
  end

  defp accepted_id(seg) do
    case Segment.accepted_run_attempt(seg) do
      %{id: id} -> id
      _ -> nil
    end
  end

  defp leaders_record(g, day) do
    case g.days do
      %{^day => entry} -> Map.get(entry, :leaders)
      _ -> nil
    end
  end

  # The day's block if it is `ok` with a census, for the day's accepted run
  # attempt and a verified day; else nil.
  defp ok_leaders(_g, _segs, day) when day < 0, do: nil

  defp ok_leaders(g, segs, day) do
    seg = Map.get(segs, day)

    case leaders_record(g, day) do
      %{status: "ok", census: %{}, for: attempt} = rec when seg != nil ->
        if seg.status == "verified" and attempt == accepted_id(seg), do: rec

      _ ->
        nil
    end
  end

  @doc "Puts `record` (`%{status, ref, for, census, lines}`) as `day`'s leaders block."
  @spec put_leaders(t, non_neg_integer, map) :: t
  def put_leaders(g, day, record), do: touch_day(g, day, %{leaders: record})

  @doc """
  Marks `day`'s block as being counted by the task `ref`, about run attempt
  `for`. A block that is already `ok` for the same attempt keeps its census and
  shows `ok` while its lines are counted again; any other becomes `pending`.
  """
  @spec pending_leaders(t, non_neg_integer, term, term) :: t
  def pending_leaders(g, day, ref, attempt) do
    record =
      case leaders_record(g, day) do
        %{status: "ok", for: ^attempt} = rec -> %{rec | ref: ref, lines: nil}
        _ -> %{status: "pending", ref: ref, for: attempt, census: nil, lines: nil}
      end

    put_leaders(g, day, record)
  end

  @doc "Records that `day` is verified without the files' match: no numbers."
  @spec unchecked_leaders(t, non_neg_integer, term) :: t
  def unchecked_leaders(g, day, attempt),
    do:
      put_leaders(g, day, %{status: "unchecked", ref: nil, for: attempt, census: nil, lines: nil})

  @doc """
  A task's answer for `day`: kept only if `ref` is the day's current one and
  `for` is still the day's accepted run attempt (a late reply is dropped:
  `:stale`). `result` is `Coordinator.GardenLeaders.compute/2`'s.
  """
  @spec accept_leaders(t, segs, non_neg_integer, term, term, term) :: {:ok, t} | :stale
  def accept_leaders(g, segs, day, ref, attempt, result) do
    seg = Map.get(segs, day)

    with %{ref: ^ref, for: ^attempt} when ref != nil <- leaders_record(g, day),
         true <- seg != nil and seg.status == "verified" and accepted_id(seg) == attempt do
      record =
        case result do
          {:ok, %{} = census, lines} when is_map(lines) or is_nil(lines) ->
            %{status: "ok", ref: nil, for: attempt, census: census, lines: lines}

          _ ->
            %{status: "unreadable", ref: nil, for: attempt, census: nil, lines: nil}
        end

      {:ok, put_leaders(g, day, record)}
    else
      _ -> :stale
    end
  end

  @doc """
  After `day`'s block arrived: the days whose lines can now be counted, each
  counted again in full. `day` itself, if it is `ok` without lines although
  the day before is `ok` (that day's answer came while this one was still
  being counted), and `day + 1`, if `day` is `ok` and `day + 1` is `ok` without
  lines (it was counted before this one was ready), or, when `day` is not `ok`,
  `day + 1` if it holds lines counted from it (they are taken back). Each
  recount settles the next day's lines one way, so this ends.
  """
  @spec leaders_followups(t, segs, non_neg_integer) :: [non_neg_integer]
  def leaders_followups(g, segs, day) do
    own = day > 0 and lines_missing?(g, segs, day) and ok_leaders(g, segs, day - 1) != nil

    # A day that is `ok` lets the next day's missing lines come; a day that is
    # not (a recount found its files unreadable) takes back the lines the next
    # day counted from it.
    next =
      if ok_leaders(g, segs, day) != nil,
        do: lines_missing?(g, segs, day + 1),
        else: has_lines?(g, segs, day + 1)

    if(own, do: [day], else: []) ++ if(next, do: [day + 1], else: [])
  end

  defp has_lines?(g, segs, day) do
    case ok_leaders(g, segs, day) do
      %{lines: %{}} -> true
      _ -> false
    end
  end

  defp lines_missing?(g, segs, day) do
    case ok_leaders(g, segs, day) do
      %{lines: nil} -> true
      _ -> false
    end
  end

  @doc """
  The released days whose block should be counted at start: verified days
  with no block, a `pending` one (its task died with the Queue), an
  `unreadable` one (once per start: a read error may have been passing), one
  about another run attempt, or an `ok` one without lines although the day
  before it is `ok` (the Queue stopped between the two answers).
  """
  @spec leaders_to_start(t, segs) :: [non_neg_integer]
  def leaders_to_start(g, segs) do
    g.days |> Map.keys() |> Enum.sort() |> Enum.filter(&start_at_boot?(g, segs, &1))
  end

  defp start_at_boot?(g, segs, day) do
    seg = Map.get(segs, day)
    rec = leaders_record(g, day)

    cond do
      seg == nil or seg.status != "verified" -> false
      rec == nil or rec.status in ["pending", "unreadable"] or rec.for != accepted_id(seg) -> true
      true -> day > 0 and lines_missing?(g, segs, day) and ok_leaders(g, segs, day - 1) != nil
    end
  end

  # The view's `days[].leaders`: `null` unless the day is verified; a block for
  # another run attempt (or none yet) reads `pending`. `ref` and `for` are
  # never shown.
  defp leaders_view(g, segs, day, seg, "verified") do
    case leaders_record(g, day) do
      %{status: status, for: attempt} = rec
      when status in ["ok", "unchecked", "unreadable", "pending"] ->
        # Lines are shown only while the day they come from is `ok` (note
        # section 4); a basis taken back hides them at once.
        if attempt == accepted_id(seg),
          do: %{
            status: status,
            census: rec.census,
            lines: rec.lines && ok_leaders(g, segs, day - 1) && rec.lines
          },
          else: %{status: "pending", census: nil, lines: nil}

      _ ->
        %{status: "pending", census: nil, lines: nil}
    end
  end

  defp leaders_view(_g, _segs, _day, _seg, _status), do: nil

  # ---- the public view ----

  @doc """
  The public view (`garden-v1`) as an atom-key map ready for `Jason.encode!/1`.

  `segs` are the garden's segments, `islands` the Queue's `%{id => island}`
  (only `:adapter` is read, and only to count distinct values), `now` the
  Queue's clock reading and `env` the three config numbers the view needs:
  `lease_ms` and `stale_ms` (a pending attempt silent for longer than
  `lease_ms` is a dead lease that the Queue has not reclaimed yet, because it
  only reclaims when an island asks for work, so the view does not count it as
  held) and `letters_per_address` (the limits block). It may also carry
  `food_hands` (this garden's hands record, or its summary without the hashes)
  and `food_epoch` (the limiter's incarnation now): the `food` block's count is
  that record's, unless it is of another dawn period or incarnation (then 0).
  Without them the count is 0. `shared_address` (default false) is the food
  block's `sharedAddress`.
  """
  @spec view(t, segs, map, integer, env) :: map
  def view(g, segs, islands, now, env) do
    d = g.steps_per_day
    newest = newest_released(g)
    stopped = stopped?(segs)
    finished = finished?(g, segs)
    released = Enum.to_list(newest..0//-1)
    released_segs = for i <- released, seg = segs[i], do: {i, seg}

    done_days = for {i, seg} <- released_segs, seg.status in @finished, do: i
    tip_day = Enum.max(done_days, fn -> nil end)
    tip_seg = tip_day && segs[tip_day]
    # The fork is the end of the verified *prefix*, not the newest verified
    # day: a day replayed from an ancestor that nobody has replayed yet is only
    # as good as that ancestor (`verified_digest?/3`).
    prefix = verified_prefix(segs)
    fork_day = if prefix > 0, do: prefix - 1

    next_release_at = next_release_at(g, segs, newest, stopped, finished)
    release_due = next_release_at != nil and next_release_at <= now
    state = state(released_segs, stopped, finished, release_due, now, env)
    verified_count = Enum.count(released_segs, fn {_i, seg} -> verified?(seg) end)
    last_moved = tip_day && get_in(g.days, [tip_day, :done_at])

    %{
      contract: "garden-v1",
      name: g.name,
      presetId: g.preset_id,
      seed: g.seed,
      world: %{width: g.width, height: g.height},
      founding: g.founding,
      createdAt: g.created_at,
      now: now,
      state: state,
      asleep: state == "waiting-for-island" and not touched?(released_segs, now - env.stale_ms),
      pace: %{
        stepsPerDay: d,
        dawnPeriodMs: g.dawn_period_ms,
        dawnOffsetMs: g.dawn_offset_ms,
        nextReleaseAt: next_release_at,
        releaseDue: release_due,
        nextDawnAt: dawn_at(g, dawn_index(g, now) + 1)
      },
      clock: %{
        step: if(tip_day, do: (tip_day + 1) * d, else: 0),
        verifiedStep: prefix * d,
        releasedStep: (newest + 1) * d,
        horizonStep: g.days_total * d,
        daysDone: length(done_days),
        daysTotal: g.days_total,
        lastMovedAt: last_moved,
        sleptMs: slept_ms(state, last_moved, now)
      },
      tending: tending(released_segs, islands, now, env),
      verification: verification(released_segs, islands, length(done_days), verified_count),
      census: tip_seg && tip_census(g, tip_day, tip_seg),
      tip: tip_seg && tip(g, tip_day, tip_seg),
      fork: fork_day && fork(g, fork_day, segs[fork_day]),
      days: days_view(g, segs, islands, newest, now, env),
      letters: letters_view(g, segs),
      food:
        food_view(
          g,
          segs,
          hands_count(g, Map.get(env, :food_hands), Map.get(env, :food_epoch), now),
          now,
          Map.get(env, :shared_address, false)
        ),
      sun: %{
        percents: sun_percents(g),
        span: d,
        nextLanding: next_sun_landing(g, segs)
      },
      leadersRule: GardenLeaders.rule(),
      limits: %{
        stoneRadius: %{min: @radius_min, max: @radius_max},
        lettersPerAddressPerHour: env.letters_per_address,
        logMax: @log_max
      }
    }
  end

  # `nextReleaseAt`: once the newest released day is done (and the garden is
  # neither stopped nor finished, with a day left), the first dawn after that
  # day was released.
  defp next_release_at(g, segs, newest, stopped, finished) do
    seg = Map.get(segs, newest)

    if not stopped and not finished and newest + 1 < g.days_total and seg != nil and
         seg.status in @finished do
      dawn_at(g, dawn_index(g, released_at(g, newest)) + 1)
    end
  end

  defp state(released_segs, stopped, finished, release_due, now, env) do
    cond do
      stopped -> "stopped"
      finished -> "finished"
      Enum.any?(released_segs, fn {_i, seg} -> growing?(seg, now, env) end) -> "growing"
      release_due or Enum.any?(released_segs, &waiting_day?(&1, now, env)) -> "waiting-for-island"
      true -> "resting"
    end
  end

  defp growing?(%{status: "assigned"} = seg, now, env), do: live_run?(seg, now, env)
  defp growing?(_seg, _now, _env), do: false

  defp waiting_day?({_i, %{status: "pending"}}, _now, _env), do: true
  defp waiting_day?({_i, %{status: "assigned"} = seg}, now, env), do: not live_run?(seg, now, env)
  defp waiting_day?(_entry, _now, _env), do: false

  defp live_run?(seg, now, env),
    do: Enum.any?(seg.attempts, &(&1.kind == "run" and live_lease?(&1, now, env)))

  defp live_lease?(attempt, now, env),
    do: Attempt.pending?(attempt) and now - attempt.heartbeat_at <= env.lease_ms

  # Any attempt of this garden heard from at or after `since`.
  defp touched?(released_segs, since) do
    Enum.any?(released_segs, fn {_i, seg} ->
      Enum.any?(seg.attempts, &(&1.heartbeat_at >= since))
    end)
  end

  defp slept_ms(_state, nil, _now), do: nil
  defp slept_ms("growing", _moved, _now), do: 0
  defp slept_ms(_state, moved, now), do: max(0, now - moved)

  # Days from 0 that are verified, consecutively.
  defp verified_prefix(segs) do
    Stream.iterate(0, &(&1 + 1))
    |> Enum.take_while(fn i -> verified?(Map.get(segs, i)) end)
    |> length()
  end

  defp tending(released_segs, islands, now, env) do
    attempts = for {_i, seg} <- released_segs, a <- seg.attempts, do: a
    since = now - @window_ms
    today = Enum.filter(attempts, &(&1.heartbeat_at >= since))
    ever = Enum.filter(attempts, &(&1.outcome == "done"))
    live = Enum.filter(attempts, &live_lease?(&1, now, env))

    %{
      windowMs: @window_ms,
      islandsToday: distinct_count(today, & &1.island),
      deviceTypesToday: distinct_count(today, &adapter_of(islands, &1.island)),
      deviceTypesEver: distinct_count(ever, &adapter_of(islands, &1.island)),
      activeNow: distinct_count(live, & &1.island)
    }
  end

  defp distinct_count(list, fun), do: list |> Enum.map(fun) |> Enum.uniq() |> length()

  # An island the Queue no longer knows (or one without an adapter) is one
  # unnamed device type, as `Queue` itself treats it.
  defp adapter_of(islands, id) do
    case Map.get(islands, id) do
      %{adapter: adapter} when is_binary(adapter) -> adapter
      _ -> "?"
    end
  end

  defp verification(released_segs, islands, days_done, days_verified) do
    kinds =
      for {_i, seg} <- released_segs, kind = verification_kind(seg, islands), do: kind

    %{
      daysDone: days_done,
      daysVerified: days_verified,
      byDifferentDeviceType: Enum.count(kinds, &(&1 == "different-device-type")),
      bySameDeviceType: Enum.count(kinds, &(&1 == "same-device-type")),
      diverged: Enum.count(released_segs, fn {_i, seg} -> seg.status == "diverged" end),
      failed: Enum.count(released_segs, fn {_i, seg} -> seg.status == "failed" end),
      share: if(days_done > 0, do: Float.round(days_verified / days_done, 4))
    }
  end

  defp verification_kind(seg, islands) do
    if verified?(seg) do
      producer = adapter_of(islands, Segment.accepted_island(seg))
      verifier = adapter_of(islands, Segment.last_verify_attempt(seg).island)
      if producer == verifier, do: "same-device-type", else: "different-device-type"
    end
  end

  defp tip_census(g, day, seg) do
    Map.merge(%{day: day, step: (day + 1) * g.steps_per_day}, day_census(seg))
    |> Map.merge(%{verified: seg.status == "verified", source: "producer"})
  end

  defp tip(g, day, seg) do
    %{
      day: day,
      step: (day + 1) * g.steps_per_day,
      digest: accepted_digest(seg),
      verified: seg.status == "verified"
    }
  end

  defp fork(g, day, seg) do
    digest = accepted_digest(seg)

    %{
      day: day,
      step: (day + 1) * g.steps_per_day,
      digest: digest,
      checkpoint: "/api/public/gardens/#{g.name}/checkpoints/#{digest}"
    }
  end

  defp days_view(g, segs, islands, newest, now, env) do
    for day <- newest..max(newest - @days_shown + 1, 0)//-1 do
      seg = Map.get(segs, day)
      entry = g.days[day]
      accepted = seg && Segment.accepted_run_attempt(seg)
      status = day_status(seg, now, env)

      %{
        day: day,
        startStep: day * g.steps_per_day,
        endStep: (day + 1) * g.steps_per_day,
        status: status,
        releasedAt: entry.released_at,
        # `done_at`/`verified_at` live in the garden record and a redo can send
        # a day back to pending or done again, so show them only while the
        # segment's own state still bears them out.
        doneAt: if(accepted, do: entry.done_at),
        verifiedAt: if(status == "verified", do: entry.verified_at),
        digest: seg && accepted_digest(seg),
        verification: seg && verification_kind(seg, islands),
        letters: for(l <- live(g), l.day == day, do: l.id),
        food: day_food(g, day),
        census: if(accepted, do: day_census(seg)),
        leaders: leaders_view(g, segs, day, seg, status)
      }
    end
  end

  defp day_status(nil, _now, _env), do: "waiting"
  defp day_status(%{status: "pending"}, _now, _env), do: "waiting"

  defp day_status(%{status: "assigned"} = seg, now, env),
    do: if(live_run?(seg, now, env), do: "growing", else: "waiting")

  defp day_status(%{status: status}, _now, _env), do: status

  defp accepted_digest(nil), do: nil

  defp accepted_digest(seg) do
    case Segment.accepted_digest(seg) do
      digest when is_binary(digest) -> digest
      _ -> nil
    end
  end

  # The numbers an island reported for a day, read from the six known
  # RunSummary keys only and type-checked. Anything else in the summary (extra
  # keys, strings, nested maps, a bignum) is dropped, never echoed.
  defp day_census(seg) do
    summary =
      case Segment.accepted_run_attempt(seg) do
        %{summary: %{} = summary} -> summary
        _ -> %{}
      end

    %{
      individuals: count(summary["finalIndividuals"]),
      lineages: count(summary["finalLineages"]),
      maxGeneration: count(summary["maxGeneration"]),
      mutations: count(summary["mutations"]),
      extinct: flag(summary["extinct"]),
      conservationOk: flag(summary["conservationOk"])
    }
  end

  defp count(v) when is_integer(v) and v >= 0 and v <= @int_max, do: v
  defp count(_v), do: nil
  defp flag(v) when is_boolean(v), do: v
  defp flag(_v), do: nil

  defp letters_view(g, segs) do
    views = Enum.map(g.letters, &letter_view(g, &1, segs))
    {waiting, others} = Enum.split_with(views, &(&1.status == "waiting"))

    %{
      perDay: g.letters_per_day,
      queueMax: g.queue_max,
      queued: length(waiting),
      nextLanding: next_landing(g, segs),
      waiting: waiting,
      recent: others |> Enum.reverse() |> Enum.take(@recent_max)
    }
  end
end
