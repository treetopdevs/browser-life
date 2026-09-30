import { describe, expect, it } from "vitest";
import {
  bootstrapDiff,
  bootstrapDiffInDiff,
  bootstrapMean,
  bootstrapPairedDiffInDiff,
  censusFromSeriesLine,
  censusesFrom,
  completenessProblems,
  EXPECTED_GROUPS,
  emptyCensus,
  eventsByRole,
  extStatement,
  groupOf,
  m4CompletenessProblems,
  overallReading,
  readRun,
  reading,
  returnProfile,
  share,
  spacing,
  summariseStratum,
  variantRole,
  windowsOf,
  withoutRoleEvents,
  type PostFillEvent,
  type Census,
  type RunRecord,
  type Role,
  type StratumRow,
} from "../lib/recurrence.ts";

/** Censuses at steps 100 + 1000 i; each with 100 living cells and `spec(i)` giving role -> root -> cells. */
const mk = (n: number, spec: (i: number) => Partial<Record<Role, Record<string, number>>>): Census[] =>
  Array.from({ length: n }, (_, i) => {
    const c = emptyCensus(100 + 1000 * i);
    c.total = 100;
    for (const [role, byRoot] of Object.entries(spec(i)) as [Role, Record<string, number>][]) for (const [root, cells] of Object.entries(byRoot)) c.byRole[role].set(root, cells);
    return c;
  });
const same = (root: string) => root;

describe("windowsOf", () => {
  it("needs 5% share over a span of at least 1e5 steps (101 censuses)", () => {
    expect(windowsOf(mk(200, (i) => (i < 101 ? { phototroph: { a: 5 } } : {})), "phototroph")).toEqual([[0, 100]]);
    expect(windowsOf(mk(200, (i) => (i < 100 ? { phototroph: { a: 5 } } : {})), "phototroph")).toEqual([]);
    expect(windowsOf(mk(200, () => ({ phototroph: { a: 4 } })), "phototroph")).toEqual([]);
  });
  it("splits a window at one census below 5%", () => {
    const dc = mk(300, (i) => (i === 150 ? {} : { mixed: { a: 6 } }));
    expect(windowsOf(dc, "mixed")).toEqual([[0, 149], [151, 299]]);
  });
});

