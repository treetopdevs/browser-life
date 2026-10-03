import { describe, expect, it } from "vitest";
import {
  CH, FLUX_NAMES, GENOME_CHANNELS, OUT, allocState, b2, cloneState,
  defaultConfig, emptyGenome, encodeGenome, generalistWorld,
  ledgerResidual, totalsOf, type WorldConfig,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

const passive = (overrides: Partial<WorldConfig> = {}) => defaultConfig({
  tileW: 8, tileH: 8, kernelRadius: 2, dtQ: 0, spread: 0, motility: false,
  mutRate: 0, diffA: 256, diffC: 256, diffS: 256,
  kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0,
  kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0,
  ...overrides,
});

describe("polymer transport causal ablation", () => {
  it("removes only the A/C gate, preserving polymer and the exact ledger", () => {
    const n = 64, i = 36;
    const a = allocState(passive());
    a.cells[CH.P * n + i] = 192;
    a.cells[CH.A * n + i] = 1024;
    a.cells[CH.C * n + i] = 512;
    a.cells[CH.S * n + i] = 256;
    const b = cloneState(a);
    b.cfg = { ...b.cfg, polymerTransport: false };
    const start = totalsOf(a.cfg, a.cells);
    const on = new RefSim(a), off = new RefSim(b);
    on.step(); off.step();
    // gateK=64, P=192 => one quarter of the ungated diffusivity.
    expect(on.state.cells[CH.A * n + i]).toBe(768);
    expect(on.state.cells[CH.C * n + i]).toBe(384);
    expect(off.state.cells[CH.A * n + i]).toBe(0);
    expect(off.state.cells[CH.C * n + i]).toBe(0);
    for (const sim of [on, off]) {
      expect(sim.state.cells[CH.P * n + i]).toBe(192);
      expect(sim.state.cells[CH.S * n + i]).toBe(0);
      expect(totalsOf(sim.cfg, sim.state.cells).matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
  });

  it("still charges both biomass and free energy for building in the ablation", () => {
    for (const polymerTransport of [true, false]) for (const polymerDrag of [true, false]) {
      const s = allocState(passive({ ruleVersion: 2, polymerTransport, polymerDrag, kBuild: 4096, kCatHalf: 0 }));
      const n = 64, i = 36;
      s.cells[CH.B * n + i] = 512;
      s.cells[CH.E * n + i] = 1024;
      const genome = emptyGenome(154, 24);
      genome.weights[b2(OUT.BUILD)] = 127;
      const words = encodeGenome(genome, 0, 1);
      for (let k = 0; k < GENOME_CHANNELS; k++) s.genome[k * n + i] = words[k];
      const start = totalsOf(s.cfg, s.cells);
      const sim = new RefSim(s);
      sim.step();
      // floor(512 * 127 / 128) = 508 B converted; each P costs 2 E.
      expect(sim.state.flux[FLUX_NAMES.indexOf("build")]).toBe(508n);
      expect(sim.state.cells[CH.P * n + i]).toBe(508);
      expect(sim.state.cells[CH.B * n + i]).toBe(4);
      expect(sim.state.cells[CH.E * n + i]).toBe(8);
      expect(totalsOf(sim.cfg, sim.state.cells).matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
  });

  it("conserves reacting worlds and preserves default trajectories when explicitly enabled", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 9 });
    const source = generalistWorld(cfg, 2, 32, 64);
    const start = totalsOf(cfg, source.cells);
    const defaults = new RefSim(cloneState(source));
    const explicitState = cloneState(source);
    explicitState.cfg = { ...explicitState.cfg, polymerTransport: true };
    const explicit = new RefSim(explicitState);
    const offState = cloneState(source);
    offState.cfg = { ...offState.cfg, polymerTransport: false };
    const off = new RefSim(offState);
    for (let i = 0; i < 40; i++) {
      for (const sim of [defaults, explicit, off]) {
        sim.step();
        expect(totalsOf(sim.cfg, sim.state.cells).matter).toBe(start.matter);
        expect(ledgerResidual(start, sim.state)).toBe(0n);
      }
    }
    expect(explicit.state.cells).toEqual(defaults.state.cells);
    expect(explicit.state.genome).toEqual(defaults.state.genome);
    expect(explicit.state.flux).toEqual(defaults.state.flux);
    expect(explicit.state.lightIn).toBe(defaults.state.lightIn);
    expect(explicit.state.heatOut).toBe(defaults.state.heatOut);
  });
});
