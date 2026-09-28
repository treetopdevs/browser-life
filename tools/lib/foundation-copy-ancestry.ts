/** Assay-only ancestry controls. Nothing here changes the simulation rules. */
import {
  CH, G, GENOME_CHANNELS, M3_FOUNDERS, cellCount, cloneState, encodeGenome,
  founderGenome, validateState, type WorldState,
} from "@bl/schema";
import { census, DEFAULT_CENSUS } from "@bl/metrics";
import { emptySerialGarden, prepareSerialStart, serialPlacement, serialSpec,
  type SerialInventory } from "./foundation-serial-transfer.ts";
import { extractCellPacket, genomeOnlyArm, transplantCellPacket, validateCellPacket,
  type CellPacket } from "./foundation-transplant.ts";
import type { SourceIdentity } from "./foundation-replay.ts";
import { genomeHeadOf, validateTransportInput, type TransportInput } from "./foundation-material-flow.ts";

const fail = (message: string): never => { throw new Error(message); };
const id = (hi: number, lo: number) => `${hi}:${lo}`;

export interface PreflightComponent {
  idx: number;
  cells: number;
  mass: number;
  biomass: number;
  lineage: string;
  purity: number;
  eligible: boolean;
  /** Every genome lineage present in the component; a dominant label is not a pure packet. */
  lineages: string[];
}
export interface RootPreflight {
  step: number;
  components: PreflightComponent[];
  eligibleRootIndices: number[];
  singleEligibleRoot: boolean;
  belowThresholdBoundCells: number;
  livingCells: number;
}

/** Use the actual census implementation and thresholds, including subeligible components. */
export function preflightRoots(state: WorldState): RootPreflight {
  const errors = validateState(state);
  if (errors.length) fail(`invalid preflight state: ${errors.join("; ")}`);
  const n = cellCount(state.cfg);
  const head = state.genome.subarray(0, 4 * n);
  const result = census({ cfg: state.cfg, step: state.step, cells: state.cells, genomeHead: head }, DEFAULT_CENSUS);
  const lineages = result.components.map(() => new Set<string>());
  let belowThresholdBoundCells = 0;
  for (let i = 0; i < n; i++) {
    const mass = state.cells[CH.B * n + i] + state.cells[CH.P * n + i];
    if (mass > 0 && result.labels[i] < 0) belowThresholdBoundCells++;
    if (result.labels[i] >= 0)
      lineages[result.labels[i]].add(id(state.genome[G.LIN_HI * n + i], state.genome[G.LIN_LO * n + i]));
  }
  const components = result.components.map((c) => ({ idx: c.idx, cells: c.cells, mass: c.mass,
    biomass: c.biomass, lineage: c.lineage, purity: c.purity,
    eligible: c.mass >= DEFAULT_CENSUS.minMass, lineages: [...lineages[c.idx]].sort() }));
  const eligibleRootIndices = components.filter((c) => c.eligible).map((c) => c.idx);
  return { step: state.step, components, eligibleRootIndices,
    singleEligibleRoot: eligibleRootIndices.length === 1,
    belowThresholdBoundCells, livingCells: result.livingCells };
}

export interface SamePacketArm {
  arm: "donor" | "founder-genotype" | "zero-controller-genotype" | "empty";
  state: WorldState;
  packetSha256: string | null;
  inoculum: CellPacket | null;
  inventory: SerialInventory;
  preflight: RootPreflight;
}

/**
 * Stage-0 controls share the evolved packet's exact physical cells and placement.
 * Founder and zero-controller are genotype interventions, not natural founder morphology.
 */
