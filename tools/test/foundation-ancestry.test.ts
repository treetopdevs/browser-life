import { describe, expect, it } from "vitest";
import { METRICS_VERSION, PRESETS, DEFAULT_RULE_VERSION, SCHEMA_VERSION, presetIdentity, stateHash, initWorld } from "@bl/schema";
import { runId, specConfig, type RunSpec } from "@bl/runner";
import {
  buildMutationOriginMap,
  summarizeAncestryCensus,
  validateAndDeriveInitialOrigins,
  type InitialFounderOrigin,
  type MutationOriginEdge,
  type SourceManifest,
} from "../lib/foundation-ancestry.ts";

const initial: InitialFounderOrigin[] = [
  { lineageId: "0:1", founderLineageId: "0:1", founderInstanceIndex: 0, genomeFounderIndex: 0, initialGenomeKey: "same-genome" },
  { lineageId: "0:2", founderLineageId: "0:2", founderInstanceIndex: 1, genomeFounderIndex: 0, initialGenomeKey: "same-genome" },
];
const bounds = { finalStep: 1_000, cellCount: 100 };

describe("mutation ancestry", () => {
  it("derives founder instances from the recorded preset initialization, not genome-set length", () => {
    const spec: RunSpec = { experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
      steps: 1_000_000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
    const preset = PRESETS.find((p) => p.id === spec.presetId)!;
    const cfg = specConfig(spec), initialState = initWorld(cfg, preset.init);
    const manifest: SourceManifest = { runId: runId(spec), spec, cfg, init: preset.init,
      initHash: stateHash(initialState), presetIdentity: presetIdentity(preset), schemaVersion: SCHEMA_VERSION,
      ruleVersion: DEFAULT_RULE_VERSION, metricsVersion: METRICS_VERSION, startStep: 0,
      summary: { steps: spec.steps, mutations: 0, conservationOk: true } };
    const result = validateAndDeriveInitialOrigins(manifest);
    expect(result.origins).toHaveLength(preset.init.founders);
    expect(result.origins.map((x) => x.founderInstanceIndex)).toEqual(Array.from({ length: preset.init.founders }, (_, i) => i));
    expect(result.origins.map((x) => x.genomeFounderIndex)).toEqual(Array.from({ length: preset.init.founders }, (_, i) => i % 12));
    expect(result.identity.declaredFounderInstances).toBe(preset.init.founders);
    expect(result.identity.visibleInitialLineages).toBeGreaterThan(0);
  });

  it("keeps founder instances distinct when their initial genomes are identical", () => {
    const origins = buildMutationOriginMap(initial, [], bounds);
    expect(origins.get("0:1")).toMatchObject({ founderInstanceIndex: 0, genomeFounderIndex: 0 });
    expect(origins.get("0:2")).toMatchObject({ founderInstanceIndex: 1, genomeFounderIndex: 0 });
    expect(origins.get("0:1")?.founderLineageId).not.toBe(origins.get("0:2")?.founderLineageId);
  });

  it("rejects a child whose parent is neither an initial founder nor an earlier event", () => {
    const edges: MutationOriginEdge[] = [{ childLineageId: "8:9", parentLineageId: "4:7" }];
    expect(() => buildMutationOriginMap(initial, edges, bounds)).toThrow(/unknown or non-prior parent/);
  });

  it("rejects duplicate child IDs and noncausal event order", () => {
    const duplicate: MutationOriginEdge[] = [
      { childLineageId: "8:9", parentLineageId: "0:1" },
      { childLineageId: "8:9", parentLineageId: "0:2" },
    ];
    expect(() => buildMutationOriginMap(initial, duplicate, bounds)).toThrow(/duplicate mutation child/);
    const noncausal: MutationOriginEdge[] = [
      { childLineageId: "4:8", parentLineageId: "0:1" },
      { childLineageId: "3:9", parentLineageId: "0:1" },
    ];
    expect(() => buildMutationOriginMap(initial, noncausal, bounds)).toThrow(/out of causal order/);
  });

  it("distinguishes a missing census from a recorded zero-extant census", () => {
    const origins = buildMutationOriginMap(initial, [], bounds);
    expect(summarizeAncestryCensus(100, null, [], origins, bounds.cellCount)).toMatchObject({ status: "missing-census", declaredLineages: null,
      observedLineages: null, observedCells: null, founders: null });
    expect(summarizeAncestryCensus(500, 0, [], origins, bounds.cellCount)).toMatchObject({ status: "zero-extant", declaredLineages: 0, observedLineages: 0 });
  });

  it("retains mutation-event depth even when a mutation leaves the genome unchanged", () => {
    const origins = buildMutationOriginMap(initial, [
      { childLineageId: "2:9", parentLineageId: "0:1" },
      { childLineageId: "3:10", parentLineageId: "2:9" },
    ], bounds);
    const result = summarizeAncestryCensus(900, 1, [{ step: 900, lineageId: "3:10", cells: 7 }], origins, bounds.cellCount);
    expect(result.status).toBe("observed");
    expect(result.founders![0]).toMatchObject({ founderInstanceIndex: 0, genomeFounderIndex: 0,
      extantLineages: 1, extantCells: 7, maxMutationEventDepth: 2, cellWeightedMeanMutationEventDepth: 2 });
  });

  it("rejects a positive declared lineage count when census rows are absent", () => {
    const origins = buildMutationOriginMap(initial, [], bounds);
    expect(() => summarizeAncestryCensus(100, 2, [], origins, bounds.cellCount)).toThrow(/lineage row count/);
  });

  it("rejects mutation IDs beyond the source step or cell-index bounds", () => {
    expect(() => buildMutationOriginMap(initial, [{ childLineageId: "1001:3", parentLineageId: "0:1" }], bounds))
      .toThrow(/after source final step/);
    expect(() => buildMutationOriginMap(initial, [{ childLineageId: "4:100", parentLineageId: "0:1" }], bounds))
      .toThrow(/outside source cell\/namespace bounds/);
  });

  it("rejects future-born lineages and census cell totals beyond world capacity", () => {
    const origins = buildMutationOriginMap(initial, [{ childLineageId: "101:3", parentLineageId: "0:1" }], bounds);
    expect(() => summarizeAncestryCensus(100, 1, [{ step: 100, lineageId: "101:3", cells: 1 }], origins, 100))
      .toThrow(/born after census step/);
    const founders = buildMutationOriginMap(initial, [], bounds);
    expect(() => summarizeAncestryCensus(100, 2, [
      { step: 100, lineageId: "0:1", cells: 60 }, { step: 100, lineageId: "0:2", cells: 50 },
    ], founders, 100)).toThrow(/exceed world cell count/);
  });
});
