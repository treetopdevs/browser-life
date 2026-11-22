/**
 * Droplet genes: a sandbox kernel for "genes for the droplets" (docs/droplet-genes-2026-11-21/PLAN.md).
 *
 * A single-wall copy of the Phase B2 droplet reference (apps/lab/src/oligomer/droplets-kernel.ts) with the
 * phage channels replaced by templates T[tile * S + s]:
 *   s in 0..K-1  essential templates ("genes"): wall is only made where every one of them is nearby
 *   s = K        a parasite template: it copies faster and does nothing
 * All matter is conserved exactly: sum(A + F + W + sum_s T_s) never changes.
 *
 * With genes = 0 the template code is skipped and every pass is the reference arithmetic with the same hash
 * channel ids, so A, F and W equal the reference's A, F and W[.., motif 0] bit for bit when the reference runs
 * one wall motif with phage and motif mutation off (apps/lab/test/dropgenes-kernel.test.ts checks this).
 *
 * This file owns no RULE_VERSION world: nothing in packages/ imports it. CPU reference only, no WGSL yet.
 * No floating point inside step().
 */

export const DG_SCALE = 1024; // Q10: 1024 matter units = 1.0 concentration
export const DG_MAX_GENES = 16;
/** Most wall a tile may hold (64.0). The signed products in passes 2 and 3 are proven in range up to here. */
export const DG_WALL_MAX = 64 * DG_SCALE;

export interface DropGenesConfig {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly initMatterPerTile: number;

  // Wall physics and chemistry: same meaning and arithmetic as DropletKernelConfig.
  readonly bulkB: number;
  readonly kappa: number;
  readonly mobility: number;
  readonly diffW: number;
  readonly noiseAmp: number;
  readonly diffF: number;
  readonly diffA: number;
  readonly kLight: number;
  readonly kSyn: number;
  readonly kDeg: number;

  // Templates.
  /** K essential templates. 0 switches templates off (wall synthesis is then not gated by genes). */
  readonly genes: number;
  /** Template sites on a tile whose wall is 1.0, shared by all K + 1 species (sites scale with wall). */
  readonly capPerTile: number;
  /** Copy rate per step of an essential template when every site is free: F + T_k -> 2 T_k. */
  readonly kRep: number;
  /** Copy rate of the parasite template. PLAN fixes it at 2 * kRep: when not given it follows kRep. */
  readonly kRepPar: number;
  /** Template decay per step: T_s -> A. */
  readonly kDecT: number;
  /** Chance per step that a tile's copies of one species hop to one random neighbour (before the gate). */
  readonly diffT: number;
  /** true: a hop across an edge is scaled by the lower wall of its two tiles (templates stay inside). */
  readonly gated: boolean;
  /** Wall fraction at or below which a gated edge is shut, and at or above which it is fully open. */
  readonly gateLo: number;
  readonly gateHi: number;
  /** Copies of a gene in the 3x3 patch that give full wall synthesis (fewer scale it down, none stop it). */
  readonly geneSat: number;
  /** Chance per tile per step that one essential copy on that tile becomes a parasite copy. */
  readonly mutPar: number;

  // ---- LINKED (begin): linked templates, docs/droplet-genes-linked-2026-11-21/PLAN.md. All four keys are
  // optional and are left out of defaultDropGenesConfig(): absent means off, and the kernel is then unchanged.
  /** true: templates can be linked (one molecule carrying two or more genes). Needs 2..DG_LINK_MAX_GENES genes. */
  readonly linked?: boolean;
  /** Chance per tile per step of one join attempt between two template molecules on that tile. */
  readonly linkJoin?: number;
  /** Chance per step that a linked template breaks in two. */
  readonly linkBreak?: number;
  /** Chance that a new copy of a linked template is made without one of its genes. */
  readonly linkLoss?: number;
  /**
   * Template sites one linked molecule takes. 'gene' (the default): one per gene it carries, so sites count
   * matter. 'molecule': one, whatever its length, so a tile's sites can hold more gene copies when they are linked.
   */
  readonly linkSites?: 'gene' | 'molecule';
  // ---- LINKED (end) ----
}

/**
 * kRepPar, when not given, is 2 * kRep (so an override of kRep alone keeps the parasite's 2x advantage; a kRep
 * above 0.5 is then refused by validation rather than capped).
 *
 * Defaults put the wall chemistry in a self-replicating-spot regime (kDeg 0.085, diffW 0.015, diffF 0.30).
 * The Phase B2 defaults (kDeg 0.060, diffW 0.04, diffF 0.20) give travelling rings in a one-wall world.
 */
export function defaultDropGenesConfig(overrides: Partial<DropGenesConfig> = {}): DropGenesConfig {
  const kRep = overrides.kRep ?? 0.2;
  return {
    width: 64,
    height: 64,
    seed: 1,
    initMatterPerTile: DG_SCALE,
    bulkB: 0.3,
    kappa: 0.06,
    mobility: 0.008,
    diffW: 0.015,
    noiseAmp: 1.5,
    diffF: 0.3,
    diffA: 0.22,
    kLight: 0.026,
    kSyn: 1.0,
    kDeg: 0.085,
    genes: 0,
    capPerTile: 16,
    kRep,
    kDecT: 0.02,
    diffT: 0.2,
    gated: true,
    gateLo: 0.03,
    gateHi: 0.125,
    geneSat: 2,
    mutPar: 0,
    ...overrides,
    kRepPar: overrides.kRepPar ?? 2 * kRep,
  };
}

export interface PackedDropGenesParams {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly bulkBQ16: number;
  readonly kappa6Q16: number;
  readonly mobQ16: number;
  readonly diffWQ16: number;
  readonly noiseQ8: number;
  readonly diffFQ16: number;
  readonly diffAQ16: number;
  readonly kLightQ16: number;
  readonly kSynQ16: number;
  readonly kDegQ16: number;
  readonly genes: number;
  /** K + 1 when genes > 0, else 0. */
  readonly species: number;
  readonly capPerTile: number;
  readonly kRepQ16: number;
  readonly kRepParQ16: number;
  readonly kDecTQ16: number;
  readonly diffTQ16: number;
  readonly gated: number;
  readonly gateLoInt: number;
  readonly gateHiInt: number;
  readonly geneSat: number;
  readonly mutParU32: number;
}

function q16(x: number): number {
  return Math.max(0, Math.min(65536, Math.round(x * 65536)));
}

function q16Unbounded(x: number): number {
  return Math.max(0, Math.min(0x7fffffff, Math.round(x * 65536)));
}

function probU32(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 0xffffffff;
  return Math.floor(p * 4294967296) >>> 0;
}

