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
  }

  totalMatter(): bigint {
    return dgTotalMatter(this.A, this.F, this.W, this.T);
  }

  digest(): number {
    return dgDigest(this.A, this.F, this.W, this.T);
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
      }
    }

    let tmp = this.A; this.A = this.A2; this.A2 = tmp;
    tmp = this.F; this.F = this.F2; this.F2 = tmp;
    tmp = this.W; this.W = this.W2; this.W2 = tmp;
    if (S > 0) { tmp = this.T; this.T = this.T2; this.T2 = tmp; }
  }
}
