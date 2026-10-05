// A contact sheet of a pond world's ponds for a picker who is not looking at the lab (wild sandbox): a person, a script
// or a model choosing donors from an image. Pure (no Deno API), so vitest covers it; PNG encoding is png.ts's.
//
// The sheet is drawn from the state alone. It cannot depend on the arm's own donors, scores or ranks, because it
// never receives them: panels are in pond-index order, coloured by bound mass (B + P) on one ramp, labelled by pond
// index (white for a pond able to found a pond, grey otherwise). The visible state still carries what the rule
// reads (bound mass drives scaf and the mass term, the packet mass is a breeder term), so a picker that favours the
// heaviest eligible ponds agrees with the rule because the picture shows what the rule uses, not because it saw it.
import { CH, cellCount, pondSeeds, pondTraits, worldW, type WorldState } from "@bl/schema";

/**
 * A pond whose expected packet mass (`pondSeeds`, the breeder's seed term) is at least this can found a pond that
 * lasts. docs/sandbox-wild.md ("Why bred ponds died"): of ponds founded by a packet under 2,800, 6% survived a
 * cycle; from 2,800 to 3,199, 54%; from 3,200 up, 95%; "about 3,000" is the founding threshold. Measured at
 * 10,000-step cycles on 64 ponds; the breeder preset's cycle is 5,000 steps, where it is unmeasured.
 */
export const FOUNDING_MASS = 3000;

/** HSV (each 0..1) to RGB bytes. */
export function hsv(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Occupied ponds (bound mass at the support threshold) and, of those, the ones whose expected packet mass reaches `FOUNDING_MASS`; both ascending. */
export function foundingEligible(pre: WorldState, k: number): { occupied: number[]; eligible: number[] } {
  const traits = pondTraits(pre);
  const seeds = pondSeeds(pre, k);
  const occupied = traits.flatMap((t, p) => (t > 0 ? [p] : []));
  return { occupied, eligible: occupied.filter((p) => seeds[p] >= FOUNDING_MASS) };
}

/** The long edge a sheet stays under: what vision models downscale from. */
export const SHEET_MAX_EDGE = 1536;
export const SHEET_GAP = 6;
export const MAX_SCALE = 6;

/** The integer scale of a sheet of `tilesX` x `tilesY` tiles of `tileW` x `tileH`: the largest in 1..6 that fits `SHEET_MAX_EDGE` on both axes. */
export function sheetScale(tilesX: number, tilesY: number, tileW: number, tileH: number): number {
  let best = 1;
  for (let s = 1; s <= MAX_SCALE; s++) if (tilesX * (tileW * s + SHEET_GAP) + SHEET_GAP <= SHEET_MAX_EDGE && tilesY * (tileH * s + SHEET_GAP) + SHEET_GAP <= SHEET_MAX_EDGE) best = s;
  return best;
}

/** Bound mass (B + P) of one cell to colour: dark through red-orange to pale yellow, saturating at 128. Nothing is black. */
export function massColour(mass: number): [number, number, number] {
  if (mass <= 0) return [0, 0, 0];
  const t = Math.min(1, mass / 128);
  return t < 0.5
    ? [Math.round(24 + 2 * t * 176), Math.round(8 + 2 * t * 52), Math.round(40 - 2 * t * 20)]
    : [Math.round(200 + (t - 0.5) * 2 * 55), Math.round(60 + (t - 0.5) * 2 * 170), Math.round(20 + (t - 0.5) * 2 * 130)];
}

/** Pond `pond` of `state` as RGB at an integer `scale`: (tileW * scale) x (tileH * scale) x 3 bytes. */
export function tileRgb(state: WorldState, pond: number, scale: number): Uint8Array {
  const cfg = state.cfg, n = cellCount(cfg);
  const w = cfg.tileW * scale, h = cfg.tileH * scale;
  const tx = pond % cfg.tilesX, ty = (pond - tx) / cfg.tilesX, W = worldW(cfg);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) {
      const i = (ty * cfg.tileH + y) * W + tx * cfg.tileW + x;
      const rgb = massColour(state.cells[CH.B * n + i] + state.cells[CH.P * n + i]);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) out.set(rgb, ((y * scale + dy) * w + x * scale + dx) * 3);
    }
  return out;
}

// 5 x 7 digits, one row per byte, bit 4 the left pixel.
const DIGITS: Record<string, readonly number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};
export const DIGIT_W = 5, DIGIT_H = 7;

/** Pixel width and height of `text`'s digits at `scale` (one pixel of space between digits), without a chip. */
export const digitsSize = (text: string, scale: number): { w: number; h: number } => ({ w: (text.length * (DIGIT_W + 1) - 1) * scale, h: DIGIT_H * scale });

/** Draws the digits of `text` (other characters are skipped) into an RGB image `width` wide with the top-left of the first at (x, y); clipped to the image. */
export function drawDigits(img: Uint8Array, width: number, x: number, y: number, text: string, scale: number, colour: readonly [number, number, number]): void {
  const height = img.length / 3 / width;
  let cx = x;
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (glyph)
      for (let gy = 0; gy < DIGIT_H; gy++)
        for (let gx = 0; gx < DIGIT_W; gx++) {
          if (!((glyph[gy] >> (DIGIT_W - 1 - gx)) & 1)) continue;
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const px = cx + gx * scale + dx, py = y + gy * scale + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) img.set(colour, (py * width + px) * 3);
            }
        }
    cx += (DIGIT_W + 1) * scale;
  }
}

