# Vesicle world, stage 2: jobs for genes (2026-11-20)

## In short

- Each wall bead now carries four linked bytes (lipid share, marker, harvest, digest). With `--jobs` the free recycling is off: waste
  becomes food only at a bead with a harvest byte, where light falls, and loose lipid becomes food only at a bead with a digest byte.
- **The stop condition fired: one profile is the majority in 8 of 8 mixed-founder worlds** (7 of 8 by the stricter takeover threshold; the eighth is still moving), whatever the founders: a strong harvest byte with a small
  digest byte (about 175 and 18). No division of labour appeared. The typical live cell does both jobs in about equal unit counts (median digest fraction 0.40 to 0.53; a few cells are lopsided).
- Selection on the job bytes is real: neutral twins keep the bytes mid-range, and a symmetric start (128, 128) moves the same way in
  4 of 4.
- Both jobs are needed at dish level: pure harvesters with no mutation die in under 10,000 steps (matter piles up as loose lipid),
  and in 1 of 4 worlds even with mutation.
- Why no roles, as far as these runs show: a job is limited by what there is to convert, not by the byte, so a small digest byte is
  enough and the shared budget never bites. This is a reading, not a tested claim.
- Frames: `jobs-16x-s1-t050000.png` (16x dish, founders still distinct: colonies of different solute colour) and
  `jobs-16x-s1-t400000.png` (one hue).

## Rules as built

Genome: wall beads carry wgene, wmark, wh, wd; a new bead takes all four from one evenly picked neighbour, each then through the
mutation step. No rule reads wh or wd for copying, insertion, desorption, springs or pinching. Budget: if wh + wd is over 255 both
are scaled to sum 255. Activity is the square of the scaled byte over 255. Each step, each bead acts on its grid cell: harvest moves
waste to food (expected count waste x 0.01 x activity, 0.04 in the wild dish, stochastic rounding, only in lit cells); digest moves
loose lipid to food (0.35 x activity, light not needed). Enzyme draws use their own random stream. With jobs on, the light rule and
the lipid decay rule are not read. `--jobs-inert` carries and mutates the same genome with the enzymes silent and the free rules on.


Script: `experiments/vesicle/jobs.ts` (modes `roles`, `track`, `light`, `divisions`, `linkage`). Data: `runs/vesicle/s2/<arm>/s<seed>/`, linkage re-runs in `runs/vesicle/s2/linkage/`, frames in `runs/vesicle/s2/frames/`. 33 runs, 400,000 steps each, none crashed. Kernel untouched; typecheck clean; `vesicle-model.test.ts` passes (71 tests).

## Table (400k steps, seeds 1-4)

| arm | what | live cells at 400k | mean live (census 20k on) | bead-mean h / d at 400k | productive pinches per live cell per 100k | note |
|---|---|---|---|---|---|---|
| M | pure harvesters, mut 0 | 0,0,0,0 | 0 | - | - | all dead by 7.5k-10k steps |
| E1 | pure harvesters, mut 0.1 | 22,21,24,0 | 16.2 | 160-169 / 18-21 | .94 (3 live seeds) | seed 4 dead by 20k |
| E2 | mixed founders, mut 0.1 | 23,24,24,22 | 22.3 | 174-182 / 17-19 | .76 | |
| N | E2 neutral twin | 21,18,17,18 | 19.0 | 88-106 / 94-134 | .59 | drift |
| N-mut0 | neutral twin, mut 0 | 27,26,29,26 | 26.5 | 42-147 / 108-213 | 2.11 | founder triples stay |
| W1 | wild, mixed founders | 47,46,51,46 | 36.2 | 140-187 / 19-22 | 1.93 | |
| W2 | W1 neutral twin | 52,46,57,53 | 52.3 | 78-115 / 65-103 | 2.15 | |
| W3 | wild, generalist founders 128,128 | 53,50,38,40 | 33.6 | 168-205 / 17-21 | 1.54 | |
| X | wild 16x, mixed, one seed | 73 | 100.9 | 164.8 / 20.4 | 2.21 | 3,146 pinches, 39 min |
| baseline | old dish, wall heredity mut 0.1 (`s0/wall-mut0.1`) | 17,18,17,18 | 19.0 | - | .60 | no jobs |
| baseline | wild wall (`s2/base-wild-wall`, mut 0.01) | 44,52,32,55 | 59.5 | - | 2.39 | no jobs; mutation differs from W arms (0.1), so not a clean comparison |

Per-seed values are in the logs and in `roles-*.json`.

## Answers

