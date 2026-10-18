// Picked runs, host side and without a GPU (picks.ts; RunSpec.picked; applyBoundary's DonorHook): the pick log,
// the lab-manifest loader, preflight and consistency checks, the donor hook and its one failure rule, and the spec
// rules. tests/deno/breed.ts and the hand check in tools/run.ts's header run whole histories on a GPU.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CH,
  METRICS_VERSION,
  PRESETS,
  RULE_VERSION,
  SCHEMA_VERSION,
  applyPondCycle,
  cellCount,
  cloneState,
  initWorld,
  pondDonors,
  pondMatter,
  pondTraits,
  presetConfig,
  randomKey,
  stateHash,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  PICKS_FILE,
  PickError,
  activePondScore,
  applyBoundary,
  formatFailedLine,
  formatPickLine,
  livePickError,
  makeDonorHook,
  mergePickLogs,
  parsePickLog,
  parsePickLogPrefix,
  pickLogsConflict,
  pickedConfigError,
  picksConsistencyError,
  picksDigest,
  picksFromManifest,
  picksPreflightError,
  pondCensus,
  pondContext,
  pressureCycleOf,
  pressureEntriesError,
  pressureHook,
  pressureLogError,
  pressuresConfigError,
  ruleDonors,
  runIsland,
  sameCompletedRun,
  specConfig,
  specRefusal,
  thrownMessage,
  validateSpec,
  type DonorHook,
  type PickEntry,
  type PickNote,
  type PickRequest,
  type Picker,
  type PressureEntry,
  type RunSpec,
} from "@bl/runner";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const spec: RunSpec = { experiment: "pk", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 4000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0 };

/** ponds-small at seed 1 under `extra`, moved to `step`. */
const worldAt = (step: number, extra: Partial<WorldConfig> = {}): WorldState => ({ ...initWorld(presetConfig(pondsSmall, 1, extra), pondsSmall.init), step });

/** The reference physics behind readState/upload; counts both. */
class CpuSim {
  ref: RefSim;
  reads = 0;
  uploads = 0;
  constructor(state: WorldState) {
    this.ref = new RefSim(cloneState(state));
  }
  get cfg() {
    return this.ref.state.cfg;
  }
  async readState() {
    this.reads++;
    return cloneState(this.ref.state);
  }
  upload(state: WorldState) {
    this.uploads++;
    this.ref = new RefSim(cloneState(state));
  }
}

/** `pre` with every pond but `keep` emptied of bound mass (B and P moved to nutrient A, so each pond keeps its matter). */
function emptied(pre: WorldState, keep: readonly number[]): WorldState {
  const s = cloneState(pre);
  const n = cellCount(s.cfg), side = s.cfg.tileW, W = s.cfg.tileW * s.cfg.tilesX;
  for (let p = 0; p < s.cfg.tilesX * s.cfg.tilesY; p++) {
    if (keep.includes(p)) continue;
    const tx = p % s.cfg.tilesX, ty = (p - tx) / s.cfg.tilesX;
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const i = (ty * side + y) * W + tx * side + x;
        s.cells[CH.A * n + i] += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
        s.cells[CH.B * n + i] = 0;
        s.cells[CH.P * n + i] = 0;
      }
  }
  return s;
}

const line = (e: PickEntry, extra: { by?: string; suggested?: number[] } = {}) => formatPickLine({ ...e, by: extra.by ?? "t", suggested: extra.suggested ?? e.donors });

