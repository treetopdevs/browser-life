# Soft Roam, chunk 3: big bodies, body steering, a leaf pool, a real winter (contract v3, 2026-11-26)

Read `CONTRACT.md` (v1) and `CONTRACT-2.md` first; their arithmetic rules, order independence, hard limits and
"Rules for every agent" all still hold. This file adds to them.

**What the owner asked for** (2026-11-26): the first four of chunk 2's ranked rule changes, taken from `NOTE-2.md`:
(1) bigger founder plans (20+ cells) or plans that regrow their body; (2) body-level steering toward the mouth's
target or away from a threat, a prey size rule tied to mouths in contact, and a crowd response; (3) a separate leaf
pool; (4) a season-scaled patch size and a winter upkeep, so the year is a forcing and winter thins bodies.

**Best case:** bodies of 20 to 30 cells of three or four kinds hold together for a year, lose cells and grow them
back; a hunter body visibly turns toward prey and a prey body turns away; several mouths of one hunter body open an
armoured body bigger than half its size; hunters spread over several prey instead of packing one; leaves are more
than a few percent of cells; winter thins bodies, not only their number.

## Hard limits (as chunk 2)
- Every key below is optional and absent from `defaultSoftRoamConfig()`, from the garden start and from the seasons
  start. With all of them absent the kernel takes exactly the chunk 2 path: `softroam-pins.test.ts` and every
  existing softroam test pass untouched, and so does a new pin of the seasons start's digest at commit b62f26c2. New
  per-cell state and counters enter `digest()` only when their key is set.
- `apps/lab/src/roam/*` and `packages/*` are not edited.
- Matter closed, residual exactly 0, with the leaf pool counted: `total = food + held + reservoir + leafPool`.
- New hash channels 66 to 79, named, one purpose each (none needed so far).
- Config checks (throw at construction): `heal` true or false; `steer` needs `sight` or `fear`; `pack` (whole, 1 to 16) needs kinds and
  drain; `crowd` (whole, 1 to 4) needs `sight`; `leafPool` (0 to 1) needs `leaf`; `leafPoolMax` (whole, 1 to 2^20)
  needs `leafPool`; `patchSeason` and `winterCost` (0 to 1) need `year`.

## Probe before building (2026-11-26, scratchpad probe1.ts)
A 25-cell plan written in the existing plan language (a spine of five, a side cell each way, an outer cell beyond each
side) grows to 25 alone within 300 steps. In the seasons start with the three types swapped for 25-cell versions, the
largest body on seeds 1 and 2 over 24,000 steps is 10 to 19 and no cell is ever in a body of 20+; with `life` 60,000 it
is 20 to 23 with about 40 cells in bodies of 20+. So plan size alone does not give big bodies: wear removes cells (a
25-cell body at life 8,000 loses one every 320 steps) and a death in the middle splits the body. Regrowth is the
lever, so it is built first.

## 1. Healing (`heal?: boolean`), in place of the planned `regrow`
The kernel already regrows a lost daughter: when a cell dies its mother goes back to the mode that made it
(`die()`, "a mother returns to the earliest mode that made a lost daughter") and builds it again. What keeps bodies
small is splitting: when a cell inside a body dies its daughters lose their mother link, the body parts for good, and
each piece's head restarts the founder plan from mode 0. A `regrow` cadence (a cell at the end of its plan goes back
over it) was built and dropped before review: it duplicates that rule, and Codex found it can stop a release loop for
good (`regrow` 1 with every kept place held rewinds the releasing cell every step).
- With `heal`, bodies are the groups joined by mother links *or braces* (braces are springs to same-body cells at
  lattice offsets, made at birth and dropped when a cell dies). So a hole left by a dead cell does not split a body
  while braces span it, and the mother rebuilds the cell in the hole.
- A cell whose mother dies loses its mother link as now; it restarts from mode 0 only when the death relabel makes it
  the head (lowest cid) of a body it did not head before: an orphan of this death, or one of an earlier death that a
  brace kept in its body until now (Codex kernel review, P2). So a piece that really parts still regrows as a cutting; a cell that stays
  in its healed body keeps its mode.
- Probe (seasons start, the three types as 25-cell plans): without heal the largest body is 10 to 19 and no cell is in
  a body of 20+; with heal and `releaseMin` 18 the largest is 21 to 25 and 20 to 66 cells (5 to 10 percent) are in
  bodies of 20+ from step 9,000 on, seeds 1 and 2.

## 2. Hunting
- `steer?: boolean` (needs `sight` or `fear`): one aim per body. In commands, before headings move, every seeing
  mouth and fleeing cell finds its own target as in chunk 2 (same snapshot, same rules). A body's flee aim is the
  lowest over its fleeing cells by (squared distance, pair hash `CH_FEAR_A` of the pair, second pair hash `CH_FEAR_B`,
  threat cid, own cid); its hunt aim the same over its seeing mouths with the sight channels and the crowd score in
  place of the squared distance. A flee aim wins over a hunt aim. With an aim (and the body not sealed):
  - the body's turn-left becomes the signed heading difference, in -512..511, from the body heading to the direction
    from the aiming cell to the target (from the threat to the fleeing cell for a flee); no turn draw is read this step
    for that body; the heading then moves at most 16 a step as now;
  - every non-leaf cell of the body with a nonzero chase gene uses the directed chase term toward the aim's target
    (away from the threat for a flee), measured from itself, in place of its own sensed term or the scent term.
  Census `steering` (bodies with an aim this step). `hunting` and `fleeing` then count every cell that steers by a
  sensed direction, its own or its body's.
