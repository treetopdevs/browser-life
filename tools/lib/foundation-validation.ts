/** Prespecified nomination, paired execution, and descriptive analysis. No GPU is acquired here. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { binomialLowerBound, passesProbabilityGate } from "@bl/metrics";
import type { EvalConfig, Evaluation } from "@bl/search";
import type { Genome } from "@bl/schema";
import { compareBehaviorTraces, type BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";
import { genomeFromManifest, type EncodedGenome } from "../../packages/search/src/mutation-neighborhood.ts";
import { SCREEN_EVAL, summarizePairedRoles, summarizeTrace, type PairedRoleChange, type ScreenBatchResult,
  type ScreenPlan, type ScreenRow, type TraceSummary } from "./foundation-screen.ts";

export const VALIDATION_SALT = "foundation-mutation-validation-v1";
export const VALIDATION_SEEDS = Array.from({ length: 32 }, (_, i) => 620050001 + i);
export const VALIDATION_CLASSES = ["role-shift-preserved", "changed-preserved", "observed-loss", "observed-unresponsive"] as const;
export type ValidationClass = typeof VALIDATION_CLASSES[number];
export interface ScreenExecutionInput {
  format: string;
  status: string;
  sourcePlan: { sha256: string };
  sourceIdentity: unknown;
  budget: { selectedBatchIndices: number[] };
  results: ScreenBatchResult[];
}
export interface Candidate {
  id: string;
  kind: ValidationClass | "identity-control";
  founderIndex: number;
  candidateIndex: number;
  genome: EncodedGenome;
  parentGenome: EncodedGenome;
  sourceProposalId: string | null;
  /** Every raw proposal in the frozen 7200 plan yielding this genome, including unassayed proposals. */
  originatingProposalIds: string[];
  screenedOriginatingProposalIds: string[];
  classEligibleProposalIds: string[];
  screenBatchIndex: number | null;
  screenSeed: number | null;
  selectionSha256: string | null;
}
export interface NominationCoverage {
  plannedProposals: number;
  screenedProposals: number;
  screenedBatches: number;
  unobservedProposals: number;
  byFounder: { founderIndex: number; screened: number; planned: number;
    classes: { class: ValidationClass; eligibleProposals: number; eligibleDistinctGenotypes: number;
      availableForSelection: boolean; availability: "selected" | "no-eligible-observation" | "already-selected-in-higher-priority-class";
      selectedGenotypeKey: string | null }[] }[];
}
export interface Nomination { candidates: Candidate[]; coverage: NominationCoverage }

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
const fourPass = (e: Evaluation) => e.reps === 1 && e.survived === 1 && e.recovered === 1 && e.regenerated === 1 && e.lightDependent === 1;
const threePass = (e: Evaluation) => e.reps === 1 && e.survived === 1 && e.regenerated === 1 && e.lightDependent === 1;
export function diagnosticClassEligible(row: ScreenRow, kind: ValidationClass): boolean {
  if (row.effectiveChange === 0 || row.parentGenomeKey === row.mutantGenomeKey) return false;
  if (kind === "role-shift-preserved") return fourPass(row.parent) && fourPass(row.mutant) &&
    row.pairedRoleChange.pairedAvailableFrames > 0 && row.pairedRoleChange.framesWithFixedRoleShareDifference > 0;
  if (kind === "changed-preserved") return fourPass(row.parent) && fourPass(row.mutant) &&
    (!same(row.parent, row.mutant) || !same(row.parentTrace, row.mutantTrace));
  if (kind === "observed-loss") return row.parent.survived === 1 && row.mutant.survived === 0 ||
    row.parent.regenerated === 1 && row.mutant.regenerated === 0;
  return same(row.parent, row.mutant) && same(row.parentTrace, row.mutantTrace) &&
    row.pairedRoleChange.framesWithFixedRoleShareDifference === 0;
}