**(a) Mechanics: FAIL.** All-harvester worlds at mutation 0 (M): 0 of 4 seeds hold 13 live cells (all extinct by step 7,500-10,000; the dishes freeze with about 4,400-4,800 loose lipid, food 900-1,250, waste about 20). With mutation 0.1 (E1) three seeds hold (21-24) and one dies by 20k. Where cells survive, the dish levels off. Means 200-300k to 300-400k for E1/E2 survivors: food 1,550-1,730 flat (all within 4%), waste 430-675 to 500-625, free lipid 880-1,250 to 890-1,190 (largest change E2 s2, 1,177 to 894). Nothing runs down and nothing fills with loose lipid in the surviving worlds. In the wild arms W1/W3, waste creeps up in 7 of 8 seeds (W1 +10% to +42% in three of four) while food and free lipid stay flat: waste builds up in the dark. Harvests and digests per 100k stay at about 80k each (E2) or about 200-260k and 200-340k (W1).

**(b) Roles by what cells do: FAIL for E1, E2, W1, W3 and the showcase.** Method: a live cell (solute at least 5, at a cells.tsv sweep) is credited with its own id plus every ancestor id, tally rows stamped in the last 100k steps (cells rows plus the pinch/end rows, so nothing is lost; checked: tallies summed over the window equal the census totals exactly, W1 s1 241,608 / 281,522). A mother's work is credited in full to both daughters' lineages. f = digests / (harvests + digests); f below 0.25 harvester, above 0.75 digester; converting means at least 20 units in the window (no cell sits near that line: 10th percentile of conversions is 4,400-34,000). Grid checked at 300k, 325k, 350k, 375k, 400k (X: 300k, 350k, 400k).
Cells at the end (harvesters / mixed / digesters of converting cells):
- E1: 0/21/1, 0/20/1, 0/23/1 (seed 4 extinct)
- E2: 0/23/0, 1/21/2, 0/21/3, 0/21/1
- W1: 0/47/0, 0/46/0, 0/48/3, 0/45/1
- W3: 0/53/0, 0/50/0, 0/38/0, 0/40/0
- X: 0/73/0
Median f is 0.40-0.53 everywhere. The typical live cell does both jobs in nearly equal unit counts (a few are lopsided: E1 seed 2 cell 446 has 298 harvests against 4,389 digests). A likely reason, not tested, is that a job is limited by what there is to convert (waste, loose lipid), not by the byte. The roles never reach 20% each at the end, so "whole last 100k" fails too (digester share by grid: 0-19%). Byte classes tell the same story (f from the shared-budget bytes; mean over beads): harvest-leaning cells 77-100% in E1/E2 (E1 s1 17 of 22), 87-100% in W1/W3, 64 of 73 in X; digest-leaning at most 1 cell per world (0 in all but E1 s1). The unit f follows the bytes only weakly (correlation over live cells 0.08-0.75, mostly 0.2-0.5).
Consumers (almost no conversions): none among live cells at the end in any world (0 of all, tau 20; any tau up to about 2,000 gives the same; one live cell in E2 seed 4 has 2,107 credited conversions). In the forward view (cells live at 300k with all their descendants over the last 100k), a few lineages convert almost nothing (W1 1-8 of 21-33, X 9 of 77, E arms 0-1) and none of them has a live descendant at 400k: they do not persist.
A clear thing the forward view does show: lineages that mostly digested (f above 0.75; 17, 10, 13, 14 in W1 seeds 1-4; 34 in X; 12-16 in W3) have no live descendant at 400k in any wild world (0 of about 160). In E2 1-2 of 2-4 do. Those are probably lineages sitting outside light (harvest needs light), so this is a position effect we have not separated from bytes. The 3 to 9 clades per seed that leave descendants are the mixed ones.
Neutral twins, byte classes by drift (same f classes from the bytes; harvest-leaning / mixed / digest-leaning at the end): N 1-3 / 10-16 / 1-6 of 17-21 cells; W2 7-18 / 29-39 / 5-8 of 46-57. So all three byte classes coexist by drift, but never with both 20% or more, and not for the whole window (4 of 4 seeds, N and W2, fail the two-role rule). With mutation 0 (N-mut0, founder bytes frozen) drift does hold two byte roles at 20% each through the whole last 100k in 3 of 4 seeds (s1-s3), and digesters dominate seed 4 (20 of 26). Distinct four-byte profiles at 400k in N at mut 0.1: 389-420; in N-mut0 exactly 3.

