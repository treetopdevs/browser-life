import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  GENOME_CHANNELS,
  buildWorld,
  cloneState,
  defaultConfig,
  M3_FOUNDERS,
  TAKEOVER_GENOME_WORDS,
  encodeGenome,
  founderGenome,
  generalistGenome,
  ledgerResidual,
  stateHash,
  totalsOf,
  validateConfig,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

// Lossy takeover (WorldConfig.takeover; docs/sandbox-ownership.md).

const W = 16;
const n = W * W;

/** Two touching columns of bound matter: lineage (0,1) at x=6..7, lineage (0,2) at x=8..9. */
function contactWorld(cfg: WorldConfig, mu2 = 80, sigma2 = 30): WorldState {
  const s = buildWorld(cfg, { nutrient: 16, founders: [] });
  const gA = encodeGenome(generalistGenome(60, 20), 0, 1);
  const gB = encodeGenome(generalistGenome(mu2, sigma2), 0, 2);
  for (let y = 0; y < W; y++)
    for (let x = 6; x <= 9; x++) {
      const i = y * W + x;
      s.cells[CH.B * n + i] = 4000 + 37 * x + 11 * y;
      s.cells[CH.P * n + i] = 900 + 13 * y;
      s.cells[CH.E * n + i] = 5000;
      const g = x <= 7 ? gA : gB;
      for (let k = 0; k < GENOME_CHANNELS; k++) s.genome[k * n + i] = g[k];
    }
  return s;
}

const physics = { tileW: W, tileH: W, kernelRadius: 3, seed: 7, motility: false, mutRate: 0 } as const;

/** Runs only affinity, flow and transport (the rule under test), not react. */
function transportOnly(state: WorldState): WorldState {
  const sim = new RefSim(cloneState(state)) as unknown as Record<string, () => void> & RefSim;
  sim.affinity();
  sim.flow();
  sim.transport();
  return sim.state;
}

describe("lossy takeover config", () => {
  it("is absent from defaultConfig and validated when set", () => {
    const d = defaultConfig();
    expect("takeover" in d || "takeoverKin" in d || "takeoverTol" in d).toBe(false);
    expect(validateConfig(defaultConfig({ takeover: "lossy", takeoverKin: "growth", takeoverTol: 8 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ takeoverKin: "growth" })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ takeover: "lossy", eP: 31, eC: 2, eB: 10 })).length).toBeGreaterThan(0);
    expect(TAKEOVER_GENOME_WORDS).toBe(GENOME_CHANNELS - G.PARAM0);
    expect(validateConfig(defaultConfig({ takeover: "lossy", takeoverKin: "genome", takeoverTol: 1 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ takeover: "lossy", takeoverKin: "genome", takeoverTol: TAKEOVER_GENOME_WORDS + 1 })).length).toBeGreaterThan(0);
  });
});

