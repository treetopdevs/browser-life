# Vesicle world: rules

Code: `apps/lab/src/vesicle/model.ts` (the world), `observe.ts` (observers), `worlds.ts` (starting worlds).
This is a sandbox next to the main kernel. It shares none of its code and changes none of its pins.

## What exists

A closed, flat dish holds three kinds of thing.

| Thing | Stored as | Stopped by walls? |
|---|---|---|
| Wall bead (one unit of lipid in a wall) | position, `next`, `prev` | n/a |
| Solute particle | position, lipid-share byte, idle marker byte, founder id | yes |
| Food, waste, free lipid | integer count per grid cell (cell edge 4) | no |

Beads are bonded into closed rings. Each bond `i -> next[i]` has the interior on its left, so every ring is
counter-clockwise. There is no vesicle record and no id: a vesicle is a ring, found by walking `next`, and its
contents are the particles that fall inside its polygon. Observers compute both; the rules read neither.

## One step, in order

1. **Wall contact.** A bead within `rw` of any bond it is not an end of is pushed away from it, and the
   bond's two beads take the opposite push. The push is `kw * (rw/d - 1)` at gap `d`, so it grows without
   bound as the gap closes. Exception, the pinch: if the bead is on the bond's interior side and the bead's
   own interior faces the bond, the two bonds reconnect so that one ring becomes two. The reconnection is
   only made if both daughters have at least `minBeads` beads and at least `minArea` of positive area, and
   neither new bond would touch or cross another bond anywhere along its length, or the other new bond; otherwise the pair is
   pushed apart like any other. Rings never fuse.
2. **Wall forces.** Each bond is a spring with rest length `l0`. Each bead resists bending (a five-bead
   stencil). Each bond is pushed toward its interior by the ambient pressure `pOut` times its length: the
   outside water is taken as a well-mixed solution that needs no particles.
3. **Solute.** Each particle is pushed away from any bond within `rp` by the same kind of force
   (`kp * (rp/d - 1)`, capped at half of `rp` per axis per step), and the bond's beads take the opposite
   push. That is the only coupling between contents and wall: pressure is the crowd leaning on it. Then the
   particle takes a random step. A move that would end on a bond or pass through one is not made: the
   particle stays where it is for that step (the wall has still felt the push). A particle exactly on a
   bond, where the push has no direction, is pushed toward that bond's interior at the cap, and may only
   move to that side.
4. **Beads move** by force plus a small random step, capped at `beadCap` per axis. A bead in contact
   (within `rw` of a bond, or an end of a bond that another bead is within `rw` of) is capped lower: 0.17
   times its smallest such gap per axis, so the bead and the bond it faces close less than half the gap
   between them in one step and cannot pass through each other however hard the contents push. Walls out
   of contact are more than `rw` apart, farther than any step. After a pinch the contact pass is done again
   on the new rings before anything moves. Six gardens checked at every one of 30,000 steps showed no
   crossing.
5. **Rupture.** If eight bonds in a row are all stretched past `sBurst`, the ring returns to free lipid and
   its contents are loose. Each bead is tested one step in eight.
6. **Lipid exchange**, both ways and by mass action:
   - a bond takes one unit of free lipid from its grid cell with probability
     `kIn * lipid * clamp(1 + stretch/sIn, 0, rateMax)`, and a new bead appears at its midpoint;
   - a bead leaves with probability `kOut * clamp(1 - stretch/sOut, 0, rateMax)`, and one unit of lipid
     appears in its grid cell.
   Stretch raises uptake and lowers loss, so with a fixed stock a tense wall grows at a slack wall's expense.
   A bead does not leave if the shortcut bond it would create crosses another bond. When a bead is due to
   leave a ring of six beads or fewer, the whole ring dissolves instead.