describe("readRun", () => {
  it("a role filled once is one fill and no post-fill events", () => {
    const r = readRun(mk(400, () => ({ phototroph: { a: 10 } })), same);
    expect(r.fillCount).toBe(1);
    expect(r.atStartFills).toBe(1);
    expect(r.postFill).toBe(0);
  });
  it("a return needs the role to stay below 5% for at least 1e5 steps, and to start at step >= 2e5", () => {
    // window 0..120, lost 121..270 (gap from census 120 to 271 = 151e3), back 271..399
    const dc = mk(400, (i) => (i <= 120 || i >= 271 ? { chemotroph: { a: 8 } } : {}));
    const r = readRun(dc, same);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ role: "chemotroph", kind: "return", start: 271_100, gap: 151_000 });
    expect(r.returns).toBe(1);
    expect(r.replacements).toBe(0);
  });
  it("a gap shorter than 1e5 with the same holder is a flicker, not an event", () => {
    const dc = mk(400, (i) => (i >= 150 && i < 200 ? {} : { chemotroph: { a: 8 } }));
    expect(readRun(dc, same).postFill).toBe(0);
  });
  it("a new clade holding an already filled role after a short gap is a replacement; the old clade returning is a flicker", () => {
    // clade a holds 0..149, clade b holds 200..399 after a 50e3 gap; the dip makes two windows
    const dc = mk(400, (i) => (i < 150 ? { mixed: { a: 8 } } : i >= 200 ? { mixed: { b: 8 } } : {}));
    const r = readRun(dc, same);
    expect(r.events.map((e) => e.kind)).toEqual(["replacement"]);
    expect(r.events[0].holder).toBe("b");
  });
  it("founder roots with identical genomes are one clade", () => {
    const dc = mk(400, (i) => (i < 150 ? { mixed: { a: 8 } } : i >= 200 ? { mixed: { b: 8 } } : {}));
    expect(readRun(dc, () => "G").postFill).toBe(0);
    expect(readRun(dc, () => "G").clades).toBe(1);
  });
  it("windows k >= 2 that start before 2e5 are early re-entries, not counted", () => {
    // clade a holds 0..100; clade b holds 102..250 after a 2e3 gap: a replacement, but it starts at step 102,100 < 2e5
    const swap = mk(400, (i) => (i <= 100 ? { phototroph: { a: 9 } } : i >= 102 && i <= 250 ? { phototroph: { b: 9 } } : {}));
    const r = readRun(swap, same);
    expect(r.earlyReentries).toBe(1);
    expect(r.postFill).toBe(0);
  });
  it("a flicker (same holder, gap < 1e5) that starts before 2e5 is an early re-entry", () => {
    // clade a holds 0..100, dips 101..150 (gap 51e3), holds again 151..251: same holder, so no event kind, but it starts at 151,100 < 2e5
    const dc = mk(400, (i) => (i <= 100 || (i >= 151 && i <= 251) ? { phototroph: { a: 9 } } : {}));
    const r = readRun(dc, same);
    expect(r.earlyReentries).toBe(1);
    expect(r.postFill).toBe(0);
  });
  it("a flicker that starts at or after 2e5 is not an event and not an early re-entry", () => {
    const dc = mk(500, (i) => (i <= 200 || (i >= 251 && i <= 400) ? { phototroph: { a: 9 } } : {}));
    const r = readRun(dc, same);
    expect(r.earlyReentries).toBe(0);
    expect(r.postFill).toBe(0);
  });
  it("mixedInactiveShare is inactive mixed cells over mixed-role cells across all censuses", () => {
    const dc = mk(2, () => ({ mixed: { a: 20 } }));
    dc[0].inactiveMixed = 10;
    expect(readRun(dc, same).mixedInactiveShare).toBe(10 / 40);
    expect(readRun(mk(2, () => ({ phototroph: { a: 20 } })), same).mixedInactiveShare).toBeNull();
  });
  it("a mixed post-fill event carries the inactive share of its own window; other roles carry none", () => {
    const dc = mk(400, (i) => (i <= 120 || i >= 271 ? { mixed: { a: 8 }, chemotroph: { b: 8 } } : {}));
    dc[300].inactiveMixed = 4;
    dc[50].inactiveMixed = 8; // outside the event window
    const r = readRun(dc, same);
    const mixed = r.events.find((e) => e.role === "mixed")!;
    expect(mixed.inactiveShare).toBe(4 / (129 * 8));
    expect(r.events.find((e) => e.role === "chemotroph")!.inactiveShare).toBeUndefined();
  });
  it("a role first qualifying at step >= 2e5 is a late fill, not a post-fill event", () => {
    const dc = mk(500, (i) => (i >= 300 ? { decomposer: { a: 7 } } : { mixed: { a: 7 } }));
    const r = readRun(dc, same);
    expect(r.fills.find((f) => f.role === "decomposer")).toMatchObject({ late: true, atStart: false });
    expect(r.lateFills).toBe(1);
    expect(r.atStartFills).toBe(1);
    expect(r.postFill).toBe(0);
  });
});

