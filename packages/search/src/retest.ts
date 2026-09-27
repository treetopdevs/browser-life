// The M3 test under the probability-gate rule adopted for gates after M3
// (docs/plan.md, "Probability gates"), and the ensemble founder selection
// built on it. Shared by tools/retest.ts and the founder-set tests so that
// packages/schema/src/founders.ts can be regenerated and checked exactly.

import { digestWords, NN_BYTES } from "@bl/schema";
import { passesProbabilityGate, PROBABILITY_GATE } from "@bl/metrics";
import type { Evaluation } from "./evaluate.ts";

export type EncGenome = { mu: number; sigma: number; motGain: number; weights: number[] };

/** One retested genome; `cluster` is its M3 genetic cluster (null for reference genomes such as the generalist). */
export interface RetestRow {
  label: string;
  cluster: number | null;
  weak: boolean | null;
  prior: string | null;
  genome: EncGenome;
  eval: Evaluation;
}

/** Seeds a retest used and the seeds its source search and confirmation used, all as inclusive ranges. */
export interface RetestProvenance {
  seeds: [number, number];
  used: [number, number][];
}

/** Survival, regeneration and death without light each at a one-sided 95% lower bound above 0.8, over at least 32 replicates. */
export function passesStrictM3(e: Evaluation): boolean {
  return e.reps >= PROBABILITY_GATE.reps && [e.survived, e.regenerated, e.lightDependent].every((k) => passesProbabilityGate(k, e.reps, 0.8));
}

/**
 * Seeds used by an M3 search and its confirmation, from a confirm.json gate
 * record: search seeds, then each confirmation range. Records from before
 * confirmSeeds hold one range from confirmSeed (tools/bootstrap.ts); a
 * confirmation with no rows records the empty range [c, c - 1], which is
 * dropped. Anything else malformed is kept for checkFresh to refuse.
 */
export function usedSeeds(gate: { searchSeeds?: unknown; confirmSeeds?: unknown[]; confirmSeed?: unknown; batchSize?: unknown }, rows: number): unknown[] {
  if (gate.searchSeeds === undefined) throw new Error("confirmation record lacks searchSeeds");
  let confirm: unknown[];
  if (gate.confirmSeeds !== undefined) confirm = gate.confirmSeeds;
  else if (Number.isSafeInteger(gate.confirmSeed) && Number.isSafeInteger(gate.batchSize) && (gate.batchSize as number) > 0) {
    const c = gate.confirmSeed as number;
    confirm = [[c, c + Math.ceil(rows / (gate.batchSize as number)) - 1]];
  } else throw new Error("confirmation record lacks confirmSeeds and a usable confirmSeed/batchSize");
  const empty = (r: unknown) => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[1] === r[0] - 1;
  return [gate.searchSeeds, ...confirm.filter((r) => !empty(r))];
}

/** Throws unless the retest's seeds are disjoint from every seed its source search and confirmation used. */
export function checkFresh(p: RetestProvenance): void {
  const isRange = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[1] >= r[0];
  if (!isRange(p?.seeds)) throw new Error(`retest seeds ${JSON.stringify(p?.seeds)} are not a range`);
  if (!Array.isArray(p.used) || !p.used.length) throw new Error("retest provenance records no search or confirmation seeds");
  const [r0, r1] = p.seeds;
  for (const u of p.used) {
    if (!isRange(u)) throw new Error(`recorded seed range ${JSON.stringify(u)} is not a range`);
    if (r0 <= u[1] && r1 >= u[0]) throw new Error(`retest seeds ${r0}..${r1} overlap seeds ${u[0]}..${u[1]} already used`);
  }
}

/**
 * The ensemble founder set: per cluster, the passer with the most
 * regenerations, then most deaths without light, then most survivals, then
 * the first in retest order; clusters in ascending order.
 */
export function selectFounders(rows: RetestRow[]): RetestRow[] {
  const ids = [...new Set(rows.flatMap((r) => (r.cluster === null ? [] : [r.cluster])))].sort((x, y) => x - y);
  const out: RetestRow[] = [];
  for (const id of ids) {
    const ok = rows.filter((r) => r.cluster === id && passesStrictM3(r.eval));
    const best = ok.reduce<RetestRow | undefined>(
      (m, r) => (!m || r.eval.regenerated > m.eval.regenerated || (r.eval.regenerated === m.eval.regenerated && (r.eval.lightDependent > m.eval.lightDependent || (r.eval.lightDependent === m.eval.lightDependent && r.eval.survived > m.eval.survived))) ? r : m),
      undefined,
    );
    if (best) out.push(best);
  }
  return out;
}

/** Content identity of a founder set: any change to a genome or its order changes it. */
export function founderSetId(genomes: EncGenome[]): string {
  const words: number[] = [];
  for (const g of genomes) {
    if (g.weights.length !== NN_BYTES) throw new Error(`founder has ${g.weights.length} weights, expected ${NN_BYTES}`);
    words.push(g.mu >>> 0, g.sigma >>> 0, g.motGain >>> 0, ...g.weights.map((w) => w & 0xff));
  }
  const [a, b] = digestWords(Uint32Array.from(words));
  return `m3-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
