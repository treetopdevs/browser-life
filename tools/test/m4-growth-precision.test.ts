import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { binomialLowerBound } from "@bl/metrics";
import {
  checkManifest, decide, ENGINEERING_PHASE, FIXED_SOURCES, MANIFEST_FORMAT, type PrecisionManifest, runTrial, schedule,
  shardOf, stableBinomialLowerBound, trialKey, upper95, validateShardRows,
} from "../lib/m4-growth-precision.ts";
import { M4_GROWTH_PRECISION_V1 as P } from "../../experiments/amendments/m4-growth-precision-v1.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/m4-growth-v4-paired-null-rows.json", import.meta.url), "utf8"));

function manifest(over: Partial<PrecisionManifest> = {}): PrecisionManifest {
  return {
    format: MANIFEST_FORMAT, contract: P.id, phase: P.phase, masterSeed: P.masterSeed, trials: P.trials, pairs: P.pairs,
    strata: P.strata.map((s) => ({ ...s })), acceptance: { ...P.acceptance }, shards: 4, capSecondsPerShard: 10_800,
    forecastSecondsPerShard: 4_200,
    parentParity: { manifestSha256: P.parentValidation.manifestSha256, sources: 48, identical: true },
    sourceHashes: Object.fromEntries(FIXED_SOURCES.map((p) => [p, "0".repeat(64)])),
    ...over,
  };
}

