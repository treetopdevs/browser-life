// The discovery workbench's core, shared by the local shard path
// (tools/discovery.ts) and the distributed plane (apps/coordinator discovery
// queue, tools/discovery-worker.ts, the browser worker page): freeze a
// protocol into a manifest and case specs, run one case on the CPU reference,
// validate an attempt, decide each case from its attempts, and reduce the
// campaign. DESIGN sections 4, 5 and 7 of
// docs/evolvability-discovery-2026-10-04.
//
// No filesystem or network access: callers pass bytes in and get bytes out,
// so the same functions run in Deno, in a browser Web Worker and in Vitest.
// The runner imports nothing GPU-related; a CPU-only host never requests an
// adapter.

import {
  CH,
  CPU_BACKEND,
  DISCOVERY_SCHEMA,
  GENOME_CHANNELS,
  RENEWAL_PIN,
  encodeGenome,
  MOT_ZERO,
  PHYSICS_VERSIONS,
  RESULT_FILES,
  allocState,
  buildWorld,
  campaignCoreDigest,
  canonicalJSON,
  canonicalObserverJSON,
  caseIdOf,
  cellCount,
  decodeCheckpoint,
  defaultConfig,
  digestOf,
  encodeCheckpoint,
  genomeFromHex,
  manifestDigest,
  seedCollisions,
  sha256Hex,
  stateHash,
  FLUX_COUNT,
  validateCaseSpec,
  validateManifest,
  validateProtocol,
  validateResultManifest,
  validateState,
  worldW,
  type CampaignManifest,
  type CanonicalResult,
  type CaseSpec,
  type DiscoveryProtocol,
  type EvidenceStatus,
  type ExecutionRecord,
  type FixtureSpec,
  type PinRecord,
  type ResultFile,
  type ResultManifest,
  type SeedReservation,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  ENGINEERING_READOUT,
  EXACT_LEDGER_OBSERVER,
  ExactLedgerObserver,
  engineeringReadout,
  type CensusRecord,
  type EngineeringReadout,
  type FinalRecord,
  type ObservationRecord,
} from "@bl/metrics";
import { observeCensus, restoreObservers, serializeObservers, type Observers } from "./observe.ts";
import type { ObserverSettings, ObserverState } from "./runner.ts";

export { CPU_BACKEND };
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Freeze

export function buildInitialState(f: FixtureSpec, seed: number): WorldState {
  const cfg = defaultConfig({ ...f.config, seed });
  if (f.initial.kind === "cells") {
    // Exact single-cell founders, as the construction workstream's constructionWorld builds them.
    if (cfg.tilesX !== 1 || cfg.tilesY !== 1) throw new Error(`fixture ${f.id}: cells recipes need one tile`);
    const s = allocState(cfg);
    const n = cellCount(cfg);
    s.cells.fill(f.initial.nutrient, CH.A * n, (CH.A + 1) * n);
    s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
    f.initial.founders.forEach((x, k) => {
      if (x.x >= cfg.tileW || x.y >= cfg.tileH) throw new Error(`fixture ${f.id}: founder (${x.x}, ${x.y}) outside the tile`);
      const i = x.y * cfg.tileW + x.x;
      s.cells[CH.B * n + i] = x.biomass;
      s.cells[CH.E * n + i] = x.energy;
      const words = encodeGenome(genomeFromHex(x.genomeHex), 0, k + 1);
      for (let j = 0; j < GENOME_CHANNELS; j++) s.genome[j * n + i] = words[j];
    });
    const errs = validateState(s);
    if (errs.length) throw new Error(`fixture ${f.id}: invalid initial state: ${errs.join("; ")}`);
    return s;
  }
  if (f.initial.kind === "founders")
    return buildWorld(cfg, { nutrient: f.initial.nutrient, founders: f.initial.founders.map((x) => ({ ...x, genome: genomeFromHex(x.genomeHex) })) });
  const s = allocState(cfg);
  const n = cellCount(cfg);
  const W = worldW(cfg);
  s.cells.fill(f.initial.nutrient, CH.A * n, (CH.A + 1) * n);
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  for (const d of f.initial.deposits) {
    const i = d.y * W + d.x;
    if (d.x >= W || i >= n) throw new Error(`fixture ${f.id}: deposit (${d.x}, ${d.y}) outside the world`);
    s.cells[CH.B * n + i] += d.B;
    s.cells[CH.P * n + i] += d.P;
    s.cells[CH.E * n + i] += d.E;
  }
  const errs = validateState(s);
  if (errs.length) throw new Error(`fixture ${f.id}: invalid initial state: ${errs.join("; ")}`);
  return s;
}

export interface FrozenCampaign {
  manifest: CampaignManifest;
  manifestDigest: string;
  campaignDigest: string;
  cases: { caseId: string; spec: CaseSpec }[];
  /** Initial-state artifacts by SHA-256. */
  initialArtifacts: Map<string, Uint8Array>;
}

/**
 * Resolves every case of a protocol and executes zero simulation steps.
 * Throws on any structural problem or seed collision.
 */
