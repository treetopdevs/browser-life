/**
 * Soft Roam (2026-11-25): Roam's bodies, but soft. The same plan + flow + life + compost world, with cells that have
 * real positions and glide, instead of sitting on tiles and hopping.
 *
 * A cell is a disc of diameter D = 1024 units (U = 1024 units make one tile) at an integer position on a torus. A bond
 * joins a cell to the daughter it made and is never formed any other way, so bodies cannot fuse. Nothing declares a
 * body: each step the groups of cells joined by mother links are found, and that group is what has one heading, turns,
 * and parts into pieces when a cell in the middle dies. A cell remembers where it would sit in its body's plan lattice
 * (gx, gy); a daughter is born one lattice step from her mother, and she and her neighbours at lattice distance are
 * joined to her by springs that always aim for lattice distances, never for where cells happen to be. So a body keeps
 * its plan shape however it is pushed, a bent line straightens, and a piece that parts regrows like a cutting.
 *
 * Each step: (0) bodies are found, each picks its heading (a hashed turn event adds an angle still to turn, and the
 * heading moves toward it at most 16 of 1024 per step), and every cell works out a thrust (its drive gene along the
 * heading plus its chase gene along the smooth slope of the scent) and pays for it up front to the reservoir; (1) four
 * substeps of mechanics: from a snapshot of positions every cell sums spring forces from its mother and daughters
 * (bonds), from up to four braces and from cells it presses on, the thrust (with the part that points into another
 * body's cell removed, so a body never ploughs through another: the contacts of every cell of a body apply to all its
 * cells, and a thrusting body also loses the part of its velocity that presses into a near-touching contact), then
 * velocity keeps a share of itself, takes the force, is clamped, and moves the position with a per-cell remainder so slow drift never stalls; (2) life, once: eat from the
 * tile under the centre (a crowded tile is shared in proportion to what each asked), pay upkeep to the reservoir, let
 * matter seep along mother links, die (store too low, or wear) with the store left as food, relabel at once so pieces
 * part cleanly, divide by plan (the daughter is born one body length away only when no cell is near the spot), drop a
 * patch of food from the reservoir now and then, spread food a little if asked, and relax the scent.
 *
 * Matter is closed: food on the ground + matter in cells + one reservoir is the starting total at every step, exactly.
 * All dynamics are integers (positions in units, velocities in sixteenths of a unit per substep, an integer sine table,
 * no float), every random draw is `roamHash(seed, step, key, channel)` keyed on a cell's never reused serial `cid` or on
 * a tile, never on a slot, and every force, contest and count is a sum from a snapshot or settled in the hash order of
 * cids, so slot order, bucket order and evaluation order change nothing: one seed gives one history.
 *
 * Milestone 2 adds kinds, touch, crack, toughness, shellBite, shellLeak and grip, all optional and absent from the default config
 * (so a world without them is the milestone 1 world, apart from the longer scent below). The seal that goes with drain is live as soon as
 * drain is set: a new body cannot turn and thrusts at full along its heading. With kinds, only plain cells and one-cell bodies eat from the
 * ground (a one-cell shell takes shellBite of the bite, rounded by a hash); a shell pays floor(leakSide (1 + tough) shellLeak) a bare side.
 * Touch (once a step, in the life stage after upkeep, from stores, sizes and kinds as they stand when it starts): cells of different bodies
 * within 1.25 D are in contact when neither body is sealed; each cell keeps the four contacts of lowest pair-hash rank (the hash is symmetric
 * in the two cids and fresh each step, ties to the lower cid), and a pair counts only when it is in both cells' lists, so no cell has more than
 * four. A mouth (any cell without kinds) of a body at least twice the other's size takes min(drain, floor(preyStore / takers)) from a plain or
 * mouth cell (`takers` is the number of such contacts on that cell, so a short store is split floor-equal); a mouth on a shell is one hit, and the
 * shell becomes plain at crack << tough hits (at most 60000), fed on from the next step. Grip pulls a mouth toward a cell it could act on (a shell
 * counts when crack is set) while they are between D and 1.25 D apart, by one integer added to one and taken from the other; it links nothing.
 * Mouths find prey by bumping into it, or, with `sight`, by seeing it (below); there is no prey scent.
 *
 * Chunk 2 (hunting; every key optional and absent from the default config, and with all of them absent the old path runs exactly, with no new
 * draw): one predicate `canAct(x, y)` says whether cell x could act on cell y by touch (different bodies, neither sealed, x's body at least twice
 * y's, with kinds x a mouth and y not a shell unless crack is set, not the same founder family under `truce`, not a body that holds a mouth under
 * `jaws`) and touch feeding, hits, grip, sight and fear all ask it; the four contacts a cell keeps are still chosen without it, so a pair it
 * refuses still uses up a place. `sight` (tiles): in the commands stage a mouth of an unsealed body with a chase gene steers by the gene's size
 * toward the nearest cell it could act on within that many tiles (ties by two symmetric pair draws, then the lower cid), instead of by the scent
 * slope; `fear` is the mirror, a plain or shell cell with a chase gene steering straight away from the nearest mouth that could act on it. The
 * census counts them per step (`hunting`, `targets`, `fleeing`); `hunting / targets` is how many hunters share a target, not how far apart they
 * are. `releaseMin` lets a cell release a new body only when its body had that many cells as the division stage began, and `releaseGap` lets a body
 * release once in that many steps (the release step is kept in every cell of the body, copied by kept daughters, so a dying tip cannot erase it);
 * what either holds back is counted in `releasesHeld`.
 *
 * Chunk 2 (sun and leaves; again every key optional, absent from the default config, and a world without them runs the old path with no new draw):
 * `day` (steps) sweeps a lit band half the world wide once round the torus, `year` (steps) swings the whole world between midsummer and a winter
 * of `winter` (0 to 1, default 0.25) of that light; `softRoamLight(cfg, tx, ty, step)` is the integer light 0 to 256 of a tile, from triangle waves
 * of ten-bit phases (no wide product, no float; 256 without `day`). `patchSun` lets a scheduled patch land only when a draw on the centre tile is
 * under the light there, else it is skipped and the reservoir keeps the matter (start patches are not gated). `leaf` (matter a step a fully bare
 * leaf earns in full light, 0 to 4; needs kinds and `day`) adds a fourth kind, KIND_LEAF = 3, to plans (a copy error then always changes the kind).
 * A leaf never eats ground food and an unsealed leaf never thrusts (a sealed one thrusts and pays like any sealed cell). Each step, in the eat
 * stage, a leaf asks `leaf * (light / 256) * exposed / 4` (light 0 to 256; rounded by a draw on its cid), shared among the leaf cells whose centres are on its tile (at
 * most 16 counted) and capped by its room; the asks are paid from the reservoir as it stands then, split in proportion when it is short. Leaves
 * are fed on like plain cells and otherwise live like them. The census counts `leaves` and a cumulative `leafIncome`.
 *
 * Chunk 3 (big bodies, body steering, a leaf pool, a winter; again every key optional and absent from every start before it, so those worlds run the
 * old path with no new draw). `heal`: bodies are the groups joined by mother links or braces, so a cell dying inside a body leaves a hole (its
 * mother goes back and rebuilds it, as always) instead of splitting the body; a cell whose mother dies starts its plan again only when it heads a
 * body of its own after the relabel. `steer` (needs sight or fear): each body takes one aim, the lowest over its seeing mouths and fleeing cells
 * (a flee before a hunt, then score, two pair draws, target cid, own cid); the body turns toward it (away for a flee, no turn draw that step)
 * and every cell of it with a chase gene steers by it from where it is. `pack` (1 to 16): a mouth may also act on a body of up to pack cells
 * per mouth of its own body in touch with it (in sight and fear: per mouth its body holds); a pair that could act both ways does neither, a
 * standoff. `crowd` (1 to 4 tiles): a seeing mouth counts each mouth of another body within 1.25 D of a candidate as that many tiles farther.
 * `leafPool`: that share of all upkeep paid goes to a pool (up to `leafPoolMax`, default patchFood) that only leaves are paid from. `patchSeason`:
 * a scheduled patch holds patchFood times the year's light. `winterCost`: each cell pays that much more a step in proportion to how far the
 * year's light is below midsummer's. The census adds `steering` and `leafPool`; the residual counts the pool.
 *
 * Chunk 4 (speeds that differ; both keys optional and absent from every start before it). `pace` (share 0 to 1): a fed body slows down. With
 * s the body's mean store (the floor of its cells' total over its size) as the step starts, fullness q = (s - minStore) / (2 birthStore - minStore)
 * in 256ths, held to 0..256, and the body thrusts at 256 - (256 - pace) q / 256 (in 256ths, floored): full speed at minStore, `pace` of it when
 * ready to divide. With `steer`, a body that has an aim is never slowed. `shellThrust` (share 0 to 1): a shell cell thrusts at this share. Both
 * scale the thrust before it is paid for, so a slower cell pays less; sealed cells are untouched.
 * Depth (2026-11-26; every key optional and absent from every start before it, so those worlds run the old path with no new draw). `depth`
 * (2 to 4) gives the top-down world that many levels, 0 the floor and depth - 1 the surface. A body is on one level (kept in every cell, as
 * the heading is). Cells of different bodies push, block, touch, grip and crowd each other only on the same level, and a birth spot is
 * blocked only by cells of the mother's level; sight and fear see through every level. Ground food and compost are on the floor: only
 * level 0 cells eat from the ground, and a dead cell's store falls to the tile under it. Light comes from above: a leaf's light is the
 * tile's light less `depthDim` of it for each level under the surface, then less `depthShade` of what is left for each cell (of any kind,
 * at most 8) whose centre is on its tile on a higher level; leaves share a tile's light only with leaves of their own level. Each cell
 * carries a heritable `lift` (0 to 255, copied with the gene chance and a step of 32); a body's home level is floor(mean lift * depth / 256), from the exact mean.
 * In the commands stage each unsealed body picks the level it wants (with `steer`: the level of the prey it aims at; when fleeing, off the
 * threat's level, toward home if home is elsewhere, else up, else down, and staying put while the threat is on another level; otherwise
 * by hunger: the floor while its cells hold on average less than `depthDive` birth stores, where it is while they hold less than twice
 * that (a cell divides at two birth stores, so a body rises only once it has stopped growing and filled up), else home) and moves one level toward it, at most once in `depthGap` steps, every cell paying `depthCost` (or what it has) to the reservoir.
 * (With `pace`, that cost is paid before the body's store is read for its pace.)
 * The census adds `levels` (cells per level) and `levelMoves`.
 * Inner pulse (2026-11-26; every key optional and absent from every start before it). With `pulse` each cell carries two signals A and B
 * (-127 to 127, both 0 at a founder; a daughter starts with her mother's) and a heritable network of 4 rows of 10 weights (-127 to 127). In
 * the commands stage, after the levels and before the pace, every cell reads ten inputs as the step starts: 127; its own A and B; its
 * mother's A and B (0 without one); the truncated means of its daughters' A and B (0 without any); how full it is ((store - minStore) * 254 /
 * (2 birthStore - minStore) - 127, held to -127..127); the stretch of the bond to its mother ((length - L) * 254 / L, held to -127..127, 0 without
 * one); and its body's aim (with `steer`: 127 hunting, -127 fleeing, else 0). Each row gives trunc(sum of weight * input / 64) held to -127..127:
 * row 0 is the cell's next A, row 1 its next B, row 2 its go, row 3 its flex. All cells read the signals of the step before and the new ones
 * are written together, so a signal crosses one bond a step and no order matters. There is no clock and no gene for a rhythm: a beat is
 * whatever the weights and the bonds make. Go scales the cell's thrust, at the point `pace` and `shellThrust` do and after them, to
 * 256 - floor(pulseThrust * (127 - go) / 254) 256ths (`pulseThrust` in 256ths, default a half): never more than the thrust it had, and a
 * slower cell pays less. Flex changes the rest length of the cell's springs for this step's mechanics: a bond or a brace between a and b
 * rests at rest + trunc(rest * pulseFlex * (flex a + flex b) / (254 * 256)) (`pulseFlex` in 256ths, 0 to a half, default a quarter).
 * Springs act equally on both ends, so flex alone bends and squeezes a body and gives it no push of its own (rounding and the speed clamp, which act on each cell, can leave a small drift); it costs nothing. A daughter
 * copies her mother's weights and, with chance `pulseMut` (default 0.1), one of them moves by 16. A founder made with `found` starts with the
 * still network (every weight 0 but the one from the 127 to go, at 64: full thrust, no flex, no signal), under which the world moves exactly as without `pulse`;
 * `setPulse` gives a one-cell founder another. The census adds `pulsing` (live cells whose A or B moved by 8 or more in the last stage) and `pulseGo`.
 *
 * Where Soft Roam differs from Roam, on purpose (recorded here because the contract's "carried over" is looser):
 * - The scent field has Roam's reach but not its numbers. Roam relaxes 4 passes a step with 1/2048 lost per pass and adds 64 per unit of food
 *   (cap 4095), so the field reaches about 16 tiles from a patch (the reach is sqrt(2^shift / 8) tiles: it follows the decay, not the passes, which
 *   only set how fast the field catches up). Soft Roam uses the same 4 passes and shift 11 and adds 8 per unit of food (cap 1023), so the ratios
 *   the slope reads are Roam's to within a few percent (a calibration against a Roam world with a lone patch gives -0.49, -1.04, -0.84, -0.69, -0.58, -0.47
 *   of the read at 2, 4, 8, 12, 16, 20 tiles; Soft Roam -0.50, -1.05, -0.85, -0.70, -0.59, -0.48), and the field as shown is held at 2^20 - 1. The slope
 *   is read from the fine field behind it (8 times finer, under 2^23, Roam's own scale), so a weak far gradient survives as it does in Roam; its
 *   interpolation and slope sums pass 2^31 (tile value x 1024, then (east - west) x gain x 1024 only where below east + west + 1) and are plain
 *   numbers, exact far below 2^53, cut with Math.floor and Math.trunc: the one place the 31-bit rule is not kept. A tile with more than about 64 food a tile over a wide area saturates the field; the slope is
 *   then flat there. Below 2^shift a tile does not lose to decay (floor), as in Roam, only to the averaging.
 * - There is no blocked-turn rule. Roam gives a body that cannot step a new random heading; here thrust into another
 *   body is projected away (the body slides, or stalls when boxed in) and only the hashed turn event changes a heading.
 * - The census has no newbornDeaths or cellMoves/blocked (they need a per-cell "has divided" flag or tiles); it has
 *   shellTough, travel and the alarms.
 * - isqrt starts from the double sqrt and corrects it with integer tests, so it is exact for every n below 2^31; a WGSL
 *   port should use an integer method instead.
 * - `events.feeds` and `events.hits` list what touch actually did this step (cells by slot and serial), so the picture never has to
 *   rebuild pairs from timestamps (lastHitStep and lastDrainStep use 0 for a first-step event and for never).
 * - The events carry different units: deaths in units (and where the cell began the step), cracks in units, patches in tiles,
 *   births as slots (see SoftDeathEvent).
 * - bornStep is 0 for a founder and, for a daughter, the world step at which she first exists (the step after the one that
 *   made her), so a daughter of the very first step is not taken for a founder.
 */

import { G_CHASE, G_DRIVE, G_TURN, KIND_MOUTH, KIND_PLAIN, KIND_SHELL, PLAN_MODES, PLAN_REST, planEntry, roamHash, ROAM_GENE_MAX, ROAM_GENES } from '../roam/kernel.ts';

export { KIND_MOUTH, KIND_PLAIN, KIND_SHELL, PLAN_MODES, PLAN_REST, planEntry, roamHash, ROAM_GENES, ROAM_GENE_MAX };

/** Units per tile; also a cell's diameter D and the rest length L of a bond. */
export const SOFT_U = 1024;
/** One in the Q14 unit vectors of the sine table. */
export const SOFT_ONE = 16384;
const D = SOFT_U;
const L = SOFT_U;

// Quarter wave of sin(2 pi k / 1024) in Q14 for k = 0..256, as literal integers.
const SIN_QUARTER = Int16Array.from([
  0,101,201,302,402,503,603,704,804,904,1005,1105,1205,1306,1406,1506,1606,1706,1806,1906,2006,2105,2205,2305,2404,2503,2603,2702,2801,2900,2999,3098,3196,3295,3393,3492,3590,3688,3786,3883,3981,4078,4176,4273,4370,4467,4563,4660,4756,4852,4948,5044,5139,5235,5330,5425,5520,5614,5708,5803,5897,5990,6084,6177,6270,6363,6455,6547,6639,6731,6823,6914,7005,7096,7186,7276,7366,7456,7545,7635,7723,7812,7900,7988,8076,8163,8250,8337,8423,8509,8595,8680,8765,8850,8935,9019,9102,9186,9269,9352,9434,9516,9598,9679,9760,9841,9921,10001,10080,10159,10238,10316,10394,10471,10549,10625,10702,10778,10853,10928,11003,11077,11151,11224,11297,11370,11442,11514,11585,11656,11727,11797,11866,11935,12004,12072,12140,12207,12274,12340,12406,12472,12537,12601,12665,12729,12792,12854,12916,12978,13039,13100,13160,13219,13279,13337,13395,13453,13510,13567,13623,13678,13733,13788,13842,13896,13949,14001,14053,14104,14155,14206,14256,14305,14354,14402,14449,14497,14543,14589,14635,14680,14724,14768,14811,14854,14896,14937,14978,15019,15059,15098,15137,15175,15213,15250,15286,15322,15357,15392,15426,15460,15493,15525,15557,15588,15619,15649,15679,15707,15736,15763,15791,15817,15843,15868,15893,15917,15941,15964,15986,16008,16029,16049,16069,16088,16107,16125,16143,16160,16176,16192,16207,16221,16235,16248,16261,16273,16284,16295,16305,16315,16324,16332,16340,16347,16353,16359,16364,16369,16373,16376,16379,16381,16383,16384,16384,
]);

