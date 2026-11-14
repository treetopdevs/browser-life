// Pure picture code of the slab viewer: no DOM, no GPU. Index convention of both 3D worlds (docs/3d-rung1b-step-spec.md
// line 37, packages/sim-gpu/src/step3d.ts, world.ts `rpsMix`): cell (x, y, z) is array element i = (z * H + y) * W + x, x runs
// east, y runs south, z runs down from layer 0 (the surface, where light enters). The views draw row y of the array as row
// y of the picture and layer 0 first. x and y wrap in the rules and z is closed; the views do not draw the wrap.
import { lineageRGB } from "@bl/metrics";

export interface Dims { W: number; H: number; D: number }
export interface Tile { z: number; col: number; row: number; x0: number; y0: number }
export interface Layout { cols: number; rows: number; width: number; height: number; tiles: Tile[] }

/** Layer tiles laid out row by row, layer 0 top left, each W x H pixels, at most `maxCols` per row. */
export function tileLayout({ W, H, D }: Dims, maxCols: number): Layout {
  const cols = Math.max(1, Math.min(D, Math.floor(maxCols)));
  const rows = Math.ceil(D / cols);
  const tiles: Tile[] = [];
  for (let z = 0; z < D; z++) {
    const col = z % cols, row = Math.floor(z / cols);
    tiles.push({ z, col, row, x0: col * W, y0: row * H });
  }
  return { cols, rows, width: cols * W, height: rows * H, tiles };
}

/** Array index of cell (x, y, z). */
export const cellIndex = ({ W, H }: Dims, x: number, y: number, z: number) => (z * H + y) * W + x;

export type RGB = readonly [number, number, number];
/** Cyclic types: yellow, sky blue, vermillion (Okabe-Ito picks, told apart under all three common colour-vision types). Empty: near black. */
export const CYCLIC_COLOURS: readonly RGB[] = [[240, 228, 66], [86, 180, 233], [213, 94, 0]];
export const EMPTY_RGB: RGB = [14, 16, 20];
export const NO_LABEL = 255;

export function rpsPixel(label: number): RGB {
  return label < CYCLIC_COLOURS.length ? CYCLIC_COLOURS[label] : EMPTY_RGB;
}

const scratch = new Uint8ClampedArray(3);
/**
 * The lab renderer's lineage colour (renderRGBA "lineage" mode, WGSL renderer): hue from the lineage id through
 * `lineageRGB`, brightness sqrt(min(1, (B + P) / unit)); a cell with no lineage is a dark square lit by nutrient A.
 */
export function lineagePixel(hi: number, lo: number, B: number, P: number, A: number, unit = 256): RGB {
  const sat = (v: number, k: number) => Math.min(1, v / k);
  let r: number, g: number, b: number;
  if (hi | lo) {
    const m = Math.sqrt(sat(B + P, unit));
    const c = lineageRGB(hi, lo);
    r = c[0] * m; g = c[1] * m; b = c[2] * m;
  } else r = g = b = 0.06 * sat(A, unit * 0.5);
  scratch[0] = r * 255; scratch[1] = g * 255; scratch[2] = b * 255; // Uint8ClampedArray rounding, as renderRGBA's output
  return [scratch[0], scratch[1], scratch[2]];
}

/** Cyclic projection of one column: the type most layers hold; ties go to the type met first from the surface; empty only if every layer is. */
export function projectCyclic(labels: Uint8Array, d: Dims, x: number, y: number, nTypes = 3): number {
  const count = new Array(nTypes).fill(0);
  const first = new Array(nTypes).fill(d.D);
  for (let z = 0; z < d.D; z++) {
    const t = labels[cellIndex(d, x, y, z)];
    if (t >= nTypes) continue;
    count[t]++;
    if (first[t] === d.D) first[t] = z;
  }
  let best = NO_LABEL;
  for (let t = 0; t < nTypes; t++) {
    if (count[t] === 0) continue;
    if (best === NO_LABEL || count[t] > count[best] || (count[t] === count[best] && first[t] < first[best])) best = t;
  }
  return best;
}

