# Coordinator

To start your Phoenix server:

* Run `mix setup` to install and setup dependencies
* Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

## API notes

The JSON API under `/api` is documented where it is implemented: `Coordinator.Queue`'s
moduledoc (scheduling, verification, metrics-version and capability gating, the
experiment spec), `CoordinatorWeb.Router` (the routes) and `CoordinatorWeb.ApiController`
(bodies, uploads, status codes). The repository README has the operator's walk-through.

* `POST /api/experiments` takes the spec: `experiment`, `presetId`, `conditions`, `seeds`,
  `steps`, `segmentSteps`, `censusEvery`, and optionally `deepEvery`, `verifyFraction`,
  `metapopulation` and `interventions`. `interventions` is the headless runner's
  `RunSpec.interventions` (packages/runner/src/interventions.ts): a non-empty array of
  lesions `{"step","kind":"lesion","x","y","r"}` and feeds
  `{"step","kind":"feed","x","y","r","amount"}` by absolute step, steps non-decreasing,
  integers non-negative, a feed's `amount` non-zero within ±4096. A centre outside the
  preset's world (`:world_size` in config.exs), a feed in a pond preset, a feed's
  `matter` (the lab's replay assertion, which the archipelago cannot honour: a value
  the world does not reproduce would throw on every island, and the second island's
  replay is its check), an entry after `steps` and more than 10,000 entries are
  refused with 422, as are the shape errors, each with the runner's own wording. The
  list is stored as given and rides whole in every segment's task spec. A feed that
  would take the world past MATTER_MAX at its step cannot be checked at creation: an
  island that meets one reports the segment failed (below), so the experiment stops
  there rather than crashing islands or cycling the segment from island to island.
