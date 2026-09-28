/** Descriptive Probe A summary. No majority classifier, pooled independence or reproduction verdict. */
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { ResetLinkEvidence, ResetSelectedLink } from "./lib/reset-probe-a-analysis.ts";

type Attempt = {
  status: string; history: number; attempt: number;
  planSha256: string; designSha256: string; sourcePostvalidated: boolean;
  evidence: ResetLinkEvidence[];
  checkpointVerifications: { step: number; physicsHash: string; artifactDigest: string }[];
  mutationLedger: { sourceSha256: string; replaySha256: string | null; count: number; dropped: number };
  lifeLedger: { sourceSha256: string; replaySha256: string | null; count: number };
  lineageLedger: { sourceSha256: string; replaySha256: string | null; count: number };
  windows: {
    frames: { step: number; trackerIntervalCooccurrence: string;
      flags: { step: number; priorComponent: number; branches: { currentComponent: number }[] }[] }[];
    persistence: { flagStep: number; priorComponent: number;
      branchComponentIndices: number[]; status: string;
      samples: { step: number; offset: number; status: string }[] }[];
  };
};
type Design = { sample: { rows: ResetSelectedLink[] }; histories: {
  history: number; rowIndices: number[]; checkpointSteps: number[];
  continuousWindow: { candidateStepsFirst: number; candidateStepsLast: number };
}[] };
type Checkpoint = { h: number; step: number; physicsHash: string; artifactHash: string };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sameRow = (a: ResetSelectedLink, b: ResetSelectedLink) =>
  (Object.keys(a) as (keyof ResetSelectedLink)[]).every(k => a[k] === b[k]) &&
  Object.keys(a).length === Object.keys(b).length;

export function authenticateResetCompletion(attempt: Attempt,
  result: { sha256: string; bytes: number },
  receipt: { status: string; history: number; attempt: number; planSha256: string;
    designSha256: string; freezeSha256: string; resultSha256: string; resultBytes: number },
  expected: { planSha256: string; designSha256: string; freezeSha256: string }): void {
  need(receipt.status === "complete" && receipt.status === attempt.status &&
    receipt.history === attempt.history && receipt.attempt === attempt.attempt &&
    receipt.planSha256 === expected.planSha256 && receipt.designSha256 === expected.designSha256 &&
    receipt.freezeSha256 === expected.freezeSha256 && receipt.resultSha256 === result.sha256 &&
    receipt.resultBytes === result.bytes, "terminal completion receipt does not authenticate result bytes");
}

