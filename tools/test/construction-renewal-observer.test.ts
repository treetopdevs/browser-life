// Renewal observer: exact bound transport against passive RefSim runs, local
// and global budgets on reacting worlds, read-only behaviour, and the energy
// accounting fixtures requested by the evolvability-discovery plan (Stage 1).
// Every world here is an artificial state; none is the reservoir witness habitat.
import { describe, expect, it } from "vitest";
import {
  allocState,
  cellCount,
  CH,
  cloneState,
  defaultConfig,
  encodeGenome,
  GENOME_CHANNELS,
  generalistGenome,
  stateHash,
  totalsOf,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO, RefSim } from "@bl/sim-ref";
import { constructionGenome } from "../lib/construction.ts";
import {
  boundStencil,
  boundTransport,
  checkObserverDomain,
  RenewalObserver,
  roleCounterBound,
} from "../lib/construction-renewal-observer.ts";

const PASSIVE: Partial<WorldConfig> = {
  kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0, kCost: 0, kMaint: 0,
  kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0,
};

function world(overrides: Partial<WorldConfig>, W = 32, H = 32): WorldState {
  const cfg = defaultConfig({ ruleVersion: 1, seed: 4242, tileW: W, tileH: H, kernelRadius: 2, dtQ: 0, motility: false, mutRate: 0, lightMode: "uniform", lightAmp: 0, ...overrides });
  const s = allocState(cfg);
  s.cells.fill(MOT_ZERO, CH.MOT * W * H, (CH.MOT + 1) * W * H);
  return s;
}

/** Amount leaving one cell at zero displacement, from RefSim itself (passive world, one step). */
function observedOutflow(spread: number, q: number, ch: number): number {
  const s = world({ ...PASSIVE, spread });
  const n = 1024, i = 16 * 32 + 16;
  s.cells[ch * n + i] = q;
  const sim = new RefSim(s);
  sim.step();
  return q - sim.state.cells[ch * n + i];
}

describe("renewal observer domain", () => {
  it("accepts the rule-1, dtQ0, motility-off, drag-free domain and rejects the rest", () => {
    const ok = world({ spread: 2 }).cfg;
    expect(() => checkObserverDomain(ok)).not.toThrow();
    expect(() => checkObserverDomain({ ...ok, polymerTransport: false })).not.toThrow();
    expect(() => checkObserverDomain({ ...ok, ruleVersion: 2 })).toThrow("ruleVersion");
    expect(() => checkObserverDomain({ ...ok, dtQ: 16 })).toThrow("dtQ");
    expect(() => checkObserverDomain({ ...ok, motility: true })).toThrow("motility");
    expect(() => checkObserverDomain({ ...ok, polymerDrag: true })).toThrow("polymerDrag");
    expect(() => checkObserverDomain({ ...ok, adhesion: true })).toThrow("adhesion");
    expect(() => checkObserverDomain({ ...ok, tilesX: 2 })).toThrow("single tile");
    expect(() => checkObserverDomain({ ...ok, pondPeriod: 100 } as WorldConfig)).toThrow("pondPeriod");
  });

  it("proves the role counters cannot saturate for the protocol's largest world", () => {
    const witness = { kPhoto: 160, kGrow: 128, kResp: 128, kDecomp: 96 } as WorldConfig;
    expect(roleCounterBound(witness, 18_432n)).toBe(721);
    expect(roleCounterBound(witness, 18_432n)).toBeLessThan(0xffff);
    const s = world({ spread: 1 });
    expect(() => new RenewalObserver(s, [], 2_000_000n)).toThrow("saturate");
  });
});

