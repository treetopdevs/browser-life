# MOVING6: calibration (2026-11-22)

**Outcome for `MIX25`: *division without pattern turnover*. Where six-wall bodies move, the world with phage
keeps bodies that divide and die, with phage alive, on 4 of 4 seeds, and on the two seeds run on to steps
180,000 to 200,000 it is still doing so. But the same world without phage divides and dies just as much,
and pattern turnover with phage, though higher on every seed, is higher by 13%, 6% and under 1% on two,
far short of the 1.5 times the plan asks for. D4 holds on 4 of 4 only because the pattern-blind arm is
dead. And the division reading rests on one classification made with the no-phage numbers in view (a
returned body's further pieces set aside; counted as "from nothing" they would give 57% by division and
*mixed / unclear*). The neighbour `MIX12` does not pass the gate (not bodies). The neighbour `MIX37` reads
*moving bodies, no division*: it is already close to the frozen lattice. Nothing is frozen for seeds 33 to
40.**

This is a second look after a gate stopped a setting, with a gate and birth and death rules written after
`MIX25`'s no-phage numbers had been seen. Every run is on seeds 1 to 4, which had been used before. None of
this is evidence; it says where a confirmation would or would not be worth running. Plan, definitions and
named outcomes: [PLAN.md](PLAN.md), frozen before the first new run. Full tables: [tables.md](tables.md) and
[summary.json](summary.json), both written by `experiments/moving6/summarize.ts` from the raw run files.

## Settings, gate and outcome

128 x 128, the frozen kernel, phage parameters at the frozen defaults. A setting changes only the wall's
decay (`kDeg`) and the two diffusion rates (`diffW` for wall, `diffF` for fuel).

| Setting | `kDeg` / `diffW` / `diffF` | Gate (no phage, seeds 1 and 2) | With phage (seeds 1 and 2) | All four arms (seeds 1 to 4) | Outcome |
|---|---|---|---|---|---|
| `MIX25` (primary) | 0.06625 / 0.03375 / 0.225 | passes: bodies on both (the stored runs; not a finding, the gate was written with them in view) | bodies, phage alive on both: sent on | read | **division without pattern turnover** |
| `MIX12` | 0.06313 / 0.03688 / 0.2125 | fails: mixed on both (same id 16% to 18%, size kept 63% to 65%, isolated 10%, moat 0.35) | not run | not run | **mixed / unclear**: did not pass the gate |
| `MIX37` | 0.06938 / 0.03063 / 0.2375 | passes: bodies on both | bodies, phage alive on both: sent on | read | **moving bodies, no division** |

Every reading window was settled at its first test (steps 20,000 to 40,000 for the gate and the two-seed
stage, 80,000 to 100,000 for the four-seed stage), so no run was extended. The two phage variants were not
run: the plan allows them only if `MIX25`'s two-seed stage reads *phage lost* or *collapse*, and it read
neither.

So moving bodies are a narrow band on this line. An eighth of the way to the spot rates the objects are not
bodies (four in five lose their id within 1,000 steps, and nine in ten share a low-wall patch with another).
At a quarter they are bodies that creep, pinch, fuse and fade. At three eighths they hardly move (0.1 to 0.2
tiles in 1,000 steps) and hardly divide.

## Step A: the ledger of the stored no-phage world

`MIX25` without phage, steps 20,000 to 40,000, seeds 1 and 2 (the windows the earlier screen stopped at).
The earlier rule read 4 to 6 new bodies against 288 to 293 lasting ends in a window whose count was flat.

- The tracker's own lasting births and lasting ends balance to within 3 (1,173 against 1,174 on seed 1; 1,172
  against 1,175 on seed 2). The earlier rule set aside 1,167 of those births on seed 1 and only 881 of the
  ends, because births and ends were classified separately: a return, a re-separation, a relabelling or a
  piece could be set aside as a birth while the end it answered still counted.
- No tracker id lasts: of 149 ids at the first frame of seed 1, none is there at the last. So the earlier
  tests that follow one id for 500 steps mostly could not be read (apart at 0.05: unreadable for 475 of 560
  lasting fissions).

With bodies followed through their changes of id and every continuation joining exactly one end to one birth
([PLAN.md](PLAN.md), "Bodies, births and deaths"), over steps 20,500 to 39,000:

