# I03 first rung: implementation evidence (2026-11-01)

Branch `claude/i03-historical-opponents` from `origin/main` 67fdd025. Uncommitted. CPU only (sim-ref), no GPU evidence, not the M3 environment.

**Status: exploratory.** The plan required committing calibration before the first evidence write. Nothing was committed, and the evidence was generated several times, so no history shows the thresholds were frozen before outcomes (a provenance gap, not proof of tuning). After the Sol source review the gate rules and the invasion readout were corrected with the earlier outcomes known; the saved runs are the same ones, the aggregation changed. The verdict below is therefore an exploratory result, not a confirmatory one. A confirmatory claim needs the corrected protocol committed first and fresh seeds.

## Result

`evidence.json` verdict: **assay-sensitive**, defined as: detects the constructed weakening at this effect size and stays quiet for identical genomes at this resolution, on genetically separated founders in small CPU arenas. It does not assert discrimination between real strategies. Seal `85fe724c...dbdef`: the payload was rebuilt from the saved raw runs after the review fixes (the simulation was not changed), and `--replay-check` then regenerated it from scratch byte for byte (see Commands). The earlier seal `9f43b866...7aef` described the same runs before the fixes and is retired.

Gates (all pass): G1a exact label invariance; G1b twin position effect (10 seeds, mean size 0.066 < target 0.075, sign-flip p = 0.68; per-seed effects range -0.11..+0.20). This gate is low power: ten blocks cannot show absence of bias, and the 0.075 target was fitted on three other seeds with a calibration margin of 0.0752 against 0.0755. Read the pass as "no bias seen at this resolution"; G2 W loses to G in all 10 blocks, W mean share 0.347, W alive alone; G3 no both-floor runs in any pair or arm, and every enabled start (even, rare-A, rare-B) of every pair keeps at least five sixths (rare) or four fifths (even) of its blocks complete (the completeness check on rare arms was added after review; it was previously absent); G4 in-world depletion arena (dark, kBDecay 600, kELeak 1000) both sides at floor in all 20 runs, status uninformative, naive reading is a 0.50 tie; G5 fixtures.

Real panel (G, three farthest-point M3 founders F1..F3, W): confirmed edges G>F3, G>W (G vs F1 is even, 0.477), F1>F2, F1>F3, F1>W. Cycles: none detected at this resolution (the detector finds the constructed A>B>C>A fixture only). Mean payoff against the rest: F1 0.647, G 0.621, F2 0.483, W 0.403, F3 0.346. F3 is lowest and W second lowest, with no confirmed edge between them (F3|W is 0.486 head to head); F1 and G are 0.026 apart and G vs F1 is not a confirmed edge. Edges are strict (all 10 blocks one side, p <= 0.005, gap >= 0.05).

## Findings worth stating

- Exploratory rare-start (1 disc vs 3): the rare label loses share in nearly every pair, including the identical-genome control (-0.16 mean, all 6 seeds). A lone disc is disadvantaged by arrangement alone, so the raw classes are marked `interpretable: false` (baseline `twin`) in evidence.json and are not failures to invade. The payload now also stores a twin-adjusted class per pair and arm (raw excess minus the twin pair's excess for the same seed). Adjusted, 13 of 20 arms read "invades", 7 "unclear" and none "fails". Treat that as a sign the correction is imperfect rather than as 13 invasions: the baseline is six seeds of one genome, and an arrangement penalty measured on G need not carry over to every other genotype. Not gated, exploratory.
- Vigour residual (descriptive): residuals are within about +/-0.09 of solo-growth predictions; the largest is F1 vs F3 (+0.089). No causal separation claimed.
- Calibration: first attainable setting in cost order was attempt 11 (tile 32, R 3, T 300, weaken 50%); the twin target was met on 3 calibration seeds by a thin margin (0.0752 vs 0.0755). All 11 attempts and 3 depletion candidates are in `calibration.json`.

## Step 0 spike (plan 3.0): discovery.ts

`packages/runner/src/discovery.ts` was read for fixture vocabulary only. Its runner is not reused: it has no per-lineage payoff observer (adding one is a shared runner/schema change) and writes a checkpoint artifact per case, heavy for ~724 throwaway contests. Contest worlds are expressed as founder specs with genome hex so a later rung can port them. Plan unchanged.

## Cost

724 runs (484 contests, 220 solo, 20 depletion), 300 steps, 32x32. About 1290 CPU-seconds. On a heavily loaded machine (load average 25-80, 8 workers) `--write` took 219 s and 396 s, `--replay-check` 466 s; the "under about 5 minutes" budget is met only on an unloaded machine (about 160 s ideal on 8 cores). Not qualified under load. Cuts per plan 3.7 if needed: rare arms to one position and fewer seeds first.

## Commands and results

- `pnpm typecheck`: pass.
- `pnpm vitest run packages/metrics/test/opponents.test.ts apps/lab/test/opponents-render.test.ts tools/test/opponents-evidence.test.ts apps/lab/test/opponents-packaging.test.ts`: 4 files, 65 tests pass.
- `node tools/opponents/assay.ts --check`: ok (now also rebuilds each run's step-zero world and the panel, constants and schedule). `--replay-check --jobs 8` after the first review fixes: ok (10:45 wall at load average about 180). Rerun after the follow-up fixes: ok (6:46 wall under load).
- `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts experiments/test/prereg-sync.test.ts`: 41 pass.
- `git diff --stat HEAD -- packages/sim-ref packages/sim-gpu packages/schema experiments`: empty.
- Browser (vite dev, playwright): /opponents/ at 1280 and 375 px, no console errors, no horizontal overflow at 375, rare toggle works. One double-escaping bug found and fixed.

## Left undone

Nothing committed. Publication needs D7 (rebase on origin/main, rerun focused tests and `--check`, `--write --force` if a hashed source changed) and the Codex Sol xhigh source review. Calibration commit should precede evidence in history. D12 text still unverified.
