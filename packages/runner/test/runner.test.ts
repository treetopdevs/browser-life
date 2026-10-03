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
import { G, GENOME_CHANNELS, M3_FOUNDERS, METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, cellCount, encodeGenome, founderGenome, genomeFromHex, genomeHex, m3World, type WorldState } from "@bl/schema";
import { sameCompletedRun } from "@bl/runner";
import { immigrantError, runExperiment, specConfig, validateSpec, type RunSpec, type Sink } from "../src/runner.ts";

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

const baseManifest = () => ({ spec: reuseSpec, ruleVersion: cfg.ruleVersion, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION, cfg });

describe("sameCompletedRun (tools/run.ts reuse check)", () => {
  it("uses the requested physics version, including an explicit rule-2 experiment", () => {
    for (const ruleVersion of [1, 2]) {
      const spec = { ...reuseSpec, overrides: { ruleVersion, ...(ruleVersion === 2 ? { polymerDrag: true } : {}) } };
      const done = { ...baseManifest(), spec, cfg: specConfig(spec), ruleVersion };
      expect(sameCompletedRun(done, spec)).toBe(true);
      expect(sameCompletedRun({ ...done, ruleVersion: ruleVersion === 1 ? 2 : 1 }, spec)).toBe(false);
    }
  });
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

describe("specConfig: no-migration is only meaningful with tile migration or a metapopulation", () => {
  const base = (overrides: Partial<RunSpec> = {}): RunSpec => ({
    experiment: "nomig",
    presetId: "spots",
    condition: "no-migration",
    seed: 1,
    steps: 20,
    censusEvery: 20,
    deepEvery: 1,
    checkpointEvery: 0,
    ...overrides,
  });

  it("throws for a preset without tile migration and no metapopulation (conditions.ts's apply() no longer throws by itself)", () => {
    expect(() => specConfig(base())).toThrow(/no-migration control needs either tile migration.*or a metapopulation/);
  });

  it("is valid on a preset with tile migration configured, metapopulation or not", () => {
    const cfg = specConfig(base({ presetId: "archipelago" }));
    expect(cfg.migrationPeriod).toBe(0);
    expect(cfg.migrantCount).toBe(0);
  });

  it("is valid on a preset without tile migration when the run belongs to a metapopulation", () => {
    const cfg = specConfig(base({ metapopulation: { salt: 1, migrantCount: 4 } }));
    // No tile fields to strip (this preset never had any) -- the control still
    // applies via the metapopulation, which specConfig can see but apply() cannot.
    expect(cfg.migrationPeriod).toBeUndefined();
  });
});

describe("immigrantError: ring members legitimately differ in seed AND ringNamespace (review P1)", () => {
  // A bug caught while adding end-to-end coverage for the ringNamespace fix:
  // sameConfigExceptSeed only exempted `seed`, so once two ring members'
  // configs started legitimately differing in `ringNamespace` too (review
  // P1's own fix -- each ring position gets a distinct namespace so ids stay
  // unique), every real cross-run import started failing
  // `immigrantError`'s config check, even though nothing was actually wrong.
  const specAt = (seed: number, ringNamespace: number): RunSpec => ({
    experiment: "ring",
    presetId: "spots",
    condition: "treatment",
    seed,
    steps: 100,
    censusEvery: 100,
    deepEvery: 1,
    checkpointEvery: 0,
    metapopulation: { salt: 1, migrantCount: 4, ringNamespace },
  });

  it("accepts an immigrant from a different ring member (different seed AND ringNamespace)", () => {
    const mine = specConfig(specAt(10, 1));
    const theirs = specConfig(specAt(20, 2));
    const immigrant = { step: 100, cfg: theirs } as unknown as WorldState;
    expect(immigrantError(specAt(10, 1), 100, immigrant)).toBeNull();
  });

  it("still rejects a real config mismatch (not just seed/ringNamespace)", () => {
    const theirs = { ...specConfig(specAt(20, 2)), kernelRadius: specConfig(specAt(20, 2)).kernelRadius + 1 };
    const immigrant = { step: 100, cfg: theirs } as unknown as WorldState;
    expect(immigrantError(specAt(10, 1), 100, immigrant)).toMatch(/config differs/);
  });
});

describe("RunSpec.speciesCensus is optional (?:), never present when unset", () => {
  it("JSON.stringify of a spec without speciesCensus never mentions the field", () => {
    expect(JSON.stringify(reuseSpec)).not.toMatch(/speciesCensus/);
  });

  it("an explicit speciesCensus: undefined also never appears (JSON.stringify drops undefined values)", () => {
    const spec: RunSpec = { ...reuseSpec, speciesCensus: undefined };
    expect(JSON.stringify(spec)).not.toMatch(/speciesCensus/);
    // sameCompletedRun/specConfig's pure behavior is otherwise unaffected by the field's mere presence-as-undefined.
    expect(sameCompletedRun(baseManifest(), spec)).toBe(true);
  });

  it("an explicit speciesCensus: false normalizes the same as omitted (unlike undefined, JSON.stringify would otherwise keep it)", () => {
    const spec: RunSpec = { ...reuseSpec, speciesCensus: false };
    expect(JSON.stringify(spec)).toMatch(/speciesCensus/); // the raw spec really does carry the key...
    // ...but sameCompletedRun (and runExperiment's own manifest.spec, exercised end to end in
    // tests/deno/species-census.ts) must still treat it as identical to a manifest that never
    // mentioned the field, the same guarantee explicit-undefined and omitted already have.
    expect(sameCompletedRun(baseManifest(), spec)).toBe(true);
  });
});

// Foundations-review options (RunSpec.lineageObs, RunSpec.soloFounder): absent or explicitly off,
// they must leave a run's identity as it was; soloFounder is checked before any GPU work.
describe("foundations-review run options", () => {
  it("an explicit lineageObs: false is the same completed run as one without the field", () => {
    expect(sameCompletedRun(baseManifest(), { ...reuseSpec, lineageObs: false })).toBe(true);
    expect(sameCompletedRun(baseManifest(), { ...reuseSpec, lineageObs: true })).toBe(false);
  });

  it("validateSpec accepts a founder index into an m3 preset and refuses anything else", () => {
    const m3: RunSpec = { ...reuseSpec, presetId: "gradient-m3" };
    expect(validateSpec({ ...m3, soloFounder: 0 })).toEqual([]);
    expect(validateSpec({ ...m3, soloFounder: M3_FOUNDERS.length - 1 })).toEqual([]);
    expect(validateSpec({ ...m3, soloFounder: M3_FOUNDERS.length }).join()).toMatch(/soloFounder/);
    expect(validateSpec({ ...m3, soloFounder: 1.5 }).join()).toMatch(/soloFounder/);
    expect(validateSpec({ ...reuseSpec, soloFounder: 0 }).join()).toMatch(/M3 founder set/);
  });

  it("lineageObs refuses to continue a checkpoint (its bookkeeping is not checkpointed)", async () => {
    const spec: RunSpec = { ...reuseSpec, lineageObs: true };
    const fakeStart = { step: 100, cfg: specConfig(spec) } as unknown as WorldState;
    await expect(runExperiment({} as GPUDevice, spec, noopSink, host, () => {}, { start: fakeStart })).rejects.toThrow(/lineageObs/);
  });

  it("a single-founder world gives every founder disc that founder's genome, at the preset's positions", () => {
    const cfg = specConfig({ ...reuseSpec, presetId: "gradient-m3" });
    const [solo, full] = [m3World(cfg, 13, 32, 64, 3), m3World(cfg, 13, 32, 64)];
    const n = cellCount(cfg);
    const want = encodeGenome(founderGenome(M3_FOUNDERS[3]), 0, 0);
    let living = 0;
    for (let i = 0; i < n; i++) {
      const alive = solo.genome[G.LIN_LO * n + i] !== 0;
      expect(alive).toBe(full.genome[G.LIN_LO * n + i] !== 0);
      if (!alive) continue;
      living++;
      for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) expect(solo.genome[g * n + i]).toBe(want[g]);
    }
    expect(living).toBeGreaterThan(0);
  });

  it("a soloGenome world equals the soloFounder world of the same genome, and bad hex is refused", () => {
    const m3: RunSpec = { ...reuseSpec, presetId: "gradient-m3" };
    const hex = genomeHex(founderGenome(M3_FOUNDERS[3]));
    expect(validateSpec({ ...m3, soloGenome: hex })).toEqual([]);
    expect(validateSpec({ ...m3, soloGenome: hex.slice(1) }).join()).toMatch(/soloGenome/);
    expect(validateSpec({ ...m3, soloGenome: hex, soloFounder: 3 }).join()).toMatch(/exclusive/);
    expect(validateSpec({ ...reuseSpec, soloGenome: hex }).join()).toMatch(/M3 founder set/);
    const cfg = specConfig(m3);
    const [byGenome, byIndex] = [m3World(cfg, 13, 32, 64, genomeFromHex(hex)), m3World(cfg, 13, 32, 64, 3)];
    expect(Array.from(byGenome.cells)).toEqual(Array.from(byIndex.cells));
    expect(Array.from(byGenome.genome)).toEqual(Array.from(byIndex.genome));
  });

  it("validateSpec accepts founderSet on an m3 preset and refuses bad or conflicting specs", () => {
    const m3: RunSpec = { ...reuseSpec, presetId: "gradient-m3" };
    const hexA = genomeHex(founderGenome(M3_FOUNDERS[0]));
    const hexB = genomeHex(founderGenome(M3_FOUNDERS[1]));
    expect(validateSpec({ ...m3, founderSet: [hexA, hexB] })).toEqual([]);
    expect(validateSpec({ ...m3, founderSet: [] }).join()).toMatch(/founderSet/);
    expect(validateSpec({ ...m3, founderSet: [hexA.slice(1)] }).join()).toMatch(/founderSet/);
    expect(validateSpec({ ...m3, founderSet: [hexA], soloGenome: hexA }).join()).toMatch(/exclusive/);
    expect(validateSpec({ ...m3, founderSet: [hexA], soloFounder: 0 }).join()).toMatch(/exclusive/);
    expect(validateSpec({ ...reuseSpec, founderSet: [hexA] }).join()).toMatch(/M3 founder set/);
    expect(sameCompletedRun(baseManifest(), { ...reuseSpec, founderSet: [hexA] })).toBe(false);
  });
});