| | Seed 1 | Seed 2 |
|---|---|---|
| Object count at the stretch's start and end | 161, 153 | 154, 155 |
| Bodies alive at its start and end | 162, 147 | 154, 155 |
| Births: by division (daughter shown apart from its parent by water) | 43 | 45 |
| Births: split not shown apart (same low-wall patch / not readable) | 113 (101 / 12) | 106 (96 / 10) |
| Births: by the kernel's relabelling rule (part of a body relabelled, or a body cut by a relabelled strip) | 233 | 254 |
| Births: a further piece of a body that came back as more than one object | 33 | 36 |
| Births: from nothing | 3 | 4 |
| Deaths: faded | 281 | 273 |
| Deaths: fused into another body of its type for good | 159 | 171 |
| Births less deaths, against the change in the object count | 425 - 440 = -15, against -8 | 445 - 444 = 1, against 1 |
| Not births and not deaths: whole body relabelled / touched and parted within 500 steps / dipped and returned / split that did not hold 500 steps | 410 / 1,624 / 133 / 543 | 397 / 1,462 / 133 / 594 |

**Which classes carry the flow.** In order: real fades (273 to 281), the relabelling rule cutting bodies (233
to 254), fusions of bodies of one type (159 to 171), and splits (151 to 156, of which 43 to 45 are shown
apart by water). Bodies of one type that touch and part within 500 steps, and necks that pinch and rejoin,
are most of the tracker's churn (about 2,000 to 2,200 changes of id per seed) and are neither births nor
deaths. Bodies dipping under the counting line and coming back are 133 per seed. Bodies from nothing are 3
to 4. The stock of about 155 bodies turns over about once in 6,500 steps (a turnover time, not a measured
lifetime): of the 162 bodies alive at the start on seed 1, 8 are alive 18,500 steps later.

So the earlier "290 deaths against 5 births" was an artefact of one-sided exclusions. The no-phage `MIX25`
world is not a fixed set of individuals: it has about 23 births and 24 deaths per 1,000 steps.

## The gate that was fixed, and what each setting read under it

*Bodies* needs B1 (same id after 1,000 steps, at least 50%), SAME (of the objects that kept their id, at
least 75% have an area within a factor of 2 of what it was; new, in place of "tiles kept") and B3 (solid,
isolated, moat), all in a settled window. The wave test is unchanged. No stored world passes B1 and fails
SAME, so in effect the gate is B1 plus B3; SAME did fail together with B1 at `MIX12` and in the wave world.

| World (no phage, seeds 1 and 2, steps 20,000 to 40,000) | Same id +1,000 | Size kept | Tiles kept (the earlier test; no role) | Isolated | Moat | Moved in 1,000 steps | Reading |
|---|---|---|---|---|---|---|---|
| `B2`, the wave world (stored, control) | 0% | 33%, 63% (of 6 and 8 objects) | 0% | 0% | 0.09 | 1.3, 3.0 | mixed (not bodies) |
| `MIX12` (new) | 18%, 16% | 65%, 63% | 6%, 5% | 10% | 0.35 | 4.5, 4.2 | **mixed** (not bodies) |
| `MIX25` (stored) | 54%, 55% | 86%, 87% | 34%, 35% | 61%, 60% | 0.66 | 1.3, 1.2 | bodies |
| `MIX37` (new) | 75%, 74% | 99% | 70%, 71% | 98% | 0.85, 0.87 | 0.2, 0.1 | **bodies** |
| `MIX50`, the lattice (stored, control, steps 80,000 to 100,000) | 81%, 79% | 100% | 80%, 78% | 100% | 0.95, 0.97 | 0.0 | bodies |

`MIX12`'s objects are also not readable as bodies by the ledger (14% and 16% of object-steps are in chains
that never stood 500 steps, where 10% is allowed). `MIX37` would have passed the earlier gate as well (tiles
kept 70%).

**Controls (step A2), from the stored runs.** The `MIX50` lattice has no birth and no death of any kind in
18,500 steps, with or without phage, on seeds 1 and 2 (about 1,150 whole-body relabellings per window, all
joined as continuations): no division. `SPOT` with phage has 81 bodies from nothing and none by division.
The `B2` waves read mixed or wave patches at the gate and their ledger is not readable (49% to 87% flicker).
In the founding fills of `MIX50` and `MIX75`, where the earlier rule counted fissions, this ledger counts
them too (110 to 264 births by division per seed): it can see division. Those windows are not passing
controls for the thresholded reading, which fails there on "second half" and "deaths", as a founding fill
should. Tables in [PLAN.md](PLAN.md) and under "Controls" in [tables.md](tables.md).

## `MIX25` with phage: the two-seed stage (steps 20,000 to 40,000)

