import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, FLUX_NAMES, allocState, cellCount, cloneState, defaultConfig,
  encodeGenome, generalistGenome, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { Tracker, census } from "@bl/metrics";
import { assertColorTwinParity, colorLivingSources, componentCopySources, preflightRoots } from
  "../lib/foundation-copy-ancestry.ts";
import { overlappingPriorIdentities } from "../lib/foundation-lifecycle.ts";
import { assertTransportObservation, transportDestinationAudit } from
  "../lib/foundation-material-flow.ts";

const make = (seed = 2): WorldState => {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
    kernelRadius: 2, mutRate: 0, spread: 20, seed };
  const state = allocState(cfg), n = cellCount(cfg);
  for (let i = 0; i < n; i++) {
    state.cells[CH.A * n + i] = 32;
    state.cells[CH.MOT * n + i] = 128 | (128 << 8);
  }
  return state;
};
function living(state: WorldState, i: number, B: number, lineage: number): void {
  const n = cellCount(state.cfg);
  state.cells[CH.B * n + i] = B;
  state.cells[CH.E * n + i] = 150;
  const words = encodeGenome(generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma), 0, lineage);
  for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
}
function executedTransport(state: WorldState) {
  const ref = new RefSim(cloneState(state));
  const phases = ref as unknown as { affinity(): void; flow(): void; transport(): void;
    disp: Uint32Array };
  phases.affinity(); phases.flow();
  const displacement = phases.disp.slice();
  phases.transport();
  return { displacement, transported: ref.state };
}

describe("late A1 constructed ancestry coverage", () => {
  it("keeps a minority material source as the actual genome-lottery winner", () => {
    const source = make(2);
    living(source, 0, 1000, 1); living(source, 1, 300, 2);
    const { displacement, transported } = executedTransport(source);
    const audit = transportDestinationAudit(source, displacement, 57);
    const winner = audit.sources.find((x) => x.sourceIndex === audit.genomeWinnerSourceIndex)!;
    const other = audit.sources.find((x) => x.sourceIndex === 1)!;
    expect(audit.genomeWinnerSourceIndex).toBe(0);
    expect(winner.B).toBe(31);
    expect(other.B).toBe(35);
    expect(winner.B).toBeLessThan(other.B);
    expect(audit.incoming.B).toBe(66);
    assertTransportObservation(audit, transported);
  });

  it("audits an executed material/genome crossing of the toroidal edge", () => {
    const source = make(2);
    living(source, 7, 1000, 7); // right edge of an 8-wide tile
    const { displacement, transported } = executedTransport(source);
    const leftEdge = transportDestinationAudit(source, displacement, 0);
    expect(leftEdge.sources.find((x) => x.sourceIndex === 7)?.B).toBe(118);
    expect(leftEdge.genomeWinnerSourceIndex).toBe(7);
    assertTransportObservation(leftEdge, transported);
  });

  it("flags crossing split/fusion overlap even when both prior observer IDs continue", () => {
    const before = make(), after = make(), n = cellCount(before.cfg);
    for (let y = 1; y <= 4; y++) {
      living(before, y * 8 + 1, 300, 1);
    }
    for (let y = 2; y <= 5; y++) living(before, y * 8 + 5, 300, 2);
    for (const y of [1, 2, 4, 5]) for (let x = 1; x <= 5; x++)
      living(after, y * 8 + x, 300, x < 3 ? 1 : 2);
    const prior = census({ cfg: before.cfg, step: 0, cells: before.cells,
      genomeHead: before.genome.subarray(0, 4 * n) });
    const current = census({ cfg: after.cfg, step: 25, cells: after.cells,
      genomeHead: after.genome.subarray(0, 4 * n) });
    expect(prior.components).toHaveLength(2);
    expect(current.components).toHaveLength(2);
    const tracker = new Tracker({ threshold: 48, minMass: 256 });
    expect(tracker.update(prior)).toEqual([]);
    const oldIds = new Map(prior.components.map(c => [c.idx, tracker.idOf(c.idx)!]));
    const events = tracker.update(current);
    expect(events.filter(e => e.kind === "fusion")).toEqual([]);
    expect([...tracker.alive.keys()].sort()).toEqual([1, 2]);
    const mixing = overlappingPriorIdentities(prior.labels, oldIds, current,
      (idx) => tracker.idOf(idx), 256);
    expect(mixing).toEqual([
      { step: 25, componentIndex: 0, currentId: 1, priorIds: [1, 2] },
      { step: 25, componentIndex: 1, currentId: 2, priorIds: [1, 2] },
    ]);
    // Retaining the two observer labels does not make either new shape unmixed.
  });

  it("keeps empty and zero-controller observations distinct from ancestry", () => {
    const empty = make(), n = cellCount(empty.cfg);
    expect(preflightRoots(empty).eligibleRootIndices).toEqual([]);
    expect(colorLivingSources(empty).colors).toEqual([]);
    const neutral = make();
    living(neutral, 0, 300, 1);
    for (let g = G.W0; g < GENOME_CHANNELS; g++) neutral.genome[g * n] = 0;
    const twin = colorLivingSources(neutral);
    expect(twin.colors).toHaveLength(1);
    const a = new RefSim(cloneState(neutral)), b = new RefSim(cloneState(twin.state));
    a.step(); b.step();
    assertColorTwinParity(a.state, b.state);
    expect(preflightRoots(a.state).eligibleRootIndices.length).toBeLessThanOrEqual(1);
  });

  it("retains copy-origin labels when almost all final bound mass must be newly synthesized", () => {
    const source = allocState({ ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1,
      tilesY: 1, kernelRadius: 2, seed: 17, mutRate: 0,
      lightMode: "uniform", lightBase: 0, lightAmp: 255,
      kPhoto: 4096, kGrow: 4096, kCost: 0, kMaint: 0 });
    const n = cellCount(source.cfg);
    for (let i = 0; i < n; i++) source.cells[CH.A * n + i] = 256;
    for (const i of [0, 1]) {
      source.cells[CH.B * n + i] = 32;
      source.cells[CH.E * n + i] = 1000;
      const words = encodeGenome(generalistGenome(source.cfg.defaultMu, source.cfg.defaultSigma), 0, 1);
      for (let g = 0; g < GENOME_CHANNELS; g++) source.genome[g * n + i] = words[g];
    }
    const initialBound = 64;
    const twin = colorLivingSources(source);
    const plain = new RefSim(cloneState(source)), colored = new RefSim(cloneState(twin.state));
    let totalPhoto = 0n;
    for (let step = 1; step <= 100; step++) {
      plain.step(); colored.step();
      assertColorTwinParity(plain.state, colored.state);
      totalPhoto += plain.state.flux[FLUX_NAMES.indexOf("photo")];
    }
    const finalBound = Array.from({ length: n }, (_, i) =>
      plain.state.cells[CH.B * n + i] + plain.state.cells[CH.P * n + i])
      .reduce((sum, x) => sum + x, 0);
    expect(totalPhoto).toBeGreaterThan(0n);
    expect(finalBound).toBeGreaterThan(initialBound * 100);
    // At most all 64 initial B units can remain as old material: <1% of final B+P.
    expect(initialBound / finalBound).toBeLessThan(0.01);
    const roots = preflightRoots(colored.state).eligibleRootIndices;
    expect(roots).toEqual([0]);
    expect(componentCopySources(colored.state, roots[0], twin.colors).status).toBe("known");
    // This bounds material provenance but does not identify which final molecules are old.
  });
});