/** Sine of a heading (1024 steps per turn) in Q14. Heading 256 is a quarter turn, toward +y (south). */
export function softRoamSin(h: number): number {
  const k = h & 1023;
  const q = k >>> 8;
  const r = k & 255;
  return q === 0 ? SIN_QUARTER[r] : q === 1 ? SIN_QUARTER[256 - r] : q === 2 ? 0 - SIN_QUARTER[r] : 0 - SIN_QUARTER[256 - r];
}
/** Cosine of a heading in Q14. Heading 0 points toward +x (east). */
export function softRoamCos(h: number): number {
  return softRoamSin((h & 1023) + 256);
}
/** The heading (0..1023) nearest the direction of the vector (x, y); 0 for the zero vector. */
export function softRoamAngle(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  // Keep every product below 2^31.
  while (Math.abs(x) > 16383 || Math.abs(y) > 16383) { x = Math.trunc(x / 2); y = Math.trunc(y / 2); }
  if (x === 0 && y === 0) return 0;
  let q = 0;
  while (!(x > 0 && y >= 0)) {
    const t = y;
    y = -x;
    x = t;
    q++;
  }
  // The smallest k in 0..256 with sin(k) x >= cos(k) y: the heading at or just past the vector. The nearest heading is it or the one before,
  // told apart by which side of their bisector (the sum of their unit vectors) the vector lies on.
  let lo = 0;
  let hi = 256;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (SIN_QUARTER[mid] * x >= SIN_QUARTER[256 - mid] * y) hi = mid;
    else lo = mid + 1;
  }
  let k = lo;
  if (lo > 0) {
    const bx = SIN_QUARTER[256 - lo] + SIN_QUARTER[257 - lo];
    const by = SIN_QUARTER[lo] + SIN_QUARTER[lo - 1];
    if (bx * y - by * x < 0) k = lo - 1;
  }
  return (q * 256 + k) & 1023;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface SoftRoamConfig {
  /** Side of the square torus, in tiles (8 to 256). */
  size: number;
  seed: number;
  /** Total matter in the world, under 2^20. */
  matter: number;
  /** Most cells alive at once (at most 16384). A daughter waits when there is no free slot. */
  maxCells: number;
  /** Matter in one patch of food, the radius of a patch in tiles, the fewest steps between patches, and patches at step 0. */
  patchFood: number;
  patchRadius: number;
  patchEvery: number;
  startPatches: number;
  /** Most a cell asks for from the tile under its centre in one step (it never holds more than four births' worth). */
  bite: number;
  /** A cell holding twice this divides; each half starts with about this much (at most 256). */
  birthStore: number;
  /** A cell holding less than this dies. */
  minStore: number;
  /** Matter lost per step through each side of a cell that has no body neighbour there, and per cell whatever its place. */
  leakSide: number;
  leakCell: number;
  /** Matter a cell pays per step at full thrust (less for less). */
  moveCost: number;
  /** Top chance per step that a body picks a new turn to make. */
  turnMax: number;
  /** Chance per gene that a daughter's copy differs, and the size of one change. */
  mut: number;
  mutStep: number;
  /** Chance that a released daughter's plan differs from her mother's in one place; a kept daughter's is an eighth of it. */
  planMut: number;
  /** Share of the difference between two bonded cells' stores that moves from the fuller to the emptier each step (at most 1/8). */
  flow: number;
  /** Each cell dies by wear with chance 1/life per step. Absent means cells do not wear out. */
  life?: number;
  /** A dead cell's store stays on its tile as food (true) instead of going back to the reservoir. */
  compost?: boolean;
  /** Share (0 to 1) of a tile's food that is shared out evenly to its four neighbours each step. Absent means food stays put. */
  foodSpread?: number;
  /** Scent: passes per step (0 to 16), the share lost per pass as a power of two (1 to 12; the reach is about sqrt(2^shift / 8) tiles), and how strongly a slope is read (1 to 16). */
  scentIters: number;
  scentDecayShift: number;
  scentGain: number;
  /** Mechanics substeps per step. */
  substeps: number;
  /** Share of its velocity a cell keeps each substep, out of 256. 0 is the overdamped limit. */
  keep: number;
  /** Spring stiffness out of 256 of a bond, of a brace, and of the push between cells that overlap. */
  kBond: number;
  kBrace: number;
  kRep: number;
  /** Fastest a cell can go, in sixteenths of a unit per substep (1024 is a quarter tile per step at 4 substeps). */
  vMax: number;
  /** Force of full thrust, in sixteenths of a unit per substep each substep (its steady speed is this / (1 - keep / 256)). */
  thrustMax: number;
  /** Cells come in kinds, set by the plan entry that made them: only plain cells and one-cell bodies eat from the ground, and only a mouth takes from another body by touch. */
  kinds?: boolean;
  /** Shells have toughness levels in their plan entries: a level multiplies the hits to crack by 2^level and the side upkeep by (1 + level). */
  toughness?: boolean;
  /** Matter a body at least twice the size takes through each touch from a smaller one's cell per step (at most the prey cell's store shared by its touches). Setting drain also turns on the seal (below). */
  drain?: number;
  /** With drain: steps a new body is sealed (it neither takes nor loses by touch, and thrusts at full along its release direction). 100 when absent. */
  seal?: number;
  /** A shell cracks (becomes plain) after this many hits (times 2^toughness level). Needs kinds and drain. */
  crack?: number;
  /** The share (0 to 1) of the usual bite a shell that eats (a one-cell body) takes, rounded by a hash so the share holds on average (default all), and the share of the side upkeep a shell pays, before toughness (default a quarter). Need kinds. */
  shellBite?: number;
  shellLeak?: number;
  /** How hard a mouth in touch with prey it could act on is pulled toward contact distance D, out of 256. Absent or 0 is off. Needs kinds and drain. */
  grip?: number;
  /** Cells of one founder family (`fam`, never 0) do not feed on, hit, grip, sense or fear each other. */
  truce?: boolean;
  /** No cell of a body that holds a mouth can be fed on, hit, gripped or sensed as prey. */
  jaws?: boolean;
  /** Tiles (whole, 1 to 8): a mouth with a chase gene steers toward the nearest cell it could act on within this range. Needs kinds and drain. */
  sight?: number;
  /** Tiles (whole, 1 to 8): a plain or shell cell with a chase gene steers away from the nearest mouth that could act on it within this range. Needs kinds and drain. */
  fear?: number;
  /** A body releases a new body only when it had at least this many cells as the division stage began (at least 1). */
  releaseMin?: number;
  /** A body releases at most once in this many steps (a whole number, at least 1). */
  releaseGap?: number;
  /** Steps in a day (16 to 2^20): a lit band half the world wide sweeps once round the torus a day. Enables the light. */
  day?: number;
  /** Steps in a year (`day` to 2^24): the whole world brightens and dims once a year. Needs `day`. */
  year?: number;
  /** Light in deepest winter as a share of midsummer, 0 to 1 (default 0.25 when `year` is set). Needs `year`. */
  winter?: number;
  /** Scheduled patches land only in proportion to the light at their centre (start patches are not gated). Needs `day`. */
  patchSun?: boolean;
  /** Matter a step a fully bare leaf earns in full light (0 to 4); adds the leaf kind to plans. Needs kinds and `day`. */
  leaf?: number;
  /** Chunk 3. Braces hold a body together as mother links do, so a cell that dies inside a body leaves a hole its mother can fill instead of splitting the body. */
  heal?: boolean;
  /** One aim per body: a body with a seeing mouth or a fleeing cell turns toward the prey (or away from the threat) and all its cells with a chase gene steer by it. Needs sight or fear. */
  steer?: boolean;
  /** Whole, 1 to 16: a mouth may also act on a body of up to `pack` cells for each mouth of its own body in touch with it (in sight: each mouth its body holds). Needs kinds and drain. */
  pack?: number;
  /** Whole, 1 to 4 tiles: a seeing mouth counts each mouth of another body next to a candidate as this many tiles farther off. Needs sight. */
  crowd?: number;
  /** Share (0 to 1) of what cells pay in upkeep that goes to a pool only leaves draw on (instead of the reservoir). Needs leaf. */
  leafPool?: number;
  /** Most the leaf pool holds (whole, 1 to 2^20; default patchFood); the rest of the share goes to the reservoir. Needs leafPool. */
  leafPoolMax?: number;
  /** Scheduled patches hold patchFood times the season's light (at least 1). Needs year. */
  patchSeason?: boolean;
  /** Matter a step (0 to 1) each cell pays in deepest darkness of the year, in proportion to how far the season's light is below midsummer's. Needs year. */
  winterCost?: number;
  /** Chunk 4. Share (0 to 1) of its thrust a body keeps when its cells' mean store is ready to divide (full thrust at minStore, in proportion between; with steer, a body with an aim keeps all of it). */
  pace?: number;
  /** Chunk 4. Share (0 to 1) of the usual thrust a shell cell gives: armour is heavy. Needs kinds. */
  shellThrust?: number;
  /** Depth. Whole, 2 to 4: the levels of the world, 0 the floor (ground food) and depth - 1 the surface (full light). Bodies meet only on the same level. */
  depth?: number;
  /** Whole, 1 to 2^20 (default 40): a body changes level at most once in this many steps. Needs depth. */
  depthGap?: number;
  /** Whole, 0 to 64 (default 1): matter each cell of a body pays to the reservoir when the body changes level. Needs depth. */
  depthCost?: number;
  /** In birth stores (0 to 4, default 1; 0 is never): a body whose cells hold less than this on average goes to the floor to feed, and stays where it is until they hold twice it. Needs depth. */
  depthDive?: number;
  /** Share (0 to 1, default 0.25) of a tile's light lost for each level under the surface. Needs depth. */
  depthDim?: number;
  /** Share (0 to 1, default 0.25) of the light left that each cell above on the same tile takes. Needs depth. */
  depthShade?: number;
  /** Inner pulse: each cell runs a small heritable network on local cues and two signals passed along its bonds; its outputs scale the cell's thrust and the rest length of its springs (see the header). */
  pulse?: true;
  /** Share (0 to 1, default 0.5): how much of its thrust a cell loses when its go output is at its lowest. Needs pulse. */
  pulseThrust?: number;
  /** Share (0 to 0.5, default 0.25): how far a spring's rest length moves when both its ends flex fully. Needs pulse. */
  pulseFlex?: number;
  /** Chance (0 to 1, default 0.1) that one weight of a daughter's network moves by 16. Needs pulse. */
  pulseMut?: number;
}

export function defaultSoftRoamConfig(): SoftRoamConfig {
  return {
    size: 128,
    seed: 1,
    matter: 160_000,
    maxCells: 16384,
    patchFood: 4000,
    patchRadius: 4,
    patchEvery: 20,
    startPatches: 8,
    bite: 2,
    birthStore: 100,
    minStore: 16,
    leakSide: 1 / 64,
    leakCell: 1 / 256,
    moveCost: 1 / 32,
    turnMax: 1 / 64,
    mut: 0.02,
    mutStep: 64,
    planMut: 0.05,
    flow: 1 / 64,
    life: 2000,
    compost: true,
    scentIters: 4,
    scentDecayShift: 11,
    scentGain: 8,
    substeps: 4,
    keep: 192,
    kBond: 96,
    kBrace: 64,
    kRep: 256,
    vMax: 1024,
    thrustMax: 240,
  };
}

const CH_PATCH = 1;
const CH_COST = 2;
const CH_TURN = 3;
const CH_TURNAMT = 4;
const CH_HEAD = 5;
const CH_ORDER = 6;
const CH_UPKEEP = 7;
const CH_WEAR = 8;
const CH_BRACE = 9;
const CH_MUT = 16; // + gene index
const CH_PLAN = 30;
const CH_PLAN_NEW = 31;
const CH_PLAN_FIELD = 32;
const CH_FOUND = 40;
const CH_BITE = 42;
const CH_TOUCH = 50;
const CH_TOUCH_TIE = 51;
const CH_TOUCH_TIE3 = 52;
const CH_SIGHT_A = 60;
const CH_SIGHT_B = 61;
const CH_FEAR_A = 62;
const CH_FEAR_B = 63;
const CH_LEAF = 64;
const CH_PATCH_SUN = 65;
const CH_LIFT = 66;
const CH_PULSE = 67;
/** Most cells above a leaf that shade it. */
const SHADE_MAX = 8;
/** Inner pulse: inputs and outputs of a cell's network, and the weight that is a gain of one. */
export const PULSE_IN = 10;
export const PULSE_OUT = 4;
export const PULSE_W = PULSE_IN * PULSE_OUT;
export const PULSE_ONE = 64;
const PULSE_STEP = 16;
/** The still network: full thrust, no flex, no signal. */
export function softPulseStill(): number[] {
  const w = new Array<number>(PULSE_W).fill(0);
  w[2 * PULSE_IN] = PULSE_ONE;
  return w;
}
const CH_PAIR = 100; // + substep
/** Velocity is only taken off contacts at least this near-touching (squared distance of three quarters of D); deeper overlaps may decompress freely. */
const SHALLOW2 = (3 * D / 4) * (3 * D / 4);

const SCENT_FOOD_CAP = 1023;
/** Scent added per pass for each unit of food on a tile (food capped at SCENT_FOOD_CAP): Roam's 64, relaxed with Roam's own arithmetic; what is read is this field over 8, so it fits 20 bits. */
const SCENT_SCALE = 64;
/** The field as shown (`scent`) never goes above this, 20 bits (see `scentAt` for the arithmetic on the fine field). */
const SCENT_MAX = (1 << 20) - 1;
/** The relaxed field is held 8 times finer and cut here, so that what is read (over 8) never passes SCENT_MAX. */
const SCENT_HI_MAX = ((SCENT_MAX + 1) << 3) - 1;
const SENSE = 717;
/** Touch and grip reach: cells of different bodies within 1.25 D. */
const TOUCH_R = D + (D >>> 2);
const TOUCH_R2 = TOUCH_R * TOUCH_R;
/** Contacts one cell keeps for touch and grip. */
const TOUCH_CAP = 4;
const SPEED_RUN = 50;

function q16(x: number, name: string, max = 65536): number {
  const v = Math.round(x * 65536);
  if (!Number.isFinite(x) || v < 0 || v > max) throw new Error(`Invalid ${name}: ${x}`);
  return v;
}

function whole(x: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(x) || x < min || x > max) throw new Error(`Invalid ${name}: ${x}`);
  return x;
}

/** The kind of a leaf cell: it earns from the light through its bare sides (needs `leaf` in the config). */
export const KIND_LEAF = 3;
const LEAF_Q = 65536;
const LEAF_MAX_SHARE = 16;

/** Ten-bit phase of `t` in a period: floor((t % period) * 1024 / period), by ten doublings so nothing exceeds 2 * period. */
function phase10(t: number, period: number): number {
  let r = t % period;
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    r *= 2;
    bits <<= 1;
    if (r >= period) { bits |= 1; r -= period; }
  }
  return bits;
}

const tri10 = (p: number): number => (p < 512 ? p >> 1 : (1024 - p) >> 1);

/**
 * The light on tile column `tx` at `step`: an integer 0 to 256 (256 without `day`). A lit band half the world wide sweeps once round the torus a
 * day; the whole world brightens and dims once a year, down to `winter` (default 0.25) of midsummer. Pure; `ty` does not matter (the sun is at
 * the same hour all the way up a column) and is taken so callers pass a tile.
 */
export function softRoamLight(cfg: Pick<SoftRoamConfig, 'size' | 'day' | 'year' | 'winter'>, tx: number, _ty: number, step: number): number {
  if (cfg.day === undefined) return 256;
  const dp = (Math.floor((tx * 1024) / cfg.size) - phase10(step, cfg.day)) & 1023;
  const t2 = 2 * tri10(dp) - 256;
  const dayL = t2 < 0 ? 0 : t2 > 256 ? 256 : t2;
  let seasonL = 256;
  if (cfg.year !== undefined) {
    const w = Math.round((cfg.winter ?? 0.25) * 256);
    seasonL = w + (((256 - w) * tri10(phase10(step, cfg.year))) >> 8);
  }
  return (dayL * seasonL) >> 8;
}

function isqrt(n: number): number {
  let s = Math.floor(Math.sqrt(n));
  while (s * s > n) s--;
  while ((s + 1) * (s + 1) <= n) s++;
  return s;
}

export interface SoftRoamCensus {
  step: number;
  bodies: number;
  cells: number;
  largest: number;
  singles: number;
  food: number;
  held: number;
  reservoir: number;
  /** Starting total minus food, held and reservoir: 0 when matter is conserved. */
  residual: number;
  genes: number[];
  divisions: number;
  releases: number;
  cellDeaths: number;
  bodyDeaths: number;
  worn: number;
  composted: number;
  splits: number;
  shells: number;
  mouths: number;
  cracked: number;
  drained: number;
  flowed: number;
  patches: number;
  /** Units moved, summed over cells and steps (length of each cell's displacement over a step). */
  travel: number;
  /** Mean toughness of the shells alive now (0 with no shell). */
  shellTough: number;
  /** Alarms that must stay 0: bonds longer than 2 L now; pairs of different bodies overlapping by more than D/4 for 50 steps running; cells at the speed clamp for 50 steps running. */
  alarmBonds: number;
  alarmOverlap: number;
  alarmSpeed: number;
  /** Chunk 2, per step (as of the last commands stage): mouths steering toward a target, distinct cells they steer toward, plain or shell cells steering away. */
  hunting: number;
  targets: number;
  fleeing: number;
  /** Cumulative: ready cells whose release `releaseMin` or `releaseGap` held back when it would otherwise have been placed. */
  releasesHeld: number;
  /** Chunk 2: live leaf cells, and the matter leaves have earned in all. */
  leaves: number;
  leafIncome: number;
  /** Chunk 3: bodies steering by one aim (as of the last commands stage); matter in the leaves' pool. */
  steering: number;
  leafPool: number;
  /** Depth: live cells on each level (floor first; empty without depth), and level changes by bodies in all. */
  levels: number[];
  levelMoves: number;
  /** Inner pulse: live cells whose A or B moved by 8 or more in the last commands stage, and the mean thrust share the go outputs gave (256ths; 256 without pulse). */
  pulsing: number;
  pulseGo: number;
}

/**
 * What a step did, for the picture; read-only, cleared at the start of the next step. Units differ by event, on purpose:
 * `deaths` give the cell's place in UNITS (0 to size * 1024), both where it died (x, y) and where it began the step
 * (fromX, fromY); `patches` give the patch centre in TILES (0 to size - 1); `births` list SLOTS; `cracks` give the shell's place in UNITS.
 */
export interface SoftDeathEvent { x: number; y: number; fromX: number; fromY: number; kind: number; store: number; /** The level it was on (0 without depth). */ lv: number }
/** A place: a patch's centre tile in tiles, a crack's shell in units. */
export interface SoftPointEvent { x: number; y: number; /** With depth, for a crack: the level it happened on. */ lv?: number }
/** A touch feeding that moved matter: the taker and the cell it took from, as slots (valid until the next step; check `cid`) and serial numbers. */
export interface SoftFeedEvent { ms: number; ps: number; mc: number; pc: number }
/** A shell that took at least one hit: its slot and serial number. */
export interface SoftHitEvent { s: number; c: number }

// Lattice offsets (dx, dy, rest length) a new cell may be braced to.
const BRACE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1024], [-1, 0, 1024], [0, 1, 1024], [0, -1, 1024],
  [1, 1, 1448], [1, -1, 1448], [-1, 1, 1448], [-1, -1, 1448],
  [2, 0, 2048], [-2, 0, 2048], [0, 2, 2048], [0, -2, 2048],
];

export class SoftRoamWorld {
  readonly cfg: Readonly<SoftRoamConfig>;
  readonly size: number;
  readonly cap: number;
  /** Tiles, and the side of the torus in units. */
  readonly n: number;
  readonly span: number;
  readonly total: number;
  step = 0;
  reservoir = 0;
  nextCid = 1;

  // Per slot.
  readonly alive: Uint8Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly prevX: Int32Array;
  readonly prevY: Int32Array;
  readonly vx: Int32Array;
  readonly vy: Int32Array;
  readonly carryX: Int8Array;
  readonly carryY: Int8Array;
  readonly store: Uint32Array;
  readonly genes: Int16Array;
  readonly pid: Uint32Array;
  readonly mode: Uint8Array;
  /** The mode of the mother when she made the cell. */
  readonly made: Uint8Array;
  readonly orient: Uint8Array;
  readonly gx: Int16Array;
  readonly gy: Int16Array;
  readonly kind: Uint8Array;
  readonly tough: Uint8Array;
  readonly hits: Uint16Array;
  readonly fam: Uint16Array;
  readonly cid: Uint32Array;
  readonly since: Uint32Array;
  /** 0 for a founder; for a daughter the world step from which she exists (the step after her birth step). */
  readonly bornStep: Uint32Array;
  readonly lastHitStep: Uint32Array;
  readonly lastDrainStep: Uint32Array;
  readonly heading: Uint16Array;
  readonly turnLeft: Int16Array;
  /** The cell that made this one and kept it, or -1. */
  readonly mother: Int32Array;
  readonly braceTo: Int32Array;
  readonly braceRest: Int16Array;
  /** Body label, rebuilt every step. */
  readonly body: Int32Array;
  /** With `releaseGap`: one more than the step of the last release the cell's body made as the cell last heard of it (0 = never). */
  readonly relRec: Float64Array;
  /** With `leafPool`: matter that only leaves draw on. */
  leafPool = 0;

  // Per tile.
  readonly food: Uint32Array;
  /** What the chasers sense: the relaxed field below, in units of 1/8. */
  scent: Uint32Array;
  /** The field itself, at Roam's scale (food adds 64 a pass), so a weak tail is not rounded away; `scent` is this over 8. */
  private scentHi: Uint32Array;
  private scentHiNext: Uint32Array;

  readonly plans: Uint16Array[] = [new Uint16Array(PLAN_MODES)];
  readonly planParent: number[] = [0];

  /** Bodies now, and the cells in each label (labels run from 1). */
  bodyCount = 0;
  readonly bodySize: Int32Array;
  private labelHi = 0;

  /** What happened in the last step, for the picture. Not part of the dynamics. */
  readonly events = {
    deaths: [] as SoftDeathEvent[],
    births: [] as number[],
    cracks: [] as SoftPointEvent[],
    patches: [] as SoftPointEvent[],
    /** Every touch that moved matter this step (taker, prey), and every shell that was hit: exactly what the rules did, for the picture. */
    feeds: [] as SoftFeedEvent[],
    hits: [] as SoftHitEvent[],
  };

  // Counters since step 0.
  divisions = 0;
  releases = 0;
  cellDeaths = 0;
  bodyDeaths = 0;
  worn = 0;
  composted = 0;
  splits = 0;
  cracked = 0;
  drained = 0;
  flowed = 0;
  patches = 0;
  travel = 0;
  releasesHeld = 0;
  /** Cumulative matter earned by leaves, and scheduled patches the dark turned away (exact host integers). */
  leafIncome = 0;
  patchesSkipped = 0;
  /** Per step, set by the commands stage. */
  hunting = 0;
  targets = 0;
  fleeing = 0;

  /** Test only: scan buckets in reverse order. Nothing may change. */
  _reverseScan = false;

  private readonly biteN: number;
  private readonly leakSideQ16: number;
  private readonly leakCellQ16: number;
  private readonly moveCostQ16: number;
  private readonly turnMaxQ16: number;
  private readonly mutQ16: number;
  private readonly planMutQ16: number;
  private readonly flowQ10: number;
  private readonly wearQ32: number;
  private readonly spreadQ10: number;
  private readonly compost: boolean;
  private readonly kinds: boolean;
  private readonly toughOn: boolean;
  private readonly drainN: number;
  private readonly sealN: number;
  private readonly crackN: number;
  private readonly gripN: number;
  private readonly truceOn: boolean;
  private readonly jawsOn: boolean;
  private readonly sightN: number;
  private readonly fearN: number;
  private readonly relMinN: number;
  private readonly relGapN: number;
  private readonly leafOn: boolean;
  private readonly healOn: boolean;
  private readonly steerOn: boolean;
  private readonly packN: number;
  private readonly crowdN: number;
  private readonly leafPoolQ8: number;
  private readonly leafPoolMaxN: number;
  private readonly seasonPatch: boolean;
  private readonly winterQ16: number;
  /** Chunk 4: thrust shares in 256ths, -1 when the key is absent. */
  private readonly paceQ8: number;
  private readonly shellThrustQ8: number;
  /** With pace: the total store of each body as the step starts, then its thrust share in 256ths (scratch, by label). */
  private readonly bodyPace: Float64Array;
  /** Depth: the number of levels (0 when off), and the rule's numbers. */
  private readonly depthN: number;
  private readonly depthGapN: number;
  private readonly depthCostN: number;
  private readonly depthDimQ8: number;
  /** A body dives when its mean store is under this, and holds its level under twice it. */
  private readonly depthDiveN: number;
  private readonly depthShadeQ8: number;
  /** Per slot: the level of the cell's body, its heritable lift, and the step its body last changed level plus one (0 never). Empty without depth. */
  readonly level: Uint8Array;
  readonly lift: Uint8Array;
  private readonly lvlStep: Uint32Array;
  private readonly bodyLevel: Uint8Array;
  private readonly bodyLvMoved: Uint8Array;
  private readonly bodyLiftSum: Int32Array;
  private readonly bodyLvStep: Uint32Array;
  private readonly bodyStoreSum: Int32Array;
  /** Cells whose centres are on a tile, by level (tile * depth + level); scratch of the leaf stage. */
  private readonly lvlCount: Uint16Array;
  private levelMoves = 0;
  /** Inner pulse: on or off, the two shares in 256ths and the chance in 65536ths. */
  private readonly pulseOn: boolean;
  private readonly pulseThrustQ8: number;
  private readonly pulseFlexQ8: number;
  private readonly pulseMutQ16: number;
  /** Per slot: the network (PULSE_W weights), the two signals, and the last stage's go and flex outputs. Empty without pulse. */
  readonly pulseW: Int8Array;
  readonly sigA: Int8Array;
  readonly sigB: Int8Array;
  readonly pulseGo: Int8Array;
  readonly pulseFlex: Int8Array;
  private readonly sigNextA: Int8Array;
  private readonly sigNextB: Int8Array;
  private readonly kidA: Int32Array;
  private readonly kidB: Int32Array;
  private readonly kidN: Int32Array;
  /** Per slot: 1 when the cell's A or B moved by 8 or more in the last stage. */
  private readonly pulseMoved: Uint8Array;
  private readonly pulseIn = new Int32Array(PULSE_IN);
  private steering = 0;
  private readonly leafQ: number;
  private readonly sunPatch: boolean;
  /** Leaf cells whose centres share a tile (scratch, zero between steps), and the stage's lists. */
  private readonly leafOnTile: Uint16Array;
  /** Per slot, what the leaf stage paid it this step (for the picture; not dynamics, not in the digest). Empty without leaves. */
  readonly leafPaid: Uint8Array;
  private readonly leafCells: number[] = [];
  private readonly leafAsks: number[] = [];
  private readonly shellBiteQ16: number;
  /** Side upkeep (Q16) of a shell by toughness level, from shellLeak: precomputed once, host side. */
  private readonly shellSideQ16 = new Int32Array(4);
  private readonly patchTiles: Int32Array;

