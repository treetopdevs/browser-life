// Bounded, in-situ lifecycle traceability calibration on authenticated source 1.
// Default is plan only. --execute requires --max-seconds <= 120. No fresh RNG seed or intervention.
// deno run -A tools/foundation-lifecycle.ts --source /path/to/m4/gradient-m3/treatment/seed-1 \
//   --cache runs/foundations/replay-gradient-seed-1 --out runs/foundations/lifecycle-plan-v1.json
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { artifactDigest, cellCount, ledgerResidual, stateHash, totalsOf, type WorldState } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { restoreObservers, observeCensus } from "../packages/runner/src/observe.ts";
import { unb64 } from "../packages/metrics/src/tracker.ts";
import { OBSERVATION_FILES, sha256, sourceIdentity, verifyReplayCache,
  type FileDigest, type ReplayCacheManifest, type SourceManifest } from "./lib/foundation-replay.ts";
import { runReferenceReplay } from "./lib/foundation-sensitivity.ts";
import { analyzeLifecycle, censusSnapshot, frameAtCensus, labelDigest, memberRanges, overlappingPriorIdentities,
  LIFECYCLE_CADENCE, type ObservedWindow } from "./lib/foundation-lifecycle.ts";
import { parseSavedLifeEvent, type SavedLifeEvent } from "./lib/foundation-life.ts";

