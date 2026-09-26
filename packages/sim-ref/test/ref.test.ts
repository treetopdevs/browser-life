import { describe, expect, it } from "vitest";
import {
  cloneState,
  decodeCheckpoint,
  defaultConfig,
  encodeCheckpoint,
  generalistWorld,
  ledgerResidual,
  soupWorld,
  stateHash,
  totalsOf,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

const small = defaultConfig({ tileW: 48, tileH: 48, kernelRadius: 5, seed: 7 });

describe("reference rules", () => {
  it("conserves matter exactly and closes the energy ledger every step", () => {
    const s = soupWorld(small, 6);
    const start = totalsOf(small, s.cells);
    const sim = new RefSim(s);
    for (let i = 0; i < 60; i++) {
      sim.step();
      const t = totalsOf(small, sim.state.cells);
      expect(t.matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
    expect(sim.state.lightIn).toBeGreaterThan(0n);
    expect(sim.state.heatOut).toBeGreaterThan(0n);
  });

  it("is deterministic", () => {
    const a = new RefSim(generalistWorld(small, 3));
    const b = new RefSim(generalistWorld(small, 3));
    a.run(25);
    b.run(25);
    expect(stateHash(a.state)).toBe(stateHash(b.state));
  });

  it("different seeds diverge", () => {
    const a = new RefSim(generalistWorld(small, 3));
    const b = new RefSim(generalistWorld({ ...small, seed: 8 }, 3));
    a.run(5);
    b.run(5);
    expect(stateHash(a.state)).not.toBe(stateHash(b.state));
  });

  it("round-trips checkpoints and resumes bit-exact", () => {
    const a = new RefSim(soupWorld(small, 4));
    a.run(10);
    const { state: snap } = decodeCheckpoint(encodeCheckpoint(a.state));
    expect(stateHash(snap)).toBe(stateHash(a.state));
    expect(snap.lightIn).toBe(a.state.lightIn);
    const b = new RefSim(cloneState(snap));
    a.run(10);
    b.run(10);
    expect(stateHash(b.state)).toBe(stateHash(a.state));
  });

  it("rejects corrupted checkpoints", () => {
    const bytes = encodeCheckpoint(soupWorld(small, 2));
    bytes[200] ^= 1;
    expect(() => decodeCheckpoint(bytes)).toThrow(/checksum/);
  });

  it("tiles are independent worlds", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, kernelRadius: 4, seed: 3 });
    const s = generalistWorld(cfg, 0);
    // Put biomass only in tile 0; tile 1 must never receive bound mass.
    const n = 64 * 32;
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) s.cells[1 * n + y * 64 + x] = 300;
    const sim = new RefSim(s);
    sim.run(30);
    let tile1 = 0;
    for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) tile1 += sim.state.cells[1 * n + y * 64 + x];
    expect(tile1).toBe(0);
  });
});

import { mutationThreshold } from "@bl/sim-ref";

describe("mutation probability (review 4)", () => {
  it("saturates only when newB * mutRate would overflow", () => {
    const rate = 3_000_000_000;
    const cap = Math.floor(0xffffffff / rate); // 1
    expect(mutationThreshold(1, cap, rate)).toBe(rate);
    expect(mutationThreshold(2, cap, rate)).toBe(0xffffffff);
    expect(mutationThreshold(4, 4, 0x3fffffff)).toBe(0xfffffffc);
  });
});
