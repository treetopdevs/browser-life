/** CPU-only aggregation of a fixed competition plan and authenticated execution batches. */
import { FIRST_COMPETITION_SEED, relativeGrowthContrast } from "./foundation-competition.ts";
import { analyzeLifecycle, type LifecycleAnalysis } from "./foundation-lifecycle.ts";
import { validateReusablePriorBatch, type CompetitionManifest, type RunPlan } from "../foundation-competition.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const rowIdentity = (r: RunPlan) => ({ ordinal: r.ordinal, id: r.id, kind: r.kind, worldId: r.worldId,
  environmentId: r.environmentId, genotype: r.genotype, earlySide: r.earlySide, seed: r.seed,
  initialPhysicsHash: r.initialPhysicsHash, initialEarlyB: r.initialEarlyB, initialLateB: r.initialLateB,
  initialMatter: r.initialMatter, initialEnergy: r.initialEnergy, initialContact: r.initialContact,
  transplantAudits: r.transplantAudits, unavailableReason: r.unavailableReason });
const numberRange = (values: (number | null)[]) => {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return { availableHistories: finite.length, min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null };
};

export interface GardenLifecycleAnalysis extends Omit<LifecycleAnalysis, "scope" | "limitations"> {
  scope: "one-solo-common-garden-observer-traceability";
  limitations: string[];
}
export interface SoloAnalysis {
  runId: string; genotype: "early" | "late" | "early-founder" | "late-founder";
  status: "complete" | "unavailable"; reason: string | null;
  initialB: string | null; finalB: string | null; survived: boolean | null;
  logBiomassGrowth: number | null; lifecycle: GardenLifecycleAnalysis | null;
}
export interface PairAnalysis {
  environmentId: string; origin: "own" | "foreign" | "standardized";
  time: "early" | "late" | "standardized"; environmentWorldId: string;
  status: "complete" | "unavailable"; reason: string | null;
  left: { survival: string; logRelativeGrowth: number | null; sampledHaloOpportunity: boolean;
    sampledAdjacency: boolean } | null;
  right: { survival: string; logRelativeGrowth: number | null; sampledHaloOpportunity: boolean;
    sampledAdjacency: boolean } | null;
  meanLogRelativeGrowth: number | null; exposureLimited: boolean | null;
}
export interface HistoryAnalysis {
  worldId: string; donorAvailability: { early: string; late: string };
  solos: SoloAnalysis[];
  matchedSolo: { earlyDonorMinusOwnFounder: number | null; lateDonorMinusOwnFounder: number | null;
    earlySurvival: [boolean | null, boolean | null]; lateSurvival: [boolean | null, boolean | null] };
  earlyLatePairs: PairAnalysis[];
  technicalFounderRepeat: "verified-identical" | "different-founders-or-starts" | "unavailable";
}
export interface CompetitionAnalysis {
  format: 1; scope: "five-source-genotype-only-feasibility";
  completeRunCount: number; unavailableRunCount: number; sourceHistoryCount: 5;
  histories: HistoryAnalysis[];
  descriptiveRanges: Record<string, { availableHistories: number; min: number | null; max: number | null }>;
  limitations: string[];
}

