// Renderer for the "biogeography" track (`tools/biogeo-analyze.ts` +
// `tools/biogeo-sweep.ts`; see
// experiments/biogeography-island.md). SMOKE status only -- no saved real
// run exists yet; the input is a smoke-scale `report.json` (written by
// `tools/biogeo-analyze.ts`, unmodified -- it already writes machine-readable
// JSON, no new `--json` flag needed) paired with the `experiment.json`
// sibling `tools/biogeo-sweep.ts` writes next to the run directories
// `report.json` was built from.
//
// Two distinct input files, joined by `runId` (see `joinMigrationRate`
// below) because `perRunHistories` -- unlike the isolation computation just
// above it inside `biogeo-analyze.ts` -- does not carry a per-run migration
// rate through; Fig 2's x-axis has to be recovered from `experiment.json`'s
// own `runs[].migrationRate` instead. No new statistic anywhere in this file
// -- every number rendered is read directly off `report`/`experiment`, or
// (for the species-area curve) recomputed via the exact
// `exp(logC) * area^z` the producer's own fit already defines.
import {
  caveatParagraph,
  caveatsSection,
  escapeHtml,
  figure,
  header,
  keyNumbersList,
  numbersTable,
  pageShell,
  type KeyNumberItem,
} from "./page.ts";
import { axis, forestPlot, lineSeries, linearScale, logScale, niceTicks, num } from "./svg.ts";
import type { RenderMeta } from "../../report-html.ts";

// ---------------------------------------------------------------------
// Input shape, field by field from tools/biogeo-analyze.ts /
// tools/biogeo-sweep.ts / packages/metrics/src/biogeography.ts.
// ---------------------------------------------------------------------

export type AreaCondition = "treatment" | "no-migration";

export interface SpeciesAreaFit {
  z: number;
  logC: number;
  ci: [number, number] | null;
  r2: number;
  n: number;
  excludedZeros: number;
  zs: number[];
}

export type AreaFitOrError = SpeciesAreaFit | { error: string };

export interface MeanByRateRow {
  rate: number;
  mean: number;
  /** `null` on disk when only one observation was eligible at this rate --
   * a sample SD is undefined for n=1 (the producer's in-memory value is
   * NaN, which `JSON.stringify` writes as the JSON literal `null`, the same
   * NaN-to-null pattern documented on `BestRateVsNoMigration.effect` and
   * `IsolationSummary.trendCorrelation` above). Rendered as an unavailable
   * uncertainty, never coerced to 0. */
  sd: number | null;
  n: number;
}

export interface BestRateVsNoMigration {
  rate: number | null | undefined;
  n: number;
  W: number;
  /** `null` on disk when every positive-rate run failed eligibility, so the
   * producer had no comparison to compute a p-value from -- `JSON.stringify`
   * writes that in-memory NaN as the JSON literal `null`, the same pattern as
   * `effect` below. A real smoke-scale run has produced this. */
  p: number | null;
  pGreater: number;
  exact: boolean;
  exploratory: true;
  /** `null` for the same reason as `p` above -- Holm-adjusts a p-value that
   * doesn't exist yet. */
  holmAdjustedP: number | null;
  /** `null` on disk when the in-memory value was NaN (e.g. a degenerate,
   * zero-variance comparison) -- `JSON.stringify(NaN)` writes the JSON
   * literal `null`, so a `report.json` read back off disk can carry `null`
   * here even though the producer's own in-memory type is plain `number`.
   * Seen in a real smoke-scale run, not just a theoretical case. */
  effect: number | null;
}

export interface IsolationSummary {
  meanByRate: MeanByRateRow[];
  /** `null` on disk when `pearson()` was NaN (e.g. every compared
   * observation has identical richness, leaving no variance to correlate
   * against rate) -- see `BestRateVsNoMigration.effect`'s doc for why a
   * NaN producer value surfaces as JSON `null` after a real run's
   * `report.json` is written and re-read. */
  trendCorrelation: number | null;
  trendN: number;
  trendCI: [number, number] | null;
  bestRateVsNoMigration: BestRateVsNoMigration;
}

export type IsolationOrError = IsolationSummary | { error: string };

export interface TurnoverSummaryRow {
  run: string;
  tile: number;
  crossingStep: number | null;
  equilibriumRichness: number | null;
}

export interface PerRunHistoryRow {
  runId: string;
  arms: string[];
  condition: AreaCondition;
  seed: number;
  area: number;
  richness: number;
  /** Per-tile turnover detail -- not read directly by this renderer, which
   * sources Fig 3 from the already-flattened `report.turnoverSummary`
   * instead; only checked for presence by `validate`. */
  turnover: unknown;
}

export interface PerAreaExtinctionRow {
  condition: string;
  area: number;
  n: number;
  extinct: number;
  extinctionRate: number;
}

export interface FoundingDensityRow {
  area: number;
  occupiedFraction: number;
  founderCellsPerTileEstimate: number;
}

export interface LivingTransferRow {
  rate: number;
  n: number;
  meanLivingTransferFraction: number | null;
}

