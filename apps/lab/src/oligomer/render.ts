/**
 * Pure rendering helpers for the oligomer viewer: tile state in, RGBA bytes out.
 * No DOM, no allocation in the per-tile paths. The renderer sees a TileSource (a
 * width, a height and typed arrays), never OligomerWorld, so a continuous-field
 * world can be adapted to it later.
 */

import { NUM_SPECIES, NUM_WALL_SPECIES, OP_LYSE, SPECIES, WALL_SPECIES, decodeCatalyst, matchedSpecies } from './chem.ts';
import type { OligomerWorld } from './model.ts';

export interface TileSource {
  readonly width: number;
  readonly height: number;
  readonly nTiles: number;
  readonly genomeSlots: number;
  readonly enableLyse: boolean;
  readonly neutralWallLyse: boolean;
  readonly feedstocks: readonly number[];
  readonly alive: Uint8Array;
  readonly wall: Int32Array;
  readonly ext: Int32Array;
  readonly int: Int32Array;
  readonly energy: Int32Array;
  readonly genome: Uint16Array;
}

export function tileSourceOf(w: OligomerWorld): TileSource {
  return {
    width: w.cfg.width,
    height: w.cfg.height,
    nTiles: w.nTiles,
    genomeSlots: w.cfg.genomeSlots,
    enableLyse: w.cfg.enableLyse,
    neutralWallLyse: w.cfg.neutralWallLyse,
    feedstocks: w.cfg.feedstocks,
    alive: w.alive,
    wall: w.wall,
    ext: w.ext,
    int: w.int,
    energy: w.energy,
    genome: w.genome,
  };
}

export type RGB = readonly [number, number, number];

export const BG: RGB = [14, 20, 26];
export const FOOD_TINT: RGB = [70, 100, 120];
export const WHITE: RGB = [245, 245, 245];

/**
 * Okabe-Ito hues, in WALL_SPECIES order (0011, 0101, 0110, 1001, 1010, 1100).
 * The black and dark blue are dropped (too dark on #0e141a). Bluish green and
 * vermillion are lifted a little from the originals (#009E73, #D55E00) so that
 * every hue clears contrast 3 against the background at the brightness floor
 * (measured in oligomer-viewer.test.ts, which pins the thresholds).
 */
export const WALL_PALETTE: readonly RGB[] = [
  [0xe6, 0x9f, 0x00], // 0011 orange
  [0x56, 0xb4, 0xe9], // 0101 sky blue
  [0x00, 0xa6, 0x7a], // 0110 bluish green
  [0xf0, 0xe4, 0x42], // 1001 yellow
  [0xcc, 0x79, 0xa7], // 1010 reddish purple
  [0xe0, 0x66, 0x10], // 1100 vermillion
];
export const WALL_COLOUR_NAMES: readonly string[] = ['orange', 'sky blue', 'bluish green', 'yellow', 'reddish purple', 'vermillion'];
export const WALL_NAMES: readonly string[] = WALL_SPECIES.map((id) => SPECIES[id].label);

export const TROPHIC_COLOURS = {
  quiet: [110, 120, 128] as RGB,
  primary: [0, 170, 160] as RGB,
  mixed: [240, 200, 60] as RGB,
  secondary: [214, 90, 180] as RGB,
};

export const SUB = 5;
export const WALL_FULL = 32;
export const BRIGHT_FLOOR = 0.75;
export const CHANNELS = ['food', 'dimers', 'monomers'] as const;
export type Channel = (typeof CHANNELS)[number];

const RAMP_STOPS: readonly RGB[] = [
  [16, 24, 40],
  [32, 72, 120],
  [40, 150, 160],
  [150, 215, 120],
  [250, 240, 150],
];

export function bufferSize(src: { width: number; height: number }): { w: number; h: number } {
  return { w: src.width * SUB, h: src.height * SUB };
}

/** Integer upscale so the visible bitmap is about `target` px and nearest-neighbour scaling is uniform. */
export function zoomFor(buf: number, target = 640): number {
  return Math.max(1, Math.floor(target / buf));
}

export function tileAt(px: number, py: number, canvasW: number, canvasH: number, W: number, H: number): number {
  const x = Math.min(W - 1, Math.max(0, Math.floor((px / canvasW) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((py / canvasH) * H)));
  return y * W + x;
}

/** Arrow-key move with wrap-around (the world wraps at its edges). */
export function stepTile(tile: number, key: string, W: number, H: number): number {
  let x = tile % W;
  let y = Math.floor(tile / W);
  if (key === 'ArrowLeft') x = (x + W - 1) % W;
  else if (key === 'ArrowRight') x = (x + 1) % W;
  else if (key === 'ArrowUp') y = (y + H - 1) % H;
  else if (key === 'ArrowDown') y = (y + 1) % H;
  return y * W + x;
}

export function wallTotal(src: TileSource, tile: number): number {
  const b = tile * NUM_WALL_SPECIES;
  let t = 0;
  for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) t += src.wall[b + wi];
  return t;
}

