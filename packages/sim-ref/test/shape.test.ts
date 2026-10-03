import { describe, expect, it } from "vitest";
import {
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_BYTES,
  SHAPE_BASE,
  buildKernel,
  buildShapeKernel,
  buildWorld,
  cloneState,
  decodeGenome,
  defaultConfig,
  encodeGenome,
  founderGenome,
  genomeDistance,
  genomeFromHex,
  genomeHex,
  ledgerResidual,
  shapeRings,
  totalsOf,
  validateConfig,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, mutateInPlace, shapeDensity } from "@bl/sim-ref";

// Heritable kernel shape (WorldConfig.shapeReach; docs/sandbox-cells.md).

const W = 32;
const N = W * W;
const physics = { tileW: W, tileH: W, kernelRadius: 4, seed: 71, mutRate: 60_000_000 } as const;
const ringed = (f: number, rings: [number, number, number]): Genome => ({ ...founderGenome(M3_FOUNDERS[f]), rings });

/** Four founders in contact on a 32 x 32 tile; `genomes` replaces the M3 genomes. */
function world(cfg: WorldConfig, genomes: Genome[] = [0, 1, 2, 5].map((f) => founderGenome(M3_FOUNDERS[f]))): WorldState {
  return buildWorld(cfg, {
    nutrient: 32,
    founders: genomes.map((genome, k) => ({ x: 8 + 16 * (k & 1), y: 8 + 16 * (k >> 1), radius: 6, genome, biomass: 64, energy: 128 })),
  });
}

describe("heritable shape config and kernel", () => {
  it("is absent from defaultConfig and validated when set", () => {
    expect("shapeReach" in defaultConfig()).toBe(false);
    expect(shapeRings(defaultConfig())).toBe(0);
    expect(validateConfig(defaultConfig({ shapeReach: 9 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ shapeReach: 13 }))).toEqual([]);
    expect(shapeRings(defaultConfig({ shapeReach: 9 }))).toBe(2);
    expect(shapeRings(defaultConfig({ shapeReach: 13 }))).toBe(3);
    expect(validateConfig(defaultConfig({ shapeReach: 8 })).join()).toMatch(/shapeReach/);
    expect(validateConfig(defaultConfig({ shapeReach: 17 })).join()).toMatch(/shapeReach/);
    expect(validateConfig(defaultConfig({ shapeReach: 9.5 })).join()).toMatch(/shapeReach/);
    // The inner ring needs taps, and every allowed far ring has some.
    expect(validateConfig(defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 2, shapeReach: 4 })).join()).toMatch(/kernelRadius >= 3/);
    for (let R = 3; R <= 16; R++)
      for (let reach = R; reach <= 16; reach++) {
        const k = buildShapeKernel(R, reach);
        expect(k.ringSum[0]).toBeGreaterThan(0);
        expect(k.ringSum[1]).toBeGreaterThan(0);
        expect(k.ringSum[2] > 0).toBe(reach > R);
      }
    // The far ring must fit inside a tile.
    expect(validateConfig(defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 4, shapeReach: 12 })).join()).toMatch(/shapeReach/);
  });

  it("partitions the RULE_VERSION 1 taps into two rings, in order, and appends a far shell", () => {
    for (const [R, reach] of [[9, 9], [9, 13], [5, 8], [4, 4]] as const) {
      const base = buildKernel(R), k = buildShapeKernel(R, reach);
      expect(k.sum).toBe(base.sum);
      expect(k.ringSum[0] + k.ringSum[1]).toBe(base.sum);
      for (let t = 0; t < base.count; t++) {
        expect([k.taps[t * 4], k.taps[t * 4 + 1], k.taps[t * 4 + 2]]).toEqual([base.taps[t * 4], base.taps[t * 4 + 1], base.taps[t * 4 + 2]]);
        const d2 = k.taps[t * 4] ** 2 + k.taps[t * 4 + 1] ** 2;
        expect(k.taps[t * 4 + 3]).toBe(4 * d2 < R * R ? 0 : 1);
      }
      expect(k.ringSum[0]).toBeGreaterThan(0);
      expect(k.ringSum[1]).toBeGreaterThan(0);
      let far = 0;
      for (let t = base.count; t < k.count; t++) {
        const d2 = k.taps[t * 4] ** 2 + k.taps[t * 4 + 1] ** 2;
        expect(k.taps[t * 4 + 3]).toBe(2);
        expect(d2 > R * R && d2 < reach * reach).toBe(true);
        expect(k.taps[t * 4 + 2]).toBeGreaterThan(0);
        expect(k.taps[t * 4 + 2]).toBeLessThanOrEqual(255);
        far += k.taps[t * 4 + 2];
      }
      expect(far).toBe(k.ringSum[2]);
      expect(k.rings).toBe(reach > R ? 3 : 2);
      expect(k.ringSum[2] > 0).toBe(reach > R);
      // Bound used by ringMean: (conv % sum) * 256 stays in u32.
      for (const s of k.ringSum) expect(s).toBeLessThan(2 ** 24);
    }
  });
});

