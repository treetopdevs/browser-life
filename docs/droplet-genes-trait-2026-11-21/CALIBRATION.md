# Droplet genes, heritable trait: calibration record

**Date:** 2026-11-21. **Branch:** `claude/dropgenes-trait` from `c60d2e5a`. Seeds 1 to 4 only. Nothing here is
evidence; every number is calibration. Raw outputs are in `runs/dropgenes/trait/` (gitignored).

**How to read this file.** It is a log in the order things happened. The ladder kernel's copy service order
was corrected twice after review (Amendments A and B, near the end). Steps 0 to 3 were run with the first
kernel and Amendment A's runs with an intermediate one; they are kept as a record of what was tried and why
the choices were made. **Only the runs under "Amendment B" are from the final kernel**, and the frozen plan
rests on those.

Everything is at `LARGE` (`diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`), two genes, 16 sites per tile,
64 x 64, the first rung's founders (4 x 4 grid of spots, two copies of each gene per wall tile).

Budget: about 6 core-hours for all of calibration. Measured before any calibration run (smoke runs, seed 1,
4,000 steps, gated, `mutLevel 1/256`, start level 0): the ladder kernel does about 250 steps per CPU-second
with 5 levels and about 215 with 8. The machine gave each process about a third of a core.

## Step 0, written before it ran: monoculture pre-scout (no mutation, nothing can evolve)

Purpose: to choose the function saturation `geneSat` and the high start level before the calibration settings
are listed. Every founder copy is put at one level, `mutLevel` is 0, the world is gated. This shows how a
population of compartments does at each fixed level. It cannot show the trait moving, so it is not one of the
calibration settings the stop rule counts; it comes before that list and informs it.

Runs (8,000 steps each, `experiments/dropgenes/trait-mono.ts`):

- 5 levels: `geneSat` 2, 4, 8, 16; start levels 0, 1, 2, 3; seed 1.
- 8 levels: `geneSat` 2, 4, 8; start levels 4, 5, 6; seed 1.

Read at step 8,000: compartments, mean area, copies per compartment, mean gene function on compartment tiles
and the share of those tiles at full function.

Rule for the high start, fixed now: for a given `geneSat` and number of levels, the high start is the highest
level whose monoculture has at least 10 compartments at step 8,000.

### Step 0 result

25 runs, conservation residual 0 in all. Compartments at step 8,000 (seed 1, gated, no mutation); in brackets
the mean gene function on compartment tiles and the share of those tiles at full function.

Five levels (function per copy 1, 0.75, 0.5, 0.25, 0; copy rate 1, 1.25, 1.5, 1.75, 2 times `kRep`):

| `geneSat` | level 0 | level 1 | level 2 | level 3 | high start by the rule |
|---|---|---|---|---|---|
| 2 | 55 (0.96, 0.93) | 48 (0.96, 0.91) | 53 (0.94, 0.88) | 42 (0.93, 0.78) | 3 |
| 4 | 50 (0.93, 0.84) | 51 (0.93, 0.80) | 42 (0.94, 0.83) | 32 (0.83, 0.44) | 3 |
| 8 | 50 (0.90, 0.72) | 35 (0.90, 0.65) | 27 (0.81, 0.43) | 0 | 2 |
| 16 | 25 (0.80, 0.36) | 14 (0.75, 0.22) | 0 | 0 | 1 |

Eight levels (function per copy `(7 - v) / 7`, copy rate `(7 + v) / 7` times `kRep`):

| `geneSat` | level 4 | level 5 | level 6 | high start by the rule |
|---|---|---|---|---|
| 2 | 44 (0.94, 0.85) | 39 (0.94, 0.82) | 31 (0.86, 0.54) | 6 |
| 4 | 46 (0.91, 0.68) | 31 (0.84, 0.49) | 0 | 5 |
| 8 | 18 (0.81, 0.37) | 0 | 0 | 4 |

Readings (one seed, 8,000 steps): the cost of a higher level to a compartment population is graded, not a
cliff at the top level, and `geneSat` sets where it bites. At `geneSat` 2 every level below the top still
carries a population, thinner at the highest one. `geneSat` 16 already thins the level-0 world to about half
and is not used below. Copies per compartment rise with level (faster copying fills more of the sites).

## Step 1, written before any of it ran: the calibration settings

Twelve settings, the most the stop rule allows. All gated, selected ladder (`GATED_SEL`), from two starts:
every founder copy at level 0, and every founder copy at the high start that Step 0's rule gives.

| name | levels | `geneSat` | `mutLevel` | high start |
|---|---|---|---|---|
| c01 | 5 | 2 | 1/64 | 3 |
| c02 | 5 | 2 | 1/256 | 3 |
| c03 | 5 | 4 | 1/64 | 3 |
| c04 | 5 | 4 | 1/256 | 3 |
| c05 | 5 | 8 | 1/64 | 2 |
| c06 | 5 | 8 | 1/256 | 2 |
| c07 | 8 | 2 | 1/64 | 6 |
| c08 | 8 | 2 | 1/256 | 6 |
| c09 | 8 | 4 | 1/64 | 5 |
| c10 | 8 | 4 | 1/256 | 5 |
| c11 | 5 | 4 | 1/1024 | 3 |
| c12 | 8 | 4 | 1/1024 | 5 |

**Screen:** each setting, both starts, seeds 1 and 2, 20,000 steps (48 runs):

