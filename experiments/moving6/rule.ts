/**
 * MOVING6: the pre-stated readings (docs/six-wall-moving-2026-11-22/PLAN.md). Pure functions, so every reading
 * can be unit-tested and recomputed from the segment files.
 *
 * Imported unchanged: the compartment check's window readouts and its B1, B3 and wave tests
 * (experiments/b2check); the earlier screen's "phage alive", pattern turnover, "above NO_PHAGE", five
 * endpoints, two-seed rule and division thresholds (experiments/spot6/rule.ts).
 * New here: the gate's test that a moving object is the same body (in place of "tiles kept"), the validity
 * condition on the ledger, division read from the ledger, the four-seed rule with this line's outcome names,
 * and one named outcome per setting.
 */

import type { TrackerResult } from '../b2check/observe.ts';
import type { WindowReadouts } from '../b2check/readouts.ts';
import { classifyWindow, THRESHOLDS, type WindowLabel } from '../b2check/verdict.ts';
import { type OutcomeReading, type SeedFacts, type SeedRule, T } from '../spot6/rule.ts';
import type { Ledger } from './ledger.ts';

export const M = {
  /** Gate, "same body while it moves": of the objects that kept their id for 1,000 steps, at least this share have an area within this factor of what it was. */
  sizeFactor: 2,
  sizeKeptShare: 0.75,
  /** Validity: births less deaths may differ from the change in the object count by this share of the mean count, and never by less than this many. */
  netShare: 0.1,
  netFloor: 5,
  /** Validity: at most this share of the window's object-steps may lie in chains that never stood 500 steps in a row. */
  flickerMax: 0.1,
  /** Validity: at most this share of fission-born bodies may be unreadable against their parent (applied when there are at least `unreadMin` of them). */
  unreadMax: 0.25,
  unreadMin: 20,
  /** Division: the earlier screen's numbers. */
  divisionMinBirths: T.divisionMinBirths,
  divisionShare: T.divisionShare,
  divisionSecondHalfShare: T.divisionSecondHalfShare,
  divisionEndsShare: T.divisionEndsShare,
  divisionPerSeed: T.divisionPerSeed,
  seedsNeeded: T.seedsNeeded,
} as const;

// ---------------------------------------------------------------------------------------------------------
// The gate: B1, "same body while it moves", B3; and the wave test to stay clear of
// ---------------------------------------------------------------------------------------------------------

export interface SizeKept {
  /** Sampled objects whose id was still present 1,000 steps later. */
  readonly kept: number;
  /** Of those, the ones whose area was then within a factor of `M.sizeFactor` of what it had been. */
  readonly within: number;
  readonly share: number | null;
}

export function sizeKept(tr: TrackerResult): SizeKept {
  const area = new Map<string, number>();
  for (const s of tr.samples) area.set(`${s.uid}@${s.t}`, s.area);
  let kept = 0;
  let within = 0;
  for (const s of tr.samples) {
    const lag = s.lags.find((r) => r.lag === 1000);
    if (!lag || !lag.alive) continue;
    const later = area.get(`${s.uid}@${s.t + 1000}`);
    if (later === undefined) continue;
    kept++;
    if (later <= M.sizeFactor * s.area && s.area <= M.sizeFactor * later) within++;
  }
  return { kept, within, share: kept > 0 ? within / kept : null };
}