export interface BiogeoAnalyzeReport {
  root: string;
  experiment: string;
  eligibleRuns: number;
  rejectedRuns: { runId: string; problems: string[] }[];
  areaFits: Record<string, AreaFitOrError>;
  isolation: IsolationOrError | null;
  turnoverSummary: TurnoverSummaryRow[];
  diagnostics: {
    perAreaExtinction: PerAreaExtinctionRow[];
    foundingDensityByArea: FoundingDensityRow[];
    livingTransferByRate: LivingTransferRow[];
  };
  perRunHistories: PerRunHistoryRow[];
}

export interface ExperimentRunRef {
  runId: string;
  migrationRate: number;
}

export interface ExperimentManifestShape {
  experiment: string;
  migrationPeriod: number;
  runs: ExperimentRunRef[];
  /** Present on a real experiment.json (buildExperimentManifest) -- read only
   * for the header's "Steps"/"Seeds" Key numbers items (see
   * `buildKeyNumbers` below); optional so a hand-trimmed fixture that omits
   * them still validates and renders, just with those two items "unavailable". */
  steps?: number;
  seeds?: number[];
}

export interface BiogeographyReport {
  report: BiogeoAnalyzeReport;
  experiment: ExperimentManifestShape;
}

// ---------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNullableFiniteNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

function assertAreaFit(value: unknown, path: string): asserts value is AreaFitOrError {
  if (!isRecord(value)) throw new Error(`biogeography: ${path} must be an object, got ${JSON.stringify(value)}`);
  if (typeof value.error === "string") return;
  if (
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.logC) ||
    !isFiniteNumber(value.r2) ||
    !isFiniteNumber(value.n) ||
    !isFiniteNumber(value.excludedZeros) ||
    !Array.isArray(value.zs)
  ) {
    throw new Error(`biogeography: ${path} is neither {error} nor a well-formed SpeciesAreaFit (z/logC/r2/n/excludedZeros numbers, zs array), got ${JSON.stringify(value)}`);
  }
  if (value.ci !== null && !(Array.isArray(value.ci) && value.ci.length === 2 && value.ci.every(isFiniteNumber))) {
    throw new Error(`biogeography: ${path}.ci must be null or a [number, number] pair, got ${JSON.stringify(value.ci)}`);
  }
}

function assertIsolation(value: unknown): asserts value is IsolationOrError | null {
  if (value === null) return;
  if (!isRecord(value)) throw new Error(`biogeography: report.isolation must be null or an object, got ${JSON.stringify(value)}`);
  if (typeof value.error === "string") return;
  if (
    !Array.isArray(value.meanByRate) ||
    !value.meanByRate.every(
      (r) => isRecord(r) && isFiniteNumber(r.rate) && isFiniteNumber(r.mean) && isNullableFiniteNumber(r.sd) && isFiniteNumber(r.n),
    )
  ) {
    throw new Error(
      `biogeography: report.isolation.meanByRate must be an array of {rate,mean,n} numbers with sd a number or null (null when only one observation was eligible at that rate), got ${JSON.stringify(value.meanByRate)}`,
    );
  }
  // trendCorrelation's in-memory producer type is plain `number`, but a NaN
  // value (e.g. zero variance across the compared observations) serializes
  // through JSON.stringify as the literal `null` -- so a real report.json
  // read off disk can carry `null` here, and this validator must accept both
  // that on-disk shape and a literal in-memory NaN.
  if (
    !isFiniteNumber(value.trendCorrelation) &&
    value.trendCorrelation !== null &&
    !(typeof value.trendCorrelation === "number" && Number.isNaN(value.trendCorrelation))
  ) {
    throw new Error(`biogeography: report.isolation.trendCorrelation must be a finite number, null, or NaN, got ${JSON.stringify(value.trendCorrelation)}`);
  }
  if (!isFiniteNumber(value.trendN)) throw new Error(`biogeography: report.isolation.trendN must be a finite number, got ${JSON.stringify(value.trendN)}`);
  if (value.trendCI !== null && !(Array.isArray(value.trendCI) && value.trendCI.length === 2 && value.trendCI.every(isFiniteNumber))) {
    throw new Error(`biogeography: report.isolation.trendCI must be null or a [number, number] pair, got ${JSON.stringify(value.trendCI)}`);
  }
  // `p`/`holmAdjustedP` are nullable: when every positive-rate run fails
  // eligibility, the producer has no comparison to compute a p-value from at
  // all and serializes both as `null`: a valid
  // report, not a malformed one, and rendered as "unavailable" below.
  const best = value.bestRateVsNoMigration;
  if (
    !isRecord(best) ||
    !isNullableFiniteNumber(best.p) ||
    !isNullableFiniteNumber(best.holmAdjustedP) ||
    !isNullableFiniteNumber(best.effect)
  ) {
    throw new Error(`biogeography: report.isolation.bestRateVsNoMigration must have a finite-or-null p/holmAdjustedP/effect, got ${JSON.stringify(best)}`);
  }
}

