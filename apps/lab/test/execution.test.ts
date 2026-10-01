import { describe, expect, it } from "vitest";
import {
  applyMigration, cellCount, cloneState, defaultConfig, buildWorld, encodeCheckpoint, generalistGenome, initWorld, MAX_STEP, presetConfig, PRESETS, stateHash, CH,
  type WorldConfig, type WorldState,
} from "@bl/schema";
import { applyLesion, RefSim, type MutationEvent } from "@bl/sim-ref";
import {
  applyBoundary, decodeArtifact, observeCensus, pondContext, pondContinuationError, restoreObservers, serializeObservers,
  type ObserverState, type PondCycle,
} from "@bl/runner";
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

// Pond worlds (docs/scaffold-integration-v1.md, "Lab"): ponds-small's physics at seed 1, with a 4-step
// period and a census every 2 steps, since the reference runs this 128 x 128 world (the smallest valid
// pond config) at 0.3-0.6 s a step. The runner's own sequence, applied directly, is the reference.
const pondSettings = { censusEvery: 2, deepEvery: 5, activityThreshold: null };
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
function pondWorld(step = 0, extra: Partial<WorldConfig> = {}) {
  const state = initWorld(presetConfig(pondsSmall, 1, { pondPeriod: 4, ...extra }), pondsSmall.init);
  state.step = step;
  return state;
}
/** The observer an import of `state` carries: fresh, except that its last cycle is floor(step / pondPeriod), or `lastCycle`. */
function pondObserver(state: WorldState, lastCycle = Math.floor(state.step / state.cfg.pondPeriod!)): ObserverState {
  return { ...serializeObservers(restoreObservers(undefined, pondSettings), state.step, pondSettings), ponds: { lastCycle } };
}
function pondSetup(state: WorldState, overrides: Partial<ConstructorParameters<typeof LabExecution>[2]> = {}) {
  const sim = new CpuSimulation(state);
  const observed: number[] = [];
  const cycles: { step: number; b: number; donors: number[] }[] = [];
  const execution = new LabExecution(sim, pondSettings, {
    start: state, ...(state.step > 0 ? { observer: pondObserver(state) } : {}),
    waitForIdle: async () => {}, isCurrent: () => true,
    onObservation: (c) => { observed.push(c.step); },
    onPondCycle: (cycle, step) => { cycles.push({ step, b: cycle.b, donors: cycle.donors }); }, ...overrides,
  });
  return { sim, execution, observed, cycles };
}
/**
 * runner.ts's sequence at every census up to `to`, on the same reference physics: observe the
 * pre-cycle state, then applyBoundary with the history's pondContext, then record the cycle in
 * the observer. Returns the state hash, observer and cycle at each census.
 */
async function runnerReference(start: WorldState, to: number) {
  const sim = new CpuSimulation(start);
  const obs = restoreObservers(undefined, pondSettings, start.cfg);
  const ctx = pondContext(start);
  const at = new Map<number, { hash: string; observer: ObserverState; cycle: PondCycle | null }>();
  while (sim.step < to) {
    sim.run(pondSettings.censusEvery);
    const ledger = await sim.drainLedger();
    observeCensus(obs, sim.cfg, await sim.readSnapshot(), ledger.events.length);
    const { ponds } = await applyBoundary(sim, sim.step, ctx);
    if (ponds) obs.ponds = { lastCycle: ponds.b };
    at.set(sim.step, { hash: stateHash(await sim.readState()), observer: serializeObservers(obs, sim.step, pondSettings), cycle: ponds });
  }
  return at;
}

