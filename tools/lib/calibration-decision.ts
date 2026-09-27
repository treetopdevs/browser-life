// Whether a calibration pilot's eligible cohort for one preset exactly
// matches what experiments/endpoints.ts declares for it -- the gate
// tools/calibrate.ts applies before it will call a computed value
// freezeable (Astra review, 2026-09-27, P1). Pure and host-agnostic (no
// Deno API): unit-tested directly with synthetic cohorts, no run bundle
// needed for any of these checks.
export interface CohortRunInfo {
  seed: number;
  /** manifest.spec.experiment, as actually recorded -- checked against the declared pilot's experiment name. */
  experiment: string;
  /** manifest.spec.presetId, as actually recorded -- checked against the preset directory this run was loaded from. */
  presetId: string;
  conservationOk: boolean;
}

export interface FreezeabilityDeclaration {
  declaredExperiment: string;
  declaredPresetId: string;
  /** [first, last] seed, inclusive. */
  declaredSeeds: [number, number];
  /** Exact number of eligible runs required within `declaredSeeds` -- normally `declaredSeeds[1] - declaredSeeds[0] + 1`, kept separate since a declaration is data, not assumed contiguous-and-complete by construction. */
  declaredRuns: number;
  declaredSchedule: { steps: number; censusEvery: number; deepEvery: number };
  declaredQuantile: number;
}

export type FreezeabilityResult = { freezeable: true } | { freezeable: false; reasons: string[] };

/**
 * Checks every way a pilot's cohort can fail to exactly match its
 * declaration: wrong experiment/presetId on any run, a duplicate seed
 * (two loaded runs claiming the same seed), an extra seed outside the
 * declared range, a declared seed missing entirely, a declared seed present
 * but failing conservation, an eligible count that doesn't match
 * `declaredRuns` exactly, or a schedule/quantile mismatch. `cohort` should
 * be every run actually loaded for this preset's neutral condition
 * (regardless of eligibility) -- eligibility itself (conservationOk) is one
 * of the things this function checks, not a precondition on its input.
 */
export function evaluateFreezeability(
  cohort: CohortRunInfo[],
  declared: FreezeabilityDeclaration,
  actualSchedule: { steps: number; censusEvery: number; deepEvery: number },
  actualQuantile: number,
): FreezeabilityResult {
  const reasons: string[] = [];

  for (const r of cohort) {
    if (r.experiment !== declared.declaredExperiment)
      reasons.push(`seed-${r.seed}: manifest experiment "${r.experiment}" does not match the declared pilot experiment "${declared.declaredExperiment}"`);
    if (r.presetId !== declared.declaredPresetId)
      reasons.push(`seed-${r.seed}: manifest presetId "${r.presetId}" does not match this preset directory ("${declared.declaredPresetId}")`);
  }

  const seedCounts = new Map<number, number>();
  for (const r of cohort) seedCounts.set(r.seed, (seedCounts.get(r.seed) ?? 0) + 1);
  for (const [seed, n] of [...seedCounts].sort((a, b) => a[0] - b[0])) if (n > 1) reasons.push(`seed ${seed} appears ${n} times (duplicate)`);

  const [lo, hi] = declared.declaredSeeds;
  const extras = [...new Set(cohort.filter((r) => r.seed < lo || r.seed > hi).map((r) => r.seed))].sort((a, b) => a - b);
  if (extras.length) reasons.push(`unexpected seed(s) outside the declared range ${lo}–${hi}: ${extras.join(", ")}`);

  const inRange = cohort.filter((r) => r.seed >= lo && r.seed <= hi);
  const bySeed = new Map<number, CohortRunInfo>();
  for (const r of inRange) if (!bySeed.has(r.seed)) bySeed.set(r.seed, r); // first wins; the duplicate itself is already reported above
  const missing: number[] = [];
  const failedConservation: number[] = [];
  for (let s = lo; s <= hi; s++) {
    const r = bySeed.get(s);
    if (!r) missing.push(s);
    else if (!r.conservationOk) failedConservation.push(s);
  }
  if (missing.length) reasons.push(`missing declared seed(s): ${missing.join(", ")}`);
  if (failedConservation.length) reasons.push(`declared seed(s) failed conservation: ${failedConservation.join(", ")}`);

  const eligibleInRange = [...bySeed.values()].filter((r) => r.conservationOk).length;
  if (eligibleInRange !== declared.declaredRuns && !missing.length && !failedConservation.length)
    // Only surfaced when missing/failedConservation didn't already explain
    // the shortfall -- e.g. declaredRuns disagreeing with the declared
    // range's own width, which would otherwise pass silently.
    reasons.push(`${eligibleInRange} eligible run(s) in the declared range, expected exactly ${declared.declaredRuns}`);

  if (
    actualSchedule.steps !== declared.declaredSchedule.steps ||
    actualSchedule.censusEvery !== declared.declaredSchedule.censusEvery ||
    actualSchedule.deepEvery !== declared.declaredSchedule.deepEvery
  )
    reasons.push(
      `schedule steps=${actualSchedule.steps}/censusEvery=${actualSchedule.censusEvery}/deepEvery=${actualSchedule.deepEvery} does not match the ` +
        `declared steps=${declared.declaredSchedule.steps}/censusEvery=${declared.declaredSchedule.censusEvery}/deepEvery=${declared.declaredSchedule.deepEvery}`,
    );
  if (actualQuantile !== declared.declaredQuantile) reasons.push(`quantile ${actualQuantile} does not match the declared quantile ${declared.declaredQuantile}`);

  return reasons.length ? { freezeable: false, reasons } : { freezeable: true };
}
