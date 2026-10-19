// The pond route of genotype descent (tools/lib/pond-descent.ts; the rule is docs/lineage-inspector.md section 8).
// Hand-built ponds.tsv tables on the ponds-small layout: 4 ponds (tiles 0..3), period 100.
import { describe, expect, it } from "vitest";
import { birthAcrossCycle, birthNode, checkPicks, loadRouteRows, pondIndex, pondRoute, readPickLog, readPondIndex, routeKeys, tallyPickers, walkBack } from "../lib/pond-descent.ts";
import { parsePondRows } from "../lib/pond-lineage.ts";
import { founder, handCfg, key, pondsLines, type HandArm, type HandCycle } from "./pond-bundle-fixture.ts";

const TILES = new Map([0, 1, 2, 3].map((p) => [founder(p), [p]]));
const index = (cycles: HandCycle[], arm: HandArm = "scaf", opts: { first?: number; died?: boolean; startStep?: number; drop?: (l: string, i: number) => boolean } = {}) => {
  const lines = pondsLines(cycles, opts).filter((l, i) => i === 0 || !opts.drop?.(l, i));
  return pondIndex(parsePondRows(lines), handCfg(arm), { startStep: opts.startStep });
};
const route = (chain: string[], idx: ReturnType<typeof index>, arm: HandArm = "scaf", extra: Partial<Parameters<typeof pondRoute>[3]> = {}) =>
  pondRoute(chain, handCfg(arm), idx, { initialTiles: TILES, ...extra });

// Boundary 1: ponds 0 and 2 seed from pond 1, ponds 1 and 3 from pond 3. Boundary 2: every pond from pond 2.
const A = key(150, 1); // minted in pond 1, period 2 (present at node (1, 2))
const TWO: HandCycle[] = [
  { donors: [1, 3, 1, 3], packets: [{ lineages: 2, dom: founder(1), share: 0.7 }, { lineages: 1, dom: founder(3) }, { lineages: 1, dom: founder(1), share: 1 }, { lineages: 1, dom: founder(3) }] },
  { donors: [2, 2, 2, 2], packets: [{ lineages: 3, dom: A, share: 0.4 }, { lineages: 2, dom: key(160, 2) }, { lineages: 1, dom: A }, { lineages: 1, dom: A }] },
];

describe("birth nodes", () => {
  it("births a lineage at ceil(hi / P) in the tile of its cell, a boundary-step mint in the closing period", () => {
    const cfg = handCfg();
    expect(birthNode(key(200, 3), cfg, TILES)).toEqual({ key: key(200, 3), cycle: 2, ponds: [3] });
    expect(birthNode(key(201, 1), cfg, TILES)).toMatchObject({ cycle: 3, ponds: [1] });
    expect(birthNode(key(1, 0), cfg, TILES)).toMatchObject({ cycle: 1, ponds: [0] });
    expect(birthNode(founder(2), cfg, TILES)).toEqual({ key: founder(2), cycle: 0, ponds: [2] });
    expect(birthNode(founder(2), cfg, null).ponds).toBeNull();
    expect(birthNode("0:99", cfg, TILES).ponds).toEqual([]);
  });
});

describe("walk", () => {
  it("steps back through donors, through the initial world at cycle 1, and lists hops in time order", () => {
    const w = walkBack(index(TWO), 3, 3, 0);
    expect(w).toMatchObject({ ok: true, pond: 1 });
    if (w.ok) expect(w.hops.map((h) => [h.boundary, h.from, h.to])).toEqual([[1, 1, 2], [2, 2, 3]]);
    expect(walkBack(index(TWO), 3, 1, 0)).toEqual({ ok: true, pond: 3, hops: [] });
  });
});

