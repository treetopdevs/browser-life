import { describe, expect, it } from "vitest";
import { mannWhitney } from "@bl/metrics";

describe("Mann–Whitney", () => {
  it("applies the tie correction to the variance", () => {
    const a = [...Array(15).fill(1), ...Array(5).fill(0)];
    const b = [...Array(5).fill(1), ...Array(15).fill(0)];
    expect(mannWhitney(a, b, "normal").p).toBeCloseTo(0.00179, 4);
  });
  it("returns p = 1 when every value is tied", () => {
    expect(mannWhitney([1, 1, 1], [1, 1]).p).toBe(1);
  });
});

import { growthVsSaturation, ActivityTracker, trendSlope, wilcoxonSignedRank } from "@bl/metrics";

describe("trendSlope (held-out observables)", () => {
  it("recovers the exact slope of a perfectly linear series", () => {
    const t = Array.from({ length: 12 }, (_, i) => i);
    const y = t.map((x) => 5 + 2 * x);
    expect(trendSlope(t, y)).toBeCloseTo(2, 12);
  });

  // Review finding #5: trendSlope used to pick its own "second half" window
  // over whichever points happened to be passed, so a caller that filtered
  // to finite values *before* windowing let a missing late observation
  // quietly move the window earlier. The window is now entirely the
  // caller's job (tools/analyze.ts's `trendFor`, which windows by scheduled
  // census position first and only then checks for a missing value);
  // trendSlope just fits exactly the points it is given.
  it("fits exactly the given points -- no internal windowing", () => {
    // If trendSlope still halved internally, fitting only the *second* half
    // of this series (which alone has slope 3) would recover 3; fitting
    // everything it's given (flat then rising) must recover something below 3.
    const t = Array.from({ length: 12 }, (_, i) => i);
    const y = t.map((x) => (x < 6 ? 10 : 10 + 3 * (x - 6)));
    const whole = trendSlope(t, y);
    expect(whole).toBeGreaterThan(0);
    expect(whole).toBeLessThan(3);
    // Passing pre-windowed points (what the caller now does) recovers the
    // windowed slope exactly.
    expect(trendSlope(t.slice(6), y.slice(6))).toBeCloseTo(3, 12);
  });

  it("is NaN when fewer than minPoints points are given", () => {
    const t = [0, 1, 2];
    const y = [0, 1, 2];
    expect(trendSlope(t, y)).toBeNaN(); // 3 points, default minPoints is 4
    expect(trendSlope(t, y, 2)).toBeCloseTo(1, 12); // an explicit lower minPoints accepts it
  });

  it("sorts by t before fitting, so out-of-order input gives the same result as sorted input", () => {
    const tSorted = Array.from({ length: 10 }, (_, i) => i);
    const ySorted = tSorted.map((x) => 4 - 0.5 * x);
    const perm = [5, 0, 9, 2, 7, 1, 8, 3, 6, 4];
    const tShuffled = perm.map((i) => tSorted[i]);
    const yShuffled = perm.map((i) => ySorted[i]);
    expect(trendSlope(tShuffled, yShuffled)).toBeCloseTo(trendSlope(tSorted, ySorted), 12);
    expect(trendSlope(tShuffled, yShuffled)).toBeCloseTo(-0.5, 12);
  });

  it("handles sparse, unevenly spaced points (deep-census steps) the same as dense ones", () => {
    const deepSteps = Array.from({ length: 6 }, (_, i) => i * 500);
    const values = deepSteps.map((s) => 1 + s * 0.001);
    expect(trendSlope(deepSteps, values)).toBeCloseTo(0.001, 9);
  });
});

