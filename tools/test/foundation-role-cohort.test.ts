import { beforeAll, describe, expect, it } from "vitest";
import type { Evaluation } from "@bl/search";
import type { BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";
import { mutationNeighborhood } from "../../packages/search/src/mutation-neighborhood.ts";
import { buildScreenPlan, SCREEN_EVAL, summarizePairedRoles, summarizeTrace,
  type ScreenPlan, type ScreenRow } from "../lib/foundation-screen.ts";
import { analyzeRoleCohort, executeRoleSeed, nominateRoleCohort, roleSlots, ROLE_COHORT_SEEDS,
  ROLE_COHORT_SMOKE_SEEDS, type RoleCandidate, type RoleEvaluator, type RoleSeedResult } from "../lib/foundation-role-cohort.ts";
import { checkRoleReport, type ReconcileReport, type InterruptionReceipt } from "../lib/foundation-role-cohort-reconcile.ts";

const evaluation = (v = 1): Evaluation => ({ survived: v, recovered: v, lightDependent: v, reps: 1,
  individuals: 2, meanMass: 100, speed: 1, mass: 200, recovery: v, reproduction: 1, regenerated: v });
const sample = (step: number, tile: number, chemotroph = false): BehaviorSample => ({ step, phase: "growth", tile,
  livingCells: 10, biomass: 30, polymer: 10, boundMass: 40, membraneFraction: 0.25,
  roles: { source: "last-step per-cell catalytic flux, classified by lineage into four fixed roles",
    availability: "available", denominatorLivingCells: 10, zeroFluxLineageCells: 0, totalCatalyticQuanta: 5,
    shares: { phototroph: chemotroph ? 0 : 1, chemotroph: chemotroph ? 1 : 0, decomposer: 0, mixed: 0 }, effectiveDiversity: 1 },
  movement: { source: "tracked component-centroid displacement between growth censuses",
    observedIntervals: 1, intervalSteps: 100, meanCellsPer100Steps: 1 } });
let plan: ScreenPlan;
beforeAll(() => { plan = buildScreenPlan(mutationNeighborhood(610000001, 200)); });
function allRows(): ScreenRow[] {
  const role = summarizePairedRoles([sample(100, 0)], [sample(100, 0)]);
  const trace = summarizeTrace(Array.from({ length: 30 }, (_, i) => sample((i + 1) * 100, 0)));
  const byId = new Map(plan.neighborhood.proposals.map((p) => [p.id, p]));
  return plan.batches.flatMap((batch) => batch.proposalIds.map((id, k) => {
    const p = byId.get(id)!;
    return { proposalId: id, founderIndex: p.founderIndex, scale: p.scale, rawWhich: p.rawWhich, rawDelta: p.rawDelta,
      slot: p.slot, effectiveChange: p.effectiveChange, unchangedAfterClamp: p.unchangedAfterClamp,
      duplicateOf: p.duplicateOf, seed: batch.seed, candidateIndex: k, tileSlots: [k],
      parentGenomeKey: plan.neighborhood.founders[p.founderIndex].genome.key, mutantGenomeKey: p.genome.key,
      parent: evaluation(), mutant: evaluation(), qualityDifference: 0, parentTrace: trace, mutantTrace: trace,
      pairedRoleChange: role, cache: "none" };
  }));
}
function fixtureCandidates(): RoleCandidate[] {
  const founders = plan.neighborhood.founders;
  return Array.from({ length: 25 }, (_, i) => {
    const founderIndex = i < 13 ? i % 12 : i - 13;
    const g = founders[founderIndex].genome;
    return { id: i < 13 ? `nominee-${i}` : `control-${founderIndex}`, kind: i < 13 ? "role-nominee" : "identity-control",
      founderIndex, logicalIndex: i, genome: g, parentGenome: g, selectionSha256: i < 13 ? "x" : null,
      sourceProposalId: null, sourceScreenBatch: null, sourceScreenSeed: null,
      originatingProposalIds: [], eligibleProposalIds: [], originatingScales: [] };
  });
}
const evaluator: RoleEvaluator = async (genomes, ec, onSample) => genomes.map((g, k) => {
  for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery)
    onSample(k, k, sample(step, k, g.mu % 2 === 1));
  return { ...evaluation(), mass: 200 + g.mu + k };
});

