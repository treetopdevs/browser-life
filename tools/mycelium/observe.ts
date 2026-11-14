// Mycelium rung R2 readouts (docs/mycelium-r2-2026-11-13/PROTOCOL.md, sections 3 and 4).
//
// Pure functions for the four gating readouts and a streaming observer that a runner calls after every
// step. Nothing here touches Deno, the file system or the clock, so vitest can import it. A run keeps
// scalar series (n, births, refused, sum P every 10 steps; field readouts every 100) and running sums,
// never whole tables. Every readout is a deterministic function of the run: IEEE doubles, fixed loop
// order, no Math.sin/cos, no sorting.
import { NN_O } from "@bl/schema";
import { liveGenotypes, OUT, POS_SHIFT, probe, type MyceliumState } from "./world.ts";

/** The protocol's constants, as written in sections 3 and 4. */
export const R2 = {
  STEPS: 20000,
  BURN: 10000,
  SAMPLE_EVERY: 10,
  CENSUS_EVERY: 100,
  MAX_LAG: 250,
  MIN_COMPONENT_CELLS: 25,
  GUARD_MIN_N: 200,
  HIST_BINS: 256,
  THETA_MIN: 2,
} as const;

/** Run length and the measurement window W = (burn, steps]. The population guard covers all of W (PROTOCOL.md section 7). */
export interface R2Window {
  steps: number;
  burn: number;
}

export const PROTOCOL_WINDOW: R2Window = { steps: R2.STEPS, burn: R2.BURN };

/** Scaled window for a short smoke run (never gating): burn is half the run. */
export function smokeWindow(steps: number): R2Window {
  if (!Number.isInteger(steps) || steps < 400 || steps % R2.CENSUS_EVERY !== 0) throw new Error("a smoke run needs a step count that is a multiple of 100 and at least 400");
  return { steps, burn: steps / 2 };
}

export type Readouts = Record<"R1" | "R2" | "R3" | "R4", number | null>;
export const READOUT_IDS = ["R1", "R2", "R3", "R4"] as const;
export type ReadoutId = (typeof READOUT_IDS)[number];

// ---- R2: patchiness ------------------------------------------------------------------------------------

/** Per-cell particle counts D from the positions. */
export function cellCounts(s: MyceliumState): Uint32Array {
  const W = s.config.width;
  const D = new Uint32Array(W * s.config.height);
  for (let i = 0; i < s.n; i++) D[(s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT)]++;
  return D;
}

/** Lloyd's patchiness, ((sum D^2 / n) - 1) / (n / cells). NaN when n = 0. A random scatter gives about 1. */
export function lloydPatchiness(D: ArrayLike<number>, n: number, cells: number): number {
  if (n === 0) return NaN;
  let sq = 0;
  for (let k = 0; k < D.length; k++) sq += D[k] * D[k];
  return (sq / n - 1) / (n / cells);
}

/** Lloyd's mean crowding, sum D^2 / n - 1 (descriptive: patchiness is this divided by the density). */
export function meanCrowding(D: ArrayLike<number>, n: number): number {
  let sq = 0;
  for (let k = 0; k < D.length; k++) sq += D[k] * D[k];
  return sq / n - 1;
}

// ---- R1: trail connectivity ----------------------------------------------------------------------------

export interface Connectivity {
  /** Connected trail mass over total trail mass; 0 when there is no trail. */
  value: number;
  connectedMass: number;
  totalMass: number;
  /** Components of at least minCells cells, and the size of the largest component of any size. */
  components: number;
  largest: number;
}

/**
 * Mask = cells with P >= theta; components are 4-connected on the torus. Returns the share of ALL trail
 * mass (every cell, masked or not) that lies in components of at least `minCells` cells.
 */
