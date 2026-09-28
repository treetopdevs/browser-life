import { expect, it } from "vitest";
import { growthGenerator, GROWTH_SCENARIOS } from "../lib/m4-growth-generators.ts";
import { analyzeGrowthRuns } from "../lib/m4-growth-runs.ts";
import { buildManifest, makeSpec, type Identity } from "../lib/nullgen.ts";

// Late engineering coverage, added after the independent validation began.
// These fixed development identities are not additional calibration trials.
for (const presetId of ["gradient-m3", "spots-m3"]) {
  it(`carries planted contrasts through the complete activity analysis for ${presetId}`, async () => {
    for (const scenario of GROWTH_SCENARIOS) {
      const seeds = [900101, 900102];
      const runs = seeds.flatMap((seed, seedIndex) =>
        (["treatment", "neutral", "no-mutation"] as const).map(condition => {
          const id: Identity = { masterSeed: 650009001, nullId: scenario,
            windowSteps: 1000000, replicateIndex: 1001, condition, seedIndex };
          return growthGenerator(scenario, id, {
            ...makeSpec("full-path-fixture", condition, seed, 1000000, 100, 10), presetId,
          });
        }));
      const expected = seeds.map(seed => {
        const t = runs.find(r => r.seed === seed && r.condition === "treatment")!;
        return t.manifest.nullcal.generatorParams.difference / 5;
      });
      const report = await analyzeGrowthRuns(runs, seeds, {
        kind: "synthetic", generatorIdentity: `late-engineering:${presetId}:${scenario}`,
      });
      expect(report.threshold.threshold).toBe(presetId === "gradient-m3" ? 10008 : 14613);
      report.perSeed.forEach((row, i) => expect(row.difference).toBeCloseTo(expected[i], 10));
      expect(report.endpoint2.mean).toBeCloseTo((expected[0] + expected[1]) / 2, 10);
      expect(report.endpoint1.complete).toBe(true);
      expect(report.m4).toBe("not-evaluated");
    }
  });
}


// Prescribed lineage snapshots, not physically evolved worlds or extra trials.
for (const presetId of ["gradient-m3", "spots-m3"]) {
  it(`preserves saturation and delayed-onset windows through activity construction for ${presetId}`, async () => {
    const threshold = presetId === "gradient-m3" ? 10008 : 14613;
    const cases = [
      { name: "saturated-before-window", times: [100000, 200000, 300000, 400000], growth: 0 },
      { name: "saturated-inside-window", times: [100000, 400000, 600000, 700000], growth: 2 },
      { name: "rising-through-horizon", times: [100000, 600000, 700000, 800000, 900000, 1000000], growth: 5 },
      { name: "delayed-final-quarter", times: [800000, 900000, 1000000], growth: 3 },
    ];
    for (const fixture of cases) {
      const seeds = [900201, 900202];
      const runs = seeds.flatMap(seed => (["treatment", "neutral", "no-mutation"] as const).map(condition => {
        const spec = { ...makeSpec("shape-full-path", condition, seed, 1000000, 100, 10), presetId };
        const lineages = new Map<number, [string, number][]>();
        for (const step of fixture.times) {
          lineages.set(step, Array.from({ length: 5 }, (_, i): [string, number] => [`episode-${step}-${i}`, threshold + 1]));
        }
        return { seed, condition, dir: "synthetic-shape", lineages,
          series: Array.from({ length: 10000 }, (_, i) => ({ step: (i + 1) * 100 })),
          manifest: buildManifest(spec, fixture.name, 1000000, 0, { fixture: fixture.name }),
        };
      }));
      const report = await analyzeGrowthRuns(runs, seeds, {
        kind: "synthetic", generatorIdentity: `late-shape:${presetId}:${fixture.name}`,
      });
      for (const row of report.perSeed) {
        expect(row.growth).toEqual({ treatment: fixture.growth, neutral: fixture.growth, "no-mutation": fixture.growth });
      }
      expect(report.endpoint2.mean).toBe(0);
      expect(report.endpoint2.status).toBe("degenerate");
      expect(report.endpoint2.supported).toBe(false);
    }
  });
}
