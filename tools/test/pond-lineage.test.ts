import { describe, expect, it } from "vitest";
import {
  DOSSIER_VERSION,
  buildPondHistory,
  parsePondRows,
  pondDossier,
  pondTwin,
  readPondRows,
  seededPick,
  selectPondSubject,
  traitBand,
  type PondArm,
  type PondHistory,
} from "../lib/pond-lineage.ts";

/** The column order the scaffold tool writes today; the module must not depend on it. */
const COLUMNS = [
  "cycle", "step", "recipient", "donor", "cx", "cy", "landed", "reqMass", "retMass", "reqE", "retE", "truncated",
  "packetLineages", "domHi", "domLo", "domShare", "donorTrait", "recipientTrait", "recipientIndividuals", "recipientLineages", "heat", "light",
];

interface Cycle {
  traits: number[];
  /** Donor of each recipient, -1 for none. */
  donors: number[];
}

/**
 * A ponds.tsv from per-cycle traits and donors. Row (c, r) gets dominant lineage `${1000 c + r}:5`, so a node's
 * inbound packet can be told from the previous cycle's row. Period 100.
 */
function pondsText(cycles: Cycle[], columns: string[] = COLUMNS): string {
  const lines = [columns.join("\t")];
  cycles.forEach((cy, i) => {
    const c = i + 1;
    cy.traits.forEach((trait, r) => {
      const d = cy.donors[r];
      const v: Record<string, string | number> = {
        cycle: c, step: c * 100, recipient: r, donor: d,
        cx: d >= 0 ? 10 + r : -1, cy: d >= 0 ? 20 + r : -1, landed: d >= 0 ? 64 : 0,
        reqMass: d >= 0 ? 500 + r : 0, retMass: d >= 0 ? 500 + r : 0, reqE: d >= 0 ? 7 : 0, retE: d >= 0 ? 7 : 0, truncated: 0,
        packetLineages: d >= 0 ? 2 : 0, domHi: d >= 0 ? 1000 * c + r : 0, domLo: d >= 0 ? 5 : 0, domShare: d >= 0 ? 0.5 : 0,
        donorTrait: d >= 0 ? cy.traits[d] : 0, recipientTrait: trait, recipientIndividuals: trait > 0 ? 3 : 0, recipientLineages: 2,
        heat: 1000 + r, light: d >= 0 ? 50 : 0,
      };
      lines.push(columns.map((k) => String(v[k] ?? "")).join("\t"));
    });
  });
  return lines.join("\n") + "\n";
}

const history = (cycles: Cycle[], arm?: PondArm, columns?: string[]): PondHistory =>
  buildPondHistory(parsePondRows(pondsText(cycles, columns).split("\n")), arm ? { arm } : {});

/**
 * Four ponds, four cycles. Parents (child <- parent), from the donor of row (c-1, p):
 *   c2: 0<-1:1  1<-1:1  2<-3:1  3<-1:1       c3: 0<-1:2  1<-0:2  2<-1:2  3<-0:2
 *   c4: 0<-2:3  1<-2:3  2<-1:3  3<-2:3
 * Pond 1 at cycle 1 seeds three ponds; the line of pond 3 at cycle 1 dies out at cycle 3; at cycle 4 pond 0 seeds itself.
 */
const TREE: Cycle[] = [
  { traits: [10, 40, 5, 30], donors: [1, 1, 3, 1] },
  { traits: [20, 50, 15, 0], donors: [1, 0, 1, 0] },
  { traits: [25, 35, 45, 0], donors: [2, 2, 1, 2] },
  { traits: [60, 60, 10, 0], donors: [0, 0, 0, 2] },
];

const nodes = (d: ReturnType<typeof pondDossier>) => d.ancestry.chain.map((n) => `${n.pond}:${n.cycle}`);

