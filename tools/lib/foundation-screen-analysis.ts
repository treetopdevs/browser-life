/** Descriptive analysis of a complete, identity-checked exploratory screen. No simulation. */
import { isDeepStrictEqual } from "node:util";
import type { Evaluation } from "@bl/search";
import { ROLES } from "@bl/metrics";
import { collectScreenRows, type ScreenExecutionInput } from "./foundation-validation.ts";
import { SCREEN_EVAL, type ScreenPlan, type ScreenRow, type TraceSummary } from "./foundation-screen.ts";

const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
export const SCREEN_BATCHES = 113;
export const SCREEN_PROPOSALS = 7200;
export const ENDPOINTS = ["survived", "recovered", "regenerated", "lightDependent"] as const;
export type Endpoint = typeof ENDPOINTS[number];

export interface CompleteScreenInput extends ScreenExecutionInput {
  budget: { batchStart: number; maxBatches: number; selectedBatchIndices: number[] };
  execution: { completedBatches: number; completedProposals: number;
    incompleteBatch: unknown | null; error: string | null };
}

const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const finiteOrNull = (n: number | null) => n === null || typeof n === "number" && Number.isFinite(n);
function validTrace(t: TraceSummary): boolean {
  if (!t || t.frames !== 30 || !count(t.livingCellObservations) || !count(t.roleAvailableFrames) ||
      !count(t.roleDenominatorCells) || !count(t.zeroFluxObservedFrames) ||
      !count(t.zeroFluxMissingFrames) || !count(t.membraneAvailableFrames) ||
      !count(t.movementObservedIntervals) ||
      t.zeroFluxObservedFrames + t.zeroFluxMissingFrames !== 30 ||
      t.membraneAvailableFrames > 30 ||
      !finiteOrNull(t.zeroFluxLineageCells) || !finiteOrNull(t.meanEffectiveRoleDiversity) ||
      !finiteOrNull(t.meanBoundMassPerFrame) || !finiteOrNull(t.meanMembraneFractionAvailableFrames) ||
      !finiteOrNull(t.meanMovementPerObservedInterval)) return false;
  const availability = t.roleAvailabilityFrames;
  if (!availability || ["available", "no-living-cells", "no-catalytic-activity", "missing-role-buffer"]
    .some((key) => !count(availability[key as keyof typeof availability])) ||
      Object.values(availability).reduce((n, v) => n + v, 0) !== 30 ||
      availability.available !== t.roleAvailableFrames ||
      (t.meanFixedRoleShares === null) !== (t.roleAvailableFrames === 0) ||
      t.meanFixedRoleShares !== null && ROLES.some((role) => !Number.isFinite(t.meanFixedRoleShares![role])))
    return false;
  return true;
}

