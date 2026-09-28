import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, FLUX_COUNT, G, GENOME_CHANNELS, artifactDigest, cellCount, type WorldState } from "@bl/schema";
import { b64 } from "@bl/metrics";
import { restoreObservers, serializeObservers, specConfig, type ObserverState, type RunResult, type RunSpec } from "@bl/runner";
import { OBSERVATION_FILES, buildReplayCache, sha256, type ReplayStore, type SourceIdentity } from "../lib/foundation-replay.ts";
import { EXTRACTOR_SOURCE_FILES, assertSourceFilesMatch, buildExtractionCatalog, catalogAtTime, validateExtractionRule, type ExtractionRule } from "../lib/foundation-extract.ts";

const rule: ExtractionRule = { version: 1, selectionSeed: "predeclared-1", perStratumPerTime: 1,
  strata: [{ id: "rare", minCells: 1, maxCells: 9 }, { id: "common", minCells: 10, maxCells: null }],
  censusThreshold: 48, minComponentMass: 256 };
const spec: RunSpec = { experiment: "pilot", presetId: "spots", condition: "treatment", seed: 7,
  steps: 30, censusEvery: 10, deepEvery: 1, checkpointEvery: 0,
  overrides: { tileW: 8, tileH: 8, kernelRadius: 2 } };
const settings = { censusEvery: 10, deepEvery: 1, activityThreshold: null };
const observer = (step: number) => serializeObservers(restoreObservers(undefined, settings), step, settings);
const enc = (s: string) => new TextEncoder().encode(s);
const extractorProvenance = {
  extractorFiles: Object.fromEntries(EXTRACTOR_SOURCE_FILES.map((name) => [name, sha256(enc(name))])),
  sourcePathHint: "/fixture/source", cachePathHint: "/fixture/cache", createdAt: "2026-09-28T00:00:00.000Z",
};

function world(step: number, populated = false, heterogeneous = true): WorldState {
  const cfg = specConfig(spec);
  const n = cellCount(cfg);
  const cells = new Uint32Array(n * CELL_CHANNELS);
  const genome = new Uint32Array(n * GENOME_CHANNELS);
  if (populated) {
    for (const i of [0, 6, 7, 20]) cells[CH.B * n + i] = i === 20 ? 300 : 64;
    for (const i of [0, 7]) {
      genome[G.LIN_HI * n + i] = 1; genome[G.LIN_LO * n + i] = 1;
      genome[G.PARAM0 * n + i] = heterogeneous && i === 7 ? 61 : 60; // same lineage, distinct packed genotype in the pure scanner test
    }
    genome[G.LIN_HI * n + 6] = 2; genome[G.LIN_LO * n + 6] = 2;
    genome[G.LIN_HI * n + 20] = 3; genome[G.LIN_LO * n + 20] = 3;
  }
  return { cfg, step, cells, genome, lightIn: 0n, heatOut: 0n, flux: Array(FLUX_COUNT).fill(0n) };
}

class Store implements ReplayStore {
  files = new Map<string, Uint8Array>();
  reserved = false;
  async reserve() { if (this.reserved) throw new Error("exists"); this.reserved = true; }
  async write(name: string, bytes: Uint8Array) { this.files.set(name, bytes.slice()); }
  async read(name: string) { const bytes = this.files.get(name); if (!bytes) throw new Error(`missing ${name}`); return bytes.slice(); }
}

