/** Pure host occupancy and immutable attempt accounting checks for Probe A. */
import type { ResetHistoryResult } from "./reset-probe-a-runtime.ts";
import type { ResetProbeAPlan } from "./reset-probe-a-plan.ts";

export function resetGpuWorkerPid(psOutput: string, selfPid: number): number | null {
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match || Number(match[1]) === selfPid) continue;
    const command = match[2];
    const denoWorker = /(?:^|\/)deno\s+(?:run|test)\b/.test(command) &&
      /(?:reset|foundation|replay|m4|sim-gpu|webgpu)/i.test(command);
    const nodeWorker = /(?:^|\/)node\s+/.test(command) &&
      /(?:gpu|webgpu|foundation|replay|m4)/i.test(command);
    if (denoWorker || nodeWorker) return Number(match[1]);
  }
  return null;
}

export function assertResetAttemptReservation(plan: ResetProbeAPlan,
  planSha256: string, prior: readonly ResetHistoryResult[], history: number, attempt: number,
  requestedMaxSeconds: number): void {
  if (!Number.isSafeInteger(history) || history < 1 || history > 10 ||
      !Number.isSafeInteger(attempt) || attempt < 1 ||
      attempt > plan.budget.technicalRetriesMaximum + 1 ||
      !Number.isSafeInteger(requestedMaxSeconds) || requestedMaxSeconds < 1 ||
      requestedMaxSeconds > plan.perHistoryMaxSeconds)
    throw new Error("Probe A attempt exceeds frozen identity, retry count or per-history cap");
  const identities = new Set<string>();
  for (const p of prior) {
    const key = `${p.history}/${p.attempt}`;
    if (identities.has(key) || p.planSha256 !== planSha256)
      throw new Error("Probe A prior attempt identity is inconsistent");
    identities.add(key);
    if (!Number.isSafeInteger(p.history) || p.history < 1 || p.history > 10 ||
        !Number.isSafeInteger(p.attempt) || p.attempt < 1 || p.attempt > 3 ||
        !Number.isFinite(p.elapsedSeconds) || p.elapsedSeconds < 0 ||
        p.designSha256 !== plan.design.sha256)
      throw new Error("Probe A prior result is malformed or belongs to another design");
  }
  const same = prior.filter(x => x.history === history)
    .sort((a, b) => a.attempt - b.attempt);
  if (same.some(x => x.status === "complete" || x.status === "running") ||
      same.length !== attempt - 1 || same.some((x, i) => x.attempt !== i + 1))
    throw new Error("Probe A history is complete, live or not the next technical retry");
  const consumed = prior.reduce((sum, x) => sum + x.elapsedSeconds, 0);
  if (consumed + requestedMaxSeconds > plan.budget.phaseGpuSeconds ||
      plan.budget.developmentChargedSeconds + consumed + requestedMaxSeconds >
        plan.budget.globalGpuSeconds)
    throw new Error("Probe A cumulative GPU budget cannot reserve this attempt");
}
