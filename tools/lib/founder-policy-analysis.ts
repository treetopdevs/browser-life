import { BOOTSTRAP_SEED, Random, assayTerm, interval, linear, percentile, type Design, type LinearScore } from "./founder-policy.ts";
import { assayConfig, type EvolutionProgress } from "./founder-policy-runtime.ts";
import { assayIdentity } from "./founder-policy-pilot.ts";

export interface AssayRequest { id: string; history: string; cohort: string; seed: number; mode: "normal" | "off"; time: number; root: number; draw: number; assaySeed: number; assignment: number; status: "scheduled" | "absent" | "unresolved"; descendantHex: string | null; ancestorHex: string; assayKey: string | null }
export interface AssayResult { assayKey: string; score: number | null; status: "scored" | "both-extinct"; descendantMass: number; ancestorMass: number; cfg: unknown; startHash: string; finalHash: string; manifestSha256: string; startedAt: string; finishedAt: string; wallSeconds: number }
export interface RootEstimate { status: "complete" | "structural-absence" | "technical-unresolved" | "assay-uninformative" | "assay-missing"; contrast: LinearScore; availableValue: number | null; missingKeys: string[] }
export interface Interval { lower: number; upper: number }
export interface DescriptiveRow { history: string; cohort: string; seed: number; mode: "normal" | "off"; time: number; meanCompetitiveScore: number | null; completeScoreRoots: number; meanGainFromTimeZero: number | null; completeGainRoots: number; knownRetainedRoots: number; possibleRetainedRoots: number; rootMasses: number[] | null; relativeAbundance: (number | null)[] | null; unknownAncestryMass: number | null; unassociatedMass: number | null }
export interface Analysis { format: "founder-policy-analysis/v1"; manifestSha256: string; requestedAssays: number; scheduledAssays: number; uniqueAssays: number; assayResults: number; missingness: Record<string, number>; descriptive: DescriptiveRow[]; availableCase: { random: number | null; historical: number | null; difference: number | null; completePairedRoots: number; totalPairedRoots: number }; bounds: { random: Interval; historical: Interval; difference: Interval; retentionDifference: Interval }; bootstrap: { replicates: 10000; random95: Interval; historical95: Interval; difference95: Interval; difference90: Interval; retention95: Interval }; retention: { randomKnownLowerBound: number; historicalKnownLowerBound: number; normalUnknownSlots: number; normalTotalSlots: number; randomOnMinusOff: Interval; historicalOnMinusOff: Interval }; decision: "random-founder-policy" | "comparable" | "neither-meaningfully-improves" | "inconclusive-or-tradeoff"; limitations: string[] }

const zero = (): LinearScore => ({ constant: 0, terms: {} });
const mean = (xs: LinearScore[]): LinearScore => xs.length ? linear(...xs.map((score) => ({ score, weight: 1 / xs.length }))) : zero();
export function substituteKnown(expr: LinearScore, scores: Record<string, number>): LinearScore { const out: LinearScore = { constant: expr.constant, terms: {} }; for (const [key, coefficient] of Object.entries(expr.terms)) { if (scores[key] === undefined) out.terms[key] = coefficient; else out.constant += coefficient * scores[key]; } return out; }

export function validateAssayResult(result: AssayResult): void {
  if (![result.descendantMass, result.ancestorMass].every((x) => Number.isSafeInteger(x) && x >= 0)) throw Error(`malformed assay mass ${result.assayKey}`);
  const denom = result.descendantMass + result.ancestorMass;
  const score = denom ? (result.descendantMass - result.ancestorMass) / denom : null;
  if (result.score !== score || result.status !== (score === null ? "both-extinct" : "scored")) throw Error(`assay score/status mismatch ${result.assayKey}`);
}

