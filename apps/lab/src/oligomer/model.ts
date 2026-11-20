/**
 * Phase A (Direction 3): Conserved Spatial Oligomer Compartment World.
 *
 * Exact integer monomer conservation (sum n0 = const, sum n1 = const, residual = 0).
 * No declared Organism/Species/Fitness class. Individuals, trophic roles, and
 * Red Queen wall-motif dynamics are inferred purely by observers.
 */

import {
  CLEAVE_LEFT,
  CLEAVE_RIGHT,
  NUM_OPS,
  NUM_SPECIES,
  NUM_WALL_SPECIES,
  OP_CLEAVE,
  OP_IMPORT,
  OP_LIGATE,
  OP_LYSE,
  OP_NOP,
  SPECIES,
  WALL_SPECIES,
  decodeCatalyst,
  makeCatalyst,
  matchedSpecies,
  speciesByLabel,
  specificityScaleQ16,
} from './chem.ts';

export interface OligomerConfig {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly genomeSlots: number; // G (default 6)

  // Initial matter (monomers per tile, split 50/50 between '0' and '1')
  readonly initMonomersPerTile: number;

  // Abiotic photochemistry (light)
  readonly feedstocks: readonly number[]; // species IDs synthesized by light
  readonly kLightQ16: number; // prob per attempt per lit tile
  readonly lightAttempts: number; // attempts per lit tile per step
  readonly lightPatches: number; // 0 = uniform light, >0 = drifting lit discs
  readonly patchRadius: number;
  readonly patchSpeed: number; // tiles per 256 steps (fixed-point)

  // Thermodynamics (strictly dissipative: eLig > eBond)
  readonly eBond: number;
  readonly eLig: number;
  readonly eMax: number;
  readonly kEDissQ16: number; // fractional energy decay per step

  // Spontaneous hydrolysis
  readonly kHydExtQ16: number;
  readonly kHydIntQ16: number;
  readonly kWallHydQ16: number;

  // Passive permeability (Q16, indexed by length 1..4)
  readonly permQ16: readonly [number, number, number, number];
  // Diffusion rates in ext (Q16, indexed by length 1..4)
  readonly diffQ16: readonly [number, number, number, number];
  // Wall partitioning rate from int -> wall for wall-class tetramers
  readonly kWallInsertQ16: number;

  // Catalysis & mutation
  readonly kCatQ16: number;
  readonly flatTradeoff: boolean; // Rung 1 control: no specificity penalty
  readonly mutRateQ16: number; // per-slot mutation prob on division

  // Compartment thresholds (physical size / wall integrity)
  readonly wMin: number;
  readonly wDiv: number;
  readonly mDiv: number;
  readonly moveProbQ16: number; // Brownian droplet drift (swap with random neighbor)
  readonly pRuptureQ16: number; // background thermal/shear rupture prob per step (prevents immortal freeze)

  // Rung 2: Lysis & controls
  readonly enableLyse: boolean;
  readonly singleWallOnly: boolean; // control: only WALL_SPECIES[0] can form walls
  readonly neutralGenome: boolean; // Rung 1 control: fixed baseline catalysis, genome drifts
  readonly neutralBaseline: readonly number[];
  readonly neutralWallLyse: boolean; // Rung 2 control: motif-blind lysis at flat rate
  readonly neutralLyseRateQ16: number;
}

export function defaultConfig(overrides: Partial<OligomerConfig> = {}): OligomerConfig {
  const f0 = speciesByLabel('0001');
  const f1 = speciesByLabel('1110');
  // Baseline viable genome for neutral control:
  // cleaves 0001 -> 00+01, 1110 -> 11+10, ligates 00+11 -> 0011, imports 0001/1110
  const baseline = [
    makeCatalyst(OP_CLEAVE, '0001', 2),
    makeCatalyst(OP_CLEAVE, '1110', 2),
    makeCatalyst(OP_LIGATE, '0011', 2),
    makeCatalyst(OP_IMPORT, '0001', 2),
    makeCatalyst(OP_IMPORT, '1110', 2),
    0,
  ];
  return {
    width: 32,
    height: 32,
    seed: 1,
    genomeSlots: 7,
    initMonomersPerTile: 120,
    feedstocks: [f0, f1],
    kLightQ16: 24576, // 0.375
    lightAttempts: 4,
    lightPatches: 0,
    patchRadius: 6,
    patchSpeed: 2,
    eBond: 2,
    eLig: 3,
    eMax: 64,
    kEDissQ16: 2048, // ~3.1% per step
    kHydExtQ16: 256, // ~0.39% per step
    kHydIntQ16: 128, // ~0.2% per step
    kWallHydQ16: 256, // ~0.39% per step (requires continuous wall synthesis)
    permQ16: [24576, 2048, 512, 256], // L1 fast, L2 moderate, L3/L4 slow
    diffQ16: [16384, 8192, 4096, 2048],
    kWallInsertQ16: 32768, // 50% per step
    kCatQ16: 24576, // 37.5% per step for 0-wildcard specialist
    flatTradeoff: false,
    mutRateQ16: 4096, // ~6.25% per slot per division
    wMin: 6,
    wDiv: 24,
    mDiv: 16,
    moveProbQ16: 4096, // ~6.25% Brownian droplet drift per step
    pRuptureQ16: 64, // ~0.1% per step (mean lifespan ~1000 steps, keeps mutation clock ticking)
    enableLyse: false,
    singleWallOnly: false,
    neutralGenome: false,
    neutralBaseline: baseline,
    neutralWallLyse: false,
    neutralLyseRateQ16: 2048,
    ...overrides,
  };
}

