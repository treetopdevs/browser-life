/** Opt-in throughput control on one historical checkpoint; no event classifications. */
import { createHash } from "node:crypto";
import { CH, cellCount, decodeCheckpoint, stateHash } from "@bl/schema";
import { Tracker, census } from "@bl/metrics";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";

const checkpoint = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/checkpoints/t000100000.blck";
const sourceManifest = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1/manifest.json";
const steps = 1000, censusEvery = 100;
const identity = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
};
const codeFiles = ["packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
  "tools/lib/reset-gpu-copy-audit.ts", "tools/test/reset-gpu-cadence-benchmark.deno.ts",
  "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts"];
const start = performance.now(), startedAt = new Date().toISOString();
await Deno.mkdir("runs/foundational-reset", { recursive: true });
const output = `runs/foundational-reset/gpu-passive-cadence-benchmark-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true });
fd.close();
const receipt: Record<string, unknown> = { status: "started", startedAt,
  scope: "one seed-1 100k checkpoint for throughput/support-size only; no Test 1 event labels",
  maxSeconds: 60, steps, censusEvery, source: await identity(checkpoint),
  sourceManifest: await identity(sourceManifest), codeFilesBefore: await Promise.all(codeFiles.map(identity)) };
await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
let passive: GpuSim | undefined, bare: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
try {
  const original = JSON.parse(await Deno.readTextFile(sourceManifest));
  const { state } = decodeCheckpoint(await Deno.readFile(checkpoint));
  const expected = original.checkpoints.find((c: { step: number }) => c.step === state.step);
  if (!expected || stateHash(state) !== expected.hash)
    throw new Error("historical checkpoint physics does not match original manifest");
  const n = cellCount(state.cfg), c = census({ cfg: state.cfg, step: state.step,
    cells: state.cells, genomeHead: state.genome });
  const componentSizes = c.components.filter(x => x.mass >= 256).map(x => x.cells)
    .sort((a, b) => a - b);
  const boundSites = Array.from({ length: n }, (_, i) =>
    state.cells[CH.B * n + i] + state.cells[CH.P * n + i] > 0).filter(Boolean).length;
  const device = await requestDevice(navigator.gpu, state.cfg);
  receipt.adapter = { description: device.adapterInfo.description,
    vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture,
    device: device.adapterInfo.device };
  receipt.initialPhysicsHash = stateHash(state);
  receipt.support = { sites: n, boundSites, eligibleComponents: componentSizes.length,
    minCells: componentSizes[0] ?? null,
    medianCells: componentSizes[Math.floor(componentSizes.length / 2)] ?? null,
    maxCells: componentSizes.at(-1) ?? null };
  passive = await GpuSim.create(device, state);
  audit = await ResetGpuCopyAudit.create(passive, state);
  bare = await GpuSim.create(device, state);
  const track = async (sim: GpuSim, sidecar?: ResetGpuCopyAudit) => {
    const tracker = new Tracker(); tracker.update(c);
    const events: unknown[] = [];
    let dropped = 0, lastTags: Uint32Array | null = null;
    const start = performance.now();
    for (let k = 0; k < steps; k += censusEvery) {
      if (sidecar) sidecar.run(censusEvery);
      else sim.run(censusEvery);
      const snapshot = await sim.readSnapshot();
      tracker.update(census({ cfg: state.cfg, step: snapshot.step,
        cells: snapshot.cells, genomeHead: snapshot.genomeHead }));
      const ledger = await sim.drainLedger();
      dropped += ledger.dropped;
      events.push(...ledger.events);
      if (sidecar) lastTags = (await sidecar.readSnapshot()).tags;
    }
    const elapsedMs = performance.now() - start;
    return { elapsedMs, state: await sim.readState(), events, dropped,
      trackerEvents: tracker.history, taggedSites: lastTags?.reduce((v, x) => v + Number(x !== 0), 0) ?? null };
  };
  const baseline = await track(bare);
  const instrumented = await track(passive, audit);
  const bareElapsedMs = baseline.elapsedMs, passiveElapsedMs = instrumented.elapsedMs;
  const bareState = baseline.state, passiveState = instrumented.state;
  if (stateHash(passiveState) !== stateHash(bareState) ||
      JSON.stringify(instrumented.events) !== JSON.stringify(baseline.events) ||
      JSON.stringify(instrumented.trackerEvents) !== JSON.stringify(baseline.trackerEvents) ||
      instrumented.dropped !== baseline.dropped)
    throw new Error("passive cadence run changed full state, mutation ledger or tracker events");
  receipt.status = "passed-development-throughput";
  receipt.terminalPhysicsHash = stateHash(passiveState);
  receipt.bareElapsedMs = bareElapsedMs;
  receipt.passiveElapsedMs = passiveElapsedMs;
  receipt.overheadRatio = passiveElapsedMs / bareElapsedMs;
  receipt.passiveTaggedSites = instrumented.taggedSites;
  receipt.mutationEvents = instrumented.events.length;
  receipt.droppedMutationEvents = instrumented.dropped;
  receipt.trackerEvents = instrumented.trackerEvents.length;
  receipt.sourceAfter = await identity(checkpoint);
  receipt.codeFilesAfter = await Promise.all(codeFiles.map(identity));
  if (JSON.stringify(receipt.sourceAfter) !== JSON.stringify(receipt.source) ||
      JSON.stringify(receipt.codeFilesAfter) !== JSON.stringify(receipt.codeFilesBefore))
    throw new Error("benchmark source content drifted during execution");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  receipt.overrun = Number(receipt.totalElapsedMs) > 60000;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(output);
} catch (error) {
  receipt.status = "failed-development-throughput";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - start;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  throw error;
} finally { audit?.destroy(); passive?.destroy(); bare?.destroy(); }
