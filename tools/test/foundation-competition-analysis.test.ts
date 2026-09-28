import { describe, expect, it } from "vitest";
import { analyzeCompetition } from "../lib/foundation-competition-analysis.ts";
import { FIRST_COMPETITION_SEED } from "../lib/foundation-competition.ts";
import type { CompetitionManifest, RunPlan } from "../foundation-competition.ts";

const digest = { sha256: "a".repeat(64), bytes: 1 };
const kinds = ["early", "early-founder", "late", "late-founder"] as const;
const environments = ["own/early", "own/late", "foreign/early", "foreign/late", "standardized"] as const;
const life = () => ({ scope: "one-solo-garden-in-situ-observer-trace", status: "complete",
  plannedEndStep: 3000, lastCapturedStep: 3000, analysis: null, unreconciledEvents: [],
  limitations: [], window: { startStep: 100, endStep: 3000, life: [], trackerEvents: [],
    overlapMixing: [], membership: [],
    censusDigests: Array.from({ length: 30 }, (_, i) => ({ step: (i + 1) * 100,
      labelsSha256: "b".repeat(64), eligibleComponents: 1, trackedIndividuals: 1 })),
    frames: Array.from({ length: 30 }, (_, i) => ({ step: (i + 1) * 100, id: 1,
      componentIndex: 0, tile: 0, born: 100, age: null, leftTruncated: true,
      lineage: "0:1", purity: 1, cells: 5, mass: 500, biomass: 500,
      membraneFraction: 0, membraneCellStd: 0, rimCoreMembraneDifference: 0,
      compartmentalised: false, cellResourceMeans: { A: 32, C: 0, E: 128, S: 0 } })) } });

function fixture() {
  const sources = Array.from({ length: 5 }, (_, i) => ({ worldId: `world${i + 1}`,
    foreignEnvironmentWorldId: `world${(i + 1) % 5 + 1}`,
    checkpointHashes: [100_000, 500_000, 900_000].map((step) => ({ step,
      sha256: `cp-world${i + 1}-${step}` })),
    donorEarly: { status: "available", founderWords: [0, 1, 11] },
    donorLate: { status: "available", founderWords: [0, 1, 11] } }));
  const envs = sources.flatMap((s, i) => environments.map((slot, j) => {
    const [origin, time] = slot === "standardized" ? ["standardized", "standardized"] : slot.split("/");
    const environmentWorldId = origin === "foreign" ? sources[(i + 1) % 5].worldId :
      origin === "standardized" ? "standardized" : s.worldId;
    return { id: `${s.worldId}/${slot}`, donorWorldId: s.worldId, origin, time,
      environmentWorldId, assaySeed: FIRST_COMPETITION_SEED + 20 + 5 * i + j,
      poolStateHash: `pool-${s.worldId}-${slot}`,
      sourceCheckpointSha256: origin === "standardized" ? null :
        `cp-${environmentWorldId}-${time === "early" ? 100_000 : 900_000}`,
      poolAudit: origin === "standardized" ? null : { after: { matter: "100", energy: "200" } },
      poolInventory: { matter: "100", energy: "200" } };
  }));
  const runs: RunPlan[] = [];
  const audit = (beforeStateHash: string, afterStateHash: string, beforeMatter: string,
    beforeEnergy: string, afterMatter: string, afterEnergy: string) => ({
      beforeStateHash, afterStateHash, before: { matter: beforeMatter, energy: beforeEnergy },
      after: { matter: afterMatter, energy: afterEnergy }, ledgerUnchanged: true }) as never;
  const add = (row: Partial<RunPlan>) => {
    const env = envs.find((e) => e.id === row.environmentId);
    const path = env ? [audit(env.poolStateHash, `middle-${row.id}`, "100", "200", "150", "250"),
      audit(`middle-${row.id}`, row.initialPhysicsHash!, "150", "250", "200", "300")] :
      [audit(`solo-pool-${row.worldId}`, row.initialPhysicsHash!, "100", "200", "200", "300")];
    runs.push({ ordinal: runs.length, id: row.id!, kind: row.kind!,
    worldId: row.worldId!, environmentId: row.environmentId ?? null, genotype: row.genotype ?? null,
    earlySide: row.earlySide ?? null, seed: row.seed!, initialPhysicsHash: row.initialPhysicsHash!,
    initialEarlyB: "100", initialLateB: row.kind === "solo-control" ? "0" : "100",
    initialMatter: "200", initialEnergy: "300", transplantAudits: path, status: "planned" });
  };
  sources.forEach((s, i) => kinds.forEach((g) => add({ id: `${s.worldId}/solo/${g}`,
    kind: "solo-control", worldId: s.worldId, genotype: g, seed: FIRST_COMPETITION_SEED + i,
    initialPhysicsHash: g.endsWith("founder") ? `founder-${i}` : `donor-${i}-${g}` })));
  envs.forEach((e, i) => (["left", "right"] as const).forEach((side) => add({
    id: `${e.id}/${side}`, kind: "reciprocal-competition", worldId: e.donorWorldId,
    environmentId: e.id, earlySide: side, seed: e.assaySeed, initialPhysicsHash: `${e.id}-${side}` })));
  const plan = { format: 1, status: "planned", postExecutionRevalidated: false,
    execution: { requested: false, runCount: 70, controlCount: 20, competitionCount: 50,
      claim: "equal-frequency-genotype-only-feasibility", contrast: "contrast" },
    codeFilesBefore: { file: digest }, codeFilesAfter: { file: digest },
    inputsFile: digest, ruleFile: digest, rule: {}, sources, environments: envs, runs,
    sourceCodeRevision: "revision", codeHashScope: "selected" } as unknown as CompetitionManifest;
  const batches = Array.from({ length: 9 }, (_, batchIndex) => {
    const from = batchIndex * 8;
    const rows = structuredClone(runs);
    for (let i = 0; i < rows.length; i++) {
      if (i < from || i >= from + 8) { rows[i].status = "not-run-batch"; continue; }
      rows[i].status = "complete";
      rows[i].points = Array.from({ length: 30 }, (_, j) => ({ step: (j + 1) * 100,
        earlyB: "100", lateB: rows[i].kind === "solo-control" ? "0" : "100",
        matterResidual: "0", energyResidual: "0", conservationOk: true, mutations: 0,
        minChebyshevDistance: null, adjacent: false, kernelHalosOverlap: false, kernelRadius: 9 }));
      rows[i].outcome = { finalPhysicsHash: `physics-${i % 2}`, finalArtifactHash: `artifact-${i % 2}`,
        wallSeconds: i, finalEarlyB: "100", finalLateB: rows[i].kind === "solo-control" ? "0" : "100",
        survived: true, anyKernelHaloOpportunity: false, anyAdjacency: false,
        relativeGrowth: rows[i].kind === "solo-control" ? null : { survival: "both", logRelativeGrowth: 0 } };
      if (rows[i].kind === "solo-control") rows[i].gardenLifeTrace = life() as never;
    }
    return { ...structuredClone(plan), status: "partial", postExecutionRevalidated: true,
      execution: { ...plan.execution, requested: true, runOffset: from, maxRuns: 8 },
      runtime: { endedAt: "done", overrun: false, adapter: { vendor: "test" } },
      runs: rows } as CompetitionManifest;
  });
  return { plan, batches };
}

