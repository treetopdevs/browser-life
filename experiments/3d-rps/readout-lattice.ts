// Rule draft section 2 (Q1): the lattice reproduces the literature. Applies 2.2 (grid and add-one errors), 2.3 (supported sign
// changes, V, M_c), 2.4 (R3), 2.6 (the outcome table) and 2.7 (the L = 100 contingency) to the per-(L, M) results of Appendix B.4.
// Pure: readout.ts reads the JSON files.

import { Problems, ReadoutError, medianMean } from "./readout-jobs.ts";

export const LAT_SIZES: readonly number[] = [20, 30, 40, 60];
export const LAT_CONTINGENCY_SIZE = 100;
/** Index `iL` of each size in the seed formula of Appendix A. */
export const LAT_SIZE_INDEX: readonly number[] = [20, 30, 40, 60, 100];
export const LAT_M: readonly number[] = [1e-5, 3e-5, 1e-4, 2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4, 1e-3, 2e-3];
export const LAT_CONTINGENCY_M: readonly number[] = [2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4];
export const LAT_R = 600;
export const LAT_R_CONTINGENCY = 300;
export const LAT_PASS_BAND: readonly [number, number] = [3e-4, 6e-4];
export const LAT_CAVEAT_BAND: readonly [number, number] = [2.25e-4, 9e-4];
export const LAT_PAPER_MC = 4.5e-4;
export const LAT_MIN_PAIRS = 4;
export const LAT_R3_MIN = 0.2;

export interface LatticeCell {
  L: number;
  iM: number;
  M: number;
  R: number;
  /** Realizations with at most one species left. */
  k: number;
}

const cellKey = (L: number, iM: number) => `${L}:${iM}`;

/** Reads one B.4 JSON (`L`, `M`, `iM`, `R`, `k`, and the redundant `pExt`, `seeds`), checking it against the grid and the seed formula of Appendix A. */
export function parseLatticeCell(raw: unknown, where: string): LatticeCell {
  if (raw === null || typeof raw !== "object") throw new ReadoutError(2, `${where}: not an object`);
  const r = raw as Record<string, unknown>;
  const int = (name: string): number => {
    const v = r[name];
    if (typeof v !== "number" || !Number.isInteger(v)) throw new ReadoutError(2, `${where}: ${name} is not an integer`);
    return v;
  };
  const L = int("L");
  const iM = int("iM");
  const R = int("R");
  const k = int("k");
  const M = r.M;
  if (typeof M !== "number" || !Number.isFinite(M)) throw new ReadoutError(2, `${where}: M is not a number`);
  const iL = LAT_SIZE_INDEX.indexOf(L);
  if (iL < 0) throw new ReadoutError(2, `${where}: L ${L} is not one of ${LAT_SIZE_INDEX.join(", ")}`);
  if (iM < 0 || iM >= LAT_M.length || Math.abs(M / LAT_M[iM] - 1) > 1e-9) throw new ReadoutError(2, `${where}: M ${M} is not grid value ${iM} (${LAT_M[iM]})`);
  const wantR = L === LAT_CONTINGENCY_SIZE ? LAT_R_CONTINGENCY : LAT_R;
  if (R !== wantR) throw new ReadoutError(2, `${where}: R is ${R}, the rules give ${wantR} for L ${L}`);
  if (k < 0 || k > R) throw new ReadoutError(2, `${where}: k ${k} outside 0..${R}`);
  if (r.pExt !== undefined && (typeof r.pExt !== "number" || Math.abs(r.pExt - k / R) > 1e-12)) throw new ReadoutError(2, `${where}: pExt is not k / R`);
  // the sweep driver also stores the add-one error it computed; the two modules must agree on the convention of 2.2
  if (r.se !== undefined && (typeof r.se !== "number" || Math.abs(r.se - addOneSE(k, R)) > 1e-12)) throw new ReadoutError(2, `${where}: se ${String(r.se)} is not the add-one error ${addOneSE(k, R)}`);
  if (r.mode !== undefined && r.mode !== "sweep") throw new ReadoutError(2, `${where}: mode is ${JSON.stringify(r.mode)}, not a registered sweep cell (a rehearsal is plumbing, not a result)`);
  if (r.seeds !== undefined) {
    const s = r.seeds;
    const first = 2_000_000 + 100_000 * iL + 1_000 * iM;
    if (!Array.isArray(s) || s.length !== 2 || s[0] !== first || s[1] !== first + R - 1) {
      throw new ReadoutError(2, `${where}: seeds ${JSON.stringify(s)} are not [${first}, ${first + R - 1}] (Appendix A)`);
    }
  }
  return { L, iM, M, R, k };
}

/** The add-one error of 2.2: `p' = (k + 1) / (R + 2)`, `SE = sqrt(p' (1 - p') / (R + 2))`; never 0. */
export function addOneSE(k: number, R: number): number {
  const p = (k + 1) / (R + 2);
  return Math.sqrt((p * (1 - p)) / (R + 2));
}

