import { describe, expect, it } from "vitest";
import { CH, MOT_ZERO, canonicalJSON, ROLE_WORDS, allocState, buildWorld, cellCount, cloneState, defaultConfig, generalistGenome, worldW, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  ExactLedgerObserver,
  gateSealPolymer,
  maintainedSites,
  roleCountersExact,
  roleWordSaturated,
  transportBands,
  transportOutflow,
  type CensusRecord,
  type FinalRecord,
  type ObservationRecord,
} from "@bl/metrics";

/** A passive world: no genomes, no displacement, no decay, so bound matter moves by transport alone. */
function passive(spread: number, deposits: { x: number; y: number; B: number; P?: number; E?: number }[], extra: Partial<WorldConfig> = {}): WorldState {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 8500001, spread, dtQ: 0, motility: false, kBDecay: 0, kPDecay: 0, kELeak: 0, ...extra });
  const s = allocState(cfg);
  const n = cellCount(cfg);
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  for (const d of deposits) {
    const i = d.y * worldW(cfg) + d.x;
    s.cells[CH.B * n + i] = d.B;
    s.cells[CH.P * n + i] = d.P ?? 0;
    s.cells[CH.E * n + i] = d.E ?? 0;
  }
  return s;
}

describe("exact transport arithmetic against passive reference runs", () => {
  it("reproduces the RESEARCH table", () => {
    expect(transportBands(1)).toMatchObject({ firstCardinal: 69, oneQuantumUpTo: 136, firstDiagonal: 4356 });
    expect(transportBands(2)).toMatchObject({ firstCardinal: 37, oneQuantumUpTo: 72, firstDiagonal: 1156 });
    expect(transportBands(4)).toMatchObject({ firstCardinal: 21, oneQuantumUpTo: 40, firstDiagonal: 324 });
    expect(transportBands(8)).toMatchObject({ firstCardinal: 13, oneQuantumUpTo: 24, firstDiagonal: 100 });
    expect(transportBands(0).firstCardinal).toBeNull();
    const pct = (s: number) => (100 * transportBands(s).shareNum) / transportBands(s).shareDen;
    expect(pct(1).toFixed(2)).toBe("5.97");
    expect(pct(2).toFixed(2)).toBe("11.42");
    expect(pct(4).toFixed(2)).toBe("20.99");
    expect(pct(8).toFixed(2)).toBe("36.00");
  });

  for (const s of [0, 1, 2, 4, 8]) {
    it(`closed-form one-step outflow equals the simulator at every band edge, spread ${s}`, () => {
      const b = transportBands(s);
      const edges = [0, 1, 12, 13, 20, 21, 24, 25, 36, 37, 40, 41, 68, 69, 72, 73, 99, 100, 136, 137, 323, 324, 1155, 1156, 4355, 4356, 65536, 1_000_000];
      if (b.firstCardinal) edges.push(b.firstCardinal - 1, b.firstCardinal, b.oneQuantumUpTo!, b.oneQuantumUpTo! + 1, b.firstDiagonal! - 1, b.firstDiagonal!);
      // Nine isolated deposits per world: each sees no inflow on step 1.
      for (let k = 0; k < edges.length; k += 9) {
        const batch = edges.slice(k, k + 9).map((q, j) => ({ x: 4 + 10 * (j % 3), y: 4 + 10 * Math.floor(j / 3), B: q, P: q, E: q }));
        const sim = new RefSim(passive(s, batch));
        sim.step();
        const n = sim.n;
        for (const d of batch) {
          const i = d.y * sim.W + d.x;
          const pred = transportOutflow(d.B, s).total;
          expect(d.B - sim.state.cells[CH.B * n + i], `B q=${d.B}`).toBe(pred);
          expect(d.P - sim.state.cells[CH.P * n + i], `P q=${d.P}`).toBe(pred);
          expect(d.E - sim.state.cells[CH.E * n + i], `E q=${d.E}`).toBe(pred);
        }
      }
    });
  }

  it("the diffusion gate seals at the computed polymer level (gateK 1) and still leaks one quantum below it", () => {
    const D = 100;
    expect(gateSealPolymer(D, 1)).toBe(D);
    expect(gateSealPolymer(D, 64)).toBe(64 * 99 + 1);
    // floor(D·gateK / (gateK + P)) reaches zero exactly at the seal level.
    for (const K of [1, 2, 64]) {
      const seal = gateSealPolymer(D, K);
      expect(Math.floor((D * K) / (K + seal))).toBe(0);
      expect(Math.floor((D * K) / (K + seal - 1))).toBeGreaterThan(0);
    }
  });
});

describe("role counters", () => {
  it("are exact only below 65535 total matter, and a saturated word is detected", () => {
    expect(roleCountersExact(65534n)).toBe(true);
    expect(roleCountersExact(65535n)).toBe(false);
    const r = new Uint32Array(4 * ROLE_WORDS);
    r[1 * ROLE_WORDS] = 0xffff;
    r[2 * ROLE_WORDS + 1] = 0xffff0000;
    expect(roleWordSaturated(r, 0)).toBe(false);
    expect(roleWordSaturated(r, 1)).toBe(true);
    expect(roleWordSaturated(r, 2)).toBe(true);
  });
});

function observe(s: WorldState, steps: number, every: number, sites: { x: number; y: number }[]): ObservationRecord[] {
  const sim = new RefSim(s);
  const obs = ExactLedgerObserver.start(sim.state, sites);
  const recs: ObservationRecord[] = [obs.census(sim.state)];
  for (let k = 1; k <= steps; k++) {
    sim.step();
    obs.afterStep({ state: sim.state, roles: sim.roles });
    if (k % every === 0) recs.push(obs.census(sim.state));
  }
  recs.push(obs.final(sim.state, null));
  return recs;
}