export function validate(data: unknown): asserts data is BiogeographyReport {
  if (!isRecord(data)) throw new Error(`biogeography: expected an object combining {report, experiment}, got ${JSON.stringify(data)}`);
  const { report, experiment } = data as { report?: unknown; experiment?: unknown };
  if (!isRecord(report)) throw new Error(`biogeography: missing or malformed "report" (biogeo-analyze.ts's report.json)`);
  if (!isRecord(experiment)) throw new Error(`biogeography: missing or malformed "experiment" (biogeo-sweep.ts's experiment.json)`);

  if (!isRecord(report.areaFits)) throw new Error(`biogeography: report.areaFits must be an object keyed by condition, got ${JSON.stringify(report.areaFits)}`);
  for (const [cond, fit] of Object.entries(report.areaFits)) assertAreaFit(fit, `report.areaFits[${JSON.stringify(cond)}]`);

  assertIsolation(report.isolation);

  if (!Array.isArray(report.perRunHistories)) throw new Error(`biogeography: report.perRunHistories must be an array, got ${JSON.stringify(report.perRunHistories)}`);
  report.perRunHistories.forEach((row, i) => {
    if (
      !isRecord(row) ||
      typeof row.runId !== "string" ||
      !Array.isArray(row.arms) ||
      typeof row.condition !== "string" ||
      !isFiniteNumber(row.seed) ||
      !isFiniteNumber(row.area) ||
      !isFiniteNumber(row.richness) ||
      !("turnover" in row)
    ) {
      throw new Error(`biogeography: report.perRunHistories[${i}] must have {runId,arms,condition,seed,area,richness,turnover}, got ${JSON.stringify(row)}`);
    }
  });

  if (!Array.isArray(report.turnoverSummary)) throw new Error(`biogeography: report.turnoverSummary must be an array, got ${JSON.stringify(report.turnoverSummary)}`);
  report.turnoverSummary.forEach((row, i) => {
    if (!isRecord(row) || typeof row.run !== "string" || !isFiniteNumber(row.tile) || !isNullableFiniteNumber(row.crossingStep) || !isNullableFiniteNumber(row.equilibriumRichness)) {
      throw new Error(`biogeography: report.turnoverSummary[${i}] must have {run,tile,crossingStep:number|null,equilibriumRichness:number|null}, got ${JSON.stringify(row)}`);
    }
  });

  if (!isFiniteNumber(experiment.migrationPeriod)) throw new Error(`biogeography: experiment.migrationPeriod must be a finite number, got ${JSON.stringify(experiment.migrationPeriod)}`);
  if (!Array.isArray(experiment.runs) || !experiment.runs.every((r) => isRecord(r) && typeof r.runId === "string" && isFiniteNumber(r.migrationRate))) {
    throw new Error(`biogeography: experiment.runs must be an array of {runId,migrationRate}, got ${JSON.stringify(experiment.runs)}`);
  }

  // The one join this renderer performs: every isolation-arm perRunHistories
  // row must have a matching experiment.runs entry to recover its migration
  // rate (Fig 2's x-axis) -- a missing join target throws here, named,
  // rather than the renderer later plotting undefined/NaN.
  const expRunIds = new Set((experiment.runs as { runId: string }[]).map((r) => r.runId));
  for (const row of report.perRunHistories as PerRunHistoryRow[]) {
    if (row.arms.includes("isolation") && !expRunIds.has(row.runId)) {
      throw new Error(
        `biogeography: perRunHistories isolation-arm run ${JSON.stringify(row.runId)} has no matching entry in experiment.json's runs -- cannot recover its migration rate for Fig 2`,
      );
    }
  }
}

// ---------------------------------------------------------------------
// render
// ---------------------------------------------------------------------

function fmt(v: number, decimals = 3): string {
  return v.toFixed(decimals);
}

/** Formats a `[lower, upper]` CI, or "CI unavailable" with no guessed cause
 * when it's `null` -- used for both the species-area fit's bootstrap CI on
 * `z` and the isolation trend's CI. States only what the input establishes:
 * the value, or that it is unavailable, never a guessed cause. */
function fmtCiOrUnavailable(ci: [number, number] | null, decimals = 3): string {
  return ci ? `[${fmt(ci[0], decimals)}, ${fmt(ci[1], decimals)}]` : "CI unavailable";
}

/** Key-numbers formatting: a missing value reads "unavailable", never "n/a". */
function keyNum(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "unavailable" : fmtNullable(v);
}

function fmtNullable(v: number | null, decimals = 3): string {
  return v === null ? "n/a" : fmt(v, decimals);
}

/** Extends a LOG-scale domain outward to cover `niceTicks`' own rounded
 * `[first, last]` -- `niceTicks` can round a domain like `[3, 10]` out to a
 * tick as low as `2`, and building the scale from the un-extended `[3, 10]`
 * domain would place that tick's axis label/gridline outside the plotted
 * viewBox entirely. Ticks that round to <=0 are dropped (a log scale cannot
 * place them), matching this file's existing filter. */
function niceLogDomainAndTicks(domain: [number, number], count = 5): { domain: [number, number]; ticks: number[] } {
  const ticks = niceTicks(domain, count).filter((t) => t > 0);
  if (ticks.length < 2) return { domain, ticks: [domain[0], domain[1]] };
  const extended: [number, number] = [Math.min(domain[0], ticks[0]), Math.max(domain[1], ticks[ticks.length - 1])];
  return { domain: extended, ticks };
}

/** The linear-scale equivalent of `niceLogDomainAndTicks` above (and of
 * individuality.ts's `domainAndTicks`): extends the domain (never the ticks
 * themselves) to cover every rounded tick, so no axis label/gridline ever
 * lands outside the plotted viewBox. */
