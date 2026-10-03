# Sandbox: heritable shape and declared cells

Exploratory, not registered. jj workspace `cells` (`/Users/nicholas/develop/browser-life-cells`),
bookmark `sandbox/cells`, one WIP commit on top of `sandbox/ownership`. Nothing here is landed,
pushed or frozen, and `docs/plan.md` is not edited. Continues `docs/sandbox-ownership.md`.

Two ideas from the user (2026-10-03), built as optional rule keys that leave every existing config
and golden pin unchanged:

1. **Make the shape heritable.** Every preset shares one ring kernel of radius 9, and a genome can
   tune only the two numbers of the growth function on top of it. Shape is almost not heritable,
   so evolution has been changing metabolism while every world stays the same lattice of dots.
2. **Declare a cell, keep "never declared" for organisms made of cells.** The plan's north star
   asks for individuals, reproduction and a major transition without being told to. Declaring the
   cell (a boundary and a division rule) moves the emergent claim up one level: the major
   transition would still be a result, while the first two items become assumptions.

## A. Heritable kernel shape (`shapeReach`)

**Rule.** `buildShapeKernel(kernelRadius, shapeReach)` tags the RULE_VERSION 1 taps, in their
original order, with a ring: 0 inside half the kernel radius, 1 outside it. When
`shapeReach > kernelRadius` a far shell (ring 2) is appended from the kernel radius out to the
reach, with the same polynomial profile across its own width. Bytes 1 to 3 of a genome's PARAM1
(always zero until now; byte 0 is the motility gain) are signed offsets from the neutral ring
weights (64, 64, 0). Weights are floored at 0, so the near rings span 0 to 191 and the far ring 0
to 127. A cell's kernel density is the weighted mean of its genome's ring means
(`shapeDensity`): `u = sum_k w_k * floor(conv_k * 256 / sum_k) / sum_k w_k`, then scaled as
before. With neutral weights the code takes RULE_VERSION 1's `floor(conv / sum)` exactly, so
with mutation off a world whose genomes all have zero ring bytes is RULE_VERSION 1 state for
state. With mutation on, the extra slots change which slot each mutation draw selects, so a
history parts from the control's at its first mutation and seeds are not paired. Mutation gains
one slot per ring (two or three slots after the 163 existing ones), with offsets clamped to
[-64, 127] for the near rings and [0, 127] for the far ring. Like mu and sigma, the weights travel
with the matter through the transport lottery.

Bounds: a ring mean is below 2^22 (mass is capped at 16383), the weights sum to at most 509, so
the weighted sum stays below 2^31. Ring sums stay below 2^24 for every allowed radius.

**Gates passed.** `tsc` clean. The 16 earlier golden pins are unchanged and two cases are added
(`shape-far` on 2x2-blocked affinity with a far ring, `shape-near` without one; both start from
founders planted with ring offsets that reach every branch of `shapeDensity`, and run with
mutation). GPU equals CPU on all 19 cases (the 19th, `injury-extremes`, answers the injury
review: wounds at the arithmetic bounds and across tiles). `shapeReach` needs `kernelRadius` of
at least 3, so no ring is empty.
`packages/sim-ref/test/shape.test.ts`: validation, the kernel partition, `shapeDensity` against a
BigInt reference over random inputs and at the extremes, genome round trips, mutation slots and
clamps, state-for-state equality with RULE_VERSION 1 while ring bytes are zero, and conservation
with the ledger closed over 1,500 steps while ring mutants arise.

**Codex review (Sol 6.1 High, 2026-10-03).** No CPU and WGSL divergence, no overflow, no effect
on configs without the key. It found consumers of `Genome` that dropped the ring bytes. Fixed:
the lineage inspector's mutation locus, the biogeography identity key, the evaluator's
background revive, two weak tests, and then the rest of its list: the MAP-Elites archive key, the
M3 retest's replication and founder-set identities, and the JSON adapters in
`tools/bootstrap.ts`, `tools/retest.ts`, `tools/foundations.ts`, `tools/obligates-x.ts` and
`tools/fa-background.ts` now carry `rings`. A neutral genome keeps every identity it had
(`packages/search/test/rings.test.ts`). The search itself still does not explore ring weights:
`mutateGenome` perturbs the controller, mu, sigma and gain only. The lab's probe shows a
genome's ring weights once they leave neutral.

**Assay.** The lesion battery must express the ring weights, so `tools/assay.ts retest` takes a
`world` entry in its plan and `tools/own-screen.ts` passes `shapeReach` for these arms. Founders
have neutral weights, so their baseline (0.979) is unchanged by construction.

**Arms.** gradient-m3 plus one key each.

| Arm | `shapeReach` | Rings | Mutation slots |
|---|---|---|---|
| `own-shape` | 9 | inner and outer half of the radius-9 kernel | 165 |
| `own-shape-far` | 13 | those two plus a far ring from 9 to 13 | 166 |

**Readout, fixed before any evolution result.** The question is whether bodies stop being one
kind of dot, so the label rests on body geometry (`tools/own-shape.ts`), not on regeneration.
Control at 250k, 500k and 10^6 over three seeds: median body size 16 to 26 cells, size spread
(p90 / p10) 1.22 to 2.25, median elongation 1.12 to 1.26.

A seed is *different* at 10^6 if any of these holds:
- median body size at least 39 cells or at most 10 (1.5 times outside the control range);
- size spread at least 3.4 (1.5 times the control maximum);
- median elongation at least 1.56 (control maximum plus 0.3);
- at least two ring-weight types, each dominant in 10% or more of the bodies, whose median body
  sizes differ by a factor of 1.5 or more.

Promising = at least 2 of 3 seeds different, with bound mass at least 0.5 of the control's.
Dead end = no seed different although ring weights moved (mean absolute offset 8 or more on some
ring in at least 2 seeds), or collapse (bound mass under 0.5 of control in at least 2 seeds).
Unclear otherwise. Regeneration is reported with the ownership rule as a secondary line.

Caveat written in advance: ring weights will move by drift alone (ring mutations hitchhike), so
moved weights are not evidence of selection. Only geometry counts.

## B. Declared cells (`cellPeriod`, `cellMutProb`)

**What is declared.** A cell is a connected body of one lineage id, and an id names exactly one
cell. Boundary: the census's individual, 4-connected sites of one id each holding B + P of 48 or
more, inside one tile, with total bound mass of 256 or more. Division rule: when one id has
several such bodies, the heaviest keeps the id and every other body is a daughter with a fresh id
and, with probability `cellMutProb / 2^32`, one mutation written to all of its sites. In-step
mutation is off (`mutRate` must be 0), so a genome changes at a cell's birth and nowhere else,
and every site of a body carries one genome.

**What is not declared.** Anything made of several cells. The physics (flow, lottery, chemistry)
is unchanged, bodies still form, bud and die by the same local rules, and nothing is said about
groups of cells. For these arms the plan's first two north-star items (individuals and
reproduction without being told to) are assumptions, not results.

**Why this is a different test from the takeover arms.** Under RULE_VERSION 1 a mutation
converts one site inside a body and then spreads or dies by the site-level lottery, so variants
are first selected inside bodies for site-level growth. The control fixes hundreds of such
mutations per lineage in 10^6 steps. Here a variant exists only as a whole body from birth, so
nothing is selected inside a body. If within-body selection is what erodes regeneration, these
arms should keep it.

**Implementation.** `applyCellPass` (`packages/sim-ref/src/cells.ts`) is a host-side transform
between steps, like migration: the runner reads the state back at census boundaries where
`cellPeriod` divides the step, applies the pass and uploads (`cellsAtBoundary` in
`packages/runner/src/migrate.ts`). Only genome channels are written, so matter and the energy
ledger are untouched. A daughter's id is (the pass's step, its lowest site index), which
`validateState` accepts and which no in-step mutation can have minted. Births go to
`mutations.tsv` (child and parent ids) and to `cells.tsv` (step, ids, anchor, cells, mass,
mutated). No WGSL changes. The lab's execution module runs the same helper at the same boundaries
(after migration and the pond cycle, before any checkpoint), appends births to its mutation
edges and counts them as the runner does, so a declared-cell world stepped in the lab equals
the headless history, replay twin included. The lineage package replays a daughter's genome
from the pass's own draws, so the inspector works on these runs. Not done: the coordinator's
segment stitching does not carry `cells.tsv` (births are still in `mutations.tsv`).

