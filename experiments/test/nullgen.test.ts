// Tests for tools/lib/nullgen.ts / tools/lib/idhash.ts (docs/plan.md's "Gate
// calibration" note). Builds Run[] and calls tools/analyze.ts's own
// analyzeEnsemble directly (via buildEnsemble below) -- fast, file-free, no
// subprocess, and exercising the same analysis code the real CLI runs.
import { describe, expect, it } from "vitest";
import { ActivityTracker, mannWhitney, mean } from "@bl/metrics";
import { HELD_OUT_SPECS, PRIMARY_ENDPOINTS, type EndpointResult } from "../endpoints.ts";
import { analyzeEnsemble, type Run } from "../../tools/analyze.ts";
import {
  boundedTreatmentVsFlat,
  buildManifest,
  constantSanity,
  longPeriodLoop,
  makeSpec,
  neutralDrift,
  NULLCAL_CONDITIONS,
  NULL_GENERATOR_IDS,
  plantedSignal,
  randomWalkNoise,
  Rng,
  runNullGenerator,
  saturatingProcess,
  type Identity,
} from "../../tools/lib/nullgen.ts";
import { streamRng } from "../../tools/lib/idhash.ts";

const baseId = (over: Partial<Identity> = {}): Identity => ({
  masterSeed: 1,
  nullId: "longPeriodLoop",
  windowSteps: 2000,
  replicateIndex: 0,
  condition: "treatment",
  seedIndex: 0,
  ...over,
});
const spec = (steps = 2000) => makeSpec("nullgen-test", "treatment", 1, steps, 100, 10);

