// Frozen spatial resolutions. Coarsening is per frame and local, so it can never carry information from the future.
import type { Movie } from "./movie.ts";

export const RESOLUTIONS = [1, 2, 4] as const;
export const HORIZONS = [1, 2, 4, 8] as const;

/** Non-overlapping r x r blocks aligned at offset 0; block value = floor((sum + floor(r*r/2)) / (r*r)) (rounded mean, ties up). */
export function coarsenFrame(f: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r === 1) return f;
  if (w % r || h % r) throw new Error(`resolution ${r} does not divide ${w}x${h}`);
  const bw = w / r, bh = h / r, area = r * r, half = area >> 1;
  const out = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sum = 0;
    for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) sum += f[(by * r + y) * w + bx * r + x];
    out[by * bw + bx] = Math.floor((sum + half) / area);
  }
  return out;
}

export interface Coarse { w: number; h: number; q: number; frames: Uint8Array[]; erased: boolean }

/** A (movie, r) is `erased` when every coarsened frame is uniform (all cells equal); skill is then null. */
export function coarsen(m: Movie, r: number): Coarse {
  const frames = m.frames.map((f) => coarsenFrame(f, m.w, m.h, r));
  const erased = frames.every((f) => f.every((v) => v === f[0]));
  return { w: m.w / r, h: m.h / r, q: m.q, frames, erased };
}