```bash
experiments/dropgenes/trait-screen.sh c01 5 2 0.015625 3 20000 1,2      # and so on down the table
```

Read at the end of each run (late = the last tenth, steps 18,001 to 20,000): held or not, late mean level of
copies in compartments, late top-level share.

**How a setting is classed, fixed now** (per setting, over its four runs):

- *dies*: any of the four runs is not held.
- *does not move*: in both starts on both seeds the late level is within 0.25 of the start level.
- *qualifies*: all four runs held, and on both seeds the gap between the two starts' late levels is at most
  half the gap between the start levels.
- otherwise *moves, not yet converging at 20,000 steps*.

**Stop rule (from the brief):** if every one of the twelve settings is *dies* or *does not move*, the line
ends negative and nothing more is run.

**Choice of the candidate, fixed now.** Among qualifying settings take the largest score, where

    score = (distance from the mean late level, over starts and seeds, to the nearest end of the neutral
             range predicted at 200,000 steps) - (mean over seeds of the gap between the two starts' late levels)

and the predicted neutral range is from the slowest mode of a symmetric one-step walk on V levels with dropped
moves at the ends: a neutral mean starting at x0 sits at `m + (x0 - m) * exp(-t / tau)` with `m = (V - 1) / 2`,
`tau = 50 / (mutLevel * (1 - cos(pi / V)))` steps (50 steps is one template lifetime, `1 / kDecT`). The range
is between that figure for the low start and for the high start at t = 200,000. This favours a setting whose
two starts meet at a level that a neutral ladder would not reach. If no setting qualifies but some move,
the two that moved furthest toward each other are run on to 60,000 steps before choosing.

**After the choice** (still seeds 1 to 4 only), at the candidate: `GATED_SEL` both starts to 200,000 steps on
seeds 1 and 2; `GATED_NEU` both starts to 200,000 steps on seed 1; `UNGATED_SEL` both starts on seeds 1 and 2
(to 200,000 steps or until the world ends); `UNGATED_NEU` both starts to 50,000 steps on seed 1. The pass
rule's numbers are set from those and frozen in PLAN.md. No seed above 4 is run in calibration.

### Step 1 result: the screen

48 runs (12 settings x 2 starts x seeds 1 and 2), 20,000 steps, residual 0 in all. Late = steps 18,001 to
20,000. Each cell: late mean level of copies in compartments (late mean compartments). From
`experiments/dropgenes/trait-screen-read.ts runs/dropgenes/trait/screen`.

| setting | levels | `geneSat` | `mutLevel` | starts | seed 1: low start, high start | seed 2: low start, high start | class | mean late level | mean gap | predicted neutral range at 200,000 | score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| c01 | 5 | 2 | 1/64 | 0, 3 | 3.15 (27), 3.13 (31) | 3.16 (32), 3.15 (32) | qualifies | 3.15 | 0.01 | 2.00 to 2.00 | 1.14 |
| c02 | 5 | 2 | 1/256 | 0, 3 | 1.42 (43), 3.04 (40) | 1.65 (42), 3.06 (38) | moves, not yet converging | 2.29 | 1.51 | 1.90 to 2.05 | |
| c03 | 5 | 4 | 1/64 | 0, 3 | 2.79 (16), 3.07 (15) | 3.10 (19), 3.08 (15) | qualifies | 3.01 | 0.15 | 2.00 to 2.00 | 0.86 |
| c04 | 5 | 4 | 1/256 | 0, 3 | 1.02 (37), 3.02 (27) | 1.29 (42), 3.03 (27) | moves, not yet converging | 2.09 | 1.87 | 1.90 to 2.05 | |
| c05 | 5 | 8 | 1/64 | 0, 2 | ended at 12,400; ended at 17,750 | ended at 12,050; ended at 6,000 | **dies** | | | | |
| c06 | 5 | 8 | 1/256 | 0, 2 | 0.55 (36), 2.05 (27) | 0.37 (36), 2.09 (21) | moves, not yet converging | 1.26 | 1.61 | 1.90 to 2.00 | |
| c07 | 8 | 2 | 1/64 | 0, 6 | 4.48 (38), 5.39 (34) | 5.14 (31), 5.50 (36) | qualifies | 5.13 | 0.64 | 3.47 to 3.52 | 0.97 |
| c08 | 8 | 2 | 1/256 | 0, 6 | 0.79 (44), 6.00 (31) | 0.93 (46), 5.99 (33) | moves, not yet converging | 3.43 | 5.14 | 2.43 to 4.26 | |
| c09 | 8 | 4 | 1/64 | 0, 5 | 4.37 (35), 4.78 (28) | 4.79 (27), 5.11 (19) | qualifies | 4.76 | 0.37 | 3.47 to 3.51 | 0.88 |
| c10 | 8 | 4 | 1/256 | 0, 5 | 0.56 (43), 5.03 (36) | 0.86 (46), 5.05 (31) | moves, not yet converging | 2.88 | 4.33 | 2.43 to 3.96 | |
| c11 | 5 | 4 | 1/1024 | 0, 3 | 0.13 (43), 3.01 (32) | 0.05 (47), 3.00 (33) | does not move | 1.55 | 2.91 | 1.05 to 2.47 | |
| c12 | 8 | 4 | 1/1024 | 0, 5 | 0.05 (50), 5.01 (36) | 0.03 (48), 5.04 (34) | does not move | 2.53 | 4.99 | 0.90 to 4.61 | |

**Stop rule: not triggered.** Four settings qualify, one dies, two do not move within 20,000 steps, five move
without the starts having met by 20,000 steps.

What the screen shows, as calibration only:

- At `mutLevel` 1/64 the low start climbs most of the ladder within 20,000 steps and stops below the top level
  in the four settings that hold. At 1/256 the climb is about a quarter as fast (level 0.4 to 1.7 by 20,000
  steps); at 1/1024 it has barely begun (0.03 to 0.13).
- **c07 is the only setting where the high start came down**: from level 6 to 5.39 and 5.50, while the low
  start rose to 4.48 and 5.14 and was still rising. In c01, c03 and c09 the high start stayed within 0.22 of
  where it began (c01: 3.13, 3.15; c03: 3.07, 3.08; c09: 4.78, 5.11), so in those the two-start test is
  one-sided: the low start arrives at the high start's level.
- **c05 dies** (5 levels, `geneSat` 8, `mutLevel` 1/64) from both starts on both seeds, between step 6,000 and
  17,750. At that saturation level 2 is already costly to a compartment and level 3 is lethal (Step 0). The
  same ladder at `mutLevel` 1/256 (c06) is alive at 20,000 steps with the low start at 0.37 to 0.55; whether it
  goes the same way later was not run.
- In every selected run that is held the response check's late "between" term is negative or near zero and
  the "within" term positive or near zero (for example c01, low start: between -0.11 and -0.20 per 2,000
  steps, within +0.08 and +0.06). The neutral twin was not run in the screen, so these have no control yet.
- Cost so far: Step 0 and the screen together took about 4,700 seconds of process time (1.3 core-hours).

## Step 2, written before it ran: is c07's descent more than mutation alone?

By the score fixed in Step 1 the candidate is c01. c07 looked better in one respect (its high start came
down), but a neutral ladder also comes down from a high start, by mutation alone: the Step 1 formula puts a
neutral start at level 6 (8 levels, 1/64) at about 5.05 by step 20,000, below c07's selected runs (5.39,
5.50). So the descent may be no evidence of selection between compartments.