**Gates passed.** `tsc` clean; golden pins untouched (no shader or step change).
`packages/sim-ref/test/cells.test.ts` (validation; hand-built bodies: the heaviest keeps its id,
ties go to the lowest anchor, fragments and sub-threshold film are left alone, daughters carry
one genome one slot from the parent's; determinism and idempotence; tile wrap and tile
isolation; ids accepted by `validateState`; matter and ledger exact over 1,200 reference steps
with one body per id after every pass) and `packages/runner/test/cells.test.ts` (the boundary
helper against the pure pass).

**Arms.** gradient-m3 with `mutRate` 0, `cellPeriod` 1000, `cellMutProb` 2^32 (every daughter
mutates once).

| Arm | Takeover between cells |
|---|---|
| `own-cell` | RULE_VERSION 1: incoming matter is assimilated by the lottery winner |
| `own-cell-wall` | lossy, lineage kin: matter of another cell becomes waste, never assimilated |

In a 40,000-step smoke run `own-cell` had 46 births per pass and `own-cell-wall` 25, against
roughly 230 in-step mutation events per 1,000 steps in the control, most of which are lost.

**Assay sampling.** An id is one body, so the usual top four lineages would be four bodies.
For these arms `own-screen read` assays 16 bodies at evenly spaced size ranks among the bodies
the pass sees (`cellBodies`), 4 replicates each: the same 64 tiles, sampling the population of
declared cells. The assay world is the standard one (no pass; the genome's meaning is unchanged).

**Codex review (Sol 6.1 High, 2026-10-03).** No defect in the labelling, keeper choice, cadence
or GPU upload path. Fixed from its findings: the pass now refuses a state that already holds a
daughter's id (possible only for a state from outside such a run); the lineage replay refuses
ids born in a declared-cell run instead of reconstructing a genome from the wrong draws; the
assay sample ranks declared bodies, not ids' total occupancy, which admitted film; and
`tests/deno/cells_segments.ts` checks on the real GPU that a run split at a pass boundary equals
the continuous run (digests, observer counters, birth rows) and that the GPU with the boundary
helper equals the reference with the pure pass at every pass. Its replay finding was first met
with a refusal and then with a real replay (`packages/lineage/test/cells-replay.test.ts`).

**Readout, fixed before any evolution result.** The ownership rule. Promising = at least 2 of 3
seeds with regeneration at least control + 0.2 at 10^6 (control 0.141, 0.188, 0.219), bound mass
at least 0.5 of control, and median lineage depth at least a quarter of the same seed's control
(the control's depths are 58, 142 and 102, so the thresholds are 15, 36 and 26; depth here
counts births, each one mutation). Dead end = collapse (bound mass
under 0.5 of control in at least 2 seeds) or stalled evolution. Unclear otherwise.

Expectation written before the read: if within-body selection is the cause of erosion, both arms
hold regeneration well above the control. If they erode like the control, selection among whole
bodies does not favour regeneration in this world either, and the injury arm is the remaining
candidate for supplying that pressure.

## Finishing the scope (2026-10-03, second pass)

After the user asked to finish the scope of both variants, the parts first left out were built
and a third Codex review (Sol 6.1 High) was run on them. It found no defect in the lab and
headless traversal, checkpoint settlement, edge ordering or the salted replay. Fixed from it:
`tools/retest.ts --founders` now carries ring offsets into a generated founder file (a neutral
set generates the file it always did); the inspector keeps one minting convention (`hi - 1`,
the last step before the lineage exists, for in-step mutations and cell births alike); a ring
mutation is classified as physics, not as a silent controller change; the evaluator's
background revive drops all-zero rings; the lab test compares exact birth edges and restores
from a checkpoint taken at a pass step; the replay test covers a ring namespace and two and
three kernel rings.

Final gates on this code: `tsc` clean, 1,438 tests pass, GPU equals CPU on all 19 golden cases,
`tests/deno/cells_segments.ts` passes. Not verified in a browser: the lab changes are covered by
`apps/lab/test/execution.test.ts` on the reference physics, and the probe panel's ring-weight
row was not looked at in a running lab.

Known gaps, stated so nobody trips on them: MAP-Elites does not search ring weights; the
coordinator's stitching does not carry `cells.tsv`; `docs/rules.md` does not describe these
optional rules (this file does).

## Screen 5

`runs/cells/screen5`: the four arms above, seeds 1 to 3, 10^6 steps, checkpoints every 250,000,
read at 250k, 500k and 10^6. The control is the existing gradient-m3 history (checkpoints and
assay caches copied from the ownership screens). Local GPU only.

A Promising arm is not a result until it replicates: five fresh seeds (4 to 8) of that arm and of
the control to 10^6, same read; the label stands only if at least 3 of the 5 arm seeds meet the
arm's criterion against the fresh control. That replicate runs automatically on a Promising read
and not otherwise.

## Screen 5 result (2026-10-03)

Run note. Ten of the twelve histories finished before the Mac's window server restarted at about
15:13 (the start time of the running WindowServer process) and took the GPU from the detached
driver (`log-interrupted.txt`). The two missing histories (seed 3 of both cell arms) and the
whole read ran after a resume (`go2.sh`), from the same source; histories are deterministic, so
the split does not touch the numbers. No paid compute.

### Declared cells

Regeneration at 10^6 (16 bodies at evenly spaced size ranks, 4 replicates each), with the three
criteria of the rule. Control: 0.141, 0.188, 0.219, so the bar is 0.341, 0.388, 0.419.

| Arm | Seed | Regenerated | Bar | Bound mass vs control | Median depth | Depth bar | Survived assay |
|---|---|---|---|---|---|---|---|
| `own-cell` | 1 | 0.531 | met | 0.950 | 41 | met | 1.000 |
| `own-cell` | 2 | 0.094 | no | 1.016 | 72 | met | 0.359 |
| `own-cell` | 3 | 0.078 | no | 0.984 | 68 | met | 0.625 |
| `own-cell-wall` | 1 | 0.000 | no | 0.759 | 5 | below 15 | 0.844 |
| `own-cell-wall` | 2 | 0.922 | met | 0.610 | 10 | below 36 | 1.000 |
| `own-cell-wall` | 3 | 0.484 | met | 0.844 | 13 | below 26 | 0.969 |

- `own-cell`: **Unclear**. One seed of three meets the bar; nothing collapsed and nothing stalled.
- `own-cell-wall`: **Unclear**, and not Promising. Two seeds meet the regeneration bar and bound
  mass holds, but the median depth is under a quarter of the control's in all three seeds, so no
  seed meets the full criterion. `summary.md` prints "Promising" for this arm because the tool
  applies the ownership rule without the depth criterion; the rule fixed above includes it. The
  replicate was therefore not run. It is not Dead end by the letter either: nothing collapsed, and
  the only definition of "stalled" the rule has (`docs/sandbox-ownership.md`: founders still
  dominate everywhere) is not met, since the dominant lineages are mutants in 3 of 3 seeds. In
  substance it is a nearly frozen world, described next.

How slow the wall arm is, from the bundles. Births continue (164, 4,103 and 1,237 in the last
quarter, or 0.7, 16 and 5 per pass, against 6,961, 3,686 and 1,963 in the first), but median
depth is 5, 10, 10 at 500k and 5, 10, 13 at 10^6, against 41, 72 and 68 without the wall. The
same growth classes hold each world from 250k to 10^6, with shares moving by at most seven points
after 500k, and seed 1's three frames show the same front line. The commonest id at 10^6 was born
at step 956,999, 758,999 and 44,999. Regeneration stays near what the first quarter left: 0.031,
0.984, 0.609 at 250k and 0.000, 0.922, 0.484 at 10^6; seed 1 had lost it at a median depth of
five. These readouts cannot tell regeneration kept by selection from regeneration kept because
little changes, and the depth criterion exists so that the second is not counted as the first.

Reading. The expectation failed. Under `own-cell` no mutation arises inside a body: in-step
mutation is off, a connected same-id component holds one genome (state validation enforces it),
and a daughter gets its one mutation at birth. Takeover still replaces genomes site by site where
bodies of different ids meet. Regeneration still erodes to the control's level in two seeds of
three (and in those two, 64% and 38% of the assay trials do not survive at all). So erosion does
not need mutants that arise inside a body. Which selection erodes it is not shown. Caveats: three seeds; the cell arms sample bodies across size ranks while the
control samples its four largest lineages, so the two columns are not the same statistic; seed 1
at 0.531 is unexplained.

### Heritable shape

Per-body geometry at 10^6 (the pre-stated measure). Control: median 21, 23, 26 cells; spread
1.41, 1.84, 1.70; elongation 1.15, 1.14, 1.15.

| Arm | Seed | Median cells | Spread | Elongation | Mean abs. offset (inner / outer / far) | Types dominant in 10% of bodies (bodies : median cells) | Different |
|---|---|---|---|---|---|---|---|
| `own-shape` | 1 | 18 | 1.40 | 1.14 | 3.8 / 1.8 / - | 64/64 (425 : 18), 85/64 (93 : 16) | no |
| `own-shape` | 2 | 25 | 2.12 | 1.26 | 13.7 / 0.2 / - | 84/64 (262 : 27), 64/64 (140 : 19) | no (sizes differ 1.42x) |
| `own-shape` | 3 | 15 | 2.33 | 1.31 | 8.0 / 0.0 / - | 56/64 (411 : 15) | no |
| `own-shape-far` | 1 | 17 | 1.75 | 1.14 | 11.5 / 1.0 / 0.2 | 75/64/0 (559 : 17) | no |
| `own-shape-far` | 2 | 24 | 2.29 | 1.59 | 9.1 / 21.6 / 0.9 | 64/40/0 (255 : 24), 97/64/0 (84 : 24), 58/40/0 (76 : 30) | yes (elongation) |
| `own-shape-far` | 3 | 24 | 2.12 | 1.24 | 0.3 / 1.6 / 0.2 | 64/64/0 (345 : 26), 64/54/0 (101 : 18) | no (sizes differ 1.44x) |

- `own-shape`: **Dead end**. No seed is different, and the ring weights moved (offset 8 or more in
  seeds 2 and 3). Bound mass 0.911 of control.
- `own-shape-far`: **Unclear**. One seed of three is different, on elongation; no collapse (bound
  mass 1.001 of control).
- Secondary line, regeneration with the ownership rule: `own-shape` 0.125, 0.672, 0.031 (one seed
  above the bar), `own-shape-far` 0.109, 0.109, 0.156 (none). Depths 60, 91, 71 and 57, 100, 93.

What the weights did. The near rings vary, sort and reach fixation in places (seed 3 of
`own-shape` is one type, 56/64). Two worlds hold two common types whose bodies differ in size by
1.42 and 1.44, just under the 1.5 the rule asks for. The far ring stayed almost unused: its mean
weight is under 1 in every world, against 64 for each near ring. As written in advance, moved
weights are not evidence of selection.

A view the rule does not have (post hoc, labels unchanged). The pre-stated measures are medians
over bodies. A labyrinth or a stripe is one body, so a few of them can hold much of the living
area without moving a median. `tools/own-shape.ts` now also reports `cells_long`, the share of
body cells in bodies with elongation 2 or more, and `own-screen read` writes `frames-seeds.png`
(every seed at the last snapshot). At 10^6:

| Arm | Seed 1 | Seed 2 | Seed 3 |
|---|---|---|---|
| gradient-m3 | 0.035 | 0.249 | 0.347 |
| `own-shape` | 0.003 | 0.523 | 0.214 |
| `own-shape-far` | 0.015 | 0.422 | 0.455 |
| `own-cell` | 0.004 | 0.001 | 0.024 |
| `own-cell-wall` | 0.000 | 0.045 | 0.005 |

Three things follow. The control at 10^6 is not only a lattice of dots: in seeds 2 and 3 a
quarter to a third of body cells sit in worms, and at 500k seed 1 has 0.213. The shape arms show
more of it in seed 2 (labyrinths, 0.52 and 0.42 against 0.25) and a block of tile-wide horizontal
stripes in seed 3 of `own-shape-far`, but seed 3 of `own-shape` is below its control and seed 1
is dots in every arm; with three seeds and a measure chosen after seeing the frames this is a
description, not a difference. The declared-cell worlds have the least of it, under 5% everywhere;
why is not established (the geometry tool joins sites by mass and does not look at ids).

### Where this leaves the line

No arm of this screen meets its full pre-stated Promising criterion, and none did in the earlier
screens (lossy takeover, wounds alone). Single evolving worlds do hold regeneration at 10^6
(`own-cell` seed 1 at 0.531, `own-shape` seed 2 at 0.672). One combination has not been run and
both of its rules exist in this workspace: declared cells, with and without the wall, under
recurring wounds (`injuryPeriod`). Wounds alone left mutation inside bodies in place; declared
cells alone had no wounds, and the wall arm had little turnover. That would be a new arm with its
own readout fixed in advance; it has not been started.

## Screen 6: declared cells under recurring wounds

Asked for by the user on 2026-10-03 after screen 5's read ("run declared cells under recurring
wounds, with and without the wall"). Everything in this section up to "Result" was written before
any evolution result of these arms existed. What had been seen: a 40,000-step smoke run of seed 1
of each arm, births only (43 and 18 per pass), no assay.

**Arms.** The two cell presets plus `own-injury-light`'s wounds, unchanged: radius 3 (29 cells,
about 30% of a 20-cell body), a wound step every 13 steps, each cell hit about once per 13,000
steps. One wound setting, the light one, for two reasons fixed here: it wounds bodies in part
rather than removing them whole, which is the case regeneration answers, and it is the wound-only
arm with the highest regeneration in screen 4, so the comparison is against the strongest
wound-only arm.

