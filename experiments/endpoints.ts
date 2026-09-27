// Pre-registration as data.
//
// This module is the single source of truth for the primary endpoints
// described in experiments/preregistration.md:
//   - tools/analyze.ts imports PRIMARY_ENDPOINTS and executes each entry
//     against an ensemble (see evaluateEndpoint).
//   - tools/gen-prereg.ts renders each entry's `description` into the
//     "## Primary endpoints" section of preregistration.md, between
//     GENERATED markers, so the doc and the analysis code cannot drift.
//   - tests/deno/prereg-sync.ts and experiments/test/prereg-sync.test.ts both
//     fail if the committed doc no longer matches what this module produces.
//
// Runs under both Deno (tools/*) and Node (vitest, via experiments/test/):
// no Deno- or Node-specific APIs in this file, pure data and pure functions
// only.
import { EXACT_MAX, holm, mannWhitney, wilcoxonSignedRank, type GrowthVerdict } from "@bl/metrics";

/** One-sided alternative for a Mann–Whitney comparison. */
export type Alt = "pGreater" | "pLess";

export interface Comparison {
  /** Condition id for the "a" sample. */
  a: string;
  /** Condition id for the "b" (control) sample. */
  b: string;
  relation: Alt;
}

interface EndpointBase {
  id: string;
  /** Rendered verbatim as one numbered item of prose into preregistration.md. */
  description: string;
}

/** A one-sided Mann–Whitney family, Holm-corrected across its comparisons. */
export interface TestEndpoint extends EndpointBase {
  kind: "test";
  /** Key into a run's per-run statistics (RunView.stats). */
  statistic: string;
  comparisons: Comparison[];
  alpha: number;
}

/** A verdict-majority endpoint, e.g. "growing" in most treatment runs, few neutral. */
export interface ThresholdEndpoint extends EndpointBase {
  kind: "threshold";
  /** Which per-run verdict label counts as qualifying (e.g. "growing"). */
  qualifyingVerdict: GrowthVerdict;
  groups: { condition: string; relation: "majority" | "minority" }[];
}

/**
 * Ecological-closure coexistence: continuous coexistence of >= minRoles
 * trophic roles, sustained for >= minSteps, in a majority of `condition`
 * runs. Not a two-sample test -- a proportion/majority count over runs, like
 * ThresholdEndpoint's growth verdict.
 */
export interface CoexistenceEndpoint extends EndpointBase {
  kind: "coexistence";
  condition: string;
  minRoles: number;
  minSteps: number;
  /** Optional stricter role count reported alongside (e.g. the M5 gate). */
  gate?: { minRoles: number };
}

export type Endpoint = TestEndpoint | ThresholdEndpoint | CoexistenceEndpoint;

export const ALPHA = 0.01;

export const PRIMARY_ENDPOINTS: Endpoint[] = [
  {
    id: "adaptive-activity",
    kind: "test",
    statistic: "cumulativeNewActivity",
    comparisons: [
      { a: "treatment", b: "neutral", relation: "pGreater" },
      { a: "treatment", b: "no-mutation", relation: "pGreater" },
    ],
    alpha: ALPHA,
    description:
      "**Adaptive activity.** Cumulative new evolutionary activity (Bedau–Packard) with the " +
      "threshold fixed at the 95th percentile of lineage activity pooled over the neutral runs. " +
      `Hypothesis: treatment > neutral and treatment > no-mutation (one-sided Mann–Whitney, ` +
      `α = ${ALPHA} after Holm correction across the two comparisons).`,
  },
  {
    id: "unbounded-growth",
    kind: "threshold",
    qualifyingVerdict: "growing",
    groups: [
      { condition: "treatment", relation: "majority" },
      { condition: "neutral", relation: "minority" },
    ],
    description:
      "**Unbounded-looking growth.** Within treatment runs, the cumulative new-activity curve is " +
      "classified (`growthVsSaturation` in `packages/metrics/src/stats.ts`): \"flat\" if its linear " +
      "change over the window is below 5% of its mean; otherwise \"growing\" if the linear model is " +
      "preferred by ΔAIC ≥ 2 (ΔAIC = AIC_sat − AIC_lin) or the fitted saturation " +
      "time constant lies beyond half the window; \"saturating\" if ΔAIC ≤ −2 with the " +
      "time constant within half the window; otherwise \"indeterminate\". Hypothesis: a majority of " +
      "treatment runs are \"growing\" while at most a minority of neutral runs are. A lineage counts " +
      "as adaptively significant only when its activity is strictly above the neutral threshold.",
  },
  {
    id: "ecological-closure-recycling",
    kind: "test",
    statistic: "bioticRecycling",
    comparisons: [{ a: "treatment", b: "replenished", relation: "pGreater" }],
    alpha: ALPHA,
    description:
      "**Ecological closure — recycling.** Biotic share of waste recycling (decomposition / " +
      `(decomposition + abiotic)). Hypothesis: treatment > replenished (one-sided Mann–Whitney, ` +
      `α = ${ALPHA}).`,
  },
  {
    id: "ecological-closure-coexistence",
    kind: "coexistence",
    condition: "treatment",
    minRoles: 2,
    minSteps: 1e5,
    gate: { minRoles: 3 },
    description:
      "**Ecological closure — coexistence.** Continuous coexistence of ≥2 trophic roles " +
      "(each holding ≥5% of living cells) for ≥ 10⁵ steps, computed from the scheduled " +
      "role observations in `series.jsonl`. `rolesPresent` is recorded only on deep censuses (every " +
      "`deepEvery` censuses); the duration is measured across consecutive *deep* censuses only — " +
      "a non-deep census carries no role information and neither continues nor breaks a coexistence " +
      "run. Hypothesis: a majority of treatment runs reach a qualifying duration (≥3 roles " +
      "sustained the same way is the M5 gate, reported alongside; it is not required for this " +
      "endpoint).",
  },
];

