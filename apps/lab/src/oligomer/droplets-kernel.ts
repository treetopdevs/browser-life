/**
 * Phase B2: Exact Fixed-Point Integer CPU Reference for Pointer-Free Zwicker Active Droplets
 * + Conserved Obligate Phage (Kill-the-Winner).
 *
 * Bit-for-bit executable specification for the WebGPU WGSL shaders in `droplets-shaders.ts`.
 * - ZERO floating-point arithmetic inside `step()` (pure u32/i32 fixed-point).
 * - ZERO `Compartment` structs, ZERO `alive[]`, ZERO `split()`, ZERO pointers.
 * - Exact integer matter conservation: sum(A + F + sum_m W_m + sum_m P_m) === initTotalMatter.
 * - Fixed-point scale: SCALE = 1024 (Q10), rates in Q16 (65536 = 1.0).
 */

export const KERNEL_MOTIFS = 6;
export const KERNEL_SCALE = 1024; // Q10: 1024 matter units = 1.0 concentration

export interface DropletKernelConfig {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly initMatterPerTile: number; // default 1024

  // Phase separation (converted to Q16 fixed-point integers in packParams)
  readonly bulkB: number;
  readonly kappa: number;
  readonly chi: number;
  readonly mobility: number;
  readonly diffW: number;
  readonly noiseAmp: number;

  // Soluble diffusion (Q16)
  readonly diffF: number;
  readonly diffA: number;

  // Conserved active chemistry: A --(kLight)--> F --(kSyn * c^2)--> W_m --(kDeg)--> A
  readonly kLight: number;
  readonly kSyn: number;
  readonly kDeg: number;

  // Conserved motif isomerization (r=3 patch, 1-for-1 W_dom -> W_new)
  readonly mutMotif: number;
  readonly coreMin: number; // min density (fraction of SCALE) for motif mutation (default 0.18)

  // Conserved obligate phage P[tile * 6 + m]
  readonly kInfect: number;
  readonly neutralPhage: boolean;
  readonly phageYield: number;
  readonly diffP: number;
  readonly kDecayP: number;
  readonly mutPhage: number;
}

export function defaultDropletKernelConfig(overrides: Partial<DropletKernelConfig> = {}): DropletKernelConfig {
  return {
    width: 128,
    height: 128,
    seed: 1,
    initMatterPerTile: KERNEL_SCALE,
    bulkB: 0.3,
    kappa: 0.06,
    chi: 1.5,
    mobility: 0.008,
    diffW: 0.04,
    noiseAmp: 1.5,
    diffF: 0.20,
    diffA: 0.22,
    kLight: 0.026,
    kSyn: 1.0,
    kDeg: 0.060,
    mutMotif: 0.00003,
    coreMin: 0.18,
    kInfect: 0.34,
    neutralPhage: false,
    phageYield: 0.5,
    diffP: 0.22,
    kDecayP: 0.020,
    mutPhage: 0.000015,
    ...overrides,
  };
}

