// Mycelium3d brushes (tools/mycelium3d/brush.ts): wound and feed keep matter closed and the energy book exact, leave
// validateState clean (bond graph included), hit the right cells in a volume that wraps in x and y and not in z, refuse
// a stroke past a bound without touching the state, and the world keeps stepping with residual 0 afterwards. CPU only.
import { describe, expect, it } from "vitest";
import { applyBrush3d, BRUSH_RADIUS_MAX, type BrushStroke3d, FEED_AMOUNT_MAX, feed, wound } from "../mycelium3d/brush.ts";
import {
  BOND_NONE, createWorld, decode, defaultConfig, encode, energyTotal, LEDGER_MAX, matterTotal, type Mycelium3dConfig, type Mycelium3dState, NN_BYTES3, POS_SHIFT,
  slotOfId, step, validateState,
} from "../mycelium3d/world.ts";

const LONG = 120_000;
const W = 16, H = 16, D = 8;
const small = (over: Partial<Mycelium3dConfig> = {}) => defaultConfig({ width: W, height: H, depth: D, founders: 256, maxParticles: 2048, ...over });

function grown(over: Partial<Mycelium3dConfig> = {}, steps = 300): Mycelium3dState {
  const s = createWorld(small(over));
  for (let t = 0; t < steps; t++) step(s);
  return s;
}

const residuals = (s: Mycelium3dState) => ({ m: matterTotal(s) - s.matter0, e: energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) });
const bytes = (s: Mycelium3dState) => Buffer.from(encode(s));
const cellOf = (s: Mycelium3dState, i: number) => ((s.z[i] >>> POS_SHIFT) * H + (s.y[i] >>> POS_SHIFT)) * W + (s.x[i] >>> POS_SHIFT);
const cellIndex = (x: number, y: number, z: number) => (z * H + y) * W + x;
const ringD = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
/** Brute-force membership: wrapped in x and y, not in z. */
const inside = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) => ringD(x, cx, W) ** 2 + ringD(y, cy, H) ** 2 + (z - cz) ** 2 <= r * r;

/** Put particle i at an exact cell (with an off-centre offset inside it). */
function place(s: Mycelium3dState, i: number, x: number, y: number, z: number): void {
  s.x[i] = (x << POS_SHIFT) + 77; s.y[i] = (y << POS_SHIFT) + 33; s.z[i] = (z << POS_SHIFT) + 201;
}
/** Re-anchor both ledgers after a hand edit of the field, so the residuals are 0 again. */
function rebase(s: Mycelium3dState): void {
  s.matter0 = matterTotal(s);
  s.energy0 = energyTotal(s) - s.totals.lightIn + s.totals.heat;
}
/** A world of k particles, each alone in its own cell along the x axis of layer 2, with bonds on. */
function line(k: number, over: Partial<Mycelium3dConfig> = {}): Mycelium3dState {
  const s = createWorld(small({ founders: k, bondBreak: 1024, ...over }));
  for (let i = 0; i < k; i++) place(s, i, 2 + 2 * i, 5, 2);
  return s;
}
const setBonds = (s: Mycelium3dState, i: number, b: number[]) => { s.bond0![i] = b[0] ?? BOND_NONE; s.bond1![i] = b[1] ?? BOND_NONE; };
const bondsOf = (s: Mycelium3dState, id: number) => {
  const i = slotOfId(s.id, s.n, id);
  return [s.bond0![i], s.bond1![i]].filter((v) => v !== BOND_NONE);
};
const ids = (s: Mycelium3dState) => Array.from(s.id.subarray(0, s.n));