| | Seed 1 | Seed 2 |
|---|---|---|
| Objects at step 40,000 | 169 | 169 |
| Reading | bodies | bodies |
| Same id +1,000 / size kept / isolated / moat | 57% / 88% / 67% / 0.68 | 59% / 88% / 67% / 0.68 |
| Phage: mean over the window (the bar for "alive" is 410) | 14,857: alive | 15,666: alive |
| Ledger (missed change in the count; allowed about 17) | valid | valid |
| Births: division / split not shown apart / by relabelling / returned piece / from nothing | 46 / 124 / 193 / 28 / 7 | 51 / 129 / 179 / 30 / 4 |
| Deaths: faded / fused | 313 / 93 | 286 / 100 |
| Division on the window alone (described) | holds | holds |
| Pattern turnover, phage / no phage | 0.0504 / 0.0474 | 0.0459 / 0.0444 |
| Two-seed rule | **sent on** | |

## `MIX25`: the four-seed stage (steps 80,000 to 100,000; ledger stretch 80,500 to 99,000)

| | Seed 1 | Seed 2 | Seed 3 | Seed 4 |
|---|---|---|---|---|
| Objects at step 100,000, phage (no phage) | 180 (156) | 164 (163) | 156 (160) | 166 (147) |
| Reading, phage | bodies | bodies | bodies | bodies |
| Same id +1,000, phage (no phage) | 61% (55%) | 59% (55%) | 58% (54%) | 59% (56%) |
| Size kept, phage | 88% | 87% | 87% | 88% |
| Isolated, phage (no phage) | 69% (59%) | 70% (62%) | 67% (62%) | 67% (63%) |
| Moat, phage | 0.69 | 0.69 | 0.68 | 0.68 |
| Window settled | yes | yes | yes | yes |
| Phage: mean over the window (bar 410); types above a sixth of the bar | 21,722; 6 | 18,913; 6 | 11,084; 6 | 18,318; 6 |
| Phage alive | yes | yes | yes | yes |
| Eligible | yes | yes | yes | yes |
| **Ledger check**: births less deaths against the change in the object count, missed by (allowed) | 0 (17.4) | -1 (17.2) | 3 (17.2) | -4 (17.0) |
| Ledger check: flicker / splits not readable | 3% / 7% | 3% / 6% | 3% / 6% | 3% / 4% |
| Ledger | valid | valid | valid | valid |
| Births, phage: division / split not shown apart / by relabelling / returned piece / from nothing | 48 / 157 / 167 / 28 / 7 | 40 / 131 / 175 / 32 / 1 | 41 / 136 / 197 / 20 / 5 | 51 / 131 / 183 / 37 / 6 |
| Deaths, phage: faded / fused | 312 / 82 | 322 / 86 | 291 / 118 | 324 / 90 |
| New bodies the rule counts, phage (in the second half) | 55 (30) | 41 (26) | 46 (21) | 57 (29) |
| Births, no phage: the same five | 40 / 125 / 240 / 42 / 8 | 50 / 119 / 222 / 35 / 7 | 55 / 132 / 229 / 37 / 5 | 37 / 98 / 250 / 24 / 6 |
| Deaths, no phage: faded / fused | 284 / 159 | 281 / 143 | 281 / 156 | 289 / 145 |
| The earlier rule on the phage window: new bodies; lasting ends not returned | 14; 279 | 11; 305 | 12; 330 | 16; 279 |
| Pattern turnover, phage / no phage (lag 1,000 steps) | 0.0540 / 0.0478 | 0.0495 / 0.0469 | 0.0488 / 0.0486 | 0.0463 / 0.0462 |
| Ratio; above no phage (at least 0.01 and 1.5 times) | 1.13; no | 1.06; no | 1.00; no | 1.00; no |
| The same at lag 5,000 steps (no role) | 0.099 / 0.092 | 0.112 / 0.105 | 0.090 / 0.096 | 0.095 / 0.085 |
| Tiles keeping their leading type after 1,000 steps, phage / no phage (no role) | 59% / 63% | 59% / 62% | 59% / 62% | 59% / 63% |
| D4 (diversity above pattern-blind phage) | yes | yes | yes | yes |
| Pattern-blind arm and one-wall arm at step 100,000 | no objects | no objects | no objects | no objects |

**The rule.** Four eligible seeds, four valid ledgers. Division over them pooled: 199 new bodies, 180 by
division (90%; 80% needed), 106 in the second half (53%; 25% needed), 1,625 body deaths against 1,593 body
births (deaths at least half of births), 4 seeds with at least 5 new bodies: **division holds**. Pattern
turnover above no phage on 0 of 4 eligible seeds (3 needed). D4 on 4 of 4. Outcome: ***division without
pattern turnover***.

**What that outcome does and does not say.**