// ---- held-out observables ----
//
// The held-out observables (experiments/preregistration.md's "## Held-out
// observables" section) are never used by any search, selection or
// environment generator -- only measured. Making them executable was
// deferred (docs/refactor-v3-workflow.md's "Deferred" section) until a trend
// statistic was chosen for each; the first cut of that choice (this
// module's initial version) was reviewed and found to under-specify the
// claim it implemented (see the dated amendment in preregistration.md and
// docs/refactor-v3-workflow.md for the full review). This is the corrected
// version -- a dated amendment, not a silent rewrite of what shipped before:
//
//   2026-09-26 amendment (post-review, user-decided):
//   1. An observable's trend claim now has an ABSOLUTE half as well as a
//      relative one: (a) treatment's own per-run slopes must be positive
//      (one-sample, one-sided `wilcoxonSignedRank`), AND (b) treatment must
//      exceed every declared control (one-sided Mann-Whitney, as before).
//      The old version only ever checked (b) -- "treatment beats its
//      controls" is not the same claim as "treatment increases", and a
//      declining-slower-than-its-controls run used to pass as "supported".
//   2. Controls are declared per preset in this module (fixed at
//      registration time), not "whatever condition happens to have runs in
//      this ensemble": every registered preset (gradient-m3, spots-m3) permanently
//      lacks some ablation (spots-m3 has no light gradient to flatten;
//      `fixed-env` belongs to the unregistered seasons preset), so "require
//      every present control" used to be vacuous or under-constrained
//      depending on how the check was phrased. A missing declared control,
//      or fewer than 2 runs for one, now makes the endpoint UNAVAILABLE --
//      reported as such, never silently evaluated over a smaller family and
//      never counted as "supported".
//   3. Direction is only claimed for four of the six observables --
//      temporalMI, differentiation, compartmentalised, role count. Higher
//      lineage-map compression ratio means *less* compressible (an empty,
//      homogeneous world compresses very well too), and higher pattern
//      entropy can mean more disorder as readily as more structure; neither
//      has an uncontested "up is more organised" reading, so both are
//      reported descriptively only (slope and between-group comparisons,
//      clearly marked, never tested one-sample, never counted). This amends
//      "at least two of them [six]" to "at least two of these four".
//   4. Every p-value from every directional observable's (a) and (b) --
//      four one-sample tests plus their between-group families -- is
//      Holm-corrected together as ONE family at alpha = 0.01, not one Holm
//      family per observable: per-observable correction alone does not
//      bound the error rate of the resulting "at least 2 of 4" count (five
//      independent nulls each passing at 1% gives a ~4.9% chance at least
//      one does, by chance alone). Pooling every directional test into one
//      family gives the "at least 2 of 4" claim family-wise error control.
//
// Trend statistic (unchanged): the per-run OLS slope (`trendSlope` in
// packages/metrics/src/stats.ts) of the observable against step. The fit
// window is now defined by *scheduled* census position, not by which
// censuses happen to carry a finite value (engineering fix, no sign-off
// needed -- see tools/analyze.ts's `trendFor`): a scheduled observation
// that is unexpectedly missing excludes the run from that observable,
// reported as such, rather than silently sliding the window earlier.
// `temporalMI`/`patternEntropy` are scheduled every census;
// `lineageCompression`/`differentiation`/`compartmentalised`/role count are
// scheduled only on deep censuses (every `deepEvery`).
//
// Only OLS (over Theil-Sen, for the trend slope itself) remains a choice not
// fixed by the original prose, still flagged for sign-off. Wilcoxon
// signed-rank (forced to its exact method) for claim (a) and alpha = 0.01
// for the shared family are decided -- the user chose both explicitly in
// the amendment above, not left open.
export const HELD_OUT_ALPHA = ALPHA;

