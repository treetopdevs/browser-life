/**
 * Pure rendering helpers for the droplet worlds: tile state in, RGBA bytes out. No DOM, no per-tile
 * allocation. The renderers see a DropletSource whose arrays are GETTERS: DropletKernelRef.step() swaps
 * A/F/W/P with back buffers every step, so an array captured once goes stale. Every render function reads
 * `src.W` etc. once at its top and keeps nothing across calls.
 */

import type { DropletGpuSnapshot } from './droplets-gpu.ts';
import { type DropletKernelRef, KERNEL_MOTIFS } from './droplets-kernel.ts';
import { BG, BRIGHT_FLOOR, WALL_PALETTE, rampInto } from './render.ts';

const M = KERNEL_MOTIFS;

export interface DropletSource {
  readonly width: number;
  readonly height: number;
  readonly nTiles: number;
  readonly A: Uint32Array;
  readonly F: Uint32Array;
  /** length 6 * nTiles, index tile * 6 + motif */
  readonly W: Uint32Array;
  readonly P: Uint32Array;
}

/** A view of a live CPU reference that follows its buffer swaps. */
export function dropletSourceOfRef(ref: DropletKernelRef): DropletSource {
  return {
    width: ref.cfg.width,
    height: ref.cfg.height,
    nTiles: ref.nTiles,
    get A() { return ref.A; },
    get F() { return ref.F; },
    get W() { return ref.W; },
    get P() { return ref.P; },
  };
}

/** Holds the newest GPU snapshot; every readback replaces its arrays. */
export class SnapshotHolder implements DropletSource {
  readonly width: number;
  readonly height: number;
  readonly nTiles: number;
  current: DropletGpuSnapshot;
  constructor(width: number, height: number, snap: DropletGpuSnapshot) {
    this.width = width;
    this.height = height;
    this.nTiles = width * height;
    this.current = snap;
  }
  get A(): Uint32Array { return this.current.A; }
  get F(): Uint32Array { return this.current.F; }
  get W(): Uint32Array { return this.current.W; }
  get P(): Uint32Array { return this.current.P; }
}

/** Pixels per tile; the buffer is size * sub wide. */
export function dropletSub(size: number): number {
  return Math.min(8, Math.max(2, Math.floor(512 / size)));
}

/** Below EDGE a tile is background: the dilute wall of about 100 to 170 lies between droplets everywhere. */
export const DROPLET_EDGE = 154;
/** round(0.20 x 1024): the same threshold the droplet counter uses. */
export const DROPLET_CORE = 205;
/** About the thickest cores seen. */
export const DROPLET_FULL = 320;
export const PHAGE_HOST_DIM = 0.3;
export const DROPLET_CHANNELS = ['food', 'waste'] as const;
export type DropletChannel = (typeof DROPLET_CHANNELS)[number];

// ---- precomputed colours: pattern colour for each (clamped) dominant value ---------------------

let patTable: Uint8Array | null = null;
function patternTable(): Uint8Array {
  if (patTable) return patTable;
  const t = new Uint8Array((DROPLET_FULL + 1) * M * 3);
  for (let wd = 0; wd <= DROPLET_FULL; wd++) {
    const cov = wd >= DROPLET_CORE ? 1 : wd <= DROPLET_EDGE ? 0 : (wd - DROPLET_EDGE) / (DROPLET_CORE - DROPLET_EDGE);
    const k = Math.min(1, Math.max(0, (wd - DROPLET_CORE) / (DROPLET_FULL - DROPLET_CORE)));
    const bright = BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * k;
    for (let m = 0; m < M; m++) {
      for (let c = 0; c < 3; c++) t[(wd * M + m) * 3 + c] = Math.round(BG[c] + (WALL_PALETTE[m][c] * bright - BG[c]) * cov);
    }
  }
  patTable = t;
  return t;
}

/** The colour a droplet tile with this dominant motif and value gets in the pattern view (wd >= EDGE). */
export function dropletPatternColour(m: number, wd: number): [number, number, number] {
  const t = patternTable(), o = (Math.min(wd, DROPLET_FULL) * M + m) * 3;
  return [t[o], t[o + 1], t[o + 2]];
}

// ---- helpers -------------------------------------------------------------------------------------

export function dominantMotif(W: Uint32Array, tile: number): number {
  const b = tile * M;
  let best = 0, bv = W[b];
  for (let m = 1; m < M; m++) if (W[b + m] > bv) { bv = W[b + m]; best = m; }
  return best;
}

export function dominantValue(W: Uint32Array, tile: number): number {
  return W[tile * M + dominantMotif(W, tile)];
}

export function dropletRampScale(max: number, prev: number, floor: number): number {
  return Math.max(floor, 0.98 * prev, max);
}

export function dropletMax(arr: Uint32Array): number {
  let mx = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
  return mx;
}

export function dropletTileMatter(src: DropletSource, tile: number): number {
  let t = src.A[tile] + src.F[tile];
  for (let m = 0; m < M; m++) t += src.W[tile * M + m] + src.P[tile * M + m];
  return t;
}

