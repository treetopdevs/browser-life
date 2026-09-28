import { describe, expect, it } from "vitest";
import { applyMigration, cellCount, cloneState, defaultConfig, buildWorld, generalistGenome, MAX_STEP, stateHash, type WorldState } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { observeCensus, restoreObservers, serializeObservers } from "@bl/runner";
import { LabExecution, type LabSimulation } from "../src/execution.ts";

const settings = { censusEvery: 100, deepEvery: 5, activityThreshold: null };
function initial(step = 0, migration = 0) {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, kernelRadius: 2, tilesX: 2, tilesY: 1,
    ...(migration ? { migrationPeriod: migration, migrantCount: 2 } : {}) };
  const state = buildWorld(cfg, { nutrient: 20, founders: [{ x: 3, y: 3, radius: 2, genome: generalistGenome(cfg.defaultMu, cfg.defaultSigma), biomass: 100, energy: 200 }] });
  state.step = step;
  return state;
}

// Executes the real reference physics, observation and migration. Only GPU
// readback timing/failure is substituted; no execution policy is mocked.
class CpuSimulation implements LabSimulation {
  ref: RefSim;
  events: MutationEvent[] = [];
  dropped = 0;
  drains = 0;
  runs: number[] = [];
  uploads: number[] = [];
  destroyed = false;
  fail: "drain" | "snapshot" | "migration" | "run" | "observer" | null = null;
  beforeDrain?: () => Promise<void>;
  beforeSnapshot?: () => Promise<void>;
  beforeState?: () => Promise<void>;
  constructor(state = initial()) { this.ref = new RefSim(cloneState(state)); }
  get cfg() { return this.ref.state.cfg; }
  get step() { return this.ref.state.step; }
  run(n: number) {
    if (this.fail === "run") throw new Error("submission failed");
    this.runs.push(n);
    this.events.push(...this.ref.run(n));
  }
  async drainLedger() {
    this.drains++;
    const events = this.events.splice(0);
    await this.beforeDrain?.();
    if (this.fail === "drain") throw new Error("drain failed");
    return { events, dropped: this.dropped, flux: this.ref.state.flux, step: this.step, lightIn: this.ref.state.lightIn, heatOut: this.ref.state.heatOut };
  }
  async readSnapshot() {
    await this.beforeSnapshot?.();
    if (this.fail === "snapshot") throw new Error("snapshot failed");
    const s = this.ref.state;
    return { step: s.step, cells: this.fail === "observer" ? new Proxy(s.cells, { get() { throw new Error("observer input failed"); } }) : s.cells.slice(), genomeHead: s.genome.slice(0, cellCount(s.cfg) * 4), flux: s.flux };
  }
  async readState() { await this.beforeState?.(); return cloneState(this.ref.state); }
  upload(state: WorldState) {
    if (this.fail === "migration") throw new Error("migration failed");
    this.uploads.push(state.step);
    this.ref = new RefSim(cloneState(state));
  }
  destroy() { this.destroyed = true; }
}
function setup(state = initial(), overrides: Partial<ConstructorParameters<typeof LabExecution>[2]> = {}) {
  const sim = new CpuSimulation(state);
  const observed: number[] = [];
  const execution = new LabExecution(sim, settings, {
    waitForIdle: async () => {}, isCurrent: () => true,
    onObservation: (c) => { observed.push(c.step); }, ...overrides,
  });
  return { sim, execution, observed };
}

