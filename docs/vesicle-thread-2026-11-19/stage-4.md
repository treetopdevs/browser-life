# Vesicle world, stage 4: bodies, first rung (ties) (2026-11-20)

## In short

- A fifth linked wall byte, glue, now rides with the other wall genes. When a cell divides, the two daughters stay joined by a
  spring (a tie) with probability glue / 255. Clusters are found by walking ties and are never stored in the physics.
- **Ties work as a mechanism.** With glue fixed at 255 the four worlds hold 36 to 58 live cells at 400k, about two thirds of live
  cells sit in a cluster, and the largest cluster seen in a run is 12 to 16 cells.
- **The stop condition did not fire.** The glue byte never falls near zero in any arm (lowest bead mean after 200k: 54).
- **Selection on glue is not shown.** A twin that carries the byte but never ties forgets its start value (0, 64 or 255) and
  settles around 115 to 125. The working arms end between 106 and 137 (last-200k arm means: T 106, R0 122, T255 130, R 137), and
  none can be told from that drift; this does not show the levels are equal. The refuge arm started at 64 sits highest and is the
  only arm with a positive cell-level slope in 4 of 4 seeds, but the refuge arm started at 0 does not repeat it, and four
  seeds cannot separate either from drift.
- **No cluster life cycle.** Clusters are patches of one family held together until a member dies. They mostly shed single cells.
  The analyst and the skeptic both decline to call this cluster reproduction.
- Frames: `ties-16x-s1-t400000.png` (16x dish, ties + refuge, 238 live cells; a coloured outline is one cluster, grey is a cell
  with no tie, short white segments are ties) and `ties-refuge-s1-t1000000.png` (4x dish, refuge arm, seed 1 at 1M).

## Rules as built

Option `ties` (needs `wallGenes`; preset `TIES`; CLI `--ties`; composes with `--wild`; free light on, jobs off). Off by default; off
leaves every earlier pin untouched.

- **Glue byte.** `wglue` per wall bead, copied from the same neighbour as the other wall bytes and then through the same mutation
  step. Glue never influences which neighbour is copied, insertion, desorption, springs or pinching.
- **Forming.** After a pinch, one number is drawn from a random stream used only for this. With probability glue / 255 (the byte
  of the bead that closed the neck) a tie forms between the nearest free pair of neck beads, one on each daughter. A bead holds at
  most one tie. If no pair is free, none forms (`tieBlocked`).
- **The tie.** A spring between beads of two different rings: rest length 2, stiffness 0.1, applied once per step in its own pass.
  It carries no matter and is not in the bond hash, so solute, crossing checks and pressure never see it.
- **Ending.** A tie ends when it stretches past 6, when either ring ends, or when its bead desorbs and neither neighbour is free.
  If a neighbour is free the tie hops to it. At a pinch each tie stays with its bead.
- **Inert twin** (`--ties-inert`): carries and mutates glue, never forms a tie.
- **Refuge** (`--refuge [P]`, runner side, default 0.8): when the weather picks a ring that holds at least one tie, it is spared
  with probability P and the pick is wasted. It stands in for a grazer that takes single cells more easily. It is an environmental
  factor added by hand, not something the cells built.
- **Observer.** Pure: clusters by walking ties; census columns for ties, cluster sizes, glue mean and cluster share; `ties.tsv`
  events (form, end, split with piece sizes); `cells.tsv` gains glue, ties, cluster size and handle. `--founder-glue`, page worlds
  "ties" and "wild ties", `--colour cluster`.
- **Pin.** TIES garden, seed 1, founder glue 255, 2000 steps: `ccb1eef3`.

Sol 6.1 High reviewed the kernel before the runs: no P1; one P2 (the public `addTie` accepted two beads of one ring), fixed with a
guard and a check. Tests: 90 pass in `vesicle-model.test.ts` (the 71 earlier ones unchanged).

## Runs

Wild dish (4x), wall heredity, seeds 1 to 4, census every 5,000 steps. All finished without a crash.

| arm | what | steps | live cells at end | glue, mean of last 200k (per seed) | share of live cells in a cluster (200k on) |
|---|---|---|---|---|---|
| M | ties, glue 255, mutation 0 | 400k | 36, 55, 58, 54 | 255 (fixed) | 0.68 |
| T | ties, start 64, mutation 0.1 | 1M | 49, 44, 34, 42 | 101, 86, 150, 86 | 0.32 |
| I | inert twin, start 64 | 1M | 53, 45, 48, 45 | 121, 121, 106, 113 | 0 |
| R | ties + refuge, start 64 | 1M | 61, 59, 52, 62 | 138, 115, 156, 139 | 0.46 |
| R0 | ties + refuge, start 0 | 1M | 49, 51, 41, 45 | 125, 118, 111, 134 | 0.39 |
| T255 | ties, start 255 | 1M | 45, 35, 52, 47 | 118, 164, 132, 107 | 0.40 |
| X | 16x dish, ties + refuge, start 64 | 400k | 238 | 139 at the end | 0.49 at the end |

Added after the first run list: inert twins started at 0 (4 seeds) and at 255 (3 seeds). Late in the run their glue
trajectories become the same as arm I's, seed for seed (from about 400k for most; the 255 twin on seed 1 only from 715k). So the start value is forgotten, and "rose from 0" in R0 and "fell from
255" in T255 are that same relaxation, not selection.

## Answers to the questions fixed before the runs

