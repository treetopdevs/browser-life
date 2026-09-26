import { describe, expect, it } from "vitest";
import { NN_BYTES, type Genome } from "@bl/schema";
import { geneticClusters, genomeDistance, m3Gate, mutateGenome, type Evaluation } from "@bl/search";

const genome = (fill: number): Genome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });
const ev = (regenerated: number, lightDependent = 16, reps = 16): Evaluation => ({
  survived: reps,
  recovered: reps,
  lightDependent,
  reps,
  individuals: 1,
  meanMass: 256,
  speed: 1,
  mass: 256,
  recovery: 1,
  regenerated,
  reproduction: 0,
});

describe("genetic clusters", () => {
  it("counts differing slots across weights and parameters", () => {
    const a = genome(1);
    const b = { ...genome(1), mu: 61 };
    b.weights[0] = 2;
    b.weights[5] = 3;
    expect(genomeDistance(a, a)).toBe(0);
    expect(genomeDistance(a, b)).toBe(3);
    expect(genomeDistance(genome(1), genome(2))).toBe(NN_BYTES);
  });

  it("links a mutant lineage into one cluster and keeps unrelated founders apart", () => {
    const f1 = genome(10), f2 = genome(-10);
    let g = f1;
    const lineage = [f1];
    for (let s = 1; s <= 8; s++) lineage.push((g = mutateGenome(g, s, 4)));
    // Single linkage: the tip may be far from the founder but joins via its ancestors.
    const ids = geneticClusters([...lineage, f2]);
    expect(new Set(ids.slice(0, lineage.length)).size).toBe(1);
    expect(ids[lineage.length]).not.toBe(ids[0]);
    expect(ids[0]).toBe(0);
  });
});

describe("M3 gate", () => {
  it("counts clusters of fresh-seed passers, not screening passers or near-duplicates", () => {
    const founders = Array.from({ length: 20 }, (_, i) => genome(i * 6 - 60));
    const mutants = founders.slice(0, 5).map((f, i) => mutateGenome(f, 100 + i, 2));
    const confirmations = [
      ...founders.map((g) => ({ genome: g, eval: ev(14) })),
      ...mutants.map((g) => ({ genome: g, eval: ev(16) })),
    ];
    expect(m3Gate(confirmations)).toEqual({ screened: 25, confirmed: 25, clusters: 20, met: true });

    // One founder fails on fresh seeds (13/16 = 0.8125 still passes; 12/16 does not);
    // its mutant still passes, so its cluster survives.
    confirmations[0] = { genome: founders[0], eval: ev(12) };
    expect(m3Gate(confirmations)).toMatchObject({ confirmed: 24, clusters: 20, met: true });

    // A founder with no passing relatives that dies in the light-control check drops its cluster.
    confirmations[19] = { genome: founders[19], eval: ev(16, 15) };
    expect(m3Gate(confirmations)).toMatchObject({ confirmed: 23, clusters: 19, met: false });
  });
});

describe("M3 gate boundaries (review)", () => {
  // g with the first `n` weights changed from 0 to 1.
  const at = (n: number, base = genome(0)): Genome => {
    const g = { ...base, weights: base.weights.slice() };
    for (let i = 0; i < n; i++) g.weights[i] = 1;
    return g;
  };

  it("joins genomes exactly CLUSTER_DISTANCE apart and separates CLUSTER_DISTANCE + 1", () => {
    expect(geneticClusters([genome(0), at(10)])).toEqual([0, 0]);
    expect(geneticClusters([genome(0), at(11)])).toEqual([0, 1]);
  });

  it("links through a bridge genome transitively", () => {
    // Ends are 20 slots apart; the bridge is 10 from each.
    expect(geneticClusters([genome(0), at(20), at(10)])).toEqual([0, 0, 0]);
    expect(geneticClusters([genome(0), at(20)])).toEqual([0, 1]);
  });

  it("accepts 13/16 and rejects 12/16", () => {
    expect(m3Gate([{ genome: genome(0), eval: ev(13) }], 1)).toMatchObject({ confirmed: 1, met: true });
    expect(m3Gate([{ genome: genome(0), eval: ev(12) }], 1)).toMatchObject({ confirmed: 0, met: false });
  });

  it("does not count confirmations with fewer than CONFIRM_REPS replicates", () => {
    const founders = Array.from({ length: 20 }, (_, i) => genome(i * 6 - 60));
    expect(m3Gate(founders.map((g) => ({ genome: g, eval: ev(1, 1, 1) })))).toEqual({ screened: 20, confirmed: 0, clusters: 0, met: false });
    expect(m3Gate(founders.map((g) => ({ genome: g, eval: ev(15, 15, 15) })))).toMatchObject({ confirmed: 0, met: false });
  });
});