| Arm | Takeover between cells | Wounds |
|---|---|---|
| `own-cell-injury` | RULE_VERSION 1 | radius 3, each cell about once per 13,000 steps |
| `own-cell-wall-injury` | lossy, lineage kin | the same |

A wound that cuts a body in two makes a daughter at the next pass, so wounds also add births and
with them mutations. No new rule code: wounds are in-step (`injuryPeriod`), the pass is host-side.
`tests/deno/cells_segments.ts` now also checks the wall with wounds on the real GPU against the
reference at every pass.

**Screen.** `runs/cells/screen6`: both arms, seeds 1 to 3, 10^6 steps, checkpoints every 250,000,
read at 250k, 500k and 10^6. Local GPU only. The control, `own-cell`, `own-cell-wall` (screen 5)
and `own-injury-light` (screen 4) are cloned in with their cached assays so the summary shows all
six side by side; they are not re-run. Cell arms are assayed as in screen 5 (16 bodies at evenly
spaced size ranks, 4 replicates each).

**Readout, fixed before any evolution result.** Per seed at 10^6, three criteria:
regeneration at least control + 0.2 (control 0.141, 0.188, 0.219, so 0.341, 0.388, 0.419); bound
mass at least 0.5 of the same seed's control; median lineage depth at least a quarter of the same
seed's control (15, 36, 26).

- Promising = at least 2 of 3 seeds meet all three.
- Dead end = collapse (bound mass under 0.5 of control in at least 2 seeds) or frozen (median
  depth under its bar in at least 2 seeds). This gives "stalled" the operational meaning it lacked
  in screen 5; under it screen 5's wall arm would have read Dead end, and its recorded label is not
  changed.
