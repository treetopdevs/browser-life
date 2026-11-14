// Archive tournament, pure part: snapshot selection, the descriptive directional rank against relabelled times, a general
// directed-cycle detector, the temporal verdict table and the pure-matrix fixtures. No simulator import. Not in the metrics barrel.
// Reuses the first rung's payoff statistics (payoff.ts) and does not copy them. Everything here is DESCRIPTIVE: the archive is
// a set of related surviving elites, so a rank against relabelled times is a rank, never a p-value.
import { findCycles, summarizePair, type BlockPayoff, type PairSummary } from "../opponents/payoff.ts";

export const RANK_EPS = 1e-12;

// ---- snapshot selection --------------------------------------------------------------------------------------------

export interface Elite { cell: [number, number]; born: number; quality: number; hex: string }
export interface Bin { bin: number; lo: number; hi: number; status: "viable" | "empty"; pick: Elite | null; candidates: number; screened: number }

/** Bin of a `born` batch index: K equal-width bins over [0, H). */
export const binOf = (born: number, horizon: number, bins: number): number => Math.min(bins - 1, Math.floor((born * bins) / horizon));
/** Horizon in batches: max(born) + 1. `born` is the bootstrap search's batch index, not an evaluation count. */
export const horizonOf = (elites: readonly Pick<Elite, "born">[]): number => elites.reduce((m, e) => Math.max(m, e.born), -1) + 1;

/** Highest quality first, ties by cell then born (all frozen). */
export const byQuality = (a: Elite, b: Elite): number =>
  b.quality - a.quality || a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1] || a.born - b.born;

/** Pure function of the elites and the viability predicate; the predicate is called lazily, best candidate first, once per elite. */
export function selectSnapshots(elites: readonly Elite[], bins: number, isViable: (e: Elite) => boolean): { horizon: number; bins: Bin[] } {
  const horizon = horizonOf(elites);
  const out: Bin[] = [];
  for (let k = 0; k < bins; k++) {
    const cands = elites.filter((e) => binOf(e.born, horizon, bins) === k).sort(byQuality);
    let pick: Elite | null = null, screened = 0;
    for (const e of cands) { screened++; if (isViable(e)) { pick = e; break; } }
    out.push({ bin: k, lo: Math.ceil((k * horizon) / bins), hi: Math.ceil(((k + 1) * horizon) / bins), status: pick ? "viable" : "empty", pick, candidates: cands.length, screened });
  }
  return { horizon, bins: out };
}
export const viableBins = (bins: readonly Bin[]): number => bins.filter((b) => b.status === "viable").length;

// ---- directed cycles -------------------------------------------------------------------------------------------------

/** First directed cycle of any length (edges[i][j]: i beats j), as node indices, or null. Agrees with findCycles on triangles. */
export function directedCycle(edges: readonly (readonly boolean[])[]): number[] | null {
  const n = edges.length, state: number[] = new Array(n).fill(0), stack: number[] = [];
  let found: number[] | null = null;
  const visit = (u: number): void => {
    state[u] = 1; stack.push(u);
    for (let v = 0; v < n && !found; v++) {
      if (!edges[u][v]) continue;
      if (state[v] === 1) { found = stack.slice(stack.indexOf(v)); break; }
      if (state[v] === 0) visit(v);
    }
    stack.pop(); state[u] = 2;
  };
  for (let u = 0; u < n && !found; u++) if (state[u] === 0) visit(u);
  return found;
}
export { findCycles };

// ---- directional statistic ---------------------------------------------------------------------------------------------

/** Every permutation of 0..n-1 (lexicographic). perm[s] = the time rank given to snapshot s. */
export function permutations(n: number): number[][] {
  const out: number[][] = [], cur: number[] = [], used = new Array(n).fill(false);
  const go = (): void => {
    if (cur.length === n) { out.push([...cur]); return; }
    for (let v = 0; v < n; v++) if (!used[v]) { used[v] = true; cur.push(v); go(); cur.pop(); used[v] = false; }
  };
  go();
  return out;
}