export interface MovingReading {
  readonly label: WindowLabel;
  /** SAME: the size test that replaces the compartment check's "tiles kept". */
  readonly checks: Record<'B1' | 'SAME' | 'B3' | 'V1' | 'V2' | 'V3', boolean | null>;
  readonly settled: boolean;
  /** Every bodies test that is not met, with its value and its threshold. */
  readonly failed: string[];
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(0)}%`);

/**
 * The compartment check's reading with one test replaced: *bodies* needs B1 (same id after 1,000 steps), SAME
 * (size kept) and B3 (solid, isolated, moat). The wave test and the 10% settled test are the compartment check's.
 */
export function classifyMoving(r: WindowReadouts, size: SizeKept): MovingReading {
  const base = classifyWindow(r);
  const same = size.share === null ? null : size.share >= M.sizeKeptShare;
  const checks = { B1: base.checks.B1, SAME: same, B3: base.checks.B3, V1: base.checks.V1, V2: base.checks.V2, V3: base.checks.V3 };
  let label: WindowLabel;
  if (r.samples === 0) label = 'no objects';
  else if (checks.B1 && checks.SAME && checks.B3) label = 'bodies';
  else if (checks.V1 && checks.V2 && checks.V3) label = 'wave patches';
  else if (checks.B1 && checks.SAME && checks.B3 === false) label = 'persistent domains, not bounded';
  else label = 'mixed';
  const failed: string[] = [];
  if (checks.B1 !== true) failed.push(`same id after 1,000 steps ${pct(r.surv1000)} (needs ${pct(THRESHOLDS.b1KeptId1000)} or more)`);
  if (checks.SAME !== true) failed.push(`size kept within a factor of ${M.sizeFactor} by ${pct(size.share)} of the ${size.kept} objects that kept their id (needs ${pct(M.sizeKeptShare)} or more)`);
  if (checks.B3 !== true) {
    if (r.solid === null || r.solid < THRESHOLDS.b3Solid) failed.push(`solid ${pct(r.solid)} (needs ${pct(THRESHOLDS.b3Solid)} or more)`);
    if (r.isolated === null || r.isolated < THRESHOLDS.b3Isolated) failed.push(`isolated ${pct(r.isolated)} (needs ${pct(THRESHOLDS.b3Isolated)} or more)`);
    if (r.moatMedian === null || r.moatMedian < THRESHOLDS.b3Moat) failed.push(`moat ${r.moatMedian === null ? 'n/a' : r.moatMedian.toFixed(2)} (needs ${THRESHOLDS.b3Moat.toFixed(2)} or more)`);
  }
  if (!base.settled) failed.push(`window not settled (mean count ${r.countFirstHalf.toFixed(1)} in its first half, ${r.countSecondHalf.toFixed(1)} in its second; needs under ${pct(THRESHOLDS.settledWithin)} apart)`);
  return { label, checks, settled: base.settled, failed };
}

// ---------------------------------------------------------------------------------------------------------
// Validity of a ledger, and division
// ---------------------------------------------------------------------------------------------------------

export interface Validity {
  /** The confirmation's object count at the ledger's two ends, and its mean over the censuses between. */
  readonly countAtStart: number;
  readonly countAtEnd: number;
  readonly countMean: number;
  /** (Change in the object count) less (births less deaths of bodies). */
  readonly net: number;
  readonly netAllowed: number;
  readonly flickerShare: number;
  /** Share of fission-born bodies that could not be read against their parent (null: fewer than `M.unreadMin` of them). */
  readonly unreadShare: number | null;
  readonly ok: boolean;
  readonly failed: string[];
}

/**
 * The ledger of bodies balances by construction (bodies at the end less bodies at the start is births less
 * deaths). What can fail is whether it is a ledger of the *counted objects*: three tests.
 */
export function validityOf(l: Ledger, counts: readonly { t: number; drop: number }[]): Validity {
  const at = (t: number) => counts.find((r) => r.t === t)?.drop;
  const a = at(l.from);
  const b = at(l.to);
  if (a === undefined || b === undefined) throw new Error(`no census at step ${l.from} or ${l.to}`);
  const inside = counts.filter((r) => r.t >= l.from && r.t <= l.to).map((r) => r.drop);
  const countMean = inside.reduce((x, y) => x + y, 0) / inside.length;
  const net = b - a - (l.birthsTotal - l.deathsTotal);
  const netAllowed = Math.max(M.netFloor, M.netShare * countMean);
  const splits = l.births.division + l.births['split not shown apart'];
  const unreadShare = splits >= M.unreadMin ? l.notApart.notRead / splits : null;
  const failed: string[] = [];
  if (Math.abs(net) > netAllowed) failed.push(`births less deaths (${l.birthsTotal - l.deathsTotal}) miss the change in the object count (${b - a}) by ${Math.abs(net)} (allowed ${netAllowed.toFixed(1)})`);
  if (l.flickerShare > M.flickerMax) failed.push(`${pct(l.flickerShare)} of object-steps are in chains that never stood 500 steps (allowed ${pct(M.flickerMax)})`);
  if (unreadShare !== null && unreadShare > M.unreadMax) failed.push(`${pct(unreadShare)} of fission-born bodies could not be read against their parent (allowed ${pct(M.unreadMax)})`);
  return { countAtStart: a, countAtEnd: b, countMean, net, netAllowed, flickerShare: l.flickerShare, unreadShare, ok: failed.length === 0, failed };
}

/** New bodies the division rule counts in one ledger: divisions and bodies from nothing. */
export const newBodiesOf = (l: Ledger): number => l.births.division + l.births['from nothing'];

export interface DivisionReading {
  /** Ledgers pooled. */
  readonly windows: number;
  /** New bodies the rule counts (by division, and from nothing), and how many of them by division. */
  readonly newBodies: number;
  readonly division: number;
  readonly secondHalf: number;
  /** Births set aside: splits not shown apart from the parent, bodies made by a relabelling, and further pieces of a body that returned. */
  readonly notApart: number;
  readonly relabel: number;
  readonly returnedPiece: number;
  /** Every body birth and every body death, all kinds. */
  readonly births: number;
  readonly deaths: number;
  /** Ledgers with at least five new bodies. */
  readonly contributing: number;
  readonly share: number | null;
  readonly secondHalfShare: number | null;
  readonly label: 'division holds' | 'division does not hold' | 'division not observed';
  readonly failed: string[];
}

/**
 * Division over ledgers pooled: the settled windows of a setting's eligible seeds whose ledger is valid (then
 * `need` is the number that must each contribute), or any one window (described; decides nothing).
 * The earlier screen's thresholds, on this line's births and deaths.
 */
export function readDivision(ledgers: readonly Ledger[], minBirths: number = M.divisionMinBirths, need = 0): DivisionReading {
  let division = 0;
  let nothing = 0;
  let secondHalf = 0;
  let notApart = 0;
  let relabel = 0;
  let returnedPiece = 0;
  let births = 0;
  let deaths = 0;
  let contributing = 0;
  for (const l of ledgers) {
    division += l.births.division;
    nothing += l.births['from nothing'];
    secondHalf += l.newSecondHalf.division + l.newSecondHalf.nothing;
    notApart += l.births['split not shown apart'];
    relabel += l.births.relabel;
    returnedPiece += l.births['returned piece'];
    births += l.birthsTotal;
    deaths += l.deathsTotal;
    if (newBodiesOf(l) >= M.divisionPerSeed) contributing++;
  }
  const newBodies = division + nothing;
  const share = newBodies > 0 ? division / newBodies : null;
  const secondHalfShare = newBodies > 0 ? secondHalf / newBodies : null;
  const failed: string[] = [];
  if (newBodies < minBirths) failed.push(`fewer than ${minBirths} new bodies (${newBodies})`);
  else {
    if ((share as number) < M.divisionShare) failed.push(`under ${100 * M.divisionShare}% of new bodies are by division (${division} of ${newBodies}, ${pct(share)})`);
    if ((secondHalfShare as number) < M.divisionSecondHalfShare) failed.push(`under ${100 * M.divisionSecondHalfShare}% of new bodies fall in the second half of the window (${secondHalf} of ${newBodies}, ${pct(secondHalfShare)})`);
    if (deaths < M.divisionEndsShare * births) failed.push(`body deaths are under ${100 * M.divisionEndsShare}% of body births (${deaths} against ${births}): the dish is still filling`);
    if (contributing < need) failed.push(`${contributing} seeds have at least ${M.divisionPerSeed} new bodies each (${need} needed)`);
  }
  const label = newBodies < minBirths ? 'division not observed' : failed.length === 0 ? 'division holds' : 'division does not hold';
  return { windows: ledgers.length, newBodies, division, secondHalf, notApart, relabel, returnedPiece, births, deaths, contributing, share, secondHalfShare, label, failed };
}

// ---------------------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------------------

export type Outcome =
  | 'back to waves'
  | 'collapse'
  | 'phage lost'
  | 'moving bodies, no division'
  | 'division without pattern turnover'
  | 'bodies with turnover'
  | 'mixed / unclear';

/** One seed of the four-seed stage: its PHAGE reading, its settled window's ledger, and its two comparisons. */
export interface MovingSeed extends SeedFacts {
  /** Bodies tests not met in its reading window, with values (empty if it reads bodies in a settled window). */
  readonly failed: string[];
  /** Its phage reading in words, with the means and the bar. */
  readonly phageNote: string;
  readonly ledger: Ledger;
  readonly validity: Validity;
  /** Pattern turnover above NO_PHAGE on this seed (the earlier `turnoverAbove`). */
  readonly turnoverWin: boolean;
  /** D4 holds on this seed. */
  readonly d4: boolean;
}

export interface Stage3Reading {
  readonly outcome: Outcome;
  /** For "mixed / unclear": every failed test with its value and threshold. For other outcomes: what decided it. */
  readonly notes: string[];
  /** Seeds with objects at the end, bodies, phage alive and a settled window. */
  readonly eligible: number[];
  /** Eligible seeds whose ledger is valid: the ones division is read on. */
  readonly readable: number[];
  readonly division: DivisionReading | null;
  readonly turnoverWins: number;
  readonly d4Wins: number;
}

/** The four-seed stage of this screen: seeds 1 to 4, 3 of 4. */
export const STAGE3_RULE: SeedRule = { n: 4, need: M.seedsNeeded, minBirths: M.divisionMinBirths };
/** The rule a later confirmation on unseen seeds 33 to 40 would use (PLAN.md): 7 of 8, twice the new bodies. */
export const CONFIRM_RULE: SeedRule = { n: 8, need: 7, minBirths: 2 * M.divisionMinBirths };

const count = <X>(xs: readonly X[], f: (x: X) => boolean) => xs.filter(f).length;
const isBodies = (s: SeedFacts) => !s.dead && s.label === 'bodies';
const isWaves = (s: SeedFacts) => !s.dead && s.label === 'wave patches';

/** Per seed, what it failed, with values: for a "mixed / unclear" outcome. */
function seedNotes(seeds: readonly MovingSeed[]): string[] {
  return seeds.map((s) => {
    const bad: string[] = [];
    if (s.dead) bad.push('no objects at the end');
    else if (s.label !== 'bodies' || !s.settled) bad.push(`reads ${s.label}: ${s.failed.join('; ')}`);
    if (!s.phageAlive) bad.push(`phage ${s.phageNote}`);
    return `seed ${s.seed}: ${bad.length ? bad.join('; ') : 'bodies with phage alive in a settled window'}`;
  });
}

/**
 * The four-seed stage. First match applies. Division, pattern turnover and D4 are read only on eligible seeds
 * (alive, bodies, phage alive, settled window), and division only on those of them whose ledger is valid.
 */
export function stage3Outcome(seeds: readonly MovingSeed[], rule: SeedRule = STAGE3_RULE): Stage3Reading {
  const { n, need } = rule;
  if (seeds.length !== n) throw new Error(`the four-seed stage is read on exactly ${n} seeds`);
  const done = (outcome: Outcome, notes: string[], rest: Partial<Stage3Reading> = {}): Stage3Reading => ({ outcome, notes, eligible: [], readable: [], division: null, turnoverWins: 0, d4Wins: 0, ...rest });
  const dead = count(seeds, (s) => s.dead);
  if (dead >= need) return done('collapse', [`no objects at the end on ${dead} of ${n} seeds`]);
  const waves = count(seeds, isWaves);
  if (waves >= need) return done('back to waves', [`wave patches on ${waves} of ${n} seeds`]);
  const bodies = count(seeds, isBodies);
  if (bodies < need) return done('mixed / unclear', [`bodies on ${bodies} of ${n} seeds`, ...seedNotes(seeds)]);
  const withPhage = count(seeds, (s) => isBodies(s) && s.phageAlive);
  const without = count(seeds, (s) => isBodies(s) && !s.phageAlive);
  if (withPhage < need) {
    if (without >= need) return done('phage lost', [`bodies without phage alive on ${without} of ${n} seeds`]);
    return done('mixed / unclear', [`bodies on ${bodies} of ${n} seeds, with phage alive on ${withPhage}`, ...seedNotes(seeds)]);
  }
  const eligibleSeeds = seeds.filter((s) => isBodies(s) && s.phageAlive && s.settled);
  const eligible = eligibleSeeds.map((s) => s.seed);
  if (eligibleSeeds.length < need) return done('mixed / unclear', [`bodies with phage alive on ${withPhage} of ${n} seeds, but the reading window is settled on only ${eligibleSeeds.length} of those`, ...seedNotes(seeds)], { eligible });
  const turnoverWins = count(eligibleSeeds, (s) => s.turnoverWin);
  const d4Wins = count(eligibleSeeds, (s) => s.d4);
  // What the two comparisons fall short by: decides between the last two outcomes, and is named in every
  // outcome from here on.
  const short: string[] = [];
  if (turnoverWins < need) short.push(`pattern turnover above NO_PHAGE on ${turnoverWins} of ${eligibleSeeds.length} eligible seeds (${need} needed)`);
  if (d4Wins < need) short.push(`D4 on ${d4Wins} of ${eligibleSeeds.length} eligible seeds (${need} needed)`);
  // The failed tests of every seed that is not eligible: notes only, on every outcome from here on. They decide nothing.
  const left = seedNotes(seeds.filter((s) => !eligibleSeeds.includes(s))).map((note) => `not eligible, ${note}`);
  const readableSeeds = eligibleSeeds.filter((s) => s.validity.ok);
  const readable = readableSeeds.map((s) => s.seed);
  if (readableSeeds.length < need) {
    const why = eligibleSeeds.filter((s) => !s.validity.ok).map((s) => `seed ${s.seed}: ${s.validity.failed.join('; ')}`);
    return done('mixed / unclear', [`division not readable: the ledger is valid on ${readableSeeds.length} of ${eligibleSeeds.length} eligible seeds (${need} needed)`, ...why, ...short, ...left], { eligible, readable, turnoverWins, d4Wins });
  }
  const division = readDivision(readableSeeds.map((s) => s.ledger), rule.minBirths, need);
  const rest = { eligible, readable, division, turnoverWins, d4Wins };
  if (division.newBodies < rule.minBirths) return done('moving bodies, no division', [`${division.newBodies} new bodies in the settled windows of the readable seeds (${rule.minBirths} needed)`, ...short, ...left], rest);
  if (division.failed.length > 0) return done('mixed / unclear', [`division does not hold: ${division.failed.join('; ')}`, ...short, ...left], rest);
  const summary = `${division.division} of ${division.newBodies} new bodies by division on ${readableSeeds.length} seeds, ${division.deaths} body deaths against ${division.births} body births`;
  if (short.length > 0) return done('division without pattern turnover', [summary, ...short, ...left], rest);
  return done('bodies with turnover', [summary, `pattern turnover above NO_PHAGE on ${turnoverWins}`, `D4 on ${d4Wins}`, ...left], rest);
}

/** Where a setting stands when the work stops. */
export interface SettingState {
  /** The gate on the no-phage world, seeds 1 and 2 (null: not read yet), and what it read. */
  readonly gate: boolean | null;
  readonly gateNote: string;
  /** The two-seed stage (null: not read). The earlier screen's `stage2Outcome`, on this line's readings. */
  readonly stage2: OutcomeReading | null;
  /** The four-seed stage (null: not read). */
  readonly stage3: Stage3Reading | null;
  /** The work has stopped and a stage this setting was due was not run: why (the plan's rank, the budget, a stop rule). */
  readonly notRunWhy?: string;
}

/** Exactly one named outcome per setting, whatever path it took. null: its runs are not finished and no reason for stopping is given. */
export function settingOutcome(s: SettingState): { outcome: Outcome; notes: string[] } | null {
  if (s.gate === null) return s.notRunWhy ? { outcome: 'mixed / unclear', notes: [`not run: ${s.notRunWhy}`] } : null;
  if (!s.gate) return { outcome: 'mixed / unclear', notes: [`did not pass the gate on the no-phage world (${s.gateNote}); no phage world was read`] };
  if (s.stage2 === null) return s.notRunWhy ? { outcome: 'mixed / unclear', notes: [`passed the gate on the no-phage world; the two-seed stage was not run (${s.notRunWhy})`] } : null;
  if (!s.stage2.advance) return { outcome: s.stage2.outcome as Outcome, notes: s.stage2.notes };
  if (s.stage3 === null) return { outcome: 'mixed / unclear', notes: [`sent on by the two-seed stage; the four-seed stage was not run to the end for this setting${s.notRunWhy ? ` (${s.notRunWhy})` : ''}`] };
  return { outcome: s.stage3.outcome, notes: s.stage3.notes };
}

/**
 * Which neighbour joins the primary at the four-seed stage, if any: among those the two-seed stage sent on, the
 * one with most divisions in its two PHAGE reading windows; a tie goes to `MIX37`.
 */
export function neighbourRank(sentOn: readonly { name: string; divisions: number }[]): string | null {
  let best: { name: string; divisions: number } | null = null;
  for (const x of sentOn) {
    if (best === null || x.divisions > best.divisions || (x.divisions === best.divisions && x.name === 'MIX37')) best = x;
  }
  return best ? best.name : null;
}
