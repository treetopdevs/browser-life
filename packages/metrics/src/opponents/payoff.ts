// Pure aggregation for the opponent assay: run classes, shares from integer counts, exact sign-flip tests, intervals,
// invasion, vigour residual, cycles, verdict. Integers in, floats only in the final statistics. No simulator imports.
import { mean } from "../stats.ts";

export const FLOOR_DIV = 16;
/** A label is at the floor when its biomass is below 1/16 of its own step-zero biomass (integer test). */
export const atFloor = (b: number, b0: number): boolean => b * FLOOR_DIV < b0;

export type RunClass = "contested" | "decisive" | "both-floor";
export function classify(b0A: number, b0B: number, bA: number, bB: number): RunClass {
  const fa = atFloor(bA, b0A), fb = atFloor(bB, b0B);
  return fa && fb ? "both-floor" : fa || fb ? "decisive" : "contested";
}
/** Share of A from integer counts. Null when the run is `both-floor` (undefined, never 0.5) or there is no biomass. */
export function shareA(b0A: number, b0B: number, bA: number, bB: number): number | null {
  if (classify(b0A, b0B, bA, bB) === "both-floor" || bA + bB === 0) return null;
  return bA / (bA + bB);
}
/** Display value only; never feeds a gate. */
export const sharePpm = (bA: number, bB: number): number | null => (bA + bB === 0 ? null : Math.floor((1e6 * bA) / (bA + bB)));

/** Two-sided 95% t quantiles, df 1..9 (frozen table; S <= 10 blocks). */
export const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262] as const;

/** Exact two-sided sign-flip p of the sum of `d` (null for an empty input): fraction of the 2^n sign assignments whose |sum| >= observed. */
export function signFlipP(d: readonly number[]): number | null {
  const n = d.length;
  if (n === 0) return null;
  if (n > 20) throw new Error("signFlipP: n > 20");
  const obs = Math.abs(d.reduce((a, b) => a + b, 0));
  const eps = 1e-12;
  let ge = 0;
  for (let m = 0; m < 1 << n; m++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += m & (1 << i) ? d[i] : -d[i];
    if (Math.abs(s) >= obs - eps) ge++;
  }
  return ge / 2 ** n;
}
export const minP = (n: number): number => 2 / 2 ** n;

export interface Interval { mean: number; lo: number; hi: number; df: number }
/** Descriptive t interval (df = n - 1). Never decides anything. Null for n < 2. */
export function tInterval(x: readonly number[]): Interval | null {
  const n = x.length;
  if (n < 2) return null;
  if (n - 1 > T95.length) throw new Error("tInterval: more blocks than the frozen table covers");
  const m = mean([...x]);
  const sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
  const h = (T95[n - 2] * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, df: n - 1 };
}

/** Per-seed record of one contest world at one checkpoint. */
export interface Obs { b0A: number; b0B: number; bA: number; bB: number }

export interface BlockPayoff {
  seed: number;
  /** Mean of A's share over both positions; null when either position is both-floor (the whole block is dropped). */
  payoff: number | null;
  /** Both-floor counted as 0.5 and nothing dropped: the naive reading. */
  naive: number;
  shares: (number | null)[];
}
export function blockPayoff(seed: number, positions: readonly Obs[]): BlockPayoff {
  const shares = positions.map((o) => shareA(o.b0A, o.b0B, o.bA, o.bB));
  const payoff = shares.every((s) => s !== null) ? mean(shares as number[]) : null;
  const naive = mean(positions.map((o, i) => shares[i] ?? 0.5));
  return { seed, payoff, naive, shares };
}

export type PairStatus = "informative" | "uninformative";
export interface PairSummary {
  blocks: number;
  complete: number;
  excluded: number;
  payoffs: number[];
  seeds: number[];
  mean: number | null;
  interval: Interval | null;
  signFlipP: number | null;
  status: PairStatus;
  naiveMean: number;
  /** "A>B", "B>A" or null. Only the confirmatory family may use it. */
  edge: "A>B" | "B>A" | null;
  allSameSide: boolean;
}
export const EDGE_MIN_BLOCKS = 9;
export const EDGE_MIN_OFFSET = 0.05;
export const FAMILY = 10;
export const COMPLETE_FRACTION = { balanced: 0.8, rare: 5 / 6 };