Check: `GATED_NEU` at c01 and c07, both starts, seeds 1 and 2, 20,000 steps (8 runs).

Bar, fixed now:

- If at c07 the neutral high start's late level is **at or below** the selected high start's on either seed,
  or above it by less than 0.3, c07's descent is not counted as two-sided and **the candidate stays c01**, as
  the Step 1 score says. If any c01 gated selected run is then not held at 200,000 steps on seeds 1 and 2, the
  candidate becomes c07.
- If the neutral high start is above the selected one by more than 0.3 on both seeds, the descent is beyond
  mutation and the candidate becomes c07, recorded as an amendment to the Step 1 choice.

The same runs are the first control for the response check: if the neutral twin's "between" term (mean over
all windows) is as negative as the selected runs', the readout is biased and is fixed before anything is
frozen.

Then, at the candidate and before the long gated runs: `UNGATED_SEL`, both starts, seeds 1 and 2. The setting
is not re-chosen on its outcome.

### Step 2 result

8 runs, residual 0. Late level at 20,000 steps (late mean compartments):

| setting | arm | low start, seed 1 | low start, seed 2 | high start, seed 1 | high start, seed 2 |
|---|---|---|---|---|---|
| c01 | `GATED_SEL` | 3.15 (27) | 3.16 (32) | 3.13 (31) | 3.15 (32) |
| c01 | `GATED_NEU` | 1.74 (50) | 1.01 (51) | 2.51 (49) | 2.14 (51) |
| c07 | `GATED_SEL` | 4.48 (38) | 5.14 (31) | 5.39 (34) | 5.50 (36) |
| c07 | `GATED_NEU` | 1.36 (52) | 1.27 (53) | 5.08 (51) | 4.59 (52) |

- **c07's descent is not beyond mutation.** The neutral high start fell to 5.08 and 4.59, at or below the
  selected high start (5.39, 5.50). By the bar, c07 is not two-sided and **the candidate stays c01**.
- The neutral twin wanders more than the selected ladder: two seeds from the same start differ by 0.4 to 0.7
  at 20,000 steps, and the spread of level among compartments is 1.0 to 1.3 (selected: 0.2 to 0.9).
- **Response check against neutral** (mean "between" term over the ten 2,000-step windows; windows with
  negative covariance):

| setting | arm | low start, seeds 1, 2 | high start, seeds 1, 2 |
|---|---|---|---|
| c01 | `GATED_SEL` | -0.169 (9 of 10), -0.161 (8 of 10) | -0.116 (9 of 10), -0.088 (8 of 10) |
| c01 | `GATED_NEU` | +0.021 (4 of 10), -0.000 (5 of 10) | -0.043 (6 of 10), +0.009 (4 of 10) |
| c07 | `GATED_SEL` | -0.336 (8 of 10), -0.256 (8 of 10) | -0.139 (8 of 10), -0.122 (8 of 10) |
| c07 | `GATED_NEU` | +0.042 (5 of 10), +0.002 (4 of 10) | -0.031 (6 of 10), -0.055 (5 of 10) |

  The neutral twin's term is within about 0.06 of zero with either sign; the selected ladder's is negative in
  all eight runs. The readout is not biased toward a negative value, so it goes into the pass rule.

## Step 3, written before it ran: the candidate c01 on calibration seeds

