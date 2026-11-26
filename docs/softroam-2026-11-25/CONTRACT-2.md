# Soft Roam, chunk 2: sun, leaves, senses, truce, release cap (contract v2, 2026-11-25)

Read `CONTRACT.md` (v1) first: its arithmetic rules, "no result may depend on slot, bucket or evaluation order", and
"Rules for every agent" all still hold. This file adds to it. The kernel header states the rules as built.

**What the owner asked for** after watching chunk 1 ("looking good; I like it directionally"): prey sensing for
mouths; a cap on releases (the crumb source); hunters not piling up or eating each other; plans that build multi-cell
armoured bodies; another cell type so larger bodies are more dynamic inside; group benefits and hindrances; and a
world with cycles: more and less food, a sun, cycles within cycles.

**Best case for this chunk:** day sweeps across the world and the year swings from lean to rich; green-leaved bodies
swell in the light and thin in winter; hunters curve toward prey they can sense and the prey veers away; bodies of
several kinds of cell (leaf rim, plain gut, shell armour, mouth front) hold together at 20 or more cells; the numbers
of each kind rise and fall with the seasons without any kind dying out.

## Hard limits
- Every key below is optional and absent from `defaultSoftRoamConfig()` and from every existing start. With all of
  them absent the kernel takes exactly the old path: `apps/lab/test/softroam-pins.test.ts` (digests at commit
  d9a53cdd) must pass untouched, and so must every existing softroam test. No new hash draw, array read that changes
  a result, or change in evaluation order may happen when a key is absent. New per-cell state (such as the release
  record) and new counters enter `digest()` only when their key is set.
- `apps/lab/src/roam/*` and `packages/*` are not edited: `git diff d9a53cdd -- apps/lab/src/roam packages` stays empty.
- Matter stays closed, residual exactly 0. All new arithmetic is integer, inside 31 signed bits, keyed on cid or tile.
  The 31-bit rule binds new dynamics only. The existing scent, thrust and slope arithmetic is kept exactly as it is
  (replay of old histories needs its wide intermediates), whatever its range. Cumulative census counters
  (`releasesHeld`, `leafIncome`, and the rest) are not dynamics: they are exact host integers and may pass 2^31.
- New hash channels: use numbers from 60 to 79, named constants, one purpose each.
- Config checks (throw at construction): `year` and `patchSun` need `day`; `winter` needs `year`; `leaf` needs `day`;
  `sight`, `fear` need kinds and drain; `releaseGap` is a whole number of at least 1; `releaseMin` at least 1.

## A. Hunting (kernel task A)

**One predicate.** `canAct(x, y)`: cell x could act on cell y by touch. It is the existing eligibility (different
bodies; neither body sealed; x's body at least twice y's in cells; with kinds, x is a mouth; y is plain, mouth or leaf,
or y is a shell and `crack` is set) and, new: not when `truce` is on and `fam[x] === fam[y]` (and nonzero); not when
`jaws` is on and y's body holds any mouth cell. It reads the labels, sizes and kinds of the stage it is called in.
Touch feeding, hits and grip call it on the pairs the existing contact selection already chose; sensing and fear call
it on candidate cells.

- Contacts are chosen exactly as now (mutual top four by pair-hash rank; only `sealed` is filtered there). `canAct` is
  applied afterwards, to the chosen pairs, and decides what each pair does. It is not applied while choosing, so a
  contact that `canAct` refuses still uses up one of the four places, as the old path does.
- `truce?: boolean` — cells of the same founder family (`fam`) do not feed on, hit, grip, sense or fear each other.
  Keyed on `fam`, which copies unchanged through every division, not on `pid` (a plan copy error makes a new `pid`).
  Cells with `fam` 0 are never in truce.
