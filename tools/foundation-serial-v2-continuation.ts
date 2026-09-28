/** Conditional A2 stages 1/2. Only fixed prior-selected packets enter new gardens. */
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalConfig } from "@bl/schema";
import { specConfig } from "@bl/runner";
import { buildCopyPreflight } from "./foundation-copy-ancestry.ts";
import { prepareV2Start, planV2Stage, v2Spec, SERIAL_V2_SEEDS,
  type V2Arm } from "./lib/foundation-serial-v2.ts";
import { runV2Garden, type V2GardenOutcome } from "./lib/foundation-serial-v2-run.ts";
import { validateSavedV2Selection } from "./lib/foundation-serial-v2-selection.ts";
import { assertV2OutputPath, assertV2SeedAvailableForOutput, reserveV2Seed, completeV2Seed,
  verifyV2SeedCompletion, type V2SeedReservation } from "./lib/foundation-serial-v2-receipt.ts";
import { sha256, verifyReplayCache, type FileDigest } from "./lib/foundation-replay.ts";
import { validateCellPacket, type CellPacket } from "./lib/foundation-transplant.ts";
import { assertNoCompetingGpuRun } from "./lib/foundation-serial-v2-gpu-guard.ts";
import { SERIAL_V2_CODE_FILES, validateV2Seeds, type V2Stage0Plan, type V2Stage0Result } from
  "./foundation-serial-transfer-v2.ts";

export interface ContinuationArgs { stage: 1 | 2; priorDirs: string[]; out: string;
  maxSeconds: number; execute: boolean }