describe("fixed-plan competition analysis", () => {
  it("reports five independent source histories, zero-variance traces, and identical founder repeats", () => {
    const { plan, batches } = fixture();
    const result = analyzeCompetition(plan, batches);
    expect(result).toMatchObject({ completeRunCount: 70, unavailableRunCount: 0, sourceHistoryCount: 5 });
    expect(result.descriptiveRanges["own-early"]).toEqual({ availableHistories: 5, min: 0, max: 0 });
    expect(result.histories.every((h) => h.technicalFounderRepeat === "verified-identical")).toBe(true);
    expect(result.histories[0].solos[0].lifecycle).toMatchObject({
      scope: "one-solo-common-garden-observer-traceability",
      denominators: { baselineLeftTruncated: 1, rawThreeIdentityChains: 0 } });
    expect(result.histories[0].earlyLatePairs.find((p) => p.origin === "foreign")?.exposureLimited).toBe(true);
  });

  it("rejects missing, overlapping, unverified and conflicting batch evidence", () => {
    const { plan, batches } = fixture();
    expect(() => analyzeCompetition(plan, batches.slice(0, 8))).toThrow(/missing completed evidence/);
    expect(() => analyzeCompetition(plan, [...batches, batches[0]])).toThrow(/overlapping completed evidence/);
    const unverified = structuredClone(batches);
    unverified[0].postExecutionRevalidated = false;
    expect(() => analyzeCompetition(plan, unverified)).toThrow(/post-execution/);
    const conflict = structuredClone(batches);
    conflict[0].runs[0].initialPhysicsHash = "foreign-start";
    expect(() => analyzeCompetition(plan, conflict)).toThrow(/identity or transplant audit differs/);
  });

  it("allows runtime variation in identical founders but rejects biological divergence", () => {
    const { plan, batches } = fixture();
    const mismatch = structuredClone(batches);
    mismatch[0].runs[3].outcome!.finalPhysicsHash = "different";
    expect(() => analyzeCompetition(plan, mismatch)).toThrow(/identical founder controls diverged/);
  });

  it("retains an unavailable early donor and its dependent arms in the five-history denominator", () => {
    const { plan, batches } = fixture();
    const source = plan.sources[0];
    source.donorEarly = { status: "unavailable", epoch: "early", step: 100_000,
      reason: "frozen catalog had no selected component" } as never;
    const unavailable = new Set(plan.runs.filter((r) => r.worldId === source.worldId &&
      (r.genotype === "early" || r.genotype === "early-founder" || r.kind === "reciprocal-competition"))
      .map((r) => r.ordinal));
    for (const row of plan.runs) if (unavailable.has(row.ordinal)) {
      row.status = "not-run-unavailable";
      row.unavailableReason = "early: frozen catalog had no selected component";
    }
    for (const batch of batches) {
      batch.sources = structuredClone(plan.sources);
      for (const row of batch.runs) if (unavailable.has(row.ordinal)) {
        row.status = "not-run-unavailable";
        row.unavailableReason = "early: frozen catalog had no selected component";
        delete row.points;
        delete row.outcome;
        delete row.gardenLifeTrace;
      }
    }
    const result = analyzeCompetition(plan, batches);
    expect(result).toMatchObject({ completeRunCount: 58, unavailableRunCount: 12,
      sourceHistoryCount: 5 });
    expect(result.histories[0]).toMatchObject({ donorAvailability: { early: "unavailable", late: "available" },
      matchedSolo: { earlyDonorMinusOwnFounder: null } });
    expect(result.histories[0].earlyLatePairs.every((p) => p.status === "unavailable")).toBe(true);
    expect(result.descriptiveRanges["own-early"].availableHistories).toBe(4);
  });

  it("rejects malformed five-source environment graphs even when totals and batch copies agree", () => {
    const moved = fixture();
    [moved.plan.environments[0], moved.plan.environments[5]] =
      [moved.plan.environments[5], moved.plan.environments[0]];
    moved.batches.forEach((b) => { b.environments = structuredClone(moved.plan.environments); });
    expect(() => analyzeCompetition(moved.plan, moved.batches)).toThrow(/environment slot/);

    const duplicateCategory = fixture();
    duplicateCategory.plan.environments[1].origin = "own";
    duplicateCategory.plan.environments[1].time = "early";
    duplicateCategory.batches.forEach((b) => { b.environments = structuredClone(duplicateCategory.plan.environments); });
    expect(() => analyzeCompetition(duplicateCategory.plan, duplicateCategory.batches))
      .toThrow(/environment slot/);

    const wrongForeign = fixture();
    wrongForeign.plan.environments[2].environmentWorldId = "world4";
    wrongForeign.batches.forEach((b) => { b.environments = structuredClone(wrongForeign.plan.environments); });
    expect(() => analyzeCompetition(wrongForeign.plan, wrongForeign.batches)).toThrow(/environment slot/);

    const brokenCycle = fixture();
    brokenCycle.plan.sources[0].foreignEnvironmentWorldId = "world4";
    brokenCycle.batches.forEach((b) => { b.sources = structuredClone(brokenCycle.plan.sources); });
    expect(() => analyzeCompetition(brokenCycle.plan, brokenCycle.batches)).toThrow(/foreign five-cycle/);

    const wrongArm = fixture();
    wrongArm.plan.runs[20].worldId = "world3";
    wrongArm.batches.forEach((b) => { b.runs[20].worldId = "world3"; });
    expect(() => analyzeCompetition(wrongArm.plan, wrongArm.batches)).toThrow(/wrong-donor/);

    const wrongPool = fixture();
    wrongPool.plan.runs[20].transplantAudits![0].beforeStateHash = "foreign-pool";
    wrongPool.batches.forEach((b) => { b.runs[20].transplantAudits![0].beforeStateHash = "foreign-pool"; });
    expect(() => analyzeCompetition(wrongPool.plan, wrongPool.batches)).toThrow(/wrong environment pool/);

    const wrongSeed = fixture();
    wrongSeed.plan.environments[0].assaySeed++;
    wrongSeed.batches.forEach((b) => { b.environments = structuredClone(wrongSeed.plan.environments); });
    expect(() => analyzeCompetition(wrongSeed.plan, wrongSeed.batches)).toThrow(/environment slot/);
  });
});