export async function freezeCampaign(
  protocol: DiscoveryProtocol,
  opts: { sourceClosureDigest: string; registry: SeedReservation[]; pin?: PinRecord },
): Promise<FrozenCampaign> {
  // Observers and readouts this build can run: the exact-ledger engineering pair, and the renewal pair
  // only when the caller verified the vendored pin (D5) and passes its record.
  const pinned = protocol.observerVersion === RENEWAL_PIN.observerVersion;
  if (pinned) {
    if (!opts.pin) throw new Error(`freeze: observer ${protocol.observerVersion} needs the verified construction pin, which was not supplied`);
    if (opts.pin.name !== RENEWAL_PIN.name || opts.pin.constructionRevision !== RENEWAL_PIN.constructionRevision || opts.pin.sourceDigest !== RENEWAL_PIN.sourceDigest) throw new Error("freeze: the supplied pin is not the one this build knows");
    if (protocol.readoutVersion !== RENEWAL_PIN.readoutVersion) throw new Error(`freeze: observer ${protocol.observerVersion} goes with readout ${RENEWAL_PIN.readoutVersion}, not ${protocol.readoutVersion}`);
  } else if (protocol.observerVersion !== EXACT_LEDGER_OBSERVER || protocol.readoutVersion !== ENGINEERING_READOUT) {
    throw new Error(`freeze: observer ${protocol.observerVersion} with readout ${protocol.readoutVersion} is not available in this build (have ${EXACT_LEDGER_OBSERVER} with ${ENGINEERING_READOUT}, and ${RENEWAL_PIN.observerVersion} with ${RENEWAL_PIN.readoutVersion} when pinned)`);
  }
  const backend = pinned ? RENEWAL_PIN.backend : CPU_BACKEND;
  const errs = validateProtocol(protocol);
  if (errs.length) throw new Error(`protocol invalid:\n  ${errs.join("\n  ")}`);
  const coll = seedCollisions(protocol.blocks, opts.registry, protocol.seedNamespace.name);
  if (coll.length) throw new Error(`seed collisions:\n  ${coll.join("\n  ")}`);
  const initialArtifacts = new Map<string, Uint8Array>();
  const resolved: { f: FixtureSpec; b: { id: string; seed: number }; cfg: WorldConfig; digest: string }[] = [];
  for (const f of protocol.fixtures)
    for (const b of protocol.blocks) {
      const s = buildInitialState(f, b.seed);
      if (s.step !== 0) throw new Error("freeze: an initial state must start at step 0");
      const bytes = encodeCheckpoint(s, {});
      const digest = await sha256Hex(bytes);
      initialArtifacts.set(digest, bytes);
      resolved.push({ f, b, cfg: s.cfg, digest });
    }
  const founders = new Map<string, Set<string>>();
  for (const f of protocol.fixtures) {
    const set = founders.get(f.founderId) ?? new Set<string>();
    if (f.initial.kind === "founders" || f.initial.kind === "cells") for (const x of f.initial.founders) set.add(x.genomeHex);
    founders.set(f.founderId, set);
  }
  const assays = new Map<string, string[]>();
  for (const f of protocol.fixtures) assays.set(f.assayId, [...(assays.get(f.assayId) ?? []), f.id]);
  const manifest: CampaignManifest = {
    schemaVersion: DISCOVERY_SCHEMA,
    campaign: protocol.campaign,
    purpose: protocol.purpose,
    question: protocol.question,
    protocolDigest: await digestOf(protocol),
    buildDigest: await digestOf(pinned ? { sourceClosureDigest: opts.sourceClosureDigest, backendContract: backend, pin: opts.pin } : { sourceClosureDigest: opts.sourceClosureDigest, backendContract: CPU_BACKEND }),
    sourceClosureDigest: opts.sourceClosureDigest,
    physicsVersions: pinned ? { ...RENEWAL_PIN.physicsVersions } : { ...PHYSICS_VERSIONS },
    observerVersion: protocol.observerVersion,
    readoutVersion: protocol.readoutVersion,
    resolvedParameterDomain: protocol.fixtures.map((f) => ({ fixtureId: f.id, candidateId: f.candidateId, config: f.config })),
    habitats: resolved.map((r) => ({ fixtureId: `${r.f.id}/${r.b.id}`, habitatId: r.f.habitatId, initialArtifactDigest: r.digest })),
    encodedFounderPanel: [...founders].map(([founderId, g]) => ({ founderId, genomeHex: [...g].sort() })),
    assayDefinitions: [...assays].map(([assayId, fixtureIds]) => ({ assayId, fixtureIds })),
    seedNamespaces: { ...protocol.seedNamespace, blocks: protocol.blocks },
    resourceLimits: protocol.resourceLimits,
    verificationPolicy: protocol.verificationPolicy,
    stoppingRule: protocol.stoppingRule,
    orderedCaseIds: [],
    proposalBatches: [],
    archiveDefinition: null,
  };
  if (pinned) manifest.pin = { name: opts.pin!.name, constructionRevision: opts.pin!.constructionRevision, sourceDigest: opts.pin!.sourceDigest };
  const campaignDigest = await campaignCoreDigest(manifest);
  const cases: { caseId: string; spec: CaseSpec }[] = [];
  for (const r of resolved) {
    const spec: CaseSpec = {
      schemaVersion: DISCOVERY_SCHEMA,
      campaignDigest,
      candidateId: r.f.candidateId,
      habitatId: r.f.habitatId,
      founderId: r.f.founderId,
      assayId: r.f.assayId,
      fixtureId: r.f.id,
      blockId: r.b.id,
      armId: r.f.armId,
      physicsSeed: r.b.seed,
      mutationPolicy: "as-configured",
      resolvedWorldConfig: r.cfg,
      initialArtifactDigest: r.digest,
      steps: r.f.steps,
      observationSchedule: { censusEvery: r.f.censusEvery, segmentAt: r.f.segmentAt, sites: r.f.sites },
      requiredBackendContract: backend,
      resourceClass: "small-cpu",
    };
    cases.push({ caseId: await caseIdOf(spec), spec });
  }
  const ids = cases.map((c) => c.caseId);
  if (new Set(ids).size !== ids.length) throw new Error("freeze: duplicate case IDs (two fixtures resolve to the same case)");
  manifest.orderedCaseIds = ids;
  manifest.proposalBatches = [ids];
  return { manifest, manifestDigest: await manifestDigest(manifest), campaignDigest, cases, initialArtifacts };
}

