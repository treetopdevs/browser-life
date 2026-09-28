// Pure planning and injectable batch executor for an exploratory M3 mutation
// screen. No screen is launched by importing this module.
import { DEFAULT_EVAL, quality, type EvalConfig, type Evaluation } from "@bl/search";
import type { Genome } from "@bl/schema";
import { ROLES, type Role } from "@bl/metrics";
import { MUTATION_SCALES, genomeFromManifest, type MutationNeighborhood, type MutationProposal } from "../../packages/search/src/mutation-neighborhood.ts";
import type { BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";

export const SCREEN_SEED_START = 620001001;
export const VALIDATION_SEED_START = 620050001;
/** Low-replicate screening uses full evaluator durations. Validation is separate. */
export const SCREEN_EVAL: EvalConfig = { ...DEFAULT_EVAL, reps: 1 };

export interface ScreenBatch { index: number; seed: number; proposalIds: string[] }
export interface ScreenCoverage {
  proposals: number;
  byStratum: {
    founderIndex: number; scale: number; drawn: number; effective: number; unchangedAfterClamp: number;
    duplicateResults: number; coveredLoci: number;
    loci: { slot: number; drawn: number; effective: number; duplicateResults: number }[];
  }[];
}
export interface ScreenPlan {
  schema: "foundation-screen-plan/v1";
  purpose: "exploratory low-replicate screening, not validation or an M4 probability gate";
  neighborhood: MutationNeighborhood;
  evalTemplate: EvalConfig;
  batchCapacity: number;
  batches: ScreenBatch[];
  coverage: ScreenCoverage;
  seeds: { screen: [number, number]; validationReservedUnused: [number, number] };
}

/** Fixed order: sample round, founder, then scale. No outcome-based filtering. */
export function buildScreenPlan(neighborhood: MutationNeighborhood, firstSeed = SCREEN_SEED_START): ScreenPlan {
  if (!Number.isSafeInteger(firstSeed) || firstSeed < SCREEN_SEED_START || firstSeed >= VALIDATION_SEED_START)
    throw new Error("screen seed outside reserved screening range");
  const capacity = Math.floor(SCREEN_EVAL.side ** 2 / SCREEN_EVAL.reps);
  const ordered = [...neighborhood.proposals].sort((a, b) =>
    a.sampleIndex - b.sampleIndex || a.founderIndex - b.founderIndex || a.scale - b.scale);
  const batches: ScreenBatch[] = [];
  for (let at = 0; at < ordered.length; at += capacity) {
    const index = batches.length, seed = firstSeed + index;
    if (seed >= VALIDATION_SEED_START) throw new Error("screen batches intrude into validation seed reservation");
    batches.push({ index, seed, proposalIds: ordered.slice(at, at + capacity).map((p) => p.id) });
  }
  const byStratum = [] as ScreenCoverage["byStratum"];
  for (const f of neighborhood.founders) for (const scale of MUTATION_SCALES) {
    const rows = neighborhood.proposals.filter((p) => p.founderIndex === f.index && p.scale === scale);
    const slots = [...new Set(rows.map((p) => p.slot))].sort((a, b) => a - b);
    byStratum.push({ founderIndex: f.index, scale, drawn: rows.length,
      effective: rows.filter((p) => p.effectiveChange !== 0).length,
      unchangedAfterClamp: rows.filter((p) => p.unchangedAfterClamp).length,
      duplicateResults: rows.filter((p) => p.duplicateOf !== null).length,
      coveredLoci: slots.length,
      loci: slots.map((slot) => {
        const at = rows.filter((p) => p.slot === slot);
        return { slot, drawn: at.length, effective: at.filter((p) => p.effectiveChange !== 0).length,
          duplicateResults: at.filter((p) => p.duplicateOf !== null).length };
      }),
    });
  }
  return { schema: "foundation-screen-plan/v1", purpose: "exploratory low-replicate screening, not validation or an M4 probability gate",
    neighborhood, evalTemplate: SCREEN_EVAL, batchCapacity: capacity, batches,
    coverage: { proposals: ordered.length, byStratum },
    seeds: { screen: [firstSeed, firstSeed + batches.length - 1], validationReservedUnused: [VALIDATION_SEED_START, 620090000] } };
}

export function batchProposals(plan: ScreenPlan, batch: ScreenBatch): MutationProposal[] {
  const byId = new Map(plan.neighborhood.proposals.map((p) => [p.id, p]));
  const rows = batch.proposalIds.map((id) => byId.get(id));
  if (rows.some((p) => !p)) throw new Error("batch references a missing proposal");
  return rows as MutationProposal[];
}

/** Exact assay identity: genotype, seed, candidate tile slots, config and trace mode. */
export function screenCacheKey(genomeKey: string, seed: number, index: number, ec: EvalConfig): string {
  const tiles = Array.from({ length: ec.reps }, (_, r) => index * ec.reps + r);
  return JSON.stringify({ genomeKey, seed, tiles, ec: { ...ec, seed }, trace: "growth-census-v1" });
}

export interface TraceSummary {
  frames: number;
  livingCellObservations: number;
  roleAvailableFrames: number;
  roleAvailabilityFrames: Record<BehaviorSample["roles"]["availability"], number>;
  roleDenominatorCells: number;
  /** Sum over frames with an actual role buffer; null if none were measured. */
  zeroFluxLineageCells: number | null;
  zeroFluxObservedFrames: number;
  zeroFluxMissingFrames: number;
  /** Fixed-role shares weighted by living-cell observations with role evidence. */
  meanFixedRoleShares: Record<Role, number> | null;
  meanEffectiveRoleDiversity: number | null;
  meanBoundMassPerFrame: number | null;
  meanMembraneFractionAvailableFrames: number | null;
  membraneAvailableFrames: number;
  movementObservedIntervals: number;
  meanMovementPerObservedInterval: number | null;
}

export function summarizeTrace(samples: readonly BehaviorSample[]): TraceSummary {
  const unavailable = { available: 0, "no-living-cells": 0, "no-catalytic-activity": 0, "missing-role-buffer": 0 };
  const roleCellTotals = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  let living = 0, roleCells = 0, zeroFlux = 0, zeroFluxN = 0, diversitySum = 0, mass = 0, membrane = 0, membraneN = 0, movementN = 0, movementSum = 0;
  for (const s of samples) {
    unavailable[s.roles.availability]++;
    living += s.livingCells;
    mass += s.boundMass;
    if (s.roles.zeroFluxLineageCells !== null) {
      if (!Number.isFinite(s.roles.zeroFluxLineageCells) || s.roles.zeroFluxLineageCells < 0)
        throw new Error("invalid zero-flux lineage cell count");
      zeroFlux += s.roles.zeroFluxLineageCells;
      zeroFluxN++;
    }
    if (s.roles.availability === "available") {
      if (!s.roles.shares || !(s.roles.denominatorLivingCells > 0) ||
          s.roles.effectiveDiversity === null || !Number.isFinite(s.roles.effectiveDiversity) ||
          ROLES.some((r) => !Number.isFinite(s.roles.shares![r])))
        throw new Error("available role frame has missing or non-finite role evidence");
      roleCells += s.roles.denominatorLivingCells;
      for (const r of ROLES) roleCellTotals[r] += s.roles.shares[r] * s.roles.denominatorLivingCells;
      diversitySum += s.roles.effectiveDiversity;
    }
    if (s.membraneFraction !== null) { membrane += s.membraneFraction; membraneN++; }
    if (s.movement.meanCellsPer100Steps !== null) {
      movementN += s.movement.observedIntervals;
      movementSum += s.movement.meanCellsPer100Steps * s.movement.observedIntervals;
    }
  }
  return { frames: samples.length, livingCellObservations: living,
    roleAvailableFrames: unavailable.available, roleAvailabilityFrames: unavailable,
    roleDenominatorCells: roleCells, zeroFluxLineageCells: zeroFluxN ? zeroFlux : null,
    zeroFluxObservedFrames: zeroFluxN, zeroFluxMissingFrames: samples.length - zeroFluxN,
    meanFixedRoleShares: roleCells ? Object.fromEntries(ROLES.map((r) => [r, roleCellTotals[r] / roleCells])) as Record<Role, number> : null,
    meanEffectiveRoleDiversity: unavailable.available ? diversitySum / unavailable.available : null,
    meanBoundMassPerFrame: samples.length ? mass / samples.length : null,
    meanMembraneFractionAvailableFrames: membraneN ? membrane / membraneN : null,
    membraneAvailableFrames: membraneN, movementObservedIntervals: movementN,
    meanMovementPerObservedInterval: movementN ? movementSum / movementN : null };
}

export interface PairedRoleChange {
  availability: "available" | "unavailable";
  parentAvailableFrames: number;
  mutantAvailableFrames: number;
  /** Matched step/tile frames where both arms have usable role evidence. */
  pairedAvailableFrames: number;
  parentLivingCellsInPairedFrames: number;
  mutantLivingCellsInPairedFrames: number;
  /** Mean per matched frame, mutant minus parent, in the existing fixed four roles. */
  meanFixedRoleShareDifferences: Record<Role, number> | null;
  /** A mean can cancel transient changes; these preserve their presence and largest size. */
  framesWithFixedRoleShareDifference: number;
  maxFixedRoleShareDistance: number | null;
  meanEffectiveRoleDiversityDifference: number | null;
}

export function summarizePairedRoles(parent: readonly BehaviorSample[], mutant: readonly BehaviorSample[]): PairedRoleChange {
  if (parent.length !== mutant.length) throw new Error("paired traces have different lengths");
  const totals = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  let parentAvailable = 0, mutantAvailable = 0, paired = 0, parentCells = 0, mutantCells = 0,
    diversityDifference = 0, changedFrames = 0, maxRoleDistance = 0;
  for (let i = 0; i < parent.length; i++) {
    const a = parent[i], b = mutant[i];
    if (a.step !== b.step || a.tile !== b.tile || a.phase !== b.phase)
      throw new Error(`paired role trace schedule differs at frame ${i}`);
    const pa = a.roles.availability === "available", ma = b.roles.availability === "available";
    if (pa) parentAvailable++;
    if (ma) mutantAvailable++;
    if (!pa || !ma) continue;
    if (!a.roles.shares || !b.roles.shares || a.roles.effectiveDiversity === null || b.roles.effectiveDiversity === null ||
        !Number.isFinite(a.roles.effectiveDiversity) || !Number.isFinite(b.roles.effectiveDiversity) ||
        !(a.roles.denominatorLivingCells > 0) || !(b.roles.denominatorLivingCells > 0) ||
        ROLES.some((r) => !Number.isFinite(a.roles.shares![r]) || !Number.isFinite(b.roles.shares![r])))
      throw new Error("paired available role frame has missing or non-finite evidence");
    paired++;
    parentCells += a.roles.denominatorLivingCells;
    mutantCells += b.roles.denominatorLivingCells;
    diversityDifference += b.roles.effectiveDiversity - a.roles.effectiveDiversity;
    let frameDistance = 0;
    for (const r of ROLES) {
      const difference = b.roles.shares[r] - a.roles.shares[r];
      totals[r] += difference;
      frameDistance += Math.abs(difference);
    }
    // Half the L1 distance is total variation for complete role shares.
    frameDistance /= 2;
    if (frameDistance > 1e-12) changedFrames++;
    maxRoleDistance = Math.max(maxRoleDistance, frameDistance);
  }
  return { availability: paired ? "available" : "unavailable", parentAvailableFrames: parentAvailable,
    mutantAvailableFrames: mutantAvailable, pairedAvailableFrames: paired,
    parentLivingCellsInPairedFrames: parentCells, mutantLivingCellsInPairedFrames: mutantCells,
    meanFixedRoleShareDifferences: paired ? Object.fromEntries(ROLES.map((r) => [r, totals[r] / paired])) as Record<Role, number> : null,
    framesWithFixedRoleShareDifference: changedFrames, maxFixedRoleShareDistance: paired ? maxRoleDistance : null,
    meanEffectiveRoleDiversityDifference: paired ? diversityDifference / paired : null };
}

export type ScreenEvaluator = (genomes: Genome[], ec: EvalConfig,
  onSample: (candidateIndex: number, tile: number, sample: BehaviorSample) => void) => Promise<Evaluation[]>;
export type BeforeEvaluatorCall = (stage: "parent" | "parent-repeat" | "mutant") => void;

export interface ScreenRow {
  proposalId: string;
  founderIndex: number;
  scale: number;
  rawWhich: number;
  rawDelta: number;
  slot: number;
  effectiveChange: number;
  unchangedAfterClamp: boolean;
  duplicateOf: string | null;
  seed: number;
  candidateIndex: number;
  tileSlots: number[];
  parentGenomeKey: string;
  mutantGenomeKey: string;
  parent: Evaluation;
  mutant: Evaluation;
  qualityDifference: number;
  parentTrace: TraceSummary;
  mutantTrace: TraceSummary;
  pairedRoleChange: PairedRoleChange;
  cache: "exact-parent-hit" | "none";
}
export interface ScreenBatchResult {
  index: number; seed: number; evalConfig: EvalConfig; rows: ScreenRow[];
  exactParentRepeat: { evaluated: boolean; evaluationIdentical: boolean; traceIdentical: boolean };
  cacheHits: number;
}

export function screenCompletionStatus(completedBatches: number, plannedBatches: number, batchStart: number,
  elapsedSeconds: number, maxSeconds: number): "completed" | "bounded-incomplete" | "over-budget-incomplete" {
  if (elapsedSeconds > maxSeconds) return "over-budget-incomplete";
  return batchStart === 0 && completedBatches === plannedBatches ? "completed" : "bounded-incomplete";
}

/** Two position-matched batch calls; repeat the parent on the first batch of each execution chunk. */
export async function executeScreenBatch(plan: ScreenPlan, batch: ScreenBatch, evaluator: ScreenEvaluator,
  beforeCall: BeforeEvaluatorCall = () => {}, repeatParent = true): Promise<ScreenBatchResult> {
  const proposals = batchProposals(plan, batch);
  const ec = { ...plan.evalTemplate, seed: batch.seed };
  const parents = proposals.map((p) => genomeFromManifest(plan.neighborhood.founders[p.founderIndex].genome));
  const mutants = proposals.map((p) => genomeFromManifest(p.genome));
  const measure = async (genomes: Genome[], stage: "parent" | "parent-repeat" | "mutant") => {
    beforeCall(stage);
    const traces = genomes.map(() => [] as BehaviorSample[]);
    const evals = await evaluator(genomes, ec, (k, _tile, sample) => {
      if (!traces[k]) throw new Error("evaluator returned an out-of-range candidate index");
      traces[k].push(sample);
    });
    if (evals.length !== genomes.length) throw new Error("evaluator returned wrong result count");
    const steps = Array.from({ length: Math.ceil(ec.growSteps / ec.censusEvery) }, (_, i) =>
      Math.min(ec.growSteps, (i + 1) * ec.censusEvery));
    for (let k = 0; k < genomes.length; k++) {
      if (evals[k].reps !== ec.reps || traces[k].length !== steps.length * ec.reps)
        throw new Error(`evaluator returned incomplete trace or replicate count at index ${k}`);
      for (let j = 0; j < traces[k].length; j++) {
        const expectedStep = steps[Math.floor(j / ec.reps)], expectedTile = k * ec.reps + j % ec.reps;
        if (traces[k][j].step !== expectedStep || traces[k][j].tile !== expectedTile || traces[k][j].phase !== "growth")
          throw new Error(`evaluator changed matched trace schedule at index ${k}, frame ${j}`);
      }
    }
    return { evals, traces };
  };
  const parent = await measure(parents, "parent");
  let repeat = { evaluated: false, evaluationIdentical: false, traceIdentical: false };
  if (repeatParent) {
    const again = await measure(parents, "parent-repeat");
    repeat = { evaluated: true,
      evaluationIdentical: JSON.stringify(parent.evals) === JSON.stringify(again.evals),
      traceIdentical: JSON.stringify(parent.traces) === JSON.stringify(again.traces) };
    if (!repeat.evaluationIdentical || !repeat.traceIdentical) throw new Error("first local batch exact-parent repeatability control failed");
  }
  // A cache entry is valid only at the same tile index, seed, config and genotype.
  const cache = new Map<string, { eval: Evaluation; trace: BehaviorSample[] }>();
  proposals.forEach((p, k) => cache.set(screenCacheKey(plan.neighborhood.founders[p.founderIndex].genome.key, batch.seed, k, ec),
    { eval: parent.evals[k], trace: parent.traces[k] }));
  const keys = proposals.map((p, k) => screenCacheKey(p.genome.key, batch.seed, k, ec));
  const allCached = keys.every((key) => cache.has(key));
  const mutant = allCached ? null : await measure(mutants, "mutant");
  let cacheHits = 0;
  const rows = proposals.map((p, k): ScreenRow => {
    const hit = cache.get(keys[k]);
    if (hit) cacheHits++;
    if (hit && mutant && (JSON.stringify(hit.eval) !== JSON.stringify(mutant.evals[k]) ||
      JSON.stringify(hit.trace) !== JSON.stringify(mutant.traces[k])))
      throw new Error(`exact assay cache disagrees with mutant batch at ${p.id}`);
    const m = hit ?? { eval: mutant!.evals[k], trace: mutant!.traces[k] };
    const slots = Array.from({ length: ec.reps }, (_, r) => k * ec.reps + r);
    return { proposalId: p.id, founderIndex: p.founderIndex, scale: p.scale,
      rawWhich: p.rawWhich, rawDelta: p.rawDelta, slot: p.slot,
      effectiveChange: p.effectiveChange, unchangedAfterClamp: p.unchangedAfterClamp, duplicateOf: p.duplicateOf,
      seed: batch.seed, candidateIndex: k, tileSlots: slots,
      parentGenomeKey: plan.neighborhood.founders[p.founderIndex].genome.key, mutantGenomeKey: p.genome.key,
      parent: parent.evals[k], mutant: m.eval, qualityDifference: quality(m.eval) - quality(parent.evals[k]),
      parentTrace: summarizeTrace(parent.traces[k]), mutantTrace: summarizeTrace(m.trace),
      pairedRoleChange: summarizePairedRoles(parent.traces[k], m.trace), cache: hit ? "exact-parent-hit" : "none" };
  });
  return { index: batch.index, seed: batch.seed, evalConfig: ec, rows, exactParentRepeat: repeat, cacheHits };
}
