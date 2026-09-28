// Observer sensitivity over one authenticated natural-history continuation.
// Plan only:
//   deno run -A tools/foundation-sensitivity.ts --source runs/.../seed-1 \
//     --cache runs/foundations/replay-seed-1 --out runs/foundations/sensitivity-plan.json
// Bounded execution, after a full artifact-mode replay cache is verified:
//   deno run -A tools/foundation-sensitivity.ts --execute --source runs/.../seed-1 \
//     --cache runs/foundations/replay-seed-1 --checkpoint-step 100000 \
//     --steps 2000 --max-seconds 600 --out runs/foundations/sensitivity-result.json
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { artifactDigest, cellCount, ledgerResidual, stateHash, totalsOf, type WorldState } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { OBSERVATION_FILES, sha256, sourceIdentity, verifyReplayCache,
  type FileDigest, type ReplayCacheManifest, type SourceManifest } from "./lib/foundation-replay.ts";
import { FINE_STEP, SensitivityObserver, runReferenceReplay, settingsGrid,
  type ReferenceResult } from "./lib/foundation-sensitivity.ts";

interface Options { execute: boolean; source: string; cache: string; checkpointStep: number; steps: number; maxSeconds: number | null; out: string }
function options(args: string[]): Options {
  const values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!name.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--") || values.has(name))
      throw new Error(`invalid or duplicate option ${name}`);
    values.set(name, args[++i]);
  }
  for (const name of values.keys()) if (!["--source", "--cache", "--checkpoint-step", "--steps", "--max-seconds", "--out"].includes(name))
    throw new Error(`unknown option ${name}`);
  const source = values.get("--source"), cache = values.get("--cache"), out = values.get("--out");
  if (!source || !cache || !out) throw new Error("--source, --cache and --out are required");
  const integer = (name: string, fallback: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a safe nonnegative integer`);
    return Number(raw);
  };
  const checkpointStep = integer("--checkpoint-step", 100_000), steps = integer("--steps", 2_000);
  if (checkpointStep <= 0 || checkpointStep % 200 !== 0 || steps <= 0 || steps > 2_000 || steps % 200 !== 0)
    throw new Error("checkpoint step must be positive and 200-aligned; continuation steps must be 200..2000 and 200-aligned");
  const rawMax = values.get("--max-seconds");
  if (execute && rawMax === undefined) throw new Error("--execute requires --max-seconds");
  if (!execute && rawMax !== undefined) throw new Error("--max-seconds applies only to --execute");
  const maxSeconds = rawMax === undefined ? null : Number(rawMax);
  if (maxSeconds !== null && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("--max-seconds must be finite in (0,600]");
  return { execute, source, cache, checkpointStep, steps, maxSeconds, out };
}

async function digestFile(path: string): Promise<FileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const part of file.readable) { hash.update(part); bytes += part.byteLength; }
  return { sha256: hash.digest("hex"), bytes };
}
async function replayCodeFiles(): Promise<Record<string, FileDigest>> {
  const names = ["tools/foundation-replay.ts", "tools/lib/foundation-replay.ts"];
  for (const dir of ["packages/schema/src", "packages/sim-gpu/src", "packages/metrics/src", "packages/runner/src"])
    for await (const entry of Deno.readDir(dir)) if (entry.isFile && entry.name.endsWith(".ts")) names.push(`${dir}/${entry.name}`);
  return Object.fromEntries(await Promise.all(names.sort().map(async (name) => [name, await digestFile(name)] as const)));
}
async function sensitivityCodeFiles(): Promise<Record<string, FileDigest>> {
  const names = ["tools/foundation-sensitivity.ts", "tools/lib/foundation-sensitivity.ts"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await digestFile(name)] as const)));
}
async function currentSourceIdentity(sourceDir: string, revision: string, mode: "artifact" | "physics") {
  const manifestBytes = await Deno.readFile(join(sourceDir, "manifest.json"));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SourceManifest;
  const files: Record<string, FileDigest> = { "manifest.json": sha256(manifestBytes) };
  for (const name of OBSERVATION_FILES) files[name] = await digestFile(join(sourceDir, name));
  return sourceIdentity(manifest, files, mode, revision, await replayCodeFiles());
}
function snapshotSha256(cells: Uint32Array, head: Uint32Array): string {
  const hash = createHash("sha256");
  hash.update(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength));
  hash.update(new Uint8Array(head.buffer, head.byteOffset, head.byteLength));
  return hash.digest("hex");
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

async function main() {
  const a = options(Deno.args);
  const grid = settingsGrid();
  const report = {
    format: "foundation-observer-sensitivity/v1", status: "planned" as string,
    purpose: "exploratory observer sensitivity on one physical natural-history continuation",
    design: { source: a.source, cache: a.cache, checkpointStep: a.checkpointStep, continuationSteps: a.steps,
      fineReadbackEvery: FINE_STEP, grid, initialCohort: "new local tracker IDs at authenticated checkpoint; baseline does not count as births",
      physicalHistories: 1, gpuExecutionsOfSameHistory: 2, independentHistories: 0,
      limits: ["Threshold/cadence rows share one physical history and are not independent replicates.",
        "A second execution from the same checkpoint checks whether fine readbacks changed the terminal physics hash; it is not another biological replicate.",
        "Fission, fusion, birth and death are overlap-observer events, not biological reproduction or survival proof.",
        "No source endpoint equality is claimed for a continuation beyond the cached checkpoint."] },
    auth: { status: "not-checked" as string, reason: null as string | null, source: null as ReplayCacheManifest["source"] | null,
      cacheFinal: null as ReplayCacheManifest["final"] | null, checkpoint: null as ReplayCacheManifest["checkpoints"][number] | null,
      observerCompatible: null as boolean | null },
    runtime: { deno: Deno.version, build: Deno.build,
      gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
        device: null as string | null, description: null as string | null } },
    selectedSourceFilesSha256: await sensitivityCodeFiles(),
    execution: { maxSeconds: a.maxSeconds, elapsedSeconds: 0, overrunSeconds: 0,
      measuredElapsedSeconds: null as number | null, referenceElapsedSeconds: null as number | null,
      completedFineReadbacks: 0,
      mutationEventsDrained: 0, mutationEventsDropped: 0, lastStep: null as number | null,
      fineSnapshotDigests: [] as { step: number; sha256CellsAndGenomeHead: string }[],
      observerRows: null as ReturnType<SensitivityObserver["results"]> | null,
      terminalPhysics: null as null | { step: number; stateHash: string; matterConserved: boolean; energyResidual: string },
      referenceReplay: { status: "not-run" as "not-run" | "running" | "incomplete" | "matched" | "mismatch" | "failed",
        result: null as ReferenceResult | null, eventCountMatchedMeasured: null as boolean | null },
      error: null as string | null },
  };
  await Deno.mkdir(dirname(a.out), { recursive: true });
  await Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n", { createNew: true });
  const persist = () => Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n");
  if (!a.execute) { console.log(`planned ${grid.length} observer settings at ${a.out}; no GPU requested`); return; }
  const began = performance.now();
  const elapsed = () => (performance.now() - began) / 1000;
  class BudgetStop extends Error { constructor(stage: string) { super(`time cap reached at ${stage}`); } }
  const budget = (stage: string) => { if (elapsed() >= a.maxSeconds!) throw new BudgetStop(stage); };
  let device: GPUDevice | null = null;
  let sim: GpuSim | null = null;
  let observer: SensitivityObserver | null = null;
  let measuredStarted: number | null = null, referenceStarted: number | null = null;
  try {
    report.status = "verifying-source";
    await persist();
    budget("before cache verification");
    let cache: ReplayCacheManifest;
    try {
      const store = { read: (name: string) => Deno.readFile(join(a.cache, name)) };
      cache = await verifyReplayCache(store);
      const source = await currentSourceIdentity(a.source, cache.source.codeRevision, cache.source.finalHashMode);
      if (!same(source, cache.source)) throw new Error("original source, replay code or cache source identity changed");
      report.auth.source = source;
      report.auth.cacheFinal = cache.final ?? null;
      report.auth.observerCompatible = cache.observerCompatible;
      if (source.finalHashMode !== "artifact" || cache.observerCompatible !== true)
        throw new Error("full artifact-mode source and all observation-file matches are required");
      const point = cache.checkpoints.find((x) => x.step === a.checkpointStep);
      if (!point) throw new Error(`verified cache has no checkpoint at ${a.checkpointStep}`);
      report.auth.checkpoint = point;
      report.auth.status = "full-artifact-verified";
    } catch (error) {
      report.auth.status = "unavailable";
      report.auth.reason = error instanceof Error ? error.message : String(error);
      report.status = "unavailable";
      report.execution.elapsedSeconds = elapsed();
      report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
      await persist();
      console.log(`unavailable: ${report.auth.reason}; no GPU requested`);
      Deno.exitCode = 2;
      return;
    }
    budget("after source verification");
    const point = report.auth.checkpoint!;
    const checkpointBytes = await Deno.readFile(join(a.cache, point.file));
    if (!same(sha256(checkpointBytes), point.fileDigest)) throw new Error("checkpoint bytes changed after cache verification");
    const decoded = decodeArtifact(checkpointBytes);
    const start: WorldState = decoded.state;
    if (start.step !== point.step || stateHash(start) !== point.physicsHash || artifactDigest(start, decoded.observer) !== point.artifactHash)
      throw new Error("checkpoint identity changed after cache verification");
    budget("before GPU acquisition");
    report.status = "running";
    await persist();
    device = await requestDevice(navigator.gpu, start.cfg);
    const info = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
    report.runtime.gpu = { status: info ? "available" : "unavailable", vendor: info?.vendor || null,
      architecture: info?.architecture || null, device: info?.device || null, description: info?.description || null };
    await persist();
    budget("before GPU simulator creation");
    measuredStarted = performance.now();
    sim = await GpuSim.create(device, start);
    observer = new SensitivityObserver(start.cfg, grid);
    const n = cellCount(start.cfg);
    const head = start.genome.subarray(0, n * 4);
    observer.accept({ step: start.step, cells: start.cells, genomeHead: head });
    report.execution.fineSnapshotDigests.push({ step: start.step, sha256CellsAndGenomeHead: snapshotSha256(start.cells, head) });
    report.execution.lastStep = start.step;
    for (let advanced = FINE_STEP; advanced <= a.steps; advanced += FINE_STEP) {
      budget(`before physical steps ending ${start.step + advanced}`);
      sim.run(FINE_STEP);
      await device.queue.onSubmittedWorkDone();
      const ledger = await sim.drainLedger(); // observation buffer only; avoids saturation without changing physics
      report.execution.mutationEventsDrained += ledger.events.length;
      report.execution.mutationEventsDropped += ledger.dropped;
      if (ledger.dropped) throw new Error(`mutation event buffer dropped ${ledger.dropped} events at ${start.step + advanced}`);
      const snap = await sim.readSnapshot();
      if (snap.step !== start.step + advanced) throw new Error("fine snapshot has wrong absolute step");
      observer.accept(snap);
      report.execution.fineSnapshotDigests.push({ step: snap.step,
        sha256CellsAndGenomeHead: snapshotSha256(snap.cells, snap.genomeHead) });
      report.execution.completedFineReadbacks++;
      report.execution.lastStep = snap.step;
      if (advanced % 200 === 0) { report.execution.observerRows = observer.results(); await persist(); }
      budget(`after readback at ${snap.step}`);
    }
    const final = await sim.readState();
    if (final.step !== start.step + a.steps) throw new Error("terminal state step differs from planned continuation");
    const startTotals = totalsOf(start.cfg, start.cells), finalTotals = totalsOf(final.cfg, final.cells);
    const initialLedgerEnergy = startTotals.energy + start.heatOut - start.lightIn;
    const residual = ledgerResidual({ energy: initialLedgerEnergy }, final);
    report.execution.terminalPhysics = { step: final.step, stateHash: stateHash(final),
      matterConserved: finalTotals.matter === startTotals.matter, energyResidual: String(residual) };
    report.execution.measuredElapsedSeconds = (performance.now() - measuredStarted) / 1000;
    if (finalTotals.matter !== startTotals.matter || residual !== 0n) throw new Error("continuation conservation failed");
    report.execution.observerRows = observer.results();
    await persist();
    budget("before reference replay");
    sim.destroy();
    sim = null;
    report.execution.referenceReplay.status = "running";
    await persist();
    referenceStarted = performance.now();
    sim = await GpuSim.create(device, start);
    budget("after reference simulator creation");
    const reference = await runReferenceReplay({
      run: (count) => sim!.run(count),
      settle: () => device!.queue.onSubmittedWorkDone(),
      drainLedger: () => sim!.drainLedger(),
      readState: () => sim!.readState(),
    }, start.step, a.steps, report.execution.terminalPhysics.stateHash, budget);
    report.execution.referenceElapsedSeconds = (performance.now() - referenceStarted) / 1000;
    report.execution.referenceReplay.result = reference;
    report.execution.referenceReplay.eventCountMatchedMeasured = reference.drainedMutationEvents === report.execution.mutationEventsDrained;
    report.execution.referenceReplay.status = reference.matchedMeasured ? "matched" : "mismatch";
    await persist();
    if (!reference.matchedMeasured) throw new Error("fine-observed and reference terminal physics state hashes differ");
    budget("after reference hash comparison");
    budget("before source revalidation");
    const [currentSource, currentCode] = await Promise.all([
      currentSourceIdentity(a.source, report.auth.source!.codeRevision, "artifact"), sensitivityCodeFiles()]);
    if (!same(currentSource, report.auth.source) || !same(currentCode, report.selectedSourceFilesSha256))
      throw new Error("source, replay code or sensitivity observer code changed during continuation");
    budget("after source revalidation");
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
    report.status = report.execution.overrunSeconds > 0 ? "over-budget-incomplete" : "completed";
    await persist();
  } catch (error) {
    if (measuredStarted !== null && report.execution.measuredElapsedSeconds === null)
      report.execution.measuredElapsedSeconds = (performance.now() - measuredStarted) / 1000;
    if (referenceStarted !== null && report.execution.referenceElapsedSeconds === null)
      report.execution.referenceElapsedSeconds = (performance.now() - referenceStarted) / 1000;
    if (report.execution.referenceReplay.status === "running")
      report.execution.referenceReplay.status = error instanceof BudgetStop ? "incomplete" : "failed";
    report.status = error instanceof BudgetStop ? "over-budget-incomplete" : "failed";
    report.execution.error = error instanceof Error ? error.message : String(error);
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
    if (observer) report.execution.observerRows = observer.results();
    await persist();
    if (!(error instanceof BudgetStop)) throw error;
  } finally { sim?.destroy(); device?.destroy(); }
  console.log(`${report.status}: ${report.execution.completedFineReadbacks}/${a.steps / FINE_STEP} continuation readbacks`);
  if (report.status !== "completed") Deno.exitCode = 2;
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
