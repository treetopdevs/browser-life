# I01 behaviour atlas, slice 2: held-out panel, calibration and the comparison CLI

**1 November 2026 · exploratory engineering.** Follows slice 1 (`PLAN.md`, `REVIEW.md`; commit
`42cad5d`). The user asked for the next step with reasonable choices; the choices below close the
open decisions slice 1 left, on the smallest footing that lets a first comparison run. Local GPU
only; no cloud, no model calls.

## Decisions taken

1. **Held-out panel v1** (`packages/search/src/panel.ts`, `atlas-panel-v1`). Two pass/fail tests,
   none reading a quantity any arm selects on (`assertSeparated` passes against all four arms):
   - `sweep-survival`: every replicate alive under a moving sun (`lightMode: "sweep"`, base 20,
     amplitude 220, day 1,024 steps; otherwise the screening protocol).
   - `lean-survival`: every replicate alive on half the screening nutrient (16).
   Why these: transfer to unseen environments is what neither archive selects for, and each is
   measured by the existing evaluator without new code. Not chosen: a different wound geometry or
   dark hold (they re-measure selected quantities, which would favour the mass-speed arm by
   construction), and reproduction. A reproduction test was drafted and then dropped in review:
   `Evaluation.reproduction` counts tracker births, which include a body moving too fast to
   overlap its predecessor, so it would partly re-measure the motion the atlas selects on.
2. **Assays are named by protocol, not by seed split.** A fresh-seed run of the screening protocol
   is still `screen`, so re-measuring a selected quantity on new seeds cannot pass as held out.
3. **Coverage at a matched size.** The random arm keeps every viable genome; the archives keep one
   per cell. Each history's arms are scored on a seeded subsample of the smallest selection size
   (`matchedCoverage`). Primary readout: panel tests passed by at least one matched member. Full
   per-test pass rates are reported beside it. A genome selected by several arms is evaluated once
   per assay, so all arms see the same held-out result.
4. **Seeds.** Screening seeds `history·100,000 + arm·20,000 + batch·100 + chunk` (batch < 200,
   chunk < 100) stay below `900,000,000`; held-out seeds start there. History 8,999 is reserved for
   calibration and refused by `compare`. Tests check there are no collisions.
5. **Calibration** (`tools/atlas.ts calibrate`): the M3 founder set plus three mutants each, under
   the screening protocol with the atlas observer, on the reserved calibration seeds. It sets the
   bin ranges and selects nothing. Its genomes are not disjoint from the comparison's: the founders
   are also the comparison's pool, and any that are selected are evaluated again on held-out
   seeds. Independence here means fresh seeds and protocols, not fresh genomes.
6. **CLI** (`tools/atlas.ts compare`): pool = M3 founder set; arms random-viable, mass-speed,
   physical (embedding recorded as unimplemented); writes a manifest with versions, settings,
   every evaluateBatch seed and timings, the physical arm's ledger, selections, held-out
   evaluations and coverage.

## Calibration result (2026-11-01, `evidence/calib-2026-11-01` (copied from `runs/atlas/`))

48 genomes (12 founders, 36 mutants) in 3 batches of 16, about 23 s per batch (73 s total) on the
local WebGPU device under load average ~100. 47 survived. Displacement 0.054–0.322 cells per 100
steps (median 0.110); persistence 0.508–0.888 (median 0.754). Whole-tile centres of mass move far
less than tracked individuals (tracker speed reaches 1.0 for founder 2, whose displacement is
0.11), because many bodies average out. The placeholder displacement range [0, 4] would have put
every founder in its lowest bin. New ranges: displacement [0, 0.4], persistence [0.4, 1], 8 bins
each. The 47 live genomes then fill 14 distinct cells, in bins 1–6 on both axes.

## Smoke comparison (2026-11-01, `evidence/smoke-2026-11-01` (copied from `runs/atlas/`))

`compare --histories 1,2 --budget 64 --batch 16`: 41 evaluateBatch calls, 534 s of search and
1,042 s in all, under load average ~100. It ran on `42cad5d` plus this slice's uncommitted code,
before the per-history scoring fix, so its `coverage.json` was rewritten with `atlas score`
(no GPU) under the fixed code and panel v1.

| History | Arm | Selected | Matched k | Covered (of 2) | Sweep pass rate | Lean pass rate |
|---|---|---|---|---|---|---|
| 1 | random-viable | 23 | 7 | 2 | 0.30 | 0.83 |
| 1 | mass-speed | 7 | 7 | 2 | 0.43 | 1.00 |
| 1 | physical | 22 | 7 | 2 | 0.23 | 1.00 |
| 2 | random-viable | 17 | 7 | 2 | 0.18 | 0.88 |
| 2 | mass-speed | 7 | 7 | 2 | 0.14 | 1.00 |
| 2 | physical | 20 | 7 | 2 | 0.20 | 0.95 |

What it shows:
- The pipeline runs end to end on real dynamics: pool, three arms, ledger, held-out assays on
  their own seeds, matched scoring, and rescoring from files.
- **The primary readout saturates.** At k = 7 every arm passes both tests in both histories, so
  "tests passed by at least one member" cannot separate arms with this panel. Lean survival is
  nearly universal (0.83–1.00). The per-test pass rates do vary (sweep 0.14–0.43).
- The physical atlas held 22 and 20 distinct cells against mass-speed's 7. No entry was
  displaced and none was a duplicate at this budget, so stepping stones and displacement have not
  yet been exercised on real data.

Two histories and 64 evaluations per arm say nothing about which arm is better.

## Before a pilot (recommendations, not yet decided)

- Change the primary readout to the matched **pass rate** per test (members of k passing), or
  make the panel harder (a harsher nutrient cut, a faster or dimmer sun). Decide this from the
  smoke run's numbers, not from a pilot's outcome.
- A budget large enough for displacement to occur; at about 23 s per 16-genome batch here, each
  history at budget 256 costs roughly 50 search calls plus held-out calls (about 25–30 minutes
  on this machine under load).
- Register the threshold and the number of histories in a dated protocol before running.

## What this slice does not claim

A smoke-sized `compare` run proves the pipeline end to end on real dynamics. It is not a pilot:
with a handful of histories and a small budget the paired difference has no power, and no
advance/stop threshold is registered yet. Choosing the pilot's budget and threshold needs the
runtime measured here.

## Verification

Pure tests for the panel, seeds, matched coverage and chunked evaluators (`panel.test.ts`, fake
batch function, no GPU); `deno check` of the CLI; a real calibration and a smoke comparison on the
local WebGPU device; Codex `gpt-6.1-sol` high review before commit.
