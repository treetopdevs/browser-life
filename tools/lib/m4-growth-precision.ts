// Precision extension of the 2026-09-29 M4 growth calibration. Pure parts:
// manifest checks, the frozen schedule and shards, one trial through the
// unchanged production path, checkpoint validation, stable binomial bounds
// and the fixed decision. The CLI (tools/m4-growth-precision.ts) owns files.
import { analyzeGrowthRuns } from "./m4-growth-runs.ts";
import { buildManifest, makeSpec, type Identity } from "./nullgen.ts";
import { GROWTH_SCENARIOS, growthGenerator, type GrowthScenario } from "./m4-growth-generators.ts";
import type { Run } from "./bundle.ts";
import { M4_GROWTH_V1 as C } from "../../experiments/amendments/m4-growth-v1.ts";
import { M4_GROWTH_PRECISION_V1 as P } from "../../experiments/amendments/m4-growth-precision-v1.ts";

export const MANIFEST_FORMAT = "m4-growth-precision-manifest/v1";
export const REPORT_FORMAT = "m4-growth-precision-report/v1";
export const ENGINEERING_PHASE = "precision-engineering";
/** Sources the 2026-09-29 calibration bound, plus this extension's own files. Package dirs are listed by the CLI. */
export const FIXED_SOURCES = [
  "tools/lib/m4-calibration-checkpoint.ts", "tools/m4-growth-calibration.ts", "tools/lib/m4-growth-generators.ts",
  "tools/lib/m4-growth-runs.ts", "tools/lib/m4-growth.ts", "tools/lib/nullgen.ts", "tools/lib/idhash.ts",
  "tools/lib/bundle.ts", "tools/lib/threshold.ts", "experiments/amendments/m4-growth-v1.ts",
  "experiments/endpoints.ts", "deno.json", "deno.lock", "docs/m4-growth-amendment-design.md",
  "experiments/amendments/m4-growth-precision-v1.ts", "experiments/amendments/2026-10-02-m4-growth-precision.md",
  "tools/lib/m4-growth-precision.ts", "tools/m4-growth-precision.ts",
];
export const SOURCE_DIRS = ["packages/schema/src", "packages/runner/src", "packages/metrics/src"];

export interface Stratum { scenario: string; preset: string }
export interface Scheduled extends Stratum { trial: number }
export interface PrecisionManifest {
  format: string;
  contract: string;
  phase: string;
  masterSeed: number;
  trials: number;
  pairs: number;
  strata: Stratum[];
  acceptance: Record<string, unknown>;
  shards: number;
  capSecondsPerShard: number;
  forecastSecondsPerShard: number;
  parentParity: { manifestSha256: string; sources: number; identical: boolean };
  sourceHashes: Record<string, string>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The scientific manifest must equal the contract exactly; engineering runs use the consumed development master only. */
export function checkManifest(m: PrecisionManifest): void {
  if (m.format !== MANIFEST_FORMAT || m.contract !== P.id) throw new Error("not a precision-extension manifest");
  if (!same(m.strata, P.strata) || m.pairs !== P.pairs || m.pairs !== C.candidatePairs || !same(m.acceptance, P.acceptance)) {
    throw new Error("strata, pairs and acceptance must equal the frozen contract");
  }
  if (m.phase === P.phase) {
    if (m.masterSeed !== P.masterSeed || m.trials !== P.trials) throw new Error("scientific phase must use the contract master and trial count");
  } else if (m.phase === ENGINEERING_PHASE) {
    if (m.masterSeed !== P.engineeringMaster || !Number.isInteger(m.trials) || m.trials < 1 || m.trials > P.engineeringMaxTrials) {
      throw new Error("engineering phase uses the consumed development master and at most ten trials");
    }
  } else throw new Error("unknown phase");
  if (!Number.isInteger(m.shards) || m.shards < 1 || m.shards > 16) throw new Error("shards must be 1..16");
  if (!Number.isFinite(m.capSecondsPerShard) || m.capSecondsPerShard <= 0 || m.capSecondsPerShard > 28_800) throw new Error("per-shard cap must be in (0, 28800]");
  if (m.phase === P.phase && (m.parentParity?.identical !== true || m.parentParity.manifestSha256 !== P.parentValidation.manifestSha256)) {
    throw new Error("scientific phase requires byte parity with the 2026-09-29 validation sources");
  }
  if (!m.sourceHashes || FIXED_SOURCES.some((p) => typeof m.sourceHashes[p] !== "string")) throw new Error("canonical source hashes required");
}

/** Stratum-major, trial-ascending: the frozen order every shard is cut from. */
export function schedule(m: Pick<PrecisionManifest, "strata" | "trials">): Scheduled[] {
  return m.strata.flatMap((s) => Array.from({ length: m.trials }, (_, trial) => ({ scenario: s.scenario, preset: s.preset, trial })));
}

/** Contiguous block i of k over the frozen schedule; blocks partition it exactly. */
export function shardOf<T>(all: T[], shards: number, index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= shards) throw new Error("shard index out of range");
  const lo = Math.floor((index * all.length) / shards), hi = Math.floor(((index + 1) * all.length) / shards);
  return all.slice(lo, hi);
}

export const trialKey = (r: Scheduled) => `${r.scenario}:${r.preset}:${r.trial}`;
export const generatorIdentity = (phase: string, master: number, r: Scheduled) => `${phase}:${master}:${r.scenario}:${r.preset}:${r.trial}`;

/**
 * One trial exactly as tools/m4-growth-calibration.ts computes it for a growth
 * scenario: same slot seeds, identities, specs, generator and analysis call.
 * `guard` runs before each history (the CLI's elapsed-cap check).
 */
