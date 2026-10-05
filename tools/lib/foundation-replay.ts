/** Authenticated, single-pass checkpoint extraction. Host I/O and GPU creation are injected. */
import { createHash } from "node:crypto";
import { METRICS_VERSION, PRESETS, SCHEMA_VERSION, isSupportedRuleVersion, artifactDigest, encodeCheckpoint, initWorld, presetIdentity, stateHash, type WorldState } from "@bl/schema";
import { continuationError, decodeArtifact, runId, sameConfig, specConfig, type ObserverState, type RunResult, type RunSpec, type Sink } from "@bl/runner";

export const OBSERVATION_FILES = ["series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv", "life.jsonl", "activity-final.json"] as const;
export type ObservationFile = typeof OBSERVATION_FILES[number];
export type FinalHashMode = "artifact" | "physics";
export type FileDigest = { sha256: string; bytes: number };

export function parseMaxSeconds(value: string | undefined): number {
  if (value === undefined) return 2700;
  if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error("--max-seconds must be a finite positive number");
  return Number(value);
}

export interface SourceManifest {
  runId: string;
  spec: RunSpec;
  cfg: WorldState["cfg"];
  init: unknown;
  initHash: string;
  presetIdentity: string;
  schemaVersion: number;
  ruleVersion: number;
  metricsVersion: number;
  startStep: number;
  checkpoints: unknown[];
  summary: { steps: number; finalHash: string; conservationOk: boolean };
}

export interface SourceIdentity {
  runId: string;
  spec: RunSpec;
  presetIdentity: string;
  versions: { schema: number; rule: number; metrics: number };
  finalHash: string;
  finalHashMode: FinalHashMode;
  files: Record<string, FileDigest>;
  codeRevision: string;
  /** Hashes of the exact local source files used for replay; original code revision is operator supplied. */
  replayCodeFiles: Record<string, FileDigest>;
}

export interface CachedCheckpoint {
  step: number;
  file: string;
  fileDigest: FileDigest;
  physicsHash: string;
  artifactHash: string;
}

