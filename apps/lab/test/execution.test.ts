import { describe, expect, it } from "vitest";
import {
  applyMigration, cellCount, cloneState, defaultConfig, buildWorld, encodeCheckpoint, generalistGenome, initWorld, MAX_STEP, presetConfig, PRESETS, stateHash, CH,
  type WorldConfig, type WorldState,
} from "@bl/schema";
import { applyCellPass, applyLesion, RefSim, type MutationEvent } from "@bl/sim-ref";
import { M3_FOUNDERS, founderGenome } from "@bl/schema";
import { applyFeed, applyPondCycle, clampLesionRadius, pondDonors, pondMatter, pondTermValues, pondTraits, POND_TERMS, type Intervention } from "@bl/schema";
import {
  applyBoundary, decodeArtifact, observeCensus, pondCensus, pondContext, pondContinuationError, restoreObservers, serializeObservers,
  type ObserverState, type PondCycle,
} from "@bl/runner";
import { MutationEdges } from "@bl/lineage";
import { LabExecution, PondWaitingError, type LabSimulation, type PondSurvey } from "../src/execution.ts";

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
  lesion(cx: number, cy: number, r: number) {
    const eff = clampLesionRadius(this.cfg, r);
    applyLesion(this.ref, cx, cy, eff);
    return eff;
  }
  async feed(cx: number, cy: number, r: number, amount: number) {
    await this.beforeFeed?.();
    return applyFeed(this.ref.state, cx, cy, r, amount);
  }
  beforeFeed?: () => Promise<void>;
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

  it("keeps every mutation edge through a checkpoint and resumes them, exactly as a continuous run", async () => {
    const state = initial();
    state.cfg = { ...state.cfg, mutRate: 429_497 * 80 };
    const reference = new RefSim(cloneState(state));
    const edgesAt = (steps: number) => {
      const e = new MutationEdges();
      e.append(reference.run(steps));
      return e;
    };
    const { execution } = setup(state);
    await execution.advanceFrame(100);
    await execution.advanceFrame(100);
    await execution.advanceFrame(50);
    const saved = await execution.checkpoint();
    const first = edgesAt(300);
    expect(first.length).toBeGreaterThan(3);
    expect(saved.edges).toBe(first.length);
    expect(Array.from(execution.edges.words())).toEqual(Array.from(first.words()));

    const carried = new MutationEdges(execution.edges.words());
    const resumed = setup(saved.state, { observer: saved.observer, lineage: { edges: carried, dropped: saved.dropped } });
    await resumed.execution.advanceFrame(100);
    const all = new MutationEdges(first.words());
    all.append(reference.run(100));
    expect(Array.from(resumed.execution.edges.words())).toEqual(Array.from(all.words()));
  });

  it("counts dropped mutation events and refuses edges minted past the world's step", async () => {
    const { sim, execution } = setup();
    sim.dropped = 3;
    await execution.advanceFrame(100);
    expect(execution.dropped).toBe(3);
    expect((await execution.checkpoint()).dropped).toBe(3);
    const ahead = new MutationEdges();
    ahead.append([{ childHi: 5, childLo: 1, parentHi: 0, parentLo: 1 }]);
    expect(() => setup(initial(0), { lineage: { edges: ahead, dropped: 0 } })).toThrow(/run past the simulation's step/);
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

describe("lab execution of fed worlds", () => {
  it("carries the feed total in the observer state, through a checkpoint artifact and a restore", async () => {
    const { execution } = setup();
    expect(execution.fed).toEqual({ matter: 0, feeds: 0 });
    await execution.advanceFrame(100);
    // A never-fed history's observer state has no `fed` field, so its artifact and digest are as before.
    expect("fed" in (await execution.checkpoint()).observer).toBe(false);
    execution.recordFeed(464);
    execution.recordFeed(-64);
    expect(execution.fed).toEqual({ matter: 400, feeds: 2 });
    expect(() => execution.recordFeed(1.5)).toThrow(/not an integer/);
    const saved = await execution.checkpoint();
    expect(saved.observer.fed).toEqual({ matter: 400, feeds: 2 });
    const artifact = decodeArtifact(encodeCheckpoint(saved.state, saved.observer));
    expect(artifact.observer.fed).toEqual({ matter: 400, feeds: 2 });
    const resumed = setup(artifact.state, { observer: artifact.observer as ObserverState });
    expect(resumed.execution.fed).toEqual({ matter: 400, feeds: 2 });
    resumed.execution.recordFeed(8);
    expect((await resumed.execution.checkpoint()).observer.fed).toEqual({ matter: 408, feeds: 3 });
    // A malformed total in a file from elsewhere is refused at decode, not added to.
    for (const fed of [{ matter: "400", feeds: "2" }, {}, { matter: 400, feeds: 0 }, { matter: 1.5, feeds: 1 }, null])
      expect(() => decodeArtifact(encodeCheckpoint(saved.state, { ...saved.observer, fed } as unknown as ObserverState))).toThrow(/observer fed is malformed/);
  });
});

describe("lab execution replaying logged interventions", () => {
  // The observed history: a checkpoint at t=100 that has seen nothing, a feed at that same step, a lesion
  // and a drain at t=150 (inside a census interval), a lesion at the census step t=200, then on to t=300.
  // Returns the log as the worker would have written it, and the observed world at t=200 (after its
  // lesion) and t=300.
  async function observed() {
    const { sim, execution } = setup();
    await execution.advanceFrame(100);
    const start = await execution.checkpoint();
    const log: Intervention[] = [];
    const feed = async (x: number, y: number, r: number, amount: number) => {
      const step = sim.step, res = await sim.feed(x, y, r, amount);
      execution.recordFeed(res.matter);
      log.push({ step, kind: "feed", x, y, r: res.radius, amount, matter: res.matter });
    };
    await feed(3, 3, 2, 24);
    await execution.advanceFrame(50);
    log.push({ step: sim.step, kind: "lesion", x: 3, y: 3, r: sim.lesion(3, 3, 1) });
    await feed(11, 4, 2, -5);
    // Settle to the census at t=200, then a lesion there that removes the founder: made after that
    // census, so its deaths belong to the census at t=300. A replay that applied it before observing
    // t=200 would reach the same physics with a different observer history.
    await execution.checkpoint();
    log.push({ step: sim.step, kind: "lesion", x: 3, y: 3, r: sim.lesion(3, 3, 3) });
    const at200 = await execution.checkpoint();
    await execution.advanceFrame(100);
    const at300 = await execution.checkpoint();
    expect(log.map((iv) => iv.step)).toEqual([100, 150, 150, 200]);
    expect(JSON.stringify(at300.observer.tracker)).not.toBe(JSON.stringify(at200.observer.tracker));
    expect(log.filter((iv) => iv.kind === "feed").every((iv) => iv.kind === "feed" && iv.matter !== 0)).toBe(true);
    return { start, log, at200, at300 };
  }
  const resume = (h: Awaited<ReturnType<typeof observed>>, booked: Intervention[] = []) =>
    setup(h.start.state, { observer: h.start.observer, onReplayed: (iv) => { booked.push(iv); } });
  const same = (a: { state: WorldState; observer: ObserverState }, b: { state: WorldState; observer: ObserverState }) => {
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(JSON.stringify(a.observer)).toBe(JSON.stringify(b.observer));
  };

  it("reaches the observed world, physics and observer, booking each intervention once and in order", async () => {
    const h = await observed();
    const booked: Intervention[] = [];
    const { execution } = resume(h, booked);
    execution.queueReplay(h.log);
    expect(execution.pendingReplay.length).toBe(4);
    // Frames of any size (to t=130, 200 and 300): the traversal stops at each intervention's step by itself.
    for (const n of [30, 500, 500]) await execution.advanceFrame(n);
    same(await execution.checkpoint(), h.at300);
    expect(booked).toEqual(h.log);
    expect(execution.pendingReplay.length).toBe(0);
    expect(execution.fed).toEqual(h.at300.observer.fed);
    // Without the replay the same steps reach a different world.
    const plain = resume(h);
    for (const n of [500, 500]) await plain.execution.advanceFrame(n);
    expect(stateHash((await plain.execution.checkpoint()).state)).not.toBe(stateHash(h.at300.state));
  });

  it("applies due interventions when a checkpoint settles, at its own step and on the way to the census", async () => {
    const h = await observed();
    // At the checkpoint's own step, before any frame: the feed logged at t=100 is due at once.
    const a = resume(h);
    a.execution.queueReplay(h.log);
    const saved = await a.execution.checkpoint();
    expect(saved.state.step).toBe(100);
    expect(saved.observer.fed?.feeds).toBe(1);
    expect(a.execution.pendingReplay.length).toBe(3);
    // A zero-step frame applies what is due at the current step and moves nothing: how a jump makes the
    // restored world whole before anything reads it.
    const c = resume(h);
    c.execution.queueReplay(h.log);
    expect(await c.execution.advanceFrame(0)).toBe(0);
    expect([c.sim.step, c.execution.pendingReplay.length, c.execution.fed.feeds]).toEqual([100, 3, 1]);
    // Stopped at t=130 with the lesion and the drain still queued for t=150: settlement to the census at
    // t=200 must stop there, apply them, observe t=200, and then apply the lesion logged at t=200.
    const b = resume(h);
    b.execution.queueReplay(h.log);
    await b.execution.advanceFrame(30);
    expect(b.sim.step).toBe(130);
    expect(b.execution.pendingReplay.length).toBe(3);
    same(await b.execution.checkpoint(), h.at200);
    expect(b.execution.pendingReplay.length).toBe(0);
  });

  it("replays the same interventions in the verification twin", async () => {
    const h = await observed();
    const { execution } = resume(h);
    execution.queueReplay(h.log);
    const v = await execution.verify(200, async (state) => new CpuSimulation(state));
    expect(v.twinHash).toBe(v.liveHash);
    expect(v.liveHash).toBe(stateHash(h.at300.state));
  });

  it("marks the world failed when a replayed feed does not move what the log says, and goes no further", async () => {
    const h = await observed();
    const wrong = h.log.map((iv) => (iv.kind === "feed" && iv.step === 150 ? { ...iv, matter: iv.matter - 1 } : iv));
    const { sim, execution } = resume(h);
    execution.queueReplay(wrong);
    await expect((async () => { for (const n of [500, 500]) await execution.advanceFrame(n); })()).rejects.toThrow(/not the observed history/);
    expect(execution.failure).toMatch(/not the observed history/);
    const stuck = sim.step;
    await expect(execution.advanceFrame(10)).rejects.toThrow(/not the observed history/);
    await expect(execution.checkpoint()).rejects.toThrow(/not the observed history/);
    expect(sim.step).toBe(stuck);
    // The failed entry was not dropped, nor the one after it.
    expect(execution.pendingReplay.length).toBe(2);
  });

  it("refuses a queue behind the world or out of order, and drops the queue on request", async () => {
    const h = await observed();
    const { execution } = resume(h);
    expect(() => execution.queueReplay([{ step: 99, kind: "lesion", x: 1, y: 1, r: 1 }])).toThrow(/behind t=100/);
    expect(() => execution.queueReplay([h.log[1], h.log[0]])).toThrow(/behind t=150/);
    execution.queueReplay(h.log);
    expect(execution.dropReplay()).toBe(4);
    expect(execution.pendingReplay.length).toBe(0);
    await execution.advanceFrame(100);
    expect(execution.fed).toEqual({ matter: 0, feeds: 0 });
  });
});

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

// Breeder mode: at a pond boundary the census is taken and the cycle waits for a person's donors.
describe("lab execution in breeder mode", () => {
  /** A pond world in breeder mode, with the surveys it stopped on. */
  function breeder(state = pondWorld(), overrides: Partial<ConstructorParameters<typeof LabExecution>[2]> = {}) {
    const surveys: PondSurvey[] = [];
    const s = pondSetup(state, { onPondAwait: (survey) => { surveys.push(survey); }, ...overrides });
    s.execution.setHandPicks(true);
    return { ...s, surveys };
  }
  /** The reference world `steps` steps on from `start`, with no cycle applied. */
  function stepped(start: WorldState, steps: number): WorldState {
    const ref = new RefSim(cloneState(start));
    ref.run(steps);
    return cloneState(ref.state);
  }

  it("stops at the boundary with the census taken and the cycle not applied, and holds the world there", async () => {
    const start = pondWorld();
    const { sim, execution, observed, cycles, surveys } = breeder(start);
    expect(execution.handPicks).toBe(true);
    expect(await execution.advanceFrame(2)).toBe(2);
    expect(execution.awaiting).toBeNull();
    expect(await execution.advanceFrame(2)).toBe(2);
    const pre = stepped(start, 4);
    const waiting = execution.awaiting!;
    expect(surveys).toEqual([waiting]);
    expect([waiting.step, waiting.cycle]).toEqual([4, 1]);
    expect(waiting.suggested).toEqual(pondDonors(pre, 1, "scaf", 8));
    expect(waiting.suggested).toHaveLength(1);
    for (const term of POND_TERMS) expect(waiting.terms[term]).toEqual(pondTermValues(pre, term, 8));
    // The census of t=4 saw the pre-cycle world; nothing was uploaded, and the world is that pre-cycle state.
    expect(observed).toEqual([2, 4]);
    expect(cycles).toEqual([]);
    expect(sim.uploads).toEqual([]);
    expect(stateHash(await sim.readState())).toBe(stateHash(pre));
    // It goes nowhere and cannot be saved, verified, queued or taken out of breeder mode until the donors are in.
    expect(await execution.advanceFrame(10)).toBe(0);
    expect(sim.step).toBe(4);
    await expect(execution.checkpoint()).rejects.toThrow(/pond cycle 1 at t=4 is waiting for its donors; choose them before you save or read this world/);
    await expect(execution.verify(2, async (state) => new CpuSimulation(state))).rejects.toThrow(/waiting for its donors; choose them before you verify/);
    expect(() => execution.queueReplay([])).toThrow(/waiting for its donors; choose them before you queue a replay/);
    expect(() => execution.setHandPicks(false)).toThrow(/waiting for its donors; choose them before you leave breeder mode/);
    expect(execution.failure).toBeNull();
    expect(execution.awaiting).toBe(waiting);
  });

  it("refuses, without failing, a checkpoint that settles onto a boundary which then waits", async () => {
    const { sim, execution } = breeder();
    await execution.advanceFrame(2);
    expect(await execution.advanceFrame(1)).toBe(1);
    // Settling to the next census runs the world onto the boundary at t=4: it waits there, and nothing is saved.
    const refusal = await execution.checkpoint().then(() => null, (e) => e);
    expect(refusal).toBeInstanceOf(PondWaitingError);
    expect(String(refusal)).toMatch(/pond cycle 1 at t=4 is waiting for its donors/);
    expect(sim.step).toBe(4);
    expect(sim.uploads).toEqual([]);
    expect(execution.failure).toBeNull();
    expect(execution.awaiting!.step).toBe(4);
    await execution.resolvePond(null);
    const saved = await execution.checkpoint();
    expect([saved.state.step, saved.advanced, saved.observer.ponds]).toEqual([4, 0, { lastCycle: 1 }]);
  });

  it("applies the picked donors exactly as the cycle with picks does, and then goes on to wait at the next boundary", async () => {
    const start = pondWorld();
    const { sim, execution, cycles, observed } = breeder(start);
    await execution.advanceFrame(4);
    await execution.advanceFrame(4);
    const pre = stepped(start, 4);
    const picks = [2, 0];
    // Picks that cannot be donors are refused and leave the world waiting, unharmed.
    await expect(execution.resolvePond([])).rejects.toThrow(/picks must name at least one pond/);
    await expect(execution.resolvePond([9])).rejects.toThrow(/picked pond 9 is not an occupied pond/);
    await expect(execution.resolvePond([1, 1])).rejects.toThrow(/picks repeat a pond: 1, 1/);
    expect(execution.failure).toBeNull();
    expect(execution.awaiting).not.toBeNull();
    expect(sim.uploads).toEqual([]);

    expect(await execution.resolvePond(picks)).toEqual({ step: 4, cycle: 1, donors: picks });
    const want = applyPondCycle(pre, 1, "scaf", 8, pondMatter(start), pondCensus, undefined, picks);
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
    expect(cycles).toEqual([{ step: 4, b: 1, donors: picks }]);
    expect(execution.awaiting).toBeNull();
    await expect(execution.resolvePond(picks)).rejects.toThrow(/no pond cycle is waiting for donors/);
    // The checkpoint at the boundary is the post-cycle world with its cycle recorded, as any pond checkpoint.
    const at4 = await execution.checkpoint();
    expect(at4.advanced).toBe(0);
    expect(at4.observer.ponds).toEqual({ lastCycle: 1 });
    expect(pondContinuationError(at4.state.cfg, at4.observer, at4.state.step)).toBeNull();
    expect(await execution.advanceFrame(2)).toBe(2);
    expect(await execution.advanceFrame(2)).toBe(2);
    expect(execution.awaiting!.cycle).toBe(2);
    expect(observed).toEqual([2, 4, 6, 8]);
  });

  it("with the rule's own donors is the world the rule makes without breeder mode, physics and observer", async () => {
    const start = pondWorld();
    const ref = await runnerReference(start, 4);
    const { execution } = breeder(start);
    await execution.advanceFrame(2);
    await execution.advanceFrame(2);
    const suggested = execution.awaiting!.suggested;
    expect(await execution.resolvePond(null)).toEqual({ step: 4, cycle: 1, donors: suggested });
    const at4 = await execution.checkpoint();
    expect(stateHash(at4.state)).toBe(ref.get(4)!.hash);
    expect(at4.observer).toEqual(ref.get(4)!.observer);
    expect(suggested).toEqual(ref.get(4)!.cycle!.donors);
    // Out of breeder mode again, the next boundary cycles by itself.
    execution.setHandPicks(false);
    expect(execution.handPicks).toBe(false);
  });

  it("replays logged picks without waiting, live and in the twin, and waits again past the replayed history", async () => {
    const start = pondWorld();
    // The observed history: picks at the boundaries t=4 and t=8, then on to the census at t=10.
    const first = breeder(start);
    const log: Intervention[] = [];
    for (const donors of [[3, 1], [0]]) {
      while (!first.execution.awaiting) await first.execution.advanceFrame(2);
      const done = await first.execution.resolvePond(donors);
      log.push({ step: done.step, kind: "pick", cycle: done.cycle, donors: done.donors });
    }
    await first.execution.advanceFrame(2);
    const seen = await first.execution.checkpoint();
    expect(log).toEqual([{ step: 4, kind: "pick", cycle: 1, donors: [3, 1] }, { step: 8, kind: "pick", cycle: 2, donors: [0] }]);
    expect(seen.state.step).toBe(10);

    // A jump back to the start replays it: the picks come from the queue, in order, and no boundary waits.
    const booked: Intervention[] = [];
    const again = breeder(start, { onReplayed: (iv) => { booked.push(iv); } });
    again.execution.queueReplay(log, 10);
    for (let n = 0; n < 5; n++) expect(await again.execution.advanceFrame(2)).toBe(2);
    expect(again.surveys).toEqual([]);
    expect(booked).toEqual(log);
    expect(again.execution.pendingReplay).toEqual([]);
    expect(again.cycles.map((c) => c.donors)).toEqual([[3, 1], [0]]);
    const replayed = await again.execution.checkpoint();
    expect(stateHash(replayed.state)).toBe(stateHash(seen.state));
    expect(JSON.stringify(replayed.observer)).toBe(JSON.stringify(seen.observer));
    // Past the replayed history the next boundary is new, and waits.
    expect(await again.execution.advanceFrame(2)).toBe(2);
    expect(again.execution.awaiting!.step).toBe(12);

    // The verification twin takes the same picks from its own copy of the queue.
    const twin = breeder(start);
    twin.execution.queueReplay(log, 10);
    const v = await twin.execution.verify(10, async (state) => new CpuSimulation(state));
    expect(v.twinHash).toBe(v.liveHash);
    expect(v.liveHash).toBe(stateHash(seen.state));

    // A horizon short of the history's end (a second jump made during a first one's replay, which had dropped the
    // pick at t=8): the boundary at t=8 is past it, so it waits instead of taking the rule's donors unasked.
    const short = breeder(start);
    short.execution.queueReplay(log.slice(0, 1), 7);
    expect(short.execution.replayHorizon).toBe(7);
    for (let n = 0; n < 4; n++) await short.execution.advanceFrame(2);
    expect(short.cycles.map((c) => c.donors)).toEqual([[3, 1]]);
    expect(short.execution.awaiting!.step).toBe(8);
    expect(short.execution.dropReplay()).toBe(0);
    expect(short.execution.replayHorizon).toBe(0);

    // A boundary of the replayed history without a logged pick takes the rule's donors, as it did when first run.
    const ruled = breeder(start);
    ruled.execution.queueReplay([], 6);
    for (let n = 0; n < 3; n++) await ruled.execution.advanceFrame(2);
    expect(ruled.surveys).toEqual([]);
    expect(stateHash((await ruled.execution.checkpoint()).state)).toBe((await runnerReference(start, 6)).get(6)!.hash);
  });

  it("refuses to verify across a boundary that would wait, and a logged pick that is not at a pond boundary", async () => {
    const { execution } = breeder();
    await expect(execution.verify(4, async (state) => new CpuSimulation(state))).rejects.toThrow(/verifying 4 steps would pass the pond boundary at t=4, which waits for donors in breeder mode/);
    expect(execution.failure).toBeNull();
    const short = await execution.verify(2, async (state) => new CpuSimulation(state));
    expect(short.twinHash).toBe(short.liveHash);

    // At a census that is no pond boundary the pick has no cycle to belong to; off the census grid it is never reached as one.
    const census = breeder();
    census.execution.queueReplay([{ step: 2, kind: "pick", cycle: 1, donors: [0] }]);
    await expect(census.execution.advanceFrame(2)).rejects.toThrow(/donors were picked for t=2, which is not a pond boundary/);
    expect(census.execution.failure).toMatch(/census at t=2 failed/);
    const off = breeder();
    off.execution.queueReplay([{ step: 1, kind: "pick", cycle: 1, donors: [0] }]);
    await expect(off.execution.advanceFrame(2)).rejects.toThrow(/replay met a logged pick at t=1 away from its pond boundary/);
  });

  it("does not wait where there is nothing to choose: an ended history, or an arm without donors", async () => {
    // No pond is occupied: the cycle clears the world as ever.
    const empty = pondWorld();
    const n = cellCount(empty.cfg);
    for (let i = 0; i < n; i++) {
      empty.cells[CH.A * n + i] += empty.cells[CH.B * n + i] + empty.cells[CH.P * n + i];
      empty.cells[CH.B * n + i] = 0;
      empty.cells[CH.P * n + i] = 0;
    }
    expect(pondTraits(empty).every((t) => t === 0)).toBe(true);
    const ended = breeder(empty);
    await ended.execution.advanceFrame(2);
    await ended.execution.advanceFrame(2);
    expect(ended.execution.awaiting).toBeNull();
    expect(ended.surveys).toEqual([]);
    expect(ended.cycles).toEqual([{ step: 4, b: 1, donors: [] }]);

    const cont = breeder(pondWorld(2, { pondArm: "cont" }));
    await cont.execution.advanceFrame(2);
    expect(cont.execution.awaiting).toBeNull();
    expect(cont.cycles).toEqual([{ step: 4, b: 1, donors: [] }]);
    expect(cont.sim.uploads).toEqual([]);
  });

  it("marks the world failed when the picked cycle cannot be applied", async () => {
    const { sim, execution } = breeder(pondWorld(2));
    await execution.advanceFrame(2);
    expect(execution.awaiting!.step).toBe(4);
    sim.fail = "migration";
    await expect(execution.resolvePond([0])).rejects.toThrow(/migration failed/);
    expect(execution.failure).toMatch(/census at t=4 failed \(migration failed\)/);
    await expect(execution.advanceFrame(2)).rejects.toThrow(/census at t=4 failed/);
  });
});

describe("lab execution of declared-cell worlds", () => {
  const cfg = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 79, mutRate: 0, cellPeriod: 100, cellMutProb: 2 ** 32 });
  // Two separate bodies of one founder under one id, so the first pass has a daughter to declare.
  const start = () => {
    const s = buildWorld(cfg, {
      nutrient: 32,
      founders: [[6, 6], [18, 18]].map(([x, y]) => ({ x, y, radius: 4, genome: founderGenome(M3_FOUNDERS[0]), biomass: 200, energy: 400 })),
    });
    const n = cellCount(cfg);
    for (let i = 0; i < n; i++) if (s.genome[n + i] === 2) s.genome[n + i] = 1; // G.LIN_LO: the second disc takes the first's id
    return s;
  };

  it("applies the pass at its boundaries as the reference does, records births as edges, and replays them in the twin", async () => {
    const { sim, execution } = setup(start());
    const ref = new RefSim(cloneState(start()));
    const want = new MutationEdges();
    for (let step = 100; step <= 300; step += 100) {
      ref.run(100);
      want.append(applyCellPass(ref.state));
    }
    const births = want.length;
    for (let k = 0; k < 3; k++) expect(await execution.advanceFrame(100)).toBe(100);
    const saved = await execution.checkpoint();
    expect(stateHash(saved.state)).toBe(stateHash(ref.state));
    expect(births).toBeGreaterThan(0);
    // The genealogy itself, not only its size: every birth edge with its parent, as the reference minted it.
    expect(Array.from(execution.edges.words())).toEqual(Array.from(want.words()));
    expect(saved.observer.mutations).toBe(births);
    expect(sim.uploads.length).toBeGreaterThan(0);

    // A checkpoint taken at a pass step carries the post-pass state: a world restored from its encoded
    // artifact continues exactly as the uninterrupted one, observer and edges included, and does not
    // repeat the pass it was saved at.
    const artifact = decodeArtifact(encodeCheckpoint(saved.state, saved.observer));
    const resumed = setup(artifact.state, { observer: artifact.observer as ObserverState, lineage: { edges: new MutationEdges(execution.edges.words()), dropped: 0 } });
    const whole = setup(start());
    for (let k = 0; k < 5; k++) await whole.execution.advanceFrame(100);
    for (let k = 0; k < 2; k++) await resumed.execution.advanceFrame(100);
    const a = await whole.execution.checkpoint(), b = await resumed.execution.checkpoint();
    expect(stateHash(b.state)).toBe(stateHash(a.state));
    expect(JSON.stringify(b.observer)).toBe(JSON.stringify(a.observer));
    expect(Array.from(resumed.execution.edges.words())).toEqual(Array.from(whole.execution.edges.words()));
    // The replay twin walks the same boundaries, so it applies the same passes.
    const v = await execution.verify(200, async (state) => new CpuSimulation(state));
    expect(v.twinHash).toBe(v.liveHash);
    for (let k = 0; k < 2; k++) {
      ref.run(100);
      applyCellPass(ref.state);
    }
    expect(v.liveHash).toBe(stateHash(ref.state));
  }, 120_000);

  it("rejects a cellPeriod off the census grid before stepping", () => {
    const off = buildWorld({ ...cfg, cellPeriod: 150 }, { nutrient: 32, founders: [] });
    expect(() => setup(off)).toThrow(/cellPeriod 150 is not a multiple/);
  });
});