export function admitResetAttempt(attempt: Attempt, design: Design,
  expected: { planSha256: string; designSha256: string; checkpoints: Checkpoint[] }): void {
  need(attempt.status === "complete" && attempt.sourcePostvalidated === true,
    "only terminal postvalidated complete attempts may enter the analysis");
  need(attempt.planSha256 === expected.planSha256 && attempt.designSha256 === expected.designSha256,
    "attempt belongs to another execution plan or scientific design");
  const history = design.histories.find(h => h.history === attempt.history);
  need(history && Number.isSafeInteger(attempt.attempt) && attempt.attempt >= 1 && attempt.attempt <= 3,
    "unknown history or invalid attempt identity");
  need(attempt.evidence.length === history.rowIndices.length &&
    new Set(attempt.evidence.map(r => r.original.rowIndex)).size === history.rowIndices.length,
    "completed history omits or duplicates selected links");
  for (const row of attempt.evidence) {
    const original = design.sample.rows.find(r => r.rowIndex === row.original.rowIndex);
    need(original && original.h === attempt.history && sameRow(original, row.original),
      "result changes a selected link identity or original metadata");
    if (row.status === "unavailable-child-support") {
      need(row.birthCopyShare === null && row.samples.length === 0,
        "unavailable child support contains a contradictory measurement");
      continue;
    }
    need(row.status === "available" && row.birthCopyShare && row.birthReferences,
      "completed link lacks declared observation evidence");
    const share = row.birthCopyShare;
    need(share.genomeBearingSites === 0 || share.status !== "unavailable-no-genome-bearing-child-sites",
      "nonempty child wrongly declared an empty denominator");
    if (share.status === "available") {
      need(share.genomeBearingSites > 0 &&
        [share.parentLinkedSites, share.knownNonparentSites, share.unknownSites].every(
          v => Number.isSafeInteger(v) && v !== null && v >= 0) &&
        share.parentLinkedSites! + share.knownNonparentSites! + share.unknownSites! === share.genomeBearingSites,
        "available attribution has an invalid denominator or missing origins");
      const interval = share.parentCellFractionInterval;
      need(interval && interval[0] === share.parentLinkedSites! / share.genomeBearingSites &&
        interval[1] === (share.parentLinkedSites! + share.unknownSites!) / share.genomeBearingSites,
        "copy-attribution interval differs from retained counts");
    } else need(share.parentCellFractionInterval === null,
      "unavailable attribution was assigned a numeric fraction");
    need(row.samples.length === 22, "completed child lacks the two eleven-sample graph series");
    for (const [threshold, neighbors] of [[48, 4], [1, 8]]) {
      const samples = row.samples.filter(s => s.rule.threshold === threshold && s.rule.neighbors === neighbors);
      need(samples.length === 11 && samples.every((s, i) =>
        s.birthStep === original.step && s.step === original.step + i * 100 &&
        s.timeSinceObservedBirth === i * 100 && s.comparisons.length === row.birthReferences!.branches.length - 1),
        "follow-up changes its birth reference, cadence or comparison set");
    }
  }
  need(attempt.checkpointVerifications.length === history.checkpointSteps.length,
    "complete attempt lacks every original checkpoint");
  for (let i = 0; i < history.checkpointSteps.length; i++) {
    const step = history.checkpointSteps[i], actual = attempt.checkpointVerifications[i];
    const pinned = expected.checkpoints.find(c => c.h === attempt.history && c.step === step);
    need(pinned && actual.step === step && actual.physicsHash === pinned.physicsHash &&
      actual.artifactDigest === pinned.artifactHash, "original physical/observer checkpoint mismatch");
  }
  need(attempt.mutationLedger.dropped === 0, "mutation events were dropped");
  for (const ledger of [attempt.mutationLedger, attempt.lifeLedger, attempt.lineageLedger])
    need(/^[a-f0-9]{64}$/.test(ledger.sourceSha256) &&
      ledger.sourceSha256 === ledger.replaySha256 && Number.isSafeInteger(ledger.count) && ledger.count >= 0,
      "completed attempt lacks exact original event-stream agreement");
  const window = history.continuousWindow, frames = attempt.windows.frames;
  need(frames.length === 1000 && frames.every((f, i) => f.step === window.candidateStepsFirst + i &&
    ["fission", "budding", "both", "neither"].includes(f.trackerIntervalCooccurrence)),
    "continuous-window coverage or census co-occurrence is incomplete");
  const flags = frames.flatMap(f => {
    need(f.flags.every(flag => flag.step === f.step), "raw flag is attached to another step");
    return f.flags;
  });
  const key = (step: number, component: number) => `${step}:${component}`;
  need(new Set(flags.map(f => key(f.step, f.priorComponent))).size === flags.length,
    "duplicate raw candidate flag");
  const descriptors = attempt.windows.persistence;
  need(descriptors.length === flags.length && new Set(descriptors.map(
    d => key(d.flagStep, d.priorComponent))).size === flags.length,
    "window persistence omits or duplicates a raw flag");
  const flagsByKey = new Map(flags.map(f => [key(f.step, f.priorComponent), f]));
  for (const descriptor of descriptors) {
    const flag = flagsByKey.get(key(descriptor.flagStep, descriptor.priorComponent));
    need(flag && JSON.stringify(descriptor.branchComponentIndices) ===
      JSON.stringify(flag.branches.map(b => b.currentComponent)) &&
      descriptor.status === "complete-100-future-samples" && descriptor.samples.length === 100 &&
      descriptor.samples.every((s, i) => s.offset === i + 1 && s.step === descriptor.flagStep + i + 1),
      "candidate persistence is not the complete frozen one-hundred-step follow-up");
  }
}