// ---------------------------------------------------------------------------
// Run one case

export interface CaseRunOptions {
  attemptId: string;
  role: "primary" | "replay";
  leaseId: string | null;
  workerId: string;
  physicalHostId: string;
  backendBuild: string;
  sourceClosureDigest: string;
  /** Wall-clock milliseconds; injected so the core stays pure. */
  now: () => number;
  /** Absolute deadline in `now()` milliseconds; the case fails technically when passed. */
  deadline?: number;
  /** Called every `progressEvery` steps; may throw to abort. */
  onProgress?: (step: number) => void | Promise<void>;
  progressEvery?: number;
}

export interface CaseFiles {
  "observations.jsonl": Uint8Array;
  "readout.json": Uint8Array;
  "end.blck": Uint8Array;
}

export class CaseTimeout extends Error {}

const LEGACY_SETTINGS: ObserverSettings = { censusEvery: 0, deepEvery: 0, activityThreshold: null };

interface History {
  sim: RefSim;
  obs: ExactLedgerObserver;
  legacy: Observers | null;
  records: ObservationRecord[];
}

function observerSection(h: History): { exactLedger: unknown; legacy?: ObserverState } {
  return h.legacy ? { exactLedger: h.obs.toJSON(), legacy: serializeObservers(h.legacy, h.sim.state.step, { ...LEGACY_SETTINGS, censusEvery: 1 }) } : { exactLedger: h.obs.toJSON() };
}

async function history(spec: CaseSpec, start: WorldState, segment: boolean, legacyObservers: boolean, opts: CaseRunOptions): Promise<History> {
  const sched = spec.observationSchedule;
  const h: History = { sim: new RefSim(start), obs: ExactLedgerObserver.start(start, sched.sites), legacy: legacyObservers ? restoreObservers(undefined, LEGACY_SETTINGS, start.cfg) : null, records: [] };
  const n = cellCount(start.cfg);
  let pendingMutations = 0;
  const census = () => {
    const s = h.sim.state;
    const rec = h.obs.census(s);
    h.obs.noteCensus(rec);
    h.records.push(rec);
    if (h.legacy) {
      observeCensus(h.legacy, s.cfg, { step: s.step, cells: s.cells, genomeHead: s.genome.subarray(0, 4 * n) }, pendingMutations);
      pendingMutations = 0;
    }
  };
  census();
  const segments = new Set(segment ? sched.segmentAt : []);
  const every = opts.progressEvery ?? 250;
  for (let k = 1; k <= spec.steps; k++) {
    pendingMutations += h.sim.step().events.length;
    h.obs.afterStep({ state: h.sim.state, roles: h.sim.roles });
    if (k % sched.censusEvery === 0 || k === spec.steps) census();
    if (segments.has(k)) {
      // Round-trip state and every observer through one checkpoint artifact,
      // exactly as a segmented run would between machines.
      const bytes = encodeCheckpoint(h.sim.state, observerSection(h));
      const { state, observer } = decodeCheckpoint(bytes);
      const o = observer as { exactLedger: unknown; legacy?: ObserverState };
      h.sim = new RefSim(state);
      h.obs = ExactLedgerObserver.restore(o.exactLedger);
      if (h.legacy) h.legacy = restoreObservers(o.legacy, LEGACY_SETTINGS, state.cfg);
    }
    if (k % every === 0) {
      if (opts.deadline !== undefined && opts.now() > opts.deadline) throw new CaseTimeout(`case exceeded its wall-time limit at step ${k}`);
      await opts.onProgress?.(k);
    }
  }
  return h;
}

export function encodeObservations(records: ObservationRecord[]): Uint8Array {
  return enc.encode(records.map((r) => canonicalJSON(r)).join("\n") + "\n");
}

export function decodeObservations(bytes: Uint8Array): ObservationRecord[] {
  const text = dec.decode(bytes);
  if (!text.endsWith("\n")) throw new Error("observations: missing final newline");
  return text
    .slice(0, -1)
    .split("\n")
    .map((line, i) => {
      const r = JSON.parse(line) as ObservationRecord;
      if (canonicalJSON(r) !== line) throw new Error(`observations: line ${i + 1} is not canonical`);
      return r;
    });
}