describe("M3 role cohort", () => {
  it("ranks unique genome bytes independently of duplicate proposal multiplicity", () => {
    const rows = allRows();
    const origins = plan.neighborhood.proposals.filter((p) => p.founderIndex === 0 && p.effectiveChange !== 0);
    const first = origins.find((p) => origins.some((q) => q.id !== p.id && q.genome.key === p.genome.key))!;
    const duplicate = origins.find((p) => p.id !== first.id && p.genome.key === first.genome.key)!;
    const second = origins.find((p) => p.genome.key !== first.genome.key)!;
    const mark = (id: string) => { const r = rows.find((x) => x.proposalId === id)!;
      r.pairedRoleChange = { ...r.pairedRoleChange, pairedAvailableFrames: 30, framesWithFixedRoleShareDifference: 1 }; };
    mark(first.id); mark(second.id);
    const once = nominateRoleCohort(plan, rows, 113);
    mark(duplicate.id);
    const twice = nominateRoleCohort(plan, rows, 113);
    expect(twice.candidates.filter((c) => c.kind === "role-nominee").map((c) => c.genome.key))
      .toEqual(once.candidates.filter((c) => c.kind === "role-nominee").map((c) => c.genome.key));
    expect(twice.coverage.eligibleProposalAssays).toBe(3);
    expect(twice.coverage.eligibleDistinctFounderGenotypes).toBe(2);
    const selected = twice.candidates.find((c) => c.genome.key === first.genome.key)!;
    expect(selected.eligibleProposalIds).toContain(first.id);
    expect(selected.eligibleProposalIds).toContain(duplicate.id);
    expect(selected.originatingProposalIds).toContain(duplicate.id);
    expect(() => nominateRoleCohort(plan, rows.slice(1), 113)).toThrow(/complete/);
  });

  it("maps 25 logical entries to 50 fixed tiles and verifies exact controls and repeat", async () => {
    const candidates = fixtureCandidates(), slots = roleSlots(candidates);
    expect(slots.map((s) => s.slot)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(slots[25]).toMatchObject({ panel: 1, logicalIndex: 0, slot: 25, candidateId: slots[0].candidateId });
    const calls: number[] = [];
    const result = await executeRoleSeed(candidates, ROLE_COHORT_SEEDS[0], (genomes, ec, onSample) => {
      calls.push(genomes.length);
      return evaluator(genomes, ec, onSample);
    });
    expect(calls).toEqual([50, 50, 50]);
    expect(result.exactParentRepeat).toEqual({ evaluated: true, evaluationIdentical: true, traceIdentical: true });
    expect(result.rows).toHaveLength(50);
    expect(result.rows.filter((r) => r.identityControlExact === true)).toHaveLength(24);
    expect(result.rows[25].pointwise).toHaveLength(30);
    let call = 0;
    const unstable: RoleEvaluator = async (genomes, ec, onSample) => {
      call++;
      const rows = await evaluator(genomes, ec, onSample);
      return rows.map((r) => ({ ...r, mass: r.mass + call }));
    };
    await expect(executeRoleSeed(candidates, ROLE_COHORT_SEEDS[1], unstable)).rejects.toThrow(/repeat/);
  });

  it("keeps the reserved engineering smoke outside the scientific seed protocol", async () => {
    const candidates = fixtureCandidates(), smoke = ROLE_COHORT_SMOKE_SEEDS[0];
    await expect(executeRoleSeed(candidates, smoke, evaluator)).rejects.toThrow(/outside/);
    const result = await executeRoleSeed(candidates, smoke, evaluator, () => {}, true, true);
    expect(result.rows).toHaveLength(50);
    expect(result.rows.filter((r) => r.identityControlExact === true)).toHaveLength(24);
    expect(() => analyzeRoleCohort(candidates, [result])).toThrow(/foreign/);
  });

  it("retains opposite transient fixed-role changes when average diversity and shares cancel", async () => {
    const candidates = fixtureCandidates();
    const parent = candidates[0].parentGenome;
    candidates[0] = { ...candidates[0], genome: { ...parent, mu: parent.mu + 1, key: "changed-role-genome" } };
    const alternating: RoleEvaluator = async (genomes, ec, onSample) => genomes.map((g, k) => {
      for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) {
        const odd = (step / ec.censusEvery) % 2 === 1;
        onSample(k, k, sample(step, k, odd !== (g.mu === parent.mu)));
      }
      return evaluation();
    });
    const result = await executeRoleSeed(candidates, ROLE_COHORT_SEEDS[0], alternating);
    expect(result.rows[0].parentTrace.meanEffectiveRoleDiversity).toBe(1);
    expect(result.rows[0].mutantTrace.meanEffectiveRoleDiversity).toBe(1);
    expect(result.rows[0].parentTrace.meanFixedRoleShares).toEqual(result.rows[0].mutantTrace.meanFixedRoleShares);
    expect(result.rows[0].pairedRoleChange.framesWithFixedRoleShareDifference).toBe(30);
    expect(result.rows[25].pairedRoleChange.framesWithFixedRoleShareDifference).toBe(30);
    const descriptive = analyzeRoleCohort(candidates, [result]).panels[0].descriptive;
    expect(descriptive.changedRoleFrames).toBe(30);
    expect(descriptive.roleShareTrajectory[0].pairedAvailableSeeds).toBe(1);
    expect(descriptive.roleShareTrajectory[0].meanPairedDifferences?.phototroph).not.toBe(0);
  });

  it("keeps absent role evidence unavailable with explicit frame denominators", async () => {
    const candidates = fixtureCandidates();
    const missing: RoleEvaluator = async (genomes, ec, onSample) => genomes.map((_g, k) => {
      for (let step = ec.censusEvery; step <= ec.growSteps; step += ec.censusEvery) {
        const observed = sample(step, k);
        onSample(k, k, { ...observed, roles: { ...observed.roles, availability: "missing-role-buffer",
          denominatorLivingCells: 0, shares: null, effectiveDiversity: null } });
      }
      return evaluation();
    });
    const result = await executeRoleSeed(candidates, ROLE_COHORT_SEEDS[0], missing);
    const first = analyzeRoleCohort(candidates, [result]).panels[0].descriptive;
    expect(first.pairedRoleFrames).toBe(0);
    expect(first.pairedRoleMissingFrames).toBe(30);
    expect(first.roleShareTrajectory[0]).toMatchObject({ pairedAvailableSeeds: 0,
      parentMeanShares: null, mutantMeanShares: null, meanPairedDifferences: null });
  });

  it("keeps 32-seed gates separate by position, counts focal survival harm and rejects incomplete controls", async () => {
    const candidates = fixtureCandidates();
    const base = await executeRoleSeed(candidates, ROLE_COHORT_SEEDS[0], evaluator);
    const results: RoleSeedResult[] = ROLE_COHORT_SEEDS.map((seed) => structuredClone({ ...base, seed,
      evalConfig: { ...SCREEN_EVAL, seed } }));
    // The second fixed panel has a survival harm despite the parent's regeneration failing on that seed.
    results[0].rows[25].parent.regenerated = 0;
    results[0].rows[25].mutant.survived = 0;
    const analysis = analyzeRoleCohort(candidates, results);
    expect(analysis.status).toBe("complete");
    expect(analysis.panels).toHaveLength(26);
    expect(analysis.panels[0].inference?.pairedByEndpoint.survived.harm).toBe(0);
    expect(analysis.panels[13].inference?.pairedByEndpoint.survived.harm).toBe(1);
    expect(analysis.panels[13].inference?.parentAbsoluteGates.regenerated.successes).toBe(31);
    expect(analysis.panels[13].inference?.survivalLossWithinTenPercentagePoints).toBe(false);
    expect(analysis.crossPosition[0]).toMatchObject({ candidateId: candidates[0].id,
      observedSeeds: 32, absoluteGatePatternIdentical: true, bothPanelsAllAbsoluteGatesPass: true });
    expect(analysis.panels[13].descriptive.roleShareTrajectory).toHaveLength(30);
    expect(analysis.panels[13].descriptive.roleShareTrajectory[0].pairedAvailableSeeds).toBe(32);
    expect(analyzeRoleCohort(candidates, results.slice(0, 31)).panels[0].inference).toBeNull();
    expect(() => analyzeRoleCohort(candidates, [...results, results[0]])).toThrow(/duplicate/);
    results[0].rows[0].pairedRoleChange.framesWithFixedRoleShareDifference = 1;
    expect(() => analyzeRoleCohort(candidates, results)).toThrow(/invalid/);
    results[0].rows[0].pairedRoleChange.framesWithFixedRoleShareDifference = 0;
    results[0].rows[49].identityControlExact = false;
    expect(() => analyzeRoleCohort(candidates, results)).toThrow(/control|invalid/);
  });

  it("admits only a verified interrupted prefix with exact receipt and full 50-row controls", async () => {
    const candidates = fixtureCandidates(), seed = ROLE_COHORT_SEEDS[8];
    const result = await executeRoleSeed(candidates, seed, evaluator);
    const selectedSeeds = ROLE_COHORT_SEEDS.slice(8, 16), hashes = { "deno.json": { sha256: "a".repeat(64), bytes: 1 } };
    const report: ReconcileReport = { format: "foundation-m3-role-cohort-execution/v1", status: "running",
      sourcePlan: { sha256: "plan" }, selectedSourceHashes: hashes,
      budget: { seedStartOffset: 8, maxSeeds: 8, maxSeconds: 600, selectedSeeds },
      execution: { elapsedSeconds: 150, overrunSeconds: 0, incompleteSeed: null, incompleteStage: null, error: null },
      results: [result] };
    const receipt: InterruptionReceipt = { format: "foundation-m3-role-cohort-interruption/v1",
      createdAt: "2026-09-29T10:00:00Z", rawReport: { path: "raw.json", sha256: "raw-sha", status: "running" },
      sourcePlan: { sha256: "plan" }, process: { pid: 1, sessionId: 2, exitCode: 143, signal: "SIGTERM" },
      savedSeeds: [seed], nextSeed: { seed: ROLE_COHORT_SEEDS[9], status: "technical-started-possible-no-result-saved" },
      reportElapsedSeconds: 150 };
    expect(checkRoleReport(candidates, "plan", hashes, report, "raw.json", "raw-sha", receipt).savedSeeds).toEqual([seed]);
    expect(() => checkRoleReport(candidates, "plan", hashes, report, "raw.json", "wrong-sha", receipt)).toThrow(/receipt/);
    expect(() => checkRoleReport(candidates, "plan", hashes, report, "raw.json", "raw-sha", null)).toThrow(/receipt/);
    const relabeled = { ...report, status: "bounded-complete" };
    expect(() => checkRoleReport(candidates, "plan", hashes, relabeled, "raw.json", "raw-sha", null)).toThrow(/partial/);
    const bad = structuredClone(report);
    bad.results[0].rows[49].identityControlExact = false;
    expect(() => checkRoleReport(candidates, "plan", hashes, bad, "raw.json", "raw-sha", receipt)).toThrow(/invalid/);
    const wrongSchedule = structuredClone(report);
    wrongSchedule.budget.selectedSeeds = ROLE_COHORT_SEEDS.slice(9, 17);
    expect(() => checkRoleReport(candidates, "plan", hashes, wrongSchedule, "raw.json", "raw-sha", receipt)).toThrow(/prefix/);
  });
});
