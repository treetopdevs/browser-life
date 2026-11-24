/**
 * Roam world (exploratory probe, 2026-11-23): bodies that occupy space and have to go to their food.
 *
 * A cell sits on one tile of a square torus and holds matter (its store). A bond joins a cell to a daughter it made
 * and is never formed any other way, so two bodies cannot fuse. Nothing declares a body: each step the bonded groups
 * are found by walking the bonds, and a group is what eats into one shared store, pays, starves, and moves one tile
 * as a rigid piece.
 *
 * Matter is closed: food on the ground + matter in cells + one reservoir is the starting total at every step.
 * Everything cells lose (upkeep, the cost of moving, what a dead cell held) goes to the reservoir, and the reservoir
 * gives it back as whole patches at hash-chosen places. Waste never returns where the body that made it is.
 *
 * All arithmetic is on integers and every random draw is a hash of (seed, step, tile, channel), so a seed gives one
 * history. The scent field is a signal, not matter.
 */

/** Genes per cell, each a whole number in [-512, 512]. */
export const ROAM_GENES = 5;
/** Speed toward stronger food scent (away from it when negative), as a share of the top speed. */
export const G_CHASE = 0;
/** Speed along the body's heading, as a share of the top speed. */
export const G_DRIVE = 1;
/** How often the body picks a new heading: -512 never, +512 at the top rate. */
export const G_TURN = 2;
/** The body size at which a dividing cell lets its daughter go: -512 is 1 cell, +512 is `maxAdult`. */
export const G_ADULT = 3;
/** Where a daughter is put: above 0 along the heading (long bodies), below 0 across it (wide bodies). */
export const G_SHAPE = 4;
export const ROAM_GENE_NAMES = ['chase', 'drive', 'turn', 'adult', 'shape'] as const;
export const ROAM_GENE_MAX = 512;

/**
 * Growth by plan (config `plan`). A plan is a table of 16 modes. A cell is in one mode, and when it holds enough to
 * divide its mode says what to do: put the daughter on one side and keep it (acts 0 to 3: front, right, back, left of
 * the way the cell faces), put it there and let it go as a new body (4 to 7), or do nothing (8). The mode also names
 * the mode a kept daughter starts in and the mode the cell itself moves to. A cell faces away from its mother, and a
 * new body always starts in mode 0. When the tile is taken the cell waits.
 */
export const PLAN_MODES = 16;
export const PLAN_REST = 8;
/** One mode of a plan as a number: act, then the kept daughter's mode, then the cell's own next mode. */
export const planEntry = (act: number, child: number, next: number, kind = 0): number => act | (child << 4) | (next << 8) | (kind << 12);

/** With `kinds`, what a kept daughter becomes (bits 12-13 of a plan entry): plain, shell or mouth. */
export const KIND_PLAIN = 0;
export const KIND_SHELL = 1;
export const KIND_MOUTH = 2;
export const ROAM_KIND_NAMES = ['plain', 'shell', 'mouth'] as const;

export interface RoamConfig {
  /** Side of the square torus, in tiles. */
  size: number;
  seed: number;
  /** Total matter in the world. */
  matter: number;
  /** Matter in one patch of food. */
  patchFood: number;
  /** Radius of a patch, in tiles. */
  patchRadius: number;
  /** Fewest steps between two patches. */
  patchEvery: number;
  /** Patches already on the ground at step 0. */
  startPatches: number;
  /** Most a cell takes from its own tile in one step. */
  bite: number;
  /** A cell holding twice this divides; each half starts with about this much. */
  birthStore: number;
  /** A body holding less than this per cell gives up a cell. */
  minStore: number;
  /** Matter lost per step through each side of a cell that does not touch its own body. */
  leakSide: number;
  /** Matter lost per step by each cell, whatever its place in the body. */
  leakCell: number;
  /** Top speed, tiles per step (at most 1/2). */
  moveMax: number;
  /** Matter each cell pays per step at top speed. */
  moveCost: number;
  /** Top chance per step that a body picks a new heading. */
  turnMax: number;
  /** Largest adult size the adult gene can ask for. */
  maxAdult: number;
  /** Chance per gene that a daughter's copy differs. */
  mut: number;
  /** Size of one such change. */
  mutStep: number;
  /** Scent relaxation passes per step, and the share lost per pass as a power of two. */
  scentIters: number;
  scentDecayShift: number;
  /** How strongly a scent slope is read: 8 means a 1/8 relative slope already counts as full. */
  scentGain: number;
  /** Growth by plan instead of by the adult and shape genes. Absent means off. */
  plan?: boolean;
  /** With plans: a body this large lets go of a daughter its plan says to keep, the cell staying in its mode (32 when absent). */
  maxBody?: number;
  /** With plans: the chance that a new body's plan differs from its parent's in one place (0 when absent). */
  planMut?: number;
  /**
   * Where cells of two bodies touch, a body at least twice the size of the other takes this much matter per step
   * through that side from the smaller one's cell. Absent means bodies only block each other.
   */
  drain?: number;
  /**
   * With drain: for its first so many steps (100 when absent) a new body neither takes nor loses this way, and it
   * moves at top speed straight away from its parent.
   */
  seal?: number;
  /**
   * With plans: each cell keeps its own store instead of the body sharing one, and this share of the difference
   * between two bonded cells' stores flows from the fuller to the emptier each step (at most 1/8). A cell that falls
   * below minStore dies, so a body whose far parts are fed too slowly loses them, and breaks where a link dies. A cell
   * whose daughter dies goes back to the mode that made her, and a cell whose mother dies starts its plan again from
   * mode 0, so lost parts regrow and a broken-off piece grows like a cutting. There is no size limit. Absent means off.
   */
  flow?: number;
  /** With flow: each cell dies by wear with chance 1/life per step. Absent means cells do not wear out. */
  life?: number;
  /**
   * With flow: a dead cell's store stays on its tile as food (true) instead of going back to the reservoir, so a
   * body leaves food behind where its cells die. Absent means back to the reservoir.
   */
  compost?: boolean;
  /**
   * With flow: cells come in kinds, set by the plan entry that made them (kept daughters only; founders and let-go
   * cells are plain). A shell does not eat, pays a quarter of the side upkeep, and cannot be fed on by touch; a mouth
   * does not eat from the ground either, but is the only kind that can feed on another body by touch. Plain cells eat
   * and can be fed on. Plan copy errors can change a daughter's kind.
   */
  kinds?: boolean;
}

export function defaultRoamConfig(): RoamConfig {
  return {
    size: 128,
    seed: 1,
    matter: 160_000,
    patchFood: 4000,
    patchRadius: 4,
    patchEvery: 20,
    startPatches: 8,
    bite: 2,
    birthStore: 100,
    minStore: 16,
    leakSide: 1 / 64,
    leakCell: 1 / 256,
    moveMax: 1 / 4,
    moveCost: 1 / 32,
    turnMax: 1 / 64,
    maxAdult: 16,
    mut: 0.02,
    mutStep: 64,
    scentIters: 4,
    scentDecayShift: 11,
    scentGain: 8,
  };
}