/** Executes one case on the CPU reference. Pure apart from the injected clock. */
export async function runCase(spec: CaseSpec, initialBytes: Uint8Array, opts: CaseRunOptions): Promise<{ result: ResultManifest; files: CaseFiles }> {
  const startedMs = opts.now();
  const caseId = await caseIdOf(spec);
  if ((await sha256Hex(initialBytes)) !== spec.initialArtifactDigest) throw new Error("run: initial artifact does not match the case's digest");
  if (spec.requiredBackendContract !== CPU_BACKEND) throw new Error(`run: this worker provides ${CPU_BACKEND}, the case requires ${spec.requiredBackendContract}`);
  const decode = () => {
    const { state } = decodeCheckpoint(initialBytes);
    if (canonicalJSON(state.cfg) !== canonicalJSON(spec.resolvedWorldConfig)) throw new Error("run: initial artifact config differs from the case's resolved config");
    if (state.step !== 0) throw new Error("run: initial artifact is not at step 0");
    return state;
  };
  const checkpointAssay = spec.assayId === "census-checkpoint";
  const h = await history(spec, decode(), true, checkpointAssay, opts);
  let continuity: FinalRecord["continuity"] = null;
  if (checkpointAssay) {
    const ref = await history(spec, decode(), false, true, opts);
    continuity = {
      continuousEndStateHash: stateHash(ref.sim.state),
      segmentedEndStateHash: stateHash(h.sim.state),
      continuousObserverDigest: await sha256Hex(enc.encode(canonicalObserverJSON(observerSection(ref)))),
      segmentedObserverDigest: await sha256Hex(enc.encode(canonicalObserverJSON(observerSection(h)))),
    };
  }
  const fin = h.obs.final(h.sim.state, continuity);
  h.records.push(fin);
  const files: CaseFiles = {
    "observations.jsonl": encodeObservations(h.records),
    "readout.json": enc.encode(canonicalJSON(engineeringReadout(spec, h.records))),
    "end.blck": encodeCheckpoint(h.sim.state, observerSection(h)),
  };
  const digests = Object.fromEntries(await Promise.all(RESULT_FILES.map(async (f) => [f, await sha256Hex(files[f])]))) as Record<ResultFile, string>;
  const canonical: CanonicalResult = {
    caseId,
    campaignDigest: spec.campaignDigest,
    startArtifactDigest: spec.initialArtifactDigest,
    endStateHash: stateHash(h.sim.state),
    endArtifactDigest: digests["end.blck"],
    canonicalObservationDigests: { observations: digests["observations.jsonl"] },
    readoutDigest: digests["readout.json"],
    invariantChecks: {
      matterResidualMax: fin.matterResidualMax,
      energyResidualMax: fin.energyResidualMax,
      fluxIdentityViolations: fin.fluxIdentityViolations,
      passed: fin.matterResidualMax === "0" && fin.energyResidualMax === "0" && fin.fluxIdentityViolations === 0,
    },
    outcome: "completed",
  };
  const execution: ExecutionRecord = {
    attemptId: opts.attemptId,
    role: opts.role,
    leaseId: opts.leaseId,
    workerId: opts.workerId,
    physicalHostId: opts.physicalHostId,
    backendBuild: opts.backendBuild,
    sourceClosureDigest: opts.sourceClosureDigest,
    startedAt: new Date(startedMs).toISOString(),
    measuredWallMs: Math.max(0, Math.round(opts.now() - startedMs)),
    artifactSizes: Object.fromEntries(RESULT_FILES.map((f) => [f, files[f].byteLength])) as Record<ResultFile, number>,
    files: digests,
  };
  return { result: { schemaVersion: DISCOVERY_SCHEMA, canonical, execution }, files };
}

// ---------------------------------------------------------------------------
// Validate one attempt

export interface CaseContext {
  manifest: CampaignManifest;
  campaignDigest: string;
  caseId: string;
  spec: CaseSpec;
}

/** Checks a frozen case spec against its manifest: identity, membership and the campaign core. */
export async function caseContextErrors(ctx: CaseContext): Promise<string[]> {
  const errs: string[] = [...validateManifest(ctx.manifest), ...validateCaseSpec(ctx.spec)];
  if (errs.length) return errs;
  if ((await campaignCoreDigest(ctx.manifest)) !== ctx.campaignDigest) errs.push("campaign core digest does not match the manifest");
  if ((await caseIdOf(ctx.spec)) !== ctx.caseId) errs.push("case spec does not hash to its case ID");
  if (ctx.spec.campaignDigest !== ctx.campaignDigest) errs.push("case spec binds a different campaign");
  if (!ctx.manifest.orderedCaseIds.includes(ctx.caseId)) errs.push("case is not in the manifest's ordered set");
  return errs;
}

export interface AttemptVerdict {
  valid: boolean;
  errors: string[];
  readout: EngineeringReadout | null;
}

/**
 * Validates one attempt for completeness, identity and digests before it can
 * be accepted or reused: required files, sizes and SHA-256s, the case and
 * campaign identity, the source closure, the observer and readout versions,
 * the decoded end state, canonical observations, the invariants, and an
 * independent re-derivation of the readout. A directory's existence is never
 * acceptance.
 */
/**
 * The pinned renewal validator (D5), injected by Deno callers: it decodes and
 * re-derives a pinned result under the pin's own code. The core cannot spawn
 * it, and without it a pinned result is never valid.
 */
export type PinnedValidator = (req: { spec: CaseSpec; caseId: string; result: ResultManifest; initial: Uint8Array; files: Record<ResultFile, Uint8Array> }) => Promise<{ errors: string[]; readout: EngineeringReadout | null }>;

