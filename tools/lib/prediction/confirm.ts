// I02b: held-out confirmation of the prediction envelope on fresh families (docs/prediction-confirm-2026-11-02/AMENDMENT.md).
// Pure: no file, clock or git access (tools/predict.ts does the I/O). Holds the fresh-family recipe, the confirm protocol builder
// (the frozen v0 protocol with ONLY identity fields replaced), the disjointness helper, the extended committed-amendment gate, the
// ledger of test-split scoring inputs, and the mechanical reading. Nothing here touches scoring, proposers, readouts or fixtures.
import { canonical, sha256Text } from "../propose.ts";
import type { Direction3 } from "./envelope.ts";
import { caseIdOf, labelOf, type FamilySpec } from "./fixtures.ts";
import { buildProposers, freezeRefusal, measurementLimited, protocolHash, scoredCases, splitPlanOf, type CaseRow, type PredictionLine, type Protocol } from "./run.ts";
import { MIN_FAMILIES_FOR_INTERVALS, brierOf, familyBootstrap, familyMeans, pairedFamilyDiff, type Interval } from "./score.ts";
import { donorsFor } from "./splits.ts";
import { argmax, type Probs } from "./validate.ts";
import type { PredictionEnvelope } from "./envelope.ts";

// ---------------------------------------------------------------------------------------------------------------------------------
// The fresh-family recipe (fixed in the amendment, before any outcome).

export const CONFIRM_SALT = "i02-prediction-confirm-2026-11-02";
export const CONFIRM_SEED0 = 6000;
export const N_ORIGINAL = 15;
export const N_RISING = 5;
/** Keys that differ between protocol.confirm.json and the frozen v0 protocol.json. Every other key is byte-equal. */
export const IDENTITY_KEYS = ["salt", "families", "cohorts", "donors", "nDev", "nQualify"] as const;

/** 15 original-style families (the v0 cycle, indices 0..14) and 5 rising families (founders 1..5, a prefix of the v0 rising list). */
export function freshFamilies(): FamilySpec[] {
  const lights = ["spots", "gradient"] as const;
  const nutrients = [0, 1, 2];
  const id = (i: number): string => `c${String(i).padStart(2, "0")}`;
  const fams: FamilySpec[] = Array.from({ length: N_ORIGINAL }, (_, k) => ({ id: id(k), seed: CONFIRM_SEED0 + k, light: lights[k % 2], nutrient: nutrients[k % 3], founders: 3 + (k % 3) }));
  for (let j = 0; j < N_RISING; j++) fams.push({ id: id(N_ORIGINAL + j), seed: CONFIRM_SEED0 + N_ORIGINAL + j, light: "spots", nutrient: 50, founders: j + 1, cohort: "rising" });
  return fams;
}

/** The confirm protocol: the frozen protocol with ONLY the identity fields replaced. Splits: 3+1 dev, 12+4 test, no qualify subset. */
export function buildConfirmProtocol(v0: Protocol): Protocol {
  if (!v0.frozen || v0.minEffect === null || v0.devPrior === null) throw new Error("the base protocol is not frozen");
  const p: Protocol = structuredClone(v0);
  p.salt = CONFIRM_SALT;
  p.families = freshFamilies();
  p.cohorts = [{ id: "rising", nDev: 1 }];
  p.nDev = 3;
  p.nQualify = 0;
  p.donors = {};
  p.donors = donorsFor(splitPlanOf(p), p.salt);
  const problems = identityProblems(p, v0);
  if (problems.length) throw new Error(`confirm protocol differs from v0 outside the identity fields: ${problems.join("; ")}`);
  return p;
}

/** Keys outside IDENTITY_KEYS whose canonical form differs between the two protocols (empty when the confirm protocol is only an identity change). */
export function identityProblems(confirm: Protocol, v0: Protocol): string[] {
  const keys = new Set([...Object.keys(confirm), ...Object.keys(v0)]);
  const out: string[] = [];
  for (const k of keys) {
    if ((IDENTITY_KEYS as readonly string[]).includes(k)) continue;
    const a = (confirm as unknown as Record<string, unknown>)[k], b = (v0 as unknown as Record<string, unknown>)[k];
    if ((a === undefined) !== (b === undefined) || (a !== undefined && canonical(a) !== canonical(b))) out.push(k);
  }
  return out;
}

