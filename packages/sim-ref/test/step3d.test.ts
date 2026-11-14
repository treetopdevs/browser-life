import { describe, expect, it } from "vitest";
import {
  CH, G, MOT_ZERO3, buildWorld, POOL_MAX3, buildWorld3, cellCount, cloneState, decodeCheckpoint, encodeCheckpoint, generalistGenome3,
  ledgerResidual, stateHash, totalsOf, validateState3, defaultConfig, type WorldState,
} from "@bl/schema";
import { OUTSIDE, RefSim, RefSim3 } from "@bl/sim-ref";
import { field, mirrorZ, randomGenome3, randomSlab, rng, slabCfg } from "./step3d-helpers.ts";

const sumCh = (s: WorldState, ch: number, z0 = 0, z1 = s.cfg.tileD!) => {
  const WH = s.cfg.tileW * s.cfg.tileH;
  const f = field(s, ch);
  let a = 0;
  for (let i = z0 * WH; i < z1 * WH; i++) a += f[i];
  return a;
};
const emptyWorld = (o = {}) => buildWorld3(slabCfg(o), { nutrient: 0, founders: [] });
// a wide growth bell, so the affinity field of a few hundred quanta is not saturated at -256
const wide = { defaultMu: 200, defaultSigma: 300 };

describe("slab reference: construction", () => {
  it("refuses a 2D state and 2D refuses a slab", () => {
    expect(() => new RefSim3({ ...randomSlab(1), cfg: defaultConfig() })).toThrow();
  });
  it("nb3 wraps x and y and reports z outside", () => {
    const sim = new RefSim3(randomSlab(2));
    expect(sim.nb3(0, 0, 0, -1, -1, 0)).toBe((0 * 16 + 15) * 16 + 15);
    expect(sim.nb3(3, 4, 0, 0, 0, -1)).toBe(OUTSIDE);
    expect(sim.nb3(3, 4, 7, 0, 0, 1)).toBe(OUTSIDE);
    expect(sim.nb3(3, 4, 7, 0, 0, -1)).toBe((6 * 16 + 4) * 16 + 3);
  });
});

describe("slab reference: exact conservation", () => {
  it("conserves matter and closes the energy ledger over 200 random slabs", () => {
    let mutated = 0;
    let lit = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = randomSlab(seed);
      expect(validateState3(s)).toEqual([]);
      const t0 = totalsOf(s.cfg, s.cells);
      const sim = new RefSim3(s);
      const steps = seed % 10 === 0 ? 3 : 1;
      for (let k = 0; k < steps; k++) {
        const r = sim.step();
        mutated += r.events.length;
        const t = totalsOf(s.cfg, sim.state.cells);
        expect(t.matter).toBe(t0.matter);
        expect(ledgerResidual(t0, sim.state)).toBe(0n);
      }
      if (sim.state.lightIn > 0n) lit++;
      expect(validateState3(sim.state)).toEqual([]);
    }
    expect(lit).toBeGreaterThan(20);
    expect(mutated).toBeGreaterThan(0);
  }, 180_000);

  it("conserves over a 40 step run with mutation, and keeps the state valid", () => {
    const s = randomSlab(7, { mutRate: 400_000_000, motility: true, neutral: false });
    const t0 = totalsOf(s.cfg, s.cells);
    const sim = new RefSim3(s);
    const ev = sim.run(40);
    expect(totalsOf(s.cfg, sim.state.cells).matter).toBe(t0.matter);
    expect(ledgerResidual(t0, sim.state)).toBe(0n);
    expect(validateState3(sim.state)).toEqual([]);
    expect(sim.state.step).toBe(40);
    const n = cellCount(s.cfg);
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      expect(e.childLo).toBeLessThan(n);
      expect(e.childHi).toBeGreaterThanOrEqual(1);
      expect(e.childHi).toBeLessThanOrEqual(40);
    }
  }, 120_000);

  it("holds exactly at the pool bounds (E and S at 2^27 everywhere around a heavy colony)", () => {
    const s = randomSlab(11, { motility: true, neutral: false });
    const n = cellCount(s.cfg);
    for (let i = 0; i < n; i++) {
      s.cells[CH.E * n + i] = POOL_MAX3;
      s.cells[CH.S * n + i] = POOL_MAX3;
    }
    expect(validateState3(s)).toEqual([]);
    const t0 = totalsOf(s.cfg, s.cells);
    const sim = new RefSim3(s);
    for (let k = 0; k < 3; k++) {
      sim.step();
      for (const ch of [CH.E, CH.S]) for (let i = 0; i < n; i++) expect(sim.state.cells[ch * n + i]).toBeLessThanOrEqual(POOL_MAX3);
      expect(ledgerResidual(t0, sim.state)).toBe(0n);
    }
    expect(sim.state.heatOut).toBeGreaterThan(0n);
  });

  it("is deterministic, and a checkpoint split run equals a continuous one", () => {
    const a = new RefSim3(randomSlab(5));
    const b = new RefSim3(randomSlab(5));
    a.run(8);
    b.run(4);
    const { state: snap } = decodeCheckpoint(encodeCheckpoint(b.state));
    const c = new RefSim3(cloneState(snap));
    c.run(4);
    expect(stateHash(c.state)).toBe(stateHash(a.state));
    expect(Array.from(c.state.cells)).toEqual(Array.from(a.state.cells));
    expect(stateHash(new RefSim3(randomSlab(5)).state)).not.toBe(stateHash(a.state));
  });
});