export async function validateAttempt(
  ctx: CaseContext,
  resultBytes: Uint8Array | null,
  files: Partial<Record<ResultFile, Uint8Array>>,
  initialBytes: Uint8Array | null,
  pinnedValidator?: PinnedValidator,
): Promise<AttemptVerdict> {
  try {
    return await validateAttemptInner(ctx, resultBytes, files, initialBytes, pinnedValidator);
  } catch (e) {
    // Malformed input must reject the attempt, never abort a campaign's validation.
    return { valid: false, errors: [`validation failed: ${(e as Error).message}`], readout: null };
  }
}

const DEC_RE = /^(0|[1-9][0-9]*)$/;
const HEX16_RE = /^[0-9a-f]{16}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** Type-strict tests: a regex alone would coerce numbers and arrays to strings. */
const DEC = { test: (v: unknown) => typeof v === "string" && DEC_RE.test(v) };
const HEX16 = { test: (v: unknown) => typeof v === "string" && HEX16_RE.test(v) };
const HEX64 = { test: (v: unknown) => typeof v === "string" && HEX64_RE.test(v) };
const sameKeys = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();
const nat = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/** The census steps a complete history records: 0, every `censusEvery`, and the last step. */
export function censusSchedule(spec: CaseSpec): number[] {
  const out: number[] = [];
  for (let k = 0; k <= spec.steps; k += spec.observationSchedule.censusEvery) out.push(k);
  if (out[out.length - 1] !== spec.steps) out.push(spec.steps);
  return out;
}

/** Exact structure of a complete observation history: the schedule, record shapes and site coverage. */
export function observationStructureErrors(spec: CaseSpec, records: unknown[]): string[] {
  const errs: string[] = [];
  const sites = spec.observationSchedule.sites;
  const schedule = censusSchedule(spec);
  if (records.length !== schedule.length + 1) errs.push(`observations: ${records.length} records, a complete history has ${schedule.length} censuses and one final record`);
  const siteOk = (list: unknown, extra: string[]) =>
    Array.isArray(list) &&
    list.length === sites.length &&
    list.every((x, k) => sameKeys(x, ["x", "y", "B", "P", "E", ...extra]) && x.x === sites[k].x && x.y === sites[k].y && nat(x.B) && nat(x.P) && nat(x.E) && extra.every((e) => DEC.test(x[e])));
  records.forEach((r, i) => {
    const rec = r as Record<string, unknown>;
    if (i < records.length - 1) {
      const where = `observations: census ${i}`;
      if (!sameKeys(rec, ["kind", "step", "totals", "flux", "lightIn", "heatOut", "livingCells", "occupiedB", "occupiedBP", "stateHash", "sites"]) || rec.kind !== "census") return void errs.push(`${where} has the wrong shape`);
      if (rec.step !== schedule[i]) errs.push(`${where} is at step ${String(rec.step)}, the schedule says ${schedule[i]}`);
      const t = rec.totals as Record<string, unknown>;
      if (!sameKeys(t, ["A", "B", "C", "P", "E", "S", "matter", "energy"]) || !Object.values(t).every((v) => DEC.test(v as string))) errs.push(`${where}: bad totals`);
      if (!Array.isArray(rec.flux) || rec.flux.length !== FLUX_COUNT || !rec.flux.every((v) => DEC.test(v))) errs.push(`${where}: bad flux`);
      if (!DEC.test(rec.lightIn as string) || !DEC.test(rec.heatOut as string)) errs.push(`${where}: bad ledger`);
      if (!nat(rec.livingCells) || !nat(rec.occupiedB) || !nat(rec.occupiedBP)) errs.push(`${where}: bad counts`);
      if (!HEX16.test(rec.stateHash as string)) errs.push(`${where}: bad state hash`);
      if (!siteOk(rec.sites, ["Q"])) errs.push(`${where}: sites do not cover the case's sites`);
    } else {
      const where = "observations: final record";
      if (!sameKeys(rec, ["kind", "step", "matterResidualMax", "energyResidualMax", "fluxIdentityViolations", "rolesExact", "firstStep", "initial", "extinctAtCensus", "continuity"]) || rec.kind !== "final")
        return void errs.push(`${where} is missing or has the wrong shape`);
      if (rec.step !== spec.steps) errs.push(`${where} is at step ${String(rec.step)}`);
      if (!DEC.test(rec.matterResidualMax) || !DEC.test(rec.energyResidualMax) || !nat(rec.fluxIdentityViolations) || typeof rec.rolesExact !== "boolean") errs.push(`${where}: bad ledger fields`);
      if (rec.extinctAtCensus !== null && !(nat(rec.extinctAtCensus) && schedule.includes(rec.extinctAtCensus as number))) errs.push(`${where}: bad extinction step`);
      if (!siteOk(rec.firstStep, []) || !siteOk(rec.initial, [])) errs.push(`${where}: sites do not cover the case's sites`);
      const c = rec.continuity as Record<string, unknown> | null;
      if (spec.assayId === "census-checkpoint") {
        if (!sameKeys(c, ["continuousEndStateHash", "segmentedEndStateHash", "continuousObserverDigest", "segmentedObserverDigest"])) errs.push(`${where}: continuity record missing`);
        else if (!HEX16.test(c!.continuousEndStateHash) || !HEX16.test(c!.segmentedEndStateHash) || !HEX64.test(c!.continuousObserverDigest) || !HEX64.test(c!.segmentedObserverDigest)) errs.push(`${where}: bad continuity digests`);
      } else if (c !== null) errs.push(`${where}: unexpected continuity record`);
    }
  });
  return errs;
}

