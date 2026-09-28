import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, G, allocState, cellCount, cloneState, defaultConfig, stateHash, type WorldConfig } from "@bl/schema";
import { FINE_STEP, SensitivityObserver, runReferenceReplay, settingsGrid,
  type SensitivitySnapshot } from "../lib/foundation-sensitivity.ts";

const cfg = defaultConfig({ tileW: 24, tileH: 16, tilesX: 1, tilesY: 1, kernelRadius: 2 });
type Paint = { x: number; y: number; mass?: number; membrane?: number };
const rect = (x0: number, y0: number, w: number, h: number, mass = 100): Paint[] =>
  Array.from({ length: w * h }, (_, k) => ({ x: x0 + k % w, y: y0 + Math.floor(k / w), mass }));
function snapshot(world: WorldConfig, step: number, paint: readonly Paint[]): SensitivitySnapshot {
  const n = cellCount(world), cells = new Uint32Array(CELL_CHANNELS * n), genomeHead = new Uint32Array(4 * n);
  for (const p of paint) {
    const i = p.y * world.tileW * world.tilesX + p.x;
    const mass = p.mass ?? 100, membrane = p.membrane ?? Math.floor(mass / 2);
    cells[CH.B * n + i] = mass - membrane;
    cells[CH.P * n + i] = membrane;
    genomeHead[G.LIN_HI * n + i] = 1;
    genomeHead[G.LIN_LO * n + i] = 1;
    genomeHead[G.PARAM0 * n + i] = 60 | (20 << 16);
  }
  return { step, cells, genomeHead };
}
const row = (observer: SensitivityObserver, threshold: number, minMass: number, cadence: number) =>
  observer.results().find((r) => r.setting.threshold === threshold && r.setting.minMass === minMass && r.setting.cadence === cadence)!;

