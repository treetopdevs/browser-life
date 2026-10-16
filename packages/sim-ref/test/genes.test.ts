// Capability genes (WorldConfig.genes, the game kernel line): the gate, the
// cost, the flip and the layout, and that a config without the keys is
// RULE_VERSION 1 to the bit (golden-hashes.test.ts pins that too).
import { describe, expect, it } from "vitest";
import {
  CH,
  FLUX_NAMES,
  G,
  GENE_BIT,
  GENE_SHIFT,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  cellCount,
  decodeGenome,
  defaultConfig,
  encodeGenome,
  founderGenome,
  genomeDistance,
  ledgerResidual,
  m3World,
  totalsOf,
  validateConfig,
  type Genome,
  type WorldConfig,
} from "@bl/schema";
import { RefSim, flipGene } from "@bl/sim-ref";

const base = defaultConfig({ tileW: 40, tileH: 40, kernelRadius: 5, seed: 89, mutRate: 60_000_000 });
const FX_DECOMP = FLUX_NAMES.indexOf("decomp");
const geneMask = 1 << (GENE_SHIFT + GENE_BIT.DECOMP);
const founders = (genes: boolean): Genome[] => M3_FOUNDERS.map((f) => ({ ...founderGenome(f), ...(genes ? { genes: 1 } : {}) }));

