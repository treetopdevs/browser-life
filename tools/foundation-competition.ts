// Five-history genotype-only time-shift feasibility screen. Default is a CPU-only plan.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CH, G, GENOME_CHANNELS, M3_FOUNDERS, artifactDigest, cellCount, cloneState,
  encodeGenome, founderGenome, ledgerResidual, stateHash, totalsOf, type WorldState } from "@bl/schema";
import { decodeArtifact, runExperiment, specConfig, type RunSpec, type Sink } from "@bl/runner";
import { catalogAtTime, EXTRACTOR_SOURCE_FILES, validateExtractionRule,
  type ExtractionCatalog, type ExtractionRule } from "./lib/foundation-extract.ts";
import { MutationOriginBuilder, parseMutationEdge, validateAndDeriveInitialOrigins,
  type SourceManifest as AncestrySourceManifest } from "./lib/foundation-ancestry.ts";
import { OBSERVATION_FILES, sha256, sourceIdentity, verifyReplayCache,
  type FileDigest, type ReplayCacheManifest } from "./lib/foundation-replay.ts";
import {
  COMPETITION_CENSUS_EVERY, COMPETITION_STEPS, FIRST_COMPETITION_SEED,
  assertReciprocalPhysicalMatch, competitionSpec, conditionChemicalPool, interfaceOpportunity,
  rankCatalogSelection, relativeGrowthContrast, standardTemplate, standardizedPool,
  startCompetition, startSingleGenotype, type PoolAudit, type RankedSelection,
} from "./lib/foundation-competition.ts";
import { extractCellPacket, type CellPacket, type TransplantAudit } from "./lib/foundation-transplant.ts";
import { GardenLifeCapture, type GardenLifeTrace } from "./lib/foundation-garden-life.ts";

export interface SourcePaths { source: string; cache: string; catalog: string }
export interface CompetitionInputs { format: 1; rule: string; sources: SourcePaths[] }
export interface CompetitionOptions { inputs: string; out: string; execute: boolean;
  maxSeconds: number | null; maxRuns: number | null; runOffset: number; priorManifests: string[] }
export function parseCompetitionArgs(args: string[]): CompetitionOptions {
  let execute = false;
  const v = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!args[i]?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--") || v.has(args[i]))
      throw new Error(`invalid or duplicate option ${args[i]}`);
    v.set(args[i], args[++i]);
  }
  for (const key of v.keys()) if (!["--inputs", "--out", "--max-seconds", "--max-runs", "--run-offset", "--prior-manifests"].includes(key))
    throw new Error(`unknown option ${key}`);
  if (!v.get("--inputs") || !v.get("--out")) throw new Error("--inputs and --out are required");
  const maxSeconds = v.has("--max-seconds") ? Number(v.get("--max-seconds")) : null;
  const maxRuns = v.has("--max-runs") ? Number(v.get("--max-runs")) : null;
  const runOffset = v.has("--run-offset") ? Number(v.get("--run-offset")) : 0;
  if (maxSeconds !== null && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("--max-seconds must be finite, positive, and <=600");
  if (maxRuns !== null && (!Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 8))
    throw new Error("--max-runs must be an integer in 1..8");
  if (!Number.isSafeInteger(runOffset) || runOffset < 0 || runOffset >= 70)
    throw new Error("--run-offset must be an integer in 0..69");
  if (execute && (maxSeconds === null || maxRuns === null))
    throw new Error("--execute requires --max-seconds <=600 and --max-runs <=8");
  const priorManifests = v.has("--prior-manifests") ? v.get("--prior-manifests")!.split(",") : [];
  if (priorManifests.some((p) => !p.trim()) || (execute && runOffset > 0 && !priorManifests.length))
    throw new Error("later execution batches require --prior-manifests covering every earlier run");
  return { inputs: v.get("--inputs")!, out: v.get("--out")!, execute, maxSeconds, maxRuns, runOffset, priorManifests };
}

export type RunKind = "solo-control" | "reciprocal-competition";
export interface DonorBase { epoch: "early" | "late"; step: 100_000 | 900_000;
  ranking: RankedSelection[]; catalogComponentCount: number; catalogSelectedCount: number;
  catalogExcludedCount: number; strata: Record<string, { total: number; selected: number; excluded: number }> }
export type DonorPlan = DonorBase & ({ status: "unavailable"; reason: string } | {
  status: "available"; chosenComponentIdx: number; chosenPacketSha256: string;
  chosenLineage: string; genotypeWords: number[]; genotypeSha256: string;
  founderInstanceIndex: number; genomeFounderIndex: number; founderLineageId: string;
  mutationEventDepth: number; founderWords: number[] });
export interface SourcePlan { worldId: string; sourcePath: string; cachePath: string; catalogPath: string;
  sourceFiles: Record<string, FileDigest>; cacheManifestFile: FileDigest; catalogFile: FileDigest;
  sourceFinalArtifactHash: string; sourceCodeRevision: string; sourcePresetIdentity: string;
  checkpointHashes: { step: number; sha256: string }[]; donorEarly: DonorPlan; donorLate: DonorPlan;
  foreignEnvironmentWorldId: string;
  template?: { sha256: string; sourceStateHash: string; inventory: CellPacket["inventory"];
    cellCount: number; seed: number } }
export interface EnvironmentPlan { id: string; donorWorldId: string; environmentWorldId: string;
  time: "early" | "late" | "standardized"; origin: "own" | "foreign" | "standardized";
  sourceCheckpointSha256: string | null; poolAudit: PoolAudit | null;
  poolStateHash: string; poolInventory: ReturnType<typeof totalsOf> extends never ? never :
    { matter: string; energy: string }; assaySeed: number }
export interface AssayPoint { step: number; earlyB: string; lateB: string;
  matterResidual: string; energyResidual: string; conservationOk: boolean; mutations: number;
  minChebyshevDistance: number | null; adjacent: boolean; kernelHalosOverlap: boolean; kernelRadius: number }
