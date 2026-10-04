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
