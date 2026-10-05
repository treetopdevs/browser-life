// Calibrates the pre-registered activity threshold (endpoint 1,
// experiments/endpoints.ts's ACTIVITY_THRESHOLDS) from a dedicated,
// neutral-only pilot -- NOT from any registered ensemble's own neutral runs
// (see tools/analyze.ts, which now only reports that in-sample figure as a
// diagnostic). Decided (user, 2026-09-27): freezing from a separate pilot
// means the threshold used for inference never depends on which neutral
// seeds happen to land in the ensemble being tested.
//
//   deno run -A tools/calibrate.ts runs/calib-neutral [--presets gradient-m3,spots-m3]
//     [--q 0.95] [--draws 2000] [--alpha 0.10] [--seed 1] [--out runs/calib-neutral/calibration.json]
//   deno run -A tools/calibrate.ts runs/calib-ext --registry extension   (the registered 10^7 extension's pilot)
//
// Expects `<pilotRoot>/<presetId>/neutral/seed-<n>/` bundles (tools/run.ts's
// own layout: `<out>/<experiment>/<presetId>/<condition>/seed-<n>/`, so
// `pilotRoot` is `<out>/<experiment>`). Per preset:
//   1. Loads every seed-N bundle under `<pilotRoot>/<presetId>` (tools/lib/bundle.ts's
//      prepareCohort -- an in-progress run, still missing manifest.summary,
//      is silently skipped, never read as if it were finished data), keeps
//      only the `neutral` condition, and applies the SAME eligibility check
//      tools/analyze.ts applies to an ensemble (tools/lib/bundle.ts's
//      ensembleProblems/metapopulationRingProblems/partitionByConservation)
//      -- so the pilot this tool reduces and the ensembles that will later
//      use its frozen value are held to byte-identical standards.
//   2. FREEZEABILITY (Astra review, 2026-09-27, P1): a value is only ever
//      printed as an "ok", paste-in-ready entry when the eligible cohort
//      EXACTLY matches what experiments/endpoints.ts declares for this
//      preset -- same experiment/presetId on every manifest, exactly the
//      declared seed set (no missing, duplicate or extra seeds), every
//      declared seed present AND passing conservation, and the same
//      schedule/quantile (tools/lib/calibration-decision.ts's pure
//      `evaluateFreezeability`, unit-tested directly). Otherwise this
//      prints clearly labelled PROVISIONAL diagnostics -- informative (e.g.
//      "17/20 seeds done so far"), but never a status this tool calls "ok",
//      and the process exits non-zero.
//   3. Pools eligible runs' lineage activities (tools/lib/bundle.ts's
//      `(await activities(r)).tracker.allActivities()`, runs sorted by seed first so
//      the bootstrap below doesn't depend on filesystem iteration order)
//      and computes the q=0.95 quantile (@bl/metrics's `quantile`) -- the
//      same function tools/analyze.ts uses for its in-sample diagnostic. A
//      pooled distribution that comes out empty, or a quantile that isn't
//      finite and positive, is reported unavailable rather than as a
//      spurious "value: Infinity" success.
//   4. Stability diagnostics (@bl/metrics/calibration.ts, all pure/tested):
//      a seeded bootstrap interval (resampling runs, not individual
//      activities, with replacement), split-half agreement (odd vs even
//      seeds) and the spread of each run's own quantile.
//   5. Prints a report, writes `calibration.json` next to the pilot (or
//      `--out`) -- including the exact bootstrap seed, draw count, alpha and
//      eligible seed list, so the report is exactly reproducible -- and,
//      only when freezeable, the exact object literal (now also carrying
//      ruleVersion/schemaVersion/metricsVersion and this preset's current
//      `presetIdentity`) to paste into experiments/endpoints.ts's
//      ACTIVITY_THRESHOLDS[presetId].
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  bootstrapQuantileInterval,
  mulberry32,
  perRunQuantileSpread,
  quantile,
  splitHalfQuantile,
} from "@bl/metrics";
import { canonicalConfig, distributionIdentity, type WorldConfig } from "@bl/schema";
import { prepareCohort, RunReplayError, type PreparedCalibrationCohort } from "./lib/bundle.ts";
import { evaluateFreezeability, type CohortRunInfo } from "./lib/calibration-decision.ts";
import { ACTIVITY_THRESHOLDS as FROZEN_THRESHOLDS } from "../experiments/endpoints.ts";
import { EXTENSION_ACTIVITY_THRESHOLDS } from "../experiments/extension.ts";