describe("wound", () => {
  it("moves each body to waste in its cell, books its energy as heat, leaves deaths alone, and the residuals stay 0", () => {
    const s = grown();
    expect(s.n).toBeGreaterThan(50);
    const before = { matter: matterTotal(s), n: s.n, heat: s.totals.heat, deaths: s.totals.deaths, lightIn: s.totals.lightIn };
    const cx = 8, cy = 8, cz = 3, r = 3;
    const land = new Map<number, number>();
    let em = 0, ee = 0, ek = 0;
    for (let i = 0; i < s.n; i++) {
      if (!inside(s.x[i] >>> 8, s.y[i] >>> 8, s.z[i] >>> 8, cx, cy, cz, r)) continue;
      em += s.M[i]; ee += s.E[i]; ek++;
      land.set(cellOf(s, i), (land.get(cellOf(s, i)) ?? 0) + s.M[i]);
    }
    expect(ek).toBeGreaterThan(0);
    const C0 = new Uint32Array(s.C), A0 = new Uint32Array(s.A), P0 = new Uint32Array(s.P);
    const rep = wound(s, cx, cy, cz, r);
    let cellsIn = 0;
    for (let z = 0; z < s.config.depth; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y, z, cx, cy, cz, r)) cellsIn++;
    expect(rep).toEqual({ kind: "wound", step: 300, cx, cy, cz, radius: r, cells: cellsIn, removed: ek, matterMoved: em, heatBooked: ee, lightBooked: 0, bondsCut: 0, cellsWithoutWaste: 0 });
    expect(s.n).toBe(before.n - ek);
    expect(s.totals.heat).toBe(before.heat + ee);
    expect(s.totals.deaths).toBe(before.deaths);
    expect(s.totals.lightIn).toBe(before.lightIn);
    expect(matterTotal(s)).toBe(before.matter);
    for (let k = 0; k < s.C.length; k++) expect(s.C[k]).toBe(C0[k] + (land.get(k) ?? 0));
    expect(Array.from(s.A)).toEqual(Array.from(A0));
    expect(Array.from(s.P)).toEqual(Array.from(P0));
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
  }, LONG);

  it("removes exactly the particles inside and keeps the others in slot order with every array and genome", () => {
    const s = grown();
    const cx = 1, cy = 14, cz = 6, r = 4;
    const keep: { id: number; gen: number[]; row: number[] }[] = [];
    for (let i = 0; i < s.n; i++) {
      if (inside(s.x[i] >>> 8, s.y[i] >>> 8, s.z[i] >>> 8, cx, cy, cz, r)) continue;
      keep.push({ id: s.id[i], gen: Array.from(s.genome.subarray(i * NN_BYTES3, (i + 1) * NN_BYTES3)), row: [s.parent[i], s.gid[i], s.x[i], s.y[i], s.z[i], s.M[i], s.E[i], s.age[i]] });
    }
    const n0 = s.n;
    wound(s, cx, cy, cz, r);
    expect(s.n).toBe(keep.length);
    expect(s.n).toBeLessThan(n0);
    keep.forEach((k, i) => {
      expect(s.id[i]).toBe(k.id);
      expect([s.parent[i], s.gid[i], s.x[i], s.y[i], s.z[i], s.M[i], s.E[i], s.age[i]]).toEqual(k.row);
      expect(Array.from(s.genome.subarray(i * NN_BYTES3, (i + 1) * NN_BYTES3))).toEqual(k.gen);
    });
    for (let i = s.n; i < n0; i++) expect([s.id[i], s.M[i], s.E[i], s.x[i]]).toEqual([0, 0, 0, 0]);
    expect(s.genome.subarray(s.n * NN_BYTES3, n0 * NN_BYTES3).every((v) => v === 0)).toBe(true);
    expect(validateState(s)).toEqual([]);
  }, LONG);

  it("radius 0 hits only the centre cell, not its six face neighbours", () => {
    const s = createWorld(small({ founders: 7 }));
    place(s, 0, 5, 5, 3);
    place(s, 1, 6, 5, 3); place(s, 2, 4, 5, 3); place(s, 3, 5, 6, 3); place(s, 4, 5, 4, 3); place(s, 5, 5, 5, 4); place(s, 6, 5, 5, 2);
    const rep = wound(s, 5, 5, 3, 0);
    expect(rep).toMatchObject({ cells: 1, removed: 1, matterMoved: s.config.founderMatter, heatBooked: s.config.founderEnergy });
    expect(ids(s)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.C[cellIndex(5, 5, 3)]).toBe(s.config.founderMatter);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
  });

  it("is a round sphere: radius 1 is the centre and its six faces (7 cells), never an edge diagonal", () => {
    const s = createWorld(small({ founders: 4 }));
    place(s, 0, 5, 5, 4); place(s, 1, 5, 5, 3); place(s, 2, 6, 5, 3); place(s, 3, 7, 5, 4);
    const rep = wound(s, 5, 5, 4, 1);
    expect(rep.cells).toBe(7);
    expect(ids(s)).toEqual([2, 3]);
  });

  it("counts cells as the brute-force sphere does, wrapped in x and y and cut by the surface and the floor", () => {
    for (const [cx, cy, cz, r] of [[8, 8, 4, 2], [0, 0, 0, 3], [15, 15, D - 1, 3], [3, 12, 0, 0], [3, 12, D - 1, 1], [7, 2, 5, 6], [0, 9, 0, 9]]) {
      let want = 0;
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y, z, cx, cy, cz, r)) want++;
      const s = createWorld(small({ founders: 0 }));
      expect(wound(s, cx, cy, cz, r).cells, `${cx},${cy},${cz} r${r}`).toBe(want);
    }
  });

  it("wraps across the x and y seams but not across z: the surface stroke does not reach the floor", () => {
    const s = createWorld(small({ founders: 7 }));
    // Centre (0, 0, 0): (15, 0, 0), (0, 15, 0) and (0, 0, 1) are face neighbours (two across the seam); (0, 0, D - 1)
    // would be one only if z wrapped; (15, 15, 0) is an edge diagonal across both seams; (1, 0, 0) is a face neighbour.
    place(s, 0, 15, 0, 0); place(s, 1, 0, 15, 0); place(s, 2, 0, 0, 1); place(s, 3, 0, 0, D - 1); place(s, 4, 15, 15, 0); place(s, 5, 1, 0, 0); place(s, 6, 8, 8, 4);
    const rep = wound(s, 0, 0, 0, 1);
    expect(rep.cells).toBe(6); // the up face is outside the volume
    expect(ids(s)).toEqual([3, 4, 6]);
    // At the floor: radius 1 reaches up one layer only, not round to the surface.
    const t = createWorld(small({ founders: 3 }));
    place(t, 0, 4, 4, 0); place(t, 1, 4, 4, D - 2); place(t, 2, 4, 4, D - 1);
    expect(wound(t, 4, 4, D - 1, 1).cells).toBe(6);
    expect(ids(t)).toEqual([0]);
    // Radius 2 across the corner seam: (14, 14) is at distance sqrt(8) > 2 and stays, (15, 15) at sqrt(2) goes.
    const u = createWorld(small({ founders: 2 }));
    place(u, 0, 15, 15, 3); place(u, 1, 14, 14, 3);
    wound(u, 0, 0, 3, 2);
    expect(ids(u)).toEqual([1]);
    expect(validateState(u)).toEqual([]);
  });

  it("wraps a centre given outside the world in x and y, and clamps it in z", () => {
    const a = grown(), b = grown();
    const ra = wound(a, 3, 4, 0, 3);
    const rb = wound(b, 3 + W * 5, 4 - H * 3, -9, 3);
    expect(rb).toEqual(ra);
    expect(rb).toMatchObject({ cx: 3, cy: 4, cz: 0 });
    expect(bytes(b).equals(bytes(a))).toBe(true);
    const c = grown(), d = grown();
    wound(c, 2, 2, D - 1, 2);
    expect(wound(d, 2, 2, D + 40, 2).cz).toBe(D - 1);
    expect(bytes(d).equals(bytes(c))).toBe(true);
  }, LONG);

  it("a radius that reaches around the world counts every cell once and removes everyone", () => {
    const s = grown();
    const n = s.n, total = matterTotal(s);
    const rep = wound(s, 4, 4, 4, BRUSH_RADIUS_MAX);
    expect(rep.cells).toBe(W * H * D);
    expect(rep.removed).toBe(n);
    expect(s.n).toBe(0);
    expect(matterTotal(s)).toBe(total);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
    for (let t = 0; t < 20; t++) step(s);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
  }, LONG);

  it("a stroke with nothing inside leaves the state byte for byte as it was", () => {
    const s = createWorld(small({ founders: 2 }));
    place(s, 0, 1, 1, 1); place(s, 1, 2, 1, 1);
    const b0 = bytes(s);
    expect(wound(s, 10, 10, 5, 3)).toMatchObject({ removed: 0, matterMoved: 0, heatBooked: 0, bondsCut: 0 });
    expect(bytes(s).equals(b0)).toBe(true);
    const e = createWorld(small({ founders: 0 }));
    const e0 = bytes(e);
    wound(e, 5, 5, 5, 4);
    expect(bytes(e).equals(e0)).toBe(true);
  });

  it("refuses a stroke past the heat ledger bound or a cell's u32, changing nothing", () => {
    const s = grown();
    s.totals.heat = LEDGER_MAX - 1;
    const b0 = bytes(s);
    expect(() => wound(s, 8, 8, 4, 40)).toThrow(/2\^50/);
    expect(bytes(s).equals(b0)).toBe(true);
    // A cell already at the u32 limit (an invalid state, made by hand) cannot take a body.
    const t = createWorld(small({ founders: 3 }));
    place(t, 0, 3, 3, 3); place(t, 1, 3, 3, 3); place(t, 2, 9, 9, 3);
    t.C[cellIndex(3, 3, 3)] = 0xffffffff - t.config.founderMatter;
    const t0 = bytes(t);
    expect(() => wound(t, 3, 3, 3, 8)).toThrow(RangeError);
    expect(bytes(t).equals(t0)).toBe(true);
  }, LONG);
});

