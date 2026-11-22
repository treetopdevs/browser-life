import { describe, expect, it } from 'vitest';
import { defaultDropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { PHAGE_RUN_DEFAULTS, phageArms } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { MOTIFS, ObjectTracker, type TrackerResult, type UidRecord } from '../b2check/observe.ts';
import { CONFIRM_SEEDS, DROPLET_CENSUS, DROPLET_STEPS, type DropletRow, judgeDroplets } from '../confirm/rule.ts';
import { type BirthNote, BodyLog, type BodyLogResult } from '../spot6/bodylog.ts';
import {
  bodyReadouts,
  type BodyReadouts,
  CONFIRM_RULE,
  endpoints,
  erosionReadouts,
  gatePasses,
  patternTurnover,
  phageLoad,
  readDivision,
  readPhage,
  type SeedFacts,
  settingOutcome,
  stage2Outcome,
  type Stage3Seed,
  stage3Outcome,
  turnoverAbove,
} from '../spot6/rule.ts';
import { ALLOWED_SEEDS, baseSettingOf, buildSpec, emergenceBound, mixRates, PHAGE_VARIANTS, SETTINGS, settingOf, UNSEEN_SEEDS } from '../spot6/settings.ts';

const SIZE = 32;
function field(): Uint32Array {
  return new Uint32Array(SIZE * SIZE * MOTIFS);
}
function rect(W: Uint32Array, x0: number, y0: number, w: number, h: number, motif = 0, value = 600): Uint32Array {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) W[(((y0 + dy) % SIZE) * SIZE + ((x0 + dx) % SIZE)) * MOTIFS + motif] = value;
  return W;
}
/** Feeds frames 10 steps apart from step 0 through the tracker and the body log, as run.ts does. */
function run(frames: Uint32Array[], phage: (k: number) => Uint32Array = () => field(), opts = {}): { tr: TrackerResult; log: BodyLogResult } {
  const tracker = new ObjectTracker(SIZE, SIZE);
  const log = new BodyLog(SIZE, SIZE, opts);
  frames.forEach((W, k) => {
    const P = phage(k);
    log.observe(k * 10, tracker.observe(k * 10, W, P), W, P);
  });
  return { tr: tracker.finish(), log: log.finish() };
}

describe('settings', () => {
  it('builds the confirmation\'s config, key for key, when there are no overrides', () => {
    for (const arm of phageArms(PHAGE_RUN_DEFAULTS)) {
      const theirs = defaultDropletKernelConfig({ width: 128, height: 128, seed: 3, ...arm.ov });
      const mine = buildSpec('B2', arm.name, 3);
      expect(JSON.stringify(mine.cfg)).toBe(JSON.stringify(theirs));
      expect(mine.single).toBe(arm.single);
    }
  });

  it('changes only the three rates at a rate setting, and only the named phage rate at a variant', () => {
    const base = buildSpec('B2', 'PHAGE', 1).cfg as unknown as Record<string, unknown>;
    const diff = (name: string) => {
      const cfg = buildSpec(name, 'PHAGE', 1).cfg as unknown as Record<string, unknown>;
      return Object.keys(base).filter((k) => base[k] !== cfg[k]).sort();
    };
    expect(diff('SPOT')).toEqual(['diffF', 'diffW', 'kDeg']);
    expect(diff('MIX50')).toEqual(['diffF', 'diffW', 'kDeg']);
    expect(diff('DIFF_ONLY')).toEqual(['diffF', 'diffW']);
    expect(diff('PH_LONG@MIX50')).toEqual(['diffF', 'diffW', 'kDecayP', 'kDeg']);
    expect(diff('PH_MILD@SPOT')).toEqual(['diffF', 'diffW', 'kDeg', 'kInfect']);
    expect(buildSpec('SPOT', 'PHAGE', 1).cfg).toMatchObject({ kDeg: 0.085, diffW: 0.015, diffF: 0.3 });
    expect(mixRates(0.5)).toEqual({ kDeg: 0.0725, diffW: 0.0275, diffF: 0.25 });
    expect(mixRates(0)).toEqual({ kDeg: 0.06, diffW: 0.04, diffF: 0.2 });
    expect(mixRates(1)).toEqual({ kDeg: 0.085, diffW: 0.015, diffF: 0.3 });
  });

  it('keeps the arm\'s own switches under a rate setting (no phage, one wall, pattern-blind phage)', () => {
    expect(buildSpec('SPOT', 'NO_PHAGE', 1).cfg).toMatchObject({ kInfect: 0, mutPhage: 0, neutralPhage: false });
    expect(buildSpec('SPOT', 'SINGLE_WALL', 1)).toMatchObject({ single: true, cfg: { mutMotif: 0 } });
    expect(buildSpec('SPOT', 'NEUTRAL_PHAGE', 1).cfg.neutralPhage).toBe(true);
  });

  it('lists at most eight settings and two phage variants, and refuses anything else', () => {
    expect(SETTINGS.length).toBeLessThanOrEqual(8);
    expect(PHAGE_VARIANTS.length).toBeLessThanOrEqual(2);
    expect(baseSettingOf('PH_LONG@MIX50')).toBe('MIX50');
    expect(baseSettingOf('SPOT')).toBe('SPOT');
    expect(() => settingOf('SPOT2')).toThrow();
    expect(() => settingOf('PH_FAST@SPOT')).toThrow();
    expect(() => buildSpec('SPOT', 'ONE64_SPOT', 1)).toThrow();
  });

  it('refuses every seed outside 1 to 4', () => {
    expect(ALLOWED_SEEDS).toEqual([1, 2, 3, 4]);
    for (const s of [0, 5, 12, 13, 16, 17, ...UNSEEN_SEEDS]) expect(() => buildSpec('SPOT', 'PHAGE', s)).toThrow(/not allowed/);
  });

  it('computes the emergence bound from the config', () => {
    expect(emergenceBound(buildSpec('B2', 'PHAGE', 1).cfg)).toBeCloseTo((128 * 128 * 0.00001 * 5) / 0.02, 9);
    expect(emergenceBound(buildSpec('PH_LONG@SPOT', 'PHAGE', 1).cfg)).toBeCloseTo((128 * 128 * 0.00001 * 5) / 0.002, 9);
    expect(emergenceBound(buildSpec('B2', 'NO_PHAGE', 1).cfg)).toBe(0);
  });
});