describe("the pick log", () => {
  it("round-trips pick lines and carries the lab's intervention keys first", () => {
    const entries: PickEntry[] = [
      { step: 5000, cycle: 1, donors: [3, 9] },
      { step: 10000, cycle: 2, donors: [] },
    ];
    const text = entries.map((e) => line(e, { by: "command:model", suggested: [1] })).join("");
    expect(Object.keys(JSON.parse(text.split("\n")[0]))).toEqual(["step", "kind", "cycle", "donors", "by", "suggested"]);
    expect(parsePickLog(text)).toEqual(entries);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("skips failed lines and other kinds, and blank lines", () => {
    const text = line({ step: 1000, cycle: 1, donors: [2] }) + formatFailedLine(2000, 2, "x", "boom") + formatFailedLine(2000, 2, "x", "late", "after") + '{"kind":"note"}\n\n';
    expect(parsePickLog(text)).toEqual([{ step: 1000, cycle: 1, donors: [2] }]);
    expect(JSON.parse(formatFailedLine(2000, 2, "x", "late", "after"))).toEqual({ step: 2000, kind: "failed", cycle: 2, by: "x", phase: "after", error: "late" });
  });

  it("refuses a malformed pick line, a repeated and a descending step", () => {
    expect(() => parsePickLog("{not json\n")).toThrow(/line 1: not JSON/);
    expect(() => parsePickLog('{"kind":"pick","step":1000,"cycle":1,"donors":[-1]}\n')).toThrow(/donors must be an array of pond indices/);
    expect(() => parsePickLog('{"kind":"pick","step":1000,"cycle":0,"donors":[1]}\n')).toThrow(/cycle must be a positive integer/);
    const a = line({ step: 1000, cycle: 1, donors: [1] }), b = line({ step: 2000, cycle: 2, donors: [1] });
    expect(() => parsePickLog(a + a)).toThrow(/step 1000 follows step 1000/);
    expect(() => parsePickLog(b + a)).toThrow(/step 1000 follows step 2000/);
  });

  it("parsePickLogPrefix: a torn last record is cut off and reported; any other damage still throws", () => {
    const a = line({ step: 1000, cycle: 1, donors: [1] }), b = line({ step: 2000, cycle: 2, donors: [2, 0] }), c = line({ step: 3000, cycle: 3, donors: [3] });
    const whole = parsePickLogPrefix(a + b);
    expect(whole).toEqual({ entries: [{ step: 1000, cycle: 1, donors: [1] }, { step: 2000, cycle: 2, donors: [2, 0] }], text: a + b, torn: null });
    const torn = parsePickLogPrefix(a + b + c.slice(0, 30));
    expect(torn.entries.length).toBe(2);
    expect(torn.text).toBe(a + b);
    expect(torn.torn).toBe(c.slice(0, 30));
    // The torn record is the unterminated, unparsable last line and nothing else: a bad middle line, a bad terminated line, and a complete line that is not a pick.
    expect(() => parsePickLogPrefix(a + "{oops\n" + b)).toThrow(/line 2: not JSON/);
    expect(() => parsePickLogPrefix(a + "{oops\n")).toThrow(/line 2: not JSON/);
    expect(() => parsePickLogPrefix(a + '{"kind":"pick","step":2000,"cycle":0,"donors":[1]}')).toThrow(/cycle must be a positive integer/);
    // Complete but unterminated is still complete.
    expect(parsePickLogPrefix(a + b.trimEnd()).entries.length).toBe(2);
    expect(parsePickLogPrefix("").entries).toEqual([]);
  });

  it("pickLogsConflict: logs must agree at every step they share, and a longer log agrees", () => {
    const e = (step: number, donors: number[]): PickEntry => ({ step, cycle: step / 1000, donors });
    const log = (source: string, ...entries: PickEntry[]) => ({ source, entries });
    expect(pickLogsConflict([log("a", e(1000, [0]), e(2000, [1])), log("b", e(1000, [0]))])).toBeNull();
    expect(pickLogsConflict([log("a"), log("b", e(1000, [0]))])).toBeNull();
    // A sparse lab record against a dense bundle log: shared steps agree, the rest is no conflict.
    expect(pickLogsConflict([log("lab", e(2000, [1])), log("bundle", e(1000, [0]), e(2000, [1]), e(3000, [2]))])).toBeNull();
    expect(pickLogsConflict([log("a", e(1000, [0])), log("b", e(1000, [1]), e(2000, [1]))])).toMatch(/a and b disagree at t=1000.*\[0\].*\[1\]/);
    expect(pickLogsConflict([log("a", e(1000, [0, 1])), log("b", e(1000, [1, 0]))])).toMatch(/disagree at t=1000/);
    expect(pickLogsConflict([log("a", e(1000, [0])), log("b", e(1000, [0])), log("c", { step: 1000, cycle: 9, donors: [0] })])).toMatch(/a and c disagree/);
  });

  it("mergePickLogs: one record of every boundary the logs hold, each from the first log that has it", () => {
    const e = (step: number, donors: number[]): PickEntry => ({ step, cycle: step / 1000, donors });
    const line = (x: PickEntry, by: string) => formatPickLine({ ...x, by, suggested: [9] });
    // The bundle's log holds cycles 1 to 3 (with a failed line), a given record cycles 3 to 5: no boundary is lost, and 3 keeps the bundle's line.
    const bundle = { entries: [e(1000, [0]), e(2000, [1]), e(3000, [2])], text: line(e(1000, [0]), "model") + line(e(2000, [1]), "model") + line(e(3000, [2]), "model") + formatFailedLine(4000, 4, "model", "boom") };
    const given = { entries: [e(3000, [2]), e(4000, [3]), e(5000, [0])], text: line(e(3000, [2]), "recorded") + line(e(4000, [3]), "random") + line(e(5000, [0]), "random") };
    const merged = mergePickLogs([bundle, given]);
    expect(merged.entries).toEqual([e(1000, [0]), e(2000, [1]), e(3000, [2]), e(4000, [3]), e(5000, [0])]);
    expect(merged.text).toBe(line(e(1000, [0]), "model") + line(e(2000, [1]), "model") + line(e(3000, [2]), "model") + line(e(4000, [3]), "random") + line(e(5000, [0]), "random"));
    expect(parsePickLog(merged.text)).toEqual(merged.entries);
    // Disjoint logs in either order, and a log that comes later but starts earlier: ascending all the same.
    expect(mergePickLogs([{ entries: [e(4000, [3])] }, { entries: [e(1000, [0])] }]).entries.map((x) => x.step)).toEqual([1000, 4000]);
    // A source without lines of its own (a lab manifest) is written out as pick lines, never as its own text.
    const lab = mergePickLogs([{ entries: [e(2000, [1]), e(4000, [3])] }]);
    expect(lab.text).toBe('{"step":2000,"kind":"pick","cycle":2,"donors":[1]}\n{"step":4000,"kind":"pick","cycle":4,"donors":[3]}\n');
    expect(parsePickLog(lab.text)).toEqual(lab.entries);
    expect(mergePickLogs([])).toEqual({ entries: [], text: "" });
  });

  it("thrownMessage: an Error's message, anything else as text", () => {
    expect(thrownMessage(new Error("boom"))).toBe("boom");
    expect(thrownMessage(null)).toBe("null");
    expect(thrownMessage(undefined)).toBe("undefined");
    expect(thrownMessage("plain")).toBe("plain");
  });

  it("digests the steps and donors alone: the same picks under another picker digest alike", async () => {
    const e: PickEntry[] = [{ step: 1000, cycle: 1, donors: [2, 0] }];
    expect(await picksDigest(e)).toMatch(/^[0-9a-f]{16}$/);
    expect(await picksDigest(e)).toBe(await picksDigest(parsePickLog(line(e[0], { by: "other", suggested: [9] }))));
    expect(await picksDigest(e)).not.toBe(await picksDigest([{ step: 1000, cycle: 1, donors: [0, 2] }]));
  });
});

describe("picksFromManifest (a lab run manifest)", () => {
  const picks = [
    { step: 1000, kind: "pick", cycle: 1, donors: [2] },
    { step: 2000, kind: "pick", cycle: 2, donors: [1, 3] },
  ];
  it("keeps the pick interventions", () => {
    expect(picksFromManifest({ presetId: "x", interventions: picks, edgesFrom: 0 })).toEqual([
      { step: 1000, cycle: 1, donors: [2] },
      { step: 2000, cycle: 2, donors: [1, 3] },
    ]);
    expect(picksFromManifest({ interventions: [] })).toEqual([]);
  });
  it("refuses a lesion, a feed, edges observed from later, and what is not a manifest", () => {
    expect(() => picksFromManifest({ interventions: [...picks, { step: 2500, kind: "lesion", x: 1, y: 1, r: 3 }] })).toThrow(/"lesion".*would not be that history/);
    expect(() => picksFromManifest({ interventions: [{ step: 500, kind: "feed", x: 1, y: 1, r: 3, amount: 4, matter: 8 }] })).toThrow(/"feed".*would not be that history/);
    expect(() => picksFromManifest({ interventions: picks, edgesFrom: 4000 })).toThrow(/only from step 4000/);
    expect(() => picksFromManifest({ interventions: [picks[1], picks[0]] })).toThrow(/in order/);
    expect(() => picksFromManifest({})).toThrow(/no interventions array/);
    expect(() => picksFromManifest(null)).toThrow(/no interventions array/);
  });
});

describe("picksPreflightError", () => {
  const cfg = { pondPeriod: 1000 };
  const e = (cycle: number, donors = [0]): PickEntry => ({ step: cycle * 1000, cycle, donors });
  it("accepts a complete log, and a short one only when something answers the rest", () => {
    expect(picksPreflightError([e(1), e(2), e(3), e(4)], cfg, 0, 4000, false)).toBeNull();
    expect(picksPreflightError([e(1), e(2, [])], cfg, 0, 2500, false)).toBeNull();
    expect(picksPreflightError([e(1)], cfg, 0, 4000, false)).toMatch(/covers 1 of the run's 4 pond boundaries/);
    expect(picksPreflightError([e(1)], cfg, 0, 4000, true)).toBeNull();
    expect(picksPreflightError([], cfg, 0, 4000, true)).toBeNull();
  });
  it("refuses an entry off a boundary, outside the run, out of order, repeated, mislabelled or with bad donors", () => {
    expect(picksPreflightError([{ step: 1500, cycle: 1, donors: [0] }], cfg, 0, 4000, true)).toMatch(/not on a pond boundary/);
    expect(picksPreflightError([e(5)], cfg, 0, 4000, true)).toMatch(/outside the run/);
    expect(picksPreflightError([{ step: 0, cycle: 0, donors: [0] }], cfg, 0, 4000, true)).toMatch(/outside the run/);
    expect(picksPreflightError([e(2), e(1)], cfg, 0, 4000, true)).toMatch(/out of order or repeated/);
    expect(picksPreflightError([e(1), e(1)], cfg, 0, 4000, true)).toMatch(/out of order or repeated/);
    expect(picksPreflightError([{ step: 2000, cycle: 3, donors: [0] }], cfg, 0, 4000, true)).toMatch(/says cycle 3, not 2/);
    expect(picksPreflightError([e(1, [1, 1])], cfg, 0, 4000, true)).toMatch(/distinct ponds/);
    expect(picksPreflightError([e(1)], {}, 0, 4000, true)).toMatch(/pond config/);
  });
});

describe("livePickError", () => {
  const pre = worldAt(1000, { pondArm: "scaf" });
  const traits = pondTraits(pre);
  const req = (max: number): PickRequest => ({ step: 1000, cycle: 1, pre, k: 8, occupied: traits.flatMap((t, p) => (t > 0 ? [p] : [])), suggested: [0], max });
  it("takes one to max distinct occupied ponds", () => {
    expect(livePickError(req(2), [1])).toBeNull();
    expect(livePickError(req(2), [1, 3])).toBeNull();
    expect(livePickError(req(2), [])).toMatch(/at least one/);
    expect(livePickError(req(2), [1, 1])).toMatch(/repeat/);
    expect(livePickError(req(2), [9])).toMatch(/not an occupied pond/);
    expect(livePickError(req(2), [0, 1, 2])).toMatch(/at most 2/);
    expect(livePickError(req(1), [0, 1])).toMatch(/at most 1/);
  });
  it("refuses an empty pond", () => {
    const r = { ...req(2), pre: emptied(pre, [0, 1]) };
    expect(livePickError(r, [2])).toMatch(/pond 2 is not an occupied pond/);
    expect(livePickError(r, [1])).toBeNull();
  });
});

describe("picksConsistencyError", () => {
  const ponds = (b: number, step: number, donorOf: number[]) => donorOf.map((donor, recipient) => ["cycle", b, "step", step, "recipient", recipient, "donor", donor]);
  const table = (rows: (string | number)[][]) =>
    "cycle\tstep\trecipient\tdonor\n" + rows.map((r) => `${r[1]}\t${r[3]}\t${r[5]}\t${r[7]}`).join("\n") + "\n";
  // Donor assignment of boundary b at seed s over R recipients for the log order `donors`.
  const assigned = (seed: number, b: number, R: number, donors: number[]): number[] => {
    const order = Array.from({ length: R }, (_, pond) => ({ pond, key: randomKey(seed, b, pond, 2) })).sort((x, y) => x.key - y.key || x.pond - y.pond);
    const out = new Array<number>(R).fill(-1);
    order.forEach((r, i) => (out[r.pond] = donors[i % donors.length]));
    return out;
  };

  it("matches a real cycle's rows to its log", () => {
    const pre = worldAt(1000, { pondArm: "scaf" });
    const cycle = applyPondCycle(pre, 1, "scaf", 8, pondMatter(pre), pondCensus);
    const rows = cycle.rows.map((r) => ["cycle", r.cycle, "step", r.step, "recipient", r.recipient, "donor", r.donor]);
    const log = line({ step: 1000, cycle: 1, donors: cycle.donors });
    expect(picksConsistencyError(log, table(rows), 1)).toBeNull();
    expect(picksConsistencyError(log, table(rows))).toBeNull();
  });
  it("catches a donor that differs, a missing boundary and an extra one", () => {
    const rows = ponds(1, 1000, assigned(5, 1, 4, [0, 1]));
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [0, 1] }), table(rows), 5)).toBeNull();
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [0, 2] }), table(rows), 5)).toMatch(/not the log's/);
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [0, 1] }) + line({ step: 2000, cycle: 2, donors: [0] }), table(rows), 5)).toMatch(/boundary 2, which ponds.tsv does not/);
    expect(picksConsistencyError("", table(rows), 5)).toMatch(/ponds.tsv has boundary 1/);
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [] }), table(rows), 5)).toMatch(/names no donor but ponds.tsv has one/);
  });
  it("tells [0, 1] from [1, 0]: order changes the assignment", () => {
    // Find a seed where the two orders assign differently (any seed with R = 4 recipients does for some pond).
    const seed = 5;
    const forward = assigned(seed, 1, 4, [0, 1]), reversed = assigned(seed, 1, 4, [1, 0]);
    expect(forward).not.toEqual(reversed);
    const rows = ponds(1, 1000, forward);
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [1, 0] }), table(rows), seed)).toMatch(/the log's order assigns/);
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [0, 1] }), table(rows), seed)).toBeNull();
  });
  it("accepts an empty boundary with donor -1 rows and refuses donors there", () => {
    const rows = ponds(1, 1000, [-1, -1, -1, -1]);
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [] }), table(rows), 1)).toBeNull();
    expect(picksConsistencyError(line({ step: 1000, cycle: 1, donors: [2] }), table(rows), 1)).toMatch(/donor -1 rows but the log names donors/);
  });
});