**(c) Linkage.** Re-ran N and N-mut0 (all 8 final digests equal the recorded ones: d4786aa4, 5b9d1a62, fd7b65fb, e5bbcd8a at mut 0.1; a46cd742, fb3d1be1, 4fc2c3af, e20a7e82 at mut 0), scanning every bead every 2,500 steps.
- mut 0, distinct founder triples (wgene 128, marker 11/22/33, (h,d) = 255,0 / 0,255 / 128,128): 0 beads off every founder triple in 353,329 bead-scans (87,333-90,451 per seed, 4 seeds); all three triples are present at every scan in every seed; and not one live cell ever holds more than one triple (0 of 16,984 live-cell scans). So triples stay intact and cells stay pure. That is guaranteed by copying all four bytes from one neighbour; it is a check that nothing else breaks it, not a test of selection.
- mut 0.1: correlation across live cells between ring-mean marker and ring-mean h at 400k: +0.14, -0.24, +0.38, +0.20; mean over scans 300-400k: +0.33, -0.41, +0.42, +0.33 (bead level at 400k: +0.09, -0.34, +0.31, +0.15). The sign flips between seeds because the founders' markers and h are not monotone (11 to 255, 22 to 0, 33 to 128), so Pearson is a poor yardstick. The sign-free measure (share of the variance of h that marker class explains, class = nearest founder marker): cells 0.08-0.20 (mean of 300-400k scans), beads 0.04-0.13. Linkage is weak and erodes: all four bytes shift independently, so the markers and job bytes come apart. Marker is a poor stand-in for job after a few hundred thousand steps at this mutation rate.

**(d) Stop condition: yes. One profile is the majority in 8 of 8, and passes the takeover threshold in 7 of 8.** It is the same class every time: harvest-heavy with a small digest byte (bead-mean h about 175, d about 18). E2: end h/d 178.3/19.2, 174.3/17.2, 173.8/19.2, 181.8/16.9; 88-96% of live cells harvest-leaning by bytes. W1: 186.8/18.9, 180.7/21.5, 172.6/20.8, 140.4/21.2 (seed 4 lowest, still 40 of 46 harvest-leaning). Takeover time, defined as the step from which bead-mean h stays above 150 and d below 50 to the end: E2 185k, 57.5k, 12.5k, 7.5k; W1 225k, 15k, 140k, never (seed 4 sat at 128 at 300k and 140 at 400k). The first 2,500 steps are different: E2 s1 digests 3,469 units against 218 harvested, then the digest founders are pushed out. Per 100k (E2, harvests / digests): 0-100k 35-85k / 132-136k; 300-400k 78-92k / 82-102k. W1 (harvests / digests): 0-100k 127-155k / 281-330k; 300-400k 178-242k / 200-282k. The digest byte does not go to zero: it holds about 17-22 (neutral twins sit at 65-134). That could be a floor from mutation clamped at 0, or selection against more digest; we did not tell them apart. W3 (generalist founders 128,128) moved to h 168-205 / d 17-21 in 4 of 4, which shows a real drift in the harvest direction from a symmetric start, not just survival of harvester founders.

**Live cells and divisions against baselines.** E2 ends with 22-24 live cells against 17-18 in the no-jobs old dish and 17-21 in its neutral twin; productive pinches per live cell per 100k 0.76 against 0.60 and 0.59. In the wild dish the jobs arms are not ahead: W1 mean live 36.2 against 52.3 (twin) and 59.5 (no-jobs wild baseline, mut 0.01); end counts overlap (46-51 against 46-57). Productive share of pinches is 26-30% in all arms except N-mut0 (22-24%).

**Light (wild).** Lit share of the dish is 22.4%. Cell centroids sit in light: harvest-leaning cells 48% (W1), 44% (W3), 45% (X); the neutral twin W2 is 45% for all three classes. So cells gather near light about twice as much as chance, but the neutral twin does the same, so it is a feature of the dish and not something jobs added. Digest-leaning cells are too few to say anything (W1 1 of 29, W3 6 of 11, X none).

## Frames (looked at)

`runs/vesicle/s2/frames/`: E2 s1 at 400k, W1 s1 at 200k and 400k, and X s1 at 0..400k every 50k (`X/`). Re-rendered frames reproduce the original digests.
- E2 s1, 400k: about 23 cells packed in the top left of a no-light dish. Walls are all green to lime, a couple with an orange rim (higher digest byte); nothing magenta or red. Solute (lime dots) is evenly spread in each cell.
- W1 s1, 200k (a low point, 17 live): one crowded colony at the left edge next to a light patch, others spread as small green rings; two or three red-brown walls inside the colony; no magenta. Solute in the colony is pink (one founder family).
- W1 s1, 400k: a much larger colony (47 cells) of tangled, elongated green rings with a few yellow-green and olive ones, mostly dark of the light patches (one patch overlaps its top); small round green cells at its edge; loose solute scattered below.
- X, 50k: many colours, a magenta solute colony at lower right with green walls, a few pink/orange/red small rings scattered. 200k: almost all green; three crowded green colonies near the dish edges plus small round rings. 400k: green again, one dense colony with convoluted rings centre-right, two small colonies top right, one yellow ring sitting in a light patch at the bottom. Most colonies are in the dark between patches.
The pictures agree with the numbers: by the end the walls are one hue.