describe('phage alive', () => {
  const rows = (...vs: number[]) => vs.map((phage) => ({ phage }));
  const flat = (v: number, n = 40) => rows(...Array.from({ length: n }, () => v));

  it('needs phage at the end and ten times the emergence bound in the second half and in the last 2,000 steps', () => {
    expect(readPhage(flat(500), 41).alive).toBe(true);
    expect(readPhage(flat(410), 41).alive).toBe(true);
    expect(readPhage(flat(409), 41)).toMatchObject({ alive: false, presentAtEnd: true });
    expect(readPhage([...flat(5000, 39), { phage: 0 }], 41)).toMatchObject({ alive: false, presentAtEnd: false });
    // The confirmation's test alone would call a world at the emergence level alive.
    expect(readPhage(flat(30), 41)).toMatchObject({ alive: false, presentAtEnd: true });
  });

  it('does not read an early bloom that died back to the emergence level as alive', () => {
    // First half 1,000, then 40: the whole-window mean (520) is over the bar of 410, the second half is not.
    const bloom = readPhage([...flat(1000, 20), ...flat(40, 20)], 41);
    expect(bloom.mean).toBeCloseTo(520, 9);
    expect(bloom.alive).toBe(false);
    // Alive through the second half but gone in the last four censuses.
    expect(readPhage([...flat(1000, 36), ...flat(40, 4)], 41).alive).toBe(false);
    // A late bloom is alive.
    expect(readPhage([...flat(40, 20), ...flat(1000, 20)], 41).alive).toBe(true);
  });
});

describe('pattern turnover', () => {
  it('is zero for shares that do not move and counts the share that changed type', () => {
    const still = [0, 500, 1000, 1500, 2000].map((t) => ({ t, shares: [0.5, 0.5, 0, 0, 0, 0] }));
    expect(patternTurnover(still)).toBe(0);
    const swing = [
      { t: 500, shares: [1, 0, 0, 0, 0, 0] },
      { t: 1000, shares: [1, 0, 0, 0, 0, 0] },
      { t: 1500, shares: [0.6, 0.4, 0, 0, 0, 0] },
      { t: 2000, shares: [0, 1, 0, 0, 0, 0] },
    ];
    // Pairs 1,000 steps apart: 500 -> 1500 (0.4) and 1000 -> 2000 (1.0).
    expect(patternTurnover(swing)).toBeCloseTo(0.7, 12);
    expect(patternTurnover(swing, 1500)).toBeCloseTo(1, 12);
    expect(patternTurnover([{ t: 500, shares: [1, 0, 0, 0, 0, 0] }])).toBeNull();
  });

  it('counts as above NO_PHAGE only with a living control, a minimum level and a margin', () => {
    expect(turnoverAbove(0.06, 0.02, true)).toBe(true);
    expect(turnoverAbove(0.03, 0.02, true)).toBe(true); // exactly 1.5 times
    expect(turnoverAbove(0.029, 0.02, true)).toBe(false); // above, but inside the margin
    expect(turnoverAbove(0.004, 0, true)).toBe(false); // tiny wobble against a still lattice
    expect(turnoverAbove(0.01, 0, true)).toBe(true);
    expect(turnoverAbove(0.06, 0, false)).toBe(false); // a dead control hands nobody a win
    expect(turnoverAbove(null, 0.02, true)).toBe(false);
    expect(turnoverAbove(0.06, null, true)).toBe(false);
  });
});