- Unclear otherwise.

A Promising arm is not a result until it replicates: five fresh seeds (4 to 8) of that arm and of
the control to 10^6, same read; the label stands only if at least 3 of the 5 arm seeds meet all
three criteria against the fresh control. The replicate is started by the session, not by the
screen's driver, as soon as the classifier prints Promising, and not otherwise.

How the label is computed (`tools/own-readout.ts`). Comparisons use raw counts, not the rounded
numbers printed here: regeneration is met when the arm's rate minus the control's is at least 0.2
on the assays' counts; bound mass when twice the arm's B + P is at least the control's; depth when
four times the arm's median depth is at least the control's. The control's depths for seeds 1 to
3 are the fixed 58, 142 and 102 (its bundles were cloned in without their lineage tables); a
replicate takes them from the fresh control's trace. The "Readout" lines that `own-screen read`
writes into `summary.md` apply the older rule (no depth, arm-mean mass) and are not the label.

Reported beside the label, not part of it: the same arms without wounds (screen 5: `own-cell`
0.531, 0.094, 0.078; `own-cell-wall` 0.000, 0.922, 0.484), wounds without declared cells (screen
4: 0.000, 0.219, 0.266), births per pass, and the geometry columns of `tools/own-shape.ts`.

**Expectation written before the read.** If recurring wounds are the missing pressure once no
mutant can arise inside a body, `own-cell-injury` meets the regeneration bar in at least two
seeds, where `own-cell` (one seed) and `own-injury-light` (none) did not. For the wall arm, wounds
vacate room, so its depth should pass the bar in at least two seeds. High regeneration at such
depth would weaken "kept by lack of change" as the explanation of the wall arm's scores in screen
5; it would not by itself show selection rather than drift. If both arms erode to the control's
level, wounds at this rate do not select for regeneration even with one genome per body.

Caveats fixed now: three seeds; the cell arms and the control are sampled differently (bodies
across size ranks against the four largest lineages); the assay world is the standard one, with
no wounds and no pass.

**Codex review (Sol 6.1 High, 2026-10-03), before any result.** No defect in the presets, the
module order, the combination of in-step wounds with the host-side pass (wounded sites lose their
id; keeper choice, fresh ids, validation and conservation hold) or the assay's genome semantics.
Fixed from its findings, at about 16:38 while the first history was still running and nothing had been
assayed: the generated `summary.md` labels do not implement this section's rule, so the label
comes from `tools/own-readout.ts` (tried on screen 5's arms: `own-cell` Unclear, `own-cell-wall`
Dead end (frozen), as this section says it would have read); comparisons are defined on raw
counts; the replicate is a step the session starts, since the driver does not; and the wall
expectation names a seed count and claims less.

Gates on this change: `tsc` clean, 1,438 tests pass, `tests/deno/cells_segments.ts` passes with
the wall-and-wounds comparison, the three `own-injury-*` presets are byte-identical to the
ownership workspace's.

**One more clarification before any assay (17:28).** The census of `own-cell-wall-injury` seed 2
shows the world died out by step 53,000 (35 individuals at step 1,000, none from 52,000 on). The
rule did not say how an extinct world counts, so, fixed here with five histories finished, the
sixth at step 727,000 and no assay or trace of these arms run: an extinct world meets none of the
three criteria; it counts towards collapse through its bound mass, and not towards frozen, since
it has no depth to be under a bar. `tools/own-readout.ts` implements that.

### Result (screen 6, read 17:37)

Six histories on the local GPU, no interruption. Regeneration at 10^6, with the reused arms beside
the two new ones (raw counts out of 64 for the new arms):

| Arm | Seed 1 | Seed 2 | Seed 3 | Mean |
|---|---|---|---|---|
| gradient-m3 (control) | 0.141 | 0.188 | 0.219 | 0.182 |
| `own-injury-light` (wounds only, screen 4) | 0.000 | 0.219 | 0.266 | 0.161 |
| `own-cell` (screen 5) | 0.531 | 0.094 | 0.078 | 0.234 |
| `own-cell-injury` | 0.266 (17) | 0.188 (12) | 0.109 (7) | 0.188 |
| `own-cell-wall` (screen 5) | 0.000 | 0.922 | 0.484 | 0.469 |
| `own-cell-wall-injury` | 0.203 (13) | extinct | 0.391 (25) | 0.297 over two |

The three criteria per seed (`tools/own-readout.ts`, written to `runs/cells/screen6/readout.md`):

| Arm | Seed | Regeneration minus control | Bound mass vs control | Median depth (bar) | All three |
|---|---|---|---|---|---|
| `own-cell-injury` | 1 | +0.125, not met | 0.979 | 82 (15) | no |
| `own-cell-injury` | 2 | 0.000, not met | 1.011 | 138 (36) | no |
| `own-cell-injury` | 3 | -0.109, not met | 1.002 | 75 (26) | no |
| `own-cell-wall-injury` | 1 | +0.063, not met | 0.707 | 57 (15) | no |
| `own-cell-wall-injury` | 2 | nothing to assay | 0.000, not met | none | no |
| `own-cell-wall-injury` | 3 | +0.172, not met | 0.895 | 37 (26) | no |

- `own-cell-injury`: **Unclear**. No seed meets the regeneration bar; nothing collapsed, nothing
  frozen.
- `own-cell-wall-injury`: **Unclear**. No seed meets the regeneration bar; one seed died out (one
  is not a collapse by the rule) and no living seed is under its depth bar.
- No arm is Promising, so the replicate was not started.

Against the expectation. The first part failed: `own-cell-injury` meets the bar in no seed, where
at least two were expected, and its mean (0.188) is close to the control's (0.182). The second part held as
far as it went: with wounds the wall arm is no longer frozen, median depth 57 and 37 against 5 and
13 without wounds, and births at 18 and 11 per pass in the last quarter against 0.7 and 5. With
that turnover its regeneration is 0.203 and 0.391: seed 3 is the closest any seed of this screen
comes to its bar (0.172 above control, 0.2 needed), and seed 2, where the frozen wall held 0.922,
did not survive the wounds at all (35 individuals at step 1,000, none from 52,000 on).

Reading, with three seeds and the sampling difference named above. Without the wall, no seed
meets the bar and the arm's mean is close to the control's (per seed 0.266 against 0.141, 0.188
against 0.188, 0.109 against 0.219). That is no sign that wounds at this rate select for
regeneration in declared cells; it does not establish that they do not. For the wall arm the
seed-by-seed comparison with screen 5 is mixed: seed 1 went up (0.000 to 0.203), seed 3 went
down (0.484 to 0.391), and seed 2, the highest without wounds, died out. Neither survivor clears
its bar, but this does not show that the unwounded scores were lost through turnover; the worlds
also differ in founder (seed 3 is all founder 4 here and predominantly founders 4 and 3 without
wounds). The time courses are not plain erosion either: both living wall seeds are higher at
500k (0.297, 0.500) than at 250k (0.094, 0.156).

Two things beside the label.

- Founder identity. The one cell world that held regeneration in screen 5, `own-cell` seed 1 at
  0.531, is founder 1's clade; `docs/sandbox-ownership.md` found founder 1 alone under the
  unchanged rule at about 0.41 on average. Under wounds seed 1 goes to founder 12 in both arms
  (0.266 and 0.203). Founder identity is a possible explanation of the 0.531; it was not tested
  here, and these unmatched histories cannot rank it against the cell rule.
