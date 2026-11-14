// Mycelium brushes (tools/mycelium/brush.ts): wound and scrape keep matter closed and the energy book exact,
// leave validateState clean, hit the right cells on a torus (seam, radius 0, radius beyond the world), and the
// world keeps stepping with residual 0 afterwards. CPU only.
import { describe, expect, it } from "vitest";
import { NN_BYTES } from "@bl/schema";
import { applyBrush, BRUSH_RADIUS_MAX, scrape, wound } from "../mycelium/brush.ts";
import { createWorld, decode, defaultConfig, encode, energyTotal, matterTotal, type MyceliumConfig, type MyceliumState, POS_SHIFT, stateDigest, step, validateState } from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 40, height: 32, founders: 400, maxParticles: 2048, ...over });

function grown(over: Partial<MyceliumConfig> = {}, steps = 60): MyceliumState {
  const s = createWorld(small(over));
  for (let t = 0; t < steps; t++) step(s);
  return s;
}

const residuals = (s: MyceliumState) => ({ m: matterTotal(s) - s.matter0, e: energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) });
const cellOf = (s: MyceliumState, i: number) => (s.y[i] >>> POS_SHIFT) * s.config.width + (s.x[i] >>> POS_SHIFT);
const wrapDist = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

/** Put one particle at an exact cell, replacing particle 0's place; used to build edge cases by hand. */
function place(s: MyceliumState, i: number, cx: number, cy: number): void {
  s.x[i] = (cx << POS_SHIFT) + 77; s.y[i] = (cy << POS_SHIFT) + 33;
}

