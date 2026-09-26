import { describe, expect, it } from "vitest";
import {
  coexistenceDurations,
  coexistenceQualifies,
  evaluateEndpoint,
  PRIMARY_ENDPOINTS,
  type CoexistenceEndpoint,
  type CoexistenceResult,
  type Endpoint,
  type RunView,
  type TestResult,
  type ThresholdEndpoint,
  type ThresholdResult,
} from "../endpoints.ts";

// ---- coexistence duration ----

describe("coexistenceDurations", () => {
  it("measures the span between the first and last qualifying deep census", () => {
    const series = [
      { step: 1000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 2000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 3000, rolesPresent: ["phototroph", "decomposer"] },
    ];
    expect(coexistenceDurations(series, 2)).toEqual([2000]);
  });

  it("skips non-deep censuses (no rolesPresent) without breaking a run", () => {
    const series = [
      { step: 1000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 1100 }, // ordinary census, no role data
      { step: 1200 }, // ordinary census, no role data
      { step: 2000, rolesPresent: ["phototroph", "decomposer"] },
    ];
    expect(coexistenceDurations(series, 2)).toEqual([1000]);
  });

  it("breaks the run when a deep census drops below the role threshold", () => {
    const series = [
      { step: 1000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 2000, rolesPresent: ["phototroph"] }, // only 1 role: breaks the run
      { step: 3000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 4000, rolesPresent: ["phototroph", "decomposer"] },
    ];
    // step 1000 is an isolated qualifying census (duration 0), then 3000..4000 is a real run.
    expect(coexistenceDurations(series, 2)).toEqual([0, 1000]);
  });

  it("a single isolated qualifying deep census has duration 0", () => {
    const series = [
      { step: 1000, rolesPresent: ["phototroph"] },
      { step: 2000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 3000, rolesPresent: ["phototroph"] },
    ];
    expect(coexistenceDurations(series, 2)).toEqual([0]);
  });

  it("sorts out-of-order input by step", () => {
    const series = [
      { step: 2000, rolesPresent: ["phototroph", "decomposer"] },
      { step: 1000, rolesPresent: ["phototroph", "decomposer"] },
    ];
    expect(coexistenceDurations(series, 2)).toEqual([1000]);
  });

  it("is empty when there is no deep data at all, or no deep census ever qualifies", () => {
    expect(coexistenceDurations([{ step: 100 }, { step: 200 }], 2)).toEqual([]);
    expect(coexistenceDurations([{ step: 1000, rolesPresent: ["phototroph"] }], 2)).toEqual([]);
  });

  it("boundary: exactly 1e5 qualifies, one step short does not", () => {
    const exact = [
      { step: 0, rolesPresent: ["phototroph", "decomposer"] },
      { step: 1e5, rolesPresent: ["phototroph", "decomposer"] },
    ];
    expect(coexistenceQualifies(exact, 2, 1e5)).toBe(true);
    const short = [
      { step: 0, rolesPresent: ["phototroph", "decomposer"] },
      { step: 1e5 - 1, rolesPresent: ["phototroph", "decomposer"] },
    ];
    expect(coexistenceQualifies(short, 2, 1e5)).toBe(false);
  });
});

// ---- endpoint verdicts on synthetic ensembles ----

const run = (condition: string, seed: number, x: number, statistic = "bioticRecycling"): RunView => ({
  condition,
  seed,
  stats: { [statistic]: x },
  series: [],
});