export function prepareSamePacketControls(source: SourceIdentity, evolved: CellPacket): SamePacketArm[] {
  validateCellPacket(evolved);
  if (evolved.arm !== "intact") fail("same-packet controls require the intact evolved packet");
  const donor = prepareSerialStart(source, 0, "donor", evolved);
  const spec = serialSpec(source, 0);
  const originalId = { hi: evolved.cells[0].genome[G.LIN_HI], lo: evolved.cells[0].genome[G.LIN_LO] };
  const founder = M3_FOUNDERS[9] ?? fail("M3 founder index 9 is unavailable");
  const founderWords = Array.from(encodeGenome(founderGenome(founder), 0, 0));
  const zeroWords = [...founderWords];
  for (let g = G.W0; g < GENOME_CHANNELS; g++) zeroWords[g] = 0;
  const place = serialPlacement(evolved);
  const substitute = (words: number[]) => {
    const packet = genomeOnlyArm(evolved, words);
    const placed = transplantCellPacket(emptySerialGarden(spec), packet, place,
      [{ from: originalId, to: { hi: 0, lo: 1 } }]);
    return { state: placed.state,
      inoculum: extractCellPacket(placed.state, placed.audit.mapping.map((m) => m.destinationIndex)),
      packetSha256: packet.sha256 };
  };
  const f = substitute(founderWords), z = substitute(zeroWords);
  if (donor.state.cells.length !== f.state.cells.length ||
      donor.state.cells.some((word, i) => word !== f.state.cells[i] || word !== z.state.cells[i]))
    fail("same-packet genotype arms differ in physical initial cells");
  const empty = emptySerialGarden(spec);
  const arms: SamePacketArm[] = [
    { arm: "donor", state: donor.state, packetSha256: evolved.sha256, inoculum: donor.inoculum,
      inventory: donor.initialInventory, preflight: preflightRoots(donor.state) },
    { arm: "founder-genotype", state: f.state, packetSha256: f.packetSha256, inoculum: f.inoculum,
      inventory: donor.initialInventory, preflight: preflightRoots(f.state) },
    { arm: "zero-controller-genotype", state: z.state, packetSha256: z.packetSha256, inoculum: z.inoculum,
      inventory: donor.initialInventory, preflight: preflightRoots(z.state) },
    { arm: "empty", state: empty, packetSha256: null, inoculum: null,
      inventory: { A: String(32 * cellCount(empty.cfg)), B: "0", C: "0", P: "0", E: "0", S: "0",
        matter: String(32 * cellCount(empty.cfg)), energy: String(32 * cellCount(empty.cfg) * empty.cfg.eA) },
      preflight: preflightRoots(empty) },
  ];
  return arms;
}

export function assertSamePacketPreflight(arms: readonly SamePacketArm[]): void {
  if (arms.length !== 4 || arms.map((a) => a.arm).join(",") !==
      "donor,founder-genotype,zero-controller-genotype,empty")
    fail("same-packet preflight lacks the four fixed arms");
  if (arms.slice(0, 3).some((arm) => !arm.preflight.singleEligibleRoot))
    fail(`same-packet stage-0 arms lack one eligible root: ${arms.slice(0, 3).map((a) =>
      `${a.arm}=${a.preflight.eligibleRootIndices.length}`).join(", ")}`);
  if (arms[3].preflight.eligibleRootIndices.length) fail("empty garden contains an eligible root");
}

export interface SourceColor { color: string; sourceIndex: number; originalLineage: string }
export interface ColoredTwin { state: WorldState; colors: SourceColor[] }

/** Unique genome-copy colors for every initially living source cell, with no genotype edit. */
export function colorLivingSources(source: WorldState): ColoredTwin {
  if (source.cfg.mutRate !== 0) fail("genome-copy colors require mutation disabled");
  const errors = validateState(source);
  if (errors.length) fail(`invalid source for colors: ${errors.join("; ")}`);
  const state = cloneState(source), n = cellCount(state.cfg);
  const colors: SourceColor[] = [];
  for (let i = 0; i < n; i++) {
    const hi = source.genome[G.LIN_HI * n + i], lo = source.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const colorLo = colors.length + 1;
    if (colorLo >= n) fail("color namespace exhausted by living source cells");
    colors.push({ color: id(0, colorLo), sourceIndex: i, originalLineage: id(hi, lo) });
    state.genome[G.LIN_HI * n + i] = 0;
    state.genome[G.LIN_LO * n + i] = colorLo;
  }
  const twinErrors = validateState(state);
  if (twinErrors.length) fail(`colored twin invalid: ${twinErrors.join("; ")}`);
  assertColorTwinParity(source, state);
  return { state, colors };
}

