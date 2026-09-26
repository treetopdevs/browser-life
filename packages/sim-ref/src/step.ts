// CPU reference implementation. This file is the specification of the rules:
// the WGSL kernels in @bl/sim-gpu must match it bit for bit.
//
// One step = affinity -> flow -> transport -> react.
//   affinity : U = G(K * (B+P); mu, sigma)            (Lenia growth field)
//   flow     : displacement = dt((1-a)grad U - a grad M + kAdhesion*grad P) + motility   (Flow-Lenia)
//              (adhesion is scaled by dt like the other two terms, unlike
//              motility; an attraction toward local polymer density, off by
//              default -- see WorldConfig.adhesion for what is and is not
//              demonstrated about its effect on cohesion)
//   transport: B, P, E and the genome move by exact integer reintegration;
//              A, C (membrane-gated) and S diffuse.
//   react    : controller + metabolism + decays + mutation; energy ledger.

import {
  CELL_CHANNELS,
  CH,
  G,
  GENOME_CHANNELS,
  B1_OFF,
  B2_OFF,
  NN_H,
  NN_I,
  NN_O,
  OUT,
  RND,
  U32_MAX,
  W1_OFF,
  W2_OFF,
  addu,
  buildKernel,
  cellBase,
  cellCount,
  clampi,
  divi,
  divu,
  draw,
  lightModeId,
  mulFrac,
  mulu,
  subu,
  worldW,
  NN_BYTES,
  LEDGER_MAX,
  MAX_STEP,
  POOL_MAX,
  DEFAULT_K_ADHESION,
  clampLesionRadius,
  mulShr,
  validateState,
  FLUX_COUNT,
  FLUX_NAMES,
  ROLE_WORDS,
  encodeGenome,
  generalistGenome,
  type FluxName,
  type KernelTable,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";

export const MOT_ZERO = 128 | (128 << 8);
const FX = Object.fromEntries(FLUX_NAMES.map((k, i) => [k, i])) as Record<FluxName, number>;
const MCAP = 16383;

export interface MutationEvent {
  childHi: number;
  childLo: number;
  parentHi: number;
  parentLo: number;
}

export interface StepResult {
  events: MutationEvent[];
  light: bigint;
  heat: bigint;
}

export class RefSim {
  readonly cfg: WorldConfig;
  readonly n: number;
  readonly W: number;
  readonly H: number;
  readonly kernel: KernelTable;
  state: WorldState;
  private cellsB: Uint32Array;
  private genomeB: Uint32Array;
  private U: Int32Array;
  private disp: Uint32Array;
  private readonly massDiv: number;
  /** Reference genome expressed by every cell in neutral-shadow runs. */
  private readonly refWords: Uint32Array | null;
  /** Diagnostic: last step's per-cell reaction amounts (see ROLE_WORDS). */
  readonly roles: Uint32Array;

  constructor(state: WorldState) {
    const errs = validateState(state);
    if (errs.length) throw new Error(`invalid state: ${errs.join("; ")}`);
    this.state = state;
    this.cfg = state.cfg;
    this.n = cellCount(this.cfg);
    this.W = worldW(this.cfg);
    this.H = this.n / this.W;
    this.kernel = buildKernel(this.cfg.kernelRadius);
    this.cellsB = new Uint32Array(this.n * CELL_CHANNELS);
    this.genomeB = new Uint32Array(this.n * GENOME_CHANNELS);
    this.U = new Int32Array(this.n);
    this.disp = new Uint32Array(this.n);
    this.massDiv = 8 * this.cfg.massUnit;
    this.refWords = this.cfg.neutral ? encodeGenome(generalistGenome(this.cfg.defaultMu, this.cfg.defaultSigma), 0, 0) : null;
    this.roles = new Uint32Array(this.n * ROLE_WORDS);
  }

  /** Index of the neighbour of cell (x, y) at offset (dx, dy), wrapping inside its tile. */
  nb(x: number, y: number, dx: number, dy: number): number {
    const { tileW, tileH } = this.cfg;
    const tx = Math.floor(x / tileW);
    const ty = Math.floor(y / tileH);
    const lx = (x - tx * tileW + dx + tileW) % tileW;
    const ly = (y - ty * tileH + dy + tileH) % tileH;
    return (ty * tileH + ly) * this.W + tx * tileW + lx;
  }

  light(x: number, y: number, step: number): number {
    const c = this.cfg;
    const lx = x % c.tileW;
    const ly = y % c.tileH;
    let L = c.lightBase;
    const mode = lightModeId(c.lightMode);
    if (mode === 0) L += c.lightAmp;
    else if (mode === 1) L += divu(mulu(c.lightAmp, ly), c.tileH - 1);
    else if ((((lx >> 5) + (ly >> 5)) & 1) === 0) L += c.lightAmp;
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

  private mass(cells: Uint32Array, i: number): number {
    const m = cells[CH.B * this.n + i] + cells[CH.P * this.n + i];
    return m > MCAP ? MCAP : m;
  }

  /** Capped structural-polymer amount (see `mass`), the adhesion field's substrate. */
  private poly(cells: Uint32Array, i: number): number {
    const p = cells[CH.P * this.n + i];
    return p > MCAP ? MCAP : p;
  }

  private living(genome: Uint32Array, i: number): boolean {
    return (genome[G.LIN_HI * this.n + i] | genome[G.LIN_LO * this.n + i]) !== 0;
  }

  private affinity(): void {
    const { cells, genome } = this.state;
    const { taps, count, sum } = this.kernel;
    const c = this.cfg;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        let conv = 0;
        for (let k = 0; k < count; k++) {
          const j = this.nb(x, y, taps[k * 4], taps[k * 4 + 1]);
          conv = addu(conv, mulu(taps[k * 4 + 2], this.mass(cells, j)));
        }
        const uq = divu(conv, sum);
        let u = divu(mulu(uq, 1024), c.massUnit);
        if (u > 4095) u = 4095;
        let mu = c.defaultMu;
        let sigma = c.defaultSigma;
        if (!c.neutral && this.living(genome, i)) {
          const p0 = genome[G.PARAM0 * this.n + i];
          mu = p0 & 0xffff;
          sigma = p0 >>> 16;
        }
        mu = mu > 4095 ? 4095 : mu;
        sigma = clampi(sigma, 1, 1023);
        this.U[i] = growth(u, mu, sigma);
      }
    }
  }

  private flow(): void {
    const { cells, genome } = this.state;
    const c = this.cfg;
    const U = this.U;
    const n = this.n;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        const e = this.nb(x, y, 1, 0), w = this.nb(x, y, -1, 0);
        const s = this.nb(x, y, 0, 1), nn = this.nb(x, y, 0, -1);
        const ne = this.nb(x, y, 1, -1), nw = this.nb(x, y, -1, -1);
        const se = this.nb(x, y, 1, 1), sw = this.nb(x, y, -1, 1);
        const gUx = U[ne] + 2 * U[e] + U[se] - (U[nw] + 2 * U[w] + U[sw]);
        const gUy = U[sw] + 2 * U[s] + U[se] - (U[nw] + 2 * U[nn] + U[ne]);
        const m = (j: number) => this.mass(cells, j);
        const gMx = m(ne) + 2 * m(e) + m(se) - (m(nw) + 2 * m(w) + m(sw));
        const gMy = m(sw) + 2 * m(s) + m(se) - (m(nw) + 2 * m(nn) + m(ne));
        const Mi = m(i);
        const alpha = Mi >= c.thetaMass ? 256 : divu(mulu(mulu(Mi, Mi), 256), mulu(c.thetaMass, c.thetaMass));
        let Fx = divi((256 - alpha) * gUx, 2048) - divi(alpha * gMx, this.massDiv);
        let Fy = divi((256 - alpha) * gUy, 2048) - divi(alpha * gMy, this.massDiv);
        // Adhesion (off by default, see WorldConfig.adhesion): climb the
        // local polymer gradient, the same Sobel shape as gU/gM above but
        // over P alone (and, like them, scaled by dtQ below), pulling a
        // cell toward denser nearby P. Its effect on holding a moving
        // colony together is not demonstrated (see WorldConfig.adhesion);
        // this only steers displacement, and transport (below) conserves
        // matter regardless of disp, so adhesion cannot break conservation
        // either way.
        if (c.adhesion === true) {
          const gain = c.kAdhesion ?? DEFAULT_K_ADHESION;
          const p = (j: number) => this.poly(cells, j);
          const [gPx, gPy] = sobelGrad(p(ne), p(e), p(se), p(nw), p(w), p(sw), p(nn), p(s));
          Fx += divi(gain * gPx, this.massDiv);
          Fy += divi(gain * gPy, this.massDiv);
        }
        let dx = divi(c.dtQ * Fx, 1024);
        let dy = divi(c.dtQ * Fy, 1024);
        if (c.motility && this.living(genome, i)) {
          const mot = cells[CH.MOT * n + i];
          const gain = (this.refWords ? this.refWords[G.PARAM1] : genome[G.PARAM1 * n + i]) & 0xff;
          dx += divi(((mot & 0xff) - 128) * gain, 256);
          dy += divi((((mot >>> 8) & 0xff) - 128) * gain, 256);
        }
        const dmax = 64 - c.spread;
        dx = clampi(dx, -dmax, dmax);
        dy = clampi(dy, -dmax, dmax);
        this.disp[i] = (dx + 64) | ((dy + 64) << 8);
      }
    }
  }

  private transport(): void {
    const { cells, genome } = this.state;
    const out = this.cellsB;
    const gout = this.genomeB;
    const c = this.cfg;
    const n = this.n;
    const seed = c.seed;
    const step = this.state.step;
    const hw = 32 + c.spread;
    const d2 = 4 * hw * hw;
    const srcs = new Int32Array(9);
    const lot = new Uint32Array(9);
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const t = y * this.W + x;
        let inB = 0, inP = 0, inE = 0;
        let k = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++, k++) {
            const s = this.nb(x, y, ox, oy);
            srcs[k] = s;
            const d = this.disp[s];
            const dx = (d & 0xff) - 64;
            const dy = ((d >>> 8) & 0xff) - 64;
            const qB = cells[CH.B * n + s], qP = cells[CH.P * n + s], qE = cells[CH.E * n + s];
            let sB: number, sP: number, sE: number;
            if (ox === 0 && oy === 0) {
              // Stay = everything not sent to another cell (includes rounding remainders).
              sB = qB; sP = qP; sE = qE;
              for (let ty = -1; ty <= 1; ty++) {
                for (let tx = -1; tx <= 1; tx++) {
                  if (tx === 0 && ty === 0) continue;
                  const w = w1d(dx, tx, hw) * w1d(dy, ty, hw);
                  if (w === 0) continue;
                  sB = subu(sB, mulShareD(qB, w, d2));
                  sP = subu(sP, mulShareD(qP, w, d2));
                  sE = subu(sE, mulShareD(qE, w, d2));
                }
              }
            } else {
              const w = w1d(dx, -ox, hw) * w1d(dy, -oy, hw);
              sB = mulShareD(qB, w, d2);
              sP = mulShareD(qP, w, d2);
              sE = mulShareD(qE, w, d2);
            }
            inB = addu(inB, sB);
            inP = addu(inP, sP);
            inE = addu(inE, sE);
            lot[k] = addu(sB, sP);
          }
        }
        out[CH.B * n + t] = inB;
        out[CH.P * n + t] = inP;
        out[CH.E * n + t] = inE;

        // Genome: mass-weighted lottery over the sources of incoming bound mass.
        const T = addu(inB, inP);
        // Genomes are immutable per lineage id (a mutation always mints a new id),
        // so a destination that already holds the winner's lineage is left as is.
        // Words of empty cells are don't-care (see canonicalGenome).
        if (T === 0) {
          gout[G.LIN_HI * n + t] = 0;
          gout[G.LIN_LO * n + t] = 0;
          out[CH.MOT * n + t] = MOT_ZERO;
        } else {
          const r = draw(cellBase(seed, step, t), RND.LOTTERY) % T;
          let cum = 0;
          let win = 0;
          for (let j = 0; j < 9; j++) {
            cum = addu(cum, lot[j]);
            if (cum > r) {
              win = j;
              break;
            }
          }
          const s = srcs[win];
          const hi = genome[G.LIN_HI * n + s], lo = genome[G.LIN_LO * n + s];
          if (gout[G.LIN_HI * n + t] !== hi || gout[G.LIN_LO * n + t] !== lo || (hi | lo) === 0)
            for (let g = 0; g < GENOME_CHANNELS; g++) gout[g * n + t] = genome[g * n + s];
          out[CH.MOT * n + t] = cells[CH.MOT * n + s];
        }

        // Diffusion of dissolved species.
        const baseT = cellBase(seed, step, t);
        const nbs = [this.nb(x, y, 1, 0), this.nb(x, y, -1, 0), this.nb(x, y, 0, 1), this.nb(x, y, 0, -1)];
        const Pt = cells[CH.P * n + t];
        for (let sp = 0; sp < 3; sp++) {
          const ch = sp === 0 ? CH.A : sp === 1 ? CH.C : CH.S;
          const D = sp === 0 ? c.diffA : sp === 1 ? c.diffC : c.diffS;
          const gated = sp < 2;
          const qt = cells[ch * n + t];
          let v = qt;
          for (let d = 0; d < 4; d++) {
            const nbi = nbs[d];
            const Pn = cells[CH.P * n + nbi];
            const De = gated ? divu(mulu(D, c.gateK), addu(addu(c.gateK, Pt), Pn)) : D;
            v = subu(v, diffOut(qt, d, De, baseT, sp));
            const qn = cells[ch * n + nbi];
            const baseN = cellBase(seed, step, nbi);
            v = addu(v, diffOut(qn, d ^ 1, De, baseN, sp));
          }
          out[ch * n + t] = v;
        }
      }
    }
    // Swap buffers.
    const oc = this.state.cells;
    this.state.cells = out;
    this.cellsB = oc;
    const og = this.state.genome;
    this.state.genome = gout;
    this.genomeB = og;
  }

  private react(): StepResult {
    const c = this.cfg;
    const n = this.n;
    const cells = this.state.cells;
    const genome = this.state.genome;
    const out = this.cellsB;
    const step = this.state.step;
    const events: MutationEvent[] = [];
    // Per-cell heat can exceed 2^32 in bounded states; totals are exact in BigInt.
    let lightTotal = 0n;
    let heatTotal = 0n;
    let heatAcc = 0;
    const fluxTotal = new Array<number>(FLUX_COUNT).fill(0);
    const F = new Array<number>(FLUX_COUNT).fill(0);
    const x = new Int32Array(NN_I);
    const h = new Int32Array(NN_H);
    const o = new Int32Array(NN_O);
    const wb = new Int8Array(NN_BYTES);
    const mutCap = c.mutRate === 0 ? 0 : divu(U32_MAX, c.mutRate);

    for (let yy = 0; yy < this.H; yy++) {
      for (let xx = 0; xx < this.W; xx++) {
        const i = yy * this.W + xx;
        const base = cellBase(c.seed, step, i);
        let A = cells[CH.A * n + i];
        let B = cells[CH.B * n + i];
        let C = cells[CH.C * n + i];
        let P = cells[CH.P * n + i];
        let E = cells[CH.E * n + i];
        let S = cells[CH.S * n + i];
        let mot = MOT_ZERO;
        const L = this.light(xx, yy, step);
        let heat = 0;
        let lightIn = 0;
        let newB = 0;
        F.fill(0);
        const living = this.living(genome, i);
        // Pool caps (see POOL_MAX): excess free energy or signal leaves as heat.
        if (E > POOL_MAX) {
          heat += E - POOL_MAX;
          E = POOL_MAX;
        }
        if (S > POOL_MAX) {
          heat += S - POOL_MAX;
          S = POOL_MAX;
        }

        if (living && B > 0) {
          // Unpack weights.
          const ref = this.refWords;
          for (let b = 0; b < NN_BYTES; b++) {
            const word = ref ? ref[G.W0 + (b >> 2)] : genome[(G.W0 + (b >> 2)) * n + i];
            const byte = (word >>> ((b & 3) * 8)) & 0xff;
            wb[b] = byte > 127 ? byte - 256 : byte;
          }
          const sat = (v: number) => (v > 127 ? 127 : v);
          const cap24 = (v: number) => (v > 0xffffff ? 0xffffff : v);
          const Se = cap24(cells[CH.S * n + this.nb(xx, yy, 1, 0)]);
          const Sw = cap24(cells[CH.S * n + this.nb(xx, yy, -1, 0)]);
          const Ss = cap24(cells[CH.S * n + this.nb(xx, yy, 0, 1)]);
          const Sn = cap24(cells[CH.S * n + this.nb(xx, yy, 0, -1)]);
          x[0] = sat(A >>> 2);
          x[1] = sat(B >>> 2);
          x[2] = sat(C >>> 2);
          x[3] = sat(P >>> 2);
          x[4] = sat(divu(mulu(cap24(E), 16), addu(B, 1)));
          x[5] = L >>> 1;
          x[6] = sat(S >>> 2);
          x[7] = clampi(divi(Se - Sw, 4), -127, 127);
          x[8] = clampi(divi(Ss - Sn, 4), -127, 127);
          x[9] = clampi(divi(this.U[i], 2), -127, 127);
          for (let j = 0; j < NN_H; j++) {
            let acc = wb[B1_OFF + j] * 128;
            for (let k = 0; k < NN_I; k++) acc += wb[W1_OFF + k * NN_H + j] * x[k];
            h[j] = clampi(divi(acc, 128), 0, 127);
          }
          for (let k = 0; k < NN_O; k++) {
            let acc = wb[B2_OFF + k] * 128;
            for (let j = 0; j < NN_H; j++) acc += wb[W2_OFF + j * NN_O + k] * h[j];
            o[k] = clampi(divi(acc, 128), -127, 127);
          }
          const r = (k: number) => (o[k] > 0 ? o[k] : 0);
          mot = ((o[OUT.MX] + 128) | ((o[OUT.MY] + 128) << 8)) >>> 0;

          // Photosynthesis A + light -> B.
          const K = c.kCatHalf;
          let t = mulShr(cat(B, K), r(OUT.PHOTO), 7);
          t = mulShr(t, L, 8);
          let q = Math.min(A, mulFrac(t, c.kPhoto, 12, draw(base, RND.PHOTO)));
          A -= q; B += q; newB += q; F[FX.photo] = q;
          lightIn = q * (c.eB - c.eA);
          // Respiration B -> C + energy.
          t = mulShr(cat(B, K), r(OUT.RESP), 7);
          q = Math.min(B, mulFrac(t, c.kResp, 12, draw(base, RND.RESP)));
          B -= q; C += q; E += q * (c.eB - c.eC); F[FX.resp] = q;
          if (E > POOL_MAX) {
            heat += E - POOL_MAX;
            E = POOL_MAX;
          }
          // Decomposition C -> A + energy.
          t = mulShr(cat(B, K), r(OUT.DECOMP), 7);
          q = Math.min(C, mulFrac(t, c.kDecomp, 12, draw(base, RND.DECOMP)));
          C -= q; A += q; E += q * (c.eC - c.eA); F[FX.decomp] = q;
          if (E > POOL_MAX) {
            heat += E - POOL_MAX;
            E = POOL_MAX;
          }
          // Growth A + energy -> B.
          let g = c.eB - c.eA;
          t = mulShr(cat(B, K), r(OUT.GROW), 7);
          q = Math.min(A, divu(E, g), mulFrac(t, c.kGrow, 12, draw(base, RND.GROW)));
          A -= q; B += q; E -= q * g; newB += q; F[FX.grow] = q;
          // Build polymer B + energy -> P.
          g = c.eP - c.eB;
          t = mulShr(cat(B, K), r(OUT.BUILD), 7);
          q = Math.min(B, divu(E, g), mulFrac(t, c.kBuild, 12, draw(base, RND.BUILD)));
          B -= q; P += q; E -= q * g; F[FX.build] = q;
          // Signal emission E -> S.
          t = mulShr(cat(B, K), r(OUT.EMIT), 7);
          q = Math.min(E, mulFrac(t, c.kEmit, 12, draw(base, RND.EMIT)));
          E -= q; S += q; F[FX.emit] = q;
          if (S > POOL_MAX) {
            heat += S - POOL_MAX;
            S = POOL_MAX;
          }
          // Work of catalysis + maintenance.
          const sumr = r(0) + r(1) + r(2) + r(3) + r(4) + r(5);
          t = mulShr(cat(B, K), sumr, 7);
          const cost = mulFrac(t, c.kCost, 16, draw(base, RND.COST)) + mulFrac(B, c.kMaint, 16, draw(base, RND.MAINT));
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
            if (draw(base, RND.MUT) < p) {
              const parentHi = genome[G.LIN_HI * n + i];
              const parentLo = genome[G.LIN_LO * n + i];
              mutateInPlace(genome, n, i, c, draw(base, RND.MUT_WHICH), draw(base, RND.MUT_DELTA));
              genome[G.LIN_HI * n + i] = (step + 1) >>> 0;
              genome[G.LIN_LO * n + i] = i;
              events.push({ childHi: step + 1, childLo: i, parentHi, parentLo });
            }
          }
        }

        // Passive processes (all cells).
        let q = mulFrac(P, c.kPDecay, 16, draw(base, RND.PDECAY));
        P -= q; C += q; heat += q * (c.eP - c.eC); F[FX.pdecay] = q;
        q = mulFrac(B, c.kBDecay, 16, draw(base, RND.BDECAY));
        B -= q; C += q; heat += q * (c.eB - c.eC); F[FX.bdecay] = q;
        q = mulFrac(E, c.kELeak, 16, draw(base, RND.ELEAK));
        E -= q; heat += q;
        q = mulFrac(S, c.kSDecay, 16, draw(base, RND.SDECAY));
        S -= q; heat += q;
        const t = mulFrac(C, L, 8, draw(base, RND.ABIO1));
        q = Math.min(C, mulFrac(t, c.kAbio, 16, draw(base, RND.ABIO2)));
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
        const sat16 = (v: number) => (v > 0xffff ? 0xffff : v);
        this.roles[i * ROLE_WORDS] = (sat16(F[FX.photo]) | (sat16(F[FX.grow]) << 16)) >>> 0;
        this.roles[i * ROLE_WORDS + 1] = (sat16(F[FX.decomp]) | (sat16(F[FX.resp]) << 16)) >>> 0;
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
}

/** Polynomial Lenia growth: 2(1 - (u-mu)^2 / 9 sigma^2)^4 - 1, as i32 in [-256, 256]. */
/**
 * Draw threshold for a mutation given `newB` synthesised quanta: newB·mutRate,
 * saturating at U32_MAX only when that product would overflow (newB > mutCap,
 * mutCap = floor(U32_MAX / mutRate)).
 */
export function mutationThreshold(newB: number, mutCap: number, mutRate: number): number {
  return newB > mutCap ? U32_MAX : mulu(newB, mutRate);
}

export function growth(u: number, mu: number, sigma: number): number {
  const diff = u > mu ? u - mu : mu - u;
  const dd = mulu(diff, diff);
  const s9 = mulu(9, mulu(sigma, sigma));
  if (dd >= s9) return -256;
  const xx = divu((s9 - dd) << 8 >>> 0, s9);
  const y = mulu(xx, xx) >>> 8;
  const z = mulu(y, y) >>> 8;
  return 2 * z - 256;
}

/**
 * The Sobel-kernel gradient shape flow() uses for gU and gM, factored out so
 * adhesion's ∇P term (the only caller) is unit-testable on its own. Neighbour
 * order matches flow()'s ne, e, se, nw, w, sw, n, s.
 */
export function sobelGrad(ne: number, e: number, se: number, nw: number, w: number, sw: number, n: number, s: number): [number, number] {
  const gx = ne + 2 * e + se - (nw + 2 * w + sw);
  const gy = sw + 2 * s + se - (nw + 2 * n + ne);
  return [gx, gy];
}

/**
 * Overlap (1/64 cell) of a box of half-width hw centred at displacement d
 * with the cell at integer offset o, along one axis.
 */
export function w1d(d: number, o: number, hw: number): number {
  const lo = Math.max(d - hw, 64 * o - 32);
  const hi = Math.min(d + hw, 64 * o + 32);
  return hi > lo ? hi - lo : 0;
}

/** Exact floor(q * w / d2) for w <= d2 <= 2^14 without overflow. */
export function mulShareD(q: number, w: number, d2: number): number {
  return addu(mulu(divu(q, d2), w), divu(mulu(q % d2, w), d2));
}

/**
 * Effective catalyst: B^2 / (B + K). Dilute biomass catalyses poorly but pays
 * full maintenance, an Allee effect that favours dense individuals over films.
 */
export function cat(B: number, K: number): number {
  // floor(B*K/(B+K)) = K - ceil(K^2/(B+K)), which never overflows (K <= 65535).
  if (B === 0) return 0;
  const D = addu(B, K);
  const kk = mulu(K, K);
  const ceil = addu(divu(kk, D), kk % D !== 0 ? 1 : 0);
  return subu(B, subu(K, ceil));
}

/** Quanta a source sends in direction d: a quarter-portion scaled by 4*D/1024. */
export function diffOut(q: number, d: number, De: number, baseS: number, sp: number): number {
  const rot = baseS >>> 30;
  const portion = (q >>> 2) + (((d + rot) & 3) < (q & 3) ? 1 : 0);
  return mulFrac(portion, De * 4, 10, draw(baseS, RND.DIFF + d * 3 + sp));
}

export function mutateInPlace(genome: Uint32Array, n: number, i: number, c: WorldConfig, which: number, deltaRnd: number): void {
  const slot = which % (NN_BYTES + 3);
  let delta = (deltaRnd % (2 * c.mutStep + 1)) - c.mutStep;
  if (delta === 0) delta = 1;
  if (slot < NN_BYTES) {
    const wi = (G.W0 + (slot >> 2)) * n + i;
    const sh = (slot & 3) * 8;
    const byte = (genome[wi] >>> sh) & 0xff;
    const v = clampi((byte > 127 ? byte - 256 : byte) + delta, -127, 127);
    genome[wi] = ((genome[wi] & ~(0xff << sh)) | ((v & 0xff) << sh)) >>> 0;
  } else if (slot === NN_BYTES) {
    const p0 = genome[G.PARAM0 * n + i];
    const mu = clampi((p0 & 0xffff) + delta, 16, 4095);
    genome[G.PARAM0 * n + i] = ((p0 & 0xffff0000) | mu) >>> 0;
  } else if (slot === NN_BYTES + 1) {
    const p0 = genome[G.PARAM0 * n + i];
    const sigma = clampi((p0 >>> 16) + (delta >> 2 === 0 ? (delta > 0 ? 1 : -1) : delta >> 2), 2, 1023);
    genome[G.PARAM0 * n + i] = ((p0 & 0xffff) | (sigma << 16)) >>> 0;
  } else {
    const p1 = genome[G.PARAM1 * n + i];
    const gain = clampi((p1 & 0xff) + delta, 0, 255);
    genome[G.PARAM1 * n + i] = ((p1 & 0xffffff00) | gain) >>> 0;
  }
}

/**
 * Lesion: destroy all bound structure in a disc. Biomass and polymer become
 * waste; their excess chemical energy and the free pool leave as heat.
 * Applied between steps, identically on CPU and GPU.
 */
export function applyLesion(sim: RefSim, cx: number, cy: number, radius: number): void {
  const r = clampLesionRadius(sim.cfg, radius);
  const { cells, genome } = sim.state;
  const c = sim.cfg;
  const n = sim.n;
  let heat = 0n;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const j = sim.nb(cx, cy, dx, dy);
      const B = cells[CH.B * n + j], P = cells[CH.P * n + j], E = cells[CH.E * n + j];
      heat += BigInt(B) * BigInt(c.eB - c.eC) + BigInt(P) * BigInt(c.eP - c.eC) + BigInt(E);
      cells[CH.C * n + j] = addu(cells[CH.C * n + j], addu(B, P));
      cells[CH.B * n + j] = 0;
      cells[CH.P * n + j] = 0;
      cells[CH.E * n + j] = 0;
      cells[CH.MOT * n + j] = MOT_ZERO;
      genome[G.LIN_HI * n + j] = 0;
      genome[G.LIN_LO * n + j] = 0;
    }
  }
  sim.state.heatOut += heat;
}
