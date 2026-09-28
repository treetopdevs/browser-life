/** Opt-in original 100k physics + common-observer control, no selected-link inspection. */
import { createHash } from "node:crypto";
import { artifactDigest, stateHash } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { joinResetMutationEvents } from "../lib/reset-gpu-event-join.ts";
import { ResetProbeAObserver } from "../lib/reset-probe-a-observer.ts";

const root = "/Users/nicholas/develop/browser-life-foundations";
const sourceDir = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1";
const manifestPath = `${sourceDir}/manifest.json`;
const checkpointPath = `${sourceDir}/checkpoints/t000100000.blck`;
const preflightPath = `${root}/runs/foundational-reset/input-preflight-v3.json`;
const inputPath = `${root}/runs/foundational-reset/inputs-v2.json`;
const codePaths = ["packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "packages/runner/src/observe.ts", "packages/runner/src/runner.ts",
  "tools/lib/reset-gpu-copy-audit.ts", "tools/lib/reset-gpu-event-join.ts",
  "tools/lib/reset-probe-a-observer.ts", "tools/test/reset-gpu-original-100k.deno.ts"];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identity = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
};
const startedAt = new Date().toISOString(), start = performance.now();
await Deno.mkdir(`${root}/runs/foundational-reset`, { recursive: true });
const output = `${root}/runs/foundational-reset/gpu-original-100k-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const receipt: Record<string, unknown> = { status: "started-development-original-control",
  startedAt, maxSeconds: 180, steps: 100000, censusEvery: 100,
  scope: "original seed-1 physics and common observer only; no selected links or natural candidate results",
  inputs: await identity(inputPath), preflight: await identity(preflightPath),
  manifest: await identity(manifestPath), checkpoint: await identity(checkpointPath),
  codeBefore: await Promise.all(codePaths.map(identity)) };
const save = () => Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
await save();
let sim: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
try {
  const pinned = JSON.parse(await Deno.readTextFile(inputPath));
  const identityByPath = new Map<string, { bytes: number; sha256: string }>(
    pinned.files.map((x: { path: string; bytes: number; sha256: string }) => [x.path, x]));
  for (const actual of [receipt.manifest, receipt.checkpoint] as
    { path: string; bytes: number; sha256: string }[]) {
    const expected = identityByPath.get(actual.path);
    if (!expected || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256)
      throw new Error(`original source differs from pinned input: ${actual.path}`);
  }
  const preflight = JSON.parse(await Deno.readTextFile(preflightPath));
  const row = preflight.checkpoints.find((x: { h: number; step: number }) =>
    x.h === 1 && x.step === 100000);
  if (preflight.status !== "complete" || !row || row.manifestHashKind !== "physics")
    throw new Error("independent source preflight lacks original physics/artifact basis");
  const source = JSON.parse(await Deno.readTextFile(manifestPath));
  const bytes = await Deno.readFile(checkpointPath), decoded = decodeArtifact(bytes);
  if (source.checkpoints.find((x: { step: number }) => x.step === 100000)?.hash !==
      row.physicsHash || stateHash(decoded.state) !== row.physicsHash ||
      artifactDigest(decoded.state, decoded.observer) !== row.artifactHash)
    throw new Error("original checkpoint disagrees with authenticated preflight");
  const fresh = ResetProbeAObserver.fromFresh(source.spec, source.initHash);
  const observer = fresh.adapter, initial = fresh.state;
  receipt.initialPhysicsHash = stateHash(initial);
  receipt.expectedTerminalPhysicsHash = row.physicsHash;
  receipt.expectedTerminalArtifactDigest = row.artifactHash;
  const device = await requestDevice(navigator.gpu, initial.cfg);
  receipt.adapter = { description: device.adapterInfo.description,
    vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture };
  sim = await GpuSim.create(device, initial);
  audit = await ResetGpuCopyAudit.create(sim, initial);
  let eventCount = 0, earlierEffectsUnavailable = 0;
  for (let k = 0; k < 1000; k++) {
    if ((performance.now() - start) / 1000 > 180)
      throw new Error("development original-control time cap reached");
    audit.run(100);
    const ledger = await sim.drainLedger();
    if (ledger.dropped) throw new Error("original-control mutation ledger dropped events");
    const physical = await sim.readSnapshot();
    observer.observeNext(physical, ledger.events.length);
    const tagged = await audit.readSnapshot();
    const joined = joinResetMutationEvents(initial.cfg, physical.step - 100,
      tagged, ledger.events);
    if (joined.length !== ledger.events.length)
      throw new Error("original-control mutation event join incomplete");
    eventCount += ledger.events.length;
    earlierEffectsUnavailable += joined.filter(x => x.effect === "unavailable-earlier-step").length;
    audit.rebaseFromCurrentGpu(physical.step);
    if ((k + 1) % 100 === 0) {
      receipt.completedSteps = physical.step;
      receipt.elapsedSeconds = (performance.now() - start) / 1000;
      await save();
      console.log(`original-control step ${physical.step}`);
    }
  }
  const terminal = await sim.readState();
  observer.verifyCheckpoint(terminal, bytes, {
    bytesSha256: (receipt.checkpoint as { sha256: string }).sha256,
    physicsHash: row.physicsHash, artifactDigest: row.artifactHash });
  receipt.status = "passed-development-original-control";
  receipt.terminalPhysicsHash = stateHash(terminal);
  receipt.terminalArtifactDigest = artifactDigest(terminal, observer.observerState());
  receipt.mutationEvents = eventCount;
  receipt.unavailableEarlierMutationEffects = earlierEffectsUnavailable;
  receipt.sourceAfter = await Promise.all([identity(inputPath), identity(preflightPath),
    identity(manifestPath), identity(checkpointPath)]);
  receipt.codeAfter = await Promise.all(codePaths.map(identity));
  if (JSON.stringify(receipt.sourceAfter) !== JSON.stringify([
      receipt.inputs, receipt.preflight, receipt.manifest, receipt.checkpoint]) ||
      JSON.stringify(receipt.codeAfter) !== JSON.stringify(receipt.codeBefore))
    throw new Error("development original-control source changed");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  receipt.overrun = Number(receipt.totalElapsedMs) > 180000;
  if (receipt.overrun) throw new Error("development original-control exceeded time cap");
  await save(); console.log(output);
} catch (error) {
  receipt.status = "failed-or-incomplete-development-original-control";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  await save(); throw error;
} finally { audit?.destroy(); sim?.destroy(); }
