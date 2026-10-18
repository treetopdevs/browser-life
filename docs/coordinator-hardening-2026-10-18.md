# Coordinator hardening: rules written before the code (2026-10-18)

Slice 22 of the backlog run closes three coordinator follow-ups that earlier slices reported but
left alone because they were out of scope:

1. PR #39 (operator dashboard) found that `Coordinator.IslandLimiter` crashes on a budget window
   that is a decimal or `nil` (for example `island_next_window_ms: 1.5`).
2. PR #35 (garden hardening) found that `ApiController.join/2` also accepts `?gardenToken=` in a
   query string, where it can end up in proxy or access logs.
3. PR #39 did not show island capabilities, because `Coordinator.Queue` never stores them.

This slice adds no physics, no golden pin, no dynamics change, no route and no change to the garden
modules, the letter limiter or the garden controller. Task gating by capability stays exactly as it
is. This note was written before any of the code. A change to the rules below goes in a dated
amendment at the end, never in a silent edit.

## 1. Limit and window config is checked when the application starts

**Rule.** `Coordinator.Application.start/2` first calls `Coordinator.ConfigCheck.check!/0`. If any
key below is *present* in the `:coordinator` env with a value outside its allowed shape, the
coordinator refuses to start, in every environment (dev, test, prod, release). The message names
each bad key and its value, and says what shape is allowed, for example
`config :coordinator, island_next_window_ms: 1.5 is not a positive whole number (a budget window, in ms)`.
A key that is absent is fine, because its consumer applies its own built-in default. The check
covers only numeric keys, so it can never print a token. It runs once, at start: a value changed
later with `Application.put_env/3` is not checked again. That is why `OpsStatus`'s `limits.invalid`
and `limits.unset` stay, and from now on they can only come from such a runtime change.

| Shape | Keys |
|---|---|
| positive integer | `island_join_window_ms`, `island_next_window_ms`, `island_segment_window_ms`, `island_requests_window_ms`, `island_limit_table_max`, `max_islands`, `lease_ms`, `discovery_lease_ms`, `garden_letter_window_ms`, `garden_letter_table_max`, `garden_letters_per_address`, `garden_refusals_per_address` |
| `nil` (off) or positive integer | `island_joins_per_address`, `island_next_per_island`, `island_segment_requests_per_island`, `island_requests_per_address`, `island_max_pending` |
| non-negative integer | `island_prune_after_ms`, `island_prune_grace_ms`, `public_status_wait_ms`, `garden_cache_wait_ms` |
| any integer (0 or less turns the cache off) | `public_status_cache_ms`, `garden_cache_ms` |

`true` and `false` are never integers. These are refused: floats, strings, lists, keyword lists,
`nil` where the table does not allow it, and `0` for a budget limit (switch a budget off with
`nil`). Refusing `0` follows `BL_ISLAND_JOINS_PER_ADDRESS`, where `"0"` already means off, so a
config `0` that refuses every request cannot be confused with it.

The garden letter keys are checked too. The check only reads config and does not touch
`letter_limiter.ex`, and the letter limiter does the same `max(get_env, 1)` arithmetic on its window.
The garden slice running at the same time is told about this (PR follow-ups).