describe("wound with bonds", () => {
  it("cutting the middle of a chain frees both ends", () => {
    const s = line(3);
    setBonds(s, 0, [1]); setBonds(s, 1, [0, 2]); setBonds(s, 2, [1]);
    expect(validateState(s)).toEqual([]);
    const rep = wound(s, 4, 5, 2, 0);
    expect(rep).toMatchObject({ removed: 1, bondsCut: 2 });
    expect(ids(s)).toEqual([0, 2]);
    expect([bondsOf(s, 0), bondsOf(s, 2)]).toEqual([[], []]);
    expect(validateState(s)).toEqual([]);
  });

  it("cutting the low end of a chain moves the middle's remaining bond from slot 1 to slot 0", () => {
    const s = line(4);
    setBonds(s, 0, [1]); setBonds(s, 1, [0, 2]); setBonds(s, 2, [1, 3]); setBonds(s, 3, [2]);
    const rep = wound(s, 2, 5, 2, 0);
    expect(rep).toMatchObject({ removed: 1, bondsCut: 1 });
    expect(ids(s)).toEqual([1, 2, 3]);
    expect([s.bond0![0], s.bond1![0]]).toEqual([2, BOND_NONE]);
    expect([bondsOf(s, 2), bondsOf(s, 3)]).toEqual([[1, 3], [2]]);
    expect(validateState(s)).toEqual([]);
  });

  it("cutting the high end of a chain keeps the neighbour's slot 0", () => {
    const s = line(3);
    setBonds(s, 0, [1]); setBonds(s, 1, [0, 2]); setBonds(s, 2, [1]);
    expect(wound(s, 6, 5, 2, 0)).toMatchObject({ removed: 1, bondsCut: 1 });
    expect([s.bond0![1], s.bond1![1]]).toEqual([0, BOND_NONE]);
    expect(bondsOf(s, 0)).toEqual([1]);
    expect(validateState(s)).toEqual([]);
  });

  it("cutting a ring member leaves a chain of the other two, and a pair removed together counts its bond once", () => {
    const s = line(3);
    setBonds(s, 0, [1, 2]); setBonds(s, 1, [0, 2]); setBonds(s, 2, [0, 1]);
    expect(validateState(s)).toEqual([]);
    expect(wound(s, 4, 5, 2, 0)).toMatchObject({ removed: 1, bondsCut: 2 });
    expect([bondsOf(s, 0), bondsOf(s, 2)]).toEqual([[2], [0]]);
    expect(validateState(s)).toEqual([]);
    // Both ends of a pair in one stroke (radius 1 at x 3 covers particles at x 2 and 4): one bond, counted once.
    const t = line(4);
    setBonds(t, 0, [1]); setBonds(t, 1, [0]); setBonds(t, 2, [3]); setBonds(t, 3, [2]);
    expect(wound(t, 3, 5, 2, 1)).toMatchObject({ removed: 2, bondsCut: 1 });
    expect(ids(t)).toEqual([2, 3]);
    expect([bondsOf(t, 2), bondsOf(t, 3)]).toEqual([[3], [2]]);
    expect(validateState(t)).toEqual([]);
  });

  it("on an evolved bonded world: survivors lose exactly the slots to removed partners, symmetric and canonical, then keep stepping", () => {
    const s = grown({ bondBreak: 1024, bondCost: 1, bondChild: true }, 400);
    // A bonded particle whose partner stands in another cell, so a radius-0 wound leaves a survivor to repair.
    let pick = -1;
    for (let i = 0; i < s.n && pick < 0; i++) {
      for (const p of [s.bond0![i], s.bond1![i]]) {
        if (p !== BOND_NONE && cellOf(s, slotOfId(s.id, s.n, p)) !== cellOf(s, i)) { pick = i; break; }
      }
    }
    expect(pick).toBeGreaterThanOrEqual(0);
    const pc = cellOf(s, pick);
    const pz = (pc / (W * H)) | 0, py = ((pc / W) | 0) % H, px = pc % W;
    const gone = new Set<number>();
    for (let i = 0; i < s.n; i++) if (cellOf(s, i) === pc) gone.add(s.id[i]);
    // Expected bonds of every survivor: its old ones minus the removed partners, in the old (increasing) order.
    const want = new Map<number, number[]>();
    let cut = 0, repaired = 0;
    for (let i = 0; i < s.n; i++) {
      const bs = [s.bond0![i], s.bond1![i]].filter((v) => v !== BOND_NONE);
      if (gone.has(s.id[i])) { for (const p of bs) if (!gone.has(p) || s.id[i] < p) cut++; continue; }
      const kept = bs.filter((p) => !gone.has(p));
      if (kept.length < bs.length) repaired++;
      want.set(s.id[i], kept);
    }
    const rep = wound(s, px, py, pz, 0);
    expect(rep.removed).toBe(gone.size);
    expect(rep.bondsCut).toBe(cut);
    expect(rep.bondsCut).toBeGreaterThan(0);
    expect(repaired).toBeGreaterThan(0);
    expect(ids(s)).toEqual([...want.keys()]);
    for (const [id, bs] of want) {
      expect(bondsOf(s, id)).toEqual(bs);
      const i = slotOfId(s.id, s.n, id);
      expect(s.bond0![i]).toBe(bs[0] ?? BOND_NONE); // a lone bond sits in slot 0
      expect(s.bond1![i]).toBe(bs[1] ?? BOND_NONE);
    }
    expect(validateState(s)).toEqual([]); // canonical, symmetric, every partner alive
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    for (let t = 0; t < 100; t++) { step(s); expect(residuals(s)).toEqual({ m: 0, e: 0 }); }
    expect(validateState(s)).toEqual([]);
  }, LONG);
});

