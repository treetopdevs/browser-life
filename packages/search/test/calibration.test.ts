import { describe, expect, it } from "vitest";
import { calibrate, percentile, rangesFromCalibration, type AtlasEval, type CalRow, type Evaluation } from "@bl/search";

const ev = (d1: number | null, d2: number | null, over: Partial<Evaluation> = {}): Evaluation => ({
  survived: 4, recovered: 4, lightDependent: 4, reps: 4, individuals: 1, meanMass: 256, speed: 1, mass: 256, recovery: 1, regenerated: 4, reproduction: 0,
  atlas: { reps: 4, d1, d2, comPath: d1, d1Defined: 4, d2Defined: 4 } as AtlasEval, ...over,
});

describe("calibration rules", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.05)).toBe(1);
    expect(percentile([5], 0.5)).toBe(5);
  });
  it("sets ranges by the rule: ceil to 0.25 of p95 for D1, floor to 0.05 of p5 for D2", () => {
    const d1 = Array.from({ length: 100 }, (_, i) => (i + 1) / 50); // p95 = 1.9 -> 2
    const d2 = Array.from({ length: 100 }, (_, i) => 0.3 + i / 200); // p5 = 0.304 -> 0.30
    expect(rangesFromCalibration(d1, d2)).toEqual({ displacementRange: [0, 2], persistenceRange: [0.3, 1] });
    expect(rangesFromCalibration([0, 0, 0], [1, 1, 1])).toEqual({ displacementRange: [0, 0.25], persistenceRange: [0.95, 1] });
  });
  const rows = (n: number, f: (i: number) => Partial<{ d1: number | null; d2: number | null; speed: number; meanMass: number }>): CalRow[] =>
    Array.from({ length: n }, (_, i) => {
      const p = f(i);
      return { key: `k${i}`, eval: ev(p.d1 === undefined ? i / 10 : p.d1, p.d2 === undefined ? 1 - i / 200 : p.d2, { speed: p.speed ?? ((i * 7) % 13) / 4, meanMass: p.meanMass ?? 200 + ((i * 11) % 17) * 200 }) };
    });
  it("calls independent, stable, mostly defined descriptors usable", () => {
    const a = rows(160, (i) => ({ d1: ((i * 37) % 160) / 80, d2: 0.4 + (((i * 53) % 160) / 160) * 0.6 }));
    const r = calibrate(a, a.slice(0, 32));
    expect(r.d1.verdict).toBe("usable");
    expect(r.d2.verdict).toBe("usable");
    expect(r.cells.atlas).toBeGreaterThanOrEqual(12);
    expect(r.usableBoth).toBe(true);
    expect(r.pair).toBe("usable");
    expect(r.d1.pairsAB).toBe(32);
    expect(r.d1.versusMeanMass).not.toBeNull();
    expect(r.d2.versusSpeed).not.toBeNull();
  });
  it("flags mostly-undefined, noisy and redundant descriptors", () => {
    const base = (i: number) => ({ d1: ((i * 37) % 160) / 80, d2: 0.4 + (((i * 53) % 160) / 160) * 0.6 });
    expect(calibrate(rows(160, (i) => ({ ...base(i), d1: i % 2 ? null : base(i).d1 })), []).d1.verdict).toBe("mostly-undefined");
    const a = rows(160, base);
    const b = rows(32, (i) => ({ d1: ((i * 91 + 7) % 160) / 80, d2: base(i).d2 }));
    expect(calibrate(a, b).d1.verdict).toBe("noisy");
    const red = rows(160, (i) => ({ ...base(i), speed: base(i).d1 }));
    expect(calibrate(red, red.slice(0, 32)).d1.verdict).toBe("redundant");
  });
  it("calls the pair sparse below 12 joint cells", () => {
    const a = rows(160, (i) => ({ d1: (i % 2) / 4, d2: 0.9 + (i % 3) / 100 }));
    const r = calibrate(a, a.slice(0, 32));
    expect(r.cells.sparse).toBe(true);
    expect(r.pair).toBe("sparse");
    expect(r.usableBoth).toBe(false);
  });
});
