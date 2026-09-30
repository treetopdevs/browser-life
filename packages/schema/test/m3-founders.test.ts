// Coverage for the M3-founded init kind (packages/schema/src/world.ts's
// `m3World`) and the "gradient-m3"/"spots-m3" presets that use it: the
// pre-registered ensemble now founds from the M3-confirmed genomes
// (packages/schema/src/founders.ts) instead of the hand-built generalist
// genome, which the M3 retest found never regenerates after a lesion.
import { describe, expect, it } from "vitest";
import {
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_BYTES,
  PRESETS,
  cellCount,
  defaultConfig,
  founderGenome,
  initWorld,
  m3World,
  presetConfig,
  presetIdentity,
  validateState,
  type WorldState,
} from "@bl/schema";

/** Decodes the genome words stored at cell `i` of `s` (channel-major layout). */
function genomeWordsAt(s: WorldState, i: number): number[] {
  const n = cellCount(s.cfg);
  return Array.from({ length: GENOME_CHANNELS }, (_, g) => s.genome[g * n + i]);
}

describe("m3World", () => {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4 });

  it("produces a valid initial state", () => {
    const s = m3World(cfg, M3_FOUNDERS.length, 32, 64);
    expect(validateState(s)).toEqual([]);
  });

  it("is deterministic for the same seed", () => {
    const a = m3World(cfg, M3_FOUNDERS.length, 32, 64);
    const b = m3World(cfg, M3_FOUNDERS.length, 32, 64);
    expect(a.cells).toEqual(b.cells);
    expect(a.genome).toEqual(b.genome);
  });

  it("places founders at a different layout than generalistWorld/soupWorld would (distinct hash salt: 197 vs. 31/131 in world.ts)", () => {
    // m3World deliberately uses its own salt so an m3-preset run never lands
    // on the same founder positions as a generalist/soup run at the same
    // seed; guarded here by comparing against the actual generalist output.
    const a = m3World(cfg, 6, 32, 64);
    const generalist = initWorld(cfg, { kind: "generalist", founders: 6, nutrient: 32, biomass: 64 });
    expect(a.cells).not.toEqual(generalist.cells);
  });

  it("assigns each founder a genome equal to founderGenome(M3_FOUNDERS[i % length]) (cycled for extra founders)", () => {
    // A bigger tile than the rest of this describe block's `cfg`: with
    // M3_FOUNDERS.length + 3 (16) radius-12 founders, the crowded 32x32 tile
    // used elsewhere here lets later founders fully overwrite an earlier
    // one's cells, leaving it with no surviving cell to read a genome back
    // from -- this needs every founder to keep at least one cell of its own.
    const bigCfg = defaultConfig({ tileW: 256, tileH: 256, kernelRadius: 9 });
    const n = cellCount(bigCfg);
    const count = M3_FOUNDERS.length + 3; // exercise the modulo wraparound
    const s = m3World(bigCfg, count, 32, 64);
    for (let i = 0; i < count; i++) {
      // Scan for one of this founder's own occupied cells by its (unnamespaced) lineage id, i + 1.
      let found = -1;
      for (let c = 0; c < n; c++) {
        if (s.genome[G.LIN_HI * n + c] === 0 && s.genome[G.LIN_LO * n + c] === i + 1) {
          found = c;
          break;
        }
      }
      expect(found).toBeGreaterThanOrEqual(0);
      const words = genomeWordsAt(s, found);
      const decoded = { mu: words[G.PARAM0] & 0xffff, sigma: words[G.PARAM0] >>> 16, motGain: words[G.PARAM1] & 0xff };
      const want = founderGenome(M3_FOUNDERS[i % M3_FOUNDERS.length]);
      expect(decoded.mu).toBe(want.mu);
      expect(decoded.sigma).toBe(want.sigma);
      expect(decoded.motGain).toBe(want.motGain);
      const gotWeights = Array.from({ length: NN_BYTES }, (_, b) => {
        const byte = (words[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff;
        return byte > 127 ? byte - 256 : byte;
      });
      expect(gotWeights).toEqual(Array.from(want.weights));
    }
  });

  it("gives founders the same lineage-id scheme as generalistWorld (unnamespaced: raw id = index + 1)", () => {
    const n = cellCount(cfg);
    const s = m3World(cfg, 4, 32, 64);
    const seenIds = new Set<number>();
    for (let c = 0; c < n; c++) {
      const hi = s.genome[G.LIN_HI * n + c];
      const lo = s.genome[G.LIN_LO * n + c];
      if (hi === 0 && lo !== 0) seenIds.add(lo);
    }
    expect([...seenIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("cycles an array `only` across discs (disc i gets only[i % length])", () => {
    const bigCfg = defaultConfig({ tileW: 256, tileH: 256, kernelRadius: 9 });
    const n = cellCount(bigCfg);
    const set = [founderGenome(M3_FOUNDERS[0]), founderGenome(M3_FOUNDERS[3]), founderGenome(M3_FOUNDERS[5])];
    const count = 7;
    const s = m3World(bigCfg, count, 32, 64, set);
    for (let i = 0; i < count; i++) {
      let found = -1;
      for (let c = 0; c < n; c++) {
        if (s.genome[G.LIN_HI * n + c] === 0 && s.genome[G.LIN_LO * n + c] === i + 1) {
          found = c;
          break;
        }
      }
      expect(found).toBeGreaterThanOrEqual(0);
      const words = genomeWordsAt(s, found);
      const want = set[i % set.length];
      expect(words[G.PARAM0] & 0xffff).toBe(want.mu);
      expect(words[G.PARAM0] >>> 16).toBe(want.sigma);
      expect(words[G.PARAM1] & 0xff).toBe(want.motGain);
    }
  });
});

describe("gradient-m3 / spots-m3 presets", () => {
  it("are registered, keep the same cfg as gradient/spots, and use the m3 init kind", () => {
    const spots = PRESETS.find((p) => p.id === "spots")!;
    const spotsM3 = PRESETS.find((p) => p.id === "spots-m3")!;
    const gradient = PRESETS.find((p) => p.id === "gradient")!;
    const gradientM3 = PRESETS.find((p) => p.id === "gradient-m3")!;
    expect(spotsM3).toBeDefined();
    expect(gradientM3).toBeDefined();
    expect(spotsM3.cfg).toEqual(spots.cfg);
    expect(gradientM3.cfg).toEqual(gradient.cfg);
    expect(spotsM3.init.kind).toBe("m3");
    expect(gradientM3.init.kind).toBe("m3");
    expect(spotsM3.init.founders).toBe(M3_FOUNDERS.length);
    expect(gradientM3.init.founders).toBe(M3_FOUNDERS.length);
  });

  it("initWorld builds a valid m3-founded world for both new presets", () => {
    for (const id of ["spots-m3", "gradient-m3"]) {
      const preset = PRESETS.find((p) => p.id === id)!;
      const cfg = presetConfig(preset, 7);
      const s = initWorld(cfg, preset.init);
      expect(validateState(s)).toEqual([]);
    }
  });

  it("presetIdentity is pinned for the 12-founder set and ignores init property order", () => {
    // The calibration pilot's manifests record these values (runs/calib-neutral).
    const gradientM3 = PRESETS.find((p) => p.id === "gradient-m3")!;
    const spotsM3 = PRESETS.find((p) => p.id === "spots-m3")!;
    expect(presetIdentity(gradientM3)).toBe("e1c93a9384b5d921");
    expect(presetIdentity(spotsM3)).toBe("a9f93070127a0c05");
    const { kind, founders, nutrient, biomass } = spotsM3.init;
    expect(presetIdentity({ ...spotsM3, init: { biomass, nutrient, founders, kind } })).toBe("a9f93070127a0c05");
    expect(presetIdentity({ ...spotsM3, init: { ...spotsM3.init, founders: founders - 1 } })).not.toBe("a9f93070127a0c05");
  });

  it("existing spots/gradient presets are unchanged (still generalist-founded)", () => {
    const spots = PRESETS.find((p) => p.id === "spots")!;
    const gradient = PRESETS.find((p) => p.id === "gradient")!;
    expect(spots.init.kind).toBe("generalist");
    expect(gradient.init.kind).toBe("generalist");
  });
});

describe("M3_FOUNDERS data", () => {
  it("has 12 entries, each decoding to NN_BYTES weights, passing its 32-replicate retest and pooling retest + replication", () => {
    expect(M3_FOUNDERS.length).toBe(12);
    for (const f of M3_FOUNDERS) {
      expect(f.retest.reps).toBe(32);
      expect(f.replication.reps).toBe(32);
      for (const k of ["survived", "regenerated", "lightDependent"] as const) {
        expect(f.retest[k]).toBeGreaterThanOrEqual(30);
        expect(f[k]).toBe(f.retest[k] + f.replication[k]);
      }
      expect(f.reps).toBe(64);
      const g = founderGenome(f);
      expect(g.weights.length).toBe(NN_BYTES);
      expect(g.mu).toBe(f.mu);
      expect(g.sigma).toBe(f.sigma);
      expect(g.motGain).toBe(f.motGain);
    }
  });

  it("has unique cluster ids", () => {
    const clusters = M3_FOUNDERS.map((f) => f.cluster);
    expect(new Set(clusters).size).toBe(clusters.length);
  });
});