/** The light/nutrient/founders tuple each fresh family must carry, read from the v0 protocol (never retyped): the v0 recipe at the same cycle index. */
export function recipeTupleProblems(confirm: Protocol, v0: Protocol): string[] {
  const out: string[] = [];
  const v0Orig = v0.families.filter((f) => f.cohort === undefined);
  const v0Rising = v0.families.filter((f) => f.cohort === "rising");
  const orig = confirm.families.filter((f) => f.cohort === undefined);
  const rising = confirm.families.filter((f) => f.cohort === "rising");
  if (orig.length + rising.length !== confirm.families.length) out.push("a family names a cohort other than rising");
  orig.forEach((f, k) => {
    const m = v0Orig[k];
    if (!m) out.push(`${f.id}: v0 has no original family at index ${k}`);
    else if (f.light !== m.light || f.nutrient !== m.nutrient || f.founders !== m.founders) out.push(`${f.id}: tuple differs from v0 ${m.id}`);
  });
  rising.forEach((f, j) => {
    const m = v0Rising[j];
    if (!m) out.push(`${f.id}: v0 has no rising family at index ${j}`);
    else if (f.light !== m.light || f.nutrient !== m.nutrient || f.founders !== m.founders) out.push(`${f.id}: tuple differs from v0 ${m.id}`);
  });
  return out;
}

export interface V0RecipeRow {
  seed: number;
  recipe: { family: { light: string; nutrient: number; founders: number; seed: number } };
}
/**
 * Disjointness by effective simulation identity, without simulating anything: seeds alone, seed + seedVariantOffset, and the
 * (seed, light, nutrient, founders) tuple, of the confirm protocol against v0's protocol.json AND v0's recipes.jsonl (variants included).
 * History ids embed family ids and are not a valid disjointness key.
 */