export interface PairPoint {
  M: number;
  D: number;
  seD: number;
}

export interface SignChange {
  /** Index of `Ma` in the pair's grid; `Mb` is the next value. */
  ia: number;
  Ma: number;
  Mb: number;
  supported: boolean;
}

export interface PairResult {
  L1: number;
  L2: number;
  points: PairPoint[];
  signChanges: SignChange[];
  valid: boolean;
  /** The supported sign change with the lowest `Ma`; null for an invalid pair. */
  crossing: SignChange | null;
  /** The zero of the straight line through `(log10 Ma, D(Ma))` and `(log10 Mb, D(Mb))`; null for an invalid pair. */
  estimate: number | null;
}

/** 2.3 for one pair `L1 < L2` on the grid `M` values (ascending): `D(M)`, `SE_D(M)`, the sign changes, which are supported, and the estimate. */
export function analyzePair(L1: number, L2: number, cells: ReadonlyMap<string, LatticeCell>, grid: readonly number[]): PairResult {
  const points: PairPoint[] = grid.map((M) => {
    const iM = LAT_M.findIndex((g) => Math.abs(M / g - 1) < 1e-9);
    const a = cells.get(cellKey(L1, iM));
    const b = cells.get(cellKey(L2, iM));
    if (!a || !b) throw new ReadoutError(4, `lattice cell missing: L ${a ? L2 : L1}, M ${M}`);
    const seA = addOneSE(a.k, a.R);
    const seB = addOneSE(b.k, b.R);
    // D = k_b / R_b - k_a / R_a from integers with one rounding (0.3 - 0.1 is not 0.2 in floating point)
    return { M, D: (b.k * a.R - a.k * b.R) / (a.R * b.R), seD: Math.sqrt(seA * seA + seB * seB) };
  });
  const signChanges: SignChange[] = [];
  for (let ia = 0; ia + 1 < points.length; ia++) {
    if (!(points[ia].D <= 0 && points[ia + 1].D > 0)) continue;
    const low = points.slice(0, ia + 1).some((p) => p.D < 0 && p.D <= -2 * p.seD);
    const high = points.slice(ia + 1).some((p) => p.D > 0 && p.D >= 2 * p.seD);
    signChanges.push({ ia, Ma: points[ia].M, Mb: points[ia + 1].M, supported: low && high });
  }
  const crossing = signChanges.find((s) => s.supported) ?? null;
  let estimate: number | null = null;
  if (crossing) {
    const a = points[crossing.ia];
    const b = points[crossing.ia + 1];
    if (a.D === 0) estimate = a.M;
    else {
      const xa = Math.log10(a.M);
      const xb = Math.log10(b.M);
      estimate = 10 ** (xa + ((0 - a.D) * (xb - xa)) / (b.D - a.D));
    }
  }
  return { L1, L2, points, signChanges, valid: crossing !== null, crossing, estimate };
}

export type LatticeName = "LAT-PASS" | "LAT-CAVEAT" | "LAT-OFFSET" | "LAT-TREND" | "LAT-NOCROSS";
export interface LatticeRow {
  row: 1 | 2 | 3 | 4 | 5;
  name: LatticeName;
}

const inBand = (x: number, band: readonly [number, number]) => x >= band[0] && x <= band[1];

/** The outcome table of 2.6: the first row that holds. `Mc` is null when no pair is valid. */
export function latticeRow(V: number, Mc: number | null, r3: boolean): LatticeRow {
  if (V >= LAT_MIN_PAIRS && Mc !== null && r3 && inBand(Mc, LAT_PASS_BAND)) return { row: 1, name: "LAT-PASS" };
  if (V >= LAT_MIN_PAIRS && Mc !== null && r3 && inBand(Mc, LAT_CAVEAT_BAND)) return { row: 2, name: "LAT-CAVEAT" };
  if (V >= LAT_MIN_PAIRS && r3) return { row: 3, name: "LAT-OFFSET" };
  if (V >= LAT_MIN_PAIRS) return { row: 4, name: "LAT-TREND" };
  return { row: 5, name: "LAT-NOCROSS" };
}

export interface LatticeEvaluation {
  pairs: PairResult[];
  /** Number of valid pairs (the `V` of 2.3, not rung V). */
  V: number;
  /** Median of the valid pairs' estimates (the mean of the two middle values for an even count); null if none. */
  Mc: number | null;
  estimates: number[];
  McOverPaper: number | null;
  /** `P_ext(60, 2e-3) - P_ext(60, 1e-5)`. */
  r3Delta: number;
  r3: boolean;
  outcome: LatticeRow;
}

