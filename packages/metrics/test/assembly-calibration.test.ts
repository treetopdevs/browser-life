import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COMPOSITE_12, CLASS_IDS, SEAM_IDS, buildPatch, defaultSolver, growShape, type ClassId } from "../src/assembly/fixtures.ts";
import { PROTOCOL } from "../src/assembly/protocol.ts";
import { ConstructionService } from "../src/assembly/construct.ts";
import { patchReadouts, rat } from "../src/assembly/readouts.ts";
import { bestDirection, decideVerdict, pairAccuracy, verdictSentence } from "../src/assembly/verdict.ts";
import { segment } from "../src/assembly/segment.ts";
import { exactConstruction } from "../src/assembly/exact.ts";
import { ASSEMBLY_VERSION } from "../src/assembly/version.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ALL: ClassId[] = [...CLASS_IDS, ...SEAM_IDS];
// Replicate-0 digests per ASSEMBLY_VERSION. A change here is a fixture change and needs a dated amendment.
const PINNED: Record<string, string> = {
  "tile-repeat": "615b69a7c9bbb7e64b32753f1fac925c11b34133d5628244613690b9ce85a039",
  "crystal-lattice": "98f4281ed901fb33caf2c044209011d6c33e9b7047ec6f6f66918be5f37770c5",
  "crystal-spaced": "3ecd0925c1ad14271a7b5651aa81fbe2c6326ea3bbf6be8348397c0fa37f1f6d",
  "random-field": "d18ccd362b386e1aaf7996ec0a4ba2390af7bcfa4ef82f83b251d89177c8f7d7",
  "random-dup": "3aea194e7990075262f7d980c8e284566baf23272cca5a82bea0cbea2290a63a",
  "random-dup-hi": "4c7fcc31359ae3d294dc853dab284274df6ae97bc372811c6e15546ab682a19d",
  "random-dup-12": "8baf7c2e22c67e8e79b162c258f194b16a26235345f1c5cdf50708c045be0a30",
  "hier-12": "6c09a0c7c71e8664fc2cd68d12821abc0137284d5fe0fcd26a374485d5d04133",
  "hierarchy": "5e1757eedf718206786590cc5e215e1be9ee8fb50cd8dfd72d9312ab367dd8cc",
  "hierarchy-mixed": "89a9927ce0dcdcf52321ad130466715e8acb9a73c9e6f92e3e00021596f5268e",
  "random-scatter": "e0fff8b2a9de90a484eaec97298f80926b05ca0711cb2b2876c42c00891ffc83",
  "seam-hier-12": "3c129cbed7d95deda0c2c365a60ce7b7eede684e210c7cee3b0c03f7ab858c3e",
  "seam-dup-12": "452dd743ccf57ea591fbd2434b33a008228788b7184418f48d6ce6d93cca91a6",
};

