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

## The field notebook, v0: fixed before generating (2026-10-17)

Status: **exploratory, code only.** The notebook is shape 1 of `docs/naturalist-brainstorm-2026-10-07.md`, built on the bell above and
on nothing else: no model call writes any sentence, and no simulation, rule or golden pin changes. It turns one run bundle into one
HTML page of field notes with receipts (`tools/notebook.ts`, logic in `tools/lib/notebook.ts`, the page in
`tools/lib/notebook-html.ts`). These rules were first written before any page was generated from a real bundle; a review of scratch pages then
changed them here (the step-10,000 claim, the sentence template, the filing heading, the false-alarm line, the record and cell
checks; then, after a second review, the envelope's scores, the record's rings run by run, the condition against the config and the
budding wording), before any page was generated for commit. The readout above
stays as it stands; this section amends none of it.

### What it rings on

- **Only at the calibrated threshold**, never at Z = 4. Z*_p is read from the committed record
  (`experiments/naturalist/bell-v0.json`, `summary.secondary.perPreset[p].zStar`: 7.04 for gradient-m3, 11.47 for spots-m3, at
  W = 50). A preset with no Z* in the record is refused, not scored at some other threshold.
- **The record must hold together.** It must say `complete: true`, `preliminaryOnly: false`, `missing: []` and the secondary readout
  `called`, and every count the page prints must follow from the record's own D values, recounted as the bell's `summarize` counts
  them: Z*_p is the largest D at W = 50 of the preset's 20 `replay-calib` neutral runs, the held-out count is the `replay-m4` neutral
  runs with D > Z*_p, the expectation of/(calib + 1), and criterion 1 the neutral runs with D ≥ Z at the primary W. Run by run, a
  run lists rings exactly when its D reaches Z, and each ring is one the bell could have written (a known signal and side, at the
  primary Z and W, from step 10,000 on, its smallest side·z between Z and the run's D). Otherwise the notebook stops, naming the
  count or the run.
- **Strictly above, everywhere.** A ring needs the window's smallest side·z to be *greater than* Z*, as the held-out count does, so
  none of the 20 calibration runs rings by construction. The bell is called with Z = the smallest double above Z*, so its own `≥` is
  this note's `>` and an exact tie never rings. A `replay-calib` neutral run's page says it cannot ring here by construction.
- **The envelope is the bell's.** All neutral runs of the preset in the bell corpus (40 for gradient-m3, 30 for spots-m3) must be
  present under the base directory, each one's manifest must match the record's corpus entry for it (`presetIdentity`, steps,
  census cadence), and each one, scored leave-one-out in the same read, must reproduce the record's D at W = 50 and its rings at
  Z = 4, W = 50 field for field, or the notebook stops: Z* and the false alarms were calibrated on those data, not on the manifests. A bundle that is one of them (the same directory) is
  scored leave-one-out, anything else against all of them; a bundle elsewhere whose manifest names a corpus neutral run is refused.
  The bundle must share the envelope's `presetIdentity`, steps and cadence (the bell's own check). When the bundle is a corpus run,
  its D at W = 50 and its rings at Z = 4, W = 50 must equal the record's entry (envelope `all-neutral`) exactly, or the notebook
  stops. Every manifest read (bundle and envelope) must have a `cfg.neutral` flag that agrees with its condition, and no spec
  overrides, so that a page calling a run neutral is about neutral physics. A bundle outside the corpus
  is allowed and its page says so. Nothing is read from the record's `detail` directory.
- **Only measured values.** Every series cell a signal is read from must be a finite number, in the bundle and in every envelope
  run, or the notebook stops: the bell counts a missing or non-finite cell as 0, which a page would print as measured. A z, median,
  spread or picture band that comes out non-finite also stops it. (Checked on the 85 corpus bundles: no such cell.)