describe("applyBoundary with a DonorHook", () => {
  const pre = worldAt(1000, { pondArm: "scaf" });
  const suggested = pondDonors(pre, 1, "scaf", 8);

  it("equals the array form bit for bit, and reads the state once, before the hook", async () => {
    const a = new CpuSim(pre), b = new CpuSim(pre);
    const seen: { pre: WorldState; b: number; reads: number }[] = [];
    const hook: DonorHook = async (p, cycle) => {
      seen.push({ pre: p, b: cycle, reads: b.reads });
      return [2];
    };
    const viaArray = await applyBoundary(a, 1000, pondContext(pre), [2]);
    const viaHook = await applyBoundary(b, 1000, pondContext(pre), hook);
    expect(viaHook.ponds!.rows).toEqual(viaArray.ponds!.rows);
    expect(viaHook.ponds!.donors).toEqual([2]);
    expect(stateHash(await b.readState())).toBe(stateHash(await a.readState()));
    expect(seen.length).toBe(1);
    expect(seen[0].b).toBe(1);
    expect(seen[0].reads).toBe(1);
    expect(b.reads - 1).toBe(1); // the one readback of applyBoundary, plus this test's own check below
    expect(stateHash(seen[0].pre)).toBe(stateHash(pre));
  });

  it("undefined leaves the choice to the arm", async () => {
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre), async () => undefined);
    const want = applyPondCycle(pre, 1, "scaf", 8, pondMatter(pre), pondCensus);
    expect(res.ponds!.donors).toEqual(want.donors);
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
  });

  it("the arm's own donors as the hook's answer are the arm's cycle bit for bit", async () => {
    const sim = new CpuSim(pre);
    await applyBoundary(sim, 1000, pondContext(pre), async () => suggested);
    expect(stateHash(await sim.readState())).toBe(stateHash(applyPondCycle(pre, 1, "scaf", 8, pondMatter(pre), pondCensus).state));
  });

  it("a hook that throws leaves the world unchanged and uploads nothing", async () => {
    const sim = new CpuSim(pre);
    await expect(applyBoundary(sim, 1000, pondContext(pre), async () => { throw new Error("no"); })).rejects.toThrow("no");
    expect(sim.uploads).toBe(0);
    expect(stateHash(await sim.readState())).toBe(stateHash(pre));
  });

  it("is refused, with nothing read, away from a boundary and for the arm cont", async () => {
    const hook: DonorHook = async () => [0];
    const off = new CpuSim({ ...pre, step: 1500 });
    await expect(applyBoundary(off, 1500, pondContext(pre), hook)).rejects.toThrow(/not a pond boundary of an arm that takes donors/);
    expect(off.reads).toBe(0);
    const cont = new CpuSim(worldAt(1000, { pondArm: "cont" }));
    await expect(applyBoundary(cont, 1000, pondContext(cont.ref.state), hook)).rejects.toThrow(/not a pond boundary of an arm that takes donors/);
    expect(cont.reads).toBe(0);
  });

  it("the refusal comes before a migration step reads or uploads", async () => {
    let reads = 0, uploads = 0;
    const sim = { cfg: { ...pre.cfg, pondPeriod: undefined, migrationPeriod: 1000 } as WorldConfig, readState: async () => (reads++, pre), upload: () => void uploads++ };
    await expect(applyBoundary(sim, 1000, null, [0])).rejects.toThrow(/not a pond boundary/);
    await expect(applyBoundary(sim, 1000, null, async () => [0])).rejects.toThrow(/not a pond boundary/);
    expect([reads, uploads]).toEqual([0, 0]);
  });
});