- `jaws?: boolean` — no cell of a body that holds a mouth can be fed on, hit, gripped or sensed as prey.
- `sight?: number` (tiles, 1 to 8; needs kinds and drain). Runs in step 0 (commands), only for a mouth cell x of an
  unsealed body whose chase gene is not 0, from positions, labels and sizes as the step starts (commands rebuilds the
  tile buckets when `sight` or `fear` is set, so newborns count and freed slots do not). Candidates are the live cells y
  with `canAct(x, y)`, using the existing shortest torus deltas (`dlt`); a candidate with either delta outside
  `[-sight * U, sight * U]` is dropped before anything is squared, so the squared sum stays under 134,217,728. The
  target is the lowest by this tuple, in order: squared distance; the symmetric pair hash on `CH_SIGHT_A`; a second
  symmetric pair hash on `CH_SIGHT_B`; the candidate's cid. If there is a target, x's chase term is the directed
  one, `ux += trunc(abs(chase) * cosQ14 / 8192)` and `uy += trunc(abs(chase) * sinQ14 / 8192)`, with the Q14 unit
  vector from `softRoamAngle` toward the target, in place of the scent term `trunc(chase * slope / 512)`. So the
  gene's sign does not flip it (a negative-chase mouth still closes), chase 0 contributes nothing, and with no target
  the scent path is used unchanged. The cost rule is unchanged (thrust is prepaid).
- `fear?: number` (tiles, 1 to 8; needs kinds and drain). The mirror, for a plain or shell cell y of an unsealed body
  whose chase gene is not 0 (a leaf has no thrust and does not run fear): the target is the lowest by the same tuple
  (channels `CH_FEAR_A`, `CH_FEAR_B`) among mouth cells x with `canAct(x, y)` in range; the directed term points
  directly away from x, by the same formula, in place of the scent term.
- Census gains `hunting` (mouth cells with a target this step), `targets` (distinct target cells), `fleeing`, each
  counting only cells that actually steer. `hunting / targets` is the target concentration. It is not a measure of
  hunters being close together (hunters can share a target from far apart), and no rule here makes hunters spread out.
- `releaseMin?: number` — a plan release (a daughter that would become a new body) happens only when the mother's
  body has at least this many cells, counted once as the division stage starts (after the death relabel, before any
  daughter of this step); otherwise the cell waits, mode unchanged.
- `releaseGap?: number` — a body releases at most once in this many steps: a release at step t permits the next at
  t + releaseGap. The record belongs to the whole body: a release writes `t + 1` into the release record of every cell
  of the releasing body (0 means never released, so founders are not held and a one-step record cannot be mistaken
  for step 0); a kept daughter copies its mother's record; a body's last release is the largest record over its
  cells, so a tip that dies cannot erase it, and every fragment keeps it. A released daughter starts with record 0
  (no cooldown). Within one step releases are accepted in the existing fresh hash order and a body that has released
  this step waits (two cells of one body cannot both release in a step under `releaseGap`; `releaseMin` alone does
  not forbid it).
- Order of checks in division, so counts are exact: the held-offset case first (a kept daughter counts as done), then
  no free slot, then `blockedAt`, then `releaseMin` and `releaseGap`, then the birth. `releasesHeld` (cumulative) counts
  once per ready cell per step, only when the release would otherwise have been placed.

Tests (`apps/lab/test/softroam-hunt.test.ts`): a lone hunter 5 tiles from eligible prey closes the distance with
sight and does not without; fixture: an isolated two-cell hunter (a one-cell hunter has no eligible prey) against one
prey cell, positive chase, drive 0, closes; the same with chase negative also closes, and a prey with fear and
negative chase still opens the distance; chase 0 does nothing and is not counted; it ignores prey it could not eat (too
large, sealed, same family under truce, any cell of a body holding a mouth under jaws, a shell without crack); a prey
half a world away along both axes in a 256-tile world is rejected before squaring; prey with fear opens the
distance; the target choice is the same under slot permutation and reversed bucket scan, and for two equidistant
candidates whose first pair hashes collide (source 56617, candidates 6068 and 57348, as in `softroam-kinds.test.ts`)
it falls to the second hash; contacts picked with truce and jaws on are the same set as with them off (only what
the pairs do differs); truce and jaws stop feeding, hits and grip exactly; a six-cell hunter cannot drain the plain
rear cell of a three-cell hunter under jaws; `releaseMin` and `releaseGap` hold releases exactly (count releases over
a run against the bound); a tip that releases at step 100 and dies at 101 does not let its body release again before
100 + `releaseGap`, and both fragments of a split body keep the cooldown; a released daughter can release at once; a
release held by `releaseMin` and also blocked by `blockedAt` adds nothing to `releasesHeld`; two cells of one body
cannot both release in one step under `releaseGap`; residual 0 over 3000 steps on two seeds with everything on; pins
untouched.

## B. Sun and leaves (kernel task B)

