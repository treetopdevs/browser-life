// Null-model factory: calibrates the held-out endpoint gates' false-positive
// rate (docs/plan.md "Gate calibration"). Runs R replicates of each null
// generator (tools/lib/nullgen.ts) x each window length, building `Run[]` in
// memory and calling tools/analyze.ts's own `analyzeEnsemble` directly --
// the same function real simulation bundles go through, so there is no
// subprocess and no reimplemented analysis. Reports, per pre-registered
// primary endpoint and per held-out directional observable, the pass
// (false-positive) rate with a Clopper-Pearson interval. Changes no
// threshold, alpha or endpoint definition; it only measures how often the
// gates as coded today pass on data known to be bounded / non-open-ended.
//
//   deno run -A tools/nullcal.ts \
//     [--nulls longPeriodLoop,neutralDrift,saturatingProcess,randomWalkNoise] \
//     [--windows 1e5,1e6] [--replicates 32] [--seeds-per-condition 20] \
//     [--census-every 100] [--deep-every 10] [--seed 1] \
//     [--experiment nullcal] [--out runs/nullcal] [--bounded true]
//
// `--out` must not already exist -- extending a sweep means rerunning with
// more `--replicates` (deterministic), not merging separate reports.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { binomialLowerBound } from "@bl/metrics";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";
import { analyzeEnsemble, type Run } from "./analyze.ts";
import {
  boundedTreatmentVsFlat,
  buildManifest,
  makeSpec,
  NULLCAL_CONDITIONS,
  NULL_GENERATOR_IDS,
  runNullGenerator,
  type Identity,
  type NullGeneratorId,
} from "./lib/nullgen.ts";

const a = parseArgs(Deno.args, {
  string: ["nulls", "windows", "out", "experiment"],
  boolean: ["bounded"],
  default: {
    nulls: NULL_GENERATOR_IDS.join(","),
    windows: "1e5,1e6",
    replicates: 32,
    "seeds-per-condition": 20,
    "census-every": 100,
    "deep-every": 10,
    seed: 1,
    experiment: "nullcal",
    out: "runs/nullcal",
    bounded: true,
  },
});

const nulls = String(a.nulls).split(",").filter(Boolean) as NullGeneratorId[];
for (const n of nulls) if (!(NULL_GENERATOR_IDS as readonly string[]).includes(n)) throw new Error(`unknown null generator "${n}" (known: ${NULL_GENERATOR_IDS.join(", ")})`);
if (new Set(nulls).size !== nulls.length) throw new Error(`--nulls has a duplicate entry: "${a.nulls}" (a repeated null would run twice and double-count its replicates under the same tally, silently narrowing that row's confidence interval)`);
const windows = String(a.windows).split(",").filter(Boolean).map(Number);
if (windows.some((w) => !(w > 0))) throw new Error(`--windows must be positive numbers, got "${a.windows}"`);
if (new Set(windows).size !== windows.length) throw new Error(`--windows has a duplicate entry: "${a.windows}"`);
/**
 * Numerically verified safe range for `clopperPearson` below:
 * `binomialLowerBound` (packages/metrics/src/stats.ts) builds binomial
 * coefficients directly and can silently collapse to a vacuous [0,1]
 * interval well before its natural range runs out (e.g. k=1000,n=2000
 * already returns lower=0, and the first n where a mid-range k breaks is
 * n=1029). `--nulls`/`--windows` are deduplicated above, so one trial
 * contributes at most one bump per row, and every row's n here is at most
 * `replicates` -- capping it at 500 (comfortably above the registered
 * `PROBABILITY_GATE.reps=32` and this tool's own replicate counts) keeps
 * every reported interval inside the verified-stable range.
 */
const MAX_REPLICATES = 500;
const replicates = Number(a.replicates);
if (!(Number.isInteger(replicates) && replicates > 0 && replicates <= MAX_REPLICATES)) {
  throw new Error(`--replicates must be an integer in (0, ${MAX_REPLICATES}], got "${a.replicates}" (see this file's MAX_REPLICATES comment)`);
}
const seedsPerCondition = Number(a["seeds-per-condition"]);
const censusEvery = Number(a["census-every"]);
const deepEvery = Number(a["deep-every"]);
const rawSeed = Number(a.seed);
if (!Number.isFinite(rawSeed) || !Number.isInteger(rawSeed)) throw new Error(`--seed must be an integer, got "${a.seed}"`);
const masterSeed = rawSeed;
const experiment = String(a.experiment);
const outRoot = String(a.out);
const runBounded = Boolean(a.bounded);