describe('division read in one window', () => {
  const rec = (over: Partial<UidRecord>): UidRecord => ({ uid: 1, motif: 0, born: 0, birth: 'initial', parent: 0, end: null, endKind: null, into: 0, frames: 100, areaSum: 400, maxArea: 4, maxPeak: 500, ...over });
  const result = (records: UidRecord[]): TrackerResult => ({ firstStep: 20_000, lastStep: 40_000, frames: 2001, records, samples: [], census: [] });
  const note = (uid: number, over: Partial<BirthNote> = {}): BirthNote => ({ uid, t: 0, of: 0, gap: 0, share: 0, mates: [], keeper: null, atStart: { uid: 0, share: 0 }, apartLow: true, ...over });
  const logOf = (births: BirthNote[]): BodyLogResult => ({ seriesEvery: 50, history: 20, apartAfter: 500, series: [], ends: [], births });

  it('counts new bodies by kind and half, and leaves out switches, returns, severed and rejoined births', () => {
    const records = [
      rec({ uid: 1, born: 20_000 }),
      rec({ uid: 2, born: 21_000, birth: 'fission', parent: 1 }),
      rec({ uid: 3, born: 35_000, birth: 'fission', parent: 1 }),
      rec({ uid: 4, born: 22_000, birth: 'switch', parent: 1 }),
      rec({ uid: 5, born: 31_000, birth: 'denovo' }), // on the footprint of 8, which ended 100 steps earlier: a return
      rec({ uid: 6, born: 23_000, birth: 'fission', parent: 1, end: 23_400, endKind: 'fade' }), // gone within 500 steps: not lasting
      rec({ uid: 7, born: 39_600, birth: 'fission', parent: 1 }), // too close to the end of the window to be read
      rec({ uid: 8, born: 20_000, end: 30_900, endKind: 'fade' }),
      rec({ uid: 9, born: 20_000, end: 30_000, endKind: 'switch' }),
      rec({ uid: 10, born: 25_000, birth: 'denovo', end: 25_100, endKind: 'fade' }), // a brief crossing
      rec({ uid: 11, born: 26_000, birth: 'fission', parent: 1 }), // joined to its parent by total wall: severed
      rec({ uid: 12, born: 20_000, end: 27_000, endKind: 'absorbed', into: 1 }),
      rec({ uid: 13, born: 29_000, birth: 'fission', parent: 1 }), // on the footprint of 12, absorbed into its parent 2,000 steps earlier
      rec({ uid: 14, born: 20_000, end: 28_000, endKind: 'absorbed', into: 1 }),
      rec({ uid: 15, born: 30_000, birth: 'fission', parent: 1 }), // the id keeper sits on the footprint of 14: also a re-separation
      rec({ uid: 16, born: 33_000, birth: 'denovo' }), // a true birth from nothing
      rec({ uid: 17, born: 20_000, end: 32_000, endKind: 'fade' }), // a lasting end nothing returned to
      rec({ uid: 18, born: 36_000, birth: 'fission', parent: 1 }), // on an old footprint of 17, 4,000 steps later and not absorbed: new
      rec({ uid: 19, born: 20_000, end: 21_000, endKind: 'absorbed', into: 20 }),
      rec({ uid: 20, born: 20_000, end: 22_000, endKind: 'absorbed', into: 1 }),
      rec({ uid: 21, born: 34_000, birth: 'fission', parent: 1 }), // on the footprint of 19, absorbed into 20, itself absorbed into the parent
      rec({ uid: 22, born: 34_500, birth: 'fission', parent: 1 }), // its tiles were inside the parent when the window began
      rec({ uid: 23, born: 37_000, birth: 'fission', parent: 1, end: 38_000, endKind: 'absorbed', into: 1 }), // never apart at 0.05: a lobe, and its end is not a body's end
      rec({ uid: 24, born: 37_500, birth: 'fission', parent: 1 }), // separation not read (the parent was gone by then)
      rec({ uid: 25, born: 38_000, birth: 'fission', parent: 1 }), // its tiles were at the start inside an object that faded: a refilled site, new
      rec({ uid: 26, born: 38_500, birth: 'fission', parent: 22 }), // its tiles were at the start inside 1, which its parent 22 split from
      rec({ uid: 27, born: 38_600, birth: 'fission', parent: 22 }), // on the footprint of 12, absorbed into 1, which its parent split from
    ];
    const log = logOf([
      note(2), note(3), note(4), note(6), note(7), note(10), note(16),
      note(5, { of: 8, gap: 100, share: 1 }),
      note(11, { mates: [1] }),
      note(13, { of: 12, gap: 2000, share: 0.75 }),
      note(15, { keeper: { uid: 1, of: 14, gap: 2000, share: 0.6 } }),
      note(18, { of: 17, gap: 4000, share: 1 }),
      note(21, { of: 19, gap: 13_000, share: 1 }),
      note(22, { atStart: { uid: 1, share: 0.5 } }),
      note(23, { apartLow: false }),
      note(24, { apartLow: null }),
      note(25, { atStart: { uid: 17, share: 1 } }),
      note(26, { atStart: { uid: 1, share: 1 } }),
      note(27, { of: 12, gap: 11_600, share: 1 }),
    ]);
    const r = bodyReadouts(result(records), 10, log);
    expect(r.lastingFirstHalf).toEqual({ fission: 4, switch: 1, denovo: 0 });
    expect(r.lastingSecondHalf).toEqual({ fission: 9, switch: 0, denovo: 2 });
    expect(r.newFirstHalf).toEqual({ fission: 1, denovo: 0 });
    expect(r.newSecondHalf).toEqual({ fission: 3, denovo: 1 }); // 3, 18, 25 and 16
    expect(r.notNew).toEqual({ switch: 1, severed: 1, returned: 1, rejoined: 4, preexisting: 2, joined: 2 });
    expect(r.lastingEnds).toBe(6); // 8, 12, 14, 17, 19, 20
    expect(r.returnedEnds).toBe(4); // 8, 12, 14, 19
    expect(r.pieceEnds).toBe(1); // 23
    expect(r.lastingSwitchEnds).toBe(1);
    expect(r.objectKiloSteps).toBe(27);
    expect(r.birthRate).toBeCloseTo(5 / 27, 12);
    expect(r.endRate).toBeCloseTo(2 / 27, 12);
  });

  it('counts an end as returned even when what came back did not last', () => {
    const records = [rec({ uid: 1, born: 20_000, end: 25_000, endKind: 'fade' }), rec({ uid: 2, born: 25_050, birth: 'denovo', end: 25_300, endKind: 'fade' })];
    const r = bodyReadouts(result(records), 10, logOf([note(2, { of: 1, gap: 50, share: 1 })]));
    expect(r).toMatchObject({ lastingEnds: 1, returnedEnds: 1, notNew: { returned: 0 } });
  });

  it('does not call a birth a return on a thin overlap or a stale footprint', () => {
    const records = [rec({ uid: 1, born: 20_000, end: 25_000, endKind: 'fade' }), rec({ uid: 2, born: 25_100, birth: 'denovo' }), rec({ uid: 3, born: 26_000, birth: 'denovo' })];
    const r = bodyReadouts(result(records), 10, logOf([note(2, { of: 1, gap: 100, share: 0.25 }), note(3, { of: 1, gap: 1000, share: 1 })]));
    expect(r.newFirstHalf).toEqual({ fission: 0, denovo: 2 });
    expect(r.returnedEnds).toBe(0);
  });

  const win = (firstF: number, firstD: number, secondF: number, secondD: number, ends = 1000, switches = 0): BodyReadouts => ({
    lastingFirstHalf: { fission: firstF, switch: switches, denovo: firstD },
    lastingSecondHalf: { fission: secondF, switch: switches, denovo: secondD },
    newFirstHalf: { fission: firstF, denovo: firstD },
    newSecondHalf: { fission: secondF, denovo: secondD },
    notNew: { switch: 2 * switches, severed: 0, returned: 0, rejoined: 0, preexisting: 0, joined: 0 },
    lastingEnds: ends,
    returnedEnds: 0,
    pieceEnds: 0,
    lastingSwitchEnds: 0,
    objectKiloSteps: 1,
    birthRate: 0,
    endRate: 0,
    switchRate: 0,
  });

  it('does not let a relabelled lattice read as dividing', () => {
    // 500 type switches per half and nothing else: B2CHECK's rule would count 1,000 lasting births with a parent.
    expect(readDivision([win(0, 0, 0, 0, 0, 500)])).toMatchObject({ lasting: 0, label: 'division not observed' });
  });

  it('needs 20 new bodies, 80% of them by fission, a quarter of them in the second half, and ends to match', () => {
    expect(readDivision([win(8, 1, 8, 2), win(1, 0, 0, 0)])).toMatchObject({ lasting: 20, fission: 17, label: 'division holds' });
    expect(readDivision([win(8, 1, 8, 2)])).toMatchObject({ lasting: 19, label: 'division not observed' });
    expect(readDivision([win(8, 3, 7, 2)])).toMatchObject({ lasting: 20, fission: 15, label: 'division does not hold' });
    // Founding fill that dies away: plenty of fissions, almost all in the first half.
    const fill = readDivision([win(90, 0, 4, 0)]);
    expect(fill.label).toBe('division does not hold');
    expect(fill.failed.join(' ')).toMatch(/second half/);
    // A lattice still growing evenly through the window: twenty fissions and no body ends.
    const growing = readDivision([win(10, 0, 10, 0, 0)]);
    expect(growing.label).toBe('division does not hold');
    expect(growing.failed.join(' ')).toMatch(/still filling/);
    expect(readDivision([win(10, 0, 10, 0, 10)]).label).toBe('division holds');
    expect(readDivision([win(10, 0, 10, 0, 9)]).label).toBe('division does not hold');
  });

  it('needs the births spread over the seeds when a number of contributing seeds is asked for', () => {
    const one = [win(15, 0, 15, 0), win(1, 0, 1, 0), win(0, 0, 0, 0)];
    expect(readDivision(one, 20, 3)).toMatchObject({ lasting: 32, contributing: 1, label: 'division does not hold' });
    expect(readDivision([win(5, 0, 5, 0), win(3, 0, 2, 0), win(3, 0, 3, 0)], 20, 3)).toMatchObject({ contributing: 3, label: 'division holds' });
    expect(readDivision([win(5, 0, 5, 0), win(3, 0, 1, 0), win(4, 0, 4, 0)], 20, 3).label).toBe('division does not hold');
  });
});

