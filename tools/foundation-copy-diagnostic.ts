/** Plan-first, bounded A1 source-1 diagnostic. Never runs a GPU without --execute. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENOME_CHANNELS, cellCount, cloneState, stateHash,
  type WorldState } from "@bl/schema";
import { census, DEFAULT_CENSUS } from "@bl/metrics";
import { runExperiment, type HostInfo } from "@bl/runner";
import { GpuSim } from "@bl/sim-gpu";
import { buildCopyPreflight, parseCopyAncestryArgs } from "./foundation-copy-ancestry.ts";
import { assertColorSnapshotParity, assertColorTwinParity, colorLivingSources,
  diagnoseComponentTransitions, initialCopyRegions, type ColorSnapshot } from
  "./lib/foundation-copy-ancestry.ts";
import { componentMaterialEvidence, type MeasuredTransportView } from
  "./lib/foundation-component-material.ts";
import { ObservationHashSink, sha256, verifyReplayCache, type FileDigest } from
  "./lib/foundation-replay.ts";
import { SERIAL_SOURCE_RUN, prepareSerialStart, serialSpec } from
  "./lib/foundation-serial-transfer.ts";
import { SerialGardenCapture, type SerialCaptureResult } from
  "./lib/foundation-serial-capture.ts";
import { validateFrozenSerialPlan, type SerialManifest } from
  "./foundation-serial-transfer.ts";

const DIAGNOSTIC_STEPS = [175, 200, 225] as const;
const HORIZON = 250;
const PHYSICS_HORIZON = 3000;
type Status = "planned" | "running" | "verified" | "incomplete-time-cap" | "failed";

interface Args { out: string; execute: boolean; maxSeconds?: number; source?: string;
  cache?: string; catalog?: string; rule?: string; priorSerial?: string }
export function parseCopyDiagnosticArgs(args: string[]): Args {
  const values = new Map<string, string>(); let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!["--out", "--source", "--cache", "--catalog", "--rule", "--prior-serial", "--max-seconds"]
      .includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid or duplicate option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  if (!values.get("--out")) throw new Error("--out is required");
  if (execute && values.size !== 1) throw new Error("--execute accepts only --out; use the frozen plan");
  if (!execute) for (const key of ["--source", "--cache", "--catalog", "--rule", "--prior-serial", "--max-seconds"])
    if (!values.get(key)) throw new Error(`${key} is required before planning`);
  const maxSeconds = values.has("--max-seconds") ? Number(values.get("--max-seconds")) : undefined;
  if (maxSeconds !== undefined && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 180))
    throw new Error("--max-seconds must be finite, positive and <=180");
  const path = (key: string) => values.has(key) ? resolve(values.get(key)!) : undefined;
  return { out: resolve(values.get("--out")!), execute, maxSeconds,
    source: path("--source"), cache: path("--cache"), catalog: path("--catalog"),
    rule: path("--rule"), priorSerial: path("--prior-serial") };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const digestEqual = (a: FileDigest | undefined, b: FileDigest | undefined) =>
  !!a && !!b && a.sha256 === b.sha256 && a.bytes === b.bytes;
const comparablePlan = (plan: FrozenPlan) => ({ ...plan, createdAt: undefined,
  preflight: { ...plan.preflight, createdAt: undefined } });
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await Deno.readTextFile(path)) as T;
const fileDigest = async (path: string) => sha256(await Deno.readFile(path));

interface FrozenPlan {
  format: 1; status: "planned"; createdAt: string; outputPath: string; maxSeconds: number;
  inputs: { source: string; cache: string; catalog: string; rule: string; priorSerial: string };
  preflight: Awaited<ReturnType<typeof buildCopyPreflight>>;
  priorSerialFile: FileDigest; priorSerialPlanFile: FileDigest;
  oldDonor: { initialStateHash: string; sourcePacketSha256: string;
    measuredPhysicsHash: string; measuredArtifactHash: string;
    observationFiles: Record<string, FileDigest> };
  diagnosticSteps: readonly number[]; horizon: number; physicsHorizon: number;
  claim: "selected-debugging-replay-only";
}

async function checkedPrior(planInputs: FrozenPlan["inputs"], report: FrozenPlan["preflight"]) {
  const priorBytes = await Deno.readFile(planInputs.priorSerial);
  const prior = JSON.parse(new TextDecoder().decode(priorBytes)) as SerialManifest;
  const immutablePath = join(dirname(planInputs.priorSerial), "plan.json");
  const immutableBytes = await Deno.readFile(immutablePath);
  const immutable = JSON.parse(new TextDecoder().decode(immutableBytes)) as SerialManifest;
  const immutableDigest = sha256(immutableBytes), priorDigest = sha256(priorBytes);
  validateFrozenSerialPlan(prior, immutable, immutableDigest);
  if (prior.stage !== 0 || prior.status !== "complete" || prior.postExecutionRevalidated !== true ||
      prior.execution.requested !== true || prior.runtime?.overrun ||
      prior.rows.length !== 3 || prior.rows[0].arm !== "donor" ||
      prior.rows[0].status !== "complete" || !prior.rows[0].outcome ||
      !prior.rows[0].outcome.conservationOk || prior.rows[0].outcome.mutationCount !== 0 ||
      !prior.rows[0].outcome.reference.matchedMeasured ||
      prior.sourceRunId !== SERIAL_SOURCE_RUN ||
      !same(prior.sourceFiles, report.sourceFiles) ||
      !digestEqual(prior.cacheManifestFile, report.cacheManifestFile) ||
      !digestEqual(prior.catalogFile, report.catalogFile) ||
      !digestEqual(prior.ruleFile, report.ruleFile) ||
      prior.sourceFinalArtifactHash !== report.sourceFinalArtifactHash ||
      prior.rows[0].sourcePacket?.sha256 !== report.selectedComponent.packetSha256 ||
      prior.inputPaths.source !== planInputs.source || prior.inputPaths.cache !== planInputs.cache ||
      prior.inputPaths.catalog !== planInputs.catalog || prior.inputPaths.rule !== planInputs.rule ||
      !same(prior.codeFilesBefore, prior.codeFilesAfter))
    throw new Error("serial-v1 donor is not reusable authenticated evidence for this source");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [name, digest] of Object.entries(prior.codeFilesBefore))
    if (!digestEqual(report.codeFiles[name] ?? await fileDigest(join(root, name)), digest))
      throw new Error(`serial-v1 source code changed: ${name}`);
  return { prior, priorDigest, immutableDigest };
}

async function buildPlan(args: Args): Promise<FrozenPlan> {
  const inputs = { source: args.source!, cache: args.cache!, catalog: args.catalog!, rule: args.rule!,
    priorSerial: args.priorSerial! };
  const preflight = await buildCopyPreflight({ ...inputs, out: args.out });
  if (preflight.status !== "pass") throw new Error(`A1 geometry preflight blocked: ${preflight.reason}`);
  const { prior, priorDigest, immutableDigest } = await checkedPrior(inputs, preflight);
  const donor = prior.rows[0], outcome = donor.outcome!;
  const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(inputs.cache, name)) });
  const start = prepareSerialStart(cache.source, 0, "donor", donor.sourcePacket);
  if (start.initialStateHash !== donor.initialStateHash ||
      start.inoculum.sha256 !== donor.inoculumSha256 ||
      start.sourcePacket?.sha256 !== preflight.selectedComponent.packetSha256)
    throw new Error("serial-v1 donor initial state/packet cannot be reconstructed exactly");
  return { format: 1, status: "planned", createdAt: new Date().toISOString(),
    outputPath: args.out, maxSeconds: args.maxSeconds!, inputs, preflight,
    priorSerialFile: priorDigest, priorSerialPlanFile: immutableDigest,
    oldDonor: { initialStateHash: donor.initialStateHash!,
      sourcePacketSha256: donor.sourcePacket!.sha256,
      measuredPhysicsHash: outcome.measuredPhysicsHash,
      measuredArtifactHash: outcome.measuredArtifactHash,
      observationFiles: outcome.observationFiles },
    diagnosticSteps: DIAGNOSTIC_STEPS, horizon: HORIZON, physicsHorizon: PHYSICS_HORIZON,
    claim: "selected-debugging-replay-only" };
}

interface DiagnosticResult {
  format: 1; status: Status; planFile: FileDigest; startedAt: string; endedAt?: string;
  elapsedSeconds: number; overrun: boolean; adapter: { vendor: string | null;
    architecture: string | null; device: string | null; description: string | null } | null;
  deno: string; os: string; readbackBytes: number; parityThroughStep: number;
  fullParitySteps: number[]; censusTransitions: unknown[]; materialEvidence: unknown[];
  serialTraceMatched: boolean | null; terminalPhysicsMatched: boolean | null;
  originalArtifactMatched: boolean | null; observationHashesMatched: boolean | null;
  failure?: string;
}
export class CopyDiagnosticTimeCapError extends Error {}
const currentView = (cfg: WorldState["cfg"], snap: Awaited<ReturnType<GpuSim["readSnapshot"]>>): MeasuredTransportView =>
  ({ cfg, step: snap.step, cells: snap.cells, genomeHead: snap.genomeHead, flux: snap.flux });
const snapshot = (view: MeasuredTransportView): ColorSnapshot =>
  ({ step: view.step, cells: view.cells, genomeHead: view.genomeHead, flux: view.flux });
const prefix = (rows: readonly { step: number }[], step: number) =>
  rows.filter((row) => row.step <= step);
function checkTracePrefix(capture: SerialCaptureResult, old: SerialCaptureResult, step: number): void {
  for (const key of ["censuses25", "censuses100", "events25", "overlapMixing25", "candidates"] as const)
    if (!same(prefix(capture[key], step), prefix(old[key], step)))
      throw new Error(`serial-v1 assay observation trace mismatch in ${key} through step ${step}`);
}

async function acquire(gpu: GPU) {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo;
    requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("WebGPU adapter identity unavailable");
  const device = await adapter.requestDevice({ requiredFeatures:
    adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, identity: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}

async function execute(plan: FrozenPlan, planFile: FileDigest, resultPath: string): Promise<void> {
  const begun = performance.now();
  const result: DiagnosticResult = { format: 1, status: "running", planFile,
    startedAt: new Date().toISOString(), elapsedSeconds: 0, overrun: false, adapter: null,
    deno: Deno.version.deno, os: `${Deno.build.os}/${Deno.build.arch}`, readbackBytes: 0,
    parityThroughStep: 0, fullParitySteps: [], censusTransitions: [], materialEvidence: [],
    serialTraceMatched: null, terminalPhysicsMatched: null, originalArtifactMatched: null,
    observationHashesMatched: null };
  const save = async (end = false) => {
    result.elapsedSeconds = (performance.now() - begun) / 1000;
    result.overrun = result.elapsedSeconds > plan.maxSeconds;
    if (end) result.endedAt = new Date().toISOString();
    await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2) + "\n");
  };
  const check = (where: string) => {
    if ((performance.now() - begun) / 1000 > plan.maxSeconds)
      throw new CopyDiagnosticTimeCapError(`A1 ${plan.maxSeconds}s cap exceeded at ${where}`);
  };
  let device: GPUDevice | undefined, plain: GpuSim | undefined, colored: GpuSim | undefined;
  try {
    await save();
    check("source revalidation");
    const fresh = await buildPlan({ out: plan.outputPath, execute: false, maxSeconds: plan.maxSeconds,
      ...plan.inputs });
    if (!same(comparablePlan(fresh), comparablePlan(plan)))
      throw new Error("A1 frozen plan source, code or prior-serial identity drifted before GPU");
    const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(plan.inputs.cache, name)) });
    const prior = await readJson<SerialManifest>(plan.inputs.priorSerial);
    const row = prior.rows[0], outcome = row.outcome!;
    const start = prepareSerialStart(cache.source, 0, "donor", row.sourcePacket).state;
    if (stateHash(start) !== plan.oldDonor.initialStateHash)
      throw new Error("A1 natural initial state differs from serial-v1 frozen start");
    const twin = colorLivingSources(start);
    const initialRegions = initialCopyRegions(twin.state);
    const captured = new SerialGardenCapture({ sourceKey: SERIAL_SOURCE_RUN, arm: "donor", cycle: 0,
      seed: start.cfg.seed, importedFragment: { kind: "evolved-source-unknown-age" } });
    captured.observe(start);
    const { device: acquired, identity } = await acquire(navigator.gpu);
    device = acquired; result.adapter = identity; await save();
    plain = await GpuSim.create(device, cloneState(start));
    colored = await GpuSim.create(device, twin.state);
    let priorPlain = currentView(start.cfg, await plain.readSnapshot());
    let priorColor = currentView(start.cfg, await colored.readSnapshot());
    assertColorSnapshotParity(snapshot(priorPlain), snapshot(priorColor));
    result.readbackBytes += 2 * (7 + 4) * cellCount(start.cfg) * 4;
    let priorCensusPlain = priorPlain;
    for (let step = 1; step <= HORIZON; step++) {
      check(`step ${step}`);
      plain.run(1); colored.run(1);
      const [plainSnap, colorSnap] = await Promise.all([plain.readSnapshot(), colored.readSnapshot()]);
      const currentPlain = currentView(start.cfg, plainSnap), currentColor = currentView(start.cfg, colorSnap);
      result.readbackBytes += 2 * (7 + 4) * cellCount(start.cfg) * 4;
      assertColorSnapshotParity(snapshot(currentPlain), snapshot(currentColor));
      result.parityThroughStep = step;
      if ((DIAGNOSTIC_STEPS as readonly number[]).includes(step)) {
        const n = cellCount(start.cfg);
        const c = census({ cfg: start.cfg, step, cells: currentPlain.cells,
          genomeHead: currentPlain.genomeHead }, DEFAULT_CENSUS);
        for (const component of c.components)
          result.materialEvidence.push(componentMaterialEvidence(priorPlain, priorColor,
            currentPlain, currentColor, component.idx));
        if (!c.components.length)
          result.materialEvidence.push({ step, status: "zero-components", cellCount: n });
      }
      if (step % 25 === 0) {
        const [plainFull, coloredFull] = await Promise.all([plain.readState(), colored.readState()]);
        result.readbackBytes += 2 * (7 + GENOME_CHANNELS) * cellCount(start.cfg) * 4;
        assertColorTwinParity(plainFull, coloredFull);
        result.fullParitySteps.push(step);
        captured.observe(plainFull);
        result.censusTransitions.push({ step, components: diagnoseComponentTransitions(
          priorCensusPlain, currentColor, twin.colors, initialRegions) });
        priorCensusPlain = currentPlain;
        checkTracePrefix(captured.snapshot(), outcome.capture, step);
        await save();
      }
      priorPlain = currentPlain; priorColor = currentColor;
    }
    result.serialTraceMatched = true;
    colored.destroy(); colored = undefined;
    for (let at = HORIZON; at < PHYSICS_HORIZON;) {
      check(`unsampled continuation ${at}`);
      const count = Math.min(100, PHYSICS_HORIZON - at);
      plain.run(count); await device.queue.onSubmittedWorkDone(); at += count;
    }
    const final = await plain.readState();
    const ledger = await plain.drainLedger();
    result.readbackBytes += (7 + GENOME_CHANNELS) * cellCount(start.cfg) * 4;
    if (ledger.events.length || ledger.dropped || stateHash(final) !== plan.oldDonor.measuredPhysicsHash)
      throw new Error("A1 unsampled terminal physics differs from serial-v1 donor");
    result.terminalPhysicsMatched = true; await save();
    plain.destroy(); plain = undefined;
    const sink = new ObservationHashSink();
    const host: HostInfo = { host: `${Deno.build.os}/${Deno.build.arch}`,
      adapter: `${identity.vendor ?? "unknown"}/${identity.device ?? "unknown"}` };
    const replay = await runExperiment(device, serialSpec(cache.source, 0), sink, host,
      () => check("original observer replay"), { start: cloneState(start), keepFinal: true });
    if (!replay.final || replay.summary.mutations !== 0 || !replay.summary.conservationOk ||
        stateHash(replay.final) !== plan.oldDonor.measuredPhysicsHash ||
        replay.summary.finalHash !== plan.oldDonor.measuredArtifactHash)
      throw new Error("A1 original runner physics/artifact replay differs from serial-v1 donor");
    result.originalArtifactMatched = true;
    if (!same(sink.digest(), plan.oldDonor.observationFiles))
      throw new Error("A1 original runner observation files differ from serial-v1 donor");
    result.observationHashesMatched = true;
    check("post-execution revalidation");
    const post = await buildPlan({ out: plan.outputPath, execute: false, maxSeconds: plan.maxSeconds,
      ...plan.inputs });
    if (!same(comparablePlan(post), comparablePlan(plan)) ||
        !digestEqual(await fileDigest(plan.inputs.priorSerial), plan.priorSerialFile) ||
        !digestEqual(await fileDigest(join(dirname(plan.inputs.priorSerial), "plan.json")), plan.priorSerialPlanFile))
      throw new Error("A1 source/code/prior identity changed after GPU replay");
    result.status = "verified"; await save(true);
  } catch (error) {
    result.status = error instanceof CopyDiagnosticTimeCapError ? "incomplete-time-cap" : "failed";
    result.failure = errorText(error); await save(true);
    throw error;
  } finally { colored?.destroy(); plain?.destroy(); device?.destroy(); }
}

async function main() {
  const args = parseCopyDiagnosticArgs(Deno.args);
  if (!args.execute) {
    await Deno.mkdir(dirname(args.out), { recursive: true });
    await Deno.mkdir(args.out); // create-new reservation before any future GPU call
    try {
      const plan = await buildPlan(args);
      await Deno.writeTextFile(join(args.out, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
      console.log(`A1 CPU plan saved at ${args.out}; status planned; no GPU used`);
    } catch (error) {
      await Deno.writeTextFile(join(args.out, "planning-failure.json"),
        JSON.stringify({ status: "failed", error: errorText(error) }, null, 2) + "\n");
      throw error;
    }
    return;
  }
  const planPath = join(args.out, "plan.json"), resultPath = join(args.out, "result.json");
  const planBytes = await Deno.readFile(planPath), plan = JSON.parse(new TextDecoder().decode(planBytes)) as FrozenPlan;
  if (plan.format !== 1 || plan.status !== "planned" || plan.outputPath !== args.out ||
      !same(plan.diagnosticSteps, DIAGNOSTIC_STEPS) || plan.horizon !== HORIZON ||
      plan.physicsHorizon !== PHYSICS_HORIZON || !Number.isFinite(plan.maxSeconds) ||
      plan.maxSeconds <= 0 || plan.maxSeconds > 180)
    throw new Error("A1 plan malformed or does not match this diagnostic protocol");
  const reserved = await Deno.open(resultPath, { write: true, createNew: true });
  reserved.close();
  await execute(plan, sha256(planBytes), resultPath);
}
if (import.meta.main) await main();
