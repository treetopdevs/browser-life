// Prospective, bounded serial-transfer feasibility pilot. Plans are CPU-only by default.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CH, G, GENOME_CHANNELS, FLUX_NAMES, M3_FOUNDER_SET, artifactDigest, cellCount, cloneState,
  stateHash, totalsOf, type WorldState } from "@bl/schema";
import { decodeArtifact, runExperiment, type RunResult, type Sink } from "@bl/runner";
import { GpuSim } from "@bl/sim-gpu";
import { catalogAtTime, EXTRACTOR_SOURCE_FILES, validateExtractionRule,
  type ExtractionCatalog, type ExtractionRule } from "./lib/foundation-extract.ts";
import { rankCatalogSelection } from "./lib/foundation-competition.ts";
import { OBSERVATION_FILES, ObservationHashSink, sha256, verifyReplayCache,
  type FileDigest, type ReplayCacheManifest } from "./lib/foundation-replay.ts";
import { runReferenceReplay, type ReferenceResult } from "./lib/foundation-sensitivity.ts";
import { SERIAL_SELECTION_SALT, SerialGardenCapture,
  type SerialCaptureIdentity, type SerialCaptureResult } from "./lib/foundation-serial-capture.ts";
import { SERIAL_CATALOG_SHA256, SERIAL_RANK0_COMPONENT, SERIAL_RANK0_KEY, SERIAL_RULE_SHA256,
  SERIAL_SEEDS, SERIAL_SOURCE_RUN, prepareSerialStart, serialSpec, stageArms,
  boundIncorporationAccounting, type SerialArm, type SerialInventory, type SerialStage,
  type SerialStart } from "./lib/foundation-serial-transfer.ts";
import { assertShamMatch, planPilot } from "./foundation-transplant-pilot.ts";
import { exciseCellPacket, extractCellPacket, restoreCellPacket, validateCellPacket,
  type CellPacket } from "./lib/foundation-transplant.ts";

export interface SerialOptions { source: string; cache: string; catalog: string; rule: string;
  out: string; stage: SerialStage; priors: string[]; execute: boolean; maxSeconds: number | null }
export function parseSerialArgs(args: string[]): SerialOptions {
  const values = new Map<string, string>(); let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("duplicate --execute"); execute = true; continue; }
    if (!["--source", "--cache", "--catalog", "--rule", "--out", "--stage", "--prior-manifests", "--max-seconds"]
      .includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid or duplicate option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  for (const key of ["--source", "--cache", "--catalog", "--rule", "--out", "--stage"])
    if (!values.get(key)) throw new Error(`${key} is required`);
  const stage = Number(values.get("--stage"));
  if (![0, 1, 2].includes(stage)) throw new Error("--stage must be 0, 1 or 2");
  const priors = values.has("--prior-manifests") ? values.get("--prior-manifests")!.split(",") : [];
  if (priors.length !== stage || priors.some((p) => !p.trim()) ||
      new Set(priors.map((p) => resolve(p))).size !== priors.length)
    throw new Error(`stage ${stage} requires exactly ${stage} distinct ordered prior manifests`);
  const maxSeconds = values.has("--max-seconds") ? Number(values.get("--max-seconds")) : null;
  if (maxSeconds !== null && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600))
    throw new Error("--max-seconds must be finite, positive and <=600");
  if (execute && maxSeconds === null) throw new Error("--execute requires --max-seconds <=600");
  return { source: resolve(values.get("--source")!), cache: resolve(values.get("--cache")!),
    catalog: resolve(values.get("--catalog")!), rule: resolve(values.get("--rule")!),
    out: resolve(values.get("--out")!), stage: stage as SerialStage,
    priors: priors.map((p) => resolve(p)), execute, maxSeconds };
}