export interface ReplayCacheManifest {
  format: 1;
  status: "pending" | "verified" | "failed";
  source: SourceIdentity;
  requestedSteps: number[];
  checkpoints: CachedCheckpoint[];
  final?: CachedCheckpoint & { matchedSource: boolean };
  observationComparison?: Record<ObservationFile, { original: FileDigest; replay: FileDigest; matched: boolean }>;
  observerCompatible: boolean | null;
  runMetadata?: { maxSeconds: number; startedAt: string; host: string; adapter: { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null };
  timing?: { wallSeconds: number; segmentSeconds: number[] };
  failure?: string;
}

export interface ReplayStore {
  /** Must create a wholly new directory atomically and fail if it exists. */
  reserve(): Promise<void>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array>;
}

export type ReplaySegment = (spec: RunSpec, sink: Sink, start?: WorldState, observer?: ObserverState) => Promise<RunResult>;

export function sha256(bytes: Uint8Array): FileDigest {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

const equalDigest = (a: FileDigest | undefined, b: FileDigest | undefined) => !!a && !!b && a.bytes === b.bytes && a.sha256 === b.sha256;
const requireDigest = (d: FileDigest | undefined, name: string) => {
  if (!d || !/^[a-f0-9]{64}$/.test(d.sha256) || !Number.isSafeInteger(d.bytes) || d.bytes < 0) throw new Error(`${name}: SHA-256/length missing`);
};

/** Source checks precede output reservation and GPU acquisition. */
export function sourceIdentity(
  m: SourceManifest,
  files: Record<string, FileDigest>,
  finalHashMode: FinalHashMode,
  codeRevision: string,
  replayCodeFiles: Record<string, FileDigest>,
): SourceIdentity {
  if (finalHashMode !== "artifact" && finalHashMode !== "physics") throw new Error("final hash mode must be explicit");
  if (!codeRevision.trim()) throw new Error("source code revision required");
  // A source runs under its own config's rule (rule 1 for every historical preset), which this code must support.
  if (!isSupportedRuleVersion(m.ruleVersion) || m.cfg?.ruleVersion !== m.ruleVersion || m.schemaVersion !== SCHEMA_VERSION || m.metricsVersion !== METRICS_VERSION)
    throw new Error("source rule/schema/metrics version differs from replay code");
  if (m.startStep !== 0 || !m.summary?.conservationOk || m.summary.steps !== m.spec?.steps || !/^[a-f0-9]{16}$/.test(m.summary.finalHash))
    throw new Error("source is not a complete conserved history with a terminal hash");
  if (m.spec.metapopulation || m.spec.overrides && Object.keys(m.spec.overrides).length)
    throw new Error("metapopulation/overridden sources require a separate reconstruction protocol");
  const preset = PRESETS.find((p) => p.id === m.spec.presetId);
  if (!preset || m.presetIdentity !== presetIdentity(preset) || JSON.stringify(m.init) !== JSON.stringify(preset.init))
    throw new Error("source preset or founder identity differs from replay code");
  if (m.runId !== runId(m.spec) || !sameConfig(m.cfg, specConfig(m.spec))) throw new Error("source run/config identity mismatch");
  if (m.initHash !== stateHash(initWorld(m.cfg, preset.init))) throw new Error("source initial physics identity mismatch");
  if (!Array.isArray(m.checkpoints)) throw new Error("source checkpoint inventory missing");
  for (const name of ["manifest.json", ...OBSERVATION_FILES]) requireDigest(files[name], `source ${name}`);
  if (!Object.keys(replayCodeFiles).length) throw new Error("replay code file identities missing");
  for (const [name, digest] of Object.entries(replayCodeFiles)) requireDigest(digest, `code ${name}`);
  return {
    runId: m.runId, spec: m.spec, presetIdentity: m.presetIdentity,
    versions: { schema: m.schemaVersion, rule: m.ruleVersion, metrics: m.metricsVersion },
    finalHash: m.summary.finalHash, finalHashMode, files, codeRevision, replayCodeFiles,
  };
}

export function replayBoundaries(spec: RunSpec, requested: number[]): number[] {
  if (!requested.length || new Set(requested).size !== requested.length ||
      requested.some((s) => !Number.isSafeInteger(s) || s <= 0 || s >= spec.steps || s % spec.censusEvery !== 0))
    throw new Error("requested samples must be unique interior census-compatible steps");
  if (!Number.isSafeInteger(spec.steps) || spec.steps <= 0 || !Number.isSafeInteger(spec.censusEvery) || spec.censusEvery <= 0)
    throw new Error("invalid source horizon/census cadence");
  return [...requested].sort((a, b) => a - b).concat(spec.steps);
}

/** Hashes observation output as the runner writes, without copying large TSV/JSONL files. */
export class ObservationHashSink implements Sink {
  private phase = 0;
  private hashes = Object.fromEntries(OBSERVATION_FILES.map((name) => [name, createHash("sha256")])) as Record<ObservationFile, ReturnType<typeof createHash>>;
  private sizes = Object.fromEntries(OBSERVATION_FILES.map((name) => [name, 0])) as Record<ObservationFile, number>;

  nextSegment(): void {
    this.phase++;
    this.hashes["activity-final.json"] = createHash("sha256");
    this.sizes["activity-final.json"] = 0;
  }
  async writeText(name: string, value: string): Promise<void> {
    if (!(OBSERVATION_FILES as readonly string[]).includes(name)) return;
    const file = name as ObservationFile;
    if (file !== "activity-final.json" && this.phase > 0) return; // runner repeats headers per segment
    this.hashes[file].update(value);
    this.sizes[file] += Buffer.byteLength(value);
  }
  async appendText(name: string, value: string): Promise<void> {
    if (!(OBSERVATION_FILES as readonly string[]).includes(name)) return;
    const file = name as ObservationFile;
    this.hashes[file].update(value);
    this.sizes[file] += Buffer.byteLength(value);
  }
  async writeBytes(): Promise<void> { /* Source checkpointEvery is forced to zero. */ }
  digest(): Record<ObservationFile, FileDigest> {
    return Object.fromEntries(OBSERVATION_FILES.map((name) => [name, { sha256: this.hashes[name].digest("hex"), bytes: this.sizes[name] }])) as Record<ObservationFile, FileDigest>;
  }
}

const manifestBytes = (m: ReplayCacheManifest) => new TextEncoder().encode(JSON.stringify(m, null, 2));

/** All checkpoints remain pending until the uninterrupted final digest matches the source. */
export async function buildReplayCache(
  store: ReplayStore,
  source: SourceIdentity,
  requested: number[],
  acquireSegmentRunner: () => Promise<ReplaySegment>,
  assertSourceStillCurrent: () => Promise<void> = async () => {},
  checkBudget: (stage: string) => void = () => {},
  runMetadata?: ReplayCacheManifest["runMetadata"],
): Promise<ReplayCacheManifest> {
  checkBudget("before output reservation");
  const boundaries = replayBoundaries(source.spec, requested);
  const manifest: ReplayCacheManifest = {
    format: 1, status: "pending", source, requestedSteps: boundaries.slice(0, -1), checkpoints: [], observerCompatible: null, runMetadata,
  };
  await store.reserve(); // must happen before GPU acquisition
  await store.write("manifest.json", manifestBytes(manifest));
  const began = performance.now();
  const segmentSeconds: number[] = [];
  try {
    checkBudget("before GPU acquisition");
    const segment = await acquireSegmentRunner();
    checkBudget("after GPU acquisition");
    const sink = new ObservationHashSink();
    let start: WorldState | undefined;
    let observer: ObserverState | undefined;
    let previous = 0;
    for (const boundary of boundaries) {
      checkBudget(`before segment ending ${boundary}`);
      const spec: RunSpec = { ...source.spec, steps: boundary - previous, checkpointEvery: 0 };
      const result = await segment(spec, sink, start, observer);
      checkBudget(`after segment ending ${boundary}`);
      if (!result.final || result.final.step !== boundary || result.observer.step !== boundary)
        throw new Error(`replay segment did not finish at step ${boundary}`);
      if (!result.summary.conservationOk || result.summary.finalHash !== artifactDigest(result.final, result.observer))
        throw new Error(`replay segment at step ${boundary} failed conservation or artifact validation`);
      segmentSeconds.push(result.summary.wallSeconds);
      start = result.final;
      observer = result.observer;
      const bytes = encodeCheckpoint(start, observer);
      const file = boundary === source.spec.steps
        ? `terminal/t${String(boundary).padStart(9, "0")}.blck`
        : `checkpoints/t${String(boundary).padStart(9, "0")}.blck`;
      await store.write(file, bytes);
      const entry = { step: boundary, file, fileDigest: sha256(bytes), physicsHash: stateHash(start), artifactHash: artifactDigest(start, observer) };
      if (boundary === source.spec.steps) {
        manifest.final = { ...entry, matchedSource: false };
      } else {
        manifest.checkpoints.push(entry);
      }
      await store.write("manifest.json", manifestBytes(manifest));
      previous = boundary;
      if (boundary !== source.spec.steps) sink.nextSegment();
    }
    const finalPhysics = stateHash(start!);
    const finalArtifact = artifactDigest(start!, observer!);
    const match = (source.finalHashMode === "artifact" ? finalArtifact : finalPhysics) === source.finalHash;
    manifest.final!.matchedSource = match;
    if (!match) throw new Error(`terminal ${source.finalHashMode} digest mismatch: source ${source.finalHash}, replay ${source.finalHashMode === "artifact" ? finalArtifact : finalPhysics}`);
    checkBudget("before source revalidation");
    await assertSourceStillCurrent();
    checkBudget("after source revalidation");
    // Read back from the actual store before publishing a verified manifest.
    for (const p of [...manifest.checkpoints, manifest.final!]) {
      const bytes = await store.read(p.file);
      if (!equalDigest(sha256(bytes), p.fileDigest)) throw new Error(`${p.file}: cached bytes failed readback`);
      const decoded = decodeArtifact(bytes);
      if (decoded.state.step !== p.step || stateHash(decoded.state) !== p.physicsHash || artifactDigest(decoded.state, decoded.observer) !== p.artifactHash)
        throw new Error(`${p.file}: cached checkpoint failed readback identity`);
      const contextError = continuationError(source.spec, decoded.state, decoded.observer);
      if (contextError) throw new Error(`${p.file}: ${contextError}`);
    }
    const replayObservations = sink.digest();
    manifest.observationComparison = Object.fromEntries(OBSERVATION_FILES.map((name) => [name, {
      original: source.files[name], replay: replayObservations[name], matched: equalDigest(source.files[name], replayObservations[name]),
    }])) as ReplayCacheManifest["observationComparison"];
    manifest.observerCompatible = OBSERVATION_FILES.every((name) => manifest.observationComparison![name].matched);
    checkBudget("before verified publication");
    manifest.timing = { wallSeconds: (performance.now() - began) / 1000, segmentSeconds };
    manifest.status = "verified";
    await store.write("manifest.json", manifestBytes(manifest));
    return manifest;
  } catch (error) {
    manifest.status = "failed";
    manifest.timing = { wallSeconds: (performance.now() - began) / 1000, segmentSeconds };
    manifest.failure = error instanceof Error ? error.message : String(error);
    await store.write("manifest.json", manifestBytes(manifest));
    throw error;
  }
}

/** Re-read every file and decode every checkpoint, so corruption and truncation invalidate the cache. */
export async function verifyReplayCache(store: Pick<ReplayStore, "read">, expectedSource?: SourceIdentity): Promise<ReplayCacheManifest> {
  const m = JSON.parse(new TextDecoder().decode(await store.read("manifest.json"))) as ReplayCacheManifest;
  if (m.format !== 1 || m.status !== "verified" || !m.final?.matchedSource) throw new Error("cache is not verified");
  if (expectedSource && JSON.stringify(m.source) !== JSON.stringify(expectedSource))
    throw new Error("cache source identity mismatch");
  if ((m.source.finalHashMode === "artifact" ? m.final.artifactHash : m.final.physicsHash) !== m.source.finalHash)
    throw new Error("cache terminal digest does not match source");
  if (!m.observationComparison || OBSERVATION_FILES.some((name) =>
    !equalDigest(m.observationComparison![name]?.original, m.source.files[name]) ||
    m.observationComparison![name].matched !== equalDigest(m.observationComparison![name].original, m.observationComparison![name].replay)))
    throw new Error("cache observation comparison inconsistent");
  if (m.observerCompatible !== OBSERVATION_FILES.every((name) => m.observationComparison![name].matched))
    throw new Error("cache observer compatibility inconsistent");
  const boundaries = replayBoundaries(m.source.spec, m.requestedSteps);
  if (m.checkpoints.length !== m.requestedSteps.length || boundaries.slice(0, -1).some((s, i) => s !== m.requestedSteps[i]))
    throw new Error("cache checkpoint inventory incomplete or unordered");
  if (m.final.step !== m.source.spec.steps || m.final.file !== `terminal/t${String(m.final.step).padStart(9, "0")}.blck`)
    throw new Error("cache terminal step/path mismatch");
  for (let i = 0; i < m.checkpoints.length + 1; i++) {
    const p = i === m.checkpoints.length ? m.final : m.checkpoints[i];
    if (i < m.checkpoints.length && (p.step !== m.requestedSteps[i] || p.file !== `checkpoints/t${String(p.step).padStart(9, "0")}.blck`))
      throw new Error("cache checkpoint path/step mismatch");
    const bytes = await store.read(p.file);
    if (!equalDigest(sha256(bytes), p.fileDigest)) throw new Error(`${p.file}: SHA-256/length mismatch`);
    const { state, observer } = decodeArtifact(bytes);
    if (state.step !== p.step || stateHash(state) !== p.physicsHash || artifactDigest(state, observer) !== p.artifactHash)
      throw new Error(`${p.file}: decoded checkpoint identity mismatch`);
    const contextError = continuationError(m.source.spec, state, observer);
    if (contextError) throw new Error(`${p.file}: ${contextError}`);
  }
  return m;
}
