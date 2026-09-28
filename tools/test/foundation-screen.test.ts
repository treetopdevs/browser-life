import { describe, expect, it } from "vitest";
import type { Genome } from "@bl/schema";
import type { EvalConfig, Evaluation } from "@bl/search";
import type { BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";
import { mutationNeighborhood } from "../../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, executeScreenBatch, screenCacheKey, screenCompletionStatus, summarizeTrace, summarizePairedRoles,
  type ScreenEvaluator } from "../lib/foundation-screen.ts";

const sample = (tile: number): BehaviorSample => ({
  step: 100, phase: "growth", tile, livingCells: 10, biomass: 30, polymer: 10, boundMass: 40, membraneFraction: 0.25,
  roles: { source: "last-step per-cell catalytic flux, classified by lineage into four fixed roles",
    availability: "available", denominatorLivingCells: 10, zeroFluxLineageCells: 2, totalCatalyticQuanta: 5,
    shares: { phototroph: 0.8, chemotroph: 0, decomposer: 0, mixed: 0.2 }, effectiveDiversity: 1.6493848884661177 },
  movement: { source: "tracked component-centroid displacement between growth censuses",
    observedIntervals: 2, intervalSteps: 100, meanCellsPer100Steps: 3 },
});
const evaluation = (g: Genome, k: number): Evaluation => ({
  survived: 1, recovered: 1, lightDependent: 1, reps: 1, individuals: 1,
  meanMass: 100 + k + g.mu + g.weights[0], speed: 1, mass: 200 + k + g.sigma,
  recovery: 1, regenerated: 1, reproduction: 0,
});
const evaluator = (calls: { keys: string[]; seed: number }[]): ScreenEvaluator =>
  async (genomes, ec, onSample) => {
    calls.push({ keys: genomes.map((g) => `${g.mu}:${g.sigma}:${Array.from(g.weights).join(",")}`), seed: ec.seed });
    return genomes.map((g, k) => {
      for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery)
        for (let r = 0; r < ec.reps; r++) onSample(k, k * ec.reps + r, { ...sample(k * ec.reps + r), step });
      return evaluation(g, k);
    });
  };

