// The static notebook view, the outputs' byte reproducibility, and the comparison's shape.
import { describe, expect, it } from "vitest";
import type { PredictionEnvelope } from "../lib/prediction/envelope.ts";
import { sha256Text } from "../lib/propose.ts";
import { CANONICAL_FILES, buildOutputs, rerender } from "../lib/prediction/output.ts";
import { devOnlyOracle, generate, splitPlanOf, tableFor } from "../lib/prediction/run.ts";
import { abstainAll, alwaysNone, fixedRule } from "../lib/prediction/proposers.ts";
import { renderReport } from "../lib/prediction/report-html.ts";
import { validatePredictionFile } from "../lib/prediction/validate.ts";
import { tinyPipeline } from "./prediction-helpers.ts";

const T = 240_000;

describe("report.html", () => {
  const { p, built } = tinyPipeline();
  const html = built.files["report.html"];
  const envs = built.files["envelopes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
  it("contains every case id, no scripts and no external URLs", () => {
    for (const e of envs) expect(html).toContain(`id="${e.caseId}"`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\son\w+=/i);
  }, T);
  it("shows failed predictions first and escapes the free-text reason", () => {
    const rows = built.files["outcomes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const lines = built.files["predictions.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const evil = lines.map((l: { proposer: string; prediction: { reason: string } }) => (l.proposer === "fixedRule" ? { ...l, prediction: { ...l.prediction, reason: "<img src=x onerror=alert(1)>" } } : l));
    const out = renderReport({ comparison: built.comparison, envelopes: envs, lines: evil as never, rows, minEffect: p.minEffect!, proposerIds: ["fixedRule", "numericTrend"] });
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
    const first = out.match(/<article[\s\S]*?<\/article>/)![0];
    expect(first).toContain('<li class="bad">');
    const lastArticle = [...out.matchAll(/<article[\s\S]*?<\/article>/g)].pop()![0];
    const bads = (h: string) => (h.match(/<li class="bad">/g) ?? []).length;
    expect(bads(first)).toBeGreaterThanOrEqual(bads(lastArticle));
  }, T);
  it("lists invalid predictions in their own section", () => {
    const rows = built.files["outcomes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const lines = built.files["predictions.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const broken = lines.map((l: { proposer: string; prediction: Record<string, unknown> }, i: number) => (l.proposer === "fixedRule" && i % 5 === 0 ? { ...l, prediction: { ...l.prediction, probs: { up: 1, down: 1, none: 1 } } } : l));
    const out = renderReport({ comparison: built.comparison, envelopes: envs, lines: broken as never, rows, minEffect: p.minEffect!, proposerIds: ["fixedRule"] });
    expect(out).toMatch(/Invalid or missing predictions<\/h2><ul>/);
  }, T);
});

describe("outputs", () => {
  const { p, built } = tinyPipeline();
  it("are byte-reproducible: a second generation gives identical canonical files", () => {
    const again = buildOutputs(p, generate(p, p.families.map((f) => f.id), true));
    for (const n of CANONICAL_FILES) expect(again.files[n], n).toBe(built.files[n]);
    expect(again.canonicalSha256).toBe(built.canonicalSha256);
  }, T);
  it("canonical.sha256 lists exactly the canonical files with their hashes", () => {
    const listed = built.canonicalSha256.trim().split("\n").map((l) => l.split("  "));
    expect(listed.map((x) => x[1])).toEqual([...CANONICAL_FILES]);
    for (const [h, n] of listed) expect(h).toBe(sha256Text(built.files[n]));
  });
  it("every proposer's file validates against the envelopes; shuffled never uses its own family; the oracle is absent from the test table", () => {
    const envs = built.files["envelopes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const lines = built.files["predictions.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const ids = new Set(lines.map((l: { proposer: string }) => l.proposer));
    const plan = splitPlanOf(p);
    for (const id of ids) {
      const meant = id === "mechanismRule" ? envs.filter((e: { familyId: string }) => plan.dev.includes(e.familyId)) : envs;
      const r = validatePredictionFile(lines.filter((l: { proposer: string }) => l.proposer === id).map((l: { prediction: unknown }) => JSON.stringify(l.prediction)), meant);
      expect(r.invalid + r.missing.length + r.extra.length, id).toBe(0);
    }
    expect(built.comparison.test.rows.map((r) => r.id)).not.toContain("mechanismRule");
    expect(built.comparison.dev.rows.map((r) => r.id)).toContain("mechanismRule");
    expect(built.comparison.test.rows.find((r) => r.id === "abstainAll")!.coverage).toBe(0);
    expect(built.comparison.perFamily.test.intervals).toBe(false);
  });
  it("the dev-only oracle is run on, serialised for and shown on dev cases only", () => {
    const plan = splitPlanOf(p);
    const lines = built.files["predictions.jsonl"].trim().split("\n").map((l) => JSON.parse(l) as { proposer: string; prediction: { caseId: string } });
    const envs = built.files["envelopes.jsonl"].trim().split("\n").map((l) => JSON.parse(l) as { caseId: string; familyId: string });
    const fam = new Map(envs.map((e) => [e.caseId, e.familyId]));
    const oracle = lines.filter((l) => l.proposer === "mechanismRule");
    expect(oracle.length).toBeGreaterThan(0);
    for (const l of oracle) expect(plan.dev, l.prediction.caseId).toContain(fam.get(l.prediction.caseId));
    const html = built.files["report.html"];
    for (const e of envs.filter((x) => plan.test.includes(x.familyId))) {
      const art = html.match(new RegExp(`<article id="${e.caseId}"[\\s\\S]*?</article>`))![0];
      expect(art).not.toContain("mechanismRule");
    }
    expect(devOnlyOracle(p)({ id: "mechanismRule", role: "oracle", propose: () => null as never }, { familyId: plan.test[0] } as never)).toBe(false);
    expect(built.comparison.fileDiagnostics.mechanismRule.missing).toBe(0);
  });
  it("file-level diagnostics (extra, duplicate, invalid) reach the comparison, not just the per-case scores", () => {
    expect(Object.keys(built.comparison.fileDiagnostics)).toContain("fixedRule");
    expect(built.files["comparison.md"]).toContain("File-level diagnostics");
    expect(built.comparison.fileDiagnostics.fixedRule).toMatchObject({ invalid: 0, missing: 0, extra: 0, duplicates: 0, notObject: 0, badEnvelopes: 0 });
  });
  it("tableFor keeps the matched-coverage set non-empty when abstainAll is present (zero coverage is excluded from it)", () => {
    const envs = built.files["envelopes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const rows = built.files["outcomes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const ps = [fixedRule(p.proposers.fixedRule), alwaysNone(), abstainAll()];
    const lines = ps.flatMap((pr) => envs.map((e: PredictionEnvelope) => ({ proposer: pr.id, prediction: pr.propose(e) })));
    const t = tableFor(p, "t", ps, lines, envs, rows, () => true);
    for (const id of ["fixedRule", "alwaysNone"]) expect(t.rows.find((r) => r.id === id)!.accuracyAtMatchedCoverage, id).not.toBeNull();
    expect(t.rows.find((r) => r.id === "abstainAll")!.coverage).toBe(0);
  });
  it("a file with an extra unknown case and a duplicate is reported by validatePredictionFile, and the comparison would carry it", () => {
    const envs = built.files["envelopes.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
    const mine = built.files["predictions.jsonl"].trim().split("\n").map((l) => JSON.parse(l)).filter((l: { proposer: string }) => l.proposer === "alwaysNone").map((l: { prediction: unknown }) => l.prediction as Record<string, unknown>);
    const lines = [...mine, { ...mine[0], caseId: "cunknown" }, mine[1]].map((x) => JSON.stringify(x));
    const r = validatePredictionFile(lines, envs);
    expect(r.extra).toEqual(["cunknown"]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.invalid).toBe(2);
  });
  it("rerender reproduces the derived files byte for byte from the canonical data", () => {
    const again = rerender((n) => built.files[n]);
    for (const n of ["comparison.md", "report.html", "canonical.sha256"]) expect(again[n], n).toBe(built.files[n]);
  });
  it("rerender keeps a proposer whose prediction lines are all missing", () => {
    const keep = (n: string): string => (n === "predictions.jsonl" ? built.files[n].split("\n").filter((l) => !l.includes('"proposer":"v0Rules"')).join("\n") : built.files[n]);
    expect(keep("predictions.jsonl")).not.toContain('"proposer":"v0Rules"');
    const again = rerender(keep);
    expect(again["report.html"]).toContain("v0Rules");
  });
  it("abstainAll scores exactly the prior (imputation) on the headline Brier", () => {
    const prior = built.comparison.test.rows.find((r) => r.id === "priorMajority")!;
    const ab = built.comparison.test.rows.find((r) => r.id === "abstainAll")!;
    expect(ab.brierImputed).toBeCloseTo(prior.brierImputed!, 12);
  });
  it("the comparison states no model was run", () => {
    expect(built.comparison.noModelStatement).toMatch(/No model call/);
    expect(built.files["comparison.md"]).toContain("Trend-confound diagnostic");
  });
});
