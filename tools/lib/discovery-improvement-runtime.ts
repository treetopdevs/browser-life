import {
  cellCount,
  CH,
  decodeCheckpoint,
  decodeGenome,
  encodeCheckpoint,
  G,
  GENOME_CHANNELS,
  lineageKey,
  packLineageLo,
  RING_CELL_MASK,
  stateHash,
  type WorldState,
} from "@bl/schema";
import { dirname, join } from "node:path";
import {
  ancestryResolver,
  competitionScore,
  type MutationEdge,
  sha256,
  simHex,
} from "./founder-policy.ts";
import {
  discoveryEvolutionConfig,
  type DiscoveryEvolutionSample,
  discoveryEvolutionWorld,
  type EvolutionMode,
  sampleDiscoveryEvolution,
} from "./discovery-evolution.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "./discovery-competition.ts";
import {
  type ImprovementRow,
  summarizeDiscoveryImprovement,
} from "./discovery-improvement-summary.ts";

export const EVOLUTION_SEEDS = Array.from({ length: 8 }, (_, i) => 6410001 + i);
export const ASSAY_SEEDS = Array.from({ length: 4 }, (_, i) => 6430001 + i);
export const TIMES = [0, 100_000, 1_000_000] as const;
export const CHECKPOINT_STEPS = Array.from(
  { length: 11 },
  (_, i) => i * 100_000,
);
export const ASSAY_STEPS = 20_000;
export const BOOTSTRAP_SEED = 6450001;
export type Founder = { id: string; hex: string; cluster: number };
export type Unit = {
  id: string;
  founderId: string;
  founderHex: string;
  seed: number;
  mode: EvolutionMode;
  drawSeeds: [number, number][];
};
export interface Manifest {
  format: "discovery-improvement-manifest/v1";
  ruleVersion: number;
  sourceRoot: string;
  pilotDesignSha256: string;
  pilotAnalysisSha256: string;
  inputs: Record<string, string>;
  sources: Record<string, string>;
  sourceManifestHash: string;
  founders: Founder[];
  units: Unit[];
  evolutionConfigs: Record<string, ReturnType<typeof discoveryEvolutionConfig>>;
  assayConfigs: Record<string, ReturnType<typeof discoveryCompetitionConfig>>;
  times: number[];
  checkpointSteps: number[];
  assaySteps: number;
  bootstrapSeed: number;
  manifestHash: string;
}
export interface Sample extends DiscoveryEvolutionSample {
  drawSeeds: [number, number];
}
export interface CheckpointReceipt {
  format: "discovery-improvement-checkpoint/v1";
  manifestHash: string;
  unitId: string;
  step: number;
  stateHash: string;
  checkpointSha256: string;
  edgeDeltaSha256: string;
  previousReceiptSha256: string | null;
  sample: Sample | null;
}
export interface LoadedCheckpoint {
  state: WorldState;
  edges: MutationEdge[];
  receipt: CheckpointReceipt;
  receiptSha256: string;
  samples: Record<number, Sample>;
}
export interface DrawRequest {
  id: string;
  unitId: string;
  founderId: string;
  founderHex: string;
  seed: number;
  mode: EvolutionMode;
  time: number;
  draw: number;
  sampleSeed: number;
  status: "scheduled" | "absent" | "unresolved" | "missing";
  descendantHex: string | null;
}
export interface AssayRequest {
  id: string;
  drawId: string;
  assaySeed: number;
  assignment: number;
  status: DrawRequest["status"];
  cacheKey: string | null;
}
export interface AssayResult {
  format: "discovery-improvement-assay/v1";
  cacheKey: string;
  sourceManifestHash: string;
  descendantHex: string;
  founderHex: string;
  cfg: ReturnType<typeof discoveryCompetitionConfig>;
  seed: number;
  assignment: number;
  steps: 20000;
  initialStateHash: string;
  finalStateHash: string;
  descendantMass: number;
  ancestorMass: number;
  unassociatedMass: number;
  status: "scored" | "both-extinct";
  score: number | null;
  elapsedSeconds: number;
}