describe("calibration fixtures", () => {
  it("matched mass: every class has exactly 240 occupied cells, padding recorded", () => {
    for (const id of ALL) for (let r = 0; r < 3; r++) {
      const p = buildPatch(id, r);
      let n = 0; for (const v of p.frame) n += v;
      expect(n, `${id} r${r}`).toBe(PROTOCOL.patch.mass);
      expect(p.meta.occupied + p.meta.padding).toBe(PROTOCOL.patch.mass);
      expect(p.meta.padding).toBe(0);
    }
  }, 120_000);

  it("fixtures are deterministic and pinned per ASSEMBLY_VERSION", () => {
    expect(ASSEMBLY_VERSION).toBe(1);
    for (const id of ALL) {
      const a = sha(buildPatch(id, 0).frame), b = sha(buildPatch(id, 0).frame);
      expect(a).toBe(b);
      expect(PINNED[id], `pin for ${id}`).toBe(a);
      expect(sha(buildPatch(id, 1).frame)).not.toBe(a);
    }
  }, 120_000);

  it("spaced classes: 4 and 8 segmentation agree; seam-touch classes differ", () => {
    for (const id of ["tile-repeat", "crystal-spaced", "random-field", "random-dup", "hier-12", "hierarchy", "hierarchy-mixed", "random-dup-12"] as ClassId[]) {
      const p = buildPatch(id, 0);
      expect(segment(p.frame, p.w, p.h, { conn: 4, tau: 1 }).length, id).toBe(segment(p.frame, p.w, p.h, { conn: 8, tau: 1 }).length);
    }
    for (const id of SEAM_IDS) {
      const p = buildPatch(id, 0);
      expect(segment(p.frame, p.w, p.h, { conn: 4, tau: 1 })).toHaveLength(20);
      expect(segment(p.frame, p.w, p.h, { conn: 8, tau: 1 })).toHaveLength(10);
    }
  }, 120_000);

  it("matched pair: hier-12 and random-dup-12 share size, count, multiplicity and placement", () => {
    const h = buildPatch("hier-12", 2), d = buildPatch("random-dup-12", 2);
    const sh = segment(h.frame, h.w, h.h, { conn: 4, tau: 1 }), sd = segment(d.frame, d.w, d.h, { conn: 4, tau: 1 });
    expect(sh.map((o) => o.n)).toEqual(Array(20).fill(12));
    expect(sd.map((o) => o.n)).toEqual(Array(20).fill(12));
    // the slot origins (min corner of each shape's bounding box region) coincide because placement depends only on (seed, replicate, pitch)
    const slot = (f: Uint8Array, a: number) => { const x = a % 64, y = Math.floor(a / 64); return `${Math.floor(x / 8)},${Math.floor(y / 8)}`; };
    const cellsSlots = (f: Uint8Array) => new Set([...f.keys()].filter((i) => f[i]).map((i) => slot(f, i)));
    expect([...cellsSlots(h.frame)].sort()).toEqual([...cellsSlots(d.frame)].sort());
  });

  it("random-dup motifs are internally unstructured: exact a at the frozen floor, and a = 9 is unattainable", () => {
    for (let r = 0; r < 2; r++) {
      const p = buildPatch("random-dup", r);
      expect(p.meta.motifs).toHaveLength(4);
      expect(new Set(p.meta.motifs.map((m) => m.key)).size).toBe(4);
      for (const m of p.meta.motifs) { expect(m.status).toBe("exact"); expect(m.a).toBeGreaterThanOrEqual(PROTOCOL.motif.floorA10); expect(m.copies).toBe(6); }
    }
    // generator terminates and a never exceeds n - 2 on 10-cell shapes (every connected 10-cell object holds two disjoint equal dominoes)
    const solve = defaultSolver();
    for (let s = 0; s < 40; s++) expect(solve(growShape(10, PROTOCOL.motif.box, 700 + s)).a).toBeLessThanOrEqual(8);
  }, 120_000);

  it("hand-built programs have the recorded nested reuse", () => {
    const p = buildPatch("hier-12", 0);
    expect(p.meta.motifs[0].a).toBe(4);
    expect(p.meta.motifs[0].status).toBe("bound"); // 12 cells is above exactMaxN, so the recorded value is the bound
    const e = exactConstruction(COMPOSITE_12, { conn: 4, group: "T", budget: 5_000_000 });
    expect(e.exact).toBe(true);
    expect(e.cost).toBe(4); // monomer, domino, I-tromino, 2x3 block, composite
  });
});