- `day?: number` (steps, 16 to 2^20). `year?: number` (steps, at least `day`, up to 2^24; absent = no seasons; needs
  `day`). `winter?: number` (0 to 1, light in deepest winter as a share of midsummer; default 0.25 when `year` is set;
  needs `year`).
- Light at tile (tx, ty) at step t, an integer 0 to 256, by integer triangle waves:
  `tri(p) = p < 512 ? p >> 1 : (1024 - p) >> 1` (p in 0..1023, result 0..256);
  `dp = (floor(tx * 1024 / size) - phase(t, day)) & 1023`; `dayL = clamp(2 * tri(dp) - 256, 0, 256)`
  (a lit band half the world wide sweeps round the torus once a day; the other half is night);
  `seasonL = W + (((256 - W) * tri(phase(t, year))) >> 8)` with `W = round(winter * 256)` (the whole world brightens
  and dims once a year; 256 with no year); `light = (dayL * seasonL) >> 8`.
  `phase(t, period)` is the ten-bit phase `floor((t % period) * 1024 / period)`, computed without the wide product:
  start with `r = t % period`; ten times: `r = 2 * r`, and if `r >= period` emit a 1 bit and subtract `period`, else
  emit 0 (bits from the top). The largest intermediate is under 2 * period, at most 2^25.
  Exported as a pure function `softRoamLight(cfg, tx, ty, step)` and a world method, for the painter and tests. It
  returns 256 when `day` is absent.
- `patchSun?: boolean` (needs `day`) — applies only to patches that fall in `step()`, not to the start patches at
  construction. A scheduled patch keeps its existing centre draw; then it lands only if
  `(roamHash(seed, t, centreTile, CH_PATCH_SUN) & 255) < light(centre tile, t)`, with `centreTile = cy * size + cx`;
  otherwise it is skipped, the reservoir keeps the matter, and the next scheduled step tries again.
- `leaf?: number` (matter per step a fully bare leaf earns in full light, 0 to 4; needs kinds and `day`; 0 is allowed
  and means leaves earn nothing). Defines `KIND_LEAF = 3` in the soft kernel (not in Roam). With `leaf` set, and only
  then: plans may hold kind 3 (`addPlan` accepts it; its kind check and, with toughness off, its entry ceiling rise to
  allow it, to `0x3fff`); and the kind field of the plan-copy error draws a new kind as
  `(kind0 + 1 + h % 3) % 4`, so a copy error always changes the kind (field choice and the three-kind branch without
  `leaf` stay as they are, so old histories do not shift).
  - A leaf cell never eats from the ground, even as a one-cell body. Thrust: a leaf in a sealed body thrusts and pays
    exactly as any sealed cell does (the existing body-wide path, full thrust along the release direction, move cost
    paid). Otherwise a leaf has `tx = ty = 0`, pays no move cost, and keeps its velocity and spring forces.
  - Income, in the eat stage. `Q = 65536`, `leafQ = round(leaf * Q)`. For a leaf cell c on tile T with `exposed` (0 to 4,
    the same topological count upkeep uses, so light comes in through bare sides: a leaf buried in its body earns
    nothing) and `n` leaf cells whose centres share T (n capped at 16 in the formula):
    `ask = SR(leafQ * light(T) * exposed, 4 * 256 * Q * n)`, with the rounding draw on `CH_LEAF` keyed on c's cid;
    the division by n happens inside the rounding, so shaded leaves share what the tile gets rather than rounding to
    zero. Then `ask = min(ask, room)` with `room = max(0, 4 * birthStore - store[c])` as in `eat`.
  - Payment: one reservoir snapshot R taken after thrust is prepaid and before upkeep; `total` is the sum of asks. If
    `total <= R` each leaf gets its ask; otherwise each gets `floor(ask * R / total)` (under 2^30: ask is at most 1024,
    R under 2^20). The reservoir is debited exactly the sum paid, and the rest stays. Patches draw later in the step,
    as now. The result does not depend on cell order.
  - A leaf is fed on like a plain cell. Upkeep, flow, wear, death and compost are as for a plain cell. `sight` and
    `fear` do not use leaf cells as the seeing or fleeing cell.
  - Census gains `leaves` and `leafIncome` (cumulative). Events gain nothing.

