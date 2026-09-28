import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, FLUX_NAMES, allocState, cellCount, cloneState, defaultConfig,
  encodeGenome, generalistGenome, validateState, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { specConfig, type RunSpec } from "@bl/runner";
import { assertColorSnapshotParity, assertColorTwinParity, assertSamePacketPreflight, colorLivingSources,
  componentCopySources, diagnoseComponentTransitions, initialCopyRegions,
  prepareSamePacketControls, preflightRoots } from
  "../lib/foundation-copy-ancestry.ts";
import { assertTransportObservation, sourceRegionShares, transportDestinationAudit } from
  "../lib/foundation-material-flow.ts";
import { localDisplacement, localDisplacementsForDestination } from
  "../lib/foundation-local-flow.ts";
import { componentMaterialEvidence, type MeasuredTransportView } from
  "../lib/foundation-component-material.ts";
import { extractCellPacket } from "../lib/foundation-transplant.ts";
import { prepareSerialStart, SERIAL_SOURCE_RUN } from "../lib/foundation-serial-transfer.ts";
import type { SourceIdentity } from "../lib/foundation-replay.ts";

const cfg = () => ({ ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2, seed: 17, mutRate: 0 });
const set = (s: WorldState, ch: number, i: number, v: number) =>
  s.cells[ch * cellCount(s.cfg) + i] = v;
const setGenome = (s: WorldState, i: number, lo: number, change = false) => {
  const g = generalistGenome(s.cfg.defaultMu, s.cfg.defaultSigma);
  if (change) g.motGain += 1;
  const words = encodeGenome(g, 0, lo), n = cellCount(s.cfg);
  for (let k = 0; k < GENOME_CHANNELS; k++) s.genome[k * n + i] = words[k];
};
function world(): WorldState {
  const s = allocState(cfg()), n = cellCount(s.cfg);
  for (let i = 0; i < n; i++) { set(s, CH.A, i, 32); set(s, CH.MOT, i, 128 | 128 << 8); }
  for (const [i, lo, B, variant] of [[0, 1, 500, 0], [1, 2, 600, 1]] as const) {
    set(s, CH.B, i, B); set(s, CH.E, i, 150);
    setGenome(s, i, lo, !!variant);
  }
  expect(validateState(s)).toEqual([]);
  return s;
}

