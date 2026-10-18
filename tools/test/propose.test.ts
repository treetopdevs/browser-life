// The experiment proposer's pure core (tools/lib/propose.ts) against the rules fixed in docs/naturalist-proposer-v0-2026-10-18.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEED_MAX, defaultConfig, maxLesionRadius, type WorldConfig } from "@bl/schema";
import { interventionsError, specConfig, validateInterventions, validateSpec, type RunSpec, type ScheduledIntervention } from "@bl/runner";
import { SIGNALS } from "../lib/bell.ts";
import { fmtValue, fmtZ, group } from "../lib/notebook.ts";
import {
  RULES,
  RULES_V0,
  approve,
  bindNotesToManifest,
  bodySha256,
  buildForkSpec,
  canonical,
  cadenceError,
  discCells,
  forkPoint,
  jarDisc,
  jarShare,
  parseNotes,
  parseProposal,
  predictionHolds,
  proposalId,
  proposeFromNotes,
  randomBaseline,
  ruleFor,
  runArgv,
  runRefusal,
  serializeProposal,
  sourceRefusal,
  validateProposal,
  validateProposalSpec,
  isPersonName,
  type ForkCheck,
  type Proposal,
  type ProposeInput,
  type SignalTrack,
  type SourceManifest,
} from "../lib/propose.ts";
import { notesJson, sourceManifest, type RingOpts } from "./propose-fixture.ts";

const SIZES = { "manifest.json": 1000, "series.jsonl": 2000, "lineages.tsv": 3000 };

function input(m: SourceManifest, rings: RingOpts[], o: { falseAlarm?: "held-out" | "neutral" | null; forkFor?: (S: number) => ForkCheck } = {}): ProposeInput {
  const notes = parseNotes(notesJson(m, rings, { falseAlarm: o.falseAlarm }));
  return {
    notes,
    notesRef: { path: "notes.json", sha256: "a".repeat(64) },
    manifest: m,
    source: { dir: "/data/runs/replay-x/archipelago/neutral/seed-1", manifestSha256: "b".repeat(64) },
    forkFor: o.forkFor ?? ((S) => {
      const C = forkPoint(S, m.checkpoints ?? []);
      return C === 0 ? { step: 0, check: "initHash", hash: m.initHash! } : { step: C, check: "checkpoint", hash: m.checkpoints!.find((c) => c.step === C)!.hash, file: m.checkpoints!.find((c) => c.step === C)!.file };
    }),
  };
}
const one = (m: SourceManifest, ring: RingOpts, o: Parameters<typeof input>[2] = {}): Proposal => {
  const r = proposeFromNotes(input(m, [ring], o));
  expect(r.proposals).toHaveLength(1);
  return r.proposals[0];
};

/**
 * tools/run.ts's mapping from argv to a RunSpec, reimplemented here (its flags as parseArgs reads them: --lesion and --feed
 * collected, merged lesions then feeds and stable-sorted by step; the spec keys in its order). Proves runArgv against this copy
 * only; the spawned refusals and validators carry the rest.
 */
function specFromArgv(argv: string[]): { spec: RunSpec; startFrom?: string; startStep?: number } {
  expect(argv.slice(0, 4)).toEqual(["deno", "run", "-A", "tools/run.ts"]);
  const flags: Record<string, string> = {};
  const lesions: string[] = [], feeds: string[] = [];
  for (let i = 4; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ""), v = argv[i + 1];
    if (k === "lesion") lesions.push(v);
    else if (k === "feed") feeds.push(v);
    else {
      expect(flags[k], `--${k} given twice`).toBeUndefined();
      flags[k] = v;
    }
  }
  const list: ScheduledIntervention[] = [];
  for (const v of lesions) {
    const m = /^(\d+):(\d+),(\d+),(\d+)$/.exec(v)!;
    list.push({ step: Number(m[1]), kind: "lesion", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]) });
  }
  for (const v of feeds) {
    const m = /^(\d+):(\d+),(\d+),(\d+),([+-]?\d+)$/.exec(v)!;
    list.push({ step: Number(m[1]), kind: "feed", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]), amount: Number(m[5]) });
  }
  list.sort((p, q) => p.step - q.step);
  const overrides = flags.override ? Object.fromEntries(flags.override.split(",").map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])])) : undefined;
  const spec: RunSpec = {
    experiment: flags.experiment,
    presetId: flags.preset,
    condition: flags.conditions,
    seed: Number(flags.seeds),
    steps: Number(flags.steps),
    censusEvery: Number(flags.census),
    deepEvery: Number(flags.deep),
    checkpointEvery: Number(flags.checkpoint),
    ...(flags.threshold ? { activityThreshold: Number(flags.threshold) } : {}),
    ...(overrides ? { overrides } : {}),
    ...(list.length ? { interventions: list } : {}),
  };
  return { spec, startFrom: flags["start-from"], startStep: flags["start-step"] ? Number(flags["start-step"]) : undefined };
}

