import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  INJURY_MAX_RADIUS,
  M3_FOUNDERS,
  RND,
  buildWorld,
  cellBase,
  cloneState,
  defaultConfig,
  draw,
  founderGenome,
  ledgerResidual,
  totalsOf,
  validateConfig,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";

// Recurring injury (WorldConfig.injuryPeriod; docs/sandbox-ownership.md).

const W = 24;
const N = W * W;
const physics = { tileW: W, tileH: W, kernelRadius: 3, seed: 67, mutRate: 60_000_000 } as const;

/** Four M3 founders in contact on a 24 x 24 tile. */
function world(cfg: WorldConfig): WorldState {
  return buildWorld(cfg, {
    nutrient: 32,
    founders: [0, 1, 2, 5].map((f, k) => ({ x: 6 + 12 * (k & 1), y: 6 + 12 * (k >> 1), radius: 5, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })),
  });
}

describe("recurring injury config", () => {
  it("is absent from defaultConfig and validated when set", () => {
    const d = defaultConfig();
    expect("injuryPeriod" in d || "injuryRadius" in d || "injuryProb" in d).toBe(false);
    expect(validateConfig(defaultConfig({ injuryPeriod: 13, injuryRadius: 3, injuryProb: 100_000 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ injuryPeriod: 13 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 0, injuryRadius: 3, injuryProb: 1 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 1, injuryRadius: INJURY_MAX_RADIUS + 1, injuryProb: 1 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 1, injuryRadius: 3, injuryProb: 0 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 1, injuryRadius: 3, injuryProb: 2 ** 32 })).length).toBeGreaterThan(0);
    // A disc must fit a tile without wrapping onto itself.
    expect(validateConfig(defaultConfig({ tileW: 8, tileH: 8, kernelRadius: 3, injuryPeriod: 1, injuryRadius: 4, injuryProb: 1 })).length).toBeGreaterThan(0);
  });
});

describe("recurring injury", () => {
  it("equals a plain step followed by applyLesion at every wound centre", () => {
    const injury = { injuryPeriod: 5, injuryRadius: 3, injuryProb: Math.floor(2 ** 32 / 60) };
    const cfgI = defaultConfig({ ...physics, ...injury });
    const cfgP = defaultConfig(physics);
    const a = new RefSim(cloneState(world(cfgI)));
    const b = new RefSim(cloneState(world(cfgP)));
    let events = 0, centres = 0, destroyed = 0n;
    for (let k = 0; k < 60; k++) {
      const step = b.state.step;
      a.step();
      b.step();
      if ((step + 1) % injury.injuryPeriod === 0) {
        events++;
        const before = totalsOf(cfgP, b.state.cells);
        for (let j = 0; j < N; j++)
          if (draw(cellBase(cfgP.seed, step, j), RND.INJURY) < injury.injuryProb) {
            centres++;
            applyLesion(b, j % W, Math.floor(j / W), injury.injuryRadius);
          }
        destroyed += BigInt(totalsOf(cfgP, b.state.cells).C) - BigInt(before.C);
      }
      expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
      expect(Array.from(a.state.genome)).toEqual(Array.from(b.state.genome));
      expect(a.state.heatOut).toBe(b.state.heatOut);
      expect(a.state.lightIn).toBe(b.state.lightIn);
    }
    // The comparison was not vacuous: wounds fell on bound matter.
    expect(events).toBe(12);
    expect(centres).toBeGreaterThan(20);
    expect(destroyed > 0n).toBe(true);
  });

  it("keeps wounds inside their own tile, at the largest radius a tile allows", () => {
    // Two 24 x 24 tiles side by side, radius 11: a centre near a tile edge must wound the far side of
    // its own tile (applyLesion wraps inside the tile), never the neighbouring tile.
    const two = { ...physics, tilesX: 2 } as const;
    const injury = { injuryPeriod: 3, injuryRadius: 11, injuryProb: Math.floor(2 ** 32 / 500) };
    const cfgI = defaultConfig({ ...two, ...injury }), cfgP = defaultConfig(two);
    const init = (cfg: WorldConfig) =>
      buildWorld(cfg, { nutrient: 32, founders: [0, 1, 2, 5, 3, 4].map((f, k) => ({ x: 6 + 12 * (k % 4), y: 6 + 12 * (k >> 2), radius: 5, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })) });
    const a = new RefSim(cloneState(init(cfgI))), b = new RefSim(cloneState(init(cfgP)));
    const W2 = 2 * W, N2 = W2 * W;
    let centres = 0, edge = 0;
    for (let k = 0; k < 30; k++) {
      const step = b.state.step;
      a.step();
      b.step();
      if ((step + 1) % injury.injuryPeriod === 0)
        for (let j = 0; j < N2; j++)
          if (draw(cellBase(cfgP.seed, step, j), RND.INJURY) < injury.injuryProb) {
            centres++;
            const x = j % W2;
            if (x % W < 11 || x % W >= W - 11) edge++;
            applyLesion(b, x, Math.floor(j / W2), injury.injuryRadius);
          }
      expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
      expect(Array.from(a.state.genome)).toEqual(Array.from(b.state.genome));
      expect(a.state.heatOut).toBe(b.state.heatOut);
    }
    // Wounds fell, and most discs crossed a tile edge (radius 11 in a 24-cell tile).
    expect(centres).toBeGreaterThan(5);
    expect(edge).toBeGreaterThan(3);
  }, 120_000);

  it("leaves every step before the first injury step identical to RULE_VERSION 1", () => {
    const a = new RefSim(cloneState(world(defaultConfig({ ...physics, injuryPeriod: 1000, injuryRadius: 3, injuryProb: 2 ** 31 }))));
    const b = new RefSim(cloneState(world(defaultConfig(physics))));
    a.run(300);
    b.run(300);
    expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
    expect(Array.from(a.state.genome)).toEqual(Array.from(b.state.genome));
    expect(a.state.heatOut).toBe(b.state.heatOut);
  });

  it("conserves matter and closes the energy ledger every step for 2,000 steps", () => {
    const cfg = defaultConfig({ ...physics, injuryPeriod: 13, injuryRadius: 2, injuryProb: Math.floor(2 ** 32 / 3000) });
    const sim = new RefSim(cloneState(world(cfg)));
    const t0 = totalsOf(cfg, sim.state.cells);
    let cleared = 0;
    for (let k = 0; k < 2000; k++) {
      const step = sim.state.step;
      const injuryStep = (step + 1) % 13 === 0;
      // Cells holding bound matter that this step's wounds cover (the wound is applied after transport,
      // so "holding" is judged on the pre-step state; what matters is that they end the step empty).
      const hit: number[] = [];
      if (injuryStep) for (let i = 0; i < N; i++) if (sim.injured(i % W, Math.floor(i / W), step)) hit.push(i);
      const bound0 = hit.filter((i) => sim.state.cells[CH.B * N + i] + sim.state.cells[CH.P * N + i] > 0).length;
      sim.step();
      for (const i of hit) {
        expect(sim.state.cells[CH.B * N + i] + sim.state.cells[CH.P * N + i]).toBe(0);
        expect(sim.state.genome[G.LIN_HI * N + i] | sim.state.genome[G.LIN_LO * N + i]).toBe(0);
      }
      cleared += bound0;
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(t0.matter);
      expect(ledgerResidual(t0, sim.state)).toBe(0n);
    }
    // Wounds covered many cells that held bound matter, every wounded cell ended its step empty,
    // and the world survived them.
    expect(cleared).toBeGreaterThan(100);
    expect(BigInt(totalsOf(cfg, sim.state.cells).B) > 0n).toBe(true);
  }, 120_000);
});