describe("evaluateEndpoint: test (Mann-Whitney + Holm)", () => {
  it("4 vs 4 all-ones vs all-zeros: exact p is extreme but the tiny sample fails alpha after Holm", () => {
    // Reuses the shipped "adaptive-activity" endpoint (two comparisons, both
    // maximally separated) rather than a synthetic endpoint definition, so
    // this test exercises the exact spec tools/analyze.ts executes.
    const endpoint = PRIMARY_ENDPOINTS.find((e) => e.id === "adaptive-activity")!;
    expect(endpoint.kind).toBe("test");
    const treatment = [1, 1, 1, 1].map((x, i) => ({ condition: "treatment", seed: i, stats: { cumulativeNewActivity: x }, series: [] }));
    const neutral = [0, 0, 0, 0].map((x, i) => ({ condition: "neutral", seed: i, stats: { cumulativeNewActivity: x }, series: [] }));
    const noMutation = [0, 0, 0, 0].map((x, i) => ({ condition: "no-mutation", seed: i, stats: { cumulativeNewActivity: x }, series: [] }));
    const result = evaluateEndpoint(endpoint, [...treatment, ...neutral, ...noMutation]) as TestResult;
    expect(result.complete).toBe(true);
    for (const row of result.rows) {
      expect(row.available).toBe(true);
      // The exact one-sided p for 4-vs-4 fully separated samples is 1/70.
      expect(row.p).toBeCloseTo(1 / 70, 12);
      // Holm across 2 equally-extreme comparisons multiplies by 2: 2/70 ~= 0.0286.
      expect(row.pAdj).toBeCloseTo(2 / 70, 12);
      expect(row.pAdj).toBeLessThan(0.05);
      // ... but it does NOT clear the pre-registered alpha = 0.01.
      expect(row.pAdj).toBeGreaterThan(endpoint.alpha);
      expect(row.supported).toBe(false);
    }
  });

  it("marks a comparison unavailable (not merely non-significant) with fewer than 2 runs per side", () => {
    const endpoint = PRIMARY_ENDPOINTS.find((e) => e.id === "ecological-closure-recycling")!;
    const views = [run("treatment", 1, 0.9), run("replenished", 1, 0.1)]; // 1 run per side
    const result = evaluateEndpoint(endpoint, views) as TestResult;
    expect(result.complete).toBe(false);
    expect(result.rows[0].available).toBe(false);
    expect(result.rows[0].supported).toBe(false);
  });

  it("supports a clearly separated, adequately sized comparison", () => {
    const endpoint = PRIMARY_ENDPOINTS.find((e) => e.id === "ecological-closure-recycling")!;
    const treat = [0.9, 0.85, 0.92, 0.88, 0.91, 0.87].map((x, i) => run("treatment", i, x));
    const repl = [0.1, 0.15, 0.12, 0.08, 0.11, 0.07].map((x, i) => run("replenished", i, x));
    const result = evaluateEndpoint(endpoint, [...treat, ...repl]) as TestResult;
    expect(result.rows[0].supported).toBe(true);
  });

  // Review 1 finding #9: `pLess` used to be computed as `1 - pGreater`, which
  // is not the true lower-tail probability -- the exact method's two tails
  // are each *inclusive* of the observed statistic and so share probability
  // mass with each other, they don't sum to 1. No shipped endpoint currently
  // uses "pLess" (this is a synthetic one), but the module's contract must
  // still be correct.
  it("computes a true lower-tail p, not 1 - pGreater (identical samples: p should be 1, not 0)", () => {
    const pLessEndpoint: Endpoint = {
      id: "synthetic-pless",
      kind: "test",
      statistic: "x",
      comparisons: [{ a: "a", b: "b", relation: "pLess" }],
      alpha: 0.01,
      description: "synthetic",
    };
    const identical = [
      ...[0, 0, 0, 0].map((x, i) => ({ condition: "a", seed: i, stats: { x }, series: [] })),
      ...[0, 0, 0, 0].map((x, i) => ({ condition: "b", seed: i, stats: { x }, series: [] })),
    ];
    const result = evaluateEndpoint(pLessEndpoint, identical) as TestResult;
    // `1 - pGreater` would give exactly 0 here (pGreater is 1 for identical
    // samples); the true lower-tail p-value for two identical samples is 1.
    expect(result.rows[0].p).toBeCloseTo(1, 12);
    expect(result.rows[0].supported).toBe(false);
  });
});