function validateCompletedRun(run: RunPlan): void {
  assert(run.status === "complete" && run.outcome && run.points?.length === 30,
    `run ${run.id} lacks complete observations`);
  assert(run.initialEarlyB && BigInt(run.initialEarlyB) > 0n && run.initialLateB !== undefined,
    `run ${run.id} lacks positive initial biomass`);
  for (let i = 0; i < 30; i++) {
    const p = run.points[i];
    assert(p.step === (i + 1) * 100 && p.conservationOk && p.mutations === 0 &&
      p.matterResidual === "0" && p.energyResidual === "0",
    `run ${run.id} has invalid census ${i + 1}`);
    assert(BigInt(p.earlyB) >= 0n && BigInt(p.lateB) >= 0n,
      `run ${run.id} has invalid biomass at ${p.step}`);
  }
  const end = run.points[29];
  assert(run.outcome.finalEarlyB === end.earlyB && run.outcome.finalLateB === end.lateB &&
    run.outcome.survived === (BigInt(end.earlyB) > 0n || BigInt(end.lateB) > 0n),
  `run ${run.id} final observation differs from outcome`);
  assert(run.outcome.anyKernelHaloOpportunity === run.points.some((p) => p.kernelHalosOverlap) &&
    run.outcome.anyAdjacency === run.points.some((p) => p.adjacent),
  `run ${run.id} exposure summary differs from censuses`);
  if (run.kind === "reciprocal-competition") {
    assert(BigInt(run.initialLateB) > 0n && run.outcome.relativeGrowth,
      `competition ${run.id} lacks two initial genotypes`);
    const growth = relativeGrowthContrast(BigInt(run.initialEarlyB), BigInt(run.initialLateB),
      BigInt(end.earlyB), BigInt(end.lateB));
    assert(same(growth, run.outcome.relativeGrowth), `competition ${run.id} growth contrast differs from biomass`);
    assert(!run.gardenLifeTrace, `competition ${run.id} has an unexpected solo trace`);
  } else {
    assert(run.initialLateB === "0" && end.lateB === "0" && run.outcome.relativeGrowth === null,
      `solo ${run.id} has unexpected late-lineage biomass or contrast`);
    const trace = run.gardenLifeTrace;
    assert(trace?.status === "complete" && trace.scope === "one-solo-garden-in-situ-observer-trace" &&
      trace.lastCapturedStep === 3000 && trace.analysis === null &&
      trace.window.startStep === 100 && trace.window.endStep === 3000 &&
      trace.window.censusDigests.length === 30 && trace.unreconciledEvents.length === 0,
    `solo ${run.id} lacks complete joined lifecycle capture`);
    for (let i = 0; i < 30; i++)
      assert(trace.window.censusDigests[i].step === (i + 1) * 100 &&
        /^[0-9a-f]{64}$/.test(trace.window.censusDigests[i].labelsSha256),
      `solo ${run.id} has invalid census-label digest`);
  }
}

function gardenLifecycle(run: RunPlan): GardenLifecycleAnalysis {
  const original = analyzeLifecycle(run.gardenLifeTrace!.window, run.id);
  const { scope: _sourceScope, limitations: sourceLimitations, ...rows } = original;
  return { ...rows, scope: "one-solo-common-garden-observer-traceability",
    limitations: [
      ...sourceLimitations.filter((s) => !s.includes("common gardens remain necessary")),
      "This single-genotype, standardized physical garden shares its chemical pool; observer-identity chains are not serial-transfer life cycles.",
      "Equal inocula and mutation-off controls do not establish genetic heritability or structural transmission.",
      "Source histories, not component families or repeated technical controls, are the evolutionary units.",
    ] };
}

const ENVIRONMENT_SLOTS = [
  { suffix: "own/early", origin: "own", time: "early" },
  { suffix: "own/late", origin: "own", time: "late" },
  { suffix: "foreign/early", origin: "foreign", time: "early" },
  { suffix: "foreign/late", origin: "foreign", time: "late" },
  { suffix: "standardized", origin: "standardized", time: "standardized" },
] as const;
const SOLO_SLOTS = ["early", "early-founder", "late", "late-founder"] as const;

function validateAuditPath(run: RunPlan, expectedCount: 1 | 2, poolHash?: string,
  poolInventory?: { matter: string; energy: string }): void {
  if (run.status === "not-run-unavailable") return;
  const audits = run.transplantAudits;
  assert(audits?.length === expectedCount && audits.every((audit) => audit.ledgerUnchanged),
    `run ${run.id} has missing or invalid transplant audits`);
  if (poolHash) assert(audits[0].beforeStateHash === poolHash &&
    audits[0].before.matter === poolInventory?.matter && audits[0].before.energy === poolInventory?.energy,
  `run ${run.id} starts from the wrong environment pool`);
  for (let i = 1; i < audits.length; i++)
    assert(audits[i - 1].afterStateHash === audits[i].beforeStateHash,
      `run ${run.id} transplant audit chain is broken`);
  const last = audits.at(-1)!;
  assert(last.afterStateHash === run.initialPhysicsHash &&
    last.after.matter === run.initialMatter && last.after.energy === run.initialEnergy,
  `run ${run.id} start state/resources differ from transplant audit`);
}