- **The bell does the ringing.** Signals, burn-in (step 10,000), W = 50, the departure score and the first-window receipts are
  `tools/lib/bell.ts` (`BellScorer`, unmodified), fed every census of the bundle and the envelope in lockstep. For its pictures and
  stretches the notebook recomputes, in the same read, each census's z with the bell's own `departure` against its own sorted copy
  of the envelope values (the bundle left out when it is a member), keeping the bundle's value, z, the envelope median and the spread
  per census and signal (four numbers and a flag; no table). It stops unless, for all 26 (signal, side) pairs, its D at W = 50 equals
  the bell's exactly, and, for each ring, its first stretch begins at the receipt's start step and its own 50-census window there has
  the receipt's smallest side·z, value and median. Nothing is written until every page asked for has passed this check.

### What makes a note

- **One note per ring**: a (signal, side) whose D at W = 50 is above Z*. Its receipt is the bell's: the first window, with its start
  and end steps, the window's smallest |z|, and the run's value and the envelope median at the window's first census.
- **Stretches (drawn, not scored).** The note also gives every *stretch* of the ring: an unbroken run of counted censuses with side·z
  above Z*, at least 50 long (the first begins where the receipt's window does), with its start and end step, length, weakest and
  strongest |z|, and whether it was still going at the last census. Nothing else is read from them.
- **Filing.** A note is filed under the step its first stretch begins ("First stretch from step X"; "First stretches from step X"
  when several begin at the same census), in order of that step; within one, by the window's smallest |z|, largest first. The page
  says beside the notes that this step is where the first 50 censuses in a row beyond Z* begin, counted from step 10,000, and that
  it is not an onset: it depends on Z* and on the burn-in. Notes filed together are not said to cause one another.
- **No ring, no note.** A run with no ring gets a page that says so, with every signal's D beside Z*. Nothing below Z* is narrated.

### Labels and words

- Every note carries two chips from DESIGN.md's vocabulary: **Measured** for the numbers and **Unclear** for what the ring means (the
  notebook gives no cause). A run with no ring is **Measured** for its D values and **Not yet measured** for "nothing is going on".
- On the first page, three statements carry chips: the bell at Z = 4 rings on drift (30 of 70 neutral runs; **Negative**), the
  calibrated thresholds held out (1 of 30 neutral runs above Z*, about 1.4 expected; **Measured**), and the bell hears something arise
  inside a single run (**Not yet measured**). **Confirmed** and **Seen** are never used.
- **Neutral runs that ring are false alarms, and the page says so first.** When a neutral run rings, its first page and its run
  section say: for one of the record's held-out neutral runs, "This is one of the bell's 30 held-out neutral runs, so every note
  below is a false alarm of the bell by definition: it is one of the 1 of 30 held-out neutral runs that scored above Z*"; for a
  neutral run outside the corpus, that every note is the bell ringing on neutral dynamics alone.
