import { describe, expect, it } from "vitest";
import {
  applyFeed, buildWorld, cellCount, clampLesionRadius, cloneState, CH, defaultConfig, generalistGenome, initWorld, presetConfig, PRESETS, RULE_VERSION, stateHash, worldW,
  type Intervention, type PondScore, type WorldConfig, type WorldState,
} from "@bl/schema";
import { applyLesion, RefSim, type MutationEvent } from "@bl/sim-ref";
import { FirstsDetector, FIRSTS_RULESET, FIRSTS_RULESET_V0, firstsContext, type FirstsInput } from "@bl/metrics";
import frozenV1 from "../../../tests/e2e/fixtures/pond-keeper-session.json";
import { LabExecution, type LabSimulation } from "../src/execution.ts";
import type { RunManifest } from "../src/protocol.ts";
import {
  buildSessionFile, exportRefusal, interventionFacts, replayCommand, replayExperiment, RewindStore, sessionFileError, sessionFileName, SESSION_FORMAT, SESSION_VERSION, SESSION_VERSIONS,
  type RewindRecord, type SessionFile,
} from "../src/session-file.ts";

// The lab's execution on the reference physics (the harness of execution.test.ts, which does not export it): only
// GPU readback is substituted. Sessions are run, exported as the worker does it (a settled checkpoint, the log of
// firsts fed through the observation callback's thunk) and replayed from step 0.
const settings = { censusEvery: 100, deepEvery: 5, activityThreshold: null };
function initial() {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, kernelRadius: 2, tilesX: 2, tilesY: 1 };
  return buildWorld(cfg, { nutrient: 20, founders: [{ x: 3, y: 3, radius: 2, genome: generalistGenome(cfg.defaultMu, cfg.defaultSigma), biomass: 100, energy: 200 }] });
}
const plainInit = { kind: "generalist", founders: 0, nutrient: 0, biomass: 0 } as const;

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
  lesion(cx: number, cy: number, r: number) {
    const eff = clampLesionRadius(this.cfg, r);
    applyLesion(this.ref, cx, cy, eff);
    return eff;
  }
  async feed(cx: number, cy: number, r: number, amount: number) { return applyFeed(this.ref.state, cx, cy, r, amount); }
}

/** One world with its log of firsts fed as the worker feeds it: every observed census, through the thunk. */
function session(state: WorldState, opts: { observer?: ConstructorParameters<typeof LabExecution>[2]["observer"]; detector?: FirstsDetector; every?: number; feedLog?: boolean } = {}) {
  const every = opts.every ?? 100;
  const cfgSettings = { ...settings, censusEvery: every };
  const sim = new CpuSimulation(state);
  const detector = opts.detector ?? new FirstsDetector(firstsContext(state.cfg, every));
  const seen: number[] = [];
  const inputs: FirstsInput[] = [];
  const execution = new LabExecution(sim, cfgSettings, {
    start: state, observer: opts.observer, waitForIdle: async () => {}, isCurrent: () => true,
    onObservation: opts.feedLog === false ? undefined : (c, _d, firsts) => {
      seen.push(c.step);
      const input = firsts!();
      inputs.push(JSON.parse(JSON.stringify(input)));
      detector.observe(input);
    },
  });
  const advanceTo = async (step: number) => { while (sim.step < step) await execution.advanceFrame(step - sim.step); };
  return { sim, execution, detector, seen, inputs, advanceTo, settings: cfgSettings };
}

function manifestOf(state: WorldState, presetId: string, init: RunManifest["init"], cfgSettings: RunManifest["settings"], interventions: Intervention[]): RunManifest {
  return {
    runId: `${presetId}-s${state.cfg.seed}-test`, presetId, seed: state.cfg.seed, cfg: state.cfg, init, ruleVersion: RULE_VERSION, createdAt: "2026-10-17T00:00:00.000Z", adapter: "test",
    userAgent: "test", interventions, checkpoints: [], settings: cfgSettings, startHash: stateHash(state), edgesFrom: 0,
  };
}