/** Every supplied chunk must have finished its own declared contiguous slice. */
export function collectCompleteScreen(plan: ScreenPlan, inputs: readonly CompleteScreenInput[], planSha256: string,
  sourceIdentity: unknown): ScreenRow[] {
  if (plan.neighborhood.founders.length !== 12 || plan.neighborhood.proposals.length !== SCREEN_PROPOSALS ||
      plan.batches.length !== SCREEN_BATCHES || plan.batchCapacity !== 64 ||
      !same(plan.evalTemplate, SCREEN_EVAL) || plan.neighborhood.samplesPerFounderPerScale !== 200)
    throw new Error("source is not the fixed 12-founder, 7200-proposal screen");
  for (const input of inputs) {
    const budget = input.budget;
    if (!budget || !Number.isSafeInteger(budget.batchStart) || !Number.isSafeInteger(budget.maxBatches) ||
        budget.maxBatches < 1 || budget.maxBatches > 8 ||
        !same(budget.selectedBatchIndices, plan.batches.slice(budget.batchStart,
          budget.batchStart + budget.maxBatches).map((b) => b.index)) ||
        budget.selectedBatchIndices.length !== budget.maxBatches ||
        input.results?.length !== budget.maxBatches ||
        !["completed", "bounded-incomplete"].includes(input.status) ||
        input.execution?.completedBatches !== input.results.length ||
        input.execution?.completedProposals !== input.results.reduce((n, b) => n + b.rows.length, 0) ||
        input.execution?.incompleteBatch !== null || input.execution?.error !== null ||
        input.results.some((b) => b.exactParentRepeat.evaluated &&
          (!b.exactParentRepeat.evaluationIdentical || !b.exactParentRepeat.traceIdentical)))
      throw new Error("screen chunk is not a fully completed contiguous bounded invocation");
  }
  const collected = collectScreenRows(plan, inputs, planSha256, sourceIdentity);
  if (collected.batchCount !== SCREEN_BATCHES || collected.rows.length !== SCREEN_PROPOSALS)
    throw new Error(`incomplete screen: ${collected.batchCount}/${SCREEN_BATCHES} batches, ${collected.rows.length}/${SCREEN_PROPOSALS} proposals`);
  const allIds = new Set(plan.neighborhood.proposals.map((p) => p.id));
  for (const row of collected.rows) {
    allIds.delete(row.proposalId);
    for (const side of [row.parent, row.mutant]) {
      if (side.reps !== 1 || ENDPOINTS.some((key) => side[key] !== 0 && side[key] !== 1))
        throw new Error(`invalid binary endpoint in ${row.proposalId}`);
    }
    const role = row.pairedRoleChange;
    if (!validTrace(row.parentTrace) || !validTrace(row.mutantTrace) ||
        !role || !count(role.parentAvailableFrames) || !count(role.mutantAvailableFrames) ||
        !count(role.parentLivingCellsInPairedFrames) || !count(role.mutantLivingCellsInPairedFrames) ||
        !count(role.pairedAvailableFrames) || !count(role.framesWithFixedRoleShareDifference) ||
        role.pairedAvailableFrames < 0 || role.pairedAvailableFrames > 30 ||
        role.framesWithFixedRoleShareDifference > role.pairedAvailableFrames ||
        role.parentAvailableFrames !== row.parentTrace.roleAvailableFrames ||
        role.mutantAvailableFrames !== row.mutantTrace.roleAvailableFrames ||
        role.pairedAvailableFrames > Math.min(role.parentAvailableFrames, role.mutantAvailableFrames) ||
        role.availability !== (role.pairedAvailableFrames ? "available" : "unavailable") ||
        !finiteOrNull(role.maxFixedRoleShareDistance) ||
        !finiteOrNull(role.meanEffectiveRoleDiversityDifference) ||
        (role.meanFixedRoleShareDifferences === null) !== (role.pairedAvailableFrames === 0) ||
        role.meanFixedRoleShareDifferences !== null &&
          ROLES.some((fixedRole) => !Number.isFinite(role.meanFixedRoleShareDifferences![fixedRole])))
      throw new Error(`invalid behavior frame denominator in ${row.proposalId}`);
  }
  if (allIds.size) throw new Error("screen proposal set is incomplete");
  return collected.rows;
}

export interface EndpointCounts { parentPass: number; mutantPass: number; bothPass: number;
  pairedLoss: number; pairedGain: number; bothFail: number }
export interface ScreenStratumSummary {
  founderIndex: number | null; scale: number | null;
  rawProposals: number; uniqueMutantGenotypes: number; uniqueEffectiveMutantGenotypes: number;
  unchangedAfterClamp: number; duplicateResults: number; exactParentCacheHits: number;
  endpoints: Record<Endpoint, EndpointCounts>;
  anyEvaluationDifference: number; anyTraceSummaryDifference: number;
  pairedRoleAvailableFrames: number; pairedRoleChangedFrames: number;
  roleChangedProposalAssays: number; roleUnavailableProposalAssays: number;
}
export interface ScreenAnalysis { status: "complete"; overall: ScreenStratumSummary;
  byFounder: ScreenStratumSummary[]; byScale: ScreenStratumSummary[];
  byFounderScale: ScreenStratumSummary[];
  limitations: string[] }

