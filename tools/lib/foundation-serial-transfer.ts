/** Pure setup and stage bookkeeping for one prospective serial-transfer stream. */
import { CH, G, GENOME_CHANNELS, M3_FOUNDERS, allocState, buildWorld, canonicalConfig, cellCount, cloneState,
  founderGenome, stateHash, totalsOf, validateState, type WorldState } from "@bl/schema";
import { sameConfig, specConfig, type RunSpec } from "@bl/runner";
import { extractCellPacket, transplantCellPacket, validateCellPacket,
  type CellPacket, type ToroidalPlacement, type TransplantAudit } from "./foundation-transplant.ts";
import type { SourceIdentity } from "./foundation-replay.ts";

export const SERIAL_SOURCE_RUN = "m4/gradient-m3/treatment/seed-1";
export const SERIAL_RULE_SHA256 = "bf901c0fb58a41c5f99cb94b2bc21e2252b6840c332ec25dbaf6cccbaf069442";
export const SERIAL_CATALOG_SHA256 = "f2d8b66e507a62ae9e9ef156271cdb5e45f1f2569b747425c2c82e1ce25efeb6";
export const SERIAL_RANK0_COMPONENT = 53;
export const SERIAL_RANK0_KEY = "33b428eef552a04c4a6e9afa4debb48e2fd1e1d3184840c117cb8db56f6e3015";
export const SERIAL_SEEDS = [640_010_001, 640_010_002, 640_010_003] as const;
export const SERIAL_HORIZON = 3_000;
export const SERIAL_CENSUS = 25;
export const SERIAL_GARDEN_OVERRIDES = { mutRate: 0, lightMode: "uniform" as const,
  lightBase: 40, lightAmp: 160, seasonAmp: 0 };
const MOT_NEUTRAL = 128 | (128 << 8);

export type SerialArm = "donor" | "founder" | "zero-controller";
export type SerialStage = 0 | 1 | 2;
export const stageArms = (stage: SerialStage): readonly SerialArm[] =>
  stage === 0 ? ["donor", "founder", "zero-controller"] : ["donor", "founder"];

export function serialSpec(source: SourceIdentity, stage: SerialStage, checkpointEvery: 0 | 25 = 25): RunSpec {
  const seed = SERIAL_SEEDS[stage];
  if (seed === undefined || source.runId !== SERIAL_SOURCE_RUN) throw new Error("invalid serial stage or source");
  const spec: RunSpec = { experiment: "foundation-serial-transfer", presetId: source.spec.presetId,
    condition: source.spec.condition, seed, steps: SERIAL_HORIZON, censusEvery: SERIAL_CENSUS,
    deepEvery: 40, checkpointEvery, overrides: SERIAL_GARDEN_OVERRIDES };
  const expected = { ...specConfig(source.spec), seed, ...SERIAL_GARDEN_OVERRIDES };
  if (!sameConfig(specConfig(spec), expected)) throw new Error("serial garden differs from source plus registered overrides");
  return spec;
}

export function emptySerialGarden(spec: RunSpec): WorldState {
  if (spec.censusEvery !== 25 || specConfig(spec).mutRate !== 0) throw new Error("invalid serial garden spec");
  const state = allocState(specConfig(spec)), n = cellCount(state.cfg);
  state.cells.fill(32, CH.A * n, (CH.A + 1) * n);
  state.cells.fill(MOT_NEUTRAL, CH.MOT * n, (CH.MOT + 1) * n);
  return state;
}

/** Lowest source index anchors at the center, using one toroidal tile. */
export function serialPlacement(packet: CellPacket): ToroidalPlacement {
  validateCellPacket(packet);
  const anchor = packet.cells[0].sourceIndex;
  return { sourceTileX: 0, sourceTileY: 0, destinationTileX: 0, destinationTileY: 0,
    shiftX: 128 - anchor % packet.sourceWorldW,
    shiftY: 128 - Math.floor(anchor / packet.sourceWorldW) };
}

export interface SerialStart {
  state: WorldState; inoculum: CellPacket; sourcePacket: CellPacket | null;
  placement: ToroidalPlacement | null; transplantAudit: TransplantAudit | null;
  initialStateHash: string; initialMatter: string; initialEnergy: string;
  initialInventory: SerialInventory;
}
export interface SerialInventory { A: string; B: string; C: string; P: string; E: string; S: string;
  matter: string; energy: string }
export function serialInventory(state: WorldState): SerialInventory {
  const t = totalsOf(state.cfg, state.cells);
  return { A: String(t.A), B: String(t.B), C: String(t.C), P: String(t.P),
    E: String(t.E), S: String(t.S), matter: String(t.matter), energy: String(t.energy) };
}

