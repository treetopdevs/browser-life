// The volume renderer's generalised dims and voxel indexing, and the pure packer that turns a slab frame into its textures.
import { describe, expect, it } from "vitest";
import { lineageRGB } from "@bl/metrics";
import { CYCLIC_COLOURS, NO_LABEL, cellIndex, type CyclicFrame, type Dims, type EcoFrame } from "../src/slab/render.ts";
import { boxExtent, cellToTexel, texSize, texelIndex, voxelCount, voxelIndex } from "../src/volume3d/contract.ts";
import { PACK_DEFAULTS, SHADE_CAP, emptyPacked, packFrame } from "../src/volume3d/pack.ts";
import { sampleBounds, visibleMax } from "../src/volume3d/approaches/common.ts";

const lin = (c: number) => Math.round(Math.pow(c / 255, 2.2) * 255);

function eco(d: Dims): EcoFrame {
  const n = d.W * d.H * d.D;
  return { kind: "eco", step: 0, dims: d, B: new Uint32Array(n), P: new Uint32Array(n), A: new Uint32Array(n), hi: new Uint32Array(n), lo: new Uint32Array(n) };
}
function cyclic(d: Dims): CyclicFrame {
  return { kind: "cyclic", step: 0, dims: d, labels: new Uint8Array(d.W * d.H * d.D).fill(NO_LABEL) };
}

describe("dims and indexing", () => {
  const d: Dims = { W: 5, H: 3, D: 4 };

  it("the textures are W x D x H with the vertical second, and every cell maps to one texel", () => {
    expect(texSize(d)).toEqual([5, 4, 3]);
    expect(voxelCount(d)).toBe(60);
    const seen = new Set<number>();
    for (let z = 0; z < d.D; z++) for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) {
      const t = voxelIndex(d, x, y, z);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(60);
      seen.add(t);
    }
    expect(seen.size).toBe(60);
  });

  it("layer 0 (the surface) is the top row of texels, the floor the bottom; x stays east and y becomes the depth axis", () => {
    expect(cellToTexel(d, 0, 0, 0)).toEqual([0, 3, 0]);
    expect(cellToTexel(d, 0, 0, 3)).toEqual([0, 0, 0]);
    expect(cellToTexel(d, 4, 2, 1)).toEqual([4, 2, 2]);
    expect(voxelIndex(d, 4, 2, 1)).toBe(texelIndex(d, 4, 2, 2));
    expect(texelIndex(d, 1, 0, 0) - texelIndex(d, 0, 0, 0)).toBe(1);
    expect(texelIndex(d, 0, 1, 0) - texelIndex(d, 0, 0, 0)).toBe(d.W);
    expect(texelIndex(d, 0, 0, 1) - texelIndex(d, 0, 0, 0)).toBe(d.W * d.D);
  });

  it("the box keeps voxel aspect: a 256 x 256 x 8 slab is a thin sheet, a 64^3 jar a cube, a 128 x 128 x 8 slab as thin per cell", () => {
    expect(boxExtent({ W: 256, H: 256, D: 8 })).toEqual([1, 8 / 256, 1]);
    expect(boxExtent({ W: 64, H: 64, D: 64 })).toEqual([1, 1, 1]);
    expect(boxExtent({ W: 128, H: 128, D: 8 })).toEqual([1, 8 / 128, 1]);
    expect(boxExtent({ W: 200, H: 100, D: 10 })).toEqual([1, 10 / 200, 0.5]);
    const [ex, ey, ez] = boxExtent({ W: 200, H: 100, D: 10 });
    expect(ex / 200).toBeCloseTo(ey / 10, 12);
    expect(ex / 200).toBeCloseTo(ez / 100, 12);
    expect(boxExtent({ W: 256, H: 256, D: 8 }, 4)[1]).toBeCloseTo(32 / 256, 12);
  });
});

