# SPOT6: calibration (2026-11-22)

**Outcome: no listed setting reads *bodies with turnover*. The spot regime does carry to six walls, and with
phage the bodies stay and the phage lives, but at all three settings that got that far the world is a
*frozen mosaic*: a fixed lattice of bodies with no sustained division (no new body by fission in any settled
window), the six patterns held near equal shares, and pattern turnover within about a tenth of the same world
without phage (0.86 to 1.12 times). At the default rates the world is waves, as known. Nothing is frozen for
seeds 33 to 40.**

Every run here is on seeds 1 to 4, which had been used before. None of this is evidence; it is a calibration
that says where a confirmation would or would not be worth running. Plan, thresholds and named outcomes:
[PLAN.md](PLAN.md), written and reviewed before the first six-wall run at a non-default rate. Full tables:
[tables.md](tables.md) and [summary.json](summary.json) (both written by `summarize.ts` from the raw run
files). Diagnostic table: [regrowth.md](regrowth.md).

## Settings, gate and outcome

128 x 128, the frozen kernel, phage parameters at the frozen defaults. A setting changes only the wall's decay
(`kDeg`) and the two diffusion rates (`diffW` for wall, `diffF` for fuel).

| Setting | `kDeg` / `diffW` / `diffF` | Clean-arm gate (no phage, seeds 1 and 2) | With phage (seeds 1 and 2) | All four arms (seeds 1 to 4) | Outcome |
|---|---|---|---|---|---|
| `B2` (the confirmation's rates; reference) | 0.060 / 0.040 / 0.200 | fails: mixed on both seeds (none of B1, B2, B3) | wave patches on both seeds | not a candidate | **back to waves** |
| `MIX25` | 0.06625 / 0.03375 / 0.225 | fails: mixed on both seeds (B2, "stays", not met) | not run | not run | **mixed / unclear**: did not pass the gate |
| `MIX50` | 0.0725 / 0.0275 / 0.250 | passes: bodies on both | bodies, phage alive: goes on | read | **frozen mosaic** |
| `MIX75` | 0.07875 / 0.02125 / 0.275 | passes: bodies on both | bodies, phage alive: goes on | read | **frozen mosaic** |
| `SPOT` (the pure spot rates) | 0.085 / 0.015 / 0.300 | passes: bodies on both | bodies, phage alive: goes on | read | **frozen mosaic** |
| `DIFF_ONLY` (default decay, spot diffusion) | 0.060 / 0.015 / 0.300 | fails: persistent domains, not bounded, on both (B3) | not run | not run | **mixed / unclear**: did not pass the gate |

No reading window needed the extension rule: every stage 1 and stage 2 window at steps 20,000 to 40,000 was
settled, and so was every stage 3 window at steps 80,000 to 100,000. The two phage variants were not run: the
plan allows them only if no setting goes on to stage 3, and three did.

## What the six worlds are without phage (stage 1; steps 20,000 to 40,000, seeds 1 and 2)

| Readout | `B2` | `MIX25` | `MIX50` | `MIX75` | `SPOT` | `DIFF_ONLY` |
|---|---|---|---|---|---|---|
| Objects counted | 56 to 57 | 155 | 282 to 283 | 363 to 371 | 442 to 448 | 679 |
| Same id still present after 1,000 steps | 0% | 54% to 55% | 80% to 81% | 87% | 91% | 86% to 87% |
| Median move in 1,000 steps (tiles) | 1.3 to 3.0 (6 to 8 objects) | 1.2 to 1.3 | 0.0 | 0.0 | 0.0 | 0.0 |
| Object's tiles still in the same id after 1,000 steps | 0% | 34% to 35% | 79% to 80% | 86% to 87% | 91% | 84% to 85% |
| Isolated | 0% | 60% to 61% | 100% | 97% to 99% | 72% to 73% | 0% |
| Moat, median | 0.09 | 0.66 | 0.95 | 1.00 | 0.89 | 0.19 |
| Median peak wall / median area (tiles) | 0.24 to 0.25 / 31 to 32 | 0.28 / 18 | 0.33 / 11 | 0.39 / 6 | 0.54 / 4 | 0.43 / 6 |
| Tiles with total wall of 0.05 or more | 87% | 55% | 44% | 39% to 40% | 39% | 90% to 91% |
| New bodies in the window: by fission / from nothing | 0 / 32 to 35 | 3 to 5 / 1 | 0 / 0 | 0 / 0 | 0 / 0 to 1 | 0 / 1 |
| Pattern changes per body per 1,000 steps | 0.000 to 0.001 | 0.096 to 0.102 | 0.188 to 0.191 | 0.124 to 0.129 | 0.081 to 0.086 | 0.108 to 0.115 |
| Mean diversity (Hill D1; 6 is the most) | 5.24 to 5.41 | 5.90 to 5.92 | 5.95 | 5.95 | 5.96 | 5.98 |
| Reading | mixed | mixed | bodies | bodies | bodies | persistent domains, not bounded |

- `MIX50`, `MIX75`, `SPOT`: a fixed lattice of small bodies. The count does not move (282 to 284 at every
  census of `MIX50` seed 1, for example). In the founding window (steps 0 to 10,000) the lattice fills by
  fission: by the plan's cautious rule, 64 to 71 new bodies by fission per seed at `MIX50`, 205 to 207 at
  `MIX75`, and 211 to 217 at `SPOT` (plus 15 to 25 there from nothing). In the settled window there are none
  by fission, and one from nothing in all six runs (`SPOT`, seed 2).
  The only thing that happens to a body is that the kernel's `mutMotif` rule relabels it: 717 to 1,088 lasting
  type switches per seed in 20,000 steps, each of which the compartment check's rule would have counted as a
  birth with a parent.
- `MIX25`: bodies that last and are bounded but do not stay put. Just over half keep their id for 1,000 steps
  and those have drifted 1.2 to 1.3 tiles; 34% to 35% of an object's tiles are still its own. The snapshot
  shows short worms and blobs that creep, touch and part. Under the counting rule that gives many ends and
  re-separations (288 to 293 lasting ends not returned, 115 to 123 rejoinings, 341 to 352 returns per seed)
  and 3 to 5 new bodies by fission. It fails the gate on B2 alone, so by the plan nothing with phage was run
  there. This is the one listed setting whose bodies move, and the gate as written does not let it through.
- `DIFF_ONLY`: about 680 small dense patches packed edge to edge in a sheet of thin wall (90% of tiles carry
  wall; no object is alone in its patch). They hold their place and id; they have no water round them.
- `B2`: the known wave world.

The `SPOT` no-phage lattice does not fill the dish by step 40,000: the snapshot shows empty lanes between the
25 colonies that grew from the seeded patches, and the count is flat (445 to 450). With phage the lanes are
filled (below).

## With phage (stage 3; steps 80,000 to 100,000, range over seeds 1 to 4)

| Readout | `MIX50` phage | `MIX50` no phage | `MIX75` phage | `MIX75` no phage | `SPOT` phage | `SPOT` no phage |
|---|---|---|---|---|---|---|
| Objects counted | 286 to 288 | 281 to 285 | 385 to 390 | 361 to 371 | 446 to 471 | 446 to 452 |
| Same id still present after 1,000 steps | 80% to 82% | 79% to 81% | 89% to 90% | 87% to 88% | 88% to 90% | 91% |
| Object's tiles still in the same id after 1,000 steps | 79% to 80% | 78% to 80% | 88% to 89% | 87% | 87% to 89% | 91% |
| Isolated | 100% | 100% | 100% | 97% to 99% | 96% to 98% | 75% to 80% |
| Moat, median | 0.97 | 0.95 to 0.97 | 1.00 | 1.00 | 0.94 to 0.96 | 0.89 to 0.90 |
| Reading (4 seeds) | bodies, 4 of 4 | bodies, 4 of 4 | bodies, 4 of 4 | bodies, 4 of 4 | bodies, 4 of 4 | bodies, 4 of 4 |
| Window settled | 4 of 4 | 4 of 4 | 4 of 4 | 4 of 4 | 4 of 4 | 4 of 4 |
| Phage, mean over the window (units; the bar for "alive" is 410) | 11,642 to 18,672 | none | 76,080 to 88,011 | none | 124,264 to 143,255 | none |
| Phage alive (and phage types above a sixth of the bar) | 4 of 4 (6 types) | | 4 of 4 (6 types) | | 4 of 4 (6 types) | |
| New bodies: by fission / from nothing, per seed | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 46 to 74 | 0 / 0 to 2 |
| Share of new bodies with a parent | none to read | | none to read | | 0 of 225 | |
| Lasting births not counted: type switch, per seed | 1,023 to 1,083 | 1,053 to 1,131 | 768 to 794 | 877 to 914 | 701 to 775 | 738 to 767 |
| Lasting births not counted: returned (same place, at most 500 steps after an end), per seed | 0 | 0 | 0 | 0 | 118 to 177 | 4 to 17 |
| Lasting ends (fade or absorbed) not returned, per seed | 0 to 2 | 0 to 1 | 0 | 0 | 62 to 104 | 0 to 4 |
| Body turnover per body per 1,000 steps: new bodies / ends | 0.0000 / 0.0000 to 0.0003 | 0.0000 / 0.0000 to 0.0002 | 0.0000 / 0.0000 | 0.0000 / 0.0000 | 0.0049 to 0.0081 / 0.0066 to 0.0114 | 0.0000 to 0.0002 / 0.0000 to 0.0004 |
| Pattern changes (type switches) per body per 1,000 steps | 0.179 to 0.189 | 0.186 to 0.202 | 0.099 to 0.102 | 0.122 to 0.125 | 0.077 to 0.085 | 0.081 to 0.086 |
| Pattern turnover of the wall shares, lag 1,000 steps | 0.032 to 0.040 | 0.034 to 0.038 | 0.022 to 0.025 | 0.023 to 0.026 | 0.016 to 0.017 | 0.016 to 0.019 |
| Pattern turnover above no phage (at least 0.01 and 1.5 times) | 0 of 4 | | 0 of 4 | | 0 of 4 | |
| Same with no margin: plainly higher than no phage (ratio per seed) | 3 of 4 (1.05, 1.04, 1.12, 0.89) | | 2 of 4 (1.04, 1.06, 0.99, 0.86) | | 1 of 4 (0.93, 0.93, 1.08, 0.87) | |
| The tracker's own lasting births by fission, before this line's exclusions, per seed | 0 | 0 | 0 to 1 | 0 | 0 | 0 |
| Same at lag 5,000 steps (no role in the rule) | 0.060 to 0.077 | 0.062 to 0.070 | 0.038 to 0.047 | 0.046 to 0.053 | 0.027 to 0.036 | 0.032 to 0.039 |
| Tiles keeping their leading type after 1,000 steps (no role) | 78% to 80% | 78% to 80% | 87% | 86% to 87% | 90% to 91% | 91% to 92% |
| Mean diversity (Hill D1) | 5.93 to 5.96 | 5.94 to 5.96 | 5.97 to 5.98 | 5.96 to 5.97 | 5.98 to 5.99 | 5.97 to 5.98 |
| Stage 3 rule | **frozen mosaic** (no new bodies) | | **frozen mosaic** (no new bodies) | | **frozen mosaic** (pattern turnover not above no phage) | |

All four seeds are eligible at each setting (objects at the end, bodies, phage alive, settled window).

**Which criteria decided it.**

- `MIX50`, `MIX75`: 0 new bodies in the four settled windows pooled, where the plan asks for 20. Pattern
  turnover is also not above the no-phage world, by the plan's margin, on any seed.
- `SPOT`: 225 new bodies pooled, so the first frozen-mosaic test does not fire; the second does: pattern
  turnover is not above the no-phage world on any seed (0.016 to 0.017 against 0.016 to 0.019). Had it not,
  division would still have failed: none of the 225 has a parent (the plan asks for 80%).

**How far the reading depends on the cautions this line added to the brief's thresholds.** No setting reads
*bodies with turnover* under any of them, or without them.

- Keep only the brief's own requirement that a relabelled lattice must not read as dividing (type switches are
  not births), and drop the other five exclusions, the second-half and ends tests and the turnover margin.
  The tracker's own lasting births are then 0 at `MIX50` and 1 in four seeds at `MIX75` (both under 20:
  frozen mosaic) and 799 at `SPOT`, none by fission, where phage's turnover is plainly higher than no phage on
  1 seed of 4 (frozen mosaic). The three outcomes are unchanged.