export function trailConnectivity(P: ArrayLike<number>, W: number, H: number, theta: number, minCells: number = R2.MIN_COMPONENT_CELLS): Connectivity {
  const N = W * H;
  let total = 0;
  for (let k = 0; k < N; k++) total += P[k];
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  let connected = 0, components = 0, largest = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (seen[k0] || P[k0] < theta) continue;
    let sp = 0, cells = 0, mass = 0;
    stack[sp++] = k0; seen[k0] = 1;
    while (sp > 0) {
      const k = stack[--sp];
      cells++; mass += P[k];
      const cx = k % W, cy = (k / W) | 0;
      const nb = [cy * W + ((cx + 1) % W), cy * W + ((cx + W - 1) % W), ((cy + 1) % H) * W + cx, ((cy + H - 1) % H) * W + cx];
      for (let d = 0; d < 4; d++) {
        const q = nb[d];
        if (!seen[q] && P[q] >= theta) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    if (cells > largest) largest = cells;
    if (cells >= minCells) { connected += mass; components++; }
  }
  return { value: total === 0 ? 0 : connected / total, connectedMass: connected, totalMass: total, components, largest };
}

/** Streaming integer histogram of P over cells with P > 0 (bins 0..255, larger values clamped into 255). */
export class PHistogram {
  readonly bins: number[] = new Array(R2.HIST_BINS).fill(0);
  add(P: ArrayLike<number>): void {
    for (let k = 0; k < P.length; k++) {
      const v = P[k];
      if (v > 0) this.bins[v >= R2.HIST_BINS - 1 ? R2.HIST_BINS - 1 : v]++;
    }
  }
}

/**
 * theta: the nearest-rank 75th percentile of P over cells with P > 0, read off a histogram (the smallest
 * value whose cumulative count reaches ceil(3N/4)), with a minimum of 2. With no trail it is the minimum.
 */
export function thetaFromHistogram(bins: readonly number[]): number {
  let N = 0;
  for (let v = 1; v < bins.length; v++) N += bins[v];
  if (N === 0) return R2.THETA_MIN;
  const rank = Math.ceil((3 * N) / 4);
  let cum = 0;
  for (let v = 1; v < bins.length; v++) {
    cum += bins[v];
    if (cum >= rank) return Math.max(R2.THETA_MIN, v);
  }
  return Math.max(R2.THETA_MIN, bins.length - 1);
}

/** Element-wise sum of histograms (the five inherit dev runs of calibration pass 1). */
export function mergeHistograms(hs: readonly (readonly number[])[]): number[] {
  const out: number[] = new Array(R2.HIST_BINS).fill(0);
  for (const h of hs) {
    if (h.length !== R2.HIST_BINS) throw new Error("a P histogram must have 256 bins");
    for (let v = 0; v < R2.HIST_BINS; v++) out[v] += h[v];
  }
  return out;
}

// ---- R3: oscillation strength --------------------------------------------------------------------------

export interface Oscillation {
  /**
   * The readout: the highest autocorrelation at or after the first dip below zero, floored at 0. It is 0 when
   * there is no dip, when no autocorrelation after the dip is positive, and when the series is constant or
   * purely linear (rho is 0/0).
   */
  value: number;
  /** The lag (in samples) of that maximum, and the first lag with rho < 0; lag is null whenever value is 0. */
  lag: number | null;
  firstDip: number | null;
  /** True when the series is constant, so rho is 0/0 and the readout is defined as 0. */
  constant: boolean;
  /** Autocorrelations rho(1..lags). */
  rho: number[];
}

/** Remove the least-squares linear trend (against the sample index). */
export function detrend(x: ArrayLike<number>): number[] {
  const N = x.length;
  let sx = 0;
  for (let i = 0; i < N; i++) sx += x[i];
  const xm = sx / N, tm = (N - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < N; i++) { num += (i - tm) * (x[i] - xm); den += (i - tm) * (i - tm); }
  const slope = den === 0 ? 0 : num / den;
  const out: number[] = new Array(N);
  for (let i = 0; i < N; i++) out[i] = x[i] - (xm + slope * (i - tm));
  return out;
}

/**
 * rho(l) = sum_i x_i x_{i+l} / sum_i x_i^2 on the detrended series, for l = 1..maxLag (capped at N - 1).
 * The numerator runs over the pairs that exist; the denominator is the full sum of squares.
 */
export function oscillation(series: ArrayLike<number>, maxLag: number = R2.MAX_LAG): Oscillation {
  const N = series.length;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { if (series[i] < lo) lo = series[i]; if (series[i] > hi) hi = series[i]; }
  if (N < 3 || lo === hi) return { value: 0, lag: null, firstDip: null, constant: true, rho: [] };
  const x = detrend(series);
  let den = 0;
  for (let i = 0; i < N; i++) den += x[i] * x[i];
  if (den === 0) return { value: 0, lag: null, firstDip: null, constant: true, rho: [] };
  const L = Math.min(maxLag, N - 1);
  const rho: number[] = new Array(L);
  for (let l = 1; l <= L; l++) {
    let num = 0;
    for (let i = 0; i + l < N; i++) num += x[i] * x[i + l];
    rho[l - 1] = num / den;
  }
  let l0 = 0;
  for (let l = 1; l <= L; l++) if (rho[l - 1] < 0) { l0 = l; break; }
  if (l0 === 0) return { value: 0, lag: null, firstDip: null, constant: false, rho };
  let best = l0;
  for (let l = l0 + 1; l <= L; l++) if (rho[l - 1] > rho[best - 1]) best = l;
  // Floor at 0: a series whose autocorrelation stays negative after the first dip has no recurrence, not a negative one.
  if (!(rho[best - 1] > 0)) return { value: 0, lag: null, firstDip: l0, constant: false, rho };
  return { value: rho[best - 1], lag: best, firstDip: l0, constant: false, rho };
}

// ---- R4: turnover --------------------------------------------------------------------------------------

/** Births per particle per 1,000 steps over a window: 1000 * births / (steps * mean n). NaN when mean n is 0. */
export function turnover(births: number, windowSteps: number, meanN: number): number {
  return meanN === 0 ? NaN : (1000 * births) / (windowSteps * meanN);
}

// ---- readouts from the stored series -------------------------------------------------------------------

const mean = (a: readonly (number | null)[]): number | null => {
  let t = 0, c = 0;
  for (const v of a) if (v !== null && Number.isFinite(v)) { t += v; c++; }
  return c === 0 ? null : t / c;
};
const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** The scalar series a run keeps; everything the four readouts and the guard need. */
export interface R2Series {
  /** Every 10 steps: sample k is the state after step 10 * (k + 1). Births and refused are cumulative. */
  samples: { n: number[]; births: number[]; refused: number[]; sumP: number[] };
  /** Every 100 steps: census k is the state after step 100 * (k + 1). */
  census: Record<"r1" | "r2" | "crowding" | "families" | "meanM" | "meanE" | "meanAge" | "depositFrac" | "eatFrac" | "moveMean", (number | null)[]>;
}

export interface GuardResult { tripped: boolean; minN: number; samples: number; refusedInGuard: number }

/**
 * The four readouts and the population guard as a pure function of the stored series. The observer's
 * finish() and the analysis' integrity check (verifyResult) both call this, so the cached values in a
 * series.json can be compared with a recomputation. The guard covers all of W (PROTOCOL.md section 7).
 */
export function readoutsFromSeries(window: R2Window, theta: number | null, ser: R2Series): { readouts: Readouts; guard: GuardResult; meanN: number; births: number; osc: Oscillation } {
  const { steps, burn } = window;
  const S = R2.SAMPLE_EVERY, C = R2.CENSUS_EVERY;
  const w0 = burn / S, c0 = burn / C;
  const wn = ser.samples.n.slice(w0);
  const meanN = wn.reduce((t, v) => t + v, 0) / wn.length;
  const births = ser.samples.births[steps / S - 1] - ser.samples.births[burn / S - 1];
  const osc = oscillation(wn);
  const minN = Math.min(...wn);
  const refusedInW = ser.samples.refused[steps / S - 1] - ser.samples.refused[burn / S - 1];
  const readouts: Readouts = {
    R1: theta === null ? null : mean(ser.census.r1.slice(c0)),
    R2: mean(ser.census.r2.slice(c0)),
    R3: osc.value,
    R4: fin(turnover(births, steps - burn, meanN)),
  };
  return { readouts, guard: { tripped: minN < R2.GUARD_MIN_N, minN, samples: wn.length, refusedInGuard: refusedInW }, meanN, births, osc };
}

/** Relative drift of a series across W: (mean of the second half - mean of the first half) / mean over W. Null when the mean is 0 or undefined. */
export function relativeDrift(inW: readonly (number | null)[]): number | null {
  const h = Math.floor(inW.length / 2);
  const a = mean(inW.slice(0, h)), b = mean(inW.slice(h)), all = mean(inW);
  if (a === null || b === null || all === null || all === 0) return null;
  return (b - a) / all;
}

/** A run's cached result against a recomputation from its own stored series. Empty = consistent. */
export function verifyResult(res: R2Result): string[] {
  const bad: string[] = [];
  const re = readoutsFromSeries(res.window, res.theta, { samples: res.samples, census: res.census });
  for (const id of READOUT_IDS) if (!Object.is(re.readouts[id], res.readouts[id])) bad.push(`readout ${id} is ${res.readouts[id]} in the file but ${re.readouts[id]} from its stored series`);
  if (re.guard.tripped !== res.guard.tripped || re.guard.minN !== res.guard.minN) bad.push(`guard is ${JSON.stringify(res.guard)} in the file but ${JSON.stringify(re.guard)} from its stored series`);
  const S = R2.SAMPLE_EVERY, C = R2.CENSUS_EVERY;
  if (res.samples.n.length !== res.window.steps / S || res.census.r2.length !== res.window.steps / C) bad.push("the stored series has the wrong length");
  return bad;
}

// ---- the streaming observer ----------------------------------------------------------------------------

export interface R2Result extends R2Series {
  window: R2Window;
  /** theta used for R1, or null when the run was a pass-1 run (R1 not computed). */
  theta: number | null;
  readouts: Readouts;
  guard: GuardResult;
  /** Descriptive only, never in a decision: means over the W censuses and samples. */
  descriptive: {
    meanN: number | null; nAtBurn: number | null; nAtEnd: number | null;
    families: number | null; familiesPerN: number | null; meanM: number | null; meanE: number | null; meanAge: number | null;
    sumP: number | null; crowding: number | null; depositFrac: number | null; eatFrac: number | null; moveMean: number | null;
    period: number | null; periodSumP: number | null; oscillationSumP: number | null;
    refusedInW: number; capTouchedInW: boolean; births: number;
    connectivity: { components: number | null; largest: number | null };
    /** Relative drift across W, second half against first (see relativeDrift): the stationarity check of PROTOCOL.md section 4. */
    drift: { n: number | null; sumP: number | null; R1: number | null; R2: number | null };
  };
  /** Histogram of P over the W censuses (calibration pass 1 sums these over the inherit dev runs). */
  pHist: number[];
}

/**
 * Call observe(state) once after every step, from step 1 to the last. It reads the state at steps that are
 * multiples of 10 (samples) and 100 (censuses) and ignores the rest; finish() computes the readouts.
 * `theta` null skips R1 (pass 1 of calibration, whose readout values are discarded).
 */
export class R2Observer {
  private readonly n: number[] = [];
  private readonly births: number[] = [];
  private readonly refused: number[] = [];
  private readonly sumP: number[] = [];
  private readonly cen = { r1: [] as (number | null)[], r2: [] as (number | null)[], crowding: [] as (number | null)[], families: [] as (number | null)[], meanM: [] as (number | null)[], meanE: [] as (number | null)[], meanAge: [] as (number | null)[], depositFrac: [] as (number | null)[], eatFrac: [] as (number | null)[], moveMean: [] as (number | null)[] };
  private readonly comps: (number | null)[] = [];
  private readonly largest: (number | null)[] = [];
  private readonly hist = new PHistogram();
  private last = 0;

  constructor(readonly window: R2Window, readonly theta: number | null) {
    const { steps, burn } = window;
    if (steps % R2.CENSUS_EVERY !== 0 || burn % R2.CENSUS_EVERY !== 0 || !(burn < steps)) throw new Error("invalid R2 window");
    if (theta !== null && (!Number.isInteger(theta) || theta < R2.THETA_MIN)) throw new Error("theta must be an integer of at least 2");
  }

  observe(s: MyceliumState): void {
    const t = s.step;
    if (t !== this.last + 1) throw new Error(`R2Observer expects consecutive steps (got ${t} after ${this.last})`);
    this.last = t;
    if (t % R2.SAMPLE_EVERY !== 0) return;
    this.n.push(s.n);
    this.births.push(s.totals.births);
    this.refused.push(s.totals.refused);
    let sp = 0;
    for (let k = 0; k < s.P.length; k++) sp += s.P[k];
    this.sumP.push(sp);
    if (t % R2.CENSUS_EVERY !== 0) return;
    this.census(s, t > this.window.burn);
  }

  private census(s: MyceliumState, inW: boolean): void {
    const c = this.cen;
    const W = s.config.width, H = s.config.height;
    const n = s.n;
    const D = cellCounts(s);
    c.r2.push(fin(lloydPatchiness(D, n, W * H)));
    c.crowding.push(n === 0 ? null : fin(meanCrowding(D, n)));
    if (this.theta !== null) {
      const cc = trailConnectivity(s.P, W, H, this.theta);
      c.r1.push(cc.value); this.comps.push(cc.components); this.largest.push(cc.largest);
    } else { c.r1.push(null); this.comps.push(null); this.largest.push(null); }
    if (inW) this.hist.add(s.P);
    if (n === 0) {
      for (const k of ["families", "meanM", "meanE", "meanAge", "depositFrac", "eatFrac", "moveMean"] as const) c[k].push(null);
      return;
    }
    let m = 0, e = 0, a = 0;
    for (let i = 0; i < n; i++) { m += s.M[i]; e += s.E[i]; a += s.age[i]; }
    const o = probe(s);
    let dep = 0, eat = 0, mv = 0;
    for (let i = 0; i < n; i++) {
      const b = i * NN_O;
      if (o[b + OUT.DEPOSIT] > 0) dep++;
      if (o[b + OUT.EAT] > 0) eat++;
      mv += Math.abs(o[b + OUT.MX]) + Math.abs(o[b + OUT.MY]);
    }
    c.families.push(liveGenotypes(s));
    c.meanM.push(m / n); c.meanE.push(e / n); c.meanAge.push(a / n);
    c.depositFrac.push(dep / n); c.eatFrac.push(eat / n); c.moveMean.push(mv / n);
  }

  finish(): R2Result {
    const { steps, burn } = this.window;
    if (this.last !== steps) throw new Error(`R2Observer.finish: observed ${this.last} steps, expected ${steps}`);
    const S = R2.SAMPLE_EVERY, C = R2.CENSUS_EVERY;
    const w0 = burn / S;            // first W sample index: the sample at step burn + 10
    const c0 = burn / C;            // first W census index: the census at step burn + 100
    const ser: R2Series = { samples: { n: this.n, births: this.births, refused: this.refused, sumP: this.sumP }, census: this.cen };
    const { readouts, guard, meanN, births, osc } = readoutsFromSeries(this.window, this.theta, ser);
    const wp = this.sumP.slice(w0);
    const oscP = oscillation(wp);
    const inW = <T,>(a: T[]) => a.slice(c0);
    const fam = mean(inW(this.cen.families));
    return {
      window: this.window,
      theta: this.theta,
      readouts,
      samples: ser.samples,
      census: this.cen,
      guard,
      descriptive: {
        meanN, nAtBurn: this.n[burn / S - 1], nAtEnd: this.n[steps / S - 1],
        families: fam, familiesPerN: mean(inW(this.cen.families).map((f, k) => { const nn = this.n[(c0 + k + 1) * (C / S) - 1]; return f === null || nn === 0 ? null : f / nn; })),
        meanM: mean(inW(this.cen.meanM)), meanE: mean(inW(this.cen.meanE)), meanAge: mean(inW(this.cen.meanAge)),
        sumP: wp.reduce((t, v) => t + v, 0) / wp.length, crowding: mean(inW(this.cen.crowding)),
        depositFrac: mean(inW(this.cen.depositFrac)), eatFrac: mean(inW(this.cen.eatFrac)), moveMean: mean(inW(this.cen.moveMean)),
        period: osc.lag === null ? null : osc.lag * S, periodSumP: oscP.lag === null ? null : oscP.lag * S, oscillationSumP: oscP.value,
        refusedInW: guard.refusedInGuard, capTouchedInW: guard.refusedInGuard > 0, births,
        connectivity: { components: mean(inW(this.comps)), largest: mean(inW(this.largest)) },
        drift: { n: relativeDrift(this.n.slice(w0)), sumP: relativeDrift(wp), R1: this.theta === null ? null : relativeDrift(inW(this.cen.r1)), R2: relativeDrift(inW(this.cen.r2)) },
      },
      pHist: this.hist.bins,
    };
  }
}
