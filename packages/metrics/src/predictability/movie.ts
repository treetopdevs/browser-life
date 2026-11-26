// Movie format and the counter-based integer PRNG used by every fixture. No Math.random, no floats.

/** A short movie on a torus: `frames[k][y * w + x]` in `0..q-1`. */
export interface Movie {
  id: string;
  family: string;
  w: number;
  h: number;
  q: number;
  frames: Uint8Array[];
}

export function hash32(x: number): number {
  x |= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Counter-based draw keyed on (seed, a, b). */
export function rnd(seed: number, a: number, b: number): number {
  return hash32((hash32((hash32(seed) + Math.imul(a, 0x9e3779b1)) | 0) + Math.imul(b, 0x85ebca6b)) | 0);
}

/** Canonical bytes of a movie: a text header, then every frame in order. */
export function movieBytes(m: Movie): Uint8Array {
  const head = new TextEncoder().encode(`${m.id}|${m.w}x${m.h}|q${m.q}|T${m.frames.length}|`);
  const out = new Uint8Array(head.length + m.frames.length * m.w * m.h);
  out.set(head, 0);
  let o = head.length;
  for (const f of m.frames) { out.set(f, o); o += f.length; }
  return out;
}

export function cloneFrames(frames: readonly Uint8Array[]): Uint8Array[] {
  return frames.map((f) => Uint8Array.from(f));
}
