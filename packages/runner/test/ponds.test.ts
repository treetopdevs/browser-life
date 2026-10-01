// The pond cycle in the runner (docs/scaffold-integration-v1.md, "Runner", "Presets and conditions",
// "Stitching"), on the CPU reference and without a GPU: the shared boundary helper (migrate.ts's
// applyBoundary) against the pure transform, ended histories, the observer's `ponds` field and the
// continuation guard, runExperiment's entry guards, the pond conditions, ponds.tsv's text format,
// stitchRun's ponds.tsv rules and a pinned reference history (acceptance test 6). tests/deno/ponds.ts
// runs whole pond histories through runExperiment on a GPU (acceptance tests 2-5).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CH,
  METRICS_VERSION,
  POND_COLUMNS,
  PRESETS,
  RULE_VERSION,
  SCHEMA_VERSION,
  applyMigration,
  applyPondCycle,
  cellCount,
  cloneState,
  contRows,
  encodeCheckpoint,
  initWorld,
  ledgerEnergy,
  pondMatter,
  presetConfig,
  stateHash,
  totalsOf,
  type PondRow,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { census, individuals } from "@bl/metrics";
import {
  PONDS_FILE,
  PONDS_HEADER,
  VERIFIED_FILES,
  applyBoundary,
  conditionById,
  continuationError,
  decodeArtifact,
  migrateAtBoundary,
  observationDigests,
  observerSettings,
  pondCensus,
  pondContext,
  pondContinuationError,
  pondTsvRows,
  restoreObservers,
  runExperiment,
  runId,
  serializeObservers,
  specConfig,
  stitchRun,
  type ObserverState,
  type RunSpec,
  type Sink,
  type StitchSegment,
} from "@bl/runner";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const host = { host: "test", adapter: "test" };
const noopSink: Sink = { async writeText() {}, async appendText() {}, async writeBytes() {} };

/** ponds-small's start world at seed 1, with config overrides. */
function startWorld(extra: Partial<WorldConfig> = {}): WorldState {
  return initWorld(presetConfig(pondsSmall, 1, extra), pondsSmall.init);
}

/** `s` at another step, as if stepped there without change: a pure transform only reads the step for its keys. */
const at = (s: WorldState, step: number): WorldState => ({ ...cloneState(s), step });

// The reference physics behind the readState/upload pair applyBoundary uses; counts both.
class CpuSim {
  ref: RefSim;
  reads = 0;
  uploads = 0;
  constructor(state: WorldState) {
    this.ref = new RefSim(cloneState(state));
  }
  get cfg() {
    return this.ref.state.cfg;
  }
  get step() {
    return this.ref.state.step;
  }
  run(n: number) {
    this.ref.run(n);
  }
  async readState() {
    this.reads++;
    return cloneState(this.ref.state);
  }
  upload(state: WorldState) {
    this.uploads++;
    this.ref = new RefSim(cloneState(state));
  }
}