/**
 * Declared held-out control conditions per registered preset (amendment
 * point 2). `fixed-env` is the seasons-preset-only control and is declared
 * for neither `gradient-m3` nor `spots-m3` -- the two presets this pre-registration
 * actually runs (see preregistration.md's "System under test").
 */
export const HELD_OUT_PRESET_CONTROLS: Record<string, string[]> = {
  "gradient-m3": ["neutral", "no-mutation", "uniform-light", "replenished", "no-signal-motility"],
  "spots-m3": ["neutral", "no-mutation", "replenished", "no-signal-motility"],
};

const DECLARED_CONTROLS_TEXT =
  "gradient-m3 — neutral, no-mutation, uniform-light, replenished, no-signal-motility; spots-m3 — neutral, " +
  "no-mutation, replenished, no-signal-motility (`fixed-env` is the seasons-preset-only control, " +
  "declared for neither registered preset)";

const DIRECTIONAL_HYPOTHESIS =
  "Hypothesis (both must hold): (a) treatment's own per-run trend slopes are greater than zero (one-sided, " +
  "exact Wilcoxon signed-rank test on the per-run slopes -- `wilcoxonSignedRank` in " +
  "`packages/metrics/src/stats.ts`, chosen over the sign test because it weighs slope magnitude, not only " +
  "sign; the endpoint refuses this test rather than approximate it if the sample size exceeds what the " +
  "exact method can compute); and (b) treatment's trend exceeds every declared control's trend (one-sided " +
  `Mann–Whitney per control; declared controls: ${DECLARED_CONTROLS_TEXT}). A missing declared control, or ` +
  "fewer than 2 runs for one, makes this endpoint unavailable, never a silently smaller family. Every " +
  "test -- (a) plus one (b) per declared control -- of every directional held-out observable occupies a " +
  "fixed slot (24 tests for gradient-m3, 20 for spots-m3) in ONE shared Holm family at " +
  `α = ${ALPHA}, whether or not that slot has data (an unavailable slot contributes p = 1, the most ` +
  "conservative value, so it can never itself pass and never loosens correction for the rest, but it also " +
  "never shrinks the family the way dropping it would). This observable counts toward the \"at least 2 of " +
  "4\" claim below only when available and both (a) and (b) -- every declared control -- clear the shared " +
  "Holm-adjusted α.";

/** A per-run scalar plus the typed spec for one held-out observable (see the amendment above). */
export interface HeldOutSpec {
  id: string;
  /** Key into RunView.stats holding this observable's per-run trend (a step-slope; see tools/analyze.ts's `trendFor`). */
  statistic: string;
  /** Counts toward "at least 2 of 4"; false = reported descriptively only, never tested one-sample, never pooled into the shared Holm family. */
  directional: boolean;
  description: string;
}

export const HELD_OUT_SPECS: HeldOutSpec[] = [
  {
    id: "held-out-temporal-mi",
    statistic: "temporalMITrend",
    directional: true,
    description:
      "**Temporal mutual information.** Predictive-information proxy: mutual information (bits/block) " +
      "between the 2×2 occupancy pattern at census t and at t + Δ, at the same location (`temporalMI` in " +
      "`packages/metrics/src/complexity.ts`), scheduled every census. " +
      DIRECTIONAL_HYPOTHESIS,
  },
  {
    id: "held-out-pattern-entropy",
    statistic: "patternEntropyTrend",
    directional: false,
    description:
      "**Pattern entropy.** Shannon entropy (bits/block) of the 2×2 occupancy-symbol distribution " +
      "(`entropy`/`patternEntropy` in `packages/metrics/src/complexity.ts`), scheduled every census. " +
      "Descriptive only (2026-09-26 amendment): higher pattern entropy can reflect more disorder as " +
      "readily as more structure, so \"up\" is not an uncontested organisation claim here. Reported as a " +
      "per-run trend slope and as one-sided Mann–Whitney comparisons (treatment vs. each declared control: " +
      `${DECLARED_CONTROLS_TEXT}), unadjusted and outside the directional observables' shared Holm family; ` +
      "never counted toward the \"at least 2 of 4\" claim.",
  },
  {
    id: "held-out-lineage-compression",
    statistic: "lineageCompressionTrend",
    directional: false,
    description:
      "**Lineage-map compression ratio.** Deflate compression ratio of the per-cell lineage-hash map " +
      "(`lineageBytes`/`compressionRatio` in `packages/metrics/src/complexity.ts`), scheduled only on deep " +
      "censuses (every `deepEvery` censuses). Descriptive only (2026-09-26 amendment): this is " +
      "compressed/raw bytes, so a rising ratio means *less* compressible, not more organised, and an " +
      "empty, homogeneous world also compresses very well -- "  +
      "\"up\" has no uncontested organisation reading either direction. Reported as a per-run trend slope " +
      "and as one-sided Mann–Whitney comparisons (treatment vs. each declared control: " +
      `${DECLARED_CONTROLS_TEXT}), unadjusted and outside the directional observables' shared Holm family; ` +
      "never counted toward the \"at least 2 of 4\" claim. Since metrics version 2 the ratio is computed " +
      "with a bundled deterministic deflate (fflate) rather than the runtime's `CompressionStream`, whose " +
      "output size differed between Chrome and Deno; analysis pools only runs with the current metrics " +
      "version, so earlier data is not comparable. See docs/refactor-v3-workflow.md.",
  },
  {
    id: "held-out-differentiation",
    statistic: "differentiationTrend",
    directional: true,
    description:
      "**Internal differentiation.** Mean within-individual standard deviation of cell membrane fraction " +
      "(`morphology().differentiation` in `packages/metrics/src/complexity.ts`), scheduled only on deep " +
      "censuses. " +
      DIRECTIONAL_HYPOTHESIS,
  },
  {
    id: "held-out-compartmentalised",
    statistic: "compartmentalisedTrend",
    directional: true,
    description:
      "**Compartmentalised individuals.** Count of individuals with a membrane-rich rim and a biomass-rich " +
      "core (`morphology().compartmentalised` in `packages/metrics/src/complexity.ts`), scheduled only on " +
      "deep censuses. " +
      DIRECTIONAL_HYPOTHESIS,
  },
  {
    id: "held-out-role-count",
    statistic: "rolesPresentTrend",
    directional: true,
    description:
      "**Role count.** Number of distinct trophic roles present (`rolesPresent.length`, scheduled only on " +
      "deep censuses). " +
      DIRECTIONAL_HYPOTHESIS,
  },
];

