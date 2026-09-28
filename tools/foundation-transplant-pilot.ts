// Bounded feasibility pilot. Default writes a plan only; GPU work requires --execute,
// --max-seconds <= 600, and --max-candidates. Never resumes or overwrites an output.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CH, G, GENOME_CHANNELS, M3_FOUNDERS, M3_FOUNDER_SET, allocState, artifactDigest, buildWorld, cellCount,
  cloneState, founderGenome, ledgerResidual, stateHash, totalsOf, validateState,
  type WorldConfig, type WorldState,
} from "@bl/schema";
import { census, individuals } from "@bl/metrics";
import { decodeArtifact, runExperiment, sameConfig, specConfig, type RunResult, type RunSpec, type Sink } from "@bl/runner";
import { EXTRACTOR_SOURCE_FILES, catalogAtTime, validateExtractionRule, type ExtractionCatalog, type ExtractionRule } from "./lib/foundation-extract.ts";
import { OBSERVATION_FILES, ObservationHashSink, sha256, sourceIdentity, verifyReplayCache,
  type FileDigest, type ReplayCacheManifest } from "./lib/foundation-replay.ts";
import { exciseCellPacket, extractCellPacket, restoreCellPacket, transplantCellPacket,
  type CellPacket, type ToroidalPlacement } from "./lib/foundation-transplant.ts";

export const PILOT_SOURCE_RUN = "m4/gradient-m3/treatment/seed-1";
export const PILOT_STEPS = [100_000, 500_000, 900_000] as const;
export const SHAM_HORIZON = 500;
export const GARDEN_HORIZON = 3_000;
export const FIRST_GARDEN_SEED = 630_000_101;
export const CONTROL_GARDEN_SEED = 630_000_201;
export const CONTROL_FOUNDER_INDEX = 9;
export const GARDEN_OVERRIDES = { mutRate: 0, lightMode: "uniform" as const,
  lightBase: 40, lightAmp: 160, seasonAmp: 0 };
const MOT_NEUTRAL = 128 | (128 << 8);
const CODE_FILES = [
  "tools/foundation-transplant-pilot.ts", "tools/lib/foundation-transplant.ts",
  "tools/lib/foundation-extract.ts", "tools/lib/foundation-replay.ts",
  "packages/schema/src/accounting.ts", "packages/schema/src/layout.ts", "packages/schema/src/world.ts",
  "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts",
  "packages/runner/src/runner.ts", "packages/runner/src/observe.ts",
] as const;

export interface PilotOptions {
  source: string; cache: string; catalog: string; rule: string; out: string;
  execute: boolean; maxSeconds: number | null; maxCandidates: number | null;
}
export function parsePilotArgs(args: string[]): PilotOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!args[i].startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid or duplicate option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  for (const key of values.keys())
    if (!["--source", "--cache", "--catalog", "--rule", "--out", "--max-seconds", "--max-candidates"].includes(key))
      throw new Error(`unknown option ${key}`);
  for (const key of ["--source", "--cache", "--catalog", "--rule", "--out"])
    if (!values.get(key)) throw new Error(`${key} is required`);
  const maxSeconds = values.has("--max-seconds") ? Number(values.get("--max-seconds")) : null;
  const maxCandidates = values.has("--max-candidates") ? Number(values.get("--max-candidates")) : null;
  if (maxSeconds !== null && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("--max-seconds must be finite, positive and at most 600");
  if (maxCandidates !== null && (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 18))
    throw new Error("--max-candidates must be an integer in 1..18");
  if (execute && (maxSeconds === null || maxCandidates === null))
    throw new Error("--execute requires --max-seconds <=600 and --max-candidates");
  return { source: values.get("--source")!, cache: values.get("--cache")!, catalog: values.get("--catalog")!,
    rule: values.get("--rule")!, out: values.get("--out")!, execute, maxSeconds, maxCandidates };
}

export interface CandidatePlan {
  ordinal: number; step: number; componentIdx: number; sourceTile: number; cellIndices: number[];
  gardenSeed: number; focalLineage: "0:1";
  status: "planned" | "running" | "complete" | "failed" | "incomplete-time-cap" |
    "not-run-limit" | "not-run-sham" | "not-run-control" | "not-run-time-cap" | "not-run-protocol";
  packetSha256?: string;
  packetCellCount?: number;
  packetInventory?: CellPacket["inventory"];
  placement?: ToroidalPlacement;
  transplantAudit?: ReturnType<typeof transplantCellPacket>["audit"];
  census?: CensusPoint[];
  result?: GardenResult;
  failure?: string;
}
export interface GardenResult {
  finalPhysicsHash: string; finalArtifactHash: string; conservationOk: boolean;
  survived: boolean; positiveGrowth: boolean; polymerAtFinalThreeCensuses: boolean; growthWithLatePolymer: boolean;
  wallSeconds: number;
}
export interface ControlPlan {
  label: "m3-founder-9" | "zero-controller";
  role: "garden-feasibility-comparator" | "passive-controller-reference";
  founderSetId: string; founderGenomeIndex: 9; gardenSeed: number; focalLineage: "0:1";
  geometry: { x: 128; y: 128; radius: 10; biomass: 64; energy: 128; nutrient: 32 };
  initialPhysicsHash?: string; initialInventory?: { matter: string; energy: string };
  status: "planned" | "running" | "complete" | "failed" | "incomplete-time-cap" |
    "not-run-sham" | "not-run-time-cap" | "not-run-control";
  census?: CensusPoint[]; result?: GardenResult; failure?: string;
}
export interface ShamPlan {
  step: number; componentIndices: number[];
  status: "planned" | "running" | "matched" | "failed" | "incomplete-time-cap";
  controlPhysicsHash?: string; restoredPhysicsHash?: string;
  controlArtifactHash?: string; restoredArtifactHash?: string;
  conservationOk?: boolean; observationHashesMatched?: boolean; failure?: string;
}
export interface CensusPoint {
  step: number; livingCells: number; focalBiomassCells: number;
  focalB: string; focalP: string; focalBoundMass: string; membraneFraction: number | null;
  components: number; fissions: number; fusions: number; buddings: number; mutations: number;
  births: number; deaths: number; fissionEvents: number; fusionEvents: number; buddingEvents: number;
  matterResidual: string; energyResidual: string; conservationOk: boolean;
}
export interface PilotManifest {
  format: 1; status: "planned" | "running" | "complete" | "partial" | "failed";
  createdAt: string; sourceRunId: string; sourceFiles: Record<string, FileDigest>;
  sourceFilesAfter?: Record<string, FileDigest>;
  cacheFinalArtifactHash: string; catalogFile: FileDigest; catalogFileAfter?: FileDigest;
  ruleFile: FileDigest; ruleFileAfter?: FileDigest;
  codeFilesBefore: Record<string, FileDigest>; codeFilesAfter?: Record<string, FileDigest>;
  sourceCodeRevision: string; sourceCheckpointHashes: { step: number; file: string; sha256: string }[];
  execution: { requested: boolean; maxSeconds: number | null; maxCandidates: number | null;
    shamHorizon: 500; gardenHorizon: 3000; gardenCensusEvery: 100;
    gardenOverrides: typeof GARDEN_OVERRIDES; nutrientPerCell: 32; neutralAmbientMOT: number;
    selectedPopulation: 18; controlPopulation: 2; claim: "persistence-feasibility-only" };
  runtime?: { startedAt: string; endedAt?: string; elapsedSeconds: number; overrun: boolean;
    denoVersion: string; os: string; arch: string;
    adapter: { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null };
  shams: ShamPlan[]; controls: ControlPlan[]; candidates: CandidatePlan[];
  failure?: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameWords = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((value, i) => value === b[i]);
const digestEqual = (a: FileDigest | undefined, b: FileDigest | undefined) => !!a && !!b && a.sha256 === b.sha256 && a.bytes === b.bytes;
const failMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export class PilotTimeCapError extends Error {}
export const interruptedCandidateStatus = (error: unknown): CandidatePlan["status"] =>
  error instanceof PilotTimeCapError ? "incomplete-time-cap" : "failed";

/** A deliberately source-specific pilot: missing rows are failures, never a smaller denominator. */
export function planPilot(cache: ReplayCacheManifest, catalog: ExtractionCatalog, rule: ExtractionRule,
  sourceFiles: Record<string, FileDigest>, catalogFile: FileDigest, ruleFile: FileDigest,
  codeFiles: Record<string, FileDigest>, execute: boolean, maxSeconds: number | null, maxCandidates: number | null): PilotManifest {
  validateExtractionRule(rule);
  if (execute && (maxSeconds === null || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600 ||
      maxCandidates === null || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 18))
    throw new Error("execution requires a <=600 second cap and candidate cap in 1..18");
  if (cache.source.finalHashMode !== "artifact") throw new Error("pilot requires an artifact-authenticated source terminal hash");
  if (cache.status !== "verified" || !cache.final?.matchedSource || cache.observerCompatible !== true ||
      cache.source.runId !== PILOT_SOURCE_RUN || !same(cache.requestedSteps, PILOT_STEPS) ||
      cache.source.spec.presetId !== "gradient-m3" || cache.source.spec.condition !== "treatment" || cache.source.spec.seed !== 1)
    throw new Error("pilot requires the verified, observer-compatible gradient-m3 treatment seed-1 cache at exact times");
  if (catalog.format !== 1 || catalog.status !== "catalog-only" || catalog.usable !== true ||
      catalog.observerCompatible !== true || catalog.sourceRunId !== cache.source.runId ||
      catalog.cacheFinalArtifactHash !== cache.final.artifactHash || !same(catalog.rule, rule) ||
      catalog.ruleFileSha256 !== ruleFile.sha256 || !same(catalog.provenance.sourceSpec, cache.source.spec) ||
      catalog.provenance.sourceCodeRevision !== cache.source.codeRevision ||
      catalog.provenance.sourcePresetIdentity !== cache.source.presetIdentity ||
      !same(catalog.provenance.sourceVersions, cache.source.versions) || catalog.times.length !== 3)
    throw new Error("catalog, source, rule or replay identities disagree");
  for (const name of ["manifest.json", ...OBSERVATION_FILES])
    if (!digestEqual(sourceFiles[name], cache.source.files[name]) || !digestEqual(catalog.sourceFiles[name], sourceFiles[name]))
      throw new Error(`original source file ${name} differs from cache/catalog`);
  for (const name of EXTRACTOR_SOURCE_FILES)
    if (!digestEqual(catalog.provenance.extractorFiles[name], codeFiles[name]))
      throw new Error(`catalog extractor code identity changed: ${name}`);
  if (cache.source.spec.steps !== 1_000_000 || cache.source.spec.censusEvery !== 100 ||
      cache.source.spec.deepEvery !== 10 || cache.source.spec.checkpointEvery !== 0)
    throw new Error("original source cadence/horizon differs from frozen pilot");
  const shams: ShamPlan[] = [], candidates: CandidatePlan[] = [];
  for (let t = 0; t < 3; t++) {
    const time = catalog.times[t], cp = cache.checkpoints[t];
    if (time.step !== PILOT_STEPS[t] || cp.step !== time.step || time.checkpointFile !== cp.file ||
        time.checkpointSha256 !== cp.fileDigest.sha256 || time.configuration.tileW !== 256 ||
        time.configuration.tileH !== 256 || time.configuration.tilesX !== 1 || time.configuration.tilesY !== 1)
      throw new Error(`catalog checkpoint/geometry mismatch at time ${t}`);
    const selected = time.components.filter((c) => c.selected).sort((a, b) => a.idx - b.idx);
    if (selected.length !== 6 || selected.some((c) => c.reasons.length || c.tile !== 0 || !c.cellIndices.length))
      throw new Error(`expected exactly six clean selected components at ${time.step}`);
    shams.push({ step: time.step, componentIndices: selected.map((c) => c.idx), status: "planned" });
    for (const component of selected) candidates.push({ ordinal: candidates.length, step: time.step,
      componentIdx: component.idx, sourceTile: component.tile, cellIndices: [...component.cellIndices],
      gardenSeed: FIRST_GARDEN_SEED + candidates.length, focalLineage: "0:1", status: "planned" });
  }
  if (candidates.length !== 18) throw new Error("pilot denominator must contain all 18 selected components");
  const geometry = { x: 128, y: 128, radius: 10, biomass: 64, energy: 128, nutrient: 32 } as const;
  const controls: ControlPlan[] = [
    { label: "m3-founder-9", role: "garden-feasibility-comparator", founderSetId: M3_FOUNDER_SET,
      founderGenomeIndex: CONTROL_FOUNDER_INDEX, gardenSeed: CONTROL_GARDEN_SEED,
      focalLineage: "0:1", geometry, status: "planned" },
    { label: "zero-controller", role: "passive-controller-reference", founderSetId: M3_FOUNDER_SET,
      founderGenomeIndex: CONTROL_FOUNDER_INDEX, gardenSeed: CONTROL_GARDEN_SEED,
      focalLineage: "0:1", geometry, status: "planned" },
  ];
  return { format: 1, status: "planned", createdAt: new Date().toISOString(), sourceRunId: cache.source.runId,
    sourceFiles, cacheFinalArtifactHash: cache.final.artifactHash, catalogFile, ruleFile, codeFilesBefore: codeFiles,
    sourceCodeRevision: cache.source.codeRevision,
    sourceCheckpointHashes: cache.checkpoints.map((cp) => ({ step: cp.step, file: cp.file, sha256: cp.fileDigest.sha256 })),
    execution: { requested: execute, maxSeconds, maxCandidates, shamHorizon: 500, gardenHorizon: 3000,
      gardenCensusEvery: 100, gardenOverrides: GARDEN_OVERRIDES, nutrientPerCell: 32,
      neutralAmbientMOT: MOT_NEUTRAL, selectedPopulation: 18, controlPopulation: 2,
      claim: "persistence-feasibility-only" }, shams, controls, candidates };
}

/** Final shams compare intact-world continuations only; they cannot certify fresh-garden viability. */
export function assertShamMatch(control: RunResult, restored: RunResult,
  controlFiles: Record<string, FileDigest>, restoredFiles: Record<string, FileDigest>, expectedStep: number): {
    controlPhysicsHash: string; restoredPhysicsHash: string; controlArtifactHash: string; restoredArtifactHash: string;
    conservationOk: true; observationHashesMatched: true;
  } {
  if (!control.final || !restored.final || control.final.step !== expectedStep || restored.final.step !== expectedStep ||
      !control.summary.conservationOk || !restored.summary.conservationOk)
    throw new Error("mechanical sham continuation incomplete or nonconserving");
  const ch = stateHash(control.final), rh = stateHash(restored.final);
  const ca = artifactDigest(control.final, control.observer), ra = artifactDigest(restored.final, restored.observer);
  if (ch !== rh || ca !== ra || OBSERVATION_FILES.some((name) => !digestEqual(controlFiles[name], restoredFiles[name])))
    throw new Error("mechanical sham continuation mismatch");
  return { controlPhysicsHash: ch, restoredPhysicsHash: rh, controlArtifactHash: ca, restoredArtifactHash: ra,
    conservationOk: true, observationHashesMatched: true };
}

/** One checkpoint snapshot, keyed only to the relabelled focal lineage; no resident organisms are introduced. */
export function focalSnapshot(state: WorldState, initialMatter: bigint, initialEnergy: bigint): Pick<CensusPoint,
  "step" | "livingCells" | "focalBiomassCells" | "focalB" | "focalP" | "focalBoundMass" |
  "membraneFraction" | "components" | "matterResidual" | "energyResidual"> {
  const n = cellCount(state.cfg);
  let B = 0n, P = 0n, focalBiomassCells = 0;
  for (let i = 0; i < n; i++) {
    if (state.genome[G.LIN_HI * n + i] !== 0 || state.genome[G.LIN_LO * n + i] !== 1) continue;
    const b = state.cells[CH.B * n + i], p = state.cells[CH.P * n + i];
    B += BigInt(b); P += BigInt(p);
    if (b > 0) focalBiomassCells++;
  }
  const c = census({ cfg: state.cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
  const matterResidual = totalsOf(state.cfg, state.cells).matter - initialMatter;
  const energyResidual = ledgerResidual({ energy: initialEnergy }, state);
  return { step: state.step, livingCells: c.livingCells, focalBiomassCells,
    focalB: String(B), focalP: String(P), focalBoundMass: String(B + P),
    membraneFraction: B + P > 0n ? Number(P) / Number(B + P) : null,
    components: individuals(c).filter((component) => component.lineage === "0:1").length,
    matterResidual: String(matterResidual), energyResidual: String(energyResidual) };
}

/** Only a complete 30-census window receives a biological persistence classification. */
export function classifyCandidateOutcome(initialB: string, points: readonly Pick<CensusPoint, "step" | "focalB" | "focalP">[]): {
  survived: boolean; positiveGrowth: boolean; polymerAtFinalThreeCensuses: boolean; growthWithLatePolymer: boolean;
} {
  if (points.length !== GARDEN_HORIZON / 100 || points.some((point, i) => point.step !== (i + 1) * 100))
    throw new Error("incomplete census window cannot be classified");
  const last = points.at(-1)!;
  const positiveGrowth = BigInt(last.focalB) > BigInt(initialB);
  const polymerAtFinalThreeCensuses = points.slice(-3).every((point) => BigInt(point.focalP) > 0n);
  return { survived: BigInt(last.focalB) > 0n, positiveGrowth, polymerAtFinalThreeCensuses,
    growthWithLatePolymer: positiveGrowth && polymerAtFinalThreeCensuses };
}

export function gardenSpec(source: ReplayCacheManifest["source"], seed: number): RunSpec {
  const spec: RunSpec = { experiment: "foundation-persistence", presetId: source.spec.presetId,
    condition: source.spec.condition, seed, steps: GARDEN_HORIZON, censusEvery: 100, deepEvery: 10,
    checkpointEvery: 100, overrides: GARDEN_OVERRIDES };
  const expected = { ...specConfig(source.spec), seed, ...GARDEN_OVERRIDES };
  if (!sameConfig(specConfig(spec), expected)) throw new Error("fresh garden differs from source configuration plus registered overrides");
  return spec;
}

export function freshGarden(spec: RunSpec): WorldState {
  const state = allocState(specConfig(spec));
  const n = cellCount(state.cfg);
  state.cells.fill(32, CH.A * n, (CH.A + 1) * n);
  state.cells.fill(MOT_NEUTRAL, CH.MOT * n, (CH.MOT + 1) * n);
  return state;
}

/** Evaluator-disc founder and a clone with only the 160 controller weights zeroed. */
export function founderControlStates(source: ReplayCacheManifest["source"]): {
  spec: RunSpec; founder: WorldState; zeroController: WorldState;
} {
  const founder = M3_FOUNDERS[CONTROL_FOUNDER_INDEX];
  if (!founder) throw new Error("registered M3 founder 9 is missing");
  const spec = gardenSpec(source, CONTROL_GARDEN_SEED);
  const state = buildWorld(specConfig(spec), { nutrient: 32, founders: [{
    x: 128, y: 128, radius: Math.floor(64 / 6), genome: founderGenome(founder), biomass: 64, energy: 128,
  }] });
  const zeroController = cloneState(state);
  const n = cellCount(state.cfg);
  for (let g = G.W0; g < GENOME_CHANNELS; g++) zeroController.genome.fill(0, g * n, (g + 1) * n);
  if (!sameWords(state.cells, zeroController.cells) || state.lightIn !== zeroController.lightIn ||
      state.heatOut !== zeroController.heatOut || !same(state.flux.map(String), zeroController.flux.map(String)))
    throw new Error("controller reference changed physical initial state");
  for (let g = 0; g < G.W0; g++)
    if (!sameWords(state.genome.subarray(g * n, (g + 1) * n), zeroController.genome.subarray(g * n, (g + 1) * n)))
      throw new Error("controller reference changed lineage or non-controller parameters");
  const errors = validateState(zeroController);
  if (errors.length) throw new Error(`invalid zero-controller initial state: ${errors.join("; ")}`);
  return { spec, founder: state, zeroController };
}

/** Lowest source index is the registered anchor, mapped to the geometric centre (128,128). */
export function centredPlacement(packet: CellPacket): ToroidalPlacement {
  const anchor = packet.cells[0].sourceIndex;
  const width = packet.sourceWorldW;
  return { sourceTileX: 0, sourceTileY: 0, destinationTileX: 0, destinationTileY: 0,
    shiftX: Math.floor(width / 2) - anchor % width,
    shiftY: Math.floor(packet.sourceWorldH / 2) - Math.floor(anchor / width) };
}

class PilotSink implements Sink {
  readonly series = new Map<number, Record<string, unknown>>();
  readonly events = new Map<number, Record<string, number>>();
  readonly snapshots = new Map<number, ReturnType<typeof focalSnapshot>>();
  constructor(readonly initialMatter: bigint, readonly initialEnergy: bigint, readonly checkBudget: (stage: string) => void) {}
  async writeText(): Promise<void> { /* each run has a fresh sink; only streamed rows matter */ }
  async appendText(name: string, value: string): Promise<void> {
    this.checkBudget(`reading ${name}`);
    if (name !== "series.jsonl" && name !== "life.jsonl") return;
    for (const line of value.split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const step = row.step as number;
      if (name === "series.jsonl") this.series.set(step, row);
      else {
        const counts = this.events.get(step) ?? {};
        const kind = String(row.kind);
        counts[kind] = (counts[kind] ?? 0) + 1;
        this.events.set(step, counts);
      }
    }
  }
  async writeBytes(name: string, bytes: Uint8Array): Promise<void> {
    this.checkBudget(`decoding ${name}`);
    const { state } = decodeArtifact(bytes);
    this.snapshots.set(state.step, focalSnapshot(state, this.initialMatter, this.initialEnergy));
  }
  points(requireComplete = true): CensusPoint[] {
    const points: CensusPoint[] = [];
    for (let step = 100; step <= GARDEN_HORIZON; step += 100) {
      const snap = this.snapshots.get(step), series = this.series.get(step), events = this.events.get(step) ?? {};
      if (!snap || !series || series.step !== step) {
        if (requireComplete) throw new Error(`missing census/checkpoint at step ${step}`);
        break;
      }
      const number = (key: string) => {
        const value = series[key];
        if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid ${key} in series at ${step}`);
        return value as number;
      };
      const conservationOk = series.conservationOk === true && snap.matterResidual === "0" && snap.energyResidual === "0";
      points.push({ ...snap, fissions: number("fissions"), fusions: number("fusions"),
        buddings: number("buddings"), mutations: number("mutations"),
        births: events.birth ?? 0, deaths: events.death ?? 0, fissionEvents: events.fission ?? 0,
        fusionEvents: events.fusion ?? 0, buddingEvents: events.budding ?? 0, conservationOk });
    }
    return points;
  }
  partialPoints(): CensusPoint[] { return this.points(false); }
}

async function digestFile(path: string, checkBudget: (stage: string) => void): Promise<FileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const chunk of file.readable) {
    checkBudget(`hashing ${path}`);
    hash.update(chunk); bytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function localCodeFiles(root: string, checkBudget: (stage: string) => void): Promise<Record<string, FileDigest>> {
  const result: Record<string, FileDigest> = {};
  for (const name of CODE_FILES) result[name] = await digestFile(join(root, name), checkBudget);
  for (const name of EXTRACTOR_SOURCE_FILES) if (!result[name]) result[name] = await digestFile(join(root, name), checkBudget);
  return result;
}

async function sourceFileDigests(sourceDir: string, checkBudget: (stage: string) => void): Promise<Record<string, FileDigest>> {
  const result: Record<string, FileDigest> = {};
  for (const name of ["manifest.json", ...OBSERVATION_FILES]) result[name] = await digestFile(join(sourceDir, name), checkBudget);
  return result;
}

async function writeManifest(out: string, manifest: PilotManifest): Promise<void> {
  await Deno.writeTextFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/** Acquire the device from the very adapter whose identity is recorded. */
async function acquirePilotDevice(gpu: GPU, cfg: WorldConfig): Promise<{ device: GPUDevice; adapter: NonNullable<PilotManifest["runtime"]>["adapter"] }> {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo; requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("WebGPU adapter identity unavailable");
  const need = cellCount(cfg) * GENOME_CHANNELS * 4;
  const aStorage = adapter.limits.maxStorageBufferBindingSize, aBuffer = adapter.limits.maxBufferSize;
  if (need > aStorage || need > aBuffer)
    throw new Error(`world needs ${need} bytes per buffer; adapter allows ${Math.min(aStorage, aBuffer)}`);
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: aStorage, maxBufferSize: aBuffer,
    maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
  }, requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, adapter: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}

async function main() {
  const options = parsePilotArgs(Deno.args);
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const checkBudget = (stage: string) => {
    if (options.maxSeconds !== null && (performance.now() - started) / 1000 > options.maxSeconds)
      throw new PilotTimeCapError(`pilot time cap ${options.maxSeconds}s exceeded at ${stage}`);
  };
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let reserved = false;
  let manifest: PilotManifest | undefined;
  let persist: ((ended?: boolean) => Promise<void>) | undefined;
  let device: GPUDevice | undefined;
  try {
    await Deno.mkdir(options.out); // atomic create-new reservation, before any GPU work
    reserved = true;
    const store = { read: (name: string) => Deno.readFile(join(options.cache, name)) };
    const cache = await verifyReplayCache(store);
    checkBudget("after cache verification");
    const sourceFiles = await sourceFileDigests(options.source, checkBudget);
    const catalogBytes = await Deno.readFile(options.catalog), ruleBytes = await Deno.readFile(options.rule);
    const catalog = JSON.parse(text(catalogBytes)) as ExtractionCatalog;
    const rule = JSON.parse(text(ruleBytes)) as ExtractionRule;
    const selectedCodeFiles = await localCodeFiles(projectRoot, checkBudget);
    const replayCode: Record<string, FileDigest> = {};
    for (const name of Object.keys(cache.source.replayCodeFiles)) replayCode[name] = await digestFile(join(projectRoot, name), checkBudget);
    const codeFiles = { ...replayCode, ...selectedCodeFiles };
    const sourceManifest = JSON.parse(text(await Deno.readFile(join(options.source, "manifest.json"))));
    const currentSource = sourceIdentity(sourceManifest, sourceFiles, cache.source.finalHashMode,
      cache.source.codeRevision, replayCode);
    if (!same(currentSource, cache.source)) throw new Error("original source or replay implementation changed");
    manifest = planPilot(cache, catalog, rule, sourceFiles, sha256(catalogBytes), sha256(ruleBytes),
      codeFiles, options.execute, options.maxSeconds, options.maxCandidates);
    manifest.runtime = { startedAt, elapsedSeconds: 0, overrun: false,
      denoVersion: Deno.version.deno, os: Deno.build.os, arch: Deno.build.arch, adapter: null };
    persist = async (ended = false) => {
      const elapsed = (performance.now() - started) / 1000;
      manifest!.runtime!.elapsedSeconds = elapsed;
      manifest!.runtime!.overrun = options.maxSeconds !== null && elapsed > options.maxSeconds;
      if (ended) manifest!.runtime!.endedAt = new Date().toISOString();
      await writeManifest(options.out, manifest!);
    };
    await persist(); // all 18 seed assignments are fixed before device request
    const recheckInputs = async () => {
      const after = { ...Object.fromEntries(await Promise.all(Object.keys(cache.source.replayCodeFiles).map(async (name) =>
        [name, await digestFile(join(projectRoot, name), checkBudget)] as const))),
        ...await localCodeFiles(projectRoot, checkBudget) };
      manifest!.codeFilesAfter = after;
      if (!same(after, manifest!.codeFilesBefore)) throw new Error("pilot implementation changed during preparation/execution");
      const currentFiles = await sourceFileDigests(options.source, checkBudget);
      manifest!.sourceFilesAfter = currentFiles;
      manifest!.catalogFileAfter = await digestFile(options.catalog, checkBudget);
      manifest!.ruleFileAfter = await digestFile(options.rule, checkBudget);
      if (!same(currentFiles, manifest!.sourceFiles) || !digestEqual(manifest!.catalogFileAfter, manifest!.catalogFile) ||
          !digestEqual(manifest!.ruleFileAfter, manifest!.ruleFile))
        throw new Error("source/catalog/rule changed during preparation/execution");
      await verifyReplayCache(store);
    };
    const checkpointData = new Map<number, ReturnType<typeof decodeArtifact>>();
    const packets = new Map<string, CellPacket>();
    for (let t = 0; t < cache.checkpoints.length; t++) {
      checkBudget(`before checkpoint ${t}`);
      const cp = cache.checkpoints[t];
      const bytes = await store.read(cp.file);
      if (!digestEqual(sha256(bytes), cp.fileDigest)) throw new Error(`checkpoint changed: ${cp.file}`);
      const decoded = decodeArtifact(bytes);
      const recomputed = catalogAtTime(decoded.state, decoded.observer, cp.file, cp.fileDigest.sha256, true, rule);
      if (!same(recomputed, catalog.times[t])) throw new Error(`catalog content differs from census at ${cp.step}`);
      checkpointData.set(cp.step, decoded);
      for (const candidate of manifest.candidates.filter((c) => c.step === cp.step)) {
        const packet = extractCellPacket(decoded.state, candidate.cellIndices);
        const component = catalog.times[t].components.find((c) => c.idx === candidate.componentIdx);
        if (!component || !same(component.cellIndices, packet.cells.map((cell) => cell.sourceIndex)) ||
            component.matter !== packet.inventory.matter || component.energy !== packet.inventory.energy)
          throw new Error(`packet/catalog inventory mismatch at ${candidate.step}/${candidate.componentIdx}`);
        candidate.packetSha256 = packet.sha256;
        candidate.packetCellCount = packet.cells.length;
        candidate.packetInventory = packet.inventory;
        packets.set(`${candidate.step}:${candidate.componentIdx}`, packet);
        const restored = restoreCellPacket(exciseCellPacket(decoded.state, packet), packet);
        if (stateHash(restored) !== stateHash(decoded.state) || !sameWords(restored.cells, decoded.state.cells) ||
            !sameWords(restored.genome, decoded.state.genome) || restored.lightIn !== decoded.state.lightIn ||
            restored.heatOut !== decoded.state.heatOut || !same(restored.flux.map(String), decoded.state.flux.map(String)))
          throw new Error(`exact packet restore failed at ${candidate.step}/${candidate.componentIdx}`);
        const spec = gardenSpec(cache.source, candidate.gardenSeed);
        const placement = centredPlacement(packet);
        const from = { hi: packet.cells[0].genome[G.LIN_HI], lo: packet.cells[0].genome[G.LIN_LO] };
        const placed = transplantCellPacket(freshGarden(spec), packet, placement, [{ from, to: { hi: 0, lo: 1 } }]);
        candidate.placement = placement;
        candidate.transplantAudit = placed.audit;
      }
    }
    const controlStates = founderControlStates(cache.source);
    for (const control of manifest.controls) {
      const initialState = control.label === "m3-founder-9" ? controlStates.founder : controlStates.zeroController;
      const inventory = totalsOf(initialState.cfg, initialState.cells);
      control.initialPhysicsHash = stateHash(initialState);
      control.initialInventory = { matter: String(inventory.matter), energy: String(inventory.energy) };
    }
    if (!same(manifest.controls[0].initialInventory, manifest.controls[1].initialInventory))
      throw new Error("control initial resources differ");
    await recheckInputs();
    checkBudget("before plan publication");
    await persist();
    if (!options.execute) {
      await persist(true);
      console.log(JSON.stringify({ status: manifest.status, controls: manifest.controls.length, candidates: manifest.candidates.length,
        checkpoints: manifest.shams.length, out: options.out, gpuStarted: false }));
      return;
    }
    manifest.status = "running";
    await persist();
    checkBudget("before GPU request");
    const acquired = await acquirePilotDevice(navigator.gpu, checkpointData.get(PILOT_STEPS[0])!.state.cfg);
    device = acquired.device;
    manifest.runtime!.adapter = acquired.adapter;
    checkBudget("after GPU request");
    const adapterLabel = [acquired.adapter?.description, acquired.adapter?.device,
      acquired.adapter?.vendor, acquired.adapter?.architecture].find((value) => !!value) ?? "adapter-info-empty";
    const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterLabel };
    for (const sham of manifest.shams) {
      checkBudget(`before sham ${sham.step}`);
      sham.status = "running"; await persist();
      try {
        const original = checkpointData.get(sham.step)!;
        const firstPacket = packets.get(`${sham.step}:${sham.componentIndices[0]}`)!;
        const restoredStart = restoreCellPacket(exciseCellPacket(original.state, firstPacket), firstPacket);
        const spec = { ...cache.source.spec, steps: SHAM_HORIZON, checkpointEvery: 0 };
        const controlSink = new ObservationHashSink(), restoredSink = new ObservationHashSink();
        const control = await runExperiment(device, spec, controlSink, host,
          () => checkBudget(`control sham ${sham.step}`),
          { start: cloneState(original.state), observer: structuredClone(original.observer), keepFinal: true });
        checkBudget(`after control sham ${sham.step}`);
        const restored = await runExperiment(device, spec, restoredSink, host,
          () => checkBudget(`restored sham ${sham.step}`),
          { start: restoredStart, observer: structuredClone(original.observer), keepFinal: true });
        const matched = assertShamMatch(control, restored, controlSink.digest(), restoredSink.digest(), sham.step + SHAM_HORIZON);
        Object.assign(sham, matched, { status: "matched" });
        await persist();
      } catch (error) {
        sham.status = error instanceof PilotTimeCapError ? "incomplete-time-cap" : "failed";
        sham.failure = failMessage(error);
        await persist();
        throw error;
      }
    }
    for (const control of manifest.controls) {
      checkBudget(`before control ${control.label}`);
      control.status = "running"; await persist();
      let sink: PilotSink | undefined;
      try {
        const initialState = control.label === "m3-founder-9" ? controlStates.founder : controlStates.zeroController;
        if (stateHash(initialState) !== control.initialPhysicsHash)
          throw new Error(`control ${control.label} initial state differs from published plan`);
        const initial = totalsOf(initialState.cfg, initialState.cells);
        sink = new PilotSink(initial.matter, initial.energy, checkBudget);
        const result = await runExperiment(device, controlStates.spec, sink, host,
          () => checkBudget(`control ${control.label} progress`), { start: cloneState(initialState), keepFinal: true });
        checkBudget(`after control ${control.label}`);
        if (!result.final || result.final.step !== GARDEN_HORIZON) throw new Error(`control ${control.label} did not reach horizon`);
        const points = sink.points();
        if (!result.summary.conservationOk || points.some((p) => !p.conservationOk || p.mutations !== 0))
          throw new Error(`control ${control.label} violated matter/energy closure or mutation-off protocol`);
        const first = focalSnapshot(initialState, initial.matter, initial.energy);
        control.census = points;
        control.result = { finalPhysicsHash: stateHash(result.final),
          finalArtifactHash: artifactDigest(result.final, result.observer), conservationOk: true,
          ...classifyCandidateOutcome(first.focalB, points), wallSeconds: result.summary.wallSeconds };
        control.status = "complete";
        await persist();
      } catch (error) {
        control.status = error instanceof PilotTimeCapError ? "incomplete-time-cap" : "failed";
        control.failure = failMessage(error);
        if (error instanceof PilotTimeCapError && sink) {
          try { control.census = sink.partialPoints(); }
          catch (partialError) { control.failure += `; partial census read: ${failMessage(partialError)}`; }
        }
        await persist();
        throw error;
      }
    }
    for (const candidate of manifest.candidates) {
      if (candidate.ordinal >= options.maxCandidates!) { candidate.status = "not-run-limit"; continue; }
      checkBudget(`before candidate ${candidate.ordinal}`);
      candidate.status = "running"; await persist();
      let sink: PilotSink | undefined;
      try {
        const packet = packets.get(`${candidate.step}:${candidate.componentIdx}`)!;
        const spec = gardenSpec(cache.source, candidate.gardenSeed);
        const bare = freshGarden(spec);
        const placement = centredPlacement(packet);
        const sourceId = { hi: packet.cells[0].genome[G.LIN_HI], lo: packet.cells[0].genome[G.LIN_LO] };
        const transplant = transplantCellPacket(bare, packet, placement, [{ from: sourceId, to: { hi: 0, lo: 1 } }]);
        if (!same(candidate.placement, placement) || !same(candidate.transplantAudit, transplant.audit))
          throw new Error("candidate transplant differs from pre-GPU plan");
        await persist();
        const initial = totalsOf(transplant.state.cfg, transplant.state.cells);
        sink = new PilotSink(initial.matter, initial.energy, checkBudget);
        const result = await runExperiment(device, spec, sink, host,
          () => checkBudget(`candidate ${candidate.ordinal} progress`), { start: transplant.state, keepFinal: true });
        checkBudget(`after candidate ${candidate.ordinal}`);
        if (!result.final || result.final.step !== GARDEN_HORIZON) throw new Error("candidate did not reach horizon");
        const points = sink.points();
        if (!result.summary.conservationOk || points.some((p) => !p.conservationOk || p.mutations !== 0))
          throw new Error("candidate violated matter/energy closure or mutation-off protocol");
        const first = focalSnapshot(transplant.state, initial.matter, initial.energy);
        const outcome = classifyCandidateOutcome(first.focalB, points);
        candidate.census = points;
        candidate.result = { finalPhysicsHash: stateHash(result.final),
          finalArtifactHash: artifactDigest(result.final, result.observer), conservationOk: true,
          ...outcome,
          wallSeconds: result.summary.wallSeconds };
        candidate.status = "complete";
      } catch (error) {
        candidate.status = interruptedCandidateStatus(error);
        candidate.failure = failMessage(error);
        if (error instanceof PilotTimeCapError && sink) {
          try { candidate.census = sink.partialPoints(); }
          catch (partialError) { candidate.failure += `; partial census read: ${failMessage(partialError)}`; }
        }
        await persist();
        if (error instanceof PilotTimeCapError) throw error;
      }
      await persist();
    }
    await recheckInputs();
    checkBudget("before final publication");
    manifest.status = manifest.controls.every((c) => c.status === "complete") &&
      manifest.candidates.every((c) => c.status === "complete") ? "complete" : "partial";
    await persist(true);
    console.log(JSON.stringify({ status: manifest.status,
      controlsCompleted: manifest.controls.filter((c) => c.status === "complete").length,
      candidatesCompleted: manifest.candidates.filter((c) => c.status === "complete").length,
      selected: 18, out: options.out, claim: manifest.execution.claim }));
  } catch (error) {
    if (reserved) {
      if (manifest) {
        const timedOut = error instanceof PilotTimeCapError;
        manifest.status = timedOut && manifest.shams.every((s) => s.status === "matched") ? "partial" : "failed";
        manifest.failure = failMessage(error);
        const shamBlocked = manifest.shams.some((s) => s.status !== "matched");
        const controlBlocked = !shamBlocked && manifest.controls.some((c) => c.status === "failed" || c.status === "running");
        for (const control of manifest.controls) if (control.status === "planned")
          control.status = shamBlocked ? "not-run-sham" : timedOut ? "not-run-time-cap" : "not-run-control";
        for (const candidate of manifest.candidates) if (candidate.status === "planned")
          candidate.status = shamBlocked ? "not-run-sham" : timedOut ? "not-run-time-cap" :
            controlBlocked ? "not-run-control" : "not-run-protocol";
        if (persist) await persist(true); else await writeManifest(options.out, manifest);
      } else await Deno.writeTextFile(join(options.out, "failure.json"), JSON.stringify({ status: "failed", failure: failMessage(error),
        runtime: { startedAt, endedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - started) / 1000,
          overrun: error instanceof PilotTimeCapError, denoVersion: Deno.version.deno, os: Deno.build.os, arch: Deno.build.arch } }, null, 2));
    }
    throw error;
  } finally { device?.destroy(); }
}

if (import.meta.main) main().catch((error) => {
  console.error(failMessage(error));
  Deno.exitCode = 1;
});
