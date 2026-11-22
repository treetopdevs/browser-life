/**
 * SPOT6: the pre-stated readings (docs/six-wall-spot-2026-11-22/PLAN.md). Pure functions over run rows and
 * tracker output, so every reading can be unit-tested and recomputed from the segment files.
 *
 * The body readings (B1 to B3, wave criteria, the 10% settled test) are B2CHECK's, imported unchanged from
 * experiments/b2check/verdict.ts. What is new here: division read without type switches and per half-window,
 * "phage alive" against the emergence floor, a numeric pattern turnover, the confirmation's five endpoints
 * for seeds 1 to 4, the clean-arm gate, and one named outcome per setting.
 */

import type { DropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import type { TrackerResult, UidRecord } from '../b2check/observe.ts';
import type { WindowLabel } from '../b2check/verdict.ts';
import { FINAL, inWindow, majorSweeps, mean, type DropletRow } from '../confirm/rule.ts';
import type { Segment } from '../b2check/segments.ts';
import type { BirthNote, BodyLogResult } from './bodylog.ts';

/** A census row: the confirmation's fields plus the six wall shares, phage by type and the place readout. */
export interface Row extends DropletRow {
  /** Share of all wall matter held by each of the six types. */
  shares: number[];
  /** Phage matter by type. */
  phageBy: number[];
  /** Of the tiles with total wall of 0.05 or more 1,000 steps earlier, the share that still have it with the same leading type. null: no census 1,000 steps earlier in this segment. */
  keepLead1000: number | null;
}

/** One finished segment of a run, as run.ts writes it. */
export interface SegmentFile {
  meta: { check: string; setting: string; arm: string; seed: number; size: number; dt: number; census: number; cfg: DropletKernelConfig; emergenceBound: number; frozen: Record<string, string> };
  segment: Segment;
  rows: Row[];
  tracker: TrackerResult | null;
  bodylog: BodyLogResult | null;
}

export const T = {
  /** Division: lasting births of new bodies, pooled over the eligible seeds' settled windows. */
  divisionMinBirths: 20,
  divisionShare: 0.8,
  /** At least this share of those births must fall in the second half of the window. */
  divisionSecondHalfShare: 0.25,
  /** Lasting ends must be at least this share of those births (births with no ends are a lattice still filling). */
  divisionEndsShare: 0.5,
  /** A seed "contributes" to division with at least this many of those births. */
  divisionPerSeed: 5,
  /** Phage alive: mean phage at least this many times the most that emergence alone could hold. */
  phageBoundTimes: 10,
  /** Phage alive is also tested on the last this-many censuses of the window (2,000 steps). */
  phageLastCensuses: 4,
  /** Pattern turnover counts as above NO_PHAGE at this ratio or more, and at this absolute level or more. */
  turnoverRatio: 1.5,
  turnoverMin: 0.01,
  /** A named outcome needs its criteria on this many of four seeds. */
  seedsNeeded: 3,
  /** A lasting birth or a lasting end is one that held, or had held, for more than this many steps. */
  lastingSteps: 500,
  /** A birth is a return if at least this share of its tiles lie on the last footprint of an object that ended at most `returnSteps` earlier. */
  returnShare: 0.5,
  returnSteps: 500,
} as const;

// ---------------------------------------------------------------------------------------------------------
// Phage alive
// ---------------------------------------------------------------------------------------------------------

export interface PhageReading {
  /** The confirmation's test: phage above zero at the last census. */
  readonly presentAtEnd: boolean;
  /** Mean phage over the window's censuses, over its second half, and over its last four censuses (matter units). */
  readonly mean: number;
  readonly meanSecondHalf: number;
  readonly meanLast: number;
  /** The most phage emergence alone could hold (settings.ts, `emergenceBound`). */
  readonly bound: number;
  /** presentAtEnd, and both the second half and the last four censuses at 10 x bound or more. */
  readonly alive: boolean;
}

/** `windowRows` in time order. An early bloom that has died back to the emergence level does not read as alive. */
export function readPhage(windowRows: readonly { phage: number }[], bound: number): PhageReading {
  const avg = (rows: readonly { phage: number }[]) => (rows.length > 0 ? mean(rows.map((r) => r.phage)) : 0);
  const n = windowRows.length;
  const meanSecondHalf = avg(windowRows.slice(Math.floor(n / 2)));
  const meanLast = avg(windowRows.slice(Math.max(0, n - T.phageLastCensuses)));
  const presentAtEnd = n > 0 && windowRows[n - 1].phage > 0;
  const bar = T.phageBoundTimes * bound;
  return { presentAtEnd, mean: avg(windowRows), meanSecondHalf, meanLast, bound, alive: presentAtEnd && meanSecondHalf >= bar && meanLast >= bar };
}

// ---------------------------------------------------------------------------------------------------------
// Pattern turnover
// ---------------------------------------------------------------------------------------------------------

/**
 * Mean, over the pairs of censuses `lag` steps apart inside `rows`, of half the summed absolute change of the
 * six wall shares (0: the shares did not move; 1: all wall changed type). null if there is no such pair.
 */
export function patternTurnover(rows: readonly { t: number; shares: number[] }[], lag = 1000): number | null {
  const byT = new Map<number, number[]>();
  for (const r of rows) byT.set(r.t, r.shares);
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const later = byT.get(r.t + lag);
    if (!later) continue;
    let d = 0;
    for (let m = 0; m < r.shares.length; m++) d += Math.abs(later[m] - r.shares[m]);
    sum += d / 2;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** "Pattern turnover higher than NO_PHAGE" on one seed: a living control, a minimum level and a margin. */
export function turnoverAbove(phage: number | null, noPhage: number | null, noPhageAlive: boolean): boolean {
  return noPhageAlive && phage !== null && noPhage !== null && phage >= T.turnoverMin && phage >= T.turnoverRatio * noPhage;
}

// ---------------------------------------------------------------------------------------------------------
// Division and body turnover, from one tracked window
// ---------------------------------------------------------------------------------------------------------

export interface KindCount {
  fission: number;
  switch: number;
  denovo: number;
}

export interface BodyReadouts {
  /** Every lasting birth by the tracker's kind, per half of the window (the compartment check's count, before this line's exclusions). */
  readonly lastingFirstHalf: KindCount;
  readonly lastingSecondHalf: KindCount;
  /** Lasting births that count as new bodies (see `bodyReadouts`), per half. */
  readonly newFirstHalf: { fission: number; denovo: number };
  readonly newSecondHalf: { fission: number; denovo: number };
  /** Lasting births that do not count as new bodies, by reason. */
  readonly notNew: { switch: number; severed: number; returned: number; rejoined: number; preexisting: number; joined: number };
  /** Ends by fade or absorption of bodies that had been present more than 500 steps, and how many of those were followed by a return or a re-separation. */
  readonly lastingEnds: number;
  readonly returnedEnds: number;
  /** Such ends of pieces (severed daughters, and fission daughters never apart from their parent at 0.05): not in `lastingEnds`. */
  readonly pieceEnds: number;
  /** Ends by type switch of objects that had been present more than 500 steps. */
  readonly lastingSwitchEnds: number;
  /** Object-steps observed, in thousands. */
  readonly objectKiloSteps: number;
  /** Per object per 1,000 steps: new-body births, lasting ends not returned, lasting switch ends. */
  readonly birthRate: number;
  readonly endRate: number;
  readonly switchRate: number;
}

const isLastingBirth = (r: UidRecord, to: number) => r.birth !== 'initial' && r.born + T.lastingSteps <= to && (r.end === null || r.end - r.born > T.lastingSteps);

type BirthClass = 'new' | 'switch' | 'severed' | 'returned' | 'rejoined' | 'preexisting' | 'joined';

/**
 * A lasting birth is a new body unless it is:
 * - a type switch (the kernel relabelled a patch: the body was already there);
 * - severed: a fission daughter joined to its parent by total wall of 0.20 or more at its first frame (the
 *   patch was cut by another type's wall, as a partial relabelling does, not by water);
 * - returned: at least half its tiles lie on the last footprint of a same-type object that ended at most 500
 *   steps earlier (a body that dipped under the counting rule and came back);
 * - rejoined: a fission daughter where it, or the part that kept the parent's id, lies (at least half) on the
 *   last footprint of an object that had been absorbed, directly or through a chain of absorptions, into its
 *   parent or any object its parent descends from by fission, at any earlier time in the window (two bodies
 *   bridged, then apart again);
 * - preexisting: a fission daughter at least half of whose tiles were, at the window's first frame, inside an
 *   object in its own line of descent (its parent, the object that split from, and so on) or one later
 *   absorbed into that line (they were one object when the window began, so what happened before cannot be
 *   checked);
 * - joined: a fission daughter that, 500 steps after it appeared, does not stand apart from its parent at the
 *   low-wall level of 0.05, or whose parent is gone by then (two lobes whose neck wobbles round 0.20).
 * An end is "returned" if a returned or rejoined birth points at it. The end of a piece (a severed daughter, or
 * any fission daughter that did not stand apart from its parent at 0.05 after 500 steps) is not the end of a body.
 */
function classify(r: UidRecord, note: BirthNote | undefined, rec: Map<number, UidRecord>): { cls: BirthClass; of: number } {
  if (r.birth === 'switch') return { cls: 'switch', of: 0 };
  if (!note) return { cls: 'new', of: 0 };
  if (r.birth === 'fission' && note.mates.includes(r.parent)) return { cls: 'severed', of: 0 };
  if (note.of !== 0 && note.share >= T.returnShare && note.gap <= T.returnSteps) return { cls: 'returned', of: note.of };
  if (r.birth === 'fission') {
    // The daughter's line of descent inside the window: its parent, the object that one split from, and so on.
    const line = new Set<number>();
    for (let at = r.parent, hop = 0; at !== 0 && hop < 64 && !line.has(at); hop++) {
      line.add(at);
      at = rec.get(at)?.parent ?? 0;
    }
    // The object is in that line, or was absorbed (directly or through a chain) into an object in it.
    const inLine = (uid: number) => {
      let at = uid;
      for (let hop = 0; hop < 64; hop++) {
        if (line.has(at)) return true;
        const x = rec.get(at);
        if (x === undefined || x.endKind !== 'absorbed') return false;
        at = x.into;
      }
      return false;
    };
    const wasAbsorbedIntoLine = (uid: number) => !line.has(uid) && inLine(uid);
    if (note.of !== 0 && note.share >= T.returnShare && wasAbsorbedIntoLine(note.of)) return { cls: 'rejoined', of: note.of };
    const k = note.keeper;
    if (k && k.uid === r.parent && k.of !== 0 && k.share >= T.returnShare && wasAbsorbedIntoLine(k.of)) return { cls: 'rejoined', of: k.of };
    if (note.atStart.uid !== 0 && note.atStart.share >= T.returnShare && inLine(note.atStart.uid)) return { cls: 'preexisting', of: 0 };
    if (note.apartLow !== true) return { cls: 'joined', of: 0 };
  }
  return { cls: 'new', of: 0 };
}

export function bodyReadouts(tr: TrackerResult, dt: number, log: BodyLogResult): BodyReadouts {
  const mid = (tr.firstStep + tr.lastStep) / 2;
  const allFirst: KindCount = { fission: 0, switch: 0, denovo: 0 };
  const allSecond: KindCount = { fission: 0, switch: 0, denovo: 0 };
  const newFirst = { fission: 0, denovo: 0 };
  const newSecond = { fission: 0, denovo: 0 };
  const notNew = { switch: 0, severed: 0, returned: 0, rejoined: 0, preexisting: 0, joined: 0 };
  const notes = new Map<number, BirthNote>();
  for (const b of log.births) notes.set(b.uid, b);
  const rec = new Map<number, UidRecord>();
  for (const r of tr.records) rec.set(r.uid, r);
  // Every birth is classified, lasting or not: an end is returned even if what came back did not last.
  const returned = new Set<number>();
  const pieces = new Set<number>();
  let frames = 0;
  for (const r of tr.records) {
    frames += r.frames;
    if (r.birth === 'initial') continue;
    const { cls, of } = classify(r, notes.get(r.uid), rec);
    if (of !== 0) returned.add(of);
    // A fission daughter that never stood apart from its parent at the low-wall level is a piece, whatever else it is.
    if (r.birth === 'fission' && (cls === 'severed' || notes.get(r.uid)?.apartLow !== true)) pieces.add(r.uid);
    if (!isLastingBirth(r, tr.lastStep)) continue;
    const firstHalf = r.born <= mid;
    (firstHalf ? allFirst : allSecond)[r.birth]++;
    if (cls === 'new') (firstHalf ? newFirst : newSecond)[r.birth as 'fission' | 'denovo']++;
    else notNew[cls]++;
  }
  let lastingEnds = 0;
  let returnedEnds = 0;
  let pieceEnds = 0;
  let lastingSwitchEnds = 0;
  for (const r of tr.records) {
    if (r.end === null || r.end - r.born <= T.lastingSteps) continue;
    if (r.endKind === 'switch') lastingSwitchEnds++;
    else if (pieces.has(r.uid)) pieceEnds++;
    else {
      lastingEnds++;
      if (returned.has(r.uid)) returnedEnds++;
    }
  }
  const kilo = (frames * dt) / 1000;
  const births = newFirst.fission + newFirst.denovo + newSecond.fission + newSecond.denovo;
  return {
    lastingFirstHalf: allFirst,
    lastingSecondHalf: allSecond,
    newFirstHalf: newFirst,
    newSecondHalf: newSecond,
    notNew,
    lastingEnds,
    returnedEnds,
    pieceEnds,
    lastingSwitchEnds,
    objectKiloSteps: kilo,
    birthRate: kilo > 0 ? births / kilo : 0,
    endRate: kilo > 0 ? (lastingEnds - returnedEnds) / kilo : 0,
    switchRate: kilo > 0 ? lastingSwitchEnds / kilo : 0,
  };
}

export const newBirths = (b: BodyReadouts) => b.newFirstHalf.fission + b.newFirstHalf.denovo + b.newSecondHalf.fission + b.newSecondHalf.denovo;

export interface DivisionReading {
  /** Windows pooled. */
  readonly windows: number;
  /** Lasting births of new bodies. */
  readonly lasting: number;
  readonly fission: number;
  readonly secondHalf: number;
  /** Lasting ends (fade or absorbed) not followed by a return. */
  readonly ends: number;
  /** Windows with at least five of those births. */
  readonly contributing: number;
  readonly share: number | null;
  readonly secondHalfShare: number | null;
  readonly label: 'division holds' | 'division does not hold' | 'division not observed';
  readonly failed: string[];
}

/**
 * Division over a set of windows pooled: the settled windows of a setting's eligible seeds (then `need` is the
 * number of windows that must each contribute), or a founding window (reported; decides nothing).
 */
export function readDivision(windows: readonly BodyReadouts[], minBirths: number = T.divisionMinBirths, need = 0): DivisionReading {
  let fission = 0;
  let denovo = 0;
  let secondHalf = 0;
  let ends = 0;
  let contributing = 0;
  for (const w of windows) {
    fission += w.newFirstHalf.fission + w.newSecondHalf.fission;
    denovo += w.newFirstHalf.denovo + w.newSecondHalf.denovo;
    secondHalf += w.newSecondHalf.fission + w.newSecondHalf.denovo;
    ends += w.lastingEnds - w.returnedEnds;
    if (newBirths(w) >= T.divisionPerSeed) contributing++;
  }
  const lasting = fission + denovo;
  const share = lasting > 0 ? fission / lasting : null;
  const secondHalfShare = lasting > 0 ? secondHalf / lasting : null;
  const failed: string[] = [];
  if (lasting < minBirths) failed.push(`fewer than ${minBirths} lasting births of new bodies (${lasting})`);
  else {
    if ((share as number) < T.divisionShare) failed.push(`under ${100 * T.divisionShare}% of lasting births have a parent (${fission} of ${lasting})`);
    if ((secondHalfShare as number) < T.divisionSecondHalfShare) failed.push(`under ${100 * T.divisionSecondHalfShare}% of lasting births fall in the second half of the window (${secondHalf} of ${lasting})`);
    if (ends < T.divisionEndsShare * lasting) failed.push(`lasting ends are under ${100 * T.divisionEndsShare}% of lasting births (${ends} against ${lasting}): the dish is still filling`);
    if (contributing < need) failed.push(`${contributing} seeds have at least ${T.divisionPerSeed} lasting births each (${need} needed)`);
  }
  const label = lasting < minBirths ? 'division not observed' : failed.length === 0 ? 'division holds' : 'division does not hold';
  return { windows: windows.length, lasting, fission, secondHalf, ends, contributing, share, secondHalfShare, label, failed };
}

// ---------------------------------------------------------------------------------------------------------
// Erosion: does a body lose wall and recover, or end? From the 50-step series of the body log.
// ---------------------------------------------------------------------------------------------------------

export interface ErosionReadouts {
  /** Objects with at least `minSamples` series samples in the window, and their object-steps in thousands. */
  readonly bodies: number;
  readonly bodyKiloSteps: number;
  /** Dips (own wall under half the body's own median) that ended with the same id back at 80% of its median or more. */
  readonly recoveredDips: number;
  /** Fade or absorbed ends whose last sample was inside a dip, and those whose last sample was not. */
  readonly endsAfterDip: number;
  readonly endsSudden: number;
  /** Median own-type phage per tile of footprint: over all samples, at the first sample of a dip, at the last sample before a sudden end. */
  readonly phageUsual: number | null;
  readonly phageAtDip: number | null;
  readonly phageBeforeSuddenEnd: number | null;
  /** From the 10-step end traces of those bodies: the largest own-type phage per tile in the last 200 steps before a fade or absorbed end, median over ends. */
  readonly phagePeakBeforeEnd: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 === 1 ? s[k] : (s[k - 1] + s[k]) / 2;
}

export function erosionReadouts(tr: TrackerResult, log: BodyLogResult, minSamples = 20): ErosionReadouts {
  const per = new Map<number, { mass: number[]; phage: number[]; area: number[] }>();
  for (const f of log.series) {
    for (let k = 0; k < f.uid.length; k++) {
      let s = per.get(f.uid[k]);
      if (!s) per.set(f.uid[k], (s = { mass: [], phage: [], area: [] }));
      s.mass.push(f.mass[k]);
      s.phage.push(f.phage[k]);
      s.area.push(f.area[k]);
    }
  }
  const rec = new Map<number, UidRecord>();
  for (const r of tr.records) rec.set(r.uid, r);
  const trace = new Map<number, BodyLogResult['ends'][number]>();
  for (const e of log.ends) trace.set(e.uid, e);
  let bodies = 0;
  let samples = 0;
  let recoveredDips = 0;
  let endsAfterDip = 0;
  let endsSudden = 0;
  const usual: number[] = [];
  const atDip: number[] = [];
  const beforeSudden: number[] = [];
  const peakBeforeEnd: number[] = [];
  for (const [uid, s] of per) {
    if (s.mass.length < minSamples) continue;
    bodies++;
    samples += s.mass.length;
    const m = median(s.mass) as number;
    let inDip = false;
    for (let k = 0; k < s.mass.length; k++) {
      const perTile = s.phage[k] / s.area[k];
      usual.push(perTile);
      if (!inDip && s.mass[k] < 0.5 * m) {
        inDip = true;
        atDip.push(perTile);
      } else if (inDip && s.mass[k] >= 0.8 * m) {
        inDip = false;
        recoveredDips++;
      }
    }
    const r = rec.get(uid);
    if (r && r.end !== null && r.endKind !== 'switch') {
      if (inDip) endsAfterDip++;
      else {
        endsSudden++;
        const last = s.mass.length - 1;
        beforeSudden.push(s.phage[last] / s.area[last]);
      }
      const e = trace.get(uid);
      if (e) {
        let peak = 0;
        for (let k = 0; k < e.phage.length; k++) peak = Math.max(peak, e.phage[k] / e.area[k]);
        peakBeforeEnd.push(peak);
      }
    }
  }
  return {
    bodies,
    bodyKiloSteps: (samples * log.seriesEvery) / 1000,
    recoveredDips,
    endsAfterDip,
    endsSudden,
    phageUsual: median(usual),
    phageAtDip: median(atDip),
    phageBeforeSuddenEnd: median(beforeSudden),
    phagePeakBeforeEnd: median(peakBeforeEnd),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Phage load: how much own-type phage bodies carry (described; no threshold)
// ---------------------------------------------------------------------------------------------------------

export interface PhageLoad {
  /** Series samples (one object at one 50-step frame). */
  readonly samples: number;
  /** Share of samples with own-type phage of at least 1 and at least 10 units per tile of footprint. */
  readonly withPhage1: number | null;
  readonly withPhage10: number | null;
  /** Mean own-type phage per tile of footprint. */
  readonly meanPerTile: number | null;
  /** Mean own-type wall per tile (fraction of a tile) and mean area, for samples with at least 10 units of phage per tile and for samples with under 1. */
  readonly wallLoaded: number | null;
  readonly wallClean: number | null;
  readonly areaLoaded: number | null;
  readonly areaClean: number | null;
  /** Own-type phage on the tiles of counted objects at the window's last census, as a share of all phage in the dish (phage of other types on those tiles is not in it). */
  readonly onFootprints: number | null;
}

export function phageLoad(log: BodyLogResult, lastRow: { t: number; phage: number }): PhageLoad {
  let n = 0;
  let p1 = 0;
  let p10 = 0;
  let sum = 0;
  const loaded = { n: 0, wall: 0, area: 0 };
  const clean = { n: 0, wall: 0, area: 0 };
  for (const f of log.series) {
    for (let k = 0; k < f.uid.length; k++) {
      const per = f.phage[k] / f.area[k];
      n++;
      sum += per;
      if (per >= 1) p1++;
      if (per >= 10) p10++;
      const bin = per >= 10 ? loaded : per < 1 ? clean : null;
      if (bin) {
        bin.n++;
        bin.wall += f.mass[k] / f.area[k] / 1024;
        bin.area += f.area[k];
      }
    }
  }
  const last = log.series.find((f) => f.t === lastRow.t);
  const on = last ? last.phage.reduce((a, b) => a + b, 0) : null;
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    samples: n,
    withPhage1: div(p1, n),
    withPhage10: div(p10, n),
    meanPerTile: div(sum, n),
    wallLoaded: div(loaded.wall, loaded.n),
    wallClean: div(clean.wall, clean.n),
    areaLoaded: div(loaded.area, loaded.n),
    areaClean: div(clean.area, clean.n),
    onFootprints: on !== null && lastRow.phage > 0 ? on / lastRow.phage : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The confirmation's five endpoints, for any seed list and run length
// ---------------------------------------------------------------------------------------------------------

export type Arm = 'PHAGE' | 'NO_PHAGE' | 'SINGLE_WALL' | 'NEUTRAL_PHAGE';
export type ArmRuns = Partial<Record<Arm, Record<number, readonly DropletRow[]>>>;

export interface Endpoint {
  readonly id: string;
  /** null for a seed whose needed arms were not run. */
  readonly perSeed: Record<number, boolean | null>;
  readonly wins: number;
  readonly of: number;
}

/**
 * D1 to D5 exactly as `judgeDroplets` states them (experiments/confirm/rule.ts), over the final 20% of a run
 * of `steps` steps. `judgeDroplets` itself is fixed to seeds 5 to 12 and 500,000 steps, so its five tests are
 * restated here from its exported pieces; experiments/test/spot6-rule.test.ts checks the two agree.
 */
export function endpoints(runs: ArmRuns, seeds: readonly number[], steps: number): Endpoint[] {
  const has = (arm: Arm, s: number) => runs[arm]?.[s] !== undefined;
  const rowsOf = (arm: Arm, s: number) => runs[arm]![s];
  const fin = (arm: Arm, s: number) => inWindow(rowsOf(arm, s), steps, FINAL);
  const drop = (arm: Arm, s: number) => mean(fin(arm, s).map((r) => r.drop));
  const d1 = (arm: Arm, s: number) => mean(fin(arm, s).map((r) => r.d1));
  const alive = (arm: Arm, s: number) => rowsOf(arm, s)[rowsOf(arm, s).length - 1].drop > 0;
  const make = (id: string, needs: readonly Arm[], test: (s: number) => boolean): Endpoint => {
    const perSeed: Record<number, boolean | null> = {};
    let wins = 0;
    let of = 0;
    for (const s of seeds) {
      if (!needs.every((a) => has(a, s))) {
        perSeed[s] = null;
        continue;
      }
      of++;
      perSeed[s] = test(s);
      if (perSeed[s]) wins++;
    }
    return { id, perSeed, wins, of };
  };
  return [
    make('D1 patch count: PHAGE > NEUTRAL_PHAGE', ['PHAGE', 'NEUTRAL_PHAGE'], (s) => alive('PHAGE', s) && drop('PHAGE', s) > drop('NEUTRAL_PHAGE', s)),
    make('D2 patch count: PHAGE > SINGLE_WALL', ['PHAGE', 'SINGLE_WALL'], (s) => alive('PHAGE', s) && drop('PHAGE', s) > drop('SINGLE_WALL', s)),
    make('D3 leader sweeps: PHAGE > NO_PHAGE', ['PHAGE', 'NO_PHAGE'], (s) => alive('PHAGE', s) && alive('NO_PHAGE', s) && majorSweeps(fin('PHAGE', s)) > majorSweeps(fin('NO_PHAGE', s))),
    make('D4 diversity: PHAGE > NEUTRAL_PHAGE', ['PHAGE', 'NEUTRAL_PHAGE'], (s) => alive('PHAGE', s) && d1('PHAGE', s) > d1('NEUTRAL_PHAGE', s)),
    make('D5 persistence: patch count >= half of NO_PHAGE, D1 >= 2, patches and phage present at the end', ['PHAGE', 'NO_PHAGE'], (s) => {
      const rows = rowsOf('PHAGE', s);
      return alive('PHAGE', s) && alive('NO_PHAGE', s) && drop('PHAGE', s) >= 0.5 * drop('NO_PHAGE', s) && d1('PHAGE', s) >= 2 && rows[rows.length - 1].phage > 0;
    }),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Gate and outcome
// ---------------------------------------------------------------------------------------------------------

export interface GateSeed {
  readonly seed: number;
  readonly label: WindowLabel;
  readonly settled: boolean;
}

/** Stage 1: the NO_PHAGE world must read bodies in a settled window on both of seeds 1 and 2. */
export function gatePasses(seeds: readonly GateSeed[]): boolean {
  return seeds.length === 2 && seeds.every((s) => s.label === 'bodies' && s.settled);
}

/** What one PHAGE run contributes to the outcome. */
export interface SeedFacts {
  readonly seed: number;
  /** No objects at the last census of the reading window. A dead seed's window label counts for nothing. */
  readonly dead: boolean;
  /** B2CHECK's reading of the reading window, and whether that window passed the 10% settled test. */
  readonly label: WindowLabel;
  readonly settled: boolean;
  readonly phageAlive: boolean;
}

export type Outcome = 'back to waves' | 'collapse' | 'phage lost' | 'frozen mosaic' | 'bodies with turnover' | 'mixed / unclear';

export interface OutcomeReading {
  readonly outcome: Outcome | null;
  /** Stage 2 only: the setting goes on to stage 3 (then `outcome` is null until stage 3 is read). */
  readonly advance: boolean;
  /** For "mixed / unclear": the criteria that failed. For other outcomes: what decided it. */
  readonly notes: string[];
}

const count = <X>(xs: readonly X[], f: (x: X) => boolean) => xs.filter(f).length;
const isBodies = (s: SeedFacts) => !s.dead && s.label === 'bodies';
const isWaves = (s: SeedFacts) => !s.dead && s.label === 'wave patches';

/** Stage 2 (PHAGE on seeds 1 and 2). First match applies; every named outcome needs both seeds. */
export function stage2Outcome(seeds: readonly SeedFacts[]): OutcomeReading {
  if (seeds.length !== 2) throw new Error('stage 2 is read on exactly two seeds');
  const n = seeds.length;
  if (count(seeds, (s) => s.dead) === n) return { outcome: 'collapse', advance: false, notes: ['no objects at the end on both seeds'] };
  if (count(seeds, isWaves) === n) return { outcome: 'back to waves', advance: false, notes: ['wave patches on both seeds'] };
  if (count(seeds, isBodies) === n && count(seeds, (s) => s.phageAlive) === 0) return { outcome: 'phage lost', advance: false, notes: ['bodies on both seeds, phage alive on neither'] };
  if (count(seeds, (s) => isBodies(s) && s.phageAlive) === n) return { outcome: null, advance: true, notes: ['objects at the end, phage alive and bodies on both seeds'] };
  const notes: string[] = [];
  for (const s of seeds) {
    const bad: string[] = [];
    if (s.dead) bad.push('no objects at the end');
    else if (s.label !== 'bodies') bad.push(`reads ${s.label}`);
    if (!s.phageAlive) bad.push('phage not alive');
    notes.push(`seed ${s.seed}: ${bad.length ? bad.join(', ') : 'bodies with phage alive'}`);
  }
  return { outcome: 'mixed / unclear', advance: false, notes };
}

/** One seed of stage 3: its PHAGE reading, its settled window's body readouts, and its two comparisons. */
export interface Stage3Seed extends SeedFacts {
  readonly body: BodyReadouts;
  /** Pattern turnover above NO_PHAGE on this seed (`turnoverAbove`). */
  readonly turnoverWin: boolean;
  /** D4 holds on this seed. */
  readonly d4: boolean;
}

export interface SeedRule {
  /** Seeds read, and how many of them a named outcome needs. */
  readonly n: number;
  readonly need: number;
  /** Lasting births of new bodies needed over the eligible seeds' settled windows pooled. */
  readonly minBirths: number;
}
/** Stage 3 of this calibration: seeds 1 to 4, 3 of 4. */
export const STAGE3_RULE: SeedRule = { n: 4, need: T.seedsNeeded, minBirths: T.divisionMinBirths };
/** The rule a later confirmation on unseen seeds 33 to 40 would use (PLAN.md): 7 of 8, twice the births. */
export const CONFIRM_RULE: SeedRule = { n: 8, need: 7, minBirths: 2 * T.divisionMinBirths };

export interface Stage3Reading extends OutcomeReading {
  /** Seeds whose settled window reads bodies with phage alive: the only ones division, turnover and D4 are read on. */
  readonly eligible: number[];
  /** Division pooled over the eligible seeds (null if the rule stopped before reading it). */
  readonly division: DivisionReading | null;
  readonly turnoverWins: number;
  readonly d4Wins: number;
}

/**
 * Stage 3. First match applies. Division, pattern turnover and D4 are read only on eligible seeds: alive,
 * bodies, phage alive, and a settled window. A seed that reads waves cannot supply the fissions.
 */
export function stage3Outcome(seeds: readonly Stage3Seed[], rule: SeedRule = STAGE3_RULE): Stage3Reading {
  const { n, need } = rule;
  if (seeds.length !== n) throw new Error(`stage 3 is read on exactly ${n} seeds`);
  const done = (outcome: Outcome, notes: string[], rest: Partial<Stage3Reading> = {}): Stage3Reading => ({ outcome, advance: false, notes, eligible: [], division: null, turnoverWins: 0, d4Wins: 0, ...rest });
  const dead = count(seeds, (s) => s.dead);
  if (dead >= need) return done('collapse', [`no objects at the end on ${dead} of ${n} seeds`]);
  const waves = count(seeds, isWaves);
  if (waves >= need) return done('back to waves', [`wave patches on ${waves} of ${n} seeds`]);
  const bodies = count(seeds, isBodies);
  if (bodies < need) return done('mixed / unclear', [`bodies on ${bodies} of ${n} seeds`, ...seeds.map((s) => `seed ${s.seed}: ${s.dead ? 'no objects at the end' : s.label}`)]);
  const withPhage = count(seeds, (s) => isBodies(s) && s.phageAlive);
  const without = count(seeds, (s) => isBodies(s) && !s.phageAlive);
  if (withPhage < need) {
    if (without >= need) return done('phage lost', [`bodies without phage alive on ${without} of ${n} seeds`]);
    return done('mixed / unclear', [`bodies on ${bodies} of ${n} seeds, with phage alive on ${withPhage}`]);
  }
  const eligibleSeeds = seeds.filter((s) => isBodies(s) && s.phageAlive && s.settled);
  const eligible = eligibleSeeds.map((s) => s.seed);
  if (eligibleSeeds.length < need) return done('mixed / unclear', [`bodies with phage alive on ${withPhage} of ${n} seeds, but the reading window is settled on only ${eligibleSeeds.length} of those`], { eligible });
  const division = readDivision(eligibleSeeds.map((s) => s.body), rule.minBirths, need);
  const turnoverWins = count(eligibleSeeds, (s) => s.turnoverWin);
  const d4Wins = count(eligibleSeeds, (s) => s.d4);
  const rest = { eligible, division, turnoverWins, d4Wins };
  if (division.lasting < rule.minBirths) return done('frozen mosaic', [`${division.lasting} lasting births of new bodies in the settled windows of the eligible seeds`], rest);
  if (turnoverWins < need) return done('frozen mosaic', [`pattern turnover above NO_PHAGE on ${turnoverWins} eligible seeds`], rest);
  const failed = [...division.failed];
  if (d4Wins < need) failed.push(`D4 holds on ${d4Wins} eligible seeds`);
  if (failed.length === 0) return done('bodies with turnover', [`bodies with phage alive and a settled window on ${eligibleSeeds.length} of ${n} seeds`, `${division.fission} of ${division.lasting} lasting births by fission, ${division.ends} lasting ends`, `pattern turnover above NO_PHAGE on ${turnoverWins}`, `D4 on ${d4Wins}`], rest);
  return done('mixed / unclear', failed, rest);
}

/** Where a setting stands when the work stops. */
export interface SettingState {
  /** `B2`: the known reference, read at stage 2 whatever its gate, never a candidate. */
  readonly reference: boolean;
  /** Stage 1 result (null: not read yet), and what the NO_PHAGE world read. */
  readonly gate: boolean | null;
  readonly gateNote: string;
  /** Stage 2 result (null: not read). */
  readonly stage2: OutcomeReading | null;
  /** Stage 3 result (null: not read). */
  readonly stage3: OutcomeReading | null;
}

/**
 * Exactly one named outcome per setting, whatever path it took. null: its runs are not finished.
 * A setting that fails the gate, or that advanced and was not run at stage 3, is "mixed / unclear" with the reason.
 */
export function settingOutcome(s: SettingState): { outcome: Outcome; notes: string[] } | null {
  if (s.gate === null) return null;
  if (!s.gate && !s.reference) return { outcome: 'mixed / unclear', notes: [`did not pass the clean-arm gate (${s.gateNote}); no phage world was read`] };
  if (s.stage2 === null) return null;
  if (!s.stage2.advance) return { outcome: s.stage2.outcome as Outcome, notes: s.stage2.notes };
  if (s.reference) return { outcome: 'mixed / unclear', notes: ['the reference met the stage 2 rule for going on, which it cannot do: it is not a candidate'] };
  if (s.stage3 === null) return { outcome: 'mixed / unclear', notes: ['advanced at stage 2; stage 3 was not run to the end for this setting'] };
  return { outcome: s.stage3.outcome as Outcome, notes: s.stage3.notes };
}
