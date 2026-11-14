// Mycelium rung R2b readouts (docs/mycelium-r2b-2026-11-13/PROTOCOL.md, sections 3, 4, 6.2 and 7).
//
// Pure functions of a state (Moran's I, the median particle age, the heritable deposit signature SIG, the deposit measure d) and a
// streaming observer that a runner calls at the scalar census (every 100 steps) and the heavy census (every 500). A run keeps
// those two series and nothing else; every readout is a deterministic function of the stored series (runValues), so the analysis
// recomputes them and refuses a file whose cached values differ. Nothing here touches Deno, the file system or the clock.
// Deliberately separate from observe.ts (R2): its semantics are not touched.
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import { controllerForward } from "@bl/sim-ref";
import { liveGenotypes, type MyceliumState, OUT, step } from "./world.ts";
import { PROBE_INPUTS, R2B, READOUT_IDS, type ReadoutId } from "./r2b-protocol.ts";

// ---- state-level functions ---------------------------------------------------------------------------------

export interface Moran { value: number; valid: boolean }

/**
 * Moran's I of the field P on the W x H torus, 4-neighbour weights (section 4):
 * I = sum_i (x_i - m) sum_{j in nb(i)} (x_j - m) / (4 sum_i (x_i - m)^2), m = mean of P. Written with sums so no per-cell mean is
 * needed: with S = sum x, Q = sum x^2, Cr = sum_i x_i * (sum of its four neighbours) and N cells (each cell is a neighbour of four),
 * I = (Cr - 4 S^2 / N) / (4 (Q - S^2 / N)). Invariant under scaling P. Invalid (value 0) when the total trail is below
 * MORAN_MIN_SUM_P or every cell is equal (zero variance).
 */
export function moransI(P: ArrayLike<number>, W: number, H: number, minSum: number = R2B.MORAN_MIN_SUM_P): Moran {
  const N = W * H;
  let S = 0, Q = 0, Cr = 0, lo = Infinity, hi = -Infinity;
  for (let y = 0; y < H; y++) {
    const up = ((y + H - 1) % H) * W, row = y * W, dn = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const v = P[row + x];
      S += v; Q += v * v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      Cr += v * (P[row + ((x + 1) % W)] + P[row + ((x + W - 1) % W)] + P[up + x] + P[dn + x]);
    }
  }
  if (S < minSum || lo === hi) return { value: 0, valid: false };
  const mean2 = (S * S) / N;
  return { value: (Cr - 4 * mean2) / (4 * (Q - mean2)), valid: true };
}