export function parseContinuationArgs(args: string[]): ContinuationArgs {
  const values = new Map<string, string>(); let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!["--stage", "--prior-dirs", "--out", "--max-seconds"].includes(args[i]) ||
        !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid A2 continuation option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  if (execute && values.size !== 1) throw new Error("continuation execution accepts only --out");
  if (!execute) for (const key of ["--stage", "--prior-dirs", "--out", "--max-seconds"])
    if (!values.has(key)) throw new Error(`continuation planning requires ${key}`);
  const stage = Number(values.get("--stage"));
  const priorDirs = values.get("--prior-dirs")?.split(",").map((x) => resolve(x)) ?? [];
  const maxSeconds = Number(values.get("--max-seconds") ?? 0);
  if (!execute && (![1, 2].includes(stage) || priorDirs.length !== stage ||
      new Set(priorDirs).size !== priorDirs.length ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("A2 continuation needs stage 1/2, exact ordered priors and cap <=600");
  return { stage: (execute ? 1 : stage) as 1 | 2, priorDirs,
    out: resolve(values.get("--out") ?? "."), maxSeconds, execute };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fileDigest = async (path: string) => sha256(await Deno.readFile(path));
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await Deno.readTextFile(path)) as T;
const stableA1Preflight = (x: Record<string, unknown>) => ({ ...x, createdAt: undefined,
  inputs: { ...(x.inputs as Record<string, unknown>), out: undefined } });
const hex64 = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const hashString = (x: string) => createHash("sha256").update(x).digest("hex");

export function validateV2Prior(planBytes: Uint8Array, resultBytes: Uint8Array,
  expectedStage: 0 | 1): { plan: V2Stage0Plan | V2ContinuationPlan;
    result: V2Stage0Result | V2ContinuationResult; planFile: FileDigest; resultFile: FileDigest } {
  const plan = JSON.parse(new TextDecoder().decode(planBytes)) as V2Stage0Plan | V2ContinuationPlan;
  const result = JSON.parse(new TextDecoder().decode(resultBytes)) as V2Stage0Result | V2ContinuationResult;
  const planFile = sha256(planBytes), resultFile = sha256(resultBytes);
  const expectedPlan = expectedStage === 0 ? "foundation-serial-v2-plan/v1" :
    "foundation-serial-v2-continuation-plan/v1";
  const expectedResult = expectedStage === 0 ? "foundation-serial-v2-result/v1" :
    "foundation-serial-v2-continuation-result/v1";
  const expectedArms = expectedStage === 0 ?
    ["donor", "founder-genotype", "zero-controller-genotype", "empty"] :
    ["donor", "founder-genotype"];
  if (plan.format !== expectedPlan || plan.status !== "planned" || plan.stage !== expectedStage ||
      !same(plan.arms.map((row) => row.arm), expectedArms) ||
      !same(plan.seeds, SERIAL_V2_SEEDS) ||
      plan.arms.some((row) => row.seed !== SERIAL_V2_SEEDS[expectedStage]) ||
      result.format !== expectedResult || result.status !== "complete" ||
      result.postExecutionRevalidated !== true || result.overrun !== false ||
      !same(result.planFile, planFile) || !same(result.codeFilesAfter, plan.codeFiles) ||
      result.rows.length !== plan.arms.length)
    throw new Error("A2 prior stage lacks frozen postauthenticated complete evidence");
  for (let i = 0; i < plan.arms.length; i++) {
    const input = plan.arms[i], row = result.rows[i];
    if (input.arm !== row.arm) throw new Error("A2 prior row order differs from frozen plan");
    if ("status" in input && input.status === "unavailable") {
      if (row.status !== "unavailable" || row.outcome !== null)
        throw new Error("A2 unavailable prior row has fabricated outcome");
      continue;
    }
    if (row.status !== "complete" || !row.outcome || row.outcome.status !== "complete" ||
        row.outcome.arm !== input.arm || row.outcome.stage !== expectedStage ||
        row.outcome.seed !== input.seed || row.outcome.initialStateHash !== input.initialStateHash ||
        !same(row.outcome.initialInventory, input.initialInventory) ||
        row.outcome.conservationOk !== true || row.outcome.mutations !== 0 ||
        !row.outcome.reference?.matchedMeasured ||
        row.outcome.observer?.status !== "complete" ||
        !row.outcome.observer.observationFiles ||
        (input.arm !== "empty" && (!row.outcome.sham || !row.outcome.colorParity ||
          row.outcome.colorParity.throughStep !== 1000)))
      throw new Error("A2 prior completed row lacks authenticated physical/observer evidence");
    const packet = row.outcome.selectedPacket;
    if (input.arm !== "empty") {
      if (!row.outcome.selection || row.outcome.frameDigests?.length !== 40 ||
          row.outcome.frameCertificates?.length !== 40)
        throw new Error("A2 prior source lacks complete copy-link candidate window");
      for (let j = 0; j < 40; j++) {
        const frame = row.outcome.frameCertificates[j], d = row.outcome.frameDigests[j];
        if (d.step !== frame.step || d.components !== frame.components.length ||
            d.stateHashSha256 !== frame.currentStateHash ||
            d.copyMapSha256 !== frame.copyMapSha256 ||
            d.separationEvidenceSha256 !== frame.separationEvidenceSha256 ||
            d.framePayloadSha256 !== hashString(JSON.stringify(frame)))
          throw new Error("A2 saved frame certificate differs from measured frame digest");
      }
      validateSavedV2Selection({ sourceKey: "m4/gradient-m3/treatment/seed-1",
        arm: input.arm as "donor" | "founder-genotype" | "zero-controller-genotype",
        stage: expectedStage, seed: input.seed }, row.outcome.selection,
        row.outcome.frameCertificates);
    } else if (row.outcome.selection !== null || row.outcome.selectedPacket !== null)
      throw new Error("A2 empty prior control cannot have copy-linked selection");
    if (packet) {
      validateCellPacket(packet);
      const selected = row.outcome.selection?.selected;
      const frame = row.outcome.frameDigests?.find((x) => x.step === selected?.step);
      if (row.outcome.selectedPacketError || row.outcome.selection?.status !== "selected" ||
          !selected || !hex64(packet.sha256) || packet.sourceStep !== selected.step ||
          !frame || hashString(packet.sourceStateHash) !== frame.stateHashSha256 ||
          hashString(packet.cells.map((x) => x.sourceIndex).join(",")) !== selected.memberSha256)
        throw new Error("A2 prior selected packet lacks fixed selection evidence");
    } else if (row.outcome.selection?.status === "selected" && !row.outcome.selectedPacketError)
      throw new Error("A2 selected prior component lacks packet or extraction failure");
  }
  return { plan, result, planFile, resultFile };
}

export interface V2ContinuationPlan {
  format: "foundation-serial-v2-continuation-plan/v1"; status: "planned";
  stage: 1 | 2; createdAt: string; outputPath: string; maxSeconds: number;
  claim: "one-selected-source-intervention-feasibility-only";
  priorFiles: { planPath: string; planFile: FileDigest; resultPath: string;
    resultFile: FileDigest }[];
  a1PlanPath: string; a1ResultPath: string;
  inputPaths: V2Stage0Plan["inputPaths"]; inputFiles: V2Stage0Plan["inputFiles"];
  codeFiles: Record<string, FileDigest>; sourceRunId: string;
  sourceRevision: string; sourceCheckpointSha256: string;
  sourcePacketSha256: string; seedAllocationSha256: string;
  seeds: typeof SERIAL_V2_SEEDS; horizon: 3000; fineCensus: 25;
  coarseCensus: 100; recruitmentEnd: 1000;
  arms: { arm: V2Arm; seed: number; status: "planned" | "unavailable";
    sourcePacket: CellPacket | null; sourcePacketSha256: string | null;
    initialStateHash: string | null; initialInventory: unknown | null;
    inoculumSha256: string | null; eligibleRootsAtStep0: number | null;
    transplantAudit: unknown | null; importedFrom: { stage: 0 | 1; arm: string;
      selectedStep: number; componentIndex: number; packetSha256: string } | null;
    unavailableReason: string | null }[];
}
export interface V2ContinuationResult {
  format: "foundation-serial-v2-continuation-result/v1";
  status: "running" | "complete" | "incomplete-time-cap" | "failed";
  planFile: FileDigest; postExecutionRevalidated: boolean;
  startedAt: string; endedAt?: string; elapsedSeconds: number; overrun: boolean;
  runtime: { deno: string; os: string; arch: string; adapter: {
    vendor: string | null; architecture: string | null; device: string | null;
    description: string | null } | null };
  rows: { arm: string; status: "planned" | "running" | "complete" |
    "unavailable" | "incomplete-time-cap" | "failed";
    outcome: V2GardenOutcome | null; partial?: { step: number; phase: string;
      selectionStatus?: string }; failure?: string }[];
  codeFilesAfter?: Record<string, FileDigest>; failure?: string;
}

export async function buildV2ContinuationPlan(opt: ContinuationArgs): Promise<V2ContinuationPlan> {
  assertV2OutputPath(opt.out);
  for (const prior of opt.priorDirs) assertV2OutputPath(prior);
  await assertV2SeedAvailableForOutput(opt.out, SERIAL_V2_SEEDS[opt.stage]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const priors = [] as ReturnType<typeof validateV2Prior>[];
  const priorFiles: V2ContinuationPlan["priorFiles"] = [];
  for (let i = 0; i < opt.stage; i++) {
    const planPath = join(opt.priorDirs[i], "plan.json");
    const resultPath = join(opt.priorDirs[i], "result.json");
    const [planBytes, resultBytes] = await Promise.all([Deno.readFile(planPath), Deno.readFile(resultPath)]);
    const verified = validateV2Prior(planBytes, resultBytes, i as 0 | 1);
    priors.push(verified);
    priorFiles.push({ planPath, planFile: verified.planFile, resultPath,
      resultFile: verified.resultFile });
  }
  const zero = priors[0].plan as V2Stage0Plan;
  const [auditBytes, ledgerBytes] = await Promise.all([
    Deno.readFile(zero.inputPaths.seedAudit), Deno.readFile(zero.inputPaths.seedLedger),
  ]);
  if (!same(sha256(auditBytes), zero.inputFiles.seedAudit) ||
      validateV2Seeds(JSON.parse(new TextDecoder().decode(auditBytes)),
        JSON.parse(new TextDecoder().decode(ledgerBytes))) !== zero.seedAllocationSha256)
    throw new Error("A2 continuation seed audit/allocation changed or now conflicts");
  for (let i = 0; i < priors.length; i++)
    await verifyV2SeedCompletion(opt.priorDirs[i], i as 0 | 1, SERIAL_V2_SEEDS[i],
      priors[i].planFile, priors[i].resultFile, zero.seedAllocationSha256);
  if (!same(zero.seeds, SERIAL_V2_SEEDS) || zero.sourceRunId !==
      "m4/gradient-m3/treatment/seed-1" ||
      priors.some((p, i) => i > 0 && (!same(p.plan.inputPaths, zero.inputPaths) ||
        !same(p.plan.codeFiles, zero.codeFiles) ||
        p.plan.sourcePacketSha256 !== zero.sourcePacketSha256 ||
        !same((p.plan as V2ContinuationPlan).priorFiles?.[i - 1]?.resultFile,
          priors[i - 1].resultFile))))
    throw new Error("A2 prior stages disagree on frozen source/code/lineage chain");
  for (let i = 1; i < priors.length; i++) {
    const current = priors[i].plan as V2ContinuationPlan;
    for (let j = 0; j < i; j++) if (!same(current.priorFiles[j]?.planFile, priors[j].planFile) ||
        !same(current.priorFiles[j]?.resultFile, priors[j].resultFile))
      throw new Error("A2 prior continuation points to different immutable stage evidence");
    const sourceRows = priors[i - 1].result.rows;
    for (const row of current.arms) {
      const previous = sourceRows.find((x) => x.arm === row.arm);
      const selected = previous?.outcome?.selection?.selected;
      const packet = previous?.outcome?.selectedPacket;
      if (row.status === "unavailable") {
        if (packet || row.sourcePacket || row.importedFrom)
          throw new Error("A2 unavailable continuation hides a selected prior packet");
      } else if (!packet || !selected || row.sourcePacketSha256 !== packet.sha256 ||
          row.sourcePacket?.sha256 !== packet.sha256 ||
          !same(row.importedFrom, { stage: i - 1, arm: row.arm,
            selectedStep: selected.step, componentIndex: selected.componentIndex,
            packetSha256: packet.sha256 }))
        throw new Error("A2 imported packet does not match fixed prior selection");
    }
  }
  const a1Plan = await readJson<any>(zero.a1PlanPath);
  const current = await buildCopyPreflight({ ...a1Plan.inputs, out: opt.out });
  if (!same(stableA1Preflight(current as Record<string, unknown>),
      stableA1Preflight(a1Plan.preflight)) || current.status !== "pass")
    throw new Error("A2 continuation source or A1 preflight drifted");
  if (!same(await fileDigest(zero.a1PlanPath), zero.inputFiles.a1Plan) ||
      !same(await fileDigest(zero.a1ResultPath), zero.inputFiles.a1Result))
    throw new Error("A2 continuation A1 evidence changed");
  const codeFiles: Record<string, FileDigest> = {};
  for (const name of Object.keys(zero.codeFiles)) codeFiles[name] = await fileDigest(join(root, name));
  if (!same(codeFiles, zero.codeFiles) ||
      !SERIAL_V2_CODE_FILES.every((name) => codeFiles[name]))
    throw new Error("A2 continuation code changed since stage-0 freeze");
  const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(zero.inputPaths.cache, name)) });
  if (cache.source.codeRevision !== zero.sourceRevision || cache.source.runId !== zero.sourceRunId ||
      cache.checkpoints.find((x) => x.step === 900_000)?.fileDigest.sha256 !==
        zero.sourceCheckpointSha256)
    throw new Error("A2 continuation authenticated cache drifted");
  const previous = priors[opt.stage - 1].result;
  const priorMap = Object.fromEntries(previous.rows.map((row) => [row.arm, {
    status: row.status === "complete" ? "complete" as const : "unavailable" as const,
    selectedPacketSha256: row.outcome?.selectedPacket?.sha256 ?? null,
  }]));
  const schedule = planV2Stage(opt.stage, zero.sourcePacketSha256, priorMap);
  const arms: V2ContinuationPlan["arms"] = schedule.rows.map((row) => {
    const earlier = previous.rows.find((x) => x.arm === row.arm)!;
    const packet = earlier.outcome?.selectedPacket ?? null;
    if (row.status === "unavailable") return { arm: row.arm as V2Arm, seed: row.seed,
      status: "unavailable", sourcePacket: null, sourcePacketSha256: null,
      initialStateHash: null, initialInventory: null, inoculumSha256: null,
      eligibleRootsAtStep0: null, transplantAudit: null, importedFrom: null,
      unavailableReason: row.unavailableReason };
    if (!packet || !earlier.outcome?.selection?.selected)
      throw new Error("A2 available continuation row lacks exact prior selected packet");
    if (packet.sourceConfigCanonical !== canonicalConfig(specConfig(v2Spec(cache.source,
        (opt.stage - 1) as 0 | 1))))
      throw new Error("A2 selected packet source configuration differs from prior garden");
    const start = prepareV2Start(cache.source, opt.stage, row.arm as V2Arm, packet);
    return { arm: row.arm as V2Arm, seed: row.seed, status: "planned", sourcePacket: packet,
      sourcePacketSha256: packet.sha256, initialStateHash: start.initialStateHash,
      initialInventory: start.initialInventory, inoculumSha256: start.inoculum?.sha256 ?? null,
      eligibleRootsAtStep0: start.eligibleRootsAtStep0, transplantAudit: start.transplantAudit,
      importedFrom: { stage: (opt.stage - 1) as 0 | 1, arm: row.arm,
        selectedStep: earlier.outcome.selection.selected.step,
        componentIndex: earlier.outcome.selection.selected.componentIndex,
        packetSha256: packet.sha256 }, unavailableReason: null };
  });
  return { format: "foundation-serial-v2-continuation-plan/v1", status: "planned",
    stage: opt.stage, createdAt: new Date().toISOString(), outputPath: opt.out,
    maxSeconds: opt.maxSeconds, claim: "one-selected-source-intervention-feasibility-only",
    priorFiles, a1PlanPath: zero.a1PlanPath, a1ResultPath: zero.a1ResultPath,
    inputPaths: zero.inputPaths, inputFiles: zero.inputFiles, codeFiles,
    sourceRunId: zero.sourceRunId, sourceRevision: zero.sourceRevision,
    sourceCheckpointSha256: zero.sourceCheckpointSha256,
    sourcePacketSha256: zero.sourcePacketSha256,
    seedAllocationSha256: zero.seedAllocationSha256, seeds: SERIAL_V2_SEEDS,
    horizon: 3000, fineCensus: 25, coarseCensus: 100, recruitmentEnd: 1000, arms };
}