export interface RunPlan { ordinal: number; id: string; kind: RunKind; worldId: string;
  environmentId: string | null; genotype: "early" | "late" | "early-founder" | "late-founder" | null;
  earlySide: "left" | "right" | null; seed: number;
  initialPhysicsHash?: string; initialEarlyB?: string; initialLateB?: string;
  initialMatter?: string; initialEnergy?: string;
  initialContact?: ReturnType<typeof interfaceOpportunity>;
  transplantAudits?: TransplantAudit[];
  gardenLifeTrace?: GardenLifeTrace;
  status: "planned" | "running" | "complete" | "failed" | "incomplete-time-cap" | "not-run-batch" | "not-run-unavailable";
  points?: AssayPoint[];
  outcome?: { finalPhysicsHash: string; finalArtifactHash: string; wallSeconds: number;
    finalEarlyB: string; finalLateB: string; survived: boolean;
    anyKernelHaloOpportunity: boolean; anyAdjacency: boolean;
    relativeGrowth: ReturnType<typeof relativeGrowthContrast> | null };
  failure?: string; unavailableReason?: string }
export interface ReciprocalPairSummary { environmentId: string;
  status: "pending" | "complete" | "unavailable";
  leftSurvival?: NonNullable<ReturnType<typeof relativeGrowthContrast>>["survival"];
  rightSurvival?: NonNullable<ReturnType<typeof relativeGrowthContrast>>["survival"];
  leftLogRelativeGrowth?: number | null; rightLogRelativeGrowth?: number | null;
  meanLogRelativeGrowth?: number | null;
  leftSampledKernelHaloOpportunity?: boolean; rightSampledKernelHaloOpportunity?: boolean;
  leftSampledAdjacency?: boolean; rightSampledAdjacency?: boolean;
  exposureLimited?: boolean }
export interface CompetitionManifest { format: 1; status: "planned" | "running" | "partial" | "failed";
  createdAt: string; inputsFile: FileDigest; ruleFile: FileDigest; rule: ExtractionRule;
  priorBatchFiles: { path: string; digest: FileDigest }[];
  codeHashScope: "selected-assay-extractor-ancestry-replay-schema-runner-metrics-files;not-complete-dependency-closure";
  sourceCodeRevision: string; codeFilesBefore: Record<string, FileDigest>;
  codeFilesAfter?: Record<string, FileDigest>; sources: SourcePlan[]; environments: EnvironmentPlan[];
  runs: RunPlan[]; reciprocalPairs: ReciprocalPairSummary[];
  postExecutionRevalidated: boolean;
  execution: { requested: boolean; maxSeconds: number | null; maxRuns: number | null;
    runOffset: number; runCount: 70; controlCount: 20; competitionCount: 50;
    soloLifecycleCapture: "compact-in-situ-trace-analysis-pending";
    contrast: "late-vs-early-log-relative-B-growth-at-3000-if-both-survive";
    claim: "equal-frequency-genotype-only-feasibility" };
  runtime?: { startedAt: string; endedAt?: string; elapsedSeconds: number; overrun: boolean;
    denoVersion: string; os: string; arch: string;
    adapter: { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null };
  failure?: string }

const CODE_FILES = ["tools/foundation-competition.ts", "tools/lib/foundation-competition.ts",
  "tools/lib/foundation-transplant.ts", "tools/lib/foundation-ancestry.ts",
  "tools/lib/foundation-garden-life.ts", "tools/lib/foundation-lifecycle.ts", "tools/lib/foundation-life.ts",
  "packages/schema/src/founders.ts", "packages/schema/src/genome.ts", "packages/schema/src/world.ts",
  "packages/runner/src/runner.ts", "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameDigest = (a: FileDigest | undefined, b: FileDigest | undefined) => !!a && !!b && a.bytes === b.bytes && a.sha256 === b.sha256;
const genotypeDigest = (words: readonly number[]) => {
  const bytes = new Uint8Array((words.length - 2) * 4), view = new DataView(bytes.buffer);
  for (let g = 2; g < words.length; g++) view.setUint32((g - 2) * 4, words[g], true);
  return sha256(bytes).sha256;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const txt = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
export class CompetitionTimeCapError extends Error {}

/** A status string alone never authorizes reuse of a prior GPU observation. */
export function validateReusablePriorBatch(prior: CompetitionManifest, expected: Pick<CompetitionManifest,
  "inputsFile" | "ruleFile" | "codeFilesBefore" | "sources" | "environments" | "runs">): void {
  if (prior.format !== 1 || prior.status !== "partial" || prior.postExecutionRevalidated !== true ||
      prior.execution?.requested !== true || !prior.runtime?.endedAt || prior.runtime.overrun !== false ||
      !prior.runtime.adapter || prior.failure || !same(prior.codeFilesAfter, prior.codeFilesBefore))
    throw new Error("prior batch lacks successful post-execution revalidation and device evidence");
  if (!same(prior.inputsFile, expected.inputsFile) || !same(prior.ruleFile, expected.ruleFile) ||
      !same(prior.codeFilesBefore, expected.codeFilesBefore) || !same(prior.sources, expected.sources) ||
      !same(prior.environments, expected.environments) || prior.runs?.length !== expected.runs.length)
    throw new Error("prior batch has a different frozen assay plan");
  for (let j = 0; j < expected.runs.length; j++) {
    const a = prior.runs[j], b = expected.runs[j];
    if (a.id !== b.id || a.seed !== b.seed || a.initialPhysicsHash !== b.initialPhysicsHash ||
        !same(a.transplantAudits, b.transplantAudits))
      throw new Error(`prior batch run ${j} identity or transplant audit differs`);
    if (a.status === "complete" && (!a.outcome?.finalArtifactHash ||
        a.points?.length !== COMPETITION_STEPS / COMPETITION_CENSUS_EVERY ||
        a.points.some((p) => !p.conservationOk || p.mutations !== 0)))
      throw new Error(`prior batch run ${j} has incomplete or invalid observation evidence`);
    if (a.status === "complete" && a.kind === "solo-control" &&
        (a.gardenLifeTrace?.scope !== "one-solo-garden-in-situ-observer-trace" ||
          a.gardenLifeTrace.status !== "complete" || a.gardenLifeTrace.lastCapturedStep !== 3000 ||
          a.gardenLifeTrace.window.startStep !== 100 || a.gardenLifeTrace.window.endStep !== 3000 ||
          a.gardenLifeTrace.window.censusDigests.length !== 30 || a.gardenLifeTrace.unreconciledEvents.length !== 0))
      throw new Error(`prior solo run ${j} lacks complete in-situ lifecycle capture`);
  }
}

async function digestFile(path: string, check: (stage: string) => void): Promise<FileDigest> {
  const hash = createHash("sha256"); let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const chunk of file.readable) { check(`hash ${path}`); hash.update(chunk); bytes += chunk.byteLength; }
  return { sha256: hash.digest("hex"), bytes };
}
async function codeDigests(root: string, replayFiles: readonly string[], check: (stage: string) => void) {
  const result: Record<string, FileDigest> = {};
  for (const name of new Set([...CODE_FILES, ...EXTRACTOR_SOURCE_FILES, ...replayFiles]))
    result[name] = await digestFile(join(root, name), check);
  return result;
}
async function sourceDigests(path: string, check: (stage: string) => void) {
  const result: Record<string, FileDigest> = {};
  for (const name of ["manifest.json", ...OBSERVATION_FILES]) result[name] = await digestFile(join(path, name), check);
  return result;
}
async function* lines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path, { read: true });
  const decoder = new TextDecoder("utf-8", { fatal: true }); let pending = "";
  try {
    for await (const chunk of file.readable) {
      pending += decoder.decode(chunk, { stream: true }); let index = -1;
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, ""); pending = pending.slice(index + 1);
        yield line;
      }
      if (pending.length > 2_000_000) throw new Error("mutation row exceeds 2 MB");
    }
    pending += decoder.decode(); if (pending) yield pending.replace(/\r$/, "");
  } finally { try { file.close(); } catch { /* readable closed */ } }
}
async function ancestryForChosen(sourcePath: string, manifest: AncestrySourceManifest,
  chosen: { epoch: "early" | "late"; packet: CellPacket }[], check: (stage: string) => void) {
  const { origins } = validateAndDeriveInitialOrigins(manifest);
  const builder = new MutationOriginBuilder(origins, { finalStep: manifest.spec.steps,
    cellCount: cellCount(manifest.cfg), ringNamespace: manifest.cfg.ringNamespace });
  let first = true;
  for await (const line of lines(join(sourcePath, "mutations.tsv"))) {
    if (first) { if (line !== "childHi\tchildLo\tparentHi\tparentLo") throw new Error("mutation header mismatch"); first = false; continue; }
    if (builder.rows % 10000 === 0) check("ancestry mutation scan");
    builder.push(parseMutationEdge(line));
  }
  if (first || builder.rows !== manifest.summary.mutations) throw new Error("mutation ancestry is incomplete");
  return chosen.map(({ epoch, packet }) => {
    const words = packet.cells[0].genome;
    const lineage = `${words[G.LIN_HI]}:${words[G.LIN_LO]}`;
    const origin = builder.origins.get(lineage);
    if (!origin) throw new Error(`${epoch} selected lineage lacks an authenticated founder origin`);
    const founderWords = Array.from(encodeGenome(founderGenome(M3_FOUNDERS[origin.genomeFounderIndex]), 0, 0));
    return { epoch, lineage, origin, founderWords };
  });
}

