// I06b edge decision (PLAN section 5.3): the first rung's exact integer sign tests, with 16 blocks, inoc2 in place of inoc, a viability
// requirement on the field arm (no survival-benefit claim), and adequacy per candidate from the ordinary-placement positive control.
// The first rung's decision.ts is not touched.
import type { EvidenceStatus } from "@bl/schema";
import { ALPHA, contrastResult, ratLe, ratMax, signTestP, type ContrastResult, type Rat } from "./decision.ts";
import { GATING_FE, type GatingFe } from "./protocol.ts";

export interface CandidateInputFe {
  id: string;
  /** "not-simulated": the positive control did not qualify this candidate, so no fresh block was run. */
  status: "ok" | "invalid" | "not-simulated";
  invalidReasons: string[];
  contrasts: Record<GatingFe, number[]> & { spaceP: number[]; spaceNP: number[]; inoc: number[]; inocMatched: number[]; naive: number[] };
  delta: number;
  /** Blocks in which the field arm was viable (receiver present in at least R - 1 of R replicates). */
  viableBlocks: number;
  blocks: number;
  expectedBlocks: number;
  /** Reasons when not simulated: minimum detectable dose, ceiling, floor. */
  notSimulatedReasons: string[];
}

export interface CandidateResultFe {
  id: string;
  label: EvidenceStatus;
  simulated: boolean;
  mechanism: "polymer-arrangement-attributed" | "non-polymer field pattern" | "combined conditioned field" | "n/a";
  reasons: string[];
  gating: Record<GatingFe, ContrastResult>;
  attribution: { spaceP: ContrastResult; spaceNP: ContrastResult };
  /** Reported only: the first rung's inoculum contrast and the naive contrast. */
  reported: { inoc: ContrastResult; inocMatched: ContrastResult; naive: ContrastResult };
  pCand: Rat;
  holmThreshold: Rat | null;
  holmRejected: boolean;
  viabilityPass: boolean;
}

export function decideCandidatesFe(cands: readonly CandidateInputFe[], minViable = 14): CandidateResultFe[] {
  const ran = cands.filter((c) => c.status !== "not-simulated");
  const m = ran.length;
  const alphaEach: Rat = { num: ALPHA.num, den: ALPHA.den * Math.max(1, m) };
  const results = new Map<string, CandidateResultFe>();
  const raw = (d: readonly number[], delta: number): ContrastResult => contrastResult(d, delta, { num: 0, den: 1 });
  for (const c of cands) {
    const g = Object.fromEntries(GATING_FE.map((k) => [k, raw(c.contrasts[k], c.delta)])) as Record<GatingFe, ContrastResult>;
    results.set(c.id, {
      id: c.id,
      label: "unsupported-measurement",
      simulated: c.status !== "not-simulated",
      mechanism: "n/a",
      reasons: [],
      gating: g,
      attribution: { spaceP: contrastResult(c.contrasts.spaceP, c.delta, alphaEach), spaceNP: contrastResult(c.contrasts.spaceNP, c.delta, alphaEach) },
      reported: { inoc: raw(c.contrasts.inoc, c.delta), inocMatched: raw(c.contrasts.inocMatched, c.delta), naive: raw(c.contrasts.naive, c.delta) },
      pCand: c.status === "ok" && c.blocks === c.expectedBlocks ? ratMax(GATING_FE.map((k) => g[k].p)) : { num: 1, den: 1 },
      holmThreshold: null,
      holmRejected: false,
      viabilityPass: c.viableBlocks >= minViable,
    });
  }
  const order = ran.map((c) => results.get(c.id)!).sort((a, b) => a.pCand.num * b.pCand.den - b.pCand.num * a.pCand.den || (a.id < b.id ? -1 : 1));
  let stopped = false;
  order.forEach((r, i) => {
    r.holmThreshold = { num: ALPHA.num, den: ALPHA.den * (m - i) };
    if (!stopped && ratLe(r.pCand, r.holmThreshold)) r.holmRejected = true;
    else stopped = true;
  });
  for (const c of ran) {
    const r = results.get(c.id)!;
    for (const k of GATING_FE) r.gating[k].passes = ratLe(r.gating[k].p, r.holmThreshold!) && r.gating[k].medianTimes2 >= 2 * c.delta;
  }
  for (const c of cands) {
    const r = results.get(c.id)!;
    if (c.status === "not-simulated") {
      r.label = "unsupported-measurement";
      r.reasons = c.notSimulatedReasons.length ? c.notSimulatedReasons : ["the ordinary-placement positive control did not qualify this candidate; no fresh block was simulated"];
    } else if (c.status === "invalid" || c.blocks !== c.expectedBlocks) {
      r.label = "invalid-or-incomplete";
      r.reasons = c.invalidReasons.length ? c.invalidReasons : [`${c.blocks} of ${c.expectedBlocks} blocks valid`];
    } else {
      const failed = GATING_FE.filter((k) => !r.gating[k].passes);
      const ok = r.holmRejected && failed.length === 0 && r.viabilityPass;
      r.label = ok ? "supported" : "unsupported-within-tested-domain";
      if (!ok) {
        if (failed.length) r.reasons.push(`contrast(s) not passing: ${failed.join(", ")}`);
        if (!r.holmRejected) r.reasons.push("Holm does not reject the candidate");
        if (!r.viabilityPass) r.reasons.push(`field arm viable in fewer than ${minViable} blocks`);
      } else {
        r.mechanism = r.attribution.spaceP.passes && !r.attribution.spaceNP.passes ? "polymer-arrangement-attributed" : !r.attribution.spaceP.passes && r.attribution.spaceNP.passes ? "non-polymer field pattern" : "combined conditioned field";
      }
    }
  }
  return cands.map((c) => results.get(c.id)!);
}