/** "at least 2 of [the 4 directional observables]" (2026-09-26 amendment, point 3). */
export const HELD_OUT_MIN_SUPPORTED = 2;

export const HELD_OUT_SUMMARY =
  `Hypothesis: supported once at least ${HELD_OUT_MIN_SUPPORTED} of the ` +
  `${HELD_OUT_SPECS.filter((s) => s.directional).length} directional observables above (temporal mutual ` +
  "information, internal differentiation, compartmentalised individuals, role count) are established (meet " +
  "both criteria in their hypothesis). The overall outcome is three-valued, not a plain yes/no (2026-09-26 " +
  "amendment, round-3/4 corrected): not-supported only when a whole-family recomputation of the shared " +
  "Holm correction -- every currently unavailable *test slot* (not observable) substituted with the most " +
  `favorable possible value, p = 0, holding every currently available raw p-value fixed -- still yields ` +
  `fewer than ${HELD_OUT_MIN_SUPPORTED} established observables; otherwise, short of ` +
  `${HELD_OUT_MIN_SUPPORTED} established observables, the result is reported as unavailable rather than a ` +
  "negative, since that recomputation shows two could still become established once the missing data " +
  "arrives. Not-supported means only that this ensemble's *currently available* measurements cannot meet " +
  "the registered criterion no matter how the missing slots resolve -- not that additional seeds, " +
  "recovered/excluded measurements, or anything else that would recompute an already-available raw " +
  "p-value couldn't. Pattern entropy and lineage-map compression ratio are descriptive only and are never " +
  "counted.";

export interface HeldOutAbsolute {
  n: number;
  W: number;
  /** Unadjusted one-sided p (treatment's per-run slopes have positive median). */
  p: number;
  /** Holm-adjusted within the shared, fixed-size directional family; NaN when unavailable, non-directional, or the preset has no declared control set. */
  pAdj: number;
  available: boolean;
  supported: boolean;
  /**
   * Always "exact" when `available`, never "normal" -- decision 1 requires
   * the exact Wilcoxon signed-rank test; if `n` exceeds what the exact
   * method can compute (`> EXACT_MAX`), this observable's absolute test is
   * marked unavailable instead of silently falling back to the normal
   * approximation. Registered ensembles (<=20 seeds/condition) never hit
   * this limit.
   */
  method: "exact" | null;
}

export interface HeldOutRelative {
  /** One row per this preset's declared control (HELD_OUT_PRESET_CONTROLS), in declared order. */
  rows: TestRow[];
  /** True only when every DECLARED control (not "whatever's present") has >= 2 runs -- amendment point 2. */
  complete: boolean;
}

export interface HeldOutObservableResult {
  kind: "held-out";
  id: string;
  description: string;
  directional: boolean;
  /** null for a non-directional (descriptive) observable: a one-sample test isn't meaningful without a claimed direction. */
  absolute: HeldOutAbsolute | null;
  relative: HeldOutRelative;
  /** Real data on both halves (directional: absolute.available && relative.complete; descriptive: relative.complete alone) -- independent of the shared Holm family, which is a FIXED size regardless of any one observable's availability (round-2 fix). */
  available: boolean;
  /** Always false for a non-directional (descriptive) observable. */
  supported: boolean;
}

