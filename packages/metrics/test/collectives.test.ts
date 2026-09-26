import { describe, expect, it } from "vitest";
import { CollectiveTracker, type Individual } from "@bl/metrics";

const ind = (id: number, cx: number, cy: number, lineage = "0:1", parent: number | null = null, tile = 0): Individual => ({
  id, parent, born: 0, died: null, mass: 500, mu: 60, sigma: 20, lineage, cx, cy, tile, generation: 0,
});

describe("CollectiveTracker", () => {
  const opt = { linkDist: 10, minMembers: 3, tileW: 64, tileH: 64 };

  it("links individuals across the tile torus but not across tiles", () => {
    const t = new CollectiveTracker(opt);
    const g = t.group([ind(1, 1, 30), ind(2, 62, 30), ind(3, 58, 30), ind(4, 66, 30, "0:1", null, 1)]);
    expect(g.length).toBe(1);
    expect(g[0].map((i) => i.id).sort()).toEqual([1, 2, 3]);
  });

  it("detects collective fission with composition heredity", () => {
    const t = new CollectiveTracker(opt);
    // One collective of six, mostly lineage A.
    t.update(0, [ind(1, 10, 10, "A"), ind(2, 16, 10, "A"), ind(3, 22, 10, "A"), ind(4, 28, 10, "A"), ind(5, 34, 10, "A"), ind(6, 40, 10, "B")]);
    // A second unrelated collective of lineage C.
    t.update(0, [ind(1, 10, 10, "A"), ind(2, 16, 10, "A"), ind(3, 22, 10, "A"), ind(4, 28, 10, "A"), ind(5, 34, 10, "A"), ind(6, 40, 10, "B"), ind(7, 10, 50, "C"), ind(8, 16, 50, "C"), ind(9, 22, 50, "C")]);
    // The first splits in two groups that keep their members (and a newborn member).
    const ev = t.update(100, [ind(1, 10, 10, "A"), ind(2, 16, 10, "A"), ind(3, 22, 10, "A"), ind(4, 40, 10, "A"), ind(5, 46, 10, "A"), ind(10, 52, 10, "A", 4), ind(7, 10, 50, "C"), ind(8, 16, 50, "C"), ind(9, 22, 50, "C")]);
    const f = ev.find((e) => e.kind === "fission");
    expect(f).toBeTruthy();
    const s = t.summary();
    expect(s.fissions).toBe(1);
    expect(s.offspringSimilarity).toBeGreaterThan(s.randomSimilarity);
  });
});