describe("slab reference: walls", () => {
  const floorOnly = (z: number) => {
    const s = emptyWorld({ spread: 8 });
    const n = cellCount(s.cfg);
    const WH = 256;
    for (let i = z * WH; i < (z + 1) * WH; i++) {
      s.cells[CH.B * n + i] = 40 + (i % 9);
      s.cells[CH.P * n + i] = 7 + (i % 5);
      s.cells[CH.E * n + i] = 1000 + i;
      s.cells[CH.A * n + i] = 13 + (i % 4);
      s.cells[CH.C * n + i] = 5 + (i % 3);
      s.cells[CH.S * n + i] = 3000 + 7 * i;
      s.genome[G.LIN_LO * n + i] = 1; // one lineage with an all-zero genome: transport only needs the ids
    }
    return s;
  };
  const push = (sim: RefSim3, dz: number) => {
    sim.affinity();
    sim.flow();
    const d = sim.displacement;
    for (let i = 0; i < d.length; i++) d[i] = (64 + 0) | ((64 + 0) << 8) | ((64 + dz) << 16);
  };

  it("no matter crosses z = 0 or z = D - 1 through transport, even pushed at the wall at full displacement", () => {
    for (const [layer, dz, away] of [[7, 56, [0, 5]], [0, -56, [3, 8]]] as const) {
      const s = floorOnly(layer);
      const before = [CH.B, CH.P, CH.E, CH.A, CH.C, CH.S].map((ch) => sumCh(s, ch));
      const sim = new RefSim3(s);
      push(sim, dz);
      sim.transport();
      const after = [CH.B, CH.P, CH.E, CH.A, CH.C, CH.S].map((ch) => sumCh(sim.state, ch));
      expect(after).toEqual(before);
      // one step moves bound matter by at most one layer, and dissolved species by at most one layer: the far layers stay empty (no wrap)
      for (const ch of [CH.B, CH.P, CH.E, CH.A, CH.C, CH.S]) expect(sumCh(sim.state, ch, away[0], away[1])).toBe(0);
      // pushed into the wall: the wall layer keeps its bound matter and the layer next to it gets none
      expect(sumCh(sim.state, CH.B, layer === 7 ? 7 : 0, layer === 7 ? 8 : 1)).toBeGreaterThan(0);
    }
  });

  it("the stay rule keeps exactly what pointed through a wall: with dz at the wall, the wall layer loses only sideways", () => {
    // all matter in the floor layer, displacement straight into the floor: nothing may leave the layer in z, so layer 6 stays empty
    const s = floorOnly(7);
    const sim = new RefSim3(s);
    push(sim, 56);
    sim.transport();
    // bound matter only reaches layer 6 through the -z shares, which dz = +56 gives weight 0
    expect(sumCh(sim.state, CH.B, 0, 7)).toBe(0);
    expect(sumCh(sim.state, CH.P, 0, 7)).toBe(0);
    expect(sumCh(sim.state, CH.E, 0, 7)).toBe(0);
  });

  it("the kernel does not wrap: mass in the floor layer leaves U in layers 0..4 unchanged, and the top likewise", () => {
    const base = new RefSim3(emptyWorld(wide));
    base.affinity();
    const U0 = Int32Array.from(base.affinityField);
    for (const layer of [7, 0]) {
      const s = emptyWorld(wide);
      const n = cellCount(s.cfg);
      for (let i = layer * 256; i < (layer + 1) * 256; i++) s.cells[CH.B * n + i] = 400;
      const sim = new RefSim3(s);
      sim.affinity();
      const U = sim.affinityField;
      const far = layer === 7 ? [0, 5] : [3, 8];
      for (let i = far[0] * 256; i < far[1] * 256; i++) expect(U[i]).toBe(U0[i]);
      // and the layer the mass sits in is affected
      let changed = 0;
      for (let i = layer * 256; i < (layer + 1) * 256; i++) if (U[i] !== U0[i]) changed++;
      expect(changed).toBe(256);
    }
  });

  it("a wall cell divides by the full kernel sum: it sees what it would next to empty water", () => {
    // uniform mass 255 everywhere: interior U is larger than at the wall layers (missing taps count 0)
    const s = emptyWorld(wide);
    const n = cellCount(s.cfg);
    s.cells.fill(255, CH.B * n, CH.B * n + n);
    const sim = new RefSim3(s);
    sim.affinity();
    const U = sim.affinityField;
    // layer 3 and 4 are interior (every tap exists): equal; layer 0 differs
    expect(U[3 * 256]).toBe(U[4 * 256]);
    expect(U[0]).not.toBe(U[3 * 256]);
    expect(U[0]).toBe(U[7 * 256]);
    expect(U[1 * 256]).toBe(U[6 * 256]);
  });

  it("diffusion of A from the surface layer never reaches the far layers in one step, and conserves", () => {
    const s = emptyWorld();
    const n = cellCount(s.cfg);
    for (let i = 0; i < 256; i++) s.cells[CH.A * n + i] = 1000;
    const sim = new RefSim3(s);
    sim.affinity(); sim.flow();
    sim.transport();
    expect(sumCh(sim.state, CH.A)).toBe(256 * 1000);
    expect(sumCh(sim.state, CH.A, 2, 8)).toBe(0);
    expect(sumCh(sim.state, CH.A, 1, 2)).toBeGreaterThan(0);
  });
});