function niceLinearDomainAndTicks(values: number[], count = 5): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const ticks = niceTicks([lo, hi], count);
  const domain: [number, number] = [Math.min(lo, ticks[0]), Math.max(hi, ticks[ticks.length - 1])];
  return { domain, ticks };
}

const CONDITIONS: readonly AreaCondition[] = ["treatment", "no-migration"];
const CONDITION_TOKEN: Record<AreaCondition, string> = { treatment: "--accent", "no-migration": "--accent2" };

interface AreaPoint {
  area: number;
  seed: number;
  richness: number;
  condition: AreaCondition;
}

function areaPoints(report: BiogeoAnalyzeReport): AreaPoint[] {
  return report.perRunHistories
    .filter((r) => r.arms.includes("area"))
    .map((r) => ({ area: r.area, seed: r.seed, richness: r.richness, condition: r.condition }));
}

function fitCurve(fit: SpeciesAreaFit, area: number): number {
  return Math.exp(fit.logC) * Math.pow(area, fit.z);
}

/** Fig 1: species-area log-log scatter (one point per area-arm run) plus one
 * point-estimate fitted curve per condition -- deliberately no CI band (see
 * this module's header doc and packages/metrics/src/biogeography.ts's own
 * SpeciesAreaFit doc: the bootstrap CI is on `z` alone, with no paired
 * intercept/covariance, so there is no statistically honest way to turn it
 * into a band around the curve). The z point + CI is instead drawn as a text
 * annotation next to each condition's curve. Zero-richness (extinct) runs
 * cannot sit on a log y-axis (log(0) is undefined) and are excluded from the
 * fit itself (`excludedZeros`, reported in the table below) -- they are
 * still drawn, as an explicit open-diamond "extinct" marker on the x-axis
 * baseline, never silently dropped from the figure. */
