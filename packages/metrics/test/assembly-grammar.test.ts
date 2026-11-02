import { describe, expect, it } from "vitest";
import { canonicalKey, code, isConnected, log2ceil, normalise } from "../src/assembly/grammar.ts";
import { segment } from "../src/assembly/segment.ts";
import { exactConstruction } from "../src/assembly/exact.ts";
import { boundConstruction, chainDag, validateDag } from "../src/assembly/bound.ts";
import { ConstructionService } from "../src/assembly/construct.ts";
import { growShape } from "../src/assembly/fixtures.ts";
import { patchReadouts } from "../src/assembly/readouts.ts";

const P = (rows: string[]) => { const pts: [number, number][] = []; rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "#") pts.push([x, y]); })); return normalise(pts); };
const EX = { conn: 4 as const, group: "T" as const, budget: 5_000_000 };
const BEAM = { conn: 4 as const, beamW: 8, nodeCap: 20000, maxCand: 10 };
const block = (w: number, h: number) => P(Array.from({ length: h }, () => "#".repeat(w)));

function frameOf(w: number, h: number, cells: [number, number][]): Uint8Array {
  const f = new Uint8Array(w * h);
  for (const [x, y] of cells) f[((y + h) % h) * w + ((x + w) % w)] = 1;
  return f;
}

describe("canonical forms", () => {
  it("canonical forms: translation and D4", () => {
    const L = P(["#.", "##"]);
    const shifted = normalise([[5, 7], [5, 8], [6, 8]]);
    expect(canonicalKey(shifted, "T")).toBe(canonicalKey(L, "T"));
    const rot = P(["##", "#."]);
    const refl = P([".#", "##"]);
    expect(canonicalKey(rot, "T")).not.toBe(canonicalKey(L, "T"));
    expect(canonicalKey(refl, "T")).not.toBe(canonicalKey(L, "T"));
    for (const o of [rot, refl, shifted]) expect(canonicalKey(o, "D4")).toBe(canonicalKey(L, "D4"));
    expect(canonicalKey(P(["##"]), "D4")).toBe(canonicalKey(P(["#", "#"]), "D4"));
    // chirality: S and Z tetrominoes are mirror images; D4 includes reflection, so they merge, T keeps them apart
    const S = P([".##", "##."]), Z = P(["##.", ".##"]);
    expect(canonicalKey(S, "T")).not.toBe(canonicalKey(Z, "T"));
    expect(canonicalKey(S, "D4")).toBe(canonicalKey(Z, "D4"));
  });
});

describe("segmentation", () => {
  it("4 vs 8 connectivity, torus wrap and spans", () => {
    const w = 16, h = 16;
    const diag = frameOf(w, h, [[3, 3], [4, 4]]);
    expect(segment(diag, w, h, { conn: 4, tau: 1 })).toHaveLength(2);
    expect(segment(diag, w, h, { conn: 8, tau: 1 })).toHaveLength(1);
    // a domino across the vertical and horizontal seams is the same class as an interior domino
    const seam = segment(frameOf(w, h, [[15, 15], [0, 15]]), w, h, { conn: 4, tau: 1 });
    expect(seam).toHaveLength(1);
    expect(seam[0].cells.join(",")).toBe(P(["##"]).join(","));
    const seamV = segment(frameOf(w, h, [[15, 15], [15, 0]]), w, h, { conn: 4, tau: 1 });
    expect(seamV[0].cells.join(",")).toBe(P(["#", "#"]).join(","));
    // full-width ring spans; a tau above the values empties the patch
    const ring = frameOf(w, h, Array.from({ length: w }, (_, x) => [x, 5] as [number, number]));
    const r = segment(ring, w, h, { conn: 4, tau: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].spans).toBe(true);
    expect(segment(diag, w, h, { conn: 4, tau: 2 })).toHaveLength(0);
    // an L across a corner seam keeps its shape (lifted offsets)
    const corner = segment(frameOf(w, h, [[15, 15], [0, 15], [15, 0]]), w, h, { conn: 4, tau: 1 });
    expect(corner[0].cells.join(",")).toBe(canonicalKey(P(["##", "#."])));
  });

  it("a shape translated across both seams keeps its class", () => {
    const shape: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1]];
    const w = 20, h = 20;
    const keys = new Set<string>();
    for (const [ox, oy] of [[3, 4], [18, 19], [19, 0], [0, 19], [17, 18]]) {
      const o = segment(frameOf(w, h, shape.map(([x, y]) => [x + ox, y + oy] as [number, number])), w, h, { conn: 4, tau: 1 });
      expect(o).toHaveLength(1);
      expect(o[0].spans).toBe(false);
      keys.add(o[0].cells.join(","));
    }
    expect(keys.size).toBe(1);
  });
});

