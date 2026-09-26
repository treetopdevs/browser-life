// Small statistics toolkit for ensemble analysis (no dependencies).

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  sse: number;
  r2: number;
}

export function linearFit(t: number[], y: number[]): LinearFit {
  const n = t.length;
  const mt = mean(t), my = mean(y);
  let stt = 0, sty = 0;
  for (let i = 0; i < n; i++) {
    stt += (t[i] - mt) ** 2;
    sty += (t[i] - mt) * (y[i] - my);
  }
  const slope = stt > 0 ? sty / stt : 0;
  const intercept = my - slope * mt;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    sse += (y[i] - (intercept + slope * t[i])) ** 2;
    sst += (y[i] - my) ** 2;
  }
  return { slope, intercept, sse, r2: sst > 0 ? 1 - sse / sst : 0 };
}

export interface SaturatingFit {
  /** y = ymax (1 - exp(-t / tau)) + y0 */
  ymax: number;
  tau: number;
  y0: number;
  sse: number;
}

/** Grid-search fit of a saturating exponential (tau over a log grid, closed-form amplitude). */
const maxOf = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);
const minOf = (xs: number[]) => xs.reduce((a, b) => (b < a ? b : a), Infinity);

export function saturatingFit(t: number[], y: number[]): SaturatingFit {
  const tmax = Math.max(maxOf(t), 1);
  let best: SaturatingFit = { ymax: 0, tau: tmax, y0: mean(y), sse: Infinity };
  for (let k = 0; k < 60; k++) {
    const tau = tmax * 10 ** (-2 + (k / 59) * 3.5);
    const x = t.map((v) => 1 - Math.exp(-v / tau));
    const f = linearFit(x, y);
    if (f.sse < best.sse) best = { ymax: f.slope, tau, y0: f.intercept, sse: f.sse };
  }
  return best;
}

export type GrowthVerdict = "growing" | "saturating" | "flat" | "indeterminate";

/**
 * Pre-registered classification (experiments/preregistration.md):
 *  - "flat": the linear change over the window is below 5% of the mean level;
 *  - "growing": linear preferred by dAIC >= 2 (dAIC = AIC_sat - AIC_lin), or
 *    the fitted saturation time constant lies beyond half the window;
 *  - "saturating": saturation preferred by dAIC <= -2 with tau <= half the window;
 *  - otherwise "indeterminate" (neither model qualifies).
 */
export function growthVsSaturation(t: number[], y: number[]): { lin: LinearFit; sat: SaturatingFit; deltaAIC: number; verdict: GrowthVerdict } {
  const n = t.length;
  const lin = linearFit(t, y);
  const sat = saturatingFit(t, y);
  const aic = (sse: number, k: number) => n * Math.log(Math.max(sse, 1e-12) / n) + 2 * k;
  const deltaAIC = aic(sat.sse, 3) - aic(lin.sse, 2);
  const span = maxOf(t) - minOf(t);
  let verdict: GrowthVerdict = "indeterminate";
  if (Math.abs(lin.slope * span) < 0.05 * Math.max(1e-9, Math.abs(mean(y)))) verdict = "flat";
  else if (deltaAIC >= 2 || sat.tau > 0.5 * span) verdict = "growing";
  else if (deltaAIC <= -2 && sat.tau <= 0.5 * span) verdict = "saturating";
  return { lin, sat, deltaAIC, verdict };
}

/**
 * Mann–Whitney U: two-sided p, and the one-sided p for the alternative that
 * `a` tends to exceed `b`. With at most EXACT_MAX observations in total the
 * p-values are exact (permutation distribution of the midrank sum, so ties
 * are handled exactly); larger samples use the tie-corrected normal
 * approximation.
 */
export const EXACT_MAX = 60;

export function mannWhitney(
  a: number[],
  b: number[],
  method: "auto" | "exact" | "normal" = "auto",
): { U: number; p: number; pGreater: number; effect: number; exact: boolean } {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0; // sum over tie groups of (t^3 - t)
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    for (let k = i; k <= j; k++) ranks[k] = (i + j) / 2 + 1;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  let ra = 0;
  all.forEach((x, i) => x.g === 0 && (ra += ranks[i]));
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  const U = ra - (n1 * (n1 + 1)) / 2;
  const effect0 = n1 * n2 > 0 ? U / (n1 * n2) : 0.5;
  if (method === "exact" || (method === "auto" && N <= EXACT_MAX)) {
    if (n1 === 0 || n2 === 0) return { U, p: 1, pGreater: 1, effect: effect0, exact: true };
    // Doubled midranks are integers; count the n1-subsets by doubled rank sum.
    const r2 = ranks.map((r) => Math.round(2 * r));
    const maxS = r2.reduce((s, r) => s + r, 0);
    let ways: Float64Array[] = Array.from({ length: n1 + 1 }, () => new Float64Array(maxS + 1));
    ways[0][0] = 1;
    for (const r of r2) {
      const next = ways.map((w) => w.slice());
      for (let k = 0; k < n1; k++) for (let s = 0; s + r <= maxS; s++) if (ways[k][s]) next[k + 1][s + r] += ways[k][s];
      ways = next;
    }
    const dist = ways[n1];
    const obs = Math.round(2 * ra);
    let total = 0, ge = 0, le = 0;
    for (let s = 0; s <= maxS; s++) {
      total += dist[s];
      if (s >= obs) ge += dist[s];
      if (s <= obs) le += dist[s];
    }
    const pGreater = ge / total;
    return { U, p: Math.min(1, 2 * Math.min(pGreater, le / total)), pGreater, effect: effect0, exact: true };
  }
  const mu = (n1 * n2) / 2;
  // Tie-corrected variance of U.
  const variance = N > 1 ? ((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1))) : 0;
  const effect = effect0;
  if (!(variance > 0)) return { U, p: 1, pGreater: 1, effect, exact: false };
  const z = (U - mu) / Math.sqrt(variance);
  return { U, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), pGreater: 1 - normCdf(z), effect, exact: false };
}

/** Holm step-down adjusted p-values (same order as the input). */
export function holm(ps: number[]): number[] {
  const order = ps.map((p, i) => [p, i] as const).sort((x, y) => x[0] - y[0]);
  const out = new Array<number>(ps.length);
  let running = 0;
  order.forEach(([p, i], k) => {
    running = Math.max(running, Math.min(1, (ps.length - k) * p));
    out[i] = running;
  });
  return out;
}

/** One-sided Clopper–Pearson lower confidence bound on a binomial proportion (k successes in n). */
export function binomialLowerBound(k: number, n: number, alpha = 0.05): number {
  if (k <= 0) return 0;
  // P(X >= k | p), increasing in p.
  const tail = (p: number) => {
    let s = 0, c = 1;
    for (let i = 0; i <= n; i++) {
      if (i >= k) s += c * p ** i * (1 - p) ** (n - i);
      c = (c * (n - i)) / (i + 1);
    }
    return s;
  };
  let lo = 0, hi = 1;
  for (let it = 0; it < 60; it++) {
    const m = (lo + hi) / 2;
    if (tail(m) < alpha) lo = m;
    else hi = m;
  }
  return lo;
}

function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 for erf(|x|); erf is odd.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -y : y));
}
