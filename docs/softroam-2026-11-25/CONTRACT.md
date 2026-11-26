# Soft Roam: kernel contract (v1, 2026-11-25)

The brief every builder and reviewer of Soft Roam worked from. The kernel's header comment
(`apps/lab/src/softroam/kernel.ts`) states the rules as built; where the two differ, the code and its tests decide.

Roam (`apps/lab/src/roam/*`), `packages/*` and every golden pin stay byte-identical. Soft Roam may import from the Roam
kernel and view (`roamHash`, `planEntry`, `PLAN_*`, `KIND_*`, gene constants, `ROAM_PLANS`, `roamPlan`).

**Best case:** soft glowing bodies of bonded cells glide, bend and turn through drifting food haze, grow by their
plans, shed pieces that swim away, and red-mouthed hunters curve after pale-rimmed armoured bodies; every frame is a
small deformation of the one before.

**Carried over from Roam's page-default regime** (plan + flow + life + compost, and in milestone 2 kinds + drain +
seal + crack + toughness + shellBite + shellLeak): bodies are found each step by walking mother links, never declared;
a bond joins a cell only to a daughter it made (bodies never fuse); per-cell stores; 16-mode plans; death by starving
and wear; bodies break where a cell dies; closed matter with one reservoir that drops patches; residual exactly 0; one
seed gives one history. Shared-store Roam modes (no plan, no flow) are not ported.

## Files
`apps/lab/src/softroam/kernel.ts` (class `SoftRoamWorld`, `SoftRoamConfig`, `defaultSoftRoamConfig`, `SoftRoamCensus`),
`view.ts` (starts, `SoftRoamSession`, painter, worker message types), `page.ts`, `softroam.worker.ts`, `dials.ts`
(milestone 2), page `apps/lab/softroam/index.html`, tests `apps/lab/test/softroam*.test.ts`, runner
`experiments/softroam/look.ts` (Deno, like `experiments/roam/look.ts`).

## Arithmetic
- Position: integer, `U = 1024` units per tile, torus of `size * U`. Cell diameter `D = U`, bond rest `L = U`.
- Velocity: sixteenths of a unit per substep with a signed per-cell position carry.
- Every intermediate in the dynamics fits in 31 signed bits (u32 hashes and host-side map keys exempt). Long deltas
  are guarded. Integer sqrt; division truncates toward zero; no signed `>>` on a value that can be negative. A literal
  integer sine table (1024 steps per turn, Q14); no float anywhere in the dynamics.
- Random draws: `roamHash(seed, step, cid, channel)` keyed on the cell's never-reused serial `cid` (pair draws mix both
  cids symmetrically; field draws use the tile). Never keyed on slot.
- Matter u32. A fraction is paid as `SR(n, D) = floor(n / D) + (hash % D < n % D ? 1 : 0)`. Total matter < 2^20.
- No result may depend on slot order, bucket order or evaluation order: forces are sums from a snapshot; contests are
  settled proportionally from a snapshot or in fresh hash order of cid.