describe("format", () => {
  const m = sourceManifest();
  const p = one(m, { signal: "livingCells", side: "low", startStep: 15_000 });

  it("round-trips byte for byte", () => {
    const text = serializeProposal(p);
    expect(serializeProposal(parseProposal(text))).toBe(text);
    const approved = approve(p, "Nicholas Zographos", "2026-10-18T00:00:00.000Z");
    expect(serializeProposal(parseProposal(serializeProposal(approved)))).toBe(serializeProposal(approved));
  });

  it("identity is the body's: stable under key order, changed by any body edit, blind to status and approval", () => {
    const shuffled = JSON.parse(JSON.stringify(p.body), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(Object.keys(shuffled)[0]).not.toBe(Object.keys(p.body)[0]);
    expect(bodySha256(shuffled)).toBe(bodySha256(p.body));
    expect(p.id).toBe(bodySha256(p.body).slice(0, 16));
    expect(proposalId({ ...p.body, reason: p.body.reason + " " })).not.toBe(p.id);
    expect(proposalId({ ...p.body, spec: { ...p.body.spec, steps: p.body.spec.steps + 100 } })).not.toBe(p.id);
    const approved = approve(p, "Nicholas Zographos", "2026-10-18T00:00:00.000Z");
    expect(approved.id).toBe(p.id);
    expect(parseProposal(serializeProposal(approved)).id).toBe(p.id);
  });

  it("refuses a file whose id is not its body's, an unknown key, a bad status", () => {
    const o = JSON.parse(serializeProposal(p));
    expect(() => parseProposal(JSON.stringify({ ...o, id: "0".repeat(16) }))).toThrow(/not its body's/);
    expect(() => parseProposal(JSON.stringify({ ...o, extra: 1 }))).toThrow(/unknown key/);
    expect(() => parseProposal(JSON.stringify({ ...o, status: "run" }))).toThrow(/status/);
    o.body.spec.steps += 1;
    expect(() => parseProposal(JSON.stringify(o))).toThrow(/body was edited/);
  });

  it("canonical JSON sorts keys and refuses non-finite numbers", () => {
    expect(canonical({ b: 1, a: [2, { d: 0.5, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":0.5}],"b":1}');
    expect(() => canonical({ a: Infinity })).toThrow(/finite/);
    expect(() => canonical({ a: undefined })).toThrow(/undefined/);
  });
});

describe("parseNotes refusals", () => {
  const m = sourceManifest();
  const ring = { signal: "livingCells", side: "high" as const, startStep: 15_000 };
  const bad = (mutate: (n: Record<string, any>) => void) => () => parseNotes(notesJson(m, [ring], { mutate }));

  it("reads a good file in filing order", () => {
    const n = parseNotes(notesJson(m, [ring, { signal: "maxGeneration", side: "high", startStep: 16_000 }]));
    expect(n.rings.map((r) => r.signal)).toEqual(["livingCells", "maxGeneration"]);
    expect(n.rings[0].receipt.endStep).toBe(15_000 + 4900);
  });
  it("wrong version", () => {
    expect(bad((n) => (n.notebookVersion = 1))).toThrow(/notebookVersion/);
    expect(bad((n) => (n.bellVersion = 9))).toThrow(/bellVersion/);
  });
  it("receipt signal or side not the note's", () => {
    expect(bad((n) => (n.entries[0].notes[0].receipt.signal = "individuals"))).toThrow(/receipt\.signal/);
    expect(bad((n) => (n.entries[0].notes[0].receipt.side = "low"))).toThrow(/receipt\.side/);
  });
  it("window not 49 censuses long", () => {
    expect(bad((n) => (n.entries[0].notes[0].receipt.endStep += 100))).toThrow(/receipt window/);
  });
  it("minAbsZ not beyond Z*", () => {
    expect(bad((n) => (n.entries[0].notes[0].receipt.minAbsZ = 7))).toThrow(/minAbsZ/);
  });
  it("unknown signal", () => {
    expect(bad((n) => {
      n.entries[0].notes[0].signal = "joy";
      n.entries[0].notes[0].receipt.signal = "joy";
    })).toThrow(/signal "joy"/);
  });
  it("a ring count that is not the entries'", () => {
    expect(bad((n) => (n.rings = 2))).toThrow(/rings says/);
  });
  it("a receipt off the census grid or before the burn-in", () => {
    expect(bad((n) => {
      n.entries[0].notes[0].receipt.startStep += 50;
      n.entries[0].notes[0].receipt.endStep += 50;
    })).toThrow(/census step/);
    expect(() => parseNotes(notesJson(m, [{ ...ring, startStep: 5000 }]))).toThrow(/burn-in/);
  });
});

describe("binding the notes to the bundle", () => {
  const m = sourceManifest();
  const notes = parseNotes(notesJson(m, [{ signal: "livingCells", side: "high", startStep: 15_000 }]));
  it("accepts its own bundle", () => expect(() => bindNotesToManifest(notes, m, SIZES)).not.toThrow());
  it("refuses another run id, presetIdentity or file size", () => {
    expect(() => bindNotesToManifest(notes, sourceManifest({ seed: 2 }), SIZES)).toThrow(/run id/);
    expect(() => bindNotesToManifest(notes, { ...m, presetIdentity: "ffffffffffffffff" }, SIZES)).toThrow(/presetIdentity/);
    expect(() => bindNotesToManifest(notes, m, { ...SIZES, "series.jsonl": 2001 })).toThrow(/series\.jsonl size/);
  });
});

describe("rules table", () => {
  it("has the note's 26 rows: 7 feeds, 7 drains, 4 lesions, 8 controls, every direction opposite the ring", () => {
    expect(Object.keys(RULES)).toEqual(SIGNALS.map((s) => s.name));
    const rows = SIGNALS.flatMap((s) => (["high", "low"] as const).map((side) => ({ side, ...ruleFor(s.name, side) })));
    expect(rows).toHaveLength(26);
    const count = (a: string) => rows.filter((r) => r.action === a).length;
    expect([count("feed"), count("drain"), count("lesion"), count("control")]).toEqual([7, 7, 4, 8]);
    for (const r of rows) {
      if (r.action === "control") expect(r.direction).toBeUndefined();
      else expect(r.direction).toBe(r.side === "high" ? "down" : "up");
    }
    // The note's table, row by row.
    const note: Record<string, [string, string]> = {
      livingCells: ["drain", "feed"], individuals: ["drain", "feed"], meanMass: ["drain", "feed"], lineages: ["lesion", "control"],
      lineageShannon: ["lesion", "control"], patternEntropy: ["control", "control"], bioticRecycling: ["control", "control"],
      maxGeneration: ["lesion", "control"], dominantShare: ["lesion", "control"], fissions: ["drain", "feed"], fusions: ["drain", "feed"],
      buddings: ["drain", "feed"], mutations: ["drain", "feed"],
    };
    for (const [s, [hi, lo]] of Object.entries(note)) expect([ruleFor(s, "high").action, ruleFor(s, "low").action]).toEqual([hi, lo]);
  });
  it("the jar disc: one centre per tile, row-major, radius maxLesionRadius", () => {
    const big = { ...defaultConfig(), tileW: 256, tileH: 256, tilesX: 1, tilesY: 1 } as WorldConfig;
    expect(jarDisc(big)).toEqual([{ x: 128, y: 128, r: 127 }]);
    const two = { ...defaultConfig(), tileW: 64, tileH: 64, tilesX: 2, tilesY: 1 } as WorldConfig;
    expect(jarDisc(two)).toEqual([{ x: 32, y: 32, r: 31 }, { x: 96, y: 32, r: 31 }]);
  });
  it("a drain and a feed move ±init.nutrient (32) per cell on every tile", () => {
    const m = sourceManifest({ presetId: "gradient-m3" });
    const hi = one(m, { signal: "livingCells", side: "high", startStep: 15_000 });
    expect(hi.body.spec.interventions).toEqual([{ step: 19_900, kind: "feed", x: 128, y: 128, r: 127, amount: -32 }]);
    const lo = one(m, { signal: "livingCells", side: "low", startStep: 15_000 });
    expect(lo.body.spec.interventions![0]).toMatchObject({ kind: "feed", amount: 32 });
    const arch = one(sourceManifest(), { signal: "maxGeneration", side: "high", startStep: 15_000 });
    expect(arch.body.spec.interventions).toEqual([
      { step: 19_900, kind: "lesion", x: 32, y: 32, r: 31 },
      { step: 19_900, kind: "lesion", x: 96, y: 32, r: 31 },
      { step: 19_900, kind: "lesion", x: 32, y: 96, r: 31 },
      { step: 19_900, kind: "lesion", x: 96, y: 96, r: 31 },
    ]);
  });
});

describe("fork point", () => {
  it("the largest checkpoint strictly before S, else 0", () => {
    const cps = [{ step: 100_000 }, { step: 200_000 }];
    expect(forkPoint(150_000, cps)).toBe(100_000);
    expect(forkPoint(100_000, cps)).toBe(0);
    expect(forkPoint(250_000, cps)).toBe(200_000);
    expect(forkPoint(250_000, [])).toBe(0);
    expect(forkPoint(250_000, cps, (t) => t !== 200_000)).toBe(100_000); // a checkpoint that fails its check does not count
  });
  it("a fork from a checkpoint starts there and runs S − C + H", () => {
    const m = sourceManifest({ checkpointEvery: 10_000 });
    const p = one(m, { signal: "livingCells", side: "high", startStep: 15_000 });
    expect(p.body.fork).toMatchObject({ step: 10_000, check: "checkpoint" });
    expect(p.body.interventionStep).toBe(19_900);
    expect(p.body.spec.steps).toBe(19_900 - 10_000 + 20_000);
    expect(p.body.argv).toContain("--start-from");
  });
  it("skips a ring whose S + H is past the source's end", () => {
    const m = sourceManifest({ steps: 30_000 });
    const r = proposeFromNotes(input(m, [{ signal: "livingCells", side: "high", startStep: 15_000 }]));
    expect(r.proposals).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/past the source's last step 30000/);
  });
});

describe("spec", () => {
  const m = sourceManifest({ extraSpec: { activityThreshold: 2.5, overrides: { mutRate: 0 } } });
  const ps = proposeFromNotes(input(m, [
    { signal: "livingCells", side: "low", startStep: 15_000 },
    { signal: "patternEntropy", side: "high", startStep: 15_100 },
    { signal: "maxGeneration", side: "high", startStep: 15_200 },
  ])).proposals;

  it("copies the source's settings, drops lineageObs and checkpoints, and passes every validator", () => {
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      const s = p.body.spec;
      expect(s).toMatchObject({ experiment: "naturalist-fork", presetId: "archipelago", condition: "neutral", seed: 1, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, activityThreshold: 2.5, overrides: { mutRate: 0 } });
      expect(s.lineageObs).toBeUndefined();
      expect(s.steps).toBe(p.body.interventionStep - p.body.fork.step + 20_000);
      expect(validateSpec(s)).toEqual([]);
      if (s.interventions) expect(validateInterventions(s.interventions)).toEqual([]);
      expect(interventionsError(s, specConfig(s), 0)).toBeNull();
      expect(validateProposalSpec(s, p.body.fork.step, m)).toBeNull();
    }
  });
  it("a replay control has no interventions key and a replay prediction", () => {
    const control = ps.find((p) => p.body.rule.action === "control")!;
    expect("interventions" in control.body.spec).toBe(false);
    expect(control.body.prediction).toMatchObject({ kind: "replay", fromStep: 100, toStep: control.body.spec.steps });
    expect(control.body.argv.some((x) => x === "--lesion" || x === "--feed")).toBe(false);
  });
  it("the argv maps back, as tools/run.ts reads it, to the same spec", () => {
    for (const p of ps) {
      const back = specFromArgv(p.body.argv);
      expect(canonical(back.spec)).toBe(canonical(p.body.spec));
      expect(back.startStep).toBe(p.body.fork.step > 0 ? p.body.fork.step : undefined);
    }
    const ck = proposeFromNotes(input(sourceManifest({ checkpointEvery: 10_000 }), [{ signal: "fissions", side: "high", startStep: 15_000 }])).proposals[0];
    const back = specFromArgv(ck.body.argv);
    expect(canonical(back.spec)).toBe(canonical(ck.body.spec));
    expect(back).toMatchObject({ startFrom: "/data/runs/replay-x/archipelago/neutral/seed-1", startStep: 10_000 });
  });
});

describe("reason", () => {
  it("cites only receipt, stretch and fork fields", () => {
    const m = sourceManifest({ checkpointEvery: 10_000 });
    for (const [signal, side] of [["livingCells", "low"], ["dominantShare", "high"], ["meanMass", "high"], ["patternEntropy", "low"]] as const) {
      const p = one(m, { signal, side, startStep: 15_300, value: signal === "dominantShare" ? 0.62 : 812.25, median: signal === "dominantShare" ? 0.31 : 640 });
      const b = p.body, rc = b.ring.receipt, st = b.ring.stretch;
      // The receipt's, the stretch's and the fork's numbers, and the intervention's size: radius, tile count, share of cells, quanta per cell.
      const cfg = specConfig(b.spec);
      const size = b.rule.action === "control" ? [] : [maxLesionRadius(cfg), cfg.tilesX * cfg.tilesY, jarShare(cfg), b.constants.feedAmount!].map(String);
      const allowed = new Set(
        [fmtValue(signal, rc.value), fmtValue(signal, rc.median), fmtZ(rc.Z), fmtZ(rc.minAbsZ), ...[rc.startStep, rc.endStep, st.startStep, st.endStep, st.censuses, b.fork.step, b.interventionStep].map(group), ...size].map((x) => x.replace(/%$/, "").replace(/^−/, "")),
      );
      const numbers = b.reason.match(/\d+(,\d{3})*(\.\d+)?/g) ?? [];
      expect(numbers.length).toBeGreaterThan(4);
      for (const n of numbers) expect(allowed, `${n} in: ${b.reason}`).toContain(n);
      if (b.rule.action !== "control") expect(b.reason).toMatch(/a disc of radius 31 cells centred on each of its 4 tiles \(together about \d+% of the world's cells\)/);
    }
  });
  it("gives the dose: the 256 × 256 disc covers 77% of the cells, and a feed or drain names its quanta per cell", () => {
    expect(discCells(127)).toBe(50_617);
    const big = { ...defaultConfig(), tileW: 256, tileH: 256, tilesX: 1, tilesY: 1 } as WorldConfig;
    expect(jarShare(big)).toBe(77);
    const m = sourceManifest({ presetId: "gradient-m3" });
    expect(one(m, { signal: "livingCells", side: "high", startStep: 15_000 }).body.reason).toMatch(/removes up to 32 quanta of nutrient from every cell of a disc of radius 127 cells centred on the world's one tile \(together about 77% of the world's cells\)\.$/);
    expect(one(m, { signal: "maxGeneration", side: "high", startStep: 15_000 }).body.reason).toMatch(/lesions a disc of radius 127 cells .* close to a wipe of the whole jar\.$/);
  });
  it("a false alarm's reason opens with its status", () => {
    const m = sourceManifest();
    expect(one(m, { signal: "maxGeneration", side: "high", startStep: 15_000 }, { falseAlarm: "held-out" }).body.reason).toMatch(/^This ring is one of the bell's false alarms by definition/);
    expect(one(m, { signal: "maxGeneration", side: "high", startStep: 15_000 }, { falseAlarm: "neutral" }).body.reason).toMatch(/^This ring is the bell ringing on neutral dynamics alone/);
    expect(one(m, { signal: "maxGeneration", side: "high", startStep: 15_000 }).body.reason).toMatch(/^The bell rang on/);
  });
});

describe("validation refusals", () => {
  const m = sourceManifest({ presetId: "gradient-m3" });
  const base = (iv: ScheduledIntervention[], C = 0): RunSpec => buildForkSpec(m, C, 19_900, 20_000, iv);
  const at = 19_900;
  it("each refused, naming the check", () => {
    expect(validateProposalSpec(base([{ step: at, kind: "feed", x: 1, y: 1, r: 3, amount: FEED_MAX + 1 }]), 0)).toMatch(/^validateInterventions:.*4096/);
    expect(validateProposalSpec(base([{ step: at, kind: "feed", x: 1, y: 1, r: 3, amount: 0 }]), 0)).toMatch(/^validateInterventions/);
    expect(validateProposalSpec(base([{ step: at, kind: "lesion", x: 256, y: 1, r: 3 }]), 0)).toMatch(/^interventionsError:.*outside the world/);
    expect(validateProposalSpec(base([{ step: 10_000, kind: "lesion", x: 1, y: 1, r: 3 }], 10_000), 10_000)).toMatch(/not in the fork's window/);
    expect(validateProposalSpec({ ...base([]), interventions: [] }, 0)).toMatch(/^validateInterventions:.*non-empty/);
    const pond: RunSpec = { ...base([{ step: at, kind: "feed", x: 1, y: 1, r: 3, amount: 4 }]), presetId: "ponds-small", condition: "pond-nat" };
    expect(validateProposalSpec(pond, 0)).toMatch(/feeding is not defined for pond worlds/);
    expect(validateProposalSpec(base([{ step: at, kind: "lesion", x: 1, y: 1, r: 3 }]), 0, m)).toBeNull();
  });
  it("a proposal that would not validate is not returned", () => {
    const bad = { ...m, spec: { ...m.spec, deepEvery: 0 } } as SourceManifest;
    expect(() => proposeFromNotes(input(bad, [{ signal: "livingCells", side: "high", startStep: 15_000 }]))).toThrow(/validateSpec/);
  });
});

describe("a body is re-derived, not trusted", () => {
  const m = sourceManifest({ presetId: "gradient-m3" });
  const p = one(m, { signal: "livingCells", side: "high", startStep: 15_000 }); // drain at 19,900 from step 0
  const edit = (f: (b: any) => void) => {
    const b = JSON.parse(JSON.stringify(p.body));
    f(b);
    if (b.spec) b.argv = runArgv(b.spec, { step: b.fork?.step ?? 0, dir: b.source?.dir ?? "" });
    return validateProposal(b);
  };
  it("the proposal as written validates", () => expect(validateProposal(p.body)).toBeNull());
  it("an intervention step that is not the receipt's, or a fork not before it (an empty replay)", () => {
    expect(edit((b) => {
      b.spec.interventions[0].step = 100;
      b.interventionStep = 0;
    })).toMatch(/intervention step 0 is not the receipt's last census 19900/);
    expect(edit((b) => (b.spec.interventions[0].step = 100))).toMatch(/not the rule's/);
    expect(edit((b) => (b.replayThrough = 100))).toMatch(/replayThrough 100 is not S/);
  });
  it("invented prose, a missing prediction, another rule, other constants", () => {
    expect(edit((b) => (b.reason = "The nutrient supply causes everything."))).toMatch(/reason is not the one the rules write/);
    expect(edit((b) => delete b.prediction)).toMatch(/no prediction/);
    expect(edit((b) => (b.prediction.threshold = 0.1))).toMatch(/prediction is not the one the rules give/);
    expect(edit((b) => (b.rule.action = "lesion"))).toMatch(/rule is not the table's/);
    expect(edit((b) => (b.constants.horizon = 5000))).toMatch(/constants are not this proposer's/);
    expect(edit((b) => (b.spec.steps = 30_000))).toMatch(/not S − C \+ H/);
    expect(edit((b) => (b.extra = 1))).toMatch(/unknown key "extra"/);
  });
  it("a malformed body is refused, not thrown", () => {
    expect(edit((b) => delete b.ring)).toMatch(/no ring/);
    expect(edit((b) => (b.source.runId = 7))).toMatch(/source is malformed/);
    expect(edit((b) => (b.ring.receipt.endStep = "x"))).toMatch(/census grid/);
  });
});

describe("bounds the runner would refuse or clamp", () => {
  const m = sourceManifest({ presetId: "gradient-m3" });
  const at = 19_900;
  const spec = (iv: ScheduledIntervention[]) => buildForkSpec(m, 0, at, 20_000, iv);
  it("a radius past maxLesionRadius, or below 1", () => {
    expect(validateProposalSpec(spec([{ step: at, kind: "lesion", x: 128, y: 128, r: 99_999 }]), 0)).toMatch(/radius 99999, not in 1\.\.127.*clamp/);
    expect(validateProposalSpec(spec([{ step: at, kind: "lesion", x: 128, y: 128, r: 0 }]), 0)).toMatch(/radius 0, not in 1\.\.127/);
    expect(validateProposalSpec(spec([{ step: at, kind: "lesion", x: 128, y: 128, r: 127 }]), 0)).toBeNull();
  });
  it("feeds that would take the world past MATTER_MAX", () => {
    expect(validateProposalSpec(spec([{ step: at, kind: "feed", x: 128, y: 128, r: 127, amount: 4096 }]), 0)).toMatch(/feeds add up to 207327232 quanta .* past MATTER_MAX/);
    expect(validateProposalSpec(spec([{ step: at, kind: "feed", x: 128, y: 128, r: 127, amount: -4096 }]), 0)).toBeNull(); // a drain only lowers it
    expect(validateProposalSpec(spec([{ step: at, kind: "feed", x: 128, y: 128, r: 127, amount: 32 }]), 0)).toBeNull();
  });
  it("a length that is not a whole number of censuses", () => {
    expect(validateProposalSpec({ ...spec([]), steps: 39_950 }, 0)).toMatch(/not a whole number of censuses/);
  });
});

describe("cadence", () => {
  it("v0 needs the horizon to be whole censuses and the window to fit after S", () => {
    expect(cadenceError(100, RULES_V0)).toBeNull();
    expect(cadenceError(300, RULES_V0)).toMatch(/not a whole number of censuses at cadence 300/);
    expect(cadenceError(500, RULES_V0)).toMatch(/50 censuses at cadence 500 do not fit/);
  });
  it("a ring of a cadence-300 source is skipped with the reason, not proposed off the grid", () => {
    const m = sourceManifest({ censusEvery: 300, steps: 99_900 });
    const r = proposeFromNotes(input(m, [{ signal: "livingCells", side: "high", startStep: 15_000 }]));
    expect(r.proposals).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/horizon 20000 is not a whole number of censuses at cadence 300/);
  });
});

describe("parseNotes on real and grouped files", () => {
  it("parses the committed seed-15 notes file", () => {
    const path = fileURLToPath(new URL("../../docs/examples/field-notebook-2026-10-17-gradient-m3-neutral-seed-15.notes.json", import.meta.url));
    const n = parseNotes(readFileSync(path, "utf8"));
    expect(n.run).toMatchObject({ id: "replay-m4/gradient-m3/neutral/seed-15", falseAlarm: "held-out", W: 50, burnInStep: 10_000 });
    expect(n.rings.map((r) => [r.signal, r.side, r.receipt.endStep])).toEqual([["maxGeneration", "high", 77_500]]);
  });
  it("reads several notes of one entry in filing order", () => {
    const m = sourceManifest();
    const text = notesJson(m, [
      { signal: "livingCells", side: "high", startStep: 15_000 },
      { signal: "maxGeneration", side: "high", startStep: 15_000 },
      { signal: "fissions", side: "low", startStep: 16_000 },
    ], {
      mutate: (n: any) => {
        n.entries[0].notes.push(...n.entries[1].notes);
        n.entries.splice(1, 1);
      },
    });
    const n = parseNotes(text);
    expect(n.rings.map((r) => r.signal)).toEqual(["livingCells", "maxGeneration", "fissions"]);
    const r = proposeFromNotes({ ...input(m, []), notes: n });
    expect(r.proposals.map((p) => p.body.ring.index)).toEqual([0, 1, 2]);
  });
});

describe("source refusals", () => {
  const cases: [string, Parameters<typeof sourceManifest>[0], RegExp][] = [
    ["pond", { presetId: "ponds-small", condition: "pond-nat" }, /pond world/],
    ["branch", { extraManifest: { branch: { boundary: 1 } } }, /branch/],
    ["picked", { extraSpec: { picked: true } }, /picked/],
    ["pressured", { extraSpec: { pressures: [] } }, /pressured/],
    ["metapopulation", { extraSpec: { metapopulation: { salt: 1, migrantCount: 1, ringNamespace: 1 } } }, /metapopulation/],
    ["founder options", { presetId: "gradient-m3", extraSpec: { soloFounder: 0 } }, /founder options/],
    ["interventions", { extraSpec: { interventions: [{ step: 5, kind: "lesion", x: 0, y: 0, r: 1 }] } }, /already carries interventions/],
    ["an unknown spec key", { extraSpec: { speciesCensus: true } }, /speciesCensus/],
    ["an unfinished run", { extraManifest: { summary: null } }, /not finished/],
    ["another rule version", { extraManifest: { ruleVersion: 999 } }, /rule version/],
  ];
  for (const [name, opts, re] of cases)
    it(name, () => {
      let m: SourceManifest;
      try {
        m = sourceManifest(opts);
      } catch {
        // A spec the runner cannot build a config for (a pond preset under a metapopulation): the refusal is still the proposer's.
        m = { ...sourceManifest(), spec: { ...sourceManifest().spec, ...(opts!.extraSpec ?? {}) } } as SourceManifest;
      }
      expect(sourceRefusal(m)).toMatch(re);
      expect(() => proposeFromNotes(input(m, [{ signal: "maxGeneration", side: "high", startStep: 15_000 }]))).toThrow(re);
    });
  it("a plain finished run is accepted", () => expect(sourceRefusal(sourceManifest())).toBeNull());
});

describe("duplicates", () => {
  it("two rings with the same spec give one proposal; the second is listed as a duplicate", () => {
    const m = sourceManifest();
    const r = proposeFromNotes(input(m, [
      { signal: "livingCells", side: "high", startStep: 15_000 },
      { signal: "fissions", side: "high", startStep: 15_000 }, // drain at the same step: the same run
      { signal: "livingCells", side: "low", startStep: 15_000 },
    ]));
    expect(r.proposals.map((p) => p.body.ring.signal)).toEqual(["livingCells", "livingCells"]);
    expect(r.duplicates).toEqual([{ ring: 1, signal: "fissions", side: "high", of: r.proposals[0].id }]);
    // The kept proposal records the duplicate ring with its own prediction, so the bench decides both.
    const also = r.proposals[0].body.alsoAnswers!;
    expect(also).toHaveLength(1);
    expect(also[0]).toMatchObject({ index: 1, signal: "fissions", side: "high", prediction: { kind: "directional", signal: "fissions", direction: "down" } });
    expect(r.proposals[1].body.alsoAnswers).toBeUndefined();
    for (const p of r.proposals) expect(validateProposal(p.body)).toBeNull();
    // A lesion on maxGeneration and on dominantShare at one step: one run, two predictions.
    const two = proposeFromNotes(input(m, [
      { signal: "maxGeneration", side: "high", startStep: 15_000 },
      { signal: "dominantShare", side: "high", startStep: 15_000 },
    ])).proposals;
    expect(two).toHaveLength(1);
    expect(two[0].body.alsoAnswers!.map((x) => [x.signal, x.prediction.signal, x.prediction.direction])).toEqual([["dominantShare", "dominantShare", "down"]]);
    const forged = { ...two[0].body, alsoAnswers: [{ ...two[0].body.alsoAnswers![0], signal: "livingCells" }] };
    expect(validateProposal(forged)).toMatch(/alsoAnswers\[0\].*does not give this run spec/);
    // A replay control kept for two rings cannot be forged into also answering a drain ring.
    const controls = proposeFromNotes(input(m, [
      { signal: "patternEntropy", side: "high", startStep: 15_000 },
      { signal: "bioticRecycling", side: "low", startStep: 15_000 },
    ])).proposals;
    expect(controls).toHaveLength(1);
    expect(validateProposal(controls[0].body)).toBeNull();
    const asDrain = { ...controls[0].body, alsoAnswers: [{ ...controls[0].body.alsoAnswers![0], signal: "livingCells", side: "high" as const }] };
    expect(validateProposal(asDrain)).toMatch(/alsoAnswers\[0\].*does not give this run spec/);
  });
});

describe("the yes gate", () => {
  const p = one(sourceManifest(), { signal: "livingCells", side: "low", startStep: 15_000 });
  const AT = "2026-10-18T12:00:00.000Z";
  it("approve refuses non-person names, a status other than proposed, and a body that does not re-validate", () => {
    for (const name of ["", "x", "Claude", "codex bot", "GPT", "  ai  ", "My Agent", "gemini-2", " A.I. ", "Ｃｌａｕｄｅ", "claude-code", "Sonnet", "Opus 4", "Grok", "gpt4o", "Llama"]) expect(() => approve(p, name, AT), name).toThrow(/not a person's name/);
    const ok = approve(p, "Nicholas Zographos", AT);
    expect(ok).toMatchObject({ status: "approved", approval: { by: "Nicholas Zographos", at: AT, bodySha256: bodySha256(p.body) } });
    expect(() => approve(ok, "Nicholas Zographos", AT)).toThrow(/status is approved/);
    const broken = { ...p.body, argv: [...p.body.argv, "--lineage-obs"] };
    expect(() => approve({ ...p, id: proposalId(broken), body: broken }, "Nicholas Zographos", AT)).toThrow(/re-validate.*argv/);
    expect(isPersonName("Aino Kainulainen")).toBe(true);
    expect(isPersonName("Mx Botha")).toBe(true);
    expect(isPersonName("Siobhán O'Brien")).toBe(true);
    // Accepted false refusals (the note: a guard against accidents, not a signature): a person whose name is a listed word.
    expect(isPersonName("Ai Tanaka")).toBe(false);
    expect(isPersonName("Claude Monet")).toBe(false);
  });
  it("runRefusal: proposed refused, edited-after-approval refused, no approver refused, a correct approval passes", () => {
    expect(runRefusal(p)).toMatch(/not approved/);
    const ok = approve(p, "Nicholas Zographos", AT);
    expect(runRefusal(ok)).toBeNull();
    const edited = { ...ok, body: { ...ok.body, reason: ok.body.reason + "!" } };
    expect(runRefusal(edited)).toMatch(/body changed after it was approved/);
    expect(runRefusal({ ...ok, approval: { ...ok.approval!, by: "" } })).toMatch(/names no person/);
    expect(runRefusal({ ...ok, approval: undefined })).toMatch(/no approval/);
  });
  it("runRefusal never throws on a malformed body: it refuses", () => {
    const ok = approve(p, "Nicholas Zographos", AT);
    for (const body of [{ ...ok.body, source: { ...ok.body.source, runId: undefined } }, { ...ok.body, constants: undefined }, { ...ok.body, ring: { ...ok.body.ring, receipt: null } }, { ...ok.body, spec: { ...ok.body.spec, interventions: [null] } }]) {
      const b = JSON.parse(JSON.stringify(body)) as typeof ok.body;
      const forged = { ...ok, id: proposalId(b), approval: { ...ok.approval!, bodySha256: bodySha256(b) }, body: b };
      expect(() => runRefusal(forged)).not.toThrow();
      expect(runRefusal(forged)).toBeTypeOf("string");
    }
  });
});

describe("random baseline", () => {
  const m = sourceManifest({ checkpointEvery: 10_000 });
  const ps = proposeFromNotes(input(m, [
    { signal: "maxGeneration", side: "high", startStep: 15_000 },
    { signal: "livingCells", side: "low", startStep: 16_000 },
    { signal: "lineages", side: "low", startStep: 15_500 },
    { signal: "individuals", side: "high", startStep: 15_600 },
  ])).proposals;

  it("is deterministic per seed, differs across seeds, and one fork does not depend on the others", () => {
    const a = ps.map((p) => randomBaseline(p, 7));
    const b = ps.map((p) => randomBaseline(p, 7));
    expect(a.map((x) => x && serializeProposal(x))).toEqual(b.map((x) => x && serializeProposal(x)));
    const c = ps.map((p) => randomBaseline(p, 8));
    expect(a.filter(Boolean).map((x) => x!.id)).not.toEqual(c.filter(Boolean).map((x) => x!.id));
    const without = ps.slice(1).map((p) => randomBaseline(p, 7));
    expect(without.map((x) => x && serializeProposal(x))).toEqual(a.slice(1).map((x) => x && serializeProposal(x)));
  });
  it("has the proposal's budget and passes validation; a replay control gets none", () => {
    for (const p of ps) {
      const r = randomBaseline(p, 7);
      if (p.body.rule.action === "control") {
        expect(r).toBeNull();
        continue;
      }
      const b = r!.body, C = p.body.fork.step, S = p.body.interventionStep;
      expect(b).toMatchObject({ generator: "random-v0", baseline: { matches: p.id, seed: 7 }, prediction: { kind: "none" }, fork: p.body.fork });
      expect(b.spec.steps).toBe(p.body.spec.steps);
      expect(b.spec.interventions).toHaveLength(p.body.spec.interventions!.length);
      for (const e of b.spec.interventions!) {
        expect(e.step > C && e.step <= S && (e.step - C) % 100 === 0).toBe(true);
        expect(e.r >= 1 && e.r <= 31).toBe(true);
        if (e.kind === "feed") expect(Math.abs(e.amount)).toBe(32);
      }
      expect(validateProposalSpec(b.spec, C, m)).toBeNull();
      expect(validateProposal(b)).toBeNull();
      // run checks the replay only up to the first entry, where the random fork may already depart from the source.
      expect(b.replayThrough).toBe(Math.min(...b.spec.interventions!.map((e) => e.step)));
      expect(b.reason).toMatch(/Only the entry count is matched, not the dose/);
      expect(b.alsoAnswers).toBeUndefined();
      expect(canonical(specFromArgv(b.argv).spec)).toBe(canonical(b.spec));
      expect(r!.status).toBe("proposed");
    }
  });
  it("depends on the matched spec, not on where the files sit: moving the bundle changes the id but not the draw", () => {
    const p = ps[0];
    const moved = proposeFromNotes({ ...input(m, [{ signal: "maxGeneration", side: "high", startStep: 15_000 }]), source: { dir: "/elsewhere/copy", manifestSha256: "b".repeat(64) } }).proposals[0];
    expect(moved.id).not.toBe(p.id);
    expect(randomBaseline(moved, 7)!.body.spec).toEqual(randomBaseline(p, 7)!.body.spec);
  });
  it("a random fork whose entries are not its seed's draw is refused", () => {
    const r = randomBaseline(ps[0], 7)!;
    const b = JSON.parse(JSON.stringify(r.body));
    b.spec.interventions[0].r = b.spec.interventions[0].r === 1 ? 2 : 1;
    b.argv = runArgv(b.spec, { step: b.fork.step, dir: b.source.dir });
    expect(validateProposal(b)).toMatch(/not the draw for this seed/);
    expect(validateProposal({ ...r.body, baseline: { ...r.body.baseline!, seed: 8 } })).toMatch(/not the draw/);
  });
  it("orders same-step entries as tools/run.ts merges them, so the argv maps back for every draw", () => {
    for (let seed = 0; seed < 200; seed++)
      for (const p of ps) {
        const r = randomBaseline(p, seed);
        if (r) expect(canonical(specFromArgv(r.body.argv).spec)).toBe(canonical(r.body.spec));
      }
  });
});

describe("predictionHolds", () => {
  const m = sourceManifest();
  const p = one(m, { signal: "livingCells", side: "low", startStep: 15_000, spread: 10 });
  const pred = p.body.prediction;
  const idx = SIGNALS.findIndex((s) => s.name === "livingCells");
  const track = (f: (t: number) => number): SignalTrack => {
    const out = new Map<number, (number | null)[]>();
    for (let t = 100; t <= pred.toStep!; t += 100) out.set(t, SIGNALS.map((_, i) => (i === idx ? f(t) : 5)));
    return out;
  };
  const source = track((t) => 1000 + (t % 700));
  it("+1.2 spreads at the median holds for up and fails for down", () => {
    expect(pred).toMatchObject({ kind: "directional", direction: "up", censuses: 50, spread: 10, threshold: 1 });
    const fork = track((t) => 1000 + (t % 700) + 12);
    expect(predictionHolds(pred, 100, source, fork)).toBe(true);
    expect(predictionHolds({ ...pred, direction: "down" }, 100, source, fork)).toBe(false);
  });
  it("0.9 spreads at the median fails", () => {
    expect(predictionHolds(pred, 100, source, track((t) => 1000 + (t % 700) + 9))).toBe(false);
  });
  it("a replay control holds only on exact equality", () => {
    const c = one(m, { signal: "patternEntropy", side: "high", startStep: 15_000 }).body.prediction;
    const s = track(() => 7);
    expect(predictionHolds(c, 100, s, track(() => 7))).toBe(true);
    const off = new Map(track(() => 7));
    off.set(200, [...off.get(200)!.slice(0, -1), 6]);
    expect(predictionHolds(c, 100, s, off)).toBe(false);
  });
  it("a missing census cannot be decided", () => {
    const short = new Map(source);
    short.delete(pred.toStep!);
    expect(() => predictionHolds(pred, 100, source, short)).toThrow(/no census/);
  });
  it("exactly the threshold holds; a null on the ring's signal, or vectors that are not 13 signals, cannot be decided", () => {
    expect(predictionHolds(pred, 100, source, track((t) => 1000 + (t % 700) + 10))).toBe(true);
    const nul = new Map(track((t) => 1000 + (t % 700) + 12));
    nul.set(pred.toStep!, SIGNALS.map((_, i) => (i === idx ? null : 5)));
    expect(() => predictionHolds(pred, 100, source, nul)).toThrow(/undefined at step/);
    const c = one(m, { signal: "patternEntropy", side: "high", startStep: 15_000 }).body.prediction;
    const empty = new Map<number, (number | null)[]>();
    for (let t = c.fromStep!; t <= c.toStep!; t += 100) empty.set(t, []);
    expect(() => predictionHolds(c, 100, empty, empty)).toThrow(/is not 13 numbers or nulls/);
  });
  it("an odd-length window takes the middle value", () => {
    const five = { ...pred, fromStep: pred.toStep! - 400, censuses: 5 };
    // d = 0, 0, 1, 2, 2 spreads: the median is 1, at the threshold.
    const bump = [0, 0, 10, 20, 20];
    const fork = track((t) => 1000 + (t % 700) + (t >= five.fromStep ? bump[(t - five.fromStep) / 100] : 0));
    expect(predictionHolds(five, 100, source, fork)).toBe(true);
    expect(predictionHolds({ ...five, threshold: 1.01 }, 100, source, fork)).toBe(false);
  });
  it("a window shifted off the census grid cannot be decided, even with tracks at the shifted steps (pass 2 review)", () => {
    const vec = SIGNALS.map(() => 5);
    const shifted = new Map<number, (number | null)[]>([[50, vec], [150, vec]]);
    const replay = { kind: "replay" as const, statement: "", fromStep: 50, toStep: 150, censuses: 2 };
    expect(() => predictionHolds(replay, 100, shifted, shifted)).toThrow(/not on the census grid/);
    expect(() => predictionHolds({ ...replay, fromStep: 100, toStep: 200 }, 0, shifted, shifted)).toThrow(/not a positive integer/);
  });
});
