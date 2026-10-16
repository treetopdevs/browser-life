// Capability genes (WorldConfig.genes): the lineage inspector replays a gene flip from the counter PRNG
// as react draws it, so applyMutation must reproduce every child genome of a world where genes flip.
import { describe, expect, it } from "vitest";
import { G, GENOME_CHANNELS, M3_FOUNDERS, cellCount, defaultConfig, founderGenome, m3World, type WorldConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { GENE_SLOT0, applyMutation, type Mutation } from "../src/genotype.ts";

/** Steps `steps` and replays every mutation event from its parent's words; returns the replayed mutations. */
function replayAll(cfg: WorldConfig, founderGenes: (k: number) => number, steps: number): Mutation[] {
  const genomes = M3_FOUNDERS.map((f, k) => ({ ...founderGenome(f), ...(founderGenes(k) ? { genes: founderGenes(k) } : {}) }));
  const sim = new RefSim(m3World(cfg, 12, 32, 64, genomes));
  const n = cellCount(cfg);
  const words = (genome: Uint32Array, i: number) => Uint32Array.from({ length: GENOME_CHANNELS }, (_, g) => genome[g * n + i]);
  const out: Mutation[] = [];
  for (let s = 0; s < steps; s++) {
    const before = sim.state.genome.slice();
    for (const e of sim.step().events) {
      // A lineage's genome is immutable, so any cell holding the parent's id before the step has its words.
      let parent: Uint32Array | null = null;
      for (let j = 0; j < n && !parent; j++) if (before[G.LIN_HI * n + j] === e.parentHi && before[G.LIN_LO * n + j] === e.parentLo) parent = words(before, j);
      expect(parent).not.toBeNull();
      const r = applyMutation(parent!, `${e.childHi}:${e.childLo}`, `${e.parentHi}:${e.parentLo}`, cfg);
      expect(Array.from(r.words)).toEqual(Array.from(words(sim.state.genome, e.childLo)));
      out.push(r.mutation);
    }
  }
  return out;
}

describe("lineage replay of gene flips", () => {
  it.each([
    ["decomp", 1],
    ["ladder", 2],
  ] as const)('reproduces every child genome under the "%s" set and names each gene it flips', (genes, count) => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 91, mutRate: 60_000_000, genes, kGene: 100, geneFlip: 2 ** 31 });
    const ms = replayAll(cfg, (k) => k % (1 << count), 60);
    const flips = ms.filter((m) => m.kind === "gene");
    expect(flips.length).toBeGreaterThan(0);
    expect(ms.length - flips.length).toBeGreaterThan(0);
    const names = ["gene decomposition", "gene polymer building"];
    for (let b = 0; b < count; b++) {
      const at = flips.filter((m) => m.slot === GENE_SLOT0 + b);
      expect(at.length).toBeGreaterThan(0);
      for (const m of at) {
        expect(m.locus).toBe(names[b]);
        expect(m.after).toBe(1 - m.before);
        expect(m.clamped).toBe(false);
      }
    }
    // No slot past the set's genes is ever drawn.
    expect(Math.max(...flips.map((m) => m.slot))).toBe(GENE_SLOT0 + count - 1);
  });
});
