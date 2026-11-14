// Mycelium rung R2b statistics (docs/mycelium-r2b-2026-11-13/PROTOCOL.md sections 6.4, 8): pure functions, no Deno, no
// clock. Unpaired two-sided Mann-Whitney (exact by dynamic programming without ties, a fixed-key permutation Monte
// Carlo with ties), Cliff's delta, the Hodges-Lehmann shift with bootstrap intervals, Holm, Otsu's cut, Spearman's
// correlation and an exact Fisher test. Every random draw comes from the repo's counter-based PRNG with a key fixed
// here, so a result is a deterministic function of its inputs.
import { cellBase, draw } from "@bl/schema";

/** PRNG keys. The protocol says "a fixed key stored in the protocol" and gives no value; these are fixed here (ASCII "r2bp", "r2bb"). */
export const PERM_KEY = 0x72326270;
export const BOOT_KEY = 0x72326262;
export const PERMUTATIONS = 1_000_000;
export const BOOTSTRAPS = 10_000;

// ---- small helpers --------------------------------------------------------------------------------------

export const mean = (a: readonly number[]): number => a.reduce((t, v) => t + v, 0) / a.length;

const byValue = (a: number, b: number) => a - b;

/** Median; the mean of the two middle values for an even count. NaN for an empty array. */
export function median(a: readonly number[]): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort(byValue);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Number of distinct values. */
export const distinct = (a: readonly number[]): number => new Set(a).size;

/**
 * Doubled midranks (rank 1 is the smallest; tied values share the mean of the ranks they span), so every rank is an
 * integer and sums compare exactly: result[i] = 2 * midrank(a[i]).
 */
export function doubledMidranks(a: readonly number[]): number[] {
  const idx = a.map((_, i) => i).sort((i, j) => a[i] - a[j] || i - j);
  const r2 = new Array<number>(a.length);
  for (let s = 0; s < idx.length;) {
    let e = s;
    while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[s]]) e++;
    // ranks s+1 .. e+1, midrank (s + e + 2) / 2, doubled: s + e + 2
    for (let k = s; k <= e; k++) r2[idx[k]] = s + e + 2;
    s = e + 1;
  }
  return r2;
}

// ---- Mann-Whitney ------------------------------------------------------------------------------------------

/** 2U for x against y: 2 * #(x > y) + #(x = y). The sign convention everywhere: x is the first group (inherit, or a control). */
export function twoU(x: readonly number[], y: readonly number[]): number {
  let t = 0;
  for (const a of x) for (const b of y) t += a > b ? 2 : a === b ? 1 : 0;
  return t;
}

/** Cliff's delta = 2U / (n1 n2) - 1 = (#(x > y) - #(x < y)) / (n1 n2), in [-1, 1]; positive when x tends to be larger. */
export function cliffsDelta(x: readonly number[], y: readonly number[]): number {
  return twoU(x, y) / (x.length * y.length) - 1;
}

/**
 * Exact null distribution of U for sample sizes (n1, n2) without ties: counts[u] = number of the C(n1 + n2, n1) equally likely
 * rank assignments with U = u (the coefficients of the Gaussian binomial). Counts are exact doubles up to C(40, 20) and well beyond.
 */
export function exactUCounts(n1: number, n2: number): number[] {
  // T[i][j] = coefficients for (i, j); T[i][j] = shift(T[i-1][j], j) + T[i][j-1]; T[0][j] = T[i][0] = [1].
  const T: number[][][] = [];
  for (let i = 0; i <= n1; i++) {
    T.push([]);
    for (let j = 0; j <= n2; j++) {
      if (i === 0 || j === 0) { T[i].push([1]); continue; }
      const a = T[i - 1][j], b = T[i][j - 1];
      const out = new Array<number>(i * j + 1).fill(0);
      for (let u = 0; u < a.length; u++) out[u + j] += a[u];
      for (let u = 0; u < b.length; u++) out[u] += b[u];
      T[i].push(out);
    }
  }
  return T[n1][n2];
}

/** Two-sided exact p for an observed 2U (an even integer, i.e. no ties): P(|2U* - n1 n2| >= |2U - n1 n2|). */
export function exactTwoSidedP(obs2U: number, n1: number, n2: number): number {
  const counts = exactUCounts(n1, n2);
  const total = counts.reduce((t, v) => t + v, 0);
  const dev = Math.abs(obs2U - n1 * n2);
  let tail = 0;
  for (let u = 0; u < counts.length; u++) if (Math.abs(2 * u - n1 * n2) >= dev) tail += counts[u];
  return tail / total;
}

