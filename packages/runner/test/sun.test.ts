// The sun (kind "sun", docs/garden-sun-2026-10-18.md) in the headless runner, without a GPU: its shape (validateInterventions),
// its world-dependent refusal (interventionsError), the active sun of a schedule (sunAt), its log line, comparison and lab
// history, and runExperiment's loop on a SunRefSim-backed stand-in for GpuSim: where the light changes among the steps, the
// census and the checkpoint, what the observer carries, and that segmented runs cut inside a span, at its step and at its end
// equal the continuous run. The GPU's own parity (GpuSim.setLight against SunRefSim) is tests/deno/sun.ts's.
import { describe, expect, it, vi } from "vitest";
import { PRESETS, SUN_SPAN_MAX, MAX_STEP, cloneState, encodeCheckpoint, initWorld, stateHash, sunLight, type WorldState } from "@bl/schema";
import { SunRefSim } from "@bl/sim-ref";
import { GpuSim } from "@bl/sim-gpu";
import {
  INTERVENTIONS_FILE,
  checkInterventionLog,
  decodeArtifact,
  formatInterventionLine,
  interventionsError,
  labHistory,
  observerSettings,
  ownedInterventions,
  parseInterventionLog,
  restoreObservers,
  runExperiment,
  sameIntervention,
  serializeObservers,
  specConfig,
  stitchRun,
  sunAt,
  validateInterventions,
  validateSpec,
  type ObserverState,
  type RunSpec,
  type ScheduledIntervention,
  type Sink,
} from "@bl/runner";

vi.mock("@bl/sim-gpu", async () => {
  const { SunRefSim, applyLesion } = await import("@bl/sim-ref");
  const { applyFeed, cellCount, clampLesionRadius, cloneState, totalsOf, G } = await import("@bl/schema");
  type Light = { lightBase: number; lightAmp: number; seasonAmp: number } | null;
  class FakeGpuSim {
    static last: FakeGpuSim | null = null;
    readonly calls: string[] = [];
    private ref: InstanceType<typeof SunRefSim>;
    private pending: { childHi: number; childLo: number; parentHi: number; parentLo: number }[] = [];
    private constructor(state: WorldState) {
      this.ref = new SunRefSim(state);
    }
    static async create(device: GPUDevice, state: WorldState) {
      (device as unknown as { createBuffer(): void }).createBuffer();
      return (FakeGpuSim.last = new FakeGpuSim(cloneState(state)));
    }
    get cfg() { return this.ref.cfg; }
    get step() { return this.ref.state.step; }
    get activeLight() { return this.ref.activeLight; }
    async setLight(l: Light) {
      this.calls.push(l ? `light ${l.lightBase},${l.lightAmp},${l.seasonAmp}` : "light null");
      await this.ref.setLight(l);
    }
    run(count: number) {
      this.calls.push(`run ${count}`);
      this.pending.push(...this.ref.run(count));
    }
    lesion(x: number, y: number, r: number) {
      this.calls.push(`lesion ${x},${y},${r}`);
      applyLesion(this.ref, x, y, r);
      return clampLesionRadius(this.ref.cfg, r);
    }
    async feed(x: number, y: number, r: number, amount: number) {
      this.calls.push(`feed ${x},${y},${r},${amount}`);
      return applyFeed(this.ref.state, x, y, r, amount);
    }
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
    upload(state: WorldState) {
      const l = this.ref.activeLight;
      this.ref = new SunRefSim(cloneState(state));
      this.ref.setLightNow(l);
    }
    destroy() {}
  }
  return { GpuSim: FakeGpuSim };
});

