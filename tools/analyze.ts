// Ensemble analysis over run bundles written by tools/run.ts.
//
//   deno run -A tools/analyze.ts runs/<experiment>/<preset> [--out report]
//
// 1. Activity threshold (Bedau & Packard): for a preset registered in
//    experiments/endpoints.ts's ACTIVITY_THRESHOLDS (gradient-m3, spots-m3),
//    the value FROZEN by a separate neutral-only calibration pilot
//    (tools/calibrate.ts) -- independent of this ensemble's own neutral
//    seeds. Otherwise (an unregistered preset), the 95th percentile of this
//    ensemble's own neutral-run lineage activity, as before (labelled
//    exploratory). Either way, the in-sample neutral 95th percentile is also
//    always reported as a labelled diagnostic when neutral runs exist.
//    Components above the threshold in use count as adaptively significant.
// 2. Per run: activity statistics recomputed with that threshold, time-averaged
//    ecology and held-out complexity observables, and a growth-vs-saturation
//    test on cumulative new activity.
// 3. Pre-registered primary endpoints, executed from the typed spec in
//    experiments/endpoints.ts (also the source of experiments/preregistration.md's
//    generated "## Primary endpoints" section, via tools/gen-prereg.ts): one-sided
//    Mann–Whitney tests with Holm correction, growth verdict counts, ecological
//    closure (biotic recycling and role-coexistence duration).
// 4. Held-out observables (experiments/endpoints.ts: HELD_OUT_SPECS,
//    2026-09-26 amendment): also confirmatory, not exploratory -- an
//    absolute one-sample test (treatment's own trend > 0) plus a relative
//    one (treatment > every preset-declared control), Holm-corrected as one
//    shared family across the four directional observables. Pattern entropy
//    and lineage-map compression ratio are reported descriptively only.
// 5. Exploratory: two-sided comparison of every statistic with the treatment
//    -- the only section of this report that is not part of the
//    pre-registered inference.
//
// Runs are pooled only if they form one ensemble: same rules, preset, horizon
// and observation schedule, with configurations differing from the treatment
// exactly by their condition.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { EXACT_MAX, growthVsSaturation, mannWhitney, mean, quantile, scheduledTrend, sd } from "@bl/metrics";
import { distributionIdentity, PRESETS, presetIdentity, type WorldConfig } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import {
  activities,
  prepareCohort,
  type Run,
} from "./lib/bundle.ts";
import { decideActivityThreshold } from "./lib/threshold.ts";
import {
  ACTIVITY_THRESHOLDS,
  evaluateEndpoint,
  evaluateHeldOut,
  HELD_OUT_SPECS,
  PRIMARY_ENDPOINTS,
  type EndpointResult,
  type HeldOutObservableResult,
  type RunView,
} from "../experiments/endpoints.ts";

const a = parseArgs(Deno.args, { string: ["out", "q"], default: { q: "0.95" } });
const root = String(a._[0] ?? "");
if (!root) throw new Error("usage: analyze.ts runs/<experiment>/<preset>");
const outDir = a.out ?? `${root}/report`;

// The bundle module owns selection, eligibility and neutral replay ordering.
const cohort = await prepareCohort(root, { kind: "analysis", registeredPresets: Object.keys(ACTIVITY_THRESHOLDS) });
if (!cohort.ok) {
  const issue = cohort.issue;
  switch (issue.kind) {
    case "empty": throw new Error(`no completed runs under ${root}`);
    case "ensemble": throw new Error(`runs under ${root} are not one ensemble:\n  ${issue.problems.slice(0, 40).join("\n  ")}`);
    case "ring": throw new Error(
      `runs under ${root} include a metapopulation ring (condition(s) ${issue.conditions.join(", ")}, ${issue.count} seed(s) total) -- ` +
      `those seeds exchange matter/genomes with each other and are not independent replicates. This tool does not pool a ring's ` +
      `seeds as if they were; analyze the ring as a single unit (or extend analyze.ts to group by ring) instead of running ensemble ` +
      `inference across its seeds.`,
    );
    case "conservation": throw new Error("no run passed the conservation check");
    case "provenance": throw new Error(
      `runs under ${root} cannot use preset "${issue.presetId}"'s registered activity threshold -- provenance check failed:\n  ${issue.problems.slice(0, 40).join("\n  ")}`,
    );
    case "insufficient": throw new Error(`only ${issue.count} eligible neutral runs`);
  }
}
const { loaded, runs, invalid, presetId } = cohort;
const conditions = [...new Set(runs.map((r) => r.condition))].sort((x, y) => (x === "treatment" ? -1 : y === "treatment" ? 1 : x.localeCompare(y)));
const frozen = ACTIVITY_THRESHOLDS[presetId];
// This diagnostic never replaces a registered preset's independently frozen threshold.
const neutralActs = cohort.neutralActivities;
const inSampleNeutralQuantile = neutralActs.length > 0 ? quantile(neutralActs, 0.95) : null;