/** Exact physical/genotype parity; intentionally changed lineage words are masked. */
export function assertColorTwinParity(original: WorldState, colored: WorldState): void {
  if (original.step !== colored.step || JSON.stringify(original.cfg) !== JSON.stringify(colored.cfg))
    fail("color twin step/config mismatch");
  if (original.cells.length !== colored.cells.length || original.genome.length !== colored.genome.length)
    fail("color twin array shape mismatch");
  for (let i = 0; i < original.cells.length; i++)
    if (original.cells[i] !== colored.cells[i]) fail(`color twin physical cell mismatch at ${i}`);
  const n = cellCount(original.cfg);
  for (let g = 2; g < GENOME_CHANNELS; g++) for (let i = 0; i < n; i++)
    if (original.genome[g * n + i] !== colored.genome[g * n + i])
      fail(`color twin non-label genotype mismatch at g=${g}, cell=${i}`);
  for (let i = 0; i < n; i++) {
    const a = original.genome[G.LIN_HI * n + i] | original.genome[G.LIN_LO * n + i];
    const b = colored.genome[G.LIN_HI * n + i] | colored.genome[G.LIN_LO * n + i];
    if (!!a !== !!b) fail(`color twin living-label presence mismatch at ${i}`);
  }
  if (original.lightIn !== colored.lightIn || original.heatOut !== colored.heatOut ||
      original.flux.length !== colored.flux.length || original.flux.some((x, i) => x !== colored.flux[i]))
    fail("color twin ledger/flux mismatch");
}

export interface ColorSnapshot { step: number; cells: Uint32Array; genomeHead: Uint32Array;
  flux: readonly bigint[] }
/** Per-step GPU readback parity for physical cells and the four-word genome head. */
export function assertColorSnapshotParity(original: ColorSnapshot, colored: ColorSnapshot): void {
  if (original.step !== colored.step || original.cells.length !== colored.cells.length ||
      original.genomeHead.length !== colored.genomeHead.length ||
      original.genomeHead.length % 4 !== 0)
    fail("colored snapshot step/shape mismatch");
  for (let i = 0; i < original.cells.length; i++)
    if (original.cells[i] !== colored.cells[i]) fail(`colored snapshot physical mismatch at ${i}`);
  const n = original.genomeHead.length / 4;
  for (let g = 2; g < 4; g++) for (let i = 0; i < n; i++)
    if (original.genomeHead[g * n + i] !== colored.genomeHead[g * n + i])
      fail(`colored snapshot non-label genome head mismatch at g=${g}, cell=${i}`);
  for (let i = 0; i < n; i++) {
    const a = original.genomeHead[G.LIN_HI * n + i] | original.genomeHead[G.LIN_LO * n + i];
    const b = colored.genomeHead[G.LIN_HI * n + i] | colored.genomeHead[G.LIN_LO * n + i];
    if (!!a !== !!b) fail(`colored snapshot living-label mismatch at ${i}`);
  }
  if (original.flux.length !== colored.flux.length ||
      original.flux.some((v, i) => v !== colored.flux[i]))
    fail("colored snapshot reaction flux mismatch");
}

export interface CopyAttribution { status: "known" | "unavailable"; componentIndex: number;
  cells: number; knownCells: number; sourceCells: number[]; reason?: string }
