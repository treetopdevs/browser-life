import { describe, expect, it } from "vitest";
import { historicalMax, novelty, oeScore, pearson, quantile } from "../observe/asal.ts";

describe("ASAL scores", () => {
  const e = (x: number, y: number) => { const n = Math.hypot(x, y); return [x / n, y / n]; };
  it("novelty is 1 minus the best match among earlier frames", () => {
    const es = [e(1, 0), e(1, 0), e(0, 1), e(1, 1)];
    const n = novelty(es);
    expect(n[0]).toBeNull();
    expect(n[1]).toBeCloseTo(0);
    expect(n[2]).toBeCloseTo(1);
    expect(n[3]).toBeCloseTo(1 - Math.SQRT1_2);
    expect(historicalMax(es)[3]).toBeCloseTo(Math.SQRT1_2);
  });
  it("open-endedness score averages historical similarity over kept frames", () => {
    const es = [e(1, 0), e(1, 0), e(0, 1)];
    expect(oeScore(es, () => true)).toBeCloseTo(0.5);
    expect(oeScore(es, (t) => t === 2)).toBeCloseTo(0);
  });
  it("pearson and quantile", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(quantile([0, 10], 0.99)).toBeCloseTo(9.9);
  });
});