/** The global row counts alone cannot authenticate the donor-environment graph. */
function validateFixedMatrix(plan: CompetitionManifest): void {
  const sources = plan.sources;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i], worldId = source.worldId, foreign = sources[(i + 1) % sources.length];
    assert(source.foreignEnvironmentWorldId === foreign.worldId,
      `source ${worldId} breaks the registered foreign five-cycle`);
    for (let j = 0; j < SOLO_SLOTS.length; j++) {
      const genotype = SOLO_SLOTS[j], run = plan.runs[4 * i + j];
      const unavailable = (j < 2 ? source.donorEarly : source.donorLate).status === "unavailable";
      assert(run.id === `${worldId}/solo/${genotype}` && run.kind === "solo-control" &&
        run.worldId === worldId && run.genotype === genotype && run.environmentId === null &&
        run.earlySide === null && run.seed === FIRST_COMPETITION_SEED + i &&
        run.status === (unavailable ? "not-run-unavailable" : "planned"),
      `source ${worldId} has a missing, moved or wrong-seed solo slot ${genotype}`);
      validateAuditPath(run, 1);
    }
    for (let j = 0; j < ENVIRONMENT_SLOTS.length; j++) {
      const slot = ENVIRONMENT_SLOTS[j], env = plan.environments[5 * i + j];
      const environmentSource = slot.origin === "foreign" ? foreign : source;
      const expectedWorld = slot.origin === "standardized" ? "standardized" : environmentSource.worldId;
      const step = slot.time === "early" ? 100_000 : 900_000;
      const expectedCheckpoint = slot.origin === "standardized" ? null :
        environmentSource.checkpointHashes.find((cp) => cp.step === step)?.sha256;
      assert(env.id === `${worldId}/${slot.suffix}` && env.donorWorldId === worldId &&
        env.origin === slot.origin && env.time === slot.time &&
        env.environmentWorldId === expectedWorld &&
        env.assaySeed === FIRST_COMPETITION_SEED + 20 + 5 * i + j &&
        expectedCheckpoint !== undefined && env.sourceCheckpointSha256 === expectedCheckpoint &&
        (slot.origin === "standardized" ? env.poolAudit === null :
          !!env.poolAudit && env.poolInventory.matter === env.poolAudit.after.matter &&
            env.poolInventory.energy === env.poolAudit.after.energy),
      `source ${worldId} has a missing, moved or invalid environment slot ${slot.suffix}`);
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex === 0 ? "left" : "right";
        const run = plan.runs[20 + 2 * (5 * i + j) + sideIndex];
        const unavailable = source.donorEarly.status === "unavailable" || source.donorLate.status === "unavailable";
        assert(run.id === `${env.id}/${side}` && run.kind === "reciprocal-competition" &&
          run.worldId === worldId && run.environmentId === env.id && run.genotype === null &&
          run.earlySide === side && run.seed === env.assaySeed &&
          run.status === (unavailable ? "not-run-unavailable" : "planned"),
        `environment ${env.id} has a missing, moved or wrong-donor ${side} arm`);
        validateAuditPath(run, 2, env.poolStateHash, env.poolInventory);
      }
    }
  }
}

