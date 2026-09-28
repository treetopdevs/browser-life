/** Read-only extraction catalog over an authenticated replay cache. No transplant is performed. */
import { createHash } from "node:crypto";
import { G, GENOME_CHANNELS, CELL_CHANNELS, artifactDigest, canonicalConfig, cellCount, stateHash, worldH, worldW, type WorldState } from "@bl/schema";
import { census, unb64 } from "@bl/metrics";
import { decodeArtifact, type ObserverState } from "@bl/runner";
import { OBSERVATION_FILES, sha256, verifyReplayCache, type FileDigest, type ReplayCacheManifest } from "./foundation-replay.ts";

export interface ExtractionRule {
  version: 1;
  selectionSeed: string;
  perStratumPerTime: number;
  /** Closed integer cell-count intervals; null means unbounded above. Must cover 1..∞ without gaps. */
  strata: { id: string; minCells: number; maxCells: number | null }[];
  censusThreshold: number;
  minComponentMass: number;
}

export interface GenotypeRecord {
  /** Biological genotype identity excludes lineage address words 0 and 1. */
  sha256: string;
  /** Exact 44 channel-major packed words for a representative cell, including lineage words. */
  packedWords: number[];
  cellIndices: number[];
}

export interface LineageRecord {
  key: string;
  cells: number;
  boundMass: string;
  stratum: string;
  heterogeneousGenome: boolean;
  genotypes: GenotypeRecord[];
}

export interface ComponentRecord {
  idx: number;
  tile: number;
  cellIndices: number[];
  boundMass: string;
  /** A,B,C,P,E,S quanta at precisely these cell indices. */
  channels: { A: string; B: string; C: string; P: string; E: string; S: string };
  matter: string;
  energy: string;
  lineageCells: Record<string, number>;
  genotypeShas: string[];
  reasons: string[];
  trackerId: number | null;
  /** Exact observer-label join only; says nothing about clean ancestry or reproduction. */
  trackerJoinEligible: boolean;
  stratum: string | null;
  selected: boolean;
  selectionKey: string | null;
}

export interface TimeCatalog {
  step: number;
  checkpointFile: string;
  checkpointSha256: string;
  /** Linear cell index = y * worldW + x; tile geometry is kept explicitly. */
  configuration: {
    canonicalSha256: string;
    tileW: number; tileH: number; tilesX: number; tilesY: number; worldW: number; worldH: number;
    energyCoefficients: { eA: number; eB: number; eC: number; eP: number };
  };
  livingCells: number;
  extinct: boolean;
  trackerIdentity: "matched-labels" | "observer-unmatched" | "labels-mismatch" | "missing-labels";
  /** Whole-world inventory in ledger quanta, including pools outside components. */
  world: { channels: ComponentRecord["channels"]; matter: string; energy: string; lightIn: string; heatOut: string; flux: string[] };
  lineages: LineageRecord[];
  components: ComponentRecord[];
}

export interface ExtractionCatalog {
  format: 1;
  status: "catalog-only";
  usable: true;
  sourceRunId: string;
  sourceFiles: Record<string, FileDigest>;
  cacheFinalArtifactHash: string;
  observerCompatible: boolean;
  rule: ExtractionRule;
  ruleFileSha256: string;
  provenance: ExtractorProvenance & {
    sourceVersions: ReplayCacheManifest["source"]["versions"];
    sourceCodeRevision: string;
    sourceSpec: ReplayCacheManifest["source"]["spec"];
    sourcePresetIdentity: string;
    hashScope: "selected-extractor-and-census-layout-accounting-files;not-complete-dependency-closure";
  };
  times: TimeCatalog[];
}

export const EXTRACTOR_SOURCE_FILES = [
  "tools/foundation-extract.ts", "tools/lib/foundation-extract.ts",
  "packages/metrics/src/census.ts", "packages/schema/src/accounting.ts", "packages/schema/src/layout.ts",
] as const;

export interface ExtractorProvenance {
  extractorFiles: Record<string, FileDigest>;
  sourcePathHint: string;
  cachePathHint: string;
  createdAt: string;
}

export interface ReadOnlyStore { read(name: string): Promise<Uint8Array> }

const hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const shaWords = (words: number[]): string => {
  const genotypeWords = words.slice(2);
  const bytes = new Uint8Array(genotypeWords.length * 4);
  const view = new DataView(bytes.buffer);
  genotypeWords.forEach((word, i) => view.setUint32(i * 4, word, true));
  return hex(bytes);
};
const digestEqual = (a: FileDigest | undefined, b: FileDigest | undefined) => !!a && !!b && a.sha256 === b.sha256 && a.bytes === b.bytes;

export function validateExtractionRule(rule: ExtractionRule): void {
  if (rule.version !== 1 || !rule.selectionSeed?.trim() || !Number.isSafeInteger(rule.perStratumPerTime) || rule.perStratumPerTime < 0 ||
      !Number.isSafeInteger(rule.censusThreshold) || rule.censusThreshold < 1 ||
      !Number.isSafeInteger(rule.minComponentMass) || rule.minComponentMass < rule.censusThreshold || !rule.strata?.length)
    throw new Error("invalid predeclared extraction rule");
  let next = 1;
  const ids = new Set<string>();
  for (let i = 0; i < rule.strata.length; i++) {
    const s = rule.strata[i];
    if (!s.id || ids.has(s.id) || s.minCells !== next || (s.maxCells !== null && (!Number.isSafeInteger(s.maxCells) || s.maxCells < s.minCells)) ||
        (s.maxCells === null && i !== rule.strata.length - 1)) throw new Error("extraction strata must be unique and cover 1..infinity without gaps");
    ids.add(s.id);
    next = s.maxCells === null ? Infinity : s.maxCells + 1;
  }
  if (next !== Infinity) throw new Error("extraction strata must end with an unbounded interval");
}

function stratumFor(rule: ExtractionRule, cells: number): string {
  const s = rule.strata.find((x) => cells >= x.minCells && (x.maxCells === null || cells <= x.maxCells));
  if (!s) throw new Error(`no declared stratum for ${cells} cells`);
  return s.id;
}

function packedGenome(state: WorldState, cell: number): number[] {
  const n = cellCount(state.cfg);
  return Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + cell]);
}

const lineageKey = (state: WorldState, cell: number): string => {
  const n = cellCount(state.cfg);
  const hi = state.genome[G.LIN_HI * n + cell], lo = state.genome[G.LIN_LO * n + cell];
  return hi | lo ? `${hi}:${lo}` : "";
};

function sums(state: WorldState, indices: readonly number[]) {
  const n = cellCount(state.cfg);
  const vals = Array.from({ length: 6 }, (_, ch) => indices.reduce((sum, i) => sum + BigInt(state.cells[ch * n + i]), 0n));
  const [A, B, C, P, E, S] = vals;
  const energy = A * BigInt(state.cfg.eA) + B * BigInt(state.cfg.eB) + C * BigInt(state.cfg.eC) + P * BigInt(state.cfg.eP) + E + S;
  return {
    channels: { A: A.toString(), B: B.toString(), C: C.toString(), P: P.toString(), E: E.toString(), S: S.toString() },
    matter: (A + B + C + P).toString(), energy: energy.toString(), boundMass: (B + P).toString(),
  };
}

function trackerIdentity(labels: Int32Array, observer: ObserverState, compatible: boolean): TimeCatalog["trackerIdentity"] {
  if (!compatible) return "observer-unmatched";
  const saved = observer.tracker.prevLabels;
  if (!saved) return "missing-labels";
  const bytes = unb64(saved);
  if (bytes.byteLength !== labels.byteLength) return "labels-mismatch";
  const prior = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return labels.every((x, i) => x === prior[i]) ? "matched-labels" : "labels-mismatch";
}

export function validateExtractorProvenance(provenance: ExtractorProvenance): void {
  if (!provenance || !provenance.sourcePathHint?.trim() || !provenance.cachePathHint?.trim() ||
      !provenance.createdAt || !Number.isFinite(Date.parse(provenance.createdAt)) ||
      !provenance.extractorFiles) throw new Error("extractor provenance is incomplete");
  for (const name of EXTRACTOR_SOURCE_FILES) {
    const digest = provenance.extractorFiles[name];
    if (!digest || !/^[a-f0-9]{64}$/.test(digest.sha256) || !Number.isSafeInteger(digest.bytes) || digest.bytes < 0)
      throw new Error(`extractor provenance missing SHA-256/length for ${name}`);
  }
}