describe("feed", () => {
  it("converts min(C, amount) waste to nutrient per cell, books eA per unit as light, and moves no matter in total", () => {
    const s = createWorld(small({ founders: 0, nutrient0: 2 }));
    const a = cellIndex(4, 4, 2), b = cellIndex(5, 4, 2), c = cellIndex(4, 5, 2), far = cellIndex(10, 10, 6);
    s.C[a] = 10; s.C[b] = 3; s.C[far] = 50;
    rebase(s);
    const matter = matterTotal(s), lightIn = s.totals.lightIn, heat = s.totals.heat;
    const rep = feed(s, 4, 4, 2, 1, 5);
    // a gives 5 (of 10), b gives all 3, c and the other four cells have none.
    expect(rep).toEqual({ kind: "feed", step: 0, cx: 4, cy: 4, cz: 2, radius: 1, cells: 7, removed: 0, matterMoved: 8, heatBooked: 0, lightBooked: 8 * s.config.eA, bondsCut: 0, cellsWithoutWaste: 5 });
    expect([s.C[a], s.A[a], s.C[b], s.A[b], s.C[c], s.A[c], s.C[far], s.A[far]]).toEqual([5, 7, 0, 5, 0, 2, 50, 2]);
    expect(s.totals.lightIn).toBe(lightIn + 8 * s.config.eA);
    expect(s.totals.heat).toBe(heat);
    expect(matterTotal(s)).toBe(matter);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
  });

  it("on a cell with no waste is a no-op, byte for byte", () => {
    const s = grown();
    const k = cellIndex(6, 6, 2);
    s.A[k] += s.C[k]; s.C[k] = 0; // a dry cell, with the matter kept
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s) - s.totals.lightIn + s.totals.heat;
    const b0 = bytes(s);
    expect(feed(s, 6, 6, 2, 0, FEED_AMOUNT_MAX)).toMatchObject({ cells: 1, matterMoved: 0, lightBooked: 0, cellsWithoutWaste: 1 });
    expect(bytes(s).equals(b0)).toBe(true);
  }, LONG);

  it("never changes the total matter, on evolved worlds, at any amount and radius", () => {
    const s = grown({ sinkShift: 6 });
    const matter = matterTotal(s);
    let converted = 0;
    for (const [cx, cy, cz, r, amt] of [[3, 3, 7, 2, 1], [8, 8, 4, 4, 16], [0, 0, 0, 3, 4096], [15, 1, 7, BRUSH_RADIUS_MAX, 64]]) {
      const rep = feed(s, cx, cy, cz, r, amt);
      converted += rep.matterMoved;
      expect(rep.lightBooked).toBe(rep.matterMoved * s.config.eA);
      expect(matterTotal(s)).toBe(matter);
      expect(residuals(s)).toEqual({ m: 0, e: 0 });
      expect(validateState(s)).toEqual([]);
    }
    expect(converted).toBeGreaterThan(0);
  }, LONG);

  it("refuses an amount outside [1, 4096], the light ledger bound and a nutrient u32 overflow, changing nothing", () => {
    const s = grown();
    const b0 = bytes(s);
    for (const amt of [0, -1, 2.5, FEED_AMOUNT_MAX + 1, NaN]) expect(() => feed(s, 4, 4, 4, 2, amt)).toThrow(RangeError);
    expect(() => applyBrush3d(s, { kind: "feed", cx: 4, cy: 4, cz: 4, radius: 2 })).toThrow(RangeError);
    expect(bytes(s).equals(b0)).toBe(true);
    s.totals.lightIn = LEDGER_MAX - 1;
    const b1 = bytes(s);
    expect(() => feed(s, 4, 4, 7, 6, 64)).toThrow(/2\^50/);
    expect(bytes(s).equals(b1)).toBe(true);
    const t = createWorld(small({ founders: 0, nutrient0: 0 }));
    t.A[cellIndex(1, 1, 1)] = 0xffffffff - 2; t.C[cellIndex(1, 1, 1)] = 5; t.C[cellIndex(1, 2, 1)] = 5;
    const t0 = bytes(t);
    expect(() => feed(t, 1, 1, 1, 1, 8)).toThrow(RangeError);
    expect(bytes(t).equals(t0)).toBe(true);
  }, LONG);
});

