// The lab's Sun (docs/garden-sun-2026-10-18.md) in LabExecution, on the reference physics: a sun set by hand, its end restored by the
// traversal wherever the world goes, a jump back that replays it from the log, a checkpoint loaded mid-span, a second sun refused while
// one shines, and the simulation's cfg the world's own throughout. SunRefSim stands in for GpuSim (the GPU's parity is tests/deno/sun.ts's).
import { describe, expect, it } from "vitest";
import { PRESETS, buildWorld, cellCount, cloneState, defaultConfig, generalistGenome, initWorld, presetConfig, stateHash, sunLight, type Intervention, type LightParams, type WorldState } from "@bl/schema";
import { SunRefSim, type MutationEvent } from "@bl/sim-ref";
import type { ObserverState } from "@bl/runner";
import { LabExecution, SunRefusedError, type LabSimulation } from "../src/execution.ts";

const settings = { censusEvery: 100, deepEvery: 5, activityThreshold: null };
function initial() {
  const cfg = { ...defaultConfig(), tileW: 16, tileH: 16, kernelRadius: 2, lightMode: "uniform" as const, lightBase: 40, lightAmp: 160, seed: 5 };
  return buildWorld(cfg, { nutrient: 40, founders: [{ x: 7, y: 7, radius: 3, genome: generalistGenome(cfg.defaultMu, cfg.defaultSigma), biomass: 100, energy: 200 }] });
}

class SunSimulation implements LabSimulation {
  ref: SunRefSim;
  events: MutationEvent[] = [];
  lights: (LightParams | null)[] = [];
  constructor(state: WorldState) { this.ref = new SunRefSim(cloneState(state)); }
  get cfg() { return this.ref.cfg; }
  get step() { return this.ref.state.step; }
  run(n: number) { this.events.push(...this.ref.run(n)); }
  async setLight(l: LightParams | null) {
    this.lights.push(l);
    await this.ref.setLight(l);
  }
  async drainLedger() {
    const events = this.events.splice(0);
    return { events, dropped: 0, step: this.step, lightIn: this.ref.state.lightIn, heatOut: this.ref.state.heatOut };
  }
  async readSnapshot() {
    const s = this.ref.state;
    return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, cellCount(s.cfg) * 4), flux: s.flux };
  }
  async readState() { return cloneState(this.ref.state); }
  upload(state: WorldState) {
    const l = this.ref.activeLight;
    this.ref = new SunRefSim(cloneState(state));
    this.ref.setLightNow(l);
  }
  destroy() {}
  lesion() { return 0; }
  async feed(): Promise<never> { throw new Error("no feed here"); }
}
function setup(state = initial(), observer?: ObserverState) {
  const sim = new SunSimulation(state);
  const lights: (LightParams | null)[] = [];
  const replayed: Intervention[] = [];
  const execution = new LabExecution(sim, settings, {
    waitForIdle: async () => {}, isCurrent: () => true, ...(observer ? { observer } : {}),
    onLight: (l) => lights.push(l), onReplayed: (iv) => replayed.push(iv),
  });
  return { sim, execution, lights, replayed };
}
const SLOW = 600_000;
async function reach(execution: LabExecution, sim: SunSimulation, step: number) {
  while (sim.step < step) await execution.advanceFrame(step - sim.step);
}