/** Reject conflicting/duplicate batches and require every saved row to retain its original planned assay identity. */
export function collectScreenRows(plan: ScreenPlan, inputs: readonly ScreenExecutionInput[], planSha256: string,
  sourceIdentity: unknown): { rows: ScreenRow[]; batchCount: number } {
  const seenBatches = new Set<number>(), seenProposals = new Set<string>(), rows: ScreenRow[] = [];
  const proposals = new Map(plan.neighborhood.proposals.map((p) => [p.id, p]));
  for (const input of inputs) {
    if (input.format !== "foundation-screen-execution/v1" ||
        !["completed", "bounded-incomplete", "over-budget-incomplete"].includes(input.status) ||
        input.sourcePlan?.sha256 !== planSha256 || !same(input.sourceIdentity, sourceIdentity) ||
        !Array.isArray(input.results) || !Array.isArray(input.budget?.selectedBatchIndices) ||
        input.results.some((batch, i) => batch.index !== input.budget.selectedBatchIndices[i]) ||
        input.results.length > input.budget.selectedBatchIndices.length ||
        input.results.length > 0 && !same(input.results[0].exactParentRepeat,
          { evaluated: true, evaluationIdentical: true, traceIdentical: true }))
      throw new Error("screen report format, status, source plan SHA or code identity mismatch");
    for (const batch of input.results) {
      const planned = plan.batches[batch.index];
      if (!planned || seenBatches.has(batch.index) || batch.seed !== planned.seed ||
          !same(batch.evalConfig, { ...plan.evalTemplate, seed: planned.seed }) ||
          batch.rows?.length !== planned.proposalIds.length)
        throw new Error(`duplicate or conflicting screen batch ${batch.index}`);
      seenBatches.add(batch.index);
      for (let k = 0; k < batch.rows.length; k++) {
        const row = batch.rows[k], proposal = proposals.get(planned.proposalIds[k]);
        if (!proposal || seenProposals.has(row.proposalId) || row.proposalId !== proposal.id ||
            row.candidateIndex !== k || row.seed !== batch.seed || !same(row.tileSlots, [k]) ||
            row.founderIndex !== proposal.founderIndex || row.scale !== proposal.scale ||
            row.rawWhich !== proposal.rawWhich || row.rawDelta !== proposal.rawDelta || row.slot !== proposal.slot ||
            row.effectiveChange !== proposal.effectiveChange || row.unchangedAfterClamp !== proposal.unchangedAfterClamp ||
            row.duplicateOf !== proposal.duplicateOf || row.mutantGenomeKey !== proposal.genome.key ||
            row.parentGenomeKey !== plan.neighborhood.founders[proposal.founderIndex]?.genome.key ||
            row.parent.reps !== 1 || row.mutant.reps !== 1 ||
            row.parentTrace.frames !== 30 || row.mutantTrace.frames !== 30 ||
            row.pairedRoleChange.pairedAvailableFrames > 30)
          throw new Error(`screen proposal identity or outcome conflict at batch ${batch.index}, slot ${k}`);
        seenProposals.add(row.proposalId);
        rows.push(row);
      }
    }
  }
  return { rows, batchCount: seenBatches.size };
}

