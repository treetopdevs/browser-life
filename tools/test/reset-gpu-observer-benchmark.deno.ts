/** Opt-in exact observer + passive census-reset development benchmark; no event classification. */
import { createHash } from "node:crypto";
import { artifactDigest, stateHash } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { joinResetMutationEvents } from "../lib/reset-gpu-event-join.ts";
import { ResetProbeAObserver, type ResetCheckpointIdentity } from "../lib/reset-probe-a-observer.ts";

const checkpoint = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/checkpoints/t000100000.blck";
const manifestPath = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/manifest.json";
const codePaths = ["packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "packages/runner/src/observe.ts", "packages/runner/src/runner.ts",
  "tools/lib/reset-gpu-copy-audit.ts", "tools/lib/reset-gpu-event-join.ts",
  "tools/lib/reset-probe-a-observer.ts", "tools/test/reset-gpu-observer-benchmark.deno.ts"];
const identity = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
};
const startedAt = new Date().toISOString(), started = performance.now();
await Deno.mkdir("runs/foundational-reset", { recursive: true });
const output = `runs/foundational-reset/gpu-observer-benchmark-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const receipt: Record<string, unknown> = { status: "started-development-benchmark",
  startedAt, maxSeconds: 60, steps: 1000, censusEvery: 100,
  scope: "authenticated seed-1 checkpoint throughput only; no Test 1 link classified",
  checkpoint: await identity(checkpoint), manifest: await identity(manifestPath),
  codeBefore: await Promise.all(codePaths.map(identity)) };
await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
let plain: GpuSim | undefined, audited: GpuSim | undefined, sidecar: ResetGpuCopyAudit | undefined;
try {
  const bytes = await Deno.readFile(checkpoint), source = JSON.parse(await Deno.readTextFile(manifestPath));
  const { state, observer } = decodeArtifact(bytes);
  const checkpointRow = source.checkpoints.find((x: { step: number }) => x.step === state.step);
  if (!checkpointRow || checkpointRow.hash !== stateHash(state))
    throw new Error("original checkpoint physics differs from main manifest");
  const frozen: ResetCheckpointIdentity = {
    bytesSha256: (receipt.checkpoint as { sha256: string }).sha256,
    physicsHash: checkpointRow.hash, artifactDigest: artifactDigest(state, observer),
  };
  receipt.initialPhysicsHash = frozen.physicsHash;
  receipt.initialArtifactDigest = frozen.artifactDigest;
  const device = await requestDevice(navigator.gpu, state.cfg);
  receipt.adapter = device.adapterInfo.description;
  plain = await GpuSim.create(device, state);
  audited = await GpuSim.create(device, state);
  sidecar = await ResetGpuCopyAudit.create(audited, state);
  const baselineObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec, frozen).adapter;
  const passiveObserver = ResetProbeAObserver.fromCheckpoint(bytes, source.spec, frozen).adapter;
  const drive = async (sim: GpuSim, adapter: ResetProbeAObserver,
    copyAudit?: ResetGpuCopyAudit) => {
    const events: unknown[] = []; let dropped = 0, unavailableEffects = 0;
    const start = performance.now();
    for (let k = 0; k < 10; k++) {
      if (copyAudit) copyAudit.run(100); else sim.run(100);
      const ledger = await sim.drainLedger();
      dropped += ledger.dropped; events.push(...ledger.events);
      const frame = await sim.readSnapshot();
      adapter.observeNext(frame, ledger.events.length);
      if (copyAudit) {
        const tags = await copyAudit.readSnapshot();
        const joined = joinResetMutationEvents(state.cfg, state.step + k * 100,
          tags, ledger.events);
        unavailableEffects += joined.filter(x => x.effect === "unavailable-earlier-step").length;
        copyAudit.rebaseFromCurrentGpu(frame.step);
      }
    }
    const elapsedMs = performance.now() - start;
    const final = await sim.readState();
    return { elapsedMs, final, artifactDigest: artifactDigest(final, adapter.observerState()),
      events, dropped, unavailableEffects };
  };
  const baseline = await drive(plain, baselineObserver);
  const passive = await drive(audited, passiveObserver, sidecar);
  if (baseline.dropped || passive.dropped || stateHash(baseline.final) !== stateHash(passive.final) ||
      baseline.artifactDigest !== passive.artifactDigest ||
      JSON.stringify(baseline.events) !== JSON.stringify(passive.events))
    throw new Error("passive observer benchmark differs in physics, artifact or mutation ledger");
  receipt.status = "passed-development-observer-benchmark";
  receipt.bareObserverElapsedMs = baseline.elapsedMs;
  receipt.passiveObserverResetElapsedMs = passive.elapsedMs;
  receipt.overheadRatio = passive.elapsedMs / baseline.elapsedMs;
  receipt.finalPhysicsHash = stateHash(passive.final);
  receipt.finalArtifactDigest = passive.artifactDigest;
  receipt.mutationEvents = passive.events.length;
  receipt.unavailableEarlierMutationEffects = passive.unavailableEffects;
  receipt.droppedMutationEvents = passive.dropped;
  receipt.checkpointAfter = await identity(checkpoint);
  receipt.codeAfter = await Promise.all(codePaths.map(identity));
  if (JSON.stringify(receipt.checkpointAfter) !== JSON.stringify(receipt.checkpoint) ||
      JSON.stringify(receipt.codeAfter) !== JSON.stringify(receipt.codeBefore))
    throw new Error("benchmark source drifted");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  receipt.overrun = Number(receipt.totalElapsedMs) > 60000;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(output);
} catch (error) {
  receipt.status = "failed-development-observer-benchmark";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  throw error;
} finally { sidecar?.destroy(); audited?.destroy(); plain?.destroy(); }
