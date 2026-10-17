# The anomaly bell, v0 (2026-10-17)

Status: **exploratory, code only.** No model calls, no new simulation, no physics, no golden pin moved.
This is part a of the blinded twin test in `docs/naturalist-brainstorm-2026-10-07.md` §6.1 (shape 2,
"the anomaly bell"): a code detector that says when a world has departed from a stated normal, calibrated
on neutral runs before it ever speaks. Part b (the model) is not run here and still needs a yes for paid
calls.

The section "Fixed before running" was written and committed before the detector was run on any bundle.
The readout is added below it afterwards and is recorded against those rules, whatever it says.

## Fixed before running (2026-10-17)

### What normal is

There are no control twins on disk. The M4 bundles are independent runs per arm, and the arms do not
share a starting state: seed 1's `initHash` is `d2424e5422c1085c` under neutral, `ae8841a41f564873` under
treatment and `24d286d271b01876` under no-mutation. So v0 is the **envelope bell** (the brainstorm's
second normal, "the preset's ensemble envelope"), not the twin bell (the first normal). The twin bell
needs a control twin forked from the live world's checkpoint, which is new work and waits.

The envelope at a census is the set of neutral runs of the same preset (same `presetIdentity`, steps and
census cadence) at that step. A neutral run is always scored **leave-one-out**, against the other neutral
runs of its preset, never against an envelope that contains it. A treatment or no-mutation run is scored
against all neutral runs of its preset.

### Signals

Thirteen signals per census. Twelve are read from `series.jsonl`, one from `lineages.tsv`, both streamed
one census at a time; no table is held whole.

| Signal | Kind | Source | Floor |
| --- | --- | --- | ---: |
| `livingCells` | level | series | 1 |
| `individuals` | level | series | 1 |
| `meanMass` | level | series | 1 |
| `lineages` | level | series | 1 |
| `lineageShannon` | level | series | 0.01 |
| `patternEntropy` | level | series | 0.01 |
| `bioticRecycling` | level | series | 0.01 |
| `maxGeneration` | level (it falls as old lines die) | series | 1 |
| `dominantShare` | level: largest lineage's cells over all living cells (0 with no living cells) | lineages.tsv | 0.01 |
| `fissions` | rate: increase over the last 10 censuses (1,000 steps) | series (cumulative) | 1 |
| `fusions` | rate, as above | series (cumulative) | 1 |
| `buddings` | rate, as above | series (cumulative) | 1 |
| `mutations` | rate, as above | series (cumulative) | 1 |

A missing or non-finite value counts as 0. The activity block (`significant`, `newActivity`,
`cumulativeNew`) is left out: it reads 0 at every census sampled from the neutral runs, so it cannot
separate anything here.

### The departure score

At census step t, for signal s and reference set R (the envelope runs' values at t):

- m = median(R); spread = max(IQR(R) / 1.349, 0.05 · |m|, floor of s); z = (x − m) / spread.
- A **ring** on signal s is a window of W consecutive censuses in which z stays at or above +Z (the high
  side) or at or below −Z (the low side). Only windows that start at or after step 10,000 count, so the
  founders' first transient is not scored. A rate needs its 10 earlier censuses, so it starts later.
- The run's score on s is D_s = the largest, over all counted windows of W censuses and both sides, of the
  window's smallest |z| on that side. The run's score is D = max over the thirteen signals.
- The run **rings** (is flagged) iff D ≥ Z. One flag per run, whichever signal rang: the false-alarm
  rule below applies to the whole bell, not to each signal.
- Each ring is reported with its receipts: run, signal, side, the first window's start and end steps,
  the smallest |z| in that window, and the run's value and the envelope median at the window's start.

**Primary setting: Z = 4, W = 50** (5,000 steps outside the envelope by four robust spreads, every
census). A grid Z ∈ {3, 4, 6} × W ∈ {10, 50, 200} is computed and reported in full, all nine cells;
only (4, 50) decides.

### Corpora

- **Null, test 6's corpus (the bar):** the 70 neutral runs test 6 used. `replay-calib` gradient-m3 and
  spots-m3 (seeds 1001 to 1020 each) and `replay-m4` gradient-m3 (seeds 1 to 20) and spots-m3 (seeds 1
  to 10). Envelopes per preset, pooled across the two experiments: gradient-m3 has 40 neutral runs (each
  scored against 39), spots-m3 has 30 (each against 29).
- **Null, preliminary:** the 20 M4 gradient-m3 neutral seeds alone, each against the other 19. Reported,
  not the bar; it does not make more runs by pairing them.
- **Known to differ:** `replay-m4` gradient-m3 treatment (seeds 1 to 10) and no-mutation (seeds 1 to 5),
  each against all 40 gradient-m3 neutral runs (and, for the preliminary readout, against the 20 M4
  neutral seeds).

### Criteria

1. **False alarms (test 6's null rule).** At (4, 50), at most 2 of the 70 neutral runs ring, which is the
   same as test 6's "binomial upper 95% bound below 0.1". The tool refuses to call this criterion when
   fewer than 70 neutral runs load.
2. **Separation (test 6's effect bar).** P(D_treatment > D_neutral) ≥ 0.8, the Mann–Whitney effect with
   ties counted half, over the 10 treatment runs and the 40 gradient-m3 neutral runs (leave-one-out).
3. **Reported beside them, not deciding:** no-mutation against neutral (effect and rings of 5); rings
   among treatment (of 10); treatment against no-mutation (test 6's own pair, which an envelope bell is
   not built to separate); the preliminary 20-seed numbers; the full grid.

### Reading, fixed now

- Criterion 1 and criterion 2 pass: **the bell has a clapper** at v0's setting.
- Criterion 1 passes and criterion 2 fails: **quiet but deaf**: it does not ring on drift, and it does
  not hear selection either.
- Criterion 1 fails: **it rings on drift**, whatever criterion 2 says. In the brainstorm's words the bell
  has no clapper yet, and the naturalist waits behind measurement work.

### Secondary, also fixed now: a calibrated bell, held out

The way a bell would be calibrated in practice. At W = 50, for each preset, Z*_p = the largest D among
the 20 `replay-calib` neutral runs of preset p (each scored leave-one-out against all other neutral runs
of p). Then report how many of the 30 `replay-m4` neutral runs have D > Z*_p (under exchangeability about
30/21 ≈ 1.4 are expected), and how many treatment and no-mutation runs have D > Z*_gradient. Descriptive;
it does not change the reading above.

### Not in v0

- The twin bell (a control forked from the live world's checkpoint), as above.
- A model reading the rings (part b), which needs a yes for paid calls.
- Component-size quantiles, collective-fission similarity and pond scores: not in these bundles.

## Readout

Not yet run.