* `POST /api/segments/:id/fail` takes `{"lease", "reason"}`: the island holding the
  segment's current run or verify lease cannot run the task as given (today: a scheduled
  feed the world refuses at its step). Same lease rule as `reject` (409 otherwise, 422
  without a lease). The segment becomes `failed`, a terminal status: the reason (stored
  bounded to 500 graphemes and 2000 bytes; anything but a string counts as none) and
  the reporting island are recorded, the run's later segments are blocked as after a
  divergence, and no island is offered it again. `GET /api/status` counts it
  (`counts.failed`, a run's `failed`) and lists it under `failures`: `segment`, `run`,
  `index`, `kind` (`run` or `verify`), `island` (its id), `by` (its adapter, as the
  divergences' hosts are named), `failedAt` (ms since the epoch) and `reason`; the
  experiment listing shows the segment's `status` and, only on a failed segment, a
  `failure` object with the same `kind`, `island`, `by`, `failedAt` and `reason`. The
  one way out is an upstream reject, which resets the failed segment with every other
  descendant, since the world it failed against is recomputed. A `state.bin` holding a
  failed attempt cannot be loaded by a coordinator from before this change (its
  modules name neither new key), as with every key added since v3: do not roll the
  code back over one, or start from a fresh data dir.
* `POST /api/next` takes `{"capabilities": [...]}`, which gates the work offered to that
  request alone: `ponds-v1` for a pond preset's experiments, `ponds-v2` as well for the hunt's arms
  (`pond-nat`, `pond-shuf`), `breed-v1` in addition to `ponds-v1` (never instead) for the breeder (a `pond-breed-*`,
  `pond-mass-*` or `pond-drift-*` condition, and every run of a `:breed_presets` preset,
  `breeder`), `interventions-v1` for an experiment with `interventions`.
  Work an island's list cannot run is skipped, never waited for. A list of more than 16
  entries, or with an entry that is not a string of at most 64 bytes, counts as none.
  The Queue also records the island's most recent list on its record, for the operator
  page only (`GET /api/status`'s `islands[].capabilities`): the names that match
  `[a-z][a-z0-9]*(-[a-z0-9]+)*` within 32 bytes, deduplicated and sorted, keeping every
  name above and at most four others, the first in sorted order (so at most 8 names),
  updated on every `next`
  (task or idle) and removed when nothing is storable. That record never grants a task:
  an island that once advertised `ponds-v1` and then asks without it is not offered pond
  work. `/api/islands/me` does not show it. A `state.bin` holding a recorded list
  cannot be read back safely by a coordinator from before this change (it refuses the
  file, or passes the stale list through its `/api/status` and `/api/islands/me`), as
  with every key added since v3: do not roll the code back over one, or start from a
  fresh data dir (docs/coordinator-hardening-2026-10-18.md).
* A verify completion's `observationDigests` may name `interventions.jsonl` beside the
  other optional files (`migrations.tsv`, `exchanges.tsv`, `species.tsv`, `ponds.tsv`);
  the lists in `Coordinator.Segment` and `CoordinatorWeb.ApiController` are pinned to
  `packages/runner/src/stitch.ts`'s `VERIFIED_FILES` by
  `packages/runner/test/coordinator-files.test.ts`, and the preset facts in config.exs
  (`:world_size`, `:pond_presets`, `:pond_period`, `:breed_presets`, `:migration_period`) to
  `packages/schema`'s presets by `packages/runner/test/coordinator-presets.test.ts`, and
  `:conditions`, `:incompatible` and the queue's breeder prefixes to the runner's own
  refusals by `packages/runner/test/coordinator-conditions.test.ts`.

### Island limits

Budgets kept outside the Queue process (`Coordinator.IslandLimiter`), all in config.exs
("Island abuse controls") and read at call time. Any budget may be `nil` (off).

* Every limit, window, cap and cache setting is checked when the application starts, in
  every environment (`Coordinator.ConfigCheck`, called first by
  `Coordinator.Application.start/2`): a value of the wrong shape stops the boot with a
  message naming the key. Windows, the table caps, `max_islands`, `lease_ms`,
  `discovery_lease_ms`, the garden's letter window and table cap, its hand sweep and
  hands call timeout must be positive
  whole numbers (a window of `0`, once clamped to 1 ms, is refused); the four food keys must sit
  in their ranges (asks 2..1000, every 1..365 days, amount 1..64, radius 1..32,
  `ConfigCheck.food_range/1`), and so must the three meteor keys (asks 2..1000, every 1..365 days,
  radius 33..255, `ConfigCheck.range/1`), refused at boot by name; the budgets (`island_joins_per_address`,
  `island_next_per_island`, `island_segment_requests_per_island`,
  `island_requests_per_address`) and `island_max_pending` are `nil` (off) or positive
  (a config `0` is refused: switch a budget off with `nil`); `island_prune_after_ms`,
  `island_prune_grace_ms`, `public_status_wait_ms`, `garden_cache_wait_ms`,
  `garden_letters_per_address` and `garden_refusals_per_address` are whole numbers of 0
  or more (a garden letter count of `0` closes the letter box, as before); `public_status_cache_ms` and `garden_cache_ms` any whole number
  (0 or less is off). A float, a string, a boolean or a list is never a whole number. A
  key left out of config passes (its consumer applies a default). A value changed later
  with `Application.put_env/3` is not checked again; `GET /api/status`'s
  `limits.invalid` names such a change only for the island limit keys it shows, and
  only when the value is not an integer (or is a `nil` window). The environment variables `BL_ISLAND_JOINS_PER_ADDRESS`,
  `BL_MAX_ISLANDS` and `BL_DISCOVERY_LEASE_MS` stop the boot by name in
  `config/runtime.exs` on anything but a positive whole number (or `off`, where a budget
  allows it).

* `POST /api/islands`: at most `island_joins_per_address` (20) joins per client address
  per hour. The address is the garden's: the peer, or the right-most `X-Forwarded-For`
  entry with `trust_forwarded_for` (`BL_TRUST_FORWARDED_FOR=1`); an IPv6 address counts as
  its /64. Addresses are kept only as salted hashes, in memory, and a restart forgets
  them. **Off in production** (`config/prod.exs`) until the proxy passes on client
  addresses, because until then every visitor is one address and the budget would be one
  global cap (deploy/README.md). `BL_ISLAND_JOINS_PER_ADDRESS` sets it at runtime
  (`20`, or `off`; blank leaves the config alone; anything else stops the boot).
* `POST /api/next`: at most `island_next_per_island` (120) calls per authenticated island
  per minute, counted after authentication (a 401 costs nothing). A runner asks every
  5–10 s while idle, so it never comes near this.
* Segment routes (heartbeat, complete, reject, fail, checkpoint and file uploads,
  checkpoint downloads, and an island's file downloads; an administrator's exports are
  never charged): at most `island_segment_requests_per_island` (600) per
  authenticated island per minute, counted after authentication. Most of these rewrite
  `state.bin`, so this bounds what one island can make the Queue write.
* An island holds at most `island_max_pending` (4) pending assignments; past that
  `next` answers idle, so one island cannot claim the queue's work and sit on it.
* `island_requests_per_address`: a ceiling per address across the island routes (all but
  file downloads, which administrators also use for exports), charged before authentication;
  `nil` (off) by default. Switch it on only once the proxy passes on real client addresses
  (deploy/README.md), or every visitor shares it.
* Windows are fixed, not sliding (like the garden's letter budget), so a client can spend a
  budget at the end of one window and again at the start of the next. The budget table is
  capped (`island_limit_table_max`, 200,000 rows): past it a new key, an address or an
  island id, is refused until its window ends, so a flood of distinct addresses (rotating
  IPv6 /64s) can lock out new joiners for up to an hour, as with the letter budget. Island
  ids count too, because an island forgotten at the island bound leaves its counters until
  the sweep.
* Over a budget the answer is 429 with `Retry-After` (whole seconds, rounded up) and
  `{"error": ..., "retryAfterMs": n}`. The runner (`packages/runner/src/island.ts`) does not
  retry: any non-OK join, `next` or upload stops the island, and a volunteer must start it
  again (heartbeat failures are only logged). A 503 from the island bound is the same.
* Join and next bodies are JSON only and at most 16 KB (413), parsed before the
  endpoint's 8 MB parser (`CoordinatorWeb.IslandBodyLimit`). Any other content type is a
  415 before its body is read, so `curl -d '{...}'` (form-encoded by default) needs
  `-H 'content-type: application/json'`; the runner and the Deno island already send it.
  A body with no content type is read up to the same 16 KB and dropped (413 past it); its
  params are empty, as before.
* The island table holds at most `max_islands` (20,000; `BL_MAX_ISLANDS`). At the bound a
  join reclaims expired leases, then forgets every island that never ran or verified
  anything, holds no pending attempt and was last seen more than a day ago
  (`island_prune_after_ms`); if none is that old, the least recently seen such islands
  not seen in the last ten minutes (`island_prune_grace_ms`), a twentieth of the bound (a
  waiting island asks every few seconds, so islands that never ask go first). An island
  that has just joined, or is waiting for work, is never forgotten to make room for
  another: if no island qualifies the join is answered 503
  `{"error": "the coordinator has no room for new islands"}`, so a join flood at the bound
  costs new joiners a 503 rather than costing existing islands their credentials.
* `GET /api/public/status` (and `/healthz`, which the site's Caddy rewrites to it) is
  served from a `public_status_cache_ms` (2 s) cache, counted from when the numbers were
  computed; concurrent misses are coalesced into one Queue call, and only that caller
  ever asks the Queue (a cold cache's other callers wait up to `public_status_wait_ms`
  for it, then answer 503 with `Retry-After: 1`; a Queue call that exits is served the
  expired entry if there is one, else the same 503, never a 500). Its `updatedAt` is when
  the numbers were computed. It carries only `counts`, `activeIslands`, `deviceTypes` and `updatedAt`.
  `/api/status`, `/api/experiments/:name` and `/api/discovery/status` need the admin
  token.
* `GET /api/status` also carries three keys for the operator page, computed outside the
  Queue process by `CoordinatorWeb.OpsStatus`: `limits` (`islands`, the island table's
  size; `maxIslands`, `islandMaxPending`, `islandPruneAfterMs`, `islandPruneGraceMs`;
  `budgets.join`, `.next`, `.segment` and `.requests`, each `{limit, windowMs}` with
  `limit` `null` when off; `gardenIslandToken`, whether a garden island token is
  configured, never the token; `unset`, present only when one of these keys is
  missing from config, naming it: its value is then `null` here while its consumer
  applies a built-in default (`island_requests_per_address`, whose default is off, is
  never named); and `invalid`, present only when one is set to something other than an
  integer or `nil` (or a budget window to `nil`: a window has no "off"), naming it, its
  value then `null` so the response still encodes),
  all read from config at call time; and
  `capabilityNeeds` (experiment => condition => the sorted capabilities its run's
  segments need, by the `/api/next` rules above, held to `Queue.next_task/2` by
  `test/coordinator_web/ops_status_test.exs`); and `islandCapabilities`, the islands by
  their recorded capabilities (above): `byCapability`, name => `{islands, live, known}`
  (`live`: not stale; `known`: the coordinator gates on the name; every gated name and
  at most 50 others, those on the most islands), `omittedNames` (how many other names
  were left out), and `none`, `{islands, live}`, the islands with no recorded list (they
  advertised nothing storable, or have not asked since this change: after an upgrade an
  island busy on a long task counts here until its next `next`). A `state.bin` list the
  code could not have written is cleaned (or dropped) on load. A recorded list is as of the island's last ask,
  not a promise. Nothing counts refusals (429s, the 503 at the island bound) or
  forgotten islands, so neither is reported.
* CORS: production allows no cross-origin caller unless `BL_CORS_ORIGINS` names one, and
  refuses to start unless each is a whole https origin as a browser sends it
  (`https://host` or `https://host:port`, lowercase, no wildcard, path or slash).

### Operator page

`priv/static/index.html` (served at `/index.html`; `/` redirects to it) is a single static
page with one inline script, no build step and nothing loaded from elsewhere. It asks for
the admin token, keeps it in memory only, and sends it only to `/api/status` and
`/api/discovery/status`; each garden's card reads the public `/api/public/gardens/:name`
without it. It polls three seconds after the previous poll settled, only while the tab
is visible, backing off to 30 seconds while polls fail; a failed poll (a timeout, a 5xx)
keeps the last view, dimmed, and a 401 clears it and stops polling until a token is
entered. Hiding the tab cancels the next poll; a new Connect cancels the poll in flight,
and an empty Connect never replaces a token the page holds. While text on the page is
selected it holds the view, so a line can be copied.
It shows totals, experiments (kind, the capabilities their runs need, and open segments:
pending or running), work by capability (gardens left out; runs with open segments, of
which a run can have one produced at a time, open segments, and done segments not yet
verified, an upper bound on replay work, which can go out several at once; and the live
islands whose last ask advertised all of a row's needs, which is not a promise, since
work is gated on each request), each garden's day state with its keeper actions, failures, divergences,
observation mismatches, islands by device type, by runner and by capability as last
advertised (with a row for islands with none recorded; a coordinator whose status has
no `islandCapabilities` is said to record none) with the 200 most recently seen listed,
the configured limits and the discovery plane. It only reads: keeper
actions (requeue a failed or diverged day, drop a waiting letter) are printed as `curl`
lines with `$BL_ADMIN_TOKEN` written literally, and only for names, days and letter ids
that pass the coordinator's format rules (the experiment-name rule, `[0-9]{1,9}`,
`ltr-[0-9]{1,9}`). A day to requeue is taken from the garden view's newest days and from
the admin failures and divergences, so one older than the days shown is still offered.
Neither snapshot is known to be the newer (the public view is cached for
`garden_cache_ms`), so a day the admin records list as failed or diverged is offered even
when the view shows it otherwise, with the conflict said; a requeue of a day in any other
state is refused with 409.
A same-device-type replay is shown as "replayed here, not yet verified elsewhere".
Server text is put on the page as text, never
parsed as markup (`test/coordinator_web/status_page_test.exs`;
`tests/e2e/coordinator-ops.spec.ts` checks it in a browser against
`test/fixtures/ops-status.example.json`, which `ops_status_test.exs` holds to the keys of a
real response). The rules it was built to are in `docs/ops-dashboard-2026-10-18.md`.

## The garden (contract `garden-v1`)

A garden is one shared, open-ended world tended by volunteer islands: bet 4 of
the roadmap, designed in `docs/shared-garden-brainstorm-2026-10-09.md`. The
first is the commons on the big storm (`wild-storm-large`). It keeps
**archipelago time with Tamagotchi honesty**: islands advance it, the step count
is public, and it sleeps when nobody tends it. It is **paced**: at most one day
of steps is released per dawn (131,072 steps, one sun wander on the big jar, the
note's provisional pace), and missed dawns do not bank. Visitors write
**letters** (today: stones, a lesion at a place) that land at a day's end step,
are public before they land, and are replayed by a second island before they
count. A garden founded with food also takes **hands**: food is rare and
collective (docs/garden-food-2026-10-18.md), a modest feed at the world's centre
that lands only when enough networks ask within one dawn period, at most once
every few days. A garden founded with meteor takes meteor hands the same way
(docs/garden-meteor-2026-10-18.md): a meteor is a stone of a large fixed radius
(64 by default) at a place fixed by rule before anyone asks, rarer still. A
garden is never a registered experiment or a source of registered evidence.

Underneath, a garden is an ordinary experiment (one run: condition `treatment`,
one seed, `segmentSteps` = one day, `verifyFraction` 1, every day replayed by a
different island) whose `interventions` are the founding schedule plus the
letters, so islands need `interventions-v1` and verification is the existing
segment verification. Its public view is `GET /api/public/garden`.

The fixture `priv/static/garden-contract.example.json` is a complete example of
that view, served by a dev coordinator at `/garden-contract.example.json` so a
front end can mock against it. It shows a garden that has slept 38 hours with
its next day due, a day done and not yet verified, two verified days, letters
waiting (one day's budget already full), a landed letter, a verified one and a
dropped one, a verified food on day 1 and two hands on the open food ask, and a
meteor landed on day 2 (done, not yet verified) with the meteor ask closed for its
cooldown. Every key in it is always present in a real response (a value may
be `null` where the fixture says so below); `test/coordinator_web/garden_contract_test.exs`
fails if a real response's keys and the fixture's differ.

### Words

* **Day *d*** is segment *d* of the garden's run: steps `d·D` to `(d+1)·D`, with
  `D` = `pace.stepsPerDay`. Days are numbered from 0.
* **Dawn** is a point on a fixed grid of real time: `dawnOffsetMs + n ·
  dawnPeriodMs` (ms since the epoch, UTC; default every 24 hours at 00:00 UTC).
* **Release.** Day 0 is released when the garden is created. Day *d*+1 is
  released at the first request for work from an island (`POST /api/next`) at
  which day *d* is done or verified **and** a dawn has passed since day *d* was
  released. So a garden advances at most one day per dawn period (in any *n*
  dawn periods at most *n*+1 days are released), a garden nobody tends releases
  nothing, and a keeper who returns after a week gets one day, not seven.
  Islands take released days as ordinary run segments.
* **Letters land at a day's end.** A letter carried by day *d* is applied at
  step `(d+1)·D`, after that step's census and before its checkpoint (the
  runner's ownership rule: an intervention at step *s* belongs to the segment
  that stepped *to* *s*). The day's end checkpoint, and every later day, carries
  it.
* **The frontier.** A letter may only be carried by a day that holds no
  attempt (no island is running or verifying it, and none has). A posted letter
  goes to the first such day whose budget (`letters.perDay`) is not yet full. A
  day's letters are fixed for as long as it holds any attempt. An upstream
  reject that resets a day (clears its attempts) discards its results and
  reopens it: its letters are `"waiting"` again and may be dropped or joined by
  new ones before it is run afresh. So a run and its replay still always carry
  the same letters.

### `GET /api/public/garden` and `GET /api/public/gardens/:name`

No authentication, `cache-control: no-store`, no island ids, tokens or adapter
strings. `/api/public/garden` is the garden named by config `:public_garden`
(default `"commons"`); `/api/public/gardens/:name` reads any garden. 404
`{"error": "not found"}` when there is no such garden. A response may be up to
two seconds old (it is cached outside the queue process), plus the time one
refresh takes while a crowd is served the expired copy; a letter posted or
dropped through these routes is never followed by an older view, and neither is
a day becoming verified (the queue clears the cache as it records it). All times are
integers, ms since the epoch; all steps are absolute.

`503 {"error": "the garden is busy; retry shortly"}` with `Retry-After: 1`: the
view was not cached and another request has been fetching it for longer than
the wait (two seconds); retry. The 200 body is unchanged.

| Key | Meaning |
| --- | --- |
| `contract` | `"garden-v1"`. A change that removes or retypes a key bumps it; added keys do not. |
| `name`, `presetId`, `seed` | The garden, its preset and its seed. |
| `world` | `{width, height}` in cells; letters' `x` and `y` are cells in it. |
| `founding` | The founding schedule, applied at step 0: lesions `{step, kind: "lesion", x, y, r}` and feeds `{step, kind: "feed", x, y, r, amount}`, as the keeper set it. On the commons the founding feed stands in for the start nutrient §6.1 found missing. |
| `createdAt`, `now` | When the garden was created; the coordinator's clock when this response was built. |
| `state` | `"growing"` (an island holds today's day), `"waiting-for-island"` (a day is released and untaken, or its release is due and no island has asked), `"resting"` (the newest day is done and the next dawn has not come), `"stopped"` (a day diverged or failed; nothing after it runs), `"finished"` (every day of the horizon is done). |
| `asleep` | `state` is `"waiting-for-island"` and no island has touched the garden in the last two minutes. |
| `pace.stepsPerDay` | `D`, steps released per dawn (131,072 on the commons). |
| `pace.dawnPeriodMs`, `pace.dawnOffsetMs` | The dawn grid. |
| `pace.nextReleaseAt` | The earliest time the next day can be released, or `null` while the newest released day is not done (or the garden is stopped or finished). |
| `pace.releaseDue` | `nextReleaseAt` has passed: the next island to ask gets the next day. |
| `pace.nextDawnAt` | The first dawn after `now`. |
| `clock.step` | The tip: the end step of the newest day done (verified or not); 0 before day 0 is done. |
| `clock.verifiedStep` | The end step of the longest run of verified days from day 0; 0 if day 0 is not verified. |
| `clock.releasedStep` | The end step of the newest released day. |
| `clock.horizonStep` | `daysTotal · D`, where the garden stops. |
| `clock.daysDone`, `clock.daysTotal` | Days done (verified or not), and the horizon in days. |
| `clock.lastMovedAt` | When the newest day was done, or `null`. |
| `clock.sleptMs` | `now − lastMovedAt` while the garden is not growing; 0 while growing; `null` if it never moved. |
| `tending.windowMs` | 86,400,000: "today" is the last 24 hours. |
| `tending.islandsToday` | Islands that ran or replayed a day of this garden in the window. Two tabs on one computer are two islands. |
| `tending.deviceTypesToday`, `tending.deviceTypesEver` | Distinct GPU adapter descriptions among them (in the window; ever): a lower bound on computers, never an identity. |
| `tending.activeNow` | Islands holding a live lease on a day of this garden. |
| `verification.daysDone`, `verification.daysVerified` | Days done; days whose replay by a different island matched the producer's digest (physics and observers). |
| `verification.byDifferentDeviceType`, `verification.bySameDeviceType` | Verified days whose replaying island reported a different / the same adapter description as the producer. Same-device-type may be the same computer: the page should say "replayed here, not yet verified elsewhere". |
| `verification.diverged`, `verification.failed` | Days whose replay disagreed; days an island reported it could not run as given. |
| `verification.share` | `daysVerified / daysDone`, rounded to 4 places; `null` before any day is done. |
| `census` | The newest done day's end-of-day numbers, or `null`: `day`, `step`, `individuals`, `lineages`, `maxGeneration`, `mutations`, `extinct`, `conservationOk` (each a number or boolean, or `null` when the island did not report it), `verified` (that day is verified), `source` (`"producer"`: reported by the island that ran the day; the digest, not these numbers, is what the replay checks). |
| `tip` | `{day, step, digest, verified}` of the newest done day, or `null`. `digest` is the 16-hex-digit artifact digest. `verified` is that day's own replay (`days[].status`, `census.verified` likewise); `clock.verifiedStep` and `fork` are the prefix. |
| `fork` | The end checkpoint of the newest day of the verified prefix (`clock.verifiedStep`: every day from 0 verified), or `null`: `{day, step, digest, checkpoint}`, `checkpoint` being the path that serves it (below). A day verified while an earlier day is not is not offered: it was replayed from a checkpoint nobody has checked. |
| `days` | The newest released days, newest first, at most 14: `day`, `startStep`, `endStep`, `status`, `releasedAt`, `doneAt`, `verifiedAt`, `digest`, `verification`, `letters`, `food`, `meteor`, `census`, `leaders`. |
| `days[].status` | `"waiting"` (released, no island holds it), `"growing"`, `"done"`, `"verified"`, `"diverged"`, `"failed"`, `"blocked"` (after a diverged or failed day). |
| `days[].doneAt`, `verifiedAt`, `digest` | `null` until done / verified. |
| `days[].verification` | `"different-device-type"`, `"same-device-type"`, or `null` when not verified. |
| `days[].letters` | Ids of the live (not dropped) letters the day carries. |
| `days[].food` | The id of the live food the day carries (`"food-<n>"`), or `null`. A day carries at most one. |
| `days[].meteor` | The id of the live meteor the day carries (`"meteor-<n>"`), or `null`. A day carries at most one; it may carry a food too. |
| `days[].census` | As `census` without `day`, `step`, `verified`, `source`; `null` until done. |
| `days[].leaders` | Who held the field at the day's end, counted from the day's verified files (below); `null` unless the day is verified. Added in the contract's additive way, so still `garden-v1`. |
| `letters.perDay`, `letters.queueMax` | The garden's budget: letters one day carries; letters waiting at once. |
| `letters.queued` | Letters waiting now. |
| `letters.nextLanding` | Where a letter posted now would go: `{day, step, open}` (`open` = slots left on that day), or `null` when the garden takes no letters (queue full, log full, stopped or finished). |
| `letters.waiting` | Every waiting letter, oldest first. |
| `letters.recent` | The newest 32 letters that are not waiting, newest first. |
| letter | `id` (`"ltr-<n>"`), `kind` (`"stone"`), `x`, `y`, `r`, `postedAt`, `landsAtStep`, `day` (the day that carries it), `status`, `landedIn` (the carrying day's digest once done, else `null`), `droppedAt` (`null` unless dropped). |
| letter `status` | `"waiting"` (its day has never been assigned; the keeper may drop it), `"sealed"` (its day is assigned: fixed), `"landed"` (its day is done), `"verified"` (its day is verified), `"dropped"` (the keeper's veto, before its day was assigned), `"stalled"` (its day diverged, failed or is blocked). |
| `food` | The food ask (always present; added in the contract's additive way, so still `garden-v1`). A food is a feed (`{step, kind: "feed", x, y, r, amount}` in the experiment's schedule), never a letter: it is in no `letters` list and in no `days[].letters`. |
| `food.enabled` | The garden was founded with food. `false` for every garden founded without it (then `closed` is `"off"` and the rule's numbers are `null`). |
| `food.asks`, `food.everyDays` | K, the distinct networks that must ask within one dawn period, and N: a food lands at most once every N garden days. `null` when off. |
| `food.amount`, `food.r`, `food.place` | Each food: `amount` quanta of nutrient per cell over a disc of radius `r` at `place` `{x, y}`, the world's centre. Fixed when the garden was founded. `null` when off. |
| `food.hands` | Hands this dawn period (0 when off). Only the count is kept public; the hands themselves are salted hashes held in memory only, and a coordinator restart forgets them. |
| `food.expiresAt` | The next dawn, when this period's hands expire if they have not reached `asks`. |
| `food.sharedAddress` | `true` when every visitor reaches the coordinator as one address (production until the proxy passes client addresses on, deploy/README.md: config `:garden_shared_address`, cleared by `BL_TRUST_FORWARDED_FOR=1`). The ask can then hold one hand at most, so `asks` (at least 2) is never reached, a 200 may be another visitor's hand, and the one counted hand spends a letter from the one budget stones share (a repeat or a 409 gives its letter back and is charged as a refusal instead); a page should say so. |
| `food.open`, `food.closed` | Whether a hand can be added now; when not, why: `"off"`, `"stopped"`, `"finished"`, `"horizon"` (no day is left before it that the spacing allows), `"log-full"` or `"cooldown"` (a live food is fewer than N days from the next free day). `closed` is `null` exactly when `open`. |
| `food.opensAtDay` | With `"cooldown"`, the first day a food could land on; else `null`. |
| `food.landing` | `{day, step}` where a food called now would land (the frontier day, at its end step, after that step's stones), or `null` when closed. |
| `food.foods` | The newest 32 foods, newest first, live and dropped. |
| food | `id` (`"food-<n>"`), `x`, `y`, `r`, `amount`, `calledAt` (when the K-th hand called it), `noticeUntil` (`calledAt` plus one dawn period: its day is not given to an island to run before this, so the keeper's veto always has that long; a reset that reopens the day does not restart it), `hands` (K), `landsAtStep`, `day`, `status` (the letter statuses, with the same meanings), `landedIn` (the carrying day's digest once done, else `null`), `droppedAt` (`null` unless the keeper dropped it). |
| `leadersRule` | `{name: "lines-v1", top: 3, clearLeaderPercent: 10}`: the rule `days[].leaders` follows (always present). |
| `meteor` | The meteor ask (always present; added in the contract's additive way, so still `garden-v1`), shaped as `food` without `amount`. A meteor is a lesion (`{step, kind: "lesion", x, y, r}` in the experiment's schedule, after that step's stones and foods), never a letter: it is in no `letters` list and in no `days[].letters`. Its ask is independent of food's: its own hands, spacing and records. |
| `meteor.enabled` | The garden was founded with meteor. `false` otherwise (then `closed` is `"off"` and the rule's numbers are `null`). |
| `meteor.asks`, `meteor.everyDays` | K and N, as for food: a meteor lands at most once every N garden days, counting meteors only. `null` when off. |
| `meteor.r` | Every meteor's radius (config `:garden_meteor_radius`, 64), fixed when the garden was founded. `null` when off. |
| `meteor.place` | `{x, y}` where the *next* meteor would land: the *n*-th meteor lands at `x = u32be(H[0..3]) mod width`, `y = u32be(H[4..7]) mod height`, `H = SHA-256("<name>/seed-<seed>/meteor-<n>")`. Fixed before anyone asks; no visitor chooses it; a dropped meteor keeps its number, so the next is at the next place. `null` when off. |
| `meteor.hands`, `meteor.expiresAt`, `meteor.sharedAddress`, `meteor.open`, `meteor.closed`, `meteor.opensAtDay`, `meteor.landing` | As the food block's (the same codes; a food never closes the meteor ask, nor a meteor the food's). |
| `meteor.meteors` | The newest 32 meteors, newest first, live and dropped. |
| meteor | `id` (`"meteor-<n>"`), `x`, `y` (its place, stored when it was called), `r`, `calledAt`, `noticeUntil` (as a food's: its day is not run before this), `hands`, `landsAtStep`, `day`, `status` (the letter statuses), `landedIn`, `droppedAt`. |
| `limits` | `stoneRadius {min, max}`, `lettersPerAddressPerHour` (letters, food hands and meteor hands together), `logMax` (founding plus live letters plus live foods plus live meteors, at most). |

### Who held the field (`days[].leaders`)

The rule is pre-stated in docs/garden-predictions-2026-10-18.md. A verified day's block is
`{status, census, lines}`:

- `status`: `"ok"` (counted), `"pending"` (being counted: the queue counts a day in a task of its
  own once it is verified, at most two days at a time, so this lasts moments, or longer while many
  verified days are counted after a start), `"unchecked"` (verified, but the replaying island did
  not regenerate every observation file byte for byte for the accepted run, or reported no digests:
  there are no numbers for this day) or `"unreadable"` (the files did not parse, or the count could
  not finish; counted once more at each start of the coordinator).
- `census` (`null` unless `ok`): `{step, livingCells, lineages, top, clearLeader}`, read from the
  day's `lineages.tsv` rows at its end step. `top` is the three biggest lineage keys by cells (ties:
  the smaller birth step `hi`, then the smaller cell `lo`), each `{key, label, cells, share}`; `share`
  is cells over `livingCells`, rounded to 4 places; `label` is made from the key (`founder <lo>`,
  `born step <s> at <x>,<y>` or `born step <s>, cell <lo>`). `clearLeader` is the biggest key when it
  holds at least 10% of the living cells and strictly more than the second, else `null`.
- `lines` (`null` for day 0, unless `ok`, and while the day before has no `ok` block):
  `{fromDay, groups, rest, winner}`. Each of day `fromDay`'s three biggest keys, in its order, is
  counted together with the keys descended from it through the mutations born on the two days
  (both days' `mutations.tsv`, the nearest of the three when one descends from another); `groups`
  are `{key, label, cells, share}` of this day's living cells and `rest` `{cells, share}` the cells
  of every other key. `winner` is the group with strictly the most cells (a key, or `"rest"`), or
  `null` on a tie or when nothing is living.

The numbers come only from files of a day that is verified with the observation match (the
replaying island's SHA-256s of the six observation files equal the producer's uploads): the bytes
parsed are bytes a second island produced independently. Nothing else feeds them; the producer's `census` is not used.

Predictions are never sent here; there is no route for them. A page may keep a visitor's guess on
the visitor's own device and check it against these blocks once the next day is verified.

### `POST /api/public/garden/letters` and `POST /api/public/gardens/:name/letters`

No authentication. The body is exactly `{"kind": "stone", "x": <int>, "y":
<int>, "r": <int>}`: `x` and `y` cells inside the world, `r` within
`limits.stoneRadius` (1 to 32). No other key, no free text, no name: letters are
public and carry nothing about who wrote them.

* `201 {"letter": <letter>}` (status `"waiting"`, with its `day` and `landsAtStep`).
* `422 {"error": ...}`: not a stone as above, or its centre is outside the world.
* `413`: a body over 1 KB (a letter is about 40 bytes; the body is not parsed past that).
  For a chunked request (no `Content-Length`) the limit is under 1 KB: a body of
  exactly 1,024 bytes may also be refused.
* `415`: a body that is not JSON (a form, multipart, text); it is not read. The
  route is recognised however its path is percent-encoded, so neither limit
  can be stepped around.
* `429 {"error": ..., "retryAfterMs": <int>}` with a `Retry-After` header (seconds):
  more than `lettersPerAddressPerHour` letters from one network address in the
  current hour. The address is kept in memory only, salted and hashed, for at
  most the hour; it is never written to disk. An IPv6 address counts as its /64
  and an IPv4-mapped one as its IPv4 address. Behind a reverse proxy set
  `:trust_forwarded_for` so the address is the right-most `X-Forwarded-For` entry
  (and firewall the origin port to the proxy, or a client names its own address).
  A letter the queue refuses (409) is given back, but the refusal counts against
  the address (`garden_refusals_per_address` per hour, default 20), after which it
  is answered 429 as well.
* `409 {"error": ...}`: the garden takes no letters now (`letters.queued` at
  `queueMax`, the log at `logMax`, the garden stopped or finished, or no day left
  before the horizon).
* `404 {"error": "not found"}`: no such garden.

### `POST /api/public/garden/food/hands` and `POST /api/public/gardens/:name/food/hands`

No authentication. A visitor's hand on the food ask. The body is exactly `{}`,
sent as `application/json` (the JSON content type is what makes a hand from
another site's page need a CORS preflight, which the coordinator refuses, so no
other page can add its visitors' hands). A hand carries nothing: no place, no
name, no text. One hand per network per dawn period, the network an IPv4 address
whole or an IPv6 address's /48 (coarser than the letter budget's /64: one /48
holds 65,536 /64s; a network is still not a person, and one person with several
connections can be several hands). Hands are only as distinct as the addresses
the coordinator sees: behind a proxy that hides them (`food.sharedAddress`) every
visitor is one network. A repeat is answered as a repeat (200) before the ask's
state, so after the K-th hand closed the ask the other K-1 still get 200. The
hand that brings the period's count to `food.asks` calls the food at once: it is
written to the garden then, public as `"waiting"`, on `food.landing`'s day, and
the count goes back to zero; the networks that gave a hand stay remembered until
the dawn, so if the keeper drops the food the same period needs `asks` other
networks to call another. Hands short of `asks` expire at the next dawn.

* `201 {"counted": true, "called": null | <food>, "food": <the food block>}`:
  the hand is counted; `called` is the food when this hand called it.
* `200 {"counted": false, "called": null, "food": ...}`: this network's hand is
  already in this period (not an error: a visitor who reloads learns their hand
  is in).
* `409 {"error": ..., "closed": <code>, "opensAtDay": <int> | null}`: the ask is
  closed, `closed` as `food.closed` (with `"cooldown"`, `opensAtDay` is the first
  day a food could land).
* `422 {"error": ...}`: a body other than `{}`.
* `413`, `415`: as for a letter (over 1 KB; not JSON, including no content type
  at all).
* `429 {"error": ..., "retryAfterMs": <int>}` with `Retry-After`: a hand costs
  one letter of the network's hourly budget (`lettersPerAddressPerHour`; hands
  and stones share it). A repeat (200) or a closed ask (409) is given back but
  charged as a refusal, as a refused letter is.
* `404`: no such garden. `503 {"error": ..., "counted": false}` with
  `Retry-After: 1`: the rate limiter is restarting (or restarted while the hand
  waited) and cannot key a hand; nothing was counted and the letter is given
  back. `503 {"error": ..., "counted": null}`: the queue did not answer in time
  (`:garden_call_timeout_ms`, 5 s); the hand may still count when it catches up,
  so the letter is kept and a page should read the count again.
* A zero-byte body (`content-length: 0`) is a 422, like any body but `{}`.

While a food is waiting (its day not yet assigned) the ask stays closed
(`"cooldown"`) until N days past it, even if a reset of later days moves the
frontier back before it: at most one food is ever waiting. A coordinator restart
forgets the period's hands (it fails toward no food); a food already called is in
the garden's record and survives. A period's hands are forgotten within a minute
of its dawn whether or not anyone asks again, and no status or crash report of
the queue process shows them.

### `POST /api/public/garden/meteor/hands` and `POST /api/public/gardens/:name/meteor/hands`

No authentication. A visitor's hand on the meteor ask, exactly as a food hand
(above): the body `{}` sent as JSON, one hand per network (IPv4 address, IPv6
/48) per dawn period, the same answers with the `meteor` block in place of the
food block (`201 {"counted": true, "called": null | <meteor>, "meteor": ...}`,
`200 {"counted": false, "called": null, "meteor": ...}`, `409 {"error",
"closed", "opensAtDay"}`, 422, 413, 415, 404, 429, and both 503s). A meteor hand
costs a letter of the same hourly budget that stones and food hands share. The
meteor hands are kept apart from the food hands: one network may give one of
each in a period, and each costs a letter. The K-th hand calls the meteor at once
onto `meteor.landing`'s day, at `meteor.place`, with radius `meteor.r`; its day is
not run before `noticeUntil`. Off unless the garden was founded with
`"meteor": true`.

### `GET /api/public/gardens/:name/checkpoints/:digest`

The end checkpoint (`.blck` bytes, `application/octet-stream`) of a **verified**
day of that garden, by its digest; 404 for anything else; 503 with
`Retry-After: 1`, as for the view, while the lookup is busy. The lookup is cached
like the view, and cleared with it when a day becomes verified, so it never
trails a view that names a newer fork: the `fork.checkpoint` a view gives is
served from the first read. This is the fork: any
lab or headless runner can continue the garden from it, with or without the
letters that came after.

### Keeper (admin) endpoints

Same admin authentication as `POST /api/experiments`.

* `POST /api/gardens` creates a garden: `name` (as an experiment name, and it is
  the experiment's name), `presetId` (one of config `:garden_presets`, default
  `wild-storm-large`), `seed` (u32), `founding` (a non-empty list of step-0
  lesions and feeds, validated as `interventions`), and optionally `days`
  (horizon, default 365), `stepsPerDay` (default 131,072), `censusEvery`
  (default 1,024; must divide `stepsPerDay`), `deepEvery` (10),
  `lettersPerDay` (8), `queueMax` (64), `dawnPeriodMs` (86,400,000; at least
  1,000), `dawnOffsetMs` (0), `food` (`false`; `true` founds the garden with a
  food ask), and only with `food: true`, `foodAsks` (K, 2 to 1,000, default
  config `:garden_food_asks`, 5) and `foodEveryDays` (N, 1 to 365, default
  `:garden_food_every_days`, 7). Each food is `:garden_food_amount` (16) quanta
  per cell over radius `:garden_food_radius` (32); all four are copied into the
  garden when it is founded. `meteor` (`false`; `true` founds the garden with a
  meteor ask, independently of food), and only with `meteor: true`, `meteorAsks`
  (K, 2 to 1,000, default `:garden_meteor_asks`, 5) and `meteorEveryDays` (N, 1 to
  365, default `:garden_meteor_every_days`, 7); every meteor's radius is
  `:garden_meteor_radius` (64, allowed 33..255), copied into the garden with K and N.
  A meteor needs no matter bound (a lesion conserves matter), but founding refuses
  (422, naming the numbers) a radius past `⌊(min(width, height) − 1) / 2⌋`, the
  largest lesion a one-tile world takes, and a pond preset. A garden with food is founded only if its worst case
  fits the runner's `MATTER_MAX` (2^26 quanta): `cells · 128 + Σ founding feeds
  amount · (2r+1)² + ⌈days / N⌉ · amount · (2r+1)²` (each square capped at the
  world's cells); otherwise 422 with the numbers. `200 {"garden": name, "days":
  n}`, 422 with the reason otherwise. The commons:

  ```json
  {"name": "commons", "presetId": "wild-storm-large", "seed": 1,
   "founding": [{"step": 0, "kind": "feed", "x": 256, "y": 256, "r": 255, "amount": 16}]}
  ```

  To found the real commons, use `bin/garden-found` (a dry run unless given `--apply` and the URL twice; every key sent
  explicitly) with the parameters and opening steps in `docs/garden-opening-2026-10-18.md`.

* `POST /api/gardens/:name/letters/:id/drop`: the keeper's veto, for a letter
  (`ltr-<n>`), a food (`food-<n>`) or a meteor (`meteor-<n>`). `200 {"letter":
  <letter>}`, `200 {"food": <food>}` or `200 {"meteor": <meteor>}` (status
  `"dropped"`; dropping a dropped one is the same 200); 409 once its day has been
  assigned; 404 for an unknown garden, letter, food or meteor. A dropped food or
  meteor counts toward nothing, so its ask can open again (a meteor's at the next
  place). A garden keeps only its newest 256 dropped letters (by id
  number): an older dropped letter is forgotten, and dropping it again is a 404.
  Ids are never reused.
* `POST /api/gardens/:name/days/:index/requeue`: puts a **failed** or
  **diverged** day (and the days it blocked) back in the queue, so one island's
  bad report does not end the garden. `200 {"day": n, "status": "pending"}`; 409
  for a day in any other state; 404 for an unknown garden or day. The day's
  letters do not change.

### Who tends it, and what is not covered

Islands join without credentials, so by default anyone can run a day, replay it
under a second island id, or fail it. "Verified" means two islands agreed, not
that either is trusted, and `tending.*` counts island ids and adapter
descriptions as islands report them. Setting `BL_GARDEN_ISLAND_TOKEN` (config
`:garden_island_token`) offers a garden's days only to islands that joined with
`"gardenToken": <the token>` in the join body; the token is not stored. A join whose
URL carries a `gardenToken` query parameter (any value, empty included, even with the
token in the body too) is refused with 400 `{"error": "gardenToken belongs in the JSON
body of POST /api/islands, never in the URL"}` and joins nothing; the value is never
echoed. This stops the practice; it cannot undo a leak: the refused URL, token included,
may already be in a proxy or access log, and that token still works in a JSON body, so
rotate `BL_GARDEN_ISLAND_TOKEN` if one was sent that way. A form-encoded or multipart
join body is answered 415 before it is read (`CoordinatorWeb.IslandBodyLimit`). A parameter under another spelling (`gardentoken`) is not the token and is
ignored, but a client that sent it has still exposed it. An island
that joined without it still gets every ordinary experiment's work. The island
client sends it (`IslandOptions.gardenToken`, in the join body only, never in a
URL, a header, `/api/next` or a log line; a join that carries it follows no
redirect, and its error never repeats the response body): `tools/island.ts` takes
`BL_ISLAND_GARDEN_TOKEN` (deliberately not the coordinator's variable) or
`--garden-token=<t>`, and sends it only over https or to a loopback host;
`/island.html` takes a URL fragment, `#garden-token=<the token>` (percent-encoded;
a `+` is a literal plus), which it removes from the address bar at once, keeps in
memory only and sends only to its own origin (the browser may still keep the link
in its history). The Queue checks the token in the caller of `Queue.join/1`, so it
never enters the Queue's mailbox or crash reports, and the parameter filter hides
it in request logs. A resumed island needs no token while the coordinator still
knows it: it remembers that the island showed one. A fresh join (the island was
forgotten, or the metrics version changed) needs the token again; the page says
so when a tab that was a garden island joins afresh without it. An island cannot
reject (roll back) a verified day of a garden.

### Exporting a garden

`deno run -A tools/stitch.ts --experiment <garden>` exports the garden's
verified prefix: the days from day 0 that are all verified (with
`--allow-unverified`, done or verified), stitched over `(0, end of the last such
day]`. "Verified" means what it means above: two islands agreed, not that either
is trusted, and the observation files are only as trustworthy as the island that
produced them. A garden with no verified day 0 is skipped. When the prefix
grows, the export of the shorter prefix is replaced in place; an export whose
history differs in any other way, or that runs past the prefix exportable now,
is moved aside, as for any experiment. Two exporters of one garden take turns
(a lock file beside the run's directory). Each day's manifest carries the
letters as of its assignment, so `stitchRun` (`packages/runner/src/stitch.ts`,
in its garden mode) checks a garden's days this way
(`docs/garden-stitch-rule-2026-10-17.md` has the rule and its proof):

1. Each day's own list is a valid schedule.
2. Each day's `interventions.jsonl` is exactly the entries that day owns in its
   own list (steps in `(start, end]`, plus step 0 on day 0).
3. No day's list rewrites history: its entries at steps up to its start are, in
   order, the entries the earlier days owned and applied.
4. Entries after a day's end are not checked: a letter dropped before its day was
   assigned is in an earlier day's list and in no later one.
5. Everything else in the spec is the same on every day.

The stitched `spec.interventions` is the union of the entries the days applied,
and it must equal the garden's current list over the stitched range. That
comparison is the only check of a day's own entries beyond its own manifest and
log, so the export always makes it. Other experiments are stitched as before:
one schedule on every segment.

## Run a garden locally

`bin/garden-dev` (from the repository root) runs a whole garden on one machine:

1. a dev coordinator (`MIX_ENV=dev mix phx.server`) on `PORT` (4000) with `BL_DATA_DIR` in a scratch
   directory,
2. the lab (Vite) on `LAB_PORT` (5173), which serves the page and forwards `/api` to the coordinator,
3. a garden founded through `POST /api/gardens` (dev allows tokenless admin from loopback),
4. `GARDEN_ISLANDS` headless islands (`tools/island.ts`), two by default.

It then prints the addresses and waits. Ctrl-C (or SIGTERM, SIGHUP) stops every process, with
SIGKILL for any still running about 20 s later, and removes the scratch directory. It refuses to start
when something already listens on `PORT` or `LAB_PORT`, and after boot it checks (with `lsof`)
that the listener is the coordinator it started, so it never founds a garden in a coordinator it
did not start (it needs `lsof`, which macOS has; on Linux install it). A data directory is held by
one launcher at a time (a lock directory inside it), so two coordinators never write one garden's
state. The lock is never taken over: a launcher removes its own on every exit but SIGKILL, and
one that finds a lock refuses, naming the pids it records and whether each still runs; remove
`.garden-dev.lock` by hand when no launcher uses the directory. A second Ctrl-C while it stops is
ignored; the stop takes about 20 s at most. The coordinator's, lab's and islands' output goes
to `logs/` in that directory, not to the terminal. The lab needs a working Node for `pnpm`; if it
fails, `logs/lab.log` says why.

It drops every `BL_*` variable of the calling shell before starting anything:
`BL_ADMIN_TOKEN` would make the tokenless founding a 401, `BL_GARDEN_ISLAND_TOKEN` would keep
every day from the islands (the launcher starts them without a garden token), and discovery's store
(`BL_DISCOVERY_DATA_DIR`) goes in the scratch directory too.

| Variable | Default | |
| --- | --- | --- |
| `PORT`, `LAB_PORT` | 4000, 5173 | |
| `GARDEN_NAME` | `commons` | The page's default route (`/api/public/garden`, config `:public_garden`) shows `commons` with no query. The directory is a scratch one, never the real commons. |
| `GARDEN_PRESET` | `spots` | `spots` (256x256) or `wild-storm-large` (512x512, the real commons' jar). The founding is a feed at the centre, `r` 64 (255 on the big storm), amount 16. |
| `GARDEN_SEED` | 1 | Integers are written without leading zeros. |
| `GARDEN_STEPS_PER_DAY`, `GARDEN_CENSUS` | 2048, 256 | The census interval must divide the day. |
| `GARDEN_DAYS` | 365 | The horizon. |
| `GARDEN_DAWN_MS` | 60000 | A day a minute, so the page visibly rests and wakes. At least 1000. Dawns are a grid (every whole minute by default), not a delay after founding, so day 1 can come well under a minute after the garden is founded. |
| `GARDEN_ISLANDS` | 2 | 0 starts none (use `/island.html`, or `deno run -A tools/island.ts --coordinator http://127.0.0.1:4000`). |
| `GARDEN_LAB` | 1 | 0 skips Vite. |
| `GARDEN_DATA_DIR` | a new `mktemp -d` | Holds `data/` (the coordinator's), `logs/` and `export/`. A directory you name is created if missing and never removed, and a garden already in it is tended as it is: the printed commands use its own world, and a different `GARDEN_PRESET` is ignored with a note. |
| `GARDEN_KEEP` | 0 | 1 keeps an automatically created directory on exit. |

**Why `spots` works in dev and not in production.** `config/dev.exs` sets `garden_presets` to
`wild-storm-large` and `spots`, as `config/test.exs` does. `config/config.exs` keeps the
production list, the big storm only, and `prod.exs` never reads `dev.exs`, so a production
coordinator refuses a `spots` garden with 422. Nothing else about a garden differs in dev: the
letter limit (3 per address per hour), the view cache (two seconds) and every rule are
production's.

**The page.** `http://localhost:5173/garden/` reads `/api/public/garden`; for another name add
`?garden=<name>`. The coordinator's operations dashboard is `http://127.0.0.1:4000/index.html`.

**Letters.** Post a stone as a visitor would:

```bash
curl -sS -X POST -H 'content-type: application/json' \
  -d '{"kind":"stone","x":128,"y":128,"r":8}' http://127.0.0.1:4000/api/public/gardens/commons/letters
```

and drop one as the keeper, before its day is assigned:

```bash
curl -sS -X POST http://127.0.0.1:4000/api/gardens/commons/letters/ltr-1/drop
```

Every post from this machine comes from one address, so the fourth in one hourly window is
refused with 429. The windows are fixed clock hours (`garden_letter_window_ms`), not a sliding
hour, so a budget spent at 10:59 is whole again at 11:00. Restarting `bin/garden-dev` starts a
fresh limit (it lives in the coordinator's memory).

**Export.** `bin/garden-dev` prints the command, which writes into the scratch directory rather
than `runs/`:

```bash
deno run -A tools/stitch.ts --coordinator http://127.0.0.1:4000 --experiment commons --out "<dir>/export"
```

It exports nothing until day 0 is verified, which takes two islands.

**Same and different device types.** A day counts as `different-device-type` when the adapter
descriptions its producer and its verifier reported at join differ, and as `same-device-type`
when they are equal; the computer is not part of it. The headless islands here both report
`wgpu <this GPU>`, so every day they verify is `same-device-type` and the page says it was
replayed here, not yet verified elsewhere. A second computer with the same GPU stays
`same-device-type`; a browser island (`/island.html`) on this machine reports
`<browser engine> <this GPU>`, so a day it replays from a headless island counts as
`different-device-type`, though the same GPU did both.

**The end-to-end check.** `deno run -A tests/deno/garden_e2e.ts < /dev/null` (usually under a
minute, plus up to three minutes' wait when it starts within three minutes of the top of an hour,
for the letter window; on a free port or `BL_E2E_PORT`; `BL_E2E_WORK_MS`, default 120000, raises the per-step island budget on a very slow machine; it needs `lsof`) starts its own coordinator on a scratch directory, founds a 4-day
`spots` garden with 256-step days and a one-second dawn, posts letters through the public route,
has two in-process islands run and replay three days, drops a letter as the keeper, restarts the
coordinator, exports the verified prefix with `tools/stitch.ts` (once mid-run, once at the end)
and compares it with one unsegmented `tools/run.ts` run of the same schedule. Its pass criteria
are fixed in `docs/garden-local-2026-10-17.md`. When a check fails it keeps its scratch
directories and prints their paths.

`deno run -A tests/deno/garden_dev_smoke.ts < /dev/null` checks `bin/garden-dev` itself without
the GPU, the lab or islands: founding with `BL_ADMIN_TOKEN`, `BL_GARDEN_ISLAND_TOKEN` and
`BL_DISCOVERY_DATA_DIR` set in the caller's shell, the lock and port refusals, re-tending a
garden in a named directory, and shutdown on SIGINT, SIGTERM and SIGHUP.

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix
