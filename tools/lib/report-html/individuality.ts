// Renders the "individuality" track's report.json (tools/individuality.ts
// + packages/metrics/src/individuality.ts) into the
// "Colony Individuality" report page. See
// packages/metrics/src/individuality.ts for the
// producer's own doc comments on `crossWorldNull`'s exact/Monte-Carlo split
// and the bias-corrected `nonClosure` statistic.
//
// Kept intentionally data-driven rather than hard-coding real8's specific
// numbers: the finding sentence, status coloring, and both tables are all
// computed from whatever `IndividualityReport` is actually passed in, so a
// future rerun (or a trimmed fixture) renders its own true numbers rather
// than a copy of today's.
import {
  caveatParagraph,
  caveatsSection,
  figure,
  header,
  keyNumbersList,
  numbersTable,
  pageShell,
  type DataStatus,
  type KeyNumberItem,
  type SourceRef,
} from "./page.ts";
import {
  forestPlot,
  linearScale,
  niceTicks,
  slopegraph,
  type ForestRow,
  type SlopegraphPair,
} from "./svg.ts";

/**
 * Matches tools/report-html.ts's `RenderMeta` shape structurally. This
 * module deliberately never imports report-html.ts itself: that file is a
 * Deno CLI script ending in a top-level `await main()`, and even a type-only
 * import of it risks a bundler/runtime resolving the whole module graph (and
 * `jsr:@std/cli` isn't resolvable under vitest/Node anyway) just to check a
 * renderer module's types.
 */
export interface RenderMeta {
  sources: SourceRef[];
  status: DataStatus;
}

// ---------------------------------------------------------------------------
// Input shape (report.json). Field by field from the two producer source files above. Fields
// this renderer never reads (`occupancy`, `jointMI`, `environmentMI`,
// `autonomyGivenE`, `ntic`, `pid`, per-row `binSource`, the two
// `pidUniqueE`/`pidSynergy` Holm entries, and the top-level `disagreements`/
// `disagreementSkipped`/`profiles` alphabet metadata) are typed loosely or
// left optional so a small hand-trimmed fixture doesn't need to fabricate
// values for quantities no figure or table on this page plots.
// ---------------------------------------------------------------------------

export interface CiStat {
  point: number;
  lower: number;
  upper: number;
  draws: number;
  alpha: number;
  /** `"uncalibrated"` below `minCalibratedWorlds` analysis worlds -- a
   * descriptive resampling range, not a confidence interval. */
  status: "ci" | "uncalibrated";
}

export interface CrossWorldNullTest {
  observed: number;
  perWorld: number[];
  nullMeans: number[];
  /** true: `nullMeans` is the full R!-enumerated permutation space (R<=8,
   * packages/metrics/src/individuality.ts's EXACT_PERMUTATION_MAX_N); false:
   * `nullMeans` is a Monte Carlo sample of `nullDraws` (default 2000)
   * permutations. */
  exact: boolean;
  /** Raw, one-sided (upper-tail) empirical permutation p -- already exactly
   * what this page states; never re-derived from `perWorld`/`nullMeans`. */
  p: number;
  worlds: number;
}

/** `nonClosure`'s (and `pid.uniqueE`'s / `pid.synergy`'s, not read here)
 * shape: a bias-corrected CI plus its cross-world permutation null test. */
export interface CiWithNullTest {
  ci: CiStat;
  nullTest: CrossWorldNullTest;
}

export interface ProfileDefault {
  worlds: number;
  excludedWorlds: number;
  autonomyStar: CiStat;
  nonClosure: CiWithNullTest;
  // Present on every real profile but not read by this renderer -- see file
  // header. Kept optional so fixtures don't need to fabricate them.
  windowLength?: number;
  occupancy?: { sTable: number; jointTable: number };
  jointMI?: CiStat;
  environmentMI?: CiStat;
  autonomyGivenE?: CiStat;
  ntic?: CiStat;
  pid?: {
    redundancy: CiStat;
    uniqueS: CiStat;
    uniqueE: CiWithNullTest;
    synergy?: CiWithNullTest;
  };
}

export type ProfileName = "default" | "coarse";

export interface HolmAdjusted {
  nonClosure: number;
  // Present on every real row's nullTestsHolm.default but not read by this
  // page (only the default-profile nonClosure column is shown, matching
  // report.md's own table) -- optional so fixtures can omit them.
  pidUniqueE?: number;
  pidSynergy?: number;
}

export interface IndividualityRow {
  kind: "genetic-cluster" | "component" | "colony";
  id: string;
  founders?: number[];
  /** Analysis-world count this row's aggregate was eligible in. 0 or 1 means
   * `profiles` is `{}` (`individualityReport` throws below 2 worlds --
   * packages/metrics/src/individuality.ts:611-612 -- so
   * tools/individuality.ts's `analyzeAnchor` never populates a profile
   * object at all for those rows, not just an uncalibrated one). */
  worlds: number;
  excludedWorlds: number;
  /** EMPTY (`{}`, no `default` key) when `worlds < 2` -- see above. Present
   * with every CI's `status: "uncalibrated"` when
   * `2 <= worlds < minCalibratedWorlds`. */
  profiles: Partial<Record<ProfileName, ProfileDefault>>;
  binSource?: unknown;
  /** Present (possibly `{}`) even on a row with no `profiles.default` --
   * treated as absent there too by this renderer. */
  nullTestsHolm?: Partial<Record<ProfileName, HolmAdjusted>>;
}

export interface IndividualityConfig {
  windowStart: number;
  windowSteps: number;
  /** R: the number of analysis worlds every row's `worlds`/`excludedWorlds`
   * is measured against. */
  worlds: number;
  calibrationWorlds: number;
  bootstrapDraws?: number;
  tile?: number;
  founders?: number;
  seed?: number;
  ringWidth?: number;
}

export interface IndividualityReport {
  config: IndividualityConfig;
  calibrationSeeds?: number[];
  /** Analysis-world threshold (`MIN_CALIBRATED_WORLDS`) below which a row's
   * CIs are `status: "uncalibrated"` resampling ranges rather than real CIs. */
  minCalibratedWorlds: number;
  /** Per-profile alphabet metadata (|S|/|E| sizes, etc.) -- not read by this
   * renderer. */
  profiles?: unknown;
  founderGeneticClusters?: number[];
  /** Size of the full declared cross-world-null test family this run's Holm
   * correction was computed over (every aggregate x profile x
   * {nonClosure, PID uniqueE, PID synergy} with >=2 eligible worlds). */
  holmFamilySize: number;
  rows: IndividualityRow[];
  /** Exploratory, uncorrected pairwise comparison table -- mentioned only in
   * a caveat, never plotted. */
  disagreements?: unknown[];
  disagreementSkipped?: unknown[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function requireNumber(x: unknown, path: string): asserts x is number {
  if (typeof x !== "number") throw new Error(`individuality: ${path} must be a number, got ${JSON.stringify(x)}`);
}

function requireCiStatShape(x: unknown, path: string): void {
  if (!isRecord(x)) throw new Error(`individuality: ${path} must be an object`);
  requireNumber(x.point, `${path}.point`);
  requireNumber(x.lower, `${path}.lower`);
  requireNumber(x.upper, `${path}.upper`);
  if (typeof x.status !== "string") throw new Error(`individuality: ${path}.status must be a string`);
}

/** Requires the nested `{ci,nullTest}` shape that `CiWithNullTest`/
 * `ProfileDefault.nonClosure` actually declare, and that every render-side
 * accessor (`buildNonClosureFigure`, `buildPermutationFigure`,
 * `buildKeyNumbers`) assumes via `row.profiles.default.nonClosure.ci`/
 * `.nullTest`. A bare `CiStat` shape one level too shallow (no `.ci`/
 * `.nullTest` at all) must be rejected here, not accepted defensively --
 * accepting it would let a malformed `report.json` pass validation and then
 * crash the renderer on `undefined.point`. */
function requireNonClosureShape(x: unknown, path: string): void {
  if (!isRecord(x)) throw new Error(`individuality: ${path} must be an object`);
  if (!isRecord(x.ci)) throw new Error(`individuality: ${path}.ci must be an object`);
  requireCiStatShape(x.ci, `${path}.ci`);
  if (!isRecord(x.nullTest) || typeof x.nullTest.p !== "number") {
    throw new Error(`individuality: ${path}.nullTest.p must be a number`);
  }
}

export function validate(data: unknown): asserts data is IndividualityReport {
  if (!isRecord(data)) throw new Error("individuality: report must be an object");

  if (!isRecord(data.config)) throw new Error("individuality: report.config must be an object");
  requireNumber(data.config.worlds, "report.config.worlds");
  requireNumber(data.config.calibrationWorlds, "report.config.calibrationWorlds");

  requireNumber(data.minCalibratedWorlds, "report.minCalibratedWorlds");
  requireNumber(data.holmFamilySize, "report.holmFamilySize");

  if (!Array.isArray(data.rows)) throw new Error("individuality: report.rows must be an array");
  data.rows.forEach((row, i) => {
    const path = `rows[${i}]`;
    if (!isRecord(row)) throw new Error(`individuality: ${path} must be an object`);
    if (typeof row.kind !== "string") throw new Error(`individuality: ${path}.kind must be a string`);
    if (typeof row.id !== "string") throw new Error(`individuality: ${path}.id must be a string`);
    requireNumber(row.worlds, `${path}.worlds`);
    requireNumber(row.excludedWorlds, `${path}.excludedWorlds`);
    if (!isRecord(row.profiles)) throw new Error(`individuality: ${path}.profiles must be an object`);

    const def = row.profiles.default;
    // A row with no `profiles.default` at all (worlds<2) is valid input --
    // it renders as "no eligible worlds", never a validation error.
    if (def === undefined) return;
    if (!isRecord(def)) throw new Error(`individuality: ${path}.profiles.default must be an object`);
    if (!isRecord(def.autonomyStar) || typeof def.autonomyStar.point !== "number") {
      throw new Error(`individuality: ${path}.profiles.default.autonomyStar.point must be a number`);
    }
    requireNonClosureShape(def.nonClosure, `${path}.profiles.default.nonClosure`);

    // `profiles.coarse` is optional (most reports only ever populate
    // `default`), but when a row DOES carry one, it must have the same
    // {autonomyStar, nonClosure} shape -- checked here so the Key numbers'
    // coarse-profile item (see `buildKeyNumbers`) never crashes on a
    // malformed coarse profile instead of failing validation with a named
    // error.
    const coarse = row.profiles.coarse;
    if (coarse !== undefined) {
      if (!isRecord(coarse)) throw new Error(`individuality: ${path}.profiles.coarse must be an object`);
      if (!isRecord(coarse.autonomyStar) || typeof coarse.autonomyStar.point !== "number") {
        throw new Error(`individuality: ${path}.profiles.coarse.autonomyStar.point must be a number`);
      }
      requireNonClosureShape(coarse.nonClosure, `${path}.profiles.coarse.nonClosure`);
    }
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmt(v: number, decimals = 3): string {
  return v.toFixed(decimals);
}

function fmtCi(point: number, lower: number, upper: number, decimals = 3): string {
  return `${fmt(point, decimals)} [${fmt(lower, decimals)}, ${fmt(upper, decimals)}]`;
}

function rowLabel(row: IndividualityRow): string {
  return `${row.kind} ${row.id}`;
}

function hasDefaultProfile(row: IndividualityRow): row is IndividualityRow & { profiles: { default: ProfileDefault } } {
  return row.profiles.default !== undefined;
}

function noProfileNote(row: IndividualityRow): string {
  return row.worlds < 2 ? "no eligible worlds (worlds<2)" : "no default profile";
}

/** Computes "nice" ticks for `values`, then extends the scale domain (never
 * the ticks themselves) to cover every value exactly -- so a whisker
 * endpoint that falls outside the tick range still lands inside the drawn
 * axis instead of being clipped. */
function domainAndTicks(values: number[], count = 5): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const ticks = niceTicks([lo, hi], count);
  const domain: [number, number] = [Math.min(lo, ticks[0]), Math.max(hi, ticks[ticks.length - 1])];
  return { domain, ticks };
}

// A single shared width for every figure on this page -- Figure 3's
// slopegraph used to declare its own, much narrower viewBox (460), which
// left its text rendered far larger than Figures 1/2 once every figure is
// scaled to the same on-page width via CSS (`.fig-media svg { width:100% }`,
// tools/lib/report-html/page.ts): the same declared font-size renders at
// `containerWidth / viewBoxWidth` times its nominal size, so a narrower
// viewBox reads bigger. Every figure below shares this one constant so their
// effective font size matches.
const PLOT_WIDTH = 720;
const LEFT_MARGIN = 190;
const ROW_HEIGHT = 32;

function statusColorToken(status: "ci" | "uncalibrated"): string {
  return status === "uncalibrated" ? "--muted" : "--accent";
}

function buildAutonomyFigure(rows: IndividualityRow[], n: number): string {
  const eligible = rows.filter(hasDefaultProfile);
  const forestRows: ForestRow[] = eligible.map((row) => {
    const stat = row.profiles.default.autonomyStar;
    return {
      label: rowLabel(row),
      point: stat.point,
      lower: stat.lower,
      upper: stat.upper,
      colorToken: statusColorToken(stat.status),
    };
  });
  const allValues = forestRows.flatMap((r) => [r.point as number, r.lower as number, r.upper as number]);
  const { domain, ticks } = domainAndTicks(allValues.length ? allValues : [0, 1]);
  const height = 40 + Math.max(1, eligible.length) * ROW_HEIGHT;
  const svg = forestPlot({
    viewBox: { width: PLOT_WIDTH, height },
    margin: { top: 20, right: 30, bottom: 40, left: LEFT_MARGIN },
    rows: forestRows,
    xScale: linearScale(domain, [LEFT_MARGIN, PLOT_WIDTH - 30]),
    xTicks: ticks,
    xLabel: "autonomyStar",
  });
  const tableRows = rows.map((row) => [
    rowLabel(row),
    String(row.worlds),
    hasDefaultProfile(row)
      ? fmtCi(row.profiles.default.autonomyStar.point, row.profiles.default.autonomyStar.lower, row.profiles.default.autonomyStar.upper)
      : noProfileNote(row),
    hasDefaultProfile(row) ? row.profiles.default.autonomyStar.status : "n/a",
  ]);
  const table = numbersTable(["row", "worlds", "autonomyStar (point [lower, upper])", "status"], tableRows);
  return figure(
    n,
    svg,
    `autonomyStar per row, filtered to the ${eligible.length} of ${rows.length} rows with an eligible profile (worlds>=2). Point = bootstrap point estimate; whisker = its interval: a real 90% CI (accent) when the row is calibrated (worlds>=minCalibratedWorlds), or a descriptive resampling range, not a CI, when uncalibrated (muted). Rows with no eligible profile are listed in the table below, not plotted.`,
    table,
  );
}

function buildNonClosureFigure(rows: IndividualityRow[], n: number): string {
  const eligible = rows.filter(hasDefaultProfile);
  const forestRows: ForestRow[] = eligible.map((row) => {
    const stat = row.profiles.default.nonClosure.ci;
    return {
      label: rowLabel(row),
      point: stat.point,
      lower: stat.lower,
      upper: stat.upper,
      colorToken: statusColorToken(stat.status),
    };
  });
  const allValues = [0, ...forestRows.flatMap((r) => [r.point as number, r.lower as number, r.upper as number])];
  const { domain, ticks } = domainAndTicks(allValues);
  const height = 40 + Math.max(1, eligible.length) * ROW_HEIGHT;
  const svg = forestPlot({
    viewBox: { width: PLOT_WIDTH, height },
    margin: { top: 20, right: 30, bottom: 40, left: LEFT_MARGIN },
    rows: forestRows,
    xScale: linearScale(domain, [LEFT_MARGIN, PLOT_WIDTH - 30]),
    xTicks: ticks,
    xLabel: "nonClosure",
    referenceLines: [{ value: 0, label: "0" }],
  });
  const tableRows = rows.map((row) => {
    if (!hasDefaultProfile(row)) return [rowLabel(row), String(row.worlds), noProfileNote(row), "n/a", "n/a"];
    const nc = row.profiles.default.nonClosure;
    const holm = row.nullTestsHolm?.default?.nonClosure;
    return [
      rowLabel(row),
      String(row.worlds),
      fmtCi(nc.ci.point, nc.ci.lower, nc.ci.upper),
      fmt(nc.nullTest.p),
      holm === undefined ? "n/a" : fmt(holm),
    ];
  });
  const table = numbersTable(
    ["row", "worlds", "nonClosure (point [lower, upper])", "cross-world p (raw)", "Holm-adjusted p"],
    tableRows,
  );
  return figure(
    n,
    svg,
    `nonClosure per row, same filter as Figure 1, with a 0 reference line. An interval excluding 0 is not, by itself, evidence of S-E coupling; only the cross-world permutation test (Figure 3) is a decision rule; the interval is a bias-corrected point estimate and its resampling uncertainty.`,
    table,
  );
}

function buildPermutationFigure(rows: IndividualityRow[], n: number): string {
  const eligible = rows.filter(hasDefaultProfile);
  const pairs: SlopegraphPair[] = eligible.map((row) => {
    const nc = row.profiles.default.nonClosure;
    const holm = row.nullTestsHolm?.default?.nonClosure;
    return {
      label: rowLabel(row),
      left: nc.nullTest.p,
      right: holm === undefined ? null : holm,
      colorToken: statusColorToken(nc.ci.status),
    };
  });
  const yTicks = niceTicks([0, 1], 5);
  const svg = slopegraph({
    viewBox: { width: PLOT_WIDTH, height: 320 },
    margin: { top: 40, right: 200, bottom: 30, left: 200 },
    pairs,
    yScale: linearScale([0, 1], [280, 40]),
    yTicks,
    leftLabel: "raw p",
    rightLabel: "Holm-adjusted p",
    // The label is intentionally short: the full "reference only, not a
    // decision rule" explanation is already in this figure's caption below,
    // and referenceLine (svg.ts) places this label in the plot's right
    // margin, clear of the raw-p/Holm-p columns and their connecting lines.
    referenceLines: [{ value: 0.05, label: "0.05" }],
  });
  const tableRows = eligible.map((row) => {
    const nc = row.profiles.default.nonClosure;
    const holm = row.nullTestsHolm?.default?.nonClosure;
    return [rowLabel(row), fmt(nc.nullTest.p), holm === undefined ? "n/a" : fmt(holm)];
  });
  const table = numbersTable(["row", "cross-world p (raw)", "Holm-adjusted p"], tableRows);
  return figure(
    n,
    svg,
    `Raw, one-sided cross-world permutation p (stored directly, never re-derived) against its Holm-adjusted value over the full test family, for every row with an eligible profile. The 0.05 line is drawn for reference only; the decision rule is the Holm-adjusted value, not this line.`,
    table,
  );
}

/** Among rows carrying `profile`, the smallest `nullTestsHolm[profile].nonClosure`
 * value and the row it belongs to -- feeds the "Lowest Holm-adjusted
 * cross-world p" Key numbers item for that profile. `null` when no row in
 * this input has a Holm-adjusted nonClosure value for this profile. */
function lowestHolmNonClosure(
  rows: IndividualityRow[],
  profile: ProfileName,
): { value: number; row: IndividualityRow } | null {
  let best: { value: number; row: IndividualityRow } | null = null;
  for (const row of rows) {
    const v = row.nullTestsHolm?.[profile]?.nonClosure;
    if (typeof v !== "number") continue;
    if (best === null || v < best.value) best = { value: v, row };
  }
  return best;
}

/** Whether ANY row in this input carries the given profile at all -- gates
 * whether the coarse-profile Key numbers item is shown, so a report that
 * never populates `profiles.coarse` doesn't get a spurious "unavailable"
 * item for a profile it was never asked to compute. */
function hasProfile(rows: IndividualityRow[], profile: ProfileName): boolean {
  return rows.some((r) => r.profiles[profile] !== undefined);
}

/** Builds the header's "Key numbers" list entirely mechanically from
 * `data`: the lowest Holm-adjusted cross-world nonClosure p per profile
 * present in the input (paired with the row it belongs to), the Holm family
 * size, how many eligible nonClosure intervals exclude 0, and the
 * worlds/calibration-worlds counts from config. No interpretation of what
 * these facts mean (see page.ts's rule). */
function buildKeyNumbers(data: IndividualityReport): KeyNumberItem[] {
  const eligible = data.rows.filter(hasDefaultProfile);
  const excludingZero = eligible.filter((row) => {
    const ci = row.profiles.default.nonClosure.ci;
    return ci.lower > 0 || ci.upper < 0;
  });

  const items: KeyNumberItem[] = [];

  const defaultLowest = lowestHolmNonClosure(data.rows, "default");
  items.push({
    label: "Lowest Holm-adjusted cross-world p, default profile, nonClosure",
    value: defaultLowest ? `${fmt(defaultLowest.value)} (${rowLabel(defaultLowest.row)})` : "unavailable",
  });

  if (hasProfile(data.rows, "coarse")) {
    const coarseLowest = lowestHolmNonClosure(data.rows, "coarse");
    items.push({
      label: "Lowest Holm-adjusted cross-world p, coarse profile, nonClosure",
      value: coarseLowest ? `${fmt(coarseLowest.value)} (${rowLabel(coarseLowest.row)})` : "unavailable",
    });
  }

  items.push({ label: "Holm family size", value: String(data.holmFamilySize) });
  items.push({
    label: "nonClosure intervals excluding 0 (default profile)",
    value: `${excludingZero.length} of ${eligible.length}`,
  });
  items.push({ label: "Analysis worlds (R)", value: String(data.config.worlds) });
  items.push({ label: "Calibration worlds", value: String(data.config.calibrationWorlds) });

  return items;
}

export function render(data: IndividualityReport, meta: RenderMeta): string {
  const R = data.config.worlds;
  const bodyHtml = [
    header({
      title: "Colony Individuality",
      question:
        "Does any founder-cluster, component, or colony definition show autonomy from its environment beyond what cross-world random pairing would produce?",
      status: meta.status,
      statusNote: `R=${R} analysis worlds, bins frozen from ${data.config.calibrationWorlds} calibration worlds`,
      sources: meta.sources,
      keyNumbers: keyNumbersList(buildKeyNumbers(data)),
    }),
    buildAutonomyFigure(data.rows, 1),
    buildNonClosureFigure(data.rows, 2),
    buildPermutationFigure(data.rows, 3),
    caveatsSection("Caveats", [
      caveatParagraph(
        "Quantile bins are fit only from the calibration worlds and then frozen before analysis; the bootstrap-over-worlds CI and the cross-world permutation null above both resample/permute only the analysis worlds and never touch the bins.",
      ),
      caveatParagraph(
        'A row with fewer than 2 analysis worlds has no profile at all (not computed, not just uncalibrated); a row with at least 2 but fewer than the calibration threshold (minCalibratedWorlds) analysis worlds gets status "uncalibrated", a descriptive resampling range, not a confidence interval. These are two different "not a real result" cases, not one.',
      ),
      caveatParagraph(
        "A nonClosure interval excluding 0 is not, by itself, evidence of S-E coupling; only the Holm-adjusted cross-world permutation test above is treated as a decision rule.",
      ),
      caveatParagraph(
        "This page's disagreement table (not shown) recomputes some of the same quantities on smaller, pairwise-matched world subsets and is a separate, uncorrected, exploratory comparison; not part of the Holm-adjusted test family above.",
      ),
      caveatParagraph(
        "See docs/individuality-info-theory.md for the full estimand and inference rules this page visualises.",
      ),
    ]),
  ].join("\n");

  return pageShell({ title: "Colony Individuality", bodyHtml });
}