describe("strokes", () => {
  it("reject fractional centres, out-of-range radii and unknown kinds without touching the state", () => {
    const s = grown();
    const b0 = bytes(s);
    const bad: (() => unknown)[] = [
      () => wound(s, 1.5, 2, 3, 3), () => wound(s, 1, 2, 3, -1), () => wound(s, 1, 2, 3, 2.5), () => wound(s, 1, 2, 0.5, 1), () => feed(s, 1, 2, 3, BRUSH_RADIUS_MAX + 1, 4),
      () => feed(s, NaN, 2, 3, 1, 4), () => applyBrush3d(s, { kind: "scrape", cx: 1, cy: 1, cz: 1, radius: 1 } as unknown as BrushStroke3d),
    ];
    for (const f of bad) expect(f).toThrow(RangeError);
    expect(bytes(s).equals(b0)).toBe(true);
  }, LONG);

  const arms: [string, Partial<Mycelium3dConfig>][] = [
    ["no keys", {}],
    ["sinking + waste shading", { sinkShift: 6, wasteShade: 2 }],
    ["toll road", { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }],
    ["owner gate + conduit (gid)", { trailOwner: "gid", ownerDefend: 4, ownerConduit: 16, maxDeposit: 12 }],
    ["bonds 1024 + children + cost", { bondBreak: 1024, bondCost: 1, bondChild: true }],
    ["bonds + children + sinking + toll + owner", { bondBreak: 1024, bondCost: 2, bondChild: true, sinkShift: 6, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "id", ownerDefend: 4 }],
  ];
  for (const [name, over] of arms) {
    it(`${name}: strokes interleaved with steps never move a residual`, () => {
      const s = createWorld(small(over));
      let removed = 0, moved = 0, cut = 0;
      for (let round = 0; round < 8; round++) {
        for (let t = 0; t < 50; t++) { step(s); }
        const stroke: BrushStroke3d = round % 2
          ? { kind: "feed", cx: (round * 5) % W, cy: (round * 3) % H, cz: round % D, radius: 2 + (round % 3), amount: 1 + round * 7 }
          : { kind: "wound", cx: (round * 5) % W, cy: (round * 3) % H, cz: round % D, radius: 2 + (round % 3) };
        const rep = applyBrush3d(s, stroke);
        removed += rep.removed; moved += rep.kind === "feed" ? rep.matterMoved : 0; cut += rep.bondsCut;
        expect(rep.step).toBe(s.step);
        expect(residuals(s)).toEqual({ m: 0, e: 0 });
        expect(validateState(s)).toEqual([]);
      }
      for (let t = 0; t < 100; t++) step(s);
      expect(residuals(s)).toEqual({ m: 0, e: 0 });
      expect(validateState(s)).toEqual([]);
      expect(removed).toBeGreaterThan(0);
      expect(moved).toBeGreaterThan(0);
      if (over.bondBreak) expect(cut).toBeGreaterThan(0);
    }, LONG);
  }

  it("a stroke then N steps equals itself resumed from a checkpoint taken right after the stroke", () => {
    for (const over of [{}, { bondBreak: 1024, bondChild: true as const, trailOwner: "gid" as const }]) {
      const s = grown(over, 200);
      wound(s, 5, 9, 3, 3); feed(s, 12, 2, 6, 2, 9);
      const back = decode(encode(s));
      expect(bytes(back).equals(bytes(s))).toBe(true);
      for (let t = 0; t < 150; t++) { step(s); step(back); }
      expect(bytes(back).equals(bytes(s))).toBe(true);
      expect(residuals(back)).toEqual({ m: 0, e: 0 });
    }
  }, LONG);

  it("is deterministic: the same strokes from the same state give the same bytes and reports", () => {
    const base = encode(grown({ bondBreak: 1024, bondChild: true }, 200));
    const run = () => {
      const s = decode(base);
      const r = [wound(s, 7, 7, 3, 3), feed(s, 2, 14, 5, 4, 30), wound(s, 0, 0, 0, 2)];
      for (let t = 0; t < 50; t++) step(s);
      return { r, b: bytes(s) };
    };
    const a = run(), b = run();
    expect(b.r).toEqual(a.r);
    expect(b.b.equals(a.b)).toBe(true);
  }, LONG);
});