describe("determinism and replicate-distinctness", () => {
  for (const nullId of NULL_GENERATOR_IDS) {
    it(`${nullId}: same Identity twice -> byte-identical output`, () => {
      const id = baseId({ nullId });
      const a = runNullGenerator(nullId, id, spec(id.windowSteps));
      const b = runNullGenerator(nullId, id, spec(id.windowSteps));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it(`${nullId}: changing any one Identity field changes the output`, () => {
      const id = baseId({ nullId });
      const base = JSON.stringify(runNullGenerator(nullId, id, spec(id.windowSteps)));
      const variants: Partial<Identity>[] = [
        { masterSeed: id.masterSeed + 1 },
        { windowSteps: id.windowSteps + 500 },
        { replicateIndex: id.replicateIndex + 1 },
        { condition: "neutral" },
        { seedIndex: id.seedIndex + 1 },
      ];
      for (const v of variants) {
        const other = { ...id, ...v };
        const out = JSON.stringify(runNullGenerator(nullId, other, spec(other.windowSteps)));
        expect(out).not.toBe(base);
      }
      // nullId itself, held fixed elsewhere: compare against a different generator at the same identity fields.
      const otherNullId = NULL_GENERATOR_IDS.find((n) => n !== nullId)!;
      const outOtherNull = JSON.stringify(runNullGenerator(otherNullId, { ...id, nullId: otherNullId }, spec(id.windowSteps)));
      expect(outOtherNull).not.toBe(base);
    });

    it(`${nullId}: 32 replicateIndex values of one cell are pairwise distinct`, () => {
      const outs = new Set<string>();
      for (let r = 0; r < 32; r++) {
        const id = baseId({ nullId, replicateIndex: r });
        outs.add(JSON.stringify(runNullGenerator(nullId, id, spec(id.windowSteps))));
      }
      expect(outs.size).toBe(32);
    });
  }
});

describe("Rng: same (Identity, metric) twice -> identical stream; changing any field -> a different stream", () => {
  const draws = (id: Identity, metric: string, n = 8): number[] => {
    const rng = new Rng(id, metric);
    return Array.from({ length: n }, () => rng.u());
  };

  it("the same (Identity, metric) pair reproduces the same draws", () => {
    const id = baseId();
    expect(draws(id, "K")).toEqual(draws({ ...id }, "K"));
  });

  it("streamRng agrees with Rng.u() (Rng is a thin wrapper)", () => {
    const id = baseId();
    const raw = streamRng(id, "K");
    const direct = Array.from({ length: 8 }, () => raw());
    expect(draws(id, "K")).toEqual(direct);
  });

  it("changing any one Identity field, or the metric name, changes every draw", () => {
    const id = baseId();
    const base = draws(id, "K");
    const variants: Partial<Identity>[] = [
      { masterSeed: id.masterSeed + 1 },
      { nullId: "neutralDrift" },
      { windowSteps: id.windowSteps + 500 },
      { replicateIndex: id.replicateIndex + 1 },
      { condition: "neutral" },
      { seedIndex: id.seedIndex + 1 },
    ];
    for (const v of variants) expect(draws({ ...id, ...v }, "K")).not.toEqual(base);
    expect(draws(id, "T")).not.toEqual(base);
  });
});

describe("ActivityTracker replay, not shape assertion", () => {
  it("longPeriodLoop: every label stays positive throughout, and cumulativeNew is non-decreasing and plateaus at <= K", () => {
    const id = baseId({ nullId: "longPeriodLoop", windowSteps: 20000 });
    const s = spec(id.windowSteps);
    const bundle = longPeriodLoop(id, s);
    const K = bundle.generatorParams.K as number;
    // Precondition this generator's own bound depends on: no label ever touches zero.
    expect(bundle.lineages.every((r) => r.cells >= 1)).toBe(true);

    const byStep = new Map<number, [string, number][]>();
    for (const r of bundle.lineages) {
      const arr = byStep.get(r.step) ?? [];
      arr.push([r.key, r.cells]);
      byStep.set(r.step, arr);
    }
    const tracker = new ActivityTracker(50); // an arbitrary but fixed threshold, well within this generator's abundance range
    const cum = bundle.series.map((x) => tracker.update(x.step, byStep.get(x.step) ?? []).cumulativeNew);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    expect(cum[cum.length - 1]).toBeLessThanOrEqual(K);
  });

  it("saturatingProcess: the replayed cumulativeNew's per-census increment is, on average, non-increasing over the second half, with informative (non-trivial-timing) crossings", () => {
    const id = baseId({ nullId: "saturatingProcess", windowSteps: 20000 });
    const s = spec(id.windowSteps);
    const bundle = saturatingProcess(id, s);
    expect(bundle.lineages.every((r) => r.cells >= 1)).toBe(true);

    const byStep = new Map<number, [string, number][]>();
    for (const r of bundle.lineages) {
      const arr = byStep.get(r.step) ?? [];
      arr.push([r.key, r.cells]);
      byStep.set(r.step, arr);
    }
    // 350 is chosen so crossing is driven by the actual growth curve, not by
    // the fixed alphabet's floor baseline: crossings spread across most of
    // the window (not clustered at the start), landing in the band where the
    // real generator's own crossing-count curve decelerates (checked at this
    // Identity: first crossing at 33% in, last at 63% in).
    const THRESHOLD = 350;
    const tracker = new ActivityTracker(THRESHOLD);
    const cum = bundle.series.map((x) => tracker.update(x.step, byStep.get(x.step) ?? []).cumulativeNew);
    const K = bundle.generatorParams.K as number;
    expect(cum[cum.length - 1]).toBe(K); // every lineage eventually crosses within the window

    // Crossings must be informative, not trivially timed: the first crossing
    // must not be near the very start, and the last must not be near the
    // very start either -- otherwise the increment assertion below would be
    // satisfied vacuously by a long flat tail, regardless of shape.
    const firstCrossStep = bundle.series[cum.findIndex((v) => v > 0)].step;
    const lastCrossStep = bundle.series[cum.findIndex((v) => v === K)].step;
    expect(firstCrossStep).toBeGreaterThan(id.windowSteps * 0.2);
    expect(lastCrossStep).toBeGreaterThan(id.windowSteps * 0.5);

    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    const incr = cum.slice(1).map((v, i) => v - cum[i]);
    const half = Math.floor(incr.length / 2);
    const firstHalfMean = incr.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const secondHalfMean = incr.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, incr.length - half);
    expect(secondHalfMean).toBeLessThanOrEqual(firstHalfMean + 1e-9);
  });

  it("saturatingProcess's shape assertion actually discriminates: a deliberately accelerating (convex) alternative fixture fails it", () => {
    // Same fixed-alphabet / threshold discipline as the test above (same K,
    // same floor/ceil scale, same census schedule), but abundance ACCELERATES
    // toward the ceiling (convex in step, v = floor + (ceil-floor)*(step/T)^3)
    // instead of saturating toward it -- proof the test above can actually
    // tell saturating from accelerating growth apart.
    const steps = 20000, censusEvery = 100, K = 19, floor = 3, ceil = 20;
    const stepsArr = Array.from({ length: Math.ceil(steps / censusEvery) }, (_, i) => Math.min((i + 1) * censusEvery, steps));
    const byStep = new Map<number, [string, number][]>();
    for (const step of stepsArr) {
      const rows: [string, number][] = [];
      for (let k = 0; k < K; k++) {
        const v = floor + (ceil - floor) * (step / steps) ** 3;
        rows.push([`acc-${k}`, Math.max(1, Math.round(v))]);
      }
      byStep.set(step, rows);
    }
    const tracker = new ActivityTracker(400);
    const cum = stepsArr.map((step) => tracker.update(step, byStep.get(step) ?? []).cumulativeNew);
    expect(cum[cum.length - 1]).toBe(K);
    const incr = cum.slice(1).map((v, i) => v - cum[i]);
    const half = Math.floor(incr.length / 2);
    const firstHalfMean = incr.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const secondHalfMean = incr.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, incr.length - half);
    expect(secondHalfMean).toBeGreaterThan(firstHalfMean); // accelerating: crossings pile up later, not fewer
  });
});

