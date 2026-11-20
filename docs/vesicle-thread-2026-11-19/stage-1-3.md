# Vesicle world, stages 1 and 3: the thread and the wild dish (2026-11-20)

## In short

- The thread (a genome particle inside the cell that solute must be near to copy, and that copies itself when it has food and no
  other thread close by) holds cells at 400,000 steps about as well as wall heredity at the same per-copy mutation rate. It is weaker
  over 1.5M steps (14, 7, 11, 14 cells against 21, 20, 20, 17) and it is not one genome per cell: cells carry about four threads,
  more at higher mutation rates. The anchored variant died out in 8 of 8 worlds at mutation 0.01 and 0.1.
- An independent check added a neutral control (the thread's byte made inert, mutation 0.1 and 1.0, four seeds): cells stayed at 19 to
  26 and the byte did not fall. So in the real arms the byte matters, its fall is selection, and the cell loss comes with it.
- The wild dish (four times the area, light in drifting patches, weather) holds 46 to 72 cells, gathered in crowds on and beside the
  lit patches, and divisions per cell are three to four times the old dish. Much of that is turnover: many daughters are small and
  dissolve.
- Decision taken on these numbers: the multi-gene genome for the next stage goes on the wall beads, not the thread. The anchored
  variant is retired.

## Rules as built

Thread (`thread`, off by default; `--thread`): a particle with two bytes (gene 0, the lipid share solute takes; gene 1, an idle marker), one
unit of matter plus a food store. It moves like solute and cannot cross a wall. A solute that passes its copy roll needs the nearest
thread within 12 units with no wall between; the new solute takes both bytes from it. A thread takes food from its grid cell (probability
0.02 scaled by food), and when it holds 6 and no other thread is within the inhibition radius on its side of the walls it splits: one
unit becomes the copy, five go to waste, each byte of the copy shifts with probability `mut`. A thread with fewer than 3 solute within 8
units decays to waste (roll 0.01 per step). Anchored variant (`--thread-anchored`): the thread rides a wall bead, and a copy anchors half
way round the ring.

Wild dish (`--wild`, composes with any heredity mode): 384 x 384 with 24 founders; waste turns to food only inside five discs of radius
48 that drift across the dish and wrap, at a rate scaled so the dish-wide mean equals uniform light (the scaling saturates at 1; the
default is below that); weather bursts one ring every 4,167 steps. Sixteen times the area was the aim; cost grew faster than area
(about 30 minutes per 400,000-step run at 4x, over four hours at 16x), so 4x was used.


Reader: `experiments/vesicle/threads.ts report` (full tables: `runs/vesicle/s1/report.md`) and `threads.ts copies` (`runs/vesicle/s1/copies.md`).
Runs: 52 runs under `runs/vesicle/s1/<arm>/s<seed>/` (seeds 1 to 4, 400,000 steps; D and E 1,500,000), none crashed, `--pinch-log`, census every 2,500 steps.
Stage 0 comparison runs: `runs/vesicle/s0/wall-mut{0.01,0.1}`. Live cell = at least 5 solute, as before.
Sanity: the D run's first 400k steps equal stage 0's wall 0.1 row for row, and E's equal A 0.1 (same seed, same rules, same table values); the frame re-runs reproduce the digests of their original runs (c1786464, e419a78f).

## Table: live cells at the end of each run (seeds 1 to 4) and the heritable byte

| arm | live at the end of the run (s1 s2 s3 s4; 400k unless the arm says 1.5M) | mean | heritable byte at the end (mean of seeds; start 128) |
|---|---|---|---|
| A free thread, mut 0 | 22 25 25 22 | 23.5 | 128 (no mutation) |
| A free thread, mut 0.01 | 21 21 21 24 | 21.8 | 125.3 |
| A free thread, mut 0.1 | 14 15 15 18 | 15.5 | 103.7 |
| A free thread, mut 1.0 | 13 10 9 8 | 10.0 | 85.0 |
| B anchored thread, mut 0.01 | 0 0 0 0 | 0 | none left |
| B anchored thread, mut 0.1 | 0 0 0 0 | 0 | none left |
| B anchored thread, mut 1.0 | 11 5 0 7 | 5.8 | 75.8, 75.2, -, 74.0 |
| C drift only (no heredity) | 33 28 30 33 | 31.0 | 128 (no heredity) |
| stage 0 wall heredity, mut 0.01 | 23 21 21 20 | 21.3 | 57.9 |
| stage 0 wall heredity, mut 0.1 | 17 18 17 18 | 17.5 | 63.5 |
| D wall, mut 0.1, 1.5M steps | 21 20 20 17 | 19.5 | 69.1 (at 1.5M) |
| E free thread, mut 0.1, 1.5M steps | 14 7 11 14 | 11.5 | 86.7 (at 1.5M) |
| F WILD dish (4x area), wall, mut 0.01 | 52 50 58 46 | 51.5 | 50.1 |
| F WILD dish, thread, mut 0.01 | 61 67 72 51 | 62.8 | 118.2 |
| F WILD dish, thread, mut 0.1 | 38 35 27 37 | 34.3 | 84.5 |

## The four questions

**(a) Mechanics: PASS.** Thread at mutation 0 holds 22, 25, 25, 22 cells at 400k (needed at least 13 in 4 of 4). Lowest census from 100k on is 16 to 17 in every seed. Threads are balanced (89 at end in seed 1; 1,871 copies, 1,788 decays). Without mutation the byte is 128 everywhere, so this arm tests the machinery only.

**(b) Robustness: PASS for the free thread at 0.01 and 0.1 at 400k steps; FAIL for the anchored thread; FAIL at 1.5M steps and at mutation 1.0.**
- Free thread, 0.01: 21, 21, 21, 24 (wall heredity 20 to 23). Free thread, 0.1: 14, 15, 15, 18 (wall 17 to 18): all four at least 13, but lower than wall by about 2 cells on average, and the lowest census after 100k was 12 in one seed.
- Mutation 1.0 (free): 13, 10, 9, 8, so only 1 of 4 reaches 13.
- 1.5M steps at 0.1: thread 14, 7, 11, 14 (2 of 4 below 13; the cell count slides from 15.5 at 400k to 11.5), wall 21, 20, 20, 17 (all hold). Wall is steadier over the long run.
- Anchored (B): all cells dead by 400k in 8 of 8 seeds at 0.01 and 0.1 (mean live 2.3 and 3.5 at 100k, 0 and 0.8 at 200k); at mutation 1.0, 11, 5, 0, 7. The better variant is the free one.
- Drift only (C) holds 28 to 33, so having a heredity rule at all costs cells; the thread costs about 10 at 0.01 (22 vs 31).
- WILD dish (4x area, 24 founders, patchy light, weather): 51.5 cells for wall at 0.01, 62.8 for thread at 0.01, 34.3 for thread at 0.1. Per 192x192 area that is 12.9, 15.7 and 8.6, against 21.3 in the old dish for wall: the wild dish holds 40 to 74 percent of that density, with weather and uneven light, and the thread at 0.1 is lowest.

**(c) Segregation: PASS for the free thread in the old dish, FAIL for anchored, borderline FAIL in the wild dish.** Daughters receiving zero threads, among pinches whose mother held at least one thread:

| arm | daughters with 0 threads | pinches where either daughter gets 0 | of daughters with at least 5 solute |
|---|---|---|---|
| A free, mut 0 | 15.2% (859/5634) | 30.5% | 13.6% |
| A free, mut 0.01 | 13.5% | 27.1% | 11.8% |
| A free, mut 0.1 | 13.4% | 26.7% | 11.7% |
| A free, mut 1.0 | 17.4% | 34.8% | 15.9% |
| B anchored, mut 0.01 | 42.4% | 83.0% | 40.1% |
| B anchored, mut 0.1 | 42.8% | 83.6% | 40.4% |
| B anchored, mut 1.0 | 44.9% | 87.4% | 42.8% |
| E free, 0.1, 1.5M | 10.3% | 20.5% | 8.8% |
| F wild, thread 0.01 | 30.0% (12,966/43,204) | 60.0% | 24.4% |
| F wild, thread 0.1 | 29.5% | 59.0% | 24.6% |

Threshold under 25%: free thread passes in every old-dish arm (10 to 17%); anchored fails everywhere (42 to 45%); the wild dish fails on all daughters (30%) and is at the line when only viable daughters (24.4 and 24.6%) are counted. By stratum: a mother with one thread leaves one daughter without by necessity (50%); two threads, 42 to 48%; three or more, 7 to 22% (free garden 7 to 11%, wild 18 to 22%).
Threads per live cell (late censuses, pooled): free 0.01: 1.3% of cells hold none, 1.1% one, 23% two, 13% three, 29% four, 33% five or more (mean 4.0); free 0.1: 0.3% none, 76% five or more (mean 6.9); free 1.0 mean 12.1; wild 0.01: 19% none, 9% one, 37% two, 13% three, 14% four, 8% five or more (mean 2.3). Cells almost never hold exactly one thread: the thread count per cell is not "one genome object", it is a small crowd, and the thread count grows with mutation rate (more cells survive on more threads).

**(d) Linkage: PASS in the narrow sense, but the test is weak; selection on the share gene is clear.**
- At mutation 0 every byte is 128 in every cell, so "gene 1 equals mother's" holds 100% of 4,775 daughters trivially. This arm cannot test linkage.
- Where bytes vary (0.01 to 1.0, free): daughter mean gene 1 on mother mean gene 1 has slope 1.00 (correlation 0.97, 0.97, 0.95), the same as gene 0 (slope 1.00; 0.98, 0.98, 0.96). Daughters' gene 1 equals the mother's exactly in 95.3% (0.01), 56.2% (0.1) and 21.6% (1.0) of daughters, tracking gene 0 (95.2%, 55.3%, 21.4%). Both bytes ride the same object so they travel together; the data are consistent with that but do not demonstrate hitchhiking: across live cells, corr(t0, t1) is -0.11, 0.21, 0.09 (free), -0.29 and -0.24 (wild), i.e. no association, as expected for independently mutating bytes. A real hitchhiking test (founders with different marker and share bytes, `--founder-gene` plus `--founder-mark`) was not run.
- How gene 0 (lipid share) moved (mean of seeds at 100k / 200k / 300k / 400k): free 0.01: 127.5, 126.9, 125.8, 125.3; free 0.1: 122.0, 113.8, 108.9, 103.7 (and 91.7 at 800k, 86.7 at 1.5M); free 1.0: 103.0, 92.1, 87.8, 85.0; anchored 1.0 (survivors): 74 to 76; wild thread 0.01: 118.2 at 400k, 0.1: 84.5. The neutral marker (gene 1) stays near 128 (104 to 138) in the same runs, while gene 0 falls in 4 of 4 seeds in the free arms at 0.1 and 1.0 and in 3 of 4 at 0.01 (seed 1 ends at 128), so the fall is selection on gene 0 and not mutation drift. Wall heredity: 57.9 (0.01), 63.5 (0.1), 69.1 at 1.5M, 50.1 in the wild dish; whole-cell winners sit in 52 to 76. The thread has not reached that band at 400k (85 at the fastest rate), moves toward it, and is still falling at 1.5M (86.7).

## Mutation matched two ways

Counts (short runs, seed 1, 100,000 steps, `threads.ts copies`): copy events of the heritable byte per pinch and expected shifts per pinch (copies x mut):

| arm | copy events per pinch | expected shifts per pinch |
|---|---|---|
| wall, mut 0.1 | 6,065 | 607 |
| wall, mut 0.01 | 3,788 | 38 |
| thread, mut 0.1 | 2.8 | 0.28 |

- Per copy (same mut): wall's 0.01 (the wall preset) and 0.1 against thread 0.01 and 0.1. On that basis the thread holds about as well at 400k (21.8 vs 21.3; 15.5 vs 17.5), but the thread has about 1,400 to 2,200 times fewer copy events per division (2.8 against 3,788 to 6,065).
- Per cell generation: each division has thousands of wall-bead copies and about three thread copies. Wall 0.1 is 607 expected byte shifts per division; no thread rate can reach it (mut is at most 1: 2.8 shifts per division at mut 1.0). Measured differently, as the change in the cell's own mean byte between mother and viable daughter: wall 0.01 mean absolute change 2.3 (rms 3.7), wall 0.1 8.7 (rms 12.9, which includes ring-sampling noise); thread 0.01 0.08, 0.1 0.9, 1.0 3.2 (rms 5.0). So the thread rate equivalent to wall 0.01 on this measure is about mut 1.0, and wall 0.1 would need larger shift sizes (mutStep) as well. At that matched rate (1.0) the thread holds 10 cells against wall 0.01's 21.3. Matched per generation, the thread loses more cells than wall does.

## Divisions per live cell per 100,000 steps

Pinches counted when both daughters have at least 5 solute, divided by mean live cells (censuses from 20k):

| arm | old dish (192x192) | WILD dish (4x) |
|---|---|---|
| wall | 1.6 (0.01), 1.6 (0.1) | 5.8 (0.01) |
| thread | 6.0 (0.01), 3.6 (0.1) | 19.4 (0.01), 15.9 (0.1) |
| drift only | 5.4 | not run |

Cells in the WILD dish: 46 to 58 (wall 0.01), 51 to 72 (thread 0.01), 27 to 38 (thread 0.1). Division is much faster per cell in the wild dish (3.6x for wall, 3.2x for thread at 0.01) because weather removes cells and the survivors split into the space and food; many are lost again, so turnover is high, not growth. The thread arm divides about 3 to 4 times as often per cell as wall does in both dishes; the extra divisions drop many daughters (24% of viable daughters get no thread in the wild dish).

## Frames (`runs/vesicle/s1/frames/`)

Seed 1, step 400,000; walls are white to pink lines (orange where stretched), solute dots coloured by its gene byte, threads rings coloured by marker byte; the dark violet wash is the lipid field.
- `thread-s1-t400000.png` (in this folder; run copy `a/s1-t400000.png`) (free thread, mut 0.01, 21 cells): about 20 cells of different shapes, several lobed or dumbbell-shaped (a cell mid-pinch, three joined at the top right), small round ones, and a few fully separate. Solute is green-turquoise (gene near 125) throughout. Small hollow turquoise rings (the threads) sit inside most cells, several per cell, and a few single rings and solute dots lie free outside the walls. Empty space between clusters is large.
- `b/s1-t400000.png` (anchored thread, mut 1.0, 11 cells): about 11 larger, rounder cells filled with blue solute (the gene has fallen to about 75, hue blue), with spread across the cell; no obvious thread rings inside most cells, only the top right cell still shows green rings and green solute, a lineage that kept the founder byte. That cell looks different from all the others. Fewer cells than the free arm, bigger, and all but one the same blue.
- `wild-thread-s1-t400000.png` (in this folder; run copies `f/s1-t200000.png` and `f/s1-t400000.png`) (WILD dish, thread 0.01, seed 1, 384x384 drawn at 4 px per unit; 24 founders at start, 61 live cells at 400k): the lit patches show as pale-olive discs (5 patches, several cut by the dish edge where they wrap round). Cells are packed tightly into a few crowds, mostly on or beside the lit discs: at 200k two dense clumps of 20 or more squeezed cells sit in the big patch at left and small groups sit in a few other patches; at 400k a larger crowd (about 30 cells, deformed against each other) lies on the patch at upper centre, another crowd runs down the left edge, one sits inside the patch at the right edge, and one at lower left, with a few single round cells in between. A large patch at the top right is empty of cells, and the right half of the dish and the lower middle are dark and empty. Solute is turquoise (gene still near 120); small thread rings are visible in many cells but are hard to count at this size. Between the crowds there are scattered free solute dots and the lipid field is a pale violet haze near cells and patches. Cells gather on or beside the lit patches, one patch holds none, and most of the dish is empty.
- 200,000-step frames are also in each folder (`a/`, `b/`; `f/` described above). Frames were produced by re-running seed 1 with `--frames`; digests match the original runs (c1786464, e419a78f, ede77907).

## Limits

- Four seeds per arm, one run per seed; 400k steps. No confidence intervals; per-seed figures shown beside means.
- "Live" means at least 5 solute. Cell lives are not individuals in the physics; thread counts per cell use point-in-polygon.
- Divisions per cell and zero-thread fractions count pinches, including small daughters that quickly dissolve; the viable columns (both daughters at least 5 solute) are given for that reason, but I did not follow daughters to see whether they survive.
- Copy-event counts come from one 100k-step run per arm, not the full runs. The "mean change of cell byte" comparison for wall includes sampling of beads; no mut-0 wall run with a pinch log exists to subtract it.
- Linkage test is weak (see (d)). Selection on gene 0 uses gene 1 as the neutral control, which assumes gene 1 is neutral in this world (stated by design, not tested here).
- Anchored arm uses tSep 0 and rInhib 18 after the first design (tSep 1) collapsed; a different design could do better. Its failure is for this design.
- The wild dish has no drift-only arm and only one area (4x); wild-wall at 0.1 was not run.

## Independent check (raw files only)

- Copy number: 3.8 threads per live cell at mutation 0, 3.4 to 7.8 at 0.1, growing with cell area. Segregation looks adequate because
  of redundancy, not because a daughter gets one faithful copy.
- Daughters with no thread mostly die: of 830 at mutation 0, 768 dissolved, 59 divided, 3 were alive at the end; median life about
  1,850 steps against 4,800 with a thread. None later held a thread in the free arm; the anchored arm leaked in 42 cases.
- Pinch rows whose thread counts do not sum (a mother's thread lying in neither daughter's outline): 8 in the free old-dish arms, 39 in the wild arms, 136 in the anchored arms, each out of thousands of rows.
- The thread itself costs cells: 22 to 25 at mutation 0 against 28 to 33 with no heredity.
- Wild dish: cells sit in lit area 46 to 53 percent of the time against 22 percent of the dish lit; 36 percent of pinches there have a
  daughter under 5 solute; up to 65 threads lie outside any ring. Pinch counts there are churn, not fitness.
- Not done: wild-dish neutral controls, why copy number grows, diversity of threads within one cell.

## After this stage (2026-11-20)

- The cost that grew faster than area was the bond hash being rebuilt after almost every bead that left a wall. With that fixed
  (results unchanged on four digest pins), 400,000 steps take about 10 minutes at 4x and about 43 minutes at 16x.
- Weather now follows the number of rings (one burst per 5,000 steps per 20 rings), which is about 2.5 times the old rate in a
  full dish. The wild wall baseline rerun under it: 44, 52, 32, 55 live cells (`runs/vesicle/s2/base-wild-wall`).
- The anchored thread was removed from the code.
- Divisions where both daughters go on to divide, per live cell per 100,000 steps (`experiments/vesicle/divisions.ts`): wall heredity
  0.60 in the old dish and 2.27 in the wild dish (2.39 under the new weather); drift only 1.31; thread 1.31 and 7.82. About a fifth to
  a quarter of pinches are productive in every arm.
