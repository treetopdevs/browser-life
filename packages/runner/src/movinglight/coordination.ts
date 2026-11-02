// Residual coordination: the key control. Per census interval and body pair (both lineages alive at both interval ends) the
// idiosyncratic displacement is e_i = dx_i - dm, with dm the sun's recorded displacement for that interval, so sun-driven common forcing
// cancels by construction. A pair's statistic is the covariance of e_i and e_j across the window's intervals (the mean is removed, so a
// shared lag also cancels); the arm statistic is the mean over pairs. Exact integer rationals scaled to milli-Q^2. The naive metric
// (pairwise sign agreement of raw displacements) is computed beside it and saturates under common forcing.
import { PROTOCOL, type Protocol } from "./protocol.ts";
import { circQ, type Census } from "./observe.ts";
import { sunDelta } from "./schedule.ts";

export interface Track {
  /** Positions in 1/Q cell mod W*Q per census; null when the body is extinct at that census. */
  t: number[];
  q: (number | null)[][];
}

export const trackOf = (censuses: readonly Census[], w: { from: number; to: number }): Track => {
  const cs = censuses.filter((c) => c.t >= w.from && c.t <= w.to);
  const n = cs[0]?.bodies.length ?? 0;
  return { t: cs.map((c) => c.t), q: Array.from({ length: n }, (_, k) => cs.map((c) => c.bodies[k]?.q ?? null)) };
};

export interface Coordination {
  /** Mean pair covariance of idiosyncratic displacement, milli-Q^2, or null (unavailable, never 0) when no pair has two intervals. */
  covMilliQ2: number | null;
  pairs: number;
  /** Intervals in the window and pair-intervals used. */
  intervals: number;
  pairIntervals: number;
  /** Pair-intervals excluded as label hand-overs (a centroid jump above jumpMaxCells). */
  excluded: number;
  /** Naive metric: fraction of pair-intervals whose raw displacements have the same sign (both nonzero), ppm; null when none. */
  signAgreementPpm: number | null;
}

export function coordination(tr: Track, path: readonly number[], p: Protocol = PROTOCOL): Coordination {
  const WQ = p.W * p.Q;
  const K = tr.t.length - 1;
  const dm: number[] = [];
  for (let k = 0; k < K; k++) dm.push(sunDelta(path, tr.t[k], tr.t[k + 1], p.W) * p.Q);
  const nb = tr.q.length;
  let moved = 0;
  let excluded = 0, pairs = 0, pairIntervals = 0, agree = 0, both = 0, sum = 0;
  for (let i = 0; i < nb; i++)
    for (let j = i + 1; j < nb; j++) {
      let c = 0, si = 0, sj = 0, sij = 0;
      for (let k = 0; k < K; k++) {
        const a0 = tr.q[i][k], a1 = tr.q[i][k + 1], b0 = tr.q[j][k], b1 = tr.q[j][k + 1];
        if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
        const di = circQ(a1, a0, WQ), dj = circQ(b1, b0, WQ);
        if (Math.abs(di) > p.jumpMaxCells * p.Q || Math.abs(dj) > p.jumpMaxCells * p.Q) {
          excluded++;
          continue;
        }
        if (di !== 0 && dj !== 0) {
          both++;
          if (di > 0 === dj > 0) agree++;
        }
        moved += Math.abs(di) + Math.abs(dj) + Math.abs(dm[k]);
        const ei = di - dm[k], ej = dj - dm[k];
        c++;
        si += ei;
        sj += ej;
        sij += ei * ej;
      }
      if (c < 2) continue;
      pairs++;
      pairIntervals += c;
      sum += Math.floor((1000 * (c * sij - si * sj)) / (c * c));
    }
  return { covMilliQ2: pairs && moved > 0 ? Math.floor(sum / pairs) : null, pairs, intervals: K, pairIntervals, excluded, signAgreementPpm: both ? Math.floor((p.PPM * agree) / both) : null };
}