- Division is not something phage brings. The same rule on the four no-phage windows pooled reads 182 of
  208 new bodies by division (88%), 1,738 deaths against 1,761 births: division holds there too. Per body
  per 1,000 steps the phage and no-phage worlds have the same births by division (0.013 to 0.017 against
  0.014 to 0.020) and the same deaths by fade (0.094 to 0.106 against 0.101 to 0.105). The plan said before
  any phage run that the stored no-phage windows already read division.
- D4 is won against a dead world. The pattern-blind arm's first census with no objects is at step 6,000 to
  9,000 and the one-wall arm's at 7,500 to 9,500, on all four seeds, after phage peaks at 68,000 to 80,000
  units; neither has an object again. So D1, D2 and D4 are free here, as they were in the confirmation. What they do show is that at
  these rates six patterns with pattern-specific phage persist where one pattern, or phage that ignores
  pattern, empties the dish.
- D3 (more leader sweeps than no phage) is 1 of 4. Diversity is 5.85 to 5.91 with phage and 5.89 to 5.90
  without: no pattern loses its share in either world.
- The pattern shares move nearly as fast without phage (0.046 to 0.049 per 1,000 steps) as with (0.046 to
  0.054). A likely reason, not measured here, is that most of that movement is the kernel's relabelling rule,
  which runs in both worlds: 0.16 to 0.18 whole-body relabellings per body per 1,000 steps with phage, 0.13
  to 0.16 without. The readouts do not split share turnover among relabelling, growth, decay and infection.

**How far the reading depends on this line's cautions.** No reading of division makes the outcome *bodies
with turnover*: that needs pattern turnover above no phage on 3 seeds by the plan's margin of 1.5 times, and
the ratios are 1.13, 1.06, 1.00 and 1.00 (phage is higher on all four seeds, on two of them by under 1%).
What the division reading itself turns on:

- Counting every split as a division, shown apart or not: 735 of 754 new bodies with phage (97%). Holds.
- With no parting allowed at all (every merge a fusion, every later split a birth): 271 of 283 new bodies by
  division with phage (59 to 76 per seed in place of 40 to 51). Holds.
- With a merge allowed 2,000 steps, or any length of time, before it counts as a fusion: 106 of 126 (84%),
  or 92 of 112 (82%), by division with phage: just over the 80% line. Without phage the same two give 79 of
  112 (71%) and 63 of 98 (64%): under it. So the longer a merge is allowed to last, the fewer divisions are
  left, and the no-phage world loses its division reading before the phage world does.
- If further pieces of a body that returned were counted as "from nothing" (as this line's first draft did,
  before the plan was frozen), the pooled share by division would be 180 of 316 (57%) with phage and 182 of
  346 (53%) without: division would not hold in either, and the outcome would be *mixed / unclear*. This
  is the choice the division reading turns on most. The plan sets returned pieces aside because the earlier
  rule set every return aside; the change was made with the no-phage numbers in view and is flagged in the
  plan's review section.
- The earlier screen's rule on the same four phage windows reads 53 new bodies, 39 by fission (74%), against
  1,193 lasting ends not returned: by its own thresholds division would not hold (under 80%), and its ends
  do not balance its births. Without phage it reads 36 new bodies, 27 by fission, against 1,166 ends.

So "division holds" at `MIX25` is a reading under this line's definitions, which were fitted to this world.
What does not depend on them: about 400 bodies per seed end and about 400 begin in 18,500 steps, with and
without phage, and the object count balances.

## The late window (`MIX25`, seeds 1 and 2, steps 180,000 to 200,000; reported, changes no outcome)

| | Phage, seed 1 | Phage, seed 2 | No phage, seed 1 | No phage, seed 2 |
|---|---|---|---|---|
| Objects at step 200,000 | 171 | 165 | 153 | 163 |
| Reading; ledger | bodies; valid | bodies; valid | bodies; valid | bodies; valid |
| Phage, mean over the window | 13,909: alive | 16,499: alive | none | none |
| Births: division / split not shown apart / by relabelling / returned piece / from nothing | 46 / 113 / 210 / 16 / 7 | 37 / 131 / 197 / 20 / 8 | 54 / 118 / 246 / 27 / 6 | 40 / 119 / 249 / 52 / 1 |
| Deaths: faded / fused | 285 / 109 | 297 / 84 | 304 / 157 | 275 / 175 |
| New bodies the rule counts (in the second half) | 53 (19) | 45 (20) | 60 (34) | 41 (21) |
| Division on the window alone | holds | holds | holds | holds |
| Pattern turnover (lag 1,000) | 0.0529 | 0.0544 | 0.0478 | 0.0479 |

