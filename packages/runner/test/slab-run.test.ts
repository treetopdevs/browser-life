// A slab history through runExperiment (rung 1b M5, docs/3d-rung1b-m5-plan.md): the bundle's files, layers.tsv against an
// independent lockstep RefSim3, the series keys a slab leaves out, the neutral condition, the refusals before any GPU work,
// and the override allowlist. GpuSim3 is a RefSim3-backed stand-in, so this runs without a GPU; tests/deno/slab_run.ts is
// the same run on the real GPU against RefSim3.
import { describe, expect, it, vi } from "vitest";
import { SLAB_PRESETS, cloneState, decodeCheckpoint, initWorld, presetConfig, stateHash, type WorldState } from "@bl/schema";
import { RefSim3 } from "@bl/sim-ref";
import { layerRoles, layersRows, LAYERS_HEADER } from "@bl/metrics";
import { SLAB_ABSENT_METRICS, interventionsError, parseOverrides, runExperiment, slabSpecError, specConfig, type RunSpec, type Sink } from "@bl/runner";

vi.mock("@bl/sim-gpu", async () => {
  const { RefSim3 } = await import("@bl/sim-ref");
  const { cellCount, cloneState, totalsOf, G } = await import("@bl/schema");
  type WS = import("@bl/schema").WorldState;
  class FakeGpuSim3 {
    private ref: InstanceType<typeof RefSim3>;
    private pending: { childHi: number; childLo: number; parentHi: number; parentLo: number }[] = [];
    private constructor(state: WS) {
      this.ref = new RefSim3(state);
    }
    static async create(device: GPUDevice, state: WS) {
      (device as unknown as { createBuffer(): void }).createBuffer();
      return new FakeGpuSim3(cloneState(state));
    }
    get cfg() { return this.ref.cfg; }
    get step() { return this.ref.state.step; }
    run(count: number) { this.pending.push(...this.ref.run(count)); }
    async drainLedger() {
      const events = this.pending;
      this.pending = [];
      const s = this.ref.state;
      return { step: s.step, lightIn: s.lightIn, heatOut: s.heatOut, events, dropped: 0 };
    }
    async readSnapshot(withRoles = false) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, (G.PARAM1 + 1) * n), roles: withRoles ? this.ref.roles.slice() : undefined, flux: s.flux.slice() };
    }
    async readStats() {
      const s = this.ref.state, t = totalsOf(s.cfg, s.cells);
      return { step: s.step, A: t.A, B: t.B, C: t.C, P: t.P, E: t.E, S: t.S, living: 0, dense: 0, lightIn: s.lightIn, heatOut: s.heatOut, flux: s.flux.slice() };
    }
    async readState() { return cloneState(this.ref.state); }
    async readGenomeChannels(first: number, count: number) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return s.genome.slice(first * n, (first + count) * n);
    }
    upload(state: WS) { this.ref = new RefSim3(cloneState(state)); }
    destroy() {}
  }
  class No2D {
    static async create(): Promise<never> {
      throw new Error("a slab run must not create a 2D GpuSim");
    }
  }
  return { GpuSim: No2D, GpuSim3: FakeGpuSim3 };
});

const host = { host: "test", adapter: "test" };
const device = { createBuffer() {}, queue: { onSubmittedWorkDone: async () => {} } } as unknown as GPUDevice;
const fakeDevice = {} as GPUDevice;
const SLOW = 600_000;