/** Index of the largest wall count (lowest index on ties). */
export function dominantIndex(src: TileSource, tile: number): number {
  const b = tile * NUM_WALL_SPECIES;
  let best = 0;
  let bc = src.wall[b];
  for (let wi = 1; wi < NUM_WALL_SPECIES; wi++) {
    const c = src.wall[b + wi];
    if (c > bc) {
      bc = c;
      best = wi;
    }
  }
  return best;
}

export function dominantWall(src: TileSource, tile: number): { wi: number; total: number } {
  return { wi: dominantIndex(src, tile), total: wallTotal(src, tile) };
}

export function wallBrightness(total: number): number {
  return BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * Math.min(1, total / WALL_FULL);
}

export function trophicClass(feed: number, sec: number): 'quiet' | 'primary' | 'mixed' | 'secondary' {
  const tot = feed + sec;
  if (tot < 4) return 'quiet';
  const f = sec / tot;
  if (f < 0.25) return 'primary';
  if (f > 0.75) return 'secondary';
  return 'mixed';
}

export function rampScale(max: number, prev: number): number {
  return Math.max(4, 0.98 * prev, max);
}

export function rampInto(t: number, dst: number[]): void {
  const x = Math.min(1, Math.max(0, t)) * (RAMP_STOPS.length - 1);
  const i = Math.min(RAMP_STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP_STOPS[i];
  const b = RAMP_STOPS[i + 1];
  dst[0] = Math.round(a[0] + (b[0] - a[0]) * f);
  dst[1] = Math.round(a[1] + (b[1] - a[1]) * f);
  dst[2] = Math.round(a[2] + (b[2] - a[2]) * f);
}

export function ramp(t: number): [number, number, number] {
  const d = [0, 0, 0];
  rampInto(t, d);
  return [d[0], d[1], d[2]];
}

export function dimInto(rgb: RGB, k: number, dst: number[]): void {
  dst[0] = Math.round(rgb[0] * k);
  dst[1] = Math.round(rgb[1] * k);
  dst[2] = Math.round(rgb[2] * k);
}

export function dim(rgb: RGB, k: number): [number, number, number] {
  const d = [0, 0, 0];
  dimInto(rgb, k, d);
  return [d[0], d[1], d[2]];
}

// ---- tile painting -------------------------------------------------------------

/** Paint one 5x5 tile: a 3x3 core and a 1 sub-pixel ring. `dotted` alternates the ring with BG. */
function paint(out: Uint8ClampedArray, bufW: number, tx: number, ty: number, core: ArrayLike<number>, ring: ArrayLike<number>, dotted: boolean): void {
  for (let sy = 0; sy < SUB; sy++) {
    let o = ((ty * SUB + sy) * bufW + tx * SUB) * 4;
    for (let sx = 0; sx < SUB; sx++) {
      const inCore = sx >= 1 && sx <= 3 && sy >= 1 && sy <= 3;
      let c = inCore ? core : ring;
      if (!inCore && dotted && ((sx + sy) & 1) === 1) c = BG;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
      o += 4;
    }
  }
}

const sA = [0, 0, 0];
const sB = [0, 0, 0];

export function feedstockAmount(src: TileSource, tile: number): number {
  let v = 0;
  const b = tile * NUM_SPECIES;
  for (let k = 0; k < src.feedstocks.length; k++) v += src.ext[b + src.feedstocks[k]];
  return v;
}

function paintDead(out: Uint8ClampedArray, bufW: number, tx: number, ty: number, food: number, foodScale: number): void {
  const k = 0.35 * Math.min(1, foodScale > 0 ? food / foodScale : 0);
  sA[0] = Math.round(BG[0] + (FOOD_TINT[0] - BG[0]) * k);
  sA[1] = Math.round(BG[1] + (FOOD_TINT[1] - BG[1]) * k);
  sA[2] = Math.round(BG[2] + (FOOD_TINT[2] - BG[2]) * k);
  paint(out, bufW, tx, ty, sA, sA, false);
}

export function renderWallMotif(src: TileSource, out: Uint8ClampedArray, scale: { food: number }): void {
  const W = src.width;
  const bufW = W * SUB;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % W;
    const ty = (i - tx) / W;
    if (!src.alive[i]) {
      paintDead(out, bufW, tx, ty, feedstockAmount(src, i), scale.food);
      continue;
    }
    dimInto(WALL_PALETTE[dominantIndex(src, i)], wallBrightness(wallTotal(src, i)), sA);
    paint(out, bufW, tx, ty, sA, sA, false);
  }
}

// ---- lysin overlay ---------------------------------------------------------------

