# B2 compartment check: result (2026-11-21)

**Answer under the thresholds fixed in PLAN.md: in the frozen six-wall PHAGE world the objects the confirmation
counted as droplets are wave patches, in 4 of 4 seeds (13 to 16), at steps 60,000 to 80,000 and again at
220,000 to 240,000. They are not compartments.** The no-phage
world reads the same way in its settled window (4 of 4 seeds). The single-wall world reads "mixed" (4 of 4
seeds): its objects are separate, moving, short-lived patches, which meet neither the bodies criteria nor the
wave criteria. The one-wall reference at the B2 default rates reads wave patches (4 of 4) and the one-wall
reference at the sandbox line's spot rates reads compartments (4 of 4), so the observer tells the two regimes
apart on unseen seeds.

Full tables: [tables.md](tables.md) (per seed and window), [summary.json](summary.json),
[territories.md](territories.md), [dt-check.md](dt-check.md). Plan and thresholds: [PLAN.md](PLAN.md). All numbers are from seeds 13 to 16; seed 1 was used only to develop the observer.

## What a "droplet" was in the confirmation

For one wall type at a time, a connected patch (4 neighbours, edges wrap) of at least 3 tiles on which that
type's wall is at least 205 of 1024 units (0.20 of a tile). `drop` is the number of such patches summed over
the six types, taken every 500 steps. The rule does not ask whether a patch is closed, lasts, stays in place or
has a parent. This check uses the same rule and, at every one of its censuses, got the same count as the
confirmation's own function.

## Readouts, settled window of each world (range over seeds 13 to 16)

| Readout | PHAGE, steps 60,000 to 80,000 | NO_PHAGE, steps 220,000 to 240,000 | SINGLE_WALL, steps 60,000 to 80,000 | One wall, B2 rates, 64 x 64, steps 10,000 to 30,000 | One wall, spot rates, 64 x 64, steps 10,000 to 30,000 |
|---|---|---|---|---|---|
| Objects counted (mean per seed) | 66.8 to 72.0 | 32.5 to 34.5 | 8.9 to 19.9 | 6.3 to 7.0 | 114.8 to 122.0 |
| Same id still present after 100 steps | 58% to 62% | 28% to 30% | 81% to 84% | 29% to 35% | 100% |
| Same id still present after 1,000 steps | 2% to 3% | under 0.1% (0 to 1 objects per seed) | 20% to 23% | 0% | 100% |
| Median move in 100 steps (tiles) | 2.8 to 3.3 | 8.0 to 8.8 | 1.3 | 6.6 to 10.1 | 0.0 |
| Median move in 1,000 steps, objects still present (tiles) | 10.8 to 14.5 | too few survive (0 to 1 objects per seed) | 9.9 to 10.4 | none survive | 0.0 |
| Object's tiles still in the same id after 1,000 steps | 0.15% to 0.19% | at most 0.06% | at most 0.01% | 0% | 100% |
| Object's tiles still wall of that type after 100 steps | 18% to 20% | 5% to 6% | 33% to 36% | 3% | 100% |
| Same after 1,000 steps (chance level) | 7% to 10% (3% to 4%) | 20% (20%) | 1% (1% to 2%) | 19% to 21% (19% to 20%) | 100% (13%) |
| Solid (centroid tile inside the object) | 84% to 86% | 65% to 67% | 89% to 91% | 59% to 62% | 100% |
| Isolated (alone in its patch of total wall of 0.05 or more) | 4% to 5% | 0% | 63% to 70% | 0% | 76% to 84% |
| Moat (share of tiles 2 to 3 steps out with total wall under 0.05), median | 0.22 to 0.25 | 0.05 to 0.07 | 0.43 to 0.44 | 0.00 | 0.93 |
| Peak wall on an object, median (fraction of a tile) | 0.26 | 0.24 to 0.25 | 0.25 | 0.24 | 0.54 |
| Largest wall on a tile of an object, any frame of the window | 0.44 to 0.47 | 0.41 to 0.44 | 0.43 to 0.48 | 0.31 to 0.33 | 0.62 to 0.69 |
| Median object area (tiles) | 20 to 22 | 57 to 60 | 12 to 13 | 71 to 85 | 4 |
| Tiles inside objects | 15% to 16% | 20% | 1% to 2% | 19% to 20% | 12% to 13% |
| Tiles with total wall of 0.05 or more | 65% to 69% | 88% to 89% | 4% to 8% | 92% to 93% | 38% to 39% |
| Share of those tiles in one connected patch | 94% to 95% | 100% | 17% to 25% | 100% | 2% |
| Births per object per 1,000 steps (10-step frames) | 7.5 to 8.4 | 18.1 to 18.5 | 2.7 to 2.8 | 17.0 to 17.6 | 0.001 to 0.040 |
| Fission daughters still present after 500 steps | 5% to 6% | 0% | 16% to 20% | 0% | no fissions in this window (82% to 87% in steps 0 to 10,000) |
| Median lifetime of objects born and ended in the window, steps (objects per seed) | 30 to 40 (10,691 to 11,338) | 20 (11,959 to 12,132) | 40 to 60 (485 to 1,102) | 20 (2,265 to 2,317) | 10 to 20 (3 to 91; these are brief threshold crossings, and spots already present at the start of the window are not in this figure) |
| How objects end: fade / absorbed / type switch | 50% to 53% / 46% to 49% / 1% | 41% to 42% / 58% to 59% / under 0.5% | 85% to 89% / 11% to 15% / none | 37% to 40% / 60% to 63% / none | 100% / none / none |
| Own-type wall as a share of all wall on the object's tiles, median | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| Reading per seed | wave patches, 4 of 4 | wave patches, 4 of 4 | mixed, 4 of 4 | wave patches, 4 of 4 | bodies, 4 of 4 |
| Division (lasting births with a parent / all, pooled over tracked windows) | 4,231 / 6,400 = 66%: does not hold | 599 / 967 = 62%: does not hold | 1,033 / 2,088 = 49%: does not hold | 8 / 16: not observed (fewer than 20) | 427 / 496 = 86%: holds |
| **Answer** | **wave patches** | **wave patches** | **mixed** | **wave patches** | **compartments** |

