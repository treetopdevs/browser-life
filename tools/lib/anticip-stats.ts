// Pure statistics for tools/anticip.ts's difference-in-differences design: no
// Deno dependency, so these are unit-tested under vitest directly. Reuses
// `@bl/metrics`'s `wilcoxonSignedRank` (already exported and tested) rather
// than reimplementing a signed-rank test.
import { draw, lowbias32 } from "@bl/schema";
import { wilcoxonSignedRank } from "@bl/metrics";

/** log(respSwitch / respContinue): the fitness cost of a branch's light
 * perturbation, base e. `collapsed: true` (`cost: null`) when either
 * response is <= 0 -- the seed-world's population died out in that branch,
 * and a log of zero/negative biomass is not a number this analysis can use.
 * Such a seed-world's cost is excluded from inference, not turned into
 * +-Infinity or NaN. */
export interface CostResult {
  cost: number | null;
  collapsed: boolean;
}
export function logCost(respContinue: number, respSwitch: number): CostResult {
  if (!(respContinue > 0) || !(respSwitch > 0)) return { cost: null, collapsed: true };
  return { cost: Math.log(respSwitch / respContinue), collapsed: false };
}

/** One seed-world's paired evolved/founder costs for one switch direction.
 * The replicate unit is the seed (whole world), never a founder within it. */
export interface SeedCost {
  seed: number;
  costEvolved: number;
  costFounder: number;
}

/**
 * Joins two seed-keyed cost maps into `SeedCost[]`, sorted by seed. Throws if
 * the two maps' seed sets differ, rather than silently pairing by insertion
 * or array order -- this is what makes seed pairing correct regardless of
 * the order costs were recorded in.
 */
export function pairSeedCosts(evolved: Map<number, number>, founder: Map<number, number>): SeedCost[] {
  const evolvedSeeds = [...evolved.keys()].sort((a, b) => a - b);
  const founderSeeds = [...founder.keys()].sort((a, b) => a - b);
  const same = evolvedSeeds.length === founderSeeds.length && evolvedSeeds.every((s, i) => s === founderSeeds[i]);
  if (!same) {
    throw new Error(`pairSeedCosts: seed sets differ -- evolved=[${evolvedSeeds.join(",")}] founder=[${founderSeeds.join(",")}]`);
  }
  return evolvedSeeds.map((seed) => ({ seed, costEvolved: evolved.get(seed)!, costFounder: founder.get(seed)! }));
}

/** cost_evolved - cost_founder. Negative means the evolved population paid a
 * *larger* cost from losing predictability than the founder control did --
 * consistent with it having exploited the cycle's timing specifically,
 * *pending* the light-regime-specialization confound being controlled (see
 * docs/anticipation.md section 4): general specialization to the light
 * regime as a whole, not its timing, can produce the same signed result. */
export function anticipationIndex(sc: SeedCost): number {
  return sc.costEvolved - sc.costFounder;
}

/** SECONDARY test only -- see `bootstrapMeanCI` for the primary estimand
 * (the mean). One-sided p-value for H1 ("the index's distribution is
 * symmetric about a negative location"). Negating the input turns H1's left
 * tail into `wilcoxonSignedRank`'s own right tail (`pGreater`), rather than
 * re-deriving a left-tail formula from scratch.
 *
 * Wilcoxon signed-rank assumes the sampled distribution is symmetric about
 * its location under H0; it is a test of that location (closer to the
 * median than the mean for a skewed distribution), not of the mean. This
 * can diverge sharply from mean-based inference: a zero-mean population
 * with index -1 with probability 20/21 and +20 otherwise is asymmetric, so
 * 8 draws that happen to land all-negative (probability (20/21)^8 ~ 0.69)
 * give this function p ~ 0.0039 even though the population mean is 0. The
 * bootstrap mean CI does not rescue that sample either (it is [-1, -1]):
 * no resampling method can see a tail that was never drawn (see
 * anticip-stats.test.ts and docs/anticipation.md section 3). Report this
 * only alongside the primary mean CI, never in its place. */
export function onesidedWilcoxonNegative(indices: number[]): number {
  return wilcoxonSignedRank(indices.map((v) => -v)).pGreater;
}

