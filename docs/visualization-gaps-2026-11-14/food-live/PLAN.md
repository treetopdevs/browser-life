# food-live: one private page that runs any food-schedule screen

Slice key `food-live`. Worktree `browser-life-viz-food-live`, branch `claude/viz-food-live` from `origin/main` 9d91709a. Decisions D4 to D7 and D18 of the run log apply. Everything below was checked against this worktree on 2026-11-14.

## What a person can see after this slice

Open `http://localhost:5267/food-bands/` (URL only; not linked from the lab list, decision D7). Pick one of 11 screens. The page runs the screen's matched worlds live, side by side for paired screens and alone for single-arm ones, from the screen's own seed, and draws where food is offered this pulse: the 48-column band sliding east, the two 24-column split bands, the alternating band that flips every 100 pulses, the foothold floor, the schedule-769 targets. Same body and family colours, population-history strip and accounting table as `/hungry-shapes/`. Play, step, pace, one shared clock, a per-screen horizon (3,000, 6,000 or 9,000 ticks). Where the matching recorded replay is present locally, a "Compare with the recorded run" button reports whether the live census equals the recorded one at every recorded tick, and the first tick where it differs. Today no page runs these worlds at all; the 18 result pages only replay saved files, and the uniform-food page stops at 3,000 while its screen ran to 6,000.

The page is labelled "Exploration, not evidence". It writes no files; the only output is an optional explicit download of the current census as JSON (user click only).

## Corrections to the planning section (verified against the code)

1. The table in the planning section is incomplete on arms, as it warned. The compared arms are, from each `tools/<dir>/explore.ts` (`new HungryWorld(seed, true, mode)` and the `runArm` signatures):
   - uniform-food: single arm, mode `uniform`, seeds 1201, 1202, 1203 (not only 1201), 6,000 ticks, hungry-shapes model.
   - uniform-endurance: single arm, `uniform`, seeds 1201 to 1203, 9,000 ticks, its own `uniform-endurance` model (a literal hungry-shapes copy with `maxHistory` raised 301 to 451; the explore.ts comment says so).
   - moving-food (+replication): `uniform` vs `moving-band`; seed 1201 primary, 1202 and 1203 replication; 3,000.
   - stationary-food (+replication): `moving-band` vs `stationary-band`; 1202 primary, 1201 and 1203 replication; 3,000. The plan row "Stationary band" hides that the foil is the moving band.
   - food-band-longevity (+replication): `moving-band` vs `stationary-band`, 1201 primary, 1202 and 1203 replication; 6,000, stationary-food model.
   - split-food (+replication): `stationary-band` vs `split-band`; 1202 primary, 1203 replication; 3,000.
   - alternating-food (+replication): `split-band` vs `alternating-band`; 1203 primary, 1202 replication; 3,000.
   - food-band-foothold (+replication): `alternating-band` vs `foothold-band`; 1202 primary, 1203 replication; 3,000.
   - food-floor-replication: `alternating-band` vs `foothold-band`, seed 1203, 3,000 (same arms and seed as foothold replication; step 1 decides whether it is a separate picker entry or an alias, and records which).
   - food-floor-longevity (+replication): single arm `foothold-band`, 6,000; 1203 primary, 1202 replication. Single-arm, not paired as the planning table implies.
   - food-schedule-769: single arm `schedule-769`, seed 1202, run to a 3,000 gate then 6,000. The compared historical foothold arm exists only as a saved replay, so live it is one world; the picker may add the foothold arm as an optional second world (same seed) so the change in how the target index advances (768 to 769 per pulse; both modes still offer 768 units per pulse, with the same 96 + 96 floor and 576 majority allocation) can be seen.
   Step 1 re-reads every file and `screens.ts` is the source; this list is the working hypothesis. The pairing and primary/replication seeds in `screens.ts` carry the explore.ts line they came from.