interface PreparedSource { cache: ReplayCacheManifest; plan: SourcePlan;
  snapshots: Map<number, WorldState>; earlyWords: number[] | null; lateWords: number[] | null;
  earlyFounderWords: number[] | null; lateFounderWords: number[] | null }
async function prepareSource(paths: SourcePaths, seed: number, rule: ExtractionRule, ruleFile: FileDigest,
  projectRoot: string, check: (stage: string) => void): Promise<PreparedSource> {
  const cacheStore = { read: (name: string) => Deno.readFile(join(paths.cache, name)) };
  const cache = await verifyReplayCache(cacheStore);
  if (cache.source.finalHashMode !== "artifact" || cache.observerCompatible !== true ||
      cache.source.spec.presetId !== "gradient-m3" || cache.source.spec.condition !== "treatment" ||
      cache.source.spec.seed !== seed || cache.source.spec.steps !== 1_000_000 ||
      !same(cache.requestedSteps, [100_000, 500_000, 900_000]) || cache.source.runId !== `m4/gradient-m3/treatment/seed-${seed}`)
    throw new Error(`seed ${seed} source is not the required authenticated observer-compatible M4 history`);
  const sourceFiles = await sourceDigests(paths.source, check);
  for (const name of ["manifest.json", ...OBSERVATION_FILES])
    if (!sameDigest(sourceFiles[name], cache.source.files[name])) throw new Error(`seed ${seed} source ${name} changed`);
  const sourceManifest = JSON.parse(txt(await Deno.readFile(join(paths.source, "manifest.json")))) as AncestrySourceManifest;
  const replayCode: Record<string, FileDigest> = {};
  for (const name of Object.keys(cache.source.replayCodeFiles)) replayCode[name] = await digestFile(join(projectRoot, name), check);
  if (!same(sourceIdentity(sourceManifest as never, sourceFiles, "artifact", cache.source.codeRevision, replayCode), cache.source))
    throw new Error(`seed ${seed} original source/replay code identity changed`);
  const catalogBytes = await Deno.readFile(paths.catalog), catalogFile = sha256(catalogBytes);
  const catalog = JSON.parse(txt(catalogBytes)) as ExtractionCatalog;
  if (catalog.format !== 1 || catalog.status !== "catalog-only" || !catalog.usable || !catalog.observerCompatible ||
      catalog.sourceRunId !== cache.source.runId || catalog.cacheFinalArtifactHash !== cache.final!.artifactHash ||
      catalog.ruleFileSha256 !== ruleFile.sha256 || !same(catalog.rule, rule) ||
      !same(catalog.provenance.sourceSpec, cache.source.spec) || catalog.provenance.sourceCodeRevision !== cache.source.codeRevision ||
      catalog.provenance.sourcePresetIdentity !== cache.source.presetIdentity ||
      !same(catalog.provenance.sourceVersions, cache.source.versions) || catalog.times.length !== 3)
    throw new Error(`seed ${seed} catalog identity mismatch`);
  for (const name of ["manifest.json", ...OBSERVATION_FILES])
    if (!sameDigest(catalog.sourceFiles[name], sourceFiles[name])) throw new Error(`seed ${seed} catalog source ${name} changed`);
  for (const name of EXTRACTOR_SOURCE_FILES)
    if (!sameDigest(catalog.provenance.extractorFiles[name], await digestFile(join(projectRoot, name), check)))
      throw new Error(`seed ${seed} catalog extractor code ${name} changed`);
  const snapshots = new Map<number, WorldState>();
  const chosen: { epoch: "early" | "late"; packet: CellPacket; ranking: RankedSelection[] }[] = [];
  for (let i = 0; i < 3; i++) {
    const cp = cache.checkpoints[i], time = catalog.times[i];
    if (time.step !== cp.step || time.checkpointSha256 !== cp.fileDigest.sha256 || time.checkpointFile !== cp.file)
      throw new Error(`seed ${seed} catalog checkpoint ${i} differs`);
    const { state, observer } = decodeArtifact(await cacheStore.read(cp.file));
    const recomputed = catalogAtTime(state, observer, cp.file, cp.fileDigest.sha256, true, rule);
    if (!same(recomputed, time)) throw new Error(`seed ${seed} catalog content differs at ${cp.step}`);
    if (i !== 1) {
      snapshots.set(cp.step, state);
      const epoch = i === 0 ? "early" : "late";
      const ranking = rankCatalogSelection(cache.source.runId, epoch, ruleFile.sha256, time);
      if (ranking.length) {
        const component = time.components.find((c) => c.idx === ranking[0].idx)!;
        const packet = extractCellPacket(state, component.cellIndices);
        if (Object.keys(component.lineageCells).length !== 1 ||
            Object.keys(component.lineageCells)[0] !== `${packet.cells[0].genome[G.LIN_HI]}:${packet.cells[0].genome[G.LIN_LO]}`)
          throw new Error(`seed ${seed} chosen ${epoch} component has ambiguous lineage`);
        chosen.push({ epoch, packet, ranking });
      }
    }
  }
  const ancestry = await ancestryForChosen(paths.source, sourceManifest, chosen, check);
  const donor = (epoch: "early" | "late"): DonorPlan => {
    const catalogTime = catalog.times.find((t) => t.step === (epoch === "early" ? 100_000 : 900_000))!;
    const strata: DonorBase["strata"] = {};
    for (const component of catalogTime.components) {
      const name = component.stratum ?? "unclassified";
      const counts = strata[name] ??= { total: 0, selected: 0, excluded: 0 };
      counts.total++;
      if (component.selected) counts.selected++; else counts.excluded++;
    }
    const base: DonorBase = { epoch, step: epoch === "early" ? 100_000 : 900_000,
      ranking: rankCatalogSelection(cache.source.runId, epoch, ruleFile.sha256, catalogTime),
      catalogComponentCount: catalogTime.components.length,
      catalogSelectedCount: catalogTime.components.filter((c) => c.selected).length,
      catalogExcludedCount: catalogTime.components.filter((c) => !c.selected).length,
      strata };
    const row = chosen.find((c) => c.epoch === epoch);
    if (!row) return { ...base, status: "unavailable", reason: "frozen catalog has zero selected components at this epoch" };
    const originRow = ancestry.find((a) => a.epoch === epoch)!;
    const words = [...row.packet.cells[0].genome]; words[0] = 0; words[1] = 0;
    return { ...base, status: "available", chosenComponentIdx: row.ranking[0].idx,
      chosenPacketSha256: row.packet.sha256,
      chosenLineage: originRow.lineage, genotypeWords: words,
      genotypeSha256: genotypeDigest(words),
      founderInstanceIndex: originRow.origin.founderInstanceIndex,
      genomeFounderIndex: originRow.origin.genomeFounderIndex, founderLineageId: originRow.origin.founderLineageId,
      mutationEventDepth: originRow.origin.mutationEventDepth, founderWords: originRow.founderWords };
  };
  const plan: SourcePlan = { worldId: cache.source.runId, sourcePath: resolve(paths.source), cachePath: resolve(paths.cache),
    catalogPath: resolve(paths.catalog), sourceFiles, cacheManifestFile: await digestFile(join(paths.cache, "manifest.json"), check),
    catalogFile, sourceFinalArtifactHash: cache.final!.artifactHash, sourceCodeRevision: cache.source.codeRevision,
    sourcePresetIdentity: cache.source.presetIdentity,
    checkpointHashes: cache.checkpoints.map((c) => ({ step: c.step, sha256: c.fileDigest.sha256 })),
    donorEarly: donor("early"), donorLate: donor("late"), foreignEnvironmentWorldId: "" };
  return { cache, plan, snapshots,
    earlyWords: plan.donorEarly.status === "available" ? plan.donorEarly.genotypeWords : null,
    lateWords: plan.donorLate.status === "available" ? plan.donorLate.genotypeWords : null,
    earlyFounderWords: plan.donorEarly.status === "available" ? plan.donorEarly.founderWords : null,
    lateFounderWords: plan.donorLate.status === "available" ? plan.donorLate.founderWords : null };
}