function speciesAreaFigure(report: BiogeoAnalyzeReport): { svg: string; table: string } {
  const points = areaPoints(report);
  const areasAll = points.map((p) => p.area);
  const xDomain: [number, number] = areasAll.length
    ? [Math.min(...areasAll), Math.max(...areasAll)]
    : [1, 1];

  const fits: Partial<Record<AreaCondition, SpeciesAreaFit>> = {};
  const fitErrors: Partial<Record<AreaCondition, string>> = {};
  for (const cond of CONDITIONS) {
    const fit = report.areaFits[cond];
    if (!fit) {
      fitErrors[cond] = "no areaFits entry for this condition";
    } else if ("error" in fit) {
      fitErrors[cond] = fit.error;
    } else {
      fits[cond] = fit;
    }
  }

  const positivePoints = points.filter((p) => p.richness > 0);
  const curveEndpointVals: number[] = [];
  for (const cond of CONDITIONS) {
    const fit = fits[cond];
    if (fit) {
      curveEndpointVals.push(fitCurve(fit, xDomain[0]), fitCurve(fit, xDomain[1]));
    }
  }
  const yValsAll = [...positivePoints.map((p) => p.richness), ...curveEndpointVals].filter((v) => v > 0);
  const yDomain: [number, number] = yValsAll.length
    ? [Math.min(...yValsAll), Math.max(...yValsAll)]
    : [1, 1];

  const viewBox = { width: 720, height: 420 };
  // right=250 (not 190) leaves enough room for the longest condition
  // annotation string actually seen ("no-migration: z=0.677 [0.677, 0.909]",
  // ~38 chars) to sit inside the viewBox instead of running past its right
  // edge and getting clipped by the SVG viewport.
  const margin = { top: 24, right: 250, bottom: 56, left: 56 };
  const plotLeft = margin.left;
  const plotRight = viewBox.width - margin.right;
  const plotTop = margin.top;
  const plotBottom = viewBox.height - margin.bottom;

  const xTicks = [...new Set(areasAll)].sort((a, b) => a - b);
  const { domain: yDomainExtended, ticks: yTicks } = niceLogDomainAndTicks(yDomain, 5);

  const xScale = logScale(xDomain, [plotLeft, plotRight]);
  const yScale = logScale(yDomainExtended, [plotBottom, plotTop]);

  const parts: string[] = [];
  parts.push(
    axis({ orientation: "bottom", scale: xScale, ticks: xTicks, at: plotBottom, gridTo: plotTop, format: (v) => String(v), label: "island area (cells)", viewBox }),
  );
  parts.push(
    axis({ orientation: "left", scale: yScale, ticks: yTicks, at: plotLeft, gridTo: plotRight, format: (v) => fmt(v, 0), label: "genetic richness (log)", viewBox }),
  );

  // Fitted point-estimate curves, sampled evenly over the observed area range.
  let annotationY = plotTop + 10;
  for (const cond of CONDITIONS) {
    const color = `var(${CONDITION_TOKEN[cond]})`;
    const fit = fits[cond];
    if (fit) {
      const samples = 30;
      const pts: string[] = [];
      for (let i = 0; i <= samples; i++) {
        const area = xDomain[0] + ((xDomain[1] - xDomain[0]) * i) / samples;
        const richness = fitCurve(fit, area);
        pts.push(`${num(xScale(area))},${num(yScale(richness))}`);
      }
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" />`);
      parts.push(
        `<text x="${num(plotRight + 8)}" y="${num(annotationY)}" fill="${color}" font-size="11">${escapeHtml(cond)}: z=${fmt(fit.z)} ${escapeHtml(fmtCiOrUnavailable(fit.ci))}</text>`,
      );
    } else {
      parts.push(
        `<text x="${num(plotRight + 8)}" y="${num(annotationY)}" fill="${color}" font-size="11">${escapeHtml(cond)}: fit unavailable</text>`,
      );
    }
    annotationY += 16;
  }
  parts.push(`<text x="${num(plotRight + 8)}" y="${num(annotationY + 6)}" fill="var(--muted)" font-size="10">no CI band (z-only bootstrap,</text>`);
  parts.push(`<text x="${num(plotRight + 8)}" y="${num(annotationY + 18)}" fill="var(--muted)" font-size="10">no joint intercept)</text>`);

  // Scatter points -- positive richness only (log y-axis).
  for (const p of positivePoints) {
    const color = `var(${CONDITION_TOKEN[p.condition]})`;
    parts.push(`<circle cx="${num(xScale(p.area))}" cy="${num(yScale(p.richness))}" r="3.5" fill="${color}" fill-opacity="0.85" />`);
  }

  // Zero-richness (extinct) runs: cannot sit on a log axis -- drawn as an
  // explicit open-diamond marker just under the x-axis baseline, at the
  // correct x (area) position, never silently dropped.
  const extinctPoints = points.filter((p) => p.richness <= 0);
  for (const p of extinctPoints) {
    const color = `var(${CONDITION_TOKEN[p.condition]})`;
    const x = xScale(p.area);
    const y = plotBottom + 14;
    parts.push(`<rect x="${num(x - 4)}" y="${num(y - 4)}" width="8" height="8" transform="rotate(45 ${num(x)} ${num(y)})" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="2,2" />`);
  }
  if (extinctPoints.length > 0) {
    parts.push(`<text x="${num(plotLeft)}" y="${num(plotBottom + 34)}" fill="var(--muted)" font-size="10">◇ = extinct (richness 0, excluded from fit and from the log-log scatter above)</text>`);
  }

  const svg = `<svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;

  const fitRows = CONDITIONS.map((cond) => {
    const fit = fits[cond];
    if (fit) {
      return [cond, fmt(fit.z), fmtCiOrUnavailable(fit.ci), fmt(fit.logC), fmt(fit.r2), String(fit.n), String(fit.excludedZeros)];
    }
    return [cond, "n/a", "n/a", "n/a", "n/a", "n/a", fitErrors[cond] ?? "unavailable"];
  });
  const fitTable = numbersTable(["condition", "z", "z 95% CI", "logC", "r2", "n (fit points)", "excludedZeros / error"], fitRows);

  const pointRows = [...points]
    .sort((a, b) => a.condition.localeCompare(b.condition) || a.area - b.area || a.seed - b.seed)
    .map((p) => [p.condition, String(p.area), String(p.seed), String(p.richness)]);
  const pointsTable = numbersTable(["condition", "area", "seed", "richness"], pointRows);

  return { svg, table: `${fitTable}\n${pointsTable}` };
}

interface IsolationPoint {
  seed: number;
  rate: number;
  richness: number;
}

/** Joins each isolation-arm `perRunHistories` row to `experiment.runs` to
 * recover its migration rate, then computes the packet rate exactly the way
 * `biogeo-analyze.ts`'s own `packetRate` helper does
 * (`migrationRate / migrationPeriod`, 0 for the no-migration control) -- no
 * new statistic, just re-deriving the x-coordinate the producer already
 * used internally but did not carry into `perRunHistories`. `validate`
 * already guarantees every isolation-arm row has a matching `experiment.runs`
 * entry; this throws the same named error defensively if called on
 * unvalidated data. */
function isolationPoints(data: BiogeographyReport): IsolationPoint[] {
  const { report, experiment } = data;
  const byRunId = new Map(experiment.runs.map((r) => [r.runId, r]));
  return report.perRunHistories
    .filter((r) => r.arms.includes("isolation"))
    .map((r) => {
      const exp = byRunId.get(r.runId);
      if (!exp) {
        throw new Error(`biogeography: perRunHistories isolation-arm run ${JSON.stringify(r.runId)} has no matching entry in experiment.json's runs`);
      }
      const rate = r.condition === "no-migration" ? 0 : exp.migrationRate / experiment.migrationPeriod;
      return { seed: r.seed, rate, richness: r.richness };
    });
}

/** Fig 2: richness vs. migration (packet) rate, one line per seed connecting
 * its points across rates (including the rate-0 no-migration control),
 * overlaid with `isolation.meanByRate`'s bold mean+-SD marker per rate.
 * `isolation.trendCorrelation`/`trendCI` and `bestRateVsNoMigration` are
 * annotated as text/table values, explicitly labelled exploratory where the
 * source data says so -- never implied as an additional decision rule. */
