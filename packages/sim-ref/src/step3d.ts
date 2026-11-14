// CPU reference for the slab (rung 1b): one tileW x tileH x tileD tile, x and y wrap, z is closed.
// This file is the executable specification of the slab rules; docs/3d-rung1b-step-spec.md is its prose and
// the WGSL twin in @bl/sim-gpu (shaders3d.ts) must match it bit for bit. 2D step.ts is not edited; the
// primitives that are shared (growth, w1d, mulShareD, cat, mutationThreshold) are imported from it.
//
// One step = affinity -> flow -> transport -> light -> react -> tick, each pass reading only what the
// previous passes finished (spec section 3).

import {
  B1_OFF3,
  B2_OFF3,
  CELL_CHANNELS,
  CH,
  FLUX_COUNT,
  FLUX_NAMES,
  G,
  LEDGER_MAX,
  MAX_STEP,
  MOT_ZERO3,
  NN_BYTES3,
  NN_H3,
  NN_I3,
  NN_O3,
  OUT3,
  POOL_MAX3,
  RND3,
  ROLE_WORDS,
  U32_MAX,
  W1_OFF3,
  W2_OFF3,
  addu,
  buildKernel3,
  cellBase,
  cellCount,
  clampi,
  divi,
  divu,
  draw,
  encodeGenome3,
  generalistGenome3,
  genomeChannels,
  isSlab,
  lightModeId,
  mulFrac,
  muli,
  mulShr,
  mulu,
  motilityTerm,
  packMot3,
  subu,
  validateState3,
  worldH,
  worldW,
  type FluxName,
  type Kernel3,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { cat, growth, mulShareD, mutationThreshold, w1d, type MutationEvent, type StepResult } from "./step.ts";

const FX = Object.fromEntries(FLUX_NAMES.map((k, i) => [k, i])) as Record<FluxName, number>;
const MCAP = 16383;
/** CPU `nb3` returns this for a neighbour outside [0, D) in z; WGSL's `OUTSIDE` is 0xffffffff. Never a valid index. */
export const OUTSIDE = -1;
const GENOME_CH3 = genomeChannels({ tileD: 1 });

/** Smoothing weights of the Sobel stencil: s(-1) = 1, s(0) = 2, s(+1) = 1. */
const SM = [1, 2, 1] as const;

/**
 * Three-axis nested share of a species quantum: x first, then y, then z, each `floor(q * w / d1)` in the split form
 * of `mulShareD`. The nested floors are not the floor of the product; that is the rule.
 */
export function share3(q: number, wx: number, wy: number, wz: number, d1: number): number {
  return mulShareD(mulShareD(mulShareD(q, wx, d1), wy, d1), wz, d1);
}

/** The portion of `q` that goes to direction `d` when the rotation is `rot`: the six portions of one cell sum to `q`. */
export function portion6(q: number, d: number, rot: number): number {
  return divu(q, 6) + ((d + rot) % 6 < q % 6 ? 1 : 0);
}

/** Rotation of a sender's diffusion portions (spec 7.3): a function of the sender's base alone. */
export function diffRot6(baseS: number): number {
  return draw(baseS, RND3.DIFF_ROT) % 6;
}

/** Quanta a sender sends in direction `d` (0..5 = +x -x +y -y +z -z): a sixth-portion scaled by 4*De/1024. */
export function diffOut6(q: number, d: number, De: number, baseS: number, sp: number): number {
  return mulFrac(portion6(q, d, diffRot6(baseS)), De * 4, 10, draw(baseS, RND3.DIFF + d * 3 + sp));
}

/** 11 -> 8 -> 9 controller: int8 weights `wb` (NN_BYTES3), sensors `x` (NN_I3), hidden `h` (ReLU, saturating at 127), outputs `o` (+-127). */
export function controllerForward3(wb: Int8Array, x: Int32Array, h: Int32Array, o: Int32Array): void {
  for (let j = 0; j < NN_H3; j++) {
    let acc = wb[B1_OFF3 + j] * 128;
    for (let k = 0; k < NN_I3; k++) acc += wb[W1_OFF3 + k * NN_H3 + j] * x[k];
    h[j] = clampi(divi(acc, 128), 0, 127);
  }
  for (let k = 0; k < NN_O3; k++) {
    let acc = wb[B2_OFF3 + k] * 128;
    for (let j = 0; j < NN_H3; j++) acc += wb[W2_OFF3 + j * NN_O3 + k] * h[j];
    o[k] = clampi(divi(acc, 128), -127, 127);
  }
}

/** Slab mutation: 180 slots (177 weight bytes, mu, sigma, motility gain). No ring branch and no gene flip. */
export function mutateInPlace3(genome: Uint32Array, n: number, i: number, c: WorldConfig, which: number, deltaRnd: number): void {
  const slot = which % (NN_BYTES3 + 3);
  let delta = (deltaRnd % (2 * c.mutStep + 1)) - c.mutStep;
  if (delta === 0) delta = 1;
  if (slot < NN_BYTES3) {
    const wi = (G.W0 + (slot >> 2)) * n + i;
    const sh = (slot & 3) * 8;
    const byte = (genome[wi] >>> sh) & 0xff;
    const v = clampi((byte > 127 ? byte - 256 : byte) + delta, -127, 127);
    genome[wi] = ((genome[wi] & ~(0xff << sh)) | ((v & 0xff) << sh)) >>> 0;
  } else if (slot === NN_BYTES3) {
    const p0 = genome[G.PARAM0 * n + i];
    const mu = clampi((p0 & 0xffff) + delta, 16, 4095);
    genome[G.PARAM0 * n + i] = ((p0 & 0xffff0000) | mu) >>> 0;
  } else if (slot === NN_BYTES3 + 1) {
    const p0 = genome[G.PARAM0 * n + i];
    const sd = delta >> 2 === 0 ? (delta > 0 ? 1 : -1) : delta >> 2;
    const sigma = clampi((p0 >>> 16) + sd, 2, 1023);
    genome[G.PARAM0 * n + i] = ((p0 & 0xffff) | (sigma << 16)) >>> 0;
  } else {
    const p1 = genome[G.PARAM1 * n + i];
    const gain = clampi((p1 & 0xff) + delta, 0, 255);
    genome[G.PARAM1 * n + i] = ((p1 & 0xffffff00) | gain) >>> 0;
  }
}

export class RefSim3 {
  readonly cfg: WorldConfig;
  readonly n: number;
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly WH: number;
  readonly kernel: Kernel3;
  state: WorldState;
  private cellsB: Uint32Array;
  private genomeB: Uint32Array;
  private U: Int32Array;
  private disp: Uint32Array;
  private Lbuf: Uint32Array;
  /** Capped mass min(B + P, 16383) of the state the current pass reads (rebuilt by affinity and flow). */
  private Mb: Uint32Array;
  private readonly sobelBuf = new Int32Array(27);
  private readonly massDiv: number;
  private readonly hw: number;
  private readonly d1: number;
  /** Reference genome expressed by every cell in neutral runs. */
  private readonly refWords: Uint32Array | null;
  /** Diagnostic: last step's per-cell reaction amounts (see ROLE_WORDS). */
  readonly roles: Uint32Array;

  constructor(state: WorldState) {
    if (!isSlab(state.cfg)) throw new Error("RefSim3 runs the slab rules: it needs a slab config (tileD set)");
    const errs = validateState3(state);
    if (errs.length) throw new Error(`invalid state: ${errs.join("; ")}`);
    this.state = state;
    this.cfg = state.cfg;
    this.n = cellCount(this.cfg);
    this.W = worldW(this.cfg);
    this.H = worldH(this.cfg);
    this.D = this.cfg.tileD!;
    this.WH = this.W * this.H;
    this.kernel = buildKernel3(3);
    this.cellsB = new Uint32Array(this.n * CELL_CHANNELS);
    this.genomeB = new Uint32Array(this.n * GENOME_CH3);
    this.U = new Int32Array(this.n);
    this.disp = new Uint32Array(this.n);
    this.Lbuf = new Uint32Array(this.n);
    this.Mb = new Uint32Array(this.n);
    this.massDiv = 8 * this.cfg.massUnit;
    this.hw = 32 + this.cfg.spread;
    this.d1 = 2 * this.hw;
    this.refWords = this.cfg.neutral ? encodeGenome3(generalistGenome3(this.cfg.defaultMu, this.cfg.defaultSigma), 0, 0) : null;
    this.roles = new Uint32Array(this.n * ROLE_WORDS);
  }

  /** Index of the neighbour of (x, y, z) at offset (dx, dy, dz): x and y wrap, `OUTSIDE` when z + dz leaves [0, D). */
  nb3(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
    const zz = z + dz;
    if (zz < 0 || zz >= this.D) return OUTSIDE;
    return (zz * this.H + ((y + dy + this.H) % this.H)) * this.W + ((x + dx + this.W) % this.W);
  }

  /** Light entering the surface at column (x, y) at the pre-increment `step`: RefSim.light for the two modes a slab admits. */
  lightSurface(x: number, y: number, step: number): number {
    const c = this.cfg;
    let L = c.lightBase;
    if (lightModeId(c.lightMode) === 0) L += c.lightAmp;
    else L += divu(mulu(c.lightAmp, y), c.tileH - 1);
    if (c.seasonPeriod > 0) {
      const ph = divu(mulu(step % c.seasonPeriod, 512), c.seasonPeriod);
      const tri = Math.abs(ph - 256);
      L += (c.seasonAmp * tri) >> 8;
    }
    return clampi(L, 0, 255);
  }

  step(): StepResult {
    if (this.state.step >= MAX_STEP) throw new Error(`step limit ${MAX_STEP} reached`);
    this.affinity();
    this.flow();
    this.transport();
    this.lightColumn();
    const r = this.react();
    this.state.step += 1;
    if ([this.state.lightIn, this.state.heatOut, ...this.state.flux].some((v) => v >= LEDGER_MAX))
      throw new Error("ledger total reached 2^63; the run cannot continue exactly");
    return r;
  }

  run(steps: number): MutationEvent[] {
    const ev: MutationEvent[] = [];
    for (let i = 0; i < steps; i++) for (const e of this.step().events) ev.push(e);
    return ev;
  }

  private fillMass(): void {
    const { cells } = this.state;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const m = cells[CH.B * n + i] + cells[CH.P * n + i];
      this.Mb[i] = m > MCAP ? MCAP : m;
    }
  }

  private living(genome: Uint32Array, i: number): boolean {
    return (genome[G.LIN_HI * this.n + i] | genome[G.LIN_LO * this.n + i]) !== 0;
  }

  /** Pass 1 (spec 4): U = growth(K * M; mu, sigma) with mass 0 outside the walls and the full kernel sum as divisor. */
  affinity(): void {
    const { genome } = this.state;
    const { taps, count, sum } = this.kernel;
    const c = this.cfg;
    const { W, H, D, n } = this;
    this.fillMass();
    const Mb = this.Mb;
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (z * H + y) * W + x;
          let mu = c.defaultMu;
          let sigma = c.defaultSigma;
          if (!c.neutral && this.living(genome, i)) {
            const p0 = genome[G.PARAM0 * n + i];
            mu = p0 & 0xffff;
            sigma = p0 >>> 16;
          }
          let conv = 0;
          for (let k = 0; k < count; k++) {
            const j = this.nb3(x, y, z, taps[k * 4], taps[k * 4 + 1], taps[k * 4 + 2]);
            if (j === OUTSIDE) continue;
            conv += taps[k * 4 + 3] * Mb[j];
          }
          const uq = divu(conv, sum);
          let u = divu(mulu(uq, 1024), c.massUnit);
          if (u > 4095) u = 4095;
          mu = mu > 4095 ? 4095 : mu;
          sigma = clampi(sigma, 1, 1023);
          this.U[i] = growth(u, mu, sigma);
        }
      }
    }
  }

  /** 27-point Sobel of field `f` at (x, y, z), x and y wrapped, z clamped (replicate padding at the walls); results are `/4` truncated. */
  private sobel3(f: ArrayLike<number>, x: number, y: number, z: number, out: Int32Array): void {
    const { W, H, D } = this;
    const F = this.sobelBuf; // index ((c + 1) * 3 + (b + 1)) * 3 + (a + 1) for offsets (a, b, c)
    for (let c = -1; c <= 1; c++) {
      const zz = Math.min(Math.max(z + c, 0), D - 1);
      for (let b = -1; b <= 1; b++) {
        const yy = (y + b + H) % H;
        for (let a = -1; a <= 1; a++) F[((c + 1) * 3 + (b + 1)) * 3 + (a + 1)] = f[(zz * H + yy) * W + (x + a + W) % W];
      }
    }
    let gx = 0, gy = 0, gz = 0;
    for (let p = 0; p < 3; p++)
      for (let q = 0; q < 3; q++) {
        gx += SM[q] * SM[p] * (F[(p * 3 + q) * 3 + 2] - F[(p * 3 + q) * 3 + 0]); // p = c, q = b
        gy += SM[q] * SM[p] * (F[(p * 3 + 2) * 3 + q] - F[(p * 3 + 0) * 3 + q]); // p = c, q = a
        gz += SM[q] * SM[p] * (F[(2 * 3 + p) * 3 + q] - F[(0 * 3 + p) * 3 + q]); // p = b, q = a
      }
    out[0] = divi(gx, 4);
    out[1] = divi(gy, 4);
    out[2] = divi(gz, 4);
  }

  /** Pass 2 (spec 6): displacement from the 27-point Sobel gradients of U and M plus motility; three bytes per cell. */
  flow(): void {
    const { cells, genome } = this.state;
    const c = this.cfg;
    const { W, H, D, n } = this;
    this.fillMass();
    const Mb = this.Mb;
    const gU = new Int32Array(3);
    const gM = new Int32Array(3);
    const dmax = 64 - c.spread;
    const d = [0, 0, 0];
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (z * H + y) * W + x;
          this.sobel3(this.U, x, y, z, gU);
          this.sobel3(Mb, x, y, z, gM);
          const Mi = Mb[i];
          const alpha = Mi >= c.thetaMass ? 256 : divu(mulu(mulu(Mi, Mi), 256), mulu(c.thetaMass, c.thetaMass));
          for (let a = 0; a < 3; a++) {
            const Fa = divi((256 - alpha) * gU[a], 2048) - divi(alpha * gM[a], this.massDiv);
            d[a] = divi(c.dtQ * Fa, 1024);
          }
          if (c.motility !== false && this.living(genome, i)) {
            const mot = cells[CH.MOT * n + i];
            const gain = (this.refWords ? this.refWords[G.PARAM1] : genome[G.PARAM1 * n + i]) & 0xff;
            d[0] += motilityTerm(mot & 0xff, gain);
            d[1] += motilityTerm((mot >>> 8) & 0xff, gain);
            d[2] += motilityTerm((mot >>> 16) & 0xff, gain);
          }
          const dx = clampi(d[0], -dmax, dmax);
          const dy = clampi(d[1], -dmax, dmax);
          const dz = clampi(d[2], -dmax, dmax);
          this.disp[i] = (dx + 64) | ((dy + 64) << 8) | ((dz + 64) << 16);
        }
      }
    }
  }

  /** Pass 3 (spec 7): exact integer reintegration of B, P, E over 27 sources, the genome lottery, and six-direction diffusion of A, C, S. */
  transport(): void {
    const { cells, genome } = this.state;
    const out = this.cellsB;
    const gout = this.genomeB;
    const c = this.cfg;
    const { W, H, D, n, hw, d1 } = this;
    const seed = c.seed;
    const step = this.state.step;
    // Per-axis weights of every cell's displacement: wts[s * 9 + axis * 3 + (o + 1)].
    const wts = new Uint8Array(n * 9);
    for (let s = 0; s < n; s++) {
      const dd = this.disp[s];
      for (let a = 0; a < 3; a++) {
        const da = ((dd >>> (8 * a)) & 0xff) - 64;
        for (let o = -1; o <= 1; o++) wts[s * 9 + a * 3 + o + 1] = w1d(da, o, hw);
      }
    }
    // The diffusion rotation depends on the sender alone.
    const rots = new Uint8Array(n);
    for (let s = 0; s < n; s++) rots[s] = diffRot6(cellBase(seed, step, s));

    const srcs = new Int32Array(27);
    const lot = new Uint32Array(27);
    const nbs = new Int32Array(6);
    const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = (z * H + y) * W + x;
          let inB = 0, inP = 0, inE = 0;
          let k = 0;
          for (let oz = -1; oz <= 1; oz++) {
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++, k++) {
                const s = this.nb3(x, y, z, ox, oy, oz);
                srcs[k] = s;
                if (s === OUTSIDE) {
                  lot[k] = 0;
                  continue;
                }
                const wb = s * 9;
                const qB = cells[CH.B * n + s], qP = cells[CH.P * n + s], qE = cells[CH.E * n + s];
                let sB = 0, sP = 0, sE = 0;
                if (ox === 0 && oy === 0 && oz === 0) {
                  // Stay = everything not sent to another real cell (rounding remainders and portions aimed through a wall stay).
                  sB = qB; sP = qP; sE = qE;
                  for (let tz = -1; tz <= 1; tz++) {
                    if (z + tz < 0 || z + tz >= D) continue;
                    const wz = wts[wb + 6 + tz + 1];
                    if (wz === 0) continue;
                    for (let ty = -1; ty <= 1; ty++) {
                      const wy = wts[wb + 3 + ty + 1];
                      if (wy === 0) continue;
                      for (let tx = -1; tx <= 1; tx++) {
                        if (tx === 0 && ty === 0 && tz === 0) continue;
                        const wx = wts[wb + tx + 1];
                        if (wx === 0) continue;
                        sB = subu(sB, share3(qB, wx, wy, wz, d1));
                        sP = subu(sP, share3(qP, wx, wy, wz, d1));
                        sE = subu(sE, share3(qE, wx, wy, wz, d1));
                      }
                    }
                  }
                } else {
                  const wx = wts[wb - ox + 1], wy = wts[wb + 3 - oy + 1], wz = wts[wb + 6 - oz + 1];
                  if (wx !== 0 && wy !== 0 && wz !== 0) {
                    sB = share3(qB, wx, wy, wz, d1);
                    sP = share3(qP, wx, wy, wz, d1);
                    sE = share3(qE, wx, wy, wz, d1);
                  }
                }
                inB = addu(inB, sB);
                inP = addu(inP, sP);
                inE = addu(inE, sE);
                lot[k] = addu(sB, sP);
              }
            }
          }
          out[CH.B * n + t] = inB;
          out[CH.P * n + t] = inP;
          out[CH.E * n + t] = inE;

          // Genome: mass-weighted lottery over the sources of incoming bound mass (no takeover in a slab).
          const T = addu(inB, inP);
          if (T === 0) {
            gout[G.LIN_HI * n + t] = 0;
            gout[G.LIN_LO * n + t] = 0;
            out[CH.MOT * n + t] = MOT_ZERO3;
          } else {
            const r = draw(cellBase(seed, step, t), RND3.LOTTERY) % T;
            let cum = 0;
            let win = 0;
            for (let j = 0; j < 27; j++) {
              cum = addu(cum, lot[j]);
              if (cum > r) {
                win = j;
                break;
              }
            }
            const s = srcs[win];
            const hi = genome[G.LIN_HI * n + s], lo = genome[G.LIN_LO * n + s];
            // Genomes are immutable per lineage id: a destination that already holds the winner's lineage is left as is.
            if (gout[G.LIN_HI * n + t] !== hi || gout[G.LIN_LO * n + t] !== lo || (hi | lo) === 0)
              for (let g = 0; g < GENOME_CH3; g++) gout[g * n + t] = genome[g * n + s];
            out[CH.MOT * n + t] = cells[CH.MOT * n + s];
          }

          // Diffusion of dissolved species; a direction that leaves the slab in z does not exist.
          const baseT = cellBase(seed, step, t);
          for (let d = 0; d < 6; d++) nbs[d] = this.nb3(x, y, z, DX[d], DY[d], DZ[d]);
          const Pt = cells[CH.P * n + t];
          for (let sp = 0; sp < 3; sp++) {
            const ch = sp === 0 ? CH.A : sp === 1 ? CH.C : CH.S;
            const Dsp = sp === 0 ? c.diffA : sp === 1 ? c.diffC : c.diffS;
            const qt = cells[ch * n + t];
            let v = qt;
            for (let d = 0; d < 6; d++) {
              const nbi = nbs[d];
              if (nbi === OUTSIDE) continue;
              const Pn = cells[CH.P * n + nbi];
              const De = sp < 2 ? divu(mulu(Dsp, c.gateK), addu(addu(c.gateK, Pt), Pn)) : Dsp;
              v = subu(v, mulFrac(portion6(qt, d, rots[t]), De * 4, 10, draw(baseT, RND3.DIFF + d * 3 + sp)));
              const qn = cells[ch * n + nbi];
              const baseN = cellBase(seed, step, nbi);
              v = addu(v, mulFrac(portion6(qn, d ^ 1, rots[nbi]), De * 4, 10, draw(baseN, RND3.DIFF + (d ^ 1) * 3 + sp)));
            }
            out[ch * n + t] = v;
          }
        }
      }
    }
    const oc = this.state.cells;
    this.state.cells = out;
    this.cellsB = oc;
    const og = this.state.genome;
    this.state.genome = gout;
    this.genomeB = og;
  }

  /** Pass 4 (spec 8): surface light and the shaded column, from the post-transport cells. */
  lightColumn(): void {
    const { cells } = this.state;
    const { W, H, D, n } = this;
    const step = this.state.step;
    const K = this.cfg.lightK!;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let L = this.lightSurface(x, y, step);
        this.Lbuf[y * W + x] = L;
        for (let z = 1; z < D; z++) {
          const above = ((z - 1) * H + y) * W + x;
          const m = Math.min(cells[CH.B * n + above] + cells[CH.P * n + above], MCAP);
          const T = divu(mulu(256, K), addu(K, m));
          L = (L * T) >> 8;
          this.Lbuf[(z * H + y) * W + x] = L;
        }
      }
    }
  }

  /** Pass 5 (spec 9): controller, metabolism, decays, mutation, ledger. */
  react(): StepResult {
    const c = this.cfg;
    const { W, H, D, n } = this;
    const cells = this.state.cells;
    const genome = this.state.genome;
    const out = this.cellsB;
    const step = this.state.step;
    const events: MutationEvent[] = [];
    let lightTotal = 0n;
    let heatTotal = 0n;
    let heatAcc = 0;
    const fluxTotal = new Array<number>(FLUX_COUNT).fill(0);
    const F = new Array<number>(FLUX_COUNT).fill(0);
    const x = new Int32Array(NN_I3);
    const h = new Int32Array(NN_H3);
    const o = new Int32Array(NN_O3);
    const wb = new Int8Array(NN_BYTES3);
    const mutCap = c.mutRate === 0 ? 0 : divu(U32_MAX, c.mutRate);
    const sat = (v: number) => (v > 127 ? 127 : v);
    const cap24 = (v: number) => (v > 0xffffff ? 0xffffff : v);
    const sat16 = (v: number) => (v > 0xffff ? 0xffff : v);
    const sg = c.signalGain ?? 1;

    for (let zz = 0; zz < D; zz++) {
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const i = (zz * H + yy) * W + xx;
          const base = cellBase(c.seed, step, i);
          let A = cells[CH.A * n + i];
          let B = cells[CH.B * n + i];
          let C = cells[CH.C * n + i];
          let P = cells[CH.P * n + i];
          let E = cells[CH.E * n + i];
          let S = cells[CH.S * n + i];
          let mot = MOT_ZERO3;
          const L = this.Lbuf[i];
          let heat = 0;
          let lightIn = 0;
          let newB = 0;
          F.fill(0);
          const living = this.living(genome, i);
          if (E > POOL_MAX3) {
            heat += E - POOL_MAX3;
            E = POOL_MAX3;
          }
          if (S > POOL_MAX3) {
            heat += S - POOL_MAX3;
            S = POOL_MAX3;
          }

          if (living && B > 0) {
            const ref = this.refWords;
            for (let b = 0; b < NN_BYTES3; b++) {
              const word = ref ? ref[G.W0 + (b >> 2)] : genome[(G.W0 + (b >> 2)) * n + i];
              const byte = (word >>> ((b & 3) * 8)) & 0xff;
              wb[b] = byte > 127 ? byte - 256 : byte;
            }
            // Neighbour S (post-transport); a missing z neighbour reads the cell's own S.
            const own = cap24(cells[CH.S * n + i]);
            const sAt = (dx: number, dy: number, dz: number) => {
              const j = this.nb3(xx, yy, zz, dx, dy, dz);
              return j === OUTSIDE ? own : cap24(cells[CH.S * n + j]);
            };
            const Se = sAt(1, 0, 0), Sw = sAt(-1, 0, 0), Ss = sAt(0, 1, 0), Sn = sAt(0, -1, 0);
            const Sbelow = sAt(0, 0, 1), Sabove = sAt(0, 0, -1);
            x[0] = sat(A >>> 2);
            x[1] = sat(B >>> 2);
            x[2] = sat(C >>> 2);
            x[3] = sat(P >>> 2);
            x[4] = sat(divu(mulu(cap24(E), 16), addu(B, 1)));
            x[5] = L >>> 1;
            x[6] = sat(S >>> 2);
            x[7] = clampi(divi(muli(Se - Sw, sg), 4), -127, 127);
            x[8] = clampi(divi(muli(Ss - Sn, sg), 4), -127, 127);
            x[9] = clampi(divi(this.U[i], 2), -127, 127);
            x[10] = clampi(divi(muli(Sbelow - Sabove, sg), 4), -127, 127);
            controllerForward3(wb, x, h, o);
            const r = (k: number) => (o[k] > 0 ? o[k] : 0);
            mot = packMot3(o[OUT3.MX], o[OUT3.MY], o[OUT3.MZ]);

            // Photosynthesis A + light -> B.
            const K = c.kCatHalf;
            let t = mulShr(cat(B, K), r(OUT3.PHOTO), 7);
            t = mulShr(t, L, 8);
            let q = Math.min(A, mulFrac(t, c.kPhoto, 12, draw(base, RND3.PHOTO)));
            A -= q; B += q; newB += q; F[FX.photo] = q;
            lightIn = q * (c.eB - c.eA);
            // Respiration B -> C + energy.
            t = mulShr(cat(B, K), r(OUT3.RESP), 7);
            q = Math.min(B, mulFrac(t, c.kResp, 12, draw(base, RND3.RESP)));
            B -= q; C += q; E += q * (c.eB - c.eC); F[FX.resp] = q;
            if (E > POOL_MAX3) {
              heat += E - POOL_MAX3;
              E = POOL_MAX3;
            }
            // Decomposition C -> A + energy.
            t = mulShr(cat(B, K), r(OUT3.DECOMP), 7);
            q = Math.min(C, mulFrac(t, c.kDecomp, 12, draw(base, RND3.DECOMP)));
            C -= q; A += q; E += q * (c.eC - c.eA); F[FX.decomp] = q;
            if (E > POOL_MAX3) {
              heat += E - POOL_MAX3;
              E = POOL_MAX3;
            }
            // Growth A + energy -> B.
            let g = c.eB - c.eA;
            t = mulShr(cat(B, K), r(OUT3.GROW), 7);
            q = Math.min(A, divu(E, g), mulFrac(t, c.kGrow, 12, draw(base, RND3.GROW)));
            A -= q; B += q; E -= q * g; newB += q; F[FX.grow] = q;
            // Build polymer B + energy -> P.
            g = c.eP - c.eB;
            t = mulShr(cat(B, K), r(OUT3.BUILD), 7);
            q = Math.min(B, divu(E, g), mulFrac(t, c.kBuild, 12, draw(base, RND3.BUILD)));
            B -= q; P += q; E -= q * g; F[FX.build] = q;
            // Signal emission E -> S.
            t = mulShr(cat(B, K), r(OUT3.EMIT), 7);
            q = Math.min(E, mulFrac(t, c.kEmit, 12, draw(base, RND3.EMIT)));
            E -= q; S += q; F[FX.emit] = q;
            if (S > POOL_MAX3) {
              heat += S - POOL_MAX3;
              S = POOL_MAX3;
            }
            // Work of catalysis + maintenance.
            const sumr = r(0) + r(1) + r(2) + r(3) + r(4) + r(5);
            t = mulShr(cat(B, K), sumr, 7);
            const cost = mulFrac(t, c.kCost, 16, draw(base, RND3.COST)) + mulFrac(B, c.kMaint, 16, draw(base, RND3.MAINT));
            if (E >= cost) {
              E -= cost;
              heat += cost;
            } else {
              const deficit = cost - E;
              heat += E;
              E = 0;
              q = Math.min(B, deficit);
              B -= q; C += q; F[FX.starve] = q;
              heat += q * (c.eB - c.eC);
            }

            // Mutation, at a rate per newly synthesised quantum.
            if (newB > 0 && mutCap > 0) {
              const p = mutationThreshold(newB, mutCap, c.mutRate);
              if (draw(base, RND3.MUT) < p) {
                const parentHi = genome[G.LIN_HI * n + i];
                const parentLo = genome[G.LIN_LO * n + i];
                mutateInPlace3(genome, n, i, c, draw(base, RND3.MUT_WHICH), draw(base, RND3.MUT_DELTA));
                genome[G.LIN_HI * n + i] = (step + 1) >>> 0;
                genome[G.LIN_LO * n + i] = i;
                events.push({ childHi: step + 1, childLo: i, parentHi, parentLo });
              }
            }
          }

          // Passive processes (all cells).
          let q = mulFrac(P, c.kPDecay, 16, draw(base, RND3.PDECAY));
          P -= q; C += q; heat += q * (c.eP - c.eC); F[FX.pdecay] = q;
          q = mulFrac(B, c.kBDecay, 16, draw(base, RND3.BDECAY));
          B -= q; C += q; heat += q * (c.eB - c.eC); F[FX.bdecay] = q;
          q = mulFrac(E, c.kELeak, 16, draw(base, RND3.ELEAK));
          E -= q; heat += q;
          q = mulFrac(S, c.kSDecay, 16, draw(base, RND3.SDECAY));
          S -= q; heat += q;
          const t = mulFrac(C, L, 8, draw(base, RND3.ABIO1));
          q = Math.min(C, mulFrac(t, c.kAbio, 16, draw(base, RND3.ABIO2)));
          C -= q; A += q; heat += q * (c.eC - c.eA); F[FX.abio] = q;

          if (living && B === 0 && P === 0) {
            genome[G.LIN_HI * n + i] = 0;
            genome[G.LIN_LO * n + i] = 0;
          }
          out[CH.A * n + i] = A;
          out[CH.B * n + i] = B;
          out[CH.C * n + i] = C;
          out[CH.P * n + i] = P;
          out[CH.E * n + i] = E;
          out[CH.S * n + i] = S;
          out[CH.MOT * n + i] = mot;
          lightTotal += BigInt(lightIn);
          heatAcc += heat;
          if (heatAcc > 2 ** 50) {
            heatTotal += BigInt(heatAcc);
            heatAcc = 0;
          }
          for (let k = 0; k < FLUX_COUNT; k++) fluxTotal[k] += F[k];
          this.roles[i * ROLE_WORDS] = (sat16(F[FX.photo]) | (sat16(F[FX.grow]) << 16)) >>> 0;
          this.roles[i * ROLE_WORDS + 1] = (sat16(F[FX.decomp]) | (sat16(F[FX.resp]) << 16)) >>> 0;
        }
      }
    }
    const oc = this.state.cells;
    this.state.cells = out;
    this.cellsB = oc;
    heatTotal += BigInt(heatAcc);
    this.state.lightIn += lightTotal;
    this.state.heatOut += heatTotal;
    for (let k = 0; k < FLUX_COUNT; k++) this.state.flux[k] += BigInt(fluxTotal[k]);
    return { events, light: lightTotal, heat: heatTotal };
  }

  /** Affinity field from the most recent step (for inspection). */
  get affinityField(): Int32Array {
    return this.U;
  }

  /** Displacement words of the most recent flow pass: (dx + 64) | (dy + 64) << 8 | (dz + 64) << 16. */
  get displacement(): Uint32Array {
    return this.disp;
  }

  /** Shaded light of the most recent light pass, one value per cell. */
  get lightField(): Uint32Array {
    return this.Lbuf;
  }
}
