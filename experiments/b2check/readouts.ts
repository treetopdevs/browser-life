/**
 * Readouts over one tracked window, and the pre-stated reading of them (docs/b2-compartment-check-2026-11-21/PLAN.md).
 * Pure functions over tracker output, so they can be unit-tested and recomputed from the segment files.
 */

import type { BirthKind, EndKind, TrackerResult } from './observe.ts';

export interface WindowReadouts {
  readonly from: number;
  readonly to: number;
  /** Mean, min and max of the confirmation's droplet count over the window's censuses. */
  readonly count: number;
  readonly countMin: number;
  readonly countMax: number;
  /** Mean count in the first and second half of the window (settling check). */
  readonly countFirstHalf: number;
  readonly countSecondHalf: number;
  readonly samples: number;
  /** Share of sampled objects whose id is still present 100, 500 and 1,000 steps later. */
  readonly surv100: number | null;
  readonly surv500: number | null;
  readonly surv1000: number | null;
  /** Sampled objects that could be read again 1,000 steps later (the denominator of the +1,000 readouts). */
  readonly read1000: number;
  /** Median centroid displacement in tiles over 100 and 1,000 steps, objects present at both ends. */
  readonly disp100: number | null;
  readonly disp1000: number | null;
  readonly disp1000N: number;
  /** Mean share of an object's tiles still inside the same id 1,000 steps later (0 when the id is gone). */
  readonly keepUid1000: number | null;
  /** Share of object tiles still at or above the threshold for the same wall type after 100 and 1,000 steps, and the chance level. */
  readonly keepMask100: number | null;
  readonly keepMask1000: number | null;
  readonly chance1000: number | null;
  readonly solid: number | null;
  readonly isolated: number | null;
  readonly moatMedian: number | null;
  readonly peakMedian: number | null;
  readonly peakP90: number | null;
  readonly meanDensityMedian: number | null;
  readonly purityMedian: number | null;
  readonly areaMedian: number | null;
  /** Largest single-type wall on any tile at any 500-step census of the window. */
  readonly maxW: number;
  /** Largest own-type wall on one tile of any object at any frame of the window (fraction of a tile). */
  readonly maxPeak: number;
  /** Mean over censuses: patches of total wall >= 0.20 (type-blind), patches of total wall >= 0.05, the largest such patch's share. */
  readonly dropBlind: number;
  readonly lowComps: number;
  readonly lowLargestShare: number;
  readonly lowCover: number;
  readonly cover: number;
  /** Objects first seen inside the window (not at its first frame), by how they arose. */
  readonly births: Record<Exclude<BirthKind, 'initial'>, number>;
  /** Objects last seen inside the window, by how they ended. */
  readonly ends: Record<EndKind, number>;
  /** Object-steps observed, in thousands (the denominator for the rates below). */
  readonly objectKiloSteps: number;
  /** Births and ends per object per 1,000 steps. */
  readonly birthRate: number;
  readonly endRate: number;
  /** Fission daughters born at least 500 steps before the window's end: how many, the share still present 500 steps after the split, and the share absorbed back by their parent within 500 steps. */
  readonly daughters: number;
  readonly daughtersHeld500: number | null;
  readonly daughtersRejoined500: number | null;
  /** Objects first seen inside the window at least 500 steps before its end that were still present 500 steps after they appeared, by how they arose. */
  readonly lastingBirths: Record<Exclude<BirthKind, 'initial'>, number>;
  /** Median lifetime in steps of objects both born and ended inside the window, and how many of those there are. */
  readonly lifetimeMedian: number | null;
  readonly lifetimeN: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 === 1 ? s[k] : (s[k - 1] + s[k]) / 2;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const share = (xs: boolean[]): number | null => (xs.length === 0 ? null : xs.filter(Boolean).length / xs.length);

export function windowReadouts(tr: TrackerResult, drops: readonly { t: number; drop: number }[], dt: number): WindowReadouts {
  const from = tr.firstStep;
  const to = tr.lastStep;
  const counts = drops.map((r) => r.drop);
  const mid = (from + to) / 2;
  const lagRows = (lag: number) => tr.samples.flatMap((s) => s.lags.filter((r) => r.lag === lag).map((r) => ({ s, r })));
  const l100 = lagRows(100);
  const l500 = lagRows(500);
  const l1000 = lagRows(1000);
  const dispOf = (rows: typeof l100) => rows.filter((x) => x.r.disp !== null).map((x) => x.r.disp as number);
  const maskShare = (rows: typeof l100) => {
    const area = rows.reduce((a, x) => a + x.s.area, 0);
    return area > 0 ? rows.reduce((a, x) => a + x.r.keepMask * x.s.area, 0) / area : null;
  };
  const chanceArea = l1000.reduce((a, x) => a + x.s.area, 0);

  const births = { fission: 0, switch: 0, denovo: 0 };
  const ends = { fade: 0, absorbed: 0, switch: 0 };
  const lastingBirths = { fission: 0, switch: 0, denovo: 0 };
  let frames = 0;
  const lifetimes: number[] = [];
  const held: boolean[] = [];
  const rejoined: boolean[] = [];
  for (const rec of tr.records) {
    frames += rec.frames;
    if (rec.birth !== 'initial') births[rec.birth]++;
    if (rec.end !== null && rec.endKind) ends[rec.endKind]++;
    if (rec.birth !== 'initial' && rec.end !== null) lifetimes.push(rec.end - rec.born);
    if (rec.birth !== 'initial' && rec.born + 500 <= to && (rec.end === null || rec.end - rec.born > 500)) lastingBirths[rec.birth]++;
    if (rec.birth === 'fission' && rec.born + 500 <= to) {
      const gone = rec.end !== null && rec.end - rec.born <= 500;
      held.push(!gone);
      rejoined.push(gone && rec.endKind === 'absorbed' && rec.into === rec.parent);
    }
  }
  const objectKiloSteps = (frames * dt) / 1000;
  const nBirths = births.fission + births.switch + births.denovo;
  const nEnds = ends.fade + ends.absorbed + ends.switch;
  const c = tr.census;
  return {
    from,
    to,
    count: mean(counts) ?? 0,
    countMin: counts.length ? Math.min(...counts) : 0,
    countMax: counts.length ? Math.max(...counts) : 0,
    countFirstHalf: mean(drops.filter((r) => r.t <= mid).map((r) => r.drop)) ?? 0,
    countSecondHalf: mean(drops.filter((r) => r.t > mid).map((r) => r.drop)) ?? 0,
    samples: tr.samples.length,
    surv100: share(l100.map((x) => x.r.alive)),
    surv500: share(l500.map((x) => x.r.alive)),
    surv1000: share(l1000.map((x) => x.r.alive)),
    read1000: l1000.length,
    disp100: median(dispOf(l100)),
    disp1000: median(dispOf(l1000)),
    disp1000N: dispOf(l1000).length,
    keepUid1000: mean(l1000.map((x) => x.r.keepUid)),
    keepMask100: maskShare(l100),
    keepMask1000: maskShare(l1000),
    chance1000: chanceArea > 0 ? l1000.reduce((a, x) => a + x.r.chance * x.s.area, 0) / chanceArea : null,
    solid: share(tr.samples.map((s) => s.solid)),
    isolated: share(tr.samples.map((s) => s.isolated)),
    moatMedian: median(tr.samples.map((s) => s.moat)),
    peakMedian: median(tr.samples.map((s) => s.peak)),
    peakP90: quantile(tr.samples.map((s) => s.peak), 0.9),
    meanDensityMedian: median(tr.samples.map((s) => s.mean)),
    purityMedian: median(tr.samples.map((s) => s.purity)),
    areaMedian: median(tr.samples.map((s) => s.area)),
    maxW: c.reduce((a, r) => Math.max(a, r.maxW), 0),
    maxPeak: tr.records.reduce((a, r) => Math.max(a, r.maxPeak), 0) / 1024,
    dropBlind: mean(c.map((r) => r.dropBlind)) ?? 0,
    lowComps: mean(c.map((r) => r.lowComps)) ?? 0,
    lowLargestShare: mean(c.map((r) => r.lowLargestShare)) ?? 0,
    lowCover: mean(c.map((r) => r.lowCover)) ?? 0,
    cover: mean(c.map((r) => r.cover)) ?? 0,
    births,
    ends,
    objectKiloSteps,
    birthRate: objectKiloSteps > 0 ? nBirths / objectKiloSteps : 0,
    endRate: objectKiloSteps > 0 ? nEnds / objectKiloSteps : 0,
    daughters: held.length,
    daughtersHeld500: share(held),
    daughtersRejoined500: share(rejoined),
    lastingBirths,
    lifetimeMedian: median(lifetimes),
    lifetimeN: lifetimes.length,
  };
}