describe('body log', () => {
  it('keeps the last frames of an object that ends, with its own-type phage', () => {
    const frames = [0, 1, 2, 3, 4].map((k) => (k < 4 ? rect(field(), 5, 5, 2, 2) : field()));
    const phage = (k: number) => rect(field(), 5, 5, 2, 2, 0, k * 10);
    const { tr, log } = run(frames, phage, { history: 3 });
    expect(tr.records[0]).toMatchObject({ end: 40, endKind: 'fade' });
    expect(log.ends).toEqual([{ uid: tr.records[0].uid, t: 40, area: [4, 4, 4], mass: [2400, 2400, 2400], phage: [40, 80, 120] }]);
  });

  it('samples the series every 50 steps and ignores phage of other types', () => {
    const frames = Array.from({ length: 11 }, () => rect(field(), 5, 5, 2, 2, 1));
    const { log } = run(frames, () => rect(rect(field(), 5, 5, 2, 2, 1, 7), 5, 5, 2, 2, 0, 900));
    expect(log.series.map((f) => f.t)).toEqual([0, 50, 100]);
    expect(log.series[1]).toMatchObject({ area: [4], mass: [2400], phage: [28] });
  });

  it('links an object that reappears on the footprint of one that ended, and not one that appears elsewhere', () => {
    const there = rect(field(), 5, 5, 2, 2);
    const frames = [there, there, field(), field(), rect(rect(field(), 5, 5, 2, 2), 20, 20, 2, 2)];
    const { tr, log } = run(frames);
    const firstUid = tr.records[0].uid;
    expect(log.births.length).toBe(2);
    expect(log.births.find((b) => b.of !== 0)).toMatchObject({ t: 40, of: firstUid, gap: 20, share: 1, mates: [], keeper: null, atStart: { uid: firstUid, share: 1 }, apartLow: null });
    expect(log.births.find((b) => b.of === 0)).toMatchObject({ t: 40, share: 0, atStart: { uid: 0, share: 0 } });
    // The footprint is remembered for the whole window; the gap says how old it is.
    const late = run([there, field(), ...Array.from({ length: 60 }, () => field()), there]);
    expect(late.log.births.map((b) => [b.of, b.gap])).toEqual([[late.tr.records[0].uid, 610]]);
    // A patch of another type on the same tiles is not linked either.
    expect(run([there, field(), rect(field(), 5, 5, 2, 2, 3)]).log.births.map((b) => b.of)).toEqual([0]);
  });
});

