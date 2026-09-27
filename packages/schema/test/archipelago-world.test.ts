// archipelagoWorld/archipelagoFounderLayout (packages/schema/src/world.ts):
// every tile of an archipelago run gets one founder per genome, laid out on
// the same grid, with grid-slot assignment counterbalanced per seed so a
// founder's identity is never confounded with its light-gradient position.
// Style: like packages/schema/test/migration.test.ts (hand-built
// WorldConfig, direct genome/channel inspection).
import { describe, expect, it } from "vitest";
import { G, GENOME_CHANNELS, archipelagoFounderLayout, archipelagoWorld, cellCount, decodeGenome, defaultConfig, emptyGenome, worldW, type WorldConfig } from "@bl/schema";

function baseCfg(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 2, kernelRadius: 2, seed: 1, ...overrides });
}

const genomeAt = (s: { cfg: WorldConfig; genome: Uint32Array }, x: number, y: number) => {
  const n = cellCount(s.cfg);
  const W = worldW(s.cfg);
  const i = y * W + x;
  const words = new Uint32Array(GENOME_CHANNELS);
  for (let g = 0; g < GENOME_CHANNELS; g++) words[g] = s.genome[g * n + i];
  return decodeGenome(words);
};

// Grid centers for a 4-founder layout on a 32x32 tile: cols=rows=2, step=16, so
// slot k sits at local (8,8), (24,8), (8,24), (24,24) -- see archipelagoFounderLayout.
const SLOT_LOCAL = [
  [8, 8],
  [24, 8],
  [8, 24],
  [24, 24],
];

function slotGenomes(cfg: WorldConfig, s: { cfg: WorldConfig; genome: Uint32Array }, tx: number, ty: number) {
  return SLOT_LOCAL.map(([lx, ly]) => genomeAt(s, tx * cfg.tileW + lx, ty * cfg.tileH + ly));
}

describe("archipelagoWorld", () => {
  it("stocks every tile with one founder per genome, at the same relative positions", () => {
    const cfg = baseCfg();
    const genomes = [emptyGenome(100, 20), emptyGenome(101, 20), emptyGenome(102, 20), emptyGenome(103, 20)];
    const s = archipelagoWorld(cfg, genomes);
    for (let ty = 0; ty < cfg.tilesY; ty++)
      for (let tx = 0; tx < cfg.tilesX; tx++) {
        const mus = new Set(slotGenomes(cfg, s, tx, ty).map((g) => g.mu));
        expect(mus).toEqual(new Set([100, 101, 102, 103]));
      }
  });

  it("grid-slot assignment is seed-dependent", () => {
    const cfg1 = baseCfg({ seed: 1 });
    const cfg2 = baseCfg({ seed: 2 });
    const genomes = [emptyGenome(100, 20), emptyGenome(101, 20), emptyGenome(102, 20), emptyGenome(103, 20)];
    const s1 = archipelagoWorld(cfg1, genomes);
    const s2 = archipelagoWorld(cfg2, genomes);
    const mus1 = slotGenomes(cfg1, s1, 0, 0).map((g) => g.mu);
    const mus2 = slotGenomes(cfg2, s2, 0, 0).map((g) => g.mu);
    expect(mus1).not.toEqual(mus2);
  });

  it("founders in different tiles and within the same tile get distinct lineage ids (buildWorld's validateState would throw otherwise)", () => {
    const cfg = baseCfg();
    const genomes = [emptyGenome(100, 20), emptyGenome(101, 20), emptyGenome(102, 20), emptyGenome(103, 20)];
    expect(() => archipelagoWorld(cfg, genomes)).not.toThrow();
  });

  it("every founder occurrence gets its own distinct lineage id, even across tiles sharing the same genome", () => {
    // "does not throw" alone is too weak: validateState's own uniqueness check only rejects cells
    // that share a lineage id but disagree on genome words -- founders across tiles legitimately
    // have the *same* genome (this experiment's whole point is stocking every tile with an
    // identical species pool), so a regression that reused one lineage id per genome across every
    // tile (rather than a fresh id per founder occurrence) would still pass validateState silently,
    // since the "duplicate" id's genome words always agree with themselves. Read the actual
    // LIN_HI/LIN_LO channels at every founder's known grid slot across all 4 tiles and assert all
    // 16 occurrences (4 genomes x 4 tiles) are pairwise distinct -- the real, semantic invariant
    // (per-tile lineage tracking/turnover bookkeeping depends on each occurrence being its own
    // lineage) that "not.toThrow()" cannot see.
    const cfg = baseCfg();
    const genomes = [emptyGenome(100, 20), emptyGenome(101, 20), emptyGenome(102, 20), emptyGenome(103, 20)];
    const s = archipelagoWorld(cfg, genomes);
    const n = cellCount(s.cfg);
    const W = worldW(s.cfg);
    const lineageIdAt = (x: number, y: number) => {
      const i = y * W + x;
      return `${s.genome[G.LIN_HI * n + i]}:${s.genome[G.LIN_LO * n + i]}`;
    };
    const ids: string[] = [];
    for (let ty = 0; ty < cfg.tilesY; ty++)
      for (let tx = 0; tx < cfg.tilesX; tx++)
        for (const [lx, ly] of SLOT_LOCAL) ids.push(lineageIdAt(tx * cfg.tileW + lx, ty * cfg.tileH + ly));
    expect(ids).toHaveLength(cfg.tilesX * cfg.tilesY * genomes.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("archipelagoFounderLayout", () => {
  it("throws when radius would be < 1", () => {
    expect(() => archipelagoFounderLayout(8, 8, 13)).toThrow(/do not fit/);
  });

  it("does not throw at the boundary where radius is exactly 1", () => {
    expect(archipelagoFounderLayout(16, 16, 13)).toEqual({ cols: 4, rows: 4, stepX: 4, stepY: 4, radius: 1 });
  });

  it("archipelagoWorld surfaces archipelagoFounderLayout's own error, not buildWorld's generic one", () => {
    const cfg = baseCfg({ tileW: 8, tileH: 8, kernelRadius: 2 });
    const genomes = Array.from({ length: 13 }, (_, i) => emptyGenome(100 + i, 20));
    expect(() => archipelagoWorld(cfg, genomes)).toThrow(/archipelagoFounderLayout.*do not fit/);
  });
});