/** The run of a non-pond world: a wound at the census t=100, a feed and a drain at t=150, on to t=300, then exported. */
async function plainSession() {
  const start = initial();
  const s = session(start);
  const log: Intervention[] = [];
  await s.advanceTo(100);
  log.push({ step: 100, kind: "lesion", x: 3, y: 3, r: s.sim.lesion(3, 3, 1) });
  await s.advanceTo(150);
  for (const [x, y, amount] of [[3, 3, 24], [11, 4, -5]]) {
    const res = await s.sim.feed(x, y, 2, amount);
    s.execution.recordFeed(res.matter);
    log.push({ step: 150, kind: "feed", x, y, r: res.radius, amount, matter: res.matter });
  }
  await s.advanceTo(300);
  const saved = await s.execution.checkpoint();
  const facts = interventionFacts(log, new Map(), null);
  const file = buildSessionFile({
    manifest: manifestOf(start, "spots", plainInit, settings, log), stateHash: stateHash(saved.state), step: saved.state.step,
    firsts: { watchedFrom: s.detector.watchedFrom, entries: s.detector.entries() }, card: { summary: s.detector.summary(), facts }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
  });
  return { start, s, saved, log, file };
}

describe("the session file of a lab run", () => {
  it("exports a world with a wound, a feed and a drain, and its replay reaches the same state, observer and firsts", async () => {
    const { start, s, saved, file } = await plainSession();
    const text = JSON.stringify(file, null, 2);
    expect(sessionFileError(text)).toBeNull();
    expect(file.final).toEqual({ step: 300, stateHash: stateHash(saved.state), interventions: 3 });
    expect(file.checkpoints).toEqual([{ step: 300, file: "session-final", hash: stateHash(saved.state), interventions: 3 }]);
    expect(file.format).toBe(SESSION_FORMAT);
    expect(file.version).toBe(SESSION_VERSION);
    expect(SESSION_VERSION).toBe(2);
    expect(file.firsts.rules).toBe(FIRSTS_RULESET);
    expect(FIRSTS_RULESET).toBe("firsts-v1");
    expect(file.firsts.entries.some((e) => e.id === "body")).toBe(true);
    expect(file.card.facts).toMatchObject({ picks: { total: 0 }, wounds: 1, feeds: 1, drains: 1, pressures: { changes: 0, latest: null } });
    expect(file.replay).toBe(replayCommand(file, sessionFileName(file.runId, 300)));
    expect(replayExperiment(file)).toMatch(/^pond-keeper-[0-9a-f]{12}-[0-9a-f]{8}$/);
    // Same final state, another log (the same wound twice): another run directory.
    expect(replayExperiment({ ...file, interventions: [...file.interventions, file.interventions[0]] })).not.toBe(replayExperiment(file));
    expect(file.replay).toBe(`deno run -A tools/run.ts --experiment ${replayExperiment(file)} --preset spots --conditions treatment --seeds ${start.cfg.seed} --steps 300 --census 100 --deep 5 --picks-from ${file.runId}-t300.session.json`);

    // Replay from step 0: the file's own log, a fresh log of firsts fed the same way.
    const read = JSON.parse(text) as SessionFile;
    const again = session(initial());
    again.execution.queueReplay(read.interventions);
    await again.advanceTo(read.final.step);
    const replayed = await again.execution.checkpoint();
    expect(stateHash(replayed.state)).toBe(read.final.stateHash);
    expect(JSON.stringify(replayed.observer)).toBe(JSON.stringify(saved.observer));
    expect(again.detector.entries()).toEqual(read.firsts.entries);
    expect(again.detector.summary()).toEqual(read.card.summary);
    expect(again.seen).toEqual(s.seen);
    expect(again.inputs).toEqual(s.inputs);
    expect(again.execution.fed).toEqual(s.execution.fed);
  }, 120_000);

  it("feeding the log does not perturb the physics or the observer state", async () => {
    const run = async (feedLog: boolean) => {
      const s = session(initial(), { feedLog });
      await s.advanceTo(100);
      s.sim.lesion(3, 3, 1);
      await s.advanceTo(300);
      const saved = await s.execution.checkpoint();
      return { hash: stateHash(saved.state), observer: JSON.stringify(saved.observer), seen: s.seen };
    };
    const fed = await run(true), bare = await run(false);
    expect(fed.hash).toBe(bare.hash);
    expect(fed.observer).toBe(bare.observer);
    expect(fed.seen).toEqual([100, 200, 300]);
    expect(bare.seen).toEqual([]);
  }, 120_000);

  it("brings a log back from a snapshot through JSON: a restored world continues to the entries of a continuous run", async () => {
    const whole = session(initial());
    await whole.advanceTo(500);
    await whole.execution.checkpoint();

    const first = session(initial());
    await first.advanceTo(200);
    const mid = await first.execution.checkpoint();
    const record: RewindRecord = { firsts: JSON.parse(JSON.stringify(first.detector.snapshot())), picks: [], hash: stateHash(mid.state) };
    expect(FirstsDetector.restore(record.firsts).lastStep).toBe(mid.state.step);
    // The checkpoint artifact round trip is the lab's own (execution.test.ts); here the observer state is carried as it is.
    const rest = session(cloneState(mid.state), { observer: mid.observer, detector: FirstsDetector.restore(record.firsts) });
    await rest.advanceTo(500);
    await rest.execution.checkpoint();
    expect(rest.detector.entries()).toEqual(whole.detector.entries());
    expect(rest.detector.summary()).toEqual(whole.detector.summary());
    expect(rest.seen).toEqual([300, 400, 500]);
  }, 120_000);
});

