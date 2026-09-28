import { describe, expect, it } from "vitest";
import { renderFoundationAuditMarkdown, summarizeFoundationReport } from "../lib/foundation-audit";

describe("foundation audit summaries", () => {
  it("reports condition summaries, available sample sizes, and stored heredity fields", () => {
    const report = summarizeFoundationReport({
      presetId: "sample",
      m4Descriptive: { runs: 2 },
      runs: [
        { condition: "treatment", trend: "growing", stats: { rolesPresent: 2, rolesPresentTrend: 0.2, compartmentalised: 0, compartmentalisedTrend: 0.5 } },
        { condition: "treatment", trend: "stable", stats: { rolesPresent: 4, compartmentalised: 2, compartmentalisedTrend: -0.5 } },
        { condition: "neutral", stats: { rolesPresent: 1, compartmentalised: 0, compartmentalisedTrend: 0 } },
      ],
      heredity: [{ condition: "treatment", runs: 2, fissions: 17, muPooled: 0.8, sigmaPooled: 0.7, muMedianRun: 0.6, sigmaMedianRun: 0.5 }],
    });
    const treatment = report.conditions.find((row) => row.condition === "treatment")!;
    expect(treatment.runs).toBe(2);
    expect(treatment.trendCounts).toEqual({ growing: 1, stable: 1 });
    expect(treatment.rolesPresent).toEqual({ available: 2, unavailable: 0, mean: 3, min: 2, max: 4 });
    expect(treatment.rolesPresentTrend).toMatchObject({ available: 1, unavailable: 1, mean: 0.2 });
    expect(report.treatmentRunCoverage).toEqual({ listed: 2, declared: 2 });
    expect(report.heredity[0]).toMatchObject({ runs: 2, fissions: 17, muPooled: 0.8, sigmaPooled: 0.7, muMedianRun: 0.6, sigmaMedianRun: 0.5 });
    expect(renderFoundationAuditMarkdown("fixture", report)).toContain("not an estimate of heritability");
  });

  it("treats missing and non-finite values as unavailable, never as zero", () => {
    const report = summarizeFoundationReport({
      m4Descriptive: { runs: 2 },
      runs: [
        { condition: "treatment", stats: { rolesPresent: null, compartmentalised: Number.NaN, compartmentalisedTrend: Number.POSITIVE_INFINITY } },
        { condition: "treatment", stats: {} },
      ],
      heredity: [{ condition: "treatment", runs: null, fissions: Number.NaN, muPooled: Number.POSITIVE_INFINITY }],
    });
    const treatment = report.conditions[0];
    expect(treatment.rolesPresent).toEqual({ available: 0, unavailable: 2, mean: null, min: null, max: null });
    expect(treatment.compartmentalised).toEqual({ available: 0, unavailable: 2, mean: null, min: null, max: null });
    expect(treatment.compartmentalisedTrend.mean).toBeNull();
    expect(report.heredity[0]).toMatchObject({ runs: null, fissions: null, muPooled: null });
    expect(report.treatmentRunCoverage).toEqual({ listed: 2, declared: 2 });
    expect(renderFoundationAuditMarkdown("fixture", report)).toContain("unavailable [unavailable, unavailable]; n=0/2");
  });

  it("keeps listed-run coverage separate from available metrics and declared treatment runs", () => {
    const report = summarizeFoundationReport({
      m4Descriptive: { runs: 4 },
      runs: [
        { condition: "treatment", stats: { rolesPresent: 3 } },
        { condition: "control", stats: { rolesPresent: 2 } },
      ],
    });
    expect(report.runsListed).toBe(2);
    expect(report.treatmentRunCoverage).toEqual({ listed: 1, declared: 4 });
    expect(report.conditions[1].rolesPresent).toMatchObject({ available: 1, unavailable: 0 });
    expect(report.limitations.join(" ")).toContain("does not establish all-census coverage");
  });

  it("does not format small nonzero means as zero", () => {
    const report = summarizeFoundationReport({
      runs: [
        { condition: "neutral", stats: { compartmentalised: 0.001 } },
        { condition: "neutral", stats: { compartmentalised: 0 } },
        { condition: "neutral", stats: { compartmentalised: 0 } },
        { condition: "neutral", stats: { compartmentalised: 0 } },
      ],
    });
    const rendered = renderFoundationAuditMarkdown("fixture", report);
    expect(report.conditions[0].compartmentalised.mean).toBe(0.00025);
    expect(rendered).toContain("2.50e-4 [0.000, 0.001]; n=4/4");
  });
});