With phage, the two late windows pooled: 83 of 98 new bodies by division, 39 in the second half, 775 deaths
against 785 births: division holds. Division is still going late, at the same rate as at steps 80,000 to
100,000, with and without phage. The earlier screen's lattices divided only while filling; this world does
not stop. Pattern turnover late is 1.11 and 1.14 times the no-phage world's.

## What phage changes at `MIX25` (described, no threshold; steps 80,000 to 100,000, seeds 1 to 4)

| Readout | With phage | Without phage |
|---|---|---|
| Objects (mean over the window) | 170 to 175 | 153 to 157 |
| Body size, median area (tiles) | 15 to 16 | 18 |
| Speed, median move in 1,000 steps (tiles) | 1.1 to 1.2 | 1.2 to 1.4 |
| Per body per 1,000 steps: births by division | 0.013 to 0.017 | 0.014 to 0.020 |
| Per body per 1,000 steps: births by relabelling | 0.053 to 0.064 | 0.080 to 0.091 |
| Per body per 1,000 steps: deaths by fade | 0.094 to 0.106 | 0.101 to 0.105 |
| Per body per 1,000 steps: deaths by fusion | 0.026 to 0.038 | 0.051 to 0.058 |
| Per body per 1,000 steps: whole-body pattern changes | 0.164 to 0.181 | 0.133 to 0.156 |
| Of the bodies alive at the start of the stretch: faded / fused / still alive at its end | 120 to 138 / 32 to 42 / 13 to 20 | 80 to 101 / 52 to 62 / 4 to 8 |
| Bodies by division: tiles from the parent 1,000 steps after the split, median | 9.7 to 10.8 | 9.8 to 11.1 |
| Bodies by division: steps lived, median of those that ended in the window | 2,930 to 4,320 | 2,210 to 3,960 |
| Erosion readout, per 1,000 body-steps: recovered dips / ends after a dip / other ends | 0.46 to 0.52 / 0.064 to 0.073 / 0.11 to 0.14 | 0.42 to 0.48 / 0.073 to 0.090 / 0.16 to 0.18 |

- **Does phage kill whole bodies or erode them?** Neither shows as extra deaths. Deaths by fade per body are
  the same with and without phage, and the erosion readout has slightly more recovered dips and fewer ends
  with phage. What
  phage does is make bodies smaller and so more numerous and further apart: 28% to 48% of body samples carry
  at least 1 unit of their own phage per tile and 2% to 6% at least 10; the ones carrying 10 or more are half
  the size (10 to 11 tiles against 21 to 22) at the same wall per tile (0.243 against 0.242). Own-type phage
  on the tiles of counted objects is 27% to 32% of the dish's phage. Smaller bodies touch less: fusions fall
  by about half, and with them the splits that undo them.
- **How often a body changes pattern.** By the kernel's relabelling rule only: about once in 6,000 steps with
  phage and once in 7,000 without, for the whole body; cuts by a partial relabelling are rarer with phage
  (smaller bodies are more often inside the relabelled disc whole).
- A daughter is about 10 tiles from its parent 1,000 steps after the split, about two and a half body
  widths, with or without phage.

## `MIX37`

| | Seeds 1 to 4, with phage | Without phage |
|---|---|---|
| Gate (no phage, seeds 1 and 2, steps 20,000 to 40,000) | | bodies on both: passes |
| Two-seed stage (phage, seeds 1 and 2): reading; phage mean; births by division | bodies, bodies; 11,668 and 8,300, alive; 1 and 0: sent on | |
| Objects at step 100,000 | 252 to 254 | 240 to 249 |
| Reading, steps 80,000 to 100,000 | bodies, 4 of 4, settled | bodies, 4 of 4 |
| Same id +1,000 / size kept / isolated / moat | 75% to 77% / 99% to 100% / 98% to 99% / 0.86 to 0.88 | 74% to 75% / 99% / 97% to 99% / 0.85 to 0.88 |
| Moved in 1,000 steps; median area | 0.2 tiles; 13 | 0.2 tiles; 13 to 14 |
| Phage, mean over the window (bar 410) | 9,240 to 13,943: alive, 4 of 4 | none |
| Ledger check: missed change in the count (allowed about 25), flicker | 0, 0%: valid, 4 of 4 | valid |
| Births per seed: division / split not shown apart / by relabelling / returned piece / from nothing | 0 to 3 / 2 to 9 / 3 to 5 / 0 / 0 to 2 | 0 to 2 / 5 to 15 / 1 to 7 / 0 to 1 / 0 to 1 |
| Deaths per seed: faded / fused | 6 to 17 / 0 | 11 to 20 / 0 to 1 |
| Pooled over four seeds: new bodies (by division); deaths against births | 8 (5); 49 against 48 | 4 (3); 66 against 62 |
| Pattern turnover, phage / no phage; ratio | 0.0436 / 0.0377, 0.0409 / 0.0423, 0.0412 / 0.0393, 0.0368 / 0.0456; 1.16, 0.97, 1.05, 0.81 | |
| D4; pattern-blind and one-wall arms | 4 of 4, against arms whose first census with no objects is at step 14,500 to 19,500 | |
| Whole-body pattern changes per body per 1,000 steps | 0.25 to 0.27 | 0.27 |
| Erosion readout, per 1,000 body-steps: recovered dips / ends after a dip / other ends | 0.069 to 0.079 / 0.002 to 0.003 / 0.006 to 0.008 | 0.094 to 0.110 / 0.002 to 0.004 / 0.008 to 0.014 |
| Phage load: body samples with own phage of 1 unit per tile or more / 10 or more; area with 10 or more against under 1 | 23% to 32% / 0% to 1%; 8.8 to 8.9 against 13.3 to 13.5 tiles | |
| Four-seed rule | **moving bodies, no division** (8 new bodies where 20 are needed; pattern turnover above no phage on 0 of 4) | |