describe("pond routes", () => {
  it("same-period edge in two ponds is refused", () => {
    expect(() => route([key(20, 0), key(50, 1)], index(TWO))).toThrow(/same period/);
    expect(route([key(20, 0), key(50, 0, 1)], index(TWO)).edges[0]).toMatchObject({ status: "exact", crossings: [] });
  });

  it("cross-boundary edge lands on the recorded donor pond and lists the crossing", () => {
    // Pond 0 at cycle 3 was seeded from pond 2 at boundary 2, so a parent born in pond 1 at cycle 2 cannot be B's.
    const B = key(250, 0);
    expect(() => route([A, B], index(TWO))).toThrow(/lands on pond 2 at cycle 2, but 150:\d+ was born in pond 1/);
    const A2 = key(150, 2); // born in pond 2 at cycle 2, where boundary 1 landed pond 1's packet (dominant 0:2)
    const TWO2: HandCycle[] = [TWO[0], { ...TWO[1], packets: TWO[1].packets!.map((p) => (p && p.dom === A ? { ...p, dom: A2 } : p)) }];
    const r = route([founder(1), A2, B], index(TWO2));
    expect(r.edges.map((e) => e.status)).toEqual(["exact", "exact"]);
    expect(r.edges[0].crossings).toEqual([{ boundary: 1, step: 100, from: 1, to: 2, carried: "named", share: 1, packetLineages: 1, by: null }]);
    expect(r.edges[1].crossings).toEqual([{ boundary: 2, step: 200, from: 2, to: 0, carried: "named", share: 0.4, packetLineages: 3, by: null }]);
    expect(r).toMatchObject({ exact: 2, notRecorded: 0, crossings: { named: 2, notExcluded: 0, notRecorded: 0 }, anchor: { ponds: [0], cycle: 3, source: "subject birth" } });
    expect(r.births.map((b) => [b.cycle, b.ponds])).toEqual([[0, [1]], [2, [2]], [3, [0]]]);
  });

  it("two-boundary walk through a donor that seeds several ponds", () => {
    // Founder of pond 1 -> child born in pond 0 at cycle 3: boundary 2 (0 <- 2), boundary 1 (2 <- 1).
    const r = route([founder(1), key(260, 0)], index(TWO));
    expect(r.edges[0].crossings.map((c) => [c.boundary, c.from, c.to, c.carried])).toEqual([
      [1, 1, 2, "named"],
      [2, 2, 0, "not excluded"],
    ]);
  });

  it("a hand-edited donor that breaks the walk is refused", () => {
    const edited: HandCycle[] = [{ ...TWO[0], donors: [1, 3, 3, 3] }, TWO[1]];
    expect(() => route([founder(1), key(260, 0)], index(edited))).toThrow(/lands on pond 3 at cycle 0, but 0:2 was born in pond 1/);
  });

  it("packet with one foreign lineage, or none, is refused; two or more with another dominant does not exclude the parent", () => {
    const one: HandCycle[] = [{ ...TWO[0], packets: [TWO[0].packets![0], TWO[0].packets![1], { lineages: 1, dom: "7:7" }, TWO[0].packets![3]] }, TWO[1]];
    expect(() => route([founder(1), key(150, 2)], index(one))).toThrow(/holds 1 lineage\(s\), dominant 7:7, so it cannot have carried 0:2/);
    const none: HandCycle[] = [{ ...TWO[0], packets: [TWO[0].packets![0], TWO[0].packets![1], { lineages: 0, dom: null }, TWO[0].packets![3]] }, TWO[1]];
    expect(() => route([founder(1), key(150, 2)], index(none))).toThrow(/holds 0 lineages, so it carried nothing alive/);
    const mixed: HandCycle[] = [{ ...TWO[0], packets: [TWO[0].packets![0], TWO[0].packets![1], { lineages: 2, dom: "7:7" }, TWO[0].packets![3]] }, TWO[1]];
    expect(route([founder(1), key(150, 2)], index(mixed)).edges[0].crossings[0]).toMatchObject({ carried: "not excluded", share: null, packetLineages: 2 });
  });

  it("a walk across a nutrient-only refill is refused", () => {
    const ended: HandCycle[] = [TWO[0], { donors: [-1, -1, -1, -1], traits: [0, 0, 0, 0] }];
    expect(() => route([founder(1), key(260, 0)], index(ended))).toThrow(/refilled with nutrient only at boundary 2/);
    // An edge that does not reach back across the refill is unaffected.
    expect(route([founder(1), key(150, 2)], index(ended)).edges[0].status).toBe("exact");
  });

  it("cont: different ponds across cycles are refused; the same pond is exact with no crossings", () => {
    const cont = index([{ donors: [-1, -1, -1, -1] }, { donors: [-1, -1, -1, -1] }], "cont");
    expect(() => route([founder(0), key(250, 1)], cont, "cont")).toThrow(/lands on pond 1 at cycle 0, but 0:1 was born in pond 0/);
    const r = route([founder(0), key(150, 0), key(250, 0, 3)], cont, "cont");
    expect(r.edges.map((e) => [e.status, e.crossings.length])).toEqual([["exact", 0], ["exact", 0]]);
    // cont moves nothing by its config: a missing table does not hide that.
    const bare = pondIndex(null, handCfg("cont"));
    expect(route([founder(0), key(250, 0)], bare, "cont").edges[0].status).toBe("exact");
    expect(() => index([{ donors: [1, -1, -1, -1] }], "cont")).toThrow(/arm cont moves nothing/);
  });

  it("nat/shuf: a survivor (-2) walks to itself, a dying pond's packet crosses", () => {
    const hunt: HandCycle[] = [
      { donors: [-2, 0, -2, -2], packets: [undefined, { lineages: 1, dom: founder(0) }] },
      { donors: [-2, -2, 1, -1], packets: [undefined, undefined, { lineages: 1, dom: key(150, 1) }] },
    ];
    const idx = index(hunt, "nat", { died: true });
    const r = route([founder(0), key(150, 1), key(250, 2)], idx, "nat", { initialTiles: TILES });
    expect(r.edges.map((e) => e.crossings.map((c) => [c.boundary, c.from, c.to]))).toEqual([[[1, 0, 1]], [[2, 1, 2]]]);
    expect(route([founder(0), key(250, 0)], idx, "nat").edges[0]).toMatchObject({ status: "exact", crossings: [] });
    expect(() => route([founder(3), key(250, 3)], idx, "nat")).toThrow(/refilled with nutrient only/);
    expect(() => index(hunt, "scaf", { died: true })).toThrow(/donor -2 \(a survivor\) in arm scaf/);
    expect(() => parsePondRows(pondsLines(hunt))).toThrow(/-2 only in a table with a died column/);
  });

  it("missing boundary (bundle starts later, torn row) marks only that edge not recorded", () => {
    // A bundle starting at step 200: its table holds boundary 3 only.
    const late = index([{ donors: [2, 2, 2, 2], packets: [{ lineages: 2, dom: "250:1" }] }], "scaf", { first: 3, startStep: 200 });
    const r = route([key(220, 2), key(250, 2, 1), key(320, 0)], late);
    expect(r.edges.map((e) => [e.status, e.crossings.map((c) => c.carried)])).toEqual([["exact", []], ["exact", ["not excluded"]]]);
    const far = route([key(50, 2), key(320, 0)], late);
    expect(far.edges[0]).toMatchObject({ status: "not recorded" });
    expect(far.edges[0].reason).toMatch(/boundary 2 \(step 200\) is not in this bundle, which starts at step 200: the ancestry continues in the earlier bundle/);
    // A torn table: boundary 2 lacks pond 0's row.
    const torn = index(TWO, "scaf", { drop: (_, i) => i === 5 });
    expect(torn.incomplete).toEqual([2]);
    const t = route([founder(1), key(150, 2), key(260, 0), key(270, 0, 1)], torn);
    expect(t.edges.map((e) => e.status)).toEqual(["exact", "not recorded", "exact"]);
    expect(t.edges[1].reason).toMatch(/no row for boundary 2, pond 0 \(a torn or incomplete table\)/);
    expect(route([founder(1), key(260, 0)], pondIndex(null, handCfg())).edges[0].reason).toBe("ponds.tsv is absent from the bundle");
  });

  it("founder root must sit in a tile of the initial world", () => {
    expect(() => route([founder(0), key(50, 1)], index(TWO))).toThrow(/lands on pond 1 at cycle 0, but 0:1 was born in pond 0/);
    expect(() => route([founder(0), key(150, 0)], index(TWO))).toThrow(/lands on pond 1 at cycle 0, but 0:1 was born in pond 0/);
    expect(() => route(["0:99", key(150, 0)], index(TWO))).toThrow(/no tile of the initial world/);
    expect(route([founder(1), key(150, 0)], index(TWO)).edges[0].status).toBe("exact");
    const unknown = pondRoute([founder(1), key(150, 2)], handCfg(), index(TWO), { initialTiles: null });
    expect(unknown.edges[0]).toMatchObject({ status: "not recorded", crossings: [{ boundary: 1, carried: "named" }] });
    expect(unknown.edges[0].reason).toMatch(/initial world could not be rebuilt/);
  });

  it("an anchor walks from a given node back to the subject's birth", () => {
    const r = route([founder(1), key(150, 2)], index(TWO), "scaf", { anchor: { pond: 0, cycle: 3 } });
    expect(r.anchor).toEqual({ ponds: [0], cycle: 3, source: "given" });
    expect(r.edges[1]).toMatchObject({ parent: key(150, 2), child: null, status: "exact", crossings: [{ boundary: 2, from: 2, to: 0, carried: "not excluded" }] });
    expect(() => route([key(250, 2)], index(TWO), "scaf", { anchor: { pond: 2, cycle: 2 } })).toThrow(/born at cycle 3, after its anchor/);
    expect(() => route([founder(1), key(150, 2)], index(TWO), "scaf", { anchor: { pond: 3, cycle: 2 } })).toThrow(/lands on pond 3/);
  });
});