describe('fission artefacts, from frames', () => {
  const still = (W: Uint32Array, n: number) => Array.from({ length: n }, () => W);
  const read = (frames: Uint32Array[]) => {
    const { tr, log } = run(frames);
    return { tr, log, r: bodyReadouts(tr, 10, log) };
  };
  const births = (r: BodyReadouts) => r.newFirstHalf.fission + r.newFirstHalf.denovo + r.newSecondHalf.fission + r.newSecondHalf.denovo;

  it('counts a body that grows a lobe and pinches it off as one new body by fission', () => {
    const one = rect(field(), 4, 4, 3, 3);
    const lobe = rect(rect(field(), 4, 4, 3, 3), 7, 5, 4, 1); // a neck and a bud
    const two = rect(rect(field(), 4, 4, 3, 3), 9, 4, 3, 3);
    const { r, tr } = read([...still(one, 60), ...still(lobe, 5), ...still(two, 120)]);
    expect(tr.records.filter((x) => x.birth === 'fission').length).toBe(1);
    expect(births(r)).toBe(1);
    expect(r.notNew).toEqual({ switch: 0, severed: 0, returned: 0, rejoined: 0, preexisting: 0, joined: 0 });
  });

  it('does not count two bodies that are bridged for a while and come apart again, whichever part keeps the id', () => {
    for (const [wa, wb] of [[3, 2], [2, 3]] as const) {
      // A is wa wide, B is wb wide; the larger keeps the id when they separate.
      const apart = rect(rect(field(), 4, 4, wa, 3), 4 + wa + 2, 4, wb, 3);
      const bridged = rect(rect(rect(field(), 4, 4, wa, 3), 4 + wa + 2, 4, wb, 3), 4 + wa, 5, 2, 1);
      const { r, tr } = read([...still(apart, 80), ...still(bridged, 80), ...still(apart, 120)]);
      // The tracker sees an absorption and then a lasting fission daughter.
      expect(tr.records.filter((x) => x.endKind === 'absorbed').length).toBe(1);
      expect(tr.records.filter((x) => x.birth === 'fission').length).toBe(1);
      expect(r.lastingFirstHalf.fission + r.lastingSecondHalf.fission).toBe(1);
      // This line does not count it as a new body, nor the absorption as a body's end.
      expect(births(r)).toBe(0);
      expect(r.notNew.rejoined).toBe(1);
      expect(r.lastingEnds - r.returnedEnds).toBe(0);
    }
  });

  it('does not count a re-separation when the absorbed body ends up holding the id', () => {
    // A (3 wide) absorbs B (2 wide) through a bridge, then shrinks to one column before they part. B's part is
    // then the larger, keeps A's id, and A's remnant is the "daughter": only the id keeper sits on B's footprint.
    const apart = rect(rect(field(), 4, 4, 3, 3), 9, 4, 2, 3);
    const bridged = rect(rect(rect(field(), 4, 4, 3, 3), 9, 4, 2, 3), 7, 5, 2, 1);
    const shrunk = rect(rect(rect(field(), 6, 4, 1, 3), 9, 4, 2, 3), 7, 5, 2, 1);
    const parted = rect(rect(field(), 6, 4, 1, 3), 9, 4, 2, 3);
    const { r, tr, log } = read([...still(apart, 80), ...still(bridged, 40), ...still(shrunk, 40), ...still(parted, 120)]);
    const daughter = tr.records.find((x) => x.birth === 'fission')!;
    const note = log.births.find((b) => b.uid === daughter.uid)!;
    expect(note.of).toBe(0);
    expect(note.keeper).toMatchObject({ uid: daughter.parent, share: 1 });
    expect(births(r)).toBe(0);
    expect(r.notNew.rejoined).toBe(1);
    expect(r.lastingEnds - r.returnedEnds).toBe(0);
  });

  it('does not count two lobes whose neck wobbles round the counting threshold, nor the neck closing as an end', () => {
    // Two dense lobes and a neck between them. The neck goes from 205 to 204 for 1,000 steps and back.
    const dumbbell = (neck: number) => rect(rect(rect(field(), 4, 4, 3, 3), 9, 4, 3, 3), 7, 5, 2, 1, 0, neck);
    const lobe = rect(field(), 4, 4, 3, 3);
    // (a) The second lobe grew inside the window, so only the low-wall rule can catch it.
    // (b) The dumbbell was there when the window began: the window-start rule catches it first.
    for (const [frames, reason] of [
      [[...still(lobe, 80), ...still(dumbbell(205), 80), ...still(dumbbell(204), 100), ...still(dumbbell(205), 120)], 'joined'],
      [[...still(dumbbell(205), 80), ...still(dumbbell(204), 100), ...still(dumbbell(205), 120)], 'preexisting'],
    ] as const) {
      const { r, tr, log } = read([...frames]);
      // The tracker sees a lasting fission daughter, then its absorption.
      const daughter = tr.records.find((x) => x.birth === 'fission')!;
      expect(daughter).toMatchObject({ endKind: 'absorbed' });
      expect(daughter.end! - daughter.born).toBe(1000);
      expect(log.births.find((b) => b.uid === daughter.uid)!.apartLow).toBe(false);
      expect(r.lastingFirstHalf.fission + r.lastingSecondHalf.fission).toBe(1);
      expect(births(r)).toBe(0);
      expect(r.notNew[reason]).toBe(1);
      // The neck closing again is not the end of a body.
      expect(r.lastingEnds - r.returnedEnds).toBe(0);
      expect(r.pieceEnds).toBe(1);
    }
  });

  it('does not count a bridge held for longer than 5,000 steps and then broken', () => {
    const apart = rect(rect(field(), 4, 4, 3, 3), 9, 4, 2, 3);
    const bridged = rect(rect(rect(field(), 4, 4, 3, 3), 9, 4, 2, 3), 7, 5, 2, 1);
    const { r, log } = read([...still(apart, 80), ...still(bridged, 600), ...still(apart, 120)]);
    expect(log.births[0].gap).toBe(6000);
    expect(births(r)).toBe(0);
    expect(r.notNew.rejoined).toBe(1);
    expect(r.lastingEnds - r.returnedEnds).toBe(0);
  });

  it('does not count the breaking of a bridge that was already there when the window began', () => {
    for (const [wa, wb] of [[3, 2], [2, 3]] as const) {
      const apart = rect(rect(field(), 4, 4, wa, 3), 4 + wa + 2, 4, wb, 3);
      const bridged = rect(rect(rect(field(), 4, 4, wa, 3), 4 + wa + 2, 4, wb, 3), 4 + wa, 5, 2, 1);
      const { r } = read([...still(bridged, 80), ...still(apart, 120)]);
      expect(r.lastingFirstHalf.fission + r.lastingSecondHalf.fission).toBe(1);
      expect(births(r)).toBe(0);
      expect(r.notNew.preexisting).toBe(1);
    }
  });

  it('does not count the second split of three lobes that were one object when the window began', () => {
    // Lobes at x = 4, 10 and 16, joined by two necks. First the left neck breaks (a large left lobe keeps the
    // id, the other two leave as one daughter), then the right neck, then the right lobe rejoins.
    const lobes = (left: boolean, right: boolean) => {
      const W = rect(rect(rect(field(), 1, 2, 6, 6), 10, 4, 3, 3), 16, 4, 3, 3);
      if (left) rect(W, 7, 5, 3, 1);
      if (right) rect(W, 13, 5, 3, 1);
      return W;
    };
    const { r, tr } = read([...still(lobes(true, true), 80), ...still(lobes(false, true), 80), ...still(lobes(false, false), 100), ...still(lobes(false, true), 120)]);
    const fissions = tr.records.filter((x) => x.birth === 'fission');
    expect(fissions.length).toBe(2);
    // The second daughter's parent is the first daughter, not the object that held its tiles at the start.
    expect(fissions[1].parent).toBe(fissions[0].uid);
    expect(births(r)).toBe(0);
    expect(r.notNew.preexisting).toBe(2);
  });

  it('counts a neighbour\'s daughter that fills the site of a body that ended 1,000 steps before, and that body\'s end', () => {
    const both = rect(rect(field(), 4, 4, 3, 3), 12, 4, 3, 3);
    const one = rect(field(), 4, 4, 3, 3);
    const lobe = rect(rect(field(), 4, 4, 3, 3), 7, 5, 8, 1); // the survivor reaches across
    const refilled = rect(rect(field(), 4, 4, 3, 3), 12, 4, 3, 3);
    const { r } = read([...still(both, 80), ...still(one, 100), ...still(lobe, 3), ...still(refilled, 120)]);
    expect(births(r)).toBe(1);
    expect(r.newFirstHalf.fission + r.newSecondHalf.fission).toBe(1);
    expect(r.lastingEnds - r.returnedEnds).toBe(1);
  });

  it('does not count a body cut in two by a relabelled middle as a division', () => {
    const whole = rect(field(), 4, 4, 9, 3);
    // The middle three columns change to another type; the wall is still all there.
    const cut = rect(rect(rect(field(), 4, 4, 3, 3), 10, 4, 3, 3), 7, 4, 3, 3, 2);
    const { r, tr } = read([...still(whole, 60), ...still(cut, 120)]);
    expect(tr.records.filter((x) => x.birth === 'fission').length).toBe(1);
    expect(tr.records.filter((x) => x.birth === 'switch').length).toBe(1);
    expect(births(r)).toBe(0);
    expect(r.notNew).toMatchObject({ switch: 1, severed: 1 });
  });

  it('does not count a body that dips under the counting rule and comes back', () => {
    const there = rect(field(), 4, 4, 3, 3);
    const { r } = read([...still(there, 80), ...still(rect(field(), 4, 4, 3, 3, 0, 150), 10), ...still(there, 120)]);
    expect(births(r)).toBe(0);
    expect(r.notNew.returned).toBe(1);
    expect(r.lastingEnds).toBe(1);
    expect(r.returnedEnds).toBe(1);
  });

  it('counts a relabelled whole body as a switch, not a birth or an end of a body', () => {
    const { r } = read([...still(rect(field(), 4, 4, 3, 3), 80), ...still(rect(field(), 4, 4, 3, 3, 4), 120)]);
    expect(births(r)).toBe(0);
    expect(r.notNew.switch).toBe(1);
    expect(r.lastingEnds).toBe(0);
    expect(r.lastingSwitchEnds).toBe(1);
  });
});

