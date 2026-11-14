# slab-viewer: evidence (2026-11-14)

Page: `http://localhost:5265/slab/` (dev: `node node_modules/vite/bin/vite.js apps/lab --port 5265 --strictPort`). Private, noindex, not in the site build. Exploration, not a result.

## Commands and results (Node 24 on PATH)

| gate | command | result |
|---|---|---|
| G1 | `pnpm typecheck` | pass |
| G5 | `pnpm typecheck:rps` | pass |
| G2 | `pnpm vitest run apps/lab/test/slab-render.test.ts apps/lab/test/slab-worlds.test.ts tools/test/slab-packaging.test.ts` | 3 files, 22 tests pass (packaging includes two real builds and a Caddy 404 check; caddy is installed) |
| G3 | `BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts --workers=1` (run in groups) | all 19 tests pass: cyclic canvases/census, raw-snapshot oracle (cyclic 4x80 and ecology 8x60 sampled cells), play/pause, ecology 8 tiles, recorded living fractions 0.0419 at step 5,000 and 0.5426 at 10,000 (page census equals `readStats().living`), hand-over exactly at 6,000 with labels equal to an independent direct spike run at 6,200 and at a 400-step pace that straddles 6,000, rapid changes (one simulator, no console error), controls explained, seed restarts at 0, layer isolate, axe (1280/375, light/dark, no serious/critical, no horizontal scroll), keyboard pass at 375, no-WebGPU message, pacing, screenshots |
| G4 | pinned-file checks | `experiments/` and `packages/` unchanged against 7bb61be2; spike hash validates (`spike-hash-ok`) |

Gate results for G3b, `pnpm vitest run apps/lab` and `pnpm test` are in the section "Late gates" below.

Deviations: the e2e is serial (`--workers=1`) because every test owns the one GPU. A first run of the hand-over test and the pacing test failed on my own test bugs (a radio regex that matched the kill descriptions, a no-op restart click); fixed in the spec, no limits changed. The Codex xhigh review (G7) was not run in this stage.

## Frame pacing (headless Chrome, Apple GPU via Metal, machine under other load)

Steps per second over 5 s of Play; draw and readback ms are the page status line. Readback ms includes waiting for the GPU to finish the queued steps, so it is large at the Fastest pace; the draw cost is the 2D painting.

| world and size | Steady (20/frame) | Fastest (400/frame) | draw |
|---|---|---|---|
| cyclic 128x128x4 | 995 steps/s | 1,519 steps/s | 2 to 3 ms |
| cyclic 256x256x4 | 300 steps/s | 400 steps/s | 10 ms |
| ecology 256x256x8 | 232 steps/s | 240 steps/s | 15 ms (32 ms at a full carpet) |

(Spike without drawing: about 340 steps/s for cyclic 256, 280 for the ecology.) The reproduction run reached step 10,000 of the ecology in 36 s.

## Screenshots (docs/visualization-gaps-2026-11-14/slab-viewer/shots/, 1280 and 375 wide, full page)

All were taken by `tests/e2e/slab.spec.ts` ("screenshots") and read.

- `cyclic-kill-on-*.png` (step 6,800, kill on, default recorded setting g2-confirm-V-sp8-r64-s401): three colours in irregular blobs and ragged patches of a few dozen cells, no spirals and no regular fronts at this step. The layers differ: the surface (0.1 % empty) and floor (0.0 %) are full while layers 1 and 2 are speckled with dark empty cells (13 % and 18 %), so the kill is visibly emptying the middle layers. Census at the shot: type 1 28.1 %, type 2 27.2 %, type 3 37.0 %, empty 7.8 %. The combined view looks like a smoothed version of the tiles. At 375 wide everything stacks in one column, tiles two per row, no horizontal scroll.
- `cyclic-kill-on-later-*.png` (step 12,000) and `cyclic-burnin-step600-*.png` (kill off) are the same kind of picture: domains and blobs; I do not see spiral waves in either.
- `eco-step2500-*.png`: nearly black; 1.6 % of cells living, a few isolated coloured dots per layer (the eight small balls growing). Honest picture: almost nothing to see.
- `eco-step15000-*.png`: every layer 100 % living, a carpet of lineage colours (purple, teal, olive, magenta) with a large teal domain in the middle; the eight layers look almost the same, with slightly different edges. It matches the recorded 100 % at step 15,000 of M4 run mu40-s20-k1024-seed101.
- The full-page captures show the sticky header floating over the intro in the 1280 ecology shot; that is a screenshot artefact of stitching a scrolled page, not a layout bug in the live page.

Colour: the three types (yellow, sky blue, vermillion) stay more than 60 RGB units apart under protanopia, deuteranopia and tritanopia simulations (unit test).

