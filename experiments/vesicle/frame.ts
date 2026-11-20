// Rasterise a vesicle world to RGB for headless frames (walls as lines, solute as dots, a field as tint).
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import type { VesicleWorld } from '../../apps/lab/src/vesicle/model.ts';
import { jobHueLight } from '../../apps/lab/src/vesicle/observe.ts';

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}
export function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
}

export function hue(h: number): [number, number, number] {
  const x = ((h % 360) + 360) % 360, c = 0.62, m = 0.33, k = c * (1 - Math.abs(((x / 60) % 2) - 1));
  const [r, g, b] = x < 60 ? [c, k, 0] : x < 120 ? [k, c, 0] : x < 180 ? [0, c, k] : x < 240 ? [0, k, c] : x < 300 ? [k, 0, c] : [c, 0, k];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export type ColourBy = 'founder' | 'gene' | 'mark' | 'job';
export function render(w: VesicleWorld, scale = 4, by: ColourBy = 'founder', tint: 'lipid' | 'food' | 'none' = 'lipid'): { width: number; height: number; rgb: Uint8Array } {
  const W = Math.round(w.p.W * scale), H = Math.round(w.p.H * scale), rgb = new Uint8Array(W * H * 3);
  const field = tint === 'lipid' ? w.lipid : tint === 'food' ? w.food : null, cs = w.p.cell * scale;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = field ? field[Math.min(w.gh - 1, Math.floor(y / cs)) * w.gw + Math.min(w.gw - 1, Math.floor(x / cs))] : 0, o = (y * W + x) * 3;
    const t = Math.min(1, v / (tint === 'food' ? 12 : 4));
    rgb[o] = 14 + 40 * t; rgb[o + 1] = 20 + (tint === 'food' ? 50 : 26) * t; rgb[o + 2] = 26 + (tint === 'food' ? 10 : 60) * t;
  }
  // light patches: a pale wash over the lit cells (drawn under everything else)
  if (w.p.lightPatches > 0) {
    w.lightMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!w.litMask[Math.min(w.gh - 1, Math.floor(y / cs)) * w.gw + Math.min(w.gw - 1, Math.floor(x / cs))]) continue;
      const o = (y * W + x) * 3; rgb[o] += 34; rgb[o + 1] += 32; rgb[o + 2] += 18;
    }
  }
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  };
  for (let k = 0; k < w.n; k++) {
    const [r, g, b] = by === 'founder' ? hue(w.founder[k] * 67 + 30) : by === 'job' ? hue(w.founder[k] * 67 + 30) : hue(300 - (by === 'gene' ? w.gene[k] : w.mark[k]) * 1.1);
    const x = Math.floor(w.px[k] * scale), y = Math.floor(w.py[k] * scale);
    put(x, y, r, g, b); put(x + 1, y, r, g, b); put(x, y + 1, r, g, b); put(x + 1, y + 1, r, g, b);
  }
  // threads: a clear ring of dots (the middle left empty), coloured by the marker gene (gene 1) whatever the solute colouring
  for (let k = 0; k < w.nt; k++) {
    const [r, g, b] = hue(300 - w.tgene[k * w.p.tG + 1] * 1.1), cx = Math.floor(w.tx[k] * scale), cy = Math.floor(w.ty[k] * scale), rad = Math.max(4, Math.round(1.3 * scale));
    for (let a = 0; a < 16; a++) { const [sn, cs] = [Math.sin((a * Math.PI) / 8), Math.cos((a * Math.PI) / 8)]; put(cx + Math.round(rad * cs), cy + Math.round(rad * sn), r, g, b); }
  }
  for (let i = 0; i < w.beadHi; i++) {
    if (!w.alive[i]) continue;
    const j = w.next[i], s = w.blen[i] / w.p.l0 - 1, t = Math.max(-1, Math.min(1, s / 0.2));
    // stretched = warm, slack = pale, compressed = cool
    let r = 235 + 20 * Math.min(0, -t) + 0, g = 235 - 110 * Math.abs(t), b = 235 - 150 * Math.max(0, t);
    // with heredity in the wall, the wall shows its own byte instead of its strain
    if (w.p.wallGenes && by === 'job' && w.p.jobs) {
      // job colour: hue from the balance d / (h + d), brightness from the budget in use (h + d) / 255
      const jc = jobHueLight(w.wh[i], w.wd[i]), [hr, hg, hb] = hue(jc.hue), k = 0.25 + 0.75 * jc.light;
      [r, g, b] = [hr * k, hg * k, hb * k];
    } else if (w.p.wallGenes && by !== 'founder') [r, g, b] = hue(300 - (by === 'gene' || by === 'job' ? w.wgene[i] : w.wmark[i]) * 1.1);
    let x0 = w.bx[i] * scale, y0 = w.by[i] * scale;
    const x1 = w.bx[j] * scale, y1 = w.by[j] * scale, n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const sx = (x1 - x0) / n, sy = (y1 - y0) / n;
    for (let k = 0; k <= n; k++, x0 += sx, y0 += sy) { const x = Math.floor(x0), y = Math.floor(y0); put(x, y, r, g, b); put(x + 1, y, r, g, b); put(x, y + 1, r, g, b); }
  }
  return { width: W, height: H, rgb };
}

export function writeFrame(path: string, w: VesicleWorld, scale = 4, by: ColourBy = 'founder', tint: 'lipid' | 'food' | 'none' = 'lipid'): void {
  const f = render(w, scale, by, tint);
  writePng(path, f.width, f.height, f.rgb);
}