describe('erosion readouts', () => {
  it('tells a dip that recovers from an end after a dip and from a sudden end', () => {
    // Three bodies, 30 samples each (frames 10 steps apart, series every 50): 1,450 steps.
    const steps = 146;
    const frames: Uint32Array[] = [];
    for (let k = 0; k < steps; k++) {
      const W = field();
      // A: dips to a third of its wall between frames 50 and 70, then recovers.
      rect(W, 2, 2, 2, 2, 0, k >= 50 && k < 70 ? 250 : 800);
      // B: full size until it ends at frame 130.
      if (k < 130) rect(W, 12, 2, 2, 2, 1, 800);
      // C: fades to a third from frame 110, gone at frame 140.
      if (k < 140) rect(W, 22, 2, 2, 2, 2, k >= 110 ? 250 : 800);
      frames.push(W);
    }
    const phage = (k: number) => rect(field(), 12, 2, 2, 2, 1, k >= 120 ? 400 : 0);
    const { tr, log } = run(frames, phage);
    const e = erosionReadouts(tr, log);
    expect(e.bodies).toBe(3);
    expect(e.recoveredDips).toBe(1);
    expect(e.endsAfterDip).toBe(1);
    expect(e.endsSudden).toBe(1);
    expect(e.phageBeforeSuddenEnd).toBe(400);
    expect(e.phageUsual).toBe(0);
    expect(e.phagePeakBeforeEnd).toBe(200); // the median over the two ends: 400 (B) and 0 (C)
  });
});

describe('phage load', () => {
  it('reads how many bodies carry their own phage, and how they differ from those that do not', () => {
    // Two 2 x 2 bodies of type 0: the left one carries 40 units of its own phage, the right one 400 of another type's.
    const W = rect(rect(field(), 4, 4, 2, 2, 0, 400), 12, 4, 2, 2, 0, 800);
    const P = rect(rect(field(), 4, 4, 2, 2, 0, 10), 12, 4, 2, 2, 3, 100);
    const { log } = run(Array.from({ length: 11 }, () => W), () => P);
    const l = phageLoad(log, { t: 100, phage: 440 * 4 });
    expect(l.samples).toBe(6); // two bodies at steps 0, 50 and 100
    expect(l.withPhage1).toBe(0.5);
    expect(l.withPhage10).toBe(0.5);
    expect(l.meanPerTile).toBe(5);
    expect(l.wallLoaded).toBeCloseTo(400 / 1024, 12);
    expect(l.wallClean).toBeCloseTo(800 / 1024, 12);
    expect(l.areaLoaded).toBe(4);
    expect(l.onFootprints).toBeCloseTo(40 / 1760, 12);
    expect(phageLoad(log, { t: 100, phage: 0 }).onFootprints).toBeNull();
  });
});

