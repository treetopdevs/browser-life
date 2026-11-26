// Whole-family splits and the leak checks (PLAN.md, section 7). A family is one source history with all its windows and seed
// variants; a split never cuts through one. Ranking is by SHA-256 of salt + family id, so the assignment is deterministic and
// independent of input order. A reserved `qualify` subset of dev is used for all qualification and tuning.
import { sha256Text } from "../propose.ts";
import type { PredictionEnvelope } from "./envelope.ts";

export type Split = "dev" | "test";

const rank = (salt: string, id: string): string => sha256Text(`${salt}|${id}`);

export interface SplitPlan {
  dev: string[];
  test: string[];
  qualify: string[];
}

/** First `nDev` families by hash rank are dev (the first `nQualify` of those are qualify), the rest test. Lists are in rank order. */
export function assignSplits(familyIds: readonly string[], salt: string, nDev: number, nQualify: number): SplitPlan {
  const uniq = [...new Set(familyIds)];
  if (uniq.length !== familyIds.length) throw new Error("duplicate family ids");
  if (nQualify > nDev || nDev >= uniq.length) throw new Error("need 0 <= nQualify <= nDev < number of families");
  const ranked = uniq.map((id) => ({ id, h: rank(salt, id) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.id);
  return { dev: ranked.slice(0, nDev), test: ranked.slice(nDev), qualify: ranked.slice(0, nQualify) };
}

/**
 * Donor assignment for the shuffled-evidence control: a derangement of the families within one split (a cyclic shift of the hash
 * ranking, so no family is its own donor and none crosses a split), frozen into the protocol before any scoring.
 */
export function derangement(familyIds: readonly string[], salt: string): Record<string, string> {
  if (familyIds.length < 2) throw new Error("a derangement needs at least two families");
  const ranked = familyIds.map((id) => ({ id, h: rank(`${salt}|donor`, id) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.id);
  const out: Record<string, string> = {};
  ranked.forEach((id, i) => (out[id] = ranked[(i + 1) % ranked.length]));
  return out;
}

export function donorsFor(plan: SplitPlan, salt: string): Record<string, string> {
  return { ...derangement(plan.dev, salt), ...derangement(plan.test, salt) };
}

export interface DonorCheck {
  ok: boolean;
  reason?: string;
}
/** A donor envelope is acceptable only from a different family and history, in the same split. */
export function donorAllowed(env: Pick<PredictionEnvelope, "familyId" | "historyId">, donor: Pick<PredictionEnvelope, "familyId" | "historyId">, splitOf: (familyId: string) => Split | undefined): DonorCheck {
  if (donor.familyId === env.familyId) return { ok: false, reason: "donor is from the same family" };
  if (donor.historyId === env.historyId) return { ok: false, reason: "donor is another window of the same history" };
  const a = splitOf(env.familyId), b = splitOf(donor.familyId);
  if (a === undefined || b === undefined || a !== b) return { ok: false, reason: "donor is from another split" };
  return { ok: true };
}

/** Returns the problems found (empty when clean): overlapping families, a family in two splits, bad donors, test envelopes sharing a census with a dev one. */
export function assertNoLeak(plan: SplitPlan, donors: Record<string, string>, envelopes: readonly PredictionEnvelope[]): string[] {
  const errs: string[] = [];
  const dev = new Set(plan.dev), test = new Set(plan.test);
  for (const f of dev) if (test.has(f)) errs.push(`family ${f} is in both dev and test`);
  for (const f of plan.qualify) if (!dev.has(f)) errs.push(`qualify family ${f} is not in dev`);
  const splitOf = (f: string): Split | undefined => (dev.has(f) ? "dev" : test.has(f) ? "test" : undefined);
  for (const [f, d] of Object.entries(donors)) {
    if (f === d) errs.push(`family ${f} is its own donor`);
    else if (splitOf(f) !== splitOf(d)) errs.push(`donor ${d} of ${f} is in another split`);
  }
  for (const f of [...dev, ...test]) if (donors[f] === undefined) errs.push(`family ${f} has no donor`);
  const hist = new Map<string, string>();
  for (const e of envelopes) {
    if (splitOf(e.familyId) === undefined) errs.push(`envelope ${e.caseId} belongs to no split`);
    const prev = hist.get(e.historyId);
    if (prev !== undefined && prev !== e.familyId) errs.push(`history ${e.historyId} appears under two families`);
    hist.set(e.historyId, e.familyId);
  }
  const devCensus = new Set<string>();
  for (const e of envelopes) if (dev.has(e.familyId)) devCensus.add(JSON.stringify(e.census));
  for (const e of envelopes) if (test.has(e.familyId) && devCensus.has(JSON.stringify(e.census))) errs.push(`test envelope ${e.caseId} carries a dev census`);
  return errs;
}
