import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, NN_BYTES, allocState, cellCount, cloneState,
  defaultConfig, encodeGenome, generalistGenome, packLineageLo, stateHash,
  type WorldState } from "@bl/schema";
import { RefSim, mutateInPlace, type MutationEvent } from "@bl/sim-ref";
import { ResetCopyLedger } from "../lib/reset-copy-ledger.ts";
import { transportDestinationAudit } from "../lib/foundation-material-flow.ts";

function world(mutRate = 0xffffffff): WorldState {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
    kernelRadius: 2, seed: 17, mutRate, lightMode: "uniform" as const,
    lightBase: 0, lightAmp: 255, kPhoto: 4096, kGrow: 4096,
    kCost: 0, kMaint: 0 };
  const state = allocState(cfg), n = cellCount(cfg);
  const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
  for (let i = 0; i < n; i++) state.cells[CH.A * n + i] = 256;
  for (const i of [0, 1]) {
    state.cells[CH.B * n + i] = 64;
    state.cells[CH.E * n + i] = 1000;
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  return state;
}

/** Capture actual reference-phase displacement without changing its physical step. */
function phasedStep(sim: RefSim): { before: WorldState; after: WorldState;
  displacement: Uint32Array; events: MutationEvent[] } {
  const before = cloneState(sim.state);
  const phases = sim as unknown as { affinity(): void; flow(): void; transport(): void;
    react(): { events: MutationEvent[] }; disp: Uint32Array };
  phases.affinity(); phases.flow();
  const displacement = phases.disp.slice();
  phases.transport();
  const result = phases.react();
  sim.state.step++;
  return { before, after: cloneState(sim.state), displacement, events: result.events };
}

