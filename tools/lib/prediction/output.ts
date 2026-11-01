// Builds the canonical output files (PLAN.md, section 9) as strings, a pure function of the protocol and the generated results, so
// two runs are byte-identical. Non-canonical metadata (git SHA, timing, hardware) is the CLI's, in meta.json.
import { canonical, sha256Text } from "../propose.ts";
import type { PredictionEnvelope } from "./envelope.ts";
import { labelOf, recipeHash, recipeOf } from "./fixtures.ts";
import { renderReport } from "./report-html.ts";
import { BASELINE_IDS, buildProposers, caseRows, checkLeaks, compare, devOnlyOracle, measurementLimited, protocolHash, runProposers, splitPlanOf, type CaseRow, type Comparison, type Generated, type PredictionLine, type Protocol, type SplitTable } from "./run.ts";

export const CANONICAL_FILES = ["envelopes.jsonl", "protocol.snapshot.json", "recipes.jsonl", "predictions.jsonl", "outcomes.jsonl", "comparison.json", "comparison.md", "report.html"] as const;

/** Entries in sorted key order: the markdown must not depend on whether the comparison came fresh from memory or back from canonical JSON (sorted keys). */
const ent = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const f3 = (v: number | null): string => (v === null ? "n/a" : v.toFixed(3));