- Geometry (descriptive; these arms are not judged on it). Wounds raise births in the cell arm to
  63, 208 and 61 per pass in the last quarter, against 7, 39 and 40 without wounds. Seed 2 of
  `own-cell-injury` ends as a labyrinth: 178 bodies, median elongation 2.19, size spread 11.9, 60%
  of body cells in bodies with elongation 2 or more, the largest body 4,988 cells. The wound-only
  arm's seed 2 is the same kind of world and more so (108 bodies, elongation 2.59, 85%, largest
  7,339), which screen 4's write-up did not report because it looked only at seed 1's frames. Both
  are founder 3's clade. So are the shape arms' labyrinth worlds at seed 2 (traced in screen 5)
  and, by the table in `docs/sandbox-ownership.md`, the control's seeds 2 and 3, which were not
  re-traced here. Founder 3 under wounds is not always a labyrinth: the wound-only arm's seed 3
  is founder 3 too and has 27% of body cells in long bodies, about the control's share. So the
  largest departures from dots seen in this line are two founder-3 worlds under wounds, one with
  and one without declared cells. `frames-seeds.png` shows all six arms.

Where this leaves the line. Across six screens no arm has met its Promising criterion: lossy
takeover, wounds, heritable shape, declared cells, and declared cells under wounds with and
without the wall. Not tried: other wound rates or sizes with declared cells, and more seeds for
the wall arm under wounds (its seed 3 is just under the bar and its seed 2 died).

**Codex review of this result (Sol 6.1 High).** Labels and the no-replicate decision follow from
the rule; the classifier's integer comparisons and extinct-world handling check out. Fixed from
it: the classifier's replicate mode defaulted to 2 seeds needed where the rule says 3 of 5 (no
effect on these labels); one birth rate rounded wrongly; and four sentences that claimed more
than the data shows (absence of selection, loss through turnover, founder identity as the
likelier account, the control's founder at seed 2, which this screen's trace does not contain).

## Screen 7: more seeds for the wall arm under wounds

Asked for by the user on 2026-10-03 after screen 6's read ("run more seeds for the wall arm under
wounds"). Everything in this section up to "Result" was written at 18:19, before any evolution
result of these seeds existed. What had been seen: screen 6 in full, so seeds 1 to 3 of this arm
(0.063 above control, died out, 0.172 above control), and a 30,000-step timing run of the arm and
the control at seeds 91 to 97, throughput only.