describe("lab execution", () => {
  it("clips frames at each census and settles a partial interval exactly once", async () => {
    const { sim, execution, observed } = setup();
    expect(await execution.advanceFrame(250)).toBe(100);
    expect(await execution.advanceFrame(150)).toBe(100);
    expect(await execution.advanceFrame(50)).toBe(50);
    expect(observed).toEqual([100, 200]);
    const saved = await execution.checkpoint();
    expect(saved.advanced).toBe(50);
    expect(saved.state.step).toBe(300);
    expect(saved.observer.step).toBe(300);
    expect(saved.observer.censusIdx).toBe(3);
    expect((await execution.checkpoint()).advanced).toBe(0);
    expect(sim.drains).toBe(3);
    expect(sim.runs.every((n) => n <= 64)).toBe(true);
  });

  it.each([[0, 250], [200, 200]])("preserves imported cadence with migrationPeriod %i", async (period, boundary) => {
    const { execution, observed, sim } = setup(initial(150, period));
    await execution.advanceFrame(500);
    expect(observed).toEqual([boundary]);
    expect((await execution.checkpoint()).state.step).toBe(boundary);
    expect(sim.uploads).toEqual(period ? [200] : []);
  });

  it("rejects incompatible migration cadence before stepping", () => {
    expect(() => setup(initial(0, 20))).toThrow(/not a multiple/);
  });

  it("produces identical physics and observer checkpoints across frame partitions and restore", async () => {
    const a = setup(), b = setup();
    for (let n = 0; n < 50; n++) await a.execution.advanceFrame(4);
    await b.execution.advanceFrame(100);
    const midway = await b.execution.checkpoint();
    const resumed = setup(midway.state, { observer: midway.observer });
    await resumed.execution.advanceFrame(100);
    const [ac, bc] = await Promise.all([a.execution.checkpoint(), resumed.execution.checkpoint()]);
    expect(stateHash(ac.state)).toBe(stateHash(bc.state));
    expect(ac.observer).toEqual(bc.observer);
  });

  it("commits observation before migration and reports dropped mutation events", async () => {
    const state = initial(99, 100);
    state.cfg.migrantCount = 64; // Rotate whole tiles, making the observation order visible.
    state.cfg.thetaMass = 16;
    const expected = new CpuSimulation(state);
    expected.run(1);
    const before = restoreObservers(undefined, settings);
    observeCensus(before, expected.cfg, await expected.readSnapshot(), expected.events.length + 3);
    const migrated = applyMigration(await expected.readState(), 100).state;
    const after = restoreObservers(undefined, settings);
    observeCensus(after, expected.cfg, await new CpuSimulation(migrated).readSnapshot(), expected.events.length + 3);
    expect(serializeObservers(before, 100, settings)).not.toEqual(serializeObservers(after, 100, settings));

    let drops = 0;
    const { sim, execution } = setup(state, { onObservation: (_, dropped) => { drops += dropped; } });
    sim.dropped = 3;
    expect(await execution.advanceFrame(100)).toBe(1);
    const saved = await execution.checkpoint();
    expect(sim.uploads).toEqual([100]);
    expect(drops).toBe(3);
    expect(saved.observer).toEqual(serializeObservers(before, 100, settings));
    expect(stateHash(saved.state)).toBe(stateHash(migrated));
  });

  it.each(["drain", "snapshot", "migration", "run", "observer"] as const)("permanently refuses advancement and checkpoints after %s failure", async (failure) => {
    const { sim, execution } = setup(initial(0, 100));
    sim.fail = failure;
    await expect(execution.advanceFrame(100)).rejects.toThrow(/failed/);
    expect(execution.failure).toMatch(/history is incomplete/);
    const drains = sim.drains;
    sim.fail = null;
    await expect(execution.advanceFrame(1)).rejects.toThrow(/history is incomplete/);
    await expect(execution.checkpoint()).rejects.toThrow(/history is incomplete/);
    await expect(execution.verify(10, async (s) => new CpuSimulation(s))).rejects.toThrow(/history is incomplete/);
    expect(sim.drains).toBe(drains);
  });

  it("rejects a frame past the step limit without invalidating the world", async () => {
    const { sim, execution } = setup(initial(MAX_STEP - 1));
    await expect(execution.advanceFrame(4)).rejects.toThrow(/step limit/);
    expect(execution.failure).toBeNull();
    expect(sim.runs).toEqual([]);
    expect((await execution.checkpoint()).state.step).toBe(MAX_STEP - 1);
    expect(await execution.advanceFrame(1)).toBe(1);
  });

  it("refuses reuse after GPU completion fails following submitted steps", async () => {
    const { sim, execution } = setup(initial(), { waitForIdle: async () => { throw new Error("device lost"); } });
    await expect(execution.advanceFrame(20)).rejects.toThrow("device lost");
    expect(sim.step).toBe(20);
    await expect(execution.checkpoint()).rejects.toThrow(/history is incomplete/);
  });

  it("keeps committed history usable when its display throws", async () => {
    const errors: string[] = [];
    const { execution } = setup(initial(), {
      onObservation: () => { throw new Error("UI failed"); },
      onDisplayError: (message) => { errors.push(message); },
    });
    await execution.advanceFrame(100);
    expect(errors).toEqual(["UI failed"]);
    expect(execution.failure).toBeNull();
    expect((await execution.checkpoint()).observer.censusIdx).toBe(1);
    await execution.advanceFrame(100);
    expect((await execution.checkpoint()).observer.censusIdx).toBe(2);
  });

  it.each(["beforeDrain", "beforeSnapshot", "beforeState"] as const)("rejects stale work without publishing or poisoning at %s", async (hook) => {
    let current = true;
    const { execution, sim, observed } = setup(initial(0, 100), { isCurrent: () => current });
    sim[hook] = async () => { current = false; };
    await expect(execution.advanceFrame(100)).rejects.toThrow(/replaced/);
    expect(observed).toEqual([]);
    expect(sim.uploads).toEqual([]);
    expect(execution.failure).toBeNull();
    await expect(execution.checkpoint()).rejects.toThrow(/replaced/);
  });

  it.each([0, 150])("replays identical migration positions from step %i and destroys the twin", async (start) => {
    const { execution, sim } = setup(initial(start, 200));
    await execution.advanceFrame(25);
    let twin: CpuSimulation | undefined;
    const result = await execution.verify(400, async (state) => (twin = new CpuSimulation(state)));
    expect(result.liveHash).toBe(result.twinHash);
    expect(result.from).toBe(start + 25);
    expect(twin!.uploads).toEqual(sim.uploads);
    expect(twin!.drains).toBe(0);
    expect(twin!.destroyed).toBe(true);
  });

  it("destroys a failed replay twin without poisoning successful live advancement", async () => {
    const { execution } = setup();
    let twin: CpuSimulation | undefined;
    await expect(execution.verify(100, async (state) => {
      twin = new CpuSimulation(state); twin.fail = "run"; return twin;
    })).rejects.toThrow(/submission failed/);
    expect(twin!.destroyed).toBe(true);
    expect(execution.failure).toBeNull();
    expect((await execution.checkpoint()).observer.censusIdx).toBe(1);
  });
});