function biomass(state: WorldState): [bigint, bigint] {
  const n = cellCount(state.cfg); let early = 0n, late = 0n;
  for (let i = 0; i < n; i++) {
    if (state.genome[G.LIN_HI * n + i] !== 0) continue;
    const id = state.genome[G.LIN_LO * n + i], b = BigInt(state.cells[CH.B * n + i]);
    if (id === 1) early += b;
    else if (id === 2) late += b;
  }
  return [early, late];
}
class AssaySink implements Sink {
  readonly series = new Map<number, Record<string, unknown>>();
  readonly snapshots = new Map<number, Omit<AssayPoint, "conservationOk" | "mutations">>();
  constructor(readonly initialMatter: bigint, readonly initialEnergy: bigint,
    readonly check: (stage: string) => void, readonly life: GardenLifeCapture | null = null) {}
  async writeText(): Promise<void> {}
  async appendText(name: string, content: string): Promise<void> {
    this.check(`read ${name}`);
    if (name === "life.jsonl" && this.life) { this.life.acceptLifeText(content); return; }
    if (name !== "series.jsonl") return;
    for (const line of content.split("\n")) if (line) {
      const row = JSON.parse(line) as Record<string, unknown>;
      this.series.set(Number(row.step), row);
    }
  }
  async writeBytes(name: string, bytes: Uint8Array): Promise<void> {
    this.check(`decode ${name}`);
    const { state, observer } = decodeArtifact(bytes);
    if (this.life) this.life.acceptCheckpoint(state, observer);
    const [earlyB, lateB] = biomass(state);
    const matterResidual = totalsOf(state.cfg, state.cells).matter - this.initialMatter;
    const energyResidual = ledgerResidual({ energy: this.initialEnergy }, state);
    this.snapshots.set(state.step, { step: state.step, earlyB: String(earlyB), lateB: String(lateB),
      matterResidual: String(matterResidual), energyResidual: String(energyResidual),
      ...interfaceOpportunity(state) });
  }
  points(requireComplete = true): AssayPoint[] {
    const points: AssayPoint[] = [];
    for (let step = COMPETITION_CENSUS_EVERY; step <= COMPETITION_STEPS; step += COMPETITION_CENSUS_EVERY) {
      const snap = this.snapshots.get(step), row = this.series.get(step);
      if (!snap || !row) { if (requireComplete) throw new Error(`missing assay census/checkpoint ${step}`); break; }
      const mutations = row.mutations;
      if (!Number.isSafeInteger(mutations) || Number(mutations) < 0) throw new Error(`invalid mutation count at ${step}`);
      points.push({ ...snap, conservationOk: row.conservationOk === true &&
          snap.matterResidual === "0" && snap.energyResidual === "0", mutations: Number(mutations) });
    }
    return points;
  }
}

