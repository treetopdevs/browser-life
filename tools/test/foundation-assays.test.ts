import { describe, expect, it } from "vitest";
import {
  assessFoundationAssay,
  type CompetitionArm,
  type FoundationBase,
  type FrozenSource,
  type TimeShiftCompetitionPlan,
  type LifeCycleHeredityPlan,
} from "../lib/foundation-assays.ts";

const sources = (): FrozenSource[] => Array.from({ length: 5 }, (_, i) => ({
  worldId: `world-${i}`, independenceUnit: `unit-${i}`, runId: `run-${i}`,
  bundleDigest: `bundle-${i}`, codeRevision: "c362d92a", codeDigest: "code-digest",
  ruleVersion: 3, schemaVersion: 3, metricsVersion: 2, sourceSeed: i + 1,
  finalStep: 1_000_000, finalHash: `final-${i}`, finalHashMode: "artifact",
  snapshots: Object.fromEntries((["early", "middle", "late"] as const).map((epoch, j) => [epoch, {
    step: [100_000, 500_000, 900_000][j], method: "replay", fileOrCacheKey: `cache-${i}-${j}`,
    stateHash: `state-${i}-${j}`, artifactDigest: `artifact-${i}-${j}`, validated: true,
  }])) as FrozenSource["snapshots"],
}));

const base = (assaySeeds: number[]): FoundationBase => ({
  phase: "feasibility", frozenCodeRevision: "c362d92a", frozenCodeDigest: "code-digest",
  protocolDigest: "protocol-digest", sources: sources(), assaySeeds,
});

function arms(seed: number, start: "rare-invader" | "equal-frequency"): CompetitionArm[] {
  return (["early", "late"] as const).flatMap((focal, fi) => (["left", "right"] as const).map((earlySide, side) => {
    const fraction = start === "equal-frequency" ? 0.5 : focal === "early" ? 0.1 : 0.9;
    return {
      focal, earlySide, assaySeed: seed + fi * 2 + side,
      early: { biomass: fraction * 100, energy: fraction * 200 },
      late: { biomass: (1 - fraction) * 100, energy: (1 - fraction) * 200 },
    };
  }));
}

function competition(): TimeShiftCompetitionPlan {
  let seed = 630000001;
  const blocks = sources().flatMap((s, i) => (["own", "foreign", "common-garden"] as const).flatMap((environment) =>
    (environment === "common-garden" ? ["standardized"] as const : ["early", "late"] as const).flatMap((environmentTime) =>
    (["rare-invader", "equal-frequency"] as const).map((start) => {
      const block = {
        worldId: s.worldId, environment, environmentWorldId: environment === "own" ? s.worldId : environment === "foreign" ? `world-${(i + 1) % 5}` : "standardized",
        environmentTime, poolDigest: `pool-${i}-${environment}-${environmentTime}`,
        environmentSourceArtifactDigest: environment === "common-garden" ? "standardized-pool-source" :
          `artifact-${environment === "own" ? i : (i + 1) % 5}-${environmentTime === "early" ? 0 : 2}`,
        residentTreatment: "none" as const, startingPoolMatter: 1000, startingPoolEnergy: 2000,
        extractionControlId: `extraction-${i}`, extractionControlViable: true, start, arms: arms(seed, start),
      };
      seed += 4;
      return block;
    }))));
  return { ...base(Array.from({ length: 200 }, (_, i) => 630000001 + i)), kind: "time-shift-competition", blocks, outcomeHorizonSteps: 10_000 };
}

function lifecycle(): LifeCycleHeredityPlan {
  const gardens = sources().flatMap((s, i) => (["own", "foreign"] as const).flatMap((environment) => (["left", "right"] as const).map((side, j) => ({
    id: `garden-${i}-${environment}-${side}`, worldId: s.worldId, environment,
    environmentWorldId: environment === "own" ? s.worldId : `world-${(i + 1) % 5}`,
    side, assaySeed: 640000001 + i * 4 + (environment === "own" ? 0 : 2) + j,
    startingMatter: 1000, startingEnergy: 2000, poolDigest: `pool-${i}-${environment}`,
    residentTreatment: "none" as const, extractionControlId: `control-${i}`, extractionControlViable: true,
  }))));
  return {
    ...base(Array.from({ length: 20 }, (_, i) => 640000001 + i)), kind: "life-cycle-heredity", traitDefinition: "birth mu at age 100",
    matchedAgeTolerance: 10, sizeAdjustment: "within-world mass-adjusted residual",
    censoringPolicy: "exclude-right-censored", fusionPolicy: "exclude",
    gardens,
    sourceOutcomes: sources().map((s) => ({ worldId: s.worldId, status: "observed-chain", reason: "" })),
    records: sources().flatMap((s, i) => ([0, 1] as const).map((generation) => ({
      worldId: s.worldId, parentId: 10 + i + generation * 10, childId: 20 + i + generation * 10,
      parentGeneration: generation, childGeneration: generation + 1,
      birthStep: 200_000 + generation * 1000, observationStep: 200_100 + generation * 1000,
      parentAge: 100, childAge: 100, parentMass: 50, childMass: 50,
      parentTrait: 60, childTrait: 61, environmentBlockId: `garden-${i}-own-left`,
      censoring: "none", fusion: "none",
    }))),
  };
}

