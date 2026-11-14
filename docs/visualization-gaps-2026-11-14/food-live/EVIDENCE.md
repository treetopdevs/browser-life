# food-live evidence

Run on 2026-11-14 in `/Users/nicholas/develop/browser-life-viz-food-live`, Node 24.2.0 (nvm), Chrome via Playwright. Page: `http://localhost:5267/food-bands/` (dev), e2e on port 5268. Exploration page, not evidence for any screen's result.

## What was built

- `apps/lab/src/food-bands/screens.ts`: 10 screens read from the 18 `tools/<dir>/explore.ts` files (the plan's 11 was a scan; `food-floor-replication` has the same arms and seed as `food-band-foothold-replication`, so it is an alias inside the foothold screen, both recordings accepted).
- `models.ts` (loaders, `PARITY` table, resolution rule), `targets.ts` (eligible area and last-pulse slot tiles from each model's own helpers), `render.ts`, `page.ts`, `replay-check.ts`, `style.css`, `apps/lab/food-bands/index.html`.
- Dev-only replay route in `apps/lab/vite.config.ts` (`apply: "serve"`, allowlist = file names in the screens table).
- Private-page checklist: vite input `foodBands`, Dockerfile.site rm paths, Caddy `@private_food_bands`, `DIAGNOSTIC` in `tests/e2e/public-routes.spec.ts`, packaging test with a real `vite build`.

## Step 1: screens read from the code

| screen | arms | seeds (primary, replication) | horizon | own model |
|---|---|---|---|---|
| uniform-food | uniform | 1201, 1202 1203 | 6,000 | hungry-shapes |
| uniform-endurance | uniform | 1201, 1202 1203 | 9,000 | uniform-endurance |
| moving-food | uniform, moving-band | 1201, 1202 1203 | 3,000 | moving-food |
| stationary-food | moving-band, stationary-band | 1202, 1201 1203 | 3,000 | stationary-food |
| food-band-longevity | moving-band, stationary-band | 1201, 1202 1203 | 6,000 | stationary-food |
| split-food | stationary-band, split-band | 1202, 1203 | 3,000 | split-food |
| alternating-food | split-band, alternating-band | 1203, 1202 | 3,000 | alternating-food |
| food-band-foothold (+ food-floor-replication alias) | alternating-band, foothold-band | 1202, 1203 | 3,000 | food-band-foothold |
| food-floor-longevity | foothold-band | 1203, 1202 | 6,000 | food-band-foothold |
| food-schedule-769 | schedule-769 (+ optional foothold-band) | 1202 | 6,000 | food-schedule-769 |

`food-bands-screens.test.ts` parses seeds, modes and `MAX_TICK` out of all 18 explore.ts files and fails on drift; it also asserts the SHA-256 of every `apps/lab/src/*/model.ts` the page can load equals the digest the explore tools pin.

## Step 2: parity (newest model vs each screen's own model)

Predicate `dynamics` = census, food-byte digest, digest of bodies (id, parent, family, generation, age, energy, genome, cell tiles) and environment counters, at ticks 0, 500 and the screen's final tick, for every arm and every seed of the screen. `observation` = also equal RULES and equal full snapshot ignoring only the `runtime` label.

| screen | dynamics | observation | differing RULES | page loads |
|---|---|---|---|---|
| uniform-food | true | false | maxHistory 301 (own) / 451 (newest) | hungry-shapes (always) |
| all 9 others | true | true | none | food-schedule-769 (newest) |

Cases: 9 to 18 per screen; no dynamics difference anywhere. Wall time of the full-horizon file (`food-bands-parity-full.test.ts`, final ticks 3,000, 6,000, 9,000): about 5 seconds in total, so it is always on; `food-bands-parity.test.ts` is the 0, 500, 1000 version. Negative control (one food byte changed) fails the predicate. The fallback to a screen's own model by dynamic import exists and is tested by rule, but no screen currently needs it.

## Step 4: live equals recorded

`checkReplay` replays the card's world from tick 0 through the page's own `loadModel(resolveModelKey(screen))` path and compares every per-tick row, the census and environment at every 20 ticks, the frame projection (food bytes, cells, bodies, ledger) at every recorded frame, and, at saved snapshot ticks, the full snapshot ignoring only the runtime label; it also checks the recording hashes to its own `stateSha256`. It fails closed (invalid or partial, never identical) on empty, truncated, mislabelled or wrong-rules input.

Result with all 73 replays restored: 41 screen/arm/seed checks over 34 distinct recording files (seven files serve more than one screen) were run (every arm, every seed, `food-bands-replay-check.test.ts`): 40 identical over the full horizon, 1 partial (`food-band-foothold-seed-1202.json`, a 3,000-tick recording beside the 6,000-tick schedule-769 screen: matched all 3,000 ticks it covers, reported as partial). That covers at least one arm of every one of the 10 screens, and in fact every arm and every seed. The same check runs in the browser (below).

Browser, real dev server over HTTP, no route fulfilment (`tests/e2e/food-bands.spec.ts`): uniform-food, moving-food, alternating-food, food-band-foothold and food-schedule-769 press "Compare with the recorded run", get "identical at all N recorded ticks" for every arm, and "the picture on screen matches the recorded frame" for the displayed worlds. The integration test in vitest starts a real Vite dev server, fetches a restored recording over HTTP, confirms files outside the allowlist (`current-pilot.json`), POST and path tricks are refused, and the fetched bytes check identical.

## Screenshots (read)

Scratch dir `/private/tmp/claude-501/-Users-nicholas-develop-browser-life/e28381b7-b46a-475c-85b9-2de9973e0770/scratchpad/food-live/shots/` (`<screen>-<width>.png` page, `<screen>-<width>-worlds.png` worlds only; six screens at 1280 and 375, mid-run).

- `alternating-food-1280-worlds.png` (tick 620, pulse 126): left card two fixed 24-column bands outlined in green with gold squares scattered over both; right card has the left band dashed grey (not favoured now) and the right band solid green and densely gold, readout "pulse 126, favoured band 1 (right)". That is the post-switch state (band 1 from pulse 100).
- `food-schedule-769-1280-worlds.png` (tick 1200, optional earlier schedule on): both cards show the favoured left band dense gold and the right band dashed yellow with sparse gold (the floor); readout "floor in both bands, favoured band 0 (left)". Bodies in three family colours; population strips drawn.
- `moving-food-375.png` (phone, tick 719): single column, canvases fit, legend wraps, left world gold dots over the whole map, right world a green-outlined 48-column band at columns 14 to 61 with dense gold, readout "band columns 14 to 61" (no wrap note, since nothing wraps).
- `uniform-food-375-worlds.png`: one card, no outline, gold dots everywhere, readout "food offered anywhere on the map".
- Also taken, not individually read: split-food, food-band-foothold at both widths, 769 and others at 375.
- The first look at the page (before fixes) showed the other-seed warning visible without choosing it (a `hidden` attribute overridden by CSS) and a 16 px horizontal overflow at 375 from the pace select; both fixed, and the e2e checks them.

## Tests and gates (final run)

| gate | command | result |
|---|---|---|
| 1 | `pnpm typecheck` | clean |
| 2 + 3 | `pnpm vitest run apps/lab/test/food-bands-{screens,parity,render,replay-check,packaging,parity-full}.test.ts apps/lab/test/hungry-shapes-packaging.test.ts tools/test/deployment-config.test.ts` | 8 files, 177 tests passed |
| 4 | `BL_FOOD_SHOTS=<scratch>/shots BL_E2E_PORT=5268 npx playwright test tests/e2e/food-bands.spec.ts tests/e2e/public-routes.spec.ts` | 40 passed, 1 skipped (public-routes build check, no dist) |
| 5 | `pnpm test` (machine load average about 30) | 5,229 passed, 13 failed in 7 files. 6 are the known `food-band-foothold-replication` pin failures. 1 was mine: `prototypes-status.test.ts` inventory (fixed by adding `/food-bands/` to its `postFreeze` set, the way `/opponents/archive/` is). The other 6 were load timeouts (`execution.test.ts`, `shape.test.ts` x2, `hunt1-ops.test.ts`, `locality-power-evidence.test.ts`, `prediction-confirm.test.ts`); rerun alone with `--maxWorkers=2`: 6 files, 279 tests passed. |
| 6 | `pnpm build`, apply the Dockerfile.site `rm -rf` line, `find apps/lab/dist -iname '*food-bands*' -o -iname 'foodBands*'`, `grep -rli 'food-bands\|foodBands' apps/lab/dist` | built page, `foodBands-*.js/css` and 7 `food-bands-model-*.js` chunks exist before the rm line; both finds empty after it. The packaging test does the same on a scratch build plus a reference walk (and caught an early draft in which a manual `food-bands-page` chunk was imported by public pages; that chunk rule was dropped). `apps/lab/dist` removed afterwards. |
| 7 | `git diff --name-only`, `git diff --cached --name-only`, `git status --short` | no change to any `model.ts`, `hungry-shapes/page.ts`, `tools/*/explore.ts`, `package.json`, `deno.lock`; nothing staged; no replay JSON, mp4 or tar.gz listed (shared exclude) |
| 9 | Codex Sol 6.1 xhigh, read-only | see REVIEW.md |

Responsiveness: the e2e long-task observer saw no long task (count 0) during a paired 3,000-tick run at maximum pace; stepping is sliced to 8 ms per frame, the replay check to 100 ticks per slice. No worker was needed.

## Files to stage (explicit paths) and final fix-stage checks

Follow-up Sol 6.1 xhigh review of the fixes: `review-sol-fixes.txt`, no P1/P2 found.

```
Dockerfile.site
apps/lab/vite.config.ts
deploy/Caddyfile
tests/e2e/public-routes.spec.ts
tools/test/prototypes-status.test.ts
tests/e2e/food-bands.spec.ts
apps/lab/food-bands/index.html
apps/lab/src/food-bands/
apps/lab/test/food-bands-packaging.test.ts
apps/lab/test/food-bands-parity-full.test.ts
apps/lab/test/food-bands-parity.test.ts
apps/lab/test/food-bands-render.test.ts
apps/lab/test/food-bands-replay-check.test.ts
apps/lab/test/food-bands-screens.test.ts
apps/lab/test/support/food-bands-parity-lib.ts
docs/visualization-gaps-2026-11-14/food-live/
```

`git status --short -uall` lists only these paths (plus nothing else untracked); no replay JSON, mp4 or tar.gz appears, and docs/visualization-gaps-2026-11-14/ holds only the `food-live/` folder.