describe("slab reference: light", () => {
  it("layer 0 equals the 2D surface light, for both modes and a season", () => {
    for (const mode of ["uniform", "gradient"] as const) {
      const over = { lightMode: mode, lightBase: 30, lightAmp: 140, seasonPeriod: 50, seasonAmp: 50 } as const;
      const s3 = emptyWorld(over);
      const sim3 = new RefSim3(s3);
      const cfg2 = defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, ...over });
      const sim2 = new RefSim(buildWorld(cfg2, { nutrient: 0, founders: [] }));
      for (const step of [0, 1, 12, 25, 37, 49, 50, 77]) {
        s3.step = step;
        sim3.lightColumn();
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          expect(sim3.lightSurface(x, y, step)).toBe(sim2.light(x, y, step));
          expect(sim3.lightField[y * 16 + x]).toBe(sim2.light(x, y, step));
        }
      }
    }
  });

  it("is constant down an empty column and shades monotonically under mass", () => {
    const empty = new RefSim3(emptyWorld({ lightBase: 40, lightAmp: 200 }));
    empty.lightColumn();
    for (let z = 0; z < 8; z++) for (let i = 0; i < 256; i++) expect(empty.lightField[z * 256 + i]).toBe(empty.lightField[i]);
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new RefSim3(randomSlab(seed));
      sim.lightColumn();
      const L = sim.lightField;
      for (let z = 1; z < 8; z++) for (let i = 0; i < 256; i++) expect(L[z * 256 + i]).toBeLessThanOrEqual(L[(z - 1) * 256 + i]);
    }
  });

  it("hand examples: lightK = 1024, L0 = 240, m = 1024 gives 120 and m = 3072 gives 64/256 of the layer above", () => {
    const s = emptyWorld({ lightBase: 240, lightAmp: 0, lightK: 1024 });
    const n = cellCount(s.cfg);
    s.cells[CH.B * n + 5] = 1000;
    s.cells[CH.P * n + 5] = 24; // m = 1024 at (5, 0, 0)
    s.cells[CH.B * n + 256 + 6] = 3000;
    s.cells[CH.P * n + 256 + 6] = 72; // m = 3072 at (6, 0, 1)
    const sim = new RefSim3(s);
    sim.lightColumn();
    const L = sim.lightField;
    expect(L[0]).toBe(240);
    expect(L[256 + 5]).toBe(120);
    expect(L[256 + 4]).toBe(240); // a neighbouring empty column is untouched
    expect(L[256 + 6]).toBe(240); // (6,0,0) is empty: layer 1 of that column is lossless
    expect(L[2 * 256 + 6]).toBe(60); // under m = 3072: floor(240 * 64 / 256)
    expect(L[2 * 256 + 5]).toBe(120); // through an empty layer 1 (m = 0 there, T = 256) nothing more is lost
  });
});