describe("the session file of a bred pond world", () => {
  // ponds-small's physics at seed 1 with a 4-step period and a census every 2 steps, as in execution.test.ts.
  const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
  const pondWorld = () => initWorld(presetConfig(pondsSmall, 1, { pondPeriod: 4 }), pondsSmall.init);

  it("exports picks (one by hand, one the rule's) and a wound, and the replay reaches the same hash, entries and summary", async () => {
    const start = pondWorld();
    const s = session(start, { every: 2 });
    s.execution.setHandPicks(true);
    const log: Intervention[] = [];
    const notes = new Map<number, boolean>();
    const n = cellCount(start.cfg);
    let living = -1;
    for (let i = 0; i < n && living < 0; i++) if (start.cells[CH.B * n + i] > 0) living = i;
    expect(living).toBeGreaterThanOrEqual(0);
    const W = worldW(start.cfg), at = { x: living % W, y: Math.floor(living / W) };

    while (!s.execution.awaiting) await s.execution.advanceFrame(2);
    const handDonors = [3, 1];
    expect(s.execution.awaiting!.suggested).not.toEqual(handDonors);
    const one = await s.execution.resolvePond(handDonors);
    log.push({ step: one.step, kind: "pick", cycle: one.cycle, donors: one.donors });
    notes.set(one.step, true);
    // A wound made after the pick, at the boundary's own step: replayed after the pick, as the worker logs them.
    log.push({ step: s.sim.step, kind: "lesion", x: at.x, y: at.y, r: s.sim.lesion(at.x, at.y, 2) });
    while (!s.execution.awaiting) await s.execution.advanceFrame(2);
    const suggested = s.execution.awaiting!.suggested.slice();
    const two = await s.execution.resolvePond(null);
    log.push({ step: two.step, kind: "pick", cycle: two.cycle, donors: two.donors });
    notes.set(two.step, false);
    expect(two.donors).toEqual(suggested);
    await s.execution.advanceFrame(2);
    const saved = await s.execution.checkpoint();
    expect(saved.state.step).toBe(10);
    expect(log.map((iv) => [iv.step, iv.kind])).toEqual([[4, "pick"], [4, "lesion"], [8, "pick"]]);

    // The preset is planted with an override here (pondPeriod 4), so a replay command would not rebuild it: the refusal says so.
    const manifest = manifestOf(start, "ponds-small", pondsSmall.init, s.settings, log);
    expect(exportRefusal(manifest)).toMatch(/settings changed from its preset/);
    const facts = interventionFacts(log, notes, null);
    expect(facts).toEqual({ picks: { total: 2, byHand: 1, byRule: 1, unknown: 0 }, wounds: 1, feeds: 0, drains: 0, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null } });
    const file = buildSessionFile({
      manifest, stateHash: stateHash(saved.state), step: saved.state.step,
      firsts: { watchedFrom: s.detector.watchedFrom, entries: s.detector.entries() }, card: { summary: s.detector.summary(), facts }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
    });
    expect(file.firsts.watchedFrom).toBe(2);
    expect(file.firsts.entries.some((e) => e.id === "body")).toBe(true);
    const text = JSON.stringify(file, null, 2);
    expect(sessionFileError(text)).toBeNull();

    // Replay from step 0 with the picks as logged and no one at the controls; the horizon keeps the boundary at t=8 from waiting.
    const read = JSON.parse(text) as SessionFile;
    const again = session(pondWorld(), { every: 2 });
    again.execution.queueReplay(read.interventions, read.final.step + 1);
    await again.advanceTo(read.final.step);
    const replayed = await again.execution.checkpoint();
    expect(again.execution.awaiting).toBeNull();
    expect(stateHash(replayed.state)).toBe(read.final.stateHash);
    expect(JSON.stringify(replayed.observer)).toBe(JSON.stringify(saved.observer));
    expect(again.detector.entries()).toEqual(read.firsts.entries);
    expect(again.detector.summary()).toEqual(read.card.summary);
    expect(again.inputs).toEqual(s.inputs);
  }, 600_000);
});