describe("parsePondRows", () => {
  it("reads columns by name: reordered, with an extra column and CRLF line ends", () => {
    const lines = pondsText(TREE, [...COLUMNS].reverse()).split("\n");
    const p = parsePondRows(lines.map((l, i) => (l === "" ? l : `${l}\t${i === 0 ? "extra" : "x"}\r`)));
    expect(p.rows).toHaveLength(16);
    expect(p.rows[5]).toMatchObject({ cycle: 2, recipient: 1, donor: 0, recipientTrait: 50, donorTrait: 20, domHi: 2001, domLo: 5, domShare: 0.5, truncated: false, heat: "1001", light: "50" });
    expect(p.absentColumns).toEqual([]);
  });

  it("rejects a header without a required column, naming it", () => {
    const noDonor = COLUMNS.filter((c) => c !== "donor");
    expect(() => parsePondRows(pondsText(TREE, noDonor).split("\n"))).toThrow(/lacks required column\(s\) donor/);
    const noTwo = COLUMNS.filter((c) => c !== "recipientTrait" && c !== "step");
    expect(() => parsePondRows(pondsText(TREE, noTwo).split("\n"))).toThrow(/step, recipientTrait/);
    expect(() => parsePondRows([])).toThrow(/empty/);
  });

  it("accepts a header with only the required columns and reports the optional ones as absent", () => {
    const min = ["cycle", "step", "recipient", "donor", "recipientTrait"];
    const p = parsePondRows(pondsText(TREE, min).split("\n"));
    expect(p.absentColumns).toContain("domShare");
    expect(p.absentColumns).toContain("donorTrait");
    expect(p.rows[0].domHi).toBeNull();
    const d = pondDossier(buildPondHistory(p, { arm: "scaf" }), { kind: "explicit", pond: 3, cycle: 4 });
    expect(d.ancestry.chain[1].packet).toMatchObject({ donor: 1, dominant: null, domShare: null, retMass: null, light: null });
    expect(d.gaps).toContain("column domShare is absent from the ponds.tsv header");
    expect(d.genotypeLinks).toEqual([]);
  });

  it("names the line of a malformed row", () => {
    const lines = pondsText(TREE).split("\n");
    expect(() => parsePondRows([lines[0], lines[1], lines[2].split("\t").slice(1).join("\t")])).toThrow(/line 3: 21 fields, header has 22/);
    const bad = lines[1].split("\t");
    bad[COLUMNS.indexOf("recipientTrait")] = "12.5";
    expect(() => parsePondRows([lines[0], bad.join("\t")])).toThrow(/line 2: recipientTrait is not an integer/);
    const dup = [...COLUMNS.slice(0, 3), "cycle"];
    expect(() => parsePondRows([dup.join("\t")])).toThrow(/duplicate header column cycle/);
  });

  it("reads an async line stream the same as an array", async () => {
    const lines = pondsText(TREE).split("\n");
    async function* stream() {
      for (const l of lines) yield l;
    }
    expect(await readPondRows(stream())).toEqual(parsePondRows(lines));
  });
});

describe("buildPondHistory", () => {
  it("indexes the tree and finds the cycle range, ponds and period", () => {
    const h = history(TREE, "scaf");
    expect(h).toMatchObject({ ponds: [0, 1, 2, 3], cycles: [1, 2, 3, 4], firstCycle: 1, lastCycle: 4, period: 100, transfer: true, endedAt: null, warnings: [] });
  });

  it("rejects structural errors", () => {
    const rows = parsePondRows(pondsText(TREE).split("\n")).rows;
    const parsed = (r: typeof rows) => ({ rows: r, absentColumns: [] });
    expect(() => buildPondHistory(parsed([...rows, rows[0]]))).toThrow(/two rows for cycle 1, recipient 0/);
    expect(() => buildPondHistory(parsed(rows.filter((r) => r.cycle !== 3)))).toThrow(/not contiguous/);
    expect(() => buildPondHistory(parsed(rows.filter((r) => !(r.cycle === 2 && r.recipient === 1))))).toThrow(/different set of ponds/);
    expect(() => buildPondHistory(parsed(rows.map((r) => (r.cycle === 2 && r.recipient === 0 ? { ...r, donor: 9 } : r))))).toThrow(/donor 9 is not a pond/);
    expect(() => buildPondHistory(parsed(rows.map((r) => (r.cycle === 2 && r.recipient === 0 ? { ...r, donor: -1 } : r))))).toThrow(/mixes recipients/);
    expect(() => buildPondHistory(parsed(rows.filter((r) => r.cycle !== 4).map((r) => (r.cycle === 2 ? { ...r, donor: -1 } : r))))).toThrow(/without transfers before its last cycle/);
    expect(() => buildPondHistory(parsed(rows), { arm: "cont" })).toThrow(/arm cont has no donor transfer/);
    expect(() => buildPondHistory({ rows: [], absentColumns: [] })).toThrow(/no data rows/);
  });

  it("drops a torn last cycle and says so", () => {
    const rows = parsePondRows(pondsText(TREE).split("\n")).rows;
    const h = buildPondHistory({ rows: rows.slice(0, -2), absentColumns: [] });
    expect(h.lastCycle).toBe(3);
    expect(h.warnings[0]).toMatch(/cycle 4 has 2 of 4 ponds/);
  });

  it("warns, without failing, when a donorTrait disagrees with the donor's own trait", () => {
    const rows = parsePondRows(pondsText(TREE).split("\n")).rows;
    const h = buildPondHistory({ rows: rows.map((r) => (r.cycle === 1 && r.recipient === 0 ? { ...r, donorTrait: 41 } : r)), absentColumns: [] });
    expect(h.warnings).toEqual([expect.stringMatching(/1 donorTrait value\(s\) differ.*cycle 1, recipient 0: donorTrait 41 but donor 1 measured 40/)]);
  });
});

