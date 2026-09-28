/** Real A2 selection loop, with GPU and sham-run boundaries simulated on CPU. */
import { describe, expect, it, vi } from "vitest";
import { CH, G, GENOME_CHANNELS, allocState, cellCount, cloneState,
  encodeGenome, generalistGenome, stateHash } from "@bl/schema";
import type { WorldState } from "@bl/schema";

const fixture = vi.hoisted(() => ({ extractionCalls: [] as number[], shamRuns: 0 }));
vi.mock("../lib/foundation-transplant.ts", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("../lib/foundation-transplant.ts")>();
  return { ...actual, extractCellPacket: vi.fn((state: WorldState, indices: number[]) => {
    if (state.step === 25) { fixture.extractionCalls.push(25); throw new Error("injected selected packet failure"); }
    if (state.step > 25) fixture.extractionCalls.push(state.step);
    return actual.extractCellPacket(state, indices);
  }) };
});
vi.mock("../foundation-transplant-pilot.ts", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("../foundation-transplant-pilot.ts")>();
  return { ...actual, assertShamMatch: vi.fn(() => ({ controlPhysicsHash: "same",
    restoredPhysicsHash: "same", controlArtifactHash: "same", restoredArtifactHash: "same",
    conservationOk: true, observationHashesMatched: true })) };
});
vi.mock("@bl/runner", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("@bl/runner")>();
  return { ...actual, runExperiment: vi.fn(async () => {
    fixture.shamRuns++;
    return { summary: { mutations: 0 }, final: null, observer: null };
  }) };
});
vi.mock("@bl/sim-gpu", () => ({ GpuSim: { create: vi.fn(async (_device: unknown, initial: WorldState) => {
  const state = cloneState(initial), n = cellCount(state.cfg);
  const y = 1, from = y * state.cfg.tileW + 3, to = y * state.cfg.tileW + 5;
  return { run(count: number) {
    for (let j = 0; j < count; j++) {
      state.step++;
      if (state.step !== 25) continue;
      for (let ch = 0; ch < 7; ch++) {
        state.cells[ch * n + to] = state.cells[ch * n + from];
        state.cells[ch * n + from] = 0;
      }
      for (let g = 0; g < GENOME_CHANNELS; g++) {
        state.genome[g * n + to] = state.genome[g * n + from];
        state.genome[g * n + from] = 0;
      }
    }
  }, readSnapshot: async () => ({ step: state.step, cells: state.cells,
    genomeHead: state.genome.subarray(0, 4 * n), flux: state.flux }),
    readState: async () => cloneState(state), destroy() {} };
}) } }));

describe("A2 first-packet failure in the actual selection loop", () => {
  it("does not extract a later eligible component after the chosen packet fails", async () => {
    const { extractCellPacket: extractActual } = await vi.importActual<typeof import("../lib/foundation-transplant.ts")>(
      "../lib/foundation-transplant.ts");
    const { runV2Garden } = await import("../lib/foundation-serial-v2-run.ts");
    const cfg = { ...((await import("@bl/schema")).defaultConfig()), tileW: 8, tileH: 8,
      tilesX: 1, tilesY: 1, kernelRadius: 2, mutRate: 0 };
    const state = allocState(cfg), n = cellCount(cfg), sites = [9, 10, 11];
    const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
    for (const i of sites) {
      state.cells[CH.B * n + i] = 300;
      state.cells[CH.A * n + i] = 32;
      for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
      expect(state.genome[G.LIN_LO * n + i]).toBe(1);
    }
    const packet = extractActual(state, sites);
    const start = { arm: "donor" as const, stage: 0 as const, seed: 640020101,
      spec: { experiment: "test", presetId: "gradient-m3", condition: "treatment",
        seed: 640020101, steps: 3000, censusEvery: 25, deepEvery: 40, checkpointEvery: 25 },
      state, inoculum: packet, sourcePacket: packet, transplantAudit: null,
      initialStateHash: stateHash(state), initialInventory: null, eligibleRootsAtStep0: 1 };
    const observed: { step: number; selectionStatus?: string }[] = [];
    const check = (where: string) => {
      if (where.includes("step 51")) throw new Error("injected-cap-after-two-censuses");
    };
    await expect(runV2Garden({ queue: { onSubmittedWorkDone: async () => {} } } as GPUDevice,
      start as never, { host: "test", adapter: "simulated" }, check,
      async (row) => { observed.push({ step: row.step, selectionStatus: row.selectionStatus }); }))
      .rejects.toThrow("injected-cap-after-two-censuses");
    expect(fixture.shamRuns).toBe(2);
    expect(observed.map(x => [x.step, x.selectionStatus])).toEqual([
      [25, "selected"], [50, "selected"],
    ]);
    expect(fixture.extractionCalls).toEqual([25]);
  });
});