describe("makeDonorHook", () => {
  const cfg = worldAt(1000, { pondArm: "scaf" }).cfg;
  const pre = worldAt(1000, { pondArm: "scaf" });
  const suggested = pondDonors(pre, 1, "scaf", 8);
  const mem = () => {
    const files = new Map<string, string>();
    return { files, sink: { appendText: async (p: string, t: string) => void files.set(p, (files.get(p) ?? "") + t) } };
  };
  const note = (): PickNote => ({ by: "none", suggested: [] });
  const picker = (answer: (req: PickRequest) => number[] | Promise<number[]>, name = "t"): Picker => ({ name, pick: async (req) => answer(req) });
  const failedLines = (text: string | undefined) => (text ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  it("recorded: validated by pondPickError alone, by 'recorded', no picker consulted, any count", async () => {
    const m = mem(), n = note();
    const asked = vi.fn(async () => [0]);
    const hook = makeDonorHook({ cfg, recorded: new Map([[1000, { step: 1000, cycle: 1, donors: [3, 1, 0] }]]), picker: { name: "t", pick: asked }, sink: m.sink, note: n });
    expect(await hook(pre, 1)).toEqual([3, 1, 0]);
    expect(asked).not.toHaveBeenCalled();
    expect(n.by).toBe("recorded");
    expect(n.suggested).toEqual(suggested);
    expect(n.request?.max).toBe(suggested.length);
  });

  it("live: the picker's answer, by its name; the request is a detached snapshot with the arm's donors", async () => {
    const m = mem(), n = note();
    let seen: Pick<PickRequest, "step" | "cycle" | "k" | "occupied" | "max"> | undefined;
    const hook = makeDonorHook({
      cfg,
      recorded: new Map(),
      picker: picker((req) => {
        seen = { step: req.step, cycle: req.cycle, k: req.k, occupied: [...req.occupied], max: req.max };
        req.pre.cells.fill(0);
        req.pre.cfg.pondK = 3;
        req.suggested.length = 0;
        req.max = 99;
        return [2];
      }, "who"),
      sink: m.sink,
      note: n,
    });
    expect(await hook(pre, 1)).toEqual([2]);
    expect(n.by).toBe("who");
    expect(n.suggested).toEqual(suggested);
    expect(seen!.step).toBe(1000);
    expect(seen!.cycle).toBe(1);
    expect(seen!.k).toBe(8);
    expect(seen!.occupied).toEqual([0, 1, 2, 3]);
    expect(seen!.max).toBe(suggested.length);
    // The picker scribbled over its snapshot; the runner's state and config are untouched.
    expect(stateHash(pre)).toBe(stateHash(worldAt(1000, { pondArm: "scaf" })));
    expect(pre.cfg.pondK).toBe(8);
    expect(m.files.has(PICKS_FILE)).toBe(false);
  });

  it("nothing occupied: undefined, by 'none', the picker is not asked, a recorded [] is fine", async () => {
    const dead = emptied(pre, []);
    const m = mem(), n = note();
    const asked = vi.fn(async () => [0]);
    const hook = makeDonorHook({ cfg, recorded: new Map([[1000, { step: 1000, cycle: 1, donors: [] }]]), picker: { name: "t", pick: asked }, sink: m.sink, note: n });
    expect(await hook(dead, 1)).toBeUndefined();
    expect(n).toEqual({ by: "none", suggested: [], request: undefined });
    expect(asked).not.toHaveBeenCalled();
    const bare = makeDonorHook({ cfg, recorded: new Map(), sink: m.sink, note: note() });
    expect(await bare(dead, 1)).toBeUndefined();
  });

  const failures: [string, Parameters<typeof makeDonorHook>[0]["recorded"], Picker | undefined, RegExp, WorldState?][] = [
    ["a throwing picker", new Map(), picker(() => { throw new Error("model fell over"); }), /pond cycle 1 at t=1000: model fell over/],
    ["a rejecting picker", new Map(), picker(async () => { throw new Error("timed out"); }), /timed out/],
    ["an empty answer", new Map(), picker(() => []), /at least one pond/],
    ["a repeated pond", new Map(), picker(() => [1, 1]), /repeat/],
    ["an out-of-range pond", new Map(), picker(() => [7]), /not an occupied pond/],
    ["too many donors", new Map(), picker(() => [0, 1, 2]), /at most 1/],
    ["an empty pond", new Map(), picker(() => [3]), /pond 3 is not an occupied pond/, emptied(pre, [0, 1, 2])],
    ["a recorded pick of an empty pond", new Map([[1000, { step: 1000, cycle: 1, donors: [3] }]]), undefined, /pond 3 is not an occupied pond/, emptied(pre, [0, 1, 2])],
    ["a recorded pick of a repeat", new Map([[1000, { step: 1000, cycle: 1, donors: [2, 2] }]]), undefined, /repeat/],
    ["a recorded donor where nothing is occupied", new Map([[1000, { step: 1000, cycle: 1, donors: [0] }]]), undefined, /no pond is occupied/, emptied(pre, [])],
    ["a recorded entry for another cycle", new Map([[1000, { step: 1000, cycle: 2, donors: [0] }]]), undefined, /says cycle 2/],
    ["a missing record and no picker", new Map(), undefined, /no recorded pick for this boundary and no picker/],
  ];
  for (const [name, recorded, p, message, state] of failures) {
    it(`${name}: appends a failed line and throws PickError`, async () => {
      const m = mem();
      const hook = makeDonorHook({ cfg, recorded, picker: p, sink: m.sink, note: note() });
      const err = await hook(state ?? pre, 1).catch((e) => e);
      expect(err).toBeInstanceOf(PickError);
      expect((err as Error).message).toMatch(message);
      const lines = failedLines(m.files.get(PICKS_FILE));
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatchObject({ kind: "failed", step: 1000, cycle: 1 });
      expect(parsePickLog(m.files.get(PICKS_FILE)!)).toEqual([]);
    });
  }

  it("a picker that rejects with null, undefined or a string still gets its failed line", async () => {
    for (const thrown of [null, undefined, "no model"]) {
      const m = mem();
      const hook = makeDonorHook({ cfg, recorded: new Map(), picker: picker(() => { throw thrown; }, "who"), sink: m.sink, note: note() });
      const err = await hook(pre, 1).catch((e) => e);
      expect(err).toBeInstanceOf(PickError);
      expect((err as Error).message).toBe(`pond cycle 1 at t=1000: ${String(thrown)}`);
      expect(failedLines(m.files.get(PICKS_FILE))).toEqual([{ step: 1000, kind: "failed", cycle: 1, by: "who", error: String(thrown) }]);
    }
  });

  it("a lab manifest is sparse: with implicitRule and no picker, a boundary without an entry takes the rule's donors", async () => {
    const m = mem(), n = note();
    const hook = makeDonorHook({ cfg, recorded: new Map(), implicitRule: true, sink: m.sink, note: n });
    expect(await hook(pre, 1)).toEqual(suggested);
    expect(n.by).toBe("rule(implicit)");
    expect(m.files.has(PICKS_FILE)).toBe(false);
  });

  it("refuses an arm that chooses no donors", async () => {
    const m = mem();
    const hook = makeDonorHook({ cfg: { ...cfg, pondArm: "cont" }, recorded: new Map(), picker: picker(() => [0]), sink: m.sink, note: note() });
    await expect(hook(pre, 1)).rejects.toThrow(PickError);
  });
});

describe("the picked spec", () => {
  const picked: RunSpec = { ...spec, picked: true };
  it("validateSpec: picked is true or absent, and excludes branch and metapopulation", () => {
    expect(validateSpec(picked)).toEqual([]);
    expect(validateSpec({ ...spec, picked: false as unknown as true }).join()).toMatch(/picked must be true or absent/);
    expect(validateSpec({ ...picked, metapopulation: { salt: 1, migrantCount: 1, ringNamespace: 1 } }).join()).toMatch(/metapopulation/);
    expect(validateSpec({ ...picked, condition: "pond-nat", branch: { source: "x", sourceHash: "0123456789abcdef", boundary: 1 } }).join()).toMatch(/cannot be a branch run/);
  });

  it("pickedConfigError: a pond config of arm scaf, rand or breed", () => {
    expect(pickedConfigError(picked, specConfig(picked))).toBeNull();
    expect(pickedConfigError(spec, specConfig(spec))).toBeNull();
    expect(pickedConfigError({ ...picked, condition: "pond-cont" }, specConfig({ ...picked, condition: "pond-cont" }))).toMatch(/arm scaf, rand or breed.*"cont"/);
    expect(pickedConfigError({ ...picked, condition: "pond-nat" }, specConfig({ ...picked, condition: "pond-nat" }))).toMatch(/"nat"/);
    const spots: RunSpec = { ...picked, presetId: "spots" };
    expect(pickedConfigError(spots, specConfig(spots))).toMatch(/needs a pond config/);
  });

  it("sameCompletedRun: picked: false is the unpicked spec, a picked run is never the unpicked one", () => {
    const done = (s: RunSpec) => ({ spec: JSON.parse(JSON.stringify(s)), ruleVersion: RULE_VERSION, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION, cfg: specConfig(s) });
    expect(sameCompletedRun(done(spec), picked)).toBe(false);
    expect(sameCompletedRun(done(picked), spec)).toBe(false);
    expect(sameCompletedRun(done(picked), picked)).toBe(true);
    expect(sameCompletedRun(done(spec), { ...spec, picked: false as unknown as true })).toBe(true);
  });
});

describe("the island refuses a picked spec", () => {
  afterEach(() => vi.unstubAllGlobals());
  const picked: RunSpec = { ...spec, picked: true };
  it("specRefusal: null for an ordinary spec, a message for a picked one", () => {
    expect(specRefusal(spec)).toBeNull();
    expect(specRefusal(picked)).toMatch(/picked run.*not distributed/);
  });
  it("refuses a task whose spec is picked before fetching anything else", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      paths.push(path);
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") return json({ kind: "run", lease: "L", segment: { id: "seg-1", run: "pk/ponds-small/treatment/seed-1", index: 1, startStep: 1000, steps: 1000 }, spec: picked, startFrom: "seg-0", startHash: "0123456789abcdef" });
      throw new Error(`unexpected ${path}`);
    });
    await expect(runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks: 1 })).rejects.toThrow(/refusing pk\/ponds-small\/treatment\/seed-1 #1: .*picked.*not distributed/);
    expect(paths).toEqual(["/api/islands", "/api/next"]);
  });
});