async function validateAttemptInner(ctx: CaseContext, resultBytes: Uint8Array | null, files: Partial<Record<ResultFile, Uint8Array>>, initialBytes: Uint8Array | null, pinnedValidator?: PinnedValidator): Promise<AttemptVerdict> {
  const errors: string[] = [];
  const bad = (e: string): AttemptVerdict => ({ valid: false, errors: [...errors, e], readout: null });
  if (!resultBytes) return bad("missing result.json");
  if (!initialBytes || (await sha256Hex(initialBytes)) !== ctx.spec.initialArtifactDigest) return bad("the case's initial artifact is missing or corrupt");
  let r: ResultManifest;
  try {
    r = JSON.parse(dec.decode(resultBytes)) as ResultManifest;
  } catch {
    return bad("result.json is not JSON");
  }
  errors.push(...validateResultManifest(r));
  if (errors.length) return { valid: false, errors, readout: null };
  const m = ctx.manifest;
  const c = r.canonical;
  if (c.caseId !== ctx.caseId) errors.push("result names a different case");
  if (c.campaignDigest !== ctx.campaignDigest) errors.push("result binds a different campaign");
  if (c.startArtifactDigest !== ctx.spec.initialArtifactDigest) errors.push("result starts from a different initial artifact");
  if (r.execution.sourceClosureDigest !== m.sourceClosureDigest) errors.push("result was produced by a different source closure");
  for (const f of RESULT_FILES) {
    const b = files[f];
    if (!b) {
      errors.push(`missing ${f}`);
      continue;
    }
    if (b.byteLength !== r.execution.artifactSizes[f]) errors.push(`${f}: size ${b.byteLength} != recorded ${r.execution.artifactSizes[f]}`);
    if ((await sha256Hex(b)) !== r.execution.files[f]) errors.push(`${f}: SHA-256 does not match the recorded digest (corrupt bytes)`);
  }
  if (errors.length) return { valid: false, errors, readout: null };
  if (c.endArtifactDigest !== r.execution.files["end.blck"]) errors.push("end artifact digest is not the end file's");
  if (c.canonicalObservationDigests.observations !== r.execution.files["observations.jsonl"]) errors.push("observation digest is not the observation file's");
  if (c.readoutDigest !== r.execution.files["readout.json"]) errors.push("readout digest is not the readout file's");
  if (m.observerVersion === RENEWAL_PIN.observerVersion) {
    // Identity, sizes and digests are checked above; everything that needs the pinned code is checked under it.
    if (ctx.spec.requiredBackendContract !== RENEWAL_PIN.backend) errors.push("a pinned campaign's case must require the pinned backend");
    if (!pinnedValidator) return bad("pinned renewal results need the pinned validator, which this caller does not provide");
    if (errors.length) return { valid: false, errors, readout: null };
    const v = await pinnedValidator({ spec: ctx.spec, caseId: ctx.caseId, result: r, initial: initialBytes, files: files as Record<ResultFile, Uint8Array> });
    const errs = [...v.errors];
    if (!errs.length && v.readout?.readoutVersion !== m.readoutVersion) errs.push(`readout version ${String(v.readout?.readoutVersion)} != manifest ${m.readoutVersion}`);
    return { valid: errs.length === 0, errors: errs, readout: errs.length === 0 ? v.readout : null };
  }
  let end: WorldState;
  let observer: unknown;
  try {
    ({ state: end, observer } = decodeCheckpoint(files["end.blck"]!));
  } catch (e) {
    return bad(`end.blck: ${(e as Error).message}`);
  }
  if (stateHash(end) !== c.endStateHash) errors.push("end state hash does not match the end artifact");
  if (end.step !== ctx.spec.steps) errors.push(`end state is at step ${end.step}, the case runs ${ctx.spec.steps}`);
  if (canonicalJSON(end.cfg) !== canonicalJSON(ctx.spec.resolvedWorldConfig)) errors.push("end state config differs from the case's");
  const ov = (observer as { exactLedger?: { version?: unknown } })?.exactLedger?.version;
  if (ov !== m.observerVersion) return bad(`observer version ${String(ov)} != manifest ${m.observerVersion}`);
  let records: ObservationRecord[];
  try {
    records = decodeObservations(files["observations.jsonl"]!);
  } catch (e) {
    return bad((e as Error).message);
  }
  const structure = observationStructureErrors(ctx.spec, records);
  if (structure.length) return { valid: false, errors: [...errors, ...structure], readout: null };
  const fin = records[records.length - 1] as FinalRecord;
  const lastCensus = records[records.length - 2] as CensusRecord;
  // Recompute what the observations claim from the artifacts themselves.
  const { state: start } = decodeCheckpoint(initialBytes);
  const sites = ctx.spec.observationSchedule.sites;
  const fresh = ExactLedgerObserver.start(start, sites);
  if (canonicalJSON(fresh.census(start)) !== canonicalJSON(records[0])) errors.push("first census does not match the initial artifact");
  if (canonicalJSON(fresh.final(start, null).initial) !== canonicalJSON(fin.initial)) errors.push("final record's initial sites do not match the initial artifact");
  const restored = ExactLedgerObserver.restore((observer as { exactLedger: unknown }).exactLedger);
  if (canonicalJSON(restored.census(end)) !== canonicalJSON(lastCensus)) errors.push("last census does not match the end artifact (state and observer)");
  if (canonicalJSON(restored.final(end, fin.continuity)) !== canonicalJSON(fin)) errors.push("final record does not match the end artifact's observer state");
  if (fin.continuity) {
    // Bind the segmented side of the continuity claim to the checkpoint actually delivered.
    if (fin.continuity.segmentedEndStateHash !== stateHash(end)) errors.push("continuity: segmented end state is not the end artifact's");
    if (fin.continuity.segmentedObserverDigest !== (await sha256Hex(enc.encode(canonicalObserverJSON(observer))))) errors.push("continuity: segmented observer digest is not the end artifact's observer section");
  }
  const derivedPass = fin.matterResidualMax === "0" && fin.energyResidualMax === "0" && fin.fluxIdentityViolations === 0;
  if (fin.matterResidualMax !== c.invariantChecks.matterResidualMax || fin.energyResidualMax !== c.invariantChecks.energyResidualMax || fin.fluxIdentityViolations !== c.invariantChecks.fluxIdentityViolations)
    errors.push("invariant checks differ from the observations");
  if (c.invariantChecks.passed !== derivedPass) errors.push("invariant 'passed' flag does not follow from the residuals");
  if (!derivedPass) errors.push("invariants failed: matter, energy or flux ledger is not exact");
  const readout = engineeringReadout(ctx.spec, records);
  if (readout.readoutVersion !== m.readoutVersion) errors.push(`readout version ${readout.readoutVersion} != manifest ${m.readoutVersion}`);
  if (canonicalJSON(readout) !== dec.decode(files["readout.json"]!)) errors.push("readout does not re-derive from the observations");
  if (readout.status === "invalid-or-incomplete") errors.push(`readout reports an invalid or incomplete history: ${readout.expectation}`);
  return { valid: errors.length === 0, errors, readout: errors.length === 0 ? readout : null };
}