Tests (`apps/lab/test/softroam-sun.test.ts`): light values at hand-worked points (band position through a day,
winter floor, mid-year peak, 256 max, never outside 0..256, and at `year = 2^24`, `t % year = year - 1`); light is 256
without `day`; a leaf in full light earns `leaf` per step on average over many seeds and 0 at night; a buried leaf
earns 0; two leaves on one tile each earn half on average (check at `leaf` 1 and light 128, where a floor after
rounding would give 0); a leaf at its store cap earns 0; with the reservoir nearly empty the total paid never exceeds
it (two leaves asking 4 each against a reservoir of 3 pay 1 each, 2 in all, and 1 stays), residual stays 0 and the result is the same
under slot permutation; a leaf never eats ground food; an unsealed leaf never thrusts and pays no move cost, a leaf in
a sealed body thrusts and pays as any sealed cell; with `leaf: 0` the plans, kind mutation and kind 3 stay legal
and income is 0; `patchSun` skips scheduled patches in the dark (count over a run) with the matter kept, and leaves
the start patches alone; `patchSun` or `year` without `day` throws; kind 3 is refused without `leaf`; the kind mutation
never yields 3 without `leaf`, and with `leaf` it never returns the current kind; residual 0 over 3000 steps on two
seeds with everything on; pins untouched.

## C. Surfaces (after the kernel is reviewed and committed)

- `view.ts`: Soft Roam's own founder types (plans written with `planEntry`, defined here, not in Roam), each grown
  alone and looked at before it is kept: an armoured grazer (plain cells that eat, a shell rim; at least 9 cells), a
  bush (leaf rim, plain or leaf core, slow), a hunter (mouths in front, plain behind), plus the garden's types. A new
  start `seasons` (the page default) with every chunk-2 key on at tuned values; `garden` stays selectable and unchanged.
- Picture: night dims the ground and day warms it, as a soft band that visibly sweeps; winter is cooler and dimmer;
  leaves are green and brighten with what they earn; nothing pops.
- Page: the season and time of day in words, counts of each kind, dials for the new keys with plain-words labels.
- `look.ts`: rows gain leaves, leaf income, hunting, targets, fleeing, releases held, light; `--series file.tsv`
  writes one census row every `--every` steps so a run of several years can be plotted.

## Evidence the note must hold
Seeds 1 and 2 at the page defaults over at least three years, with a plotted time series of cells by kind against the
season; the same with each mechanism off in turn (sight, fear, truce, jaws, release cap, leaf, sun) on seed 1 (leaf off is
`leaf: 0`, which keeps the plans and kind mutation; sun off is constant full light with ungated patch drops, which
keeps the founder plans and leaf income; it needs a runner-only light override, not a config key), so the
note can say what did what, including whether truce or jaws shut predation off; hunting / targets as the target
concentration (not a spacing measure); seeds 3 and 4 run once at the end and reported as they come. What is left out of the owner's list is said
plainly.

## Risks the tuners must check
Reviewers predicted these; none is designed against here. Look for each in the first runs.
- Leaf income draws on the same reservoir as patches (with compost, inflow is only upkeep and move cost, a few matter
  a step), so enough leaves can pin it near 0 and stop patches, starving grazers; a separate leaf pool was suggested.
- `patchSun` at `patchEvery` 20 delays a due patch by hundreds of steps at most, less than the reservoir takes to
  refill, so the long-run patch rate may not follow the year; patch size or rate may need to scale with the season.
- Starvation from `birthStore` to `minStore` takes thousands of steps at the page leaks, longer than half a year, so
  winter may not thin the bodies unless leaks rise or `birthStore - minStore` shrinks.
- Fear (plain and shell cells, all of them) may outrun sight (mouths only, a fraction of the body): a hunter's plain
  cells keep thrusting along heading and scent, a one-mouth body barely bends, and two mouths with opposite targets
  cancel. Hunters may starve or evolve into all-mouth clumps. One target per body, or a smaller fear share, was
  suggested.
- Several hunters can steer onto and grip one prey; truce and jaws leave those pairs eligible; no crowd response exists.
- `releaseMin` sterilises any plan that is smaller than it or reaches a release mode first (the cell waits for ever);
  founder plans used with it must grow to `releaseMin` cells before any release mode.
- Truce on `fam` covers founder type only: two types (a hunter and a grazer) are not in truce, and jaws protects only
  bodies that hold a mouth.
- A one-cell leaf has `exposed` 4 and earns most per cell; a leaf in a large body earns less, so selection may favour
  small sitting leaf crumbs over 20-cell bodies.