class V2ContinuationTimeCapError extends Error {}
const comparable = (p: V2ContinuationPlan) => ({ ...p, createdAt: undefined });
async function acquireGpu() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("A2 continuation WebGPU adapter unavailable");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo;
    requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("A2 continuation adapter identity unavailable");
  const device = await adapter.requestDevice({ requiredFeatures:
    adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, adapter: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}
async function execute(plan: V2ContinuationPlan, planFile: FileDigest,
  resultPath: string): Promise<void> {
  const begun = performance.now();
  const result: V2ContinuationResult = {
    format: "foundation-serial-v2-continuation-result/v1", status: "running", planFile,
    postExecutionRevalidated: false, startedAt: new Date().toISOString(), elapsedSeconds: 0,
    overrun: false, runtime: { deno: Deno.version.deno, os: Deno.build.os,
      arch: Deno.build.arch, adapter: null },
    rows: plan.arms.map((x) => ({ arm: x.arm,
      status: x.status === "unavailable" ? "unavailable" : "planned", outcome: null })) };
  const save = async (end = false) => {
    result.elapsedSeconds = (performance.now() - begun) / 1000;
    result.overrun = result.elapsedSeconds > plan.maxSeconds;
    if (end) result.endedAt = new Date().toISOString();
    await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2) + "\n");
  };
  let lastGpuCheck = 0;
  const check = (where: string) => {
    const now = performance.now();
    if (now - lastGpuCheck > 5000) {
      assertNoCompetingGpuRun(); lastGpuCheck = now;
    }
    if ((performance.now() - begun) / 1000 > plan.maxSeconds)
      throw new V2ContinuationTimeCapError(`A2 stage ${plan.stage} cap at ${where}`);
  };
  let device: GPUDevice | undefined;
  let reservation: V2SeedReservation | undefined;
  try {
    await save(); check("before continuation revalidation");
    const args: ContinuationArgs = { stage: plan.stage,
      priorDirs: plan.priorFiles.filter((_, i) => i < plan.stage).map((x) => dirname(x.planPath)),
      out: plan.outputPath, maxSeconds: plan.maxSeconds, execute: false };
    const fresh = await buildV2ContinuationPlan(args);
    if (!same(comparable(fresh), comparable(plan)) ||
        !same(await fileDigest(join(plan.outputPath, "plan.json")), planFile))
      throw new Error("A2 continuation prior/source/code changed before execution");
    const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(plan.inputPaths.cache, name)) });
    const starts = plan.arms.map((row) => row.status === "unavailable" ? null :
      prepareV2Start(cache.source, plan.stage, row.arm, row.sourcePacket));
    for (let i = 0; i < starts.length; i++) if (starts[i] &&
        (starts[i]!.initialStateHash !== plan.arms[i].initialStateHash ||
          starts[i]!.inoculum?.sha256 !== plan.arms[i].inoculumSha256 ||
          !same(starts[i]!.initialInventory, plan.arms[i].initialInventory)))
      throw new Error("A2 continuation start changed from frozen plan");
    check("after continuation reconstruction");
    reservation = await reserveV2Seed(plan.outputPath, plan.stage, SERIAL_V2_SEEDS[plan.stage],
      planFile, plan.seedAllocationSha256);
    if (starts.some(Boolean)) {
      assertNoCompetingGpuRun();
      const acquired = await acquireGpu(); device = acquired.device;
      result.runtime.adapter = acquired.adapter; await save(); check("after GPU acquisition");
      const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`,
        adapter: [acquired.adapter.description, acquired.adapter.device, acquired.adapter.vendor]
          .find(Boolean) ?? "adapter-info-empty" };
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i]; if (!start) continue;
        const row = result.rows[i]; check(`before ${row.arm}`);
        row.status = "running"; await save();
        try {
          row.outcome = await runV2Garden(device, start, host, check, async (partial) => {
            row.partial = partial; await save();
          });
          row.status = "complete"; await save();
        } catch (error) {
          row.status = error instanceof V2ContinuationTimeCapError ?
            "incomplete-time-cap" : "failed";
          row.failure = error instanceof Error ? error.message : String(error);
          await save(); throw error;
        }
      }
    }
    check("post-continuation revalidation");
    const post = await buildV2ContinuationPlan(args);
    if (!same(comparable(post), comparable(plan)) ||
        !same(await fileDigest(join(plan.outputPath, "plan.json")), planFile))
      throw new Error("A2 continuation prior/source/code changed after execution");
    result.codeFilesAfter = post.codeFiles;
    result.postExecutionRevalidated = true;
    result.status = "complete"; check("before final publication"); await save(true);
    console.log(JSON.stringify({ status: result.status, stage: plan.stage,
      available: starts.filter(Boolean).length, out: plan.outputPath }));
  } catch (error) {
    result.status = error instanceof V2ContinuationTimeCapError ?
      "incomplete-time-cap" : "failed";
    result.failure = error instanceof Error ? error.message : String(error);
    await save(true); throw error;
  } finally {
    device?.destroy();
    if (reservation) await completeV2Seed(reservation,
      result.status === "running" ? "failed" : result.status);
  }
}

async function main() {
  const opt = parseContinuationArgs(Deno.args);
  if (opt.execute) {
    const planPath = join(opt.out, "plan.json"), resultPath = join(opt.out, "result.json");
    const bytes = await Deno.readFile(planPath);
    const plan = JSON.parse(new TextDecoder().decode(bytes)) as V2ContinuationPlan;
    if (plan.format !== "foundation-serial-v2-continuation-plan/v1" ||
        plan.status !== "planned" || ![1, 2].includes(plan.stage) ||
        plan.outputPath !== opt.out || plan.arms.length !== 2 ||
        !same(plan.seeds, SERIAL_V2_SEEDS) || !Number.isFinite(plan.maxSeconds) ||
        plan.maxSeconds <= 0 || plan.maxSeconds > 600)
      throw new Error("A2 continuation requires valid immutable plan");
    const reserved = await Deno.open(resultPath, { write: true, createNew: true }); reserved.close();
    await execute(plan, sha256(bytes), resultPath); return;
  }
  await Deno.mkdir(dirname(opt.out), { recursive: true });
  await Deno.mkdir(opt.out);
  try {
    const plan = await buildV2ContinuationPlan(opt);
    await Deno.writeTextFile(join(opt.out, "plan.json"), JSON.stringify(plan, null, 2) + "\n",
      { createNew: true });
    console.log(JSON.stringify({ status: "planned", stage: opt.stage,
      available: plan.arms.filter((x) => x.status === "planned").length,
      gpuStarted: false, out: opt.out }));
  } catch (error) {
    await Deno.writeTextFile(join(opt.out, "planning-failure.json"), JSON.stringify({ status: "failed",
      error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n",
      { createNew: true });
    throw error;
  }
}
if (import.meta.main) await main();
