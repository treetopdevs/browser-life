// The optional slab levers (docs/rules.md, "Optional slab levers"; docs/3d-rung1b-step-spec.md section 17) on the CPU
// reference: config validation, the founding options, exact matter and energy over random slabs with the levers on, the
// lever arithmetic on hand cases, and rpsMutate's operator. The GPU twin is checked by the golden cases in golden.ts.
import { describe, expect, it } from "vitest";
import {
  CH, G, MOT_ZERO3, cellCount, cloneState, defaultConfig, generalistGenome3, initWorld, ledgerResidual, presetById, slabSpotsWorld, stateHash, totalsOf,
  validateConfig, validateState3, type WorldConfig, type WorldState,
} from "@bl/schema";
import { RefSim3, mutateRps } from "@bl/sim-ref";
import { randomSlab, rng, slabCfg } from "./step3d-helpers.ts";

const sumC = (s: WorldState, z: number) => {
  const n = cellCount(s.cfg), WH = s.cfg.tileW * s.cfg.tileH;
  let a = 0;
  for (let i = z * WH; i < (z + 1) * WH; i++) a += s.cells[CH.C * n + i];
  return a;
};
const rpsKeys = { rpsTypes: 3, rpsRate: 64, rpsMin: 4, rpsKill: "vacancy" as const };

describe("slab levers: config", () => {
  it("are absent from defaultConfig and accepted in range on a slab", () => {
    const d = defaultConfig() as unknown as Record<string, unknown>;
    for (const k of ["sinkShift", "floorDecay", "upwellPeriod", "upwellShift", "rpsMutate"]) expect(k in d).toBe(false);
    for (const o of [{ sinkShift: 1 }, { sinkShift: 16 }, { floorDecay: 0 }, { floorDecay: 65535 }, { upwellPeriod: 1, upwellShift: 1 }, { upwellPeriod: 2 ** 31 - 1, upwellShift: 16 }] as Partial<WorldConfig>[])
      expect(validateConfig(slabCfg(o)), JSON.stringify(o)).toEqual([]);
  });
  it("refuses them out of range, on a 2D config, or upwelling half-set", () => {
    for (const o of [{ sinkShift: 0 }, { sinkShift: 17 }, { sinkShift: 1.5 }, { floorDecay: -1 }, { floorDecay: 65536 }, { upwellPeriod: 10 }, { upwellShift: 2 }, { upwellPeriod: 0, upwellShift: 1 }, { upwellPeriod: 5, upwellShift: 0 }] as Partial<WorldConfig>[])
      expect(validateConfig(slabCfg(o)).length, JSON.stringify(o)).toBeGreaterThan(0);
    for (const o of [{ sinkShift: 2 }, { floorDecay: 10 }, { upwellPeriod: 5, upwellShift: 2 }] as Partial<WorldConfig>[])
      expect(validateConfig(defaultConfig(o)).join()).toMatch(/slab lever/);
  });
  it("rpsMutate lifts only the vacancy kill's mutRate 0 rule; every earlier refusal stands", () => {
    expect(validateConfig(slabCfg({ ...rpsKeys, mutRate: 0 }))).toEqual([]);
    expect(validateConfig(slabCfg({ ...rpsKeys, mutRate: 429_497 })).join()).toMatch(/mutRate 0/);
    for (const m of [0, 32768, 65536]) expect(validateConfig(slabCfg({ ...rpsKeys, mutRate: 429_497, rpsMutate: m }))).toEqual([]);
    for (const m of [-1, 65537, 0.5]) expect(validateConfig(slabCfg({ ...rpsKeys, mutRate: 429_497, rpsMutate: m })).join()).toMatch(/rpsMutate must be/);
    expect(validateConfig(slabCfg({ mutRate: 0, rpsMutate: 100 })).join()).toMatch(/only with the vacancy keys/);
    expect(validateConfig({ ...slabCfg({ ...rpsKeys, mutRate: 429_497, rpsMutate: 100 }), rpsEdge: 0 } as WorldConfig).join()).toMatch(/rpsFlip and rpsEdge/);
  });
});