export type HeldOutOutcome = "supported" | "not-supported" | "unavailable";

export interface HeldOutSummary {
  presetId: string;
  /** False when `presetId` has no declared control set (an unregistered preset) -- every observable is then unavailable and the outcome cannot be "supported" or "not-supported", only "unavailable". */
  presetDeclared: boolean;
  controls: string[];
  /** # directional observables (4), regardless of how many are actually available. */
  total: number;
  minSupported: number;
  /** # directional observables with real data on both halves that clear the shared Holm-adjusted alpha. */
  establishedCount: number;
  /** # directional observables lacking real data on at least one half. */
  unavailableCount: number;
  /** # directional observables with real data on both halves that do NOT clear alpha (a genuine negative, not missing evidence). */
  refutedCount: number;
  /**
   * Upper bound on establishedCount (round-3 fix): how many directional
   * observables pass under a recomputation of the shared Holm family with
   * every missing slot substituted at p=0 (maximally favorable) instead of
   * the actual, conservative p=1. NOT a real result -- completing missing
   * data can shift *every* observable's rank in the shared pool, not just
   * the completed one's, so `establishedCount + unavailableCount` is not a
   * valid upper bound on its own (round-3 review: completing one
   * observable's data measurably improved another, already-available
   * observable's own adjusted p, with neither observable's raw numbers
   * changed). `optimisticCount` recomputes the whole family to get a bound
   * that *is* valid, used only to decide `outcome` below.
   */
  optimisticCount: number;
  /**
   * Three-valued (round-2/3 fix): "supported" once establishedCount >=
   * minSupported; "not-supported" only when even `optimisticCount` (every
   * currently-missing slot assumed maximally favorable, not just the
   * currently-unavailable *observables* credited as a flat pass) could not
   * reach minSupported -- a fully-informative negative; otherwise
   * "unavailable" (there is still enough missing evidence that the true
   * answer could go either way).
   */
  outcome: HeldOutOutcome;
  /** outcome === "supported" -- kept for simple boolean call sites. */
  supported: boolean;
  alpha: number;
  /**
   * Fixed size of the shared Holm family (amendment point 4, round-2 fix):
   * #directional * (1 + #declared controls) whenever the preset is
   * declared -- 24 for gradient-m3, 20 for spots-m3 -- regardless of how many of
   * those tests actually have data. 0 when the preset has no declared
   * control set at all.
   */
  familySize: number;
}

/**
 * Executes every entry of HELD_OUT_SPECS against a pooled ensemble for one
 * preset and applies the ">= 2 of 4 directional observables" decision rule
 * (2026-09-26 amendment). `presetId` selects the declared control set
 * (HELD_OUT_PRESET_CONTROLS) -- callers pass the ensemble's own preset
 * (tools/analyze.ts's ensemble-compatibility check already guarantees every
 * pooled run shares one `presetId`).
 */
