// CPU-only first-census measurement kernel. Bundle validity and launch eligibility are
// deliberately outside this function; see docs/naturalist-bell-v3-plan-2026-10-20.md.
import { SIGNALS, departure } from "./bell.ts";
import { isV1Signal } from "./bell1.ts";

export const FIRST_STEP3 = 200_100;
export const SIGNALS3 = SIGNALS.filter((s) => isV1Signal(s.name));
type Vector = readonly (number | null)[];

/** Inputs are SignalExtractor outputs in SIGNALS order, including each run's own
 * ten-census rates. Missing/nonfinite kept signals are errors, never quiet zeros.
 * All ten bases participate in the unit, just as in v2; no control enters it. */
export function firstCensusScore(step: number, bases: readonly Vector[], baseIndex: number, twin: Vector) {
  if (step !== FIRST_STEP3) throw new Error("v3 scores only step 200100");
  if (bases.length !== 10 || !Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= 10) throw new Error("v3 needs ten bases and a valid base index");
  for (const v of [...bases, twin]) {
    if (v.length !== SIGNALS.length) throw new Error("wrong signal vector length");
    SIGNALS.forEach((s, i) => {
      if (isV1Signal(s.name) && (typeof v[i] !== "number" || !Number.isFinite(v[i]))) throw new Error(`invalid ${s.name}`);
    });
  }
  const bySignal = SIGNALS.flatMap((s, i) => {
    if (!isV1Signal(s.name)) return [];
    const spread = departure(0, Float64Array.from(bases.map((v) => v[i] as number)).sort(), Infinity, s.floor).spread;
    if (!Number.isFinite(spread) || spread <= 0) throw new Error(`invalid spread for ${s.name}`);
    const z = ((twin[i] as number) - (bases[baseIndex][i] as number)) / spread;
    if (!Number.isFinite(z)) throw new Error(`nonfinite z for ${s.name}`);
    return [{ signal: s.name, spread, z }];
  });
  // Stable signal order breaks ties; a zero score has no winning side/signal.
  const winner = bySignal.reduce((a, b) => Math.abs(b.z) > Math.abs(a.z) ? b : a);
  return { D: Math.abs(winner.z), signal: winner.z === 0 ? null : winner.signal,
    side: winner.z === 0 ? null : winner.z > 0 ? "high" : "low", bySignal };
}

/** Calibration only: this zero-false-alarm set is never a held-out result. */
export function threshold3(nudges: readonly number[]): number {
  if (nudges.length !== 10 || nudges.some((d) => !Number.isFinite(d) || d < 0)) throw new Error("ten finite nonnegative calibration scores required");
  return Math.max(...nudges);
}
export function hit3(score: number, threshold: number): boolean {
  if (![score, threshold].every((v) => Number.isFinite(v) && v >= 0)) throw new Error("invalid score or threshold");
  return score > threshold;
}
