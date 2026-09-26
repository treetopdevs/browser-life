import { describe, expect, it } from "vitest";
import { mannWhitney } from "@bl/metrics";

describe("Mann–Whitney", () => {
  it("applies the tie correction to the variance", () => {
    const a = [...Array(15).fill(1), ...Array(5).fill(0)];
    const b = [...Array(5).fill(1), ...Array(15).fill(0)];
    expect(mannWhitney(a, b, "normal").p).toBeCloseTo(0.00179, 4);
  });
  it("returns p = 1 when every value is tied", () => {
    expect(mannWhitney([1, 1, 1], [1, 1]).p).toBe(1);
  });
});

import { growthVsSaturation, ActivityTracker } from "@bl/metrics";

describe("growth classification (review 3)", () => {
  it("returns indeterminate when neither pre-registered criterion holds", () => {
    const t = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const y = [0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3];
    const g = growthVsSaturation(t, y);
    expect(g.deltaAIC).toBeLessThan(2);
    expect(g.verdict).toBe("indeterminate");
  });
  it("handles very long histories without argument-spread limits", () => {
    const t = Array.from({ length: 200_000 }, (_, i) => i);
    expect(() => growthVsSaturation(t, t)).not.toThrow();
  });
});

describe("activity (review 3)", () => {
  it("requires strict exceedance of the neutral threshold", () => {
    const a = new ActivityTracker(1);
    expect(a.update(1, [["x", 1]]).significant).toBe(0);
    expect(a.update(2, [["x", 1]]).significant).toBe(1);
  });
  it("saved states are immutable snapshots and restore long histories", () => {
    const a = new ActivityTracker(5);
    a.update(1, [["x", 3]]);
    const saved = a.toJSON();
    const b = ActivityTracker.fromJSON(saved);
    b.update(2, [["x", 3]]);
    const c = ActivityTracker.fromJSON(saved);
    c.update(2, [["x", 3]]);
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(c.toJSON()));
    const big = { ...saved, extinct: new Array(200_000).fill(1) };
    expect(() => ActivityTracker.fromJSON(big)).not.toThrow();
  });
});

import { holm, mannWhitney as mw, Tracker } from "@bl/metrics";

describe("review 4", () => {
  it("one-sided Mann–Whitney p and Holm adjustment", () => {
    const hi = [5, 6, 7, 8, 9, 10], lo = [1, 2, 3, 4, 5, 6];
    const r = mw(hi, lo);
    expect(r.pGreater).toBeLessThan(0.05);
    expect(r.exact).toBe(true);
    expect(mw([1, 1, 1, 1], [0, 0, 0, 0]).pGreater).toBeCloseTo(1 / 70, 12);
    expect(mw(lo, hi).pGreater).toBeGreaterThan(0.95);
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
  });
  it("records very large event batches without argument-spread limits", () => {
    const t = new Tracker();
    const labels = new Int32Array(300_000).map((_, i) => i);
    const comps = Array.from({ length: 300_000 }, (_, i) => ({ idx: i, cells: 1, mass: 1000, biomass: 1000, cx: i, cy: 0, tile: 0, lineage: "1:1", purity: 1, mu: 60, sigma: 20 }));
    // deno-lint-ignore no-explicit-any
    t.update({ step: 1, labels, components: comps, lineages: [], livingCells: 0 } as any);
    // deno-lint-ignore no-explicit-any
    expect(() => t.update({ step: 2, labels: new Int32Array(300_000).fill(-1), components: [], lineages: [], livingCells: 0 } as any)).not.toThrow();
    expect(t.eventCounts().death).toBe(300_000);
  });
  it("rejects malformed observer state instead of restoring it", () => {
    // deno-lint-ignore no-explicit-any
    const bad: any[] = [null, {}, { ...new Tracker().toJSON(), nextId: -1 }, { ...new Tracker().toJSON(), alive: [{ id: 5 }] }];
    for (const b of bad) expect(() => Tracker.fromJSON(b)).toThrow();
    expect(() => Tracker.fromJSON(new Tracker().toJSON())).not.toThrow();
    // deno-lint-ignore no-explicit-any
    expect(() => ActivityTracker.fromJSON({ threshold: null, comps: [["x", {}]], cumulativeNew: 0, extinct: [] } as any)).toThrow();
  });
});