export function catalogAtTime(state: WorldState, observer: ObserverState, checkpointFile: string, checkpointSha256: string,
  observerCompatible: boolean, rule: ExtractionRule): TimeCatalog {
  validateExtractionRule(rule);
  if (observer.step !== state.step) throw new Error("observer and physics step differ");
  const n = cellCount(state.cfg);
  if (state.cells.length !== n * CELL_CHANNELS || state.genome.length !== n * GENOME_CHANNELS) throw new Error("incomplete physics state");
  const c = census({ cfg: state.cfg, step: state.step, cells: state.cells, genomeHead: state.genome },
    { threshold: rule.censusThreshold, minMass: rule.minComponentMass });
  const members = c.components.map(() => [] as number[]);
  for (let i = 0; i < n; i++) if (c.labels[i] >= 0) members[c.labels[i]].push(i);
  const byLineage = new Map<string, Map<string, GenotypeRecord>>();
  const lineageIndices = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = lineageKey(state, i);
    if (!key) continue;
    const words = packedGenome(state, i);
    const digest = shaWords(words);
    let groups = byLineage.get(key);
    if (!groups) byLineage.set(key, (groups = new Map()));
    let group = groups.get(digest);
    if (!group) groups.set(digest, (group = { sha256: digest, packedWords: words, cellIndices: [] }));
    else if (group.packedWords.slice(2).some((w, j) => w !== words[j + 2])) throw new Error("packed genome SHA-256 collision");
    group.cellIndices.push(i);
    const list = lineageIndices.get(key) ?? [];
    list.push(i);
    lineageIndices.set(key, list);
  }
  const lineages: LineageRecord[] = [...byLineage.entries()].map(([key, groups]) => {
    const cellIndices = lineageIndices.get(key)!;
    return { key, cells: cellIndices.length, boundMass: sums(state, cellIndices).boundMass,
      stratum: stratumFor(rule, cellIndices.length), heterogeneousGenome: groups.size > 1,
      genotypes: [...groups.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const lineagesByKey = new Map(lineages.map((x) => [x.key, x]));
  const identity = trackerIdentity(c.labels, observer, observerCompatible);
  const previousIds = new Map(observer.tracker.prevIds);
  const alive = new Set(observer.tracker.alive.map((x) => x.id));
  const components: ComponentRecord[] = c.components.map((component) => {
    const cellIndices = members[component.idx];
    const resource = sums(state, cellIndices);
    const lineageCells: Record<string, number> = {};
    const genotypeShas = new Set<string>();
    for (const i of cellIndices) {
      const key = lineageKey(state, i) || "background";
      lineageCells[key] = (lineageCells[key] ?? 0) + 1;
      if (key !== "background") genotypeShas.add(shaWords(packedGenome(state, i)));
    }
    const reasons: string[] = [];
    if (BigInt(resource.boundMass) < BigInt(rule.minComponentMass)) reasons.push("below-min-mass");
    if (lineageCells.background) reasons.push("background-admixed");
    if (Object.keys(lineageCells).filter((k) => k !== "background").length !== 1) reasons.push("mixed-or-unassigned-lineage");
    if (genotypeShas.size !== 1) reasons.push("mixed-or-unassigned-genotype");
    const key = Object.keys(lineageCells).find((k) => k !== "background") ?? null;
    const trackerId = identity === "matched-labels" && previousIds.has(component.idx) && alive.has(previousIds.get(component.idx)!)
      ? previousIds.get(component.idx)! : null;
    if (identity === "matched-labels" && trackerId === null) reasons.push("tracker-id-unavailable");
    return {
      idx: component.idx, tile: component.tile, cellIndices, boundMass: resource.boundMass, channels: resource.channels,
      matter: resource.matter, energy: resource.energy, lineageCells,
      genotypeShas: [...genotypeShas].sort(), reasons, trackerId, trackerJoinEligible: trackerId !== null && identity === "matched-labels",
      stratum: key && lineagesByKey.has(key) ? lineagesByKey.get(key)!.stratum : null,
      selected: false, selectionKey: null,
    };
  });
  for (const stratum of rule.strata) {
    const candidates = components.filter((x) => x.reasons.length === 0 && x.stratum === stratum.id)
      .map((x) => ({ record: x, key: hex(`${rule.selectionSeed}|${state.step}|${x.tile}|${x.idx}|${Object.keys(x.lineageCells)[0]}|${x.genotypeShas[0]}`) }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.record.idx - b.record.idx);
    for (const entry of candidates) entry.record.selectionKey = entry.key;
    for (const entry of candidates.slice(0, rule.perStratumPerTime)) entry.record.selected = true;
  }
  const all = Array.from({ length: n }, (_, i) => i);
  const world = sums(state, all);
  return {
    step: state.step, checkpointFile, checkpointSha256, livingCells: c.livingCells, extinct: c.livingCells === 0,
    configuration: {
      canonicalSha256: hex(canonicalConfig(state.cfg)),
      tileW: state.cfg.tileW, tileH: state.cfg.tileH, tilesX: state.cfg.tilesX, tilesY: state.cfg.tilesY,
      worldW: worldW(state.cfg), worldH: worldH(state.cfg),
      energyCoefficients: { eA: state.cfg.eA, eB: state.cfg.eB, eC: state.cfg.eC, eP: state.cfg.eP },
    },
    trackerIdentity: identity,
    world: { channels: world.channels, matter: world.matter, energy: world.energy,
      lightIn: state.lightIn.toString(), heatOut: state.heatOut.toString(), flux: state.flux.map(String) },
    lineages, components,
  };
}

export function assertSourceFilesMatch(cache: ReplayCacheManifest, actual: Record<string, FileDigest>): void {
  for (const name of ["manifest.json", ...OBSERVATION_FILES])
    if (!digestEqual(cache.source.files[name], actual[name])) throw new Error(`source file ${name} differs from authenticated replay cache`);
}

/** Verifies cache and source files before reading any sample. Every requested time appears even if empty. */
export async function buildExtractionCatalog(store: ReadOnlyStore, actualSourceFiles: Record<string, FileDigest>,
  rule: ExtractionRule, ruleFileSha256: string, extractorProvenance: ExtractorProvenance): Promise<ExtractionCatalog> {
  validateExtractionRule(rule);
  validateExtractorProvenance(extractorProvenance);
  if (!/^[a-f0-9]{64}$/.test(ruleFileSha256)) throw new Error("rule file SHA-256 missing");
  const cache = await verifyReplayCache(store);
  assertSourceFilesMatch(cache, actualSourceFiles);
  const times: TimeCatalog[] = [];
  for (const checkpoint of cache.checkpoints) {
    const bytes = await store.read(checkpoint.file);
    if (!digestEqual(sha256(bytes), checkpoint.fileDigest)) throw new Error(`${checkpoint.file}: checkpoint changed after cache verification`);
    const { state, observer } = decodeArtifact(bytes);
    if (state.step !== checkpoint.step || stateHash(state) !== checkpoint.physicsHash || artifactDigest(state, observer) !== checkpoint.artifactHash)
      throw new Error(`${checkpoint.file}: checkpoint identity changed after cache verification`);
    times.push(catalogAtTime(state, observer, checkpoint.file, checkpoint.fileDigest.sha256, cache.observerCompatible === true, rule));
  }
  return { format: 1, status: "catalog-only", usable: true, sourceRunId: cache.source.runId,
    sourceFiles: actualSourceFiles, cacheFinalArtifactHash: cache.final!.artifactHash,
    observerCompatible: cache.observerCompatible === true, rule, ruleFileSha256,
    provenance: { ...extractorProvenance, sourceVersions: cache.source.versions,
      sourceCodeRevision: cache.source.codeRevision, sourceSpec: cache.source.spec,
      sourcePresetIdentity: cache.source.presetIdentity,
      hashScope: "selected-extractor-and-census-layout-accounting-files;not-complete-dependency-closure" },
    times };
}
