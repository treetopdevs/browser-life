/**
 * The pre-stated reading of the readouts (docs/b2-compartment-check-2026-11-21/PLAN.md, "Thresholds, fixed now").
 * Pure functions, so the reading can be unit-tested and recomputed from the segment files.
 */

import type { WindowReadouts } from './readouts.ts';

export type WindowLabel = 'bodies' | 'wave patches' | 'persistent domains, not bounded' | 'mixed' | 'no objects';

export interface Reading {
  readonly label: WindowLabel;
  /** Each criterion's outcome. null: it could not be evaluated (no samples reached that lag). */
  readonly checks: Record<'B1' | 'B2' | 'B3' | 'V1' | 'V2' | 'V3', boolean | null>;
  /** The mean count of the window's two halves differ by less than 10%. */
  readonly settled: boolean;
}

export const THRESHOLDS = {
  b1KeptId1000: 0.5,
  b2TilesKept1000: 0.5,
  b3Solid: 0.8,
  b3Isolated: 0.5,
  b3Moat: 0.5,
  v1KeptId1000: 0.1,
  /** V2: tiles still wall after 1,000 steps within this distance of the chance level, on either side. */
  v2OverChance: 0.1,
  v3Isolated: 0.25,
  divisionShare: 0.8,
  divisionMinBirths: 20,
  seedsNeeded: 3,
  settledWithin: 0.1,
} as const;

export function classifyWindow(r: WindowReadouts): Reading {
  const T = THRESHOLDS;
  const ge = (x: number | null, t: number) => (x === null ? null : x >= t);
  const le = (x: number | null, t: number) => (x === null ? null : x <= t);
  const b3 = r.solid === null || r.isolated === null || r.moatMedian === null ? null : r.solid >= T.b3Solid && r.isolated >= T.b3Isolated && r.moatMedian >= T.b3Moat;
  const checks = {
    B1: ge(r.surv1000, T.b1KeptId1000),
    B2: ge(r.keepUid1000, T.b2TilesKept1000),
    B3: b3,
    V1: le(r.surv1000, T.v1KeptId1000),
    V2: r.keepMask1000 === null || r.chance1000 === null ? null : Math.abs(r.keepMask1000 - r.chance1000) <= T.v2OverChance,
    V3: le(r.isolated, T.v3Isolated),
  };
  const hi = Math.max(r.countFirstHalf, r.countSecondHalf);
  const settled = hi > 0 && Math.abs(r.countFirstHalf - r.countSecondHalf) / hi < T.settledWithin;
  let label: WindowLabel;
  if (r.samples === 0) label = 'no objects';
  else if (checks.B1 && checks.B2 && checks.B3) label = 'bodies';
  else if (checks.V1 && checks.V2 && checks.V3) label = 'wave patches';
  else if (checks.B1 && checks.B2 && checks.B3 === false) label = 'persistent domains, not bounded';
  else label = 'mixed';
  return { label, checks, settled };
}

export interface DivisionReading {
  readonly lasting: number;
  readonly withParent: number;
  readonly share: number | null;
  readonly label: 'division holds' | 'division does not hold' | 'division not observed';
}

/** Lasting births pooled over a world's tracked windows and seeds. */
export function classifyDivision(windows: readonly WindowReadouts[]): DivisionReading {
  let lasting = 0;
  let withParent = 0;
  for (const w of windows) {
    lasting += w.lastingBirths.fission + w.lastingBirths.switch + w.lastingBirths.denovo;
    withParent += w.lastingBirths.fission + w.lastingBirths.switch;
  }
  const share = lasting > 0 ? withParent / lasting : null;
  const label = lasting < THRESHOLDS.divisionMinBirths ? 'division not observed' : (share as number) >= THRESHOLDS.divisionShare ? 'division holds' : 'division does not hold';
  return { lasting, withParent, share, label };
}

export type WorldAnswer = 'compartments' | 'bodies, division not shown' | 'wave patches' | 'persistent domains, not bounded' | 'mixed';

/** The answer for one world from its settled-window readings (one per seed) and its division reading. */
export function answerWorld(settledLabels: readonly WindowLabel[], division: DivisionReading): WorldAnswer {
  const n = (l: WindowLabel) => settledLabels.filter((x) => x === l).length;
  const need = THRESHOLDS.seedsNeeded;
  if (n('bodies') >= need) return division.label === 'division holds' ? 'compartments' : 'bodies, division not shown';
  if (n('wave patches') >= need) return 'wave patches';
  if (n('persistent domains, not bounded') >= need) return 'persistent domains, not bounded';
  return 'mixed';
}
