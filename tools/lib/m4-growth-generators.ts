// Additional abstract lineage-stream controls. These are not physical worlds.
// Use the established deterministic RNG and synthetic manifest infrastructure.
import { Rng, buildManifest, type Identity } from "./nullgen.ts";
import type { Run } from "./bundle.ts";
import type { RunSpec } from "@bl/runner";
import { ACTIVITY_THRESHOLDS } from "../../experiments/endpoints.ts";
export const GROWTH_SCENARIOS = ["boundarySymmetric", "boundaryRareNegative", "extinctionBoundary", "meanAlternative", "pairedEndpoint1Null"] as const;
export type GrowthScenario = typeof GROWTH_SCENARIOS[number];
export function growthGenerator(scenario: GrowthScenario, id: Identity, spec: RunSpec): Run {
  const paired = { ...id, condition: "shared-pair" };
  const rng = new Rng(paired, "growth-counts-v1");
  const baseline = 20 + Math.floor(30 * rng.u());
  const neutralLate = 1000 + Math.floor((scenario === "pairedEndpoint1Null" ? 10 : 100) * rng.u());
  // Symmetric rounded Gaussian perturbations preserve an exact mean-zero
  // error. Rare-negative contamination has E[noise]=.95*10+.05*(-190)=0.
  const noise = scenario === "boundaryRareNegative" ? (rng.u() < .05 ? -190 : 10) : Math.round(20 * rng.normal());
  const difference = scenario === "pairedEndpoint1Null" ? 2 * noise : (scenario === "meanAlternative" ? 15 : 5) + noise;
  const late = scenario === "pairedEndpoint1Null"
    ? neutralLate + (spec.condition === "treatment" ? noise : -noise)
    : neutralLate + (spec.condition === "treatment" ? difference : 0);
  if (late < 0 || late > 4000) throw new Error("generator count outside declared support; do not silently clip");
  const threshold = ACTIVITY_THRESHOLDS[spec.presetId]?.value;
  if (threshold == null) throw new Error("generator requires frozen threshold");
  const lineages = new Map<number, [string, number][]>();
  const plant = (count: number, offset: number, span: number) => {
    for (let i = 0; i < count; i++) {
      const step = offset + (1 + Math.floor(i * span / count)) * 100;
      const rows = lineages.get(step) ?? [];
      rows.push([`episode-${offset}-${i}`, threshold + 1]);
      lineages.set(step, rows);
    }
  };
  plant(baseline, 0, 4999);
  // Extinction leaves the scheduled final quarter empty; the true count
  // contrast remains the same, so empty censuses must preserve the plateau.
  plant(late, 500000, scenario === "extinctionBoundary" ? 2500 : 5000);
  const series = Array.from({ length:10000 }, (_, i) => ({ step: (i + 1) * 100 }));
  return { condition:spec.condition, seed:spec.seed, dir:"synthetic-growth", series, lineages,
    manifest:buildManifest(spec,scenario,1000000,id.replicateIndex,{ generator:"growth-counts-v1", masterSeed:id.masterSeed,seedIndex:id.seedIndex,baseline,neutralLate,noise,difference,late,distribution:scenario === "boundaryRareNegative"?"95% +10 / 5% -190 centered noise":"rounded N(0,20^2) noise", pairing:scenario === "pairedEndpoint1Null"?"opposite condition responses to shared normal draw; equal marginal distributions, negative paired dependence stress":"shared neutral count plus treatment difference", construction:"one-census threshold+1 episodes; abstract activity input, not physical feasibility" }) };
}
