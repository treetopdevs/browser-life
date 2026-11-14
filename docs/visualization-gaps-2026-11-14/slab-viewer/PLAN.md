# slab-viewer: see the 3D slab worlds, live (plan, 2026-11-14)

Branch `claude/viz-slab-viewer`, built on `claude/3d-cyclic-rps` (7bb61be2; decisions D8 and D10 of the run: local commits only, no push, no PR, cyclic competition first). Planning source: section "`slab-viewer`" of the run's PLAN.md. This file is the slice's own plan; it does not touch the run-level PLAN.md.

## Step 0 spike: PASSED (done in this stage, in real Chrome)

Method: a throwaway page `apps/lab/spike-slab.html` plus a throwaway spec (both deleted again; `git status` is clean apart from this folder), run with `BL_E2E_PORT=5266 npx playwright test` in Chrome with this repo's WebGPU flags (Apple GPU through Metal). Each world was created, stepped and read back inside the page; the page was served by Vite from `apps/lab`, importing the pinned spike files by relative path and the packages through the `@bl/*` aliases. No shim was needed: `gpu-sim3-rps.ts`, `shaders3d-rps.ts`, `world.ts` and `rungs.ts` have no Deno or node imports (`lib.ts` reaches `Deno` only through `globalThis`, inside a function the page never calls). `adapter.ts`, `driver.ts`, `jobs.ts` and `lib/kernel-job.ts` are not imported by the page.

| world | what ran | result |
|---|---|---|
| cyclic competition, 128 x 128 x 4 | `rpsMix` founding (S0, seed 401, spread 8), 600 burn-in steps with the kill off, `readState`, destroy, a new `GpuSim3` with the vacancy kill at rate 64, 600 more steps, `readSnapshot` | works. Step counter continues across the hand-over (600, then 1200). About 1,040 steps/s burn, 1,350 steps/s with the kill. Labels after 1,200 steps: 22,911 / 17,528 / 18,065 cells of types 0/1/2, 7,032 empty (10.7 %). One readback 1.3 ms. |
| cyclic competition, 256 x 256 x 4 | same | works. About 340 steps/s. Labels 75,713 / 74,275 / 82,472, 29,684 empty (11.3 %). Readback 8.4 ms. |
| slab ecology, 128 x 128 x 8 (not a recorded shape) | `slab-spots` preset, mu 30, sigma 8, lightK 256, seed 101, `initWorld`, 1,000 steps, `readCells` | works. About 910 steps/s. 3,331 of 131,072 cells living at step 1,000. |
| slab ecology, 256 x 256 x 8 (the recorded shape) | same | works. About 280 steps/s (the M3 timing gate recorded 234.5). 3,237 of 524,288 living at step 1,000. Readback of cells plus two genome channels about 10 ms. |

Build-side probe (also done, then deleted): a throwaway module importing `applySettings` and `SUBMIT_STEPS` from `adapter.ts`, `jobConfig` from `rungs.ts`, `rpsMix` from `world.ts` and `GpuSim3` from `gpu-sim3-rps.ts` passes `pnpm typecheck` (the root tsconfig, no node types) and a `vite build` with the probe as an extra input. `adapter.ts` reaches `kernel-job.ts` only through `import type` (erased), and its value imports (`readout-kernel.ts`, `readout-gate0.ts`, `readout-jobs.ts`, `@bl/metrics`) contain no `node:` imports, so the page imports `applySettings` and `SUBMIT_STEPS` directly: there is no page-local copy of the setter.

Verdict: the real kernels run in a lab page. Rung A (readback, 2D canvas) is feasible at both shapes; the readback is not the bottleneck (10 ms against a 3 to 4 ms step at 256). Rung B is not needed. If this had failed the plan would say STOP; it did not. One caveat carried into the build: the ecology numbers above were taken at 1,000 steps only. The long-run picture (50,000 steps) is not asserted by any test; test 23 reproduces the recorded 5,000- and 10,000-step living fractions, and the later carpet is looked at in EVIDENCE.md screenshots.