7. **Chemistry** (off in the mechanics scenes). For each particle, with `f` the food in its grid cell:
   - decay: with probability `kDecay` it becomes one unit of waste;
   - copy: if at least one other living particle shares its grid cell, with probability
     `kRep * food factor * crowd factor * (1 + tradeoff * (128 - share)/127)` one food becomes a new particle
     at the same place, with the parent's bytes, each shifted by up to `mutStep` with probability `mut`;
   - lipid: with probability `kLip * food factor * share/128` one food becomes one lipid. If a wall bond is
     within `rIns` of the particle the lipid goes straight into the nearest such bond as a new bead;
     otherwise it enters the water. A particle that has just used the last food in its cell on a copy makes
     no lipid that step.
   Copying needs company, so solute thrives where a wall keeps it concentrated and decays where it is loose.
8. **Light and decay of lipid.** Waste becomes food at rate `kLight`; free lipid becomes waste at `kLipDecay`.
9. **Diffusion** of free lipid, food and waste between grid cells. The amount leaving a cell is rounded by
   chance and odd units go to directions chosen without a favourite. (An earlier version filled directions in
   a fixed order, which drifted everything toward one corner.)

`share` is the particle's lipid-share byte (128 at the start). With `neutral` on, the rules read 128 for every
particle while the bytes are still copied and shifted: the drift reference. The idle marker byte is never read.

## Optional: heredity in the wall (`wallGenes`, rung 3)

Off by default; with it off nothing above changes. With it on:
- every wall bead carries the two bytes; a new bead (from the water or made directly) copies them from one
  end of the bond it joins, picked evenly, each shifted with probability `mut`;
- in step 7 a particle that is due to copy does so only if a wall bond is within `rIns` and the particle is
  on the wall's interior side there (at a bead, judged against both of that bead's bonds); the copy takes
  the bytes of the nearest bead of that bond, unshifted. A particle's bytes are then a stamp, not a lineage.

`wallGate` is a control: the same condition on where a copy can be made, but the copy takes its parent's
bytes, shifted, as in step 7. Results: `docs/vesicle-wall-genes-2026-11-19/README.md`.

## Optional: wild worlds (`lightPatches`, `wild()`, `Weather`; stage 3, "make dividing pay")

Off by default; with it off nothing above changes. With `lightPatches` > 0, step 8's light acts only in grid cells whose centre
lies within `patchR` of a patch centre (distances wrap round the dish). Patches start spread by the golden angle and drift in straight
lines at `patchSpeed` per step, a pure function of the step with no random draws. The rate inside is `kLight` times
(cells in the dish / lit cells), so the dish's mean light equals the uniform case (while that rate is at most 1; above it the light is capped and the mean is lower). `wild(area)` in `worlds.ts` gives a dish of `area`
times the base area (4 by default), proportionally many founders, patches covering about a quarter of it, and weather in proportion to
the rings: `Weather` (also `worlds.ts`) adds the number of rings to a count each step and bursts one ring, picked by its own generator,
each time the count reaches 100,000 (one ring per 5,000 steps per 20 rings; until 2026-11-20 it was a fixed interval of 100,000 / founders
steps, which grew weaker as the cells multiplied). `--wound-every N` still bursts one ring every N steps, as it always did. CLI: `--wild [--wild-area 4] [--no-light] [--no-weather]`, composable with `--wall`, `--gate`, `--thread`, `--heredity`.

## Optional: ties (`ties`, `tiesInert`, `Weather` refuge; stage 4, "bodies", first rung)