async function acquire(gpu: GPU, cfg: WorldState["cfg"]) {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo; requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("WebGPU adapter identity unavailable");
  const bytes = cellCount(cfg) * GENOME_CHANNELS * 4;
  if (bytes > adapter.limits.maxStorageBufferBindingSize || bytes > adapter.limits.maxBufferSize)
    throw new Error("world exceeds WebGPU adapter buffer limits");
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
  }, requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, info: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}

async function main() {
  const options = parseCompetitionArgs(Deno.args), projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const started = performance.now(), startedAt = new Date().toISOString();
  const check = (stage: string) => { if (options.maxSeconds !== null && (performance.now() - started) / 1000 > options.maxSeconds)
    throw new CompetitionTimeCapError(`competition cap ${options.maxSeconds}s exceeded at ${stage}`); };
  let reserved = false, manifest: CompetitionManifest | undefined, device: GPUDevice | undefined;
  const persist = async (ended = false) => {
    if (!manifest) return;
    manifest.runtime!.elapsedSeconds = (performance.now() - started) / 1000;
    manifest.runtime!.overrun = options.maxSeconds !== null && manifest.runtime!.elapsedSeconds > options.maxSeconds;
    if (ended) manifest.runtime!.endedAt = new Date().toISOString();
    await Deno.writeTextFile(join(options.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  };
  try {
    await Deno.mkdir(options.out); reserved = true;
    const inputsBytes = await Deno.readFile(options.inputs), inputs = JSON.parse(txt(inputsBytes)) as CompetitionInputs;
    if (inputs.format !== 1 || inputs.sources?.length !== 5 || !inputs.rule ||
        inputs.sources.some((s) => !s.source || !s.cache || !s.catalog)) throw new Error("exactly five source/cache/catalog triples required");
    const ruleBytes = await Deno.readFile(inputs.rule), rule = JSON.parse(txt(ruleBytes)) as ExtractionRule;
    validateExtractionRule(rule);
    const ruleFile = sha256(ruleBytes), inputFile = sha256(inputsBytes);
    const prepared: PreparedSource[] = [];
    for (let i = 0; i < 5; i++) { check(`prepare source ${i + 1}`);
      prepared.push(await prepareSource(inputs.sources[i], i + 1, rule, ruleFile, projectRoot, check)); }
    if (new Set(prepared.map((p) => p.plan.sourceCodeRevision)).size !== 1 ||
        new Set(prepared.map((p) => p.plan.sourcePresetIdentity)).size !== 1)
      throw new Error("source histories have different code revisions or preset identities");
    const allReplayFiles = [...new Set(prepared.flatMap((p) => Object.keys(p.cache.source.replayCodeFiles)))];
    const codeFilesBefore = await codeDigests(projectRoot, allReplayFiles, check);
    const priorBatchFiles: CompetitionManifest["priorBatchFiles"] = [];
    const priorBatches: CompetitionManifest[] = [];
    for (const path of options.priorManifests) {
      const bytes = await Deno.readFile(path);
      priorBatchFiles.push({ path: resolve(path), digest: sha256(bytes) });
      priorBatches.push(JSON.parse(txt(bytes)) as CompetitionManifest);
    }
    const environments: EnvironmentPlan[] = [], runs: RunPlan[] = [];
    const environmentStates = new Map<string, WorldState>();
    const addRun = (run: Omit<RunPlan, "ordinal" | "status">) => runs.push({ ...run, ordinal: runs.length, status: "planned" });
    // All four matched solo controls per source precede every reciprocal competition.
    for (let i = 0; i < 5; i++) {
      const worldId = prepared[i].plan.worldId;
      for (const genotype of ["early", "early-founder", "late", "late-founder"] as const)
        addRun({ id: `${worldId}/solo/${genotype}`, kind: "solo-control", worldId, environmentId: null,
          genotype, earlySide: null, seed: FIRST_COMPETITION_SEED + i });
    }
    for (let i = 0; i < 5; i++) {
      const donor = prepared[i], worldId = donor.plan.worldId, foreign = prepared[(i + 1) % 5];
      donor.plan.foreignEnvironmentWorldId = foreign.plan.worldId;
      for (const [origin, environment] of [["own", donor], ["foreign", foreign]] as const) {
        for (const [time, step] of [["early", 100_000], ["late", 900_000]] as const) {
          const seed = FIRST_COMPETITION_SEED + 20 + environments.length;
          const spec = competitionSpec(donor.cache.source.spec, seed);
          const { state, audit } = conditionChemicalPool(environment.snapshots.get(step)!, specConfig(spec));
          const id = `${worldId}/${origin}/${time}`;
          environmentStates.set(id, state);
          environments.push({ id, donorWorldId: worldId, environmentWorldId: environment.plan.worldId,
            time, origin, sourceCheckpointSha256: environment.plan.checkpointHashes.find((h) => h.step === step)!.sha256,
            poolAudit: audit, poolStateHash: stateHash(state),
            poolInventory: { matter: audit.after.matter, energy: audit.after.energy }, assaySeed: seed });
        }
      }
      const seed = FIRST_COMPETITION_SEED + 20 + environments.length;
      const spec = competitionSpec(donor.cache.source.spec, seed), state = standardizedPool(specConfig(spec));
      const id = `${worldId}/standardized`;
      environmentStates.set(id, state);
      const t = totalsOf(state.cfg, state.cells);
      environments.push({ id, donorWorldId: worldId, environmentWorldId: "standardized", time: "standardized",
        origin: "standardized", sourceCheckpointSha256: null, poolAudit: null,
        poolStateHash: stateHash(state), poolInventory: { matter: String(t.matter), energy: String(t.energy) }, assaySeed: seed });
    }
    for (const env of environments) for (const side of ["left", "right"] as const)
      addRun({ id: `${env.id}/${side}`, kind: "reciprocal-competition", worldId: env.donorWorldId,
        environmentId: env.id, genotype: null, earlySide: side, seed: env.assaySeed });
    if (runs.length !== 70 || environments.length !== 25) throw new Error("competition run matrix incomplete");
    for (const run of runs) {
      const donor = prepared.find((p) => p.plan.worldId === run.worldId)!;
      const missing = run.kind === "reciprocal-competition" ?
        [donor.plan.donorEarly, donor.plan.donorLate].filter((d) => d.status === "unavailable") :
        [run.genotype === "early" || run.genotype === "early-founder" ? donor.plan.donorEarly : donor.plan.donorLate]
          .filter((d) => d.status === "unavailable");
      if (missing.length) {
        run.status = "not-run-unavailable";
        run.unavailableReason = missing.map((d) => `${d.epoch}: ${(d as Extract<DonorPlan, {status: "unavailable"}>).reason}`).join("; ");
      }
    }
    const templates = new Map(prepared.map((p) => [p.plan.worldId, standardTemplate(p.cache.source.spec)]));
    for (const preparedSource of prepared) {
      const template = templates.get(preparedSource.plan.worldId)!;
      preparedSource.plan.template = { sha256: template.sha256, sourceStateHash: template.sourceStateHash,
        inventory: template.inventory, cellCount: template.cells.length, seed: template.sourceConfig.seed };
    }
    const createStart = (run: RunPlan): WorldState => {
      const donor = prepared.find((p) => p.plan.worldId === run.worldId)!;
      const template = templates.get(run.worldId)!;
      const spec = competitionSpec(donor.cache.source.spec, run.seed);
      if (run.kind === "solo-control") {
        const words = run.genotype === "early" ? donor.earlyWords : run.genotype === "late" ? donor.lateWords :
          run.genotype === "early-founder" ? donor.earlyFounderWords : donor.lateFounderWords;
        if (!words) throw new Error(`control ${run.id} donor unavailable`);
        const start = startSingleGenotype(standardizedPool(specConfig(spec)), template, words);
        const totals = totalsOf(start.state.cfg, start.state.cells);
        run.initialPhysicsHash = start.stateHash; run.initialEarlyB = start.initialB; run.initialLateB = "0";
        run.initialMatter = String(totals.matter); run.initialEnergy = String(totals.energy);
        run.transplantAudits = [start.audit];
        return start.state;
      }
      const env = environments.find((e) => e.id === run.environmentId)!;
      const pool = environmentStates.get(env.id)!;
      if (pool.cfg.seed !== run.seed || stateHash(pool) !== env.poolStateHash)
        throw new Error(`environment ${env.id} state changed`);
      if (!donor.earlyWords || !donor.lateWords) throw new Error(`competition ${run.id} donor unavailable`);
      const start = startCompetition(pool, template, donor.earlyWords, donor.lateWords, run.earlySide!);
      run.initialPhysicsHash = start.stateHash; run.initialEarlyB = start.initial.earlyB;
      run.initialLateB = start.initial.lateB; run.initialMatter = start.initial.matter; run.initialEnergy = start.initial.energy;
      run.initialContact = interfaceOpportunity(start.state);
      run.transplantAudits = start.audits;
      return start.state;
    };
    // Build and compare every reciprocal start before any device request, but retain no per-run state.
    for (const run of runs.filter((r) => r.kind === "solo-control" && r.status === "planned")) {
      check(`plan ${run.id}`); createStart(run); }
    for (const env of environments) {
      check(`plan reciprocal ${env.id}`);
      const left = runs.find((r) => r.id === `${env.id}/left`)!, right = runs.find((r) => r.id === `${env.id}/right`)!;
      if (left.status === "not-run-unavailable" && right.status === "not-run-unavailable") continue;
      const donor = prepared.find((p) => p.plan.worldId === env.donorWorldId)!;
      const template = templates.get(env.donorWorldId)!;
      const pool = environmentStates.get(env.id)!;
      const a = startCompetition(pool, template, donor.earlyWords!, donor.lateWords!, "left");
      const b = startCompetition(pool, template, donor.earlyWords!, donor.lateWords!, "right");
      assertReciprocalPhysicalMatch(a, b);
      for (const [run, start] of [[left, a], [right, b]] as const) {
        run.initialPhysicsHash = start.stateHash; run.initialEarlyB = start.initial.earlyB;
        run.initialLateB = start.initial.lateB; run.initialMatter = start.initial.matter;
        run.initialEnergy = start.initial.energy; run.initialContact = interfaceOpportunity(start.state);
        run.transplantAudits = start.audits;
      }
    }
    const priorCompleted = new Map<number, RunPlan>();
    if (options.execute && options.runOffset > 0) {
      const completed = new Map<number, string>();
      for (const prior of priorBatches) {
        validateReusablePriorBatch(prior, { inputsFile: inputFile, ruleFile, codeFilesBefore,
          sources: prepared.map((p) => p.plan), environments, runs });
        for (let j = 0; j < runs.length; j++) {
          const a = prior.runs[j], b = runs[j];
          if (a.status === "not-run-unavailable") {
            if (b.status !== "not-run-unavailable" || a.unavailableReason !== b.unavailableReason)
              throw new Error(`prior batch run ${j} has inconsistent unavailability`);
            completed.set(j, "unavailable");
          }
          if (a.status === "complete") {
            const outcome = JSON.stringify({ points: a.points, outcome: a.outcome });
            if (completed.has(j) && completed.get(j) !== outcome)
              throw new Error(`prior batches disagree on completed run ${j}`);
            completed.set(j, outcome); priorCompleted.set(j, a);
          }
        }
      }
      for (let j = 0; j < options.runOffset; j++) if (!completed.has(j) && runs[j].status !== "not-run-unavailable")
        throw new Error(`prior batches lack completed run ${j}; batch order cannot be skipped`);
    }
    const reciprocalPairs: ReciprocalPairSummary[] = environments.map((env) => ({ environmentId: env.id,
      status: runs.find((r) => r.id === `${env.id}/left`)!.status === "not-run-unavailable" ? "unavailable" : "pending" }));
    manifest = { format: 1, status: "planned", createdAt: new Date().toISOString(), inputsFile: inputFile,
      ruleFile, rule, priorBatchFiles,
      codeHashScope: "selected-assay-extractor-ancestry-replay-schema-runner-metrics-files;not-complete-dependency-closure",
      sourceCodeRevision: prepared[0].plan.sourceCodeRevision, codeFilesBefore,
      sources: prepared.map((p) => p.plan), environments, runs, reciprocalPairs,
      postExecutionRevalidated: false,
      execution: { requested: options.execute, maxSeconds: options.maxSeconds, maxRuns: options.maxRuns,
        runOffset: options.runOffset, runCount: 70, controlCount: 20, competitionCount: 50,
        soloLifecycleCapture: "compact-in-situ-trace-analysis-pending",
        contrast: "late-vs-early-log-relative-B-growth-at-3000-if-both-survive",
        claim: "equal-frequency-genotype-only-feasibility" },
      runtime: { startedAt, elapsedSeconds: 0, overrun: false, denoVersion: Deno.version.deno,
        os: Deno.build.os, arch: Deno.build.arch, adapter: null } };
    await persist();
    const recheck = async () => {
      check("recheck inputs");
      if (!sameDigest(await digestFile(options.inputs, check), manifest!.inputsFile) ||
          !sameDigest(await digestFile(inputs.rule, check), manifest!.ruleFile))
        throw new Error("input or rule changed after plan creation");
      for (const prior of manifest!.priorBatchFiles)
        if (!sameDigest(await digestFile(prior.path, check), prior.digest))
          throw new Error(`prior batch changed: ${prior.path}`);
      for (let i = 0; i < 5; i++) {
        const p = prepared[i], path = inputs.sources[i], digests = await sourceDigests(path.source, check);
        if (!same(digests, p.plan.sourceFiles) ||
            !sameDigest(await digestFile(join(path.cache, "manifest.json"), check), p.plan.cacheManifestFile) ||
            !sameDigest(await digestFile(path.catalog, check), p.plan.catalogFile))
          throw new Error(`source/cache/catalog ${i + 1} changed after plan creation`);
        await verifyReplayCache({ read: (name) => Deno.readFile(join(path.cache, name)) }, p.cache.source);
      }
      manifest!.codeFilesAfter = await codeDigests(projectRoot, allReplayFiles, check);
      if (!same(manifest!.codeFilesAfter, manifest!.codeFilesBefore))
        throw new Error("competition implementation changed after plan creation");
    };
    await recheck();
    await persist();
    if (!options.execute) { await persist(true);
      console.log(JSON.stringify({ status: "planned", sources: 5, controls: 20, reciprocalRuns: 50,
        out: options.out, gpuStarted: false })); return; }
    const endIndex = Math.min(70, options.runOffset + options.maxRuns!);
    if (!manifest.runs.some((r) => r.ordinal >= options.runOffset && r.ordinal < endIndex && r.status === "planned")) {
      for (const run of manifest.runs) if (run.status === "planned") run.status = "not-run-batch";
      manifest.status = "partial";
      await persist(true);
      console.log(JSON.stringify({ status: "partial", completed: 0, unavailableInBatch: true,
        out: options.out, gpuStarted: false }));
      return;
    }
    manifest.status = "running"; await persist();
    check("before GPU request");
    const acquired = await acquire(navigator.gpu, environmentStates.values().next().value!.cfg);
    device = acquired.device; manifest.runtime!.adapter = acquired.info;
    const adapterLabel = [acquired.info.description, acquired.info.device, acquired.info.vendor,
      acquired.info.architecture].find(Boolean) ?? "adapter-info-empty";
    const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterLabel };
    const updatePairs = () => {
      for (const pair of manifest!.reciprocalPairs) {
        const left = manifest!.runs.find((r) => r.id === `${pair.environmentId}/left`)!,
          right = manifest!.runs.find((r) => r.id === `${pair.environmentId}/right`)!;
        const l = left.status === "complete" ? left : priorCompleted.get(left.ordinal);
        const r = right.status === "complete" ? right : priorCompleted.get(right.ordinal);
        if (!l?.outcome || !r?.outcome) continue;
        const a = l.outcome.relativeGrowth, b = r.outcome.relativeGrowth;
        if (!a || !b) throw new Error(`reciprocal pair ${pair.environmentId} lacks growth classification`);
        pair.status = "complete"; pair.leftSurvival = a.survival; pair.rightSurvival = b.survival;
        pair.leftLogRelativeGrowth = a.logRelativeGrowth; pair.rightLogRelativeGrowth = b.logRelativeGrowth;
        pair.meanLogRelativeGrowth = a.logRelativeGrowth !== null && b.logRelativeGrowth !== null ?
          (a.logRelativeGrowth + b.logRelativeGrowth) / 2 : null;
        pair.leftSampledKernelHaloOpportunity = l.outcome.anyKernelHaloOpportunity;
        pair.rightSampledKernelHaloOpportunity = r.outcome.anyKernelHaloOpportunity;
        pair.leftSampledAdjacency = l.outcome.anyAdjacency;
        pair.rightSampledAdjacency = r.outcome.anyAdjacency;
        pair.exposureLimited = !pair.leftSampledKernelHaloOpportunity || !pair.rightSampledKernelHaloOpportunity;
      }
    };
    for (const run of manifest.runs) {
      if (run.status === "not-run-unavailable") continue;
      if (run.ordinal < options.runOffset || run.ordinal >= endIndex) { run.status = "not-run-batch"; continue; }
      check(`before run ${run.ordinal}`);
      run.status = "running"; await persist();
      let sink: AssaySink | undefined;
      const life = run.kind === "solo-control" ? new GardenLifeCapture() : null;
      try {
        const donor = prepared.find((p) => p.plan.worldId === run.worldId)!;
        const spec = competitionSpec(donor.cache.source.spec, run.seed);
        const plannedHash = run.initialPhysicsHash, plannedAudits = run.transplantAudits;
        const start = createStart(run);
        if (stateHash(start) !== plannedHash || !same(run.transplantAudits, plannedAudits))
          throw new Error("start or transplant audits differ from frozen plan");
        const initial = totalsOf(start.cfg, start.cells);
        sink = new AssaySink(initial.matter, initial.energy, check, life);
        const result = await runExperiment(device, spec, sink, host,
          () => check(`run ${run.ordinal} progress`), { start: cloneState(start), keepFinal: true });
        check(`after run ${run.ordinal}`);
        if (!result.final || result.final.step !== COMPETITION_STEPS) throw new Error("run incomplete");
        const points = sink.points();
        if (!result.summary.conservationOk || points.some((p) => !p.conservationOk || p.mutations !== 0))
          throw new Error("run violated matter/energy closure or mutation-off protocol");
        const last = points.at(-1)!;
        const relativeGrowth = run.kind === "reciprocal-competition" ?
          relativeGrowthContrast(BigInt(run.initialEarlyB!), BigInt(run.initialLateB!),
            BigInt(last.earlyB), BigInt(last.lateB)) : null;
        run.points = points;
        if (life) run.gardenLifeTrace = life.trace(true);
        run.outcome = { finalPhysicsHash: stateHash(result.final), finalArtifactHash: artifactDigest(result.final, result.observer),
          wallSeconds: result.summary.wallSeconds, finalEarlyB: last.earlyB, finalLateB: last.lateB,
          survived: BigInt(last.earlyB) > 0n || BigInt(last.lateB) > 0n,
          anyKernelHaloOpportunity: points.some((p) => p.kernelHalosOverlap),
          anyAdjacency: points.some((p) => p.adjacent), relativeGrowth };
        run.status = "complete";
        updatePairs();
        await persist();
      } catch (error) {
        run.status = error instanceof CompetitionTimeCapError ? "incomplete-time-cap" : "failed";
        run.failure = message(error);
        if (life) {
          try { run.gardenLifeTrace = life.trace(false); }
          catch (traceError) { run.failure += `; lifecycle trace: ${message(traceError)}`; }
        }
        if (error instanceof CompetitionTimeCapError && sink) {
          try { run.points = sink.points(false); } catch { /* incomplete rows retained where possible */ }
        }
        await persist(); throw error;
      }
    }
    await recheck();
    manifest.postExecutionRevalidated = true;
    manifest.status = "partial"; // batches never claim all 70 were run
    await persist(true);
    console.log(JSON.stringify({ status: manifest.status, completed: manifest.runs.filter((r) => r.status === "complete").length,
      out: options.out, claim: manifest.execution.claim }));
  } catch (error) {
    if (reserved) {
      if (manifest) { manifest.status = error instanceof CompetitionTimeCapError ? "partial" : "failed";
        manifest.failure = message(error); await persist(true); }
      else await Deno.writeTextFile(join(options.out, "failure.json"), JSON.stringify({ status: "failed", failure: message(error),
        startedAt, endedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - started) / 1000 }, null, 2));
    }
    throw error;
  } finally { device?.destroy(); }
}

if (import.meta.main) main().catch((error) => { console.error(message(error)); Deno.exitCode = 1; });