describe("fairness across conditions", () => {
  for (const nullId of NULL_GENERATOR_IDS) {
    it(`${nullId}: no condition's generatorParams draws are distinguishable in distribution from another's`, () => {
      const drawAcross = (condition: string, key: string): number[] => {
        const out: number[] = [];
        for (let seedIndex = 0; seedIndex < 60; seedIndex++) {
          const id = baseId({ nullId, condition, seedIndex, windowSteps: 5000 });
          const bundle = runNullGenerator(nullId, id, spec(id.windowSteps));
          const v = bundle.generatorParams[key];
          if (typeof v === "number") out.push(v);
        }
        return out;
      };
      const sample = runNullGenerator(nullId, baseId({ nullId, windowSteps: 5000 }), spec(5000)).generatorParams;
      const numericKeys = Object.keys(sample).filter((k) => typeof sample[k] === "number");
      expect(numericKeys.length).toBeGreaterThan(0);
      for (const key of numericKeys) {
        const a = drawAcross("treatment", key);
        const b = drawAcross("neutral", key);
        const mw = mannWhitney(a, b);
        // Exploratory, not a pre-registered test: a condition-indexing bug that
        // secretly favors treatment would show up as an extreme two-sided p;
        // a generous threshold avoids flaking on a fair generator's own noise.
        expect(mw.p).toBeGreaterThan(0.001);
      }
    });

    // `generatorParams` alone is not enough -- for randomWalkNoise it is four
    // compile-time constants (floor/ceil/sigma/lifespan), byte-identical for
    // every Identity, so the check above never touches the actual
    // per-identity randomness this generator produces. Compare a statistic
    // derived from the generator's REAL per-identity output -- total distinct
    // lineage keys introduced over the window -- instead.
    it(`${nullId}: the actual number of distinct lineages produced is not distinguishable across conditions`, () => {
      const distinctLineagesAcross = (condition: string): number[] => {
        const out: number[] = [];
        for (let seedIndex = 0; seedIndex < 60; seedIndex++) {
          const id = baseId({ nullId, condition, seedIndex, windowSteps: 5000 });
          const bundle = runNullGenerator(nullId, id, spec(id.windowSteps));
          out.push(new Set(bundle.lineages.map((r) => r.key)).size);
        }
        return out;
      };
      const a = distinctLineagesAcross("treatment");
      const b = distinctLineagesAcross("neutral");
      const mw = mannWhitney(a, b);
      expect(mw.p).toBeGreaterThan(0.001);
    });
  }
});

