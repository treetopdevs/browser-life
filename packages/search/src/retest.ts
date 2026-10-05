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
  /** How the retest chose its items from the confirmation (absent in records from before it was written down: per-strong 4, row order). */
  selection?: RetestSelection;
}

/** Which members of a strong cluster the retest takes: "row-order" is confirm.json order (the historical rule), "seeded" a seeded shuffle. */
export type RetestRank = "row-order" | "seeded";
export interface RetestSelection {
  perStrong: number;
  rank: RetestRank;
  /** The shuffle seed (the cluster id is added per cluster); null for "row-order". */
  seed: number | null;
  /** The confirmation file the items came from. */
  confirm: string;
}

/** Deterministic PRNG (mulberry32), inlined so a recorded shuffle seed keeps its meaning; same as tools/lib/recurrence.ts `rng`. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic permutation of 0..n-1 (Fisher-Yates over mulberry32(seed)). */
export function shuffledOrder(n: number, seed: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`shuffledOrder: n must be a nonnegative integer, got ${n}`);
  if (!Number.isSafeInteger(seed)) throw new Error(`shuffledOrder: seed must be an integer, got ${seed}`);
  const r = mulberry32(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The retest's items: the generalist reference, then per cluster (in first-seen order) either every member
 * (a weak cluster: no member with a 16-replicate regeneration lower bound above 0.8) or the first `perStrong`
 * strong members, "first" meaning confirm.json row order ("row-order", the historical rule) or a seeded
 * shuffle of that cluster's strong members ("seeded"; seed + cluster id).
 */
export function selectRetestItems(
  rows: { pass: boolean; cluster: number; regenLowerBound: number; eval: Evaluation; genome: EncGenome }[],
  sel: RetestSelection,
  generalist: EncGenome,
): Omit<RetestRow, "eval">[] {
  if (!Number.isSafeInteger(sel.perStrong) || sel.perStrong < 0) throw new Error(`perStrong must be a nonnegative integer, got ${sel.perStrong}`);
  if (sel.rank !== "row-order" && sel.rank !== "seeded") throw new Error(`rank must be "row-order" or "seeded", got ${JSON.stringify(sel.rank)}`);
  if (sel.rank === "seeded" && !Number.isSafeInteger(sel.seed)) throw new Error("rank \"seeded\" needs an integer seed");
  const by = new Map<number, typeof rows>();
  for (const r of rows.filter((r) => r.pass)) by.set(r.cluster, [...(by.get(r.cluster) ?? []), r]);
  const items: Omit<RetestRow, "eval">[] = [{ label: "generalistGenome(60,20)", cluster: null, weak: null, prior: null, genome: generalist }];
  for (const [id, rs] of by) {
    const weak = !rs.some((r) => r.regenLowerBound > 0.8);
    const strong = rs.filter((r) => r.regenLowerBound > 0.8);
    const chosen = weak ? rs : (sel.rank === "seeded" ? shuffledOrder(strong.length, sel.seed! + id).map((i) => strong[i]) : strong).slice(0, sel.perStrong);
    chosen.forEach((r, i) => items.push({ label: `c${id}.${i}`, cluster: id, weak, prior: `${r.eval.regenerated}/${r.eval.reps}`, genome: r.genome }));
  }
  return items;
}

/** Survival, regeneration and death without light each at a one-sided 95% lower bound above 0.8, over at least 32 replicates. */
export function passesStrictM3(e: Evaluation): boolean {
  return e.reps >= PROBABILITY_GATE.reps && [e.survived, e.regenerated, e.lightDependent].every((k) => passesProbabilityGate(k, e.reps, 0.8));
}

/**
 * Seeds used by an M3 search and its confirmation, from a confirm.json gate
 * record: search seeds, then each confirmation range, then each dependence
 * re-screen range (`dependenceSeeds`, recorded by tools/bootstrap.ts from the
 * time it wrote them down; absent in older records). Records from before
 * confirmSeeds hold one range from confirmSeed (tools/bootstrap.ts); a
 * confirmation with no rows records the empty range [c, c - 1], which is
 * dropped. Anything else malformed is kept for checkFresh to refuse.
 */
export function usedSeeds(gate: { searchSeeds?: unknown; confirmSeeds?: unknown[]; confirmSeed?: unknown; batchSize?: unknown; dependenceSeeds?: unknown[] }, rows: number): unknown[] {
  if (gate.searchSeeds === undefined) throw new Error("confirmation record lacks searchSeeds");
  let confirm: unknown[];
  if (gate.confirmSeeds !== undefined) confirm = gate.confirmSeeds;
  else if (Number.isSafeInteger(gate.confirmSeed) && Number.isSafeInteger(gate.batchSize) && (gate.batchSize as number) > 0) {
    const c = gate.confirmSeed as number;
    confirm = [[c, c + Math.ceil(rows / (gate.batchSize as number)) - 1]];
  } else throw new Error("confirmation record lacks confirmSeeds and a usable confirmSeed/batchSize");
  if (gate.dependenceSeeds !== undefined && !Array.isArray(gate.dependenceSeeds)) throw new Error("confirmation record's dependenceSeeds is not a list of ranges");
  const empty = (r: unknown) => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[1] === r[0] - 1;
  return [gate.searchSeeds, ...confirm.filter((r) => !empty(r)), ...(gate.dependenceSeeds ?? []).filter((r) => !empty(r))];
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

/** One founder candidate retested again on fresh seeds (tools/retest.ts --replicate). */
export interface ReplicateRow {
  label: string;
  cluster: number;
  genome: EncGenome;
  eval: Evaluation;
}

/** Counts of two independent evaluations of one genome, added (only the counts the strict test reads). */
export function poolCounts(a: Evaluation, b: Evaluation): Evaluation {
  return { ...a, survived: a.survived + b.survived, regenerated: a.regenerated + b.regenerated, lightDependent: a.lightDependent + b.lightDependent, reps: a.reps + b.reps };
}

/**
 * The founders that hold up on replication: each selected genome's retest
 * pooled with its independent replication must still pass the strict test.
 * A selected genome without a replication row is an error, not a pass.
 */
export function replicatedFounders(selected: RetestRow[], replication: ReplicateRow[]): { row: RetestRow; replication: ReplicateRow; pooled: Evaluation }[] {
  const key = (g: EncGenome) => JSON.stringify([g.mu, g.sigma, g.motGain, g.weights]);
  const by = new Map(replication.map((r) => [key(r.genome), r]));
  return selected.flatMap((row) => {
    const rep = by.get(key(row.genome));
    if (!rep) throw new Error(`founder candidate ${row.label} (cluster ${row.cluster}) has no replication`);
    const pooled = poolCounts(row.eval, rep.eval);
    return passesStrictM3(pooled) ? [{ row, replication: rep, pooled }] : [];
  });
}