describe("pressures: the score the rule ranks donors by", () => {
  const breedCfg = { pondArm: "breed", pondScore: "mass" } as const;
  // Pond 2 is the fullest and the biggest-bodied; without it "mass" and "body" pick different ponds (checked below).
  const base = worldAt(1000, breedCfg);
  const pre = emptied(base, [0, 1, 3]);
  const cfg = pre.cfg;
  const press = (step: number, cycle: number, score: PressureEntry["score"]): PressureEntry => ({ step, cycle, score });
  const mem = () => {
    const files = new Map<string, string>();
    return { files, sink: { appendText: async (p: string, t: string) => void files.set(p, (files.get(p) ?? "") + t) } };
  };

  it("the world separates the scores (so the cases below are not vacuous)", () => {
    expect(pondDonors(pre, 1, "breed", cfg.pondK!, "mass")).not.toEqual(pondDonors(pre, 1, "breed", cfg.pondK!, "body"));
  });

  it("activePondScore: none governs, the latest with cycle <= b wins, list order breaks ties", () => {
    expect(activePondScore([], 3)).toBeUndefined();
    const list = [press(5000, 2, "drive"), press(10000, 3, "body"), press(10000, 3, "seed")];
    expect(activePondScore(list, 1)).toBeUndefined();
    expect(activePondScore(list, 2)).toBe("drive");
    expect(activePondScore(list, 3)).toBe("seed");
    expect(activePondScore(list, 9)).toBe("seed");
    expect(activePondScore([press(0, 1, "reach")], 1)).toBe("reach");
  });

  it("pressureCycleOf: a waiting cycle's own, else the next boundary", () => {
    expect(pressureCycleOf(5000, 5000, true)).toBe(1);
    expect(pressureCycleOf(5000, 5000, false)).toBe(2);
    expect(pressureCycleOf(7000, 5000, false)).toBe(2);
    expect(pressureCycleOf(0, 5000, false)).toBe(1);
    expect(pressureCycleOf(4999, 5000, false)).toBe(1);
  });

  it("pressureEntriesError: the observed history of a breeder world, or why not", () => {
    const c = { pondPeriod: 1000, pondArm: "breed" } as const;
    expect(pressureEntriesError([], c)).toBeNull();
    expect(pressureEntriesError([press(0, 1, "drive"), press(1000, 1, "body"), press(1000, 2, "seed"), press(1500, 2, "drive+seed")], c)).toBeNull();
    expect(pressureEntriesError([press(1500, 2, "mass")], c)).toBeNull();
    // not a breeder world, not a pond world
    expect(pressureEntriesError([press(1, 1, "mass")], { pondPeriod: 1000, pondArm: "scaf" })).toMatch(/pond arm breed.*"scaf"/);
    expect(pressureEntriesError([press(1, 1, "mass")], {})).toMatch(/needs a pond config/);
    // the cycle rule, both ways at a boundary step and mid-cycle
    expect(pressureEntriesError([press(2000, 2, "mass")], c)).toBeNull();
    expect(pressureEntriesError([press(2000, 3, "mass")], c)).toBeNull();
    expect(pressureEntriesError([press(2000, 1, "mass")], c)).toMatch(/pressure 0 at t=2000 says cycle 1.*cycle 2 or 3.*not the observed history/);
    expect(pressureEntriesError([press(2000, 4, "mass")], c)).toMatch(/cycle 2 or 3/);
    expect(pressureEntriesError([press(1500, 1, "mass")], c)).toMatch(/cycle 2: not the observed history/);
    expect(pressureEntriesError([press(1500, 3, "mass")], c)).toMatch(/not the observed history/);
    // step 0 governs cycle 1 only: there is no cycle 0 to be waiting
    expect(pressureEntriesError([press(0, 1, "mass")], c)).toBeNull();
    expect(pressureEntriesError([press(0, 0, "mass")], c)).toMatch(/cycle must be a positive integer/);
    expect(pressureEntriesError([press(0, 2, "mass")], c)).toMatch(/cycle 1: not the observed history/);
    // order
    expect(pressureEntriesError([press(2500, 3, "mass"), press(2000, 3, "body")], c)).toMatch(/pressure 1 \(t=2000\) follows a pressure at t=2500/);
    expect(pressureEntriesError([press(1000, 2, "mass"), press(1000, 1, "body")], c)).toMatch(/cycle order/);
    // shapes and scores
    expect(pressureEntriesError([press(1000, 1, "mass+mass" as PressureEntry["score"])], c)).toMatch(/pressure 0: pondScore must be/);
    expect(pressureEntriesError([press(1000, 1, "nope" as PressureEntry["score"])], c)).toMatch(/pondScore must be/);
    expect(pressureEntriesError([{ step: -1, cycle: 1, score: "mass" }], c)).toMatch(/step must be a non-negative integer/);
    expect(pressureEntriesError([{ step: 1.5, cycle: 1, score: "mass" }], c)).toMatch(/step must be a non-negative integer/);
    expect(pressureEntriesError([null as unknown as PressureEntry], c)).toMatch(/not an object/);
  });

  it("pressureLogError: [pressure for b]*, pick(b)?, [pressure for b+1 | lesion | feed]*, with pick(b) after any pressure for b", () => {
    const P = 1000;
    const pk = (step: number) => ({ step, kind: "pick" });
    const pr = (step: number, cycle: number) => ({ step, kind: "pressure", cycle });
    const ls = (step: number) => ({ step, kind: "lesion" });
    expect(pressureLogError([], P)).toBeNull();
    expect(pressureLogError([pr(1000, 1), pk(1000), ls(1000), pr(1000, 2)], P)).toBeNull();
    expect(pressureLogError([pr(1000, 1), pr(1000, 1), pk(1000), pr(1000, 2), pr(1000, 2)], P)).toBeNull();
    expect(pressureLogError([pk(1000), ls(1000), pk(2000), pr(2000, 3)], P)).toBeNull();
    expect(pressureLogError([pr(400, 1), ls(400), pr(400, 1), pk(1000)], P)).toBeNull(); // mid-cycle steps: no boundary at 400
    expect(pressureLogError([ls(900), pk(1000), pr(1000, 2)], P)).toBeNull();
    // a pressure for cycle b after the pick of cycle b
    expect(pressureLogError([pk(1000), pr(1000, 1)], P)).toMatch(/^interventions\[1\] \(pressure at t=1000\) for cycle 1 comes after the pick for cycle 1: a pressure for cycle 1 must come before the pick for cycle 1$/);
    // ... or after a lesion or a later pressure of that step
    expect(pressureLogError([ls(1000), pr(1000, 1)], P)).toMatch(/follows a lesion, feed or later pressure at the same step/);
    expect(pressureLogError([pr(1000, 2), pr(1000, 1)], P)).toMatch(/follows a lesion, feed or later pressure at the same step/);
    // a pick after a lesion, a feed, or a pressure for the next cycle
    expect(pressureLogError([ls(1000), pk(1000)], P)).toMatch(/^interventions\[1\] \(pick at t=1000\) follows a lesion or feed at the same step/);
    expect(pressureLogError([{ step: 1000, kind: "feed" }, pk(1000)], P)).toMatch(/follows a lesion or feed at the same step/);
    expect(pressureLogError([pr(1000, 2), pk(1000)], P)).toMatch(/^interventions\[1\] \(pick at t=1000\) follows a pressure for the next cycle at the same step/);
    // each step starts afresh
    expect(pressureLogError([ls(1000), pk(2000)], P)).toBeNull();
    // a pressure for cycle b is followed by the pick of cycle b: at the end of the log, at the next step, or before a lesion
    expect(pressureLogError([pr(1000, 1)], P)).toMatch(/^interventions\[0\] \(pressure at t=1000\) is for cycle 1, but no pick for that cycle follows it/);
    expect(pressureLogError([pr(1000, 1), pr(1000, 1)], P)).toMatch(/^interventions\[0\] \(pressure at t=1000\) is for cycle 1, but no pick/);
    expect(pressureLogError([pr(1000, 1), ls(1000)], P)).toMatch(/^interventions\[0\] \(pressure at t=1000\) is for cycle 1, but no pick/);
    expect(pressureLogError([pr(1000, 1), pk(2000)], P)).toMatch(/^interventions\[0\] \(pressure at t=1000\) is for cycle 1, but no pick/);
    // a pressure for the next cycle needs no pick at its step
    expect(pressureLogError([pr(1000, 2)], P)).toBeNull();
  });

  it("ruleDonors: the pressure's score, else the config's", () => {
    const k = cfg.pondK!;
    expect(ruleDonors(pre, 1, cfg, [])).toEqual(pondDonors(pre, 1, "breed", k, "mass"));
    expect(ruleDonors(pre, 1, cfg, [press(0, 1, "body")])).toEqual(pondDonors(pre, 1, "breed", k, "body"));
    expect(ruleDonors(pre, 1, cfg, [press(0, 2, "body")])).toEqual(pondDonors(pre, 1, "breed", k, "mass"));
  });

  it("pressureHook: undefined when none governs, the config's own score governs or no pond is occupied; reads the list at call time", async () => {
    const list: PressureEntry[] = [];
    const hook = pressureHook(cfg, () => list);
    expect(await hook(pre, 1)).toBeUndefined();
    list.push(press(0, 2, "body"));
    expect(await hook(pre, 1)).toBeUndefined(); // governs cycle 2 on
    list.push(press(0, 1, "mass"));
    expect(await hook(pre, 1)).toBeUndefined(); // the config's own score: the arm's cycle as it is
    list.push(press(0, 1, "body"));
    expect(await hook(pre, 1)).toEqual(pondDonors(pre, 1, "breed", cfg.pondK!, "body"));
    expect(await hook(emptied(pre, []), 1)).toBeUndefined(); // nothing occupied
    // a world that is not a breeder: never
    expect(await pressureHook({ ...cfg, pondArm: "scaf" }, () => list)(pre, 1)).toBeUndefined();
  });

  it("makeDonorHook with pressures: the pressured rule's donors are suggested and answered; a record still wins", async () => {
    const m = mem(), n: PickNote = { by: "none", suggested: [] };
    const pressures = [press(0, 1, "body")];
    const want = pondDonors(pre, 1, "breed", cfg.pondK!, "body");
    expect(want).not.toEqual(pondDonors(pre, 1, "breed", cfg.pondK!, "mass"));
    const hook = makeDonorHook({ cfg, recorded: new Map(), implicitRule: true, sink: m.sink, note: n, pressures });
    expect(await hook(pre, 1)).toEqual(want);
    expect(n.by).toBe("rule(implicit)");
    expect(n.suggested).toEqual(want);
    // a picker sees the pressured rule's donors and count
    let seen: PickRequest | undefined;
    const picker: Picker = { name: "t", pick: async (req) => ((seen = req), [...req.suggested]) };
    const n2: PickNote = { by: "none", suggested: [] };
    expect(await makeDonorHook({ cfg, recorded: new Map(), picker, sink: m.sink, note: n2, pressures })(pre, 1)).toEqual(want);
    expect(seen!.suggested).toEqual(want);
    expect(seen!.max).toBe(want.length);
    // the record wins where it has an entry, validated as ever
    const n3: PickNote = { by: "none", suggested: [] };
    const other = [1];
    expect(await makeDonorHook({ cfg, recorded: new Map([[1000, { step: 1000, cycle: 1, donors: other }]]), implicitRule: true, sink: m.sink, note: n3, pressures })(pre, 1)).toEqual(other);
    expect(n3.by).toBe("recorded");
    expect(n3.suggested).toEqual(want);
    // an empty world is the arm's own empty cycle, not a recorded-list failure
    const n4: PickNote = { by: "x", suggested: [9] };
    expect(await makeDonorHook({ cfg, recorded: new Map(), implicitRule: true, sink: m.sink, note: n4, pressures })(emptied(pre, []), 1)).toBeUndefined();
    expect(n4).toMatchObject({ by: "none", suggested: [] });
  });

  it("with no pressures the hook is exactly what it was", async () => {
    const m = mem(), n: PickNote = { by: "none", suggested: [] };
    const want = pondDonors(pre, 1, "breed", cfg.pondK!, "mass");
    for (const pressures of [undefined, []] as const) {
      const hook = makeDonorHook({ cfg, recorded: new Map(), implicitRule: true, sink: m.sink, note: n, pressures });
      expect(await hook(pre, 1)).toEqual(want);
      expect(n).toMatchObject({ by: "rule(implicit)", suggested: want });
    }
  });

  it("a pressured boundary is the pond cycle with the computed donors, bit for bit, and writes the config's columns", async () => {
    const pressures = [press(0, 1, "body")];
    const donors = pondDonors(pre, 1, "breed", cfg.pondK!, "body");
    const m = mem();
    const hook = makeDonorHook({ cfg, recorded: new Map(), implicitRule: true, sink: m.sink, note: { by: "none", suggested: [] }, pressures });
    const sim = new CpuSim(pre);
    const res = await applyBoundary(sim, 1000, pondContext(pre), hook);
    const want = applyPondCycle(pre, 1, "breed", cfg.pondK!, pondMatter(pre), pondCensus, "mass", donors);
    expect(res.ponds!.donors).toEqual(donors);
    expect(res.ponds!.rows).toEqual(want.rows);
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
    // the unpressured arm's cycle has the same columns (the score columns are the config's) and a different state
    const plain = new CpuSim(pre);
    const arm = await applyBoundary(plain, 1000, pondContext(pre));
    expect(Object.keys(res.ponds!.rows[0])).toEqual(Object.keys(arm.ponds!.rows[0]));
    expect(arm.ponds!.donors).not.toEqual(donors);
    expect(stateHash(await plain.readState())).not.toBe(stateHash(want.state));
    // pressureHook is the same boundary
    const viaHook = new CpuSim(pre);
    await applyBoundary(viaHook, 1000, pondContext(pre), pressureHook(cfg, () => pressures));
    expect(stateHash(await viaHook.readState())).toBe(stateHash(want.state));
  });

  it("a boundary with no pressure is the arm's cycle with no hook at all", async () => {
    const sim = new CpuSim(pre);
    const hook = pressureHook(cfg, () => []);
    await applyBoundary(sim, 1000, pondContext(pre), hook);
    const want = applyPondCycle(pre, 1, "breed", cfg.pondK!, pondMatter(pre), pondCensus, "mass");
    expect(stateHash(await sim.readState())).toBe(stateHash(want.state));
  });

  it("RunSpec.pressures: shape, picked, config and the last step", () => {
    const ok: RunSpec = { ...spec, picked: true, pressures: [press(1000, 1, "body"), press(2000, 3, "mass")] };
    expect(validateSpec(ok)).toEqual([]);
    expect(validateSpec({ ...spec, pressures: ok.pressures }).join()).toMatch(/a pressured run is a picked run/);
    expect(validateSpec({ ...ok, pressures: [] }).join()).toMatch(/non-empty array/);
    expect(validateSpec({ ...ok, pressures: "x" as never }).join()).toMatch(/non-empty array/);
    expect(validateSpec({ ...ok, pressures: [null as never] }).join()).toMatch(/pressures\[0\] must be an object/);
    expect(validateSpec({ ...ok, pressures: [{ step: 1, cycle: 1 } as never] }).join()).toMatch(/exactly the keys step, cycle and score/);
    expect(validateSpec({ ...ok, pressures: [{ step: 1, cycle: 1, score: "mass", kind: "pressure" } as never] }).join()).toMatch(/exactly the keys/);
    expect(validateSpec({ ...ok, pressures: [{ step: -1, cycle: 1, score: "mass" }] }).join()).toMatch(/step must be a non-negative integer/);
    expect(validateSpec({ ...ok, pressures: [{ step: 1, cycle: 0, score: "mass" }] }).join()).toMatch(/cycle must be a positive integer/);
    expect(validateSpec({ ...ok, pressures: [{ step: 1, cycle: 1, score: 7 as never }] }).join()).toMatch(/score must be a string/);
    expect(validateSpec({ ...ok, pressures: [press(2000, 3, "mass"), press(1000, 2, "body")] }).join()).toMatch(/step 1000 follows step 2000/);
    // the world-dependent half
    const cfgOf = (extra: Partial<WorldConfig>) => worldAt(0, extra).cfg;
    expect(pressuresConfigError({ steps: 4000 }, cfgOf({}))).toBeNull();
    expect(pressuresConfigError({ steps: 4000, pressures: ok.pressures }, cfgOf({ pondArm: "breed", pondScore: "mass" }))).toBeNull();
    expect(pressuresConfigError({ steps: 4000, pressures: ok.pressures }, cfgOf({ pondArm: "scaf" }))).toMatch(/pond arm breed/);
    expect(pressuresConfigError({ steps: 1500, pressures: ok.pressures }, cfgOf({ pondArm: "breed", pondScore: "mass" }))).toMatch(/a pressure at t=2000 is after the run's last step \(1500\)/);
    expect(pressuresConfigError({ steps: 4000, pressures: [press(1000, 1, "body"), press(2000, 4, "mass")] }, cfgOf({ pondArm: "breed", pondScore: "mass" }))).toMatch(/not the observed history/);
  });

  it("run identity: a spec without pressures is the spec written before; with them it is another run", () => {
    const done = (s: RunSpec) => ({ spec: JSON.parse(JSON.stringify(s)), ruleVersion: RULE_VERSION, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION, cfg: specConfig(s) });
    const before: RunSpec = { ...spec, picked: true };
    const pressured: RunSpec = { ...before, pressures: [press(1000, 1, "body")] };
    expect(JSON.stringify({ ...before, pressures: undefined })).toBe(JSON.stringify(before));
    expect(sameCompletedRun(done(before), before)).toBe(true);
    expect(sameCompletedRun(done(before), { ...before, pressures: undefined })).toBe(true);
    expect(sameCompletedRun(done(before), pressured)).toBe(false);
    expect(sameCompletedRun(done(pressured), before)).toBe(false);
    expect(sameCompletedRun(done(pressured), pressured)).toBe(true);
  });

  it("the island refuses a pressured spec", () => {
    expect(specRefusal({ ...spec, pressures: [press(1000, 1, "body")] })).toMatch(/pressures.*not distributed/);
    expect(specRefusal({ ...spec, picked: true, pressures: [press(1000, 1, "body")] })).toMatch(/picked run/);
    expect(specRefusal(spec)).toBeNull();
  });
});
