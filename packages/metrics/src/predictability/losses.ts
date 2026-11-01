// Predictive loss, calibration, recurrence and compression: four separate quantities, never blended.
import { deflateSync } from "fflate";
import { fitSeries, predictInto, FIT_WINDOW, type Fit, type PredictorName, type Series } from "./predictors.ts";
import type { Movie } from "./movie.ts";

export const CALIBRATION_BINS = 5;
export const DEFLATE_OPTIONS = { level: 6 } as const;
export const FFLATE_VERSION = "0.8.3";

export interface Rational { num: number; den: number }
export interface Loss { errors: number; cells: number; origins: number }
export interface Bin { n: number; correct: number; sumConf: number }
export interface Evaluation extends Loss { calibration?: Bin[] }

/** Valid origins are t in [t0, T-h]; the target is frame t+h-1. */
export function evaluatePredictor(s: Series, fit: Fit, kind: PredictorName, h: number, t0: number = fit.F, tEnd?: number): Evaluation {
  const T = s.frames.length, n = s.n;
  const last = tEnd === undefined ? T - h : Math.min(tEnd, T - h); // tEnd lets a test score only origins whose targets precede a boundary
  const pred = new Uint8Array(n), conf = kind === "local-stats" ? new Uint16Array(n) : undefined;
  const bins: Bin[] | undefined = conf ? Array.from({ length: CALIBRATION_BINS }, () => ({ n: 0, correct: 0, sumConf: 0 })) : undefined;
  let errors = 0, origins = 0;
  for (let t = t0; t <= last; t++) {
    predictInto(fit, s, kind, t, h, pred, conf);
    const target = s.frames[t + h - 1];
    origins++;
    for (let c = 0; c < n; c++) {
      const ok = pred[c] === target[c];
      if (!ok) errors++;
      if (bins && conf) { const b = bins[Math.min(CALIBRATION_BINS - 1, Math.floor(conf[c] / (1000 / CALIBRATION_BINS)))]; b.n++; b.sumConf += conf[c]; if (ok) b.correct++; }
    }
  }
  const ev: Evaluation = { errors, cells: origins * n, origins };
  if (bins) ev.calibration = bins;
  return ev;
}

/** Bin raw (confidence, correct) pairs; used by tests and by `evaluatePredictor`'s bin rule. */
export function calibrationBins(conf: readonly number[], correct: readonly boolean[]): Bin[] {
  const bins: Bin[] = Array.from({ length: CALIBRATION_BINS }, () => ({ n: 0, correct: 0, sumConf: 0 }));
  conf.forEach((c, i) => { const b = bins[Math.min(CALIBRATION_BINS - 1, Math.floor(c / (1000 / CALIBRATION_BINS)))]; b.n++; b.sumConf += c; if (correct[i]) b.correct++; });
  return bins;
}

/** Count-weighted miscalibration: sum_b |sumConf_b/1000 - correct_b| / N, as an exact ratio num/(1000*N). */
export function miscalibration(bins: readonly Bin[]): Rational {
  let num = 0, N = 0;
  for (const b of bins) { num += Math.abs(b.sumConf - 1000 * b.correct); N += b.n; }
  return { num, den: 1000 * N };
}

/** skill = 1 - loss/base = (base-loss)/base; null when base is 0. */
export function skillOf(loss: number, base: number): Rational | null { return base === 0 ? null : { num: base - loss, den: base }; }

/** Fraction of scored targets with an exact copy among the frames the predictor may see (frames[0..t-1]). */
export function recurrenceOf(s: Series, h: number, t0: number): Rational {
  const seen = new Set<string>();
  const key = (i: number) => frameKey(s.frames[i]);
  let hits = 0, total = 0;
  for (let i = 0; i < t0; i++) seen.add(key(i));
  for (let t = t0; t <= s.frames.length - h; t++) {
    seen.add(key(t - 1));
    total++;
    if (seen.has(key(t + h - 1))) hits++;
  }
  return { num: hits, den: total };
}
function frameKey(f: Uint8Array): string { let out = ""; for (let i = 0; i < f.length; i += 4096) out += String.fromCharCode(...f.subarray(i, i + 4096)); return out; }

export function packFrame(f: Uint8Array, q: number): Uint8Array {
  if (q === 2) { const o = new Uint8Array(Math.ceil(f.length / 8)); for (let i = 0; i < f.length; i++) if (f[i]) o[i >> 3] |= 1 << (i & 7); return o; }
  if (q === 16) { const o = new Uint8Array(Math.ceil(f.length / 2)); for (let i = 0; i < f.length; i++) o[i >> 1] |= (f[i] & 15) << ((i & 1) * 4); return o; }
  throw new Error(`unsupported alphabet ${q}`);
}

export interface Compression { packedRawBytes: number; compressedBytes: number; ratioPerMille: number }

/** Bit-packed, XOR-delta (first frame raw), deflate level 6. Resistance to deflate is not algorithmic incompressibility. */
export function compressionOf(m: Movie): Compression {
  const packed = m.frames.map((f) => packFrame(f, m.q));
  const stream = new Uint8Array(packed.length * packed[0].length);
  packed.forEach((p, k) => { for (let i = 0; i < p.length; i++) stream[k * p.length + i] = k === 0 ? p[i] : p[i] ^ packed[k - 1][i]; });
  const compressedBytes = deflateSync(stream, DEFLATE_OPTIONS).length;
  return { packedRawBytes: stream.length, compressedBytes, ratioPerMille: Math.floor((1000 * compressedBytes) / stream.length) };
}

export { fitSeries, FIT_WINDOW };
