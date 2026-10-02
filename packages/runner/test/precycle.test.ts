// Opt-in pre-cycle checkpoints (RunSpec.preCycleCheckpoints; docs/scaffold-registration-v1.md, "Code
// to build", and docs/scaffold-integration-v1.md, Amendment 3), without a GPU: validateSpec's shape
// checks, runExperiment's pond guards before the GPU is touched, run identity with and without the
// field, and stitchRun's refusal. tests/deno/ponds.ts (section precycle) writes and checks the
// checkpoints themselves on a GPU, and that a run without the field has no trace of it in its manifest.
import { describe, expect, it } from "vitest";
import { METRICS_VERSION, PRESETS, RULE_VERSION, SCHEMA_VERSION, cloneState, initWorld, presetConfig, type WorldState } from "@bl/schema";
import {
  PONDS_HEADER,
  observerSettings,
  preCycleError,
  restoreObservers,
  runExperiment,
  runId,
  sameCompletedRun,
  serializeObservers,
  specConfig,
  stitchRun,
  validateSpec,
  type ObserverState,
  type RunSpec,
  type Sink,
  type StitchSegment,
} from "@bl/runner";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const host = { host: "test", adapter: "test" };
const noopSink: Sink = { async writeText() {}, async appendText() {}, async writeBytes() {} };
const fakeDevice = {} as GPUDevice;

