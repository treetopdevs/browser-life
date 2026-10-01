// Read-only successor accounting; reviewed decisions administratively retire launch authority once.
// Frozen history launchers remain unchanged and do not consult this ledger. Future
// operational launch wrappers must verify the ledger then call assertHistoryLaunchAuthorized.
// Closure review attests OS/terminal history facts; raw settled accounting is recomputed.
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import { noSymlinks } from "./discovery_improvement_import.ts";
import type { Allocation } from "./discovery_improvement_shard.ts";
export interface Pin {
  path: string;
  sha256: string;
}
export interface SuccessorPayload {
  predecessorAllocationSha256: string;
  retirements: {
    hostId: string;
    closure: Pin;
    closureReview: Pin;
    evidenceDirectory: string;
    actualSeconds: number;
    actualInvocations: number;
  }[];
  cpu: {
    priorReserveSeconds: 3600;
    reserveSeconds: 13600;
    transferSeconds: 10000;
    priorRelease: Pin;
    snapshotDirectory: string;
    operationFiles: Record<string, string>;
    priorChargedSeconds: number;
  };
}
export interface SuccessorLedger {
  format: "discovery-improvement-budget-successor/v1";
  status: "REVIEWED";
  payload: SuccessorPayload;
  decision: Pin;
}
const hash = /^[a-f0-9]{64}$/;
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function path(p: string) {
  const r = relative(Deno.cwd(), resolve(p));
  if (isAbsolute(p) || r === ".." || r.startsWith("../") || isAbsolute(r)) {
    throw Error("budget evidence outside frozen root");
  }
  return resolve(p);
}
async function raw(p: string) {
  const file = path(p);
  await noSymlinks(file);
  const a = await Deno.lstat(file);
  if (!a.isFile) throw Error("nonfile budget evidence");
  const b = await Deno.readFile(file), z = await Deno.lstat(file);
  if (
    z.isSymlink || a.ino !== z.ino || a.size !== z.size ||
    a.mtime?.getTime() !== z.mtime?.getTime()
  ) throw Error("budget evidence changed while reading");
  return b;
}
const parse = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
async function pinned(p: Pin) {
  if (!hash.test(p.sha256)) throw Error("invalid budget evidence pin");
  const b = await raw(p.path);
  if (sha256(b) !== p.sha256) {
    throw Error(`budget evidence hash drift ${p.path}`);
  }
  return { value: parse(b), bytes: b };
}
export function assertHistoryLaunchAuthorized(
  ledger: SuccessorLedger,
  hostId: string,
) {
  if (
    ledger.format !== "discovery-improvement-budget-successor/v1" ||
    ledger.status !== "REVIEWED" || ledger.payload.retirements.length !== 1 ||
    ledger.payload.retirements[0].hostId !== "local"
  ) throw Error("invalid reviewed launch authority ledger");
  if (ledger.payload.retirements.some((r) => r.hostId === hostId)) {
    throw Error("history launch authority administratively retired");
  }
}
export function payloadHash(payload: SuccessorPayload) {
  return sha256(JSON.stringify(payload));
}
export function summarizeSuccessor(
  a: Allocation,
  p: SuccessorPayload,
  actual: { seconds: number; invocations: number; cpuCharged: number },
) {
  const local = a.hosts.find((h) => h.id === "local"),
    remote = a.hosts.find((h) => h.id !== "local");
  if (
    !local || !remote || a.hosts.length !== 2 || local.capSeconds !== 100000 ||
    local.maxInvocations !== 170 || remote.capSeconds !== 130000 ||
    remote.maxInvocations !== 220 || p.retirements.length !== 1 ||
    p.retirements[0].hostId !== "local" ||
    new Set(p.retirements.map((r) => r.hostId)).size !== p.retirements.length
  ) throw Error("duplicate/foreign/unsupported allocation retirement");
  const retirement = p.retirements[0];
  if (
    !Number.isFinite(actual.seconds) || actual.seconds < 0 ||
    actual.seconds > local.capSeconds ||
    !Number.isInteger(actual.invocations) || actual.invocations <= 0 ||
    actual.invocations > local.maxInvocations ||
    retirement.actualSeconds !== actual.seconds ||
    retirement.actualInvocations !== actual.invocations
  ) throw Error("retirement accounting drift/overbudget");
  if (
    p.cpu.priorReserveSeconds !== 3600 || p.cpu.reserveSeconds !== 13600 ||
    p.cpu.transferSeconds !== 10000 ||
    local.capSeconds - actual.seconds < p.cpu.transferSeconds ||
    !Number.isFinite(actual.cpuCharged) || actual.cpuCharged < 0 ||
    actual.cpuCharged > 3600 || p.cpu.priorChargedSeconds !== actual.cpuCharged
  ) throw Error("CPU transfer/prior charges drift/overbudget");
  const historyReservedSeconds = a.globalPriorSeconds + remote.capSeconds +
      actual.seconds,
    historyReservedInvocations = a.priorInvocations + remote.maxInvocations +
      actual.invocations;
  const remainingSeconds = 345600 - historyReservedSeconds -
      a.engineeringReserveSeconds - p.cpu.reserveSeconds,
    remainingInvocations = 576 - historyReservedInvocations -
      a.engineeringReserveInvocations;
  if (
    !Number.isFinite(remainingSeconds) || remainingSeconds < 86000 ||
    remainingInvocations < 150
  ) throw Error("successor aggregate envelope exceeded");
  return {
    globalCapSeconds: 345600 as const,
    globalMaxInvocations: 576 as const,
    historyReservedSeconds,
    historyReservedInvocations,
    engineeringReservedSeconds: a.engineeringReserveSeconds,
    engineeringReservedInvocations: a.engineeringReserveInvocations,
    cpuReservedSeconds: p.cpu.reserveSeconds,
    remainingSeconds,
    remainingInvocations,
    reservationSeconds: 3600 as const,
    retiredHostIds: ["local"],
    recoveredUnallocatedInvocations: local.maxInvocations - actual.invocations,
    cpuPriorChargedSeconds: actual.cpuCharged,
    cpuFutureAvailableSeconds: p.cpu.reserveSeconds - actual.cpuCharged,
    remoteReservationUnchanged: true,
  };
}
export function validateSettledParents(
  records: any[],
  allocationSha256: string,
  hostId: string,
) {
  let seconds = 0;
  for (const record of records) {
    if (
      record.allocationHash !== allocationSha256 || record.hostId !== hostId ||
      record.status !== "settled" || !Number.isFinite(record.chargedSeconds) ||
      record.chargedSeconds < 0 || !Number.isInteger(record.supervisorPid) ||
      record.supervisorPid <= 0
    ) throw Error("foreign/unsettled/invalid parent receipt");
    seconds += record.chargedSeconds;
  }
  return { seconds, invocations: records.length };
}
export function validateCpuOperations(
  records: any[],
  releaseSha256: string,
  maximumSeconds: number,
) {
  let charged = 0;
  for (const record of records) {
    if (
      record.releaseSha256 !== releaseSha256 ||
      !["settled", "reserved", "failed"].includes(record.status) ||
      !Number.isFinite(record.chargedSeconds) || record.chargedSeconds < 0 ||
      record.chargedSeconds > maximumSeconds ||
      (record.status !== "settled" && record.chargedSeconds !== maximumSeconds)
    ) throw Error("foreign/discounted failed CPU operation");
    charged += record.chargedSeconds;
  }
  return charged;
}
export async function verifySuccessorLedger(
  a: Allocation,
  allocationSha256: string,
  ledger: SuccessorLedger,
) {
  if (
    ledger.format !== "discovery-improvement-budget-successor/v1" ||
    ledger.status !== "REVIEWED" ||
    ledger.payload.predecessorAllocationSha256 !== allocationSha256
  ) throw Error("reviewed successor/predecessor identity required");
  const p = ledger.payload;
  if (p.retirements.length !== 1 || p.retirements[0].hostId !== "local") {
    throw Error("duplicate/foreign retirement");
  }
  const decision = (await pinned(ledger.decision)).value;
  if (
    decision.format !== "discovery-improvement-budget-successor-review/v1" ||
    decision.verdict !== "approved" ||
    decision.predecessorAllocationSha256 !== allocationSha256 ||
    decision.payloadSha256 !== payloadHash(p) ||
    !same(decision.retiredHostIds, ["local"]) || !decision.reviewedBy ||
    !Number.isFinite(Date.parse(decision.reviewedAt))
  ) throw Error("successor review decision mismatch");
  const retirement = p.retirements[0],
    closureEvidence = await pinned(retirement.closure),
    closure = closureEvidence.value,
    review = (await pinned(retirement.closureReview)).value,
    host = a.hosts.find((h) => h.id === "local")!;
  if (
    review.format !== "discovery-history-closure-review/v1" ||
    review.verdict !== "clear" ||
    review.closureSha256 !== retirement.closure.sha256 ||
    closure.format !== "discovery-history-host-closure/v1" ||
    closure.hostId !== "local" ||
    closure.allocationSha256 !== allocationSha256 ||
    closure.originalRoot !== resolve(host.root, host.outputRel) ||
    closure.processEvidence?.locksAbsent !== true ||
    closure.processEvidence?.psExitCode !== 1 ||
    closure.processEvidence?.stdout !== "" ||
    closure.terminalLog?.complete !== true ||
    closure.terminalLog?.hostId !== "local"
  ) throw Error("reviewed terminal history closure mismatch");
  if (
    !same(
      Object.keys(closure.terminalHistorySteps).sort(),
      [...host.unitIds].sort(),
    ) || Object.values(closure.terminalHistorySteps).some((s) => s !== 1000000)
  ) throw Error("retired history roster incomplete");
  if (
    resolve(retirement.closure.path) !==
      resolve(retirement.evidenceDirectory, "closure.json") ||
    resolve(retirement.closureReview.path) !==
      resolve(retirement.evidenceDirectory, "review.json") ||
    !Array.isArray(closure.files) ||
    new Set(closure.files.map((f: any) => f.path)).size !== closure.files.length
  ) throw Error("closure evidence roster malformed");
  const expected = [
      "closure.json",
      "review.json",
      ...closure.files.map((f: any) => f.path),
    ].sort(),
    actualNames: string[] = [];
  await noSymlinks(path(retirement.evidenceDirectory));
  for await (const entry of Deno.readDir(path(retirement.evidenceDirectory))) {
    if (!entry.isFile || entry.isSymlink) {
      throw Error("foreign closure artifact");
    }
    actualNames.push(entry.name);
  }
  if (!same(actualNames.sort(), expected)) {
    throw Error("closure evidence missing/extra");
  }
  const parents: any[] = [];
  let terminalLog: string | undefined;
  for (
    const file of [...closure.files].sort((a: any, b: any) =>
      a.path.localeCompare(b.path)
    )
  ) {
    if (
      basename(file.path) !== file.path ||
      (!/^parent-invocation-[0-9]+-[0-9]+\.json$/.test(file.path) &&
        file.path !== "shard-supervisor.log")
    ) throw Error("foreign closure receipt");
    const b = await raw(join(retirement.evidenceDirectory, file.path));
    if (sha256(b) !== file.sha256 || b.length !== file.bytes) {
      throw Error("closure raw evidence drift");
    }
    if (file.path === "shard-supervisor.log") {
      terminalLog = new TextDecoder().decode(b);
    } else parents.push(parse(b));
  }
  const totals = validateSettledParents(parents, allocationSha256, "local");
  if (
    totals.seconds !== closure.chargedSeconds ||
    totals.invocations !== closure.parentReceiptCount ||
    closure.assignedRuntimeCapSeconds !== host.capSeconds ||
    closure.unspentAllocationSeconds !== host.capSeconds - totals.seconds
  ) throw Error("closure accounting summary drift");
  let finalLine: any;
  try {
    finalLine = JSON.parse(terminalLog?.trim().split(/\r?\n/).at(-1) ?? "");
  } catch {
    throw Error("terminal log missing");
  }
  if (!same(finalLine, closure.terminalLog)) {
    throw Error("terminal log closure drift");
  }
  const cpuRelease = (await pinned(p.cpu.priorRelease)).value;
  if (
    cpuRelease.format !== "discovery-importer-release/v1" ||
    cpuRelease.allocationSha256 !== allocationSha256 ||
    cpuRelease.operationsCapSeconds !== 3600 ||
    cpuRelease.maximumOperationSeconds !== 600
  ) throw Error("original CPU reserve proof drift");
  const operationNames = Object.keys(p.cpu.operationFiles).sort();
  if (
    !operationNames.length ||
    new Set(operationNames.map((n) => n.slice(0, 3))).size !==
      operationNames.length ||
    operationNames.some((n, i) =>
      !n.startsWith(String(i + 1).padStart(3, "0") + "-") ||
      !/^\d{3}-[^/]+\.json$/.test(n)
    )
  ) {
    throw Error(
      "CPU snapshot must preserve complete contiguous operation prefix",
    );
  }
  const actualCpuNames: string[] = [];
  await noSymlinks(path(p.cpu.snapshotDirectory));
  for await (const e of Deno.readDir(path(p.cpu.snapshotDirectory))) {
    if (!e.isFile || e.isSymlink) throw Error("foreign CPU snapshot artifact");
    actualCpuNames.push(e.name);
  }
  if (!same(actualCpuNames.sort(), operationNames)) {
    throw Error("CPU snapshot missing/extra");
  }
  const operations: any[] = [];
  for (const name of operationNames) {
    const b = await raw(join(p.cpu.snapshotDirectory, name));
    if (sha256(b) !== p.cpu.operationFiles[name]) {
      throw Error("CPU snapshot bytes drift");
    }
    operations.push(parse(b));
  }
  const cpuCharged = validateCpuOperations(
    operations,
    p.cpu.priorRelease.sha256,
    600,
  );
  return summarizeSuccessor(a, p, { ...totals, cpuCharged });
}
