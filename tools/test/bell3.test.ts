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
  it("subtracts the matched base, not base 0", () => {
    const bs = Array.from({ length: 10 }, (_, i) => vector(100 + i * 20));
    const a = firstCensusScore(200100, bs, 3, vector(160)); // matched base 160 -> z 0
    expect(a.D).toBe(0);
    const b = firstCensusScore(200100, bs, 0, vector(160));
    expect(b.D).toBeGreaterThan(0);
    expect(b.side).toBe("high");
  });
  it("reports no winning signal on a zero score and breaks ties by signal order", () => {
    const zero = firstCensusScore(200100, bases(), 0, vector());
    expect(zero.signal).toBeNull();
    expect(zero.side).toBeNull();
    const t = vector();
    t[SIGNALS.findIndex((s) => s.name === "individuals")] = 1 + 1; // floor 1 spread: z = 1
    t[SIGNALS.findIndex((s) => s.name === "lineages")] = 1 + 1; // same |z|, later in table
    const r = firstCensusScore(200100, bases(), 0, t);
    expect(r.D).toBeGreaterThan(0);
    expect(r.signal).toBe("individuals");
    expect(r.side).toBe("high");
  });
  it("refuses the wrong time, missing rates, nonfinite values, and invalid references", () => {
    expect(() => firstCensusScore(201000, bases(), 0, vector())).toThrow();
    const t: (number | null)[] = vector();
    t[SIGNALS.findIndex((s) => s.name === "fissions")] = null;
    expect(() => firstCensusScore(200100, bases(), 0, t)).toThrow(/fissions/);
    const n = vector();
    n[0] = NaN;
    expect(() => firstCensusScore(200100, bases(), 0, n)).toThrow(/livingCells/);
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
    expect(() => threshold3(new Array(10))).toThrow();
    expect(() => hit3(NaN, 0)).toThrow();
  });
});