export function evaluateHeldOut(views: RunView[], presetId: string): { results: HeldOutObservableResult[]; summary: HeldOutSummary } {
  const byCond = (c: string) => views.filter((v) => v.condition === c);
  const controls = HELD_OUT_PRESET_CONTROLS[presetId];
  const presetDeclared = controls !== undefined;

  // Per-spec raw pieces, before the shared cross-observable Holm correction.
  const raw = HELD_OUT_SPECS.map((spec) => {
    const treatment = byCond("treatment").map((v) => v.stats[spec.statistic]).filter(Number.isFinite);
    // Decision 1 requires the *exact* Wilcoxon signed-rank test (not the
    // normal approximation): refuse (mark unavailable) rather than silently
    // approximate when n exceeds what the exact method can compute.
    const absAvailable = spec.directional && treatment.length >= 2 && treatment.length <= EXACT_MAX;
    const abs = absAvailable ? wilcoxonSignedRank(treatment, "exact") : null;

    const rows: TestRow[] = presetDeclared
      ? controls!.map((b) => {
          const ys = byCond(b).map((v) => v.stats[spec.statistic]).filter(Number.isFinite);
          const available = treatment.length >= 2 && ys.length >= 2;
          const mw = available ? mannWhitney(treatment, ys) : null;
          return { a: "treatment", b, relation: "pGreater", nA: treatment.length, nB: ys.length, effect: mw?.effect ?? NaN, p: available ? mw!.pGreater : 1, pAdj: NaN, available, supported: false };
        })
      : [];
    const relComplete = presetDeclared && rows.length > 0 && rows.every((r) => r.available);
    return { spec, absAvailable, abs, rows, relComplete };
  });

  // One Holm family, FIXED to the declared family size (round-2 fix): every
  // test of every *directional* observable -- its absolute test plus one
  // relative test per declared control -- always occupies a slot in the
  // pool, whether or not that particular test has real data. `fill` is the
  // value substituted for a slot without data; everything else about the
  // family (its size, and which slots are real vs. substituted) is
  // identical regardless of `fill`.
  //
  // Review finding (round 2): the previous version excluded observables
  // lacking full data from the pool entirely, which *shrank* the family and
  // could manufacture support purely by losing data -- reproduced with the
  // family dropping from 20 to 15 tests (one observable's control losing
  // its second run) and an unrelated observable's Holm-adjusted p flipping
  // from "no" to "yes" with no change to its own numbers. Fixed family
  // sizes, matching the two registered presets: 24 for gradient-m3 (4
  // directional * (1 absolute + 5 declared controls)), 20 for spots-m3
  // (4 * (1 + 4)).
  //
  // Review finding (round 3): fixing the family size is necessary but not
  // sufficient. Completing a *different*, currently-unavailable observable's
  // missing data changes that data's own rank in the shared pool, which can
  // shift every *other* observable's Holm multiplier too -- reproduced: an
  // available observable's own adjusted p improved (0.01171875 ->
  // 0.0078125, spots, 10 seeds) purely because a third, unrelated
  // observable's missing data was completed, with neither observable's own
  // numbers touched. So `establishedCount` (computed with `fill = 1`, the
  // most conservative value, below) is NOT an upper bound on how many
  // observables could eventually be established once missing data arrives
  // -- "not-supported" must not be concluded just because
  // `establishedCount + unavailableCount < minSupported`.
  function poolAndAdjust(fill: number): { absAdj: Map<number, number>; rowAdj: Map<string, number>; size: number } {
    const pool: number[] = [];
    const poolRefs: ({ kind: "abs"; specIdx: number } | { kind: "row"; specIdx: number; rowIdx: number })[] = [];
    if (presetDeclared) {
      raw.forEach((r, specIdx) => {
        if (!r.spec.directional) return;
        pool.push(r.absAvailable ? r.abs!.pGreater : fill);
        poolRefs.push({ kind: "abs", specIdx });
        r.rows.forEach((row, rowIdx) => {
          pool.push(row.available ? row.p : fill);
          poolRefs.push({ kind: "row", specIdx, rowIdx });
        });
      });
    }
    const adjusted = holm(pool);
    const absAdj = new Map<number, number>();
    const rowAdj = new Map<string, number>();
    poolRefs.forEach((ref, k) => {
      if (ref.kind === "abs") absAdj.set(ref.specIdx, adjusted[k]);
      else rowAdj.set(`${ref.specIdx}:${ref.rowIdx}`, adjusted[k]);
    });
    return { absAdj, rowAdj, size: pool.length };
  }

  // The actual, reported per-observable/per-row state: unavailable slots
  // contribute p=1 (the most conservative value -- it can never itself be
  // the smallest p and so can never manufacture support, and it can never
  // make any *other* slot's correction more lenient either).
  const conservative = poolAndAdjust(1);
  // An upper bound only (never used for the per-observable `results` below):
  // unavailable slots contribute p=0 (the most optimistic value -- every
  // missing test assumed to come out maximally significant), to check
  // whether completing the missing data could *ever* still reach
  // `minSupported` established observables. Not exposed per-observable, only
  // as `summary.optimisticCount`, because crediting a slot with p=0 it
  // doesn't have is not a real result -- only a bound on what's still
  // possible.
  const optimistic = poolAndAdjust(0);

  const results: HeldOutObservableResult[] = raw.map((r, specIdx) => {
    const rows: TestRow[] = r.rows.map((row, rowIdx) => {
      if (!r.spec.directional) return row; // descriptive: unadjusted, outside the shared family
      const pAdj = presetDeclared ? conservative.rowAdj.get(`${specIdx}:${rowIdx}`)! : NaN;
      return { ...row, pAdj, supported: row.available && pAdj < ALPHA };
    });
    const relative: HeldOutRelative = { rows, complete: r.relComplete };

    let absolute: HeldOutAbsolute | null = null;
    if (r.spec.directional) {
      const pAdj = presetDeclared ? conservative.absAdj.get(specIdx)! : NaN;
      absolute = {
        n: r.abs?.n ?? 0,
        W: r.abs?.W ?? 0,
        p: r.abs?.pGreater ?? 1,
        pAdj,
        available: r.absAvailable,
        supported: r.absAvailable && pAdj < ALPHA,
        method: r.absAvailable ? "exact" : null,
      };
    }

    const available = r.spec.directional ? r.absAvailable && r.relComplete : r.relComplete;
    const supported = r.spec.directional && available && !!absolute?.supported && rows.every((row) => row.supported);

    return { kind: "held-out", id: r.spec.id, description: r.spec.description, directional: r.spec.directional, absolute, relative, available, supported };
  });

  const directional = results.filter((r) => r.directional);
  const establishedCount = directional.filter((r) => r.supported).length;
  const unavailableCount = directional.filter((r) => !r.available).length;
  const refutedCount = directional.length - establishedCount - unavailableCount;

  // Optimistic upper bound (round-3 fix): for each directional spec, would
  // it pass under the p=0-for-missing-slots recomputation? A slot with real
  // data is judged on its *optimistically re-adjusted* p (ranks shift, per
  // the review finding above); a slot without data trivially passes (p=0
  // adjusts to 0 regardless of multiplier).
  const optimisticCount = presetDeclared
    ? raw.reduce((n, r, specIdx) => {
        if (!r.spec.directional) return n;
        const absPass = !r.absAvailable || optimistic.absAdj.get(specIdx)! < ALPHA;
        const rowsPass = r.rows.every((row, rowIdx) => !row.available || optimistic.rowAdj.get(`${specIdx}:${rowIdx}`)! < ALPHA);
        return n + (absPass && rowsPass ? 1 : 0);
      }, 0)
    : 0;

  // Three-valued outcome (round-2/3 fix): see HeldOutSummary.outcome's doc.
  // "not-supported" requires the OPTIMISTIC bound, not the conservative
  // established+unavailable sum, to rule out reaching minSupported -- the
  // round-3 finding is that the conservative sum is not a valid upper bound
  // (completing one observable's data can improve another's adjusted p).
  // An undeclared preset can't even be given that bound (there's no known
  // control set to size a hypothetical family against), so it's always
  // "unavailable", never a confident "not-supported".
  const outcome: HeldOutOutcome = !presetDeclared
    ? "unavailable"
    : establishedCount >= HELD_OUT_MIN_SUPPORTED
    ? "supported"
    : optimisticCount < HELD_OUT_MIN_SUPPORTED
    ? "not-supported"
    : "unavailable";

  return {
    results,
    summary: {
      presetId,
      presetDeclared,
      controls: controls ?? [],
      total: directional.length,
      minSupported: HELD_OUT_MIN_SUPPORTED,
      establishedCount,
      unavailableCount,
      refutedCount,
      optimisticCount,
      outcome,
      supported: outcome === "supported",
      alpha: ALPHA,
      familySize: conservative.size,
    },
  };
}

