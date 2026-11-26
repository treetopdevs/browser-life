/**
 * Phase B1 (Direction 2): Pointer-Free Zwicker Active Phase-Separating Droplets.
 *
 * ZERO `Compartment` struct, ZERO `alive[]` array, ZERO `split()` function, ZERO pointers.
 * Compartments emerge purely from conserved discrete Cahn-Hilliard phase separation
 * (9-point isotropic Laplacian, double-well chemical potential, exact integer edge fluxes)
 * coupled to a conserved fuel-driven active chemical cycle (A <-> F -> W -> A).
 *
 * When a droplet grows past its critical radius R_c, rim synthesis + core hydrolysis
 * (Zwicker et al., Nature Physics 2017) triggers a shape instability: the droplet
 * spontaneously elongates and pinches into two daughter droplets.
 *
 * Supports M = 6 immiscible wall motifs (matching Phase A's 6 balanced wall tetramers)
 * with cross-motif Flory-Huggins repulsion chi, enabling motif-specific lysis and
 * Red Queen dynamics on emergent droplets.
 */

import { hash32 } from './model.ts';

export const NUM_MOTIFS = 6;

export interface DropletConfig {
  readonly width: number;
  readonly height: number;
  readonly seed: number;

  // Fixed-point unit scale: 1.0 concentration = `scale` integer matter units per tile
  readonly scale: number; // default 1000

  // Initial matter per tile (split into soluble waste A + fuel F)
  readonly initMatterPerTile: number;

  // Cahn-Hilliard phase separation parameters (dimensionless floats converted to exact integer edge fluxes)
  readonly bulkB: number; // double-well barrier height
  readonly kappa: number; // surface tension coefficient (9-point isotropic Laplacian)
  readonly chi: number; // cross-motif immiscibility repulsion
  readonly mobility: number; // Cahn-Hilliard edge mobility M
  readonly diffW: number; // gentle Fickian W diffusion (enables smooth boundary expansion & mitosis)

  // Soluble diffusion (fraction leaving tile per step, distributed symmetrically to 4 neighbors)
  readonly diffF: number;
  readonly diffA: number;

  // Conserved active chemical cycle: A --(kLight)--> F --(kSyn * c_m)--> W_m --(kDeg)--> A
  readonly kLight: number;
  readonly kSyn: number;
  readonly kDeg: number;
  readonly synThreshold: number; // minimum concentration c_m for autocatalytic synthesis (prevents uniform film)
  readonly noiseAmp: number; // tiny thermal flux noise to break exact symmetry for division

  // Phase B1.2/B1.3: Heritable motif-specific secreted lysin & conserved motif switching (off by default: kLyse = 0)
  readonly kLyse: number; // hydrolytic lysis rate per unit lysin concentration (W_target -> A)
  readonly neutralLyse: boolean; // control: foreign-motif-only motif-blind secreted lysin
  readonly lyseCoreMin: number; // min droplet density (fraction of scale) to carry/secrete a lysin
  readonly mutLyse: number; // per-step prob a core tile mutates its lysin target
  readonly mutMotif: number; // per-step prob a core tile isomerizes a packet of W_m -> W_m' (exact conservation)
  readonly lyseUpkeep: number; // tiny extra W degradation for carrying an active lysin (prevents free-lunch weapons)
  readonly secreteL: number; // per-step lysin secretion rate from active core tiles
  readonly diffL: number; // isotropic 4-neighbor diffusion fraction of lysin in water (0..0.5)
  readonly decayL: number; // per-step decay rate of lysin in water (screening length sqrt((diffL/4)/decayL))

  // Phase B1.4: Conserved obligate phage / parasite field P[tile * 6 + m] (off by default: kInfect = 0)
  readonly kInfect: number; // host-specific lytic infection rate (W_m -> phageYield*P_m + (1-phageYield)*A)
  readonly neutralPhage: boolean; // control: motif-blind generalist phage infecting all W_m equally
  readonly phageYield: number; // fraction of cleaved W_m converted to new P_m (rest -> A)
  readonly diffP: number; // isotropic 4-neighbor integer diffusion fraction of P in water
  readonly kDecayP: number; // per-step phage decay rate (P_m -> A) in water
  readonly mutPhage: number; // per-step prob a droplet tile spawns a tiny conserved 5-unit phage packet (W -> P)
}

export function defaultDropletConfig(overrides: Partial<DropletConfig> = {}): DropletConfig {
  return {
    width: 48,
    height: 48,
    seed: 1,
    scale: 1000,
    initMatterPerTile: 1000,
    bulkB: 0.3,
    kappa: 0.06,
    chi: 1.5,
    mobility: 0.008,
    diffW: 0.04,
    diffF: 0.20,
    diffA: 0.22,
    kLight: 0.026,
    kSyn: 1.0,
    kDeg: 0.060,
    synThreshold: 0.0,
    noiseAmp: 1.5,
    kLyse: 0,
    neutralLyse: false,
    lyseCoreMin: 0.18,
    mutLyse: 0,
    mutMotif: 0,
    lyseUpkeep: 0.002,
    secreteL: 0.025,
    diffL: 0.48,
    decayL: 0.025,
    kInfect: 0,
    neutralPhage: false,
    phageYield: 0.5,
    diffP: 0.30,
    kDecayP: 0.015,
    mutPhage: 0,
    ...overrides,
  };
}

/** Exact integer stochastic rounding of a signed or unsigned real value `x`. */
function roundStochastic(x: number, rnd: number): number {
  const f = Math.floor(x);
  const frac = x - f;
  return f + ((rnd & 0xffff) / 65536 < frac ? 1 : 0);
}

export interface ObservedDroplet {
  readonly id: number;
  readonly motif: number;
  readonly area: number; // tiles with c_m >= coreThreshold
  readonly mass: number; // total integer W_m inside component
  readonly cx: number; // circular-mean x
  readonly cy: number; // circular-mean y
}

