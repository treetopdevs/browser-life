// Behaviour atlas slice 2 (docs/behaviour-atlas-2026-11-01/PLAN-2.md): the first held-out
// capability panel, its assays, the seed scheme the comparison CLI spends, and coverage scored at a
// matched selection size.
//
// Every test reads a quantity no compared arm selects on (checked by assertSeparated): survival in
// two environments the search never saw. Assays are named by
// protocol, not by seed split: a fresh-seed run of the screening protocol is still `screen`, so a
// confirmation of a selected quantity cannot pass as a held-out test.

import { lowbias32 } from "@bl/schema";
import type { Genome } from "@bl/schema";
import { DEFAULT_EVAL, type EvalConfig, type EvalObserver, type Evaluation } from "./evaluate.ts";
import { SCREEN_ASSAY, assertSeparated, atlasGenomeKey, atlasObserver, capabilityCoverage, type ArmHistory, type ArmName, type CapabilityTest, type ScreenEvaluator } from "./atlas.ts";

export const PANEL_VERSION = "atlas-panel-v1";

/** Held-out assays: the screening protocol on fresh seeds, plus two environments the search never sees. */
export const PANEL_ASSAYS: Readonly<Record<string, (seed: number) => EvalConfig>> = {
  /** The screening protocol (DEFAULT_EVAL), on held-out seeds. Panel v1 reads none of it. */
  [SCREEN_ASSAY]: (seed) => ({ ...DEFAULT_EVAL, seed }),
  /**
   * A moving sun: the meridian crosses each tile every 1,024 steps (about three days over growth),
   * fading linearly from 240 to 20 at the antipode (lightMode "sweep", as in the sweep presets).
   */
  "sweep-light": (seed) => ({ ...DEFAULT_EVAL, seed, world: { ...DEFAULT_EVAL.world, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 1024 } }),
  /** Half the screening nutrient. */
  "lean-medium": (seed) => ({ ...DEFAULT_EVAL, seed, nutrient: DEFAULT_EVAL.nutrient / 2 }),
};

const allAlive = (e: Evaluation) => e.reps > 0 && e.survived === e.reps;

export const PANEL_V1: readonly CapabilityTest[] = [
  { id: "sweep-survival", version: PANEL_VERSION, reads: ["sweep-light:survived", "sweep-light:reps"], passes: (e) => allAlive(e["sweep-light"]) },
  { id: "lean-survival", version: PANEL_VERSION, reads: ["lean-medium:survived", "lean-medium:reps"], passes: (e) => allAlive(e["lean-medium"]) },
  // Not included: reproduction. `Evaluation.reproduction` counts tracker births, and a tracker birth
  // includes a body moving too fast to overlap its predecessor, so it would partly re-measure the
  // motion the atlas selects on (docs/plan.md also records tracker parenthood as measurement-limited).
];