Notes on three rows. The lifetime row leaves out every object that was present at the start of the window or
still present at its end, so it is censored toward short lives; the "same id still present" rows are the
uncensored version. A fission is not an end here: the part sharing most tiles keeps the id and the other parts
are births. "Absorbed" means at least one of the object's tiles was taken by an object that kept another id
(see Departures).

Which criteria decided it (PLAN.md names):

- PHAGE and NO_PHAGE: none of B1 (lasts), B2 (stays), B3 (closed) held in any seed; all of V1, V2, V3 held in
  every seed.
- SINGLE_WALL: none of B1, B2, B3 held in any seed. V1 failed (20% to 23% keep their id for 1,000 steps; the
  limit is 10%) and V3 failed (63% to 70% isolated; the limit is 25%). V2 held.
- The earlier NO_PHAGE windows (steps 0 to 10,000 and 60,000 to 80,000) read "mixed" in all four seeds, on V2
  alone: 20% of object tiles are wall of the same type again after 1,000 steps against a chance level of 3% to
  10%. The exploratory table below shows why: without phage each wall type holds a region of the dish for
  thousands of steps, and waves of that type keep crossing the same ground. The objects themselves do not
  last there either (0% to 1% keep their id for 1,000 steps).

## What the objects are

**PHAGE.** About two thirds of the dish (65% to 69% of tiles) carries thin wall of 0.05 or more, and 94% to
95% of that is one connected sheet. Each wall type holds regions of the sheet. The counted objects are the
places where one type's wall rises above 0.20: a median peak of 0.26 of a tile, median area 20 to 22 tiles,
15% to 16% of the dish. Of the objects present at a census, 58% to 62% still have their id 100 steps later,
12% to 15% after 500 steps and 2% to 3% after 1,000. The few that do last 1,000 steps have moved a median of
10.8 to 14.5 tiles, several times their own radius of about 2.6 tiles. Over every sampled object that could
be read again 1,000 steps later (2,604 to 2,809 per seed), 0.15% to 0.19% of an object's tiles are still
inside the same id. 4% to 5% of objects are alone in their patch of wall; the rest are joined to other objects by wall of 0.05 or
more. New objects appear at 7.5 to 8.4 per object per 1,000 steps; 5% to 6% of fission daughters still exist
500 steps later, and 12% to 13% ended within 500 steps with at least one tile taken by the parent.

