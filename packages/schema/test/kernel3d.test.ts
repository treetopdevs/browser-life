import { describe, expect, it } from "vitest";
import { buildKernel, buildKernel3, digestWords } from "@bl/schema";
import { buildKernel3 as benchKernel3 } from "../../../experiments/3d-bench/kernel3d.ts";

describe("buildKernel3", () => {
  it("has the documented tap counts and R=3 sum", () => {
    expect([3, 4, 5].map((r) => buildKernel3(r).count)).toEqual([92, 250, 460]);
    expect(buildKernel3(3).sum).toBe(9624);
  });
  it("stays inside the u32 bound", () => {
    for (const r of [3, 4, 5]) expect(buildKernel3(r).count * 255 * 16383).toBeLessThan(2 ** 32);
    expect(255 * 16383 * 92).toBeLessThan(2 ** 29);
  });
  it("is closed under axis permutations and sign flips", () => {
    for (const r of [3, 4, 5]) {
      const k = buildKernel3(r);
      const set = new Map<string, number>();
      for (let t = 0; t < k.count; t++) set.set(`${k.taps[t * 4]},${k.taps[t * 4 + 1]},${k.taps[t * 4 + 2]}`, k.taps[t * 4 + 3]);
      for (let t = 0; t < k.count; t++) {
        const v = [k.taps[t * 4], k.taps[t * 4 + 1], k.taps[t * 4 + 2]];
        const w = k.taps[t * 4 + 3];
        for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])
          for (let s = 0; s < 8; s++) expect(set.get(p.map((i, a) => v[i] * (((s >> a) & 1) ? -1 : 1)).join(","))).toBe(w);
      }
    }
  });
  it("flat reproduces buildKernel tap for tap", () => {
    for (const r of [3, 4, 9]) {
      const f = buildKernel3(r, true);
      const g = buildKernel(r);
      expect([f.count, f.sum]).toEqual([g.count, g.sum]);
      for (let t = 0; t < g.count; t++) expect([f.taps[t * 4], f.taps[t * 4 + 1], f.taps[t * 4 + 3]]).toEqual([g.taps[t * 4], g.taps[t * 4 + 1], g.taps[t * 4 + 2]]);
    }
  });
  it("pins the tap order (z outermost, then y, then x), no centre tap, positive weights", () => {
    const k = buildKernel3(3);
    expect(Array.from(k.taps.subarray(0, 3))).toEqual([0, -2, -2]); // first tap: lowest z, then lowest y, then lowest x
    for (let t = 1; t < k.count; t++) {
      const a = [k.taps[(t - 1) * 4 + 2], k.taps[(t - 1) * 4 + 1], k.taps[(t - 1) * 4]];
      const b = [k.taps[t * 4 + 2], k.taps[t * 4 + 1], k.taps[t * 4]];
      expect(compare(a, b)).toBeLessThan(0);
    }
    for (let t = 0; t < k.count; t++) {
      expect(k.taps[t * 4] === 0 && k.taps[t * 4 + 1] === 0 && k.taps[t * 4 + 2] === 0).toBe(false);
      expect(k.taps[t * 4 + 3]).toBeGreaterThan(0);
    }
    expect(digestWords(Uint32Array.from(k.taps, (v) => v >>> 0)).map((x) => x.toString(16)).join(",")).toBe(TAP_DIGEST);
  });
  it("is the same function the 3D bench uses", () => {
    expect(benchKernel3).toBe(buildKernel3);
  });
});

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const TAP_DIGEST = "edd3af73,d0b263ef";