  private readonly freeList: Int32Array;
  private freeN: number;
  private readonly live: Int32Array;
  private liveN = 0;
  // Mechanics scratch.
  private readonly fx: Int32Array;
  private readonly fy: Int32Array;
  private readonly tx: Int32Array;
  private readonly hx: Int32Array;
  private readonly hy: Int32Array;
  private readonly ty: Int32Array;
  private readonly head: Int32Array;
  private readonly nextInTile: Int32Array;
  private readonly clampRun: Uint16Array;
  /** Overlap run lengths of pairs of cells of different bodies, keyed by the pair's slots and checked against their cids. */
  private pairRun = new Map<number, { ca: number; cb: number; run: number }>();
  // Body scratch.
  private readonly uf: Int32Array;
  private readonly rootLabel: Int32Array;
  private readonly bodyRoot: Int32Array;
  private readonly bodyHead: Int32Array;
  private readonly bodyTurn: Int32Array;
  private readonly bodyTurnSum: Int32Array;
  private readonly bodyTmp: Int32Array;
  private readonly prevBody: Int32Array;
  // Life scratch.
  private readonly askTile: Uint32Array;
  private readonly askCell: Uint32Array;
  private readonly gotCell: Uint32Array;
  /** Picture only: the matter cell c took from the ground in the last step (0 for a slot reused since). Never read by the rules. */
  ateFromGround(c: number): number {
    return this.gotCell[c];
  }
  private readonly flowSnap: Uint32Array;
  private readonly foodSnap: Uint32Array;
  private readonly dying: Uint8Array;
  private readonly backMode: Uint8Array;
  private readonly firstDaughter: Int32Array;
  private readonly offsetMap = new Map<number, number>();
  private readonly tiles9 = new Int32Array(9);
  /**
   * Contacts between bodies this substep, kept without limit in a pool of linked lists, one list per body label: squared distance,
   * the two cids, the unit normal pointing out of the body (Q14). Which contacts a body keeps never depends on a cap or an order.
   */
  private readonly contN: Int32Array;
  private readonly contHead: Int32Array;
  private contNext: Int32Array;
  private contPool = 0;
  /** 1 for a body in which some cell is thrusting this step. */
  private readonly bodyPush: Uint8Array;
  private contD2: Int32Array;
  private contCa: Uint32Array;
  private contCb: Uint32Array;
  private contNx: Int32Array;
  private contNy: Int32Array;
  private newTargets: number[] = [];
  /** With depth: the level of each of this step's birth spots (one per pair in `newTargets`). */
  private newTargetLv: number[] = [];
  // Touch scratch: up to four chosen contacts per cell (slot or -1, with the pair hash that ranked it), stores as they were, and per-prey counts.
  private readonly selB: Int32Array;
  private readonly selH: Uint32Array;
  private readonly touchStore: Uint32Array;
  private readonly takers: Uint16Array;
  private readonly hitCount: Uint16Array;
  private readonly tiles25 = new Int32Array(25);
  private readonly pairA: number[] = [];
  private readonly pairB: number[] = [];
  // Hunting scratch: whether a body holds a mouth (by label), distinct targets this step, body size and last release as the division stage began.
  private readonly bodyMouth: Uint8Array;
  /** With `pack`: mouths per body as the step starts; and, in touch and grip, distinct mouths of body x in a chosen pair with body y (key x * 65536 + y). */
  private readonly bodyMouthN: Uint16Array;
  private packTouch = new Map<number, number>();
  private packUseTouch = false;
  /** With `steer`: each body's one aim (target slot or -1, the cell that found it, flee or hunt, score). */
  private readonly bodyAimT: Int32Array;
  private readonly bodyAimSrc: Int32Array;
  private readonly bodyAimAway: Uint8Array;
  private readonly bodyAimScore: Int32Array;
  private lastScore = 0;
  private readonly tgtMark: Uint32Array;
  private tgtGen = 0;
  private readonly bodyStart: Int32Array;
  private readonly bodyRelMax: Float64Array;

  constructor(cfg: SoftRoamConfig) {
    this.cfg = Object.freeze({ ...cfg });
    const size = whole(cfg.size, 'size', 8, 256);
    whole(cfg.seed, 'seed', 0, 0xffffffff);
    this.total = whole(cfg.matter, 'matter', 1, (1 << 20) - 1);
    this.cap = whole(cfg.maxCells, 'maxCells', 1, 16384);
    whole(cfg.patchFood, 'patchFood', 1, this.total);
    whole(cfg.patchRadius, 'patchRadius', 0, (size >> 1) - 1);
    whole(cfg.patchEvery, 'patchEvery', 1, 1_000_000);
    whole(cfg.startPatches, 'startPatches', 0, 100_000);
    whole(cfg.birthStore, 'birthStore', 1, 256);
    this.biteN = whole(cfg.bite, 'bite', 1, 4 * cfg.birthStore);
    whole(cfg.minStore, 'minStore', 1, cfg.birthStore);
    whole(cfg.mutStep, 'mutStep', 1, 2 * ROAM_GENE_MAX);
    whole(cfg.scentIters, 'scentIters', 0, 16);
    whole(cfg.scentDecayShift, 'scentDecayShift', 1, 12);
    whole(cfg.scentGain, 'scentGain', 1, 16);
    whole(cfg.substeps, 'substeps', 1, 8);
    whole(cfg.keep, 'keep', 0, 255);
    whole(cfg.kBond, 'kBond', 0, 1024);
    whole(cfg.kBrace, 'kBrace', 0, 1024);
    whole(cfg.kRep, 'kRep', 0, 1024);
    // Two cells closing at 2 vMax / 16 units a substep must not cross the band D/4 deep in which contact is felt in one substep: vMax <= 2048.
    whole(cfg.vMax, 'vMax', 1, 2048);
    whole(cfg.thrustMax, 'thrustMax', 0, 1024);
    // Explicit Euler with this damping is stable while (stiffness on one cell) / 16 < 2 (1 + keep / 256).
    // Grip adds at most four springs to a cell (touch keeps four contacts).
    const stiff = (2 * (4 * cfg.kBond + 4 * cfg.kBrace + 6 * cfg.kRep + 4 * (cfg.grip ?? 0))) / 256;
    if (stiff / 16 >= 2 * (1 + cfg.keep / 256)) throw new Error(`Springs too stiff for keep ${cfg.keep}: ${stiff.toFixed(2)}`);
    this.leakSideQ16 = q16(cfg.leakSide, 'leakSide');
    this.leakCellQ16 = q16(cfg.leakCell, 'leakCell');
    this.moveCostQ16 = q16(cfg.moveCost, 'moveCost');
    this.turnMaxQ16 = q16(cfg.turnMax, 'turnMax');
    this.mutQ16 = q16(cfg.mut, 'mut');
    this.planMutQ16 = q16(cfg.planMut, 'planMut');
    // Flow is a share out of 1024 (at most 1/8): diff * share stays below 2^27.
    // Bounds are checked on the value itself (1/1024 to 1/8 inclusive), before rounding to Q10.
    if (!Number.isFinite(cfg.flow) || cfg.flow < 1 / 1024 || cfg.flow > 1 / 8) throw new Error(`Invalid flow: ${cfg.flow}`);
    this.flowQ10 = Math.round(cfg.flow * 1024);
    this.wearQ32 = cfg.life === undefined ? 0 : Math.floor(0x100000000 / whole(cfg.life, 'life', 2, 1 << 30));
    this.spreadQ10 = cfg.foodSpread === undefined ? 0 : Math.round(cfg.foodSpread * 1024);
    // 0 is the documented off setting and behaves like omission (spreadQ10 0).
    if (cfg.foodSpread !== undefined && (!Number.isFinite(cfg.foodSpread) || cfg.foodSpread < 0 || cfg.foodSpread > 1)) throw new Error(`Invalid foodSpread: ${cfg.foodSpread}`);
    this.compost = cfg.compost === true;
    this.kinds = cfg.kinds === true;
    this.toughOn = cfg.toughness === true;
    if (cfg.toughness !== undefined && cfg.crack === undefined) throw new Error('toughness needs crack');
    if (cfg.crack !== undefined && (!this.kinds || cfg.drain === undefined)) throw new Error('crack needs kinds and drain');
    if (cfg.crack !== undefined) whole(cfg.crack, 'crack', 1, 60000);
    if ((cfg.shellBite !== undefined || cfg.shellLeak !== undefined) && !this.kinds) throw new Error('shellBite and shellLeak need kinds');
    if (cfg.seal !== undefined && cfg.drain === undefined) throw new Error('seal needs drain');
    this.drainN = cfg.drain === undefined ? 0 : whole(cfg.drain, 'drain', 1, 1 << 20);
    this.sealN = whole(cfg.seal ?? 100, 'seal', 0, 1_000_000);
    this.crackN = cfg.crack === undefined ? 0 : cfg.crack;
    this.gripN = cfg.grip === undefined ? 0 : whole(cfg.grip, 'grip', 0, 256);
    if (this.gripN > 0 && (!this.kinds || this.drainN === 0)) throw new Error('grip needs kinds and drain');
    if ((cfg.truce !== undefined && typeof cfg.truce !== 'boolean') || (cfg.jaws !== undefined && typeof cfg.jaws !== 'boolean')) throw new Error('truce and jaws are true or false');
    this.truceOn = cfg.truce === true;
    this.jawsOn = cfg.jaws === true;
    if ((cfg.sight !== undefined || cfg.fear !== undefined) && (!this.kinds || this.drainN === 0)) throw new Error('sight and fear need kinds and drain');
    this.sightN = cfg.sight === undefined ? 0 : whole(cfg.sight, 'sight', 1, 8);
    this.fearN = cfg.fear === undefined ? 0 : whole(cfg.fear, 'fear', 1, 8);
    this.relMinN = cfg.releaseMin === undefined ? 0 : whole(cfg.releaseMin, 'releaseMin', 1, 16384);
    this.relGapN = cfg.releaseGap === undefined ? 0 : whole(cfg.releaseGap, 'releaseGap', 1, 1 << 30);
    if (cfg.day !== undefined) whole(cfg.day, 'day', 16, 1 << 20);
    if (cfg.year !== undefined) {
      if (cfg.day === undefined) throw new Error('year needs day');
      whole(cfg.year, 'year', cfg.day, 1 << 24);
    }
    if (cfg.winter !== undefined) {
      if (cfg.year === undefined) throw new Error('winter needs year');
      if (!(typeof cfg.winter === 'number' && cfg.winter >= 0 && cfg.winter <= 1)) throw new Error(`Invalid winter: ${cfg.winter}`);
    }
    if (cfg.patchSun !== undefined && typeof cfg.patchSun !== 'boolean') throw new Error('patchSun is true or false');
    if (cfg.patchSun !== undefined && cfg.day === undefined) throw new Error('patchSun needs day');
    this.sunPatch = cfg.patchSun === true;
    this.leafOn = cfg.leaf !== undefined;
    this.leafQ = 0;
    if (cfg.leaf !== undefined) {
      if (cfg.day === undefined || !this.kinds) throw new Error('leaf needs kinds and day');
      if (!(typeof cfg.leaf === 'number' && cfg.leaf >= 0 && cfg.leaf <= 4)) throw new Error(`Invalid leaf: ${cfg.leaf}`);
      this.leafQ = Math.round(cfg.leaf * LEAF_Q);
    }
    // Chunk 3.
    if (cfg.heal !== undefined && typeof cfg.heal !== 'boolean') throw new Error('heal is true or false');
    this.healOn = cfg.heal === true;
    if (cfg.steer !== undefined && typeof cfg.steer !== 'boolean') throw new Error('steer is true or false');
    if (cfg.steer !== undefined && this.sightN === 0 && this.fearN === 0) throw new Error('steer needs sight or fear');
    this.steerOn = cfg.steer === true;
    if (cfg.pack !== undefined && (!this.kinds || this.drainN === 0)) throw new Error('pack needs kinds and drain');
    this.packN = cfg.pack === undefined ? 0 : whole(cfg.pack, 'pack', 1, 16);
    if (cfg.crowd !== undefined && this.sightN === 0) throw new Error('crowd needs sight');
    this.crowdN = cfg.crowd === undefined ? 0 : whole(cfg.crowd, 'crowd', 1, 4);
    if (cfg.leafPool !== undefined && !this.leafOn) throw new Error('leafPool needs leaf');
    if (cfg.leafPool !== undefined && !(typeof cfg.leafPool === 'number' && cfg.leafPool >= 0 && cfg.leafPool <= 1)) throw new Error(`Invalid leafPool: ${cfg.leafPool}`);
    this.leafPoolQ8 = cfg.leafPool === undefined ? -1 : Math.round(cfg.leafPool * 256);
    if (cfg.leafPoolMax !== undefined && cfg.leafPool === undefined) throw new Error('leafPoolMax needs leafPool');
    this.leafPoolMaxN = cfg.leafPoolMax === undefined ? cfg.patchFood : whole(cfg.leafPoolMax, 'leafPoolMax', 1, 1 << 20);
    if (cfg.patchSeason !== undefined && typeof cfg.patchSeason !== 'boolean') throw new Error('patchSeason is true or false');
    if (cfg.patchSeason !== undefined && cfg.year === undefined) throw new Error('patchSeason needs year');
    this.seasonPatch = cfg.patchSeason === true;
    if (cfg.winterCost !== undefined && cfg.year === undefined) throw new Error('winterCost needs year');
    this.winterQ16 = cfg.winterCost === undefined ? 0 : q16(cfg.winterCost, 'winterCost');
    const share8 = (v: number | undefined, name: string): number => {
      if (v === undefined) return -1;
      if (!(typeof v === 'number' && v >= 0 && v <= 1)) throw new Error(`Invalid ${name}: ${v}`);
      return Math.round(v * 256);
    };
    this.paceQ8 = share8(cfg.pace, 'pace');
    if (cfg.shellThrust !== undefined && !cfg.kinds) throw new Error('shellThrust needs kinds');
    this.shellThrustQ8 = share8(cfg.shellThrust, 'shellThrust');
    this.depthN = cfg.depth === undefined ? 0 : whole(cfg.depth, 'depth', 2, 4);
    for (const k of ['depthGap', 'depthCost', 'depthDive', 'depthDim', 'depthShade'] as const) if (cfg[k] !== undefined && cfg.depth === undefined) throw new Error(`${k} needs depth`);
    this.depthGapN = cfg.depthGap === undefined ? 40 : whole(cfg.depthGap, 'depthGap', 1, 1 << 20);
    this.depthCostN = cfg.depthCost === undefined ? 1 : whole(cfg.depthCost, 'depthCost', 0, 64);
    // The dive threshold per cell in 65536ths of a unit of matter (under 2^28), compared against a body's total without rounding.
    this.depthDiveN = q16(cfg.depthDive ?? 1, 'depthDive', 4 * 65536) * cfg.birthStore;
    this.depthDimQ8 = q16(cfg.depthDim ?? 0.25, 'depthDim') >>> 8;
    this.depthShadeQ8 = q16(cfg.depthShade ?? 0.25, 'depthShade') >>> 8;
    if (cfg.pulse !== undefined && cfg.pulse !== true) throw new Error('pulse is true or absent');
    this.pulseOn = cfg.pulse === true;
    for (const k of ['pulseThrust', 'pulseFlex', 'pulseMut'] as const) if (cfg[k] !== undefined && !this.pulseOn) throw new Error(`${k} needs pulse`);
    this.pulseThrustQ8 = q16(cfg.pulseThrust ?? 0.5, 'pulseThrust') >>> 8;
    this.pulseFlexQ8 = q16(cfg.pulseFlex ?? 0.25, 'pulseFlex', 32768) >>> 8;
    this.pulseMutQ16 = q16(cfg.pulseMut ?? 0.1, 'pulseMut');
    this.shellBiteQ16 = cfg.shellBite === undefined ? 65536 : q16(cfg.shellBite, 'shellBite');
    const shellLeakQ16 = cfg.shellLeak === undefined ? 16384 : q16(cfg.shellLeak, 'shellLeak');
    // Roam's rule: a shell pays floor(leakSide * (1 + tough) * shellLeak) per exposed side (the product is below 2^34, so it is done here, in doubles).
    for (let k = 0; k < 4; k++) this.shellSideQ16[k] = Math.floor((this.leakSideQ16 * (1 + k) * shellLeakQ16) / 65536);

    this.size = size;
    this.n = size * size;
    this.span = size * SOFT_U;
    const cap = this.cap;
    const n = this.n;
    this.alive = new Uint8Array(cap);
    this.x = new Int32Array(cap);
    this.y = new Int32Array(cap);
    this.prevX = new Int32Array(cap);
    this.prevY = new Int32Array(cap);
    this.vx = new Int32Array(cap);
    this.vy = new Int32Array(cap);
    this.carryX = new Int8Array(cap);
    this.carryY = new Int8Array(cap);
    this.store = new Uint32Array(cap);
    this.genes = new Int16Array(cap * ROAM_GENES);
    this.pid = new Uint32Array(cap);
    this.mode = new Uint8Array(cap);
    this.made = new Uint8Array(cap);
    this.orient = new Uint8Array(cap);
    this.gx = new Int16Array(cap);
    this.gy = new Int16Array(cap);
    this.kind = new Uint8Array(cap);
    this.tough = new Uint8Array(cap);
    this.hits = new Uint16Array(cap);
    this.fam = new Uint16Array(cap);
    this.cid = new Uint32Array(cap);
    this.since = new Uint32Array(cap);
    this.bornStep = new Uint32Array(cap);
    this.lastHitStep = new Uint32Array(cap);
    this.lastDrainStep = new Uint32Array(cap);
    this.heading = new Uint16Array(cap);
    this.turnLeft = new Int16Array(cap);
    this.mother = new Int32Array(cap).fill(-1);
    this.braceTo = new Int32Array(cap * 4).fill(-1);
    this.braceRest = new Int16Array(cap * 4);
    this.body = new Int32Array(cap);
    this.relRec = new Float64Array(cap);
    this.leafOnTile = new Uint16Array(this.leafOn ? n * (this.depthN > 0 ? this.depthN : 1) : 0);
    const dcap = this.depthN > 0 ? cap : 0;
    this.level = new Uint8Array(dcap);
    this.lift = new Uint8Array(dcap);
    this.lvlStep = new Uint32Array(dcap);
    this.bodyLevel = new Uint8Array(this.depthN > 0 ? cap + 2 : 0);
    this.bodyLvMoved = new Uint8Array(this.depthN > 0 ? cap + 2 : 0);
    this.bodyLiftSum = new Int32Array(this.depthN > 0 ? cap + 2 : 0);
    this.bodyLvStep = new Uint32Array(this.depthN > 0 ? cap + 2 : 0);
    this.bodyStoreSum = new Int32Array(this.depthN > 0 ? cap + 2 : 0);
    this.lvlCount = new Uint16Array(this.depthN > 0 ? n * this.depthN : 0);
    const pcap = this.pulseOn ? cap : 0;
    this.pulseW = new Int8Array(pcap * PULSE_W);
    this.sigA = new Int8Array(pcap);
    this.sigB = new Int8Array(pcap);
    this.pulseGo = new Int8Array(pcap);
    this.pulseFlex = new Int8Array(pcap);
    this.sigNextA = new Int8Array(pcap);
    this.sigNextB = new Int8Array(pcap);
    this.kidA = new Int32Array(pcap);
    this.kidB = new Int32Array(pcap);
    this.kidN = new Int32Array(pcap);
    this.pulseMoved = new Uint8Array(pcap);
    this.leafPaid = new Uint8Array(this.leafOn ? this.cap : 0);
    this.bodyMouth = new Uint8Array(cap + 2);
    this.bodyMouthN = new Uint16Array(this.packN > 0 ? cap + 2 : 0);
    this.bodyAimT = new Int32Array(this.steerOn ? cap + 2 : 0);
    this.bodyPace = new Float64Array(this.paceQ8 >= 0 ? cap + 2 : 0);
    this.bodyAimSrc = new Int32Array(this.steerOn ? cap + 2 : 0);
    this.bodyAimAway = new Uint8Array(this.steerOn ? cap + 2 : 0);
    this.bodyAimScore = new Int32Array(this.steerOn ? cap + 2 : 0);
    this.tgtMark = new Uint32Array(this.sightN > 0 ? cap : 0);
    this.bodyStart = new Int32Array(this.relMinN > 0 ? cap + 2 : 0);
    this.bodyRelMax = new Float64Array(this.relGapN > 0 ? cap + 2 : 0);
    this.food = new Uint32Array(n);
    this.scent = new Uint32Array(n);
    this.scentHi = new Uint32Array(n);
    this.scentHiNext = new Uint32Array(n);
    this.bodySize = new Int32Array(cap + 2);
    this.freeList = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.freeList[i] = cap - 1 - i;
    this.freeN = cap;
    this.live = new Int32Array(cap);
    this.fx = new Int32Array(cap);
    this.fy = new Int32Array(cap);
    this.tx = new Int32Array(cap);
    this.hx = new Int32Array(cap);
    this.hy = new Int32Array(cap);
    this.ty = new Int32Array(cap);
    this.head = new Int32Array(n).fill(-1);
    this.nextInTile = new Int32Array(cap);
    this.clampRun = new Uint16Array(cap);
    this.uf = new Int32Array(cap);
    this.rootLabel = new Int32Array(cap);
    this.bodyRoot = new Int32Array(cap + 2);
    this.bodyHead = new Int32Array(cap + 2);
    this.bodyTurn = new Int32Array(cap + 2);
    this.bodyTurnSum = new Int32Array(cap + 2);
    this.bodyTmp = new Int32Array(cap + 2);
    this.contN = new Int32Array(cap + 2);
    this.bodyPush = new Uint8Array(cap + 2);
    this.contHead = new Int32Array(cap + 2).fill(-1);
    const pool0 = 4 * cap + 64;
    this.contNext = new Int32Array(pool0);
    this.contD2 = new Int32Array(pool0);
    this.contCa = new Uint32Array(pool0);
    this.contCb = new Uint32Array(pool0);
    this.contNx = new Int32Array(pool0);
    this.contNy = new Int32Array(pool0);
    this.tieX = new Int32Array(pool0);
    this.tieY = new Int32Array(pool0);
    this.prevBody = new Int32Array(cap);
    this.selB = new Int32Array(cap * TOUCH_CAP).fill(-1);
    this.selH = new Uint32Array(cap * TOUCH_CAP);
    this.touchStore = new Uint32Array(cap);
    this.takers = new Uint16Array(cap);
    this.hitCount = new Uint16Array(cap);
    this.askTile = new Uint32Array(n);
    this.askCell = new Uint32Array(cap);
    this.gotCell = new Uint32Array(cap);
    this.flowSnap = new Uint32Array(cap);
    this.foodSnap = new Uint32Array(this.spreadQ10 > 0 ? n : 0);
    this.dying = new Uint8Array(cap);
    this.backMode = new Uint8Array(cap);
    this.firstDaughter = new Int32Array(cap);

    const r = cfg.patchRadius;
    const offs: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offs.push(dx, dy);
    this.patchTiles = Int32Array.from(offs);

    this.reservoir = this.total;
    for (let k = 0; k < cfg.startPatches && this.reservoir >= cfg.patchFood; k++) this.dropPatch(roamHash(cfg.seed, 0, k, CH_FOUND), false);
    // With no scent passes there is no scent at all (a field built once and never updated would steer cells forever).
    if (cfg.scentIters > 0) this.relaxScent(1);
  }

