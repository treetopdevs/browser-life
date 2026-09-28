import { describe, expect, it } from "vitest";
import { analyzeGrowthCurves, lateGrowth, pairedMeanContrast, studentCritical, studentTail, type GrowthCurve } from "../lib/m4-growth.ts";
const points = (fn: (step: number) => number) => Array.from({ length: 10000 }, (_, i) => ({ step: (i + 1) * 100, cumulativeNew: fn((i + 1) * 100) }));
describe("M4 late-window mean contrast", () => {
  it("ignores pre-window level and retains extinction plateau", () => {
    expect(lateGrowth(points((s) => 900 + s / 100))).toBe(1000);
    expect(lateGrowth(points((s) => Math.min(s, 500000) / 100))).toBe(0);
  });
  it("rejects missing schedule, fractional counts and decreases", () => {
    expect(() => lateGrowth(points(() => 0).slice(1))).toThrow();
    expect(() => lateGrowth(points(() => 0.5))).toThrow();
    expect(() => lateGrowth(points((s) => s < 600000 ? 1 : 0))).toThrow();
  });
  it("matches analytic Cauchy and df=2 tails", () => {
    for (const t of [-10, -1, 0, 1, 10]) {
      expect(studentTail(t, 1)).toBeCloseTo(0.5 - Math.atan(t) / Math.PI, 10);
      expect(studentTail(t, 2)).toBeCloseTo((1 - t / Math.sqrt(t * t + 2)) / 2, 10);
    }
  });
  it("matches known Student critical values without normal fallback", () => {
    expect(studentCritical(0.025, 9)).toBeCloseTo(2.2621571628, 8);
    expect(studentCritical(0.005, 63)).toBeCloseTo(2.6561450298, 7);
    expect(studentTail(0, 500)).toBeCloseTo(0.5, 10);
  });
  it("targets mean above floor and withholds zero-variance inference", () => {
    expect(pairedMeanContrast([0, 0, 0]).status).toBe("degenerate");
    expect(pairedMeanContrast([9, 9, 9]).supported).toBe(false);
    expect(pairedMeanContrast(Array.from({length:64}, (_, i) => 3 + (i % 2 ? 1 : -1))).supported).toBe(true);
    expect(pairedMeanContrast(Array.from({length:64}, (_, i) => 1 + (i % 2 ? 1 : -1))).supported).toBe(false);
  });
  it("enforces exact complete condition/seed matrix", () => {
    const curves: GrowthCurve[] = [1, 2].flatMap((seed) => (["treatment", "neutral", "no-mutation"] as const).map((condition) => ({ seed, condition, points: points(() => 0) })));
    expect(analyzeGrowthCurves(curves, [1, 2]).endpoint2.status).toBe("degenerate");
    expect(() => analyzeGrowthCurves(curves.slice(1), [1, 2])).toThrow("missing");
    expect(() => analyzeGrowthCurves([...curves, curves[0]], [1, 2])).toThrow("duplicate");
    expect(() => analyzeGrowthCurves(curves, [1, 3])).toThrow("unexpected");
  });
});