describe("shapeDensity", () => {
  const bytes = (v0: number, v1: number, v2: number) => ((v0 & 0xff) | ((v1 & 0xff) << 8) | ((v2 & 0xff) << 16)) >>> 0;
  const sums = [1532, 18532, 6288] as const;
  const exact = (conv: number[], w: number[], massUnit: number) => {
    const den = w[0] + w[1] + w[2];
    if (den === 0) return 0;
    let num = 0n;
    for (let k = 0; k < 3; k++) num += BigInt(w[k]) * (sums[k] ? (BigInt(conv[k]) * 256n) / BigInt(sums[k]) : 0n);
    const u = Number(((num / BigInt(den)) * 4n) / BigInt(massUnit));
    return Math.min(u, 4095);
  };

  it("is RULE_VERSION 1's density at neutral weights, for any far byte without a far ring", () => {
    let seed = 12345;
    const rnd = (m: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % m);
    for (let t = 0; t < 2000; t++) {
      const conv = [rnd(sums[0] * 16384), rnd(sums[1] * 16384), rnd(sums[2] * 16384)];
      const rv1 = Math.min(Math.floor((Math.floor((conv[0] + conv[1]) / (sums[0] + sums[1])) * 1024) / 256), 4095);
      expect(shapeDensity(conv, sums, 3, 0, 256)).toBe(rv1);
      expect(shapeDensity(conv, sums, 2, bytes(0, 0, rnd(256)), 256)).toBe(rv1);
      // A negative far byte is weight 0, so still neutral.
      expect(shapeDensity(conv, sums, 3, bytes(0, 0, -1 - rnd(128)), 256)).toBe(rv1);
    }
  });

  it("is the weighted mean of the ring means otherwise, with weights floored at 0", () => {
    let seed = 777;
    const rnd = (m: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % m);
    for (let t = 0; t < 4000; t++) {
      const conv = [rnd(sums[0] * 16384), rnd(sums[1] * 16384), rnd(sums[2] * 16384)];
      const v = [rnd(256) - 128, rnd(256) - 128, rnd(256) - 128];
      const w = [Math.max(SHAPE_BASE + v[0], 0), Math.max(SHAPE_BASE + v[1], 0), Math.max(v[2], 0)];
      if (w[0] === SHAPE_BASE && w[1] === SHAPE_BASE && w[2] === 0) continue;
      const mu = [16, 256, 4096][t % 3];
      expect(shapeDensity(conv, sums, 3, bytes(v[0], v[1], v[2]), mu)).toBe(exact(conv, w, mu));
    }
    // Extremes: every cell at the mass cap, the largest weights.
    const full = sums.map((s) => s * 16383);
    expect(shapeDensity(full, sums, 3, bytes(127, 127, 127), 16)).toBe(4095);
    expect(shapeDensity(full, sums, 3, bytes(127, 127, 127), 4096)).toBe(exact(full, [191, 191, 127], 4096));
    // Both near rings at weight 0 and no far weight: density 0.
    expect(shapeDensity(full, sums, 3, bytes(-64, -64, 0), 256)).toBe(0);
    expect(shapeDensity(full, sums, 3, bytes(-128, -100, -5), 256)).toBe(0);
    // Only the far ring: its mean alone.
    expect(shapeDensity([0, 0, sums[2] * 100], sums, 3, bytes(-64, -64, 10), 256)).toBe(400);
  });
});

