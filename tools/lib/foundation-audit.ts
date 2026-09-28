/** Read-only summaries for the committed M4 ensemble reports. */

export type JsonObject = Record<string, unknown>;

export interface NumericSummary {
  available: number;
  unavailable: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export interface FoundationAuditCondition {
  condition: string;
  runs: number;
  trendCounts: Record<string, number>;
  rolesPresent: NumericSummary;
  rolesPresentTrend: NumericSummary;
  compartmentalised: NumericSummary;
  compartmentalisedTrend: NumericSummary;
}

export interface FoundationAuditHeredity {
  condition: string;
  runs: number | null;
  fissions: number | null;
  /** Exact stored fields: pooled and median-per-run sibling correlation. */
  muPooled: number | null;
  sigmaPooled: number | null;
  muMedianRun: number | null;
  sigmaMedianRun: number | null;
}

export interface FoundationAuditReport {
  presetId: string | null;
  declaredTreatmentRuns: number | null;
  runsListed: number;
  treatmentRunCoverage: { listed: number; declared: number | null };
  conditions: FoundationAuditCondition[];
  heredity: FoundationAuditHeredity[];
  limitations: string[];
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summary(values: unknown[]): NumericSummary {
  const numbers = values.map(finite).filter((n): n is number => n !== null);
  if (!numbers.length) {
    return { available: 0, unavailable: values.length, mean: null, min: null, max: null };
  }
  return {
    available: numbers.length,
    unavailable: values.length - numbers.length,
    mean: numbers.reduce((sum, n) => sum + n, 0) / numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

function countField(value: unknown): number | null {
  const n = finite(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Summarize report.json values only; this never opens or scans run bundles. */
export function summarizeFoundationReport(input: unknown): FoundationAuditReport {
  const root = object(input) ?? {};
  const listed = Array.isArray(root.runs) ? root.runs : [];
  const runs = listed.map(object).filter((row): row is JsonObject => row !== null);
  const conditions = [...new Set(runs.map((row) => typeof row.condition === "string" ? row.condition : "unavailable"))].sort();
  const byCondition: FoundationAuditCondition[] = conditions.map((condition) => {
    const rows = runs.filter((row) => (typeof row.condition === "string" ? row.condition : "unavailable") === condition);
    const stats = rows.map((row) => object(row.stats) ?? {});
    const trendCounts: Record<string, number> = {};
    for (const row of rows) {
      const trend = typeof row.trend === "string" && row.trend.length ? row.trend : "unavailable";
      trendCounts[trend] = (trendCounts[trend] ?? 0) + 1;
    }
    return {
      condition,
      runs: rows.length,
      trendCounts,
      rolesPresent: summary(stats.map((s) => s.rolesPresent)),
      rolesPresentTrend: summary(stats.map((s) => s.rolesPresentTrend)),
      compartmentalised: summary(stats.map((s) => s.compartmentalised)),
      compartmentalisedTrend: summary(stats.map((s) => s.compartmentalisedTrend)),
    };
  });

  const heredity: FoundationAuditHeredity[] = (Array.isArray(root.heredity) ? root.heredity : [])
    .map(object)
    .filter((row): row is JsonObject => row !== null)
    .map((row) => ({
      condition: typeof row.condition === "string" ? row.condition : "unavailable",
      runs: countField(row.runs),
      fissions: countField(row.fissions),
      muPooled: finite(row.muPooled),
      sigmaPooled: finite(row.sigmaPooled),
      muMedianRun: finite(row.muMedianRun),
      sigmaMedianRun: finite(row.sigmaMedianRun),
    }));

  const descriptive = object(root.m4Descriptive);
  const declaredTreatmentRuns = descriptive ? countField(descriptive.runs) : null;
  const treatmentListed = runs.filter((row) => row.condition === "treatment").length;
  return {
    presetId: typeof root.presetId === "string" ? root.presetId : null,
    declaredTreatmentRuns,
    runsListed: listed.length,
    treatmentRunCoverage: { listed: treatmentListed, declared: declaredTreatmentRuns },
    conditions: byCondition,
    heredity,
    limitations: [
      "Values summarize committed report.json run summaries; no raw run bundle or census series is read.",
      "compartmentalised is a per-run time average of scheduled deep-census observations. Because it is a nonnegative count, an exact zero mean implies every finite observation included in that mean was zero; this compact report cannot audit missing or omitted census observations or establish physical impossibility.",
      "Heredity fields are sibling Pearson correlations for fission pieces' μ and σ, pooled over fissions or median across runs. They are descriptive resemblance measures, not an estimate of heritability in the population-genetic sense.",
      "The listed treatment count can be compared with m4Descriptive.runs, but this report alone does not establish all-census coverage or explain missing raw observations.",
    ],
  };
}

function fmt(value: number | null): string {
  if (value === null) return "unavailable";
  if (value !== 0 && Math.abs(value) < 0.0005) return value.toExponential(2);
  return value.toFixed(3);
}

function numericCell(s: NumericSummary): string {
  return `${fmt(s.mean)} [${fmt(s.min)}, ${fmt(s.max)}]; n=${s.available}/${s.available + s.unavailable}`;
}

export function renderFoundationAuditMarkdown(label: string, report: FoundationAuditReport): string {
  const lines = [
    `## ${label} (${report.presetId ?? "preset unavailable"})`,
    "",
    `Runs listed: ${report.runsListed}. Treatment coverage: ${report.treatmentRunCoverage.listed}/${report.treatmentRunCoverage.declared ?? "unavailable"} listed report rows.`,
    "",
    "| condition | runs | run trend labels | rolesPresent mean [min, max]; n available/total | rolesPresentTrend mean [min, max]; n available/total | compartmentalised mean [min, max]; n available/total | compartmentalisedTrend mean [min, max]; n available/total |",
    "|---|---:|---|---|---|---|---|",
  ];
  for (const row of report.conditions) {
    lines.push(`| ${row.condition} | ${row.runs} | ${Object.entries(row.trendCounts).map(([k, v]) => `${k}: ${v}`).join(", ")} | ${numericCell(row.rolesPresent)} | ${numericCell(row.rolesPresentTrend)} | ${numericCell(row.compartmentalised)} | ${numericCell(row.compartmentalisedTrend)} |`);
  }
  lines.push("", "### Heredity fields stored in the report", "", "Sibling μ/σ Pearson correlations; `runs` and `fissions` are the stored sample counts. These describe sibling resemblance, not population-genetic heritability.", "", "| condition | runs | fissions | muPooled | sigmaPooled | muMedianRun | sigmaMedianRun |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const row of report.heredity) {
    lines.push(`| ${row.condition} | ${row.runs ?? "unavailable"} | ${row.fissions ?? "unavailable"} | ${fmt(row.muPooled)} | ${fmt(row.sigmaPooled)} | ${fmt(row.muMedianRun)} | ${fmt(row.sigmaMedianRun)} |`);
  }
  lines.push("", ...report.limitations.map((limitation) => `- ${limitation}`), "");
  return lines.join("\n");
}