export function summarizePair(blocks: readonly BlockPayoff[], minFraction = COMPLETE_FRACTION.balanced): PairSummary {
  const done = blocks.filter((b) => b.payoff !== null);
  const payoffs = done.map((b) => b.payoff as number);
  const d = payoffs.map((p) => p - 0.5);
  const n = payoffs.length;
  const m = n ? mean(payoffs) : null;
  const status: PairStatus = n >= minFraction * blocks.length - 1e-9 && n > 0 ? "informative" : "uninformative";
  const pv = signFlipP(d);
  const allSameSide = n > 0 && (d.every((v) => v > 0) || d.every((v) => v < 0));
  let edge: PairSummary["edge"] = null;
  if (status === "informative" && allSameSide && n >= EDGE_MIN_BLOCKS && pv !== null && pv <= 0.05 / FAMILY && m !== null && Math.abs(m - 0.5) >= EDGE_MIN_OFFSET) edge = m > 0.5 ? "A>B" : "B>A";
  return {
    blocks: blocks.length, complete: n, excluded: blocks.length - n, payoffs, seeds: done.map((b) => b.seed), mean: m, interval: tInterval(payoffs), signFlipP: pv, status,
    naiveMean: mean(blocks.map((b) => b.naive)), edge, allSameSide,
  };
}

/** Invasion from rare: change of the rare label's share from its measured initial share, per block (mean over the two positions). */
export type InvasionClass = "invades" | "fails" | "unclear" | "uninformative";
export interface InvasionSummary { excess: number[]; complete: number; blocks: number; signFlipP: number | null; class: InvasionClass }
export function summarizeInvasion(perBlock: readonly (number | null)[], minComplete = 5): InvasionSummary {
  const ex = perBlock.filter((v): v is number => v !== null);
  const pv = signFlipP(ex);
  let cls: InvasionClass = "unclear";
  if (ex.length < minComplete) cls = "uninformative";
  else if (ex.every((v) => v > 0) && ex.length === perBlock.length) cls = "invades";
  else if (ex.every((v) => v < 0) && ex.length === perBlock.length) cls = "fails";
  return { excess: ex, complete: ex.length, blocks: perBlock.length, signFlipP: pv, class: cls };
}

/** Descriptive monoculture residual: observed share minus the share solo growth at the same positions predicts. */
export function vigourExpected(vA: number, vB: number): number | null { return vA + vB === 0 ? null : vA / (vA + vB); }
export const vigourResidual = (observed: number, expected: number | null): number | null => (expected === null ? null : observed - expected);

/** Directed 3-cycles among confirmatory edges. edges[i][j] true means i beats j. Each cycle once, rotated to start at its smallest index. */
export function findCycles(edges: readonly (readonly boolean[])[]): number[][] {
  const n = edges.length, out: number[][] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    if (a === b || b === c || a === c) continue;
    if (a < b && a < c && edges[a][b] && edges[b][c] && edges[c][a]) out.push([a, b, c]);
  }
  return out;
}
/** True when there is no directed 3-cycle among the edges. This is NOT a transitivity test: a longer cycle (A>B>C>D>A) passes. */
export function hasNoThreeCycle(edges: readonly (readonly boolean[])[]): boolean {
  return findCycles(edges).length === 0;
}
/** Edge matrix from a payoff matrix: A beats B when the payoff is above 0.5 by at least `offset` and the cell is marked decisive. */
export function edgesFromPayoffs(p: readonly (readonly (number | null)[])[], offset = EDGE_MIN_OFFSET): boolean[][] {
  return p.map((row, i) => row.map((v, j) => i !== j && v !== null && v - 0.5 >= offset));
}

/** Breadth: opponents beaten by a confirmatory edge. Reported beside mean payoff, never combined. */
export function breadth(edges: readonly (readonly boolean[])[]): number[] { return edges.map((row) => row.filter(Boolean).length); }

export interface Gates { G1a: boolean; G1b: boolean; G2: boolean; G3: boolean; G4: boolean; G5: boolean; invalid: boolean }
export type Verdict = "assay-sensitive" | "label-or-position-biased" | "insensitive" | "extinction-limited" | "control-invalid";
/** Precedence is fixed: control-invalid, then label-or-position-biased, insensitive, extinction-limited, assay-sensitive. */
export function decideVerdict(g: Gates): Verdict {
  if (g.invalid || !g.G4 || !g.G5) return "control-invalid";
  if (!g.G1a || !g.G1b) return "label-or-position-biased";
  if (!g.G2) return "insensitive";
  if (!g.G3) return "extinction-limited";
  return "assay-sensitive";
}
