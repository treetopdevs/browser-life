// Minimal PNG writer (node:zlib only) plus integer palettes for the bodies frames.
import { crc32 as zcrc32, deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { RULES } from '../../apps/lab/src/bodies/model.ts';
import type { BodiesWorld } from '../../apps/lab/src/bodies/model.ts';
import { realMatch } from '../../apps/lab/src/bodies/observe.ts';

let table: Uint32Array | null = null;
export function crc32(buf: Uint8Array): number {
  if (typeof zcrc32 === 'function') return zcrc32(buf) >>> 0;
  if (!table) { table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('rgba size mismatch');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}
export function writePng(path: string, width: number, height: number, rgba: Uint8Array): void { writeFileSync(path, encodePng(width, height, rgba)); }

export function upscale(rgba: Uint8Array, w: number, h: number, k: number): { width: number; height: number; rgba: Uint8Array } {
  const W = w * k, out = new Uint8Array(W * h * k * 4);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < W; x++) {
    const s = (((y / k) | 0) * w + ((x / k) | 0)) * 4, o = (y * W + x) * 4;
    out[o] = rgba[s]; out[o + 1] = rgba[s + 1]; out[o + 2] = rgba[s + 2]; out[o + 3] = rgba[s + 3];
  }
  return { width: W, height: h * k, rgba: out };
}

/** Integer HSV (h 0..359, s,v 0..255) to rgb. */
export function hsv(h: number, s: number, v: number): [number, number, number] {
  const region = Math.floor(h / 60), rem = Math.floor(((h % 60) * 255) / 60);
  const p = (v * (255 - s)) >> 8, q = (v * (255 - ((s * rem) >> 8))) >> 8, t = (v * (255 - ((s * (255 - rem)) >> 8))) >> 8;
  switch (region) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
export function tagColor(tag: number): [number, number, number] { return tag === 0 ? [132, 176, 150] : hsv((tag * 137) % 360, 190, 235); }
export const BG: [number, number, number] = [16, 27, 33];

/** Two panels side by side (lineage colour | distance d) with a 4px gap, at 1 px per tile. Roots are white on the lineage panel. */
export function renderWorld(w: BodiesWorld): { width: number; height: number; rgba: Uint8Array } {
  const { W, H } = RULES, width = W * 2 + 4, rgba = new Uint8Array(width * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) rgba.set([...BG, 255], (y * width + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!w.cell[i]) continue;
    const c = w.d[i] === 0 ? [255, 255, 255] : tagColor(w.tag[i]);
    rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
    const g = w.d[i] === 0 ? [255, 90, 80] : (() => { const v = 240 - Math.min(200, w.d[i] * 5); return [v, v, v]; })();
    rgba.set([g[0], g[1], g[2], 255], (y * width + W + 4 + x) * 4);
  }
  return { width, height: H, rgba };
}
export function writeFrame(path: string, w: BodiesWorld, k = 6): void { const r = renderWorld(w); const u = upscale(r.rgba, r.width, r.height, k); writePng(path, u.width, u.height, u.rgba); }

/** Hue of a recognition mark: circular (0 and 255 are neighbours), so marks that match look alike. */
export function kinColor(kin: number): [number, number, number] { return hsv(Math.floor(kin * 45 / 32) % 360, 200, 235); }

/**
 * Three panels at 1 px per tile with 4px gaps: recognition mark (hue; cells that touch a non-matching 4-neighbour are white) | lineage colour (roots white)
 * | distance d (roots red). The first panel is the v3 tag-colour panel; the other two are the same as `renderWorld`.
 */
export function renderWorldV3(w: BodiesWorld): { width: number; height: number; rgba: Uint8Array } {
  const { W, H } = RULES, width = W * 3 + 8, rgba = new Uint8Array(width * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) rgba.set([...BG, 255], (y * width + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!w.cell[i]) continue;
    let seam = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = ((y + dy + H) % H) * W + ((x + dx + W) % W); if (w.cell[p] && !realMatch(w, i, p)) { seam = true; break; } }
    const k = seam ? [255, 255, 255] : kinColor(w.kin[i]);
    rgba.set([k[0], k[1], k[2], 255], (y * width + x) * 4);
    const c = w.d[i] === 0 ? [255, 255, 255] : tagColor(w.tag[i]);
    rgba.set([c[0], c[1], c[2], 255], (y * width + W + 4 + x) * 4);
    const g = w.d[i] === 0 ? [255, 90, 80] : (() => { const v = 240 - Math.min(200, w.d[i] * 5); return [v, v, v]; })();
    rgba.set([g[0], g[1], g[2], 255], (y * width + 2 * (W + 4) + x) * 4);
  }
  return { width, height: H, rgba };
}
export function writeFrameV3(path: string, w: BodiesWorld, k = 5): void { const r = renderWorldV3(w); const u = upscale(r.rgba, r.width, r.height, k); writePng(path, u.width, u.height, u.rgba); }