describe('the five endpoints', () => {
  function dropletRun(seed: number, over: (i: number) => Partial<DropletRow>): DropletRow[] {
    const rows: DropletRow[] = [];
    for (let i = 1; i <= DROPLET_STEPS / DROPLET_CENSUS; i++) rows.push({ t: i * DROPLET_CENSUS, drop: 60 + seed, d1: 4, dom: 0, domShare: 0.4, phage: 100, res: 0, ...over(i) });
    return rows;
  }

  it('agree with the frozen judgeDroplets seed by seed on the confirmation\'s own seeds and length', () => {
    const runs: Record<string, Record<number, DropletRow[]>> = { PHAGE: {}, NO_PHAGE: {}, SINGLE_WALL: {}, NEUTRAL_PHAGE: {} };
    for (const s of CONFIRM_SEEDS) {
      const last = DROPLET_STEPS / DROPLET_CENSUS;
      runs.PHAGE[s] = dropletRun(s, (i) => ({ dom: s % 2 === 0 ? i % 3 : 0, d1: 2 + (s % 4) * 0.7, drop: s === 7 && i === last ? 0 : 40 + 5 * s, phage: s === 9 && i === last ? 0 : 100 }));
      runs.NO_PHAGE[s] = dropletRun(s, (i) => ({ dom: s === 6 ? i % 2 : 0, drop: s === 11 ? 200 : s === 12 && i === last ? 0 : 70 }));
      runs.SINGLE_WALL[s] = dropletRun(s, () => ({ drop: s === 5 ? 90 : 20 }));
      runs.NEUTRAL_PHAGE[s] = dropletRun(s, () => ({ drop: s === 8 ? 120 : 0, d1: s === 10 ? 5.5 : s === 8 ? 3 : 0 }));
    }
    const frozen = judgeDroplets(runs);
    const mine = endpoints(runs, CONFIRM_SEEDS, DROPLET_STEPS);
    expect(mine.length).toBe(5);
    mine.forEach((e, k) => {
      expect(e.id.slice(0, 2)).toBe(frozen.endpoints[k].id.slice(0, 2));
      expect(e.perSeed).toEqual(frozen.endpoints[k].perSeed);
      expect(e.wins).toBe(frozen.endpoints[k].wins);
    });
    // The synthetic runs must exercise both answers of every endpoint, or the comparison shows nothing.
    for (const e of mine) expect(e.wins > 0 && e.wins < e.of).toBe(true);
  });

  it('reads the final 20% of a shorter run and marks a seed whose arm was not run', () => {
    const short = (drop: number, d1 = 4): DropletRow[] => Array.from({ length: 200 }, (_, i) => ({ t: (i + 1) * 500, drop: i < 160 ? 999 : drop, d1, dom: 0, domShare: 0.4, phage: 100, res: 0 }));
    const runs = { PHAGE: { 1: short(50), 2: short(50) }, NEUTRAL_PHAGE: { 1: short(60, 3) }, NO_PHAGE: { 1: short(40), 2: short(140) } };
    const [d1, d2, , d4, d5] = endpoints(runs, [1, 2], 100_000);
    expect(d1.perSeed).toEqual({ 1: false, 2: null });
    expect(d2).toMatchObject({ perSeed: { 1: null, 2: null }, of: 0 });
    expect(d4.perSeed).toEqual({ 1: true, 2: null });
    expect(d5.perSeed).toEqual({ 1: true, 2: false });
  });
});

