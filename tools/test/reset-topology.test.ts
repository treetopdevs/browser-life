import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, defaultConfig, type WorldState } from "@bl/schema";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { resetFragmentationFlags, resetTopology } from "../lib/reset-topology.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2 };
function state(step: number, sites: [number, number][]): WorldState {
  const s = allocState(cfg), n = cellCount(cfg); s.step = step;
  for (const [i, mass] of sites) {
    s.cells[CH.B * n + i] = mass;
    s.genome[G.LIN_LO * n + i] = 1;
  }
  return s;
}
function origin(step: number, assignments: [number, number][]): ResetOriginMap {
  const tags = new Uint32Array(cellCount(cfg));
  for (const [destination, source] of assignments) tags[destination] = source + 1;
  return ResetOriginMap.fromSnapshot({ step, referenceStep: step - 1,
    tags, diagnostics: new Uint32Array(tags.length * 10) });
}

describe("noncircular toroidal support geometry", () => {
  it("distinguishes diagonal contact and low-mass bridge from the historical graph", () => {
    const diagonal = state(1, [[0, 300], [9, 300]]);
    expect(resetTopology(cfg, diagonal.cells, { threshold: 48, neighbors: 4 }).components)
      .toHaveLength(2);
    expect(resetTopology(cfg, diagonal.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(1);
    const bridge = state(1, [[0, 300], [1, 47], [2, 300]]);
    expect(resetTopology(cfg, bridge.cells, { threshold: 48, neighbors: 4 }).components)
      .toHaveLength(2);
    expect(resetTopology(cfg, bridge.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(1);
  });

  it("wraps inside a tile but never connects across tile boundaries", () => {
    const one = state(1, [[0, 300], [7, 300]]);
    expect(resetTopology(cfg, one.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(1);
    const twoCfg = { ...cfg, tilesX: 2 };
    const two = allocState(twoCfg), n = cellCount(twoCfg);
    two.cells[CH.B * n + 7] = 300;
    two.cells[CH.B * n + 8] = 300;
    expect(resetTopology(twoCfg, two.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(2);
  });

  it("flags a split without demanding an old parent branch and annotates pre-existing neighbor support", () => {
    const prior = state(0, [[0, 100], [1, 100], [2, 100]]);
    const current = state(1, [[0, 300], [2, 300]]);
    const flags = resetFragmentationFlags(cfg, 1, prior.cells, current.cells,
      current.genome, origin(1, [[0, 0], [2, 2]]));
    expect(flags).toHaveLength(1);
    expect(flags[0].branches).toHaveLength(2);
    expect(flags[0].branches.every(x => x.currentMass === 300)).toBe(true);
    const neighborPrior = state(0, [[0, 300], [2, 300]]);
    const unchanged = resetFragmentationFlags(cfg, 1, neighborPrior.cells, current.cells,
      current.genome, origin(1, [[0, 0], [2, 2]]));
    expect(unchanged).toHaveLength(0);
    const copiedIntoNeighbor = resetFragmentationFlags(cfg, 1,
      neighborPrior.cells, current.cells, current.genome,
      origin(1, [[0, 0], [2, 0]]));
    expect(copiedIntoNeighbor).toHaveLength(1);
    expect(copiedIntoNeighbor[0].branches.find(x => x.currentComponent === 1))
      .toMatchObject({ preexistingOtherBoundSites: 1,
        preexistingOtherBoundCarrierMass: 300 });
  });

  it("keeps fusion and transient contact as separate physical samples", () => {
    const separated = state(0, [[0, 300], [2, 300]]);
    const contact = state(1, [[0, 300], [1, 1], [2, 300]]);
    expect(resetTopology(cfg, separated.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(2);
    expect(resetTopology(cfg, contact.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(1);
    expect(resetTopology(cfg, separated.cells, { threshold: 1, neighbors: 8 }).components)
      .toHaveLength(2);
    expect(resetFragmentationFlags(cfg, 1, separated.cells, contact.cells,
      contact.genome, origin(1, [[0, 0], [2, 2]]))).toHaveLength(0);
  });

  it("rejects a short one-step origin map before scoring fragmentation", () => {
    const prior = state(0, [[0, 300]]), current = state(1, [[0, 300]]);
    const short = ResetOriginMap.fromSnapshot({ step: 1, referenceStep: 0,
      tags: new Uint32Array([1]), diagnostics: new Uint32Array(10) });
    expect(() => resetFragmentationFlags(cfg, 1, prior.cells, current.cells,
      current.genome, short)).toThrow(/adjacent physical steps/);
  });
});