describe("ring weights in the genome", () => {
  it("round-trip through encode, decode and hex, and leave RULE_VERSION 1 genomes untouched", () => {
    const plain = founderGenome(M3_FOUNDERS[0]);
    const words = encodeGenome(plain, 0, 1);
    expect(words[G.PARAM1] >>> 8).toBe(0);
    expect(decodeGenome(words).rings).toBeUndefined();
    const g = ringed(0, [-64, 127, 5]);
    const w = encodeGenome(g, 0, 1);
    expect(w[G.PARAM1] & 0xff).toBe(plain.motGain);
    expect(decodeGenome(w).rings).toEqual([-64, 127, 5]);
    expect(genomeFromHex(genomeHex(g)).rings).toEqual([-64, 127, 5]);
    expect(genomeDistance(plain, g)).toBe(3);
    expect(genomeDistance(g, ringed(0, [-64, 127, 6]))).toBe(1);
    expect(() => encodeGenome(ringed(0, [0, 200, 0]), 0, 1)).toThrow(/ring 1/);
  });

  it("mutate through one slot per ring, clamped, without touching the motility gain", () => {
    const all = (cfg: WorldConfig, p1: number, slot: number, delta: number) => {
      const g = new Uint32Array(GENOME_CHANNELS);
      g[G.PARAM1] = p1 >>> 0;
      // deltaRnd % (2 * mutStep + 1) - mutStep == delta
      mutateInPlace(g, 1, 0, cfg, slot, delta + cfg.mutStep);
      return g;
    };
    const run = (cfg: WorldConfig, p1: number, slot: number, delta: number) => all(cfg, p1, slot, delta)[G.PARAM1];
    const far = defaultConfig({ shapeReach: 13 }), near = defaultConfig({ shapeReach: 9 }), rv1 = defaultConfig();
    // Slot counts: RV1 wraps at NN_BYTES + 3, near at + 5, far at + 6. The wrapped slot is controller
    // byte 0, so the whole genome is compared: byte 0 of W0 becomes 5 and nothing else changes.
    const byte0 = new Uint32Array(GENOME_CHANNELS);
    byte0[G.PARAM1] = 7;
    byte0[G.W0] = 5;
    expect(Array.from(all(rv1, 7, NN_BYTES + 3, 5))).toEqual(Array.from(byte0));
    expect(Array.from(all(near, 7, NN_BYTES + 5, 5))).toEqual(Array.from(byte0));
    expect(Array.from(all(far, 7, NN_BYTES + 6, 5))).toEqual(Array.from(byte0));
    // One slot below each wrap is the last ring slot (or, under RV1, the gain), not a controller byte.
    expect(all(near, 7, NN_BYTES + 4, 5)[G.W0]).toBe(0);
    expect(all(far, 7, NN_BYTES + 5, 5)[G.W0]).toBe(0);
    expect(run(rv1, 7, NN_BYTES + 2, 5)).toBe(12);
    // Ring slots write bytes 1..3 and keep the gain byte.
    expect(run(far, 7, NN_BYTES + 3, 5)).toBe(7 | (5 << 8));
    expect(run(far, 7, NN_BYTES + 4, -9)).toBe((7 | ((-9 & 0xff) << 16)) >>> 0);
    expect(run(far, 7, NN_BYTES + 5, 12)).toBe((7 | (12 << 24)) >>> 0);
    // Clamps: near rings to [-SHAPE_BASE, 127], the far ring to [0, 127].
    expect(run(far, (-60 & 0xff) << 8, NN_BYTES + 3, -20) >>> 8).toBe(-SHAPE_BASE & 0xff);
    expect(run(far, 120 << 16, NN_BYTES + 4, 20) >>> 16).toBe(127);
    expect(run(far, 3 << 24, NN_BYTES + 5, -20) >>> 24).toBe(0);
    expect(run(far, 120 << 24, NN_BYTES + 5, 20) >>> 24).toBe(127);
    // The gain slot still preserves the ring bytes.
    expect(run(far, 0x0a0b0c07, NN_BYTES + 2, 5)).toBe(0x0a0b0c0c);
  });
});

