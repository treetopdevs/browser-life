// Descriptor calibration for the behaviour atlas (I01), pure so it is tested without a GPU. The rules are the ones
// fixed in docs/behaviour-atlas-2026-11-01/PLAN.md ("Descriptor calibration") before any real genome was described.

import { spearman, type AtlasSpec } from "./descriptors.ts";
import { quality, type Evaluation } from "./evaluate.ts";

export interface CalRow {
  key: string;
  eval: Evaluation;
}

/** Nearest-rank percentile: sorted[ceil(p n) - 1]. */
export function percentile(xs: number[], p: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

/**
 * The range rule: D1 in [0, ceil to 0.25 of the 95th percentile], D2 in [floor to 0.05 of the 5th percentile, 1].
 * Degenerate guards (D1 upper bound at least 0.25, D2 lower bound at most 0.95) keep a range non-empty; they did not
 * bind in the recorded calibration (D1 1.75, D2 0) and were in the code before any calibration row existed.
 */
export function rangesFromCalibration(d1: number[], d2: number[]): Pick<AtlasSpec, "displacementRange" | "persistenceRange"> {
  const hi = Math.max(0.25, Math.ceil(percentile(d1, 0.95) / 0.25) * 0.25);
  const lo = Math.min(0.95, Math.floor(percentile(d2, 0.05) / 0.05) * 0.05);
  return { displacementRange: [0, hi], persistenceRange: [Number(lo.toFixed(2)), 1] };
}

export type Verdict = "usable" | "mostly-undefined" | "noisy" | "redundant";

export interface CalibrationReport {
  n: number;
  ranges: Pick<AtlasSpec, "displacementRange" | "persistenceRange">;
  d1: { defined: number; definedFrac: number; correlationAB: number | null; pairsAB: number; versusSpeed: number | null; versusMeanMass: number | null; versusQuality: number | null; verdict: Verdict };
  d2: { defined: number; definedFrac: number; correlationAB: number | null; pairsAB: number; versusSpeed: number | null; versusMeanMass: number | null; versusQuality: number | null; verdict: Verdict };
  /** Occupied of 64 joint cells for the candidates with both descriptors, and of the existing mass/speed map for the same candidates. */
  cells: { atlas: number; massSpeed: number; sparse: boolean };
  /** "sparse" (< 12 of 64 joint cells) is a property of the pair, not of one descriptor. */
  pair: "usable" | "sparse";
  /** Spearman of the two descriptors against each other (they should not be collinear). */
  d1VersusD2: number | null;
  usableBoth: boolean;
}

const nn = (v: number): number | null => (Number.isFinite(v) ? v : null);

/**
 * A is the calibration set, B a re-evaluation of its first `b.length` genomes on other seeds. Verdicts are those of the
 * plan: mostly-undefined (< 80% defined), noisy (A/B Spearman < 0.5), redundant (|rho| >= 0.9 against D1~speed or
 * D2~log2 meanMass), else usable; `sparse` (< 12 of 64 joint cells) is a property of the pair.
 */
export function calibrate(a: CalRow[], b: CalRow[], bins = 8): CalibrationReport {
  const val = (r: CalRow, k: "d1" | "d2") => r.eval.atlas?.[k] ?? null;
  const ranges = rangesFromCalibration(a.map((r) => val(r, "d1")).filter((v): v is number => v !== null), a.map((r) => val(r, "d2")).filter((v): v is number => v !== null));
  const pairs = (k: "d1" | "d2", other: (r: CalRow) => number) => {
    const rows = a.filter((r) => val(r, k) !== null);
    return { xs: rows.map((r) => val(r, k)!), ys: rows.map(other) };
  };
  const ab = (k: "d1" | "d2") => {
    const m = a.slice(0, b.length).map((r, i) => [val(r, k), val(b[i], k)] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
    return { rho: nn(spearman(m.map((p) => p[0]), m.map((p) => p[1]))), n: m.length };
  };
  const against = (k: "d1" | "d2", other: (r: CalRow) => number) => {
    const p = pairs(k, other);
    return nn(spearman(p.xs, p.ys));
  };
  const verdict = (k: "d1" | "d2", nearest: number | null, ab_: number | null): { defined: number; definedFrac: number; verdict: Verdict } => {
    const defined = a.filter((r) => val(r, k) !== null).length;
    const definedFrac = a.length ? defined / a.length : 0;
    const v: Verdict = definedFrac < 0.8 ? "mostly-undefined" : ab_ === null || ab_ < 0.5 ? "noisy" : nearest !== null && Math.abs(nearest) >= 0.9 ? "redundant" : "usable";
    return { defined, definedFrac, verdict: v };
  };
  const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)));
  const both = a.filter((r) => val(r, "d1") !== null && val(r, "d2") !== null);
  const atlasCells = new Set(both.map((r) => `${bin(val(r, "d1")!, ranges.displacementRange)},${bin(val(r, "d2")!, ranges.persistenceRange)}`));
  const msCells = new Set(a.map((r) => `${Math.max(0, Math.min(bins - 1, Math.floor(((Math.log2(Math.max(1, r.eval.meanMass)) - 7) / 6) * bins)))},${Math.max(0, Math.min(bins - 1, Math.floor((r.eval.speed / 4) * bins)))}`));
  const speed = (r: CalRow) => r.eval.speed, lmass = (r: CalRow) => Math.log2(Math.max(1, r.eval.meanMass)), q = (r: CalRow) => quality(r.eval);
  const v1 = against("d1", speed), v2 = against("d2", lmass);
  const ab1 = ab("d1"), ab2 = ab("d2");
  const d1 = { ...verdict("d1", v1, ab1.rho), correlationAB: ab1.rho, pairsAB: ab1.n, versusSpeed: v1, versusMeanMass: against("d1", lmass), versusQuality: against("d1", q) };
  const d2 = { ...verdict("d2", v2, ab2.rho), correlationAB: ab2.rho, pairsAB: ab2.n, versusSpeed: against("d2", speed), versusMeanMass: v2, versusQuality: against("d2", q) };
  return {
    n: a.length,
    ranges,
    d1,
    d2,
    cells: { atlas: atlasCells.size, massSpeed: msCells.size, sparse: atlasCells.size < 12 },
    pair: atlasCells.size < 12 ? "sparse" : "usable",
    d1VersusD2: nn(spearman(both.map((r) => val(r, "d1")!), both.map((r) => val(r, "d2")!))),
    usableBoth: d1.verdict === "usable" && d2.verdict === "usable" && atlasCells.size >= 12,
  };
}