export function dropletBufferSize(src: { width: number; height: number }): { w: number; h: number; sub: number } {
  const sub = dropletSub(Math.max(src.width, src.height));
  return { w: src.width * sub, h: src.height * sub, sub };
}

// ---- painting ------------------------------------------------------------------------------------

function paintBlock(out: Uint8ClampedArray, bufW: number, tx: number, ty: number, sub: number, r: number, g: number, b: number): void {
  for (let sy = 0; sy < sub; sy++) {
    let o = ((ty * sub + sy) * bufW + tx * sub) * 4;
    for (let sx = 0; sx < sub; sx++) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255; o += 4; }
  }
}

/** Interior (core) and a one pixel frame (ring) for sub >= 4; a checkerboard (x + y even = core) below that. */
function paintDot(out: Uint8ClampedArray, bufW: number, tx: number, ty: number, sub: number, rr: number, rg: number, rb: number, cr: number, cg: number, cb: number): void {
  for (let sy = 0; sy < sub; sy++) {
    let o = ((ty * sub + sy) * bufW + tx * sub) * 4;
    for (let sx = 0; sx < sub; sx++) {
      const core = sub >= 4 ? sx >= 1 && sx < sub - 1 && sy >= 1 && sy < sub - 1 : ((sx + sy) & 1) === 0;
      out[o] = core ? cr : rr; out[o + 1] = core ? cg : rg; out[o + 2] = core ? cb : rb; out[o + 3] = 255;
      o += 4;
    }
  }
}

// ---- views ---------------------------------------------------------------------------------------

/** Droplet pattern: dominant wall pattern colour, brighter where denser; edges fade into the dark. */
export function renderDropletPattern(src: DropletSource, out: Uint8ClampedArray): void {
  const W = src.W, w = src.width, sub = dropletSub(Math.max(w, src.height)), bufW = w * sub, tab = patternTable();
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % w, ty = (i - tx) / w, m = dominantMotif(W, i), wd = W[i * M + m];
    if (wd < DROPLET_EDGE) { paintBlock(out, bufW, tx, ty, sub, BG[0], BG[1], BG[2]); continue; }
    const o = (Math.min(wd, DROPLET_FULL) * M + m) * 3;
    paintBlock(out, bufW, tx, ty, sub, tab[o], tab[o + 1], tab[o + 2]);
  }
}

/** Phage: dim host droplets, a bright dot where phage of a pattern sits. Returns the largest phage value seen. */
export function renderDropletPhage(src: DropletSource, out: Uint8ClampedArray, pScale: number): number {
  const W = src.W, P = src.P, w = src.width, sub = dropletSub(Math.max(w, src.height)), bufW = w * sub, tab = patternTable();
  let max = 0;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % w, ty = (i - tx) / w, m = dominantMotif(W, i), wd = W[i * M + m];
    let rr = BG[0], rg = BG[1], rb = BG[2];
    if (wd >= DROPLET_EDGE) {
      const o = (Math.min(wd, DROPLET_FULL) * M + m) * 3;
      rr = Math.round(BG[0] + (tab[o] - BG[0]) * PHAGE_HOST_DIM);
      rg = Math.round(BG[1] + (tab[o + 1] - BG[1]) * PHAGE_HOST_DIM);
      rb = Math.round(BG[2] + (tab[o + 2] - BG[2]) * PHAGE_HOST_DIM);
    }
    let pm = 0, pd = P[i * M];
    for (let k = 1; k < M; k++) if (P[i * M + k] > pd) { pd = P[i * M + k]; pm = k; }
    if (pd > max) max = pd;
    if (pd >= 1 && pd * 8 >= pScale) {
      const br = BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * Math.min(1, pd / pScale), pc = WALL_PALETTE[pm];
      paintDot(out, bufW, tx, ty, sub, rr, rg, rb, Math.round(pc[0] * br), Math.round(pc[1] * br), Math.round(pc[2] * br));
    } else paintBlock(out, bufW, tx, ty, sub, rr, rg, rb);
  }
  return max;
}

const ramp3 = [0, 0, 0];

/** Chemistry outside: food (F) or leftovers (A) on the ramp; droplet cores keep a dot of their pattern. Returns the largest value seen. */
export function renderDropletChem(src: DropletSource, out: Uint8ClampedArray, channel: DropletChannel, scale: number): number {
  const W = src.W, V = channel === 'food' ? src.F : src.A, w = src.width, sub = dropletSub(Math.max(w, src.height)), bufW = w * sub, tab = patternTable();
  let max = 0;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % w, ty = (i - tx) / w, v = V[i];
    if (v > max) max = v;
    rampInto(scale > 0 ? v / scale : 0, ramp3);
    const m = dominantMotif(W, i), wd = W[i * M + m];
    if (wd >= DROPLET_CORE) {
      const o = (Math.min(wd, DROPLET_FULL) * M + m) * 3;
      paintDot(out, bufW, tx, ty, sub, ramp3[0], ramp3[1], ramp3[2], tab[o], tab[o + 1], tab[o + 2]);
    } else paintBlock(out, bufW, tx, ty, sub, ramp3[0], ramp3[1], ramp3[2]);
  }
  return max;
}
