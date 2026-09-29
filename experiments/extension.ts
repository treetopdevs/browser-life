// The registered 10^7-step extension's own activity threshold (experiments/preregistration.md,
// "Secondary analyses"): gradient-m3, treatment, neutral and no-mutation on seeds 101-105, 10^7 steps,
// census every 100 and deep every 10, with the threshold frozen by the same rule (95th percentile of
// pooled lineage activity) from its own neutral-only pilot "calib-ext", seeds 1101-1110.
//
// Kept apart from experiments/endpoints.ts's ACTIVITY_THRESHOLDS so the primary analysis cannot change:
// tools/calibrate.ts and tools/analyze.ts use this registry only with `--registry extension`, and with
// the default registry they behave exactly as at the freeze. `value` stays null until the pilot has
// run and been reduced; the commit that fills it in is recorded in docs/plan.md before any extension
// run is analysed.
import type { ActivityThresholdEntry } from "./endpoints.ts";

export const EXTENSION_ACTIVITY_THRESHOLDS: Record<string, ActivityThresholdEntry> = {
  "gradient-m3": {
    value: null,
    quantile: 0.95,
    pilot: {
      experiment: "calib-ext", seeds: [1101, 1110], runs: 10,
      steps: 10000000, censusEvery: 100, deepEvery: 10,
      ruleVersion: 1, schemaVersion: 3, metricsVersion: 2,
      presetIdentity: "e1c93a9384b5d921",
      calibrationDistributionIdentity: "91a77c31dfc52a43",
    },
  },
};

/** Heads every extension report: its endpoints are secondary and descriptive. */
export const EXTENSION_REPORT_NOTE =
  "> **Registered secondary analysis: the 10⁷-step extension** (experiments/preregistration.md, \"Secondary analyses\"). " +
  "Endpoints 1 and 2 are reported with effect sizes and labelled secondary. With 5 seeds per condition they are descriptive, " +
  "and they neither confirm nor overturn the primary result. The threshold comes from the extension's own neutral pilot " +
  "(experiments/extension.ts), not from ACTIVITY_THRESHOLDS.\n\n";