## State (struct of arrays over slots; capacity `maxCells` <= 16384; LIFO free list)
alive, x, y, prevX, prevY (position at step start, for the picture), vx, vy, carryX, carryY, store, genes[5], pid,
mode, made, orient (0..3, lattice facing as in Roam), gx, gy (ideal offset in the body's plan lattice), kind, tough,
hits, fam, cid, since, bornStep, lastHitStep, lastDrainStep, heading (0..1023, one value per body), turnLeft, mother
(slot or -1), up to 4 braces (partner slot, rest length), body (label, rebuilt each step). Per tile: food, scent
(signal only). Per step, read-only event lists for the picture: deaths, births, cracks, patches.

## Step
**0. Commands.** Label bodies. Per body: a turn event (turn gene, drawn on the smallest cid) adds a hashed amount in
[-256, 256] to `turnLeft`; the heading moves toward it by at most 16 per step. Per cell thrust = drive share along the
heading + chase share along the smooth scent slope; a sealed new body thrusts at full along its release direction.
The thrust's matter cost is prepaid to the reservoir; a cell that cannot pay does not thrust.

**1. Mechanics, `substeps` times, forces summed from a snapshot of positions.** Bond springs (mother and daughters),
braces with their own rest lengths, linear repulsion between cells with no bond or brace between them closer than `D`,
and thrust with the part that presses into another body removed. Then `v = trunc(v * keep / 256) + force`, clamp,
integrate with carry. `keep = 0` is the overdamped limit; the default keeps a short glide.

**2. Life, once.**
a. Eat from the tile under the centre; a crowded tile is shared in proportion to the asks. (Milestone 2: only plain
   cells and one-cell bodies eat; shellBite.)
b. Upkeep to the reservoir: `leakCell + leakSide x exposed`, `exposed = 4 -` the number of same-body cells at ideal
   offsets (+-1, 0), (0, +-1): exactly Roam's value, and it does not flicker when a body bends.
c. (Milestone 2) Touch: cells of different bodies within `1.25 D`, at most 4 contacts per cell chosen by pair-hash
   rank; from snapshot stores a mouth of a body at least twice the other's size takes
   `min(drain, floor(preyStore / takers))` from a plain or mouth cell, where `takers` counts the eligible contacts that
   drain that prey cell (a contact the eligibility rule refuses neither takes nor divides the store, though it still
   uses one of the four places); a mouth on a shell is one hit; shells crack to
   plain at `crack << tough` hits (edible from the next step); `seal` exempts new bodies. Optional `grip`: a mouth
   touching eligible prey is pulled gently toward contact distance, so hunters hold on.
d. Flow: per mother link, a Q10 share of the store difference from the fuller to the emptier, from snapshot stores,
   at most 1/8 per link.
e. Death, all at once: store below minStore, or wear (chance 1/life). The store composts onto the tile under the
   centre. Modes reset as Roam's `dieFlow` does. Then relabel at once and drop every brace whose ends are now in
   different bodies, so pieces part cleanly.
f. Division by plan, parents in fresh hash order. Physical facing = unit vector from mother to cell, standing for
   lattice direction `orient`, rotated by the act in exact quarter turns. Target = cell + L along that. If a same-body
   cell already holds the target's ideal offset, the cell advances its mode (as Roam does when the tile is its own
   body's). Else if any cell centre or earlier accepted target lies within 717 units, it waits. Else the daughter is
   born with `floor(store / 2)`. Kept: mother link, gx/gy/orient, and braces (rest from the lattice, never from
   current positions) to same-body cells at ideal offset (1,0)-type that are not its mother (1024), diagonal (1448)
   and (2,0)-type (2048, the bending spring), up to 4 per cell at both ends. Released: a new body with gene and plan
   copy errors as in Roam.
g. Patches from the reservoir on Roam's rhythm; optional conservative food diffusion (`foodSpread`); scent relaxation.

## Census, alarms, digest
Census as Roam's plus `travel` and three alarms that stay 0 in tests: bonds stretched past `2L`, pairs of different
bodies overlapping by more than `D / 4` for 50 steps running, cells at the speed clamp for 50 steps running.
`digest()` hashes cells in cid order plus the fields. `checkInvariants()` throws on any broken ledger or link.

## Picture
Drawn at sub-tile resolution from positions interpolated between `prevX, prevY` and `x, y`: bodies as soft summed
fields with a dark seam between different bodies, pale rims on shells, warm glow on mouths, links showing flow, food as
blue haze, and short transitions for births (grow in), deaths (fade and a compost puff), cracks and new patches.

## Rules for every agent
Work only in this worktree. Never commit, never run `jj`, `git commit`, `git add`, `git stash`, `git checkout`,
`git push`. Edit only the files your task names. Use `export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH`
before pnpm. Gate: `pnpm typecheck` and `pnpm vitest run apps/lab/test/softroam` (files `apps/lab/test/softroam*.test.ts`),
and `pnpm vitest run apps/lab/test/roam.test.ts` still green. `deno run` needs `--no-lock`. Page text is plain words
for a visitor, like the Roam page.
