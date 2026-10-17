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
* `POST /api/next` takes `{"capabilities": [...]}`, read per request and never stored:
  `ponds-v1` for a pond preset's experiments, `ponds-v2` as well for the hunt's arms
  (`pond-nat`, `pond-shuf`), `interventions-v1` for an experiment with `interventions`.
  Work an island's list cannot run is skipped, never waited for.
* A verify completion's `observationDigests` may name `interventions.jsonl` beside the
  other optional files (`migrations.tsv`, `exchanges.tsv`, `species.tsv`, `ponds.tsv`);
  the lists in `Coordinator.Segment` and `CoordinatorWeb.ApiController` are pinned to
  `packages/runner/src/stitch.ts`'s `VERIFIED_FILES` by
  `packages/runner/test/coordinator-files.test.ts`, and the preset facts in config.exs
  (`:world_size`, `:pond_presets`, `:pond_period`, `:migration_period`) to
  `packages/schema`'s presets by `packages/runner/test/coordinator-presets.test.ts`.

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
count. A garden is never a registered experiment or a source of registered
evidence.

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
dropped one. Every key in it is always present in a real response (a value may
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
dropped through these routes is never followed by an older view. All times are
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
| `days` | The newest released days, newest first, at most 14: `day`, `startStep`, `endStep`, `status`, `releasedAt`, `doneAt`, `verifiedAt`, `digest`, `verification`, `letters`, `census`. |
| `days[].status` | `"waiting"` (released, no island holds it), `"growing"`, `"done"`, `"verified"`, `"diverged"`, `"failed"`, `"blocked"` (after a diverged or failed day). |
| `days[].doneAt`, `verifiedAt`, `digest` | `null` until done / verified. |
| `days[].verification` | `"different-device-type"`, `"same-device-type"`, or `null` when not verified. |
| `days[].letters` | Ids of the live (not dropped) letters the day carries. |
| `days[].census` | As `census` without `day`, `step`, `verified`, `source`; `null` until done. |
| `letters.perDay`, `letters.queueMax` | The garden's budget: letters one day carries; letters waiting at once. |
| `letters.queued` | Letters waiting now. |
| `letters.nextLanding` | Where a letter posted now would go: `{day, step, open}` (`open` = slots left on that day), or `null` when the garden takes no letters (queue full, log full, stopped or finished). |
| `letters.waiting` | Every waiting letter, oldest first. |
| `letters.recent` | The newest 32 letters that are not waiting, newest first. |
| letter | `id` (`"ltr-<n>"`), `kind` (`"stone"`), `x`, `y`, `r`, `postedAt`, `landsAtStep`, `day` (the day that carries it), `status`, `landedIn` (the carrying day's digest once done, else `null`), `droppedAt` (`null` unless dropped). |
| letter `status` | `"waiting"` (its day has never been assigned; the keeper may drop it), `"sealed"` (its day is assigned: fixed), `"landed"` (its day is done), `"verified"` (its day is verified), `"dropped"` (the keeper's veto, before its day was assigned), `"stalled"` (its day diverged, failed or is blocked). |
| `limits` | `stoneRadius {min, max}`, `lettersPerAddressPerHour`, `logMax` (founding plus live letters, at most). |

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

### `GET /api/public/gardens/:name/checkpoints/:digest`

The end checkpoint (`.blck` bytes, `application/octet-stream`) of a **verified**
day of that garden, by its digest; 404 for anything else; 503 with
`Retry-After: 1`, as for the view, while the lookup is busy. This is the fork: any
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
  1,000), `dawnOffsetMs` (0). `200 {"garden": name, "days": n}`, 422 with the
  reason otherwise. The commons:

  ```json
  {"name": "commons", "presetId": "wild-storm-large", "seed": 1,
   "founding": [{"step": 0, "kind": "feed", "x": 256, "y": 256, "r": 255, "amount": 16}]}
  ```

* `POST /api/gardens/:name/letters/:id/drop`: the keeper's veto. `200
  {"letter": <letter>}` (status `"dropped"`; dropping a dropped letter is the
  same 200); 409 once the letter's day has been assigned; 404 for an unknown
  garden or letter. A garden keeps only its newest 256 dropped letters (by id
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
`"gardenToken": <the token>` in the join body; the token is not stored. An island
cannot reject (roll back) a verified day of a garden. A garden's run bundle
cannot yet be exported with `tools/stitch.ts`: each segment's manifest carries
the letters as of its assignment, and `stitchRun` compares whole specs.

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

* Official website: https://www.phoenixframework.org/
* Guides: https://hexdocs.pm/phoenix/overview.html
* Docs: https://hexdocs.pm/phoenix
* Forum: https://elixirforum.com/c/phoenix-forum
* Source: https://github.com/phoenixframework/phoenix
