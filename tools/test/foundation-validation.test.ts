import { beforeAll, describe, expect, it } from "vitest";
import type { Evaluation } from "@bl/search";
import type { Genome } from "@bl/schema";
import type { BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";
import { mutationNeighborhood, type MutationProposal } from "../../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, SCREEN_EVAL, summarizePairedRoles, summarizeTrace,
  type ScreenPlan, type ScreenRow } from "../lib/foundation-screen.ts";
import { analyzeValidation, collectScreenRows, executeValidationSeed, nominate, VALIDATION_SEEDS,
  type ScreenExecutionInput, type ValidationEvaluator, type ValidationSeedResult } from "../lib/foundation-validation.ts";

const evaluation = (v = 1): Evaluation => ({ survived: v, recovered: v, lightDependent: v, reps: 1,
  individuals: 2, meanMass: 100, speed: 1, mass: 200, recovery: v, reproduction: 1, regenerated: v });
const sample = (step: number, tile: number): BehaviorSample => ({ step, phase: "growth", tile,
  livingCells: 10, biomass: 30, polymer: 10, boundMass: 40, membraneFraction: 0.25,
  roles: { source: "last-step per-cell catalytic flux, classified by lineage into four fixed roles",
    availability: "available", denominatorLivingCells: 10, zeroFluxLineageCells: 0, totalCatalyticQuanta: 5,
    shares: { phototroph: 1, chemotroph: 0, decomposer: 0, mixed: 0 }, effectiveDiversity: 1 },
  movement: { source: "tracked component-centroid displacement between growth censuses",
    observedIntervals: 1, intervalSteps: 100, meanCellsPer100Steps: 1 } });
let plan: ScreenPlan;
beforeAll(() => { plan = buildScreenPlan(mutationNeighborhood(610000001, 200)); });
function screenRow(proposal: MutationProposal, batchIndex = 0, candidateIndex = 0): ScreenRow {
  const s = sample(100, candidateIndex), trace = summarizeTrace(Array.from({ length: 30 }, (_, i) => ({ ...s, step: (i + 1) * 100 })));
  const roles = summarizePairedRoles([s], [s]);
  return { proposalId: proposal.id, founderIndex: proposal.founderIndex, scale: proposal.scale,
    rawWhich: proposal.rawWhich, rawDelta: proposal.rawDelta, slot: proposal.slot,
    effectiveChange: proposal.effectiveChange, unchangedAfterClamp: proposal.unchangedAfterClamp,
    duplicateOf: proposal.duplicateOf, seed: plan.batches[batchIndex].seed,
    candidateIndex, tileSlots: [candidateIndex], parentGenomeKey: plan.neighborhood.founders[proposal.founderIndex].genome.key,
    mutantGenomeKey: proposal.genome.key, parent: evaluation(), mutant: evaluation(), qualityDifference: 0,
    parentTrace: trace, mutantTrace: trace, pairedRoleChange: roles, cache: "none" };
}
function distinctEffective() {
  const found = plan.neighborhood.proposals.filter((p) => p.founderIndex === 0 && p.effectiveChange !== 0);
  const a = found[0], b = found.find((p) => p.genome.key !== a.genome.key)!,
    duplicate = found.find((p) => p.id !== a.id && p.genome.key === a.genome.key)!;
  return { a, b, duplicate };
}
function nominees() {
  const { a, b, duplicate } = distinctEffective();
  const shifted = { ...screenRow(a), pairedRoleChange: { ...screenRow(a).pairedRoleChange,
    pairedAvailableFrames: 30, framesWithFixedRoleShareDifference: 2 } };
  const duplicateShifted = { ...screenRow(duplicate), mutantGenomeKey: a.genome.key,
    pairedRoleChange: shifted.pairedRoleChange };
  const changed = { ...screenRow(b), mutant: { ...evaluation(), mass: 201 } };
  return { a, b, duplicate, rows: [shifted, duplicateShifted, changed] };
}

