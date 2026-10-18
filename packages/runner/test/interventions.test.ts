// Scheduled interventions in the headless runner (RunSpec.interventions; interventions.ts), without a GPU: the
// schedule's shape (validateSpec), its world-dependent refusals (interventionsError), the segment each entry belongs
// to, a lab manifest split into picks and scheduled entries (labHistory), run identity with and without the field, the
// island's refusal, the log format, applyScheduled against the CPU reference, and runExperiment's loop on a
// RefSim-backed stand-in for GpuSim (the mock below): where each entry lands among the steps, the census, the checkpoint
// and the conservation baselines, and that a continuation from a checkpoint equals the continuous run. The mock has
// GpuSim's surface as runExperiment uses it and the reference physics behind it, so the GPU's own bit-exactness
// (GpuSim.lesion and GpuSim.feed against applyLesion and applyFeed) is tests/deno's to show, not this file's.
import { describe, expect, it, vi } from "vitest";
import {
  CH,
  FEED_MAX,
  FeedRefusedError,
  MATTER_MAX,
  METRICS_VERSION,
  PRESETS,
  RULE_VERSION,
  SCHEMA_VERSION,
  applyFeed,
  applyPondCycle,
  cellCount,
  clampLesionRadius,
  cloneState,
  feedError,
  initWorld,
  pondDonors,
  pondMatter,
  stateHash,
  totalsOf,
  worldW,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { GpuSim } from "@bl/sim-gpu";
import {
  INTERVENTIONS_FILE,
  InterventionError,
  applyScheduled,
  decodeArtifact,
  formatInterventionLine,
  interventionsError,
  labHistory,
  observerSettings,
  ownedInterventions,
  parseInterventionLog,
  pondCensus,
  pondsHeader,
  picksFromManifest,
  restoreObservers,
  runExperiment,
  sameCompletedRun,
  serializeObservers,
  specConfig,
  specRefusal,
  ISLAND_CAPABILITIES,
  validateInterventions,
  validateSpec,
  type InterventionLogEntry,
  type InterventionSim,
  type ObserverState,
  type PressureEntry,
  type RunSpec,
  type ScheduledIntervention,
  type Sink,
} from "@bl/runner";

// A RefSim-backed GpuSim for runExperiment's loop: the same calls the runner makes (run, the readbacks, lesion, feed),
// recorded in order in `calls`. A `{}` device fails at create the way the real one does, at its first use, so the
// fake-device guards below still read "device.createBuffer is not a function".
vi.mock("@bl/sim-gpu", async () => {
  const { RefSim, applyLesion } = await import("@bl/sim-ref");
  const { applyFeed, cellCount, clampLesionRadius, cloneState, totalsOf, G } = await import("@bl/schema");
  class FakeGpuSim {
    static last: FakeGpuSim | null = null;
    readonly calls: string[] = [];
    readonly uploads: WorldState[] = [];
    readonly initial: WorldState;
    private ref: InstanceType<typeof RefSim>;
    private pending: { childHi: number; childLo: number; parentHi: number; parentLo: number }[] = [];
    private constructor(state: WorldState) {
      this.initial = cloneState(state);
      this.ref = new RefSim(state);
    }
    static async create(device: GPUDevice, state: WorldState) {
      (device as unknown as { createBuffer(): void }).createBuffer();
      return (FakeGpuSim.last = new FakeGpuSim(cloneState(state)));
    }
    get cfg() { return this.ref.cfg; }
    get step() { return this.ref.state.step; }
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
      this.calls.push("drain");
      const events = this.pending;
      this.pending = [];
      const s = this.ref.state;
      return { step: s.step, lightIn: s.lightIn, heatOut: s.heatOut, events, dropped: 0 };
    }
    async readSnapshot(withRoles = false) {
      this.calls.push("snapshot");
      const s = this.ref.state, n = cellCount(s.cfg);
      return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, (G.PARAM1 + 1) * n), roles: withRoles ? this.ref.roles.slice() : undefined, flux: s.flux.slice() };
    }
    async readStats() {
      this.calls.push("stats");
      const s = this.ref.state, t = totalsOf(s.cfg, s.cells);
      return { step: s.step, A: t.A, B: t.B, C: t.C, P: t.P, E: t.E, S: t.S, living: 0, dense: 0, lightIn: s.lightIn, heatOut: s.heatOut, flux: s.flux.slice() };
    }
    async readState() {
      this.calls.push("readState");
      return cloneState(this.ref.state);
    }
    async readGenomeChannels(first: number, count: number) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return s.genome.slice(first * n, (first + count) * n);
    }
    upload(state: WorldState) {
      this.calls.push("upload");
      this.uploads.push(cloneState(state));
      this.ref = new RefSim(cloneState(state));
    }
    destroy() {}
  }
  return { GpuSim: FakeGpuSim };
});

type Fake = { calls: string[]; uploads: WorldState[]; initial: WorldState };
const lastSim = (): Fake => (GpuSim as unknown as { last: Fake }).last!;

const host = { host: "test", adapter: "test" };
// A device the stand-in accepts, and one that fails at its first use as the real GpuSim.create does.
const device = { createBuffer() {}, queue: { onSubmittedWorkDone: async () => {} } } as unknown as GPUDevice;
const fakeDevice = {} as GPUDevice;

/**
 * A 32 x 32 spots world (kernel radius 4): 1,024 cells, so the reference physics steps it in about 40 ms. Nutrient
 * carries energy (eA 1, the default 0 would let a feed that forgets the energy baseline pass), so a feed moves both
 * conservation baselines.
 */