/** Reports genome-copy source cells only. It says nothing about the matter occupying those cells. */
export function componentCopySources(colored: TransportInput, componentIndex: number,
  colors: readonly SourceColor[]): CopyAttribution {
  validateTransportInput(colored);
  const n = cellCount(colored.cfg), genome = genomeHeadOf(colored);
  const censusNow = census({ cfg: colored.cfg, step: colored.step,
    cells: colored.cells, genomeHead: genome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const c = censusNow.components[componentIndex];
  if (!c) fail("unknown component index for copy attribution");
  const byColor = new Map(colors.map((x) => [x.color, x.sourceIndex]));
  const sourceCells: number[] = [];
  let knownCells = 0;
  for (let i = 0; i < n; i++) if (censusNow.labels[i] === componentIndex) {
    const key = id(genome[G.LIN_HI * n + i], genome[G.LIN_LO * n + i]);
    const source = byColor.get(key);
    if (source !== undefined) { knownCells++; sourceCells.push(source); }
  }
  return { status: knownCells === c.cells ? "known" : "unavailable", componentIndex,
    cells: c.cells, knownCells, sourceCells,
    ...(knownCells === c.cells ? {} : { reason: "component includes unlabeled or post-coverage genome copies" }) };
}

export interface ComponentTransition {
  componentIndex: number;
  currentCells: number;
  currentMass: number;
  priorSameSiteComponents: number[];
  priorSameSiteCells: number;
  copySourceCells: number[];
  copyOriginComponents: number[];
  copyOriginStatus: "one-initial-region" | "mixed-initial-regions" | "unavailable";
  unknownCopyCells: number;
}

/** Initial connected-component origin of each colored source site; -1 means subthreshold. */
export function initialCopyRegions(initial: TransportInput): Map<number, number> {
  validateTransportInput(initial);
  const n = cellCount(initial.cfg), c = census({ cfg: initial.cfg, step: initial.step,
    cells: initial.cells, genomeHead: genomeHeadOf(initial).subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const result = new Map<number, number>();
  const genome = genomeHeadOf(initial);
  for (let i = 0; i < n; i++)
    if ((genome[G.LIN_HI * n + i] | genome[G.LIN_LO * n + i]) !== 0)
      result.set(i, c.labels[i]);
  return result;
}

/**
 * Overlap and genome-copy origin are independent observations. A copy linked to
 * an initial component does not establish an immediate organism parent.
 */
export function diagnoseComponentTransitions(prior: TransportInput, currentColored: TransportInput,
  colors: readonly SourceColor[], initialRegions: ReadonlyMap<number, number>): ComponentTransition[] {
  validateTransportInput(prior); validateTransportInput(currentColored);
  if (prior.cfg.tileW !== currentColored.cfg.tileW || prior.cfg.tileH !== currentColored.cfg.tileH ||
      prior.cfg.tilesX !== currentColored.cfg.tilesX || prior.cfg.tilesY !== currentColored.cfg.tilesY ||
      currentColored.step <= prior.step)
    fail("component transition requires ordered snapshots of the same geometry");
  const n = cellCount(prior.cfg);
  const prev = census({ cfg: prior.cfg, step: prior.step, cells: prior.cells,
    genomeHead: genomeHeadOf(prior).subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const currGenome = genomeHeadOf(currentColored);
  const curr = census({ cfg: currentColored.cfg, step: currentColored.step,
    cells: currentColored.cells, genomeHead: currGenome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const sourceByColor = new Map(colors.map((row) => [row.color, row.sourceIndex]));
  if (sourceByColor.size !== colors.length) fail("duplicate source color mapping");
  return curr.components.map((component): ComponentTransition => {
    const overlap = new Set<number>(), copySources = new Set<number>(), origins = new Set<number>();
    let overlapCells = 0, unknown = 0;
    for (let i = 0; i < n; i++) if (curr.labels[i] === component.idx) {
      if (prev.labels[i] >= 0) { overlap.add(prev.labels[i]); overlapCells++; }
      const key = id(currGenome[G.LIN_HI * n + i], currGenome[G.LIN_LO * n + i]);
      const source = sourceByColor.get(key);
      const region = source === undefined ? undefined : initialRegions.get(source);
      if (source !== undefined) copySources.add(source);
      if (region === undefined || region < 0) unknown++;
      else origins.add(region);
    }
    return { componentIndex: component.idx, currentCells: component.cells, currentMass: component.mass,
      priorSameSiteComponents: [...overlap].sort((a, b) => a - b), priorSameSiteCells: overlapCells,
      copySourceCells: [...copySources].sort((a, b) => a - b),
      copyOriginComponents: [...origins].sort((a, b) => a - b),
      copyOriginStatus: unknown ? "unavailable" : origins.size === 1 ?
        "one-initial-region" : "mixed-initial-regions", unknownCopyCells: unknown };
  });
}
