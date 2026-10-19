import { describe, expect, it } from "vitest";
import {
  applyFeed, buildWorld, cellCount, clampLesionRadius, cloneState, CH, defaultConfig, generalistGenome, initWorld, presetConfig, PRESETS, RULE_VERSION, stateHash, worldW,
  type Intervention, type PondScore, type WorldConfig, type WorldState,
} from "@bl/schema";
import { applyLesion, RefSim, type MutationEvent } from "@bl/sim-ref";
import { FamilyTree, FAMILIES_RULESET, type FamilyInput, type FamilySummary, FirstsDetector, FIRSTS_RULESET, FIRSTS_RULESET_V0, FIRSTS_RULESET_V1, firstsContext, type FirstsInput } from "@bl/metrics";
import frozenV1 from "../../../tests/e2e/fixtures/pond-keeper-session.json";
import frozenV2 from "../../../tests/e2e/fixtures/pond-keeper-session-v2.json";
import { LabExecution, type LabSimulation } from "../src/execution.ts";
import type { RunManifest } from "../src/protocol.ts";
import {
  buildSessionFile, exportRefusal, interventionFacts, replayCommand, replayExperiment, RewindStore, sessionFileError, sessionFileName, SESSION_FORMAT, SESSION_VERSION, SESSION_VERSIONS,
  familiesBlock, type FamiliesReading, type Genealogy, type RewindRecord, type SessionFile,
} from "../src/session-file.ts";
import { feedCensus, logRefusal, openFirstsLog, rewindRecord, woundsBetween, type FirstsLog } from "../src/firsts-log.ts";

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
  /** Ledger records the next drain reports as lost (an overflowed event buffer). */
  dropNext = 0;
  constructor(state: WorldState) { this.ref = new RefSim(cloneState(state)); }
  get cfg() { return this.ref.state.cfg; }
  get step() { return this.ref.state.step; }
  run(n: number) { this.events.push(...this.ref.run(n)); }
  async drainLedger() {
    const events = this.events.splice(0);
    const dropped = this.dropNext;
    this.dropNext = 0;
    return { events, dropped, flux: this.ref.state.flux, step: this.step, lightIn: this.ref.state.lightIn, heatOut: this.ref.state.heatOut };
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

/**
 * One world with its log of firsts and family tree fed as the worker feeds them (`feedCensus`): every observed census, through the
 * thunks, the wounds read from `interventions` (the manifest's log, which a replay's re-applied entries join, as `onReplayed` does in the worker).
 */
function session(state: WorldState, opts: { observer?: ConstructorParameters<typeof LabExecution>[2]["observer"]; log?: FirstsLog; every?: number; feedLog?: boolean; interventions?: Intervention[] } = {}) {
  const every = opts.every ?? 100;
  const cfgSettings = { ...settings, censusEvery: every };
  const sim = new CpuSimulation(state);
  const interventions = opts.interventions ?? [];
  const log = opts.log ?? openFirstsLog(state, every, { edgesFrom: 0, edges: 0, dropped: 0 });
  const seen: number[] = [];
  const inputs: FirstsInput[] = [];
  const familyInputs: FamilyInput[] = [];
  const notices: string[] = [];
  const execution = new LabExecution(sim, cfgSettings, {
    start: state, observer: opts.observer, waitForIdle: async () => {}, isCurrent: () => true,
    onObservation: opts.feedLog === false ? undefined : (c, dropped, firsts, families) => {
      seen.push(c.step);
      const record = (extras?: Parameters<NonNullable<typeof firsts>>[0]) => {
        const input = firsts!(extras);
        inputs.push(JSON.parse(JSON.stringify(input)));
        return input;
      };
      const watched = families && {
        parentOf: families.parentOf,
        input: () => {
          const input = families.input();
          familyInputs.push(JSON.parse(JSON.stringify(input)));
          return input;
        },
      };
      feedCensus(log, { census: c, dropped, firsts: record, families: watched, cfg: sim.cfg, interventions }, (m) => notices.push(m));
    },
    onReplayed: (iv) => { interventions.push(iv); },
  });
  const advanceTo = async (step: number) => { while (sim.step < step) await execution.advanceFrame(step - sim.step); };
  return { sim, execution, log, detector: log.detector, tree: log.tree, seen, inputs, familyInputs, notices, interventions, advanceTo, settings: cfgSettings };
}

/** The card's family counts: the tree's summary less its rule set and steps. */
const countsOf = (tree: FamilyTree) => {
  const { rules: _r, watchedFrom: _w, step: _s, ...counts } = tree.summary();
  return counts;
};

/** What `buildSessionFile` takes of a session's tree. */
const reading = (log: FirstsLog): FamiliesReading => ({ watchedFrom: log.tree.watchedFrom, families: log.tree.families(), events: log.tree.events() });

/** The tree of a jar watched from t=100 that split once, at t=5,200: two living families, one of them founded by the split. */
const split: { reading: FamiliesReading; summary: FamilySummary } = {
  reading: {
    watchedFrom: 100,
    families: [
      { founder: "0:5", name: "Reed", parent: null, parentName: null, founded: 100, unknownDescent: false, status: "living", bodyNow: true, cells: 90, bodies: 3, purity: 0.9, share: 0.6, depth: 0 },
      { founder: "4800:12", name: "Reed amber", parent: "0:5", parentName: "Reed", founded: 5200, unknownDescent: false, status: "living", bodyNow: true, cells: 60, bodies: 2, purity: null, share: 0.4, depth: 1 },
    ],
    events: [{ step: 5200, kind: "split", family: "4800:12", name: "Reed amber", detail: "Reed amber split from Reed: 60 cells against 90" }],
  },
  summary: { rules: FAMILIES_RULESET, watchedFrom: 100, step: 5300, named: 2, starting: 1, split: 1, living: 2, film: 0, extinct: 0 },
};
/** The card's counts before any tree has watched. */
const none = { named: 0, starting: 0, split: 0, living: 0, film: 0, extinct: 0 };

function manifestOf(state: WorldState, presetId: string, init: RunManifest["init"], cfgSettings: RunManifest["settings"], interventions: Intervention[]): RunManifest {
  return {
    runId: `${presetId}-s${state.cfg.seed}-test`, presetId, seed: state.cfg.seed, cfg: state.cfg, init, ruleVersion: RULE_VERSION, createdAt: "2026-10-17T00:00:00.000Z", adapter: "test",
    userAgent: "test", interventions, checkpoints: [], settings: cfgSettings, startHash: stateHash(state), edgesFrom: 0,
  };
}

/** The run of a non-pond world: a wound at the census t=100, a feed and a drain at t=150, on to t=300, then exported. */
async function plainSession() {
  const start = initial();
  const log: Intervention[] = [];
  const s = session(start, { interventions: log });
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
  const file = buildSessionFile({
    manifest: manifestOf(start, "spots", plainInit, settings, log), stateHash: stateHash(saved.state), step: saved.state.step,
    firsts: { watchedFrom: s.detector.watchedFrom, entries: s.detector.entries() }, families: reading(s.log),
    card: { summary: s.detector.summary(), facts: interventionFacts(log, new Map(), null, undefined, s.tree.summary()) }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
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
    expect(SESSION_VERSION).toBe(3);
    expect(file.firsts.rules).toBe(FIRSTS_RULESET);
    expect(FIRSTS_RULESET).toBe("firsts-v2");
    expect(file.families).toMatchObject({ rules: FAMILIES_RULESET, watchedFrom: 100 });
    expect(file.families!.families.length).toBeGreaterThan(0);
    expect(file.card.facts.families).toMatchObject({ named: file.families!.families.length, split: 0 });
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
    // The family tree replays as the log does: the same families and events, the file's block.
    expect(reading(again.log)).toEqual(reading(s.log));
    expect(read.families).toEqual(JSON.parse(JSON.stringify(familiesBlock(reading(again.log)))));
    // The wounds the detector read are the replay's too: the log it was fed holds the wound at t=100, seen by the census at t=200.
    expect(s.inputs.map((i) => [i.step, i.wounds.length])).toEqual([[100, 0], [200, 1], [300, 0]]);
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
    const record: RewindRecord = JSON.parse(JSON.stringify(rewindRecord(first.log, { edgesFrom: 0, edges: 0, dropped: 0 }, stateHash(mid.state), mid.state.step)));
    expect(FirstsDetector.restore(record.firsts).lastStep).toBe(mid.state.step);
    // The checkpoint artifact round trip is the lab's own (execution.test.ts); here the observer state is carried as it is.
    const rest = session(cloneState(mid.state), { observer: mid.observer, log: openFirstsLog(mid.state, 100, { edgesFrom: 0, edges: 0, dropped: 0 }, record) });
    await rest.advanceTo(500);
    await rest.execution.checkpoint();
    expect(rest.detector.entries()).toEqual(whole.detector.entries());
    expect(rest.detector.summary()).toEqual(whole.detector.summary());
    // The family tree came back with it, against the same genealogy, and goes on as the continuous one does.
    expect(rest.tree.watchedFrom).toBe(100);
    expect(rest.tree.families()).toEqual(whole.tree.families());
    expect(rest.tree.events()).toEqual(whole.tree.events());
    expect(rest.seen).toEqual([300, 400, 500]);
  }, 120_000);
});