Hard constraint found by reading the spike: `RPS` in `shaders3d-rps.ts` is module state baked into the shader text when a simulator is created. So the cyclic world switches kill settings only by read state, destroy, set `RPS`, create (the harness's own hand-over), and only one patched simulator may exist at a time. The page keeps a single live simulator and destroys it before creating any other.

## What a person can see after this slice that they cannot now

At `http://localhost:5265/slab/` (private, noindex) a person can watch the 3D slab worlds run live in Chrome:

- **Cyclic competition** (default): three types that each beat the next in a ring, one canvas tile per layer (four, z = 0 to 3), plus one larger top-down view. Types are three distinct colours, empty cells dark. A census strip shows the share of each type and the empty share, live. They can see whether the domains and fronts form spirals or blobs, and whether a front is flat or tilted through depth.
- **Slab ecology**: the main rule set on the slab (eight layers, not four), drawn with the lab's lineage colouring, one tile per layer plus the top-down view, and a census strip with the living fraction of every layer.
- Play, step, pace, seed, world choice, a layer isolate control, and a short note under every control saying what it changes. Nothing like this exists today: the 3D line has only headless runs and a bench page.

It is labelled **exploration, not a result**. Neither world passed its gate, and the page says so in words.

## Corrections to the planning section (verified in the worktree)

1. **"The slab is only four cells deep."** True of cyclic competition (`SHAPE` 128 x 128 x 4, horizon rung 256 x 256 x 4). False for the ecology: `slab-spots` is 256 x 256 x 8, and every M4 calibration run used depth 8. The viewer takes the depth from the config and draws D tiles (4 or 8). Layer order: `docs/3d-rung1b-step-spec.md` line 37 fixes `i = z*WH + y*W + x`, x east, y south, z downward, layer 0 the surface where light enters; `packages/sim-gpu/src/shaders3d.ts` and `step3d.ts` implement that spec bit for bit, and `world.ts` (`rpsMix`) uses the same `i = (z * H + y) * W + x`.
2. **"Calibration found no ecology setting that qualifies (living fraction around 0.001)."** The first half is right (`m4-pick-output.md`: none qualifies, 180 of 180 runs finished). The 0.001 is one corner only (`mu20-s12-k1024-seed101`, 0.0011 living; 28 runs went extinct). Most settings with mu 40 or more end as a carpet, 88 to 100 % living, while mu 20 and several mu 30 settings (for example `mu30-s20-k1024-seed102` and `mu30-s20-k256-seed101/102`) go extinct or stay near 0.01 living. So the ecology world is not "nearly empty" by default; the page describes outcomes per full setting and seed (mu, sigma, lightK, seed), never per mu alone.
3. **"Existing `readCells()` readback."** `readCells()` returns the seven cell channels only. Lineage colour needs the two lineage genome channels (`readGenomeChannels(G.LIN_HI, 2)`); cyclic type needs the PARAM1 byte (`readSnapshot(false)` returns `cells` and `genomeHead`, and `rpsLabels` from `@bl/metrics` turns them into per-cell labels). Both are existing methods; no new shader.
4. **"The `GATE0-EXPLORATION-2.md` runs, the results folder."** The 9 job directories of Amendment 2 are not in this worktree (`experiments/3d-rps/results/` holds only the lattice files; the jobs ran on the work Mac). The operating point is fully determined by the committed record and code instead: `GATE0-EXPLORATION-2.md` table rows, `rungs.ts` (`jobConfig`, `mixParams`, `killSettings`), `world.ts` (`rpsMix`), burn-in 6,000 steps at rate 0 (`RULES.md`, `kernel-job.ts`). The page cites the job ids from the table.
5. **Private-page convention.** `apps/lab/test/hungry-shapes-packaging.test.ts` does not exist on this branch (it lacks `/hungry-shapes/`). This branch's private page is `/garden/`: a Vite `input` entry, `rm -rf apps/lab/dist/garden` in `Dockerfile.site`, a `@private_garden` 404 matcher in `deploy/Caddyfile`, `<meta name="robots" content="noindex">`, no canonical link (so `withSocialMeta` adds no social tags), not in `sitemap.xml`. There is no `manualChunks`, so no chunk name to add. The slab page copies that, with `apps/lab/test/social-meta.test.ts`'s `UNSHARED` list and a new packaging test.
6. **Port and spike files.** The spike files hash check still holds: `(cd experiments/3d-rps/gate0-spike && git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256)` gives `761ea02a...140cc7`, equal to line 1 of `gate0-spike.sha256`.
7. **Frame pacing numbers in the run plan** ("128 and 256") are for a 2D canvas redraw; the spike measured the sim and readback, not the draw. The draw cost (262,144 or 524,288 pixels per tile set, plus the projection) is measured in the e2e and recorded in EVIDENCE.md.

## Operating points (what the page starts from, all recorded, none registered)

Decision D10: Gate 0 ended GATE-0-STOP, so there is no registered operating point. Everything below is an exploration setting from a committed record, labelled as such on the page, with the job or run id.

**Cyclic competition, default**: `GATE0-EXPLORATION-2.md` job `g2-confirm-V-sp8-r64-s401` (rung V on S0, the vacancy kill): S0 substrate, 256 x 256 x 4, spread 8, kill rate 64, rpsMin 4, seed 401, founding `rps-mix` (3 types, 75 % occupied, columns), 6,000 burn-in steps at rate 0, then the kill on. Recorded outcome: class DC (dynamic coexistence) for 200,000+ steps; seeds 401 and 402 persisted, 403 lost a type. Why this default: it is the recorded cyclic setting that kept all three types in two of three seeds for 200,000+ steps (class DC, turnover about 0.12). The removal-kill and control rows also report living fraction 1; occupied fraction is not the criterion, coexistence is. The page says this. Choices offered, each explained on the page:

- **Vacancy kill, rate 64** (default): a cell next to a stronger type may be emptied. Recorded: 2 of 3 seeds kept all three types for 200,000 steps at 256 x 256 x 4.
- **Removal kill, rate 64** (`g2-confirm-S0-sp8-r64-*`): the stronger neighbour eats part of the biomass. Recorded: all 3 seeds lost a type. Expect one type to vanish; watching that is the point.
- **No kill, rate 0** (`g2-horizon-S0-sp8-r0-*`): the control; types only drift. Recorded at 256 x 256 x 4: all three seeds class CHURN (types persist, with turnover); at 128 x 128 x 4 the horizon seeds were LOSS, LOSS, CHURN. The page shows the row for the chosen size.
- **Size**: 256 x 256 x 4 (recorded for these jobs, about 340 steps/s) or 128 x 128 x 4 (the registered pilot's shape, about 1,300 steps/s; its recorded jobs are the Amendment 1 table in `GATE0-EXPLORATION.md`; the Amendment 2 jobs were all 256 x 256 x 4). Provenance is resolved from the complete tuple (world, shape, seed, kill form, rate, burn-in) against the matching record; a tuple with no matching row is labelled "not recorded" and names no job id.
- **Seed**: 401, 402, 403 (recorded), or any number (marked "not recorded").
- **Burn-in**: "As recorded: 6,000 steps with the kill off first" or "Kill on from step 0" (not recorded).

**Slab ecology, default**: M4 run `mu40-s20-k1024-seed101` of `experiments/3d-slab/m4-results.tsv`: `slab-spots` at 256 x 256 x 8, defaultMu 40, defaultSigma 20, lightK 1024, seed 101, built exactly as `m4-calibrate.ts` builds it (`presetConfig` with the three overrides, `initWorld`). Recorded (`livingFracEvery5k`, sampled every 5,000 steps, so the columns are steps 5,000, 10,000, 15,000, ...): 4.19 % living at step 5,000, 54.26 % at 10,000 and 100.0 % from 15,000 to 50,000, floor light 0.7945 of surface. Many settings tie at 100 % living; the tie-break is the plan's own M4 pick-rule order (larger lightK, then larger sigma, then smaller mu) among the settings that end at 100.0 % on seed 101 with a floor light under 0.8, which picks this one for the default (checked against the TSV: the next candidates are mu40-s16, mu50-s16, mu50-s12 at the same lightK): a full carpet that still shades its floor, so layers differ. Alternatives, each explained on the page: `mu30-s8-k256-seed101` (the nearest miss: 44 % living, the only half-living world), `mu60-s12-k256-seed101` (97 % living, the floor really is shaded, 0.56), `mu20-s12-k1024-seed101` (0.1 % living, the sparse corner; seed 102 of the same setting goes extinct at step 9,000). Size 256 x 256 x 8 (recorded) or 128 x 128 x 8 (not recorded; dynamics differ). The page states plainly: no setting qualified, M4 "none qualifies", the 3D line is closed at rung 1b, and the viewer starts at step 0 from eight small balls, so reaching the recorded full carpet (step 15,000) takes about a minute and the 50,000-step state five minutes or more at the fastest pace (the sparse start runs near 280 steps/s, a carpet near 160, as the M4 runs recorded).

## What is built (rung A only: no new WGSL, no volume renderer)

Pure modules first, then the page.

`apps/lab/src/slab/render.ts` (pure; no DOM, no GPU; the unit-tested core):
- `tileLayout(W, H, D, maxCols)` returns the grid of layer tiles: tile z at column `z % cols`, row `floor(z / cols)`, each W x H, z = 0 first, top left. Cell (x, y, z) is at index `i = (z * H + y) * W + x` (the cyclic world's convention, and the ecology's: `gpu-sim3.ts` and `step3d.ts` use the same layout, checked below). x runs right, y runs down the canvas (row y of the array is row y of the picture, as the lab renderer draws). The step spec says x and y wrap and z is closed; the views draw the tile as is (no wrap-around drawing), and the test pins which array element is the top-left pixel and which the bottom-right.
- `cyclicColours`, `rpsPixel(label)`: three type colours chosen to be distinguishable in light and dark and under common colour-vision deficiencies (checked against the repo's colour tokens where they exist), empty cells near-black. Labels come from `rpsLabels`.
- `lineagePixel(hi, lo, B, P, A, unit)` with `unit` = 256 (what `sim.worker.ts` passes to `renderer.draw`, also its default). It does not re-derive the hue: it calls `lineageRGB` from `@bl/metrics` (`packages/metrics/src/render.ts`, which uses wrapping `mulu` and mirrors the WGSL) and applies the brightness `sqrt(min(1, (B+P) / unit))`. The dead-cell/background branch is copied from `renderRGBA` lineage mode and `renderer.ts` and depends on nutrient `A`, so `A` is a parameter (the ecology readback includes it). Test 5 compares against `renderRGBA(state, "lineage")` pixel for pixel on a hand-built state, including nutrient-varying dead cells and lineage ids above 2^16.
- `projectColumn(...)`: the combined view. Cyclic: per-column majority type among occupied layers (ties go to the lowest z, the surface), empty only if the whole column is empty. Ecology: the layer with the most `B + P` in the column wins ("densest wins"). A toggle switches combined and "layer z only" (the isolate control); a slider picks z.
- `censusCyclic(labels, dims)` (shares per type and the empty share, per layer and total) and `censusEco(living mask, dims)` (living fraction per layer and total). Integer counts; shares are derived once for display.
- `paint(target: Uint8ClampedArray, ...)` writes RGBA for a tile or the projection so the page only does `putImageData`.

`apps/lab/src/slab/worlds.ts`: the world table (ids, titles, the plain-language explanation of each option, the cited records), and the two simulator adapters behind one interface `{ run(n), snapshot(), step, destroy() }`:
- cyclic: `jobConfig("S0", shape, 8, seed)`, `rpsMix`, `RPS` settings through the spike's own `applySettings` and `SUBMIT_STEPS` (imported from `adapter.ts`, probed above), the hand-over after the burn-in, `rpsLabels` over `readSnapshot(false)`. Burn-in and run steps are submitted in batches of at most `SUBMIT_STEPS` (100) like the harness.
- ecology: `presetConfig(presetById("slab-spots"), seed, { tileW, tileH, defaultMu, defaultSigma, lightK })`, `initWorld`, `requestDevice3`, `readCells` and `readGenomeChannels(G.LIN_HI, 2)`.
Dispatch of any restart (world, setting, size, seed, burn-in, and the cyclic hand-over): all create, advance, readback and destroy calls go through one serial promise queue (like the lab's `exclusive()`), and a generation counter is checked after every await. A creation that finishes after a newer request has superseded it is destroyed at once and never becomes current; a readback that returns after a switch is dropped. `sim.destroy()` frees buffers but not the `GPUDevice`, so the page owns one device per page load (per world kind: ecology via `requestDevice3`, cyclic via the spike's device request) and reuses it across restarts; device loss shows the error text. Rapid consecutive changes during creation are an e2e case (test 24b).

Hand-over exactness: advancement is split exactly at step 6,000 (a manual Step, Step +100 or a 400-step frame that would straddle 6,000 is cut in two runs), the whole state is read, the simulator destroyed and rebuilt from that state with the kill on, as `kernel-job.ts` does, and the next run starts at exactly 6,000.

`apps/lab/src/slab/page.ts` and `apps/lab/slab/index.html`, `apps/lab/src/slab/style.css`: the page. Layout: the page header in the site's style (reuse `site.css` and tokens like `/garden/`), an "Exploration, not a result" banner, the combined view large with the tiles beside or below it (CSS grid, one column at 375 px), controls on top, the census strip under the views, and a live status line (step, steps/s, draw ms). Frame loop: `requestAnimationFrame`; each frame submits `stepsPerFrame` steps, then reads back once and draws. Readback cadence follows the pace (one readback per frame, never more than one in flight, so the picture is always a real state at a stated step, shown as "step N"). Pace choices (steps per frame): Slow 5, Steady 20 (default), Fast 100, Fastest 400; the note under the control shows the measured steps per second and the equivalent for the current size. `Pause`, `Play`, `Step` (+1 step), `Step +100`. Canvases are `image-rendering: pixelated`, with `aria-label`s and a text alternative stating the step and the census. Honest empty states: no WebGPU shows a plain message and no canvas; a failed create shows the error text.

Controls and their explanations (no bare dropdowns; each option has visible text saying what differs):
world (two radio cards: what it is, depth, and whether it passed), setting (radio list as above), size, seed (number input with the recorded seeds as quick buttons), pace, play/pause/step, view (Combined / One layer, with the layer slider), burn-in (cyclic). Changing world, setting, size, seed or burn-in restarts the run and says "restarts the run from step 0".

## Verified in a real browser: how

1. `apps/lab/test/slab-render.test.ts` (vitest, no GPU): the pinned picture checks below.
2. `tests/e2e/slab.spec.ts` (Playwright, Chrome with the WebGPU flags): drives `/slab/`, asserts real GPU output, takes the screenshots, records frame pacing.
3. Screenshots at 1280 and 375 wide after several hundred steps for both worlds, read by the builder, with an honest description of what is visible in EVIDENCE.md.

## Files

New:
- `apps/lab/slab/index.html`
- `apps/lab/src/slab/render.ts`, `worlds.ts`, `page.ts`, `style.css`
- `apps/lab/test/slab-render.test.ts`
- `apps/lab/test/slab-worlds.test.ts` (the table and the setter; pure, no GPU)
- `tools/test/slab-packaging.test.ts` (node fs and a Vite build; `apps/lab/test` is browser-typed, as `tools/test/site-build.test.ts` explains)
- `tests/e2e/slab.spec.ts`
- `docs/visualization-gaps-2026-11-14/slab-viewer/{PLAN.md, EVIDENCE.md, REVIEW.md, shots/*.png}`

Edited (small):
- `apps/lab/vite.config.ts`: `slab: r("./slab/index.html")` is added to `rollupOptions.input` only when `process.env.BL_BUILD_SLAB === "1"`. A normal `pnpm build` (what `Dockerfile.site` runs) therefore emits no slab HTML, no slab entry script, no slab CSS and no slab-only chunks into `dist/assets/` (removing only `dist/slab` would leave those bundles served by Caddy). The dev server needs no input entry. Shared chunks are fine (the build splits only what other pages also use). The packaging test builds once without the variable (asserts no file in `dist` contains the slab entry's module name or `slab/`) and once with it (asserts the page builds, proving the import path and typings).
- `Dockerfile.site`: `rm -rf apps/lab/dist/garden apps/lab/dist/slab` (belt and braces; the real guard is the env-gated input).
- `deploy/Caddyfile`: a `@private_slab path_regexp private_slab (?i)^/slab(?:/|$)` matcher answering 404, beside the garden one.
- `apps/lab/test/social-meta.test.ts`: add `"slab/index.html"` to the `UNSHARED` array (line 22). That list is what asserts `pageMeta(source) === null` (no canonical link), `withSocialMeta` leaves the page unchanged, and the sitemap lists only `PUBLIC` pages; the glob `../*/index.html` already reads it. The garden page is not in that list today; it is left alone.

Not touched (verified by the gates below): everything under `experiments/3d-rps/` (all of it, including `FROZEN`, `RULES.md`, the 14 hash-pinned spike files, `gate0-spike.sha256`), `packages/**`, golden pins, `RULE_VERSION`, `step3d.ts`, shaders, `docs/visualization-gaps-2026-11-14/PLAN.md` and any other file directly in that folder. The page imports pinned files by relative path (`../../../../experiments/3d-rps/gate0-spike/...` from `apps/lab/src/slab/`; the packaging test builds the real module so a wrong depth fails) and never copies or patches them.

## Named test cases

`apps/lab/test/slab-render.test.ts` (`pnpm vitest run apps/lab/test/slab-render.test.ts`):
1. `tileLayout puts layer 0 top left and fills row by row` for D = 4 (1 x 4, 2 x 2 and 4 x 1 at the three column limits) and D = 8, with exact tile origins.
2. `index convention: a lone marker at (x=2, y=1, z=3) in an 8 x 8 x 4 label array lands on exactly one pixel of tile 3, at column 2, row 1` and on no pixel of tiles 0 to 2 (hand-built; asymmetric so a flipped axis or reversed layer order fails).
3. `corners: array elements 0 and (z*H+y)*W+x for x=7,y=7 map to the top-left and bottom-right pixel of their tile`.
4. `cyclic colours: three labels give three distinct opaque colours and the empty cell the dark one`; the three types are pairwise distinguishable (a minimum contrast distance, pinned).
5. `lineage colour matches the lab renderer`: `lineagePixel` equals `renderRGBA(state, "lineage")` on a hand-built state with living cells (including lineage ids above 2^16 where JS `*` and u32 `mulu` differ), a saturated cell, and dead cells with different nutrient `A`; plus five literal pixels computed by hand.
6. `projection, cyclic: majority type per column, ties to the lowest z` on a hand-built 3 x 3 x 4 column table; `empty column stays empty`.
7. `projection, ecology: densest layer wins` and `the isolate view shows exactly layer z`.
8. `censusCyclic counts add up`: per-type counts plus empty equal W x H x D, shares sum to 1; `censusEco` fractions per layer on a hand-built mask.
9. `pinned slab picture`: a valid stock-ecology fixture (RPS PARAM1 bytes are rejected by `validateState`'s reserved-genome check, so the CPU reference cannot hold an RPS state): `initWorld` on an 8 x 8 x 4 `slab-spots`-style config with a fixed seed, 20 steps through `RefSim3` (`@bl/sim-ref`), then `lineagePixel` over each layer through the same renderer path; the pixels of the tile set and the projection are hashed and the hash plus the living histogram per layer are pinned as literals. Layer order, axis orientation and the surface-first rule cannot flip without this failing. The RPS-side mapping (`rpsLabels` result to pixels) is covered by tests 2, 3, 4, 6 on hand-built label arrays, and on the real GPU by test 20b.
10. `x and y wrap, z is closed (documented, not drawn)`: on a hand-built 8 x 8 x 4 label array the tile edges are not stitched, and the test pins that the projection of column (0, y) never reads column (7, y) and that no layer reads outside 0 to D-1.

`apps/lab/test/slab-worlds.test.ts`:
11. `every recorded setting names a job id that appears verbatim in GATE0-EXPLORATION.md (Amendment 1), GATE0-EXPLORATION-2.md or as an M4 run id in m4-results.tsv` (read via `?raw` imports), and the row's shape, seed, kill form and rate equal the setting's fields (so the 128 option cannot cite a 256 job); a tuple with no row yields "not recorded".
12. `the default cyclic config equals jobConfig("S0", [256,256,4], 8, 401)` field for field, and the page's setting table only produces inputs `applySettings` accepts (kill rate 64 or 0, rpsMin 4) while out-of-bound inputs still throw through it.
13. `the default ecology config equals what m4-calibrate.ts builds` for mu40-s20-k1024, seed 101.
14. `every option has non-empty plain-language text and no hype words` (explanation strings checked for presence and length; the real check that each choice says what differs and why is the builder reading the page, recorded in EVIDENCE.md).

`tools/test/slab-packaging.test.ts` (`pnpm vitest run tools/test/slab-packaging.test.ts`):
15. `slab/index.html has noindex, no canonical link, no og tags, and is not in sitemap.xml or robots.txt`.
16. `vite.config.ts lists the slab input`; `Dockerfile.site removes dist/slab`; `deploy/Caddyfile has a private matcher that answers 404 for /slab and /slab/`.
17. `a default production build contains no slab page or slab-only asset; a build with BL_BUILD_SLAB=1 does build the page` (two `vite build` runs into temporary directories, as `site-build.test.ts`, 120 s timeouts), and no other page links to /slab/.
18. Where Caddy is installed (`/opt/homebrew/bin/caddy` is here), `caddy adapt` accepts the Caddyfile and a served copy answers 404 for `/slab`, `/slab/`, `/SLAB/index.html`, `/x/../slab/`, as `public-not-found.spec.ts` does for the garden.

`tests/e2e/slab.spec.ts` (`BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts`):
19. `cyclic: canvases are not blank and change between steps`: read pixels of the combined canvas and each tile; assert more than one distinct colour, then Step +100 and assert the pixel hash changed, and the step counter text moved from N to N+100.
20. `cyclic census adds up`: shares of three types plus empty read from the strip sum to 100 % (within rounding) and match counts from the raw snapshot.
20b. `pictures match the raw GPU snapshot`: the page, with `?debug=1` only, exposes the last raw snapshot (labels and dims, read-only). At a paused step after several hundred steps (layers have diverged by then; the founding is columns, identical in every layer, so step 0 cannot detect a reversed layer order), the test samples at least 200 fixed (x, y, z) coordinates, reads the pixel in tile z at (x, y) and compares it with the colour of the raw label at `(z*H+y)*W+x`; counts per layer are tallied once from the raw snapshot (not from the projection, which cannot recover them) and compared to the strip. A reversed layer order, a transposed axis or duplicated layers fail. The same for the ecology with the raw genome channels.
21. `play advances the counter and pause stops it`.
22. `ecology: eight tiles, non-blank, census per layer`: after a few hundred steps the canvases show living cells (from step 0 the balls are visible) and the strip has eight per-layer fractions.
23. `ecology reproduces the recorded living fractions`: with the default setting (seed 101, 256 x 256 x 8, no extra steps, steps submitted in batches of 100 as `m4-calibrate.ts` does), pause at exactly step 5,000 and 10,000 and compare the page's total living count (the simulator's `readStats().living`, the quantity the calibration used) divided by 524,288, rounded to 4 decimals, with the `livingFracEvery5k` values 0.0419 and 0.5426 of `mu40-s20-k1024-seed101` (step 15,000 onward is 1.0000, optional third check). This shows the page runs the recorded run and not a lookalike (about 60 s at 160 to 280 steps/s). If it differs, the cause is investigated and written down, not tolerated away. The page's own census must also equal that count at the pause.
24. `hand-over`: at 128 x 128 x 4 with a pace that straddles 6,000 (starting from step 1, advance 400 per frame) and again by manual Step +100 from step 5,950: the rebuild happens once, exactly at step 6,000 (the raw snapshot read just before and just after the rebuild is identical, via the debug hook), the counter continues 6,000, 6,001, ..., the status says the kill is on, and the labels after 200 further steps equal a direct spike run (`GpuSim3` with the same seed, 6,000 steps at rate 0, hand-over, 200 steps at rate 64) executed in the same page. 
24b. `rapid changes`: change seed, size and world several times within a few frames, including during creation and during the burn-in; at the end exactly one simulator exists (debug hook counts live creates minus destroys), the step counter belongs to the final settings, and no console error appears.
25. `controls explain themselves and restart`: every radio and select group has visible description text; changing the seed resets the step to 0.
26. `isolate a layer`: the combined view equals the tile for layer z.
27. `axe`: no serious or critical findings at 1280 and 375 wide in day and night (`@axe-core/playwright`, as `public-a11y.spec.ts`), no horizontal page scroll at 375, and a keyboard-only pass at 375 (Tab reaches every control in a sensible order, Space/Enter operate play, step, radios and the layer slider, focus is visible, each control has its explanation linked by `aria-describedby`). The three type colours are checked under protanopia, deuteranopia and tritanopia simulations (matrix transforms in the test) for a minimum pairwise distance, and looked at in EVIDENCE.md.
28. `no WebGPU path`: with `navigator.gpu` removed before load the page shows the plain message (no uncaught error).
29. `frame pacing` (not an assertion): for 128 x 128 x 4 cyclic, 256 x 256 x 4 cyclic and 256 x 256 x 8 ecology, report steps per second, readback ms and draw ms from the page's status line over 5 seconds at each pace; printed for EVIDENCE.md. 256 x 256 x 4 is supported (the spike ran it at about 340 steps/s).
30. `screenshots`: 1280 and 375 for both worlds. Cyclic: taken after the hand-over with the kill on for at least 500 steps (about step 6,500 or more; the status line is in the shot), plus one of the burn-in phase near step 600 to show the kill-off world. Ecology: after at least 2,000 steps, and a later one if the pace allows. Into `docs/.../slab-viewer/shots/`.

## Acceptance gates (runnable; Node 24 on PATH: `export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH`)

```
cd /Users/nicholas/develop/browser-life-viz-slab-viewer
G1  pnpm typecheck
G2  pnpm vitest run apps/lab/test/slab-render.test.ts apps/lab/test/slab-worlds.test.ts tools/test/slab-packaging.test.ts
G3  BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts
G3b pnpm build && BL_REQUIRE_BUILD_CHECK=1 BL_E2E_PORT=5266 npx playwright test tests/e2e/public-not-found.spec.ts tests/e2e/public-routes.spec.ts   # a fresh default build is required (the specs may otherwise skip); suites guarding the Caddyfile, routes, robots and sitemap; also request the private bundle URLs and expect 404 or absence
    pnpm vitest run tools/test/site-build.test.ts apps/lab/test/social-meta.test.ts
G4  # pinned files untouched
    BASE=7bb61be2014621b020968e6b60b8246b33990e04
    test -z "$(git diff --name-only $BASE -- experiments packages ':!experiments/3d-rps/results' ; git status --porcelain -- experiments packages)" && echo clean   # fails on committed or uncommitted change against the fixed base
    test "$(cd experiments/3d-rps/gate0-spike && git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)" = "$(head -1 experiments/3d-rps/gate0-spike.sha256 | cut -d' ' -f1)" && echo spike-hash-ok   # 761ea02a...140cc7
    git diff --name-only $BASE | sort   # must list only the files named under Files / Edited, plus the slice docs
    pnpm vitest run experiments/test/rps-gate0-spike.test.ts packages/sim-ref/test/golden-hashes.test.ts
G5  pnpm typecheck:rps
G6  EVIDENCE.md has frame pacing at 128 x 128 x 4 and 256 x 256 x 4, ecology at 256 x 256 x 8, and the screenshots per world (1280 and 375; cyclic with the kill on), each read and described honestly.
G7  Codex review: codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s read-only -C /Users/nicholas/develop/browser-life-viz-slab-viewer -o <final-message-file> - < <prompt file> > <log file> 2>&1  (REVIEW.md records findings and what was done).
```

Load note: if a load-sensitive test (the 5,000-step reproduction, the packaging build) times out, rerun it alone or with `--maxWorkers=2` and say so in EVIDENCE.md; limits are not changed. The source plan requires `pnpm test`, so it stays a gate: run `pnpm test` once, list every failure, rerun each failing file alone, and classify it. A failure counts as pre-existing only if it is in a file this slice did not touch, does not import any slab file, and its cause text names data or environment (such as missing `runs/` data or a missing tool). The failing list and classification go in EVIDENCE.md; any new failure in touched or slab-related files blocks. `pnpm vitest run apps/lab` is also run.

## How to try it

```
cd /Users/nicholas/develop/browser-life-viz-slab-viewer
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
node node_modules/vite/bin/vite.js apps/lab --port 5265 --strictPort
# then open in Chrome (WebGPU on, version recent enough for it):
#   http://localhost:5265/slab/
```

Press Play. Cyclic competition starts with 6,000 steps with the kill off (about 20 s at the fastest pace on 256 x 256 x 4; the page then says "kill on"), then the kill turns on; watch the combined view for domains and fronts. Switch to Slab ecology to watch a carpet grow layer by layer (the fastest pace reaches the recorded 50,000-step state in five minutes or more). Playwright run: `BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts` (headless Chrome, its own server).

## Explicit non-goals and limits

- No GPU render pass (rung B), no volume renderer, no twin-difference view, no new WGSL, no change to any simulator, rule, config key or pin. Those are the plan's optional extras and are out of this slice.
- Not evidence. The page defaults to a recorded seed and setting, is labelled exploration, writes nothing under `experiments/` or `docs/creative-prototypes/`, and makes no claim that either world passed a gate. The 3D line stays closed at rung 1b; this viewer is for looking, not reopening it.
- No hash match to a recorded run is claimed except where gate 23 checks one number. Cyclic reproduction of a Gate-0 job would need its census files, which are not in this worktree.
- The cyclic pinned test runs the stock slab rules on the CPU reference, not the patched kill, because the kill exists only in the spike's shader text. The kill's picture is checked by eye and by the e2e on the real GPU, not by a bit-for-bit pin.
- Dynamics at 128 x 128 sizes are not the recorded ones; the page says so. Only one simulator is alive at a time.
- Chrome with WebGPU only. Firefox and WebKit are not targeted (the spec runs the Chrome project; `BL_ALL_ENGINES` is not used).
- The page is private by routing and `noindex`, not by authentication; on a deploy it is removed from the site image and answered 404 by Caddy. Nothing deploys in this slice.
- Local branch only: no hosted CI, no push, no PR, no commit by the builder (the coordinator commits).