/** Assays a panel needs, in a fixed order. */
export function panelAssays(panel: readonly CapabilityTest[]): string[] {
  const out = new Set<string>();
  for (const t of panel) for (const r of t.reads) out.add(r.slice(0, r.indexOf(":")));
  const ids = [...out].sort();
  for (const a of ids) if (!PANEL_ASSAYS[a]) throw new Error(`panel reads assay ${a}, which has no protocol`);
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Seeds. Screening and held-out evaluations draw from disjoint, recorded ranges.

export const ARM_INDEX: Readonly<Record<ArmName | "pool", number>> = { pool: 0, "random-viable": 1, "mass-speed": 2, physical: 3, embedding: 4 };
/** History number reserved for descriptor calibration (tools/atlas.ts calibrate); comparisons refuse it. */
export const CALIBRATION_HISTORY = 8999;
/** Held-out seeds start here; every screening seed is below it. */
export const HELD_OUT_BASE = 900_000_000;

/** Screening seed of one evaluateBatch call: history (1–8,999), arm, search batch (< 200) and chunk (< 100); arms never share a seed. */
export function screenSeed(history: number, arm: ArmName | "pool", batch: number, chunk: number): number {
  if (!(Number.isInteger(history) && history >= 1 && history < 9000)) throw new Error(`history ${history} must be an integer in [1, 8999]`);
  if (!(Number.isInteger(batch) && batch >= 0 && batch < 200)) throw new Error(`batch ${batch} must be an integer in [0, 199]`);
  if (!(Number.isInteger(chunk) && chunk >= 0 && chunk < 100)) throw new Error(`chunk ${chunk} must be an integer in [0, 99]`);
  return history * 100_000 + ARM_INDEX[arm] * 20_000 + batch * 100 + chunk;
}

/** Held-out seed of one evaluateBatch call: history, assay index in `panelAssays` order (< 10), chunk (< 10,000). */
export function heldOutSeed(history: number, assay: number, chunk: number): number {
  if (!(Number.isInteger(history) && history >= 1 && history < 9000)) throw new Error(`history ${history} must be an integer in [1, 8999]`);
  if (!(Number.isInteger(assay) && assay >= 0 && assay < 10)) throw new Error(`assay index ${assay} must be an integer in [0, 9]`);
  if (!(Number.isInteger(chunk) && chunk >= 0 && chunk < 10_000)) throw new Error(`chunk ${chunk} must be an integer in [0, 9999]`);
  return HELD_OUT_BASE + history * 100_000 + assay * 10_000 + chunk;
}

// ---------------------------------------------------------------------------------------------
// Coverage at a matched selection size.

export interface CoverageRow {
  history: number;
  arm: ArmName;
  /** Size of the arm's full frozen selection. */
  size: number;
  /** Matched size: the smallest selection among the arms that ran in this history. */
  k: number;
  /** Panel tests passed by at least one of the k matched members (the primary readout). */
  covered: number;
  /** Members of the k passing each test. */
  perTest: Record<string, number>;
  /** Members of the full selection passing each test, divided by its size. */
  fullRate: Record<string, number>;
}

/**
 * Seeded subsample of `k` keys: a Fisher–Yates shuffle of the sorted keys, then the first k. Every
 * arm in a history uses the same seed, so the draw depends only on each arm's own selection.
 */
export function subsample(keys: readonly string[], k: number, seed: number): string[] {
  const xs = [...keys].sort();
  for (let i = xs.length - 1; i > 0; i--) {
    const j = lowbias32((seed ^ Math.imul(i, 0x9e3779b1)) >>> 0) % (i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs.slice(0, k);
}

/**
 * Held-out coverage of every arm that ran, per history, at the history's matched size. The random
 * arm keeps every viable genome while the archives keep one per cell, so raw coverage would reward
 * size; the matched readout does not. Histories where some arm selected nothing are reported with
 * k = 0. Throws if the panel overlaps what a compared arm selects on.
 */
export function matchedCoverage(
  histories: readonly ArmHistory[],
  /** Held-out evaluations per history, keyed by atlasGenomeKey: each history is scored on its own seeds. */
  heldOut: ReadonlyMap<number, ReadonlyMap<string, Readonly<Record<string, Evaluation>>>>,
  panel: readonly CapabilityTest[],
  seed: number,
): CoverageRow[] {
  const ran = histories.filter((h) => h.status === "ran");
  assertSeparated(panel, [...new Set(ran.map((h) => h.arm))]);
  const rows: CoverageRow[] = [];
  for (const history of [...new Set(ran.map((h) => h.history))].sort((a, b) => a - b)) {
    const arms = ran.filter((h) => h.history === history);
    const k = Math.min(...arms.map((h) => h.selection.length));
    const held = heldOut.get(history);
    if (!held) throw new Error(`history ${history} has no held-out evaluations`);
    for (const h of arms) {
      const full = capabilityCoverage(h.selection, held, panel);
      if (full.untested.length) throw new Error(`history ${history} arm ${h.arm}: ${full.untested.length} selected genomes have no held-out evaluation`);
      const matched = capabilityCoverage(subsample(h.selection, k, (seed ^ history) >>> 0), held, panel);
      rows.push({
        history,
        arm: h.arm,
        size: h.selection.length,
        k,
        covered: matched.covered,
        perTest: matched.perTest,
        fullRate: Object.fromEntries(panel.map((t) => [t.id, h.selection.length ? full.perTest[t.id] / h.selection.length : 0])),
      });
    }
  }
  return rows;
}

/**
 * Per-arm mean matched coverage over every history, and the paired per-history difference of `arm`
 * minus `baseline`. Unconditional: a history where some arm selected nothing (k = 0) counts as zero
 * coverage for every arm and a zero difference, and is also counted in `emptyHistories`.
 */
export function summarizeCoverage(rows: readonly CoverageRow[], arm: ArmName, baseline: ArmName): {
  mean: Partial<Record<ArmName, number>>;
  paired: { histories: number; emptyHistories: number; meanDiff: number; diffs: number[] };
} {
  const mean: Partial<Record<ArmName, number>> = {};
  for (const a of new Set(rows.map((r) => r.arm))) {
    const rs = rows.filter((r) => r.arm === a);
    mean[a] = rs.reduce((s, r) => s + r.covered, 0) / rs.length;
  }
  const diffs: number[] = [];
  let empty = 0;
  for (const h of [...new Set(rows.map((r) => r.history))].sort((a, b) => a - b)) {
    const x = rows.find((r) => r.history === h && r.arm === arm), y = rows.find((r) => r.history === h && r.arm === baseline);
    if (!x || !y) continue;
    if (x.k === 0) empty++;
    diffs.push(x.covered - y.covered);
  }
  return { mean, paired: { histories: diffs.length, emptyHistories: empty, meanDiff: diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 0, diffs } };
}

// ---------------------------------------------------------------------------------------------
// Evaluation plumbing over an injected batch function (evaluateBatch on a device in tools/atlas.ts).

/** One evaluateBatch call: at most floor(side² / reps) genomes. */
export type BatchFn = (genomes: Genome[], ec: EvalConfig, observer?: EvalObserver) => Promise<Evaluation[]>;

function chunks<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Genomes per evaluateBatch call under `ec`. */
export function perBatch(ec: EvalConfig): number {
  const n = Math.floor((ec.side * ec.side) / ec.reps);
  if (!(Number.isSafeInteger(n) && n > 0)) throw new Error(`an evaluation batch of side ${ec.side} with ${ec.reps} replicates holds no genome`);
  return n;
}

/**
 * Throws before any evaluation if a comparison's schedule would leave the seed scheme: search
 * batches above 199, more than 100 evaluateBatch chunks in one search batch or in the pool, or more
 * held-out chunks than an assay's seed range holds. Checked up front so no GPU time is spent on a
 * run that would fail part way.
 */
export function checkSchedule(spec: { pool: readonly unknown[]; budget: number; batchSize: number; arms: readonly string[] }, ec: EvalConfig = DEFAULT_EVAL): void {
  const per = perBatch(ec);
  const batches = Math.ceil((spec.budget - spec.pool.length) / spec.batchSize);
  if (batches > 199) throw new Error(`budget ${spec.budget} at batch ${spec.batchSize} needs ${batches} search batches; the seed scheme holds 199`);
  if (Math.ceil(spec.batchSize / per) > 100) throw new Error(`batch ${spec.batchSize} needs more than 100 evaluateBatch chunks`);
  if (Math.ceil(spec.pool.length / per) > 100) throw new Error(`a pool of ${spec.pool.length} needs more than 100 evaluateBatch chunks`);
  const held = Math.min(...Object.values(PANEL_ASSAYS).map((a) => perBatch(a(0))));
  if (Math.ceil((spec.budget * spec.arms.length) / held) > 10_000) throw new Error(`budget ${spec.budget} could select more genomes than the held-out seed range holds`);
}

/**
 * A screening evaluator for `compareArms`: splits each request into evaluateBatch-sized chunks, runs
 * each on its own `screenSeed`, and attaches the atlas descriptors from the same run.
 */
export function screenEvaluator(batch: BatchFn, ec: EvalConfig = DEFAULT_EVAL, onCall?: (seed: number, n: number) => void): ScreenEvaluator {
  return async (genomes, ctx) => {
    const out = [];
    for (const [c, part] of chunks(genomes, perBatch(ec)).entries()) {
      const seed = screenSeed(ctx.history, ctx.arm, ctx.batch, c);
      const run = { ...ec, seed };
      const obs = atlasObserver(run, part.length);
      const evals = await batch(part, run, obs.observer);
      if (evals.length !== part.length) throw new Error(`batch returned ${evals.length} evaluations for ${part.length} genomes`);
      const ds = obs.results();
      onCall?.(seed, part.length);
      out.push(...evals.map((e, k) => ({ eval: e, descriptors: ds[k].descriptors })));
    }
    return out;
  };
}

/**
 * Held-out evaluations of every genome selected in one history, once per assay, keyed by
 * `atlasGenomeKey`. A genome selected by several arms is evaluated once, so every arm sees the
 * same held-out result for it.
 */
export async function heldOutEvaluations(
  batch: BatchFn,
  history: number,
  selected: readonly ArmHistory[],
  panel: readonly CapabilityTest[],
  onCall?: (assay: string, seed: number, n: number) => void,
): Promise<Map<string, Record<string, Evaluation>>> {
  const genomes = new Map<string, Genome>();
  for (const h of selected) if (h.history === history) for (const k of h.selection) genomes.set(k, h.genomes[k]);
  const keys = [...genomes.keys()].sort();
  for (const k of keys) if (atlasGenomeKey(genomes.get(k)!) !== k) throw new Error(`selection key ${k} does not match its genome`);
  const out = new Map<string, Record<string, Evaluation>>(keys.map((k) => [k, {}]));
  for (const [a, assay] of panelAssays(panel).entries()) {
    for (const [c, part] of chunks(keys, perBatch(PANEL_ASSAYS[assay](0))).entries()) {
      const seed = heldOutSeed(history, a, c);
      const evals = await batch(part.map((k) => genomes.get(k)!), PANEL_ASSAYS[assay](seed));
      if (evals.length !== part.length) throw new Error(`batch returned ${evals.length} evaluations for ${part.length} genomes`);
      onCall?.(assay, seed, part.length);
      part.forEach((k, j) => (out.get(k)![assay] = evals[j]));
    }
  }
  return out;
}