describe("lab execution of pond worlds", () => {
  it("cycles at census boundaries exactly as the runner's helper does, in checkpoints, the replay twin and a restore", async () => {
    const start = pondWorld();
    const want = await runnerReference(start, 8);
    const { sim, execution, observed, cycles } = pondSetup(start);
    expect(await execution.advanceFrame(3)).toBe(2);
    expect(await execution.advanceFrame(1)).toBe(1);
    // Settling at t=4 runs that boundary's census on the pre-cycle state, then the cycle.
    const atCycle = await execution.checkpoint();
    expect(atCycle.advanced).toBe(1);
    expect(stateHash(atCycle.state)).toBe(want.get(4)!.hash);
    expect(atCycle.observer).toEqual(want.get(4)!.observer);
    expect(atCycle.observer.ponds).toEqual({ lastCycle: 1 });
    // An artifact the runner accepts as a continuation.
    const artifact = decodeArtifact(encodeCheckpoint(atCycle.state, atCycle.observer));
    expect(pondContinuationError(artifact.state.cfg, artifact.observer, artifact.state.step)).toBeNull();

    let twin: CpuSimulation | undefined;
    const replay = await execution.verify(4, async (state) => (twin = new CpuSimulation(state)));
    expect(replay.liveHash).toBe(replay.twinHash);
    expect(twin!.uploads).toEqual([8]);
    expect(sim.uploads).toEqual([4, 8]);
    const end = await execution.checkpoint();
    expect(end.advanced).toBe(0);
    expect(stateHash(end.state)).toBe(want.get(8)!.hash);
    expect(end.observer).toEqual(want.get(8)!.observer);
    expect(end.observer.ponds).toEqual({ lastCycle: 2 });
    expect(observed).toEqual([2, 4, 6, 8]);
    expect(cycles).toEqual([4, 8].map((step) => ({ step, b: step / 4, donors: want.get(step)!.cycle!.donors })));
    expect(cycles[0].donors.length).toBeGreaterThan(0);

    // The post-cycle artifact continues identically, never re-running the cycle at its own start.
    const resumed = pondSetup(artifact.state, { observer: artifact.observer });
    expect(await resumed.execution.advanceFrame(4)).toBe(2);
    expect(await resumed.execution.advanceFrame(4)).toBe(2);
    const continued = await resumed.execution.checkpoint();
    expect(resumed.sim.uploads).toEqual([8]);
    expect(stateHash(continued.state)).toBe(want.get(8)!.hash);
    expect(continued.observer).toEqual(want.get(8)!.observer);
  }, 60_000);

  it("rejects an incompatible pond cadence, a missing start state and a pre-cycle observer before stepping", () => {
    const options = { waitForIdle: async () => {}, isCurrent: () => true };
    const off = pondWorld(0, { pondPeriod: 5 });
    expect(() => new LabExecution(new CpuSimulation(off), pondSettings, { ...options, start: off })).toThrow(/pondPeriod 5 is not a multiple/);
    expect(() => new LabExecution(new CpuSimulation(pondWorld()), pondSettings, options)).toThrow(/needs its start state/);
    const s4 = pondWorld(4);
    expect(() => pondSetup(s4, { observer: pondObserver(s4, 0) })).toThrow(/pre-cycle state/);
    expect(() => pondSetup(s4, { observer: undefined })).toThrow(/pond-cycle field/);
  });

  it("realigns an imported mid-period pond world to the absolute census grid and cycles at the absolute step", async () => {
    // From t=5 the censuses fall at 6 and 8 (not 7 and 9), and the cycle at 8 = 2 x pondPeriod.
    const { sim, execution, observed, cycles } = pondSetup(pondWorld(5));
    expect(await execution.advanceFrame(10)).toBe(1);
    expect(await execution.advanceFrame(10)).toBe(2);
    expect(observed).toEqual([6, 8]);
    expect(sim.uploads).toEqual([8]);
    expect(cycles.map((c) => [c.step, c.b])).toEqual([[8, 2]]);
    expect((await execution.checkpoint()).observer.ponds).toEqual({ lastCycle: 2 });
  }, 30_000);

  it("records a cont boundary without changing the state", async () => {
    const { sim, execution, cycles } = pondSetup(pondWorld(2, { pondArm: "cont" }));
    await execution.advanceFrame(2);
    expect(sim.uploads).toEqual([]);
    expect(cycles).toEqual([{ step: 4, b: 1, donors: [] }]);
    expect((await execution.checkpoint()).observer.ponds).toEqual({ lastCycle: 1 });
  }, 30_000);

  it.each(["upload", "conservation"] as const)("permanently refuses advancement after a failed pond cycle (%s)", async (failure) => {
    const { sim, execution, observed, cycles } = pondSetup(pondWorld(2));
    if (failure === "upload") sim.fail = "migration";
    else sim.ref.state.cells[CH.A * cellCount(sim.cfg)] += 1; // pond 0 no longer holds M_r
    await expect(execution.advanceFrame(2)).rejects.toThrow(failure === "upload" ? /migration failed/ : /pond 0 holds matter/);
    expect(execution.failure).toMatch(/history is incomplete/);
    expect(observed).toEqual([]);
    expect(cycles).toEqual([]);
    const drains = sim.drains;
    sim.fail = null;
    await expect(execution.advanceFrame(2)).rejects.toThrow(/history is incomplete/);
    await expect(execution.checkpoint()).rejects.toThrow(/history is incomplete/);
    expect(sim.drains).toBe(drains);
    expect(sim.uploads).toEqual([]);
  }, 30_000);

  it("keeps M_r and the ledger valid across lesions, so the next cycle's conservation check passes", async () => {
    const s2 = pondWorld(2);
    const { sim, execution, cycles } = pondSetup(s2);
    await execution.advanceFrame(1);
    const before = await sim.readState();
    // One lesion on pond 0's founder disc, one across the corner where all four ponds meet.
    applyLesion(sim.ref, 36, 32, 8);
    applyLesion(sim.ref, 64, 64, 12);
    const after = await sim.readState();
    const bound = (s: WorldState) => s.cells.subarray(CH.B * cellCount(s.cfg), (CH.B + 1) * cellCount(s.cfg)).reduce((a, v) => a + v, 0);
    expect(bound(after)).toBeLessThan(bound(before));
    expect(after.heatOut).toBeGreaterThan(before.heatOut);
    expect(pondContext(after)).toEqual(pondContext(s2));
    await execution.advanceFrame(1);
    expect(execution.failure).toBeNull();
    expect(cycles.map((c) => c.b)).toEqual([1]);
    expect((await execution.checkpoint()).observer.ponds).toEqual({ lastCycle: 1 });
  }, 30_000);

  it("keeps a pond world usable when its cycle display throws", async () => {
    const errors: string[] = [];
    const { execution } = pondSetup(pondWorld(2), {
      onPondCycle: () => { throw new Error("pond UI failed"); },
      onDisplayError: (message) => { errors.push(message); },
    });
    await execution.advanceFrame(2);
    expect(errors).toEqual(["pond UI failed"]);
    expect(execution.failure).toBeNull();
    expect((await execution.checkpoint()).observer.ponds).toEqual({ lastCycle: 1 });
  }, 30_000);
});