**Environment variables (runtime.exs).** `BL_ISLAND_JOINS_PER_ADDRESS` and `BL_MAX_ISLANDS` already
stop the boot by name (PR #28). `BL_DISCOVERY_LEASE_MS` moves from `String.to_integer/1`, which
raises a bare ArgumentError, to the same `env_count` helper: a positive whole number, with no "off".
This slice adds no new environment variables.

**Pass criteria.** For every key in the table: each value of the wrong shape out of `nil`, `0`, `-1`,
`1.5`, `"120"`, `true`, `[limit: 120]` and `%{}` gives an error naming that key, and each allowed
value passes. With a bad value set, calling `Coordinator.Application.start/2` raises before it starts
anything. The config files themselves pass (`config.exs` with `dev`, `test` and `prod`, plus prod
`runtime.exs` with its required variables set). `BL_DISCOVERY_LEASE_MS` set to `"abc"`, `"1.5"`, `"0"`
or `"-5"` stops the prod runtime by name, `"60000"` sets it, and blank leaves it unset.

## 2. The garden token is refused in a query string

**Rule.** `POST /api/islands` with a query parameter named exactly `gardenToken` (after URL
decoding, as Plug reads it, with any value including empty and whether or not the body carries one)
is answered `400 {"error": "gardenToken belongs in the JSON body of POST /api/islands, never in the URL"}`.
No island is created. The response, the log line and the Queue never see the value. The runner
already sends the token only in the JSON body (`IslandOptions.gardenToken`), and the JSON body stays
the only accepted place. Once the query key is refused, the merged params can carry `gardenToken`
only from the body (this route has no path params), so `Queue.join/1` keeps receiving `params`. The
refusal runs in `join/2`, after the budget plugs, so a refused join counts against the join budget
like any other answered request. Case variants (`gardentoken`) are not refused: the coordinator
does not honour them, so the token cannot do anything there, but a client that sent one still
exposed it, and no server can undo that.

**Pass criteria.** With `garden_island_token` set: `?gardenToken=<right token>` plus a JSON body is a
400 whose body does not contain the value, and the island table does not grow. The same request
with the right token in the body as well is also a 400. `?gardenToken=` with an empty value is a
400. A join with the token in the body only still makes a `garden: true` island. A join with no
token at all is unchanged.

## 3. Each island's most recent capabilities are recorded

**Rule (what is stored).** On every `/api/next` for a known island, the Queue sets its record's
`:capabilities` to a cleaned copy of the list that request's gating used. That list is the
controller's `capabilities/1` result, unchanged: at most 16 strings of at most 64 bytes, else none.
The cleaning drops every string that does not match `\A[a-z][a-z0-9]*(-[a-z0-9]+)*\z` or is longer
than 32 bytes, removes duplicates and sorts. The four names the Queue gates on (`ponds-v1`,
`ponds-v2`, `interventions-v1`, `breed-v1`) are all kept. Of the other names that pass the pattern,
the first four in sorted order are kept. So a record holds at most 8 names and about 200 bytes. When
the cleaned list is empty, the key is removed, so an island that never advertised anything keeps the
record shape it had before this change. The record is updated whether the answer is a task or idle,
including at the pending cap. `/api/next` already rewrites `state.bin`, so recording costs no extra
write.

**Rule (gating is unchanged).** `pick_task/4` keeps reading only the list in the request. A stored
list never grants a task. An island that once advertised `ponds-v1` and then asks without it is idle
while only pond work waits.

**Rule (who sees it).** The admin `GET /api/status` lists it on each island (`islands[].capabilities`,
present only when non-empty). `OpsStatus` adds `islandCapabilities`:
`{byCapability: {<name>: {islands, live, known}}, none: {islands, live}}`. `live` means not stale,
using the Queue's own `stale` flag. `known` means the coordinator gates on the name. `none` counts
islands with no recorded capabilities: they advertised nothing that could be stored, or have not
asked since this change. Nothing else exposes the list. `/api/islands/me` drops the key (it shows
what it showed before), and the public status and the garden views never read it.

**Rule (operator page).** The Islands section gets a table "By capability (as last advertised)":
capability, islands, live, stale, and whether this coordinator gates on it, plus a row for islands
with none recorded. "Open work by capability" gets a column "live islands that last advertised all
of these". Its note says this column comes from each island's most recent ask and is not a promise:
work is still gated on each request. Every string goes on the page with `textContent`. If the status
has no `islandCapabilities` key (an older coordinator), the page says so instead of failing.

**Rule (state.bin and rollback).** This follows the precedent for the one-way keys added since v3
(`import_from`, `observations`, `manifest_metrics_version`, a failed attempt's `:reason`, and the
`:gardens` key). `@state_version` stays at 3. A file written before this change loads unchanged, and
a coordinator whose islands never advertised anything storable writes the same bytes as before.
Going the other way is not supported. When a coordinator from before this change decodes a file
holding a recorded capability list, one of two things happens: it refuses the file (`[:safe]`
decoding, if `:capabilities` is not yet an atom in that VM), or it loads the file and passes the
stale list through its `/api/status` and `/api/islands/me`. Either way, rolling the code back after
an island has advertised a capability means starting from a fresh data dir, as it does for gardens
and failed segments. The Queue's `@state_version` comment and the README both say this.

**This amends** `docs/ops-dashboard-2026-10-18.md`. Its statements that the coordinator "records no
island's capabilities" (sections 2 and 3, and the Islands note) are no longer true once this lands.
That note is left unedited here, since it is outside this slice. This note is the record of the change.

**Pass criteria.**
- Restarting the Queue on the same data dir keeps an island's stored list.
- A state.bin shaped like the ones before this change (islands with no `:capabilities`) loads and serves.
- A list with 17 entries stores nothing and gates as none, as today.
- Strings that fail the pattern, or are 33 to 64 bytes long, are gated as today but never stored.
- Six unknown names that pass the pattern store the first four in sorted order, plus every known name sent.
- An empty list removes the key.
- The island asks with `ponds-v1`, then with `[]` while only pond work waits, and is idle.
- `/api/islands/me` has no `capabilities` key.
- The public status keys are unchanged.
- The ops fixture (`test/fixtures/ops-status.example.json`) is held to a real response that
  carries both new shapes.
- The Playwright ops spec checks the new table and column from the fixture, a hostile capability
  name rendered as text, and a status without `islandCapabilities`, with no sideways scroll at 375 px.

## Gates

`cd apps/coordinator && mix precommit` (warnings as errors, format, all tests).
`npx playwright test tests/e2e/coordinator-ops.spec.ts --project=chrome`. `git diff --check`.
`deno run -A tests/deno/coordinator_integration.ts` only if the machine allows a short GPU run. Each
result is recorded next to `uptime`. A test that times out is rerun alone once before it counts as
a failure.

## Amendment (2026-10-18, after review)

Four reviews (three lenses and Codex Sol 6.1) of the first implementation changed these rules.

- **Garden letter counts may be `0`.** `garden_letters_per_address` and
  `garden_refusals_per_address` move from "positive integer" to "non-negative integer". They have
  no "off", and `0` closed the letter box before this check, so refusing it would have stopped a
  config that used to boot. A garden window of `0` (once clamped to 1 ms by the letter limiter) is
  still refused, like the island windows. The shipped message reads, for example,
  `config :coordinator, island_next_window_ms: 1.5 is not a positive whole number`, without the
  "(a budget window, in ms)" suffix shown in section 1. A test scans `lib/` for limit-shaped config
  keys, so a new window, budget, cap, cache or lease key that `ConfigCheck` does not know fails it.
  Because a numeric key can have any name, a second test makes every key read by a literal atom
  either checked or listed as not a limit. A third allows reads by a variable key only in the three
  files reviewed for them, at a pinned number of places, and a fourth classifies the keys those
  files pass to their variable-key helpers (`window/2`, `int_env/1`, `budget/2` and the like) and
  list in `~w(...)a` key tables. The scanners assume parenthesised calls, which `mix format` (run by
  `mix precommit`) enforces; they do not see a quoted key atom or a read through
  `import Application`, and `lib/` has neither.
- **The refusal does not neutralise a leaked token.** The refused URL, token included, can already
  be in a proxy or access log, and the token still works in a JSON body. The README says to rotate
  it. A form-encoded or multipart join body never reaches `join/2`: `IslandBodyLimit` answers it
  415 before reading it, now pinned by a test.
- **`islandCapabilities` is bounded fleet-wide.** Each island may store four unknown names, so the
  distinct names grow with the island table (up to about 80,000 at 20,000 islands). `byCapability`
  now lists every gated name and the 50 other names on the most islands (ties by name), and a new
  `omittedNames` counts the rest. The page shows those as one "(n other names not listed)" row and
  stops at 100 rows whatever it is sent. The gated names come from `Queue.known_capabilities/0`
  (a test holds it to every `@*_capability` constant in `queue.ex`) instead of a third copy.
- **Recorded lists are cleaned on load.** A `state.bin` list this code could not have written
  (improper, non-strings, too many or too long names) goes through the same cleaning as a request
  when the Queue starts, and is dropped when nothing is storable, so it cannot break `/api/status`.
- **Smaller corrections.** The per-island unknown cap keeps the first four names in sorted order, not
  the most recent, so a later name can be left out of that island's record (display only). A full
  record is at most 8 names of 32 bytes, a few hundred bytes of term (about 250), not about 200. After an upgrade an
  island that is busy on a long task counts as "none recorded" until its next `/api/next`, so the
  table lags. On "Open work by capability", the `none` row's island column says "all live (n)"
  instead of a bare count, and a row whose need is missing from `capabilityNeeds` shows "—".
- **`limits.unset` can appear from the first boot.** Section 1 says `limits.invalid` and
  `limits.unset` can only come from a runtime change. That holds for `invalid` only: `unset` names
  a key that is absent, which the check lets through (its consumer applies a built-in default), so
  it can show on the first `/api/status` after boot.

## Amendment (2026-10-18, after merging main with PR #41)

PR #41 (garden collective food) landed on main with seven new `:coordinator` keys that this check
did not know, so the scan tests failed on the merge. They are classified as follows.

- **Positive whole numbers.** `garden_hands_sweep_ms` (the `Process.send_after` interval of the
  Queue's hand sweep: `0` would sweep in a tight loop), `garden_call_timeout_ms` (the hands route's
  `Queue` call timeout: `0` times out every ask), and the four food keys `garden_food_asks`,
  `garden_food_every_days`, `garden_food_amount` and `garden_food_radius`. The food keys keep their
  exact ranges (asks 2..1000, every 1..365 days, amount 1..64, radius 1..32) where #41 put them: in
  `Queue`'s `garden_spec`, per garden at founding with food. The boot check adds the shape, so a
  malformed value (`nil`, `1.5`, `"5"`) stops the boot by name instead of surfacing at founding,
  where for `foodAsks` and `foodEveryDays` it read as a fault in the keeper's request.
- **Not a limit.** `garden_shared_address` is a flag, listed with the other non-limits.
- **A limit-shaped atom that is not config.** #41's `Coordinator.Garden` `@type env` names
  `:letters_per_address`, a field of the garden view env that the Queue fills from
  `garden_letters_per_address`. The shaped scan keeps its pattern and now allows exactly the atoms of
  a reviewed list (`@shaped_not_config`, this one only), asserted to be named in `lib/` and never
  among the checked keys.