describe("heritable shape dynamics", () => {
  it("is RULE_VERSION 1 state for state while every ring byte is zero", () => {
    // No mutation, so no ring byte ever leaves zero; reach 4 (two rings) and reach 7 (far ring unused).
    for (const shapeReach of [4, 7]) {
      const a = new RefSim(cloneState(world(defaultConfig({ ...physics, mutRate: 0, shapeReach }))));
      const b = new RefSim(cloneState(world(defaultConfig({ ...physics, mutRate: 0 }))));
      a.run(150);
      b.run(150);
      expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
      expect(Array.from(a.state.genome)).toEqual(Array.from(b.state.genome));
      expect(a.state.heatOut).toBe(b.state.heatOut);
      expect(Array.from(a.affinityField)).toEqual(Array.from(b.affinityField));
    }
  });

  it("changes the affinity field and the trajectory when a genome reweights its rings", () => {
    const cfg = defaultConfig({ ...physics, mutRate: 0, shapeReach: 7 });
    const plain = new RefSim(cloneState(world(cfg)));
    const variants: [number, number, number][] = [[40, 0, 0], [0, -40, 0], [0, 0, 30]];
    for (const rings of variants) {
      const sim = new RefSim(cloneState(world(cfg, [0, 1, 2, 5].map((f) => ringed(f, rings)))));
      sim.step();
      const p = new RefSim(cloneState(world(cfg)));
      p.step();
      let diff = 0;
      for (let i = 0; i < N; i++) if (sim.affinityField[i] !== p.affinityField[i]) diff++;
      expect(diff).toBeGreaterThan(20);
    }
    // Without a far ring the third byte is inert.
    const near = defaultConfig({ ...physics, mutRate: 0, shapeReach: 4 });
    const a = new RefSim(cloneState(world(near, [0, 1, 2, 5].map((f) => ringed(f, [0, 0, 30])))));
    const b = new RefSim(cloneState(world(near)));
    a.run(40);
    b.run(40);
    expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
    void plain;
  });

  it("conserves matter and closes the energy ledger for 1,500 steps while ring mutants arise", () => {
    const cfg = defaultConfig({ ...physics, shapeReach: 7 });
    const sim = new RefSim(cloneState(world(cfg, [ringed(0, [0, 0, 0]), ringed(1, [20, -30, 0]), ringed(2, [-64, 10, 40]), ringed(5, [0, 0, 25])])));
    const t0 = totalsOf(cfg, sim.state.cells);
    for (let k = 0; k < 1500; k++) {
      sim.step();
      if (k % 10 === 9) {
        expect(totalsOf(cfg, sim.state.cells).matter).toBe(t0.matter);
        expect(ledgerResidual(t0, sim.state)).toBe(0n);
      }
    }
    // Mutation reached the ring slots: living cells now carry ring bytes no founder had.
    const seen = new Set<number>();
    for (let i = 0; i < N; i++) if (sim.state.genome[G.LIN_HI * N + i] | sim.state.genome[G.LIN_LO * N + i]) seen.add(sim.state.genome[G.PARAM1 * N + i] >>> 8);
    expect(seen.size).toBeGreaterThan(4);
    expect(BigInt(totalsOf(cfg, sim.state.cells).B) > 0n).toBe(true);
  }, 120_000);
});