function isolationFigure(data: BiogeographyReport): { svg: string; table: string } {
  const { report } = data;
  const points = isolationPoints(data);
  const isolation = report.isolation && !("error" in report.isolation) ? report.isolation : null;
  const isolationError = report.isolation && "error" in report.isolation ? report.isolation.error : null;

  const bySeed = new Map<number, { x: number; y: number }[]>();
  for (const p of points) bySeed.set(p.seed, [...(bySeed.get(p.seed) ?? []), { x: p.rate, y: p.richness }]);

  const overlayVals: number[] = [];
  if (isolation) {
    for (const m of isolation.meanByRate) {
      if (m.sd !== null) overlayVals.push(m.mean - m.sd, m.mean + m.sd);
      else overlayVals.push(m.mean);
    }
  }

  const allX = points.map((p) => p.rate);
  const allY = [...points.map((p) => p.richness), ...overlayVals];
  const { domain: xDomain, ticks: xTicks } = niceLinearDomainAndTicks(allX.length ? allX : [0, 1], 5);
  const { domain: yDomain, ticks: yTicks } = niceLinearDomainAndTicks(allY.length ? allY : [0, 1], 5);

  const viewBox = { width: 720, height: 400 };
  const margin = { top: 24, right: 32, bottom: 48, left: 56 };
  const xScale = linearScale(xDomain, [margin.left, viewBox.width - margin.right]);
  const yScale = linearScale(yDomain, [viewBox.height - margin.bottom, margin.top]);

  const lines = [...bySeed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seed, pts]) => ({ id: `seed-${seed}`, points: pts, label: `seed ${seed}` }));

  const svg = lineSeries({
    viewBox,
    margin,
    lines,
    xScale,
    yScale,
    xTicks,
    yTicks,
    xFormat: (v) => fmt(v, 3),
    yFormat: (v) => fmt(v, 0),
    xLabel: "migration (packet) rate",
    yLabel: "genetic richness",
    overlay: isolation ? isolation.meanByRate.map((m) => ({ x: m.rate, y: m.mean, sd: m.sd ?? undefined, colorToken: "--ink" })) : [],
  });

  const pointRows = [...points]
    .sort((a, b) => a.seed - b.seed || a.rate - b.rate)
    .map((p) => [String(p.seed), fmt(p.rate, 3), String(p.richness)]);
  const pointsTable = numbersTable(["seed", "rate", "richness"], pointRows);

  let summaryTable: string;
  if (isolation) {
    const rateRows = isolation.meanByRate.map((m) => [fmt(m.rate, 3), fmt(m.mean), fmtNullable(m.sd), String(m.n)]);
    const rateTable = numbersTable(["rate", "mean richness", "sd (unavailable at n=1)", "n"], rateRows);
    const best = isolation.bestRateVsNoMigration;
    const trendTable = numbersTable(
      ["trend r (seed-blocked)", "trend n", "trend 95% CI", "best rate (exploratory)", "best p", "best Holm p", "best effect"],
      [[
        fmtNullable(isolation.trendCorrelation),
        String(isolation.trendN),
        fmtCiOrUnavailable(isolation.trendCI),
        best.rate == null ? "n/a" : fmt(best.rate, 3),
        fmtNullable(best.p),
        fmtNullable(best.holmAdjustedP),
        fmtNullable(best.effect),
      ]],
    );
    summaryTable = `${rateTable}\n${trendTable}`;
  } else {
    summaryTable = numbersTable(["status"], [[isolationError ? `isolation analysis unavailable: ${isolationError}` : "no isolation-arm runs in this report"]]);
  }

  return { svg, table: `${pointsTable}\n${summaryTable}` };
}

/** Which condition (treatment/no-migration) a `turnoverSummary` row's `run`
 * id belongs to, recovered by joining to `report.perRunHistories` (the one
 * place a run id and its condition are recorded together) -- never guessed
 * from the run id string itself. */
function conditionForRun(report: BiogeoAnalyzeReport, runId: string): string {
  return report.perRunHistories.find((r) => r.runId === runId)?.condition ?? "unknown";
}

/** Counts, by condition, how many tiles reached the turnoverEquilibrium
 * criterion out of how many were run -- the compact summary shown instead of
 * a per-tile chart when no tile reached equilibrium (see `turnoverFigure`). */
function turnoverCountsByCondition(report: BiogeoAnalyzeReport): { condition: string; reached: number; total: number }[] {
  const byCond = new Map<string, { reached: number; total: number }>();
  for (const r of report.turnoverSummary) {
    const cond = conditionForRun(report, r.run);
    const cur = byCond.get(cond) ?? { reached: 0, total: 0 };
    cur.total++;
    if (r.crossingStep !== null) cur.reached++;
    byCond.set(cond, cur);
  }
  return [...byCond.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([condition, c]) => ({ condition, ...c }));
}

/** A compact counts-only summary (no per-tile rows), used by `turnoverFigure`
 * in place of a forest-plot chart when there is nothing to plot -- e.g. every
 * tile in a smoke-scale run is too short-lived to reach equilibrium. A
 * per-tile chart with dozens of unavailable-glyph rows and not one real mark
 * communicates nothing a two-row counts table doesn't already say. */