describe("exact-ledger observer", () => {
  it("keeps exact matter, energy and flux ledgers on a reacting world", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 8500001, lightMode: "uniform" });
    const s = buildWorld(cfg, { nutrient: 64, founders: [{ x: 16, y: 16, radius: 5, genome: generalistGenome(60, 20), biomass: 128, energy: 256 }] });
    const recs = observe(s, 150, 50, [{ x: 16, y: 16 }]);
    const fin = recs[recs.length - 1] as FinalRecord;
    expect(fin.matterResidualMax).toBe("0");
    expect(fin.energyResidualMax).toBe("0");
    expect(fin.fluxIdentityViolations).toBe(0);
    expect(fin.rolesExact).toBe(true);
    expect(BigInt((recs[3] as CensusRecord).sites[0].Q)).toBeGreaterThan(0n);
  });

  it("does not depend on buffers the simulator reuses (source-buffer reuse)", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 8500002, lightMode: "uniform" });
    const s = buildWorld(cfg, { nutrient: 64, founders: [{ x: 16, y: 16, radius: 5, genome: generalistGenome(60, 20), biomass: 128, energy: 256 }] });
    // The hazard: a reference to the cells array taken before a step is overwritten by a later step.
    const sim = new RefSim(cloneState(s));
    const held = sim.state.cells;
    const before = held.slice();
    sim.step();
    sim.step();
    expect(held === sim.state.cells || held.some((v, i) => v !== before[i])).toBe(true);
    // The observer fed from a live simulator equals the observer fed deep copies.
    const live = observe(cloneState(s), 60, 20, [{ x: 16, y: 16 }]);
    const sim2 = new RefSim(cloneState(s));
    const obs = ExactLedgerObserver.start(cloneState(sim2.state), [{ x: 16, y: 16 }]);
    const copied: ObservationRecord[] = [obs.census(cloneState(sim2.state))];
    for (let k = 1; k <= 60; k++) {
      sim2.step();
      obs.afterStep({ state: cloneState(sim2.state), roles: sim2.roles.slice() });
      if (k % 20 === 0) copied.push(obs.census(cloneState(sim2.state)));
    }
    copied.push(obs.final(cloneState(sim2.state), null));
    expect(JSON.stringify(copied)).toBe(JSON.stringify(live));
  });

  it("round-trips its state through JSON mid-history without changing any record", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, seed: 8500001, lightMode: "uniform" });
    const s = buildWorld(cfg, { nutrient: 64, founders: [{ x: 16, y: 16, radius: 5, genome: generalistGenome(60, 20), biomass: 128, energy: 256 }] });
    const a = observe(cloneState(s), 40, 10, [{ x: 16, y: 16 }]);
    const sim = new RefSim(cloneState(s));
    let obs = ExactLedgerObserver.start(sim.state, [{ x: 16, y: 16 }]);
    const b: ObservationRecord[] = [obs.census(sim.state)];
    for (let k = 1; k <= 40; k++) {
      sim.step();
      obs.afterStep({ state: sim.state, roles: sim.roles });
      if (k % 10 === 0) b.push(obs.census(sim.state));
      if (k === 15) obs = ExactLedgerObserver.restore(JSON.parse(JSON.stringify(obs.toJSON())));
    }
    b.push(obs.final(sim.state, null));
    expect(canonicalJSON(b)).toBe(canonicalJSON(a));
  });
});

describe("maintained-site readout (exploratory)", () => {
  it("does not count a passive deposit that merely stays above threshold", () => {
    // A large non-living deposit at spread 0 keeps B ≥ 128 forever with zero synthesis.
    const recs = observe(passive(0, [{ x: 8, y: 8, B: 5000 }]), 300, 50, [{ x: 8, y: 8 }]);
    const r = maintainedSites(recs, 100, 300, 128);
    expect(r.status).toBe("measured");
    if (r.status !== "measured") return;
    expect(r.sites[0].sustained).toBe(true);
    expect(r.sites[0].synthesis).toBe("0");
    expect(r.sites[0].maintained).toBe(false);
  });

  it("does not count a fixed site that an active patch has left (rotating active site)", () => {
    const rec = (step: number, B: number, Q: number): CensusRecord => ({
      kind: "census",
      step,
      totals: { A: "0", B: "0", C: "0", P: "0", E: "0", S: "0", matter: "0", energy: "0" },
      flux: [],
      lightIn: "0",
      heatOut: "0",
      livingCells: 1,
      occupiedB: 1,
      occupiedBP: 1,
      stateHash: "0000000000000000",
      sites: [
        { x: 1, y: 1, B, P: 0, E: 0, Q: String(Q) },
        { x: 2, y: 1, B: 200, P: 0, E: 0, Q: String(Q * 2) },
      ],
    });
    const fin = { kind: "final", rolesExact: true } as FinalRecord;
    // Site 0 is active early, then the patch moves on: synthesis is high but B drops below threshold mid-window.
    const recs: ObservationRecord[] = [rec(100, 300, 0), rec(200, 300, 400), rec(300, 40, 800), rec(400, 300, 1200), fin];
    const r = maintainedSites(recs, 100, 400, 128);
    if (r.status !== "measured") throw new Error(r.reason);
    expect(r.sites[0]).toMatchObject({ sustained: false, maintained: false });
    expect(r.sites[1]).toMatchObject({ sustained: true, maintained: true });
  });

  it("refuses to measure when the per-step counters could have saturated", () => {
    const fin = { kind: "final", rolesExact: false } as FinalRecord;
    expect(maintainedSites([fin], 0, 10, 128).status).toBe("unsupported-measurement");
  });
});