// ---------------------------------------------------------------------------
// Decide a case from its attempts

export interface AttemptInfo {
  attemptId: string;
  role: "primary" | "replay";
  physicalHostId: string;
  /** Validated attempts carry their canonical result; invalid ones carry their errors. */
  verdict: AttemptVerdict;
  canonical: CanonicalResult | null;
  /** Retained partial (interrupted) attempts are listed, never validated. */
  partial: boolean;
}

export type CaseDecision = "accepted" | "quarantined" | "pending-replay" | "missing";

export interface CaseAcceptance {
  caseId: string;
  decision: CaseDecision;
  reason: string;
  /** Digest of the agreed canonical result when accepted. */
  canonicalDigest: string | null;
  readout: EngineeringReadout | null;
  attempts: { attemptId: string; role: string; physicalHostId: string; valid: boolean; partial: boolean; errors: string[] }[];
}

/**
 * One accepted result per logical case. Under "every-case-cross-host" a case
 * is accepted when every valid attempt agrees canonically and the valid
 * attempts span at least two physical hosts with at least one replay.
 * Any canonical disagreement among valid attempts quarantines the case and
 * keeps every attempt. The decision does not depend on arrival order.
 */
export async function decideCase(caseId: string, attempts: AttemptInfo[]): Promise<CaseAcceptance> {
  const sorted = [...attempts].sort((a, b) => (a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0));
  const listing = sorted.map((a) => ({ attemptId: a.attemptId, role: a.role, physicalHostId: a.physicalHostId, valid: a.verdict.valid, partial: a.partial, errors: a.verdict.errors }));
  const valid = sorted.filter((a) => a.verdict.valid && a.canonical);
  const digests = new Map<string, AttemptInfo[]>();
  for (const a of valid) {
    const d = await digestOf(a.canonical);
    digests.set(d, [...(digests.get(d) ?? []), a]);
  }
  const out = (decision: CaseDecision, reason: string, canonicalDigest: string | null = null, readout: EngineeringReadout | null = null): CaseAcceptance => ({ caseId, decision, reason, canonicalDigest, readout, attempts: listing });
  if (digests.size > 1) return out("quarantined", `valid attempts disagree: ${digests.size} distinct canonical results`);
  if (valid.length === 0) return out("missing", sorted.length ? "no valid attempt" : "no attempt");
  const [[d, agree]] = [...digests];
  const hosts = new Set(agree.map((a) => a.physicalHostId));
  const hasPrimary = agree.some((a) => a.role === "primary");
  const hasReplay = agree.some((a) => a.role === "replay");
  if (!hasPrimary) return out("pending-replay", "no valid primary");
  if (!hasReplay || hosts.size < 2) return out("pending-replay", "needs an agreeing replay from a different physical host");
  return out("accepted", `${agree.length} agreeing attempts on ${hosts.size} hosts`, d, agree[0].verdict.readout);
}

// ---------------------------------------------------------------------------
// Reduce

export interface AcceptanceIndex {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  manifestDigest: string;
  policy: CampaignManifest["verificationPolicy"];
  cases: CaseAcceptance[];
  /** Attempt directories found for IDs outside the manifest; never accepted. */
  strays: string[];
}