describe("exact construction length", () => {
  // Hand-derived values. Each derivation is the argument in the comment.
  const TABLE: [string, string[], number][] = [
    ["monomer", ["#"], 0], // no joins: monomers are free
    ["domino", ["##"], 1], // monomer + monomer
    ["I-tromino", ["###"], 2], // domino, then domino + monomer: no single join makes 3 cells from monomers
    ["2x2 square", ["##", "##"], 2], // domino, then two translates of the domino (one pool member, reused)
    ["I-tetromino", ["####"], 2], // domino, then the domino joined to itself
    ["L-tromino", ["#.", "##"], 2], // domino, then domino + monomer
    ["1x8 line", ["########"], 3], // doubling: 2, 4, 8
    ["2x4 block", ["####", "####"], 3], // 2x2 (2 joins), then 2x2 joined to itself
    // plus pentomino: 3 joins would need a connected 3+2 split of the plus or a 2-join tetromino plus a monomer; the plus has
    // neither (removing one arm leaves the T-tetromino whose own cost is 3, any 3+2 split disconnects the centre), so 4.
    ["plus pentomino", [".#.", "###", ".#."], 4],
  ];
  for (const [name, rows, want] of TABLE) {
    it(`exact value ${name} = ${want}`, () => {
      const r = exactConstruction(P(rows), EX);
      expect(r.exact).toBe(true);
      expect(r.cost).toBe(want);
      expect(validateDag(P(rows), r.dag, 4).problems).toEqual([]);
    });
  }

  it("D4 and T give the same a but different class counts", () => {
    const L = P(["#.", "##"]), Lr = P(["##", "#."]);
    expect(exactConstruction(L, { ...EX, group: "D4" }).cost).toBe(2);
    expect(exactConstruction(Lr, { ...EX, group: "D4" }).cost).toBe(2);
    const w = 24, h = 24;
    const frame = frameOf(w, h, [[2, 2], [2, 3], [3, 3], [10, 10], [11, 10], [10, 11]]);
    const r = patchReadouts(frame, w, h, { conn: 4, tau: 1 }, new ConstructionService());
    expect(r.equiv.classesT).toBe(2);
    expect(r.equiv.classesD4).toBe(1);
    expect(r.copies.T.withCopies).toBe(0);
    expect(r.copies.D4.withCopies).toBe(1);
  });

  it("trivial bounds hold for every fixed polyomino up to n = 6, and exact beats the chain only through reuse", () => {
    let cur = new Map<string, number[]>([[canonicalKey(P(["#"])), P(["#"])]]);
    for (let n = 1; n <= 6; n++) {
      for (const cells of cur.values()) {
        const r = exactConstruction(cells, EX);
        expect(r.exact).toBe(true);
        expect(r.cost).toBeGreaterThanOrEqual(log2ceil(n));
        expect(r.cost).toBeLessThanOrEqual(Math.max(0, n - 1));
        expect(isConnected(cells, 4)).toBe(true);
      }
      const next = new Map<string, number[]>();
      for (const cells of cur.values()) for (const c of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = (c % 1024) + dx + 1, y = Math.floor(c / 1024) + dy + 1; // shift by 1 so nothing goes negative
        const grown = normalise([...cells.map((q) => [(q % 1024) + 1, Math.floor(q / 1024) + 1] as [number, number]), [x, y]]);
        if (new Set(grown).size === n + 1) next.set(canonicalKey(grown), grown);
      }
      cur = next;
    }
    expect(cur.size).toBe(760); // fixed heptominoes: the enumeration is complete
  });

  it("reuse is free, copies are not", () => {
    // 2x2 costs 2 because one domino is built once and used twice
    expect(exactConstruction(P(["##", "##"]), EX).cost).toBe(2);
    // two separate dominoes far apart are two objects with a = 1 each, and the shared bound is 1 (one class)
    const w = 24, h = 24;
    const frame = frameOf(w, h, [[2, 2], [3, 2], [12, 12], [13, 12]]);
    const r = patchReadouts(frame, w, h, { conn: 4, tau: 1 }, new ConstructionService());
    expect(r.objects).toBe(2);
    expect(r.construction.sumA).toBe(2);
    expect(r.construction.sharedBound).toBe(1);
  });

  it("exact budget exhaustion degrades to a bound", () => {
    const cells = growShape(10, 7, 12345);
    const full = exactConstruction(cells, EX);
    expect(full.exact).toBe(true);
    const tiny = exactConstruction(cells, { ...EX, budget: 1 });
    expect(tiny.exact).toBe(false);
    const b = boundConstruction(cells, BEAM);
    expect(b.cost).toBeGreaterThanOrEqual(full.cost);
    expect(validateDag(cells, b.dag, 4).problems).toEqual([]);
  });
});