/** A minimal, valid RunSpec for a `specConfig` call that only cares about presetId/condition/seed -- the other fields are irrelevant to config computation and never touch the filesystem here. Mirrors experiments/endpoints.ts's own `neutralSpecFor`. */
function neutralSpecFor(id: string): RunSpec {
  return { experiment: "identity", presetId: id, condition: "neutral", seed: 0, steps: 1, censusEvery: 1, deepEvery: 1, checkpointEvery: 0 };
}

// This ensemble's own rule/schema/metrics versions (guaranteed identical
// across every loaded run by ensembleProblems above, so any one run's
// manifest speaks for the whole ensemble) and its preset's CURRENT identity
// (packages/schema/src/presets.ts's presetIdentity, recomputed fresh from
// the code actually running right now -- never trusted from any stored
// value) -- compared against a registered preset's recorded pilot metadata
// by decideActivityThreshold (Astra review, 2026-09-27, P1/item 2).
const currentPreset = PRESETS.find((p) => p.id === presetId);
// A preset id absent from @bl/schema's PRESETS can still reach here (an
// ensemble from an older/renamed preset) -- decideActivityThreshold only
// ever compares these against a *registered* threshold's recorded identity,
// and a preset unknown to the current code can never match a real digest,
// so this correctly refuses rather than throwing here.
const currentPresetIdentity = currentPreset ? presetIdentity(currentPreset) : "";
const currentCalibrationDistributionIdentity = currentPreset
  ? (() => {
      const { seed: _seed, ...neutralCfgWithoutSeed } = specConfig(neutralSpecFor(presetId));
      return distributionIdentity(currentPresetIdentity, "neutral", neutralCfgWithoutSeed as WorldConfig);
    })()
  : "";
const ensembleIdentity = {
  ruleVersion: runs[0].manifest.ruleVersion,
  schemaVersion: runs[0].manifest.schemaVersion,
  metricsVersion: runs[0].manifest.metricsVersion,
  presetIdentity: currentPresetIdentity,
  calibrationDistributionIdentity: currentCalibrationDistributionIdentity,
};
// Every seed present under this ensemble root, any condition -- reused
// against a registered preset's reserved calibration-pilot seed range
// (Astra review, P2). Uses `loaded` (not just the conservation-eligible
// `runs`) since a seed still occupies its slot in the experimental design
// even if that particular history failed conservation.
const ensembleSeeds = loaded.map((r) => r.seed);

// tools/lib/threshold.ts's decideActivityThreshold is pure (host-agnostic)
// and unit-tested directly (tests/deno/analyze.ts) -- it covers the
// registered/frozen, not-yet-calibrated, schedule-mismatch, version/identity,
// calibration-distribution-identity mismatch, seed-reuse and exploratory
// branches without needing a synthetic run bundle for each.
const outcome = decideActivityThreshold(presetId, ACTIVITY_THRESHOLDS, runs[0].manifest.spec, Number(a.q), neutralActs, ensembleIdentity, ensembleSeeds);
if (outcome.kind === "refuse") throw new Error(outcome.reason);
const { mode: thresholdMode, q, calibrated, threshold, unavailableReason } = outcome.decision;