async function verifiedCache() {
  const final = world(30, true, false);
  const empty = sha256(enc(""));
  const files = Object.fromEntries(["manifest.json", ...OBSERVATION_FILES].map((name) => [name, empty]));
  const source: SourceIdentity = { runId: "pilot/spots/treatment/seed-7", spec, presetIdentity: "fixture",
    versions: { schema: 3, rule: 1, metrics: 2 }, finalHash: artifactDigest(final, observer(30)), finalHashMode: "artifact",
    files, codeRevision: "fixture", replayCodeFiles: { "runner.ts": sha256(enc("fixture")) } };
  const store = new Store();
  const segment = async (segmentSpec: RunSpec, _sink: unknown, start?: WorldState): Promise<RunResult> => {
    const step = (start?.step ?? 0) + segmentSpec.steps;
    const state = world(step, step !== 10, false);
    const obs = observer(step);
    return { final: state, observer: obs, summary: { steps: step, wallSeconds: 0, stepsPerSecond: 0,
      finalHash: artifactDigest(state, obs), mutations: 0, fissions: 0, fusions: 0, buddings: 0,
      maxGeneration: 0, finalIndividuals: 0, finalLineages: 0, extinct: step === 10, conservationOk: true } };
  };
  await buildReplayCache(store, source, [10, 20], async () => segment);
  return { store, source, files };
}