/** Requires the full registered matrix; absence is never converted to a negative outcome. */
export function analyzeCompetition(plan: CompetitionManifest, batches: CompetitionManifest[]): CompetitionAnalysis {
  assert(plan.format === 1 && plan.status === "planned" && plan.execution.requested === false &&
    plan.postExecutionRevalidated === false && same(plan.codeFilesAfter, plan.codeFilesBefore),
  "fixed CPU-only competition plan is missing or altered");
  assert(plan.sources?.length === 5 && plan.environments?.length === 25 && plan.runs?.length === 70 &&
    plan.runs.filter((r) => r.kind === "solo-control").length === 20 &&
    plan.runs.filter((r) => r.kind === "reciprocal-competition").length === 50 &&
    plan.execution.runCount === 70 && plan.execution.controlCount === 20 && plan.execution.competitionCount === 50,
  "competition plan matrix is incomplete");
  const worldIds = plan.sources.map((s) => s.worldId);
  assert(new Set(worldIds).size === 5 && plan.runs.every((r, i) => r.ordinal === i && worldIds.includes(r.worldId)),
    "plan has duplicate worlds or invalid run ordinals");
  assert(new Set(plan.runs.map((r) => r.id)).size === 70 &&
    new Set(plan.environments.map((e) => e.id)).size === 25,
  "plan has duplicate run or environment IDs");
  validateFixedMatrix(plan);
  assert(batches.length > 0, "execution batch evidence is missing");
  const completed = new Map<number, RunPlan>();
  for (const batch of batches) {
    validateReusablePriorBatch(batch, plan);
    assert(batch.sourceCodeRevision === plan.sourceCodeRevision && batch.codeHashScope === plan.codeHashScope &&
      same(batch.rule, plan.rule) && same(batch.execution.claim, plan.execution.claim) &&
      same(batch.execution.contrast, plan.execution.contrast) &&
      batch.execution.runCount === 70 && batch.execution.controlCount === 20 &&
      batch.execution.competitionCount === 50,
    "batch scientific protocol or source revision differs from fixed plan");
    const from = batch.execution.runOffset, count = batch.execution.maxRuns;
    assert(Number.isSafeInteger(from) && count !== null && Number.isSafeInteger(count) &&
      from >= 0 && count > 0 && count <= 8 && from < 70,
    "batch execution range is invalid");
    for (let i = 0; i < 70; i++) {
      const actual = batch.runs[i], expected = plan.runs[i];
      assert(same(rowIdentity(actual), rowIdentity(expected)), `batch row ${i} differs from frozen plan`);
      if (expected.status === "not-run-unavailable") {
        assert(actual.status === "not-run-unavailable", `unavailable run ${i} was fabricated`);
        continue;
      }
      assert(expected.status === "planned", `fixed plan run ${i} has invalid status`);
      assert(actual.status === "complete" || actual.status === "not-run-batch",
        `batch run ${i} is failed, incomplete or unclassified`);
      if (actual.status === "complete") {
        assert(i >= from && i < Math.min(70, from + count),
          `batch completed run ${i} outside its reserved range`);
        assert(!completed.has(i), `overlapping completed evidence for run ${i}`);
        validateCompletedRun(actual);
        completed.set(i, actual);
      }
    }
  }
  const unavailable = plan.runs.filter((r) => r.status === "not-run-unavailable").length;
  assert(completed.size + unavailable === 70, `missing completed evidence for ${70 - unavailable - completed.size} available runs`);

  const histories: HistoryAnalysis[] = plan.sources.map((source) => {
    const solos = (["early", "early-founder", "late", "late-founder"] as const).map((genotype): SoloAnalysis => {
      const reference = plan.runs.find((r) => r.worldId === source.worldId && r.kind === "solo-control" &&
        r.genotype === genotype)!;
      const observed = completed.get(reference.ordinal);
      if (!observed) return { runId: reference.id, genotype, status: "unavailable",
        reason: reference.unavailableReason ?? "donor unavailable", initialB: null, finalB: null,
        survived: null, logBiomassGrowth: null, lifecycle: null };
      const start = BigInt(observed.initialEarlyB!), end = BigInt(observed.outcome!.finalEarlyB);
      return { runId: reference.id, genotype, status: "complete", reason: null,
        initialB: String(start), finalB: String(end), survived: end > 0n,
        logBiomassGrowth: end > 0n ? Math.log(Number(end) / Number(start)) : null,
        lifecycle: gardenLifecycle(observed) };
    });
    const solo = (g: SoloAnalysis["genotype"]) => solos.find((s) => s.genotype === g)!;
    const early = solo("early"), earlyFounder = solo("early-founder"), late = solo("late"),
      lateFounder = solo("late-founder");
    const paired = (a: SoloAnalysis, b: SoloAnalysis) =>
      a.logBiomassGrowth === null || b.logBiomassGrowth === null ? null :
        a.logBiomassGrowth - b.logBiomassGrowth;
    let technicalFounderRepeat: HistoryAnalysis["technicalFounderRepeat"] = "unavailable";
    if (earlyFounder.status === "complete" && lateFounder.status === "complete") {
      const a = completed.get(plan.runs.find((r) => r.id === earlyFounder.runId)!.ordinal)!;
      const b = completed.get(plan.runs.find((r) => r.id === lateFounder.runId)!.ordinal)!;
      const donorA = source.donorEarly, donorB = source.donorLate;
      assert(donorA.status === "available" && donorB.status === "available", "complete founder controls lack donors");
      const sameGenome = same(donorA.founderWords.slice(2), donorB.founderWords.slice(2));
      const sameStart = a.initialPhysicsHash === b.initialPhysicsHash && a.seed === b.seed;
      if (sameGenome !== sameStart) throw new Error(`founder genome/start identity inconsistency in ${source.worldId}`);
      if (sameGenome && sameStart) {
        const biologicalOutcome = (r: RunPlan) => {
          const { wallSeconds: _runtimeOnly, ...biology } = r.outcome!;
          return biology;
        };
        assert(same(a.points, b.points) && same(biologicalOutcome(a), biologicalOutcome(b)) &&
          same(a.gardenLifeTrace, b.gardenLifeTrace),
        `identical founder controls diverged in ${source.worldId}`);
        technicalFounderRepeat = "verified-identical";
      } else technicalFounderRepeat = "different-founders-or-starts";
    }
    const earlyLatePairs: PairAnalysis[] = plan.environments.filter((e) => e.donorWorldId === source.worldId)
      .map((env): PairAnalysis => {
        const referenceLeft = plan.runs.find((r) => r.environmentId === env.id && r.earlySide === "left")!;
        const referenceRight = plan.runs.find((r) => r.environmentId === env.id && r.earlySide === "right")!;
        const left = completed.get(referenceLeft.ordinal), right = completed.get(referenceRight.ordinal);
        if (!left || !right) {
          assert(!left && !right && referenceLeft.status === "not-run-unavailable" &&
            referenceRight.status === "not-run-unavailable", `incomplete reciprocal pair ${env.id}`);
          return { environmentId: env.id, origin: env.origin, time: env.time,
            environmentWorldId: env.environmentWorldId, status: "unavailable",
            reason: referenceLeft.unavailableReason ?? "donor unavailable", left: null, right: null,
            meanLogRelativeGrowth: null, exposureLimited: null };
        }
        const arm = (r: RunPlan) => ({ survival: r.outcome!.relativeGrowth!.survival,
          logRelativeGrowth: r.outcome!.relativeGrowth!.logRelativeGrowth,
          sampledHaloOpportunity: r.outcome!.anyKernelHaloOpportunity,
          sampledAdjacency: r.outcome!.anyAdjacency });
        const l = arm(left), r = arm(right);
        return { environmentId: env.id, origin: env.origin, time: env.time,
          environmentWorldId: env.environmentWorldId, status: "complete", reason: null,
          left: l, right: r,
          meanLogRelativeGrowth: l.logRelativeGrowth !== null && r.logRelativeGrowth !== null ?
            (l.logRelativeGrowth + r.logRelativeGrowth) / 2 : null,
          exposureLimited: !l.sampledHaloOpportunity || !r.sampledHaloOpportunity };
      });
    return { worldId: source.worldId,
      donorAvailability: { early: source.donorEarly.status, late: source.donorLate.status },
      solos, matchedSolo: { earlyDonorMinusOwnFounder: paired(early, earlyFounder),
        lateDonorMinusOwnFounder: paired(late, lateFounder),
        earlySurvival: [early.survived, earlyFounder.survived],
        lateSurvival: [late.survived, lateFounder.survived] },
      earlyLatePairs, technicalFounderRepeat };
  });
  const descriptiveRanges: CompetitionAnalysis["descriptiveRanges"] = {
    earlyDonorMinusOwnFounder: numberRange(histories.map((h) => h.matchedSolo.earlyDonorMinusOwnFounder)),
    lateDonorMinusOwnFounder: numberRange(histories.map((h) => h.matchedSolo.lateDonorMinusOwnFounder)),
  };
  for (const origin of ["own", "foreign", "standardized"] as const)
    for (const time of origin === "standardized" ? ["standardized"] as const : ["early", "late"] as const) {
      const key = `${origin}-${time}`;
      descriptiveRanges[key] = numberRange(histories.map((h) => h.earlyLatePairs.find((p) =>
        p.origin === origin && p.time === time)?.meanLogRelativeGrowth ?? null));
    }
  return { format: 1, scope: "five-source-genotype-only-feasibility",
    completeRunCount: completed.size, unavailableRunCount: unavailable, sourceHistoryCount: 5,
    histories, descriptiveRanges,
    limitations: ["Five source histories are a feasibility sample, not confirmatory evolutionary replication.",
      "Competition arms and observer families are nested within histories; the foreign cycle makes source histories dependent across environments.",
      "Contrasts measure relative biomass growth at equal starting frequency; extinction, no sampled encounter and resource differences are reported separately.",
      "No equivalence, Red Queen, genetic heritability or biological life-cycle claim follows from this descriptive aggregate."] };
}
