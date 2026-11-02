// Pair accuracy and the frozen verdict rule (PROTOCOL.md 4). Independent of any stored evidence.
import { cmpRat, type Rat } from "./readouts.ts";

export type Direction = "lower" | "higher";

/** Fraction of (positive, negative) pairs ordered in `dir`; ties count one half. Exact: (2 wins + ties) / (2 pairs). */
export function pairAccuracy(pos: readonly Rat[], neg: readonly Rat[], dir: Direction): Rat {
  let twice = 0;
  for (const p of pos) for (const q of neg) {
    const c = cmpRat(p, q);
    if (c === 0) twice += 1;
    else if ((dir === "lower" && c < 0) || (dir === "higher" && c > 0)) twice += 2;
  }
  return { num: twice, den: 2 * pos.length * neg.length };
}

/** Exactly one with a positive denominator: an empty comparison (0/0) is never a separation. */
export const isOne = (r: Rat): boolean => r.den > 0 && r.num === r.den;
/** Best of the two directions: the conservative baseline bar. */
export function bestDirection(pos: readonly Rat[], neg: readonly Rat[]): Rat {
  const lo = pairAccuracy(pos, neg, "lower"), hi = pairAccuracy(pos, neg, "higher");
  return lo.num >= hi.num ? lo : hi;
}

export type Verdict =
  | "not directional"
  | "measurement-limited"
  | "fails to separate"
  | "segmentation-dominated"
  | "separates, but not beyond baselines"
  | "separates, adds value over simple baselines";

export interface VerdictInput {
  direction: Direction | null;
  /** True when any score needed for the readout is undefined (empty eligible set). */
  hasNull: boolean;
  /** Global veto: false when any duplicated-motif negative (random-dup, random-dup-hi, random-dup-12) scores as strongly as the weakest hier-12 replicate. */
  dupNegativesOrdered: boolean;
  /** Per grid cell: the identical predicate everywhere, matched-pair accuracy is exactly one. */
  cells: { id: string; separates: boolean }[];
  /** Best baseline accuracy on the matched pair, both directions tried. */
  baselineBest: Rat;
}

export function decideVerdict(v: VerdictInput): { verdict: Verdict; cells: { id: string; separates: boolean }[] } {
  const done = (verdict: Verdict) => ({ verdict, cells: v.cells });
  if (v.hasNull) return done("measurement-limited");
  if (v.direction === null) return done("not directional");
  if (!v.dupNegativesOrdered) return done("fails to separate");
  const yes = v.cells.filter((c) => c.separates).length;
  if (yes === 0) return done("fails to separate");
  if (yes < v.cells.length) return done("segmentation-dominated");
  return done(isOne(v.baselineBest) ? "separates, but not beyond baselines" : "separates, adds value over simple baselines");
}

/** The sentence the report must carry for a verdict. */
export function verdictSentence(v: Verdict): string {
  switch (v) {
    case "fails to separate": return "fails to separate; no life-detection claim is made from this readout";
    case "segmentation-dominated": return "segmentation-dominated: the verdict changes with the object definition (published as a sensitivity failure)";
    case "not directional": return "not directional at matched size and multiplicity; cannot separate";
    case "measurement-limited": return "measurement-limited: the eligible set is empty";
    case "separates, but not beyond baselines": return "separates, but not beyond baselines; no life-detection claim is made";
    case "separates, adds value over simple baselines": return "separates the hand-built hierarchy from the matched random motif and adds value over simple baselines; no life-detection claim is made";
  }
}