describe("transport-band fixtures (RESEARCH exact table) against passive RefSim", () => {
  // spread: [first cardinal, one quantum per cardinal up to, first diagonal, share numerator, denominator]
  const TABLE: Record<number, [number, number, number, number, number] | null> = {
    0: null,
    1: [69, 136, 4356, 260, 4356],
    2: [37, 72, 1156, 528, 4624],
    4: [21, 40, 324, 1088, 5184],
    8: [13, 24, 100, 2304, 6400],
  };
  for (const [sp, row] of Object.entries(TABLE)) {
    const spread = Number(sp);
    it(`spread ${spread}: band edges for B, P and E, and the observer's prediction`, () => {
      const st = boundStencil(spread);
      const predict = (q: number) => {
        const a = new Float64Array(1024);
        a[16 * 32 + 16] = q;
        return boundTransport(a, 32, 32, st).grossOut[16 * 32 + 16];
      };
      if (!row) {
        for (const q of [1, 100, 5000, 60000]) {
          expect(observedOutflow(0, q, CH.B)).toBe(0);
          expect(predict(q)).toBe(0);
        }
        return;
      }
      const [first, oneUpTo, diag, num, den] = row;
      const cases: [number, number][] = [
        [first - 1, 0],
        [first, 4],
        [oneUpTo, 4],
        [oneUpTo + 1, 8],
        [diag - 1, 4 * Math.floor((64 * spread * (diag - 1)) / den)],
        [diag, 4 * Math.floor((64 * spread * diag) / den) + 4],
      ];
      for (const [q, expected] of cases) {
        for (const ch of [CH.B, CH.P, CH.E]) expect(observedOutflow(spread, q, ch)).toBe(expected);
        expect(predict(q)).toBe(expected);
      }
      // Large-amount share: floor terms converge to num/den.
      const big = den * 1000;
      expect(observedOutflow(spread, big, CH.B)).toBe((big * num) / den);
    });
  }

  it("a founder with B 64 and E 128 at spread 1 exports four quanta of free energy and no biomass", () => {
    const s = world({ ...PASSIVE, spread: 1 });
    const i = 16 * 32 + 16;
    s.cells[CH.B * 1024 + i] = 64;
    s.cells[CH.E * 1024 + i] = 128;
    const sim = new RefSim(s);
    const obs = new RenewalObserver(sim.state, [{ name: "site", sites: [i] }], 64n);
    obs.beforeStep(sim);
    sim.step();
    obs.afterStep(sim);
    const snap = obs.snapshot();
    expect(snap.cumulative.boundBOut[i]).toBe(0);
    expect(snap.cumulative.boundEOut[i]).toBe(4);
    expect(sim.state.cells[CH.B * 1024 + i]).toBe(64);
    expect(sim.state.cells[CH.E * 1024 + i]).toBe(124);
    for (const j of [i - 1, i + 1, i - 32, i + 32]) expect(sim.state.cells[CH.E * 1024 + j]).toBe(1);
  });
});

/** Passive multi-deposit world: the observer's post-transport B and E must equal RefSim's. */
function passiveCheck(spread: number, startStep: number, deposits: [number, number, number][]) {
  const s = world({ ...PASSIVE, spread });
  s.step = startStep;
  for (const [i, b, e] of deposits) {
    s.cells[CH.B * 1024 + i] = b;
    s.cells[CH.E * 1024 + i] = e;
  }
  const sim = new RefSim(s);
  const obs = new RenewalObserver(sim.state, [], 100_000n);
  for (let t = 0; t < 25; t++) {
    const preB = Float64Array.from(sim.state.cells.subarray(CH.B * 1024, (CH.B + 1) * 1024));
    const preE = Float64Array.from(sim.state.cells.subarray(CH.E * 1024, (CH.E + 1) * 1024));
    const predB = boundTransport(preB, 32, 32, boundStencil(spread)).after;
    const predE = boundTransport(preE, 32, 32, boundStencil(spread)).after;
    obs.beforeStep(sim);
    sim.step();
    obs.afterStep(sim);
    for (let i = 0; i < 1024; i++) {
      expect(sim.state.cells[CH.B * 1024 + i]).toBe(predB[i]);
      expect(sim.state.cells[CH.E * 1024 + i]).toBe(predE[i]);
    }
  }
  const snap = obs.snapshot();
  // Reactions are off: every B and E change is transport.
  expect(snap.cumulative.reactB.every((v) => v === 0)).toBe(true);
  expect(snap.cumulative.reactE.every((v) => v === 0)).toBe(true);
  return { sim, snap };
}

describe("passive bound transport", () => {
  for (const spread of [0, 1, 2]) {
    it(`matches RefSim at spread ${spread}, including wrapping at the torus edges`, () => {
      const { snap } = passiveCheck(spread, 0, [
        [0, 5000, 3000], // corner: wraps to all three other corners' neighbourhoods
        [31, 137, 70],
        [16 * 32 + 16, 4400, 69],
        [31 * 32 + 5, 1200, 1300],
      ]);
      const totalIn = snap.cumulative.boundBIn.reduce((a, b) => a + b, 0);
      const totalOut = snap.cumulative.boundBOut.reduce((a, b) => a + b, 0);
      expect(totalIn).toBe(totalOut);
      if (spread === 0) expect(totalOut).toBe(0);
      else expect(snap.cumulative.boundBIn[31 * 32 + 31]).toBeGreaterThan(0); // from (0,0) across both edges
    });
  }

  it("works from a nonzero initial step", () => {
    passiveCheck(2, 12_345, [[200, 3000, 900], [800, 77, 1500]]);
  });

  it("keeps the unsent rounding remainder at the source", () => {
    // q = 137 at spread 1: one quantum to each cardinal neighbour, 133 retained, nothing diagonal.
    const s = world({ ...PASSIVE, spread: 1 });
    const i = 10 * 32 + 10;
    s.cells[CH.B * 1024 + i] = 137;
    const a = new Float64Array(1024);
    a[i] = 137;
    const t = boundTransport(a, 32, 32, boundStencil(1));
    expect(t.grossOut[i]).toBe(8);
    expect(t.after[i]).toBe(129);
    const sim = new RefSim(s);
    sim.step();
    expect(sim.state.cells[CH.B * 1024 + i]).toBe(129);
  });
});