describe("censusesFrom", () => {
  it("groups rows by step, sums cells, and attributes to roots", async () => {
    async function* rows() {
      yield { step: "100", lineage: "0:1", cells: "10", role: "mixed" };
      yield { step: "100", lineage: "5:1", cells: "5", role: "mixed" };
      yield { step: "1100", lineage: "5:1", cells: "7", role: "phototroph" };
    }
    const dc = await censusesFrom(rows(), (l) => (l === "5:1" ? "0:1" : l));
    expect(dc).toHaveLength(2);
    expect(dc[0].total).toBe(15);
    expect(dc[0].byRole.mixed.get("0:1")).toBe(15);
    expect(dc[1].byRole.phototroph.get("0:1")).toBe(7);
  });
  it("throws on a descending step and continues a census on an equal step", async () => {
    async function* bad() {
      yield { step: "1100", lineage: "0:1", cells: "1", role: "mixed" };
      yield { step: "100", lineage: "0:1", cells: "1", role: "mixed" };
    }
    await expect(censusesFrom(bad(), (l) => l)).rejects.toThrow(/out of order at step 100/);
    async function* ok() {
      yield { step: "100", lineage: "0:1", cells: "1", role: "mixed" };
      yield { step: "100", lineage: "0:2", cells: "2", role: "mixed" };
    }
    expect(await censusesFrom(ok(), (l) => l)).toHaveLength(1);
  });
  it("tallies inactive mixed cells from the flux columns", async () => {
    async function* rows() {
      yield { step: "100", lineage: "0:1", cells: "10", role: "mixed", photo: "0", grow: "0", decomp: "0" };
      yield { step: "100", lineage: "0:2", cells: "5", role: "mixed", photo: "3", grow: "0", decomp: "0" };
      yield { step: "100", lineage: "0:3", cells: "7", role: "phototroph", photo: "0", grow: "0", decomp: "0" };
    }
    const dc = await censusesFrom(rows(), (l) => l);
    expect(dc[0].inactiveMixed).toBe(10);
    expect(dc[0].total).toBe(22);
  });
  it("leaves inactiveMixed at zero when the flux columns are absent", async () => {
    async function* rows() {
      yield { step: "100", lineage: "0:1", cells: "10", role: "mixed" };
    }
    expect((await censusesFrom(rows(), (l) => l))[0].inactiveMixed).toBe(0);
  });
});

describe("spacing", () => {
  it("counts consecutive gaps that differ from the cadence", () => {
    expect(spacing(mk(5, () => ({})))).toEqual({ censuses: 5, firstStep: 100, lastStep: 4100, gaps: 0 });
    const missing = mk(5, () => ({})).filter((_, i) => i !== 2);
    expect(spacing(missing)).toEqual({ censuses: 4, firstStep: 100, lastStep: 4100, gaps: 1 });
    expect(spacing([])).toEqual({ censuses: 0, firstStep: null, lastStep: null, gaps: 0 });
  });
});

describe("bootstrap and the pre-stated reading", () => {
  it("is deterministic and brackets the mean", () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7];
    const a = bootstrapMean(x, 1), b = bootstrapMean(x, 1);
    expect(a).toEqual(b);
    expect(a.mean).toBe(3.5);
    expect(a.lo).toBeLessThanOrEqual(3.5);
    expect(a.hi).toBeGreaterThanOrEqual(3.5);
  });
  it("one-shot when the mutation arm is not above the no-mutation arm", () => {
    expect(reading(bootstrapDiff([0, 0, 0, 0, 0], [1, 1, 1], 1))).toBe("one-shot");
    expect(reading(bootstrapDiff([0, 0, 0, 0, 0], [0, 0, 0], 1))).toBe("one-shot");
  });
  it("recurring only when the 90% interval of the difference excludes zero", () => {
    expect(reading(bootstrapDiff([3, 3, 3, 3, 3], [0, 0, 0], 1))).toBe("recurring");
    expect(reading(bootstrapDiff([0, 6, 0, 6, 0], [0, 0, 0], 1))).toBe("unclear");
  });
  it("difference in differences is zero for equal effects", () => {
    const d = bootstrapDiffInDiff({ mut: [2, 2], nm: [1, 1] }, { mut: [5, 5], nm: [4, 4] }, 1);
    expect(d.mean).toBe(0);
    expect(d.lo).toBe(0);
    expect(d.hi).toBe(0);
  });
});