describe("pick log", () => {
  const log = [
    JSON.stringify({ step: 100, kind: "pick", cycle: 1, donors: [1, 3], by: "random", suggested: [1] }),
    JSON.stringify({ step: 200, kind: "failed", cycle: 2, by: "file", error: "timeout" }),
    JSON.stringify({ step: 200, kind: "pick", cycle: 2, donors: [2], by: "recorded", suggested: [2] }),
  ];

  it("reads pick lines, skips failed lines, drops a torn last line and requires ascending steps", () => {
    expect(readPickLog(log)).toEqual({ picks: [
      { step: 100, cycle: 1, donors: [1, 3], by: "random", suggested: [1] },
      { step: 200, cycle: 2, donors: [2], by: "recorded", suggested: [2] },
    ], torn: false });
    expect(readPickLog([...log, '{"step":300,"ki']).torn).toBe(true);
    expect(() => readPickLog(['{"step":3', ...log])).toThrow(/line 1 is not JSON/);
    expect(() => readPickLog([log[2], log[0]])).toThrow(/step 100 does not follow 200/);
  });

  it("picks disagreeing with ponds.tsv donors are refused; agreeing picks carry `by`", () => {
    const { picks } = readPickLog(log);
    expect(checkPicks(index(TWO), picks)).toEqual({ checked: 2, partial: 0, unchecked: 0, unlogged: 0 });
    const r = route([founder(1), key(260, 0)], index(TWO), "scaf", { picks: { lines: picks, torn: false } });
    expect(r.edges[0].crossings.map((c) => c.by)).toEqual(["random", "recorded"]);
    expect(r.picks).toEqual({ lines: 2, checked: 2, partial: 0, unchecked: 0, unlogged: 0, torn: false, by: { random: 1, recorded: 1 } });
    const wrong = readPickLog([JSON.stringify({ step: 100, kind: "pick", cycle: 1, donors: [1], by: "random" })]).picks;
    expect(() => checkPicks(index(TWO), wrong)).toThrow(/names donors \[1\] at cycle 1, which assign recipient 3 donor 1 \(rank 1 of the run's pond keys\), but ponds.tsv's row names donor 3/);
    expect(() => checkPicks(index(TWO), [{ ...picks[0], step: 150 }])).toThrow(/not cycle x pondPeriod/);
    // Boundary 2 lacks pond 0's row: its other rows are still checked (partial).
    expect(checkPicks(index(TWO, "scaf", { drop: (_, i) => i === 5 }), picks)).toEqual({ checked: 1, partial: 1, unchecked: 0, unlogged: 0 });
    // A cycle the log lacks, and a log line for a cycle with no rows.
    expect(checkPicks(index(TWO), picks.slice(1))).toEqual({ checked: 1, partial: 0, unchecked: 0, unlogged: 1 });
    expect(checkPicks(index(TWO), [...picks, { step: 300, cycle: 3, donors: [0], by: "random", suggested: null }])).toMatchObject({ checked: 2, unchecked: 1 });
    expect(() => checkPicks(index([{ donors: [-1, -1, -1, -1] }], "cont"), picks)).toThrow(/arm cont, which takes no donors/);
  });

  it("a picker named like an Object property tallies like any other name", () => {
    // Cycles 1 and 2 agree with TWO's rows; 3 to 6 have no rows (unchecked). Cycle 6 names no picker.
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty", "__proto__", null];
    const donors = [[1, 3], [2], [0], [0], [0], [0]];
    const lines = names.map((by, i) => JSON.stringify({ step: (i + 1) * 100, kind: "pick", cycle: i + 1, donors: donors[i], ...(by === null ? {} : { by }) }));
    const { picks } = readPickLog(lines);
    const want = [["__proto__", 2], ["constructor", 1], ["hasOwnProperty", 1], ["toString", 1], ["unnamed", 1]];
    // Entries, not toEqual against a literal: `{ __proto__: 2 }` in a literal sets the prototype and has no own key.
    const tally = tallyPickers(picks);
    expect(Object.entries(tally).sort()).toEqual(want);
    expect(Object.hasOwn(tally, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(tally)).toBe(Object.prototype);
    expect(Object.entries(tallyPickers([...picks, { ...picks[2], step: 700, cycle: 7 }])).sort()).toContainEqual(["__proto__", 3]);
    expect(tallyPickers([])).toEqual({});
    const r = route([founder(1), key(260, 0)], index(TWO), "scaf", { picks: { lines: picks, torn: false } });
    expect(r.edges[0].crossings.map((c) => c.by)).toEqual(["constructor", "toString"]);
    const by = r.picks!.by;
    expect(Object.entries(by).sort()).toEqual(want);
    expect(Object.hasOwn(by, "__proto__")).toBe(true);
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(r.picks!.lines);
    // The dossier goes through JSON: the tally survives it, `__proto__` included.
    const back = JSON.parse(JSON.stringify(by));
    expect(Object.entries(back).sort()).toEqual(want);
    expect(Object.hasOwn(back, "__proto__")).toBe(true);
  });
});

describe("tracker births across a cycle", () => {
  it("excludes the first census after a transforming boundary, from series.jsonl or from the grid", () => {
    expect(birthAcrossCycle(150, "scaf", 100, 50, 0, new Set([150]))).toBe(true);
    expect(birthAcrossCycle(200, "scaf", 100, 50, 0, new Set([150]))).toBe(false);
    expect(birthAcrossCycle(150, "rand", 100, 50, 0, null)).toBe(true);
    expect(birthAcrossCycle(50, "rand", 100, 50, 0, null)).toBe(false);
    expect(birthAcrossCycle(150, "cont", 100, 50, 0, new Set([150]))).toBe(false);
    // A shortened last chunk: a run ending at 125 censuses at 100 (boundary 1) and 125, the first after it.
    expect(birthAcrossCycle(125, "scaf", 100, 50, 0, null)).toBe(true);
    expect(birthAcrossCycle(175, "scaf", 100, 50, 0, null)).toBe(false);
    // A segment starting at a boundary flags its first census (the predecessor applied the cycle); one starting
    // mid-period does not.
    expect(birthAcrossCycle(250, "scaf", 100, 50, 200, null)).toBe(true);
    expect(birthAcrossCycle(200, "scaf", 100, 50, 150, null)).toBe(false);
    expect(birthAcrossCycle(250, "scaf", 100, 50, 150, null)).toBe(true);
  });
});

describe("review fixes (2026-10-17)", () => {
  const A2 = key(150, 2); // born in pond 2 at cycle 2 (boundary 1 seeded pond 2 from pond 1)
  async function* stream(lines: string[]) {
    for (const l of lines) yield l;
  }

  it("an empty packet that still names the parent is refused, and so is a packet with lineages but no dominant", () => {
    const empty: HandCycle[] = [{ ...TWO[0], packets: [TWO[0].packets![0], TWO[0].packets![1], { lineages: 0, dom: founder(1) }, TWO[0].packets![3]] }, TWO[1]];
    expect(() => route([founder(1), A2], index(empty))).toThrow(/holds 0 lineages \(yet names dominant 0:2\), so it carried nothing alive: the records contradict/);
    const lines = pondsLines(TWO).map((l, i) => (i === 3 ? l.replace(/^((?:[^\t]*\t){13})\d+\t\d+\t/, (_, head) => `${head}0\t0\t`) : l));
    expect(() => route([founder(1), A2], pondIndex(parsePondRows(lines), handCfg()))).toThrow(/holds 1 lineage\(s\) but names no dominant: the row is malformed/);
  });

  it("a packet count of 0 refuses even when the table lacks domHi/domLo; a count without them is not recorded (Codex pass 2)", () => {
    const strip = (lines: string[]) => {
      const keep = lines[0].split("\t").flatMap((c, i) => (c === "domHi" || c === "domLo" ? [] : [i]));
      return lines.map((l) => keep.map((i) => l.split("\t")[i]).join("\t"));
    };
    const empty: HandCycle[] = [{ ...TWO[0], packets: [TWO[0].packets![0], TWO[0].packets![1], { lineages: 0, dom: null }, TWO[0].packets![3]] }, TWO[1]];
    const p = parsePondRows(strip(pondsLines(empty)));
    expect(p.absentColumns).toEqual(expect.arrayContaining(["domHi", "domLo"]));
    expect(() => route([founder(1), A2], pondIndex(p, handCfg()))).toThrow(/boundary 1 \(pond 1 -> 2\) holds 0 lineages, so it carried nothing alive/);
    const r = route([founder(1), A2], pondIndex(parsePondRows(strip(pondsLines(TWO))), handCfg()));
    expect(r.edges[0]).toMatchObject({ status: "exact", crossings: [{ boundary: 1, carried: "not recorded", packetLineages: 1 }] });
    expect(r.crossings).toEqual({ named: 0, notExcluded: 0, notRecorded: 1 });
  });

  it("a missing older row does not hide a contradiction already recorded on the walk", () => {
    // 0:2 -> 250:645 (pond 0, cycle 3): boundary 2 takes pond 0 from pond 2 through an empty packet; boundary 1's row for pond 2 is gone.
    const bad: HandCycle[] = [TWO[0], { ...TWO[1], packets: [{ lineages: 0, dom: null }, ...TWO[1].packets!.slice(1)] }];
    const torn = index(bad, "scaf", { drop: (_, i) => i === 3 });
    expect(() => route([founder(1), key(250, 0)], torn)).toThrow(/boundary 2 \(pond 2 -> 0\) holds 0 lineages/);
    // With a sound packet the edge is not recorded, and keeps the crossing it did pass.
    const r = route([founder(1), key(250, 0)], index(TWO, "scaf", { drop: (_, i) => i === 3 }));
    expect(r.edges[0]).toMatchObject({ status: "not recorded", crossings: [{ boundary: 2, from: 2, to: 0, carried: "not excluded" }] });
    expect(r.crossings).toEqual({ named: 0, notExcluded: 1, notRecorded: 0 });
  });

  it("picks: order is checked through the run's pond keys, and an incomplete cycle still refuses a provable disagreement", () => {
    // Seed 1, cycle 1 ranks the ponds 0, 3, 2, 1: [1, 3] assigns donors [1, 3, 1, 3] by recipient, [3, 1] assigns [3, 1, 3, 1].
    const pick = (cycle: number, donors: number[]) => ({ step: cycle * 100, cycle, donors, by: "random", suggested: null });
    expect(checkPicks(index(TWO), [pick(1, [1, 3])])).toMatchObject({ checked: 1 });
    expect(() => checkPicks(index(TWO), [pick(1, [3, 1])])).toThrow(/assign recipient 0 donor 3 .* ponds.tsv's row names donor 1/);
    // Recipient 3's row dropped (line 4): the three rows present name donors [1, 3, 1]; a pick of [1] contradicts recipient 1's.
    const partial = index(TWO, "scaf", { drop: (_, i) => i === 4 });
    expect(partial.incomplete).toEqual([1]);
    expect(() => checkPicks(partial, [pick(1, [1])])).toThrow(/recipient 1 donor 1 .* names donor 3/);
    expect(checkPicks(partial, [pick(1, [1, 3])])).toEqual({ checked: 0, partial: 1, unchecked: 0, unlogged: 1 });
    // A log with no donors (an ended history) means every row is -1.
    expect(checkPicks(index([{ donors: [-1, -1, -1, -1] }]), [pick(1, [])])).toMatchObject({ checked: 1 });
    expect(() => checkPicks(index(TWO), [pick(1, [])])).toThrow(/assign recipient 0 donor -1/);
  });

  it("a torn last ponds.tsv row (cut mid-line) marks only the routes through it; a short interior row throws", () => {
    const lines = pondsLines(TWO);
    const cut = [...lines.slice(0, -1), lines[lines.length - 1].slice(0, 20)];
    const p = parsePondRows(cut);
    expect(p.torn).toBe(cut.length);
    expect(p.rows.length).toBe(7);
    const idx = pondIndex(p, handCfg());
    expect(idx).toMatchObject({ torn: cut.length, incomplete: [2] });
    // Boundary 2's row for pond 3 is the torn one: pond 3's route is not recorded, pond 0's is intact.
    expect(route([founder(1), A2, key(250, 3)], idx).edges.map((e) => e.status)).toEqual(["exact", "not recorded"]);
    expect(route([founder(1), A2, key(250, 0)], idx).edges.map((e) => e.status)).toEqual(["exact", "exact"]);
    expect(() => parsePondRows([...lines.slice(0, 3), lines[3].slice(0, 20), ...lines.slice(4)])).toThrow(/ponds.tsv line 4: \d+ fields, header has 22/);
    expect(() => parsePondRows([...lines, `${lines[1]}\textra`])).toThrow(/23 fields, header has 22/);
  });

  it("the streamed index keeps donors only and loads exactly the rows a route reads; the route matches the full index", async () => {
    const lines = pondsLines(TWO);
    const full = pondIndex(parsePondRows(lines), handCfg());
    const lean = await readPondIndex(stream(lines), handCfg());
    expect(lean.detail.size).toBe(0);
    expect([...lean.donors.get(1)!]).toEqual([1, 3, 1, 3]);
    const chain = [founder(1), A2, key(250, 0)];
    const keys = routeKeys(chain, handCfg(), lean, { initialTiles: TILES });
    expect([...keys].sort((a, b) => a - b)).toEqual([1 * 4 + 2, 2 * 4 + 0]);
    await loadRouteRows(lean, stream(lines), keys);
    expect(lean.detail.size).toBe(2);
    expect(pondRoute(chain, handCfg(), lean, { initialTiles: TILES })).toEqual(pondRoute(chain, handCfg(), full, { initialTiles: TILES }));
    const unloaded = await readPondIndex(stream(lines), handCfg());
    expect(() => pondRoute(chain, handCfg(), unloaded, { initialTiles: TILES })).toThrow(/was not loaded/);
  });

  it("a founder subject's anchor lists its tiles, or null when they are unknown", () => {
    expect(route([founder(1)], index(TWO)).anchor).toEqual({ ponds: [1], cycle: 0, source: "subject birth" });
    expect(pondRoute([founder(1)], handCfg(), index(TWO), { initialTiles: null }).anchor).toEqual({ ponds: null, cycle: 0, source: "subject birth" });
  });
});