// ponds-small: pondPeriod 1,000, so boundary b is at step 1000 b.
const pondSpec: RunSpec = { experiment: "ponds", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 4000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const spotsSpec: RunSpec = { ...pondSpec, presetId: "spots" };

/** ponds-small's start world at seed 1, moved to `step` (the guards read only its step and config). */
const startAt = (step: number): WorldState => ({ ...cloneState(initWorld(presetConfig(pondsSmall, 1), pondsSmall.init)), step });
/** The post-cycle observer a pond run writes at `step` (lastCycle = floor(step / 1000)). */
const observerAt = (step: number): ObserverState => ({
  ...serializeObservers(restoreObservers(undefined, observerSettings(pondSpec)), step, observerSettings(pondSpec)),
  ponds: { lastCycle: Math.floor(step / 1000) },
});

/** The message runExperiment rejects with, or "" if it resolves. */
async function rejection(spec: RunSpec, opts: { start?: WorldState; observer?: ObserverState } = {}): Promise<string> {
  try {
    await runExperiment(fakeDevice, spec, noopSink, host, () => {}, opts);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("validateSpec: preCycleCheckpoints' shape", () => {
  it("accepts the field absent and any non-empty, strictly increasing list of positive integers", () => {
    expect(validateSpec(pondSpec)).toEqual([]);
    for (const bs of [[1], [2, 3], [34, 100], [1, 2, 3, 4]]) expect(validateSpec({ ...pondSpec, preCycleCheckpoints: bs })).toEqual([]);
  });

  it("rejects an empty list, non-integers and non-positive boundaries", () => {
    // Sparse arrays included: their holes are not boundaries.
    for (const bs of [[], [1.5], [0], [-1], [2, 0], [NaN], [Infinity], [2 ** 53], ["2"], null, "34,100", 34, [, 2], [1, , 3], new Array(2)])
      expect(validateSpec({ ...pondSpec, preCycleCheckpoints: bs as unknown as number[] })).toEqual([
        "preCycleCheckpoints must be a non-empty array of positive integers (pond boundaries)",
      ]);
  });

  it("rejects unsorted and duplicated lists", () => {
    for (const bs of [[3, 2], [100, 34], [2, 2], [1, 3, 3], [1, 3, 2]])
      expect(validateSpec({ ...pondSpec, preCycleCheckpoints: bs })).toEqual(["preCycleCheckpoints must be strictly increasing"]);
  });

  it("runExperiment refuses a malformed list before anything else", async () => {
    expect(await rejection({ ...pondSpec, preCycleCheckpoints: [3, 2] })).toMatch(/^invalid run spec: preCycleCheckpoints must be strictly increasing/);
  });
});

describe("runExperiment's pre-cycle guards fire before the GPU is touched", () => {
  it("refuses the field on a run without the pond cycle", async () => {
    expect(await rejection({ ...spotsSpec, preCycleCheckpoints: [1] })).toBe("preCycleCheckpoints needs a pond run: this config has no pondPeriod");
  });

  it("refuses a boundary at or before the start step: its cycle belongs to the run that reached it", async () => {
    const start = startAt(2000), observer = observerAt(2000);
    const spec: RunSpec = { ...pondSpec, steps: 2000 };
    expect(await rejection({ ...spec, preCycleCheckpoints: [2, 3] }, { start, observer })).toMatch(/^preCycleCheckpoints: boundary 2 \(t=2000\) is at or before this run's start step 2000/);
    expect(await rejection({ ...spec, preCycleCheckpoints: [1, 3] }, { start, observer })).toMatch(/^preCycleCheckpoints: boundary 1 \(t=1000\) is at or before this run's start step 2000/);
  });

  it("refuses a boundary beyond the run's last step", async () => {
    expect(await rejection({ ...pondSpec, preCycleCheckpoints: [2, 5] })).toMatch(/^preCycleCheckpoints: boundary 5 \(t=5000\) is beyond this run's last step 4000/);
    const spec: RunSpec = { ...pondSpec, steps: 2000, preCycleCheckpoints: [4, 5] };
    expect(await rejection(spec, { start: startAt(2000), observer: observerAt(2000) })).toMatch(/^preCycleCheckpoints: boundary 5 \(t=5000\) is beyond this run's last step 4000/);
  });

  it("refuses a boundary off the run's census grid (named before the pond start-grid guard, which also rules it out)", async () => {
    expect(await rejection({ ...pondSpec, preCycleCheckpoints: [1] }, { start: startAt(50) })).toMatch(/^preCycleCheckpoints: boundary 1 \(t=1000\) is not a census step of this run \(start 50, censusEvery 100\)/);
    // The same off-grid start without the field meets the existing guard.
    expect(await rejection(pondSpec, { start: startAt(50) })).toMatch(/pond runs must start on a multiple of censusEvery/);
    // preCycleError itself, for a grid the cadence guards would refuse anyway.
    expect(preCycleError({ ...pondSpec, censusEvery: 300, preCycleCheckpoints: [1] }, specConfig(pondSpec), 0)).toMatch(/boundary 1 \(t=1000\) is not a census step/);
  });

  it("lets a valid list through to the GPU: boundaries up to and including the last step, from a fresh start or a continuation", async () => {
    // Past every guard, the fake device fails at its first use, in GpuSim.create.
    for (const [spec, opts] of [
      [{ ...pondSpec, preCycleCheckpoints: [1, 4] }, {}],
      [{ ...pondSpec, steps: 2000, preCycleCheckpoints: [3, 4] }, { start: startAt(2000), observer: observerAt(2000) }],
      [{ ...pondSpec, condition: "pond-cont", steps: 1000, preCycleCheckpoints: [1] }, {}],
    ] as [RunSpec, { start?: WorldState; observer?: ObserverState }][])
      expect(await rejection(spec, opts)).toMatch(/^device\.\w+ is not a function$/);
    expect(preCycleError(pondSpec, specConfig(pondSpec), 0)).toBeNull();
    expect(preCycleError(spotsSpec, specConfig(spotsSpec), 0)).toBeNull();
  });
});

describe("a spec without the field is unchanged", () => {
  const done = (spec: RunSpec): Record<string, unknown> => ({
    spec: JSON.parse(JSON.stringify(spec)),
    cfg: specConfig(spec),
    ruleVersion: RULE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
  });

  it("keeps its runId, and sameCompletedRun tells a run with the field from one without", () => {
    const withField: RunSpec = { ...pondSpec, preCycleCheckpoints: [2, 3] };
    expect(runId(pondSpec)).toBe("ponds/ponds-small/treatment/seed-1");
    expect(runId(withField)).toBe(runId(pondSpec));
    expect(sameCompletedRun(done(pondSpec), pondSpec)).toBe(true);
    expect(sameCompletedRun(done(withField), withField)).toBe(true);
    // A bundle written without the field is not reused for a run that asks for it, nor the reverse,
    // nor one with a different list.
    expect(sameCompletedRun(done(pondSpec), withField)).toBe(false);
    expect(sameCompletedRun(done(withField), pondSpec)).toBe(false);
    expect(sameCompletedRun(done(withField), { ...pondSpec, preCycleCheckpoints: [2] })).toBe(false);
  });
});

describe("stitchRun refuses segments that carry pre-cycle checkpoints", () => {
  // The stitched manifest would list files the stitched bundle does not carry. Coordinator segments
  // never set the field (their specs are built from a fixed set of keys); this guards the stitcher.

  /** One finished ponds-small segment over (0, 500], crossing no boundary, internally consistent (as in ponds.test.ts). */
  function segment(spec: RunSpec, preCycle: unknown): StitchSegment {
    const steps = 500;
    const rows: string[] = [];
    for (let s = 100; s <= steps; s += 100)
      rows.push(JSON.stringify({ step: s, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true }) + "\n");
    const manifest = {
      runId: runId(spec),
      spec: { ...spec, steps },
      cfg: specConfig(spec),
      init: "seed",
      schemaVersion: SCHEMA_VERSION,
      ruleVersion: RULE_VERSION,
      metricsVersion: METRICS_VERSION,
      host,
      startStep: 0,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      checkpoints: [],
      ...(preCycle !== undefined ? { preCycleCheckpoints: preCycle } : {}),
      summary: { steps, wallSeconds: 1, stepsPerSecond: 1, finalHash: "digest-0", mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, finalIndividuals: 1, finalLineages: 1, extinct: false, conservationOk: true },
    };
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify(manifest),
      "series.jsonl": rows.join(""),
      "lineages.tsv": "step\tlineage\tcells\n",
      "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
      "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
      "life.jsonl": "",
      "activity-final.json": "{}",
      "ponds.tsv": PONDS_HEADER,
    };
    return { index: 0, startStep: 0, steps, digest: "digest-0", files };
  }

  it("stitches the fixture without the field, and refuses it with the field in the manifest, the spec or both", () => {
    expect(() => stitchRun([segment(pondSpec, undefined)], 500)).not.toThrow();
    const entry = [{ boundary: 1, step: 1000, file: "checkpoints/b001-pre.blck", hash: "0000000000000000" }];
    const withField: RunSpec = { ...pondSpec, preCycleCheckpoints: [1] };
    for (const seg of [segment(withField, entry), segment(withField, undefined), segment(pondSpec, entry), segment(pondSpec, [])])
      expect(() => stitchRun([seg], 500)).toThrow(/^segment #0: carries pre-cycle checkpoints, which stitching does not support$/);
  });
});
