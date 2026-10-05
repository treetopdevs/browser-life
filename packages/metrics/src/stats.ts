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

/**
 * OLS slope of `y` against `t` (`linearFit`), sorted by `t` first for
 * safety. Returns NaN when fewer than `minPoints` points are given.
 *
 * Deliberately does *not* pick a "second half" window itself (an earlier
 * version did, over whichever points happened to carry a finite value --
 * review finding: filtering to finite values *before* windowing lets a
 * missing late observation quietly move the fitted window earlier, instead
 * of being reported as a missing measurement). The window is now
 * `scheduledTrend`'s job below (windowing by *scheduled* census position and
 * only afterwards checking for a missing value); this function just fits
 * whatever points it is given.
 */
export function trendSlope(t: number[], y: number[], minPoints = 4): number {
  const n = Math.min(t.length, y.length);
  if (n < minPoints) return NaN;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => t[a] - t[b]);
  return linearFit(order.map((i) => t[i]), order.map((i) => y[i])).slope;
}

export type TrendStatus = "ok" | "excluded" | "short";
export interface TrendWindowResult {
  slope: number;
  /**
   * "ok": the fit window's scheduled positions all carried a value.
   * "excluded": the window was long enough, but at least one position that
   * should have carried a value (scheduled, and -- if `deepOnly` -- a deep
   * census) didn't; the run is excluded from this observable, not silently
   * shrunk to fewer points.
   * "short": fewer than `minPoints` scheduled positions fall in the second
   * half at all, independent of whether any value is present.
   */
  status: TrendStatus;
}

/**
 * Held-out observables' trend statistic and fit window (experiments/
 * endpoints.ts: HELD_OUT_SPECS). Pure and testable in isolation from a run
 * bundle -- tools/analyze.ts's `trendFor` is a thin wrapper that supplies
 * `steps`/`values` from a loaded run's `series.jsonl` and tallies the
 * returned `status` across an ensemble.
 *
 * The window is defined by *scheduled* census position -- position i
 * (0-indexed) is exactly the observer's `censusIdx` at that census (see
 * packages/runner/src/observe.ts / runner.ts: `censusIdx` starts at 0,
 * increments once per census, and is restored across checkpoints/segments,
 * so it never resets mid-run), so "deep" is exactly `i % deepEvery === 0` --
 * never inferred from which censuses happen to carry a finite value. The
 * second half of *those* scheduled positions is selected first; only then
 * are the values at those positions read out and checked for
 * finiteness -- so a missing scheduled observation excludes the run
 * (`"excluded"`), rather than quietly sliding the window earlier.
 *
 * `minPoints` is a short-run guard only, not a statistical requirement (see
 * `trendSlope`'s own note) -- at the registered schedule (1e6 steps,
 * censusEvery=100, deepEvery=10) a deep-only window alone retains ~500
 * points, far above any reasonable floor.
 */
export function scheduledTrend(
  steps: number[],
  values: (number | undefined)[],
  deepEvery: number,
  deepOnly: boolean,
  minPoints = 4,
): TrendWindowResult {
  const n = Math.min(steps.length, values.length);
  const positions = Array.from({ length: n }, (_, i) => i).filter((i) => !deepOnly || i % deepEvery === 0);
  const half = positions.slice(Math.floor(positions.length / 2));
  if (half.length < minPoints) return { slope: NaN, status: "short" };
  const t: number[] = [], y: number[] = [];
  for (const i of half) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      t.push(steps[i]);
      y.push(v);
    }
  }
  if (t.length !== half.length) return { slope: NaN, status: "excluded" };
  return { slope: trendSlope(t, y, minPoints), status: "ok" };
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

/**
 * Wilcoxon signed-rank test, one-sample: is the median of `x` greater than
 * zero? Chosen over the exact sign test for the held-out observables'
 * absolute-trend claim (experiments/endpoints.ts's "amendment", 2026-09-26)
 * because it weighs *how far* a slope is from zero, not just its sign -- the
 * sign test would call a run with slope +1e-9 exactly as much evidence as
 * one with slope +5, discarding the magnitude information a trend already
 * carries. Values of exactly zero are dropped first (the standard Wilcoxon
 * convention; there is no "zero rank" to assign), so `n` in the result may
 * be less than `x.length`.
 *
 * With at most EXACT_MAX values the p-values are exact: `pGreater` is the
 * exact fraction of the 2^n sign assignments (a value's rank keeps its
 * observed sign or flips, each with probability 1/2 under the null of a
 * symmetric distribution centered at zero) whose signed-rank sum W+ is at
 * least the one observed, computed by the same doubled-integer subset-sum
 * `mannWhitney` uses for its own exact tail (ties give midranks; doubling
 * keeps the accumulator integral). Larger samples fall back to the
 * tie-corrected normal approximation.
 */