describe("applyBoundary: the pond cycle at a census boundary", () => {
  const start = startWorld();
  const ctx = pondContext(start)!;

  it("the pond context is the start state's per-pond matter and ledger, and null without pond keys", () => {
    expect(ctx.Mr).toEqual(pondMatter(start));
    expect(ctx.startMatter).toBe(totalsOf(start.cfg, start.cells).matter);
    expect(ctx.baseline).toBe(ledgerEnergy(start));
    expect(pondContext(initWorld(presetConfig(PRESETS.find((p) => p.id === "spots")!, 1), PRESETS[0].init))).toBeNull();
  });

  for (const arm of ["scaf", "rand"] as const) {
    it(`${arm}: transforms the pre-cycle state exactly as applyPondCycle does, uploads it and returns it`, async () => {
      const pre = at(startWorld({ pondArm: arm }), 2000);
      const sim = new CpuSim(pre);
      const res = await applyBoundary(sim, 2000, pondContext(pre));
      const want = applyPondCycle(pre, 2, arm, 8, pondMatter(pre), pondCensus);
      expect(res.migrations).toEqual([]);
      expect(res.ponds!.b).toBe(2);
      expect(res.ponds!.rows).toEqual(want.rows);
      expect(res.ponds!.donors).toEqual(want.donors);
      expect(res.ponds!.ended).toBe(false);
      expect([sim.reads, sim.uploads]).toEqual([1, 1]);
      // The returned state is what the simulation now holds, so a checkpoint can reuse it.
      expect(stateHash(res.state!)).toBe(stateHash(want.state));
      expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
    });
  }

  it("cont: records one row per pond and leaves the state alone", async () => {
    const pre = at(startWorld({ pondArm: "cont" }), 1000);
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre));
    expect(res.ponds!.rows).toEqual(contRows(pre, 1, pondCensus));
    expect(res.ponds!.rows.map((r) => r.donor)).toEqual([-1, -1, -1, -1]);
    expect(sim.uploads).toBe(0);
    expect(stateHash(res.state!)).toBe(stateHash(pre));
  });

  it("does nothing, and reads nothing, off a boundary, at step 0 or without pond keys", async () => {
    for (const step of [0, 500, 1100]) {
      const sim = new CpuSim(at(start, step));
      expect(await applyBoundary(sim, step, ctx)).toEqual({ migrations: [], ponds: null, state: null });
      expect([sim.reads, sim.uploads]).toEqual([0, 0]);
    }
    const spots = initWorld(presetConfig(PRESETS[0], 1), PRESETS[0].init);
    const sim = new CpuSim(at(spots, 1000));
    expect(await applyBoundary(sim, 1000, null)).toEqual({ migrations: [], ponds: null, state: null });
    expect(sim.reads).toBe(0);
  });

  it("refuses a pond boundary without its context, and a state that has lost a pond's matter", async () => {
    await expect(applyBoundary(new CpuSim(at(start, 1000)), 1000, null)).rejects.toThrow(/pond context/);
    const bad = at(start, 1000);
    bad.cells[CH.A * cellCount(bad.cfg)] += 1;
    await expect(applyBoundary(new CpuSim(bad), 1000, ctx)).rejects.toThrow(/pond 0 holds matter/);
  });

  it("over several cycles of the reference physics, M_r and the ledger computed from any state of the run equal the start's", async () => {
    // A 2-step period keeps the reference physics (a 128 x 128 world) quick.
    const s0 = startWorld({ pondPeriod: 2 });
    const c0 = pondContext(s0)!;
    const sim = new CpuSim(s0);
    for (let b = 1; b <= 3; b++) {
      sim.run(2);
      const res = await applyBoundary(sim, sim.step, c0);
      expect(res.ponds!.b).toBe(b);
      expect(res.ponds!.rows.map((r) => r.recipient).sort()).toEqual([0, 1, 2, 3]);
      expect(pondContext(res.state!)).toEqual(c0);
    }
  });
});

describe("migrateAtBoundary refuses pond configs", () => {
  it("throws for a pond config at any step, before reading or uploading anything", async () => {
    // The lab (apps/lab/src/execution.ts) only calls migrateAtBoundary until I2; a pond world there
    // must fail at its first census rather than step on without its cycles.
    for (const arm of ["scaf", "rand", "cont"] as const) {
      for (const step of [500, 1000]) {
        const sim = new CpuSim(at(startWorld({ pondArm: arm }), step));
        await expect(migrateAtBoundary(sim, step)).rejects.toThrow(/pond config needs applyBoundary/);
        expect([sim.reads, sim.uploads]).toEqual([0, 0]);
      }
    }
  });

  it("still migrates a non-pond config as applyMigration does", async () => {
    const arch = PRESETS.find((p) => p.id === "archipelago")!;
    const s = at(initWorld(presetConfig(arch, 1), arch.init), 200);
    const sim = new CpuSim(s);
    const want = applyMigration(cloneState(s), 200);
    expect(await migrateAtBoundary(sim, 200)).toEqual(want.events);
    expect(sim.reads).toBe(1);
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
    expect(await migrateAtBoundary(new CpuSim(at(s, 300)), 300)).toEqual([]);
  });
});

