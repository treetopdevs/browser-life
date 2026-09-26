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
import { holm, mannWhitney, type GrowthVerdict } from "@bl/metrics";

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