- Drop the switch exclusion as well, which is the compartment check's rule. `MIX50` then has 4,232 lasting
  switch "births with a parent" and turnover plainly higher on 3 of 4 seeds, so neither frozen-mosaic test
  fires; D4 holds on 2 of 4, and it would read *mixed / unclear*. `MIX75` (turnover higher on 2 of 4) and
  `SPOT` (1 of 4) still read frozen mosaic.
- The turnover margin matters only to the count of seeds at `MIX50` (plainly higher on 3 of 4, by 4% to 12%).

**Division, founding and settled windows separately** (`PHAGE`, four seeds pooled; new bodies as the plan
defines them).

| Setting | Founding window, steps 0 to 10,000: by fission / all | Settled window, steps 80,000 to 100,000: by fission / all | In the second half of the settled window | Lasting ends in the settled window | Division |
|---|---|---|---|---|---|
| `MIX50` | 255 / 255 | 0 / 0 | 0 | 3 | not observed |
| `MIX75` | 890 / 890 | 0 / 0 | 0 | 0 | not observed |
| `SPOT` | 881 / 1,215 | 0 / 225 | 114 | 331 | does not hold (0% with a parent) |

The founding fill is by fission (100%, 100%, 73%). After it, fission stops. A reading that pooled the two
windows, as the compartment check did for the one-wall reference, would have called all three worlds
"compartments that divide".