const lastSim = (): { calls: string[] } => (GpuSim as unknown as { last: { calls: string[] } }).last!;
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
async function rejection(spec: RunSpec, opts: Parameters<typeof runExperiment>[5] = {}, dev: GPUDevice = fakeDevice): Promise<string> {
  try {
    await runExperiment(dev, spec, memorySink().sink, host, () => {}, opts);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const sun = (step: number, percent: number, span: number): ScheduledIntervention => ({ step, kind: "sun", percent, span });
/** A 32 x 32 even-light world (40 + 160): it takes 50, 75 and 125. */
const small: RunSpec = { experiment: "sun", presetId: "spots", condition: "treatment", seed: 3, steps: 60, censusEvery: 10, deepEvery: 100, checkpointEvery: 10, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };
const cfg = specConfig(small);
const start = initWorld(cfg, PRESETS.find((p) => p.id === "spots")!.init);

describe("validateInterventions: a sun's shape", () => {
  it("takes exactly step, kind, percent and span", () => {
    expect(validateInterventions([sun(0, 50, 1), sun(1, 150, SUN_SPAN_MAX)])).toEqual([]);
    expect(validateInterventions([{ step: 1, kind: "sun", percent: 50 }]).join()).toMatch(/a sun needs the key "span"/);
    expect(validateInterventions([{ ...sun(1, 50, 2), x: 3 }]).join()).toMatch(/a sun has no key "x" \(its keys are step, kind, percent, span\)/);
    expect(validateInterventions([{ step: 1, kind: "moon" }]).join()).toMatch(/kind must be "lesion", "feed" or "sun", got "moon"/);
  });

  it("takes a percent of the set and a span in 1..2^24 ending by MAX_STEP", () => {
    for (const p of [0, 100, 60, 49.5, "50"]) expect(validateInterventions([{ step: 1, kind: "sun", percent: p, span: 2 }]).join(), String(p)).toMatch(/percent must be one of 50, 75, 125, 150/);
    for (const n of [0, -1, 1.5, SUN_SPAN_MAX + 1, "2"]) expect(validateInterventions([{ step: 1, kind: "sun", percent: 50, span: n }]).join(), String(n)).toMatch(/span must be an integer in 1\.\.16777216/);
    expect(validateInterventions([sun(MAX_STEP - 5, 50, 5)])).toEqual([]);
    expect(validateInterventions([sun(MAX_STEP - 5, 50, 6)]).join()).toMatch(/would end past the step limit/);
  });

  it("refuses overlapping suns, accepts back-to-back ones and other kinds inside a span", () => {
    expect(validateInterventions([sun(10, 50, 10), sun(19, 75, 5)]).join()).toMatch(/interventions\[1\]: a sun at t=19 starts before the sun at interventions\[0\] ends \(t=20\)/);
    expect(validateInterventions([sun(10, 50, 10), sun(20, 75, 5)])).toEqual([]);
    expect(validateInterventions([sun(10, 50, 10), { step: 12, kind: "lesion", x: 1, y: 1, r: 1 }, sun(20, 125, 5)])).toEqual([]);
  });
});

describe("interventionsError and sunAt", () => {
  it("refuses a sun the world's light cannot take", () => {
    expect(interventionsError({ interventions: [sun(5, 125, 5)] }, cfg, 0)).toBeNull();
    expect(interventionsError({ interventions: [sun(5, 150, 5)] }, cfg, 0)).toMatch(/^interventions\[0\] \(sun at t=5\): this world's light cannot take a sun of 150%: .*add up to 300/);
    const gradient = specConfig({ ...small, presetId: "gradient" });
    expect(interventionsError({ interventions: [sun(5, 125, 5)] }, gradient, 0)).toMatch(/lightAmp would be 275/);
  });

  it("sunAt is the entry with step <= t < step + span", () => {
    const list = [sun(10, 50, 10), { step: 12, kind: "lesion", x: 1, y: 1, r: 1 } as ScheduledIntervention, sun(20, 75, 5)];
    expect(sunAt(list, 9)).toBeNull();
    expect(sunAt(list, 10)).toEqual(sun(10, 50, 10));
    expect(sunAt(list, 19)).toEqual(sun(10, 50, 10));
    expect(sunAt(list, 20)).toEqual(sun(20, 75, 5));
    expect(sunAt(list, 25)).toBeNull();
    expect(sunAt(undefined, 5)).toBeNull();
  });

  it("ownedInterventions owns a sun by its step only", () => {
    const list = [sun(10, 50, 30)];
    expect(ownedInterventions(list, 0, 10)).toEqual(list);
    expect(ownedInterventions(list, 10, 10)).toEqual([]);
    expect(ownedInterventions(list, 20, 30)).toEqual([]);
  });
});

describe("a sun's log line", () => {
  it("format and parse round-trip a sun line in key order", () => {
    const line = formatInterventionLine({ span: 9, percent: 75, kind: "sun", step: 4 } as ScheduledIntervention & { kind: "sun" });
    expect(line).toBe('{"step":4,"kind":"sun","percent":75,"span":9}\n');
    expect(parseInterventionLog(line)).toEqual([sun(4, 75, 9)]);
  });

  it("sameIntervention compares a sun by step, percent and span", () => {
    expect(sameIntervention(sun(4, 75, 9), sun(4, 75, 9))).toBe(true);
    expect(sameIntervention(sun(4, 75, 9), sun(4, 50, 9))).toBe(false);
    expect(sameIntervention(sun(4, 75, 9), sun(4, 75, 8))).toBe(false);
    expect(sameIntervention(sun(4, 75, 9), sun(5, 75, 9))).toBe(false);
    expect(sameIntervention(sun(4, 75, 9), { step: 4, kind: "lesion", x: 0, y: 0, r: 0 })).toBe(false);
  });

  it("labHistory carries suns in log order", () => {
    const h = labHistory({ interventions: [{ step: 3, kind: "lesion", x: 1, y: 1, r: 1 }, sun(5, 50, 10), { step: 8, kind: "feed", x: 1, y: 1, r: 1, amount: 2, matter: 2 }] });
    expect(h.scheduled).toEqual([{ step: 3, kind: "lesion", x: 1, y: 1, r: 1 }, sun(5, 50, 10), { step: 8, kind: "feed", x: 1, y: 1, r: 1, amount: 2, matter: 2 }]);
    expect(() => labHistory({ interventions: [sun(5, 50, 10), sun(6, 50, 10)] })).toThrow(/suns do not overlap/);
    // A key the lab never writes is refused on the logged object, never dropped before validation.
    expect(() => labHistory({ interventions: [{ ...sun(5, 50, 10), phase: 777 }] })).toThrow(/^interventions\[0\]: a sun has no key "phase" \(its keys are step, kind, percent, span\)$/);
    expect(() => labHistory({ interventions: [{ step: 5, kind: "sun", percent: 50 }] })).toThrow(/span must be an integer/);
  });

  it("checkInterventionLog accepts a sun line and refuses a wrong percent or span", () => {
    const schedule = [sun(5, 50, 10)];
    const block = { file: INTERVENTIONS_FILE, applied: 1 };
    expect(() => checkInterventionLog("seg", formatInterventionLine(sun(5, 50, 10) as never), schedule, cfg, 0, 10, block)).not.toThrow();
    expect(() => checkInterventionLog("seg", formatInterventionLine(sun(5, 75, 10) as never), schedule, cfg, 0, 10, block)).toThrow(/line 1 \(sun at t=5, 75% for 10 steps\) is not the scheduled sun at t=5 \(entry 0 of the schedule, 50% for 10 steps\)/);
    expect(() => checkInterventionLog("seg", formatInterventionLine(sun(5, 50, 9) as never), schedule, cfg, 0, 10, block)).toThrow(/is not the scheduled sun/);
  });
});

describe("runExperiment with a sun", () => {
  // A sun at t=20 for 20 steps (to t=40), a lesion inside it, and a sun at t=45 that ends off the census grid, at t=53.
  const schedule: ScheduledIntervention[] = [sun(20, 50, 20), { step: 25, kind: "lesion", x: 16, y: 16, r: 3 }, sun(45, 125, 8)];
  const spec: RunSpec = { ...small, interventions: schedule };
  const L50 = sunLight(cfg, 50), L125 = sunLight(cfg, 125);

  it("lands the light at its step and restores it at its end, mid-chunk too; the log has the start only", async () => {
    const out = memorySink();
    const res = await runExperiment(device, spec, out.sink, host, () => {}, { keepFinal: true });
    const calls = lastSim().calls.filter((c) => c.startsWith("light") || c.startsWith("run") || c.startsWith("lesion"));
    expect(calls).toEqual([
      "run 10", "run 10", `light ${L50.lightBase},${L50.lightAmp},${L50.seasonAmp}`,
      "run 5", "lesion 16,16,3", "run 5", "run 10", "light null",
      "run 5", `light ${L125.lightBase},${L125.lightAmp},${L125.seasonAmp}`, "run 5", "run 3", "light null", "run 7",
    ]);
    expect(out.files.get(INTERVENTIONS_FILE)).toBe(['{"step":20,"kind":"sun","percent":50,"span":20}', '{"step":25,"kind":"lesion","x":16,"y":16,"r":3}', '{"step":45,"kind":"sun","percent":125,"span":8}', ""].join("\n"));
    expect(JSON.parse(out.files.get("manifest.json")!).interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 3 });
    expect(res.summary.conservationOk).toBe(true);
    // cfg stays the world's own: the final state and every checkpoint carry it.
    expect(res.final!.cfg).toEqual(cfg);
    // Each checkpoint carries the sun active at its step: 20 and 30 inside the first (its start step included), 40 at its end not, 50 inside the second.
    const sunOf = (t: number) => decodeArtifact(out.bytes.get(`checkpoints/t${String(t).padStart(9, "0")}.blck`)!).observer.sun;
    expect(sunOf(10)).toBeUndefined();
    expect(sunOf(20)).toEqual({ step: 20, percent: 50, span: 20 });
    expect(sunOf(30)).toEqual({ step: 20, percent: 50, span: 20 });
    expect(sunOf(40)).toBeUndefined();
    expect(sunOf(50)).toEqual({ step: 45, percent: 125, span: 8 });
    expect(sunOf(60)).toBeUndefined();
    expect(decodeArtifact(out.bytes.get("checkpoints/t000000040.blck")!).state.cfg).toEqual(cfg);
    expect(res.observer.sun).toBeUndefined();
  }, SLOW);

  it("is the reference history, and differs from a clean run", async () => {
    const res = await runExperiment(device, spec, memorySink().sink, host, () => {}, { keepFinal: true });
    const ref = new SunRefSim(cloneState(start));
    const { applyLesion } = await import("@bl/sim-ref");
    ref.run(20); ref.setLightNow(L50); ref.run(5); applyLesion(ref, 16, 16, 3); ref.run(15); ref.setLightNow(null);
    ref.run(5); ref.setLightNow(L125); ref.run(8); ref.setLightNow(null); ref.run(7);
    expect(stateHash(res.final!)).toBe(stateHash(ref.state));
    const clean = await runExperiment(device, { ...spec, interventions: [schedule[1]] }, memorySink().sink, host, () => {}, { keepFinal: true });
    expect(stateHash(clean.final!)).not.toBe(stateHash(res.final!));
    expect(clean.final!.lightIn).not.toBe(res.final!.lightIn);
  }, SLOW);

  it("segmented equals continuous with a span crossing a cut: inside, at its step and at its end", async () => {
    const whole = memorySink();
    const cont = await runExperiment(device, spec, whole.sink, host);
    let state: WorldState | undefined, observer: ObserverState | undefined;
    const logs: string[] = [];
    for (const [from, to] of [[0, 20], [20, 30], [30, 40], [40, 50], [50, 60]]) {
      const out = memorySink();
      const r = await runExperiment(device, { ...spec, steps: to - from }, out.sink, host, () => {}, { keepFinal: true, ...(state ? { start: state, observer } : {}) });
      logs.push(out.files.get(INTERVENTIONS_FILE)!);
      state = r.final;
      observer = r.observer;
      // The final observer carries an open span: at 20 and 30 the first sun, at 50 the second.
      expect(observer.sun, `t=${to}`).toEqual(to === 20 || to === 30 ? { step: 20, percent: 50, span: 20 } : to === 50 ? { step: 45, percent: 125, span: 8 } : undefined);
      if (to === 60) expect(r.summary.finalHash).toBe(cont.summary.finalHash);
    }
    expect(logs.join("")).toBe(whole.files.get(INTERVENTIONS_FILE));
  }, SLOW);

  it("a start observer whose sun disagrees with the schedule is refused", async () => {
    const out = memorySink();
    await runExperiment(device, { ...spec, steps: 30 }, out.sink, host);
    const { state, observer } = decodeArtifact(out.bytes.get("checkpoints/t000000030.blck")!);
    const other = [sun(20, 75, 20), schedule[1]];
    expect(await rejection({ ...spec, interventions: other }, { start: state, observer: observer as ObserverState })).toMatch(/^the start checkpoint was taken under another sun than this schedule's: its observer says 50% from t=20 for 20 steps, the schedule 75% from t=20 for 20 steps at t=30/);
    expect(await rejection({ ...spec, interventions: [schedule[1]] }, { start: state, observer: observer as ObserverState })).toMatch(/observer says 50% .* the schedule no sun at t=30/);
    const { sun: _drop, ...bare } = observer as ObserverState;
    expect(await rejection(spec, { start: state, observer: bare as ObserverState })).toMatch(/observer says no sun, the schedule 50% from t=20/);
  }, SLOW);

  it("an unscheduled continuation keeps the observer's sun to its end", async () => {
    const out = memorySink();
    await runExperiment(device, { ...spec, steps: 30 }, out.sink, host);
    const { state, observer } = decodeArtifact(out.bytes.get("checkpoints/t000000030.blck")!);
    const plain: RunSpec = { ...small, steps: 15 };
    const r = await runExperiment(device, plain, memorySink().sink, host, () => {}, { keepFinal: true, start: state, observer: observer as ObserverState });
    expect(lastSim().calls.filter((c) => c.startsWith("light") || c.startsWith("run"))).toEqual([`light ${L50.lightBase},${L50.lightAmp},${L50.seasonAmp}`, "run 10", "light null", "run 5"]);
    const ref = new SunRefSim(cloneState(state));
    ref.setLightNow(L50); ref.run(10); ref.setLightNow(null); ref.run(5);
    expect(stateHash(r.final!)).toBe(stateHash(ref.state));
    expect(r.observer.sun).toBeUndefined();
  }, SLOW);

  it("a step-0 sun is installed before the first step", async () => {
    const s0: RunSpec = { ...small, steps: 20, checkpointEvery: 0, interventions: [sun(0, 75, 15)] };
    const out = memorySink();
    await runExperiment(device, s0, out.sink, host);
    const L75 = sunLight(cfg, 75);
    expect(lastSim().calls.filter((c) => c.startsWith("light") || c.startsWith("run"))).toEqual([`light ${L75.lightBase},${L75.lightAmp},${L75.seasonAmp}`, "run 10", "run 5", "light null", "run 5"]);
    expect(out.files.get(INTERVENTIONS_FILE)).toBe('{"step":0,"kind":"sun","percent":75,"span":15}\n');
  }, SLOW);

  it("refuses before the GPU: a sun the world cannot take, and a malformed observer sun", async () => {
    expect(await rejection({ ...spec, interventions: [sun(20, 150, 5)] })).toMatch(/cannot take a sun of 150%/);
    expect(validateSpec({ ...spec, interventions: [sun(20, 50, 20), sun(30, 50, 5)] }).join()).toMatch(/suns do not overlap/);
    const out = memorySink();
    await runExperiment(device, { ...spec, steps: 30 }, out.sink, host);
    const bytes = out.bytes.get("checkpoints/t000000030.blck")!;
    const { state, observer } = decodeArtifact(bytes);
    expect(observer.sun).toEqual({ step: 20, percent: 50, span: 20 });
    // Every malformed observer sun is refused by decodeArtifact, the gate every artifact from elsewhere passes.
    const withSun = (s: WorldState, o: ObserverState, u: unknown) => () => decodeArtifact(encodeCheckpoint(s, { ...o, sun: u }));
    const MALFORMED = /^checkpoint: observer sun is malformed/;
    for (const [what, u] of [
      ["a percent outside the set", { step: 20, percent: 60, span: 20 }],
      ["a string percent", { step: 20, percent: "50", span: 20 }],
      ["a zero span", { step: 20, percent: 50, span: 0 }],
      ["a span past SUN_SPAN_MAX", { step: 20, percent: 50, span: SUN_SPAN_MAX + 1 }],
      ["an extra key", { step: 20, percent: 50, span: 20, phase: 1 }],
      ["a missing key", { step: 20, percent: 50 }],
      ["an end at the observer's step", { step: 20, percent: 50, span: 10 }],
      ["an end before it", { step: 5, percent: 50, span: 10 }],
      ["a start after it", { step: 31, percent: 50, span: 10 }],
      ["null", null],
    ] as const) expect(withSun(state, observer as ObserverState, u), what).toThrow(MALFORMED);
    // An end past MAX_STEP, on an artifact near the step limit that is otherwise well formed.
    const late = { ...cloneState(state), step: MAX_STEP - 1 };
    const lateObs = { ...(observer as ObserverState), step: MAX_STEP - 1 };
    expect(() => decodeArtifact(encodeCheckpoint(late, { ...lateObs, sun: { step: MAX_STEP - 2, percent: 50, span: 2 } }))).not.toThrow();
    expect(withSun(late, lateObs, { step: MAX_STEP - 2, percent: 50, span: 100 }), "an end past MAX_STEP").toThrow(MALFORMED);
  }, SLOW);

  it("continues a step-0 checkpoint taken under a sun (a lab world saved before its first step); a step-0 start owns its step-0 entries", async () => {
    // As the lab saves it: the start world after its step-0 sun (which changes no state), and an observer at t=0 carrying it.
    const settings = observerSettings(small);
    const zero = serializeObservers(restoreObservers(undefined, settings, cfg), 0, settings);
    const held: ObserverState = { ...zero, sun: { step: 0, percent: 50, span: 10 } };
    const art = decodeArtifact(encodeCheckpoint(cloneState(start), held));
    expect(art.observer.sun).toEqual({ step: 0, percent: 50, span: 10 });
    const plain: RunSpec = { ...small, steps: 20, checkpointEvery: 0 };
    const L = `light ${L50.lightBase},${L50.lightAmp},${L50.seasonAmp}`;
    const ref = new SunRefSim(cloneState(start));
    ref.setLightNow(L50); ref.run(10); ref.setLightNow(null); ref.run(10);
    // With no schedule, the observer's sun governs to its end.
    const bare = await runExperiment(device, plain, memorySink().sink, host, () => {}, { keepFinal: true, start: art.state, observer: art.observer });
    expect(lastSim().calls.filter((c) => c.startsWith("light") || c.startsWith("run"))).toEqual([L, "run 10", "light null", "run 10"]);
    expect(stateHash(bare.final!)).toBe(stateHash(ref.state));
    // With the matching schedule, the call owns its step-0 sun as any run from step 0 does: installed once (the same light again,
    // which changes no state), logged once, and the bundle stitches as a whole run's first segment.
    const scheduled: RunSpec = { ...plain, interventions: [sun(0, 50, 10)] };
    const out = memorySink();
    const again = await runExperiment(device, scheduled, out.sink, host, () => {}, { keepFinal: true, start: art.state, observer: art.observer });
    expect(lastSim().calls.filter((c) => c.startsWith("light") || c.startsWith("run"))).toEqual([L, "run 10", "light null", "run 10"]);
    expect(stateHash(again.final!)).toBe(stateHash(ref.state));
    expect(out.files.get(INTERVENTIONS_FILE)).toBe('{"step":0,"kind":"sun","percent":50,"span":10}\n');
    const files = Object.fromEntries(out.files);
    expect(() => stitchRun([{ index: 0, startStep: 0, steps: 20, digest: again.summary.finalHash, files }], 20)).not.toThrow();
    // A schedule with another step-0 sun disagrees with the checkpoint.
    expect(await rejection({ ...plain, interventions: [sun(0, 75, 10)] }, { start: art.state, observer: art.observer })).toMatch(/^the start checkpoint was taken under another sun than this schedule's: its observer says 50% from t=0 for 10 steps, the schedule 75% from t=0 for 10 steps at t=0/);
    // An observer at step 0 without its start state is a fresh run's, whose suns are its own entries.
    expect(await rejection(plain, { observer: art.observer })).toMatch(/^an observer at step 0 without its start state cannot carry a sun/);
  }, SLOW);

  it("a sun-less step-0 start from a checkpoint applies and logs its step-0 entries, as before suns existed", async () => {
    // A pristine step-0 checkpoint (no sun) is a world before its step-0 entries: they apply to it, and are logged, as a fresh run's.
    const settings = observerSettings(small);
    const zero = serializeObservers(restoreObservers(undefined, settings, cfg), 0, settings);
    const art = decodeArtifact(encodeCheckpoint(cloneState(start), zero));
    const feed: ScheduledIntervention = { step: 0, kind: "feed", x: 16, y: 16, r: 0, amount: 1 };
    const lesion: ScheduledIntervention = { step: 0, kind: "lesion", x: 8, y: 8, r: 2 };
    const spec0: RunSpec = { ...small, steps: 20, checkpointEvery: 0, interventions: [lesion, feed] };
    const fresh = memorySink();
    const a = await runExperiment(device, spec0, fresh.sink, host, () => {}, { keepFinal: true });
    const resumed = memorySink();
    const b = await runExperiment(device, spec0, resumed.sink, host, () => {}, { keepFinal: true, start: art.state, observer: art.observer });
    expect(stateHash(b.final!)).toBe(stateHash(a.final!));
    expect(resumed.files.get(INTERVENTIONS_FILE)).toBe(fresh.files.get(INTERVENTIONS_FILE));
    expect(parseInterventionLog(resumed.files.get(INTERVENTIONS_FILE)!).map((e) => e.kind)).toEqual(["lesion", "feed"]);
    // And the start's matter did move: not the same as a run that skipped them.
    const skipped = await runExperiment(device, { ...spec0, interventions: undefined }, memorySink().sink, host, () => {}, { keepFinal: true, start: art.state, observer: art.observer });
    expect(stateHash(skipped.final!)).not.toBe(stateHash(b.final!));
  }, SLOW);
});