/** A run record with `postFill` events, in the mutation or no-mutation arm. */
const rec = (mutation: boolean, postFill: number, i: number): RunRecord => ({
  version: 2,
  id: `t-${i}`,
  family: "C",
  group: "g",
  mutation,
  seed: i,
  extinct: false,
  steps: 1_000_000,
  spacing: { censuses: 1, firstStep: 100, lastStep: 999_100, gaps: 0 },
  readout: { fills: [], events: [], earlyReentries: 0, returns: postFill, replacements: 0, postFill, fillCount: 0, lateFills: 0, atStartFills: 0, clades: 0, mixedInactiveShare: null },
  windows: { phototroph: [], chemotroph: [], decomposer: [], mixed: [] },
});
const stratum = (name: string, mut: number[], nm: number[]) => summariseStratum(name, [...mut.map((v, i) => rec(true, v, i)), ...nm.map((v, i) => rec(false, v, 100 + i))]);

describe("overallReading", () => {
  const recurring = stratum("primary", [3, 3, 3, 3, 3], [0, 0, 0]);
  const oneShot = stratum("one", [0, 0, 0, 0, 0], [1, 1, 1]);
  const empty = stratum("empty", [], []);
  it("gives the primary reading when every counting stratum agrees", () => {
    expect(recurring.reading).toBe("recurring");
    const o = overallReading(recurring, [stratum("a", [2, 2, 2, 2, 2], [0, 0, 0]), stratum("b", [4, 4, 4, 4, 4], [0, 0, 0])]);
    expect(o).toEqual({ reading: "recurring", disagree: [], empty: [] });
  });
  it("is mixed, naming the disagreeing strata, otherwise", () => {
    expect(oneShot.reading).toBe("one-shot");
    const o = overallReading(recurring, [stratum("a", [2, 2, 2, 2, 2], [0, 0, 0]), oneShot]);
    expect(o).toEqual({ reading: "mixed", disagree: ["one"], empty: [] });
  });
  it("ignores empty strata", () => {
    const o = overallReading(recurring, [empty, stratum("a", [2, 2, 2, 2, 2], [0, 0, 0])]);
    expect(o).toEqual({ reading: "recurring", disagree: [], empty: ["empty"] });
    const half = stratum("half", [1, 1], []);
    expect(overallReading(recurring, [half]).empty).toEqual(["half"]);
  });
  it("accepts minimal rows cast to StratumRow", () => {
    const row = (stratum: string, reading: StratumRow["reading"], runs = 5) => ({ stratum, reading, mutation: { runs }, noMutation: { runs } }) as unknown as StratumRow;
    expect(overallReading(row("p", "unclear"), [row("a", "unclear"), row("b", "recurring")])).toEqual({ reading: "mixed", disagree: ["b"], empty: [] });
    expect(overallReading(row("p", "unclear"), [row("a", "recurring", 0)])).toEqual({ reading: "unclear", disagree: [], empty: ["a"] });
  });
});

describe("bootstrapPairedDiffInDiff", () => {
  const g = (xm: number[], xn: number[], ym: number[], yn: number[]) => ({ x: { mut: xm, nm: xn }, y: { mut: ym, nm: yn } });
  it("is zero when x and y are identical for every founder", () => {
    const same4 = [g([1, 2, 3, 4, 5], [0, 1, 0], [1, 2, 3, 4, 5], [0, 1, 0]), g([2, 2, 2, 2, 2], [1, 1, 1], [2, 2, 2, 2, 2], [1, 1, 1])];
    const d = bootstrapPairedDiffInDiff(same4, 783);
    expect(d.n).toBe(2);
    expect(d.mean).toBe(0);
    // arms are resampled independently, so the interval brackets zero rather than collapsing onto it
    expect(d.lo).toBeLessThanOrEqual(0);
    expect(d.hi).toBeGreaterThanOrEqual(0);
  });
  it("is deterministic for a fixed seed and averages the per-founder differences", () => {
    const gs = [g([3, 3, 3, 3, 3], [0, 0, 0], [1, 1, 1, 1, 1], [0, 0, 0]), g([5, 5, 5, 5, 5], [1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1])];
    const a = bootstrapPairedDiffInDiff(gs, 783), b = bootstrapPairedDiffInDiff(gs, 783);
    expect(a).toEqual(b);
    expect(a.mean).toBe(3); // (3-0)-(1-0) = 2 and (5-1)-(1-1) = 4
  });
  it("drops founders with an empty arm and reports n = 0 when none remain", () => {
    const d = bootstrapPairedDiffInDiff([g([1], [1], [1], []), g([2, 2], [0], [1], [0])], 1);
    expect(d.n).toBe(1);
    expect(d.mean).toBe(1);
    const none = bootstrapPairedDiffInDiff([g([], [1], [1], [1])], 1);
    expect(none.n).toBe(0);
    expect(none.mean).toBeNaN();
  });
});

