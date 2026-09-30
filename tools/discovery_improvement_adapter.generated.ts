// Fixed-founder improvement study. `plan` and `analyze` are CPU-only.
// `run` requires a separately reviewed, measured, local-only release file.
import { RULE_VERSION, stateHash } from "@bl/schema";
import { statfsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { type MutationEdge, sha256 } from "./lib/founder-policy.ts";
import {
  analyzeScores,
  ASSAY_STEPS,
  type AssayResult,
  buildManifest,
  loadCheckpointChain,
  type LoadedCheckpoint,
  loadVerifiedChainCache,
  type Manifest,
  requestsFromSamples,
  type Unit,
  validateAssayResult,
  validateManifest,
  writeCheckpoint,
  writeNew,
  writeVerifiedChainCache,
} from "./lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionMasses,
  discoveryCompetitionWorld,
} from "./lib/discovery-competition.ts";
import { discoveryEvolutionWorld } from "./lib/discovery-evolution.ts";
import {
  analyzePilotEvidence,
  type PilotAnalysis,
  type PilotDesign,
  type PilotEvidence,
  validatePilotDesign,
  verifyFrozenPilot,
} from "./discovery_competition_pilot.ts";

const PROTOCOL =
  "experiments/founder-discovery/v1/improvement-execution-protocol.md";
const DESIGN = "experiments/founder-discovery/v1/improvement-next-design.md";
const SOURCE_FILES = [
  "deno.json",
  "tools/discovery_improvement.ts",
  "tools/lib/discovery-improvement-runtime.ts",
  "tools/lib/discovery-improvement-summary.ts",
  "tools/lib/discovery-evolution.ts",
  "tools/lib/discovery-competition.ts",
  "tools/lib/founder-policy.ts",
  "tools/lib/selection-funnel-audit.ts",
  "tools/discovery_competition_pilot.ts",
  "tools/test/discovery-improvement-runtime.test.ts",
  PROTOCOL,
  DESIGN,
];
const PILOT_DIR = "experiments/founder-discovery/v1/competition-pilot";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}
function hashMap(map: Record<string, string>): string {
  return sha256(
    JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))),
  );
}
async function sourceFiles(root: string): Promise<string[]> {
  const paths = new Set(SOURCE_FILES);
  async function walk(rel: string): Promise<void> {
    for await (const ent of Deno.readDir(join(root, rel))) {
      const path = `${rel}/${ent.name}`;
      if (ent.isDirectory) await walk(path);
      else if (ent.isFile && path.endsWith(".ts")) paths.add(path);
    }
  }
  for (
    const dir of [
      "packages/schema/src",
      "packages/sim-gpu/src",
      "packages/sim-ref/src",
      "packages/runner/src",
      "packages/metrics/src",
    ]
  ) await walk(dir);
  if (await exists(join(root, "deno.lock"))) paths.add("deno.lock");
  return [...paths].sort();
}
async function sourceHashes(root: string): Promise<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const path of await sourceFiles(root)) {
    entries.push([path, sha256(await Deno.readFile(join(root, path)))]);
  }
  return Object.fromEntries(entries);
}
async function pilotEvidence(
  pilotDir: string,
  design: PilotDesign,
): Promise<
  {
    receipts: Record<string, PilotEvidence>;
    replays: Record<string, PilotEvidence>;
    unexpected: string[];
  }
> {
  const receipts: Record<string, PilotEvidence> = {},
    replays: Record<string, PilotEvidence> = {},
    unexpected: string[] = [];
  for (const section of ["receipts", "replays"] as const) {
    const dir = join(pilotDir, section);
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        unexpected.push(`${section}/${entry.name}`);
        continue;
      }
      const bytes = await Deno.readFile(join(dir, entry.name));
      const value = JSON.parse(textDecoder.decode(bytes));
      const id = section === "receipts"
        ? entry.name.slice(0, -5)
        : value.unitId;
      if (
        typeof id !== "string" ||
        (section === "receipts" ? receipts[id] : replays[id])
      ) {
        throw Error(
          `duplicate/malformed pilot evidence ${section}/${entry.name}`,
        );
      }
      (section === "receipts" ? receipts : replays)[id] = {
        value,
        sha256: sha256(bytes),
      };
    }
  }
  if (Object.keys(receipts).length !== design.units.length) {
    throw Error("pilot receipt roster incomplete");
  }
  return { receipts, replays, unexpected };
}
async function eligiblePilot(
  pilotDir: string,
): Promise<
  {
    design: PilotDesign;
    designSha: string;
    analysis: PilotAnalysis;
    analysisSha: string;
    analysisPath: string;
  }