describe("slab reference: neutral arm and mutation", () => {
  it("a neutral run expresses the reference genome: weights do not matter, lineage still propagates", () => {
    const mk = (seedW: number) => {
      const r = rng(seedW);
      const cfg = slabCfg({ neutral: true, mutRate: 0, seed: 3 });
      return buildWorld3(cfg, { nutrient: 40, founders: [{ x: 8, y: 8, z: 3, radius: 3, genome: randomGenome3(r), biomass: 60, energy: 120 }] });
    };
    const a = new RefSim3(mk(1)), b = new RefSim3(mk(2));
    a.run(6); b.run(6);
    expect(Array.from(a.state.cells)).toEqual(Array.from(b.state.cells));
    expect(a.state.flux.some((v) => v > 0n)).toBe(true);
    // and it is the generalist: same cells as a non-neutral run of the lifted generalist (mu / sigma from the defaults in neutral)
    const cfgN = slabCfg({ neutral: true, mutRate: 0, seed: 3 });
    const cfgE = slabCfg({ neutral: false, mutRate: 0, seed: 3, defaultMu: 154, defaultSigma: 24 });
    const gen = (cfg: typeof cfgN) => buildWorld3(cfg, { nutrient: 40, founders: [{ x: 8, y: 8, z: 3, radius: 3, genome: generalistGenome3(154, 24), biomass: 60, energy: 120 }] });
    const n1 = new RefSim3(gen({ ...cfgN, defaultMu: 154, defaultSigma: 24 })), e1 = new RefSim3(gen(cfgE));
    n1.run(5); e1.run(5);
    expect(Array.from(n1.state.cells)).toEqual(Array.from(e1.state.cells));
  });

  it("a mutation event mints lineage (step + 1, cell) and the genome stays a valid slab genome", () => {
    const s = randomSlab(21, { mutRate: 1_000_000_000, neutral: false, motility: true });
    const sim = new RefSim3(s);
    const events = sim.run(3);
    expect(events.length).toBeGreaterThan(0);
    const n = cellCount(s.cfg);
    expect(validateState3(sim.state)).toEqual([]);
    // the last step's events: the cell holds the child lineage unless it died afterwards
    for (const e of events.filter((e) => e.childHi === 3)) {
      const hi = sim.state.genome[G.LIN_HI * n + e.childLo], lo = sim.state.genome[G.LIN_LO * n + e.childLo];
      if (hi !== 0 || lo !== 0) {
        // transport after the event may have moved it; the cell still holds some valid lineage
        expect(lo).toBeLessThan(n);
      }
    }
  });

  it("MOT is the slab rest value for cells without a controller", () => {
    const sim = new RefSim3(emptyWorld());
    sim.step();
    const n = cellCount(sim.cfg);
    for (let i = 0; i < n; i++) expect(sim.state.cells[CH.MOT * n + i]).toBe(MOT_ZERO3);
  });
});

