/** Plan-first Probe A replay. Execution requires a separately reviewed G1 approval file. */
import { basename, join, relative, resolve } from "node:path";
import { resetIdentity, validateResetDesign, validateResetFreeze,
  validateResetRawSample, type ResetDesign, type ResetFreeze } from "./lib/reset-probe-a-auth.ts";
import { assertResetInitialOutputRoom, buildResetProbeAPlan, validateResetProbeAPlan,
  type ResetProbeAPlan } from "./lib/reset-probe-a-plan.ts";
import { runResetProbeAHistory, ResetOutputCapError, type ResetHistoryResult } from
  "./lib/reset-probe-a-runtime.ts";
import { assertResetAttemptReservation, resetGpuWorkerPid } from
  "./lib/reset-probe-a-guard.ts";

const root = "/Users/nicholas/develop/browser-life-foundations";
const base = `${root}/runs/foundational-reset`;
const designDefault = `${base}/probe-a-design-v2.json`;
const mode = Deno.args[0];
const fields = new Map<string, string>();
for (let i = 1; i < Deno.args.length; i += 2) {
  const key = Deno.args[i], value = Deno.args[i + 1];
  if (!key?.startsWith("--") || value === undefined || fields.has(key))
    throw new Error("reset-probe-a arguments must be unique --key value pairs");
  fields.set(key, value);
}
const field = (key: string) => {
  const value = fields.get(key);
  if (value === undefined) throw new Error(`missing ${key}`);
  return value;
};
const integer = (key: string, min: number, max: number) => {
  const value = Number(field(key));
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${key} outside [${min}, ${max}]`);
  return value;
};
const json = async <T>(path: string): Promise<T> => JSON.parse(await Deno.readTextFile(path));
const bytesIn = async (path: string): Promise<number> => {
  let total = 0;
  for await (const e of Deno.readDir(path)) {
    const p = join(path, e.name);
    if (e.isSymlink) throw new Error(`output tree has a symlink: ${p}`);
    if (e.isDirectory) total += await bytesIn(p);
    else if (e.isFile) total += (await Deno.stat(p)).size;
  }
  return total;
};
const assertOutputBudget = async (limit: number) => {
  const bytes = await bytesIn(base);
  if (bytes > limit) throw new Error(`total new reset output exceeds ${limit} bytes`);
  return bytes;
};
const checkHostGpu = async () => {
  const output = await new Deno.Command("ps", { args: ["-axo", "pid=,command="],
    stdout: "piped", stderr: "piped" }).output();
  if (output.code !== 0) throw new Error("cannot authenticate host GPU worker occupancy");
  const worker = resetGpuWorkerPid(new TextDecoder().decode(output.stdout), Deno.pid);
  if (worker !== null) throw new Error(`another known GPU worker is active (pid ${worker})`);
};

async function loadBoundPlan(path: string) {
  const planIdentity = await resetIdentity(path);
  const plan = await json<ResetProbeAPlan>(path);
  const designIdentity = await resetIdentity(plan.design.path);
  const freezeIdentity = await resetIdentity(plan.freeze.path);
  if (designIdentity.sha256 !== plan.design.sha256 ||
      freezeIdentity.sha256 !== plan.freeze.sha256)
    throw new Error("Probe A plan design/source-freeze bytes changed");
  const design = await json<ResetDesign>(plan.design.path);
  const freeze = await json<ResetFreeze>(plan.freeze.path);
  validateResetDesign(design);
  validateResetProbeAPlan(plan, design);
  await validateResetRawSample(design);
  await validateResetFreeze(freeze, plan.design.path, designIdentity.sha256);
  return { plan, design, freeze, planIdentity };
}

if (resolve(Deno.cwd()) !== root) throw new Error("run Probe A only from the foundations workspace");
if (mode === "plan") {
  const allowed = new Set(["--freeze", "--output-root", "--per-history-max-seconds",
    "--development-charge-seconds", "--design"]);
  if ([...fields.keys()].some(key => !allowed.has(key)))
    throw new Error("unknown Probe A plan argument");
  const freezePath = resolve(field("--freeze"));
  const designPath = resolve(fields.get("--design") ?? designDefault);
  const outputRoot = resolve(field("--output-root"));
  const perHistoryMax = integer("--per-history-max-seconds", 1, 3600);
  const developmentCharge = integer("--development-charge-seconds", 780, 3600);
  const freezeRelative = relative(base, freezePath);
  if (designPath !== designDefault || !freezeRelative ||
      freezeRelative.startsWith("..") || freezeRelative.startsWith("/") ||
      basename(freezePath) !== "manifest.json")
    throw new Error("Probe A plan design or freeze path is outside fixed evidence");
  const designIdentity = await resetIdentity(designPath);
  const freezeIdentity = await resetIdentity(freezePath);
  const design = await json<ResetDesign>(designPath);
  const freeze = await json<ResetFreeze>(freezePath);
  validateResetDesign(design);
  await validateResetRawSample(design);
  await validateResetFreeze(freeze, designPath, designIdentity.sha256);
  const plan = buildResetProbeAPlan(design, designPath, designIdentity.sha256,
    freezePath, freezeIdentity.sha256, outputRoot, perHistoryMax, developmentCharge);
  await assertOutputBudget(plan.budget.totalNewOutputBytes);
  await Deno.mkdir(outputRoot); // never overwrite an existing plan or source snapshot
  await Deno.writeTextFile(join(outputRoot, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n", { createNew: true });
  console.log(JSON.stringify({ status: plan.status, output: join(outputRoot, "plan.json"),
    rows: plan.allRows.length, histories: plan.histories.length }));
} else if (mode === "execute") {
  const allowed = new Set(["--plan", "--history", "--attempt", "--max-seconds", "--g1-approval"]);
  if ([...fields.keys()].some(key => !allowed.has(key)))
    throw new Error("unknown Probe A execution argument");
  const invocationStartedAt = new Date().toISOString();
  const started = performance.now();
  const planPath = resolve(field("--plan"));
  const h = integer("--history", 1, 10), attempt = integer("--attempt", 1, 3);
  const maxSeconds = integer("--max-seconds", 1, 3600);
  const { plan, design, freeze, planIdentity } = await loadBoundPlan(planPath);
  if (planPath !== join(plan.outputRoot, "plan.json") ||
      maxSeconds > plan.perHistoryMaxSeconds)
    throw new Error("Probe A execution differs from frozen per-history plan");
  const approvalPath = resolve(field("--g1-approval"));
  const approvalIdentity = await resetIdentity(approvalPath);
  const approval = await json<{ status: string; planSha256: string;
    designSha256: string; freezeSha256: string }>(approvalPath);
  if (approval.status !== "g1-approved-for-execution" ||
      approval.planSha256 !== planIdentity.sha256 ||
      approval.designSha256 !== plan.design.sha256 ||
      approval.freezeSha256 !== plan.freeze.sha256)
    throw new Error("G1 execution review does not bind this exact plan, design and source freeze");
  const prior: ResetHistoryResult[] = [];
  for await (const entry of Deno.readDir(plan.outputRoot)) {
    const name = /^history-(\d+)-attempt-(\d+)$/.exec(entry.name);
    if (!entry.isDirectory || !name) continue;
    const dir = join(plan.outputRoot, entry.name);
    const resultPath = join(dir, "result.json");
    const completionPath = join(dir, "completion.json");
    try {
      const result = await json<ResetHistoryResult>(resultPath);
      const completion = await json<{ status: string; planSha256: string;
        resultSha256: string; history: number; attempt: number;
        elapsedSeconds: number }>(completionPath);
      const snapshotStatusMatches = completion.status === result.status ||
        (completion.status === "incomplete-output-cap" ||
          completion.status === "incomplete-output-io") &&
          result.status !== "complete";
      if (result.history !== Number(name[1]) || result.attempt !== Number(name[2]) ||
          completion.history !== result.history || completion.attempt !== result.attempt ||
          !snapshotStatusMatches || completion.planSha256 !== planIdentity.sha256 ||
          completion.resultSha256 !== (await resetIdentity(resultPath)).sha256)
        throw new Error("attempt result and create-new completion receipt disagree");
      if (completion.status === "incomplete-output-cap" ||
          completion.status === "incomplete-output-io") {
        result.status = completion.status;
        result.elapsedSeconds = completion.elapsedSeconds;
      }
      prior.push(result);
    } catch (error) {
      throw new Error(`existing Probe A attempt lacks a valid terminal receipt: ${entry.name}: ${error}`);
    }
  }
  assertResetAttemptReservation(plan, planIdentity.sha256, prior, h, attempt, maxSeconds);
  const initialResult = (): ResetHistoryResult => ({
    status: "running", history: h, attempt,
    planSha256: planIdentity.sha256, designSha256: plan.design.sha256,
    startedAt: invocationStartedAt, finishedAt: null, elapsedSeconds: 0,
    maxSeconds, adapter: null, evidence: [],
    unavailableRows: design.histories[h - 1].rowIndices.map(index => ({
      rowIndex: index, reason: "not-reached-in-attempt" as const })),
    checkpointVerifications: [], windows: { frames: [], persistence: [] },
    mutationLedger: { sourceSha256: "", replaySha256: null, count: 0,
      dropped: 0, effects: {} },
    lifeLedger: { sourceSha256: "", replaySha256: null, count: 0 },
    lineageLedger: { sourceSha256: "", replaySha256: null, count: 0 },
    sourcePostvalidated: false, error: null,
    interpretation: "selected-links-copy-evidence-not-reproduction-classification",
  });
  const attemptDir = join(plan.outputRoot, `history-${h}-attempt-${attempt}`);
  const reservation = { status: "reserved", history: h, attempt,
    planSha256: planIdentity.sha256, designSha256: plan.design.sha256,
    freezeSha256: plan.freeze.sha256, maxSeconds, startedAt: invocationStartedAt };
  const reservationText = JSON.stringify(reservation, null, 2) + "\n";
  const initial = initialResult();
  const initialText = JSON.stringify(initial, null, 2) + "\n";
  const encode = new TextEncoder();
  assertResetInitialOutputRoom(await assertOutputBudget(plan.budget.totalNewOutputBytes),
    encode.encode(reservationText).length, encode.encode(initialText).length,
    plan.budget.totalNewOutputBytes);
  await checkHostGpu();
  await Deno.mkdir(attemptDir); // reserve before requesting a device
  await Deno.writeTextFile(join(attemptDir, "reservation.json"),
    reservationText, { createNew: true });
  const resultPath = join(attemptDir, "result.json");
  const completionPath = join(attemptDir, "completion.json");
  const save = async (value: ResetHistoryResult) => {
    const pending = `${resultPath}.pending`;
    const content = JSON.stringify(value, null, 2) + "\n";
    const stagedBytes = new TextEncoder().encode(content).length;
    const currentBytes = await bytesIn(base);
    if (currentBytes + stagedBytes + 1024 * 1024 > plan.budget.totalNewOutputBytes)
      throw new ResetOutputCapError("20 GiB total reset output cap lacks space for staged snapshot and receipt reserve");
    try {
      await Deno.writeTextFile(pending, content, { createNew: true });
      await Deno.rename(pending, resultPath);
    } catch (error) {
      // A failed stage must never block retention of the preceding valid result.
      try { await Deno.remove(pending); } catch { /* absent or unavailable */ }
      throw error;
    }
  };
  await save(initial); // durable not-run rows before GPU setup
  const deadlineMs = started + maxSeconds * 1000;
  let result: ResetHistoryResult | null = null;
  try {
    const preflightRow = freeze.evidence.find(x =>
      x.path === `${base}/input-preflight-v3.json`);
    if (!preflightRow) throw new Error("source freeze lacks independent checkpoint preflight");
    const preflight = await json<{ checkpoints: { h: number; step: number;
      physicsHash: string; artifactHash: string }[] }>(preflightRow.path);
    const history = design.histories[h - 1];
    const rows = history.rowIndices.map(index => design.sample.rows[index]);
    result = await runResetProbeAHistory({ history, rows, freeze, preflight,
      attempt, planSha256: planIdentity.sha256, designSha256: plan.design.sha256,
      deadlineMs, reservedMaxSeconds: maxSeconds, startedAt: invocationStartedAt,
      activeLabelsBytes: plan.budget.activeLabelsBytes,
      save, checkHostGpu,
      checkOutputBudget: async () => { await assertOutputBudget(plan.budget.totalNewOutputBytes); } });
    await validateResetFreeze(freeze, plan.design.path, plan.design.sha256);
    if ((await resetIdentity(planPath)).sha256 !== planIdentity.sha256 ||
        (await resetIdentity(approvalPath)).sha256 !== approvalIdentity.sha256)
      throw new Error("Probe A plan or approval changed during attempt");
    result.sourcePostvalidated = true;
    if (result.status === "running") {
      if (performance.now() > deadlineMs) {
        result.status = "incomplete-time-cap";
        result.error = "post-execution authentication exceeded reserved time cap";
      } else if (result.evidence.length !== 20 || result.unavailableRows.length ||
          result.windows.frames.length !== 1000 ||
          result.windows.persistence.some(x => x.status !== "complete-100-future-samples")) {
        result.status = "failed-parity-or-source";
        result.error = "complete history lacks fixed rows, window frames or persistence";
      } else result.status = "complete";
    }
  } catch (error) {
    if (!result) result = initialResult();
    result.status = error instanceof ResetOutputCapError ?
      "incomplete-output-cap" : "failed-parity-or-source";
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (result) {
      result.finishedAt = new Date().toISOString();
      result.elapsedSeconds = (performance.now() - started) / 1000;
      if (result.status === "complete") result.unavailableRows = [];
      if (result.status !== "incomplete-output-cap" &&
          result.status !== "incomplete-output-io") {
        try { await save(result); }
        catch (error) {
          result.status = error instanceof ResetOutputCapError ?
            "incomplete-output-cap" : "incomplete-output-io";
          result.error = `final snapshot could not be persisted: ${String(error)}`;
        }
      }
      // A cap stop retains the last valid partial snapshot; if no snapshot exists,
      // persist a small unavailable-row failure record from the reservation.
      try { await Deno.stat(resultPath); }
      catch {
        const minimal = { ...result, evidence: [], checkpointVerifications: [],
          windows: { frames: [], persistence: [] },
          unavailableRows: design.histories[h - 1].rowIndices.map(index => ({
            rowIndex: index, reason: "not-reached-in-attempt" as const })) };
        await save(minimal);
      }
      const finalIdentity = await resetIdentity(resultPath);
      const completionText = JSON.stringify({
        status: result.status, history: h, attempt, planSha256: planIdentity.sha256,
        designSha256: plan.design.sha256, freezeSha256: plan.freeze.sha256,
        resultSha256: finalIdentity.sha256, resultBytes: finalIdentity.bytes,
        finishedAt: result.finishedAt, elapsedSeconds: result.elapsedSeconds,
      }, null, 2) + "\n";
      if ((await bytesIn(base)) + new TextEncoder().encode(completionText).length >
          plan.budget.totalNewOutputBytes)
        throw new Error("reserved output receipt space was consumed externally");
      await Deno.writeTextFile(completionPath, completionText, { createNew: true });
    }
  }
  console.log(JSON.stringify({ status: result.status, history: h, attempt,
    output: resultPath, elapsedSeconds: result.elapsedSeconds }));
  if (result.status !== "complete") Deno.exitCode = 1;
} else throw new Error("usage: reset-probe-a.ts plan|execute --key value ...");