export type Mat = (number | null)[][];
/**
 * D(perm) = mean over informative pairs of (payoff of the later-labelled snapshot - 0.5). `m[i][j]` is i's payoff against j
 * (upper triangle read; null = uninformative, excluded and never read as 0.5). The informative mask belongs to the pair, so
 * it travels with the snapshots under relabelling and the number of terms is the same for every permutation.
 */
export function directional(m: Mat, perm: readonly number[], centre = 0.5): { d: number | null; terms: number } {
  let sum = 0, terms = 0;
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
    const v = m[i][j];
    if (v === null) continue;
    sum += perm[j] > perm[i] ? centre - v : v - centre; // value of the later one, minus the centre (0.5 for payoffs, 0 for residuals)
    terms++;
  }
  return { d: terms ? sum / terms : null, terms };
}
export interface Rank { observed: number | null; terms: number; perms: number; rDir: number | null; rRev: number | null; minRank: number }
/** r_dir = #{D_perm >= D_obs} / n! (identity counted); r_rev = #{D_perm <= D_obs} / n!. Ranks against relabelled times, not p-values. */
export function permutationRank(m: Mat, centre = 0.5): Rank {
  const n = m.length, perms = permutations(n);
  const obs = directional(m, perms[0], centre); // lexicographic first is the identity
  if (obs.d === null) return { observed: null, terms: 0, perms: perms.length, rDir: null, rRev: null, minRank: 1 / perms.length };
  let ge = 0, le = 0;
  for (const p of perms) {
    const d = directional(m, p, centre).d as number;
    if (d >= obs.d - RANK_EPS) ge++;
    if (d <= obs.d + RANK_EPS) le++;
  }
  return { observed: obs.d, terms: obs.terms, perms: perms.length, rDir: ge / perms.length, rRev: le / perms.length, minRank: 1 / perms.length };
}
/** Histogram input for the page: every permuted D (sorted ascending), rounded to 1e-9 so the file is byte stable. */
export function permutedValues(m: Mat, centre = 0.5): number[] {
  return permutations(m.length).map((p) => directional(m, p, centre).d).filter((d): d is number => d !== null).map((d) => Math.round(d * 1e9) / 1e9).sort((a, b) => a - b);
}

/** The naive reading: fraction of scheduled (later, earlier) pairs where the later snapshot's payoff exceeds 0.5. Uninformative pairs are not wins. */
export function naiveLaterWins(m: Mat): { wins: number; pairs: number; fraction: number } {
  let wins = 0, pairs = 0;
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { pairs++; const v = m[i][j]; if (v !== null && 1 - v > 0.5 + RANK_EPS) wins++; }
  return { wins, pairs, fraction: pairs ? wins / pairs : 0 };
}

// ---- tournament analysis and the verdict table ---------------------------------------------------------------------------

export interface MatrixInput {
  /** Payoff of row snapshot against column snapshot, upper triangle (i < j; i is the earlier). Null: uninformative. */
  payoff: Mat;
  /** Vigour residual (observed minus solo-predicted share) in the same layout, or null when solo runs are unavailable. */
  resid: Mat | null;
  /** edges[i][j]: i beats j by a confirmed `PairSummary.edge`. */
  edges: boolean[][];
}
export interface Analysis {
  n: number; scheduled: number; informative: number;
  naive: { wins: number; pairs: number; fraction: number };
  rank: Rank; residRank: Rank | null;
  edgeCount: number; cycle: number[] | null; cycleFlag: "cycle" | "acyclic"; trianglesFound: number; ordered: boolean;
}
export const ORDER_MIN_EDGES = 3;
export function analyze(inp: MatrixInput): Analysis {
  const n = inp.payoff.length;
  const rank = permutationRank(inp.payoff);
  let residRank: Rank | null = null;
  if (inp.resid) {
    // the residual is only defined where the payoff is
    const r: Mat = inp.resid.map((row, i) => row.map((v, j) => (inp.payoff[i][j] === null ? null : v)));
    residRank = permutationRank(r, 0);
  }
  const cycle = directedCycle(inp.edges);
  const edgeCount = inp.edges.reduce((s, row) => s + row.filter(Boolean).length, 0);
  let informative = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (inp.payoff[i][j] !== null) informative++;
  return {
    n, scheduled: (n * (n - 1)) / 2, informative, naive: naiveLaterWins(inp.payoff), rank, residRank, edgeCount, cycle,
    cycleFlag: cycle ? "cycle" : "acyclic", trianglesFound: findCycles(inp.edges).length, ordered: !cycle && edgeCount >= ORDER_MIN_EDGES,
  };
}