/** Builds Run[] for all six NULLCAL_CONDITIONS from one (nullId, windowSteps) cell, `seedsPerCondition` seeds each, and returns analyzeEnsemble's own results/heldOut -- exercising the same ensemble-compatibility, conservation and neutral-threshold logic the real CLI runs. */
async function buildEnsemble(
  gen: (id: Identity, s: ReturnType<typeof spec>) => { series: any[]; lineages: any[]; generatorParams: Record<string, unknown> },
  windowSteps: number,
  seedsPerCondition: number,
  masterSeed = 1,
  mutate: (runs: Run[]) => void = () => {},
): Promise<Awaited<ReturnType<typeof analyzeEnsemble>>> {
  const runs: Run[] = [];
  for (const conditionId of NULLCAL_CONDITIONS) {
    for (let seedIndex = 0; seedIndex < seedsPerCondition; seedIndex++) {
      const id: Identity = { masterSeed, nullId: "test", windowSteps, replicateIndex: 0, condition: conditionId, seedIndex };
      const s = makeSpec("nullgen-test", conditionId, seedIndex, windowSteps, 200, 4);
      const bundle = gen(id, s);
      const manifest = buildManifest(s, "test", windowSteps, 0, bundle.generatorParams);
      const lineages = new Map<number, [string, number][]>();
      for (const row of bundle.lineages) {
        let arr = lineages.get(row.step);
        if (!arr) lineages.set(row.step, (arr = []));
        arr.push([row.key, row.cells]);
      }
      runs.push({ condition: conditionId, seed: s.seed, dir: `test/${conditionId}/seed-${s.seed}`, series: bundle.series, lineages, manifest });
    }
  }
  // See tools/nullcal.ts's own comment: these synthetic runs reuse the
  // registered "gradient-m3" preset id purely for its endpoint/control
  // wiring, with no founder provenance and a non-pilot schedule, so this
  // always exercises analyzeEnsemble's exploratory (in-sample) threshold path.
  mutate(runs);
  return await analyzeEnsemble(runs, "nullgen-test", { ignoreFrozenThreshold: true });
}

describe("role-cut sensitivity and heredity (pre-registered, analyzeEnsemble)", () => {
  // Every deep census holds shares 0.5 / 0.07 / 0.4 / 0.03: three roles at the
  // registered 5% cut, four at 2.5%, two at 10%.
  const shares = { phototroph: 0.5, chemotroph: 0.07, decomposer: 0.4, mixed: 0.03 };
  const withShares = (runs: Run[]) => {
    for (const r of runs) for (const x of r.series) if (Array.isArray(x.rolesPresent)) {
      x.roles = { ...shares };
      x.rolesPresent = ["phototroph", "chemotroph", "decomposer"];
    }
  };

  it("re-evaluates endpoint 4 and its M5 gate at 2.5% and 10%", async () => {
    const { json } = await buildEnsemble((id, s) => constantSanity(id, s), 200_000, 3, 1, withShares);
    expect(Array.isArray(json.roleCutSensitivity)).toBe(true);
    if (!Array.isArray(json.roleCutSensitivity)) return;
    const [low, high] = json.roleCutSensitivity;
    expect([low.cut, high.cut]).toEqual([0.025, 0.1]);
    const gate = (r: EndpointResult) => (r.kind === "coexistence" ? r.gate : undefined);
    // 2.5%: four roles, so both the >=2-role endpoint and the >=3-role gate hold everywhere.
    expect(low.coexistence[0].kind === "coexistence" && low.coexistence[0].qualifying === low.coexistence[0].total).toBe(true);
    expect(gate(low.coexistence[0])?.qualifying).toBe(gate(low.coexistence[0])?.total);
    // 10%: two roles, so the endpoint still holds but the M5 gate never does.
    expect(high.coexistence[0].kind === "coexistence" && high.coexistence[0].qualifying === high.coexistence[0].total).toBe(true);
    expect(gate(high.coexistence[0])?.qualifying).toBe(0);
  });

  it("is withheld when the recorded shares do not reproduce rolesPresent at 5%", async () => {
    const { json } = await buildEnsemble((id, s) => constantSanity(id, s), 200_000, 3, 1, (runs) => {
      withShares(runs);
      const x = runs[0].series.find((p) => Array.isArray(p.rolesPresent))!;
      x.rolesPresent = ["phototroph"];
    });
    expect(json.roleCutSensitivity).toHaveProperty("unavailable");
  });

  it("reports sibling correlations: 1 for identical siblings, per condition", async () => {
    const { json } = await buildEnsemble((id, s) => constantSanity(id, s), 5000, 3, 1, (runs) => {
      for (const r of runs) r.heredity = Array.from({ length: 10 }, (_, k) => [40 + k, 40 + k, 10 + (k % 3), 10 + (k % 3)] as [number, number, number, number]);
    });
    const t = json.heredity.find((h) => h.condition === "treatment")!;
    expect(t.runs).toBe(3);
    expect(t.fissions).toBe(30);
    expect(t.muPooled).toBeCloseTo(1, 12);
    expect(t.sigmaMedianRun).toBeCloseTo(1, 12);
  });
});