Off by default; with it off nothing above changes (every pin holds). Needs `wallGenes`. With it on:
- every wall bead carries one more byte, the glue byte, copied with the others from the same neighbour (one draw picks the source for all of them) and shifted like them. Glue never decides which neighbour a bead copies from, or insertion, desorption, springs or pinching of the ring.
- after a successful pinch (bead `c` closed the neck, `a` and `b` are the ends of the bond it met, `pc` was before `c`; daughter 1 is `c..a`, daughter 2 is `b..pc`), one number is drawn from a third generator used only for this (the main stream is not touched). With probability glue(c) / 255 the daughters are tied: a spring between the nearest pair among {c, a} x {pc, b} in which both beads hold no tie. If every such bead already holds one, no tie forms (counted as `tieBlocked`).
- a tie is a spring (rest length `tieRest` 2, stiffness `tieK` 0.1, pulling or pushing both ways, in a pass of its own after the wall forces and before anything moves) between two beads of different rings. A bead holds at most one tie (partner index, symmetric). Ties carry no matter. They are not walls: solute, the crossing checks and the bond hash never see them, and they add nothing to pressure.
- a tie ends when (a) stretched past `tieBreak` 6; (b) its ring ends (dissolve, burst, weather or wound): freeing a bead clears its tie and its partner's at once, so a freed slot never keeps tie state; (c) its bead desorbs from the ring and neither neighbour of that bead is free of ties. If one is free the tie hops to it instead (the one nearer the partner; the previous bead if equal) and nothing ends.
- a ring that pinches keeps its ties with their beads: each goes to whichever daughter keeps the bead.
- `tiesInert` (needs `ties`): the glue byte is carried and shifted exactly the same, and no tie ever forms.
- refuge (`Weather`, runner side, off by default): when the weather picks a ring that holds at least one tie, the pick is wasted with probability `pRefuge` (0.8). The draw comes from Weather's own generator and is made only for tied rings, so without ties nothing changes. Stands for a grazer that takes single cells more easily than attached ones.

Clusters are never in the physics: an observer finds them by walking ties between rings (`tieGraph`, `tieStats`, `TieObserver`). Cell and cluster sizes in `cells.tsv` and `ties.tsv` count rings; the census row counts live cells (5 or more solute).

## What is conserved

Every bead, particle, food, waste and lipid unit counts as one unit of matter, and every reaction is one for
one: food to solute, food to lipid, solute to waste, lipid to waste, waste to food, lipid to bead and back.
`matter()` is exact and the tests assert it does not change. Energy is not tracked; light is the open input.

## Numbers and reproducibility

Counts are integers. Positions and forces are float64, and the step uses only `+ - * /`, `Math.sqrt`,
`Math.floor`, comparisons and 32-bit integer operations, all of which give identical results on every
conforming engine, so a seed gives the same run bit for bit in
Node, Deno and browsers (checked in Node and Deno, which share one engine; not checked in Firefox or Safari). Seeding uses its own sine and cosine for the same reason. Randomness is one
sequential generator (sfc32), so the order of operations is part of the rule.

Two consequences: there is no GPU twin, and a port to f32 or to a parallel update order would not match this
reference. Making it portable in the repo's usual sense means fixed-point positions and a counter-based
generator; that work has not been done.

## Known properties and limits

- The world is flat. A wall is a line and a volume is an area, so the surface-to-volume arithmetic is the
  two-dimensional one: with wall and area both fixed, a vesicle can split into two round ones only once its
  roundness (4 pi area / perimeter squared) has fallen to 0.5 for equal halves, or 0.68 for an 80/20 bud.
- Walls leak a little. When a bead leaves at a corner the shortcut bond can pass over a particle; in the
  inflate scene, before the second round of fixes, this lost 4 of 4,800 particles over 8,000 steps each.
- Chemistry visits particles in storage order, last slot first. New particles are appended, so the order
  mostly runs from newest to oldest, but a decay moves the last particle into the freed slot. The particle
  visited first has first call on the food in its grid cell. The order does not read the bytes, yet it can
  correlate with family, so it is a possible confound for claims about families; the drift-only arm carries
  the same order.
- The bytes are clamped to 0..255, so near either end shifts can only point inward. Both bytes are treated
  alike.
- The bond hash is built at the start of the step, again after each pinch, and again before the first
  lookup that follows a bead leaving a ring. Lookups reach a bond split since the build by walking through
  the beads born this step, and a bead slot freed in a step is not reused until the next one.
- A particle never moves through a wall, but a wall can still move over a particle: a bead's own step
  (at most `beadCap` per axis) or the shortcut bond made when a bead leaves is not checked against
  particles. Three sealed, crowded cells kept all of their particles for 20,000 steps.
- The ambient pressure is a declared constant, not simulated solute.
- A ring that dissolves or ruptures goes back to free lipid at once and whole.