## The five endpoints (steps 80,000 to 100,000, the final 20% of the run; 3 of 4 in place of 7 of 8)

| Endpoint | What it compares | `MIX50` | `MIX75` | `SPOT` |
|---|---|---|---|---|
| D1 more than pattern-blind phage | **patch counts** | 4 of 4 (286 to 288 against 229 to 242) | 4 of 4 (385 to 390 against 313 to 337) | 4 of 4 (446 to 471 against 37 to 53) |
| D2 more than one wall | **patch counts** | 4 of 4 (against 242 to 253) | 4 of 4 (against 300 to 307) | 4 of 4 (against 42 to 56) |
| D3 more leader sweeps than no phage | which type holds most wall, when one holds 25% | 0 of 4 | 0 of 4 | 0 of 4 |
| D4 diversity above pattern-blind phage | shares of wall by type | 2 of 4 | 3 of 4 | 3 of 4 |
| D5 persists | **patch count** at least half the no-phage count, diversity at least 2, patches and phage present | 4 of 4 | 4 of 4 | 4 of 4 |

- D1, D2 and D5 compare patch counts: the number of patches where one type's wall is at 0.20 or more. They
  are not counts of individuals, and at `SPOT` they are not even counts of spots. A count at lower thresholds
  ([regrowth.md](regrowth.md), second table) shows why. At `MIX50` and `MIX75` every arm has the same number
  of patches at 0.20, 0.10 and 0.05 to within a few patches, so there the count is the number of bodies in the
  lattice. At `SPOT` the
  pattern-blind and one-wall arms have 37 to 56 patches at 0.20 but 393 to 467 at 0.10: the lattice of spots
  is there, held under the counting line by a large standing load of phage (438,000 to 466,000 units). So D1
  and D2 at `SPOT` (446 to 471 against 37 to 56) measure how many spots clear 0.20, not a tenfold difference
  in the number of spots. This is the trap the compartment check found, in a new place.