**(a) Do cells hold and clusters form with glue high? Yes, with one miss by the letter.** Live cells at 400k are at least 13 in 4
of 4. Clusters of three or more cells are present at every census after 100k in seeds 1 to 3. Seed 4 misses two censuses of 60,
during a dip to 13 to 21 live cells. The bar was 4 of 4, so this is 3 of 4 by the wording.

**(b) Does glue move away from the inert twin the same way in 3 of 4 seeds? Not in a way that can be trusted.** Last-200k glue minus
the same-seed twin: T 1 up, 3 down (mean -10); R 3 up, 1 down (+22); R0 3 up, 1 down (+7); T255 2 and 2 (+15). The rule is met by
T, R and R0, but in opposite directions, and the signs change with the window. Three of four one way happens by chance about 62%
of the time. The spread between seeds within an arm (sd 10 for R0, 17 to 30 for T, R and T255) is larger than the gaps to the twin (7 to
22). The same-seed pairing is also loose: a working run diverges from its twin at the first tie.

**(c) Do clusters shed pieces that regrow into clusters? Weakly; mostly they clump and fall apart.**

- 98 to 99.9% of ties end because a ring ends. Ties almost never stretch or desorb apart, so a cluster lasts until a member dies.
- 83 to 89% of shed pieces are single cells. Most splits are a tied cell dividing without a new tie, which frees one daughter.
- Of cluster lineages that reach three cells, 66 to 84% started from one cell that divided and stayed tied (counting lineages
  first seen already at three or more; `clusters.ts` leaves those out and prints 67 to 89%).
- Some lineages go through repeated grow-then-split rounds (14 to 46 lineages per run with two or more; at most 4 to 8 rounds in a run).
- By the skeptic's stricter measure, a cluster of five or more leaves two or more offspring clusters of three or more in about 8
  to 13% of cases after 20k steps, and 2 to 4% after 50k.
- Median cluster lifetime is about 10,000 steps (two censuses), so lifetimes are floored by the census interval.

**(d) Stop condition (glue near zero in every ties arm without the refuge): did not fire.** After the first 20k steps, bead-mean glue is under 16 in 0 of 197 censuses in every ties run. (R0 starts at 0, so its first 1 to 2
censuses are under 16.)

## Independent check

The skeptic recomputed from the raw logs without reading the analyst's note or `clusters.ts`.

- **Ledger exact.** In all 20 ties runs, ties formed minus ties ended equals ties standing, and the event rows match the census
  counters. Three hand-traced histories match the logs.
- **Ties hold sisters together.** Tied sisters stay about 16 to 17 apart through age 20k; untied and inert sisters drift from 17
  to 25 to 28.
- **Cell-level selection on glue** (slope of relative 30k-step descendant count on standardised ring glue, per seed): inert -0.014 to 0.059; T mean
  0.001; T255 0.000; R0 -0.014; R 0.053, positive in 4 of 4 seeds.
- **Its own control** (founders alternating glue 0 and 255, mutation 0, 500k steps, 3 seeds): share of live cells in a glue-255
  family from 200k on is 0.02, 0.91, 0.87 with no ties and 0.56, 0.81, 1.00 with ties + refuge (counting all rings; with the live-cell cutoff 0.03, 0.91,
  0.86 and 0.54, 0.80, 1.00). It leans the same way as R and
  sits inside drift.
- **What the refuge does.** Wound hazard per 5,000 steps is about 0.04 for an untied ring and 0.01 for a tied ring under the
  refuge; without the refuge the two are equal (0.039 and 0.038). The refuge spares a ring with a single tie, so a pair is as
  safe as a large cluster. Whatever benefit exists goes to cells that carry a tie, not to clusters.
- **Why selection may be invisible here.** Cells born with a tie leave about 8% more descendants after 30k steps than cells born
  without (0.79 against 0.73). This is an observed difference, not a measured effect of the tie. If it were all due to the tie,
  the skeptic estimates a slope on glue of about 0.01 to 0.02, the size of the noise.
- **One family per dish.** Ties form only between sisters, so every cluster is one family by construction (0 of 391 early
  clusters mix founders). By the skeptic's count only 1 to 2 founder families are alive in the last 200k steps, the inert twin included; the review
  found exceptions (R0 seed 1 keeps 3 to 4). Either way there is little for selection between clusters to work on.

## Limits

- Four seeds per arm, three for the skeptic's control.
- Tied cells divide about 1.7 times as often as single cells in the same world (1.2 to 1.7 at equal age), but ties form only
  just after a division and no arm ties cells at random, so this is not the causal effect of a tie.
- The refuge arms hold slightly more cells (about 50 against 45 to 49), which changes the dish as well as the byte.
- Glue mean is per bead and includes beads of dying rings. Selection slopes use the ring mean; the tie draw reads one bead.
- Arm M has no mutation and no twin; its division rate (8.4 productive pinches per live cell per 100k against about 1.8 in the 1M
  arms) is not comparable with them.
- No arm tests a benefit that grows with cluster size, a cost of being single other than the refuge, or ties between non-sisters.

Scripts: `experiments/vesicle/clusters.ts` (streaming; `node experiments/vesicle/clusters.ts runs/vesicle/s4 --json clusters.json`).
Data: `runs/vesicle/s4/<arm>/s<seed>/`, the skeptic's work in `runs/vesicle/s4/skeptic/`, frames in `runs/vesicle/s4/frames/` and
`runs/vesicle/s4/show16/`.