export type TemporalLabel =
  | "control-invalid" | "insensitive-or-biased" | "assay-failed" | "partial-tournament"
  | "directional-rank" | "directional-vigour-only" | "ordered-not-temporal" | "nothing-beyond-null";
export const TEMPORAL_LABELS: readonly TemporalLabel[] = [
  "control-invalid", "insensitive-or-biased", "assay-failed", "partial-tournament", "directional-rank", "directional-vigour-only", "ordered-not-temporal", "nothing-beyond-null",
];
export interface LabelInput {
  controlInvalid: boolean; insensitiveOrBiased: boolean; assayFailed: boolean;
  scheduled: number; informative: number; rDir: number | null; rDirResid: number | null; ordered: boolean; rDirMax: number;
}
/** Rows 5 to 7 of the verdict table. */
export function bodyLabel(i: Pick<LabelInput, "rDir" | "rDirResid" | "ordered" | "rDirMax">): "directional-rank" | "directional-vigour-only" | "ordered-not-temporal" | "nothing-beyond-null" {
  if (i.rDir !== null && i.rDir <= i.rDirMax) return i.rDirResid !== null && i.rDirResid <= i.rDirMax ? "directional-rank" : "directional-vigour-only";
  return i.ordered ? "ordered-not-temporal" : "nothing-beyond-null";
}
/** Frozen precedence: rows 1 to 4 first match wins; `underlying` is the body label of a partial tournament. */
export function temporalLabel(i: LabelInput): { label: TemporalLabel; underlying: TemporalLabel | null } {
  if (i.controlInvalid) return { label: "control-invalid", underlying: null };
  if (i.insensitiveOrBiased) return { label: "insensitive-or-biased", underlying: null };
  if (i.assayFailed) return { label: "assay-failed", underlying: null };
  const body = bodyLabel(i);
  if (i.informative < i.scheduled) return { label: "partial-tournament", underlying: body };
  return { label: body, underlying: null };
}

// ---- synthetic and planted fixtures ----------------------------------------------------------------------------------

/** Ten blocks around `centre` (offsets -.01, 0, +.01 repeating, summing to zero), so the first rung's edge rule can fire on them. */
export const tenBlocks = (centre: number): BlockPayoff[] =>
  Array.from({ length: 10 }, (_, i) => { const v = centre + [-0.01, 0, 0.01, -0.01, 0, 0.01, -0.01, 0, 0.01, 0][i]; return { seed: i, payoff: v, naive: v, shares: [v] }; });

/** Matrix input from "i|j" -> payoff of i against j (i < j); pairs not listed are 0.5 with no edge. */
export function matrixFromCentres(n: number, centres: Record<string, number>): MatrixInput {
  const payoff: Mat = Array.from({ length: n }, () => new Array(n).fill(null));
  const edges = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const s: PairSummary = summarizePair(tenBlocks(centres[`${i}|${j}`] ?? 0.5));
    payoff[i][j] = s.mean;
    if (s.edge === "A>B") edges[i][j] = true;
    if (s.edge === "B>A") edges[j][i] = true;
  }
  return { payoff, resid: null, edges };
}