type RowStatus = "planned" | "running" | "complete" | "not-run-unavailable" | "incomplete-time-cap" | "failed";
export interface SerialRow {
  arm: SerialArm; cycle: SerialStage; seed: number; status: RowStatus;
  gardenId: string; importedFragment: SerialCaptureIdentity["importedFragment"] | null;
  unavailableReason?: string; sourcePacket: CellPacket | null;
  inoculumSha256?: string; inoculumInventory?: CellPacket["inventory"];
  initialStateHash?: string; initialMatter?: string; initialEnergy?: string;
  initialInventory?: SerialInventory;
  placement?: SerialStart["placement"]; transplantAudit?: SerialStart["transplantAudit"];
  pureRestoreMatched?: true;
  outcome?: { measuredPhysicsHash: string; measuredArtifactHash: string; wallSeconds: number;
    conservationOk: true; mutationCount: 0; observationFiles: Record<string, FileDigest>;
    finalInventory: SerialInventory; incorporatedBoundMatterLowerBound: string;
    series: Record<string, unknown>[];
    capture: SerialCaptureResult; selectedPacket: CellPacket | null;
    sham: ReturnType<typeof assertShamMatch>; reference: ReferenceResult };
  partialCapture?: SerialCaptureResult; failure?: string;
}
export interface SerialManifest {
  format: 1; status: "planned" | "running" | "complete" | "partial" | "failed";
  stage: SerialStage; createdAt: string; postExecutionRevalidated: boolean;
  inputPaths: { source: string; cache: string; catalog: string; rule: string };
  sourceFiles: Record<string, FileDigest>; cacheManifestFile: FileDigest;
  catalogFile: FileDigest; ruleFile: FileDigest; protocolFile: FileDigest;
  sourceRunId: typeof SERIAL_SOURCE_RUN; sourceCodeRevision: string;
  sourceFinalArtifactHash: string; sourceVersions: ReplayCacheManifest["source"]["versions"];
  sourceCheckpoint: { step: 900_000; file: string; sha256: string };
  donorSelection: { componentIdx: 53; selectionKey: typeof SERIAL_RANK0_KEY; packetSha256: string };
  founder: { setId: string; index: 9 };
  codeFilesBefore: Record<string, FileDigest>; codeFilesAfter?: Record<string, FileDigest>;
  planFile?: FileDigest;
  priorStageFiles: { path: string; digest: FileDigest; planDigest: FileDigest }[];
  execution: { requested: boolean; maxSeconds: number | null; gardenCount: number;
    seeds: typeof SERIAL_SEEDS; censusEvery: 25; coarseEvery: 100; horizon: 3000;
    claim: "one-source-serial-transfer-feasibility-only" };
  rows: SerialRow[];
  runtime?: { startedAt: string; endedAt?: string; elapsedSeconds: number; overrun: boolean;
    denoVersion: string; os: string; arch: string;
    adapter: { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null };
  failure?: string;
}

const CODE_FILES = ["tools/foundation-serial-transfer.ts", "tools/lib/foundation-serial-transfer.ts",
  "tools/lib/foundation-serial-capture.ts", "tools/lib/foundation-transplant.ts",
  "tools/foundation-transplant-pilot.ts", "tools/lib/foundation-extract.ts",
  "tools/lib/foundation-replay.ts", "tools/lib/foundation-competition.ts",
  "tools/lib/foundation-sensitivity.ts", "tools/lib/foundation-lifecycle.ts",
  "packages/schema/src/accounting.ts", "packages/schema/src/layout.ts", "packages/schema/src/world.ts",
  "packages/metrics/src/census.ts", "packages/metrics/src/tracker.ts",
  "packages/runner/src/runner.ts", "packages/runner/src/observe.ts",
  "packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const digestEqual = (a: FileDigest | undefined, b: FileDigest | undefined) =>
  !!a && !!b && a.sha256 === b.sha256 && a.bytes === b.bytes;
const gardenId = (stage: SerialStage, arm: SerialArm) =>
  `${SERIAL_SOURCE_RUN}/serial/${arm}/cycle-${stage}/seed-${SERIAL_SEEDS[stage]}`;
function transferEvidence(previous: SerialRow | undefined): SerialRow["importedFragment"] {
  const packet = previous?.outcome?.selectedPacket;
  if (!packet) return null;
  const capture = previous.outcome!.capture;
  const selectedRows = capture.candidates.filter((candidate) => candidate.disposition === "selected-packet-valid");
  const selected = selectedRows[0], root = capture.root.id25;
  const earlierEligible = capture.candidates.some((candidate) => candidate.topologyEligible &&
    candidate.step < (selected?.step ?? Infinity));
  const sameStepEligible = capture.candidates.filter((candidate) => candidate.topologyEligible &&
    candidate.step === selected?.step);
  const selectionKey = (candidate: typeof selected) => candidate && candidate.componentIndex !== null ?
    createHash("sha256").update(`${SERIAL_SELECTION_SALT}\n${SERIAL_SOURCE_RUN}\n${previous!.arm}\n` +
      `${previous!.cycle}\n${previous!.seed}\n${candidate.step}\n${candidate.childId}\n` +
      `${candidate.componentIndex}`).digest("hex") : null;
  const earlierRootHarm = root !== null && (
    capture.events25.some((event) => event.step <= (selected?.step ?? -1) &&
      (event.kind === "death" && event.id === root ||
        event.kind === "fusion" && (event.child === root || event.parents.includes(root)))) ||
    capture.overlapMixing25.some((mix) => mix.step <= (selected?.step ?? -1) &&
      (mix.currentId === root || mix.priorIds.includes(root))));
  const earlyChildHarm = selected !== undefined && (
    capture.events25.some((event) => event.step <= selected.step &&
      (event.kind === "death" && event.id === selected.childId ||
        event.kind === "fusion" && (event.child === selected.childId ||
          event.parents.includes(selected.childId)))) ||
    capture.overlapMixing25.some((mix) => mix.step <= selected.step &&
      (mix.currentId === selected.childId || mix.priorIds.includes(selected.childId))));
  if (selectedRows.length !== 1 || !selected || root === null ||
      capture.root.status !== "one-eligible" || capture.root.eligibleAtStep0 !== 1 ||
      selected.parentId !== root || selected.childId === root ||
      !selected.topologyEligible || selected.rejectionReasons.length !== 0 ||
      selected.mass === null || selected.mass < 256 || selected.componentIndex === null ||
      selected.step < 25 || selected.step > 1000 || selected.step % 25 !== 0 ||
      capture.selection.status !== "packet-valid" ||
      selected.step !== capture.selection.step || selected.childId !== capture.selection.childId ||
      selected.componentIndex !== capture.selection.componentIndex ||
      selected.selectionSha256 !== capture.selection.selectionSha256 ||
      selected.selectionSha256 !== selectionKey(selected) ||
      selected.packetSha256 !== packet.sha256 || selected.step !== packet.sourceStep ||
      !capture.events25.some((event) => event.kind === "fission" && event.step === selected.step &&
        event.parent === root && event.children.includes(selected.childId)) ||
      earlierEligible || earlierRootHarm || earlyChildHarm ||
      sameStepEligible.some((candidate) => candidate.selectionSha256 !== selectionKey(candidate) ||
        candidate.selectionSha256 === null || candidate.selectionSha256 < selected.selectionSha256!) ||
      capture.root.disqualifiedAt !== null && capture.root.disqualifiedAt <= selected.step ||
      ["death", "fusion", "overlap-mixed"].includes(capture.rootSourceFate.status) &&
        capture.rootSourceFate.step !== null && capture.rootSourceFate.step <= selected.step ||
      ["death", "fusion", "overlap-mixed"].includes(capture.selectedChildSourceFate.status) &&
        capture.selectedChildSourceFate.step !== null && capture.selectedChildSourceFate.step <= selected.step)
    throw new Error("serial selected source-child packet provenance missing");
  return { kind: "selected-observer-child", sourceGardenId: previous!.gardenId,
    sourceCycle: previous!.cycle as 0 | 1, sourceStep: selected.step,
    parentTrackerId: selected.parentId, childTrackerId: selected.childId,
    packetSha256: packet.sha256, ageSinceObservedFissionAtPlacement: 0 };
}
export class SerialTimeCapError extends Error {}

async function digestFile(path: string, check: (stage: string) => void): Promise<FileDigest> {
  const hash = createHash("sha256"); let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const chunk of file.readable) { check(`hash ${path}`); hash.update(chunk); bytes += chunk.byteLength; }
  return { sha256: hash.digest("hex"), bytes };
}
async function codeDigests(root: string, replayNames: string[], check: (stage: string) => void) {
  const out: Record<string, FileDigest> = {};
  for (const name of new Set([...CODE_FILES, ...EXTRACTOR_SOURCE_FILES, ...replayNames]))
    out[name] = await digestFile(join(root, name), check);
  return out;
}
async function sourceDigests(path: string, check: (stage: string) => void) {
  const out: Record<string, FileDigest> = {};
  for (const name of ["manifest.json", ...OBSERVATION_FILES]) out[name] = await digestFile(join(path, name), check);
  return out;
}

const FROZEN_MANIFEST_FIELDS = ["format", "stage", "createdAt", "inputPaths", "sourceFiles",
  "cacheManifestFile", "catalogFile", "ruleFile", "protocolFile", "sourceRunId",
  "sourceCodeRevision", "sourceFinalArtifactHash", "sourceVersions", "sourceCheckpoint",
  "donorSelection", "founder", "codeFilesBefore", "codeFilesAfter", "priorStageFiles", "execution"] as const;
const FROZEN_ROW_FIELDS = ["arm", "cycle", "seed", "gardenId", "importedFragment", "sourcePacket",
  "unavailableReason", "inoculumSha256", "inoculumInventory", "initialStateHash", "initialMatter",
  "initialEnergy", "initialInventory", "placement", "transplantAudit", "pureRestoreMatched"] as const;
export function validateFrozenSerialPlan(prior: SerialManifest, plan: SerialManifest,
  digest: FileDigest): void {
  if (!digestEqual(prior.planFile, digest) || plan.status !== "planned" || plan.postExecutionRevalidated ||
      plan.execution.requested !== true || plan.planFile !== undefined ||
      plan.rows.length !== prior.rows.length ||
      FROZEN_MANIFEST_FIELDS.some((key) => !same(plan[key], prior[key])) ||
      plan.rows.some((row, j) => FROZEN_ROW_FIELDS.some((key) => !same(row[key], prior.rows[j][key])) ||
        row.status === "planned" && prior.rows[j].status !== "complete" ||
        row.status === "not-run-unavailable" && prior.rows[j].status !== "not-run-unavailable" ||
        !["planned", "not-run-unavailable"].includes(row.status) || row.outcome || row.partialCapture))
    throw new Error("serial prior outcome differs from immutable pre-GPU plan");
}

/** Retain the runner's full interval records, including measured flux, without inventing activity outside its schedule. */
export function validateSerialSeriesRows(rows: readonly Record<string, unknown>[]): void {
  if (rows.length !== 120) throw new Error("serial garden lacks all 120 original census rows");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], pools = row.pools as Record<string, unknown> | undefined;
    const rates = row.rates as Record<string, unknown> | undefined;
    if (row.step !== 25 * (i + 1) || row.conservationOk !== true || row.mutations !== 0 ||
        !pools || typeof pools !== "object" || !rates || typeof rates !== "object" ||
        ["A", "B", "C", "P", "E", "S"].some((key) =>
          !Number.isSafeInteger(pools[key]) || (pools[key] as number) < 0) ||
        FLUX_NAMES.some((key) => typeof rates[key] !== "number" ||
          !Number.isFinite(rates[key]) || (rates[key] as number) < 0))
      throw new Error(`serial original census row ${i + 1} is missing or malformed`);
  }
}

