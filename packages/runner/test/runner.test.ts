// runExperiment's migration/alignment guard (review 5 & 6): the step loop
// re-chunks in censusEvery-sized steps *relative to this call's own start*,
// unchanged from before migration existed (see runner.ts's own comment on
// why), so a migration-enabled run instead requires its own start to already
// be on the censusEvery grid -- every real caller (a fresh run, or a
// coordinator segment; Coordinator.Queue.validate/1 already requires
// segmentSteps to be a multiple of censusEvery) already produces one, so this
// only ever refuses an off-grid start no legitimate caller makes.
//
// tools/run.ts's "resume/reuse" convenience check: a persisted manifest.json
// must not be treated as reusable when it was computed under a different
// metrics definition (packages/metrics/src/complexity.ts's compressionRatio),
// even though its spec/config/rule/schema otherwise match exactly — analysis
// would otherwise refuse the pooled ensemble later (tools/analyze.ts), but
// only after the reuse had already skipped a run that should have redone.
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, type WorldState } from "@bl/schema";
import { sameCompletedRun } from "@bl/runner";
import { runExperiment, specConfig, type RunSpec, type Sink } from "../src/runner.ts";

const noopSink: Sink = {
  async writeText() {},
  async appendText() {},
  async writeBytes() {},
};
const host = { host: "test", adapter: "test" };

describe("runExperiment: migration requires an on-grid start", () => {
  it("rejects a migration-enabled run whose start step isn't a multiple of censusEvery, before ever touching the GPU device", async () => {
    const spec: RunSpec = { experiment: "align", presetId: "archipelago", condition: "treatment", seed: 1, steps: 20, censusEvery: 20, deepEvery: 1, checkpointEvery: 0 };
    // Only `.step`/`.cfg` are read before the guard throws -- a stub, not a
    // real WorldState or GPUDevice, is enough to prove the check fires
    // *before* GpuSim.create ever touches the device (no WebGPU adapter
    // needed for this test at all).
    const fakeStart = { step: 5, cfg: specConfig(spec) } as unknown as WorldState;
    const fakeDevice = {} as GPUDevice;
    await expect(runExperiment(fakeDevice, spec, noopSink, host, () => {}, { start: fakeStart })).rejects.toThrow(/must start on a multiple of censusEvery/);
  });

  it("accepts an on-grid start step for a migration-enabled run (same guard, other side)", async () => {
    const spec: RunSpec = { experiment: "align", presetId: "archipelago", condition: "treatment", seed: 1, steps: 20, censusEvery: 20, deepEvery: 1, checkpointEvery: 0 };
    const fakeStart = { step: 40, cfg: specConfig(spec) } as unknown as WorldState;
    const fakeDevice = {} as GPUDevice;
    // Still rejects (there is no real observer/GPU device to continue with),
    // but for an unrelated reason -- proving the alignment guard itself did
    // *not* fire for an on-grid start, without needing a real adapter.
    try {
      await runExperiment(fakeDevice, spec, noopSink, host, () => {}, { start: fakeStart });
      throw new Error("expected runExperiment to reject (no real observer/GPU device supplied), but it resolved");
    } catch (e) {
      expect((e as Error).message).not.toMatch(/must start on a multiple of censusEvery/);
    }
  });

  it("the guard is scoped to migration-enabled presets: a migration-disabled config has nothing to check against", () => {
    const spec: RunSpec = { experiment: "align", presetId: "spots", condition: "treatment", seed: 1, steps: 20, censusEvery: 20, deepEvery: 1, checkpointEvery: 0 };
    expect(specConfig(spec).migrationPeriod ?? 0).toBe(0);
  });
});

const reuseSpec: RunSpec = { experiment: "reuse", presetId: "spots", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const cfg = specConfig(reuseSpec);

const baseManifest = () => ({ spec: reuseSpec, ruleVersion: RULE_VERSION, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION, cfg });

describe("sameCompletedRun (tools/run.ts reuse check)", () => {
  it("accepts an identical, current-metrics-version manifest", () => {
    expect(sameCompletedRun(baseManifest(), reuseSpec)).toBe(true);
  });

  it("refuses a manifest with no metricsVersion field at all (predates the constant, version 1)", () => {
    const { metricsVersion: _, ...done } = baseManifest();
    expect(sameCompletedRun(done, reuseSpec)).toBe(false);
  });

  it("refuses a manifest with an explicit but outdated metricsVersion", () => {
    expect(sameCompletedRun({ ...baseManifest(), metricsVersion: 1 }, reuseSpec)).toBe(false);
  });

  it("accepts a manifest whose metricsVersion is explicitly current, spelled out", () => {
    expect(sameCompletedRun({ ...baseManifest(), metricsVersion: METRICS_VERSION }, reuseSpec)).toBe(true);
  });

  it("still refuses on a rule/schema version mismatch, independent of metricsVersion", () => {
    expect(sameCompletedRun({ ...baseManifest(), ruleVersion: RULE_VERSION + 1 }, reuseSpec)).toBe(false);
    expect(sameCompletedRun({ ...baseManifest(), schemaVersion: SCHEMA_VERSION + 1 }, reuseSpec)).toBe(false);
  });

  it("refuses when the spec itself differs", () => {
    expect(sameCompletedRun(baseManifest(), { ...reuseSpec, steps: reuseSpec.steps + 1 })).toBe(false);
  });

  it("refuses when the config differs even though the spec, and every version, match (a stale cfg snapshot)", () => {
    const otherSpec = { ...reuseSpec, seed: reuseSpec.seed + 1 };
    // spec/ruleVersion/schemaVersion/metricsVersion all agree with otherSpec;
    // only cfg is stale (still seed 1's derived config, not seed 2's).
    const done = { ...baseManifest(), spec: otherSpec };
    expect(sameCompletedRun(done, otherSpec)).toBe(false);
  });
});