describe("one-stream observer sensitivity", () => {
  it("uses the fixed 27-setting grid and makes transient topology events cadence-dependent", () => {
    expect(settingsGrid()).toHaveLength(27);
    expect(() => settingsGrid([24], [128], [30])).toThrow(/fine snapshot grid/);
    const observer = new SensitivityObserver(cfg);
    const bridge = rect(2, 5, 7, 3);
    const split = bridge.filter((p) => p.x !== 5);
    for (let step = 0; step <= 200; step += FINE_STEP)
      observer.accept(snapshot(cfg, 100_000 + step, step === 25 ? split : bridge));
    const fine = row(observer, 48, 512, 25), coarse = row(observer, 48, 512, 100);
    expect(observer.fineObservedSteps).toEqual(Array.from({ length: 9 }, (_, i) => 100_000 + i * 25));
    expect(fine.baseline).toEqual({ step: 100_000, eligibleComponents: 1, trackedIndividuals: 1 });
    expect(fine.observedSteps).toEqual(observer.fineObservedSteps);
    expect(fine).toMatchObject({ postBaselineCensuses: 8, atRiskIndividualIntervals: 9,
      events: { birth: 0, death: 0, fission: 1, fusion: 1 }, fissionChildIdentities: 1,
      fusionAbsorptionReferences: 1 });
    expect(coarse.observedSteps).toEqual([100_000, 100_100, 100_200]);
    expect(coarse).toMatchObject({ postBaselineCensuses: 2, atRiskIndividualIntervals: 2,
      events: { birth: 0, death: 0, fission: 0, fusion: 0 } });
    expect(fine.morphology.measuredFrames).toBe(8);
    expect(coarse.morphology.measuredFrames).toBe(2);
  });

  it("reports positive morphology samples and eligibility denominators without turning missing into zero", () => {
    const observer = new SensitivityObserver(cfg);
    const membrane = rect(5, 3, 5, 5).map((p) => ({ ...p,
      membrane: p.x === 5 || p.x === 9 || p.y === 3 || p.y === 7 ? 90 : 10 }));
    for (let step = 0; step <= 200; step += FINE_STEP)
      observer.accept(snapshot(cfg, step, step === 25 ? membrane : []));
    const fine = row(observer, 48, 512, 25), coarse = row(observer, 48, 512, 100);
    expect(fine.morphology).toMatchObject({ measuredFrames: 8, framesWithIndividuals: 1,
      individualObservations: 1, framesWithCompartments: 1, compartmentObservations: 1,
      maxCompartmentsInFrame: 1 });
    expect(coarse.morphology).toMatchObject({ measuredFrames: 2, framesWithIndividuals: 0,
      framesWithCompartments: 0, meanDifferentiationWhenIndividuals: null,
      meanMembraneFractionWhenIndividuals: null });
    expect(fine.events).toMatchObject({ birth: 1, death: 1 });
    const small = new SensitivityObserver(cfg);
    small.accept(snapshot(cfg, 0, rect(2, 2, 2, 2, 80)));
    expect(row(small, 48, 128, 25).baseline.trackedIndividuals).toBe(1);
    expect(row(small, 48, 512, 25).baseline.trackedIndividuals).toBe(0);
    expect(row(small, 96, 128, 25).baseline.trackedIndividuals).toBe(0);
  });

  it("rejects missing or off-grid readbacks before feeding any cadence branch", () => {
    const observer = new SensitivityObserver(cfg);
    expect(() => observer.results()).toThrow(/no baseline/);
    observer.accept(snapshot(cfg, 100_000, []));
    expect(() => observer.accept(snapshot(cfg, 100_050, []))).toThrow(/25-step grid/);
    expect(observer.fineObservedSteps).toEqual([100_000]);
  });

  it("replays the same start to an exact terminal physics hash without observer calls", async () => {
    const start = allocState(cfg);
    start.step = 100_000;
    const terminal = cloneState(start);
    terminal.step += 200;
    const counts: number[] = [], stages: string[] = [];
    const replay = cloneState(start);
    let drains = 0;
    const driver = {
      run(count: number) { counts.push(count); replay.step += count; },
      async settle() {},
      async drainLedger() { drains++; return { events: [1, 2], dropped: 0 }; },
      async readState() { return replay; },
    };
    const result = await runReferenceReplay(driver, start.step, 200, stateHash(terminal), (stage) => stages.push(stage));
    expect(counts).toEqual([100, 100]);
    expect(drains).toBe(2);
    expect(result).toMatchObject({ step: 100_200, matchedMeasured: true, stateHash: stateHash(terminal),
      drainedMutationEvents: 4, droppedMutationEvents: 0, chunks: 2, chunkSteps: 100 });
    expect(stages).toEqual(["before reference steps ending 100100", "after reference steps ending 100100",
      "before reference steps ending 100200", "after reference steps ending 100200",
      "before reference terminal readback", "after reference terminal readback"]);
    replay.step = start.step;
    replay.cells[0]++;
    expect((await runReferenceReplay({ ...driver, run: (count) => { replay.step += count; } },
      start.step, 200, stateHash(terminal), () => {})).matchedMeasured).toBe(false);
  });

  it("stops a reference replay at shared cap checkpoints and rejects event-buffer loss", async () => {
    const state = allocState(cfg);
    const counts: number[] = [];
    const driver = { run: (count: number) => { counts.push(count); state.step += count; },
      settle: async () => {}, drainLedger: async () => ({ events: [], dropped: 0 }), readState: async () => state };
    await expect(runReferenceReplay(driver, 0, 200, "hash", (stage) => {
      if (stage === "before reference steps ending 200") throw new Error("cap reached");
    })).rejects.toThrow(/cap reached/);
    expect(counts).toEqual([100]);
    await expect(runReferenceReplay({ ...driver, drainLedger: async () => ({ events: [], dropped: 1 }) },
      state.step, 200, "hash", () => {})).rejects.toThrow(/buffer dropped/);
  });
});
