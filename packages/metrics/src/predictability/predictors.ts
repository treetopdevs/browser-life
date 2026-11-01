// Past-only predictors. Each is a pure function of frames[0..t-1] and parameters fitted on frames[0..F-1] once and frozen.
export const PREDICTORS = ["persistence", "marginal", "best-period", "local-stats"] as const;
export type PredictorName = (typeof PREDICTORS)[number];
export const MAX_PERIOD = 16;
export const FIT_WINDOW = 24;

/** Frames plus a lazy cache of 3x3 torus context keys (base-q packing, exact below 2^53). */
export class Series {
  readonly frames: readonly Uint8Array[];
  readonly w: number;
  readonly h: number;
  readonly q: number;
  private readonly cache = new Map<number, Float64Array>();
  constructor(frames: readonly Uint8Array[], w: number, h: number, q: number) { this.frames = frames; this.w = w; this.h = h; this.q = q; }
  get n(): number { return this.w * this.h; }
  keys(i: number): Float64Array {
    let k = this.cache.get(i);
    if (k) return k;
    const { w, h, q } = this;
    const f = this.frames[i];
    k = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let key = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) key = key * q + f[((y + dy + h) % h) * w + ((x + dx + w) % w)];
      k[y * w + x] = key;
    }
    this.cache.set(i, k);
    return k;
  }
}

export interface Fit {
  F: number;
  q: number;
  marginal: number;
  period: number;
  /** Direct-horizon tables indexed by h: context key -> counts of the target value. */
  tables: Map<number, Map<number, Uint32Array>>;
}

export function fitSeries(s: Series, F: number, horizons: readonly number[]): Fit {
  if (F > s.frames.length) throw new Error("fit window longer than the movie");
  const { q, n } = s;
  const hist = new Array<number>(q).fill(0);
  for (let i = 0; i < F; i++) for (const v of s.frames[i]) hist[v]++;
  let marginal = 0;
  for (let v = 1; v < q; v++) if (hist[v] > hist[marginal]) marginal = v;
  let period = 1, bestE = -1, bestPairs = 1;
  for (let p = 1; p <= MAX_PERIOD; p++) {
    let e = 0;
    for (let i = p; i < F; i++) { const a = s.frames[i], b = s.frames[i - p]; for (let c = 0; c < n; c++) if (a[c] !== b[c]) e++; }
    const pairs = (F - p) * n;
    if (bestE < 0 || e * bestPairs < bestE * pairs) { period = p; bestE = e; bestPairs = pairs; }
  }
  const tables = new Map<number, Map<number, Uint32Array>>();
  for (const h of horizons) {
    const t = new Map<number, Uint32Array>();
    for (let o = 1; o <= F - h; o++) {
      const keys = s.keys(o - 1), target = s.frames[o + h - 1];
      for (let c = 0; c < n; c++) {
        let row = t.get(keys[c]);
        if (!row) { row = new Uint32Array(q); t.set(keys[c], row); }
        row[target[c]]++;
      }
    }
    tables.set(h, t);
  }
  return { F, q, marginal, period, tables };
}

/** Canonical summary of a fit: every context key with its full count row, sorted by key, per horizon. */
export function fitSummary(fit: Fit): { marginal: number; period: number; tables: Record<number, number[][]> } {
  const tables: Record<number, number[][]> = {};
  for (const [h, t] of fit.tables) tables[h] = [...t.entries()].sort((x, y) => x[0] - y[0]).map(([key, row]) => [key, ...row]);
  return { marginal: fit.marginal, period: fit.period, tables };
}

export const CONF_CHANCE = (q: number) => Math.floor(1000 / q);

/**
 * Predict the target frame t+h-1 from frames[0..t-1] only. Writes the predicted values to `out`; for local-stats also
 * writes per-cell integer confidence (per-mille) to `conf`.
 */
export function predictInto(fit: Fit, s: Series, kind: PredictorName, t: number, h: number, out: Uint8Array, conf?: Uint16Array): void {
  const n = s.n;
  if (t < 1 || t > s.frames.length) throw new Error("origin outside the movie");
  switch (kind) {
    case "persistence": out.set(s.frames[t - 1]); return;
    case "marginal": out.fill(fit.marginal); return;
    case "best-period": {
      const p = fit.period;
      out.set(s.frames[t + h - 1 - p * Math.ceil(h / p)]);
      return;
    }
    case "local-stats": {
      const table = fit.tables.get(h);
      if (!table) throw new Error(`no local-stats table for h=${h}`);
      const keys = s.keys(t - 1);
      const q = fit.q;
      for (let c = 0; c < n; c++) {
        const row = table.get(keys[c]);
        if (!row) { out[c] = fit.marginal; if (conf) conf[c] = CONF_CHANCE(q); continue; }
        let best = 0, total = 0;
        for (let v = 0; v < q; v++) { total += row[v]; if (row[v] > row[best]) best = v; }
        out[c] = best;
        if (conf) conf[c] = Math.floor((1000 * (row[best] + 1)) / (total + q));
      }
      return;
    }
  }
}
