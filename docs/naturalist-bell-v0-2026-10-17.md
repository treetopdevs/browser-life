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

## Readout (2026-10-17, after the run)

Run with `deno run -A tools/bell.ts run --base <main checkout>/runs --out <scratchpad> --record
experiments/naturalist/bell-v0.json` over all 85 runs of the corpus (complete, nothing missing; 5.5 minutes
of CPU, no GPU). The record is `experiments/naturalist/bell-v0.json`; the per-run detail (D by signal,
side and W, every receipt) stayed in the session scratchpad.

**Reading: it rings on drift.** Criterion 1 fails, so by the rule fixed above the bell has no clapper
yet at v0's setting, whatever criterion 2 says.

| | Result at Z = 4, W = 50 | Bar | |
| --- | --- | --- | --- |
| 1. False alarms, 70 neutral runs | **30 of 70** ring (upper 95% bound 0.53) | at most 2 (bound below 0.1) | fail |
| 2. Treatment against gradient-m3 neutral | effect **1.00** (10 against 40) | ≥ 0.8 | pass |
| No-mutation against neutral (reported) | effect 1.00; 5 of 5 ring | | |
| Treatment rings (reported) | 10 of 10 | | |
| Treatment against no-mutation (reported) | effect 1.00 | | |
| Preliminary, 20 M4 neutral seeds | 16 of 20 ring; treatment 10 of 10, no-mutation 5 of 5, effect 1.00 | | |

The full grid, false alarms of 70 (of 20 preliminary), with treatment ringing 10 of 10 and the effect
1.00 in every cell:

| | W = 10 | W = 50 | W = 200 |
| --- | ---: | ---: | ---: |
| Z = 3 | 65 (20) | 42 (19) | 9 (1) |
| Z = 4 | 54 (20) | **30 (16)** | 3 (1) |
| Z = 6 | 36 (18) | 6 (4) | 0 (0) |

The calibrated bell, held out (secondary, W = 50): Z* is 7.04 for gradient-m3 and 11.47 for spots-m3,
from the 20 `replay-calib` neutral runs each. Above Z*: 1 of the 30 held-out `replay-m4` neutral runs
(about 1.4 expected), 10 of 10 treatment and 5 of 5 no-mutation runs.

What the numbers say, beyond the reading. None of this changes the reading; it is what a v1 would have
to be fixed from, before a fresh run.

- **Where the false alarms come from.** Of the 30 neutral rings, the signal that rang was
  `maxGeneration` high (20 runs), `dominantShare` high (16) and `fissions` high (1); a run can ring on
  more than one. No other signal rang on a neutral run. These two signals have heavy upper tails under
  drift: now and then one neutral lineage takes most of the jar, or one line gets many generations
  deep. Their largest neutral D at W = 50 is 11.5 and 7.0. Among the other eleven signals the largest is
  4.05 (`fissions`, spots-m3 seed 1004, the one `fissions` ring), and the next is 3.5. Leaving the two
  out after the fact, that one run of 70 would ring at (4, 50), and every treatment and no-mutation
  run still would. That is a post-hoc look at the same corpus, not a pass.
- **The hits are not events.** Every treatment and no-mutation run rings in its first counted window
  (steps 10,000 to 14,900, except treatment seed 4: `mutations` high, steps 21,200 to 26,100). The
  first ring is mostly `livingCells` low: 13,000 to 25,000 living cells against a neutral median of
  33,684. Treatment and no-mutation worlds are already smaller than neutral ones at step 10,000, the first
  census the bell counts, so the
  separation says the arms are different worlds, which M4 already knew. It does not show the bell
  hearing a departure arise within a world. The envelope bell measures where a world stands against
  the neutral ensemble; for "something happened here", the bell needs the twin (a control forked from
  the world's own checkpoint), or an envelope of its own arm.
- **Calibration works where the rule did not.** Thresholds read off one null corpus held up on
  another (1 of 30 against about 1.4 expected), which is the calibrated route the brainstorm
  described: calibrate on neutral runs before the bell speaks.

Next, if this line goes on (each needs its own rules fixed before running): a v1 envelope bell with
thresholds calibrated per signal on `replay-calib` and judged on `replay-m4`; a within-arm bell
(treatment against the other treatment runs) to ask whether one world departs from its own arm; and
the twin bell once the lab can fork a control twin.
