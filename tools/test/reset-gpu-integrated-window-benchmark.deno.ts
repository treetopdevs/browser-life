/** Opt-in 1100-step exact window cost/parity control, no selected-link analysis. */
import { createHash } from "node:crypto";
import { artifactDigest, stateHash } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { ResetProbeAObserver, type ResetCheckpointIdentity } from "../lib/reset-probe-a-observer.ts";
import { resetWindowFrame } from "../lib/reset-window.ts";
import { ResetWindowPersistence } from "../lib/reset-window-persistence.ts";

const checkpoint = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/checkpoints/t000100000.blck";
const sourceManifest = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/manifest.json";
const codePaths = ["packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "packages/runner/src/observe.ts", "tools/lib/reset-gpu-copy-audit.ts",
  "tools/lib/reset-copy-extraction.ts", "tools/lib/reset-topology.ts",
  "tools/lib/reset-window.ts", "tools/lib/reset-window-persistence.ts",
  "tools/lib/reset-probe-a-observer.ts",
  "tools/test/reset-gpu-integrated-window-benchmark.deno.ts"];
const identity = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
};
const startedAt = new Date().toISOString(), start = performance.now();
await Deno.mkdir("runs/foundational-reset", { recursive: true });
const output = `runs/foundational-reset/gpu-integrated-window-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const receipt: Record<string, unknown> = { status: "started-development-integrated-window",
  startedAt, maxSeconds: 60, steps: 1100, censusEvery: 100,
  scope: "authenticated checkpoint cost and bare-twin physics/observer parity only; no selected-link or natural candidate result reported",
  checkpoint: await identity(checkpoint), sourceManifest: await identity(sourceManifest),
  codeBefore: await Promise.all(codePaths.map(identity)) };
const save = () => Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
await save();
let bare: GpuSim | undefined, passive: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
try {
  const source = JSON.parse(await Deno.readTextFile(sourceManifest));
  const bytes = await Deno.readFile(checkpoint), { state, observer } = decodeArtifact(bytes);
  const row = source.checkpoints.find((x: { step: number }) => x.step === state.step);
  if (!row || row.hash !== stateHash(state))
    throw new Error("original checkpoint differs from source manifest");
  const identityAtStart: ResetCheckpointIdentity = {
    bytesSha256: (receipt.checkpoint as { sha256: string }).sha256,
    physicsHash: row.hash, artifactDigest: artifactDigest(state, observer) };
  const device = await requestDevice(navigator.gpu, state.cfg);
  receipt.adapter = { description: device.adapterInfo.description,
    vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture };
  bare = await GpuSim.create(device, state); passive = await GpuSim.create(device, state);
  audit = await ResetGpuCopyAudit.create(passive, state);
  const bareObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec,
    identityAtStart).adapter;
  const passiveObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec,
    identityAtStart).adapter;
  const baselineStart = performance.now();
  const bareEvents: unknown[] = [];
  for (let census = 0; census < 11; census++) {
    bare.run(100);
    const [physical, ledger] = await Promise.all([bare.readSnapshot(), bare.drainLedger()]);
    if (ledger.dropped) throw new Error("bare benchmark dropped mutations");
    bareObserver.observeNext(physical, ledger.events.length);
    bareEvents.push(...ledger.events);
  }
  const bareElapsedMs = performance.now() - baselineStart;
  const persistence = new ResetWindowPersistence(state.cfg, state.step,
    512 * 1024 * 1024);
  let priorCells = state.cells;
  let intervalEvents = 0;
  const passiveEvents: unknown[] = [];
  const passiveStart = performance.now();
  for (let offset = 1; offset <= 1100; offset++) {
    if ((performance.now() - start) > 60000)
      throw new Error("integrated window development cap reached");
    audit.run(1);
    const [physical, copied, ledger] = await Promise.all([
      passive.readSnapshot(), audit.readSnapshot(), passive.drainLedger()]);
    if (ledger.dropped) throw new Error("passive benchmark dropped mutations");
    const oneStep = ResetOriginMap.fromSnapshot(copied);
    let flags = [] as ReturnType<typeof resetWindowFrame>["flags"];
    if (offset <= 1000) {
      const raw = resetWindowFrame(state.cfg, physical.step, state.step + 1,
        state.step + 1000, priorCells, physical.cells, physical.genomeHead, oneStep);
      flags = raw.flags;
    }
    persistence.observeStep(physical.step, physical.cells, physical.genomeHead,
      oneStep, flags);
    priorCells = physical.cells;
    passiveEvents.push(...ledger.events); intervalEvents += ledger.events.length;
    if (offset % 100 === 0) {
      passiveObserver.observeNext(physical, intervalEvents);
      intervalEvents = 0;
    }
    if (offset < 1100) audit.rebaseFromCurrentGpu(physical.step);
  }
  const passiveElapsedMs = performance.now() - passiveStart;
  const [bareFinal, passiveFinal] = await Promise.all([bare.readState(), passive.readState()]);
  if (stateHash(bareFinal) !== stateHash(passiveFinal) ||
      artifactDigest(bareFinal, bareObserver.observerState()) !==
        artifactDigest(passiveFinal, passiveObserver.observerState()) ||
      JSON.stringify(bareEvents) !== JSON.stringify(passiveEvents) ||
      persistence.results().some(x => x.status !== "complete-100-future-samples"))
    throw new Error("integrated passive window changed physics, observer, mutation ledger or descriptor completeness");
  receipt.status = "passed-development-integrated-window";
  receipt.bareElapsedMs = bareElapsedMs;
  receipt.passiveWindowElapsedMs = passiveElapsedMs;
  receipt.overheadRatio = passiveElapsedMs / bareElapsedMs;
  receipt.terminalPhysicsHash = stateHash(passiveFinal);
  receipt.terminalArtifactDigest = artifactDigest(passiveFinal,
    passiveObserver.observerState());
  receipt.mutationEvents = passiveEvents.length;
  receipt.checkpointAfter = await identity(checkpoint);
  receipt.codeAfter = await Promise.all(codePaths.map(identity));
  if (JSON.stringify(receipt.checkpointAfter) !== JSON.stringify(receipt.checkpoint) ||
      JSON.stringify(receipt.codeAfter) !== JSON.stringify(receipt.codeBefore))
    throw new Error("integrated window benchmark source changed");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  receipt.overrun = Number(receipt.totalElapsedMs) > 60000;
  if (receipt.overrun) throw new Error("integrated window benchmark exceeded cap");
  await save(); console.log(output);
} catch (error) {
  receipt.status = "failed-development-integrated-window";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  await save(); throw error;
} finally { audit?.destroy(); passive?.destroy(); bare?.destroy(); }