describe("deterministic mutation screen", () => {
  it("round-robins all founder×scale strata and maps both arms to identical slots and seed", async () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 2));
    expect(plan.evalTemplate.reps).toBe(1);
    expect(plan.coverage.proposals).toBe(72);
    expect(plan.coverage.byStratum).toHaveLength(36);
    expect(plan.coverage.byStratum.every((s) => s.drawn === 2)).toBe(true);
    expect(plan.batches.map((b) => [b.seed, b.proposalIds.length])).toEqual([[620001001, 64], [620001002, 8]]);
    expect(new Set(plan.batches[0].proposalIds.slice(0, 36).map((id) => id.replace(/-p\d+$/, ""))).size).toBe(36);
    const calls: { keys: string[]; seed: number }[] = [];
    const first = await executeScreenBatch(plan, plan.batches[0], evaluator(calls));
    expect(calls).toHaveLength(3); // parent, exact repeat, mutant
    expect(calls.map((c) => c.seed)).toEqual([620001001, 620001001, 620001001]);
    expect(calls[0].keys).toEqual(calls[1].keys);
    expect(first.exactParentRepeat).toEqual({ evaluated: true, evaluationIdentical: true, traceIdentical: true });
    first.rows.forEach((row, k) => {
      expect(row.candidateIndex).toBe(k);
      expect(row.tileSlots).toEqual([k]);
      expect(row.seed).toBe(plan.batches[0].seed);
      expect(row.parentTrace).toMatchObject({ frames: 30, roleAvailableFrames: 30, roleDenominatorCells: 300, movementObservedIntervals: 60 });
    });
    const secondCalls: { keys: string[]; seed: number }[] = [];
    const second = await executeScreenBatch(plan, plan.batches[1], evaluator(secondCalls), () => {}, false);
    expect(secondCalls).toHaveLength(2);
    expect(second.rows).toHaveLength(8);
    expect(second.exactParentRepeat.evaluated).toBe(false);
  });

  it("reuses only an exact genotype, seed, tile and config; retains the no-op proposal row", async () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 1));
    const p = plan.neighborhood.proposals[0];
    p.genome = plan.neighborhood.founders[p.founderIndex].genome;
    p.unchangedAfterClamp = true;
    p.duplicateOf = `f${p.founderIndex}:parent`;
    const batch = { index: 0, seed: plan.batches[0].seed, proposalIds: [p.id] };
    const calls: { keys: string[]; seed: number }[] = [];
    const result = await executeScreenBatch(plan, batch, evaluator(calls));
    expect(calls).toHaveLength(2); // mutant batch is entirely exact-cache hits
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ proposalId: p.id, unchangedAfterClamp: true,
      duplicateOf: `f${p.founderIndex}:parent`, cache: "exact-parent-hit", qualityDifference: 0 });
    const ec: EvalConfig = { ...plan.evalTemplate, seed: batch.seed };
    const key = plan.neighborhood.founders[p.founderIndex].genome.key;
    expect(screenCacheKey(key, batch.seed, 0, ec)).not.toBe(screenCacheKey(key, batch.seed, 1, ec));
    expect(screenCacheKey(key, batch.seed, 0, ec)).not.toBe(screenCacheKey(key, batch.seed + 1, 0, ec));
    expect(screenCacheKey(key, batch.seed, 0, ec)).not.toBe(screenCacheKey(key, batch.seed, 0, { ...ec, growSteps: ec.growSteps + 1 }));
  });

  it("fails a nonrepeatable first parent batch and keeps budget overflow incomplete", async () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 1));
    let calls = 0;
    const bad: ScreenEvaluator = async (genomes, _ec, onSample) => {
      calls++;
      return genomes.map((g, k) => {
        for (let step = _ec.censusEvery; step <= _ec.growSteps; step += _ec.censusEvery)
          onSample(k, k, { ...sample(k), step });
        return { ...evaluation(g, k), mass: calls };
      });
    };
    await expect(executeScreenBatch(plan, plan.batches[0], bad)).rejects.toThrow(/repeatability/);
    expect(calls).toBe(2);
    expect(screenCompletionStatus(1, 1, 0, 10, 9)).toBe("over-budget-incomplete");
    expect(screenCompletionStatus(1, 2, 0, 9, 10)).toBe("bounded-incomplete");
    expect(screenCompletionStatus(1, 1, 0, 9, 10)).toBe("completed");
  });

  it("repeats the first local parent batch even when a bounded chunk starts after batch zero", async () => {
    const plan = buildScreenPlan(mutationNeighborhood(610000001, 2));
    let calls = 0;
    const bad: ScreenEvaluator = async (genomes, ec, onSample) => {
      calls++;
      return genomes.map((g, k) => {
        for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery)
          onSample(k, k, { ...sample(k), step });
        return { ...evaluation(g, k), mass: calls };
      });
    };
    await expect(executeScreenBatch(plan, plan.batches[1], bad)).rejects.toThrow(/repeatability/);
    expect(calls).toBe(2);
  });

  it("summarizes role and movement availability with explicit denominators", () => {
    const s = sample(0);
    const noRole: BehaviorSample = { ...s, roles: { ...s.roles, availability: "no-catalytic-activity",
      shares: null, effectiveDiversity: null, zeroFluxLineageCells: 10, totalCatalyticQuanta: 0 },
      movement: { ...s.movement, observedIntervals: 0, meanCellsPer100Steps: null } };
    expect(summarizeTrace([s, noRole])).toMatchObject({ frames: 2, livingCellObservations: 20,
      roleAvailableFrames: 1, roleDenominatorCells: 10, meanEffectiveRoleDiversity: s.roles.effectiveDiversity,
      meanFixedRoleShares: s.roles.shares,
      zeroFluxLineageCells: 12, zeroFluxObservedFrames: 2, zeroFluxMissingFrames: 0,
      membraneAvailableFrames: 2, movementObservedIntervals: 2, meanMovementPerObservedInterval: 3 });
    expect(summarizeTrace([])).toMatchObject({ frames: 0, meanBoundMassPerFrame: null,
      meanFixedRoleShares: null, meanEffectiveRoleDiversity: null, meanMovementPerObservedInterval: null,
      zeroFluxLineageCells: null, zeroFluxObservedFrames: 0, zeroFluxMissingFrames: 0 });
    expect(summarizeTrace([{ ...s, roles: { ...s.roles, availability: "missing-role-buffer",
      zeroFluxLineageCells: null, shares: null, effectiveDiversity: null } }])).toMatchObject({
      zeroFluxLineageCells: null, zeroFluxObservedFrames: 0, zeroFluxMissingFrames: 1,
      meanFixedRoleShares: null, meanEffectiveRoleDiversity: null });
    expect(() => summarizeTrace([{ ...s, roles: { ...s.roles, effectiveDiversity: null } }])).toThrow(/role evidence/);
  });

  it("reports a fixed-role swap even when effective diversity is unchanged", () => {
    const parent = sample(0), mutant = sample(0);
    parent.roles = { ...parent.roles, shares: { phototroph: 1, chemotroph: 0, decomposer: 0, mixed: 0 }, effectiveDiversity: 1 };
    mutant.roles = { ...mutant.roles, shares: { phototroph: 0, chemotroph: 1, decomposer: 0, mixed: 0 }, effectiveDiversity: 1 };
    expect(summarizePairedRoles([parent], [mutant])).toMatchObject({ availability: "available",
      pairedAvailableFrames: 1, parentLivingCellsInPairedFrames: 10, mutantLivingCellsInPairedFrames: 10,
      meanFixedRoleShareDifferences: { phototroph: -1, chemotroph: 1, decomposer: 0, mixed: 0 },
      framesWithFixedRoleShareDifference: 1, maxFixedRoleShareDistance: 1,
      meanEffectiveRoleDiversityDifference: 0 });
    const reverseParent = { ...mutant, step: 200 }, reverseMutant = { ...parent, step: 200 };
    expect(summarizePairedRoles([parent, reverseParent], [mutant, reverseMutant])).toMatchObject({
      pairedAvailableFrames: 2, framesWithFixedRoleShareDifference: 2, maxFixedRoleShareDistance: 1,
      meanFixedRoleShareDifferences: { phototroph: 0, chemotroph: 0, decomposer: 0, mixed: 0 },
      meanEffectiveRoleDiversityDifference: 0 });
    const missing = { ...mutant, roles: { ...mutant.roles, availability: "no-catalytic-activity" as const,
      shares: null, effectiveDiversity: null } };
    expect(summarizePairedRoles([parent], [missing])).toMatchObject({ availability: "unavailable",
      parentAvailableFrames: 1, mutantAvailableFrames: 0, pairedAvailableFrames: 0,
      meanFixedRoleShareDifferences: null, maxFixedRoleShareDistance: null,
      meanEffectiveRoleDiversityDifference: null });
  });
});