Candidate: **c01** (5 levels, `geneSat` 2, `mutLevel` 1/64, starts 0 and 3). Changed from the Step 1 list of
runs after Step 2 showed how much a neutral run wanders: the neutral twin gets two seeds, not one. In this
order (`runs/dropgenes/trait/screen/cand-c01`):

1. `UNGATED_SEL`, both starts, seeds 1 and 2, planned 200,000 steps (a run stops by itself when no wall is left).
2. `GATED_SEL`, both starts, seeds 1 and 2, 200,000 steps.
3. `GATED_NEU`, both starts, seeds 1 and 2, 200,000 steps.
4. `UNGATED_NEU`, both starts, seeds 1 and 2, 50,000 steps.

The setting is not re-chosen on the ungated outcome. If any `GATED_SEL` run here is not held, the candidate
becomes c07 (Step 2's bar). The pass rule's numbers are set from these 16 runs.

### Step 3 result: the candidate c01 on seeds 1 and 2

16 runs, residual 0 in all. Tables from
`experiments/dropgenes/summarize.ts runs/dropgenes/trait/screen/cand-c01 --trait --calibration` (saved beside
the runs as `runs/dropgenes/trait/cand-c01-summary.md`). Late = the last tenth of each run.

| arm | start | seed | steps | held | late compartments | late level | sd of level among compartments | late top-level share |
|---|---|---|---|---|---|---|---|---|
| `GATED_SEL` | 0 | 1 | 200,000 | yes | 28.7 | 3.151 | 0.23 | 0.199 |
| `GATED_SEL` | 0 | 2 | 200,000 | yes | 29.2 | 3.152 | 0.22 | 0.198 |
| `GATED_SEL` | 3 | 1 | 200,000 | yes | 29.8 | 3.150 | 0.23 | 0.200 |
| `GATED_SEL` | 3 | 2 | 200,000 | yes | 29.7 | 3.115 | 0.28 | 0.198 |
| `GATED_NEU` | 0 | 1 | 200,000 | yes | 51.9 | 2.582 | 1.10 | 0.336 |
| `GATED_NEU` | 0 | 2 | 200,000 | yes | 51.6 | 2.057 | 1.05 | 0.191 |
| `GATED_NEU` | 3 | 1 | 200,000 | yes | 51.0 | 2.243 | 0.97 | 0.280 |
| `GATED_NEU` | 3 | 2 | 200,000 | yes | 50.7 | 2.262 | 1.12 | 0.243 |
| `UNGATED_SEL` | 0 | 1 | 200,000 | yes | 25.5 | 3.163 | 0.22 | 0.212 |
| `UNGATED_SEL` | 0 | 2 | 200,000 | yes | 28.0 | 3.151 | 0.21 | 0.199 |
| `UNGATED_SEL` | 3 | 1 | 200,000 | yes | 25.6 | 3.170 | 0.22 | 0.217 |
| `UNGATED_SEL` | 3 | 2 | 200,000 | yes | 26.5 | 3.155 | 0.22 | 0.206 |
| `UNGATED_NEU` | 0 | 1 | 50,000 | yes | 51.9 | 1.383 | 1.04 | 0.132 |
| `UNGATED_NEU` | 0 | 2 | 50,000 | yes | 50.5 | 1.815 | 1.03 | 0.189 |
| `UNGATED_NEU` | 3 | 1 | 50,000 | yes | 52.6 | 1.237 | 0.87 | 0.059 |
| `UNGATED_NEU` | 3 | 2 | 50,000 | yes | 52.5 | 1.405 | 0.84 | 0.077 |

Readings (two seeds; calibration only):

- **Gated, selected.** All four runs held. The two starts end 0.001 (seed 1) and 0.037 (seed 2) apart, at
  3.12 to 3.15. The low start was within 0.25 of its late level by step 6,500 (seed 1) and 9,000 (seed 2).
  Over the second half of each run the level, averaged in 20,000-step stretches, stayed between 3.11 and 3.18.
- **Neutral twin at 200,000 steps.** Late level 2.06 to 2.58. It wanders: averaged in 20,000-step stretches
  after the first 20,000 steps, the two low-start runs ranged from 1.45 to 2.59. The gated selected level is
  0.57 (seed 1) and 0.85 (seed 2) above the higher neutral run of its seed. The pass rule's margin of 0.4 was
  written before these two neutral pairs finished (it rested on Step 2's 20,000-step runs) and is kept.
- **Response check, windows of the second half of each run** (mean "between" term per 2,000 steps; windows
  with negative covariance):

| arm | low start, seed 1 | low start, seed 2 | high start, seed 1 | high start, seed 2 |
|---|---|---|---|---|
| `GATED_SEL` | -0.127 (48 of 50) | -0.121 (50 of 50) | -0.135 (50 of 50) | -0.134 (49 of 50) |
| `GATED_NEU` | +0.028 (23 of 50) | -0.023 (28 of 50) | -0.024 (31 of 50) | +0.012 (21 of 50) |
| `UNGATED_SEL` | -0.107 (47 of 50) | -0.106 (50 of 50) | -0.114 (48 of 50) | -0.105 (48 of 50) |

  In the selected worlds the "within" term is the mirror of it (+0.12 to +0.14 gated, +0.11 to +0.12
  ungated): the level inside lines of descent rises by about as much per window as the loss of high-level
  compartments takes away.
- **Resemblance in mean level, gated selected, splits of the second half** (parent / nearest neighbour /
  unrelated): at the split 0.78 to 0.82 / 0.05 to 0.15 / 0.00 to 0.06; 500 steps later, survivors only, 0.33
  to 0.43 / 0.03 to 0.09 / 0.00 to 0.03; scored when last seen, 0.52 to 0.57 / 0.04 to 0.08 / 0.00 to 0.03.
  About 44% of daughters were gone by 500 steps. The daughters that were gone had a higher level at the split
  (3.19 to 3.21) than those that lasted (3.04 to 3.06), and 3.33 to 3.35 when last seen. So the survivors-only
  figure is read from the lower-level daughters. (In these files a daughter absorbed by a neighbour is counted
  among the gone; see the review note below.)
- **Neutral twin, the same resemblance:** 0.93 to 0.96 at the split and 0.81 to 0.89 at 500 steps, against
  0.28 to 0.44 for the nearest neighbour and 0.11 to 0.26 for an unrelated compartment. Level differences among
  neutral compartments are large (sd about 1.0 to 1.1) and last; among selected compartments they are small
  (sd about 0.22) and are remade all the time.
- **Ungated, selected: no runaway.** All four runs held to 200,000 steps at 3.15 to 3.17, within 0.04 of the
  gated run from the same start, with 25 to 28 compartments against 29 to 30. The response term is negative
  there too. At this setting the ungated world rests at the same level as the gated one.
- **Ungated, neutral:** held on 4 of 4 at 50,000 steps (about 51 compartments).

By the frozen rule's numbers these two seeds read: G yes on 2 of 2, U (runaway) no on 2 of 2, "ungated matches
gated" yes on 2 of 2, T yes on 2 of 2 (T at 50,000 steps, not the confirmation's 200,000).

**The setting is frozen at c01.** No `GATED_SEL` run failed to hold, so the fallback to c07 does not apply, and
by Step 2's bar the ungated outcome does not move the choice.

### Review fixes after Step 3 (Codex, Sol 6.1, High; first pass)

Two readout definitions changed after the runs above, and one rule was tightened:

- The response check now counts as a descendant only a compartment that holds at least one copy (before, a
  descendant with no copies counted toward descendants but had no level). Checked on two re-runs with identical
  dynamics (c01, seed 1, low start, 20,000 steps, selected and neutral; `runs/dropgenes/trait/recheck`): no
  descendant without copies occurred, and every window's figures are identical. The numbers above stand.
- "Last seen" resemblance now leaves out daughters absorbed by another compartment (before, they were among
  the gone). On the same re-runs that moves 34 of 637 and 28 of 501 gone daughters to "left out" and changes
  the parent correlation by 0.001 or less. The 200,000-step figures above were made before this change.
- The rule's response condition reads the windows of the second half of the run, not all windows (so a
  response during the early climb cannot carry it). The table above already shows second-half figures.

### Cost

Step 0: 25 runs. Screen and Step 2: 56 runs of 20,000 steps. Step 3: 12 runs of 200,000 steps and 4 of 50,000.
Re-check: 2 runs of 20,000 steps. Summed time inside the simulation processes: about 12,800 seconds, 3.6
hours, each process on at most one core (so at most 3.6 core-hours of the 6 allowed). Never more than two
simulations at a time. Seeds used: 1 and 2 only.

### Not done

- Seeds 3 and 4 were not used.
- The ungated arm was run only at c01. Whether the ungated world runs away at any other listed setting is not
  known.
- c06 (5 levels, `geneSat` 8, `mutLevel` 1/256) was alive at 20,000 steps and was not followed further, though
  the same ladder at 1/64 (c05) died.
- No setting outside the twelve listed was run. In particular a shorter ladder, where the top level's edge
  over the level below it is larger than c01's 14% (2 against 1.75), was not listed and so was not tried.

## Amendment A (2026-11-21, after the second review pass, before any re-run): service order

**Everything above this line was run with a ladder kernel whose copy service order was not even-handed.** The
second review pass (Codex, Sol 6.1, High) found it. The first rung serves the species on a tile in index order
from a hashed start. Among the species actually present that is not fair: with species 0 and 1 present out of
ten, species 0 is served first for nine of the ten starts, and when fuel or free sites run short the species
served first gets the copy. On a ladder the species index is the level, so this gave low levels an edge that
has nothing to do with the stated rates, in the neutral twin too. A neutral twin that leans toward low levels
makes the rule's "off neutral" condition easier to meet for a world resting high on the ladder.

Fix (ladder worlds only; the first rung's order is unchanged and its pins still pass): the species present on
the tile are taken as a ring, the start is picked among them by one hash and the direction by another, so every
rotation and reflection is equally likely and no species is favoured. Tested under scarce fuel and under
scarce sites.

This changes the dynamics of every ladder run. What it means for the record above:

- Steps 0 to 3 stand as a record of what was run, but none of their numbers are from the final kernel.
- The stop rule's outcome does not rest on the bias: the low start climbed, against the old order's lean
  toward low levels, in ten of twelve settings.

Re-run with the corrected kernel, written here before any of it ran, same seeds (1 and 2), same rules:

1. **Screen of the four qualifying settings** (c01, c03, c07, c09): `GATED_SEL`, both starts, 20,000 steps
   (16 runs). The Step 1 score is recomputed; the candidate is the largest score among those that still
   qualify. The eight settings that did not qualify are not re-run and keep their earlier class.
2. **Step 2's check**: `GATED_NEU`, both starts, 20,000 steps at c01 and c07 (8 runs), with Step 2's bar
   unchanged (c07 replaces a c01 candidate only if c07's neutral high start ends above its selected high start
   by more than 0.3 on both seeds).
3. **The candidate**, as Step 3: `UNGATED_SEL`, `GATED_SEL`, `GATED_NEU` to 200,000 steps and `UNGATED_NEU` to
   50,000 steps, both starts (16 runs). The pass rule's numbers (0.25, 0.4, 3.5) were fixed before this
   re-run; they are checked against it and changed only if it shows them to be wrong, with the reason stated.

The monoculture pre-scout (Step 0) is not re-run: with one level per gene the order only decides which gene
goes first. Output directories carry a `v2-` prefix (`runs/dropgenes/trait/screen/v2-*`).

### Amendment A, items 1 and 2: result (corrected kernel, 24 runs, residual 0)

Late level at 20,000 steps (late mean compartments), `GATED_SEL`:

| setting | levels | `geneSat` | starts | seed 1: low start, high start | seed 2: low start, high start | class | mean late level | mean gap | score |
|---|---|---|---|---|---|---|---|---|---|
| c01 | 5 | 2 | 0, 3 | 3.17 (29), 3.17 (24) | 3.18 (24), 3.18 (31) | qualifies | 3.17 | 0.00 | 1.17 |
| c03 | 5 | 4 | 0, 3 | 3.14 (8, **not held**), 3.11 (16) | 2.83 (15), 3.10 (13) | dies | 2.97 | 0.27 | |
| c07 | 8 | 2 | 0, 6 | 5.28 (34), 5.81 (26) | 4.90 (34), 5.78 (31) | qualifies | 5.44 | 0.70 | **1.22** |
| c09 | 8 | 4 | 0, 5 | 4.21 (32), 5.16 (22) | 4.11 (36), 5.20 (24) | qualifies | 4.67 | 1.02 | 0.14 |

`GATED_NEU` at 20,000 steps, and the "between" term over the ten windows beside the selected runs':

| setting | arm | low start, seeds 1, 2 | high start, seeds 1, 2 | "between", low start | "between", high start |
|---|---|---|---|---|---|
| c01 | `GATED_SEL` | 3.17, 3.18 | 3.17, 3.18 | -0.194, -0.160 | -0.096, -0.118 |
| c01 | `GATED_NEU` | 1.84, 1.38 | 2.93, 2.06 | +0.061, +0.032 | +0.066, -0.039 |
| c07 | `GATED_SEL` | 5.28, 4.90 | 5.81, 5.78 | -0.342, -0.418 | -0.285, -0.206 |
| c07 | `GATED_NEU` | 1.49, 1.15 | 4.57, 4.67 | +0.037, +0.012 | -0.046, -0.107 |

- **The candidate changes to c07** by the rule written above before this re-run: the largest score among the
  settings that still qualify. The margin is narrow (1.22 against 1.17 on two seeds).
- With the corrected order c07's high start stays at about 5.8 (it was 5.4 to 5.5 before), and its neutral high
  start falls to 4.6 to 4.7, below the selected one. As before, c07 is not two-sided: its high start sits near
  where the world rests and the low start has to arrive there. At 20,000 steps the low start is still 0.5 to
  0.9 below.
- c03 no longer qualifies: one low-start run fell to 8 compartments in the late window.
- The corrected neutral twin sits higher than the earlier one at the same step in three of four c01 runs
  (1.84, 1.38, 2.93, 2.06 against 1.74, 1.01, 2.51, 2.14), which is the direction the fix predicts.

### Amendment A, item 3, written before it ran: the candidate c07

Candidate: **c07** (8 levels, `geneSat` 2, `mutLevel` 1/64, starts 0 and 6), seeds 1 and 2
(`runs/dropgenes/trait/screen/v2-cand-c07`). Order changed from Step 3 to protect the budget: `GATED_SEL` to
200,000 steps first; then `UNGATED_SEL` and `GATED_NEU` to 200,000 steps and `UNGATED_NEU` to 50,000.

Fixed now:

- If any of the four `GATED_SEL` runs is not held at 200,000 steps, or the two starts end more than 0.25
  apart on either seed, the candidate becomes c01 (the next score) and c01 is run instead.
- The setting is not re-chosen on the ungated outcome.
- The rule's "runs away" level was written as 3.5 for a five-level ladder: halfway between the highest working
  level and the top. For eight levels the same definition gives **6.5**. The other two numbers (0.25 and 0.4)
  are unchanged.

## Amendment B (2026-11-21, after the third review pass, before any further run): service order again

The third review pass found Amendment A's fix incomplete. A random start and direction round the ring of
present species makes each species equally likely to be first and any pair equally likely either way round,
but species next to each other by index stay next to each other in the order. When counts are unequal that
still shows: a rare species does worse or better depending on which levels the common species hold. The
level label was still visible to the copy step in the neutral twin.

Fix: the species present on a tile are served in a **uniformly random order** (a shuffle, one hash per swap).
What a species gets then depends only on its own count and the counts of the others. Tested with the
reviewer's case (counts 4, 20, 4, 20 against 4, 4, 20, 20 and 4, 20, 20, 4: the rare species gets a third of
the copies it asks for in each) as well as the equal-count cases.

Consequences:

- Amendment A's runs (the `v2-` directories: 24 screen runs) are not from the final kernel either. They stay
  as a record. The candidate run for c07 started under Amendment A was stopped part-way (no output kept).
- A fourth review pass of the kernel is made before any long run.

Re-run with this kernel, written before any of it ran, same seeds, same rules as Amendment A (`v3-` prefix):

1. Screen of c01, c03, c07, c09: `GATED_SEL`, both starts, 20,000 steps (16 runs). The candidate is the
   largest Step 1 score among those that qualify.
2. If the candidate by score is c01: Step 2's check for c07 (`GATED_NEU`, high start, seeds 1 and 2, 20,000
   steps), with Step 2's bar. If the candidate by score is c07, that check is not needed.