  // ------------------------------------------------------------------ small helpers

  private tileAt(tx: number, ty: number): number {
    const s = this.size;
    return ((ty + s) % s) * s + ((tx + s) % s);
  }

  /** Shortest signed distance from coordinate a to coordinate b on the torus. */
  dlt(a: number, b: number): number {
    const d = b - a;
    const h = this.span >>> 1;
    return d > h ? d - this.span : d < -h ? d + this.span : d;
  }

  private wrap(v: number): number {
    const w = this.span;
    return v >= w ? v - w : v < 0 ? v + w : v;
  }

  /** A pair draw, the same whichever of the two cells is named first. */
  private pairHash(a: number, b: number, ch: number): number {
    const ca = this.cid[a];
    const cb = this.cid[b];
    const lo = ca < cb ? ca : cb;
    const hi = ca < cb ? cb : ca;
    return roamHash(this.cfg.seed, this.step, (Math.imul(lo, 0x9e3779b1) ^ hi) >>> 0, ch);
  }

  /**
   * A second pair draw built another way (the pair key above can collide for different pairs), used only to settle a tie in
   * `pairHash`: the same whichever of the two cells is named first.
   */
  private pairTie(a: number, b: number): number {
    const ca = this.cid[a];
    const cb = this.cid[b];
    const lo = ca < cb ? ca : cb;
    const hi = ca < cb ? cb : ca;
    // Nested, so two pairs that collide in the plain key above collide here only by chance of this step's draw, not at every step.
    const inner = roamHash(this.cfg.seed, this.step, lo, CH_TOUCH_TIE);
    return roamHash(this.cfg.seed, this.step, (Math.imul(hi ^ 0x5bd1e995, 0x27d4eb2f) + inner) >>> 0, CH_TOUCH_TIE);
  }

  /**
   * Whether candidate b (hash h) ranks ahead of the held candidate p (hash hp) for cell a: lower hash, then lower second draw, then lower
   * third draw. The third is a draw on each candidate's own cid (the hash is a bijection of the key, so two cids never tie on it) and
   * is fresh every step: a pair that collides on both pair draws is settled by a different coin each step, never by the lower cid.
   */
  private ranksAhead(a: number, b: number, h: number, p: number, hp: number): boolean {
    if (h !== hp) return h < hp;
    const tb = this.pairTie(a, b);
    const tp = this.pairTie(a, p);
    if (tb !== tp) return tb < tp;
    const seed = this.cfg.seed;
    const t = this.step;
    return roamHash(seed, t, this.cid[b], CH_TOUCH_TIE3) < roamHash(seed, t, this.cid[p], CH_TOUCH_TIE3);
  }

  /** Fill the 9 tiles around tile coordinates (tx, ty), in the scan order in force. */
  private around(tx: number, ty: number): Int32Array {
    const t = this.tiles9;
    const o0 = this._reverseScan ? 1 : -1;
    const st = this._reverseScan ? -1 : 1;
    let k = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[k++] = this.tileAt(tx + o0 + j * st, ty + o0 + i * st);
    return t;
  }