// ---- per-run statistics ----
type Stats = Record<string, number>;
const perRun = new Map<Run, Stats>();
const trends = new Map<Run, string>();
const timeAvg = (r: Run, f: (x: Record<string, any>) => number | undefined) => {
  const v = r.series.map(f).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const tail = v.slice(Math.floor(v.length / 2)); // second half: post-transient
  return tail.length ? mean(tail) : NaN;
};
// Held-out observables' trend statistic and fit window (experiments/
// endpoints.ts: HELD_OUT_SPECS): a thin, stateful wrapper over
// `scheduledTrend` (packages/metrics/src/stats.ts -- the pure, unit-tested
// windowing/exclusion helper), which supplies `steps`/`values` from a
// loaded run's `series.jsonl` and tallies the returned status across the
// ensemble.
//
// MIN_TREND_POINTS is a short-run guard only, not a statistical
// requirement: a straight-line fit needs >= 3 points to have any residual
// degrees of freedom, so 4 gives a minimal safety margin against a single
// noisy point dominating the fit. It essentially never binds at the
// registered schedule -- 1e6 steps / censusEvery=100 / deepEvery=10 gives
// ~500 points in a deep-only second-half window alone. Because the window
// keeps `ceil(n/2)` scheduled positions (`n` = the number of scheduled
// positions before halving), "short" means fewer than MIN_TREND_POINTS
// positions survive that halving -- not a fixed count of total scheduled
// censuses (round-2 review finding #5: an earlier version of this comment
// said "8 scheduled censuses", which was off by the halving's rounding).
const MIN_TREND_POINTS = 4;

/** Runs (pooled across the whole ensemble) excluded or too short per held-out observable, for the rendered report. */
const trendDiagnostics = new Map<string, { ok: number; excluded: number; short: number }>();
const trend = (r: Run, key: string, f: (x: Record<string, any>) => number | undefined, deepOnly: boolean) => {
  const steps = r.series.map((x) => x.step);
  const values = r.series.map(f);
  const out = scheduledTrend(steps, values, r.manifest.spec.deepEvery, deepOnly, MIN_TREND_POINTS);
  const d = trendDiagnostics.get(key) ?? { ok: 0, excluded: 0, short: 0 };
  d[out.status]++;
  trendDiagnostics.set(key, d);
  // Scaled x1e5 (change per 1e5 steps), matching growthSlope's existing
  // display convention below -- Mann-Whitney/Wilcoxon are invariant under a
  // positive rescaling, so this changes no test result, only makes the
  // printed numbers readable (review finding #6: raw per-step slopes like
  // 2e-6 printed as "0.0000" under the existing 4-decimal formatter).
  return out.slope * 1e5;
};
for (const r of runs) {
  const { snaps } = await activities(r, threshold);
  const last = snaps[snaps.length - 1];
  const t = snaps.map((s) => s.step);
  const cum = snaps.map((s) => s.cumulativeNew);
  const g = t.length > 5 ? growthVsSaturation(t, cum) : null;
  if (g && calibrated) trends.set(r, g.verdict);
  perRun.set(r, {
    cumulativeNewActivity: calibrated ? (last?.cumulativeNew ?? 0) : NaN,
    newActivityRate: calibrated && last ? (last.cumulativeNew / Math.max(1, last.step)) * 1e5 : NaN,
    meanSignificant: calibrated ? mean(snaps.map((s) => s.significant)) : NaN,
    individuals: timeAvg(r, (x) => x.individuals),
    lineages: timeAvg(r, (x) => x.lineages),
    lineageShannon: timeAvg(r, (x) => x.lineageShannon),
    bioticRecycling: timeAvg(r, (x) => x.bioticRecycling),
    rolesPresent: timeAvg(r, (x) => x.rolesPresent?.length),
    temporalMI: timeAvg(r, (x) => x.temporalMI),
    patternEntropy: timeAvg(r, (x) => x.patternEntropy),
    lineageCompression: timeAvg(r, (x) => x.lineageCompression),
    differentiation: timeAvg(r, (x) => x.morphology?.differentiation),
    compartmentalised: timeAvg(r, (x) => x.morphology?.compartmentalised),
    // Held-out trend statistics (experiments/endpoints.ts: HELD_OUT_SPECS),
    // scaled per 1e5 steps. temporalMI/patternEntropy are scheduled every
    // census; the rest only on deep censuses.
    temporalMITrend: trend(r, "temporalMI", (x) => x.temporalMI, false),
    patternEntropyTrend: trend(r, "patternEntropy", (x) => x.patternEntropy, false),
    lineageCompressionTrend: trend(r, "lineageCompression", (x) => x.lineageCompression, true),
    differentiationTrend: trend(r, "differentiation", (x) => x.morphology?.differentiation, true),
    compartmentalisedTrend: trend(r, "compartmentalised", (x) => x.morphology?.compartmentalised, true),
    rolesPresentTrend: trend(r, "rolesPresent", (x) => x.rolesPresent?.length, true),
    fissionsPer1e4: ((r.manifest.summary.fissions + 0) / Math.max(1, r.manifest.summary.steps)) * 1e4,
    buddingsPer1e4: ((r.manifest.summary.buddings ?? 0) / Math.max(1, r.manifest.summary.steps)) * 1e4,
    maxGeneration: r.manifest.summary.maxGeneration,
    growthSlope: calibrated && g ? g.lin.slope * 1e5 : NaN,
  });
}

