import { PRESETS, presetIdentity, distributionIdentity, initWorld, stateHash, type WorldConfig } from "@bl/schema";
import { specConfig } from "@bl/runner";
import { ACTIVITY_THRESHOLDS, PRIMARY_ENDPOINTS, evaluateEndpoint } from "../../experiments/endpoints.ts";
import { M4_GROWTH_V1 as C } from "../../experiments/amendments/m4-growth-v1.ts";
import { activities, ensembleProblems, metapopulationRingProblems, provenanceProblems, type Run } from "./bundle.ts";
import { decideActivityThreshold } from "./threshold.ts";
import { analyzeGrowthCurves, type GrowthCurve } from "./m4-growth.ts";

export type GrowthProvenance = { kind: "real" } | { kind: "synthetic"; generatorIdentity: string };

/** Separate explicit synthetic identity: it never invents a physical pilot provenance. */
export async function analyzeGrowthRuns(input: Iterable<Run> | AsyncIterable<Run>, expectedSeeds: number[], provenance: GrowthProvenance) {
  const runs: Run[] = [];
  const curves: GrowthCurve[] = [];
  // Release synthetic lineage tables as each history is measured; retained
  // series/metadata provide the same full-ensemble compatibility checks.
  for await (const run of input) {
    if (provenance.kind === "real") {
      if (run.manifest.nullcal || run.lineages) throw new Error("synthetic histories forbidden in real analysis");
    } else if (!provenance.generatorIdentity || !run.manifest.nullcal || !run.lineages || run.manifest.initHash !== undefined || run.manifest.presetIdentity !== undefined) {
      throw new Error("synthetic provenance is absent or mixed with physical provenance");
    }
    const presetId = run.manifest.spec.presetId;
    const frozen = ACTIVITY_THRESHOLDS[presetId];
    if (!(C.presets as readonly string[]).includes(presetId) || frozen?.value == null) throw new Error("unregistered amendment preset");
    const errors = ensembleProblems([run]);
    if (errors.length) throw new Error(errors.join("\n"));
    const { snaps } = await activities(run, frozen.value);
    curves.push({ seed: run.seed, condition: run.condition as GrowthCurve["condition"], points: snaps.map(({step,cumulativeNew}) => ({step,cumulativeNew})) });
    runs.push({ ...run, lineages: undefined });
  }
  if (!runs.length) throw new Error("no histories");
  const problems = ensembleProblems(runs);
  if (metapopulationRingProblems(runs)) problems.push("dependent metapopulation rings are not independent seed pairs");
  if (runs.some((r) => r.manifest.summary.conservationOk !== true)) problems.push("conservation failure");
  const presetId = runs[0].manifest.spec.presetId;
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset || !(C.presets as readonly string[]).includes(presetId)) throw new Error("unregistered amendment preset");
  if (provenance.kind === "real") {
    problems.push(...provenanceProblems(runs, presetId));
  }
  if (problems.length) throw new Error(problems.join("\n"));
  const identity = presetIdentity(preset);
  const neutralSpec = { ...runs[0].manifest.spec, condition: "neutral", seed: 0 };
  const { seed: _seed, ...neutralCfg } = specConfig(neutralSpec);
  const threshold = decideActivityThreshold(presetId, ACTIVITY_THRESHOLDS, runs[0].manifest.spec, 0.95, [], {
    ruleVersion: runs[0].manifest.ruleVersion, schemaVersion: runs[0].manifest.schemaVersion,
    metricsVersion: runs[0].manifest.metricsVersion, presetIdentity: identity,
    calibrationDistributionIdentity: distributionIdentity(identity, "neutral", neutralCfg as WorldConfig),
  }, expectedSeeds);
  if (threshold.kind === "refuse") throw new Error(threshold.reason);
  if (!threshold.decision.calibrated || threshold.decision.mode !== "frozen") throw new Error("compatible frozen threshold unavailable");
  // Pairing is a physical-input property, not just equality of numeric seed labels.
  const pairing: { seed: number; normalizedInitialHash: string }[] = [];
  if (provenance.kind === "real") for (const seed of expectedSeeds) {
    const t = runs.find((r) => r.seed === seed && r.condition === "treatment");
    const n = runs.find((r) => r.seed === seed && r.condition === "neutral");
    if (!t || !n) throw new Error(`missing seed pair ${seed}`);
    const ts = initWorld(t.manifest.cfg, preset.init), ns = initWorld(n.manifest.cfg, preset.init);
    // Only neutral controller selection differs in config; verify arrays and ledgers
    // with the same config for this input-parity digest. Original hashes retained.
    const th = stateHash(ts), nh = stateHash({ ...ns, cfg: ts.cfg });
    if (th !== nh) throw new Error(`initial physical pairing mismatch seed ${seed}`);
    pairing.push({ seed, normalizedInitialHash: th });
  }
  const growth = analyzeGrowthCurves(curves, expectedSeeds);
  const endpoint1 = evaluateEndpoint(PRIMARY_ENDPOINTS[0], curves.map((curve) => ({
    condition: curve.condition, seed: curve.seed,
    stats: { cumulativeNewActivity: curve.points.at(-1)!.cumulativeNew }, series: [],
  })));
  if (endpoint1.kind !== "test") throw new Error("original endpoint1 contract changed");
  return { provenance, presetId, threshold: threshold.decision, pairing, ...growth, endpoint1,
    endpoint1Method: expectedSeeds.length * 2 <= 60 ? "exact-midrank-permutation" : "tie-corrected-normal",
    jointPerPresetObserved: endpoint1.complete && endpoint1.rows.every((row) => row.supported) && growth.endpoint2.supported,
  };
}