describe("wound", () => {
  it("moves matter to waste in the cell, books the energy as heat, and the residuals stay 0", () => {
    const s = grown();
    expect(s.n).toBeGreaterThan(50);
    const before = { matter: matterTotal(s), n: s.n, heat: s.totals.heat, deaths: s.totals.deaths };
    const expectCells = new Map<number, number>();
    let expectMatter = 0, expectHeat = 0;
    const cx = 20, cy = 16, r = 7;
    for (let i = 0; i < s.n; i++) {
      const x = s.x[i] >>> POS_SHIFT, y = s.y[i] >>> POS_SHIFT;
      if (wrapDist(x, cx, 40) ** 2 + wrapDist(y, cy, 32) ** 2 <= r * r) {
        expectMatter += s.M[i]; expectHeat += s.E[i];
        expectCells.set(cellOf(s, i), (expectCells.get(cellOf(s, i)) ?? 0) + s.M[i]);
      }
    }
    expect(expectMatter).toBeGreaterThan(0);
    const wasteBefore = new Uint32Array(s.C);
    const rep = wound(s, cx, cy, r);
    expect(rep).toMatchObject({ kind: "wound", step: 60, cx, cy, radius: r, matterMoved: expectMatter, heatBooked: expectHeat });
    expect(rep.removed).toBe(before.n - s.n);
    expect(s.totals.heat).toBe(before.heat + expectHeat);
    expect(s.totals.deaths).toBe(before.deaths);
    expect(matterTotal(s)).toBe(before.matter);
    for (const [cell, m] of expectCells) expect(s.C[cell]).toBe(wasteBefore[cell] + m);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
  });

  it("removes exactly the particles inside the circle and keeps the others in order, with their genomes", () => {
    const s = grown();
    const keep: { id: number; gen: Int8Array; M: number; E: number; age: number; gid: number; parent: number }[] = [];
    const cx = 5, cy = 5, r = 9;
    for (let i = 0; i < s.n; i++) {
      const x = s.x[i] >>> POS_SHIFT, y = s.y[i] >>> POS_SHIFT;
      if (wrapDist(x, cx, 40) ** 2 + wrapDist(y, cy, 32) ** 2 > r * r) {
        keep.push({ id: s.id[i], gen: s.genome.slice(i * NN_BYTES, (i + 1) * NN_BYTES), M: s.M[i], E: s.E[i], age: s.age[i], gid: s.gid[i], parent: s.parent[i] });
      }
    }
    wound(s, cx, cy, r);
    expect(s.n).toBe(keep.length);
    keep.forEach((k, i) => {
      expect(s.id[i]).toBe(k.id);
      expect(s.M[i]).toBe(k.M); expect(s.E[i]).toBe(k.E); expect(s.age[i]).toBe(k.age);
      expect(s.gid[i]).toBe(k.gid); expect(s.parent[i]).toBe(k.parent);
      expect(Array.from(s.genome.subarray(i * NN_BYTES, (i + 1) * NN_BYTES))).toEqual(Array.from(k.gen));
    });
    for (let i = s.n; i < s.n + 20 && i < s.config.maxParticles; i++) expect(s.M[i]).toBe(0);
    expect(validateState(s)).toEqual([]);
  });

  it("radius 0 hits only the centre cell", () => {
    const s = createWorld(small({ founders: 3 }));
    place(s, 0, 10, 10); place(s, 1, 11, 10); place(s, 2, 10, 11);
    const rep = wound(s, 10, 10, 0);
    expect(rep.cells).toBe(1);
    expect(rep.removed).toBe(1);
    expect(Array.from(s.id.subarray(0, s.n))).toEqual([1, 2]);
    expect(rep.matterMoved).toBe(s.config.founderMatter);
    expect(rep.heatBooked).toBe(s.config.founderEnergy);
    expect(validateState(s)).toEqual([]);
  });

  it("uses a round brush: the diagonal at distance sqrt(2) is in a radius-1 stroke only if dx^2 + dy^2 <= 1", () => {
    const s = createWorld(small({ founders: 4 }));
    place(s, 0, 10, 10); place(s, 1, 11, 10); place(s, 2, 11, 11); place(s, 3, 12, 10);
    const rep = wound(s, 10, 10, 1);
    expect(rep.cells).toBe(5);
    expect(rep.removed).toBe(2);
    expect(Array.from(s.id.subarray(0, s.n))).toEqual([2, 3]);
  });

  it("wraps over the seams of the torus, in both directions", () => {
    const s = createWorld(small({ founders: 6 }));
    // Centre at the corner (0, 0): the cells (39, 0), (0, 31) and (39, 31) are its neighbours across the seam.
    place(s, 0, 39, 0); place(s, 1, 0, 31); place(s, 2, 39, 31); place(s, 3, 1, 1); place(s, 4, 20, 16); place(s, 5, 38, 0);
    const rep = wound(s, 0, 0, 1);
    expect(rep.cells).toBe(5);
    expect(Array.from(s.id.subarray(0, s.n))).toEqual([2, 3, 4, 5]);
    const t = createWorld(small({ founders: 2 }));
    place(t, 0, 39, 31); place(t, 1, 2, 2); // (2, 2) is at distance sqrt(8) > 2: it stays
    wound(t, 0, 0, 2);
    expect(Array.from(t.id.subarray(0, t.n))).toEqual([1]);
    expect(validateState(t)).toEqual([]);
  });

  it("wraps a centre given outside the world", () => {
    const a = grown(), b = grown();
    const ra = wound(a, 3, 4, 6);
    const rb = wound(b, 3 + 40 * 5, 4 - 32 * 3, 6);
    expect(rb).toEqual(ra);
    expect(stateDigest(b)).toBe(stateDigest(a));
  });

  it("a radius that reaches around the world counts every cell once and removes everyone", () => {
    const s = grown();
    const n = s.n;
    const total = matterTotal(s);
    const rep = wound(s, 7, 7, BRUSH_RADIUS_MAX);
    expect(rep.cells).toBe(40 * 32);
    expect(rep.removed).toBe(n);
    expect(s.n).toBe(0);
    expect(matterTotal(s)).toBe(total);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
    // A radius a little above the half-world still counts each cell once.
    const t = grown();
    expect(wound(t, 0, 0, 30).cells).toBeLessThanOrEqual(40 * 32);
  });

  it("hitting nothing changes nothing", () => {
    const s = createWorld(small({ founders: 0 }));
    const d0 = stateDigest(s);
    const rep = wound(s, 5, 5, 4);
    expect(rep).toMatchObject({ removed: 0, matterMoved: 0, heatBooked: 0 });
    expect(stateDigest(s)).toBe(d0);
  });

  it("survives a checkpoint round trip and keeps stepping with residual 0", () => {
    const s = grown();
    wound(s, 12, 9, 8);
    const back = decode(encode(s));
    expect(stateDigest(back)).toBe(stateDigest(s));
    for (let t = 0; t < 80; t++) {
      step(s);
      expect(residuals(s)).toEqual({ m: 0, e: 0 });
    }
    expect(validateState(s)).toEqual([]);
  });

  it("refuses a stroke that would pass the heat ledger bound, changing nothing", () => {
    const s = grown();
    s.totals.heat = 2 ** 50 - 1;
    s.energy0 = energyTotal(s) + s.totals.heat - s.totals.lightIn; // keep the book balanced for the check below
    const d0 = stateDigest(s);
    expect(() => wound(s, 20, 16, 40)).toThrow(/2\^50/);
    expect(stateDigest(s)).toBe(d0);
  });
});