describe("wilcoxonSignedRank (held-out observables: absolute-trend test)", () => {
  it("exact: a strictly increasing all-positive sample gives the single most extreme sign pattern", () => {
    // n=5, no ties: only the all-positive sign assignment reaches the
    // maximal W+ = 15, out of 2^5 = 32 equally likely assignments under the
    // null -- pGreater = 1/32 exactly.
    const r = wilcoxonSignedRank([1, 2, 3, 4, 5]);
    expect(r.exact).toBe(true);
    expect(r.n).toBe(5);
    expect(r.W).toBe(15);
    expect(r.pGreater).toBeCloseTo(1 / 32, 12);
  });

  it("exact: tie handling via midranks (hand-checked distribution)", () => {
    // |2|, |2|, |-2| all tie at midrank 2 each; W+ = 4 (the two +2's).
    // Doubled-rank DP over {+-4,+-4,+-4}: sums {0,4,8,12} with multiplicities
    // {1,3,3,1} out of 8 total -- P(W+' >= 4) = (3+3+1)/8 = 7/8... but the
    // *observed* doubled sum is 8 (2*4), so pGreater = P(>=8) = (3+1)/8 = 0.5.
    const r = wilcoxonSignedRank([2, 2, -2]);
    expect(r.exact).toBe(true);
    expect(r.W).toBeCloseTo(4, 12);
    expect(r.pGreater).toBeCloseTo(0.5, 12);
  });

  it("drops exact zeros (standard Wilcoxon convention), shrinking n", () => {
    const r = wilcoxonSignedRank([0, 0, 3]);
    expect(r.n).toBe(1);
    expect(r.pGreater).toBeCloseTo(0.5, 12); // a single observation is minimal evidence either way
  });

  it("is p=1 (not an error) when every value is exactly zero", () => {
    const r = wilcoxonSignedRank([0, 0]);
    expect(r.n).toBe(0);
    expect(r.p).toBe(1);
    expect(r.pGreater).toBe(1);
  });

  it("normal approximation: a clearly positive sample is significant, a balanced one is not", () => {
    const positive = Array.from({ length: 30 }, (_, i) => 1 + i);
    expect(wilcoxonSignedRank(positive, "normal").pGreater).toBeLessThan(0.001);
    const balanced = [3, -3, 1, -1, 5, -5, 2, -2, 4, -4, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10, 11, -11, 12, -12, 13, -13, 14, -14, 15, -15];
    expect(wilcoxonSignedRank(balanced, "normal").pGreater).toBeCloseTo(0.5, 6);
  });
});

import { scheduledTrend } from "@bl/metrics";

describe("scheduledTrend (held-out observables: the windowing/exclusion helper)", () => {
  it("every census (deepOnly=false): fits the second half exactly, review's off-by-one case", () => {
    // Review finding #5 (round 2): the short-window guard is `half.length <
    // minPoints`, i.e. `ceil(n/2) >= minPoints` -- with the default
    // minPoints=4, 6 scheduled censuses is short (ceil(6/2)=3), 7 is not
    // (ceil(7/2)=4). Probed by the reviewer directly; pinned here.
    const steps6 = Array.from({ length: 6 }, (_, i) => i);
    expect(scheduledTrend(steps6, steps6, 10, false).status).toBe("short");
    const steps7 = Array.from({ length: 7 }, (_, i) => i);
    const values7 = steps7.map((s) => 2 * s);
    const r7 = scheduledTrend(steps7, values7, 10, false);
    expect(r7.status).toBe("ok");
    expect(r7.slope).toBeCloseTo(2, 12);
  });

  it("deepOnly=true: only positions where index % deepEvery === 0 are scheduled", () => {
    // 20 censuses, deepEvery=5 -> deep positions 0,5,10,15 (4 total); second
    // half (of those 4) is positions 10,15 -- too few for the default
    // minPoints=4, so this case lowers it to illustrate the mechanism.
    const steps = Array.from({ length: 20 }, (_, i) => i * 100);
    const values = steps.map((s, i) => (i % 5 === 0 ? s * 0.01 : undefined));
    const r = scheduledTrend(steps, values, 5, true, 2);
    expect(r.status).toBe("ok");
    expect(r.slope).toBeCloseTo(0.01, 9); // fit is over (step=1000,value=10) and (step=1500,value=15)
  });

  it("a missing scheduled observation excludes the run, rather than shrinking the window", () => {
    const steps = Array.from({ length: 12 }, (_, i) => i);
    const values: (number | undefined)[] = steps.map((s) => s);
    // Blank out one value inside the second-half window (positions 6..11).
    values[8] = undefined;
    const r = scheduledTrend(steps, values, 10, false);
    expect(r.status).toBe("excluded");
    expect(r.slope).toBeNaN();
  });

  it("a missing observation *outside* the fit window doesn't matter", () => {
    const steps = Array.from({ length: 12 }, (_, i) => i);
    const values: (number | undefined)[] = steps.map((s) => s);
    values[1] = undefined; // outside the second-half window (positions 6..11)
    const r = scheduledTrend(steps, values, 10, false);
    expect(r.status).toBe("ok");
    expect(r.slope).toBeCloseTo(1, 12);
  });

  it("non-deep gaps are expected, not exclusions, when deepOnly=true", () => {
    // deepEvery=4: positions 0,4,8,12,16,20 are deep; the rest are undefined
    // (an ordinary non-deep gap) and must not count as "missing".
    const steps = Array.from({ length: 24 }, (_, i) => i);
    const values: (number | undefined)[] = steps.map((s, i) => (i % 4 === 0 ? s : undefined));
    const r = scheduledTrend(steps, values, 4, true, 3);
    expect(r.status).toBe("ok");
  });
});

