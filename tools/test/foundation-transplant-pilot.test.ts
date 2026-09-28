import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, M3_FOUNDERS, buildWorld, cellCount, founderGenome, stateHash, totalsOf, type WorldState } from "@bl/schema";
import { OBSERVATION_FILES, sha256, type FileDigest, type ReplayCacheManifest } from "../lib/foundation-replay.ts";
import { EXTRACTOR_SOURCE_FILES, type ExtractionCatalog, type ExtractionRule } from "../lib/foundation-extract.ts";
import {
  CONTROL_GARDEN_SEED, FIRST_GARDEN_SEED, PILOT_STEPS, PilotTimeCapError, assertShamMatch, classifyCandidateOutcome,
  focalSnapshot, founderControlStates, freshGarden, gardenSpec,
  interruptedCandidateStatus, parsePilotArgs, planPilot,
} from "../foundation-transplant-pilot.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const digest = (s: string) => sha256(bytes(s));
const rule: ExtractionRule = { version: 1, selectionSeed: "fixed", perStratumPerTime: 3,
  strata: [{ id: "rare", minCells: 1, maxCells: 9 }, { id: "common", minCells: 10, maxCells: null }],
  censusThreshold: 48, minComponentMass: 256 };

function fixture() {
  const names = ["manifest.json", ...OBSERVATION_FILES];
  const sourceFiles = Object.fromEntries(names.map((name) => [name, digest(name)]));
  const codeFiles = Object.fromEntries(EXTRACTOR_SOURCE_FILES.map((name) => [name, digest(name)]));
  const spec = { experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
    steps: 1_000_000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
  const cache = { status: "verified", observerCompatible: true, requestedSteps: [...PILOT_STEPS],
    source: { runId: "m4/gradient-m3/treatment/seed-1", spec, files: structuredClone(sourceFiles), codeRevision: "frozen",
      finalHashMode: "artifact",
      presetIdentity: "preset", versions: { schema: 3, rule: 1, metrics: 2 } },
    final: { matchedSource: true, artifactHash: "a".repeat(16) },
    checkpoints: PILOT_STEPS.map((step) => ({ step, file: `checkpoints/t${String(step).padStart(9, "0")}.blck`,
      fileDigest: digest(`checkpoint-${step}`) })) } as unknown as ReplayCacheManifest;
  const ruleFile = digest("rule");
  const catalog = { format: 1, status: "catalog-only", usable: true, observerCompatible: true,
    sourceRunId: cache.source.runId, cacheFinalArtifactHash: cache.final!.artifactHash,
    rule, ruleFileSha256: ruleFile.sha256, sourceFiles: structuredClone(sourceFiles),
    provenance: { sourceSpec: spec, sourceCodeRevision: "frozen", sourcePresetIdentity: "preset",
      sourceVersions: { schema: 3, rule: 1, metrics: 2 }, extractorFiles: structuredClone(codeFiles) },
    times: PILOT_STEPS.map((step, t) => ({ step, checkpointFile: cache.checkpoints[t].file,
      checkpointSha256: cache.checkpoints[t].fileDigest.sha256,
      configuration: { tileW: 256, tileH: 256, tilesX: 1, tilesY: 1 },
      components: Array.from({ length: 6 }, (_, i) => ({ idx: 20 + i * 2, tile: 0, cellIndices: [i + 1],
        selected: true, reasons: [] })) })) } as unknown as ExtractionCatalog;
  return { cache, catalog, rule, sourceFiles, ruleFile, codeFiles };
}

const inputs = ["--source", "/source", "--cache", "/cache", "--catalog", "/catalog.json",
  "--rule", "/rule.json", "--out", "/new-output"];

describe("foundation transplant pilot planning", () => {
  it("defaults to a CPU-only plan and requires two explicit execution caps", () => {
    expect(parsePilotArgs(inputs)).toMatchObject({ execute: false, maxSeconds: null, maxCandidates: null });
    expect(() => parsePilotArgs([...inputs, "--execute"])).toThrow(/requires --max-seconds/);
    expect(() => parsePilotArgs([...inputs, "--execute", "--max-seconds", "601", "--max-candidates", "18"])).toThrow(/at most 600/);
    expect(() => parsePilotArgs([...inputs, "--execute", "--max-seconds", "600", "--max-candidates", "19"])).toThrow(/1..18/);
    expect(parsePilotArgs([...inputs, "--execute", "--max-seconds", "600", "--max-candidates", "2"])).toMatchObject({
      execute: true, maxSeconds: 600, maxCandidates: 2 });
  });

  it("fixes all 18 preselected candidates and seed assignment before execution", () => {
    const f = fixture();
    const plan = planPilot(f.cache, f.catalog, f.rule, f.sourceFiles, digest("catalog"), f.ruleFile, f.codeFiles, false, null, null);
    expect(plan.status).toBe("planned");
    expect(plan.shams.map((s) => s.step)).toEqual(PILOT_STEPS);
    expect(plan.controls.map((c) => [c.label, c.gardenSeed, c.founderGenomeIndex])).toEqual([
      ["m3-founder-9", CONTROL_GARDEN_SEED, 9], ["zero-controller", CONTROL_GARDEN_SEED, 9],
    ]);
    expect(plan.controls.map((c) => c.role)).toEqual(["garden-feasibility-comparator", "passive-controller-reference"]);
    expect(plan.execution.controlPopulation).toBe(2);
    expect(plan.execution.selectedPopulation).toBe(18);
    expect(plan.candidates).toHaveLength(18);
    expect(plan.candidates.map((c) => c.gardenSeed)).toEqual(Array.from({ length: 18 }, (_, j) => FIRST_GARDEN_SEED + j));
    expect(plan.candidates.map((c) => [c.step, c.componentIdx])).toEqual(PILOT_STEPS.flatMap((step) =>
      Array.from({ length: 6 }, (_, i) => [step, 20 + 2 * i])));
    expect(plan.execution.claim).toBe("persistence-feasibility-only");
  });

  it("makes evaluator-disc controls with identical physical state, parameters and lineage IDs", () => {
    const { cache } = fixture();
    const { spec, founder, zeroController } = founderControlStates(cache.source);
    expect(spec.seed).toBe(CONTROL_GARDEN_SEED);
    const expected = buildWorld(founder.cfg, { nutrient: 32, founders: [{ x: 128, y: 128, radius: 10,
      genome: founderGenome(M3_FOUNDERS[9]), biomass: 64, energy: 128 }] });
    expect(stateHash(founder)).toBe(stateHash(expected));
    expect([...zeroController.cells]).toEqual([...founder.cells]);
    expect(zeroController.lightIn).toBe(founder.lightIn);
    expect(zeroController.heatOut).toBe(founder.heatOut);
    expect(zeroController.flux).toEqual(founder.flux);
    const n = cellCount(founder.cfg);
    for (let g = 0; g < G.W0; g++)
      expect([...zeroController.genome.subarray(g * n, (g + 1) * n)]).toEqual(
        [...founder.genome.subarray(g * n, (g + 1) * n)]);
    for (let g = G.W0; g < GENOME_CHANNELS; g++)
      expect(zeroController.genome.subarray(g * n, (g + 1) * n).every((v) => v === 0)).toBe(true);
    expect(founder.genome[G.LIN_LO * n + 128 * 256 + 128]).toBe(1);
    expect(totalsOf(founder.cfg, founder.cells)).toEqual(totalsOf(zeroController.cfg, zeroController.cells));
    expect(stateHash(founder)).not.toBe(stateHash(zeroController));
  });

  it("refuses missing selections, reordered times and mismatched source, rule or extractor identity", () => {
    const f = fixture();
    const build = () => planPilot(f.cache, f.catalog, f.rule, f.sourceFiles, digest("catalog"), f.ruleFile, f.codeFiles, false, null, null);
    f.catalog.times[0].components[0].selected = false;
    expect(build).toThrow(/six clean selected/);
    f.catalog.times[0].components[0].selected = true;
    [f.catalog.times[0], f.catalog.times[1]] = [f.catalog.times[1], f.catalog.times[0]];
    expect(build).toThrow(/checkpoint\/geometry mismatch/);
    [f.catalog.times[0], f.catalog.times[1]] = [f.catalog.times[1], f.catalog.times[0]];
    f.sourceFiles["lineages.tsv"] = digest("changed");
    expect(build).toThrow(/lineages.tsv/);
    f.sourceFiles["lineages.tsv"] = digest("lineages.tsv");
    f.ruleFile.sha256 = "0".repeat(64);
    expect(build).toThrow(/identities disagree/);
    f.ruleFile.sha256 = digest("rule").sha256;
    f.codeFiles["packages/metrics/src/census.ts"] = digest("different census");
    expect(build).toThrow(/extractor code identity changed/);
    f.codeFiles["packages/metrics/src/census.ts"] = digest("packages/metrics/src/census.ts");
    f.cache.source.finalHashMode = "physics";
    expect(build).toThrow(/artifact-authenticated/);
  });

  it("mechanical sham requires both physics and observer/observation identity plus conservation", () => {
    const state = freshGarden(gardenSpec(fixture().cache.source, FIRST_GARDEN_SEED));
    state.step = 3000;
    const files = Object.fromEntries(OBSERVATION_FILES.map((name) => [name, digest(name)])) as Record<string, FileDigest>;
    const result = { final: state, observer: { step: 3000 }, summary: { conservationOk: true } } as never;
    expect(() => assertShamMatch(result, result, files, files, 0)).toThrow(/incomplete/);
    expect(assertShamMatch(result, result, files, files, 3000)).toMatchObject({ conservationOk: true, observationHashesMatched: true });
    expect(() => assertShamMatch(result, { ...result, summary: { conservationOk: false } }, files, files, 3000)).toThrow(/nonconserving/);
    expect(() => assertShamMatch(result, result, files, { ...files, "life.jsonl": digest("changed") }, 3000)).toThrow(/mismatch/);
    const altered = { ...result, final: { ...state, cells: state.cells.slice() } as WorldState };
    altered.final.cells[0]++;
    expect(() => assertShamMatch(result, altered, files, files, 3000)).toThrow(/mismatch/);
  });

  it("fresh garden has only registered chemistry and focal snapshots use exact ledgers", () => {
    const f = fixture();
    const spec = gardenSpec(f.cache.source, FIRST_GARDEN_SEED);
    expect(spec.overrides).toMatchObject({ mutRate: 0, lightMode: "uniform", lightBase: 40, lightAmp: 160, seasonAmp: 0 });
    const garden = freshGarden(spec);
    const n = cellCount(garden.cfg);
    expect(garden.cells[CH.A * n]).toBe(32);
    expect(garden.cells[CH.MOT * n]).toBe(128 | (128 << 8));
    expect(garden.lightIn).toBe(0n);
    garden.cells[CH.B * n + 3] = 300;
    garden.cells[CH.P * n + 3] = 100;
    garden.genome[G.LIN_LO * n + 3] = 1;
    const initial = totalsOf(garden.cfg, garden.cells);
    const snap = focalSnapshot(garden, initial.matter, initial.energy);
    expect(snap).toMatchObject({ focalBiomassCells: 1, focalB: "300", focalP: "100", focalBoundMass: "400",
      membraneFraction: 0.25, components: 1, matterResidual: "0", energyResidual: "0" });
  });

  it("marks capped candidates incomplete without treating them as failed viability", () => {
    expect(interruptedCandidateStatus(new PilotTimeCapError("cap"))).toBe("incomplete-time-cap");
    expect(interruptedCandidateStatus(new Error("invalid result"))).toBe("failed");
    const points = Array.from({ length: 30 }, (_, i) => ({ step: (i + 1) * 100, focalB: "200", focalP: "0" }));
    expect(() => classifyCandidateOutcome("100", points.slice(0, 29))).toThrow(/incomplete census/);
    expect(classifyCandidateOutcome("100", points)).toEqual({ survived: true, positiveGrowth: true,
      polymerAtFinalThreeCensuses: false, growthWithLatePolymer: false });
    points[29].focalB = "0";
    expect(classifyCandidateOutcome("100", points).survived).toBe(false);
  });
});
