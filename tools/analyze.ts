// Ensemble analysis over run bundles written by tools/run.ts.
//
//   deno run -A tools/analyze.ts runs/<experiment>/<preset> [--out report]
//   deno run -A tools/analyze.ts runs/m4-ext/gradient-m3 --registry extension   (registered 10^7 extension,
//     thresholds from experiments/extension.ts; secondary and descriptive)
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
//
// This module exports a loader (`loadRun`/`loadEnsemble`, Deno-only I/O) and
// a pure `analyzeEnsemble` function with no filesystem access -- tools/nullcal.ts
// builds `Run[]` in memory and calls `analyzeEnsemble` directly, exercising
// exactly the same analysis code this CLI runs against real bundles.
//
// Memory: the CLI loads with `reduceRun`, which digests each run's
// series.jsonl as it loads (`digestSeries`) and keeps only that digest, the
// census steps and its heredity.tsv pairs packed into a typed array;
// lineages.tsv is streamed per census by `activities`. Peak memory is about
// one parsed run plus a few MB per run. A run handed over unreduced
// (tools/nullcal.ts, `loadEnsemble`) is digested on first use, with the same
// code.
import { EXACT_MAX, growthVsSaturation, mannWhitney, mean, quantile, ROLES, scheduledTrend, sd } from "@bl/metrics";
import { distributionIdentity, PRESETS, presetIdentity, type WorldConfig } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import {
  activities,
  ensembleProblems,
  heredityPairs,
  loadRunsUnder,
  metapopulationRingProblems,
  partitionByConservation,
  provenanceProblems,
  type Run,
} from "./lib/bundle.ts";
import { decideActivityThreshold, type EnsembleIdentity } from "./lib/threshold.ts";
import {
  ACTIVITY_THRESHOLDS,
  evaluateEndpoint,
  evaluateHeldOut,
  HELD_OUT_SPECS,
  PRIMARY_ENDPOINTS,
  type ActivityThresholdEntry,
  type EndpointResult,
  type HeldOutObservableResult,
  type RunView,
  type SeriesPoint,
} from "../experiments/endpoints.ts";

export type { Run } from "./lib/bundle.ts";

export interface AnalyzeOptions {
  /** Neutral-activity-threshold quantile (default 0.95). Not applicable to a registered preset unless `ignoreFrozenThreshold` is also set (see below). */
  q?: number;
  /** Markdown's "Generated <time>" line. Kept out of this pure function's own clock reads so identical options always produce identical markdown; the CLI supplies the real wall-clock time, and a caller that only wants `results`/`heldOut` (e.g. tools/nullcal.ts) can omit it. Omitted: the line is rendered without a timestamp. */
  generatedAt?: string;
  /**
   * Treats `presetId` as exploratory (this ensemble's own in-sample neutral
   * quantile) even when it is registered in ACTIVITY_THRESHOLDS, and skips
   * the provenance check that a registered preset's frozen threshold would
   * otherwise require. For tools/nullcal.ts's synthetic null-generator
   * ensembles only: they reuse "gradient-m3" as `presetId` purely to pick up
   * that preset's declared PRIMARY_ENDPOINTS/held-out-control wiring, not
   * because they are real gradient-m3 simulation bundles -- they have no
   * founder provenance to check. A real bundle must never set this: it would
   * silently discard the frozen, independently calibrated threshold for
   * data that should be held to it.
   */
  ignoreFrozenThreshold?: boolean;
  /**
   * The threshold registry to use instead of ACTIVITY_THRESHOLDS: the registered 10^7 extension's
   * (experiments/extension.ts, via `--registry extension`). Omitted: ACTIVITY_THRESHOLDS, exactly as
   * at the freeze. `note` heads the report.
   */
  registry?: { thresholds: Record<string, ActivityThresholdEntry>; note: string };
}

export interface AnalyzeResult {
  /** report.md content, chart embeds included as `![title](file)` links. */
  markdown: string;
  /** report.json content, byte-identical in shape to what this CLI has always written since the activity threshold was frozen (2026-09-27). */
  json: {
    presetId: string;
    thresholdMode: "frozen" | "exploratory";
    calibrated: boolean;
    threshold: number;
    q: number;
    unavailableReason: string | null;
    inSampleNeutralQuantile: number | null;
    adaptiveActivityNote: string | null;
    ensembleIdentity: EnsembleIdentity;
    /** Descriptive M4 fraction (docs/plan.md); null unless calibrated with treatment and at least 2 neutral runs. */
    m4Descriptive: { above: number; runs: number; fraction: number; neutralQ95: number } | null;
    /** Endpoint 4, held-out role count and held-out summary at role cuts 2.5% and 10% (registered: 5%), or why it is withheld. */
    roleCutSensitivity: { cut: number; coexistence: EndpointResult[]; heldOutRoleCount: { available: boolean; supported: boolean } | null; heldOutOutcome: string }[] | { unavailable: string };
    /** Descriptive sibling correlations of mu and sigma at fission, per condition with heredity data. */
    heredity: { condition: string; runs: number; fissions: number; muPooled: number; sigmaPooled: number; muMedianRun: number; sigmaMedianRun: number }[];
    runs: unknown[];
  };
  /** Machine-readable endpoint decisions the CLI's own report.json does not carry -- exposed here for an in-memory caller (tools/nullcal.ts) that consumes them directly instead of parsing rendered Markdown. */
  results: EndpointResult[];
  heldOut: ReturnType<typeof evaluateHeldOut>;
  /** SVG chart bodies the CLI writes to `${outDir}/${file}`; a direct caller (e.g. nullcal) can ignore this. */
  charts: { file: string; svg: string }[];
}

// ---------------------------------------------------------------------------
// Loader (I/O, Deno-only). Re-exported from tools/lib/bundle.ts, shared with
// tools/calibrate.ts, so both tools apply byte-identical loading/eligibility
// rules.
// ---------------------------------------------------------------------------
export { loadRun, loadRunsUnder as loadEnsemble } from "./lib/bundle.ts";

/** A minimal, valid RunSpec for a `specConfig` call that only cares about presetId/condition/seed -- the other fields are irrelevant to config computation and never touch the filesystem here. Mirrors experiments/endpoints.ts's own `neutralSpecFor`. */
function neutralSpecFor(id: string): RunSpec {
  return { experiment: "identity", presetId: id, condition: "neutral", seed: 0, steps: 1, censusEvery: 1, deepEvery: 1, checkpointEvery: 0 };
}

// ---------------------------------------------------------------------------
// Per-run series digest: everything the analysis reads from a run's
// series.jsonl, computed from that run alone. A parsed 1e6-step series is
// tens of MB of heap (10^4 census records, most fields unused here), so the
// CLI digests each run as it loads and drops the records (`reduceRun`);
// holding every run's series at once would not fit an ensemble of ~100 runs.
// ---------------------------------------------------------------------------
type Series = Record<string, any>[];

// Held-out observables' trend statistic and fit window (experiments/
// endpoints.ts: HELD_OUT_SPECS): a thin wrapper over `scheduledTrend`
// (packages/metrics/src/stats.ts -- the pure, unit-tested windowing/exclusion
// helper), which supplies `steps`/`values` from a run's `series.jsonl`;
// analyzeEnsemble tallies the returned status across the ensemble.
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

// Roles hold at least ROLE_CUT of living cells (roleSummary's minShare); the
// pre-registered sensitivity re-applies the cut at x0.5 and x2 (see
// analyzeEnsemble's "sensitivity" section).
const ROLE_CUT = 0.05;
const SENSITIVITY_CUTS = [ROLE_CUT / 2, ROLE_CUT * 2];

const timeAvg = (series: Series, f: (x: Record<string, any>) => number | undefined) => {
  const v = series.map(f).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const tail = v.slice(Math.floor(v.length / 2)); // second half: post-transient
  return tail.length ? mean(tail) : NaN;
};
const trend = (series: Series, f: (x: Record<string, any>) => number | undefined, deepEvery: number, deepOnly: boolean) => {
  const out = scheduledTrend(series.map((x) => x.step), series.map(f), deepEvery, deepOnly, MIN_TREND_POINTS);
  // Scaled x1e5 (change per 1e5 steps), matching growthSlope's existing
  // display convention -- Mann-Whitney/Wilcoxon are invariant under a
  // positive rescaling, so this changes no test result, only makes the
  // printed numbers readable (review finding #6: raw per-step slopes like
  // 2e-6 printed as "0.0000" under the existing 4-decimal formatter).
  return { slope: out.slope * 1e5, status: out.status };
};
const recut = (series: Series, cut: number) =>
  series.map((x) => (x.roles && Array.isArray(x.rolesPresent) ? { ...x, rolesPresent: ROLES.filter((k) => (x.roles[k] ?? 0) >= cut) } : x));
/** The points endpoint 4's coexistence durations read: deep censuses only (those carrying `rolesPresent`), which is all `coexistenceDurations` looks at. */
const rolePoints = (series: Series): SeriesPoint[] => series.filter((x) => Array.isArray(x.rolesPresent)).map((x) => ({ step: x.step, rolesPresent: x.rolesPresent }));

/** Time-series charts, one line per run, in report order. */
const CHARTS: { title: string; file: string; f: (x: Record<string, any>) => number | undefined }[] = [
  { title: "Individuals", file: "individuals.svg", f: (x) => x.individuals },
  { title: "Lineages present", file: "lineages.svg", f: (x) => x.lineages },
  { title: "Biotic share of recycling", file: "recycling.svg", f: (x) => x.bioticRecycling },
  { title: "Temporal mutual information † (bits/block)", file: "temporal-mi.svg", f: (x) => x.temporalMI },
  { title: "Lineage-map compression ratio †", file: "compression.svg", f: (x) => x.lineageCompression },
  { title: "Bound mass (B+P)", file: "biomass.svg", f: (x) => x.pools.B + x.pools.P },
];

/**
 * A digest part the analysis may never reach (sensitivity is withheld after a
 * mismatch; a chart is drawn only once everything else succeeded): its error
 * is kept and rethrown by `settle` where the analysis uses it, so a digest
 * never fails earlier, or on more inputs, than the analysis did on raw records.
 */
type Deferred<T> = { value: T } | { error: unknown };
function defer<T>(f: () => T): Deferred<T> {
  try {
    return { value: f() };
  } catch (error) {
    return { error };
  }
}
function settle<T>(d: Deferred<T>): T {
  if ("error" in d) throw d.error;
  return d.value;
}

export interface SeriesDigest {
  /** Second-half time averages, keyed by statistic name. */
  avg: Record<"individuals" | "lineages" | "lineageShannon" | "bioticRecycling" | "rolesPresent" | "temporalMI" | "patternEntropy" | "lineageCompression" | "differentiation" | "compartmentalised", number>;
  /** Held-out trend slopes (x1e5) and fit-window status, keyed by base statistic name. */
  trends: Record<"temporalMI" | "patternEntropy" | "lineageCompression" | "differentiation" | "compartmentalised" | "rolesPresent", { slope: number; status: "ok" | "excluded" | "short" }>;
  roles: SeriesPoint[];
  /** Whether re-applying ROLE_CUT to the recorded role shares fails to reproduce some census's recorded rolesPresent. */
  recutMismatch: Deferred<boolean>;
  /** Per SENSITIVITY_CUTS entry: the role statistics and points with roles re-cut at that share. */
  recut: Deferred<{ rolesPresent: number; rolesPresentTrend: number; roles: SeriesPoint[] }>[];
  /** Census steps, and per CHARTS entry the plotted value per census (NaN where not finite). */
  steps: Float64Array;
  charts: Deferred<Float64Array>[];
}

/** Digests one run's census records (see SeriesDigest); pure. */
export function digestSeries(series: Series, deepEvery: number): SeriesDigest {
  return {
    avg: {
      individuals: timeAvg(series, (x) => x.individuals),
      lineages: timeAvg(series, (x) => x.lineages),
      lineageShannon: timeAvg(series, (x) => x.lineageShannon),
      bioticRecycling: timeAvg(series, (x) => x.bioticRecycling),
      rolesPresent: timeAvg(series, (x) => x.rolesPresent?.length),
      temporalMI: timeAvg(series, (x) => x.temporalMI),
      patternEntropy: timeAvg(series, (x) => x.patternEntropy),
      lineageCompression: timeAvg(series, (x) => x.lineageCompression),
      differentiation: timeAvg(series, (x) => x.morphology?.differentiation),
      compartmentalised: timeAvg(series, (x) => x.morphology?.compartmentalised),
    },
    // temporalMI/patternEntropy are scheduled every census; the rest only on deep censuses.
    trends: {
      temporalMI: trend(series, (x) => x.temporalMI, deepEvery, false),
      patternEntropy: trend(series, (x) => x.patternEntropy, deepEvery, false),
      lineageCompression: trend(series, (x) => x.lineageCompression, deepEvery, true),
      differentiation: trend(series, (x) => x.morphology?.differentiation, deepEvery, true),
      compartmentalised: trend(series, (x) => x.morphology?.compartmentalised, deepEvery, true),
      rolesPresent: trend(series, (x) => x.rolesPresent?.length, deepEvery, true),
    },
    roles: rolePoints(series),
    recutMismatch: defer(() =>
      series.some((x) => x.roles && Array.isArray(x.rolesPresent) && JSON.stringify(ROLES.filter((k) => (x.roles[k] ?? 0) >= ROLE_CUT)) !== JSON.stringify(x.rolesPresent))
    ),
    recut: SENSITIVITY_CUTS.map((cut) =>
      defer(() => {
        const alt = recut(series, cut);
        return { rolesPresent: timeAvg(alt, (x) => x.rolesPresent?.length), rolesPresentTrend: trend(alt, (x) => x.rolesPresent?.length, deepEvery, true).slope, roles: rolePoints(alt) };
      })
    ),
    steps: Float64Array.from(series, (x) => x.step),
    charts: CHARTS.map(({ f }) =>
      defer(() => {
        const ys = new Float64Array(series.length);
        series.forEach((x, i) => {
          const v = f(x);
          ys[i] = Number.isFinite(v) ? v! : NaN;
        });
        return ys;
      })
    ),
  };
}

/** Sibling pairs at fission (`heredityPairs`), packed four values per pair (muA, muB, sigmaA, sigmaB): a 1e6-step run can record ~10^5 fissions, too many to keep as arrays for every run. */
function packPairs(pairs: [number, number, number, number][]): Float64Array {
  const out = new Float64Array(4 * pairs.length);
  pairs.forEach((p, i) => out.set(p, 4 * i));
  return out;
}

/** A run reduced as it loads (see `reduceRun`). */
export type DigestedRun = Run & {
  digest?: SeriesDigest;
  /** Packed sibling pairs, null when the run has none, or the error reading them threw. */
  packedPairs?: Float64Array | null | { error: unknown };
};

/** A run's packed sibling pairs, read now if `reduceRun` did not; a read error surfaces here, where the analysis first needs them. */
async function packedPairsOf(r: DigestedRun): Promise<Float64Array | null> {
  if (r.packedPairs === undefined) {
    const pairs = await heredityPairs(r);
    return pairs && packPairs(pairs);
  }
  if (r.packedPairs && !(r.packedPairs instanceof Float64Array)) throw r.packedPairs.error;
  return r.packedPairs;
}

/**
 * `loadRunsUnder` reducer: replaces a run's census records by their digest
 * and the bare census steps (all `ensembleProblems` and `activities` read),
 * and reads its heredity.tsv into packed pairs. A run whose records cannot be
 * digested keeps them, and a heredity read error is kept for later, so
 * analyzeEnsemble refuses or fails where it would have without the reduction.
 */
export async function reduceRun(r: Run): Promise<DigestedRun> {
  let packedPairs: DigestedRun["packedPairs"];
  try {
    const pairs = await heredityPairs(r);
    packedPairs = pairs && packPairs(pairs);
  } catch (error) {
    packedPairs = { error };
  }
  try {
    const digest = digestSeries(r.series, r.manifest.spec.deepEvery);
    return { ...r, series: r.series.map((x) => ({ step: x.step })), digest, packedPairs };
  } catch {
    return { ...r, packedPairs };
  }
}

// ---------------------------------------------------------------------------
// Analysis. Pure for in-memory runs (`Run.lineages` set, as tools/nullcal.ts
// builds them); a real bundle's lineages.tsv is streamed from disk by
// `activities`, hence async.
// ---------------------------------------------------------------------------
export async function analyzeEnsemble(loaded: DigestedRun[], label: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  if (!loaded.length) throw new Error(`no completed runs under ${label}`);
  // ---- ensemble compatibility ----
  {
    const problems = ensembleProblems(loaded);
    if (problems.length) throw new Error(`runs under ${label} are not one ensemble:\n  ${problems.slice(0, 40).join("\n  ")}`);
  }
  // ---- metapopulation: ringed seeds are not independent replicates ----
  // A metapopulation's ring exchanges matter and genomes between its seeds at
  // every segment boundary (packages/schema/src/exchange.ts; RunSpec.metapopulation,
  // recorded verbatim in each run's manifest.json) -- those seeds are correlated,
  // not independent draws, so pooling them the way every statistic below does
  // (mean/sd over seeds, Mann-Whitney's per-seed sample sizes) would silently
  // misrepresent one ring as N independent replicates when the *ring* is the
  // actual statistical unit. "no-migration" runs are exempt even within a
  // metapopulation experiment -- Coordinator.Queue never wires import_from for
  // that condition (see its own and conditions.ts's "no-migration" docs), so
  // those seeds genuinely are independent. This tool refuses rather than
  // silently under-counting a ring's degrees of freedom; grouping by ring
  // (treating each ring as one data point) is a reasonable extension but not
  // implemented here. Non-metapopulation ensembles are entirely unaffected.
  {
    const ring = metapopulationRingProblems(loaded);
    if (ring) {
      throw new Error(
        `runs under ${label} include a metapopulation ring (condition(s) ${ring.conditions.join(", ")}, ${ring.count} seed(s) total) -- ` +
          `those seeds exchange matter/genomes with each other and are not independent replicates. This tool does not pool a ring's ` +
          `seeds as if they were; analyze the ring as a single unit (or extend analyzeEnsemble to group by ring) instead of running ` +
          `ensemble inference across its seeds.`,
      );
    }
  }
  // Pre-registered eligibility: only histories with exact conservation enter inference.
  const { eligible: runs, invalid } = partitionByConservation(loaded);
  if (!runs.length) throw new Error("no run passed the conservation check");
  const conditions = [...new Set(runs.map((r) => r.condition))].sort((x, y) => (x === "treatment" ? -1 : y === "treatment" ? 1 : x.localeCompare(y)));

  // ---- activity threshold ----
  // Two distinct numbers, never confused:
  //  - `threshold` is what this analysis actually feeds into every
  //    activity-based statistic below. For a preset registered in
  //    experiments/endpoints.ts's ACTIVITY_THRESHOLDS (gradient-m3, spots-m3)
  //    that is the FROZEN value from a dedicated neutral-only calibration
  //    pilot (tools/calibrate.ts), independent of which neutral seeds this
  //    ensemble happens to include. A preset absent from ACTIVITY_THRESHOLDS
  //    (or explicitly opted out via `options.ignoreFrozenThreshold`, see its
  //    own doc above) keeps the original in-sample behavior (this ensemble's
  //    own neutral runs), labelled exploratory.
  //  - the in-sample neutral quantile, computed from this ensemble's own
  //    neutral runs the same way it always was, is ALWAYS also reported (when
  //    neutral runs exist) as a labelled diagnostic -- informative, but never
  //    fed into any endpoint once a preset has a frozen threshold.
  const presetId = runs[0].manifest.spec.presetId;
  // The opt-out exists only for synthetic ensembles (tools/nullcal.ts): a real
  // bundle must never escape its registered threshold's provenance, schedule,
  // seed and quantile checks. Synthetic manifests carry a `nullcal` record and
  // no founder provenance; anything else is refused.
  if (options.ignoreFrozenThreshold) {
    const real = runs.find((r) => !r.manifest.nullcal || r.manifest.presetIdentity !== undefined || r.manifest.initHash !== undefined);
    if (real) throw new Error(`ignoreFrozenThreshold is only for synthetic (nullcal) ensembles; ${real.condition} seed ${real.seed} under ${label} is not one`);
  }
  const activityThresholds: Record<string, ActivityThresholdEntry> = options.ignoreFrozenThreshold ? {} : (options.registry?.thresholds ?? ACTIVITY_THRESHOLDS);
  // A registry override is for its own registered presets only; anything else would silently fall back
  // to an in-sample (exploratory) threshold under the registry's banner.
  if (options.registry && !options.registry.thresholds[presetId]) throw new Error(`preset "${presetId}" is not registered in the requested threshold registry`);
  const frozen = activityThresholds[presetId];

  // ---- provenance (Astra review, 2026-09-27, item 1) ----
  // A registered preset's frozen threshold depends on the calibration pilot's
  // runs actually having the founders/config current code expects -- not just
  // on their spec.presetId *label* matching. ensembleProblems above only ever
  // compares WorldConfig fields (never founder content), so a run recorded
  // under a mismatched founder set could pass ensemble validation outright
  // and still be pooled into every activity statistic. Checked here, before
  // anything else in this ensemble is trusted for a registered preset; an
  // exploratory (unregistered, or explicitly bypassed) preset never needs
  // this and keeps working without it, including against bundles from before
  // this provenance was recorded at all, or a synthetic ensemble that never
  // carries it (tools/nullcal.ts).
  if (frozen) {
    const problems = provenanceProblems(runs, presetId);
    if (problems.length)
      throw new Error(
        `runs under ${label} cannot use preset "${presetId}"'s registered activity threshold -- provenance check failed:\n  ${problems.slice(0, 40).join("\n  ")}`,
      );
  }

  // ---- neutral threshold ----
  // Replays every census (from series.jsonl), including empty ones after an
  // extinction, so extinct lineages leave the present set at the right time.
  const neutralRuns = runs.filter((r) => r.condition === "neutral");
  const neutralActs: number[] = [];
  for (const r of neutralRuns) for (const x of (await activities(r)).tracker.allActivities()) neutralActs.push(x);
  const inSampleNeutralQuantile = neutralActs.length > 0 ? quantile(neutralActs, 0.95) : null;

  // This ensemble's own rule/schema/metrics versions (guaranteed identical
  // across every loaded run by ensembleProblems above, so any one run's
  // manifest speaks for the whole ensemble) and its preset's CURRENT identity
  // (packages/schema/src/presets.ts's presetIdentity, recomputed fresh from
  // the code actually running right now -- never trusted from any stored
  // value) -- compared against a registered preset's recorded pilot metadata
  // by decideActivityThreshold (Astra review, 2026-09-27, P1/item 2).
  const currentPreset = PRESETS.find((p) => p.id === presetId);
  // A preset id absent from @bl/schema's PRESETS can still reach here (an
  // ensemble from an older/renamed preset, or a synthetic nullcal ensemble)
  // -- decideActivityThreshold only ever compares these against a
  // *registered* threshold's recorded identity, and a preset unknown to the
  // current code can never match a real digest, so this correctly refuses
  // rather than throwing here.
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
  const outcome = decideActivityThreshold(presetId, activityThresholds, runs[0].manifest.spec, options.q ?? 0.95, neutralActs, ensembleIdentity, ensembleSeeds);
  if (outcome.kind === "refuse") throw new Error(outcome.reason);
  const { mode: thresholdMode, q, calibrated, threshold, unavailableReason } = outcome.decision;

  // ---- per-run statistics ----
  type Stats = Record<string, number>;
  const perRun = new Map<Run, Stats>();
  const trends = new Map<Run, string>();
  // A run loaded without `reduceRun` (tools/nullcal.ts, `loadEnsemble`) is digested here, once.
  const digests = new Map<Run, SeriesDigest>();
  const digestOf = (r: DigestedRun): SeriesDigest => {
    if (r.digest) return r.digest;
    let d = digests.get(r);
    if (!d) digests.set(r, (d = digestSeries(r.series, r.manifest.spec.deepEvery)));
    return d;
  };
  /** Runs (pooled across the whole ensemble) excluded or too short per held-out observable, for the rendered report. */
  const trendDiagnostics = new Map<string, { ok: number; excluded: number; short: number }>();
  const tally = (key: keyof SeriesDigest["trends"], d: SeriesDigest) => {
    const out = d.trends[key];
    const diag = trendDiagnostics.get(key) ?? { ok: 0, excluded: 0, short: 0 };
    diag[out.status]++;
    trendDiagnostics.set(key, diag);
    return out.slope;
  };
  for (const r of runs) {
    const { snaps } = await activities(r, threshold);
    const d = digestOf(r);
    const last = snaps[snaps.length - 1];
    const t = snaps.map((s) => s.step);
    const cum = snaps.map((s) => s.cumulativeNew);
    const g = t.length > 5 ? growthVsSaturation(t, cum) : null;
    if (g && calibrated) trends.set(r, g.verdict);
    perRun.set(r, {
      cumulativeNewActivity: calibrated ? (last?.cumulativeNew ?? 0) : NaN,
      newActivityRate: calibrated && last ? (last.cumulativeNew / Math.max(1, last.step)) * 1e5 : NaN,
      meanSignificant: calibrated ? mean(snaps.map((s) => s.significant)) : NaN,
      ...d.avg,
      // Held-out trend statistics (experiments/endpoints.ts: HELD_OUT_SPECS),
      // scaled per 1e5 steps.
      temporalMITrend: tally("temporalMI", d),
      patternEntropyTrend: tally("patternEntropy", d),
      lineageCompressionTrend: tally("lineageCompression", d),
      differentiationTrend: tally("differentiation", d),
      compartmentalisedTrend: tally("compartmentalised", d),
      rolesPresentTrend: tally("rolesPresent", d),
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

  let md = `# Ensemble report: ${label}\n\n`;
  md += options.generatedAt ? `Generated ${options.generatedAt} from ${runs.length} eligible runs.\n\n` : `Generated from ${runs.length} eligible runs.\n\n`;
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
        `"${presetId}" has no registered, frozen threshold${options.ignoreFrozenThreshold ? " in effect for this ensemble" : ""}): **${fmt(threshold)}** cell-censuses.\n\n`
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
    series: digestOf(r).roles,
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
      ? `preset "${presetId}" is not registered in ACTIVITY_THRESHOLDS${options.ignoreFrozenThreshold ? ", or this ensemble opted out of its registered threshold," : ""} so the "frozen threshold" text in endpoint 1's ` +
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
  // Three-valued outcome: "supported" once >= minSupported are established;
  // "not-supported" only when even the OPTIMISTIC bound (`optimisticCount`:
  // every missing slot in the shared family recomputed at p=0, not just the
  // currently-unavailable observables credited as a flat pass) could not
  // reach minSupported -- some directional observables may still be
  // individually unavailable even in this case, since completing their data
  // isn't what the bound assumes; otherwise "unavailable" -- missing
  // evidence, not a negative.
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

  // ---- sensitivity: role-share cut x0.5 / x2 (pre-registration, "Known limitations") ----
  // Roles hold at least ROLE_CUT of living cells (roleSummary's minShare).
  // series.jsonl records every role's share on deep censuses, so the cut is
  // re-applied after the fact and every result that depends on it (endpoint 4
  // and its M5 gate row, the held-out role count and the held-out summary) is
  // re-evaluated unchanged. Re-applying the registered 5% cut must reproduce
  // the recorded rolesPresent exactly, or the sensitivity is withheld. The
  // re-cut statistics themselves come from each run's digest (`digestSeries`).
  const recutMismatch = runs.find((r) => settle(digestOf(r).recutMismatch));
  const coexistenceEndpoints = PRIMARY_ENDPOINTS.filter((e) => e.kind === "coexistence");
  const roleCutSensitivity = recutMismatch
    ? { unavailable: `recorded role shares of ${recutMismatch.condition} seed ${recutMismatch.seed} do not reproduce its rolesPresent at the ${ROLE_CUT} cut` }
    : SENSITIVITY_CUTS.map((cut, j) => {
      const altViews: RunView[] = runs.map((r, i) => {
        const alt = settle(digestOf(r).recut[j]);
        return {
          ...views[i],
          stats: { ...views[i].stats, rolesPresent: alt.rolesPresent, rolesPresentTrend: alt.rolesPresentTrend },
          series: alt.roles,
        };
      });
      const alt = evaluateHeldOut(altViews, presetId);
      const roleCount = alt.results.find((x) => x.id === "held-out-role-count");
      return {
        cut,
        coexistence: coexistenceEndpoints.map((e) => evaluateEndpoint(e, altViews)),
        heldOutRoleCount: roleCount ? { available: roleCount.available, supported: roleCount.supported } : null,
        heldOutOutcome: alt.summary.outcome,
      };
    });
  md += `\n## Sensitivity: role-share cut (×0.5, ×2; pre-registered)\n\n`;
  if ("unavailable" in roleCutSensitivity) md += `Unavailable: ${roleCutSensitivity.unavailable}.\n`;
  else {
    const coexRow = (r: EndpointResult) =>
      r.kind === "coexistence"
        ? `${r.qualifying}/${r.total}${r.total ? (r.supported ? " (supported)" : " (not supported)") : ""}` +
          (r.gate ? `; M5 gate ≥${r.gate.minRoles} roles ${r.gate.qualifying}/${r.gate.total}${r.gate.supported ? " (supported)" : " (not supported)"}` : "")
        : "—";
    const registeredRoleCount = heldOut.results.find((x) => x.id === "held-out-role-count");
    const rows = [
      { cut: ROLE_CUT, coexistence: results.filter((r) => r.kind === "coexistence"), heldOutRoleCount: registeredRoleCount ? { available: registeredRoleCount.available, supported: registeredRoleCount.supported } : null, heldOutOutcome: heldOut.summary.outcome },
      ...roleCutSensitivity,
    ].sort((a, b) => a.cut - b.cut);
    md += `Endpoint 4, the held-out role count and the held-out summary re-evaluated with roles needing at least the given share of living cells (registered cut ${100 * ROLE_CUT}%).\n\n`;
    md += `| role cut | endpoint 4: treatment runs qualifying | held-out role count | held-out summary |\n|---|---|---|---|\n`;
    for (const row of rows) {
      const rc = row.heldOutRoleCount ? (row.heldOutRoleCount.available ? (row.heldOutRoleCount.supported ? "supported" : "not supported") : "unavailable") : "—";
      md += `| ${(100 * row.cut).toFixed(1)}%${row.cut === ROLE_CUT ? " (registered)" : ""} | ${row.coexistence.map(coexRow).join("; ")} | ${rc} | ${row.heldOutOutcome} |\n`;
    }
  }
  md += `\nIndividual-threshold sensitivity (B+P ≥ 48, ≥ 256 quanta) is not performed: those thresholds are applied by the tracker during the run (pre-registration, "Known limitations").\n`;

  // ---- heredity (descriptive; pre-registration, "Reproduction and heredity") ----
  // Sibling correlation of Lenia growth parameters at fission: the two pieces
  // are unordered, so each pair enters both ways (double-entry, i.e.
  // intraclass) Pearson correlation. Pooled over a condition's fissions, and
  // the median of per-run correlations, which between-run differences cannot
  // inflate. Pairs come packed (`packPairs`), runs concatenated in order;
  // columns k and k+1 are the two pieces' values.
  const siblingCorrelation = (chunks: Float64Array[], k: 0 | 2): number => {
    const n = chunks.reduce((s, c) => s + c.length / 4, 0);
    if (n < 3) return NaN;
    // mean() of every piece's value in pair order (a0, b0, a1, b1, ...): the same left-to-right sum.
    let sum = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i += 4) {
        sum += c[i + k];
        sum += c[i + k + 1];
      }
    }
    const m = sum / (2 * n);
    let num = 0, den = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i += 4) {
        const a = c[i + k], b = c[i + k + 1];
        num += 2 * (a - m) * (b - m);
        den += (a - m) ** 2 + (b - m) ** 2;
      }
    }
    return den > 0 ? num / den : NaN;
  };
  const heredityByRun = new Map<Run, Float64Array>();
  for (const r of runs) {
    const pairs = await packedPairsOf(r);
    if (pairs) heredityByRun.set(r, pairs);
  }
  const median = (xs: number[]) => (xs.length ? quantile(xs, 0.5) : NaN);
  const heredity = conditions.map((c) => {
    const rs = runs.filter((r) => r.condition === c && heredityByRun.has(r));
    const chunks = rs.map((r) => heredityByRun.get(r)!);
    const perRun = (k: 0 | 2) => chunks.map((p) => siblingCorrelation([p], k)).filter(Number.isFinite);
    return {
      condition: c,
      runs: rs.length,
      fissions: chunks.reduce((s, p) => s + p.length / 4, 0),
      muPooled: siblingCorrelation(chunks, 0),
      sigmaPooled: siblingCorrelation(chunks, 2),
      muMedianRun: median(perRun(0)),
      sigmaMedianRun: median(perRun(2)),
    };
  }).filter((h) => h.runs > 0);
  if (heredity.length) {
    md += `\n## Heredity (descriptive; pre-registered)\n\n`;
    md += `Sibling correlation (double-entry Pearson) of the Lenia growth parameters μ and σ between the two pieces of each fission (\`heredity.tsv\`): pooled over the condition's fissions, and the median of per-run correlations.\n\n`;
    md += `| condition | runs | fissions | μ pooled | σ pooled | μ median per run | σ median per run |\n|---|---|---|---|---|---|---|\n`;
    for (const h of heredity) md += `| ${h.condition} | ${h.runs} | ${h.fissions} | ${fmt(h.muPooled)} | ${fmt(h.sigmaPooled)} | ${fmt(h.muMedianRun)} | ${fmt(h.sigmaMedianRun)} |\n`;
  }

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
  const charts: { file: string; svg: string }[] = [];
  function chart(j: number) {
    const { title, file } = CHARTS[j];
    const W = 720, H = 260, P = 40;
    const colors = ["#1a7f55", "#c2410c", "#2563eb", "#9333ea", "#ca8a04", "#0891b2", "#be123c"];
    let xmax = 1, ymin = Infinity, ymax = -Infinity;
    const lines = runs.map((r) => {
      const d = digestOf(r);
      const ys = settle(d.charts[j]);
      ys.forEach((y, i) => {
        if (!Number.isFinite(y)) return;
        xmax = Math.max(xmax, d.steps[i]);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
      });
      return { r, steps: d.steps, ys };
    });
    if (!Number.isFinite(ymin)) return "";
    if (ymax === ymin) ymax = ymin + 1;
    const sx = (x: number) => P + (x / xmax) * (W - 2 * P);
    const sy = (y: number) => H - P - ((y - ymin) / (ymax - ymin)) * (H - 2 * P);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui" font-size="11"><rect width="100%" height="100%" fill="#fff"/>`;
    svg += `<text x="${P}" y="18" font-size="13" font-weight="600">${title}</text>`;
    svg += `<text x="${P}" y="${H - 10}" fill="#666">0</text><text x="${W - P}" y="${H - 10}" text-anchor="end" fill="#666">${xmax.toLocaleString()} steps</text>`;
    svg += `<text x="${P - 4}" y="${sy(ymax) + 4}" text-anchor="end" fill="#666">${fmt(ymax)}</text><text x="${P - 4}" y="${sy(ymin) + 4}" text-anchor="end" fill="#666">${fmt(ymin)}</text>`;
    for (const { r, steps, ys } of lines) {
      const col = colors[conditions.indexOf(r.condition) % colors.length];
      const pts: string[] = [];
      ys.forEach((y, i) => {
        if (Number.isFinite(y)) pts.push(`${sx(steps[i]).toFixed(1)},${sy(y).toFixed(1)}`);
      });
      svg += `<polyline fill="none" stroke="${col}" stroke-opacity="0.8" stroke-width="1.4" points="${pts.join(" ")}"/>`;
    }
    conditions.forEach((c, i) => {
      svg += `<rect x="${W - P - 150}" y="${28 + i * 14}" width="10" height="10" fill="${colors[i % colors.length]}"/><text x="${W - P - 135}" y="${37 + i * 14}">${c}</text>`;
    });
    svg += `</svg>`;
    charts.push({ file, svg });
    return `![${title}](${file})\n\n`;
  }
  md += `\n## Time series\n\n`;
  CHARTS.forEach((_, j) => (md += chart(j)));

  const json = {
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
    roleCutSensitivity,
    heredity,
    runs: runs.map((r) => ({ condition: r.condition, seed: r.seed, trend: trends.get(r), stats: perRun.get(r) })),
  };
  if (!options.registry) return { markdown: md, json, results, heldOut, charts };
  // A registered secondary analysis: every endpoint section is secondary and descriptive.
  const secondaryMd =
    options.registry.note +
    md
      .replace("\n## Primary endpoints (pre-registered)\n", "\n## Endpoints (registered secondary analysis; descriptive)\n")
      .replace("\n## Held-out observables (pre-registered, confirmatory -- 2026-09-26 amendment)\n", "\n## Held-out observables (registered secondary analysis; descriptive)\n");
  return { markdown: secondaryMd, json: { analysis: "registered secondary (10^7 extension); descriptive", ...json } as typeof json, results, heldOut, charts };
}

