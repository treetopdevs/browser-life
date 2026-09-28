import { describe, expect, it } from "vitest";
import { NN_BYTES, M3_FOUNDERS, decodeGenome, encodeGenome, defaultConfig } from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { mutationNeighborhood, selectPilotProposals, genomeFromManifest } from "../src/mutation-neighborhood.ts";

describe("M3 mutation neighborhood", () => {
  it("keeps every independent raw draw and matches the reference mutation byte for byte", () => {
    const n = mutationNeighborhood(610000001, 16);
    expect(n.founders).toHaveLength(M3_FOUNDERS.length);
    expect(n.proposals).toHaveLength(M3_FOUNDERS.length * 3 * 16);
    expect(n.counts.proposals).toBe(n.proposals.length);
    for (const row of n.proposals) {
      const parent = genomeFromManifest(n.founders[row.founderIndex].genome);
      const words = encodeGenome(parent, 0, 0);
      mutateInPlace(words, 1, 0, defaultConfig({ mutRate: 0, mutStep: row.scale }), row.rawWhich, row.rawDelta);
      expect(row.slot).toBe(row.rawWhich % (NN_BYTES + 3));
      expect(row.signedDelta).toBe((row.rawDelta % (2 * row.scale + 1)) - row.scale || 1);
      expect(row.genome.words).toEqual(Array.from(words));
      expect(genomeFromManifest(row.genome)).toEqual(decodeGenome(words));
      expect(row.effectiveChange).toBe(row.after - row.before);
      expect(row.unchangedAfterClamp).toBe(row.after === row.before);
    }
  });

  it("is reproducible and retains clamp and duplicate outcomes", () => {
    const a = mutationNeighborhood(610000001, 64);
    expect(mutationNeighborhood(610000001, 64)).toEqual(a);
    expect(mutationNeighborhood(610000002, 64).proposals[0].rawWhich).not.toBe(a.proposals[0].rawWhich);
    expect(a.counts.unchangedAfterClamp).toBeGreaterThan(0);
    expect(a.counts.duplicateResults).toBeGreaterThan(0);
    for (const p of a.proposals.filter((p) => p.unchangedAfterClamp))
      expect(p.duplicateOf).toBe(`f${p.founderIndex}:parent`);
    for (const p of a.proposals.filter((p) => p.duplicateOf !== null)) {
      const earlier = p.duplicateOf!.endsWith(":parent")
        ? a.founders[p.founderIndex].genome
        : a.proposals.find((q) => q.id === p.duplicateOf)!.genome;
      expect(p.genome.key).toBe(earlier.key);
    }
  });

  it("spreads an unfiltered pilot over founders before taking another sample", () => {
    const n = mutationNeighborhood(610000001, 2);
    expect(selectPilotProposals(n, 4).map((p) => [p.founderIndex, p.scale, p.sampleIndex]))
      .toEqual([[0, 1, 0], [1, 4, 0], [2, 24, 0], [3, 1, 0]]);
    expect(() => mutationNeighborhood(1, 2)).toThrow(/reserved range/);
    expect(() => selectPilotProposals(n, 13)).toThrow(/0..12/);
  });
});
