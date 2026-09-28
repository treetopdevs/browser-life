/** New, diagnostic M3 three-outcome cohort. The original validation protocol is immutable. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { binomialLowerBound, passesProbabilityGate, ROLES, type Role } from "@bl/metrics";
import type { EvalConfig, Evaluation } from "@bl/search";
import type { Genome } from "@bl/schema";
import { compareBehaviorTraces, type BehaviorSample } from "../../packages/search/src/foundation-behavior.ts";
import { genomeFromManifest, type EncodedGenome } from "../../packages/search/src/mutation-neighborhood.ts";
import { SCREEN_EVAL, summarizePairedRoles, summarizeTrace, type PairedRoleChange,
  type ScreenPlan, type ScreenRow, type TraceSummary } from "./foundation-screen.ts";

export const ROLE_COHORT_SALT = "foundation-m3-role-cohort-v1";
export const ROLE_COHORT_SEEDS = Array.from({ length: 32 }, (_, i) => 620060001 + i);
export const ROLE_COHORT_SMOKE_SEEDS = [620069001, 620069002, 620069003, 620069004] as const;
export const ROLE_COHORT_FIELDS = ["survived", "regenerated", "lightDependent"] as const;
type Field = typeof ROLE_COHORT_FIELDS[number];
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export interface RoleCandidate {
  id: string; kind: "role-nominee" | "identity-control"; founderIndex: number; logicalIndex: number;
  genome: EncodedGenome; parentGenome: EncodedGenome; selectionSha256: string | null;
  sourceProposalId: string | null; sourceScreenBatch: number | null; sourceScreenSeed: number | null;
  originatingProposalIds: string[]; eligibleProposalIds: string[]; originatingScales: number[];
}
export interface RoleCoverage {
  plannedProposals: number; screenedProposals: number; screenedBatches: number;
  eligibleProposalAssays: number; eligibleDistinctFounderGenotypes: number;
  byFounder: { founderIndex: number; eligibleProposalAssays: number; eligibleDistinctGenotypes: number;
    selected: number; unavailable: boolean }[];
}
export interface RoleNomination { candidates: RoleCandidate[]; coverage: RoleCoverage }
export interface RoleSlot { slot: number; panel: 0 | 1; candidateId: string; logicalIndex: number; founderIndex: number }

export function roleEligible(row: ScreenRow): boolean {
  return row.effectiveChange !== 0 && row.parentGenomeKey !== row.mutantGenomeKey &&
    row.parent.reps === 1 && row.mutant.reps === 1 &&
    ROLE_COHORT_FIELDS.every((field) => row.parent[field] === 1 && row.mutant[field] === 1) &&
    row.pairedRoleChange.pairedAvailableFrames > 0 && row.pairedRoleChange.framesWithFixedRoleShareDifference > 0;
}

function rankGenome(founderIndex: number, genome: EncodedGenome): string {
  const words = new Uint8Array(genome.words.length * 4);
  const view = new DataView(words.buffer);
  genome.words.forEach((word, index) => view.setUint32(index * 4, word, true));
  const h = createHash("sha256");
  h.update(`${ROLE_COHORT_SALT}\n${founderIndex}\n`);
  h.update(words);
  return h.digest("hex");
}

/** Caller must first verify every raw row against the frozen screen plan/report identities. */
export function nominateRoleCohort(plan: ScreenPlan, rows: readonly ScreenRow[], screenedBatches: number): RoleNomination {
  if (plan.neighborhood.founders.length !== 12 || plan.neighborhood.proposals.length !== 7200 ||
      plan.batches.length !== 113 || rows.length !== 7200 || screenedBatches !== 113 || !same(plan.evalTemplate, SCREEN_EVAL))
    throw new Error("role cohort requires the complete frozen 7200-proposal screen");
  const proposals = plan.neighborhood.proposals;
  const byId = new Map(proposals.map((p, i) => [p.id, { p, i }]));
  const observed = new Set<string>();
  for (const row of rows) {
    const source = byId.get(row.proposalId);
    if (!source || observed.has(row.proposalId) || source.p.founderIndex !== row.founderIndex ||
        source.p.genome.key !== row.mutantGenomeKey) throw new Error("duplicate or foreign screen row");
    observed.add(row.proposalId);
  }
  if (observed.size !== proposals.length) throw new Error("screen has missing proposals");
  const candidates: RoleCandidate[] = [], byFounder: RoleCoverage["byFounder"] = [];
  const eligible = rows.filter(roleEligible);
  for (const founder of plan.neighborhood.founders) {
    const local = eligible.filter((r) => r.founderIndex === founder.index);
    const groups = new Map<string, ScreenRow[]>();
    for (const row of local) groups.set(row.mutantGenomeKey, [...(groups.get(row.mutantGenomeKey) ?? []), row]);
    const ranked = [...groups].map(([key, rs]) => {
      const first = rs[0], genome = byId.get(first.proposalId)!.p.genome;
      for (const r of rs) if (!same(byId.get(r.proposalId)!.p.genome.words, genome.words))
        throw new Error("same genome key has conflicting genome bytes");
      return { key, rs, genome, rank: rankGenome(founder.index, genome) };
    }).sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
    byFounder.push({ founderIndex: founder.index, eligibleProposalAssays: local.length,
      eligibleDistinctGenotypes: groups.size, selected: Math.min(2, ranked.length), unavailable: ranked.length === 0 });
    for (const [rankIndex, selected] of ranked.slice(0, 2).entries()) {
      const eligibleIds = selected.rs.map((r) => r.proposalId).sort((a, b) => byId.get(a)!.i - byId.get(b)!.i);
      const sourceId = eligibleIds[0], representative = selected.rs.find((r) => r.proposalId === sourceId)!;
      const origins = proposals.filter((p) => p.founderIndex === founder.index && p.genome.key === selected.key);
      candidates.push({ id: `f${founder.index}-role-${rankIndex + 1}`, kind: "role-nominee", founderIndex: founder.index,
        logicalIndex: candidates.length, genome: selected.genome, parentGenome: founder.genome,
        selectionSha256: selected.rank, sourceProposalId: sourceId,
        sourceScreenBatch: plan.batches.find((b) => b.proposalIds.includes(sourceId))!.index,
        sourceScreenSeed: representative.seed, originatingProposalIds: origins.map((p) => p.id),
        eligibleProposalIds: eligibleIds, originatingScales: [...new Set(origins.map((p) => p.scale))].sort((a, b) => a - b) });
    }
  }
  for (const founder of plan.neighborhood.founders) candidates.push({ id: `f${founder.index}-identity-control`,
    kind: "identity-control", founderIndex: founder.index, logicalIndex: candidates.length,
    genome: founder.genome, parentGenome: founder.genome, selectionSha256: null,
    sourceProposalId: null, sourceScreenBatch: null, sourceScreenSeed: null,
    originatingProposalIds: [], eligibleProposalIds: [], originatingScales: [] });
  return { candidates, coverage: { plannedProposals: proposals.length, screenedProposals: rows.length,
    screenedBatches, eligibleProposalAssays: eligible.length, eligibleDistinctFounderGenotypes: groupsTotal(byFounder), byFounder } };
}
const groupsTotal = (rows: RoleCoverage["byFounder"]) => rows.reduce((n, r) => n + r.eligibleDistinctGenotypes, 0);