interface RowTally {
  k: number;
  n: number;
  unavailable: number;
}
function bump(m: Map<string, RowTally>, key: string, decided: boolean | null) {
  const t = m.get(key) ?? { k: 0, n: 0, unavailable: 0 };
  if (decided === null) t.unavailable++;
  else {
    t.n++;
    if (decided) t.k++;
  }
  m.set(key, t);
}

/** Two-sided 95% Clopper-Pearson interval, built from the one-sided lower bound already in packages/metrics/src/stats.ts via P(upper | k, n) = 1 - lower(n-k, n). Callers must keep n within MAX_REPLICATES above. */
function clopperPearson(k: number, n: number, alpha = 0.05): { lower: number; upper: number } {
  if (n === 0) return { lower: NaN, upper: NaN };
  return { lower: binomialLowerBound(k, n, alpha / 2), upper: 1 - binomialLowerBound(n - k, n, alpha / 2) };
}

/** True max observable coexistence-duration span for a window at this census schedule -- a `steps`-length bundle can never demonstrate a duration >= its own last-minus-first deep step. */
function maxObservableSpan(steps: number, censusEveryV: number, deepEveryV: number): number {
  const nCensus = Math.ceil(steps / censusEveryV);
  const stepAt = (i: number) => Math.min((i + 1) * censusEveryV, steps);
  let first = -1, last = -1;
  for (let i = 0; i < nCensus; i++) {
    if (i % deepEveryV === 0) {
      if (first < 0) first = stepAt(i);
      last = stepAt(i);
    }
  }
  return first < 0 ? 0 : last - first;
}

/** Generator/analysis code identity: recorded once, at the top level of report.json, so a result can be traced back to the exact working-copy commit that produced it. `jj`'s auto-snapshot means the commit id changes with any tracked-file edit, with no commit/describe needed; falls back to "unknown" when `jj` isn't on PATH (e.g. a plain git checkout or CI without jj). */
async function codeIdentity(): Promise<{ commitId: string; ruleVersion: number; schemaVersion: number; metricsVersion: number }> {
  let commitId = "unknown";
  try {
    const cmd = new Deno.Command("jj", { args: ["log", "-r", "@", "--no-graph", "-T", "commit_id"], stdout: "piped", stderr: "null" });
    const { code, stdout } = await cmd.output();
    if (code === 0) commitId = new TextDecoder().decode(stdout).trim();
  } catch {
    // jj not on PATH, or not a jj repo.
  }
  return { commitId, ruleVersion: RULE_VERSION, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION };
}

interface TrialRow {
  nullId: string;
  windowSteps: number;
  replicateIndex: number;
  generatorParams: Record<string, unknown>;
  /** Every row key this trial contributed a decision to, and what that decision was: the aggregate tally alone can't say which replicate passed. */
  decisions: Record<string, boolean | null>;
}

/** Builds one Run in memory for (nullId, id, spec) -- the same shape tools/analyze.ts's loader produces from a real bundle on disk, without ever touching the filesystem. */
function buildRun(nullId: NullGeneratorId | "boundedTreatmentVsFlat", id: Identity, spec: ReturnType<typeof makeSpec>): Run {
  const bundle = nullId === "boundedTreatmentVsFlat" ? boundedTreatmentVsFlat(id, spec) : runNullGenerator(nullId, id, spec);
  const manifest = buildManifest(spec, nullId, id.windowSteps, id.replicateIndex, bundle.generatorParams);
  const lineages = new Map<number, [string, number][]>();
  for (const row of bundle.lineages) {
    let arr = lineages.get(row.step);
    if (!arr) lineages.set(row.step, (arr = []));
    arr.push([row.key, row.cells]);
  }
  return { condition: id.condition, seed: spec.seed, dir: `${nullId}@${id.windowSteps}#${id.replicateIndex}/${id.condition}/seed-${spec.seed}`, series: bundle.series, lineages, manifest };
}

