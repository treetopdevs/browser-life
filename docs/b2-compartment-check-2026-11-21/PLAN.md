# B2 compartment check: plan (written 2026-11-21, before any six-wall tracking run)

## Question

In the frozen six-wall B2 world as the confirmation ran it, are the objects counted as "droplets" compartments
(closed, persistent, bounded bodies that divide and have identifiable parents and daughters), or are they
patches of a travelling-wave pattern that the counting rule happens to label?

## What the confirmation counted as a droplet

`experiments/confirm/run-droplets.ts` calls `observeFindDroplets(snap.W, 128, 128, 0.20)` every 500 steps and
stores the length of the list as `drop`. In that function (`apps/lab/src/oligomer/droplets-kernel.ts`) a
droplet is, for one wall type at a time, a 4-connected patch of tiles (edges wrap) on which that type's wall is
at least 205 of 1024 matter units (0.20 of a tile), with at least 3 tiles. The count is the number of such
patches summed over the six wall types. Nothing in the rule asks whether a patch is closed, lasts, stays in
place or has a parent. `experiments/confirm/rule.ts` uses `drop` in endpoints D1, D2 and D5 and in the
"alive" test; D3 and D4 use shares of wall matter by type and do not use the object count.

## What had been seen when this plan was written

- The confirmation's count and diversity series for seeds 5 to 12 (the run files in the main checkout).
- One benchmark of the PHAGE world on seed 1 for 5,200 steps: the final droplet count (71) and no map.
- The two one-wall, no-phage 64 x 64 reference worlds on seed 1, 20,000 steps each, with this observer: tables
  and maps (below). These are not the six-wall world.
- No map, object table or tracker output of any six-wall world on any seed.

## Method

**Kernel.** The frozen kernel, unedited, checked against `experiments/confirm/FROZEN.json` at every start. Runs
use its GPU form (`DropletGpuSim`), not the CPU reference: on this machine today the CPU reference does about 2
steps per second at 128 x 128 and the GPU about 190. The two agreed bit for bit on a 200-step PHAGE seed 1
world in the benchmark, and `experiments/b2check/gpu-check.ts` repeats that check on seed 13. This departs from
the brief's "on CPU".

**Worlds.** PHAGE, NO_PHAGE and SINGLE_WALL built exactly as the confirmation built them (128 x 128, same
config, same seeding). Two reference worlds: one wall type, phage and both mutation rates off, 64 x 64, seeded
with the same routine (9 patches of radius 3), at the B2 default rates (`ONE64_B2`: `kDeg 0.06`, `diffW 0.04`,
`diffF 0.20`) and at the sandbox line's spot rates (`ONE64_SPOT`: `kDeg 0.085`, `diffW 0.015`, `diffF 0.30`).

**Seeds.** 13, 14, 15, 16 for every reported number. Seed 1 only for developing the observer.

**Objects.** Exactly the confirmation's rule. At every 500-step census the runner checks that its object count
equals `observeFindDroplets(...).length` and that the matter residual is zero, and stops if either fails.

**Tracking.** Inside a tracked window the world is read back every 10 steps. Objects of one wall type are linked
between frames by shared tiles. The object sharing most tiles with a previous object keeps its id; other
objects that share tiles with it are fission daughters; an object whose tiles are all taken by an object that
kept another id is absorbed; an object nothing overlaps has faded, unless at least half of its tiles are now
inside an object of another type (type switch, which is what the kernel's `mutMotif` rule does to a patch).
An object with no same-type predecessor is a switch birth if at least half its tiles were in another type's
object one frame earlier, else a birth "from nothing" (wall that crossed the threshold or the 3-tile minimum).

**Readouts**, sampled at every 500-step census for every object present, each read again 100, 500 and 1,000
steps later (samples too close to the end of a window to be read again are left out of that lag):

1. *Kept id*: the share of objects whose id is still present after 100, 500 and 1,000 steps. This is the
   lifetime readout in a form that the window's ends do not censor. The median lifetime of objects both born
   and ended inside a window is also listed.
2. *Moved*: median centroid displacement after 1,000 steps (objects present at both ends), and after 100 steps.
3. *Tiles kept*: the mean share of an object's tiles that are inside the same id 1,000 steps later (0 if the id
   is gone). A tracker-free twin: the share of object tiles whose own-type wall is still at or above the
   threshold 100 and 1,000 steps later, beside its chance level (the share of all tiles at or above the
   threshold for that type at the later time).
4. *Closed*: *solid* (the tile nearest the mass centroid is in the object; false for rings and arcs),
   *isolated* (no other object in the same connected patch of total wall, all types summed, of at least 0.05),
   *moat* (the share of tiles at 4-neighbour distance 2 and 3 from the object whose total wall is below 0.05).
   World level: the number of connected patches of total wall at 0.20 (blind to type) and at 0.05, and the
   largest 0.05 patch's share of all tiles at or above 0.05.
5. *Peak wall*: the largest own-type wall on one tile of the object; median and 90th percentile over objects,
   and the largest tile in the window.
6. *Births and ends*: counts by kind, per object per 1,000 steps. For fission daughters, the share still
   present 500 steps after the split and the share absorbed back by their parent within 500 steps. *Lasting
   births*: objects that appeared at least 500 steps before the window's end and were still present 500 steps
   later, by kind.
7. *Purity*: own-type wall as a share of all wall on the object's tiles.

**Two readouts in the brief that cannot be taken literally.**

- *Wall matter still in the object after 1,000 steps.* A unit of wall decays to waste at `kDeg` per step (0.06,
  or 0.085 at the spot rates), so it lasts about 17 (or 12) steps and essentially none is left after 1,000
  steps in any of these worlds, compartments included. The readout used instead is place: "tiles kept" above.