describe("ancestry", () => {
  const h = history(TREE, "scaf");

  it("walks donors back to cycle 1, root first, through a donor that seeds several ponds", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 3, cycle: 4 });
    expect(nodes(d)).toEqual(["1:1", "1:2", "2:3", "3:4"]);
    expect(d.ancestry).toMatchObject({ depth: 3, rootPond: 1, rootCycle: 1, distinctDonorPonds: 2 });
    const e = pondDossier(h, { kind: "explicit", pond: 2, cycle: 4 });
    expect(nodes(e)).toEqual(["1:1", "0:2", "1:3", "2:4"]);
    expect(e.ancestry.distinctDonorPonds).toBe(2);
    expect(nodes(pondDossier(h, { kind: "explicit", pond: 2, cycle: 2 }))).toEqual(["3:1", "2:2"]);
  });

  it("takes a node's own measures from its row and its founding packet from the previous cycle's row", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 3, cycle: 4 });
    const [root, n2, n3, n4] = d.ancestry.chain;
    expect(root).toMatchObject({ pond: 1, cycle: 1, step: 100, trait: 40, individuals: 3, lineages: 2, heat: "1001", parent: null, packet: null });
    // Node (1, 2) was seeded by row (1, 1): donor 1, trait 40 at cycle 1.
    expect(n2).toMatchObject({ pond: 1, cycle: 2, step: 200, trait: 50, parent: { pond: 1, cycle: 1 } });
    expect(n2.packet).toEqual({
      donor: 1, donorTrait: 40, cx: 11, cy: 21, landed: 64, reqMass: 501, retMass: 501, reqE: 7, retE: 7, truncated: false,
      lineages: 2, dominant: "1001:5", domShare: 0.5, light: "50",
    });
    expect(n3).toMatchObject({ pond: 2, cycle: 3, trait: 45, parent: { pond: 1, cycle: 2 } });
    expect(n3.packet).toMatchObject({ donor: 1, donorTrait: 50, dominant: "2002:5" });
    expect(n4).toMatchObject({ pond: 3, cycle: 4, trait: 0, parent: { pond: 2, cycle: 3 } });
    expect(n4.packet).toMatchObject({ donor: 2, donorTrait: 45, dominant: "3003:5" });
  });

  it("links each chain node's dominant packet lineage for the genotype tool", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 3, cycle: 4 });
    expect(d.genotypeLinks).toEqual([
      { pond: 1, cycle: 2, lineage: "1001:5", share: 0.5 },
      { pond: 2, cycle: 3, lineage: "2002:5", share: 0.5 },
      { pond: 3, cycle: 4, lineage: "3003:5", share: 0.5 },
    ]);
    expect(d.gaps.some((g) => g.startsWith("mutations.tsv:"))).toBe(true);
  });

  it("counts, for each chain node, the ponds at the subject's cycle that descend from it", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 3, cycle: 4 });
    expect(d.ancestry.chain.map((n) => n.descendants)).toEqual([4, 3, 3, 1]);
    expect(d.ancestry.commonAncestorCycle).toBe(1);
    // The 2:4 line leaves the shared spine at once: only the root is everyone's ancestor.
    expect(pondDossier(h, { kind: "explicit", pond: 2, cycle: 4 }).ancestry.chain.map((n) => n.descendants)).toEqual([4, 1, 1, 1]);
    // After a bottleneck to one donor the shared ancestry runs up to that donor's cycle.
    const funnel = history([
      { traits: [5, 6, 7], donors: [0, 0, 0] },
      { traits: [5, 6, 7], donors: [1, 1, 1] },
      { traits: [1, 2, 3], donors: [2, 2, 2] },
    ]);
    const f = pondDossier(funnel, { kind: "explicit", pond: 2, cycle: 3 });
    expect(nodes(f)).toEqual(["0:1", "1:2", "2:3"]);
    expect(f.ancestry.chain.map((n) => n.descendants)).toEqual([3, 3, 1]);
    expect(f.ancestry.commonAncestorCycle).toBe(2);
    // Early subjects cannot have a common ancestor with later ponds unless their clade covers everyone.
    expect(pondDossier(h, { kind: "explicit", pond: 3, cycle: 2 }).ancestry.commonAncestorCycle).toBeNull();
  });

  it("agrees with a forward walk from every chain node", () => {
    const forward = (pond: number, from: number, to: number) => {
      let members = new Set([pond]);
      for (let c = from; c < to; c++) members = new Set(TREE[c - 1].donors.flatMap((d, r) => (members.has(d) ? [r] : [])));
      return members.size;
    };
    for (let cycle = 1; cycle <= 4; cycle++)
      for (let pond = 0; pond < 4; pond++)
        for (const n of pondDossier(h, { kind: "explicit", pond, cycle }).ancestry.chain) expect(n.descendants).toBe(forward(n.pond, n.cycle, cycle));
  });

  it("gives the first-cycle subject a chain of one", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 1, cycle: 1 });
    expect(nodes(d)).toEqual(["1:1"]);
    expect(d.ancestry).toMatchObject({ depth: 0, distinctDonorPonds: 0 });
  });

  it("records the subject's rank among the ponds of its cycle", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 1, cycle: 3 });
    expect(d.subject).toMatchObject({ trait: 35, rank: 2, of: 4, step: 300 });
  });
});