/** An artificial reacting world: generalist and builder-like founders on a nutrient field. */
function reactingWorld(spread: number, light = 255): WorldState {
  const s = world({ spread, lightBase: light, kBDecay: 500 });
  const n = cellCount(s.cfg);
  const gen = encodeGenome(generalistGenome(154, 24), 0, 1);
  const grower = encodeGenome(constructionGenome({ build: 8, grow: 90 }), 0, 2);
  for (let i = 0; i < n; i++) s.cells[CH.A * n + i] = 40;
  const put = (i: number, words: Uint32Array, B: number, E: number) => {
    s.cells[CH.B * n + i] = B;
    s.cells[CH.E * n + i] = E;
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
  };
  put(5 * 32 + 5, gen, 900, 1500);
  put(20 * 32 + 9, grower, 1500, 4000);
  put(12 * 32 + 25, gen, 300, 200);
  return s;
}

describe("reacting worlds", () => {
  for (const spread of [0, 1, 2]) {
    it(`local budgets close and every step reconciles to the global flux (spread ${spread})`, () => {
      const s = reactingWorld(spread);
      const start = cloneState(s);
      const total = totalsOf(s.cfg, s.cells);
      const sim = new RefSim(s);
      const twin = new RefSim(cloneState(start));
      const obs = new RenewalObserver(sim.state, [{ name: "a", sites: [5 * 32 + 5] }, { name: "b", sites: [20 * 32 + 9, 20 * 32 + 10] }], total.matter);
      for (let t = 0; t < 300; t++) {
        const before = stateHash(sim.state);
        obs.beforeStep(sim);
        expect(stateHash(sim.state)).toBe(before); // read-only
        sim.step();
        obs.afterStep(sim);
        twin.step();
        expect(stateHash(sim.state)).toBe(stateHash(twin.state)); // no state mutation by the observer
      }
      const snap = obs.snapshot();
      const n = 1024;
      let synth = 0;
      for (let i = 0; i < n; i++) {
        const dB = sim.state.cells[CH.B * n + i] - start.cells[CH.B * n + i];
        expect(snap.cumulative.reactB[i] + snap.cumulative.boundBIn[i] - snap.cumulative.boundBOut[i]).toBe(dB);
        const dE = sim.state.cells[CH.E * n + i] - start.cells[CH.E * n + i];
        expect(snap.cumulative.reactE[i] + snap.cumulative.boundEIn[i] - snap.cumulative.boundEOut[i]).toBe(dE);
        synth += snap.cumulative.photo[i] + snap.cumulative.grow[i];
      }
      expect(synth).toBe(Number(sim.state.flux[0] + sim.state.flux[3]));
      expect(synth).toBeGreaterThan(0);
      if (spread === 0) expect(snap.cumulative.boundBOut.every((v) => v === 0)).toBe(true);
      // Masked A/C accounting accumulated over every step.
      expect(snap.masks.a.A.grossOut + snap.masks.a.A.grossIn).toBeGreaterThan(0);
      expect(snap.masks.b.A.internal).toBeGreaterThanOrEqual(0);
    });
  }

  it("copies pre-step values: RefSim reuses its buffers, so a held reference goes stale", () => {
    const sim = new RefSim(reactingWorld(1));
    const obs = new RenewalObserver(sim.state, [], 100_000n);
    for (let t = 0; t < 3; t++) {
      obs.beforeStep(sim);
      sim.step();
      obs.afterStep(sim);
    }
    const held = sim.state.cells.subarray(CH.B * 1024, (CH.B + 1) * 1024);
    const copy = Float64Array.from(held);
    obs.beforeStep(sim);
    sim.step();
    obs.afterStep(sim); // reconciles: the observer used copies
    sim.step(); // two swaps later the held view is the buffer RefSim wrote into
    expect(Array.from(held).some((v, i) => v !== copy[i])).toBe(true);
  });

  it("refuses misuse: double beforeStep, afterStep without beforeStep, or a step it did not see", () => {
    const sim = new RefSim(reactingWorld(1));
    const obs = new RenewalObserver(sim.state, [], 100_000n);
    expect(() => obs.afterStep(sim)).toThrow("without beforeStep");
    obs.beforeStep(sim);
    expect(() => obs.beforeStep(sim)).toThrow("twice");
    sim.step();
    sim.step();
    expect(() => obs.afterStep(sim)).toThrow("expected step");
  });

  it("snapshot and restore continue identically", () => {
    const a = new RefSim(reactingWorld(2));
    const oa = new RenewalObserver(a.state, [{ name: "m", sites: [165] }], 100_000n);
    for (let t = 0; t < 50; t++) {
      oa.beforeStep(a);
      a.step();
      oa.afterStep(a);
    }
    const b = new RefSim(cloneState(a.state));
    const ob = new RenewalObserver(b.state, [{ name: "m", sites: [165] }], 100_000n, oa.snapshot());
    for (let t = 0; t < 50; t++) {
      oa.beforeStep(a);
      a.step();
      oa.afterStep(a);
      ob.beforeStep(b);
      b.step();
      ob.afterStep(b);
    }
    expect(JSON.stringify(ob.snapshot())).toBe(JSON.stringify(oa.snapshot()));
  });
});