async function runOneTrial(nullId: NullGeneratorId | "boundedTreatmentVsFlat", windowSteps: number, replicateIndex: number, tallies: Map<string, RowTally>, boundedRows: Map<string, RowTally>): Promise<TrialRow> {
  const runs: Run[] = [];
  let treatmentGeneratorParams: Record<string, unknown> = {};
  for (const conditionId of NULLCAL_CONDITIONS) {
    for (let seedIndex = 0; seedIndex < seedsPerCondition; seedIndex++) {
      const id: Identity = { masterSeed, nullId, windowSteps, replicateIndex, condition: conditionId, seedIndex };
      // A bundle's numeric seed is just its seedIndex: analyzeEnsemble only
      // needs uniqueness within this trial's own ensemble, not across
      // trials or sweeps (every random draw is keyed off the full Identity,
      // not this number).
      const spec = makeSpec(experiment, conditionId, seedIndex, windowSteps, censusEvery, deepEvery);
      const run = buildRun(nullId, id, spec);
      if (conditionId === "treatment") treatmentGeneratorParams = run.manifest.nullcal.generatorParams;
      runs.push(run);
    }
  }
  // `ignoreFrozenThreshold`: NULLCAL_PRESET ("gradient-m3") is registered in
  // ACTIVITY_THRESHOLDS with a frozen, provenance-checked value calibrated
  // from real gradient-m3 simulation bundles -- these are synthetic null-
  // generator runs with no founder provenance, reusing that preset id only
  // to pick up its PRIMARY_ENDPOINTS/held-out-control wiring.
  // Applying the frozen threshold (or its provenance check) to them would
  // either refuse outright or silently compare synthetic activity against a
  // threshold calibrated from a different, real distribution -- neither is
  // meaningful here, so every nullcal trial always uses analyzeEnsemble's
  // exploratory path: this ensemble's own neutral condition's in-sample
  // activity quantile (docs/plan.md "Gate calibration").
  const { results: endpointResults, heldOut } = await analyzeEnsemble(runs, `${nullId}@${windowSteps}#${replicateIndex}`, { ignoreFrozenThreshold: true });

  const dest = nullId === "boundedTreatmentVsFlat" ? boundedRows : tallies;
  const windowPrefix = `${nullId}@${windowSteps}`;
  const decisions: Record<string, boolean | null> = {};
  const record = (key: string, decided: boolean | null) => {
    bump(dest, key, decided);
    decisions[key] = decided;
  };

  // ---- primary endpoints: each recorded separately so a partial family doesn't silently count as a pass ----
  for (const r of endpointResults) {
    if (r.kind === "test") {
      const decided = r.complete && r.rows.every((row) => row.supported);
      record(`${windowPrefix}::${r.id}`, r.complete ? decided : null);
    } else if (r.kind === "threshold") {
      record(`${windowPrefix}::${r.id}`, r.available ? r.supported : null);
    } else if (r.kind === "coexistence") {
      // Read the endpoint's own minSteps, not a hardcoded constant, so this
      // stays correct if experiments/endpoints.ts's minSteps ever changes.
      // The real endpoint's own coexistenceQualifies accepts a duration
      // >= minSteps, so a window whose true observable span equals minSteps
      // exactly can still demonstrate a qualifying duration and must not be
      // excluded as unavailable.
      const span = maxObservableSpan(windowSteps, censusEvery, deepEvery);
      if (span < r.minSteps) {
        // This window cannot observe the endpoint's own minSteps duration -- excluded, not silently 0.
        record(`${windowPrefix}::${r.id}`, null);
      } else {
        record(`${windowPrefix}::${r.id}`, r.total > 0 ? r.supported : null);
      }
      if (r.gate) {
        if (span < r.minSteps) record(`${windowPrefix}::${r.id}.gate`, null);
        else record(`${windowPrefix}::${r.id}.gate`, r.gate.total > 0 ? r.gate.supported : null);
      }
    }
  }

  // ---- held-out: every directional observable shares one Holm family, but each row is still recorded individually ----
  for (const r of heldOut.results) {
    if (!r.directional) continue; // descriptive only, never counted
    record(`${windowPrefix}::${r.id}`, r.available ? r.supported : null);
  }
  // The summary's own three-valued outcome -- not presetDeclared -- decides
  // whether this trial's held-out result is a real pass/fail or must be
  // excluded as unavailable: a declared preset can still land on
  // "unavailable" (the shared family hasn't resolved either way yet), which
  // is not the same as a decided "no" and must not count as 0/R.
  record(`${windowPrefix}::held-out-summary`, heldOut.summary.outcome === "unavailable" ? null : heldOut.summary.outcome === "supported");

  return { nullId, windowSteps, replicateIndex, generatorParams: treatmentGeneratorParams, decisions };
}