describe("offspring and clade", () => {
  const h = history(TREE, "scaf");

  it("lists exact children of a donor that seeds three ponds, with their own outcomes", () => {
    const o = pondDossier(h, { kind: "explicit", pond: 1, cycle: 1 }).offspring!;
    expect(o).toMatchObject({ count: 3, measured: true });
    expect(o.children.map((c) => [c.pond, c.cycle, c.trait, c.seeded])).toEqual([[0, 2, 20, 2], [1, 2, 50, 2], [3, 2, 0, 0]]);
    expect(o.children[0].packet).toMatchObject({ donor: 1, dominant: "1000:5" });
  });

  it("counts the clade per cycle, including a line that grows to the whole world", () => {
    const c = pondDossier(h, { kind: "explicit", pond: 1, cycle: 1 }).clade!;
    expect(c.series).toEqual([
      { cycle: 1, size: 1, eligible: 1, traitSum: 40 },
      { cycle: 2, size: 3, eligible: 2, traitSum: 70 },
      { cycle: 3, size: 4, eligible: 3, traitSum: 105 },
      { cycle: 4, size: 4, eligible: 3, traitSum: 130 },
    ]);
    expect(c).toMatchObject({ extant: true, alive: true, extinctAt: null, seededAfterLast: 4 });
  });

  it("follows a line that goes extinct", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 3, cycle: 1 });
    expect(d.offspring).toMatchObject({ count: 1, measured: true });
    expect(d.offspring!.children[0]).toMatchObject({ pond: 2, trait: 15, seeded: 0 });
    expect(d.clade!.series.map((p) => p.size)).toEqual([1, 1, 0, 0]);
    expect(d.clade).toMatchObject({ extant: false, alive: false, extinctAt: 3, seededAfterLast: 0 });
  });

  it("narrows and widens again for a clade that is not a donor in some cycles", () => {
    const c = pondDossier(h, { kind: "explicit", pond: 0, cycle: 2 }).clade!;
    expect(c.series.map((p) => p.size)).toEqual([1, 2, 1]);
    expect(c.series[1]).toMatchObject({ eligible: 1, traitSum: 35 });
  });

  it("leaves the last cycle's children unmeasured and counts the seed that includes itself", () => {
    const d = pondDossier(h, { kind: "explicit", pond: 0, cycle: 4 });
    expect(d.offspring).toMatchObject({ count: 3, measured: false });
    expect(d.offspring!.children.map((c) => [c.pond, c.trait, c.seeded])).toEqual([[0, null, null], [1, null, null], [2, null, null]]);
    expect(d.clade!.series).toEqual([{ cycle: 4, size: 1, eligible: 1, traitSum: 60 }]);
    expect(d.clade!.seededAfterLast).toBe(3);
    expect(d.gaps).toContain("the subject's children are seeded at the last boundary but never measured");
  });

  it("separates a clade that is present from one that is alive", () => {
    const ended = history(
      [
        { traits: [5, 0, 0, 0], donors: [0, 0, 0, 0] },
        { traits: [0, 0, 0, 0], donors: [-1, -1, -1, -1] },
      ],
      "scaf",
    );
    expect(ended.endedAt).toBe(2);
    const d = pondDossier(ended, { kind: "explicit", pond: 0, cycle: 1 });
    expect(d.clade).toMatchObject({ extant: true, alive: false, extinctAt: null, seededAfterLast: 0 });
    expect(d.notes.some((n) => n.includes("history ended"))).toBe(true);
    expect(() => selectPondSubject(ended, { kind: "top" })).toThrow(/no eligible pond at cycle 2/);
    expect(selectPondSubject(ended, { kind: "top", cycle: 1 }).pond).toBe(0);
  });
});