// ---- coexistence duration (pure, testable) ----

export interface SeriesPoint {
  step: number;
  /** Present only on deep censuses (see runner.ts: `if (deep && snap.roles)`). */
  rolesPresent?: string[];
}

/**
 * Durations (in steps) of maximal runs of consecutive *deep* censuses --
 * points carrying `rolesPresent` -- in which at least `minRoles` roles are
 * present. Non-deep points (no `rolesPresent`) are skipped entirely: they
 * neither extend nor interrupt a run, per this endpoint's documented policy
 * of restricting the calculation to deep-census steps only. A lone
 * qualifying deep census (no adjacent qualifying deep census) yields a
 * duration of 0, since a single observation cannot establish a sustained
 * duration.
 */
export function coexistenceDurations(series: SeriesPoint[], minRoles: number): number[] {
  const deep = series
    .filter((s): s is SeriesPoint & { rolesPresent: string[] } => Array.isArray(s.rolesPresent))
    .slice()
    .sort((a, b) => a.step - b.step);
  const durations: number[] = [];
  let start: number | null = null;
  let last: number | null = null;
  for (const s of deep) {
    if (s.rolesPresent.length >= minRoles) {
      if (start === null) start = s.step;
      last = s.step;
    } else {
      if (start !== null && last !== null) durations.push(last - start);
      start = last = null;
    }
  }
  if (start !== null && last !== null) durations.push(last - start);
  return durations;
}

/** Whether any maximal run of consecutive qualifying deep censuses reaches `minSteps`. */
export function coexistenceQualifies(series: SeriesPoint[], minRoles: number, minSteps: number): boolean {
  return coexistenceDurations(series, minRoles).some((d) => d >= minSteps);
}

// ---- evaluation ----

export interface RunView {
  condition: string;
  seed: number;
  /** Per-run scalar statistics, e.g. from tools/analyze.ts's `perRun` map. */
  stats: Record<string, number>;
  /** Growth-vs-saturation verdict for this run, if calibrated and computed. */
  trend?: GrowthVerdict;
  series: SeriesPoint[];
}

export interface TestRow {
  a: string;
  b: string;
  relation: Alt;
  nA: number;
  nB: number;
  effect: number;
  p: number;
  pAdj: number;
  available: boolean;
  supported: boolean;
}
export interface TestResult {
  kind: "test";
  id: string;
  description: string;
  alpha: number;
  rows: TestRow[];
  /** False if any comparison lacked >= 2 finite observations per side. */
  complete: boolean;
}

