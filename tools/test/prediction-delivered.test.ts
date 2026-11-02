// The delivered v0 outputs must discriminate the baselines and show the trend-confound case on real fixtures (Amendment 2). Reads the
// committed comparison.json and outcomes.jsonl; does not regenerate anything.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../experiments/prediction-envelope/v0/", import.meta.url);
const comparison = JSON.parse(readFileSync(new URL("comparison.json", dir), "utf8"));

describe("delivered v0 outputs", () => {
  it("has rising cases, and on the null cases the before/after rule and numericTrend say up where the paired outcome is none", () => {
    const t = comparison.trendConfound;
    expect(t.risingCases).toBeGreaterThan(0);
    expect(t.numericTrendOnNull.risingNull).toBeGreaterThan(0);
    expect(t.numericTrendOnNull.naiveUp).toBeGreaterThan(0);
    expect(t.numericTrendOnNull.numericTrendUpWherePairedNone).toBeGreaterThan(0);
    expect(t.naiveBeforeAfterAlwaysRisingAccuracy).toBeGreaterThan(t.pairedAlwaysRisingAccuracy);
  });
  it("numericTrend is no longer degenerate: it predicts more than one class on the test split", () => {
    const c = comparison.argmaxTest.numericTrend;
    expect([c.up, c.down, c.none].filter((v: number) => v > 0).length).toBeGreaterThan(1);
  });
  it("numericTrend and shuffledEvidence do not tie on the test split", () => {
    const rows = (comparison.test.rows as { id: string; brierImputed: number }[]);
    const b = (id: string) => rows.find((r) => r.id === id)!.brierImputed;
    expect(b("numericTrend")).not.toBe(b("shuffledEvidence"));
  });
});