The outcome name is the plan's; the bodies barely move. `MIX37` is a lattice of about 250 bodies with a slow
trickle of deaths and births (about 12 of each per seed in 18,500 steps, where `MIX25` has about 400 and
`MIX50` has none), the same with and without phage. Phage sits on bodies as a light standing load, as in
the earlier screen's lattices, and neither kills nor visibly erodes them (fewer dips and ends with phage
than without). So between "moving" and "frozen" on this line there is no setting, among those run, where
bodies creep less and still divide: division goes with the creeping.

## What was run, what was not, and the budget

| Step | Runs | Wall time |
|---|---|---|
| Replays of stored windows (before the plan was frozen; each equal to the stored window value for value) | `MIX25` no phage, seeds 1 and 2, steps 0 to 10,000 and 20,000 to 40,000; 13 control windows of `MIX50`, `MIX75`, `SPOT` and `B2` | 11 min 29 s |
| GPU against CPU, 100 steps, seed 1, all four arms | `MIX25`, `MIX12`, `MIX37` (12 worlds) | 50 s |
| `MIX25` two-seed stage | phage, seeds 1 and 2, to 40,000 | 2 min 25 s |
| `MIX25` four-seed stage | four arms, seeds 1 to 4, to 100,000 (the no-phage runs of seeds 1 and 2 continued from the stored runs) | 41 min 29 s |
| `MIX25` late window | phage and no phage, seeds 1 and 2, on to 200,000 | 18 min 48 s |
| `MIX12` gate | no phage, seeds 1 and 2, to 40,000 | 2 min 58 s |
| `MIX37` gate and two-seed stage | no phage and phage, seeds 1 and 2, to 40,000 | 5 min 51 s |
| `MIX37` four-seed stage | four arms, seeds 1 to 4, to 100,000 | 34 min 30 s |
| **Total** | | **1 h 58 min of the 3 GPU-hours** (7,100 s in `runs/moving6/logs/gpu-seconds.log`) |

- Nothing was cut for budget.
- Not run, by the plan's rules: any phage world at `MIX12` (gate); the phage variants `PH_LONG@MIX25` and
  `PH_MILD@MIX25` (the two-seed stage read neither *phage lost* nor *collapse*); a late window for `MIX37`
  (its outcome does not qualify); seeds 5 to 40.
- **No new world outside the plan's three settings was run, on any seed, and no diagnostic run was made.**
  The GPU was also used, before the plan was frozen, to replay 17 stored windows of the earlier screen
  (`MIX25`, and as controls `MIX50`, `MIX75`, `SPOT` and `B2`), each stopped unless equal to the stored
  window value for value: the same seen data, logged again. The brief names the lattice and wave controls;
  the three founding-window replays (`MIX50` seeds 1 and 2, `MIX75` seed 1) are a positive control this line
  added. The only other simulation before the freeze was the GPU against CPU check for `MIX25`.
- The reading windows are steps 80,000 to 100,000, with one look at 180,000 to 200,000. The confirmation
  judged steps 400,000 to 500,000. Nothing here speaks to later times.

## Checks on the runs

- GPU against CPU: equal on all 229,376 values and the step counter after 100 steps, seed 1, all four arms,
  at `MIX25`, `MIX12` and `MIX37` (`runs/moving6/gpu-check.txt`).
- Every replay equalled its stored window in census rows, tracker records, birth notes and end state (the
  runner stops otherwise; none stopped). The stored `MIX25` no-phage runs of seeds 1 and 2 were continued
  from step 40,000, not re-run.
