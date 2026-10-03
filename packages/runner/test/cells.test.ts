// Declared cells at a census boundary (WorldConfig.cellPeriod; docs/sandbox-cells.md): `cellsAtBoundary`
// against the pure pass, on the reference physics behind a readState/upload pair.
import { describe, expect, it } from "vitest";
import { M3_FOUNDERS, buildWorld, cloneState, defaultConfig, founderGenome, stateHash, type WorldState } from "@bl/schema";
import { RefSim, applyCellPass } from "@bl/sim-ref";
import { cellsAtBoundary } from "../src/migrate.ts";

class CpuSim {
  ref: RefSim;
  reads = 0;
  uploads = 0;
  constructor(state: WorldState) {
    this.ref = new RefSim(cloneState(state));
  }
  get cfg() {
    return this.ref.state.cfg;
  }
  async readState() {
    this.reads++;
    return cloneState(this.ref.state);
  }
  upload(state: WorldState) {
    this.uploads++;
    this.ref = new RefSim(cloneState(state));
  }
}

const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 79, mutRate: 0, cellPeriod: 200, cellMutProb: 2 ** 32 });
const start = buildWorld(cfg, {
  nutrient: 32,
  founders: [0, 1, 2, 5].map((f, k) => ({ x: 8 + 16 * (k & 1), y: 8 + 16 * (k >> 1), radius: 6, genome: founderGenome(M3_FOUNDERS[f]), biomass: 64, energy: 128 })),
});

describe("cellsAtBoundary", () => {
  it("runs the pass only where cellPeriod divides the step, and uploads the post-pass state", async () => {
    const sim = new CpuSim(start);
    let born = 0;
    for (let step = 100; step <= 1200; step += 100) {
      sim.ref.run(100);
      const pre = cloneState(sim.ref.state);
      const reads = sim.reads, uploads = sim.uploads;
      const res = await cellsAtBoundary(sim, step);
      if (step % 200 !== 0) {
        expect(res).toEqual({ births: [], state: null });
        expect([sim.reads, sim.uploads]).toEqual([reads, uploads]);
        continue;
      }
      const want = cloneState(pre);
      const births = applyCellPass(want);
      expect(res.births).toEqual(births);
      expect(sim.reads).toBe(reads + 1);
      expect(sim.uploads).toBe(uploads + (births.length ? 1 : 0));
      expect(stateHash(sim.ref.state)).toBe(stateHash(want));
      expect(stateHash(res.state!)).toBe(stateHash(want));
      born += births.length;
    }
    expect(born).toBeGreaterThan(0);
  }, 120_000);

  it("uses a readback the caller already has, refuses one from another step, and ignores configs without the key", async () => {
    const sim = new CpuSim(start);
    sim.ref.run(200);
    const known = cloneState(sim.ref.state);
    const res = await cellsAtBoundary(sim, 200, known);
    expect(sim.reads).toBe(0);
    expect(res.state).toBe(known);
    await expect(cellsAtBoundary(sim, 400, known)).rejects.toThrow(/simulation is at t=200/);
    const plain = new CpuSim(buildWorld(defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 79 }), { nutrient: 32, founders: [] }));
    expect(await cellsAtBoundary(plain, 200)).toEqual({ births: [], state: null });
    expect(plain.reads).toBe(0);
  }, 120_000);
});