/** Counter-based 32-bit hash (pure integer, deterministic across runtimes). */
export function hash32(seed: number, step: number, index: number, channel: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (step | 0), 0x85ebca6b);
  h = Math.imul(h ^ (index | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (channel | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Exact integer stochastic thinning: given count `n >= 0` and probability `pQ16 / 65536`,
 * returns an integer in `[0, n]` with exact expectation `n * pQ16 / 65536`.
 */
function stochasticCount(n: number, pQ16: number, rnd: number): number {
  if (n <= 0 || pQ16 <= 0) return 0;
  if (pQ16 >= 65536) return n;
  const prod = n * pQ16;
  const base = Math.floor(prod / 65536);
  const rem = prod - base * 65536;
  return base + ((rnd & 0xffff) < rem ? 1 : 0);
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Pure observer hook interface: read-only events emitted during a step. */
export interface StepObserver {
  onCleave?(tile: number, spId: number, count: number): void;
  onLigate?(tile: number, spId: number, count: number): void;
  onLyse?(attacker: number, victim: number, wallIndex: number, count: number): void;
  onDivide?(parent: number, child: number): void;
  onDeath?(tile: number, byLysis: boolean): void;
  onSwap?(a: number, b: number): void;
}

// Precompute matched species table for all 32768 possible 15-bit catalyst encodings
// (lazy-filled cache for speed).
const _matchCache = new Map<number, readonly number[]>();
function getMatchedSpecies(raw: number): readonly number[] {
  let arr = _matchCache.get(raw);
  if (arr === undefined) {
    arr = matchedSpecies(decodeCatalyst(raw));
    _matchCache.set(raw, arr);
  }
  return arr;
}

export class OligomerWorld {
  readonly cfg: OligomerConfig;
  readonly nTiles: number;
  stepCount = 0;

  readonly ext: Int32Array;
  readonly int: Int32Array;
  readonly wall: Int32Array;
  readonly alive: Uint8Array;
  readonly energy: Int32Array;
  readonly genome: Uint16Array;
  readonly founder: Int32Array;

  // Scratch buffers (never part of serialized state)
  private readonly extDelta: Int32Array;
  private readonly lysedThisStep: Uint8Array;

  // Exact initial monomer totals (for zero-residual invariant checks)
  readonly initN0: number;
  readonly initN1: number;

  constructor(cfg: OligomerConfig) {
    if (cfg.eLig <= cfg.eBond) {
      throw new Error(`Thermodynamic invariant violated: eLig (${cfg.eLig}) must be > eBond (${cfg.eBond})`);
    }
    this.cfg = cfg;
    this.nTiles = cfg.width * cfg.height;
    this.ext = new Int32Array(this.nTiles * NUM_SPECIES);
    this.int = new Int32Array(this.nTiles * NUM_SPECIES);
    this.wall = new Int32Array(this.nTiles * NUM_WALL_SPECIES);
    this.alive = new Uint8Array(this.nTiles);
    this.energy = new Int32Array(this.nTiles);
    this.genome = new Uint16Array(this.nTiles * cfg.genomeSlots);
    this.founder = new Int32Array(this.nTiles);
    this.extDelta = new Int32Array(this.nTiles * NUM_SPECIES);
    this.lysedThisStep = new Uint8Array(this.nTiles);

    // Seed uniform monomers (50/50 '0' and '1') across all tiles
    if (!Number.isSafeInteger(cfg.initMonomersPerTile) || cfg.initMonomersPerTile < 0) {
      throw new Error(`Invalid initMonomersPerTile: ${cfg.initMonomersPerTile}`);
    }
    const half = Math.floor(cfg.initMonomersPerTile / 2);
    const rem = cfg.initMonomersPerTile - half;
    for (let i = 0; i < this.nTiles; i++) {
      this.ext[i * NUM_SPECIES + 0] = half;
      this.ext[i * NUM_SPECIES + 1] = rem;
    }

    const totals = this.monomerTotals();
    this.initN0 = totals.n0;
    this.initN1 = totals.n1;
  }

  /**
   * Place a founder compartment at (x, y) by converting local ext monomers into its
   * initial wall and internal pool (preserves exact monomer conservation!).
   */
  seedCompartment(
    x: number,
    y: number,
    wallSpecId: number,
    wallCount: number,
    genome: readonly number[],
    founderId: number,
    initEnergy = 16,
  ): void {
    const i = ((y % this.cfg.height) + this.cfg.height) % this.cfg.height * this.cfg.width +
      (((x % this.cfg.width) + this.cfg.width) % this.cfg.width);
    const sp = SPECIES[wallSpecId];
    if (!sp.isWall) throw new Error(`Wall species ${wallSpecId} is not in wall class W`);

    // Conserve monomers: draw required 0s and 1s from local ext (or nearest tiles if needed)
    const need0 = wallCount * sp.n0;
    const need1 = wallCount * sp.n1;
    this.withdrawMonomers(i, need0, need1);

    this.alive[i] = 1;
    this.wall[i * NUM_WALL_SPECIES + sp.wallIndex] += wallCount;
    this.energy[i] = Math.min(this.cfg.eMax, initEnergy);
    this.founder[i] = founderId;
    const gBase = i * this.cfg.genomeSlots;
    for (let s = 0; s < this.cfg.genomeSlots; s++) {
      this.genome[gBase + s] = s < genome.length ? (genome[s] & 0x7fff) : 0;
    }
  }

  private withdrawMonomers(startTile: number, need0: number, need1: number): void {
    // Preflight check so a failed seed never mutates pools or breaks conservation
    let avail0 = 0;
    let avail1 = 0;
    for (let t = 0; t < this.nTiles; t++) {
      const base = t * NUM_SPECIES;
      avail0 += this.ext[base + 0];
      avail1 += this.ext[base + 1];
      if (avail0 >= need0 && avail1 >= need1) break;
    }
    if (avail0 < need0 || avail1 < need1) {
      throw new Error(
        `Not enough ext monomers to seed compartment (short ${Math.max(0, need0 - avail0)} zeros, ${Math.max(0, need1 - avail1)} ones)`,
      );
    }

    let r0 = need0;
    let r1 = need1;
    for (let off = 0; off < this.nTiles && (r0 > 0 || r1 > 0); off++) {
      const t = (startTile + off) % this.nTiles;
      const base = t * NUM_SPECIES;
      if (r0 > 0 && this.ext[base + 0] > 0) {
        const take = Math.min(r0, this.ext[base + 0]);
        this.ext[base + 0] -= take;
        r0 -= take;
      }
      if (r1 > 0 && this.ext[base + 1] > 0) {
        const take = Math.min(r1, this.ext[base + 1]);
        this.ext[base + 1] -= take;
        r1 -= take;
      }
    }
  }

  /** Compute exact global monomer totals across ext, int, and wall. */
  monomerTotals(): { n0: number; n1: number } {
    let n0 = 0;
    let n1 = 0;
    for (let i = 0; i < this.nTiles; i++) {
      const base = i * NUM_SPECIES;
      for (let s = 0; s < NUM_SPECIES; s++) {
        const c = this.ext[base + s] + this.int[base + s];
        if (c !== 0) {
          n0 += c * SPECIES[s].n0;
          n1 += c * SPECIES[s].n1;
        }
      }
      if (this.alive[i]) {
        const wBase = i * NUM_WALL_SPECIES;
        for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
          const wc = this.wall[wBase + wi];
          if (wc !== 0) {
            const sp = SPECIES[WALL_SPECIES[wi]];
            n0 += wc * sp.n0;
            n1 += wc * sp.n1;
          }
        }
      }
    }
    return { n0, n1 };
  }

  /** Fast 32-bit FNV-1a digest of the entire physics state (for determinism & observer purity). */
  digest(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.stepCount);
    mix(0x11111111);
    mix(this.ext.length);
    for (let i = 0; i < this.ext.length; i++) if (this.ext[i]) { mix(i); mix(this.ext[i]); }
    mix(0x22222222);
    mix(this.int.length);
    for (let i = 0; i < this.int.length; i++) if (this.int[i]) { mix(i); mix(this.int[i]); }
    mix(0x33333333);
    mix(this.wall.length);
    for (let i = 0; i < this.wall.length; i++) if (this.wall[i]) { mix(i); mix(this.wall[i]); }
    mix(0x44444444);
    mix(this.nTiles);
    for (let i = 0; i < this.nTiles; i++) {
      if (this.alive[i]) {
        mix(i);
        mix(this.energy[i]);
        const gBase = i * this.cfg.genomeSlots;
        for (let s = 0; s < this.cfg.genomeSlots; s++) mix(this.genome[gBase + s]);
      }
    }
    return h >>> 0;
  }

  private isLit(x: number, y: number, step: number): boolean {
    const np = this.cfg.lightPatches;
    if (np <= 0) return true;
    const W = this.cfg.width;
    const H = this.cfg.height;
    const r2 = this.cfg.patchRadius * this.cfg.patchRadius;
    const speed = this.cfg.patchSpeed;
    for (let p = 0; p < np; p++) {
      // Deterministic golden-ratio patch positions drifting across torus
      const cx0 = ((p * 0.61803398875) % 1) * W;
      const cy0 = ((p * 0.38196601125 + 0.25) % 1) * H;
      const vx = p % 2 === 0 ? 1 : -1;
      const vy = p % 3 === 0 ? 1 : -1;
      const cx = (((cx0 + (vx * speed * step) / 256) % W) + W) % W;
      const cy = (((cy0 + (vy * speed * step) / 256) % H) + H) % H;
      let dx = Math.abs(x - cx);
      if (dx > W * 0.5) dx = W - dx;
      let dy = Math.abs(y - cy);
      if (dy > H * 0.5) dy = H - dy;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  private neighborTile(i: number, dir: number): number {
    const W = this.cfg.width;
    const H = this.cfg.height;
    const x = i % W;
    const y = (i / W) | 0;
    if (dir === 0) return y * W + (x + 1 < W ? x + 1 : 0);
    if (dir === 1) return y * W + (x > 0 ? x - 1 : W - 1);
    if (dir === 2) return (y + 1 < H ? y + 1 : 0) * W + x;
    return (y > 0 ? y - 1 : H - 1) * W + x;
  }

  private permuteParams(step: number, channel: number): [number, number] {
    const N = this.nTiles;
    const start = hash32(this.cfg.seed, step, 0, channel) % N;
    let stride = (hash32(this.cfg.seed, step, 1, channel) % N) | 1;
    let tries = 0;
    while (gcd(stride, N) !== 1 && tries < 64) {
      stride = (stride + 2) % N || 1;
      tries++;
    }
    if (gcd(stride, N) !== 1) stride = 1;
    return [start, stride];
  }

  /** Advance the world by one exact, conserved step. */
  step(obs?: StepObserver): void {
    const step = ++this.stepCount;
    const cfg = this.cfg;
    const seed = cfg.seed;
    const N = this.nTiles;
    const W = cfg.width;

    // 1. Abiotic photochemistry (light)
    const nFeed = cfg.feedstocks.length;
    if (cfg.kLightQ16 > 0 && nFeed > 0 && cfg.lightAttempts > 0) {
      for (let i = 0; i < N; i++) {
        if (cfg.lightPatches > 0 && !this.isLit(i % W, (i / W) | 0, step)) continue;
        const base = i * NUM_SPECIES;
        for (let a = 0; a < cfg.lightAttempts; a++) {
          const r = hash32(seed, step, i, 10 + a);
          if ((r & 0xffff) >= cfg.kLightQ16) continue;
          const fId = cfg.feedstocks[(r >>> 16) % nFeed];
          const sp = SPECIES[fId];
          if (this.ext[base + 0] >= sp.n0 && this.ext[base + 1] >= sp.n1) {
            this.ext[base + 0] -= sp.n0;
            this.ext[base + 1] -= sp.n1;
            this.ext[base + fId] += 1;
          }
        }
      }
    }

    // 2. Spontaneous hydrolysis (ext, int, wall)
    for (let i = 0; i < N; i++) {
      const base = i * NUM_SPECIES;
      // External hydrolysis (L >= 2)
      if (cfg.kHydExtQ16 > 0) {
        for (let s = 2; s < NUM_SPECIES; s++) {
          const c = this.ext[base + s];
          if (c === 0) continue;
          const r = hash32(seed, step, i, 100 + s);
          const k = stochasticCount(c, cfg.kHydExtQ16, r);
          if (k > 0) {
            const len = SPECIES[s].len;
            const pos = 1 + ((r >>> 16) % (len - 1));
            this.ext[base + s] -= k;
            this.ext[base + CLEAVE_LEFT[s * 4 + pos]] += k;
            this.ext[base + CLEAVE_RIGHT[s * 4 + pos]] += k;
          }
        }
      }

      if (!this.alive[i]) continue;

      // Internal hydrolysis (L >= 2)
      if (cfg.kHydIntQ16 > 0) {
        for (let s = 2; s < NUM_SPECIES; s++) {
          const c = this.int[base + s];
          if (c === 0) continue;
          const r = hash32(seed, step, i, 200 + s);
          const k = stochasticCount(c, cfg.kHydIntQ16, r);
          if (k > 0) {
            const len = SPECIES[s].len;
            const pos = 1 + ((r >>> 16) % (len - 1));
            this.int[base + s] -= k;
            this.int[base + CLEAVE_LEFT[s * 4 + pos]] += k;
            this.int[base + CLEAVE_RIGHT[s * 4 + pos]] += k;
          }
        }
      }

      // Wall hydrolysis -> dimers into ext
      if (cfg.kWallHydQ16 > 0) {
        const wBase = i * NUM_WALL_SPECIES;
        for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
          const wc = this.wall[wBase + wi];
          if (wc === 0) continue;
          const r = hash32(seed, step, i, 300 + wi);
          const k = stochasticCount(wc, cfg.kWallHydQ16, r);
          if (k > 0) {
            const s = WALL_SPECIES[wi];
            this.wall[wBase + wi] -= k;
            this.ext[base + CLEAVE_LEFT[s * 4 + 2]] += k;
            this.ext[base + CLEAVE_RIGHT[s * 4 + 2]] += k;
          }
        }
      }
    }

    // 3. Passive permeability (ext <-> int) & wall partitioning (int -> wall)
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      const base = i * NUM_SPECIES;
      for (let s = 0; s < NUM_SPECIES; s++) {
        const cExt = this.ext[base + s];
        const cInt = this.int[base + s];
        if (cExt === 0 && cInt === 0) continue;
        const perm = cfg.permQ16[SPECIES[s].len - 1];
        const r = hash32(seed, step, i, 400 + s);
        const dIn = cExt > 0 ? stochasticCount(cExt, perm, r) : 0;
        const dOut = cInt > 0 ? stochasticCount(cInt, perm, r >>> 16) : 0;
        const net = dIn - dOut;
        if (net !== 0) {
          this.ext[base + s] -= net;
          this.int[base + s] += net;
        }
      }

      // Wall-class tetramers inside partition into wall
      const wBase = i * NUM_WALL_SPECIES;
      const maxWi = cfg.singleWallOnly ? 1 : NUM_WALL_SPECIES;
      for (let wi = 0; wi < maxWi; wi++) {
        const s = WALL_SPECIES[wi];
        const cInt = this.int[base + s];
        if (cInt === 0) continue;
        const r = hash32(seed, step, i, 500 + wi);
        const k = stochasticCount(cInt, cfg.kWallInsertQ16, r);
        if (k > 0) {
          this.int[base + s] -= k;
          this.wall[wBase + wi] += k;
        }
      }
    }

    // 4. Catalysis (unbiased random tile permutation)
    this.lysedThisStep.fill(0);
    const [catStart, catStride] = this.permuteParams(step, 600);
    const G = cfg.genomeSlots;
    for (let idx = 0; idx < N; idx++) {
      const i = (catStart + idx * catStride) % N;
      if (!this.alive[i]) continue;

      // Energy dissipation
      let e = this.energy[i];
      if (e > 0) {
        const rE = hash32(seed, step, i, 610);
        const loss = stochasticCount(e, cfg.kEDissQ16, rE);
        e -= loss;
        this.energy[i] = e;
      }

      const base = i * NUM_SPECIES;
      const gBase = i * G;
      for (let slot = 0; slot < G; slot++) {
        const raw = cfg.neutralGenome
          ? (slot < cfg.neutralBaseline.length ? cfg.neutralBaseline[slot] : 0)
          : this.genome[gBase + slot];
        const cat = decodeCatalyst(raw);
        if (cat.op === OP_NOP) continue;

        const scaleQ16 = specificityScaleQ16(cat.wildcards, cfg.flatTradeoff);
        const rateQ16 = Math.floor((cfg.kCatQ16 * scaleQ16) / 65536);
        if (rateQ16 <= 0) continue;

        const targets = getMatchedSpecies(raw);

        if (cat.op === OP_CLEAVE) {
          for (let ti = 0; ti < targets.length; ti++) {
            const s = targets[ti];
            const c = this.int[base + s];
            if (c === 0) continue;
            const r = hash32(seed, step, i, 700 + slot * 32 + ti);
            const k = stochasticCount(c, rateQ16, r);
            if (k > 0) {
              this.int[base + s] -= k;
              this.int[base + CLEAVE_LEFT[s * 4 + cat.splitPos]] += k;
              this.int[base + CLEAVE_RIGHT[s * 4 + cat.splitPos]] += k;
              this.energy[i] = Math.min(cfg.eMax, this.energy[i] + k * cfg.eBond);
              obs?.onCleave?.(i, s, k);
            }
          }
        } else if (cat.op === OP_LIGATE) {
          const nT = targets.length;
          const ti0 = nT > 1 ? (hash32(seed, step, i, 990 + slot) % nT) : 0;
          for (let off = 0; off < nT; off++) {
            const ti = (ti0 + off) % nT;
            const eNow = this.energy[i];
            if (eNow < cfg.eLig) break;
            const s = targets[ti];
            const left = CLEAVE_LEFT[s * 4 + cat.splitPos];
            const right = CLEAVE_RIGHT[s * 4 + cat.splitPos];
            const avail = left === right
              ? (this.int[base + left] >> 1)
              : Math.min(this.int[base + left], this.int[base + right]);
            if (avail <= 0) continue;
            const maxByE = Math.floor(eNow / cfg.eLig);
            const cap = Math.min(avail, maxByE);
            const r = hash32(seed, step, i, 1000 + slot * 32 + ti);
            const k = Math.min(cap, stochasticCount(avail, rateQ16, r));
            if (k > 0) {
              this.int[base + left] -= k;
              this.int[base + right] -= k;
              this.int[base + s] += k;
              this.energy[i] -= k * cfg.eLig;
              obs?.onLigate?.(i, s, k);
            }
          }
        } else if (cat.op === OP_IMPORT) {
          for (let ti = 0; ti < targets.length; ti++) {
            const s = targets[ti];
            const diff = this.ext[base + s] - this.int[base + s];
            if (diff <= 0) continue;
            const r = hash32(seed, step, i, 1300 + slot * 32 + ti);
            const k = stochasticCount(diff, rateQ16, r);
            if (k > 0) {
              this.ext[base + s] -= k;
              this.int[base + s] += k;
            }
          }
        } else if (cat.op === OP_LYSE && cfg.enableLyse) {
          // 1) Self-toxicity (if not neutralWallLyse): cleaves own matching wall at 0.5x rate
          if (!cfg.neutralWallLyse) {
            const selfRate = rateQ16 >>> 1;
            const wBase = i * NUM_WALL_SPECIES;
            for (let ti = 0; ti < targets.length; ti++) {
              const s = targets[ti];
              const wi = SPECIES[s].wallIndex;
              if (wi < 0) continue;
              const wc = this.wall[wBase + wi];
              if (wc === 0) continue;
              const r = hash32(seed, step, i, 1600 + slot * 16 + wi);
              const k = stochasticCount(wc, selfRate, r);
              if (k > 0) {
                this.wall[wBase + wi] -= k;
                this.ext[base + CLEAVE_LEFT[s * 4 + cat.splitPos]] += k;
                this.ext[base + CLEAVE_RIGHT[s * 4 + cat.splitPos]] += k;
              }
            }
          }

          // 2) Neighbor wall lysis: pick uniformly among alive neighbors that carry a matching target
          const elig: number[] = [];
          for (let d = 0; d < 4; d++) {
            const nb = this.neighborTile(i, d);
            if (!this.alive[nb]) continue;
            const nbWBase = nb * NUM_WALL_SPECIES;
            if (cfg.neutralWallLyse) {
              for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
                if (this.wall[nbWBase + wi] > 0) { elig.push(nb); break; }
              }
            } else {
              for (let ti = 0; ti < targets.length; ti++) {
                const wi = SPECIES[targets[ti]].wallIndex;
                if (wi >= 0 && this.wall[nbWBase + wi] > 0) { elig.push(nb); break; }
              }
            }
          }
          if (elig.length > 0) {
            const rDir = hash32(seed, step, i, 1800 + slot);
            const nb = elig[rDir % elig.length];
            const nbWBase = nb * NUM_WALL_SPECIES;
            if (cfg.neutralWallLyse) {
              for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
                const wc = this.wall[nbWBase + wi];
                if (wc === 0) continue;
                const r = hash32(seed, step, i, 1900 + slot * 16 + wi);
                const k = stochasticCount(wc, cfg.neutralLyseRateQ16, r);
                if (k > 0) {
                  const s = WALL_SPECIES[wi];
                  const left = CLEAVE_LEFT[s * 4 + 2];
                  const right = CLEAVE_RIGHT[s * 4 + 2];
                  this.wall[nbWBase + wi] -= k;
                  this.int[base + left] += k;
                  this.int[base + right] += k;
                  this.energy[i] = Math.min(cfg.eMax, this.energy[i] + k * cfg.eBond);
                  this.lysedThisStep[nb] = 1;
                  obs?.onLyse?.(i, nb, wi, k);
                }
              }
            } else {
              for (let ti = 0; ti < targets.length; ti++) {
                const s = targets[ti];
                const wi = SPECIES[s].wallIndex;
                if (wi < 0) continue;
                const wc = this.wall[nbWBase + wi];
                if (wc === 0) continue;
                const r = hash32(seed, step, i, 1900 + slot * 16 + wi);
                const k = stochasticCount(wc, rateQ16, r);
                if (k > 0) {
                  const left = CLEAVE_LEFT[s * 4 + cat.splitPos];
                  const right = CLEAVE_RIGHT[s * 4 + cat.splitPos];
                  this.wall[nbWBase + wi] -= k;
                  this.int[base + left] += k;
                  this.int[base + right] += k;
                  this.energy[i] = Math.min(cfg.eMax, this.energy[i] + k * cfg.eBond);
                  this.lysedThisStep[nb] = 1;
                  obs?.onLyse?.(i, nb, wi, k);
                }
              }
            }
          }
        }
      }
    }

    // 5a. Lysis & background rupture check (dissolve compartments whose wall < wMin or ruptured)
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      const wBase = i * NUM_WALL_SPECIES;
      let wTotal = 0;
      for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) wTotal += this.wall[wBase + wi];
      const ruptured = cfg.pRuptureQ16 > 0 && (hash32(seed, step, i, 2150) & 0xffff) < cfg.pRuptureQ16;
      if (wTotal < cfg.wMin || ruptured) {
        const base = i * NUM_SPECIES;
        for (let s = 0; s < NUM_SPECIES; s++) {
          if (this.int[base + s] > 0) {
            this.ext[base + s] += this.int[base + s];
            this.int[base + s] = 0;
          }
        }
        for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
          const wc = this.wall[wBase + wi];
          if (wc > 0) {
            this.ext[base + WALL_SPECIES[wi]] += wc;
            this.wall[wBase + wi] = 0;
          }
        }
        this.alive[i] = 0;
        this.energy[i] = 0;
        obs?.onDeath?.(i, this.lysedThisStep[i] === 1);
      }
    }

    // 5b. Division check (unbiased random tile permutation)
    const [divStart, divStride] = this.permuteParams(step, 2200);
    for (let idx = 0; idx < N; idx++) {
      const i = (divStart + idx * divStride) % N;
      if (!this.alive[i]) continue;
      const wBase = i * NUM_WALL_SPECIES;
      let wTotal = 0;
      for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) wTotal += this.wall[wBase + wi];
      if (wTotal < cfg.wDiv) continue;

      const base = i * NUM_SPECIES;
      let intMass = 0;
      for (let s = 0; s < NUM_SPECIES; s++) {
        const c = this.int[base + s];
        if (c > 0) intMass += c * SPECIES[s].len;
      }
      if (intMass < cfg.mDiv) continue;

      // Sample uniformly among all empty 4-neighbors (zero directional bias)
      const emptyNbs: number[] = [];
      for (let d = 0; d < 4; d++) {
        const nb = this.neighborTile(i, d);
        if (!this.alive[nb]) emptyNbs.push(nb);
      }
      if (emptyNbs.length === 0) continue;
      const r0 = hash32(seed, step, i, 2300);
      const child = emptyNbs[r0 % emptyNbs.length];

      // Split wall, int, energy 50/50 with exact conservation
      const cBase = child * NUM_SPECIES;
      const cWBase = child * NUM_WALL_SPECIES;
      for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
        const wc = this.wall[wBase + wi];
        if (wc === 0) continue;
        const r = hash32(seed, step, i, 2310 + wi);
        const toChild = (wc >> 1) + ((wc & 1) & (r & 1));
        this.wall[wBase + wi] = wc - toChild;
        this.wall[cWBase + wi] = toChild;
      }
      for (let s = 0; s < NUM_SPECIES; s++) {
        const c = this.int[base + s];
        if (c === 0) continue;
        const r = hash32(seed, step, i, 2320 + s);
        const toChild = (c >> 1) + ((c & 1) & (r & 1));
        this.int[base + s] = c - toChild;
        this.int[cBase + s] = toChild;
      }
      const eChild = this.energy[i] >> 1;
      this.energy[i] -= eChild;
      this.energy[child] = eChild;

      // Copy & mutate genome
      const gParent = i * G;
      const gChild = child * G;
      for (let slot = 0; slot < G; slot++) {
        let raw = this.genome[gParent + slot];
        const rM = hash32(seed, step, i, 2400 + slot);
        if ((rM & 0xffff) < cfg.mutRateQ16) {
          const mode = (rM >>> 16) & 7;
          if (mode === 0) {
            // Duplicate another slot from parent
            const src = (rM >>> 19) % G;
            raw = this.genome[gParent + src];
          } else if (mode === 1) {
            // Mutate op (preserve identical mutation kernel regardless of enableLyse)
            const newOp = (rM >>> 19) % NUM_OPS;
            raw = (raw & 0x0fff) | (newOp << 12);
          } else if (mode === 2) {
            // Bit transposition in pattern (1-step move between balanced wall motifs)
            const b1 = (rM >>> 19) & 3;
            const b2 = (b1 + 1 + ((rM >>> 21) % 3)) & 3;
            const v1 = (raw >>> b1) & 1;
            const v2 = (raw >>> b2) & 1;
            if (v1 !== v2) raw ^= (1 << b1) | (1 << b2);
          } else if (mode === 3) {
            // Resample a fresh 0-wildcard specialist catalyst (escapes NOP / Hamming valleys)
            const r2 = hash32(seed, step, i, 2500 + slot);
            const newOp = r2 % NUM_OPS;
            if (newOp === OP_NOP) {
              raw = 0;
            } else {
              const lenCode = newOp === OP_LYSE ? 2 : ((r2 >>> 4) % 3); // LYSE targets tetramers
              const targetLen = lenCode === 0 ? 2 : lenCode === 1 ? 3 : 4;
              const pat = newOp === OP_LYSE
                ? SPECIES[WALL_SPECIES[(r2 >>> 8) % NUM_WALL_SPECIES]].bits
                : ((r2 >>> 8) & ((1 << targetLen) - 1));
              const mask = (1 << targetLen) - 1;
              const splitCode = ((r2 >>> 16) % (targetLen - 1)) & 3;
              raw = (newOp << 12) | (splitCode << 10) | (lenCode << 8) | (mask << 4) | pat;
            }
          } else {
            // Single bit flip in bits 0..11 (pattern, mask, len, splitPos)
            const bit = (rM >>> 19) % 12;
            raw ^= 1 << bit;
          }
        }
        this.genome[gChild + slot] = raw & 0x7fff;
      }

      this.alive[child] = 1;
      this.founder[child] = this.founder[i];
      obs?.onDivide?.(i, child);
    }

    // 5c. Brownian droplet drift (swap compartment with random 4-neighbor; exact conservation)
    if (cfg.moveProbQ16 > 0) {
      const [mvStart, mvStride] = this.permuteParams(step, 2550);
      for (let idx = 0; idx < N; idx++) {
        const i = (mvStart + idx * mvStride) % N;
        if (!this.alive[i]) continue;
        const r = hash32(seed, step, i, 2560);
        if ((r & 0xffff) >= cfg.moveProbQ16) continue;
        const j = this.neighborTile(i, (r >>> 16) & 3);
        if (i === j) continue;

        // Swap alive, energy, founder
        const aTmp = this.alive[i]; this.alive[i] = this.alive[j]; this.alive[j] = aTmp;
        const eTmp = this.energy[i]; this.energy[i] = this.energy[j]; this.energy[j] = eTmp;
        const fTmp = this.founder[i]; this.founder[i] = this.founder[j]; this.founder[j] = fTmp;

        // Swap int
        const iBase = i * NUM_SPECIES;
        const jBase = j * NUM_SPECIES;
        for (let s = 0; s < NUM_SPECIES; s++) {
          const t = this.int[iBase + s];
          this.int[iBase + s] = this.int[jBase + s];
          this.int[jBase + s] = t;
        }
        // Swap wall
        const wiBase = i * NUM_WALL_SPECIES;
        const wjBase = j * NUM_WALL_SPECIES;
        for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
          const t = this.wall[wiBase + wi];
          this.wall[wiBase + wi] = this.wall[wjBase + wi];
          this.wall[wjBase + wi] = t;
        }
        // Swap genome
        const giBase = i * G;
        const gjBase = j * G;
        for (let s = 0; s < G; s++) {
          const t = this.genome[giBase + s];
          this.genome[giBase + s] = this.genome[gjBase + s];
          this.genome[gjBase + s] = t;
        }
        obs?.onSwap?.(i, j);
      }
    }

    // 6. Unbiased conserved diffusion of ext
    this.extDelta.fill(0);
    for (let i = 0; i < N; i++) {
      const base = i * NUM_SPECIES;
      const n0 = this.neighborTile(i, 0) * NUM_SPECIES;
      const n1 = this.neighborTile(i, 1) * NUM_SPECIES;
      const n2 = this.neighborTile(i, 2) * NUM_SPECIES;
      const n3 = this.neighborTile(i, 3) * NUM_SPECIES;
      const nbs = [n0, n1, n2, n3];
      for (let s = 0; s < NUM_SPECIES; s++) {
        const c = this.ext[base + s];
        if (c === 0) continue;
        const dRate = cfg.diffQ16[SPECIES[s].len - 1];
        const r = hash32(seed, step, i, 2600 + s);
        const out = stochasticCount(c, dRate, r);
        if (out === 0) continue;
        this.extDelta[base + s] -= out;
        const q = out >> 2;
        const rem = out & 3;
        if (q > 0) {
          this.extDelta[n0 + s] += q;
          this.extDelta[n1 + s] += q;
          this.extDelta[n2 + s] += q;
          this.extDelta[n3 + s] += q;
        }
        if (rem > 0) {
          const dStart = (r >>> 16) & 3;
          for (let k = 0; k < rem; k++) {
            this.extDelta[nbs[(dStart + k) & 3] + s] += 1;
          }
        }
      }
    }
    for (let idx = 0; idx < this.ext.length; idx++) {
      this.ext[idx] += this.extDelta[idx];
    }
  }
}