describe("completenessProblems", () => {
  /** The full 416-record set as the plans lay it out. */
  const full = (): RunRecord[] => {
    const out: RunRecord[] = [];
    for (const [family, groups] of Object.entries(EXPECTED_GROUPS) as [RunRecord["family"], string[]][]) {
      for (const group of groups) {
        for (let j = 0; j < 8; j++) out.push({ ...rec(j < 5, 0, out.length), id: `${family}-${out.length}`, family, group });
      }
    }
    return out;
  };
  it("is empty for 416 complete records", () => {
    const recs = full();
    expect(recs).toHaveLength(416);
    expect(completenessProblems(recs)).toEqual([]);
  });
  it("names a missing record, a stale version and a census gap", () => {
    const recs = full();
    const dropped = recs.splice(3, 1)[0];
    recs[10] = { ...recs[10], version: 1 };
    recs[20] = { ...recs[20], spacing: { ...recs[20].spacing, gaps: 2 } };
    const problems = completenessProblems(recs);
    expect(problems.some((p) => p.includes(`${dropped.family}:${dropped.group}`) && p.includes("mutation and"))).toBe(true);
    expect(problems.some((p) => p.includes(recs[10].id) && p.includes("version 1"))).toBe(true);
    expect(problems.some((p) => p.includes(recs[20].id) && p.includes("2 deep-census gaps"))).toBe(true);
  });
  it("accepts a short series only when the run went extinct, and flags a missing spacing field", () => {
    const recs = full();
    recs[0] = { ...recs[0], spacing: { censuses: 10, firstStep: 100, lastStep: 9_100, gaps: 0 } };
    expect(completenessProblems(recs).some((p) => p.includes(recs[0].id) && p.includes("not extinct"))).toBe(true);
    recs[0] = { ...recs[0], extinct: true };
    expect(completenessProblems(recs)).toEqual([]);
    recs[1] = { ...recs[1], spacing: undefined as unknown as RunRecord["spacing"] };
    expect(completenessProblems(recs)).toEqual([`${recs[1].id}: no spacing`]);
  });
});

describe("groupOf", () => {
  it("reads the plans' seed layouts", () => {
    expect(groupOf({ experiment: "founders-x-b", seed: 4_720_001 })).toEqual({ family: "B", group: "founder-0", mutation: true });
    expect(groupOf({ experiment: "founders-x-b", seed: 4_720_116 })).toEqual({ family: "B", group: "founder-11", mutation: false });
    expect(groupOf({ experiment: "founders-x-c", seed: 4_740_036 })).toEqual({ family: "C", group: "S5", mutation: false });
    expect(groupOf({ experiment: "founders-x-c", seed: 4_740_021 })).toEqual({ family: "C", group: "S4", mutation: true });
    expect(groupOf({ experiment: "solo", seed: 4_200_021, soloFounder: 2 })).toEqual({ family: "solo", group: "founder-2", mutation: true });
    expect(groupOf({ experiment: "founders-diag", seed: 4_210_238 })).toEqual({ family: "diag", group: "subject-23", mutation: false });
    expect(groupOf({ experiment: "founders-x-b", seed: 1 })).toBeNull();
  });
});