export interface ThresholdRow {
  condition: string;
  relation: "majority" | "minority";
  qualifying: number;
  total: number;
  /** Runs with a computed `trend`; `total - classified` have none yet (uncalibrated or not yet run). */
  classified: number;
  holds: boolean;
}
export interface ThresholdResult {
  kind: "threshold";
  id: string;
  description: string;
  rows: ThresholdRow[];
  available: boolean;
  supported: boolean;
}

export interface CoexistenceResult {
  kind: "coexistence";
  id: string;
  description: string;
  condition: string;
  minRoles: number;
  minSteps: number;
  qualifying: number;
  total: number;
  supported: boolean;
  gate?: { minRoles: number; qualifying: number; total: number; supported: boolean };
}

export type EndpointResult = TestResult | ThresholdResult | CoexistenceResult;

/** Executes one endpoint entry against a pooled ensemble of run views. */
export function evaluateEndpoint(e: Endpoint, views: RunView[]): EndpointResult {
  const byCond = (c: string) => views.filter((v) => v.condition === c);

  if (e.kind === "test") {
    const rows: TestRow[] = e.comparisons.map((c) => {
      const xs = byCond(c.a).map((v) => v.stats[e.statistic]).filter(Number.isFinite);
      const ys = byCond(c.b).map((v) => v.stats[e.statistic]).filter(Number.isFinite);
      const available = xs.length >= 2 && ys.length >= 2;
      const mw = available ? mannWhitney(xs, ys) : null;
      // A one-sided lower-tail p-value ("a tends to be less than b") is not
      // `1 - pGreater`: the exact method's tails are each *inclusive* of the
      // observed statistic, so they share that probability mass and the two
      // don't sum to 1 -- for two identical samples this formula gives
      // p=0 where the true lower-tail probability is 1. Swapping the
      // samples and reading `pGreater` again computes the true lower tail
      // directly (no endpoint currently uses "pLess", but the module's
      // contract must still be correct for the day one does).
      const p = !available ? 1 : c.relation === "pGreater" ? mw!.pGreater : mannWhitney(ys, xs).pGreater;
      return { a: c.a, b: c.b, relation: c.relation, nA: xs.length, nB: ys.length, effect: mw?.effect ?? NaN, p, pAdj: NaN, available, supported: false };
    });
    const adj = holm(rows.filter((r) => r.available).map((r) => r.p));
    let j = 0;
    for (const row of rows) {
      if (!row.available) continue;
      row.pAdj = adj[j++];
      row.supported = row.pAdj < e.alpha;
    }
    return { kind: "test", id: e.id, description: e.description, alpha: e.alpha, rows, complete: rows.every((r) => r.available) };
  }

  if (e.kind === "threshold") {
    const rows: ThresholdRow[] = e.groups.map((g) => {
      const rs = byCond(g.condition);
      const total = rs.length;
      const classified = rs.filter((v) => v.trend !== undefined).length;
      const qualifying = rs.filter((v) => v.trend === e.qualifyingVerdict).length;
      const holds = total > 0 && (g.relation === "majority" ? qualifying * 2 > total : qualifying * 2 < total);
      return { condition: g.condition, relation: g.relation, qualifying, total, classified, holds };
    });
    // Review 1 finding #8: a run with no computed `trend` (uncalibrated
    // ensemble, or the classifier not yet run) used to count toward `total`
    // without ever counting toward `qualifying` -- indistinguishable from a
    // run that *was* classified and simply wasn't "growing". That silently
    // reported "Supported: no" for data that was never actually measured.
    // Available now requires every run in every group to carry a real
    // classification, not just to exist.
    const available = rows.every((r) => r.total > 0 && r.classified === r.total);
    return { kind: "threshold", id: e.id, description: e.description, rows, available, supported: available && rows.every((r) => r.holds) };
  }

  // coexistence
  const rs = byCond(e.condition);
  const total = rs.length;
  const qualifying = rs.filter((v) => coexistenceQualifies(v.series, e.minRoles, e.minSteps)).length;
  const result: CoexistenceResult = {
    kind: "coexistence",
    id: e.id,
    description: e.description,
    condition: e.condition,
    minRoles: e.minRoles,
    minSteps: e.minSteps,
    qualifying,
    total,
    supported: total > 0 && qualifying * 2 > total,
  };
  if (e.gate) {
    const gq = rs.filter((v) => coexistenceQualifies(v.series, e.gate!.minRoles, e.minSteps)).length;
    result.gate = { minRoles: e.gate.minRoles, qualifying: gq, total, supported: total > 0 && gq * 2 > total };
  }
  return result;
}
