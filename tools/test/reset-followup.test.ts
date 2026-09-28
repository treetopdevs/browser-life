import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, defaultConfig, type WorldState } from "@bl/schema";
import { census } from "@bl/metrics";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { resetBirthReferences, resetFollowupSample } from "../lib/reset-followup.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2 };
const rule = { threshold: 1, neighbors: 8 } as const;
function state(step: number, sites: [number, number, boolean?][]): WorldState {
  const s = allocState(cfg), n = cellCount(cfg); s.step = step;
  for (const [site, mass, genome = true] of sites) {
    s.cells[CH.B * n + site] = mass;
    if (genome) s.genome[G.LIN_LO * n + site] = 1;
  }
  return s;
}
function snapshot(referenceStep: number, step: number, assignments: [number, number][]) {
  const tags = new Uint32Array(cellCount(cfg));
  for (const [destination, source] of assignments) tags[destination] = source + 1;
  return { referenceStep, step, tags, diagnostics: new Uint32Array(tags.length * 10) };
}

describe("birth-t follow-up references", () => {
  it("tracks a non-first focal fission daughter against both parent-ID and sibling branches", () => {
    const born = state(100, [[0, 300], [3, 300], [5, 300]]);
    const c = census({ cfg, step: 100, cells: born.cells, genomeHead: born.genome });
    const event = { step: 100, kind: "fission", parent: 10,
      focalChild: 12, children: [11, 12] } as const;
    const references = resetBirthReferences(c,
      [{ step: 100, kind: "fission", parent: 10, children: [11, 12] }],
      { ...event, children: [...event.children] }, id => new Map([[10, 0], [11, 2], [12, 1]]).get(id) ?? null);
    expect(references.branches.map(x => [x.id, x.role, x.sites])).toEqual([
      [12, "focal", [3]], [10, "parent-id-candidate", [0]], [11, "sibling", [5]],
    ]);
    const birthMap = ResetOriginMap.atPhysicalCensus(cfg, 100, born.cells, born.genome);
    const initial = resetFollowupSample(cfg, references, birthMap, born.cells, born.genome, rule);
    expect(initial.comparisons).toEqual([
      { comparisonId: 10, status: "sampled-disconnected" },
      { comparisonId: 11, status: "sampled-disconnected" },
    ]);
    const contact = state(200, [[0, 300], [3, 300], [4, 1, false], [5, 300]]);
    const map = birthMap.compose(snapshot(100, 200, [[0, 0], [3, 3], [5, 5]]));
    const shared = resetFollowupSample(cfg, references, map,
      contact.cells, contact.genome, rule);
    expect(shared.comparisons).toEqual([
      { comparisonId: 10, status: "sampled-disconnected" },
      { comparisonId: 11, status: "shared-physical-support" },
    ]);
    expect(shared.branches[0]).toMatchObject({ genomeBearingCopySites: 1,
      copyAssociatedBoundCarrierMass: 300 });
  });

  it("keeps birth child identity across a later census rebase, rather than counting parent-family copies", () => {
    const born = state(100, [[0, 300], [3, 300]]);
    const c = census({ cfg, step: 100, cells: born.cells, genomeHead: born.genome });
    const event = { step: 100, kind: "budding", parent: 10, child: 11 } as const;
    const references = resetBirthReferences(c, [event], event,
      id => id === 10 ? 0 : id === 11 ? 1 : null);
    const birthMap = ResetOriginMap.atPhysicalCensus(cfg, 100, born.cells, born.genome);
    const first = birthMap.compose(snapshot(100, 200, [[0, 0], [3, 3]]));
    const second = first.compose(snapshot(200, 300, [[0, 0], [4, 3]]));
    const later = state(300, [[0, 300], [4, 300]]);
    const sampled = resetFollowupSample(cfg, references, second,
      later.cells, later.genome, rule);
    expect(sampled.branches.map(x => x.genomeBearingCopySites)).toEqual([1, 1]);
    expect(sampled.comparisons[0].status).toBe("sampled-disconnected");
    // The broad parent at t−100 can have copies elsewhere. They do not count as child persistence.
    const noChild = first.compose(snapshot(200, 300, [[0, 0], [4, 0]]));
    const loss = resetFollowupSample(cfg, references, noChild,
      later.cells, later.genome, rule);
    expect(loss.branches[0].status).toBe("observed-copy-loss");
  });

  it("retains unavailable parent-ID candidate without requiring parent survival", () => {
    const born = state(100, [[3, 300], [5, 300]]);
    const c = census({ cfg, step: 100, cells: born.cells, genomeHead: born.genome });
    const event = { step: 100, kind: "fission", parent: 10,
      focalChild: 12, children: [11, 12] } as const;
    const references = resetBirthReferences(c,
      [{ step: 100, kind: "fission", parent: 10, children: [11, 12] }],
      { ...event, children: [...event.children] },
      id => id === 12 ? 0 : id === 11 ? 1 : null);
    const sample = resetFollowupSample(cfg, references,
      ResetOriginMap.atPhysicalCensus(cfg, 100, born.cells, born.genome),
      born.cells, born.genome, rule);
    expect(sample.comparisons).toEqual([
      { comparisonId: 10, status: "unavailable-birth-support" },
      { comparisonId: 11, status: "sampled-disconnected" },
    ]);
    expect(() => resetBirthReferences(c, [], { ...event, children: [...event.children] },
      () => null)).toThrow(/exact emitted/);
  });

  it("distinguishes live copies below a graph threshold from copy loss", () => {
    const born = state(100, [[0, 300], [3, 300]]);
    const c = census({ cfg, step: 100, cells: born.cells, genomeHead: born.genome });
    const event = { step: 100, kind: "budding", parent: 10, child: 11 } as const;
    const references = resetBirthReferences(c, [event], event,
      id => id === 10 ? 0 : id === 11 ? 1 : null);
    const later = state(200, [[0, 300], [3, 20]]);
    const map = ResetOriginMap.atPhysicalCensus(cfg, 100, born.cells, born.genome)
      .compose(snapshot(100, 200, [[0, 0], [3, 3]]));
    const sampled = resetFollowupSample(cfg, references, map, later.cells,
      later.genome, { threshold: 48, neighbors: 4 });
    expect(sampled.branches[0]).toMatchObject({ status: "available",
      genomeBearingCopySites: 1, copyAssociatedBoundCarrierMass: 20,
      physicalComponents: [] });
    expect(sampled.comparisons[0].status).toBe("below-graph-threshold");
  });

  it("does not call an unknown copy path a lost or disconnected branch", () => {
    const born = state(100, [[0, 300], [3, 300]]);
    const c = census({ cfg, step: 100, cells: born.cells, genomeHead: born.genome });
    const event = { step: 100, kind: "budding", parent: 10, child: 11 } as const;
    const references = resetBirthReferences(c, [event], event,
      id => id === 10 ? 0 : id === 11 ? 1 : null);
    const origin = ResetOriginMap.atPhysicalCensus(cfg, 100, born.cells, born.genome);
    const later = state(200, [[0, 300], [3, 300]]);
    const missingFocal = origin.compose(snapshot(100, 200, [[0, 0]]));
    const ambiguous = resetFollowupSample(cfg, references, missingFocal,
      later.cells, later.genome, rule);
    expect(ambiguous.unknownGenomeBearingCopySites).toBe(1);
    expect(ambiguous.branches[0].status).toBe("unknown-copy-origin");
    expect(ambiguous.comparisons[0].status).toBe("unknown-copy-origin");
    const extra = state(200, [[0, 300], [3, 300], [5, 300]]);
    const map = origin.compose(snapshot(100, 200, [[0, 0], [3, 3]]));
    const partial = resetFollowupSample(cfg, references, map, extra.cells,
      extra.genome, rule);
    expect(partial.comparisons[0].status).toBe("known-copy-disconnected-unknown-origin");
  });
});