export function wilcoxonSignedRank(
  x: number[],
  method: "auto" | "exact" | "normal" = "auto",
): { n: number; W: number; p: number; pGreater: number; exact: boolean } {
  const nz = x.filter((v) => v !== 0);
  const n = nz.length;
  if (n === 0) return { n: 0, W: 0, p: 1, pGreater: 1, exact: true };
  const abs = nz.map((v) => Math.abs(v));
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => abs[a] - abs[b]);
  const ranks = new Array<number>(n);
  let tieTerm = 0; // sum over tie groups of (t^3 - t)
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && abs[order[j + 1]] === abs[order[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = r;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  let Wplus = 0;
  for (let i = 0; i < n; i++) if (nz[i] > 0) Wplus += ranks[i];
  if (method === "exact" || (method === "auto" && n <= EXACT_MAX)) {
    // Doubled midranks are integers; a sign assignment either contributes 0
    // (negative) or its doubled rank (positive) to the doubled sum -- the
    // same subset-sum-by-convolution `mannWhitney` uses for its exact tail.
    const r2 = ranks.map((r) => Math.round(2 * r));
    const maxS = r2.reduce((s, r) => s + r, 0);
    let dist = new Float64Array(maxS + 1);
    dist[0] = 1;
    for (const r of r2) {
      const next = new Float64Array(maxS + 1);
      for (let s = 0; s + r <= maxS; s++) if (dist[s]) {
        next[s] += dist[s]; // this value's sign flips negative: contributes 0
        next[s + r] += dist[s]; // keeps its observed positive contribution
      }
      dist = next;
    }
    const obs = Math.round(2 * Wplus);
    let total = 0, ge = 0, le = 0;
    for (let s = 0; s <= maxS; s++) {
      total += dist[s];
      if (s >= obs) ge += dist[s];
      if (s <= obs) le += dist[s];
    }
    const pGreater = ge / total;
    return { n, W: Wplus, p: Math.min(1, 2 * Math.min(pGreater, le / total)), pGreater, exact: true };
  }
  const mu = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48;
  if (!(variance > 0)) return { n, W: Wplus, p: 1, pGreater: 1, exact: false };
  const z = (Wplus - mu) / Math.sqrt(variance);
  return { n, W: Wplus, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), pGreater: 1 - normCdf(z), exact: false };
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

/**
 * One-sided Clopper–Pearson lower confidence bound on a binomial proportion (k successes in n).
 * Throws unless k and n are integers with 0 <= k <= n and n >= 1 (a malformed count used to return
 * about 1 and so pass a strict gate). Up to n = 1000 the direct sum is used, bit for bit as before;
 * above that the direct sum underflows (its running binomial coefficient overflows), so the tail is
 * summed in log space.
 */
export function binomialLowerBound(k: number, n: number, alpha = 0.05): number {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(k) || k < 0 || k > n) throw new Error(`binomialLowerBound: need integers 0 <= k <= n, n >= 1; got k=${k}, n=${n}`);
  if (k <= 0) return 0;
  if (n > 1000) {
    // log P(X >= k | p) by log-sum-exp; log C(n, i) built term by term (no overflow).
    const tailLog = (p: number) => {
      const lp = Math.log(p), lq = Math.log1p(-p);
      let logC = 0;
      let m = -Infinity;
      const terms: number[] = [];
      for (let i = 0; i <= n; i++) {
        if (i > 0) logC += Math.log((n - i + 1) / i);
        if (i >= k) {
          const t = logC + i * lp + (n - i) * lq;
          terms.push(t);
          if (t > m) m = t;
        }
      }
      let s = 0;
      for (const t of terms) s += Math.exp(t - m);
      return m + Math.log(s);
    };
    const logAlpha = Math.log(alpha);
    let lo = 0, hi = 1;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (tailLog(mid) < logAlpha) lo = mid;
      else hi = mid;
    }
    return lo;
  }
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

/** Replicates and confidence level for per-seed probability gates after M3 (docs/plan.md, "Probability gates"). */
export const PROBABILITY_GATE = { reps: 32, alpha: 0.05 } as const;

/**
 * Whether k successes in n replicates establish a per-seed probability above
 * `p`: at least PROBABILITY_GATE.reps replicates and a one-sided Clopper–Pearson
 * lower bound above `p`. For p = 0.8 over 32 replicates that is 30 or more.
 */
export function passesProbabilityGate(k: number, n: number, p: number, minReps: number = PROBABILITY_GATE.reps, alpha: number = PROBABILITY_GATE.alpha): boolean {
  return n >= minReps && binomialLowerBound(k, n, alpha) > p;
}