- Every census of every run had zero matter residual and an object count equal to
  `observeFindDroplets(...).length` (the runner stops otherwise; none stopped). The summariser re-checks the
  residual and that no census is missing: 202 segments and 7,360 census rows in this line's runs (215 and
  7,820 with the replayed controls), all zero. Every segment header names a seed from 1 to 4.
- Nothing was written under the stored folder of the earlier screen (no file there is newer than this line's
  start).
- The frozen files' hashes equal `experiments/confirm/FROZEN.json`; nothing under `experiments/spot6`,
  `experiments/b2check`, `experiments/confirm`, `apps`, `packages` or the two earlier `docs` folders differs
  from `ab91de4d`.
- `PLAN.md` differs from the copy saved before the first new run
  (`runs/moving6/PLAN-before-first-run-2026-11-22T1128.md`, not in git) only in its last section.

## Snapshots (seed 1; three columns 1,000 steps apart; wall by type above, counted objects below, grey for wall of 0.05 or more outside any object)

- [snap-MIX25-PHAGE-seed1-90k.png](snap-MIX25-PHAGE-seed1-90k.png): `MIX25` with phage. Round blobs and
  short worms on black, each one colour; most can be matched from column to column, shifted, bent, split or
  joined. More blobs and fewer long worms than without phage.
- [snap-MIX25-NO_PHAGE-seed1-90k.png](snap-MIX25-NO_PHAGE-seed1-90k.png): the same world without phage.
- [snap-MIX25-PHAGE-seed1-190k.png](snap-MIX25-PHAGE-seed1-190k.png): the same with phage, 100,000 steps
  later: no different in kind.
- [snap-MIX12-NO_PHAGE-seed1-30k.png](snap-MIX12-NO_PHAGE-seed1-30k.png): `MIX12`, which failed the gate.
- [snap-MIX37-NO_PHAGE-seed1-30k.png](snap-MIX37-NO_PHAGE-seed1-30k.png) and
  [snap-MIX37-PHAGE-seed1-30k.png](snap-MIX37-PHAGE-seed1-30k.png): `MIX37`, a lattice of small round bodies
  that is the same in all three columns but for a few changes of colour.

The two worth looking at first: `snap-MIX25-PHAGE-seed1-90k.png` beside `snap-MIX25-NO_PHAGE-seed1-90k.png`.

## Limits and departures, stated

- **Fitted to seen data.** The gate, the birth and death definitions and the validity tolerances were
  written with `MIX25`'s no-phage runs in view. `MIX25` passing the gate, and its no-phage ledger closing,
  are not findings.
- **A birth and a death left out together cannot be seen.** If a body merges into another that then puts out
  a daughter elsewhere within 500 steps, or a body divides and the parent dies within 500 steps, the ledger
  reads one body going on. The error only removes a birth and a death together. The "no parting" figures
  above bound the first case from the other side.
- **"Shown apart" is a cautious test in a crowded dish.** About three quarters of readable splits end with
  daughter and parent in one patch of total wall of 0.05 or more 500 to 1,000 steps on, and are set aside.
  Some of those are real divisions between crowded neighbours.
- **Division here is pinching, not growth into a vacated site.** The ledger does not ask where a daughter
  goes or whether a death made room for it.
- **The last pre-run fix had no review pass of its own.** The third Codex pass found that a fix for one of
  its findings had changed an outcome; that was fixed with a test at 3 of 4 and 7 of 8, and the runs began.
  The final review covers that code.
- **The summary JSON is large** (0.8 MB): it carries every window's readouts.

## Review

Codex (Sol 6.1, High, read-only) reviewed the plan and code three times before the first new run; the
nineteen findings and what was done about each are at the end of [PLAN.md](PLAN.md). In the first two passes
it re-implemented the chain rules from the plan's prose in its own script and reproduced every number of
step A and the controls.

A fourth pass reviewed the final state. It rebuilt the chain ledger and every reading from the raw segment
files with its own script (38 windows of this line and the 13 controls), not this line's summariser, and got
the three outcomes of the first table: the gates, the two-seed rule, the four-seed rule (births and deaths
by kind on every seed, the ledger checks, the pooled division reading, the turnover ratios, the five
endpoints), the late window, step A and every sensitivity figure. It also checked the hard constraints
(protected paths equal `ab91de4d`; the frozen hashes; this line's code equal to the list saved at the
freeze; the plan equal to its frozen copy but for its last section; seeds 1 to 4 only; no variant run; zero
residual in every census; `MIX25`'s stages before any neighbour run; the stored `MIX25` runs continued, not
re-run; 7,100 s of GPU time) and that the last pre-run fix is right. **No finding changes an outcome or a
number in a table.** Its six findings were about wording, and all were applied to this file:

1. "Pattern turnover no faster with phage" overstated it: phage is higher on every seed, by 13%, 6%, 0.4%
   and 0.2%; what fails is the 1.5 times margin. The outcome sentence and the bullets now say so.
2. The control arms' "last object" steps were given as death times: they are now the first census with no
   objects.
3. "The founding fills read division" mixed counted fissions with the thresholded reading, which fails
   there: reworded here. The plan's sentence to the same effect (in its step A2) is above its frozen line
   and is left as it stood; this is the correction.
4. "The mover is the relabelling rule" was stated as a mechanism: it is now marked as an interpretation.
5. The list of files changed was missing: added below.
6. This section was referred to and did not exist.

No code was changed after the first new run, so the tables were not regenerated after the review.

## Files

New, all untracked (nothing existing was edited):

- `docs/six-wall-moving-2026-11-22/`: `PLAN.md`, `CALIBRATION.md`, `tables.md`, `summary.json`, and six
  snapshots `snap-*.png`.
- `experiments/moving6/`: `settings.ts` (the three settings; a copy of the earlier `buildSpec` body),
  `movelog.ts` (the extra per-frame log), `ledger.ts` (bodies as chains; births and deaths), `rule.ts` (gate,
  validity, division, outcomes), `run.ts` (a copy of the earlier runner, with the move log and the replay
  mode), `gpu-check.ts` (a copy of the earlier check), `summarize.ts`, `run-all.sh`.
- `experiments/test/moving6-ledger.test.ts` (20 tests on hand-built frames), `experiments/test/moving6-rule.test.ts`
  (26 tests).

Not in git: `runs/moving6/` (raw runs, logs, the frozen plan copy, the Codex prompts and reviews) and
`runs/spot6/MIX25` (the copy of the stored runs).

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
# Before the freeze: replays of stored windows (the same seen data) and the MIX25 GPU check.
experiments/moving6/run-all.sh adopt 1; experiments/moving6/run-all.sh adopt 2
for s in 1 2; do for a in PHAGE NO_PHAGE; do experiments/moving6/run-all.sh replay MIX50 $a $s 80000-100000; done; experiments/moving6/run-all.sh replay MIX50 NO_PHAGE $s 0-10000; done
experiments/moving6/run-all.sh replay SPOT PHAGE 1 80000-100000; experiments/moving6/run-all.sh replay SPOT NO_PHAGE 1 80000-100000
experiments/moving6/run-all.sh replay MIX75 NO_PHAGE 1 0-10000
for s in 1 2; do for a in NO_PHAGE PHAGE; do experiments/moving6/run-all.sh replay B2 $a $s 20000-40000; done; done
experiments/moving6/run-all.sh check "MIX25"
# After the freeze.
experiments/moving6/run-all.sh stage2 "MIX25"
experiments/moving6/run-all.sh stage3 "MIX25"
experiments/moving6/run-all.sh late MIX25
experiments/moving6/run-all.sh check "MIX12 MIX37"
experiments/moving6/run-all.sh gate "MIX12 MIX37"
experiments/moving6/run-all.sh stage2 "MIX37"
experiments/moving6/run-all.sh stage3 "MIX37"
deno run -A --no-lock experiments/moving6/summarize.ts --runs runs/moving6 --json docs/six-wall-moving-2026-11-22/summary.json > docs/six-wall-moving-2026-11-22/tables.md
for a in PHAGE NO_PHAGE; do experiments/moving6/run-all.sh snap MIX25 $a 1 90000 MIX25-$a-seed1-90k; done
experiments/moving6/run-all.sh snap MIX25 PHAGE 1 190000 MIX25-PHAGE-seed1-190k
experiments/moving6/run-all.sh snap MIX12 NO_PHAGE 1 30000 MIX12-NO_PHAGE-seed1-30k
for a in PHAGE NO_PHAGE; do experiments/moving6/run-all.sh snap MIX37 $a 1 30000 MIX37-$a-seed1-30k; done
pnpm typecheck
pnpm vitest run experiments/test/moving6-*.test.ts experiments/test/spot6-rule.test.ts experiments/test/b2check-observe.test.ts
deno check --no-lock experiments/moving6/*.ts
```

Raw outputs are in `runs/moving6/` in this worktree (gitignored): one folder per setting, arm and seed with
a JSON file per segment, saved states and snapshots; replayed control windows in `runs/moving6/controls/`;
logs in `runs/moving6/logs/`; the Codex prompts and reviews in `runs/moving6/review/`.