export function nominate(plan: ScreenPlan, rows: readonly ScreenRow[], batchCount: number): Nomination {
  if (plan.neighborhood.founders.length !== 12 || plan.neighborhood.proposals.length !== 7200 ||
      !same(plan.evalTemplate, SCREEN_EVAL)) throw new Error("validation requires the prespecified 7200-proposal, 12-founder screen plan");
  const proposalOrder = new Map(plan.neighborhood.proposals.map((p, k) => [p.id, k]));
  const candidates: Candidate[] = [];
  const byFounder: NominationCoverage["byFounder"] = [];
  for (const founder of plan.neighborhood.founders) {
    const fromFounder = rows.filter((r) => r.founderIndex === founder.index);
    const selected = new Set<string>();
    const classes: NominationCoverage["byFounder"][number]["classes"] = [];
    for (const kind of VALIDATION_CLASSES) {
      const eligible = fromFounder.filter((r) => diagnosticClassEligible(r, kind));
      const groups = new Map<string, ScreenRow[]>();
      for (const row of eligible) groups.set(row.mutantGenomeKey, [...(groups.get(row.mutantGenomeKey) ?? []), row]);
      const ranked = [...groups.keys()].filter((key) => !selected.has(key)).map((key) => ({ key,
        rank: hash(`${VALIDATION_SALT}\n${founder.index}\n${kind}\n${key}`) }))
        .sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
      const pick = ranked[0];
      classes.push({ class: kind, eligibleProposals: eligible.length, eligibleDistinctGenotypes: groups.size,
        availableForSelection: !!pick, availability: pick ? "selected" : groups.size ?
          "already-selected-in-higher-priority-class" : "no-eligible-observation",
        selectedGenotypeKey: pick?.key ?? null });
      if (!pick) continue;
      selected.add(pick.key);
      const classRows = groups.get(pick.key)!.sort((a, b) => proposalOrder.get(a.proposalId)! - proposalOrder.get(b.proposalId)!);
      const representative = classRows[0], sourceProposal = plan.neighborhood.proposals[proposalOrder.get(representative.proposalId)!];
      const origins = plan.neighborhood.proposals.filter((p) => p.founderIndex === founder.index && p.genome.key === pick.key)
        .map((p) => p.id);
      const screenedOrigins = fromFounder.filter((r) => r.mutantGenomeKey === pick.key)
        .sort((a, b) => proposalOrder.get(a.proposalId)! - proposalOrder.get(b.proposalId)!).map((r) => r.proposalId);
      candidates.push({ id: `f${founder.index}-${kind}`, kind, founderIndex: founder.index,
        candidateIndex: candidates.length, genome: sourceProposal.genome, parentGenome: founder.genome,
        sourceProposalId: representative.proposalId, originatingProposalIds: origins,
        screenedOriginatingProposalIds: screenedOrigins,
        classEligibleProposalIds: classRows.map((r) => r.proposalId),
        screenBatchIndex: plan.batches.find((b) => b.proposalIds.includes(representative.proposalId))!.index,
        screenSeed: representative.seed, selectionSha256: pick.rank });
    }
    byFounder.push({ founderIndex: founder.index, screened: fromFounder.length,
      planned: plan.neighborhood.proposals.filter((p) => p.founderIndex === founder.index).length, classes });
  }
  for (const founder of plan.neighborhood.founders) candidates.push({ id: `f${founder.index}-identity-control`,
    kind: "identity-control", founderIndex: founder.index, candidateIndex: candidates.length,
    genome: founder.genome, parentGenome: founder.genome, sourceProposalId: null,
    originatingProposalIds: [], screenedOriginatingProposalIds: [], classEligibleProposalIds: [],
    screenBatchIndex: null, screenSeed: null, selectionSha256: null });
  if (candidates.length > 60) throw new Error("validation candidates exceed 60 of 64 tiles");
  return { candidates, coverage: { plannedProposals: plan.neighborhood.proposals.length,
    screenedProposals: rows.length, screenedBatches: batchCount,
    unobservedProposals: plan.neighborhood.proposals.length - rows.length, byFounder } };
}

export interface PointwiseDifference {
  step: number; tile: number; boundMass: number; membraneFraction: number | null;
  movementCellsPer100Steps: number | null; parentMovementIntervals: number; mutantMovementIntervals: number;
}
export interface ValidationSeedRow {
  candidateId: string; kind: Candidate["kind"]; founderIndex: number; candidateIndex: number; tileSlots: number[];
  parentGenomeKey: string; mutantGenomeKey: string;
  parent: Evaluation; mutant: Evaluation; parentTrace: TraceSummary; mutantTrace: TraceSummary;
  pairedRoleChange: PairedRoleChange; pointwise: PointwiseDifference[];
  identityControlExact: boolean | null; parentFullTraceSha256: string; mutantFullTraceSha256: string;
}
export interface ValidationSeedResult { seed: number; evalConfig: EvalConfig; rows: ValidationSeedRow[];
  exactParentRepeat: { evaluated: boolean; evaluationIdentical: boolean; traceIdentical: boolean } }
export type ValidationEvaluator = (genomes: Genome[], ec: EvalConfig,
  onSample: (candidateIndex: number, tile: number, sample: BehaviorSample) => void) => Promise<Evaluation[]>;