**NO_PHAGE, settled.** One wall type covers 88% to 89% of the dish as a thin sheet with holes, all of it one
connected patch. The objects are crests moving through that sheet. Of the 1,258 to 1,353 sampled objects per
seed that could be read again 1,000 steps later, none keeps its id in seeds 13 and 14 and one does in each of
seeds 15 and 16. The tracker-free readout shows a wake: 100 steps after an object passes, only 5% to 6% of its tiles
are still above the threshold, well under the 20% that chance gives, and by 1,000 steps it is back at chance.
This is the same signature as the one-wall reference at B2 rates (3% after 100 steps, 19% to 21% after 1,000,
chance 19% to 20%), which is what the settled no-phage world nearly is (diversity 1.08 to 1.10).

**SINGLE_WALL (one type, phage on).** Little wall (4% to 8% of tiles at 0.05 or more), in 9 to 20 separate
patches with a median peak of 0.25 and median area 12 to 13 tiles. Two thirds are isolated. They move about
1.3 tiles per 100 steps and about 10 tiles per 1,000, and at most 0.01% of an object's tiles are still its
own after 1,000 steps; 20% to 23% keep their id that long. The count was still moving inside the window in seeds 13, 15
and 16 (the two halves differ by 10% or more). Seeds 13 and 14 then died: the last census with any object
was step 93,500 in seed 13 and step 159,000 in seed 14 (one census later the count is zero). The objects are moving pulses, not bodies that hold a
place, and not a connected wave field either.

**Peak wall.** The seeded patches start at 0.85. In every B2-rate world the median peak on an object is 0.24
to 0.26, and the largest wall on any object's tile at any frame is under 0.49 in every tracked window after
step 60,000 (0.33 in the 64 x 64 reference after step 10,000). There is no dense phase: nothing approaches
1.0. The spot-rate reference peaks at 0.54 (median).

**Wall matter.** At `kDeg 0.06` a unit of wall lasts about 17 steps, so no world here, the spot reference
included, keeps any of its wall matter for 1,000 steps. The readout that separates the regimes is place, not
matter.

**Wall type.** Fission daughters have the parent's type by construction of the rule. Type switches (the
`mutMotif` rule flipping a radius-3 patch) are 11% to 12% of births in PHAGE and 13% to 14% in settled
NO_PHAGE, and none in the one-type worlds. Objects are pure: the median share of own-type wall among all wall
on an object's tiles is 1.00 (to two decimals) in every world, window and seed.

## What the snapshots show

Each PNG has three columns 1,000 steps apart for seed 13. Top row: wall density, each type in its own colour,
brightness the square root of density. Bottom row: tiles inside a counted object in the type's colour; tiles
with total wall of 0.05 or more but in no object in grey; the rest black.

- [snap-PHAGE-seed13-70k.png](snap-PHAGE-seed13-70k.png): the top row is a patchwork of coloured regions of
  thin wall with black holes. The counted objects in the bottom row are thin arcs, hooks and rings along the
  brighter rims of those regions, set in grey. From one column to the next the regions have changed shape and
  many have changed colour; a few large ones can still be matched by eye (the territory table below puts 22%
  to 40% of walled tiles in the same type after 1,000 steps). No counted object can be matched.
- [snap-PHAGE-seed13-230k.png](snap-PHAGE-seed13-230k.png): the same kind of picture 160,000 steps later.
- [snap-NO_PHAGE-seed13-70k.png](snap-NO_PHAGE-seed13-70k.png): four or five large single-colour regions that
  sit in nearly the same place in all three columns. The objects are arcs and rings inside them, different in
  every column.