/** Ecology projection of one column: the layer with the most B + P (ties to the surface); returns its z. */
export function projectEcoLayer(B: Uint32Array, P: Uint32Array, d: Dims, x: number, y: number): number {
  let bz = 0, bv = -1;
  for (let z = 0; z < d.D; z++) {
    const i = cellIndex(d, x, y, z);
    const v = B[i] + P[i];
    if (v > bv) { bv = v; bz = z; }
  }
  return bz;
}

export interface CyclicFrame { kind: "cyclic"; step: number; dims: Dims; labels: Uint8Array }
export interface EcoFrame { kind: "eco"; step: number; dims: Dims; B: Uint32Array; P: Uint32Array; A: Uint32Array; hi: Uint32Array; lo: Uint32Array }
export type Frame = CyclicFrame | EcoFrame;

/** Colour of cell (x, y, z) in a frame. */
export function frameColour(f: Frame, x: number, y: number, z: number): RGB {
  const i = cellIndex(f.dims, x, y, z);
  return f.kind === "cyclic" ? rpsPixel(f.labels[i]) : lineagePixel(f.hi[i], f.lo[i], f.B[i], f.P[i], f.A[i]);
}

/** Colour of the combined (top-down) pixel of column (x, y). */
export function combinedColour(f: Frame, x: number, y: number): RGB {
  if (f.kind === "cyclic") return rpsPixel(projectCyclic(f.labels, f.dims, x, y));
  return frameColour(f, x, y, projectEcoLayer(f.B, f.P, f.dims, x, y));
}

function put(out: Uint8ClampedArray, o: number, c: RGB) {
  out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
}

/** RGBA for one layer tile (W x H). */
export function paintLayer(f: Frame, z: number, out = new Uint8ClampedArray(f.dims.W * f.dims.H * 4)): Uint8ClampedArray {
  const { W, H } = f.dims;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(out, (y * W + x) * 4, frameColour(f, x, y, z));
  return out;
}

/** RGBA for the combined view (W x H). */
export function paintCombined(f: Frame, out = new Uint8ClampedArray(f.dims.W * f.dims.H * 4)): Uint8ClampedArray {
  const { W, H } = f.dims;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(out, (y * W + x) * 4, combinedColour(f, x, y));
  return out;
}

export interface CyclicCensus { counts: number[][]; total: number[] }
/** Counts per layer and in total; slot t is type t, the last slot (nTypes) is empty. Integers; shares are derived by `share`. */
export function censusCyclic(labels: Uint8Array, d: Dims, nTypes = 3): CyclicCensus {
  const plane = d.W * d.H;
  const counts = Array.from({ length: d.D }, () => new Array(nTypes + 1).fill(0));
  for (let z = 0; z < d.D; z++) for (let i = z * plane; i < (z + 1) * plane; i++) counts[z][labels[i] < nTypes ? labels[i] : nTypes]++;
  const total = new Array(nTypes + 1).fill(0);
  for (const row of counts) row.forEach((v, t) => (total[t] += v));
  return { counts, total };
}

export interface EcoCensus { living: number[]; total: number }
/** Living cells per layer (a cell is living when its lineage id is not zero) and in total. */
export function censusEco(hi: Uint32Array, lo: Uint32Array, d: Dims): EcoCensus {
  const plane = d.W * d.H;
  const living = new Array(d.D).fill(0);
  for (let z = 0; z < d.D; z++) for (let i = z * plane; i < (z + 1) * plane; i++) if (hi[i] | lo[i]) living[z]++;
  return { living, total: living.reduce((a, b) => a + b, 0) };
}

export const share = (count: number, of: number) => (of === 0 ? 0 : count / of);

/** FNV-1a over bytes, for pinned pictures in tests. */
export function hashBytes(a: Uint8Array | Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