/**
 * Permutation Monte Carlo two-sided p with ties (midranks): `perms` seed-label permutations, each a partial Fisher-Yates over the
 * pooled doubled midranks with draws from draw(cellBase(PERM_KEY, permutation index, 0), position); p = (1 + #{|2U* - n1 n2| >= |2U - n1 n2|}) / (1 + perms).
 * The array is shuffled in place across permutations: a uniform partial shuffle of any arrangement is a uniform sample.
 */
export function permutationTwoSidedP(x: readonly number[], y: readonly number[], perms: number = PERMUTATIONS, key: number = PERM_KEY): number {
  const n1 = x.length, n2 = y.length, N = n1 + n2;
  const r2 = Int32Array.from(doubledMidranks([...x, ...y]));
  const offset = n1 * (n1 + 1);
  let obs = 0;
  for (let i = 0; i < n1; i++) obs += r2[i];
  const dev = Math.abs(obs - offset - n1 * n2); // |2U - n1 n2|, 2U = 2 R1 - n1 (n1 + 1) with R1 = sum of midranks
  let hits = 0;
  for (let b = 0; b < perms; b++) {
    const base = cellBase(key, b, 0);
    let sum = 0;
    for (let k = 0; k < n1; k++) {
      const j = k + (draw(base, k) % (N - k));
      const t = r2[j]; r2[j] = r2[k]; r2[k] = t;
      sum += r2[k];
    }
    if (Math.abs(sum - offset - n1 * n2) >= dev) hits++;
  }
  return (1 + hits) / (1 + perms);
}

export interface MannWhitney {
  n1: number;
  n2: number;
  /** 2U for x against y. */
  twoU: number;
  /** Cliff's delta, x against y. */
  delta: number;
  p: number;
  method: "exact" | "permutation" | "degenerate";
  ties: boolean;
}

/**
 * Unpaired two-sided Mann-Whitney U, x against y. A tie anywhere in the pooled sample (also within one group) sends the p-value to the
 * permutation Monte Carlo; every value equal gives p = 1.
 */
export function mannWhitney(x: readonly number[], y: readonly number[], perms: number = PERMUTATIONS): MannWhitney {
  if (x.length === 0 || y.length === 0) throw new Error("mannWhitney needs two non-empty samples");
  if ([...x, ...y].some((v) => !Number.isFinite(v))) throw new Error("mannWhitney needs finite values");
  const u2 = twoU(x, y);
  const delta = u2 / (x.length * y.length) - 1;
  const ties = distinct([...x, ...y]) < x.length + y.length;
  if (distinct([...x, ...y]) === 1) return { n1: x.length, n2: y.length, twoU: u2, delta, p: 1, method: "degenerate", ties };
  if (!ties) return { n1: x.length, n2: y.length, twoU: u2, delta, p: exactTwoSidedP(u2, x.length, y.length), method: "exact", ties };
  return { n1: x.length, n2: y.length, twoU: u2, delta, p: permutationTwoSidedP(x, y, perms), method: "permutation", ties };
}

// ---- Hodges-Lehmann and bootstrap ---------------------------------------------------------------------------

/** Hodges-Lehmann shift of x against y: the median of all x_i - y_j (mean of the two middle ones for an even count). */
export function hodgesLehmann(x: readonly number[], y: readonly number[]): number {
  const d: number[] = [];
  for (const a of x) for (const b of y) d.push(a - b);
  return median(d);
}

/** Percentile interval from sorted draws: the values at floor(q B) and ceil((1 - q) B) - 1 (q = 0.025). */
function percentileInterval(sorted: readonly number[], q = 0.025): [number, number] {
  const B = sorted.length;
  return [sorted[Math.floor(q * B)], sorted[Math.min(B - 1, Math.ceil((1 - q) * B) - 1)]];
}

export interface EffectSize {
  delta: number;
  deltaCI: [number, number];
  hl: number;
  hlCI: [number, number];
}

/**
 * Cliff's delta and the Hodges-Lehmann shift of x against y with 95% percentile bootstrap intervals: `boots` resamples of both groups
 * with replacement, indices from draw(cellBase(BOOT_KEY, resample, group), position) % n.
 */