describe("the lab's Sun", () => {
  it("walk stops at a sun's end and restores the world's light; sim.cfg is the start config throughout", async () => {
    const start = initial();
    const { sim, execution, lights } = setup(start);
    const cfg0 = sim.cfg;
    await reach(execution, sim, 130);
    const entry = await execution.applySun(50, 120);
    expect(entry).toEqual({ step: 130, kind: "sun", percent: 50, span: 120 });
    expect(execution.sun).toEqual({ step: 130, percent: 50, span: 120 });
    expect(execution.light).toEqual(sunLight(cfg0, 50));
    expect(lights).toEqual([sunLight(cfg0, 50)]);
    // One frame of 500 steps stops at the census at 200 first, then at the sun's end at 250, never past it under the sun.
    expect(await execution.advanceFrame(500)).toBe(70);
    expect(execution.sun).not.toBeNull();
    await execution.advanceFrame(500);
    expect(sim.step).toBe(300);
    expect(execution.sun).toBeNull();
    expect(lights).toEqual([sunLight(cfg0, 50), null]);
    expect(sim.lights).toEqual([sunLight(cfg0, 50), null]);
    expect(sim.cfg).toBe(cfg0);
    // The same history on the reference alone.
    const ref = new SunRefSim(cloneState(start));
    ref.run(130); ref.setLightNow(sunLight(cfg0, 50)); ref.run(120); ref.setLightNow(null); ref.run(50);
    expect(stateHash(sim.ref.state)).toBe(stateHash(ref.state));
    const saved = await execution.checkpoint();
    expect(saved.state.cfg).toBe(cfg0);
    expect(saved.observer.sun).toBeUndefined();
  }, SLOW);

  it("a second sun while one is active is refused, as is one the world's light cannot take", async () => {
    const { sim, execution } = setup();
    await reach(execution, sim, 10);
    await expect(execution.applySun(150, 50)).rejects.toThrow(SunRefusedError);
    await expect(execution.applySun(150, 50)).rejects.toThrow(/cannot take that sun/);
    await expect(execution.applySun(50, 0)).rejects.toThrow(/from 1 to/);
    await execution.applySun(125, 50);
    await expect(execution.applySun(75, 10)).rejects.toThrow(/already shining .* returns at step 60/);
    expect(execution.sunRefusal(75, 10)).toMatch(/returns at step 60/);
    // Exactly the values asked: a fraction or a string is refused, never rounded into another sun (the worker passes them as sent).
    const fresh = setup();
    await expect(fresh.execution.applySun(75.9, 10)).rejects.toThrow(SunRefusedError);
    await expect(fresh.execution.applySun(75, 10.8)).rejects.toThrow(/from 1 to/);
    await expect(fresh.execution.applySun("75" as unknown as number, 10)).rejects.toThrow(SunRefusedError);
    await expect(fresh.execution.applySun(75, "10" as unknown as number)).rejects.toThrow(/from 1 to/);
    expect(fresh.execution.sun).toBeNull();
    expect(fresh.sim.lights).toEqual([]);
  }, SLOW);

  it("a sun may start at the step another ends (back to back), there and then", async () => {
    const { sim, execution, lights } = setup();
    await reach(execution, sim, 10);
    await execution.applySun(50, 40);
    await reach(execution, sim, 50);
    expect(execution.sun).toBeNull();
    expect(await execution.applySun(75, 10)).toEqual({ step: 50, kind: "sun", percent: 75, span: 10 });
    expect(lights).toEqual([sunLight(sim.cfg, 50), null, sunLight(sim.cfg, 75)]);
  }, SLOW);

  it("a sun ending at a pond boundary that waits for donors sets once they are chosen", async () => {
    // ponds-small on the reference physics (slow: a 128 x 128 world), a 4-step period, a census every 2 steps, breeder mode.
    const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
    const start = initWorld(presetConfig(pondsSmall, 1, { pondPeriod: 4 }), pondsSmall.init);
    const sim = new SunSimulation(start);
    const lights: (LightParams | null)[] = [];
    const execution = new LabExecution(sim, { censusEvery: 2, deepEvery: 5, activityThreshold: null }, {
      start, waitForIdle: async () => {}, isCurrent: () => true, onLight: (l) => lights.push(l),
    });
    execution.setHandPicks(true);
    await execution.applySun(50, 4);
    await reach(execution, sim, 4);
    expect(execution.awaiting?.step).toBe(4);
    // The walk stopped at the boundary, before the sun's end there: it still shines while the cycle waits.
    expect(execution.sun).toEqual({ step: 0, percent: 50, span: 4 });
    await execution.resolvePond(null);
    expect(execution.sun).toBeNull();
    expect(sim.lights).toEqual([sunLight(start.cfg, 50), null]);
    expect(lights).toEqual([sunLight(start.cfg, 50), null]);
    const saved = await execution.checkpoint();
    expect(saved.observer.sun).toBeUndefined();
    // And a new sun may start there.
    expect(await execution.applySun(75, 2)).toEqual({ step: 4, kind: "sun", percent: 75, span: 2 });
  }, SLOW);

  it("a checkpoint loaded mid-span restores the sun from its observer", async () => {
    const a = setup();
    await reach(a.execution, a.sim, 50);
    await a.execution.applySun(75, 200);
    await reach(a.execution, a.sim, 100);
    const saved = await a.execution.checkpoint();
    expect(saved.observer.sun).toEqual({ step: 50, percent: 75, span: 200 });
    // Loaded elsewhere: the traversal installs the observer's sun before the first step, and ends it at 250.
    const b = setup(saved.state, saved.observer);
    expect(b.execution.sun).toEqual({ step: 50, percent: 75, span: 200 });
    await b.execution.installSun();
    expect(b.sim.lights).toEqual([sunLight(b.sim.cfg, 75)]);
    await reach(a.execution, a.sim, 300);
    await reach(b.execution, b.sim, 300);
    expect(b.sim.lights).toEqual([sunLight(b.sim.cfg, 75), null]);
    expect(stateHash(b.sim.ref.state)).toBe(stateHash(a.sim.ref.state));
    // A sim that cannot change its light refuses such a checkpoint.
    const bare = new SunSimulation(saved.state) as Partial<SunSimulation>;
    delete (bare as { setLight?: unknown }).setLight;
    Object.defineProperty(bare, "setLight", { value: undefined });
    expect(() => new LabExecution(bare as unknown as LabSimulation, settings, { observer: saved.observer, waitForIdle: async () => {}, isCurrent: () => true })).toThrow(/cannot change its light/);
  }, SLOW);

  it("a jump back replays a logged sun: queued from a checkpoint before it, it starts and ends at its steps", async () => {
    const a = setup();
    await reach(a.execution, a.sim, 100);
    const early = await a.execution.checkpoint();
    await reach(a.execution, a.sim, 130);
    const log: Intervention[] = [await a.execution.applySun(50, 100)];
    await reach(a.execution, a.sim, 300);
    const b = setup(early.state, early.observer);
    b.execution.queueReplay(log, 300);
    await reach(b.execution, b.sim, 300);
    expect(b.replayed).toEqual(log);
    expect(b.lights).toEqual([sunLight(b.sim.cfg, 50), null]);
    expect(stateHash(b.sim.ref.state)).toBe(stateHash(a.sim.ref.state));
  }, SLOW);

  it("verify's twin runs under the live world's sun", async () => {
    const { sim, execution } = setup();
    await reach(execution, sim, 100);
    await execution.applySun(75, 150);
    const twins: SunSimulation[] = [];
    const res = await execution.verify(200, async (state) => {
      const t = new SunSimulation(state);
      twins.push(t);
      return t;
    });
    expect(res.liveHash).toBe(res.twinHash);
    expect(twins[0].lights).toEqual([sunLight(sim.cfg, 75), null]);
  }, SLOW);
});
