import { describe, expect, it } from "vitest";
import { CH, buildWorld, cloneState, defaultConfig, ledgerResidual, totalsOf, type WorldState } from "@bl/schema";
import { RefSim, sobelGrad } from "@bl/sim-ref";

/** Compares cells/genome/ledger only, ignoring config (two states may legitimately carry different `kAdhesion`s while adhesion is off). */
function samePhysics(a: WorldState, b: WorldState): boolean {
  return (
    a.step === b.step &&
    a.lightIn === b.lightIn &&
    a.heatOut === b.heatOut &&
    a.flux.every((f, k) => f === b.flux[k]) &&
    a.cells.length === b.cells.length &&
    a.cells.every((v, k) => v === b.cells[k]) &&
    a.genome.length === b.genome.length &&
    a.genome.every((v, k) => v === b.genome[k])
  );
}

describe("sobelGrad (adhesion's polymer gradient)", () => {
  it("points toward the denser neighbour, symmetrically", () => {
    // A wall of polymer to the east (ne, e, se high) and none to the west:
    // the gradient should push +x and be flat in y (north/south symmetric).
    const [gx, gy] = sobelGrad(9000, 9000, 9000, 0, 0, 0, 500, 500);
    expect(gx).toBeGreaterThan(0);
    expect(gy).toBe(0);
  });

  it("is zero for a uniform neighbourhood", () => {
    expect(sobelGrad(7, 7, 7, 7, 7, 7, 7, 7)).toEqual([0, 0]);
  });
});

describe("adhesion actuator (WorldConfig.adhesion)", () => {
  // A polymer wall at column WALL, biomass one column west of it, nothing
  // else, uniform along y (translation-invariant, so every row behaves
  // identically and column totals are exact). No genome/lineage is planted,
  // so this exercises only the physical part of adhesion (flow/transport);
  // the controller and reactions never run.
  const WALL = 8;
  const BCOL = WALL - 1;
  const FAR = BCOL - 1; // the side away from the wall
  function wallWorld(adhesion: boolean) {
    const cfg = defaultConfig({
      tileW: 16,
      tileH: 16,
      kernelRadius: 3,
      seed: 1,
      motility: false,
      mutRate: 0,
      // A small biomass mass keeps alpha (the built-in crowding/anti-clumping
      // weight) tiny, so the baseline (adhesion off) case isn't dominated by
      // -alpha*gradM and the two runs are easy to tell apart.
      thetaMass: 2048,
      adhesion,
      kAdhesion: 1024,
    });
    const s = buildWorld(cfg, { nutrient: 0, founders: [] });
    const n = cfg.tileW * cfg.tileH;
    for (let y = 0; y < cfg.tileH; y++) {
      s.cells[CH.P * n + (y * cfg.tileW + WALL)] = 16000;
      s.cells[CH.B * n + (y * cfg.tileW + BCOL)] = 200;
    }
    return new RefSim(s);
  }

  function bAt(sim: RefSim, x: number): number {
    const n = sim.n;
    let total = 0;
    for (let y = 0; y < sim.H; y++) total += sim.state.cells[CH.B * n + (y * sim.W + x)];
    return total;
  }

  it("pulls biomass toward the polymer wall it is adjacent to", () => {
    const on = wallWorld(true);
    const off = wallWorld(false);
    on.step();
    off.step();
    // Both runs start identical except for the flag: adhesion must move
    // strictly more biomass onto the wall's cell, and strictly less away
    // from it (to FAR), than the disabled run.
    expect(bAt(on, WALL)).toBeGreaterThan(bAt(off, WALL));
    expect(bAt(on, FAR)).toBeLessThanOrEqual(bAt(off, FAR));
  });

  it("does not move any biomass when disabled, however large kAdhesion is", () => {
    const off = wallWorld(false);
    const s2 = buildWorld({ ...off.cfg, kAdhesion: 0 }, { nutrient: 0, founders: [] });
    const n = off.cfg.tileW * off.cfg.tileH;
    for (let y = 0; y < off.cfg.tileH; y++) {
      s2.cells[CH.P * n + (y * off.cfg.tileW + WALL)] = 16000;
      s2.cells[CH.B * n + (y * off.cfg.tileW + BCOL)] = 200;
    }
    const zeroGain = new RefSim(s2);
    off.step();
    zeroGain.step();
    expect(samePhysics(off.state, zeroGain.state)).toBe(true);
  });

  it("still conserves matter exactly and closes the energy ledger with adhesion on", () => {
    const sim = wallWorld(true);
    const start = totalsOf(sim.cfg, sim.state.cells);
    for (let i = 0; i < 40; i++) {
      sim.step();
      const t = totalsOf(sim.cfg, sim.state.cells);
      expect(t.matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
  });

  it("is off by default (unset, not `false`, so it never touches an existing config's digest)", () => {
    expect(defaultConfig().adhesion).toBeUndefined();
    expect("adhesion" in defaultConfig()).toBe(false);
    expect("kAdhesion" in defaultConfig()).toBe(false);
  });

  it("disabled runs are bit-identical whichever kAdhesion is configured", () => {
    const base = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 4, seed: 9 });
    const a = new RefSim(cloneState(buildWorld(base, { nutrient: 32, founders: [] })));
    const b = new RefSim(cloneState(buildWorld({ ...base, kAdhesion: 900 }, { nutrient: 32, founders: [] })));
    a.run(20);
    b.run(20);
    expect(samePhysics(a.state, b.state)).toBe(true);
  });
});