function validateRowAccounting(row: SerialRow): void {
  const initial = row.initialInventory, inoculum = row.inoculumInventory, outcome = row.outcome;
  if (!initial || !inoculum || !outcome || initial.matter !== row.initialMatter ||
      initial.energy !== row.initialEnergy || outcome.finalInventory.matter !== initial.matter)
    throw new Error("serial initial/final resource accounting missing or nonconserving");
  for (const channel of ["B", "C", "P", "E", "S"] as const)
    if (initial[channel] !== inoculum[channel])
      throw new Error(`serial initial ${channel} exists outside selected inoculum`);
  const growth = BigInt(outcome.finalInventory.B) + BigInt(outcome.finalInventory.P) - BigInt(inoculum.matter);
  if (outcome.incorporatedBoundMatterLowerBound !== String(growth > 0n ? growth : 0n))
    throw new Error("serial bound-matter incorporation lower bound differs from inventories");
  validateSerialSeriesRows(outcome.series);
  const last = outcome.series.at(-1)!.pools as Record<string, number>;
  if (["A", "B", "C", "P", "E", "S"].some((channel) =>
      String(last[channel]) !== outcome.finalInventory[channel as keyof typeof outcome.finalInventory]))
    throw new Error("serial final pools disagree with original census row");
}

/** Only a finished, conserving, post-revalidated prior stage can supply a packet. */
export function validateSerialPriors(current: SerialManifest, priors: SerialManifest[],
  priorPlans: { manifest: SerialManifest; digest: FileDigest }[]): void {
  if (priors.length !== current.stage || priorPlans.length !== current.stage)
    throw new Error("serial stage prior count mismatch");
  for (let i = 0; i < priors.length; i++) {
    const prior = priors[i];
    validateFrozenSerialPlan(prior, priorPlans[i].manifest, priorPlans[i].digest);
    for (const row of prior.rows) if (row.status === "complete") validateRowAccounting(row);
    if (prior.stage !== i || prior.format !== 1 || prior.status !== "complete" ||
        prior.postExecutionRevalidated !== true || prior.execution.requested !== true ||
        !prior.runtime?.endedAt || prior.runtime.overrun ||
        prior.rows.some((r) => r.status === "complete") && !prior.runtime.adapter || prior.failure ||
        !prior.planFile || !same(prior.codeFilesBefore, prior.codeFilesAfter) ||
        !same(prior.codeFilesBefore, current.codeFilesBefore) ||
        !same(prior.sourceFiles, current.sourceFiles) ||
        !digestEqual(prior.cacheManifestFile, current.cacheManifestFile) ||
        !digestEqual(prior.catalogFile, current.catalogFile) ||
        !digestEqual(prior.ruleFile, current.ruleFile) ||
        !digestEqual(prior.protocolFile, current.protocolFile) ||
        prior.sourceFinalArtifactHash !== current.sourceFinalArtifactHash ||
        !same(prior.donorSelection, current.donorSelection) ||
        !same(prior.sourceCheckpoint, current.sourceCheckpoint) ||
        !same(prior.execution.seeds, SERIAL_SEEDS) || prior.execution.horizon !== 3000 ||
        prior.execution.censusEvery !== 25 || prior.execution.coarseEvery !== 100 ||
        prior.execution.gardenCount !== stageArms(i as SerialStage).length ||
        prior.rows.length !== stageArms(i as SerialStage).length ||
        prior.rows.some((row, j) => row.arm !== stageArms(i as SerialStage)[j] ||
          row.cycle !== i || row.seed !== SERIAL_SEEDS[i] ||
          row.gardenId !== gardenId(i as SerialStage, row.arm) ||
          !["complete", "not-run-unavailable"].includes(row.status) ||
          row.status === "complete" && i > 0 && (!row.sourcePacket ||
            row.importedFragment?.kind !== "selected-observer-child") ||
          row.status === "complete" && (!row.outcome?.conservationOk || row.outcome.mutationCount !== 0 ||
            !row.outcome.capture.complete || !row.outcome.reference.matchedMeasured ||
            row.outcome.reference.step !== 3000 ||
            row.outcome.reference.stateHash !== row.outcome.measuredPhysicsHash ||
            row.outcome.reference.drainedMutationEvents !== 0 ||
            row.outcome.reference.droppedMutationEvents !== 0 ||
            !row.outcome.sham.observationHashesMatched || !row.outcome.sham.conservationOk ||
            row.outcome.sham.controlPhysicsHash !== row.outcome.sham.restoredPhysicsHash ||
            row.outcome.sham.controlArtifactHash !== row.outcome.sham.restoredArtifactHash ||
            !row.pureRestoreMatched ||
            !row.initialStateHash || !row.inoculumSha256 ||
            !same(row.outcome.capture.identity,
              { sourceKey: SERIAL_SOURCE_RUN, arm: row.arm, cycle: i, seed: SERIAL_SEEDS[i],
                importedFragment: row.importedFragment }) ||
            row.outcome.capture.selection.status === "packet-valid" !== !!row.outcome.selectedPacket ||
            !!row.outcome.selectedPacket && (row.outcome.selectedPacket.sha256 !== row.outcome.capture.selection.packetSha256 ||
              row.outcome.selectedPacket.sourceStep !== row.outcome.capture.selection.step)) ||
          row.status === "not-run-unavailable" && (i === 0 || !!row.outcome || !!row.sourcePacket || !row.unavailableReason)))
      throw new Error(`serial prior stage ${i} lacks reusable post-execution evidence`);
    if (i === 0 && (prior.rows[0].sourcePacket?.sha256 !== current.donorSelection.packetSha256 ||
        prior.rows[1].sourcePacket || prior.rows[2].sourcePacket ||
        !same(prior.rows[0].importedFragment, { kind: "evolved-source-unknown-age" }) ||
        !same(prior.rows[1].importedFragment, { kind: "standard-founder-disc", founderIndex: 9 }) ||
        !same(prior.rows[2].importedFragment, { kind: "standard-founder-disc", founderIndex: 9 })))
      throw new Error("serial cycle-0 donor/control sources differ");
    if (i > 0) for (const row of prior.rows) {
      const previous = priors[i - 1].rows.find((r) => r.arm === row.arm);
      if (!same(row.sourcePacket, previous?.outcome?.selectedPacket ?? null) ||
          !same(row.importedFragment, transferEvidence(previous)))
        throw new Error(`serial stage ${i} packet chain differs for ${row.arm}`);
    }
    if (i > 0 && (!digestEqual(prior.priorStageFiles[i - 1]?.digest, current.priorStageFiles[i - 1]?.digest) ||
        !digestEqual(prior.priorStageFiles[i - 1]?.planDigest, current.priorStageFiles[i - 1]?.planDigest)))
      throw new Error(`serial prior stage ${i} chain differs`);
  }
  if (current.stage > 0) for (const row of current.rows) {
    const previous = priors[current.stage - 1].rows.find((r) => r.arm === row.arm);
    if (!same(row.sourcePacket, previous?.outcome?.selectedPacket ?? null) ||
        !same(row.importedFragment, transferEvidence(previous)) ||
        row.status === "not-run-unavailable" !== !row.sourcePacket)
      throw new Error(`serial current stage packet chain differs for ${row.arm}`);
  }
}