export function describeResetRows(originals: readonly ResetSelectedLink[], evidence: readonly ResetLinkEvidence[]) {
  const rows = new Map(evidence.map(r => [r.original.rowIndex, r]));
  const availability: Record<string, number> = {};
  const graphComparisonObservations: Record<string, Record<string, number>> = { "48/4": {}, "1/8": {} };
  const allElevenKnownDisconnected: Record<string, number> = { "48/4": 0, "1/8": 0 };
  const categories = { zeroKnownAndNoUnknown: 0, allParentAndNoUnknown: 0,
    mixedKnownOrigins: 0, unresolvedExactFraction: 0 };
  let lower = 0, upper = 0, definedFractionRows = 0;
  let carrierLower = 0, carrierUpper = 0, definedCarrierFractionRows = 0;
  for (const original of originals) {
    const row = rows.get(original.rowIndex), share = row?.birthCopyShare;
    const status = !row ? "not-admitted" : row.status !== "available" ? row.status : share?.status ?? "missing-share";
    availability[status] = (availability[status] ?? 0) + 1;
    if (share?.status === "available" && share.parentCellFractionInterval) {
      definedFractionRows++; lower += share.parentCellFractionInterval[0]; upper += share.parentCellFractionInterval[1];
      if (share.unknownSites! > 0) categories.unresolvedExactFraction++;
      else if (share.parentLinkedSites === 0) categories.zeroKnownAndNoUnknown++;
      else if (share.parentLinkedSites === share.genomeBearingSites) categories.allParentAndNoUnknown++;
      else categories.mixedKnownOrigins++;
    }
    if (share?.status === "available" && share.parentBoundCarrierFractionInterval) {
      definedCarrierFractionRows++;
      carrierLower += share.parentBoundCarrierFractionInterval[0];
      carrierUpper += share.parentBoundCarrierFractionInterval[1];
    }
    for (const [threshold, neighbors] of [[48, 4], [1, 8]]) {
      const name = `${threshold}/${neighbors}`;
      const samples = row?.samples.filter(s => s.rule.threshold === threshold && s.rule.neighbors === neighbors) ?? [];
      for (const sample of samples) for (const comparison of sample.comparisons)
        graphComparisonObservations[name][comparison.status] =
          (graphComparisonObservations[name][comparison.status] ?? 0) + 1;
      if (samples.length === 11 && samples.every(s => s.comparisons.length > 0 &&
        s.comparisons.every(c => c.status === "sampled-disconnected"))) allElevenKnownDisconnected[name]++;
    }
  }
  return { originalRows: originals.length, admittedRows: originals.filter(r => rows.has(r.rowIndex)).length,
    availability, definedFractionRows, categories,
    conditionalMeanCellFractionBounds: definedFractionRows ? [lower / definedFractionRows, upper / definedFractionRows] : null,
    definedCarrierFractionRows,
    conditionalMeanBoundCarrierFractionBounds: definedCarrierFractionRows ?
      [carrierLower / definedCarrierFractionRows, carrierUpper / definedCarrierFractionRows] : null,
    graphComparisonObservations, allElevenKnownDisconnected,
    interpretation: "Fractions are conditional on a defined genome-bearing denominator; missing rows are not imputed as zero. Bound carrier fractions describe current mass associated with copy origins, never inherited material. Graph counts are dependent observations, not independent replicates." };
}

