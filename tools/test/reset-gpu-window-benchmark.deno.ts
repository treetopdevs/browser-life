/** Opt-in development cost/parity check for per-step window observation; no link outcomes. */
import { createHash } from "node:crypto";
import { artifactDigest, stateHash } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { ResetProbeAObserver, type ResetCheckpointIdentity } from "../lib/reset-probe-a-observer.ts";
import { resetWindowFrame } from "../lib/reset-window.ts";

const checkpoint = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/checkpoints/t000100000.blck";
const manifestPath = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/manifest.json";
const codePaths = ["packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "packages/runner/src/observe.ts", "tools/lib/reset-gpu-copy-audit.ts",
  "tools/lib/reset-copy-extraction.ts", "tools/lib/reset-topology.ts",
  "tools/lib/reset-window.ts", "tools/lib/reset-probe-a-observer.ts",
  "tools/test/reset-gpu-window-benchmark.deno.ts"];
const identity = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
};
const startedAt = new Date().toISOString(), started = performance.now();
await Deno.mkdir("runs/foundational-reset", { recursive: true });
const output = `runs/foundational-reset/gpu-window-benchmark-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const receipt: Record<string, unknown> = { status: "started-development-window-benchmark",
  startedAt, maxSeconds: 60, steps: 100, censusEvery: 100,
  scope: "authenticated seed-1 checkpoint cost and physics/observer parity only; no selected-link or natural candidate results",
  checkpoint: await identity(checkpoint), manifest: await identity(manifestPath),
  codeBefore: await Promise.all(codePaths.map(identity)) };
await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
let bare: GpuSim | undefined, passive: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
try {
  const bytes = await Deno.readFile(checkpoint);
  const source = JSON.parse(await Deno.readTextFile(manifestPath));
  const { state, observer } = decodeArtifact(bytes);
  const row = source.checkpoints.find((x: { step: number }) => x.step === state.step);
  if (!row || row.hash !== stateHash(state))
    throw new Error("original checkpoint physics differs from main source manifest");
  const frozen: ResetCheckpointIdentity = {
    bytesSha256: (receipt.checkpoint as { sha256: string }).sha256,
    physicsHash: row.hash, artifactDigest: artifactDigest(state, observer),
  };
  const device = await requestDevice(navigator.gpu, state.cfg);
  receipt.adapter = { description: device.adapterInfo.description,
    vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture };
  bare = await GpuSim.create(device, state);
  passive = await GpuSim.create(device, state);
  audit = await ResetGpuCopyAudit.create(passive, state);
  const bareObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec, frozen).adapter;
  const passiveObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec, frozen).adapter;
  const tBare = performance.now();
  bare.run(100);
  const bareLedger = await bare.drainLedger();
  const bareSnap = await bare.readSnapshot();
  bareObserver.observeNext(bareSnap, bareLedger.events.length);
  const bareElapsedMs = performance.now() - tBare;
  const tPassive = performance.now();
  let priorCells = state.cells;
  let composed = ResetOriginMap.atPhysicalCensus(state.cfg, state.step,
    state.cells, state.genome);
  for (let offset = 1; offset <= 100; offset++) {
    audit.run(1);
    const [physical, copied] = await Promise.all([passive.readSnapshot(), audit.readSnapshot()]);
    const oneStep = ResetOriginMap.fromSnapshot(copied);
    // The score is deliberately discarded: this fixture measures computation, not outcomes.
    resetWindowFrame(state.cfg, physical.step, state.step + 1, state.step + 1000,
      priorCells, physical.cells, physical.genomeHead, oneStep);
    composed = composed.compose(copied);
    priorCells = physical.cells;
    if (offset < 100) audit.rebaseFromCurrentGpu(physical.step);
    else {
      const passiveLedger = await passive.drainLedger();
      passiveObserver.observeNext(physical, passiveLedger.events.length);
      receipt.mutationEvents = passiveLedger.events.length;
      receipt.droppedMutationEvents = passiveLedger.dropped;
      if (passiveLedger.dropped || bareLedger.dropped ||
          JSON.stringify(passiveLedger.events) !== JSON.stringify(bareLedger.events))
        throw new Error("passive window changed mutation ledger");
    }
  }
  const passiveElapsedMs = performance.now() - tPassive;
  const [bareFinal, passiveFinal] = await Promise.all([bare.readState(), passive.readState()]);
  const barePhysics = stateHash(bareFinal), passivePhysics = stateHash(passiveFinal);
  const bareArtifact = artifactDigest(bareFinal, bareObserver.observerState());
  const passiveArtifact = artifactDigest(passiveFinal, passiveObserver.observerState());
  if (barePhysics !== passivePhysics || bareArtifact !== passiveArtifact ||
      composed.referenceStep !== state.step || composed.currentStep !== state.step + 100)
    throw new Error("passive window changed full physics/observer or lost original reference");
  receipt.status = "passed-development-window-benchmark";
  receipt.bareObserverElapsedMs = bareElapsedMs;
  receipt.passiveWindowElapsedMs = passiveElapsedMs;
  receipt.overheadRatio = passiveElapsedMs / bareElapsedMs;
  receipt.finalPhysicsHash = passivePhysics;
  receipt.finalArtifactDigest = passiveArtifact;
  receipt.checkpointAfter = await identity(checkpoint);
  receipt.codeAfter = await Promise.all(codePaths.map(identity));
  if (JSON.stringify(receipt.checkpointAfter) !== JSON.stringify(receipt.checkpoint) ||
      JSON.stringify(receipt.codeAfter) !== JSON.stringify(receipt.codeBefore))
    throw new Error("development benchmark source drifted");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  receipt.overrun = Number(receipt.totalElapsedMs) > 60000;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(output);
} catch (error) {
  receipt.status = "failed-development-window-benchmark";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  throw error;
} finally { audit?.destroy(); passive?.destroy(); bare?.destroy(); }