describe("subject rules", () => {
  const h = history(TREE, "rand");

  it("explicit: validates the node", () => {
    expect(selectPondSubject(h, { kind: "explicit", pond: 3, cycle: 2 })).toMatchObject({ pond: 3, cycle: 2, candidates: 1 });
    expect(() => selectPondSubject(h, { kind: "explicit", pond: 3, cycle: 5 })).toThrow(/cycle 5 is outside/);
    expect(() => selectPondSubject(h, { kind: "explicit", pond: 4, cycle: 2 })).toThrow(/pond 4 is not in this history/);
  });

  it("top: the highest trait at the cycle, defaulting to the last cycle, ties to the smallest pond", () => {
    const last = selectPondSubject(h, { kind: "top" });
    expect(last).toMatchObject({ pond: 0, cycle: 4, tied: 2, candidates: 3, rule: { kind: "top", cycle: 4, cycleDefaulted: true } });
    expect(selectPondSubject(h, { kind: "top", cycle: 3 })).toMatchObject({ pond: 2, tied: 1, rule: { cycleDefaulted: false } });
    expect(selectPondSubject(h, { kind: "top", cycle: 1 }).pond).toBe(1);
    // A tie among three, resolved to the smallest index even when a larger index comes first in the file.
    const tie = history([{ traits: [0, 9, 9, 9], donors: [-1, -1, -1, -1] }]);
    expect(selectPondSubject(tie, { kind: "top" })).toMatchObject({ pond: 1, tied: 3 });
  });

  it("random: seeded, deterministic, uniform over the eligible ponds", () => {
    const r = (seed: number, extra: object = {}) => selectPondSubject(h, { kind: "random", seed, cycle: 3, ...extra });
    expect(r(7)).toEqual(r(7));
    expect(r(7).rule).toEqual({ kind: "random", seed: 7, cycle: 3, cycleDefaulted: false, minTrait: 1 });
    const counts = new Map<number, number>();
    for (let seed = 0; seed < 3000; seed++) {
      const pond = r(seed).pond;
      counts.set(pond, (counts.get(pond) ?? 0) + 1);
    }
    // Pond 3 has trait 0 at cycle 3, so it is never picked; the other three are close to 1000 each.
    expect([...counts.keys()].sort()).toEqual([0, 1, 2]);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
    expect(r(7, { minTrait: 0 }).candidates).toBe(4);
    expect(r(7, { minTrait: 30 })).toMatchObject({ candidates: 2 });
    expect(selectPondSubject(h, { kind: "random", seed: 7 })).toMatchObject({ cycle: 4, rule: { cycleDefaulted: true } });
  });

  it("random: pins the generator and rejects bad parameters", () => {
    // Changing lowbias32 or seededPick changes which pond a seed names, so the pick sequence is pinned.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => seededPick(s, 3, 3))).toEqual([2, 1, 1, 1, 2, 1, 0, 1]);
    expect(seededPick(123, 9, 1)).toBe(0);
    expect(new Set([1, 2, 3, 4, 5, 6].map((c) => seededPick(5, c, 1000))).size).toBeGreaterThan(4);
    expect(() => seededPick(1, 1, 0)).toThrow(/positive integer/);
    expect(() => selectPondSubject(h, { kind: "random", seed: -1 })).toThrow(/random seed/);
    expect(() => selectPondSubject(h, { kind: "random", seed: 1.5 })).toThrow(/random seed/);
    expect(() => selectPondSubject(h, { kind: "random", seed: 1, cycle: 3, minTrait: 100 })).toThrow(/no pond has trait >= 100/);
  });
});