export function roleSlots(candidates: readonly RoleCandidate[]): RoleSlot[] {
  if (candidates.length !== 25 || candidates.some((c, i) => c.logicalIndex !== i) ||
      candidates.filter((c) => c.kind === "identity-control").length !== 12 ||
      candidates.filter((c) => c.kind === "role-nominee").length !== 13)
    throw new Error("role cohort needs 13 nominees and 12 controls in fixed logical order");
  return [0, 1].flatMap((panel) => candidates.map((c, i) => ({ slot: i + 25 * panel, panel: panel as 0 | 1,
    candidateId: c.id, logicalIndex: i, founderIndex: c.founderIndex })));
}

export interface RolePointwise { step: number; tile: number; boundMass: number; membraneFraction: number | null;
  movementCellsPer100Steps: number | null; parentMovementIntervals: number; mutantMovementIntervals: number }
export interface RoleFrameSide { availability: BehaviorSample["roles"]["availability"];
  denominatorLivingCells: number; shares: Record<Role, number> | null }
export interface RoleFrame { step: number; tile: number; parent: RoleFrameSide; mutant: RoleFrameSide }
export interface RoleSeedRow extends RoleSlot { parentGenomeKey: string; mutantGenomeKey: string;
  parent: Evaluation; mutant: Evaluation; parentTrace: TraceSummary; mutantTrace: TraceSummary;
  pairedRoleChange: PairedRoleChange; pointwise: RolePointwise[]; roleFrames: RoleFrame[];
  identityControlExact: boolean | null;
  parentFullTraceSha256: string; mutantFullTraceSha256: string }