export function packDropGenesParams(cfg: DropGenesConfig): PackedDropGenesParams {
  if (!Number.isSafeInteger(cfg.width) || cfg.width < 3 || !Number.isSafeInteger(cfg.height) || cfg.height < 3) {
    throw new Error(`Invalid grid dimensions: ${cfg.width}x${cfg.height}`);
  }
  if (!Number.isSafeInteger(cfg.initMatterPerTile) || cfg.initMatterPerTile < 0) {
    throw new Error(`Invalid initMatterPerTile: ${cfg.initMatterPerTile}`);
  }
  if (cfg.width * cfg.height * cfg.initMatterPerTile > 0x3fffffff) {
    throw new Error('Total world matter exceeds Int32-safe bound (1073741823)');
  }
  const ranges: [string, number, number, number][] = [
    // Tighter than the reference's ranges: at bulkB 4, kappa 3 or mobility near 1 a signed 32-bit product in
    // passes 2 and 3 wraps and the wall flux changes sign with no conservation error. These bounds keep every
    // product inside i32 while no tile holds more than DG_WALL_MAX of wall, which step() and seedDroplet enforce.
    ['bulkB', cfg.bulkB, 0, 3],
    ['kappa', cfg.kappa, 0, 2],
    ['mobility', cfg.mobility, 0, 0.1],
    ['diffW', cfg.diffW, 0, 0.25],
    ['noiseAmp', cfg.noiseAmp, 0, 100],
    ['diffF', cfg.diffF, 0, 1],
    ['diffA', cfg.diffA, 0, 1],
    ['kLight', cfg.kLight, 0, 1],
    ['kSyn', cfg.kSyn, 0, 10],
    ['kDeg', cfg.kDeg, 0, 1],
    ['kRep', cfg.kRep, 0, 1],
    ['kRepPar', cfg.kRepPar, 0, 1],
    ['kDecT', cfg.kDecT, 0, 1],
    ['diffT', cfg.diffT, 0, 1],
    ['gateLo', cfg.gateLo, 0, 1],
    ['gateHi', cfg.gateHi, 0, 1],
    ['mutPar', cfg.mutPar, 0, 1],
  ];
  for (const [name, v, lo, hi] of ranges) {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`Invalid ${name}: ${v} (expected [${lo}, ${hi}])`);
  }
  if (!Number.isSafeInteger(cfg.genes) || cfg.genes < 0 || cfg.genes > DG_MAX_GENES) {
    throw new Error(`Invalid genes: ${cfg.genes} (expected 0..${DG_MAX_GENES})`);
  }
  if (!Number.isSafeInteger(cfg.capPerTile) || cfg.capPerTile < 1 || cfg.capPerTile > 4096) {
    throw new Error(`Invalid capPerTile: ${cfg.capPerTile} (expected 1..4096)`);
  }
  if (!Number.isSafeInteger(cfg.geneSat) || cfg.geneSat < 1 || cfg.geneSat > 1024) {
    throw new Error(`Invalid geneSat: ${cfg.geneSat} (expected 1..1024)`);
  }
  const gateLoInt = Math.round(cfg.gateLo * DG_SCALE);
  const gateHiInt = Math.round(cfg.gateHi * DG_SCALE);
  if (gateHiInt <= gateLoInt) throw new Error(`gateHi (${cfg.gateHi}) must be above gateLo (${cfg.gateLo})`);
  return {
    width: cfg.width >>> 0,
    height: cfg.height >>> 0,
    seed: cfg.seed >>> 0,
    bulkBQ16: q16Unbounded(cfg.bulkB),
    kappa6Q16: q16Unbounded(cfg.kappa / 6),
    mobQ16: q16(cfg.mobility),
    diffWQ16: q16(cfg.diffW),
    noiseQ8: Math.max(0, Math.min(25600, Math.round(cfg.noiseAmp * 256))),
    diffFQ16: q16(cfg.diffF),
    diffAQ16: q16(cfg.diffA),
    kLightQ16: q16(cfg.kLight),
    kSynQ16: q16Unbounded(cfg.kSyn),
    kDegQ16: q16(cfg.kDeg),
    genes: cfg.genes,
    species: cfg.genes > 0 ? cfg.genes + 1 : 0,
    capPerTile: cfg.capPerTile,
    kRepQ16: q16(cfg.kRep),
    kRepParQ16: q16(cfg.kRepPar),
    kDecTQ16: q16(cfg.kDecT),
    diffTQ16: q16(cfg.diffT),
    gated: cfg.gated ? 1 : 0,
    gateLoInt,
    gateHiInt,
    geneSat: cfg.geneSat,
    mutParU32: probU32(cfg.mutPar),
  };
}

