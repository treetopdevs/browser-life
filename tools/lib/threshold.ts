// The activity-threshold decision tools/analyze.ts applies for one ensemble:
// frozen (from experiments/endpoints.ts's ACTIVITY_THRESHOLDS) for a
// registered preset, in-sample (exploratory) otherwise. Pure and
// host-agnostic (no Deno API) -- factored out of tools/analyze.ts so it is
// unit-testable directly (tests/deno/analyze.ts), without needing a synthetic
// run bundle for every branch, some of which (a registered preset with a
// non-null frozen value) don't yet exist anywhere in this repo's real data.
import { quantile } from "@bl/metrics";

export interface ActivityThresholdPilotLike {
  experiment: string;
  seeds: [number, number];
  runs: number;
  steps: number;
  censusEvery: number;
  deepEvery: number;
  ruleVersion: number;
  schemaVersion: number;
  metricsVersion: number;
  presetIdentity: string;
  calibrationDistributionIdentity: string;
}

export interface ActivityThresholdEntryLike {
  value: number | null;
  quantile: number;
  pilot: ActivityThresholdPilotLike;
}

export interface ThresholdDecision {
  mode: "frozen" | "exploratory";
  q: number;
  calibrated: boolean;
  threshold: number;
  /** Non-null only for a registered preset whose frozen value is still null (not yet calibrated). */
  unavailableReason: string | null;
}

export type ThresholdOutcome = { kind: "ok"; decision: ThresholdDecision } | { kind: "refuse"; reason: string };

/** What this ensemble's own code/data actually is, for comparison against a registered pilot's recorded identity (Astra review, 2026-09-27, P1). */
export interface EnsembleIdentity {
  ruleVersion: number;
  schemaVersion: number;
  metricsVersion: number;
  /** `presetIdentity(preset)` (packages/schema/src/presets.ts) computed fresh from the CURRENT code for this ensemble's preset. */
  presetIdentity: string;
  /** `distributionIdentity(presetIdentity, "neutral", <seed-stripped neutral WorldConfig>)` computed fresh from the CURRENT code for this ensemble's preset (Astra review, 2026-09-27, item 2). */
  calibrationDistributionIdentity: string;
}

/**
 * Decides how tools/analyze.ts should set its activity threshold for one
 * ensemble of `presetId`, given the registered thresholds map, this
 * ensemble's own observation schedule, the CLI's `--q` (already parsed to a
 * number), this ensemble's own pooled neutral-run activities (used only on
 * the exploratory path, or to report calibrated=false when none exist),
 * this ensemble's own rule/schema/metrics versions and current preset
 * identity, and every seed present in this ensemble (any condition).
 *
 * `{ kind: "refuse" }` means analyze.ts must throw rather than proceed:
 * --q overridden against a registered preset's fixed quantile, a schedule
 * mismatch against the pilot (activity distributions depend on it), a
 * rule/schema/metrics-version or preset-identity mismatch against what the
 * pilot recorded (the frozen value no longer describes this code), this
 * ensemble reusing a seed reserved for the calibration pilot (contaminating
 * independence), or a non-null frozen value that isn't a finite positive
 * number (a configuration error in experiments/endpoints.ts, not data this
 * tool should try to interpret).
 */
