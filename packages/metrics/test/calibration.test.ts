import { describe, expect, it } from "vitest";
import { ActivityTracker, quantile } from "@bl/metrics";
import {
  bootstrapQuantileInterval,
  mulberry32,
  perRunQuantileSpread,
  splitHalfQuantile,
  type RunActivities,
} from "@bl/metrics";

// ---- quantile (packages/metrics/src/activity.ts) ----
// No dedicated unit test previously existed for this despite it being the
// function that sets the pre-registered activity threshold (in-sample, and
// now the frozen per-preset value from tools/calibrate.ts) -- covered here
// alongside the calibration stats that consume it.
describe("quantile", () => {
  it("returns Infinity for an empty sample (uncalibrated)", () => {
    expect(quantile([], 0.95)).toBe(Infinity);
  });

  it("interpolates linearly between order statistics", () => {
    // 5 points [1,2,3,4,5]; q=0.5 lands exactly on the middle point.
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    // q=0 and q=1 are the extremes.
    expect(quantile([5, 1, 3, 2, 4], 0)).toBe(1);
    expect(quantile([5, 1, 3, 2, 4], 1)).toBe(5);
  });

  it("matches a hand-computed 95th percentile", () => {
    // 0..19 (20 values): position = 0.95 * 19 = 18.05 -> interpolate between index 18 (18) and 19 (19).
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(quantile(xs, 0.95)).toBeCloseTo(18.05, 10);
  });

  it("is insensitive to input order", () => {
    const xs = [7, 2, 9, 4, 1, 8, 3];
    const shuffled = [...xs].reverse();
    expect(quantile(shuffled, 0.95)).toBe(quantile(xs, 0.95));
  });
});

// ---- ActivityTracker (packages/metrics/src/activity.ts) ----
describe("ActivityTracker", () => {
  it("accumulates abundance across updates and crosses the threshold once", () => {
    const t = new ActivityTracker(5);
    // Component "a" gains activity 2 per census; crosses threshold (5) at census 3 (cumulative 6).
    t.update(0, [["a", 2]]);
    t.update(1, [["a", 2]]);
    const s = t.update(2, [["a", 2]]);
    expect(s.significant).toBe(1);
    expect(s.newActivity).toBe(1);
    expect(s.cumulativeNew).toBe(1);
    // A later update doesn't double-count the same component as "new".
    const s2 = t.update(3, [["a", 2]]);
    expect(s2.newActivity).toBe(0);
    expect(s2.cumulativeNew).toBe(1);
  });

  it("moves a component's final activity to extinctActivity when it disappears", () => {
    const t = new ActivityTracker(Infinity);
    t.update(0, [["a", 3]]);
    t.update(1, []); // "a" is absent: goes extinct with activity 3
    expect(t.extinctActivity).toEqual([3]);
    expect(t.allActivities()).toEqual([3]);
  });

  it("allActivities pools both present and extinct components", () => {
    const t = new ActivityTracker(Infinity);
    t.update(0, [["a", 3], ["b", 1]]);
    t.update(1, [["b", 1]]); // "a" goes extinct at activity 3; "b" keeps accumulating
    const acts = t.allActivities().sort((x, y) => x - y);
    expect(acts).toEqual([2, 3]);
  });

  it("a tie with the threshold is not adaptively significant (strictly above only)", () => {
    const t = new ActivityTracker(4);
    t.update(0, [["a", 2]]);
    const s = t.update(1, [["a", 2]]); // cumulative exactly 4: tied, not significant
    expect(s.significant).toBe(0);
    expect(s.cumulativeNew).toBe(0);
  });
});