function cellAt(cells: ReadonlyMap<string, LatticeCell>, L: number, iM: number): LatticeCell {
  const c = cells.get(cellKey(L, iM));
  if (!c) throw new ReadoutError(4, `lattice cell missing: L ${L}, M ${LAT_M[iM]}`);
  return c;
}

function evaluate(cells: ReadonlyMap<string, LatticeCell>, withContingency: boolean): LatticeEvaluation {
  const pairs: PairResult[] = [];
  for (let i = 0; i < LAT_SIZES.length; i++) for (let j = i + 1; j < LAT_SIZES.length; j++) pairs.push(analyzePair(LAT_SIZES[i], LAT_SIZES[j], cells, LAT_M));
  if (withContingency) for (const L of LAT_SIZES) pairs.push(analyzePair(L, LAT_CONTINGENCY_SIZE, cells, LAT_CONTINGENCY_M));
  const estimates = pairs.filter((p) => p.valid).map((p) => p.estimate as number);
  const Mc = estimates.length === 0 ? null : medianMean(estimates);
  const hi = cellAt(cells, 60, LAT_M.length - 1);
  const lo = cellAt(cells, 60, 0);
  const r3Delta = (hi.k * lo.R - lo.k * hi.R) / (hi.R * lo.R); // P_ext(60, 2e-3) - P_ext(60, 1e-5), exact for R = 600
  const r3 = r3Delta >= LAT_R3_MIN;
  return { pairs, V: estimates.length, Mc, estimates: [...estimates].sort((a, b) => a - b), McOverPaper: Mc === null ? null : Mc / LAT_PAPER_MC, r3Delta, r3, outcome: latticeRow(estimates.length, Mc, r3) };
}

export interface LatticeResult {
  /** `final`: the outcome stands; `contingency-required`: rows 3 to 5 and the L = 100 cells are not all there (exit 4); `incomplete`: main-grid cells missing (exit 4). */
  status: "final" | "contingency-required" | "incomplete";
  /** The main grid alone (2.6 applied once); null while cells are missing. */
  main: LatticeEvaluation | null;
  /** All pairs including L = 100 (2.7), when the contingency was needed and its cells are complete. */
  contingency: LatticeEvaluation | null;
  /** LAT-PASS, LAT-CAVEAT, LAT-OFFSET, LAT-TREND, LAT-NOCROSS or LAT-FAIL once the outcome stands. */
  name: LatticeName | "LAT-FAIL" | null;
  missing: string[];
  problems: Problems;
  /** The cells the result was computed from (for the report's tables). */
  cells: LatticeCell[];
}

/** Sections 2.2 to 2.7 over the cells of a lattice sweep (duplicates are unusable input; missing cells are exit 4). */
export function evaluateLattice(cellList: readonly LatticeCell[]): LatticeResult {
  const pr = new Problems();
  const cells = new Map<string, LatticeCell>();
  for (const c of cellList) {
    const key = cellKey(c.L, c.iM);
    if (cells.has(key)) pr.add(2, `lattice cell L ${c.L}, M ${c.M} occurs twice`);
    cells.set(key, c);
  }
  const need = (L: number, ms: readonly number[]) => ms.flatMap((M) => (cells.has(cellKey(L, LAT_M.findIndex((g) => g === M))) ? [] : [`L ${L}, M ${M}`]));
  const missingMain = LAT_SIZES.flatMap((L) => need(L, LAT_M));
  if (missingMain.length > 0) {
    pr.add(4, `lattice cells missing (${missingMain.length} of ${LAT_SIZES.length * LAT_M.length}): ${missingMain.slice(0, 6).join("; ")}${missingMain.length > 6 ? "; ..." : ""}`);
    return { status: "incomplete", main: null, contingency: null, name: null, missing: missingMain, problems: pr, cells: [...cellList] };
  }
  const main = evaluate(cells, false);
  if (main.outcome.row <= 2) return { status: "final", main, contingency: null, name: main.outcome.name, missing: [], problems: pr, cells: [...cellList] };
  // rows 3 to 5: the contingency of 2.7 (L = 100, R = 300, six values of M)
  const missingCont = need(LAT_CONTINGENCY_SIZE, LAT_CONTINGENCY_M);
  if (missingCont.length > 0) {
    pr.add(4, `rows 3 to 5 of 2.6 (${main.outcome.name}): the 2.7 contingency needs L = 100 cells, ${missingCont.length} of ${LAT_CONTINGENCY_M.length} missing: ${missingCont.join("; ")}`);
    return { status: "contingency-required", main, contingency: null, name: null, missing: missingCont, problems: pr, cells: [...cellList] };
  }
  const contingency = evaluate(cells, true);
  const name = contingency.outcome.row <= 2 ? contingency.outcome.name : "LAT-FAIL";
  return { status: "final", main, contingency, name, missing: [], problems: pr, cells: [...cellList] };
}
