import { pondScoreTerms, worstRanks } from "@bl/schema";
import type { PondAwaitMsg } from "./protocol.ts";
import type { RankKey } from "./rank-labels.ts";

/** Each pond's value of `key` at the waiting boundary. Speed is the motility term per unit of bound mass, in cells per 1,000 steps. */
export function rankValues(a: PondAwaitMsg, key: RankKey): number[] {
  const score = a.ruleScore ?? a.score;
  if (key === "score") return score === null ? a.terms.mass : (() => { const t = pondScoreTerms(score).map((term) => a.terms[term]); return t.length === 1 ? t[0] : worstRanks(t); })();
  if (key === "speed") return a.terms.drive.map((d, p) => (a.terms.mass[p] > 0 ? ((d / a.terms.mass[p]) * 1000) / 64 : 0));
  if (key === "shell") return a.terms.mass.map((_, p) => { const c = a.shells?.[p]; return c && c.living > 0 ? c.wearing / c.living * 100 : 0; });
  return a.terms[key];
}
/** Occupied ponds from the best value of `key` down; equal values by bound mass, then by index. */
export function rankOrder(a: PondAwaitMsg, key: RankKey): number[] {
  const v = rankValues(a, key), mass = a.terms.mass;
  return mass.map((_, p) => p).filter((p) => mass[p] > 0).sort((x, y) => v[y] - v[x] || mass[y] - mass[x] || x - y);
}