export function decideActivityThreshold(
  presetId: string,
  activityThresholds: Record<string, ActivityThresholdEntryLike>,
  ensembleSchedule: { steps: number; censusEvery: number; deepEvery: number },
  qArg: number,
  neutralActs: number[],
  ensembleIdentity: EnsembleIdentity,
  ensembleSeeds: number[],
): ThresholdOutcome {
  const frozen = activityThresholds[presetId];
  if (!frozen) {
    const calibrated = neutralActs.length > 0;
    const threshold = calibrated ? quantile(neutralActs, qArg) : Infinity;
    return { kind: "ok", decision: { mode: "exploratory", q: qArg, calibrated, threshold, unavailableReason: null } };
  }

  if (qArg !== frozen.quantile) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}" has a registered activity threshold (quantile ${frozen.quantile}, frozen from the ` +
        `"${frozen.pilot.experiment}" pilot); --q is not applicable to a registered preset -- only an unregistered ` +
        `(exploratory) preset may override the quantile.`,
    };
  }
  const scheduleMismatch = (["steps", "censusEvery", "deepEvery"] as const).filter((k) => ensembleSchedule[k] !== frozen.pilot[k]);
  if (scheduleMismatch.length) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}"'s activity threshold was calibrated at a different observation schedule than this ` +
        `ensemble -- pilot: steps=${frozen.pilot.steps}, censusEvery=${frozen.pilot.censusEvery}, deepEvery=${frozen.pilot.deepEvery}; ` +
        `this ensemble: steps=${ensembleSchedule.steps}, censusEvery=${ensembleSchedule.censusEvery}, deepEvery=${ensembleSchedule.deepEvery}. ` +
        `Activity distributions depend on the observation schedule, so this ensemble cannot use that frozen value: recalibrate with ` +
        `tools/calibrate.ts at this schedule, or analyze an ensemble run at the pilot's schedule.`,
    };
  }
  // Version/identity mismatch (Astra review, P1): a frozen value describes a
  // specific rule/schema/metrics version and a specific preset definition.
  // Seed and condition are expected to differ between the pilot and this
  // ensemble and are never checked here.
  const versionMismatch =
    ensembleIdentity.ruleVersion !== frozen.pilot.ruleVersion ||
    ensembleIdentity.schemaVersion !== frozen.pilot.schemaVersion ||
    ensembleIdentity.metricsVersion !== frozen.pilot.metricsVersion;
  if (versionMismatch) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}"'s activity threshold was calibrated under rule/schema/metrics versions ` +
        `${frozen.pilot.ruleVersion}/${frozen.pilot.schemaVersion}/${frozen.pilot.metricsVersion}; this ensemble runs ` +
        `${ensembleIdentity.ruleVersion}/${ensembleIdentity.schemaVersion}/${ensembleIdentity.metricsVersion}. Recalibrate ` +
        `with tools/calibrate.ts under the current code before using this preset's frozen threshold again.`,
    };
  }
  if (ensembleIdentity.presetIdentity !== frozen.pilot.presetIdentity) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}" has changed since its activity threshold was calibrated (presetIdentity ` +
        `${frozen.pilot.presetIdentity} recorded, ${ensembleIdentity.presetIdentity} now) -- packages/schema/src/presets.ts's ` +
        `cfg, init params, or (for an M3-founder preset) the founder set itself differs from what the pilot used. Recalibrate ` +
        `with tools/calibrate.ts against the current preset definition.`,
    };
  }
  // Calibration-distribution mismatch (Astra review, 2026-09-27, item 2):
  // presetIdentity alone doesn't capture a *condition*'s own transform
  // (packages/runner/src/conditions.ts) -- e.g. changing "neutral"'s `apply`
  // would leave presetIdentity unchanged while silently changing what the
  // pilot's neutral runs (the distribution the frozen threshold actually
  // came from) draw from.
  if (ensembleIdentity.calibrationDistributionIdentity !== frozen.pilot.calibrationDistributionIdentity) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}"'s neutral-condition calibration distribution has changed since its activity threshold was ` +
        `calibrated (calibrationDistributionIdentity ${frozen.pilot.calibrationDistributionIdentity} recorded, ` +
        `${ensembleIdentity.calibrationDistributionIdentity} now) -- packages/runner/src/conditions.ts's "neutral" transform, ` +
        `or the preset itself, differs from what the pilot used. Recalibrate with tools/calibrate.ts against the current code.`,
    };
  }
  // Seed-reservation (Astra review, P2): the pilot's seed range is reserved
  // for calibration -- any ensemble seed inside it would no longer be an
  // independent draw from what the frozen threshold was itself computed
  // from.
  const [lo, hi] = frozen.pilot.seeds;
  const reused = [...new Set(ensembleSeeds.filter((s) => s >= lo && s <= hi))].sort((a, b) => a - b);
  if (reused.length) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}"'s calibration pilot reserves seeds ${lo}–${hi} ("${frozen.pilot.experiment}"); this ` +
        `ensemble reuses seed(s) ${reused.join(", ")} from that range, which are not independent of the calibration data ` +
        `the frozen threshold was computed from. Use seeds outside ${lo}–${hi} for this ensemble.`,
    };
  }
  if (frozen.value === null) {
    return {
      kind: "ok",
      decision: {
        mode: "frozen",
        q: frozen.quantile,
        calibrated: false,
        threshold: Infinity,
        unavailableReason:
          `preset "${presetId}" is registered in ACTIVITY_THRESHOLDS but its value is still null -- threshold not yet ` +
          `calibrated. Run tools/calibrate.ts over the "${frozen.pilot.experiment}" pilot and paste its printed entry into ` +
          `experiments/endpoints.ts.`,
      },
    };
  }
  // Defensive validation (Astra review, P2): a non-null value must be a
  // finite, positive number -- anything else (Infinity from an empty
  // pooled distribution, NaN, zero or negative) is a configuration error in
  // experiments/endpoints.ts, not data this tool should silently accept.
  if (!(Number.isFinite(frozen.value) && frozen.value > 0)) {
    return {
      kind: "refuse",
      reason:
        `preset "${presetId}"'s registered activity threshold value (${frozen.value}) is not a finite, positive number -- ` +
        `this is a configuration error in experiments/endpoints.ts's ACTIVITY_THRESHOLDS, not usable data. Re-run ` +
        `tools/calibrate.ts and paste in a valid entry.`,
    };
  }
  return { kind: "ok", decision: { mode: "frozen", q: frozen.quantile, calibrated: true, threshold: frozen.value, unavailableReason: null } };
}