describe("lossy takeover transport", () => {
  it("turns the non-kin bound share into C and raises E by exactly the released energy", () => {
    const base = defaultConfig(physics);
    const lossy = defaultConfig({ ...physics, takeover: "lossy", takeoverKin: "lineage" });
    const a = transportOnly(contactWorld(base));
    const b = transportOnly(contactWorld(lossy));
    expect(Array.from(b.genome)).toEqual(Array.from(a.genome));
    let lost = 0;
    for (let i = 0; i < n; i++) {
      const dB = a.cells[CH.B * n + i] - b.cells[CH.B * n + i];
      const dP = a.cells[CH.P * n + i] - b.cells[CH.P * n + i];
      expect(dB).toBeGreaterThanOrEqual(0);
      expect(dP).toBeGreaterThanOrEqual(0);
      expect(b.cells[CH.C * n + i] - a.cells[CH.C * n + i]).toBe(dB + dP);
      expect(b.cells[CH.E * n + i] - a.cells[CH.E * n + i]).toBe(dB * (lossy.eB - lossy.eC) + dP * (lossy.eP - lossy.eC));
      expect(b.cells[CH.A * n + i]).toBe(a.cells[CH.A * n + i]);
      expect(b.cells[CH.MOT * n + i]).toBe(a.cells[CH.MOT * n + i]);
      lost += dB + dP;
    }
    // The contact columns really exchanged matter, and only there.
    expect(lost).toBeGreaterThan(0);
    for (let y = 0; y < W; y++) for (const x of [0, 1, 2, 3, 12, 13, 14, 15]) expect(b.cells[CH.C * n + y * W + x]).toBe(a.cells[CH.C * n + y * W + x]);
    const ta = totalsOf(base, a.cells), tb = totalsOf(lossy, b.cells);
    expect(tb.matter).toBe(ta.matter);
    expect(tb.energy).toBe(ta.energy);
  });

  it("merges kin exactly like RULE_VERSION 1 (growth kin within tolerance)", () => {
    const base = defaultConfig(physics);
    const match = defaultConfig({ ...physics, takeover: "lossy", takeoverKin: "growth", takeoverTol: 8 });
    // mu 60 vs 66 (<= 8), sigma 20 vs 22 (<= 8 >> 2): different lineages, kin.
    const a = new RefSim(cloneState(contactWorld(base, 66, 22)));
    const b = new RefSim(cloneState(contactWorld(match, 66, 22)));
    for (let k = 0; k < 5; k++) {
      a.step();
      b.step();
      expect(Array.from(b.state.cells)).toEqual(Array.from(a.state.cells));
      expect(Array.from(b.state.genome)).toEqual(Array.from(a.state.genome));
      expect(b.state.heatOut).toBe(a.state.heatOut);
    }
    // The same pair outside the tolerance (sigma 23: 3 > 2) is not kin.
    const c = transportOnly(contactWorld(match, 66, 23));
    const d = transportOnly(contactWorld(base, 66, 23));
    expect(totalsOf(match, c.cells).C).toBeGreaterThan(totalsOf(base, d.cells).C);
  });

  it("genome kin counts differing heritable words against the tolerance", () => {
    const base = defaultConfig(physics);
    const tol = (t: number) => defaultConfig({ ...physics, takeover: "lossy", takeoverKin: "genome", takeoverTol: t });
    // Lineage (0,2) differs from (0,1) in PARAM0 only (mu 66 vs 60): one word.
    const one = () => contactWorld(base, 66, 20);
    // ... and in one weight word as well: two words.
    const two = () => {
      const s = one();
      for (let i = 0; i < n; i++) if (s.genome[G.LIN_LO * n + i] === 2) s.genome[(G.W0 + 5) * n + i] ^= 0x00010000;
      return s;
    };
    const run = (s: WorldState, cfg: WorldConfig) => {
      const sim = new RefSim(cloneState({ ...s, cfg }));
      for (let k = 0; k < 5; k++) sim.step();
      return sim.state;
    };
    // Within the tolerance: bit-identical to RULE_VERSION 1.
    for (const [w, t] of [[one, 1], [two, 2], [two, TAKEOVER_GENOME_WORDS]] as const) {
      const a = run(w(), base), b = run(w(), tol(t));
      expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
      expect(Array.from(b.genome)).toEqual(Array.from(a.genome));
    }
    // Outside it: the non-kin share is wasted, exactly as under lineage kin.
    for (const [w, t] of [[one, 0], [two, 1]] as const) {
      const lin = transportOnly({ ...w(), cfg: defaultConfig({ ...physics, takeover: "lossy", takeoverKin: "lineage" }) });
      const gen = transportOnly({ ...w(), cfg: tol(t) });
      expect(Array.from(gen.cells)).toEqual(Array.from(lin.cells));
      expect(totalsOf(base, gen.cells).C).toBeGreaterThan(totalsOf(base, transportOnly(w()).cells).C);
    }
  });

  for (const kin of ["lineage", "growth", "genome"] as const) {
    it(`conserves matter and closes the energy ledger every step for 2,000 steps (${kin} kin)`, () => {
      // 24 x 24 (kept small: 2,000 CPU steps per mode) with four M3 founders
      // in contact; founders 1 and 5 are growth-kin at tol 8, 0 and 2 are not.
      const cfg = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 61, mutRate: 60_000_000, takeover: "lossy", takeoverKin: kin, takeoverTol: kin === "genome" ? 1 : 8 });
      const N = 24 * 24;
      const start = buildWorld(cfg, {
        nutrient: 32,
        founders: [0, 1, 2, 5].map((f, k) => ({ x: 6 + 12 * (k & 1), y: 6 + 12 * (k >> 1), radius: 5, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })),
      });
      const lineages = new Set<string>();
      for (let i = 0; i < N; i++) {
        const hi = start.genome[G.LIN_HI * N + i], lo = start.genome[G.LIN_LO * N + i];
        if (hi | lo) lineages.add(`${hi}:${lo}`);
      }
      expect(lineages.size).toBeGreaterThanOrEqual(2);
      const sim = new RefSim(cloneState(start));
      const t0 = totalsOf(cfg, sim.state.cells);
      let mutations = 0;
      for (let k = 0; k < 2000; k++) {
        mutations += sim.step().events.length;
        expect(totalsOf(cfg, sim.state.cells).matter).toBe(t0.matter);
        expect(ledgerResidual(t0, sim.state)).toBe(0n);
      }
      expect(mutations).toBeGreaterThan(0);
      // The rule actually acted: the run differs from RULE_VERSION 1's.
      const plain = new RefSim(cloneState({ ...start, cfg: defaultConfig({ ...cfg, takeover: undefined, takeoverKin: undefined, takeoverTol: undefined }) }));
      plain.run(100);
      const again = new RefSim(cloneState(start));
      again.run(100);
      expect(stateHash(again.state)).not.toBe(stateHash(plain.state));
    }, 120_000);
  }
});