> {
  const designPath = join(pilotDir, "pilot-design.json"),
    analysisPath = join(pilotDir, "final-analysis.json");
  const designBytes = await Deno.readFile(designPath),
    analysisBytes = await Deno.readFile(analysisPath);
  const design = validatePilotDesign(
    JSON.parse(textDecoder.decode(designBytes)),
  );
  await verifyFrozenPilot(design);
  const actual = JSON.parse(textDecoder.decode(analysisBytes)) as
    & PilotAnalysis
    & Record<string, unknown>;
  const evidence = await pilotEvidence(pilotDir, design);
  if (evidence.unexpected.length) {
    throw Error("unexpected pilot evidence entries");
  }
  const reconstructed = analyzePilotEvidence(
    design,
    evidence.receipts,
    evidence.replays,
  );
  for (const [key, value] of Object.entries(reconstructed)) {
    if (!same(actual[key], value)) {
      throw Error(`pilot final analysis drift: ${key}`);
    }
  }
  if (
    actual.status !== "eligible" || reconstructed.status !== "eligible" ||
    actual.requested !== 128 || actual.available !== 128 ||
    actual.replays.length !== 2 || actual.missing.length ||
    actual.invalid.length || actual.replayMissing.length ||
    actual.replayInvalid.length
  ) {
    throw Error(
      "complete eligible pilot required before improvement preparation",
    );
  }
  if (actual.unexpectedFiles && !same(actual.unexpectedFiles, [])) {
    throw Error("unexpected pilot evidence in final analysis");
  }
  const receiptHashes = Object.fromEntries(
    Object.entries(evidence.receipts).map(([id, e]) => [id, e.sha256]),
  );
  if (!same(actual.receiptHashes, receiptHashes)) {
    throw Error("pilot analysis receipt hash inventory drift");
  }
  return {
    design,
    designSha: sha256(designBytes),
    analysis: actual,
    analysisSha: sha256(analysisBytes),
    analysisPath,
  };
}
async function plan(pilotArg: string, manifestArg: string): Promise<void> {
  const sourceRoot = await Deno.realPath(Deno.cwd());
  const pilotDir = await Deno.realPath(resolve(pilotArg));
  const pilot = await eligiblePilot(pilotDir);
  if (pilot.design.sourceRoot !== sourceRoot) {
    throw Error("pilot source root differs from improvement runner root");
  }
  const expectedIds = [
    "discovery-cluster-33",
    "discovery-cluster-4",
    "discovery-cluster-16",
    "discovery-cluster-139",
  ];
  if (!same(pilot.design.founders.map((f) => f.id), expectedIds)) {
    throw Error("pilot founders differ from frozen improvement protocol");
  }
  const inputs: Record<string, string> = {};
  for (
    const path of [join(pilotDir, "pilot-design.json"), pilot.analysisPath]
  ) inputs[path] = sha256(await Deno.readFile(path));
  const sources = await sourceHashes(sourceRoot);
  const manifest = buildManifest({
    format: "discovery-improvement-manifest/v1",
    ruleVersion: RULE_VERSION,
    sourceRoot,
    pilotDesignSha256: pilot.designSha,
    pilotAnalysisSha256: pilot.analysisSha,
    inputs,
    sources,
    sourceManifestHash: hashMap(sources),
    founders: pilot.design.founders.map(({ id, hex, cluster }) => ({
      id,
      hex,
      cluster,
    })),
  });
  validateManifest(manifest);
  await writeNew(
    resolve(manifestArg),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "prepared",
      manifestHash: manifest.manifestHash,
      histories: manifest.units.length,
      requestedAssays: 6144,
      paidUSD: 0,
    }),
  );
}
async function frozen(
  manifestArg: string,
): Promise<{ manifest: Manifest; bytes: Uint8Array }> {
  const bytes = await Deno.readFile(resolve(manifestArg)),
    manifest = validateManifest(JSON.parse(textDecoder.decode(bytes)));
  if (await Deno.realPath(Deno.cwd()) !== manifest.sourceRoot) {
    throw Error("frozen source root differs from current working directory");
  }
  if (manifest.ruleVersion !== RULE_VERSION) throw Error("rule version drift");
  const sources = await sourceHashes(manifest.sourceRoot);
  if (
    !same(sources, manifest.sources) ||
    hashMap(sources) !== manifest.sourceManifestHash
  ) throw Error("frozen source closure drift");
  for (const [path, hash] of Object.entries(manifest.inputs)) {
    if (sha256(await Deno.readFile(path)) !== hash) {
      throw Error(`frozen input drift: ${path}`);
    }
  }
  const pilot = await eligiblePilot(join(manifest.sourceRoot, PILOT_DIR));
  if (
    pilot.designSha !== manifest.pilotDesignSha256 ||
    pilot.analysisSha !== manifest.pilotAnalysisSha256
  ) throw Error("pilot evidence identity drift");
  return { manifest, bytes };
}
export interface Release {
  format: "discovery-improvement-release/v1";
  manifestSha256: string;
  manifestHash: string;
  pilotAnalysisSha256: string;
  outputDir: string;
  localOnly: true;
  paidUSD: 0;
  forecast: {
    histories: 64;
    evolutionSteps: 64000000;
    requestedAssays: 6144;
    maximumDistinctAssays: 2112;
    physicalCheckpoints: 704;
    plannedInvocations: number;
    measuredEvolutionWithLedgerStepSeconds: number;
    measuredCheckpointReadSeconds: number;
    measuredCheckpointSemanticSeconds: number;
    measuredSampleSeconds: number;
    measuredAssaySeconds: number;
    measuredCheckpointWriteSeconds: number;
    estimatedResumeVerificationSecondsPerInvocation: number;
    estimatedStorageBytes: number;
    availableStorageBytes: number;
    estimatedTotalWallSeconds: number;
    cumulativeExecutionCapSeconds: number;
    minimumFreeBytes: number;
  };
}
function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw Error(`invalid release ${label}`);
  }
  return value;
}
export function validateRelease(
  r: Release,
  manifest: Manifest,
  manifestSha: string,
  outDir: string,
  priorSeconds: number,
  tranche: number,
): void {
  if (
    !r || r.format !== "discovery-improvement-release/v1" ||
    r.manifestSha256 !== manifestSha ||
    r.manifestHash !== manifest.manifestHash ||
    r.pilotAnalysisSha256 !== manifest.pilotAnalysisSha256 ||
    r.outputDir !== outDir || r.localOnly !== true || r.paidUSD !== 0
  ) throw Error("reviewed local-only release identity required");
  const f = r.forecast;
  if (
    !f || f.histories !== 64 || f.evolutionSteps !== 64_000_000 ||
    f.requestedAssays !== 6144 || f.maximumDistinctAssays !== 2112 ||
    f.physicalCheckpoints !== 704
  ) throw Error("release forecast must cover full fixed roster");
  for (
    const key of [
      "measuredEvolutionWithLedgerStepSeconds",
      "measuredCheckpointReadSeconds",
      "measuredCheckpointSemanticSeconds",
      "measuredSampleSeconds",
      "measuredAssaySeconds",
      "measuredCheckpointWriteSeconds",
      "estimatedResumeVerificationSecondsPerInvocation",
      "estimatedStorageBytes",
      "availableStorageBytes",
      "estimatedTotalWallSeconds",
      "cumulativeExecutionCapSeconds",
      "minimumFreeBytes",
    ] as const
  ) positive(f[key], key);
  if (
    !Number.isSafeInteger(f.plannedInvocations) ||
    f.plannedInvocations < Math.ceil(f.estimatedTotalWallSeconds / 600)
  ) throw Error("released invocation count does not cover bounded tranches");
  const minimumForecast =
    64_000_000 * f.measuredEvolutionWithLedgerStepSeconds +
    640 * f.measuredCheckpointReadSeconds +
    704 * f.measuredCheckpointSemanticSeconds + 192 * f.measuredSampleSeconds +
    2112 * f.measuredAssaySeconds + 704 * f.measuredCheckpointWriteSeconds +
    f.plannedInvocations * f.estimatedResumeVerificationSecondsPerInvocation;
  if (
    f.estimatedTotalWallSeconds < minimumForecast ||
    f.cumulativeExecutionCapSeconds < f.estimatedTotalWallSeconds ||
    f.availableStorageBytes < f.estimatedStorageBytes + f.minimumFreeBytes
  ) {
    throw Error(
      "release resource envelope does not cover measured whole roster",
    );
  }
  const intervalAllowance = 100_000 * f.measuredEvolutionWithLedgerStepSeconds +
    f.measuredCheckpointReadSeconds + f.measuredCheckpointSemanticSeconds +
    f.measuredCheckpointWriteSeconds + f.measuredSampleSeconds;
  const operationAllowance = Math.max(
    intervalAllowance,
    f.measuredAssaySeconds,
  );
  if (
    priorSeconds + tranche + operationAllowance >
      f.cumulativeExecutionCapSeconds
  ) {
    throw Error(
      "tranche and checkpoint-boundary allowance exceed released execution envelope",
    );
  }
}
export function canStartAssay(
  release: Release,
  priorSeconds: number,
  elapsedSeconds: number,
): boolean {
  return priorSeconds + elapsedSeconds +
      release.forecast.measuredAssaySeconds <=
    release.forecast.cumulativeExecutionCapSeconds;
}
function freeBytes(path: string): number {
  const s = statfsSync(path);
  return Number(s.bavail) * Number(s.bsize);
}
function storageGuard(out: string, release: Release): void {
  if (freeBytes(out) < release.forecast.minimumFreeBytes) {
    throw Error("remaining free storage is below released floor");
  }
}
async function invocationSeconds(
  out: string,
  manifestHash: string,
  releaseSha256: string,
): Promise<number> {
  let total = 0;
  if (!await exists(out)) return total;
  for await (const e of Deno.readDir(out)) {
    if (e.isFile && /^invocation-[0-9]+-[0-9]+\.json$/.test(e.name)) {
      const x = await readJson<
        { manifestHash: string; releaseSha256: string; elapsedSeconds: number }
      >(join(out, e.name));
      if (
        x.manifestHash !== manifestHash || x.releaseSha256 !== releaseSha256 ||
        !Number.isFinite(x.elapsedSeconds) || x.elapsedSeconds < 0
      ) throw Error("prior invocation identity/accounting drift");
      total += x.elapsedSeconds;
    }
  }
  return total;
}
async function lock(out: string): Promise<() => Promise<void>> {
  await Deno.mkdir(out, { recursive: true });
  const path = join(out, "RUNNING"),
    file = await Deno.open(path, { createNew: true, write: true });
  try {
    await file.write(textEncoder.encode(`${Deno.pid}\n`));
  } finally {
    file.close();
  }
  return () => Deno.remove(path);
}
function sortedEdges(
  events: {
    childHi: number;
    childLo: number;
    parentHi: number;
    parentLo: number;
  }[],
): MutationEdge[] {
  return events.sort((a, b) =>
    a.childHi - b.childHi || a.childLo - b.childLo || a.parentHi - b.parentHi ||
    a.parentLo - b.parentLo
  ).map((e) => ({
    child: `${e.childHi}:${e.childLo}`,
    parent: `${e.parentHi}:${e.parentLo}`,
  }));
}
async function advanceHistory(
  device: GPUDevice,
  out: string,
  manifest: Manifest,
  unit: Unit,
  prior: LoadedCheckpoint | null,
): Promise<LoadedCheckpoint> {
  const { GpuSim } = await import("@bl/sim-gpu");
  const starting = prior?.state ??
    discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
  const sim = await GpuSim.create(device, starting);
  let latest = prior;
  try {
    if (!latest) {
      latest = await writeCheckpoint(
        join(out, "histories", unit.id),
        manifest,
        unit,
        starting,
        [],
        [],
        null,
      );
    }
    if (latest.state.step === 1_000_000) return latest;
    const end = latest.state.step + 100_000;
    const intervalEvents: {
      childHi: number;
      childLo: number;
      parentHi: number;
      parentLo: number;
    }[] = [];
    for (let step = latest.state.step + 100; step <= end; step += 100) {
      sim.run(100);
      await device.queue.onSubmittedWorkDone();
      const ledger = await sim.drainLedger();
      if (ledger.step !== step || ledger.dropped !== 0) {
        throw Error(`mutation ledger lost/drifted at ${unit.id}/${step}`);
      }
      if (unit.mode === "off" && ledger.events.length) {
        throw Error(`mutation-off ledger has events ${unit.id}/${step}`);
      }
      intervalEvents.push(...ledger.events);
    }
    const state = await sim.readState();
    if (state.step !== end) {
      throw Error(`physical step drift ${unit.id}/${end}`);
    }
    const delta = sortedEdges(intervalEvents);
    return await writeCheckpoint(
      join(out, "histories", unit.id),
      manifest,
      unit,
      state,
      delta,
      [...latest.edges, ...delta],
      latest,
    );
  } finally {
    sim.destroy();
  }
}
async function loadAll(
  out: string,
  manifest: Manifest,
  useCache = false,
): Promise<Record<string, LoadedCheckpoint | null>> {
  const latest: Record<string, LoadedCheckpoint | null> = {};
  for (const unit of manifest.units) {
    const dir = join(out, "histories", unit.id);
    latest[unit.id] = useCache
      ? await loadVerifiedChainCache(dir, manifest, unit)
      : null;
    if (!latest[unit.id]) {
      latest[unit.id] = await loadCheckpointChain(dir, manifest, unit);
      if (useCache && latest[unit.id]?.state.step === 1_000_000) {
        await writeVerifiedChainCache(dir, manifest, unit, latest[unit.id]!);
      }
    }
  }
  return latest;
}
function samplesOf(
  latest: Record<string, LoadedCheckpoint | null>,
): Record<
  string,
  Record<number, import("./lib/discovery-improvement-runtime.ts").Sample>
