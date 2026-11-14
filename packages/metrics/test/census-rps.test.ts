import { describe, expect, it } from "vitest";
import { CH, G } from "@bl/schema";
import {
  RPS_CENSUS_COLUMNS,
  RPS_CENSUS_HEADER,
  RPS_CHI_MIN_CHANGES,
  RPS_MAX_LABELS,
  RPS_MIRROR_SHIFT,
  RPS_NO_LABEL,
  RPS_PRESENT_SHARE,
  RPS_SUPPLY_MIN_CELLS,
  RPS_TYPE_SHIFT,
  RPS_MASK_SHIFT,
  RpsCensusParseError,
  chirality,
  cleanCycleLength,
  correlationLength,
  dominanceEdges,
  encodeRpsFinal,
  formatRpsCensusRow,
  labelMixingW,
  mutantSupply,
  parseRpsCensusTsv,
  parseRpsFinal,
  rpsCensus,
  rpsCensusRecord,
  rpsChanges,
  rpsCoexist,
  rpsFinalMeasures,
  rpsIsPresent,
  rpsLabels,
  rpsMaskOf,
  rpsMirrorMismatches,
  rpsMirrorOf,
  rpsTypeOf,
  zCoherence,
  type RpsCensusRecord,
} from "@bl/metrics";

// ---- hand-built snapshots ----

interface World {
  dims: { W: number; H: number; D: number };
  n: number;
  snap: { cells: Uint32Array; genomeHead: Uint32Array };
}
const mk = (W: number, H: number, D: number): World => {
  const n = W * H * D;
  return { dims: { W, H, D }, n, snap: { cells: new Uint32Array(7 * n), genomeHead: new Uint32Array(4 * n) } };
};
interface Put {
  type: number;
  mask?: number;
  lin?: [number, number];
  B?: number;
  P?: number;
  mot?: number;
}
/** Makes cell `i` living with the given type, mask, lineage (default founder 0:1), B, P and MOT word. */
const put = (w: World, i: number, o: Put) => {
  const { n, snap } = w;
  const lin = o.lin ?? [0, 1];
  snap.genomeHead[G.LIN_HI * n + i] = lin[0];
  snap.genomeHead[G.LIN_LO * n + i] = lin[1];
  snap.genomeHead[G.PARAM1 * n + i] = ((o.type << 8) | ((o.mask ?? 0) << 16)) >>> 0;
  snap.cells[CH.B * n + i] = o.B ?? 10;
  snap.cells[CH.P * n + i] = o.P ?? 0;
  snap.cells[CH.MOT * n + i] = o.mot ?? 0;
};
/** Cells `from .. from + count - 1` all get the same description. */
const fill = (w: World, from: number, count: number, o: Put) => {
  for (let i = from; i < from + count; i++) put(w, i, o);
};
/** The cyclic mask of the starting ecology: type t kills (t + 1) mod K. */
const cyc = (t: number, K: number) => 1 << ((t + 1) % K);

describe("constants (pinned: Part A changes no schema file)", () => {
  it("PARAM1 holds the type in byte 1 and the mask in byte 2, MOT the mirror in bits 24..31", () => {
    expect(RPS_TYPE_SHIFT).toBe(8);
    expect(RPS_MASK_SHIFT).toBe(16);
    expect(RPS_MIRROR_SHIFT).toBe(24);
    expect(RPS_MAX_LABELS).toBe(8);
    // plan 4.4: the three founder words, motGain 0
    const founders = [0x00020000, 0x00040100, 0x00010200];
    expect(founders.map(rpsTypeOf)).toEqual([0, 1, 2]);
    expect(founders.map(rpsMaskOf)).toEqual([2, 4, 1]);
    expect(founders.map((t, k) => (cyc(k, 3) === rpsMaskOf(t) ? 1 : 0))).toEqual([1, 1, 1]);
    // the motility-gain byte and the reserved byte do not leak into either field
    // motGain 0x7f (byte 0), type 0x05 (byte 1), mask 0x03 (byte 2), reserved 0xff (byte 3)
    expect(rpsTypeOf(0xff03057f)).toBe(0x05);
    expect(rpsMaskOf(0xff03057f)).toBe(0x03);
    expect(rpsTypeOf(0x000202ff)).toBe(2); // motGain 0xff
    expect(rpsMaskOf(0x000202ff)).toBe(2);
    // plan 4.3 mirror example: a type-0 lineage with mask 0b010 has MOT 0x02808080; a type-1 victim reads bit 1 of the mask
    expect(rpsMirrorOf(0x02808080)).toBe(2);
    expect((0x02808080 >>> (RPS_MIRROR_SHIFT + 1)) & 1).toBe(1);
    // K = 8: mask bit 7 is MOT bit 31
    expect(rpsMirrorOf(0x80808080)).toBe(0x80);
  });

  it("the schema channel positions the census reads", () => {
    expect([CH.B, CH.P, CH.MOT]).toEqual([1, 3, 6]);
    expect([G.LIN_HI, G.LIN_LO, G.PARAM1]).toEqual([0, 1, 3]);
  });

  it("the thresholds of rule draft 0, 7.3 and D13", () => {
    expect(RPS_PRESENT_SHARE).toBe(0.02);
    expect(RPS_CHI_MIN_CHANGES).toBe(200);
    expect(RPS_SUPPLY_MIN_CELLS).toBe(64);
    expect(RPS_NO_LABEL).toBe(255);
  });
});