const a = parseArgs(Deno.args, {
  string: ["presets", "q", "draws", "alpha", "seed", "out", "registry"],
  default: { q: "0.95", draws: "2000", alpha: "0.10", seed: "1" },
});
// --registry extension: the registered 10^7 extension's own pilot (experiments/extension.ts), declared
// separately so calibrating it can never touch the primary analysis's frozen values.
if (a.registry !== undefined && a.registry !== "extension") throw new Error(`--registry must be "extension"; got ${a.registry}`);
const ACTIVITY_THRESHOLDS = a.registry === "extension" ? EXTENSION_ACTIVITY_THRESHOLDS : FROZEN_THRESHOLDS;
const registryFile = a.registry === "extension" ? "experiments/extension.ts's EXTENSION_ACTIVITY_THRESHOLDS" : "experiments/endpoints.ts's ACTIVITY_THRESHOLDS";
const pilotRoot = String(a._[0] ?? "");
if (!pilotRoot) throw new Error("usage: calibrate.ts <pilotRoot> [--presets gradient-m3,spots-m3] [--q 0.95] [--draws 2000] [--alpha 0.10] [--seed 1] [--out path]");
const presets = (a.presets ? a.presets.split(",") : Object.keys(ACTIVITY_THRESHOLDS)).filter(Boolean);
if (!presets.length) throw new Error("no presets to calibrate (pass --presets, or register some in experiments/endpoints.ts's ACTIVITY_THRESHOLDS)");

// ---- option validation (Astra review, P2): refuse before touching the filesystem ----
const q = Number(a.q);
if (!(Number.isFinite(q) && q > 0 && q < 1)) throw new Error(`--q must be a number in (0, 1); got ${a.q}`);
const draws = Number(a.draws);
if (!(Number.isInteger(draws) && draws > 0)) throw new Error(`--draws must be a positive integer; got ${a.draws}`);
const alpha = Number(a.alpha);
if (!(Number.isFinite(alpha) && alpha > 0 && alpha < 1)) throw new Error(`--alpha must be a number in (0, 1); got ${a.alpha}`);
const bootstrapSeed = Number(a.seed);
if (!Number.isSafeInteger(bootstrapSeed)) throw new Error(`--seed must be a safe integer; got ${a.seed}`);
const outPath = a.out ?? `${pilotRoot}/calibration.json`;

interface PresetCalibration {
  presetId: string;
  status: "ok" | "provisional" | "unavailable";
  reason?: string;
  /** Why this preset isn't freezeable yet (empty/absent when status is "ok"). */
  freezeabilityReasons?: string[];
  eligibleRuns?: number;
  excludedRuns?: number;
  /** Every eligible seed, sorted -- the exact cohort the reported numbers were computed from. */
  eligibleSeeds?: number[];
  seeds?: [number, number];
  schedule?: { steps: number; censusEvery: number; deepEvery: number };
  quantile?: number;
  value?: number;
  bootstrap?: { draws: number; alpha: number; seed: number; lower: number; upper: number };
  splitHalf?: { odd: { n: number; value: number }; even: { n: number; value: number } };
  perRunSpread?: { mean: number; sd: number; min: number; max: number };
  identity?: { ruleVersion: number; schemaVersion: number; metricsVersion: number; presetIdentity: string; calibrationDistributionIdentity: string };
  declaredPilot?: (typeof ACTIVITY_THRESHOLDS)[string]["pilot"];
  note?: string;
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : "—";
}

const results: PresetCalibration[] = [];