export interface PackedKernelParams {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly bulkBQ16: number;
  readonly kappa6Q16: number; // (kappa / 6) * 65536
  readonly chiQ16: number;
  readonly mobQ16: number;
  readonly diffWQ16: number;
  readonly noiseQ8: number; // noiseAmp * 256 (avoids i32 overflow with signed 16-bit noise)
  readonly diffFQ16: number;
  readonly diffAQ16: number;
  readonly kLightQ16: number;
  readonly kSynQ16: number;
  readonly kDegQ16: number;
  readonly mutMotifU32: number;
  readonly coreMinInt: number;
  readonly kInfectQ16: number;
  readonly neutralPhage: number; // 0 or 1
  readonly phageYieldQ16: number;
  readonly diffPQ16: number;
  readonly kDecayPQ16: number;
  readonly mutPhageU32: number;
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

export function packKernelParams(cfg: DropletKernelConfig): PackedKernelParams {
  if (!Number.isSafeInteger(cfg.width) || cfg.width <= 0 || !Number.isSafeInteger(cfg.height) || cfg.height <= 0) {
    throw new Error(`Invalid grid dimensions: ${cfg.width}x${cfg.height}`);
  }
  if (!Number.isSafeInteger(cfg.initMatterPerTile) || cfg.initMatterPerTile < 0) {
    throw new Error(`Invalid initMatterPerTile: ${cfg.initMatterPerTile}`);
  }
  if (cfg.width * cfg.height * cfg.initMatterPerTile > 0x3fffffff) {
    throw new Error(`Total world matter exceeds Int32-safe bound (1073741823)`);
  }
  const finiteChecks: [string, number, number, number][] = [
    ['bulkB', cfg.bulkB, 0, 4],
    ['kappa', cfg.kappa, 0, 4],
    ['chi', cfg.chi, 0, 4],
    ['mobility', cfg.mobility, 0, 1],
    ['diffW', cfg.diffW, 0, 0.25],
    ['noiseAmp', cfg.noiseAmp, 0, 100],
    ['diffF', cfg.diffF, 0, 1],
    ['diffA', cfg.diffA, 0, 1],
    ['kLight', cfg.kLight, 0, 1],
    ['kSyn', cfg.kSyn, 0, 10],
    ['kDeg', cfg.kDeg, 0, 1],
    ['mutMotif', cfg.mutMotif, 0, 1],
    ['coreMin', cfg.coreMin, 0, 2],
    ['kInfect', cfg.kInfect, 0, 10],
    ['phageYield', cfg.phageYield, 0, 1],
    ['diffP', cfg.diffP, 0, 1],
    ['kDecayP', cfg.kDecayP, 0, 1],
    ['mutPhage', cfg.mutPhage, 0, 1],
  ];
  for (const [name, v, lo, hi] of finiteChecks) {
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new Error(`Invalid ${name}: ${v} (expected [${lo}, ${hi}])`);
    }
  }
  return {
    width: cfg.width >>> 0,
    height: cfg.height >>> 0,
    seed: cfg.seed >>> 0,
    bulkBQ16: q16Unbounded(cfg.bulkB),
    kappa6Q16: q16Unbounded(cfg.kappa / 6),
    chiQ16: q16Unbounded(cfg.chi),
    mobQ16: q16(cfg.mobility),
    diffWQ16: q16(cfg.diffW),
    noiseQ8: Math.max(0, Math.min(25600, Math.round(cfg.noiseAmp * 256))),
    diffFQ16: q16(cfg.diffF),
    diffAQ16: q16(cfg.diffA),
    kLightQ16: q16(cfg.kLight),
    kSynQ16: q16Unbounded(cfg.kSyn),
    kDegQ16: q16(cfg.kDeg),
    mutMotifU32: probU32(cfg.mutMotif),
    coreMinInt: Math.round(cfg.coreMin * KERNEL_SCALE) >>> 0,
    kInfectQ16: q16Unbounded(cfg.kInfect),
    neutralPhage: cfg.neutralPhage ? 1 : 0,
    phageYieldQ16: q16(cfg.phageYield),
    diffPQ16: q16(cfg.diffP),
    kDecayPQ16: q16(cfg.kDecayP),
    mutPhageU32: probU32(cfg.mutPhage),
  };
}