function renderTable(tallies: Map<string, RowTally>): string {
  let md = `| null@window :: row | k/n | unavailable | 95% CI |\n|---|---|---|---|\n`;
  for (const [key, t] of [...tallies.entries()].sort()) {
    const ci = t.n > 0 ? clopperPearson(t.k, t.n) : { lower: NaN, upper: NaN };
    md += `| ${key} | ${t.k}/${t.n} | ${t.unavailable} | [${ci.lower.toFixed(4)}, ${ci.upper.toFixed(4)}] |\n`;
  }
  return md;
}

async function main() {
  try {
    await Deno.stat(outRoot);
    throw new Error(`--out ${outRoot} already exists -- nullcal refuses to write into an existing directory; rerun into a fresh --out (extending a sweep = rerun with more --replicates, which is deterministic)`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Deno.mkdir(outRoot, { recursive: true });

  const tallies = new Map<string, RowTally>();
  const boundedRows = new Map<string, RowTally>();
  const trials: TrialRow[] = [];
  const t0 = performance.now();
  const perTrialWall: number[] = [];

  for (const nullId of nulls) {
    for (const windowSteps of windows) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        const tw0 = performance.now();
        trials.push(await runOneTrial(nullId, windowSteps, replicateIndex, tallies, boundedRows));
        perTrialWall.push(performance.now() - tw0);
      }
    }
  }
  if (runBounded) {
    for (const windowSteps of windows) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        const tw0 = performance.now();
        trials.push(await runOneTrial("boundedTreatmentVsFlat", windowSteps, replicateIndex, tallies, boundedRows));
        perTrialWall.push(performance.now() - tw0);
      }
    }
  }
  const totalWallSeconds = (performance.now() - t0) / 1000;
  const meanTrialSeconds = perTrialWall.length ? perTrialWall.reduce((x, y) => x + y, 0) / perTrialWall.length / 1000 : NaN;

  const config = { nulls, windows, replicates, seedsPerCondition, censusEvery, deepEvery, masterSeed, experiment, runBounded };
  // Wall-clock timing is reported in the console and report.md (below) but
  // deliberately kept out of report.json: that file is the one compared for
  // determinism (same inputs -> byte-identical report.json), and measured
  // wall time varies run to run regardless of the data.
  const jsonOut = {
    config,
    codeIdentity: await codeIdentity(),
    tallies: Object.fromEntries([...tallies.entries()].map(([k, v]) => [k, { ...v, ci: v.n > 0 ? clopperPearson(v.k, v.n) : null }])),
    boundedTreatmentVsFlat: Object.fromEntries([...boundedRows.entries()].map(([k, v]) => [k, { ...v, ci: v.n > 0 ? clopperPearson(v.k, v.n) : null }])),
    trials,
  };
  await Deno.writeTextFile(`${outRoot}/report.json`, JSON.stringify(jsonOut, null, 2));

  let md = `# nullcal report\n\n`;
  md += `Config: ${JSON.stringify(config)}\n\n`;
  md += `Wall time: ${totalWallSeconds.toFixed(1)}s total, ${meanTrialSeconds.toFixed(2)}s/trial (${trials.length} trials).\n\n`;
  md += `## Pass rates under exchangeable null generators (${nulls.join(", ")})\n\nEvery pass here is a false positive except ecological-closure-coexistence, which these generators genuinely satisfy (see docs/plan.md).\n\n${renderTable(tallies)}\n`;
  if (runBounded) md += `\n## boundedTreatmentVsFlat (a real treatment/control difference, bounded not open-ended -- NOT a false-positive tally, see docs/plan.md)\n\n${renderTable(boundedRows)}\n`;
  await Deno.writeTextFile(`${outRoot}/report.md`, md);

  console.log(md);
  console.log(`wrote ${outRoot}/report.md and ${outRoot}/report.json`);
}

await main();