export async function executeValidationSeed(candidates: readonly Candidate[], seed: number, evaluator: ValidationEvaluator,
  beforeCall: (stage: "parent" | "parent-repeat" | "mutant") => void = () => {}, repeatParent = true): Promise<ValidationSeedResult> {
  if (!VALIDATION_SEEDS.includes(seed) || candidates.length > 60 || candidates.filter((c) => c.kind === "identity-control").length !== 12)
    throw new Error("invalid validation seed or candidate/control count");
  const ec = { ...SCREEN_EVAL, seed };
  const measure = async (genomes: Genome[], stage: "parent" | "parent-repeat" | "mutant") => {
    beforeCall(stage);
    const traces = genomes.map(() => [] as BehaviorSample[]);
    const evals = await evaluator(genomes, ec, (k, tile, sample) => {
      if (!traces[k] || sample.tile !== tile) throw new Error("validation callback candidate/tile mismatch");
      traces[k].push(sample);
    });
    if (evals.length !== genomes.length) throw new Error("validation evaluator returned wrong result count");
    for (let k = 0; k < genomes.length; k++) {
      if (evals[k].reps !== 1 || traces[k].length !== ec.growSteps / ec.censusEvery)
        throw new Error(`validation trace or replicate count incomplete at slot ${k}`);
      for (let j = 0; j < traces[k].length; j++)
        if (traces[k][j].step !== (j + 1) * ec.censusEvery || traces[k][j].tile !== k || traces[k][j].phase !== "growth")
          throw new Error(`validation trace schedule mismatch at slot ${k}, frame ${j}`);
    }
    return { evals, traces };
  };
  const parent = await measure(candidates.map((c) => genomeFromManifest(c.parentGenome)), "parent");
  const repeated = repeatParent ? await measure(candidates.map((c) => genomeFromManifest(c.parentGenome)), "parent-repeat") : null;
  const exactParentRepeat = { evaluated: !!repeated,
    evaluationIdentical: !!repeated && same(parent.evals, repeated.evals),
    traceIdentical: !!repeated && same(parent.traces, repeated.traces) };
  if (repeated && (!exactParentRepeat.evaluationIdentical || !exactParentRepeat.traceIdentical))
    throw new Error("first local validation seed parent repeatability control failed");
  const mutant = await measure(candidates.map((c) => genomeFromManifest(c.genome)), "mutant");
  const rows = candidates.map((c, k): ValidationSeedRow => {
    const controlExact = c.kind === "identity-control" ?
      same(parent.evals[k], mutant.evals[k]) && same(parent.traces[k], mutant.traces[k]) : null;
    if (c.kind === "identity-control" && !controlExact) throw new Error(`identity control ${c.id} differs at seed ${seed}`);
    const comparisons = compareBehaviorTraces(parent.traces[k], mutant.traces[k]);
    if (comparisons.some((x) => !Number.isFinite(x.boundMassDifference) ||
        x.membraneFractionDifference !== null && !Number.isFinite(x.membraneFractionDifference) ||
        x.movementDifference !== null && !Number.isFinite(x.movementDifference)))
      throw new Error(`non-finite pointwise behavior difference at slot ${k}`);
    return { candidateId: c.id, kind: c.kind, founderIndex: c.founderIndex, candidateIndex: k, tileSlots: [k],
      parentGenomeKey: c.parentGenome.key, mutantGenomeKey: c.genome.key,
      parent: parent.evals[k], mutant: mutant.evals[k], parentTrace: summarizeTrace(parent.traces[k]),
      mutantTrace: summarizeTrace(mutant.traces[k]), pairedRoleChange: summarizePairedRoles(parent.traces[k], mutant.traces[k]),
      pointwise: comparisons.map((x, j) => ({ step: x.step, tile: x.tile, boundMass: x.boundMassDifference,
        membraneFraction: x.membraneFractionDifference, movementCellsPer100Steps: x.movementDifference,
        parentMovementIntervals: parent.traces[k][j].movement.observedIntervals,
        mutantMovementIntervals: mutant.traces[k][j].movement.observedIntervals })),
      identityControlExact: controlExact, parentFullTraceSha256: hash(JSON.stringify(parent.traces[k])),
      mutantFullTraceSha256: hash(JSON.stringify(mutant.traces[k])) };
  });
  return { seed, evalConfig: ec, rows, exactParentRepeat };
}

