/** A2 plan-first serial-transfer runner. Planning is CPU-only; execution is gated on A1. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeArtifact } from "@bl/runner";
import { buildCopyPreflight } from "./foundation-copy-ancestry.ts";
import { validateA1Gate, prepareV2Start, planV2Stage, SERIAL_V2_SEEDS } from
  "./lib/foundation-serial-v2.ts";
import { sha256, verifyReplayCache, type FileDigest } from "./lib/foundation-replay.ts";
import { extractCellPacket } from "./lib/foundation-transplant.ts";
import type { ExtractionCatalog } from "./lib/foundation-extract.ts";
import { runV2Garden, type V2GardenOutcome } from "./lib/foundation-serial-v2-run.ts";
import { assertNoCompetingGpuRun } from "./lib/foundation-serial-v2-gpu-guard.ts";
import { assertV2OutputPath, assertV2SeedAvailableForOutput, reserveV2Seed, completeV2Seed,
  type V2SeedReservation } from "./lib/foundation-serial-v2-receipt.ts";

export interface V2Args { a1Dir: string; seedAudit: string; seedLedger: string;
  out: string; maxSeconds: number; execute: boolean }
export function parseV2Args(args: string[]): V2Args {
  const values = new Map<string, string>(); let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!["--a1-dir", "--seed-audit", "--seed-ledger", "--out", "--max-seconds"].includes(args[i]) ||
        !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid or duplicate A2 option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  if (execute && values.size !== 1) throw new Error("A2 execution accepts only --out of a frozen plan");
  if (!execute) for (const option of ["--a1-dir", "--seed-audit", "--seed-ledger", "--out", "--max-seconds"])
    if (!values.has(option)) throw new Error(`A2 planning requires ${option}`);
  const maxSeconds = Number(values.get("--max-seconds") ?? 0);
  if (!execute && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("A2 stage cap must be finite, positive and <=600 seconds");
  return { a1Dir: resolve(values.get("--a1-dir") ?? "."),
    seedAudit: resolve(values.get("--seed-audit") ?? "."),
    seedLedger: resolve(values.get("--seed-ledger") ?? "."),
    out: resolve(values.get("--out") ?? "."), maxSeconds, execute };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await Deno.readTextFile(path)) as T;
const fileDigest = async (path: string) => sha256(await Deno.readFile(path));
const comparablePreflight = (x: Record<string, unknown>) => ({ ...x, createdAt: undefined,
  inputs: { ...(x.inputs as Record<string, unknown>), out: undefined } });
export const SERIAL_V2_CODE_FILES = [
  "tools/foundation-serial-transfer-v2.ts", "tools/lib/foundation-serial-v2.ts",
  "tools/foundation-serial-v2-continuation.ts",
  "tools/lib/foundation-serial-v2-frame.ts", "tools/lib/foundation-serial-v2-selection.ts",
  "tools/lib/foundation-serial-v2-parity.ts", "tools/lib/foundation-serial-v2-observe.ts",
  "tools/lib/foundation-serial-v2-run.ts",
  "tools/lib/foundation-serial-v2-gpu-guard.ts",
  "tools/lib/foundation-serial-v2-receipt.ts",
  "tools/test/foundation-serial-v2.test.ts",
  "tools/test/foundation-serial-v2-selection.test.ts", "docs/foundations-serial-transfer-v2.md",
  "tools/test/foundation-serial-v2-continuation.test.ts",
  "tools/test/foundation-serial-v2-receipt.deno.ts",
  "tools/lib/foundation-serial-transfer.ts", "tools/lib/foundation-serial-capture.ts",
  "tools/foundation-transplant-pilot.ts", "tools/lib/foundation-lifecycle.ts",
  "tools/lib/foundation-copy-ancestry.ts", "tools/lib/foundation-transplant.ts",
  "tools/lib/foundation-replay.ts", "tools/lib/foundation-extract.ts",
  "tools/lib/foundation-competition.ts", "tools/lib/foundation-sensitivity.ts",
  "packages/runner/src/runner.ts", "packages/runner/src/observe.ts",
  "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts",
  "deno.json", "deno.lock", "package.json",
] as const;

export interface V2Stage0Plan {
  format: "foundation-serial-v2-plan/v1"; status: "planned"; stage: 0;
  createdAt: string; outputPath: string; maxSeconds: number; claim:
    "one-selected-source-intervention-feasibility-only";
  a1: ReturnType<typeof validateA1Gate>;
  a1PlanPath: string; a1ResultPath: string;
  inputPaths: { source: string; cache: string; catalog: string; rule: string;
    seedAudit: string; seedLedger: string };
  inputFiles: Record<string, FileDigest>; codeFiles: Record<string, FileDigest>;
  seedAllocationSha256: string;
  sourceRunId: string; sourceRevision: string; sourceCheckpointSha256: string;
  sourcePacketSha256: string; donorComponentIndex: number;
  seeds: typeof SERIAL_V2_SEEDS; horizon: 3000; fineCensus: 25; coarseCensus: 100;
  recruitmentEnd: 1000; arms: {
    arm: string; seed: number; initialStateHash: string; initialInventory: unknown;
    sourcePacketSha256: string | null; inoculumSha256: string | null;
    eligibleRootsAtStep0: number; transplantAudit: unknown;
  }[];
}

type V2ResultStatus = "running" | "complete" | "incomplete-time-cap" | "failed";
export interface V2Stage0Result {
  format: "foundation-serial-v2-result/v1"; status: V2ResultStatus;
  planFile: FileDigest; postExecutionRevalidated: boolean;
  startedAt: string; endedAt?: string; elapsedSeconds: number; overrun: boolean;
  runtime: { deno: string; os: string; arch: string; adapter: {
    vendor: string | null; architecture: string | null; device: string | null;
    description: string | null } | null };
  rows: { arm: string; status: "planned" | "running" | "complete" |
    "incomplete-time-cap" | "failed"; outcome: V2GardenOutcome | null;
    partial?: { step: number; phase: string; selectionStatus?: string };
    failure?: string }[];
  codeFilesAfter?: Record<string, FileDigest>;
  failure?: string;
}
export class V2TimeCapError extends Error {}

export function validateV2Seeds(audit: any, ledger: any): string {
  if (audit?.status !== "cleared" || !Array.isArray(audit.collisions) || audit.collisions.length ||
      !audit.additionalReservations?.some((x: any) => x.purpose === "ancestry/serial" &&
        x.first <= SERIAL_V2_SEEDS[0] && x.last >= SERIAL_V2_SEEDS[2]) ||
      !ledger?.records?.some((x: any) => x.purpose === "ancestry diagnostic and serial v2" &&
        x.range?.first <= SERIAL_V2_SEEDS[0] && x.range?.last >= SERIAL_V2_SEEDS[2]) ||
      !ledger?.records?.some((x: any) => x.purpose === "A2 serial exact-stage seed suballocation" &&
        same(x.seeds, SERIAL_V2_SEEDS) && x.status === "reserved"))
    throw new Error("A2 exact seeds lack cleared local audit and allocation range");
  for (const row of ledger.records) {
    if (row.purpose === "ancestry diagnostic and serial v2" && row.range) continue;
    if (row.purpose === "A2 serial exact-stage seed suballocation" && same(row.seeds, SERIAL_V2_SEEDS) &&
        row.status === "reserved") continue;
    if (SERIAL_V2_SEEDS.some((seed) => row.seed === seed || row.masterSeed === seed ||
        row.seeds?.includes(seed))) throw new Error("A2 exact seed already assigned in ledger");
  }
  const allocation = ledger.records.find((x: any) =>
    x.purpose === "A2 serial exact-stage seed suballocation" && same(x.seeds, SERIAL_V2_SEEDS));
  return sha256(new TextEncoder().encode(JSON.stringify(allocation))).sha256;
}

export async function buildV2Stage0Plan(opt: V2Args): Promise<V2Stage0Plan> {
  assertV2OutputPath(opt.out);
  await assertV2SeedAvailableForOutput(opt.out, SERIAL_V2_SEEDS[0]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const a1PlanPath = join(opt.a1Dir, "plan.json"), a1ResultPath = join(opt.a1Dir, "result.json");
  const [a1PlanBytes, a1ResultBytes, auditBytes, ledgerBytes] = await Promise.all([
    Deno.readFile(a1PlanPath), Deno.readFile(a1ResultPath),
    Deno.readFile(opt.seedAudit), Deno.readFile(opt.seedLedger),
  ]);
  const a1 = validateA1Gate(a1PlanBytes, a1ResultBytes);
  const oldPlan = JSON.parse(new TextDecoder().decode(a1PlanBytes)) as any;
  const inputPaths = { ...oldPlan.inputs, seedAudit: opt.seedAudit, seedLedger: opt.seedLedger };
  const fresh = await buildCopyPreflight({ ...oldPlan.inputs, out: opt.out });
  if (!same(comparablePreflight(fresh as Record<string, unknown>),
      comparablePreflight(oldPlan.preflight)) || fresh.status !== "pass")
    throw new Error("A2 source, code, catalog, rule or step-0 preflight drifted after A1");
  const seedAllocationSha256 = validateV2Seeds(JSON.parse(new TextDecoder().decode(auditBytes)),
    JSON.parse(new TextDecoder().decode(ledgerBytes)));
  const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(inputPaths.cache, name)) });
  const cp = cache.checkpoints.find((x) => x.step === 900_000);
  if (!cp || cp.fileDigest.sha256 !== fresh.checkpoint.digest.sha256)
    throw new Error("A2 frozen late checkpoint unavailable");
  const { state } = decodeArtifact(await Deno.readFile(join(inputPaths.cache, cp.file)));
  const catalog = await readJson<ExtractionCatalog>(inputPaths.catalog);
  const time = catalog.times.find((x) => x.step === 900_000);
  const selected = time?.components.find((x) => x.idx === fresh.selectedComponent.idx);
  if (!selected) throw new Error("A2 frozen source packet membership unavailable");
  const packet = extractCellPacket(state, selected.cellIndices);
  if (packet.sha256 !== a1.sourcePacketSha256) throw new Error("A2 source packet differs from A1");
  const starts = (["donor", "founder-genotype", "zero-controller-genotype", "empty"] as const)
    .map((arm) => prepareV2Start(cache.source, 0, arm, arm === "empty" ? null : packet));
  const stage = planV2Stage(0, packet.sha256);
  if (!same(starts.map((x) => x.arm), stage.rows.map((x) => x.arm)) ||
      !same(starts[0].state.cells, starts[1].state.cells) ||
      !same(starts[1].state.cells, starts[2].state.cells))
    throw new Error("A2 same-packet intervention starts diverged");
  const inputFiles: Record<string, FileDigest> = {
    a1Plan: sha256(a1PlanBytes), a1Result: sha256(a1ResultBytes),
    seedAudit: sha256(auditBytes), seedLedger: sha256(ledgerBytes),
    sourceManifest: fresh.sourceFiles["manifest.json"], cacheManifest: fresh.cacheManifestFile,
    catalog: fresh.catalogFile, rule: fresh.ruleFile, checkpoint: cp.fileDigest,
  };
  const codeFiles: Record<string, FileDigest> = {};
  for (const name of new Set([...SERIAL_V2_CODE_FILES, ...Object.keys(cache.source.replayCodeFiles),
    ...Object.keys(fresh.codeFiles)])) codeFiles[name] = await fileDigest(join(root, name));
  for (const [name, digest] of Object.entries(fresh.codeFiles))
    if (!same(codeFiles[name], digest)) throw new Error(`A2 source closure drifted: ${name}`);
  return { format: "foundation-serial-v2-plan/v1", status: "planned", stage: 0,
    createdAt: new Date().toISOString(), outputPath: opt.out, maxSeconds: opt.maxSeconds,
    claim: "one-selected-source-intervention-feasibility-only", a1,
    a1PlanPath, a1ResultPath, inputPaths, inputFiles, codeFiles, seedAllocationSha256,
    sourceRunId: cache.source.runId, sourceRevision: cache.source.codeRevision,
    sourceCheckpointSha256: cp.fileDigest.sha256, sourcePacketSha256: packet.sha256,
    donorComponentIndex: fresh.selectedComponent.idx, seeds: SERIAL_V2_SEEDS,
    horizon: 3000, fineCensus: 25, coarseCensus: 100, recruitmentEnd: 1000,
    arms: starts.map((x) => ({ arm: x.arm, seed: x.seed, initialStateHash: x.initialStateHash,
      initialInventory: x.initialInventory, sourcePacketSha256: x.sourcePacket?.sha256 ?? null,
      inoculumSha256: x.inoculum?.sha256 ?? null, eligibleRootsAtStep0: x.eligibleRootsAtStep0,
      transplantAudit: x.transplantAudit })) };
}

const comparablePlan = (x: V2Stage0Plan) => ({ ...x, createdAt: undefined,
  inputFiles: { ...x.inputFiles, seedLedger: undefined } });
async function loadV2Stage0Starts(plan: V2Stage0Plan) {
  const store = { read: (name: string) => Deno.readFile(join(plan.inputPaths.cache, name)) };
  const cache = await verifyReplayCache(store);
  const cp = cache.checkpoints.find((x) => x.step === 900_000);
  if (!cp || cp.fileDigest.sha256 !== plan.sourceCheckpointSha256)
    throw new Error("A2 checkpoint differs from frozen plan");
  const { state } = decodeArtifact(await store.read(cp.file));
  const catalog = await readJson<ExtractionCatalog>(plan.inputPaths.catalog);
  const time = catalog.times.find((x) => x.step === 900_000);
  const component = time?.components.find((x) => x.idx === plan.donorComponentIndex);
  if (!component) throw new Error("A2 donor catalog membership missing");
  const packet = extractCellPacket(state, component.cellIndices);
  if (packet.sha256 !== plan.sourcePacketSha256)
    throw new Error("A2 donor packet differs from frozen plan");
  const starts = (["donor", "founder-genotype", "zero-controller-genotype", "empty"] as const)
    .map((arm) => prepareV2Start(cache.source, 0, arm, arm === "empty" ? null : packet));
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i], row = plan.arms[i];
    if (start.arm !== row.arm || start.seed !== row.seed ||
        start.initialStateHash !== row.initialStateHash ||
        start.inoculum?.sha256 !== (row.inoculumSha256 ?? undefined) ||
        !same(start.initialInventory, row.initialInventory) ||
        !same(start.transplantAudit, row.transplantAudit))
      throw new Error(`A2 ${start.arm} start changed from frozen plan`);
  }
  return starts;
}

async function acquireGpu() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("A2 WebGPU adapter unavailable");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo;
    requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("A2 WebGPU adapter identity unavailable");
  const device = await adapter.requestDevice({ requiredFeatures:
    adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, adapter: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}

async function executeV2Stage0(plan: V2Stage0Plan, planFile: FileDigest,
  resultPath: string): Promise<void> {
  const begun = performance.now();
  const result: V2Stage0Result = { format: "foundation-serial-v2-result/v1", status: "running",
    planFile, postExecutionRevalidated: false, startedAt: new Date().toISOString(),
    elapsedSeconds: 0, overrun: false,
    runtime: { deno: Deno.version.deno, os: Deno.build.os, arch: Deno.build.arch, adapter: null },
    rows: plan.arms.map((x) => ({ arm: x.arm, status: "planned", outcome: null })) };
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
      throw new V2TimeCapError(`A2 ${plan.maxSeconds}s cap exceeded at ${where}`);
  };
  let device: GPUDevice | undefined;
  let reservation: V2SeedReservation | undefined;
  try {
    await save(); check("source authentication");
    const opt: V2Args = { a1Dir: dirname(plan.a1PlanPath), seedAudit: plan.inputPaths.seedAudit,
      seedLedger: plan.inputPaths.seedLedger, out: plan.outputPath,
      maxSeconds: plan.maxSeconds, execute: false };
    const fresh = await buildV2Stage0Plan(opt);
    if (!same(comparablePlan(fresh), comparablePlan(plan)) ||
        !same(await fileDigest(join(plan.outputPath, "plan.json")), planFile))
      throw new Error("A2 frozen source, seed allocation, code or plan changed before GPU");
    const starts = await loadV2Stage0Starts(plan);
    check("after initial reconstruction");
    assertNoCompetingGpuRun();
    reservation = await reserveV2Seed(plan.outputPath, 0, SERIAL_V2_SEEDS[0],
      planFile, plan.seedAllocationSha256);
    const acquired = await acquireGpu(); device = acquired.device;
    result.runtime.adapter = acquired.adapter; await save(); check("after GPU acquisition");
    const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`,
      adapter: [acquired.adapter.description, acquired.adapter.device, acquired.adapter.vendor]
        .find(Boolean) ?? "adapter-info-empty" };
    for (let i = 0; i < starts.length; i++) {
      const row = result.rows[i], start = starts[i];
      check(`before ${row.arm}`); row.status = "running"; await save();
      try {
        row.outcome = await runV2Garden(device, start, host, check, async (partial) => {
          row.partial = partial; await save();
        });
        row.status = "complete"; await save();
      } catch (error) {
        row.status = error instanceof V2TimeCapError ? "incomplete-time-cap" : "failed";
        row.failure = error instanceof Error ? error.message : String(error);
        await save(); throw error;
      }
    }
    check("post-execution revalidation");
    const post = await buildV2Stage0Plan(opt);
    if (!same(comparablePlan(post), comparablePlan(plan)) ||
        !same(await fileDigest(join(plan.outputPath, "plan.json")), planFile))
      throw new Error("A2 source, seed allocation, code or plan changed after GPU");
    result.codeFilesAfter = post.codeFiles;
    result.postExecutionRevalidated = true;
    result.status = "complete"; check("before final publication"); await save(true);
    console.log(JSON.stringify({ status: result.status, rows: result.rows.length,
      out: plan.outputPath }));
  } catch (error) {
    result.status = error instanceof V2TimeCapError ? "incomplete-time-cap" : "failed";
    result.failure = error instanceof Error ? error.message : String(error);
    await save(true); throw error;
  } finally {
    device?.destroy();
    if (reservation) await completeV2Seed(reservation,
      result.status === "running" ? "failed" : result.status);
  }
}

async function main() {
  const opt = parseV2Args(Deno.args);
  if (opt.execute) {
    const planPath = join(opt.out, "plan.json"), resultPath = join(opt.out, "result.json");
    const bytes = await Deno.readFile(planPath);
    const plan = JSON.parse(new TextDecoder().decode(bytes)) as V2Stage0Plan;
    if (plan.format !== "foundation-serial-v2-plan/v1" || plan.status !== "planned" ||
        plan.stage !== 0 || plan.outputPath !== opt.out || !Number.isFinite(plan.maxSeconds) ||
        plan.maxSeconds <= 0 || plan.maxSeconds > 600 || plan.arms.length !== 4 ||
        !same(plan.seeds, SERIAL_V2_SEEDS))
      throw new Error("A2 execution requires a valid frozen stage-0 plan");
    const reserved = await Deno.open(resultPath, { write: true, createNew: true });
    reserved.close();
    await executeV2Stage0(plan, sha256(bytes), resultPath);
    return;
  }
  await Deno.mkdir(dirname(opt.out), { recursive: true });
  await Deno.mkdir(opt.out); // create-new reservation
  try {
    const plan = await buildV2Stage0Plan(opt);
    await Deno.writeTextFile(join(opt.out, "plan.json"), JSON.stringify(plan, null, 2) + "\n",
      { createNew: true });
    console.log(JSON.stringify({ status: "planned", stage: 0, arms: plan.arms.length,
      gpuStarted: false, out: opt.out }));
  } catch (error) {
    await Deno.writeTextFile(join(opt.out, "planning-failure.json"), JSON.stringify({ status: "failed",
      error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n",
      { createNew: true });
    throw error;
  }
}
if (import.meta.main) await main();