describe("evaluateEndpoint: threshold (growth verdict majority/minority)", () => {
  const endpoint = PRIMARY_ENDPOINTS.find((e) => e.id === "unbounded-growth")! as ThresholdEndpoint;

  it("is supported when treatment is majority-growing and neutral is minority-growing", () => {
    const views: RunView[] = [
      ...["growing", "growing", "growing", "flat"].map((trend, i) => ({ condition: "treatment", seed: i, stats: {}, trend: trend as RunView["trend"], series: [] })),
      ...["flat", "flat", "growing", "flat"].map((trend, i) => ({ condition: "neutral", seed: i, stats: {}, trend: trend as RunView["trend"], series: [] })),
    ];
    const result = evaluateEndpoint(endpoint, views) as ThresholdResult;
    expect(result.available).toBe(true);
    expect(result.supported).toBe(true);
  });

  it("is not supported when neutral is also majority-growing", () => {
    const views: RunView[] = [
      ...["growing", "growing", "growing", "flat"].map((trend, i) => ({ condition: "treatment", seed: i, stats: {}, trend: trend as RunView["trend"], series: [] })),
      ...["growing", "growing", "flat", "flat"].map((trend, i) => ({ condition: "neutral", seed: i, stats: {}, trend: trend as RunView["trend"], series: [] })),
    ];
    const result = evaluateEndpoint(endpoint, views) as ThresholdResult;
    expect(result.supported).toBe(false);
  });

  it("is unavailable with no runs in one of the groups", () => {
    const views: RunView[] = [{ condition: "treatment", seed: 0, stats: {}, trend: "growing", series: [] }];
    const result = evaluateEndpoint(endpoint, views) as ThresholdResult;
    expect(result.available).toBe(false);
  });

  // Review 1 finding #8: a run with no computed `trend` (uncalibrated
  // ensemble, or the classifier not yet run) used to count toward a group's
  // `total` without ever counting toward `qualifying`, so it was
  // indistinguishable from a run that *was* classified and simply found
  // non-growing -- silently reporting "Supported: no" for data that was
  // never actually measured, instead of "unavailable".
  it("is unavailable, not merely unsupported, when a run has no growth classification yet", () => {
    const views: RunView[] = [
      { condition: "treatment", seed: 0, stats: {}, trend: "growing", series: [] },
      { condition: "treatment", seed: 1, stats: {}, trend: undefined, series: [] }, // uncalibrated/uncomputed
      { condition: "treatment", seed: 2, stats: {}, trend: "growing", series: [] },
      { condition: "neutral", seed: 0, stats: {}, trend: "flat", series: [] },
    ];
    const result = evaluateEndpoint(endpoint, views) as ThresholdResult;
    expect(result.rows[0]).toMatchObject({ total: 3, classified: 2, qualifying: 2 });
    // Would otherwise report `holds: true` (2 of 3 is already a majority) and
    // `available: true` (every group non-empty) -- i.e. "Supported: yes" --
    // even though one treatment run was never actually classified.
    expect(result.available).toBe(false);
  });
});

describe("evaluateEndpoint: coexistence", () => {
  const endpoint = PRIMARY_ENDPOINTS.find((e) => e.id === "ecological-closure-coexistence")! as CoexistenceEndpoint;

  const qualifyingSeries = (roles: string[]) =>
    Array.from({ length: 101 }, (_, i) => ({ step: i * 1000, rolesPresent: roles })); // spans 1e5 steps

  it("supports the endpoint when a majority of treatment runs sustain >=2 roles for >=1e5 steps", () => {
    const views: RunView[] = [
      { condition: "treatment", seed: 1, stats: {}, series: qualifyingSeries(["phototroph", "decomposer"]) },
      { condition: "treatment", seed: 2, stats: {}, series: qualifyingSeries(["phototroph", "decomposer"]) },
      { condition: "treatment", seed: 3, stats: {}, series: [{ step: 0, rolesPresent: ["phototroph"] }] },
    ];
    const result = evaluateEndpoint(endpoint, views) as CoexistenceResult;
    expect(result.qualifying).toBe(2);
    expect(result.total).toBe(3);
    expect(result.supported).toBe(true);
  });

  it("does not support the endpoint when a majority fall short of the duration", () => {
    const views: RunView[] = [
      { condition: "treatment", seed: 1, stats: {}, series: qualifyingSeries(["phototroph", "decomposer"]) },
      { condition: "treatment", seed: 2, stats: {}, series: [{ step: 0, rolesPresent: ["phototroph"] }] },
      { condition: "treatment", seed: 3, stats: {}, series: [{ step: 0, rolesPresent: ["phototroph"] }] },
    ];
    const result = evaluateEndpoint(endpoint, views) as CoexistenceResult;
    expect(result.supported).toBe(false);
  });

  it("reports the M5 gate (>=3 roles) alongside, independently of the >=2-role verdict", () => {
    const views: RunView[] = [
      { condition: "treatment", seed: 1, stats: {}, series: qualifyingSeries(["phototroph", "decomposer"]) }, // 2 roles only
      { condition: "treatment", seed: 2, stats: {}, series: qualifyingSeries(["phototroph", "decomposer", "chemotroph"]) }, // 3 roles
    ];
    const result = evaluateEndpoint(endpoint, views) as CoexistenceResult;
    expect(result.supported).toBe(true); // both qualify for >=2 roles
    expect(result.gate).toBeDefined();
    expect(result.gate!.qualifying).toBe(1); // only the 3-role run clears the gate
    expect(result.gate!.supported).toBe(false); // not a majority
  });

  it("is unavailable (not supported) with no runs in the condition", () => {
    const result = evaluateEndpoint(endpoint, []) as CoexistenceResult;
    expect(result.total).toBe(0);
    expect(result.supported).toBe(false);
  });
});

describe("PRIMARY_ENDPOINTS", () => {
  it("has one description per entry and unique ids", () => {
    const ids = new Set<string>();
    for (const e of PRIMARY_ENDPOINTS as Endpoint[]) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });
});
