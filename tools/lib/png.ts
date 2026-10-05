// Minimal PNG writer for the scaffolding tools' frames (Deno, or any host with CompressionStream): 8-bit
// RGB, filter 0 on every scanline, one IDAT chunk. Deflate comes from CompressionStream("deflate"), which
// is the zlib format PNG wants. No dependencies.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE, as PNG chunks use) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Encodes `rgb` (width*height*3 bytes, row-major, top row first) as a PNG file. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`bad PNG size ${width}x${height}`);
  if (rgb.length !== width * height * 3) throw new Error(`PNG data has ${rgb.length} bytes, expected ${width * height * 3}`);
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