describe("m4 growth precision extension", () => {
  it("stable bound equals the production bound where that is finite, and scipy's beta quantiles at n = 20,000", () => {
    for (const [k, n] of [[1, 200], [2, 200], [15, 200], [3, 1000], [16, 1000], [120, 1000]]) {
      expect(stableBinomialLowerBound(k, n)).toBeCloseTo(binomialLowerBound(k, n, 0.05), 12);
    }
    // scipy.stats.beta.ppf(.95, k+1, n-k): one-sided 95% Clopper-Pearson upper bounds.
    expect(upper95(2, 200)).toBeCloseTo(0.031142599414083726, 10);
    expect(upper95(16, 1000)).toBeCloseTo(0.02420022583124934, 10);
    expect(upper95(0, 20000)).toBeCloseTo(0.00014977539622296283, 12);
    expect(upper95(400, 20000)).toBeCloseTo(0.021706022589480678, 10);
    expect(upper95(463, 20000)).toBeCloseTo(0.024976291403849278, 10);
    expect(upper95(464, 20000)).toBeCloseTo(0.02502812732812322, 10);
    // When the extension was written, the production form overflowed at this n (it returned a
    // lower bound of 0, so an upper bound of 1), so the extension does not use it. Main's
    // 0d7f1bb7 later moved production to a log-space sum above n = 1000; it now agrees here.
    expect(1 - binomialLowerBound(19537, 20000, 0.05)).toBeCloseTo(upper95(463, 20000), 10);
  });

  // Node and Deno may differ in the last ulp of a few transcendental results;
  // the Deno end-to-end test (m4-growth-precision.deno.ts) checks exact bytes.
  const close = (a: unknown, b: unknown): void => {
    if (typeof a === "number" && typeof b === "number") {
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(b)));
    } else if (a && b && typeof a === "object") {
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const k of Object.keys(b)) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    } else expect(a).toEqual(b);
  };

  it("a trial reproduces the frozen 2026-09-29 validation rows for the same identities", async () => {
    for (const want of fixture.rows) {
      const got = await runTrial("validation", 650009002, 64, { scenario: want.scenario, preset: want.preset, trial: want.trial });
      close(JSON.parse(JSON.stringify(got)), {
        identity: want.identity, endpoint2: want.endpoint2, endpoint1: want.endpoint1,
        endpoint1Method: want.endpoint1Method, jointPerPresetObserved: want.jointPerPresetObserved, threshold: want.threshold,
      });
    }
  }, 60_000);

  it("shards partition the frozen schedule exactly, in order", () => {
    const all = schedule({ strata: P.strata.map((s) => ({ ...s })), trials: 20_000 });
    expect(all.length).toBe(40_000);
    expect(trialKey(all[0])).toBe("pairedEndpoint1Null:gradient-m3:0");
    expect(trialKey(all[20_000])).toBe("pairedEndpoint1Null:spots-m3:0");
    for (const k of [1, 3, 4, 7, 16]) {
      const joined = Array.from({ length: k }, (_, i) => shardOf(all, k, i)).flat();
      expect(joined).toEqual(all);
    }
    expect(() => shardOf(all, 4, 4)).toThrow(/out of range/);
  });

  it("the scientific manifest must equal the contract; engineering uses the consumed development master", () => {
    expect(() => checkManifest(manifest())).not.toThrow();
    for (const over of [
      { masterSeed: 650009002 }, { trials: 1000 }, { pairs: 32 }, { phase: "validation" }, { contract: "m4-growth-v1" },
      { strata: [P.strata[1], P.strata[0]].map((s) => ({ ...s })) },
      { acceptance: { ...P.acceptance, nullOneSided95UpperMax: 0.03 } }, { shards: 0 }, { capSecondsPerShard: 30_000 },
      { parentParity: { manifestSha256: P.parentValidation.manifestSha256, sources: 48, identical: false } },
      { sourceHashes: {} },
    ] as Partial<PrecisionManifest>[]) expect(() => checkManifest(manifest(over))).toThrow();
    expect(() => checkManifest(manifest({ phase: ENGINEERING_PHASE, masterSeed: 650009001, trials: 2 }))).not.toThrow();
    expect(() => checkManifest(manifest({ phase: ENGINEERING_PHASE, masterSeed: P.masterSeed, trials: 2 }))).toThrow();
    expect(() => checkManifest(manifest({ phase: ENGINEERING_PHASE, masterSeed: 650009001, trials: 11 }))).toThrow();
  });

  it("checkpoint rows must be this shard's exact prefix under this manifest", () => {
    const m = manifest({ phase: ENGINEERING_PHASE, masterSeed: 650009001, trials: 2, shards: 2 });
    const block = shardOf(schedule(m), 2, 1);
    const row = (r: (typeof block)[number]) => ({
      ...r, manifestHash: "h", wallSeconds: 0.4,
      identity: { kind: "synthetic", generatorIdentity: `${ENGINEERING_PHASE}:650009001:${r.scenario}:${r.preset}:${r.trial}` },
      endpoint2: { n: 64, mean: 0, supported: false, status: "ok" }, endpoint1: { kind: "test", rows: [{}, {}] },
    });
    expect(() => validateShardRows(block.map(row), block, m, "h")).not.toThrow();
    expect(() => validateShardRows([row(block[1])], block, m, "h")).toThrow(/non-prefix/);
    expect(() => validateShardRows(block.map(row), block, m, "other")).toThrow();
    expect(() => validateShardRows([...block.map(row), row(block[0])], block, m, "h")).toThrow(/exceeds/);
    const wrong = row(block[0]);
    wrong.identity.generatorIdentity = `validation:650009002:${block[0].scenario}:${block[0].preset}:0`;
    expect(() => validateShardRows([wrong], block, m, "h")).toThrow();
  });

  it("decision: both strata complete and both endpoints' upper bounds at most 0.025", () => {
    const m = manifest();
    const rows = (preset: string, e1: number, e2: number) => Array.from({ length: P.trials }, (_, trial) => ({
      scenario: "pairedEndpoint1Null", preset, trial, wallSeconds: 0.4, jointPerPresetObserved: false,
      endpoint1: { complete: true, rows: [{ supported: trial < e1 }, { supported: trial < e1 }] },
      endpoint2: { supported: trial < e2, status: "ok" },
    }));
    const pass = decide(m, [...rows("gradient-m3", 463, 0), ...rows("spots-m3", 400, 0)]);
    expect(pass.precisionPass).toBe(true);
    expect(pass.results.map((r) => r.endpoint1Supported)).toEqual([463, 400]);
    expect(decide(m, [...rows("gradient-m3", 464, 0), ...rows("spots-m3", 400, 0)]).precisionPass).toBe(false);
    expect(decide(m, [...rows("gradient-m3", 0, 464), ...rows("spots-m3", 0, 0)]).precisionPass).toBe(false);
    expect(decide(m, [...rows("gradient-m3", 0, 0), ...rows("spots-m3", 0, 0).slice(1)]).precisionPass).toBe(false);
    // Only one comparison supported is not endpoint-1 support.
    const half = rows("gradient-m3", 0, 0).map((r, i) => i < 600 ? { ...r, endpoint1: { complete: true, rows: [{ supported: true }, { supported: false }] } } : r);
    expect(decide(m, [...half, ...rows("spots-m3", 0, 0)]).precisionPass).toBe(true);
  });
});