**Histories.** `own-cell-wall-injury` and the control `gradient-m3`, seeds 4 to 8, 10^6 steps,
checkpoints every 250,000, read at 250k, 500k and 10^6, in `runs/cells/screen7`. These are the
seeds screen 6's section fixed for a replicate. The control is run because its seeds 4 to 8 did
not exist and every criterion is against the same seed's control. Preset and rule code are those
of screen 6. Local GPU only, two histories at a time (the control and the arm as two processes;
the timing run gave 1.45 times one process's throughput for two and 1.14 for four). Each history
is deterministic, so the pairing changes wall time and nothing else. Tool changes before the
start: `tools/own-readout.ts` takes `--fail` (the seed count for collapse and frozen, default 2
as before; screen 6's readout is reproduced unchanged), and `own-screen read` draws `frames.png`
from the lowest seed present, not seed 1.

**Readout, fixed before any result.** The three per-seed criteria of screen 6 at 10^6, against
the same seed's fresh control: regeneration at least control + 0.2 on raw counts; bound mass at
least half the control's; median lineage depth at least a quarter of the control's, both depths
from this screen's trace. On the five fresh seeds alone:

- Promising = at least 3 of 5 meet all three.
- Dead end = collapse (bound mass under half the control's in at least 3 of 5) or frozen (median
  depth under its bar in at least 3 of 5).
- Unclear otherwise.

Worlds with nothing to assay. "Died out" means no site carries a lineage at 10^6 (the trace's
occupancy is zero). Such a world meets no criterion, fails bound mass and so counts towards
collapse, and has no depth, so it does not count towards frozen. A world that still has
lineage-bearing sites but no body the pass would assay (zero assay replicates) is not called
died out: its regeneration criterion is not met, and its bound mass and depth are judged as
measured, like any other world's. If a control world has nothing to assay at 10^6, the classifier
stops and no label is given for this screen; the per-seed numbers are reported and the read is
recorded as unavailable.

The thresholds are the majority of the seeds, as 2 of 3 was. The driver computes the label with
`tools/own-readout.ts --seeds 4-8 --need 3 --fail 3`.

What the label is and is not. This is not the replicate of a Promising read: screen 6 read
Unclear on seeds 1 to 3, and these seeds were added after seeing seed 3 just under its bar. So
the label is given on the fresh seeds alone, seeds 1 to 3 are not pooled into it, and screen 6's
label stands as recorded. A Promising here would be at least three of five fresh seeds meeting
the bar after three that did not, and would need its own fresh seeds before being called a
result.

Reported beside the label, all eight seeds, descriptive: how many of the eight meet all three;
how many died out and the last census with an individual; among the
living worlds the regeneration difference, arm minus control, per seed, its mean and how many
are positive; the time course at 250k and 500k; births per pass in the last quarter; founder
ancestry from the trace.

**Expectation written before the read.** (1) The label is Unclear: fewer than three of five meet
all three, fewer than three fail bound mass and fewer than three are under their depth bar. (2)
Among living worlds the difference from the control is positive on average and under 0.2. (3) At
least one of the five dies out, as one of three did. (4) No living world is under its depth bar,
since wounds keep turnover going. If no world lives, (2) and (4) cannot be evaluated and count
as not held. If three or more meet all three, screen 6's two survivors understated the arm. If
three or more die out, most of these worlds do not last to 10^6 at this wound rate; that is a
statement about these seeds, not that the arm cannot live.

Caveats fixed now: those of screen 6 (cell arm and control are sampled differently; the assay
world has no wounds and no pass; histories are not matched for founder). The unwounded wall arm
is not run at these seeds, so a difference from the control cannot be split here between the
wall and the wounds.

**Codex review (Sol 6.1 High, 2026-10-03), before any result.** No defect in the driver's
commands, the two concurrent evolve processes (no shared file), seed parsing, the assay seeds
for seeds 4 to 8 (disjoint ranges for the two arms), the fresh control's trace or the classifier
with `--need 3 --fail 3` (Promising cannot coincide with either Dead end; collapse before frozen
only picks the displayed reason). Fixed from its findings at 18:25, with the first two histories
still running and nothing assayed: "died out" is defined by lineage occupancy and a world with
zero assay replicates but living sites is handled as the classifier already handles it; a
control with nothing to assay withholds the label; expectation (1) is stated on the label, the
no-survivor case is defined and the three-or-more-die sentence claims less; a Promising is "at
least three of five", not five. Not changed while the driver runs: `go.sh` prints SCREEN DONE
even if `own-shape.ts` fails (it does not feed the label), so `shape.log` is checked by hand
after the run, and the classifier's header comment still equates "nothing to assay" with
extinct, to be corrected after the run with no change to its logic.

### Result (screen 7, read 19:53)

The driver ran from 18:20 to 19:53; all ten histories finished, and `trace.log` and `shape.log`
were checked by hand (no error). No world died out. At 10^6, from `readout.md`, `trace.tsv` and
the assays' raw counts:

| Seed | Arm regenerated | Control | Difference | Bound mass vs control | Median depth (control) | All three |
|---|---|---|---|---|---|---|
| 4 | 14/64 (0.219) | 17/64 (0.266) | -0.047, not met | 0.855 | 31 (70) | no |
| 5 | 12/64 (0.188) | 9/64 (0.141) | +0.047, not met | 0.876 | 45 (42) | no |
| 6 | 19/64 (0.297) | 3/64 (0.047) | +0.250, met | 0.915 | 44 (51) | yes |
| 7 | 0/64 (0.000) | 3/64 (0.047) | -0.047, not met | 0.925 | 84 (114) | no |
| 8 | 11/64 (0.172) | 11/64 (0.172) | 0.000, not met | 0.867 | 35 (44) | no |

- `own-cell-wall-injury`, seeds 4 to 8: **Unclear**. One of five meets all three (3 needed); no
  world fails bound mass and none is under its depth bar.

Against the expectation. (1) held: the label is Unclear. (2) held: the mean difference from the
control is +0.041 (13/320), with two seeds above the control, two below and one equal. (3)
failed: no world died out, where at least one was expected. (4) held: every world is above its
depth bar.

All eight seeds, descriptive (seeds 1 to 3 from screen 6). One of eight meets all three (seed
6). One of eight died out (seed 2, no individual from step 52,000 on). Among the seven living
worlds the differences are +0.063, +0.172, -0.047, +0.047, +0.250, -0.047 and 0.000: mean +0.063
(28/448), four above the control, two below, one equal. Pooled, the living arm worlds regenerate
in 94 of 448 trials (0.210) and their controls in 66 of 448 (0.147).

Time course on the fresh seeds, arm minus control per seed:

| Step | Seed 4 | Seed 5 | Seed 6 | Seed 7 | Seed 8 | Mean | Arm mean | Control mean |
|---|---|---|---|---|---|---|---|---|
| 250,000 | +0.141 | +0.234 | -0.031 | +0.109 | +0.234 | +0.138 | 0.256 | 0.119 |
| 500,000 | 0.000 | +0.453 | +0.156 | +0.094 | +0.094 | +0.159 | 0.306 | 0.147 |
| 1,000,000 | -0.047 | +0.047 | +0.250 | -0.047 | 0.000 | +0.041 | 0.175 | 0.134 |

The regeneration margin is met by two seeds at 250k (5 and 8), one at 500k (5) and one at 10^6
(6): never by three, and not by the same seed at 500k and at 10^6. The arm's own rate falls
between 500k and 10^6 in four of the five worlds (seed 6 rises), as it did in both living worlds
of screen 6.

Beside the label.

- Seed 6's pass. Its arm value, 0.297, is lower than screen 6's seed 3 (0.391), which did not
  pass. It passes because its control is at 0.047, the lowest value among the eight controls
  (shared with seed 7; they range from 0.047 to 0.266).
- Seed 7's zero. The assay replants the sampled genomes in its own world, which has no wounds
  and no pass, and counts a trial as survived when it holds bound mass and at least one census
  individual after the growth phase. None of seed 7's 64 trials had such an individual at 10^6
  (44 did at 500k, and 21 regenerated), though every trial still held bound mass. So the 0.000
  is genomes that do not make a countable individual in the assay world, not individuals that
  fail to regrow after the lesion. Its own world is full: 563 bodies of median 16
  cells, bound mass 0.925 of the control, 55 births per pass in the last quarter against 10 to
  15 in the other four worlds, all founder 6 with a growth class (32/31) that no other world of
  this screen has. Seed 5 is partway there: 24 of 64 trials counted as survived at 10^6.
- Founders. Arm: 4, 7, 7, 6, 4. Control: 10, 12, 4, 3, 4. Only seed 8 has the same founder in
  both, and its difference is 0.000. The histories are not matched for founder, as the caveats
  say, so the per-seed differences mix founder with rule.
- Geometry. All ten worlds are dots: at most 5.6% of body cells in long bodies (the control's
  seed 7, founder 3), 387 to 563 bodies in the arm. No arm world here descends from founder 3
  and none is a labyrinth.

Reading. On five fresh seeds the wall arm under wounds does not hold regeneration above the
control by the margin: the label is Unclear with one pass, and the mean difference is +0.04. The
near miss that prompted these seeds (screen 6's seed 3, +0.172) was not borne out as typical.
What the eight seeds do show is a small positive mean difference at 10^6 (+0.06 over the seven
living worlds) with single worlds anywhere from 0.05 below to 0.25 above, and a larger lead
earlier that is mostly gone by 10^6: +0.14 and +0.16 at 250k and 500k on the five fresh seeds,
+0.10 and +0.19 over the seven living worlds (45/448, 86/448). That pattern is what slower
erosion in the arm would look like. Variation between assays and the unmatched founders are
other possible explanations (one control history reads 0.250 at 250k and 0.016 at 500k); none
of these is quantified here, and this screen cannot tell them apart. Only one of these eight
histories died out. The assay caveat matters more here than before: in one world, and partly in
a second, the sampled genomes no longer make a countable individual in the unwounded, pass-free
assay world, so for those worlds the assay does not measure regeneration under the conditions
they evolved in.

Where this leaves the line. Across seven screens no arm has met its Promising criterion. For the
wall arm under wounds that is now eight seeds: one meets all three, one died out. Not tried:
other wound rates or sizes; the unwounded wall arm at seeds 4 to 8, which would compare wounds
present and absent with the wall held fixed; longer histories, to see whether the arm's rate
keeps falling after 10^6.

**Codex review of this result (Sol 6.1 High).** Every count, fraction and rounding in the tables
checks against the raw files; Unclear follows from the rule applied literally; the four
expectation verdicts are right. Fixed from it: "survived" is given its operational meaning
(seed 7's trials hold bound mass but no census individual, so "bodies do not survive" said too
much); assay variation and founder differences are named as unquantified possibilities, not as
an established account of the closing lead; the early lead is given for both populations (five
fresh seeds, seven living worlds); one extinction in eight is reported as a count, not as what
is typical; the untried unwounded wall arm would compare wounds with the wall held fixed, not
separate the two; and the classifier's header comment now states what it does for a world with
no assay replicates (logic unchanged, readout reproduced).

## Screen 8: the wall arm without wounds at seeds 4 to 8

Asked for by the user on 2026-10-04 after screen 7's read ("run the unwounded wall arm at seeds
4-8"). Everything in this section up to "Result" was written at 04:57, before any evolution
result of these histories existed. What had been seen: screens 5 to 7 in full, so this arm at
seeds 1 to 3 (screen 5: regeneration 0.000, 0.922, 0.484; bound mass 0.759, 0.610, 0.844 of the
control's; median depth 5, 10, 13 against bars 15, 36, 26; label Unclear, in substance nearly
frozen), the wall arm under wounds at seeds 1 to 8, and the control at seeds 4 to 8, whose
values at 10^6 are therefore known before the start.

**Histories.** `own-cell-wall` (lossy takeover between cells, no wounds; the preset and rule code
of screen 5, unchanged since), seeds 4 to 8, 10^6 steps, checkpoints every 250,000, read at
250k, 500k and 10^6, in `runs/cells/screen8`. The control is not re-run: screen 7's
`gradient-m3` seeds 4 to 8 bundles and assay caches are cloned into this folder (APFS clones of
the same files), so the control side of every criterion is screen 7's, by construction:
regeneration 17, 9, 3, 3 and 11 of 64 trials, median depth 70, 42, 51, 114 and 44. Screen 7's
`own-cell-wall-injury` seeds 4 to 8 bundles and caches are cloned the same way, so `summary.md`,
the frames and `trace.tsv` show the three side by side; nothing is re-run for them and their
numbers are screen 7's. The arm's five histories run as two concurrent processes on the local
GPU (seeds 4 to 6 and 7 to 8; the evolve step is per history, so the split changes wall time
only). No tool change before the start.

The bars are therefore known in advance. Regeneration, on raw counts with 64 trials on each side
(fewer on the arm's side if a world has fewer than 16 bodies to sample; the raw-count rule then
applies as written): at least 30, 22, 16, 16 and 24 of 64 for seeds 4 to 8. Median depth: at
least 18, 11, 13, 29 and 11. Bound mass: at least half the control's.

**Readout, fixed before any result.** The three per-seed criteria of screens 6 and 7 at 10^6,
against the same seed's control: regeneration at least control + 0.2 on raw counts; bound mass
at least half the control's; median lineage depth at least a quarter of the control's, both
depths from this screen's trace. On the five seeds:

- Promising = at least 3 of 5 meet all three.
- Dead end = collapse (bound mass under half the control's in at least 3 of 5) or frozen (median
  depth under its bar in at least 3 of 5).
- Unclear otherwise.

Worlds with nothing to assay are handled as screen 7 fixed: "died out" is zero lineage occupancy
at 10^6 (such a world meets nothing, counts towards collapse and not towards frozen); a living
world with zero assay replicates fails regeneration and is judged as measured on the other two.
The control's five worlds all have assays at 10^6, so the withheld-label case cannot arise. The
driver computes the label with `tools/own-readout.ts --arms own-cell-wall --seeds 4-8 --need 3
--fail 3`; `summary.md`'s "Readout" lines apply the older rule without depth and are not the
label.

What the label is and is not. Screen 5 read this arm Unclear on seeds 1 to 3 and called it nearly
frozen in substance; these five seeds were chosen to match screen 7's, not after a near miss of
this arm. The label is on the five fresh seeds alone; seeds 1 to 3 are not pooled into it and
screen 5's label stands. What this screen adds that screen 7 could not: at each seed, the wall
arm with and without wounds against the same control. The two histories of a seed start from the
same physical state (cells, genomes and ledgers depend on the seed, not on the wound keys; the
configs and the recorded hashes differ, since the hash covers the keys) and can part only from
step 12 on, the first scheduled wound (a wound disc that holds nothing changes nothing, so the
first step at which the pair actually differs can be later); so at each seed the pair compares
wounds present and absent with the wall, the founders and the layout held fixed. That comparison is reported, not labelled: no criterion for
"wounds help" was fixed before screen 7 ran, and none is added now.

Reported beside the label, descriptive: per seed, regeneration without and with wounds (screen
7's values), the difference, how many of five are positive, and the means; the same for median
depth and for births per pass in the last quarter (rows of `cells.tsv` with step in (750,000,
1,000,000], divided by the 250 passes there); the time course at 250k and 500k; how many of
the five are under their depth bar and by how much; whether each world's regeneration at 10^6 is
within 0.15 of its own value at 250k (screen 5's sign of a frozen world); founder ancestry; and,
over all eight seeds of this arm, how many meet all three.

**Expectation written before the read.** (1) The label is Dead end (frozen). (2) No world fails
bound mass. (3) In at least three of five worlds the arm's regeneration at 10^6 is within 0.15 of
its own value at 250k. (4) Wounds raise turnover: in at least four of five seeds the wounded
history's median depth at 10^6 is above the unwounded one's, and so are its births per pass in
the last quarter. (5) Wounds do not raise regeneration with the wall fixed: the mean regeneration
of the five unwounded worlds at 10^6 (the mean of the five per-world rates) is at least that of
the five wounded ones (0.175, 56/320). Conventions: a world's regeneration rate is undefined
when it has no assay replicates at that snapshot, whether it died out or still has
lineage-bearing sites; a world whose rate is undefined at 250k or at 10^6 counts in (3) as not
within 0.15, and one whose rate is undefined at 10^6 enters (5) as zero. In (4) a world that died
out has no depth and counts as below the wounded history on depth; its births in the last quarter
are compared as recorded. The report keeps died out, living with no replicates and 0 of n apart.
If three or more die out the label is Dead end (collapse) and (1) fails.

Caveats fixed now: those of screens 5 and 7 (cell arm and control are sampled differently, 16
bodies at size ranks against the top four lineages; the assay world has no wounds and no pass;
arm and control histories are not matched for founder). The control is screen 7's measurement
reused, not re-measured, so no independent control measurement enters here, and two screens that
share a control share its noise: a low control at a seed (3 of 64 at seeds 6 and 7) makes that
seed's regeneration bar easy for both arms.

**Codex review (Sol 6.1 High, 2026-10-04), before any result.** No defect in the driver: the two
evolve processes of one arm share no file (every write of `tools/run.ts` goes under the
history's `seed-N` bundle), a failed history stops the driver before any read, the assay cache
is keyed by arm, seed and snapshot only, the cloned bundles and caches are byte-identical to
screen 7's (115 and 90 files), none of the four read tools writes into a bundle, and the
classifier with `--arms own-cell-wall` reads the control's depth from this screen's trace. The
bars check out (regeneration 30, 22, 16, 16, 24 of 64; with n arm replicates the bar is the
ceiling of n(5c + 64)/320 against a control count c; depth 18, 11, 13, 29, 11), as do the
screen 5 and 7 numbers quoted and 56/320. Fixed from its findings at 05:07, with the five
histories still running and nothing assayed: the pair of histories at a seed shares its physical
state, not its config or hash, and "part at step 12" became "can part only from step 12 on" (a
CPU check by the reviewer found seeds 7 and 8 differing after the first scheduled wound and
seeds 4 to 6 still identical, their first discs having held nothing); expectations (3) and (5)
now define a living world with no assay replicates (rate undefined, counted as not within and
as zero, kept apart from died out in the report); (4) names the births statistic and compares a
dead world's births as recorded.

### Result (screen 8, read 05:47)

The driver ran from 04:57 to 05:47 (evolve to 05:41; 899 to 1,149 steps per second per process
while two ran, 1,704 for the last history alone); all five histories finished, every assay had
64 replicates, `trace.log` and `shape.log` are clean, and the cloned arms' rows in `summary.tsv`,
`trace.tsv` and `shape.tsv` are screen 7's. No world died out. At 10^6, from `readout.md`,
`trace.tsv` and the assays' raw counts:

| Seed | Arm regenerated | Control | Difference | Bound mass vs control | Median depth (control, bar) | All three |
|---|---|---|---|---|---|---|
| 4 | 7/64 (0.109) | 17/64 (0.266) | -0.156, not met | 0.990 | 26 (70, 18) met | no |
| 5 | 0/64 (0.000) | 9/64 (0.141) | -0.141, not met | 0.831 | 24 (42, 11) met | no |
| 6 | 17/64 (0.266) | 3/64 (0.047) | +0.219, met | 0.752 | 12 (51, 13) under | no |
| 7 | 55/64 (0.859) | 3/64 (0.047) | +0.813, met | 0.608 | 12 (114, 29) under | no |
| 8 | 21/64 (0.328) | 11/64 (0.172) | +0.156, not met | 0.760 | 12 (44, 11) met | no |

- `own-cell-wall`, seeds 4 to 8: **Unclear**. No seed meets all three (3 needed); no world fails
  bound mass; two are under their depth bar (3 needed for frozen). Seed 8 is above its bar by
  one (12 against 11), seed 6 under by one (12 against 13).

Against the expectation. (1) failed: the label is Unclear, not Dead end (frozen). (2) held:
bound mass is 0.608 to 0.990 of the control's. (3) held, 5 of 5: regeneration at 10^6 is within
0.15 of the same world's value at 250k in every seed (0.141 to 0.109, 0.125 to 0.000, 0.172 to
0.266, 0.844 to 0.859, 0.359 to 0.328). (4) held, 5 of 5 on both: the wounded history's median
depth at 10^6 is above the unwounded one's in every seed (31, 45, 44, 84, 35 against 26, 24, 12,
12, 12) and so are its births per pass in the last quarter (14.2, 10.1, 14.9, 55.3, 14.8 against
6.6, 1.6, 2.1, 15.6, 2.0). (5) held: the mean regeneration of the five unwounded worlds is 0.313
(100/320) against 0.175 (56/320) for the wounded ones.

Time course, arm minus control per seed, with the three means:

| Step | Seed 4 | Seed 5 | Seed 6 | Seed 7 | Seed 8 | Mean | Arm mean | Control mean | Wounded arm mean |
|---|---|---|---|---|---|---|---|---|---|
| 250,000 | -0.109 | +0.125 | -0.078 | +0.750 | +0.359 | +0.209 | 0.328 | 0.119 | 0.256 |
| 500,000 | -0.266 | +0.016 | +0.203 | +0.688 | +0.266 | +0.181 | 0.328 | 0.147 | 0.306 |
| 1,000,000 | -0.156 | -0.141 | +0.219 | +0.813 | +0.156 | +0.178 | 0.313 | 0.134 | 0.175 |

The arm's mean does not move (105, 105 and 100 of 320), while the wounded arm's rose and then
fell. The regeneration margin is met by two seeds at 250k (7 and 8), three at 500k (6, 7, 8)
and two at 10^6 (6 and 7); seed 7 meets it at every snapshot.

Wounds present and absent with the wall held fixed, per seed (unwounded minus wounded, both
against the same control; the pairs share their state until the first wound that changes
anything, step 12 at the earliest):

| Seed | Regeneration, no wounds | With wounds | Difference | Depth, no wounds | With wounds | Births per pass, no wounds | With wounds | Winning founder: no wounds, wounds, control |
|---|---|---|---|---|---|---|---|---|
| 4 | 0.109 | 0.219 | -0.109 | 26 | 31 | 6.6 | 14.2 | 10, 4, 10 |
| 5 | 0.000 | 0.188 | -0.188 | 24 | 45 | 1.6 | 10.1 | 12, 7, 12 |
| 6 | 0.266 | 0.297 | -0.031 | 12 | 44 | 2.1 | 14.9 | 4, 7, 4 |
| 7 | 0.859 | 0.000 | +0.859 | 12 | 84 | 15.6 | 55.3 | 3, 6, 3 |
| 8 | 0.328 | 0.172 | +0.156 | 12 | 35 | 2.0 | 14.8 | 7 (0.57) and 4 (0.43), 4, 4 |

(Founders are the roots of the lineages on occupied sites at 10^6, with their share of those
sites where more than one remains.)

- Regeneration: lower without wounds in three seeds, higher in two; the mean difference, +0.138
  (44/320), is seed 7's +0.859 against four differences between -0.188 and +0.156 (median
  -0.031). At 250k and 500k the mean differences are +0.072 and +0.022, positive in two and
  three seeds.
- Turnover: with wounds, median depth is 1.2 to 7 times the unwounded history's and births in
  the last quarter 2.1 to 7.3 times. Unwounded minus wounded, depth: -5, -21, -32, -72, -23,
  means 17.2 against 47.8; births per pass: -7.6, -8.5, -12.8, -39.6, -12.8, means 5.6 against
  21.9. Without wounds, three worlds (6, 7, 8) are at depth 12 at 10^6 and were at 12, 11 and 10
  at 250k (seed 6 the same at every snapshot), and the other two drift (10 to 26, 8 to 24) at
  6.6 and 1.6 births per pass; the first quarter had 17.2, 18.8, 4.9, 20.9 and 7.5.
- Founders: without wounds the same founder wins as in the control in four seeds and seed 8 is
  split between the control's winner and another; with wounds a different founder wins in four
  seeds. The two histories of a seed differ in nothing but the wound keys and share their state
  until the first wound that changes anything, so the change of winner is the wounds' doing.
- Bound mass: with wounds 0.855 to 0.925 of the control's; without, 0.608 to 0.831 in four seeds
  and 0.990 in seed 4.

Beside the label.

- Seed 7's 0.859 is the highest regeneration in this screen and, after screen 5's seed 2
  (0.922), the highest of this arm's eight worlds. Its dominant
  growth class (80/26, on 0.71 of occupied sites) is also the control's dominant class at this
  seed (0.72), from the same founder 3; the control's lineages are 114 mutations deep and regenerate
  3 of 64, the arm's 12 deep and 55 of 64. Screen 5's seed 2 (0.922 at depth 10) was the same
  picture.
- Seeds 4 and 5 and the assay world. At 10^6, 23 of seed 4's 64 trials and 7 of seed 5's held a
  census individual after the growth phase (25 and 13 at 250k); in the other three worlds 60 to
  64 did. So seed 5's 0.000 is 57 trials with no countable individual in the unwounded,
  pass-free assay world and 7 that had one and did not regenerate (screen 7's seed 7 had none of
  64 with an individual), and seed 4's 0.109 is 41 without an individual and 7 of the 23 with
  one regenerating. These are the two worlds whose depth still moves.
- Seed 6 is under its bar by one and seed 8 above by one, at the same depth 12: the bars are 13
  and 11 because the controls at these seeds are 51 and 44 deep. Both worlds are growth class
  60/20 (0.93 and 0.99 of occupied sites); seed 6 descends from founder 4, seed 8 from founders 7
  and 4.
- Geometry: at 10^6 all fifteen worlds are dots (at most 5.6% of body cells in long bodies);
  over its three snapshots the arm's maximum is 5.7% (seed 7 at 250k) and it has 228 to 555
  bodies, 242 to 555 at 10^6. In `frames-seeds.png` the unwounded worlds of seeds 6 to
  8 are a packed lattice behind a flat front with empty tile above it (28,000 to 38,000 occupied
  sites of 65,536); the wounded histories' fronts are ragged and marked by wound halos.

All eight seeds of this arm, descriptive (seeds 1 to 3 from screen 5, whose bars came from that
screen's controls): none meets all three; the regeneration margin is met in four (2, 3, 6, 7);
bound mass holds in all eight; median depth is under its bar in five (1, 2, 3, 6, 7) and the
other three are 26, 24 and 12 against bars 18, 11 and 11; none died out.

Reading. The wall arm without wounds on five fresh seeds reads Unclear, not the Dead end
(frozen) expected: two of five are under their depth bar, and a third sits at the same depth
but above a lower bar. In substance the picture of screen 5 holds: regeneration at 10^6 is
within 0.15 of the same world's value at 250k in all five (down in seeds 4 and 5, 0.141 to
0.109 and 0.125 to 0.000; up in seed 6, 0.172 to 0.266), high in seed 7 (0.86) and nil in seed
5, and three of the five worlds have moved by at most two in median depth since 250k. The arm's
mean lead over the control, +0.18, is larger than the wounded arm's +0.04 at these seeds, and
it sits in the worlds of low depth: the two worlds that still gain depth are the two below
their control. Whether little descent is what preserves regeneration is not tested here; the
two are associated in this arm's eight worlds.

Put beside screen 7, with the wall held fixed: wounds restore turnover in every seed (median
depth 1.2 to 7 times, births 2.1 to 7.3 times the unwounded history's) and change which founder
wins in four of five, and in the wounded arm the mean lead over the control is +0.04 at 10^6
after +0.14 and +0.16 at 250k and 500k. Without wounds the mean lead is +0.18 and flat across
the three snapshots. For the wall arm, with and without wounds, sixteen worlds: regeneration
above the control's bar at 10^6 has come in five (screen 5's seeds 2 and 3, screen 7's seed 6,
this screen's seeds 6 and 7), four of them under their depth bar; the one above it is screen 7's
seed 6. That is a statement about the wall arm, not the line: other arms have had worlds above
both bars (screen 5's `own-cell` seed 1 and `own-shape` seed 2). It is a description, not a
test of a stated hypothesis; founder differences between arm and control remain unmatched and
assay variation unquantified, as before.

Where this leaves the line. Across eight screens no arm has met its Promising criterion. The
wall arm is now eight seeds without wounds (none meets all three, five under their depth bar)
and eight with (one meets all three, one died out). Not tried: longer histories; wound rates
between none and one per 13,000 steps per cell; a design that matches founders between arm
and control.

**Codex review of this result (Sol 6.1 High).** The label follows from the rule applied
literally; the five expectation verdicts are right; all 45 assays have 64 replicates; the
cloned rows match screen 7's; the counts, fractions, ranges and timing check against the raw
files. Fixed from it: the cross-screen sentence claimed too much (three recorded worlds of other
arms, and screen 7's seed 6 of this arm, clear both the regeneration and the depth bar), so it
is now a count over the wall arm's sixteen worlds; "a lead held by not evolving" asserted a
mechanism and is now the association it is; "the first quarter's value in every world" is now
the tolerance met and the direction of each change; only seed 6 is unchanged in depth since
250k, the other two moved by one or two; seed 5's zero is 57 trials with no individual and 7
with one that did not regenerate, not wholly an assay-world failure; the geometry maximum and
the body count name their population and snapshot; growth-class and founder shares are shares
of occupied sites, not of lineages; 52/64 rounds to +0.813; and the depth and births
differences and means the pre-stated section promised are given.