/** Counter-based 32-bit hash identical to WGSL `hash32`. */
export function kernelHash32(seed: number, step: number, tile: number, ch: number): number {
  let h = (seed ^ Math.imul(step, 0x9e3779b1) ^ Math.imul(tile, 0x85ebca6b) ^ Math.imul(ch, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Overflow-safe stochastic rounding of (val * rateQ16) / 65536 for u32 `val` and `rateQ16` in [0, 65536]. */
export function mulStochQ16(val: number, rateQ16: number, rnd: number): number {
  const hi = Math.imul(val >>> 16, rateQ16) >>> 0;
  const lo = (Math.imul(val & 0xffff, rateQ16) + (rnd & 0xffff)) >>> 0;
  return (hi + (lo >>> 16)) >>> 0;
}

/** Deterministic isotropic integer diffusion share sent from a tile with `val` in direction `dir` (0=E,1=W,2=S,3=N). */
export function diffSend(val: number, rateQ16: number, rnd: number, dir: number): number {
  if (val === 0 || rateQ16 === 0) return 0;
  let out = mulStochQ16(val, rateQ16, rnd);
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

export function diffOut(val: number, rateQ16: number, rnd: number): number {
  if (val === 0 || rateQ16 === 0) return 0;
  let out = mulStochQ16(val, rateQ16, rnd);
  if (out > val) out = val;
  return out >>> 0;
}

export interface KernelDroplet {
  readonly id: number;
  readonly motif: number;
  readonly area: number;
  readonly mass: number;
  readonly cx: number;
  readonly cy: number;
}

/** Shared pure observers operating on plain Uint32Array state (used by both CPU ref and GPU readback). */
export function observeTotalMatter(A: Uint32Array, F: Uint32Array, W: Uint32Array, P: Uint32Array): bigint {
  let total = 0n;
  for (let i = 0; i < A.length; i++) total += BigInt(A[i] + F[i]);
  for (let i = 0; i < W.length; i++) total += BigInt(W[i] + P[i]);
  return total;
}

export function observeMotifStats(W: Uint32Array, P: Uint32Array): {
  shares: number[];
  dominant: number;
  dominantShare: number;
  hillD1: number;
  totalW: number;
  phageTotals: number[];
} {
  const nTiles = W.length / KERNEL_MOTIFS;
  const totals = new Array<number>(KERNEL_MOTIFS).fill(0);
  const phageTotals = new Array<number>(KERNEL_MOTIFS).fill(0);
  let totalW = 0;
  for (let i = 0; i < nTiles; i++) {
    const base = i * KERNEL_MOTIFS;
    for (let m = 0; m < KERNEL_MOTIFS; m++) {
      totals[m] += W[base + m];
      totalW += W[base + m];
      phageTotals[m] += P[base + m];
    }
  }
  const shares = totals.map((v) => (totalW > 0 ? v / totalW : 0));
  let dominant = -1;
  let dominantShare = 0;
  let H = 0;
  for (let m = 0; m < KERNEL_MOTIFS; m++) {
    if (shares[m] > dominantShare) { dominantShare = shares[m]; dominant = m; }
    if (shares[m] > 0) H -= shares[m] * Math.log(shares[m]);
  }
  return { shares, dominant, dominantShare, hillD1: totalW > 0 ? Math.exp(H) : 0, totalW, phageTotals };
}

export function observeFindDroplets(
  W: Uint32Array,
  width: number,
  height: number,
  coreThreshold = 0.25,
): KernelDroplet[] {
  const nTiles = width * height;
  const thresh = Math.round(coreThreshold * KERNEL_SCALE);
  const visited = new Uint8Array(nTiles);
  const queue = new Int32Array(nTiles);
  const droplets: KernelDroplet[] = [];

  for (let m = 0; m < KERNEL_MOTIFS; m++) {
    visited.fill(0);
    for (let start = 0; start < nTiles; start++) {
      if (visited[start] || W[start * KERNEL_MOTIFS + m] < thresh) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let area = 0;
      let mass = 0;
      let sxCos = 0;
      let sxSin = 0;
      let syCos = 0;
      let sySin = 0;

      while (head < tail) {
        const i = queue[head++];
        const wm = W[i * KERNEL_MOTIFS + m];
        area++;
        mass += wm;
        const x = i % width;
        const y = (i / width) | 0;
        const ax = (2 * Math.PI * x) / width;
        const ay = (2 * Math.PI * y) / height;
        sxCos += Math.cos(ax) * wm;
        sxSin += Math.sin(ax) * wm;
        syCos += Math.cos(ay) * wm;
        sySin += Math.sin(ay) * wm;

        const xL = x > 0 ? x - 1 : width - 1;
        const xR = x + 1 < width ? x + 1 : 0;
        const yU = y > 0 ? y - 1 : height - 1;
        const yD = y + 1 < height ? y + 1 : 0;
        const nbs = [y * width + xR, y * width + xL, yD * width + x, yU * width + x];
        for (let d = 0; d < 4; d++) {
          const nb = nbs[d];
          if (!visited[nb] && W[nb * KERNEL_MOTIFS + m] >= thresh) {
            visited[nb] = 1;
            queue[tail++] = nb;
          }
        }
      }
      if (area >= 3) {
        let cx = (Math.atan2(sxSin, sxCos) / (2 * Math.PI)) * width;
        if (cx < 0) cx += width;
        let cy = (Math.atan2(sySin, syCos) / (2 * Math.PI)) * height;
        if (cy < 0) cy += height;
        droplets.push({ id: droplets.length + 1, motif: m, area, mass, cx, cy });
      }
    }
  }
  return droplets;
}

/** FNV-1a 32-bit digest of the entire exact integer state (for bit-exact CPU vs GPU golden verification). */
export function observeDigest(A: Uint32Array, F: Uint32Array, W: Uint32Array, P: Uint32Array): number {
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
  mix(P);
  return h >>> 0;
}

/** Bit-exact fixed-point CPU reference implementation matching `droplets-shaders.ts`. */
export class DropletKernelRef {
  readonly cfg: DropletKernelConfig;
  readonly p: PackedKernelParams;
  readonly nTiles: number;
  stepCount = 0;

  A: Uint32Array;
  F: Uint32Array;
  W: Uint32Array;
  P: Uint32Array;

  private A2: Uint32Array;
  private F2: Uint32Array;
  private W2: Uint32Array;
  private P2: Uint32Array;
  private readonly mu: Int32Array;
  private readonly jE: Int32Array;
  private readonly jS: Int32Array;

  readonly initTotalMatter: bigint;

  constructor(cfg: DropletKernelConfig) {
    this.cfg = cfg;
    this.p = packKernelParams(cfg);
    this.nTiles = cfg.width * cfg.height;
    this.A = new Uint32Array(this.nTiles);
    this.F = new Uint32Array(this.nTiles);
    this.W = new Uint32Array(this.nTiles * KERNEL_MOTIFS);
    this.P = new Uint32Array(this.nTiles * KERNEL_MOTIFS);
    this.A2 = new Uint32Array(this.nTiles);
    this.F2 = new Uint32Array(this.nTiles);
    this.W2 = new Uint32Array(this.nTiles * KERNEL_MOTIFS);
    this.P2 = new Uint32Array(this.nTiles * KERNEL_MOTIFS);
    this.mu = new Int32Array(this.nTiles * KERNEL_MOTIFS);
    this.jE = new Int32Array(this.nTiles * KERNEL_MOTIFS);
    this.jS = new Int32Array(this.nTiles * KERNEL_MOTIFS);

    const initF = cfg.initMatterPerTile >>> 1;
    const initA = cfg.initMatterPerTile - initF;
    this.F.fill(initF);
    this.A.fill(initA);
    this.initTotalMatter = observeTotalMatter(this.A, this.F, this.W, this.P);
  }

  /** Seed a circular droplet of motif `m` at (cx, cy) with radius `r` (exact conservation). */
  seedDroplet(cx: number, cy: number, radius: number, motif = 0, density = 0.85): void {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) {
      throw new Error(`Invalid droplet coordinates: (${cx}, ${cy})`);
    }
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error(`Invalid droplet radius: ${radius}`);
    }
    if (!Number.isSafeInteger(motif) || motif < 0 || motif >= KERNEL_MOTIFS) {
      throw new Error(`Invalid motif: ${motif}`);
    }
    if (!Number.isFinite(density) || density < 0) {
      throw new Error(`Invalid droplet density: ${density}`);
    }
    const W = this.cfg.width;
    const H = this.cfg.height;
    const target = Math.round(density * KERNEL_SCALE);
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
    if (totalSoluble < needed) {
      throw new Error(`Not enough soluble matter (need ${needed}, have ${totalSoluble})`);
    }
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
        const p = pool[i];
        if (p <= 0) continue;
        const share = Math.min(p, Math.floor((p * left) / poolSum));
        pool[i] -= share;
        poolSum -= p;
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
    for (const i of targets) {
      this.W[i * KERNEL_MOTIFS + motif] += target;
    }
  }

  /** Seed a conserved phage inoculum at (cx, cy). */
  seedPhage(cx: number, cy: number, motif: number, amount = 20): void {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) throw new Error(`Invalid coords`);
    if (!Number.isSafeInteger(motif) || motif < 0 || motif >= KERNEL_MOTIFS) throw new Error(`Invalid motif`);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid amount`);
    const W = this.cfg.width;
    const H = this.cfg.height;
    const x = ((cx % W) + W) % W;
    const y = ((cy % H) + H) % H;
    const i = y * W + x;
    const want = Math.round(amount);
    if (this.A[i] + this.F[i] < want) throw new Error(`Not enough soluble matter at (${x},${y})`);
    const fromA = Math.min(this.A[i], want);
    this.A[i] -= fromA;
    this.F[i] -= want - fromA;
    this.P[i * KERNEL_MOTIFS + motif] += want;
  }

  step(): void {
    const step = (++this.stepCount) >>> 0;
    const p = this.p;
    const W = p.width;
    const H = p.height;
    const N = this.nTiles;
    const seed = p.seed;

    // Pass 1: Local conserved active chemistry + phage infection/decay/emergence (in-place on A, F, W, P)
    const synDem = new Uint32Array(KERNEL_MOTIFS);
    for (let i = 0; i < N; i++) {
      const base = i * KERNEL_MOTIFS;
      let a = this.A[i];
      let f = this.F[i];

      let wSum = 0;
      for (let m = 0; m < KERNEL_MOTIFS; m++) wSum += this.W[base + m];
      const solvQ10 = wSum < KERNEL_SCALE ? KERNEL_SCALE - wSum : 0;

      // 1a. Light: A -> F in dilute solvent
      if (a > 0 && p.kLightQ16 > 0 && solvQ10 > 0) {
        const lightRateQ16 = Math.imul(p.kLightQ16, solvQ10) >>> 10;
        let dAF = mulStochQ16(a, lightRateQ16, kernelHash32(seed, step, i, 10));
        if (dAF > a) dAF = a;
        a -= dAF;
        f += dAF;
      }

      // 1b. Hydrolysis W_m -> A & symmetric synthesis demand F + 2W_m -> 3W_m
      const f0 = f;
      let demSum = 0;
      for (let m = 0; m < KERNEL_MOTIFS; m++) {
        synDem[m] = 0;
        let wm = this.W[base + m];
        if (wm === 0) continue;

        let dWA = mulStochQ16(wm, p.kDegQ16, kernelHash32(seed, step, i, 20 + m));
        if (dWA > wm) dWA = wm;
        wm -= dWA;
        a += dWA;
        this.W[base + m] = wm;

        if (f0 > 0) {
          // Pre-hydrolysis concentration c capped at 1.5 (1536 in Q10)
          const wm0 = wm + dWA;
          const c = wm0 > 1536 ? 1536 : wm0;
          const c2Q10 = Math.imul(c, c) >>> 10; // in Q10 (<= 2304)
          const rateQ16 = Math.imul(p.kSynQ16, c2Q10) >>> 10; // can exceed 65536
          const clampedRate = rateQ16 > 65536 ? 65536 : rateQ16;
          const f0Clamped = f0 > 0xffff ? 0xffff : f0;
          const demQ8 = (Math.imul(f0Clamped, clampedRate) >>> 8) >>> 0;
          synDem[m] = demQ8;
          demSum = (demSum + demQ8) >>> 0;
        }
      }

      if (demSum > 0 && f0 > 0) {
        const f0Q8 = ((f0 > 0xffff ? 0xffff : f0) << 8) >>> 0;
        let fLeft = f0;
        const m0 = kernelHash32(seed, step, i, 35) % KERNEL_MOTIFS;
        for (let off = 0; off < KERNEL_MOTIFS && fLeft > 0; off++) {
          const m = (m0 + off) % KERNEL_MOTIFS;
          const dem = synDem[m];
          if (dem === 0) continue;
          let effQ8 = dem;
          if (demSum > f0Q8) {
            const num = f0Q8 >>> 8; // <= 65535
            const den = Math.max(1, demSum >>> 8);
            const scaleQ16 = Math.floor(((num << 16) >>> 0) / den) >>> 0;
            effQ8 = mulStochQ16(dem, scaleQ16 > 65536 ? 65536 : scaleQ16, 0);
          }
          const rnd = kernelHash32(seed, step, i, 40 + m) & 0xff;
          let dFW = ((effQ8 + rnd) >>> 8) >>> 0;
          if (dFW > fLeft) dFW = fLeft;
          fLeft -= dFW;
          f -= dFW;
          this.W[base + m] += dFW;
        }
      }

      // 1c. Phage infection: W_m -> dP + dA
      if (p.kInfectQ16 > 0) {
        if (p.neutralPhage !== 0) {
          let pTot = 0;
          for (let m = 0; m < KERNEL_MOTIFS; m++) pTot += this.P[base + m];
          if (pTot > 0) {
            const pCap = pTot > 4096 ? 4096 : pTot;
            let rateQ16 = Math.imul(p.kInfectQ16, pCap) >>> 10;
            if (rateQ16 > 62259) rateQ16 = 62259; // 0.95 * 65536
            for (let m = 0; m < KERNEL_MOTIFS; m++) {
              const wm = this.W[base + m];
              if (wm === 0) continue;
              let d = mulStochQ16(wm, rateQ16, kernelHash32(seed, step, i, 400 + m));
              if (d > wm) d = wm;
              if (d > 0) {
                let dP = mulStochQ16(d, p.phageYieldQ16, kernelHash32(seed, step, i, 410 + m));
                if (dP > d) dP = d;
                const dA = d - dP;
                this.W[base + m] = wm - d;
                this.P[base + 0] += dP;
                a += dA;
              }
            }
          }
        } else {
          for (let m = 0; m < KERNEL_MOTIFS; m++) {
            const wm = this.W[base + m];
            const pm = this.P[base + m];
            if (wm === 0 || pm === 0) continue;
            const pCap = pm > 4096 ? 4096 : pm;
            let rateQ16 = Math.imul(p.kInfectQ16, pCap) >>> 10;
            if (rateQ16 > 62259) rateQ16 = 62259;
            let d = mulStochQ16(wm, rateQ16, kernelHash32(seed, step, i, 400 + m));
            if (d > wm) d = wm;
            if (d > 0) {
              let dP = mulStochQ16(d, p.phageYieldQ16, kernelHash32(seed, step, i, 410 + m));
              if (dP > d) dP = d;
              const dA = d - dP;
              this.W[base + m] = wm - d;
              this.P[base + m] = pm + dP;
              a += dA;
            }
          }
        }
      }

      // 1d. Phage decay: P_m -> A
      if (p.kDecayPQ16 > 0) {
        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const pm = this.P[base + m];
          if (pm === 0) continue;
          let dec = mulStochQ16(pm, p.kDecayPQ16, kernelHash32(seed, step, i, 420 + m));
          if (dec > pm) dec = pm;
          if (dec > 0) {
            this.P[base + m] = pm - dec;
            a += dec;
          }
        }
      }

      // 1e. Rare conserved prophage emergence: 5-unit W_dom -> P_target
      if (p.mutPhageU32 > 0 && kernelHash32(seed, step, i, 430) < p.mutPhageU32) {
        let domM = -1;
        let domW = 0;
        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const wm = this.W[base + m];
          if (wm > domW) { domW = wm; domM = m; }
        }
        if (domM >= 0 && domW >= 10) {
          const targetM = p.neutralPhage !== 0 ? 0 : kernelHash32(seed, step, i, 431) % KERNEL_MOTIFS;
          const q = domW < 5 ? domW : 5;
          this.W[base + domM] = domW - q;
          this.P[base + targetM] += q;
        }
      }

      this.A[i] = a;
      this.F[i] = f;
    }

    // Pass 2: Chemical potential mu[tile * 6 + m] in signed i32 (Q10)
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * W;
      const y0 = y * W;
      const yD = (y + 1 < H ? y + 1 : 0) * W;
      for (let x = 0; x < W; x++) {
        const xL = x > 0 ? x - 1 : W - 1;
        const xR = x + 1 < W ? x + 1 : 0;
        const i = y0 + x;
        const base = i * KERNEL_MOTIFS;

        let wTot = 0;
        for (let m = 0; m < KERNEL_MOTIFS; m++) wTot += this.W[base + m];

        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const wm = this.W[base + m];
          const c = wm > 2048 ? 2048 : wm; // Q10, [0, 2.0]
          const otherRaw = wTot - wm;
          const cOther = otherRaw > 4096 ? 4096 : otherRaw;

          const capW = (v: number) => (v > 4096 ? 4096 : v);
          const wmCap = capW(wm);
          const card =
            capW(this.W[(y0 + xR) * KERNEL_MOTIFS + m]) +
            capW(this.W[(y0 + xL) * KERNEL_MOTIFS + m]) +
            capW(this.W[(yD + x) * KERNEL_MOTIFS + m]) +
            capW(this.W[(yU + x) * KERNEL_MOTIFS + m]);
          const diag =
            capW(this.W[(yU + xL) * KERNEL_MOTIFS + m]) +
            capW(this.W[(yU + xR) * KERNEL_MOTIFS + m]) +
            capW(this.W[(yD + xL) * KERNEL_MOTIFS + m]) +
            capW(this.W[(yD + xR) * KERNEL_MOTIFS + m]);
          // Bounded in [-81920, +81920]: guaranteed i32-safe in both JS and WGSL
          const lap9Raw = (4 * card + diag - 20 * wmCap) | 0;
          const lapClamped = lap9Raw > 65536 ? 65536 : lap9Raw < -65536 ? -65536 : lap9Raw;
          const lapTerm = Math.imul(p.kappa6Q16, lapClamped) >> 16;

          const t1 = Math.imul(c, 1024 - c) >> 10;
          const t2 = Math.imul(t1, 1024 - 2 * c) >> 10;
          const pack = c > 1024 ? 2 * (c - 1024) : 0;
          const bulkTerm = Math.imul(p.bulkBQ16, t2 + pack) >> 16;
          const chiTerm = Math.imul(p.chiQ16, cOther) >> 16;

          this.mu[base + m] = (bulkTerm + chiTerm - lapTerm) | 0;
        }
      }
    }

    // Pass 3: Conservative Cahn-Hilliard edge fluxes jE, jS (signed i32)
    for (let y = 0; y < H; y++) {
      const y0 = y * W;
      const yD = (y + 1 < H ? y + 1 : 0) * W;
      for (let x = 0; x < W; x++) {
        const xR = x + 1 < W ? x + 1 : 0;
        const i = y0 + x;
        const iE = y0 + xR;
        const iS = yD + x;
        const base = i * KERNEL_MOTIFS;
        const baseE = iE * KERNEL_MOTIFS;
        const baseS = iS * KERNEL_MOTIFS;

        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const wi = this.W[base + m];
          const mui = this.mu[base + m];

          // East edge
          {
            const we = this.W[baseE + m];
            const r = kernelHash32(seed, step, i, 100 + m * 2);
            const nSigned = ((r >>> 16) - 32768) | 0; // [-32768, 32767]
            const noiseQ16 = p.noiseQ8 > 0 ? Math.imul(nSigned, p.noiseQ8) >> 8 : 0;
            const dMu = (mui - this.mu[baseE + m]) | 0;
            const dW = (wi - we) | 0;
            const rawQ16 = (Math.imul(p.mobQ16, dMu) + Math.imul(p.diffWQ16, dW) + noiseQ16) | 0;
            let j = (rawQ16 + (r & 0xffff)) >> 16;
            const maxOutI = (wi >>> 2) | 0;
            const maxOutE = (we >>> 2) | 0;
            if (j > maxOutI) j = maxOutI;
            if (j < -maxOutE) j = -maxOutE;
            this.jE[base + m] = j;
          }

          // South edge
          {
            const ws = this.W[baseS + m];
            const r = kernelHash32(seed, step, i, 101 + m * 2);
            const nSigned = ((r >>> 16) - 32768) | 0;
            const noiseQ16 = p.noiseQ8 > 0 ? Math.imul(nSigned, p.noiseQ8) >> 8 : 0;
            const dMu = (mui - this.mu[baseS + m]) | 0;
            const dW = (wi - ws) | 0;
            const rawQ16 = (Math.imul(p.mobQ16, dMu) + Math.imul(p.diffWQ16, dW) + noiseQ16) | 0;
            let j = (rawQ16 + (r & 0xffff)) >> 16;
            const maxOutI = (wi >>> 2) | 0;
            const maxOutS = (ws >>> 2) | 0;
            if (j > maxOutI) j = maxOutI;
            if (j < -maxOutS) j = -maxOutS;
            this.jS[base + m] = j;
          }
        }
      }
    }

    // Pass 4: Apply Cahn-Hilliard fluxes + pull-based isotropic integer diffusion for F, A, P -> (A2, F2, W2, P2)
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * W;
      const y0 = y * W;
      const yD = (y + 1 < H ? y + 1 : 0) * W;
      for (let x = 0; x < W; x++) {
        const xL = x > 0 ? x - 1 : W - 1;
        const xR = x + 1 < W ? x + 1 : 0;
        const i = y0 + x;
        const iE = y0 + xR;
        const iW = y0 + xL;
        const iS = yD + x;
        const iN = yU + x;
        const base = i * KERNEL_MOTIFS;

        // W flux divergence
        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const wNew =
            (this.W[base + m] | 0) +
            this.jE[iW * KERNEL_MOTIFS + m] -
            this.jE[base + m] +
            this.jS[iN * KERNEL_MOTIFS + m] -
            this.jS[base + m];
          this.W2[base + m] = wNew >>> 0;
        }

        // F pull-based isotropic diffusion (dir: 0=E, 1=W, 2=S, 3=N)
        // iW sends East(0) to i; iE sends West(1) to i; iN sends South(2) to i; iS sends North(3) to i
        {
          const f0 = this.F[i];
          const outF = diffOut(f0, p.diffFQ16, kernelHash32(seed, step, i, 200));
          const inW = diffSend(this.F[iW], p.diffFQ16, kernelHash32(seed, step, iW, 200), 0);
          const inE = diffSend(this.F[iE], p.diffFQ16, kernelHash32(seed, step, iE, 200), 1);
          const inN = diffSend(this.F[iN], p.diffFQ16, kernelHash32(seed, step, iN, 200), 2);
          const inS = diffSend(this.F[iS], p.diffFQ16, kernelHash32(seed, step, iS, 200), 3);
          this.F2[i] = (f0 - outF + inW + inE + inN + inS) >>> 0;
        }

        // A pull-based isotropic diffusion
        {
          const a0 = this.A[i];
          const outA = diffOut(a0, p.diffAQ16, kernelHash32(seed, step, i, 201));
          const inW = diffSend(this.A[iW], p.diffAQ16, kernelHash32(seed, step, iW, 201), 0);
          const inE = diffSend(this.A[iE], p.diffAQ16, kernelHash32(seed, step, iE, 201), 1);
          const inN = diffSend(this.A[iN], p.diffAQ16, kernelHash32(seed, step, iN, 201), 2);
          const inS = diffSend(this.A[iS], p.diffAQ16, kernelHash32(seed, step, iS, 201), 3);
          this.A2[i] = (a0 - outA + inW + inE + inN + inS) >>> 0;
        }

        // P pull-based isotropic diffusion
        for (let m = 0; m < KERNEL_MOTIFS; m++) {
          const ch = 440 + m;
          const p0 = this.P[base + m];
          const outP = diffOut(p0, p.diffPQ16, kernelHash32(seed, step, i, ch));
          const inW = diffSend(this.P[iW * KERNEL_MOTIFS + m], p.diffPQ16, kernelHash32(seed, step, iW, ch), 0);
          const inE = diffSend(this.P[iE * KERNEL_MOTIFS + m], p.diffPQ16, kernelHash32(seed, step, iE, ch), 1);
          const inN = diffSend(this.P[iN * KERNEL_MOTIFS + m], p.diffPQ16, kernelHash32(seed, step, iN, ch), 2);
          const inS = diffSend(this.P[iS * KERNEL_MOTIFS + m], p.diffPQ16, kernelHash32(seed, step, iS, ch), 3);
          this.P2[base + m] = (p0 - outP + inW + inE + inN + inS) >>> 0;
        }
      }
    }

    // Swap ping-pong buffers
    let tmp = this.A; this.A = this.A2; this.A2 = tmp;
    tmp = this.F; this.F = this.F2; this.F2 = tmp;
    tmp = this.W; this.W = this.W2; this.W2 = tmp;
    tmp = this.P; this.P = this.P2; this.P2 = tmp;

    // Pass 5: Order-invariant parallel r=3 conserved motif isomerization (reads W, writes W2, then swaps)
    if (p.mutMotifU32 > 0) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const j = y * W + x;
          const jb = j * KERNEL_MOTIFS;

          let bestPrio = 0;
          let bestIdx = -1;
          let bestDomM = -1;
          let bestNewM = -1;

          for (let dy = -3; dy <= 3; dy++) {
            const cy = (y + dy + H) % H;
            const row = cy * W;
            for (let dx = -3; dx <= 3; dx++) {
              if (dx * dx + dy * dy > 9) continue;
              const cx = (x + dx + W) % W;
              const cIdx = row + cx;
              if (kernelHash32(seed, step, cIdx, 310) >= p.mutMotifU32) continue;

              const cb = cIdx * KERNEL_MOTIFS;
              let domM = -1;
              let domW = 0;
              for (let m = 0; m < KERNEL_MOTIFS; m++) {
                const wm = this.W[cb + m];
                if (wm > domW) { domW = wm; domM = m; }
              }
              if (domM < 0 || domW < p.coreMinInt) continue;

              const prio = kernelHash32(seed, step, cIdx, 312);
              if (bestIdx < 0 || prio > bestPrio || (prio === bestPrio && cIdx > bestIdx)) {
                bestPrio = prio;
                bestIdx = cIdx;
                bestDomM = domM;
                bestNewM = (domM + 1 + (kernelHash32(seed, step, cIdx, 311) % (KERNEL_MOTIFS - 1))) % KERNEL_MOTIFS;
              }
            }
          }

          for (let m = 0; m < KERNEL_MOTIFS; m++) this.W2[jb + m] = this.W[jb + m];
          if (bestIdx >= 0) {
            const wm = this.W2[jb + bestDomM];
            if (wm > 0) {
              this.W2[jb + bestDomM] = 0;
              this.W2[jb + bestNewM] = (this.W2[jb + bestNewM] + wm) >>> 0;
            }
          }
        }
      }
      tmp = this.W; this.W = this.W2; this.W2 = tmp;
    }
  }
}