// ---- comparisons ----
const keys = Object.keys(perRun.values().next().value!);
const HELD_OUT = new Set([
  "temporalMI",
  "patternEntropy",
  "lineageCompression",
  "differentiation",
  "compartmentalised",
  "rolesPresent",
  "temporalMITrend",
  "patternEntropyTrend",
  "lineageCompressionTrend",
  "differentiationTrend",
  "compartmentalisedTrend",
  "rolesPresentTrend",
]);
const byCond = (c: string) => runs.filter((r) => r.condition === c).map((r) => perRun.get(r)!);
const treat = byCond("treatment");
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)) : "—");

let md = `# Ensemble report: ${root}\n\n`;
md += `Generated ${new Date().toISOString()} from ${runs.length} eligible runs.\n\n`;
if (invalid.length) md += `**Excluded (conservation failed):** ${invalid.map((r) => `${r.condition}/seed-${r.seed}`).join(", ")}\n\n`;
if (thresholdMode === "frozen") {
  md += calibrated
    ? `Activity threshold: **${fmt(threshold)}** cell-censuses -- frozen for preset "${presetId}" at q=${q} from the ` +
      `"${frozen!.pilot.experiment}" pilot (${frozen!.pilot.runs} neutral runs, seeds ${frozen!.pilot.seeds[0]}–${frozen!.pilot.seeds[1]}), ` +
      `not from this ensemble's own neutral runs.\n\n`
    : `**Activity endpoints unavailable:** ${unavailableReason}\n\n`;
  md += inSampleNeutralQuantile !== null
    ? `Diagnostic only (never used for inference): this ensemble's own in-sample neutral 95th percentile (q=0.95 of ` +
      `${neutralActs.length} neutral lineage activities) is **${fmt(inSampleNeutralQuantile)}**.\n\n`
    : `Diagnostic only: no eligible neutral-shadow runs in this ensemble to compute an in-sample neutral percentile.\n\n`;
} else {
  md += calibrated
    ? `Neutral activity threshold (q=${q} of ${neutralActs.length} neutral lineage activities, exploratory -- preset ` +
      `"${presetId}" has no registered, frozen threshold): **${fmt(threshold)}** cell-censuses.\n\n`
    : `**Activity endpoints unavailable:** no eligible neutral-shadow runs to calibrate the threshold (run the \`neutral\` condition).\n\n`;
}
md += `## Conditions\n\n| condition | runs | steps | conservation exact | extinct | trend of cumulative new activity |\n|---|---|---|---|---|---|\n`;
for (const c of conditions) {
  const rs = runs.filter((r) => r.condition === c);
  const verdicts = rs.map((r) => trends.get(r) ?? "n/a");
  const count = (v: string) => verdicts.filter((x) => x === v).length;
  md += `| ${c} | ${rs.length} | ${rs[0].manifest.summary.steps} | ${rs.filter((r) => r.manifest.summary.conservationOk).length}/${rs.length} | ${rs.filter((r) => r.manifest.summary.extinct).length} | growing ${count("growing")}, saturating ${count("saturating")}, flat ${count("flat")}, indeterminate ${count("indeterminate")} |\n`;
}
md += `\n## Statistics (mean ± sd over seeds; second half of each run)\n\n`;
md += `Held-out observables are marked †; none is used by any search or selection mechanism. \`*Trend\` fields ` +
  `are OLS slopes scaled ×1e5 (change per 1e5 steps); the scaling doesn't affect any test below, only readability.\n\n`;