/** Reorder a full snapshot-by-snapshot matrix input so `order[t]` is the original index given time t (upper triangle rebuilt). */
export function reorder(full: { payoff: Mat; resid: Mat | null; edges: boolean[][] }, order: readonly number[]): MatrixInput {
  const n = order.length;
  const mk = (src: Mat | null): Mat | null => {
    if (!src) return null;
    const o: Mat = Array.from({ length: n }, () => new Array(n).fill(null));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = order[i], b = order[j];
      o[i][j] = src[a][b];
    }
    return o;
  };
  return { payoff: mk(full.payoff) as Mat, resid: mk(full.resid), edges: order.map((a) => order.map((b) => full.edges[a][b])) };
}

/** A panel matrix in full layout: payoff[i][j] defined for both i != j (mirror 1 - p), resid antisymmetric. */
export interface PanelMatrix { ids: string[]; payoff: Mat; resid: Mat | null; edges: boolean[][]; meanPayoff: Record<string, number | null> }

export interface FixtureResult {
  id: string; synthetic: boolean; times: string[];
  naive: { wins: number; pairs: number; fraction: number };
  rDir: number | null; rDirResid: number | null; minRank: number; cycleFlag: "cycle" | "acyclic"; trianglesFound: number; ordered: boolean;
  label: TemporalLabel; expected: string; pass: boolean; note: string;
}
const bodyOf = (a: Analysis, rDirMax: number): TemporalLabel => bodyLabel({ rDir: a.rank.rDir, rDirResid: a.residRank?.rDir ?? null, ordered: a.ordered, rDirMax });
function result(id: string, synthetic: boolean, times: string[], a: Analysis, rDirMax: number, expected: string, pass: boolean, note: string): FixtureResult {
  return {
    id, synthetic, times, naive: a.naive, rDir: a.rank.rDir, rDirResid: a.residRank?.rDir ?? null, minRank: a.rank.minRank, cycleFlag: a.cycleFlag, trianglesFound: a.trianglesFound,
    ordered: a.ordered, label: bodyOf(a, rDirMax), expected, pass, note,
  };
}

/** Full-layout matrix of a panel under an order of its ids (time 0 first); used by the strength-not-time fixture and its freeze-time search. */
export function panelUnderOrder(panel: PanelMatrix, order: readonly string[]): MatrixInput {
  const idx = order.map((id) => panel.ids.indexOf(id));
  return reorder(panel, idx);
}
/** Order of ids by ascending mean payoff (weakest first): the strength-aligned time assignment. Ties by id. */
export const strengthOrder = (panel: PanelMatrix): string[] =>
  [...panel.ids].sort((a, b) => (panel.meanPayoff[a] ?? 0) - (panel.meanPayoff[b] ?? 0) || (a < b ? -1 : 1));

