import { rankOrder } from "../src/pond-ranking.ts";
import { describe, expect, it } from "vitest";
import {
  applyMigration, cellCount, cloneState, defaultConfig, buildWorld, encodeCheckpoint, generalistGenome, initWorld, MAX_STEP, presetConfig, PRESETS, stateHash, wounds, worldW, CH, G,
  type WorldConfig, type WorldState,
} from "@bl/schema";
import { applyCellPass, applyLesion, RefSim, type MutationEvent } from "@bl/sim-ref";
import { M3_FOUNDERS, founderGenome } from "@bl/schema";
import { applyFeed, applyPondCycle, clampLesionRadius, pondDonors, pondMatter, pondTermValues, pondTraits, POND_TERMS, type Intervention } from "@bl/schema";
import {
  applyBoundary, decodeArtifact, labHistory, makeDonorHook, observeCensus, pondCensus, pondContext, pondContinuationError, restoreObservers, serializeObservers,
  type ObserverState, type PickNote, type PondCycle,
} from "@bl/runner";
import { FirstsDetector, firstsContext } from "@bl/metrics";
import { MutationEdges } from "@bl/lineage";
import { LabExecution, PondWaitingError, PressureRefusedError, StaleSurveyError, type LabSimulation, type PondSurvey } from "../src/execution.ts";
import { donorsWithKeep, keptPondOf } from "../src/pond-play.ts";
import type { ShellCount } from "../src/shell.ts";
import { buildSessionFile, interventionFacts, sessionFileError } from "../src/session-file.ts";

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
  /** The cells and genome head of the latest snapshot read: the census's own copy, taken before any boundary transform. */
  lastSnapshot?: { cells: Uint32Array; genomeHead: Uint32Array };
  async readSnapshot() {
    await this.beforeSnapshot?.();
    if (this.fail === "snapshot") throw new Error("snapshot failed");
    const s = this.ref.state;
    const snap = { step: s.step, cells: this.fail === "observer" ? new Proxy(s.cells, { get() { throw new Error("observer input failed"); } }) : s.cells.slice(), genomeHead: s.genome.slice(0, cellCount(s.cfg) * 4), flux: s.flux };
    this.lastSnapshot = snap;
    return snap;
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
    // A refusal, not a failure: the worker answers it as "refused" and the world stays usable.
    await expect(execution.verify(2, async (state) => new CpuSimulation(state))).rejects.toBeInstanceOf(PondWaitingError);
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
    // A refusal, not a failure: the worker answers it as "refused" and the world stays usable.
    await expect(execution.verify(4, async (state) => new CpuSimulation(state))).rejects.toBeInstanceOf(PondWaitingError);
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

describe("lab execution under a pressure", () => {
  const sameScoreTwice = "mass";
  /** ponds-small as a breeder world scored by mass, with pond 2's bound matter cut by a fifth: "mass" then ranks pond 1 first, "body" pond 3. */
  function breedWorld(step = 0): WorldState {
    const s = pondWorld(step, { pondArm: "breed", pondScore: sameScoreTwice });
    const n = cellCount(s.cfg), W = worldW(s.cfg);
    for (let i = 0; i < n; i++) {
      const x = i % W, y = Math.floor(i / W);
      if (x < s.cfg.tileW && y >= s.cfg.tileH) s.cells[CH.B * n + i] = Math.floor((s.cells[CH.B * n + i] * 4) / 5);
    }
    return s;
  }
  /** The first lineage living in pond `p` of `s`, as the census names it. */
  function lineageOfPond(s: WorldState, p: number): string {
    const n = cellCount(s.cfg), W = worldW(s.cfg);
    for (let i = 0; i < n; i++) {
      const x = i % W, y = Math.floor(i / W);
      if (Math.floor(y / s.cfg.tileH) * s.cfg.tilesX + Math.floor(x / s.cfg.tileW) !== p) continue;
      const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
      if ((hi | lo) !== 0) return `${hi}:${lo}`;
    }
    throw new Error(`no lineage in pond ${p}`);
  }
  function breeder(state: WorldState, overrides: Partial<ConstructorParameters<typeof LabExecution>[2]> = {}) {
    const surveys: PondSurvey[] = [];
    const s = pondSetup(state, { onPondAwait: (survey) => { surveys.push(survey); }, ...overrides });
    s.execution.setHandPicks(true);
    return { ...s, surveys };
  }
  const stepped = (start: WorldState, steps: number): WorldState => {
    const ref = new RefSim(cloneState(start));
    ref.run(steps);
    return cloneState(ref.state);
  };
  const toWait = async (execution: LabExecution) => { while (!execution.awaiting) await execution.advanceFrame(2); return execution.awaiting!; };
  const sink = { appendText: async () => {} };
  /**
   * runner.ts's sequence on the same reference physics, driven by a lab log through `labHistory` (the headless replay's own reader):
   * the rule's donors under the log's pressures at a boundary no recorded pick covers, then the log's wounds after the boundary.
   */
  async function runnerPressured(start: WorldState, to: number, history: Intervention[]) {
    const { picks, scheduled, pressures } = labHistory({ interventions: history, cfg: start.cfg, edgesFrom: 0 });
    const sim = new CpuSimulation(start);
    const obs = restoreObservers(undefined, pondSettings, start.cfg);
    const ctx = pondContext(start);
    const note: PickNote = { by: "none", suggested: [] };
    const hook = makeDonorHook({ cfg: start.cfg, recorded: new Map(picks.map((e) => [e.step, e])), implicitRule: true, sink, note, pressures });
    const donors = new Map<number, number[]>();
    let next = 0;
    while (sim.step < to) {
      sim.run(pondSettings.censusEvery);
      const ledger = await sim.drainLedger();
      observeCensus(obs, sim.cfg, await sim.readSnapshot(), ledger.events.length);
      const { ponds } = await applyBoundary(sim, sim.step, ctx, sim.step % start.cfg.pondPeriod! === 0 ? hook : undefined);
      if (ponds) {
        obs.ponds = { lastCycle: ponds.b };
        donors.set(sim.step, ponds.donors);
      }
      for (; next < scheduled.length && scheduled[next].step === sim.step; next++) {
        const w = scheduled[next];
        if (w.kind === "lesion") sim.lesion(w.x, w.y, w.r);
      }
    }
    return { hash: stateHash(await sim.readState()), observer: serializeObservers(obs, sim.step, pondSettings), donors };
  }

  it("re-ranks a waiting cycle under the new score, logs the entry ahead of the pick, and answers a no-op, the dial's own history and a bad readback", async () => {
    const start = breedWorld();
    const pre = stepped(start, 4);
    const massDonors = pondDonors(pre, 1, "breed", 8, "mass"), bodyDonors = pondDonors(pre, 1, "breed", 8, "body");
    // The world must separate the two scores, or nothing below says anything.
    expect(massDonors).not.toEqual(bodyDonors);
    const { sim, execution, surveys, cycles } = breeder(start);
    expect(execution.pressure).toEqual({ base: "mass", current: "mass", fromCycle: null, changes: 0, nextCycle: 1 });
    const waiting = await toWait(execution);
    expect([waiting.step, waiting.cycle, waiting.ruleScore, waiting.kept]).toEqual([4, 1, "mass", null]);
    expect(waiting.suggested).toEqual(massDonors);
    expect(execution.pressure).toMatchObject({ current: "mass", nextCycle: 1 });

    // Nothing logged for the score already governing; a score that is not one, or a world's refusal, never reaches the list.
    expect(await execution.setPressure("mass")).toEqual({ entry: null, survey: null });
    await expect(execution.setPressure("weight" as never)).rejects.toBeInstanceOf(PressureRefusedError);
    expect(execution.pressure.changes).toBe(0);
    // A readback that fails while re-ranking changes nothing: no entry, the same waiting survey, the world not failed.
    sim.beforeState = async () => { throw new Error("readback failed"); };
    await expect(execution.setPressure("body")).rejects.toThrow(/readback failed/);
    sim.beforeState = undefined;
    expect(execution.pressure.changes).toBe(0);
    expect(execution.awaiting).toBe(waiting);
    expect(execution.failure).toBeNull();
    expect(surveys).toEqual([waiting]);

    // The dial, while cycle 1 waits: the entry is for that cycle, at its boundary, and the survey is the cycle's again, re-ranked.
    const { entry, survey } = await execution.setPressure("body");
    expect(entry).toEqual({ step: 4, cycle: 1, score: "body" });
    expect(survey).toBe(execution.awaiting);
    expect([survey!.step, survey!.cycle, survey!.ruleScore]).toEqual([4, 1, "body"]);
    expect(survey!.suggested).toEqual(bodyDonors);
    expect(survey!.terms).toEqual(waiting.terms);
    expect(surveys).toEqual([waiting, survey]);
    expect(execution.pressure).toEqual({ base: "mass", current: "body", fromCycle: 1, changes: 1, nextCycle: 1 });
    expect(await execution.setPressure("body")).toEqual({ entry: null, survey: null });

    // Keep re-surveys too: unknown lineages are gone, a real one lives in its pond, nothing kept says null.
    const key = lineageOfPond(start, 0);
    expect((await execution.setKeep("9:9"))!.kept).toEqual({ key: "9:9", pond: null, cells: 0, living: 0 });
    const kept = (await execution.setKeep(key))!.kept!;
    expect(kept).toEqual(keptPondOf(pre, key));
    expect(kept.pond).toBe(0);
    expect((await execution.setKeep(null))!.kept).toBeNull();
    await expect(execution.setKeep("not a key")).rejects.toThrow(/not a lineage key/);
    expect(surveys.map((s) => s.kept?.living ?? null)).toEqual([null, null, 0, kept.living, null]);
    expect(execution.keep).toBeNull();

    // Applied as the world's own: the pick of the cycle, then the boundary's cycle carries it and the dial sits at the next cycle.
    const done = await execution.resolvePond(null);
    expect(done.donors).toEqual(bodyDonors);
    expect(cycles.map((c) => c.donors)).toEqual([bodyDonors]);
    expect(execution.awaiting).toBeNull();
    expect(execution.pressure).toEqual({ base: "mass", current: "body", fromCycle: 1, changes: 1, nextCycle: 2 });
    // Set after the boundary, it is for the next cycle and leaves the surveys already given alone.
    const after = await execution.setPressure("seed");
    expect(after).toEqual({ entry: { step: 4, cycle: 2, score: "seed" }, survey: null });
    expect(surveys).toHaveLength(5);
    expect(execution.pressure).toEqual({ base: "mass", current: "seed", fromCycle: 2, changes: 2, nextCycle: 2 });
  }, 600_000);

  it("refuses explicit donors chosen from a survey the dial or Keep has replaced, and works auto-breed's answer out from the survey that waits", async () => {
    const start = breedWorld();
    const key = lineageOfPond(start, 0);
    const { execution, cycles } = breeder(start);
    const first = await toWait(execution);
    // The dial re-surveys the waiting cycle under a new revision: donors chosen from the first survey are refused, nothing changes.
    const { survey } = await execution.setPressure("body");
    expect(survey!.revision).toBeGreaterThan(first.revision);
    const stale = await execution.resolvePond(first.suggested, { revision: first.revision }).then(() => null, (e) => e);
    expect(stale).toBeInstanceOf(StaleSurveyError);
    expect(stale).toBeInstanceOf(PondWaitingError);
    expect(execution.awaiting).toBe(survey);
    expect(execution.failure).toBeNull();
    expect(cycles).toEqual([]);
    // So does Keep.
    const kept = (await execution.setKeep(key))!;
    expect(kept.revision).toBeGreaterThan(survey!.revision);
    await expect(execution.resolvePond(survey!.suggested, { revision: survey!.revision })).rejects.toBeInstanceOf(StaleSurveyError);
    expect(execution.awaiting).toBe(kept);
    // Auto-breed's answer names no donors: the rule's choice as Keep adjusts it, from the survey that waits now.
    expect(kept.kept?.pond).toBe(0);
    expect(kept.suggested).not.toContain(0);
    const done = await execution.resolvePond(null, { withKeep: true });
    expect(done.donors).toEqual(donorsWithKeep(kept.suggested, kept.kept));
    expect(cycles.map((c) => c.donors)).toEqual([done.donors]);
    expect(execution.awaiting).toBeNull();
  }, 600_000);

  it("refuses the dial in a world that does not breed for a score, for a score that is not one, and in a failed world, leaving each usable", async () => {
    const scaf = pondSetup(pondWorld());
    await expect(scaf.execution.setPressure("body")).rejects.toThrow(/doesn’t breed for a score \(its arm is scaf\)/);
    await expect(scaf.execution.setPressure("body")).rejects.toBeInstanceOf(PressureRefusedError);
    expect(await scaf.execution.advanceFrame(2)).toBe(2);
    expect(scaf.execution.failure).toBeNull();
    expect(scaf.execution.pressure).toMatchObject({ base: undefined, current: undefined, changes: 0 });
    // A history holding pressures cannot belong to such a world.
    expect(() => pondSetup(pondWorld(), { pressures: [{ step: 2, cycle: 1, score: "body" }] })).toThrow(/only a breeder world has a pressure dial/);

    const breed = pondSetup(breedWorld());
    await expect(breed.execution.setPressure("body+body" as never)).rejects.toThrow(/pondScore must be one of/);
    expect(await breed.execution.advanceFrame(2)).toBe(2);

    const failing = pondSetup(breedWorld());
    failing.sim.fail = "drain";
    await expect(failing.execution.advanceFrame(2)).rejects.toThrow(/drain failed/);
    const refusal = await failing.execution.setPressure("body").then(() => null, (e) => e);
    expect(refusal).toBeInstanceOf(PressureRefusedError);
    expect(String(refusal)).toMatch(/census at t=2 failed/);
  }, 600_000);

  it("is the runner's boundary: a pressure set mid-cycle governs the next boundary exactly as makeDonorHook under the same pressures, and no pressure leaves the arm's own cycle", async () => {
    const start = breedWorld();
    const pre = stepped(start, 4);
    const dial = { step: 2, kind: "pressure", cycle: 1, score: "body" } as const;
    // Lab: not in breeder mode, so the boundary at t=4 takes no pick and the rule's donors under the pressure.
    const lab = pondSetup(start);
    await lab.execution.advanceFrame(2);
    expect(await lab.execution.setPressure("body")).toEqual({ entry: { step: 2, cycle: 1, score: "body" }, survey: null });
    await lab.execution.advanceFrame(2);
    const labAt4 = await lab.execution.checkpoint();
    const bodyDonors = pondDonors(pre, 1, "breed", 8, "body");
    expect(bodyDonors).not.toEqual(pondDonors(pre, 1, "breed", 8, "mass"));
    expect(lab.cycles.map((c) => c.donors)).toEqual([bodyDonors]);
    const runner = await runnerPressured(start, 4, [dial]);
    expect(stateHash(labAt4.state)).toBe(runner.hash);
    expect(labAt4.observer).toEqual(runner.observer);
    expect(runner.donors.get(4)).toEqual(bodyDonors);

    // No pressure: byte for byte the arm's own cycle, as before this slice.
    const plain = pondSetup(start);
    await plain.execution.advanceFrame(2);
    await plain.execution.advanceFrame(2);
    const plainAt4 = await plain.execution.checkpoint();
    const want = await runnerReference(start, 4);
    expect(stateHash(plainAt4.state)).toBe(want.get(4)!.hash);
    expect(plainAt4.observer).toEqual(want.get(4)!.observer);
    expect(stateHash(plainAt4.state)).not.toBe(stateHash(labAt4.state));
    expect(plain.cycles[0].donors).toEqual(want.get(4)!.cycle!.donors);
    // A pressure back to the config's own score is the arm's cycle too.
    const same = pondSetup(start, { pressures: [{ step: 0, cycle: 1, score: "mass" }] });
    await same.execution.advanceFrame(2);
    await same.execution.advanceFrame(2);
    expect(stateHash((await same.execution.checkpoint()).state)).toBe(want.get(4)!.hash);
  }, 600_000);

  /**
   * The history a player makes: Keep on a lineage of pond 0, a pressure for "body" set while cycle 1 waits, auto-breed answering each
   * waiting cycle with the rule's choice adjusted by Keep, a wound and a pressure back to "mass" after the boundary at t=8.
   */
  interface Played {
    start: WorldState;
    key: string;
    log: Intervention[];
    surveys: PondSurvey[];
    answers: number[][];
    cycles: { step: number; b: number; donors: number[] }[];
    at4: { state: WorldState; observer: ObserverState; logged: number };
    at8: { state: WorldState; observer: ObserverState; logged: number };
    end: { hash: string; observer: string };
  }
  let played: Promise<Played> | null = null;
  const play = () => (played ??= (async () => {
    const start = breedWorld();
    const key = lineageOfPond(start, 0);
    const live = breeder(start, { keep: key });
    const { execution, sim, surveys } = live;
    const log: Intervention[] = [];
    const answers: number[][] = [];
    const answer = async () => {
      const s = execution.awaiting!;
      const donors = donorsWithKeep(s.suggested, s.kept);
      const done = await execution.resolvePond(donors);
      answers.push(donors);
      log.push({ step: done.step, kind: "pick", cycle: done.cycle, donors: done.donors });
    };
    const dial = async (score: Parameters<LabExecution["setPressure"]>[0]) => {
      const { entry } = await execution.setPressure(score);
      log.push({ step: entry!.step, kind: "pressure", cycle: entry!.cycle, score: entry!.score });
    };
    await toWait(execution);
    await dial("body");
    await answer();
    const c4 = await execution.checkpoint();
    const at4 = { state: c4.state, observer: c4.observer, logged: log.length };
    await toWait(execution);
    await answer();
    log.push({ step: sim.step, kind: "lesion", x: 32, y: 32, r: sim.lesion(32, 32, 2) });
    await dial("mass");
    const c8 = await execution.checkpoint();
    const at8 = { state: c8.state, observer: c8.observer, logged: log.length };
    await toWait(execution);
    await answer();
    await execution.advanceFrame(2);
    const end = await execution.checkpoint();
    expect(end.state.step).toBe(14);
    return { start, key, log, surveys, answers, cycles: live.cycles, at4, at8, end: { hash: stateHash(end.state), observer: JSON.stringify(end.observer) } };
  })());

  it("plays a kept, pressured, auto-bred history: each cycle answered by the rule's choice as Keep adjusts it, the log in the worker's order", async () => {
    const p = await play();
    expect(p.log.map((iv) => [iv.step, iv.kind])).toEqual([[4, "pressure"], [4, "pick"], [8, "pick"], [8, "lesion"], [8, "pressure"], [12, "pick"]]);
    expect(p.log.filter((iv) => iv.kind === "pressure").map((iv) => (iv as { cycle: number; score: string }).cycle + (iv as { score: string }).score)).toEqual(["1body", "3mass"]);
    // The surveys the page answered: the cycle that waits (t=4) twice, the second ranked by the dial; then t=8 under it; then t=12 back at the plant's score.
    expect(p.surveys.map((s) => [s.step, s.ruleScore])).toEqual([[4, "mass"], [4, "body"], [8, "body"], [12, "mass"]]);
    // Cycle 1: the kept pond was not the rule's choice, so it replaced it.
    const first = p.surveys[1];
    expect(first.suggested).toEqual(pondDonors(stepped(p.start, 4), 1, "breed", 8, "body"));
    expect(first.kept).toMatchObject({ key: p.key, pond: 0 });
    expect(first.suggested).not.toContain(0);
    expect(p.answers[0]).toEqual([0]);
    // Every answer is the rule's choice under the dial, adjusted by Keep and by nothing else.
    const waits = [p.surveys[1], p.surveys[2], p.surveys[3]];
    waits.forEach((s, i) => expect(p.answers[i]).toEqual(donorsWithKeep(s.suggested, s.kept)));
    expect(p.log.filter((iv) => iv.kind === "pick").map((iv) => (iv as { donors: number[] }).donors)).toEqual(p.answers);
    expect(p.cycles.map((c) => c.donors)).toEqual(p.answers);
    // The log is a history the headless replay accepts.
    expect(labHistory({ interventions: p.log, cfg: p.start.cfg, edgesFrom: 0 })).toMatchObject({ picks: expect.any(Array), pressures: [{ step: 4, cycle: 1, score: "body" }, { step: 8, cycle: 3, score: "mass" }] });
    // And a session file of it is a well-formed version 3 file.
    const file = buildSessionFile({
      manifest: { runId: "breeder-s1-test", presetId: "ponds-small", seed: 1, cfg: p.start.cfg, init: pondsSmall.init, ruleVersion: p.start.cfg.ruleVersion, createdAt: "2026-10-17T00:00:00.000Z", adapter: "test", userAgent: "test",
        interventions: p.log, checkpoints: [], settings: pondSettings, startHash: stateHash(p.start), edgesFrom: 0 },
      stateHash: p.end.hash, step: 14, firsts: { watchedFrom: 2, entries: [] }, families: { watchedFrom: null, families: [], events: [] },
      card: { summary: new FirstsDetector(firstsContext(p.start.cfg, 2)).summary(), facts: interventionFacts(p.log, new Map(), null) }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
    });
    expect(file.version).toBe(3);
    expect(file.card.facts.pressures).toEqual({ changes: 2, latest: "mass" });
    expect(sessionFileError(file)).toBeNull();
  }, 600_000);

  it("replays that history in a fresh execution to the same state and observer, re-booking every entry in log order, with no one at the controls", async () => {
    const p = await play();
    const booked: Intervention[] = [];
    const again = breeder(p.start, { onReplayed: (iv) => { booked.push(iv); } });
    again.execution.queueReplay(p.log, 15);
    while (again.sim.step < 14) await again.execution.advanceFrame(14 - again.sim.step);
    const replayed = await again.execution.checkpoint();
    expect(again.surveys).toEqual([]);
    expect(booked).toEqual(p.log);
    expect(again.execution.pendingReplay).toEqual([]);
    expect(stateHash(replayed.state)).toBe(p.end.hash);
    expect(JSON.stringify(replayed.observer)).toBe(p.end.observer);
    expect(again.cycles.map((c) => c.donors)).toEqual(p.answers);
    // The execution's own list is the log's: both pressures, the latest in force.
    expect(again.execution.pressure).toMatchObject({ current: "mass", fromCycle: 3, changes: 2 });
  }, 600_000);

  it("is the runner's replay of the same log: labHistory, the recorded picks and the pressures reach the same state hash and the same donors", async () => {
    const p = await play();
    const runner = await runnerPressured(p.start, 14, p.log);
    expect(runner.hash).toBe(p.end.hash);
    expect([...runner.donors.entries()]).toEqual(p.cycles.map((c) => [c.step, c.donors]));
  }, 600_000);

  it("continues a restored world and its twin under the pressures the history so far held", async () => {
    const p = await play();
    // A world restored from the checkpoint at t=4 (which holds the pressure and its pick): the rest of the log replays, the twin included.
    const pressures = p.log.slice(0, p.at4.logged).filter((iv) => iv.kind === "pressure") as Extract<Intervention, { kind: "pressure" }>[];
    expect(pressures).toHaveLength(1);
    const restored = breeder(p.at4.state, { observer: p.at4.observer, pressures, keep: p.key });
    expect(restored.execution.pressure).toMatchObject({ current: "body", fromCycle: 1, changes: 1, nextCycle: 2 });
    restored.execution.queueReplay(p.log.slice(p.at4.logged), 15);
    const v = await restored.execution.verify(10, async (state) => new CpuSimulation(state));
    expect(v.twinHash).toBe(v.liveHash);
    expect(v.liveHash).toBe(p.end.hash);
    // The twin consumed its own copy of the queue's pressure: the live list holds it once.
    expect(restored.execution.pressure).toMatchObject({ current: "mass", fromCycle: 3, changes: 2 });
    expect(restored.surveys).toEqual([]);

    // Not in breeder mode, the boundary at t=8 takes the rule's donors under the pressure from the restored list, live and in the twin.
    // The pressure is whichever score ranks a different pond first there than the plant's own, so that it changes what the rule does.
    const pre8 = stepped(p.at4.state, 4);
    const rival = (["body", "seed", "drive", "reach"] as const).find((t) => pondDonors(pre8, 2, "breed", 8, t)[0] !== pondDonors(pre8, 2, "breed", 8, "mass")[0]);
    expect(rival, "no score separates the ponds at t=8").toBeDefined();
    const governed = pondSetup(p.at4.state, { observer: p.at4.observer, pressures: [{ step: 4, cycle: 2, score: rival! }] });
    const ruled = await governed.execution.verify(4, async (state) => new CpuSimulation(state));
    expect(ruled.twinHash).toBe(ruled.liveHash);
    expect(governed.cycles.map((c) => c.donors)).toEqual([pondDonors(pre8, 2, "breed", 8, rival!)]);
    const unpressured = pondSetup(p.at4.state, { observer: p.at4.observer });
    const arm = await unpressured.execution.verify(4, async (state) => new CpuSimulation(state));
    expect(arm.twinHash).toBe(arm.liveHash);
    // The pressure changed what the rule did at t=8, so the twin agreeing with the live world says something.
    expect(ruled.liveHash).not.toBe(arm.liveHash);
  }, 600_000);

  it("refuses a replay that meets a pressure away from where the lab put it", async () => {
    const start = breedWorld();
    const late = pondSetup(breedWorld(4), { observer: pondObserver(breedWorld(4)) });
    // A pressure for the cycle of the boundary the world has already passed cannot be the observed history.
    late.execution.queueReplay([{ step: 4, kind: "pressure", cycle: 1, score: "body" }]);
    await expect(late.execution.advanceFrame(0)).rejects.toThrow(/pressure for cycle 1 at t=4 after that boundary had passed/);
    expect(start.step).toBe(0);
  }, 600_000);
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

// Pond keeper v3 (docs/pond-keeper-v3-2026-10-22.md, sections 3 and 5): a world with a polymer shell reports, at each census, how many of
// its living cells hold at least the shell of membrane; the count is display only, and a history in such a world replays to the same state.
describe("lab execution of a wounded world with a shell", () => {
  // ponds-small with a 20-step cycle and the breeder's wounds: the boundaries fall at 20 and 40 and the injury rounds at 13, 26 and 39
  // (`(step + 1) % 13 === 0`), so the world is wounded across its cycles (the fast setup, pondPeriod 4, ends at step 8 and sees no round).
  const shelled = { pondPeriod: 20, ...wounds(3, 3250), injuryShell: 2 } as const;
  type Seen = { step: number; shell: ShellCount | null | undefined; recount: ShellCount };

  /** The recount, written here from a census snapshot's own cells and lineage words: not shellCount, and not the state after a boundary. */
  function recount(sim: CpuSimulation, shell: number): ShellCount {
    const snap = sim.lastSnapshot!;
    const n = cellCount(sim.cfg);
    let wearing = 0, living = 0;
    for (let i = 0; i < n; i++) {
      if (snap.genomeHead[G.LIN_HI * n + i] === 0 && snap.genomeHead[G.LIN_LO * n + i] === 0) continue;
      living++;
      if (snap.cells[CH.P * n + i] >= shell) wearing++;
    }
    return { wearing, living };
  }

  /** A hand-picking execution of the shell world that records what each census reported next to a recount of its snapshot. */
  function recording(state: WorldState) {
    const seen: Seen[] = [];
    const surveys: PondSurvey[] = [];
    const s = pondSetup(state, {
      onObservation: (c, _dropped, _firsts, _families, shell) => { seen.push({ step: c.step, shell, recount: recount(s.sim, state.cfg.injuryShell!) }); },
      onPondAwait: (survey) => { surveys.push(survey); },
    });
    s.execution.setHandPicks(true);
    return { ...s, seen, surveys };
  }

  it("reports at every census the count its own snapshot holds, and reads nonzero while the first cycle's wounds are in", async () => {
    const start = pondWorld(0, shelled);
    const seen: Seen[] = [];
    const { sim, execution, cycles } = pondSetup(start, {
      onObservation: (c, _dropped, _firsts, _families, shell) => { seen.push({ step: c.step, shell, recount: recount(sim, 2) }); },
    });
    for (let k = 0; k < 20; k++) expect(await execution.advanceFrame(2)).toBe(2);
    expect(seen.map((o) => o.step)).toEqual(Array.from({ length: 20 }, (_, k) => 2 * (k + 1)));
    // The cycles applied at 20 and 40 and the census at those steps still reported its pre-cycle snapshot.
    expect(cycles.map((c) => c.step)).toEqual([20, 40]);
    for (const o of seen) expect(o.shell, `census ${o.step}`).toEqual(o.recount);
    // Not zero equals zero: the first wounds and the membrane the ponds build reach the shell in some cells while the first cycle runs.
    expect(seen.filter((o) => o.step >= 14 && o.step <= 20).some((o) => o.shell!.wearing > 0)).toBe(true);
    for (const o of seen) expect(o.shell!.wearing).toBeLessThanOrEqual(o.shell!.living);
    // 40 steps took about 23 s on a laptop (0.6 s a step for this 128 x 128 world); the timeouts leave several times that.
  }, 180_000);

  it("reports nothing in a world without a shell", async () => {
    const seen: (ShellCount | null | undefined)[] = [];
    const { execution } = pondSetup(pondWorld(), { onObservation: (_c, _dropped, _firsts, _families, shell) => { seen.push(shell); } });
    for (let k = 0; k < 2; k++) await execution.advanceFrame(2);
    expect(seen).toEqual([null, null]);
  }, 60_000);

  it.each(["scaf", "breed"] as const)("replays a history with a hand wound and a hand pick under %s to the same state, and the same counts", async (arm) => {
    const start = pondWorld(0, shelled);
    if (arm === "breed") start.cfg = { ...start.cfg, pondArm: "breed", pondScore: "body" };
    const first = recording(start);
    const log: Intervention[] = [];
    for (let k = 0; k < 3; k++) await first.execution.advanceFrame(2);
    // A hand wound at step 6 (a cut: the brush clears what it touches, shell or not).
    log.push({ step: first.sim.step, kind: "lesion", x: 32, y: 32, r: first.sim.lesion(32, 32, 6) });
    while (!first.execution.awaiting) await first.execution.advanceFrame(2);
    expect(first.execution.awaiting.step).toBe(20);
    const pre = await first.sim.readState();
    const counts = Array.from({ length: pre.cfg.tilesX * pre.cfg.tilesY }, () => ({ wearing: 0, living: 0 }));
    const n = cellCount(pre.cfg), width = pre.cfg.tileW * pre.cfg.tilesX;
    for (let y = 0; y < pre.cfg.tileH * pre.cfg.tilesY; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!(pre.genome[G.LIN_HI * n + i] | pre.genome[G.LIN_LO * n + i])) continue;
      const c = counts[Math.floor(y / pre.cfg.tileH) * pre.cfg.tilesX + Math.floor(x / pre.cfg.tileW)];
      c.living++;
      if (pre.cells[CH.P * n + i] >= pre.cfg.injuryShell!) c.wearing++;
    }
    expect(first.execution.awaiting.shells).toEqual(counts);
    let picked = [1, 0]; // Preserve the original scaffold-arm replay and its explicit donor order.
    if (arm === "breed") {
      const revision = first.execution.awaiting.revision;
      await first.execution.setPressure("mass");
      const refreshed = first.execution.awaiting!;
      expect(refreshed.revision).toBeGreaterThan(revision);
      expect(refreshed.shells).toEqual(counts);
      // Return the pressure to its original value before recording picks: the replay below has no pressure entries.
      await first.execution.setPressure(start.cfg.pondScore!);
      picked = rankOrder({ ...first.execution.awaiting!, type: "pondAwait", world: 1, arm, score: start.cfg.pondScore! }, "shell").slice(0, 2);
    }
    const done = await first.execution.resolvePond(picked);
    log.push({ step: done.step, kind: "pick", cycle: done.cycle, donors: done.donors });
    while (!first.execution.awaiting) await first.execution.advanceFrame(2);
    expect(first.execution.awaiting.step).toBe(40);
    expect(log.map((iv) => [iv.step, iv.kind])).toEqual([[6, "lesion"], [20, "pick"]]);
    const hash = stateHash(await first.sim.readState());
    for (const o of first.seen) expect(o.shell, `census ${o.step}`).toEqual(o.recount);

    // A second execution takes the logged history from its queue, wound and pick, and stops where the first one waits.
    const again = recording(start);
    again.execution.queueReplay(log, 40);
    while (!again.execution.awaiting) await again.execution.advanceFrame(2);
    expect(again.execution.awaiting.step).toBe(40);
    expect(again.cycles.map((c) => c.donors)).toEqual([picked]);
    expect(stateHash(await again.sim.readState())).toBe(hash);
    expect(again.seen.map((o) => [o.step, o.shell])).toEqual(first.seen.map((o) => [o.step, o.shell]));
    expect(again.execution.awaiting.shells).toEqual(first.execution.awaiting.shells);
    // Two executions of 40 steps: about 45 s together.
  }, 240_000);
});
