// Stability diagnostics for a frozen activity threshold (tools/calibrate.ts):
// a seeded bootstrap interval, split-half agreement and per-run spread of
// the pooled-neutral-activity quantile. Pure and host-agnostic (no Deno/Node
// API) so it is unit-tested under vitest and used as-is from the Deno tool.
import { quantile } from "./activity.ts";
import { mean, sd } from "./stats.ts";

/**
 * Deterministic PRNG (mulberry32) -- small, fast, and reproducible: the same
 * seed always produces the same draw sequence, so a calibration report's
 * bootstrap interval is exactly reproducible from its recorded seed, not
 * just "close" from run to run.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One eligible run's pooled lineage activities (tools/lib/bundle.ts's `activities().tracker.allActivities()`), keyed by seed for split-half grouping. */
export interface RunActivities {
  seed: number;
  activities: number[];
}

export interface BootstrapResult {
  draws: number;
  /** Two-sided interval mass excluded, e.g. 0.10 for a 90% interval. */
  alpha: number;
  lower: number;
  upper: number;
  /** Every bootstrap draw's pooled quantile estimate, in draw order -- exposed for testing and for a caller that wants the full distribution, not just its interval. */
  estimates: number[];
}

/**
 * Bootstrap interval for the pooled q-quantile of lineage activity,
 * resampling at the RUN level (not the individual-activity level): each of
 * `draws` iterations samples `runs.length` runs with replacement from
 * `runs`, pools their activities and computes the q quantile. The run,
 * rather than the individual activity value, is the unit being resampled
 * because the runs -- not the activities within one run -- are the
 * independent replicates; resampling individual activities would treat a
 * single noisy run's many components as that many independent draws. The
 * returned interval is the [alpha/2, 1 - alpha/2] percentile range over the
 * `draws` estimates (e.g. alpha = 0.10 for a 90% interval).
 *
 * `rng` must be a deterministic, seedable generator (`mulberry32`) so a
 * calibration report is exactly reproducible from its recorded seed.
 */
export function bootstrapQuantileInterval(runs: RunActivities[], q: number, opts: { draws?: number; alpha?: number; rng?: () => number } = {}): BootstrapResult {
  const draws = opts.draws ?? 2000;
  const alpha = opts.alpha ?? 0.1;
  const rng = opts.rng ?? mulberry32(1);
  const n = runs.length;
  const estimates: number[] = [];
  for (let d = 0; d < draws; d++) {
    const pooled: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      // Astra review (2026-09-27, P2): `pooled.push(...activities)` spreads
      // every element into a single function call's argument list, which
      // throws "RangeError: Maximum call stack size exceeded" once a run's
      // activity count passes the engine's max-arguments limit (real
      // registered-schedule runs can hold on the order of 1e5-1e6 lineage
      // activities). A plain indexed loop has no such limit.
      const acts = runs[idx].activities;
      for (let k = 0; k < acts.length; k++) pooled.push(acts[k]);
    }
    estimates.push(quantile(pooled, q));
  }
  const sorted = [...estimates].sort((a, b) => a - b);
  return {
    draws,
    alpha,
    lower: quantile(sorted, alpha / 2),
    upper: quantile(sorted, 1 - alpha / 2),
    estimates,
  };
}

export interface SplitHalfGroup {
  seeds: number[];
  n: number;
  value: number;
}

export interface SplitHalfResult {
  odd: SplitHalfGroup;
  even: SplitHalfGroup;
}

/**
 * The pooled q-quantile computed separately over odd-seed and even-seed
 * runs -- a cheap, deterministic (no resampling) stability check: if the
 * two halves disagree substantially, the pooled estimate over all runs is
 * more sensitive to which seeds happened to be drawn than a single quantile
 * value suggests.
 */
export function splitHalfQuantile(runs: RunActivities[], q: number): SplitHalfResult {
  const odd = runs.filter((r) => r.seed % 2 !== 0);
  const even = runs.filter((r) => r.seed % 2 === 0);
  const pool = (rs: RunActivities[]) => rs.flatMap((r) => r.activities);
  return {
    odd: { seeds: odd.map((r) => r.seed), n: odd.length, value: quantile(pool(odd), q) },
    even: { seeds: even.map((r) => r.seed), n: even.length, value: quantile(pool(even), q) },
  };
}

export interface PerRunQuantileSpread {
  values: { seed: number; value: number }[];
  mean: number;
  sd: number;
  min: number;
  max: number;
}

/**
 * The q-quantile computed independently within each run (not pooled), and
 * the spread of those per-run values -- a second stability view, orthogonal
 * to the bootstrap and split-half checks: it shows how much a single run's
 * own activity distribution varies from the pooled figure, without any
 * resampling.
 */
export function perRunQuantileSpread(runs: RunActivities[], q: number): PerRunQuantileSpread {
  const values = runs.map((r) => ({ seed: r.seed, value: quantile(r.activities, q) }));
  const vals = values.map((v) => v.value);
  return {
    values,
    mean: mean(vals),
    sd: sd(vals),
    min: vals.length ? Math.min(...vals) : NaN,
    max: vals.length ? Math.max(...vals) : NaN,
  };
}