describe("interventionFacts counts a pressure apart from the picks", () => {
  it("counts pressures and names the latest score, and never as a pick", () => {
    const log: Intervention[] = [
      { step: 4, kind: "pressure", cycle: 1, score: "body" },
      { step: 4, kind: "pick", cycle: 1, donors: [3] },
      { step: 8, kind: "pick", cycle: 2, donors: [0] },
      { step: 8, kind: "pressure", cycle: 3, score: "drive+seed" },
    ];
    const facts = interventionFacts(log, new Map([[4, false], [8, false]]), null);
    expect(facts.pressures).toEqual({ changes: 2, latest: "drive+seed" });
    expect(facts.picks).toEqual({ total: 2, byHand: 0, byRule: 2, unknown: 0 });
    expect([facts.wounds, facts.feeds, facts.drains]).toEqual([0, 0, 0]);
  });
});

describe("the session file's versions", () => {
  const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
  const bredCfg = presetConfig(pondsSmall, 1, { pondArm: "breed", pondScore: "mass" });
  const period = bredCfg.pondPeriod!;
  /** A well-formed version 2 file of a breeder world, made from a history alone: sessionFileError checks consistency, a replay checks the hash. */
  function pressured(log: Intervention[], step = period * 3): SessionFile {
    const detector = new FirstsDetector(firstsContext(bredCfg, 100));
    const manifest: RunManifest = {
      runId: "breeder-s1-test", presetId: "breeder", seed: 1, cfg: bredCfg, init: pondsSmall.init, ruleVersion: RULE_VERSION, createdAt: "2026-10-17T00:00:00.000Z", adapter: "test",
      userAgent: "test", interventions: log, checkpoints: [], settings, startHash: "0123456789abcdef", edgesFrom: 0,
    };
    return buildSessionFile({
      manifest, stateHash: "89abcdef01234567", step, firsts: { watchedFrom: 100, entries: [] },
      card: { summary: detector.summary(), facts: interventionFacts(log, new Map(), null) }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
    });
  }
  const dial = (step: number, cycle: number, score: PondScore): Intervention => ({ step, kind: "pressure", cycle, score });
  const pick = (cycle: number, donors: number[]): Intervention => ({ step: cycle * period, kind: "pick", cycle, donors });

  it("writes version 2 with the firsts-v1 rule set, and accepts a pressured, picked history", () => {
    expect(SESSION_VERSIONS).toEqual([1, 2]);
    const file = pressured([dial(period, 1, "body"), pick(1, [2]), pick(2, [0]), dial(period * 2, 3, "mass"), pick(3, [1])]);
    expect([file.version, file.firsts.rules]).toEqual([2, "firsts-v1"]);
    expect(file.card.facts.pressures).toEqual({ changes: 2, latest: "mass" });
    expect(sessionFileError(file)).toBeNull();
    expect(sessionFileError(JSON.stringify(file))).toBeNull();
  });

  it("refuses a pressure out of order, not the observed history, or in a world that is not a breeder's", () => {
    // After the pick of the cycle it governs.
    expect(sessionFileError(pressured([pick(1, [2]), dial(period, 1, "body")]))).toMatch(/replayable history.*for cycle 1 comes after the pick for cycle 1/);
    // A cycle that is neither the waiting one nor the next.
    expect(sessionFileError(pressured([dial(period, 4, "body")]))).toMatch(/not the observed history/);
    // A score that is not one.
    expect(sessionFileError(pressured([dial(period, 1, "weight" as never)]))).toMatch(/replayable history/);
    // A pick after something set after the boundary at its step.
    expect(sessionFileError(pressured([dial(period, 2, "body"), pick(1, [2])]))).toMatch(/replayable history.*follows a pressure for the next cycle/);
    // A world whose arm does not breed has no dial.
    const scaf = pressured([dial(period, 1, "body")]);
    scaf.cfg = { ...scaf.cfg, pondArm: "scaf" };
    expect(sessionFileError(scaf)).toMatch(/replayable history.*pond arm breed/);
  });

  it("still reads the frozen version 1 fixture: firsts-v0, no pressure, its own replay command", () => {
    const text = JSON.stringify(frozenV1);
    const file = structuredClone(frozenV1) as unknown as SessionFile;
    expect([file.version, file.firsts.rules]).toEqual([1, FIRSTS_RULESET_V0]);
    expect(file.interventions.some((iv) => iv.kind === "pressure")).toBe(false);
    expect(sessionFileError(text)).toBeNull();
    expect(file.replay).toBe(replayCommand(file, sessionFileName(file.runId, file.final.step)));
    // A version 1 file cannot hold a pressure, and a version 2 file cannot name the old rule set.
    const withPressure = structuredClone(file) as unknown as Record<string, any>;
    withPressure.interventions.push({ step: file.final.step, kind: "pressure", cycle: file.final.step / file.cfg.pondPeriod! + 1, score: "mass" });
    withPressure.final.interventions++;
    withPressure.checkpoints[0].interventions++;
    expect(sessionFileError(withPressure)).toMatch(/a version 1 file cannot hold/);
    expect(sessionFileError({ ...file, version: 2 })).toMatch(/version 2 file’s firsts must name the rule set “firsts-v1”/);
  });
});

