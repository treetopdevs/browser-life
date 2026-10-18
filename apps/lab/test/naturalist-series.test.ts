// The naturalist's census in the lab (LabExecution's onSeries, naturalist-series.ts) against the headless runner's own series.jsonl
// and lineages.tsv for the same world, on the CPU reference: every field the bell reads, bit for bit, through odd frame sizes and a
// checkpoint-and-resume (the flux rates' previous census seeded from the restored state). The GPU world in the lab is held to a real
// bundle in tests/e2e/lab-naturalist.spec.ts; this file shows the lab's record is the runner's record on any preset and history.
import { describe, expect, it, vi } from "vitest";
import { PRESETS, cellCount, cloneState, initWorld, type WorldState } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { observerSettings, runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";
import { LabExecution, type LabSimulation } from "../src/execution.ts";
import { SERIES_FIELDS, type SeriesFields } from "../src/naturalist-series.ts";

// A RefSim-backed GpuSim with the surface runExperiment uses (as in packages/runner/test/interventions.test.ts).
vi.mock("@bl/sim-gpu", async () => {
  const { RefSim } = await import("@bl/sim-ref");
  const { cellCount, cloneState, totalsOf, G } = await import("@bl/schema");
  class FakeGpuSim {
    private ref: InstanceType<typeof RefSim>;
    private pending: MutationEvent[] = [];
    private constructor(state: WorldState) {
      this.ref = new RefSim(state);
    }
    static async create(_device: GPUDevice, state: WorldState) {
      return new FakeGpuSim(cloneState(state));
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
    upload(state: WorldState) { this.ref = new RefSim(cloneState(state)); }
    destroy() {}
  }
  return { GpuSim: FakeGpuSim };
});

/** The lab's simulation on the CPU reference (as in execution.test.ts). */
class CpuSimulation implements LabSimulation {
  ref: RefSim;
  events: MutationEvent[] = [];
  constructor(state: WorldState) { this.ref = new RefSim(cloneState(state)); }
  get cfg() { return this.ref.state.cfg; }
  get step() { return this.ref.state.step; }
  run(n: number) { this.events.push(...this.ref.run(n)); }
  async drainLedger() {
    const events = this.events.splice(0);
    return { events, dropped: 0, flux: this.ref.state.flux, step: this.step, lightIn: this.ref.state.lightIn, heatOut: this.ref.state.heatOut };
  }
  async readSnapshot() {
    const s = this.ref.state;
    return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, cellCount(s.cfg) * 4), flux: s.flux };
  }
  async readState() { return cloneState(this.ref.state); }
  upload(state: WorldState) { this.ref = new RefSim(cloneState(state)); }
  destroy() {}
  lesion(): number { throw new Error("not used"); }
  async feed(): Promise<never> { throw new Error("not used"); }
}

const device = { createBuffer() {}, queue: { onSubmittedWorkDone: async () => {} } } as unknown as GPUDevice;
function memorySink() {
  const files = new Map<string, string>();
  const sink: Sink = {
    async writeText(path, text) { files.set(path, text); },
    async appendText(path, text) { files.set(path, (files.get(path) ?? "") + text); },
    async writeBytes() {},
  };
  return { sink, files };
}

/** A 32 x 32 spots world (kernel radius 4), 15 censuses. */
const spec: RunSpec = { experiment: "nat", presetId: "spots", condition: "treatment", seed: 3, steps: 300, censusEvery: 20, deepEvery: 100, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };

describe("the lab's series record", () => {
  it("is the runner's, field for field and row for row, across frames and a resume", async () => {
    const out = memorySink();
    await runExperiment(device, spec, out.sink, { host: "test", adapter: "test" });
    const want = out.files.get("series.jsonl")!.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const wantRows = new Map<number, string>();
    for (const line of out.files.get("lineages.tsv")!.trim().split("\n").slice(1)) {
      const [step, key, cells] = line.split("\t");
      wantRows.set(Number(step), (wantRows.get(Number(step)) ?? "") + `${key}\t${cells}\n`);
    }
    expect(want).toHaveLength(15);
    // A world with something in it: living cells, several lineages and recycling to compare.
    expect(want.every((w) => (w.livingCells as number) > 0 && (w.lineages as number) > 1)).toBe(true);
    expect(new Set(want.map((w) => w.bioticRecycling)).size).toBeGreaterThan(1);

    const got: { rec: SeriesFields; rows: [string, number][]; dropped: number }[] = [];
    const settings = observerSettings(spec);
    const lab = (state: WorldState, observer?: ConstructorParameters<typeof LabExecution>[2]["observer"]) => {
      const sim = new CpuSimulation(state);
      const exec = new LabExecution(sim, settings, {
        waitForIdle: async () => {},
        isCurrent: () => true,
        start: state,
        observer,
        onSeries: (series, dropped) => got.push({ ...series(), dropped }),
      });
      return { sim, exec };
    };
    const start = initWorld(specConfig(spec), PRESETS.find((p) => p.id === spec.presetId)!.init);
    const first = lab(start);
    // Odd frames, then a checkpoint off the census grid (it settles at the next census, as the lab's saves do), then a resume.
    const sizes = [7, 13, 1, 19, 33, 64];
    for (let k = 0; first.sim.step < 120; k++) await first.exec.advanceFrame(sizes[k % sizes.length]);
    if (first.sim.step % 20 === 0) await first.exec.advanceFrame(7);
    expect(first.sim.step % 20).not.toBe(0);
    const saved = await first.exec.checkpoint();
    expect(saved.state.step % 20).toBe(0);
    expect(saved.state.step).toBeGreaterThan(120);
    const second = lab(saved.state, saved.observer);
    while (second.sim.step < spec.steps) await second.exec.advanceFrame(Math.min(23, spec.steps - second.sim.step));

    expect(got.map((g) => g.rec.step)).toEqual(want.map((w) => w.step));
    got.forEach((g, i) => {
      for (const f of SERIES_FIELDS) expect(g.rec[f], `step ${g.rec.step} ${f}`).toBe(want[i][f]);
      expect(g.rows.map(([k, c]) => `${k}\t${c}\n`).join(""), `step ${g.rec.step} lineage rows`).toBe(wantRows.get(g.rec.step) ?? "");
      expect(g.dropped).toBe(0);
    });
    // Without a start state the first census's rate is not known, and is not made up.
    const bare: SeriesFields[] = [];
    const none = new LabExecution(new CpuSimulation(start), settings, { waitForIdle: async () => {}, isCurrent: () => true, onSeries: (series) => bare.push(series().rec) });
    while (bare.length < 2) await none.advanceFrame(20);
    expect(Number.isNaN(bare[0].bioticRecycling)).toBe(true);
    expect(bare[1].bioticRecycling).toBe(want[1].bioticRecycling);
  }, 600_000);
});
