/** Fixed phase budget and all-row allocation for one source-bound Probe A plan. */
import { relative, resolve } from "node:path";
import type { ResetDesign } from "./reset-probe-a-auth.ts";

export const RESET_PROBE_A_BUDGET = {
  phaseGpuSeconds: 21600,
  globalGpuSeconds: 28800,
  assayCpuSeconds: 43200,
  totalNewOutputBytes: 20 * 1024 * 1024 * 1024,
  activeLabelsBytes: 512 * 1024 * 1024,
  technicalRetriesMaximum: 2,
} as const;

/** Require space for a durable initial result and receipt before reserving a GPU run. */
export function assertResetInitialOutputRoom(currentBytes: number,
  reservationBytes: number, initialSnapshotBytes: number, limitBytes: number,
  receiptReserveBytes = 1024 * 1024): void {
  if (![currentBytes, reservationBytes, initialSnapshotBytes, limitBytes,
    receiptReserveBytes].every(x => Number.isSafeInteger(x) && x >= 0) ||
      currentBytes + reservationBytes + initialSnapshotBytes +
        receiptReserveBytes > limitBytes)
    throw new Error("Probe A output cap cannot hold initial snapshot and terminal receipt");
}

export type ResetProbeAPlan = {
  format: 1; id: "probe-a-execution-plan-v1";
  status: "planned-not-launch-approved";
  workspace: "/Users/nicholas/develop/browser-life-foundations";
  createdAt: string;
  design: { path: string; sha256: string };
  freeze: { path: string; sha256: string };
  outputRoot: string;
  budget: typeof RESET_PROBE_A_BUDGET & { developmentChargedSeconds: number };
  perHistoryMaxSeconds: number;
  histories: { history: number; seed: number; rowIndices: number[];
    sourceDirectory: string; checkpointSteps: number[];
    continuousWindow: ResetDesign["histories"][number]["continuousWindow"] }[];
  allRows: { rowIndex: number; history: number; initialStatus: "not-run" }[];
};

export function buildResetProbeAPlan(design: ResetDesign, designPath: string,
  designSha256: string, freezePath: string, freezeSha256: string,
  outputRoot: string, perHistoryMaxSeconds: number,
  developmentChargedSeconds: number): ResetProbeAPlan {
  const base = "/Users/nicholas/develop/browser-life-foundations/runs/foundational-reset";
  const child = relative(base, resolve(outputRoot));
  if (!/^[a-f0-9]{64}$/.test(designSha256) ||
      !/^[a-f0-9]{64}$/.test(freezeSha256) ||
      !Number.isSafeInteger(perHistoryMaxSeconds) || perHistoryMaxSeconds < 1 ||
      perHistoryMaxSeconds > 3600 ||
      !Number.isSafeInteger(developmentChargedSeconds) ||
      developmentChargedSeconds < 780 || developmentChargedSeconds > 3600 ||
      !/^probe-a-run-[a-z0-9-]+$/.test(child) || resolve(outputRoot) !== outputRoot)
    throw new Error("Probe A plan paths, source identities or per-history cap invalid");
  const plan: ResetProbeAPlan = { format: 1, id: "probe-a-execution-plan-v1",
    status: "planned-not-launch-approved",
    workspace: "/Users/nicholas/develop/browser-life-foundations",
    createdAt: new Date().toISOString(),
    design: { path: designPath, sha256: designSha256 },
    freeze: { path: freezePath, sha256: freezeSha256 }, outputRoot,
    budget: { ...RESET_PROBE_A_BUDGET, developmentChargedSeconds },
    perHistoryMaxSeconds,
    histories: design.histories.map(h => ({ history: h.history, seed: h.seed,
      rowIndices: [...h.rowIndices], sourceDirectory: h.sourceDirectory,
      checkpointSteps: [...h.checkpointSteps],
      continuousWindow: { ...h.continuousWindow } })),
    allRows: design.sample.rows.map(row => ({ rowIndex: row.rowIndex,
      history: row.h, initialStatus: "not-run" })),
  };
  validateResetProbeAPlan(plan, design);
  return plan;
}

export function validateResetProbeAPlan(plan: ResetProbeAPlan, design: ResetDesign): void {
  const base = "/Users/nicholas/develop/browser-life-foundations/runs/foundational-reset";
  const child = relative(base, resolve(plan.outputRoot));
  const { developmentChargedSeconds, ...staticBudget } = plan.budget;
  if (plan.format !== 1 || plan.id !== "probe-a-execution-plan-v1" ||
      plan.status !== "planned-not-launch-approved" ||
      plan.workspace !== "/Users/nicholas/develop/browser-life-foundations" ||
      !/^probe-a-run-[a-z0-9-]+$/.test(child) ||
      resolve(plan.outputRoot) !== plan.outputRoot ||
      JSON.stringify(staticBudget) !== JSON.stringify(RESET_PROBE_A_BUDGET) ||
      !Number.isSafeInteger(developmentChargedSeconds) ||
      developmentChargedSeconds < 780 || developmentChargedSeconds > 3600 ||
      !Number.isSafeInteger(plan.perHistoryMaxSeconds) ||
      plan.perHistoryMaxSeconds < 1 || plan.perHistoryMaxSeconds > 3600 ||
      !Array.isArray(plan.histories) || plan.histories.length !== 10 ||
      !Array.isArray(plan.allRows) || plan.allRows.length !== 200)
    throw new Error("Probe A execution plan weakens frozen phase bounds");
  for (let i = 0; i < 10; i++) {
    const expected = design.histories[i], actual = plan.histories[i];
    if (actual.history !== expected.history || actual.seed !== expected.seed ||
        actual.sourceDirectory !== expected.sourceDirectory ||
        JSON.stringify(actual.rowIndices) !== JSON.stringify(expected.rowIndices) ||
        JSON.stringify(actual.checkpointSteps) !== JSON.stringify(expected.checkpointSteps) ||
        JSON.stringify(actual.continuousWindow) !== JSON.stringify(expected.continuousWindow))
      throw new Error("Probe A plan moved a selected history or window");
  }
  for (let i = 0; i < 200; i++) {
    const expected = design.sample.rows[i], actual = plan.allRows[i];
    if (actual.rowIndex !== expected.rowIndex || actual.history !== expected.h ||
        actual.initialStatus !== "not-run")
      throw new Error("Probe A plan omits or preclassifies an original row");
  }
}