describe("growth classification (review 3)", () => {
  it("returns indeterminate when neither pre-registered criterion holds", () => {
    const t = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const y = [0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3];
    const g = growthVsSaturation(t, y);
    expect(g.deltaAIC).toBeLessThan(2);
    expect(g.verdict).toBe("indeterminate");
  });
  it("handles very long histories without argument-spread limits", () => {
    const t = Array.from({ length: 200_000 }, (_, i) => i);
    expect(() => growthVsSaturation(t, t)).not.toThrow();
  });
});

describe("activity (review 3)", () => {
  it("requires strict exceedance of the neutral threshold", () => {
    const a = new ActivityTracker(1);
    expect(a.update(1, [["x", 1]]).significant).toBe(0);
    expect(a.update(2, [["x", 1]]).significant).toBe(1);
  });
  it("saved states are immutable snapshots and restore long histories", () => {
    const a = new ActivityTracker(5);
    a.update(1, [["x", 3]]);
    const saved = a.toJSON();
    const b = ActivityTracker.fromJSON(saved);
    b.update(2, [["x", 3]]);
    const c = ActivityTracker.fromJSON(saved);
    c.update(2, [["x", 3]]);
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(c.toJSON()));
    const big = { ...saved, extinct: new Array(200_000).fill(1) };
    expect(() => ActivityTracker.fromJSON(big)).not.toThrow();
  });
});

import { holm, mannWhitney as mw, Tracker } from "@bl/metrics";

describe("review 4", () => {
  it("one-sided Mann–Whitney p and Holm adjustment", () => {
    const hi = [5, 6, 7, 8, 9, 10], lo = [1, 2, 3, 4, 5, 6];
    const r = mw(hi, lo);
    expect(r.pGreater).toBeLessThan(0.05);
    expect(r.exact).toBe(true);
    expect(mw([1, 1, 1, 1], [0, 0, 0, 0]).pGreater).toBeCloseTo(1 / 70, 12);
    expect(mw(lo, hi).pGreater).toBeGreaterThan(0.95);
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
  });
  it("records very large event batches without argument-spread limits", () => {
    const t = new Tracker();
    const labels = new Int32Array(300_000).map((_, i) => i);
    const comps = Array.from({ length: 300_000 }, (_, i) => ({ idx: i, cells: 1, mass: 1000, biomass: 1000, cx: i, cy: 0, tile: 0, lineage: "1:1", purity: 1, mu: 60, sigma: 20 }));
    // deno-lint-ignore no-explicit-any
    t.update({ step: 1, labels, components: comps, lineages: [], livingCells: 0 } as any);
    // deno-lint-ignore no-explicit-any
    expect(() => t.update({ step: 2, labels: new Int32Array(300_000).fill(-1), components: [], lineages: [], livingCells: 0 } as any)).not.toThrow();
    expect(t.eventCounts().death).toBe(300_000);
  });
  it("rejects malformed observer state instead of restoring it", () => {
    // deno-lint-ignore no-explicit-any
    const bad: any[] = [null, {}, { ...new Tracker().toJSON(), nextId: -1 }, { ...new Tracker().toJSON(), alive: [{ id: 5 }] }];
    for (const b of bad) expect(() => Tracker.fromJSON(b)).toThrow();
    expect(() => Tracker.fromJSON(new Tracker().toJSON())).not.toThrow();
    // deno-lint-ignore no-explicit-any
    expect(() => ActivityTracker.fromJSON({ threshold: null, comps: [["x", {}]], cumulativeNew: 0, extinct: [] } as any)).toThrow();
  });
});

import { binomialLowerBound } from "@bl/metrics";

describe("Clopper–Pearson lower bound", () => {
  it("matches closed forms and known values", () => {
    // k = n: the bound solves p^n = alpha.
    expect(binomialLowerBound(16, 16)).toBeCloseTo(0.05 ** (1 / 16), 6);
    expect(binomialLowerBound(0, 16)).toBe(0);
    // 15/16 at one-sided 95% (Beta(15, 2) 5th percentile).
    expect(binomialLowerBound(15, 16)).toBeCloseTo(0.7358, 3);
  });
});

import { passesProbabilityGate } from "@bl/metrics";

describe("probability gates after M3 (32 replicates, lower bound)", () => {
  it("tolerates two failures in 32 at p > 0.8 but not three", () => {
    expect(passesProbabilityGate(32, 32, 0.8)).toBe(true);
    expect(passesProbabilityGate(30, 32, 0.8)).toBe(true);
    expect(passesProbabilityGate(29, 32, 0.8)).toBe(false);
  });

  it("needs the full replicate count: a perfect 16 of 16 is not enough", () => {
    expect(passesProbabilityGate(16, 16, 0.8)).toBe(false);
    expect(passesProbabilityGate(16, 16, 0.8, 16)).toBe(true);
    expect(passesProbabilityGate(15, 16, 0.8, 16)).toBe(false);
  });
});