const CHIP_PAD = 2;
const CHIP: [number, number, number] = [10, 10, 14];
export const LABEL_SCALE = 2;

/** A label: `text` in `colour` on a dark chip whose top-left is (x, y). Returns the chip's size. */
export function drawLabel(img: Uint8Array, width: number, x: number, y: number, text: string, colour: readonly [number, number, number], scale = LABEL_SCALE): { w: number; h: number } {
  const d = digitsSize(text, scale);
  const w = d.w + 2 * CHIP_PAD, h = d.h + 2 * CHIP_PAD;
  const height = img.length / 3 / width;
  for (let py = Math.max(0, y); py < Math.min(height, y + h); py++)
    for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) img.set(CHIP, (py * width + px) * 3);
  drawDigits(img, width, x + CHIP_PAD, y + CHIP_PAD, text, scale, colour);
  return { w, h };
}

export const LABEL_ELIGIBLE: [number, number, number] = [255, 255, 255];
export const LABEL_OTHER: [number, number, number] = [140, 140, 140];
const SHEET_BG: [number, number, number] = [32, 32, 36];

export interface Sheet {
  width: number;
  height: number;
  rgb: Uint8Array;
  grid: { x: number; y: number };
  /** Pixels per cell. */
  scale: number;
}

/**
 * The sheet of `state`'s ponds: tiles in pond-index order, row-major, `tilesX` per row, `SHEET_GAP` px apart, each at the
 * largest integer scale (1..6) that keeps both edges within 1,536 px (4 x 4 ponds of 64: scale 5, 1,310 px; 8 x 8: scale 2,
 * 1,078 px). Each tile carries its pond index at its top-left, white if the pond is eligible (`foundingEligible` at the
 * config's `pondK`), grey otherwise; an empty pond is drawn dark with its label. Needs a pond config (`pondK`).
 */
export function pondSheet(state: WorldState): Sheet {
  const cfg = state.cfg;
  if (cfg.pondK === undefined) throw new Error("a pond sheet needs a pond config (pondK)");
  const { tilesX, tilesY, tileW, tileH } = cfg;
  const scale = sheetScale(tilesX, tilesY, tileW, tileH);
  const width = tilesX * (tileW * scale + SHEET_GAP) + SHEET_GAP, height = tilesY * (tileH * scale + SHEET_GAP) + SHEET_GAP;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(SHEET_BG, i * 3);
  const eligible = new Set(foundingEligible(state, cfg.pondK).eligible);
  for (let p = 0; p < tilesX * tilesY; p++) {
    const x0 = SHEET_GAP + (p % tilesX) * (tileW * scale + SHEET_GAP), y0 = SHEET_GAP + Math.floor(p / tilesX) * (tileH * scale + SHEET_GAP);
    const tile = tileRgb(state, p, scale);
    for (let y = 0; y < tileH * scale; y++) rgb.set(tile.subarray(y * tileW * scale * 3, (y + 1) * tileW * scale * 3), ((y0 + y) * width + x0) * 3);
    drawLabel(rgb, width, x0, y0, String(p), eligible.has(p) ? LABEL_ELIGIBLE : LABEL_OTHER);
  }
  return { width, height, rgb, grid: { x: tilesX, y: tilesY }, scale };
}

export const ALBUM_ROWS = 8;
export const ALBUM_TILES = 8;

/**
 * What a run has already picked: one row per cycle (the last `ALBUM_ROWS`, newest at the bottom), each the picked ponds'
 * tiles (`tileRgb`, `size` x `size` px, at most `ALBUM_TILES` per row) beside the cycle number. Rows are given oldest first.
 */
export function albumSheet(rows: readonly { cycle: number; tiles: readonly Uint8Array[]; size: number }[]): Sheet {
  if (!rows.length) throw new Error("an album needs at least one cycle");
  const shown = rows.slice(-ALBUM_ROWS);
  const size = shown[0].size;
  if (shown.some((r) => r.size !== size)) throw new Error("album tiles must all be the same size");
  const labelW = digitsSize("0".repeat(Math.max(3, ...shown.map((r) => String(r.cycle).length))), LABEL_SCALE).w + 2 * CHIP_PAD;
  const columns = Math.min(ALBUM_TILES, Math.max(...shown.map((r) => r.tiles.length)));
  const width = SHEET_GAP + labelW + columns * (size + SHEET_GAP), height = SHEET_GAP + shown.length * (size + SHEET_GAP);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(SHEET_BG, i * 3);
  shown.forEach((row, r) => {
    const y0 = SHEET_GAP + r * (size + SHEET_GAP);
    drawLabel(rgb, width, SHEET_GAP, y0, String(row.cycle), LABEL_ELIGIBLE);
    row.tiles.slice(0, ALBUM_TILES).forEach((tile, c) => {
      const x0 = SHEET_GAP + labelW + c * (size + SHEET_GAP);
      if (tile.length !== size * size * 3) throw new Error(`album tile has ${tile.length} bytes, expected ${size * size * 3}`);
      for (let y = 0; y < size; y++) rgb.set(tile.subarray(y * size * 3, (y + 1) * size * 3), ((y0 + y) * width + x0) * 3);
    });
  });
  return { width, height, rgb, grid: { x: columns, y: shown.length }, scale: 1 };
}