function memorySink() {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const sink: Sink = {
    async writeText(path, text) { files.set(path, text); },
    async appendText(path, text) { files.set(path, (files.get(path) ?? "") + text); },
    async writeBytes(path, b) { bytes.set(path, b); },
  };
  return { sink, files, bytes };
}
async function rejection(spec: RunSpec, opts: Parameters<typeof runExperiment>[5] = {}): Promise<string> {
  try {
    await runExperiment(fakeDevice, spec, memorySink().sink, host, () => {}, opts);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const small: RunSpec = {
  experiment: "slab", presetId: "slab-spots", condition: "treatment", seed: 101, steps: 40, censusEvery: 10, deepEvery: 1, checkpointEvery: 0,
  overrides: { tileW: 16, tileH: 16 },
};
const cfg = specConfig(small);
const preset = SLAB_PRESETS[0];

describe("a slab history through runExperiment", () => {
  it("writes the slab bundle: its files, layers.tsv equal to a lockstep RefSim3, no 2D-only series keys", async () => {
    const out = memorySink();
    const res = await runExperiment(device, small, out.sink, host, () => {}, { keepFinal: true });
    expect(res.summary.conservationOk).toBe(true);
    expect(res.summary.steps).toBe(40);
    expect([...out.files.keys()].sort()).toEqual(["activity-final.json", "heredity.tsv", "layers.tsv", "life.jsonl", "lineages.tsv", "manifest.json", "mutations.tsv", "series.jsonl"]);

    const ref = new RefSim3(cloneState(initWorld(cfg, preset.init)));
    let expected = LAYERS_HEADER;
    for (let c = 1; c <= 4; c++) {
      ref.run(10);
      expected += layersRows(ref.state.step, layerRoles(cfg, ref.roles));
    }
    const layers = out.files.get("layers.tsv")!;
    expect(layers).toBe(expected);
    expect(layers.trim().split("\n").length).toBe(1 + 4 * 8);
    expect(layers.split("\n")[1].split("\t")[1]).toBe("0");

    const series = out.files.get("series.jsonl")!.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(series.length).toBe(4);
    for (const r of series) {
      for (const k of ["roles", "rolesPresent", "lineageCompression", "individuals", "livingCells", "pools", "rates", "activity", "mutations"]) expect(r, k).toHaveProperty(k);
      for (const k of ["patternEntropy", "temporalMI", "patternCompression", "morphology"]) expect(r, k).not.toHaveProperty(k);
      expect(r.conservationOk).toBe(true);
      expect(r.buddings).toBe(0);
    }
    const manifest = JSON.parse(out.files.get("manifest.json")!);
    expect(manifest.layers).toEqual({ file: "layers.tsv", depth: 8 });
    expect(manifest.absentMetrics).toEqual([...SLAB_ABSENT_METRICS]);
    expect(manifest.cfg.tileD).toBe(8);
    expect(manifest.init.kind).toBe("slab-spots");
    expect(manifest.summary.steps).toBe(40);
    // the same history's final state is the lockstep reference's
    expect(Array.from(res.final!.cells)).toEqual(Array.from(ref.state.cells));
  }, SLOW);

  it("writes slab checkpoints that decode to the run's own states", async () => {
    const out = memorySink();
    const res = await runExperiment(device, { ...small, steps: 20, checkpointEvery: 10 }, out.sink, host, () => {}, { keepFinal: true });
    expect([...out.bytes.keys()]).toEqual(["checkpoints/t000000010.blck", "checkpoints/t000000020.blck"]);
    const last = decodeCheckpoint(out.bytes.get("checkpoints/t000000020.blck")!);
    expect(stateHash(last.state)).toBe(stateHash(res.final!));
    expect(last.state.cfg.tileD).toBe(8);
    expect(JSON.parse(out.files.get("manifest.json")!).checkpoints.map((c: { step: number }) => c.step)).toEqual([10, 20]);
  }, SLOW);

  it("writes layers.tsv rows only at deep censuses", async () => {
    const out = memorySink();
    await runExperiment(device, { ...small, deepEvery: 2 }, out.sink, host, () => {});
    const steps = out.files.get("layers.tsv")!.trim().split("\n").slice(1).map((l) => l.split("\t")[0]);
    expect([...new Set(steps)]).toEqual(["10", "30"]);
    expect(steps.length).toBe(16);
  }, SLOW);

  it("runs the neutral condition: with no mutation it is the evolving history, cell for cell", async () => {
    const overrides = { ...small.overrides, mutRate: 0 };
    const a = await runExperiment(device, { ...small, steps: 20, overrides }, memorySink().sink, host, () => {}, { keepFinal: true });
    const nOut = memorySink();
    const b = await runExperiment(device, { ...small, steps: 20, condition: "neutral", overrides }, nOut.sink, host, () => {}, { keepFinal: true });
    expect(JSON.parse(nOut.files.get("manifest.json")!).cfg.neutral).toBe(true);
    expect(Array.from(b.final!.cells)).toEqual(Array.from(a.final!.cells));
    expect(Array.from(b.final!.genome)).toEqual(Array.from(a.final!.genome));
  }, SLOW);
});

describe("a slab spec's refusals come before any GPU work", () => {
  it("names each unsupported option", async () => {
    const cases: [Partial<RunSpec>, RegExp][] = [
      [{ speciesCensus: true }, /speciesCensus/],
      [{ lineageObs: true }, /lineageObs.*44 words.*49/],
      [{ preCycleCheckpoints: [1] }, /no pond cycle/],
      [{ picked: true }, /cannot be picked/],
      [{ pressures: [] }, /no pressures/],
      [{ interventions: [{ step: 5, kind: "lesion", x: 1, y: 1, r: 1 }] }, /interventions are not defined for a slab/],
      [{ metapopulation: { salt: 1, migrantCount: 2, ringNamespace: 1 } }, /metapopulation/],
    ];
    for (const [extra, re] of cases) {
      const spec = { ...small, ...extra } as RunSpec;
      // validateSpec or slabSpecError, but always with the device untouched (fakeDevice has no members at all).
      const msg = await rejection(spec);
      expect(msg, JSON.stringify(extra)).not.toBe("");
      if (!("picked" in extra) && !("pressures" in extra) && !("preCycleCheckpoints" in extra) && !("metapopulation" in extra)) expect(msg).toMatch(re);
    }
    expect(slabSpecError({ ...small, speciesCensus: true }, cfg)).toMatch(/speciesCensus/);
    expect(slabSpecError({ ...small, preCycleCheckpoints: [1] }, cfg)).toMatch(/no pond cycle/);
    expect(slabSpecError({ ...small, picked: true }, cfg)).toMatch(/cannot be picked/);
    expect(slabSpecError({ ...small, pressures: [] }, cfg)).toMatch(/no pressures/);
    expect(slabSpecError({ ...small, metapopulation: { salt: 1, migrantCount: 2, ringNamespace: 1 } }, cfg)).toMatch(/metapopulation/);
    expect(slabSpecError(small, cfg)).toBeNull();
    // An empty schedule would write interventions.jsonl: validateSpec already refuses it in a run, and the pure check now does too.
    expect(await rejection({ ...small, interventions: [] } as RunSpec)).toMatch(/non-empty array/);
    expect(slabSpecError({ ...small, interventions: [] }, cfg)).toBe("interventions are not defined for a slab");
  });

  it("refuses a start, an observer, an immigrant, a branch source and picks", () => {
    const st = initWorld(cfg, preset.init) as WorldState;
    expect(slabSpecError(small, cfg, { start: st })).toMatch(/whole history from step 0/);
    expect(slabSpecError(small, cfg, { observer: {} as never })).toMatch(/whole history from step 0/);
    expect(slabSpecError(small, cfg, { immigrant: st })).toMatch(/immigrant/);
    expect(slabSpecError(small, cfg, { branchFrom: st })).toMatch(/cannot branch/);
    expect(slabSpecError(small, cfg, { picks: [] })).toMatch(/cannot be picked/);
  });

  it("leaves a 2D config alone", () => {
    const flat = specConfig({ ...small, presetId: "spots", overrides: { tileW: 16, tileH: 16 } });
    expect(slabSpecError({ ...small, speciesCensus: true, lineageObs: true }, flat, { start: undefined })).toBeNull();
  });

  it("interventionsError says a slab has none", () => {
    expect(interventionsError({ interventions: [{ step: 5, kind: "lesion", x: 1, y: 1, r: 1 }] }, cfg, 0)).toBe("interventions are not defined for a slab");
    expect(interventionsError({ interventions: [] }, cfg, 0)).toBe("interventions are not defined for a slab");
    expect(interventionsError({}, cfg, 0)).toBeNull();
  });
});

describe("overrides and presets", () => {
  it("parseOverrides takes the slab's three keys and still refuses others", () => {
    expect(parseOverrides("defaultMu=61,defaultSigma=19,lightK=512")).toEqual({ defaultMu: 61, defaultSigma: 19, lightK: 512 });
    expect(parseOverrides("mutRate=0")).toEqual({ mutRate: 0 });
    expect(() => parseOverrides("tileW=64")).toThrow(/the keys allowed are mutRate, pondDeath, defaultMu, defaultSigma, lightK/);
    expect(() => parseOverrides("lightK=1,lightK=2")).toThrow(/given twice/);
  });

  it("resolves slab-spots through specConfig, with overrides in the config, and still throws for an unknown id", () => {
    const c = specConfig({ ...small, overrides: { defaultMu: 61, defaultSigma: 19, lightK: 512 } });
    expect(c).toEqual(presetConfig(preset, 101, { defaultMu: 61, defaultSigma: 19, lightK: 512 }));
    expect(c.tileD).toBe(8);
    expect(() => specConfig({ ...small, presetId: "no-such" })).toThrow(/unknown preset/);
  });
});