describe("scrape", () => {
  it("moves trail to waste inside the circle only, and the residuals stay 0", () => {
    const s = grown();
    const cx = 18, cy = 20, r = 6;
    const P0 = new Uint32Array(s.P), C0 = new Uint32Array(s.C), A0 = new Uint32Array(s.A);
    const n0 = s.n, heat0 = s.totals.heat, energy0 = energyTotal(s);
    let moved = 0;
    const W = 40;
    const rep = scrape(s, cx, cy, r);
    for (let k = 0; k < P0.length; k++) {
      const x = k % W, y = (k / W) | 0;
      const inside = wrapDist(x, cx, 40) ** 2 + wrapDist(y, cy, 32) ** 2 <= r * r;
      if (inside) { moved += P0[k]; expect(s.P[k]).toBe(0); expect(s.C[k]).toBe(C0[k] + P0[k]); } else { expect(s.P[k]).toBe(P0[k]); expect(s.C[k]).toBe(C0[k]); }
      expect(s.A[k]).toBe(A0[k]);
    }
    expect(moved).toBeGreaterThan(0);
    expect(rep).toMatchObject({ kind: "scrape", matterMoved: moved, removed: 0, heatBooked: 0 });
    expect(s.n).toBe(n0);
    expect(s.totals.heat).toBe(heat0);
    expect(energyTotal(s)).toBe(energy0);
    expect(residuals(s)).toEqual({ m: 0, e: 0 });
    expect(validateState(s)).toEqual([]);
  });

  it("radius 0, the seam and a radius around the world", () => {
    const s = createWorld(small({ founders: 0 }));
    s.P.fill(2);
    s.matter0 = matterTotal(s);
    expect(scrape(s, 0, 0, 0)).toMatchObject({ cells: 1, matterMoved: 2 });
    expect(scrape(s, 0, 0, 1)).toMatchObject({ cells: 5, matterMoved: 8 }); // the centre is already clean
    expect(s.P[39]).toBe(0); expect(s.P[31 * 40]).toBe(0);
    const all = scrape(s, 20, 16, 1000 > BRUSH_RADIUS_MAX ? BRUSH_RADIUS_MAX : 1000);
    expect(all.cells).toBe(40 * 32);
    expect(s.P.every((v) => v === 0)).toBe(true);
    expect(matterTotal(s)).toBe(s.matter0);
    expect(validateState(s)).toEqual([]);
  });
});

describe("brush input", () => {
  it("rejects fractional centres and out-of-range radii without touching the state", () => {
    const s = grown();
    const d0 = stateDigest(s);
    for (const bad of [() => wound(s, 1.5, 2, 3), () => wound(s, 1, 2, -1), () => wound(s, 1, 2, 2.5), () => scrape(s, 1, 2, BRUSH_RADIUS_MAX + 1), () => scrape(s, NaN, 2, 1)]) {
      expect(bad).toThrow(RangeError);
    }
    expect(stateDigest(s)).toBe(d0);
  });

  it("strokes interleaved with steps never move a residual, in every heredity arm and under gradient light", () => {
    for (const over of [{ heredity: "inherit" as const }, { heredity: "frozen" as const }, { heredity: "blocked" as const }, { lightPattern: "gradient" as const }]) {
      const s = createWorld(small(over));
      for (let round = 0; round < 6; round++) {
        for (let t = 0; t < 25; t++) step(s);
        const rep = applyBrush(s, round % 2 ? "scrape" : "wound", (round * 11) % 40, (round * 7) % 32, 3 + round);
        expect(rep.step).toBe(s.step);
        expect(residuals(s)).toEqual({ m: 0, e: 0 });
        expect(validateState(s)).toEqual([]);
      }
    }
  });

  it("is deterministic: the same strokes at the same steps give the same digest", () => {
    const run = () => {
      const s = createWorld(small());
      for (let t = 0; t < 40; t++) step(s);
      wound(s, 10, 10, 6); scrape(s, 25, 20, 8);
      for (let t = 0; t < 40; t++) step(s);
      return stateDigest(s);
    };
    expect(run()).toBe(run());
  });
});