/** Counter-based 32-bit hash, identical to the reference `kernelHash32`. */
export function dgHash32(seed: number, step: number, tile: number, ch: number): number {
  let h = (seed ^ Math.imul(step, 0x9e3779b1) ^ Math.imul(tile, 0x85ebca6b) ^ Math.imul(ch, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stochastic rounding of (val * rateQ16) / 65536 for u32 `val` and `rateQ16` in [0, 65536]. */
export function dgMulStochQ16(val: number, rateQ16: number, rnd: number): number {
  const hi = Math.imul(val >>> 16, rateQ16) >>> 0;
  const lo = (Math.imul(val & 0xffff, rateQ16) + (rnd & 0xffff)) >>> 0;
  return (hi + (lo >>> 16)) >>> 0;
}

function diffSend(val: number, rateQ16: number, rnd: number, dir: number): number {
  if (val === 0 || rateQ16 === 0) return 0;
  let out = dgMulStochQ16(val, rateQ16, rnd);
  if (out > val) out = val;
  if (out === 0) return 0;
  const q = out >>> 2;
  const rem = out & 3;
  let extra = 0;
  if (rem === 1) {
    if (((rnd >>> 16) & 3) === dir) extra = 1;
  } else if (rem === 2) {
    const pairIdx = (rnd >>> 16) % 6;
    const a = pairIdx < 3 ? 0 : pairIdx < 5 ? 1 : 2;
    const b = pairIdx < 3 ? pairIdx + 1 : pairIdx < 5 ? pairIdx - 1 : 3;
    if (dir === a || dir === b) extra = 1;
  } else if (rem === 3) {
    if (((rnd >>> 16) & 3) !== dir) extra = 1;
  }
  return (q + extra) >>> 0;
}

function diffOut(val: number, rateQ16: number, rnd: number): number {
  if (val === 0 || rateQ16 === 0) return 0;
  let out = dgMulStochQ16(val, rateQ16, rnd);
  if (out > val) out = val;
  return out >>> 0;
}

/** Q10 openness of a gated edge whose lower wall is `minW` (0 = shut, 1024 = open). */
export function dgGateQ10(minW: number, gateLoInt: number, gateHiInt: number): number {
  if (minW <= gateLoInt) return 0;
  if (minW >= gateHiInt) return 1024;
  return Math.floor(((minW - gateLoInt) * 1024) / (gateHiInt - gateLoInt));
}

export function dgTotalMatter(A: Uint32Array, F: Uint32Array, W: Uint32Array, T: Uint32Array): bigint {
  let total = 0n;
  for (let i = 0; i < A.length; i++) total += BigInt(A[i] + F[i] + W[i]);
  for (let i = 0; i < T.length; i++) total += BigInt(T[i]);
  return total;
}

/** FNV-1a 32-bit digest of the whole state. */
export function dgDigest(A: Uint32Array, F: Uint32Array, W: Uint32Array, T: Uint32Array): number {
  let h = 2166136261 >>> 0;
  const mix = (arr: Uint32Array) => {
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  mix(A);
  mix(F);
  mix(W);
  mix(T);
  return h >>> 0;
}

// ---- LINKED (begin): linked templates, docs/droplet-genes-linked-2026-11-21/PLAN.md ----
//
// A linked template is one molecule that carries a set of two or more genes: a bitmask m, bit k = gene k, each
// gene at most once. With `len` = the number of genes it carries, one molecule
//   holds `len` units of matter, is made from `len` units of fuel, returns `len` units of A when it decays,
//   and is copied at kRep / len per step when every site is free.
// So one molecule takes up fuel at the rate a single gene does, and its matter grows `len` times more slowly.
// Sites: `len` per molecule with linkSites 'gene' (the default), one per molecule with linkSites 'molecule'.
// Decay and hopping are per molecule at the single-gene rates. The parasite is never linked.
//
// State: L[tile * masks + m] molecules, for m with two or more bits (the other entries stay 0).
// Arithmetic bounds: every count is at most the world's total matter (below 2^30, packDropGenesParams), so
// count * len, the sums of sites and the per-tile gene counts stay below 2^30 as well. Rates are Q16 in
// [0, 65536] and go through dgMulStochQ16; the copy rate floor(kRepQ16 * free / (cap * len)) is computed in a
// double from factors below 2^17 and 2^12, exactly.

/** Most genes a world with linking may have (2^genes template kinds per tile). */
export const DG_LINK_MAX_GENES = 8;

/** Hash channels of the linked rules. The unlinked rules use channels 10 to 616; these start at 20000. */
const LK_CH_DECAY = 20000; // + mask (below 256)
const LK_CH_COPY = 20256; // + mask
const LK_CH_LOSS = 20512; // + mask
const LK_CH_LOSS_GENE = 20768; // + mask
const LK_CH_BREAK = 21024; // + mask
const LK_CH_BREAK_AT = 21280; // + mask
const LK_CH_HOP = 21536; // + mask
const LK_CH_ORDER = 21792;
const LK_CH_JOIN = 21794;
const LK_CH_JOIN_A = 21795;
const LK_CH_JOIN_B = 21796;
const LK_CH_CARRIER = 21797;
const LK_CH_SHUFFLE = 22000; // + position in the tile's list of linked kinds (below 256)

export interface PackedDropGenesLinkParams {
  readonly on: boolean;
  /** 2^genes when linking is on, else 0: the stride of L. */
  readonly masks: number;
  /** The masks with two or more genes, ascending. */
  readonly multi: Uint16Array;
  /** len[m] = number of genes in mask m. */
  readonly len: Uint8Array;
  readonly joinU32: number;
  readonly breakQ16: number;
  readonly lossQ16: number;
  /** true: a linked molecule takes one site; false: one site per gene. */
  readonly siteless: boolean;
}

export function packDropGenesLinkParams(cfg: DropGenesConfig): PackedDropGenesLinkParams {
  if (cfg.linked !== undefined && typeof cfg.linked !== 'boolean') throw new Error(`Invalid linked: ${cfg.linked} (expected true or false)`);
  const rates: [string, number | undefined][] = [['linkJoin', cfg.linkJoin], ['linkBreak', cfg.linkBreak], ['linkLoss', cfg.linkLoss]];
  for (const [name, v] of rates) {
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`Invalid ${name}: ${v} (expected [0, 1])`);
    if (cfg.linked !== true && v !== 0) throw new Error(`${name} is set but linked is not true`);
  }
  if (cfg.linkSites !== undefined && cfg.linkSites !== 'gene' && cfg.linkSites !== 'molecule') throw new Error(`Invalid linkSites: ${cfg.linkSites} (expected 'gene' or 'molecule')`);
  if (cfg.linked !== true && cfg.linkSites !== undefined) throw new Error('linkSites is set but linked is not true');
  if (cfg.linked !== true) return { on: false, masks: 0, multi: new Uint16Array(0), len: new Uint8Array(0), joinU32: 0, breakQ16: 0, lossQ16: 0, siteless: false };
  if (!Number.isSafeInteger(cfg.genes) || cfg.genes < 2 || cfg.genes > DG_LINK_MAX_GENES) {
    throw new Error(`Invalid genes for linked templates: ${cfg.genes} (expected 2..${DG_LINK_MAX_GENES})`);
  }
  const masks = 1 << cfg.genes;
  const len = new Uint8Array(masks);
  const multi: number[] = [];
  for (let m = 1; m < masks; m++) {
    let c = 0;
    for (let k = 0; k < cfg.genes; k++) if ((m >>> k) & 1) c++;
    len[m] = c;
    if (c >= 2) multi.push(m);
  }
  const joinU32 = probU32(cfg.linkJoin ?? 0);
  const breakQ16 = q16(cfg.linkBreak ?? 0);
  const lossQ16 = q16(cfg.linkLoss ?? 0);
  // A rate too small for its fixed-point form would be silently off.
  if ((cfg.linkJoin ?? 0) > 0 && joinU32 === 0) throw new Error(`linkJoin ${cfg.linkJoin} is below the resolution 2^-32`);
  if ((cfg.linkBreak ?? 0) > 0 && breakQ16 === 0) throw new Error(`linkBreak ${cfg.linkBreak} is below the resolution 2^-17`);
  if ((cfg.linkLoss ?? 0) > 0 && lossQ16 === 0) throw new Error(`linkLoss ${cfg.linkLoss} is below the resolution 2^-17`);
  return { on: true, masks, multi: Uint16Array.from(multi), len, joinU32, breakQ16, lossQ16, siteless: cfg.linkSites === 'molecule' };
}

/** dgDigest continued over the linked templates. */
export function dgDigestLinked(A: Uint32Array, F: Uint32Array, W: Uint32Array, T: Uint32Array, L: Uint32Array): number {
  let h = dgDigest(A, F, W, T);
  for (let i = 0; i < L.length; i++) {
    h ^= L[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The lowest `count` genes of mask m, as a mask. */
function lkLowGenes(m: number, count: number): number {
  let out = 0;
  for (let k = 0; count > 0 && k < 31; k++) {
    if ((m >>> k) & 1) {
      out |= 1 << k;
      count--;
    }
  }
  return out;
}
// ---- LINKED (end) ----

export class DropGenesKernel {
  readonly cfg: DropGenesConfig;
  readonly p: PackedDropGenesParams;
  readonly nTiles: number;
  stepCount = 0;

  A: Uint32Array;
  F: Uint32Array;
  W: Uint32Array;
  /** T[tile * species + s]; empty when genes = 0. */
  T: Uint32Array;

  private A2: Uint32Array;
  private F2: Uint32Array;
  private W2: Uint32Array;
  private T2: Uint32Array;
  private readonly mu: Int32Array;
  private readonly jE: Int32Array;
  private readonly jS: Int32Array;
  private readonly geneQ: Uint16Array;
  private readonly rndF: Uint32Array;
  private readonly rndA: Uint32Array;

  // ---- LINKED (begin): fields ----
  readonly lk: PackedDropGenesLinkParams;
  /** L[tile * lk.masks + m]: molecules of the linked template with gene set m. Empty when linking is off. */
  L: Uint32Array;
  private L2: Uint32Array;
  /** Scratch: per-tile copies of each gene, single plus linked (stride genes), filled by pass 0. */
  private readonly lkG: Uint32Array;
  /** Scratch: lossy copies made on the tile being worked on, by the mask of the shortened product. */
  private readonly lkBorn: Uint32Array;
  private readonly lkBornList: Uint16Array;
  /** Scratch: the linked kinds present on the tile being worked on, in the order they are served. */
  private readonly lkOrder: Uint16Array;
  private readonly lkCnt: Uint32Array;
  /** Scratch: A and F of the tile after lkDecayCopy. */
  private lkA = 0;
  private lkF = 0;
  // ---- LINKED (end) ----

  readonly initTotalMatter: bigint;

  constructor(cfg: DropGenesConfig) {
    this.cfg = cfg;
    this.p = packDropGenesParams(cfg);
    const n = cfg.width * cfg.height;
    this.nTiles = n;
    this.A = new Uint32Array(n);
    this.F = new Uint32Array(n);
    this.W = new Uint32Array(n);
    this.T = new Uint32Array(n * this.p.species);
    this.A2 = new Uint32Array(n);
    this.F2 = new Uint32Array(n);
    this.W2 = new Uint32Array(n);
    this.T2 = new Uint32Array(n * this.p.species);
    this.mu = new Int32Array(n);
    this.jE = new Int32Array(n);
    this.jS = new Int32Array(n);
    this.geneQ = new Uint16Array(n);
    this.rndF = new Uint32Array(n);
    this.rndA = new Uint32Array(n);
    const initF = cfg.initMatterPerTile >>> 1;
    this.F.fill(initF);
    this.A.fill(cfg.initMatterPerTile - initF);
    this.initTotalMatter = dgTotalMatter(this.A, this.F, this.W, this.T);

    // ---- LINKED (begin): arrays (all empty when linking is off) ----
    this.lk = packDropGenesLinkParams(cfg);
    this.L = new Uint32Array(n * this.lk.masks);
    this.L2 = new Uint32Array(n * this.lk.masks);
    this.lkG = new Uint32Array(this.lk.on ? n * cfg.genes : 0);
    this.lkBorn = new Uint32Array(this.lk.masks);
    this.lkBornList = new Uint16Array(this.lk.masks);
    this.lkOrder = new Uint16Array(this.lk.masks);
    this.lkCnt = new Uint32Array(this.lk.on ? cfg.genes : 0);
    // ---- LINKED (end) ----
  }

  totalMatter(): bigint {
    return dgTotalMatter(this.A, this.F, this.W, this.T) + this.linkedMatter(); // LINKED: + linked templates (0 when off)
  }

  digest(): number {
    return this.lk.on ? dgDigestLinked(this.A, this.F, this.W, this.T, this.L) : dgDigest(this.A, this.F, this.W, this.T); // LINKED
  }

  /** Seed a disc of wall at (cx, cy), drawing the matter from the soluble pools exactly as the reference does. */
  seedDroplet(cx: number, cy: number, radius: number, density = 0.85): void {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) throw new Error(`Invalid droplet coordinates: (${cx}, ${cy})`);
    if (!Number.isFinite(radius) || radius < 0) throw new Error(`Invalid droplet radius: ${radius}`);
    if (!Number.isFinite(density) || density < 0 || density > 32) throw new Error(`Invalid droplet density: ${density} (expected [0, 32])`);
    const W = this.cfg.width;
    const H = this.cfg.height;
    const target = Math.round(density * DG_SCALE);
    const r2 = radius * radius;
    const targets: number[] = [];
    let needed = 0;
    for (let y = 0; y < H; y++) {
      let dy = Math.abs(y - cy);
      if (dy > H * 0.5) dy = H - dy;
      for (let x = 0; x < W; x++) {
        let dx = Math.abs(x - cx);
        if (dx > W * 0.5) dx = W - dx;
        if (dx * dx + dy * dy <= r2) {
          targets.push(y * W + x);
          needed += target;
        }
      }
    }
    let totalSoluble = 0;
    for (let i = 0; i < this.nTiles; i++) totalSoluble += this.A[i] + this.F[i];
    if (totalSoluble < needed) throw new Error(`Not enough soluble matter (need ${needed}, have ${totalSoluble})`);
    const startOff = (((cy % H) + H) % H) * W + (((cx % W) + W) % W);
    let rem = needed;
    for (let pass = 0; pass < 2 && rem > 0; pass++) {
      const pool = pass === 0 ? this.A : this.F;
      let poolSum = 0;
      for (let i = 0; i < this.nTiles; i++) poolSum += pool[i];
      if (poolSum <= 0) continue;
      let left = Math.min(rem, poolSum);
      for (let off = 0; off < this.nTiles && left > 0; off++) {
        const i = (startOff + off) % this.nTiles;
        const v = pool[i];
        if (v <= 0) continue;
        const share = Math.min(v, Math.floor((v * left) / poolSum));
        pool[i] -= share;
        poolSum -= v;
        left -= share;
        rem -= share;
      }
      for (let off = 0; off < this.nTiles && left > 0; off++) {
        const i = (startOff + off) % this.nTiles;
        if (pool[i] > 0) {
          pool[i] -= 1;
          left -= 1;
          rem -= 1;
        }
      }
    }
    for (const i of targets) this.W[i] += target;
  }

  /**
   * Put `perGene` copies of every essential template (and `parasite` copies of the parasite) on each tile whose
   * wall is at least `minWall`, taking the matter from that tile's A then F. Returns the number of tiles seeded.
   * `only` restricts the essential genes seeded (for tests of a droplet that is missing one).
   */
  seedTemplates(perGene: number, minWall = 0.125, parasite = 0, only?: readonly number[]): number {
    const S = this.p.species;
    const K = this.p.genes;
    if (S === 0) return 0;
    if (!Number.isSafeInteger(perGene) || perGene < 0 || !Number.isSafeInteger(parasite) || parasite < 0) {
      throw new Error('Template seed amounts must be non-negative integers');
    }
    const thresh = Math.round(minWall * DG_SCALE);
    let seeded = 0;
    for (let i = 0; i < this.nTiles; i++) {
      if (this.W[i] < thresh) continue;
      const amounts: number[] = [];
      let want = 0;
      for (let s = 0; s < S; s++) {
        const amt = s < K ? (only && !only.includes(s) ? 0 : perGene) : parasite;
        amounts.push(amt);
        want += amt;
      }
      if (this.A[i] + this.F[i] < want) throw new Error(`Not enough soluble matter on tile ${i} to seed templates`);
      const fromA = Math.min(this.A[i], want);
      this.A[i] -= fromA;
      this.F[i] -= want - fromA;
      for (let s = 0; s < S; s++) this.T[i * S + s] += amounts[s];
      seeded++;
    }
    return seeded;
  }

  step(): void {
    const step = (++this.stepCount) >>> 0;
    const p = this.p;
    const Wd = p.width;
    const H = p.height;
    const N = this.nTiles;
    const seed = p.seed;
    const K = p.genes;
    const S = p.species;
    const geneQ = this.geneQ;
    const LK = this.lk.on; // LINKED: read by the linked blocks below; false leaves every pass as it was

    // ---- LINKED (begin): pass 0 with a gene counted wherever it sits; the unlinked pass 0 below is then skipped ----
    if (LK) this.lkPass0();
    else
    // ---- LINKED (end) ----
    // Pass 0: gene function per tile, from the 3x3 patch of template counts at the start of the step.
    // geneQ = 1024 * min_k min(patch_k, geneSat) / geneSat. Only read where wall is present.
    if (K > 0) {
      const T = this.T;
      const sat = p.geneSat;
      for (let y = 0; y < H; y++) {
        const yU = (y > 0 ? y - 1 : H - 1) * Wd;
        const y0 = y * Wd;
        const yD = (y + 1 < H ? y + 1 : 0) * Wd;
        for (let x = 0; x < Wd; x++) {
          const i = y0 + x;
          if (this.W[i] === 0) {
            geneQ[i] = 0;
            continue;
          }
          const xL = x > 0 ? x - 1 : Wd - 1;
          const xR = x + 1 < Wd ? x + 1 : 0;
          const b0 = (yU + xL) * S;
          const b1 = (yU + x) * S;
          const b2 = (yU + xR) * S;
          const b3 = (y0 + xL) * S;
          const b4 = i * S;
          const b5 = (y0 + xR) * S;
          const b6 = (yD + xL) * S;
          const b7 = (yD + x) * S;
          const b8 = (yD + xR) * S;
          let minS = sat;
          for (let k = 0; k < K && minS > 0; k++) {
            const s = T[b0 + k] + T[b1 + k] + T[b2 + k] + T[b3 + k] + T[b4 + k] + T[b5 + k] + T[b6 + k] + T[b7 + k] + T[b8 + k];
            if (s < minS) minS = s;
          }
          geneQ[i] = Math.floor((minS * 1024) / sat);
        }
      }
    }

    // Pass 1: local conserved chemistry, in place on A, F, W, T.
    for (let i = 0; i < N; i++) {
      let a = this.A[i];
      let f = this.F[i];
      const w0 = this.W[i];
      const solvQ10 = w0 < DG_SCALE ? DG_SCALE - w0 : 0;

      // 1a. Light: A -> F in dilute solvent.
      if (a > 0 && p.kLightQ16 > 0 && solvQ10 > 0) {
        const lightRateQ16 = Math.imul(p.kLightQ16, solvQ10) >>> 10;
        let dAF = dgMulStochQ16(a, lightRateQ16, dgHash32(seed, step, i, 10));
        if (dAF > a) dAF = a;
        a -= dAF;
        f += dAF;
      }

      // ---- LINKED (begin): decay and copying of single and linked templates; 1t below is then skipped ----
      if (LK) {
        this.lkDecayCopy(i, step, a, f, w0);
        a = this.lkA;
        f = this.lkF;
      } else
      // ---- LINKED (end) ----
      // 1t. Templates: decay T_s -> A, then copying F + T_s -> 2 T_s into free sites.
      if (S > 0) {
        const tb = i * S;
        let tot = 0;
        for (let s = 0; s < S; s++) {
          let t = this.T[tb + s];
          if (t === 0) continue;
          let d = dgMulStochQ16(t, p.kDecTQ16, dgHash32(seed, step, i, 500 + s));
          if (d > t) d = t;
          t -= d;
          a += d;
          this.T[tb + s] = t;
          tot += t;
        }
        if (tot > 0 && f > 0) {
          const wc = w0 > DG_SCALE ? DG_SCALE : w0;
          const cap = Math.imul(wc, p.capPerTile) >>> 10;
          if (cap > tot) {
            const free0 = cap - tot;
            let freeLeft = free0;
            const s0 = dgHash32(seed, step, i, 540) % S;
            for (let off = 0; off < S && freeLeft > 0 && f > 0; off++) {
              const s = (s0 + off) % S;
              const t = this.T[tb + s];
              if (t === 0) continue;
              const kq = s < K ? p.kRepQ16 : p.kRepParQ16;
              const rateQ16 = Math.floor((kq * free0) / cap);
              let b = dgMulStochQ16(t, rateQ16, dgHash32(seed, step, i, 520 + s));
              if (b > freeLeft) b = freeLeft;
              if (b > f) b = f;
              if (b > 0) {
                this.T[tb + s] = t + b;
                f -= b;
                freeLeft -= b;
              }
            }
          }
        }
      }

      // 1b. Hydrolysis W -> A and synthesis F + 2W -> 3W (scaled by gene function when genes > 0).
      const f0 = f;
      let wm = w0;
      if (wm > 0) {
        let dWA = dgMulStochQ16(wm, p.kDegQ16, dgHash32(seed, step, i, 20));
        if (dWA > wm) dWA = wm;
        wm -= dWA;
        a += dWA;
        if (f0 > 0) {
          const wm0 = wm + dWA;
          const c = wm0 > 1536 ? 1536 : wm0;
          const c2Q10 = Math.imul(c, c) >>> 10;
          const rateQ16 = Math.imul(p.kSynQ16, c2Q10) >>> 10;
          let clampedRate = rateQ16 > 65536 ? 65536 : rateQ16;
          if (K > 0) clampedRate = Math.imul(clampedRate, geneQ[i]) >>> 10;
          const f0Clamped = f0 > 0xffff ? 0xffff : f0;
          const dem = (Math.imul(f0Clamped, clampedRate) >>> 8) >>> 0;
          if (dem > 0) {
            const f0Q8 = (f0Clamped << 8) >>> 0;
            let effQ8 = dem;
            if (dem > f0Q8) {
              const num = f0Q8 >>> 8;
              const den = Math.max(1, dem >>> 8);
              const scaleQ16 = Math.floor(((num << 16) >>> 0) / den) >>> 0;
              effQ8 = dgMulStochQ16(dem, scaleQ16 > 65536 ? 65536 : scaleQ16, 0);
            }
            const rnd = dgHash32(seed, step, i, 40) & 0xff;
            let dFW = ((effQ8 + rnd) >>> 8) >>> 0;
            if (dFW > f0) dFW = f0;
            f -= dFW;
            wm += dFW;
          }
        }
      }

      // ---- LINKED (begin): parasite origin from any carrier, then breaking and joining; 1m below is then skipped ----
      if (LK) this.lkOriginBreakJoin(i, step);
      else
      // ---- LINKED (end) ----
      // 1m. Rare parasite origin: one essential copy on this tile becomes one parasite copy. The gene is chosen
      // by hash among the genes present on the tile (with every gene present this is hash % K).
      if (K > 0 && p.mutParU32 > 0 && dgHash32(seed, step, i, 560) < p.mutParU32) {
        const tb = i * S;
        let present = 0;
        for (let k = 0; k < K; k++) if (this.T[tb + k] > 0) present++;
        if (present > 0) {
          let j = dgHash32(seed, step, i, 561) % present;
          let k = 0;
          for (; k < K; k++) if (this.T[tb + k] > 0 && j-- === 0) break;
          this.T[tb + k] -= 1;
          this.T[tb + K] += 1;
        }
      }

      // Checked after the chemistry, so that neither last step's flux nor this step's synthesis can hand passes
      // 2 and 3 a wall above the bound their signed arithmetic is proven for.
      if (wm > DG_WALL_MAX) throw new Error(`Wall on tile ${i} is ${wm}, above the bound ${DG_WALL_MAX} the flux arithmetic is proven for`);
      this.A[i] = a;
      this.F[i] = f;
      this.W[i] = wm;
    }

    // Pass 2: chemical potential mu (signed Q10), one wall channel so the cross-wall chi term is zero.
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * Wd;
      const y0 = y * Wd;
      const yD = (y + 1 < H ? y + 1 : 0) * Wd;
      for (let x = 0; x < Wd; x++) {
        const xL = x > 0 ? x - 1 : Wd - 1;
        const xR = x + 1 < Wd ? x + 1 : 0;
        const i = y0 + x;
        const wm = this.W[i];
        const c = wm > 2048 ? 2048 : wm;
        const wmCap = wm > 4096 ? 4096 : wm;
        const wE = this.W[y0 + xR];
        const wW = this.W[y0 + xL];
        const wS = this.W[yD + x];
        const wN = this.W[yU + x];
        const card = (wE > 4096 ? 4096 : wE) + (wW > 4096 ? 4096 : wW) + (wS > 4096 ? 4096 : wS) + (wN > 4096 ? 4096 : wN);
        const d0 = this.W[yU + xL];
        const d1 = this.W[yU + xR];
        const d2 = this.W[yD + xL];
        const d3 = this.W[yD + xR];
        const diag = (d0 > 4096 ? 4096 : d0) + (d1 > 4096 ? 4096 : d1) + (d2 > 4096 ? 4096 : d2) + (d3 > 4096 ? 4096 : d3);
        const lap9Raw = (4 * card + diag - 20 * wmCap) | 0;
        const lapClamped = lap9Raw > 65536 ? 65536 : lap9Raw < -65536 ? -65536 : lap9Raw;
        const lapTerm = Math.imul(p.kappa6Q16, lapClamped) >> 16;
        const t1 = Math.imul(c, 1024 - c) >> 10;
        const t2 = Math.imul(t1, 1024 - 2 * c) >> 10;
        const pack = c > 1024 ? 2 * (c - 1024) : 0;
        const bulkTerm = Math.imul(p.bulkBQ16, t2 + pack) >> 16;
        this.mu[i] = (bulkTerm - lapTerm) | 0;
      }
    }

    // Pass 3: conservative Cahn-Hilliard edge fluxes jE, jS.
    for (let y = 0; y < H; y++) {
      const y0 = y * Wd;
      const yD = (y + 1 < H ? y + 1 : 0) * Wd;
      for (let x = 0; x < Wd; x++) {
        const xR = x + 1 < Wd ? x + 1 : 0;
        const i = y0 + x;
        const wi = this.W[i];
        const mui = this.mu[i];
        {
          const iE = y0 + xR;
          const we = this.W[iE];
          const r = dgHash32(seed, step, i, 100);
          const nSigned = ((r >>> 16) - 32768) | 0;
          const noiseQ16 = p.noiseQ8 > 0 ? Math.imul(nSigned, p.noiseQ8) >> 8 : 0;
          const dMu = (mui - this.mu[iE]) | 0;
          const dW = (wi - we) | 0;
          const rawQ16 = (Math.imul(p.mobQ16, dMu) + Math.imul(p.diffWQ16, dW) + noiseQ16) | 0;
          let j = (rawQ16 + (r & 0xffff)) >> 16;
          const maxOutI = (wi >>> 2) | 0;
          const maxOutE = (we >>> 2) | 0;
          if (j > maxOutI) j = maxOutI;
          if (j < -maxOutE) j = -maxOutE;
          this.jE[i] = j;
        }
        {
          const iS = yD + x;
          const ws = this.W[iS];
          const r = dgHash32(seed, step, i, 101);
          const nSigned = ((r >>> 16) - 32768) | 0;
          const noiseQ16 = p.noiseQ8 > 0 ? Math.imul(nSigned, p.noiseQ8) >> 8 : 0;
          const dMu = (mui - this.mu[iS]) | 0;
          const dW = (wi - ws) | 0;
          const rawQ16 = (Math.imul(p.mobQ16, dMu) + Math.imul(p.diffWQ16, dW) + noiseQ16) | 0;
          let j = (rawQ16 + (r & 0xffff)) >> 16;
          const maxOutI = (wi >>> 2) | 0;
          const maxOutS = (ws >>> 2) | 0;
          if (j > maxOutI) j = maxOutI;
          if (j < -maxOutS) j = -maxOutS;
          this.jS[i] = j;
        }
      }
    }

    // Pass 4: apply wall fluxes, diffuse F and A (pull form, as the reference), hop templates.
    for (let i = 0; i < N; i++) {
      this.rndF[i] = dgHash32(seed, step, i, 200);
      this.rndA[i] = dgHash32(seed, step, i, 201);
    }
    if (S > 0) this.T2.set(this.T);
    if (LK) this.L2.set(this.L); // LINKED
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * Wd;
      const y0 = y * Wd;
      const yD = (y + 1 < H ? y + 1 : 0) * Wd;
      for (let x = 0; x < Wd; x++) {
        const xL = x > 0 ? x - 1 : Wd - 1;
        const xR = x + 1 < Wd ? x + 1 : 0;
        const i = y0 + x;
        const iE = y0 + xR;
        const iW = y0 + xL;
        const iS = yD + x;
        const iN = yU + x;

        this.W2[i] = ((this.W[i] | 0) + this.jE[iW] - this.jE[i] + this.jS[iN] - this.jS[i]) >>> 0;

        {
          const f0 = this.F[i];
          const outF = diffOut(f0, p.diffFQ16, this.rndF[i]);
          const inW = diffSend(this.F[iW], p.diffFQ16, this.rndF[iW], 0);
          const inE = diffSend(this.F[iE], p.diffFQ16, this.rndF[iE], 1);
          const inN = diffSend(this.F[iN], p.diffFQ16, this.rndF[iN], 2);
          const inS = diffSend(this.F[iS], p.diffFQ16, this.rndF[iS], 3);
          this.F2[i] = (f0 - outF + inW + inE + inN + inS) >>> 0;
        }
        {
          const a0 = this.A[i];
          const outA = diffOut(a0, p.diffAQ16, this.rndA[i]);
          const inW = diffSend(this.A[iW], p.diffAQ16, this.rndA[iW], 0);
          const inE = diffSend(this.A[iE], p.diffAQ16, this.rndA[iE], 1);
          const inN = diffSend(this.A[iN], p.diffAQ16, this.rndA[iN], 2);
          const inS = diffSend(this.A[iS], p.diffAQ16, this.rndA[iS], 3);
          this.A2[i] = (a0 - outA + inW + inE + inN + inS) >>> 0;
        }

        // Template hop: all the copies that move from this tile this step go to one neighbour, chosen by hash.
        // The amount is (copies * diffT * gate); the gate reads the wall before this step's wall flux.
        if (S > 0 && p.diffTQ16 > 0) {
          const tb = i * S;
          for (let s = 0; s < S; s++) {
            const t = this.T[tb + s];
            if (t === 0) continue;
            const r = dgHash32(seed, step, i, 600 + s);
            const dir = r & 3;
            const nb = dir === 0 ? iE : dir === 1 ? iW : dir === 2 ? iS : iN;
            let rateQ16 = p.diffTQ16;
            if (p.gated !== 0) {
              const wi = this.W[i];
              const wn = this.W[nb];
              const g = dgGateQ10(wi < wn ? wi : wn, p.gateLoInt, p.gateHiInt);
              if (g === 0) continue;
              rateQ16 = Math.imul(rateQ16, g) >>> 10;
            }
            let out = dgMulStochQ16(t, rateQ16, r >>> 8);
            if (out > t) out = t;
            if (out > 0) {
              this.T2[tb + s] -= out;
              this.T2[nb * S + s] += out;
            }
          }
        }
        // ---- LINKED (begin): linked templates hop as single ones do ----
        if (LK && p.diffTQ16 > 0) this.lkHop(i, step, iE, iW, iS, iN);
        // ---- LINKED (end) ----
      }
    }

    let tmp = this.A; this.A = this.A2; this.A2 = tmp;
    tmp = this.F; this.F = this.F2; this.F2 = tmp;
    tmp = this.W; this.W = this.W2; this.W2 = tmp;
    if (S > 0) { tmp = this.T; this.T = this.T2; this.T2 = tmp; }
    if (LK) { tmp = this.L; this.L = this.L2; this.L2 = tmp; } // LINKED
  }

  // ---- LINKED (begin): methods. None is reached from step() when linking is off. ----

  /** Matter held in linked templates: one unit per gene per molecule. */
  linkedMatter(): bigint {
    const lk = this.lk;
    if (!lk.on) return 0n;
    const M = lk.masks;
    const multi = lk.multi;
    let sum = 0;
    for (let i = 0; i < this.nTiles; i++) {
      const lb = i * M;
      for (let j = 0; j < multi.length; j++) sum += this.L[lb + multi[j]] * lk.len[multi[j]];
    }
    return BigInt(sum);
  }

  /**
   * Put `count` molecules of the linked template `mask` (default: every gene) on each tile whose wall is at least
   * `minWall`, taking count * len units of matter from that tile's A then F. Returns the number of tiles seeded.
   */
  seedLinked(count: number, minWall = 0.125, mask?: number): number {
    const lk = this.lk;
    if (!lk.on) throw new Error('seedLinked needs linked: true');
    const m = mask ?? lk.masks - 1;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Template seed amounts must be non-negative integers');
    if (!Number.isSafeInteger(m) || m < 1 || m >= lk.masks || lk.len[m] < 2) throw new Error(`Invalid linked template mask: ${m}`);
    const want = count * lk.len[m];
    const thresh = Math.round(minWall * DG_SCALE);
    let seeded = 0;
    for (let i = 0; i < this.nTiles; i++) {
      if (this.W[i] < thresh) continue;
      if (this.A[i] + this.F[i] < want) throw new Error(`Not enough soluble matter on tile ${i} to seed templates`);
      const fromA = Math.min(this.A[i], want);
      this.A[i] -= fromA;
      this.F[i] -= want - fromA;
      this.L[i * lk.masks + m] += count;
      seeded++;
    }
    return seeded;
  }

  /** Add `count` molecules with gene set m to a tile: a single gene goes to T, anything longer to L. */
  private lkAdd(i: number, m: number, count: number): void {
    if (this.lk.len[m] === 1) this.T[i * this.p.species + (31 - Math.clz32(m))] += count;
    else this.L[i * this.lk.masks + m] += count;
  }

  /**
   * Pass 0 with linking on: lkG[tile * K + k] = single copies of gene k plus linked templates that carry it, then
   * geneQ from the 3x3 patch of those counts by the same formula as the unlinked pass 0.
   */
  private lkPass0(): void {
    const p = this.p;
    const lk = this.lk;
    const K = p.genes;
    const S = p.species;
    const M = lk.masks;
    const multi = lk.multi;
    const N = this.nTiles;
    const Wd = p.width;
    const H = p.height;
    const G = this.lkG;
    const geneQ = this.geneQ;
    for (let i = 0; i < N; i++) {
      const gb = i * K;
      const tb = i * S;
      const lb = i * M;
      for (let k = 0; k < K; k++) G[gb + k] = this.T[tb + k];
      for (let j = 0; j < multi.length; j++) {
        const m = multi[j];
        const n = this.L[lb + m];
        if (n === 0) continue;
        for (let k = 0; k < K; k++) if ((m >>> k) & 1) G[gb + k] += n;
      }
    }
    const sat = p.geneSat;
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * Wd;
      const y0 = y * Wd;
      const yD = (y + 1 < H ? y + 1 : 0) * Wd;
      for (let x = 0; x < Wd; x++) {
        const i = y0 + x;
        if (this.W[i] === 0) {
          geneQ[i] = 0;
          continue;
        }
        const xL = x > 0 ? x - 1 : Wd - 1;
        const xR = x + 1 < Wd ? x + 1 : 0;
        const b0 = (yU + xL) * K;
        const b1 = (yU + x) * K;
        const b2 = (yU + xR) * K;
        const b3 = (y0 + xL) * K;
        const b4 = i * K;
        const b5 = (y0 + xR) * K;
        const b6 = (yD + xL) * K;
        const b7 = (yD + x) * K;
        const b8 = (yD + xR) * K;
        let minS = sat;
        for (let k = 0; k < K && minS > 0; k++) {
          const s = G[b0 + k] + G[b1 + k] + G[b2 + k] + G[b3 + k] + G[b4 + k] + G[b5 + k] + G[b6 + k] + G[b7 + k] + G[b8 + k];
          if (s < minS) minS = s;
        }
        geneQ[i] = Math.floor((minS * 1024) / sat);
      }
    }
  }

  /**
   * Rule 1t with linking on, for tile i whose A and F are `a` and `f` after the light step. Leaves the tile's
   * A and F in lkA and lkF.
   *
   * Decay: every molecule, single or linked, decays at kDecT; a linked one returns one unit of A per gene.
   * Sites: floor(min(W, 1.0) * capPerTile), as unlinked; a linked molecule takes one per gene (linkSites 'gene')
   * or one (linkSites 'molecule').
   * Copying: singles and the parasite exactly as unlinked (same order, rates and hash channels). A linked
   * template of `len` genes is copied at kRep / len * free / sites per molecule, and a copy needs `len` units of
   * fuel and as many free sites as the new molecule takes. With chance linkLoss a copy is made without one of
   * the genes (it then takes len - 1 units of fuel, and len - 1 sites under 'gene'); all the lossy copies of one
   * kind on a tile in a step lack the same gene. Which copies are whole and which lossy is settled before the
   * limits of fuel and free sites are applied, each at its own cost; whether the whole or the lossy copies of a
   * kind are served first is one hash bit.
   * Which is served first, the singles or the linked templates, is one hash bit per tile per step. The linked
   * kinds present on the tile are served in a hashed random order (a shuffle of the kinds present, so a kind's
   * place does not depend on its mask number or on which other kinds are absent; the orders are equally likely
   * up to the modulo bias of a 32-bit hash, below 2^-24).
   * With no linked molecule on the tile this is the unlinked rule 1t bit for bit.
   */
  private lkDecayCopy(i: number, step: number, a: number, f: number, w0: number): void {
    const p = this.p;
    const lk = this.lk;
    const K = p.genes;
    const S = p.species;
    const M = lk.masks;
    const multi = lk.multi;
    const seed = p.seed;
    const tb = i * S;
    const lb = i * M;
    let tot = 0;
    for (let s = 0; s < S; s++) {
      let t = this.T[tb + s];
      if (t === 0) continue;
      let d = dgMulStochQ16(t, p.kDecTQ16, dgHash32(seed, step, i, 500 + s));
      if (d > t) d = t;
      t -= d;
      a += d;
      this.T[tb + s] = t;
      tot += t;
    }
    let nLinked = 0;
    for (let j = 0; j < multi.length; j++) {
      const m = multi[j];
      let n = this.L[lb + m];
      if (n === 0) continue;
      let d = dgMulStochQ16(n, p.kDecTQ16, dgHash32(seed, step, i, LK_CH_DECAY + m));
      if (d > n) d = n;
      n -= d;
      a += d * lk.len[m];
      this.L[lb + m] = n;
      tot += lk.siteless ? n : n * lk.len[m];
      nLinked += n;
    }
    if (tot > 0 && f > 0) {
      const wc = w0 > DG_SCALE ? DG_SCALE : w0;
      const cap = Math.imul(wc, p.capPerTile) >>> 10;
      if (cap > tot) {
        const free0 = cap - tot;
        let freeLeft = free0;
        let nBorn = 0;
        const linkedFirst = nLinked > 0 && (dgHash32(seed, step, i, LK_CH_ORDER) & 1) === 1;
        for (let turn = 0; turn < 2; turn++) {
          if ((turn === 0) === linkedFirst) {
            if (nLinked === 0) continue;
            // The kinds present, shuffled by hash (Fisher-Yates): every order equally likely, up to modulo bias.
            const order = this.lkOrder;
            let nPresent = 0;
            for (let j = 0; j < multi.length; j++) if (this.L[lb + multi[j]] !== 0) order[nPresent++] = multi[j];
            for (let q = nPresent - 1; q > 0; q--) {
              const r = dgHash32(seed, step, i, LK_CH_SHUFFLE + q) % (q + 1);
              const swap = order[q];
              order[q] = order[r];
              order[r] = swap;
            }
            for (let off = 0; off < nPresent && freeLeft > 0 && f > 0; off++) {
              const m = order[off];
              const n = this.L[lb + m];
              const len = lk.len[m];
              const rateQ16 = Math.floor((p.kRepQ16 * free0) / (cap * len));
              const b = dgMulStochQ16(n, rateQ16, dgHash32(seed, step, i, LK_CH_COPY + m));
              if (b === 0) continue;
              // Whole and lossy copies are told apart first; each is then limited by fuel and free sites at its
              // own cost (len, or len - 1 for a lossy copy; one site each under 'molecule').
              const hl = lk.lossQ16 > 0 ? dgHash32(seed, step, i, LK_CH_LOSS + m) : 0;
              let lost = lk.lossQ16 > 0 ? dgMulStochQ16(b, lk.lossQ16, hl) : 0;
              if (lost > b) lost = b;
              let whole = b - lost;
              const siteWhole = lk.siteless ? 1 : len;
              const siteLost = lk.siteless ? 1 : len - 1;
              const lossyFirst = ((hl >>> 16) & 1) === 1;
              for (let part = 0; part < 2; part++) {
                if ((part === 0) === lossyFirst) {
                  const roomSites = Math.floor(freeLeft / siteLost);
                  if (lost > roomSites) lost = roomSites;
                  const roomFuel = Math.floor(f / (len - 1));
                  if (lost > roomFuel) lost = roomFuel;
                  f -= lost * (len - 1);
                  freeLeft -= lost * siteLost;
                } else {
                  const roomSites = Math.floor(freeLeft / siteWhole);
                  if (whole > roomSites) whole = roomSites;
                  const roomFuel = Math.floor(f / len);
                  if (whole > roomFuel) whole = roomFuel;
                  f -= whole * len;
                  freeLeft -= whole * siteWhole;
                }
              }
              this.L[lb + m] = n + whole;
              if (lost > 0) {
                // The gene left out: the (hash % len)-th gene of m. The shortened copies are added after both
                // turns, so nothing made in this step is copied in this step.
                let g = dgHash32(seed, step, i, LK_CH_LOSS_GENE + m) % len;
                let k = 0;
                for (; k < K; k++) if (((m >>> k) & 1) === 1 && g-- === 0) break;
                const m2 = m & ~(1 << k);
                if (this.lkBorn[m2] === 0) this.lkBornList[nBorn++] = m2;
                this.lkBorn[m2] += lost;
              }
            }
          } else {
            const s0 = dgHash32(seed, step, i, 540) % S;
            for (let off = 0; off < S && freeLeft > 0 && f > 0; off++) {
              const s = (s0 + off) % S;
              const t = this.T[tb + s];
              if (t === 0) continue;
              const kq = s < K ? p.kRepQ16 : p.kRepParQ16;
              const rateQ16 = Math.floor((kq * free0) / cap);
              let b = dgMulStochQ16(t, rateQ16, dgHash32(seed, step, i, 520 + s));
              if (b > freeLeft) b = freeLeft;
              if (b > f) b = f;
              if (b > 0) {
                this.T[tb + s] = t + b;
                f -= b;
                freeLeft -= b;
              }
            }
          }
        }
        for (let q = 0; q < nBorn; q++) {
          const m2 = this.lkBornList[q];
          this.lkAdd(i, m2, this.lkBorn[m2]);
          this.lkBorn[m2] = 0;
        }
      }
    }
    this.lkA = a;
    this.lkF = f;
  }

  /**
   * Rule 1m with linking on, then the two rules that make and unmake linked templates. None of them changes A,
   * F or W: matter only moves between template kinds on the tile.
   *
   * Parasite origin: the same event, at the same rate and with the same gene choice as unlinked (hash channels
   * 560 and 561, over the genes present on the tile in any form). The carrier is then chosen by hash among every
   * molecule on the tile that carries that gene. A single copy becomes one parasite copy, as unlinked; a linked
   * template loses that gene (it becomes the template of the other genes) and one parasite copy is added.
   *
   * Breaking: each linked template breaks with chance linkBreak per step, between two genes that are next to
   * each other in gene order: the lowest `cut` genes become one piece, the rest the other. All the molecules of
   * one kind that break on a tile in a step break at the same point.
   *
   * Joining: with chance linkJoin per tile per step, two different slots are drawn by hash from the tile's
   * capPerTile slots (the sites of a tile whose wall is 1.0; when the tile holds more molecules than that, from as
   * many slots as molecules). The tile's gene-carrying molecules (parasite excluded) fill the first slots. If both
   * slots hold a molecule and the two have no gene in common, they become one molecule carrying both gene sets.
   * So on a tile holding no more molecules than capPerTile the chance that two given molecules meet does not
   * depend on how many others are there (mass action), and a tile with few molecules joins rarely. Above that
   * (a tile over its slots, which hops and breaks can make) every draw finds two molecules and the chance for a
   * given pair falls with the number on the tile. Joining needs no fuel. Under linkSites 'gene' breaking and joining leave the sites taken unchanged;
   * under 'molecule' a break takes one more site (it is not held back when none is free, so a tile can be over
   * its sites, as it can after hops) and a join frees one.
   */
  private lkOriginBreakJoin(i: number, step: number): void {
    const p = this.p;
    const lk = this.lk;
    const K = p.genes;
    const S = p.species;
    const M = lk.masks;
    const multi = lk.multi;
    const seed = p.seed;
    const tb = i * S;
    const lb = i * M;

    if (p.mutParU32 > 0 && dgHash32(seed, step, i, 560) < p.mutParU32) {
      const cnt = this.lkCnt;
      for (let k = 0; k < K; k++) cnt[k] = this.T[tb + k];
      for (let j = 0; j < multi.length; j++) {
        const m = multi[j];
        const n = this.L[lb + m];
        if (n === 0) continue;
        for (let k = 0; k < K; k++) if ((m >>> k) & 1) cnt[k] += n;
      }
      let present = 0;
      for (let k = 0; k < K; k++) if (cnt[k] > 0) present++;
      if (present > 0) {
        let j = dgHash32(seed, step, i, 561) % present;
        let k = 0;
        for (; k < K; k++) if (cnt[k] > 0 && j-- === 0) break;
        let r = dgHash32(seed, step, i, LK_CH_CARRIER) % cnt[k];
        if (r < this.T[tb + k]) {
          this.T[tb + k] -= 1;
        } else {
          r -= this.T[tb + k];
          for (let q = 0; q < multi.length; q++) {
            const m = multi[q];
            if (((m >>> k) & 1) === 0) continue;
            const n = this.L[lb + m];
            if (r < n) {
              this.L[lb + m] = n - 1;
              this.lkAdd(i, m & ~(1 << k), 1);
              break;
            }
            r -= n;
          }
        }
        this.T[tb + K] += 1;
      }
    }

    if (lk.breakQ16 > 0) {
      // Ascending masks: both pieces of m are smaller than m, so a piece is never visited after it is made.
      for (let j = 0; j < multi.length; j++) {
        const m = multi[j];
        const n = this.L[lb + m];
        if (n === 0) continue;
        let b = dgMulStochQ16(n, lk.breakQ16, dgHash32(seed, step, i, LK_CH_BREAK + m));
        if (b > n) b = n;
        if (b === 0) continue;
        const cut = 1 + (dgHash32(seed, step, i, LK_CH_BREAK_AT + m) % (lk.len[m] - 1));
        const lo = lkLowGenes(m, cut);
        this.L[lb + m] = n - b;
        this.lkAdd(i, lo, b);
        this.lkAdd(i, m ^ lo, b);
      }
    }

    if (lk.joinU32 > 0 && dgHash32(seed, step, i, LK_CH_JOIN) < lk.joinU32) {
      let n = 0;
      for (let k = 0; k < K; k++) n += this.T[tb + k];
      for (let j = 0; j < multi.length; j++) n += this.L[lb + multi[j]];
      if (n >= 2) {
        const slots = n > p.capPerTile ? n : p.capPerTile;
        const r1 = dgHash32(seed, step, i, LK_CH_JOIN_A) % slots;
        let r2 = dgHash32(seed, step, i, LK_CH_JOIN_B) % (slots - 1);
        if (r2 >= r1) r2++;
        if (r1 < n && r2 < n) {
          const m1 = this.lkPick(i, r1);
          const m2 = this.lkPick(i, r2);
          if ((m1 & m2) === 0) {
            this.lkAdd(i, m1, -1);
            this.lkAdd(i, m2, -1);
            this.L[lb + (m1 | m2)] += 1;
          }
        }
      }
    }
  }

  /** Gene set of the r-th gene-carrying molecule on tile i, counting singles in gene order and then linked templates by mask. */
  private lkPick(i: number, r: number): number {
    const K = this.p.genes;
    const tb = i * this.p.species;
    const lb = i * this.lk.masks;
    const multi = this.lk.multi;
    for (let k = 0; k < K; k++) {
      const t = this.T[tb + k];
      if (r < t) return 1 << k;
      r -= t;
    }
    for (let j = 0; j < multi.length; j++) {
      const n = this.L[lb + multi[j]];
      if (r < n) return multi[j];
      r -= n;
    }
    throw new Error(`lkPick: index past the molecules on tile ${i}`);
  }

  /** Rule 6 for linked templates: the same hop rate, gate and one-neighbour rule as single copies, per molecule. */
  private lkHop(i: number, step: number, iE: number, iW: number, iS: number, iN: number): void {
    const p = this.p;
    const M = this.lk.masks;
    const multi = this.lk.multi;
    const lb = i * M;
    for (let j = 0; j < multi.length; j++) {
      const m = multi[j];
      const n = this.L[lb + m];
      if (n === 0) continue;
      const r = dgHash32(p.seed, step, i, LK_CH_HOP + m);
      const dir = r & 3;
      const nb = dir === 0 ? iE : dir === 1 ? iW : dir === 2 ? iS : iN;
      let rateQ16 = p.diffTQ16;
      if (p.gated !== 0) {
        const wi = this.W[i];
        const wn = this.W[nb];
        const g = dgGateQ10(wi < wn ? wi : wn, p.gateLoInt, p.gateHiInt);
        if (g === 0) continue;
        rateQ16 = Math.imul(rateQ16, g) >>> 10;
      }
      let out = dgMulStochQ16(n, rateQ16, r >>> 8);
      if (out > n) out = n;
      if (out > 0) {
        this.L2[lb + m] -= out;
        this.L2[nb * M + m] += out;
      }
    }
  }
  // ---- LINKED (end) ----
}