- The pattern-blind and one-wall arms are alive on every seed at every setting (objects at step 100,000, and
  every one of their final windows reads bodies), so D1, D2 and D4 are comparisons between living worlds. This
  differs from the confirmation, where pattern-blind phage was extinct on 8 of 8 seeds.
- D3 is 0 of 4 everywhere, and not for free in the direction the plan expected: with six types near equal
  shares no type holds 25% of the wall at any census of the reading window in either arm (the largest leading
  share is 0.19 to 0.23 with phage and 0.20 to 0.25 without, the highest single census 0.245), so there are no
  sweeps to count on either side.
- D4 is won on 8 of 12 seed-settings, by 0.011 to 0.026 of a type: diversity is 5.93 to 5.99 in the phage arm
  and 5.93 to 5.99 in the pattern-blind arm, both at the ceiling of 6. D4 does not separate the arms here.
- In the confirmation, diversity was 4.6 under phage against 1.1 without. Here it is 5.9 to 6.0 with and
  without phage: in these runs no pattern loses its share in the no-phage world, so there is no loss for
  phage to prevent.

## Facts the next rung would stand on

**Is a body's wall pattern inherited by its daughters.** The tracker links objects within one type, and the
kernel makes wall only from wall of the same type, so a daughter by fission has its parent's type by
construction and this cannot be read independently. What the runs add: in the founding fill of the phage
worlds, where there are daughters, 2,026 of 2,360 new bodies across the three settings are by fission; the
rest (all 334 at `SPOT`) appear from nothing. In the settled windows there is no new body by fission at any setting, with or without
phage (the tracker records one lasting fission daughter in the twelve phage windows, at `MIX75` seed 1, which
the plan leaves out as one object at the window's start). So in these runs there is no ongoing line of
descent by which a pattern could be carried.

**How often a body changes pattern.** By the kernel's relabelling rule only: 0.18 to 0.19 times per body per
1,000 steps at `MIX50`, 0.10 at `MIX75`, 0.08 at `SPOT` (about once per 5,000 to 13,000 steps), and the same
without phage (0.19 to 0.20, 0.12, 0.08). The rate follows body size (bigger bodies have more tiles the rule
can pick), not phage. The relabelling is a whole-body event: these switches end one id and start another on
the same tiles, which is why the six shares drift at the same slow rate in both arms.

**Does phage of a pattern kill whole bodies or erode them.** At `MIX50` and `MIX75`, almost never either:
phage is alive (11,600 to 88,000 units, all six types) and bodies rarely end (0 to 2 lasting ends per seed in
20,000 steps at `MIX50`, 0 at `MIX75`) and rarely dip (8 to 16 recovered dips per seed among about 1,200
bodies at `MIX50`, the same rate as without phage; none at `MIX75`). Phage sits on bodies as a standing load:
at `MIX50` 24% to 34% of body samples carry at least 1 unit of own-type phage per tile and 1% to 3% at least
10; at `MIX75` 73% to 79% and 50% to 60%. Bodies carrying 10 or more are smaller (8.8 tiles against 10.5 to
10.7 at `MIX50`; 5.1 to 5.3 against 6.4 to 6.7 at `MIX75`) with similar wall per tile (0.280 to 0.281 against
0.288 to 0.290; 0.376 to 0.379 against 0.371 to 0.375). Own-type phage on the tiles of counted objects is
23% to 30% of all the phage in the dish at the last census; counting phage of every type on those tiles, the
final review's own count from the saved states is 25% to 32%. Most of the phage is off the counted objects.

At `SPOT` phage does take bodies out of the count: ends that were not preceded by a dip run at 0.013 to 0.020
per 1,000 body-steps against 0.0001 to 0.0015 without phage, and the body's own phage was 21 to 25 units per
tile at its last sample against a usual 12 to 14. There are no recovered dips. The limit of that readout: a
dip is own wall under half the body's own median, sampled every 50 steps, and `SPOT` bodies are 4 tiles, so a
body that goes from 4 tiles to 3 and then under the 3-tile minimum ends without a dip being seen. The site
is often not vacated. Of the 799 lasting from-nothing births in the four phage windows (new bodies and
returns together), 543 stand within 2 tiles of an object of the same type that faded earlier in the window, 88 near one of another type, and 168 near none; where there is such an object it had
faded a median of 125 to 245 steps before
([regrowth.md](regrowth.md); a diagnostic added after the runs). A count at a lower threshold shows about 100
more same-type patches at 0.10 of a tile than at 0.20, with or without phage (550 to 566 against 445 to 472
with phage; 530 to 546 against 445 to 452 without). This is consistent with many small bodies dropping under
the 0.20 line and reappearing nearby, often in the same pattern. No new body by fission was seen, so nothing
here shows a neighbour's daughter taking a vacated site.

## What this means for the month's first job

The job as stated was "giving droplets a way to make new patterns", which presumes individuals. On seeds 1 to
4 the frozen kernel offers two regimes with six walls and phage:

- at the default rates, turnover among patterns without bodies (the confirmation's world: wave patches);
- from half way to the spot rates onward, bodies without division: a lattice that fills once by fission and
  then stays. Every pattern keeps its share with or without phage, and the pattern shares move no faster with
  phage than without. At the pure spot rates bodies do drop out of the count and come back (225 new bodies
  and 331 lasting ends in four seeds), none of them by fission.

No listed setting has both. The setting between them that was listed (`MIX25`) has moving bodies in its
no-phage world and was stopped by the gate, so what phage does there is not known. That is the one place this
calibration leaves open; reading it would need the gate's "stays put" test relaxed in a new plan, which this
one does not do.

## Snapshots (seed 1; three columns 1,000 steps apart; wall by type above, counted objects below, grey for wall of 0.05 or more outside any object)

- [snap-B2-NO_PHAGE-seed1-30k.png](snap-B2-NO_PHAGE-seed1-30k.png), [snap-B2-PHAGE-seed1-30k.png](snap-B2-PHAGE-seed1-30k.png): the known wave world; regions of thin wall with arcs and rings that differ in every column.
- [snap-MIX25-NO_PHAGE-seed1-30k.png](snap-MIX25-NO_PHAGE-seed1-30k.png): short worms and round blobs on black, each one colour. Most can be matched from column to column, shifted or bent.
- [snap-MIX50-NO_PHAGE-seed1-90k.png](snap-MIX50-NO_PHAGE-seed1-90k.png), [snap-MIX50-PHAGE-seed1-90k.png](snap-MIX50-PHAGE-seed1-90k.png): a regular lattice of round bodies about 3 tiles across. The three columns are the same lattice; a few bodies have changed colour. With and without phage look alike.
- [snap-MIX75-NO_PHAGE-seed1-90k.png](snap-MIX75-NO_PHAGE-seed1-90k.png), [snap-MIX75-PHAGE-seed1-90k.png](snap-MIX75-PHAGE-seed1-90k.png): the same with smaller bodies.
- [snap-SPOT-NO_PHAGE-seed1-90k.png](snap-SPOT-NO_PHAGE-seed1-90k.png): colonies of small spots with empty lanes between them, unchanged over the three columns. [snap-SPOT-PHAGE-seed1-90k.png](snap-SPOT-PHAGE-seed1-90k.png): spots over the whole dish, no lanes, with many grey marks where a spot is under the counting line.
- [snap-DIFF_ONLY-NO_PHAGE-seed1-30k.png](snap-DIFF_ONLY-NO_PHAGE-seed1-30k.png): a dense carpet of small patches, grey between nearly all of them.

## Checks on the runs

- Parity: with no overrides the runner gave the same seven fields as `experiments/confirm/run-droplets.ts` at
  every census on all four arms (seed 1, 5,000 steps, 10 censuses) and the same config key for key
  (`runs/spot6/parity.txt`).
- GPU against CPU: equal on all 229,376 values and the step counter after 100 steps, seed 1, for `PHAGE` and
  `NEUTRAL_PHAGE` at `MIX25`, `MIX50`, `MIX75`, `DIFF_ONLY` and `SPOT`, and for `NO_PHAGE` and `SINGLE_WALL` at
  `SPOT` (12 worlds; `runs/spot6/gpu-check.txt`).
- Every census of every run had zero matter residual and an object count equal to
  `observeFindDroplets(...).length` (the runner stops otherwise; none stopped). The summariser re-checks the
  residual and that no census is missing.
- The frozen files' hashes equal `experiments/confirm/FROZEN.json`; nothing under `experiments/confirm`,
  `experiments/b2check`, `apps` or `packages` differs from `e4b8417c`.

## What was run, what was not, and the budget

| Step | Runs | Wall time |
|---|---|---|
| Parity and the `B2` reference (default rates) | all four arms, seed 1, to 5,000 steps by both runners; `NO_PHAGE` and `PHAGE`, seeds 1 and 2, to 40,000 | about 8 minutes, plus about 15 minutes for two earlier passes that were discarded when the log format changed during review |
| Step 0, GPU against CPU | 12 worlds, 100 steps | about 1 minute |
| Stage 1 | `NO_PHAGE`, seeds 1 and 2, five settings, 40,000 steps | 20 minutes |
| Stage 2 | `PHAGE`, seeds 1 and 2, three settings, 40,000 steps | 12 minutes |
| Stage 3 | four arms, seeds 1 to 4, three settings, 100,000 steps (48 runs; seeds 1 and 2 of `PHAGE` and `NO_PHAGE` continued from stages 1 and 2) | 2 hours 5 minutes |
| **Total** | | **about 3 GPU-hours of the 8 allowed** (9,904 s logged in `runs/spot6/logs/gpu-seconds.log`, plus the discarded reference passes) |

- Nothing was cut for budget. The cap of three stage 3 settings was reached exactly: three advanced, three ran.
- Not run, by the plan's rules: any phage world at `MIX25` or `DIFF_ONLY` (gate); stage 3 at `B2` (reference);
  the phage variants `PH_LONG` and `PH_MILD` (settings advanced); seeds 5 to 40.
- Stage 3 windows are steps 80,000 to 100,000. The confirmation judged steps 400,000 to 500,000. At `MIX50`
  and `MIX75` the count is flat from step 20,000 in every arm, and phage in the phage arm is level from step
  40,000 ([tables.md](tables.md), "Count by stretch"). The `SPOT` phage world is slower: its count climbs from
  395 to 424 (steps 20,000 to 40,000) to 442 to 448 (40,000 to 60,000) and is 446 to 471 in the reading
  window, which passes the 10% test on all four seeds. Nothing here speaks to later times.
- Tracking reads the world every 10 steps and births and ends depend on the 0.20 threshold and the 3-tile
  minimum, as in the compartment check. At `SPOT` bodies are 4 tiles, so the minimum matters there: part of
  the `SPOT` "ends" and "returns" are bodies crossing 3 tiles or 0.20.

## Outside the listed settings, and changes to the plan after the first non-default run

- **No setting, seed or rate outside the plan's list was run.**
- **Diagnostics added after the stage 3 runs** (they read stored files, run no simulation, and feed no rule):
  `experiments/spot6/regrowth.ts` ([regrowth.md](regrowth.md)): where from-nothing bodies stand relative to
  objects that faded, and patch counts at 0.10 and 0.05; and the "phage load" table in
  [tables.md](tables.md) (`phageLoad` in `rule.ts`), added after stage 2 was read. The first version of
  `regrowth.ts` picked the nearest earlier object, not the latest, and gave a misleading gap; it was corrected
  before any number from it was written down.
- **Changes to PLAN.md after the first non-default six-wall run:** none to settings, windows, thresholds,
  rules or outcomes. The plan's last section records the two diagnostics above. The copy of the plan as it
  stood before the first such run is `runs/spot6/PLAN-before-first-run-2026-11-22T0559.md` (not in git);
  the plan in git differs from it only in that last section.

## Departures from the brief, stated

- **Stricter than the brief's thresholds, all fixed in PLAN.md before the first non-default run:** the six
  exclusions that define a "new body"; the tests that a quarter of new bodies fall in the second half of the
  window and that lasting ends are at least half of them; at least 3 seeds with 5 new bodies each; division,
  turnover and D4 read on eligible seeds only; "phage alive" as 10 times the emergence bound in the second
  half and the last 2,000 steps, not "above zero at the end"; "turnover higher than no phage" with a minimum
  and a 1.5 times margin. The section "How far the reading depends on the cautions" says what changes without
  them: no setting becomes *bodies with turnover*.
- **`B2` with phage was run on seeds 1 and 2 although `B2` failed the gate.** The plan made that exception for
  the known reference before the runs; the brief's gate rule has no such exception. It is the default-rate
  world the confirmation and the compartment check had already read.
- **A setting that failed the gate reads *mixed / unclear*** with that reason, so that every setting has one
  of the six named outcomes. No phage world was run or read for it.
- **The last pre-run review finding was fixed without a further review pass.** The third Codex pass found one
  remaining case (finding 14 in PLAN.md); it was fixed with a test and the runs began. The fix can only remove
  births from the count, so it cannot have produced a positive; the final review covers that code.

## Review

Codex (Sol 6.1, High, read-only) reviewed the plan and code three times before the first non-default run; the
fourteen findings and what was changed for each are listed at the end of [PLAN.md](PLAN.md). A fourth pass
reviewed the final state. It recomputed each setting's gate, stage 2 rule, stage 3 rule and endpoints from the
raw segment files with its own script, not this line's summariser, and got the six outcomes of the first
table, with no finding that changes an outcome or a headline number. It also checked the hard constraints
(protected paths equal `e4b8417c`, the 12 frozen hashes, 296 segment headers, seeds 1 to 4 only, 10,280 census
rows with zero residual). Its seven findings about wording and three small number corrections were applied to
this file: the phage-on-objects figure was own-type phage only and is now labelled so; "bodies do not turn
over" overlooked the `SPOT` births and ends; the claim that the outcomes are unchanged without the added
cautions was too strong for `MIX50`; "the same" patch counts across thresholds differ by a few; the erosion
readout cannot show that a body vanishes at full size; regrowth in the same pattern is common, not universal;
and the D4 margins are hundredths.

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
experiments/spot6/run-all.sh parity
experiments/spot6/run-all.sh stage1 "B2"            # reference, default rates
experiments/spot6/run-all.sh stage2 "B2"
experiments/spot6/run-all.sh check                  # step 0
experiments/spot6/run-all.sh stage1 "MIX25 MIX50 MIX75 SPOT DIFF_ONLY"
experiments/spot6/run-all.sh stage2 "MIX50 MIX75 SPOT"
experiments/spot6/run-all.sh stage3 "MIX50"
experiments/spot6/run-all.sh stage3 "MIX75"
experiments/spot6/run-all.sh stage3 "SPOT"
deno run -A --no-lock experiments/spot6/summarize.ts --runs runs/spot6 --json docs/six-wall-spot-2026-11-22/summary.json > docs/six-wall-spot-2026-11-22/tables.md
deno run -A --no-lock experiments/spot6/regrowth.ts --runs runs/spot6 --settings MIX50,MIX75,SPOT --from 80000 > docs/six-wall-spot-2026-11-22/regrowth.md
for st in B2 MIX25 DIFF_ONLY; do experiments/spot6/run-all.sh snap $st NO_PHAGE 1 30000 $st-NO_PHAGE-seed1-30k; done
experiments/spot6/run-all.sh snap B2 PHAGE 1 30000 B2-PHAGE-seed1-30k
for st in MIX50 MIX75 SPOT; do for a in PHAGE NO_PHAGE; do experiments/spot6/run-all.sh snap $st $a 1 90000 $st-$a-seed1-90k; done; done
pnpm vitest run experiments/test/spot6-rule.test.ts experiments/test/b2check-observe.test.ts
deno check --no-lock experiments/spot6/*.ts
pnpm typecheck
```

Raw outputs are in `runs/spot6/` in this worktree (gitignored, 1.7 GB): one folder per setting, arm and seed
with a JSON file per segment, saved states and snapshots; logs in `runs/spot6/logs/`; the Codex prompts and
reviews in `runs/spot6/review/`.