function tableMd(t: SplitTable): string {
  const lines = [`### ${t.split} (${t.nCases} cases, ${t.nFamilies} families; up ${t.classCounts.up}, down ${t.classCounts.down}, none ${t.classCounts.none})`, "", "| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of t.rows) lines.push(`| ${r.id} | ${r.role} | ${r.answered} | ${r.abstained} | ${r.invalid} | ${r.missing} | ${f3(r.coverage)} | ${f3(r.brierImputed)} | ${f3(r.brierAnswered)} | ${f3(r.directionalAccuracy)} | ${f3(r.balancedAccuracy)} | ${f3(r.accuracyAtMatchedCoverage)} | ${f3(r.validNonNullYield)} |`);
  lines.push("", `Mean absolute effect: ${ent(t.meanAbsEffect).map(([k, v]) => `${k} ${v === null ? "n/a" : v.toFixed(1)}`).join("; ")}.`, "");
  return lines.join("\n");
}

export function comparisonMarkdown(c: Comparison, minEffect: number): string {
  const out: string[] = ["# Prediction envelope v0: comparison", "", c.noModelStatement, "", `Protocol hash \`${c.protocolHash}\`. Primary readout: body mass (B+P); minimum effect ${minEffect} mass quanta. Strongest simple baseline on dev: **${c.strongestBaselineOnDev}**. Measurement-limited cases (label flips at 0.75x or 1.25x the threshold): ${c.measurementLimitedCases}, kept in every denominator of the first two tables.`, "", tableMd(c.dev), tableMd(c.test), tableMd(c.testExcludingMeasurementLimited)];
  out.push("## Family-level intervals (imputed Brier, whole-family bootstrap)", "");
  for (const [split, v] of ent(c.perFamily)) {
    out.push(`- ${split}: ${v.intervals ? "intervals computed" : "descriptive only (fewer than 10 families)"}`);
    if (v.intervals) {
      for (const [id, iv] of ent(v.brierImputed)) if (iv) out.push(`  - ${id}: ${f3(iv.mean)} [${f3(iv.lo)}, ${f3(iv.hi)}]`);
      for (const [id, iv] of ent(v.pairedVsStrongest)) if (iv) out.push(`  - ${id} minus ${c.strongestBaselineOnDev}: ${f3(iv.mean)} [${f3(iv.lo)}, ${f3(iv.hi)}]`);
    }
  }
  out.push("", "## Mechanism audit (measured vs fixture expectation)", "", "| mechanism | expected | up | down | none |", "|---|---|---|---|---|");
  for (const m of c.mechanismAudit) out.push(`| ${m.mechanism} | ${m.expected} | ${m.counts.up} | ${m.counts.down} | ${m.counts.none} |`);
  out.push("", "## File-level diagnostics (per proposer, over the envelopes it was meant to answer)", "", "| proposer | lines | invalid | missing | extra | duplicates | not an object | unsound envelopes |", "|---|---|---|---|---|---|---|---|");
  for (const [id, d] of ent(c.fileDiagnostics)) out.push(`| ${id} | ${d.lines} | ${d.invalid} | ${d.missing} | ${d.extra} | ${d.duplicates} | ${d.notObject} | ${d.badEnvelopes} |`);
  out.push("", "## Predicted class on the test split (answered cases)", "", "| proposer | up | down | none |", "|---|---|---|---|");
  for (const [id, a] of ent(c.argmaxTest)) out.push(`| ${id} | ${a.up} | ${a.down} | ${a.none} |`);
  const t = c.trendConfound;
  out.push("", "## Trend-confound diagnostic", "", t.description, "", `- share of cases labelled up: paired rule ${f3(t.pairedAlwaysRisingAccuracy)}, naive before/after rule ${f3(t.naiveBeforeAfterAlwaysRisingAccuracy)}; cases with treated above the fork value: ${t.risingCases}/${t.totalCases}`, `- sham: ${t.sham.n} cases, naive rule says up on ${t.sham.naiveUp}, paired rule says none on ${t.sham.pairedNone}`, `- low-dose feed: ${t.lowDose.n} cases, naive rule says up on ${t.lowDose.naiveUp}, paired rule says none on ${t.lowDose.pairedNone}`, ...(t.numericTrendOnNull ? [`- null-effect cases (sham and low-dose feed), all splits: ${t.numericTrendOnNull.n} cases, ${t.numericTrendOnNull.risingNull} with treated above the fork value; naive before/after rule says up on ${t.numericTrendOnNull.naiveUp}; numericTrend predicts up on ${t.numericTrendOnNull.numericTrendUp}; paired outcome is none on ${t.numericTrendOnNull.pairedNone}; numericTrend says up where the paired outcome is none on ${t.numericTrendOnNull.numericTrendUpWherePairedNone}`] : []));
  out.push("", "## Cost and stability", "", `- total evaluation cost ${c.validNonNullYieldAndCost.totalCellSteps} cell-steps; cost per non-null case ${c.validNonNullYieldAndCost.costPerUseful === null ? "n/a" : c.validNonNullYieldAndCost.costPerUseful.toFixed(0)}`, `- cross-seed effect stability (qualify families, sibling seed): ${c.crossSeedEffectStability.agree}/${c.crossSeedEffectStability.n} labels agree (${f3(c.crossSeedEffectStability.rate)}); heterogeneity across seeds of one family, not a predictor's accuracy limit`, "", ...c.notes.map((n) => `- ${n}`), "");
  return out.join("\n");
}

const jl = (xs: readonly unknown[]): string => xs.map((x) => canonical(x) + "\n").join("");

export interface Built {
  files: Record<string, string>;
  canonicalSha256: string;
  comparison: Comparison;
  leaks: string[];
}

export function buildOutputs(p: Protocol, gen: Generated): Built {
  if (!p.frozen && !p.devPrior) throw new Error("protocol is not frozen");
  const envelopes: PredictionEnvelope[] = gen.results.flatMap((r) => r.envelopes);
  const leaks = checkLeaks(p, envelopes);
  if (leaks.length) throw new Error(`leak check failed: ${leaks.join("; ")}`);
  const proposers = buildProposers(p, envelopes);
  const eligible = devOnlyOracle(p);
  const lines = runProposers(proposers, envelopes, eligible);
  const comparison = compare(p, gen, envelopes, lines, proposers, eligible);
  const rows = caseRows(p, gen.results);
  const minEffect = p.minEffect!;
  const pHash = protocolHash(p);
  const files: Record<string, string> = {
    "envelopes.jsonl": jl(envelopes),
    "protocol.snapshot.json": canonical(p) + "\n",
    "recipes.jsonl": jl([...gen.results, ...gen.variants].map((r) => {
      const fam = p.families.find((f) => f.id === r.familyId)!;
      const rec = recipeOf(p, fam, r.seed);
      return { familyId: r.familyId, historyId: r.historyId, seed: r.seed, recipeHash: recipeHash(rec), controlHash: r.controlHash, neutralityChecks: r.neutralityChecks, recipe: rec };
    })),
    "predictions.jsonl": jl(lines),
    "outcomes.jsonl": jl(rows.map((r) => ({ ...r, label: labelOf(r.effect.bodyMass, minEffect), measurementLimited: measurementLimited(r.effect.bodyMass, minEffect), protocolHash: pHash }))),
    "comparison.json": canonical(comparison) + "\n",
    "comparison.md": comparisonMarkdown(comparison, minEffect),
  };
  files["report.html"] = renderReport({ comparison, envelopes, lines, rows, minEffect, proposerIds: proposers.map((x) => x.id), eligible: (id, env) => eligible(proposers.find((x) => x.id === id)!, env) });
  const canonicalSha256 = CANONICAL_FILES.map((n) => `${sha256Text(files[n])}  ${n}\n`).join("");
  files["canonical.sha256"] = canonicalSha256;
  return { files, canonicalSha256, comparison, leaks };
}

/**
 * Re-renders the derived files (comparison.md, report.html, canonical.sha256) from the canonical data files already on disk:
 * `read(name)` returns a file's text. The data files (envelopes, predictions, outcomes, comparison.json, protocol.snapshot.json)
 * are never changed; the three derived files are a pure function of them and the renderer.
 */
export function rerender(read: (name: string) => string): Record<string, string> {
  const parse = <T>(name: string): T[] => read(name).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
  const comparison = JSON.parse(read("comparison.json")) as Comparison;
  const protocol = JSON.parse(read("protocol.snapshot.json")) as Protocol;
  const minEffect = protocol.minEffect!;
  const envelopes = parse<PredictionEnvelope>("envelopes.jsonl");
  const lines = parse<PredictionLine>("predictions.jsonl");
  const rows = parse<CaseRow>("outcomes.jsonl");
  // Ids come from the comparison tables first (so a proposer with every prediction line missing stays in the notebook), then any extra in the file.
  const proposerIds = [...new Set([...comparison.dev.rows.map((r) => r.id), ...lines.map((l) => l.proposer)])];
  const oracleIds = new Set<string>(proposerIds.filter((id) => id === "mechanismRule"));
  const plan = splitPlanOf(protocol);
  const files: Record<string, string> = {};
  for (const n of CANONICAL_FILES) if (n !== "comparison.md" && n !== "report.html") files[n] = read(n);
  files["comparison.md"] = comparisonMarkdown(comparison, minEffect);
  files["report.html"] = renderReport({ comparison, envelopes, lines, rows, minEffect, proposerIds, eligible: (id, env) => !oracleIds.has(id) || plan.dev.includes(env.familyId) });
  const out: Record<string, string> = { "comparison.md": files["comparison.md"], "report.html": files["report.html"] };
  out["canonical.sha256"] = CANONICAL_FILES.map((n) => `${sha256Text(files[n])}  ${n}\n`).join("");
  return out;
}
export { BASELINE_IDS };