## Reading

When pure harvesters are left alone at mutation zero they die in under 10,000 steps (loose lipid piles up with no sink); a little mutation, or a digester founder, rescues them. Starting from mixed founders (harvesters, digesters, half-and-half), the dish settles in every seed on the same profile: strong harvest byte with a small digest byte, and drops the digester within a few thousand to a couple of hundred thousand steps. It does this faster and more consistently than drift does in the neutral twins, and a symmetric start (W3) moves the same way, so selection is acting on the job bytes. But no division of labour appeared: by what cells do, every cell harvests and digests about equally, because both jobs are limited by supply and a small digest byte is enough. There are no stable harvester cells beside digester cells and no persistent consumers. Whether the digest byte is held low by selection or kept at a floor by mutation is open. The marker is a weak stand-in for the job byte once mutation is on, which is what a later stage needs to know.

## Limits

- Roles are computed per lineage (ancestors credited in full, per-ring conversions); a cell's f depends on position (light, loose lipid) as well as bytes, so the f-based roles measure what happens in the cell's neighbourhood, not only its genes. The wild position effect is not separated from byte effects.
- The 20% rules and tau 20 are mine, fixed before looking at the results but not tested for sensitivity beyond tau up to about 4,000.
- N-mut0 is the only mut 0 world with mixed founders; there is no jobs arm at mut 0 with mixed founders, so "two roles by drift at mut 0" is not a like-for-like contrast with E2/W1 (mut 0.1).
- The wild no-jobs baseline has mutation 0.01, the W arms 0.1. Light-position analysis uses cell centroids (cells.tsv), not beads.
- X is one seed; its census, cells and pinch tables only have rows every 50k (frames are written at each census step), so its role grid has 3 points.
- "Takeover" thresholds (h above 150, d below 50) are my choice. The d-byte floor (17-22) vs mutation clamp is not tested.
- Linkage correlation is across 17-21 cells per scan; scans are autocorrelated, so the seed-to-seed spread is the honest error bar.

## Independent check (raw files only)

- Credits to cell ids sum to the dish totals in all 16 jobs runs.
- Mixed founders end as one clade in 6 of 8 worlds (two clades in 1). The founder types do convert differently for the first 100,000
  steps (the digester clade 91 to 100 percent digest), then the digester clades shrink to 1 or 2 cells and go, or their digest byte
  falls to about 22.
- Bytes predict conversions poorly: the median cell's digest byte is about 8 percent of its budget, yet it takes 47 to 54 percent of
  its conversions from digest (55 to 70 in the wild dish). A histogram of per-cell conversions in the wild dish shows two modes that
  are position (dark against lit), not genotype.
- In the wild dish the jobs arms hold no more cells than their neutral twin; in the old dish E2 holds slightly more (mean 22.3 against 19.0). Jobs arms carry 2 to 3.9 times the loose lipid. The wild dish is still changing at
  400,000 steps (cells rising, lowest census 2 cells in one world), so wild numbers describe a transient.
- Not done: a pure-digester control in the wild dish; controls blocking one job at several mutation rates.

## Follow-up: is it the tuning? (2026-11-20)

At the winning bytes (about 175 and 18) the per-unit rates are about 0.0047 for harvest and 0.0017 for digest, because the digest
rate constant (0.35) is 35 times the harvest one (0.01). So a small digest byte suffices by construction. Sweep, same mixed founders,
mutation 0.1, old dish, 400,000 steps, four seeds, no code change (`runs/vesicle/s2b/`):

| digest rate | live cells at 400k | bead-mean harvest / digest byte | founder clades left |
|---|---|---|---|
| 0.35 (stage 2) | 23, 24, 24, 22 | 174-182 / 17-19 | 1 in most |
| 0.1 | 20, 30, 22, 24 | 156-183 / 27-30 | 2, 1, 1, 1 |
| 0.03 | 31, 30, 28, 31 | 168-176 / 37-48 | 1, 1, 1, 1 |
| 0.01 | 0, 28, 33, 0 | 147, 150 / 69, 70 | 0, 1, 1, 0 |

The digest byte rises as its rate falls (18, 28, 43, 70), and each surviving world is still one clade with one mixed profile. So the
single generalist is not an accident of the tuning over this range; the gene adjusts instead. Per-cell conversions were not analysed
for these runs.