/** Lower bound on ambient matter incorporated into bound structure; no biological success criterion. */
export function boundIncorporationAccounting(start: WorldState, final: WorldState,
  inoculum: CellPacket): { initial: SerialInventory; final: SerialInventory;
    incorporatedBoundMatterLowerBound: string } {
  validateCellPacket(inoculum);
  if (start.step !== 0 || final.step !== SERIAL_HORIZON ||
      canonicalConfig(start.cfg) !== canonicalConfig(final.cfg))
    throw new Error("serial incorporation accounting requires matching full-horizon garden states");
  const initial = serialInventory(start), last = serialInventory(final), n = cellCount(start.cfg);
  const packetByIndex = new Map(inoculum.cells.map((row) => [row.sourceIndex, row]));
  for (let i = 0; i < n; i++) {
    const packetRow = packetByIndex.get(i);
    if (packetRow) {
      for (let channel = 0; channel <= CH.MOT; channel++)
        if (start.cells[channel * n + i] !== packetRow.cells[channel])
          throw new Error("serial initial packet cells differ from exact inoculum");
      for (let channel = 0; channel < GENOME_CHANNELS; channel++)
        if (start.genome[channel * n + i] !== packetRow.genome[channel])
          throw new Error("serial initial packet genome differs from exact inoculum");
    } else if (start.cells[CH.A * n + i] !== 32 ||
        [CH.B, CH.C, CH.P, CH.E, CH.S].some((channel) => start.cells[channel * n + i] !== 0))
      throw new Error("serial initial garden has resources outside the inoculum or differs from fixed ambient A");
  }
  for (const channel of ["B", "C", "P", "E", "S"] as const)
    if (initial[channel] !== inoculum.inventory[channel])
      throw new Error(`serial initial ${channel} includes matter outside the inoculum`);
  if (BigInt(initial.A) - BigInt(inoculum.inventory.A) !== 32n * BigInt(n - inoculum.cells.length))
    throw new Error("serial initial ambient nutrient differs from the fixed bare garden");
  if (initial.matter !== last.matter)
    throw new Error("serial matter changed before lower-bound accounting");
  const growth = BigInt(last.B) + BigInt(last.P) - BigInt(inoculum.inventory.matter);
  return { initial, final: last,
    incorporatedBoundMatterLowerBound: String(growth > 0n ? growth : 0n) };
}
const finalStart = (state: WorldState, inoculum: CellPacket, sourcePacket: CellPacket | null,
  placement: ToroidalPlacement | null, transplantAudit: TransplantAudit | null): SerialStart => {
  const inventory = serialInventory(state);
  return { state, inoculum, sourcePacket, placement, transplantAudit,
    initialStateHash: stateHash(state), initialMatter: inventory.matter, initialEnergy: inventory.energy,
    initialInventory: inventory };
};
const boundIndices = (state: WorldState): number[] => {
  const n = cellCount(state.cfg), indices: number[] = [];
  for (let i = 0; i < n; i++) if (state.cells[CH.B * n + i] + state.cells[CH.P * n + i] > 0) indices.push(i);
  return indices;
};

export function prepareSerialStart(source: SourceIdentity, stage: SerialStage, arm: SerialArm,
  packet: CellPacket | null): SerialStart {
  const spec = serialSpec(source, stage);
  if (arm === "zero-controller" && stage !== 0) throw new Error("zero-controller exists only at cycle 0");
  if (arm === "donor" || stage > 0) {
    if (!packet) throw new Error(`missing selected packet for ${arm} cycle ${stage}`);
    validateCellPacket(packet);
    if (packet.arm !== "intact") throw new Error("serial transfer requires intact selected material");
    const placement = serialPlacement(packet);
    const originalId = { hi: packet.cells[0].genome[G.LIN_HI], lo: packet.cells[0].genome[G.LIN_LO] };
    const placed = transplantCellPacket(emptySerialGarden(spec), packet, placement,
      [{ from: originalId, to: { hi: 0, lo: 1 } }]);
    const inoculum = extractCellPacket(placed.state, placed.audit.mapping.map((m) => m.destinationIndex));
    return finalStart(placed.state, inoculum, packet, placement, placed.audit);
  }
  const founder = M3_FOUNDERS[9];
  if (!founder) throw new Error("M3 founder index 9 is missing");
  const state = buildWorld(specConfig(spec), { nutrient: 32, founders: [{ x: 128, y: 128,
    radius: Math.floor(64 / 6), genome: founderGenome(founder), biomass: 64, energy: 128 }] });
  if (arm === "zero-controller") {
    const zero = cloneState(state), n = cellCount(state.cfg);
    for (let g = G.W0; g < GENOME_CHANNELS; g++) zero.genome.fill(0, g * n, (g + 1) * n);
    const errs = validateState(zero);
    if (errs.length) throw new Error(`zero-controller initial state invalid: ${errs.join("; ")}`);
    return finalStart(zero, extractCellPacket(zero, boundIndices(zero)), null, null, null);
  }
  return finalStart(state, extractCellPacket(state, boundIndices(state)), null, null, null);
}