describe("foundation assay dry-run validation", () => {
  it("accepts a complete feasibility matrix while retaining world-level replication", () => {
    const result = assessFoundationAssay(competition());
    expect(result).toMatchObject({ designComplete: true, executionReady: false, runtimeVerified: false, scope: "feasibility-only", independentWorlds: 5, nestedObservations: 200, blockers: [] });
  });

  it("blocks missing provenance, extraction controls, resource matching and reciprocal placement", () => {
    const plan = competition();
    plan.sources[0].snapshots.middle.validated = false;
    plan.sources[1].bundleDigest = "";
    plan.blocks[0].extractionControlViable = false;
    plan.blocks[0].arms[0].early.energy = 1;
    plan.blocks[0].arms.pop();
    const messages = assessFoundationAssay(plan).blockers.join("\n");
    expect(messages).toMatch(/validated state and artifact digests/);
    expect(messages).toMatch(/source bundle\/final hash or explicit hash mode missing/);
    expect(messages).toMatch(/extraction\/transplant control missing/);
    expect(messages).toMatch(/equal total biomass and energy/);
    expect(messages).toMatch(/reciprocal left\/right placement/);
  });

  it("reports an incomplete inoculum instead of throwing or authorizing execution", () => {
    const plan = competition();
    plan.blocks[0].arms[0].early = undefined as unknown as CompetitionArm["early"];
    const result = assessFoundationAssay(plan);
    expect(result).toMatchObject({ designComplete: false, executionReady: false, runtimeVerified: false });
    expect(result.blockers.join(" ")).toMatch(/missing inoculum biomass\/energy/);
  });

  it("does not count related rings, tiles or repeated observations as independent worlds", () => {
    const plan = competition();
    plan.sources[1].migrationRingId = "ring-A";
    plan.sources[2].migrationRingId = "ring-A";
    const result = assessFoundationAssay(plan);
    expect(result.executionReady).toBe(false);
    expect(result.independentWorlds).toBe(4);
    expect(result.nestedObservations).toBe(200);
    expect(result.blockers.join(" ")).toMatch(/independence unit or migrating ring/);
  });

  it("requires independent assay RNG and a complete own/foreign by start matrix", () => {
    const plan = competition();
    plan.assaySeeds[0] = 1;
    plan.blocks.pop();
    const result = assessFoundationAssay(plan);
    expect(result.executionReady).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/fresh and reserved/);
    expect(result.blockers.join(" ")).toMatch(/missing common-garden\/equal-frequency/);
  });

  it("rejects an all-middle design even when origin, start and placement are filled", () => {
    const plan = competition();
    for (const block of plan.blocks) block.environmentTime = "standardized";
    const result = assessFoundationAssay(plan);
    expect(result.designComplete).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/missing own\/early/);
    expect(result.blockers.join(" ")).toMatch(/environment origin and time assignment/);
  });

  it("checks parent identity, generation, age, environment and censoring at the world level", () => {
    const plan = lifecycle();
    expect(assessFoundationAssay(plan)).toMatchObject({ designComplete: true, executionReady: false, independentWorlds: 5, nestedObservations: 10 });
    plan.records[0].childGeneration = 2;
    plan.records[2].parentId = plan.records[2].childId;
    plan.records[4].environmentBlockId = "";
    plan.records[6].censoring = undefined as unknown as "none";
    plan.records[8].childAge = 400;
    const result = assessFoundationAssay(plan);
    expect(result.executionReady).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/parent identity/);
    expect(result.blockers.join(" ")).toMatch(/three generations/);
    expect(result.blockers.join(" ")).toMatch(/shared-environment/);
    expect(result.blockers.join(" ")).toMatch(/censoring status/);
    expect(result.blockers.join(" ")).toMatch(/matched observation age/);
  });

  it("does not accept a lone 2-to-3 pair as three observed generations", () => {
    const plan = lifecycle();
    plan.records = plan.records.filter((r) => r.parentGeneration === 1).map((r) => ({ ...r, parentGeneration: 2, childGeneration: 3 }));
    const result = assessFoundationAssay(plan);
    expect(result.designComplete).toBe(false);
    expect(result.blockers.filter((b) => b.includes("three generations"))).toHaveLength(5);
  });

  it("retains failed source worlds and blocks unequal garden resources", () => {
    const plan = lifecycle();
    plan.sourceOutcomes[0] = { worldId: "world-0", status: "no-chain", reason: "no linked descendants" };
    plan.records = plan.records.filter((r) => r.worldId !== "world-0");
    plan.gardens[0].startingEnergy = 1999;
    const result = assessFoundationAssay(plan);
    expect(result.independentWorlds).toBe(5);
    expect(result.designComplete).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/garden resources are not matched/);
    plan.gardens[0].startingEnergy = 2000;
    expect(assessFoundationAssay(plan)).toMatchObject({ designComplete: true, executionReady: false, independentWorlds: 5 });
  });
});