describe("mutation-enabled, non-recoloring copy ledger", () => {
  it("follows actual lottery winners through real mutations with exact physical parity", () => {
    const initial = world(), instrumented = new RefSim(cloneState(initial)),
      uninstrumented = new RefSim(cloneState(initial)), ledger = new ResetCopyLedger(initial);
    let effective = 0, proposals = 0;
    for (let step = 1; step <= 5; step++) {
      const observed = phasedStep(instrumented);
      const result = uninstrumented.step();
      expect(stateHash(observed.after)).toBe(stateHash(uninstrumented.state));
      expect(observed.events).toEqual(result.events);
      const sidecar = ledger.observeStep(observed.before, observed.after,
        observed.events, { displacement: observed.displacement,
          record: Array.from({ length: cellCount(initial.cfg) }, (_, i) => i) });
      expect(sidecar.continuousCoverage).toBe(true);
      expect(sidecar.uninspectedMutationEvents).toBe(0);
      for (const cell of sidecar.observedCells) if (cell.mutation) {
        proposals++;
        expect(cell.mutation.parentLineage).toBe(cell.winnerLineage);
        if (cell.mutation.classification === "effective-genotype-change") effective++;
      }
      expect(stateHash(observed.after)).toBe(stateHash(uninstrumented.state));
    }
    expect(proposals).toBeGreaterThan(0);
    expect(effective).toBeGreaterThan(0);
  });

  it("never recovers a skipped copy path merely from equal later lineage labels", () => {
    const initial = world(0), sim = new RefSim(cloneState(initial));
    const ledger = new ResetCopyLedger(initial);
    const one = phasedStep(sim);
    const missing = ledger.observeStep(one.before, one.after, one.events,
      { propagate: [], record: [], displacement: one.displacement });
    expect(missing.continuousCoverage).toBe(false);
    const two = phasedStep(sim);
    const found = ledger.observeStep(two.before, two.after, two.events,
      { displacement: two.displacement });
    expect(found.observedCells.some(c => c.afterBound > 0 &&
      c.copyAvailability === "unavailable-unobserved-path")).toBe(true);
    expect(found.observedCells.some(c => c.copySource !== null)).toBe(false);
  });

  it("distinguishes checkpoint copy origin from unknown earlier ancestry", () => {
    const initial = world(0), sim = new RefSim(cloneState(initial));
    const ledger = new ResetCopyLedger(initial), step = phasedStep(sim);
    const out = ledger.observeStep(step.before, step.after, step.events,
      { displacement: step.displacement });
    const linked = out.observedCells.find(c => c.copySource !== null)!;
    expect(linked.copySource).toMatchObject({ checkpointStep: 0,
      olderAncestry: "unknown-before-checkpoint" });
    expect(linked.materialInterpretation).toBe(
      "prior-site-transport-only-postreaction-ownership-unknown");
  });

  it("rejects a forged mutation parent or missing physical step", () => {
    const initial = world(), step = phasedStep(new RefSim(cloneState(initial)));
    const first = step.events[0];
    expect(first).toBeDefined();
    expect(() => new ResetCopyLedger(initial).observeStep(step.before, step.after,
      [{ ...first, parentLo: first.parentLo + 1 }, ...step.events.slice(1)],
      { displacement: step.displacement })).toThrow(/parent\/child/);
    const ledger = new ResetCopyLedger(initial);
    ledger.observeStep(step.before, step.after, step.events,
      { displacement: step.displacement });
    expect(() => ledger.observeStep(step.before, step.after, step.events,
      { displacement: step.displacement })).toThrow(/continuous/);
  });

  it("records a rule-consistent clamped proposal as no genotype change", () => {
    const initial = world(0), n = cellCount(initial.cfg);
    for (const i of [0, 1]) {
      const word = initial.genome[G.PARAM0 * n + i];
      initial.genome[G.PARAM0 * n + i] = (word & 0xffff0000) | 4095;
    }
    const step = phasedStep(new RefSim(cloneState(initial)));
    const i = 0, audit = transportDestinationAudit(step.before, step.displacement, i);
    expect(audit.genomeWinnerSourceIndex).not.toBeNull();
    const after = cloneState(step.after), old = after.genome[G.PARAM0 * n + i];
    mutateInPlace(after.genome, n, i, after.cfg, NN_BYTES, after.cfg.mutStep + 1);
    expect(after.genome[G.PARAM0 * n + i]).toBe(old);
    after.genome[G.LIN_HI * n + i] = after.step;
    after.genome[G.LIN_LO * n + i] = packLineageLo(after.cfg, i);
    const source = audit.genomeWinnerSourceIndex!;
    const event = { childHi: after.step, childLo: packLineageLo(after.cfg, i),
      parentHi: step.before.genome[G.LIN_HI * n + source],
      parentLo: step.before.genome[G.LIN_LO * n + source] };
    const result = new ResetCopyLedger(initial).observeStep(step.before, after, [event],
      { displacement: step.displacement, record: [i] });
    expect(result.observedCells[0].mutation?.classification)
      .toBe("clamped-or-no-change-proposal");
  });

  it("keeps a minority-material lottery winner distinct from incoming source shares", () => {
    const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
      kernelRadius: 2, seed: 2, spread: 20, mutRate: 0xffffffff };
    const initial = allocState(cfg), n = cellCount(cfg);
    for (let i = 0; i < n; i++) {
      initial.cells[CH.A * n + i] = 32;
      initial.cells[CH.MOT * n + i] = 128 | (128 << 8);
    }
    for (const [i, B, lo] of [[0, 1000, 1], [1, 300, 2]]) {
      initial.cells[CH.B * n + i] = B;
      initial.cells[CH.E * n + i] = 150;
      const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, lo);
      for (let g = 0; g < GENOME_CHANNELS; g++) initial.genome[g * n + i] = words[g];
    }
    const step = phasedStep(new RefSim(cloneState(initial)));
    const out = new ResetCopyLedger(initial).observeStep(step.before, step.after,
      step.events, { displacement: step.displacement, record: [57] });
    const row = out.observedCells[0];
    expect(row.winnerSourceIndex).toBe(0);
    expect(row.sourceShares.find(x => x.sourceIndex === 0)?.B).toBe(31);
    expect(row.sourceShares.find(x => x.sourceIndex === 1)?.B).toBe(35);
    expect(row.copySource?.cellIndex).toBe(0);
    expect(row.materialInterpretation)
      .toBe("prior-site-transport-only-postreaction-ownership-unknown");
    const reconstructed = new ResetCopyLedger(initial).observeStep(step.before, step.after,
      step.events, { record: [57] }).observedCells[0];
    expect(reconstructed).toEqual(row);
  });

  it("reconstructs default displacements against every actual reference winner and incoming quantity", () => {
    const initial = world(), step = phasedStep(new RefSim(cloneState(initial)));
    const all = Array.from({ length: cellCount(initial.cfg) }, (_, i) => i);
    const oracle = new ResetCopyLedger(initial).observeStep(step.before, step.after,
      step.events, { displacement: step.displacement, record: all });
    const reconstructed = new ResetCopyLedger(initial).observeStep(step.before, step.after,
      step.events, { record: all });
    expect(reconstructed).toEqual(oracle);
    expect(oracle.observedCells.some(c => c.winnerSourceIndex !== null)).toBe(true);
    expect(oracle.observedCells.some(c => c.sourceShares.filter(s => s.B + s.P > 0).length > 1))
      .toBe(true);
  });

  it("uses physical parent support rather than a shared founder lineage for event-local attribution", () => {
    const initial = world(0), n = cellCount(initial.cfg);
    for (let ch = 0; ch < 7; ch++) {
      initial.cells[ch * n + 4] = initial.cells[ch * n + 1];
      if (ch !== CH.A) initial.cells[ch * n + 1] = 0;
    }
    for (let g = 0; g < GENOME_CHANNELS; g++) {
      initial.genome[g * n + 4] = initial.genome[g * n + 1];
      initial.genome[g * n + 1] = 0;
    }
    const step = phasedStep(new RefSim(cloneState(initial)));
    const out = new ResetCopyLedger(initial, { parentSites: [0] }).observeStep(
      step.before, step.after, step.events, { displacement: step.displacement });
    const parent = out.observedCells.find(c => c.copySource?.cellIndex === 0);
    const other = out.observedCells.find(c => c.copySource?.cellIndex === 4);
    expect(parent).toBeDefined();
    expect(other).toBeDefined();
    expect(parent?.winnerLineage).toBe(other?.winnerLineage);
    expect(parent?.attributedParentCopy).toBe("supported-by-local-parent-reference");
    expect(other?.attributedParentCopy).toBe("from-other-local-reference");
  });

  it("retains a real mutation proposal whose carrier dies later in the same reaction", () => {
    const initial = world(), n = cellCount(initial.cfg);
    initial.cfg.seed = 1;
    initial.cfg.kCost = 65535;
    initial.cfg.kMaint = 65535;
    initial.cfg.kBDecay = 65535;
    initial.cfg.kPDecay = 65535;
    for (const i of [0, 1]) initial.cells[CH.E * n + i] = 0;
    const phased = phasedStep(new RefSim(cloneState(initial)));
    const ordinary = new RefSim(cloneState(initial));
    const ordinaryEvents = ordinary.step().events;
    expect(stateHash(phased.after)).toBe(stateHash(ordinary.state));
    expect(phased.events).toEqual(ordinaryEvents);
    const out = new ResetCopyLedger(initial, { parentSites: [0] }).observeStep(
      phased.before, phased.after, phased.events,
      { displacement: phased.displacement, record: [0, 1] });
    const transient = out.observedCells.find(c =>
      c.mutation?.classification === "transient-after-death");
    expect(transient).toBeDefined();
    expect(transient?.afterBound).toBe(0);
    expect(transient?.copySource).toBeNull();
    expect(transient?.attributedParentCopy).toBe("unavailable");
    expect(out.uninspectedMutationEvents).toBe(0);
  });
});