describe("readout rules on constructed inputs", () => {
  it("naive metric algebra: copyWeightedConstruction = sum a * (copies - 1) and grows with duplication", () => {
    const motif = growShape(8, 6, 99);
    const place = (copies: number) => {
      const f = new Uint8Array(64 * 64);
      for (let i = 0; i < copies; i++) for (const c of motif) f[(Math.floor(c / 1024) + 9 * Math.floor(i / 5)) * 64 + (c % 1024) + 10 * (i % 5)] = 1;
      return f;
    };
    const svc = new ConstructionService();
    const a = svc.solve(motif, 4).a;
    const r2 = patchReadouts(place(2), 64, 64, { conn: 4, tau: 1 }, svc), r4 = patchReadouts(place(4), 64, 64, { conn: 4, tau: 1 }, svc);
    expect(r2.copies.T.copyWeightedConstruction).toBe(a * 1);
    expect(r4.copies.T.copyWeightedConstruction).toBe(a * 3);
    // per-object a does not change with duplication; the shared bound does not either
    expect(r4.construction.sharedBound).toBe(r2.construction.sharedBound);
  });

  it("pair accuracy: exact rationals, ties count one half", () => {
    const pos = [rat(1, 1), rat(2, 1)], neg = [rat(2, 1), rat(3, 1)];
    expect(pairAccuracy(pos, neg, "lower")).toEqual({ num: 7, den: 8 }); // 3 wins + 1 tie of 4 pairs: (6 + 1) / 8
    expect(pairAccuracy(pos, neg, "higher")).toEqual({ num: 1, den: 8 });
    expect(pairAccuracy([rat(1, 2)], [rat(2, 4)], "lower")).toEqual({ num: 1, den: 2 });
    expect(bestDirection(pos, neg)).toEqual({ num: 7, den: 8 });
  });

  it("incremental over baselines: occupancy ties while a readout orders", () => {
    const occ = Array(4).fill(rat(240, 1));
    expect(bestDirection(occ, occ)).toEqual({ num: 16, den: 32 });
    const lowA = [rat(4, 1), rat(4, 1)], highA = [rat(9, 1), rat(10, 1)];
    expect(pairAccuracy(lowA, highA, "lower")).toEqual({ num: 8, den: 8 });
  });

  it("verdict rule on constructed scores covers every branch", () => {
    const base = { direction: "lower" as const, hasNull: false, dupNegativesOrdered: true, baselineBest: rat(1, 2) };
    const cell = (id: string, separates: boolean) => ({ id, separates });
    const all = [cell("spaced-4", true), cell("spaced-8", true), cell("seam-4", true), cell("seam-8", true)];
    expect(decideVerdict({ ...base, cells: all }).verdict).toBe("separates, adds value over simple baselines");
    expect(decideVerdict({ ...base, cells: all, baselineBest: rat(1, 1) }).verdict).toBe("separates, but not beyond baselines");
    expect(decideVerdict({ ...base, cells: all.map((c) => ({ ...c, separates: false })) }).verdict).toBe("fails to separate");
    expect(decideVerdict({ ...base, cells: [cell("spaced-4", true), cell("seam-8", false)] }).verdict).toBe("segmentation-dominated");
    expect(decideVerdict({ ...base, dupNegativesOrdered: false, cells: all }).verdict).toBe("fails to separate");
    expect(decideVerdict({ ...base, direction: null, cells: all }).verdict).toBe("not directional");
    expect(decideVerdict({ ...base, hasNull: true, cells: all }).verdict).toBe("measurement-limited");
    expect(verdictSentence("fails to separate")).toContain("no life-detection claim");
  });

  it("equivalence uncertainty: zero for symmetric-free copies, positive for a chiral pair", () => {
    const put = (w: number, cells: [number, number][]) => { const f = new Uint8Array(w * w); for (const [x, y] of cells) f[y * w + x] = 1; return f; };
    const svc = new ConstructionService();
    const same = patchReadouts(put(24, [[2, 2], [3, 2], [12, 12], [13, 12]]), 24, 24, { conn: 4, tau: 1 }, svc);
    expect(same.equiv.spread).toBe(0);
    const chiral = patchReadouts(put(24, [[3, 2], [4, 2], [2, 3], [3, 3], [12, 12], [13, 12], [13, 13], [14, 13]]), 24, 24, { conn: 4, tau: 1 }, svc);
    expect(chiral.equiv.classesT).toBe(2);
    expect(chiral.equiv.classesD4).toBe(1);
    expect(chiral.equiv.spread).toBeGreaterThan(0);
  });
});
