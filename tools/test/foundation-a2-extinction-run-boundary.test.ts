/** Completed extinction through runV2Garden; only device and runner execution are simulated. */
import { describe, expect, it, vi } from "vitest";
import { CH, GENOME_CHANNELS, allocState, cellCount, cloneState, defaultConfig,
  encodeCheckpoint, encodeGenome, generalistGenome, stateHash, totalsOf,
  type WorldState } from "@bl/schema";
import { ActivityTracker, Tracker, census } from "@bl/metrics";
import { observerSettings, type ObserverState, type RunSpec } from "@bl/runner";
import { extractCellPacket } from "../lib/foundation-transplant.ts";
import { serialInventory } from "../lib/foundation-serial-transfer.ts";

function expire(state: WorldState): void {
  const n = cellCount(state.cfg), B = state.cells[CH.B * n];
  if (!B) return;
  state.cells[CH.B * n] = 0;
  state.cells[CH.A * n] += B;
  state.cells[CH.E * n] += B * (state.cfg.eB - state.cfg.eA);
  for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n] = 0;
}
class SimulatedDevice {
  readonly state: WorldState;
  constructor(initial: WorldState) { this.state = cloneState(initial); }
  run(count: number): void {
    if (this.state.step === 0 && count > 0) expire(this.state);
    this.state.step += count;
  }
  async readSnapshot() {
    return { step: this.state.step, cells: this.state.cells,
      genomeHead: this.state.genome.subarray(0, 4 * cellCount(this.state.cfg)),
      flux: this.state.flux };
  }
  async readState() { return cloneState(this.state); }
  async drainLedger() { return { events: [], dropped: 0 }; }
  destroy() {}
}
vi.mock("@bl/sim-gpu", () => ({ GpuSim: {
  create: vi.fn(async (_device: unknown, state: WorldState) => new SimulatedDevice(state)),
} }));
vi.mock("@bl/runner", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("@bl/runner")>();
  return { ...actual, runExperiment: vi.fn(async (_device: unknown, spec: RunSpec,
    sink: { writeText: (name: string, text: string) => Promise<void>;
      appendText: (name: string, text: string) => Promise<void>;
      writeBytes: (name: string, bytes: Uint8Array) => Promise<void> },
    _host: unknown, _progress: unknown, options: { start: WorldState }) => {
    const sim = new SimulatedDevice(options.start), tracker = new Tracker(),
      activity = new ActivityTracker();
    for (const name of ["series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv",
      "life.jsonl", "activity-final.json"])
      await sink.writeText(name, "");
    let observer!: ObserverState;
    for (let step = 25; step <= spec.steps; step += 25) {
      sim.run(25);
      const state = await sim.readState(), n = cellCount(state.cfg);
      tracker.update(census({ cfg: state.cfg, step, cells: state.cells,
        genomeHead: state.genome.subarray(0, 4 * n) }));
      observer = { step, settings: observerSettings(spec), tracker: tracker.toJSON(),
        activity: activity.toJSON(), mutations: 0, buddings: 0,
        censusIdx: step / 25, extinct: true, prevSym: null };
      await sink.appendText("series.jsonl", JSON.stringify({ step,
        conservationOk: true, mutations: 0, pools: { B: 0, P: 0 } }) + "\n");
      await sink.writeBytes(`checkpoints/t${String(step).padStart(9, "0")}.blck`,
        encodeCheckpoint(state, observer));
    }
    return { summary: { mutations: 0, conservationOk: true },
      final: await sim.readState(), observer };
  }) };
});

describe("A2 completed extinction through the actual garden outcome path", () => {
  it("records completed extinction, full trace, conservation and unsampled reference", async () => {
    const { runV2Garden } = await import("../lib/foundation-serial-v2-run.ts");
    const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
      kernelRadius: 2, seed: 640020101, mutRate: 0 };
    const state = allocState(cfg), n = cellCount(cfg);
    for (let i = 0; i < n; i++) state.cells[CH.A * n + i] = 32;
    state.cells[CH.B * n] = 300;
    const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n] = words[g];
    const packet = extractCellPacket(state, [0]);
    const start = { arm: "zero-controller-genotype" as const, stage: 0 as const,
      seed: 640020101, spec: { experiment: "test", presetId: "gradient-m3",
        condition: "treatment", seed: 640020101, steps: 3000,
        censusEvery: 25, deepEvery: 40, checkpointEvery: 25 }, state,
      sourcePacket: packet, inoculum: packet, transplantAudit: null,
      initialStateHash: stateHash(state), initialInventory: serialInventory(state),
      eligibleRootsAtStep0: 1 };
    const outcome = await runV2Garden({ queue: { onSubmittedWorkDone: async () => {} } } as GPUDevice,
      start, { host: "test", adapter: "simulated device" }, () => {});
    expect(outcome.status).toBe("complete");
    expect(outcome.finalInventory.B).toBe("0");
    expect(outcome.finalInventory.P).toBe("0");
    expect(outcome.selection?.status).toBe("no-eligible-transition");
    expect(outcome.selectedPacket).toBeNull();
    expect(outcome.observer.status).toBe("complete");
    expect(outcome.observer.series).toHaveLength(120);
    expect(outcome.observer.censuses).toHaveLength(120);
    expect(outcome.sham?.observationHashesMatched).toBe(true);
    expect(outcome.reference.matchedMeasured).toBe(true);
    expect(outcome.incorporatedBoundMatterLowerBound).toBe("0");
    const expected = cloneState(state); expire(expected); expected.step = 3000;
    expect(stateHash(expected)).toBe(outcome.measuredPhysicsHash);
    const before = totalsOf(state.cfg, state.cells), after = totalsOf(expected.cfg, expected.cells);
    expect(before.matter).toBe(after.matter);
    expect(before.energy).toBe(after.energy);
  });
});
