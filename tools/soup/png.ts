// Draws a grid soup the way cubff --draw_to_2d does: each program is an 8x8
// block of its bytes, coloured by kind (loops green, + - . , magenta, head
// moves lilac, zero red, other bytes grey), with each block's top and left
// edge darkened. Encoded as PNG with the built-in CompressionStream (zlib), so
// no npm package is needed.
import { type Grid, TAPE } from "./bff.ts";

const COLORS = (() => {
  const c = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const ch = String.fromCharCode(i);
    const v = 192 + (i >> 2);
    const rgb = "[]".includes(ch) ? [0, 192, 0]
      : "+-.,".includes(ch) ? [200, 0, 200]
      : "<>{}".includes(ch) ? [200, 128, 220]
      : i === 0 ? [255, 0, 0]
      : [v, v, v];
    c.set(rgb, i * 3);
  }
  return c;
})();

export function drawGrid(programs: Uint8Array, g: Grid): { width: number; height: number; rgb: Uint8Array } {
  const width = g.width * 8, height = g.height * 8;
  const rgb = new Uint8Array(width * height * 3);
  paintGrid(programs, g, rgb, 3);
  return { width, height, rgb };
}

/**
 * Paints the grid into a caller-owned buffer of (width*8) x (height*8) pixels
 * with `channels` bytes each (3 for RGB, 4 for canvas RGBA, whose alpha is set
 * to 255), so a live view can reuse one buffer.
 */
export function paintGrid(programs: Uint8Array, g: Grid, out: Uint8Array | Uint8ClampedArray, channels: 3 | 4 = 4): void {
  const width = g.width * 8;
  for (let i = 0; i < g.width * g.height; i++) {
    const x = i % g.width, y = Math.floor(i / g.width);
    for (let j = 0; j < TAPE; j++) {
      const ix = j % 8, iy = j >> 3;
      const p = ((y * 8 + iy) * width + x * 8 + ix) * channels;
      const b = programs[i * TAPE + j] * 3;
      const dark = ix === 0 || iy === 0 ? 32 : 0;
      for (let c = 0; c < 3; c++) out[p + c] = Math.max(COLORS[b + c] - dark, 0);
      if (channels === 4) out[p + 3] = 255;
    }
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const d of parts) for (const b of d) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

async function zlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await zlib(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