// ---- mulberry32 (deterministic PRNG for the bootstrap) ----
describe("mulberry32", () => {
  it("is deterministic: the same seed reproduces the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---- bootstrapQuantileInterval ----
describe("bootstrapQuantileInterval", () => {
  const uniformRuns: RunActivities[] = Array.from({ length: 10 }, (_, i) => ({
    seed: 1001 + i,
    activities: Array.from({ length: 50 }, (_, k) => k + 1), // 1..50, identical across runs
  }));

  it("is exactly reproducible from the same seeded rng", () => {
    const r1 = bootstrapQuantileInterval(uniformRuns, 0.95, { draws: 200, rng: mulberry32(123) });
    const r2 = bootstrapQuantileInterval(uniformRuns, 0.95, { draws: 200, rng: mulberry32(123) });
    expect(r1.estimates).toEqual(r2.estimates);
    expect(r1.lower).toBe(r2.lower);
    expect(r1.upper).toBe(r2.upper);
  });

  it("a different seed can move the estimate distribution (not asserted identical)", () => {
    const r1 = bootstrapQuantileInterval(uniformRuns, 0.95, { draws: 200, rng: mulberry32(1) });
    const r2 = bootstrapQuantileInterval(uniformRuns, 0.95, { draws: 200, rng: mulberry32(2) });
    // Not a strict inequality requirement (could coincide by chance with few
    // draws), but with identical per-run activities every draw's pooled
    // quantile is identical regardless of *which* runs were drawn -- so both
    // in this specific fixture collapse to the same degenerate interval.
    expect(r1.lower).toBe(r2.lower);
    expect(r1.upper).toBe(r2.upper);
  });

  it("collapses to a point interval when every run has identical activities", () => {
    // Any resample of runs pools the same multiset of values every time (up
    // to repetition, which doesn't change the quantile of this uniform
    // fixture), so the bootstrap interval has zero width.
    const r = bootstrapQuantileInterval(uniformRuns, 0.95, { draws: 100, rng: mulberry32(9) });
    expect(r.lower).toBeCloseTo(r.upper, 10);
  });

  it("widens when runs disagree sharply with each other", () => {
    const disagreeing: RunActivities[] = [
      { seed: 1, activities: Array.from({ length: 50 }, (_, k) => k + 1) }, // 1..50
      { seed: 2, activities: Array.from({ length: 50 }, (_, k) => (k + 1) * 100) }, // 100..5000
    ];
    const r = bootstrapQuantileInterval(disagreeing, 0.95, { draws: 500, rng: mulberry32(5) });
    expect(r.upper - r.lower).toBeGreaterThan(0);
  });

  it("defaults to 2000 draws and a 90% (alpha=0.10) interval", () => {
    const r = bootstrapQuantileInterval(uniformRuns, 0.95, { rng: mulberry32(1) });
    expect(r.draws).toBe(2000);
    expect(r.alpha).toBe(0.1);
    expect(r.estimates.length).toBe(2000);
  });

  // Astra review (2026-09-27, P2): the bootstrap resamples RUNS, not
  // individual activity values -- a run's own activity COUNT must not
  // change how often that run itself gets drawn.
  it("controlled draws with unequal run sizes: run-level resampling, not activity-count-weighted (a 1-value run and a 100-value run are drawn with equal probability)", () => {
    const runs: RunActivities[] = [
      { seed: 1, activities: [5] }, // one tiny run
      { seed: 2, activities: Array.from({ length: 100 }, () => 5000) }, // one huge run, wildly different values
    ];
    const r = bootstrapQuantileInterval(runs, 0.95, { draws: 4000, rng: mulberry32(3) });
    // n=2, resampled with replacement: P(both draws are the tiny run) = 0.25,
    // giving a pooled sample of [5, 5] (q0.95 = 5); any draw that includes
    // the huge run at all (P = 0.75) pools mostly/only 5000s (q0.95 near
    // 5000, whatever the exact mix, since 5 is always a small minority next
    // to 100 copies of 5000). If resampling were instead weighted by how
    // many *activities* each run contributes, the tiny run's single value
    // would almost never surface at all. With ~1000 of 4000 draws expected
    // to be [tiny, tiny], the low mode must show up with real mass.
    const low = r.estimates.filter((v) => v < 100).length;
    const high = r.estimates.filter((v) => v > 1000).length;
    expect(low).toBeGreaterThan(4000 * 0.15); // expect ~25%; generous margin
    expect(low).toBeLessThan(4000 * 0.35);
    expect(high).toBeGreaterThan(4000 * 0.5); // expect ~75%
    expect(low + high).toBe(4000); // every draw's pooled q0.95 lands in one bucket or the other for this fixture
  });

  // Astra review (2026-09-27, P2): the bootstrap must not depend on
  // filesystem/array iteration order. Resampling by array INDEX means a
  // fixed rng seed does not reproduce the same per-draw picks under a
  // permutation (permuting which run sits at which index changes which
  // run a given index draw resolves to) -- but the resampling process is
  // still i.i.d. uniform-over-runs either way, so the resulting INTERVAL
  // (not the per-draw estimate sequence) must agree closely between an
  // order and a permutation of it, given enough draws with the same seed.
  it("input-order permutation invariance: shuffling the input array changes nothing about the resulting interval, only about which physical order it iterated", () => {
    const original: RunActivities[] = [
      { seed: 1, activities: [10, 12, 11] },
      { seed: 2, activities: [50, 52, 48, 51] },
      { seed: 3, activities: [200] },
      { seed: 4, activities: [9, 9, 10, 8, 11, 9] },
      { seed: 5, activities: [500, 480, 510, 505, 495] },
    ];
    const shuffled = [original[3], original[0], original[4], original[1], original[2]]; // same 5 runs, different array order
    expect(shuffled.map((r) => r.seed).sort()).toEqual(original.map((r) => r.seed).sort()); // sanity: same multiset

    const draws = 8000;
    const rOriginal = bootstrapQuantileInterval(original, 0.95, { draws, rng: mulberry32(42) });
    const rShuffled = bootstrapQuantileInterval(shuffled, 0.95, { draws, rng: mulberry32(42) });
    // Not asserting exact equality of `estimates` (see comment above -- a
    // fixed rng seed maps index draws to *different* runs under a
    // permutation, so the per-draw realized samples legitimately differ).
    // The interval both converge to, with this many draws from the same
    // seed and the same underlying population, must agree closely.
    const tolerance = 3; // generous relative to this fixture's ~5-500 scale
    expect(Math.abs(rOriginal.lower - rShuffled.lower)).toBeLessThan(tolerance);
    expect(Math.abs(rOriginal.upper - rShuffled.upper)).toBeLessThan(tolerance);
  });

  // Astra review (2026-09-27, P2) regression: `pooled.push(...activities)`
  // spread every element into a single function call's argument list,
  // throwing "RangeError: Maximum call stack size exceeded" once a run held
  // more activities than the engine's max-arguments limit (real
  // registered-schedule runs -- 1e6 steps, censusEvery=100 -- can hold on
  // the order of 1e5-1e6 lineage activities). 200,000 is comfortably past
  // every JS engine's documented limit (V8's is roughly 65,536).
  it("does not throw for a run with a very large activity array (200,000 elements)", () => {
    const large = Array.from({ length: 200_000 }, (_, i) => i);
    const runs: RunActivities[] = [
      { seed: 1, activities: large },
      { seed: 2, activities: [999_999_999] }, // a small second run so resampling still has >1 option
    ];
    expect(() => bootstrapQuantileInterval(runs, 0.95, { draws: 20, rng: mulberry32(1) })).not.toThrow();
    const r = bootstrapQuantileInterval(runs, 0.95, { draws: 20, rng: mulberry32(1) });
    expect(r.estimates.length).toBe(20);
    expect(r.estimates.every((v) => Number.isFinite(v))).toBe(true);
  });
});

// ---- splitHalfQuantile ----
describe("splitHalfQuantile", () => {
  it("separates runs by odd/even seed and pools each half independently", () => {
    const runs: RunActivities[] = [
      { seed: 1001, activities: [10, 10, 10] },
      { seed: 1003, activities: [10, 10, 10] },
      { seed: 1002, activities: [90, 90, 90] },
      { seed: 1004, activities: [90, 90, 90] },
    ];
    const r = splitHalfQuantile(runs, 0.95);
    expect(r.odd.seeds.sort()).toEqual([1001, 1003]);
    expect(r.odd.n).toBe(2);
    expect(r.odd.value).toBe(10);
    expect(r.even.seeds.sort()).toEqual([1002, 1004]);
    expect(r.even.n).toBe(2);
    expect(r.even.value).toBe(90);
  });

  it("an empty half pools to quantile's empty-sample sentinel (Infinity)", () => {
    const runs: RunActivities[] = [{ seed: 1001, activities: [1, 2, 3] }];
    const r = splitHalfQuantile(runs, 0.95);
    expect(r.even.n).toBe(0);
    expect(r.even.value).toBe(Infinity);
  });
});

// ---- perRunQuantileSpread ----
describe("perRunQuantileSpread", () => {
  it("computes each run's own quantile and summarizes their spread", () => {
    const runs: RunActivities[] = [
      { seed: 1, activities: [0, 10] }, // q=0.95 -> 9.5
      { seed: 2, activities: [0, 20] }, // q=0.95 -> 19
      { seed: 3, activities: [0, 30] }, // q=0.95 -> 28.5
    ];
    const r = perRunQuantileSpread(runs, 0.95);
    expect(r.values.map((v) => v.value)).toEqual([9.5, 19, 28.5]);
    expect(r.min).toBe(9.5);
    expect(r.max).toBe(28.5);
    expect(r.mean).toBeCloseTo((9.5 + 19 + 28.5) / 3, 10);
    expect(r.sd).toBeGreaterThan(0);
  });

  it("is NaN/empty-safe for an empty run set", () => {
    const r = perRunQuantileSpread([], 0.95);
    expect(r.values).toEqual([]);
    expect(Number.isNaN(r.min)).toBe(true);
    expect(Number.isNaN(r.max)).toBe(true);
  });
});