export interface RoleSeedResult { seed: number; evalConfig: EvalConfig; rows: RoleSeedRow[];
  exactParentRepeat: { evaluated: boolean; evaluationIdentical: boolean; traceIdentical: boolean } }
export type RoleEvaluator = (genomes: Genome[], ec: EvalConfig,
  onSample: (candidateIndex: number, tile: number, sample: BehaviorSample) => void) => Promise<Evaluation[]>;

export async function executeRoleSeed(candidates: readonly RoleCandidate[], seed: number, evaluator: RoleEvaluator,
  beforeCall: (stage: "parent" | "parent-repeat" | "mutant") => void = () => {}, repeatParent = true,
  engineeringSmoke = false): Promise<RoleSeedResult> {
  if (!ROLE_COHORT_SEEDS.includes(seed) && !(engineeringSmoke && seed === ROLE_COHORT_SMOKE_SEEDS[0]))
    throw new Error("seed outside frozen role-cohort or explicit engineering smoke range");
  const slots = roleSlots(candidates), ec = { ...SCREEN_EVAL, seed };
  const measure = async (genomes: Genome[], stage: "parent" | "parent-repeat" | "mutant") => {
    beforeCall(stage);
    const traces = genomes.map(() => [] as BehaviorSample[]);
    const evals = await evaluator(genomes, ec, (k, tile, sample) => {
      if (!traces[k] || tile !== k || sample.tile !== k) throw new Error("role callback slot mismatch");
      traces[k].push(sample);
    });
    if (evals.length !== slots.length) throw new Error("role evaluator result count mismatch");
    for (let k = 0; k < slots.length; k++) {
      if (evals[k].reps !== 1 || traces[k].length !== 30 ||
          traces[k].some((s, j) => s.step !== (j + 1) * ec.censusEvery || s.phase !== "growth" || s.tile !== k))
        throw new Error(`role trace schedule mismatch at slot ${k}`);
    }
    return { evals, traces };
  };
  const parentGenomes = slots.map((s) => genomeFromManifest(candidates[s.logicalIndex].parentGenome));
  const parent = await measure(parentGenomes, "parent");
  const repeated = repeatParent ? await measure(parentGenomes, "parent-repeat") : null;
  const exactParentRepeat = { evaluated: !!repeated, evaluationIdentical: !!repeated && same(parent.evals, repeated.evals),
    traceIdentical: !!repeated && same(parent.traces, repeated.traces) };
  if (repeated && (!exactParentRepeat.evaluationIdentical || !exactParentRepeat.traceIdentical))
    throw new Error("first local role-cohort parent repeat failed");
  const mutant = await measure(slots.map((s) => genomeFromManifest(candidates[s.logicalIndex].genome)), "mutant");
  const rows = slots.map((s): RoleSeedRow => {
    const c = candidates[s.logicalIndex], k = s.slot;
    const control = c.kind === "identity-control" ?
      same(parent.evals[k], mutant.evals[k]) && same(parent.traces[k], mutant.traces[k]) : null;
    if (c.kind === "identity-control" && !control) throw new Error(`identity control differs at seed ${seed}, slot ${k}`);
    const comparisons = compareBehaviorTraces(parent.traces[k], mutant.traces[k]);
    return { ...s, parentGenomeKey: c.parentGenome.key, mutantGenomeKey: c.genome.key,
      parent: parent.evals[k], mutant: mutant.evals[k], parentTrace: summarizeTrace(parent.traces[k]),
      mutantTrace: summarizeTrace(mutant.traces[k]), pairedRoleChange: summarizePairedRoles(parent.traces[k], mutant.traces[k]),
      pointwise: comparisons.map((x, j) => ({ step: x.step, tile: x.tile, boundMass: x.boundMassDifference,
        membraneFraction: x.membraneFractionDifference, movementCellsPer100Steps: x.movementDifference,
        parentMovementIntervals: parent.traces[k][j].movement.observedIntervals,
        mutantMovementIntervals: mutant.traces[k][j].movement.observedIntervals })),
      roleFrames: parent.traces[k].map((a, j) => {
        const b = mutant.traces[k][j];
        const side = (s: BehaviorSample): RoleFrameSide => ({ availability: s.roles.availability,
          denominatorLivingCells: s.roles.denominatorLivingCells, shares: s.roles.shares });
        return { step: a.step, tile: k, parent: side(a), mutant: side(b) };
      }),
      identityControlExact: control, parentFullTraceSha256: sha(JSON.stringify(parent.traces[k])),
      mutantFullTraceSha256: sha(JSON.stringify(mutant.traces[k])) };
  });
  return { seed, evalConfig: ec, rows, exactParentRepeat };
}