- [snap-NO_PHAGE-seed13-230k.png](snap-NO_PHAGE-seed13-230k.png): one colour fills the dish as a sheet with
  black holes; the objects are rings round the holes and bands between them. Small dots of other colours are
  mutation patches.
- [snap-SINGLE_WALL-seed13-70k.png](snap-SINGLE_WALL-seed13-70k.png): about twenty separate small blobs on
  black, some ring-shaped. Different places in each column. (This seed's world is empty from step 94,000, so
  there is no later picture.)
- [snap-ONE64_B2-seed13-20k.png](snap-ONE64_B2-seed13-20k.png): a sheet of thin wall with a few holes, and
  rings and bands round them. The same look as settled NO_PHAGE.
- [snap-ONE64_SPOT-seed13-20k.png](snap-ONE64_SPOT-seed13-20k.png): a lattice of about 120 small bright
  spots on black. The three columns are the same picture.

## Exploratory: regions held by one type (not in PLAN.md)

From the saved snapshots (`territories.ts`; one triple of snapshots per seed and time, so these are single
readings, not averages). A tile is walled if its total wall is 0.05 or more; its type is the type with most
wall there. The share below is, of the tiles walled at the first snapshot, those that are walled with the same
leading type later. The chance level is what two unrelated maps with the same type shares would give after
2,000 steps.

| World, snapshots | Still walled with the same leading type after 1,000 steps | After 2,000 steps | Chance after 2,000 |
|---|---|---|---|
| PHAGE, 70,000 to 72,000 | 22% to 38% | 6% to 24% | 7% to 12% |
| PHAGE, 230,000 to 232,000 | 31% to 40% | 8% to 19% | 9% to 14% |
| NO_PHAGE, 70,000 to 72,000 | 79% to 86% | 79% to 83% | 26% to 42% |
| NO_PHAGE, 230,000 to 232,000 | 82% to 89% | 84% to 89% | 83% to 88% |

Without phage and with several types still present (steps 70,000 to 72,000) a type's region holds its ground
over 2,000 steps. With phage the regions themselves are replaced: after 2,000 steps the share is between 1
point below and 12 points above the chance level (eight readings: four seeds, two times). Once one type fills
the no-phage dish the readout says nothing, because the chance level is as high as the share. Full table:
[territories.md](territories.md).

## What this means for the confirmation's five endpoints

The verdict was computed by a frozen rule and is not changed by this check. What changes is what three of the
five endpoints can be said to measure.

- **D3 (more leader sweeps than no phage) and D4 (higher diversity than pattern-blind phage)** use shares of
  wall matter by type. They do not use the object count and mean what RESULT.md says.
- **D1 (more droplets than pattern-blind phage).** Pattern-blind phage was extinct in all 8 confirmation
  seeds, so D1 compares a living world with a dead one. That reading stands with "patches of wall above 0.20"
  in place of "droplets". This check did not run that arm.
- **D2 (more droplets than single wall).** True as a count of patches. It is not a count of individuals in
  either world. In these runs the six-type world has 15% to 16% of its tiles inside objects and the single-wall
  world 1% to 2%, so the gap is mostly a gap in how much wall the dish holds.
- **D5 (persists: at least half the no-phage count, diversity at least 2, droplets and phage alive).** The
  count comparison does not mean what "about 70 droplets with phage, about 33 without" suggests. The settled
  no-phage world has more of its tiles inside objects than the phage world (20% against 15% to 16%), in
  fewer, larger patches (median 57 to 60 tiles against 20 to 22). Phage does not double a population; the
  phage world's wall is cut into more pieces. The diversity and alive parts of D5 stand.
- **"Steady turnover among the six patterns"** stands, as a statement about which wall type holds how much of
  the wall. The exploratory table adds that with phage the regions held by a type are themselves largely
  replaced within about 2,000 steps (single snapshot triples per seed, not averages).
- **Individuals.** Nothing in these readouts supports treating a counted droplet as an individual with a
  lifetime, a place or a line of descent, at the B2 default rates. Division does not hold in any of the
  three 128 x 128 worlds: 49% to 66% of lasting births have a parent by overlap where the plan asked for 80%, and most fission
  daughters are gone within 500 steps (94% to 96% in PHAGE, 98% to 100% in NO_PHAGE, 80% to 88% in
  SINGLE_WALL, over all tracked windows).

