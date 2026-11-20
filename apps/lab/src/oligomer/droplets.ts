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

  // Phase B1.2: Heritable motif-specific lysis & conserved motif switching (off by default: kLyse = 0)
  readonly kLyse: number; // contact-digestion rate (W_target on neighbor -> F at attacker)
  readonly neutralLyse: boolean; // control: motif-blind lysis at flat rate
  readonly lyseCoreMin: number; // min droplet density (fraction of scale) to carry/express a lysin
  readonly mutLyse: number; // per-step prob a core tile mutates its lysin target
  readonly mutMotif: number; // per-step prob a core tile isomerizes a packet of W_m -> W_m' (exact conservation)
  readonly lyseUpkeep: number; // tiny extra W degradation for carrying an active lysin (prevents free-lunch weapons)
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

  // Exact integer matter pools (conserved: sum(A + F + sum_m W_m) === initTotalMatter)
  readonly A: Int32Array; // soluble waste / monomers
  readonly F: Int32Array; // soluble high-energy feedstock
  readonly W: Int32Array; // [tile * NUM_MOTIFS + m] droplet-forming oligomers
  // Heritable lysin target per tile (-1 = none, 0..5 = target motif); advects with W inflow
  readonly lyseTarget: Int8Array;

  // Scratch buffers (never serialized)
  private readonly mu: Float64Array;
  private readonly deltaA: Int32Array;
  private readonly deltaF: Int32Array;
  private readonly deltaW: Int32Array;
  private readonly maxInflow: Int32Array;
  private readonly maxInflowSrc: Int32Array;
  private readonly maxInflowTie: Int32Array;
  private readonly lyseNext: Int8Array;

  // Pure observer counters
  lyseMassCleaved = 0;

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
    const nTiles = cfg.width * cfg.height;
    if (nTiles * cfg.initMatterPerTile > 0x3fffffff) {
      throw new Error(`Total world matter (${nTiles * cfg.initMatterPerTile}) exceeds Int32-safe bound (1073741823)`);
    }
    this.cfg = cfg;
    this.nTiles = nTiles;
    this.A = new Int32Array(this.nTiles);
    this.F = new Int32Array(this.nTiles);
    this.W = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.lyseTarget = new Int8Array(this.nTiles).fill(-1);
    this.mu = new Float64Array(this.nTiles);
    this.deltaA = new Int32Array(this.nTiles);
    this.deltaF = new Int32Array(this.nTiles);
    this.deltaW = new Int32Array(this.nTiles * NUM_MOTIFS);
    this.maxInflow = new Int32Array(this.nTiles);
    this.maxInflowSrc = new Int32Array(this.nTiles).fill(-1);
    this.maxInflowTie = new Int32Array(this.nTiles);
    this.lyseNext = new Int8Array(this.nTiles).fill(-1);

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
      if (lyseTarget >= 0) this.lyseTarget[i] = lyseTarget;
    }
  }

  /** Exact integer total matter across A, F, and all W motifs. */
  totalMatter(): number {
    let total = 0;
    for (let i = 0; i < this.nTiles; i++) {
      total += this.A[i] + this.F[i];
    }
    for (let i = 0; i < this.W.length; i++) {
      total += this.W[i];
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

    // 4. Phase B1.2: Heritable lysin advection/mutation, conserved motif isomerization, and contact lysis
    if (trackGenetics) {
      const coreMinInt = Math.round(cfg.lyseCoreMin * cfg.scale);

      // 4a. Advect lyseTarget along W mass inflow + mutate
      for (let i = 0; i < N; i++) {
        const wBase = i * NUM_MOTIFS;
        let wSum = 0;
        for (let m = 0; m < NUM_MOTIFS; m++) wSum += this.W[wBase + m];

        if (wSum < coreMinInt) {
          this.lyseNext[i] = -1;
          continue;
        }

        let gene = this.lyseTarget[i];
        const src = this.maxInflowSrc[i];
        if (src >= 0 && this.lyseTarget[src] >= 0) {
          // Newly grown tile inherits immediately; existing core tile mixes gently along mass flow
          if (gene < 0 || (hash32(seed, step, i, 300) & 0xff) < 32) {
            gene = this.lyseTarget[src];
          }
        }
        if (cfg.mutLyse > 0) {
          const rM = hash32(seed, step, i, 301);
          if ((rM & 0xffff) / 65536 < cfg.mutLyse) {
            const pick = (rM >>> 16) % (NUM_MOTIFS + 1);
            gene = pick === NUM_MOTIFS ? -1 : pick;
          }
        }
        this.lyseNext[i] = gene;
      }
      this.lyseTarget.set(this.lyseNext);

      // 4b. Conserved motif isomerization (exact 1-for-1 W_m -> W_m', lets rare motifs emerge)
      if (cfg.mutMotif > 0) {
        for (let i = 0; i < N; i++) {
          const rI = hash32(seed, step, i, 310);
          if ((rI & 0xffff) / 65536 >= cfg.mutMotif) continue;
          const wBase = i * NUM_MOTIFS;
          let domM = -1;
          let domW = 0;
          for (let m = 0; m < NUM_MOTIFS; m++) {
            if (this.W[wBase + m] > domW) { domW = this.W[wBase + m]; domM = m; }
          }
          if (domM < 0 || domW < coreMinInt) continue;
          const newM = (domM + 1 + ((rI >>> 16) % (NUM_MOTIFS - 1))) % NUM_MOTIFS;
          // Isomerize a nucleation packet (exact conservation)
          const packet = Math.min(domW, Math.round(0.5 * cfg.scale));
          this.W[wBase + domM] -= packet;
          this.W[wBase + newM] += packet;
        }
      }

      // 4c. Self-toxic, motif-specific contact lysis (W_target on neighbor -> F at attacker; exact conservation)
      if (cfg.kLyse > 0) {
        const start = hash32(seed, step, 0, 320) % N;
        const gcd = (a: number, b: number): number => { while (b) { const t = a % b; a = b; b = t; } return a; };
        // Sample coprime stride uniformly by rejection (avoids increment-bias toward certain units mod N)
        let stride = 1;
        for (let attempt = 1; attempt <= 64; attempt++) {
          const cand = hash32(seed, step, attempt, 320) % N;
          if (cand > 0 && gcd(cand, N) === 1) { stride = cand; break; }
        }
        for (let idx = 0; idx < N; idx++) {
          const i = (start + idx * stride) % N;
          const target = this.lyseTarget[i];
          if (target < 0) continue;

          const wBase = i * NUM_MOTIFS;
          let wSum = 0;
          for (let m = 0; m < NUM_MOTIFS; m++) wSum += this.W[wBase + m];
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

          // Self-toxicity (if not neutralLyse): cleaves own matching motif W_target -> A
          if (!cfg.neutralLyse) {
            const ownW = this.W[wBase + target];
            if (ownW > 0) {
              const dSelf = Math.min(ownW, roundStochastic(ownW * cfg.kLyse * 0.5, hash32(seed, step, i, 340)));
              this.W[wBase + target] -= dSelf;
              this.A[i] += dSelf;
            }
          }

          // Contact digestion on uniform eligible 4-neighbor (W_target -> F[attacker])
          const x = i % W;
          const y = (i / W) | 0;
          const xL = x > 0 ? x - 1 : W - 1;
          const xR = x + 1 < W ? x + 1 : 0;
          const yU = y > 0 ? y - 1 : H - 1;
          const yD = y + 1 < H ? y + 1 : 0;
          const nbs = [y * W + xR, y * W + xL, yD * W + x, yU * W + x];
          const elig: number[] = [];
          for (let d = 0; d < 4; d++) {
            const nb = nbs[d];
            const nbBase = nb * NUM_MOTIFS;
            if (cfg.neutralLyse) {
              for (let m = 0; m < NUM_MOTIFS; m++) {
                if (this.W[nbBase + m] > 0) { elig.push(nb); break; }
              }
            } else if (this.W[nbBase + target] > 0) {
              elig.push(nb);
            }
          }
          if (elig.length > 0) {
            const nb = elig[hash32(seed, step, i, 350) % elig.length];
            const nbBase = nb * NUM_MOTIFS;
            if (cfg.neutralLyse) {
              for (let m = 0; m < NUM_MOTIFS; m++) {
                const wm = this.W[nbBase + m];
                if (wm > 0) {
                  const d = Math.min(wm, roundStochastic(wm * cfg.kLyse, hash32(seed, step, i, 360 + m)));
                  this.W[nbBase + m] -= d;
                  this.F[i] += d;
                  this.lyseMassCleaved += d;
                }
              }
            } else {
              const wm = this.W[nbBase + target];
              if (wm > 0) {
                const d = Math.min(wm, roundStochastic(wm * cfg.kLyse, hash32(seed, step, i, 360)));
                this.W[nbBase + target] -= d;
                this.F[i] += d;
                this.lyseMassCleaved += d;
              }
            }
          }
        }
      }
    }
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