export interface FixtureSpec { rDirMax: number; scrambled: string[]; panel: PanelMatrix }
export function runFixtures(spec: FixtureSpec): FixtureResult[] {
  const T = spec.rDirMax;
  const out: FixtureResult[] = [];
  // 1. a 3-cycle that the naive metric reads as improvement (2 of 3 pairs "later wins"); K = 3 floor is 1/6, so this validates the flag, not significance
  const c3 = analyze(matrixFromCentres(3, { "0|1": 0.2, "1|2": 0.2, "0|2": 0.8 }));
  out.push(result("cycle-fools-naive", true, ["A", "B", "C"], c3, T, "cycle flag raised; naive 2 of 3", c3.cycleFlag === "cycle" && c3.naive.wins === 2 && c3.naive.pairs === 3 && (c3.rank.rDir ?? 0) > T, "synthetic A<B<C<A; K=3 permutation floor is 1/6, so only the flag is validated"));
  // 2. a 4-cycle plus a dominant newest member: no triangle, so the first rung's findCycles misses it
  const long = analyze(matrixFromCentres(5, { "0|1": 0.1, "1|2": 0.1, "2|3": 0.1, "0|3": 0.56, "0|4": 0.2, "1|4": 0.2, "2|4": 0.2, "3|4": 0.2 }));
  // time order D,C,B,A,E (indices 0..4): C beats D, B beats C, A beats B, D beats A, E beats all
  out.push(result("long-cycle-fools-naive", true, ["D", "C", "B", "A", "E"], long, T, "cycle flag raised by the general detector; findCycles finds no triangle", long.cycleFlag === "cycle" && long.trianglesFound === 0 && long.naive.fraction >= 0.7, "synthetic; edges C>D, B>C, A>B at .9, D>A at .56, E beats every earlier snapshot at .8"));
  // 3. vigour only: payoff V_i/(V_i+V_j), strengths 1..5 aligned with time; residual zero everywhere
  const V = [1, 2, 3, 4, 5];
  const vp: Mat = V.map((a, i) => V.map((b, j) => (j > i ? Math.round((1e9 * a) / (a + b)) / 1e9 : null)));
  const vr: Mat = V.map((_, i) => V.map((_, j) => (j > i ? 0 : null)));
  const vig = analyze({ payoff: vp, resid: vr, edges: V.map(() => V.map(() => false)) });
  out.push(result("vigour-only", true, ["V1", "V2", "V3", "V4", "V5"], vig, T, "directional-vigour-only", bodyOf(vig, T) === "directional-vigour-only" && vig.rank.rDir === 1 / 120, "synthetic; every payoff is exactly the solo-growth share, so the residual has nothing to align"));
  // 4. strength-not-time on the first rung's real panel matrix: aligned versus scrambled time assignment
  const aligned = strengthOrder(spec.panel);
  const al = analyze(panelUnderOrder(spec.panel, aligned));
  const sc = analyze(panelUnderOrder(spec.panel, spec.scrambled));
  const alLabel = bodyOf(al, T), scLabel = bodyOf(sc, T);
  out.push(result("strength-aligned", false, aligned, al, T, "directional-rank or directional-vigour-only", alLabel === "directional-rank" || alLabel === "directional-vigour-only", "first rung's committed pairwise matrix, times in strength order (pure matrix, no new simulation)"));
  out.push(result("strength-scrambled", false, spec.scrambled, sc, T, "ordered-not-temporal", scLabel === "ordered-not-temporal" && (sc.rank.rDir ?? 0) > 0.2, "same matrix, frozen scrambled time assignment; the naive metric still reads it as partly improving"));
  return out;
}

/**
 * The planted chain is in-world: classify it from its measured matrix. Must be directional (rank or vigour-only): the planted
 * manipulation is a weakened photosynthesis weight, a vigour manipulation, so its residual need not align (calibration on the
 * screen seeds showed r_dir = 1/24 with residual ranks 0.29 to 0.67). Every scheduled chain pair must be informative. The vigour split is gated by the vigour-only fixture.
 */
export function chainFixture(a: Analysis, rDirMax: number, times: string[]): FixtureResult {
  return result("planted-chain", false, times, a, rDirMax, "directional-rank or directional-vigour-only", a.informative === a.scheduled && ["directional-rank", "directional-vigour-only"].includes(bodyOf(a, rDirMax)), "calibrated instrument genomes with graded weakening, times in order of strength (in-world positive control)");
}

/** Search used at freeze time: the first order (lexicographic over indices into the strength order) with rank above 0.5 that has the highest naive fraction. */
export function chooseScrambled(panel: PanelMatrix, rDirMax: number): { order: string[]; rDir: number; naive: number } | null {
  const base = strengthOrder(panel);
  let best: { order: string[]; rDir: number; naive: number } | null = null;
  for (const p of permutations(base.length)) {
    const order = p.map((k) => base[k]);
    const a = analyze(panelUnderOrder(panel, order));
    const rd = a.rank.rDir ?? 0;
    if (rd <= 0.2 || a.cycle || !a.ordered || rd <= rDirMax) continue;
    if (!best || a.naive.fraction > best.naive) best = { order, rDir: rd, naive: a.naive.fraction };
  }
  return best;
}