## Proposed wording changes (not applied; these files are not edited by this line)

`apps/lab/oligomer/index.html`

1. Line 27. Current: "Droplets that fight over wall patterns". Suggested: "Six wall patterns that fight over
   one dish".
2. Line 28. Current: "Wall matter of one pattern clumps together and pushes the other patterns away, so
   patches of dense wall, the droplets, form by themselves. Droplets are not declared: there is no alive flag
   and no split rule, and the droplet count is read afterwards by a program that counts connected patches of
   dense wall." Suggested: "Wall matter of one pattern pushes the other patterns away, so each pattern holds
   its own regions of thin wall, and waves of thicker wall move through those regions. Nothing is declared:
   there is no alive flag and no split rule. The patch count on this page is read afterwards by a program
   that counts connected patches where one pattern's wall is at least 0.2 of full density. In our check
   (128 x 128, seeds 13 to 16) those patches were crests of moving waves, not closed bodies: about 2 in 100
   were still there 1,000 steps later, and those had moved well away from where they were."
3. Line 29. Current: "drifts through the water between droplets". Suggested: "drifts through the dish".
4. Line 30. Current: "What is not written in is where droplets sit, how many there are, when they split, or
   which pattern leads." Suggested: "What is not written in is where the patches of wall are, how many there
   are, or which pattern leads."
5. Line 31. Current: "but with only 10 to 19 droplets. Late droplet counts: 65 to 70 with phage, 59 to 65
   without, 17 to 25 with one wall pattern only. One 256 x 256 run of 10,000 steps held about 287 droplets
   late." Suggested: the same sentences with "wall patches" for "droplets" and "patch counts" for "droplet
   counts", and the same change in the re-run sentence that follows ("held 68 to 71 droplets late"). Add:
   "A patch count measures how much wall is above 0.2 and how finely it is cut. It is not a number of
   individuals."
6. Line 32. Current: "the droplet count passed 1.5 times its starting number by step 200". Suggested: "the
   patch count passed 1.5 times its starting number by step 200".
7. Line 65. Current: `label="Droplet worlds (nothing is switched on; droplets form by themselves)"`. Suggested:
   `label="Wall-wave worlds (nothing is switched on; patches of wall form and move by themselves)"`.
8. Line 116. Current: "Droplets (every 100 steps)". Suggested: "Wall patches (every 100 steps)".
9. Line 124. Current: "the droplet count (dense patches of wall)". Suggested: "the patch count (connected
   patches where one pattern's wall is at least 0.2 of full density)".
10. Line 137. Current: "the droplet count is connected patches of at least three squares, each at 0.2 of full
    wall density or more in one pattern, so a droplet holding two patterns is counted once per pattern;
    pattern shares are over all wall matter in the dish, including the thin wall between droplets; squares are
    read, not tracked individuals". Suggested: "the patch count is connected patches of at least three
    squares, each at 0.2 of full wall density or more in one pattern, so a patch holding two patterns is
    counted once per pattern; wall never gets much denser than that (the typical peak on a patch is about a
    quarter of full density); most of the wall is thin wall outside the patches, and pattern shares are over
    all of it; a patch is a crest of a moving wave, not a tracked individual, and in our check about 2 in 100
    were still there 1,000 steps later".

`apps/lab/src/oligomer/droplet-worlds.ts` (the per-world notes the page shows; there is no entry for these
worlds in the `/worlds/` catalogue at this commit, checked with `git grep -il droplet` and `oligomer`)

11. Line 93. Current: "Droplets start in six wall patterns (the names and colours on this page are display
    labels only)." Suggested: "The dish is seeded with patches of six wall patterns (the names and colours on
    this page are display labels only)."
12. Lines 95, 99, 102, 106. Current: "it held 59 to 65 droplets late", "held 60 to 68 droplets late", "it held
    10 to 19 droplets late", "held 4 to 15 droplets late", "it held 17 to 25 droplets late", "held 19 to 29
    droplets late", "it held 65 to 70 droplets late", "held 68 to 71 droplets late". Suggested: the same
    figures with "wall patches" for "droplets".
