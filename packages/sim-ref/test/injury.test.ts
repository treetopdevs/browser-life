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
import { goldenCases } from "@bl/sim-gpu";
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

// Polymer shell (WorldConfig.injuryShell; runs/evolution-game/polymer-world/rule.md).

const wound = { injuryPeriod: 5, injuryRadius: 3, injuryProb: Math.floor(2 ** 32 / 60) } as const;

/**
 * Steps `sim` once and checks every cell against what the shell rule says. The pre-injury value of
 * each cell comes from the same step of a config without injury (a wound only touches its own cell's
 * output, after the passive decays), so the post-decay P that the threshold reads is exact.
 */
function stepChecked(sim: RefSim, cfg: WorldConfig, plain: WorldConfig): { shelled: number; lesioned: number } {
  const shell = cfg.injuryShell!;
  const step = sim.state.step;
  const nInj = new RefSim({ ...cloneState(sim.state), cfg: plain });
  nInj.step();
  const pre = nInj.state;
  const heat0 = sim.state.heatOut;
  sim.step();
  const post = sim.state;
  const injuryStep = (step + 1) % cfg.injuryPeriod! === 0;
  const Wd = cfg.tileW * (cfg.tilesX ?? 1);
  const n = post.cells.length / 7;
  let shelled = 0, lesioned = 0, dHeat = 0n;
  for (let i = 0; i < n; i++) {
    const g = (st: WorldState, ch: number) => st.cells[ch * n + i];
    const hit = injuryStep && sim.injured(i % Wd, Math.floor(i / Wd), step);
    if (!hit) {
      for (const ch of [CH.A, CH.B, CH.C, CH.P, CH.E, CH.S]) expect(g(post, ch)).toBe(g(pre, ch));
      continue;
    }
    const P = g(pre, CH.P), B = g(pre, CH.B), E = g(pre, CH.E), C = g(pre, CH.C);
    if (P >= shell) {
      shelled++;
      expect(g(post, CH.P)).toBe(P - shell);
      expect(g(post, CH.C)).toBe(C + shell);
      expect(g(post, CH.B)).toBe(B);
      expect(g(post, CH.E)).toBe(E);
      expect(g(post, CH.MOT)).toBe(g(pre, CH.MOT));
      // The lineage is kept unconditionally, including when the shell took the cell's last polymer (B = 0, P = shell).
      expect(post.genome[G.LIN_HI * n + i]).toBe(pre.genome[G.LIN_HI * n + i]);
      expect(post.genome[G.LIN_LO * n + i]).toBe(pre.genome[G.LIN_LO * n + i]);
      dHeat += BigInt(shell * (cfg.eP - cfg.eC));
    } else {
      if (B + P > 0) lesioned++;
      expect(g(post, CH.B) + g(post, CH.P) + g(post, CH.E)).toBe(0);
      expect(g(post, CH.C)).toBe(C + B + P);
      expect(post.genome[G.LIN_HI * n + i] | post.genome[G.LIN_LO * n + i]).toBe(0);
      dHeat += BigInt(B * (cfg.eB - cfg.eC) + P * (cfg.eP - cfg.eC) + E);
    }
  }
  expect(post.heatOut - heat0).toBe(pre.heatOut - heat0 + dHeat);
  return { shelled, lesioned };
}

describe("polymer shell config", () => {
  it("is absent from defaultConfig and validated as part of the injury keys", () => {
    expect("injuryShell" in defaultConfig()).toBe(false);
    expect(validateConfig(defaultConfig({ ...wound, injuryShell: 1 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ ...wound, injuryShell: 65535 }))).toEqual([]);
    for (const bad of [0, -1, 65536, 1.5, Number.NaN]) expect(validateConfig(defaultConfig({ ...wound, injuryShell: bad })).length).toBeGreaterThan(0);
    // Only valid with the three injury keys.
    expect(validateConfig(defaultConfig({ injuryShell: 4 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 5, injuryShell: 4 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ injuryPeriod: 5, injuryRadius: 3, injuryShell: 4 })).length).toBeGreaterThan(0);
  });
});

