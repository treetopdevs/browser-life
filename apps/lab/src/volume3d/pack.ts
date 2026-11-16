// The pack adapter: one slab frame (apps/lab/src/slab/render.ts) becomes the volume renderer's two RGBA8 3D textures, plus the
// list of live voxels the points look draws. Pure and CPU-only, so it is unit-tested without a GPU; the page uploads the
// bytes with queue.writeTexture each time a frame arrives. Nothing here reads or changes simulation state.
//
// - vox: rgb = linear albedo (lineage colour for the ecology, the type colour for cyclic competition), a = density. Ecology
//   density is sqrt(min(1, (B + P) / unit)) for a living cell (lineage id not zero) and 0 for every other cell, so the
//   lineage colour carries hue and the density carries how much body is there (lineagePixel folds both into one colour).
//   Cyclic density is 1 for a cell holding a type and 0 for an empty one.
// - aux: r = nutrient A / nutrientUnit (clamped), g = light, b = 0, a = 1 for a living cell. The light is the viewer's own
//   estimate from the post-step frame, with the slab rule's shading formula (packages/sim-ref/src/step3d.ts lightColumn:
//   each layer passes K / (K + min(B + P, 16383)) of the light to the one below), relative to the surface. It is not the
//   simulation's light field. Cyclic competition has no light rule, so its light is 1 everywhere.
import { lineageRGB } from "@bl/metrics";
import { CYCLIC_COLOURS, type Frame } from "../slab/render.ts";
import { voxelCount, type VolumeDims } from "./contract.ts";

/** The slab rule's cap on the mass that shades a layer (MCAP in step3d.ts, not exported there). */
export const SHADE_CAP = 16383;

export interface PackOptions {
  /** Body (B + P) at which an ecology cell is fully dense. */
  unit?: number;
  /** Nutrient A at which the haze is fullest. */
  nutrientUnit?: number;
  /** The world's lightK; absent means no shading (light 1 everywhere). */
  lightK?: number;
}
/** Tuned on canopy frames (n12-mu50-s8-k64, seed 103, step 24,000): living body B + P had median 16 and 90th percentile 35,
 *  nutrient A had median 1 and 99th percentile 5. */
export const PACK_DEFAULTS = { unit: 48, nutrientUnit: 8 } as const;

export interface Packed {
  dims: VolumeDims;
  vox: Uint8Array;
  aux: Uint8Array;
  /** Texel indices of voxels with density above zero, in texel order; the first `liveCount` entries are this frame's. */
  live: Uint32Array;
  liveCount: number;
}

/** sRGB byte -> linear byte, so the shaders can treat albedo as linear (the sandbox bake did pow 2.2). */
const LINEAR = new Uint8Array(256).map((_, i) => Math.round(Math.pow(i / 255, 2.2) * 255));
const toLinear = (c: number) => Math.round(Math.pow(c, 2.2) * 255);

export function emptyPacked(dims: VolumeDims): Packed {
  const n = voxelCount(dims);
  return { dims: { ...dims }, vox: new Uint8Array(n * 4), aux: new Uint8Array(n * 4), live: new Uint32Array(n), liveCount: 0 };
}

const sameDims = (a: VolumeDims, b: VolumeDims) => a.W === b.W && a.H === b.H && a.D === b.D;

/** Packs `f` into `into` when its dims match (no allocation), else into fresh buffers. Returns the buffers written. */
export function packFrame(f: Frame, opts: PackOptions = {}, into?: Packed): Packed {
  const dims = f.dims;
  const out = into && sameDims(into.dims, dims) ? into : emptyPacked(dims);
  const { W, H, D } = dims;
  const { vox, aux, live } = out;
  const unit = opts.unit ?? PACK_DEFAULTS.unit;
  const nUnit = opts.nutrientUnit ?? PACK_DEFAULTS.nutrientUnit;
  const K = opts.lightK;
  const plane = W * H;
  const cyclicLinear = CYCLIC_COLOURS.map((c) => c.map((v) => LINEAR[v]!));
  // Light first, one column at a time from the surface down, into aux.g.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let L = 1;
    for (let z = 0; z < D; z++) {
      if (z > 0 && K !== undefined && f.kind === "eco") {
        const a = (z - 1) * plane + y * W + x;
        L *= K / (K + Math.min(f.B[a]! + f.P[a]!, SHADE_CAP));
      }
      aux[(x + W * (D - 1 - z + D * y)) * 4 + 1] = Math.round(255 * L);
    }
  }
  // Texel (u, v, w) = cell (x, D - 1 - z, y): walk texel order so `live` comes out sorted.
  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let v = 0; v < D; v++) {
      const z = D - 1 - v;
      for (let x = 0; x < W; x++) {
        const i = z * plane + y * W + x;
        const t = x + W * (v + D * y);
        const o = t * 4;
        let dens = 0, r = 0, g = 0, b = 0, nut = 0, alive = 0;
        if (f.kind === "cyclic") {
          const lab = f.labels[i]!;
          if (lab < cyclicLinear.length) {
            const c = cyclicLinear[lab]!;
            r = c[0]!; g = c[1]!; b = c[2]!; dens = 255; alive = 255;
          }
        } else {
          const hi = f.hi[i]!, lo = f.lo[i]!;
          const A = f.A[i]!;
          nut = Math.round(255 * Math.min(1, A / nUnit));
          if (hi | lo) {
            const m = f.B[i]! + f.P[i]!;
            dens = Math.round(255 * Math.sqrt(Math.min(1, m / unit)));
            const c = lineageRGB(hi, lo);
            r = toLinear(c[0]); g = toLinear(c[1]); b = toLinear(c[2]); alive = 255;
          }
        }
        vox[o] = r; vox[o + 1] = g; vox[o + 2] = b; vox[o + 3] = dens;
        aux[o] = nut; aux[o + 2] = 0; aux[o + 3] = alive;
        if (dens > 0) live[count++] = t;
      }
    }
  }
  out.liveCount = count;
  return out;
}