describe("bounded search", () => {
  it("bound is an upper bound and a completed, valid DAG", () => {
    for (let s = 0; s < 12; s++) {
      const cells = growShape(8 + (s % 3), 6, 900 + s);
      const e = exactConstruction(cells, EX);
      const b = boundConstruction(cells, BEAM);
      expect(b.cost).toBeGreaterThanOrEqual(e.cost);
      expect(b.cost).toBeLessThanOrEqual(cells.length - 1);
      expect(b.dag.length).toBe(b.cost);
      expect(validateDag(cells, b.dag, 4).problems).toEqual([]);
    }
    const big = block(8, 8);
    const b = boundConstruction(big, BEAM);
    expect(b.cost).toBeLessThanOrEqual(63);
    expect(b.cost).toBeLessThanOrEqual(2 * log2ceil(64) + 2);
    expect(validateDag(big, b.dag, 4).problems).toEqual([]);
  });

  it("the validator rejects broken DAGs", () => {
    const cells = block(2, 2);
    const good = boundConstruction(cells, BEAM);
    const bad = good.dag.map((e) => ({ ...e }));
    bad[bad.length - 1] = { ...bad[bad.length - 1], b: bad[bad.length - 1].a }; // overlapping parts
    expect(validateDag(cells, bad, 4).ok).toBe(false);
    expect(validateDag(cells, good.dag.slice(0, -1), 4).ok).toBe(false); // target never built
    const stray = good.dag.map((e) => ({ ...e }));
    stray[0] = { ...stray[0], a: [code(40, 40)] };
    expect(validateDag(cells, stray, 4).ok).toBe(false);
    expect(validateDag(cells, chainDag(cells, 4), 4).ok).toBe(true);
  });

  it("sharedBound exposes duplication while per-object a is identical for every copy", () => {
    const motif = growShape(10, 7, 4242);
    const w = 64, h = 64;
    const frame = new Uint8Array(w * h);
    for (let i = 0; i < 6; i++) for (const c of motif) frame[(Math.floor(c / 1024) + 9 * Math.floor(i / 3)) * w + ((c % 1024) + 10 * (i % 3))] = 1;
    const svc = new ConstructionService();
    const r = patchReadouts(frame, w, h, { conn: 4, tau: 1 }, svc);
    expect(r.objects).toBe(6);
    expect(r.classes).toHaveLength(1);
    expect(r.copies.T.maxCopies).toBe(6);
    expect(r.construction.sumA).toBe(6 * r.classes[0].a);
    expect(r.construction.sharedBound!).toBeLessThan(r.construction.sumA);
    expect(r.construction.sharedBound).toBe(r.classes[0].a);
    // the shared construction is a valid DAG
    const traced = new ConstructionService();
    traced.trace = [];
    traced.shared([{ key: motif.join(","), cells: motif }], 4);
    for (const t of traced.trace) expect(validateDag(t.target, t.dag, 4, new Set(t.free)).problems).toEqual([]);
  });
});