13. Line 106, the PHAGE note. Add at the end: "The patches are crests of moving waves of wall, not closed
    bodies: in our check (seeds 13 to 16) about 2 in 100 were still there 1,000 steps later."

`apps/lab/src/oligomer/droplet-page.ts`

14. Line 56. Current: "Each droplet takes the colour of its main wall pattern, brighter where the wall is
    thicker. Edges fade out; the thin wall between droplets is not drawn." Suggested: "Each square takes the
    colour of its main wall pattern, brighter where the wall is thicker. Thin wall is not drawn, so the picture
    shows only the crests; most of the dish holds thin wall between them."
15. Lines 167 and 282. Current: "Droplets: 0 to ${maxDrops}" and "Number of droplets over time." Suggested:
    "Wall patches: 0 to ${maxDrops}" and "Number of wall patches over time."

`experiments/confirm/RESULT.md` (a dated record; suggested as an added note, not an edit of the text)

16. Current, under "Direction": "droplets stay near 70", "with about 33
    droplets". Suggested note under "Limits on this decision": "The droplet count is a count of connected
    patches of wall above 0.20. A later check (docs/b2-compartment-check-2026-11-21) found that in the PHAGE
    and NO_PHAGE worlds these patches are crests of moving waves, not compartments: 2% to 3% (PHAGE) and
    under 0.1% (NO_PHAGE) keep their identity for 1,000 steps. D1, D2 and D5 compare amounts and fragmentation of wall
    pattern, not numbers of individuals. D3 and D4 do not use the count."

## Departures from PLAN.md

- **GPU, not CPU.** Stated in PLAN.md before the runs.
- **Extension.** The optional extension PLAN.md allowed was run (below).
- **"Absorbed".** PLAN.md says an object is absorbed when its tiles are "all taken" by an object that kept
  another id. The tracker marks it absorbed when any of its tiles is. An object that mostly fades while a
  neighbour takes one tile is therefore read as absorbed, and "rejoined parent" figures include such cases.
  This changes the split of ends between "fade" and "absorbed" only. No criterion (B1 to B3, V1 to V3,
  division) uses how an object ended. The frames are not stored, so the stricter rule was not recomputed.
- **V2 after review.** PLAN.md says "within 0.10 of the chance level". The code first tested only "at most
  0.10 above chance". It now tests the distance on either side. No reading in any of the 52 tracked windows
  changed (tables.md is byte-identical before and after).
- **Territory table.** Added after the runs; exploratory.

## Run lengths, settling and limits

- Runs: PHAGE, SINGLE_WALL and NO_PHAGE 240,000 steps (PHAGE and SINGLE_WALL were planned at 80,000 and
  extended), the 64 x 64 references 30,000 steps, seeds 13 to 16, all on the frozen kernel's GPU form. The brief suggested the CPU reference; it runs at
  about 2 steps per second on this machine today. `gpu-check.ts` found the GPU equal to the CPU reference bit
  for bit after 100 steps on PHAGE, NO_PHAGE and SINGLE_WALL, seed 13.
- Every census had zero matter residual and an object count equal to `observeFindDroplets(...).length`.
- Runs are cut into segments and restarted from saved states. `resume-check.ts` stepped PHAGE, NO_PHAGE and
  SINGLE_WALL, seed 13, to step 20,000 in one go and got exactly the saved state that the segmented run reached
  through a restart at step 10,000.
- Settling: the PHAGE count is 65.0 to 72.2 in every stretch from step 10,000 to step 240,000 in all four
  seeds. The NO_PHAGE
  count falls until about step 120,000 to 200,000 and is 32.1 to 34.5 from step 200,000 in all four seeds,
  with diversity 1.08 to 1.10. SINGLE_WALL does not settle (see above).