describe("energy accounting on artificial states", () => {
  it("GROW funded by stored free energy raises B in one step", () => {
    // No light: photosynthesis is impossible, so any new B is GROW paid from E.
    const s = world({ spread: 0, lightBase: 0, kBDecay: 0, kMaint: 0, kCost: 0 });
    const i = 8 * 32 + 8;
    s.cells[CH.A * 1024 + i] = 500;
    s.cells[CH.B * 1024 + i] = 600;
    s.cells[CH.E * 1024 + i] = 5000;
    const words = encodeGenome(constructionGenome({ build: 0, photo: 0, resp: 0, decomp: 0, grow: 127 }), 0, 1);
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * 1024 + i] = words[g];
    const sim = new RefSim(s);
    const obs = new RenewalObserver(sim.state, [], 1100n);
    obs.beforeStep(sim);
    sim.step();
    obs.afterStep(sim);
    const c = obs.snapshot().cumulative;
    expect(c.photo[i]).toBe(0);
    expect(c.grow[i]).toBeGreaterThan(0);
    expect(c.reactB[i]).toBe(c.grow[i]);
    expect(sim.state.cells[CH.B * 1024 + i]).toBe(600 + c.grow[i]);
    expect(-c.reactE[i]).toBeGreaterThanOrEqual(10 * c.grow[i]);
  });

  for (const spread of [0, 1, 2]) {
    it(`10·ΣGROW <= E_start − E_end + 8·ΣRESP + 2·ΣDECOMP + net E import, per site and in total (spread ${spread})`, () => {
      const s = reactingWorld(spread);
      expect([s.cfg.eA, s.cfg.eB, s.cfg.eC]).toEqual([0, 10, 2]);
      const sim = new RefSim(s);
      const obs = new RenewalObserver(sim.state, [], totalsOf(s.cfg, s.cells).matter);
      const windows = [0, 100, 250, 400];
      const snaps = [{ snap: obs.snapshot(), E: Float64Array.from(sim.state.cells.subarray(CH.E * 1024, (CH.E + 1) * 1024)) }];
      for (let t = 1; t <= 400; t++) {
        obs.beforeStep(sim);
        sim.step();
        obs.afterStep(sim);
        if (windows.includes(t)) snaps.push({ snap: obs.snapshot(), E: Float64Array.from(sim.state.cells.subarray(CH.E * 1024, (CH.E + 1) * 1024)) });
      }
      let grew = 0;
      for (let a = 0; a < snaps.length; a++) {
        for (let b = a + 1; b < snaps.length; b++) {
          const A = snaps[a], B = snaps[b];
          let lhsT = 0, rhsT = 0;
          for (let i = 0; i < 1024; i++) {
            const d = (k: "grow" | "resp" | "decomp" | "boundEIn" | "boundEOut") => B.snap.cumulative[k][i] - A.snap.cumulative[k][i];
            const lhs = 10 * d("grow");
            const rhs = A.E[i] - B.E[i] + 8 * d("resp") + 2 * d("decomp") + d("boundEIn") - d("boundEOut");
            expect(lhs).toBeLessThanOrEqual(rhs);
            lhsT += lhs;
            rhsT += rhs;
            grew += d("grow");
          }
          expect(lhsT).toBeLessThanOrEqual(rhsT);
        }
      }
      expect(grew).toBeGreaterThan(0);
    });
  }
});