/** Descriptive only -- NOT the primary estimand (see `bootstrapMeanCI` for
 * the primary mean-based inference). The sample median; `null` for an empty
 * input, matching `bootstrapMeanCI`'s `n === 0` handling for `mean` (NaN)
 * conceptually but as an explicit "no data" value since a median has no
 * natural NaN-like default. Can diverge sharply from the mean on a skewed
 * sample -- see anticip-stats.test.ts's mean-vs-median divergence fixture. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `"ok"`: `lo`/`hi` are a real percentile bootstrap CI. `"insufficient-
 * replication"`: fewer than 2 seed-worlds were available, so resampling
 * cannot say anything about across-world variability; `lo`/`hi` are `null`
 * and only the point estimate (`mean`, `NaN` when `n === 0`) is meaningful.
 * `"insufficient-reps"`: `reps` was too low to place a stable 2.5th/97.5th
 * percentile pair (see `MIN_REPS`); `lo`/`hi` are `null` for the same reason
 * -- a CI built from too few resamples is not a real interval, it is noise
 * that happens to have a shape. */
export type CIStatus = "ok" | "insufficient-replication" | "insufficient-reps";

/** Fewer resamples than this cannot place a stable 97.5th/2.5th percentile
 * pair for the default `alpha = 0.05`: each tail needs several order
 * statistics to land on before "the 97.5th percentile" means anything, and
 * 200 reps gives 5 per tail (200 * 0.025 = 5) at the bare minimum. Below
 * this, `bootstrapMeanCI` reports the interval as unavailable
 * (`"insufficient-reps"`) rather than a number that looks like a CI but
 * isn't one -- see `tools/anticip.ts`'s `--reps` (2000 by default). */
const MIN_REPS = 200;

/**
 * PRIMARY inference (docs/anticipation.md section 3): percentile bootstrap CI
 * of the mean anticipation index -- the mean, not the median, is the primary
 * estimand, since it is the quantity `onesidedWilcoxonNegative`'s symmetric-
 * location test does *not* actually test (see that function's doc comment
 * for the estimand-mismatch counterexample). Resamples seed-worlds (the
 * declared independent unit) with replacement -- deterministic via the
 * repo's own counter-based PRNG (`draw`/`lowbias32`), never `Math.random`.
 * `mean` (the point estimate matching this CI) is always computed and
 * returned, even when `lo`/`hi` are unavailable, so callers always have a
 * primary point estimate to report. `n < 2` (one seed, or only one
 * surviving pair) cannot be resampled into a distribution at all, so it
 * returns `status: "insufficient-replication"` with `lo`/`hi: null` rather
 * than a zero-width interval that would spuriously look like it excludes 0.
 * Even with enough seed-worlds, `reps < MIN_REPS` returns `status:
 * "insufficient-reps"` for the same reason: too few resamples cannot support
 * a meaningful percentile CI either.
 *
 * `alpha` defaults to 0.05 (a marginal 95% interval); Holm adjustment (as
 * used for the secondary Wilcoxon p-values) does not apply to CIs, so a
 * caller judging a multi-direction family (e.g. this repo's shorter/longer
 * switch directions) should pass a Bonferroni-adjusted `alpha` (e.g. 0.025
 * for 2 directions, a 97.5% CI each) instead of two marginal 95% CIs --
 * see `tools/anticip.ts`'s `PRIMARY_ALPHA`.
 */
export function bootstrapMeanCI(indices: number[], reps: number, seed: number, alpha = 0.05): { lo: number | null; hi: number | null; mean: number; status: CIStatus } {
  const n = indices.length;
  const mean = n === 0 ? NaN : indices.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { lo: null, hi: null, mean, status: "insufficient-replication" };
  if (reps < MIN_REPS) return { lo: null, hi: null, mean, status: "insufficient-reps" };
  const seedBase = lowbias32(seed >>> 0);
  const means = new Array<number>(reps);
  for (let r = 0; r < reps; r++) {
    const repBase = draw(seedBase, r);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = draw(repBase, i) / 4294967296; // [0, 1)
      sum += indices[Math.floor(u * n)];
    }
    means[r] = sum / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * reps)];
  const hi = means[Math.min(reps - 1, Math.ceil((1 - alpha / 2) * reps) - 1)];
  return { lo, hi, mean, status: "ok" };
}