2. Seeds: the table gives uniform-food seed 1201 only; code allows 1201 to 1203. Replication seeds are separate tools, so "limited to the screen's seeds" means primary plus replication seeds.
3. The planning section's drawing helpers exist (`movingBandGeometry(tick)`, `splitBandGeometry()`, `alternatingBandAtPulse`, `footholdBandAtSlot`, `schedule769PulseTargetTile`; food-schedule-769 model). Review finding 1: `world.foodTargets` is the ELIGIBLE area (9,216 tiles uniform, 4,608 split/foothold, a whole band for alternating), not what a pulse offers: `supplyFood` selects 768 slots. So the overlay has two layers, drawn and labelled differently: (a) "where food may be offered now" = `foodTargets` as a light tint (band outline, split columns, floor columns), (b) "what the last pulse actually offered" = the 768 slot tiles, derived by the mode's own slot-target function (as `supplyFood` does) and checked in tests against an independent oracle: the food-byte delta of the world across a pulse (tiles whose food rose by the offered amount in that pulse), not against the same getter that draws. Before the first pulse layer (b) is empty and says "no pulse yet". Pulse boundaries use model semantics: pulse index 100 is supplied at tick 505, so tick 500 completes pulse index 99; tests derive the boundary from the model (`alternatingBandAtPulse` plus the world's own pulse counter), not from tick/100 arithmetic.
4. Pure stepping is cheap: a node 24 measurement here steps 3,000 ticks of the newest model in about 50 ms (uniform and schedule-769, seed 1202). Review finding 12: that is a Node stepping figure only; it says nothing about browser drawing, getter array copies, JSON parsing or snapshot materialisation. So: no worker initially, but the e2e measures long tasks in the browser (see Tests) and the replay compare is sliced.
5. The "copy chain" claim ("newest says old modes preserved") is untested; parity is step 2 and may well fail for some screens (the newest model has `maxHistory` 451 like uniform-endurance, hungry-shapes has 301, and RULES differ in history length, which could change census history output even if dynamics match). The plan assumes nothing: the harness loads the screen's own model for any non-matching screen.
6. Replay file shape (checked on `split-food-seed-1202.json`): top-level `samples[]` (every 20 ticks: `census`, `environment`, `censusSha256`, `stateSha256`, `frameSha256`), `tickRows[]` (every tick: population, cells, births, deaths), `frames[]`, `snapshots[]`. `censusSha256 = sha256(JSON.stringify(census))`, `stateSha256 = sha256(JSON.stringify({state: world.snapshot(), environment}))`. Review finding 2: `snapshot()` embeds a `runtime` string (`"Node 24.2.0"` in the recordings, `"browser"` or another Node version live), so the raw `stateSha256` cannot match across hosts. The check therefore (i) deep-equals the census at all recorded sample ticks (151 at 3,000, 301 at 6,000, 451 at 9,000), (ii) compares `tickRows` every tick, (iii) at saved snapshot ticks compares a normalised state digest: clone the live snapshot and the recorded snapshot, set `runtime` to a fixed string in both, hash both; rules, history, lineage, food, organisms and environment stay in. Where the normalised recorded snapshot exists, it is also checked to hash to the recorded `stateSha256` once its original `runtime` is restored (proving the recording is intact). Results say "equal after ignoring the runtime label".
7. Private-page checklist: `/hungry-shapes/` is in the lab experiments list (`playground.spec.ts` line 22) and in the `DIAGNOSTIC` list of `tests/e2e/public-routes.spec.ts`. `/food-bands/` gets the second, not the first (D7). `deployment-config.test.ts` and `site-image.yml` contain no per-page names; verify in step 5 that nothing else enumerates private pages (the Caddyfile matcher and `Dockerfile.site` rm list are the two places).
8. The 6 known failures in `tools/test/food-band-foothold-replication.test.ts` ('Pinned input changed: package.json') are pre-existing and out of scope.

## What is built

### screens.ts (step 1)
`apps/lab/src/food-bands/screens.ts`: a typed table of 11 screens (or 12 if food-floor-replication stays separate). Per screen: id, plain-language title, `question` (one sentence), arms (each: id, mode, model key, label, `what differs` sentence), seeds `{primary, replication[]}`, horizon, pulse budget and band geometry numbers read from the model at runtime where possible (never retyped), source tools, replay file name per arm and seed, `modelKey` resolved by step 2, and `provenance` (explore.ts file and line numbers). No model code is duplicated; the file imports only types and constants.

### Model resolution (step 2)
`apps/lab/src/food-bands/models.ts`: `loadModel(key)` returns the newest model for screens where parity holds, otherwise `await import()` of the screen's own model; `uniform-food` always uses `hungry-shapes/model.ts`. Parity result is a checked-in table (`PARITY` in `models.ts`) that the parity test asserts against, so the page's choice cannot silently drift. No `model.ts` is edited.

Parity method (finding 6 makes the predicate explicit). Two measured predicates, both recorded per screen, mode and seed:
- `dynamics`: at ticks 0, 500 and the screen's final tick, equality of the census (with `history`/`maxHistory`-dependent fields excluded and named), a digest of food bytes, and a digest of the sorted (tile, organism id, family, energy) cells plus environment counters. This decides whether the newest model reproduces the screen's behaviour.
- `observation`: exact equality including `RULES` and the full snapshot (normalised only for `runtime`). Expected to be false wherever `maxHistory` differs (hungry-shapes 301 vs newest 451); this is an observation-only difference and is listed, not hidden.
Resolution rule: the newest model is used for a screen only when `dynamics` holds for every mode and seed AND the screen's own `RULES` equal the newest `RULES` (so the displayed history length is what the screen ran); otherwise the page imports the screen's own model. uniform-food is always hungry-shapes regardless. The same predicate and code serve the short and full-horizon runs. `PARITY` records `{screen, ownKey, resolvedKey, dynamics, observation, differingRules[]}`; original and resolved keys are never conflated. The test asserts that every `false` yields the own-model fallback.

### Rendering and page (step 3)
- `apps/lab/food-bands/index.html`: noindex, skip link, header like hungry-shapes.
- `apps/lab/src/food-bands/render.ts`: new drawing code written from `hungry-shapes/page.ts` (that file is not edited): cell/organism/food drawing, family colours (#91e1c0, #f2be78, #b5adf2), population-history strip, accounting table, and a target overlay (translucent tiles for `foodTargets` this pulse, outlined band geometry, footing floor columns for foothold and 769, a small pulse and band readout, e.g. "pulse 412, band 0").
- `apps/lab/src/food-bands/page.ts`: screen picker with a description under each choice (what the arms are, why the screen was run, tick horizon, seeds), seed buttons for the screen's seeds plus an "Other seed (exploration)" path with its own warning, one or two cards, one shared clock (`advanceDevelopmentComparison` pattern from `development/comparison-clock.ts`, extended only through a local wrapper), play/step/pace, reset, reduced-motion start paused, tab-hidden pause, horizon stop, extinct-world freeze, the "Exploration, not evidence" label, optional census JSON download.
- `apps/lab/src/food-bands/replay-check.ts`: fetches the matching replay file (HEAD first; hides the control when absent or not JSON) and reports "identical at all N recorded ticks" or "first differs at tick T (field F)". Requirements from review findings 3, 4, 5:
  - Serving (finding 3): the stock Vite root is `apps/lab`, with no `/docs/creative-prototypes/` mount. Add a small DEV-ONLY plugin in `apps/lab/vite.config.ts` (`apply: "serve"`, allowlist: only `/docs/creative-prototypes/<name>.json` whose name is in the screens table; read-only; absent file gives 404; never active in `vite build`). An integration test starts the real dev server and fetches a restored replay over HTTP with no Playwright route fulfilment (skips if the file is absent); another asserts the plugin is absent from the build.
  - Validation before comparing (finding 5): the file must declare the expected seed, mode(s) and no mutation, rules, and a terminal tick equal to the screen horizon (schedule-769's gate artifact with `maxTick 6000` but `finalTick 3000` is reported as "partial: N ticks", never "identical over the horizon"); `samples` non-empty at exact 20-tick cadence from 0, `tickRows` contiguous and non-empty, required snapshot ticks present, no duplicate ticks. The report states how many ticks were compared and fails closed (result `invalid`, not `identical`) on empty, truncated or mislabelled input.
  - What is checked (finding 4): the check runs on the ACTIVE card world(s) the page is displaying (same seed, arm, model and clock), not a separate fresh world, by replaying the card from tick 0 into a scratch copy built through the same `loadModel(key)` path and the same arm/seed fields the card used; and at selected recorded frame ticks it compares the card's frame projection (food bytes, occupied cells, organism ids and families) to the recorded `frames[]` entries. A render oracle test (in `food-bands-render.test.ts`) draws a recorded frame into an offscreen canvas and checks tile colours at known coordinates, covering orientation and the three family colours, so a wrong-way or wrong-colour picture fails.
- `apps/lab/src/food-bands/style.css`.

### Private-page checklist (step 5)
Edits: `apps/lab/vite.config.ts` (input `foodBands: r("./food-bands/index.html")`; finding 7: the existing `hungry-shapes-model` chunk name and its packaging-test contract stay as they are; food-bands gets its own distinct names `food-bands-page` and `food-bands-model-<screen>` for each dynamically imported screen model, and may share the existing chunk for the newest model only if the build is shown to keep every retained public entry free of broken imports), `Dockerfile.site` (rm `apps/lab/dist/food-bands`, `assets/foodBands*`, `assets/food-bands*`), `deploy/Caddyfile` (`@private_food_bands path_regexp private_food_bands (?i)^/food-bands(?:/|$)` and `respond ... 404`), `tests/e2e/public-routes.spec.ts` (add `/food-bands/` to `DIAGNOSTIC`). If dynamic models are split into separate chunks, name them so the Dockerfile glob catches them. The packaging test additionally runs a real `vite build` into a scratch outDir, applies the Dockerfile.site rm commands to a copy, and walks static and dynamic imports from every remaining HTML entry: no remaining file may reference a removed file, and no remaining file under `assets/` may contain a food-bands-only chunk (identified by the `food-bands` name or the page's unique marker string). The Caddy matcher covers page URLs only; asset URLs are protected by deletion from the image, which is why that walk matters.

## Files

New:
- `apps/lab/food-bands/index.html`
- `apps/lab/src/food-bands/{screens.ts,models.ts,render.ts,page.ts,replay-check.ts,style.css}`
- `apps/lab/test/food-bands-screens.test.ts`, `food-bands-parity.test.ts`, `food-bands-parity-full.test.ts` (long horizon, separately runnable), `food-bands-render.test.ts`, `food-bands-replay-check.test.ts`, `food-bands-packaging.test.ts`
- `tests/e2e/food-bands.spec.ts`
- `docs/visualization-gaps-2026-11-14/food-live/{PLAN.md,REVIEW.md,EVIDENCE.md}` and screenshots under `docs/visualization-gaps-2026-11-14/food-live/shots/`

Edited: `apps/lab/vite.config.ts` (input, chunk names, dev-only allowlisted replay route), `Dockerfile.site`, `deploy/Caddyfile`, `tests/e2e/public-routes.spec.ts`. Unchanged and asserted unchanged: every `apps/lab/src/*/model.ts`, `hungry-shapes/page.ts`, `tools/*/explore.ts`, `package.json`.

## Tests (named cases)

`food-bands-screens.test.ts`
- every screen id unique; every arm mode is a mode its model accepts (constructing a world succeeds).
- seeds and horizons in `screens.ts` equal the values parsed from the matching `tools/<dir>/explore.ts` (`MAX_TICK`, the `new HungryWorld(seed, true, mode)` literals and `runArm` seed types) for all 18 directories.
- the SHA-256 of each `apps/lab/src/*/model.ts` equals the digest pinned in the explore.ts files that import it (newest model pinned by food-schedule-769 explore.ts; hungry-shapes pinned elsewhere); fails if a model file is edited.
- no choice text is empty and each arm has a `what differs` sentence.

`food-bands-parity.test.ts` (always on)
- `dynamics and observation parity at ticks 0, 500 and 1000` for every screen, mode and seed (cheap), plus `uniform-food always resolves to hungry-shapes`.
- `PARITY table equals measured result` (asserts the checked-in resolution map against the run, not a hand copy), and `a false predicate resolves to the own model`.
- `RULES differences are listed` (documents `maxHistory` and any other diffs rather than hiding them).
- negative control: a deliberately perturbed copy of one world (one food byte changed) makes the `dynamics` predicate fail, so the predicate cannot pass vacuously.

`food-bands-parity-full.test.ts` (finding 10: vitest includes every `apps/lab/test/**/*.test.ts`, so a file name does not separate it)
- `full horizon parity` at the screen's final tick (3,000, 6,000 or 9,000). Measure its wall time first. If the file stays under about 60 seconds it is simply always-on. Otherwise it is guarded by `describe.skipIf(!process.env.BL_FOOD_PARITY_FULL)` and run explicitly as `BL_FOOD_PARITY_FULL=1 pnpm vitest run apps/lab/test/food-bands-parity-full.test.ts`, the result goes in EVIDENCE.md, and the guard is stated in the test header.

`food-bands-render.test.ts`
- eligible-area layer equals `world.foodTargets`; offered-slot layer equals the independent food-byte-delta oracle across a pulse (see Corrections 3), for each mode at ticks 0, 1, 5, 500 and across pulse boundaries (alternating flips at the model's pulse 99 to 100 transition, tick 500 vs 505; split shows two columns of 24 wide; moving band left edge equals `movingBandGeometry(tick).left`; foothold floor columns present; exactly 768 offered slots per pulse).
- accounting table values equal `environment` fields (pulses, offered, accepted, overflow).
- population-history points match `census()` samples every 20 ticks.

`food-bands-replay-check.test.ts` (skips cleanly when the replay is absent, `existsSync` check like `tests/e2e/food-schedule-769.spec.ts`)
- always run (synthetic, no real file needed): empty `samples`, truncated horizon, duplicate tick, missing `tickRows`, wrong seed, wrong arm and wrong rules each return `invalid` (never `identical`); a perturbed in-memory census reports the right first-different tick and field; absent file returns `unavailable`; runtime-label-only difference still counts as equal.
- real-artifact integration (skips cleanly when the replay is absent): identical for one arm per screen over the full horizon, from the real file over HTTP. The per-screen replay acceptance gate is reported as INCOMPLETE, not passed, for any screen whose file is absent.

`food-bands-packaging.test.ts` (modelled on `hungry-shapes-packaging.test.ts`)
- Vite input and chunk name; every Dockerfile rm path; Caddy matcher exact string and matches `/food-bands`, `/food-bands/`, `/FOOD-BANDS/index.html`, not `/food-bands-other`; `<meta name="robots" content="noindex">`; no link to `/food-bands/` from `playground`/lab list/sitemap; `DIAGNOSTIC` list in public-routes spec contains it.

`tests/e2e/food-bands.spec.ts` (Chrome, `BL_E2E_PORT=5268`)
- `opens paused with the first screen and no console errors`.
- `every screen steps 5 ticks and shows its overlay` (loops the picker).
- `moving band overlay shifts between tick 0 and tick 300`; `alternating overlay switches band at pulse 100`; `split shows two columns`.
- `other seed path shows the exploration warning`; `reset returns to tick 0`.
- `horizon stops the clock` (set pace to maximum for a 3,000-tick screen, assert tick equals horizon).
- `compare with recorded run` (skips without the replay): button visible, result text contains "identical", for at least one screen per family; hidden for a screen whose file is missing (route-intercepted to 404).
- `axe at desktop (1280) and phone (375)` with no violations, run on the initial page AND after the seed warning is shown AND after a replay-check result is displayed; `no horizontal scroll at 375`.
- finding 11: `keyboard only` (picker, seed, play, step, reset, compare reachable and operable by Tab/Enter/Space); `reduced motion starts paused` (emulated media); `hidden tab pauses and restore does not jump the clock` (pattern from hungry-shapes.spec.ts:69).
- finding 12: `paired playback to 3,000 ticks stays responsive`: record long tasks via PerformanceObserver and assert none above a stated budget (start at 200 ms; record the measured figure in EVIDENCE.md; a full replay compare runs in slices with progress, never one blocking task over the budget). Still no worker unless the measurement fails.
- screenshots at 1280 and 375 mid-run for at least four screens.

## Acceptance gates (runnable)

Prefix `PATH=$HOME/.nvm/versions/node/v24.2.0/bin:$PATH`.
1. `pnpm typecheck`
2. `pnpm vitest run apps/lab/test/food-bands-screens.test.ts apps/lab/test/food-bands-parity.test.ts apps/lab/test/food-bands-render.test.ts apps/lab/test/food-bands-replay-check.test.ts apps/lab/test/food-bands-packaging.test.ts`
3. `pnpm vitest run apps/lab/test/food-bands-parity-full.test.ts` (alone; result recorded in EVIDENCE.md)
4. `BL_E2E_PORT=5268 npx playwright test tests/e2e/food-bands.spec.ts tests/e2e/public-routes.spec.ts`
5. `pnpm test` with the six known `food-band-foothold-replication` failures noted, nothing else new; if a load-sensitive test times out, rerun it alone and note it.
6. `pnpm build` then confirm `Dockerfile.site`'s rm paths remove every `food-bands` output: the packaging test's import walk (above) plus a manual `find apps/lab/dist -iname '*food-bands*'` and `grep -rl food-bands apps/lab/dist` after applying the rm line, both empty.
7. Finding 8: `git diff --stat`, `git diff --cached --stat`, `git status --short` and `git diff --cached --name-only` show no change to any `model.ts`, `hungry-shapes/page.ts`, `tools/*/explore.ts`, `package.json`, `deno.lock`, golden pins, and no replay JSON, mp4 or tar.gz in the diff, staged or untracked-and-unexcluded (`git check-ignore -v` / the shared exclude lists the restored files). The coordinator stages exact paths only (D6); this slice stages nothing.
8. EVIDENCE.md: parity table, replay-check result per screen (live equals recorded over the full horizon for at least one arm of every screen), the screenshots read and described.
9. Codex review (Sol 6.1, xhigh as ordered) read-only; findings fixed or answered in REVIEW.md.

## Order of work
1. Re-read the 18 explore.ts files; write `screens.ts` and its test.
2. Parity harness and `models.ts`; run, record table; branch on result.
3. `render.ts`, `page.ts`, `index.html`, `style.css`, render tests.
4. `replay-check.ts` and tests; run it for every screen (the fixed-number evidence).
5. Private-page checklist, packaging test, e2e with axe, screenshots.
6. Gates, Codex review, REVIEW.md, EVIDENCE.md.

## Non-goals and limits
- No change to dynamics, models, RULE_VERSION, explore tools, pins; no new dependency.
- Not evidence: no pass/fail verdicts, no gate language, no claims about adaptation or tracking. Other seeds are exploration.
- No writes under `docs/creative-prototypes/` or `experiments/`; no file output except an explicit user download.
- Does not restore replays or copy `restore.sh` (PR #157). Without replays the compare control hides and replay-based tests skip.
- No worker, no GPU, no video capture, no Deno. No deploy. No lab-list link (D7).
- Live results on another machine's Node or browser may in principle differ; the model is integer-only, and the replay check is the evidence it does not.
- Schedule 769's historical foothold comparison arm is shown only if the picker's optional second world is built; the recorded gate receipts stay on their own result page.

## How to try it

```bash
cd /Users/nicholas/develop/browser-life-viz-food-live
export PATH=$HOME/.nvm/versions/node/v24.2.0/bin:$PATH
node_modules/.bin/vite apps/lab --port 5267 --strictPort     # or: pnpm --filter ./apps/lab exec vite --port 5267 --strictPort
open http://localhost:5267/food-bands/
```
Pick "Split band vs stationary band", press Play, watch the two 24-wide columns light up. Switch to "Alternating band" and watch the lit side flip every 100 pulses. Pick a screen with a recorded run, press "Compare with the recorded run" (replays must be restored here, `tools/creative-prototypes/restore.sh <this worktree> --check` from the PR #157 branch). Replay-dependent checks run with `BL_E2E_PORT=5268 npx playwright test tests/e2e/food-bands.spec.ts`.