describe("ended histories keep stepping through the no-donor path", () => {
  it("a world with no eligible pond is cleared at every cycle, donor -1 rows, without stopping", async () => {
    // ponds-small at period 2 with every pond's biomass ground to nutrient beforehand: no pond is eligible.
    const s = startWorld({ pondPeriod: 2 });
    const n = cellCount(s.cfg);
    for (let i = 0; i < n; i++) {
      s.cells[CH.A * n + i] += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
      s.cells[CH.B * n + i] = s.cells[CH.P * n + i] = 0;
    }
    const ctx = pondContext(s)!;
    const sim = new CpuSim(s);
    for (let b = 1; b <= 3; b++) {
      sim.run(2);
      const res = await applyBoundary(sim, sim.step, ctx);
      expect(res.ponds!.ended).toBe(true);
      expect(res.ponds!.donors).toEqual([]);
      expect(res.ponds!.rows.map((r) => [r.cycle, r.donor, r.landed])).toEqual([0, 1, 2, 3].map(() => [b, -1, 0]));
      expect(pondMatter(res.state!)).toEqual(ctx.Mr);
    }
    expect(sim.step).toBe(6);
  });
});

describe("ponds.tsv text", () => {
  it("has POND_COLUMNS as its header and formats rows as tools/scaffold.ts does", () => {
    expect(PONDS_HEADER).toBe(POND_COLUMNS.join("\t") + "\n");
    expect(PONDS_HEADER.split("\t")[1]).toBe("step");
    const row = Object.fromEntries(POND_COLUMNS.map((c, i) => [c, i])) as unknown as PondRow;
    row.domShare = 0.625;
    row.heat = "12345678901234567890";
    const text = pondTsvRows([row, { ...row, donor: -1 }]);
    expect(text).toBe(
      "0\t1\t2\t3\t4\t5\t6\t7\t8\t9\t10\t11\t12\t13\t14\t0.625\t16\t17\t18\t19\t12345678901234567890\t21\n" +
        "0\t1\t2\t-1\t4\t5\t6\t7\t8\t9\t10\t11\t12\t13\t14\t0.625\t16\t17\t18\t19\t12345678901234567890\t21\n",
    );
  });

  it("recipientIndividuals counts the default census's individuals per pond, on the pre-cycle state", () => {
    const s = startWorld();
    const c = census({ cfg: s.cfg, step: s.step, cells: s.cells, genomeHead: s.genome });
    const got = pondCensus(s);
    expect(got.individuals.reduce((a, k) => a + k, 0)).toBe(individuals(c).length);
    expect(got.individuals).toHaveLength(4);
    expect(applyPondCycle(at(s, 1000), 1, "scaf", 8, pondMatter(s), pondCensus).rows.map((r) => r.recipientIndividuals)).toEqual(got.individuals);
  });
});

const settings = { censusEvery: 100, deepEvery: 10, activityThreshold: null };
const pondSpec: RunSpec = { experiment: "ponds", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };

describe("the observer's ponds field", () => {
  const cfg = specConfig(pondSpec);

  it("exists only in pond runs: a fresh pond history starts at cycle 0, any other observer never has the key", () => {
    expect(restoreObservers(undefined, settings, cfg).ponds).toEqual({ lastCycle: 0 });
    expect(serializeObservers(restoreObservers(undefined, settings, cfg), 0, settings).ponds).toEqual({ lastCycle: 0 });
    const spots = presetConfig(PRESETS[0], 1);
    expect("ponds" in serializeObservers(restoreObservers(undefined, settings, spots), 0, settings)).toBe(false);
    expect("ponds" in serializeObservers(restoreObservers(undefined, settings), 0, settings)).toBe(false);
  });

  it("round-trips through a checkpoint artifact, and a malformed one is refused at decode", () => {
    const state = at(startWorld(), 3000);
    const obs = restoreObservers(undefined, settings, cfg);
    obs.ponds = { lastCycle: 3 };
    const observer = serializeObservers(obs, 3000, settings);
    const back = decodeArtifact(encodeCheckpoint(state, observer)).observer;
    expect(back.ponds).toEqual({ lastCycle: 3 });
    expect(restoreObservers(back, settings, cfg).ponds).toEqual({ lastCycle: 3 });
    for (const ponds of [null, {}, { lastCycle: -1 }, { lastCycle: 1.5 }, { lastCycle: "3" }, 3])
      expect(() => decodeArtifact(encodeCheckpoint(state, { ...observer, ponds } as unknown as ObserverState))).toThrow(/ponds.lastCycle is malformed/);
  });
});