if (import.meta.main) {
  const [planPath, preflightPath, outputPath, ...attemptPaths] = Deno.args;
  need(planPath && preflightPath && outputPath, "usage: reset-summarize.ts PLAN PREFLIGHT NEW_OUTPUT [RESULT ...]");
  const read = async (path: string) => { const bytes = await Deno.readFile(path);
    return { path, sha256: sha(bytes), bytes: bytes.length, data: JSON.parse(new TextDecoder().decode(bytes)) }; };
  const plan = await read(planPath), preflight = await read(preflightPath);
  const designFile = await read(plan.data.design.path), design = designFile.data as Design;
  need(designFile.sha256 === plan.data.design.sha256 && preflight.data.status === "complete" &&
    design.sample.rows.length === 200 && design.histories.length === 10,
    "summary requires the frozen full design and completed original-input preflight");
  const freeze = await read(plan.data.freeze.path);
  need(freeze.sha256 === plan.data.freeze.sha256, "source-freeze identity changed");
  const pinnedPreflight = freeze.data.evidence.find((e: { path: string }) =>
    e.path.endsWith("/input-preflight-v3.json"));
  need(pinnedPreflight && preflight.sha256 === pinnedPreflight.sha256 &&
    preflight.bytes === pinnedPreflight.bytes, "preflight is not the frozen checkpoint evidence");
  const attempts = await Promise.all(attemptPaths.map(read));
  const receipts = [];
  for (const input of attempts) {
    const a = input.data as Attempt;
    need(resolve(input.path) === resolve(plan.data.outputRoot,
      `history-${a.history}-attempt-${a.attempt}`, "result.json"), "result is outside its planned attempt path");
    if (a.status !== "complete") continue;
    const receipt = await read(join(dirname(input.path), "completion.json"));
    authenticateResetCompletion(a, input, receipt.data, {
      planSha256: plan.sha256, designSha256: designFile.sha256, freezeSha256: freeze.sha256 });
    receipts.push(receipt);
  }
  const admitted: Attempt[] = [], seen = new Set<number>(), identities = new Set<string>();
  for (const input of attempts) {
    const a = input.data as Attempt, key = `${a.history}:${a.attempt}`;
    need(!identities.has(key) && a.planSha256 === plan.sha256 && a.designSha256 === designFile.sha256,
      "duplicate attempt or attempt from another plan/design"); identities.add(key);
    if (a.status !== "complete") continue;
    need(!seen.has(a.history), "multiple complete attempts for one history cannot be selectively pooled");
    admitResetAttempt(a, design, { planSha256: plan.sha256, designSha256: designFile.sha256,
      checkpoints: preflight.data.checkpoints });
    seen.add(a.history); admitted.push(a);
  }
  const evidence = admitted.flatMap(a => a.evidence);
  const histories = design.histories.map(h => ({ history: h.history,
    ...describeResetRows(design.sample.rows.filter(r => r.h === h.history), evidence) }));
  const strata = ["fission", "budding"].flatMap(kind => [true, false].map(clonal => ({ kind, clonal,
    ...describeResetRows(design.sample.rows.filter(r => r.kind === kind &&
      (r.parentLineage === r.childLineage) === clonal), evidence) })));
  const rows = design.sample.rows.map(original => {
    const row = evidence.find(r => r.original.rowIndex === original.rowIndex);
    const historyAttempts = attempts.filter(a => a.data.history === original.h);
    return { original, auditStatus: row ? "admitted-complete-history" : historyAttempts.length ?
      "not-admitted-attempt-incomplete" : "not-run", evidence: row ?? null,
      attemptPaths: historyAttempts.map(a => a.path) };
  });
  const report = { format: 1, status: seen.size === 10 ? "complete-descriptive-audit" : "incomplete-descriptive-audit",
    createdAt: new Date().toISOString(), independentSourceHistories: 10, admittedHistories: seen.size,
    inputs: [plan, preflight, designFile, freeze, ...attempts, ...receipts].map(({ data: _data, ...identity }) => identity),
    rows, histories, strata, pooledDescriptive: describeResetRows(design.sample.rows, evidence),
    interpretation: "Retrospective attribution audit. All 200 links retained; partial attempts are not pooled. Source histories, not rows or censuses, are independent units. Report per-history variation and ancestry bounds; no population confidence interval or reproduction verdict is inferred." };
  await Deno.writeTextFile(outputPath, JSON.stringify(report, null, 2) + "\n", { createNew: true });
  console.log(JSON.stringify({ outputPath, status: report.status, rows: rows.length, admittedHistories: seen.size }));
}