describe("interventionFacts", () => {
  it("counts picks by who chose them (the worker's notes), wounds, feeds and drains", () => {
    const log: Intervention[] = [
      { step: 4, kind: "pick", cycle: 1, donors: [3, 1] },
      { step: 4, kind: "lesion", x: 1, y: 1, r: 2 },
      { step: 8, kind: "pick", cycle: 2, donors: [0] },
      { step: 12, kind: "pick", cycle: 3, donors: [2] },
      { step: 12, kind: "lesion", x: 2, y: 2, r: 1 },
      { step: 13, kind: "feed", x: 5, y: 5, r: 2, amount: 24, matter: 24 },
      { step: 14, kind: "feed", x: 5, y: 5, r: 2, amount: -8, matter: -8 },
    ];
    // The pick at t=12 was made before this page's notes began (a world restored from an earlier visit): unknown, not guessed.
    const facts = interventionFacts(log, new Map([[4, true], [8, false]]), null);
    expect(facts).toEqual({ picks: { total: 3, byHand: 1, byRule: 1, unknown: 1 }, wounds: 2, feeds: 1, drains: 1, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null } });
    const reading = { ok: true, from: 0, to: 100, live: "a", twin: "a", handAtEnd: false };
    expect(interventionFacts([], new Map(), reading).replay).toBe(reading);
    expect(interventionFacts([], new Map(), null)).toEqual({ picks: { total: 0, byHand: 0, byRule: 0, unknown: 0 }, wounds: 0, feeds: 0, drains: 0, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null } });
    expect(interventionFacts([], new Map(), null, { step: 3000, cycles: 3, cyclesBefore: 2 })).toMatchObject({ step: 3000, cycles: 3, cyclesBefore: 2 });
  });
});

describe("sessionFileError", () => {
  const edit = async (change: (f: Record<string, any>) => void) => {
    const f = structuredClone((await base()) as unknown as Record<string, any>);
    change(f);
    return sessionFileError(JSON.stringify(f));
  };
  let cached: SessionFile | null = null;
  const base = async () => (cached ??= (await plainSession()).file);

  it("accepts the file it built, as an object and as text", async () => {
    const file = await base();
    expect(sessionFileError(file)).toBeNull();
    expect(sessionFileError(JSON.stringify(file))).toBeNull();
    expect(file.interventions.map((iv) => iv.step)).toEqual([100, 150, 150]);
  }, 120_000);

  it.each([
    ["text that isn’t JSON", async () => sessionFileError("{nope"), /isn’t JSON/],
    ["something that isn’t an object", async () => sessionFileError([1]), /expected a JSON object/],
    ["another format", () => edit((f) => { f.format = "cadence-garden.run"; }), /format/],
    ["version 3", () => edit((f) => { f.version = 3; }), /reads versions 1 and 2/],
    ["a version 1 file under the version 2 rule set", () => edit((f) => { f.version = 1; }), /version 1 file’s firsts must name the rule set “firsts-v0”/],
    ["a version 2 file under the version 1 rule set", () => edit((f) => { f.firsts.rules = "firsts-v0"; }), /version 2 file’s firsts must name the rule set “firsts-v1”/],
    ["no startHash", () => edit((f) => { delete f.startHash; }), /startHash/],
    ["a checkpoint hash that is not the final hash", () => edit((f) => { f.checkpoints[0].hash = "0".repeat(16); }), /checkpoint entry and its final state disagree/],
    ["an intervention after the final step", () => edit((f) => { f.interventions.push({ step: f.final.step + 100, kind: "lesion", x: 1, y: 1, r: 1 }); }), /after the file’s final step/],
    ["a final state at step 0", () => edit((f) => { f.final.step = 0; f.checkpoints[0].step = 0; f.interventions = []; f.final.interventions = 0; f.checkpoints[0].interventions = 0; }), /final.step is 0/],
    ["a wrong count of interventions in final", () => edit((f) => { f.final.interventions = 2; f.checkpoints[0].interventions = 2; }), /final says 2/],
    ["interventions out of step order", () => edit((f) => { f.interventions.reverse(); }), /step order/],
    ["another rule set", () => edit((f) => { f.firsts.rules = "firsts-v9"; }), /rule set/],
    ["an edited replay command", () => edit((f) => { f.replay += " --steps 5"; }), /replay command/],
    ["a history that does not start at step 0", () => edit((f) => { f.edgesFrom = 3; }), /edgesFrom/],
    ["a feed without the matter it moved", () => edit((f) => { delete f.interventions[1].matter; }), /replayable history/],
  ])("refuses %s", async (_name, run, message) => {
    expect(await run()).toMatch(message);
  }, 120_000);
});

