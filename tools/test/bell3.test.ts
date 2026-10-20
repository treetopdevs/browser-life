import { describe, it, expect } from "vitest";
import { SIGNALS } from "../lib/bell.ts";
import { firstCensusScore, threshold3, hit3 } from "../lib/bell3.ts";

const vector = (living = 100) => SIGNALS.map((s) => s.name === "livingCells" ? living : 1);
const bases = () => Array.from({ length: 10 }, () => vector());
describe("v3 first-census measurement", () => {
  it("hears an acute removal on its own, preserves sign, and gives replay zero", () => {
    const r = firstCensusScore(200100, bases(), 0, vector(60));
    expect(r.D).toBe(8); // 5% of median 100, rather than a nudge-derived unit
    expect(r.signal).toBe("livingCells");
    expect(r.side).toBe("low");
    expect(r.bySignal).toHaveLength(11);
    expect(firstCensusScore(200100, bases(), 0, vector()).D).toBe(0);
    expect(firstCensusScore(200100, bases(), 0, vector(140)).D).toBe(8);
  });
  it("uses between-base IQR and ignores only the two excluded signals", () => {
    const bs = Array.from({ length: 10 }, (_, i) => vector(100 + i * 20));
    const t = vector(60);
    t[SIGNALS.findIndex((s) => s.name === "dominantShare")] = Infinity;
    expect(firstCensusScore(200100, bs, 0, t).D).toBeCloseTo(40 / (90 / 1.349));
  });
  it("refuses the wrong time, missing rates, nonfinite values, and invalid references", () => {
    expect(() => firstCensusScore(201000, bases(), 0, vector())).toThrow();
    const t: (number | null)[] = vector();
    t[SIGNALS.findIndex((s) => s.name === "fissions")] = null;
    expect(() => firstCensusScore(200100, bases(), 0, t)).toThrow(/fissions/);
    t[0] = NaN;
    expect(() => firstCensusScore(200100, bases(), 0, t)).toThrow();
    expect(() => firstCensusScore(200100, bases().slice(1), 0, vector())).toThrow();
    expect(() => firstCensusScore(200100, bases(), 0.5, vector())).toThrow();
    const extreme = Array.from({ length: 10 }, (_, i) => vector(i < 5 ? -Number.MAX_VALUE : Number.MAX_VALUE));
    expect(() => firstCensusScore(200100, extreme, 0, vector())).toThrow(/spread/);
  });
  it("uses strict exceedance, including the all-zero null, without retuning", () => {
    expect(threshold3([1, 2, 6, 0, 0, 0, 0, 0, 0, 0])).toBe(6);
    expect(hit3(6, 6)).toBe(false);
    expect(hit3(7, 6)).toBe(true);
    expect(hit3(0, threshold3(Array(10).fill(0)))).toBe(false);
    expect(() => threshold3([1])).toThrow();
    expect(() => hit3(NaN, 0)).toThrow();
  });
});
