/** Frozen A2 preparation gates. This module does not run a simulation. */
import { createHash } from "node:crypto";
import { G, GENOME_CHANNELS, M3_FOUNDERS, encodeGenome, founderGenome, stateHash,
  type WorldState } from "@bl/schema";
import { sameConfig, specConfig, type RunSpec } from "@bl/runner";
import { preflightRoots } from "./foundation-copy-ancestry.ts";
import { extractCellPacket, genomeOnlyArm, transplantCellPacket, validateCellPacket,
  type CellPacket, type Inventory, type TransplantAudit } from "./foundation-transplant.ts";
import { SERIAL_GARDEN_OVERRIDES, emptySerialGarden, serialInventory, serialPlacement,
  type SerialInventory } from
  "./foundation-serial-transfer.ts";
import type { SourceIdentity } from "./foundation-replay.ts";

export const SERIAL_V2_SEEDS = [640020101, 640020102, 640020103] as const;
export const SERIAL_V2_HORIZON = 3000;
export const SERIAL_V2_STAGE_ARMS = [
  ["donor", "founder-genotype", "zero-controller-genotype", "empty"],
  ["donor", "founder-genotype"],
  ["donor", "founder-genotype"],
] as const;

export interface A1Gate {
  status: "verified";
  planSha256: string;
  resultSha256: string;
  sourcePacketSha256: string;
  sourceInitialStateHash: string;
  sourceRunId: string;
  originalPhysicsHash: string;
  originalArtifactHash: string;
  validatedThroughStep: 250;
  originalObservationsMatched: true;
  copiedGenomeSourceInterpretation: "initial-inoculum-copy-origin-only";
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hex64 = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);

/** Refuses partial/capped/forged A1 output before any A2 source preparation. */
export function validateA1Gate(planBytes: Uint8Array, resultBytes: Uint8Array): A1Gate {
  const plan = JSON.parse(new TextDecoder().decode(planBytes)) as Record<string, any>;
  const result = JSON.parse(new TextDecoder().decode(resultBytes)) as Record<string, any>;
  const planSha256 = sha(planBytes), resultSha256 = sha(resultBytes);
  if (plan.format !== 1 || plan.status !== "planned" ||
      result.format !== 1 || result.status !== "verified" ||
      result.planFile?.sha256 !== planSha256 || result.planFile?.bytes !== planBytes.length ||
      result.overrun !== false || !result.adapter?.vendor ||
      result.parityThroughStep !== 250 || !same(result.fullParitySteps, [25, 50, 75, 100, 125,
        150, 175, 200, 225, 250]) ||
      result.serialTraceMatched !== true || result.terminalPhysicsMatched !== true ||
      result.originalArtifactMatched !== true || result.observationHashesMatched !== true ||
      !same(plan.diagnosticSteps, [175, 200, 225]) || plan.horizon !== 250 ||
      plan.physicsHorizon !== SERIAL_V2_HORIZON ||
      plan.claim !== "selected-debugging-replay-only" ||
      plan.preflight?.status !== "pass" ||
      plan.preflight?.sourceRunId !== "m4/gradient-m3/treatment/seed-1" ||
      !hex64(plan.preflight?.selectedComponent?.packetSha256) ||
      plan.oldDonor?.sourcePacketSha256 !== plan.preflight.selectedComponent.packetSha256 ||
      !plan.oldDonor?.initialStateHash || !plan.oldDonor?.measuredPhysicsHash ||
      !plan.oldDonor?.measuredArtifactHash || !plan.inputs?.source || !plan.inputs?.cache ||
      !plan.inputs?.catalog || !plan.inputs?.rule || !plan.inputs?.priorSerial ||
      !plan.priorSerialFile?.sha256 || !plan.priorSerialPlanFile?.sha256)
    throw new Error("A2 requires complete authenticated A1 natural diagnostic");
  return { status: "verified", planSha256, resultSha256,
    sourcePacketSha256: plan.oldDonor.sourcePacketSha256,
    sourceInitialStateHash: plan.oldDonor.initialStateHash,
    sourceRunId: plan.preflight.sourceRunId,
    originalPhysicsHash: plan.oldDonor.measuredPhysicsHash,
    originalArtifactHash: plan.oldDonor.measuredArtifactHash,
    validatedThroughStep: 250, originalObservationsMatched: true,
    copiedGenomeSourceInterpretation: "initial-inoculum-copy-origin-only" };
}

export interface V2StageStart {
  stage: 0 | 1 | 2;
  rows: { arm: string; seed: number; status: "planned" | "unavailable";
    sourcePacketSha256: string | null; unavailableReason: string | null }[];
}

/** A missing prior packet remains in the denominator and cannot be replaced. */
export function planV2Stage(stage: 0 | 1 | 2, donorPacketSha: string,
  previous?: Record<string, { status: "complete" | "unavailable" | "failed" | "incomplete";
    selectedPacketSha256: string | null }>): V2StageStart {
  if (![0, 1, 2].includes(stage) || !hex64(donorPacketSha) ||
      (stage === 0) === !!previous) throw new Error("invalid A2 stage inputs");
  return { stage, rows: SERIAL_V2_STAGE_ARMS[stage].map((arm) => {
    const prior = stage === 0 ? null : previous?.[arm];
    const packet = stage === 0 ? arm === "empty" ? null : donorPacketSha :
      prior?.status === "complete" && hex64(prior.selectedPacketSha256) ?
        prior.selectedPacketSha256 : null;
    const unavailable = stage > 0 && !packet;
    return { arm, seed: SERIAL_V2_SEEDS[stage], status: unavailable ? "unavailable" : "planned",
      sourcePacketSha256: packet, unavailableReason: unavailable ?
        "prior fixed arm has no authenticated selected packet" : null };
  }) };
}