for (const presetId of presets) {
  console.log(`\n== ${presetId} ==`);
  const presetRoot = `${pilotRoot}/${presetId}`;
  let cohort: PreparedCalibrationCohort;
  try {
    cohort = await prepareCohort(presetRoot, { kind: "calibration", presetId });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log(`  unavailable: no directory at ${presetRoot}`);
      results.push({ presetId, status: "unavailable", reason: `no directory at ${presetRoot}` });
      continue;
    }
    if (e instanceof RunReplayError) {
      console.log(`  unavailable: ${e.message}`);
      results.push({ presetId, status: "unavailable", reason: e.message });
      continue;
    }
    throw e;
  }
  const other = cohort.ignored;
  if (other.length) console.log(`  note: ignoring ${other.length} non-neutral run(s) under ${presetRoot} (${[...new Set(other.map((r) => r.condition))].join(", ")}) -- this pilot calibrates from neutral runs only`);
  if (!cohort.ok) {
    const issue = cohort.issue;
    let reason: string;
    switch (issue.kind) {
      case "empty": reason = "no completed neutral runs"; break;
      case "ensemble": reason = `not one eligible ensemble: ${issue.problems.join("; ")}`; break;
      case "ring": reason = "includes a metapopulation ring"; break;
      case "provenance": reason = `provenance check failed: ${issue.problems.join("; ")}`; break;
      case "conservation": reason = "no run passed the conservation check"; break;
      case "insufficient": reason = `only ${issue.count} eligible neutral run(s)`; break;
    }
    if (issue.kind === "insufficient" && cohort.invalid.length)
      console.log(`  excluded (conservation failed): ${cohort.invalid.map((r) => `seed-${r.seed}`).join(", ")}`);
    console.log(`  unavailable: ${reason}`);
    results.push({ presetId, status: "unavailable", reason });
    continue;
  }
  const { selected: neutral, runs: eligible, invalid, neutralActivities: runActivities } = cohort;
  if (invalid.length) console.log(`  excluded (conservation failed): ${invalid.map((r) => `seed-${r.seed}`).join(", ")}`);

  const pooled = runActivities.flatMap((r) => r.activities);
  const value = quantile(pooled, q);
  // Empty/invalid distribution (Astra review, P2): quantile([]) is Infinity
  // by convention (an uncalibrated sentinel elsewhere in this codebase), not
  // a real value -- never printed as a success. Extinct runs are NOT
  // excluded here: an extinct run still counts as a run and its lineages'
  // final activities are still pooled (ActivityTracker.allActivities()
  // already folds extinct components in) -- this guard is about the pooled
  // distribution being empty (e.g. no lineage ever recorded at all), not
  // about extinction.
  if (pooled.length === 0 || !(Number.isFinite(value) && value > 0)) {
    console.log(`  unavailable: pooled activity distribution is ${pooled.length === 0 ? "empty" : `invalid (q=${q} quantile is ${value})`}`);
    results.push({ presetId, status: "unavailable", reason: pooled.length === 0 ? "pooled activity distribution is empty" : `q=${q} quantile of the pooled distribution is not finite and positive (${value})` });
    continue;
  }
  // Distribution agreement, modulo seed (Astra review, item 2): every
  // eligible run's own recorded cfg -- not a value recomputed from current
  // code -- must canonicalize identically once `seed` is removed. Provenance
  // already confirmed every run's manifest.presetIdentity matches current
  // code's for this preset; ensembleProblems already confirmed every run's
  // cfg matches what current code's specConfig produces for that run's own
  // spec (which varies only by seed here), so this is expected to always
  // hold -- checked explicitly anyway rather than assumed transitively, since
  // it is exactly the property "all pilot runs must agree, modulo seed"
  // that calibrationDistributionIdentity below depends on.
  const stripSeed = (cfg: Record<string, unknown>): WorldConfig => {
    const { seed: _seed, ...rest } = cfg;
    return rest as unknown as WorldConfig;
  };
  const canonicalCfgs = eligible.map((r) => canonicalConfig(stripSeed(r.manifest.cfg)));
  const cfgMismatch = canonicalCfgs.some((c) => c !== canonicalCfgs[0]);
  if (cfgMismatch) {
    console.log(`  unavailable: eligible runs' configs disagree beyond seed -- not one calibration distribution`);
    results.push({ presetId, status: "unavailable", reason: "eligible runs' configs disagree beyond seed" });
    continue;
  }

  const bootstrap = bootstrapQuantileInterval(runActivities, q, { draws, alpha, rng: mulberry32(bootstrapSeed) });
  const splitHalf = splitHalfQuantile(runActivities, q);
  const spread = perRunQuantileSpread(runActivities, q);
  const ref = eligible[0].manifest.spec;
  const seeds = eligible.map((r) => r.seed);
  const seedRange: [number, number] = [Math.min(...seeds), Math.max(...seeds)];
  const schedule = { steps: ref.steps, censusEvery: ref.censusEvery, deepEvery: ref.deepEvery };
  // Derived from the verified pilot manifests themselves (Astra review,
  // items 1-2), not recomputed from current code alone: provenanceProblems
  // already confirmed every eligible run's manifest.presetIdentity matches
  // current code's presetIdentity(preset) for this preset, and the
  // agreement check just above confirmed every eligible run's own cfg
  // (modulo seed) is identical -- so `eligible[0]`'s own recorded values
  // speak for the whole cohort.
  const verifiedPresetIdentity = eligible[0].manifest.presetIdentity as string;
  const identity = {
    ruleVersion: eligible[0].manifest.ruleVersion as number,
    schemaVersion: eligible[0].manifest.schemaVersion as number,
    metricsVersion: eligible[0].manifest.metricsVersion as number,
    presetIdentity: verifiedPresetIdentity,
    calibrationDistributionIdentity: distributionIdentity(verifiedPresetIdentity, "neutral", stripSeed(eligible[0].manifest.cfg)),
  };

  console.log(`  eligible neutral runs: ${eligible.length} (seeds ${seedRange[0]}–${seedRange[1]}), pooled activities: ${pooled.length}`);
  console.log(`  schedule: steps=${schedule.steps} censusEvery=${schedule.censusEvery} deepEvery=${schedule.deepEvery}`);
  console.log(`  rule/schema/metrics versions: ${identity.ruleVersion}/${identity.schemaVersion}/${identity.metricsVersion}; presetIdentity: ${identity.presetIdentity}; calibrationDistributionIdentity: ${identity.calibrationDistributionIdentity}`);
  console.log(`  q=${q} pooled quantile: ${fmt(value)}`);
  console.log(`  bootstrap (${draws} draws, seed ${bootstrapSeed}, resampling runs): ${(100 * (1 - alpha)).toFixed(0)}% interval [${fmt(bootstrap.lower)}, ${fmt(bootstrap.upper)}]`);
  console.log(`  split-half: odd seeds (n=${splitHalf.odd.n}) = ${fmt(splitHalf.odd.value)}; even seeds (n=${splitHalf.even.n}) = ${fmt(splitHalf.even.value)}`);
  console.log(`  per-run q=${q} spread: mean=${fmt(spread.mean)} sd=${fmt(spread.sd)} min=${fmt(spread.min)} max=${fmt(spread.max)}`);

  const declared = ACTIVITY_THRESHOLDS[presetId];
  const freezeabilityCohort: CohortRunInfo[] = neutral.map((r) => ({
    seed: r.seed,
    experiment: r.manifest.spec.experiment,
    presetId: r.manifest.spec.presetId,
    conservationOk: r.manifest.summary.conservationOk,
  }));
  const freezeability = declared
    ? evaluateFreezeability(
        freezeabilityCohort,
        {
          declaredExperiment: declared.pilot.experiment,
          declaredPresetId: presetId,
          declaredSeeds: declared.pilot.seeds,
          declaredRuns: declared.pilot.runs,
          declaredSchedule: { steps: declared.pilot.steps, censusEvery: declared.pilot.censusEvery, deepEvery: declared.pilot.deepEvery },
          declaredQuantile: declared.quantile,
        },
        schedule,
        q,
      )
    : { freezeable: false as const, reasons: [`preset "${presetId}" is not registered in ${registryFile}`] };

  const status: PresetCalibration["status"] = freezeability.freezeable ? "ok" : "provisional";
  if (!freezeability.freezeable) {
    console.log(`  PROVISIONAL -- not freezeable yet:`);
    for (const reason of freezeability.reasons) console.log(`    - ${reason}`);
  }

  const entryText =
    `  {\n` +
    `    value: ${value},\n` +
    `    quantile: ${q},\n` +
    `    pilot: {\n` +
    `      experiment: "${ref.experiment}", seeds: [${seedRange[0]}, ${seedRange[1]}], runs: ${eligible.length},\n` +
    `      steps: ${schedule.steps}, censusEvery: ${schedule.censusEvery}, deepEvery: ${schedule.deepEvery},\n` +
    `      ruleVersion: ${identity.ruleVersion}, schemaVersion: ${identity.schemaVersion}, metricsVersion: ${identity.metricsVersion},\n` +
    `      presetIdentity: "${identity.presetIdentity}",\n` +
    `      calibrationDistributionIdentity: "${identity.calibrationDistributionIdentity}",\n` +
    `    },\n` +
    `  },`;

  if (status === "ok") {
    console.log(`\n  paste into ${registryFile}["${presetId}"]:`);
    console.log(entryText);
  } else {
    console.log(`\n  PROVISIONAL entry (do NOT paste into ${registryFile} yet -- not freezeable, see reasons above):`);
    console.log(entryText);
  }

  results.push({
    presetId,
    status,
    freezeabilityReasons: freezeability.freezeable ? undefined : freezeability.reasons,
    eligibleRuns: eligible.length,
    excludedRuns: invalid.length,
    eligibleSeeds: seeds,
    seeds: seedRange,
    schedule,
    quantile: q,
    value,
    bootstrap: { draws: bootstrap.draws, alpha: bootstrap.alpha, seed: bootstrapSeed, lower: bootstrap.lower, upper: bootstrap.upper },
    splitHalf: { odd: { n: splitHalf.odd.n, value: splitHalf.odd.value }, even: { n: splitHalf.even.n, value: splitHalf.even.value } },
    perRunSpread: { mean: spread.mean, sd: spread.sd, min: spread.min, max: spread.max },
    identity,
    declaredPilot: declared?.pilot,
  });
}

await Deno.writeTextFile(outPath, JSON.stringify({ generated: new Date().toISOString(), pilotRoot, presets: results }, null, 2));
console.log(`\nwrote ${outPath}`);
if (results.some((r) => r.status !== "ok")) Deno.exit(1);