describe("sanity null: constantSanity must give exactly 0", () => {
  it("0/20 across 20 seeded variants for every PRIMARY_ENDPOINTS entry and every held-out directional observable", async () => {
    for (let variant = 0; variant < 20; variant++) {
      const { results, heldOut } = await buildEnsemble(
        (id, s) => constantSanity({ ...id, masterSeed: 100 + variant }, s),
        5000,
        6,
        100 + variant,
      );
      for (const e of PRIMARY_ENDPOINTS) {
        const r = results.find((x) => x.id === e.id)!;
        // Completeness/availability and the decision are asserted SEPARATELY:
        // "unavailable" must never satisfy this assertion by accident.
        const complete = r.kind === "test" ? r.complete : r.kind === "threshold" ? r.available : r.total > 0;
        expect(complete, `${e.id} at variant ${variant} should be complete/available, not unavailable`).toBe(true);
        const decided = r.kind === "test" ? r.rows.every((row) => row.supported) : r.supported;
        expect(decided, `${e.id} at variant ${variant}`).toBe(false);
      }
      for (const r of heldOut.results.filter((x) => x.directional)) {
        expect(r.available, `${r.id} at variant ${variant} should have real data, not be unavailable`).toBe(true);
        expect(r.supported, `${r.id} at variant ${variant}`).toBe(false);
      }
      expect(heldOut.summary.presetDeclared, `variant ${variant}`).toBe(true);
      // Not just "not supported" -- a fully-informative negative, since every
      // directional observable above has real data (no missing evidence that
      // could still tip the three-valued outcome to "unavailable").
      expect(heldOut.summary.outcome, `variant ${variant}`).toBe("not-supported");
    }
  });
});

describe("positive control: plantedSignal must pass, sized to actually be reachable", () => {
  it("adaptive-activity, unbounded-growth, and the held-out summary are all supported at 20 seeds/condition", async () => {
    const { results, heldOut } = await buildEnsemble((id, s) => plantedSignal(id, s), 20000, 20);
    const adaptive = results.find((r) => r.id === "adaptive-activity")!;
    expect(adaptive.kind).toBe("test");
    if (adaptive.kind === "test") expect(adaptive.complete && adaptive.rows.every((r) => r.supported)).toBe(true);

    const unbounded = results.find((r) => r.id === "unbounded-growth")!;
    expect(unbounded.kind).toBe("threshold");
    if (unbounded.kind === "threshold") expect(unbounded.available && unbounded.supported).toBe(true);

    expect(heldOut.summary.outcome).toBe("supported");

    // Role count must ALSO be independently established, not just via the
    // other three held-out rows meeting the ">= 2 of 4" summary without it.
    // plantedSignal's treatment role count rises 1 -> 4 across the window
    // (crossing the 5% roleSummary threshold three times) while every
    // control is pinned at exactly one role throughout, so this row has a
    // real, non-flat signal to detect.
    const roleCount = heldOut.results.find((r) => r.id === "held-out-role-count");
    expect(roleCount?.directional).toBe(true);
    expect(roleCount?.supported).toBe(true);
  });
});

describe("neutralDrift is a real Moran process (no mutation, no fitness difference)", () => {
  it("produces distinct lineage labels across the window with no condition-dependent parameter", () => {
    const id = baseId({ nullId: "neutralDrift", windowSteps: 5000 });
    const bundle = neutralDrift(id, spec(id.windowSteps));
    const labels = new Set(bundle.lineages.map((r) => r.key));
    expect(labels.size).toBeGreaterThan(0);
    expect(bundle.lineages.every((r) => r.cells > 0)).toBe(true);
  });
});