describe("foundation extraction catalog", () => {
  it("requires declared, contiguous abundance strata", () => {
    expect(() => validateExtractionRule(rule)).not.toThrow();
    expect(() => validateExtractionRule({ ...rule, strata: [{ id: "rare", minCells: 1, maxCells: 9 }, { id: "common", minCells: 11, maxCells: null }] })).toThrow(/without gaps/);
    expect(() => validateExtractionRule({ ...rule, perStratumPerTime: -1 })).toThrow(/invalid predeclared/);
  });

  it("keeps toroidal component membership, mixed lineages and heterogeneous packed genomes", () => {
    const state = world(20, true);
    const time = catalogAtTime(state, observer(20), "checkpoint.blck", "a".repeat(64), false, rule);
    expect(time.components[0].cellIndices).toEqual([0, 6, 7]); // wraps x=7 to x=0 on one tile
    expect(time.components[0].reasons).toContain("mixed-or-unassigned-lineage");
    expect(time.components[0].selected).toBe(false);
    expect(time.lineages.find((x) => x.key === "1:1")).toMatchObject({ cells: 2, heterogeneousGenome: true });
    expect(time.lineages.find((x) => x.key === "1:1")?.genotypes).toHaveLength(2);
    expect(time.lineages.find((x) => x.key === "2:2")?.genotypes[0].sha256).toBe(time.lineages.find((x) => x.key === "3:3")?.genotypes[0].sha256);
    expect(time.lineages.find((x) => x.key === "1:1")?.genotypes[0].sha256).not.toBe(time.lineages.find((x) => x.key === "1:1")?.genotypes[1].sha256);
    expect(time.components.find((x) => x.cellIndices.includes(20))).toMatchObject({ boundMass: "300", selected: true });
    expect(time.world.channels.B).toBe("492");
    expect(time.world.matter).toBe("492");
    expect(time.trackerIdentity).toBe("observer-unmatched");
    expect(time.components.every((x) => !x.trackerJoinEligible)).toBe(true);
    expect(time.configuration).toMatchObject({ tileW: 8, tileH: 8, tilesX: 1, tilesY: 1, worldW: 8, worldH: 8,
      energyCoefficients: { eA: state.cfg.eA, eB: state.cfg.eB, eC: state.cfg.eC, eP: state.cfg.eP } });
    expect(time.configuration.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("gates tracker IDs on observation parity and exact census labels", () => {
    const state = world(20, true);
    const obs: ObserverState = observer(20);
    const baseline = catalogAtTime(state, obs, "p", "b".repeat(64), false, rule);
    const labels = new Int32Array(cellCount(state.cfg)).fill(-1);
    for (const i of baseline.components[0].cellIndices) labels[i] = 0;
    for (const i of baseline.components[1].cellIndices) labels[i] = 1;
    obs.tracker.prevLabels = b64(new Uint8Array(labels.buffer));
    obs.tracker.prevIds = [[0, 77], [1, 78]];
    obs.tracker.alive = [77, 78].map((id, idx) => ({ id, parent: null, born: 0, died: null, mass: 300,
      mu: 60, sigma: 20, lineage: idx === 0 ? "1:1" : "3:3", cx: 0, cy: 0, tile: 0, generation: 0 }));
    expect(catalogAtTime(state, obs, "p", "b".repeat(64), false, rule).components.every((x) => x.trackerId === null && !x.trackerJoinEligible)).toBe(true);
    const matched = catalogAtTime(state, obs, "p", "b".repeat(64), true, rule);
    expect(matched.components.map((x) => x.trackerId)).toEqual([77, 78]);
    expect(matched.components.every((x) => x.trackerJoinEligible)).toBe(true);
    expect(matched.components[0].reasons).toContain("mixed-or-unassigned-lineage"); // joined observer ID does not imply clean ancestry
    labels[0] = -1;
    obs.tracker.prevLabels = b64(new Uint8Array(labels.buffer));
    const mismatched = catalogAtTime(state, obs, "p", "b".repeat(64), true, rule);
    expect(mismatched.trackerIdentity).toBe("labels-mismatch");
    expect(mismatched.components.every((x) => x.trackerId === null && !x.trackerJoinEligible)).toBe(true);
  });

  it("retains an empty requested time and rejects source corruption or cache truncation", async () => {
    const { store, files } = await verifiedCache();
    const catalog = await buildExtractionCatalog(store, files, rule, "c".repeat(64), extractorProvenance);
    expect(catalog.times.map((x) => x.step)).toEqual([10, 20]);
    expect(catalog.times[0]).toMatchObject({ extinct: true, livingCells: 0, lineages: [], components: [] });
    expect(catalog.times[1].lineages.length).toBe(3);
    expect(catalog.status).toBe("catalog-only");
    expect(catalog.provenance).toMatchObject({ sourcePathHint: "/fixture/source", cachePathHint: "/fixture/cache",
      sourceVersions: { schema: 3, rule: 1, metrics: 2 }, sourceCodeRevision: "fixture", sourceSpec: spec,
      hashScope: "selected-extractor-and-census-layout-accounting-files;not-complete-dependency-closure" });
    expect(Object.keys(catalog.provenance.extractorFiles)).toEqual(EXTRACTOR_SOURCE_FILES);
    expect(() => assertSourceFilesMatch({ source: { files } } as never, { ...files, "lineages.tsv": sha256(enc("corrupt")) })).toThrow(/lineages.tsv/);
    await expect(buildExtractionCatalog(store, { ...files, "lineages.tsv": sha256(enc("corrupt")) }, rule, "c".repeat(64), extractorProvenance)).rejects.toThrow(/lineages.tsv/);
    const checkpoint = store.files.get("checkpoints/t000000010.blck")!;
    store.files.set("checkpoints/t000000010.blck", checkpoint.slice(0, -4));
    await expect(buildExtractionCatalog(store, files, rule, "c".repeat(64), extractorProvenance)).rejects.toThrow(/SHA-256\/length mismatch/);
  });

  it("rechecks checkpoint bytes used for cataloging after the cache verification pass", async () => {
    const { store, files } = await verifiedCache();
    let reads = 0;
    const changedAfterVerification = { read: async (name: string) => {
      const bytes = await store.read(name);
      if (name === "checkpoints/t000000010.blck" && ++reads === 2) return bytes.slice(0, -4);
      return bytes;
    } };
    await expect(buildExtractionCatalog(changedAfterVerification, files, rule, "c".repeat(64), extractorProvenance)).rejects.toThrow(/changed after cache verification/);
  });

  it("requires selected extractor source hashes and creation provenance", async () => {
    const { store, files } = await verifiedCache();
    const missing = { ...extractorProvenance, extractorFiles: { ...extractorProvenance.extractorFiles } };
    delete missing.extractorFiles["packages/schema/src/layout.ts"];
    await expect(buildExtractionCatalog(store, files, rule, "c".repeat(64), missing)).rejects.toThrow(/layout.ts/);
    await expect(buildExtractionCatalog(store, files, rule, "c".repeat(64),
      { ...extractorProvenance, createdAt: "unparseable" })).rejects.toThrow(/provenance is incomplete/);
  });
});
