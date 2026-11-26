// I06 edge decision: exact integer sign tests, intersection-union within a candidate, Holm across candidates, and the
// three-valued panel verdict. Everything is an integer or a rational {num, den} of integers (no floats), so the sealed
// payload canonicalizes. The rules are those of docs/niche-construction-2026-11-01/PLAN.md section 5.3.
import type { EvidenceStatus } from "@bl/schema";

export interface Rat {
  num: number;
  den: number;
}

/** a <= b for rationals with positive denominators (all values here are far below 2^53 / each other). */
export const ratLe = (a: Rat, b: Rat): boolean => a.num * b.den <= b.num * a.den;
export const ratMax = (rs: Rat[]): Rat => rs.reduce((m, r) => (ratLe(m, r) ? r : m));

const choose = (n: number, k: number): number => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
};

/** One-sided exact sign test: P(Binomial(n, 1/2) >= k), where k counts strictly positive paired differences (zeros are non-positive). */
export function signTestP(n: number, k: number): Rat {
  let num = 0;
  for (let j = Math.max(0, k); j <= n; j++) num += choose(n, j);
  return { num, den: 2 ** n };
}

export const positives = (d: readonly number[]): number => d.filter((x) => x > 0).length;

/** Sum of the two middle values of the sorted differences (n even) or twice the middle one (n odd): median >= delta iff this >= 2*delta. */
export function medianTimes2(d: readonly number[]): number {
  const s = [...d].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? 2 * s[(n - 1) / 2] : s[n / 2 - 1] + s[n / 2];
}

export interface ContrastResult {
  n: number;
  k: number;
  p: Rat;
  medianTimes2: number;
  /** p <= alpha and median >= delta. */
  passes: boolean;
}

export function contrastResult(d: readonly number[], delta: number, alpha: Rat): ContrastResult {
  const k = positives(d);
  const p = signTestP(d.length, k);
  const m2 = medianTimes2(d);
  return { n: d.length, k, p, medianTimes2: m2, passes: ratLe(p, alpha) && m2 >= 2 * delta };
}

export const GATING = ["builder", "poly", "space", "inoc"] as const;
export type Gating = (typeof GATING)[number];
export const ALPHA: Rat = { num: 1, den: 20 };

export interface CandidateInput {
  id: string;
  status: "ok" | "invalid" | "not-run";
  invalidReasons: string[];
  /** Per-block paired differences on the fresh blocks, one array per gating contrast, plus the attribution-only ones. */
  contrasts: Record<Gating, number[]> & { spaceP: number[]; spaceNP: number[] };
  delta: number;
  survivedBlocks: number;
  blocks: number;
  /** The builder history produced polymer on dev (above the replicate floor). */
  polymerAdequate: boolean;
  /** Blocks assigned to the candidate; all must be valid. */
  expectedBlocks: number;
}

export interface CandidateResult {
  id: string;
  label: EvidenceStatus | "not-run";
  mechanism: "polymer-arrangement-attributed" | "non-polymer field pattern" | "combined conditioned field" | "n/a";
  reasons: string[];
  gating: Record<Gating, ContrastResult>;
  attribution: { spaceP: ContrastResult; spaceNP: ContrastResult };
  pCand: Rat;
  holmThreshold: Rat | null;
  holmRejected: boolean;
  survivalPass: boolean;
}

