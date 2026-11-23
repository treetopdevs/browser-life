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
const CH_FOUND = 40;

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

  /**
   * Put one founder cell on a free tile, paid for from the reservoir. Returns false when the tile is taken or the
   * reservoir cannot pay.
   */
  found(tile: number, genes: readonly number[], family: number, store = 2 * this.cfg.birthStore - 1): boolean {
    if (this.step !== 0) throw new Error('found() is for step 0');
    whole(tile, 'tile', 0, this.n - 1);
    whole(store, 'store', this.cfg.minStore, 0x7fffffff);
    if (genes.length !== ROAM_GENES) throw new Error(`found needs ${ROAM_GENES} genes`);
    for (const g of genes) whole(g, 'gene', -ROAM_GENE_MAX, ROAM_GENE_MAX);
    if (this.alive[tile] || this.reservoir < store) return false;
    this.alive[tile] = 1;
    this.store[tile] = store;
    this.reservoir -= store;
    for (let g = 0; g < ROAM_GENES; g++) this.genes[tile * ROAM_GENES + g] = genes[g];
    this.heading[tile] = roamHash(this.cfg.seed, 0, tile, CH_HEAD) & 3;
    this.fam[tile] = family;
    this.cid[tile] = this.nextCid++;
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
    this.bondE[c] = 0;
    this.bondS[c] = 0;
    this.bondE[this.nb(c, 2)] = 0;
    this.bondS[this.nb(c, 3)] = 0;
    this.cellDeaths++;
  }

  /** One body's step before moving: where it wants to go, eating, paying, starving, sharing. */
  private live(k: number): void {
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
    if ((roamHash(seed, t, anchor, CH_TURN) & 0xffff) < turnQ16) head = roamHash(seed, t, anchor, CH_HEAD) & 3;

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
      this.mMeta[j] = this.heading[c] | (this.bondE[c] << 2) | (this.bondS[c] << 3) | (this.fam[c] << 4) | (this.grew[c] << 20);
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
    // Blocked: the body picks a new heading.
    this.blocked++;
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
        size++;
      } else {
        // Let go: a new body of one cell, heading away from its parent.
        this.heading[to] = d;
        this.label[to] = -1;
        this.releases++;
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
      for (let q = 0; q < count; q++) if (this.bodyLen[order[q]] > 0) this.divide(order[q]);
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
    const genes = new Array<number>(ROAM_GENES).fill(0);
    for (let i = 0; i < n; i++) {
      food += this.food[i];
      if (!this.alive[i]) continue;
      cells++;
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
    }
    return h >>> 0;
  }
}