const spotsSmall: RunSpec = { experiment: "iv", presetId: "spots", condition: "treatment", seed: 1, steps: 40, censusEvery: 20, deepEvery: 100, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32, kernelRadius: 4, eA: 1 } };
const pondSpec: RunSpec = { experiment: "iv", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 4000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const spotsPreset = PRESETS.find((p) => p.id === "spots")!;
/** ponds-small at kernel radius 4 with a 2-step cycle: four 64 x 64 ponds, about 0.35 s a step on the reference. */
const pondTiny: RunSpec = { experiment: "iv", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 4, censusEvery: 2, deepEvery: 100, checkpointEvery: 2, overrides: { kernelRadius: 4, pondPeriod: 2 } };

const lesion = (step: number, x = 3, y = 4, r = 2): ScheduledIntervention => ({ step, kind: "lesion", x, y, r });
const feed = (step: number, amount = 4, extra: { x?: number; y?: number; r?: number; matter?: number } = {}): ScheduledIntervention => ({
  step,
  kind: "feed",
  x: extra.x ?? 5,
  y: extra.y ?? 6,
  r: extra.r ?? 2,
  amount,
  ...(extra.matter !== undefined ? { matter: extra.matter } : {}),
});

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

/** The message runExperiment rejects with, or "" if it resolves. */
async function rejection(spec: RunSpec, opts: Parameters<typeof runExperiment>[5] = {}, dev: GPUDevice = fakeDevice): Promise<string> {
  try {
    await runExperiment(dev, spec, memorySink().sink, host, () => {}, opts);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("validateSpec: interventions' shape", () => {
  const good: ScheduledIntervention[] = [
    { step: 0, kind: "lesion", x: 0, y: 0, r: 0 },
    feed(0, 4),
    feed(7, -FEED_MAX, { matter: -120 }),
    lesion(7, 31, 31, 1000),
    feed(40, FEED_MAX, { matter: 0 }),
  ];

  it("accepts the field absent and a well-formed schedule: several entries at one step, step 0, a drain, a long radius", () => {
    expect(validateSpec(spotsSmall)).toEqual([]);
    expect(validateSpec({ ...spotsSmall, interventions: good })).toEqual([]);
    expect(validateSpec({ ...spotsSmall, interventions: [lesion(5)] })).toEqual([]);
  });

  it("refuses a pressure with its own message: it is carried as RunSpec.pressures, never scheduled", () => {
    const p = { step: 5000, kind: "pressure", cycle: 1, score: "body" };
    expect(validateInterventions([p]).join()).toMatch(/interventions\[0\]: a pressure is not a scheduled intervention: it is carried as RunSpec.pressures by a picked run, which is never segmented or sent to an island/);
    expect(validateSpec({ ...spotsSmall, interventions: [lesion(5), p as never] }).join()).toMatch(/a pressure is not a scheduled intervention/);
    // any other unknown kind keeps the generic message
    expect(validateInterventions([{ step: 1, kind: "wound" }]).join()).toMatch(/kind must be "lesion" or "feed", got "wound"/);
  });

  const bad: [string, unknown, RegExp][] = [
    ["an empty array", [], /non-empty array/],
    ["null", null, /non-empty array/],
    ["a string", "7", /non-empty array/],
    ["an object", {}, /non-empty array/],
    ["a sparse array", [, lesion(1)], /interventions\[0\] must be an object/],
    ["an array of holes", new Array(2), /interventions\[\d\] must be an object/],
    ["a null entry", [lesion(1), null], /interventions\[1\] must be an object/],
    ["an array entry", [[]], /interventions\[0\] must be an object/],
    ["another kind", [{ ...lesion(1), kind: "pick" }], /kind must be "lesion" or "feed", got "pick"/],
    ["a lesion with an amount", [{ ...lesion(1), amount: 3 }], /a lesion has no key "amount"/],
    ["a feed with an extra key", [{ ...feed(1), extra: 1 }], /a feed has no key "extra"/],
    ["a lesion without its radius", [{ step: 1, kind: "lesion", x: 1, y: 1 }], /a lesion needs the key "r"/],
    ["a feed without its amount", [{ step: 1, kind: "feed", x: 1, y: 1, r: 1 }], /a feed needs the key "amount"/],
    ["a decreasing step", [lesion(5), lesion(4)], /interventions\[1\]: step 4 follows step 5/],
    ["a step NaN", [{ ...lesion(1), step: NaN }], /step must be a non-negative integer/],
    ["a negative step", [lesion(-1)], /step must be a non-negative integer/],
    ["a fractional step", [lesion(1.5)], /step must be a non-negative integer/],
    ["a step as text", [{ ...lesion(1), step: "1" }], /step must be a non-negative integer/],
    ["x NaN", [lesion(1, NaN)], /x must be a non-negative integer/],
    ["a negative y", [lesion(1, 1, -1)], /y must be a non-negative integer/],
    ["a fractional r", [lesion(1, 1, 1, 1.5)], /r must be a non-negative integer/],
    ["an infinite r", [lesion(1, 1, 1, Infinity)], /r must be a non-negative integer/],
    ["a zero amount", [feed(1, 0)], /amount must be a non-zero integer within ±4096/],
    ["an amount past FEED_MAX", [feed(1, FEED_MAX + 1)], /amount must be a non-zero integer within ±4096/],
    ["a drain past FEED_MAX", [feed(1, -FEED_MAX - 1)], /amount must be a non-zero integer within ±4096/],
    ["a fractional amount", [feed(1, 1.5)], /amount must be a non-zero integer/],
    ["an amount NaN", [feed(1, NaN)], /amount must be a non-zero integer/],
    ["a fractional matter", [feed(1, 4, { matter: 1.5 })], /matter must be an integer/],
    ["a matter NaN", [feed(1, 4, { matter: NaN })], /matter must be an integer/],
    ["a matter as text", [{ ...feed(1), matter: "3" }], /matter must be an integer/],
    ["a matter key holding undefined", [{ ...feed(1), matter: undefined }], /matter must be an integer/],
  ];
  it.each(bad)("rejects %s", (_name, list, re) => {
    const errs = validateSpec({ ...spotsSmall, interventions: list as ScheduledIntervention[] });
    // One error for each bad entry (an array of holes has one per hole), all of the kind named.
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) expect(e).toMatch(re);
    expect(validateInterventions(list)).toEqual(errs);
  });

  it("reads own keys only: an entry whose fields are inherited from a prototype is refused, not serialised as {}", () => {
    const inherited = Object.create({ step: 1, kind: "lesion", x: 1, y: 1, r: 1 });
    expect(validateInterventions([inherited])).toEqual(['interventions[0]: a lesion needs the key "step"']);
    const matterBehind = Object.assign(Object.create({ matter: 1.5 }), feed(1));
    expect(validateInterventions([matterBehind])).toEqual([]);
    expect(JSON.stringify(matterBehind)).not.toMatch(/matter/);
    // Names that sit on Object.prototype are keys like any other once they are the entry's own.
    const proto = JSON.parse('{"step":1,"kind":"lesion","x":1,"y":1,"r":1,"constructor":7,"__proto__":{"a":1}}');
    expect(validateInterventions([proto])).toEqual(['interventions[0]: a lesion has no key "constructor" (its keys are step, kind, x, y, r)']);
  });

  it("runExperiment refuses a malformed schedule before anything else", async () => {
    expect(await rejection({ ...spotsSmall, interventions: [lesion(5), lesion(4)] })).toMatch(/^invalid run spec: interventions\[1\]: step 4 follows step 5/);
  });
});

describe("interventionsError: what depends on the world", () => {
  const spots = specConfig(spotsSmall);
  const ponds = specConfig(pondSpec);

  it("is null for an absent schedule and for entries inside the world, on any start step", () => {
    expect(interventionsError(spotsSmall, spots, 0)).toBeNull();
    expect(interventionsError({ interventions: [lesion(1, 31, 31), feed(2, 4, { x: 0, y: 0 })] }, spots, 0)).toBeNull();
    expect(interventionsError({ interventions: [lesion(1, 31, 31)] }, spots, 5000)).toBeNull();
    // A malformed entry is validateInterventions's to report; this check steps over it.
    expect(interventionsError({ interventions: [, lesion(1)] as unknown as ScheduledIntervention[] }, spots, 0)).toBeNull();
  });

  it("refuses a centre past the world's width or height", () => {
    expect(interventionsError({ interventions: [lesion(1, 3, 3), lesion(2, 32, 0)] }, spots, 0)).toMatch(/^interventions\[1\] \(lesion at t=2\): x 32 is outside the world \(32 wide\)/);
    expect(interventionsError({ interventions: [feed(2, 4, { y: 32 })] }, spots, 0)).toMatch(/^interventions\[0\] \(feed at t=2\): y 32 is outside the world \(32 high\)/);
    // A multi-tile world is as wide as all its tiles.
    expect(worldW(ponds)).toBe(128);
    expect(interventionsError({ interventions: [lesion(1, 127, 127)] }, ponds, 0)).toBeNull();
    expect(interventionsError({ interventions: [lesion(1, 128, 0)] }, ponds, 0)).toMatch(/x 128 is outside the world \(128 wide\)/);
  });

  it("refuses a feed in a pond config with feedError's own reason, and lets a lesion through", () => {
    const reason = feedError(ponds, 4, 2)!;
    expect(reason).toMatch(/not defined for pond worlds/);
    const err = interventionsError({ interventions: [lesion(100), feed(200)] }, ponds, 0)!;
    expect(err).toMatch(/^interventions\[1\] \(feed at t=200\): /);
    expect(err).toContain(reason);
    expect(interventionsError({ interventions: [lesion(100, 60, 60, 5), lesion(200)] }, ponds, 0)).toBeNull();
  });

  it("runExperiment applies it before the GPU is touched, and a lesion in a pond world reaches the device", async () => {
    expect(await rejection({ ...pondSpec, interventions: [feed(200)] })).toMatch(/^interventions\[0\] \(feed at t=200\): feeding is not defined for pond worlds/);
    expect(await rejection({ ...spotsSmall, interventions: [lesion(1, 40)] })).toMatch(/x 40 is outside the world \(32 wide\)/);
    // Another segment's entry is checked all the same: the spec as a whole is what is invalid.
    expect(await rejection({ ...pondSpec, steps: 1000, interventions: [feed(3500)] })).toMatch(/feeding is not defined for pond worlds/);
    expect(await rejection({ ...pondSpec, interventions: [lesion(200, 60, 60, 5)] })).toMatch(/^device\.createBuffer is not a function$/);
  });
});

describe("ownedInterventions: the segment an entry belongs to", () => {
  const list = [lesion(0), feed(0), lesion(100), feed(100), lesion(150), lesion(200), lesion(201)];
  const steps = (xs: ScheduledIntervention[]) => xs.map((e) => `${e.kind}@${e.step}`);

  it("is the entries at steps in (start, start + steps], plus step 0 of a fresh run, in list order", () => {
    expect(steps(ownedInterventions(list, 0, 200))).toEqual(["lesion@0", "feed@0", "lesion@100", "feed@100", "lesion@150", "lesion@200"]);
    expect(steps(ownedInterventions(list, 0, 99))).toEqual(["lesion@0", "feed@0"]);
    // A continuation owns what its predecessor did not: the entry at its own start step was the predecessor's.
    expect(steps(ownedInterventions(list, 100, 100))).toEqual(["lesion@150", "lesion@200"]);
    expect(steps(ownedInterventions(list, 100, 101))).toEqual(["lesion@150", "lesion@200", "lesion@201"]);
    expect(steps(ownedInterventions(list, 200, 1000))).toEqual(["lesion@201"]);
    expect(ownedInterventions(list, 5000, 100)).toEqual([]);
    expect(ownedInterventions(undefined, 0, 100)).toEqual([]);
  });

  it("splits a history between consecutive segments without losing or repeating an entry", () => {
    const parts = [ownedInterventions(list, 0, 100), ownedInterventions(list, 100, 100), ownedInterventions(list, 200, 100)];
    expect(parts.flat()).toEqual(list);
  });
});

describe("labHistory: a lab run manifest as picks and scheduled entries", () => {
  const manifest = {
    runId: "r1",
    presetId: "ponds-small",
    seed: 1,
    edgesFrom: 0,
    interventions: [
      { step: 150, kind: "lesion", x: 10, y: 12, r: 3 },
      { step: 1000, kind: "pick", cycle: 1, donors: [2] },
      { step: 1000, kind: "lesion", x: 5, y: 5, r: 2 },
      { step: 1200, kind: "feed", x: 40, y: 41, r: 6, amount: 4, matter: 452 },
      { step: 1200, kind: "feed", x: 8, y: 9, r: 1, amount: -3, matter: -15 },
      { step: 2000, kind: "pick", cycle: 2, donors: [1, 3] },
    ],
  };

  it("splits it, keeping log order and carrying each feed's matter as the value to reproduce", () => {
    const { picks, scheduled } = labHistory(manifest);
    expect(picks).toEqual([
      { step: 1000, cycle: 1, donors: [2] },
      { step: 2000, cycle: 2, donors: [1, 3] },
    ]);
    expect(scheduled).toEqual([
      { step: 150, kind: "lesion", x: 10, y: 12, r: 3 },
      { step: 1000, kind: "lesion", x: 5, y: 5, r: 2 },
      { step: 1200, kind: "feed", x: 40, y: 41, r: 6, amount: 4, matter: 452 },
      { step: 1200, kind: "feed", x: 8, y: 9, r: 1, amount: -3, matter: -15 },
    ]);
    expect(validateInterventions(scheduled)).toEqual([]);
  });

  it("gives an empty schedule for a manifest of picks alone, and no picks for one without", () => {
    expect(labHistory({ interventions: [{ step: 1000, kind: "pick", cycle: 1, donors: [0] }] })).toEqual({ picks: [{ step: 1000, cycle: 1, donors: [0] }], scheduled: [], pressures: [] });
    expect(labHistory({ interventions: [] })).toEqual({ picks: [], scheduled: [], pressures: [] });
    expect(labHistory({ interventions: [lesion(5)] })).toEqual({ picks: [], scheduled: [lesion(5)], pressures: [] });
  });

  it("refuses edges observed from later, what is not a manifest, another kind and a malformed lesion or feed", () => {
    expect(() => labHistory({ ...manifest, edgesFrom: 4000 })).toThrow(/only from step 4000/);
    for (const m of [null, undefined, {}, { interventions: "x" }, 7]) expect(() => labHistory(m)).toThrow(/no interventions array/);
    expect(() => labHistory({ interventions: [{ step: 1, kind: "wound" }] })).toThrow(/interventions\[0\] is a "wound"/);
    expect(() => labHistory({ interventions: [lesion(1), { ...lesion(2), x: -1 }] })).toThrow(/lesions and feeds.*interventions\[1\]: x must be a non-negative integer/);
    expect(() => labHistory({ interventions: [lesion(5), lesion(4)] })).toThrow(/step 4 follows step 5/);
    expect(() => labHistory({ interventions: [{ ...feed(3), matter: 1.5 }] })).toThrow(/matter must be an integer/);
  });

  it("refuses a feed logged without its matter, where the lab's own replay would throw, and names its place in the manifest's list", () => {
    const bare = { step: 10, kind: "feed", x: 1, y: 1, r: 2, amount: 4 };
    expect(() => labHistory({ interventions: [bare] })).toThrow(/^interventions\[0\]: a logged feed needs the matter it moved$/);
    expect(() => labHistory({ interventions: [{ step: 5, kind: "pick", cycle: 1, donors: [0] }, lesion(6), { ...bare, step: 7 }] })).toThrow(/^interventions\[2\]: a logged feed needs the matter it moved$/);
    // The same wording as an interventions.jsonl without it, and a feed that moved nothing is still a matter (zero).
    expect(() => parseInterventionLog(formatInterventionLine({ ...bare, matter: 0 }).replace(',"matter":0', ""))).toThrow(/a logged feed needs the matter it moved/);
    expect(labHistory({ interventions: [{ ...bare, matter: 0 }] }).scheduled).toEqual([{ ...bare, matter: 0 }]);
    expect(() => labHistory({ interventions: [{ ...bare, matter: null }] })).toThrow(/matter must be an integer/);
  });

  it("refuses a log that is out of step order across the kinds, or has an intervention ahead of a pick of its own step", () => {
    const pick = (step: number) => ({ step, kind: "pick", cycle: step / 1000, donors: [0] });
    // Within each group the order holds; only the whole list is out of order (the lab's queueReplay refuses it too).
    expect(() => labHistory({ interventions: [lesion(2000), pick(1000)] })).toThrow(/interventions\[1\] \(pick at t=1000\) follows an entry at t=2000: a lab log is in one step order/);
    expect(() => labHistory({ interventions: [pick(2000), lesion(1500)] })).toThrow(/interventions\[1\] \(lesion at t=1500\) follows an entry at t=2000/);
    // The lab logs a boundary's pick first, and the headless boundary comes before the interventions of its step.
    expect(() => labHistory({ interventions: [lesion(1000), pick(1000)] })).toThrow(/interventions\[1\] \(pick at t=1000\) follows a lesion or feed at the same step/);
    expect(() => labHistory({ interventions: [{ ...feed(1000), matter: 4 }, lesion(1000), pick(1000)] })).toThrow(/follows a lesion or feed at the same step/);
    // The order the lab logs is fine, and so are a lesion at an earlier step and one at a later step.
    expect(labHistory({ interventions: [lesion(900), pick(1000), lesion(1000), pick(2000), lesion(2000)] }).scheduled).toHaveLength(3);
  });

  it("names a bad pick where it stands in the manifest's own list", () => {
    const bad = { interventions: [lesion(5), lesion(6), { step: -1, kind: "pick", cycle: 1, donors: [0] }] };
    expect(() => labHistory(bad)).toThrow(/interventions\[2\]: step must be a positive integer/);
    expect(() => labHistory({ interventions: [{ step: 2000, kind: "pick", cycle: 2, donors: [1] }, lesion(2100), { step: 1000, kind: "pick", cycle: 1, donors: [0] }] })).toThrow(/in order/);
  });

  describe("pressures", () => {
    const cfg = { pondPeriod: 1000, pondArm: "breed" };
    const pick = (step: number) => ({ step, kind: "pick", cycle: step / 1000, donors: [0] });
    const pressure = (step: number, cycle: number, score = "body") => ({ step, kind: "pressure", cycle, score });
    const hist = (interventions: unknown[], c: unknown = cfg) => labHistory({ cfg: c, interventions });

    it("returns them in log order beside the picks and the schedule, and a manifest without any has none", () => {
      const log = [pressure(0, 1, "drive"), lesion(300), pressure(500, 1, "seed"), pressure(1000, 1, "body"), pick(1000), lesion(1000), pressure(1000, 2, "mass"), pick(2000)];
      const h = hist(log);
      expect(h.pressures).toEqual([
        { step: 0, cycle: 1, score: "drive" },
        { step: 500, cycle: 1, score: "seed" },
        { step: 1000, cycle: 1, score: "body" },
        { step: 1000, cycle: 2, score: "mass" },
      ]);
      expect(h.picks.map((e) => e.step)).toEqual([1000, 2000]);
      expect(h.scheduled).toEqual([lesion(300), lesion(1000)]);
      expect(labHistory({ interventions: [pick(1000)] }).pressures).toEqual([]);
      // no config is needed when there is nothing to check against it
      expect(labHistory({ interventions: [lesion(5)] }).pressures).toEqual([]);
    });

    it("accepts the orders the lab logs at one step", () => {
      expect(() => hist([pressure(1000, 1), pressure(1000, 1, "seed"), pick(1000), lesion(1000), pressure(1000, 2), pressure(1000, 2, "mass")])).not.toThrow();
      expect(() => hist([pick(1000), pressure(1000, 2)])).not.toThrow();
      expect(() => hist([pressure(1000, 2)])).not.toThrow(); // set at the boundary after a rule-run cycle
    });

    it("refuses the orders it does not: a pressure for a cycle after that cycle's pick, a pick after a lesion or a later pressure", () => {
      expect(() => hist([pick(1000), pressure(1000, 1)])).toThrow(/interventions\[1\] \(pressure at t=1000\) for cycle 1 comes after the pick for cycle 1/);
      expect(() => hist([lesion(1000), pressure(1000, 1)])).toThrow(/follows a lesion, feed or later pressure at the same step/);
      expect(() => hist([pressure(1000, 2), pick(1000)])).toThrow(/interventions\[1\] \(pick at t=1000\) follows a pressure for the next cycle at the same step/);
      expect(() => hist([lesion(1000), pick(1000)])).toThrow(/follows a lesion or feed at the same step/);
      expect(() => hist([pressure(2000, 3), lesion(1500)])).toThrow(/follows an entry at t=2000/);
    });

    it("needs the manifest's config, and a breeder world", () => {
      expect(() => labHistory({ interventions: [pressure(0, 1)] })).toThrow(/holds pressures but no cfg/);
      expect(() => hist([pressure(0, 1)], null)).toThrow(/holds pressures but no cfg/);
      expect(() => hist([pressure(0, 1)], { pondPeriod: 1000, pondArm: "scaf" })).toThrow(/pressures: a pressure needs pond arm breed/);
      expect(() => hist([pressure(0, 1)], { pondArm: "breed" })).toThrow(/needs a pond config/);
    });

    it("refuses a pressure that is not the observed history, and a malformed one", () => {
      expect(() => hist([pressure(1500, 1)])).toThrow(/pressure 0 at t=1500 says cycle 1.*not the observed history/);
      expect(() => hist([pressure(1000, 3)])).toThrow(/cycle 1 or 2/);
      expect(() => hist([pressure(1000, 1, "nope")])).toThrow(/pondScore must be/);
      expect(() => hist([{ step: 1000, kind: "pressure", cycle: 1 }])).toThrow(/interventions\[0\]: a pressure needs the key "score"/);
      expect(() => hist([{ ...pressure(1000, 1), by: "x" }])).toThrow(/a pressure has no key "by"/);
    });
  });

  it("leaves picksFromManifest as it was: it still refuses a lesion and a feed", () => {
    expect(() => picksFromManifest({ interventions: [lesion(5)] })).toThrow(/"lesion".*would not be that history/);
    expect(() => picksFromManifest({ interventions: [{ step: 500, kind: "feed", x: 1, y: 1, r: 3, amount: 4, matter: 8 }] })).toThrow(/"feed".*would not be that history/);
    expect(picksFromManifest({ interventions: manifest.interventions.filter((e) => e.kind === "pick") })).toHaveLength(2);
  });
});

describe("run identity and the island", () => {
  const done = (spec: RunSpec): Record<string, unknown> => ({
    spec: JSON.parse(JSON.stringify(spec)),
    cfg: specConfig(spec),
    ruleVersion: RULE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION,
  });
  const wounded: RunSpec = { ...spotsSmall, interventions: [lesion(7), feed(20, 4, { matter: 52 })] };

  it("sameCompletedRun tells a wounded run from a clean one, and one schedule from another", () => {
    expect(sameCompletedRun(done(spotsSmall), spotsSmall)).toBe(true);
    expect(sameCompletedRun(done(wounded), wounded)).toBe(true);
    expect(sameCompletedRun(done(spotsSmall), wounded)).toBe(false);
    expect(sameCompletedRun(done(wounded), spotsSmall)).toBe(false);
    expect(sameCompletedRun(done(wounded), { ...wounded, interventions: [lesion(8), feed(20, 4, { matter: 52 })] })).toBe(false);
    expect(sameCompletedRun(done(wounded), { ...wounded, interventions: [lesion(7)] })).toBe(false);
    // Which radius the log recorded matters as much as the step.
    expect(sameCompletedRun(done(wounded), { ...wounded, interventions: [lesion(7, 3, 4, 3), feed(20, 4, { matter: 52 })] })).toBe(false);
  });

  it("a spec without the field serialises exactly as before, whether the key is absent or undefined", () => {
    const explicit = { ...spotsSmall, interventions: undefined };
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(spotsSmall));
    expect(sameCompletedRun(done(spotsSmall), explicit)).toBe(true);
    expect("interventions" in JSON.parse(JSON.stringify(spotsSmall))).toBe(false);
  });

  it("a spec's pressures are another run, and an island does not run them", () => {
    const pressured: RunSpec = { ...pondSpec, picked: true, pressures: [{ step: 0, cycle: 1, score: "body" }] };
    expect(sameCompletedRun(done({ ...pondSpec, picked: true }), pressured)).toBe(false);
    expect(sameCompletedRun(done(pressured), pressured)).toBe(true);
    expect(specRefusal(pressured)).toMatch(/picked runs are not distributed/);
    expect(specRefusal({ ...pondSpec, pressures: pressured.pressures })).toMatch(/pressured run is not distributed/); // belt and braces over the picked refusal
  });

  it("an island runs a spec with interventions (it advertises interventions-v1), and still refuses a picked or a branch run", () => {
    expect(specRefusal(spotsSmall)).toBeNull();
    expect(specRefusal(wounded)).toBeNull();
    expect(ISLAND_CAPABILITIES).toContain("interventions-v1");
    expect(specRefusal({ ...spotsSmall, picked: true })).toMatch(/picked runs are not distributed/);
    expect(specRefusal({ ...wounded, branch: { source: "x", sourceHash: "0000000000000000", boundary: 1 } })).toMatch(/branches are not distributed/);
  });
});

describe("the intervention log", () => {
  const lines: InterventionLogEntry[] = [
    { step: 7, kind: "lesion", x: 12, y: 9, r: 3 },
    { step: 20, kind: "feed", x: 5, y: 6, r: 2, amount: 5, matter: 65 },
    { step: 40, kind: "feed", x: 1, y: 1, r: 1, amount: -3, matter: -11 },
  ];

  it("writes the lab's intervention of each kind, one line each, keys in a fixed order", () => {
    expect(formatInterventionLine(lines[0])).toBe('{"step":7,"kind":"lesion","x":12,"y":9,"r":3}\n');
    expect(formatInterventionLine(lines[1])).toBe('{"step":20,"kind":"feed","x":5,"y":6,"r":2,"amount":5,"matter":65}\n');
    // The same entry with its keys in another order is the same line.
    expect(formatInterventionLine({ matter: 65, amount: 5, r: 2, y: 6, x: 5, kind: "feed", step: 20 })).toBe(formatInterventionLine(lines[1]));
  });

  it("parses what it writes, and a log replays as a schedule", () => {
    const text = lines.map(formatInterventionLine).join("");
    expect(parseInterventionLog(text)).toEqual(lines);
    expect(parseInterventionLog("")).toEqual([]);
    expect(validateInterventions(parseInterventionLog(text))).toEqual([]);
  });

  it("refuses a line that is not JSON, a malformed entry, a feed without its matter and a decreasing step", () => {
    expect(() => parseInterventionLog('{"step":1\n')).toThrow(/line 1: not JSON/);
    expect(() => parseInterventionLog(formatInterventionLine(lines[0]) + '{"step":2,"kind":"lesion","x":1,"y":1}\n')).toThrow(/interventions\[1\]: a lesion needs the key "r"/);
    expect(() => parseInterventionLog('{"step":2,"kind":"feed","x":1,"y":1,"r":1,"amount":3}\n')).toThrow(/a logged feed needs the matter it moved/);
    expect(() => parseInterventionLog(formatInterventionLine(lines[2]) + formatInterventionLine(lines[0]))).toThrow(/step 7 follows step 40/);
  });
});

describe("applyScheduled on the CPU reference", () => {
  const cfg = specConfig(spotsSmall);
  const fresh = () => initWorld(cfg, spotsPreset.init);
  /** The runner's own step-0 adapter, in miniature: the reference lesion and feed, written in place. */
  const cpu = (state: WorldState): InterventionSim => {
    const ref = new RefSim(state);
    return {
      lesion: (x, y, r) => (applyLesion(ref, x, y, r), clampLesionRadius(state.cfg, r)),
      feed: async (x, y, r, a) => applyFeed(state, x, y, r, a),
    };
  };

  it("logs a lesion with its effective radius and books no matter and no energy", async () => {
    const s = fresh();
    const done = await applyScheduled(cpu(s), lesion(7, 3, 4, 1000));
    expect(done).toEqual({ entry: { step: 7, kind: "lesion", x: 3, y: 4, r: clampLesionRadius(cfg, 1000) }, matter: 0, energy: 0n });
    expect(clampLesionRadius(cfg, 1000)).toBe(15);
  });

  it("logs a feed with the amount asked, the effective radius and the matter moved, and books what it moved", async () => {
    const s = fresh(), twin = cloneState(s);
    const done = await applyScheduled(cpu(s), feed(20, 5, { x: 5, y: 6, r: 2 }));
    const want = applyFeed(twin, 5, 6, 2, 5);
    expect(want.matter).toBe(5 * 13);
    expect(done).toEqual({ entry: { step: 20, kind: "feed", x: 5, y: 6, r: 2, amount: 5, matter: 65 }, matter: 65, energy: BigInt(65) * BigInt(cfg.eA) });
    expect(stateHash(s)).toBe(stateHash(twin));
    // A radius past the tile is clamped in the log too.
    expect((await applyScheduled(cpu(fresh()), feed(20, 1, { r: 1000 }))).entry).toMatchObject({ r: 15, amount: 1 });
  });

  it("books a drain's negative matter, and a drain that finds nothing as zero", async () => {
    const s = fresh();
    const n = cellCount(cfg);
    s.cells.fill(0, CH.A * n, (CH.A + 1) * n);
    const empty = await applyScheduled(cpu(s), feed(3, -4));
    expect([empty.matter, empty.energy]).toEqual([0, 0n]);
    s.cells.fill(10, CH.A * n, (CH.A + 1) * n);
    const drained = await applyScheduled(cpu(s), feed(3, -4, { r: 1 }));
    expect(drained.matter).toBe(-4 * 5);
    expect(drained.entry).toMatchObject({ kind: "feed", amount: -4, matter: -20, r: 1 });
  });

  it("accepts a feed whose matter the log names, and stops on one it does not reproduce", async () => {
    await expect(applyScheduled(cpu(fresh()), feed(20, 5, { matter: 65 }))).resolves.toMatchObject({ matter: 65 });
    const err = await applyScheduled(cpu(fresh()), feed(20, 5, { matter: 64 })).catch((e) => e);
    expect(err).toBeInstanceOf(InterventionError);
    expect(err.name).toBe("InterventionError");
    expect(err.message).toBe("scheduled feed at t=20 moved 65 quanta, the log says 64: this is not the observed history");
    expect(err.step).toBe(20);
  });

  it("checks only the entry's own matter, as validation reads it: an inherited one is neither checked nor serialised", async () => {
    const matterBehind = Object.assign(Object.create({ matter: 64 }), feed(20, 5)) as ScheduledIntervention;
    expect(validateInterventions([matterBehind])).toEqual([]);
    await expect(applyScheduled(cpu(fresh()), matterBehind)).resolves.toMatchObject({ matter: 65 });
  });

  it("turns a feed the simulation refuses into an InterventionError naming the step, with the cause", async () => {
    const refusing: InterventionSim = { lesion: () => 0, feed: async () => { throw new FeedRefusedError("feed refused: too much"); } };
    const err = await applyScheduled(refusing, feed(9)).catch((e) => e);
    expect(err).toBeInstanceOf(InterventionError);
    expect(err.message).toBe("the feed at t=9 failed: feed refused: too much");
    expect((err.cause as Error).message).toBe("feed refused: too much");
    expect(err.step).toBe(9);
    // An error built with no step (not by applyScheduled) has none.
    expect(new InterventionError("x").step).toBeUndefined();
  });

  it("lets any other failure of the feed through as it is: a lost device is the host's, not the schedule's", async () => {
    const lost = new Error("GpuSim destroyed");
    const failing: InterventionSim = { lesion: () => 0, feed: async () => { throw lost; } };
    const err = await applyScheduled(failing, feed(9)).catch((e) => e);
    expect(err).toBe(lost);
    expect(err).not.toBeInstanceOf(InterventionError);
  });

  it("the reference feed refuses with FeedRefusedError, as GpuSim.feed does, for feedError's reasons and past MATTER_MAX", async () => {
    const world = fresh();
    await expect(applyScheduled(cpu(world), { step: 1, kind: "feed", x: 1, y: 1, r: 2, amount: 0 })).rejects.toBeInstanceOf(InterventionError);
    // Fill the world to the bound: the next feed is refused by the bound, not by the shape.
    const n = cellCount(world.cfg);
    world.cells[CH.A * n] = MATTER_MAX - Number(totalsOf(world.cfg, world.cells).matter) + world.cells[CH.A * n];
    const err = await applyScheduled(cpu(world), feed(1, 1)).catch((e) => e);
    expect(err).toBeInstanceOf(InterventionError);
    expect((err.cause as Error).name).toBe("FeedRefusedError");
    expect(err.message).toMatch(/past MATTER_MAX/);
  });
});

describe("runExperiment's guards before the GPU: step-0 entries are applied on the CPU", () => {
  const init = () => initWorld(specConfig(spotsSmall), spotsPreset.init);

  it("stops a step-0 feed that does not reproduce its matter before the device is touched", async () => {
    const wrong: RunSpec = { ...spotsSmall, interventions: [feed(0, 5, { matter: 64 })] };
    const out = memorySink();
    const err = await runExperiment(fakeDevice, wrong, out.sink, host).catch((e) => e);
    expect(err).toBeInstanceOf(InterventionError);
    expect(err.message).toMatch(/scheduled feed at t=0 moved 65 quanta, the log says 64: this is not the observed history/);
    // The error carries step 0, which is how a host knows that no manifest and no interventions.jsonl were written yet.
    expect(err.step).toBe(0);
    expect(out.files.size + out.bytes.size).toBe(0);
    // The right matter goes through to the device.
    expect(await rejection({ ...spotsSmall, interventions: [feed(0, 5, { matter: 65 })] })).toMatch(/^device\.createBuffer is not a function$/);
  });

  it("owns step 0 only in a run that starts there: a continuation never reapplies it", async () => {
    const wrong: RunSpec = { ...spotsSmall, interventions: [feed(0, 5, { matter: 64 })] };
    const start = { ...cloneState(init()), step: 20 };
    const observer = serializeObservers(restoreObservers(undefined, observerSettings(wrong)), 20, observerSettings(wrong));
    expect(await rejection(wrong, { start, observer })).toMatch(/^device\.createBuffer is not a function$/);
  });

  it("never writes to a state it was given", async () => {
    const start = init();
    const before = stateHash(start);
    const spec: RunSpec = { ...spotsSmall, interventions: [lesion(0, 10, 10, 6), feed(0, 5, { matter: 65 })] };
    expect(await rejection(spec, { start })).toMatch(/^device\.createBuffer is not a function$/);
    expect(stateHash(start)).toBe(before);
  });
});

describe("runExperiment's loop", () => {
  const cfg = specConfig(spotsSmall);
  const preset = spotsPreset;
  const W = worldW(cfg);

  /** The cell holding the most bound matter at the start: a lesion there is sure to hit something. */
  function densest(s: WorldState): { x: number; y: number } {
    const n = cellCount(cfg);
    let best = 0;
    for (let i = 1; i < n; i++) if (s.cells[CH.B * n + i] > s.cells[CH.B * n + best]) best = i;
    return { x: best % W, y: Math.floor(best / W) };
  }
  const start = initWorld(cfg, preset.init);
  const hit = densest(start);

  // A lesion at step 7 and a drain at step 33 (inside a census chunk, off the census grid), a feed at the census step 20 and
  // a lesion at the last step, which is a census step too.
  const schedule: ScheduledIntervention[] = [lesion(7, hit.x, hit.y, 3), feed(20, 5, { x: 5, y: 6, r: 2, matter: 65 }), feed(33, -3, { x: 20, y: 20, r: 1 }), lesion(40, 12, 12, 2)];
  const spec: RunSpec = { ...spotsSmall, checkpointEvery: 20, interventions: schedule };

  /** The same history on the reference alone, with the hash and the drained amount at each checkpoint. */
  function replay() {
    const ref = new RefSim(cloneState(start));
    ref.run(7);
    const heat = ref.state.heatOut;
    applyLesion(ref, hit.x, hit.y, 3);
    expect(ref.state.heatOut).toBeGreaterThan(heat);
    ref.run(13);
    const f1 = applyFeed(ref.state, 5, 6, 2, 5);
    const at20 = stateHash(ref.state);
    ref.run(13);
    const f2 = applyFeed(ref.state, 20, 20, 1, -3);
    ref.run(7);
    applyLesion(ref, 12, 12, 2);
    return { at20, at40: stateHash(ref.state), drained: f2.matter, fed: f1.matter };
  }

  it("lands each entry at its step: split inside a chunk, after the census and boundary at its end, before the checkpoint", async () => {
    const out = memorySink();
    const res = await runExperiment(device, spec, out.sink, host, () => {}, { keepFinal: true });
    const want = replay();
    expect(want.fed).toBe(65);
    expect(want.drained).toBeLessThan(0);

    // The calls, in order: the lesion splits chunk one at step 7; the feed at step 20 comes after that census's readbacks
    // and makes the checkpoint read the state afresh; the drain splits chunk two at step 33; the lesion at the last step
    // comes after its census, then the checkpoint's fresh read and the final read.
    expect(lastSim().calls).toEqual([
      "run 7", `lesion ${hit.x},${hit.y},3`, "run 13", "drain", "snapshot", "stats", "feed 5,6,2,5", "readState",
      "run 13", "feed 20,20,1,-3", "run 7", "drain", "snapshot", "stats", "lesion 12,12,2", "readState", "readState",
    ]);

    // The checkpoints carry the post-intervention state, equal to the reference history's.
    const manifest = JSON.parse(out.files.get("manifest.json")!);
    expect(manifest.checkpoints.map((c: { step: number; hash: string }) => [c.step, c.hash])).toEqual([[20, want.at20], [40, want.at40]]);
    expect(stateHash(res.final!)).toBe(want.at40);

    // The log: what was applied, with the effective radius and the matter moved.
    const log = parseInterventionLog(out.files.get(INTERVENTIONS_FILE)!);
    expect(log).toEqual([
      { step: 7, kind: "lesion", x: hit.x, y: hit.y, r: 3 },
      { step: 20, kind: "feed", x: 5, y: 6, r: 2, amount: 5, matter: 65 },
      { step: 33, kind: "feed", x: 20, y: 20, r: 1, amount: -3, matter: want.drained },
      { step: 40, kind: "lesion", x: 12, y: 12, r: 2 },
    ]);
    expect(manifest.interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 4 });
    expect(manifest.spec.interventions).toEqual(schedule);
    expect(manifest.initHash).toBe(stateHash(start));

    // The observer books every feed, in the checkpoint it travels with as well as the result.
    expect(res.observer.fed).toEqual({ matter: 65 + want.drained, feeds: 2 });
    expect(decodeArtifact(out.bytes.get("checkpoints/t000000020.blck")!).observer.fed).toEqual({ matter: 65, feeds: 1 });
    expect(decodeArtifact(out.bytes.get("checkpoints/t000000040.blck")!).observer.fed).toEqual({ matter: 65 + want.drained, feeds: 2 });

    // The baselines moved with the feeds, so conservation held at every census, exactly.
    expect(res.summary.conservationOk).toBe(true);
    const series = out.files.get("series.jsonl")!.trim().split("\n").map((l) => JSON.parse(l));
    expect(series.map((r) => [r.step, r.conservationOk])).toEqual([[20, true], [40, true]]);
  });

  it("a continuation from a checkpoint applies only what is left and ends where the continuous run does", async () => {
    const whole = await runExperiment(device, spec, memorySink().sink, host);
    const first = memorySink();
    await runExperiment(device, { ...spec, steps: 20 }, first.sink, host);
    // The first segment owns the lesion and the feed at 20, and left the drain and the last lesion to the next.
    expect(parseInterventionLog(first.files.get(INTERVENTIONS_FILE)!).map((e) => e.step)).toEqual([7, 20]);
    expect(JSON.parse(first.files.get("manifest.json")!).interventions.applied).toBe(2);
    const { state, observer } = decodeArtifact(first.bytes.get("checkpoints/t000000020.blck")!);
    const rest = memorySink();
    const second = await runExperiment(device, { ...spec, steps: 20 }, rest.sink, host, () => {}, { start: state, observer: observer as ObserverState });
    expect(parseInterventionLog(rest.files.get(INTERVENTIONS_FILE)!).map((e) => e.step)).toEqual([33, 40]);
    expect(lastSim().calls).toEqual(["run 13", "feed 20,20,1,-3", "run 7", "drain", "snapshot", "stats", "lesion 12,12,2", "readState", "readState"]);
    expect(second.summary.finalHash).toBe(whole.summary.finalHash);
    expect(second.observer.fed).toEqual(whole.observer.fed);
    expect(second.summary.conservationOk).toBe(true);
  });

  it("splits a long chunk into batches of at most 64 steps on both sides of an entry", async () => {
    const long: RunSpec = { ...spotsSmall, steps: 70, censusEvery: 70, interventions: [lesion(66, hit.x, hit.y, 2)] };
    await runExperiment(device, long, memorySink().sink, host);
    expect(lastSim().calls).toEqual(["run 64", "run 2", `lesion ${hit.x},${hit.y},2`, "run 4", "drain", "snapshot", "stats", "readState"]);
  });

  it("applies several entries at one step in list order, and the lesion's effective radius is what is logged", async () => {
    const out = memorySink();
    const many: RunSpec = { ...spotsSmall, steps: 20, interventions: [feed(20, 2, { matter: 26 }), lesion(20, hit.x, hit.y, 1000), feed(20, 1)] };
    const res = await runExperiment(device, many, out.sink, host);
    expect(lastSim().calls.filter((c) => /^(feed|lesion)/.test(c))).toEqual(["feed 5,6,2,2", `lesion ${hit.x},${hit.y},1000`, "feed 5,6,2,1"]);
    expect(parseInterventionLog(out.files.get(INTERVENTIONS_FILE)!).map((e) => [e.kind, e.r])).toEqual([["feed", 2], ["lesion", clampLesionRadius(cfg, 1000)], ["feed", 2]]);
    expect(res.observer.fed).toEqual({ matter: 26 + 13, feeds: 2 });
    expect(res.summary.conservationOk).toBe(true);
  });

  it("applies step 0 to the starting world: the simulation is created from it, the log leads, initHash stays the preset's", async () => {
    const out = memorySink();
    // The lesion's radius is far past the world's largest: the step-0 adapter must log the effective one, as the lab does.
    const zero: RunSpec = { ...spotsSmall, steps: 20, interventions: [lesion(0, hit.x, hit.y, 1000), feed(0, 2, { matter: 26 })] };
    const res = await runExperiment(device, zero, out.sink, host);
    // The world the simulation began from is the start with both applied, in order.
    const twin = cloneState(start);
    applyLesion(new RefSim(twin), hit.x, hit.y, 1000);
    applyFeed(twin, 5, 6, 2, 2);
    expect(stateHash(lastSim().initial)).toBe(stateHash(twin));
    expect(JSON.parse(out.files.get("manifest.json")!).initHash).toBe(stateHash(start));
    expect(parseInterventionLog(out.files.get(INTERVENTIONS_FILE)!)).toEqual([
      { step: 0, kind: "lesion", x: hit.x, y: hit.y, r: clampLesionRadius(cfg, 1000) },
      { step: 0, kind: "feed", x: 5, y: 6, r: 2, amount: 2, matter: 26 },
    ]);
    expect(clampLesionRadius(cfg, 1000)).toBeLessThan(1000);
    expect(JSON.parse(out.files.get("manifest.json")!).interventions.applied).toBe(2);
    // The baselines were taken from the post-intervention world: no residual from the feed, and it is booked as fed.
    expect(res.summary.conservationOk).toBe(true);
    expect(res.observer.fed).toEqual({ matter: 26, feeds: 1 });
    // Nothing of the schedule is applied twice by the loop.
    expect(lastSim().calls.filter((c) => /^(feed|lesion)/.test(c))).toEqual([]);
  });

  it("stops at a feed that does not reproduce its matter, with what came before it logged and what follows not", async () => {
    const out = memorySink();
    const wrong: RunSpec = { ...spotsSmall, steps: 20, interventions: [lesion(7, hit.x, hit.y, 3), feed(20, 5, { matter: 64 }), lesion(20)] };
    const err = await runExperiment(device, wrong, out.sink, host).catch((e) => e);
    expect(err).toBeInstanceOf(InterventionError);
    expect(err.message).toBe("scheduled feed at t=20 moved 65 quanta, the log says 64: this is not the observed history");
    expect(parseInterventionLog(out.files.get(INTERVENTIONS_FILE)!).map((e) => e.kind)).toEqual(["lesion"]);
    expect(lastSim().calls.filter((c) => c.startsWith("lesion"))).toHaveLength(1);
    // The loop's failure is not a step-0 failure: files exist, and the error says which step it was.
    expect(err.step).toBe(20);
  });

  it("the manifest of a run that stops early counts the step-0 entries already in its log", async () => {
    const out = memorySink();
    const wrong: RunSpec = { ...spotsSmall, steps: 20, interventions: [lesion(0, hit.x, hit.y, 3), feed(20, 5, { matter: 64 })] };
    await expect(runExperiment(device, wrong, out.sink, host)).rejects.toBeInstanceOf(InterventionError);
    const m = JSON.parse(out.files.get("manifest.json")!);
    // The manifest is written at the start and again at the end; a stopped run keeps the first, which saw the step-0 lesion.
    expect(m.summary).toBeNull();
    expect(m.interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 1 });
    expect(out.files.get(INTERVENTIONS_FILE)).toBe(formatInterventionLine({ step: 0, kind: "lesion", x: hit.x, y: hit.y, r: 3 }));
  });

  it("in a pond world a lesion comes after the cycle at its step, and the checkpoint reads the wounded world afresh", async () => {
    const out = memorySink();
    const wounded: RunSpec = { ...pondTiny, interventions: [lesion(0, 50, 50, 10), lesion(2, 32, 32, 31), lesion(2, 96, 96, 31), lesion(3, 32, 32, 5)] };
    const res = await runExperiment(device, wounded, out.sink, host);
    // Step 2 is the first pond boundary: the census, then the cycle (a read and an upload), then the two lesions, then the
    // checkpoint's own read. Step 3 splits the second chunk. Step 4's cycle is not followed by an entry, so its checkpoint
    // reuses the cycle's read as it always did. (The step-0 lesion was applied before the simulation existed.)
    expect(lastSim().calls).toEqual([
      "run 2", "drain", "snapshot", "stats", "readState", "upload", "lesion 32,32,31", "lesion 96,96,31", "readState",
      "run 1", "lesion 32,32,5", "run 1", "drain", "snapshot", "stats", "readState", "upload", "readState",
    ]);
    const [cycle1, cycle2] = lastSim().uploads;
    const twin = cloneState(cycle1);
    const ref = new RefSim(twin);
    applyLesion(ref, 32, 32, 31);
    applyLesion(ref, 96, 96, 31);
    const cps = JSON.parse(out.files.get("manifest.json")!).checkpoints.map((c: { step: number; hash: string }) => [c.step, c.hash]);
    // The checkpoint at 2 is the cycle's world with both lesions, not the cycle's world.
    expect(stateHash(twin)).not.toBe(stateHash(cycle1));
    expect(cps).toEqual([[2, stateHash(twin)], [4, stateHash(cycle2)]]);
    expect(parseInterventionLog(out.files.get(INTERVENTIONS_FILE)!).map((e) => e.step)).toEqual([0, 2, 2, 3]);
    // The pond cycle at step 4 checks matter and the ledger exactly against the start, wounds included.
    expect(res.summary.conservationOk).toBe(true);
    expect(res.observer.ponds).toEqual({ lastCycle: 2 });
  });

  it("a spec without a schedule makes the calls it always made and writes no trace of the field", async () => {
    const out = memorySink();
    const clean: RunSpec = { ...spotsSmall, checkpointEvery: 20 };
    await runExperiment(device, clean, out.sink, host);
    expect(lastSim().calls).toEqual(["run 20", "drain", "snapshot", "stats", "readState", "run 20", "drain", "snapshot", "stats", "readState", "readState"]);
    expect(out.files.has(INTERVENTIONS_FILE)).toBe(false);
    expect("interventions" in JSON.parse(out.files.get("manifest.json")!)).toBe(false);
    expect("interventions" in JSON.parse(out.files.get("manifest.json")!).spec).toBe(false);
  });

  it("entries outside the run's window are not applied and not an error", async () => {
    const out = memorySink();
    const outside: RunSpec = { ...spotsSmall, steps: 20, interventions: [lesion(5000), lesion(5001)] };
    const res = await runExperiment(device, outside, out.sink, host);
    expect(lastSim().calls.filter((c) => c.startsWith("lesion"))).toEqual([]);
    expect(out.files.get(INTERVENTIONS_FILE)).toBe("");
    expect(JSON.parse(out.files.get("manifest.json")!).interventions).toEqual({ file: INTERVENTIONS_FILE, applied: 0 });
    expect(res.summary.conservationOk).toBe(true);
    expect(totalsOf(cfg, lastSim().initial.cells).matter).toBe(totalsOf(cfg, start.cells).matter);
  });
});