describe("trait band", () => {
  it("summarises the trait over all ponds at every cycle", () => {
    const b = traitBand(history(TREE));
    expect(b.map((p) => p.cycle)).toEqual([1, 2, 3, 4]);
    expect(b[3]).toEqual({ cycle: 4, step: 400, n: 4, eligible: 3, min: 0, q1: 0, median: 10, q3: 60, max: 60, sum: 130 });
    expect(b[2]).toMatchObject({ min: 0, q1: 0, median: 25, q3: 35, max: 45, eligible: 3 });
  });

  it("uses nearest-rank quartiles", () => {
    const h = history([{ traits: [80, 10, 70, 20, 60, 30, 50, 40], donors: Array(8).fill(-1) }]);
    expect(traitBand(h)[0]).toMatchObject({ n: 8, min: 10, q1: 20, median: 40, q3: 60, max: 80, sum: 360 });
  });

  it("travels with the dossier", () => {
    expect(pondDossier(history(TREE), { kind: "top" }).band).toEqual(traitBand(history(TREE)));
  });
});

describe("arm cont", () => {
  const cont = history(
    [
      { traits: [10, 20, 30], donors: [-1, -1, -1] },
      { traits: [15, 0, 35], donors: [-1, -1, -1] },
      { traits: [0, 0, 40], donors: [-1, -1, -1] },
    ],
    "cont",
  );

  it("treats the pond as its own ancestry and invents no descent", () => {
    expect(cont).toMatchObject({ transfer: false, endedAt: null });
    const d = pondDossier(cont, { kind: "top" });
    expect(d.descent).toBe("none");
    expect(d.subject).toMatchObject({ pond: 2, cycle: 3, trait: 40 });
    expect(nodes(d)).toEqual(["2:1", "2:2", "2:3"]);
    expect(d.ancestry).toMatchObject({ depth: 0, rootPond: 2, rootCycle: 1, distinctDonorPonds: 0 });
    expect(d.ancestry.chain.every((n) => n.parent === null && n.packet === null && n.descendants === null)).toBe(true);
    expect(d.ancestry.commonAncestorCycle).toBeNull();
    expect(d.ancestry.chain.map((n) => n.trait)).toEqual([30, 35, 40]);
    expect(d.offspring).toBeNull();
    expect(d.clade).toBeNull();
    expect(d.genotypeLinks).toEqual([]);
    expect(d.notes[0]).toMatch(/no donor transfer is recorded/);
  });

  it("is not called ended when its ponds are all dead, unlike a scaf or rand history", () => {
    const rows = parsePondRows(pondsText([{ traits: [0, 0, 0], donors: [-1, -1, -1] }]).split("\n"));
    expect(pondDossier(buildPondHistory(rows, { arm: "cont" }), { kind: "explicit", pond: 0, cycle: 1 }).descent).toBe("none");
    expect(buildPondHistory(rows, { arm: "cont" }).endedAt).toBeNull();
    expect(buildPondHistory(rows).endedAt).toBeNull();
    expect(buildPondHistory(rows, { arm: "scaf" }).endedAt).toBe(1);
  });
});