3. The candidate: `GATED_SEL` to 200,000 steps first. If any of the four runs is not held, or the two starts
   end more than 0.25 apart on either seed, the candidate becomes the next score and that one is run instead.
   Then `UNGATED_SEL` and `GATED_NEU` to 200,000 steps and `UNGATED_NEU` to 50,000, both starts, seeds 1 and 2.
   The setting is not re-chosen on the ungated outcome. Rule numbers as in Amendment A: 0.25, 0.4, and a
   "runs away" level halfway between the highest working level and the top (3.5 for five levels, 6.5 for
   eight).

Budget: about 4.2 hours of process time are spent. This re-run needs about 2.2 more, which takes the total
slightly past the 6 core-hours allowed; the two re-runs were forced by review findings in the kernel.

### Amendment B, items 1 and 2: result (final kernel, 18 runs, residual 0)

The fourth review pass found no P1 and no remaining path by which a level label affects a neutral run, so
these and all later runs are from the final kernel.

Late level at 20,000 steps (late mean compartments), `GATED_SEL`:

| setting | levels | `geneSat` | starts | seed 1: low start, high start | seed 2: low start, high start | class | mean late level | mean gap | score |
|---|---|---|---|---|---|---|---|---|---|
| c01 | 5 | 2 | 0, 3 | 3.17 (29), 3.16 (31) | 3.16 (24), 3.08 (30) | qualifies | 3.14 | 0.05 | **1.10** |
| c03 | 5 | 4 | 0, 3 | 3.08 (13), 3.06 (9, **not held**) | 3.07 (17), 3.09 (13) | dies | 3.08 | 0.02 | |
| c07 | 8 | 2 | 0, 6 | 4.36 (38), 5.65 (31) | 4.55 (33), 5.38 (36) | qualifies | 4.99 | 1.06 | 0.40 |
| c09 | 8 | 4 | 0, 5 | 4.55 (27), 4.70 (31) | 4.46 (31), 4.93 (24) | qualifies | 4.66 | 0.31 | 0.84 |