class SerialSink implements Sink {
  readonly observed = new ObservationHashSink();
  readonly capture: SerialGardenCapture;
  private series: Record<string, unknown>[] = [];
  constructor(initial: WorldState, arm: SerialArm, cycle: SerialStage, seed: number,
    importedFragment: SerialCaptureIdentity["importedFragment"],
    readonly check: (stage: string) => void) {
    this.capture = new SerialGardenCapture({ sourceKey: SERIAL_SOURCE_RUN, arm, cycle, seed, importedFragment });
    this.capture.observe(initial);
  }
  async writeText(name: string, content: string) { this.check(`write ${name}`); await this.observed.writeText(name, content); }
  async appendText(name: string, content: string) {
    this.check(`append ${name}`);
    await this.observed.appendText(name, content);
    if (name !== "series.jsonl") return;
    for (const line of content.split("\n")) if (line) {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (!Number.isSafeInteger(row.step) || row.conservationOk !== true ||
          !Number.isSafeInteger(row.mutations) || (row.mutations as number) !== 0)
        throw new Error(`serial census ${row.step} violated conservation or mutation-off protocol`);
      this.series.push(row);
    }
  }
  async writeBytes(name: string, bytes: Uint8Array) {
    this.check(`checkpoint ${name}`);
    const { state, observer } = decodeArtifact(bytes);
    if (observer.step !== state.step) throw new Error(`serial checkpoint observer step differs at ${name}`);
    this.capture.observe(state);
    await this.observed.writeBytes();
  }
  complete(): { capture: SerialCaptureResult; observationFiles: Record<string, FileDigest>;
    mutationCount: 0; series: Record<string, unknown>[] } {
    validateSerialSeriesRows(this.series);
    const capture = this.capture.result();
    if (!capture.complete || capture.censuses25.length !== 121 || capture.censuses100.length !== 31)
      throw new Error("serial assay-side capture incomplete");
    return { capture, observationFiles: this.observed.digest(), mutationCount: 0,
      series: this.series };
  }
  partial(): SerialCaptureResult { return this.capture.snapshot(); }
}