describe("prespecified mutation validation", () => {
  it("ranks unique genotypes, preserves duplicate origins, class priority and partial-screen denominators", () => {
    const { a, b, duplicate, rows } = nominees();
    const one = nominate(plan, [rows[0], rows[2]], 1), two = nominate(plan, rows, 1);
    expect(two.candidates.map((c) => c.kind)).toEqual(["role-shift-preserved", "changed-preserved",
      ...Array.from({ length: 12 }, () => "identity-control")]);
    expect(two.candidates[0].genome.key).toBe(a.genome.key);
    expect(two.candidates[1].genome.key).toBe(b.genome.key);
    expect(one.candidates[0].selectionSha256).toBe(two.candidates[0].selectionSha256);
    expect(two.candidates[0].originatingProposalIds).toContain(a.id);
    expect(two.candidates[0].originatingProposalIds).toContain(duplicate.id);
    expect(two.candidates[0].screenedOriginatingProposalIds).toEqual([a.id, duplicate.id]);
    expect(two.coverage).toMatchObject({ plannedProposals: 7200, screenedProposals: 3,
      unobservedProposals: 7197 });
    expect(two.coverage.byFounder[1].classes[0]).toMatchObject({ availability: "no-eligible-observation",
      eligibleProposals: 0, eligibleDistinctGenotypes: 0 });
    expect(two.candidates).toHaveLength(14);
    expect(two.candidates.map((c) => c.candidateIndex)).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it("rejects duplicate screen batches and proposal position conflicts", () => {
    const batch = plan.batches[0];
    const rows = batch.proposalIds.map((id, k) => screenRow(plan.neighborhood.proposals.find((p) => p.id === id)!, 0, k));
    const input: ScreenExecutionInput = { format: "foundation-screen-execution/v1", status: "bounded-incomplete",
      sourcePlan: { sha256: "saved-sha" }, sourceIdentity: { code: "same" }, budget: { selectedBatchIndices: [0] },
      results: [{ index: 0, seed: batch.seed, evalConfig: { ...SCREEN_EVAL, seed: batch.seed }, rows,
        exactParentRepeat: { evaluated: true, evaluationIdentical: true, traceIdentical: true }, cacheHits: 0 }] };
    expect(collectScreenRows(plan, [input], "saved-sha", { code: "same" })).toMatchObject({ batchCount: 1, rows });
    expect(() => collectScreenRows(plan, [input, input], "saved-sha", { code: "same" })).toThrow(/duplicate/);
    expect(() => collectScreenRows(plan, [{ ...input, results: [{ ...input.results[0], rows: [
      { ...rows[0], candidateIndex: 1 }, ...rows.slice(1) ] }] }], "saved-sha", { code: "same" })).toThrow(/conflict/);
    expect(() => collectScreenRows(plan, [input], "wrong-sha", { code: "same" })).toThrow(/mismatch/);
  });

  it("keeps parent/mutant tile positions matched and requires full-trace identity controls every seed", async () => {
    const candidates = nominate(plan, nominees().rows, 1).candidates;
    const calls: { seed: number; count: number }[] = [];
    const fake: ValidationEvaluator = async (genomes, ec, onSample) => {
      calls.push({ seed: ec.seed, count: genomes.length });
      return genomes.map((g, k) => {
        for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery)
          onSample(k, k, sample(step, k));
        return { ...evaluation(), mass: 200 + g.mu + k };
      });
    };
    const result = await executeValidationSeed(candidates, VALIDATION_SEEDS[0], fake);
    expect(calls).toEqual(Array.from({ length: 3 }, () => ({ seed: VALIDATION_SEEDS[0], count: 14 })));
    expect(result.exactParentRepeat).toEqual({ evaluated: true, evaluationIdentical: true, traceIdentical: true });
    expect(result.rows.map((r) => r.tileSlots)).toEqual(Array.from({ length: 14 }, (_, i) => [i]));
    expect(result.rows[0].pointwise).toHaveLength(30);
    expect(result.rows.slice(-12).every((r) => r.identityControlExact &&
      r.parentFullTraceSha256 === r.mutantFullTraceSha256)).toBe(true);
    let call = 0;
    const unstable: ValidationEvaluator = async (genomes, ec, onSample) => {
      call++;
      return genomes.map((_g, k) => {
        for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) onSample(k, k, sample(step, k));
        return { ...evaluation(), mass: call };
      });
    };
    await expect(executeValidationSeed(candidates, VALIDATION_SEEDS[1], unstable)).rejects.toThrow(/repeatability/);
    let arm = 0;
    const badControl: ValidationEvaluator = async (genomes, ec, onSample) => {
      arm++;
      return genomes.map((_g, k) => {
        for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) onSample(k, k, sample(step, k));
        return { ...evaluation(), mass: k >= 2 && arm === 2 ? 201 : 200 };
      });
    };
    await expect(executeValidationSeed(candidates, VALIDATION_SEEDS[2], badControl, () => {}, false)).rejects.toThrow(/identity control/);
  });

  it("only exposes gates and paired harmful upper bounds after all 32 fresh seeds", async () => {
    const candidates = nominate(plan, nominees().rows, 1).candidates;
    const fake: ValidationEvaluator = async (genomes: Genome[], ec, onSample) => genomes.map((_g, k) => {
      for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) onSample(k, k, sample(step, k));
      return evaluation();
    });
    const first = await executeValidationSeed(candidates, VALIDATION_SEEDS[0], fake);
    const results: ValidationSeedResult[] = VALIDATION_SEEDS.map((seed) => ({ ...first, seed, evalConfig: { ...first.evalConfig, seed } }));
    const partial = analyzeValidation(candidates, results.slice(0, 31));
    expect(partial).toMatchObject({ status: "incomplete", missingSeeds: [VALIDATION_SEEDS[31]] });
    expect(partial.candidates[0].inference).toBeNull();
    const complete = analyzeValidation(candidates, results);
    expect(complete.candidates[0].inference).toMatchObject({ allAbsoluteGatesPass: true,
      pairedHarmfulByEndpoint: { survived: { count: 0 }, regenerated: { count: 0 }, lightDependent: { count: 0 } },
      jointThreeTraitHarm: { count: 0 }, survivalLossWithinTenPercentagePoints: true });
    expect(complete.candidates[0].inference!.pairedHarmfulByEndpoint.survived.upper95).toBeLessThan(0.1);
    const harmful = results.map((r, i) => i ? r : { ...r, rows: r.rows.map((row, k) => k ? row :
      { ...row, mutant: { ...row.mutant, survived: 0 } }) });
    expect(analyzeValidation(candidates, harmful).candidates[0].inference).toMatchObject({
      allAbsoluteGatesPass: true, pairedHarmfulByEndpoint: { survived: { count: 1 } },
      jointThreeTraitHarm: { count: 1 }, survivalLossWithinTenPercentagePoints: false });
    const masked = results.map((r, i) => i ? r : { ...r, rows: r.rows.map((row, k) => k ? row :
      { ...row, parent: { ...row.parent, regenerated: 0 }, mutant: { ...row.mutant, survived: 0, regenerated: 0 } }) });
    expect(analyzeValidation(candidates, masked).candidates[0].inference).toMatchObject({
      allAbsoluteGatesPass: true,
      pairedHarmfulByEndpoint: { survived: { count: 1 }, regenerated: { count: 0 }, lightDependent: { count: 0 } },
      jointThreeTraitHarm: { count: 0 }, survivalLossWithinTenPercentagePoints: false });
    expect(() => analyzeValidation(candidates, [results[0], results[0]])).toThrow(/duplicate/);
  });

  it("rejects malformed saved rows before complete-seed inference", async () => {
    const candidates = nominate(plan, nominees().rows, 1).candidates;
    const fake: ValidationEvaluator = async (genomes, ec, onSample) => genomes.map((_g, k) => {
      for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) onSample(k, k, sample(step, k));
      return evaluation();
    });
    const baseline = await executeValidationSeed(candidates, VALIDATION_SEEDS[0], fake);
    const corrupt = (change: (row: ValidationSeedResult["rows"][number]) => ValidationSeedResult["rows"][number]) =>
      [{ ...baseline, rows: [change(baseline.rows[0]), ...baseline.rows.slice(1)] }];
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, parent: { ...r.parent, reps: 2 } })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, mutant: { ...r.mutant, survived: 2 } })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, pointwise: r.pointwise.slice(1) })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, pointwise: r.pointwise.map((p, i) =>
      i === 1 ? { ...p, step: 999 } : p) })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, kind: "identity-control" })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, founderIndex: 9 })))).toThrow(/mismatch/);
    expect(() => analyzeValidation(candidates, corrupt((r) => ({ ...r, parentFullTraceSha256: "bad" })))).toThrow(/mismatch/);
  });
});