export class DropletWorld {
  readonly cfg: DropletConfig;
  readonly nTiles: number;
  stepCount = 0;

  // Exact integer matter pools (conserved: sum(A + F + sum_m W_m + sum_m P_m) === initTotalMatter)
  readonly A: Int32Array; // soluble waste / monomers
  readonly F: Int32Array; // soluble high-energy feedstock
  readonly W: Int32Array; // [tile * NUM_MOTIFS + m] droplet-forming oligomers
  readonly P: Int32Array; // [tile * NUM_MOTIFS + m] conserved motif-specific phage / obligate parasite oligomers
  // Heritable lysin target per tile (-1 = none, 0..5 = target motif); advects with W inflow
  readonly lyseTarget: Int8Array;
  // Secreted trace lysin/bacteriocin catalytic field [tile * NUM_MOTIFS + m] (massless enzyme; matter cleavage W->F/A is exact)
  readonly L: Float64Array;

  // Scratch buffers (never serialized)
  private readonly mu: Float64Array;
  private readonly deltaA: Int32Array;
  private readonly deltaF: Int32Array;
  private readonly deltaW: Int32Array;
  private readonly deltaP: Int32Array;
  private readonly maxInflow: Int32Array;
  private readonly maxInflowSrc: Int32Array;
  private readonly maxInflowTie: Int32Array;
  private readonly lyseNext: Int8Array;
  private readonly isCore: Uint8Array;
  private readonly prevCore: Uint8Array;
  private readonly LNext: Float64Array;

  // Pure observer counters
  lyseMassCleaved = 0;
  phageMassCleaved = 0;

  readonly initTotalMatter: number;

  constructor(cfg: DropletConfig) {
    if (!Number.isSafeInteger(cfg.width) || cfg.width <= 0 || !Number.isSafeInteger(cfg.height) || cfg.height <= 0) {
      throw new Error(`Invalid grid dimensions: ${cfg.width}x${cfg.height}`);
    }
    if (!Number.isSafeInteger(cfg.scale) || cfg.scale <= 0) {
      throw new Error(`Invalid scale: ${cfg.scale}`);
    }
    if (!Number.isSafeInteger(cfg.initMatterPerTile) || cfg.initMatterPerTile < 0) {
      throw new Error(`Invalid initMatterPerTile: ${cfg.initMatterPerTile}`);
    }
    if (
      !Number.isFinite(cfg.diffL) ||
      cfg.diffL < 0 ||
      cfg.diffL > 1 ||
      !Number.isFinite(cfg.decayL) ||
      cfg.decayL < 0 ||
      cfg.decayL > 1 ||
      !Number.isFinite(cfg.secreteL) ||
      cfg.secreteL < 0
    ) {
      throw new Error(`Invalid lysin field parameters: diffL=${cfg.diffL}, decayL=${cfg.decayL}, secreteL=${cfg.secreteL}`);
    }
    if (
      !Number.isFinite(cfg.kInfect) ||
      cfg.kInfect < 0 ||
      !Number.isFinite(cfg.phageYield) ||
      cfg.phageYield < 0 ||
      cfg.phageYield > 1 ||
      !Number.isFinite(cfg.diffP) ||
      cfg.diffP < 0 ||
      cfg.diffP > 1 ||
      !Number.isFinite(cfg.kDecayP) ||
      cfg.kDecayP < 0 ||
      cfg.kDecayP > 1 ||
      !Number.isFinite(cfg.mutPhage) ||
      cfg.mutPhage < 0 ||
      cfg.mutPhage > 1
    ) {
      throw new Error(
        `Invalid phage parameters: kInfect=${cfg.kInfect}, phageYield=${cfg.phageYield}, diffP=${cfg.diffP}, kDecayP=${cfg.kDecayP}, mutPhage=${cfg.mutPhage}`,
      );
    }
    const nTiles = cfg.width * cfg.height;
    if (nTiles * cfg.initMatterPerTile > 0x3fffffff) {
      throw new Error(`Total world matter (${nTiles * cfg.initMatterPerTile}) exceeds Int32-safe bound (1073741823)`);
    }
    this.cfg = cfg;
    this.nTiles = nTiles;
    this.A = new Int32Array(this.nTiles);
    this.F = new Int32Array(this.nTiles);
    this.W = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.P = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.lyseTarget = new Int8Array(this.nTiles).fill(-1);
    this.L = new Float64Array(this.nTiles * NUM_MOTIFS);
    this.mu = new Float64Array(this.nTiles);
    this.deltaA = new Int32Array(this.nTiles);
    this.deltaF = new Int32Array(this.nTiles);
    this.deltaW = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.deltaP = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.maxInflow = new Int32Array(this.nTiles);
    this.maxInflowSrc = new Int32Array(this.nTiles).fill(-1);
    this.maxInflowTie = new Int32Array(this.nTiles);
    this.lyseNext = new Int8Array(this.nTiles).fill(-1);
    this.isCore = new Uint8Array(this.nTiles);
    this.prevCore = new Uint8Array(this.nTiles);
    this.LNext = new Float64Array(this.nTiles * NUM_MOTIFS);

    const initF = Math.floor(cfg.initMatterPerTile * 0.5);
    const initA = cfg.initMatterPerTile - initF;
    for (let i = 0; i < this.nTiles; i++) {
      this.F[i] = initF;
      this.A[i] = initA;
    }
    this.initTotalMatter = this.totalMatter();
  }