describe('gate and outcome', () => {
  const s = (seed: number, label: SeedFacts['label'], phageAlive = true, dead = false, settled = true): SeedFacts => ({ seed, label, phageAlive, dead, settled });
  const body = (fission: number, ends = 100, denovo = 0): BodyReadouts => ({
    lastingFirstHalf: { fission: 0, switch: 0, denovo: 0 },
    lastingSecondHalf: { fission: 0, switch: 0, denovo: 0 },
    newFirstHalf: { fission: Math.floor(fission / 2), denovo },
    newSecondHalf: { fission: Math.ceil(fission / 2), denovo: 0 },
    notNew: { switch: 0, severed: 0, returned: 0, rejoined: 0, preexisting: 0, joined: 0 },
    lastingEnds: ends,
    returnedEnds: 0,
    pieceEnds: 0,
    lastingSwitchEnds: 0,
    objectKiloSteps: 1,
    birthRate: 0,
    endRate: 0,
    switchRate: 0,
  });
  const seed3 = (seed: number, over: Partial<Stage3Seed> = {}): Stage3Seed => ({ ...s(seed, 'bodies'), body: body(10), turnoverWin: true, d4: true, ...over });
  const four = (overs: Partial<Stage3Seed>[] = [{}, {}, {}, {}]) => overs.map((o, k) => seed3(k + 1, o));

  it('passes the clean-arm gate only on settled bodies on both seeds', () => {
    expect(gatePasses([{ seed: 1, label: 'bodies', settled: true }, { seed: 2, label: 'bodies', settled: true }])).toBe(true);
    expect(gatePasses([{ seed: 1, label: 'bodies', settled: true }, { seed: 2, label: 'bodies', settled: false }])).toBe(false);
    expect(gatePasses([{ seed: 1, label: 'bodies', settled: true }, { seed: 2, label: 'mixed', settled: true }])).toBe(false);
    expect(gatePasses([{ seed: 1, label: 'bodies', settled: true }])).toBe(false);
  });

  it('reads stage 2 on two seeds, one outcome each', () => {
    expect(stage2Outcome([s(1, 'bodies'), s(2, 'bodies')])).toMatchObject({ outcome: null, advance: true });
    expect(stage2Outcome([s(1, 'no objects', false, true), s(2, 'bodies', true, true)])).toMatchObject({ outcome: 'collapse', advance: false });
    expect(stage2Outcome([s(1, 'wave patches'), s(2, 'wave patches', false)])).toMatchObject({ outcome: 'back to waves', advance: false });
    // A window that read waves on a seed with no objects at the end is a dead seed, not a wave seed.
    expect(stage2Outcome([s(1, 'wave patches'), s(2, 'wave patches', true, true)]).outcome).toBe('mixed / unclear');
    expect(stage2Outcome([s(1, 'bodies', false), s(2, 'bodies', false)])).toMatchObject({ outcome: 'phage lost', advance: false });
    const mixed = stage2Outcome([s(1, 'bodies', true), s(2, 'bodies', false)]);
    expect(mixed).toMatchObject({ outcome: 'mixed / unclear', advance: false });
    expect(mixed.notes.join(' ')).toMatch(/seed 2: phage not alive/);
    expect(stage2Outcome([s(1, 'bodies'), s(2, 'mixed')]).outcome).toBe('mixed / unclear');
    expect(stage2Outcome([s(1, 'bodies'), s(2, 'bodies', true, true)]).outcome).toBe('mixed / unclear');
    expect(() => stage2Outcome([s(1, 'bodies')])).toThrow();
  });

  it('reads stage 3 on four seeds, first match first', () => {
    expect(stage3Outcome(four()).outcome).toBe('bodies with turnover');
    expect(stage3Outcome(four([{}, {}, {}, { label: 'mixed' }]))).toMatchObject({ outcome: 'bodies with turnover', eligible: [1, 2, 3] });
    expect(stage3Outcome(four([{ dead: true }, { dead: true }, { dead: true }, {}])).outcome).toBe('collapse');
    expect(stage3Outcome(four([{ label: 'wave patches' }, { label: 'wave patches' }, { label: 'wave patches' }, {}])).outcome).toBe('back to waves');
    expect(stage3Outcome(four([{}, {}, { label: 'mixed' }, { label: 'wave patches' }])).outcome).toBe('mixed / unclear');
    expect(stage3Outcome(four([{ phageAlive: false }, { phageAlive: false }, { phageAlive: false }, {}])).outcome).toBe('phage lost');
    expect(stage3Outcome(four([{}, {}, { phageAlive: false }, { phageAlive: false }])).outcome).toBe('mixed / unclear');
    // A dead seed's window label does not count as bodies.
    expect(stage3Outcome(four([{ dead: true }, { dead: true }, {}, {}])).outcome).toBe('mixed / unclear');
    expect(() => stage3Outcome(four().slice(0, 3))).toThrow();
  });

  it('reads division, turnover and D4 only on seeds with bodies, phage alive and a settled window', () => {
    // Three static body seeds and one wave seed that holds every fission: not dividing bodies.
    const lent = stage3Outcome(four([{ body: body(0) }, { body: body(0) }, { body: body(0) }, { label: 'wave patches', body: body(500) }]));
    expect(lent).toMatchObject({ outcome: 'frozen mosaic', eligible: [1, 2, 3] });
    expect(lent.division!.lasting).toBe(0);
    // Bodies with phage alive on all four, but only two windows settled: nothing may be read from the rest.
    const unsettled = stage3Outcome(four([{}, {}, { settled: false, body: body(500) }, { settled: false, body: body(500) }]));
    expect(unsettled).toMatchObject({ outcome: 'mixed / unclear', eligible: [1, 2], division: null });
    expect(unsettled.notes.join(' ')).toMatch(/settled on only 2/);
    // Turnover and D4 wins on an ineligible seed do not count.
    expect(stage3Outcome(four([{}, {}, { turnoverWin: false }, { label: 'mixed' }])).outcome).toBe('frozen mosaic');
    const noD4 = stage3Outcome(four([{}, {}, { d4: false }, { label: 'mixed' }]));
    expect(noD4.outcome).toBe('mixed / unclear');
    expect(noD4.notes.join(' ')).toMatch(/D4 holds on 2 eligible/);
  });

  it('tells a frozen mosaic from bodies with turnover and from the unclear cases between', () => {
    expect(stage3Outcome(four([{ body: body(6) }, { body: body(6) }, { body: body(7) }, { body: body(0) }])).outcome).toBe('frozen mosaic'); // 19 births
    expect(stage3Outcome(four([{ turnoverWin: false }, { turnoverWin: false }, {}, {}])).outcome).toBe('frozen mosaic');
    // Enough births, too few with a parent.
    const lowShare = stage3Outcome(four([{ body: body(5, 100, 5) }, { body: body(5, 100, 5) }, { body: body(5, 100, 5) }, { body: body(5, 100, 5) }]));
    expect(lowShare.outcome).toBe('mixed / unclear');
    expect(lowShare.notes.join(' ')).toMatch(/have a parent/);
    // Enough births, no ends: still filling.
    expect(stage3Outcome(four([{ body: body(10, 0) }, { body: body(10, 0) }, { body: body(10, 0) }, { body: body(10, 0) }])).outcome).toBe('mixed / unclear');
    // Enough births, all on one seed.
    const oneSeed = stage3Outcome(four([{ body: body(40) }, { body: body(0) }, { body: body(0) }, { body: body(0) }]));
    expect(oneSeed.outcome).toBe('mixed / unclear');
    expect(oneSeed.notes.join(' ')).toMatch(/1 seeds have at least 5/);
  });

  it('reads the unseen-seed rule on eight seeds: 7 of 8 and 40 new bodies', () => {
    const eight = (bad: number, over: Partial<Stage3Seed> = {}) => Array.from({ length: 8 }, (_, k) => seed3(33 + k, k < bad ? { label: 'mixed' } : over));
    expect(stage3Outcome(eight(1), CONFIRM_RULE).outcome).toBe('bodies with turnover');
    expect(stage3Outcome(eight(2), CONFIRM_RULE).outcome).toBe('mixed / unclear');
    expect(stage3Outcome(eight(0, { body: body(4) }), CONFIRM_RULE).outcome).toBe('frozen mosaic'); // 32 births
    expect(stage3Outcome([...eight(0).slice(0, 6), seed3(39, { d4: false }), seed3(40, { d4: false })], CONFIRM_RULE).outcome).toBe('mixed / unclear');
    expect(() => stage3Outcome(eight(0).slice(0, 4), CONFIRM_RULE)).toThrow();
  });

  it('gives every setting exactly one named outcome, whatever path it took', () => {
    const adv = { outcome: null, advance: true, notes: [] };
    const waves = { outcome: 'back to waves' as const, advance: false, notes: ['wave patches on both seeds'] };
    const base = { reference: false, gate: true, gateNote: 'seed 1: bodies; seed 2: bodies', stage2: null, stage3: null };
    expect(settingOutcome({ ...base, gate: null })).toBeNull();
    const failed = settingOutcome({ ...base, gate: false, gateNote: 'seed 1: mixed; seed 2: bodies' })!;
    expect(failed.outcome).toBe('mixed / unclear');
    expect(failed.notes[0]).toMatch(/did not pass the clean-arm gate \(seed 1: mixed; seed 2: bodies\); no phage world was read/);
    expect(settingOutcome(base)).toBeNull(); // passed the gate, stage 2 not read yet
    expect(settingOutcome({ ...base, stage2: waves })).toEqual({ outcome: 'back to waves', notes: waves.notes });
    expect(settingOutcome({ ...base, stage2: adv })!.notes[0]).toMatch(/stage 3 was not run/);
    expect(settingOutcome({ ...base, stage2: adv })!.outcome).toBe('mixed / unclear');
    expect(settingOutcome({ ...base, stage2: adv, stage3: { outcome: 'frozen mosaic', advance: false, notes: ['x'] } })).toEqual({ outcome: 'frozen mosaic', notes: ['x'] });
    // The reference is read at stage 2 whatever its gate, and can never go on.
    expect(settingOutcome({ ...base, reference: true, gate: false, stage2: waves })!.outcome).toBe('back to waves');
    expect(settingOutcome({ ...base, reference: true, gate: false })).toBeNull();
    expect(settingOutcome({ ...base, reference: true, gate: true, stage2: adv })!.outcome).toBe('mixed / unclear');
  });
});