export interface CandidateAnalysis {
  candidateId: string; kind: Candidate["kind"]; observedSeeds: number; inference: null | {
    parentAbsoluteGates: Record<"survived" | "regenerated" | "lightDependent", { successes: number; lower95: number; passes: boolean }>;
    mutantAbsoluteGates: Record<"survived" | "regenerated" | "lightDependent", { successes: number; lower95: number; passes: boolean }>;
    allAbsoluteGatesPass: boolean;
    pairedHarmfulByEndpoint: Record<"survived" | "regenerated" | "lightDependent", { count: number; upper95: number | null }>;
    jointThreeTraitHarm: { count: number; upper95: number | null };
    /** The protocol's <=10 percentage-point viability-loss check refers to survival alone. */
    survivalLossWithinTenPercentagePoints: boolean | null;
  };
  descriptive: { evaluationMeanDifferences: Record<string, number> | null;
    seedsWithFixedRoleShareChange: number; pairedRoleFrames: number; changedRoleFrames: number;
    boundMassPointwiseFrames: number; membranePointwiseAvailableFrames: number; movementPointwiseAvailableFrames: number;
    meanPointwiseBoundMassDifference: number | null; meanPointwiseMembraneDifference: number | null;
    meanPointwiseMovementDifference: number | null };
}
export interface ValidationAnalysis { status: "complete" | "incomplete"; observedSeeds: number[]; missingSeeds: number[];
  candidates: CandidateAnalysis[]; limitations: string[] }