export interface RolePanelAnalysis {
  candidateId: string; founderIndex: number; panel: 0 | 1; slot: number; observedSeeds: number;
  inference: null | { parentAbsoluteGates: Record<Field, { successes: number; lower95: number; passes: boolean }>;
    mutantAbsoluteGates: Record<Field, { successes: number; lower95: number; passes: boolean }>;
    allAbsoluteGatesPass: boolean; pairedByEndpoint: Record<Field, { harm: number; gain: number; harmUpper95: number | null }>;
    survivalLossWithinTenPercentagePoints: boolean | null };
  descriptive: { seedsWithRoleChange: number; pairedRoleFrames: number; changedRoleFrames: number;
    pairedRoleMissingFrames: number; meanMassDifference: number | null; meanMembraneDifference: number | null;
    meanMovementDifference: number | null; membraneAvailableFrames: number; movementAvailableFrames: number;
    parentRecovered: number; mutantRecovered: number;
    roleShareTrajectory: { step: number; pairedAvailableSeeds: number;
      parentMeanShares: Record<Role, number> | null; mutantMeanShares: Record<Role, number> | null;
      meanPairedDifferences: Record<Role, number> | null }[] };
}
export interface RoleAnalysis { status: "complete" | "incomplete"; observedSeeds: number[]; missingSeeds: number[];
  panels: RolePanelAnalysis[];
  crossPosition: { candidateId: string; founderIndex: number; observedSeeds: number;
    seedsWithRoleChangeInBoth: number; seedsWithRoleChangeInEither: number;
    seedsWithSameRoleChangePresence: number; absoluteGatePatternIdentical: boolean | null;
    bothPanelsAllAbsoluteGatesPass: boolean | null }[];
  limitations: string[] }