  /** Fill the 25 tiles around tile coordinates (tx, ty), in the scan order in force (touch reaches 1.25 D, which can be two tiles away). */
  private around25(tx: number, ty: number): Int32Array {
    const t = this.tiles25;
    const o0 = this._reverseScan ? 2 : -2;
    const st = this._reverseScan ? -1 : 1;
    let k = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) t[k++] = this.tileAt(tx + o0 + j * st, ty + o0 + i * st);
    return t;
  }

  private buildBuckets(): void {
    this.head.fill(-1);
    const rev = this._reverseScan;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[rev ? this.liveN - 1 - q : q];
      const tile = (this.y[c] >>> 10) * this.size + (this.x[c] >>> 10);
      this.nextInTile[c] = this.head[tile];
      this.head[tile] = c;
    }
  }

  private rebuildLive(): void {
    let k = 0;
    for (let c = 0; c < this.cap; c++) if (this.alive[c]) this.live[k++] = c;
    this.liveN = k;
  }

  private hasBrace(a: number, b: number): boolean {
    const o = a * 4;
    return this.braceTo[o] === b || this.braceTo[o + 1] === b || this.braceTo[o + 2] === b || this.braceTo[o + 3] === b;
  }

  /** Join a and b with a brace of the given rest length, when both have a free place. */
  private addBrace(a: number, b: number, rest: number): boolean {
    let ia = -1;
    let ib = -1;
    for (let k = 0; k < 4; k++) {
      if (ia < 0 && this.braceTo[a * 4 + k] < 0) ia = k;
      if (ib < 0 && this.braceTo[b * 4 + k] < 0) ib = k;
    }
    if (ia < 0 || ib < 0) return false;
    this.braceTo[a * 4 + ia] = b;
    this.braceRest[a * 4 + ia] = rest;
    this.braceTo[b * 4 + ib] = a;
    this.braceRest[b * 4 + ib] = rest;
    return true;
  }

  private dropBracesOf(c: number): void {
    for (let k = 0; k < 4; k++) {
      const p = this.braceTo[c * 4 + k];
      if (p < 0) continue;
      for (let j = 0; j < 4; j++) if (this.braceTo[p * 4 + j] === c) this.braceTo[p * 4 + j] = -1;
      this.braceTo[c * 4 + k] = -1;
    }
  }

  private offKey(body: number, gx: number, gy: number): number {
    return (body * 65536 + (gx & 0xffff)) * 65536 + (gy & 0xffff);
  }

  private buildOffsets(): void {
    const m = this.offsetMap;
    m.clear();
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const key = this.offKey(this.body[c], this.gx[c], this.gy[c]);
      const o = m.get(key);
      if (o === undefined || this.cid[c] < this.cid[o]) m.set(key, c);
    }
  }

  // ------------------------------------------------------------------ plans, founders, food

  /** Add a plan (16 modes, see `planEntry`) and return its number. `parent` is the plan it was copied from, if any. */
  addPlan(entries: ArrayLike<number>, parent = 0): number {
    if (entries.length !== PLAN_MODES) throw new Error(`a plan has ${PLAN_MODES} modes`);
    whole(parent, 'parent plan', 0, this.plans.length - 1);
    const plan = new Uint16Array(PLAN_MODES);
    for (let m = 0; m < PLAN_MODES; m++) {
      const e = whole(entries[m], 'plan mode', 0, this.toughOn ? 0xffff : this.kinds ? (this.leafOn ? 0x3fff : 0x2fff) : 0xfff);
      if ((e & 15) > PLAN_REST) throw new Error(`Invalid act in mode ${m}: ${e & 15}`);
      if (((e >>> 12) & 3) > (this.leafOn ? KIND_LEAF : KIND_MOUTH)) throw new Error(`Invalid kind in mode ${m}: ${(e >>> 12) & 3}`);
      plan[m] = e;
    }
    this.plans.push(plan);
    this.planParent.push(parent);
    return this.plans.length - 1;
  }

  /**
   * Put one founder cell at a position (in units), paid for from the reservoir. Returns its slot, or -1 when a cell is
   * within 717 units, there is no free slot, or the reservoir cannot pay. The founder needs a plan number from `addPlan`.
   */
  found(xUnits: number, yUnits: number, genes: readonly number[], family: number, store = 2 * this.cfg.birthStore - 1, plan = 0): number {
    whole(xUnits, 'x', -(1 << 28), 1 << 28);
    whole(yUnits, 'y', -(1 << 28), 1 << 28);
    whole(store, 'store', this.cfg.minStore, 0x7fffffff);
    if (genes.length !== ROAM_GENES) throw new Error(`found needs ${ROAM_GENES} genes`);
    for (const g of genes) whole(g, 'gene', -ROAM_GENE_MAX, ROAM_GENE_MAX);
    whole(family, 'family', 0, 0xffff);
    if (!(Number.isSafeInteger(plan) && plan >= 1 && plan < this.plans.length)) throw new Error(`Invalid plan number: ${plan}`);
    const px = ((xUnits % this.span) + this.span) % this.span;
    const py = ((yUnits % this.span) + this.span) % this.span;
    if (this.freeN === 0 || this.reservoir < store) return -1;
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c]) continue;
      const dx = this.dlt(px, this.x[c]);
      if (dx >= SENSE || dx <= -SENSE) continue;
      const dy = this.dlt(py, this.y[c]);
      if (dy >= SENSE || dy <= -SENSE) continue;
      if (dx * dx + dy * dy < SENSE * SENSE) return -1;
    }
    if (this.nextCid > 0xffffffff) return -1;
    const h = roamHash(this.cfg.seed, this.step, this.nextCid, CH_HEAD);
    const c = this.allocate();
    this.place(c, px, py, genes, family, store, plan);
    this.heading[c] = h & 1023;
    this.orient[c] = (h >>> 10) & 3;
    this.reservoir -= store;
    this.mother[c] = -1;
    this.body[c] = ++this.labelHi;
    this.bodySize[this.body[c]] = 1;
    this.bodyCount++;
    return c;
  }

  /** With pulse: give a one-cell founder (a slot `found` returned) its network: PULSE_W whole weights, -127 to 127, row by row (next A, next B, go, flex). */
  setPulse(c: number, weights: ArrayLike<number>): void {
    if (!this.pulseOn) throw new Error('setPulse needs pulse');
    if (!(Number.isInteger(c) && c >= 0 && c < this.cap && this.alive[c])) throw new Error(`Invalid cell: ${c}`);
    if (this.mother[c] >= 0 || this.bodySize[this.body[c]] !== 1) throw new Error('setPulse is for a one-cell founder');
    if (weights.length !== PULSE_W) throw new Error(`setPulse needs ${PULSE_W} weights`);
    for (let i = 0; i < PULSE_W; i++) whole(weights[i], 'weight', -127, 127);
    for (let i = 0; i < PULSE_W; i++) this.pulseW[c * PULSE_W + i] = weights[i];
  }

  /** With depth: put a one-cell founder (a slot `found` returned) on a level and give it a lift (default the middle of that level's share of 0 to 255). */
  setLevel(c: number, level: number, lift?: number): void {
    if (this.depthN === 0) throw new Error('setLevel needs depth');
    if (!(Number.isInteger(c) && c >= 0 && c < this.cap && this.alive[c])) throw new Error(`Invalid cell: ${c}`);
    whole(level, 'level', 0, this.depthN - 1);
    const lf = lift === undefined ? Math.floor(((2 * level + 1) * 256) / (2 * this.depthN)) : whole(lift, 'lift', 0, 255);
    this.level[c] = level;
    this.lift[c] = lf;
  }

  /** Test only: make the free slots come out in this order (slots not named follow in the usual order). */
  _testSlotOrder(order: readonly number[]): void {
    if (this.freeN !== this.cap) throw new Error('slot order can only be set on an empty world');
    const seen = new Set<number>();
    const list: number[] = [];
    for (const s of order) if (!seen.has(s) && s >= 0 && s < this.cap) { seen.add(s); list.push(s); }
    for (let s = 0; s < this.cap; s++) if (!seen.has(s)) list.push(s);
    for (let i = 0; i < this.cap; i++) this.freeList[i] = list[this.cap - 1 - i];
  }

  private allocate(): number {
    return this.freeList[--this.freeN];
  }

  /** Common fields of a new cell in slot c (the caller sets links, plan state and kind). */
  private place(c: number, px: number, py: number, genes: ArrayLike<number>, family: number, store: number, plan: number): void {
    this.alive[c] = 1;
    if (c < this.leafPaid.length) this.leafPaid[c] = 0; // picture only: a reused slot must not show the dead leaf's glow
    this.gotCell[c] = 0; // picture only (eat sets it for every live cell before it is read): a newborn shows no grazing
    if (this.depthN > 0) { this.level[c] = 0; this.lift[c] = 0; this.lvlStep[c] = 0; }
    if (this.pulseOn) {
      // The still network, no signal: `found` keeps it, a birth copies the mother's over it.
      this.pulseW.fill(0, c * PULSE_W, (c + 1) * PULSE_W);
      this.pulseW[c * PULSE_W + 2 * PULSE_IN] = PULSE_ONE;
      this.sigA[c] = 0; this.sigB[c] = 0; this.pulseGo[c] = 127; this.pulseFlex[c] = 0; this.pulseMoved[c] = 0;
    }
    this.x[c] = this.prevX[c] = px;
    this.y[c] = this.prevY[c] = py;
    this.vx[c] = 0;
    this.vy[c] = 0;
    this.carryX[c] = 0;
    this.carryY[c] = 0;
    this.store[c] = store;
    for (let g = 0; g < ROAM_GENES; g++) this.genes[c * ROAM_GENES + g] = genes[g];
    this.fam[c] = family;
    this.cid[c] = this.nextCid++;
    this.pid[c] = plan;
    this.mode[c] = 0;
    this.made[c] = 0;
    this.orient[c] = 0;
    this.gx[c] = 0;
    this.gy[c] = 0;
    this.kind[c] = KIND_PLAIN;
    this.tough[c] = 0;
    this.hits[c] = 0;
    this.since[c] = this.step;
    this.relRec[c] = 0;
    this.bornStep[c] = 0;
    this.lastHitStep[c] = 0;
    this.lastDrainStep[c] = 0;
    this.turnLeft[c] = 0;
    this.clampRun[c] = 0;
    this.mother[c] = -1;
    for (let k = 0; k < 4; k++) this.braceTo[c * 4 + k] = -1;
  }

  private release(c: number): void {
    this.alive[c] = 0;
    this.store[c] = 0;
    this.cid[c] = 0;
    this.pid[c] = 0;
    this.mode[c] = 0;
    this.made[c] = 0;
    this.orient[c] = 0;
    this.gx[c] = 0;
    this.gy[c] = 0;
    this.kind[c] = 0;
    this.tough[c] = 0;
    this.hits[c] = 0;
    this.fam[c] = 0;
    this.since[c] = 0;
    this.relRec[c] = 0;
    this.vx[c] = 0;
    this.vy[c] = 0;
    this.carryX[c] = 0;
    this.carryY[c] = 0;
    this.body[c] = 0;
    this.mother[c] = -1;
    this.clampRun[c] = 0;
    this.freeList[this.freeN++] = c;
  }

  private dropPatch(rnd: number, event = true, amount = this.cfg.patchFood): void {
    const s = this.size;
    const cx = rnd % s;
    const cy = (rnd >>> 16) % s;
    const k = this.patchTiles.length >> 1;
    const each = Math.floor(amount / k);
    for (let j = 0; j < k; j++) this.food[this.tileAt(cx + this.patchTiles[2 * j], cy + this.patchTiles[2 * j + 1])] += each;
    this.food[this.tileAt(cx, cy)] += amount - each * k;
    this.reservoir -= amount;
    this.patches++;
    if (event) this.events.patches.push({ x: cx, y: cy });
  }

  private relaxScent(iters = this.cfg.scentIters): void {
    const s = this.size;
    const n = this.n;
    const shift = 1 << this.cfg.scentDecayShift;
    for (let it = 0; it < iters; it++) {
      const a = this.scentHi;
      const b = this.scentHiNext;
      for (let i = 0; i < n; i++) {
        const xx = i % s;
        const row = i - xx;
        const e = a[row + (xx + 1 === s ? 0 : xx + 1)];
        const w = a[row + (xx === 0 ? s - 1 : xx - 1)];
        const so = a[i + s >= n ? i + s - n : i + s];
        const no = a[i - s < 0 ? i - s + n : i - s];
        const m = Math.floor((4 * a[i] + e + w + so + no) / 8);
        const f = this.food[i];
        const v = m - Math.floor(m / shift) + (f > SCENT_FOOD_CAP ? SCENT_FOOD_CAP : f) * SCENT_SCALE;
        b[i] = v > SCENT_HI_MAX ? SCENT_HI_MAX : v;
      }
      this.scentHi = b;
      this.scentHiNext = a;
    }
    const hi = this.scentHi;
    const out = this.scent;
    for (let i = 0; i < n; i++) out[i] = hi[i] >>> 3;
  }

  // ------------------------------------------------------------------ bodies

  /** Walk the mother links: every group is a body, labelled from 1. The root of a body is its cell with the smallest cid. */
  private labelBodies(): void {
    const uf = this.uf;
    const live = this.live;
    for (let q = 0; q < this.liveN; q++) uf[live[q]] = live[q];
    const find = (a: number): number => {
      let r = a;
      while (uf[r] !== r) r = uf[r];
      while (uf[a] !== r) { const nx = uf[a]; uf[a] = r; a = nx; }
      return r;
    };
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      const m = this.mother[c];
      if (m < 0) continue;
      const a = find(c);
      const b = find(m);
      if (a !== b) uf[a] = b;
    }
    if (this.healOn) {
      // With `heal`, braces join a body too (the groups found do not depend on the order links are taken in).
      for (let q = 0; q < this.liveN; q++) {
        const c = live[q];
        for (let k = 0; k < 4; k++) {
          const p = this.braceTo[c * 4 + k];
          if (p < 0) continue;
          const a = find(c);
          const b = find(p);
          if (a !== b) uf[a] = b;
        }
      }
    }
    this.rootLabel.fill(0);
    this.bodySize.fill(0);
    let count = 0;
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      const r = find(c);
      if (this.rootLabel[r] === 0) { this.rootLabel[r] = ++count; this.bodyRoot[count] = c; }
      const l = this.rootLabel[r];
      this.body[c] = l;
      this.bodySize[l]++;
      if (this.cid[c] < this.cid[this.bodyRoot[l]]) this.bodyRoot[l] = c;
    }
    this.labelHi = count;
    this.bodyCount = count;
  }

  private countBodies(): void {
    let k = 0;
    for (let l = 1; l <= this.labelHi; l++) if (this.bodySize[l] > 0) k++;
    this.bodyCount = k;
  }

  // ------------------------------------------------------------------ step 0: commands

  private commands(): void {
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const live = this.live;
    const hi = this.labelHi;
    const senses = this.sightN > 0 || this.fearN > 0;
    if (senses) {
      // Newborns count and freed slots do not: buckets from the positions as the step starts.
      this.buildBuckets();
      this.hunting = 0;
      this.targets = 0;
      this.fleeing = 0;
      if (++this.tgtGen > 0xffffffff) { this.tgtMark.fill(0); this.tgtGen = 1; }
    }
    if (this.steerOn) this.findAims();
    if (this.depthN > 0) this.moveLevels();
    if (this.pulseOn) this.pulseStage();
    this.bodyTurnSum.fill(0, 0, hi + 1);
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      this.bodyTurnSum[this.body[c]] += this.genes[c * ROAM_GENES + G_TURN] + ROAM_GENE_MAX;
    }
    for (let l = 1; l <= hi; l++) {
      if (this.bodySize[l] === 0) continue;
      const r = this.bodyRoot[l];
      let h = this.heading[r];
      let tl = this.turnLeft[r];
      const sealed = this.drainN > 0 && ((t - this.since[r]) >>> 0) < this.sealN;
      if (sealed) tl = 0;
      else if (this.steerOn && this.bodyAimT[l] >= 0) {
        // One aim for the body: turn toward the target (away from the threat), no turn draw this step.
        const a = this.bodyAimSrc[l];
        const b = this.bodyAimT[l];
        const dx = this.dlt(this.x[a], this.x[b]);
        const dy = this.dlt(this.y[a], this.y[b]);
        if (dx !== 0 || dy !== 0) {
          const ang = this.bodyAimAway[l] ? softRoamAngle(-dx, -dy) : softRoamAngle(dx, dy);
          tl = ((ang - h + 512) & 1023) - 512;
        } else tl = 0;
        const stp = tl > 16 ? 16 : tl < -16 ? -16 : tl;
        h = (h + stp + 1024) & 1023;
        tl -= stp;
      } else {
        const turnQ16 = Math.floor((Math.floor(this.bodyTurnSum[l] / this.bodySize[l]) * this.turnMaxQ16) / (2 * ROAM_GENE_MAX));
        if ((roamHash(seed, t, this.cid[r], CH_TURN) & 0xffff) < turnQ16) {
          tl += (roamHash(seed, t, this.cid[r], CH_TURNAMT) % 513) - 256;
          tl = tl > 32000 ? 32000 : tl < -32000 ? -32000 : tl;
        }
        const stp = tl > 16 ? 16 : tl < -16 ? -16 : tl;
        h = (h + stp + 1024) & 1023;
        tl -= stp;
      }
      this.bodyHead[l] = h;
      this.bodyTurn[l] = tl;
    }
    const gain = cfg.scentGain;
    const costQ16 = this.moveCostQ16;
    if (this.paceQ8 >= 0) {
      // A body's thrust share from how full it is: a sum over its cells (exact in a double: at most 2^14 cells of at most 2^31), so the slot order does not matter.
      const pace = this.bodyPace;
      pace.fill(0, 0, hi + 1);
      for (let q = 0; q < this.liveN; q++) pace[this.body[live[q]]] += this.store[live[q]];
      const lo = cfg.minStore;
      const span = 2 * cfg.birthStore - lo;
      for (let l = 1; l <= hi; l++) {
        if (this.bodySize[l] === 0) continue;
        const mean = Math.floor(pace[l] / this.bodySize[l]);
        let q = span > 0 ? Math.floor(((mean - lo) * 256) / span) : 256;
        q = q < 0 ? 0 : q > 256 ? 256 : q;
        pace[l] = 256 - Math.floor(((256 - this.paceQ8) * q) / 256);
      }
    }
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      const l = this.body[c];
      const h = this.bodyHead[l];
      this.heading[c] = h;
      this.turnLeft[c] = this.bodyTurn[l];
      const ch = softRoamCos(h);
      const sh = softRoamSin(h);
      const sealed = this.drainN > 0 && ((t - this.since[this.bodyRoot[l]]) >>> 0) < this.sealN;
      if (this.leafOn && !sealed && this.kind[c] === KIND_LEAF) {
        // A leaf that is not newly released does not thrust and pays no move cost.
        this.tx[c] = 0;
        this.ty[c] = 0;
        continue;
      }
      let ux = 0;
      let uy = 0;
      let steerAim = -1;
      let steerAway = false;
      if (sealed) {
        ux = Math.trunc(ch / 16);
        uy = Math.trunc(sh / 16);
      } else {
        const chase = this.genes[c * ROAM_GENES + G_CHASE];
        const drive = this.genes[c * ROAM_GENES + G_DRIVE];
        ux = Math.trunc((drive * ch) / 8192);
        uy = Math.trunc((drive * sh) / 8192);
        if (chase !== 0) {
          let aim = -1;
          let away = false;
          if (this.steerOn) {
            // With `steer` every cell with a chase gene steers by its body's one aim, from where it is.
            aim = this.bodyAimT[l];
            away = this.bodyAimAway[l] !== 0;
          } else if (senses) {
            // A mouth sees prey it could act on; a plain or shell cell sees the mouths that could act on it. Either steers by the size of the gene.
            if (this.sightN > 0 && this.kind[c] === KIND_MOUTH) aim = this.nearestTarget(c, this.sightN, false, CH_SIGHT_A, CH_SIGHT_B);
            else if (this.fearN > 0 && (this.kind[c] === KIND_PLAIN || this.kind[c] === KIND_SHELL)) { aim = this.nearestTarget(c, this.fearN, true, CH_FEAR_A, CH_FEAR_B); away = true; }
          }
          if (aim >= 0) {
            const dx = this.dlt(this.x[c], this.x[aim]);
            const dy = this.dlt(this.y[c], this.y[aim]);
            // Cells that share a centre give no direction to or from each other: the sensed pull is nothing (not the scent, not due east).
            const same = dx === 0 && dy === 0;
            const a = away ? softRoamAngle(-dx, -dy) : softRoamAngle(dx, dy);
            const m = chase < 0 ? -chase : chase;
            const sx = same ? 0 : Math.trunc((m * softRoamCos(a)) / 8192);
            const sy = same ? 0 : Math.trunc((m * softRoamSin(a)) / 8192);
            ux += sx;
            uy += sy;
            if (sx !== 0 || sy !== 0) { steerAim = aim; steerAway = away; }
          } else {
            const g = this.scentSlope(this.x[c], this.y[c], gain);
            ux += Math.trunc((chase * g[0]) / 512);
            uy += Math.trunc((chase * g[1]) / 512);
          }
        }
        const mag2 = ux * ux + uy * uy;
        if (mag2 > 1024 * 1024) {
          const mag = isqrt(mag2);
          ux = Math.trunc((ux * 1024) / mag);
          uy = Math.trunc((uy * 1024) / mag);
        }
        // Chunk 4: armour is heavy, and a fed body slows down (unless, with steer, it has an aim).
        if (this.shellThrustQ8 >= 0 && this.kind[c] === KIND_SHELL) {
          ux = Math.trunc((ux * this.shellThrustQ8) / 256);
          uy = Math.trunc((uy * this.shellThrustQ8) / 256);
        }
        if (this.paceQ8 >= 0 && !(this.steerOn && this.bodyAimT[l] >= 0)) {
          ux = Math.trunc((ux * this.bodyPace[l]) / 256);
          uy = Math.trunc((uy * this.bodyPace[l]) / 256);
        }
        // Inner pulse: the cell's go output holds its thrust back, never adds to it.
        if (this.pulseOn && this.pulseGo[c] < 127) {
          const share = 256 - Math.floor((this.pulseThrustQ8 * (127 - this.pulseGo[c])) / 254);
          ux = Math.trunc((ux * share) / 256);
          uy = Math.trunc((uy * share) / 256);
        }
      }
      let mag = isqrt(ux * ux + uy * uy);
      if (mag > 1024) mag = 1024;
      if (mag > 0) {
        const owe = Math.floor((costQ16 * mag) / 1024);
        const pay = (owe >>> 16) + ((roamHash(seed, t, this.cid[c], CH_COST) & 0xffff) < (owe & 0xffff) ? 1 : 0);
        if (pay > this.store[c]) { ux = 0; uy = 0; }
        else if (pay > 0) { this.store[c] -= pay; this.reservoir += pay; }
      }
      this.tx[c] = ux;
      this.ty[c] = uy;
      // Counted only when the sensed pull is part of a thrust that is not nothing (a pull another gene cancels, or one the cell cannot pay for, steers nowhere).
      // and one that thrustMax scales to nothing moves nobody, so it is not counted either.
      if (steerAim >= 0 && (Math.trunc((ux * cfg.thrustMax) / 1024) !== 0 || Math.trunc((uy * cfg.thrustMax) / 1024) !== 0)) {
        if (steerAway) this.fleeing++;
        else {
          this.hunting++;
          if (this.tgtMark[steerAim] !== this.tgtGen) { this.tgtMark[steerAim] = this.tgtGen; this.targets++; }
        }
      }
    }
  }

  /**
   * Inner pulse (see the header): every cell's network reads the signals of the step before and the cell's own cues, and gives its next two
   * signals, its go and its flex. Sums over daughters are whole numbers and the new signals are written after every cell has read, so no order matters.
   */
  private pulseStage(): void {
    const live = this.live;
    const N = this.liveN;
    const A = this.sigA;
    const B = this.sigB;
    const kA = this.kidA;
    const kB = this.kidB;
    const kN = this.kidN;
    for (let q = 0; q < N; q++) { const c = live[q]; kA[c] = 0; kB[c] = 0; kN[c] = 0; }
    for (let q = 0; q < N; q++) {
      const c = live[q];
      const m = this.mother[c];
      if (m >= 0) { kA[m] += A[c]; kB[m] += B[c]; kN[m]++; }
    }
    const lo = this.cfg.minStore;
    const span = 2 * this.cfg.birthStore - lo;
    const W = this.pulseW;
    const inp = this.pulseIn;
    for (let q = 0; q < N; q++) {
      const c = live[q];
      const m = this.mother[c];
      inp[0] = 127;
      inp[1] = A[c];
      inp[2] = B[c];
      inp[3] = m >= 0 ? A[m] : 0;
      inp[4] = m >= 0 ? B[m] : 0;
      inp[5] = kN[c] > 0 ? Math.trunc(kA[c] / kN[c]) : 0;
      inp[6] = kN[c] > 0 ? Math.trunc(kB[c] / kN[c]) : 0;
      // Fullness: the store can be far past two birth stores (a founder's, a fed mouth's), so it is held before it is scaled.
      let f = 0;
      if (span > 0) {
        const over = this.store[c] - lo;
        f = over <= 0 ? -127 : over >= span ? 127 : Math.floor((over * 254) / span) - 127;
      }
      inp[7] = f;
      let st = 0;
      if (m >= 0) {
        let dx = this.dlt(this.x[c], this.x[m]);
        let dy = this.dlt(this.y[c], this.y[m]);
        // Past two bond lengths either way the stretch reads full, and the squares below stay small.
        if (dx > 2 * L) dx = 2 * L; else if (dx < -2 * L) dx = -2 * L;
        if (dy > 2 * L) dy = 2 * L; else if (dy < -2 * L) dy = -2 * L;
        st = Math.trunc(((isqrt(dx * dx + dy * dy) - L) * 254) / L);
        st = st > 127 ? 127 : st < -127 ? -127 : st;
      }
      inp[8] = st;
      const l = this.body[c];
      inp[9] = this.steerOn && this.bodyAimT[l] >= 0 ? (this.bodyAimAway[l] !== 0 ? -127 : 127) : 0;
      const o = c * PULSE_W;
      for (let r = 0; r < PULSE_OUT; r++) {
        let sum = 0;
        const base = o + r * PULSE_IN;
        for (let i = 0; i < PULSE_IN; i++) sum += W[base + i] * inp[i];
        let v = Math.trunc(sum / PULSE_ONE);
        v = v > 127 ? 127 : v < -127 ? -127 : v;
        if (r === 0) this.sigNextA[c] = v;
        else if (r === 1) this.sigNextB[c] = v;
        else if (r === 2) this.pulseGo[c] = v;
        else this.pulseFlex[c] = v;
      }
      const da = this.sigNextA[c] - A[c];
      const db = this.sigNextB[c] - B[c];
      this.pulseMoved[c] = da >= 8 || da <= -8 || db >= 8 || db <= -8 ? 1 : 0;
    }
    for (let q = 0; q < N; q++) { const c = live[q]; A[c] = this.sigNextA[c]; B[c] = this.sigNextB[c]; }
  }

  /** With pulse: the rest length of a spring between a and b as their flex outputs have it this step. */
  private flexed(a: number, b: number, rest: number): number {
    return rest + Math.trunc((rest * this.pulseFlexQ8 * (this.pulseFlex[a] + this.pulseFlex[b])) / (254 * 256));
  }

  /**
   * With depth: each body picks the level it wants and moves one level toward it (see the header). Levels are read from the bodies' roots and
   * the aims' cells as the stage starts and written to the cells only after every body has chosen, so no order matters.
   */
  private moveLevels(): void {
    const t = this.step;
    const hi = this.labelHi;
    const Lv = this.depthN;
    const live = this.live;
    this.bodyLiftSum.fill(0, 0, hi + 1);
    this.bodyStoreSum.fill(0, 0, hi + 1);
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      this.bodyLiftSum[this.body[c]] += this.lift[c];
      // A cell holds at most four birth stores (1024), so a body's sum is under 2^24.
      this.bodyStoreSum[this.body[c]] += this.store[c];
    }
    const dive = this.depthDiveN;
    for (let l = 1; l <= hi; l++) {
      if (this.bodySize[l] === 0) continue;
      const r = this.bodyRoot[l];
      let lv = this.level[r];
      // Home from the exact mean lift (the sum is under 2^22, so the product is under 2^24).
      const home = Math.floor((this.bodyLiftSum[l] * Lv) / (256 * this.bodySize[l]));
      let want = home;
      // Exact on the totals (the sum is under 2^24 and a body under 2^20 cells, so both sides are under 2^49).
      const have = this.bodyStoreSum[l] * 65536;
      const need = dive * this.bodySize[l];
      if (have < need) want = 0;
      else if (have < 2 * need) want = lv;
      if (this.steerOn && this.bodyAimT[l] >= 0) {
        const tl = this.level[this.bodyAimT[l]];
        if (this.bodyAimAway[l] === 0) want = tl;
        else if (tl !== lv) want = lv;
        else want = home !== lv ? home : lv + 1 < Lv ? lv + 1 : lv - 1;
      }
      const sealed = this.drainN > 0 && ((t - this.since[r]) >>> 0) < this.sealN;
      let moved = 0;
      if (!sealed && want !== lv && (this.lvlStep[r] === 0 || ((t + 1 - this.lvlStep[r]) >>> 0) >= this.depthGapN)) {
        lv += want > lv ? 1 : -1;
        moved = 1;
        this.levelMoves++;
      }
      this.bodyLevel[l] = lv;
      this.bodyLvMoved[l] = moved;
      // The record of the last move is the root's, kept as the step plus one so 0 means never (a move at step 2^32 - 1 is recorded as 1, one step late).
      this.bodyLvStep[l] = moved ? (t + 1) >>> 0 || 1 : this.lvlStep[r];
    }
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      const l = this.body[c];
      this.level[c] = this.bodyLevel[l];
      this.lvlStep[c] = this.bodyLvStep[l];
      if (this.bodyLvMoved[l] !== 0 && this.depthCostN > 0) {
        const pay = this.store[c] < this.depthCostN ? this.store[c] : this.depthCostN;
        this.store[c] -= pay;
        this.reservoir += pay;
      }
    }
  }

  /**
   * With `steer`: every seeing mouth and fleeing cell of an unsealed body with a chase gene finds its own target as in chunk 2; then each body
   * takes one aim, the lowest over its cells by (flee before hunt, score, pair draw, second pair draw, target cid, own cid), where the score is the
   * squared distance (with the crowd term for a hunt). The tuple is total, so the slot order of the cells does not matter.
   */
  private findAims(): void {
    const t = this.step;
    const hi = this.labelHi;
    this.bodyAimT.fill(-1, 0, hi + 1);
    this.steering = 0;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const l = this.body[c];
      if (this.drainN > 0 && ((t - this.since[this.bodyRoot[l]]) >>> 0) < this.sealN) continue;
      if (this.genes[c * ROAM_GENES + G_CHASE] === 0) continue;
      let aim = -1;
      let away = 0;
      if (this.sightN > 0 && this.kind[c] === KIND_MOUTH) aim = this.nearestTarget(c, this.sightN, false, CH_SIGHT_A, CH_SIGHT_B);
      else if (this.fearN > 0 && (this.kind[c] === KIND_PLAIN || this.kind[c] === KIND_SHELL)) { aim = this.nearestTarget(c, this.fearN, true, CH_FEAR_A, CH_FEAR_B); away = 1; }
      if (aim < 0) continue;
      const cur = this.bodyAimT[l];
      let take = cur < 0;
      if (!take) {
        const ca = this.bodyAimAway[l];
        if (away !== ca) take = away > ca;
        else if (this.lastScore !== this.bodyAimScore[l]) take = this.lastScore < this.bodyAimScore[l];
        else {
          const chA = away ? CH_FEAR_A : CH_SIGHT_A;
          const chB = away ? CH_FEAR_B : CH_SIGHT_B;
          const src = this.bodyAimSrc[l];
          const h = this.pairHash(c, aim, chA);
          const hb = this.pairHash(src, cur, chA);
          if (h !== hb) take = h < hb;
          else {
            const g = this.pairHash2(c, aim, chB);
            const gb = this.pairHash2(src, cur, chB);
            if (g !== gb) take = g < gb;
            else if (this.cid[aim] !== this.cid[cur]) take = this.cid[aim] < this.cid[cur];
            else take = this.cid[c] < this.cid[src];
          }
        }
      }
      if (take) {
        if (cur < 0) this.steering++;
        this.bodyAimT[l] = aim;
        this.bodyAimSrc[l] = c;
        this.bodyAimAway[l] = away;
        this.bodyAimScore[l] = this.lastScore;
      }
    }
  }

  private readonly slope = new Int32Array(2);
  /**
   * The scent at a position, interpolated between tile centres, read from the fine field (8 times what `scent` shows, so a weak far
   * gradient of 1 against 0 in Roam's units is not rounded away). The field is under 2^23, so a weighted sum can pass 2^31: the sums are
   * plain numbers (exact far below 2^53) cut with Math.floor, never with a 32-bit shift.
   */
  private scentAt(px: number, py: number): number {
    // Offset by two tiles so the coordinates are non-negative (px runs from -1024 to the torus end plus 1024).
    const qx = px - 512 + 2048;
    const qy = py - 512 + 2048;
    const i0 = (qx >> 10) - 2;
    const j0 = (qy >> 10) - 2;
    const fx = qx & 1023;
    const fy = qy & 1023;
    const a = this.scentHi;
    const top = Math.floor((a[this.tileAt(i0, j0)] * (1024 - fx) + a[this.tileAt(i0 + 1, j0)] * fx) / 1024);
    const bot = Math.floor((a[this.tileAt(i0, j0 + 1)] * (1024 - fx) + a[this.tileAt(i0 + 1, j0 + 1)] * fx) / 1024);
    return Math.floor((top * (1024 - fy) + bot * fy) / 1024);
  }
  /**
   * The smooth slope of the scent at a position, each component in [-1024, 1024] (1024 is a relative slope of 1/gain per tile): Roam's
   * (east - west) * 1024 * gain / (east + west + 1), with east and west read one tile either side of the position from the
   * interpolated fine field, so it is Roam's at a tile centre (the fine field is Roam's own arithmetic) and a symmetric peak gives no
   * slope anywhere on its axis.
   */
  private scentSlope(px: number, py: number, gain: number): Int32Array {
    const se = this.scentAt(px + 1024, py);
    const sw = this.scentAt(px - 1024, py);
    const ss = this.scentAt(px, py + 1024);
    const sn = this.scentAt(px, py - 1024);
    // A relative slope of 1/gain per tile or more is the full 1024, so only the smaller ones are scaled: there (east - west) * gain is
    // below east + west + 1, under 2^24, and its product with 1024 stays exact far below 2^53.
    const sx = se + sw + 1;
    const sy = ss + sn + 1;
    const ex = (se - sw) * gain;
    const ey = (ss - sn) * gain;
    const gx = ex >= sx ? 1024 : ex <= -sx ? -1024 : Math.trunc((ex * 1024) / sx);
    const gy = ey >= sy ? 1024 : ey <= -sy ? -1024 : Math.trunc((ey * 1024) / sy);
    this.slope[0] = gx;
    this.slope[1] = gy;
    return this.slope;
  }

  // ------------------------------------------------------------------ step 1: mechanics

  /** Add the spring between a and b with the given rest length and stiffness, to a and (opposite) to b. */
  private spring(a: number, b: number, rest: number, k: number, sub: number): void {
    let dx = this.dlt(this.x[a], this.x[b]);
    let dy = this.dlt(this.y[a], this.y[b]);
    // Past four bond lengths the stretch is capped by scaling both components, so the pull keeps its direction.
    const big = Math.max(Math.abs(dx), Math.abs(dy));
    if (big > 4 * L) {
      dx = Math.trunc((dx * 4 * L) / big);
      dy = Math.trunc((dy * 4 * L) / big);
    }
    const d = isqrt(dx * dx + dy * dy);
    this.applySpring(a, b, dx, dy, d, rest, k, sub);
  }

  private applySpring(a: number, b: number, dx: number, dy: number, d: number, rest: number, k: number, sub: number): void {
    let nx: number;
    let ny: number;
    if (d === 0) {
      const h = this.pairHash(a, b, CH_PAIR + sub) & 1023;
      const flip = this.cid[a] < this.cid[b] ? 1 : -1;
      nx = Math.trunc((-rest * softRoamCos(h) * flip) / SOFT_ONE);
      ny = Math.trunc((-rest * softRoamSin(h) * flip) / SOFT_ONE);
    } else {
      nx = Math.trunc(((d - rest) * dx) / d);
      ny = Math.trunc(((d - rest) * dy) / d);
    }
    const f = Math.trunc((nx * k) / 256);
    const g = Math.trunc((ny * k) / 256);
    this.fx[a] += f;
    this.fy[a] += g;
    this.fx[b] -= f;
    this.fy[b] -= g;
  }

  private mechanics(): void {
    const cfg = this.cfg;
    const S = cfg.substeps;
    const live = this.live;
    const N = this.liveN;
    const keep = cfg.keep;
    const vMax = cfg.vMax;
    const thrustMax = cfg.thrustMax;
    const x = this.x;
    const y = this.y;
    for (let sub = 0; sub < S; sub++) {
      const lastSub = sub === S - 1;
      this.buildBuckets();
      this.contN.fill(0, 0, this.labelHi + 1);
      this.contHead.fill(-1, 0, this.labelHi + 1);
      this.contPool = 0;
      this.bodyPush.fill(0, 0, this.labelHi + 1);
      for (let q = 0; q < N; q++) {
        const c = live[q];
        if (this.tx[c] !== 0 || this.ty[c] !== 0) this.bodyPush[this.body[c]] = 1;
      }
      this.fx.fill(0);
      this.fy.fill(0);
      for (let q = 0; q < N; q++) {
        const c = live[q];
        const m = this.mother[c];
        if (m >= 0) this.spring(c, m, this.pulseOn ? this.flexed(c, m, L) : L, cfg.kBond, sub);
        for (let k = 0; k < 4; k++) {
          const p = this.braceTo[c * 4 + k];
          if (p >= 0 && this.cid[c] < this.cid[p]) this.spring(c, p, this.pulseOn ? this.flexed(c, p, this.braceRest[c * 4 + k]) : this.braceRest[c * 4 + k], cfg.kBrace, sub);
        }
      }
      const nextRun = lastSub ? new Map<number, { ca: number; cb: number; run: number }>() : null;
      for (let q = 0; q < N; q++) {
        const a = live[q];
        const ca = this.cid[a];
        const ts = this.around(x[a] >>> 10, y[a] >>> 10);
        for (let ti = 0; ti < 9; ti++) {
          for (let b = this.head[ts[ti]]; b >= 0; b = this.nextInTile[b]) {
            if (this.cid[b] <= ca) continue;
            if (this.depthN > 0 && this.level[a] !== this.level[b] && this.body[a] !== this.body[b]) continue;
            const dx = this.dlt(x[a], x[b]);
            if (dx >= D || dx <= -D) continue;
            const dy = this.dlt(y[a], y[b]);
            if (dy >= D || dy <= -D) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 >= D * D) continue;
            const d = isqrt(d2);
            if (this.mother[a] !== b && this.mother[b] !== a && !this.hasBrace(a, b)) this.applySpring(a, b, dx, dy, d, D, cfg.kRep, sub);
            if (this.body[a] !== this.body[b]) {
              this.addContact(a, b, dx, dy, d2, d, sub);
              if (nextRun !== null && d < D - (D >>> 2)) {
                const key = a * this.cap + b;
                const prev = this.pairRun.get(key);
                nextRun.set(key, { ca, cb: this.cid[b], run: prev !== undefined && prev.ca === ca && prev.cb === this.cid[b] ? prev.run + 1 : 1 });
              }
            }
          }
        }
      }
      if (nextRun !== null) this.pairRun = nextRun;
      if (this.gripN > 0) this.gripPull(sub);
      // Thrust, with the part pointing into another body's cell removed, from the positions at the start of the substep.
      for (let q = 0; q < N; q++) {
        const c = live[q];
        let hx = 0;
        let hy = 0;
        if (this.tx[c] !== 0 || this.ty[c] !== 0) {
          hx = Math.trunc((this.tx[c] * thrustMax) / 1024);
          hy = Math.trunc((this.ty[c] * thrustMax) / 1024);
          if (hx !== 0 || hy !== 0) {
            const r = this.projectOut(c, hx, hy, CH_PAIR + sub, 0);
            hx = r[0];
            hy = r[1];
          }
        }
        this.hx[c] = hx;
        this.hy[c] = hy;
      }
      // Then velocity and position.
      for (let q = 0; q < N; q++) {
        const c = live[q];
        const hx = this.hx[c];
        const hy = this.hy[c];
        let vx = Math.trunc((this.vx[c] * keep) / 256) + this.fx[c] + hx;
        let vy = Math.trunc((this.vy[c] * keep) / 256) + this.fy[c] + hy;
        // Many overlapping neighbours can sum to more than the clamp by far; anything over 4 vMax is clamped anyway, so halve it down first and no product below can pass 2^31.
        for (let big = Math.max(Math.abs(vx), Math.abs(vy)); big > 16384; big = Math.trunc(big / 2)) { vx = Math.trunc(vx / 2); vy = Math.trunc(vy / 2); }
        if (this.bodyPush[this.body[c]] !== 0 && this.contN[this.body[c]] > 0 && (vx !== 0 || vy !== 0)) {
          // A body that thrusts does not drive into another by momentum either: what presses into a contact is taken off the velocity.
          // A cell that is itself pressed deep into another body is let out by its own contacts only: a light touch on the far side of its body must not hold it in the overlap.
          let own = 0;
          for (let i = this.contHead[this.body[c]]; i >= 0; i = this.contNext[i]) if (this.contCa[i] === this.cid[c] && this.contD2[i] < SHALLOW2) { own = this.cid[c]; break; }
          const r = this.projectOut(c, vx, vy, CH_PAIR + 16 + sub, SHALLOW2, own);
          vx = r[0];
          vy = r[1];
        }
        const s2 = vx * vx + vy * vy;
        let clamped = false;
        if (s2 > vMax * vMax) {
          let s = isqrt(s2);
          if (s * s < s2) s++;
          vx = Math.trunc((vx * vMax) / s);
          vy = Math.trunc((vy * vMax) / s);
          clamped = true;
        }
        this.vx[c] = vx;
        this.vy[c] = vy;
        const cx = this.carryX[c] + vx;
        const mx = Math.trunc(cx / 16);
        this.carryX[c] = cx - mx * 16;
        const cy = this.carryY[c] + vy;
        const my = Math.trunc(cy / 16);
        this.carryY[c] = cy - my * 16;
        x[c] = this.wrap(x[c] + mx);
        y[c] = this.wrap(y[c] + my);
        if (lastSub) this.clampRun[c] = clamped ? (this.clampRun[c] < 65535 ? this.clampRun[c] + 1 : 65535) : 0;
      }
    }
  }

  /** Record the contact of a and b (different bodies, within D) for both bodies; each keeps all of them. */
  private addContact(a: number, b: number, dx: number, dy: number, d2: number, d: number, sub: number): void {
    let nx: number;
    let ny: number;
    if (d === 0) {
      // a has the lower cid here; the same draw as the repulsion between the two.
      const h = this.pairHash(a, b, CH_PAIR + sub) & 1023;
      nx = softRoamCos(h);
      ny = softRoamSin(h);
    } else {
      // A unit vector even when the integer distance is coarse (a cell a unit or two away): the length is taken at 8 or 64 times the scale.
      const sc = d2 < 16384 ? 64 : 8;
      const d8 = isqrt(d2 * sc * sc);
      nx = Math.trunc((dx * sc * SOFT_ONE) / d8);
      ny = Math.trunc((dy * sc * SOFT_ONE) / d8);
    }
    this.pushContact(this.body[a], d2, this.cid[a], this.cid[b], nx, ny);
    this.pushContact(this.body[b], d2, this.cid[b], this.cid[a], -nx, -ny);
  }

  private pushContact(label: number, d2: number, cc: number, co: number, nx: number, ny: number): void {
    if (this.contPool === this.contD2.length) this.growContacts();
    const at = this.contPool++;
    this.contN[label]++;
    this.contNext[at] = this.contHead[label];
    this.contHead[label] = at;
    this.contD2[at] = d2;
    this.contCa[at] = cc;
    this.contCb[at] = co;
    this.contNx[at] = nx;
    this.contNy[at] = ny;
  }

  private growContacts(): void {
    const n = this.contD2.length * 2;
    const grow = <T extends Int32Array | Uint32Array>(a: T): T => { const b = new (a.constructor as new (n: number) => T)(n); b.set(a); return b; };
    this.contNext = grow(this.contNext);
    this.contD2 = grow(this.contD2);
    this.contCa = grow(this.contCa);
    this.contCb = grow(this.contCb);
    this.contNx = grow(this.contNx);
    this.contNy = grow(this.contNy);
    this.tieX = new Int32Array(n);
    this.tieY = new Int32Array(n);
  }

  private readonly proj = new Int32Array(2);
  private tieX: Int32Array;
  private tieY: Int32Array;
  /**
   * A thrust or velocity (hx, hy) with what presses into other bodies removed. A body is blocked as a whole: the contacts of all its
   * cells (the unit normals from a cell of this body to a cell of another within D) apply to every cell's thrust, so
   * trailing cells cannot push a leading cell through a wall. The result is the thrust nearest the wanted one that
   * presses into no contact (to about two units), found from the set of contacts, so no order of contacts can matter:
   * the wanted thrust if it presses on nothing, else the wanted thrust slid along one contact's tangent when that
   * presses on no other, else none.
   */
  private projectOut(c: number, hx: number, hy: number, ch: number, minD2: number, own = 0): Int32Array {
    const l = this.body[c];
    const first = this.contHead[l];
    const next = this.contNext;
    const nxs = this.contNx;
    const nys = this.contNy;
    this.proj[0] = hx;
    this.proj[1] = hy;
    let pressing = false;
    const d2s = this.contD2;
    const cas = this.contCa;
    for (let i = first; i >= 0; i = next[i]) if (d2s[i] >= minD2 && (own === 0 || cas[i] === own) && hx * nxs[i] + hy * nys[i] >= SOFT_ONE) { pressing = true; break; }
    if (!pressing) return this.proj;
    let bestS = -1;
    let ties = 0;
    for (let i = first; i >= 0; i = next[i]) {
      if (d2s[i] < minD2 || (own !== 0 && cas[i] !== own)) continue;
      const s = Math.trunc((hx * nxs[i] + hy * nys[i]) / SOFT_ONE);
      if (s <= 0) continue;
      if (bestS >= 0 && s > bestS) continue;
      const tx = hx - Math.trunc((s * nxs[i]) / SOFT_ONE);
      const ty = hy - Math.trunc((s * nys[i]) / SOFT_ONE);
      let ok = true;
      for (let j = first; j >= 0; j = next[j]) if (d2s[j] >= minD2 && (own === 0 || cas[j] === own) && tx * nxs[j] + ty * nys[j] >= 3 * SOFT_ONE) { ok = false; break; }
      if (!ok) continue;
      if (bestS < 0 || s < bestS) { bestS = s; ties = 0; }
      let dup = false;
      for (let k = 0; k < ties; k++) if (this.tieX[k] === tx && this.tieY[k] === ty) dup = true;
      if (!dup) { this.tieX[ties] = tx; this.tieY[ties] = ty; ties++; }
    }
    if (ties === 0) {
      // Boxed in by contacts on every side: a cell that is itself pressed deep (own) is let out by what pushes it (the overlap decompresses); any other is held.
      this.proj[0] = own !== 0 ? hx : 0;
      this.proj[1] = own !== 0 ? hy : 0;
      return this.proj;
    }
    let pick = 0;
    if (ties > 1) {
      // Equally near slides: put them in a fixed order by value and let a hash of this cell and substep choose.
      for (let i = 1; i < ties; i++) {
        const vx = this.tieX[i];
        const vy = this.tieY[i];
        let j = i - 1;
        while (j >= 0 && (this.tieX[j] > vx || (this.tieX[j] === vx && this.tieY[j] > vy))) { this.tieX[j + 1] = this.tieX[j]; this.tieY[j + 1] = this.tieY[j]; j--; }
        this.tieX[j + 1] = vx;
        this.tieY[j + 1] = vy;
      }
      pick = roamHash(this.cfg.seed, this.step, this.cid[c], ch) % ties;
    }
    this.proj[0] = this.tieX[pick];
    this.proj[1] = this.tieY[pick];
    return this.proj;
  }

  // ------------------------------------------------------------------ step 2: life

  private eat(): void {
    const cap4 = 4 * this.cfg.birthStore;
    const ask = this.askTile;
    ask.fill(0);
    const seed = this.cfg.seed;
    const t = this.step;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const room = cap4 > this.store[c] ? cap4 - this.store[c] : 0;
      let bite = this.biteN;
      // With depth the ground food is on the floor: only level 0 cells eat it.
      if (this.depthN > 0 && this.level[c] !== 0) bite = 0;
      else if (this.kinds && this.kind[c] !== KIND_PLAIN) {
        // Only plain cells and one-cell bodies eat; a one-cell shell takes shellBite of the bite, rounded by a hash.
        if (this.kind[c] === KIND_LEAF || this.bodySize[this.body[c]] > 1) bite = 0;
        else if (this.kind[c] === KIND_SHELL && this.shellBiteQ16 < 65536) {
          const part = this.biteN * this.shellBiteQ16;
          bite = (part >>> 16) + ((roamHash(seed, t, this.cid[c], CH_BITE) & 0xffff) < (part & 0xffff) ? 1 : 0);
        }
      }
      const a = room < bite ? room : bite;
      this.askCell[c] = a;
      if (a > 0) ask[(this.y[c] >>> 10) * this.size + (this.x[c] >>> 10)] += a;
    }
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const a = this.askCell[c];
      this.gotCell[c] = 0;
      if (a === 0) continue;
      const tile = (this.y[c] >>> 10) * this.size + (this.x[c] >>> 10);
      const f = this.food[tile];
      this.gotCell[c] = ask[tile] > f ? Math.floor((a * f) / ask[tile]) : a;
    }
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const g = this.gotCell[c];
      if (g === 0) continue;
      this.food[(this.y[c] >>> 10) * this.size + (this.x[c] >>> 10)] -= g;
      this.store[c] += g;
    }
    if (this.leafOn) this.leafStage(cap4);
  }

  /** The light on tile (tx, ty) now. */
  light(tx: number, ty: number, step = this.step): number {
    return softRoamLight(this.cfg, tx, ty, step);
  }

  /**
   * Leaf income (see the header). Each leaf cell asks `SR(leafQ * light * exposed, 4 * 256 * Q * n)` (`n` the leaf cells on its tile, at most 16),
   * capped by its room; the reservoir as it stands pays every ask, or a proportional share of it when it is short. Needs `offsetMap` current.
   */
  private leafStage(cap4: number): void {
    const seed = this.cfg.seed;
    const t = this.step;
    const size = this.size;
    const cells = this.leafCells;
    const asks = this.leafAsks;
    const onTile = this.leafOnTile;
    cells.length = 0;
    asks.length = 0;
    this.leafPaid.fill(0);
    const Lv = this.depthN;
    const lvc = this.lvlCount;
    if (Lv > 0) lvc.fill(0);
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      if (Lv > 0) lvc[((this.y[c] >>> 10) * size + (this.x[c] >>> 10)) * Lv + this.level[c]]++;
      if (this.kind[c] !== KIND_LEAF) continue;
      cells.push(c);
      onTile[Lv > 0 ? ((this.y[c] >>> 10) * size + (this.x[c] >>> 10)) * Lv + this.level[c] : (this.y[c] >>> 10) * size + (this.x[c] >>> 10)]++;
    }
    if (cells.length === 0) return;
    const m = this.offsetMap;
    let total = 0;
    for (const c of cells) {
      const tx = this.x[c] >>> 10;
      const ty = this.y[c] >>> 10;
      let exposed = 4;
      for (let d = 0; d < 4; d++) if (m.has(this.offKey(this.body[c], this.gx[c] + DX[d], this.gy[c] + DY[d]))) exposed--;
      const n = Math.min(onTile[Lv > 0 ? (ty * size + tx) * Lv + this.level[c] : ty * size + tx], LEAF_MAX_SHARE);
      const num = this.leafQ * (Lv > 0 ? this.lightOn(tx, ty, this.level[c], t) : softRoamLight(this.cfg, tx, ty, t)) * exposed;
      const den = 4 * 256 * LEAF_Q * n;
      let ask = Math.floor(num / den) + (roamHash(seed, t, this.cid[c], CH_LEAF) % den < num % den ? 1 : 0);
      const room = cap4 > this.store[c] ? cap4 - this.store[c] : 0;
      if (ask > room) ask = room;
      asks.push(ask);
      total += ask;
    }
    const pool = this.leafPoolQ8 >= 0;
    const R = pool ? this.leafPool : this.reservoir;
    let paidAll = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const ask = asks[i];
      const paid = total <= R ? ask : Math.floor((ask * R) / total);
      this.store[c] += paid;
      this.leafPaid[c] = paid;
      paidAll += paid;
      onTile[Lv > 0 ? ((this.y[c] >>> 10) * size + (this.x[c] >>> 10)) * Lv + this.level[c] : (this.y[c] >>> 10) * size + (this.x[c] >>> 10)] = 0;
    }
    if (pool) this.leafPool -= paidAll;
    else this.reservoir -= paidAll;
    this.leafIncome += paidAll;
  }

  /** With depth, in the leaf stage (needs `lvlCount` current): the light on a level of a tile, dimmed by the levels over it and shaded by the cells above. */
  private lightOn(tx: number, ty: number, lv: number, step: number): number {
    const Lv = this.depthN;
    const dim = 256 - (Lv - 1 - lv) * this.depthDimQ8;
    let lt = dim > 0 ? (softRoamLight(this.cfg, tx, ty, step) * dim) >> 8 : 0;
    let above = 0;
    const base = (ty * this.size + tx) * Lv;
    for (let k = lv + 1; k < Lv; k++) above += this.lvlCount[base + k];
    if (above > SHADE_MAX) above = SHADE_MAX;
    for (let i = 0; i < above; i++) lt = (lt * (256 - this.depthShadeQ8)) >> 8;
    return lt;
  }

  private upkeep(): void {
    const seed = this.cfg.seed;
    const t = this.step;
    const m = this.offsetMap;
    // With `winterCost`: an extra cost in proportion to how far the season's light is below midsummer's (the same for every cell this step).
    const winterQ16 = this.winterQ16 > 0 ? Math.floor((this.winterQ16 * (256 - this.seasonLight(t))) / 256) : 0;
    const pool = this.leafPoolQ8 >= 0;
    let paidAll = 0;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      let exposed = 4;
      for (let d = 0; d < 4; d++) if (m.has(this.offKey(this.body[c], this.gx[c] + DX[d], this.gy[c] + DY[d]))) exposed--;
      const side = this.kinds && this.kind[c] === KIND_SHELL ? this.shellSideQ16[this.tough[c]] : this.leakSideQ16;
      const costQ16 = exposed * side + this.leakCellQ16 + winterQ16;
      let pay = (costQ16 >>> 16) + ((roamHash(seed, t, this.cid[c], CH_UPKEEP) & 0xffff) < (costQ16 & 0xffff) ? 1 : 0);
      if (pay > this.store[c]) pay = this.store[c];
      this.store[c] -= pay;
      if (pool) paidAll += pay;
      else this.reservoir += pay;
    }
    if (pool) {
      // A share of all that was paid goes to the leaves' pool, up to its cap; the rest to the reservoir. paidAll is at most 16384 cells times about 20, under 2^19, so the product is under 2^27.
      let toPool = Math.floor((paidAll * this.leafPoolQ8) / 256);
      const room = this.leafPoolMaxN > this.leafPool ? this.leafPoolMaxN - this.leafPool : 0;
      if (toPool > room) toPool = room;
      this.leafPool += toPool;
      this.reservoir += paidAll - toPool;
    }
  }

  /** The year's term of the light at `step`, 0 to 256 (256 without a year): the day band left out. */
  private seasonLight(step: number): number {
    const cfg = this.cfg;
    if (cfg.year === undefined) return 256;
    const w = Math.round((cfg.winter ?? 0.25) * 256);
    return w + (((256 - w) * tri10(phase10(step, cfg.year))) >> 8);
  }

  // ------------------------------------------------------------------ touch and grip

  /** True while a body is within `seal` steps of release (the same test as the dash in `commands`). */
  private sealedCell(c: number): boolean {
    // `since` is a Uint32: a release at step 2^32 - 1 stores 0, so the age is taken modulo 2^32.
    return ((this.step - this.since[this.bodyRoot[this.body[c]]]) >>> 0) < this.sealN;
  }

  /**
   * Pick each cell's contacts: of the cells of other bodies within 1.25 D (neither body sealed), the four of lowest pair-hash rank
   * (the hash is symmetric in the two cids and fresh each step; a tie is settled by a second symmetric draw, then by the lower cid). A pair is a contact only when it is in
   * both cells' lists, so no cell ever has more than four. Needs buckets, labels and `bodyRoot` current.
   */
  private selectContacts(): void {
    const sel = this.selB;
    const selH = this.selH;
    sel.fill(-1);
    const x = this.x;
    const y = this.y;
    for (let q = 0; q < this.liveN; q++) {
      const a = this.live[q];
      if (this.sealedCell(a)) continue;
      const base = a * TOUCH_CAP;
      const ts = this.around25(x[a] >>> 10, y[a] >>> 10);
      for (let ti = 0; ti < 25; ti++) {
        for (let b = this.head[ts[ti]]; b >= 0; b = this.nextInTile[b]) {
          if (b === a || this.body[b] === this.body[a]) continue;
          if (this.depthN > 0 && this.level[a] !== this.level[b]) continue;
          const dx = this.dlt(x[a], x[b]);
          if (dx > TOUCH_R || dx < -TOUCH_R) continue;
          const dy = this.dlt(y[a], y[b]);
          if (dy > TOUCH_R || dy < -TOUCH_R) continue;
          if (dx * dx + dy * dy > TOUCH_R2) continue;
          if (this.sealedCell(b)) continue;
          const h = this.pairHash(a, b, CH_TOUCH);
          const last = sel[base + TOUCH_CAP - 1];
          if (last >= 0 && !this.ranksAhead(a, b, h, last, selH[base + TOUCH_CAP - 1])) continue;
          let k = TOUCH_CAP - 1;
          while (k > 0) {
            const p = sel[base + k - 1];
            if (p >= 0 && !this.ranksAhead(a, b, h, p, selH[base + k - 1])) break;
            sel[base + k] = p;
            selH[base + k] = selH[base + k - 1];
            k--;
          }
          sel[base + k] = b;
          selH[base + k] = h;
        }
      }
    }
  }

  private inContacts(a: number, b: number): boolean {
    const o = a * TOUCH_CAP;
    return this.selB[o] === b || this.selB[o + 1] === b || this.selB[o + 2] === b || this.selB[o + 3] === b;
  }

  /** The chosen contacts as pairs (pairA[i], pairB[i]) with cid[pairA] < cid[pairB], each once. */
  private collectPairs(): void {
    const pa = this.pairA;
    const pb = this.pairB;
    pa.length = 0;
    pb.length = 0;
    for (let q = 0; q < this.liveN; q++) {
      const a = this.live[q];
      for (let k = 0; k < TOUCH_CAP; k++) {
        const b = this.selB[a * TOUCH_CAP + k];
        if (b < 0) break;
        if (this.cid[a] < this.cid[b] && this.inContacts(b, a)) { pa.push(a); pb.push(b); }
      }
    }
  }

  /**
   * Whether cell x could act on cell y by touch: the one rule touch feeding, hits, grip, sight and fear all ask. Different bodies, neither
   * sealed, x's body at least twice y's in cells; with kinds x is a mouth and y is not a shell (unless crack is set, when a shell can be hit);
   * not the same founder family under `truce` (family 0 is never in truce); not a body that holds a mouth under `jaws`. It reads the labels,
   * sizes and kinds of the stage it is called in.
   */
  private canAct(xc: number, yc: number): boolean {
    const bx = this.body[xc];
    const by = this.body[yc];
    if (bx === by) return false;
    if (this.sealedCell(xc) || this.sealedCell(yc)) return false;
    if (this.bodySize[bx] < 2 * this.bodySize[by]) {
      // With `pack`: or `pack` prey cells for each mouth of x's body in touch with y's body (in sight and fear: each mouth x's body holds).
      if (this.packN === 0) return false;
      const m = this.packUseTouch ? (this.packTouch.get(bx * 65536 + by) ?? 0) : this.bodyMouthN[bx];
      if (this.packN * m < this.bodySize[by]) return false;
    }
    if (this.kinds) {
      if (this.kind[xc] !== KIND_MOUTH) return false;
      if (this.kind[yc] === KIND_SHELL && this.crackN === 0) return false;
    }
    if (this.truceOn && this.fam[xc] !== 0 && this.fam[xc] === this.fam[yc]) return false;
    if (this.jawsOn && this.bodyMouth[by] !== 0) return false;
    return true;
  }

  /** With `jaws`: which bodies hold a mouth now (labels and kinds as the step starts). */
  private markMouths(): void {
    if (this.packN > 0) {
      this.bodyMouthN.fill(0, 0, this.labelHi + 1);
      for (let q = 0; q < this.liveN; q++) {
        const c = this.live[q];
        if (this.kind[c] === KIND_MOUTH) this.bodyMouthN[this.body[c]]++;
      }
    }
    if (!this.jawsOn) return;
    this.bodyMouth.fill(0, 0, this.labelHi + 1);
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      if (this.kind[c] === KIND_MOUTH) this.bodyMouth[this.body[c]] = 1;
    }
  }

  /**
   * With `pack`, from the chosen pairs (pairA, pairB) of this stage or substep and before any acts: for each ordered pair of bodies (x, y) the
   * number of distinct mouth cells of x in a chosen pair with a cell of y. Counts, so the order the pairs were found in does not matter.
   */
  private countPackTouch(): void {
    const m = this.packTouch;
    m.clear();
    if (this.packN === 0) return;
    const seen = new Set<number>();
    const add = (x: number, y: number): void => {
      if (this.kind[x] !== KIND_MOUTH) return;
      const key = this.body[x] * 65536 + this.body[y];
      // One mouth counts once per prey body: a key of (mouth slot, prey body).
      const k2 = x * 65536 + this.body[y];
      if (seen.has(k2)) return;
      seen.add(k2);
      m.set(key, (m.get(key) ?? 0) + 1);
    };
    for (let i = 0; i < this.pairA.length; i++) { add(this.pairA[i], this.pairB[i]); add(this.pairB[i], this.pairA[i]); }
  }

  /**
   * A second symmetric pair draw built another way (nested, like `pairTie`): `pairHash` is keyed on the pair alone, so two pairs whose keys
   * collide collide on every channel, and a second draw on another channel of the same key would not break the tie.
   */
  private pairHash2(a: number, b: number, ch: number): number {
    const ca = this.cid[a];
    const cb = this.cid[b];
    const lo = ca < cb ? ca : cb;
    const hi = ca < cb ? cb : ca;
    const inner = roamHash(this.cfg.seed, this.step, lo, ch);
    return roamHash(this.cfg.seed, this.step, (Math.imul(hi ^ 0x5bd1e995, 0x27d4eb2f) + inner) >>> 0, ch);
  }

  /**
   * The cell `c` steers by, within `range` tiles, or -1: for sight (`fear` false) the nearest live cell y with canAct(c, y); for fear the nearest
   * live cell x with canAct(x, c). Lowest by squared distance, then the pair draw on `chA`, then the second pair draw on `chB`, then the cid.
   * Needs current buckets and labels.
   */
  private nearestTarget(c: number, range: number, fear: boolean, chA: number, chB: number): number {
    const lim = range * D;
    const px = this.x[c];
    const py = this.y[c];
    const s = this.size;
    const r = range + 1;
    const rev = this._reverseScan;
    let best = -1;
    let bestD2 = 0;
    const consider = (b: number): void => {
      if (b === c) return;
      const dx = this.dlt(px, this.x[b]);
      if (dx > lim || dx < -lim) return;
      const dy = this.dlt(py, this.y[b]);
      if (dy > lim || dy < -lim) return;
      if (!(fear ? this.canAct(b, c) : this.canAct(c, b))) return;
      let d2 = dx * dx + dy * dy;
      if (!fear && this.crowdN > 0) d2 += this.crowdAt(b, this.body[c]) * this.crowdN * this.crowdN * D * D;
      let take = best < 0 || d2 < bestD2;
      if (!take && d2 === bestD2) {
        const h = this.pairHash(c, b, chA);
        const hb = this.pairHash(c, best, chA);
        if (h !== hb) take = h < hb;
        else {
          const g = this.pairHash2(c, b, chB);
          const gb = this.pairHash2(c, best, chB);
          take = g !== gb ? g < gb : this.cid[b] < this.cid[best];
        }
      }
      if (take) { best = b; bestD2 = d2; }
    };
    this.lastScore = 0;
    const scan = (tile: number): void => { for (let b = this.head[tile]; b >= 0; b = this.nextInTile[b]) consider(b); };
    if (2 * r + 1 >= s) {
      // The window wraps round the torus: every tile once.
      for (let i = 0; i < this.n; i++) scan(rev ? this.n - 1 - i : i);
    } else {
      const tx = px >>> 10;
      const ty = py >>> 10;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) scan(this.tileAt(tx + (rev ? -j : j), ty + (rev ? -i : i)));
    }
    this.lastScore = bestD2;
    return best;
  }

  /** With `crowd`: mouth cells of bodies other than `own` within 1.25 D of cell `b` (not b itself), at most 8, from the buckets of now. */
  private crowdAt(b: number, own: number): number {
    const ts = this.around25(this.x[b] >>> 10, this.y[b] >>> 10);
    let n = 0;
    for (let ti = 0; ti < 25; ti++) {
      for (let o = this.head[ts[ti]]; o >= 0; o = this.nextInTile[o]) {
        if (o === b || !this.alive[o] || this.kind[o] !== KIND_MOUTH || this.body[o] === own) continue;
        if (this.depthN > 0 && this.level[o] !== this.level[b]) continue;
        const dx = this.dlt(this.x[b], this.x[o]);
        if (dx > TOUCH_R || dx < -TOUCH_R) continue;
        const dy = this.dlt(this.y[b], this.y[o]);
        if (dy > TOUCH_R || dy < -TOUCH_R) continue;
        if (dx * dx + dy * dy <= TOUCH_R2 && ++n === 8) return 8;
      }
    }
    return n;
  }

  /** Test only: the commands stage on its own, from the labels and buckets of now. */
  _commandsOnly(): void {
    this.rebuildLive();
    this.labelBodies();
    this.markMouths();
    this.commands();
  }

  /** What touch does to the prey cell: its store is drained (not a shell), or it takes a hit (a shell, with crack set). */
  private drainable(yc: number): boolean {
    return !this.kinds || this.kind[yc] !== KIND_SHELL;
  }

  private hittable(yc: number): boolean {
    return this.kinds && this.crackN > 0 && this.kind[yc] === KIND_SHELL;
  }

  /**
   * Touch, once a step, from the stores, sizes and kinds as they stand when it starts (nothing it changes is read back):
   * a mouth of a body at least twice the other's size takes min(drain, floor(preyStore / takers)) from a plain or mouth cell,
   * `takers` being the mouths pressing that cell; a mouth pressing a shell is one hit; a shell becomes plain at crack << tough hits
   * and is fed on from the next step.
   */
  private touch(): void {
    const t = this.step;
    this.selectContacts();
    this.collectPairs();
    const pa = this.pairA;
    const pb = this.pairB;
    if (pa.length === 0) return;
    this.countPackTouch();
    this.packUseTouch = this.packN > 0;
    this.touchStore.set(this.store);
    const n = pa.length;
    const takeX: number[] = [];
    const takeY: number[] = [];
    const hitY: number[] = [];
    for (let i = 0; i < n; i++) {
      let xc = pa[i];
      let yc = pb[i];
      if (!this.canAct(xc, yc)) { xc = pb[i]; yc = pa[i]; if (!this.canAct(xc, yc)) continue; }
      // With `pack` two bodies can each be able to act on the other: then neither does (a standoff).
      else if (this.packN > 0 && this.canAct(yc, xc)) continue;
      if (this.drainable(yc)) { takeX.push(xc); takeY.push(yc); this.takers[yc]++; }
      else if (this.hittable(yc)) { hitY.push(yc); this.hitCount[yc]++; }
    }
    const feedsFrom = this.events.feeds.length;
    for (let i = 0; i < takeX.length; i++) {
      const xc = takeX[i];
      const yc = takeY[i];
      const each = Math.min(this.drainN, Math.floor(this.touchStore[yc] / this.takers[yc]));
      if (each === 0) continue;
      this.store[yc] -= each;
      this.store[xc] += each;
      this.drained += each;
      this.lastDrainStep[xc] = t;
      this.lastDrainStep[yc] = t;
      this.events.feeds.push({ ms: xc, ps: yc, mc: this.cid[xc], pc: this.cid[yc] });
    }
    // Listed by serial, not by the slots the pairs were found in.
    if (this.events.feeds.length - feedsFrom > 1) {
      const mine = this.events.feeds.splice(feedsFrom);
      mine.sort((a, b) => a.mc - b.mc || a.pc - b.pc);
      for (const f of mine) this.events.feeds.push(f);
    }
    for (const yc of takeY) this.takers[yc] = 0;
    this.packUseTouch = false;
    if (hitY.length > 0) {
      const shells: number[] = [];
      for (const yc of hitY) if (this.hitCount[yc] > 0) { if (shells.indexOf(yc) < 0) shells.push(yc); }
      shells.sort((a, b) => this.cid[a] - this.cid[b]);
      for (const yc of shells) {
        const h = this.hits[yc] + this.hitCount[yc];
        this.hitCount[yc] = 0;
        this.lastHitStep[yc] = t;
        this.events.hits.push({ s: yc, c: this.cid[yc] });
        if (h >= Math.min(60000, this.crackN << this.tough[yc])) {
          this.kind[yc] = KIND_PLAIN;
          this.hits[yc] = 0;
          this.cracked++;
          this.events.cracks.push({ x: this.x[yc], y: this.y[yc], lv: this.level[yc] });
        } else this.hits[yc] = h;
      }
    }
  }

  /**
   * Grip: a mouth in touch with a cell it could act on is pulled toward contact distance D by a spring of stiffness grip/256 while
   * the two are between D and 1.25 D apart (nearer, the cells' own repulsion rules). The same integer is added to one and taken from
   * the other, so momentum is kept, and nothing is linked: labels come from mother links alone. Shells count as prey when they can be hit.
   * Uses the touch contacts (four a cell), found afresh from this substep's positions.
   */
  private gripPull(sub: number): void {
    this.selectContacts();
    this.collectPairs();
    const pa = this.pairA;
    const pb = this.pairB;
    this.countPackTouch();
    this.packUseTouch = this.packN > 0;
    for (let i = 0; i < pa.length; i++) {
      let xc = pa[i];
      let yc = pb[i];
      if (!this.canAct(xc, yc)) { xc = pb[i]; yc = pa[i]; if (!this.canAct(xc, yc)) continue; }
      // With `pack` two bodies can each be able to act on the other: then neither does (a standoff).
      else if (this.packN > 0 && this.canAct(yc, xc)) continue;
      const dx = this.dlt(this.x[xc], this.x[yc]);
      const dy = this.dlt(this.y[xc], this.y[yc]);
      const d2 = dx * dx + dy * dy;
      if (d2 <= D * D) continue;
      this.applySpring(xc, yc, dx, dy, isqrt(d2), D, this.gripN, sub);
    }
    this.packUseTouch = false;
  }

  /** Test only: the contacts touch would use now, as sorted "lower cid,higher cid" strings (the same whatever slots cells sit in). */
  _touchPairs(): string[] {
    this.rebuildLive();
    this.labelBodies();
    this.buildBuckets();
    this.selectContacts();
    this.collectPairs();
    const out: string[] = [];
    for (let i = 0; i < this.pairA.length; i++) out.push(`${this.cid[this.pairA[i]]},${this.cid[this.pairB[i]]}`);
    return out.sort();
  }

  private flowAlongLinks(): void {
    const snap = this.flowSnap;
    for (let q = 0; q < this.liveN; q++) snap[this.live[q]] = this.store[this.live[q]];
    const qf = this.flowQ10;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const m = this.mother[c];
      if (m < 0) continue;
      const sa = snap[c];
      const sb = snap[m];
      const diff = sa > sb ? sa - sb : sb - sa;
      const amount = Math.floor((diff * qf) / 1024);
      if (amount === 0) continue;
      if (sa > sb) { this.store[c] -= amount; this.store[m] += amount; }
      else { this.store[m] -= amount; this.store[c] += amount; }
      this.flowed += amount;
    }
  }

  /** All deaths at once, then relabel and drop braces that now cross bodies. */
  private die(): void {
    const seed = this.cfg.seed;
    const t = this.step;
    const dead: number[] = [];
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const wore = this.wearQ32 > 0 && roamHash(seed, t, this.cid[c], CH_WEAR) < this.wearQ32;
      if (this.store[c] < this.cfg.minStore || wore) {
        if (wore && this.store[c] >= this.cfg.minStore) this.worn++;
        dead.push(c);
        this.dying[c] = 1;
      }
    }
    if (dead.length === 0) return;
    // Settled in cid order, so the events (and the order slots are freed in) do not follow the slots.
    dead.sort((a, b) => this.cid[a] - this.cid[b]);
    // Modes reset, read with every link in place: a mother returns to the earliest mode that made a lost daughter; a
    // cell whose mother died starts its plan again from mode 0 (and the second rule wins when both apply).
    const back: number[] = [];
    for (const c of dead) {
      const m = this.mother[c];
      if (m >= 0 && !this.dying[m]) {
        if (this.backMode[m] === 0) { back.push(m); this.backMode[m] = this.made[c] + 1; }
        else if (this.made[c] + 1 < this.backMode[m]) this.backMode[m] = this.made[c] + 1;
      }
    }
    for (const m of back) { this.mode[m] = this.backMode[m] - 1; this.backMode[m] = 0; }
    // With `heal` the restart waits for the relabel: a cell starts again only when the relabel makes it the head of a body it did not head
    // before (an orphan of this death, or of an earlier one that a brace kept in its body until now).
    let heads: Set<number> | undefined;
    if (this.healOn) {
      heads = new Set();
      for (let l = 1; l <= this.labelHi; l++) if (this.bodySize[l] > 0) heads.add(this.cid[this.bodyRoot[l]]);
    }
    for (let q = 0; q < this.liveN; q++) {
      const o = this.live[q];
      if (this.dying[o]) continue;
      const m = this.mother[o];
      if (m >= 0 && this.dying[m]) {
        this.mother[o] = -1;
        if (!this.healOn) this.mode[o] = 0;
      }
    }
    // Bodies lost entirely.
    const killed = this.bodyTmp;
    killed.fill(0, 0, this.labelHi + 1);
    for (const c of dead) killed[this.body[c]]++;
    for (const c of dead) {
      const l = this.body[c];
      if (killed[l] > 0 && killed[l] === this.bodySize[l]) { this.bodyDeaths++; killed[l] = 0; }
    }
    for (const c of dead) {
      this.events.deaths.push({ x: this.x[c], y: this.y[c], fromX: this.prevX[c], fromY: this.prevY[c], kind: this.kind[c], store: this.store[c], lv: this.level[c] });
      if (this.compost) {
        this.food[(this.y[c] >>> 10) * this.size + (this.x[c] >>> 10)] += this.store[c];
        this.composted += this.store[c];
      } else this.reservoir += this.store[c];
      this.dropBracesOf(c);
      this.dying[c] = 0;
      this.release(c);
      this.cellDeaths++;
    }
    this.rebuildLive();
    this.prevBody.set(this.body);
    this.labelBodies();
    if (heads !== undefined) for (let l = 1; l <= this.labelHi; l++) if (!heads.has(this.cid[this.bodyRoot[l]])) this.mode[this.bodyRoot[l]] = 0;
    // Each piece beyond the first of an old body counts as a split.
    const pieces = this.bodyTmp;
    pieces.fill(0);
    for (let l = 1; l <= this.labelHi; l++) pieces[this.prevBody[this.bodyRoot[l]]]++;
    for (let l = 1; l < pieces.length; l++) if (pieces[l] > 1) this.splits += pieces[l] - 1;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      for (let k = 0; k < 4; k++) {
        const p = this.braceTo[c * 4 + k];
        if (p >= 0 && this.body[p] !== this.body[c]) this.braceTo[c * 4 + k] = -1;
      }
    }
  }

  private blockedAt(px: number, py: number, lv: number): boolean {
    const x = this.x;
    const y = this.y;
    const ts = this.around(px >>> 10, py >>> 10);
    const lim = SENSE * SENSE;
    for (let ti = 0; ti < 9; ti++) {
      for (let b = this.head[ts[ti]]; b >= 0; b = this.nextInTile[b]) {
        if (!this.alive[b]) continue;
        if (this.depthN > 0 && this.level[b] !== lv) continue;
        const dx = this.dlt(px, x[b]);
        if (dx >= SENSE || dx <= -SENSE) continue;
        const dy = this.dlt(py, y[b]);
        if (dy >= SENSE || dy <= -SENSE) continue;
        if (dx * dx + dy * dy < lim) return true;
      }
    }
    const nt = this.newTargets;
    for (let i = 0; i < nt.length; i += 2) {
      if (this.depthN > 0 && this.newTargetLv[i >> 1] !== lv) continue;
      const dx = this.dlt(px, nt[i]);
      if (dx >= SENSE || dx <= -SENSE) continue;
      const dy = this.dlt(py, nt[i + 1]);
      if (dy >= SENSE || dy <= -SENSE) continue;
      if (dx * dx + dy * dy < lim) return true;
    }
    return false;
  }

  private readonly facing = new Int32Array(3);
  /** The physical unit vector (Q14) standing for the cell's lattice direction `ref`, and that direction. */
  private frameOf(c: number): Int32Array {
    const f = this.facing;
    const m = this.mother[c];
    let ux = 0;
    let uy = 0;
    let dr = this.orient[c];
    const unit = (a: number, b: number, flip: number): boolean => {
      let dx = this.dlt(this.x[a], this.x[b]);
      let dy = this.dlt(this.y[a], this.y[b]);
      const big = Math.max(Math.abs(dx), Math.abs(dy));
      if (big > 4 * L) {
        dx = Math.trunc((dx * 4 * L) / big);
        dy = Math.trunc((dy * 4 * L) / big);
      }
      const d = isqrt(dx * dx + dy * dy);
      if (d === 0) return false;
      ux = Math.trunc((dx * SOFT_ONE * flip) / d);
      uy = Math.trunc((dy * SOFT_ONE * flip) / d);
      return true;
    };
    let ok = false;
    if (m >= 0) ok = unit(m, c, 1);
    else if (this.firstDaughter[c] >= 0) {
      const q = this.firstDaughter[c];
      ok = unit(c, q, 1);
      dr = this.orient[q];
    }
    if (!ok) {
      ux = softRoamCos(this.heading[c]);
      uy = softRoamSin(this.heading[c]);
      dr = this.orient[c];
    }
    f[0] = ux;
    f[1] = uy;
    f[2] = dr;
    return f;
  }

  private mutateGenes(c: number, to: number): void {
    const seed = this.cfg.seed;
    const t = this.step;
    for (let g = 0; g < ROAM_GENES; g++) {
      let v = this.genes[c * ROAM_GENES + g];
      const r = roamHash(seed, t, this.cid[c], CH_MUT + g);
      if ((r & 0xffff) < this.mutQ16) {
        v += (r >>> 16) & 1 ? this.cfg.mutStep : -this.cfg.mutStep;
        v = v > ROAM_GENE_MAX ? ROAM_GENE_MAX : v < -ROAM_GENE_MAX ? -ROAM_GENE_MAX : v;
      }
      this.genes[to * ROAM_GENES + g] = v;
    }
    if (this.depthN > 0) {
      // The daughter starts on her mother's level with her mother's record; her lift is copied with the gene chance and a step of 32.
      let v = this.lift[c];
      const r = roamHash(seed, t, this.cid[c], CH_LIFT);
      if ((r & 0xffff) < this.mutQ16) {
        v += (r >>> 16) & 1 ? 32 : -32;
        v = v > 255 ? 255 : v < 0 ? 0 : v;
      }
      this.lift[to] = v;
      this.level[to] = this.level[c];
      this.lvlStep[to] = this.lvlStep[c];
    }
    if (this.pulseOn) {
      // The daughter gets her mother's network (one weight moved by 16 with chance pulseMut) and her signals as they are; her outputs are worked out next step.
      const from = c * PULSE_W;
      const dst = to * PULSE_W;
      for (let i = 0; i < PULSE_W; i++) this.pulseW[dst + i] = this.pulseW[from + i];
      const r = roamHash(seed, t, this.cid[c], CH_PULSE);
      if ((r & 0xffff) < this.pulseMutQ16) {
        const i = dst + ((r >>> 17) % PULSE_W);
        let v = this.pulseW[i] + ((r >>> 16) & 1 ? PULSE_STEP : -PULSE_STEP);
        v = v > 127 ? 127 : v < -127 ? -127 : v;
        this.pulseW[i] = v;
      }
      this.sigA[to] = this.sigA[c];
      this.sigB[to] = this.sigB[c];
      this.pulseGo[to] = 127;
      this.pulseFlex[to] = 0;
    }
  }

  /** Cell `c`'s plan as a daughter gets it: with chance rateQ16/65536 one place changes to a different value. */
  private copyPlan(c: number, rateQ16: number): number {
    const seed = this.cfg.seed;
    const t = this.step;
    const pid = this.pid[c];
    const r = roamHash(seed, t, this.cid[c], CH_PLAN);
    if ((r & 0xffff) >= rateQ16) return pid;
    const next = Uint16Array.from(this.plans[pid]);
    const m = (r >>> 16) & 15;
    const field = roamHash(seed, t, this.cid[c], CH_PLAN_FIELD) % (this.toughOn ? 5 : this.kinds ? 4 : 3);
    const h = roamHash(seed, t, this.cid[c], CH_PLAN_NEW);
    const e = next[m];
    const act0 = e & 15;
    const child0 = (e >>> 4) & 15;
    const next0 = (e >>> 8) & 15;
    const kind0 = (e >>> 12) & 3;
    const tough0 = e >>> 14;
    if (field === 0) next[m] = planEntry((act0 + 1 + (h % PLAN_REST)) % (PLAN_REST + 1), child0, next0, kind0, tough0);
    else if (field === 1) next[m] = planEntry(act0, (child0 + 1 + (h % 15)) & 15, next0, kind0, tough0);
    else if (field === 2) next[m] = planEntry(act0, child0, (next0 + 1 + (h % 15)) & 15, kind0, tough0);
    else if (field === 3) next[m] = planEntry(act0, child0, next0, this.leafOn ? (kind0 + 1 + (h % 3)) % 4 : (kind0 + 1 + (h % 2)) % 3, tough0);
    else next[m] = planEntry(act0, child0, next0, kind0, (tough0 + 1 + (h % 3)) & 3);
    return this.addPlan(next, pid);
  }

  private divide(): void {
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const ready: number[] = [];
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      if (this.store[c] >= 2 * cfg.birthStore && (this.plans[this.pid[c]][this.mode[c]] & 15) < PLAN_REST) ready.push(c);
    }
    if (ready.length === 0) return;
    ready.sort((a, b) => roamHash(seed, t, this.cid[a], CH_ORDER) - roamHash(seed, t, this.cid[b], CH_ORDER) || this.cid[a] - this.cid[b]);
    this.firstDaughter.fill(-1);
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const m = this.mother[c];
      if (m < 0) continue;
      const f = this.firstDaughter[m];
      if (f < 0 || this.cid[c] < this.cid[f]) this.firstDaughter[m] = c;
    }
    this.newTargets = [];
    this.newTargetLv.length = 0;
    // As the stage starts: each body's size (for releaseMin) and the step after its last release, the most any cell of it holds (for releaseGap).
    if (this.relMinN > 0) this.bodyStart.set(this.bodySize.subarray(0, this.labelHi + 1));
    if (this.relGapN > 0) {
      this.bodyRelMax.fill(0);
      for (let q = 0; q < this.liveN; q++) {
        const c = this.live[q];
        if (this.relRec[c] > this.bodyRelMax[this.body[c]]) this.bodyRelMax[this.body[c]] = this.relRec[c];
      }
    }
    let relBodies = 0;
    for (const c of ready) {
      const entry = this.plans[this.pid[c]][this.mode[c]];
      const act = entry & 15;
      const d = (this.orient[c] + (act & 3)) & 3;
      const tgx = this.gx[c] + DX[d];
      const tgy = this.gy[c] + DY[d];
      if (this.offsetMap.has(this.offKey(this.body[c], tgx, tgy))) {
        // The lattice place is already held by this body: a kept daughter counts as done.
        if (act < 4) this.mode[c] = (entry >>> 8) & 15;
        continue;
      }
      // Everything below needs a free slot; the held case above does not.
      if (this.freeN === 0 || this.nextCid > 0xffffffff) continue;
      const f = this.frameOf(c);
      let ux = f[0];
      let uy = f[1];
      const turns = (d - f[2]) & 3;
      for (let k = 0; k < turns; k++) { const tmp = ux; ux = -uy; uy = tmp; }
      const ox = Math.trunc(ux / 16);
      const oy = Math.trunc(uy / 16);
      const px = this.wrap(this.x[c] + ox);
      const py = this.wrap(this.y[c] + oy);
      if (this.blockedAt(px, py, this.depthN > 0 ? this.level[c] : 0)) continue;
      const keep = act < 4;
      if (!keep && (this.relMinN > 0 || this.relGapN > 0)) {
        const l = this.body[c];
        // Held, and counted once: too small a body, or one that released too lately (a release this step writes t + 1, so it holds the rest of the step).
        if ((this.relMinN > 0 && this.bodyStart[l] < this.relMinN) || (this.relGapN > 0 && this.bodyRelMax[l] !== 0 && t < this.bodyRelMax[l] - 1 + this.relGapN)) {
          this.releasesHeld++;
          continue;
        }
      }
      const half = this.store[c] >>> 1;
      this.store[c] -= half;
      const to = this.allocate();
      this.place(to, px, py, this.genes.subarray(c * ROAM_GENES, c * ROAM_GENES + ROAM_GENES), this.fam[c], half, 0);
      this.vx[to] = this.vx[c];
      this.vy[to] = this.vy[c];
      this.mutateGenes(c, to);
      this.orient[to] = d;
      this.made[to] = this.mode[c];
      this.kind[to] = this.kinds ? (entry >>> 12) & 3 : KIND_PLAIN;
      this.tough[to] = this.toughOn ? entry >>> 14 : 0;
      this.mode[c] = (entry >>> 8) & 15;
      this.divisions++;
      this.events.births.push(to);
      // bornStep is the world step at which the daughter first exists (the step after the one that made her); 0 is only a founder.
      this.bornStep[to] = t + 1;
      this.newTargets.push(px, py);
      if (this.depthN > 0) this.newTargetLv.push(this.level[c]);
      if (keep) {
        this.pid[to] = this.copyPlan(c, this.planMutQ16 >>> 3);
        this.mode[to] = (entry >>> 4) & 15;
        this.mother[to] = c;
        this.gx[to] = tgx;
        this.gy[to] = tgy;
        this.heading[to] = this.heading[c];
        this.turnLeft[to] = this.turnLeft[c];
        this.since[to] = this.since[c];
        this.relRec[to] = this.relRec[c];
        this.body[to] = this.body[c];
        this.bodySize[this.body[c]]++;
        this.offsetMap.set(this.offKey(this.body[to], tgx, tgy), to);
        this.braceNew(to, c);
      } else {
        this.pid[to] = this.copyPlan(c, this.planMutQ16);
        this.mode[to] = 0;
        this.mother[to] = -1;
        this.gx[to] = 0;
        this.gy[to] = 0;
        this.heading[to] = softRoamAngle(ox, oy);
        // Sealed from the first step she exists (t + 1), for `seal` steps.
        this.since[to] = t + 1;
        const l = ++this.labelHi;
        this.body[to] = l;
        this.bodySize[l] = 1;
        this.offsetMap.set(this.offKey(l, 0, 0), to);
        this.releases++;
        if (this.relGapN > 0) {
          // The record belongs to the whole releasing body. bodyRelMax holds the body for the rest of the step at once;
          // its members' records are written in one pass after the loop (nothing in the loop reads them), so a step costs
          // one scan of the live cells however many bodies release.
          this.bodyRelMax[this.body[c]] = t + 1;
          relBodies++;
        }
      }
      this.live[this.liveN++] = to;
    }
    // A record of t + 1 can only have been written this step (records are at most the step), so it marks exactly the bodies that released.
    if (relBodies > 0) {
      for (let q = 0; q < this.liveN; q++) {
        const c = this.live[q];
        if (this.bodyRelMax[this.body[c]] === t + 1) this.relRec[c] = t + 1;
      }
    }
  }

  /** Braces for a new kept daughter: to same-body cells at ideal lattice offsets, ranked by pair hash, at most four. */
  private braceNew(c: number, mother: number): void {
    const cand: { h: number; p: number; rest: number }[] = [];
    for (const [ox, oy, rest] of BRACE_OFFSETS) {
      const p = this.offsetMap.get(this.offKey(this.body[c], this.gx[c] + ox, this.gy[c] + oy));
      if (p === undefined || p === c || p === mother) continue;
      cand.push({ h: this.pairHash(c, p, CH_BRACE), p, rest });
    }
    if (cand.length === 0) return;
    cand.sort((a, b) => a.h - b.h || this.cid[a.p] - this.cid[b.p]);
    for (const e of cand) this.addBrace(c, e.p, e.rest);
  }

  private spreadFood(): void {
    const snap = this.foodSnap;
    snap.set(this.food);
    const s = this.size;
    for (let i = 0; i < this.n; i++) {
      const f = snap[i];
      const part = Math.floor(Math.floor((f * this.spreadQ10) / 1024) / 4);
      if (part === 0) continue;
      const xx = i % s;
      const yy = (i - xx) / s;
      this.food[i] -= 4 * part;
      this.food[this.tileAt(xx + 1, yy)] += part;
      this.food[this.tileAt(xx - 1, yy)] += part;
      this.food[this.tileAt(xx, yy + 1)] += part;
      this.food[this.tileAt(xx, yy - 1)] += part;
    }
  }

  stepOnce(): void {
    const cfg = this.cfg;
    const t = this.step;
    const ev = this.events;
    ev.deaths.length = 0;
    ev.births.length = 0;
    ev.cracks.length = 0;
    ev.patches.length = 0;
    ev.feeds.length = 0;
    ev.hits.length = 0;
    this.prevX.set(this.x);
    this.prevY.set(this.y);
    this.rebuildLive();
    this.labelBodies();
    this.markMouths();
    this.commands();
    this.mechanics();
    // Travel is summed here, after the last movement and before life: a cell that moves and then dies this step still counts,
    // and a daughter born later in the step (perhaps in a dead cell's slot) does not.
    let moved = 0;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const dx = this.dlt(this.prevX[c], this.x[c]);
      const dy = this.dlt(this.prevY[c], this.y[c]);
      moved += isqrt(dx * dx + dy * dy);
    }
    this.travel += moved;
    // Life.
    this.buildBuckets();
    this.buildOffsets();
    this.eat();
    this.upkeep();
    if (this.drainN > 0) this.touch();
    this.flowAlongLinks();
    this.die();
    this.buildOffsets();
    this.divide();
    this.countBodies();
    // With `patchSeason` a patch holds patchFood times the season's light (at least 1).
    const patchAmt = this.seasonPatch ? Math.max(1, Math.floor((cfg.patchFood * this.seasonLight(t)) / 256)) : cfg.patchFood;
    if (t > 0 && t % cfg.patchEvery === 0 && this.reservoir >= patchAmt) {
      const rnd = roamHash(cfg.seed, t, 0, CH_PATCH);
      if (this.sunPatch) {
        // The centre draw is kept; the patch lands only as the light there allows, else the reservoir keeps the matter and the next date tries again.
        const cx = rnd % this.size;
        const cy = (rnd >>> 16) % this.size;
        if ((roamHash(cfg.seed, t, cy * this.size + cx, CH_PATCH_SUN) & 255) < softRoamLight(cfg, cx, cy, t)) this.dropPatch(rnd, true, patchAmt);
        else this.patchesSkipped++;
      } else this.dropPatch(rnd, true, patchAmt);
    }
    if (this.spreadQ10 > 0) this.spreadFood();
    this.relaxScent();
    this.step++;
  }

  advance(steps: number): void {
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  // ------------------------------------------------------------------ reading

  /** Sizes of the live bodies as of the last step (any order). */
  bodySizes(): number[] {
    const out: number[] = [];
    for (let l = 1; l <= this.labelHi; l++) if (this.bodySize[l] > 0) out.push(this.bodySize[l]);
    return out;
  }

  /** The three alarms as of now (cheap enough to read every step): long bonds, pairs overlapping for 50 steps, cells at the clamp for 50 steps. */
  alarms(): { bonds: number; overlap: number; speed: number } {
    let bonds = 0;
    let speed = 0;
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c]) continue;
      if (this.clampRun[c] >= SPEED_RUN) speed++;
      const m = this.mother[c];
      if (m >= 0) {
        const dx = this.dlt(this.x[c], this.x[m]);
        const dy = this.dlt(this.y[c], this.y[m]);
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 2 * L || dx * dx + dy * dy > 4 * L * L) bonds++;
      }
    }
    let overlap = 0;
    // A pair counts only while both slots still hold the recorded cells and they still overlap at the positions reported now
    // (a cell can die in life, or the last integration can part them, after the run was counted).
    const near = D - (D >>> 2);
    for (const [key, v] of this.pairRun) {
      if (v.run < SPEED_RUN) continue;
      const a = Math.floor(key / this.cap);
      const b = key - a * this.cap;
      if (!this.alive[a] || !this.alive[b] || this.cid[a] !== v.ca || this.cid[b] !== v.cb) continue;
      const dx = this.dlt(this.x[a], this.x[b]);
      const dy = this.dlt(this.y[a], this.y[b]);
      if (dx * dx + dy * dy < near * near) overlap++;
    }
    return { bonds, overlap, speed };
  }

  census(): SoftRoamCensus {
    let food = 0;
    for (let i = 0; i < this.n; i++) food += this.food[i];
    let held = 0;
    let cells = 0;
    let shells = 0;
    let shellTough = 0;
    let mouths = 0;
    let leaves = 0;
    const genes = new Array<number>(ROAM_GENES).fill(0);
    const levels = new Array<number>(this.depthN).fill(0);
    let goSum = 0;
    let pulsing = 0;
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c]) continue;
      cells++;
      if (this.depthN > 0) levels[this.level[c]]++;
      if (this.pulseOn) { pulsing += this.pulseMoved[c]; goSum += 256 - Math.floor((this.pulseThrustQ8 * (127 - this.pulseGo[c])) / 254); }
      held += this.store[c];
      if (this.kind[c] === KIND_SHELL) { shells++; shellTough += this.tough[c]; }
      else if (this.kind[c] === KIND_MOUTH) mouths++;
      else if (this.kind[c] === KIND_LEAF) leaves++;
      for (let g = 0; g < ROAM_GENES; g++) genes[g] += this.genes[c * ROAM_GENES + g];
    }
    const al = this.alarms();
    const sizes = this.bodySizes();
    let largest = 0;
    let singles = 0;
    for (const s of sizes) {
      if (s > largest) largest = s;
      if (s === 1) singles++;
    }
    return {
      step: this.step,
      bodies: sizes.length,
      cells,
      largest,
      singles,
      food,
      held,
      reservoir: this.reservoir,
      residual: this.total - food - held - this.reservoir - this.leafPool,
      genes: genes.map((g) => (cells ? g / cells : 0)),
      divisions: this.divisions,
      releases: this.releases,
      cellDeaths: this.cellDeaths,
      bodyDeaths: this.bodyDeaths,
      worn: this.worn,
      composted: this.composted,
      splits: this.splits,
      shells,
      mouths,
      cracked: this.cracked,
      drained: this.drained,
      flowed: this.flowed,
      patches: this.patches,
      travel: this.travel,
      shellTough: shells ? shellTough / shells : 0,
      alarmBonds: al.bonds,
      alarmOverlap: al.overlap,
      alarmSpeed: al.speed,
      hunting: this.hunting,
      targets: this.targets,
      fleeing: this.fleeing,
      releasesHeld: this.releasesHeld,
      leaves,
      leafIncome: this.leafIncome,
      steering: this.steering,
      leafPool: this.leafPool,
      levels,
      levelMoves: this.levelMoves,
      pulsing,
      pulseGo: this.pulseOn && cells > 0 ? Math.floor(goSum / cells) : 256,
    };
  }

  /** Live slots in cid order. */
  private slotsByCid(): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.cap; c++) if (this.alive[c]) out.push(c);
    out.sort((a, b) => this.cid[a] - this.cid[b]);
    return out;
  }

  /** A 32-bit digest of everything that carries the history forward; the same whatever slots the cells sit in. */
  digest(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => { h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0; };
    mix(this.step);
    mix(this.reservoir);
    mix(this.nextCid);
    for (let i = 0; i < this.n; i++) {
      mix(this.food[i]);
      mix(this.scent[i]);
      mix(this.scentHi[i]);
    }
    for (const c of this.slotsByCid()) {
      mix(this.cid[c]);
      mix(this.x[c]);
      mix(this.y[c]);
      mix(this.vx[c]);
      mix(this.vy[c]);
      mix(this.carryX[c] & 0xff);
      mix(this.carryY[c] & 0xff);
      mix(this.store[c]);
      for (let g = 0; g < ROAM_GENES; g++) mix(this.genes[c * ROAM_GENES + g]);
      mix(this.pid[c]);
      mix(this.mode[c] | (this.made[c] << 4) | (this.orient[c] << 8) | (this.kind[c] << 10) | (this.tough[c] << 12));
      mix(this.gx[c] & 0xffff);
      mix(this.gy[c] & 0xffff);
      mix(this.fam[c]);
      mix(this.since[c]);
      mix(this.bornStep[c]);
      mix(this.hits[c]);
      mix(this.lastHitStep[c]);
      mix(this.lastDrainStep[c]);
      mix(this.heading[c]);
      if (this.depthN > 0) { mix(this.level[c] | (this.lift[c] << 8)); mix(this.lvlStep[c]); }
      if (this.pulseOn) {
        mix((this.sigA[c] & 255) | ((this.sigB[c] & 255) << 8) | ((this.pulseGo[c] & 255) << 16) | ((this.pulseFlex[c] & 255) << 24));
        for (let i = 0; i < PULSE_W; i += 4) mix((this.pulseW[c * PULSE_W + i] & 255) | ((this.pulseW[c * PULSE_W + i + 1] & 255) << 8) | ((this.pulseW[c * PULSE_W + i + 2] & 255) << 16) | ((this.pulseW[c * PULSE_W + i + 3] & 255) << 24));
      }
      if (this.relGapN > 0) { mix(this.relRec[c]); mix(Math.floor(this.relRec[c] / 4294967296)); }
      mix(this.turnLeft[c] & 0xffff);
      mix(this.mother[c] >= 0 ? this.cid[this.mother[c]] : 0);
      const bs: number[] = [];
      for (let k = 0; k < 4; k++) if (this.braceTo[c * 4 + k] >= 0) bs.push(this.cid[this.braceTo[c * 4 + k]] * 4096 + this.braceRest[c * 4 + k]);
      bs.sort((a, b) => a - b);
      for (const b of bs) { mix(b); mix(Math.floor(b / 4294967296)); }
    }
    for (const plan of this.plans) for (let m = 0; m < PLAN_MODES; m++) mix(plan[m]);
    mix(this.splits);
    mix(this.worn);
    mix(this.composted);
    mix(this.divisions);
    mix(this.releases);
    mix(this.flowed);
    if (this.drainN > 0) { mix(this.drained); mix(this.cracked); }
    if (this.relMinN > 0 || this.relGapN > 0) mix(this.releasesHeld);
    if (this.leafOn) { mix(this.leafIncome); mix(Math.floor(this.leafIncome / 4294967296)); }
    if (this.leafPoolQ8 >= 0) mix(this.leafPool);
    if (this.depthN > 0) mix(this.levelMoves);
    return h >>> 0;
  }

  /** Throws when a ledger or a link is broken. */
  checkInvariants(): void {
    const c0 = this.census();
    if (c0.residual !== 0) throw new Error(`matter residual ${c0.residual}`);
    const seen = new Set<number>();
    let free = 0;
    for (let i = 0; i < this.freeN; i++) {
      const s = this.freeList[i];
      if (this.alive[s]) throw new Error(`free slot ${s} is alive`);
      free++;
    }
    let live = 0;
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c]) continue;
      live++;
      if (this.cid[c] === 0 || seen.has(this.cid[c])) throw new Error(`cid ${this.cid[c]} repeated or zero in slot ${c}`);
      seen.add(this.cid[c]);
      if (this.x[c] < 0 || this.x[c] >= this.span || this.y[c] < 0 || this.y[c] >= this.span) throw new Error(`slot ${c} off the torus`);
      if (this.pid[c] < 1 || this.pid[c] >= this.plans.length) throw new Error(`slot ${c} has plan ${this.pid[c]}`);
      // The release record: 0 when releaseGap is off; else a whole step number no later than now (it holds the step after a release).
      if (this.relGapN === 0 ? this.relRec[c] !== 0 : !Number.isInteger(this.relRec[c]) || this.relRec[c] > this.step) throw new Error(`slot ${c} has release record ${this.relRec[c]} at step ${this.step}`);
      const m = this.mother[c];
      if (m >= 0) {
        if (!this.alive[m]) throw new Error(`slot ${c} has a dead mother`);
        if (this.cid[m] >= this.cid[c]) throw new Error(`slot ${c} has a younger mother`);
        if (this.body[m] !== this.body[c]) throw new Error(`slot ${c} is in another body than its mother`);
      }
      for (let k = 0; k < 4; k++) {
        const p = this.braceTo[c * 4 + k];
        if (p < 0) continue;
        if (!this.alive[p]) throw new Error(`slot ${c} braced to dead slot ${p}`);
        if (this.body[p] !== this.body[c]) throw new Error(`brace across bodies at slot ${c}`);
        let back = false;
        for (let j = 0; j < 4; j++) if (this.braceTo[p * 4 + j] === c && this.braceRest[p * 4 + j] === this.braceRest[c * 4 + k]) back = true;
        if (!back) throw new Error(`brace ${c}-${p} is one sided`);
      }
    }
    if (live + free !== this.cap) throw new Error(`slots: ${live} alive + ${free} free != ${this.cap}`);
    const sizes = new Map<number, number>();
    for (let c = 0; c < this.cap; c++) if (this.alive[c]) sizes.set(this.body[c], (sizes.get(this.body[c]) ?? 0) + 1);
    for (const [l, k] of sizes) if (this.bodySize[l] !== k) throw new Error(`body ${l}: size ${this.bodySize[l]} but ${k} cells`);
    // A release writes the whole body and a kept daughter copies her mother, so one body holds one record.
    if (this.relGapN > 0) {
      const rec = new Map<number, number>();
      for (let c = 0; c < this.cap; c++) {
        if (!this.alive[c]) continue;
        const r = rec.get(this.body[c]);
        if (r === undefined) rec.set(this.body[c], this.relRec[c]);
        else if (r !== this.relRec[c]) throw new Error(`body ${this.body[c]} holds release records ${r} and ${this.relRec[c]}`);
      }
    }
  }
}
