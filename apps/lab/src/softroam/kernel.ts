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
 * Milestone 1 (this file): everything except touch, drain, crack and grip and the kinds' eating rules (the seal that goes
 * with drain is live as soon as drain is set: a new body cannot turn and thrusts at full along its heading). The kind, tough,
 * hits, lastHitStep and lastDrainStep arrays and the kind bits of plan entries are carried so that milestone 2 only
 * adds rules.
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
  /** Scent: passes per step, the share lost per pass as a power of two, and how strongly a slope is read (1 to 16). */
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
  /** Milestone 2 (read and checked, not yet applied): cells come in kinds, set by the plan entry that made them. */
  kinds?: boolean;
  /** Milestone 2: shells have toughness levels in their plan entries. */
  toughness?: boolean;
  /** Milestone 2: matter a larger body takes through each touch from a smaller one's cell per step. The touch itself is not applied yet, but setting drain already turns on the seal (below): every new body dashes along its heading for `seal` steps. */
  drain?: number;
  /** With drain: steps a new body is sealed (it neither takes nor loses by touch, and thrusts at full along its release direction). 100 when absent. */
  seal?: number;
  /** Milestone 2: a shell cracks after this many hits. */
  crack?: number;
  /** Milestone 2: the share of the usual bite a shell that eats takes, and the share of the side upkeep it pays. */
  shellBite?: number;
  shellLeak?: number;
  /** Milestone 2: how hard a mouth touching prey is pulled toward contact distance, out of 256. */
  grip?: number;
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
    scentIters: 1,
    scentDecayShift: 5,
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
const CH_PAIR = 100; // + substep
/** Velocity is only taken off contacts at least this near-touching (squared distance of three quarters of D); deeper overlaps may decompress freely. */
const SHALLOW2 = (3 * D / 4) * (3 * D / 4);

const SCENT_FOOD_CAP = 1023;
const SENSE = 717;
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
  /** Alarms that must stay 0: bonds longer than 2 L now; pairs of different bodies overlapping by more than D/4 for 50 steps running; cells at the speed clamp for 50 steps running. */
  alarmBonds: number;
  alarmOverlap: number;
  alarmSpeed: number;
}