describe("A1 CPU ancestry gates", () => {
  it("uses identical evolved packet matter/geometry for three genotype arms and rejects old multi-root founder disc", () => {
    const spec: RunSpec = { experiment: "m4", presetId: "gradient-m3", condition: "treatment",
      seed: 1, steps: 1_000_000, censusEvery: 100, deepEvery: 500, checkpointEvery: 0 };
    const source = { runId: SERIAL_SOURCE_RUN, spec } as SourceIdentity;
    const state = allocState(specConfig(spec));
    state.step = 900_000;
    const n = cellCount(state.cfg), W = state.cfg.tileW;
    const sites = [128 * W + 128, 128 * W + 129, 129 * W + 128, 129 * W + 129];
    const words = encodeGenome(generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma), 0, 1);
    for (const i of sites) {
      state.cells[CH.B * n + i] = 70;
      state.cells[CH.A * n + i] = 32;
      state.cells[CH.MOT * n + i] = 128 | 128 << 8;
      for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
    }
    expect(validateState(state)).toEqual([]);
    const arms = prepareSamePacketControls(source, extractCellPacket(state, sites));
    expect(() => assertSamePacketPreflight(arms)).not.toThrow();
    expect(arms.map((a) => a.preflight.eligibleRootIndices.length)).toEqual([1, 1, 1, 0]);
    expect(arms[0].state.cells).toEqual(arms[1].state.cells);
    expect(arms[1].state.cells).toEqual(arms[2].state.cells);
    expect(arms[0].inventory).toEqual(arms[1].inventory);
    expect(arms[1].inventory).toEqual(arms[2].inventory);
    const oldFounder = prepareSerialStart(source, 0, "founder", null);
    expect(preflightRoots(oldFounder.state).eligibleRootIndices.length).toBeGreaterThan(1);
  });

  it("preflights toroidal roots and retains small or unrelated components", () => {
    const s = world();
    const one = preflightRoots(s);
    expect(one.singleEligibleRoot).toBe(true);
    expect(one.components[0].lineages).toEqual(["0:1", "0:2"]);
    expect(one.components[0].mass).toBe(1100);
    set(s, CH.B, 1, 0); set(s, CH.E, 1, 0);
    s.genome[G.LIN_LO * cellCount(s.cfg) + 1] = 0;
    set(s, CH.B, 7, 600); set(s, CH.E, 7, 150); setGenome(s, 7, 2, true);
    expect(preflightRoots(s).singleEligibleRoot).toBe(true); // 0 and 7 meet across the torus
    set(s, CH.B, 3, 70); setGenome(s, 3, 3);
    const split = preflightRoots(s);
    expect(split.components).toHaveLength(2);
    expect(split.eligibleRootIndices).toHaveLength(1);
    expect(split.components.find((c) => !c.eligible)?.mass).toBe(70);
  });

  it("distinguishes same-genotype source cells and preserves exact physical parity", () => {
    const source = world();
    // Even identical genotypes do not erase distinct copy-source colors.
    setGenome(source, 1, 2, false);
    const colored = colorLivingSources(source);
    expect(colored.colors.map((c) => c.color)).toEqual(["0:1", "0:2"]);
    expect(componentCopySources(colored.state, 0, colored.colors).sourceCells).toEqual([0, 1]);
    const plainSim = new RefSim(cloneState(source));
    const colorSim = new RefSim(cloneState(colored.state));
    for (let step = 0; step < 5; step++) {
      plainSim.step(); colorSim.step();
      assertColorTwinParity(plainSim.state, colorSim.state);
      const n = cellCount(source.cfg);
      assertColorSnapshotParity({ step: plainSim.state.step, cells: plainSim.state.cells,
        genomeHead: plainSim.state.genome.subarray(0, 4 * n), flux: plainSim.state.flux },
      { step: colorSim.state.step, cells: colorSim.state.cells,
        genomeHead: colorSim.state.genome.subarray(0, 4 * n), flux: colorSim.state.flux });
    }
    const root = preflightRoots(colorSim.state).eligibleRootIndices[0];
    if (root !== undefined)
      expect(componentCopySources(colorSim.state, root, colored.colors).status).toBe("known");
    const bad = cloneState(colorSim.state);
    bad.cells[CH.A * cellCount(bad.cfg)]++;
    expect(() => assertColorTwinParity(plainSim.state, bad)).toThrow(/physical cell mismatch/);
    expect(() => assertColorSnapshotParity({ step: plainSim.state.step, cells: plainSim.state.cells,
      genomeHead: plainSim.state.genome.subarray(0, 4 * cellCount(source.cfg)), flux: plainSim.state.flux },
    { step: bad.step, cells: bad.cells,
      genomeHead: bad.genome.subarray(0, 4 * cellCount(source.cfg)), flux: bad.flux }))
      .toThrow(/physical mismatch/);
  });

  it("separates translated copy ancestry from site overlap and flags fused source regions", () => {
    const start = world();
    const { state: colored, colors } = colorLivingSources(start);
    const origins = initialCopyRegions(colored);
    const moved = cloneState(colored), n = cellCount(moved.cfg);
    moved.step = 1;
    for (const [from, to] of [[0, 3], [1, 4]]) {
      for (const ch of [CH.B, CH.E]) {
        moved.cells[ch * n + to] = moved.cells[ch * n + from];
        moved.cells[ch * n + from] = 0;
      }
      for (let g = 0; g < GENOME_CHANNELS; g++) {
        moved.genome[g * n + to] = moved.genome[g * n + from];
        moved.genome[g * n + from] = 0;
      }
    }
    const translated = diagnoseComponentTransitions(colored, moved, colors, origins);
    expect(translated).toHaveLength(1);
    expect(translated[0].priorSameSiteComponents).toEqual([]);
    expect(translated[0].copyOriginComponents).toEqual([0]);
    expect(translated[0].copyOriginStatus).toBe("one-initial-region");

    const separate = world();
    set(separate, CH.B, 1, 0); set(separate, CH.E, 1, 0);
    separate.genome[G.LIN_LO * n + 1] = 0;
    set(separate, CH.B, 2, 600); set(separate, CH.E, 2, 150);
    setGenome(separate, 2, 2, false); setGenome(separate, 0, 1, false);
    const other = colorLivingSources(separate);
    expect(preflightRoots(other.state).eligibleRootIndices).toEqual([0, 1]);
    const fused = cloneState(other.state); fused.step = 1;
    set(fused, CH.B, 1, 100);
    for (let g = 0; g < GENOME_CHANNELS; g++)
      fused.genome[g * n + 1] = fused.genome[g * n];
    const diagnosis = diagnoseComponentTransitions(other.state, fused, other.colors,
      initialCopyRegions(other.state));
    expect(diagnosis).toHaveLength(1);
    expect(diagnosis[0].priorSameSiteComponents).toEqual([0, 1]);
    expect(diagnosis[0].copyOriginStatus).toBe("mixed-initial-regions");
    expect(diagnosis[0].copyOriginComponents).toEqual([0, 1]);
    // A missing or post-coverage label remains unavailable, never assigned to the majority.
    fused.genome[G.LIN_LO * n + 1] = 3;
    expect(diagnoseComponentTransitions(other.state, fused, other.colors,
      initialCopyRegions(other.state))[0].copyOriginStatus).toBe("unavailable");
  });

  it("retains an asymmetric split as two packets with one initial copy region, not two proven births", () => {
    const start = world(), n = cellCount(start.cfg);
    set(start, CH.B, 2, 400); set(start, CH.E, 2, 100); setGenome(start, 2, 3);
    const colored = colorLivingSources(start), regions = initialCopyRegions(colored.state);
    const split = cloneState(colored.state); split.step = 1;
    set(split, CH.B, 1, 0); set(split, CH.E, 1, 0);
    for (let g = 0; g < GENOME_CHANNELS; g++) split.genome[g * n + 1] = 0;
    const rows = diagnoseComponentTransitions(colored.state, split, colored.colors, regions);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.copyOriginComponents)).toEqual([[0], [0]]);
    expect(rows.map((r) => r.copyOriginStatus)).toEqual(["one-initial-region", "one-initial-region"]);
    expect(rows.map((r) => r.priorSameSiteComponents)).toEqual([[0], [0]]);
  });

  it("observes newly synthesized B without turning a copied genome color into a matter label", () => {
    const s = world(), n = cellCount(s.cfg);
    s.cfg.lightMode = "uniform"; s.cfg.lightBase = 40; s.cfg.lightAmp = 160;
    for (let i = 0; i < n; i++) s.cells[CH.A * n + i] = 256;
    for (const i of [0, 1]) { s.cells[CH.B * n + i] = 64; s.cells[CH.E * n + i] = 128; }
    const twin = colorLivingSources(s);
    const a = new RefSim(cloneState(s)), b = new RefSim(cloneState(twin.state));
    for (let i = 0; i < 5; i++) { a.step(); b.step(); assertColorTwinParity(a.state, b.state); }
    expect(a.state.flux[FLUX_NAMES.indexOf("photo")]).toBeGreaterThan(0n);
    // Copied colors remain traceable while reaction records A -> B synthesis.
    const roots = preflightRoots(b.state).eligibleRootIndices;
    for (const root of roots)
      expect(componentCopySources(b.state, root, twin.colors).status).toBe("known");
  });

  it("audits exact transport shares and genome winner independently of source material", () => {
    const before = world();
    const sim = new RefSim(cloneState(before));
    // Test-only access to reference phases checks the pure auditor against the real transport.
    const phases = sim as unknown as { affinity(): void; flow(): void; transport(): void; disp: Uint32Array };
    phases.affinity(); phases.flow();
    const displacement = phases.disp.slice();
    for (let i = 0; i < cellCount(before.cfg); i++)
      expect(localDisplacement(before, i)).toBe(displacement[i]);
    phases.transport();
    let mixedDestinations = 0;
    let auditedB = 0n, auditedP = 0n, auditedE = 0n;
    for (let i = 0; i < cellCount(before.cfg); i++) {
      const audit = transportDestinationAudit(before, displacement, i);
      auditedB += BigInt(audit.incoming.B); auditedP += BigInt(audit.incoming.P);
      auditedE += BigInt(audit.incoming.E);
      const view = { cfg: before.cfg, step: before.step, cells: before.cells,
        genomeHead: before.genome.subarray(0, 4 * cellCount(before.cfg)) };
      expect(transportDestinationAudit(view, localDisplacementsForDestination(view, i), i))
        .toEqual(audit);
      assertTransportObservation(audit, sim.state);
      const regions = sourceRegionShares(audit, new Map([[0, "first"], [1, "second"]]));
      const sum = Object.values(regions).reduce((v, row) => v + row.B, 0);
      expect(sum).toBe(audit.incoming.B);
      if ((regions.first?.B ?? 0) > 0 && (regions.second?.B ?? 0) > 0) mixedDestinations++;
      if (audit.genomeWinnerSourceIndex !== null)
        expect(audit.sources.some((s) => s.sourceIndex === audit.genomeWinnerSourceIndex &&
          s.lotteryWeight > 0)).toBe(true);
    }
    expect(mixedDestinations).toBeGreaterThan(0);
    for (const [ch, sum] of [[CH.B, auditedB], [CH.P, auditedP], [CH.E, auditedE]] as const) {
      const beforeTotal = Array.from({ length: cellCount(before.cfg) }, (_, i) =>
        BigInt(before.cells[ch * cellCount(before.cfg) + i])).reduce((a, b) => a + b, 0n);
      expect(sum).toBe(beforeTotal);
    }
    for (const ch of [CH.A, CH.C, CH.S]) {
      const total = (s: WorldState) => Array.from({ length: cellCount(s.cfg) }, (_, i) =>
        BigInt(s.cells[ch * cellCount(s.cfg) + i])).reduce((a, b) => a + b, 0n);
      expect(total(sim.state)).toBe(total(before));
    }
    expect(() => transportDestinationAudit(before, new Uint32Array(1), 0)).toThrow(/full displacement/);
  });

  it("joins one-step transport and colored copy observations while leaving reaction ownership unavailable", () => {
    const plain = world(), twin = colorLivingSources(plain);
    const asView = (s: WorldState): MeasuredTransportView => ({ cfg: s.cfg, step: s.step,
      cells: s.cells, genomeHead: s.genome.subarray(0, 4 * cellCount(s.cfg)), flux: s.flux });
    const before = asView(plain), beforeColor = asView(twin.state);
    const a = new RefSim(cloneState(plain)), b = new RefSim(cloneState(twin.state));
    a.step(); b.step();
    const after = asView(a.state), afterColor = asView(b.state);
    const current = preflightRoots(a.state);
    expect(current.components.length).toBeGreaterThan(0);
    const evidence = componentMaterialEvidence(before, beforeColor, after, afterColor, 0);
    expect(evidence.genomeCopyValidation).toBe("all-matched");
    expect(evidence.reactionMaterialOwnership).toBe("unavailable-after-mixing");
    const B = Object.values(evidence.incomingByPriorComponent).reduce((sum, row) => sum + BigInt(row.B), 0n);
    expect(B).toBe(BigInt(evidence.incoming.B));
    const tampered = cloneState(b.state), n = cellCount(tampered.cfg);
    const destination = current.components[0].idx;
    const labels = preflightRoots(a.state).components;
    expect(labels[destination]).toBeDefined();
    // Change one still-living color without changing any physical or genotype parameter word.
    const occupied = Array.from({ length: n }, (_, i) => i).find((i) =>
      tampered.cells[CH.B * n + i] + tampered.cells[CH.P * n + i] >= 48)!;
    tampered.genome[G.LIN_LO * n + occupied] = 3;
    expect(() => componentMaterialEvidence(before, beforeColor, after, asView(tampered), 0))
      .toThrow(/lottery\/copy observation mismatch/);
  });

  it("retains a no-winner abiotic bound site as unavailable ancestry rather than a false mismatch", () => {
    const original = allocState(cfg()), n = cellCount(original.cfg);
    for (let i = 0; i < n; i++) original.cells[CH.A * n + i] = 512;
    const before = { cfg: original.cfg, step: 0, cells: original.cells,
      genomeHead: original.genome.subarray(0, 4 * n), flux: original.flux };
    const after = cloneState(original); after.step = 1;
    after.cells[CH.A * n + 4] -= 300;
    after.cells[CH.B * n + 4] = 300;
    const afterView = { cfg: after.cfg, step: after.step, cells: after.cells,
      genomeHead: after.genome.subarray(0, 4 * n), flux: after.flux };
    const record = componentMaterialEvidence(before, before, afterView, afterView, 0);
    expect(record.genomeCopyValidation).toBe("partial-unavailable-no-winner");
    expect(record.noIncomingGenomeWinnerCells).toBe(1);
    expect(record.reactionMaterialOwnership).toBe("unavailable-after-mixing");
  });

  it("local flow matches the reference under adhesion, neutral controller, and changed spread", () => {
    for (const change of [{ adhesion: true, kAdhesion: 18, spread: 0 },
      { neutral: true, spread: 20 }]) {
      const s = world();
      Object.assign(s.cfg, change);
      set(s, CH.P, 0, 50); set(s, CH.P, 1, 30);
      expect(validateState(s)).toEqual([]);
      const sim = new RefSim(cloneState(s));
      const inner = sim as unknown as { affinity(): void; flow(): void; disp: Uint32Array };
      inner.affinity(); inner.flow();
      for (let i = 0; i < cellCount(s.cfg); i++)
        expect(localDisplacement(s, i)).toBe(inner.disp[i]);
    }
  });
});
