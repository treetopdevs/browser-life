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
    // With a limit it stops counting just past it, which is all threshold checks need.
    expect(genomeDistance(genome(1), genome(2), 10)).toBe(11);
    expect(genomeDistance(a, b, 10)).toBe(3);
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

import { Archive } from "@bl/search";

describe("lineage-aware archive", () => {
  // Differing mean mass puts each genome in its own behaviour cell.
  const evAt = (meanMass: number, regenerated = 0): Evaluation => ({ ...ev(regenerated, regenerated ? 16 : 0), meanMass });
  const variant = (base: Genome, i: number): Genome => {
    const g = { ...base, weights: base.weights.slice() };
    g.weights[i % NN_BYTES] = 1;
    return g;
  };

  it("tracks lineages across cells and keeps displaced members", () => {
    const arch = new Archive();
    const a = genome(10), b = genome(-10);
    for (let i = 0; i < 6; i++) arch.offer(variant(a, i), evAt(2 ** (7 + i)), 0);
    arch.offer(b, evAt(2 ** 7), 1); // same cell as a's first variant, lower or equal quality
    const ls = arch.lineages();
    expect(ls.map((l) => l.size).sort()).toEqual([1, 6]);
    expect(arch.elites().length).toBe(6); // b lost its cell but still has a lineage
  });

  it("merges lineages through a bridge genome", () => {
    const arch = new Archive();
    const base = genome(0);
    const far = { ...base, weights: base.weights.map((_, i) => (i < 20 ? 1 : 0)) };
    const mid = { ...base, weights: base.weights.map((_, i) => (i < 10 ? 1 : 0)) };
    arch.offer(base, evAt(256), 0);
    arch.offer(far, evAt(512), 0);
    expect(arch.lineages().length).toBe(2);
    arch.offer(mid, evAt(1024), 0);
    expect(arch.lineages().length).toBe(1);
  });

  it("picks parents evenly by lineage, not by cells held", () => {
    const arch = new Archive();
    const big = genome(10), small = genome(-10);
    for (let i = 0; i < 6; i++) arch.offer(variant(big, i), evAt(2 ** (7 + i)), 0);
    arch.offer(small, evAt(2 ** 7 * 1.5), 0);
    let fromSmall = 0;
    for (let s = 0; s < 2000; s++) if (arch.pickParent(s, 0)!.genome === small) fromSmall++;
    expect(fromSmall / 2000).toBeGreaterThan(0.4);
    expect(fromSmall / 2000).toBeLessThan(0.6);
  });

  it("prefers lineages with screening passers by passBias", () => {
    const arch = new Archive();
    const plain = genome(10), passer = genome(-10);
    arch.offer(plain, evAt(256), 0);
    arch.offer(passer, evAt(1024, 16), 0);
    let fromPasser = 0;
    for (let s = 0; s < 2000; s++) if (arch.pickParent(s, 1)!.genome === passer) fromPasser++;
    expect(fromPasser).toBe(2000);
  });

  it("rotates among tied best members so saturated lineages keep moving", () => {
    const arch = new Archive();
    const base = genome(10);
    const a1 = variant(base, 0), a2 = variant(base, 1);
    arch.offer(a1, evAt(256, 16), 0);
    arch.offer(a2, evAt(1024, 16), 0); // same quality (1), another cell
    expect(arch.lineages()[0].best.length).toBe(2);
    let fromA2 = 0;
    for (let s = 0; s < 2000; s++) if (arch.pickParent(s, 0)!.genome === a2) fromA2++;
    expect(fromA2 / 2000).toBeGreaterThan(0.4);
    expect(fromA2 / 2000).toBeLessThan(0.6);
  });

  it("mixes pass-restricted and uniform lineage choice at intermediate passBias", () => {
    const arch = new Archive();
    const p1 = genome(10), p2 = genome(-10), plain = genome(40);
    arch.offer(p1, evAt(256, 16), 0);
    arch.offer(p2, evAt(1024, 16), 0);
    arch.offer(plain, evAt(4096), 0);
    let fromPlain = 0;
    const n = 6000;
    for (let s = 0; s < n; s++) if (arch.pickParent(s, 0.5)!.genome === plain) fromPlain++;
    // Only the unrestricted half can pick it, one lineage in three: 1/6.
    expect(fromPlain / n).toBeGreaterThan(0.14);
    expect(fromPlain / n).toBeLessThan(0.19);
  });

});

import { parseProbability } from "@bl/search";

describe("probability flags", () => {
  it("accepts probabilities and refuses blank, non-numeric and out-of-range values", () => {
    expect(parseProbability("--pass-bias", "0.5")).toBe(0.5);
    expect(parseProbability("--pass-bias", "0")).toBe(0);
    expect(parseProbability("--pass-bias", "1")).toBe(1);
    for (const raw of ["", " ", "nope", "NaN", "Infinity", "-0.1", "1.5", undefined]) {
      expect(() => parseProbability("--pass-bias", raw)).toThrow(/probability/);
    }
  });
});
