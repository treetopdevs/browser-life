# I08 moving light: first rung, result

Branch `claude/i08-moving-light` from `origin/main` c4b16ccd. Freeze commit ea254699 (pushed before the run; contains no outcome file). Post-review amendments (PLAN.md, last section): library, tool, calibration.json and lock were revised in the FIX stage (uncommitted); the fresh blocks, decisions and verdict regenerate identical to the first run, seal below is the regenerated one. Exploratory, CPU only (sim-ref), mutation off, no physics change.

## Headline

**Label: `unsupported-measurement`.** Not "no benefit". The replicate-noise floor of the capture contrast on dev (engine seed only, patches cloned) is delta_cap = 1,429,742 ppm of the audited input energy on the fixed schedule (398,139 paused, 2,592,988 wandering, 2,222,461 reversed), above the frozen 500,000 ppm sensitivity bound (REVIEW.md, deviation 1: a rule added after seeing dev floors, frozen before any fresh seed was read). The sensor did track the sun on dev (sense tracks: true), so the failure is noise, not an inert sensor. The fresh blocks (8700501-8700508) were still run once and are reported in full.

## What the fresh blocks show (descriptive, not a verdict)

- Fixed: S positive 5/8, B (against the silent twin) 6/8, B_drift 4/8; bootstrap lower bound of 2*median B = -19,960 ppm; residual coordination above the floor in 1/8 blocks.
- Wandering: S 7/8, B 8/8 (lower bound +754,584 on 2*median), B_drift 4/8, median B_drift negative. Reversed (post-turn window): S 7/8, B 8/8, B_drift 3/8.
- Paused control: B positive 3/8, median B strongly negative; S positive 8/8 (grouping alone helps in a static sun).
- sense-nosig is dynamically the same arm as still (identical readouts in 40/40 dev and noise runs), so B is the contrast against a non-moving arm, and the blind drifter comparator does not agree with it.
- Signal-difference proxy 958,904 ppm for the dispersed geometry (flagged): this is (all - solo) / all in a probe disc, a counterfactual difference that also contains competition, movement and emission effects. It is not a foreign or owned fraction of the signal and no ownership percentage is claimed (an earlier draft of this file read it as 95.9 percent foreign; withdrawn). The 24 x 16 tile is effectively one signal field; the claim stays "dispersed".

## Fixtures

Naive "bodies move together" reads collective motion in the common-forcing (fixed, wandering), label-takeover, null-world and tracking-asymmetry synthetic fixtures (80-100 percent of pairs agree); the residual control rejects all of them. After the review the synthetic noise is independent per placement, so the synthetic floor is a real sampling floor (45,958 milli-Q^2 for both schedules, from the replicate-noise seeds) and the null world is exactly zero. coupled-synthetic now has a neighbour-dependent update (grouped only) and is detected 8/8; zero coupling is rejected; perturbing one body moves the others in the grouped placement only. The fixtures can fail: per arm under the wandering sun, common forcing leaves a statistic below the floor with the sun subtracted and far above it without; tracking-asymmetry (dispersed bodies follow half the sun) is rejected with the subtraction and reads as coordination without it. Honest limit: grouped-minus-dispersed cancels common forcing that reaches both placements equally whether or not the sun is subtracted, so the discriminating tests use the per-arm statistic and the asymmetric-gain fixture; the opposite asymmetry (grouped lags more) would read as coordination and is bounded only by the still and sense-nomot residual controls. static-sun is unavailable, not zero. planted-benefit gives `supported` through the full decision, the same table with the benefit planted in paused too gives `inconclusive-confounded`, planted-nothing gives `unsupported-within-tested-domain`. Physical fixtures (blind-drifters, crowding, stationary-growth) are rejected, the first two by identity of comparators (stated); stationary-growth now needs six available residuals inside the floor (all eight are). `--check` validates the whole inventory against a frozen expected-outcome table, recomputes every synthetic and planted fixture and re-judges the physical ones from their stored series; `--replay-check` also regenerates the first two physical-fixture seeds.

## Commands and results (run in this worktree, node 24 via nvm)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `node tools/movinglight/movinglight.ts --bench` | 1.54 ms/step; projected --write ~290 s with two processes (target 600 s) |
| `--calibrate` | 155 s (first run), 204 s (FIX-stage rerun under load); floors above, dev and noise blocks identical on rerun (only the signal-difference field name and method text differ) |
| `--freeze`, commit ea254699, `git push -u origin claude/i08-moving-light` | ok, 24 files, no evidence.json or manifest.json |
| `--write` | 287 s (first run), 358 s (FIX-stage rerun, within 600 s), seal a39625896b6981c11e5361527b1b59c2c7e9ec4648138787d12e58e6f2663b70 (first run: 6be4866876498abe1b7d39bc97558d26f3cc03f209d818eb368b89a3f9f8c9b8, superseded by the fixture and label revisions; fresh blocks identical) |
| `--check` | ok (FIX-stage rerun, after `--freeze --force` and `--write`) |
| `--replay-check` | ok, 73 s (target 120 s; includes the two-seed physical-fixture replay) |
| `pnpm typecheck` | pass (FIX stage) |
| vitest: movinglight runner tests (7 files) + render test | 58 passed (FIX stage; new tests for completeness, placement noise, coupling, subtraction, judgePhysical, illumination, rendering) |
| vitest: tools/test/movinglight-evidence + apps/lab moving-light tests (+ hunt1-ops rerun alone) | 4 files, 173 passed (includes --replay-check and the vite build packaging test) |
| `pnpm test -- --maxWorkers=2` (full, FIX stage) | 254 files passed, 11 skipped, 4,613 tests passed, 0 failed (the earlier 4 niche-evidence failures are resolved, see below; hunt1-ops passed this time) |
| vitest: golden-hashes + packages/schema/test | 16 files, 233 passed; `git diff` shows no change under packages/schema, sim-ref, sim-gpu |
| Page in Chrome (playwright) at 1280 and 375 px | renders, no console errors, no horizontal overflow at 375; Reveal toggles names, schedule select and time cursor change the strips |

## Limits, gaps, left undone

See `evidence.json` limits and gaps (G1 no westward rotation, G2 no live sun reversal on a displayed world, G3 rotation plus wander dropped, G4 no no-turn continuation) and REVIEW.md. Follow-up Codex review of the FIX-stage fixes: `review-sol-fixes.txt` (no P1/P2). Left undone: the final commit and PR, a matched-illumination geometry and the controlled emitter probe (next rung), and a decision on a sharper geometry (new fresh seeds needed, since 8700501-8700508 are consumed).

## Registry conflict with I06 (resolved)

The seed reservation edits `experiments/discovery/seed-registry.json`, and I06 bound that file's whole-file digest. Resolved without touching I06's outcome files: `tools/niche/niche.ts` `registryDigest` now ignores `i08 moving light` reservation lines (the digest is of the registry as I06 froze it, b512b2e2...), `seedCollisions` still runs against the live registry, and I06's manifest source hash for `tools/niche/niche.ts` was re-pinned (tool-only change, the precedent of I06's own review commit). I08's digest is now reservation-scoped (only its own reservations), so a later slice's reservation does not invalidate it. `tools/test/niche-evidence.test.ts` passes (9 of 9).