- **The candidate is c01**, the largest score among the settings that qualify. Under Amendment A's kernel c07
  had edged ahead (1.22 against 1.17); with the final kernel its low start is further from its high start at
  20,000 steps (4.4 to 4.6 against 5.4 to 5.6) and it scores 0.40. How fast the eight-level low start climbs
  varies a good deal between kernels and seeds.
- Step 2's check for c07: its neutral high start ended at 5.29 and 5.21, below its selected high start (5.65,
  5.38) on both seeds. Not two-sided; the candidate stays c01.
- c03 is classed as dying again (one run at 9 compartments in the late window, just under the bar of 10).

Item 3 (the candidate c01 with the final kernel, `runs/dropgenes/trait/screen/v3-cand-c01`) runs next, in the
order and under the fallback written in Amendment B.

### Amendment B, item 3: result. The candidate c01 with the final kernel, seeds 1 and 2

16 runs, residual 0 in all. Tables from
`experiments/dropgenes/summarize.ts runs/dropgenes/trait/screen/v3-cand-c01 --trait --calibration` (saved as
`runs/dropgenes/trait/v3-cand-c01-summary.md`). **These are the calibration figures the frozen plan rests on.**

| arm | start | seed | steps | held | late compartments | late level | sd of level among compartments | late top-level share |
|---|---|---|---|---|---|---|---|---|
| `GATED_SEL` | 0 | 1 | 200,000 | yes | 23.4 | 3.167 | 0.27 | 0.234 |
| `GATED_SEL` | 0 | 2 | 200,000 | yes | 29.0 | 3.153 | 0.24 | 0.205 |
| `GATED_SEL` | 3 | 1 | 200,000 | yes | 26.0 | 3.168 | 0.24 | 0.218 |
| `GATED_SEL` | 3 | 2 | 200,000 | yes | 26.3 | 3.169 | 0.24 | 0.217 |
| `GATED_NEU` | 0 | 1 | 200,000 | yes | 51.1 | 1.864 | 1.01 | 0.174 |
| `GATED_NEU` | 0 | 2 | 200,000 | yes | 51.5 | 2.160 | 1.19 | 0.246 |
| `GATED_NEU` | 3 | 1 | 200,000 | yes | 51.5 | 1.715 | 0.97 | 0.148 |
| `GATED_NEU` | 3 | 2 | 200,000 | yes | 51.3 | 2.350 | 1.06 | 0.277 |
| `UNGATED_SEL` | 0 | 1 | 200,000 | yes | 26.3 | 3.168 | 0.22 | 0.219 |
| `UNGATED_SEL` | 0 | 2 | 200,000 | yes | 21.9 | 3.194 | 0.23 | 0.242 |
| `UNGATED_SEL` | 3 | 1 | 200,000 | yes | 21.6 | 3.188 | 0.23 | 0.238 |
| `UNGATED_SEL` | 3 | 2 | 200,000 | yes | 23.7 | 3.164 | 0.22 | 0.212 |
| `UNGATED_NEU` | 0 | 1 | 50,000 | yes | 51.0 | 1.399 | 1.12 | 0.151 |
| `UNGATED_NEU` | 0 | 2 | 50,000 | yes | 51.5 | 2.162 | 0.95 | 0.172 |
| `UNGATED_NEU` | 3 | 1 | 50,000 | yes | 51.0 | 1.988 | 1.03 | 0.196 |
| `UNGATED_NEU` | 3 | 2 | 50,000 | yes | 51.8 | 1.888 | 1.13 | 0.168 |