describe("polymer shell", () => {
  it("a shell that is never reached gives exactly plain injury", () => {
    const a = new RefSim(cloneState(world(defaultConfig({ ...physics, ...wound, injuryShell: 65535 }))));
    const b = new RefSim(cloneState(world(defaultConfig({ ...physics, ...wound }))));
    for (let k = 0; k < 300; k++) {
      a.step();
      b.step();
      expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
      expect(Array.from(a.state.genome)).toEqual(Array.from(b.state.genome));
      expect(a.state.heatOut).toBe(b.state.heatOut);
    }
    // The run did not hold 65535 polymer anywhere.
    for (let i = 0; i < N; i++) expect(a.state.cells[CH.P * N + i]).toBeLessThan(65535);
  }, 120_000);

  it("a wounded cell with P >= s keeps B, E and lineage and loses exactly s polymer to C; with P < s it is lesioned", () => {
    const cfg = defaultConfig({ ...physics, injuryPeriod: 1, injuryRadius: 0, injuryProb: 2 ** 32 - 1, injuryShell: 3 });
    const plain = defaultConfig(physics);
    const st = world(cfg);
    // Plant polymer on body cells: some above the shell, some below it, some none.
    let planted = 0;
    for (let i = 0; i < N; i++)
      if (st.cells[CH.B * N + i] > 0) {
        st.cells[CH.P * N + i] = [0, 1, 2, 3, 4, 40][planted++ % 6];
      }
    const sim = new RefSim(st);
    const { shelled, lesioned } = stepChecked(sim, cfg, plain);
    expect(planted).toBeGreaterThan(20);
    expect(shelled).toBeGreaterThan(5);
    expect(lesioned).toBeGreaterThan(5);
  });

  it("a shell that takes the last polymer of a B = 0 cell keeps the lineage; one polymer short, the cell is lesioned and cleared", () => {
    const cfg = defaultConfig({ ...physics, kPDecay: 0, injuryPeriod: 1, injuryRadius: 0, injuryProb: 2 ** 32 - 1, injuryShell: 3 });
    const plain = defaultConfig({ ...physics, kPDecay: 0 });
    const st = world(cfg);
    const planted: { i: number; P: number; hi: number; lo: number; E: number }[] = [];
    for (let i = 0; i < N && planted.length < 12; i++) {
      if (st.cells[CH.B * N + i] === 0 || (st.genome[G.LIN_HI * N + i] | st.genome[G.LIN_LO * N + i]) === 0) continue;
      const P = planted.length % 2 === 0 ? 3 : 2; // exactly the shell, then one short
      st.cells[CH.B * N + i] = 0;
      st.cells[CH.P * N + i] = P;
      st.cells[CH.E * N + i] = 7;
      planted.push({ i, P, hi: st.genome[G.LIN_HI * N + i], lo: st.genome[G.LIN_LO * N + i], E: 7 });
    }
    expect(planted.length).toBe(12);
    const sim = new RefSim(st);
    stepChecked(sim, cfg, plain);
    for (const c of planted) {
      const { cells, genome } = sim.state;
      if (c.P === 3) {
        // The step itself may grow B or add E from the cell's own chemistry; stepChecked pins those exactly. Here: P is gone, the body is not cleared.
        expect(cells[CH.P * N + c.i]).toBe(0);
        expect(cells[CH.E * N + c.i]).toBeGreaterThan(0);
        expect(genome[G.LIN_HI * N + c.i]).toBe(c.hi);
        expect(genome[G.LIN_LO * N + c.i]).toBe(c.lo);
      } else {
        expect([cells[CH.B * N + c.i], cells[CH.P * N + c.i], cells[CH.E * N + c.i]]).toEqual([0, 0, 0]);
        expect(genome[G.LIN_HI * N + c.i] | genome[G.LIN_LO * N + c.i]).toBe(0);
      }
    }
  });

  it("conserves matter and closes the energy ledger over a multi-step run, with both branches occurring", () => {
    const cfg = defaultConfig({ ...physics, injuryPeriod: 7, injuryRadius: 2, injuryProb: Math.floor(2 ** 32 / 150), injuryShell: 2 });
    const sim = new RefSim(cloneState(world(cfg)));
    const t0 = totalsOf(cfg, sim.state.cells);
    let shelled = 0, lesioned = 0;
    const plain = defaultConfig(physics);
    for (let k = 0; k < 400; k++) {
      // The first 120 steps also check every cell against the rule (both branches occur early, while polymer is still held).
      if (k < 120) {
        const r = stepChecked(sim, cfg, plain);
        shelled += r.shelled;
        lesioned += r.lesioned;
      } else sim.step();
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(t0.matter);
      expect(ledgerResidual(t0, sim.state)).toBe(0n);
    }
    expect(shelled).toBeGreaterThan(0);
    expect(lesioned).toBeGreaterThan(0);
  }, 120_000);

  it("both branches occur in the injury-shell golden run, and each cell follows the rule", () => {
    const gc = goldenCases().find((g) => g.name === "injury-shell")!;
    expect(gc.cfg.injuryShell).toBeGreaterThan(0);
    const { injuryPeriod, injuryRadius, injuryProb, injuryShell, ...rest } = gc.cfg;
    void injuryPeriod; void injuryRadius; void injuryProb; void injuryShell;
    const plain = rest as WorldConfig;
    const sim = new RefSim(cloneState(gc.init(gc.cfg)));
    let shelled = 0, lesioned = 0;
    for (let k = 0; k < gc.steps; k++) {
      const r = stepChecked(sim, gc.cfg, plain);
      shelled += r.shelled;
      lesioned += r.lesioned;
    }
    expect(shelled).toBeGreaterThan(0);
    expect(lesioned).toBeGreaterThan(0);
  }, 120_000);
});
