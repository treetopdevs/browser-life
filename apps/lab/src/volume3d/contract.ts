// The volume renderer's contract, ported from the 3D volume sandbox (claude/3d-volume-view, docs/3d-volume-view-2026-10-22.md)
// and generalised from its 64^3 cube to any W x H x D world. Pure types and maths, no GPU and no DOM.
//
// Two coordinate systems meet here.
// - The simulation's: cell (x, y, z), x east, y south, z down from layer 0 (the surface, where light enters); array element
//   (z * H + y) * W + x (apps/lab/src/slab/render.ts).
// - The volume's: texel (u, v, w) of a 3D texture of size [W, D, H], v up. Cell (x, y, z) is texel (x, D - 1 - z, y), so
//   layer 0 is the top slab of texels and is drawn at the top. In world space the volume is the box [0, ext], where ext keeps
//   the voxel aspect: a 256 x 256 x 8 slab is a sheet 1 wide, 1/32 tall and 1 deep, never a cube.

export interface VolumeDims { W: number; H: number; D: number }

/** Size of the 3D textures, [width, height, depthOrArrayLayers] = [W, D, H]. */
export const texSize = ({ W, H, D }: VolumeDims): [number, number, number] => [W, D, H];
export const voxelCount = ({ W, H, D }: VolumeDims) => W * H * D;

/** Texel of simulation cell (x, y, z). */
export const cellToTexel = ({ D }: VolumeDims, x: number, y: number, z: number): [number, number, number] => [x, D - 1 - z, y];
/** Linear index of texel (u, v, w) in the upload order of a 3D texture: u fastest, then v, then w. */
export const texelIndex = ({ W, D }: VolumeDims, u: number, v: number, w: number) => u + W * (v + D * w);
/** Linear texel index of simulation cell (x, y, z). */
export const voxelIndex = (d: VolumeDims, x: number, y: number, z: number) => texelIndex(d, x, d.D - 1 - z, y);

/** World-space size of the box, the longest side 1. `stretch` scales the vertical only (1 is true voxel aspect). */
export function boxExtent({ W, H, D }: VolumeDims, stretch = 1): [number, number, number] {
  const m = Math.max(W, H, D * stretch);
  return [W / m, (D * stretch) / m, H / m];
}

/** The renderer's input: two rgba8unorm 3D textures of size texSize(dims), written by the page with queue.writeTexture. */
export interface VolumeSource {
  device: GPUDevice;
  dims: VolumeDims;
  /** rgb = linear albedo, a = density (0 empty, 1 the densest body). Filterable. */
  vox: GPUTexture;
  /** r = nutrient, g = light (0 shade, 1 full surface light), b = 0, a = 1 for a living cell. */
  aux: GPUTexture;
  voxView: GPUTextureView;
  auxView: GPUTextureView;
  /** Live texel indices, one u32 each (points). STORAGE | COPY_DST, sized for every voxel. */
  live: GPUBuffer;
  /** How many entries of `live` hold this frame's voxels. */
  liveCount(): number;
}

export interface CameraInfo {
  eye: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovY: number;
  aspect: number;
  /** Column-major 4x4, WebGPU depth range 0..1. World space: the box [0, ext], y up. */
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  invViewProj: Float32Array;
}

export interface FrameInfo {
  camera: CameraInfo;
  /** World-space size of the box (boxExtent). */
  ext: [number, number, number];
  dims: VolumeDims;
  /** Seconds since the previous frame. */
  dt: number;
  /** Unit vector toward the sun: straight up, as the slab's light falls straight down. */
  sunDir: [number, number, number];
  size: { w: number; h: number; dpr: number };
  /** Layers peeled from the surface: texels with v >= D - peel are not drawn. 0 shows every layer. */
  peel: number;
  /** Cut-away along the south axis (world z): keep z <= cut of the box, 0..1; 1 keeps everything. */
  cut: number;
  background: [number, number, number];
}

interface SpecBase {
  key: string;
  label: string;
  /** Plain words: what this changes and why you would touch it. */
  hint: string;
}
export type ParamSpec =
  | (SpecBase & { kind: "range"; min: number; max: number; step: number; value: number })
  | (SpecBase & { kind: "toggle"; value: boolean })
  | (SpecBase & { kind: "select"; options: { value: string; label: string }[]; value: string });
export type ParamValue = number | boolean | string;

export interface Approach {
  id: string;
  label: string;
  /** Plain words for a visitor: what is different about this look and why it matters. */
  blurb: string;
  params: ParamSpec[];
  /** The page owns the canvas. No `document` or `window` in approach files. */
  mount(canvas: HTMLCanvasElement, src: VolumeSource): Promise<void>;
  render(f: FrameInfo): void;
  setParam(key: string, value: ParamValue): void;
  /** Destroys every resource this approach made. */
  unmount(): void;
}

export interface ApproachModule { create(): Approach }
