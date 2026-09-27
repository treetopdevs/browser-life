import { describe, expect, it } from "vitest";
import { holm } from "@bl/metrics";
import {
  coexistenceDurations,
  coexistenceQualifies,
  evaluateEndpoint,
  evaluateHeldOut,
  HELD_OUT_MIN_SUPPORTED,
  HELD_OUT_PRESET_CONTROLS,
  HELD_OUT_SPECS,
  PRIMARY_ENDPOINTS,
  type CoexistenceEndpoint,
  type CoexistenceResult,
  type Endpoint,
  type HeldOutSpec,
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

// ---- held-out observables (experiments/endpoints.ts: HELD_OUT_SPECS) ----
// 2026-09-26 amendment: absolute (one-sample exact Wilcoxon signed-rank) +
// relative (Mann-Whitney vs. every *declared* control) both required;
// controls declared per preset; only 4 of 6 observables are directional
// (count toward ">= 2 of 4"); one shared, FIXED-size Holm family across
// every test of every directional observable (round-2 review fix: the
// family must not shrink just because some observable lacks data).

const DIRECTIONAL_IDS = HELD_OUT_SPECS.filter((s) => s.directional).map((s) => s.id);
const DESCRIPTIVE_IDS = HELD_OUT_SPECS.filter((s) => !s.directional).map((s) => s.id);

/** The declared family size for a preset: #directional * (1 absolute + #declared controls). */
const familySizeFor = (preset: "gradient-m3" | "spots-m3") => DIRECTIONAL_IDS.length * (1 + HELD_OUT_PRESET_CONTROLS[preset].length);

/**
 * `n` seeds/condition, treatment strictly above every declared `preset`
 * control by monotonic, evenly-spaced values -- the most extreme separation
 * `n` seeds can produce, to make exact p-values as small as possible. At
 * n=15 this clears alpha=0.01 after the shared, FIXED-size Holm family
 * (round-2: the fixed family is harsher than the old shrinking one, since
 * every other directional observable's unavailable slots still occupy
 * space in it -- this file's "is supported" tests verify the margin isn't
 * accidental even when only one or two observables actually have data).
 */
function fullySeparated(statistic: string, preset: "gradient-m3" | "spots-m3", n = 15): RunView[] {
  const treat = Array.from({ length: n }, (_, i) => run("treatment", i, 10 + i, statistic));
  const controls = HELD_OUT_PRESET_CONTROLS[preset].flatMap((c) => Array.from({ length: n }, (_, i) => run(c, i, i, statistic)));
  return [...treat, ...controls];
}

describe("HELD_OUT_PRESET_CONTROLS / HELD_OUT_SPECS shape", () => {
  it("declares gradient-m3 and spots-m3's control sets per the amendment (fixed-env in neither)", () => {
    expect(HELD_OUT_PRESET_CONTROLS["gradient-m3"]).toEqual(["neutral", "no-mutation", "uniform-light", "replenished", "no-signal-motility"]);
    expect(HELD_OUT_PRESET_CONTROLS["spots-m3"]).toEqual(["neutral", "no-mutation", "replenished", "no-signal-motility"]);
    expect(HELD_OUT_PRESET_CONTROLS["gradient-m3"]).not.toContain("fixed-env");
    expect(HELD_OUT_PRESET_CONTROLS["spots-m3"]).not.toContain("fixed-env");
  });

  it("has 6 observables, unique ids, exactly 4 directional (amends '>= 2 of 6' to '>= 2 of 4')", () => {
    expect(HELD_OUT_SPECS).toHaveLength(6);
    expect(new Set(HELD_OUT_SPECS.map((s) => s.id)).size).toBe(6);
    expect(DIRECTIONAL_IDS).toEqual(["held-out-temporal-mi", "held-out-differentiation", "held-out-compartmentalised", "held-out-role-count"]);
    expect(DESCRIPTIVE_IDS).toEqual(["held-out-pattern-entropy", "held-out-lineage-compression"]);
  });

  it("the declared family sizes match the amendment's stated numbers: 24 for gradient-m3, 20 for spots-m3", () => {
    expect(familySizeFor("gradient-m3")).toBe(24);
    expect(familySizeFor("spots-m3")).toBe(20);
  });
});

describe("evaluateHeldOut: preset-declared controls (amendment point 2)", () => {
  it("every observable is unavailable for an undeclared preset, not silently evaluated", () => {
    const views = fullySeparated(HELD_OUT_SPECS[0].statistic, "spots-m3");
    const { results, summary } = evaluateHeldOut(views, "seasons"); // not (yet) a registered preset
    expect(summary.presetDeclared).toBe(false);
    expect(summary.controls).toEqual([]);
    expect(summary.familySize).toBe(0); // no declared controls to size the family against
    expect(results.every((r) => !r.available && !r.supported)).toBe(true);
    expect(summary.outcome).toBe("unavailable"); // not a plain "no": the preset simply isn't declared
  });

  it("is unavailable (not merely unsupported) when a declared control has no runs at all -- never a smaller family", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const views = fullySeparated(spec.statistic, "spots-m3").filter((v) => v.condition !== "replenished"); // one declared spots-m3 control missing
    const { results, summary } = evaluateHeldOut(views, "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.relative.complete).toBe(false);
    expect(r.available).toBe(false);
    expect(r.supported).toBe(false); // even though the other 3 controls are fully beaten
    expect(summary.familySize).toBe(familySizeFor("spots-m3")); // round-2 fix: still the full fixed size, not shrunk
  });

  it("is unavailable when a declared control has fewer than 2 runs, not a partially-evaluated family", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const views = fullySeparated(spec.statistic, "spots-m3").filter((v) => !(v.condition === "no-mutation" && v.seed > 0)); // 1 run left
    const { results, summary } = evaluateHeldOut(views, "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.relative.rows.find((row) => row.b === "no-mutation")!.available).toBe(false);
    expect(r.relative.complete).toBe(false);
    expect(r.available).toBe(false);
    expect(summary.familySize).toBe(familySizeFor("spots-m3"));
  });
});

describe("evaluateHeldOut: absolute + relative, both required (amendment point 1)", () => {
  it("is supported when treatment clearly increases and clearly beats every declared control", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const views = fullySeparated(spec.statistic, "spots-m3");
    const { results } = evaluateHeldOut(views, "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.available).toBe(true);
    expect(r.absolute!.method).toBe("exact");
    expect(r.absolute!.supported).toBe(true);
    expect(r.relative.rows.every((row) => row.supported)).toBe(true);
    expect(r.supported).toBe(true);
  });

  // Reviewer counterexample #1: relative superiority without an absolute
  // increase used to pass. Treatment's own slopes are all clearly negative
  // (declining), even though far less negative than the controls' --
  // relative (b) is satisfied, but this must not be "supported".
  it("is NOT supported when treatment declines, even if slower than every control", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const n = 9;
    const treat = Array.from({ length: n }, (_, i) => run("treatment", i, -1 - i, spec.statistic)); // -1..-9
    const controls = HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((c) => Array.from({ length: n }, (_, i) => run(c, i, -20 - i, spec.statistic))); // -20..-28
    const { results } = evaluateHeldOut([...treat, ...controls], "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.relative.rows.every((row) => row.supported)).toBe(true); // (b) alone would have passed
    expect(r.absolute!.supported).toBe(false); // (a) correctly fails: treatment's own slopes are negative
    expect(r.supported).toBe(false);
  });

  // Reviewer counterexample #2: treatment flat while controls decline.
  it("is NOT supported when treatment is flat (slopes balanced around zero), even if controls decline", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const treat = [0.4, -0.4, 0.3, -0.3, 0.5, -0.5, 0.2, -0.2, 0.1].map((x, i) => run("treatment", i, x, spec.statistic));
    const controls = HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((c) => Array.from({ length: 9 }, (_, i) => run(c, i, -10 - i, spec.statistic)));
    const { results } = evaluateHeldOut([...treat, ...controls], "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.absolute!.p).toBeGreaterThan(0.1); // no evidence treatment's own slope is positive
    expect(r.absolute!.supported).toBe(false);
    expect(r.supported).toBe(false);
  });

  it("drops non-finite (NaN/excluded) runs from both the absolute and relative sample sizes, without throwing", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const views = fullySeparated(spec.statistic, "spots-m3");
    const withNaNs = [
      ...views,
      run("treatment", 100, NaN, spec.statistic),
      run("treatment", 101, NaN, spec.statistic),
      run("no-mutation", 100, NaN, spec.statistic),
    ];
    const { results } = evaluateHeldOut(withNaNs, "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.absolute!.n).toBe(15); // the 2 NaN treatment runs are excluded, not counted
    expect(r.relative.rows.find((row) => row.b === "no-mutation")!.nB).toBe(15); // the 1 NaN control run is excluded
    expect(r.supported).toBe(true); // unaffected otherwise -- same as the fully-clean case
  });

  it("a non-directional (descriptive) observable is never supported, however extreme its separation", () => {
    const spec = HELD_OUT_SPECS.find((s) => !s.directional)!;
    const views = fullySeparated(spec.statistic, "spots-m3");
    const { results } = evaluateHeldOut(views, "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.absolute).toBeNull();
    expect(r.relative.rows.length).toBeGreaterThan(0); // still reported, descriptively
    expect(r.supported).toBe(false);
  });

  // Round-2 review finding #3: the endpoint must force the *exact* Wilcoxon
  // method (decision 1), refusing rather than silently approximating when
  // the sample size exceeds what the exact method can compute.
  it("forces the exact Wilcoxon method, and refuses (marks unavailable) rather than approximate above EXACT_MAX", () => {
    const spec = HELD_OUT_SPECS.find((s) => s.directional)!;
    const n = 61; // one past EXACT_MAX=60
    const treat = Array.from({ length: n }, (_, i) => run("treatment", i, 1 + i, spec.statistic));
    const controls = HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((c) => Array.from({ length: 2 }, (_, i) => run(c, i, 0, spec.statistic)));
    const { results } = evaluateHeldOut([...treat, ...controls], "spots-m3");
    const r = results.find((x) => x.id === spec.id)!;
    expect(r.absolute!.available).toBe(false);
    expect(r.absolute!.method).toBeNull();
    expect(r.absolute!.n).toBe(0); // not computed at all -- never silently approximated
  });
});

describe("evaluateHeldOut: one shared, FIXED-size Holm family across every directional test (amendment point 4, round-2 fix)", () => {
  it("pAdj values match holm() applied once to the fixed-size pooled family (unavailable slots at p=1), not once per observable, and not only over decidable observables", () => {
    // A deliberately mixed ensemble: one observable's data is fully
    // separated, another's is middling, another's is flat/negative, and one
    // is entirely unavailable (too few runs) -- the fixed family must still
    // include a slot for every test of every directional observable.
    const [a, b, c, d] = DIRECTIONAL_IDS.map((id) => HELD_OUT_SPECS.find((s) => s.id === id)!);
    const views = [
      ...fullySeparated(a.statistic, "spots-m3"),
      ...Array.from({ length: 15 }, (_, i) => run("treatment", i, 1 + i * 0.1, b.statistic)),
      ...HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((cnd) => Array.from({ length: 15 }, (_, i) => run(cnd, i, i * 0.1, b.statistic))),
      ...Array.from({ length: 15 }, (_, i) => run("treatment", i, -1 - i, c.statistic)),
      ...HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((cnd) => Array.from({ length: 15 }, (_, i) => run(cnd, i, -2 - i, c.statistic))),
      ...Array.from({ length: 2 }, (_, i) => run("treatment", i, 1 + i, d.statistic)), // too few runs: unavailable, but STILL occupies its 5 slots at p=1
    ];
    const { results, summary } = evaluateHeldOut(views, "spots-m3");
    const directional = results.filter((r) => r.directional);
    expect(directional.find((r) => r.id === d.id)!.available).toBe(false);
    expect(summary.familySize).toBe(familySizeFor("spots-m3")); // 20, always -- not shrunk by d's unavailability

    // Reconstruct the expected pool independently, in the SAME fixed shape
    // the endpoint must produce: every directional observable contributes
    // exactly 1 (absolute) + controls.length (relative) slots, p=1 wherever
    // that specific slot lacks data.
    const rawPool: number[] = [];
    for (const r of directional) {
      rawPool.push(r.absolute!.available ? r.absolute!.p : 1);
      for (const row of r.relative.rows) rawPool.push(row.available ? row.p : 1);
    }
    const expectedAdj = holm(rawPool);
    const actualAdj: number[] = [];
    for (const r of directional) {
      actualAdj.push(r.absolute!.pAdj);
      for (const row of r.relative.rows) actualAdj.push(row.pAdj);
    }
    expect(rawPool.length).toBe(familySizeFor("spots-m3"));
    expect(actualAdj).toEqual(expectedAdj);
  });

  // The reviewer's round-2 repro, directly: losing one control's data for
  // one observable must NOT shrink the family (20 -> 15) or spuriously flip
  // an unrelated observable's established/unavailable status.
  it("losing one declared control's data for one observable does not shrink the family or change other observables' availability", () => {
    const [a, b, c] = DIRECTIONAL_IDS.map((id) => HELD_OUT_SPECS.find((s) => s.id === id)!);
    const full = [...fullySeparated(a.statistic, "spots-m3"), ...fullySeparated(b.statistic, "spots-m3"), ...fullySeparated(c.statistic, "spots-m3")];
    const { results: fullResults, summary: fullSummary } = evaluateHeldOut(full, "spots-m3");
    expect(fullSummary.familySize).toBe(familySizeFor("spots-m3"));
    const aBefore = fullResults.find((r) => r.id === a.id)!;
    const bBefore = fullResults.find((r) => r.id === b.id)!;
    expect(aBefore.available).toBe(true);
    expect(bBefore.available).toBe(true);

    // Reduce c's "no-mutation" sample to a single finite value (the
    // reviewer's exact repro shape) -- everything about a and b is
    // untouched.
    const damaged = full.filter((v) => !(v.condition === "no-mutation" && v.seed > 0 && v.stats[c.statistic] !== undefined));
    const { results: damagedResults, summary: damagedSummary } = evaluateHeldOut(damaged, "spots-m3");
    expect(damagedSummary.familySize).toBe(familySizeFor("spots-m3")); // still 20, not 15 -- the round-2 fix
    const aAfter = damagedResults.find((r) => r.id === a.id)!;
    const bAfter = damagedResults.find((r) => r.id === b.id)!;
    const cAfter = damagedResults.find((r) => r.id === c.id)!;
    // a and b's own availability is unaffected -- only c (whose control was
    // actually damaged) becomes unavailable.
    expect(aAfter.available).toBe(true);
    expect(bAfter.available).toBe(true);
    expect(cAfter.available).toBe(false);
    // The core regression: a and b's ESTABLISHED status (not merely their
    // exact pAdj, which may reasonably shift by a small, honest rank
    // adjustment when the family's *composition* changes) must not flip --
    // in particular, `supported` must not turn true as a side effect of c
    // losing data, mirroring the reviewer's exact complaint.
    expect(aAfter.supported).toBe(aBefore.supported);
    expect(bAfter.supported).toBe(bBefore.supported);
  });
});

describe("evaluateHeldOut: the three-valued outcome (round-2 fix, amendment point 2's spirit)", () => {
  it("is 'unavailable', not 'not-supported', when unavailable observables could still reach the threshold", () => {
    // Only one observable has any data at all; the other three are entirely
    // unavailable (no runs). Established count is at most 1 (< 2), but
    // 1 established + 3 unavailable = 4 >= 2, so the true answer could
    // still go either way once the missing runs exist.
    const views = fullySeparated(DIRECTIONAL_IDS.length ? HELD_OUT_SPECS.find((s) => s.id === DIRECTIONAL_IDS[0])!.statistic : "", "spots-m3");
    const { results, summary } = evaluateHeldOut(views, "spots-m3");
    expect(results).toHaveLength(6);
    expect(summary.total).toBe(4);
    expect(summary.minSupported).toBe(HELD_OUT_MIN_SUPPORTED);
    expect(summary.establishedCount).toBe(1);
    expect(summary.unavailableCount).toBe(3);
    expect(summary.outcome).toBe("unavailable");
    expect(summary.supported).toBe(false); // the boolean convenience field: only true for "supported"
  });

  it("is 'supported' once at least 2 (of the 4 directional) observables are established -- never combined into one score, just counted", () => {
    const [a, b] = DIRECTIONAL_IDS.map((id) => HELD_OUT_SPECS.find((s) => s.id === id)!);
    const views = [...fullySeparated(a.statistic, "spots-m3"), ...fullySeparated(b.statistic, "spots-m3")];
    const { summary } = evaluateHeldOut(views, "spots-m3");
    expect(summary.establishedCount).toBe(2);
    expect(summary.outcome).toBe("supported");
    expect(summary.supported).toBe(true);
  });

  it("is 'not-supported' (a genuine negative), not 'unavailable', when every directional observable is fully evaluated and refuted", () => {
    // All 4 directional observables have full data (available) on both
    // treatment and every declared control, but the data shows no trend at
    // all -- a fully-informative negative, not missing evidence.
    const flatViews = HELD_OUT_SPECS.filter((s) => s.directional).flatMap((spec) => [
      ...[0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.0].map((x, i) => run("treatment", i, x, spec.statistic)),
      ...HELD_OUT_PRESET_CONTROLS["spots-m3"].flatMap((c) => [0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.0].map((x, i) => run(c, i, x, spec.statistic))),
    ]);
    const { results, summary } = evaluateHeldOut(flatViews, "spots-m3");
    const directional = results.filter((r) => r.directional);
    expect(directional.every((r) => r.available)).toBe(true); // fully evaluated, not missing data
    expect(directional.every((r) => !r.supported)).toBe(true); // and none of it clears alpha
    expect(summary.establishedCount).toBe(0);
    expect(summary.unavailableCount).toBe(0);
    expect(summary.refutedCount).toBe(4);
    expect(summary.outcome).toBe("not-supported");
  });

  it("with no data at all, every observable is unavailable and the outcome is 'unavailable' (not a plain no)", () => {
    const { results, summary } = evaluateHeldOut([], "spots-m3");
    expect(results.every((r) => !r.available)).toBe(true);
    expect(summary.establishedCount).toBe(0);
    expect(summary.unavailableCount).toBe(4);
    expect(summary.outcome).toBe("unavailable");
    expect(summary.supported).toBe(false);
  });
});

// Round-3 review finding: `establishedCount + unavailableCount < minSupported`
// is NOT a valid basis for "not-supported". Completing a *different*
// observable's missing data changes that data's own rank in the shared,
// fixed-size Holm family, which can shift every *other* observable's
// multiplier too -- so an already-available observable's own adjusted p can
// improve purely because an unrelated observable's data arrives, with
// neither observable's raw numbers touched. `outcome` must use an
// optimistic recomputation (`summary.optimisticCount`: every missing slot
// substituted at p=0, the most favorable value) to decide whether reaching
// `minSupported` is still genuinely possible, not the conservative sum.
describe("evaluateHeldOut: optimistic upper bound for 'not-supported' (round-3 fix)", () => {
  /**
   * The reviewer's exact repro shape, parameterised by preset/n so it can be
   * run at both registered sample sizes: A/B/C strongly separated
   * (treatment `10..10+n-1`, every declared control `-20..-20+n-1`); D null
   * (treatment identical to the control range -- no separation at all).
   * `cIncludesTreatment=false` removes only C's own treatment measurements
   * (C's controls are untouched), matching "remove only C's treatment
   * measurements" from the review exactly.
   */
  function reproViews(preset: "gradient-m3" | "spots-m3", n: number, cIncludesTreatment: boolean) {
    const [A, B, C, D] = DIRECTIONAL_IDS.map((id) => HELD_OUT_SPECS.find((s) => s.id === id)!);
    const strong = (spec: HeldOutSpec, includeTreatment: boolean) => [
      ...(includeTreatment ? Array.from({ length: n }, (_, i) => run("treatment", i, 10 + i, spec.statistic)) : []),
      ...HELD_OUT_PRESET_CONTROLS[preset].flatMap((c) => Array.from({ length: n }, (_, i) => run(c, i, -20 + i, spec.statistic))),
    ];
    const nullObservable = (spec: HeldOutSpec) => [
      ...Array.from({ length: n }, (_, i) => run("treatment", i, -20 + i, spec.statistic)),
      ...HELD_OUT_PRESET_CONTROLS[preset].flatMap((c) => Array.from({ length: n }, (_, i) => run(c, i, -20 + i, spec.statistic))),
    ];
    return [...strong(A, true), ...strong(B, true), ...strong(C, cIncludesTreatment), ...nullObservable(D)];
  }

  function expectNoPrematureNegative(preset: "gradient-m3" | "spots-m3", n: number) {
    const missing = evaluateHeldOut(reproViews(preset, n, false), preset).summary;
    // Matches the reviewer's own reproduction: under the conservative
    // (p=1-for-missing) family, fewer than minSupported are established --
    // but that must NOT be read as "not-supported", because completing C
    // could still bring the total to >= minSupported.
    expect(missing.establishedCount).toBeLessThan(HELD_OUT_MIN_SUPPORTED);
    expect(missing.optimisticCount).toBeGreaterThanOrEqual(HELD_OUT_MIN_SUPPORTED);
    expect(missing.outcome).toBe("unavailable");
    expect(missing.outcome).not.toBe("not-supported"); // the core regression

    const restored = evaluateHeldOut(reproViews(preset, n, true), preset).summary;
    expect(restored.establishedCount).toBeGreaterThanOrEqual(HELD_OUT_MIN_SUPPORTED);
    expect(restored.outcome).toBe("supported");
  }

  it("spots-m3, 10 seeds (the reviewer's own sample size): stays 'unavailable', not a premature 'not-supported'", () => {
    expectNoPrematureNegative("spots-m3", 10);
  });

  it("gradient-m3, 10 seeds/condition (gradient-m3's larger 5-control family still shows the same effect): same fix holds at the other registered preset", () => {
    // Gradient's declared family is bigger (24 tests, 5 controls, vs.
    // spots-m3's 20/4), so it takes a different n to land in the same
    // "borderline" zone the reviewer demonstrated; 10 seeds/condition here
    // reproduces the same qualitative shape (fewer than minSupported
    // established while C is missing, still not a valid "not-supported").
    expectNoPrematureNegative("gradient-m3", 10);
  });

  it("an undeclared preset is always 'unavailable', never 'not-supported', even though optimisticCount defaults to 0 there", () => {
    // Guards the `!presetDeclared` special case explicitly: without a known
    // control set there is no family to even bound optimistically, so this
    // must not fall through to "not-supported" just because optimisticCount
    // is trivially 0 for want of any pool at all.
    const { summary } = evaluateHeldOut(reproViews("spots-m3", 10, true), "seasons");
    expect(summary.presetDeclared).toBe(false);
    expect(summary.optimisticCount).toBe(0);
    expect(summary.outcome).toBe("unavailable");
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