/** raw catalyst -> bit 6 set when it is a lysin, bits 0..5 the wall motifs it matches. */
function lysinInfo(raw: number, cache: Map<number, number>): number {
  let v = cache.get(raw);
  if (v === undefined) {
    const cat = decodeCatalyst(raw);
    v = 0;
    if (cat.op === OP_LYSE) {
      v = 64;
      for (const id of matchedSpecies(cat)) {
        const wi = SPECIES[id].wallIndex;
        if (wi >= 0) v |= 1 << wi;
      }
    }
    cache.set(raw, v);
  }
  return v;
}

/**
 * 6-bit mask of wall motifs the tile's lysins cut (0 = no active lysin). Blind lysis
 * (neutralWallLyse) attacks every motif, so any lysin gene gives all six bits.
 */
export function lysinTargetMask(src: TileSource, tile: number, cache: Map<number, number>): number {
  const G = src.genomeSlots;
  const b = tile * G;
  let m = 0;
  let any = false;
  for (let s = 0; s < G; s++) {
    const v = lysinInfo(src.genome[b + s], cache);
    if (v & 64) {
      any = true;
      m |= v & 63;
    }
  }
  return src.neutralWallLyse && any ? 63 : m;
}

export function maskToColour(mask: number): RGB {
  if (mask !== 0 && (mask & (mask - 1)) === 0) return WALL_PALETTE[31 - Math.clz32(mask)];
  return WHITE;
}

export function renderLysin(src: TileSource, out: Uint8ClampedArray, scale: { food: number }, cache: Map<number, number>): void {
  const W = src.width;
  const bufW = W * SUB;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % W;
    const ty = (i - tx) / W;
    if (!src.alive[i]) {
      paintDead(out, bufW, tx, ty, feedstockAmount(src, i), scale.food);
      continue;
    }
    const own = WALL_PALETTE[dominantIndex(src, i)];
    const b = wallBrightness(wallTotal(src, i));
    const mask = src.enableLyse ? lysinTargetMask(src, i, cache) : 0;
    dimInto(own, b * 0.5, sA);
    if (mask === 0) {
      paint(out, bufW, tx, ty, sA, sA, false);
    } else {
      const single = (mask & (mask - 1)) === 0 && !src.neutralWallLyse;
      const col = single ? WALL_PALETTE[31 - Math.clz32(mask)] : WHITE;
      paint(out, bufW, tx, ty, sA, col, !single);
    }
  }
}

// ---- who eats what ---------------------------------------------------------------

export function renderTrophic(src: TileSource, out: Uint8ClampedArray, feed: Int32Array, sec: Int32Array): void {
  const W = src.width;
  const bufW = W * SUB;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % W;
    const ty = (i - tx) / W;
    if (!src.alive[i]) {
      paint(out, bufW, tx, ty, BG, BG, false);
      continue;
    }
    const cls = trophicClass(feed[i], sec[i]);
    const col = TROPHIC_COLOURS[cls];
    if (cls === 'quiet') {
      paint(out, bufW, tx, ty, col, col, false);
    } else {
      dimInto(col, 0.6 + 0.4 * Math.min(1, (feed[i] + sec[i]) / 40), sA);
      paint(out, bufW, tx, ty, sA, col, false);
    }
  }
}

// ---- chemistry outside -----------------------------------------------------------

export function channelAmount(src: TileSource, tile: number, channel: Channel): number {
  const b = tile * NUM_SPECIES;
  if (channel === 'food') return feedstockAmount(src, tile);
  if (channel === 'dimers') return src.ext[b + 2] + src.ext[b + 3] + src.ext[b + 4] + src.ext[b + 5];
  return src.ext[b] + src.ext[b + 1];
}

export function channelMax(src: TileSource, channel: Channel): number {
  let max = 0;
  for (let i = 0; i < src.nTiles; i++) { const v = channelAmount(src, i, channel); if (v > max) max = v; }
  return max;
}

/** Returns the largest per-tile value seen, for the caller's rescaling. */
export function renderChemistry(src: TileSource, out: Uint8ClampedArray, channel: Channel, scale: number): number {
  const W = src.width;
  const bufW = W * SUB;
  let max = 0;
  for (let i = 0; i < src.nTiles; i++) {
    const tx = i % W;
    const ty = (i - tx) / W;
    const v = channelAmount(src, i, channel);
    if (v > max) max = v;
    rampInto(scale > 0 ? v / scale : 0, sB);
    if (!src.alive[i]) {
      paint(out, bufW, tx, ty, sB, sB, false);
    } else {
      dimInto(WALL_PALETTE[dominantIndex(src, i)], wallBrightness(wallTotal(src, i)), sA);
      paint(out, bufW, tx, ty, sA, sB, false);
    }
  }
  return max;
}

// ---- colour maths (used by tests) ------------------------------------------------

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: ArrayLike<number>): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrastRatio(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function linearToLab(r: number, g: number, bl: number): [number, number, number] {
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * bl) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * bl;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * bl) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function srgbToLab(rgb: ArrayLike<number>): [number, number, number] {
  return linearToLab(lin(rgb[0]), lin(rgb[1]), lin(rgb[2]));
}

export function labDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const la = srgbToLab(a);
  const lb = srgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