export function analyzeRoleCohort(candidates: readonly RoleCandidate[], results: readonly RoleSeedResult[]): RoleAnalysis {
  const slots = roleSlots(candidates), bySeed = new Map<number, RoleSeedResult>();
  for (const result of results) {
    if (!ROLE_COHORT_SEEDS.includes(result.seed) || bySeed.has(result.seed) ||
        !same(result.evalConfig, { ...SCREEN_EVAL, seed: result.seed }) || result.rows?.length !== 50)
      throw new Error("duplicate, foreign or incomplete role seed");
    if (result.exactParentRepeat?.evaluated &&
        (!result.exactParentRepeat.evaluationIdentical || !result.exactParentRepeat.traceIdentical))
      throw new Error("failed exact parent repeat in role seed");
    for (const s of slots) {
      const c = candidates[s.logicalIndex], r = result.rows[s.slot];
      const pairedFrames = r?.roleFrames?.filter((f) => f.parent.availability === "available" && f.mutant.availability === "available") ?? [];
      const changedFrames = pairedFrames.filter((f) => ROLES.reduce((distance, role) =>
        distance + Math.abs(f.mutant.shares![role] - f.parent.shares![role]), 0) / 2 > 1e-12).length;
      if (!r || !same([r.slot, r.panel, r.logicalIndex, r.candidateId, r.founderIndex],
          [s.slot, s.panel, s.logicalIndex, s.candidateId, s.founderIndex]) ||
          r.parentGenomeKey !== c.parentGenome.key || r.mutantGenomeKey !== c.genome.key ||
          r.parent?.reps !== 1 || r.mutant?.reps !== 1 ||
          (["survived", "recovered", "regenerated", "lightDependent"] as const).some((f) =>
            ![0, 1].includes(r.parent[f]) || ![0, 1].includes(r.mutant[f])) ||
          r.parentTrace?.frames !== 30 || r.mutantTrace?.frames !== 30 ||
          !Array.isArray(r.pointwise) || r.pointwise.length !== 30 ||
          r.pointwise.some((p, i) => p.step !== (i + 1) * SCREEN_EVAL.censusEvery || p.tile !== s.slot ||
            !Number.isFinite(p.boundMass) || p.membraneFraction !== null && !Number.isFinite(p.membraneFraction) ||
            p.movementCellsPer100Steps !== null && !Number.isFinite(p.movementCellsPer100Steps) ||
            !Number.isSafeInteger(p.parentMovementIntervals) || p.parentMovementIntervals < 0 ||
            !Number.isSafeInteger(p.mutantMovementIntervals) || p.mutantMovementIntervals < 0) ||
          !Array.isArray(r.roleFrames) || r.roleFrames.length !== 30 ||
          r.roleFrames.some((frame, i) => frame.step !== (i + 1) * SCREEN_EVAL.censusEvery || frame.tile !== s.slot ||
            ([frame.parent, frame.mutant] as RoleFrameSide[]).some((side) =>
              !Number.isSafeInteger(side.denominatorLivingCells) || side.denominatorLivingCells < 0 ||
              side.availability === "available" && (side.denominatorLivingCells === 0 || !side.shares ||
                ROLES.some((role) => !Number.isFinite(side.shares![role]))) ||
              side.availability !== "available" && side.shares !== null)) ||
          !r.pairedRoleChange || !Number.isSafeInteger(r.pairedRoleChange.pairedAvailableFrames) ||
          r.pairedRoleChange.pairedAvailableFrames < 0 || r.pairedRoleChange.pairedAvailableFrames > 30 ||
          !Number.isSafeInteger(r.pairedRoleChange.framesWithFixedRoleShareDifference) ||
          r.pairedRoleChange.framesWithFixedRoleShareDifference < 0 ||
          r.pairedRoleChange.framesWithFixedRoleShareDifference > r.pairedRoleChange.pairedAvailableFrames ||
          r.pairedRoleChange.pairedAvailableFrames !== pairedFrames.length ||
          r.pairedRoleChange.framesWithFixedRoleShareDifference !== changedFrames ||
          !/^[a-f0-9]{64}$/.test(r.parentFullTraceSha256) || !/^[a-f0-9]{64}$/.test(r.mutantFullTraceSha256) ||
          c.kind === "identity-control" && (r.identityControlExact !== true ||
            r.parentFullTraceSha256 !== r.mutantFullTraceSha256 ||
            !same(r.parent, r.mutant) || !same(r.parentTrace, r.mutantTrace)) ||
          c.kind === "role-nominee" && r.identityControlExact !== null)
        throw new Error(`role result identity or trace invalid at seed ${result.seed}, slot ${s.slot}`);
    }
    bySeed.set(result.seed, result);
  }
  const observedSeeds = [...bySeed.keys()].sort((a, b) => a - b), missingSeeds = ROLE_COHORT_SEEDS.filter((s) => !bySeed.has(s));
  const panels = slots.filter((s) => candidates[s.logicalIndex].kind === "role-nominee").map((s): RolePanelAnalysis => {
    const rows = observedSeeds.map((seed) => bySeed.get(seed)!.rows[s.slot]);
    const points = rows.flatMap((r) => r.pointwise);
    const membrane = points.flatMap((p) => p.membraneFraction === null ? [] : [p.membraneFraction]);
    const movement = points.flatMap((p) => p.movementCellsPer100Steps === null ? [] : [p.movementCellsPer100Steps]);
    const roleShareTrajectory = Array.from({ length: 30 }, (_, j) => {
      const paired = rows.map((r) => r.roleFrames[j]).filter((f) =>
        f.parent.availability === "available" && f.mutant.availability === "available");
      const shares = (arm: "parent" | "mutant") => paired.length ?
        Object.fromEntries(ROLES.map((role) => [role, mean(paired.map((f) => f[arm].shares![role]))])) as Record<Role, number> : null;
      const differences = paired.length ? Object.fromEntries(ROLES.map((role) =>
        [role, mean(paired.map((f) => f.mutant.shares![role] - f.parent.shares![role]))])) as Record<Role, number> : null;
      return { step: (j + 1) * SCREEN_EVAL.censusEvery, pairedAvailableSeeds: paired.length,
        parentMeanShares: shares("parent"), mutantMeanShares: shares("mutant"), meanPairedDifferences: differences };
    });
    const descriptive = { seedsWithRoleChange: rows.filter((r) => r.pairedRoleChange.framesWithFixedRoleShareDifference > 0).length,
      pairedRoleFrames: rows.reduce((n, r) => n + r.pairedRoleChange.pairedAvailableFrames, 0),
      changedRoleFrames: rows.reduce((n, r) => n + r.pairedRoleChange.framesWithFixedRoleShareDifference, 0),
      pairedRoleMissingFrames: 30 * rows.length - rows.reduce((n, r) => n + r.pairedRoleChange.pairedAvailableFrames, 0),
      meanMassDifference: mean(points.map((p) => p.boundMass)), meanMembraneDifference: mean(membrane),
      meanMovementDifference: mean(movement), membraneAvailableFrames: membrane.length,
      movementAvailableFrames: movement.length, parentRecovered: rows.reduce((n, r) => n + r.parent.recovered, 0),
      mutantRecovered: rows.reduce((n, r) => n + r.mutant.recovered, 0), roleShareTrajectory };
    if (missingSeeds.length) return { candidateId: s.candidateId, founderIndex: s.founderIndex, panel: s.panel,
      slot: s.slot, observedSeeds: rows.length, inference: null, descriptive };
    const gates = (arm: "parent" | "mutant") => Object.fromEntries(ROLE_COHORT_FIELDS.map((f) => {
      const successes = rows.reduce((n, r) => n + r[arm][f], 0);
      return [f, { successes, lower95: binomialLowerBound(successes, 32), passes: passesProbabilityGate(successes, 32, 0.8) }];
    })) as Record<Field, { successes: number; lower95: number; passes: boolean }>;
    const parentAbsoluteGates = gates("parent"), mutantAbsoluteGates = gates("mutant");
    const allAbsoluteGatesPass = [...Object.values(parentAbsoluteGates), ...Object.values(mutantAbsoluteGates)].every((g) => g.passes);
    const pairedByEndpoint = Object.fromEntries(ROLE_COHORT_FIELDS.map((f) => {
      const harm = rows.filter((r) => r.parent[f] === 1 && r.mutant[f] === 0).length;
      const gain = rows.filter((r) => r.parent[f] === 0 && r.mutant[f] === 1).length;
      return [f, { harm, gain, harmUpper95: allAbsoluteGatesPass ? 1 - binomialLowerBound(32 - harm, 32) : null }];
    })) as Record<Field, { harm: number; gain: number; harmUpper95: number | null }>;
    const survivalUpper = pairedByEndpoint.survived.harmUpper95;
    return { candidateId: s.candidateId, founderIndex: s.founderIndex, panel: s.panel, slot: s.slot,
      observedSeeds: rows.length, inference: { parentAbsoluteGates, mutantAbsoluteGates, allAbsoluteGatesPass,
        pairedByEndpoint, survivalLossWithinTenPercentagePoints: survivalUpper === null ? null : survivalUpper <= 0.1 }, descriptive };
  });
  const crossPosition = candidates.filter((c) => c.kind === "role-nominee").map((c) => {
    const a = panels.find((p) => p.candidateId === c.id && p.panel === 0)!;
    const b = panels.find((p) => p.candidateId === c.id && p.panel === 1)!;
    const changes = observedSeeds.map((seed) => {
      const result = bySeed.get(seed)!;
      return [result.rows[a.slot].pairedRoleChange.framesWithFixedRoleShareDifference > 0,
        result.rows[b.slot].pairedRoleChange.framesWithFixedRoleShareDifference > 0] as const;
    });
    const gatePattern = (panel: RolePanelAnalysis) => panel.inference ?
      [panel.inference.parentAbsoluteGates, panel.inference.mutantAbsoluteGates].map((arm) =>
        ROLE_COHORT_FIELDS.map((field) => arm[field].passes)) : null;
    return { candidateId: c.id, founderIndex: c.founderIndex, observedSeeds: observedSeeds.length,
      seedsWithRoleChangeInBoth: changes.filter(([x, y]) => x && y).length,
      seedsWithRoleChangeInEither: changes.filter(([x, y]) => x || y).length,
      seedsWithSameRoleChangePresence: changes.filter(([x, y]) => x === y).length,
      absoluteGatePatternIdentical: missingSeeds.length ? null : same(gatePattern(a), gatePattern(b)),
      bothPanelsAllAbsoluteGatesPass: missingSeeds.length ? null :
        a.inference!.allAbsoluteGatesPass && b.inference!.allAbsoluteGatesPass };
  });
  return { status: missingSeeds.length ? "incomplete" : "complete", observedSeeds, missingSeeds, panels, crossPosition,
    limitations: ["Panels use the same seeds and are not independent evolutionary replicates; do not pool their 64 outcomes.",
      "Screen-nominated genotypes are selected for a diagnostic, not a mutation-population rate.",
      "Fixed role labels and their observed changes do not establish a novel ecological function."] };
}
