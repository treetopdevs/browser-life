import { describe, expect, it } from "vitest";
import { METRICS_VERSION, PRESETS, SCHEMA_VERSION, defaultConfig, initWorld, stateHash } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { ensembleProblems, type Run } from "../lib/bundle.ts";
import { buildManifest, makeSpec } from "../lib/nullgen.ts";
import { checkEligibility, experimentRuleProblems } from "../biogeo-analyze.ts";
import type { ExperimentRun } from "../biogeo-sweep.ts";
import { buildDossier } from "../lib/lineage.ts";
import { cpu } from "./lineage-fixture.ts";

function run(presetId = "spots", seed = 1): Run {
  const spec: RunSpec = { experiment: "compat", presetId, condition: "treatment", seed, steps: 10, censusEvery: 10, deepEvery: 1, checkpointEvery: 0 };
  const cfg = specConfig(spec);
  return { condition: spec.condition, seed, dir: "fixture", series: [{ step: 10 }], manifest: {
    spec, cfg, ruleVersion: cfg.ruleVersion, schemaVersion: SCHEMA_VERSION,
    metricsVersion: METRICS_VERSION, startStep: 0, summary: { steps: 10 },
  } };
}

describe("analysis version compatibility", () => {
  it("accepts version-1 history and homogeneous opt-in version-2 presets", () => {
    expect(ensembleProblems([run()])).toEqual([]);
    const preset = { ...PRESETS[0], id: "test-rule2", cfg: { ...PRESETS[0].cfg, ruleVersion: 2, polymerDrag: true } };
    PRESETS.push(preset);
    try {
      expect(ensembleProblems([run(preset.id)])).toEqual([]);
      expect(ensembleProblems([run(), run(preset.id, 2)]).join("; ")).toMatch(/versions cannot pool/);
    } finally { PRESETS.pop(); }
  });

  it("rejects supported-but-mislabeled and unsupported bundle versions", () => {
    const r = run(); r.manifest.ruleVersion = 2;
    expect(ensembleProblems([r]).join("; ")).toMatch(/differs from config/);
    r.manifest.ruleVersion = 3; r.manifest.cfg.ruleVersion = 3;
    expect(ensembleProblems([r]).join("; ")).toMatch(/unsupported rule/);
  });

  it("writes the actual preset law into synthetic calibration manifests", () => {
    const spec = makeSpec("compat", "treatment", 1, 100, 10, 1);
    const manifest = buildManifest(spec, "fixture", 100, 0, {});
    expect(manifest.cfg.ruleVersion).toBe(1);
    expect(manifest.ruleVersion).toBe(manifest.cfg.ruleVersion);
  });

  it("refuses biogeography pooling across versions and checks each manifest", () => {
    const entry = (version: number): ExperimentRun => ({ runId: "r", arms: ["area"], condition: "treatment", seed: 1, area: 1024, migrationRate: 0,
      config: defaultConfig({ ruleVersion: version, tileW: 32, tileH: 32, kernelRadius: 4 }) });
    for (const version of [1, 2]) {
      const r = entry(version);
      expect(experimentRuleProblems([r])).toEqual([]);
      const manifest = { runId: "r", spec: {}, cfg: r.config, ruleVersion: version, schemaVersion: SCHEMA_VERSION,
        metricsVersion: METRICS_VERSION, summary: { steps: 10, conservationOk: true } };
      const species = [{ step: 10, tile: 0, geneticRichness: 1, livingCells: 1, founderSet: new Set([0]) }];
      expect(checkEligibility(r, manifest, species, 10).eligible).toBe(true);
      manifest.ruleVersion = version === 1 ? 2 : 1;
      expect(checkEligibility(r, manifest, species, 10).problems.join("; ")).toMatch(/differs from config/);
    }
    expect(experimentRuleProblems([entry(1), entry(2)]).join("; ")).toMatch(/cannot pool/);
  });

  it("reconstructs both laws and rejects mismatched lineage metadata", async () => {
    const fixture = cpu();
    for (const version of [1, 2]) {
      const cfg = { ...fixture.cfg, ruleVersion: version };
      const manifest = { ...fixture.manifest, cfg, ruleVersion: version, initHash: stateHash(initWorld(cfg, fixture.manifest.init)) };
      expect((await buildDossier(fixture.source({}, manifest), { kind: "top" })).log.complete).toBe(true);
      await expect(buildDossier(fixture.source({}, { ...manifest, ruleVersion: version === 1 ? 2 : 1 }), { kind: "top" })).rejects.toThrow(/inconsistent rule/);
    }
  });
});