md += `| statistic | ${conditions.join(" | ")} |\n|---|${conditions.map(() => "---").join("|")}|\n`;
for (const k of keys) {
  md += `| ${k}${HELD_OUT.has(k) ? " †" : ""} | ${conditions
    .map((c) => {
      const v = byCond(c).map((s) => s[k]).filter(Number.isFinite);
      return v.length ? `${fmt(mean(v))} ± ${fmt(sd(v))}` : "—";
    })
    .join(" | ")} |\n`;
}
// ---- pre-registered primary endpoints (experiments/endpoints.ts) ----
// One entry per PRIMARY_ENDPOINTS item, executed by evaluateEndpoint and
// rendered below -- this replaces the endpoint tests that used to be
// hard-coded here; the doc's "## Primary endpoints" section is generated
// from the same PRIMARY_ENDPOINTS by tools/gen-prereg.ts, so the two cannot
// silently drift apart.
const views: RunView[] = runs.map((r) => ({
  condition: r.condition,
  seed: r.seed,
  stats: perRun.get(r)!,
  trend: calibrated ? (trends.get(r) as RunView["trend"]) : undefined,
  series: r.series.map((x) => ({ step: x.step, rolesPresent: x.rolesPresent })),
}));
const results: EndpointResult[] = PRIMARY_ENDPOINTS.map((e) => evaluateEndpoint(e, views));

function renderEndpoint(n: number, r: EndpointResult): string {
  // `description` already leads with its own bold title (matching
  // preregistration.md's generated numbered list) -- don't re-wrap it.
  let out = `${n}. ${r.description}\n\n`;
  if (r.kind === "test") {
    out += `| comparison | n (a, b) | effect P(a > b) | one-sided p | Holm-adjusted p | supported |\n|---|---|---|---|---|---|\n`;
    for (const row of r.rows) {
      out += row.available
        ? `| ${row.a} > ${row.b} | ${row.nA}, ${row.nB} | ${row.effect.toFixed(2)} | ${row.p.toFixed(4)} | ${row.pAdj.toFixed(4)} | ${row.supported ? "yes" : "no"} |\n`
        : `| ${row.a} > ${row.b} | ${row.nA}, ${row.nB} | — | — | — | unavailable (need ≥2 runs each) |\n`;
    }
    if (!r.complete) out += `\nThe Holm family is incomplete; the endpoint cannot be established from this ensemble.\n`;
  } else if (r.kind === "threshold") {
    out +=
      r.rows
        .map((row) => `${row.condition}: ${row.qualifying}/${row.total} qualifying (need ${row.relation}, ${row.classified}/${row.total} classified)`)
        .join("; ") + ". ";
    out += r.available
      ? `Supported: ${r.supported ? "yes" : "no"}.\n`
      : `Unavailable (need runs, all growth-classified, in every group).\n`;
  } else {
    out += `${r.condition}: ${r.qualifying}/${r.total} runs reach a continuous ≥${r.minRoles}-role coexistence duration of ≥${r.minSteps.toLocaleString()} steps. `;
    out += r.total > 0 ? `Supported: ${r.supported ? "yes" : "no"} (majority).\n` : `Unavailable (no ${r.condition} runs).\n`;
    if (r.gate) out += `M5 gate (≥${r.gate.minRoles} roles, same duration): ${r.gate.qualifying}/${r.gate.total}, supported: ${r.gate.supported ? "yes" : "no"}.\n`;
  }
  return out;
}

// Endpoint 1's `description` text (experiments/endpoints.ts) is generated
// once, shared verbatim with preregistration.md, and always describes the
// REGISTERED/frozen-threshold framing. When this ensemble's own preset is
// exploratory instead, that shared text doesn't describe what this report
// actually did (Astra review, 2026-09-27, P3) -- qualified here, per report,
// rather than making the shared description mode-aware.
const adaptiveActivityNote: string | null =
  thresholdMode === "exploratory"
    ? `preset "${presetId}" is not registered in ACTIVITY_THRESHOLDS, so the "frozen threshold" text in endpoint 1's ` +
      `description does not describe this ensemble. Its activity endpoints instead use the EXPLORATORY in-sample ` +
      `threshold reported above (q=${q} of this ensemble's own neutral runs), not a frozen value.`
    : null;

