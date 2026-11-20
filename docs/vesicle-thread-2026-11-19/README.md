# Vesicle world, stage 0: a yardstick (2026-11-19)

First stage of the plan that follows `docs/vesicle-wall-genes-2026-11-19/`. It fills the missing arms of the table
(free copying, gate-only and wall heredity, each at mutation 0.01 and 0.1; four seeds, 400,000 steps, 24 runs, none crashed)
and logs every division so that daughters can be compared with mothers.

New: `--pinch-log` and `--mut` on `experiments/vesicle/run.ts` (a pure observer: same digest with it on or off, tested),
`experiments/vesicle/heritability.ts`, `experiments/vesicle/heritability-frames.ts`.

Stages 1 and 3 (the thread, the wild dish) are in `stage-1-3.md`.

## What it found

1. **Cells alive at step 400,000** (seeds 1 to 4):

| arm | mutation 0.01 | mutation 0.1 |
|---|---|---|
| free copying | 18, 18, 10, 11 | 1, 2, 4, 4 |
| gate-only | 33, 35, 33, 29 | 9, 8, 5, 9 |
| wall heredity | 23, 21, 21, 20 | 17, 18, 17, 18 |

   Wall heredity is the only arm that keeps its cells at the fast mutation rate. At the slow rate all three hold to 400,000 steps
   (the earlier 1.5M-step runs showed gate-only worlds failing later, 1 of 4 collapsing and 1 shrinking).
   Free copying at 0.01 had not been run before; it holds 10 to 18 cells here.

2. **The resemblance yardstick does not separate the arms.** In every arm a daughter's whole-cell trait at her own division is closer
   to her mother's at hers than to an unrelated cell's, by about the same margin (excess 0.4 to 0.7 by regression slope; 0.36 to 0.45
   by an independent permutation method on the raw logs, which found unrelated cells as close as the mother in 0 of 2,000 permutations
   in nearly every run). A daughter is physically a piece of her mother, wall and contents, so resemblance comes with the pinch, whatever
   the copying rule.

3. **Generation time** is about 3,400 to 6,600 steps between a cell's birth and its own division.

## What this changes

- "Daughters resemble mothers better than the control" is a poor test for a linked genome: this yardstick did not clearly separate the arms that already exist.
- What differs between arms is whether cells survive at a given mutation rate. A hypothesis, not tested here: in the free and gate
  arms the bytes copy many times inside a cell per cell generation, so variants that help themselves at the cell's cost can arise and
  spread within one cell. The next stage is therefore judged on cells holding at both mutation rates as well as the wall arm does, on
  a genome of more than one gene arriving intact in daughters, and on how many daughters get no genome at all.

## Limits

- No drift-only arm with the same logging was run, so the excess shows inheritance of content, not that the variation does anything.
- About half of all daughters dissolve or burst before dividing; pairs describe the cells that divide.
- Pairs are not independent (a cell is a daughter in one pair and a mother in the next); no confidence intervals. Arm ordering on the
  yardstick is inside the seed spread.
- Slopes above 1 in the free and gate arms are not fidelity above 100 percent; the cause was not tested.
- Frames (seed 1, step 150,000, coloured by byte): `gate-mut0.01-s1-t150000-gene.png`, `wall-mut0.01-s1-t150000-gene.png`.

## Method

Each pinch row gives the mother's whole-cell trait just before the pinch (solute gene cell mean for free and gate arms, wall gene
cell mean for the wall arm) and the ids of the two daughters. A daughter's trait is the same statistic in the row where she pinches
herself (matched life stage). Heritability is the least-squares slope of daughter trait on mother trait, pooled over the four seeds,
with the correlation beside it. The baseline pairs each daughter with an unrelated cell instead: the divided cell whose own pinch step
is nearest the mother's pinch step (ties to the earlier step; among cells that divided at the same step, the higher id on the earlier side and the lower id on the later side) that has a different founder root, found by following
parents up the log, so it shares no ancestor with the mother. Excess = heritability minus that baseline slope.
Window: both pinches of a pair must fall at or before step 200,000. The two 0.1 arms had essentially stopped dividing by then
(their full-log pair counts differ by at most 4 from the window counts), and the two seeds I checked (1 and 3) held 9 or more cells at 200,000 in every arm; the full-log table is below for comparison. Daughters that never pinch inside the window are excluded and counted.
generationSteps = median steps from a cell's birth pinch to its own pinch.

## Result, window to step 200,000

| arm | seeds | pairs | excluded daughters | heritability (slope) | corr | baseline slope (strict) | excess | per-seed excess | generation (steps) |
|---|---|---|---|---|---|---|---|---|---|
| free copying, mut 0.01 | 4 | 1168 | 1216 (1161 ended) | 1.04 | 0.96 | 0.36 | 0.68 | 0.88, 0.67, 0.88, 0.50 | 5187.5 |
| free copying, mut 0.1 | 4 | 451 | 499 (488 ended) | 1.24 | 0.78 | 0.59 | 0.65 | 0.37, 0.23, 1.28, 0.58 | 3432 |
| gate-only, mut 0.01 | 4 | 1673 | 1721 (1652 ended) | 1.02 | 0.98 | 0.53 | 0.49 | 0.47, 0.62, 0.62, 0.82 | 4097 |
| gate-only, mut 0.1 | 4 | 617 | 665 (635 ended) | 1.09 | 0.92 | 0.67 | 0.42 | 0.42, 0.78, -0.04, 0.33 | 4343 |
| wall heredity, mut 0.01 | 4 | 826 | 874 (821 ended) | 1.00 | 0.91 | 0.53 | 0.46 | 0.43, 0.41, 0.66, 0.36 | 4241 |
| wall heredity, mut 0.1 | 4 | 493 | 541 (501 ended) | 0.68 | 0.64 | 0.26 | 0.42 | 0.41, 0.52, 0.38, 0.33 | 4391 |

## Same, whole log (400,000 steps)

| arm | pairs | heritability | baseline strict | excess | excess lenient |
|---|---|---|---|---|---|
| free copying, mut 0.01 | 1306 | 1.08 | 0.54 | 0.55 | 0.50 |
| free copying, mut 0.1 | 451 | 1.24 | 0.59 | 0.65 | 0.64 |
| gate-only, mut 0.01 | 2235 | 1.03 | 0.63 | 0.40 | 0.35 |
| gate-only, mut 0.1 | 621 | 1.10 | 0.64 | 0.46 | 0.40 |
| wall heredity, mut 0.01 | 900 | 0.97 | 0.62 | 0.35 | 0.34 |
| wall heredity, mut 0.1 | 693 | 0.67 | 0.25 | 0.43 | 0.44 |

