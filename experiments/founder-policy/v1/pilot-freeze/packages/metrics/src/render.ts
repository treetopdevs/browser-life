import { CH, G, cellCount, lowbias32, mulu, worldW, type WorldState } from "@bl/schema";

export type ViewMode = "composite" | "lineage" | "nutrient" | "waste" | "energy" | "signal";

/**
 * Lineage colour at full brightness. Mirrors the WGSL renderer exactly
 * (packages/sim-gpu/src/renderer.ts) so legends match the GPU view.
 */
export function lineageRGB(hi: number, lo: number): [number, number, number] {
  const h = (lowbias32((mulu(hi, 0x9e3779b9) ^ lowbias32(lo)) >>> 0) & 0xffff) / 65536;
  const ch = (k: number) => {
    const f = h + k / 6;
    const p = Math.abs((f - Math.floor(f)) * 6 - 3);
    return Math.min(1, Math.max(0, p - 1)) * 0.85 + 0.15;
  };
  return [ch(5), ch(3), ch(1)];
}

/** CPU rendering for snapshots, thumbnails and tests (the lab renders on the GPU). */
export function renderRGBA(s: WorldState, mode: ViewMode = "composite", unit = 256): Uint8ClampedArray {
  const n = cellCount(s.cfg);
  const out = new Uint8ClampedArray(n * 4);
  const c = s.cells;
  const g = s.genome;
  const sat = (v: number, k: number) => Math.min(1, v / k);
  for (let i = 0; i < n; i++) {
    const A = c[CH.A * n + i], B = c[CH.B * n + i], C = c[CH.C * n + i], P = c[CH.P * n + i];
    const E = c[CH.E * n + i], S = c[CH.S * n + i];
    let r = 0, gg = 0, b = 0;
    if (mode === "composite") {
      const bio = sat(B, unit), mem = sat(P, unit), nut = sat(A, unit * 2), was = sat(C, unit * 2);
      r = 0.55 * was + 0.9 * mem + 0.1 * bio;
      gg = 0.9 * bio + 0.8 * mem + 0.1 * nut;
      b = 0.5 * nut + 0.8 * mem + 0.2 * bio;
    } else if (mode === "lineage") {
      const hi = g[G.LIN_HI * n + i], lo = g[G.LIN_LO * n + i];
      const m = Math.sqrt(sat(B + P, unit));
      if (hi | lo) [r, gg, b] = lineageRGB(hi, lo).map((v) => v * m) as [number, number, number];
      else r = gg = b = 0.06 * sat(A, unit * 0.5);
    } else {
      const v = mode === "nutrient" ? sat(A, unit * 2) : mode === "waste" ? sat(C, unit * 2) : mode === "energy" ? sat(E, unit * 4) : sat(S, unit);
      r = gg = b = v;
    }
    out[i * 4] = r * 255;
    out[i * 4 + 1] = gg * 255;
    out[i * 4 + 2] = b * 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function imageSize(s: WorldState): [number, number] {
  const w = worldW(s.cfg);
  return [w, cellCount(s.cfg) / w];
}
