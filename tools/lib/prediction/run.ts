// Orchestration for the prediction-envelope harness (PLAN.md, sections 7-9). Pure: no file or clock access, so every canonical
// output is a deterministic function of the protocol. tools/predict.ts does the I/O. Proposers receive envelopes only; the scorer
// alone reads outcomes.
import { RULE_VERSION } from "@bl/schema";
import { canonical, sha256Text } from "../propose.ts";
import { CLASSES, ENVELOPE_VERSION, type Direction3, type PredictionEnvelope } from "./envelope.ts";
import { caseIdOf, labelOf, plannedCellSteps, recipeHash, recipeOf, runFamily, type FamilyResult, type FamilySpec, type FixtureProtocol } from "./fixtures.ts";
import { READOUTS_VERSION, READOUT_UNITS } from "./readouts.ts";
import { abstainAll, alwaysNone, fixedRule, mechanismRule, numericTrend, priorMajority, shuffledEvidence, v0Rules, type Proposer, type ProposerParams } from "./proposers.ts";
import { MIN_FAMILIES_FOR_INTERVALS, costPerUseful, familyBootstrap, familyMeans, matchedCoverageSet, pairedFamilyDiff, scoreProposer, signAgreement, brierOf, type Interval, type ProposerScore, type ScoredCase } from "./score.ts";
import { assertNoLeak, assignSplits, donorsFor, type Split, type SplitPlan } from "./splits.ts";
import { argmax, validatePredictionFile, type Prediction, type Probs } from "./validate.ts";

export const PROTOCOL_VERSION = 1;
export interface Protocol extends FixtureProtocol {
  protocolVersion: number;
  readoutsVersion: number;
  primaryReadout: "bodyMass";
  /** In the primary readout's own unit; null until frozen. */
  minEffect: number | null;
  /** Candidate thresholds the dev qualification report tabulates. */
  minEffectCandidates: number[];
  salt: string;
  families: FamilySpec[];
  nDev: number;
  nQualify: number;
  donors: Record<string, string>;
  proposers: ProposerParams;
  devPrior: Probs | null;
  bootstrap: { resamples: number; seed: number };
  caps: { maxCellStepsPerFamily: number };
  frozen: boolean;
}

export const protocolHash = (p: Protocol): string => sha256Text(canonical(p));

/**
 * The confirm stage's gate. The protocol must be frozen, its hash must equal the recorded freeze hash, and BOTH files must be
 * committed (HEAD blobs) byte-equal to the working-tree files: a working-tree-only freeze is not a freeze (PLAN.md, section 7).
 * `committed` holds the HEAD blob texts (null when the file is not in HEAD). Returns the refusal, or null.
 */
export function freezeRefusal(p: Protocol, freezeText: string | null): string | null {
  if (!p.frozen || p.minEffect === null || p.devPrior === null) return "protocol.json is not frozen (run the dev stage, then freeze)";
  if (freezeText === null) return "protocol.freeze.sha256 is missing";
  if (freezeText.trim() !== protocolHash(p)) return `protocol hash ${protocolHash(p)} does not match the frozen ${freezeText.trim()}`;
  return null;
}
export interface CommittedCopies {
  protocol: string | null;
  freeze: string | null;
  protocolWorking: string;
  freezeWorking: string;
}
export function committedRefusal(c: CommittedCopies): string | null {
  if (c.protocol === null) return "protocol.json is not committed (HEAD has no copy): commit the freeze before confirming";
  if (c.freeze === null) return "protocol.freeze.sha256 is not committed (HEAD has no copy): commit the freeze before confirming";
  if (c.protocol !== c.protocolWorking) return "protocol.json differs from its committed copy: commit the freeze before confirming";
  if (c.freeze !== c.freezeWorking) return "protocol.freeze.sha256 differs from its committed copy: commit the freeze before confirming";
  return null;
}
export const confirmRefusal = (p: Protocol, freezeText: string | null, committed: CommittedCopies | undefined): string | null =>
  freezeRefusal(p, freezeText) ?? (committed ? committedRefusal(committed) : "no committed copy supplied: the freeze must be committed before test outcomes are generated");
export const splitPlanOf = (p: Protocol): SplitPlan => assignSplits(p.families.map((f) => f.id), p.salt, p.nDev, p.nQualify);