export async function runTrial(phase: string, masterSeed: number, pairs: number, r: Scheduled, guard: () => void = () => {}) {
  if (!(GROWTH_SCENARIOS as readonly string[]).includes(r.scenario)) throw new Error("precision extension covers growth scenarios only");
  const seeds = Array.from({ length: pairs }, (_, i) => 900000000 + i);
  async function* generated(): AsyncGenerator<Run> {
    for (const condition of C.conditions) for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) {
      const id: Identity = { masterSeed, nullId: `${r.scenario}:${r.preset}`, windowSteps: C.horizon, replicateIndex: r.trial, condition, seedIndex };
      const spec = { ...makeSpec(`m4-${phase}`, condition, seeds[seedIndex], C.horizon, C.censusEvery, C.deepEvery), presetId: r.preset };
      guard();
      yield growthGenerator(r.scenario as GrowthScenario, id, spec);
    }
  }
  const report = await analyzeGrowthRuns(generated(), seeds, { kind: "synthetic", generatorIdentity: generatorIdentity(phase, masterSeed, r) });
  return {
    identity: report.provenance, endpoint2: report.endpoint2, endpoint1: report.endpoint1,
    endpoint1Method: report.endpoint1Method, jointPerPresetObserved: report.jointPerPresetObserved, threshold: report.threshold.threshold,
  };
}

/** Rows must be exactly the expected prefix of this shard's block, bound to this manifest. */
// deno-lint-ignore no-explicit-any
export function validateShardRows(rows: any[], expected: Scheduled[], m: PrecisionManifest, manifestHash: string): void {
  if (rows.length > expected.length) throw new Error("checkpoint exceeds the shard's frozen block");
  rows.forEach((row, i) => {
    const e = expected[i];
    if (!row || trialKey(row) !== trialKey(e) || row.manifestHash !== manifestHash ||
      row.identity?.kind !== "synthetic" || row.identity?.generatorIdentity !== generatorIdentity(m.phase, m.masterSeed, e) ||
      row.endpoint2?.n !== m.pairs || !Number.isFinite(row.endpoint2?.mean) || typeof row.endpoint2?.supported !== "boolean" ||
      !["ok", "degenerate"].includes(row.endpoint2?.status) || row.endpoint1?.kind !== "test" ||
      !Array.isArray(row.endpoint1?.rows) || row.endpoint1.rows.length !== 2 ||
      !Number.isFinite(row.wallSeconds) || row.wallSeconds < 0) throw new Error(`invalid or non-prefix checkpoint trial ${i}`);
  });
}

/**
 * Clopper–Pearson one-sided lower bound, summed in log space so it stays
 * finite at n = 20,000 (the production binomialLowerBound forms the binomial
 * coefficient directly and overflows above roughly n = 1,000).
 */
export function stableBinomialLowerBound(k: number, n: number, alpha = 0.05): number {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 1 || k > n) throw new Error("invalid binomial counts");
  if (k === 0) return 0;
  const tail = (p: number) => { // P(X >= k | p)
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const lp = Math.log(p), lq = Math.log1p(-p);
    let logC = 0, s = 0;
    for (let i = 0; i <= n; i++) {
      if (i >= k) s += Math.exp(logC + i * lp + (n - i) * lq);
      logC += Math.log(n - i) - Math.log(i + 1);
    }
    return s;
  };
  let lo = 0, hi = 1;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (tail(mid) < alpha) lo = mid;
    else hi = mid;
  }
  return lo;
}
export const upper95 = (k: number, n: number) => 1 - stableBinomialLowerBound(n - k, n, 0.05);
export const lower95 = (k: number, n: number) => stableBinomialLowerBound(k, n, 0.05);

// deno-lint-ignore no-explicit-any
export function decide(m: PrecisionManifest, rows: any[]) {
  const results = m.strata.map((s) => {
    const mine = rows.filter((r) => r.scenario === s.scenario && r.preset === s.preset);
    const n = mine.length;
    const e1 = mine.filter((r) => r.endpoint1.complete && r.endpoint1.rows.every((x: { supported: boolean }) => x.supported)).length;
    const e2 = mine.filter((r) => r.endpoint2.supported).length;
    const unavailable = mine.filter((r) => r.endpoint2.status !== "ok").length;
    const joint = mine.filter((r) => r.jointPerPresetObserved).length;
    const complete = n === m.trials;
    const endpoint1Upper95 = n ? upper95(e1, n) : null, endpoint2Upper95 = n ? upper95(e2, n) : null;
    const max = m.acceptance.nullOneSided95UpperMax as number;
    return {
      ...s, n, complete,
      endpoint1Supported: e1, endpoint1Rate: n ? e1 / n : null, endpoint1Upper95,
      endpoint1TwoSided95: n ? [stableBinomialLowerBound(e1, n, 0.025), 1 - stableBinomialLowerBound(n - e1, n, 0.025)] : null,
      endpoint2Supported: e2, endpoint2Upper95, endpoint2Unavailable: unavailable, jointSupported: joint,
      wallSeconds: mine.reduce((a, r) => a + r.wallSeconds, 0),
      acceptancePass: complete && endpoint1Upper95 !== null && endpoint1Upper95 <= max && endpoint2Upper95 !== null && endpoint2Upper95 <= max,
    };
  });
  return {
    results,
    complete: results.every((r) => r.complete),
    precisionPass: m.phase === P.phase ? results.every((r) => r.acceptancePass) : null,
  };
}
