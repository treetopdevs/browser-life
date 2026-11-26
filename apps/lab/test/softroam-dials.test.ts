import { describe, expect, it } from 'vitest';
import { checkDials, CHANGE_IDS, dialDefaults, dialMoved, dialOptions, fixDial, linkSwitches, SOFT_DIALS, START_DIAL_IDS, startDials, startNote, startPick, type SoftSwitches } from '../src/softroam/dials.ts';
import { planEntry, SOFT_U, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam, SOFT_STARTS, softRoamConfig, type SoftRoamStart } from '../src/softroam/view.ts';

const sw: SoftSwitches = { seed: 2, size: 64, start: 'garden', kinds: true, toughness: false };
const sea: SoftSwitches = { ...sw, start: 'seasons' };

describe('soft roam page dials', () => {
  it('at their defaults give the same world as no dials, over 300 steps (the garden, the seasons and the big bodies)', () => {
    for (const start of ['garden', 'seasons', 'bodies'] as const) {
      const o = dialOptions({ ...sw, start }, dialDefaults(start));
      expect(o.overrides, start).toBeUndefined();
      expect(softRoamConfig(o), start).toEqual(softRoamConfig({ seed: 2, size: 64, start }));
      const a = foundSoftRoam(o);
      const b = foundSoftRoam({ seed: 2, size: 64, start });
      for (let s = 0; s < 300; s++) { a.stepOnce(); b.stepOnce(); }
      expect(a.digest(), start).toBe(b.digest());
    }
  });
  it('the garden has none of the sun, senses and manners keys; the seasons has all of them, and a dial off leaves its key out', () => {
    const keys = ['day', 'year', 'winter', 'patchSun', 'leaf', 'sight', 'fear', 'truce', 'jaws', 'releaseMin', 'releaseGap'];
    const garden = softRoamConfig(dialOptions(sw, dialDefaults('garden'))) as unknown as Record<string, unknown>;
    for (const k of keys) expect(garden[k], k).toBeUndefined();
    const season = softRoamConfig(dialOptions(sea, dialDefaults('seasons'))) as unknown as Record<string, unknown>;
    for (const k of keys) expect(season[k], k).toBeDefined();
    // Each dial at its off value (0) takes its key out of the seasons config, even though the seasons start would fill it in.
    // Leaf income is the exception: 0 is a setting (leaf cells stay in the plans and the mutations, and earn nothing), not an absence.
    for (const k of keys.filter((x) => x !== 'winter' && x !== 'leaf')) {
      const cfg = softRoamConfig(dialOptions(sea, { ...dialDefaults('seasons'), [k]: 0 })) as unknown as Record<string, unknown>;
      expect(cfg[k], k).toBeUndefined();
    }
    const noIncome = softRoamConfig(dialOptions(sea, { ...dialDefaults('seasons'), leaf: 0 }));
    expect(noIncome.leaf).toBe(0);
    expect(checkDials(sea, { ...dialDefaults('seasons'), leaf: 0 })).toBeNull();
    // With no day, everything that needs a day is idle and drops out with it (no refusal).
    const dark = softRoamConfig(dialOptions(sea, { ...dialDefaults('seasons'), day: 0 })) as unknown as Record<string, unknown>;
    for (const k of ['day', 'year', 'winter', 'patchSun', 'leaf']) expect(dark[k], k).toBeUndefined();
    expect(dark.sight).toBe(8);
    // Choosing a start sets the dials it defines: the garden shows the sun dials off, the seasons its own values.
    expect(startDials('garden')).toMatchObject({ day: 0, year: 0, leaf: 0, sight: 0, truce: 0, releaseGap: 0 });
    expect(startDials('seasons')).toMatchObject({ day: 400, year: 12000, winter: 0.1, leaf: 1.3, sight: 8, fear: 4, truce: 1, releaseMin: 8, releaseGap: 200, birthStore: 60, minStore: 15, patchFood: 1000, patchEvery: 12, leakSide: 8, leakCell: 4, crack: 10000 });
    expect(Object.keys(startDials('garden')).sort()).toEqual([...START_DIAL_IDS].sort());
  });
  it('the big bodies start has every chunk 3 key, and each of its dials off leaves the key out (the start would fill it otherwise)', () => {
    const bod: SoftSwitches = { ...sw, start: 'bodies' };
    const keys = ['heal', 'steer', 'pack', 'crowd', 'leafPool', 'leafPoolMax', 'patchSeason', 'winterCost', 'pace', 'shellThrust'];
    const cfg = softRoamConfig(dialOptions(bod, dialDefaults('bodies'))) as unknown as Record<string, unknown>;
    for (const k of keys) expect(cfg[k], k).toBeDefined();
    expect(cfg.patchSun).toBeUndefined();
    expect([cfg.pack, cfg.winterCost, cfg.life, cfg.crack]).toEqual([6, 0.03, 20000, 2000]);
    for (const k of ['heal', 'steer', 'pack', 'crowd', 'leafPool', 'patchSeason', 'winterCost']) {
      const off = softRoamConfig(dialOptions(bod, { ...dialDefaults('bodies'), [k]: 0 })) as unknown as Record<string, unknown>;
      expect(off[k], k).toBeUndefined();
      if (k === 'leafPool') expect(off.leafPoolMax).toBeUndefined();
      expect(checkDials(bod, { ...dialDefaults('bodies'), [k]: 0 }), k).toBeNull();
    }
    // Chunk 4's: at 1 the key is left out (the start would fill it otherwise), and the founders' spread goes to the start as the dial shows it.
    for (const k of ['pace', 'shellThrust']) {
      const off = softRoamConfig(dialOptions(bod, { ...dialDefaults('bodies'), [k]: 1 })) as unknown as Record<string, unknown>;
      expect(off[k], k).toBeUndefined();
    }
    expect([cfg.pace, cfg.shellThrust]).toEqual([0.25, 0.5]);
    expect(dialOptions(bod, dialDefaults('bodies')).driveSpread).toBe(2);
    expect(dialOptions(bod, { ...dialDefaults('bodies'), driveSpread: 1 }).driveSpread).toBe(1);
    expect(dialOptions({ ...sw, start: 'seasons' }, dialDefaults('seasons')).driveSpread).toBeUndefined();
    // Seeing off takes steer and crowd with it (idle), with no refusal.
    const blind = softRoamConfig(dialOptions(bod, { ...dialDefaults('bodies'), sight: 0, fear: 0 })) as unknown as Record<string, unknown>;
    for (const k of ['sight', 'fear', 'steer', 'crowd']) expect(blind[k], k).toBeUndefined();
    expect(startDials('bodies')).toMatchObject({ heal: 1, steer: 1, pack: 6, crowd: 1, leafPool: 0.3, patchSeason: 1, winterCost: 30, patchSun: 0, life: 20000, crack: 2000, day: 400, releaseMin: 8 });
    expect(startDials('seasons')).toMatchObject({ heal: 0, steer: 0, pack: 0, patchSun: 1, life: 8000 });
    // The pool's cap dial reaches the config when moved, on the bodies start.
    expect(softRoamConfig(dialOptions(bod, { ...dialDefaults('bodies'), leafPoolMax: 500 })).leafPoolMax).toBe(500);
    expect(softRoamConfig(dialOptions(bod, { ...dialDefaults('bodies'), leafPoolMax: 500, leafPool: 0 })).leafPoolMax).toBeUndefined();
  });
  it('the sun, senses and manners dials are marked idle where they change nothing', () => {
    const by = (id: string) => SOFT_DIALS.find((d) => d.id === id)!;
    const d = dialDefaults('seasons');
    expect(by('year').idle?.({ ...d, day: 0 }, sea)).toEqual(expect.any(String));
    expect(by('year').idle?.(d, sea)).toBeNull();
    expect(by('winter').idle?.({ ...d, year: 0 }, sea)).toEqual(expect.any(String));
    expect(by('leaf').idle?.({ ...d, day: 0 }, sea)).toEqual(expect.any(String));
    expect(by('leaf').idle?.(d, { ...sea, kinds: false })).toEqual(expect.any(String));
    for (const id of ['sight', 'fear', 'truce', 'jaws']) {
      expect(by(id).idle?.({ ...d, drain: 0 }, sea), id).toEqual(expect.any(String));
      // Truce works through plain touch feeding, so kinds off does not idle it (the next test shows it acting); the others need mouths.
      if (id !== 'truce') expect(by(id).idle?.(d, { ...sea, kinds: false }), id).toEqual(expect.any(String));
      expect(by(id).idle?.(d, sea) ?? null, id).toBeNull();
    }
    expect(by('truce').idle?.(d, { ...sea, kinds: false }) ?? null).toBeNull();
    // Idle dials are left out rather than refused: seasons with kinds off is still a world.
    expect(checkDials({ ...sea, kinds: false }, d)).toBeNull();
    expect(softRoamConfig(dialOptions({ ...sea, kinds: false }, d)).sight).toBeUndefined();
  });
  it('truce with kinds off is not dropped: the dial-built world keeps it, and it stops a two-cell body draining a one-cell body of its family', () => {
    const d = { ...dialDefaults('seasons'), drain: 3, seal: 0, truce: 1 };
    const drained = (truce: number): { drained: number; cfgTruce: unknown } => {
      const o = dialOptions({ ...sea, kinds: false }, { ...d, truce });
      const cfg = softRoamConfig(o);
      const w = new SoftRoamWorld(cfg);
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m)));
      const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
      const spawn = (x: number, y: number): number => {
        const c = a.allocate();
        a.place(c, x, y, [0, 0, -512, 0, 0], 7, 150, plan);
        w.reservoir -= 150;
        w.mother[c] = -1; w.orient[c] = 0;
        w.body[c] = ++a.labelHi; w.bodySize[w.body[c]] = 1; w.bodyCount++;
        return c;
      };
      const c0 = spawn(10 * SOFT_U, 10 * SOFT_U);
      const c1 = spawn(11 * SOFT_U, 10 * SOFT_U);
      w.mother[c1] = c0; w.gx[c1] = 1; w.body[c1] = w.body[c0]; w.bodySize[w.body[c0]]++; w.bodyCount--;
      spawn(12 * SOFT_U, 10 * SOFT_U);
      w.stepOnce();
      return { drained: w.drained, cfgTruce: cfg.truce };
    };
    const off = drained(0);
    const on = drained(1);
    expect(off.drained).toBeGreaterThan(0);
    expect(on.cfgTruce).toBe(true);
    expect(on.drained).toBe(0);
  });
  it('impossible sun combinations say why in plain words', () => {
    const d = dialDefaults('seasons');
    expect(checkDials(sea, { ...d, year: 100, day: 400 })).toMatch(/These settings do not make a world: a year of 100 steps is shorter than a day of 400/);
  });
  it('the seasons start runs 600 steps from the page dials with the matter balanced', () => {
    const w = foundSoftRoam(dialOptions(sea, dialDefaults('seasons')));
    for (let s = 0; s < 600; s++) w.stepOnce();
    w.checkInvariants();
    expect(w.census().residual).toBe(0);
  });
  it('with kinds off on a plain start the defaults are exactly the plain grown world (no drain, seal, crack, grip), over 300 steps', () => {
    for (const start of ['grown-all', 'grown-lines', 'grown-specks'] as const) {
      const plain = { ...sw, start, kinds: false };
      const o = dialOptions(plain, dialDefaults(start));
      expect(softRoamConfig(o)).toEqual(softRoamConfig({ seed: 2, size: 64, start }));
      const cfg = softRoamConfig(o);
      expect([cfg.kinds, cfg.drain, cfg.seal, cfg.crack, cfg.grip, cfg.shellBite, cfg.shellLeak]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
      const a = foundSoftRoam(o);
      const b = foundSoftRoam({ seed: 2, size: 64, start });
      for (let s = 0; s < 300; s++) { a.stepOnce(); b.stepOnce(); }
      expect(a.digest()).toBe(b.digest());
      expect(a.drained).toBe(0);
      expect(a.census().residual).toBe(0);
    }
  });
  it('every start and kinds switch at default dials gives the world softRoamConfig builds for it', () => {
    for (const start of Object.keys(SOFT_STARTS) as SoftRoamStart[]) {
      for (const kinds of [true, false]) {
        const o = dialOptions({ ...sw, start, kinds }, dialDefaults(start));
        const got = softRoamConfig(o);
        // The seasons with kinds off keeps its sun and drops the senses (which need kinds): no refusal, no sight.
        if ((start === 'seasons' || start === 'bodies') && !kinds) { expect(got.sight).toBeUndefined(); expect(got.day).toBe(400); continue; }
        const want = softRoamConfig({ seed: 2, size: 64, start, kinds });
        if (start === 'garden' || start === 'seasons' || start === 'bodies' || !kinds) expect(got, `${start} kinds ${kinds}`).toEqual(want);
        // A plain start with kinds turned on is the garden's rules on that start's line-up.
        else expect(got).toEqual(softRoamConfig({ seed: 2, size: 64, start: 'garden', kinds: true }));
      }
    }
  });
  it('the garden and the plain start are different worlds on the page', () => {
    const garden = dialOptions({ ...sw, start: 'garden', kinds: true }, dialDefaults('garden'));
    const plain = dialOptions({ ...sw, start: 'grown-all', kinds: false }, dialDefaults('grown-all'));
    expect(JSON.stringify(softRoamConfig(garden))).not.toBe(JSON.stringify(softRoamConfig(plain)));
    const a = foundSoftRoam(garden);
    const b = foundSoftRoam(plain);
    for (let s = 0; s < 600; s++) { a.stepOnce(); b.stepOnce(); }
    expect(a.digest()).not.toBe(b.digest());
    expect(a.census().mouths + a.census().shells).toBeGreaterThan(0);
    expect(b.census().mouths + b.census().shells).toBe(0);
    expect(b.drained).toBe(0);
  });
  it('the gene and plan copy-error dials do not move each other, and the value shown is the value used', () => {
    const d = dialDefaults('garden');
    expect(softRoamConfig(dialOptions(sw, d)).planMut).toBe(0.01);
    const moved = softRoamConfig(dialOptions(sw, { ...d, mut: 0.1 }));
    expect([moved.mut, moved.planMut]).toEqual([0.1, 0.01]);
    const zero = softRoamConfig(dialOptions(sw, { ...d, mut: 0 }));
    expect([zero.mut, zero.planMut]).toEqual([0, 0.01]);
    // Typing 0.01 into the plan box with the gene dial moved is 0.01, and any other plan value reaches the world as typed.
    expect(softRoamConfig(dialOptions(sw, { ...d, mut: 0.04, planMut: 0.01 })).planMut).toBe(0.01);
    expect(softRoamConfig(dialOptions(sw, { ...d, mut: 0.04, planMut: 0.3 })).planMut).toBe(0.3);
    expect(softRoamConfig(dialOptions(sw, { ...d, planMut: 0 })).planMut).toBe(0);
  });
  it('the armour dials are marked idle on the plain start with kinds off, and not on the garden', () => {
    const plain = { ...sw, start: 'grown-all' as const, kinds: false };
    for (const id of ['drain', 'seal', 'crack', 'grip', 'shellBite', 'shellLeak']) {
      const dial = SOFT_DIALS.find((x) => x.id === id)!;
      expect(dial.idle?.(dialDefaults('grown-all'), plain), id).toEqual(expect.any(String));
      expect(dial.idle?.(dialDefaults('garden'), sw) ?? null, id).toBeNull();
    }
  });
  it('every dial at its lowest and highest makes a valid world, and the value reaches the config', () => {
    for (const d of SOFT_DIALS) {
      for (const v of [d.min, d.max]) {
        const vals = { ...dialDefaults('seasons'), [d.id]: v };
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, v);
        if (d.id === 'birthStore') vals.minStore = Math.min(vals.minStore, v);
        expect(checkDials(sea, vals), `${d.id} = ${v}`).toBeNull();
        const w = foundSoftRoam(dialOptions(sea, vals));
        expect(w.census().cells, `${d.id} = ${v}`).toBeGreaterThan(0);
        for (let s = 0; s < 20; s++) w.stepOnce();
        w.checkInvariants();
        expect(w.census().residual).toBe(0);
      }
    }
    // Each dial's value, at both ends, lands in the config as the dial says (so a dial wired to the wrong field, or ignored, fails here).
    const area = (64 * 64) / (128 * 128);
    const want: Record<string, (v: number) => unknown> = {
      crack: (v) => (v === 0 ? undefined : v), shellBite: (v) => v, shellLeak: (v) => v, drain: (v) => (v === 0 ? undefined : v), seal: (v) => (dialDefaults('seasons').drain > 0 ? v : undefined),
      grip: (v) => (v === 0 ? undefined : v), flow: (v) => v / 100, life: (v) => (v === 0 ? undefined : v), birthStore: (v) => v, minStore: (v) => Math.min(v, 150), bite: (v) => v,
      leakSide: (v) => v / 1000, leakCell: (v) => v / 1000, moveCost: (v) => v / 1000, thrustMax: (v) => v, keep: (v) => v, turnMax: (v) => v / 1000,
      kBond: (v) => v, kBrace: (v) => v, kRep: (v) => v, patchFood: (v) => v, patchEvery: (v) => Math.max(1, Math.round(v / area)), patchRadius: (v) => v,
      foodSpread: (v) => (v === 0 ? undefined : v), scentDecayShift: (v) => v, scentIters: (v) => v, scentGain: (v) => v, mut: (v) => v, planMut: (v) => v,
      day: (v) => (v === 0 ? undefined : v), year: (v) => (v === 0 ? undefined : v), winter: (v) => v, patchSun: (v) => (v === 0 ? undefined : true), leaf: (v) => v,
      sight: (v) => (v === 0 ? undefined : v), fear: (v) => (v === 0 ? undefined : v), truce: (v) => (v === 0 ? undefined : true), jaws: (v) => (v === 0 ? undefined : true),
      releaseMin: (v) => (v === 0 ? undefined : v), releaseGap: (v) => (v === 0 ? undefined : v),
      // Chunk 3's dials, on the seasons start (which does not fill them): off leaves the key out.
      patchSeason: (v) => (v === 0 ? undefined : true), winterCost: (v) => (v === 0 ? undefined : v / 1000), leafPool: (v) => (v === 0 ? undefined : v),
      leafPoolMax: () => undefined, steer: (v) => (v === 0 ? undefined : true), pack: (v) => (v === 0 ? undefined : v), crowd: (v) => (v === 0 ? undefined : v), heal: (v) => (v === 0 ? undefined : true),
      // Chunk 4's: at 1 the key is left out; the founders' spread is a start option, never in the config.
      pace: (v) => (v === 1 ? undefined : v), shellThrust: (v) => (v === 1 ? undefined : v), driveSpread: () => undefined,
    };
    expect(Object.keys(want).sort()).toEqual(SOFT_DIALS.map((x) => x.id).sort());
    for (const d of SOFT_DIALS) {
      for (const v of [d.min, d.max]) {
        const vals = { ...dialDefaults('seasons'), [d.id]: v };
        if (d.id === 'birthStore') vals.minStore = Math.min(vals.minStore, v);
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, v);
        const cfg = softRoamConfig(dialOptions(sea, vals)) as unknown as Record<string, unknown>;
        let expected = want[d.id](v);
        if (d.id === 'minStore') expected = Math.min(v, vals.birthStore);
        expect(cfg[d.id], `${d.id} = ${v}`).toEqual(expected);
      }
    }
    const cfg = softRoamConfig(dialOptions(sw, { ...dialDefaults('garden'), crack: 750, shellBite: 0.3, bite: 5, leakSide: 20, patchEvery: 40, keep: 100, kBond: 120, thrustMax: 300, grip: 64, foodSpread: 0.2, scentDecayShift: 9, scentIters: 2, scentGain: 4, flow: 3, life: 0, mut: 0.04 }));
    expect(cfg).toMatchObject({ crack: 750, shellBite: 0.3, bite: 5, leakSide: 0.02, patchEvery: 160, keep: 100, kBond: 120, thrustMax: 300, grip: 64, foodSpread: 0.2, scentDecayShift: 9, scentIters: 2, scentGain: 4, flow: 0.03, mut: 0.04, planMut: 0.01 });
    expect(cfg.life).toBeUndefined();
  });
  it('any value typed or linked becomes one the world accepts', () => {
    for (const d of SOFT_DIALS) {
      for (const v of [Number.NaN, -1e9, 1e9, d.min + 1e-6, (d.min + d.max) / 3, d.max - 1e-6, 1e-7, 1.5]) {
        const x = fixDial(d, v);
        expect(x).toBeGreaterThanOrEqual(d.min);
        expect(x).toBeLessThanOrEqual(d.max);
        if (d.whole) expect(Number.isInteger(x)).toBe(true);
        const vals = { ...dialDefaults('seasons'), [d.id]: x };
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, x);
        // A year shorter than the day is the one combination here the world refuses: move the day with it.
        if (d.id === 'year' && x > 0) vals.day = Math.min(vals.day, x);
        expect(checkDials(sea, vals), `${d.id} = ${x}`).toBeNull();
      }
    }
  });
  it('an impossible combination says why instead of throwing', () => {
    const stiff = { ...dialDefaults('seasons'), kBond: 400, kBrace: 400, kRep: 600, keep: 0 };
    expect(checkDials(sea, stiff)).toMatch(/too stiff/);
    expect(checkDials(sea, dialDefaults('seasons'))).toBeNull();
  });
  it('every dial has a plain-words label and a line that says what it does', () => {
    for (const d of SOFT_DIALS) {
      expect(d.label).toMatch(/^[A-Z][a-z]/);
      expect(d.label).not.toMatch(/^[a-z]+[A-Z]/);
      expect(d.say(d.def, dialDefaults('seasons')).length).toBeGreaterThan(15);
    }
  });

  it('choosing a start asks for one world, the one with its kinds switch set: no half-changed world is ever started', () => {
    // Plain start, kinds off, no hold and a long-reach copy dial: valid; the garden with kinds on then refuses them.
    const from: SoftSwitches = { ...sw, start: 'grown-all', kinds: false };
    const d = { ...dialDefaults('garden'), keep: 0, kRep: 560 };
    expect(checkDials(from, d)).toBeNull();
    const garden = startPick(from, 'garden');
    expect(garden).toEqual({ ...from, start: 'garden', kinds: true });
    expect(checkDials(garden, d)).not.toBeNull();
    // The half-changed world (garden, kinds still off) would pass, which is why it must never be tried.
    expect(checkDials({ ...from, start: 'garden' }, d)).toBeNull();
    expect(CHANGE_IDS).not.toContain('start');
    expect(startPick(garden, 'grown-lines')).toEqual({ ...garden, start: 'grown-lines', kinds: false });
  });

  it('a number typed past a dial\'s range, fractional for a whole dial, in the gap above 0, or not a number, is told what it became', () => {
    const by = (id: string) => SOFT_DIALS.find((d) => d.id === id)!;
    expect(dialMoved(by('birthStore'), '150', 150)).toBeNull();
    expect(dialMoved(by('birthStore'), '999999', 150)).toBe('"Matter to divide" can go no higher than 256, so it is 256.');
    expect(dialMoved(by('birthStore'), '-5', 150)).toBe('"Matter to divide" can go no lower than 10, so it is 10.');
    expect(dialMoved(by('birthStore'), '120.5', 150)).toBe('"Matter to divide" takes whole numbers, so it is 121.');
    expect(dialMoved(by('birthStore'), '', 150)).toBe('"Matter to divide" needs a number, so it stays at 150.');
    expect(dialMoved(by('birthStore'), 'many', 150)).toBe('"Matter to divide" needs a number, so it stays at 150.');
    expect(dialMoved(by('life'), '1', 8000)).toBe('"Cells wear out after" is 2: it cannot sit between 0 and 2.');
    expect(dialMoved(by('life'), '0', 8000)).toBeNull();
    // Every message agrees with what fixDial does with the same text.
    for (const d of SOFT_DIALS) for (const typed of ['', 'x', '-1e9', '1e9', String(d.min), String(d.max)]) {
      const m = dialMoved(d, typed, d.def);
      const v = typed === '' ? NaN : Number(typed);
      if (m === null) expect(fixDial(d, v)).toBe(v);
    }
  });

  it('leaf income 0 keeps the leaf bushes\' leaves (they earn nothing); the dial off for lack of kinds or a day still leaves the key out', () => {
    // Seed 3 grows living leaves in 300 steps (seed 2 grows none, which would make a zero income prove nothing).
    const lit: SoftSwitches = { ...sea, seed: 3 };
    const w = foundSoftRoam(dialOptions(lit, { ...dialDefaults('seasons'), leaf: 0 }));
    expect(w.cfg.leaf).toBe(0);
    // Leaf plans survive in the founders (the bush's plan still holds leaf cells), and a world of them earns nothing.
    expect(w.plans.some((pl) => [...pl].some((e) => ((e >>> 12) & 3) === 3))).toBe(true);
    let mostLeaves = 0;
    for (let s = 0; s < 300; s++) { w.stepOnce(); mostLeaves = Math.max(mostLeaves, w.census().leaves); }
    expect(mostLeaves).toBeGreaterThan(0);
    expect(w.census().leafIncome).toBe(0);
    // The same world with the page's income does earn, so the zero above is the dial and not an absence of leaves.
    const paid = foundSoftRoam(dialOptions(lit, dialDefaults('seasons')));
    for (let s = 0; s < 300; s++) paid.stepOnce();
    expect(paid.census().leafIncome).toBeGreaterThan(0);
    expect(foundSoftRoam(dialOptions(sea, { ...dialDefaults('seasons'), leaf: 0 })).plans.length).toBe(foundSoftRoam(dialOptions(sea, dialDefaults('seasons'))).plans.length);
    expect(softRoamConfig(dialOptions({ ...sea, kinds: false }, { ...dialDefaults('seasons'), leaf: 0 })).leaf).toBeUndefined();
    expect(softRoamConfig(dialOptions(sea, { ...dialDefaults('seasons'), leaf: 0, day: 0 })).leaf).toBeUndefined();
    // A start with no leaves keeps its dial's default of 0 as "no leaves".
    expect(softRoamConfig(dialOptions(sw, dialDefaults('garden'))).leaf).toBeUndefined();
  });

  describe('links', () => {
    const defaults = { seed: '1', start: 'seasons', kinds: '1', toughness: '0' };
    it('a bare address, and the address "#", give the page\'s own start and defaults', () => {
      expect(linkSwitches('', defaults)).toEqual(defaults);
      expect(linkSwitches('#', defaults)).toEqual(defaults);
    });
    it('switches a link leaves out are the defaults, not what was left over', () => {
      expect(linkSwitches('#start=garden&seed=7&toughness=1', defaults)).toEqual({ seed: '7', start: 'garden', kinds: '1', toughness: '1' });
      expect(linkSwitches('#start=garden', defaults)).toEqual({ seed: '1', start: 'garden', kinds: '1', toughness: '0' });
    });
    it('a link with no start (or one the page has not got) is an old garden link; a start is looked up by its own keys only', () => {
      for (const h of ['#seed=3', '#start=nonsense&seed=3', '#start=constructor', '#start=__proto__', '#start=toString&kinds=1']) expect(linkSwitches(h, defaults).start, h).toBe('garden');
      expect(Object.keys(linkSwitches('#start=constructor', defaults)).sort()).toEqual(['kinds', 'seed', 'start', 'toughness']);
    });
    it('an old link that names a start but no kinds keeps the old default (kinds on), so #start=grown-lines still has mouths and touch feeding', () => {
      expect(linkSwitches('#start=grown-lines', defaults).kinds).toBe('1');
      expect(linkSwitches('#start=grown-lines&kinds=0', defaults).kinds).toBe('0');
      // A link that names kinds, or a bare address, takes what the start is when it names none of its own.
      expect(linkSwitches('#start=grown-lines&seed=2&kinds=1', defaults).kinds).toBe('1');
    });
    it('values a select does not have are ignored', () => {
      const only = (id: string, v: string) => !(id === 'toughness' && v === '9');
      expect(linkSwitches('#start=garden&toughness=9', defaults, only).toughness).toBe('0');
    });
  });

  it('picking a start says which dials it moved, the economy ones too', () => {
    const note = startNote({ ...dialDefaults('garden'), birthStore: 100 }, 'seasons');
    expect(note).toMatch(/Dials that moved: .*Matter to divide/);
    expect(note).toMatch(/Length of a day/);
    const back = startNote({ ...dialDefaults('seasons'), birthStore: 100 }, 'garden');
    expect(back).toMatch(/Matter to divide/);
    expect(back).toMatch(/Length of a day/);
    // Nothing moved: only the sentence.
    expect(startNote(dialDefaults('seasons'), 'seasons')).not.toMatch(/Dials that moved/);
  });
});