export type PanelVerdictFe = "causal-benefit-detected" | "no-causal-benefit-detected" | "invalid-or-incomplete" | "unsupported-measurement";
export interface PanelResultFe {
  verdict: PanelVerdictFe;
  text: string;
  supported: string[];
  negative: string[];
  unusable: string[];
}

export function panelVerdictFe(results: readonly CandidateResultFe[]): PanelResultFe {
  const supported = results.filter((r) => r.label === "supported").map((r) => r.id);
  const negative = results.filter((r) => r.label === "unsupported-within-tested-domain").map((r) => r.id);
  const unusable = results.filter((r) => r.label === "invalid-or-incomplete" || r.label === "unsupported-measurement").map((r) => r.id);
  if (supported.length) return { verdict: "causal-benefit-detected", text: `Dependency edge supported for ${supported.join(", ")} within this domain.${unusable.length ? ` Not usable: ${unusable.join(", ")}.` : ""}`, supported, negative, unusable };
  if (negative.length > 0 && unusable.length === 0) return { verdict: "no-causal-benefit-detected", text: `No causal benefit of size at least delta detected for ${negative.join(", ")} within the tested panel, horizon and field; the positive control qualified each.`, supported, negative, unusable };
  const anyInvalid = results.some((r) => r.label === "invalid-or-incomplete");
  return { verdict: anyInvalid ? "invalid-or-incomplete" : "unsupported-measurement", text: `No verdict: usable negatives ${negative.length ? negative.join(", ") : "none"}; not usable ${unusable.join(", ") || "none"}.`, supported, negative, unusable };
}

/** Exact P(Binomial(16, q) >= k) for q = qn/qd as a reduced-by-nothing rational of BigInts (tests compare it with the frozen power statement). */
export function binomialUpperTail(n: number, k: number, qn: bigint, qd: bigint): { num: bigint; den: bigint } {
  const choose = (a: number, b: number): bigint => {
    let c = 1n;
    for (let i = 1; i <= b; i++) c = (c * BigInt(a - b + i)) / BigInt(i);
    return c;
  };
  let num = 0n;
  for (let j = k; j <= n; j++) num += choose(n, j) * qn ** BigInt(j) * (qd - qn) ** BigInt(n - j);
  return { num, den: qd ** BigInt(n) };
}
export { signTestP };