describe("dossier shape", () => {
  it("is plain JSON with the kind and version, the resolved rule and a gaps list", () => {
    const d = pondDossier(history(TREE, "scaf"), { kind: "top" });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(d).toMatchObject({ kind: "pond", dossierVersion: DOSSIER_VERSION, arm: "scaf", descent: "donor-packet" });
    expect(d.dossierVersion).toBe(1);
    expect(d.subject.rule).toEqual({ kind: "top", cycle: 4, cycleDefaulted: true });
    expect(d.history).toEqual({ ponds: 4, firstCycle: 1, lastCycle: 4, period: 100, endedAt: null });
    expect(d.gaps.length).toBeGreaterThan(0);
    expect(d.notes.some((n) => n.includes("in arm scaf"))).toBe(true);
    expect(d.warnings).toEqual([]);
  });

  it("does not claim a tied top pond is a donor", () => {
    // Four equal ponds, one donor slot: the scaffold picked pond 1 by its random key, the top rule picks pond 0.
    const tie = history([
      { traits: [9, 9, 9, 9], donors: [1, 1, 1, 1] },
      { traits: [5, 6, 7, 8], donors: [3, 3, 3, 3] },
    ], "scaf");
    const d = pondDossier(tie, { kind: "top", cycle: 1 });
    expect(d.subject).toMatchObject({ pond: 0, tied: 4 });
    expect(d.offspring!.count).toBe(0);
    const note = d.notes.find((n) => n.includes("in arm scaf"))!;
    expect(note).toMatch(/4 ponds tie for the top trait/);
    expect(note).not.toMatch(/always has children/);
  });

  it("flags a missing arm as a gap", () => {
    expect(pondDossier(history(TREE), { kind: "top" }).gaps.some((g) => g.startsWith("arm: not supplied"))).toBe(true);
  });
});

describe("pondTwin", () => {
  const scaf = history(TREE, "scaf");
  // A rand history with three cycles in which pond 2 leads at the end.
  const rand = history(
    [
      { traits: [10, 20, 30, 40], donors: [3, 3, 2, 1] },
      { traits: [5, 0, 10, 30], donors: [3, 3, 3, 2] },
      { traits: [0, 8, 9, 0], donors: [2, 2, 1, 1] },
    ],
    "rand",
  );

  it("applies one rule to both histories at the cycle both reached", () => {
    const t = pondTwin(scaf, rand, { kind: "top" });
    expect(t).toMatchObject({ kind: "pond-twin", dossierVersion: 1 });
    expect(t.rule).toEqual({ kind: "top", cycle: 3, cycleDefaulted: true });
    expect(t.scaf.subject).toMatchObject({ pond: 2, cycle: 3, trait: 45 });
    expect(t.rand.subject).toMatchObject({ pond: 2, cycle: 3, trait: 9 });
    expect(t.scaf.arm).toBe("scaf");
    expect(t.rand.arm).toBe("rand");
    expect(t.notes.join(" ")).toMatch(/cycles 4 and 3.*uses 3/);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });

  it("repeats an explicit node and a seeded pick", () => {
    const e = pondTwin(scaf, rand, { kind: "explicit", pond: 1, cycle: 2 });
    expect([e.scaf.subject.pond, e.rand.subject.pond, e.scaf.subject.cycle, e.rand.subject.cycle]).toEqual([1, 1, 2, 2]);
    const r = pondTwin(scaf, rand, { kind: "random", seed: 11, cycle: 2 });
    expect(r.scaf.subject.rule).toEqual(r.rand.subject.rule);
    expect(r.scaf.subject.pickIndex).toBe(seededPick(11, 2, r.scaf.subject.candidates));
    expect(r.rand.subject.pickIndex).toBe(seededPick(11, 2, r.rand.subject.candidates));
  });

  it("refuses swapped arms and different pond counts", () => {
    expect(() => pondTwin(rand, scaf, { kind: "top" })).toThrow(/expected scaf/);
    const small = history([{ traits: [1, 2], donors: [-1, -1] }], "rand");
    expect(() => pondTwin(scaf, small, { kind: "top" })).toThrow(/4 and 2 ponds/);
  });
});