describe("pondContinuationError / continuationError: no continuation skips a cycle", () => {
  const cfg = specConfig(pondSpec);
  const spots = presetConfig(PRESETS[0], 1);
  const observerAt = (step: number, ponds?: { lastCycle: number }): ObserverState => {
    const o = serializeObservers(restoreObservers(undefined, observerSettings(pondSpec)), step, observerSettings(pondSpec));
    return ponds ? { ...o, ponds } : o;
  };

  it("requires lastCycle = floor(step / pondPeriod) in pond runs", () => {
    expect(pondContinuationError(cfg, observerAt(1000, { lastCycle: 1 }), 1000)).toBeNull();
    expect(pondContinuationError(cfg, observerAt(1500, { lastCycle: 1 }), 1500)).toBeNull();
    expect(pondContinuationError(cfg, observerAt(1000, { lastCycle: 0 }), 1000)).toMatch(/pre-cycle state/);
    expect(pondContinuationError(cfg, observerAt(1500, { lastCycle: 0 }), 1500)).toMatch(/needs 1/);
    expect(pondContinuationError(cfg, observerAt(1000, { lastCycle: 2 }), 1000)).toMatch(/needs 1/);
    expect(pondContinuationError(cfg, observerAt(1000), 1000)).toMatch(/requires the observer's pond-cycle field/);
  });

  it("at step 0 the field may be absent (a fresh history) or say 0", () => {
    expect(pondContinuationError(cfg, undefined, 0)).toBeNull();
    expect(pondContinuationError(cfg, observerAt(0), 0)).toBeNull();
    expect(pondContinuationError(cfg, observerAt(0, { lastCycle: 0 }), 0)).toBeNull();
    expect(pondContinuationError(cfg, observerAt(0, { lastCycle: 1 }), 0)).toMatch(/needs 0/);
  });

  it("refuses the field outside pond runs, and is silent there otherwise", () => {
    expect(pondContinuationError(spots, observerAt(1000), 1000)).toBeNull();
    expect(pondContinuationError(spots, observerAt(1000, { lastCycle: 1 }), 1000)).toMatch(/config has no pond cycle/);
  });

  it("continuationError applies it: a pre-cycle state at a boundary is refused, the post-cycle one accepted", () => {
    const state = at(startWorld(), 2000);
    expect(continuationError(pondSpec, state, observerAt(2000, { lastCycle: 2 }))).toBeNull();
    expect(continuationError(pondSpec, state, observerAt(2000, { lastCycle: 1 }))).toMatch(/pre-cycle state/);
    expect(continuationError(pondSpec, state, observerAt(2000))).toMatch(/pond-cycle field/);
  });

  it("continuationError checks a step-0 observer's pond field too", () => {
    const start = startWorld();
    expect(start.step).toBe(0);
    expect(continuationError(pondSpec, start, undefined)).toBeNull();
    expect(continuationError(pondSpec, start, observerAt(0, { lastCycle: 0 }))).toBeNull();
    expect(continuationError(pondSpec, start, observerAt(0, { lastCycle: 1 }))).toMatch(/needs 0/);
  });
});

describe("runExperiment's pond guards fire before the GPU is touched", () => {
  const fakeDevice = {} as GPUDevice;

  it("refuses an immigrant state and a metapopulation", async () => {
    const immigrant = startWorld();
    await expect(runExperiment(fakeDevice, pondSpec, noopSink, host, () => {}, { immigrant })).rejects.toThrow(/pond run cannot import an immigrant/);
    const ring: RunSpec = { ...pondSpec, metapopulation: { salt: 1, migrantCount: 4, ringNamespace: 1 } };
    expect(() => specConfig(ring)).toThrow(/pond run cannot belong to a metapopulation/);
    await expect(runExperiment(fakeDevice, ring, noopSink, host)).rejects.toThrow(/pond run cannot belong to a metapopulation/);
  });

  it("checks the pond field of an observer given without a start state", async () => {
    const fresh = (spec: RunSpec, ponds: { lastCycle: number }): ObserverState =>
      ({ ...serializeObservers(restoreObservers(undefined, observerSettings(spec)), 0, observerSettings(spec)), ponds });
    await expect(runExperiment(fakeDevice, pondSpec, noopSink, host, () => {}, { observer: fresh(pondSpec, { lastCycle: 1 }) })).rejects.toThrow(/needs 0/);
    const spots: RunSpec = { ...pondSpec, presetId: "spots" };
    await expect(runExperiment(fakeDevice, spots, noopSink, host, () => {}, { observer: fresh(spots, { lastCycle: 0 }) })).rejects.toThrow(/config has no pond cycle/);
  });

  it("requires pondPeriod to be a multiple of censusEvery, and an on-grid start", async () => {
    await expect(runExperiment(fakeDevice, { ...pondSpec, censusEvery: 300 }, noopSink, host)).rejects.toThrow(/pondPeriod must be a multiple of censusEvery/);
    const offGrid = { step: 50, cfg: specConfig(pondSpec) } as unknown as WorldState;
    await expect(runExperiment(fakeDevice, pondSpec, noopSink, host, () => {}, { start: offGrid })).rejects.toThrow(/pond runs must start on a multiple of censusEvery/);
  });
});

describe("pond conditions", () => {
  it("pond-rand and pond-cont set the arm, treatment keeps the preset's scaf", () => {
    expect(specConfig({ ...pondSpec, condition: "pond-rand" }).pondArm).toBe("rand");
    expect(specConfig({ ...pondSpec, condition: "pond-cont" }).pondArm).toBe("cont");
    expect(specConfig(pondSpec).pondArm).toBe("scaf");
    const ponds = PRESETS.find((p) => p.id === "ponds")!;
    expect(specConfig({ ...pondSpec, presetId: ponds.id, condition: "pond-cont" })).toEqual({ ...presetConfig(ponds, 1), pondArm: "cont" });
  });

  it("both throw on a config without pond keys", () => {
    for (const id of ["pond-rand", "pond-cont"]) {
      expect(() => conditionById(id).apply(presetConfig(PRESETS[0], 1))).toThrow(/needs a preset with the pond cycle/);
      expect(() => specConfig({ ...pondSpec, presetId: "spots", condition: id })).toThrow(/needs a preset with the pond cycle/);
    }
  });
});

describe("stitchRun's ponds.tsv rules", () => {
  const censusEvery = 100;

  /** A minimal, internally consistent segment bundle (as in stitch.test.ts), with `ponds` as its ponds.tsv rows (or no file). */
  function segment(spec: RunSpec, index: number, startStep: number, steps: number, ponds: string | undefined): StitchSegment {
    const end = startStep + steps;
    const rows: Record<string, unknown>[] = [];
    for (let s = startStep + censusEvery; s <= end; s += censusEvery)
      rows.push({ step: s, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true });
    const digest = `digest-${index}`;
    const manifest = {
      runId: runId(spec),
      spec: { ...spec, steps },
      cfg: specConfig(spec),
      init: "seed",
      schemaVersion: SCHEMA_VERSION,
      ruleVersion: RULE_VERSION,
      metricsVersion: METRICS_VERSION,
      host,
      startStep,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      checkpoints: [],
      summary: { steps: end, wallSeconds: 1, stepsPerSecond: 1, finalHash: digest, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, finalIndividuals: 1, finalLineages: 1, extinct: false, conservationOk: true },
    };
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify(manifest),
      "series.jsonl": rows.map((r) => JSON.stringify(r) + "\n").join(""),
      "lineages.tsv": "step\tlineage\tcells\n",
      "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
      "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
      "life.jsonl": "",
      "activity-final.json": "{}",
      ...(ponds !== undefined ? { [PONDS_FILE]: ponds } : {}),
    };
    return { index, startStep, steps, digest, files };
  }
  /** Four ponds' rows of cycle `b` at step `step`; only the cycle and step columns matter here. */
  const cycleRows = (b: number, step: number) =>
    pondTsvRows([0, 1, 2, 3].map((r) => ({ ...(Object.fromEntries(POND_COLUMNS.map((c) => [c, 0])) as unknown as PondRow), cycle: b, step, recipient: r, heat: "0", light: "0" })));

  it("is a verified file, digested when present", async () => {
    expect(VERIFIED_FILES).toContain(PONDS_FILE);
    expect(Object.keys(await observationDigests({ [PONDS_FILE]: PONDS_HEADER }))).toEqual([PONDS_FILE]);
  });

  it("concatenates every segment's rows under one header, header-only segments included", () => {
    const segs = [
      segment(pondSpec, 0, 0, 500, PONDS_HEADER),
      segment(pondSpec, 1, 500, 1000, PONDS_HEADER + cycleRows(1, 1000)),
      segment(pondSpec, 2, 1500, 1500, PONDS_HEADER + cycleRows(2, 2000) + cycleRows(3, 3000)),
    ];
    expect(stitchRun(segs, 3000)[PONDS_FILE]).toBe(PONDS_HEADER + cycleRows(1, 1000) + cycleRows(2, 2000) + cycleRows(3, 3000));
  });

  it("reads each row's step by header: a row's cycle index is not its step", () => {
    // Cycle 1 at step 1000 lies in (500, 1000]; read as column 0 it would be step 1, outside.
    expect(() => stitchRun([segment(pondSpec, 0, 0, 500, PONDS_HEADER), segment(pondSpec, 1, 500, 500, PONDS_HEADER + cycleRows(1, 1000))], 1000)).not.toThrow();
    expect(() => stitchRun([segment(pondSpec, 0, 0, 500, PONDS_HEADER + cycleRows(1, 1000)), segment(pondSpec, 1, 500, 500, PONDS_HEADER)], 1000)).toThrow(
      /segment #0: ponds.tsv has a row at step 1000, outside \(0, 500\]/,
    );
    // A row at the segment's own start step belongs to its predecessor.
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1000, PONDS_HEADER + cycleRows(1, 1000)), segment(pondSpec, 1, 1000, 500, PONDS_HEADER + cycleRows(1, 1000))], 1500)).toThrow(/segment #1: ponds.tsv has a row at step 1000/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 500, "cycle\tstepX\n")], 500)).toThrow(/no step column/);
  });

  it("holds exactly one row per pond for every boundary in a segment, with cycle = step / pondPeriod", () => {
    // A header-only segment whose range contains a boundary is missing that cycle's rows.
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1500, PONDS_HEADER)], 1500)).toThrow(/segment #0: ponds.tsv has 0 rows for the boundary at t=1000, expected 4/);
    const three = cycleRows(1, 1000).split("\n").slice(0, 3).join("\n") + "\n";
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1000, PONDS_HEADER + three)], 1000)).toThrow(/has 3 rows for the boundary at t=1000/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1000, PONDS_HEADER + cycleRows(1, 1000) + cycleRows(1, 1000))], 1000)).toThrow(/has 8 rows for the boundary at t=1000/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 2000, PONDS_HEADER + cycleRows(1, 1000) + cycleRows(1, 1500))], 2000)).toThrow(/row at step 1500 with cycle 1, not on the pond boundaries/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1000, PONDS_HEADER + cycleRows(2, 1000))], 1000)).toThrow(/row at step 1000 with cycle 2/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 1000, "step\trecipient\n")], 1000)).toThrow(/no cycle column/);
  });

  it("is required in every segment of a pond run and refused in any other run", () => {
    expect(() => stitchRun([segment(pondSpec, 0, 0, 500, PONDS_HEADER), segment(pondSpec, 1, 500, 500, undefined)], 1000)).toThrow(/segment #1: pond run but missing ponds.tsv/);
    expect(() => stitchRun([segment(pondSpec, 0, 0, 500, undefined), segment(pondSpec, 1, 500, 500, undefined)], 1000)).toThrow(/segment #0: pond run but missing ponds.tsv/);
    const spotsSpec: RunSpec = { ...pondSpec, presetId: "spots" };
    expect(() => stitchRun([segment(spotsSpec, 0, 0, 500, undefined)], 500)).not.toThrow();
    expect("ponds.tsv" in stitchRun([segment(spotsSpec, 0, 0, 500, undefined)], 500)).toBe(false);
    expect(() => stitchRun([segment(spotsSpec, 0, 0, 500, PONDS_HEADER)], 500)).toThrow(/ponds.tsv present on a run without the pond cycle/);
  });
});

