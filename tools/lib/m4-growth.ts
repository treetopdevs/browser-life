import { M4_GROWTH_V1 as CONTRACT } from "../../experiments/amendments/m4-growth-v1.ts";

export interface GrowthCurve {
  seed: number;
  condition: "treatment" | "neutral" | "no-mutation";
  points: { step: number; cumulativeNew: number }[];
}

/** Entire scheduled curve is required; completed extinction retains its flat tail. */
export function lateGrowth(points: GrowthCurve["points"]): number {
  if (points.length !== CONTRACT.horizon / CONTRACT.censusEvery) throw new Error("incomplete activity schedule");
  let previous = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.step !== (i + 1) * CONTRACT.censusEvery || !Number.isSafeInteger(p.cumulativeNew) || p.cumulativeNew < previous) {
      throw new Error("invalid activity schedule or cumulative count");
    }
    previous = p.cumulativeNew;
  }
  return (points.at(-1)!.cumulativeNew - points[CONTRACT.windowStart / CONTRACT.censusEvery - 1].cumulativeNew) /
    ((CONTRACT.horizon - CONTRACT.windowStart) / CONTRACT.unitsSteps);
}

// Adaptive Simpson integration of the transformed t density. The change of
// variables x=sqrt(df)*tan(theta) leaves cos(theta)^(df-1); the normalizing
// constant cancels in the ratio. No platform-specific special functions.
function integrate(f: (x: number) => number, a: number, b: number, tolerance = 1e-12): number {
  const simpson = (a: number, b: number, fa: number, fm: number, fb: number) => (b - a) * (fa + 4 * fm + fb) / 6;
  function refine(a: number, b: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number {
    const m = (a + b) / 2, fl = f((a + m) / 2), fr = f((m + b) / 2);
    const l = simpson(a, m, fa, fl, fm), r = simpson(m, b, fm, fr, fb);
    if (Math.abs(l + r - whole) <= 15 * eps) return l + r + (l + r - whole) / 15;
    if (depth <= 0) throw new Error("t integral did not converge");
    return refine(a, m, fa, fl, fm, l, eps / 2, depth - 1) + refine(m, b, fm, fr, fb, r, eps / 2, depth - 1);
  }
  const fa = f(a), fm = f((a + b) / 2), fb = f(b);
  return refine(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), tolerance, 24);
}
const norms = new Map<number, number>();
/** Right tail; tested against analytic df=1/2 and independent published quantiles. */
export function studentTail(t: number, df: number): number {
  if (!Number.isInteger(df) || df < 1 || df > 500 || Number.isNaN(t)) throw new Error("invalid t distribution input");
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  if (t < 0) return 1 - studentTail(-t, df);
  const density = (x: number) => Math.cos(x) ** (df - 1);
  if (!norms.has(df)) norms.set(df, integrate(density, 0, Math.PI / 2));
  return Math.max(0, Math.min(1, integrate(density, Math.atan(t / Math.sqrt(df)), Math.PI / 2) / (2 * norms.get(df)!)));
}
const criticals = new Map<string, number>();
export function studentCritical(alpha: number, df: number): number {
  if (!(alpha > 0 && alpha < 0.5)) throw new Error("invalid alpha");
  const key = `${alpha}:${df}`;
  if (criticals.has(key)) return criticals.get(key)!;
  let lo = 0, hi = 1;
  while (studentTail(hi, df) > alpha) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (studentTail(mid, df) > alpha) lo = mid; else hi = mid;
  }
  const value = (lo + hi) / 2;
  criticals.set(key, value);
  return value;
}

export interface MeanContrast {
  status: "ok" | "degenerate";
  n: number;
  mean: number;
  standardError: number;
  pGreaterThanFloor: number | null;
  lowerBound: number | null;
  supported: boolean;
}
/** Inference across independent seed pairs, never censuses or positions. */
export function pairedMeanContrast(differences: number[], floor: number = CONTRACT.effectFloor, alpha: number = CONTRACT.alphaPerPreset): MeanContrast {
  if (differences.length < 2 || differences.length > 501 || differences.some((x) => !Number.isFinite(x)) || !Number.isFinite(floor)) {
    throw new Error("invalid paired differences");
  }
  if (!(alpha > 0 && alpha < 0.5)) throw new Error("invalid alpha");
  const n = differences.length, mean = differences.reduce((a, b) => a + b, 0) / n;
  const variance = differences.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  // A constant nonzero sample is descriptive evidence, not a variance estimate.
  // Withhold Student inference rather than manufacturing infinite certainty.
  if (standardError === 0) return { status: "degenerate", n, mean, standardError, pGreaterThanFloor: null, lowerBound: null, supported: false };
  const pGreaterThanFloor = studentTail((mean - floor) / standardError, n - 1);
  const lowerBound = mean - studentCritical(alpha, n - 1) * standardError;
  return { status: "ok", n, mean, standardError, pGreaterThanFloor, lowerBound, supported: lowerBound > floor && pGreaterThanFloor < alpha };
}

/** Exact seed manifest is mandatory; incomplete and duplicate histories cannot disappear. */
export function analyzeGrowthCurves(curves: GrowthCurve[], expectedSeeds: number[]) {
  if (expectedSeeds.length < 2 || new Set(expectedSeeds).size !== expectedSeeds.length || expectedSeeds.some((s) => !Number.isSafeInteger(s) || s < 0)) throw new Error("invalid seed manifest");
  const byKey = new Map<string, GrowthCurve>();
  for (const curve of curves) {
    if (!expectedSeeds.includes(curve.seed) || !(CONTRACT.conditions as readonly string[]).includes(curve.condition)) throw new Error("unexpected history");
    const key = `${curve.condition}:${curve.seed}`;
    if (byKey.has(key)) throw new Error("duplicate history");
    byKey.set(key, curve);
  }
  const perSeed = expectedSeeds.map((seed) => {
    const growth: Record<string, number> = {};
    for (const condition of CONTRACT.conditions) {
      const curve = byKey.get(`${condition}:${seed}`);
      if (!curve) throw new Error(`missing ${condition} seed ${seed}`);
      growth[condition] = lateGrowth(curve.points);
    }
    return { seed, growth, difference: growth.treatment - growth.neutral };
  });
  return { amendment: CONTRACT.id, perSeed, endpoint2: pairedMeanContrast(perSeed.map((p) => p.difference)), endpoint1: "requires-original-fresh-analysis", m4: "not-evaluated" };
}
