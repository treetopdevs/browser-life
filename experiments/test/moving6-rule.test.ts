import { describe, expect, it } from 'vitest';
import type { Sample, TrackerResult } from '../b2check/observe.ts';
import type { WindowReadouts } from '../b2check/readouts.ts';
import { stage2Outcome, type SeedFacts } from '../spot6/rule.ts';
import { buildSpec as spot6Spec, mixRates } from '../spot6/settings.ts';
import type { Ledger } from '../moving6/ledger.ts';
import {
  classifyMoving,
  CONFIRM_RULE,
  M,
  type MovingSeed,
  neighbourRank,
  readDivision,
  settingOutcome,
  sizeKept,
  type SizeKept,
  stage3Outcome,
  type Validity,
  validityOf,
} from '../moving6/rule.ts';
import { ALLOWED_SEEDS as SPOT6_SEEDS } from '../spot6/settings.ts';
import { ALLOWED_SEEDS, baseSettingOf, buildSpec, NEIGHBOURS, PRIMARY, settingOf, SETTINGS, UNSEEN_SEEDS } from '../moving6/settings.ts';

describe('moving6 settings', () => {
  it('lists MIX25 and its two neighbours on the earlier line, and nothing else', () => {
    expect(SETTINGS.map((s) => s.name)).toEqual(['MIX25', 'MIX12', 'MIX37']);
    expect(PRIMARY).toBe('MIX25');
    expect(NEIGHBOURS).toEqual(['MIX12', 'MIX37']);
    expect(settingOf('MIX12').rates).toEqual(mixRates(0.125));
    expect(settingOf('MIX37').rates).toEqual(mixRates(0.375));
    expect(settingOf('MIX25').rates).toEqual({ kDeg: 0.06625, diffW: 0.03375, diffF: 0.225 });
  });

  it('builds MIX25 and its phage variants exactly as the earlier screen did, key for key', () => {
    for (const name of ['MIX25', 'PH_LONG@MIX25', 'PH_MILD@MIX25']) {
      for (const arm of ['PHAGE', 'NO_PHAGE', 'NEUTRAL_PHAGE', 'SINGLE_WALL']) {
        const mine = buildSpec(name, arm, 2);
        const theirs = spot6Spec(name, arm, 2);
        expect(JSON.stringify(mine.cfg)).toBe(JSON.stringify(theirs.cfg));
        expect(mine.single).toBe(theirs.single);
        expect(mine.size).toBe(128);
      }
    }
  });

  it('changes only the three rates at a neighbour, and only the named phage rate at a variant', () => {
    const base = buildSpec('MIX25', 'PHAGE', 1).cfg as unknown as Record<string, unknown>;
    const diff = (name: string) => {
      const cfg = buildSpec(name, 'PHAGE', 1).cfg as unknown as Record<string, unknown>;
      return Object.keys(base).filter((k) => base[k] !== cfg[k]).sort();
    };
    expect(diff('MIX12')).toEqual(['diffF', 'diffW', 'kDeg']);
    expect(diff('MIX37')).toEqual(['diffF', 'diffW', 'kDeg']);
    expect(diff('PH_LONG@MIX25')).toEqual(['kDecayP']);
    expect(diff('PH_MILD@MIX25')).toEqual(['kInfect']);
    expect(buildSpec('PH_LONG@MIX25', 'PHAGE', 1).cfg.kDecayP).toBe(0.002);
    expect(buildSpec('PH_MILD@MIX25', 'PHAGE', 1).cfg.kInfect).toBe(0.17);
    expect(baseSettingOf('PH_LONG@MIX25')).toBe('MIX25');
  });

  it('refuses every seed outside 1 to 4 and every setting outside its list', () => {
    expect(ALLOWED_SEEDS).toEqual([1, 2, 3, 4]);
    expect(ALLOWED_SEEDS).toEqual(SPOT6_SEEDS);
    for (const seed of [0, 5, 12, 16, ...UNSEEN_SEEDS]) expect(() => buildSpec('MIX25', 'PHAGE', seed)).toThrow(/not allowed/);
    for (const seed of ALLOWED_SEEDS) expect(() => buildSpec('MIX25', 'PHAGE', seed)).not.toThrow();
    for (const name of ['B2', 'MIX50', 'MIX75', 'SPOT', 'DIFF_ONLY', 'MIX30', 'PH_LONG@MIX12', 'PH_LONG@MIX37', 'PH_MILD@MIX50', 'PH_FAST@MIX25']) expect(() => buildSpec(name, 'PHAGE', 1)).toThrow(/unknown/);
    expect(() => buildSpec('MIX25', 'NOPE', 1)).toThrow(/unknown arm/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------------------

function readouts(over: Partial<WindowReadouts>): WindowReadouts {
  const base = { samples: 100, surv1000: 0.55, keepUid1000: 0.35, keepMask1000: 0.6, chance1000: 0.03, solid: 0.97, isolated: 0.6, moatMedian: 0.66, countFirstHalf: 155, countSecondHalf: 156 };
  return { ...base, ...over } as unknown as WindowReadouts;
}
const size = (share: number | null, kept = 100): SizeKept => ({ kept, within: share === null ? 0 : Math.round(share * kept), share });

function sample(uid: number, t: number, area: number, alive: boolean): Sample {
  return { t, uid, area, lags: [{ lag: 1000, alive, disp: alive ? 1 : null, keepUid: 0, keepMask: 0, chance: 0 }] } as unknown as Sample;
}

describe('moving6 gate', () => {
  it('counts, of the objects that kept their id for 1,000 steps, those whose area stayed within a factor of 2', () => {
    const samples = [
      sample(1, 0, 10, true), sample(1, 1000, 19, false), // kept, 1.9 times: within
      sample(2, 0, 10, true), sample(2, 1000, 21, false), // kept, 2.1 times: not within
      sample(3, 0, 20, true), sample(3, 1000, 10, false), // kept, half: within
      sample(4, 0, 20, true), sample(4, 1000, 9, false), // kept, under half: not within
      sample(5, 0, 10, false), // id gone: not counted
    ];
    expect(sizeKept({ samples } as unknown as TrackerResult)).toEqual({ kept: 4, within: 2, share: 0.5 });
    expect(sizeKept({ samples: [sample(5, 0, 10, false)] } as unknown as TrackerResult)).toEqual({ kept: 0, within: 0, share: null });
  });

  it('reads moving bodies as bodies although their tiles are not kept', () => {
    const r = classifyMoving(readouts({}), size(0.86));
    expect(r.label).toBe('bodies');
    expect(r.checks).toMatchObject({ B1: true, SAME: true, B3: true });
    expect(r.failed).toEqual([]);
    expect(r.settled).toBe(true);
  });

  it('fails on each of its three tests, and names the value and the threshold', () => {
    const b1 = classifyMoving(readouts({ surv1000: 0.46 }), size(0.86));
    expect(b1.label).toBe('mixed');
    expect(b1.failed).toEqual(['same id after 1,000 steps 46% (needs 50% or more)']);
    const same = classifyMoving(readouts({}), size(0.6, 80));
    expect(same.label).toBe('mixed');
    expect(same.failed).toEqual(['size kept within a factor of 2 by 60% of the 80 objects that kept their id (needs 75% or more)']);
    const b3 = classifyMoving(readouts({ isolated: 0.45, moatMedian: 0.4 }), size(0.86));
    expect(b3.label).toBe('persistent domains, not bounded');
    expect(b3.failed).toEqual(['isolated 45% (needs 50% or more)', 'moat 0.40 (needs 0.50 or more)']);
    const unsettled = classifyMoving(readouts({ countFirstHalf: 100, countSecondHalf: 150 }), size(0.86));
    expect(unsettled.label).toBe('bodies');
    expect(unsettled.settled).toBe(false);
    expect(unsettled.failed[0]).toMatch(/not settled/);
  });

  it('keeps the wave test: ids lost, tiles at chance, nothing isolated', () => {
    const waves = classifyMoving(readouts({ surv1000: 0.03, keepMask1000: 0.08, chance1000: 0.03, isolated: 0.05, moatMedian: 0.24 }), size(0.44));
    expect(waves.label).toBe('wave patches');
    // No object kept its id: the size test cannot be read, and B1 has failed anyway.
    const none = classifyMoving(readouts({ surv1000: 0, keepMask1000: 0.2, chance1000: 0.04, isolated: 0, moatMedian: 0.09 }), size(null, 0));
    expect(none.checks.SAME).toBeNull();
    expect(none.label).toBe('mixed');
    expect(classifyMoving(readouts({ samples: 0 }), size(null, 0)).label).toBe('no objects');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Validity and division
// ---------------------------------------------------------------------------------------------------------

function ledgerOfCounts(o: { division?: number; notApart?: number; relabel?: number; piece?: number; nothing?: number; fade?: number; fusion?: number; second?: number; notRead?: number; flicker?: number }): Ledger {
  const births = { division: o.division ?? 0, 'split not shown apart': o.notApart ?? 0, relabel: o.relabel ?? 0, 'returned piece': o.piece ?? 0, 'from nothing': o.nothing ?? 0 };
  const total = births.division + births['split not shown apart'] + births.relabel + births['returned piece'] + births['from nothing'];
  const deaths = { fade: o.fade ?? 0, fusion: o.fusion ?? 0, 'relabelled away': 0 };
  const newBodies = births.division + births['from nothing'];
  const second = o.second ?? Math.floor(newBodies / 2);
  const secondDivision = Math.min(second, births.division);
  return {
    from: 500,
    to: 19500,
    bodiesAtStart: 150,
    bodiesAtEnd: 150 + total - deaths.fade - deaths.fusion,
    births,
    deaths,
    birthsTotal: total,
    deathsTotal: deaths.fade + deaths.fusion,
    newFirstHalf: { division: births.division - secondDivision, nothing: births['from nothing'] - (second - secondDivision) },
    newSecondHalf: { division: secondDivision, nothing: second - secondDivision },
    notApart: { samePatch: births['split not shown apart'] - (o.notRead ?? 0), notRead: o.notRead ?? 0 },
    continuations: { relabelled: 0, parted: 0, returned: 0, 'handed on': 0 },
    fates: {},
    flickerChains: 0,
    flickerShare: o.flicker ?? 0.04,
    bodyKiloSteps: 2850,
    newBodies: [],
  };
}
const counts = (a: number, b: number) => Array.from({ length: 39 }, (_, k) => ({ t: 500 + 500 * k, drop: k === 0 ? a : k === 38 ? b : 150 }));

describe('moving6 validity', () => {
  it('passes when births less deaths follow the object count', () => {
    const l = ledgerOfCounts({ division: 50, notApart: 130, relabel: 240, nothing: 17, fade: 290, fusion: 163, notRead: 16 });
    const v = validityOf(l, counts(161, 142));
    expect(v).toMatchObject({ countAtStart: 161, countAtEnd: 142, net: -3, ok: true, failed: [] });
    expect(v.netAllowed).toBeCloseTo(15, 0);
    expect(v.unreadShare).toBeCloseTo(16 / 180, 6);
  });

  it('fails when births are set aside whose deaths still count (the earlier rule\'s fault)', () => {
    // 5 births against 290 deaths in a window whose count went from 161 to 142.
    const v = validityOf(ledgerOfCounts({ division: 5, fade: 290 }), counts(161, 142));
    expect(v.ok).toBe(false);
    expect(v.net).toBe(266);
    expect(v.failed[0]).toMatch(/miss the change in the object count \(-19\) by 266/);
  });

  it('fails when most objects are flicker, or most splits cannot be read', () => {
    expect(validityOf(ledgerOfCounts({ flicker: 0.5 }), counts(150, 150)).failed[0]).toMatch(/50% of object-steps/);
    expect(validityOf(ledgerOfCounts({ flicker: 0.1 }), counts(150, 150)).ok).toBe(true);
    const unread = validityOf(ledgerOfCounts({ division: 10, notApart: 30, notRead: 12, fade: 40 }), counts(150, 150));
    expect(unread.ok).toBe(false);
    expect(unread.failed[0]).toMatch(/30% of fission-born bodies/);
    // Too few splits for the share to mean anything: not applied.
    expect(validityOf(ledgerOfCounts({ division: 2, notApart: 10, notRead: 9, fade: 12 }), counts(150, 150))).toMatchObject({ unreadShare: null, ok: true });
  });

  it('allows a miss of five where the dish holds few objects', () => {
    const few = Array.from({ length: 39 }, (_, k) => ({ t: 500 + 500 * k, drop: 20 }));
    expect(validityOf(ledgerOfCounts({ nothing: 5 }), few).ok).toBe(true);
    expect(validityOf(ledgerOfCounts({ nothing: 6 }), few).ok).toBe(false);
    expect(M.netFloor).toBe(5);
  });

  it('refuses a ledger whose ends are not censuses', () => {
    expect(() => validityOf(ledgerOfCounts({}), [{ t: 500, drop: 1 }])).toThrow(/no census/);
  });
});

describe('moving6 division', () => {
  it('counts divisions and bodies from nothing, and sets relabellings and unshown splits aside', () => {
    const d = readDivision([ledgerOfCounts({ division: 49, notApart: 131, relabel: 239, nothing: 17, fade: 290, fusion: 163 })]);
    expect(d).toMatchObject({ newBodies: 66, division: 49, notApart: 131, relabel: 239, births: 436, deaths: 453, label: 'division does not hold' });
    expect(d.failed).toEqual(['under 80% of new bodies are by division (49 of 66, 74%)']);
  });

  it('sets returned pieces aside too: they are births in the ledger, not new bodies', () => {
    const d = readDivision([ledgerOfCounts({ division: 49, notApart: 131, relabel: 239, piece: 13, nothing: 4, fade: 290, fusion: 163 })]);
    expect(d).toMatchObject({ newBodies: 53, division: 49, returnedPiece: 13, births: 436, label: 'division holds' });
  });

  it('holds with the earlier thresholds, and fails on each of them', () => {
    const good = () => ledgerOfCounts({ division: 9, nothing: 1, relabel: 60, fade: 70 });
    expect(readDivision([good(), good(), good()], 20, 3).label).toBe('division holds');
    expect(readDivision([good()], 20, 0).label).toBe('division not observed');
    expect(readDivision([good(), good()], 20, 3).failed).toEqual(['2 seeds have at least 5 new bodies each (3 needed)']);
    const late = ledgerOfCounts({ division: 30, fade: 30, second: 5 });
    expect(readDivision([late]).failed).toEqual(['under 25% of new bodies fall in the second half of the window (5 of 30, 17%)']);
    const filling = ledgerOfCounts({ division: 30, relabel: 10, fade: 19 });
    expect(readDivision([filling]).failed[0]).toMatch(/body deaths are under 50% of body births \(19 against 40\)/);
    const nothing = ledgerOfCounts({ nothing: 82, fade: 87 });
    expect(readDivision([nothing])).toMatchObject({ label: 'division does not hold', share: 0 });
    expect(readDivision([ledgerOfCounts({})])).toMatchObject({ label: 'division not observed', newBodies: 0, share: null });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------------------

const VALID: Validity = { countAtStart: 150, countAtEnd: 150, countMean: 150, net: 0, netAllowed: 15, flickerShare: 0.04, unreadShare: 0.08, ok: true, failed: [] };
function seed(n: number, over: Partial<MovingSeed> = {}): MovingSeed {
  return { seed: n, dead: false, label: 'bodies', settled: true, phageAlive: true, failed: [], phageNote: 'not alive (above zero at the end): 120 / 90 / 80 (bar 410)', ledger: ledgerOfCounts({ division: 9, nothing: 1, relabel: 60, fade: 70 }), validity: VALID, turnoverWin: true, d4: true, ...over };
}
const four = (over: Partial<MovingSeed> = {}, n = 4) => [1, 2, 3, 4].map((s) => seed(s, s <= n ? over : {}));

describe('moving6 four-seed rule', () => {
  it('reads each named outcome', () => {
    expect(stage3Outcome(four()).outcome).toBe('bodies with turnover');
    expect(stage3Outcome(four({ dead: true }, 3)).outcome).toBe('collapse');
    expect(stage3Outcome(four({ label: 'wave patches' }, 3)).outcome).toBe('back to waves');
    expect(stage3Outcome(four({ phageAlive: false }, 3)).outcome).toBe('phage lost');
    expect(stage3Outcome(four({ ledger: ledgerOfCounts({ division: 3, relabel: 60, fade: 63 }) })).outcome).toBe('moving bodies, no division');
    expect(stage3Outcome(four({ turnoverWin: false }, 2)).outcome).toBe('division without pattern turnover');
    expect(stage3Outcome(four({ d4: false }, 2)).outcome).toBe('division without pattern turnover');
  });

  it('a seed that is dead counts as dead whatever its window read', () => {
    const r = stage3Outcome(four({ dead: true, label: 'bodies' }, 3));
    expect(r.outcome).toBe('collapse');
  });

  it('names every failed test with its value when bodies fall short', () => {
    const r = stage3Outcome(four({ label: 'mixed', failed: ['same id after 1,000 steps 47% (needs 50% or more)'] }, 2));
    expect(r.outcome).toBe('mixed / unclear');
    expect(r.notes[0]).toBe('bodies on 2 of 4 seeds');
    expect(r.notes[1]).toBe('seed 1: reads mixed: same id after 1,000 steps 47% (needs 50% or more)');
    expect(r.notes[3]).toBe('seed 3: bodies with phage alive in a settled window');
  });

  it('is unclear when bodies have phage on too few seeds and lack it on too few', () => {
    const seeds = [seed(1), seed(2), seed(3, { phageAlive: false }), seed(4, { phageAlive: false })];
    const r = stage3Outcome(seeds);
    expect(r.outcome).toBe('mixed / unclear');
    expect(r.notes[0]).toBe('bodies on 4 of 4 seeds, with phage alive on 2');
    expect(r.notes[3]).toBe('seed 3: phage not alive (above zero at the end): 120 / 90 / 80 (bar 410)');
  });

  it('does not read division where windows are unsettled or ledgers are not valid', () => {
    const unsettled = stage3Outcome(four({ settled: false, failed: ['window not settled'] }, 2));
    expect(unsettled.outcome).toBe('mixed / unclear');
    expect(unsettled.eligible).toEqual([3, 4]);
    const bad: Validity = { ...VALID, ok: false, failed: ['births less deaths (-250) miss the change in the object count (3) by 253 (allowed 15.0)'] };
    const unreadable = stage3Outcome(four({ validity: bad }, 2));
    expect(unreadable.outcome).toBe('mixed / unclear');
    expect(unreadable.notes[0]).toBe('division not readable: the ledger is valid on 2 of 4 eligible seeds (3 needed)');
    expect(unreadable.notes[1]).toMatch(/^seed 1: births less deaths/);
    expect(unreadable.division).toBeNull();
    // One unreadable seed leaves three: division is read on those three only.
    const three = stage3Outcome(four({ validity: bad }, 1));
    expect(three.readable).toEqual([2, 3, 4]);
    expect(three.division?.windows).toBe(3);
    expect(three.outcome).toBe('bodies with turnover');
    // A seed that is not eligible keeps its failed tests in the notes of whatever outcome is read.
    const mixedSeed = seed(1, { label: 'mixed', failed: ['same id after 1,000 steps 47% (needs 50% or more)'], phageAlive: false });
    const withLoser = stage3Outcome([mixedSeed, seed(2, { turnoverWin: false }), seed(3, { turnoverWin: false }), seed(4, { turnoverWin: false })]);
    expect(withLoser.outcome).toBe('division without pattern turnover');
    // Those notes decide nothing: three eligible seeds that pass everything still read bodies with turnover, 3 of 4 and 7 of 8.
    const stillPasses = stage3Outcome([mixedSeed, seed(2), seed(3), seed(4)]);
    expect(stillPasses.outcome).toBe('bodies with turnover');
    expect(stillPasses.notes[stillPasses.notes.length - 1]).toMatch(/^not eligible, seed 1: reads mixed/);
    const eightSeeds = [33, 34, 35, 36, 37, 38, 39, 40].map((n, k) => (k === 0 ? { ...mixedSeed, seed: n } : seed(n)));
    expect(stage3Outcome(eightSeeds, CONFIRM_RULE).outcome).toBe('bodies with turnover');
    expect(withLoser.notes).toContain('not eligible, seed 1: reads mixed: same id after 1,000 steps 47% (needs 50% or more); phage not alive (above zero at the end): 120 / 90 / 80 (bar 410)');
  });

  it('is unclear, with the failed criteria, when new bodies are there but division does not hold', () => {
    const r = stage3Outcome(four({ ledger: ledgerOfCounts({ division: 49, notApart: 131, relabel: 239, nothing: 17, fade: 290, fusion: 163 }) }));
    expect(r.outcome).toBe('mixed / unclear');
    expect(r.notes).toEqual(['division does not hold: under 80% of new bodies are by division (196 of 264, 74%)']);
    // What else is short is named too.
    const also = stage3Outcome(four({ ledger: ledgerOfCounts({ division: 49, notApart: 131, relabel: 239, nothing: 17, fade: 290, fusion: 163 }), turnoverWin: false, d4: false }));
    expect(also.notes.slice(1)).toEqual(['pattern turnover above NO_PHAGE on 0 of 4 eligible seeds (3 needed)', 'D4 on 0 of 4 eligible seeds (3 needed)']);
    expect(r.division?.newBodies).toBe(264);
  });

  it('reads division only on eligible seeds: a wave seed cannot supply it', () => {
    const rich = ledgerOfCounts({ division: 40, fade: 40 });
    const poor = ledgerOfCounts({ division: 1, fade: 1 });
    const seeds = [seed(1, { label: 'wave patches', ledger: rich }), seed(2, { ledger: poor }), seed(3, { ledger: poor }), seed(4, { ledger: poor })];
    const r = stage3Outcome(seeds);
    expect(r.outcome).toBe('moving bodies, no division');
    expect(r.eligible).toEqual([2, 3, 4]);
    expect(r.division?.newBodies).toBe(3);
  });

  it('has a stricter rule for a later confirmation: 7 of 8 and twice the new bodies', () => {
    expect(CONFIRM_RULE).toEqual({ n: 8, need: 7, minBirths: 40 });
    const eight = (over: Partial<MovingSeed> = {}, n = 8) => [33, 34, 35, 36, 37, 38, 39, 40].map((s, k) => seed(s, k < n ? over : {}));
    expect(stage3Outcome(eight(), CONFIRM_RULE).outcome).toBe('bodies with turnover');
    expect(stage3Outcome(eight({ turnoverWin: false }, 2), CONFIRM_RULE).outcome).toBe('division without pattern turnover');
    expect(stage3Outcome(eight({ label: 'mixed' }, 2), CONFIRM_RULE).outcome).toBe('mixed / unclear');
    expect(() => stage3Outcome(four(), CONFIRM_RULE)).toThrow(/exactly 8 seeds/);
  });
});

describe('moving6 setting outcome', () => {
  const facts = (over: Partial<SeedFacts> = {}): SeedFacts[] => [1, 2].map((s) => ({ seed: s, dead: false, label: 'bodies', settled: true, phageAlive: true, ...over }));

  it('gives one named outcome per path', () => {
    expect(settingOutcome({ gate: null, gateNote: '', stage2: null, stage3: null })).toBeNull();
    // Work stopped before the setting was run, or after its gate: still a named outcome, with the reason.
    expect(settingOutcome({ gate: null, gateNote: '', stage2: null, stage3: null, notRunWhy: 'the budget did not allow it' })).toEqual({ outcome: 'mixed / unclear', notes: ['not run: the budget did not allow it'] });
    expect(settingOutcome({ gate: true, gateNote: '', stage2: null, stage3: null, notRunWhy: 'the budget did not allow it' })?.notes[0]).toMatch(/passed the gate.*two-seed stage was not run \(the budget/);
    const failed = settingOutcome({ gate: false, gateNote: 'seed 1: mixed [same id after 1,000 steps 31% (needs 50% or more)]', stage2: null, stage3: null });
    expect(failed?.outcome).toBe('mixed / unclear');
    expect(failed?.notes[0]).toMatch(/did not pass the gate.*31%/);
    expect(settingOutcome({ gate: true, gateNote: '', stage2: null, stage3: null })).toBeNull();
    expect(settingOutcome({ gate: true, gateNote: '', stage2: stage2Outcome(facts({ dead: true })), stage3: null })?.outcome).toBe('collapse');
    expect(settingOutcome({ gate: true, gateNote: '', stage2: stage2Outcome(facts({ label: 'wave patches' })), stage3: null })?.outcome).toBe('back to waves');
    expect(settingOutcome({ gate: true, gateNote: '', stage2: stage2Outcome(facts({ phageAlive: false })), stage3: null })?.outcome).toBe('phage lost');
    const sentOn = stage2Outcome(facts());
    expect(sentOn.advance).toBe(true);
    const notRun = settingOutcome({ gate: true, gateNote: '', stage2: sentOn, stage3: null, notRunWhy: 'the plan\'s rank sends MIX37 on, not this one' });
    expect(notRun?.outcome).toBe('mixed / unclear');
    // Sent on, four-seed stage not finished and no reason given for stopping: still pending, not an outcome.
    expect(settingOutcome({ gate: true, gateNote: '', stage2: sentOn, stage3: null })).toBeNull();
    expect(notRun?.notes[0]).toMatch(/four-seed stage was not run.*MIX37/);
    expect(settingOutcome({ gate: true, gateNote: '', stage2: sentOn, stage3: stage3Outcome(four()) })?.outcome).toBe('bodies with turnover');
  });

  it('ranks the neighbours by divisions in their two phage windows, ties to MIX37', () => {
    expect(neighbourRank([])).toBeNull();
    expect(neighbourRank([{ name: 'MIX12', divisions: 3 }])).toBe('MIX12');
    expect(neighbourRank([{ name: 'MIX12', divisions: 30 }, { name: 'MIX37', divisions: 12 }])).toBe('MIX12');
    expect(neighbourRank([{ name: 'MIX12', divisions: 12 }, { name: 'MIX37', divisions: 12 }])).toBe('MIX37');
    expect(neighbourRank([{ name: 'MIX37', divisions: 12 }, { name: 'MIX12', divisions: 12 }])).toBe('MIX37');
  });
});
