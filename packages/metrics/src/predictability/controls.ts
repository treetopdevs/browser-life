// Controls: time shuffle, phase shift, duplicated motif, and the binning-sensitivity detector.
import { rnd } from "./movie.ts";
import type { Rational } from "./losses.ts";

export const SHUFFLE_SEED = 0x5ff1e;
export const PHASE_SHIFTS = [1, 3, 7] as const;

/** Fixed-seed permutation of the whole suffix [F, T); the fit window is untouched. Returns frame references in the new order. */
export function shuffleSuffix<T>(frames: readonly T[], F: number, seed: number = SHUFFLE_SEED): T[] {
  const out = frames.slice();
  for (let i = out.length - 1; i > F; i--) {
    const j = F + (rnd(seed, i, 0) % (i - F + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

const cmp = (a: Rational, b: Rational): number => { const d = a.num * b.den - b.num * a.den; return d > 0 ? 1 : d < 0 ? -1 : 0; };

/**
 * `byR[i]` maps fixture id to its skill at the i-th resolution (null entries are dropped). A flip is a pair of fixtures
 * that is strictly ordered at one resolution and strictly reversed at another; ties are non-flips.
 */
export function rankFlips(byR: readonly Record<string, Rational | null>[]): { flip: boolean; pairs: [string, string][] } {
  const ids = [...new Set(byR.flatMap((m) => Object.keys(m).filter((k) => m[k] !== null)))].sort();
  const pairs: [string, string][] = [];
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    let up = false, down = false;
    for (const m of byR) {
      const x = m[ids[a]], y = m[ids[b]];
      if (!x || !y) continue;
      const c = cmp(x, y);
      if (c > 0) up = true; else if (c < 0) down = true;
    }
    if (up && down) pairs.push([ids[a], ids[b]]);
  }
  return { flip: pairs.length > 0, pairs };
}