export function summarizeScreenStratum(rows: readonly ScreenRow[], founderIndex: number | null,
  scale: number | null): ScreenStratumSummary {
  const endpoints = Object.fromEntries(ENDPOINTS.map((key) => [key,
    { parentPass: 0, mutantPass: 0, bothPass: 0, pairedLoss: 0, pairedGain: 0, bothFail: 0 }])) as Record<Endpoint, EndpointCounts>;
  for (const row of rows) for (const key of ENDPOINTS) {
    const counts = endpoints[key], parent = row.parent[key] === 1, mutant = row.mutant[key] === 1;
    if (parent) counts.parentPass++;
    if (mutant) counts.mutantPass++;
    if (parent && mutant) counts.bothPass++;
    else if (parent) counts.pairedLoss++;
    else if (mutant) counts.pairedGain++;
    else counts.bothFail++;
  }
  return { founderIndex, scale, rawProposals: rows.length,
    uniqueMutantGenotypes: new Set(rows.map((r) => r.mutantGenomeKey)).size,
    uniqueEffectiveMutantGenotypes: new Set(rows.filter((r) => r.mutantGenomeKey !== r.parentGenomeKey)
      .map((r) => r.mutantGenomeKey)).size,
    unchangedAfterClamp: rows.filter((r) => r.unchangedAfterClamp).length,
    duplicateResults: rows.filter((r) => r.duplicateOf !== null).length,
    exactParentCacheHits: rows.filter((r) => r.cache === "exact-parent-hit").length,
    endpoints,
    anyEvaluationDifference: rows.filter((r) => !same(r.parent, r.mutant)).length,
    anyTraceSummaryDifference: rows.filter((r) => !same(r.parentTrace, r.mutantTrace)).length,
    pairedRoleAvailableFrames: rows.reduce((n, r) => n + r.pairedRoleChange.pairedAvailableFrames, 0),
    pairedRoleChangedFrames: rows.reduce((n, r) => n + r.pairedRoleChange.framesWithFixedRoleShareDifference, 0),
    roleChangedProposalAssays: rows.filter((r) => r.pairedRoleChange.framesWithFixedRoleShareDifference > 0).length,
    roleUnavailableProposalAssays: rows.filter((r) => r.pairedRoleChange.pairedAvailableFrames === 0).length };
}

/** Outcome counts are per proposal assay; genotype counts describe exposure, not independent trials. */
export function analyzeCompleteScreen(rows: readonly ScreenRow[]): ScreenAnalysis {
  if (rows.length !== SCREEN_PROPOSALS) throw new Error("complete screen analysis requires all 7200 rows");
  const founders = Array.from({ length: 12 }, (_, i) => i), scales = [1, 4, 24];
  return { status: "complete", overall: summarizeScreenStratum(rows, null, null),
    byFounder: founders.map((f) => summarizeScreenStratum(rows.filter((r) => r.founderIndex === f), f, null)),
    byScale: scales.map((s) => summarizeScreenStratum(rows.filter((r) => r.scale === s), null, s)),
    byFounderScale: founders.flatMap((f) => scales.map((s) =>
      summarizeScreenStratum(rows.filter((r) => r.founderIndex === f && r.scale === s), f, s))),
    limitations: [
      "Raw proposals are nested within 12 fixed founders and three mutation scales; batch seed and tile position are assay coordinates.",
      "Duplicate mutant genotypes and unchanged-after-clamp proposals remain in raw paired counts. Unique-genotype denominators are exposure counts, not independent outcome trials.",
      "Reps=1 screen outcomes and fixed-role flux differences are descriptive; no binomial gate, mutation-benefit frequency, population-frequency, novel-function or life-cycle claim follows.",
    ] };
}