describe("pinned CPU-reference history (docs/scaffold-integration-v1.md, acceptance test 6)", () => {
  // Guards the transform, and the boundary helper around it, against drift: any change to how a
  // cycle picks donors, draws and lands packets, grinds, books the ledger or fills a ponds.tsv row
  // changes these pins. ponds-small's own 1,000-step period would take 3,000 reference steps, and
  // under vitest the reference runs at about 0.6 s a step on this 128 x 128 world (some 30 minutes);
  // so this keeps ponds-small's physics, k and seed and shortens the period to 20 steps. Seed 1 keeps
  // a donor at all three cycles, so none takes the no-donor path and every pin covers a real
  // transform. The rand arm is pinned at cycle 1 from the same pre-cycle state, which costs no extra
  // steps. tests/deno/ponds.ts checks that the GPU runner reaches the same states.
  const PERIOD = 20;
  const PINS = {
    scaf: { states: ["f7364f1bd5459eb1", "e190dc48028a1033", "54f0297b6b5e0d44"], ponds: "f2d9686eff02ac2d3dde8430fbc510db19b5d21825b8d54e6129361bddf29c64" },
    rand: { state: "4b5741dce25be469", ponds: "b08a02496e7c96c93a4e8ee50f77e0ccc5fca22dfc47f70790ccce70767c200a" },
  };
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

  it(`scaf: three cycles of ponds-small at period ${PERIOD} from seed 1 reach the pinned post-cycle states and ponds.tsv; rand at cycle 1 likewise`, async () => {
    const s0 = startWorld({ pondPeriod: PERIOD });
    const ctx = pondContext(s0)!;
    const sim = new CpuSim(s0);
    const states: string[] = [];
    let tsv = PONDS_HEADER;
    let rand: { state: string; ponds: string } | null = null;
    for (let b = 1; b <= 3; b++) {
      sim.run(PERIOD);
      if (b === 1) {
        const pre = await sim.readState();
        const res = await applyBoundary(new CpuSim({ ...pre, cfg: { ...pre.cfg, pondArm: "rand" } }), PERIOD, ctx);
        expect(res.ponds!.ended).toBe(false);
        rand = { state: stateHash(res.state!), ponds: sha256(PONDS_HEADER + pondTsvRows(res.ponds!.rows)) };
      }
      const res = await applyBoundary(sim, sim.step, ctx);
      expect(res.ponds!.ended).toBe(false);
      states.push(stateHash(res.state!));
      tsv += pondTsvRows(res.ponds!.rows);
    }
    expect({ states, ponds: sha256(tsv) }).toEqual(PINS.scaf);
    expect(rand).toEqual(PINS.rand);
  }, 180_000);
});