export interface SoftDeathEvent { x: number; y: number; kind: number; store: number }
export interface SoftPointEvent { x: number; y: number }

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

  // Per tile.
  readonly food: Uint32Array;
  scent: Uint32Array;
  private scentNext: Uint32Array;

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
    whole(cfg.scentDecayShift, 'scentDecayShift', 1, 8);
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
    const stiff = (2 * (4 * cfg.kBond + 4 * cfg.kBrace + 6 * cfg.kRep)) / 256;
    if (stiff / 16 >= 2 * (1 + cfg.keep / 256)) throw new Error(`Springs too stiff for keep ${cfg.keep}: ${stiff.toFixed(2)}`);
    this.leakSideQ16 = q16(cfg.leakSide, 'leakSide');
    this.leakCellQ16 = q16(cfg.leakCell, 'leakCell');
    this.moveCostQ16 = q16(cfg.moveCost, 'moveCost');
    this.turnMaxQ16 = q16(cfg.turnMax, 'turnMax');
    this.mutQ16 = q16(cfg.mut, 'mut');
    this.planMutQ16 = q16(cfg.planMut, 'planMut');
    // Flow is a share out of 1024 (at most 1/8): diff * share stays below 2^27.
    this.flowQ10 = Math.round(cfg.flow * 1024);
    if (!Number.isFinite(cfg.flow) || this.flowQ10 < 1 || this.flowQ10 > 128) throw new Error(`Invalid flow: ${cfg.flow}`);
    this.wearQ32 = cfg.life === undefined ? 0 : Math.floor(0x100000000 / whole(cfg.life, 'life', 2, 1 << 30));
    this.spreadQ10 = cfg.foodSpread === undefined ? 0 : Math.round(cfg.foodSpread * 1024);
    if (cfg.foodSpread !== undefined && (!(cfg.foodSpread > 0) || cfg.foodSpread > 1)) throw new Error(`Invalid foodSpread: ${cfg.foodSpread}`);
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
    if (cfg.grip !== undefined) whole(cfg.grip, 'grip', 0, 256);

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
    this.food = new Uint32Array(n);
    this.scent = new Uint32Array(n);
    this.scentNext = new Uint32Array(n);
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
    this.relaxScent(1);
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

  /** Fill the 9 tiles around tile coordinates (tx, ty), in the scan order in force. */
  private around(tx: number, ty: number): Int32Array {
    const t = this.tiles9;
    const o0 = this._reverseScan ? 1 : -1;
    const st = this._reverseScan ? -1 : 1;
    let k = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[k++] = this.tileAt(tx + o0 + j * st, ty + o0 + i * st);
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
      const e = whole(entries[m], 'plan mode', 0, this.toughOn ? 0xffff : this.kinds ? 0x2fff : 0xfff);
      if ((e & 15) > PLAN_REST) throw new Error(`Invalid act in mode ${m}: ${e & 15}`);
      if (((e >>> 12) & 3) > KIND_MOUTH) throw new Error(`Invalid kind in mode ${m}: ${(e >>> 12) & 3}`);
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
    this.bornStep[c] = this.step;
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
    this.vx[c] = 0;
    this.vy[c] = 0;
    this.carryX[c] = 0;
    this.carryY[c] = 0;
    this.body[c] = 0;
    this.mother[c] = -1;
    this.clampRun[c] = 0;
    this.freeList[this.freeN++] = c;
  }

  private dropPatch(rnd: number, event = true): void {
    const s = this.size;
    const cx = rnd % s;
    const cy = (rnd >>> 16) % s;
    const k = this.patchTiles.length >> 1;
    const each = Math.floor(this.cfg.patchFood / k);
    for (let j = 0; j < k; j++) this.food[this.tileAt(cx + this.patchTiles[2 * j], cy + this.patchTiles[2 * j + 1])] += each;
    this.food[this.tileAt(cx, cy)] += this.cfg.patchFood - each * k;
    this.reservoir -= this.cfg.patchFood;
    this.patches++;
    if (event) this.events.patches.push({ x: cx, y: cy });
  }

  private relaxScent(iters = this.cfg.scentIters): void {
    const s = this.size;
    const n = this.n;
    const shift = 1 << this.cfg.scentDecayShift;
    for (let it = 0; it < iters; it++) {
      const a = this.scent;
      const b = this.scentNext;
      for (let i = 0; i < n; i++) {
        const xx = i % s;
        const row = i - xx;
        const e = a[row + (xx + 1 === s ? 0 : xx + 1)];
        const w = a[row + (xx === 0 ? s - 1 : xx - 1)];
        const so = a[i + s >= n ? i + s - n : i + s];
        const no = a[i - s < 0 ? i - s + n : i - s];
        const m = Math.floor((4 * a[i] + e + w + so + no) / 8);
        const f = this.food[i];
        b[i] = m - Math.floor(m / shift) + (f > SCENT_FOOD_CAP ? SCENT_FOOD_CAP : f);
      }
      this.scent = b;
      this.scentNext = a;
    }
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
      const sealed = this.drainN > 0 && t - this.since[r] < this.sealN;
      if (sealed) tl = 0;
      else {
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
    for (let q = 0; q < this.liveN; q++) {
      const c = live[q];
      const l = this.body[c];
      const h = this.bodyHead[l];
      this.heading[c] = h;
      this.turnLeft[c] = this.bodyTurn[l];
      const ch = softRoamCos(h);
      const sh = softRoamSin(h);
      const sealed = this.drainN > 0 && t - this.since[this.bodyRoot[l]] < this.sealN;
      let ux = 0;
      let uy = 0;
      if (sealed) {
        ux = Math.trunc(ch / 16);
        uy = Math.trunc(sh / 16);
      } else {
        const chase = this.genes[c * ROAM_GENES + G_CHASE];
        const drive = this.genes[c * ROAM_GENES + G_DRIVE];
        ux = Math.trunc((drive * ch) / 8192);
        uy = Math.trunc((drive * sh) / 8192);
        if (chase !== 0) {
          const g = this.scentSlope(this.x[c], this.y[c], gain);
          ux += Math.trunc((chase * g[0]) / 512);
          uy += Math.trunc((chase * g[1]) / 512);
        }
        const mag2 = ux * ux + uy * uy;
        if (mag2 > 1024 * 1024) {
          const mag = isqrt(mag2);
          ux = Math.trunc((ux * 1024) / mag);
          uy = Math.trunc((uy * 1024) / mag);
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
    }
  }

  private readonly slope = new Int32Array(2);
  /** The scent at a position, interpolated between tile centres (whole scent units, rounded down); every product stays below 2^31 (scent is under 2^15). */
  private scentAt(px: number, py: number): number {
    // Offset by two tiles so the shifts act on non-negative numbers (px runs from -1024 to the torus end plus 1024).
    const qx = px - 512 + 2048;
    const qy = py - 512 + 2048;
    const i0 = (qx >> 10) - 2;
    const j0 = (qy >> 10) - 2;
    const fx = qx & 1023;
    const fy = qy & 1023;
    const a = this.scent;
    const top = (a[this.tileAt(i0, j0)] * (1024 - fx) + a[this.tileAt(i0 + 1, j0)] * fx) >> 10;
    const bot = (a[this.tileAt(i0, j0 + 1)] * (1024 - fx) + a[this.tileAt(i0 + 1, j0 + 1)] * fx) >> 10;
    return (top * (1024 - fy) + bot * fy) >> 10;
  }
  /**
   * The smooth slope of the scent at a position, each component in [-1024, 1024] (1024 is a relative slope of 1/gain per tile): Roam's
   * (east - west) * 1024 * gain / (east + west + 1), with east and west read one tile either side of the position from the
   * interpolated field, so it is exactly Roam's at a tile centre and a symmetric peak gives no slope anywhere on its axis.
   */
  private scentSlope(px: number, py: number, gain: number): Int32Array {
    const se = this.scentAt(px + 1024, py);
    const sw = this.scentAt(px - 1024, py);
    const ss = this.scentAt(px, py + 1024);
    const sn = this.scentAt(px, py - 1024);
    // Scent is under 2^18 (256 times the food cap at the widest decay). A slope of 1/gain per tile or more is the full 1024, so only the smaller
    // ones are scaled, and then (east - west) * gain * 1024 stays below (east + west + 1) * 1024.
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
        if (m >= 0) this.spring(c, m, L, cfg.kBond, sub);
        for (let k = 0; k < 4; k++) {
          const p = this.braceTo[c * 4 + k];
          if (p >= 0 && this.cid[c] < this.cid[p]) this.spring(c, p, this.braceRest[c * 4 + k], cfg.kBrace, sub);
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
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const room = cap4 > this.store[c] ? cap4 - this.store[c] : 0;
      const a = room < this.biteN ? room : this.biteN;
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
  }

  private upkeep(): void {
    const seed = this.cfg.seed;
    const t = this.step;
    const m = this.offsetMap;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      let exposed = 4;
      for (let d = 0; d < 4; d++) if (m.has(this.offKey(this.body[c], this.gx[c] + DX[d], this.gy[c] + DY[d]))) exposed--;
      const costQ16 = exposed * this.leakSideQ16 + this.leakCellQ16;
      let pay = (costQ16 >>> 16) + ((roamHash(seed, t, this.cid[c], CH_UPKEEP) & 0xffff) < (costQ16 & 0xffff) ? 1 : 0);
      if (pay > this.store[c]) pay = this.store[c];
      this.store[c] -= pay;
      this.reservoir += pay;
    }
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
    for (let q = 0; q < this.liveN; q++) {
      const o = this.live[q];
      if (this.dying[o]) continue;
      const m = this.mother[o];
      if (m >= 0 && this.dying[m]) { this.mode[o] = 0; this.mother[o] = -1; }
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
      this.events.deaths.push({ x: this.x[c], y: this.y[c], kind: this.kind[c], store: this.store[c] });
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

  private blockedAt(px: number, py: number): boolean {
    const x = this.x;
    const y = this.y;
    const ts = this.around(px >>> 10, py >>> 10);
    const lim = SENSE * SENSE;
    for (let ti = 0; ti < 9; ti++) {
      for (let b = this.head[ts[ti]]; b >= 0; b = this.nextInTile[b]) {
        if (!this.alive[b]) continue;
        const dx = this.dlt(px, x[b]);
        if (dx >= SENSE || dx <= -SENSE) continue;
        const dy = this.dlt(py, y[b]);
        if (dy >= SENSE || dy <= -SENSE) continue;
        if (dx * dx + dy * dy < lim) return true;
      }
    }
    const nt = this.newTargets;
    for (let i = 0; i < nt.length; i += 2) {
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
    else if (field === 3) next[m] = planEntry(act0, child0, next0, (kind0 + 1 + (h % 2)) % 3, tough0);
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
      if (this.blockedAt(px, py)) continue;
      const keep = act < 4;
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
      this.newTargets.push(px, py);
      if (keep) {
        this.pid[to] = this.copyPlan(c, this.planMutQ16 >>> 3);
        this.mode[to] = (entry >>> 4) & 15;
        this.mother[to] = c;
        this.gx[to] = tgx;
        this.gy[to] = tgy;
        this.heading[to] = this.heading[c];
        this.turnLeft[to] = this.turnLeft[c];
        this.since[to] = this.since[c];
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
        this.since[to] = t;
        const l = ++this.labelHi;
        this.body[to] = l;
        this.bodySize[l] = 1;
        this.offsetMap.set(this.offKey(l, 0, 0), to);
        this.releases++;
      }
      this.live[this.liveN++] = to;
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
    this.prevX.set(this.x);
    this.prevY.set(this.y);
    this.rebuildLive();
    this.labelBodies();
    this.commands();
    this.mechanics();
    // Life.
    this.buildBuckets();
    this.buildOffsets();
    this.eat();
    this.upkeep();
    this.flowAlongLinks();
    this.die();
    this.buildOffsets();
    this.divide();
    this.countBodies();
    if (t > 0 && t % cfg.patchEvery === 0 && this.reservoir >= cfg.patchFood) this.dropPatch(roamHash(cfg.seed, t, 0, CH_PATCH));
    if (this.spreadQ10 > 0) this.spreadFood();
    this.relaxScent();
    let moved = 0;
    for (let q = 0; q < this.liveN; q++) {
      const c = this.live[q];
      const dx = this.dlt(this.prevX[c], this.x[c]);
      const dy = this.dlt(this.prevY[c], this.y[c]);
      moved += isqrt(dx * dx + dy * dy);
    }
    this.travel += moved;
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

  census(): SoftRoamCensus {
    let food = 0;
    for (let i = 0; i < this.n; i++) food += this.food[i];
    let held = 0;
    let cells = 0;
    let shells = 0;
    let mouths = 0;
    let alarmBonds = 0;
    let alarmSpeed = 0;
    const genes = new Array<number>(ROAM_GENES).fill(0);
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c]) continue;
      cells++;
      held += this.store[c];
      if (this.kind[c] === KIND_SHELL) shells++;
      else if (this.kind[c] === KIND_MOUTH) mouths++;
      for (let g = 0; g < ROAM_GENES; g++) genes[g] += this.genes[c * ROAM_GENES + g];
      if (this.clampRun[c] >= SPEED_RUN) alarmSpeed++;
      const m = this.mother[c];
      if (m >= 0) {
        const dx = this.dlt(this.x[c], this.x[m]);
        const dy = this.dlt(this.y[c], this.y[m]);
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 2 * L || dx * dx + dy * dy > 4 * L * L) alarmBonds++;
      }
    }
    let alarmOverlap = 0;
    for (const v of this.pairRun.values()) if (v.run >= SPEED_RUN) alarmOverlap++;
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
      residual: this.total - food - held - this.reservoir,
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
      alarmBonds,
      alarmOverlap,
      alarmSpeed,
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
  }
}