Readings (two seeds; calibration only):

- **Gated, selected.** All four runs held. The two starts end 0.000 (seed 1) and 0.016 (seed 2) apart, at
  3.15 to 3.17, so the fallback did not apply. The low start was within 0.25 of its late level by step 7,000
  and 6,000. After the first 20,000 steps the level, averaged in 20,000-step stretches, stayed between 3.13 and
  3.19 in all four runs.
- **Neutral twin.** Late level 1.72 to 2.35. After the first 40,000 steps its 20,000-step averages ranged from
  1.73 to 2.54. The gated selected level is 1.30 (seed 1) and 0.80 (seed 2) above the higher neutral run of
  its seed; the rule asks for 0.4.
- **Response check, windows of the second half** (mean "between" term per 2,000 steps; windows with negative
  covariance):

| arm | low start, seed 1 | low start, seed 2 | high start, seed 1 | high start, seed 2 |
|---|---|---|---|---|
| `GATED_SEL` | -0.136 (49 of 50) | -0.121 (50 of 50) | -0.139 (50 of 50) | -0.148 (50 of 50) |
| `GATED_NEU` | -0.004 (27 of 50) | +0.016 (24 of 50) | -0.004 (22 of 50) | +0.029 (17 of 50) |
| `UNGATED_SEL` | -0.135 (49 of 50) | -0.141 (50 of 50) | -0.132 (49 of 50) | -0.129 (50 of 50) |

  The "within" term mirrors it in the selected worlds (+0.12 to +0.15).