- *Does a daughter keep the parent's wall type.* The rule labels each type separately and the tracker links
  within a type, so a fission daughter has its parent's type by construction. The chemistry also makes wall
  only from wall of the same type; the type changes only through `mutMotif`. What is reported instead: births
  by type switch, and purity.

## Windows and run lengths

| World | Steps | Tracked windows | Settled window (the one the reading uses) |
|---|---|---|---|
| PHAGE | 80,000 | 0 to 10,000; 60,000 to 80,000 | 60,000 to 80,000 |
| SINGLE_WALL | 80,000 | 0 to 10,000; 60,000 to 80,000 | 60,000 to 80,000 |
| NO_PHAGE | 240,000 | 0 to 10,000; 60,000 to 80,000; 220,000 to 240,000 | 220,000 to 240,000 |
| ONE64_B2, ONE64_SPOT | 30,000 | 0 to 10,000; 10,000 to 30,000 | 10,000 to 30,000 |

Why these lengths: in the confirmation's seed 5 to 12 files the PHAGE count is flat from 10,000 steps (69 to
71) and SINGLE_WALL from about 20,000 (about 20), while NO_PHAGE falls until about 200,000 (to 33, diversity
1.09). The confirmation judged steps 400,000 to 500,000; these windows are earlier, which is a stated limit.
A window counts as settled if the mean count of its two halves differ by less than 10%; otherwise the table
flags it. If the machine allows, PHAGE and SINGLE_WALL are extended to 240,000 with a third tracked window at
220,000 to 240,000; RESULT.md says whether that was done.

Between tracked windows the count is taken every 500 steps, as the confirmation did.

## Thresholds, fixed now

Each tracked window of each seed gets one reading.

**Bodies** needs all of:

- B1 lasts: kept id after 1,000 steps at least 50%.
- B2 stays: tiles kept after 1,000 steps (same id) at least 50%.
- B3 closed: solid at least 80%, isolated at least 50%, median moat at least 0.50.

**Wave patches** needs all of:

- V1: kept id after 1,000 steps at most 10%.
- V2: tiles still wall after 1,000 steps within 0.10 of the chance level.
- V3: isolated at most 25%.

**Persistent domains, not bounded** (named in advance): B1 and B2 hold and B3 fails. This is what a field of
wall carved into typed patches that hold their place would look like: patches that last, with no water round
them.

**Mixed**: anything else. RESULT.md says which criteria failed.

**Division**, read per world over all its tracked windows and seeds 13 to 16 pooled: among lasting births, at
least 80% arose by fission or type switch (an identifiable parent), with at least 20 lasting births. With
fewer than 20 the reading is "division not observed".

**The answer for a world** uses its settled window:

- *compartments*: bodies in at least 3 of 4 seeds, and division holds.
- *bodies, division not shown*: bodies in at least 3 of 4 seeds, and division does not hold or is not observed.
- *wave patches*: wave patches in at least 3 of 4 seeds.
- *persistent domains, not bounded*: that reading in at least 3 of 4 seeds.
- *mixed*: no reading reaches 3 of 4 seeds.

Peak wall, displacement and purity are reported without a threshold.

## What the reference worlds gave on seed 1 (development, not a result)

`ONE64_B2`, steps 10,000 to 20,000: kept id after 100 / 500 / 1,000 steps 29% / 0% / 0%; tiles still wall after
1,000 steps 20% against a chance level of 19%; isolated 0%; moat 0.00; median peak 0.24; one connected
low-wall patch holds all the wall; 2 lasting births. Reading under the thresholds: wave patches.

`ONE64_SPOT`, steps 10,000 to 20,000: kept id 100% / 100% / 100%; median displacement 0.0 tiles; tiles kept
100%; solid 100%; isolated 83%; moat 0.93; median peak 0.54. Reading: bodies. In its growth window (0 to
10,000) 105 of 118 lasting births were by fission (89%).

So the observer separates the two known regimes, and the thresholds sit between them.

## What would change the reading of the confirmation

- If the six-wall objects read as wave patches or as persistent domains, the count `drop` is a measure of how
  much pattern there is and how finely it is cut, not a number of individuals, and D1, D2 and D5 have to be
  reworded. D3 and D4 are about shares of wall matter by type and stand either way.
- If they read as compartments or bodies, the endpoints mean what RESULT.md says.

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
deno run -A --no-lock experiments/b2check/gpu-check.ts
for s in 13 14 15 16; do
  deno run -A --no-lock experiments/b2check/run.ts --world PHAGE --seed $s --out runs/b2check --steps 80000 --track 0-10000,60000-80000 --snap 70000,71000,72000
  deno run -A --no-lock experiments/b2check/run.ts --world SINGLE_WALL --seed $s --out runs/b2check --steps 80000 --track 0-10000,60000-80000 --snap 70000,71000,72000
  deno run -A --no-lock experiments/b2check/run.ts --world NO_PHAGE --seed $s --out runs/b2check --steps 240000 --track 0-10000,60000-80000,220000-240000 --snap 70000,71000,72000,230000,231000,232000
  deno run -A --no-lock experiments/b2check/run.ts --world ONE64_B2 --seed $s --out runs/b2check --steps 30000 --track 0-10000,10000-30000 --snap 20000,21000,22000
  deno run -A --no-lock experiments/b2check/run.ts --world ONE64_SPOT --seed $s --out runs/b2check --steps 30000 --track 0-10000,10000-30000 --snap 20000,21000,22000
done
deno run -A --no-lock experiments/b2check/summarize.ts --runs runs/b2check --json docs/b2-compartment-check-2026-11-21/summary.json
```