describe("a pressured run through runExperiment", () => {
  // Seed 2 of four 64 x 64 ponds, two cycles of two steps: after two steps "mass" favours pond 3 and "body" pond 2, so a pressure is not vacuous.
  const base: RunSpec = { ...pondTiny, seed: 2, condition: "pond-breed-mass", steps: 4, checkpointEvery: 0 };
  const pressures: PressureEntry[] = [{ step: 0, cycle: 1, score: "body" }];
  const preset = PRESETS.find((p) => p.id === "ponds-small")!;
  const cfg = specConfig(base);

  /** The same history on the reference alone: each boundary is `applyPondCycle` with the donors `scoreAt(b)` ranks, or the arm's own. */
  function reference(scoreAt: (b: number) => PressureEntry["score"] | undefined) {
    let ref = new RefSim(initWorld(cfg, preset.init));
    const donors: number[][] = [];
    for (let b = 1; b <= 2; b++) {
      ref.run(2);
      const pre = cloneState(ref.state);
      const score = scoreAt(b);
      const picks = score === undefined ? undefined : pondDonors(pre, b, "breed", cfg.pondK!, score);
      const cycle = applyPondCycle(pre, b, "breed", cfg.pondK!, pondMatter(pre), pondCensus, cfg.pondScore, picks);
      donors.push(cycle.donors);
      ref = new RefSim(cloneState(cycle.state));
    }
    return { hash: stateHash(ref.state), donors };
  }

  it("takes each boundary's donors from the pressure's score: the state is the cycle with those donors, the files are the config's", async () => {
    const want = reference(() => "body");
    const plain = reference(() => undefined);
    expect(want.donors[0]).not.toEqual(plain.donors[0]); // the pressure changes the first cycle
    const out = memorySink();
    const res = await runExperiment(device, { ...base, picked: true, pressures }, out.sink, host, () => {}, { keepFinal: true, picks: [], implicitRule: true });
    expect(stateHash(res.final!)).toBe(want.hash);
    const manifest = JSON.parse(out.files.get("manifest.json")!);
    expect(manifest.spec.pressures).toEqual(pressures);
    // ponds.tsv: the config's header (its score columns are the config's score), a row per recipient at each boundary, donors as applied
    const rows = out.files.get("ponds.tsv")!.trim().split("\n");
    expect(rows[0] + "\n").toBe(pondsHeader("breed", "mass"));
    const cols = rows[0].split("\t"), at = (r: string, c: string) => r.split("\t")[cols.indexOf(c)];
    for (const b of [1, 2]) expect([...new Set(rows.slice(1).filter((r) => at(r, "cycle") === String(b)).map((r) => Number(at(r, "donor"))))].sort()).toEqual([...want.donors[b - 1]].sort());
    // picks.jsonl: the pressured rule's donors are what was applied and what the rule suggested
    const picks = out.files.get("picks.jsonl")!.trim().split("\n").map((l) => JSON.parse(l));
    expect(picks.map((l) => [l.step, l.cycle, l.donors, l.by, l.suggested])).toEqual([
      [2, 1, want.donors[0], "rule(implicit)", want.donors[0]],
      [4, 2, want.donors[1], "rule(implicit)", want.donors[1]],
    ]);
  }, 600_000);

  it("a pressure that starts later leaves the earlier cycles to the config's score", async () => {
    const want = reference((b) => (b >= 2 ? "body" : undefined));
    const res = await runExperiment(device, { ...base, picked: true, pressures: [{ step: 2, cycle: 2, score: "body" }] }, memorySink().sink, host, () => {}, { keepFinal: true, picks: [], implicitRule: true });
    expect(stateHash(res.final!)).toBe(want.hash);
  }, 600_000);

  it("a run without pressure is unchanged: the arm's own cycle, no picks file, no trace of the field", async () => {
    const want = reference(() => undefined);
    const out = memorySink();
    const res = await runExperiment(device, base, out.sink, host, () => {}, { keepFinal: true });
    expect(stateHash(res.final!)).toBe(want.hash);
    expect(out.files.has("picks.jsonl")).toBe(false);
    expect("pressures" in JSON.parse(out.files.get("manifest.json")!).spec).toBe(false);
    // a picked run with the rule's own donors writes the same ponds.tsv bytes and state
    const picked = memorySink();
    const res2 = await runExperiment(device, { ...base, picked: true }, picked.sink, host, () => {}, { keepFinal: true, picks: [], implicitRule: true });
    expect(stateHash(res2.final!)).toBe(want.hash);
    expect(picked.files.get("ponds.tsv")).toBe(out.files.get("ponds.tsv"));
  }, 600_000);

  it("refuses, before the device is touched, what is not a pressured breeder run", async () => {
    const opts = { picks: [], implicitRule: true };
    expect(await rejection({ ...base, pressures }, opts)).toMatch(/a pressured run is a picked run/);
    expect(await rejection({ ...base, picked: true, pressures: [{ step: 3, cycle: 3, score: "body" }] }, opts)).toMatch(/pressure 0 at t=3 says cycle 3.*not the observed history/);
    expect(await rejection({ ...base, condition: "pond-rand", picked: true, pressures }, opts)).toMatch(/pressure needs pond arm breed, got "rand"/);
    expect(await rejection({ ...base, picked: true, pressures: [{ step: 5, cycle: 3, score: "body" }] }, opts)).toMatch(/a pressure at t=5 is after the run's last step \(4\)/);
    expect(await rejection({ ...base, picked: true, pressures: [{ step: 4, cycle: 3, score: "nope" as never }] }, opts)).toMatch(/pondScore must be/);
  });
});