- **No "event", no "discovery".** Neither word appears in any sentence, heading or label the notebook writes, because the bell is not
  shown to hear anything arise inside a run. Identifiers and paths read from a bundle (an experiment's name, say) are printed as
  they are. The first page says, attributed to the readout and to the corpus, not to the run on the page: the envelope bell measures
  where a world stands against the neutral runs, not when something starts; in the readout, at Z = 4, 14 of the 15 treatment and
  no-mutation runs of the corpus rang from step 10,000, the first census counted, so their arms stand apart from the start, which
  M4 already knew; and the step a note is filed under is not when anything started.
- **Plain-words template.** Each of the 13 signals has a fixed name, a one-line meaning (citing the code that computes it, checked
  against that code) and a phrase for each side. Every note's sentence is: "<Phrase>: <value> at step <a>, against a neutral median
  there of <median>. Beyond Z* for <n> censuses in a row, from step <a> to step <b>; the weakest of them was <k> spreads
  <above|below> the median." Value and median are the first census's (the receipt's); n, b and k are the first stretch's, k its
  weakest |z| over the whole stretch. The spread is the bell's (IQR/1.349, floored). Counts are whole numbers, shares
  (`dominantShare`, `bioticRecycling`) percentages, other values (`meanMass`, `lineageShannon`, `patternEntropy`) three significant
  figures, z two decimals. Rates say "in the last <n> steps", n = 10 censuses times the cadence (1,000 steps in every corpus run).
  The meanings say what the code counts and no more: a budding is a body that appeared with no predecessor and that the observer
  credited to the nearest living body of its lineage not itself new at that census, less than 24 cells away on the same tile; not
  a measured descent. British spelling, curly quotes.
- **Pictures are drawn, not read.** A note's picture bins the run into columns of 25 censuses, each showing the run's lowest and
  highest value in it, and the envelope median and the Z* band (median ± Z*·spread) at the column's last census. The timeline draws
  stretches at census resolution. Nothing on the page is computed from them.
- **Numbers on the first page and in "What this cannot tell you" come from the record**: the Z = 4 false alarms and the signals they
  rang on, the held-out count and its expectation, Z* and the number of calibration runs behind it, and the treatment and no-mutation
  runs that rang from step 10,000. The record's path and SHA-256 are their receipt.

### What the page holds, in order

1. A first-page block: what this is, the three chips, the sentence that the notebook rings only at the calibrated threshold, the
   readout's finding on the arms, and the run's status line when it has one (false alarm, calibration run, outside the corpus).
2. The run: id, experiment, world, condition, seed, steps, cadence, `presetIdentity`, Z*, the envelope and whether this run was left
   out of it, D, and the number of rings.
3. A timeline of the 13 signals: the burn-in marked as not counted, and each ring's stretches as bars.
4. The notes, filed as above, each with its picture, stretches and receipt.
5. Every (signal, side) against Z*: D at W = 50 and how far each is from Z*.
6. **What this cannot tell you**, and the receipts for the page (record path and SHA-256, versions, files read with their sizes).

### What this cannot tell you (the page says all of it)

- It compares a world with the neutral runs of its preset, not with a twin of itself: a note says "unlike the neutral runs", not
  "something changed here". The twin bell does not exist yet.
- The readout's finding on the arms (above): a note on a treatment or no-mutation world says its arm differs, not that something
  arose in it.
- Z* is the largest of 20 calibration scores: one order statistic, its own noise. Held out, 1 of 30 neutral runs passed it; a run
  can be noted on neutral dynamics alone.
- At Z = 4 the neutral runs that rang did so on `maxGeneration` high (20 runs), `dominantShare` high (16) and `fissions` high (1);
  the readout reads the first two as heavy upper tails under drift.
- A signal noted once is not shown to be noted again: each note gives its stretches, not a forecast.
- Nothing is said about cause, mechanism or importance, nor about the signals' relation beyond "first stretches from the same census".
- The page is only as complete as the 13 signals, and sees nothing before step 10,000.

### The sample pages, chosen before generating

Chosen from the record's D values at W = 50 (envelope `all-neutral`), and generated in one lockstep pass with the 40 gradient-m3
neutral runs:

- `replay-m4/gradient-m3/neutral/seed-15` (D 7.19, Z* 7.04): the one held-out neutral run above Z*, so a page where the bell rings on
  neutral dynamics alone. This is the page to commit as the dated example, whatever it says.
- `replay-m4/gradient-m3/treatment/seed-1` (D 74.2): a treatment run, the case the first page warns about.
- `replay-m4/gradient-m3/neutral/seed-12` (D 3.05, the quietest held-out gradient-m3 run): the no-ring page.

Each must reproduce its D from the record exactly. The sample is output of these rules, not a test of them. After the first page is
generated for commit, the wording of the templates may still be fixed (recorded in a dated section below, and the pages
regenerated); what rings, the thresholds, the envelope, the stretches and the labels may not.