- `pack?: number` (whole, 1 to 16; needs kinds and drain): the size test of `canAct` becomes "x's body at least twice
  y's, or `pack * M >= size(y's body)`". In touch feeding, hits and grip, M is the number of distinct mouth cells of
  x's body that are in a chosen contact pair with a cell of y's body (counted from the chosen pairs of that stage or
  substep, before any pair acts, whatever truce, jaws or crack say; sealed bodies have no contacts). In sight and fear
  M is the number of mouth cells x's body holds as the step starts. The rest of `canAct` is unchanged.
  When a chosen pair could act both ways (two bodies with enough mouths each), neither acts and grip does not pull:
  a standoff, so hunters do not eat each other by pack.
- `crowd?: number` (whole, 1 to 4 tiles; needs `sight`): a mouth ranks a candidate by `d2 + n * (crowd * U)^2`
  instead of `d2`, n (capped at 8) being the mouth cells of bodies other than the seeker's within 1.25 D of the
  candidate, from positions as the step starts. Ties as now. d2 is under 2^27 and the penalty at most 2^27.

## 3. Leaf pool (`leafPool?: number`, `leafPoolMax?: number`)
- A second store, `leafPool`, which only leaves draw on. In upkeep, of the total P paid this step by all cells
  (upkeep and winter cost; not thrust), `floor(P * q / 256)` with `q = round(leafPool * 256)` goes to the pool, up to
  `leafPoolMax` (default `patchFood`), and the rest to the reservoir (P is under 2^19, so P * q is under 2^27).
- The leaf stage pays from the pool instead of the reservoir, with the same proportional rule when short.
- Census `leafPool`; `residual = total - food - held - reservoir - leafPool`, which `checkInvariants` reads; the pool
  enters the digest only with the key.

## 4. Seasons as forcing
- `patchSeason?: boolean` (needs `year`): a scheduled patch holds `max(1, floor(patchFood * seasonL / 256))` and is
  due when the reservoir holds that much (start patches unchanged). `seasonL` is the year term of the light (no day
  band), so with `patchSun` too the patch is both rarer and smaller in winter: the season acts twice, on purpose.
  Whether it bites depends on the inflow: at the seasons economy a full patch every 12 steps is up to 83 a step in
  summer and 8 in deepest winter, to be set against the c2 series' upkeep plus thrust; the note must say which.
- `winterCost?: number` (0 to 1; needs `year`): every cell pays, with its upkeep and in the same rounding draw, an
  extra `floor(winterQ16 * (256 - seasonL) / 256)` in Q16 a step.

## 5. Surfaces
- `view.ts`: three founder types of 20+ cells written with `softPlan` (each grown alone at the page defaults and
  looked at): a big armoured grazer (plain gut, shell rim), a big bush (leaf rim, plain core), a pack hunter (several
  mouths in front, plain behind). Each releases from a looping release mode in its front cell, reached once that
  cell's own sides are in (not necessarily the whole body: see NOTE-3).
- A new start `bodies` (the page default): the seasons start plus every chunk 3 key at tuned values and the three new
  types (and the seasons types). `seasons` and `garden` stay selectable and unchanged.
- Page dials for the new keys; `look.ts` rows and series gain splits, steering and the leaf pool.

## Tests (`apps/lab/test/softroam-bodies.test.ts`)
Pins: garden pins untouched; seasons start digests (seeds 1 and 2, 64 tiles, 1500 steps) pinned in
`softroam-pins.test.ts` before any kernel edit and untouched after.
Heal: a body whose interior cell dies stays one body and the hole is rebuilt at its lattice place; without the key
it splits; a piece that does part (no brace spans the gap) has its head restart from mode 0, and a cell that stays in
its healed body keeps its mode; labels do not depend on slot order; every founder of its own releases a daughter that
itself builds and releases. Steer: a lone hunter body with
sight and steer turns its heading toward prey off to its side within 40 steps and without steer does not; a prey body
with fear turns away; the turn-left set by an aim is the signed difference worked by hand;
an 8-cell hunter with drive closes on prey faster with steer than without;
target choice is slot-permutation independent. Pack: a standoff pair acts neither way; a 3-mouth body of 4 cells may act on a 6-cell body with pack 2
and not with pack 1 or without the key; the touch count uses distinct mouths in contact; an armoured body at the
seasons crack (10,000) is still not opened in a short fixture, which the note must say. Crowd: of two equidistant
prey, the one with another body's mouth next to it is not chosen. Leaf pool: leaves draw only from the pool;
the pool is capped; residual 0. Season: patch size follows the season; winter cost is zero at midsummer and largest
in deep winter. Residual 0 over 3000 steps on two seeds with everything on; slot-order independence with everything
on.

## Evidence the note must hold
Seeds 1 and 2 at the `bodies` defaults over three years with the series plotted (cells by kind, largest body, share of
cells in bodies of 20+, against the season); each chunk 3 mechanism off in turn on seed 1; seeds 3 and 4 once at the
end. What is not shown is said plainly.