/** Counter-based hash of (seed, step, tile, channel), the same mixer the droplet-genes kernel uses. */
export function roamHash(seed: number, step: number, tile: number, ch: number): number {
  let h = (seed ^ Math.imul(step, 0x9e3779b1) ^ Math.imul(tile, 0x85ebca6b) ^ Math.imul(ch, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const CH_PATCH = 1;
const CH_COST = 2;
const CH_TURN = 3;
const CH_HEAD = 4;
const CH_ORDER = 5;
const CH_TICK_X = 6;
const CH_TICK_Y = 7;
const CH_BUMP = 8;
const CH_PLACE = 9;
const CH_TIP = 10;
const CH_SHARE = 11;
const CH_TURNS = 12;
const CH_MUT = 16; // + gene index
const CH_PLAN = 30;
const CH_PLAN_NEW = 31;
const CH_PLAN_FIELD = 32;
const CH_FOUND = 40;
const CH_WEAR = 41;

const SCENT_FOOD_CAP = 4095;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function q16(x: number, name: string, max = 65536): number {
  const v = Math.round(x * 65536);
  if (!Number.isFinite(x) || v < 0 || v > max) throw new Error(`Invalid ${name}: ${x}`);
  return v;
}

function whole(x: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(x) || x < min || x > max) throw new Error(`Invalid ${name}: ${x}`);
  return x;
}

export interface RoamCensus {
  step: number;
  bodies: number;
  cells: number;
  /** Largest body, in cells, and how many bodies are a single cell. */
  largest: number;
  singles: number;
  /** Matter on the ground, in cells, and in the reservoir. */
  food: number;
  held: number;
  reservoir: number;
  /** Starting total minus the three above: 0 when matter is conserved. */
  residual: number;
  /** Mean of each gene over cells. */
  genes: number[];
  /** Counts since step 0. */
  divisions: number;
  releases: number;
  cellDeaths: number;
  bodyDeaths: number;
  /** Body deaths of a cell that was let go at birth and never divided: it was never part of a larger body. */
  newbornDeaths: number;
  /** Tiles moved, summed over cells. */
  cellMoves: number;
  blocked: number;
  patches: number;
  /** Matter larger bodies have taken from smaller ones they touch. */
  drained: number;
  flowed: number;
  worn: number;
  /** With compost: matter left on the ground as food by dead cells, since step 0. */
  composted: number;
  splits: number;
  /** With kinds: live shell and mouth cells. */
  shells: number;
  mouths: number;
}

export class RoamWorld {
  readonly cfg: RoamConfig;
  readonly size: number;
  readonly n: number;
  readonly total: number;
  step = 0;
  reservoir = 0;

  readonly food: Uint32Array;
  readonly alive: Uint8Array;
  readonly store: Uint32Array;
  readonly genes: Int16Array;
  readonly heading: Uint8Array;
  /** Bond from a tile's cell to the cell east of it, and to the cell south of it. */
  readonly bondE: Uint8Array;
  readonly bondS: Uint8Array;
  /** Founder family (for colour) and a serial number no two cells ever share. */
  readonly fam: Uint16Array;
  readonly cid: Uint32Array;
  /** 1 once the cell has divided or has been joined to another cell. */
  readonly grew: Uint8Array;
  nextCid = 1;
  /** With plans: each cell's plan (an index into `plans`), its mode, and the way it faces. */
  readonly pid: Uint32Array;
  readonly mode: Uint8Array;
  readonly orient: Uint8Array;
  /** Every plan there has been, from 1; a plan's parent is the plan it was copied from with one change (0: planted). */
  /** The step at which the cell's body was let go by its parent (0 for founders). */
  readonly since: Uint32Array;
  readonly plans: Uint16Array[] = [new Uint16Array(PLAN_MODES)];
  readonly planParent: number[] = [0];
  readonly planBorn: number[] = [0];
  scent: Uint32Array;
  private scentNext: Uint32Array;

  // Rebuilt every step: which body a tile's cell is in (0 = none), and each body's cells in walk order.
  readonly label: Int32Array;
  private readonly cells: Int32Array;
  private bodyStart: Int32Array;
  private bodyLen: Int32Array;
  private bodyVx: Int32Array;
  private bodyVy: Int32Array;
  bodyCount = 0;

  // Scratch for a rigid move.
  private readonly mStore: Uint32Array;
  private readonly mGenes: Int16Array;
  private readonly mMeta: Uint32Array;
  private readonly mCid: Uint32Array;
  private readonly mPid: Uint32Array;
  private readonly mKind: Uint8Array;
  /** With kinds: each cell's kind (KIND_PLAIN, KIND_SHELL, KIND_MOUTH). */
  readonly kind: Uint8Array;
  private readonly kinds: boolean;
  private readonly mSince: Uint32Array;
  private readonly takePer: Uint32Array;
  /** Matter taken by larger bodies from smaller ones since step 0. */
  drained = 0;
  /** With flow: the mode a cell's mother was in when she made it. */
  readonly made: Uint8Array;
  /**
   * 1 when the bonded cell behind this one is its mother (a kept daughter), 0 for founders, let-go cells and cells
   * whose mother died. Needed because a daughter kept behind her mother faces away from her, as a mother does.
   */
  readonly mom: Uint8Array;
  private readonly flowSnap: Uint32Array;
  private prevLabel: Int32Array;
  private splitSeen: Int32Array = new Int32Array(1024);
  /** With flow: matter moved along bonds, cells dead by wear, and bodies that broke into more than one. */
  flowed = 0;
  worn = 0;
  composted = 0;
  private readonly compost: boolean;
  splits = 0;

  divisions = 0;
  releases = 0;
  cellDeaths = 0;
  bodyDeaths = 0;
  newbornDeaths = 0;
  cellMoves = 0;
  blocked = 0;
  patches = 0;

  private readonly biteN: number;
  private readonly leakSideQ16: number;
  private readonly leakCellQ16: number;
  private readonly moveMaxQ16: number;
  private readonly moveCostQ16: number;
  private readonly turnMaxQ16: number;
  private readonly mutQ16: number;
  private readonly planMutQ16: number;
  private readonly maxBody: number;
  private readonly drainN: number;
  private readonly sealN: number;
  private readonly flowQ16: number;
  private readonly wearQ32: number;
  private readonly patchTiles: Int32Array;

  constructor(cfg: RoamConfig) {
    this.cfg = { ...cfg };
    const size = whole(cfg.size, 'size', 8, 1024);
    whole(cfg.seed, 'seed', 0, 0xffffffff);
    this.total = whole(cfg.matter, 'matter', 1, 0x7fffffff);
    whole(cfg.patchFood, 'patchFood', 1, this.total);
    whole(cfg.patchRadius, 'patchRadius', 0, (size >> 1) - 1);
    whole(cfg.patchEvery, 'patchEvery', 1, 1_000_000);
    whole(cfg.startPatches, 'startPatches', 0, 100_000);
    this.biteN = whole(cfg.bite, 'bite', 1, 1 << 20);
    whole(cfg.birthStore, 'birthStore', 1, 1 << 20);
    whole(cfg.minStore, 'minStore', 1, cfg.birthStore);
    whole(cfg.maxAdult, 'maxAdult', 1, 4096);
    whole(cfg.mutStep, 'mutStep', 1, 2 * ROAM_GENE_MAX);
    whole(cfg.scentIters, 'scentIters', 0, 64);
    whole(cfg.scentDecayShift, 'scentDecayShift', 1, 12);
    whole(cfg.scentGain, 'scentGain', 1, 1024);
    this.leakSideQ16 = q16(cfg.leakSide, 'leakSide');
    this.leakCellQ16 = q16(cfg.leakCell, 'leakCell');
    this.moveMaxQ16 = q16(cfg.moveMax, 'moveMax', 32768);
    this.moveCostQ16 = q16(cfg.moveCost, 'moveCost', 65536 * 16);
    this.turnMaxQ16 = q16(cfg.turnMax, 'turnMax');
    this.mutQ16 = q16(cfg.mut, 'mut');
    if (cfg.plan !== undefined && typeof cfg.plan !== 'boolean') throw new Error(`Invalid plan: ${cfg.plan}`);
    if (!cfg.plan && (cfg.maxBody !== undefined || cfg.planMut !== undefined)) throw new Error('maxBody and planMut need plan');
    this.maxBody = whole(cfg.maxBody ?? 32, 'maxBody', 1, 4096);
    this.planMutQ16 = q16(cfg.planMut ?? 0, 'planMut');
    if (cfg.drain === undefined && cfg.seal !== undefined) throw new Error('seal needs drain');
    this.drainN = cfg.drain === undefined ? 0 : whole(cfg.drain, 'drain', 1, 1 << 20);
    this.sealN = whole(cfg.seal ?? 100, 'seal', 0, 1_000_000);
    if (cfg.flow !== undefined && !cfg.plan) throw new Error('flow needs plan');
    if (cfg.flow === undefined && cfg.life !== undefined) throw new Error('life needs flow');
    this.flowQ16 = cfg.flow === undefined ? 0 : q16(cfg.flow, 'flow', 8192);
    if (cfg.flow !== undefined && this.flowQ16 < 1) throw new Error(`Invalid flow: ${cfg.flow}`);
    if (cfg.flow === undefined && cfg.compost !== undefined) throw new Error('compost needs flow');
    this.compost = cfg.compost === true;
    if (cfg.flow === undefined && cfg.kinds !== undefined) throw new Error('kinds needs flow');
    this.kinds = cfg.kinds === true;
    this.wearQ32 = cfg.life === undefined ? 0 : Math.floor(0x100000000 / whole(cfg.life, 'life', 2, 1 << 30));

    this.size = size;
    const n = (this.n = size * size);
    this.food = new Uint32Array(n);
    this.alive = new Uint8Array(n);
    this.store = new Uint32Array(n);
    this.genes = new Int16Array(n * ROAM_GENES);
    this.heading = new Uint8Array(n);
    this.bondE = new Uint8Array(n);
    this.bondS = new Uint8Array(n);
    this.fam = new Uint16Array(n);
    this.cid = new Uint32Array(n);
    this.grew = new Uint8Array(n);
    this.pid = new Uint32Array(n);
    this.mode = new Uint8Array(n);
    this.orient = new Uint8Array(n);
    this.since = new Uint32Array(n);
    this.scent = new Uint32Array(n);
    this.scentNext = new Uint32Array(n);
    this.label = new Int32Array(n);
    this.cells = new Int32Array(n);
    this.bodyStart = new Int32Array(1024);
    this.bodyLen = new Int32Array(1024);
    this.bodyVx = new Int32Array(1024);
    this.bodyVy = new Int32Array(1024);
    this.mStore = new Uint32Array(n);
    this.mGenes = new Int16Array(n * ROAM_GENES);
    this.mMeta = new Uint32Array(n);
    this.mCid = new Uint32Array(n);
    this.mPid = new Uint32Array(n);
    this.mKind = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.mSince = new Uint32Array(n);
    this.takePer = new Uint32Array(n);
    this.made = new Uint8Array(n);
    this.mom = new Uint8Array(n);
    this.flowSnap = new Uint32Array(this.flowQ16 > 0 ? n : 0);
    this.prevLabel = new Int32Array(this.flowQ16 > 0 ? n : 0);

    // The tiles of a patch as offsets from its centre, nearest first (the centre takes the remainder).
    const r = cfg.patchRadius;
    const offs: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offs.push(dx, dy);
    this.patchTiles = Int32Array.from(offs);

    this.reservoir = this.total;
    for (let k = 0; k < cfg.startPatches && this.reservoir >= cfg.patchFood; k++) this.dropPatch(roamHash(cfg.seed, 0, k, CH_FOUND));
  }

  private at(x: number, y: number): number {
    const s = this.size;
    return ((y + s) % s) * s + ((x + s) % s);
  }

  /** Tile one step from `i` in direction `d` (0 east, 1 south, 2 west, 3 north). */
  private nb(i: number, d: number): number {
    const s = this.size;
    const x = i % s;
    const y = (i - x) / s;
    return this.at(x + DX[d], y + DY[d]);
  }

  private dropPatch(rnd: number): void {
    const s = this.size;
    const cx = rnd % s;
    const cy = (rnd >>> 16) % s;
    const k = this.patchTiles.length >> 1;
    const each = Math.floor(this.cfg.patchFood / k);
    for (let j = 0; j < k; j++) this.food[this.at(cx + this.patchTiles[2 * j], cy + this.patchTiles[2 * j + 1])] += each;
    this.food[this.at(cx, cy)] += this.cfg.patchFood - each * k;
    this.reservoir -= this.cfg.patchFood;
    this.patches++;
  }

  /** Add a plan (16 modes, see `planEntry`) and return its number. `parent` is the plan it was copied from, if any. */
  addPlan(entries: ArrayLike<number>, parent = 0): number {
    if (!this.cfg.plan) throw new Error('addPlan needs plan growth');
    if (entries.length !== PLAN_MODES) throw new Error(`a plan has ${PLAN_MODES} modes`);
    whole(parent, 'parent plan', 0, this.plans.length - 1);
    const plan = new Uint16Array(PLAN_MODES);
    for (let m = 0; m < PLAN_MODES; m++) {
      const e = whole(entries[m], 'plan mode', 0, this.kinds ? 0x2fff : 0xfff);
      if ((e & 15) > PLAN_REST) throw new Error(`Invalid act in mode ${m}: ${e & 15}`);
      if (e >>> 12 > KIND_MOUTH) throw new Error(`Invalid kind in mode ${m}: ${e >>> 12}`);
      plan[m] = e;
    }
    this.plans.push(plan);
    this.planParent.push(parent);
    this.planBorn.push(this.step);
    return this.plans.length - 1;
  }

  /**
   * Put one founder cell on a free tile, paid for from the reservoir. Returns false when the tile is taken or the
   * reservoir cannot pay. With plan growth the founder needs a plan number from `addPlan`.
   */
  found(tile: number, genes: readonly number[], family: number, store = 2 * this.cfg.birthStore - 1, plan = 0): boolean {
    if (this.step !== 0) throw new Error('found() is for step 0');
    whole(tile, 'tile', 0, this.n - 1);
    whole(store, 'store', this.cfg.minStore, 0x7fffffff);
    if (genes.length !== ROAM_GENES) throw new Error(`found needs ${ROAM_GENES} genes`);
    for (const g of genes) whole(g, 'gene', -ROAM_GENE_MAX, ROAM_GENE_MAX);
    whole(family, 'family', 0, 0xffff);
    if (this.cfg.plan ? !(Number.isSafeInteger(plan) && plan >= 1 && plan < this.plans.length) : plan !== 0) throw new Error(`Invalid plan number: ${plan}`);
    if (this.alive[tile] || this.reservoir < store) return false;
    this.alive[tile] = 1;
    this.store[tile] = store;
    this.reservoir -= store;
    for (let g = 0; g < ROAM_GENES; g++) this.genes[tile * ROAM_GENES + g] = genes[g];
    this.heading[tile] = roamHash(this.cfg.seed, 0, tile, CH_HEAD) & 3;
    this.fam[tile] = family;
    this.cid[tile] = this.nextCid++;
    this.pid[tile] = plan;
    this.mode[tile] = 0;
    this.orient[tile] = this.heading[tile];
    return true;
  }

  private relaxScent(): void {
    const s = this.size;
    const n = this.n;
    const shift = this.cfg.scentDecayShift;
    for (let it = 0; it < this.cfg.scentIters; it++) {
      const a = this.scent;
      const b = this.scentNext;
      for (let i = 0; i < n; i++) {
        const x = i % s;
        const row = i - x;
        const e = a[row + (x + 1 === s ? 0 : x + 1)];
        const w = a[row + (x === 0 ? s - 1 : x - 1)];
        const so = a[i + s >= n ? i + s - n : i + s];
        const no = a[i - s < 0 ? i - s + n : i - s];
        let v = Math.floor((4 * a[i] + e + w + so + no) / 8);
        v -= Math.floor(v / (1 << shift));
        const f = this.food[i];
        b[i] = v + (f > SCENT_FOOD_CAP ? SCENT_FOOD_CAP : f) * 64;
      }
      this.scent = b;
      this.scentNext = a;
    }
  }

  /** Find the bonded groups. Bodies are numbered from 1 in order of their lowest tile. */
  private labelBodies(): void {
    const n = this.n;
    const label = this.label;
    const cells = this.cells;
    const flow = this.flowQ16 > 0;
    if (flow) this.prevLabel.set(label);
    label.fill(0);
    let count = 0;
    let fill = 0;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i] || label[i] !== 0) continue;
      count++;
      if (count >= this.bodyStart.length) this.growBodies();
      const start = fill;
      label[i] = count;
      cells[fill++] = i;
      for (let q = start; q < fill; q++) {
        const c = cells[q];
        const e = this.nb(c, 0);
        const so = this.nb(c, 1);
        const w = this.nb(c, 2);
        const no = this.nb(c, 3);
        if (this.bondE[c] && label[e] === 0) { label[e] = count; cells[fill++] = e; }
        if (this.bondS[c] && label[so] === 0) { label[so] = count; cells[fill++] = so; }
        if (this.bondE[w] && label[w] === 0) { label[w] = count; cells[fill++] = w; }
        if (this.bondS[no] && label[no] === 0) { label[no] = count; cells[fill++] = no; }
      }
      this.bodyStart[count] = start;
      this.bodyLen[count] = fill - start;
    }
    this.bodyCount = count;
    if (flow) {
      // A body broke when two of this step's bodies hold cells that were one body's last step.
      let seen = this.splitSeen;
      let most = 0;
      for (let k = 1; k <= count; k++) {
        for (let j = 0; j < this.bodyLen[k]; j++) {
          const old = this.prevLabel[cells[this.bodyStart[k] + j]];
          if (old > most) most = old;
        }
      }
      if (seen.length <= most) seen = this.splitSeen = new Int32Array(2 * most + 2);
      seen.fill(0, 0, most + 1);
      for (let k = 1; k <= count; k++) {
        for (let j = 0; j < this.bodyLen[k]; j++) {
          const old = this.prevLabel[cells[this.bodyStart[k] + j]];
          if (old <= 0) continue;
          if (seen[old] === 0) seen[old] = k;
          else if (seen[old] !== k) { this.splits++; seen[old] = k; }
        }
      }
    }
  }

  private growBodies(): void {
    const grow = (a: Int32Array) => { const b = new Int32Array(a.length * 2); b.set(a); return b; };
    this.bodyStart = grow(this.bodyStart);
    this.bodyLen = grow(this.bodyLen);
    this.bodyVx = grow(this.bodyVx);
    this.bodyVy = grow(this.bodyVy);
  }

  private removeCell(c: number): void {
    this.alive[c] = 0;
    this.store[c] = 0;
    this.label[c] = 0;
    this.cid[c] = 0;
    this.grew[c] = 0;
    this.pid[c] = 0;
    this.mode[c] = 0;
    this.orient[c] = 0;
    this.since[c] = 0;
    this.made[c] = 0;
    this.mom[c] = 0;
    this.kind[c] = 0;
    this.bondE[c] = 0;
    this.bondS[c] = 0;
    this.bondE[this.nb(c, 2)] = 0;
    this.bondS[this.nb(c, 3)] = 0;
    this.cellDeaths++;
  }

  /** One body's step before moving: where it wants to go, eating, paying, starving, sharing. */
  private live(k: number): void {
    if (this.flowQ16 > 0) return this.liveFlow(k);
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const start = this.bodyStart[k];
    let len = this.bodyLen[k];
    const anchor = this.cells[start];
    const label = this.label;
    const newborn = len === 1 && this.grew[anchor] === 0;

    // A new heading for the whole body, at the mean rate its cells ask for.
    let turnSum = 0;
    for (let j = 0; j < len; j++) turnSum += this.genes[this.cells[start + j] * ROAM_GENES + G_TURN] + ROAM_GENE_MAX;
    const turnQ16 = Math.floor((Math.floor(turnSum / len) * this.turnMaxQ16) / (2 * ROAM_GENE_MAX));
    let head = this.heading[anchor];
    // A new body in a world with drain spends its first steps getting away from its parent.
    const dash = this.drainN > 0 && t - this.since[anchor] < this.sealN;
    if (!dash && (roamHash(seed, t, anchor, CH_TURN) & 0xffff) < turnQ16) head = roamHash(seed, t, anchor, CH_HEAD) & 3;

    // Each cell votes: toward stronger scent by its chase gene, along the heading by its drive gene.
    let ux = 0;
    let uy = 0;
    let pool = 0;
    let exposed = 0;
    const gain = cfg.scentGain;
    for (let j = 0; j < len; j++) {
      const c = this.cells[start + j];
      this.heading[c] = head;
      const e = this.nb(c, 0);
      const so = this.nb(c, 1);
      const w = this.nb(c, 2);
      const no = this.nb(c, 3);
      if (label[e] !== k) exposed++;
      if (label[so] !== k) exposed++;
      if (label[w] !== k) exposed++;
      if (label[no] !== k) exposed++;
      const chase = this.genes[c * ROAM_GENES + G_CHASE];
      if (chase !== 0) {
        const se = this.scent[e];
        const sw = this.scent[w];
        const ss = this.scent[so];
        const sn = this.scent[no];
        let gx = Math.trunc(((se - sw) * 1024 * gain) / (se + sw + 1));
        let gy = Math.trunc(((ss - sn) * 1024 * gain) / (ss + sn + 1));
        gx = gx > 1024 ? 1024 : gx < -1024 ? -1024 : gx;
        gy = gy > 1024 ? 1024 : gy < -1024 ? -1024 : gy;
        ux += Math.trunc((chase * gx) / 1024);
        uy += Math.trunc((chase * gy) / 1024);
      }
      const drive = this.genes[c * ROAM_GENES + G_DRIVE];
      ux += drive * DX[head];
      uy += drive * DY[head];
      pool += this.store[c];
    }
    const top = this.moveMaxQ16;
    let vx = Math.trunc((top * Math.trunc(ux / len)) / ROAM_GENE_MAX);
    let vy = Math.trunc((top * Math.trunc(uy / len)) / ROAM_GENE_MAX);
    vx = vx > top ? top : vx < -top ? -top : vx;
    vy = vy > top ? top : vy < -top ? -top : vy;
    if (dash) { vx = top * DX[head]; vy = top * DY[head]; }
    this.bodyVx[k] = vx;
    this.bodyVy[k] = vy;

    // Eat: each cell from its own tile, into the shared store, up to four births' worth per cell.
    let room = len * 4 * cfg.birthStore - pool;
    for (let j = 0; j < len && room > 0; j++) {
      const c = this.cells[start + j];
      let take = this.food[c];
      if (take > this.biteN) take = this.biteN;
      if (take > room) take = room;
      this.food[c] -= take;
      pool += take;
      room -= take;
    }

    // Pay: a leak through every outside face, a little per cell, and the effort of moving.
    const effortQ16 = top > 0 ? Math.min(65536, Math.floor(((Math.abs(vx) + Math.abs(vy)) * 65536) / top)) : 0;
    const costQ16 = exposed * this.leakSideQ16 + len * this.leakCellQ16 + len * Math.floor((this.moveCostQ16 * effortQ16) / 65536);
    let pay = Math.floor((costQ16 + (roamHash(seed, t, anchor, CH_COST) & 0xffff)) / 65536);
    if (pay > pool) pay = pool;
    pool -= pay;
    this.reservoir += pay;

    // Starve: give up a tip of the body (a cell with one bond), which tip by a hash, until the rest can be kept.
    while (len > 0 && pool < len * cfg.minStore) {
      let at = len - 1;
      let best = -1;
      for (let j = 0; j < len && len > 1; j++) {
        const c = this.cells[start + j];
        if (this.bondE[c] + this.bondS[c] + this.bondE[this.nb(c, 2)] + this.bondS[this.nb(c, 3)] !== 1) continue;
        const h = roamHash(seed, t, c, CH_TIP);
        if (best < 0 || h < best) { best = h; at = j; }
      }
      this.removeCell(this.cells[start + at]);
      this.cells[start + at] = this.cells[start + len - 1];
      len--;
    }
    this.bodyLen[k] = len;
    if (len === 0) {
      this.reservoir += pool;
      this.bodyDeaths++;
      if (newborn) this.newbornDeaths++;
      return;
    }
    const each = Math.floor(pool / len);
    const extra = pool - each * len;
    // The odd units go to a run of cells that starts at a hash-chosen place in the walk.
    const from = roamHash(seed, t, anchor, CH_SHARE) % len;
    for (let j = 0; j < len; j++) this.store[this.cells[start + ((from + j) % len)]] = each + (j < extra ? 1 : 0);
  }

  /** Slide body `k` one tile; false (and nothing changes) when a tile it needs holds another body's cell. */
  private tryMove(k: number, dx: number, dy: number): boolean {
    const s = this.size;
    const start = this.bodyStart[k];
    const len = this.bodyLen[k];
    const cells = this.cells;
    for (let j = 0; j < len; j++) {
      const c = cells[start + j];
      const x = c % s;
      const to = this.at(x + dx, (c - x) / s + dy);
      if (this.alive[to] && this.label[to] !== k) return false;
    }
    for (let j = 0; j < len; j++) {
      const c = cells[start + j];
      this.mStore[j] = this.store[c];
      this.mCid[j] = this.cid[c];
      this.mMeta[j] = (this.heading[c] | (this.bondE[c] << 2) | (this.bondS[c] << 3) | (this.fam[c] << 4) | (this.grew[c] << 20) | (this.orient[c] << 21) | (this.mode[c] << 23) | (this.made[c] << 27) | (this.mom[c] << 31)) >>> 0;
      this.mPid[j] = this.pid[c];
      this.mKind[j] = this.kind[c];
      this.kind[c] = 0;
      this.mSince[j] = this.since[c];
      this.since[c] = 0;
      this.pid[c] = 0;
      this.mode[c] = 0;
      this.orient[c] = 0;
      this.made[c] = 0;
      this.mom[c] = 0;
      for (let g = 0; g < ROAM_GENES; g++) this.mGenes[j * ROAM_GENES + g] = this.genes[c * ROAM_GENES + g];
      this.alive[c] = 0;
      this.store[c] = 0;
      this.cid[c] = 0;
      this.grew[c] = 0;
      this.bondE[c] = 0;
      this.bondS[c] = 0;
      this.label[c] = 0;
    }
    for (let j = 0; j < len; j++) {
      const c = cells[start + j];
      const x = c % s;
      const to = this.at(x + dx, (c - x) / s + dy);
      const meta = this.mMeta[j];
      this.alive[to] = 1;
      this.store[to] = this.mStore[j];
      this.cid[to] = this.mCid[j];
      this.heading[to] = meta & 3;
      this.bondE[to] = (meta >>> 2) & 1;
      this.bondS[to] = (meta >>> 3) & 1;
      this.fam[to] = (meta >>> 4) & 0xffff;
      this.grew[to] = (meta >>> 20) & 1;
      this.orient[to] = (meta >>> 21) & 3;
      this.mode[to] = (meta >>> 23) & 15;
      this.made[to] = (meta >>> 27) & 15;
      this.mom[to] = meta >>> 31;
      this.pid[to] = this.mPid[j];
      this.kind[to] = this.mKind[j];
      this.since[to] = this.mSince[j];
      for (let g = 0; g < ROAM_GENES; g++) this.genes[to * ROAM_GENES + g] = this.mGenes[j * ROAM_GENES + g];
      this.label[to] = k;
      cells[start + j] = to;
    }
    this.cellMoves += len;
    return true;
  }

  private move(k: number): void {
    const len = this.bodyLen[k];
    if (len === 0) return;
    const seed = this.cfg.seed;
    const t = this.step;
    // The ticks are keyed on the body's lowest tile as found this step, before anything moved.
    const key = this.moveKey[k];
    const vx = this.bodyVx[k];
    const vy = this.bodyVy[k];
    const dx = (roamHash(seed, t, key, CH_TICK_X) & 0xffff) < Math.abs(vx) ? Math.sign(vx) : 0;
    const dy = (roamHash(seed, t, key, CH_TICK_Y) & 0xffff) < Math.abs(vy) ? Math.sign(vy) : 0;
    if (dx === 0 && dy === 0) return;
    if (this.tryMove(k, dx, dy)) return;
    const bump = roamHash(seed, t, key, CH_BUMP);
    // A blocked diagonal tries one axis and then the other, which first by a coin.
    if (dx !== 0 && dy !== 0) {
      const xFirst = (bump & 4) !== 0;
      if (xFirst ? this.tryMove(k, dx, 0) || this.tryMove(k, 0, dy) : this.tryMove(k, 0, dy) || this.tryMove(k, dx, 0)) return;
    }
    // Blocked: the body picks a new heading, unless it is a new body still running from its parent.
    this.blocked++;
    if (this.drainN > 0 && t - this.since[this.cells[this.bodyStart[k]]] < this.sealN) return;
    const head = bump & 3;
    const start = this.bodyStart[k];
    for (let j = 0; j < len; j++) this.heading[this.cells[start + j]] = head;
  }
  private moveKey = new Int32Array(1024);
  private order = new Int32Array(1024);
  private orderKey = new Float64Array(1024);

  private adultSize(gene: number): number {
    const a = 1 + Math.floor(((gene + ROAM_GENE_MAX) * (this.cfg.maxAdult - 1)) / (2 * ROAM_GENE_MAX));
    return a > this.cfg.maxAdult ? this.cfg.maxAdult : a;
  }

  /** Cells holding two births' worth divide onto a free tile beside them; the daughter stays bonded while the body is under its adult size. */
  private divide(k: number): void {
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const start = this.bodyStart[k];
    const len = this.bodyLen[k];
    let size = len;
    // Which cell gets the first turn is drawn afresh each step.
    const from = len > 0 ? roamHash(seed, t, this.moveKey[k], CH_TURNS) % len : 0;
    for (let j = 0; j < len; j++) {
      const c = this.cells[start + ((from + j) % len)];
      if (this.store[c] < 2 * cfg.birthStore) continue;
      const head = this.heading[c];
      const shape = this.genes[c * ROAM_GENES + G_SHAPE];
      // Weighted draw among the free tiles beside the cell.
      let sum = 0;
      const w = [0, 0, 0, 0];
      for (let d = 0; d < 4; d++) {
        if (this.alive[this.nb(c, d)]) continue;
        w[d] = 32 + ROAM_GENE_MAX + (((d - head) & 1) === 0 ? shape : -shape);
        sum += w[d];
      }
      if (sum === 0) continue;
      let pick = roamHash(seed, t, c, CH_PLACE) % sum;
      let d = 0;
      while (pick >= w[d]) pick -= w[d++];
      const to = this.nb(c, d);
      const half = this.store[c] >>> 1;
      this.store[c] -= half;
      this.alive[to] = 1;
      this.store[to] = half;
      this.fam[to] = this.fam[c];
      this.cid[to] = this.nextCid++;
      for (let g = 0; g < ROAM_GENES; g++) {
        let v = this.genes[c * ROAM_GENES + g];
        const r = roamHash(seed, t, c, CH_MUT + g);
        if ((r & 0xffff) < this.mutQ16) {
          v += (r >>> 16) & 1 ? cfg.mutStep : -cfg.mutStep;
          v = v > ROAM_GENE_MAX ? ROAM_GENE_MAX : v < -ROAM_GENE_MAX ? -ROAM_GENE_MAX : v;
        }
        this.genes[to * ROAM_GENES + g] = v;
      }
      this.divisions++;
      this.grew[c] = 1;
      this.grew[to] = 0;
      if (size < this.adultSize(this.genes[c * ROAM_GENES + G_ADULT])) {
        if (d === 0) this.bondE[c] = 1;
        else if (d === 1) this.bondS[c] = 1;
        else if (d === 2) this.bondE[to] = 1;
        else this.bondS[to] = 1;
        this.heading[to] = head;
        this.label[to] = k;
        this.grew[to] = 1;
        this.since[to] = this.since[c];
        size++;
      } else {
        // Let go: a new body of one cell, heading away from its parent.
        this.since[to] = t;
        this.heading[to] = d;
        this.label[to] = -1;
        this.releases++;
      }
    }
  }

  /**
   * Growth by plan: a cell holding two births' worth does what its mode says. A kept daughter gets an exact copy of
   * everything; a daughter that is let go starts a new body in mode 0, and copy errors happen only there.
   */
  private dividePlan(k: number): void {
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const start = this.bodyStart[k];
    const len = this.bodyLen[k];
    let size = len;
    // The cells that can divide take their turns in an order drawn afresh for each cell each step.
    let ready: number[] | null = null;
    for (let j = 0; j < len; j++) {
      const c = this.cells[start + j];
      if (this.store[c] >= 2 * cfg.birthStore && (this.plans[this.pid[c]][this.mode[c]] & 15) < PLAN_REST) (ready ??= []).push(c);
    }
    if (ready === null) return;
    if (ready.length > 1) ready.sort((a, b) => roamHash(seed, t, a, CH_TURNS) - roamHash(seed, t, b, CH_TURNS) || a - b);
    for (const c of ready) {
      const entry = this.plans[this.pid[c]][this.mode[c]];
      const act = entry & 15;
      const d = (this.orient[c] + (act & 3)) & 3;
      const to = this.nb(c, d);
      if (this.alive[to]) {
        // With flow, a daughter's tile already held by the cell's own body counts as done (a regrown part's place).
        if (this.flowQ16 > 0 && act < 4 && this.label[to] === k) this.mode[c] = (entry >>> 8) & 15;
        continue;
      }
      // At the size limit a daughter the plan says to keep is let go instead, and the cell stays in its mode.
      const full = act < 4 && this.flowQ16 === 0 && size >= this.maxBody;
      const keep = act < 4 && !full;
      const half = this.store[c] >>> 1;
      this.store[c] -= half;
      this.alive[to] = 1;
      this.store[to] = half;
      this.fam[to] = this.fam[c];
      this.cid[to] = this.nextCid++;
      this.orient[to] = d;
      this.made[to] = this.mode[c];
      this.mom[to] = keep ? 1 : 0;
      this.kind[to] = keep && this.kinds ? entry >>> 12 : KIND_PLAIN;
      if (!full) this.mode[c] = (entry >>> 8) & 15;
      this.divisions++;
      this.grew[c] = 1;
      if (keep) {
        // With flow, a kept daughter's genes can change (at the let-go rate) and her plan too (at an eighth of it),
        // so a piece that breaks off can carry new genes or a new plan; without flow kept daughters are exact copies.
        // (With flow bodies reproduce almost only by breaking, so without this the genes would never change.)
        for (let g = 0; g < ROAM_GENES; g++) {
          let v = this.genes[c * ROAM_GENES + g];
          if (this.flowQ16 > 0) {
            const r = roamHash(seed, t, c, CH_MUT + g);
            if ((r & 0xffff) < this.mutQ16) {
              v += (r >>> 16) & 1 ? cfg.mutStep : -cfg.mutStep;
              v = v > ROAM_GENE_MAX ? ROAM_GENE_MAX : v < -ROAM_GENE_MAX ? -ROAM_GENE_MAX : v;
            }
          }
          this.genes[to * ROAM_GENES + g] = v;
        }
        this.pid[to] = this.flowQ16 > 0 ? this.copyPlan(c, this.planMutQ16 >>> 3) : this.pid[c];
        this.mode[to] = (entry >>> 4) & 15;
        if (d === 0) this.bondE[c] = 1;
        else if (d === 1) this.bondS[c] = 1;
        else if (d === 2) this.bondE[to] = 1;
        else this.bondS[to] = 1;
        this.heading[to] = this.heading[c];
        this.label[to] = k;
        this.grew[to] = 1;
        this.since[to] = this.since[c];
        size++;
        continue;
      }
      for (let g = 0; g < ROAM_GENES; g++) {
        let v = this.genes[c * ROAM_GENES + g];
        const r = roamHash(seed, t, c, CH_MUT + g);
        if ((r & 0xffff) < this.mutQ16) {
          v += (r >>> 16) & 1 ? cfg.mutStep : -cfg.mutStep;
          v = v > ROAM_GENE_MAX ? ROAM_GENE_MAX : v < -ROAM_GENE_MAX ? -ROAM_GENE_MAX : v;
        }
        this.genes[to * ROAM_GENES + g] = v;
      }
      this.pid[to] = this.copyPlan(c, this.planMutQ16);
      this.since[to] = t;
      this.mode[to] = 0;
      this.heading[to] = d;
      this.label[to] = -1;
      this.grew[to] = 0;
      this.releases++;
    }
  }

  /** Cell `c`'s plan as a daughter gets it: with chance rateQ16/65536 one place changes to a different value. */
  private copyPlan(c: number, rateQ16: number): number {
    const seed = this.cfg.seed;
    const t = this.step;
    const pid = this.pid[c];
    const r = roamHash(seed, t, c, CH_PLAN);
    if ((r & 0xffff) >= rateQ16) return pid;
    // One place of the plan changes to a different value: a mode's act, its daughter's mode, its next mode, or (with
    // kinds) its daughter's kind.
    const next = Uint16Array.from(this.plans[pid]);
    const m = (r >>> 16) & 15;
    const field = roamHash(seed, t, c, CH_PLAN_FIELD) % (this.kinds ? 4 : 3);
    const h = roamHash(seed, t, c, CH_PLAN_NEW);
    const e = next[m];
    const act0 = e & 15;
    const child0 = (e >>> 4) & 15;
    const next0 = (e >>> 8) & 15;
    const kind0 = e >>> 12;
    if (field === 0) next[m] = planEntry((act0 + 1 + (h % PLAN_REST)) % (PLAN_REST + 1), child0, next0, kind0);
    else if (field === 1) next[m] = planEntry(act0, (child0 + 1 + (h % 15)) & 15, next0, kind0);
    else if (field === 2) next[m] = planEntry(act0, child0, (next0 + 1 + (h % 15)) & 15, kind0);
    else next[m] = planEntry(act0, child0, next0, (kind0 + 1 + (h % 2)) % 3);
    return this.addPlan(next, pid);
  }

  /**
   * Where two bodies touch and one is at least twice the other's size, it takes matter from the smaller, side by side. What a cell gives through each
   * side is settled from what it held before anything was taken, so the order of tiles makes no difference.
   */
  private drainSmaller(): void {
    const n = this.n;
    const label = this.label;
    const len = this.bodyLen;
    const t = this.step;
    const seal = this.sealN;
    const take = this.takePer;
    // With kinds only a mouth feeds, and never through a shell.
    const kinds = this.kinds;
    const loses = (b: number, a: number): boolean =>
      this.alive[a] === 1 && label[a] !== label[b] && len[label[a]] >= 2 * len[label[b]] && t - this.since[a] >= seal &&
      (!kinds || (this.kind[a] === KIND_MOUTH && this.kind[b] !== KIND_SHELL));
    for (let b = 0; b < n; b++) {
      take[b] = 0;
      if (!this.alive[b] || t - this.since[b] < seal) continue;
      let sides = 0;
      for (let d = 0; d < 4; d++) if (loses(b, this.nb(b, d))) sides++;
      if (sides > 0) take[b] = Math.min(this.drainN, Math.floor(this.store[b] / sides));
    }
    for (let b = 0; b < n; b++) {
      const each = take[b];
      if (each === 0) continue;
      for (let d = 0; d < 4; d++) {
        const a = this.nb(b, d);
        if (!loses(b, a)) continue;
        this.store[b] -= each;
        this.store[a] += each;
        this.drained += each;
      }
    }
  }

  /** True when the cell at `a` is bonded to its neighbour in direction `d`. */
  private bonded(a: number, d: number): boolean {
    return d === 0 ? this.bondE[a] === 1 : d === 1 ? this.bondS[a] === 1 : d === 2 ? this.bondE[this.nb(a, 2)] === 1 : this.bondS[this.nb(a, 3)] === 1;
  }

  /**
   * With flow, the cells of one body that die this step: each one's mother (bonded, the way it faces back) returns to
   * the mode that made it, so she regrows it, and each one's daughters (bonded, facing away from it) start their plans
   * again from mode 0. All resets are read with every bond still in place and settled before any cell is removed, so
   * the order of the dying makes no difference: a survivor whose mother died starts from 0; one that lost only
   * daughters returns to the earliest mode among those that made them. Their stores go back to the reservoir, or with compost stay on their tiles as food.
   */
  private dieFlow(dying: number[]): void {
    const gone = new Set(dying);
    const zero = new Set<number>();
    const back = new Map<number, number>();
    for (const c of dying) {
      for (let d = 0; d < 4; d++) {
        if (!this.bonded(c, d)) continue;
        const o = this.nb(c, d);
        if (gone.has(o)) continue;
        // A daughter faces away from her mother, so her mother is behind her; `mom` says whether the cell behind is
        // a mother at all (two cells back to back each have the other behind them, and only one is the daughter).
        if (this.mom[o] === 1 && this.orient[o] === d) zero.add(o);
        else if (this.mom[c] === 1 && d === ((this.orient[c] + 2) & 3)) {
          const m = back.get(o);
          if (m === undefined || this.made[c] < m) back.set(o, this.made[c]);
        }
      }
    }
    for (const [o, m] of back) this.mode[o] = m;
    for (const o of zero) { this.mode[o] = 0; this.mom[o] = 0; }
    for (const c of dying) {
      if (this.compost) {
        this.food[c] += this.store[c];
        this.composted += this.store[c];
      } else this.reservoir += this.store[c];
      this.removeCell(c);
    }
  }

  /** One body's step with flow: heading and speed as without it, then each cell eats, pays, and may die on its own. */
  private liveFlow(k: number): void {
    const cfg = this.cfg;
    const seed = cfg.seed;
    const t = this.step;
    const start = this.bodyStart[k];
    let len = this.bodyLen[k];
    const anchor = this.cells[start];
    const label = this.label;
    const newborn = len === 1 && this.grew[anchor] === 0;

    let turnSum = 0;
    for (let j = 0; j < len; j++) turnSum += this.genes[this.cells[start + j] * ROAM_GENES + G_TURN] + ROAM_GENE_MAX;
    const turnQ16 = Math.floor((Math.floor(turnSum / len) * this.turnMaxQ16) / (2 * ROAM_GENE_MAX));
    let head = this.heading[anchor];
    const dash = this.drainN > 0 && t - this.since[anchor] < this.sealN;
    if (!dash && (roamHash(seed, t, anchor, CH_TURN) & 0xffff) < turnQ16) head = roamHash(seed, t, anchor, CH_HEAD) & 3;

    let ux = 0;
    let uy = 0;
    const gain = cfg.scentGain;
    for (let j = 0; j < len; j++) {
      const c = this.cells[start + j];
      this.heading[c] = head;
      const chase = this.genes[c * ROAM_GENES + G_CHASE];
      if (chase !== 0) {
        const se = this.scent[this.nb(c, 0)];
        const sw = this.scent[this.nb(c, 2)];
        const ss = this.scent[this.nb(c, 1)];
        const sn = this.scent[this.nb(c, 3)];
        let gx = Math.trunc(((se - sw) * 1024 * gain) / (se + sw + 1));
        let gy = Math.trunc(((ss - sn) * 1024 * gain) / (ss + sn + 1));
        gx = gx > 1024 ? 1024 : gx < -1024 ? -1024 : gx;
        gy = gy > 1024 ? 1024 : gy < -1024 ? -1024 : gy;
        ux += Math.trunc((chase * gx) / 1024);
        uy += Math.trunc((chase * gy) / 1024);
      }
      const drive = this.genes[c * ROAM_GENES + G_DRIVE];
      ux += drive * DX[head];
      uy += drive * DY[head];
    }
    const top = this.moveMaxQ16;
    let vx = Math.trunc((top * Math.trunc(ux / len)) / ROAM_GENE_MAX);
    let vy = Math.trunc((top * Math.trunc(uy / len)) / ROAM_GENE_MAX);
    vx = vx > top ? top : vx < -top ? -top : vx;
    vy = vy > top ? top : vy < -top ? -top : vy;
    if (dash) { vx = top * DX[head]; vy = top * DY[head]; }
    this.bodyVx[k] = vx;
    this.bodyVy[k] = vy;
    const effortQ16 = top > 0 ? Math.min(65536, Math.floor(((Math.abs(vx) + Math.abs(vy)) * 65536) / top)) : 0;
    const moveQ16 = Math.floor((this.moveCostQ16 * effortQ16) / 65536);
    const cap = 4 * cfg.birthStore;

    // Each cell eats from its own tile into its own store, pays its own leak, and dies when it runs low or wears out.
    // Fates are decided with the body whole and the dead removed after, so the order of cells makes no difference.
    const dying: number[] = [];
    for (let j = 0; j < len; j++) {
      const c = this.cells[start + j];
      // With kinds neither a shell nor a mouth eats from the ground, and a shell pays a quarter of the side upkeep.
      const shell = this.kinds && this.kind[c] === KIND_SHELL;
      let take = this.kinds && this.kind[c] !== KIND_PLAIN ? 0 : this.food[c];
      if (take > this.biteN) take = this.biteN;
      if (take > cap - this.store[c]) take = Math.max(0, cap - this.store[c]);
      this.food[c] -= take;
      this.store[c] += take;
      let exposed = 0;
      for (let d = 0; d < 4; d++) if (label[this.nb(c, d)] !== k) exposed++;
      const costQ16 = exposed * (shell ? this.leakSideQ16 >>> 2 : this.leakSideQ16) + this.leakCellQ16 + moveQ16;
      let pay = Math.floor((costQ16 + (roamHash(seed, t, c, CH_COST) & 0xffff)) / 65536);
      if (pay > this.store[c]) pay = this.store[c];
      this.store[c] -= pay;
      this.reservoir += pay;
      const worn = this.wearQ32 > 0 && roamHash(seed, t, c, CH_WEAR) < this.wearQ32;
      if (this.store[c] < cfg.minStore || worn) {
        if (worn && this.store[c] >= cfg.minStore) this.worn++;
        dying.push(c);
      }
    }
    if (dying.length > 0) {
      this.dieFlow(dying);
      let w = 0;
      for (let j = 0; j < len; j++) {
        const c = this.cells[start + j];
        if (this.alive[c]) this.cells[start + w++] = c;
      }
      len = w;
    }
    this.bodyLen[k] = len;
    if (len === 0) {
      this.bodyDeaths++;
      if (newborn) this.newbornDeaths++;
    }
  }

  /**
   * With flow: along every bond, a share of the difference between the two stores moves to the emptier cell, each
   * amount settled from the stores before any moved (so tile order makes no difference). A cell has at most four
   * bonds and gives at most an eighth of the difference through each, so no store goes below zero.
   */
  private flowAlongBonds(): void {
    const n = this.n;
    const snap = this.flowSnap;
    snap.set(this.store);
    const q = this.flowQ16;
    for (let a = 0; a < n; a++) {
      if (!this.alive[a]) continue;
      for (let d = 0; d < 2; d++) {
        if (!(d === 0 ? this.bondE[a] : this.bondS[a])) continue;
        const b = this.nb(a, d);
        const sa = snap[a];
        const sb = snap[b];
        const diff = sa > sb ? sa - sb : sb - sa;
        const amount = Math.floor((diff * q) / 65536);
        if (amount === 0) continue;
        if (sa > sb) { this.store[a] -= amount; this.store[b] += amount; }
        else { this.store[b] -= amount; this.store[a] += amount; }
        this.flowed += amount;
      }
    }
  }

  stepOnce(): void {
    const cfg = this.cfg;
    const t = this.step;
    if (t > 0 && t % cfg.patchEvery === 0 && this.reservoir >= cfg.patchFood) this.dropPatch(roamHash(cfg.seed, t, 0, CH_PATCH));
    this.relaxScent();
    this.labelBodies();
    const count = this.bodyCount;
    if (this.moveKey.length <= count) this.moveKey = new Int32Array(this.bodyStart.length);
    for (let k = 1; k <= count; k++) {
      this.moveKey[k] = this.cells[this.bodyStart[k]];
      this.live(k);
    }
    if (count > 0) {
      // The order bodies move and divide in is drawn afresh each step: sorted by a hash of where each one was.
      if (this.order.length <= count) { this.order = new Int32Array(this.bodyStart.length); this.orderKey = new Float64Array(this.bodyStart.length); }
      const order = this.order.subarray(0, count);
      const key = this.orderKey;
      for (let q = 0; q < count; q++) { order[q] = q + 1; key[q + 1] = roamHash(cfg.seed, t, this.moveKey[q + 1], CH_ORDER); }
      order.sort((a, b) => key[a] - key[b] || a - b);
      for (let q = 0; q < count; q++) this.move(order[q]);
      if (this.drainN > 0) this.drainSmaller();
      if (this.flowQ16 > 0) this.flowAlongBonds();
      if (cfg.plan) { for (let q = 0; q < count; q++) if (this.bodyLen[order[q]] > 0) this.dividePlan(order[q]); }
      else for (let q = 0; q < count; q++) if (this.bodyLen[order[q]] > 0) this.divide(order[q]);
    }
    this.step++;
  }

  advance(steps: number): void {
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  /** Read-only count of what is there. Body counts are found afresh, so it can be called at any step. */
  census(): RoamCensus {
    const n = this.n;
    let food = 0;
    let held = 0;
    let cells = 0;
    let shells = 0;
    let mouths = 0;
    const genes = new Array<number>(ROAM_GENES).fill(0);
    for (let i = 0; i < n; i++) {
      food += this.food[i];
      if (!this.alive[i]) continue;
      cells++;
      if (this.kind[i] === KIND_SHELL) shells++;
      else if (this.kind[i] === KIND_MOUTH) mouths++;
      held += this.store[i];
      for (let g = 0; g < ROAM_GENES; g++) genes[g] += this.genes[i * ROAM_GENES + g];
    }
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
      newbornDeaths: this.newbornDeaths,
      cellMoves: this.cellMoves,
      blocked: this.blocked,
      patches: this.patches,
      drained: this.drained,
      flowed: this.flowed,
      worn: this.worn,
      composted: this.composted,
      shells,
      mouths,
      splits: this.splits,
    };
  }

  /** Sizes of the bonded groups, and (in `into`, when given) a group number per tile, without touching the world. */
  bodySizes(into?: Int32Array): number[] {
    const n = this.n;
    const seen = into ?? new Int32Array(n);
    seen.fill(0);
    const stack: number[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!this.alive[i] || seen[i] !== 0) continue;
      const id = sizes.length + 1;
      let size = 0;
      seen[i] = id;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        const e = this.nb(c, 0);
        const so = this.nb(c, 1);
        const w = this.nb(c, 2);
        const no = this.nb(c, 3);
        if (this.bondE[c] && seen[e] === 0) { seen[e] = id; stack.push(e); }
        if (this.bondS[c] && seen[so] === 0) { seen[so] = id; stack.push(so); }
        if (this.bondE[w] && seen[w] === 0) { seen[w] = id; stack.push(w); }
        if (this.bondS[no] && seen[no] === 0) { seen[no] = id; stack.push(no); }
      }
      sizes.push(size);
    }
    return sizes;
  }

  /** A 32-bit digest of everything that carries the history forward. */
  digest(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => { h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0; };
    mix(this.step);
    mix(this.reservoir);
    mix(this.nextCid);
    for (let i = 0; i < this.n; i++) {
      mix(this.food[i]);
      mix(this.scent[i]);
      if (!this.alive[i]) continue;
      mix(i);
      mix(this.store[i]);
      mix(this.heading[i] | (this.bondE[i] << 2) | (this.bondS[i] << 3) | (this.fam[i] << 4) | (this.grew[i] << 20));
      mix(this.cid[i]);
      for (let g = 0; g < ROAM_GENES; g++) mix(this.genes[i * ROAM_GENES + g]);
      if (this.cfg.plan) { mix(this.pid[i]); mix(this.mode[i] | (this.orient[i] << 4)); }
      if (this.drainN > 0) mix(this.since[i]);
      if (this.flowQ16 > 0) mix(this.made[i] | (this.mom[i] << 4));
    }
    if (this.cfg.plan) for (const plan of this.plans) for (let m = 0; m < PLAN_MODES; m++) mix(plan[m]);
    if (this.flowQ16 > 0) { mix(this.splits); mix(this.worn); }
    if (this.compost) mix(this.composted);
    if (this.kinds) for (let i = 0; i < this.n; i++) if (this.alive[i]) mix(this.kind[i]);
    return h >>> 0;
  }
}