describe("slab levers: founding options", () => {
  const cfg = slabCfg({ tileW: 32, tileH: 32, tileD: 32, seed: 7 });
  const g = generalistGenome3(50, 8);
  it("surface keeps x, y and the noise and moves every founder into the top layers", () => {
    const all = slabSpotsWorld(cfg, g, 8, 24, 64);
    const top = slabSpotsWorld(cfg, g, 8, 24, 64, { surface: 4 });
    const n = cellCount(cfg), WH = 32 * 32;
    let deep = 0, livingTop = 0;
    for (let i = 0; i < n; i++) if (top.genome[G.LIN_LO * n + i]) { livingTop++; if (Math.floor(i / WH) > 6) deep++; }
    expect(deep).toBe(0);
    expect(livingTop).toBeGreaterThan(0);
    expect(stateHash(slabSpotsWorld(cfg, g, 8, 24, 64, { surface: 32 }))).toBe(stateHash(all));
    expect(() => slabSpotsWorld(cfg, g, 8, 24, 64, { surface: 0 })).toThrow(/surface/);
    expect(() => slabSpotsWorld(cfg, g, 8, 24, 64, { surface: 33 })).toThrow(/surface/);
  });
  it("rpsCycle types the founders in a ring with the MOT mirror set, and needs the vacancy keys", () => {
    const rc = slabCfg({ tileW: 32, tileH: 32, tileD: 32, seed: 7, ...rpsKeys, mutRate: 429_497, rpsMutate: 32768 });
    const s = slabSpotsWorld(rc, g, 8, 24, 64, { rpsCycle: 3 });
    expect(validateState3(s)).toEqual([]);
    const n = cellCount(rc);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (!(s.genome[i] | s.genome[n + i])) continue;
      const p1 = s.genome[G.PARAM1 * n + i], t = (p1 >>> 8) & 255, m = (p1 >>> 16) & 255;
      expect(m).toBe(1 << ((t + 1) % 3));
      expect(s.cells[CH.MOT * n + i]).toBe((MOT_ZERO3 | (m << 24)) >>> 0);
      seen.add(`${t}`);
    }
    expect([...seen].sort()).toEqual(["0", "1", "2"]);
    expect(() => slabSpotsWorld(cfg, g, 8, 24, 64, { rpsCycle: 3 })).toThrow(/vacancy keys/);
  });
  it("go through InitParams only for slab-spots, and leave the preset's own start alone", () => {
    const p = presetById("slab-spots")!;
    const c = slabCfg({ tileW: 32, tileH: 32, tileD: 32 });
    expect(stateHash(initWorld(c, { ...p.init, surface: 32 }))).toBe(stateHash(initWorld(c, p.init)));
    expect(() => initWorld(defaultConfig({ tileW: 32, tileH: 32 }), { kind: "generalist", founders: 2, nutrient: 8, biomass: 8, surface: 4 })).toThrow(/slab-spots/);
  });
});