export interface CampaignReport {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  campaign: string;
  purpose: CampaignManifest["purpose"];
  manifestDigest: string;
  status: "complete" | "incomplete" | "quarantined";
  counts: Record<CaseDecision, number>;
  /** Shared-seed fixtures in one block are one independent block, not separate replicates. */
  independentBlocks: number;
  cases: { caseId: string; fixtureId: string; blockId: string; decision: CaseDecision; canonicalDigest: string | null; status: EvidenceStatus | null; met: boolean | null; extinct: boolean | null }[];
  fixtures: { fixtureId: string; assayId: string; blocks: number; accepted: number; met: number; status: EvidenceStatus }[];
  /** Digest of this report without this field; equal across hosts and arrival orders. */
  reductionDigest: string;
}

/**
 * Compares the acceptance index with the manifest's complete expected set and
 * reduces in canonical case order. Missing cases make the campaign
 * incomplete, any quarantine makes it quarantined, and only a complete
 * accepted set yields per-fixture evidence. Host and attempt identities never
 * enter the report.
 */
export async function reduceCampaign(manifest: CampaignManifest, specs: Map<string, CaseSpec>, idx: AcceptanceIndex): Promise<CampaignReport> {
  const md = await manifestDigest(manifest);
  if (idx.schemaVersion !== DISCOVERY_SCHEMA) throw new Error("reduce: unknown acceptance index schema");
  if (idx.manifestDigest !== md) throw new Error("reduce: the acceptance index belongs to a different manifest");
  if (canonicalJSON(idx.policy) !== canonicalJSON(manifest.verificationPolicy)) throw new Error("reduce: the acceptance index used a different verification policy");
  const expected = new Set(manifest.orderedCaseIds);
  const seen = new Set<string>();
  for (const c of idx.cases) {
    if (!expected.has(c.caseId)) throw new Error(`reduce: the acceptance index has a case outside the manifest (${c.caseId})`);
    if (seen.has(c.caseId)) throw new Error(`reduce: the acceptance index lists case ${c.caseId} twice`);
    seen.add(c.caseId);
    if (!["accepted", "quarantined", "pending-replay", "missing"].includes(c.decision)) throw new Error(`reduce: unknown decision ${c.decision}`);
    if (c.decision === "accepted" && (!c.readout || !c.canonicalDigest)) throw new Error(`reduce: accepted case ${c.caseId} has no readout or canonical digest`);
  }
  const byId = new Map(idx.cases.map((c) => [c.caseId, c]));
  const counts: Record<CaseDecision, number> = { accepted: 0, quarantined: 0, "pending-replay": 0, missing: 0 };
  const cases = manifest.orderedCaseIds.map((id) => {
    const spec = specs.get(id);
    if (!spec) throw new Error(`reduce: no spec for case ${id}`);
    const a = byId.get(id);
    const decision: CaseDecision = a?.decision ?? "missing";
    counts[decision]++;
    const ro = decision === "accepted" ? a!.readout : null;
    return { caseId: id, fixtureId: spec.fixtureId, blockId: spec.blockId, decision, canonicalDigest: decision === "accepted" ? a!.canonicalDigest : null, status: ro?.status ?? null, met: ro?.met ?? null, extinct: ro?.extinct ?? null };
  });
  const status: CampaignReport["status"] = counts.quarantined > 0 ? "quarantined" : counts.accepted === cases.length ? "complete" : "incomplete";
  const fixtureIds = [...new Set(cases.map((c) => c.fixtureId))];
  const fixtures = fixtureIds.map((fixtureId) => {
    const rows = cases.filter((c) => c.fixtureId === fixtureId);
    const acc = rows.filter((c) => c.decision === "accepted");
    const met = acc.filter((c) => c.met).length;
    const fstatus: EvidenceStatus =
      acc.length < rows.length || acc.some((c) => c.status === "invalid-or-incomplete")
        ? "invalid-or-incomplete"
        : acc.some((c) => c.status === "unsupported-measurement")
          ? "unsupported-measurement"
          : met === rows.length
            ? "supported"
            : "unsupported-within-tested-domain";
    return { fixtureId, assayId: specs.get(rows[0].caseId)!.assayId, blocks: rows.length, accepted: acc.length, met, status: fstatus };
  });
  const body = {
    schemaVersion: DISCOVERY_SCHEMA,
    campaign: manifest.campaign,
    purpose: manifest.purpose,
    manifestDigest: md,
    status,
    counts,
    independentBlocks: new Set(cases.map((c) => c.blockId)).size,
    cases,
    fixtures,
  } as const;
  return { ...body, reductionDigest: await digestOf(body) };
}

/** Human-readable summary of a report. */
export function reportMarkdown(rep: CampaignReport, extra: string[] = []): string {
  const lines = [
    `# Campaign ${rep.campaign} (${rep.purpose})`,
    "",
    `Manifest \`${rep.manifestDigest}\`. Status: **${rep.status}**. Reduction digest \`${rep.reductionDigest}\`.`,
    "",
    `Cases: ${rep.counts.accepted} accepted, ${rep.counts["pending-replay"]} pending replay, ${rep.counts.missing} missing, ${rep.counts.quarantined} quarantined. Independent seed blocks: ${rep.independentBlocks}.`,
    "",
    "| Fixture | Assay | Blocks | Accepted | Expectation met | Evidence |",
    "|---|---|---:|---:|---:|---|",
    ...rep.fixtures.map((f) => `| ${f.fixtureId} | ${f.assayId} | ${f.blocks} | ${f.accepted} | ${f.met} | ${f.status} |`),
    "",
    ...extra,
  ];
  return lines.join("\n") + "\n";
}