export function disjointnessProblems(confirm: Protocol, v0: Protocol, v0Recipes: readonly V0RecipeRow[]): string[] {
  const out: string[] = [];
  const v0Seeds = new Set<number>();
  const v0Tuples = new Set<string>();
  const tuple = (s: number, l: string, n: number, f: number): string => `${s}|${l}|${n}|${f}`;
  for (const f of v0.families) {
    v0Seeds.add(f.seed);
    v0Seeds.add(f.seed + v0.seedVariantOffset);
    v0Tuples.add(tuple(f.seed, f.light, f.nutrient, f.founders));
    v0Tuples.add(tuple(f.seed + v0.seedVariantOffset, f.light, f.nutrient, f.founders));
  }
  for (const r of v0Recipes) {
    v0Seeds.add(r.seed);
    v0Tuples.add(tuple(r.seed, r.recipe.family.light, r.recipe.family.nutrient, r.recipe.family.founders));
  }
  const v0Ids = new Set(v0.families.map((f) => f.id));
  const ownSeeds = new Set<number>();
  for (const f of confirm.families) {
    if (v0Ids.has(f.id)) out.push(`family id ${f.id} is a v0 id`);
    for (const s of [f.seed, f.seed + confirm.seedVariantOffset]) {
      if (ownSeeds.has(s)) out.push(`seed ${s} is used twice within the confirm protocol`);
      ownSeeds.add(s);
      if (v0Seeds.has(s)) out.push(`seed ${s} (family ${f.id}) is a v0 seed`);
      if (v0Tuples.has(tuple(s, f.light, f.nutrient, f.founders))) out.push(`identity of ${f.id} at seed ${s} equals a v0 simulation`);
    }
  }
  if (confirm.salt === v0.salt) out.push("the salt equals v0's");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The committed-amendment gate for the confirm run (a superset of confirmRefusal).

export interface AmendmentGateInput {
  protocol: Protocol;
  freezeWorking: string | null;
  protocolWorking: string;
  amendmentWorking: string | null;
  /** HEAD blob texts, null when HEAD has no such file. */
  committed: { amendment: string | null; protocol: string | null; freeze: string | null };
  /** `git status --porcelain` lines over the executable closure; any entry refuses. */
  dirtyPaths: readonly string[];
  outDirNonEmpty: boolean;
  exploratory: boolean;
}
export function amendmentRefusal(i: AmendmentGateInput): string | null {
  if (i.exploratory) return "--exploratory is refused with an amendment protocol: a rehearsal on the held-out families would spend them";
  const f = freezeRefusal(i.protocol, i.freezeWorking);
  if (f) return f.replace("protocol.json", "the confirm protocol").replace("protocol.freeze.sha256", "the confirm freeze file");
  if (i.amendmentWorking === null) return "the amendment file is missing";
  if (i.committed.amendment === null) return "the amendment is not committed (HEAD has no copy): commit the amendment and freeze before confirming";
  if (i.committed.protocol === null) return "the confirm protocol is not committed (HEAD has no copy): commit the amendment and freeze before confirming";
  if (i.committed.freeze === null) return "the confirm freeze file is not committed (HEAD has no copy): commit the amendment and freeze before confirming";
  if (i.committed.amendment !== i.amendmentWorking) return "the amendment differs from its committed copy";
  if (i.committed.protocol !== i.protocolWorking) return "the confirm protocol differs from its committed copy";
  if (i.committed.freeze !== i.freezeWorking) return "the confirm freeze file differs from its committed copy";
  if (i.dirtyPaths.length) return `the executable closure has uncommitted changes (${i.dirtyPaths.slice(0, 5).join(", ")}${i.dirtyPaths.length > 5 ? ", ..." : ""}): commit everything first`;
  if (i.outDirNonEmpty) return "the output directory exists and is not empty: the first completed run is the attempt of record, never overwritten";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reserved identities, case inventory and provenance (review fixes: a held-out family may only be simulated by the amended confirm run,
// the ledger covers the frozen case inventory exactly, and CONFIRM status is earned from verified provenance, not trusted from meta.json).

/** Why a protocol may not be run by any stage but the amended confirm run: it uses the reserved confirmation salt, or a reserved seed as its base seed or as a qualification-variant seed (base +/- the protocol's offset). */
export function reservedConfirmProblems(p: Protocol): string[] {
  const out: string[] = [];
  if (p.salt === CONFIRM_SALT) out.push(`the salt is the reserved confirmation salt ${CONFIRM_SALT}`);
  const reserved = new Set(freshFamilies().map((f) => f.seed));
  for (const f of p.families) {
    if ([f.seed, f.seed + p.seedVariantOffset, f.seed - p.seedVariantOffset].some((t) => reserved.has(t))) out.push(`family ${f.id} uses the reserved confirmation seed ${f.seed}`);
  }
  return out;
}

export interface CaseInventory {
  all: string[];
  test: string[];
}
/** The case ids the frozen protocol implies (every family x every mechanism), split by the protocol's own split plan. No simulation. */
export function expectedCases(p: Protocol): CaseInventory {
  const plan = splitPlanOf(p);
  const test = new Set(plan.test);
  const all: string[] = [], testIds: string[] = [];
  for (const f of p.families) {
    for (const m of p.mechanisms) {
      const id = caseIdOf(f.id, m.id);
      all.push(id);
      if (test.has(f.id)) testIds.push(id);
    }
  }
  return { all: all.sort(), test: testIds.sort() };
}
const diffSets = (what: string, want: readonly string[], got: readonly string[]): string[] => {
  const w = new Set(want), g = new Set(got);
  const out: string[] = [];
  const missing = want.filter((x) => !g.has(x)), extra = [...g].filter((x) => !w.has(x));
  if (missing.length) out.push(`${what}: ${missing.length} missing (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""})`);
  if (extra.length) out.push(`${what}: ${extra.length} unexpected (${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ", ..." : ""})`);
  if (got.length !== g.size) out.push(`${what}: duplicate case ids`);
  return out;
};
/** Envelopes and outcome rows must equal the protocol's case inventory exactly (a silently dropped family must not shrink the ledger). */
export function coverageProblems(p: Protocol, envelopes: readonly PredictionEnvelope[], rows: readonly CaseRow[]): string[] {
  const inv = expectedCases(p);
  const plan = splitPlanOf(p);
  const test = new Set(plan.test);
  return [
    ...diffSets("envelopes", inv.all, envelopes.map((e) => e.caseId)),
    ...diffSets("outcome rows", inv.all, rows.map((r) => r.caseId)),
    ...diffSets("test outcome rows", inv.test, rows.filter((r) => r.split === "test").map((r) => r.caseId)),
    ...(rows.some((r) => (r.split === "test") !== test.has(r.familyId)) ? ["outcome rows: a row's split disagrees with the protocol's split plan"] : []),
  ];
}

/** The data files whose digests canonical.sha256 must match before analysis (report.html and comparison.md are derived and re-rendered). */
export const DATA_FILES = ["envelopes.jsonl", "protocol.snapshot.json", "recipes.jsonl", "predictions.jsonl", "outcomes.jsonl", "comparison.json"] as const;
export function digestProblems(digestText: string, read: (name: string) => string): string[] {
  const listed = new Map<string, string>();
  for (const l of digestText.split("\n")) {
    const m = /^([0-9a-f]{64})  (\S+)$/.exec(l);
    if (m) listed.set(m[2], m[1]);
  }
  const out: string[] = [];
  for (const n of DATA_FILES) {
    const want = listed.get(n);
    if (!want) out.push(`canonical.sha256 does not list ${n}`);
    else if (sha256Text(read(n)) !== want) out.push(`${n} does not match canonical.sha256`);
  }
  return out;
}

export interface ProvenanceInput {
  meta: { stage?: string; status?: string; protocolSha256?: string; gitDirty?: boolean; amendment?: { sha256?: string } };
  snapshot: Protocol;
  /** HEAD blob texts of the amendment, the confirm protocol and its freeze file (null when HEAD has none). */
  committed: { amendment: string | null; protocol: string | null; freeze: string | null };
}
/** Empty when the run is an amended confirm run on the reserved fresh families, whose amendment, protocol and freeze are committed and consistent. */
export function provenanceProblems(i: ProvenanceInput): string[] {
  const out: string[] = [];
  const m = i.meta;
  if (m.stage !== "confirm" || m.status !== "CONFIRM") out.push(`meta.json is not a confirm-stage CONFIRM run (stage ${m.stage}, status ${m.status})`);
  if (!m.amendment) out.push("meta.json carries no amendment provenance (a default v0 confirm run is not the amended confirmation)");
  if (m.gitDirty !== false) out.push("the run started with uncommitted changes in the executable closure");
  const hash = protocolHash(i.snapshot);
  if (m.protocolSha256 !== hash) out.push("meta.protocolSha256 does not match the protocol snapshot");
  if (i.snapshot.salt !== CONFIRM_SALT || canonical(i.snapshot.families) !== canonical(freshFamilies())) out.push("the protocol snapshot is not the reserved fresh-family recipe");
  if (i.committed.freeze === null) out.push("the confirm freeze file is not committed");
  else if (i.committed.freeze.trim() !== hash) out.push("the committed confirm freeze hash does not match the snapshot");
  if (i.committed.protocol === null) out.push("the confirm protocol is not committed");
  else {
    try {
      if (protocolHash(JSON.parse(i.committed.protocol) as Protocol) !== hash) out.push("the committed confirm protocol does not match the snapshot");
    } catch {
      out.push("the committed confirm protocol is unreadable");
    }
  }
  if (i.committed.amendment === null) out.push("the amendment is not committed");
  else if (!m.amendment || sha256Text(i.committed.amendment) !== m.amendment.sha256) out.push("the committed amendment does not match meta.amendment.sha256");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The ledger: the committed, sufficient scoring input (test split, every non-oracle proposer).

export type LedgerStatus = "answered" | "abstained" | "invalid" | "missing";
export interface LedgerRow {
  familyId: string;
  caseId: string;
  proposer: string;
  status: LedgerStatus;
  predicted: Direction3 | null;
  probs: Probs | null;
  observed: Direction3;
  expected: Direction3;
  measurementLimited: boolean;
}

export function buildLedger(p: Protocol, envelopes: readonly PredictionEnvelope[], lines: readonly PredictionLine[], rows: readonly CaseRow[]): LedgerRow[] {
  const minEffect = p.minEffect!;
  const cover = coverageProblems(p, envelopes, rows);
  if (cover.length) throw new Error(`the run does not cover the frozen case inventory: ${cover.join("; ")}`);
  const test = rows.filter((r) => r.split === "test");
  const ids = new Set(test.map((r) => r.caseId));
  const envs = envelopes.filter((e) => ids.has(e.caseId));
  const byRow = new Map(test.map((r) => [r.caseId, r]));
  const out: LedgerRow[] = [];
  for (const pr of buildProposers(p, envelopes).filter((x) => x.role !== "oracle")) {
    const scored = scoredCases(lines, pr.id, envs, test, minEffect).sort((a, b) => (a.caseId < b.caseId ? -1 : 1));
    for (const c of scored) {
      const r = byRow.get(c.caseId)!;
      out.push({
        familyId: c.familyId,
        caseId: c.caseId,
        proposer: pr.id,
        status: c.status,
        predicted: c.status === "answered" ? argmax(c.prediction!.probs!) : null,
        probs: c.status === "answered" ? c.prediction!.probs! : null,
        observed: labelOf(r.effect.bodyMass, minEffect),
        expected: r.expected,
        measurementLimited: measurementLimited(r.effect.bodyMass, minEffect),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The reading (AMENDMENT.md section 4), applied mechanically to the ledger alone.

export const PRIMARY_RULE = "numericTrend";
export const COMPARATORS = { vsShuffledEvidence: "shuffledEvidence", vsPriorMajority: "priorMajority" } as const;
export const MAX_MEASUREMENT_LIMITED_SHARE = 0.25;

export interface ReadingParams {
  devPrior: Probs;
  resamples: number;
  seed: number;
  /** meta.json status: only CONFIRM can be decisive. */
  status: string;
  /** Provenance problems found by provenanceProblems(); each is an override. */
  provenance?: readonly string[];
}
export interface PairedResult {
  comparator: string;
  /** numericTrend minus comparator, imputed multiclass Brier, per-family means; negative favours numericTrend. */
  interval: Interval | null;
  nFamilies: number;
  pairingComplete: boolean;
}
export type Label = "POSITIVE" | "NEGATIVE" | "UNINFORMATIVE";
export interface Reading {
  label: Label;
  /** Descriptive suffix of an UNINFORMATIVE result from rule 4d; it never changes the label. */
  suffix: string | null;
  /** Rule 4a overrides that fired (empty when none). */
  overrides: string[];
  testFamilies: number;
  testCases: number;
  measurementLimitedShare: number | null;
  comparisons: { vsShuffledEvidence: PairedResult; vsPriorMajority: PairedResult };
  basis: string;
}

const imputedBrier = (r: LedgerRow, prior: Probs): number => (r.status === "answered" ? brierOf(r.probs!, r.observed) : brierOf(prior, r.observed));
const rowsOf = (ledger: readonly LedgerRow[], proposer: string): LedgerRow[] => ledger.filter((r) => r.proposer === proposer);
const sameSet = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const x = [...new Set(a)].sort(), y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function paired(ledger: readonly LedgerRow[], comparator: string, prm: ReadingParams): PairedResult {
  const nt = rowsOf(ledger, PRIMARY_RULE), cmp = rowsOf(ledger, comparator);
  const pairingComplete = nt.length > 0 && nt.length === cmp.length && sameSet(nt.map((r) => r.familyId), cmp.map((r) => r.familyId)) && sameSet(nt.map((r) => `${r.familyId}|${r.caseId}`), cmp.map((r) => `${r.familyId}|${r.caseId}`));
  const mean = (rs: LedgerRow[]) => familyMeans(rs.map((r) => ({ familyId: r.familyId, v: imputedBrier(r, prm.devPrior) })));
  const diff = pairedFamilyDiff(mean(nt), mean(cmp));
  return { comparator, interval: familyBootstrap(diff, prm.resamples, prm.seed), nFamilies: diff.size, pairingComplete };
}

const finite = (v: Interval | null): v is Interval => v !== null && Number.isFinite(v.lo) && Number.isFinite(v.hi) && Number.isFinite(v.mean);

export function confirmReading(ledger: readonly LedgerRow[], prm: ReadingParams): Reading {
  const nt = rowsOf(ledger, PRIMARY_RULE);
  const families = new Set(nt.map((r) => r.familyId));
  const A = paired(ledger, COMPARATORS.vsShuffledEvidence, prm), B = paired(ledger, COMPARATORS.vsPriorMajority, prm);
  const cases = new Set(nt.map((r) => r.caseId));
  const limited = new Set(nt.filter((r) => r.measurementLimited).map((r) => r.caseId));
  const share = cases.size ? limited.size / cases.size : null;
  const overrides: string[] = [];
  if (families.size < MIN_FAMILIES_FOR_INTERVALS) overrides.push(`fewer than ${MIN_FAMILIES_FOR_INTERVALS} test families (${families.size})`);
  if (prm.status !== "CONFIRM") overrides.push(`meta status is ${prm.status}, not CONFIRM`);
  for (const q of prm.provenance ?? []) overrides.push(`provenance: ${q}`);
  for (const r of [A, B]) {
    if (!finite(r.interval)) overrides.push(`the interval vs ${r.comparator} is null or not finite`);
    if (!r.pairingComplete) overrides.push(`the paired family or case sets of ${PRIMARY_RULE} and ${r.comparator} are not identical`);
  }
  const bad = nt.filter((r) => r.status === "invalid" || r.status === "missing").length;
  if (bad > 0) overrides.push(`${PRIMARY_RULE} has ${bad} invalid or missing predictions`);
  const answered = nt.filter((r) => r.status === "answered");
  const classes = new Set(answered.map((r) => r.predicted));
  if (answered.length === 0) overrides.push(`${PRIMARY_RULE} answered no test case`);
  else if (classes.size === 1) overrides.push(`${PRIMARY_RULE} is degenerate: one predicted class (${[...classes][0]}) on all ${answered.length} answered test cases`);
  for (const c of Object.values(COMPARATORS)) {
    const badC = rowsOf(ledger, c).filter((r) => r.status === "invalid" || r.status === "missing").length;
    if (badC > 0) overrides.push(`${c} has ${badC} invalid or missing predictions`);
  }
  if (share !== null && share > MAX_MEASUREMENT_LIMITED_SHARE) overrides.push(`measurement-limited cases are ${(share * 100).toFixed(1)}% of test cases (limit ${MAX_MEASUREMENT_LIMITED_SHARE * 100}%)`);
  const base = { suffix: null as string | null, testFamilies: families.size, testCases: cases.size, measurementLimitedShare: share, comparisons: { vsShuffledEvidence: A, vsPriorMajority: B } };
  if (overrides.length) return { ...base, label: "UNINFORMATIVE", overrides, basis: "rule 4a: an override fired" };
  const a = A.interval!, b = B.interval!;
  if (a.lo > 0 || b.lo > 0) return { ...base, label: "NEGATIVE", overrides, basis: "rule 4b: a primary interval lies wholly above 0" };
  if (a.hi < 0 && b.hi < 0) return { ...base, label: "POSITIVE", overrides, basis: "rule 4c: both primary intervals lie wholly below 0" };
  return { ...base, label: "UNINFORMATIVE", overrides, suffix: b.mean >= 0 ? "no improvement shown" : "improvement not supported", basis: "rule 4d: neither NEGATIVE nor POSITIVE" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The sealed decision document.

export interface DescriptiveRow {
  proposer: string;
  n: number;
  answered: number;
  abstained: number;
  invalid: number;
  missing: number;
  coverage: number;
  brierImputed: number | null;
  directionalAccuracy: number | null;
  predictedClasses: Record<Direction3, number>;
  /** Share of answered cases whose predicted class equals the fixture's expected label. */
  labelAgreementWithExpectation: number | null;
}
export interface FailedPrediction {
  caseId: string;
  familyId: string;
  status: LedgerStatus;
  predicted: Direction3 | null;
  observed: Direction3;
}
export interface ConfirmationDoc {
  kind: "prediction-confirmation";
  version: 1;
  status: string;
  protocolSha256: string;
  primaryRule: string;
  params: { resamples: number; seed: number; devPrior: Probs; minFamilies: number; maxMeasurementLimitedShare: number };
  reading: Reading;
  /** Why CONFIRM status was withheld (empty for a verified amended confirm run). */
  provenanceProblems: string[];
  /** Descriptive only: cannot produce a POSITIVE or NEGATIVE claim. */
  descriptive: DescriptiveRow[];
  /** numericTrend's failed predictions on the test split (wrong argmax, invalid or missing); abstentions are not failures. */
  failedPredictions: FailedPrediction[];
}

export function describeLedger(ledger: readonly LedgerRow[], prior: Probs): DescriptiveRow[] {
  const ids = [...new Set(ledger.map((r) => r.proposer))];
  return ids.map((id) => {
    const rs = rowsOf(ledger, id);
    const ans = rs.filter((r) => r.status === "answered");
    const predictedClasses: Record<Direction3, number> = { up: 0, down: 0, none: 0 };
    for (const r of ans) predictedClasses[r.predicted!]++;
    return {
      proposer: id,
      n: rs.length,
      answered: ans.length,
      abstained: rs.filter((r) => r.status === "abstained").length,
      invalid: rs.filter((r) => r.status === "invalid").length,
      missing: rs.filter((r) => r.status === "missing").length,
      coverage: rs.length ? ans.length / rs.length : 0,
      brierImputed: rs.length ? rs.reduce((s, r) => s + imputedBrier(r, prior), 0) / rs.length : null,
      directionalAccuracy: ans.length ? ans.filter((r) => r.predicted === r.observed).length / ans.length : null,
      predictedClasses,
      labelAgreementWithExpectation: ans.length ? ans.filter((r) => r.predicted === r.expected).length / ans.length : null,
    };
  });
}

export function buildConfirmation(p: Protocol, metaStatus: string, ledger: readonly LedgerRow[], provenance: readonly string[] = []): ConfirmationDoc {
  // CONFIRM is earned: any provenance problem withholds it.
  const status = provenance.length ? "UNVERIFIED" : metaStatus;
  const prm: ReadingParams = { devPrior: p.devPrior!, resamples: p.bootstrap.resamples, seed: p.bootstrap.seed, status, provenance };
  const failedPredictions = rowsOf(ledger, PRIMARY_RULE)
    .filter((r) => r.status === "invalid" || r.status === "missing" || (r.status === "answered" && r.predicted !== r.observed))
    .map((r) => ({ caseId: r.caseId, familyId: r.familyId, status: r.status, predicted: r.predicted, observed: r.observed }));
  return {
    kind: "prediction-confirmation",
    version: 1,
    status,
    protocolSha256: sha256Text(canonical(p)),
    primaryRule: PRIMARY_RULE,
    params: { resamples: prm.resamples, seed: prm.seed, devPrior: prm.devPrior, minFamilies: MIN_FAMILIES_FOR_INTERVALS, maxMeasurementLimitedShare: MAX_MEASUREMENT_LIMITED_SHARE },
    reading: confirmReading(ledger, prm),
    provenanceProblems: [...provenance],
    descriptive: describeLedger(ledger, prm.devPrior),
    failedPredictions,
  };
}

/** The sha256 file over the sealed decision and the ledger. */
export const confirmDigest = (confirmationText: string, ledgerText: string): string => `${sha256Text(confirmationText)}  confirmation.json\n${sha256Text(ledgerText)}  ledger.jsonl\n`;