md += `\n## Primary endpoints (pre-registered)\n\n`;
results.forEach((r, i) => {
  md += `\n${renderEndpoint(i + 1, r)}`;
  if (PRIMARY_ENDPOINTS[i].id === "adaptive-activity" && adaptiveActivityNote) md += `\n**Note for this report:** ${adaptiveActivityNote}\n`;
});

// ---- held-out observables (experiments/endpoints.ts: HELD_OUT_SPECS) ----
// Confirmatory, not exploratory (2026-09-26 amendment) -- kept in its own
// section, clearly separate from "## Primary endpoints" above and
// "## Exploratory" below. Each directional observable needs BOTH an
// absolute test (treatment's own trend > 0) and a relative one (treatment >
// every preset-declared control), with every directional observable's tests
// pooled into one shared Holm family (see experiments/endpoints.ts for the
// full rationale). Pattern entropy and lineage-map compression ratio are
// descriptive only and never counted.
const heldOut = evaluateHeldOut(views, presetId);
/** HELD_OUT_SPECS's id -> the base statistic key `trendDiagnostics` is keyed by (strips the "Trend" suffix). */
const heldOutBaseKey = new Map(HELD_OUT_SPECS.map((s) => [s.id, s.statistic.replace(/Trend$/, "")]));

function renderHeldOut(n: number, r: HeldOutObservableResult): string {
  let out = `${n}. ${r.description}\n\n`;
  if (!r.directional) {
    out += `_Descriptive only -- never counted toward the "at least ${heldOut.summary.minSupported} of ${heldOut.summary.total}" claim._\n\n`;
  } else if (r.absolute) {
    out += r.absolute.available
      ? `Absolute (treatment's own trend slopes > 0, Wilcoxon signed-rank, method: ${r.absolute.method}): n=${r.absolute.n}, ` +
        `W+=${r.absolute.W.toFixed(1)}, one-sided p=${r.absolute.p.toFixed(4)}, Holm-adjusted p=` +
        `${Number.isFinite(r.absolute.pAdj) ? r.absolute.pAdj.toFixed(4) : "—"}, supported: ${r.absolute.supported ? "yes" : "no"}.\n\n`
      : `Absolute: unavailable (need >= 2 and <= ${EXACT_MAX} finite treatment trend values -- this endpoint refuses the exact Wilcoxon test rather than silently approximating it above ${EXACT_MAX}).\n\n`;
  }
  out += `| comparison | n (a, b) | effect P(a > b) | one-sided p | Holm-adjusted p | supported |\n|---|---|---|---|---|---|\n`;
  for (const row of r.relative.rows) {
    const pAdjCell = Number.isFinite(row.pAdj) ? row.pAdj.toFixed(4) : r.directional ? "— (unavailable)" : "— (descriptive)";
    out += row.available
      ? `| ${row.a} > ${row.b} | ${row.nA}, ${row.nB} | ${row.effect.toFixed(2)} | ${row.p.toFixed(4)} | ${pAdjCell} | ${row.supported ? "yes" : "no"} |\n`
      : `| ${row.a} > ${row.b} | ${row.nA}, ${row.nB} | — | — | — | unavailable (need ≥2 runs each) |\n`;
  }
  if (!r.relative.complete)
    out += `\nA declared control is missing or has < 2 runs; this endpoint is unavailable -- never a silently smaller family.\n`;
  const diag = trendDiagnostics.get(heldOutBaseKey.get(r.id) ?? "");
  if (diag && (diag.excluded > 0 || diag.short > 0))
    out +=
      `\nFit window: ${diag.ok} runs ok, ${diag.excluded} excluded (a scheduled observation was missing), ` +
      `${diag.short} too short for the window (fewer than ${MIN_TREND_POINTS} scheduled observations retained ` +
      `after keeping the second half).\n`;
  if (r.directional) out += `\nSupported: ${r.available ? (r.supported ? "yes" : "no") : "unavailable"}.\n`;
  if (r.id === "held-out-lineage-compression")
    out +=
      "\n**Note:** since metrics version 2, `compressionRatio` uses a bundled deterministic deflate (fflate) " +
      "instead of the runtime's `CompressionStream`, whose output size differed between Chrome and Deno; " +
      "this analysis pools only runs with the current metrics version, and earlier data is not comparable. " +
      "See docs/refactor-v3-workflow.md.\n";
  return out;
}