export function buildAssayRequests(design: Design, progress: Record<string, EvolutionProgress | null>): AssayRequest[] {
  const histories = new Map(design.histories.map((h) => [h.id, h])), cohorts = new Map(design.cohorts.map((c) => [c.id, c]));
  const cfgs = new Map(design.seeds.mainAssay.map((seed) => [seed, assayConfig(seed)]));
  const out: AssayRequest[] = [];
  for (const sample of design.sampleUnits) {
    const history = histories.get(sample.history); if (!history) throw Error(`unknown sample history ${sample.history}`);
    const cohort = cohorts.get(history.cohort); if (!cohort) throw Error(`unknown sample cohort ${history.cohort}`);
    const found = progress[history.id]?.samples.find((s) => s.time === sample.time)?.roots[sample.root];
    const status = found?.status ?? "unresolved", descendantHex = status === "present" ? found!.draws[sample.draw] : null;
    if (status === "present" && !descendantHex) throw Error(`missing present root draw ${history.id}/${sample.time}/${sample.root}/${sample.draw}`);
    const ancestorHex = cohort.genomeHex[sample.root];
    for (const assaySeed of design.seeds.mainAssay) for (let assignment = 0; assignment < 4; assignment++) {
      out.push({ id: `${history.id}-t${sample.time}-r${sample.root}-d${sample.draw}-s${assaySeed}-a${assignment}`, history: history.id, cohort: cohort.id, seed: history.seed, mode: history.mode, time: sample.time, root: sample.root, draw: sample.draw, assaySeed, assignment, status: status === "present" ? "scheduled" : status, descendantHex, ancestorHex, assayKey: descendantHex ? assayIdentity(descendantHex, ancestorHex, assaySeed, assignment, cfgs.get(assaySeed)) : null });
    }
  }
  if (out.length !== 82944) throw Error(`full assay request roster ${out.length} != 82944`);
  return out;
}