describe("randomWalkNoise: cumulativeNew stays a genuine monotone integer counter under replay", () => {
  // `ActivityTracker.cumulativeNew` only ever increments (packages/metrics/src/activity.ts),
  // so "never decreases" holds unconditionally for ANY input, including an
  // empty/static fixture that never introduces a lineage -- it is not, on
  // its own, evidence that randomWalkNoise's lineage table actually drives
  // introductions, expirations or threshold crossings through the tracker.
  // This replays the real generator's lineage table and separately replays
  // an all-`[]` fixture through the same tracker to confirm the two are
  // distinguishable: the degenerate fixture must leave every count at 0.
  function replay(byStep: Map<number, [string, number][]>, steps: number[], threshold: number) {
    const tracker = new ActivityTracker(threshold);
    const snapshots = steps.map((step) => tracker.update(step, byStep.get(step) ?? []));
    return { snapshots, tracker };
  }

  it("records real introductions, expirations, and threshold crossings -- not just monotonicity, which a degenerate `[]`-every-census fixture would also satisfy", () => {
    const id = baseId({ nullId: "randomWalkNoise", windowSteps: 20000 });
    const bundle = randomWalkNoise(id, spec(id.windowSteps));
    const byStep = new Map<number, [string, number][]>();
    for (const r of bundle.lineages) {
      const arr = byStep.get(r.step) ?? [];
      arr.push([r.key, r.cells]);
      byStep.set(r.step, arr);
    }
    const steps = bundle.series.map((x) => x.step);

    const { snapshots, tracker } = replay(byStep, steps, 20);
    const cum = snapshots.map((s) => s.cumulativeNew);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);

    // Real crossings happened (not just "never went down from 0").
    expect(cum[cum.length - 1]).toBeGreaterThan(0);
    // More distinct labels were ever introduced than were ever concurrently
    // active at once -- turnover, i.e. labels actually expired rather than
    // accumulating forever.
    const distinctLabelsEverSeen = new Set(bundle.lineages.map((r) => r.key)).size;
    const maxConcurrent = Math.max(...snapshots.map((s) => s.diversity));
    expect(distinctLabelsEverSeen).toBeGreaterThan(maxConcurrent);
    // ActivityTracker only records `extinctActivity` for a component that
    // stops being seen -- nonempty iff at least one label actually expired.
    expect(tracker.extinctActivity.length).toBeGreaterThan(0);

    // The degenerate fixture this test must not accept as a pass: replaying
    // an all-empty lineage table through the same tracker/threshold leaves
    // every one of the properties above at its trivial value.
    const { snapshots: emptySnapshots, tracker: emptyTracker } = replay(new Map(), steps, 20);
    expect(emptySnapshots[emptySnapshots.length - 1].cumulativeNew).toBe(0);
    expect(emptyTracker.extinctActivity.length).toBe(0);
  });
});