describe("censusesFrom with a role override", () => {
  it("a null role counts the cells in total but in no role", async () => {
    async function* rows() {
      yield { step: "100", lineage: "0:1", cells: "10", role: "mixed", photo: "0", grow: "0", decomp: "0" };
      yield { step: "100", lineage: "0:2", cells: "5", role: "phototroph", photo: "9", grow: "0", decomp: "0" };
    }
    const dc = await censusesFrom(rows(), (l) => l, (r) => (r.role === "mixed" ? null : (r.role as Role)));
    expect(dc[0].total).toBe(15);
    expect(share(dc[0], "mixed")).toBe(0);
    expect(share(dc[0], "phototroph")).toBeCloseTo(5 / 15, 12);
    expect(dc[0].inactiveMixed).toBe(0);
  });
  it("uses the override's role instead of the stored column, and is unchanged when absent", async () => {
    async function* rows() {
      yield { step: "100", lineage: "0:1", cells: "10", role: "mixed", photo: "5", grow: "5", decomp: "0" };
    }
    const base = await censusesFrom(rows(), (l) => l);
    expect(base[0].byRole.mixed.get("0:1")).toBe(10);
    const dc = await censusesFrom(rows(), (l) => l, variantRole("d0.5"));
    expect(dc[0].byRole.phototroph.get("0:1")).toBe(10);
    expect(dc[0].byRole.mixed.size).toBe(0);
  });
});

describe("variantRole", () => {
  it("d0.6 classifies as the stored role does, and a zero-flux row is mixed", () => {
    expect(variantRole("d0.6")({ photo: "10", grow: "0", decomp: "0" })).toBe("phototroph");
    expect(variantRole("d0.6")({ photo: "0", grow: "0", decomp: "0" })).toBe("mixed");
    expect(variantRole("d0.6")({ photo: "1", grow: "9", decomp: "0" })).toBe("chemotroph");
    expect(variantRole("d0.6")({ photo: "1", grow: "1", decomp: "9" })).toBe("decomposer");
  });
  it("d0.6-noinactive drops a zero-flux row to null and otherwise equals d0.6", () => {
    expect(variantRole("d0.6-noinactive")({ photo: "0", grow: "0", decomp: "0" })).toBeNull();
    expect(variantRole("d0.6-noinactive")({ photo: "10", grow: "0", decomp: "0" })).toBe("phototroph");
    expect(variantRole("d0.6-noinactive")({ photo: "5", grow: "5", decomp: "0" })).toBe("mixed");
  });
  it("the dominance cut moves the boundary: 0.5 >= 0.5 is a phototroph, 0.6 and 0.7 are mixed; a 0.65 share splits 0.6 and 0.7", () => {
    const even = { photo: "5", grow: "5", decomp: "0" };
    expect(variantRole("d0.5")(even)).toBe("phototroph");
    expect(variantRole("d0.6")(even)).toBe("mixed");
    expect(variantRole("d0.7")(even)).toBe("mixed");
    const split = { photo: "13", grow: "7", decomp: "0" };
    expect(variantRole("d0.6")(split)).toBe("phototroph");
    expect(variantRole("d0.7")(split)).toBe("mixed");
  });
});

describe("censusFromSeriesLine", () => {
  it("keeps the stored shares exactly, with one pseudo-root and total 1", () => {
    const c = censusFromSeriesLine({ step: 100, roles: { phototroph: 0.671, chemotroph: 0, decomposer: 0.328, mixed: 0.0004 } })!;
    expect(c.step).toBe(100);
    expect(c.total).toBe(1);
    expect(share(c, "decomposer")).toBe(0.328);
    expect(share(c, "phototroph")).toBe(0.671);
    expect(share(c, "mixed")).toBe(0.0004);
    expect([...c.byRole.phototroph.keys()]).toEqual(["all"]);
  });
  it("is null for a line without roles", () => {
    expect(censusFromSeriesLine({ step: 200 })).toBeNull();
  });
  it("feeds readRun: a role that drops out and returns after 1e5 steps is one return", () => {
    const dc: Census[] = [];
    for (let i = 0; i < 400; i++) {
      const on = i <= 120 || i >= 271;
      dc.push(censusFromSeriesLine({ step: 100 + 1000 * i, roles: { phototroph: on ? 0.4 : 0.01, chemotroph: 0, decomposer: 0, mixed: 0 } })!);
    }
    const r = readRun(dc, () => "all");
    expect(r.returns).toBe(1);
    expect(r.replacements).toBe(0);
  });
});