export function effectSize(x: readonly number[], y: readonly number[], boots: number = BOOTSTRAPS, key: number = BOOT_KEY): EffectSize {
  const ds: number[] = [], hs: number[] = [];
  const xs = new Array<number>(x.length), ys = new Array<number>(y.length);
  for (let b = 0; b < boots; b++) {
    const bx = cellBase(key, b, 0), by = cellBase(key, b, 1);
    for (let i = 0; i < x.length; i++) xs[i] = x[draw(bx, i) % x.length];
    for (let j = 0; j < y.length; j++) ys[j] = y[draw(by, j) % y.length];
    ds.push(cliffsDelta(xs, ys));
    hs.push(hodgesLehmann(xs, ys));
  }
  ds.sort(byValue); hs.sort(byValue);
  return { delta: cliffsDelta(x, y), deltaCI: percentileInterval(ds), hl: hodgesLehmann(x, y), hlCI: percentileInterval(hs) };
}

// ---- Holm ---------------------------------------------------------------------------------------------------

export interface HolmResult {
  /** Holm-adjusted p-values in the input order: max over the sorted prefix of min(1, (m - k + 1) p_(k)). */
  adjusted: number[];
  /** Step-down rejection: sort p, reject while p_(i) <= alpha / (m - i + 1), stop at the first failure. */
  reject: boolean[];
}

export function holm(p: readonly number[], alpha = 0.05): HolmResult {
  const m = p.length;
  const order = p.map((_, i) => i).sort((i, j) => p[i] - p[j] || i - j);
  const adjusted = new Array<number>(m), reject = new Array<boolean>(m).fill(false);
  let run = 0, stop = false;
  order.forEach((idx, k) => {
    run = Math.max(run, Math.min(1, (m - k) * p[idx]));
    adjusted[idx] = run;
    if (!stop && p[idx] <= alpha / (m - k)) reject[idx] = true; else stop = true;
  });
  return { adjusted, reject };
}

// ---- Otsu ---------------------------------------------------------------------------------------------------

export interface OtsuResult {
  /** Cut: values at or below it are the low class. The midpoint of the two adjacent distinct values it separates; NaN if all values are equal. */
  cut: number;
  nLow: number;
  nHigh: number;
  /** Between-class variance over total variance (population form), in [0, 1]. */
  share: number;
}

/**
 * The cut that maximises the between-class variance w0 w1 (mu0 - mu1)^2 over all splits between adjacent distinct sorted values;
 * ties take the lower cut (a later split must be strictly better).
 */
export function otsu(values: readonly number[]): OtsuResult {
  const s = [...values].sort(byValue);
  const n = s.length;
  const mu = mean(s);
  const total = s.reduce((t, v) => t + (v - mu) * (v - mu), 0) / n;
  let best = -1, bestK = -1;
  for (let k = 1; k < n; k++) {
    if (s[k] === s[k - 1]) continue;
    const m0 = mean(s.slice(0, k)), m1 = mean(s.slice(k));
    const w0 = k / n, w1 = 1 - w0;
    const b = w0 * w1 * (m0 - m1) * (m0 - m1);
    // A later split must be better by more than rounding noise, so exact ties (up to 1e-12 relative) keep the lower cut.
    if (bestK < 0 || b > best + 1e-12 * Math.max(1, Math.abs(best))) { best = b; bestK = k; }
  }
  if (bestK < 0) return { cut: NaN, nLow: n, nHigh: 0, share: 0 };
  return { cut: (s[bestK - 1] + s[bestK]) / 2, nLow: bestK, nHigh: n - bestK, share: total > 0 ? best / total : 0 };
}

// ---- Spearman, Fisher ---------------------------------------------------------------------------------------

/** Spearman's rho: Pearson correlation of the midranks. NaN when either side is constant. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length < 2) return NaN;
  const ra = doubledMidranks(a), rb = doubledMidranks(b);
  const ma = mean(ra), mb = mean(rb);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - mb) ** 2; }
  return saa === 0 || sbb === 0 ? NaN : sab / Math.sqrt(saa * sbb);
}

const logFact = (() => { const t = [0]; for (let i = 1; i <= 400; i++) t.push(t[i - 1] + Math.log(i)); return t; })();

/** Exact two-sided Fisher p for [[a, b], [c, d]]: the sum of the hypergeometric probabilities no larger than the observed table's (relative tolerance 1e-9). */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lp = (x: number) => logFact[r1] + logFact[r2] + logFact[c1] + logFact[n - c1] - logFact[n] - logFact[x] - logFact[r1 - x] - logFact[c1 - x] - logFact[r2 - c1 + x];
  const obs = lp(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const l = lp(x);
    if (l <= obs + 1e-9) p += Math.exp(l);
  }
  return Math.min(1, p);
}