- The optional extension in PLAN.md was run: PHAGE and SINGLE_WALL were continued to 240,000 steps with a
  third tracked window at 220,000 to 240,000. PHAGE reads wave patches there in 4 of 4 seeds with the same
  figures (count 67.7 to 71.0; 2% to 3% keep their id for 1,000 steps; 4% to 5% isolated; median peak 0.26).
  SINGLE_WALL has no objects there in seeds 13 and 14 (extinct) and reads mixed in seeds 15 and 16 (18% to
  19% keep their id for 1,000 steps; 64% isolated). The answers above use the planned settled windows; the
  division figures pool every tracked window, the extension included.
- The confirmation judged steps 400,000 to 500,000. These windows are earlier.
- Tracking reads the world every 10 steps and links objects by shared tiles. Whether that spacing loses ids
  was checked directly ([dt-check.md](dt-check.md)): the same 5,000 steps of the same world, seed 13, followed
  at spacings of 1, 2, 5 and 10 steps. The share keeping their id for 1,000 steps is 2.6%, 2.7%, 2.9%, 3.2% in
  PHAGE; 0.0% at every spacing in settled NO_PHAGE and in the one-wall B2 reference; 15.1%, 15.1%, 15.8%,
  19.7% in SINGLE_WALL. Finer spacing does not raise it, so the short lives are not a tracking loss. The check
  is one seed and 5,000 steps per world.
- Birth and end rates do depend on the spacing: finer frames see more brief splits and merges. Births per
  object per 1,000 steps in that check go from 7.2 (10-step frames) to 15.4 (1-step frames) in PHAGE and from
  18.4 to 33.4 in settled NO_PHAGE. The rates in the table are for 10-step frames.
- "Lasting births" and fission counts depend on the 3-tile minimum and the 0.20 threshold; a patch that dips
  under either and returns is counted as an end and a birth from nothing.
- The pattern-blind-phage arm was not run.
- The territory table is exploratory and rests on one triple of snapshots per seed and window.
- This check says nothing about the six-wall world at the spot rates. The one-wall, no-phage reference at
  those rates gives compartments; whether a six-wall world with phage at those rates keeps the confirmation's
  endpoints was not tested.

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
experiments/b2check/run-all.sh a      # GPU check; PHAGE, SINGLE_WALL (80,000 steps); ONE64_B2, ONE64_SPOT; seeds 13 to 16
experiments/b2check/run-all.sh b      # NO_PHAGE (240,000 steps), seeds 13 to 16
experiments/b2check/run-all.sh c      # extension: PHAGE and SINGLE_WALL to 240,000 steps
experiments/b2check/run-all.sh snaps  # the PNGs in this folder
deno run -A --no-lock experiments/b2check/summarize.ts --runs runs/b2check --json docs/b2-compartment-check-2026-11-21/summary.json > docs/b2-compartment-check-2026-11-21/tables.md
deno run -A --no-lock experiments/b2check/territories.ts --runs runs/b2check > docs/b2-compartment-check-2026-11-21/territories.md
# frame-spacing check; dt-check.md is the output of these four, in this order
deno run -A --no-lock experiments/b2check/dt-check.ts --dir runs/b2check/PHAGE/seed-13 --from 60000
deno run -A --no-lock experiments/b2check/dt-check.ts --dir runs/b2check/NO_PHAGE/seed-13 --from 220000
deno run -A --no-lock experiments/b2check/dt-check.ts --dir runs/b2check/SINGLE_WALL/seed-13 --from 60000
deno run -A --no-lock experiments/b2check/dt-check.ts --dir runs/b2check/ONE64_B2/seed-13 --from 10000
# a run restarted from saved states equals a continuous run (PHAGE, NO_PHAGE, SINGLE_WALL)
deno run -A --no-lock experiments/b2check/resume-check.ts --dir runs/b2check/PHAGE/seed-13 --to 20000
pnpm vitest run experiments/test/b2check-observe.test.ts
deno check --no-lock experiments/b2check/*.ts
pnpm typecheck
```

Raw outputs are in `runs/b2check/` in this worktree (gitignored): one folder per world and seed with a JSON
file per segment, saved states and snapshots. `runs/b2check/dev/` holds the seed 1 development runs.