describe("slab levers: the reference", () => {
  it("conserves matter and closes the energy ledger over random slabs with every lever on", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 7);
      const s = randomSlab(seed, { sinkShift: 1 + (r() % 8), floorDecay: r() % 65536, upwellPeriod: 1 + (r() % 4), upwellShift: 1 + (r() % 4) });
      const n = cellCount(s.cfg);
      for (let i = 0; i < n; i++) { s.cells[CH.C * n + i] += r() % 5; s.cells[CH.A * n + i] += r() % 5; }
      const t0 = totalsOf(s.cfg, s.cells);
      const sim = new RefSim3(cloneState(s));
      sim.run(6);
      expect(totalsOf(s.cfg, sim.state.cells).matter).toBe(t0.matter);
      expect(ledgerResidual(t0, sim.state)).toBe(0n);
      expect(validateState3(sim.state)).toEqual([]);
    }
  });

  it("sinking moves waste down and never across the floor; it is a no-op at the floor layer", () => {
    // Inert chemistry (all rates 0, no diffusion of C) so only the lever moves C.
    const still = { kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0, kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0, dtQ: 0, diffA: 0, diffC: 0, diffS: 0 };
    const s = initWorld(slabCfg({ ...still, sinkShift: 1 }), { kind: "slab-spots", founders: 0, nutrient: 0, biomass: 0 });
    const n = cellCount(s.cfg), WH = 256;
    for (let i = 0; i < WH; i++) s.cells[CH.C * n + i] = 1000; // layer 0
    for (let i = 7 * WH; i < 8 * WH; i++) s.cells[CH.C * n + i] = 50; // the floor
    const sim = new RefSim3(s);
    sim.step();
    // half (in expectation, stochastic rounding of exact halves gives exactly half) of layer 0 went to layer 1
    expect(sumC(sim.state, 0)).toBe(500 * WH);
    expect(sumC(sim.state, 1)).toBe(500 * WH);
    expect(sumC(sim.state, 7)).toBe(50 * WH);
    for (let k = 0; k < 40; k++) sim.step();
    expect(sumC(sim.state, 7)).toBeGreaterThan(900 * WH);
    expect([0, 1, 2, 3, 4, 5, 6, 7].reduce((a, z) => a + sumC(sim.state, z), 0)).toBe(1050 * WH);
  });

  it("floor decay turns floor waste into nutrient with heat q (eC - eA), and touches no other layer", () => {
    const still = { kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0, kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0, dtQ: 0, diffA: 0, diffC: 0, diffS: 0 };
    const s = initWorld(slabCfg({ ...still, floorDecay: 32768, eA: 0, eC: 3 }), { kind: "slab-spots", founders: 0, nutrient: 0, biomass: 0 });
    const n = cellCount(s.cfg);
    s.cells.fill(64, CH.C * n, (CH.C + 1) * n);
    const sim = new RefSim3(s);
    sim.step();
    expect(sumC(sim.state, 6)).toBe(64 * 256);
    expect(sumC(sim.state, 7)).toBe(32 * 256);
    expect(sim.state.heatOut).toBe(BigInt(32 * 256 * 3));
    expect(sim.state.flux[9]).toBe(BigInt(32 * 256)); // booked as abio
  });

  it("upwelling swaps a fraction with the mirror layer only on its period, and keeps column totals", () => {
    const still = { kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0, kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0, dtQ: 0, diffA: 0, diffC: 0, diffS: 0 };
    const s = initWorld(slabCfg({ ...still, upwellPeriod: 3, upwellShift: 1 }), { kind: "slab-spots", founders: 0, nutrient: 0, biomass: 0 });
    const n = cellCount(s.cfg), WH = 256;
    for (let i = 7 * WH; i < 8 * WH; i++) { s.cells[CH.C * n + i] = 400; s.cells[CH.A * n + i] = 200; }
    const sim = new RefSim3(s);
    sim.step(); sim.step(); // steps 0 and 1: not on the period
    expect(sumC(sim.state, 0)).toBe(0);
    sim.step(); // step 2 = upwellPeriod - 1
    expect(sumC(sim.state, 0)).toBe(200 * WH);
    expect(sumC(sim.state, 7)).toBe(200 * WH);
    let a0 = 0;
    for (let i = 0; i < WH; i++) a0 += sim.state.cells[CH.A * n + i];
    expect(a0).toBe(100 * WH);
  });

  it("mutateRps flips one mask bit or relabels and clears the new own bit, never touching motGain or byte 3", () => {
    const n = 1;
    for (let k = 0; k < 2000; k++) {
      const r = rng(k + 1);
      const K = 3 + (r() % 6);
      const t = r() % K;
      let m = r() % (1 << K);
      m &= ~(1 << t);
      const genome = new Uint32Array(49);
      genome[G.PARAM1] = ((r() & 0xff) | (t << 8) | (m << 16)) >>> 0;
      const before = genome[G.PARAM1];
      const which = r(), delta = r();
      mutateRps(genome, n, 0, K, which, delta);
      const p1 = genome[G.PARAM1], t2 = (p1 >>> 8) & 255, m2 = (p1 >>> 16) & 255;
      expect(p1 & 0xff).toBe(before & 0xff);
      expect(p1 >>> 24).toBe(0);
      expect(t2).toBeLessThan(K);
      expect(m2 >> K).toBe(0);
      expect(m2 & (1 << t2)).toBe(0);
      const other = (t + 1 + (delta % (K - 1))) % K;
      expect(other).not.toBe(t);
      if ((which & 0xff) < 128) expect([t2, m2]).toEqual([t, m ^ (1 << other)]);
      else expect([t2, m2]).toEqual([other, m & ~(1 << other)]);
    }
  });

  it("with rpsMutate a vacancy-kill world mutates types and masks and stays a valid RPS state", () => {
    const c = slabCfg({ tileW: 16, tileH: 16, tileD: 8, seed: 11, ...rpsKeys, rpsMin: 1, rpsRate: 4096, mutRate: 42_949_673, rpsMutate: 65536 });
    const s = slabSpotsWorld(c, generalistGenome3(c.defaultMu, c.defaultSigma), 24, 48, 64, { rpsCycle: 3 });
    const t0 = totalsOf(c, s.cells);
    const sim = new RefSim3(s);
    const ev = sim.run(20);
    expect(ev.length).toBeGreaterThan(10);
    expect(validateState3(sim.state)).toEqual([]);
    expect(ledgerResidual(t0, sim.state)).toBe(0n);
    const n = cellCount(c);
    const kinds = new Set<number>();
    for (let i = 0; i < n; i++) if (sim.state.genome[i] | sim.state.genome[n + i]) kinds.add(sim.state.genome[G.PARAM1 * n + i] >>> 8);
    expect(kinds.size).toBeGreaterThan(3); // the three founders' (type, mask) pairs plus mutants
  });
});