describe("randomWalkNoise exercises serially-correlated noise for every scheduledTrend-consumed observable, not just lineage introductions", () => {
  /** Lag-1 autocorrelation: near 0 for i.i.d. noise around a fixed mean, close to 1 for a slow random walk. */
  function lag1Autocorr(xs: number[]): number {
    const m = mean(xs);
    let num = 0, den = 0;
    for (const x of xs) den += (x - m) ** 2;
    for (let i = 1; i < xs.length; i++) num += (xs[i] - m) * (xs[i - 1] - m);
    return den > 0 ? num / den : 0;
  }

  it("every-census observables (temporalMI, patternEntropy) show strong lag-1 autocorrelation", () => {
    const id = baseId({ nullId: "randomWalkNoise", windowSteps: 100000 });
    const bundle = randomWalkNoise(id, spec(id.windowSteps));
    const temporalMI = bundle.series.map((x) => x.temporalMI!);
    const patternEntropy = bundle.series.map((x) => x.patternEntropy!);
    // Independent per-census noise has an expected lag-1 autocorrelation of
    // ~0; a reflected random walk with a small step relative to its
    // floor/ceil range is close to 1. 0.5 is a generous floor an i.i.d.
    // sequence would essentially never clear by chance.
    expect(lag1Autocorr(temporalMI)).toBeGreaterThan(0.5);
    expect(lag1Autocorr(patternEntropy)).toBeGreaterThan(0.5);
  });

  it("deep-only observables (differentiation, compartmentalised, lineageCompression, role share) also show strong lag-1 autocorrelation", () => {
    const id = baseId({ nullId: "randomWalkNoise", windowSteps: 100000 });
    const bundle = randomWalkNoise(id, spec(id.windowSteps));
    const deepPoints = bundle.series.filter((x) => x.morphology);
    expect(deepPoints.length).toBeGreaterThan(20); // enough deep censuses for the statistic to mean something
    const differentiation = deepPoints.map((x) => x.morphology!.differentiation);
    const compartmentalised = deepPoints.map((x) => x.morphology!.compartmentalised);
    const lineageCompression = deepPoints.map((x) => x.lineageCompression!);
    const roleCount = deepPoints.map((x) => x.rolesPresent!.length);
    expect(lag1Autocorr(differentiation)).toBeGreaterThan(0.5);
    expect(lag1Autocorr(lineageCompression)).toBeGreaterThan(0.5);
    // Rounded to an integer count off a continuous underlying walk, so more
    // quantization noise than the continuous fields above -- a materially
    // lower but still clearly-non-i.i.d. floor.
    expect(lag1Autocorr(compartmentalised)).toBeGreaterThan(0.3);
    // rolesPresent.length is NOT asserted here: its underlying `roleWalk`
    // stays within [0.05, 0.95], the exact roleSummary threshold every role
    // share in EVERY null generator here sits at or above continuously (a
    // pre-existing, separately-documented limitation -- see docs/plan.md's
    // "Gate calibration" note on `held-out-role-count`), so `roleCount`
    // itself is a constant 4 with zero variance regardless of how the
    // underlying share walks.
    expect(new Set(roleCount).size).toBe(1); // documents the above precisely, rather than silently ignoring the field
  });

  it("changing the seed changes every walk's trajectory (still a pure function of Identity, no shared mutable state)", () => {
    const a = randomWalkNoise(baseId({ nullId: "randomWalkNoise", windowSteps: 20000, seedIndex: 0 }), spec(20000));
    const b = randomWalkNoise(baseId({ nullId: "randomWalkNoise", windowSteps: 20000, seedIndex: 1 }), spec(20000));
    expect(a.series.map((x) => x.temporalMI)).not.toEqual(b.series.map((x) => x.temporalMI));
  });
});

describe("boundedTreatmentVsFlat: a real but bounded difference, not one of the four exchangeable nulls", () => {
  it("treatment saturates while every control stays flat, from id.condition alone (no separate conditionId parameter)", () => {
    const treatment = boundedTreatmentVsFlat(baseId({ nullId: "boundedTreatmentVsFlat", condition: "treatment", windowSteps: 20000 }), spec(20000));
    const control = boundedTreatmentVsFlat(baseId({ nullId: "boundedTreatmentVsFlat", condition: "neutral", windowSteps: 20000 }), spec(20000));
    expect(treatment.series.at(-1)!.individuals).toBeGreaterThan(control.series.at(-1)!.individuals + 10);
    expect(control.series.every((x) => Math.abs(x.individuals - control.series[0].individuals) < 15)).toBe(true);
  });
});

describe("every HELD_OUT_SPECS id used by nullcal's row-keys corresponds to a real spec", () => {
  it("evaluateHeldOut's result ids are exactly HELD_OUT_SPECS's ids, both ways", async () => {
    // nullcal.ts's held-out row keys (`${windowPrefix}::${r.id}`) come
    // straight from analyzeEnsemble's own heldOut.results[].id, never a
    // separately hardcoded id list -- so the real risk this test guards is
    // evaluateHeldOut's emitted ids drifting from HELD_OUT_SPECS's own ids.
    const { heldOut } = await buildEnsemble((id, s) => constantSanity(id, s), 5000, 6);
    const resultIds = new Set(heldOut.results.map((r) => r.id));
    const specIds = new Set(HELD_OUT_SPECS.map((s) => s.id));
    for (const id of specIds) expect(resultIds.has(id), id).toBe(true);
    for (const id of resultIds) expect(specIds.has(id), id).toBe(true);
  });
});