describe("the session file of a bred pond world", () => {
  // ponds-small's physics at seed 1 with a 4-step period and a census every 2 steps, as in execution.test.ts.
  const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
  const pondWorld = () => initWorld(presetConfig(pondsSmall, 1, { pondPeriod: 4 }), pondsSmall.init);

  it("exports picks (one by hand, one the rule's) and a wound, and the replay reaches the same hash, entries and summary", async () => {
    const start = pondWorld();
    const log: Intervention[] = [];
    const s = session(start, { every: 2, interventions: log });
    s.execution.setHandPicks(true);
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
    const facts = interventionFacts(log, notes, null, undefined, s.tree.summary());
    expect(facts).toEqual({ picks: { total: 2, byHand: 1, byRule: 1, unknown: 0 }, wounds: 1, feeds: 0, drains: 0, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null }, families: countsOf(s.tree) });
    const file = buildSessionFile({
      manifest, stateHash: stateHash(saved.state), step: saved.state.step,
      firsts: { watchedFrom: s.detector.watchedFrom, entries: s.detector.entries() }, families: reading(s.log), card: { summary: s.detector.summary(), facts }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
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
    expect(again.tree.families()).toEqual(s.tree.families());
    expect(again.tree.events()).toEqual(s.tree.events());
    expect(again.familyInputs).toEqual(s.familyInputs);
    // Each census, boundary censuses (t=4, t=8) included, is read from its own genome words, before the boundary's pond cycle reseeds:
    // what its bodies hold of a lineage never exceeds what the census says that lineage holds.
    expect(s.familyInputs.map((i) => i.step)).toEqual([2, 4, 6, 8, 10]);
    for (const input of s.familyInputs) {
      const held = new Map(input.lineages.map((l) => [l.key, l.cells]));
      const sums = new Map<string, number>();
      for (const b of input.bodies) for (const [k, n] of b.keys) sums.set(k, (sums.get(k) ?? 0) + n);
      for (const [k, n] of sums) expect(n, `t=${input.step} ${k}`).toBeLessThanOrEqual(held.get(k) ?? 0);
    }
    // The wound at t=4 reached the detector as the census after it saw it, in the pond its centre lies in, on both runs.
    const wounded = s.inputs.filter((i) => i.wounds.length > 0);
    expect(wounded.map((i) => i.step)).toEqual([6]);
    expect(wounded[0].wounds[0]).toMatchObject({ step: 4, r: expect.any(Number) });
    expect(wounded[0].wounds[0].tile).toBe(Math.floor(at.y / start.cfg.tileH) * start.cfg.tilesX + Math.floor(at.x / start.cfg.tileW));
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
  /** A well-formed version 3 file of a breeder world, made from a history alone: sessionFileError checks consistency, a replay checks the hash. */
  function pressured(log: Intervention[], step = period * 3, tree: { reading: FamiliesReading; summary: FamilySummary | undefined } = { reading: { watchedFrom: null, families: [], events: [] }, summary: undefined }): SessionFile {
    const detector = new FirstsDetector(firstsContext(bredCfg, 100));
    const manifest: RunManifest = {
      runId: "breeder-s1-test", presetId: "breeder", seed: 1, cfg: bredCfg, init: pondsSmall.init, ruleVersion: RULE_VERSION, createdAt: "2026-10-17T00:00:00.000Z", adapter: "test",
      userAgent: "test", interventions: log, checkpoints: [], settings, startHash: "0123456789abcdef", edgesFrom: 0,
    };
    return buildSessionFile({
      manifest, stateHash: "89abcdef01234567", step, firsts: { watchedFrom: 100, entries: [] }, families: tree.reading,
      card: { summary: detector.summary(), facts: interventionFacts(log, new Map(), null, undefined, tree.summary) }, adapter: "test", createdAt: "2026-10-17T00:00:00.000Z",
    });
  }
  const dial = (step: number, cycle: number, score: PondScore): Intervention => ({ step, kind: "pressure", cycle, score });
  const pick = (cycle: number, donors: number[]): Intervention => ({ step: cycle * period, kind: "pick", cycle, donors });

  it("writes version 3 with the firsts-v2 rule set and a families block, and accepts a pressured, picked history", () => {
    expect(SESSION_VERSIONS).toEqual([1, 2, 3]);
    const file = pressured([dial(period, 1, "body"), pick(1, [2]), pick(2, [0]), dial(period * 2, 3, "mass"), pick(3, [1])]);
    expect([file.version, file.firsts.rules]).toEqual([3, "firsts-v2"]);
    expect(file.families).toEqual({ rules: "families-v1", watchedFrom: null, families: [], events: [] });
    expect(file.card.facts.pressures).toEqual({ changes: 2, latest: "mass" });
    expect(file.card.facts.families).toEqual({ named: 0, starting: 0, split: 0, living: 0, film: 0, extinct: 0 });
    expect(sessionFileError(file)).toBeNull();
    expect(sessionFileError(JSON.stringify(file))).toBeNull();
  });

  it("writes the family tree as the note lists it, and the card’s counts with it", () => {
    const file = pressured([], period * 6, split);
    expect(file.families).toEqual({
      rules: "families-v1", watchedFrom: 100,
      families: [
        { name: "Reed", founder: "0:5", parent: null, founded: 100, unknownDescent: false, status: "living", cells: 90, bodies: 3, purity: 0.9 },
        { name: "Reed amber", founder: "4800:12", parent: "0:5", founded: 5200, unknownDescent: false, status: "living", cells: 60, bodies: 2, purity: null },
      ],
      events: [{ step: 5200, kind: "split", family: "4800:12", detail: "Reed amber split from Reed: 60 cells against 90" }],
    });
    expect(file.card.facts.families).toEqual({ named: 2, starting: 1, split: 1, living: 2, film: 0, extinct: 0 });
    expect(sessionFileError(JSON.stringify(file))).toBeNull();
  });

  it.each([
    ["no families block", (f: Record<string, any>) => { delete f.families; }, /must hold a families block/],
    ["another tree rule set", (f: Record<string, any>) => { f.families.rules = "families-v0"; }, /rule set “families-v1”/],
    ["a family that is not well formed", (f: Record<string, any>) => { f.families.families[0].status = "dormant"; }, /families\[0\] is malformed/],
    ["a purity above 1", (f: Record<string, any>) => { f.families.families[0].purity = 1.5; }, /families\[0\] is malformed/],
    ["two families with one founding lineage", (f: Record<string, any>) => { f.families.families[1].founder = "0:5"; }, /repeats the founding lineage 0:5/],
    ["two families with one name", (f: Record<string, any>) => { f.families.families[1].name = "Reed"; }, /repeats the name “Reed”/],
    ["a parent that is not in the list", (f: Record<string, any>) => { f.families.families[1].parent = "9:9"; }, /parent family that is not in the list/],
    ["a family its own parent", (f: Record<string, any>) => { f.families.families[1].parent = "4800:12"; }, /parent family that is not in the list/],
    ["an extinct family with cells", (f: Record<string, any>) => { f.families.families[0].status = "extinct"; }, /extinct but holds 90 cells/],
    ["a family founded before the tree watched", (f: Record<string, any>) => { f.families.families[0].founded = 99; }, /before the tree began watching/],
    ["families but no watchedFrom", (f: Record<string, any>) => { f.families.watchedFrom = null; }, /before the tree began watching/],
    ["an event about a family that is not listed", (f: Record<string, any>) => { f.families.events[0].family = "7:7"; }, /about a family that is not in the list/],
    ["an event of another kind", (f: Record<string, any>) => { f.families.events[0].kind = "merge"; }, /events\[0\] is malformed/],
    ["events out of step order", (f: Record<string, any>) => { f.families.events.push({ step: 5100, kind: "film", family: "0:5", detail: "x" }); }, /step order/],
    ["two families each the other's parent", (f: Record<string, any>) => { f.families.families[0].parent = "4800:12"; }, /families\[0\] sits on a loop of parent families/],
    ["a tree that began watching after the final state", (f: Record<string, any>) => { f.families.watchedFrom = 10_000_000; }, /began watching at t=10000000, after the final state/],
    ["a family founded after the final state", (f: Record<string, any>) => { f.families.families[1].founded = 10_000_000; }, /families\[1\] was founded at t=10000000, after the final state/],
    ["an event after the final state", (f: Record<string, any>) => { f.families.events[0].step = 10_000_000; }, /events\[0\] \(at t=10000000\) falls outside its family's history/],
    ["an event before its family was founded", (f: Record<string, any>) => { f.families.events.unshift({ step: 150, kind: "film", family: "4800:12", detail: "x" }); }, /events\[0\] \(at t=150\) falls outside its family's history/],
    ["no family counts on the card",(f: Record<string, any>) => { delete f.card.facts.families; }, /card.facts must give the family counts/],
    ["a family count that is not a number", (f: Record<string, any>) => { f.card.facts.families.split = "one"; }, /card.facts.families.split is not a whole number/],
    ["counts that disagree with the block", (f: Record<string, any>) => { f.card.facts.families.living = 1; }, /family counts disagree/],
  ])("refuses a version 3 file with %s", (_name, change, message) => {
    const f = structuredClone(pressured([], period * 6, split)) as unknown as Record<string, any>;
    change(f);
    expect(sessionFileError(JSON.stringify(f))).toMatch(message);
  });

  it("refuses a families block in an older version, and an older rule set in a newer one", () => {
    const f = structuredClone(pressured([], period * 6, split)) as unknown as Record<string, any>;
    expect(sessionFileError({ ...f, version: 2 })).toMatch(/version 2 file’s firsts must name the rule set “firsts-v1”/);
    expect(sessionFileError({ ...f, version: 2, firsts: { ...f.firsts, rules: FIRSTS_RULESET_V1 } })).toMatch(/a version 2 file has no families block/);
    expect(sessionFileError({ ...f, firsts: { ...f.firsts, rules: FIRSTS_RULESET_V1 } })).toMatch(/version 3 file’s firsts must name the rule set “firsts-v2”/);
    expect(sessionFileError({ ...f, version: 4 })).toMatch(/reads versions 1, 2 and 3/);
  });

  it("still reads the frozen version 2 fixture: firsts-v1, a pressure, no families", () => {
    const file = structuredClone(frozenV2) as unknown as SessionFile;
    expect([file.version, file.firsts.rules]).toEqual([2, FIRSTS_RULESET_V1]);
    expect(file.families).toBeUndefined();
    expect(sessionFileError(JSON.stringify(frozenV2))).toBeNull();
    expect(file.replay).toBe(replayCommand(file, sessionFileName(file.runId, file.final.step)));
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
    expect(facts).toEqual({ picks: { total: 3, byHand: 1, byRule: 1, unknown: 1 }, wounds: 2, feeds: 1, drains: 1, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null }, families: none });
    // A sun is no pick, wound or feed: counted apart, and only when there is one (no session file holds one, so a file's facts never carry the key).
    const sunned = interventionFacts([...log, { step: 15, kind: "sun", percent: 50, span: 10 }, { step: 30, kind: "sun", percent: 75, span: 5 }], new Map([[4, true], [8, false]]), null);
    expect(sunned).toEqual({ ...facts, suns: 2 });
    expect(Object.hasOwn(facts, "suns")).toBe(false);
    const replayed = { ok: true, from: 0, to: 100, live: "a", twin: "a", handAtEnd: false };
    expect(interventionFacts([], new Map(), replayed).replay).toBe(replayed);
    expect(interventionFacts([], new Map(), null)).toEqual({ picks: { total: 0, byHand: 0, byRule: 0, unknown: 0 }, wounds: 0, feeds: 0, drains: 0, replay: null, step: 0, cycles: 0, cyclesBefore: 0, pressures: { changes: 0, latest: null }, families: none });
    // The tree's counts ride along: the summary less its rule set and steps.
    expect(interventionFacts([], new Map(), null, undefined, split.summary).families).toEqual({ named: 2, starting: 1, split: 1, living: 2, film: 0, extinct: 0 });
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
    ["version 4", () => edit((f) => { f.version = 4; }), /reads versions 1, 2 and 3/],
    ["a version 1 file under the version 3 rule set", () => edit((f) => { f.version = 1; }), /version 1 file’s firsts must name the rule set “firsts-v0”/],
    ["a version 3 file under the version 0 rule set", () => edit((f) => { f.firsts.rules = "firsts-v0"; }), /version 3 file’s firsts must name the rule set “firsts-v2”/],
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

  it("refuses a history that holds a sun, which no session file version holds, and buildSessionFile will not write one", () => {
    const sun = { step: 40, kind: "sun" as const, percent: 50, span: 100 };
    expect(exportRefusal({ ...planted, interventions: [{ step: 3, kind: "lesion", x: 1, y: 1, r: 2 }] })).toBeNull();
    expect(exportRefusal({ ...planted, interventions: [{ step: 3, kind: "lesion", x: 1, y: 1, r: 2 }, sun] })).toMatch(/^This world ran under a sun from t=40, and a session file can’t hold a sun yet\. Its checkpoint download still works/);
    expect(() => buildSessionFile({ manifest: { startHash: "0123456789abcdef", interventions: [sun] } as unknown as RunManifest, stateHash: "x", step: 300, firsts: { watchedFrom: null, entries: [] }, families: null as never, card: null as never, adapter: "test", createdAt: "" }))
      .toThrow(/cannot hold a sun/);
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

describe("the family tree in the log of firsts", () => {
  const genealogy: Genealogy = { edgesFrom: 0, edges: 0, dropped: 0 };

  it("is fed every census beside the detector, with the ledger's parent links, and gives the detector its view", async () => {
    const s = session(initial());
    await s.advanceTo(300);
    expect(s.tree.watchedFrom).toBe(100);
    expect([s.tree.lastStep, s.detector.lastStep]).toEqual([300, 300]);
    expect(s.seen).toEqual([100, 200, 300]);
    expect(s.familyInputs.map((i) => i.step)).toEqual([100, 200, 300]);
    // The world is planted here with every edge from step 0: no family is of unknown descent, and each census's input carries the tree's view.
    expect(s.tree.families().length).toBeGreaterThan(0);
    expect(s.tree.families().every((f) => !f.unknownDescent)).toBe(true);
    expect(s.inputs.every((i) => i.family !== undefined && i.family.splits.length === 0)).toBe(true);
    // Both read one census: a body's keyed cells never exceed what the census says its lineage holds.
    for (const [i, input] of s.familyInputs.entries()) {
      const held = new Map(input.lineages.map((l) => [l.key, l.cells]));
      const seen = new Map<string, number>();
      for (const b of input.bodies) for (const [k, n] of b.keys) seen.set(k, (seen.get(k) ?? 0) + n);
      for (const [k, n] of seen) expect(n, `census ${i} lineage ${k}`).toBeLessThanOrEqual(held.get(k) ?? 0);
    }
    expect(logRefusal(s.log)).toBeNull();
  }, 120_000);

  it("reads a lesion as a wound at the census after it, and not at all at the first census it watches", async () => {
    const log: Intervention[] = [{ step: 0, kind: "lesion", x: 3, y: 3, r: 1 }];
    const s = session(initial(), { interventions: log });
    await s.advanceTo(100);
    log.push({ step: 100, kind: "lesion", x: 11, y: 4, r: s.sim.lesion(11, 4, 1) });
    await s.advanceTo(300);
    // The lesion at t=0 is before the first census it watches (t=100); the one at t=100 is seen by t=200, in the second pond.
    expect(s.inputs.map((i) => i.wounds)).toEqual([[], [{ step: 100, tile: 1, r: log[1].kind === "lesion" ? log[1].r : -1 }], []]);
  }, 120_000);

  it("stops the tree alone when a ledger record is dropped while it watches, and says so", async () => {
    const s = session(initial());
    await s.advanceTo(200);
    expect(s.tree.lastStep).toBe(200);
    s.sim.dropNext = 2;
    await s.advanceTo(300);
    expect(s.log.treeStopped).toMatch(/2 mutation events dropped \(event buffer full\) by the census at t=300/);
    expect(s.log.stopped).toBeNull();
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatch(/^The family tree stopped \(.*\)\. The log of firsts carries on without it/);
    // The detector carries on without a family input; the tree keeps what it had.
    expect([s.detector.lastStep, s.tree.lastStep]).toEqual([300, 200]);
    expect(s.inputs.map((i) => i.family !== undefined)).toEqual([true, true, false]);
    await s.advanceTo(400);
    expect([s.detector.lastStep, s.tree.lastStep, s.notices.length]).toEqual([400, 200, 1]);
    // A session file is refused, as for a stopped log; a checkpoint keeps no record at all, since a restored detector
    // beside a fresh tree would clear the refusal while its `new-family` entries stayed missing.
    expect(logRefusal(s.log)).toMatch(/^The family tree stopped \(.*\), so the session file would leave it out/);
    const saved = await s.execution.checkpoint();
    expect(rewindRecord(s.log, genealogy, stateHash(saved.state), saved.state.step)).toBeNull();
    // A restore from no record starts the detector and the tree afresh together, and nothing is refused.
    const reopened = openFirstsLog(saved.state, 100, genealogy, undefined);
    expect([reopened.detector.lastStep, reopened.tree.lastStep, reopened.treeStopped, logRefusal(reopened)]).toEqual([null, null, null, null]);
  }, 120_000);

  it("allows records dropped before it began to watch: unknown ancestry from before is a root, not an error", async () => {
    const s = session(initial());
    s.sim.dropNext = 3;
    await s.advanceTo(200);
    expect(s.log.treeStopped).toBeNull();
    expect(s.tree.watchedFrom).toBe(100);
    expect(s.notices).toEqual([]);
  }, 120_000);

  it("stops the whole log on a tree error, and feeds nothing after", () => {
    const log = openFirstsLog(initial(), 100, genealogy);
    const notices: string[] = [];
    let detectorReads = 0;
    const feed = (families: { input(): FamilyInput; parentOf(key: string): string | undefined }) => ({
      census: { step: 100 }, dropped: 0, cfg: initial().cfg, interventions: [] as Intervention[], families,
      firsts: () => { detectorReads++; return {} as FirstsInput; },
    });
    expect(feedCensus(log, feed({ input: () => { throw new Error("boom"); }, parentOf: () => undefined }), (m) => notices.push(m))).toBe(false);
    expect(log.stopped).toBe("boom");
    expect(notices).toEqual(["The log of firsts stopped (boom). The world itself is fine; a session file can’t be made from this history."]);
    expect(feedCensus(log, feed({ input: () => { throw new Error("again"); }, parentOf: () => undefined }), (m) => notices.push(m))).toBe(false);
    expect([detectorReads, notices.length]).toEqual([0, 1]);
    expect(logRefusal(log)).toMatch(/^The log of firsts stopped \(boom\)/);
    expect(rewindRecord(log, genealogy, "h", 100)).toBeNull();
  });

  describe("rewind", () => {
    const record = async () => {
      const first = session(initial());
      await first.advanceTo(200);
      const mid = await first.execution.checkpoint();
      const made = rewindRecord(first.log, { edgesFrom: 0, edges: 7, dropped: 0 }, stateHash(mid.state), mid.state.step)!;
      return { first, mid, record: JSON.parse(JSON.stringify(made)) as RewindRecord };
    };

    it("brings the tree back with the log only against the genealogy it was read against", async () => {
      const { first, mid, record: rec } = await record();
      expect(rec.families?.genealogy).toEqual({ edgesFrom: 0, edges: 7, dropped: 0 });
      const same = openFirstsLog(mid.state, 100, { edgesFrom: 0, edges: 7, dropped: 0 }, rec);
      expect([same.detector.lastStep, same.tree.lastStep]).toEqual([200, 200]);
      expect(same.tree.families()).toEqual(first.tree.families());
      expect(same.tree.events()).toEqual(first.tree.events());
      // Another genealogy (its edges read back short, begun later, or with other records lost): the detector still comes back, the tree starts afresh.
      for (const other of [{ edgesFrom: 0, edges: 6, dropped: 0 }, { edgesFrom: 200, edges: 7, dropped: 0 }, { edgesFrom: 0, edges: 7, dropped: 1 }]) {
        const reopened = openFirstsLog(mid.state, 100, other, rec);
        expect([reopened.detector.lastStep, reopened.tree.lastStep, reopened.tree.watchedFrom], JSON.stringify(other)).toEqual([200, null, null]);
      }
    }, 120_000);

    it("restores no tree for a state other than the checkpoint's, or from a record without one, or from a snapshot it cannot read", async () => {
      const { mid, record: rec } = await record();
      const g = { edgesFrom: 0, edges: 7, dropped: 0 };
      // Another hash: neither comes back.
      const elsewhere = openFirstsLog(mid.state, 100, g, { ...rec, hash: "0".repeat(16) });
      expect([elsewhere.detector.lastStep, elsewhere.tree.lastStep]).toEqual([null, null]);
      const { families: _dropped, ...bare } = rec;
      expect([openFirstsLog(mid.state, 100, g, bare).detector.lastStep, openFirstsLog(mid.state, 100, g, bare).tree.lastStep]).toEqual([200, null]);
      const broken = openFirstsLog(mid.state, 100, g, { ...rec, families: { ...rec.families!, tree: { ...rec.families!.tree, v: 9 } as never } });
      expect([broken.detector.lastStep, broken.tree.lastStep]).toEqual([200, null]);
      // A tree snapshot of another census than the state's.
      const later = session(initial());
      await later.advanceTo(300);
      const stale = openFirstsLog(mid.state, 100, g, { ...rec, families: { tree: later.tree.snapshot(), genealogy: g } });
      expect([stale.detector.lastStep, stale.tree.lastStep]).toEqual([200, null]);
    }, 120_000);

    // A record kept in a `.rewind` sidecar can come from another state's file or an older build (docs/pond-keeper-v0-2026-10-17.md,
    // amendment of 2026-10-18): only a record of this very state speaks for its picks, and only a detector read as this build reads
    // this world comes back.
    it("takes pick notes only from a record of this state, and a detector only with this build's context", async () => {
      const { mid, record: rec } = await record();
      const g = { edgesFrom: 0, edges: 7, dropped: 0 };
      const withPick: RewindRecord = { ...rec, picks: [[100, true]] };
      const own = openFirstsLog(mid.state, 100, g, withPick);
      expect([own.detector.lastStep, [...own.notes]]).toEqual([200, [[100, true]]]);
      // Another state's record: no log, no tree and no notes, so the pick reads as one this page never saw chosen.
      const elsewhere = openFirstsLog(mid.state, 100, g, { ...withPick, hash: "0".repeat(16) });
      expect([elsewhere.detector.lastStep, elsewhere.tree.lastStep, elsewhere.notes.size]).toEqual([null, null, 0]);
      const facts = interventionFacts([{ step: 100, kind: "pick", cycle: 1, donors: [0] }], elsewhere.notes, null);
      expect([facts.picks.byHand, facts.picks.unknown]).toEqual([0, 1]);
      // This state, read under another context (as a later build might, with other gene bits or another cadence): the detector and
      // the tree start afresh, the notes on this state's picks stay.
      for (const ctx of [{ ...rec.firsts.ctx, censusEvery: 50 }, { ...rec.firsts.ctx, geneBits: [0] }, { ...rec.firsts.ctx, tiles: 1, tilesX: 1 }]) {
        const reread = openFirstsLog(mid.state, 100, g, { ...withPick, firsts: { ...rec.firsts, ctx } });
        expect([reread.detector.lastStep, reread.tree.lastStep, [...reread.notes]], JSON.stringify(ctx)).toEqual([null, null, [[100, true]]]);
      }
    }, 120_000);
  });
});

describe("woundsBetween", () => {
  const cfg = { tileW: 8, tileH: 8, tilesX: 2, tilesY: 2 };
  const lesion = (step: number, x: number, y: number): Intervention => ({ step, kind: "lesion", x, y, r: 2 });

  it("takes the lesions with from <= step < to, in log order, as the pond their centre lies in", () => {
    const log: Intervention[] = [lesion(99, 1, 1), lesion(100, 1, 1), lesion(150, 9, 1), lesion(150, 1, 9), lesion(199, 15, 15), lesion(200, 1, 1)];
    expect(woundsBetween(log, cfg, 100, 200)).toEqual([
      { step: 100, tile: 0, r: 2 }, { step: 150, tile: 1, r: 2 }, { step: 150, tile: 2, r: 2 }, { step: 199, tile: 3, r: 2 },
    ]);
    expect(woundsBetween(log, cfg, 0, 100)).toEqual([{ step: 99, tile: 0, r: 2 }]);
    expect(woundsBetween(log, cfg, 200, 300)).toEqual([{ step: 200, tile: 0, r: 2 }]);
  });

  it("ignores picks, feeds and pressures, and wraps a centre outside the world as the lesion does", () => {
    const log: Intervention[] = [
      { step: 120, kind: "feed", x: 1, y: 1, r: 2, amount: 5, matter: 5 }, { step: 120, kind: "pick", cycle: 1, donors: [0] }, { step: 120, kind: "pressure", cycle: 2, score: "mass" },
      lesion(130, -1, 0), lesion(140, 16, 17.9),
    ];
    expect(woundsBetween(log, cfg, 100, 200)).toEqual([{ step: 130, tile: 1, r: 2 }, { step: 140, tile: 0, r: 2 }]);
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
