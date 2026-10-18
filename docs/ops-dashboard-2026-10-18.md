# The coordinator's operator page: rules written before the code (2026-10-18)

Slice 16 of the backlog run. The operator page (`apps/coordinator/priv/static/index.html`, served by
the coordinator at `/index.html`; it asks for the admin token and holds no data until it has one)
predates shared gardens (PR #21/#26/#30), bred pond worlds (PR #33), failed segments (PR #16) and the
island limits (PR #28). This slice makes it useful for running those. It adds no physics, no golden
pin, no dynamics change, no route, and no change to `Coordinator.Queue`, `Coordinator.Garden`, the
garden controller, `Coordinator.IslandLimiter`, `packages/runner` or `apps/lab`.

This note was written before any of that code. The rules and pass criteria below are fixed here; a
change to them is a dated amendment at the end of this note, never a silent edit.

## What the page shows

The page stays one static file with its own inline style and one inline script: no build step, no
external script, stylesheet or font, no storage. The token lives in a variable for as long as the tab
is open and is sent only as `Authorization: Bearer` to the admin routes (`/api/status`,
`/api/discovery/status`); the public garden views are fetched without it. Everything a server sends
is put on the page with `textContent` (or as an attribute value through `setAttribute`, for
`data-*` hooks); nothing uses `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`,
`eval` or `new Function`. A server string that goes into a URL goes through `encodeURIComponent`.

Sections, in this order:

1. **Totals.** The cards it has today (pending, running, done, verified, diverged, failed, observation
   mismatches, device types, stale islands), plus islands in the table against `max_islands`.
2. **Experiments.** One row per experiment in `/api/status` `experiments`: name, preset, kind
   (`garden`, `bred`, `pond`, `scheduled`, `plain`, from the spec and the config lists), the
   capabilities its runs need, and its runs' segments, done, verified, diverged, failed, blocked and
   **open**. Open is `segments − done − diverged − failed − blocked` (done counts verified), that is
   pending or running. The page calls it "open", never "waiting for a capable island": the
   coordinator records no island's capabilities (below), and a pending segment may also be waiting
   for its predecessor, a metapopulation barrier, a garden's dawn or an island's pending cap.
3. **Open work by capability.** Open segments summed by the capability set their run needs, over
   experiments that are not gardens (a garden's future days are all pending by design; its state is
   section 4). This is what "how many segments wait for a capable island" can honestly be today.
4. **Gardens.** For every experiment whose spec has `"garden": true`, its public view
   (`/api/public/gardens/<name>`, contract `garden-v1`): state and asleep, days done of the horizon,
   the tip, the verified and released steps, the next release, verification (done, verified, by a
   different and by the same device type, diverged, failed), tending (islands today, device types
   today and ever, active now), letters (queued of `queueMax`, the next landing) and the newest days
   with their status, verification and letter count. A 404 or 503 for one garden is shown in that
   garden's card and does not clear the rest of the page.
5. **Keeper actions** (inside each garden's card), as instructions, never buttons: for a failed or
   diverged day, the `requeue` curl line; for each waiting letter, the `drop` curl line, both as the
   README documents them, with `$BL_ADMIN_TOKEN` written literally (the token the operator entered is
   never shown). A line is offered only when the garden name matches the coordinator's experiment
   name rule (`^[a-z0-9][a-z0-9_-]{0,63}$`), the day is an integer and the letter id matches
   `^ltr-[0-9]+$`; otherwise the card says the value is not safe to paste and points at the README.
   Why instructions: the page has been read-only since it existed, it re-renders every three seconds
   under a pointer, a drop cannot be undone, and the README's curl lines are already the keeper's
   documented way in.
6. **Failures.** The table it has today, with the experiment the run belongs to and the reason
   wrapped, not truncated (it is bounded to 500 graphemes by the coordinator), and one line on the
   ways out: an upstream reject for an experiment, `requeue` for a garden day.
7. **Divergences** and **observation mismatches**, as today (mismatches gain a table).
8. **Islands.** Grouped by device type (the adapter description): islands, live, stale, runs,
   verifies; grouped by runner (a user agent starting `deno ` is the headless island, anything else a
   browser); the garden flag where a garden token is configured; then the islands themselves, the
   200 most recently seen, with "showing 200 of N" past that.
9. **Limits.** The island budgets and their windows, `island_max_pending`, `max_islands` and the
   prune ages, as configured, and whether a garden island token is configured (a boolean; the token
   is never sent).
10. **Discovery.** `/api/discovery/status` campaigns (cases, decisions, active leases) and workers
    (label, host, backend, qualified, last seen); "discovery is not answering (status N)" when the
    plane is off or the call fails.

## What it deliberately does not show, and why

- **Islands by capability.** `Coordinator.Queue` reads an island's `capabilities` from each
  `/api/next` body and never stores them (its moduledoc and the README say so). Recording them would
  change the island record and the README's promise, in a module this slice may not touch. The page
  shows what a run needs, not what islands can do, and says so in the Islands section. The current
  runner (`packages/runner/src/island.ts`, `ISLAND_CAPABILITIES`) sends all four (`ponds-v1`,
  `ponds-v2`, `interventions-v1`, `breed-v1`); an island running older code sends fewer.
- **Refusal and pruning counts.** The coordinator counts no 429 (`CoordinatorWeb.IslandLimit`), no
  503 at the island bound and no forgotten island (`Coordinator.Queue`'s join). Counting them needs a
  counter on the island hot path or in the Queue, neither of which is an admin endpoint. The page
  shows the configured limits and the island table against `max_islands` instead, and says that
  refusals and pruning are not counted.
- **Per-segment listings** (`/api/experiments/:name`): not fetched by the polling page; `/api/status`
  already carries every number above.

## The one server change

`GET /api/status` (admin only, as before) gains two keys, computed in a new
`CoordinatorWeb.OpsStatus` from the Queue's status and config, outside the Queue process; every
existing key is unchanged:

- `limits`: `islands` (the island table's size), `maxIslands`, `islandMaxPending`,
  `islandPruneAfterMs`, `islandPruneGraceMs`, `budgets` (`join`, `next`, `segment`, `requests`, each
  `{limit, windowMs}`, `limit` `null` when off) and `gardenIslandToken` (boolean), read from config at
  call time, never with a second copy of a default.
- `capabilityNeeds`: for every experiment, for every one of its conditions, the sorted list of
  capabilities a segment of that run needs, by the Queue's rules: `ponds-v1` on a `:pond_presets`
  preset; `ponds-v2` (with `ponds-v1`) for `pond-nat` and `pond-shuf`; `breed-v1` (with `ponds-v1`) on
  a `:breed_presets` preset or for a `pond-breed-`, `pond-mass-` or `pond-drift-` condition;
  `interventions-v1` when the spec has `interventions`. These rules are a second copy of
  `Coordinator.Queue`'s private gating; a test holds the copy to the Queue's real behaviour (below).

## Pass criteria

ExUnit (`cd apps/coordinator && mix precommit`, green, warnings as errors):

- `limits` equals the configured values, follows `Application.put_env` changes, reports
  `gardenIslandToken` true only while a token is configured, and the raw `/api/status` body never
  contains the configured garden or admin token.
- For each case (a plain `spots` run; `spots` with interventions; `ponds-small` `treatment`;
  `ponds-small` `pond-nat` with the condition added to config as `queue_test.exs` does;
  `ponds-small` `pond-breed-mass`; `breeder` `treatment`), on a fresh queue: for every subset of the
  four capabilities that does not contain the reported `capabilityNeeds`, `Queue.next_task/2` gives a
  new island nothing; with exactly the reported set it gives that island a run task.
- A fixture of `/api/status` (`apps/coordinator/test/fixtures/ops-status.example.json`, what the
  Playwright check serves) has the same keys, recursively, as a real response driven to hold an
  experiment, a running island, a failed segment and a garden; a key added to or removed from either
  fails it.
- The page source contains none of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `eval(`, `new Function`, `localStorage`, `sessionStorage`, `<script src`, `<link` or an `http(s)://`
  URL in a `src` or `href`, and exactly one `<script>`.
- `/api/status` without the token is still 401, with no new key in the refusal.

Playwright (`tests/e2e/coordinator-ops.spec.ts`, Chrome, the page served by route interception from
`priv/static/index.html` with the admin and garden JSON mocked; `pnpm typecheck` clean):

- Before a token, the page asks for one and shows no data; after Connect, `/api/status` was asked
  with `authorization: Bearer <the token>`, the garden views without an `authorization` header, and
  the token field is empty.
- Every section above renders from the fixture: an experiment row with its open count and needs, the
  capability table's sums, a garden card with its state, days and keeper lines, the failures table,
  the islands by device type and by runner, the limits and the discovery section.
- A hostile experiment name, failure reason, island adapter and user agent
  (`<img src=x onerror="window.__pwned=1">`, `</td><script>window.__pwned=1</script>`) appear as
  literal text; no element the payload names exists, `window.__pwned` is undefined, no
  `a[href^="javascript:"]` exists, and the hostile garden name gets no curl line.
- A 404 and a 503 from one garden's view leave the rest of the page rendered; a 401 after connecting
  clears the data and asks for the token again; a failing discovery call shows its line and nothing
  else changes.
- At 375 px wide the page does not scroll sideways.
- A full-page screenshot is written to the test's output directory
  (`test-results/coordinator-ops-*/coordinator-ops.png`) and named in the PR body.

## Amendment, 2026-10-18 (after two Codex Sol 6.1 High reviews)

Two criteria are added; none above is relaxed.

- **Polling.** The page polls one request set at a time: the next poll starts three seconds after the
  previous one settled (not on a fixed interval), and every request is given up after five seconds.
  A slow garden view or discovery call therefore delays a refresh but cannot keep every refresh from
  rendering, as overlapping polls discarding each other as stale could. Playwright: with a discovery
  call that never answers in time, the page renders everything else, shows "discovery is not
  answering (no response)", picks up a later status change, and never has two discovery calls in
  flight at once (counted from the browser's own request events).
- **Fixture comparison.** The driven state also holds a real divergence and a real observation
  mismatch, so their element keys are compared with a real response instead of a written list, and
  every value of both sides, each array element included, is walked before any merging: a `null` is
  accepted only at `limits.budgets.join.limit` and `limits.budgets.requests.limit` (a budget that is
  off), so a section, element or field replaced by `null` fails rather than being skipped or merged
  away.

## Amendment, 2026-10-18 (after the slice's review round)

Changes to the rules above, from four reviews of the first version:

- **Keeper lines** come from the garden view's failed and diverged days *and* from the admin
  `failures` and `divergences` for the garden's run (segment index = day), once each, since the view
  shows only the newest 14 days and a day verified late can diverge behind them. The day rule is the
  keeper route's `[0-9]{1,9}` and the letter rule `^ltr-[0-9]{1,9}$`; the page's origin must also be
  a plain `http(s)://host[:port]`. Playwright: a hostile day and letter id get no line; a diverged day
  0 behind 14 blocked days gets its requeue line.
- **Verification wording.** A day verified by the same device type reads "replayed here, not yet
  verified elsewhere" and is not coloured as verified; the card's headline counts both kinds apart.
- **Polling.** Only while the tab is visible; backing off (doubling, at most 30 s) while polls fail;
  a failed or undrawable poll keeps the last view, dimmed, with the reason; a 401 clears the data,
  says whether a token was refused, and stops polling until a token is entered (this replaces "later
  requests carry no token"); the view holds while text on the page is selected. Each is a Playwright
  case.
- **Limits.** "Never with a second copy of a default" stands; a limit key missing from config is now
  named in `limits.unset` and shown as "not configured: the coordinator applies its built-in
  default" rather than as off. A `nil` pending cap reads "no cap". The prune rows say pruning happens
  only when the table is full.
- **Open work by capability** gains "runs with open work", at most one segment an island could take
  now per run.
- **Tests.** The capability cases add `pond-mass-` and `pond-drift-` conditions, interventions on a
  pond and on the breeder preset, and a garden; the fixture comparison checks every list element
  against the other side before merging; the page-source test also bans event-handler attributes
  and properties, `src`/`href` assignment, `srcdoc`, `Function(` and string timers.

## Amendment, 2026-10-18 (after the second Codex Sol 6.1 review)

- **Work by capability**: "runs with open work" claimed to bound what islands could take now, but replays
  of done segments go out in parallel, even from one run. The column is now "runs with open segments"
  (production is one segment at a time per run), and a "done, not verified" column bounds replay work from
  above; the status does not say which done segments are chosen for replay.
- **Keeper lines**: the garden view is read after the status, so for a day the view shows, its status wins;
  admin failure and divergence records only add days the view does not show.
- **Polling**: hiding the tab cancels the scheduled poll (the timer also checks visibility); a new Connect
  aborts the poll in flight; an empty Connect never replaces a token the page holds (a double click used to
  clear a good login).
- **Limits**: a budget's window key is checked as well as its limit key. `OpsStatus` sends a setting that is
  not an integer or `nil` as `null` and names it in `limits.invalid` (a keyword list used to make the
  response fail to encode). `island_requests_per_address` is no longer named in `unset`: its built-in
  default is off.
- **Fixture check**: dictionary values are compared one by one, like list elements; an optional key present
  on one side only is held to a type test; every feed must carry an `amount`.

## Amendment, 2026-10-18 (after the third Codex Sol 6.1 review)

- **Keeper lines**: the second amendment's "the view, read after the status, wins" was wrong: the public
  garden view is cached for `garden_cache_ms` (2 s by default) and ordinary segment transitions do not clear
  it, so a fresh status can list a day as failed while the view still shows it done. The page cannot tell
  which snapshot is newer, so a day the admin records list as failed or diverged is always offered; when the
  view shows that day in another state, the line says so (the requeue route answers 409 for a day that is no
  longer failed or diverged, so offering it is safe; hiding it loses a real failure).
- **Limits**: a budget's window diagnostic is shown whatever its limit says (an unset, invalid or off limit
  used to hide an invalid window, which IslandLimiter's sweep still reads). A window set to `nil` is named
  in `limits.invalid`: a window has no "off", and IslandLimiter's arithmetic on it raises. IslandLimiter
  also raises on a non-integer window such as `1.5`; that is outside this slice and is only reported.
- **Fixture check**: a `@nullable` path (a budget limit) that is `null` on one side must be an integer or
  `null` on the other.
- **Hidden-tab test**: status requests are counted inside the page (a `fetch` wrapper installed in the same
  task that hides the tab), not from a Node timestamp, so there is neither a race with a poll that fires
  while still visible nor a blind interval after hiding.
- **Malformed limit in the status**: a budget limit that is neither a number nor `null` reads "not a number
  in the status" instead of failing the whole render. This is a spot fix: other fields still go through
  `String()`, so a hostile object elsewhere makes the page say "The status could not be drawn" (honest; the
  limits `OpsStatus` sends are already integers or `null`).
- **Fixture check, negative test**: a test feeds the comparison a `null` budget limit against a string,
  boolean, float, list and object, both ways round, and expects each to fail.