describe("m4CompletenessProblems and extStatement", () => {
  const rec = (family: "m4r" | "ext", condition: string, seed: number, variant: string): RunRecord => ({
    version: 2,
    id: `${family}-${condition}-${seed}-${variant}`,
    family,
    group: condition,
    mutation: condition === "treatment",
    seed,
    extinct: false,
    steps: family === "ext" ? 10_000_000 : 1_000_000,
    spacing: { censuses: 1, firstStep: 100, lastStep: family === "ext" ? 9_999_100 : 999_100, gaps: 0 },
    readout: {} as RunRecord["readout"],
    windows: {} as RunRecord["windows"],
    condition,
    variant,
    ...(family === "ext" ? { profile: { perBlock: Array.from({ length: 10 }, () => 0), late: 0 } } : {}),
  });
  const full = (): RunRecord[] => {
    const out: RunRecord[] = [];
    for (const [cond, n] of Object.entries({ treatment: 10, "no-mutation": 5, neutral: 20 })) {
      for (let s = 1; s <= n; s++) for (const v of ["d0.5", "d0.6", "d0.7", "d0.6-noinactive"]) out.push(rec("m4r", cond, s, v));
      for (let s = 101; s <= 105; s++) out.push(rec("ext", cond, s, "shares"));
    }
    return out;
  };
  it("a complete set of 155 records has no problems", () => {
    expect(full()).toHaveLength(155);
    expect(m4CompletenessProblems(full())).toEqual([]);
  });
  it("flags a missing record, a deep-census gap and a short horizon", () => {
    const missing = full().slice(1);
    expect(m4CompletenessProblems(missing).join("\n")).toMatch(/m4r:treatment:d0\.5: seeds \[2,3,4,5,6,7,8,9,10\]/);
    const gap = full();
    gap[3].spacing.gaps = 2;
    expect(m4CompletenessProblems(gap)).toEqual([`${gap[3].id}: 2 deep-census gaps`]);
    const short = full();
    short[100].spacing.lastStep = 499_100;
    expect(m4CompletenessProblems(short)[0]).toMatch(/last deep census at step 499100/);
  });
  it("flags a legacy-family record and a stale version", () => {
    const stale = full();
    stale[0].version = 1;
    stale.push({ ...rec("m4r", "treatment", 1, "d0.5"), id: "B-1", family: "B" });
    const p = m4CompletenessProblems(stale);
    expect(p).toContain("m4r-treatment-1-d0.5: record version 1 (want 2)");
    expect(p).toContain("B-1: unexpected family B");
  });
  it("words the extension's statement as fixed", () => {
    expect(extStatement("one-shot", "recurring")).toBe("no excess role returns over no-mutation at 10⁷ in the registered world");
    expect(extStatement("recurring", "one-shot")).toBe("excess role returns at 10⁷ (specific)");
    expect(extStatement("recurring", "unclear")).toBe("excess role returns at 10⁷ (specific)");
    expect(extStatement("recurring", "recurring")).toBe("recurring but not specific (neutral also recurs)");
    expect(extStatement("unclear", "one-shot")).toBe("unclear");
  });
});