export function rootContrast(requests: AssayRequest[], scores: Record<string, number>, bothExtinctKeys = new Set<string>(), localOnlyMissingKeys = new Set<string>()): RootEstimate {
  if (requests.length !== 128) throw Error(`paired root needs 128 technical requests, got ${requests.length}`);
  const groups = new Map<string, AssayRequest[]>();
  for (const r of requests) { if (r.time !== 0 && r.time !== 1000000) throw Error("paired root includes wrong time"); const k = `${r.mode}:${r.time}:${r.draw}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const mode of ["normal", "off"] as const) for (const time of [0, 1000000]) for (const draw of [0, 1]) {
    const group = groups.get(`${mode}:${time}:${draw}`);
    if (!group || group.length !== 16 || new Set(group.map((x) => `${x.assaySeed}:${x.assignment}`)).size !== 16) throw Error("incomplete exact assay roster");
  }
  const statuses = new Set(requests.map((r) => r.status));
  const symbolicKey = (r: AssayRequest): string => {
    if (r.time === 0) {
      const key = assayIdentity(r.ancestorHex, r.ancestorHex, r.assaySeed, r.assignment, assayConfig(r.assaySeed));
      if (r.status === "scheduled" && (r.descendantHex !== r.ancestorHex || r.assayKey !== key)) throw Error("time-zero identical baseline identity drift");
      return key;
    }
    // No assay identity exists for a biologically absent or unresolved
    // sample. Its unobserved mean of 32 bounded scores is itself in [-1,1];
    // one symbol per root/time/mode gives the same sharp interval without
    // multiplying identical uncertainty across 32 scheduled replicas.
    if (r.assayKey && scores[r.assayKey] === undefined && localOnlyMissingKeys.has(r.assayKey)) return `missing-mean:${r.cohort}:${r.seed}:${r.time}:${r.root}:${r.mode}`;
    return r.assayKey ?? `unavailable-mean:${r.cohort}:${r.seed}:${r.time}:${r.root}:${r.mode}`;
  };
  const expr = (mode: "normal" | "off", time: number) => mean([0, 1].map((draw) => mean(groups.get(`${mode}:${time}:${draw}`)!.map((r) => assayTerm(symbolicKey(r))))));
  const contrast = linear({ score: expr("normal", 1000000), weight: 1 }, { score: expr("normal", 0), weight: -1 }, { score: expr("off", 1000000), weight: -1 }, { score: expr("off", 0), weight: 1 });
  const range = interval(contrast, scores);
  // Completeness uses the actual scheduled roster, even when a shared missing
  // time-zero assay cancels algebraically from the contrast's bound.
  const missingRoster = [...new Set(requests.filter((r) => r.status === "scheduled" && !(r.assayKey! in scores)).map((r) => r.assayKey!))];
  const status = statuses.has("unresolved") ? "technical-unresolved" : statuses.has("absent") ? "structural-absence" : requests.some((r) => r.assayKey && bothExtinctKeys.has(r.assayKey)) ? "assay-uninformative" : missingRoster.length ? "assay-missing" : "complete";
  return { status, contrast, availableValue: status === "complete" ? range.lower : null, missingKeys: [...new Set([...range.missing, ...missingRoster])] };
}

export function crossedExpression(random: LinearScore[][], historical: LinearScore[], cohortIndices: number[], seedIndices: number[]): { random: LinearScore; historical: LinearScore; difference: LinearScore } {
  if (random.length !== 8 || random.some((row) => row.length !== 4) || historical.length !== 4 || cohortIndices.length !== 8 || seedIndices.length !== 4) throw Error("crossed estimator shape drift");
  const randomMean = mean(cohortIndices.flatMap((cohort) => seedIndices.map((seed) => random[cohort][seed])));
  const historicalMean = mean(seedIndices.map((seed) => historical[seed])); // one shared reference per seed draw
  return { random: randomMean, historical: historicalMean, difference: linear({ score: randomMean, weight: 1 }, { score: historicalMean, weight: -1 }) };
}

function retentionExpr(progress: EvolutionProgress | null, unitId: string, root: number): LinearScore {
  const sample = progress?.samples.find((s) => s.time === 1000000);
  if (!sample) return { constant: 0.5, terms: { [`retention-unknown:${unitId}:${root}`]: 0.5 } };
  if (sample.rootMasses[root] > 0) return { constant: 1, terms: {} }; // known ancestry proves retention despite other unknown mass
  if (sample.unknownAncestryMass > 0) return { constant: 0.5, terms: { [`retention-unknown:${unitId}:${root}`]: 0.5 } };
  return { constant: 0, terms: {} };
}

export function analyze(design: Design, manifestSha256: string, requests: AssayRequest[], results: AssayResult[], progress: Record<string, EvolutionProgress | null>): Analysis {
  if (requests.length !== design.requestedTechnicalAssays) throw Error("technical request roster count drift");
  const regenerated = buildAssayRequests(design, progress);
  for (let i = 0; i < requests.length; i++) if (JSON.stringify(requests[i]) !== JSON.stringify(regenerated[i])) throw Error(`assay request roster drift at ${i}`);
  const byRequest = new Map(requests.map((r) => [r.id, r])); if (byRequest.size !== requests.length) throw Error("duplicate technical request id");
  const scoreByKey: Record<string, number> = {}, resultByKey = new Map<string, AssayResult>();
  for (const result of results) { validateAssayResult(result); if (result.manifestSha256 !== manifestSha256 || resultByKey.has(result.assayKey)) throw Error(`assay receipt identity/duplicate ${result.assayKey}`); resultByKey.set(result.assayKey, result); if (result.status === "scored") scoreByKey[result.assayKey] = result.score!; }
  const scheduledKeys = new Set(requests.filter((r) => r.status === "scheduled").map((r) => r.assayKey));
  if (scheduledKeys.has(null) || results.some((r) => !scheduledKeys.has(r.assayKey))) throw Error("assay result outside scheduled roster");
  const requestByKey = new Map(requests.filter((r) => r.status === "scheduled").map((r) => [r.assayKey!, r]));
  for (const result of results) { const request = requestByKey.get(result.assayKey)!; if (JSON.stringify(result.cfg) !== JSON.stringify(assayConfig(request.assaySeed)) || !/^[0-9a-f]{16,}$/.test(result.startHash) || !/^[0-9a-f]{16,}$/.test(result.finalHash)) throw Error(`assay receipt config/hash drift ${result.assayKey}`); }
  const missingness = { biologicalAbsent: requests.filter((r) => r.status === "absent").length, ancestryUnresolved: requests.filter((r) => r.status === "unresolved").length, bothExtinct: requests.filter((r) => r.assayKey && resultByKey.get(r.assayKey)?.status === "both-extinct").length, technicalMissing: requests.filter((r) => r.status === "scheduled" && !resultByKey.has(r.assayKey!)).length };
  const byHistoryRoot = new Map<string, AssayRequest[]>();
  for (const r of requests.filter((r) => r.time !== 100000)) { const k = `${r.cohort}:${r.seed}:${r.root}`; byHistoryRoot.set(k, [...(byHistoryRoot.get(k) ?? []), r]); }
  const rootRows: RootEstimate[] = [], bothExtinctKeys = new Set(results.filter((r) => r.status === "both-extinct").map((r) => r.assayKey));
  const usages = new Map<string, Set<string>>();
  for (const r of requests) if (r.status === "scheduled") { const group = `${r.cohort}:${r.seed}:${r.time}:${r.root}:${r.mode}`; usages.set(r.assayKey!, (usages.get(r.assayKey!) ?? new Set()).add(group)); }
  const localOnlyMissingKeys = new Set([...usages].filter(([key, groups]) => !(key in scoreByKey) && groups.size === 1).map(([key]) => key));
  const unitMean = (cohort: string, seed: number): LinearScore => substituteKnown(mean(Array.from({ length: 12 }, (_, root) => { const xs = byHistoryRoot.get(`${cohort}:${seed}:${root}`); if (!xs) throw Error("missing root assay roster"); const estimate = rootContrast(xs, scoreByKey, bothExtinctKeys, localOnlyMissingKeys); rootRows.push(estimate); return estimate.contrast; })), scoreByKey);
  const random = design.cohorts.slice(1).map((cohort) => design.seeds.evolution.map((seed) => unitMean(cohort.id, seed)));
  const historical = design.seeds.evolution.map((seed) => unitMean("historical", seed));
  const allC = Array.from({ length: 8 }, (_, i) => i), allS = [0, 1, 2, 3], point = crossedExpression(random, historical, allC, allS);
  const retentionRandom = design.cohorts.slice(1).map((cohort) => design.seeds.evolution.map((seed) => { const id = `${cohort.id}-seed-${seed}-normal`; return mean(Array.from({ length: 12 }, (_, root) => retentionExpr(progress[id] ?? null, id, root))); }));
  const retentionHistorical = design.seeds.evolution.map((seed) => { const id = `historical-seed-${seed}-normal`; return mean(Array.from({ length: 12 }, (_, root) => retentionExpr(progress[id] ?? null, id, root))); });
  const retentionOffRandom = design.cohorts.slice(1).map((cohort) => design.seeds.evolution.map((seed) => { const id = `${cohort.id}-seed-${seed}-off`; return mean(Array.from({ length: 12 }, (_, root) => retentionExpr(progress[id] ?? null, id, root))); }));
  const retentionOffHistorical = design.seeds.evolution.map((seed) => { const id = `historical-seed-${seed}-off`; return mean(Array.from({ length: 12 }, (_, root) => retentionExpr(progress[id] ?? null, id, root))); });
  const retentionPoint = crossedExpression(retentionRandom, retentionHistorical, allC, allS);
  const retentionOffPoint = crossedExpression(retentionOffRandom, retentionOffHistorical, allC, allS);
  const randomOnMinusOff = interval(linear({ score: retentionPoint.random, weight: 1 }, { score: retentionOffPoint.random, weight: -1 }), {});
  const historicalOnMinusOff = interval(linear({ score: retentionPoint.historical, weight: 1 }, { score: retentionOffPoint.historical, weight: -1 }), {});
  const bounds = { random: interval(point.random, {}), historical: interval(point.historical, {}), difference: interval(point.difference, {}), retentionDifference: interval(retentionPoint.difference, {}) };
  const rng = new Random(BOOTSTRAP_SEED), vectors: Record<string, number[]> = { randomLo: [], randomHi: [], historicalLo: [], historicalHi: [], differenceLo: [], differenceHi: [], retentionLo: [], retentionHi: [] };
  for (let b = 0; b < 10000; b++) {
    const cs = Array.from({ length: 8 }, () => rng.int(8)), ss = Array.from({ length: 4 }, () => rng.int(4));
    const x = crossedExpression(random, historical, cs, ss), r = crossedExpression(retentionRandom, retentionHistorical, cs, ss);
    for (const [name, expr] of [["random", x.random], ["historical", x.historical], ["difference", x.difference], ["retention", r.difference]] as const) { const v = interval(expr, {}); vectors[`${name}Lo`].push(v.lower); vectors[`${name}Hi`].push(v.upper); }
  }
  for (const v of Object.values(vectors)) v.sort((a, b) => a - b);
  const ci = (name: string, level: 0.95 | 0.90) => ({ lower: percentile(vectors[`${name}Lo`], (1 - level) / 2), upper: percentile(vectors[`${name}Hi`], 1 - (1 - level) / 2) });
  const random95 = ci("random", 0.95), historical95 = ci("historical", 0.95), difference95 = ci("difference", 0.95), difference90 = ci("difference", 0.90), retention95 = ci("retention", 0.95);
  const technicalUnresolved = missingness.ancestryUnresolved > 0 || missingness.technicalMissing > 0;
  let decision: Analysis["decision"] = "inconclusive-or-tradeoff";
  if (!technicalUnresolved && random95.lower > 0 && difference95.lower > 0.10 && retention95.lower > -0.05) decision = "random-founder-policy";
  else if (!technicalUnresolved && random95.lower > 0 && historical95.lower > 0 && difference90.lower >= -0.10 && difference90.upper <= 0.10 && retention95.lower > -0.05) decision = "comparable";
  else if (!technicalUnresolved && random95.upper < 0.10 && historical95.upper < 0.10) decision = "neither-meaningfully-improves";
  // Available-case means are calculated below from indexed root estimates, so
  // their denominator is the number of complete paired roots only.
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const byHistoryAvailable = (offset: number, count: number) => Array.from({ length: count }, (_, history) => avg(rootRows.slice(offset + history * 12, offset + (history + 1) * 12).flatMap((r) => r.availableValue === null ? [] : [r.availableValue])));
  const randomHistory = byHistoryAvailable(0, 32), historicalHistory = byHistoryAvailable(384, 4);
  const randomCohorts = Array.from({ length: 8 }, (_, cohort) => avg(randomHistory.slice(cohort * 4, (cohort + 1) * 4).filter((x): x is number => x !== null)));
  const randomAvailable = avg(randomCohorts.filter((x): x is number => x !== null)), historicalAvailable = avg(historicalHistory.filter((x): x is number => x !== null));
  const retentionKnown = (cohort: string) => design.seeds.evolution.flatMap((seed) => { const sample = progress[`${cohort}-seed-${seed}-normal`]?.samples.find((s) => s.time === 1000000); return sample ? sample.rootMasses.map((mass) => mass > 0 ? 1 : 0) : Array(12).fill(0); });
  const randomRetained = design.cohorts.slice(1).flatMap((x) => retentionKnown(x.id)), historicalRetained = retentionKnown("historical");
  const normalUnknownSlots = design.histories.filter((h) => h.mode === "normal").reduce((sum, h) => { const sample = progress[h.id]?.samples.find((s) => s.time === 1000000); return sum + (!sample ? 12 : sample.rootMasses.filter((mass) => mass === 0 && sample.unknownAncestryMass > 0).length); }, 0);
  const requestBySampleRoot = new Map<string, AssayRequest[]>();
  for (const r of requests) { const key = `${r.history}:${r.time}:${r.root}`; requestBySampleRoot.set(key, [...(requestBySampleRoot.get(key) ?? []), r]); }
  const rootScore = (history: string, time: number, root: number): number | null => { const rs = requestBySampleRoot.get(`${history}:${time}:${root}`); if (!rs || rs.length !== 32 || rs.some((r) => r.status !== "scheduled" || !(r.assayKey! in scoreByKey))) return null; return rs.reduce((sum, r) => sum + scoreByKey[r.assayKey!], 0) / 32; };
  const descriptive: DescriptiveRow[] = design.histories.flatMap((unit) => design.times.map((time) => {
    const scores = Array.from({ length: 12 }, (_, root) => rootScore(unit.id, time, root));
    const gains = Array.from({ length: 12 }, (_, root) => { const baseline = rootScore(unit.id, 0, root); return scores[root] === null || baseline === null ? null : scores[root]! - baseline; });
    const sample = progress[unit.id]?.samples.find((s) => s.time === time), masses = sample?.rootMasses ?? null, total = masses?.reduce((a, b) => a + b, 0) ?? 0;
    return { history: unit.id, cohort: unit.cohort, seed: unit.seed, mode: unit.mode, time, meanCompetitiveScore: avg(scores.filter((x): x is number => x !== null)), completeScoreRoots: scores.filter((x) => x !== null).length, meanGainFromTimeZero: avg(gains.filter((x): x is number => x !== null)), completeGainRoots: gains.filter((x) => x !== null).length, knownRetainedRoots: masses?.filter((x) => x > 0).length ?? 0, possibleRetainedRoots: sample ? masses!.filter((x) => x > 0).length + (sample.unknownAncestryMass > 0 ? masses!.filter((x) => x === 0).length : 0) : 12, rootMasses: masses, relativeAbundance: masses?.map((x) => total ? x / total : null) ?? null, unknownAncestryMass: sample?.unknownAncestryMass ?? null, unassociatedMass: sample?.unassociatedMass ?? null };
  }));
  return { format: "founder-policy-analysis/v1", manifestSha256, requestedAssays: requests.length, scheduledAssays: requests.filter((r) => r.status === "scheduled").length, uniqueAssays: scheduledKeys.size, assayResults: results.length, missingness, descriptive, availableCase: { random: randomAvailable, historical: historicalAvailable, difference: randomAvailable !== null && historicalAvailable !== null ? randomAvailable - historicalAvailable : null, completePairedRoots: rootRows.filter((r) => r.status === "complete").length, totalPairedRoots: rootRows.length }, bounds: { random: { lower: bounds.random.lower, upper: bounds.random.upper }, historical: { lower: bounds.historical.lower, upper: bounds.historical.upper }, difference: { lower: bounds.difference.lower, upper: bounds.difference.upper }, retentionDifference: { lower: bounds.retentionDifference.lower, upper: bounds.retentionDifference.upper } }, bootstrap: { replicates: 10000, random95, historical95, difference95, difference90, retention95 }, retention: { randomKnownLowerBound: randomRetained.reduce((a, b) => a + b, 0) / randomRetained.length, historicalKnownLowerBound: historicalRetained.reduce((a, b) => a + b, 0) / historicalRetained.length, normalUnknownSlots, normalTotalSlots: 9 * 4 * 12, randomOnMinusOff: { lower: randomOnMinusOff.lower, upper: randomOnMinusOff.upper }, historicalOnMinusOff: { lower: historicalOnMinusOff.lower, upper: historicalOnMinusOff.upper } }, decision, limitations: ["Genome-associated competition, not organism fitness", "Biologically absent roots have no measured competitive ability; full-slot performance bounds are mathematical non-identifiability envelopes", "Available-case estimates condition on complete paired root rosters", "Archive sampling conditions on a biased survival-filtered and inexact-resume record"] };
}

export function renderAnalysisMarkdown(report: Analysis): string {
  const fmt = (x: number | null) => x === null ? "unavailable" : Number.isFinite(x) ? x.toFixed(4) : "invalid";
  const band = (x: Interval) => `[${fmt(x.lower)}, ${fmt(x.upper)}]`;
  const groups = new Map<string, DescriptiveRow[]>();
  for (const row of report.descriptive) { const key = `${row.cohort}|${row.mode}|${row.time}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const avg = (xs: (number | null)[]) => { const found = xs.filter((x): x is number => x !== null); return found.length ? found.reduce((a, b) => a + b, 0) / found.length : null; };
  const descriptive = [...groups].map(([key, rows]) => { const [cohort, mode, time] = key.split("|"); return `| ${cohort} | ${mode} | ${time} | ${fmt(avg(rows.map((x) => x.meanCompetitiveScore)))} | ${fmt(avg(rows.map((x) => x.meanGainFromTimeZero)))} | ${fmt(avg(rows.map((x) => x.knownRetainedRoots / 12)))} | ${fmt(avg(rows.map((x) => x.possibleRetainedRoots / 12)))} |`; });
  return [
    "# Founder-policy comparison — generated analysis",
    "",
    `Manifest SHA-256: \`${report.manifestSha256}\`. Decision: **${report.decision}**. This is an exploratory genome-associated competition comparison, not an organism-fitness result.`,
    "",
    `Requested technical observations: ${report.requestedAssays}; scheduled: ${report.scheduledAssays}; exact unique assays: ${report.uniqueAssays}; assay receipts: ${report.assayResults}.`,
    `Missingness (requested observations): biological absence ${report.missingness.biologicalAbsent}, unresolved ancestry ${report.missingness.ancestryUnresolved}, both-extinct ${report.missingness.bothExtinct}, technical assay missing ${report.missingness.technicalMissing}.`,
    "",
    "## Primary contrasts",
    "",
    `Random mutation-dependent gain bound: ${band(report.bounds.random)}; historical: ${band(report.bounds.historical)}; random minus historical: ${band(report.bounds.difference)}.`,
    `Crossed-bootstrap 95% intervals (including unavailable-score bounds): random ${band(report.bootstrap.random95)}, historical ${band(report.bootstrap.historical95)}, difference ${band(report.bootstrap.difference95)}, normal-mutation retention difference ${band(report.bootstrap.retention95)}. Difference 90% equivalence interval: ${band(report.bootstrap.difference90)}.`,
    `Available-case complete paired roots: ${report.availableCase.completePairedRoots}/${report.availableCase.totalPairedRoots}. Conditional means: random ${fmt(report.availableCase.random)}, historical ${fmt(report.availableCase.historical)}, difference ${fmt(report.availableCase.difference)}.`,
    `Normal-mutation retention known lower bounds: random ${fmt(report.retention.randomKnownLowerBound)}, historical ${fmt(report.retention.historicalKnownLowerBound)}; unknown slots ${report.retention.normalUnknownSlots}/${report.retention.normalTotalSlots}. Random on-minus-off retention ${band(report.retention.randomOnMinusOff)}; historical ${band(report.retention.historicalOnMinusOff)}.`,
    "",
    "## Descriptive trajectories",
    "",
    "Means below use available complete root assays within each history, then equal history weights; null histories remain unavailable. Retention columns are fixed 12-slot lower and upper bounds. Full root-mass and relative-abundance arrays are in the JSON ledger.",
    "",
    "| Cohort | Mutation | Step | Competitive score | Gain from time zero | Retention lower | Retention upper |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...descriptive,
    "",
    "## Limits",
    "",
    ...report.limitations.map((x) => `- ${x}`),
    "",
  ].join("\n");
}