- **Resemblance in mean level, gated selected, splits of the second half** (parent / nearest neighbour /
  unrelated): at the split 0.78 to 0.82 / 0.07 to 0.14 / -0.01 to 0.03; 500 steps later, survivors only, 0.30
  to 0.42 / 0.02 to 0.09 / -0.01 to 0.02; scored when last seen, 0.50 to 0.56 / 0.04 to 0.08 / -0.02 to 0.02.
  43 to 45% of daughters were gone by 500 steps and 3 to 4% had merged. The daughters that were gone had a
  higher level at the split (3.22) than those that lasted (3.05 to 3.06), and 3.38 to 3.39 when last seen.
- **Neutral twin, the same:** 0.93 to 0.96 at the split and 0.82 to 0.88 at 500 steps, against 0.25 to 0.33
  for the nearest neighbour and 0.09 to 0.14 for an unrelated compartment; 31 to 32% gone by 500 steps, at the
  same level as those that lasted (1.85 to 2.19 either way).
- **Ungated, selected: no runaway.** All four runs held to 200,000 steps at 3.16 to 3.19, within 0.05 of the
  gated run from the same start, with 22 to 26 compartments against 23 to 29. The response term is as negative
  as in the gated world.
- **Ungated, neutral:** held on 4 of 4 at 50,000 steps (51 to 52 compartments).

By the frozen rule's numbers these two seeds read: G yes on 2 of 2, U (runaway) no on 2 of 2, "ungated matches
gated" yes on 2 of 2, T yes on 2 of 2 (T at 50,000 steps, not the confirmation's 200,000).

**The setting is frozen at c01.** The rule's numbers stay as written before this re-run (0.25, 0.4, 3.5).

Against the first kernel's Step 3 (same setting and seeds): the selected levels are within 0.06 of what they
were; the neutral twin's late levels moved (2.58, 2.06, 2.24, 2.26 then; 1.86, 2.16, 1.72, 2.35 now), which is
within how much one neutral run wanders, so these two seeds do not show the size of the old order's lean.

### Cost, all of calibration

25 monocultures of 8,000 steps; 100 screen and check runs of 20,000 steps across the three kernels; 24 runs of
200,000 steps and 8 of 50,000 at c01 (first and final kernel); 16 first-rung runs of 1,500 steps and a few
shorter ones used to check that first-rung output is unchanged; plus a c07 candidate run stopped part-way.
Summed time inside the simulation processes: about 6.0 hours for the saved runs and about 0.3 for the stopped
one, each process on at most one core. That is slightly over the 6 core-hours allowed; a little over a third of it is the re-runs the
two kernel corrections forced. Never more than two simulations at a time. Seeds used: every ladder run is on
seed 1 or 2; the first-rung equality checks ran first-rung worlds (no ladder) on seeds 1 to 4, and the pinned
first-rung digests use seeds 1 and 3. No seed above 4 was run by this line.

### Not done (final)

- Seeds 3 and 4 were not used for any ladder run. Every calibration reading is from two seeds.
- The ungated arm was run only at c01. Whether the ungated world runs away at any other listed setting is not
  known.
- The eight settings that did not qualify in the first screen were not re-run with the final kernel; neither
  was the monoculture pre-scout.
- No setting outside the twelve listed was run. In particular a shorter ladder, where the top level's edge
  over the level below it is larger than c01's 14% (2 against 1.75), was not listed and so was not tried.