describe("packFrame, ecology", () => {
  const d: Dims = { W: 4, H: 3, D: 5 };

  it("one marked living cell lands in its texel, with lineage hue as linear albedo, density from body, and nutrient", () => {
    const f = eco(d);
    const i = cellIndex(d, 3, 1, 2);
    f.hi[i] = 7; f.lo[i] = 9; f.B[i] = 10; f.P[i] = 2; f.A[i] = 4;
    const p = packFrame(f);
    const t = voxelIndex(d, 3, 1, 2);
    const c = lineageRGB(7, 9);
    expect(Array.from(p.vox.slice(t * 4, t * 4 + 4))).toEqual([
      Math.round(Math.pow(c[0], 2.2) * 255), Math.round(Math.pow(c[1], 2.2) * 255), Math.round(Math.pow(c[2], 2.2) * 255),
      Math.round(255 * Math.sqrt(12 / PACK_DEFAULTS.unit)),
    ]);
    expect(p.aux[t * 4]).toBe(Math.round(255 * 4 / PACK_DEFAULTS.nutrientUnit));
    expect(p.aux[t * 4 + 3]).toBe(255);
    expect(p.liveCount).toBe(1);
    expect(p.live[0]).toBe(t);
    // every other texel is empty and not living
    for (let k = 0; k < voxelCount(d); k++) if (k !== t) { expect(p.vox[k * 4 + 3]).toBe(0); expect(p.aux[k * 4 + 3]).toBe(0); }
  });

  it("a cell without a lineage has no density even with body, density saturates at the unit, and nutrient is clamped", () => {
    const f = eco(d);
    const a = cellIndex(d, 0, 0, 0), b = cellIndex(d, 1, 0, 0);
    f.B[a] = 500; f.A[a] = 1000;
    f.hi[b] = 1; f.B[b] = 5000;
    const p = packFrame(f, { unit: 64, nutrientUnit: 10 });
    const ta = voxelIndex(d, 0, 0, 0), tb = voxelIndex(d, 1, 0, 0);
    expect(p.vox[ta * 4 + 3]).toBe(0);
    expect(p.aux[ta * 4]).toBe(255);
    expect(p.vox[tb * 4 + 3]).toBe(255);
    expect(p.liveCount).toBe(1);
  });

  it("light: 1 at the surface, then each layer passes K / (K + min(B + P, cap)) of it down; no lightK means no shading", () => {
    const f = eco(d);
    const K = 64;
    f.B[cellIndex(d, 2, 2, 0)] = 64; // halves the light under it
    f.P[cellIndex(d, 2, 2, 2)] = 1_000_000; // capped
    const p = packFrame(f, { lightK: K });
    const light = (z: number) => p.aux[voxelIndex(d, 2, 2, z) * 4 + 1];
    expect(light(0)).toBe(255);
    expect(light(1)).toBe(Math.round(255 * 0.5));
    expect(light(2)).toBe(Math.round(255 * 0.5));
    expect(light(3)).toBe(Math.round(255 * 0.5 * K / (K + SHADE_CAP)));
    expect(p.aux[voxelIndex(d, 0, 0, 4) * 4 + 1]).toBe(255); // an unshaded column
    const flat = packFrame(f);
    for (let z = 0; z < d.D; z++) expect(flat.aux[voxelIndex(d, 2, 2, z) * 4 + 1]).toBe(255);
  });

  it("the live list is sorted texel order and reuses the buffers for frames of the same size", () => {
    const f = eco(d);
    for (const [x, y, z] of [[3, 2, 4], [0, 0, 0], [1, 2, 0], [2, 0, 3]] as const) { const i = cellIndex(d, x, y, z); f.hi[i] = 1; f.B[i] = 20; }
    const into = emptyPacked(d);
    const p = packFrame(f, {}, into);
    expect(p).toBe(into);
    const live = Array.from(p.live.slice(0, p.liveCount));
    expect(live).toEqual([...live].sort((a, b) => a - b));
    expect(live.length).toBe(4);
    const bigger = packFrame(eco({ W: 4, H: 3, D: 6 }), {}, into);
    expect(bigger).not.toBe(into);
    expect(bigger.vox.length).toBe(4 * 3 * 6 * 4);
  });
});