md += `\n## Held-out observables (pre-registered, confirmatory -- 2026-09-26 amendment)\n\n`;
if (!heldOut.summary.presetDeclared) md += `**No declared held-out control set for preset "${presetId}"** -- every observable below is unavailable.\n\n`;
heldOut.results.forEach((r, i) => (md += `\n${renderHeldOut(i + 1, r)}`));
// Three-valued outcome (round-2/3 fix): "supported" once >= minSupported are
// established; "not-supported" only when even the OPTIMISTIC bound
// (`optimisticCount`: every missing slot in the shared family recomputed at
// p=0, not just the currently-unavailable observables credited as a flat
// pass) could not reach minSupported -- some directional observables may
// still be individually unavailable even in this case, since completing
// their data isn't what the bound assumes; otherwise "unavailable" --
// missing evidence, not a negative.
const outcomeText = !heldOut.summary.presetDeclared
  ? `unavailable (preset "${presetId}" has no declared control set at all, so not even an optimistic bound can be computed -- this is not a report of 0 established observables)`
  : heldOut.summary.outcome === "supported"
  ? "supported"
  : heldOut.summary.outcome === "not-supported"
  ? `not supported (a fully-evaluated negative: even crediting every missing test in the shared family with the best possible p-value reaches only ${heldOut.summary.optimisticCount}/${heldOut.summary.total}, short of the ${heldOut.summary.minSupported} required)`
  : `unavailable (${heldOut.summary.optimisticCount}/${heldOut.summary.total} could still be established once missing data arrives, which meets the ${heldOut.summary.minSupported} required -- not enough evidence yet to decide the question either way)`;
md +=
  `\n${heldOut.summary.establishedCount}/${heldOut.summary.total} directional observables established ` +
  `(${heldOut.summary.refutedCount} refuted, ${heldOut.summary.unavailableCount} unavailable; need ` +
  `${heldOut.summary.minSupported} established). Held-out hypothesis: ${outcomeText}. ` +
  `Declared controls for preset "${presetId}": ${heldOut.summary.controls.join(", ") || "none declared"}. Shared Holm family size: ${heldOut.summary.familySize}.\n`;
if (heldOut.summary.outcome === "not-supported")
  md +=
    "\n**What this does and does not guarantee:** holding every currently available raw p-value fixed, " +
    "no assignment of p-values to currently unavailable test slots could establish 2 directional " +
    "observables. This does not cover additional seeds beyond what this ensemble currently has, " +
    "recovered or excluded measurements, or any other change that would recompute an already-available " +
    "raw p-value (an available test can still be missing registered seeds -- availability requires only " +
    "2 finite runs, not the full registered sample). This is a failure to meet the registered criterion " +
    "on this ensemble, not a biological refutation.\n";

if (treat.length) {
  md += `\n## Exploratory: treatment vs controls (Mann–Whitney, two-sided, unadjusted; effect = P(treatment > control))\n\n`;
  md += `Not part of the pre-registered inference; with few seeds these p-values are indicative only.\n\n`;
  md += `| statistic | ${conditions.filter((c) => c !== "treatment").join(" | ")} |\n|---|${conditions.filter((c) => c !== "treatment").map(() => "---").join("|")}|\n`;
  for (const k of keys) {
    md += `| ${k} | ${conditions
      .filter((c) => c !== "treatment")
      .map((c) => {
        const x = treat.map((s) => s[k]).filter(Number.isFinite);
        const y = byCond(c).map((s) => s[k]).filter(Number.isFinite);
        if (x.length < 2 || y.length < 2) return "—";
        const t = mannWhitney(x, y);
        return `${t.effect.toFixed(2)} (p=${t.p.toFixed(3)})`;
      })
      .join(" | ")} |\n`;
  }
}

// Descriptive only (docs/plan.md, M4): the fraction of treatment runs whose
// cumulative new activity exceeds the neutral runs' 95th percentile. M4 is
// decided by endpoints 1 and 2; this number never enters a gate.
const m4Treat = treat.map((s) => s.cumulativeNewActivity).filter(Number.isFinite);
const m4Neutral = byCond("neutral").map((s) => s.cumulativeNewActivity).filter(Number.isFinite);
const m4Descriptive = calibrated && m4Treat.length && m4Neutral.length >= 2
  ? (() => {
    const neutralQ95 = quantile(m4Neutral, 0.95);
    const above = m4Treat.filter((x) => x > neutralQ95).length;
    return { above, runs: m4Treat.length, fraction: above / m4Treat.length, neutralQ95 };
  })()
  : null;