export type V2Arm = "donor" | "founder-genotype" | "zero-controller-genotype" | "empty";
export interface V2Start {
  arm: V2Arm; stage: 0 | 1 | 2; seed: number; spec: RunSpec; state: WorldState;
  sourcePacket: CellPacket | null; inoculum: CellPacket | null;
  transplantAudit: TransplantAudit | null; initialStateHash: string;
  initialInventory: SerialInventory; eligibleRootsAtStep0: number;
}

/** Conservative packet-local bound; zero is uninformative about actual incorporation. */
export function packetBoundAccounting(incoming: Inventory | null, outgoing: Inventory | null): {
  lowerBound: string | null;
  status: "unavailable-no-packet" | "zero-lower-bound" | "positive-lower-bound";
} {
  if (!incoming || !outgoing) return { lowerBound: null, status: "unavailable-no-packet" };
  const totalInitial = BigInt(incoming.matter);
  const selectedBound = BigInt(outgoing.B) + BigInt(outgoing.P);
  if (totalInitial < 0n || selectedBound < 0n)
    throw new Error("A2 packet inventory cannot contain negative matter");
  const lower = selectedBound > totalInitial ? selectedBound - totalInitial : 0n;
  return { lowerBound: lower.toString(), status: lower === 0n ?
    "zero-lower-bound" : "positive-lower-bound" };
}

export function v2Spec(source: SourceIdentity, stage: 0 | 1 | 2): RunSpec {
  if (source.runId !== "m4/gradient-m3/treatment/seed-1" || ![0, 1, 2].includes(stage))
    throw new Error("A2 only supports frozen source-1 three-stage stream");
  const spec: RunSpec = { experiment: "foundation-serial-transfer-v2", presetId: source.spec.presetId,
    condition: source.spec.condition, seed: SERIAL_V2_SEEDS[stage], steps: SERIAL_V2_HORIZON,
    censusEvery: 25, deepEvery: 40, checkpointEvery: 25, overrides: SERIAL_GARDEN_OVERRIDES };
  if (!sameConfig(specConfig(spec), { ...specConfig(source.spec), seed: spec.seed,
    ...SERIAL_GARDEN_OVERRIDES })) throw new Error("A2 garden config deviates from frozen source");
  return spec;
}

/** Stage 0 uses one identical physical packet for all genotype interventions. */
export function prepareV2Start(source: SourceIdentity, stage: 0 | 1 | 2,
  arm: V2Arm, packet: CellPacket | null): V2Start {
  if (!SERIAL_V2_STAGE_ARMS[stage].some((name) => name === arm))
    throw new Error("A2 arm does not belong to requested stage");
  const spec = v2Spec(source, stage);
  let state: WorldState, placedPacket: CellPacket | null = null;
  let transplantAudit: TransplantAudit | null = null;
  if (arm === "empty") {
    if (packet) throw new Error("A2 empty control cannot carry a packet");
    state = emptySerialGarden(spec);
  } else {
    if (!packet) throw new Error("A2 inoculated arm requires fixed intact source packet");
    validateCellPacket(packet);
    if (packet.arm !== "intact" || packet.cells.length < 1)
      throw new Error("A2 requires a nonempty intact source packet");
    let selected = packet;
    if (stage === 0 && arm !== "donor") {
      const founder = M3_FOUNDERS[9];
      if (!founder) throw new Error("A2 M3 founder 9 missing");
      const words = Array.from(encodeGenome(founderGenome(founder), 0, 0));
      if (arm === "zero-controller-genotype")
        for (let g = G.W0; g < GENOME_CHANNELS; g++) words[g] = 0;
      selected = genomeOnlyArm(packet, words);
    }
    const originalId = { hi: selected.cells[0].genome[G.LIN_HI],
      lo: selected.cells[0].genome[G.LIN_LO] };
    const result = transplantCellPacket(emptySerialGarden(spec), selected, serialPlacement(selected),
      [{ from: originalId, to: { hi: 0, lo: 1 } }]);
    state = result.state; transplantAudit = result.audit;
    placedPacket = extractCellPacket(state, result.audit.mapping.map((row) => row.destinationIndex));
  }
  const roots = preflightRoots(state);
  if ((arm === "empty" && roots.eligibleRootIndices.length !== 0) ||
      (arm !== "empty" && roots.eligibleRootIndices.length !== 1))
    throw new Error(`A2 ${arm} has ${roots.eligibleRootIndices.length} eligible step-0 roots`);
  return { arm, stage, seed: spec.seed, spec, state, sourcePacket: packet,
    inoculum: placedPacket, transplantAudit, initialStateHash: stateHash(state),
    initialInventory: serialInventory(state), eligibleRootsAtStep0: roots.eligibleRootIndices.length };
}