  /**
   * Seed a circular droplet of motif `m` at (cx, cy) with radius `r` by converting local
   * soluble A/F into W_m (preserves exact total matter!).
   */
  seedDroplet(cx: number, cy: number, radius: number, motif = 0, density = 0.95, lyseTarget = -1): void {
    const W = this.cfg.width;
    const H = this.cfg.height;
    const target = Math.round(density * this.cfg.scale);
    const r2 = radius * radius;

    let needed = 0;
    const targets: number[] = [];
    for (let y = 0; y < H; y++) {
      let dy = Math.abs(y - cy);
      if (dy > H * 0.5) dy = H - dy;
      for (let x = 0; x < W; x++) {
        let dx = Math.abs(x - cx);
        if (dx > W * 0.5) dx = W - dx;
        if (dx * dx + dy * dy <= r2) {
          const i = y * W + x;
          targets.push(i);
          needed += target;
        }
      }
    }

    // Preflight total soluble matter
    let totalSoluble = 0;
    for (let i = 0; i < this.nTiles; i++) totalSoluble += this.A[i] + this.F[i];
    if (totalSoluble < needed) {
      throw new Error(`Not enough soluble matter to seed droplet (need ${needed}, have ${totalSoluble})`);
    }

    // Withdraw `needed` units uniformly from A (then F), starting from the droplet center
    // (floor pass + remainder pass) to preserve exact conservation without tile-0 bias.
    const startOff = (((cy % H) + H) % H) * W + (((cx % W) + W) % W);
    let rem = needed;
    for (let pass = 0; pass < 2 && rem > 0; pass++) {
      const pool = pass === 0 ? this.A : this.F;
      let poolSum = 0;
      for (let i = 0; i < this.nTiles; i++) poolSum += pool[i];
      if (poolSum <= 0) continue;
      let left = Math.min(rem, poolSum);
      // Proportional floor withdrawal
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
      // Distribute any remaining units 1 per eligible tile starting from droplet center
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
      this.W[i * NUM_MOTIFS + motif] += target;
      this.prevCore[i] = 1;
      if (lyseTarget >= 0) this.lyseTarget[i] = lyseTarget;
    }
  }

