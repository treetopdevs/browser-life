import { describe, expect, it } from "vitest";
import { calibrate, percentile, rangesFromCalibration, resumedBatches, type AtlasEval, type CalRow, type Evaluation } from "@bl/search";

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
    // a descriptor undefined everywhere still yields finite bounds
    expect(rangesFromCalibration([], [])).toEqual({ displacementRange: [0, 0.25], persistenceRange: [0, 1] });
  });
  it("keeps a D2 fifth percentile that lies exactly on the 0.05 grid (0.3 stays 0.30, not 0.25)", () => {
    expect(rangesFromCalibration([1], [0.3]).persistenceRange).toEqual([0.3, 1]);
    expect(rangesFromCalibration([1], [0.95]).persistenceRange).toEqual([0.95, 1]);
    for (let k = 0; k <= 19; k++) expect(rangesFromCalibration([1], [k / 20]).persistenceRange[0]).toBe(Number((k / 20).toFixed(2)));
    // just below a grid point floors a step; 1.0 is held by the 0.95 guard
    expect(rangesFromCalibration([1], [0.2999]).persistenceRange[0]).toBe(0.25);
    expect(rangesFromCalibration([1], [1]).persistenceRange[0]).toBe(0.95);
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

describe("resuming a calibration (resumedBatches)", () => {
  // Batches of 2 genomes; keys stand for genomeKey. With a stride of 1 (distinct genomes between 3P and 4P), --n 3P
  // and --n 2P draw the same first A batches, so only the batch set tells the two samples apart.
  const plan = (n: number) => {
    const keys = Array.from({ length: n }, (_, i) => `g${i}`);
    const out: { set: string; seed: number; keys: string[] }[] = [];
    for (let i = 0; i * 2 < n; i++) out.push({ set: "A", seed: 3000001 + i, keys: keys.slice(i * 2, i * 2 + 2) });
    out.push({ set: "elites", seed: 3000001 + Math.ceil(n / 2), keys: ["e0", "e1"] });
    return out;
  };
  const rowsOf = (p: { set: string; seed: number; keys: string[] }[]) => p.flatMap((b) => b.keys.map((key) => ({ set: b.set, seed: b.seed, key })));

  it("resumes an unchanged plan, partly or wholly done", () => {
    expect(resumedBatches([], plan(6))).toEqual(new Set());
    expect(resumedBatches(rowsOf(plan(6).slice(0, 2)), plan(6))).toEqual(new Set(["A:3000001", "A:3000002"]));
    expect(resumedBatches(rowsOf(plan(6)), plan(6)).size).toBe(4);
  });
  it("refuses a saved batch the new plan does not have (--n 3P resumed with --n 2P)", () => {
    // The first two A batches agree; the saved third A batch (and the elites batch on its old seed) are not in the plan.
    expect(() => resumedBatches(rowsOf(plan(6)), plan(4))).toThrow(/A:3000003, which this plan does not have/);
    // even when only that stale batch is on file
    expect(() => resumedBatches(rowsOf(plan(6)).filter((r) => r.seed === 3000003), plan(4))).toThrow(/does not have/);
  });
  it("refuses a saved batch holding other genomes", () => {
    const saved = rowsOf(plan(6).slice(0, 1)).map((r, i) => (i ? { ...r, key: "other" } : r));
    expect(() => resumedBatches(saved, plan(6), "x/rows.jsonl")).toThrow("calibrate: x/rows.jsonl holds A:3000001 for other genomes");
  });
});
