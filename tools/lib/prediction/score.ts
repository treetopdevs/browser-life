// Scoring (PLAN.md, section 8). Multiclass Brier over {up, down, none}: BS = (1/N) sum_i sum_c (p_ic/1000 - o_ic)^2, range 0..2.
// The headline imputes abstentions and invalid/missing predictions with the frozen dev-split prior, so abstaining cannot beat the
// prior; answered-only numbers are reported beside it. A calibrated majority baseline is legitimately strong and is not claimed
// to be punished. The family is the unit of uncertainty.
import { mulberry32 } from "@bl/metrics";
import { CLASSES, type Direction3 } from "./envelope.ts";
import { argmax, type Prediction, type Probs } from "./validate.ts";

export interface ScoredCase {
  caseId: string;
  familyId: string;
  outcome: Direction3;
  /** null: abstained, invalid or missing. */
  prediction: Prediction | null;
  status: "answered" | "abstained" | "invalid" | "missing";
}

export const brierOf = (p: Probs, o: Direction3): number => {
  let s = 0;
  for (const c of CLASSES) {
    const d = p[c] / 1000 - (c === o ? 1 : 0);
    s += d * d;
  }
  return s;
};

export interface Reliability {
  bin: string;
  n: number;
  meanStated: number | null;
  hitRate: number | null;
}
export interface ProposerScore {
  id: string;
  n: number;
  answered: number;
  abstained: number;
  invalid: number;
  missing: number;
  coverage: number;
  abstentionRate: number;
  /** Headline: abstained/invalid/missing imputed with the dev prior. */
  brierImputed: number | null;
  brierAnswered: number | null;
  directionalAccuracy: number | null;
  balancedAccuracy: number | null;
  /** Classes with at least one answered case (the balanced accuracy's denominator). */
  balancedClasses: number;
  reliability: Reliability[];
  validNonNullYield: number | null;
}

export function reliabilityTable(cases: readonly ScoredCase[]): Reliability[] {
  const bins = [0, 0, 0, 0, 0].map(() => ({ n: 0, stated: 0, hit: 0 }));
  for (const c of cases) {
    if (c.status !== "answered" || !c.prediction?.probs) continue;
    const a = argmax(c.prediction.probs);
    const p = c.prediction.probs[a] / 1000;
    const b = Math.min(4, Math.floor(p * 5));
    bins[b].n++;
    bins[b].stated += p;
    if (a === c.outcome) bins[b].hit++;
  }
  return bins.map((b, i) => ({ bin: `${(i * 0.2).toFixed(1)}-${i === 4 ? "1.0" : ((i + 1) * 0.2).toFixed(1)}`, n: b.n, meanStated: b.n ? b.stated / b.n : null, hitRate: b.n ? b.hit / b.n : null }));
}

export function scoreProposer(id: string, cases: readonly ScoredCase[], devPrior: Probs, restrictTo?: ReadonlySet<string>): ProposerScore {
  const cs = restrictTo ? cases.filter((c) => restrictTo.has(c.caseId)) : cases;
  const n = cs.length;
  const answered = cs.filter((c) => c.status === "answered");
  let impSum = 0, ansSum = 0, hit = 0;
  for (const c of cs) impSum += c.status === "answered" ? brierOf(c.prediction!.probs!, c.outcome) : brierOf(devPrior, c.outcome);
  for (const c of answered) {
    ansSum += brierOf(c.prediction!.probs!, c.outcome);
    if (argmax(c.prediction!.probs!) === c.outcome) hit++;
  }
  let recSum = 0, recK = 0;
  for (const k of CLASSES) {
    const rows = answered.filter((c) => c.outcome === k);
    if (!rows.length) continue;
    recK++;
    recSum += rows.filter((c) => argmax(c.prediction!.probs!) === k).length / rows.length;
  }
  return {
    id,
    n,
    answered: answered.length,
    abstained: cs.filter((c) => c.status === "abstained").length,
    invalid: cs.filter((c) => c.status === "invalid").length,
    missing: cs.filter((c) => c.status === "missing").length,
    coverage: n ? answered.length / n : 0,
    abstentionRate: n ? cs.filter((c) => c.status === "abstained").length / n : 0,
    brierImputed: n ? impSum / n : null,
    brierAnswered: answered.length ? ansSum / answered.length : null,
    directionalAccuracy: answered.length ? hit / answered.length : null,
    balancedAccuracy: recK ? recSum / recK : null,
    balancedClasses: recK,
    reliability: reliabilityTable(cs),
    validNonNullYield: n ? answered.filter((c) => c.outcome !== "none").length / n : null,
  };
}

/** Cases that every named comparator answered (the least-covering one's set when nested; else the intersection). */
export function matchedCoverageSet(byProposer: Readonly<Record<string, readonly ScoredCase[]>>): Set<string> {
  let acc: Set<string> | undefined;
  for (const cs of Object.values(byProposer)) {
    const a = new Set<string>(cs.filter((c) => c.status === "answered").map((c) => c.caseId));
    const prev: Set<string> | undefined = acc;
    acc = prev === undefined ? a : new Set<string>([...prev].filter((x) => a.has(x)));
  }
  return acc ?? new Set<string>();
}

/** Total evaluation cost (simulated cell-steps, every arm, null and failed attempts included) over non-null cases; null when there are none. */
export function costPerUseful(totalCellSteps: number, outcomes: readonly Direction3[]): number | null {
  const k = outcomes.filter((o) => o !== "none").length;
  return k === 0 ? null : totalCellSteps / k;
}

/** Sign agreement of two effect vectors' labels (cross-seed effect stability); cases are paired by index. */
export function signAgreement(a: readonly Direction3[], b: readonly Direction3[]): { n: number; agree: number; rate: number | null } {
  if (a.length !== b.length) throw new Error("label vectors differ in length");
  let agree = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
  return { n: a.length, agree, rate: a.length ? agree / a.length : null };
}

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}
export const MIN_FAMILIES_FOR_INTERVALS = 10;

/** Per-family mean of a per-case value. */
export function familyMeans(rows: readonly { familyId: string; v: number }[]): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const a = acc.get(r.familyId) ?? { s: 0, n: 0 };
    a.s += r.v;
    a.n++;
    acc.set(r.familyId, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.s / a.n]));
}

/** Whole-family bootstrap of the mean of per-family values; null below MIN_FAMILIES_FOR_INTERVALS families (descriptive only). */
export function familyBootstrap(perFamily: ReadonlyMap<string, number>, resamples: number, seed: number): Interval | null {
  const v = [...perFamily.keys()].sort().map((k) => perFamily.get(k)!);
  if (v.length < MIN_FAMILIES_FOR_INTERVALS) return null;
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rng() * v.length)];
    means.push(s / v.length);
  }
  means.sort((a, b) => a - b);
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, lo: means[Math.floor(0.025 * resamples)], hi: means[Math.min(resamples - 1, Math.ceil(0.975 * resamples) - 1)] };
}

/** Paired per-family difference (a - b) of two per-family maps over the families both have. */
export function pairedFamilyDiff(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, x] of a) if (b.has(k)) out.set(k, x - b.get(k)!);
  return out;
}