describe("rpsCensus: living, labels, shares, present, coexist", () => {
  it("a world with no living cells has no labels, no shares, nothing present, Y 0 and no z-coherence", () => {
    const w = mk(8, 8, 2);
    const c = rpsCensus(w.snap, w.dims, { supply: true });
    expect(c.total).toBe(128);
    expect(c.living).toBe(0);
    expect(c.liv).toBe(0);
    expect(c.byLabel).toEqual(new Array(8).fill(0));
    expect(c.shares).toEqual(new Array(8).fill(0));
    expect(c.present).toEqual(new Array(8).fill(false));
    expect(c.S).toEqual([]);
    expect(c.n).toBe(0);
    expect(c.modal).toEqual(new Array(8).fill(null));
    expect(c.Y).toBe(0);
    expect(c.zcoh).toBeNull();
    expect(c.supply).toBe(0);
    expect(Array.from(c.labels).every((l) => l === RPS_NO_LABEL)).toBe(true);
    expect(rpsCoexist(c.present, 3)).toBe(false);
    expect(correlationLength(c.labels, w.dims).xi).toBeNull();
  });

  it("a cell with a nonzero lineage word is living even with no mass; a cell with mass but a zero lineage is not", () => {
    const w = mk(4, 4, 1);
    put(w, 0, { type: 1, B: 0, P: 0, lin: [0, 1] });
    put(w, 1, { type: 2, B: 0, P: 0, lin: [3, 0] });
    put(w, 2, { type: 0, B: 50, P: 50, lin: [0, 0] }); // not living: both lineage words 0
    const c = rpsCensus(w.snap, w.dims);
    expect(c.living).toBe(2);
    expect(c.byLabel[1]).toBe(1);
    expect(c.byLabel[2]).toBe(1);
    expect(c.byLabel[0]).toBe(0);
    expect(c.labels[2]).toBe(RPS_NO_LABEL);
  });

  it("one label: share 1, present, n 1, no cycle, no coexistence for K0 of 3", () => {
    const w = mk(8, 8, 1);
    fill(w, 0, 10, { type: 1, mask: 4 });
    const c = rpsCensus(w.snap, w.dims);
    expect(c.living).toBe(10);
    expect(c.liv).toBeCloseTo(10 / 64, 12);
    expect(c.shares[1]).toBe(1);
    expect(c.present).toEqual([false, true, false, false, false, false, false, false]);
    expect(c.S).toEqual([1]);
    expect(c.n).toBe(1);
    expect(c.Y).toBe(0);
    expect(rpsCoexist(c.present, 3)).toBe(false);
    expect(c.modal[1]).toBe(4);
  });

  it("the share threshold is exactly 2 %: 1 of 50 is present, 1 of 51 is not", () => {
    expect(rpsIsPresent(1, 50)).toBe(true);
    expect(rpsIsPresent(1, 51)).toBe(false);
    expect(rpsIsPresent(0, 0)).toBe(false);
    expect(rpsIsPresent(5, 0)).toBe(false);
    const a = mk(16, 16, 1);
    fill(a, 0, 49, { type: 0 });
    put(a, 100, { type: 2 });
    const ca = rpsCensus(a.snap, a.dims);
    expect(ca.living).toBe(50);
    expect(ca.shares[2]).toBe(0.02);
    expect(ca.present[2]).toBe(true);
    const b = mk(16, 16, 1);
    fill(b, 0, 50, { type: 0 });
    put(b, 100, { type: 2 });
    const cb = rpsCensus(b.snap, b.dims);
    expect(cb.living).toBe(51);
    expect(cb.present[2]).toBe(false);
    expect(cb.S).toEqual([0]);
  });

  it("coexist needs every founding label 0 .. K0 - 1 present; extra labels do not matter", () => {
    const w = mk(16, 16, 1);
    fill(w, 0, 40, { type: 0 });
    fill(w, 40, 40, { type: 1 });
    expect(rpsCoexist(rpsCensus(w.snap, w.dims).present, 3)).toBe(false);
    fill(w, 80, 40, { type: 2 });
    expect(rpsCoexist(rpsCensus(w.snap, w.dims).present, 3)).toBe(true);
    fill(w, 120, 40, { type: 5 });
    const c = rpsCensus(w.snap, w.dims);
    expect(rpsCoexist(c.present, 3)).toBe(true);
    expect(rpsCoexist(c.present, 4)).toBe(false);
    expect(c.S).toEqual([0, 1, 2, 5]);
    expect(rpsCoexist(new Array(8).fill(false), 0)).toBe(true); // an empty founding set is always contained
  });

  it("mass is B + P summed over the living cells of the label, and per-layer counts add up", () => {
    const w = mk(4, 4, 2);
    put(w, 0, { type: 0, B: 10, P: 3 });
    put(w, 1, { type: 0, B: 5, P: 0 });
    put(w, 16, { type: 1, B: 7, P: 7 }); // layer 1
    put(w, 17, { type: 0, B: 1, P: 1 }); // layer 1
    const c = rpsCensus(w.snap, w.dims);
    expect(c.massByLabel).toEqual([10 + 3 + 5 + 1 + 1, 14, 0, 0, 0, 0, 0, 0]);
    expect(c.layerLabelCells).toEqual([
      [2, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it("refuses a living cell whose type byte is 8 or more, and arrays of the wrong length", () => {
    const w = mk(4, 4, 1);
    put(w, 3, { type: 8 });
    expect(() => rpsCensus(w.snap, w.dims)).toThrow(RangeError);
    expect(() => rpsCensus({ cells: new Uint32Array(5), genomeHead: new Uint32Array(5) }, w.dims)).toThrow(/cells has 5 words/);
    expect(() => rpsLabels(w.snap, { W: 0, H: 4, D: 1 })).toThrow(/bad dimensions/);
  });
});

describe("modal masks", () => {
  it("is the mask held by most living cells of the label, per label", () => {
    const w = mk(8, 8, 1);
    fill(w, 0, 3, { type: 0, mask: 4 });
    fill(w, 3, 2, { type: 0, mask: 2 });
    fill(w, 10, 4, { type: 1, mask: 1 }); // label 1 is independent of label 0's masks
    const c = rpsCensus(w.snap, w.dims);
    expect(c.modal[0]).toBe(4);
    expect(c.modal[1]).toBe(1);
    expect(c.modal[2]).toBeNull();
  });

  it("ties go to the smaller value", () => {
    const w = mk(8, 8, 1);
    fill(w, 0, 3, { type: 0, mask: 4 });
    fill(w, 3, 3, { type: 0, mask: 2 });
    fill(w, 6, 3, { type: 0, mask: 0x80 });
    expect(rpsCensus(w.snap, w.dims).modal[0]).toBe(2);
    // a tie that includes mask 0 (a toothless clone) goes to 0
    fill(w, 9, 3, { type: 0, mask: 0 });
    expect(rpsCensus(w.snap, w.dims).modal[0]).toBe(0);
  });

  it("a label with a single cell still has a modal mask (labels below the present threshold too)", () => {
    const w = mk(16, 16, 1);
    fill(w, 0, 100, { type: 0, mask: 2 });
    put(w, 200, { type: 6, mask: 0x21 });
    const c = rpsCensus(w.snap, w.dims);
    expect(c.present[6]).toBe(false);
    expect(c.modal[6]).toBe(0x21);
  });
});

describe("dominance graph and clean cycle Y_c", () => {
  const modalOf = (masks: Record<number, number>): (number | null)[] => Array.from({ length: 8 }, (_, x) => (x in masks ? masks[x] : null));

  it("the starting 3-cycle is clean: Y = 3", () => {
    expect(cleanCycleLength([0, 1, 2], modalOf({ 0: 2, 1: 4, 2: 1 }))).toBe(3);
  });

  it("edges need both ends present and x != y", () => {
    const adj = dominanceEdges([0, 1], modalOf({ 0: 0b1111, 1: 0 }));
    expect(adj[0][1]).toBe(true);
    expect(adj[0][0]).toBe(false); // bit 0 of label 0's own mask is ignored
    expect(adj[0][2]).toBe(false); // label 2 is not in S
    expect(adj[1][0]).toBe(false);
  });

  it("a mutual pair makes the cycle unclean even if a Hamiltonian cycle exists", () => {
    // 0 -> 1, 1 -> 2, 2 -> 0 and the extra 0 -> 2 (so 0 <-> 2 is mutual)
    expect(cleanCycleLength([0, 1, 2], modalOf({ 0: 0b110, 1: 4, 2: 1 }))).toBe(0);
  });

  it("a chord that is not mutual is allowed: a chorded 4-cycle is clean", () => {
    expect(cleanCycleLength([0, 1, 2, 3], modalOf({ 0: 0b0010, 1: 0b0100, 2: 0b1000, 3: 0b0001 }))).toBe(4);
    expect(cleanCycleLength([0, 1, 2, 3], modalOf({ 0: 0b0110, 1: 0b0100, 2: 0b1000, 3: 0b0001 }))).toBe(4); // chord 0 -> 2
  });

  it("the cycle must pass through every present label", () => {
    // 0 -> 1 -> 2 -> 0 and label 3 present with no edges in or out: no Hamiltonian cycle
    expect(cleanCycleLength([0, 1, 2, 3], modalOf({ 0: 2, 1: 4, 2: 1, 3: 0 }))).toBe(0);
    // label 3 has an edge out (3 -> 0) but nothing points at it
    expect(cleanCycleLength([0, 1, 2, 3], modalOf({ 0: 2, 1: 4, 2: 1, 3: 1 }))).toBe(0);
  });

  it("a Hamiltonian cycle that needs backtracking is found", () => {
    // edges 0->1 (chord), 0->2, 2->1, 1->3, 3->0: the only Hamiltonian cycle is 0 -> 2 -> 1 -> 3 -> 0
    const m = modalOf({ 0: 0b0110, 1: 0b1000, 2: 0b0010, 3: 0b0001 });
    expect(cleanCycleLength([0, 1, 2, 3], m)).toBe(4);
  });

  it("a transitive tournament has no cycle; fewer than three labels never count", () => {
    expect(cleanCycleLength([0, 1, 2], modalOf({ 0: 0b110, 1: 0b100, 2: 0 }))).toBe(0);
    expect(cleanCycleLength([0, 1], modalOf({ 0: 2, 1: 1 }))).toBe(0);
    expect(cleanCycleLength([0], modalOf({ 0: 0 }))).toBe(0);
    expect(cleanCycleLength([], modalOf({}))).toBe(0);
  });

  it("labels outside S are ignored: a bit pointing at an absent label neither adds nor breaks an edge", () => {
    expect(cleanCycleLength([0, 1, 2], modalOf({ 0: 0b1010, 1: 4, 2: 1 }))).toBe(3); // bit 3 of label 0's mask points at an absent label
  });

  it("an eight-label ring is found", () => {
    const masks: Record<number, number> = {};
    for (let t = 0; t < 8; t++) masks[t] = cyc(t, 8);
    expect(cleanCycleLength([0, 1, 2, 3, 4, 5, 6, 7], modalOf(masks))).toBe(8);
  });

  it("through rpsCensus: modal masks of present labels only, a label below 2 % does not break the cycle", () => {
    const w = mk(16, 16, 1);
    fill(w, 0, 60, { type: 0, mask: cyc(0, 3) });
    fill(w, 60, 60, { type: 1, mask: cyc(1, 3) });
    fill(w, 120, 60, { type: 2, mask: cyc(2, 3) });
    put(w, 250, { type: 3, mask: 0b0001 }); // 1 of 181: not present; its mask 3 -> 0 would otherwise matter
    const c = rpsCensus(w.snap, w.dims);
    expect(c.S).toEqual([0, 1, 2]);
    expect(c.Y).toBe(3);
  });
});

describe("z-coherence", () => {
  it("is the share of columns with a living cell whose living cells all carry one label", () => {
    const w = mk(4, 4, 2);
    put(w, 0, { type: 0 }); // column 0, layer 0
    put(w, 16, { type: 0 }); // column 0, layer 1: coherent
    put(w, 1, { type: 0 }); // column 1, layer 0
    put(w, 17, { type: 1 }); // column 1, layer 1: mixed
    put(w, 2, { type: 2 }); // column 2, only layer 0: coherent
    // 3 columns with a living cell, 2 coherent
    const c = rpsCensus(w.snap, w.dims);
    expect(c.zcoh).toBeCloseTo(2 / 3, 12);
    expect(zCoherence(c.labels, w.dims)).toBe(c.zcoh);
  });

  it("an all-coherent world is 1, a fully mixed one 0", () => {
    const a = mk(2, 2, 3);
    for (let i = 0; i < 12; i++) put(a, i, { type: 1 });
    expect(rpsCensus(a.snap, a.dims).zcoh).toBe(1);
    const b = mk(2, 2, 2);
    for (let c = 0; c < 4; c++) {
      put(b, c, { type: 0 });
      put(b, 4 + c, { type: 1 });
    }
    expect(rpsCensus(b.snap, b.dims).zcoh).toBe(0);
  });
});

describe("turnover and the chirality counts", () => {
  const A = (...v: number[]) => Uint8Array.from(v);
  const N = RPS_NO_LABEL;

  it("K0 = 3: a change to the killer of the old label is n_dom, a change to its prey is n_anti; only cells living at both count", () => {
    //            0  1  2  3  4  5  6  7  8  9
    const prev = A(0, 1, 2, 0, 1, 2, N, 0, N, 1);
    const cur = A(1, 0, 0, 0, 2, 1, 0, N, N, 1);
    // cell 0: 0 -> 1, 0 kills 1: anti.  1: 1 -> 0, 0 kills 1: dom.  2: 2 -> 0, 2 kills 0: anti.
    // cell 4: 1 -> 2, 1 kills 2: anti.  5: 2 -> 1, 1 kills 2: dom.  3 and 9 unchanged; 6, 7, 8 are not living at both
    const ch = rpsChanges(prev, cur, 3);
    expect(ch.both).toBe(7);
    expect(ch.changed).toBe(5);
    expect(ch.turnover).toBeCloseTo(5 / 7, 12);
    expect(ch.ndom).toBe(2);
    expect(ch.nanti).toBe(3);
  });

  it("K0 = 4: a change between labels with no kill relation counts in neither", () => {
    // 0 -> 2 and 1 -> 3: no relation.  3 -> 0: 3 kills 0 (anti).  0 -> 3: 3 kills 0 (dom).
    const ch = rpsChanges(A(0, 1, 3, 0), A(2, 3, 0, 3), 4);
    expect(ch.changed).toBe(4);
    expect(ch.ndom).toBe(1);
    expect(ch.nanti).toBe(1);
  });

  it("K0 = 5: the cyclic rule is modulo K0", () => {
    const ch = rpsChanges(A(4, 0, 2), A(0, 4, 3), 5);
    // 4 -> 0: 4 kills 0 (anti).  0 -> 4: 4 kills 0 (dom).  2 -> 3: 2 kills 3 (anti)
    expect(ch.ndom).toBe(1);
    expect(ch.nanti).toBe(2);
  });

  it("labels at or above K0 (mutants) count in neither", () => {
    const ch = rpsChanges(A(0, 1, 5), A(5, 4, 0), 3);
    expect(ch.changed).toBe(3);
    expect(ch.ndom).toBe(0);
    expect(ch.nanti).toBe(0);
  });

  it("no living cell at both censuses: turnover is null; no change: 0", () => {
    expect(rpsChanges(A(0, N), A(N, 0), 3).turnover).toBeNull();
    expect(rpsChanges(A(0, 1, 2), A(0, 1, 2), 3).turnover).toBe(0);
  });

  it("jobs with mutation pass K0 null and get null counts but a turnover", () => {
    const ch = rpsChanges(A(0, 1), A(1, 1), null);
    expect(ch.turnover).toBe(0.5);
    expect(ch.ndom).toBeNull();
    expect(ch.nanti).toBeNull();
  });

  it("refuses a K0 outside 3..8 and arrays of different length", () => {
    expect(() => rpsChanges(A(0), A(0), 2)).toThrow(RangeError);
    expect(() => rpsChanges(A(0), A(0), 9)).toThrow(RangeError);
    expect(() => rpsChanges(A(0), A(0, 1), 3)).toThrow(RangeError);
  });

  it("chains with rpsCensus labels", () => {
    const a = mk(4, 4, 1);
    const b = mk(4, 4, 1);
    for (let i = 0; i < 8; i++) {
      put(a, i, { type: i % 3 });
      put(b, i, { type: (i + 1) % 3 }); // every cell takes the label of its prey: i % 3 -> (i + 1) % 3, anti
    }
    const ch = rpsChanges(rpsCensus(a.snap, a.dims).labels, rpsCensus(b.snap, b.dims).labels, 3);
    expect(ch).toMatchObject({ both: 8, changed: 8, turnover: 1, ndom: 0, nanti: 8 });
  });
});

describe("chirality", () => {
  it("is (n_dom - n_anti) / (n_dom + n_anti) once 200 changes are in the set, and 0 before", () => {
    expect(chirality(150, 50)).toBe(0.5);
    expect(chirality(0, 200)).toBe(-1);
    expect(chirality(200, 0)).toBe(1);
    expect(chirality(100, 100)).toBe(0);
  });

  it("fewer than 200 changes give 0, at the edge 199 and 200", () => {
    expect(chirality(199, 0)).toBe(0);
    expect(chirality(150, 49)).toBe(0);
    expect(chirality(0, 0)).toBe(0);
    expect(chirality(150, 50)).not.toBe(0);
  });

  it("counts only n_dom + n_anti, not changes between unrelated labels", () => {
    // K0 = 4 jobs can have many unrelated changes; the set is the counted ones
    expect(chirality(120, 70)).toBe(0); // 190 counted changes, whatever else changed
  });
});

describe("correlation length xi", () => {
  /** A W x H x 1 layer from a function of (x, y); undefined = not living. */
  const layer = (W: number, H: number, f: (x: number, y: number) => number | undefined) => {
    const labels = new Uint8Array(W * H).fill(RPS_NO_LABEL);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) labels[y * W + x] = f(x, y) ?? RPS_NO_LABEL;
    return labels;
  };

  it("one label: P0 = 1, g = 0, xi is 1 on both axes", () => {
    const labels = layer(8, 8, () => 1);
    const r = correlationLength(labels, { W: 8, H: 8, D: 1 });
    expect(r.xi).toBe(1);
    expect(r.used).toBe(2);
    expect(r.perLayer).toEqual([[1, 1]]);
  });

  it("vertical stripes of width 8 on a 16 x 4 layer: xi 3 along x (g = 0.75, 0.5, 0.25), 33 along y (nothing varies)", () => {
    // P0 = 1/2. Lag 1: 14 of 16 pairs equal, g = 0.75. Lag 2: 12 of 16, g = 0.5. Lag 3: 10 of 16, g = 0.25 < 1/e.
    const labels = layer(16, 4, (x) => (x < 8 ? 0 : 1));
    const r = correlationLength(labels, { W: 16, H: 4, D: 1 });
    expect(r.perLayer).toEqual([[3, 33]]);
    expect(r.xi).toBe(18);
  });

  it("xi uses 1/e, not 1/2: stripes of width 10 on a 20 x 4 layer give g = 0.8, 0.6, 0.4, 0.2 along x, so xi is 4 (0.4 is below 1/2 but not below 1/e)", () => {
    // P0 = 1/2; at lag r, 2 r of every 20 pairs in a row differ, so P(r) = 1 - r / 10 and g(r) = 1 - r / 5
    const labels = layer(20, 4, (x) => (x < 10 ? 0 : 1));
    expect(correlationLength(labels, { W: 20, H: 4, D: 1 }).perLayer).toEqual([[4, 33]]);
  });

  it("alternating labels along x: g(1) = -1, xi 1", () => {
    const labels = layer(16, 4, (x) => x % 2);
    expect(correlationLength(labels, { W: 16, H: 4, D: 1 }).perLayer).toEqual([[1, 33]]);
  });

  it("averages over layers and leaves an empty layer out", () => {
    const stripes = layer(16, 4, (x) => (x < 8 ? 0 : 1));
    const empty = new Uint8Array(64).fill(RPS_NO_LABEL);
    const one = new Uint8Array(64).fill(2);
    const labels = new Uint8Array(64 * 3);
    labels.set(stripes, 0);
    labels.set(empty, 64);
    labels.set(one, 128);
    const r = correlationLength(labels, { W: 16, H: 4, D: 3 });
    expect(r.perLayer).toEqual([[3, 33], null, [1, 1]]);
    expect(r.used).toBe(4);
    expect(r.xi).toBe((3 + 33 + 1 + 1) / 4);
  });

  it("only pairs of living cells count: a lag with no pair gives g = 0, so xi is that lag", () => {
    // living at even x only, alternating labels 0, 1 along x: lag 1 has no pair of living cells
    const labels = layer(16, 1, (x) => (x % 2 === 0 ? (x / 2) % 2 : undefined));
    expect(correlationLength(labels, { W: 16, H: 1, D: 1 }).perLayer[0]![0]).toBe(1);
  });

  it("lags are periodic (decision O-4): the pair at the edge wraps, along x and along y", () => {
    // labels 0 0 0 1 1 1 on a ring of six: at lag 1 the pair (x = 5, x = 0) is one of the six pairs and differs, so P(1) = 4/6 and
    // g(1) = (4/6 - 1/2) / (1/2) = 1/3, below 1/e: xi is 1. Without the wrap the pairs would be five, four equal, g = 0.6, and xi at least 2.
    const ring = layer(6, 1, (x) => (x < 3 ? 0 : 1));
    expect(correlationLength(ring, { W: 6, H: 1, D: 1 }).perLayer).toEqual([[1, 33]]);
    // the same ring stood on its end: along y a lag wraps in y, along x nothing varies
    const column = layer(1, 6, (_x, y) => (y < 3 ? 0 : 1));
    expect(correlationLength(column, { W: 1, H: 6, D: 1 }).perLayer).toEqual([[33, 1]]);
  });

  it("P0 is the layer's own (decision O-4): a single-label layer beside mixed ones has g = 0 whatever the other layers hold", () => {
    const mixed = layer(8, 4, (x) => x % 3);
    const labels = new Uint8Array(32 * 2);
    labels.set(mixed, 0);
    labels.fill(1, 32);
    // with the shares of the whole snapshot P0 would be below 1 and the single-label layer would give g = 1 at every lag, xi 33
    expect(correlationLength(labels, { W: 8, H: 4, D: 2 }).perLayer[1]).toEqual([1, 1]);
  });

  it("no layer with a living cell: null", () => {
    const r = correlationLength(new Uint8Array(32).fill(RPS_NO_LABEL), { W: 8, H: 4, D: 1 });
    expect(r).toEqual({ xi: null, used: 0, perLayer: [null] });
  });
});

describe("labelMixingW (the meter's interface width, rule draft 3.1)", () => {
  const field = (W: number, H: number, D: number, f: (x: number, y: number, z: number) => number | undefined) => {
    const labels = new Uint8Array(W * H * D).fill(RPS_NO_LABEL);
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) labels[(z * H + y) * W + x] = f(x, y, z) ?? RPS_NO_LABEL;
    return labels;
  };
  it("sharp x-stripes (columns 0..3 label 0, 4..7 label 1): every column is pure, so W is 0 along x", () => {
    const labels = field(8, 4, 2, (x) => (x < 4 ? 0 : 1));
    expect(labelMixingW(labels, { W: 8, H: 4, D: 2 }, "x")).toBe(0);
  });
  it("along y the same field has m = 0.5 in every row: W = H / 4", () => {
    const labels = field(8, 4, 2, (x) => (x < 4 ? 0 : 1));
    expect(labelMixingW(labels, { W: 8, H: 4, D: 2 }, "y")).toBe(4 * 0.25);
  });
  it("a blurred interface: m is the fraction of label 1 in the line, averaged over the other coordinates", () => {
    // column 3 holds label 1 in 2 of its 8 cells (4 rows x 2 layers); every other column is pure
    const labels = field(8, 4, 2, (x, y) => (x < 3 ? 0 : x === 3 ? (y === 0 ? 1 : 0) : 1));
    expect(labelMixingW(labels, { W: 8, H: 4, D: 2 }, "x")).toBeCloseTo((2 / 8) * (6 / 8), 12);
  });
  it("only living cells count: a line without any is left out, and m is over the living cells of the line", () => {
    const labels = field(4, 2, 1, (x, y) => (x === 0 ? undefined : x === 1 ? (y === 0 ? 1 : undefined) : x === 2 ? y : 1));
    // column 0: no living cell (skipped); column 1: one living cell, label 1, m = 1; column 2: labels 0 and 1, m = 0.5; column 3: m = 1
    expect(labelMixingW(labels, { W: 4, H: 2, D: 1 }, "x")).toBeCloseTo(0.25, 12);
  });
});

describe("mutant supply", () => {
  it("counts distinct lineages born after the start with at least 64 living cells; founders never count", () => {
    const w = mk(32, 16, 1);
    fill(w, 0, 64, { type: 0, lin: [5, 7] }); // exactly 64: counts
    fill(w, 64, 63, { type: 1, lin: [5, 8] }); // 63: does not
    fill(w, 127, 100, { type: 2, lin: [0, 1] }); // a founder lineage: never
    fill(w, 227, 64, { type: 0, lin: [9, 7] }); // same lo, other birth step: a distinct lineage
    expect(mutantSupply(w.snap, w.dims)).toBe(2);
    expect(mutantSupply(w.snap, w.dims, 63)).toBe(3);
    expect(mutantSupply(w.snap, w.dims, 65)).toBe(0);
    expect(rpsCensus(w.snap, w.dims, { supply: true }).supply).toBe(2);
    expect(rpsCensus(w.snap, w.dims, { supply: true, supplyMinCells: 63 }).supply).toBe(3);
    expect(rpsCensus(w.snap, w.dims).supply).toBe(0); // not asked for
  });

  it("a lineage split across labels is still one lineage per (hi, lo) pair", () => {
    const w = mk(32, 16, 1);
    fill(w, 0, 40, { type: 0, lin: [4, 4] });
    fill(w, 40, 40, { type: 1, lin: [4, 4] }); // cannot happen in a valid state; the census keys on the lineage words only
    expect(mutantSupply(w.snap, w.dims)).toBe(1);
  });
});

describe("rpsMirrorMismatches", () => {
  it("is 0 when every living cell mirrors its mask and every other cell has a zero mirror", () => {
    const w = mk(4, 4, 1);
    put(w, 0, { type: 0, mask: 2, mot: 0x02808080 });
    put(w, 1, { type: 1, mask: 4, mot: 0x04808080 });
    expect(rpsMirrorMismatches(w.snap, w.dims)).toBe(0);
  });

  it("counts a wrong mirror on a living cell and a nonzero mirror on a cell that is not living", () => {
    const w = mk(4, 4, 1);
    put(w, 0, { type: 0, mask: 2, mot: 0x04808080 });
    w.snap.cells[CH.MOT * w.n + 5] = 0x01808080;
    expect(rpsMirrorMismatches(w.snap, w.dims)).toBe(2);
  });
});

describe("census.tsv (rule draft B.2)", () => {
  it("pins the header: 35 columns in the order of B.2", () => {
    expect(RPS_CENSUS_COLUMNS.length).toBe(35);
    expect(RPS_CENSUS_HEADER).toBe(
      "phase\tstep\trstep\tliving\tturnover\tndom\tnanti\tzcoh\tn\tY\t" +
        "cells0\tcells1\tcells2\tcells3\tcells4\tcells5\tcells6\tcells7\t" +
        "mass0\tmass1\tmass2\tmass3\tmass4\tmass5\tmass6\tmass7\t" +
        "modal0\tmodal1\tmodal2\tmodal3\tmodal4\tmodal5\tmodal6\tmodal7\tsupply\n",
    );
  });

  const rec = (o: Partial<RpsCensusRecord> = {}): RpsCensusRecord => ({
    phase: "run",
    step: 7000,
    rstep: 1000,
    living: 9000,
    turnover: 0.123456789,
    ndom: 300,
    nanti: 41,
    zcoh: 0.25,
    n: 3,
    Y: 3,
    cells: [3000, 3000, 3000, 0, 0, 0, 0, 0],
    mass: [30000, 29999, 30001, 0, 0, 0, 0, 0],
    modal: [2, 4, 1, null, null, null, null, null],
    supply: null,
    ...o,
  });

  it("round-trips a record, with empty fields for the nulls and two hex digits for the modal masks", () => {
    const rows = [
      rec({ phase: "burn", step: 1000, rstep: -5000, turnover: null, ndom: null, nanti: null }),
      rec(),
      rec({ ndom: null, nanti: null, supply: 12, modal: [0x80, 0x0a, null, 0xff, null, null, null, 0x00] }),
      rec({ zcoh: null, living: 0, cells: new Array(8).fill(0), mass: new Array(8).fill(0), modal: new Array(8).fill(null), n: 0, Y: 0 }),
    ];
    const text = RPS_CENSUS_HEADER + rows.map(formatRpsCensusRow).join("");
    expect(formatRpsCensusRow(rows[1]).split("\t")[4]).toBe("0.123456789");
    expect(formatRpsCensusRow(rows[0]).split("\t").slice(4, 7)).toEqual(["", "", ""]);
    expect(formatRpsCensusRow(rows[2]).split("\t").slice(26, 34)).toEqual(["80", "0a", "--", "ff", "--", "--", "--", "00"]);
    expect(parseRpsCensusTsv(text)).toEqual(rows);
  });

  it("builds a record from a census and its change counts", () => {
    const w = mk(8, 8, 1);
    fill(w, 0, 20, { type: 0, mask: 2 });
    fill(w, 20, 20, { type: 1, mask: 4 });
    fill(w, 40, 20, { type: 2, mask: 1 });
    const c = rpsCensus(w.snap, w.dims, { supply: true });
    const first = rpsCensusRecord(c, null, { phase: "burn", step: 1000, rstep: -5000, supply: false });
    expect(first).toMatchObject({ turnover: null, ndom: null, nanti: null, n: 3, Y: 3, living: 60, supply: null });
    expect(first.cells).toEqual([20, 20, 20, 0, 0, 0, 0, 0]);
    expect(first.modal).toEqual([2, 4, 1, null, null, null, null, null]);
    const second = rpsCensusRecord(c, rpsChanges(c.labels, c.labels, 3), { phase: "run", step: 7000, rstep: 1000, supply: true });
    expect(second).toMatchObject({ turnover: 0, ndom: 0, nanti: 0, supply: 0 });
    expect(parseRpsCensusTsv(RPS_CENSUS_HEADER + formatRpsCensusRow(first) + formatRpsCensusRow(second))).toEqual([first, second]);
  });

  it("finds columns by name, tolerates extra columns and CRLF, and ignores a trailing blank line", () => {
    const cols = ["extra", ...RPS_CENSUS_COLUMNS];
    const row = formatRpsCensusRow(rec()).replace(/\n$/, "");
    const text = `${cols.join("\t")}\r\nx\t${row}\r\n\r\n`;
    expect(parseRpsCensusTsv(text)).toEqual([rec()]);
  });

  it("rejects a missing column, a bad phase, a short row, a non-integer and a bad modal field", () => {
    const row = formatRpsCensusRow(rec());
    expect(() => parseRpsCensusTsv("")).toThrow(RpsCensusParseError);
    expect(() => parseRpsCensusTsv(RPS_CENSUS_HEADER.replace("\tsupply", "\tsupplyX") + row)).toThrow(/no supply column/);
    expect(() => parseRpsCensusTsv(RPS_CENSUS_HEADER + row.replace("run", "warm"))).toThrow(/phase/);
    expect(() => parseRpsCensusTsv(RPS_CENSUS_HEADER + row.replace(/\t[^\t]*\n$/, "\n"))).toThrow(/fields/);
    expect(() => parseRpsCensusTsv(RPS_CENSUS_HEADER + row.replace("\t9000\t", "\t9e3\t"))).toThrow(/living/);
    expect(() => parseRpsCensusTsv(RPS_CENSUS_HEADER + row.replace("\t02\t", "\t2\t"))).toThrow(/modal0/);
  });
});

describe("final.bin (rule draft B.3)", () => {
  it("round-trips W, H, D, K0 and the 7 + 4 channels, little endian", () => {
    const w = mk(4, 4, 2);
    for (let i = 0; i < 32; i++) put(w, i, { type: i % 3, mask: cyc(i % 3, 3), B: i + 1, P: 2, mot: 0x80808080 });
    const bytes = encodeRpsFinal({ ...w.dims, K0: 3, ...w.snap });
    expect(bytes.byteLength).toBe(4 * (4 + 11 * 32));
    expect(Array.from(bytes.slice(0, 16))).toEqual([4, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
    const back = parseRpsFinal(bytes);
    expect([back.W, back.H, back.D, back.K0]).toEqual([4, 4, 2, 3]);
    expect(Array.from(back.cells)).toEqual(Array.from(w.snap.cells));
    expect(Array.from(back.genomeHead)).toEqual(Array.from(w.snap.genomeHead));
    const m = rpsFinalMeasures(back);
    expect(m.zcoh).toBe(rpsCensus(w.snap, w.dims).zcoh);
    expect(m.xi).toBe(correlationLength(rpsCensus(w.snap, w.dims).labels, w.dims).xi);
  });

  it("is 2.9 MB at 128 x 128 x 4, and a truncated or padded file is refused", () => {
    expect(4 * (4 + 11 * 128 * 128 * 4)).toBe(2883600);
    const w = mk(2, 2, 1);
    const bytes = encodeRpsFinal({ ...w.dims, K0: 3, ...w.snap });
    expect(() => parseRpsFinal(bytes.slice(0, bytes.length - 4))).toThrow(/final\.bin/);
    expect(() => parseRpsFinal(new Uint8Array([...bytes, 0, 0, 0, 0]))).toThrow(/final\.bin/);
    expect(() => parseRpsFinal(new Uint8Array(8))).toThrow(/shorter/);
  });
});
