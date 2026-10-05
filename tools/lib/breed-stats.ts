// The breeder's readout (wild sandbox; WorldConfig.pondScore): per-cycle summaries of a run's ponds.tsv, streamed.
// A run with a score writes BREED_POND_COLUMNS: v1's row per pond per boundary plus the pond's pre-cycle `score`
// and its donor's (`donorScore`), and under a combined score one column per term (`breedPondColumns`). Rows of one
// boundary are contiguous, so one cycle is held at a time.
import { POND_TERMS, type PondTerm } from "@bl/schema";
import type { TsvRow } from "./scaffold-stats.ts";

/** One term of the score over a boundary's ponds. */
export interface TermSummary {
  /** Median over the occupied ponds (NaN when none is). */
  median: number;
  max: number;
  /** Sum over sum of bound mass: for "drive", the mass-weighted mean motility term in 1/64 cell per step. */
  perMass: number;
}

/** One boundary of a breeder (or control) run, over its ponds' pre-cycle measurements. */
export interface CycleSummary {
  cycle: number;
  step: number;
  ponds: number;
  /** Ponds with bound mass (recipientTrait) above 0. */
  occupied: number;
  /** Ponds whose score is above 0. */
  scoring: number;
  scoreMedian: number;
  scoreMean: number;
  scoreMax: number;
  /** Sum of scores over sum of bound mass: for "drive", the mass-weighted mean motility term in 1/64 cell per step. */
  scorePerMass: number;
  massMedian: number;
  /** Mean score of the distinct donors of this boundary (NaN when the history has ended). */
  donorScoreMean: number;
  /** Distinct donors. */
  donors: number;
  individualsMean: number;
  /**
   * Each term the file carries: the term columns of a combined score, or the score itself for a one-term run when
   * the caller names it (`cycleSummaries`' `scoreTerm`).
   */
  terms: Partial<Record<PondTerm, TermSummary>>;
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

type Held = { step: number; donor: number; mass: number; score: number; donorScore: number; individuals: number; terms: Partial<Record<PondTerm, number>> };

function summarize(rows: Held[], cycle: number, scoreTerm: PondTerm | undefined): CycleSummary {
  const scores = rows.map((r) => r.score);
  const mass = rows.reduce((a, r) => a + r.mass, 0);
  const total = scores.reduce((a, s) => a + s, 0);
  const donorScore = new Map<number, number>();
  for (const r of rows) if (r.donor >= 0) donorScore.set(r.donor, r.donorScore);
  const terms: Partial<Record<PondTerm, TermSummary>> = {};
  for (const term of POND_TERMS) {
    const value = (r: Held) => (term === scoreTerm ? r.score : r.terms[term]);
    if (value(rows[0]) === undefined) continue;
    const all = rows.map((r) => value(r)!);
    terms[term] = { median: median(rows.filter((r) => r.mass > 0).map((r) => value(r)!)), max: Math.max(...all), perMass: mass > 0 ? all.reduce((a, v) => a + v, 0) / mass : 0 };
  }
  return {
    cycle,
    step: rows[0].step,
    ponds: rows.length,
    occupied: rows.filter((r) => r.mass > 0).length,
    scoring: scores.filter((s) => s > 0).length,
    scoreMedian: median(scores),
    scoreMean: total / rows.length,
    scoreMax: Math.max(...scores),
    scorePerMass: mass > 0 ? total / mass : 0,
    massMedian: median(rows.map((r) => r.mass)),
    donorScoreMean: donorScore.size ? [...donorScore.values()].reduce((a, s) => a + s, 0) / donorScore.size : NaN,
    donors: donorScore.size,
    individualsMean: rows.reduce((a, r) => a + r.individuals, 0) / rows.length,
    terms,
  };
}

/**
 * Per-cycle summaries of header-keyed ponds.tsv rows, in file order. Throws on a file without the score columns.
 * `scoreTerm` names the term a one-term run's `score` column holds, so its summary appears under `terms` like a
 * combined score's columns do.
 */
export async function* cycleSummaries(rows: AsyncIterable<TsvRow> | Iterable<TsvRow>, scoreTerm?: PondTerm): AsyncGenerator<CycleSummary> {
  const int = (r: TsvRow, key: string): number => {
    const v = r[key];
    if (v === undefined) throw new Error(`ponds.tsv has no "${key}" column${key === "score" || key === "donorScore" ? " (the run has no pondScore)" : ""}`);
    if (!/^-?\d+$/.test(v)) throw new Error(`ponds.tsv column "${key}" is not an integer: ${JSON.stringify(v)}`);
    return Number(v);
  };
  let cycle = -1;
  let held: Held[] = [];
  for await (const r of rows) {
    const c = int(r, "cycle");
    if (c !== cycle) {
      if (held.length) yield summarize(held, cycle, scoreTerm);
      if (c < cycle) throw new Error(`ponds.tsv cycle ${c} follows cycle ${cycle}`);
      cycle = c;
      held = [];
    }
    const terms: Partial<Record<PondTerm, number>> = {};
    for (const term of POND_TERMS) if (r[term] !== undefined) terms[term] = int(r, term);
    held.push({ step: int(r, "step"), donor: int(r, "donor"), mass: int(r, "recipientTrait"), score: int(r, "score"), donorScore: int(r, "donorScore"), individuals: int(r, "recipientIndividuals"), terms });
  }
  if (held.length) yield summarize(held, cycle, scoreTerm);
}

/** How one tile's bound-mass pattern moved between two snapshots (`tileShift`). */
export interface TileShift {
  /** The shift (cells, torus) that best carries the first pattern onto the second, refined to a fraction of a cell. */
  dx: number;
  dy: number;
  /** Normalised correlation of the two patterns at that shift and at no shift (1 = identical up to scale). */
  corr: number;
  corr0: number;
}

/**
 * The displacement of a `side` x `side` torus pattern: the integer shift within `window` cells on each axis that
 * maximises the zero-mean normalised correlation of `before` shifted against `after`, refined on each axis by a
 * parabola through the peak and its two neighbours. A periodic pattern (a lattice of bodies) matches again one
 * period on, so keep `window` under half its period and the time between snapshots short. `null` when either
 * pattern is flat (an empty tile).
 */
export function tileShift(before: ArrayLike<number>, after: ArrayLike<number>, side: number, window: number): TileShift | null {
  const n = side * side;
  if (before.length !== n || after.length !== n) throw new Error(`tileShift: patterns must hold ${n} cells`);
  if (!Number.isInteger(window) || window < 1 || 2 * window >= side) throw new Error(`tileShift: window must be an integer in 1..${Math.ceil(side / 2) - 1}`);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += before[i]; mb += after[i]; }
  ma /= n; mb /= n;
  let va = 0, vb = 0;
  for (let i = 0; i < n; i++) { va += (before[i] - ma) ** 2; vb += (after[i] - mb) ** 2; }
  if (va === 0 || vb === 0) return null;
  const norm = Math.sqrt(va * vb);
  const corrAt = (sx: number, sy: number): number => {
    let s = 0;
    for (let y = 0; y < side; y++) {
      const ty = (y + sy + side) % side;
      for (let x = 0; x < side; x++) s += (before[y * side + x] - ma) * (after[ty * side + ((x + sx + side) % side)] - mb);
    }
    return s / norm;
  };
  const size = 2 * window + 3; // one cell of margin for the parabola at the window's edge
  const grid = new Float64Array(size * size);
  const at = (sx: number, sy: number) => grid[(sy + window + 1) * size + sx + window + 1];
  for (let sy = -window - 1; sy <= window + 1; sy++) for (let sx = -window - 1; sx <= window + 1; sx++) grid[(sy + window + 1) * size + sx + window + 1] = corrAt(sx, sy);
  let bx = 0, by = 0;
  for (let sy = -window; sy <= window; sy++)
    for (let sx = -window; sx <= window; sx++) if (at(sx, sy) > at(bx, by) || (at(sx, sy) === at(bx, by) && Math.abs(sx) + Math.abs(sy) < Math.abs(bx) + Math.abs(by))) { bx = sx; by = sy; }
  const refine = (lo: number, mid: number, hi: number): number => {
    const curve = lo - 2 * mid + hi;
    return curve < 0 ? Math.max(-0.5, Math.min(0.5, (lo - hi) / (2 * curve))) : 0;
  };
  return { dx: bx + refine(at(bx - 1, by), at(bx, by), at(bx + 1, by)), dy: by + refine(at(bx, by - 1), at(bx, by), at(bx, by + 1)), corr: at(bx, by), corr0: at(0, 0) };
}