/** Median of the integers in `a` (mean of the two middle values for an even count); null for an empty list. Sorts a copy. */
export function medianOf(a: ArrayLike<number>): number | null {
  const n = a.length;
  if (n === 0) return null;
  const s = Float64Array.from(a).sort();
  const h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Median age of the live particles (null when none). */
export function medianAge(s: MyceliumState): number | null {
  return medianOf(s.age.subarray(0, s.n));
}

/**
 * SIG: over the live particles and the six fixed probe inputs, the fraction of (particle, probe) pairs on which the particle's
 * controller outputs DEPOSIT above 0, computed by controllerForward on the stored genome. Null with no particles.
 */
export function probeSignature(s: MyceliumState): number | null {
  if (s.n === 0) return null;
  const x = new Int32Array(NN_I), h = new Int32Array(NN_H), o = new Int32Array(NN_O);
  let on = 0;
  for (let i = 0; i < s.n; i++) {
    const wb = s.genome.subarray(i * NN_BYTES, (i + 1) * NN_BYTES);
    for (const p of PROBE_INPUTS) {
      x.set(p);
      controllerForward(wb, x, h, o);
      if (o[OUT.DEPOSIT] > 0) on++;
    }
  }
  return on / (s.n * PROBE_INPUTS.length);
}

/** A detached copy of the state with trail decay off, for depositMeasure. */
function cloneNoDecay(s: MyceliumState): MyceliumState {
  return {
    ...s,
    config: { ...s.config, pDecay: 0 },
    A: s.A.slice(), C: s.C.slice(), P: s.P.slice(),
    id: s.id.slice(), parent: s.parent.slice(), gid: s.gid.slice(), x: s.x.slice(), y: s.y.slice(), M: s.M.slice(), E: s.E.slice(), age: s.age.slice(),
    genome: s.genome.slice(), totals: { ...s.totals },
  };
}

/**
 * The deposit measure d (section 6.2): the matter the live particles would deposit in the next step, per particle: the next step is run
 * on a copy of the state with trail decay off, so the only change to P is the step's own deposit (the energy and matter limits and the
 * physarum draw are exactly the ones step() applies). A pure function of the state: nothing is added to the checkpoint. 0 with no particles.
 */
export function depositMeasure(s: MyceliumState): number {
  if (s.n === 0) return 0;
  const sum = (a: Uint32Array) => { let t = 0; for (let k = 0; k < a.length; k++) t += a[k]; return t; };
  const before = sum(s.P);
  const c = cloneNoDecay(s);
  step(c);
  return (sum(c.P) - before) / s.n;
}

// ---- the stored series ------------------------------------------------------------------------------------

/** Scalar census, every 100 steps: the state after step `step[k]`. births and refused are cumulative. */
export interface ScalarSeries { step: number[]; n: number[]; births: number[]; refused: number[]; sumP: number[] }

/** Heavy census, every 500 steps. moran counts 0 when invalid (moranInvalid = 1); medianAge and sig are null with no particles (sig is null for the physarum arm). */
export interface HeavySeries {
  step: number[]; n: number[]; sumP: number[]; moran: number[]; moranInvalid: number[]; medianAge: (number | null)[]; sig: (number | null)[];
  d: number[]; meanM: (number | null)[]; meanE: (number | null)[]; genotypes: number[];
}

export interface R2bSeries { scalar: ScalarSeries; heavy: HeavySeries }

export const emptySeries = (): R2bSeries => ({
  scalar: { step: [], n: [], births: [], refused: [], sumP: [] },
  heavy: { step: [], n: [], sumP: [], moran: [], moranInvalid: [], medianAge: [], sig: [], d: [], meanM: [], meanE: [], genotypes: [] },
});

const sumOf = (a: ArrayLike<number>, n = a.length): number => { let t = 0; for (let k = 0; k < n; k++) t += a[k]; return t; };

/** Call scalar(s) at every step that is a multiple of 100 and heavy(s) at every multiple of 500, after the scalar call. */
export class R2bObserver {
  private readonly ser = emptySeries();

  constructor(private readonly withSig: boolean) {}

  scalar(s: MyceliumState): void {
    if (s.step % R2B.SCALAR_EVERY !== 0) throw new Error(`scalar census at step ${s.step}: not a multiple of ${R2B.SCALAR_EVERY}`);
    const c = this.ser.scalar;
    if (c.step.length && s.step <= c.step[c.step.length - 1]) throw new Error("census steps must increase");
    c.step.push(s.step); c.n.push(s.n); c.births.push(s.totals.births); c.refused.push(s.totals.refused); c.sumP.push(sumOf(s.P));
  }

  heavy(s: MyceliumState): void {
    if (s.step % R2B.HEAVY_EVERY !== 0) throw new Error(`heavy census at step ${s.step}: not a multiple of ${R2B.HEAVY_EVERY}`);
    const h = this.ser.heavy;
    const m = moransI(s.P, s.config.width, s.config.height);
    h.step.push(s.step); h.n.push(s.n); h.sumP.push(sumOf(s.P));
    h.moran.push(m.value); h.moranInvalid.push(m.valid ? 0 : 1);
    h.medianAge.push(medianAge(s));
    h.sig.push(this.withSig ? probeSignature(s) : null);
    h.d.push(depositMeasure(s));
    h.meanM.push(s.n === 0 ? null : sumOf(s.M, s.n) / s.n);
    h.meanE.push(s.n === 0 ? null : sumOf(s.E, s.n) / s.n);
    h.genotypes.push(liveGenotypes(s));
  }

  series(): R2bSeries { return this.ser; }
}

// ---- readouts from the stored series ---------------------------------------------------------------------------

/** Mean over the non-null entries; null when there are none. */
export function meanOf(a: readonly (number | null)[]): number | null {
  let t = 0, c = 0;
  for (const v of a) if (v !== null) { t += v; c++; }
  return c === 0 ? null : t / c;
}

export interface RunValues {
  TM: number | null; MI: number | null; REG: number | null; AGE: number | null; TURN: number | null; SIG: number | null;
  /** Median over the window's scalar censuses of TM_t = sum P / n (the regime classifier's input). */
  medianTM: number | null;
  /** The deposit measure, mean over the window's heavy censuses (section 6.2, and 6.5 over (10k, 30k]). */
  d: number | null;
  /** Descriptive only. */
  meanN: number | null; meanSumP: number | null; births: number; refusedInW: number; minN: number | null;
  guardTripped: boolean; capTouched: boolean; moranInvalidFraction: number | null;
  meanM: number | null; meanE: number | null; genotypes: number | null;
  scalarCensuses: number; heavyCensuses: number;
}

const inW = (steps: readonly number[], lo: number, hi: number): number[] => {
  const idx: number[] = [];
  for (let k = 0; k < steps.length; k++) if (steps[k] > lo && steps[k] <= hi) idx.push(k);
  return idx;
};

/** The value at an exact step of a scalar series, or null if no census was taken there. */
const scalarAt = (ser: ScalarSeries, col: "births" | "refused", at: number): number | null => {
  const k = ser.step.indexOf(at);
  return k < 0 ? null : ser[col][k];
};

/**
 * Every readout of a run over the window (lo, hi], as a pure function of the series (section 4): TM the mean of sum P / n over the scalar
 * censuses (a census with n = 0 counts 0), MI the mean Moran's I over the heavy censuses (null unless every census of the window is valid), REG the fraction
 * of scalar censuses with TM_t >= tau (null when tau is null), AGE the mean over heavy censuses of the median age, TURN
 * 1000 * births in the window / ((hi - lo) * mean n over the scalar censuses), SIG the mean over heavy censuses of the signature. The
 * guard (section 7) trips when n < 200 at any scalar census in the window.
 */
export function runValues(ser: R2bSeries, lo: number, hi: number, tau: number | null): RunValues {
  const si = inW(ser.scalar.step, lo, hi), hi_ = inW(ser.heavy.step, lo, hi);
  const sc = ser.scalar, hv = ser.heavy;
  const tm = si.map((k) => (sc.n[k] === 0 ? 0 : sc.sumP[k] / sc.n[k]));
  const ns = si.map((k) => sc.n[k]);
  const meanN = ns.length ? sumOf(ns) / ns.length : null;
  const b0 = scalarAt(sc, "births", lo), b1 = scalarAt(sc, "births", hi);
  const r0 = scalarAt(sc, "refused", lo), r1 = scalarAt(sc, "refused", hi);
  const births = b0 === null || b1 === null ? NaN : b1 - b0;
  const minN = ns.length ? Math.min(...ns) : null;
  const sortedTM = [...tm].sort((a, b) => a - b);
  const medianTM = tm.length ? (sortedTM.length % 2 ? sortedTM[sortedTM.length >> 1] : (sortedTM[sortedTM.length / 2 - 1] + sortedTM[sortedTM.length / 2]) / 2) : null;
  const heavyMean = (a: readonly (number | null)[]) => meanOf(hi_.map((k) => a[k]));
  const refusedInW = r0 === null || r1 === null ? 0 : r1 - r0;
  // MI is the mean of Moran's I over the window's heavy censuses, defined only when every one of them is valid (at least MORAN_MIN_SUM_P of trail, some
  // variance; MI_MIN_VALID_FRACTION is 1): Moran's I is scale-invariant, so with every census averaged the mass cutoff cannot choose the observations (zero fill
  // made MI a mass indicator below the cutoff, averaging only the valid ones let the cutoff select them). Undefined (null) otherwise.
  const validK = hi_.filter((k) => hv.moranInvalid[k] === 0);
  const validMoran = hi_.length && validK.length / hi_.length >= R2B.MI_MIN_VALID_FRACTION ? sumOf(validK.map((k) => hv.moran[k])) / validK.length : null;
  return {
    TM: tm.length ? sumOf(tm) / tm.length : null,
    MI: validMoran,
    REG: tau === null || tm.length === 0 ? null : tm.filter((v) => v >= tau).length / tm.length,
    AGE: heavyMean(hv.medianAge),
    TURN: Number.isFinite(births) && meanN !== null && meanN > 0 ? (1000 * births) / ((hi - lo) * meanN) : null,
    SIG: heavyMean(hv.sig),
    medianTM,
    d: heavyMean(hv.d),
    meanN, meanSumP: si.length ? sumOf(si.map((k) => sc.sumP[k])) / si.length : null,
    births: Number.isFinite(births) ? births : 0, refusedInW, minN,
    guardTripped: minN === null || minN < R2B.GUARD_MIN_N, capTouched: refusedInW > 0,
    moranInvalidFraction: hi_.length ? sumOf(hi_.map((k) => hv.moranInvalid[k])) / hi_.length : null,
    meanM: heavyMean(hv.meanM), meanE: heavyMean(hv.meanE), genotypes: heavyMean(hv.genotypes),
    scalarCensuses: si.length, heavyCensuses: hi_.length,
  };
}

/** Relative drift across a window: (mean over the second half - mean over the first half) / mean over the window, for TM, n and sum P. */
export interface Drift { TM: number | null; n: number | null; sumP: number | null }

export function halfWindowDrift(ser: R2bSeries, lo: number, hi: number): Drift {
  const mid = (lo + hi) / 2;
  const a = runValues(ser, lo, mid, null), b = runValues(ser, mid, hi, null), w = runValues(ser, lo, hi, null);
  const rel = (x: number | null, y: number | null, all: number | null) => (x === null || y === null || all === null || all === 0 ? null : (y - x) / all);
  return { TM: rel(a.TM, b.TM, w.TM), n: rel(a.meanN, b.meanN, w.meanN), sumP: rel(a.meanSumP, b.meanSumP, w.meanSumP) };
}

/** The readouts that are comparable between runs: id -> value. */
export const readoutValue = (v: RunValues, id: ReadoutId): number | null => v[id];
export const readoutVector = (v: RunValues): Record<ReadoutId, number | null> => Object.fromEntries(READOUT_IDS.map((id) => [id, v[id]])) as Record<ReadoutId, number | null>;

/** A run file's cached values against a recomputation from its own stored series (REG is not cached: it needs tau). Empty = consistent. */
export function verifyCached(ser: R2bSeries, cached: { lo: number; hi: number; values: RunValues }): string[] {
  const bad: string[] = [];
  const re = runValues(ser, cached.lo, cached.hi, null);
  for (const k of Object.keys(re) as (keyof RunValues)[]) {
    if (!Object.is(re[k], cached.values[k])) bad.push(`${k} is ${cached.values[k]} in the file but ${re[k]} from its stored series`);
  }
  return bad;
}

/** The stored series must be complete: censuses at every multiple of 100 and 500 up to `steps`. */
export function seriesProblems(ser: R2bSeries, steps: number): string[] {
  const bad: string[] = [];
  const want = (every: number) => Array.from({ length: Math.floor(steps / every) }, (_, k) => (k + 1) * every);
  if (JSON.stringify(ser.scalar.step) !== JSON.stringify(want(R2B.SCALAR_EVERY))) bad.push("the scalar census steps are not 100, 200, ..., steps");
  if (JSON.stringify(ser.heavy.step) !== JSON.stringify(want(R2B.HEAVY_EVERY))) bad.push("the heavy census steps are not 500, 1000, ..., steps");
  for (const [name, col] of Object.entries(ser.scalar)) if (col.length !== ser.scalar.step.length) bad.push(`scalar column ${name} has the wrong length`);
  for (const [name, col] of Object.entries(ser.heavy)) if (col.length !== ser.heavy.step.length) bad.push(`heavy column ${name} has the wrong length`);
  return bad;
}

// ---- a stored run file ------------------------------------------------------------------------------------

/** What an analysis expects of a run file. */
export interface RunFileExpect {
  phase: string;
  arm: string;
  seed: number;
  steps: number;
  /** The config the arm and seed must have produced, compared as JSON (key order included). */
  config: unknown;
  codeHash: string | null;
  v: number | null;
  round?: number;
}

/** The fields of a run file the checks read (r2b.ts RunFile has them all). */
export interface RunFileLike {
  format: string; protocol: string; phase: string; arm: string; seed: number; steps: number; round?: number; v: number | null; config: unknown; engine: string;
  digest: string; ledgerChecks: number; ledgerResidual: number; codeHash: string; cached: { lo: number; hi: number; values: RunValues }; series: R2bSeries;
}

/**
 * Problems with a stored run (empty = usable): wrong format, protocol, phase, arm, seed, length, deposit or config; a ledger residual or a
 * short ledger-check count (one check per 100-step census); an incomplete series; cached values that differ from a recomputation; a code hash
 * other than the frozen one. Every one of these makes a confirmation result INVALID (section 8, label 1).
 */
export function runFileProblems(f: RunFileLike, want: RunFileExpect): string[] {
  const bad: string[] = [];
  const at = `${want.phase} ${want.arm} ${want.seed}`;
  if (f.format !== "mycelium-r2b-run-1") bad.push(`${at}: format ${f.format}`);
  if (f.protocol !== "mycelium-r2b") bad.push(`${at}: protocol ${f.protocol}`);
  if (f.phase !== want.phase || f.arm !== want.arm || f.seed !== want.seed || f.steps !== want.steps) bad.push(`${at}: the file is ${f.phase} ${f.arm} ${f.seed} for ${f.steps} steps`);
  if (want.round !== undefined && f.round !== want.round) bad.push(`${at}: round ${f.round}, expected ${want.round}`);
  if (f.engine !== "gpu") bad.push(`${at}: engine ${f.engine}`);
  if (f.v !== want.v) bad.push(`${at}: physarumDeposit ${f.v}, expected ${want.v}`);
  if (JSON.stringify(f.config) !== JSON.stringify(want.config)) bad.push(`${at}: the stored config is not the arm's config`);
  if (f.ledgerResidual !== 0) bad.push(`${at}: ledger residual ${f.ledgerResidual}`);
  if (f.ledgerChecks !== want.steps / R2B.SCALAR_EVERY) bad.push(`${at}: ${f.ledgerChecks} ledger checks, expected ${want.steps / R2B.SCALAR_EVERY}`);
  bad.push(...seriesProblems(f.series, want.steps).map((p) => `${at}: ${p}`));
  bad.push(...verifyCached(f.series, f.cached).map((p) => `${at}: cached ${p}`));
  if (want.codeHash !== null && f.codeHash !== want.codeHash) bad.push(`${at}: run under code ${f.codeHash}, frozen code is ${want.codeHash}`);
  return bad;
}