describe("exportRefusal", () => {
  const preset = PRESETS.find((p) => p.id === "ponds-small")!;
  const planted = { presetId: preset.id, seed: 7, cfg: presetConfig(preset, 7), startHash: "0123456789abcdef", edgesFrom: 0 };

  it("allows a world planted from a preset as it is", () => {
    expect(exportRefusal(planted)).toBeNull();
    // A manifest older than the lineage fields has no edgesFrom, and is no worse for it.
    expect(exportRefusal({ ...planted, edgesFrom: undefined })).toBeNull();
  });

  it.each([
    ["no start hash", { startHash: undefined }, /no record of the start/],
    ["edges that begin mid-history", { edgesFrom: 5 }, /opened from a file at t=5/],
    ["a config with an override", { cfg: presetConfig(preset, 7, { pondK: 3 } as Partial<WorldConfig>) }, /settings changed from its preset/],
    ["one of the hunt's pond arms", { cfg: presetConfig(preset, 7, { pondArm: "nat" }) }, /pond arm “nat”/],
    ["an unknown preset", { presetId: "no-such-world" }, /isn’t one of the lab’s worlds/],
    ["a world opened from a file", { presetId: "imported" }, /opened from a file/],
  ])("refuses a world with %s, in words", (_name, change, message) => {
    expect(exportRefusal({ ...planted, ...change })).toMatch(message);
  });
});

describe("RewindStore", () => {
  const record = (n: number): RewindRecord => ({ firsts: new FirstsDetector(firstsContext(defaultConfig(), 100)).snapshot(), picks: [[n, true]], hash: `${n}` });

  it("keeps a record per checkpoint file, however many, until it is told to forget one", () => {
    const store = new RewindStore();
    store.set("a", record(1));
    store.set("b", record(2));
    expect(store.get("a")!.picks).toEqual([[1, true]]);
    expect(store.get("zzz")).toBeUndefined();
    store.forget(["a", "never-there"]);
    expect([store.get("a"), store.size]).toEqual([undefined, 1]);
    for (let i = 0; i < 70; i++) store.set(`f${i}`, record(i));
    // A checkpoint kept on the shelf keeps its record, however many saves came after it.
    expect([store.size, store.get("b")?.picks[0][0], store.get("f0")?.picks[0][0], store.get("f69")?.picks[0][0]]).toEqual([71, 2, 0, 69]);
    store.set("f6", record(99));
    expect(store.get("f6")?.picks[0][0]).toBe(99);
  });
});

// A reference for what the lab restores: the observer state a checkpoint carries is the execution's own, so the log
// of firsts is not in it (the digest is untouched) and a world adopted without a record starts a fresh log.
describe("a log that starts afresh", () => {
  it("watches from the first census it sees, and is not the checkpoint's observer state", async () => {
    const first = session(initial());
    await first.advanceTo(200);
    const mid = await first.execution.checkpoint();
    expect(Object.keys(mid.observer)).not.toContain("firsts");
    const fresh = session(cloneState(mid.state), { observer: mid.observer });
    await fresh.advanceTo(400);
    expect(fresh.detector.watchedFrom).toBe(300);
    expect(first.detector.watchedFrom).toBe(100);
  }, 120_000);
});