describe("packFrame, cyclic", () => {
  it("a type is a solid voxel in its colour, empty is clear, and light is 1 everywhere (the cyclic world has no light rule)", () => {
    const d: Dims = { W: 3, H: 2, D: 4 };
    const f = cyclic(d);
    f.labels[cellIndex(d, 0, 0, 0)] = 0;
    f.labels[cellIndex(d, 2, 1, 3)] = 2;
    const p = packFrame(f, { lightK: 64 });
    const t0 = voxelIndex(d, 0, 0, 0), t2 = voxelIndex(d, 2, 1, 3);
    expect(Array.from(p.vox.slice(t0 * 4, t0 * 4 + 4))).toEqual([...CYCLIC_COLOURS[0].map(lin), 255]);
    expect(Array.from(p.vox.slice(t2 * 4, t2 * 4 + 4))).toEqual([...CYCLIC_COLOURS[2].map(lin), 255]);
    expect(p.liveCount).toBe(2);
    for (let k = 0; k < voxelCount(d); k++) expect(p.aux[k * 4 + 1]).toBe(255);
    expect(t0).toBe(texelIndex(d, 0, 3, 0)); // layer 0 on top
  });
});

describe("peel and cut bounds", () => {
  const dims = { W: 256, H: 256, D: 8 };
  const clip = (peel: number, cut: number, stretch = 1) => ({ dims, ext: boxExtent(dims, stretch), peel, cut });
  /** Texel index a linear sample at texture coordinate c starts from, and the weight it gives the next texel up. */
  const taps = (c: number, n: number) => { const x = c * n - 0.5; return { i: Math.floor(x + 1e-9), w: x - Math.floor(x + 1e-9) }; };

  it("with nothing peeled or cut the bounds are the centres of the first and last texels", () => {
    const { lo, hi } = sampleBounds(clip(0, 1));
    expect(lo.map((v, k) => v * [256, 8, 256][k]!)).toEqual([0.5, 0.5, 0.5]);
    expect(hi.map((v, k) => v * [256, 8, 256][k]!)).toEqual([255.5, 7.5, 255.5]);
  });

  it("a linear sample at the top bound reads only the highest retained layer, for every peel and depth stretch", () => {
    for (const stretch of [1, 8, 16]) for (let peel = 0; peel < 8; peel++) {
      const { hi } = sampleBounds(clip(peel, 1, stretch));
      const t = taps(hi[1], 8);
      expect(t.i, `peel ${peel}`).toBe(7 - peel); // texel v = 7 - peel holds layer `peel`, the top one left
      expect(t.w).toBeCloseTo(0, 9); // no weight on the peeled layer above
    }
  });

  it("the cut keeps whole rows, and a sample at the cut face reads only the last kept row", () => {
    for (const cut of [1, 0.5, 0.3, 0.001, 0]) {
      const rows = Math.max(1, Math.floor(cut * 256 + 1e-9));
      const vis = visibleMax(clip(0, cut));
      expect(vis[2] * 256).toBeCloseTo(rows, 9);
      const t = taps(sampleBounds(clip(0, cut)).hi[2], 256);
      expect(t.i).toBe(rows - 1);
      expect(t.w).toBeCloseTo(0, 9);
    }
  });

  it("depth stretch scales only the height of the box, and leaves the texel bounds alone", () => {
    expect(boxExtent(dims, 8)).toEqual([1, 64 / 256, 1]);
    expect(sampleBounds(clip(2, 0.5, 8))).toEqual(sampleBounds(clip(2, 0.5, 1)));
  });
});