describe("capability genes", () => {
  it("validateConfig: the three keys go together and exclude shapeReach and neutral", () => {
    expect(validateConfig(base)).toEqual([]);
    expect(validateConfig({ ...base, genes: "decomp", kGene: 100, geneFlip: 1 })).toEqual([]);
    expect(validateConfig({ ...base, genes: "decomp" })).toEqual(["genes, kGene and geneFlip are set together"]);
    expect(validateConfig({ ...base, kGene: 100 })).toEqual(["genes, kGene and geneFlip are set together"]);
    expect(validateConfig({ ...base, genes: "decomp", kGene: 65536, geneFlip: 1 })).toContain("kGene must be an integer in 0..65535");
    expect(validateConfig({ ...base, genes: "decomp", kGene: 1, geneFlip: 2 ** 32 })).toContain("geneFlip must be an integer in 0..2^32-1");
    expect(validateConfig({ ...base, genes: "other" as WorldConfig["genes"], kGene: 1, geneFlip: 1 })).toContain("genes must be one of decomp");
    expect(validateConfig({ ...base, genes: "decomp", kGene: 1, geneFlip: 1, shapeReach: 5 })).toContain("genes and shapeReach are exclusive (both use PARAM1 byte 3)");
    expect(validateConfig({ ...base, genes: "decomp", kGene: 1, geneFlip: 1, neutral: true })).toContain("genes are not defined with the neutral shadow (the reference genome has none)");
  });

  it("encodes the gene byte in PARAM1 byte 3 and decodes it only under the genes layout", () => {
    const g: Genome = { ...founderGenome(M3_FOUNDERS[3]), genes: 1 };
    const words = encodeGenome(g, 0, 1);
    expect(words[G.PARAM1] >>> GENE_SHIFT).toBe(1);
    expect(words[G.PARAM1] & 0xffffff).toBe(encodeGenome(founderGenome(M3_FOUNDERS[3]), 0, 1)[G.PARAM1]);
    const under = decodeGenome(words, { genes: true });
    expect(under.genes).toBe(1);
    expect(under.rings).toBeUndefined();
    expect(encodeGenome(under, 0, 1)).toEqual(words);
    // Without the layout the byte reads as the far-ring offset, exactly as before genes existed.
    const legacy = decodeGenome(words);
    expect(legacy.genes).toBeUndefined();
    expect(legacy.rings).toEqual([0, 0, 1]);
    expect(encodeGenome(legacy, 0, 1)).toEqual(words);
    // A genome without the gene decodes with neither field under either layout.
    const off = encodeGenome(founderGenome(M3_FOUNDERS[3]), 0, 1);
    expect(decodeGenome(off, { genes: true }).genes).toBeUndefined();
    expect(decodeGenome(off, { genes: true }).rings).toBeUndefined();
    expect(() => encodeGenome({ ...g, rings: [0, 0, 5] }, 0, 1)).toThrow(/both a far-ring offset and gene bits/);
    expect(() => encodeGenome({ ...g, genes: 256 }, 0, 1)).toThrow(/expected a byte/);
    expect(genomeDistance(under, founderGenome(M3_FOUNDERS[3]))).toBe(1);
  });

  it("flipGene toggles the decomposition bit", () => {
    const cfg: WorldConfig = { ...base, genes: "decomp", kGene: 100, geneFlip: 1 };
    const genome = new Uint32Array(GENOME_CHANNELS);
    genome[G.PARAM1] = 37;
    flipGene(genome, 1, 0, cfg, 5);
    expect(genome[G.PARAM1]).toBe((37 | geneMask) >>> 0);
    flipGene(genome, 1, 0, cfg, 0);
    expect(genome[G.PARAM1]).toBe(37);
  });

  it("cells without the gene never decompose; the same world without genes does", () => {
    const cfg: WorldConfig = { ...base, genes: "decomp", kGene: 100, geneFlip: 0 };
    const gated = new RefSim(m3World(cfg, 12, 32, 64, founders(false)));
    const plain = new RefSim(m3World(base, 12, 32, 64, founders(false)));
    gated.run(60);
    plain.run(60);
    expect(gated.state.flux[FX_DECOMP]).toBe(0n);
    expect(plain.state.flux[FX_DECOMP]).toBeGreaterThan(0n);
    expect(gated.state.flux[FLUX_NAMES.indexOf("resp")]).toBeGreaterThan(0n);
  });

  it("every founder carrying the gene at no cost and no flips is RULE_VERSION 1 to the bit", () => {
    const cfg: WorldConfig = { ...base, genes: "decomp", kGene: 0, geneFlip: 0 };
    const withGenes = new RefSim(m3World(cfg, 12, 32, 64, founders(true)));
    const plain = new RefSim(m3World(base, 12, 32, 64, founders(false)));
    withGenes.run(60);
    plain.run(60);
    expect(withGenes.state.cells).toEqual(plain.state.cells);
    expect(withGenes.state.flux).toEqual(plain.state.flux);
    expect(withGenes.state.lightIn).toBe(plain.state.lightIn);
    expect(withGenes.state.heatOut).toBe(plain.state.heatOut);
    const n = cellCount(cfg);
    const a = withGenes.state.genome, b = plain.state.genome;
    for (let g = 0; g < GENOME_CHANNELS; g++)
      for (let i = 0; i < n; i++) {
        if ((a[G.LIN_HI * n + i] | a[G.LIN_LO * n + i]) === 0) continue;
        if (g === G.PARAM1) {
          expect(a[g * n + i] & geneMask).toBe(geneMask);
          expect((a[g * n + i] & ~geneMask) >>> 0).toBe(b[g * n + i]);
        } else expect(a[g * n + i]).toBe(b[g * n + i]);
      }
  });

  it("carrying the gene costs: carriers hold less E than the same world at kGene 0", () => {
    const paid: WorldConfig = { ...base, genes: "decomp", kGene: 2000, geneFlip: 0, kDecomp: 0 };
    const free: WorldConfig = { ...paid, kGene: 0 };
    const a = new RefSim(m3World(paid, 12, 32, 64, founders(true)));
    const b = new RefSim(m3World(free, 12, 32, 64, founders(true)));
    a.run(30);
    b.run(30);
    const n = cellCount(paid);
    const sumE = (s: Uint32Array) => s.subarray(CH.E * n, (CH.E + 1) * n).reduce((x, y) => x + y, 0);
    expect(sumE(a.state.cells)).toBeLessThan(sumE(b.state.cells));
    expect(a.state.heatOut).toBeGreaterThan(b.state.heatOut);
  });

  it("non-carriers pay no catalysis work on the DECOMP output", () => {
    // With kDecomp 0 the reaction makes nothing either way; RULE_VERSION 1 still charges work on the DECOMP
    // output, the gene-off cell does not, so it keeps more E and exports less heat.
    const gated: WorldConfig = { ...base, kDecomp: 0, genes: "decomp", kGene: 100, geneFlip: 0 };
    const plain: WorldConfig = { ...base, kDecomp: 0 };
    const a = new RefSim(m3World(gated, 12, 32, 64, founders(false)));
    const b = new RefSim(m3World(plain, 12, 32, 64, founders(false)));
    a.run(30);
    b.run(30);
    const n = cellCount(gated);
    const sumE = (s: Uint32Array) => s.subarray(CH.E * n, (CH.E + 1) * n).reduce((x, y) => x + y, 0);
    expect(sumE(a.state.cells)).toBeGreaterThan(sumE(b.state.cells));
    expect(a.state.heatOut).toBeLessThan(b.state.heatOut);
  });

  /** Gains and losses among the step's mutation events, each child's gene bit against its parent lineage's. */
  function flipsOver(sim: RefSim, n: number, steps: number, start: ReturnType<typeof totalsOf>, cfg: WorldConfig): { gains: number; losses: number; events: number } {
    let gains = 0, losses = 0, events = 0;
    for (let s = 0; s < steps; s++) {
      const before = sim.state.genome.slice();
      const ev = sim.step().events;
      for (const e of ev) {
        events++;
        // The parent lineage's genome is immutable, so any cell holding its id before the step shows its gene bit.
        let parentOn: boolean | null = null;
        for (let j = 0; j < n; j++)
          if (before[G.LIN_HI * n + j] === e.parentHi && before[G.LIN_LO * n + j] === e.parentLo) {
            parentOn = (before[G.PARAM1 * n + j] & geneMask) !== 0;
            break;
          }
        expect(parentOn).not.toBeNull();
        const childOn = (sim.state.genome[G.PARAM1 * n + e.childLo] & geneMask) !== 0;
        if (!parentOn && childOn) gains++;
        if (parentOn && !childOn) losses++;
      }
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
    return { gains, losses, events };
  }

  it("flips happen both ways, conserve matter and close the ledger; none without geneFlip", () => {
    const mixed = founders(false).map((f, k) => (k % 2 ? { ...f, genes: 1 } : f));
    const cfg: WorldConfig = { ...base, genes: "decomp", kGene: 100, geneFlip: 2 ** 31 };
    const init = m3World(cfg, 12, 32, 64, mixed);
    const n = cellCount(cfg);
    const r = flipsOver(new RefSim(init), n, 120, totalsOf(cfg, init.cells), cfg);
    expect(r.gains).toBeGreaterThan(0);
    expect(r.losses).toBeGreaterThan(0);
    // Negative control: the same world with geneFlip 0 mutates as much and never flips.
    const none: WorldConfig = { ...cfg, geneFlip: 0 };
    const init0 = m3World(none, 12, 32, 64, mixed);
    const r0 = flipsOver(new RefSim(init0), n, 120, totalsOf(none, init0.cells), none);
    expect(r0.events).toBeGreaterThan(0);
    expect(r0.gains + r0.losses).toBe(0);
  });
});