const START = 500_000, STEPS = 2_000, MAX_SECONDS = 120;
interface Options { source: string; cache: string; out: string; execute: boolean; maxSeconds: number | null }
function parse(args: string[]): Options {
  let execute = false;
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!["--source", "--cache", "--out", "--max-seconds"].includes(name) || values.has(name) ||
        !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`invalid or duplicate option ${name}`);
    values.set(name, args[++i]);
  }
  const source = values.get("--source"), cache = values.get("--cache"), out = values.get("--out");
  if (!source || !cache || !out || execute !== values.has("--max-seconds"))
    throw new Error("--source, --cache and --out are required; --execute also requires --max-seconds");
  const maxSeconds = execute ? Number(values.get("--max-seconds")) : null;
  if (maxSeconds !== null && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > MAX_SECONDS))
    throw new Error("--max-seconds must be in (0,120]");
  return { source, cache, out, execute, maxSeconds };
}
const digestFile = async (path: string): Promise<FileDigest> => {
  const h = createHash("sha256"); let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const part of file.readable) { h.update(part); bytes += part.byteLength; }
  return { sha256: h.digest("hex"), bytes };
};
async function sourceCodeFiles(): Promise<Record<string, FileDigest>> {
  const names = ["tools/foundation-replay.ts", "tools/lib/foundation-replay.ts"];
  for (const dir of ["packages/schema/src", "packages/sim-gpu/src", "packages/metrics/src", "packages/runner/src"])
    for await (const entry of Deno.readDir(dir)) if (entry.isFile && entry.name.endsWith(".ts")) names.push(`${dir}/${entry.name}`);
  return Object.fromEntries(await Promise.all(names.sort().map(async (name) => [name, await digestFile(name)] as const)));
}
async function lifecycleCodeFiles(): Promise<Record<string, FileDigest>> {
  const names = ["tools/foundation-lifecycle.ts", "tools/lib/foundation-lifecycle.ts",
    "tools/lib/foundation-sensitivity.ts", "tools/lib/foundation-life.ts"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await digestFile(name)] as const)));
}
async function currentSourceIdentity(sourceDir: string, revision: string) {
  const bytes = await Deno.readFile(join(sourceDir, "manifest.json"));
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as SourceManifest;
  const files: Record<string, FileDigest> = { "manifest.json": sha256(bytes) };
  for (const name of OBSERVATION_FILES) files[name] = await digestFile(join(sourceDir, name));
  return sourceIdentity(manifest, files, "artifact", revision, await sourceCodeFiles());
}
async function lifeWindow(path: string): Promise<Map<number, SavedLifeEvent[]>> {
  const events = new Map<number, SavedLifeEvent[]>();
  const file = await Deno.open(path, { read: true });
  const decoder = new TextDecoder(); let pending = "";
  for await (const chunk of file.readable) {
    pending += decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, at); pending = pending.slice(at + 1);
      if (!line) continue;
      const raw = JSON.parse(line) as { step: number };
      if (raw.step > START && raw.step <= START + STEPS) {
        const event = parseSavedLifeEvent(raw);
        events.set(event.step, [...(events.get(event.step) ?? []), event]);
      }
    }
  }
  pending += decoder.decode();
  if (pending.trim()) {
    const raw = JSON.parse(pending) as { step: number };
    if (raw.step > START && raw.step <= START + STEPS) {
      const event = parseSavedLifeEvent(raw);
      events.set(event.step, [...(events.get(event.step) ?? []), event]);
    }
  }
  return events;
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
async function main() {
  const a = parse(Deno.args);
  const report = { format: "foundation-lifecycle-trace/v1", status: "planned", createdAt: new Date().toISOString(),
    scope: "post-observation source-1 500k calibration; one physical history, not representative heredity estimation",
    design: { source: resolve(a.source), cache: resolve(a.cache), startStep: START, endStep: START + STEPS,
      cadence: LIFECYCLE_CADENCE, ages: [100, 200], sourceSelection: "500k chosen after inspecting saved event density",
      execute: a.execute, maxSeconds: a.maxSeconds },
    runtime: { deno: Deno.version, build: Deno.build,
      gpu: { status: "not-requested", vendor: null as string | null, architecture: null as string | null,
        device: null as string | null, description: null as string | null } },
    auth: { status: "unverified", source: null as Awaited<ReturnType<typeof currentSourceIdentity>> | null,
      checkpoint: null as ReplayCacheManifest["checkpoints"][number] | null,
      cacheManifestDigest: null as FileDigest | null,
      codeBefore: null as { replay: Record<string, FileDigest>; lifecycle: Record<string, FileDigest> } | null,
      codeAfterMatched: null as boolean | null, sourceAfterMatched: null as boolean | null },
    execution: { elapsedSeconds: 0, overrunSeconds: 0, lastStep: START, mutationEventsDrained: 0,
      mutationEventsDropped: 0, matchedSourceLifeRows: 0, originalSourceLifeRows: 0,
      measuredPhysicsHash: null as string | null, referencePhysicsHash: null as string | null,
      measuredSeconds: null as number | null, referenceSeconds: null as number | null,
      referenceMutationEventsDrained: null as number | null,
      conservation: null as { matterConserved: boolean; energyResidual: string } | null,
      error: null as string | null },
    window: null as ObservedWindow | null,
    analysis: null as ReturnType<typeof analyzeLifecycle> | null };
  await Deno.mkdir(dirname(a.out), { recursive: true });
  await Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n", { createNew: true });
  const persist = () => Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n");
  const begun = performance.now(), elapsed = () => (performance.now() - begun) / 1000;
  class TimeCap extends Error { constructor(stage: string) { super(`time cap before ${stage}`); } }
  const budget = (stage: string) => { if (a.execute && elapsed() >= a.maxSeconds!) throw new TimeCap(stage); };
  let device: GPUDevice | null = null, sim: GpuSim | null = null;
  try {
    const cacheManifestBytes = await Deno.readFile(join(a.cache, "manifest.json"));
    const cacheHeader = JSON.parse(new TextDecoder().decode(cacheManifestBytes)) as ReplayCacheManifest;
    const codeBefore = { replay: await sourceCodeFiles(), lifecycle: await lifecycleCodeFiles() };
    const source = await currentSourceIdentity(a.source, cacheHeader.source.codeRevision);
    if (source.runId !== "m4/gradient-m3/treatment/seed-1" || source.spec.censusEvery !== LIFECYCLE_CADENCE)
      throw new Error("lifecycle calibration requires original gradient-m3 treatment source 1 at cadence 100");
    const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(a.cache, name)) }, source);
    if (!cache.observerCompatible || !OBSERVATION_FILES.every((name) => cache.observationComparison?.[name]?.matched))
      throw new Error("authenticated cache observer output did not match source");
    const point = cache.checkpoints.find((p) => p.step === START);
    if (!point) throw new Error("authenticated source cache lacks 500k checkpoint");
    report.auth = { status: "full-artifact-verified", source, checkpoint: point,
      cacheManifestDigest: sha256(cacheManifestBytes), codeBefore, codeAfterMatched: null, sourceAfterMatched: null };
    await persist();
    if (!a.execute) {
      console.log("planned source-1 500k lifecycle trace; no GPU requested");
      return;
    }
    budget("original life-window read");
    const expected = await lifeWindow(join(a.source, "life.jsonl"));
    report.execution.originalSourceLifeRows = [...expected.values()].reduce((n, rows) => n + rows.length, 0);
    const checkpointBytes = await Deno.readFile(join(a.cache, point.file));
    if (!same(sha256(checkpointBytes), point.fileDigest)) throw new Error("checkpoint bytes changed after verification");
    const decoded = decodeArtifact(checkpointBytes), start: WorldState = decoded.state;
    if (start.step !== START || stateHash(start) !== point.physicsHash ||
        artifactDigest(start, decoded.observer) !== point.artifactHash) throw new Error("checkpoint identity changed");
    budget("GPU acquisition");
    report.status = "running"; await persist();
    device = await requestDevice(navigator.gpu, start.cfg);
    const adapter = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
    report.runtime.gpu = { status: adapter ? "available" : "unavailable",
      vendor: adapter?.vendor || null, architecture: adapter?.architecture || null,
      device: adapter?.device || null, description: adapter?.description || null };
    await persist();
    sim = await GpuSim.create(device, start);
    const measuredStarted = performance.now();
    const obs = restoreObservers(decoded.observer, decoded.observer.settings);
    const baseline = censusSnapshot(start.cfg, START, start.cells,
      start.genome.subarray(0, cellCount(start.cfg) * 4));
    const savedLabels = decoded.observer.tracker.prevLabels;
    if (!savedLabels || !same(Array.from(unb64(savedLabels)),
      Array.from(new Uint8Array(baseline.labels.buffer, baseline.labels.byteOffset, baseline.labels.byteLength))))
      throw new Error("restored observer labels do not match checkpoint baseline census");
    const window: ObservedWindow = { startStep: START, endStep: START + STEPS,
      frames: frameAtCensus(baseline, start.cells, start.cfg, obs.tracker, START), life: [], trackerEvents: [], overlapMixing: [],
      censusDigests: [{ step: START, labelsSha256: labelDigest(baseline.labels),
        eligibleComponents: baseline.components.filter((c) => c.mass >= obs.tracker.opt.minMass).length,
        trackedIndividuals: obs.tracker.alive.size }], membership: [] };
    const labelMaps = new Map<number, Int32Array>([[START, baseline.labels]]);
    let previousCensus = baseline;
    for (let advanced = LIFECYCLE_CADENCE; advanced <= STEPS; advanced += LIFECYCLE_CADENCE) {
      const step = START + advanced;
      budget(`steps ending ${step}`);
      sim.run(LIFECYCLE_CADENCE);
      await device.queue.onSubmittedWorkDone();
      const ledger = await sim.drainLedger();
      report.execution.mutationEventsDrained += ledger.events.length;
      report.execution.mutationEventsDropped += ledger.dropped;
      if (ledger.dropped) throw new Error(`mutation ledger dropped ${ledger.dropped} events at ${step}`);
      const snap = await sim.readSnapshot();
      if (snap.step !== step) throw new Error("snapshot step mismatch");
      const previousIds = new Map(previousCensus.components.flatMap((component) => {
        const id = obs.tracker.idOf(component.idx);
        return id === undefined ? [] : [[component.idx, id] as [number, number]];
      }));
      const observed = observeCensus(obs, start.cfg, snap, ledger.events.length);
      window.overlapMixing.push(...overlappingPriorIdentities(previousCensus.labels, previousIds,
        observed.census, (componentIndex) => obs.tracker.idOf(componentIndex), obs.tracker.opt.minMass));
      if (!same(observed.life, expected.get(step) ?? [])) throw new Error(`original life event order or content differs at ${step}`);
      report.execution.matchedSourceLifeRows += observed.life.length;
      window.life.push(...observed.life.map(parseSavedLifeEvent));
      window.trackerEvents.push(...observed.events);
      window.frames.push(...frameAtCensus(observed.census, snap.cells, start.cfg, obs.tracker, START));
      window.censusDigests.push({ step, labelsSha256: labelDigest(observed.census.labels),
        eligibleComponents: observed.census.components.filter((c) => c.mass >= obs.tracker.opt.minMass).length,
        trackedIndividuals: obs.tracker.alive.size });
      labelMaps.set(step, observed.census.labels);
      previousCensus = observed.census;
      report.execution.lastStep = step;
      if (advanced % 500 === 0) { report.window = window; await persist(); }
      budget(`readback at ${step}`);
    }
    if (report.execution.matchedSourceLifeRows !== report.execution.originalSourceLifeRows)
      throw new Error("source life-window row count mismatch");
    const final = await sim.readState();
    const t0 = totalsOf(start.cfg, start.cells), t1 = totalsOf(final.cfg, final.cells);
    const residual = ledgerResidual({ energy: t0.energy + start.heatOut - start.lightIn }, final);
    report.execution.conservation = { matterConserved: t0.matter === t1.matter, energyResidual: String(residual) };
    report.execution.measuredPhysicsHash = stateHash(final);
    report.execution.measuredSeconds = (performance.now() - measuredStarted) / 1000;
    if (final.step !== START + STEPS || t0.matter !== t1.matter || residual !== 0n)
      throw new Error("measured lifecycle continuation failed conservation or terminal step");
    report.window = window; await persist();
    budget("unsampled reference replay");
    sim.destroy(); sim = await GpuSim.create(device, start);
    const referenceStarted = performance.now();
    const reference = await runReferenceReplay({ run: (count) => sim!.run(count),
      settle: () => device!.queue.onSubmittedWorkDone(), drainLedger: () => sim!.drainLedger(),
      readState: () => sim!.readState() }, START, STEPS, report.execution.measuredPhysicsHash, budget);
    report.execution.referencePhysicsHash = reference.stateHash;
    report.execution.referenceMutationEventsDrained = reference.drainedMutationEvents;
    report.execution.referenceSeconds = (performance.now() - referenceStarted) / 1000;
    if (!reference.matchedMeasured || reference.droppedMutationEvents ||
        reference.drainedMutationEvents !== report.execution.mutationEventsDrained)
      throw new Error("unsampled reference and traced terminal physics or mutation ledger differ");
    budget("lifecycle analysis");
    const analysis = analyzeLifecycle(window, `${point.artifactHash}:${report.auth.cacheManifestDigest!.sha256}`);
    const selectedIds = new Set(analysis.selectedChains.flatMap((c) => [...c.ids,
      ...c.nonlinkedObserverFamilyControls.flatMap((r) => r.controlParentId === null ? [] : [r.controlParentId]),
      ...c.matchedParentReassignmentControls.flatMap((r) => r.parentId === null ? [] : [r.parentId])]));
    for (const frame of window.frames) if (selectedIds.has(frame.id))
      window.membership.push({ step: frame.step, id: frame.id,
        ranges: memberRanges(labelMaps.get(frame.step)!, frame.componentIndex) });
    report.analysis = analysis; await persist();
    budget("source and code revalidation");
    report.auth.codeAfterMatched = same(codeBefore, { replay: await sourceCodeFiles(), lifecycle: await lifecycleCodeFiles() });
    report.auth.sourceAfterMatched = same(source, await currentSourceIdentity(a.source, cacheHeader.source.codeRevision)) &&
      same(report.auth.cacheManifestDigest, sha256(await Deno.readFile(join(a.cache, "manifest.json"))));
    if (!report.auth.codeAfterMatched || !report.auth.sourceAfterMatched)
      throw new Error("source, cache or selected code changed during lifecycle continuation");
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - a.maxSeconds!);
    report.status = report.execution.overrunSeconds > 0 ? "over-budget-incomplete" : "completed";
    await persist();
  } catch (error) {
    if (report.status === "running" && report.runtime.gpu.status === "not-requested")
      report.runtime.gpu.status = "request-failed";
    report.status = error instanceof TimeCap ? "over-budget-incomplete" : report.auth.status === "unverified" ? "unavailable" : "failed";
    report.execution.error = error instanceof Error ? error.message : String(error);
    report.execution.elapsedSeconds = elapsed();
    report.execution.overrunSeconds = Math.max(0, report.execution.elapsedSeconds - (a.maxSeconds ?? Infinity));
    await persist();
    Deno.exitCode = 2;
  } finally { sim?.destroy(); device?.destroy(); }
  console.log(`${report.status}: observed through ${report.execution.lastStep}; ${report.analysis?.denominators.cleanThreeIdentityChains ?? "no"} clean chains`);
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