export function analyzeValidation(candidates: readonly Candidate[], results: readonly ValidationSeedResult[]): ValidationAnalysis {
  const bySeed = new Map<number, ValidationSeedResult>();
  for (const result of results) {
    if (!VALIDATION_SEEDS.includes(result.seed) || bySeed.has(result.seed) || !same(result.evalConfig, { ...SCREEN_EVAL, seed: result.seed }) ||
        !Array.isArray(result.rows) || result.rows.length !== candidates.length) throw new Error("duplicate, foreign or incomplete validation seed result");
    for (let k = 0; k < candidates.length; k++) {
      const c = candidates[k], r = result.rows[k];
      if (!r || r.candidateId !== c.id || r.candidateIndex !== k || !same(r.tileSlots, [k]) ||
          r.kind !== c.kind || r.founderIndex !== c.founderIndex ||
          r.parentGenomeKey !== c.parentGenome.key || r.mutantGenomeKey !== c.genome.key ||
          !r.parent || !r.mutant || r.parent.reps !== 1 || r.mutant.reps !== 1 ||
          (["survived", "recovered", "regenerated", "lightDependent"] as const).some((field) =>
            ![0, 1].includes(r.parent[field]) || ![0, 1].includes(r.mutant[field])) ||
          r.parentTrace?.frames !== 30 || r.mutantTrace?.frames !== 30 || !Array.isArray(r.pointwise) || r.pointwise.length !== 30 ||
          r.pointwise.some((p, i) => p.step !== (i + 1) * SCREEN_EVAL.censusEvery || p.tile !== k ||
            !Number.isFinite(p.boundMass) || p.membraneFraction !== null && !Number.isFinite(p.membraneFraction) ||
            p.movementCellsPer100Steps !== null && !Number.isFinite(p.movementCellsPer100Steps) ||
            !Number.isSafeInteger(p.parentMovementIntervals) || p.parentMovementIntervals < 0 ||
            !Number.isSafeInteger(p.mutantMovementIntervals) || p.mutantMovementIntervals < 0) ||
          !/^[a-f0-9]{64}$/.test(r.parentFullTraceSha256) || !/^[a-f0-9]{64}$/.test(r.mutantFullTraceSha256) ||
          !r.pairedRoleChange ||
          !Number.isSafeInteger(r.pairedRoleChange.pairedAvailableFrames) ||
          r.pairedRoleChange.pairedAvailableFrames < 0 || r.pairedRoleChange.pairedAvailableFrames > 30 ||
          !Number.isSafeInteger(r.pairedRoleChange.framesWithFixedRoleShareDifference) ||
          r.pairedRoleChange.framesWithFixedRoleShareDifference < 0 ||
          r.pairedRoleChange.framesWithFixedRoleShareDifference > r.pairedRoleChange.pairedAvailableFrames ||
          c.kind === "identity-control" && (r.identityControlExact !== true || r.parentFullTraceSha256 !== r.mutantFullTraceSha256))
        throw new Error(`validation candidate/control identity mismatch at ${result.seed}, slot ${k}`);
    }
    bySeed.set(result.seed, result);
  }
  const observedSeeds = [...bySeed.keys()].sort((a, b) => a - b), missingSeeds = VALIDATION_SEEDS.filter((s) => !bySeed.has(s));
  const complete = missingSeeds.length === 0;
  const means = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const analyzed = candidates.map((c, k): CandidateAnalysis => {
    const rows = observedSeeds.map((s) => bySeed.get(s)!.rows[k]);
    const fields = ["survived", "recovered", "lightDependent", "individuals", "meanMass", "speed", "mass", "recovery", "reproduction", "regenerated"] as const;
    const evaluationMeanDifferences = rows.length ? Object.fromEntries(fields.map((field) =>
      [field, means(rows.map((r) => r.mutant[field] - r.parent[field]))])) as Record<string, number> : null;
    const pointwise = rows.flatMap((r) => r.pointwise);
    const membranePoints = pointwise.flatMap((p) => p.membraneFraction === null ? [] : [p.membraneFraction]);
    const movementPoints = pointwise.flatMap((p) => p.movementCellsPer100Steps === null ? [] : [p.movementCellsPer100Steps]);
    const descriptive = { evaluationMeanDifferences,
      seedsWithFixedRoleShareChange: rows.filter((r) => r.pairedRoleChange.framesWithFixedRoleShareDifference > 0).length,
      pairedRoleFrames: rows.reduce((n, r) => n + r.pairedRoleChange.pairedAvailableFrames, 0),
      changedRoleFrames: rows.reduce((n, r) => n + r.pairedRoleChange.framesWithFixedRoleShareDifference, 0),
      boundMassPointwiseFrames: pointwise.length, membranePointwiseAvailableFrames: membranePoints.length,
      movementPointwiseAvailableFrames: movementPoints.length,
      meanPointwiseBoundMassDifference: means(pointwise.map((p) => p.boundMass)),
      meanPointwiseMembraneDifference: means(membranePoints),
      meanPointwiseMovementDifference: means(movementPoints) };
    if (!complete) return { candidateId: c.id, kind: c.kind, observedSeeds: rows.length, inference: null, descriptive };
    const gate = (arm: "parent" | "mutant") => Object.fromEntries((["survived", "regenerated", "lightDependent"] as const).map((field) => {
      const successes = rows.reduce((n, r) => n + r[arm][field], 0);
      return [field, { successes, lower95: binomialLowerBound(successes, 32), passes: passesProbabilityGate(successes, 32, 0.8) }];
    })) as Record<"survived" | "regenerated" | "lightDependent", { successes: number; lower95: number; passes: boolean }>;
    const parentAbsoluteGates = gate("parent"), mutantAbsoluteGates = gate("mutant");
    const allAbsoluteGatesPass = [...Object.values(parentAbsoluteGates), ...Object.values(mutantAbsoluteGates)].every((v) => v.passes);
    const pairedHarmfulByEndpoint = Object.fromEntries((["survived", "regenerated", "lightDependent"] as const).map((field) => {
      const count = rows.filter((r) => r.parent[field] === 1 && r.mutant[field] === 0).length;
      return [field, { count, upper95: allAbsoluteGatesPass ? 1 - binomialLowerBound(32 - count, 32) : null }];
    })) as Record<"survived" | "regenerated" | "lightDependent", { count: number; upper95: number | null }>;
    const jointCount = rows.filter((r) => threePass(r.parent) && !threePass(r.mutant)).length;
    const survivalUpper = pairedHarmfulByEndpoint.survived.upper95;
    return { candidateId: c.id, kind: c.kind, observedSeeds: rows.length, descriptive,
      inference: { parentAbsoluteGates, mutantAbsoluteGates, allAbsoluteGatesPass,
        pairedHarmfulByEndpoint,
        jointThreeTraitHarm: { count: jointCount,
          upper95: allAbsoluteGatesPass ? 1 - binomialLowerBound(32 - jointCount, 32) : null },
        survivalLossWithinTenPercentagePoints: survivalUpper === null ? null : survivalUpper <= 0.1 } };
  });
  return { status: complete ? "complete" : "incomplete", observedSeeds, missingSeeds, candidates: analyzed,
    limitations: ["Screen-nominated genotypes are a biased diagnostic sample; no mutation-population frequency is inferred.",
      "The 32 fresh seeds estimate conditional assay behavior for each fixed genotype, not independent evolutionary histories.",
      "Fixed role labels, mass and movement proxies do not establish novel function or an inherited life cycle."] };
}
