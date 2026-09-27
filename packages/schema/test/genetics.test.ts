// packages/schema/src/genetics.ts: genomeDistance/geneticClusters moved here
// out of packages/search/src/mapelites.ts (island-biogeography analysis in
// @bl/metrics needs them without importing @bl/search -- see genetics.ts's
// doc comment). Confirms the moved code behaves identically to the
// hand-worked examples that used to live next to it in mapelites.ts, and
// that @bl/search's re-export still round-trips.
import { describe, expect, it } from "vitest";
import { NN_BYTES, geneticClusters, genomeDistance, type Genome } from "@bl/schema";
import { geneticClusters as searchGeneticClusters, genomeDistance as searchGenomeDistance } from "@bl/search";

const genome = (fill: number): Genome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });

// g with the first `n` weights changed from 0 to 1.
const at = (n: number, base = genome(0)): Genome => {
  const g = { ...base, weights: base.weights.slice() };
  for (let i = 0; i < n; i++) g.weights[i] = 1;
  return g;
};

describe("@bl/schema genetics", () => {
  it("joins genomes exactly CLUSTER_DISTANCE apart and separates CLUSTER_DISTANCE + 1", () => {
    expect(geneticClusters([genome(0), at(10)])).toEqual([0, 0]);
    expect(geneticClusters([genome(0), at(11)])).toEqual([0, 1]);
  });

  it("links through a bridge genome transitively", () => {
    // Ends are 20 slots apart; the bridge is 10 from each.
    expect(geneticClusters([genome(0), at(20), at(10)])).toEqual([0, 0, 0]);
    expect(geneticClusters([genome(0), at(20)])).toEqual([0, 1]);
  });

  it("counts differing slots across weights and parameters", () => {
    const a = genome(1);
    const b = { ...genome(1), mu: 61 };
    b.weights[0] = 2;
    b.weights[5] = 3;
    expect(genomeDistance(a, a)).toBe(0);
    expect(genomeDistance(a, b)).toBe(3);
  });
});

describe("@bl/search re-export round-trips", () => {
  it("is the same implementation as @bl/schema's", () => {
    const genomes = [genome(0), at(10), at(20)];
    expect(searchGeneticClusters(genomes)).toEqual(geneticClusters(genomes));
    expect(searchGenomeDistance(genomes[0], genomes[1])).toBe(genomeDistance(genomes[0], genomes[1]));
  });
});