/** The draft protocol (dev-stage defaults). protocol.json on disk is the source of truth once written. */
export function draftProtocol(): Protocol {
  const lights = ["spots", "gradient"] as const;
  const nutrients = [0, 1, 2];
  const families: FamilySpec[] = Array.from({ length: 24 }, (_, k) => ({ id: `f${String(k).padStart(2, "0")}`, seed: 5000 + k, light: lights[k % 2], nutrient: nutrients[k % 3], founders: 3 + (k % 3) }));
  const base: Protocol = {
    protocolVersion: PROTOCOL_VERSION,
    readoutsVersion: READOUTS_VERSION,
    primaryReadout: "bodyMass",
    minEffect: null,
    minEffectCandidates: [25, 50, 100, 200],
    salt: "i02-prediction-envelope-2026-11-01",
    families,
    nDev: 12,
    nQualify: 4,
    donors: {},
    world: { side: 32, kernelRadius: 4, founderRadius: 3, founderBiomass: 64, founderEnergy: 128 },
    window: { forkStep: 300, delta: 10, horizon: 200, censusEvery: 10, frameSteps: [75, 150, 225, 300] },
    menu: { rMax: 6, amountMax: 4096 },
    mechanisms: [
      { id: "feedOccupied", kind: "feed", where: "occupied", r: 6, amount: 512, expected: "up" },
      { id: "lesionOccupied", kind: "lesion", where: "occupied", r: 4, expected: "down" },
      { id: "drainOccupied", kind: "drain", where: "occupied", r: 6, amount: 4096, expected: "down" },
      { id: "sham", kind: "none", where: "none", expected: "none" },
      { id: "lesionEmpty", kind: "lesion", where: "empty", r: 4, expected: "none" },
      { id: "lowDoseFeed", kind: "feed", where: "occupied", r: 1, amount: 1, expected: "none" },
    ],
    seedVariantOffset: 7919,
    proposers: {
      fixedRule: { lead: 600 },
      numericTrend: { window: 5, minRelPerMille: 20, lead: 500, mid: 350, low: 200 },
      v0Rules: { lead: 600 },
      mechanismRule: { lead: 700, lowDoseQuanta: 2000, scarceNutrient: 500 },
    },
    devPrior: null,
    bootstrap: { resamples: 2000, seed: 20261101 },
    caps: { maxCellStepsPerFamily: 40_000_000 },
    frozen: false,
  };
  base.donors = donorsFor(splitPlanOf(base), base.salt);
  return base;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Generation.

export interface Generated {
  results: FamilyResult[];
  /** Seed-variant results for the qualify families (stability). */
  variants: FamilyResult[];
}

export function generate(p: Protocol, familyIds: readonly string[], includeVariants: boolean): Generated {
  const byId = new Map(p.families.map((f) => [f.id, f]));
  const plan = splitPlanOf(p);
  const results: FamilyResult[] = [];
  const variants: FamilyResult[] = [];
  // Budget first: bounds and planned cell-steps are checked for every run (variants included) before anything is simulated.
  const planned = plannedCellSteps(p);
  if (planned > p.caps.maxCellStepsPerFamily) throw new Error(`a family run plans ${planned} cell-steps, over the cap ${p.caps.maxCellStepsPerFamily}`);
  for (const id of familyIds) if (!byId.has(id)) throw new Error(`unknown family ${id}`);
  for (const id of familyIds) {
    const fam = byId.get(id)!;
    results.push(runFamily(p, fam));
    if (includeVariants && plan.qualify.includes(id)) variants.push(runFamily(p, fam, fam.seed + p.seedVariantOffset));
  }
  return { results, variants };
}

export interface CaseRow {
  caseId: string;
  familyId: string;
  split: Split;
  mechanismId: string;
  expected: Direction3;
  envelopeHash: string;
  effect: { bodyMass: number; livingCells: number; freeNutrient: number };
  before: number;
  treated: number;
  control: number;
  treatedHash: string;
}

export function caseRows(p: Protocol, g: readonly FamilyResult[]): CaseRow[] {
  const plan = splitPlanOf(p);
  const rows: CaseRow[] = [];
  for (const r of g) {
    const split: Split = plan.dev.includes(r.familyId) ? "dev" : "test";
    for (const a of r.arms) {
      const env = r.envelopes.find((e) => e.caseId === a.caseId)!;
      const m = p.mechanisms.find((x) => x.id === a.mechanismId)!;
      rows.push({
        caseId: a.caseId,
        familyId: r.familyId,
        split,
        mechanismId: a.mechanismId,
        expected: m.expected,
        envelopeHash: env.envelopeHash,
        effect: { bodyMass: a.effect.bodyMass, livingCells: a.effect.livingCells, freeNutrient: a.effect.freeNutrient },
        before: env.census[env.census.length - 1].mass,
        treated: a.treated.bodyMass,
        control: a.control.bodyMass,
        treatedHash: a.treatedHash,
      });
    }
  }
  return rows;
}

/** Prespecified: a label that changes when the threshold is scaled by 3/4 or 5/4 is measurement-limited (kept in every denominator). */
export function measurementLimited(effect: number, minEffect: number): boolean {
  const l = labelOf(effect, minEffect);
  return labelOf(effect, minEffect * 0.75) !== l || labelOf(effect, minEffect * 1.25) !== l;
}

/**
 * The dev qualification report. Tuning (the minEffect candidates' tallies, cross-seed stability) uses ONLY the reserved `qualify`
 * subset of dev families; `devEffects` carries every dev family's effects separately, for the dev class prior alone.
 */
export function qualificationReport(p: Protocol, dev: Generated) {
  const plan = splitPlanOf(p);
  const allRows = caseRows(p, dev.results);
  const rows = allRows.filter((r) => plan.qualify.includes(r.familyId));
  const tallies = p.minEffectCandidates.map((t) => {
    const perMech = p.mechanisms.map((m) => {
      const rs = rows.filter((r) => r.mechanismId === m.id);
      const count = { up: 0, down: 0, none: 0 };
      for (const r of rs) count[labelOf(r.effect.bodyMass, t)]++;
      return { mechanism: m.id, expected: m.expected, ...count, agreeWithExpected: count[m.expected] };
    });
    return { minEffect: t, perMechanism: perMech };
  });
  const variantRows = caseRows(p, dev.variants);
  const stability = p.minEffectCandidates.map((t) => {
    const a: Direction3[] = [], b: Direction3[] = [];
    for (const v of variantRows) {
      const base = rows.find((r) => r.caseId === v.caseId);
      if (!base) continue;
      a.push(labelOf(base.effect.bodyMass, t));
      b.push(labelOf(v.effect.bodyMass, t));
    }
    return { minEffect: t, ...signAgreement(a, b) };
  });
  return {
    protocolHash: protocolHash(p),
    note: "measured labels are never relabelled to match expectations; disagreements are reported. Tuning fields (effects, variantEffects, tallies, crossSeedEffectStability) cover the qualify subset only; devEffects (all dev families) feed the dev class prior only.",
    qualifyFamilies: plan.qualify,
    effects: rows.map((r) => ({ caseId: r.caseId, familyId: r.familyId, mechanism: r.mechanismId, bodyMass: r.effect.bodyMass, livingCells: r.effect.livingCells, freeNutrient: r.effect.freeNutrient })),
    devEffects: allRows.map((r) => ({ caseId: r.caseId, familyId: r.familyId, mechanism: r.mechanismId, bodyMass: r.effect.bodyMass })),
    variantEffects: variantRows.map((r) => ({ caseId: r.caseId, mechanism: r.mechanismId, bodyMass: r.effect.bodyMass })),
    tallies,
    crossSeedEffectStability: stability,
    neutralityChecks: dev.results.reduce((s, r) => s + r.neutralityChecks, 0),
    cellSteps: dev.results.reduce((s, r) => s + r.cellSteps, 0) + dev.variants.reduce((s, r) => s + r.cellSteps, 0),
  };
}

/** Class frequencies of a list of effects at a threshold, as per-mille summing to exactly 1000 (largest remainder; ties to the earlier of up, down, none). */
export function priorFromEffects(effects: readonly number[], minEffect: number): Probs {
  const c = { up: 0, down: 0, none: 0 };
  for (const e of effects) c[labelOf(e, minEffect)]++;
  const n = effects.length;
  if (n === 0) throw new Error("no dev effects");
  const raw = CLASSES.map((k) => (c[k] * 1000) / n);
  const fl = raw.map(Math.floor);
  let left = 1000 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - fl[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    fl[o.i]++;
    left--;
  }
  return { up: fl[0], down: fl[1], none: fl[2] };
}
export const devPriorAt = (p: Protocol, dev: Generated, minEffect: number): Probs => priorFromEffects(caseRows(p, dev.results).map((r) => r.effect.bodyMass), minEffect);

// ---------------------------------------------------------------------------------------------------------------------------------
// Proposers and evaluation.

export function buildProposers(p: Protocol, envelopes: readonly PredictionEnvelope[]): Proposer[] {
  if (!p.devPrior) throw new Error("protocol has no devPrior: freeze it first");
  const plan = splitPlanOf(p);
  const splitOf = (f: string): Split | undefined => (plan.dev.includes(f) ? "dev" : plan.test.includes(f) ? "test" : undefined);
  const first = new Map<string, PredictionEnvelope>();
  for (const e of envelopes) if (!first.has(e.familyId)) first.set(e.familyId, e);
  return [
    priorMajority(p.devPrior),
    alwaysNone(),
    fixedRule(p.proposers.fixedRule),
    numericTrend(p.proposers.numericTrend),
    v0Rules(p.proposers.v0Rules),
    shuffledEvidence(p.proposers.numericTrend, p.donors, (f) => first.get(f), splitOf),
    abstainAll(),
    mechanismRule(p.proposers.mechanismRule),
  ];
}

export const BASELINE_IDS = ["priorMajority", "alwaysNone", "fixedRule", "numericTrend", "v0Rules"] as const;

export interface PredictionLine {
  proposer: string;
  prediction: Prediction;
}

/** `eligible` decides which envelopes a proposer runs on (the dev-only oracle is never run on, serialised for, or shown on test cases). */
export function runProposers(proposers: readonly Proposer[], envelopes: readonly PredictionEnvelope[], eligible: (pr: Proposer, env: PredictionEnvelope) => boolean = () => true): PredictionLine[] {
  const out: PredictionLine[] = [];
  for (const pr of proposers) for (const e of envelopes) if (eligible(pr, e)) out.push({ proposer: pr.id, prediction: pr.propose(structuredClone(e)) });
  return out;
}
/** Proposer ids that are dev-only oracles (a file of theirs is validated against dev envelopes only). */
export const ORACLE_IDS: readonly string[] = ["mechanismRule"];
/** The standard eligibility: oracle proposers only on dev-split envelopes. */
export const devOnlyOracle = (p: Protocol) => {
  const plan = splitPlanOf(p);
  return (pr: Proposer, env: PredictionEnvelope): boolean => pr.role !== "oracle" || plan.dev.includes(env.familyId);
};

export function scoredCases(lines: readonly PredictionLine[], proposerId: string, envelopes: readonly PredictionEnvelope[], rows: readonly CaseRow[], minEffect: number): ScoredCase[] {
  const mine = lines.filter((l) => l.proposer === proposerId).map((l) => JSON.stringify(l.prediction));
  const check = validatePredictionFile(mine, envelopes);
  const byRow = new Map(rows.map((r) => [r.caseId, r]));
  const out: ScoredCase[] = [];
  for (const e of envelopes) {
    const row = byRow.get(e.caseId);
    if (!row) continue;
    const got = check.byCase.get(e.caseId);
    const prediction = got?.prediction ?? null;
    const status: ScoredCase["status"] = !got ? "missing" : !prediction ? "invalid" : prediction.abstain ? "abstained" : "answered";
    out.push({ caseId: e.caseId, familyId: e.familyId, outcome: labelOf(row.effect.bodyMass, minEffect), prediction: status === "answered" ? prediction : null, status });
  }
  return out;
}

export interface TableRow extends ProposerScore {
  role: string;
  brierAtMatchedCoverage: number | null;
  accuracyAtMatchedCoverage: number | null;
}
export interface SplitTable {
  split: string;
  nCases: number;
  nFamilies: number;
  classCounts: Record<Direction3, number>;
  meanAbsEffect: Record<string, number | null>;
  rows: TableRow[];
}

export function tableFor(p: Protocol, name: string, proposers: readonly Proposer[], lines: readonly PredictionLine[], envelopes: readonly PredictionEnvelope[], rows: readonly CaseRow[], pick: (r: CaseRow) => boolean): SplitTable {
  const sel = rows.filter(pick);
  const ids = new Set(sel.map((r) => r.caseId));
  const envs = envelopes.filter((e) => ids.has(e.caseId));
  const prior = p.devPrior!;
  const minEffect = p.minEffect!;
  const byP: Record<string, ScoredCase[]> = {};
  for (const pr of proposers) byP[pr.id] = scoredCases(lines, pr.id, envs, sel, minEffect);
  // The coverage floor (a proposer that answers nothing) is left out of the matched set, else it would empty it.
  const answering = Object.fromEntries(Object.entries(byP).filter(([, cs]) => cs.some((c) => c.status === "answered")));
  const matched = matchedCoverageSet(answering);
  const classCounts: Record<Direction3, number> = { up: 0, down: 0, none: 0 };
  for (const r of sel) classCounts[labelOf(r.effect.bodyMass, minEffect)]++;
  const mean = (f: (r: CaseRow) => number): number | null => (sel.length ? sel.reduce((s, r) => s + Math.abs(f(r)), 0) / sel.length : null);
  return {
    split: name,
    nCases: sel.length,
    nFamilies: new Set(sel.map((r) => r.familyId)).size,
    classCounts,
    meanAbsEffect: { [`bodyMass (${READOUT_UNITS.bodyMass})`]: mean((r) => r.effect.bodyMass), [`livingCells (${READOUT_UNITS.livingCells}, diagnostic)`]: mean((r) => r.effect.livingCells), [`freeNutrient (${READOUT_UNITS.freeNutrient}, diagnostic)`]: mean((r) => r.effect.freeNutrient) },
    rows: proposers.map((pr) => {
      const s = scoreProposer(pr.id, byP[pr.id], prior);
      const m = matched.size ? scoreProposer(pr.id, byP[pr.id], prior, matched) : null;
      return { ...s, role: pr.role, brierAtMatchedCoverage: m?.brierAnswered ?? null, accuracyAtMatchedCoverage: m?.directionalAccuracy ?? null };
    }),
  };
}

export interface Comparison {
  protocolHash: string;
  noModelStatement: string;
  strongestBaselineOnDev: string;
  dev: SplitTable;
  test: SplitTable;
  testExcludingMeasurementLimited: SplitTable;
  measurementLimitedCases: number;
  perFamily: Record<string, { intervals: boolean; brierImputed: Record<string, Interval | null>; pairedVsStrongest: Record<string, Interval | null> }>;
  /** Per proposer, over every envelope it was run on: file-level diagnostics that the per-split tables cannot carry. */
  fileDiagnostics: Record<string, { lines: number; invalid: number; missing: number; extra: number; duplicates: number; notObject: number; badEnvelopes: number }>;
  /** Per proposer: the predicted-argmax class counts over the test cases it answered; a single-class row means it cannot separate anything. */
  argmaxTest: Record<string, Record<Direction3, number>>;
  mechanismAudit: { mechanism: string; expected: Direction3; counts: Record<Direction3, number> }[];
  trendConfound: TrendConfound;
  validNonNullYieldAndCost: { totalCellSteps: number; costPerUseful: number | null };
  crossSeedEffectStability: { n: number; agree: number; rate: number | null };
  notes: string[];
}

export interface TrendConfound {
  description: string;
  pairedAlwaysRisingAccuracy: number | null;
  naiveBeforeAfterAlwaysRisingAccuracy: number | null;
  sham: { n: number; naiveUp: number; pairedNone: number };
  lowDose: { n: number; naiveUp: number; pairedNone: number };
  /** Cases whose treated value is above the fork value, of all cases: when 0, the fixtures cannot show the confound. */
  risingCases: number;
  totalCases: number;
}
/** A naive predictor that says "up" whenever treated ends above its before-value, scored by the naive before/after rule vs the paired rule. */
export function trendConfoundOf(rows: readonly CaseRow[], minEffect: number): TrendConfound {
  const share = (f: (r: CaseRow) => Direction3): number | null => (rows.length ? rows.filter((r) => f(r) === "up").length / rows.length : null);
  const naive = (r: CaseRow): Direction3 => labelOf(r.treated - r.before, minEffect);
  const paired = (r: CaseRow): Direction3 => labelOf(r.effect.bodyMass, minEffect);
  const tally = (id: string) => {
    const rs = rows.filter((r) => r.mechanismId === id);
    return { n: rs.length, naiveUp: rs.filter((r) => naive(r) === "up").length, pairedNone: rs.filter((r) => paired(r) === "none").length };
  };
  return {
    description: "Share of cases labelled up by the paired rule (treated minus control) vs the naive before/after rule (treated minus value at the fork); an always-rising predictor is right exactly when its rule says up.",
    pairedAlwaysRisingAccuracy: share(paired),
    naiveBeforeAfterAlwaysRisingAccuracy: share(naive),
    sham: tally("sham"),
    lowDose: tally("lowDoseFeed"),
    risingCases: rows.filter((r) => r.treated > r.before).length,
    totalCases: rows.length,
  };
}

export function compare(p: Protocol, gen: Generated, envelopes: readonly PredictionEnvelope[], lines: readonly PredictionLine[], proposers: readonly Proposer[], eligible: (pr: Proposer, env: PredictionEnvelope) => boolean = devOnlyOracle(p)): Comparison {
  const rows = caseRows(p, gen.results);
  const minEffect = p.minEffect!;
  const dev = tableFor(p, "dev", proposers, lines, envelopes, rows, (r) => r.split === "dev");
  const noOracle = proposers.filter((x) => x.role !== "oracle");
  const test = tableFor(p, "test", noOracle, lines, envelopes, rows, (r) => r.split === "test");
  const limited = new Set(rows.filter((r) => measurementLimited(r.effect.bodyMass, minEffect)).map((r) => r.caseId));
  const testNL = tableFor(p, "test, measurement-limited cases excluded", noOracle, lines, envelopes, rows, (r) => r.split === "test" && !limited.has(r.caseId));
  const strongest = [...dev.rows].filter((r) => (BASELINE_IDS as readonly string[]).includes(r.id)).sort((a, b) => (a.brierImputed ?? 9) - (b.brierImputed ?? 9) || (a.id < b.id ? -1 : 1))[0].id;

  // Per-family Brier (imputed) per proposer, intervals only with enough families.
  const perFamily: Comparison["perFamily"] = {};
  for (const split of ["dev", "test"] as const) {
    const sel = rows.filter((r) => r.split === split);
    const envs = envelopes.filter((e) => sel.some((r) => r.caseId === e.caseId));
    const fam: Record<string, Map<string, number>> = {};
    for (const pr of noOracle) {
      const sc = scoredCases(lines, pr.id, envs, sel, minEffect);
      fam[pr.id] = familyMeans(sc.map((c) => ({ familyId: c.familyId, v: c.status === "answered" ? brierOf(c.prediction!.probs!, c.outcome) : brierOf(p.devPrior!, c.outcome) })));
    }
    const enough = new Set(sel.map((r) => r.familyId)).size >= MIN_FAMILIES_FOR_INTERVALS;
    perFamily[split] = {
      intervals: enough,
      brierImputed: Object.fromEntries(Object.entries(fam).map(([id, m]) => [id, familyBootstrap(m, p.bootstrap.resamples, p.bootstrap.seed)])),
      pairedVsStrongest: Object.fromEntries(Object.entries(fam).filter(([id]) => id !== strongest).map(([id, m]) => [id, familyBootstrap(pairedFamilyDiff(m, fam[strongest]), p.bootstrap.resamples, p.bootstrap.seed)])),
    };
  }

  const fileDiagnostics: Comparison["fileDiagnostics"] = {};
  for (const pr of proposers) {
    const mine = lines.filter((l) => l.proposer === pr.id).map((l) => JSON.stringify(l.prediction));
    // Only the envelopes the proposer was meant to run on count as "missing" (the oracle is dev-only).
    const meant = envelopes.filter((e) => eligible(pr, e));
    const c = validatePredictionFile(mine, meant);
    fileDiagnostics[pr.id] = { lines: mine.length, invalid: c.invalid, missing: c.missing.length, extra: c.extra.length, duplicates: c.duplicates.length, notObject: c.notObject, badEnvelopes: c.badEnvelopes.length };
  }
  const testIds = new Set(rows.filter((r) => r.split === "test").map((r) => r.caseId));
  const argmaxTest: Comparison["argmaxTest"] = {};
  for (const pr of noOracle) {
    const counts: Record<Direction3, number> = { up: 0, down: 0, none: 0 };
    const chk = validatePredictionFile(lines.filter((l) => l.proposer === pr.id).map((l) => JSON.stringify(l.prediction)), envelopes);
    for (const [id, g] of chk.byCase) if (testIds.has(id) && g.prediction && !g.prediction.abstain) counts[argmax(g.prediction.probs!)]++;
    argmaxTest[pr.id] = counts;
  }
  const degenerate = Object.entries(argmaxTest).filter(([, c]) => c.up + c.down + c.none > 0 && [c.up, c.down, c.none].filter((v) => v > 0).length === 1).map(([id, c]) => `${id} (all ${(["up", "down", "none"] as const).find((k) => c[k] > 0)})`);

  const mechanismAudit = p.mechanisms.map((m) => {
    const counts: Record<Direction3, number> = { up: 0, down: 0, none: 0 };
    for (const r of rows.filter((x) => x.mechanismId === m.id)) counts[labelOf(r.effect.bodyMass, minEffect)]++;
    return { mechanism: m.id, expected: m.expected, counts };
  });

  const totalCellSteps = gen.results.reduce((s, r) => s + r.cellSteps, 0) + gen.variants.reduce((s, r) => s + r.cellSteps, 0);
  const vr = caseRows(p, gen.variants);
  const stab = signAgreement(
    vr.map((v) => labelOf(rows.find((r) => r.caseId === v.caseId)!.effect.bodyMass, minEffect)),
    vr.map((v) => labelOf(v.effect.bodyMass, minEffect)),
  );
  return {
    protocolHash: protocolHash(p),
    noModelStatement: "No model call, no GPU, no paid compute: every prediction is from a deterministic rule. This table says nothing about any model.",
    strongestBaselineOnDev: strongest,
    dev,
    test,
    testExcludingMeasurementLimited: testNL,
    measurementLimitedCases: limited.size,
    perFamily,
    fileDiagnostics,
    argmaxTest,
    mechanismAudit,
    trendConfound: trendConfoundOf(rows, minEffect),
    validNonNullYieldAndCost: { totalCellSteps, costPerUseful: costPerUseful(totalCellSteps, rows.map((r) => labelOf(r.effect.bodyMass, minEffect))) },
    crossSeedEffectStability: stab,
    notes: [
      ...(["dev", "test"] as const).flatMap((sp) => (perFamily[sp].intervals ? [] : [`the ${sp} split has fewer than ${MIN_FAMILIES_FOR_INTERVALS} families: descriptive only (no intervals)`])),
      "the strongest simple baseline is whichever of priorMajority, alwaysNone, fixedRule, numericTrend, v0Rules scores best on dev; a calibrated majority is legitimately strong",
      "shuffledEvidence is a control, mechanismRule a dev-only oracle (run on dev cases only), abstainAll a coverage floor",
      ...(degenerate.length ? [`degenerate on the test split, one predicted class for every answered case: ${degenerate.join(", ")}; a degenerate row cannot show the harness separating an evidence-using rule from its shuffled control (test: tools/test/prediction-proposers.test.ts, opposite-trend envelopes)`] : []),
      ...(trendConfoundOf(rows, minEffect).risingCases === 0 ? ["no fixture case has a treated value above its fork value, so these fixtures cannot demonstrate the before/after trend confound (the confound rule is tested on a synthetic rising set)"] : []),
    ],
  };
}

export function checkLeaks(p: Protocol, envelopes: readonly PredictionEnvelope[]): string[] {
  return assertNoLeak(splitPlanOf(p), p.donors, envelopes);
}

export const RUN_VERSIONS = { protocol: PROTOCOL_VERSION, envelope: ENVELOPE_VERSION, readouts: READOUTS_VERSION, ruleVersion: RULE_VERSION };
export { caseIdOf, recipeHash, recipeOf };