export function decideCandidates(cands: readonly CandidateInput[], positiveControlPassed: boolean, minSurvived = 7): CandidateResult[] {
  const ran = cands.filter((c) => c.status !== "not-run");
  const m = ran.length;
  const alphaEach: Rat = { num: ALPHA.num, den: ALPHA.den * Math.max(1, m) };
  const results = new Map<string, CandidateResult>();
  const raw = (d: readonly number[], delta: number): ContrastResult => contrastResult(d, delta, { num: 0, den: 1 });
  for (const c of cands) {
    const g = Object.fromEntries(GATING.map((k) => [k, raw(c.contrasts[k], c.delta)])) as Record<Gating, ContrastResult>;
    results.set(c.id, {
      id: c.id,
      label: "not-run",
      mechanism: "n/a",
      reasons: [],
      gating: g,
      attribution: { spaceP: contrastResult(c.contrasts.spaceP, c.delta, alphaEach), spaceNP: contrastResult(c.contrasts.spaceNP, c.delta, alphaEach) },
      pCand: c.status === "ok" && c.blocks === c.expectedBlocks ? ratMax(GATING.map((k) => g[k].p)) : { num: 1, den: 1 },
      holmThreshold: null,
      holmRejected: false,
      survivalPass: c.survivedBlocks >= minSurvived,
    });
  }
  // Holm step-down over the candidates that ran (an invalid one counts with p = 1, never dropped).
  const order = ran.map((c) => results.get(c.id)!).sort((a, b) => a.pCand.num * b.pCand.den - b.pCand.num * a.pCand.den || (a.id < b.id ? -1 : 1));
  let stopped = false;
  order.forEach((r, i) => {
    r.holmThreshold = { num: ALPHA.num, den: ALPHA.den * (m - i) };
    if (!stopped && ratLe(r.pCand, r.holmThreshold)) r.holmRejected = true;
    else stopped = true;
  });
  // A gating contrast passes when its own p is within the threshold the candidate faced in Holm and its median clears delta.
  for (const c of ran) {
    const r = results.get(c.id)!;
    for (const k of GATING) r.gating[k].passes = ratLe(r.gating[k].p, r.holmThreshold!) && r.gating[k].medianTimes2 >= 2 * c.delta;
  }
  for (const c of ran) {
    const r = results.get(c.id)!;
    if (c.status === "invalid" || c.blocks !== c.expectedBlocks) {
      r.label = "invalid-or-incomplete";
      r.reasons = c.invalidReasons.length ? c.invalidReasons : [`${c.blocks} of ${c.expectedBlocks} blocks valid`];
    } else if (!positiveControlPassed) {
      r.label = "unsupported-measurement";
      r.reasons = ["positive control (hand-wall) shows no spatial dependence in the frozen regime: the assay is insensitive"];
    } else if (!c.polymerAdequate) {
      r.label = "unsupported-measurement";
      r.reasons = ["builder produced no polymer above the replicate floor at the end of conditioning"];
    } else {
      const failed = GATING.filter((k) => !r.gating[k].passes);
      const ok = r.holmRejected && failed.length === 0 && r.survivalPass;
      r.label = ok ? "supported" : "unsupported-within-tested-domain";
      if (!ok) {
        if (failed.length) r.reasons.push(`contrast(s) not passing: ${failed.join(", ")}`);
        if (!r.holmRejected) r.reasons.push("Holm does not reject the candidate");
        if (!r.survivalPass) r.reasons.push("receiver survival rule not met");
      } else {
        r.mechanism = r.attribution.spaceP.passes && !r.attribution.spaceNP.passes ? "polymer-arrangement-attributed" : !r.attribution.spaceP.passes && r.attribution.spaceNP.passes ? "non-polymer field pattern" : "combined conditioned field";
      }
    }
  }
  return cands.map((c) => results.get(c.id)!);
}

export type PanelVerdict = "causal-benefit-detected" | "no-causal-benefit-detected" | "invalid-or-incomplete" | "unsupported-measurement";

export interface PanelResult {
  verdict: PanelVerdict;
  text: string;
  supported: string[];
  negative: string[];
  unusable: string[];
}

export function panelVerdict(results: readonly CandidateResult[]): PanelResult {
  const ran = results.filter((r) => r.label !== "not-run");
  const supported = ran.filter((r) => r.label === "supported").map((r) => r.id);
  const negative = ran.filter((r) => r.label === "unsupported-within-tested-domain").map((r) => r.id);
  const unusable = ran.filter((r) => r.label === "invalid-or-incomplete" || r.label === "unsupported-measurement").map((r) => r.id);
  const notRun = results.filter((r) => r.label === "not-run").map((r) => r.id);
  const tail = `${notRun.length ? ` Not run (runtime rule): ${notRun.join(", ")}.` : ""}`;
  if (supported.length) return { verdict: "causal-benefit-detected", text: `Dependency edge supported for ${supported.join(", ")} within this domain.${unusable.length ? ` Not usable: ${unusable.join(", ")}.` : ""}${tail}`, supported, negative, unusable };
  if (ran.length > 0 && unusable.length === 0) return { verdict: "no-causal-benefit-detected", text: `No causal benefit detected for ${negative.join(", ")} within the tested panel, horizon and field.${tail}`, supported, negative, unusable };
  const anyInvalid = ran.some((r) => r.label === "invalid-or-incomplete");
  return { verdict: anyInvalid ? "invalid-or-incomplete" : "unsupported-measurement", text: `No verdict: usable negatives ${negative.length ? negative.join(", ") : "none"}; not usable ${unusable.join(", ") || "all"}.${tail}`, supported, negative, unusable };
}