async function acquire(deviceRequest: GPU): Promise<{ device: GPUDevice; adapter: NonNullable<SerialManifest["runtime"]>["adapter"] }> {
  const adapter = await deviceRequest.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const identified = adapter as GPUAdapter & { info?: GPUAdapterInfo; requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
  const info = identified.info ?? await identified.requestAdapterInfo?.();
  if (!info) throw new Error("WebGPU adapter identity unavailable");
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has("timestamp-query") ? ["timestamp-query"] : [] });
  return { device, adapter: { vendor: info.vendor || null, architecture: info.architecture || null,
    device: info.device || null, description: info.description || null } };
}

async function main(): Promise<void> {
  const opt = parseSerialArgs(Deno.args), root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const started = performance.now(), startedAt = new Date().toISOString();
  const check = (stage: string) => { if (opt.maxSeconds !== null && (performance.now() - started) / 1000 > opt.maxSeconds)
    throw new SerialTimeCapError(`serial cap ${opt.maxSeconds}s exceeded at ${stage}`); };
  let reserved = false, manifest: SerialManifest | undefined, device: GPUDevice | undefined;
  const persist = async (end = false) => {
    if (!manifest) return;
    manifest.runtime!.elapsedSeconds = (performance.now() - started) / 1000;
    manifest.runtime!.overrun = opt.maxSeconds !== null && manifest.runtime!.elapsedSeconds > opt.maxSeconds;
    if (end) manifest.runtime!.endedAt = new Date().toISOString();
    await Deno.writeTextFile(join(opt.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  };
  try {
    await Deno.mkdir(opt.out); reserved = true;
    const cacheStore = { read: (name: string) => Deno.readFile(join(opt.cache, name)) };
    const cache = await verifyReplayCache(cacheStore);
    if (cache.source.finalHashMode !== "artifact" || cache.observerCompatible !== true ||
        cache.source.runId !== SERIAL_SOURCE_RUN || !same(cache.requestedSteps, [100_000, 500_000, 900_000]))
      throw new Error("serial source is not the authenticated observer-compatible seed-1 replay");
    const sourceFiles = await sourceDigests(opt.source, check);
    if (!same(sourceFiles, cache.source.files)) throw new Error("original source files differ from authenticated replay");
    const codeFilesBefore = await codeDigests(root, Object.keys(cache.source.replayCodeFiles), check);
    for (const [name, digest] of Object.entries(cache.source.replayCodeFiles))
      if (!digestEqual(codeFilesBefore[name], digest)) throw new Error(`replay code changed: ${name}`);
    const [catalogBytes, ruleBytes] = await Promise.all([Deno.readFile(opt.catalog), Deno.readFile(opt.rule)]);
    const catalogFile = sha256(catalogBytes), ruleFile = sha256(ruleBytes);
    if (catalogFile.sha256 !== SERIAL_CATALOG_SHA256 || ruleFile.sha256 !== SERIAL_RULE_SHA256)
      throw new Error("serial catalog or frozen selection rule digest mismatch");
    const catalog = JSON.parse(new TextDecoder().decode(catalogBytes)) as ExtractionCatalog;
    const rule = JSON.parse(new TextDecoder().decode(ruleBytes)) as ExtractionRule;
    validateExtractionRule(rule);
    planPilot(cache, catalog, rule, sourceFiles, catalogFile, ruleFile, codeFilesBefore, false, null, null);
    const cp = cache.checkpoints.find((c) => c.step === 900_000);
    const time = catalog.times.find((t) => t.step === 900_000);
    if (!cp || !time || time.checkpointSha256 !== cp.fileDigest.sha256)
      throw new Error("late source checkpoint/catalog join missing");
    const { state, observer } = decodeArtifact(await cacheStore.read(cp.file));
    if (!same(catalogAtTime(state, observer, cp.file, cp.fileDigest.sha256, true, rule), time))
      throw new Error("late extraction catalog differs from authenticated checkpoint");
    const ranking = rankCatalogSelection(cache.source.runId, "late", ruleFile.sha256, time);
    if (ranking[0]?.idx !== SERIAL_RANK0_COMPONENT || ranking[0]?.key !== SERIAL_RANK0_KEY)
      throw new Error("frozen rank-zero late donor changed");
    const component = time.components.find((c) => c.idx === SERIAL_RANK0_COMPONENT)!;
    const donorPacket = extractCellPacket(state, component.cellIndices);
    const protocolFile = await digestFile(join(root, "docs/foundations-serial-transfer.md"), check);
    const priorStageFiles: SerialManifest["priorStageFiles"] = [], priors: SerialManifest[] = [];
    const priorPlans: { manifest: SerialManifest; digest: FileDigest }[] = [];
    for (const path of opt.priors) {
      const bytes = await Deno.readFile(path);
      const prior = JSON.parse(new TextDecoder().decode(bytes)) as SerialManifest;
      const planBytes = await Deno.readFile(join(dirname(path), "plan.json"));
      const planDigest = sha256(planBytes);
      if (!digestEqual(planDigest, prior.planFile))
        throw new Error(`serial prior plan identity differs: ${path}`);
      priorStageFiles.push({ path, digest: sha256(bytes), planDigest });
      priors.push(prior);
      priorPlans.push({ manifest: JSON.parse(new TextDecoder().decode(planBytes)) as SerialManifest,
        digest: planDigest });
    }
    const rows: SerialRow[] = stageArms(opt.stage).map((arm) => {
      const packet = opt.stage === 0 ? arm === "donor" ? donorPacket : null :
        priors[opt.stage - 1]?.rows.find((r) => r.arm === arm)?.outcome?.selectedPacket ?? null;
      let importedFragment: SerialRow["importedFragment"];
      if (opt.stage === 0) importedFragment = arm === "donor" ?
        { kind: "evolved-source-unknown-age" } : { kind: "standard-founder-disc", founderIndex: 9 };
      else importedFragment = transferEvidence(priors[opt.stage - 1]?.rows.find((r) => r.arm === arm));
      return { arm, cycle: opt.stage, seed: SERIAL_SEEDS[opt.stage],
        gardenId: gardenId(opt.stage, arm), importedFragment,
        status: opt.stage > 0 && !packet ? "not-run-unavailable" : "planned",
        unavailableReason: opt.stage > 0 && !packet ? "prior garden yielded no transferable selected packet" : undefined,
        sourcePacket: packet };
    });
    manifest = { format: 1, status: "planned", stage: opt.stage, createdAt: startedAt,
      postExecutionRevalidated: false, inputPaths: { source: opt.source, cache: opt.cache,
        catalog: opt.catalog, rule: opt.rule }, sourceFiles,
      cacheManifestFile: await digestFile(join(opt.cache, "manifest.json"), check), catalogFile, ruleFile,
      protocolFile, sourceRunId: SERIAL_SOURCE_RUN, sourceCodeRevision: cache.source.codeRevision,
      sourceFinalArtifactHash: cache.final!.artifactHash, sourceVersions: cache.source.versions,
      sourceCheckpoint: { step: 900_000, file: cp.file, sha256: cp.fileDigest.sha256 },
      donorSelection: { componentIdx: SERIAL_RANK0_COMPONENT, selectionKey: SERIAL_RANK0_KEY,
        packetSha256: donorPacket.sha256 }, founder: { setId: M3_FOUNDER_SET, index: 9 },
      codeFilesBefore, priorStageFiles,
      execution: { requested: opt.execute, maxSeconds: opt.maxSeconds, gardenCount: rows.length,
        seeds: SERIAL_SEEDS, censusEvery: 25, coarseEvery: 100, horizon: 3000,
        claim: "one-source-serial-transfer-feasibility-only" }, rows,
      runtime: { startedAt, elapsedSeconds: 0, overrun: false, denoVersion: Deno.version.deno,
        os: Deno.build.os, arch: Deno.build.arch, adapter: null } };
    validateSerialPriors(manifest, priors, priorPlans);
    for (const row of manifest.rows) if (row.status === "planned") {
      check(`plan ${row.arm}`);
      const start = prepareSerialStart(cache.source, opt.stage, row.arm, row.sourcePacket);
      const restored = restoreCellPacket(exciseCellPacket(start.state, start.inoculum), start.inoculum);
      if (stateHash(restored) !== start.initialStateHash) throw new Error("serial exact restore sham failed before GPU");
      row.inoculumSha256 = start.inoculum.sha256; row.inoculumInventory = start.inoculum.inventory;
      row.initialStateHash = start.initialStateHash; row.initialMatter = start.initialMatter;
      row.initialEnergy = start.initialEnergy; row.initialInventory = start.initialInventory;
      row.placement = start.placement;
      row.transplantAudit = start.transplantAudit; row.pureRestoreMatched = true;
    }
    const recheck = async () => {
      check("revalidate sources");
      if (!same(await sourceDigests(opt.source, check), manifest!.sourceFiles) ||
          !digestEqual(await digestFile(join(opt.cache, "manifest.json"), check), manifest!.cacheManifestFile) ||
          !digestEqual(await digestFile(opt.catalog, check), manifest!.catalogFile) ||
          !digestEqual(await digestFile(opt.rule, check), manifest!.ruleFile) ||
          !digestEqual(await digestFile(join(root, "docs/foundations-serial-transfer.md"), check), manifest!.protocolFile))
        throw new Error("serial source, catalog, rule or protocol changed after plan freeze");
      await verifyReplayCache(cacheStore, cache.source);
      for (const prior of manifest!.priorStageFiles)
        if (!digestEqual(await digestFile(prior.path, check), prior.digest) ||
            !digestEqual(await digestFile(join(dirname(prior.path), "plan.json"), check), prior.planDigest))
          throw new Error(`serial prior manifest changed: ${prior.path}`);
      if (manifest!.planFile && !digestEqual(await digestFile(join(opt.out, "plan.json"), check), manifest!.planFile))
        throw new Error("serial frozen plan changed after reservation");
      manifest!.codeFilesAfter = await codeDigests(root, Object.keys(cache.source.replayCodeFiles), check);
      if (!same(manifest!.codeFilesBefore, manifest!.codeFilesAfter)) throw new Error("serial code changed after plan freeze");
    };
    await recheck();
    const planBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
    await Deno.writeFile(join(opt.out, "plan.json"), planBytes, { createNew: true });
    manifest.planFile = sha256(planBytes);
    await persist();
    if (!opt.execute) { check("before plan publication"); await persist(true); check("after plan publication");
      console.log(JSON.stringify({ status: "planned", stage: opt.stage, rows: rows.length,
        available: rows.filter((r) => r.status === "planned").length, gpuStarted: false, out: opt.out }));
      return;
    }
    if (!rows.some((r) => r.status === "planned")) {
      await recheck(); manifest.postExecutionRevalidated = true;
      manifest.status = "complete"; check("before unavailable publication");
      await persist(true); check("after unavailable publication");
      console.log(JSON.stringify({ status: "complete", stage: opt.stage, available: 0, gpuStarted: false, out: opt.out }));
      return;
    }
    manifest.status = "running"; await persist(); check("before GPU acquisition");
    const acquired = await acquire(navigator.gpu); device = acquired.device; manifest.runtime!.adapter = acquired.adapter;
    check("after GPU acquisition");
    const host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`,
      adapter: [acquired.adapter?.description, acquired.adapter?.device, acquired.adapter?.vendor].find(Boolean) ?? "adapter-info-empty" };
    for (const row of manifest.rows) {
      if (row.status === "not-run-unavailable") continue;
      check(`before ${row.arm} cycle ${row.cycle}`);
      row.status = "running"; await persist();
      let sink: SerialSink | undefined;
      try {
        const start = prepareSerialStart(cache.source, opt.stage, row.arm, row.sourcePacket);
        if (start.initialStateHash !== row.initialStateHash || start.inoculum.sha256 !== row.inoculumSha256 ||
            !same(start.initialInventory, row.initialInventory) ||
            !same(start.transplantAudit, row.transplantAudit))
          throw new Error("serial garden start differs from pre-GPU plan");
        const spec = serialSpec(cache.source, opt.stage);
        const restored = restoreCellPacket(exciseCellPacket(start.state, start.inoculum), start.inoculum);
        const shamSpec = { ...spec, steps: 25, checkpointEvery: 0 };
        const controlSink = new ObservationHashSink(), restoredSink = new ObservationHashSink();
        const control = await runExperiment(device, shamSpec, controlSink, host,
          () => check(`sham control ${row.arm}`), { start: cloneState(start.state), keepFinal: true });
        const restoredResult = await runExperiment(device, shamSpec, restoredSink, host,
          () => check(`sham restored ${row.arm}`), { start: restored, keepFinal: true });
        if (control.summary.mutations !== 0 || restoredResult.summary.mutations !== 0)
          throw new Error("serial sham emitted mutation events under mutation-off configuration");
        const sham = assertShamMatch(control, restoredResult, controlSink.digest(), restoredSink.digest(), 25);
        if (!row.importedFragment) throw new Error("planned serial garden lacks imported-fragment provenance");
        sink = new SerialSink(start.state, row.arm, opt.stage, row.seed, row.importedFragment, check);
        const measured = await runExperiment(device, spec, sink, host,
          () => check(`measured ${row.arm}`), { start: cloneState(start.state), keepFinal: true });
        check(`after measured ${row.arm}`);
        if (!measured.final || measured.final.step !== 3000 || !measured.summary.conservationOk ||
            measured.summary.mutations !== 0)
          throw new Error("serial measured garden did not conserve or reach horizon");
        const observed = sink.complete();
        const gpu = await GpuSim.create(device, cloneState(start.state));
        let reference: ReferenceResult;
        try {
          reference = await runReferenceReplay({ run: (count) => gpu.run(count),
            settle: () => device!.queue.onSubmittedWorkDone(), drainLedger: () => gpu.drainLedger(),
            readState: () => gpu.readState() }, 0, 3000, stateHash(measured.final), check);
        } finally { gpu.destroy(); }
        if (!reference.matchedMeasured || reference.drainedMutationEvents !== 0 || reference.droppedMutationEvents !== 0)
          throw new Error("serial no-observer physics reference mismatch or mutation events");
        const boundAccounting = boundIncorporationAccounting(start.state, measured.final, start.inoculum);
        if (!same(boundAccounting.initial, row.initialInventory))
          throw new Error("serial initial resource inventory differs from pre-GPU plan");
        row.outcome = { measuredPhysicsHash: stateHash(measured.final),
          measuredArtifactHash: artifactDigest(measured.final, measured.observer),
          wallSeconds: measured.summary.wallSeconds, conservationOk: true, mutationCount: 0,
          observationFiles: observed.observationFiles, capture: observed.capture,
          finalInventory: boundAccounting.final,
          incorporatedBoundMatterLowerBound: boundAccounting.incorporatedBoundMatterLowerBound,
          series: observed.series, selectedPacket: sink.capture.selectedPacket(), sham, reference };
        validateRowAccounting(row);
        row.status = "complete"; await persist();
      } catch (error) {
        row.status = error instanceof SerialTimeCapError ? "incomplete-time-cap" : "failed";
        row.failure = message(error);
        if (sink) { try { row.partialCapture = sink.partial(); } catch { /* pre-baseline failures have no trace */ } }
        await persist(); throw error;
      }
    }
    await recheck(); check("before final publication");
    manifest.postExecutionRevalidated = true;
    manifest.status = "complete"; await persist(true); check("after final publication");
    console.log(JSON.stringify({ status: "complete", stage: opt.stage, rows: manifest.rows.length,
      out: opt.out, gpuStarted: true, claim: manifest.execution.claim }));
  } catch (error) {
    if (reserved) {
      if (manifest) {
        manifest.status = error instanceof SerialTimeCapError ? "partial" : "failed";
        manifest.failure = message(error);
        await persist(true);
      } else await Deno.writeTextFile(join(opt.out, "failure.json"), JSON.stringify({ status: "failed",
        donorStatus: "unavailable", failure: message(error), startedAt, endedAt: new Date().toISOString() }, null, 2) + "\n");
    }
    throw error;
  } finally { device?.destroy(); }
}

if (import.meta.main) main().catch((error) => { console.error(message(error)); Deno.exitCode = 1; });