function turnoverCountsSummarySvg(counts: { condition: string; reached: number; total: number }[]): string {
  const rowH = 40;
  const margin = { top: 34, right: 90, bottom: 16, left: 160 };
  const viewBox = { width: 720, height: margin.top + Math.max(1, counts.length) * rowH + margin.bottom };
  const barMax = viewBox.width - margin.left - margin.right;
  const parts: string[] = [
    `<text x="${num(margin.left)}" y="20" fill="var(--muted)" font-size="12">tiles reaching turnover equilibrium, by condition</text>`,
  ];
  counts.forEach((c, i) => {
    const y = margin.top + i * rowH;
    const frac = c.total > 0 ? c.reached / c.total : 0;
    const barW = barMax * frac;
    parts.push(
      `<text x="${num(margin.left - 8)}" y="${num(y + 14)}" text-anchor="end" fill="var(--ink)" font-size="12">${escapeHtml(c.condition)}</text>`,
    );
    parts.push(`<rect x="${num(margin.left)}" y="${num(y)}" width="${num(barMax)}" height="18" fill="none" stroke="var(--rule)" stroke-width="1" />`);
    if (barW > 0) {
      parts.push(`<rect x="${num(margin.left)}" y="${num(y)}" width="${num(barW)}" height="18" fill="var(--accent2)" fill-opacity="0.85" />`);
    }
    parts.push(
      `<text x="${num(margin.left + barMax + 8)}" y="${num(y + 14)}" fill="var(--ink)" font-size="12">${c.reached}/${c.total}</text>`,
    );
  });
  return `<svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

/** Fig 3: colonization/extinction turnover per run x tile, from
 * `report.turnoverSummary` (founder-set based -- `founderPersistenceSets`,
 * a different estimand from the geneticRichness Figures 1/2 use; see
 * tools/biogeo-analyze.ts's `runTurnoverFromSpecies`). When at least one tile
 * reached the turnoverEquilibrium criterion, reuses `forestPlot`'s row
 * layout (x position is `crossingStep`, the step at which the smoothed
 * extinction rate first durably caught up with colonization), restricted to
 * the tiles that actually reached it -- a tile that never reached it adds
 * nothing to a chart by rendering as an unavailable glyph, and the full list
 * (reached or not) is always in the table below. When NO tile reached
 * equilibrium, there is nothing to plot as a per-tile chart at all; renders a
 * compact reached/total counts summary by condition instead. */
function turnoverFigure(report: BiogeoAnalyzeReport): { svg: string; table: string; caption: string } {
  const rows = report.turnoverSummary;
  const reached = rows.filter((r) => r.crossingStep !== null);

  if (reached.length === 0) {
    // Nothing reached equilibrium, so a per-tile table would be rows.length
    // rows that all say the same thing ("no equilibrium reached") -- exactly
    // the clutter this branch exists to avoid. Collapse it to the same
    // reached/total counts the chart shows, by condition.
    const counts = turnoverCountsByCondition(report);
    const svg = turnoverCountsSummarySvg(counts);
    const table = numbersTable(
      ["condition", "tiles reaching equilibrium", "tiles total"],
      counts.map((c) => [c.condition, String(c.reached), String(c.total)]),
    );
    const caption =
      "No tile in this run reached the turnoverEquilibrium criterion (the step at which the smoothed extinction rate durably caught up with colonization), so there is nothing to plot as a per-tile chart; a per-tile table would repeat the same value for every row. The table below collapses that to reached/total counts by condition instead.";
    return { svg, table, caption };
  }

  const table = numbersTable(
    ["run", "tile", "crossing step", "equilibrium richness"],
    rows.map((r) => [r.run, String(r.tile), r.crossingStep === null ? "no equilibrium reached" : fmt(r.crossingStep, 0), fmtNullable(r.equilibriumRichness, 2)]),
  );

  const observedSteps = reached.map((r) => r.crossingStep as number);
  const { domain: xDomain, ticks: xTicks } = niceLinearDomainAndTicks([0, ...observedSteps], 5);
  const viewBox = { width: 720, height: Math.max(160, 36 * reached.length + 60) };
  const margin = { top: 16, right: 24, bottom: 40, left: 200 };
  const xScale = linearScale(xDomain, [margin.left, viewBox.width - margin.right]);

  const svg = forestPlot({
    viewBox,
    margin,
    rows: reached.map((r) => ({
      label: `${r.run} / tile ${r.tile}`,
      point: r.crossingStep,
      colorToken: "--accent2",
    })),
    xScale,
    xTicks,
    xFormat: (v) => fmt(v, 0),
    xLabel: "step at which turnover reached equilibrium",
  });

  const caption =
    "Founder-set turnover per run x tile, restricted to the tiles that reached the turnoverEquilibrium criterion; x position is that crossing step. Tiles that never reached it are listed in the table below as \"no equilibrium reached\", not plotted as a zero-valued or dropped point, and are not shown in the chart above. Equilibrium richness (the mean richness over the qualifying tail, not the richness at the crossing step) is in the table, not encoded in the plot.";

  return { svg, table, caption };
}

/** Purely mechanical DATA STATUS note: the eligible-run count, nothing else
 * -- no evaluative word ("not a result", "not ecologically meaningful"). The
 * single per-status sentence (`page.ts`'s `STATUS_SENTENCE`) is where
 * PILOT/SMOKE's meaning lives. */
function statusNote(report: BiogeoAnalyzeReport): string {
  const runs = report.eligibleRuns;
  return `${runs} run${runs === 1 ? "" : "s"}`;
}

/** Builds the header's "Key numbers" list entirely mechanically from
 * `report`/`experiment`: per condition, the species-area fit's z+CI and its
 * n fit points (or "unavailable" when there is no fit); the seed-blocked
 * isolation trend r and its CI; the exploratory best-rate-vs-no-migration
 * comparison; and the run's own scale (eligible runs, steps, seeds, areas
 * swept). No claim about ecological meaning (see page.ts's rule). */
function buildKeyNumbers(report: BiogeoAnalyzeReport, experiment: ExperimentManifestShape): KeyNumberItem[] {
  const items: KeyNumberItem[] = [];

  for (const cond of CONDITIONS) {
    const fit = report.areaFits[cond];
    if (fit && !("error" in fit)) {
      items.push({ label: `z (95% CI), ${cond}`, value: `${fmt(fit.z)} ${fmtCiOrUnavailable(fit.ci)}` });
      items.push({ label: `n fit points, ${cond}`, value: String(fit.n) });
    } else {
      items.push({ label: `z (95% CI), ${cond}`, value: "unavailable" });
      items.push({ label: `n fit points, ${cond}`, value: "unavailable" });
    }
  }

  const isolation = report.isolation && !("error" in report.isolation) ? report.isolation : null;
  items.push({ label: "Trend r (seed-blocked)", value: isolation ? keyNum(isolation.trendCorrelation) : "unavailable" });
  items.push({ label: "Trend 95% CI (seed-blocked)", value: isolation ? fmtCiOrUnavailable(isolation.trendCI) : "unavailable" });

  if (isolation) {
    const best = isolation.bestRateVsNoMigration;
    items.push({
      label: "Best rate vs no-migration (exploratory)",
      value: best.rate == null
        ? "unavailable"
        : `rate ${fmt(best.rate, 3)}, p ${keyNum(best.p)}, Holm p ${keyNum(best.holmAdjustedP)}, effect ${keyNum(best.effect)}`,
    });
  } else {
    items.push({ label: "Best rate vs no-migration (exploratory)", value: "unavailable" });
  }

  items.push({ label: "Eligible runs", value: String(report.eligibleRuns) });
  items.push({
    label: "Steps",
    value: typeof experiment.steps === "number" ? String(experiment.steps) : "unavailable",
  });
  items.push({
    label: "Seeds",
    value: Array.isArray(experiment.seeds) ? String(experiment.seeds.length) : "unavailable",
  });
  const areas = report.diagnostics.foundingDensityByArea.map((a) => a.area);
  items.push({ label: "Areas (cells)", value: areas.length ? areas.join(", ") : "unavailable" });

  return items;
}

export function render(data: BiogeographyReport, meta: RenderMeta): string {
  const fig1 = speciesAreaFigure(data.report);
  const fig2 = isolationFigure(data);
  const fig3 = turnoverFigure(data.report);

  const headerHtml = header({
    title: "Island Biogeography",
    question: "Does colony richness scale with island area, and respond to migration rate, in a closed-metacommunity archipelago?",
    status: meta.status,
    statusNote: statusNote(data.report),
    sources: meta.sources,
    keyNumbers: keyNumbersList(buildKeyNumbers(data.report, data.experiment)),
  });

  const figuresHtml = [
    figure(1, fig1.svg, "Species-area log-log scatter: one point per (area, seed) run, fitted point-estimate curve (exp(logC)*area^z) over the observed area range for each condition whose fit succeeded, no CI band (the bootstrap CI is on z alone, with no joint intercept). Zero-richness runs are excluded from the fit and shown as an open diamond below the axis, never as a fabricated log(0) point.", fig1.table),
    figure(2, fig2.svg, `Genetic richness vs. migration (packet) rate: one line per seed, connecting its points across rates (including the rate-0 no-migration control when it has eligible runs)${data.report.isolation && !("error" in data.report.isolation) ? ", overlaid with the mean and, where n>1, the SD per rate. The seed-blocked trend correlation and the exploratory best-rate-vs-no-migration comparison are reported in the table, not drawn as an implied additional test." : ". The isolation analysis did not run for this input (see the table), so no mean, SD or trend is drawn."}`, fig2.table),
    figure(3, fig3.svg, fig3.caption, fig3.table),
  ].join("\n");

  const caveats = caveatsSection("Caveats", [
    caveatParagraph(
      "Closed metacommunity: every island starts with the full founder pool, so this measures within-pool sorting, not colonization from an open source pool. A migration \"packet\" moves a whole cell, not an individual, so the migration rate plotted here is a packet-transfer rate, not an observed immigration rate.",
    ),
    caveatParagraph(
      "founderPersistence and geneticRichness are two different estimands and can disagree on the same data (nearest-fixed-anchor classification vs. real single-linkage clustering). Figures 1 and 2 (the species-area fit and the isolation trend) use geneticRichness; Figure 3's turnover is founder-set based (founderPersistenceSets), a different estimand, so a tile's founder-persistence turnover can change without a corresponding change in genetic-cluster richness.",
    ),
    caveatParagraph(
      "The species-area fit excludes zero-richness RUNS from its regression (reported as excludedZeros in Fig 1's table); but the isolation analysis does NOT exclude zero-richness observations: a migration rate driving richness to 0 is itself part of what isolationEffect measures. These are two different inclusion rules for two different figures, not one blanket \"zero-richness excluded\" rule.",
    ),
    caveatParagraph("See experiments/biogeography-island.md for the full method this page visualises."),
  ]);

  const body = [headerHtml, figuresHtml, caveats].join("\n");
  return pageShell({ title: "Island Biogeography", bodyHtml: body });
}
