# Opening the shared garden: the checklist (2026-10-18)

This is slice 33 of the backlog run. It covers everything needed to open the commons on cadence.garden: each
decision, each step, the coordinator's recommended default for it and the evidence behind that default. Nothing here
deploys, founds a garden or changes a deploy file. The founding itself is `bin/garden-found` (section 3), which makes a
dry run unless it is told twice where to send the request.

Every row has one status:

- **Done (PR #n verified it)**: only where a merged PR verified it.
- **Not done**: work that still needs doing. The row names the files.
- **Needs the live host**: it can only be checked on cadence.garden.
- **Your decision**: the user's call. The default is a recommendation, not a decision.
- **Reference**: a procedure to follow only if it is needed. Nothing to do now.

A garden is never a registered experiment, and nothing it does is registered evidence (README "The garden").

## 1. State today

**On main (origin/main 7cff518, after #55).**

- The coordinator's garden, contract `garden-v1`: Done (#21 verified it).
- Stitching of a garden's verified prefix: Done (#26 verified it). A three-day stitch equals the continuous run byte
  for byte on the GPU.
- The page `/garden/`: Done (#27 verified it). It is unlinked and `noindex`.
- The end-to-end check: Done (#30 verified it, 36 of 36 checks). PR #51's notes report `tests/deno/garden_e2e.ts`
  at 50 of 50 checks on the real GPU on #51's tree. Not re-run here.
- The garden token and the checkpoint cache: Done (#35 verified it).
- The operator page: Done (#39 verified it). #45 added the limits and capabilities.
- Food: Done (#41 verified it). It is off by default.
- Dawn predictions: Done (#51 verified it).
- The stone horizon readout: Done (#55 verified it).

**Not deployed.** The last recorded deploy is `b9b7bc36` (2026-10-16, docs/announce-gene-v0-2026-10-16.md), which
has no garden code. The coordinator image running there may be older still: the notes that say so are kept outside
the repo. Nothing here was checked on the host: confirm it there (`BL_IMAGE_TAG` and `docker images`).

**Not founded.** No garden exists anywhere but in scratch directories.

## 2. Decisions and steps

| # | Item | Recommended default | Status |
|---|---|---|---|
| 1 | The proxy fix | Caddy trusts Traefik and forwards `{client_ip}`; `BL_TRUST_FORWARDED_FOR=1`; `BL_ISLAND_JOINS_PER_ADDRESS=20` | Not done; Needs the live host |
| 2 | Deploy main to cadence.garden | A full build of both images, after a volume backup | Not done; Your decision (`deploy <sha>`) |
| 2a | Check the physics before founding | `RULE_VERSION` 1, and the physics unchanged since `ba2741e` | Not done (a git check on the deployed commit) |
| 3 | Founding parameters | Section 3: `wild-storm-large`, seed 1, one wander a day, food off | Your decision |
| 4 | The garden island token | Set `BL_GARDEN_ISLAND_TOKEN` at opening | Not done; Your decision |
| 5 | Who tends it first | The user's Mac: two headless keeper islands | Your decision |
| 6 | Linking `/garden/` from the site | After the founding and a verified day 2, in one lab slice | Not done; Your decision |
| 7 | What the operator watches | `curl` on `/api/status` with the token from stdin, plus the public view | Needs the live host |
| 8 | The journal entry on opening day | A log line, not an evidence card (draft below) | Not done |
| 9 | Rollback | Stop releasing; keeper drop; fork; full rollback; unlink | Reference |

### 2.1 The proxy fix (row 1)

**Default.** In `deploy/Caddyfile`, add the global block, and the header line inside each `reverse_proxy`. These are
the lines in deploy/README.md "Client addresses":

```caddyfile
{
  servers {
    trusted_proxies static private_ranges
    trusted_proxies_strict
  }
}
# in each reverse_proxy block:
header_up X-Forwarded-For {client_ip}
```

Then set `BL_TRUST_FORWARDED_FOR=1` and `BL_ISLAND_JOINS_PER_ADDRESS=20` on the coordinator.

**Evidence.** D-17 in the decisions log, and deploy/README.md "Client addresses" (#28, checked locally, not on the
host). The chain is Traefik, then Caddy, then Phoenix, so every visitor is expected to reach the coordinator as one
address. Every per-address budget is then one budget for the whole site:

- **Letters.** 3 an hour per address (`garden_letters_per_address`) would mean 3 stones an hour for everyone together.
- **Refusals.** 20 an hour per address (`garden_refusals_per_address`).
- **Joins.** For the same reason the join budget is off in production (`config/prod.exs`).
- **Food.** `food.sharedAddress` is true in production (`:garden_shared_address`, prod.exs), so the ask holds one hand
  at most and `asks` (at least 2) can never be reached. This is why food is impossible until row 1 is done.

**Status: Not done.** It needs three deploy changes:

1. `deploy/Caddyfile`, as above.
2. The compose `environment:` list in `compose.dokploy.yaml`. `BL_TRUST_FORWARDED_FOR`, `BL_ISLAND_JOINS_PER_ADDRESS`
   and `BL_GARDEN_ISLAND_TOKEN` (row 4) are not on it, so a value in `.env` alone reaches nothing. Check it with
   `docker compose -f compose.dokploy.yaml config`.
3. The host's `.env` (or Dokploy's environment).

**Live-host checks (Needs the live host).** All three need the commons (its letters and its view), so they run after
the founding (section 4, steps 6 and 7):

- Two visitors on different networks get separate letter budgets.
- A client-written `X-Forwarded-For` does not change the address.
- `/api/public/garden` shows `food.sharedAddress: false` once the commons exists. That also needs
  `:garden_shared_address` cleared, which `BL_TRUST_FORWARDED_FOR=1` does.

### 2.2 Deploy main (rows 2 and 2a)

**Default.**

- Build both images (site and coordinator) at one commit. A site-only redeploy would leave the coordinator without
  garden code.
- Back up the `coordinator_data` and `discovery_data` volumes first.
- Keep the `.env.pre-<sha8>` copy for the rollback.
- Make the same deploy change as row 1, so the garden never runs behind the shared address.

**Evidence.** deploy/README.md (both volumes, the rollback), and §1 (the live coordinator image predates the garden).

**Status: Not done; Your decision.** It needs your `deploy <sha>`.

**Post-checks (Needs the live host):**

- The public routes answer 200, `/healthz` answers 200, and `/api/status` answers 401 without the token.
- `/garden/` loads.
- `/api/public/garden` answers 404 before the founding.

**Row 2a, before founding.**

- The deployed commit must have `RULE_VERSION` 1 (`packages/schema/src/config.ts`).
- The physics, and the runner that applies the founding feed and the stones, must be unchanged since `ba2741e`, the
  commit #55 ran on.
- Check it in any checkout, with the deployed commit's sha:
  `git diff --stat ba2741e <sha> -- packages/schema/src packages/sim-ref/src packages/sim-gpu/src packages/runner/src`,
  which must print nothing. It prints nothing at 7cff518.
- Why: otherwise the seed-1 evidence in section 3 does not carry over. Gene v2 is in flight and may change the
  physics.
- Status: Not done. It needs only the sha, not the host.

### 2.3 The garden island token (row 4)

**Default.** Set `BL_GARDEN_ISLAND_TOKEN` to a fresh random value at opening, so only the keeper's islands tend the
commons. Lifting it is the later "invite volunteers" step, with its own copy change on the page.

**Evidence.** README "Who tends it, and what is not covered". Without the token, anyone can run a day, replay it
under a second island id, or fail it, and "verified" means only that two island ids agreed. The token is carried in
the join body only (#35), and a join with it in the query string is refused with 400 (#45).

**Status: Not done.** It needs the compose `environment:` addition (row 1, item 2). Rotate the token if it ever
appears in a URL or a log.

**What rotating does not do.** A new token stops new admissions only. An island that joined with the old token keeps
its `garden: true` mark in the coordinator's state (`garden_island?` in `queue.ex`), so it keeps receiving the
garden's days. No route drops one island, and islands are forgotten only at the 20,000-island bound, and only if they
never did any work. So, if the token leaks and a stranger's island joins with it:

- A day it runs that a keeper island replays, or a keeper's day it replays, must agree byte for byte. A falsified day
  diverges and the garden stops (row 7). That guard fails if the stranger runs a day and replays it from a second
  island of its own, which is why a leaked token matters.
- Removing it needs a coordinator change (a keeper route that drops an island, or a token generation that the check
  compares), which is a follow-up slice. Until then, the only lever that removes it is the full rollback (row 9,
  item 4).

### 2.4 Who tends it first (row 5)

**Default.** The user's Mac, as the keeper (brainstorm §4 "Keeper", decision 8). Run two headless islands with
different labels, each in a restart loop, because the runner stops on any 429 or 503 and does not honour
`Retry-After` (deploy/README). Every restart is a new join. With row 1 done, joins are limited to 20 an hour per
address, and both keepers share the Mac's address. So the loop backs off: the wait doubles from 2 minutes up to 32
minutes while the island keeps stopping within 10 minutes, and goes back to 2 minutes after a longer run. At worst
that is 5 joins in a loop's first hour and 2 an hour after, so both loops together stay under the budget. Ctrl-C ends
the loop as well as the island.

```sh
wait=120
while :; do
  started=$(date +%s)
  BL_ISLAND_GARDEN_TOKEN="$TOKEN" deno run -A tools/island.ts --coordinator https://cadence.garden --label keeper-1
  case $? in 130 | 143) break ;; esac
  if [ $(($(date +%s) - started)) -ge 600 ]; then wait=120; fi
  sleep "$wait"
  [ "$wait" -ge 1920 ] || wait=$((wait * 2))
done
# and the same with --label keeper-2 in a second terminal
```

**Evidence and what it implies.**

- Both islands report one adapter, so every verified day is `same-device-type`. The page then says "Replayed here,
  not yet verified elsewhere" and "Kept by one computer so far" (garden-page-v0 note; decision 8).
- A browser island on the same Mac would count as a different device type with the same GPU. That would overstate
  the verification, so it is not recommended.
- Cost: one wander is 131,072 steps. At 290 to 500 steps a second (§6.1; #55 measured 466 for a source and 360 for a
  twin), that is about 4 to 8 minutes of GPU per island per day, or 8 to 16 minutes for a day and its replay.
- `tools/island.ts` defaults to `http://localhost:4000`, so `--coordinator` must be given. The island sends the token
  only over https or to loopback.

**Status: Your decision.**

### 2.5 Linking `/garden/` (row 6)

**Default.** Link it only after rows 1 and 2, the founding, and at least day 0 verified. Day 2 is recommended, so a
visitor sees the garden move. Then do the link as one follow-up slice in `apps/lab`.

**Evidence.** garden-page-v0 note §1: "the page gains a canonical link, a sitemap entry and a nav link in one change,
and the privacy page's 'not open yet' section is reworded to match".

**Status: Not done.** The files and the copy:

- `apps/lab/garden/index.html`: drop the `noindex` and the hidden-route comment; add the canonical and the social
  tags.
- `apps/lab/public/sitemap.xml`: add `https://cadence.garden/garden/`.
- The header and footer nav on every page (DESIGN.md).
- `apps/lab/privacy/index.html` lines 55 to 58: "The shared garden, not open yet" and "nothing on this site links to
  it". Reword them to say it is open. The promises on letters and storage stay as they are.
- `apps/lab/status/index.html` line 28 and `apps/lab/participate/index.html` line 36: "a future direction".
- `apps/lab/about/index.html` line 37: "The shared garden and the naturalist are still directions".
- `apps/lab/index.html` lines 143 to 153: bet 4's "Someday" chip, and "The shared garden is the horizon".
- `apps/lab/test/garden.test.ts`, "the page is hidden": it asserts the `noindex`, no canonical link and no sitemap
  entry, so it fails until it is turned round to assert the opposite.
- `apps/lab/test/social-meta.test.ts` and the public-routes spec, for the new canonical page.
- `deploy/Caddyfile`: add `redir /garden /garden/{?query} 308` beside the other pages' lines. Without it Caddy answers
  `/garden` with 200 as well as `/garden/`, and one canonical page has two addresses (DESIGN.md: one address per
  page). This is a deploy-file change, so it goes with a deploy go-ahead.
- The page's tending copy must stay honest: "Kept by one computer so far" while row 5 holds.
- The stone copy must not promise more than #55 found. By #55's horizon rule, the largest stone a visitor can drop
  (radius 32) crossed the rule within one wander in all 9 pairs (at most 120,831 of 131,072 steps, median 26,623),
  so the rule's label is "a mark with no lasting effect" and the day stays one wander. #55 itself calls what that
  says about legibility Unclear: the measure saturates, and the nine pairs pool a carpet seed with two populated
  ones, so the medians are not estimates for the commons. Today the page says nothing about it. Suggested line,
  which claims only that: "A stone is a small nudge to one patch of the garden. We do not know yet how long its mark
  lasts."


### 2.6 What the operator watches (row 7)

**Evidence.** The operator page (#39, #45) reads `location.origin`, and Caddy forwards only `/api/*` and `/healthz`.
So `https://cadence.garden/index.html` is the public homepage, not the operator page (deploy/README "Operator views").
Reaching the operator page needs an SSH tunnel into the compose network or a port published on host loopback. Both
are deploy changes.

**Default until then.** Use `curl` with the bearer header read from stdin, so the token stays out of argv:

```sh
printf 'authorization: Bearer %s\n' "$BL_ADMIN_TOKEN" | curl -q -sS -H @- https://cadence.garden/api/status
curl -q -sS https://cadence.garden/api/public/garden
```

The first is the queue's admin view: the islands, their leases and the segments. Read it when a day is stuck. The
second is the garden's public view, and every field in the daily list below comes from it.

**Daily** (all from `/api/public/garden`):

- `state`. `stopped` means a day diverged or failed: look at it, then requeue it
  (`POST /api/gardens/commons/days/<d>/requeue`).
- The day released at dawn is done, then verified (`verification.daysVerified`, `days[0].status`).
- `verification.diverged` and `verification.failed` are 0.
- `letters.waiting`: drop anything unwanted before its day is assigned (`POST …/letters/<id>/drop`).
- `census.individuals > 0`. An extinct commons is a fact to report, not to hide.
- `days[].leaders.status` is `ok`. Investigate `unchecked` or `unreadable`.

**Status: Needs the live host.**

### 2.7 The journal entry (row 8)

**Default.** On opening day, after the page is linked, add one log line, not an evidence card. "A garden was
planted" is not a result (DESIGN.md's label vocabulary). Write it with the journal-update skill, which needs a site
redeploy.

**Evidence.** The journal's garden lines so far end "No garden is planted, and its page stays unlinked" (#51, #54).

**Draft** (dated on the day; the dawn and keeper wording to be checked against the live page):

> The commons is planted: one shared world on the big storm, open to visitors at /garden/. After each midnight UTC
> the next day of steps can be released, once the day before it is done, and a day runs only when an island comes to
> tend it, so the garden sleeps when nobody does. For now it is kept by one computer, which runs each day and replays
> it, so a day reads "replayed here, not yet verified elsewhere". A visitor can drop a stone into it, a small nudge
> to one patch; how long its mark lasts is not known yet. A garden is not an experiment: nothing it does is a
> result.

**Status: Not done.**

### 2.8 Rollback (row 9)

There is no pause, stop or delete route. The router has `show`, `post_letter`, `add_hand`, `create`, `drop`,
`requeue` and `checkpoint`. The levers, smallest first:

1. **Stop releasing.** Stop the keeper islands. With the island token set, no island without it can tend the
   garden, so it reads waiting-for-island, then asleep, which is true. Visitors can still post letters while it
   sleeps (up to `lettersPerDay` a day and `queueMax`, 64, waiting), for days that will not run until it is tended
   again: drop them (item 2) or unlink the page (item 5) if that matters. If the token leaked, rotating it stops new
   admissions but not an island that already joined with it (section 2.3).
2. **Keeper drop.** `POST /api/gardens/commons/letters/<id>/drop` removes a letter or a food, but only before its day
   is assigned. Requeue works on a failed or diverged day.
3. **Fork.** The verified prefix's end checkpoint (`fork.checkpoint` in the view) can be continued offline, in the lab
   or headless. A verified day cannot be rolled back, and the same name cannot be founded again (422 "garden
   exists").
4. **Full rollback.** Redeploy the previous tag and restore the volume snapshot (deploy/README). The commons is in
   `coordinator_data`, so restoring a snapshot from before the founding un-founds it.
5. **Unlink.** Revert the link change of row 6. The page goes back to `noindex` and unlinked.

## 3. Founding parameters (row 3)

| Parameter | Default | Evidence |
|---|---|---|
| `name` | `commons` | Config `:public_garden`. The page's default route shows it with no query. |
| `presetId` | `wild-storm-large` | The user's decision (brainstorm §7, decision 2): a commons on the big storm. |
| `seed` | 1 | #55's sources. Seed 1 has 151,425, 170,356 and 198,758 of 262,144 cells living at the ends of days 0, 1 and 2: populated, not a carpet. Seed 2 went extinct at step 31,744. Seed 4 is a carpet (97 to 99% living). Caveat: one history to step 393,216, not a year. |
| `founding` | `[{"step":0,"kind":"feed","x":256,"y":256,"r":255,"amount":16}]` | §6.1: start nutrient 32 starves on every seed, 64 carpets, 48 is populated on 2 of 3. The README's commons feed stands in for that start nutrient. #55 §1 ran this exact feed. |
| `days` | 365 | The coordinator default: 47,841,280 steps. |
| `stepsPerDay` | 131,072 | One sun wander (decision 5). #55 kept it: the R = 32 median horizon, 26,623 steps, is under one wander. |
| `censusEvery`, `deepEvery` | 1,024 and 10 | The coordinator defaults. #55 ran at these values. |
| `dawnPeriodMs`, `dawnOffsetMs` | 86,400,000 and 0 | Dawn at midnight UTC. The page says "dawn is midnight UTC". |
| `lettersPerDay`, `queueMax` | 8 and 64 | The coordinator defaults. Not measured. |
| Stone radius | 1 to 32 | Not a founding key. It is fixed in code (`@radius_max` in `garden.ex`), and changing it is a coordinator change. #55: R = 32 is a mark with no lasting effect. |
| `food` | `false` | Decision 6 (no food after founding). #41 made it off by default, and it is impossible until row 1 is done. |
| When | Shortly after 00:00 UTC | Day 0 is released at the founding. Day 1 can be released once day 0 is done and a dawn has passed since day 0 was released (`Garden.maybe_release`), at the next request from an island. If day 0 is done before the next dawn, day 1 waits for that dawn; if it finishes later, day 1 can be released straight away. Founding just after a dawn gives day 0 the whole first period. |

**If food is turned on later**, that means a new garden, because a garden's food rule is copied in at founding. Use
the defaults K = 5 and N = 7, each food 16 quanta over radius 32, and only after row 1. The founding matter check
passes:

    262,144 · 128 + 16 · 511² + ⌈365 / 7⌉ · 16 · 65² = 33,554,432 + 4,177,936 + 3,582,800 = 41,315,168

That is under MATTER_MAX, 2²⁶ = 67,108,864.

### The exact body

`bin/garden-found` sends exactly this body, every key explicit, in this order, so a later change to a coordinator
default cannot change the commons. `tests/deno/garden_found_smoke.ts` fails unless the script's printed body is
byte-equal to the line between the markers.

<!-- garden-found:body -->
```json
{"name":"commons","presetId":"wild-storm-large","seed":1,"founding":[{"step":0,"kind":"feed","x":256,"y":256,"r":255,"amount":16}],"days":365,"stepsPerDay":131072,"censusEvery":1024,"deepEvery":10,"lettersPerDay":8,"queueMax":64,"dawnPeriodMs":86400000,"dawnOffsetMs":0,"food":false}
```
<!-- /garden-found:body -->

`bin/garden-found --coordinator URL` prints the parameters, the exact request and what `--apply` would do, and sends
nothing. With `--apply --confirm-coordinator URL` (the same URL, byte for byte), it prints the parameters and the body
again, then needs either the typed line `found commons on <host>` or `--yes`. It first reads
`GET /api/public/gardens/commons`:

- **The commons exists.** It compares the view with the body, and reads `censusEvery` and `deepEvery`, which are not
  in the public view, from the admin spec (`GET /api/experiments/commons`, with the token). Nothing is founded. Exit 0
  if everything matches, 3 if anything differs, with each difference listed, and 1 if the spec cannot be read.
- **404.** It sends the POST, then reads both back and compares them the same way.
- **Any other failure of the POST**, a 5xx or no answer: the commons may have been founded anyway. Running the same
  command again is safe, because it reads the view first and reports an existing commons.

`http://` is refused for every host but `localhost`, `127.0.0.1` and `[::1]`. The token comes only from
`BL_ADMIN_TOKEN`, and is never printed:

- Tracing and allexport are switched off on the script's first line. The token then moves into a shell variable
  that is not exported, and `BL_ADMIN_TOKEN` is unset before any other command runs, so no child process inherits it.
- It reaches curl as a header on curl's stdin, never in an argument. curl runs with `-q`, so no `.curlrc` can trace
  or follow redirects.
- No server answer is printed as text, because one could repeat the token whole, escaped, encoded or in part. The
  script shows status codes, and in a comparison only numbers and true/false; a differing string, list or object is
  named by its kind. That costs one thing: a 422 that is not a race (the view still 404 after it) is reported without
  the coordinator's reason, which it does not log either. The body is pinned against a dev coordinator by the smoke
  test, so such a 422 means the deployed coordinator validates differently: check row 2a.
- A 422 is told apart by reading the view again, not by the answer's text: a commons there means a race, and the
  script reports it as existing.

## 4. Opening-day runbook

1. Rows 1 and 2: get the go-ahead, back up the volumes, and make the deploy change (Caddyfile, compose `environment:`,
   `.env` with `BL_TRUST_FORWARDED_FOR=1`, `BL_ISLAND_JOINS_PER_ADDRESS=20`, `BL_GARDEN_ISLAND_TOKEN`). Then deploy
   main.
2. Run row 2's post-checks, and row 2a on the deployed commit. Row 1's live-host checks need the commons, so they
   wait for steps 6 and 7.
3. A dry run: `bin/garden-found --coordinator https://cadence.garden`. Read the printed body against section 3.
4. Shortly after 00:00 UTC, with `BL_ADMIN_TOKEN` exported in that shell only:
   `bin/garden-found --coordinator https://cadence.garden --apply --confirm-coordinator https://cadence.garden`, and
   type `found commons on cadence.garden`. Expect "founded" and "the public view and the spec match the checklist".
5. Start the two keeper islands (row 5). Watch day 0 go from growing to done to verified
   (`verification.bySameDeviceType` 1).
6. Check the public view: `state`, `census.individuals > 0`, `food.enabled: false`, `food.sharedAddress: false`,
   `tending.deviceTypesEver` 1.
7. Post one stone from a phone on another network. Check it is public as waiting on the next frontier day, and lands
   and verifies with that day. With it, row 1's other live-host checks: separate letter budgets for the two
   networks, and a client-written `X-Forwarded-For` not changing the address.
8. After day 2 is verified: the link slice (row 6), then the journal line (row 8) and a site redeploy.
9. Each day after: row 7's list.

## 5. How this kit was checked

Run on 2026-10-18 at 7cff518 plus this slice's uncommitted files, on the local Mac (deno 2.9.7, curl 8.7.1), on a
shared and heavily loaded machine. This is the run after the third Codex pass's fixes; the earlier 37-, 71- and 79-check
runs are superseded.

- **Pass criteria**, fixed before the run, are in the header of `tests/deno/garden_found_smoke.ts`:
  - A. A stub coordinator: the dry run, the founding, an existing commons (view and admin spec), a race, failures
    before and after the POST, the view's transport (503 retries, a redirect, HTML, `null`, a closed port), a hostile
    `.curlrc`, and shell tracing. Also: no curl or deno the script starts has the token in its environment (under
    sh, with `token=` in the environment, and under bash with `SHELLOPTS=allexport`); a 401, 422 or 500 that echoes
    the Authorization header whole, in base64, in half and JSON-escaped shows none of it; a spec holding the token in
    `censusEvery` and `deepEvery` is described by kind; a 422 is told apart by the view, not the answer's text; a
    PS4 that expands the token prints nothing under `sh -x` or `bash -x` (nor with `BASH_XTRACEFD=1`, checked
    only with bash 4.1 or later); and a `BASH_ENV` that makes
    `BL_ADMIN_TOKEN`, or an exported `token`, readonly stops the script (exit 2) before any curl starts.
  - B. Refusals before any request, `--help`, and the typed confirmation through a pseudo-terminal, typed once the
    question is shown, with the parameters shown before it.
  - C. A real dev coordinator, checked first to be the only listener on its port (nothing answered there before it
    started, and lsof shows only its own process tree, checked once before the founding, as `garden_e2e.ts` does): a
    wrong token, the founding (public view and admin spec read
    back by the test), and running it again.
  - D. Secrets: printed output, the coordinator's log, the script's token lines, the first four commands (tracing
    and allexport off with their own trace sent to `/dev/null` on stdout and stderr, then the token out of the environment, stopping if
    it cannot be), `curl -q`.
  - Every run of the script is killed after 120 s with its whole process tree. The tree is found with `pgrep`, which
    the test requires before it starts anything.
  - Not covered: a POST that times out after 30 s.
- **Gates**: `shellcheck -s sh`, `dash -n` and `sh -n` on the script; the smoke test; `deno check`;
  `tools/test/deno-no-lock.test.ts`; `pnpm typecheck`; this note rendered with pandoc (gfm); and a check that the diff
  touches only this slice's five paths.

**Results.**

- `deno run -A --no-lock tests/deno/garden_found_smoke.ts < /dev/null`: all 84 checks passed, one skipped: the
  `BASH_XTRACEFD=1` check needs bash 4.1 or later, and this Mac has only bash 3.2 (which has no `BASH_XTRACEFD`). The
  dev coordinator booted, and the run took under two minutes. `uptime` load averages: 19.90, 32.16 and 36.85 at the
  start, and 24.39, 32.49 and 36.88 at the end. The run before the last edit (the `BASH_XTRACEFD` line and check)
  also passed all 84, none skipped.
- The checks catch the bugs they are for. Each mutation below was run alone through the whole test, then the script
  was restored byte for byte. The first five were run on the second pass's script, the next three on this one:
  - Without `unset BL_ADMIN_TOKEN`: the three environment checks and the first-commands check failed.
  - Without `unset token`: the `token=` environment check and the first-commands check failed.
  - Without allexport off (`set +xv`): the `SHELLOPTS=allexport` check and the first-commands check failed.
  - Printing the 401's body: the echoed-header check and "neither token appears" failed.
  - Printing the compared values as they come: the spec-holding-the-token check failed.
  - A bare `set +xva` (its trace not sent to `/dev/null`): both PS4 checks, "neither token appears" and the
    first-commands check failed.
  - `unset BL_ADMIN_TOKEN` without `|| exit 2`: the readonly-`BL_ADMIN_TOKEN` check and the first-commands check
    failed. `unset token` without it: the readonly-`token` check and the first-commands check failed.
  - The first pass's mutation still holds: without `-q`, the hostile-`.curlrc` check fails, and this curl writes the
    `.curlrc`'s `trace-ascii` file; with `-q` it does not. Run by hand, the pre-fix script printed the token under
    `sh -x`; the fixed one does not.
- The typed confirmation ran through a pseudo-terminal (macOS `script -q /dev/null`; elsewhere the test skips these
  three checks and counts them as skipped). The right line went on to the view and the spec; a wrong line was refused
  with no request.
- `sh -n`, `dash -n` and `shellcheck -s sh` on `bin/garden-found`: clean. `deno check --no-lock` on the smoke test:
  clean. `pnpm vitest run tools/test/deno-no-lock.test.ts`: 2 of 2 passed. `pnpm typecheck`: exit 0. Load 43 to 46 at the time.
- `pandoc -f gfm -t html` of this note: exit 0, with 2 tables and the `garden-found:body` markers kept.
- The dev coordinator runs from `apps/coordinator` in this checkout and compiles into its gitignored `_build`, as
  `garden_e2e.ts`, `coordinator_integration.ts` and `bin/garden-dev` do; no test here sets `MIX_BUILD_PATH`. A
  scratch build path would compile everything on every run, on a machine this loaded.
- `git status`: only this note, `bin/garden-found`, the smoke test, `deploy/README.md` and
  `apps/coordinator/README.md` changed. `deno.lock` is untouched.

Not checked here: anything on the live host (rows 1, 2 and 7), and a founding over https.