> {
  return Object.fromEntries(
    Object.entries(latest).map(([id, x]) => [id, x?.samples ?? {}]),
  );
}
async function executeAssay(
  device: GPUDevice,
  manifest: Manifest,
  request: {
    cacheKey: string;
    descendantHex: string;
    founderHex: string;
    seed: number;
    assignment: number;
  },
): Promise<AssayResult> {
  const { GpuSim } = await import("@bl/sim-gpu");
  const cfg = discoveryCompetitionConfig(request.seed),
    built = discoveryCompetitionWorld(
      cfg,
      request.descendantHex,
      request.founderHex,
      request.assignment,
    );
  const initialStateHash = stateHash(built.state),
    sim = await GpuSim.create(device, built.state),
    start = performance.now();
  try {
    for (let step = 100; step <= ASSAY_STEPS; step += 100) {
      sim.run(100);
      await device.queue.onSubmittedWorkDone();
    }
    const state = await sim.readState();
    if (state.step !== ASSAY_STEPS) throw Error("assay step drift");
    const mass = discoveryCompetitionMasses(
      state,
      built.descendantLineage,
      built.ancestorLineage,
    );
    if (mass.unexpected !== 0) throw Error("unexpected assay lineage mass");
    const total = mass.descendant + mass.ancestor,
      score = total > 0 ? (mass.descendant - mass.ancestor) / total : null;
    const result: AssayResult = {
      format: "discovery-improvement-assay/v1",
      cacheKey: request.cacheKey,
      sourceManifestHash: manifest.sourceManifestHash,
      descendantHex: request.descendantHex,
      founderHex: request.founderHex,
      cfg,
      seed: request.seed,
      assignment: request.assignment,
      steps: ASSAY_STEPS,
      initialStateHash,
      finalStateHash: stateHash(state),
      descendantMass: mass.descendant,
      ancestorMass: mass.ancestor,
      unassociatedMass: mass.unassociated,
      status: score === null ? "both-extinct" : "scored",
      score,
      elapsedSeconds: (performance.now() - start) / 1000,
    };
    return validateAssayResult(
      result,
      request.cacheKey,
      request.descendantHex,
      request.founderHex,
      request.seed,
      request.assignment,
      manifest.sourceManifestHash,
    );
  } finally {
    sim.destroy();
  }
}
async function run(
  manifestArg: string,
  releaseArg: string,
  outArg: string,
  seconds: number,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    throw Error("tranche must be >0 and <=600 seconds");
  }
  const { manifest, bytes } = await frozen(manifestArg), out = resolve(outArg);
  const relativeOut = relative(join(manifest.sourceRoot, "runs"), out);
  if (
    relativeOut === "" || relativeOut === ".." ||
    relativeOut.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`) ||
    isAbsolute(relativeOut)
  ) throw Error("raw study output must be a subdirectory of ignored runs/");
  const releaseBytes = await Deno.readFile(resolve(releaseArg)),
    releaseSha256 = sha256(releaseBytes),
    release = JSON.parse(textDecoder.decode(releaseBytes)) as Release;
  const priorSeconds = await invocationSeconds(
    out,
    manifest.manifestHash,
    releaseSha256,
  );
  validateRelease(release, manifest, sha256(bytes), out, priorSeconds, seconds);
  const unlock = await lock(out),
    started = performance.now(),
    startedAt = new Date().toISOString();
  let device: GPUDevice | null = null,
    newCheckpoints = 0,
    newAssays = 0,
    status = "time-limit",
    error: string | null = null;
  try {
    if (
      priorSeconds === 0 &&
      freeBytes(out) <
        release.forecast.estimatedStorageBytes +
          release.forecast.minimumFreeBytes
    ) {
      throw Error(
        "current free storage does not cover released study envelope",
      );
    }
    const latest = await loadAll(out, manifest, true);
    const { requestDevice } = await import("@bl/sim-gpu");
    for (const unit of manifest.units) {
      while ((latest[unit.id]?.state.step ?? -100_000) < 1_000_000) {
        if (performance.now() - started >= seconds * 1000) break;
        if (
          priorSeconds + (performance.now() - started) / 1000 >=
            release.forecast.cumulativeExecutionCapSeconds
        ) {
          status = "resource-limit";
          break;
        }
        storageGuard(out, release);
        if (!device) {
          device = await requestDevice(
            navigator.gpu,
            discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state
              .cfg,
          );
        }
        latest[unit.id] = await advanceHistory(
          device,
          out,
          manifest,
          unit,
          latest[unit.id],
        );
        newCheckpoints++;
        if (latest[unit.id]!.state.step === 1_000_000) {
          await writeVerifiedChainCache(
            join(out, "histories", unit.id),
            manifest,
            unit,
            latest[unit.id]!,
          );
        }
      }
      if ((latest[unit.id]?.state.step ?? 0) < 1_000_000) break;
    }
    if (manifest.units.every((u) => latest[u.id]?.state.step === 1_000_000)) {
      const roster = requestsFromSamples(manifest, samplesOf(latest));
      if (roster.uniqueKeys.length > 2112) {
        throw Error(
          `distinct assay count ${roster.uniqueKeys.length} exceeds conservative release forecast`,
        );
      }
      const rosterPath = join(out, "assay-roster.json"),
        rosterBytes = textEncoder.encode(
          JSON.stringify({ manifestHash: manifest.manifestHash, ...roster }) +
            "\n",
        );
      const existing = await exists(rosterPath)
        ? await Deno.readFile(rosterPath)
        : null;
      if (existing && sha256(existing) !== sha256(rosterBytes)) {
        throw Error("assay roster drift");
      }
      if (!existing) await writeNew(rosterPath, rosterBytes);
      const drawById = new Map(roster.draws.map((d) => [d.id, d]));
      const representative = new Map<
        string,
        {
          cacheKey: string;
          descendantHex: string;
          founderHex: string;
          seed: number;
          assignment: number;
        }
      >();
      for (const assay of roster.assays) {
        if (assay.cacheKey && !representative.has(assay.cacheKey)) {
          const draw = drawById.get(assay.drawId)!;
          representative.set(assay.cacheKey, {
            cacheKey: assay.cacheKey,
            descendantHex: draw.descendantHex!,
            founderHex: draw.founderHex,
            seed: assay.assaySeed,
            assignment: assay.assignment,
          });
        }
      }
      for (const request of representative.values()) {
        const path = join(out, "assays", `${request.cacheKey}.json`);
        if (await exists(path)) {
          validateAssayResult(
            await readJson<AssayResult>(path),
            request.cacheKey,
            request.descendantHex,
            request.founderHex,
            request.seed,
            request.assignment,
            manifest.sourceManifestHash,
          );
          continue;
        }
        if (performance.now() - started >= seconds * 1000) break;
        if (
          !canStartAssay(
            release,
            priorSeconds,
            (performance.now() - started) / 1000,
          )
        ) {
          status = "resource-limit";
          break;
        }
        storageGuard(out, release);
        if (!device) {
          device = await requestDevice(
            navigator.gpu,
            discoveryCompetitionConfig(request.seed),
          );
        }
        await writeNew(
          path,
          JSON.stringify(await executeAssay(device, manifest, request)) + "\n",
        );
        newAssays++;
      }
      if (
        status !== "resource-limit" && newAssays === 0 &&
        performance.now() - started < seconds * 1000
      ) status = "assay-roster-complete";
    }
    await frozen(manifestArg);
    if (sha256(await Deno.readFile(resolve(releaseArg))) !== releaseSha256) {
      throw Error("reviewed release changed during run");
    }
  } catch (e) {
    status = "technical-error";
    error = errText(e);
    throw e;
  } finally {
    device?.destroy();
    const elapsedSeconds = (performance.now() - started) / 1000;
    try {
      await writeNew(
        join(out, `invocation-${Date.now()}-${Deno.pid}.json`),
        JSON.stringify({
          manifestHash: manifest.manifestHash,
          releaseSha256,
          startedAt,
          finishedAt: new Date().toISOString(),
          elapsedSeconds,
          trancheSeconds: seconds,
          newCheckpoints,
          newAssays,
          status,
          error,
        }) + "\n",
      );
    } finally {
      await unlock();
    }
  }
  console.log(JSON.stringify({ status, newCheckpoints, newAssays }));
}
async function analyze(
  manifestArg: string,
  outArg: string,
  reportArg: string,
): Promise<void> {
  const { manifest } = await frozen(manifestArg), out = resolve(outArg);
  if (await exists(join(out, "RUNNING"))) throw Error("run lock is active");
  const latest = await loadAll(out, manifest),
    samples = samplesOf(latest),
    roster = requestsFromSamples(manifest, samples);
  const results: Record<string, AssayResult | null> = {};
  const drawById = new Map(roster.draws.map((d) => [d.id, d]));
  for (const assay of roster.assays) {
    if (assay.cacheKey && !(assay.cacheKey in results)) {
      const path = join(out, "assays", `${assay.cacheKey}.json`),
        draw = drawById.get(assay.drawId)!;
      results[assay.cacheKey] = await exists(path)
        ? validateAssayResult(
          await readJson<AssayResult>(path),
          assay.cacheKey,
          draw.descendantHex!,
          draw.founderHex,
          assay.assaySeed,
          assay.assignment,
          manifest.sourceManifestHash,
        )
        : null;
    }
  }
  const result = analyzeScores(manifest, roster, results, samples);
  await writeNew(resolve(reportArg), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({
    technicalComplete: result.technicalComplete,
    certifiedBlocks: result.certifiedBlocks,
    repeatabilityCriterionMet: result.repeatabilityCriterionMet,
    requestedAssays: result.requestedAssays,
  }));
}

export { advanceHistory, executeAssay, sourceHashes, hashMap, pilotEvidence, eligiblePilot, sortedEdges };
