/** Technical recovery for an abruptly stopped v5 role-cohort run; inference stays in the frozen pure analyzer. */
import { isDeepStrictEqual } from "node:util";
import { SCREEN_EVAL } from "./foundation-screen.ts";
import { analyzeRoleCohort, ROLE_COHORT_SEEDS, type RoleCandidate, type RoleSeedResult } from "./foundation-role-cohort.ts";

const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
export interface ReconcileReport {
  format: string; status: string; sourcePlan: { sha256: string };
  selectedSourceHashes: Record<string, { sha256: string; bytes: number }>;
  budget: { seedStartOffset: number; maxSeeds: number; maxSeconds: number; selectedSeeds: number[] };
  execution: { elapsedSeconds: number; overrunSeconds: number; incompleteSeed: number | null;
    incompleteStage: string | null; error: string | null };
  results: RoleSeedResult[];
}
export interface InterruptionReceipt {
  format: string; createdAt: string; rawReport: { path: string; sha256: string; status: string };
  sourcePlan: { sha256: string }; process: { pid: number; sessionId: number; exitCode: number; signal: string };
  savedSeeds: number[]; nextSeed: { seed: number; status: string }; reportElapsedSeconds: number;
}
export interface CheckedReport { results: RoleSeedResult[]; interrupted: boolean; savedSeeds: number[];
  budgetSeconds: number; lowerBoundAttemptSeconds: number }

/** Validate one raw report, including all 50×30 saved rows, without reclassifying a `running` artifact. */
export function checkRoleReport(candidates: readonly RoleCandidate[], planSha256: string,
  selectedSourceHashes: ReconcileReport["selectedSourceHashes"], report: ReconcileReport,
  rawReportPath: string, rawReportSha256: string, receipt: InterruptionReceipt | null): CheckedReport {
  const b = report.budget;
  if (report.format !== "foundation-m3-role-cohort-execution/v1" || report.sourcePlan?.sha256 !== planSha256 ||
      !same(report.selectedSourceHashes, selectedSourceHashes) ||
      !Number.isSafeInteger(b?.seedStartOffset) || b.seedStartOffset < 0 || b.seedStartOffset > 31 ||
      !Number.isSafeInteger(b.maxSeeds) || b.maxSeeds < 1 || b.maxSeeds > 8 || b.seedStartOffset + b.maxSeeds > 32 ||
      !Number.isFinite(b.maxSeconds) || b.maxSeconds <= 0 || b.maxSeconds > 600 ||
      !same(b.selectedSeeds, ROLE_COHORT_SEEDS.slice(b.seedStartOffset, b.seedStartOffset + b.maxSeeds)) ||
      !Array.isArray(report.results) || report.results.length > b.maxSeeds ||
      report.results.some((r, i) => r.seed !== b.selectedSeeds[i] || !same(r.evalConfig, { ...SCREEN_EVAL, seed: r.seed })) ||
      !Number.isFinite(report.execution?.elapsedSeconds) || report.execution.elapsedSeconds < 0 ||
      !Number.isFinite(report.execution?.overrunSeconds) || report.execution.overrunSeconds < 0)
    throw new Error("foreign, malformed or non-prefix role execution report");
  const interrupted = report.status === "running";
  if (interrupted) {
    if (!receipt || receipt.format !== "foundation-m3-role-cohort-interruption/v1" ||
        receipt.rawReport.path !== rawReportPath || receipt.rawReport.sha256 !== rawReportSha256 ||
        receipt.rawReport.status !== "running" || receipt.sourcePlan?.sha256 !== planSha256 ||
        receipt.process?.exitCode !== 143 || receipt.process.signal !== "SIGTERM" ||
        !same(receipt.savedSeeds, report.results.map((r) => r.seed)) ||
        receipt.nextSeed?.seed !== b.selectedSeeds[report.results.length] ||
        receipt.reportElapsedSeconds !== report.execution.elapsedSeconds)
      throw new Error("running report lacks its exact terminal interruption receipt");
  } else if (receipt || !["bounded-complete", "over-budget-incomplete"].includes(report.status)) {
    throw new Error("unsupported role report status or unexpected interruption receipt");
  } else if (report.status === "bounded-complete" && report.results.length < b.maxSeeds &&
      report.execution.incompleteSeed === null && report.execution.elapsedSeconds < b.maxSeconds) {
    throw new Error("partial bounded-complete report lacks a budget stop");
  } else if (report.status === "over-budget-incomplete" && report.execution.overrunSeconds <= 0 &&
      report.execution.incompleteSeed === null) {
    throw new Error("over-budget report lacks an overrun or stopped seed");
  }
  if (report.results.length && !same(report.results[0].exactParentRepeat,
      { evaluated: true, evaluationIdentical: true, traceIdentical: true }))
    throw new Error("first saved role seed lacks an exact parent repeat");
  // The frozen pure analyzer validates every row identity, 30-frame pointwise schedule,
  // role-frame schedule, binary Evaluation, digest shape and all 24 exact controls.
  analyzeRoleCohort(candidates, report.results);
  return { results: report.results, interrupted, savedSeeds: report.results.map((r) => r.seed),
    budgetSeconds: b.maxSeconds, lowerBoundAttemptSeconds: report.execution.elapsedSeconds };
}