  /**
   * Seed a small conserved phage inoculum of `amount` units at (cx, cy) targeting `motif`,
   * converting local soluble A/F into P_motif (preserves exact total matter).
   */
  seedPhage(cx: number, cy: number, motif: number, amount = 20): void {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) {
      throw new Error(`Invalid phage coordinates: (${cx}, ${cy})`);
    }
    if (!Number.isSafeInteger(motif) || motif < 0 || motif >= NUM_MOTIFS) {
      throw new Error(`Invalid phage motif: ${motif}`);
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid phage amount: ${amount}`);
    }
    const W = this.cfg.width;
    const H = this.cfg.height;
    const x = ((cx % W) + W) % W;
    const y = ((cy % H) + H) % H;
    const i = y * W + x;
    const want = Math.round(amount);
    const have = this.A[i] + this.F[i];
    if (have < want) {
      throw new Error(`Not enough soluble matter at (${x},${y}) to seed phage (need ${want}, have ${have})`);
    }
    const fromA = Math.min(this.A[i], want);
    const fromF = want - fromA;
    this.A[i] -= fromA;
    this.F[i] -= fromF;
    this.P[i * NUM_MOTIFS + motif] += want;
  }

  /** Exact integer total matter across A, F, all W motifs, and all P phage species. */
  totalMatter(): number {
    let total = 0;
    for (let i = 0; i < this.nTiles; i++) {
      total += this.A[i] + this.F[i];
    }
    for (let i = 0; i < this.W.length; i++) {
      total += this.W[i] + this.P[i];
    }
    return total;
  }

  /** Pure connected-components observer: infer discrete droplets from density field (never in physics). */
  findDroplets(coreThreshold = 0.45): ObservedDroplet[] {
    const W = this.cfg.width;
    const H = this.cfg.height;
    const thresh = Math.round(coreThreshold * this.cfg.scale);
    const visited = new Uint8Array(this.nTiles);
    const droplets: ObservedDroplet[] = [];
    const queue = new Int32Array(this.nTiles);

    for (let m = 0; m < NUM_MOTIFS; m++) {
      visited.fill(0);
      for (let start = 0; start < this.nTiles; start++) {
        if (visited[start] || this.W[start * NUM_MOTIFS + m] < thresh) continue;
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
          const wm = this.W[i * NUM_MOTIFS + m];
          area++;
          mass += wm;
          const x = i % W;
          const y = (i / W) | 0;
          const ax = (2 * Math.PI * x) / W;
          const ay = (2 * Math.PI * y) / H;
          sxCos += Math.cos(ax) * wm;
          sxSin += Math.sin(ax) * wm;
          syCos += Math.cos(ay) * wm;
          sySin += Math.sin(ay) * wm;

          const xL = x > 0 ? x - 1 : W - 1;
          const xR = x + 1 < W ? x + 1 : 0;
          const yU = y > 0 ? y - 1 : H - 1;
          const yD = y + 1 < H ? y + 1 : 0;
          const nbs = [y * W + xR, y * W + xL, yD * W + x, yU * W + x];
          for (let d = 0; d < 4; d++) {
            const nb = nbs[d];
            if (!visited[nb] && this.W[nb * NUM_MOTIFS + m] >= thresh) {
              visited[nb] = 1;
              queue[tail++] = nb;
            }
          }
        }

        if (area >= 3) {
          let cx = (Math.atan2(sxSin, sxCos) / (2 * Math.PI)) * W;
          if (cx < 0) cx += W;
          let cy = (Math.atan2(sySin, syCos) / (2 * Math.PI)) * H;
          if (cy < 0) cy += H;
          droplets.push({ id: droplets.length + 1, motif: m, area, mass, cx, cy });
        }
      }
    }
    return droplets;
  }

  /** Advance one exact-conservation step (Cahn-Hilliard phase separation + active chemistry + soluble diffusion). */
  step(): void {
    const step = ++this.stepCount;
    const cfg = this.cfg;
    const W = cfg.width;
    const H = cfg.height;
    const N = this.nTiles;
    const invScale = 1 / cfg.scale;
    const seed = cfg.seed;

    // 1. Conserved active chemistry at each tile: A -> F (light in dilute solvent), F -> W_m (inside droplet), W_m -> A (hydrolysis)
    const synThreshInt = Math.round(cfg.synThreshold * cfg.scale);
    for (let i = 0; i < N; i++) {
      const wBase = i * NUM_MOTIFS;
      let wSum = 0;
      for (let m = 0; m < NUM_MOTIFS; m++) wSum += this.W[wBase + m];
      const solventFrac = Math.max(0, 1 - wSum * invScale);

      // 1a. Light: A -> F (in dilute exterior solvent only -> creates core fuel depletion for Zwicker division)
      const a0 = this.A[i];
      if (a0 > 0 && cfg.kLight > 0 && solventFrac > 0) {
        const dAF = Math.min(a0, roundStochastic(a0 * cfg.kLight * solventFrac, hash32(seed, step, i, 10)));
        this.A[i] -= dAF;
        this.F[i] += dAF;
      }

      // 1b. Spontaneous hydrolysis (W_m -> A) & symmetric autocatalytic synthesis (F + 2W_m -> 3W_m)
      const f0 = this.F[i];
      let synDemandSum = 0;
      const synDemand = new Float64Array(NUM_MOTIFS);
      for (let m = 0; m < NUM_MOTIFS; m++) {
        const wm = this.W[wBase + m];
        if (wm === 0) continue;

        // Hydrolysis: W_m -> A
        const dWA = Math.min(wm, roundStochastic(wm * cfg.kDeg, hash32(seed, step, i, 20 + m)));
        this.W[wBase + m] -= dWA;
        this.A[i] += dWA;

        // Compute symmetric synthesis demand from pre-consumption f0
        if (f0 > 0 && wm >= synThreshInt) {
          const c = Math.min(1.5, wm * invScale);
          const dem = f0 * cfg.kSyn * c * c;
          synDemand[m] = dem;
          synDemandSum += dem;
        }
      }
      if (synDemandSum > 0 && f0 > 0) {
        const scaleDown = synDemandSum > f0 ? f0 / synDemandSum : 1;
        let fLeft = f0;
        const m0 = hash32(seed, step, i, 35) % NUM_MOTIFS;
        for (let off = 0; off < NUM_MOTIFS && fLeft > 0; off++) {
          const m = (m0 + off) % NUM_MOTIFS;
          const dem = synDemand[m];
          if (dem <= 0) continue;
          const dFW = Math.min(fLeft, roundStochastic(dem * scaleDown, hash32(seed, step, i, 40 + m)));
          this.F[i] -= dFW;
          this.W[wBase + m] += dFW;
          fLeft -= dFW;
        }
      }
    }

    // 2. Conserved Cahn-Hilliard phase separation for each active motif m
    //    Edge-wise symmetric integer fluxes guarantee residual === 0 and W >= 0.
    this.deltaW.fill(0);
    const trackGenetics = cfg.kLyse > 0 || cfg.mutLyse > 0 || cfg.mutMotif > 0;
    if (trackGenetics) {
      this.maxInflow.fill(0);
      this.maxInflowSrc.fill(-1);
      this.maxInflowTie.fill(0);
    }
    const recordInflow = (dst: number, src: number, flux: number, tieCh: number) => {
      if (flux > this.maxInflow[dst]) {
        this.maxInflow[dst] = flux;
        this.maxInflowSrc[dst] = src;
        this.maxInflowTie[dst] = 1;
      } else if (flux === this.maxInflow[dst]) {
        const cnt = ++this.maxInflowTie[dst];
        if (hash32(seed, step, dst, tieCh) % cnt === 0) {
          this.maxInflowSrc[dst] = src;
        }
      }
    };
    for (let m = 0; m < NUM_MOTIFS; m++) {
      // Skip motif if absent everywhere
      let hasMotif = false;
      for (let i = 0; i < N; i++) {
        if (this.W[i * NUM_MOTIFS + m] > 0) { hasMotif = true; break; }
      }
      if (!hasMotif) continue;

      // 2a. Compute chemical potential mu[i] = bulk'(c_m) + chi * sum_{m'!=m} c_{m'} - kappa * lap9(c_m)
      for (let y = 0; y < H; y++) {
        const yU = (y > 0 ? y - 1 : H - 1) * W;
        const y0 = y * W;
        const yD = (y + 1 < H ? y + 1 : 0) * W;
        for (let x = 0; x < W; x++) {
          const xL = x > 0 ? x - 1 : W - 1;
          const xR = x + 1 < W ? x + 1 : 0;
          const i = y0 + x;
          const wBase = i * NUM_MOTIFS;
          const c = this.W[wBase + m] * invScale;

          // Other motifs' density at tile i (immiscibility repulsion)
          let cOther = 0;
          for (let om = 0; om < NUM_MOTIFS; om++) {
            if (om !== m) cOther += this.W[wBase + om] * invScale;
          }

          // 9-point isotropic Laplacian: (4*(cardinal) + (diagonal) - 20*center) / 6
          const card =
            this.W[(y0 + xR) * NUM_MOTIFS + m] +
            this.W[(y0 + xL) * NUM_MOTIFS + m] +
            this.W[(yD + x) * NUM_MOTIFS + m] +
            this.W[(yU + x) * NUM_MOTIFS + m];
          const diag =
            this.W[(yU + xL) * NUM_MOTIFS + m] +
            this.W[(yU + xR) * NUM_MOTIFS + m] +
            this.W[(yD + xL) * NUM_MOTIFS + m] +
            this.W[(yD + xR) * NUM_MOTIFS + m];
          const lap9 = ((4 * card + diag) * invScale - 20 * c) / 6;

          // Double-well derivative: b * c * (1 - c) * (1 - 2c), plus soft packing wall above c > 1
          const bulk = cfg.bulkB * c * (1 - c) * (1 - 2 * c) + (c > 1 ? 2 * cfg.bulkB * (c - 1) : 0);
          this.mu[i] = bulk + cfg.chi * cOther - cfg.kappa * lap9;
        }
      }

      // 2b. Compute conservative integer fluxes across every horizontal (East) & vertical (South) edge
      for (let y = 0; y < H; y++) {
        const y0 = y * W;
        const yD = (y + 1 < H ? y + 1 : 0) * W;
        for (let x = 0; x < W; x++) {
          const xR = x + 1 < W ? x + 1 : 0;
          const i = y0 + x;
          const iE = y0 + xR;
          const iS = yD + x;

          // East edge (i <-> iE)
          {
            const r = hash32(seed, step, i, 100 + m * 2);
            const noise = cfg.noiseAmp > 0 ? (((r >>> 16) / 65536) - 0.5) * cfg.noiseAmp : 0;
            const diffTerm = cfg.diffW * (this.W[i * NUM_MOTIFS + m] - this.W[iE * NUM_MOTIFS + m]);
            const rawJ = cfg.mobility * cfg.scale * (this.mu[i] - this.mu[iE]) + diffTerm + noise;
            let j = roundStochastic(rawJ, r);
            // Clamp to at most 1/4 of donor's mass so 4 edges never drive W negative
            const maxOutI = this.W[i * NUM_MOTIFS + m] >> 2;
            const maxOutE = this.W[iE * NUM_MOTIFS + m] >> 2;
            if (j > maxOutI) j = maxOutI;
            if (j < -maxOutE) j = -maxOutE;
            if (j !== 0) {
              this.deltaW[i * NUM_MOTIFS + m] -= j;
              this.deltaW[iE * NUM_MOTIFS + m] += j;
              if (trackGenetics) {
                if (j > 0) recordInflow(iE, i, j, 150 + m * 4);
                else recordInflow(i, iE, -j, 151 + m * 4);
              }
            }
          }

          // South edge (i <-> iS)
          {
            const r = hash32(seed, step, i, 101 + m * 2);
            const noise = cfg.noiseAmp > 0 ? (((r >>> 16) / 65536) - 0.5) * cfg.noiseAmp : 0;
            const diffTerm = cfg.diffW * (this.W[i * NUM_MOTIFS + m] - this.W[iS * NUM_MOTIFS + m]);
            const rawJ = cfg.mobility * cfg.scale * (this.mu[i] - this.mu[iS]) + diffTerm + noise;
            let j = roundStochastic(rawJ, r);
            const maxOutI = this.W[i * NUM_MOTIFS + m] >> 2;
            const maxOutS = this.W[iS * NUM_MOTIFS + m] >> 2;
            if (j > maxOutI) j = maxOutI;
            if (j < -maxOutS) j = -maxOutS;
            if (j !== 0) {
              this.deltaW[i * NUM_MOTIFS + m] -= j;
              this.deltaW[iS * NUM_MOTIFS + m] += j;
              if (trackGenetics) {
                if (j > 0) recordInflow(iS, i, j, 152 + m * 4);
                else recordInflow(i, iS, -j, 153 + m * 4);
              }
            }
          }
        }
      }
    }
    for (let idx = 0; idx < this.W.length; idx++) {
      this.W[idx] += this.deltaW[idx];
    }

    // 3. Conserved isotropic diffusion of soluble F and A
    this.deltaF.fill(0);
    this.deltaA.fill(0);
    for (let y = 0; y < H; y++) {
      const yU = (y > 0 ? y - 1 : H - 1) * W;
      const y0 = y * W;
      const yD = (y + 1 < H ? y + 1 : 0) * W;
      for (let x = 0; x < W; x++) {
        const xL = x > 0 ? x - 1 : W - 1;
        const xR = x + 1 < W ? x + 1 : 0;
        const i = y0 + x;
        const nbs = [y0 + xR, y0 + xL, yD + x, yU + x];

        const f = this.F[i];
        if (f > 0 && cfg.diffF > 0) {
          const r = hash32(seed, step, i, 200);
          const out = Math.min(f, roundStochastic(f * cfg.diffF, r));
          if (out > 0) {
            this.deltaF[i] -= out;
            const q = out >> 2;
            const rem = out & 3;
            if (q > 0) {
              this.deltaF[nbs[0]] += q; this.deltaF[nbs[1]] += q;
              this.deltaF[nbs[2]] += q; this.deltaF[nbs[3]] += q;
            }
            const d0 = (r >>> 16) & 3;
            for (let k = 0; k < rem; k++) this.deltaF[nbs[(d0 + k) & 3]] += 1;
          }
        }

        const a = this.A[i];
        if (a > 0 && cfg.diffA > 0) {
          const r = hash32(seed, step, i, 201);
          const out = Math.min(a, roundStochastic(a * cfg.diffA, r));
          if (out > 0) {
            this.deltaA[i] -= out;
            const q = out >> 2;
            const rem = out & 3;
            if (q > 0) {
              this.deltaA[nbs[0]] += q; this.deltaA[nbs[1]] += q;
              this.deltaA[nbs[2]] += q; this.deltaA[nbs[3]] += q;
            }
            const d0 = (r >>> 16) & 3;
            for (let k = 0; k < rem; k++) this.deltaA[nbs[(d0 + k) & 3]] += 1;
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      this.F[i] += this.deltaF[i];
      this.A[i] += this.deltaA[i];
    }

    // 4. Phase B1.3: Heritable lysin advection/mutation, conserved motif isomerization, and secreted lysin
    if (trackGenetics) {
      const coreMinInt = Math.round(cfg.lyseCoreMin * cfg.scale);

      // Identify dense core tiles so peaceful (-1) and armed (0..5) alleles advect symmetrically
      for (let i = 0; i < N; i++) {
        const wBase = i * NUM_MOTIFS;
        let wSum = 0;
        for (let m = 0; m < NUM_MOTIFS; m++) wSum += this.W[wBase + m];
        this.isCore[i] = wSum >= coreMinInt ? 1 : 0;
      }

      // 4a. Advect lyseTarget along W mass inflow + mutate
      for (let i = 0; i < N; i++) {
        if (!this.isCore[i]) {
          this.lyseNext[i] = -1;
          continue;
        }

        let gene = this.lyseTarget[i];
        const src = this.maxInflowSrc[i];
        if (src >= 0 && this.isCore[src]) {
          // Newly grown rim tile inherits immediately; existing core tile mixes gently & symmetrically along mass flow
          if (!this.prevCore[i] || (hash32(seed, step, i, 300) & 0xff) < 8) {
            gene = this.lyseTarget[src];
          }
        }
        this.lyseNext[i] = gene;
      }
      if (cfg.mutLyse > 0) {
        // Order-invariant overlap resolution via hashed event priority (highest prio wins)
        const lyseEvents: { i: number; newGene: number; prio: number }[] = [];
        for (let i = 0; i < N; i++) {
          if (!this.isCore[i]) continue;
          const rM = hash32(seed, step, i, 301);
          if ((rM >>> 0) / 4294967296 >= cfg.mutLyse) continue;
          const rPick = hash32(seed, step, i, 302);
          // 50% loss-of-function (disarm -> -1), 50% gain-of-function (specific target 0..5)
          const newGene = (rPick & 1) === 0 ? -1 : (rPick >>> 1) % NUM_MOTIFS;
          lyseEvents.push({ i, newGene, prio: hash32(seed, step, i, 303) >>> 0 });
        }
        if (lyseEvents.length > 1) {
          lyseEvents.sort((a, b) => a.prio - b.prio || a.i - b.i);
        }
        for (const ev of lyseEvents) {
          const cx = ev.i % W;
          const cy = (ev.i / W) | 0;
          for (let dy = -2; dy <= 2; dy++) {
            const yy = ((cy + dy + H) % H) * W;
            for (let dx = -2; dx <= 2; dx++) {
              if (dx * dx + dy * dy > 4) continue;
              const j = yy + ((cx + dx + W) % W);
              if (this.isCore[j]) this.lyseNext[j] = ev.newGene;
            }
          }
        }
      }
      this.lyseTarget.set(this.lyseNext);
      this.prevCore.set(this.isCore);

      // 4b. Conserved motif isomerization (exact 1-for-1 W_m -> W_m' over a local r=3 super-critical patch)
      //     Proposals are snapshotted before mutation and resolved by hashed priority without cascades.
      if (cfg.mutMotif > 0) {
        const motifEvents: { i: number; domM: number; newM: number; prio: number }[] = [];
        for (let i = 0; i < N; i++) {
          const rI = hash32(seed, step, i, 310);
          if ((rI >>> 0) / 4294967296 >= cfg.mutMotif) continue;
          const wBase = i * NUM_MOTIFS;
          let domM = -1;
          let domW = 0;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            if (this.W[wBase + m] > domW) { domW = this.W[wBase + m]; domM = m; }
          }
          if (domM < 0 || domW < coreMinInt) continue;
          const newM = (domM + 1 + (hash32(seed, step, i, 311) % (NUM_MOTIFS - 1))) % NUM_MOTIFS;
          motifEvents.push({ i, domM, newM, prio: hash32(seed, step, i, 312) >>> 0 });
        }
        if (motifEvents.length > 0) {
          if (motifEvents.length > 1) {
            motifEvents.sort((a, b) => b.prio - a.prio || b.i - a.i);
          }
          const claimed = new Set<number>();
          for (const ev of motifEvents) {
            const cx = ev.i % W;
            const cy = (ev.i / W) | 0;
            for (let dy = -3; dy <= 3; dy++) {
              const yy = ((cy + dy + H) % H) * W;
              for (let dx = -3; dx <= 3; dx++) {
                if (dx * dx + dy * dy > 9) continue;
                const j = yy + ((cx + dx + W) % W);
                if (claimed.has(j)) continue;
                claimed.add(j);
                const jb = j * NUM_MOTIFS;
                const wm = this.W[jb + ev.domM];
                if (wm > 0) {
                  this.W[jb + ev.domM] -= wm;
                  this.W[jb + ev.newM] += wm;
                }
              }
            }
          }
        }
      }

      // 4c. Phase B1.3: Short-range secreted lysin (bacteriocin) field + local conserved hydrolysis (W_m -> A)
      if (cfg.kLyse > 0) {
        // 4c.1. Upkeep + secretion from dense droplet tiles carrying an active lysin
        const foreignShare = cfg.secreteL / (NUM_MOTIFS - 1);
        for (let i = 0; i < N; i++) {
          const target = this.lyseTarget[i];
          if (target < 0) continue;

          const wBase = i * NUM_MOTIFS;
          let wSum = 0;
          let domM = -1;
          let domW = 0;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            const wm = this.W[wBase + m];
            wSum += wm;
            if (wm > domW) { domW = wm; domM = m; }
          }
          if (wSum < coreMinInt) continue;

          // Upkeep cost of carrying an active lysin (W -> A, exact conservation)
          if (cfg.lyseUpkeep > 0) {
            for (let m = 0; m < NUM_MOTIFS; m++) {
              const wm = this.W[wBase + m];
              if (wm > 0) {
                const u = Math.min(wm, roundStochastic(wm * cfg.lyseUpkeep, hash32(seed, step, i, 330 + m)));
                this.W[wBase + m] -= u;
                this.A[i] += u;
              }
            }
          }

          // Secrete lysin into water:
          // - LYSE: specialist secretes into its own target motif channel (self-toxic if target === domM).
          // - NEUTRAL_LYSE: motif-blind control gated strictly to foreign motifs (m !== domM) so it never
          //   self-cleaves or self-fuels, while attacking all foreign motifs equally across the moat.
          if (cfg.secreteL > 0) {
            if (cfg.neutralLyse) {
              for (let m = 0; m < NUM_MOTIFS; m++) {
                if (m !== domM) this.L[wBase + m] += foreignShare;
              }
            } else {
              this.L[wBase + target] += cfg.secreteL;
            }
          }
        }

        // 4c.2. Isotropic 4-neighbor diffusion + decay of secreted lysin in water (2-3 tile reach)
        const keep = 1 - cfg.decayL;
        const diffL = cfg.diffL;
        this.LNext.fill(0);
        for (let m = 0; m < NUM_MOTIFS; m++) {
          let hasL = false;
          for (let i = 0; i < N; i++) {
            if (this.L[i * NUM_MOTIFS + m] > 0) { hasL = true; break; }
          }
          if (!hasL) continue;

          for (let y = 0; y < H; y++) {
            const yU = (y > 0 ? y - 1 : H - 1) * W;
            const y0 = y * W;
            const yD = (y + 1 < H ? y + 1 : 0) * W;
            for (let x = 0; x < W; x++) {
              const xL = x > 0 ? x - 1 : W - 1;
              const xR = x + 1 < W ? x + 1 : 0;
              const i = y0 + x;
              const c = this.L[i * NUM_MOTIFS + m];
              const avgNb =
                0.25 *
                (this.L[(y0 + xR) * NUM_MOTIFS + m] +
                  this.L[(y0 + xL) * NUM_MOTIFS + m] +
                  this.L[(yD + x) * NUM_MOTIFS + m] +
                  this.L[(yU + x) * NUM_MOTIFS + m]);
              let next = (c + diffL * (avgNb - c)) * keep;
              if (next < 1e-6) next = 0;
              this.LNext[i * NUM_MOTIFS + m] = next;
            }
          }
        }
        this.L.set(this.LNext);

        // 4c.3. Local conserved dissipative lysis (W_m -> 75% F + 25% A catalyzed by L_m; zero tile-order bias).
        // Thermodynamically downhill (25% lost to low-energy waste A, 75% recovered as local oligomeric fuel F
        // that diffuses across the 2-tile moat to feed the adjacent predator).
        for (let i = 0; i < N; i++) {
          const wBase = i * NUM_MOTIFS;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            const wm = this.W[wBase + m];
            if (wm === 0) continue;
            const lm = this.L[wBase + m];
            if (lm <= 0) continue;
            const rate = Math.min(0.95, cfg.kLyse * lm);
            const d = Math.min(wm, roundStochastic(wm * rate, hash32(seed, step, i, 360 + m)));
            if (d > 0) {
              const dA = Math.min(d, roundStochastic(d * 0.25, hash32(seed, step, i, 370 + m)));
              const dF = d - dA;
              this.W[wBase + m] -= d;
              this.F[i] += dF;
              this.A[i] += dA;
              this.lyseMassCleaved += d;
            }
          }
        }
      }
    }

    // 5. Phase B1.4: Conserved obligate phage / parasite field P[tile * NUM_MOTIFS + m]
    //    Replicates ONLY on matching host motif W_m (true Kill-the-Winner negative frequency dependence),
    //    diffuses as exact integer virion packets in water, and decays back to soluble waste A when hostless.
    let runPhage = cfg.kInfect > 0 || cfg.mutPhage > 0;
    if (!runPhage) {
      for (let idx = 0; idx < this.P.length; idx++) {
        if (this.P[idx] > 0) { runPhage = true; break; }
      }
    }
    if (runPhage) {
      // 5a. Local conserved infection & lytic burst: W_m -> phageYield * P + (1 - phageYield) * A
      if (cfg.kInfect > 0) {
        for (let i = 0; i < N; i++) {
          const base = i * NUM_MOTIFS;
          if (cfg.neutralPhage) {
            let pTot = 0;
            for (let m = 0; m < NUM_MOTIFS; m++) pTot += this.P[base + m];
            if (pTot > 0) {
              const rate = Math.min(0.95, cfg.kInfect * (pTot * invScale));
              for (let m = 0; m < NUM_MOTIFS; m++) {
                const wm = this.W[base + m];
                if (wm === 0) continue;
                const d = Math.min(wm, roundStochastic(wm * rate, hash32(seed, step, i, 400 + m)));
                if (d > 0) {
                  const dP = Math.min(d, roundStochastic(d * cfg.phageYield, hash32(seed, step, i, 410 + m)));
                  const dA = d - dP;
                  this.W[base + m] -= d;
                  this.P[base + 0] += dP;
                  this.A[i] += dA;
                  this.phageMassCleaved += d;
                }
              }
            }
          } else {
            for (let m = 0; m < NUM_MOTIFS; m++) {
              const wm = this.W[base + m];
              if (wm === 0) continue;
              const pm = this.P[base + m];
              if (pm === 0) continue;
              const rate = Math.min(0.95, cfg.kInfect * (pm * invScale));
              const d = Math.min(wm, roundStochastic(wm * rate, hash32(seed, step, i, 400 + m)));
              if (d > 0) {
                const dP = Math.min(d, roundStochastic(d * cfg.phageYield, hash32(seed, step, i, 410 + m)));
                const dA = d - dP;
                this.W[base + m] -= d;
                this.P[base + m] += dP;
                this.A[i] += dA;
                this.phageMassCleaved += d;
              }
            }
          }
        }
      }

      // 5b. Conserved phage decay in water: P_m -> A
      if (cfg.kDecayP > 0) {
        for (let i = 0; i < N; i++) {
          const base = i * NUM_MOTIFS;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            const pm = this.P[base + m];
            if (pm === 0) continue;
            const dec = Math.min(pm, roundStochastic(pm * cfg.kDecayP, hash32(seed, step, i, 420 + m)));
            if (dec > 0) {
              this.P[base + m] -= dec;
              this.A[i] += dec;
            }
          }
        }
      }

      // 5c. Rare conserved prophage / host-range emergence: tiny 5-unit packet W_dom -> P_target
      if (cfg.mutPhage > 0) {
        for (let i = 0; i < N; i++) {
          const rP = hash32(seed, step, i, 430);
          if ((rP >>> 0) / 4294967296 >= cfg.mutPhage) continue;
          const base = i * NUM_MOTIFS;
          let domM = -1;
          let domW = 0;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            if (this.W[base + m] > domW) { domW = this.W[base + m]; domM = m; }
          }
          if (domM < 0 || domW < 10) continue;
          const targetM = cfg.neutralPhage ? 0 : hash32(seed, step, i, 431) % NUM_MOTIFS;
          const q = Math.min(domW, 5);
          this.W[base + domM] -= q;
          this.P[base + targetM] += q;
        }
      }

      // 5d. Exact integer isotropic 4-neighbor diffusion of P in water
      if (cfg.diffP > 0) {
        this.deltaP.fill(0);
        for (let m = 0; m < NUM_MOTIFS; m++) {
          let hasP = false;
          for (let i = 0; i < N; i++) {
            if (this.P[i * NUM_MOTIFS + m] > 0) { hasP = true; break; }
          }
          if (!hasP) continue;
          for (let y = 0; y < H; y++) {
            const yU = (y > 0 ? y - 1 : H - 1) * W;
            const y0 = y * W;
            const yD = (y + 1 < H ? y + 1 : 0) * W;
            for (let x = 0; x < W; x++) {
              const xL = x > 0 ? x - 1 : W - 1;
              const xR = x + 1 < W ? x + 1 : 0;
              const i = y0 + x;
              const p = this.P[i * NUM_MOTIFS + m];
              if (p === 0) continue;
              const r = hash32(seed, step, i, 440 + m);
              const out = Math.min(p, roundStochastic(p * cfg.diffP, r));
              if (out > 0) {
                this.deltaP[i * NUM_MOTIFS + m] -= out;
                const q = out >> 2;
                const rem = out & 3;
                const nbs = [y0 + xR, y0 + xL, yD + x, yU + x];
                if (q > 0) {
                  this.deltaP[nbs[0] * NUM_MOTIFS + m] += q;
                  this.deltaP[nbs[1] * NUM_MOTIFS + m] += q;
                  this.deltaP[nbs[2] * NUM_MOTIFS + m] += q;
                  this.deltaP[nbs[3] * NUM_MOTIFS + m] += q;
                }
                // Isotropic remainder distribution across all 4 (rem=1,3) or 6 (rem=2) unordered neighbor subsets
                if (rem === 1) {
                  this.deltaP[nbs[(r >>> 16) & 3] * NUM_MOTIFS + m] += 1;
                } else if (rem === 2) {
                  const pairIdx = (r >>> 16) % 6;
                  const a = pairIdx < 3 ? 0 : pairIdx < 5 ? 1 : 2;
                  const b = pairIdx < 3 ? pairIdx + 1 : pairIdx < 5 ? pairIdx - 1 : 3;
                  this.deltaP[nbs[a] * NUM_MOTIFS + m] += 1;
                  this.deltaP[nbs[b] * NUM_MOTIFS + m] += 1;
                } else if (rem === 3) {
                  const skip = (r >>> 16) & 3;
                  for (let k = 0; k < 4; k++) {
                    if (k !== skip) this.deltaP[nbs[k] * NUM_MOTIFS + m] += 1;
                  }
                }
              }
            }
          }
        }
        for (let idx = 0; idx < this.P.length; idx++) {
          this.P[idx] += this.deltaP[idx];
        }
      }
    }
  }

  /** Pure observer: total conserved phage matter per target motif. */
  phageTotals(): number[] {
    const totals = new Array<number>(NUM_MOTIFS).fill(0);
    for (let i = 0; i < this.nTiles; i++) {
      const base = i * NUM_MOTIFS;
      for (let m = 0; m < NUM_MOTIFS; m++) {
        totals[m] += this.P[base + m];
      }
    }
    return totals;
  }

  /** Pure observer: motif mass shares, dominant motif, Hill D1, and lysin carrier counts. */
  motifStats(): {
    shares: number[];
    dominant: number;
    dominantShare: number;
    hillD1: number;
    totalW: number;
    lyserCounts: number[];
  } {
    const totals = new Array<number>(NUM_MOTIFS).fill(0);
    let totalW = 0;
    for (let i = 0; i < this.nTiles; i++) {
      const base = i * NUM_MOTIFS;
      for (let m = 0; m < NUM_MOTIFS; m++) {
        totals[m] += this.W[base + m];
        totalW += this.W[base + m];
      }
    }
    const shares = totals.map((v) => (totalW > 0 ? v / totalW : 0));
    let dominant = -1;
    let dominantShare = 0;
    let H = 0;
    for (let m = 0; m < NUM_MOTIFS; m++) {
      if (shares[m] > dominantShare) { dominantShare = shares[m]; dominant = m; }
      if (shares[m] > 0) H -= shares[m] * Math.log(shares[m]);
    }
    const lyserCounts = new Array<number>(NUM_MOTIFS).fill(0);
    for (let i = 0; i < this.nTiles; i++) {
      const t = this.lyseTarget[i];
      if (t >= 0) lyserCounts[t]++;
    }
    return { shares, dominant, dominantShare, hillD1: totalW > 0 ? Math.exp(H) : 0, totalW, lyserCounts };
  }
}
