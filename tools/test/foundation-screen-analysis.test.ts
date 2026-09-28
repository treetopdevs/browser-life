import { describe, expect, it } from "vitest";
import type { Evaluation } from "@bl/search";
import { mutationNeighborhood } from "../../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, type ScreenRow } from "../lib/foundation-screen.ts";
import { analyzeCompleteScreen, collectCompleteScreen, summarizeScreenStratum,
  type CompleteScreenInput } from "../lib/foundation-screen-analysis.ts";

const evaluation = (survived: 0 | 1): Evaluation => ({ reps: 1, survived, recovered: survived,
  regenerated: survived, lightDependent: survived, individuals: 1, meanMass: 10, speed: 0,
  mass: 10, recovery: survived, reproduction: 0 });
function row(id: string, parent: 0 | 1, mutant: 0 | 1, options: {
  key?: string; noop?: boolean; duplicate?: boolean; roleFrames?: number; changedRoleFrames?: number;
} = {}): ScreenRow {
  const trace = { frames: 30, livingCellObservations: 0, roleAvailableFrames: 0,
    roleAvailabilityFrames: { available: 0, "no-living-cells": 30, "no-catalytic-activity": 0,
      "missing-role-buffer": 0 }, roleDenominatorCells: 0, zeroFluxLineageCells: null,
    zeroFluxObservedFrames: 0, zeroFluxMissingFrames: 30, meanFixedRoleShares: null,
    meanEffectiveRoleDiversity: null, meanBoundMassPerFrame: 0,
    meanMembraneFractionAvailableFrames: null, membraneAvailableFrames: 0,
    movementObservedIntervals: 0, meanMovementPerObservedInterval: null };
  return { proposalId: id, founderIndex: 0, scale: 1, rawWhich: 1, rawDelta: 2, slot: 1,
    effectiveChange: options.noop ? 0 : 1, unchangedAfterClamp: !!options.noop,
    duplicateOf: options.duplicate ? "earlier" : null,
    seed: 620001001, candidateIndex: 0, tileSlots: [0], parentGenomeKey: "parent",
    mutantGenomeKey: options.key ?? id, parent: evaluation(parent), mutant: evaluation(mutant),
    qualityDifference: 0, parentTrace: trace, mutantTrace: trace,
    pairedRoleChange: { availability: "unavailable", parentAvailableFrames: 0, mutantAvailableFrames: 0,
      pairedAvailableFrames: options.roleFrames ?? 0, parentLivingCellsInPairedFrames: 0,
      mutantLivingCellsInPairedFrames: 0, meanFixedRoleShareDifferences: null,
      framesWithFixedRoleShareDifference: options.changedRoleFrames ?? 0,
      maxFixedRoleShareDistance: null, meanEffectiveRoleDiversityDifference: null },
    cache: options.noop ? "exact-parent-hit" : "none" } as ScreenRow;
}

describe("complete screen analysis", () => {
  it("keeps raw no-op and duplicate assays while exposing distinct genotype denominators", () => {
    const rows = [row("loss", 1, 0, { key: "mutant", roleFrames: 10, changedRoleFrames: 3 }),
      row("gain", 0, 1, { key: "mutant", duplicate: true, roleFrames: 10 }),
      row("noop", 1, 1, { key: "parent", noop: true })];
    const s = summarizeScreenStratum(rows, 0, 1);
    expect([s.rawProposals, s.uniqueMutantGenotypes, s.uniqueEffectiveMutantGenotypes]).toEqual([3, 2, 1]);
    expect([s.unchangedAfterClamp, s.duplicateResults, s.exactParentCacheHits]).toEqual([1, 1, 1]);
    expect(s.endpoints.survived).toEqual({ parentPass: 2, mutantPass: 2, bothPass: 1,
      pairedLoss: 1, pairedGain: 1, bothFail: 0 });
    expect([s.pairedRoleAvailableFrames, s.pairedRoleChangedFrames, s.roleChangedProposalAssays,
      s.roleUnavailableProposalAssays]).toEqual([20, 3, 1, 1]);
    expect(s.anyEvaluationDifference).toBe(2);
    expect(s.anyTraceSummaryDifference).toBe(0);
  });

  it("cannot label a subset complete and requires finished chunk controls", () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 200));
    expect([plan.batches.length, plan.neighborhood.proposals.length]).toEqual([113, 7200]);
    expect(() => analyzeCompleteScreen([])).toThrow(/all 7200/);
    expect(() => collectCompleteScreen(plan, [], "hash", {})).toThrow(/incomplete screen/);
    const incomplete: CompleteScreenInput = { format: "foundation-screen-execution/v1", status: "bounded-incomplete",
      sourcePlan: { sha256: "hash" }, sourceIdentity: {},
      budget: { batchStart: 0, maxBatches: 1, selectedBatchIndices: [0] },
      execution: { completedBatches: 0, completedProposals: 0, incompleteBatch: { index: 0 }, error: null },
      results: [] };
    expect(() => collectCompleteScreen(plan, [incomplete], "hash", {})).toThrow(/fully completed/);
  });

  it("accepts exactly the planned 113-batch evidence and rejects a failed local repeat", () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 200));
    const proposals = new Map(plan.neighborhood.proposals.map((p) => [p.id, p]));
    const chunks: CompleteScreenInput[] = [];
    for (let start = 0; start < plan.batches.length; start += 8) {
      const selected = plan.batches.slice(start, start + 8);
      const results = selected.map((batch, localIndex) => ({ index: batch.index, seed: batch.seed,
        evalConfig: { ...plan.evalTemplate, seed: batch.seed }, cacheHits: 0,
        exactParentRepeat: { evaluated: localIndex === 0, evaluationIdentical: true, traceIdentical: true },
        rows: batch.proposalIds.map((id, candidateIndex) => {
          const p = proposals.get(id)!;
          const parentGenomeKey = plan.neighborhood.founders[p.founderIndex].genome.key;
          return { ...row(id, 1, 1), founderIndex: p.founderIndex, scale: p.scale,
            rawWhich: p.rawWhich, rawDelta: p.rawDelta, slot: p.slot, effectiveChange: p.effectiveChange,
            unchangedAfterClamp: p.unchangedAfterClamp, duplicateOf: p.duplicateOf,
            seed: batch.seed, candidateIndex, tileSlots: [candidateIndex],
            parentGenomeKey, mutantGenomeKey: p.genome.key,
            cache: p.genome.key === parentGenomeKey ? "exact-parent-hit" as const : "none" as const };
        }) }));
      chunks.push({ format: "foundation-screen-execution/v1", status: "bounded-incomplete",
        sourcePlan: { sha256: "hash" }, sourceIdentity: {},
        budget: { batchStart: start, maxBatches: selected.length,
          selectedBatchIndices: selected.map((b) => b.index) },
        execution: { completedBatches: results.length,
          completedProposals: results.reduce((n, b) => n + b.rows.length, 0),
          incompleteBatch: null, error: null }, results });
    }
    const rows = collectCompleteScreen(plan, chunks, "hash", {});
    const analysis = analyzeCompleteScreen(rows);
    expect([analysis.overall.rawProposals, analysis.byFounderScale.length,
      analysis.byFounderScale[0].rawProposals]).toEqual([7200, 36, 200]);
    expect(analysis.overall.endpoints.survived.bothPass).toBe(7200);
    chunks[1].results[0].exactParentRepeat.traceIdentical = false;
    expect(() => collectCompleteScreen(plan, chunks, "hash", {})).toThrow(/fully completed/);
  });
});