## What is honest to say

The viewer works end to end with the real kernels in Chrome. The cyclic world shows blobby three-colour domains and layers that differ under the vacancy kill; no spirals were seen at the steps captured. The ecology starts almost empty and becomes a uniform carpet by step 15,000. Neither is a result.

## Late gates

- G3b: `pnpm build`, then `BL_REQUIRE_BUILD_CHECK=1 BL_E2E_PORT=5266 npx playwright test tests/e2e/public-not-found.spec.ts tests/e2e/public-routes.spec.ts --workers=1`: 15 passed. `pnpm vitest run tools/test/site-build.test.ts apps/lab/test/social-meta.test.ts`: 29 passed. `pnpm vitest run experiments/test/rps-gate0-spike.test.ts packages/sim-ref/test/golden-hashes.test.ts`: 126 passed, 5 skipped.
- `pnpm vitest run apps/lab`: 18 files, 381 tests pass.
- `pnpm test` (full, under heavy machine load): 173 files passed, 3 failed with 5 tests, all timeouts under load: `packages/sim-ref/test/shape.test.ts` (175 s), `tools/test/hunt1-ops.test.ts` (3 supervise/watchdog shell tests), `apps/lab/test/execution.test.ts` (84 s; it passed in the separate `apps/lab` run). None imports a slab file and this slice touched none of them. Rerun alone with `--maxWorkers=2`: shape.test.ts and hunt1-ops.test.ts pass (170 tests); execution.test.ts passes in the apps/lab run above. No limits changed.

## Source-review fix pass (2026-11-14)

Re-run after the fixes, Node 24, this worktree:

| check | result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm vitest run apps/lab/test/slab-render.test.ts apps/lab/test/slab-worlds.test.ts experiments/test/rps-gate0-spike.test.ts tools/test/slab-packaging.test.ts apps/lab/test/social-meta.test.ts` | 5 files, 135 tests pass (Caddy installed: the served-404 test ran with the raw-socket spellings; `rps-gate0-spike.test.ts` validates the spike hash sidecar) |
| `BL_E2E_PORT=5266 npx playwright test tests/e2e/slab.spec.ts --workers=1`, whole spec, before the follow-up-review fixes | 22 passed (4.4 min) |
| after the follow-up-review fixes (page.ts and spec changed): typecheck, then the stale-frame, run-to, kill-on-from-0, oracle, hand-over, arrow-key, clamp, seed, rapid-change, keyboard, controls and isolate tests | 12 passed; the whole spec was not re-run after these last edits (axe, pacing, play, ecology 5,000/10,000 and screenshots are unaffected by them and passed in the whole-spec run) |
| mutation checks | guard removed in `current()`, `last = null` removed from `restart()`, unguarded `runTo`: each fails its test; restored: pass |
| pinned files | `git status` shows no change under `packages/`, `experiments/` or `tools/` other than the new `tools/test/slab-packaging.test.ts`; no `model.ts` or `explore.ts` touched |

The whole-spec run happened with other jobs on the machine, so its pacing lines (cyclic 128: 624 and 1,119 steps/s; cyclic 256: 236 and 240; ecology: 172 and 240 at Steady and Fastest) are lower than the table above, which stays the recorded measurement. That run wrote its screenshots to the Playwright output folder, not to `shots/`: the ten PNGs under `shots/` are the earlier recorded set and were not regenerated (`BL_RECORD_EVIDENCE=1` is needed to replace them).

## Files for the coordinator to stage (explicit paths)

```
Dockerfile.site
apps/lab/vite.config.ts
apps/lab/test/social-meta.test.ts
deploy/Caddyfile
apps/lab/slab/index.html
apps/lab/src/slab/page.ts
apps/lab/src/slab/render.ts
apps/lab/src/slab/settings.ts
apps/lab/src/slab/style.css
apps/lab/src/slab/worlds.ts
apps/lab/test/slab-render.test.ts
apps/lab/test/slab-worlds.test.ts
tests/e2e/slab.spec.ts
tools/test/slab-packaging.test.ts
docs/visualization-gaps-2026-11-14/slab-viewer/
```

The last path is the slice folder only (PLAN.md, REVIEW.md, EVIDENCE.md, the three review text files and ten PNGs under `shots/`, about 7 MB in all). `git status --short --untracked-files=all` over those paths lists no `.mp4`, `.tar.gz`, `.json` replay, `archive-assets` or `creative-prototypes` path, and nothing under `test-results/` (git-ignored). Do not stage the parent folder `docs/visualization-gaps-2026-11-14/` wholesale on other branches: its top-level PLAN.md belongs to another PR.