const hex64 = /^[0-9a-f]{64}$/;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const receiptName = (step: number) => `receipt-${step}.json`;
const checkpointName = (step: number) => `checkpoint-${step}.blck`;
const edgesName = (step: number) => `edges-${step}.json`;
async function optionalBytes(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}
export async function writeNew(
  path: string,
  bytes: Uint8Array | string,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeFile(
    path,
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
    { createNew: true },
  );
}
export function manifestPayloadHash(
  manifest: Omit<Manifest, "manifestHash">,
): string {
  return sha256(JSON.stringify(manifest));
}
export function buildManifest(
  base: Omit<
    Manifest,
    | "manifestHash"
    | "units"
    | "evolutionConfigs"
    | "assayConfigs"
    | "times"
    | "checkpointSteps"
    | "assaySteps"
    | "bootstrapSeed"
  >,
): Manifest {
  if (
    base.founders.length !== 4 ||
    new Set(base.founders.map((f) => f.id)).size !== 4 ||
    new Set(base.founders.map((f) => f.hex)).size !== 4
  ) throw Error("exactly four distinct frozen founders required");
  const units: Unit[] = [];
  let nextSeed = 6420001;
  for (const founder of base.founders) {
    for (const seed of EVOLUTION_SEEDS) {
      for (const mode of ["normal", "off"] as const) {
        const drawSeeds = TIMES.map((): [
          number,
          number,
        ] => [nextSeed++, nextSeed++]);
        units.push({
          id: `${founder.id}-${seed}-${mode}`,
          founderId: founder.id,
          founderHex: founder.hex,
          seed,
          mode,
          drawSeeds,
        });
      }
    }
  }
  if (nextSeed !== 6420385) throw Error("sampling seed allocation drift");
  const evolutionConfigs = Object.fromEntries(
    EVOLUTION_SEEDS.flatMap((seed) =>
      ["normal", "off"].map((
        mode,
      ) => [
        `${seed}-${mode}`,
        discoveryEvolutionConfig(seed, mode as EvolutionMode),
      ])
    ),
  );
  const assayConfigs = Object.fromEntries(
    ASSAY_SEEDS.map((seed) => [String(seed), discoveryCompetitionConfig(seed)]),
  );
  const payload = {
    ...base,
    units,
    evolutionConfigs,
    assayConfigs,
    times: [...TIMES],
    checkpointSteps: [...CHECKPOINT_STEPS],
    assaySteps: ASSAY_STEPS,
    bootstrapSeed: BOOTSTRAP_SEED,
  };
  return { ...payload, manifestHash: manifestPayloadHash(payload) };
}
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    !m || m.format !== "discovery-improvement-manifest/v1" ||
    !hex64.test(m.manifestHash) || !hex64.test(m.pilotAnalysisSha256) ||
    !hex64.test(m.pilotDesignSha256)
  ) throw Error("invalid improvement manifest identity");
  const { manifestHash, ...payload } = m;
  if (manifestPayloadHash(payload) !== manifestHash) {
    throw Error("manifest payload hash drift");
  }
  const rebuilt = buildManifest({
    format: m.format,
    ruleVersion: m.ruleVersion,
    sourceRoot: m.sourceRoot,
    pilotDesignSha256: m.pilotDesignSha256,
    pilotAnalysisSha256: m.pilotAnalysisSha256,
    inputs: m.inputs,
    sources: m.sources,
    sourceManifestHash: m.sourceManifestHash,
    founders: m.founders,
  });
  if (!same(rebuilt, m)) {
    throw Error("frozen improvement roster or configuration drift");
  }
  if (
    m.units.length !== 64 || m.checkpointSteps.length * m.units.length !== 704
  ) throw Error("incomplete history roster");
  return m;
}
export function sampleAt(
  state: WorldState,
  unit: Unit,
  edges: MutationEdge[],
  step: number,
): Sample | null {
  const index = TIMES.indexOf(step as typeof TIMES[number]);
  if (index < 0) return null;
  return {
    ...sampleDiscoveryEvolution(
      state,
      unit.founderHex,
      edges,
      unit.drawSeeds[index],
    ),
    drawSeeds: unit.drawSeeds[index],
  };
}
export function validateCheckpointBiology(
  state: WorldState,
  unit: Unit,
  delta: MutationEdge[],
  allEdges: MutationEdge[],
  previousStep: number,
): void {
  const n = cellCount(state.cfg),
    founder = lineageKey(0, packLineageLo(state.cfg, 1));
  const seen = new Set<string>();
  const lineageCell = (hi: number, lo: number) =>
    hi > 0 && (lo & RING_CELL_MASK) < n &&
    packLineageLo(state.cfg, lo & RING_CELL_MASK) === lo;
  for (const edge of allEdges) {
    const child = /^([0-9]+):([0-9]+)$/.exec(edge.child),
      parent = /^([0-9]+):([0-9]+)$/.exec(edge.parent);
    if (!child || !parent || seen.has(edge.child)) {
      throw Error(`duplicate/malformed mutation edge ${unit.id}/${state.step}`);
    }
    seen.add(edge.child);
    const ch = Number(child[1]),
      cl = Number(child[2]),
      ph = Number(parent[1]),
      pl = Number(parent[2]);
    if (
      ![ch, cl, ph, pl].every((x) =>
        Number.isSafeInteger(x) && x >= 0 && x <= 0xffffffff
      ) || ch > state.step || ph >= ch || !lineageCell(ch, cl) ||
      (ph === 0 ? edge.parent !== founder : !lineageCell(ph, pl))
    ) throw Error(`noncausal/invalid mutation edge ${unit.id}/${state.step}`);
  }
  for (const edge of delta) {
    const childStep = Number(edge.child.split(":")[0]);
    if (childStep <= previousStep || childStep > state.step) {
      throw Error(
        `mutation delta outside checkpoint interval ${unit.id}/${state.step}`,
      );
    }
  }
  const resolve = ancestryResolver({ [founder]: 0 }, allEdges);
  for (const edge of allEdges) resolve(edge.child);
  if (unit.mode === "off" && allEdges.length) {
    throw Error(`mutation-off edge ${unit.id}/${state.step}`);
  }
  if (state.genome.length !== n * GENOME_CHANNELS) {
    throw Error(`malformed genome buffer ${unit.id}/${state.step}`);
  }
  for (let i = 0; i < n; i++) {
    if (!(state.cells[CH.B * n + i] + state.cells[CH.P * n + i])) continue;
    const hi = state.genome[G.LIN_HI * n + i],
      lo = state.genome[G.LIN_LO * n + i];
    if (hi === 0 && lo === 0) continue;
    const id = lineageKey(hi, lo);
    if (hi === 0 && id !== founder) {
      throw Error(`unexpected founding root ${unit.id}/${state.step}`);
    }
    if (unit.mode === "off" && id !== founder) {
      throw Error(`mutation-off lineage drift ${unit.id}/${state.step}`);
    }
    if (
      id === founder &&
      simHex(
          decodeGenome(
            Array.from(
              { length: GENOME_CHANNELS },
              (_, g) => state.genome[g * n + i],
            ),
          ),
        ) !== unit.founderHex
    ) throw Error(`founder genome identity drift ${unit.id}/${state.step}`);
  }
}
export function checkpointPaths(dir: string, step: number) {
  return {
    checkpoint: join(dir, checkpointName(step)),
    edges: join(dir, edgesName(step)),
    receipt: join(dir, receiptName(step)),
  };
}
async function verifyCheckpointInventory(dir: string): Promise<void> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    throw e;
  }
  const expected = new Set(
    CHECKPOINT_STEPS.flatMap((
      step,
    ) => [checkpointName(step), edgesName(step), receiptName(step)]),
  );
  expected.add("verified-chain-cache.json");
  for (const entry of entries) {
    if (!entry.isFile || !expected.has(entry.name)) {
      throw Error(
        `unexpected/partial checkpoint artifact ${dir}/${entry.name}`,
      );
    }
  }
}
export async function writeCheckpoint(
  dir: string,
  manifest: Manifest,
  unit: Unit,
  state: WorldState,
  edgeDelta: MutationEdge[],
  cumulativeEdges: MutationEdge[],
  prior: LoadedCheckpoint | null,
): Promise<LoadedCheckpoint> {
  const step = state.step;
  if (
    !CHECKPOINT_STEPS.includes(step) ||
    (prior ? prior.state.step + 100_000 !== step : step !== 0)
  ) throw Error("checkpoint chain step mismatch");
  if (!same(cumulativeEdges, [...(prior?.edges ?? []), ...edgeDelta])) {
    throw Error("mutation edge delta does not extend parent chain");
  }
  const expected = discoveryEvolutionWorld(
    unit.seed,
    unit.mode,
    unit.founderHex,
  );
  if (!same(state.cfg, expected.state.cfg)) {
    throw Error("checkpoint configuration drift");
  }
  if (step === 0 && stateHash(state) !== stateHash(expected.state)) {
    throw Error("initial physical state drift");
  }
  validateCheckpointBiology(
    state,
    unit,
    edgeDelta,
    cumulativeEdges,
    prior?.state.step ?? -1,
  );
  const sample = sampleAt(state, unit, cumulativeEdges, step);
  const observer = {
    experiment: "discovery-improvement/v1",
    manifestHash: manifest.manifestHash,
    unitId: unit.id,
    step,
    previousReceiptSha256: prior?.receiptSha256 ?? null,
  };
  const checkpoint = encodeCheckpoint(state, observer);
  const edges = new TextEncoder().encode(JSON.stringify(edgeDelta) + "\n");
  const receipt: CheckpointReceipt = {
    format: "discovery-improvement-checkpoint/v1",
    manifestHash: manifest.manifestHash,
    unitId: unit.id,
    step,
    stateHash: stateHash(state),
    checkpointSha256: sha256(checkpoint),
    edgeDeltaSha256: sha256(edges),
    previousReceiptSha256: prior?.receiptSha256 ?? null,
    sample,
  };
  const receiptBytes = new TextEncoder().encode(JSON.stringify(receipt) + "\n");
  const paths = checkpointPaths(dir, step);
  // The receipt is the commit marker. Any partial interval is diagnosed on resume.
  await writeNew(paths.checkpoint, checkpoint);
  await writeNew(paths.edges, edges);
  await writeNew(paths.receipt, receiptBytes);
  return {
    state,
    edges: cumulativeEdges,
    receipt,
    receiptSha256: sha256(receiptBytes),
    samples: {
      ...(prior?.samples ?? {}),
      ...(sample ? { [step]: sample } : {}),
    },
  };
}
export async function loadCheckpointChain(
  dir: string,
  manifest: Manifest,
  unit: Unit,
): Promise<LoadedCheckpoint | null> {
  await verifyCheckpointInventory(dir);
  let previous: LoadedCheckpoint | null = null;
  let gap = false;
  for (const step of CHECKPOINT_STEPS) {
    const paths = checkpointPaths(dir, step);
    const [checkpointBytes, edgeBytes, receiptBytes] = await Promise.all([
      optionalBytes(paths.checkpoint),
      optionalBytes(paths.edges),
      optionalBytes(paths.receipt),
    ]);
    if (
      checkpointBytes === null && edgeBytes === null && receiptBytes === null
    ) {
      gap = true;
      continue;
    }
    if (
      gap || checkpointBytes === null || edgeBytes === null ||
      receiptBytes === null
    ) throw Error(`incomplete/noncontiguous checkpoint ${unit.id}/${step}`);
    const receipt = JSON.parse(
      new TextDecoder().decode(receiptBytes),
    ) as CheckpointReceipt;
    if (
      receipt.format !== "discovery-improvement-checkpoint/v1" ||
      receipt.manifestHash !== manifest.manifestHash ||
      receipt.unitId !== unit.id || receipt.step !== step ||
      receipt.previousReceiptSha256 !== (previous?.receiptSha256 ?? null) ||
      receipt.checkpointSha256 !== sha256(checkpointBytes) ||
      receipt.edgeDeltaSha256 !== sha256(edgeBytes)
    ) throw Error(`checkpoint receipt identity/hash drift ${unit.id}/${step}`);
    const decoded = decodeCheckpoint(checkpointBytes);
    const state = decoded.state;
    if (
      state.step !== step || stateHash(state) !== receipt.stateHash ||
      !same(state.cfg, discoveryEvolutionConfig(unit.seed, unit.mode))
    ) throw Error(`checkpoint physical state drift ${unit.id}/${step}`);
    if (
      !same(decoded.observer, {
        experiment: "discovery-improvement/v1",
        manifestHash: manifest.manifestHash,
        unitId: unit.id,
        step,
        previousReceiptSha256: previous?.receiptSha256 ?? null,
      })
    ) throw Error(`checkpoint provenance drift ${unit.id}/${step}`);
    if (
      step === 0 &&
      stateHash(state) !==
        stateHash(
          discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state,
        )
    ) throw Error(`initial physical state drift ${unit.id}`);
    const delta = JSON.parse(
      new TextDecoder().decode(edgeBytes),
    ) as MutationEdge[];
    if (
      !Array.isArray(delta) || step === 0 && delta.length !== 0 ||
      unit.mode === "off" && delta.length !== 0
    ) throw Error(`invalid mutation delta ${unit.id}/${step}`);
    const parent = previous as LoadedCheckpoint | null;
    const allEdges: MutationEdge[] = [...(parent?.edges ?? []), ...delta];
    validateCheckpointBiology(
      state,
      unit,
      delta,
      allEdges,
      parent?.state.step ?? -1,
    );
    const sample = sampleAt(state, unit, allEdges, step);
    if (!same(receipt.sample, sample)) {
      throw Error(`scheduled sample drift ${unit.id}/${step}`);
    }
    previous = {
      state,
      edges: allEdges,
      receipt,
      receiptSha256: sha256(receiptBytes),
      samples: {
        ...(parent?.samples ?? {}),
        ...(sample ? { [step]: sample } : {}),
      },
    };
  }
  return previous;
}
export async function writeVerifiedChainCache(
  dir: string,
  manifest: Manifest,
  unit: Unit,
  latest: LoadedCheckpoint,
): Promise<void> {
  if (
    latest.state.step !== 1_000_000 || !TIMES.every((t) => latest.samples[t])
  ) throw Error("cannot cache incomplete checkpoint chain");
  const path = join(dir, "verified-chain-cache.json");
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: "discovery-improvement-verified-chain/v1",
      manifestHash: manifest.manifestHash,
      unitId: unit.id,
      finalReceiptSha256: latest.receiptSha256,
      samples: latest.samples,
    }) + "\n",
  );
  const prior = await optionalBytes(path);
  if (prior) {
    if (sha256(prior) !== sha256(bytes)) {
      throw Error(`verified chain cache drift ${unit.id}`);
    }
    return;
  }
  await writeNew(path, bytes);
}
export async function loadVerifiedChainCache(
  dir: string,
  manifest: Manifest,
  unit: Unit,
): Promise<LoadedCheckpoint | null> {
  await verifyCheckpointInventory(dir);
  const cacheBytes = await optionalBytes(
    join(dir, "verified-chain-cache.json"),
  );
  if (!cacheBytes) return null;
  const cache = JSON.parse(new TextDecoder().decode(cacheBytes)) as {
    format: string;
    manifestHash: string;
    unitId: string;
    finalReceiptSha256: string;
    samples: Record<number, Sample>;
  };
  if (
    cache.format !== "discovery-improvement-verified-chain/v1" ||
    cache.manifestHash !== manifest.manifestHash || cache.unitId !== unit.id ||
    !TIMES.every((t) => cache.samples[t])
  ) throw Error(`verified chain cache identity drift ${unit.id}`);
  let previousSha: string | null = null, final: LoadedCheckpoint | null = null;
  for (const step of CHECKPOINT_STEPS) {
    const paths = checkpointPaths(dir, step);
    const [checkpointBytes, edgeBytes, receiptBytes] = await Promise.all([
      optionalBytes(paths.checkpoint),
      optionalBytes(paths.edges),
      optionalBytes(paths.receipt),
    ]);
    if (!checkpointBytes || !edgeBytes || !receiptBytes) {
      throw Error(`verified checkpoint missing ${unit.id}/${step}`);
    }
    const receipt = JSON.parse(
      new TextDecoder().decode(receiptBytes),
    ) as CheckpointReceipt;
    if (
      receipt.format !== "discovery-improvement-checkpoint/v1" ||
      receipt.manifestHash !== manifest.manifestHash ||
      receipt.unitId !== unit.id || receipt.step !== step ||
      receipt.previousReceiptSha256 !== previousSha ||
      receipt.checkpointSha256 !== sha256(checkpointBytes) ||
      receipt.edgeDeltaSha256 !== sha256(edgeBytes) ||
      !same(receipt.sample, cache.samples[step] ?? null)
    ) throw Error(`verified checkpoint drift ${unit.id}/${step}`);
    previousSha = sha256(receiptBytes);
    if (step === 1_000_000) {
      const decoded = decodeCheckpoint(checkpointBytes);
      if (
        decoded.state.step !== step ||
        stateHash(decoded.state) !== receipt.stateHash ||
        !same(decoded.state.cfg, discoveryEvolutionConfig(unit.seed, unit.mode))
      ) throw Error(`verified final physical state drift ${unit.id}`);
      final = {
        state: decoded.state,
        edges: [],
        receipt,
        receiptSha256: previousSha,
        samples: cache.samples,
      };
    }
  }
  if (previousSha !== cache.finalReceiptSha256 || !final) {
    throw Error(`verified chain final receipt drift ${unit.id}`);
  }
  return final;
}
export function assayCacheKey(
  descendantHex: string,
  founderHex: string,
  seed: number,
  assignment: number,
  sourceManifestHash: string,
): string {
  if (
    !hex64.test(sourceManifestHash) || !ASSAY_SEEDS.includes(seed) ||
    !Number.isInteger(assignment) || assignment < 0 || assignment > 3
  ) throw Error("invalid assay cache identity");
  return sha256(
    JSON.stringify({
      descendantHex,
      founderHex,
      cfg: discoveryCompetitionConfig(seed),
      seed,
      assignment,
      steps: ASSAY_STEPS,
      sourceManifestHash,
    }),
  );
}
export function requestsFromSamples(
  manifest: Manifest,
  samples: Readonly<Record<string, Readonly<Record<number, Sample>>>>,
): { draws: DrawRequest[]; assays: AssayRequest[]; uniqueKeys: string[] } {
  const draws: DrawRequest[] = [],
    assays: AssayRequest[] = [],
    unique = new Set<string>();
  for (const unit of manifest.units) {
    for (let t = 0; t < TIMES.length; t++) {
      for (let draw = 0; draw < 2; draw++) {
        const time = TIMES[t], sample = samples[unit.id]?.[time];
        let status: DrawRequest["status"] = "missing",
          descendantHex: string | null = null;
        if (sample) {
          if (
            sample.time !== time || !same(sample.drawSeeds, unit.drawSeeds[t])
          ) throw Error(`sample seed/time drift ${unit.id}/${time}`);
          if (sample.draws.status === "present") {
            status = "scheduled";
            descendantHex = sample.draws.genomes[draw] ?? null;
            if (!descendantHex) {
              throw Error("present sample missing draw genome");
            }
          } else status = sample.draws.status;
        }
        const id = `${unit.id}-t${time}-d${draw}`;
        draws.push({
          id,
          unitId: unit.id,
          founderId: unit.founderId,
          founderHex: unit.founderHex,
          seed: unit.seed,
          mode: unit.mode,
          time,
          draw,
          sampleSeed: unit.drawSeeds[t][draw],
          status,
          descendantHex,
        });
      }
    }
  }
  for (const request of draws) {
    for (const assaySeed of ASSAY_SEEDS) {
      for (let assignment = 0; assignment < 4; assignment++) {
        const key = request.status === "scheduled"
          ? assayCacheKey(
            request.descendantHex!,
            request.founderHex,
            assaySeed,
            assignment,
            manifest.sourceManifestHash,
          )
          : null;
        if (key) unique.add(key);
        assays.push({
          id: `${request.id}-s${assaySeed}-a${assignment}`,
          drawId: request.id,
          assaySeed,
          assignment,
          status: request.status,
          cacheKey: key,
        });
      }
    }
  }
  if (draws.length !== 384 || assays.length !== 6144) {
    throw Error("incomplete assay request roster");
  }
  return { draws, assays, uniqueKeys: [...unique] };
}
export function validateAssayResult(
  raw: AssayResult,
  key: string,
  descendantHex: string,
  founderHex: string,
  seed: number,
  assignment: number,
  sourceManifestHash: string,
): AssayResult {
  if (
    key !==
      assayCacheKey(
        descendantHex,
        founderHex,
        seed,
        assignment,
        sourceManifestHash,
      )
  ) throw Error(`assay cache key drift ${key}`);
  if (
    !raw || raw.format !== "discovery-improvement-assay/v1" ||
    raw.cacheKey !== key || raw.sourceManifestHash !== sourceManifestHash ||
    raw.descendantHex !== descendantHex || raw.founderHex !== founderHex ||
    raw.seed !== seed || raw.assignment !== assignment ||
    raw.steps !== ASSAY_STEPS ||
    !same(raw.cfg, discoveryCompetitionConfig(seed)) ||
    !/^[0-9a-f]{16}$/.test(raw.initialStateHash) ||
    !/^[0-9a-f]{16}$/.test(raw.finalStateHash) ||
    !Number.isFinite(raw.elapsedSeconds) || raw.elapsedSeconds <= 0
  ) throw Error(`assay cache identity drift ${key}`);
  for (
    const value of [raw.descendantMass, raw.ancestorMass, raw.unassociatedMass]
  ) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw Error(`invalid assay mass ${key}`);
    }
  }
  const score = competitionScore(raw.descendantMass, raw.ancestorMass);
  if (
    raw.status !== score.status ||
    raw.score !== (score.status === "scored" ? score.value : null)
  ) throw Error(`assay score drift ${key}`);
  if (
    raw.initialStateHash !==
      stateHash(
        discoveryCompetitionWorld(
          discoveryCompetitionConfig(seed),
          descendantHex,
          founderHex,
          assignment,
        ).state,
      )
  ) throw Error(`assay initial state drift ${key}`);
  return raw;
}
export function analyzeScores(
  manifest: Manifest,
  roster: ReturnType<typeof requestsFromSamples>,
  results: Readonly<Record<string, AssayResult | null>>,
  samples: Readonly<Record<string, Readonly<Record<number, Sample>>>>,
) {
  const byDraw = new Map(roster.draws.map((d) => [d.id, d]));
  const observations = roster.assays.map((request) => {
    const draw = byDraw.get(request.drawId)!;
    const result = request.cacheKey ? results[request.cacheKey] : null;
    if (result && request.cacheKey) {
      validateAssayResult(
        result,
        request.cacheKey,
        draw.descendantHex!,
        draw.founderHex,
        request.assaySeed,
        request.assignment,
        manifest.sourceManifestHash,
      );
    }
    const status = request.status !== "scheduled"
      ? request.status
      : !result
      ? "missing"
      : result.status;
    return {
      id: request.id,
      drawId: request.drawId,
      unitId: draw.unitId,
      founderId: draw.founderId,
      seed: draw.seed,
      mode: draw.mode,
      time: draw.time,
      draw: draw.draw,
      sampleSeed: draw.sampleSeed,
      assaySeed: request.assaySeed,
      assignment: request.assignment,
      cacheKey: request.cacheKey,
      status,
      score: result?.score ?? null,
    };
  });
  const observationsByUnitTime = new Map<string, typeof observations>();
  for (const observation of observations) {
    const key = `${observation.unitId}/${observation.time}`;
    const group = observationsByUnitTime.get(key) ?? [];
    group.push(observation);
    observationsByUnitTime.set(key, group);
  }
  const rowByTime = new Map<number, ImprovementRow[]>();
  for (const time of TIMES) {
    const rows: ImprovementRow[] = [];
    for (const unit of manifest.units) {
      const group = observationsByUnitTime.get(`${unit.id}/${time}`) ?? [];
      if (
        group.length !== 32 ||
        group.some((o, i) =>
          o.draw !== Math.floor(i / 16) ||
          o.assaySeed !== ASSAY_SEEDS[Math.floor(i % 16 / 4)] ||
          o.assignment !== i % 4
        )
      ) throw Error(`score mapping drift ${unit.id}/${time}`);
      const sample = samples[unit.id]?.[time];
      const retained = !sample
        ? null
        : sample.rootMass > 0
        ? true
        : sample.draws.status === "absent"
        ? false
        : null;
      rows.push({
        founderId: unit.founderId,
        seedId: unit.seed,
        mode: unit.mode,
        retained,
        technicalComplete: group.every((o) =>
          o.status !== "missing" && o.status !== "unresolved"
        ),
        scores: group.map((o) => o.score),
      });
    }
    rowByTime.set(time, rows);
  }
  const rows = rowByTime.get(1_000_000)!;
  const summary = summarizeDiscoveryImprovement({
    founderIds: manifest.founders.map((f) => f.id),
    seedIds: EVOLUTION_SEEDS,
    expectedScoresPerRow: 32,
    rows,
    bootstrapSeed: BOOTSTRAP_SEED,
    bootstrapResamples: 10_000,
  });
  const certifiedBlocks = summary.bySeed.filter((b) => b.lower > 0.10).length;
  const allMissingTechnical = observations.filter((o) =>
    o.status === "missing" || o.status === "unresolved"
  ).map((o) => o.id);
  const technicalComplete = summary.technicalEvidenceComplete &&
    allMissingTechnical.length === 0;
  const rowBounds = (row: ImprovementRow) => {
    const lower = row.scores.reduce<number>((a, x) => a + (x ?? -1), 0) / 32;
    const upper = row.scores.reduce<number>((a, x) => a + (x ?? 1), 0) / 32;
    return {
      lower,
      upper,
      point: row.scores.every((x) => x !== null) ? lower : null,
    };
  };
  const byTime = TIMES.map((time) => {
    const timeRows = rowByTime.get(time)!;
    const byFounder = manifest.founders.map((founder) => {
      const pairs = EVOLUTION_SEEDS.map((seed) => {
        const normal = rowBounds(
          timeRows.find((r) =>
            r.founderId === founder.id && r.seedId === seed &&
            r.mode === "normal"
          )!,
        );
        const off = rowBounds(
          timeRows.find((r) =>
            r.founderId === founder.id && r.seedId === seed && r.mode === "off"
          )!,
        );
        return {
          seed,
          lower: normal.lower - off.upper,
          upper: normal.upper - off.lower,
          point: normal.point === null || off.point === null
            ? null
            : normal.point - off.point,
        };
      });
      const available = pairs.filter((p) => p.point !== null);
      const retention = (mode: EvolutionMode) => {
        const values = timeRows.filter((r) =>
          r.founderId === founder.id && r.mode === mode
        ).map((r) => r.retained);
        const knownTrue = values.filter((v) => v === true).length,
          unknown = values.filter((v) => v === null).length;
        return {
          retained: knownTrue,
          absent: values.filter((v) => v === false).length,
          unknown,
          lower: knownTrue / 8,
          upper: (knownTrue + unknown) / 8,
        };
      };
      const normalRetention = retention("normal"),
        offRetention = retention("off");
      return {
        founderId: founder.id,
        availablePairs: available.length,
        totalPairs: 8,
        conditionalEffect: available.length
          ? available.reduce((a, p) => a + p.point!, 0) / available.length
          : null,
        lower: pairs.reduce((a, p) => a + p.lower, 0) / 8,
        upper: pairs.reduce((a, p) => a + p.upper, 0) / 8,
        retention: {
          normal: normalRetention,
          off: offRetention,
          difference: {
            lower: normalRetention.lower - offRetention.upper,
            upper: normalRetention.upper - offRetention.lower,
          },
        },
        pairs,
      };
    });
    const timeObs = observations.filter((o) => o.time === time);
    const abundance = manifest.units.map((u) => ({
      unitId: u.id,
      founderId: u.founderId,
      seed: u.seed,
      mode: u.mode,
      sample: samples[u.id]?.[time] ?? null,
    }));
    return {
      time,
      role: time === 1_000_000
        ? "confirmatory"
        : time === 0
        ? "calibration"
        : "descriptive",
      byFounder,
      abundance,
      requestedAssays: timeObs.length,
      scoredAssays: timeObs.filter((o) => o.status === "scored").length,
      bothExtinctAssays: timeObs.filter((o) =>
        o.status === "both-extinct"
      ).length,
      absentAssays: timeObs.filter((o) => o.status === "absent").length,
      unresolvedAssays: timeObs.filter((o) => o.status === "unresolved").length,
      missingAssays: timeObs.filter((o) => o.status === "missing").length,
    };
  });
  return {
    format: "discovery-improvement-analysis/v1",
    manifestHash: manifest.manifestHash,
    requestedDraws: roster.draws.length,
    requestedAssays: roster.assays.length,
    distinctConfigurations: roster.uniqueKeys.length,
    observations,
    byTime,
    rows,
    summary,
    technicalComplete,
    certifiedBlocks,
    repeatabilityCriterionMet: technicalComplete && certifiedBlocks >= 7,
    exactOneSidedSignTail: 9 / 256,
    interpretation: !technicalComplete
      ? "technically incomplete"
      : certifiedBlocks >= 7
      ? "typical seed-block improvement conditional on fixed founders and assay seeds; inspect mean and retention tradeoffs"
      : "repeatability criterion not met; this does not establish no adaptation",
  };
}