describe("eventsByRole and withoutRoleEvents", () => {
  const ev = (role: Role, kind: PostFillEvent["kind"], start = 300_000): PostFillEvent => ({ role, kind, start, end: start + 100_000, holder: "all", gap: 100_000 });
  const run = (seed: number, events: PostFillEvent[]): RunRecord => {
    const returns = events.filter((e) => e.kind === "return").length;
    return {
      version: 2,
      id: `ext-treatment-${seed}`,
      family: "ext",
      group: "treatment",
      mutation: true,
      seed,
      extinct: false,
      steps: 10_000_000,
      spacing: { censuses: 1, firstStep: 100, lastStep: 9_999_100, gaps: 0 },
      readout: { events, returns, replacements: events.length - returns, postFill: events.length, fills: [], earlyReentries: 0, fillCount: 2, lateFills: 0, atStartFills: 1, clades: 1, mixedInactiveShare: null },
      windows: { phototroph: [], chemotroph: [], decomposer: [], mixed: [] },
    };
  };
  const rs = [run(102, [ev("chemotroph", "return"), ev("mixed", "return"), ev("mixed", "replacement")]), run(101, []), run(103, [ev("phototroph", "return")])];
  it("sums events per role and lists them per run in seed order; a kind filters", () => {
    const all = eventsByRole(rs);
    expect(all.total).toEqual({ phototroph: 1, chemotroph: 1, decomposer: 0, mixed: 2 });
    expect(all.perRun.map((p) => p.seed)).toEqual([101, 102, 103]);
    expect(all.perRun[1]).toEqual({ seed: 102, phototroph: 0, chemotroph: 1, decomposer: 0, mixed: 2 });
    const returns = eventsByRole(rs, "return");
    expect(returns.total).toEqual({ phototroph: 1, chemotroph: 1, decomposer: 0, mixed: 1 });
    expect(returns.perRun[0]).toEqual({ seed: 101, phototroph: 0, chemotroph: 0, decomposer: 0, mixed: 0 });
  });
  it("removes one role's events and recomputes returns, replacements and postFill without touching the input", () => {
    const r = withoutRoleEvents(rs[0], "mixed");
    expect(r.readout.events.map((e) => e.role)).toEqual(["chemotroph"]);
    expect(r.readout).toMatchObject({ returns: 1, replacements: 0, postFill: 1, fillCount: 2 });
    expect(rs[0].readout).toMatchObject({ returns: 2, replacements: 1, postFill: 3 });
    expect(withoutRoleEvents(rs[1], "mixed").readout).toMatchObject({ returns: 0, postFill: 0 });
  });
  it("the treatment-vs-no-mutation reading moves when mixed returns are the excess", () => {
    const tr = [run(101, [ev("mixed", "return"), ev("mixed", "return")]), run(102, [ev("mixed", "return")]), run(103, [ev("mixed", "return")])];
    const nm = [101, 102, 103].map((s) => ({ ...run(s, []), id: `ext-no-mutation-${s}`, group: "no-mutation", mutation: false }));
    expect(summariseStratum("with mixed", [...tr, ...nm]).reading).toBe("recurring");
    const row = summariseStratum("without mixed", [...tr.map((r) => withoutRoleEvents(r, "mixed")), ...nm]);
    expect(row.reading).toBe("one-shot");
    expect(row.diffReturns.mean).toBe(0);
  });
});

describe("returnProfile", () => {
  const ev = (start: number, kind: PostFillEvent["kind"] = "return"): PostFillEvent => ({ role: "phototroph", kind, start, end: start + 100_000, holder: "all", gap: 100_000 });
  it("counts returns per block by window start, and those at or after `late`", () => {
    const p = returnProfile([ev(250_000), ev(1_500_000), ev(6_000_000)], 1_000_000, 10, 5_000_000);
    expect(p.perBlock[0]).toBe(1);
    expect(p.perBlock[1]).toBe(1);
    expect(p.perBlock[6]).toBe(1);
    expect(p.perBlock.reduce((a, b) => a + b, 0)).toBe(3);
    expect(p.late).toBe(1);
  });
  it("ignores replacements and clamps a start past the last block", () => {
    const p = returnProfile([ev(300_000, "replacement"), ev(9_999_000), ev(5_000_000)], 1_000_000, 10, 5_000_000);
    expect(p.perBlock[0]).toBe(0);
    expect(p.perBlock[9]).toBe(1);
    expect(p.late).toBe(2);
  });
});
