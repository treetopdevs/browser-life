# Prototype status, 18 October 2026

What each app in this repo does today, how to try it on your own machine, what is not built, and what waits on you.
It describes `origin/main` at `5e7bda5c` (PR [#57]); how it was written and how each command was checked are at the
end. The page has an HTML twin:
[prototypes-2026-10-18.html](prototypes-2026-10-18.html).

## What waits on you

1. **Deploy.** Nothing merged in this run is deployed (D-04, D-18). The last recorded deploy is `b9b7bc36` (16 Oct), which
   has no garden code; the coordinator image on the host may be older, so confirm there
   (`docs/garden-opening-2026-10-18.md`, section 1 and row 2).
2. **The proxy fix (D-17).** Apply the Caddy `trusted_proxies` change and set `BL_TRUST_FORWARDED_FOR=1` on the live host
   (`deploy/README.md`, "Client addresses, abuse limits and CORS"). Until then every visitor reaches the coordinator as one
   address, so the per-address join budget stays off in production and the garden's letter and food budgets are shared
   by the whole site ([#28] decision 1, [#41]).
3. **Opening the commons.** The founding parameters, the island token, who tends it first and when to link `/garden/` are
   all "Your decision" rows in the opening checklist (`docs/garden-opening-2026-10-18.md`, rows 3 to 6, with recommended
   defaults). The script founds with food off (`food=false`, no flag for it): turning food on means editing the
   checklist's section 3 and the script's constants together, only after item 2, and a garden's food rule is fixed at
   founding ([#41] decision 1, D-24; checklist section 3). With `BL_ADMIN_TOKEN` exported in that shell only,
   `bin/garden-found --coordinator URL --apply --confirm-coordinator URL` founds it after you type
   `found commons on <host>` (checklist section 4, "Opening-day runbook"). [#57]'s one open call: exit 3 when a different commons
   already exists.
4. **Paid calls.** Bell v1 part C, where a model reads the twins, has not run: $7 to $11, up to $14 to $22 with
   retries, to be confirmed against the price sheet ([#22], [#23]); D-08 earlier put the same model calls at about $10
   to $15. D-08's "Not taken" list also holds transition-hunt Stage 1 on AWS (about $38, $48 cap), the upper-bound
   `RULE_VERSION` 1 world (about $2 to $3) and the opportunity reset (about $1).
5. **The proposer bench.** Planned, never approved or run. It needs a person's
   `deno run -A --no-lock tools/bench.ts approve experiments/naturalist/bench-v0-plan.json --by "<your name>"`, then `run`
   ([#49], D-26). It runs on this Mac's GPU, about 21 to 43 minutes, with a 240-minute cap.
6. **The gene line.** The gene v2 peer session is stalled with uncommitted kernel edits; what happens to them is yours
   (D-03, D-28). So is the next gene version: (a) genes that do or (b) genes that permit, plus a `kGene` 0 null
   (`docs/evolution-game-brainstorm-2026-10-16.md`, Gene v1 readout). Its section 9 lists five decisions for you; D-08 took
   reversible defaults (a sibling of the lab, nothing declared beyond Stage 0 and the gene line, pressures and donor picks,
   the solo jar first). The garden's sun letter waits for gene v2 (D-08, D-28).

Smaller items are listed under each app.

## Before anything else

From a fresh clone:

```bash
pnpm install
```

```bash
(cd apps/coordinator && mix deps.get)
```

Run `pnpm install` before any `deno run`: otherwise Deno 2.9 writes `workspaces` into `package.json` (`CLAUDE.md`). The
second line is what `bin/dev` asks for when the coordinator's dependencies are missing; it needs Elixir. GPU commands
need Chrome with WebGPU or Deno's native WebGPU. Commands marked "this Mac" read `runs/`, which is gitignored and exists
only in the main checkout; set `RUNS` to it first. Every printed `deno run` carries `--no-lock`, so it leaves
`deno.lock` alone (`CLAUDE.md`). The Playwright commands use the installed Google Chrome (`channel: "chrome"`) and
start their own Vite on port 5174, which must be free (`BL_E2E_PORT` picks another; `playwright.config.ts`). Run every
command from the repository root, in each new terminal too.

```bash
RUNS="$HOME/develop/browser-life/runs"
```

## 1. Lab

**What it is now.** The lab (`/lab/`) runs a world in the browser on WebGPU. Pond keeper is built on the breeder: a log of
firsts with rules stated in advance, a session card and a session file that `tools/run.ts` replays to the same final
hash ([#20]); a pressure dial, auto-breed, Keep a lineage and a "What's next?" ladder ([#25]); a family tree and pond
firsts ([#31]). A Field notes panel scores gradient-m3 and spots-m3 worlds against a neutral baseline and files notes only
at the rule fixed for each world beforehand ([#52]). A ring says the world differs in kind from neutral runs, not that
something arose inside it, and the spots-m3 threshold is set by one run (held-out bound 25.9%) ([#52]). Each note offers
the rule proposer's follow-up, applied only when you click ([#56]). Lab accessibility fixes cleared the lab exclusions
the public accessibility spec held (`LAB_HELD`); two hand-reviewed exclusions remain, each measured by the spec ([#46]).
Each PR's own gates (vitest, Playwright in Chrome) verified it. Not deployed.

**Try it locally.**

```bash
pnpm dev
```

- <http://localhost:5173/lab/?world=breeder&seed=1>: Pond keeper on the playtest kit's world.
- <http://localhost:5173/lab/?world=gradient-m3&seed=1>: Field notes. [#52]'s page test sees it ring on living cells low
  in steps 10,000 to 14,900.
- <http://localhost:5173/selftest.html>: the CPU reference against this browser's GPU, bit for bit.

The Field notes browser tests (they need a GPU):

```bash
npx playwright test tests/e2e/lab-naturalist.spec.ts --project=chrome
```

**Not built.**

- The spots-m3 full-rules comparison: Not yet measured ([#52]).
- Notes stop at the first wound or feed ([#52]); there is no page-level wound or drain click test and no 375 px check
  with a suggestion open ([#56]). DESIGN.md has no entry for the panel yet ([#52]).
- The firsts rewind log lives in memory per page; keeping it beside the checkpoint is a follow-up ([#20]). *(Later on
  2026-10-18: backlog slice 36 keeps it in a `.rewind` sidecar beside each saved checkpoint.)*
- A refused Feed or Drain on a pond world shows "World stopped" although nothing is wrong ([#38]). No fix is on main: the
  feed path in `apps/lab/src/sim.worker.ts` still reaches the generic error message. *(Later on 2026-10-18: backlog
  slice 36 makes it a notice, and the world keeps running.)*
- When gene v2 bumps `RULE_VERSION`, Field notes will say it has no baseline until the envelopes are rebuilt with
  `tools/naturalist-envelope.ts` ([#52]).

**Waits on you.** [#56]'s worker-side world check (an optional `world` on lesion and feed messages, in `protocol.ts`
and `sim.worker.ts`, outside its allowed area) asked for your accept or veto; it merged without one and the coordinator
accepted it after the fact (D-31). To veto, revert that hunk and accept the race it closes.

## 2. Public site

**What it is now.** The public pages (home, `/how-it-works/`, `/research/`, `/about/`, `/privacy/`, `/participate/`,
`/status/`) are static, served by Vite in development and by Caddy in production (`README.md`); the Worlds catalogue is
at `/worlds/` (`apps/lab/worlds/`). The journal at `/research/` covers 17 and 18 Oct ([#32], [#54]) and says none of it is deployed. An accessibility pass checks
every public route with axe at 1280 and 375 px by day and night, plus keyboard, reduced motion and no-GPU paths ([#36]). There is
a real 404 page, served by Caddy and the dev server ([#42]). The local half of the release checks is done: status
exposure, join abuse limits, canonical URLs and the sitemap ([#28]). The Worlds notes carry the 17 and 18 Oct results
([#53]). Not deployed: the journal goes live only when you deploy (D-18).

**Try it locally.** With `pnpm dev` running, open <http://localhost:5173/>, <http://localhost:5173/research/> and
<http://localhost:5173/worlds/>; <http://localhost:5173/no-such-page/> answers 404 with the site's own page. The
production build and its release check ([#28], [#42]); the spec starts its own server and reads `apps/lab/dist`, so
nothing else needs to run:

```bash
pnpm build
```

```bash
BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-routes.spec.ts --project=chrome
```

To look at the build yourself, in a terminal of its own (it keeps running until Ctrl-C):

```bash
pnpm --filter @bl/lab preview
```

**Not built.**

- Everything in `docs/release-checks-2026-10-18.md`, "Still needs the live host": HTTPS, the `www` redirect, `/healthz`,
  404s over HTTP, canonical URLs and the sitemap at the live domain, real phones, screen readers and other engines.
- The journal has an 18 Oct line for the lab's Field notes ([#52], in [#54]) but none yet for the stone horizon
  ([#55]), the notes' suggestions in the lab ([#56]) or the opening kit ([#57]). The sitemap's `lastmod` for
  `/research/` is still 2026-10-07 ([#32], [#54]).
- The visit counter counts a 404's path as given; counting it as a fixed `/404` is a follow-up ([#42] decision 5).

**Waits on you.** The 1 Oct journal card "Measures that need work" still says Measured, while the new clade card says
Negative for the same kind of result; relabelling a past card is your call ([#54] decision 9). [#42] kept `appType: "mpa"` and a not-found plugin in
`apps/lab/vite.config.ts`, beyond its "add the input only" area; the coordinator ran the lab specs on it before merge
(D-27). If you wanted input only, drop both and accept that dev then differs from Caddy ([#42] decision 10).

## 3. Archipelago

**What it is now.** The Phoenix coordinator (`apps/coordinator`) cuts runs into segments, hands them to islands (the
browser's `/island.html` or the headless `tools/island.ts`), has a fraction replayed by a second island and compares state
hashes; `tools/stitch.ts` turns segments into run bundles (`README.md`). Bred pond worlds now travel too: the `breeder`
preset and the 21 `pond-breed-`, `pond-mass-` and `pond-drift-` conditions run, verify and stitch on islands that
advertise `breed-v1` ([#33]). Islands stop cleanly on Ctrl-C or Stop ([#43]). The coordinator checks its limiter settings
at boot, refuses a garden token in a query string and keeps each island's capabilities for operators ([#45]). The operator
page shows gardens, bred runs, limits and failures behind the admin token ([#39]). Verified by `(cd apps/coordinator && mix precommit)` and
`tests/deno/coordinator_integration.ts` (86 PASS in [#33] and [#45]). Not deployed.

**Try it locally.** The lab and the coordinator together (stop a `pnpm dev` from the sections above first, or use the
coordinator-only command below: `bin/dev` asks for port 5173, which Vite will not share, `apps/lab/vite.config.ts`):

```bash
bin/dev
```

or the coordinator alone:

```bash
(cd apps/coordinator && mix phx.server)
```

Create an experiment, then run two islands, each in a terminal of its own (or one plus
<http://localhost:5173/island.html> in a WebGPU browser). A run's final segment is always replayed by a different
island, and `tools/stitch.ts` stitches a run only once that replay is done; with one island it lists every run and
skips it (`--allow-unverified` stitches anyway):

```bash
curl -X POST localhost:4000/api/experiments -H 'content-type: application/json' -d '{"experiment":"a1","presetId":"gradient","conditions":["treatment","neutral"],"seeds":[1,2,3],"steps":100000,"segmentSteps":5000,"censusEvery":100,"verifyFraction":0.1}'
```

```bash
deno run -A --no-lock tools/island.ts --coordinator http://localhost:4000
```

The operator page is <http://localhost:4000/index.html>. When runs finish:

```bash
deno run -A --no-lock tools/stitch.ts --experiment a1 --out /tmp/stitched
```

Without `--out` it writes to `runs/a1/` in the checkout you run it from.

`tools/island.ts` takes `--coordinator`, `--tasks` and `--garden-token=<t>` (its header); it has no `--help`.

**Not built.**

- A route to give a stopped island's segment back at once, and a `BL_LEASE_MS` setting ([#43] follow-ups).
- Counters for refusals (429, 503) and pruning on the operator page ([#39]).
- Distributed branch runs, model pickers and hand picks: bred runs travel only with the rule's own picks ([#33]).

**Waits on you.**

- An export whose manifest predates the breed arm is now moved aside; none of the 983 stitched manifests under `runs/` is
  affected ([#33], "Decision for the owner").
- `docs/ops-dashboard-2026-10-18.md` still says the coordinator records no island's capabilities; a dated pointer needs
  your OK ([#45] follow-ups).

## 4. Shared garden

**What it is now.** One shared world on `wild-storm-large`, run by the coordinator as a paced one-run experiment: one day
of 131,072 steps is released per dawn, and only when someone tends it; visitors send stones (wounds of radius 1 to 32);
a public view says how it is kept; verified checkpoints can be read to fork ([#21]). Its days stitch into one bundle
([#26]). The page `/garden/` is unlinked and `noindex` ([#27]). `bin/garden-dev` runs a garden on one machine, and
`tests/deno/garden_e2e.ts` checks it from founding to stitched bundle ([#30]). Islands can carry the garden token, fresh
fork checkpoints never 404, and production refuses dev presets ([#35]). Collective food is off by default (and off in
the founding script): with `food: true` at founding, a feed lands when 5 networks ask within one dawn, at most once in 7
garden days ([#41]). Visitors can predict which line holds the field after the next day, with receipts kept only on
their device ([#51]). The stone horizon test ran by rules fixed first: median 97,279 steps at radius 8 (9 valid pairs,
4 censored), so the prediction (under about 13,000) failed; 26,623 at 32; 35,839 at 64. The whole jar drifts from its
unstoned twin: the far region is already 16 to 58 percent different at the first census and about 0.9 by census 5 to
20 (1,024 steps each), so what this says about finding a stone is unclear ([#55], [#53]). The opening kit is a
checklist and a founding script that makes a dry run by default ([#57]). No garden is founded anywhere but in scratch directories, and nothing is deployed ([#57]).

**Try it locally.** A whole garden on this machine (needs `mix`, Deno with a GPU and `lsof`), then
<http://localhost:5173/garden/>. Stop any `pnpm dev`, `bin/dev` or coordinator from the sections above first: it starts
both on ports 5173 and 4000 and refuses a port in use (`LAB_PORT` and `PORT` move them; `bin/garden-dev`).

```bash
bin/garden-dev
```

Without a coordinator, `pnpm dev` and <http://localhost:5173/garden/?mock=1> show the contract's example garden (dev
only, [#27]). A stone, as a visitor would send it, to a garden `bin/garden-dev` started:

```bash
curl -sS -X POST -H 'content-type: application/json' -d '{"kind":"stone","x":128,"y":128,"r":8}' http://127.0.0.1:4000/api/public/gardens/commons/letters
```

The end-to-end check (GPU and `mix`):

```bash
deno run -A --no-lock tests/deno/garden_e2e.ts < /dev/null
```

The founding script's dry run (sends nothing) and the stone horizon readout recomputed from its committed record (CPU):

```bash
bin/garden-found --coordinator http://127.0.0.1:4000
```

```bash
deno run -A --no-lock tools/horizon.ts readout --record experiments/garden/stone-horizon-2026-10-18.json
```

**Not built.**

- The null-stone control (a wound on dead ground) is still owed ([#55]); it has no merged PR.
- `bin/garden-dev` has no setting for collective food, so its gardens have none.
- From the opening checklist ([#57]): the Caddyfile change, the compose `environment:` additions, reaching the operator
  page on the host, and the `/garden/` link and copy changes.
- The sun letter: the garden takes stones only, and the sun needs a fourth intervention kind ([#21]).

**Waits on you.** The top items 1 to 3. Also: [#41]'s edits to `apps/coordinator/config/prod.exs` and
`apps/coordinator/config/runtime.exs` (`sharedAddress` true in production until `BL_TRUST_FORWARDED_FOR=1`) need your review ([#41] decision 13).

## 5. AI naturalist

**What it is now.** Code only, no model calls. The anomaly bell v0 rings on drift: 30 of 70 neutral runs rang where the
bar allowed 2 ([#19]; the journal's chip: Negative). Bell v1 ([#22] plan, [#23]): part A, exploratory, rang on 0 of 70
fresh neutral runs (the journal's chip: Measured); part B's twins heard a big wound and a feed on 4 of 10 seeds each,
short of the bar (Negative). A ring says a world differs in kind from neutral runs, not that something arose inside it
([#23], [#52]). The field notebook turns a run into one HTML page of notes with receipts ([#24]). The proposer turns
each note into a fork spec that runs only after a person approves it ([#34]). The proposer bench is planned, 70 forks,
and unapproved, so it has no result ([#49]). In the lab, Field notes and their proposals ([#52], [#56]).

**Try it locally.** Open the committed example page,
[field-notebook-2026-10-17-gradient-m3-neutral-seed-15.html](examples/field-notebook-2026-10-17-gradient-m3-neutral-seed-15.html),
or the lab's Field notes above. On this Mac, with `RUNS` set as above (CPU; writes only to `/tmp`):

```bash
deno run -A --no-lock tools/notebook.ts "$RUNS/replay-m4/gradient-m3/neutral/seed-15" --base "$RUNS" --out /tmp/notebook
```

A second run into the same `--out` is refused; choose a fresh one or pass `--force` (`tools/notebook.ts` header). The proposer leaves an existing proposal alone (`tools/propose.ts`).

```bash
deno run -A --no-lock tools/propose.ts propose "$RUNS/replay-m4/gradient-m3/neutral/seed-15" --notes docs/examples/field-notebook-2026-10-17-gradient-m3-neutral-seed-15.notes.json --out /tmp/proposals
```

```bash
deno run -A --no-lock tools/bench.ts dry-run experiments/naturalist/bench-v0-plan.json
```

The bench's dry run checks every spec and prints all 70 commands and runs nothing. Its manifest names this Mac's paths, so
it works here only.

**Not built.**

- Bell v1 part C, the model reading the twins ([#23]).
- A v2 bell: the after-the-fact threshold of 2.58 is a hypothesis for fresh twins, not a pass ([#23]).
- The bench's readout ([#49]).

**Waits on you.** The top items 4 and 5.

## 6. Evolution game

**What it is now.** Pond keeper, in the lab (section 1), is the game's Stage 0b ([#20], [#25], [#31]). The playtest kit is
a fixed protocol, script, questionnaire and readout template for three people, with its pass rules frozen by hash; no
session has been held ([#38]). The gene line's readouts are on main (gene v0 PASS, gene v1 CONFOUNDED, in
`docs/evolution-game-brainstorm-2026-10-16.md`); gene v2 sits with a stalled peer session (D-03, D-28).

**Try it locally.** The kit's world is <http://localhost:5173/lab/?world=breeder&seed=1>; the kit itself runs from a pinned
commit, `c16b5a6` (`docs/playtest-kit-2026-10-18.md`, section 1). Its frozen section 6 can be checked against the hash in
its header:

```bash
sed -n '/^## 6\. /,/^## 7\. /p' docs/playtest-kit-2026-10-18.md | sed '$d' | shasum -a 256
```

**Not built.** Gene v2. On the breeder at seed 1 the firsts log fills before the player acts, so the kit's question about
the log mostly tests a log already written ([#38]).

**Waits on you.** Running the three sessions, and whether to host the screenshots and add a printable HTML twin ([#38],
"Open"). The gene decisions are top item 6.

## 7. Research instruments

**What it is now.** Clade measures from the mutation tree (TMRCA95, mutant sweeps, gross clade replacement) on 130 runs: none
is eligible under the rules fixed beforehand ([#37]; the journal's chip: Negative). `tools/lineage.ts` opens pond-cycle
runner bundles and checks each edge's route through `ponds.tsv` ([#29]), and the HTML report draws that route ([#44]).

**Try it locally.** From a fresh clone, CPU only, on the committed fixtures:

```bash
deno run -A --no-lock tools/lineage.ts --dir tools/test/fixtures/pond-runner/scaf-picked --rule top --out /tmp/scaf-dossier.json
```

```bash
deno run -A --no-lock tools/report-html.ts lineage /tmp/scaf-dossier.json --out /tmp/scaf-dossier.html
```

`report-html.ts` refuses an existing `--out` unless `--force` is given. The clade pilot, on this Mac:

```bash
deno run -A --no-lock tools/clade.ts pilot --base "$RUNS"
```

Its `--base` defaults to `runs` in the current directory (changed from a home-directory path within [#37], commit
`db0d2743`), so from any other checkout pass the main checkout's, as above.

**Not built.** Genotype-keyed activity, and a null matched on population size and lineage structure, which [#37]'s note
says is needed.

**Waits on you.** Nothing beyond the items at the top.

## How this page was written (rules fixed before writing, 2026-10-18)

These rules were written before any of the status on this page, against `origin/main` at `34621dc2` (PR [#53]). The final
`origin/main` commit the page describes is `5e7bda5c` (PR [#57]), checked again with `git fetch` at ship time (18 Oct, 15:44).

1. **Sources.** Every claim comes from a merged PR's body or a dated doc on `origin/main`, and names its PR or file. Nothing
   comes from memory or from a session's notes. The backlog run's decisions log (PR [#40], not on main) is cited by its D-number
   only for what waits on the user.
2. **Built, verified, deployed.** "Built" means merged to main. "Verified" means a merged PR's own gates ran it, and the page
   says which PR. "Deployed" is said only where a deploy record says so; nothing merged in this run was deployed (D-04), and
   the page says so once per app instead of implying anything is live.
3. **Open work.** An open PR or a slice without a merged PR is named in one clause, never described as built. PRs that merge
   before the ship-time fetch are included; the rest are not.
4. **Results.** A result is labelled with DESIGN.md's vocabulary (Measured, Negative, Not yet measured, Unclear) as its PR
   labelled it, never upgraded.
5. **Commands.** Every command on the page appears in the table at the end with one of three checks: **Ran** (run here on
   this checkout, with its exit code and `uptime`), **Read** (its flags checked against the code or script that defines it,
   with the file named), or **Needs data** (it reads run bundles under `runs/` or a GPU that a fresh clone lacks; the page
   says which). A command that cannot be checked one of these ways is left out. No `--help` is claimed for a tool that has
   none.
6. **Waits on the user.** An item is listed only when a merged PR or a D-number says it needs the user's yes or decision.
   Each says what the default is, if one was taken, and where it is written down.
7. **Plain and short.** One paragraph per app, then try it, not built, waits on you.

Clarification (2026-10-18, after writing): PR [#57] merged before the status was written, so the page describes
`5e7bda5c`. DESIGN.md's vocabulary also has Confirmed and Seen; the page uses neither. Where a PR body gives a reading
but no chip, the page uses the chip the public journal gave it ([#32], [#54]) and says so. The gene readouts are quoted
in their own rule's words (PASS, CONFOUNDED).

## How each command was checked

Ran: run on this checkout at `5e7bda5c` in the printed form, except that outputs shown under `/tmp` went to the
session scratchpad and `RUNS` was the main checkout's `runs/`, read only. URLs were fetched from
`pnpm dev --port 5291 --strictPort` with `Accept: text/html`; for that server and those URLs the result is the startup or the
HTTP status instead of an exit code. A 200 says the page is served, not that a world was watched (no GPU was used). `git status` after
every run showed only this slice's files. Read: flags checked in the file named, not run (this checkout has no
`apps/coordinator/deps`, so no `mix` command ran). Needs data: needs `runs/`, a GPU or both.

The page itself: the HTML twin was rendered over `file://` at 1280 and 375 px in light and dark (by the system setting
and by the Day/Night button) with no horizontal scroll, no console error, no request leaving the file and no serious
axe finding; every link in both twins and in the README line resolves, and every PR link was checked with `gh` (merged,
except [#40], open).

| Command | Check | Result |
| --- | --- | --- |
| `pnpm install` | Read | `README.md`, "Run it"; `node_modules` was already present |
| `(cd apps/coordinator && mix deps.get)` | Read | `bin/dev`'s own error text |
| `RUNS="$HOME/develop/browser-life/runs"` | Ran | `ls -d "$RUNS/replay-m4/gradient-m3/neutral/seed-15"`: exit 0, present on this Mac; the "this Mac" rows read it; load 413.77 |
| `pnpm dev` | Ran | a server, so no exit code: ready on port 5291 within 1 s, then stopped by the check; load 126.83 |
| `/lab/?world=breeder&seed=1`, `/lab/?world=gradient-m3&seed=1`, `/selftest.html` | Ran | 200 each; load 126.83 to 131.00 |
| `/`, `/research/`, `/worlds/` | Ran | 200 each; load 126.83 to 131.00 |
| `/no-such-page/` | Ran | 404 with "Page not found · Cadence Garden"; load 131.00 |
| `/island.html`, `/garden/`, `/garden/?mock=1` | Ran | 200 each; load 126.83 to 131.00 |
| `npx playwright test tests/e2e/lab-naturalist.spec.ts --project=chrome` | Needs data (GPU) | `--list` Ran: 5 tests, exit 0, load 126.83; [#52] ran 4 of 4, [#56] ran them in 95 passing Chrome tests |
| `pnpm build`, `pnpm --filter @bl/lab preview` | Read | `package.json`, `apps/lab/package.json` scripts; [#42] ran the build |
| `BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-routes.spec.ts --project=chrome` | Read | `tests/e2e/public-routes.spec.ts` header (reads `apps/lab/dist`) and `playwright.config.ts` (`webServer`); [#28] and [#42] ran it |
| `bin/dev` | Read | `bin/dev` |
| `(cd apps/coordinator && mix phx.server)` | Read | `README.md`, "Archipelago" |
| `(cd apps/coordinator && mix precommit)` | Read | `CLAUDE.md`; [#33] 358 tests and [#45] 412 tests, 0 failures |
| `curl -X POST localhost:4000/api/experiments ...` | Read | `README.md`, "Archipelago"; needs the coordinator |
| `deno run -A --no-lock tools/island.ts --coordinator http://localhost:4000` | Read | `tools/island.ts` header and its `parseArgs` |
| `http://localhost:4000/index.html` | Read | `apps/coordinator/README.md`, "Operator page"; needs the coordinator |
| `deno run -A --no-lock tools/stitch.ts --experiment a1 --out /tmp/stitched` | Read | `tools/stitch.ts` header and `parseArgs` (`--out` default `runs`; final segment verified unless `--allow-unverified`); `apps/coordinator/lib/coordinator/queue.ex`, `pick_task` and `maybe_verify?` (a final segment is always verified, never by the island that ran it) |
| `bin/garden-dev` | Read | `bin/garden-dev` header; needs `mix`, a GPU and `lsof` |
| `curl -sS -X POST ... http://127.0.0.1:4000/api/public/gardens/commons/letters` | Read | `apps/coordinator/README.md`, "Run a garden locally" |
| `deno run -A --no-lock tests/deno/garden_e2e.ts < /dev/null` | Needs data (GPU, `mix`) | [#30] 36/36, [#41] 45/45, [#51] 50/50 |
| `bin/garden-found --coordinator URL --apply --confirm-coordinator URL` | Read | `bin/garden-found` header: needs `BL_ADMIN_TOKEN`, matching URLs and the typed line or `--yes`; bare `--apply` is a usage error (Ran: exit 2, sent nothing, load 107.45); `food=false` is a constant; your step |
| `bin/garden-found --coordinator http://127.0.0.1:4000` | Ran | dry run, exit 0, sent nothing; load 126.83 |
| `deno run -A --no-lock tools/horizon.ts readout --record experiments/garden/stone-horizon-2026-10-18.json` | Ran | exit 0, medians 97,279 / 26,623 / 35,839 with 4 censored at radius 8, as in [#55]; load 126.83 |
| `deno run -A --no-lock tools/notebook.ts "$RUNS/..." --base "$RUNS" --out /tmp/notebook` | Needs data (`runs/`); Ran on this Mac | `--force` Read in its header; exit 0 in 22 s, D 7.1946666666666665 equals the record, 1 ring; load 131.00 to 131.59 |
| `deno run -A --no-lock tools/propose.ts propose "$RUNS/..." --notes ... --out /tmp/proposals` | Needs data (`runs/`); Ran on this Mac | exit 0, 1 proposal (`108c86168adeb56f`), not approved; load 131.59 |
| `deno run -A --no-lock tools/bench.ts dry-run experiments/naturalist/bench-v0-plan.json` | Needs data (`runs/`, `~/browser-life-bench`); Ran on this Mac | exit 0 in 7 s: 70 forks, 2,683,100 steps, nothing written; load 128.15 to 123.96 |
| `deno run -A --no-lock tools/bench.ts approve ... --by "<your name>"`, then `run` | Read | `tools/bench.ts` header; a person's step, never run by an agent |
| `sed -n '/^## 6\. /,/^## 7\. /p' docs/playtest-kit-2026-10-18.md \| sed '$d' \| shasum -a 256` | Ran | exit 0, `343c7f03...c596`, equals the kit's header; load 126.83 |
| `deno run -A --no-lock tools/lineage.ts --dir tools/test/fixtures/pond-runner/scaf-picked --rule top --out /tmp/scaf-dossier.json` | Ran | exit 0, 3 of 3 walks exact, 3 crossings name the parent; load 126.83 |
| `deno run -A --no-lock tools/report-html.ts lineage /tmp/scaf-dossier.json --out /tmp/scaf-dossier.html` | Ran | exit 0, 80,220 bytes; load 126.83 |
| `deno run -A --no-lock tools/clade.ts pilot --base "$RUNS"` | Needs data (`runs/`); Ran on this Mac | exit 0 in 15 s, cadence rule gives 1; load 131.59 to 128.15 |

[#19]: https://github.com/treetopdevs/browser-life/pull/19
[#20]: https://github.com/treetopdevs/browser-life/pull/20
[#21]: https://github.com/treetopdevs/browser-life/pull/21
[#22]: https://github.com/treetopdevs/browser-life/pull/22
[#23]: https://github.com/treetopdevs/browser-life/pull/23
[#24]: https://github.com/treetopdevs/browser-life/pull/24
[#25]: https://github.com/treetopdevs/browser-life/pull/25
[#26]: https://github.com/treetopdevs/browser-life/pull/26
[#27]: https://github.com/treetopdevs/browser-life/pull/27
[#28]: https://github.com/treetopdevs/browser-life/pull/28
[#29]: https://github.com/treetopdevs/browser-life/pull/29
[#30]: https://github.com/treetopdevs/browser-life/pull/30
[#31]: https://github.com/treetopdevs/browser-life/pull/31
[#32]: https://github.com/treetopdevs/browser-life/pull/32
[#33]: https://github.com/treetopdevs/browser-life/pull/33
[#34]: https://github.com/treetopdevs/browser-life/pull/34
[#35]: https://github.com/treetopdevs/browser-life/pull/35
[#36]: https://github.com/treetopdevs/browser-life/pull/36
[#37]: https://github.com/treetopdevs/browser-life/pull/37
[#38]: https://github.com/treetopdevs/browser-life/pull/38
[#39]: https://github.com/treetopdevs/browser-life/pull/39
[#40]: https://github.com/treetopdevs/browser-life/pull/40
[#41]: https://github.com/treetopdevs/browser-life/pull/41
[#42]: https://github.com/treetopdevs/browser-life/pull/42
[#43]: https://github.com/treetopdevs/browser-life/pull/43
[#44]: https://github.com/treetopdevs/browser-life/pull/44
[#45]: https://github.com/treetopdevs/browser-life/pull/45
[#46]: https://github.com/treetopdevs/browser-life/pull/46
[#49]: https://github.com/treetopdevs/browser-life/pull/49
[#51]: https://github.com/treetopdevs/browser-life/pull/51
[#52]: https://github.com/treetopdevs/browser-life/pull/52
[#53]: https://github.com/treetopdevs/browser-life/pull/53
[#54]: https://github.com/treetopdevs/browser-life/pull/54
[#55]: https://github.com/treetopdevs/browser-life/pull/55
[#56]: https://github.com/treetopdevs/browser-life/pull/56
[#57]: https://github.com/treetopdevs/browser-life/pull/57