// ---------------------------------------------------------------------------
// CLI (thin).
// ---------------------------------------------------------------------------
if (import.meta.main) {
  // Deno-only, dynamically imported: a static top-level import of a `jsr:`
  // specifier would fail as soon as Node/vitest imports this module for
  // `analyzeEnsemble` (experiments/test/nullgen.test.ts), even though that
  // import never runs the CLI body.
  const { parseArgs } = await import("jsr:@std/cli@1/parse-args");
  const a = parseArgs(Deno.args, {
    string: ["out", "q", "registry"],
    boolean: ["ignore-frozen-threshold"],
    default: { q: "0.95", "ignore-frozen-threshold": false },
  });
  const root = String(a._[0] ?? "");
  if (!root) throw new Error("usage: analyze.ts runs/<experiment>/<preset>");
  const outDir = a.out ?? `${root}/report`;

  if (a.registry !== undefined && a.registry !== "extension") throw new Error(`--registry must be "extension" (the registered 10^7 extension); got ${a.registry}`);
  const registry = a.registry === "extension" ? await import("../experiments/extension.ts").then((m) => ({ thresholds: m.EXTENSION_ACTIVITY_THRESHOLDS, note: m.EXTENSION_REPORT_NOTE })) : undefined;
  // Each run is digested as it loads, so only one parsed series.jsonl is held at a time.
  const loaded = await loadRunsUnder(root, reduceRun);
  if (!loaded.length) throw new Error(`no completed runs under ${root}`);
  const { markdown, json, charts } = await analyzeEnsemble(loaded, root, {
    q: Number(a.q ?? "0.95"),
    generatedAt: new Date().toISOString(),
    ignoreFrozenThreshold: Boolean(a["ignore-frozen-threshold"]),
    ...(registry ? { registry } : {}),
  });

  await Deno.mkdir(outDir, { recursive: true });
  for (const c of charts) await Deno.writeTextFile(`${outDir}/${c.file}`, c.svg);
  await Deno.writeTextFile(`${outDir}/report.md`, markdown);
  await Deno.writeTextFile(`${outDir}/report.json`, JSON.stringify(json, null, 2));
  console.log(markdown.split("## Time series")[0]);
  console.log(`wrote ${outDir}/report.md`);
}
