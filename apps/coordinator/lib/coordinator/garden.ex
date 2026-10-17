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
                    posted_at, dropped_at: nil | ms}],
        next_letter: N, days: %{index => %{released_at, done_at, verified_at}}}

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
  segment owns never changes after any island was assigned it. That is what the
  *frontier* guarantees: `frontier_day/2` is one past the highest day that has
  ever had an attempt, a letter is only ever placed on or dropped from a day at
  or beyond it, and a letter on day *d* lands at step `(d + 1) * D`, owned by
  day *d* itself. A day that has been attempted therefore never gains or loses
  an entry. (An upstream reject resets the later days' attempts, so the
  frontier can retreat; that is sound because nothing attempted is left on the
  days it frees, and the letters there are `"waiting"` again, droppable and
  re-fillable. The frontier is always computed fresh from `segs`, never
  stored.)

  ## Known limits

  *Stitching.* Every task carries the schedule as it stood when it was
  assigned, so segments of one garden record different `interventions` in their
  manifests (a letter posted after day 0 was assigned is in day 1's manifest and
  not day 0's). The digest ignores the manifest and each day's owned slice is
  frozen, so verification and forking are unaffected, but
  `packages/runner/src/stitch.ts` compares whole specs and refuses such a run
  ("spec differs from segment #0's"): the current `tools/stitch.ts` cannot
  export a garden that took a letter after its first assignment. Making
  `stitchRun` compare specs without `interventions`, and check each segment's
  owned slice against the experiment's final schedule, is the fix, and it is
  not in this application.

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

  ## The view

  `view/5` is the public JSON map, exactly the README's table, every key always
  present. It never echoes an island id, an adapter string or an
  island-reported map: the census numbers are read from known keys of the
  accepted run attempt's summary, type-checked (a count is an integer in
  `0..2^53-1`, a flag a boolean, anything else `nil`), and tending is counts
  of distinct ids and of distinct adapter descriptions, nothing more.
  """

  alias Coordinator.{Attempt, Segment}

  @window_ms 86_400_000
  @log_max 10_000
  # Dropped letters kept (the newest, by `seq`); older ones are forgotten.
  @dropped_max 256
  @radius_min 1
  @radius_max 32
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
  @type env :: %{lease_ms: integer, stale_ms: integer, letters_per_address: integer}

  # ---- construction and the dawn grid ----

  @doc """
  A fresh garden at `now`, day 0 released. `params` carries `name`,
  `preset_id`, `seed`, `steps_per_day`, `days_total`, `letters_per_day`,
  `queue_max`, `dawn_period_ms`, `dawn_offset_ms`, `founding`, `width` and
  `height` (atom keys; the Queue has validated them).
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
  One past the highest day with any attempt (run or verify, any outcome), 0 if
  none: letters may only be placed on or dropped from days at or beyond it.
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
  @spec parse_letter(term) :: {:ok, %{x: integer, y: integer, r: integer}} | {:error, String.t()}
  def parse_letter(%{} = body) do
    cond do
      Enum.sort(Map.keys(body)) != ["kind", "r", "x", "y"] ->
        {:error, "a letter has exactly the keys kind, x, y and r"}

      body["kind"] != "stone" ->
        {:error, ~s(kind must be "stone")}

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
  @spec check_bounds(t, %{x: integer, y: integer}) :: :ok | {:error, String.t()}
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
  @spec post_letter(t, %{x: integer, y: integer, r: integer}, segs, integer) ::
          {:ok, t, map} | {:error, {:invalid | :refused, String.t()}}
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
  def drop_letter(g, id, segs, now) do
    case Enum.find(g.letters, &(&1.id == id)) do
      nil ->
        {:error, :not_found}

      %{dropped_at: at} = letter when is_integer(at) ->
        # Idempotent: a keeper whose retry follows a lost reply gets the
        # letter as dropped, not a 409 that reads like "too late".
        {:ok, g, letter}

      letter ->
        if letter.day >= frontier_day(g, segs) do
          dropped = %{letter | dropped_at: now}
          letters = Enum.map(g.letters, &if(&1.id == id, do: dropped, else: &1))
          {:ok, %{g | letters: prune_dropped(letters)}, dropped}
        else
          {:error, {:refused, "the letter's day has been assigned"}}
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

  defp log_count(g), do: length(g.founding) + length(live(g))

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
  the keeper gave it, then the live letters as lesions, by `{step, seq}`. The
  Queue stores it as the spec's `interventions` after every add or drop.
  """
  @spec schedule(t) :: [map]
  def schedule(g) do
    letters =
      g
      |> live()
      |> Enum.sort_by(&{&1.step, &1.seq})
      |> Enum.map(fn l ->
        %{"step" => l.step, "kind" => "lesion", "x" => l.x, "y" => l.y, "r" => l.r}
      end)

    g.founding ++ letters
  end

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
      x: letter.x,
      y: letter.y,
      r: letter.r,
      postedAt: letter.posted_at,
      landsAtStep: letter.step,
      day: letter.day,
      status: status,
      landedIn: landed_in,
      droppedAt: letter.dropped_at
    }
  end

  # ---- the public view ----

  @doc """
  The public view (`garden-v1`) as an atom-key map ready for `Jason.encode!/1`.

  `segs` are the garden's segments, `islands` the Queue's `%{id => island}`
  (only `:adapter` is read, and only to count distinct values), `now` the
  Queue's clock reading and `env` the three config numbers the view needs:
  `lease_ms` and `stale_ms` (a pending attempt silent for longer than
  `lease_ms` is a dead lease that the Queue has not reclaimed yet, because it
  only reclaims when an island asks for work, so the view does not count it as
  held) and `letters_per_address` (the limits block).
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
        census: if(accepted, do: day_census(seg))
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
