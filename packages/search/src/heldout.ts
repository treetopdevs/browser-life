// Held-out capability tests for the behaviour atlas (I01), FIXED IN WRITING in docs/behaviour-atlas-2026-11-01/PLAN.md
// ("Held-out capability tests") before any descriptor archive ran. This module only states them as data. Nothing
// here runs in the slice that adds it. They reuse the growth outcomes `survived` and `mass`, which the screening
// quality also reads, but only in environments and on seeds no selector saw: they test transfer of survival, not a
// new quantity, and no archive axis or gate is used.

import { DEFAULT_EVAL, type EvalConfig } from "./evaluate.ts";

export type HeldoutId = "H0" | "H1" | "H2" | "H3";

/** Patches on DEFAULT_EVAL. H0 is the within-genome control (the standard environment), not a capability. */
export const HELDOUT_ASSAYS: Record<HeldoutId, { capability: string; patch: Partial<EvalConfig> }> = {
  H0: { capability: "control: the standard environment", patch: {} },
  H1: { capability: "establishing from a small inoculum on a lean medium", patch: { nutrient: 16, biomass: 32 } },
  H2: { capability: "persisting under dim light", patch: { world: { ...DEFAULT_EVAL.world, lightBase: 20, lightAmp: 80 } } },
  H3: { capability: "persisting under patchy light", patch: { world: { ...DEFAULT_EVAL.world, lightMode: "patches", lightBase: 20, lightAmp: 160 } } },
};

/** Replicates per genome, and the rest of the shared held-out evaluation: only growth outcomes (survived, mass) count. */
export const HELDOUT_COMMON: Partial<EvalConfig> = { reps: 16, recoverSteps: 500, darkSteps: 500 };
/** A genome passes H1..H3 when survived >= this of 16 and its mean mass >= HELDOUT_MASS_FRACTION of its own H0 mass. */
export const HELDOUT_MIN_SURVIVED = 12;
export const HELDOUT_MASS_FRACTION = 0.5;

/** Seed ledger. Every range is inclusive; the search ranges of bootstrap-200 and its confirmation are historical. */
export const SEED_LEDGER = {
  searchBootstrap200: [1, 300],
  confirmBootstrap200: [1000001, 1000210],
  calibration: [3000001, 3000199],
  heldout: [4000001, 4999999],
  /** New search histories: base + 10000 * history. */
  newHistoriesFrom: 5000001,
} as const;

export function heldoutConfig(id: HeldoutId, batch: number): EvalConfig {
  const idx = Object.keys(HELDOUT_ASSAYS).indexOf(id);
  return { ...DEFAULT_EVAL, ...HELDOUT_COMMON, ...HELDOUT_ASSAYS[id].patch, seed: SEED_LEDGER.heldout[0] + 100 * idx + batch };
}