if (m4Descriptive) {
  md += `\n## Descriptive: treatment runs above the neutral 95th percentile (M4, not a test)\n\n`;
  md += `${m4Descriptive.above} of ${m4Descriptive.runs} treatment runs (${(100 * m4Descriptive.fraction).toFixed(0)}%) have cumulative new activity above ` +
    `the neutral runs' 95th percentile (${fmt(m4Descriptive.neutralQ95)}). M4 is decided by endpoints 1 and 2, not by this fraction.\n`;
}

// ---- charts (SVG, one line per run) ----
function chart(title: string, f: (x: Record<string, any>) => number | undefined, file: string) {
  const W = 720, H = 260, P = 40;
  const colors = ["#1a7f55", "#c2410c", "#2563eb", "#9333ea", "#ca8a04", "#0891b2", "#be123c"];
  let xmax = 1, ymin = Infinity, ymax = -Infinity;
  const lines = runs.map((r) => {
    const pts = r.series.map((x) => [x.step, f(x)] as [number, number | undefined]).filter((p): p is [number, number] => Number.isFinite(p[1]));
    for (const [x, y] of pts) {
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    return { r, pts };
  });
  if (!Number.isFinite(ymin)) return "";
  if (ymax === ymin) ymax = ymin + 1;
  const sx = (x: number) => P + (x / xmax) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - ymin) / (ymax - ymin)) * (H - 2 * P);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui" font-size="11"><rect width="100%" height="100%" fill="#fff"/>`;
  svg += `<text x="${P}" y="18" font-size="13" font-weight="600">${title}</text>`;
  svg += `<text x="${P}" y="${H - 10}" fill="#666">0</text><text x="${W - P}" y="${H - 10}" text-anchor="end" fill="#666">${xmax.toLocaleString()} steps</text>`;
  svg += `<text x="${P - 4}" y="${sy(ymax) + 4}" text-anchor="end" fill="#666">${fmt(ymax)}</text><text x="${P - 4}" y="${sy(ymin) + 4}" text-anchor="end" fill="#666">${fmt(ymin)}</text>`;
  for (const { r, pts } of lines) {
    const col = colors[conditions.indexOf(r.condition) % colors.length];
    svg += `<polyline fill="none" stroke="${col}" stroke-opacity="0.8" stroke-width="1.4" points="${pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}"/>`;
  }
  conditions.forEach((c, i) => {
    svg += `<rect x="${W - P - 150}" y="${28 + i * 14}" width="10" height="10" fill="${colors[i % colors.length]}"/><text x="${W - P - 135}" y="${37 + i * 14}">${c}</text>`;
  });
  svg += `</svg>`;
  Deno.writeTextFileSync(`${outDir}/${file}`, svg);
  return `![${title}](${file})\n\n`;
}
await Deno.mkdir(outDir, { recursive: true });
md += `\n## Time series\n\n`;
md += chart("Individuals", (x) => x.individuals, "individuals.svg");
md += chart("Lineages present", (x) => x.lineages, "lineages.svg");
md += chart("Biotic share of recycling", (x) => x.bioticRecycling, "recycling.svg");
md += chart("Temporal mutual information † (bits/block)", (x) => x.temporalMI, "temporal-mi.svg");
md += chart("Lineage-map compression ratio †", (x) => x.lineageCompression, "compression.svg");
md += chart("Bound mass (B+P)", (x) => x.pools.B + x.pools.P, "biomass.svg");

await Deno.writeTextFile(`${outDir}/report.md`, md);
await Deno.writeTextFile(
  `${outDir}/report.json`,
  JSON.stringify(
    {
      presetId,
      thresholdMode,
      calibrated,
      threshold,
      q,
      unavailableReason,
      inSampleNeutralQuantile,
      adaptiveActivityNote,
      ensembleIdentity,
      m4Descriptive,
      runs: runs.map((r) => ({ condition: r.condition, seed: r.seed, trend: trends.get(r), stats: perRun.get(r) })),
    },
    null,
    2,
  ),
);
console.log(md.split("## Time series")[0]);
console.log(`wrote ${outDir}/report.md`);
