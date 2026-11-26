/**
 * Draws the saved wall snapshots of one run as a PNG: one column per snapshot time, top row wall density,
 * bottom row the objects the confirmation's rule finds.
 *
 *   deno run -A --no-lock experiments/b2check/render.ts --dir runs/b2check/PHAGE/seed-13 --times 70000,71000,72000 \
 *     --size 128 --out docs/b2-compartment-check-2026-11-21/snap-PHAGE-seed13.png
 *
 * Top row: each wall type in its own colour, brightness the square root of density (so 0.25 of a tile is half
 * brightness), full brightness at 1.0 of a tile.
 * Bottom row: tiles inside an object in the type's colour at full brightness; tiles with total wall of at
 * least 0.05 but in no object in dark grey; the rest black.
 */

import { argOf } from '../confirm/io.ts';
import { labelObjects, LOW_THRESH, MOTIFS, SCALE } from './observe.ts';

const COLORS: readonly (readonly [number, number, number])[] = [
  [255, 176, 0],
  [0, 170, 255],
  [0, 220, 130],
  [255, 80, 120],
  [190, 120, 255],
  [240, 240, 240],
];

const dir = argOf('dir');
const times = argOf('times').split(',').map(Number);
const size = Number(argOf('size'));
const out = argOf('out');
const zoom = Number(argOf('zoom', size <= 64 ? '6' : '4'));
const gap = 8;
const n = size * size;
const panel = size * zoom;
const width = times.length * panel + (times.length - 1) * gap;
const height = 2 * panel + gap;
const rgb = new Uint8Array(width * height * 3).fill(40);

function put(px: number, py: number, c: readonly [number, number, number]): void {
  for (let dy = 0; dy < zoom; dy++) {
    for (let dx = 0; dx < zoom; dx++) {
      const k = ((py + dy) * width + px + dx) * 3;
      rgb[k] = c[0];
      rgb[k + 1] = c[1];
      rgb[k + 2] = c[2];
    }
  }
}

for (let col = 0; col < times.length; col++) {
  const bytes = await Deno.readFile(`${dir}/snap-${times[col]}.bin`);
  const W = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (W.length !== MOTIFS * n) throw new Error(`snapshot ${times[col]} is not ${size} x ${size}`);
  const { labels } = labelObjects(W, size, size);
  const x0 = col * (panel + gap);
  for (let i = 0; i < n; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let tot = 0;
    let inObject = -1;
    for (let m = 0; m < MOTIFS; m++) {
      const w = W[i * MOTIFS + m];
      tot += w;
      const f = Math.sqrt(Math.min(1, w / SCALE));
      r += COLORS[m][0] * f;
      g += COLORS[m][1] * f;
      b += COLORS[m][2] * f;
      if (labels[m * n + i] !== 0 && inObject < 0) inObject = m;
    }
    put(x0 + x * zoom, y * zoom, [Math.min(255, r), Math.min(255, g), Math.min(255, b)]);
    put(x0 + x * zoom, panel + gap + y * zoom, inObject >= 0 ? COLORS[inObject] : tot >= LOW_THRESH ? [70, 70, 70] : [0, 0, 0]);
  }
}

// Minimal PNG writer (8-bit RGB, one zlib stream).
const crcTable = new Uint32Array(256).map((_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let k = 0; k < data.length; k++) c = crcTable[(c ^ data[k]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const outBytes = new Uint8Array(12 + data.length);
  const view = new DataView(outBytes.buffer);
  view.setUint32(0, data.length);
  outBytes.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return outBytes;
}
const raw = new Uint8Array(height * (1 + width * 3));
for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
const ihdr = new Uint8Array(13);
const iv = new DataView(ihdr.buffer);
iv.setUint32(0, width);
iv.setUint32(4, height);
ihdr.set([8, 2, 0, 0, 0], 8);
const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', new Uint8Array(0))];
const png = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
let at = 0;
for (const p of parts) {
  png.set(p, at);
  at += p.length;
}
await Deno.writeFile(out, png);
console.log(`wrote ${out} (${width} x ${height})`);
