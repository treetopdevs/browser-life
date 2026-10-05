import { describe, expect, it } from "vitest";
import {
  CH, GENOME_CHANNELS, MATTER_MAX, POOL_MAX, RND, allocState, cellBase,
  cloneState, defaultConfig, draw, emptyGenome, encodeGenome, generalistWorld,
  ledgerResidual, totalsOf, type WorldConfig, type WorldState,
} from "@bl/schema";
import { RefSim, mulShareD, polymerDragShare, w1d } from "@bl/sim-ref";

const passive = (overrides: Partial<WorldConfig> = {}) => defaultConfig({
  ruleVersion: 2,
  tileW: 8, tileH: 8, kernelRadius: 2, dtQ: 0, spread: 8, motility: true,
  polymerDrag: true, mutRate: 0, diffA: 0, diffC: 0, diffS: 0,
  kPhoto: 0, kResp: 0, kDecomp: 0, kGrow: 0, kBuild: 0, kEmit: 0,
  kCost: 0, kMaint: 0, kPDecay: 0, kBDecay: 0, kELeak: 0, kSDecay: 0, kAbio: 0,
  ...overrides,
});

function expectSameDynamics(a: WorldState, b: WorldState) {
  expect(a.cells).toEqual(b.cells);
  expect(a.genome).toEqual(b.genome);
  expect(a.flux).toEqual(b.flux);
  expect(a.lightIn).toBe(b.lightIn);
  expect(a.heatOut).toBe(b.heatOut);
}

describe("polymer drag transport", () => {
  it("preserves old offers at P=0, halves them at P=32, and never exceeds an offer", () => {
    for (const offer of [0, 1, 2, 200, MATTER_MAX, POOL_MAX]) {
      expect(polymerDragShare(offer, 0, 17, 0, 0)).toBe(offer);
      if (offer % 2 === 0) expect(polymerDragShare(offer, 32, 17, 0, 0)).toBe(offer / 2);
      for (const p of [1, 31, 32, 64, MATTER_MAX]) {
        const result = polymerDragShare(offer, p, 17, 0, 0);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(offer);
      }
    }
  });

  it("retains a positive chance to transmit even a one-quantum offer at maximum P", () => {
    const outcomes = new Set<number>();
    for (let seed = 0; seed < 4096; seed++)
      outcomes.add(polymerDragShare(1, MATTER_MAX, cellBase(seed, 0, 0), 0, 0));
    expect(outcomes).toEqual(new Set([0, 1]));
  });

  it("uses source-oriented, species-specific draws at both ends, including mirrored and wrapped edges", () => {
    const n = 64, source = 0, values = [5000, 37, 10003], channels = [CH.B, CH.P, CH.E];
    for (const [mx, my] of [[40, 24], [-40, 24], [40, -24], [-40, -24]]) {
      const state = allocState(passive({ seed: 71 }));
      const genome = emptyGenome(154, 24); genome.motGain = 255;
      const words = encodeGenome(genome, 0, 1);
      for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + source] = words[g];
      for (let sp = 0; sp < 3; sp++) state.cells[channels[sp] * n + source] = values[sp];
      state.cells[CH.MOT * n + source] = (mx + 128) | ((my + 128) << 8);
      const initial = totalsOf(state.cfg, state.cells), expected = new Uint32Array(n * 3);
      const dx = Math.trunc(mx * 255 / 256), dy = Math.trunc(my * 255 / 256);
      const base = cellBase(71, 0, source), mobility = Math.floor(8192 / (32 + values[1]));
      for (let sp = 0; sp < 3; sp++) {
        expected[sp * n + source] = values[sp];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const offer = mulShareD(values[sp], w1d(dx, ox, 40) * w1d(dy, oy, 40), 6400);
          const numerator = BigInt(offer) * BigInt(mobility);
          const direction = (oy + 1) * 3 + ox + 1;
          const randomByte = draw(base, RND.POLYMER_DRAG + sp * 9 + direction) & 255;
          const transmitted = Number(numerator / 256n) + Number(numerator % 256n > BigInt(randomByte));
          const target = ((oy + 8) % 8) * 8 + (ox + 8) % 8;
          expected[sp * n + target] += transmitted;
          expected[sp * n + source] -= transmitted;
        }
      }
      const sim = new RefSim(state); sim.step();
      for (let sp = 0; sp < 3; sp++)
        expect(sim.state.cells.slice(channels[sp] * n, (channels[sp] + 1) * n)).toEqual(expected.slice(sp * n, (sp + 1) * n));
      expect(totalsOf(sim.cfg, sim.state.cells).matter).toBe(initial.matter);
      expect(ledgerResidual(initial, sim.state)).toBe(0n);
    }
  });

  it("leaves absent/false rule-2 dynamics equal to historical rule 1, including mutation", () => {
    const cfg = defaultConfig({ ruleVersion: 1, tileW: 32, tileH: 32, kernelRadius: 4, seed: 9, mutRate: 20_000_000 });
    const initial = generalistWorld(cfg, 2, 32, 64);
    const legacy = new RefSim(cloneState(initial));
    const absentState = cloneState(initial); absentState.cfg = { ...cfg, ruleVersion: 2 };
    const falseState = cloneState(initial); falseState.cfg = { ...cfg, ruleVersion: 2, polymerDrag: false };
    const absent = new RefSim(absentState), disabled = new RefSim(falseState);
    const events = [legacy, absent, disabled].map((sim) => sim.run(40));
    expect(events[1]).toEqual(events[0]); expect(events[2]).toEqual(events[0]);
    expectSameDynamics(absent.state, legacy.state); expectSameDynamics(disabled.state, legacy.state);
  });

  it("changes nothing without polymer and closes the reacting world's ledgers with drag", () => {
    const cfg = defaultConfig({ ruleVersion: 2, tileW: 32, tileH: 32, kernelRadius: 4, seed: 13, kBuild: 0 });
    const initial = generalistWorld(cfg, 2, 32, 64);
    const off = new RefSim(cloneState(initial));
    const onState = cloneState(initial); onState.cfg = { ...cfg, polymerDrag: true };
    const on = new RefSim(onState); off.run(40); on.run(40);
    expectSameDynamics(on.state, off.state);
    const reacting = generalistWorld({ ...cfg, polymerDrag: true, kBuild: 64 }, 2, 32, 64);
    const totals = totalsOf(reacting.cfg, reacting.cells), sim = new RefSim(reacting);
    for (let i = 0; i < 40; i++) {
      sim.step();
      expect(totalsOf(sim.cfg, sim.state.cells).matter).toBe(totals.matter);
      expect(ledgerResidual(totals, sim.state)).toBe(0n);
    }
  });
});
