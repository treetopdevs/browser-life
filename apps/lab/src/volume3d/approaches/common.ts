// Small helpers the ported approaches share.
import type { FrameInfo } from "../contract.ts";

type Clip = Pick<FrameInfo, "ext" | "dims" | "peel" | "cut">;

/**
 * Upper corner of the part of the box still drawn: the peel removes whole layers from the top, the cut trims the south axis
 * in whole rows of cells (at least one layer and one row are kept), so the boundary always falls between texels.
 */
export function visibleMax(f: Clip): [number, number, number] {
  const { ext, dims } = f;
  const keep = Math.max(1, dims.D - Math.max(0, Math.min(dims.D - 1, Math.round(f.peel))));
  const rows = Math.max(1, Math.min(dims.H, Math.floor(Math.min(1, Math.max(0, f.cut)) * dims.H + 1e-9)));
  return [ext[0], (ext[1] * keep) / dims.D, (ext[2] * rows) / dims.H];
}

/**
 * Texture-coordinate bounds that keep a linear sample inside the retained texels: from the centre of the first texel to the
 * centre of the last one kept on each axis. Clamping to these, a sample at the peel or cut face reads only retained cells and
 * never blends in a removed one. Order (u, v, w) = (east, up, south), as the textures.
 */
export function sampleBounds(f: Clip): { lo: [number, number, number]; hi: [number, number, number] } {
  const vis = visibleMax(f);
  const tex = [f.dims.W, f.dims.D, f.dims.H];
  const lo = tex.map((n) => 0.5 / n) as [number, number, number];
  const hi = vis.map((v, i) => v / f.ext[i]! - 0.5 / tex[i]!) as [number, number, number];
  return { lo, hi };
}

export const clipped = (f: FrameInfo) => f.peel > 0 || f.cut < 1;

export function linearSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });
}
