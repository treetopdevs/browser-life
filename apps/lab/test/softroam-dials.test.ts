import { describe, expect, it } from 'vitest';
import { checkDials, CHANGE_IDS, dialDefaults, dialMoved, dialOptions, fixDial, SOFT_DIALS, startPick, type SoftSwitches } from '../src/softroam/dials.ts';
import { foundSoftRoam, SOFT_STARTS, softRoamConfig, type SoftRoamStart } from '../src/softroam/view.ts';

const sw: SoftSwitches = { seed: 2, size: 64, start: 'garden', kinds: true, toughness: false };

describe('soft roam page dials', () => {
  it('at their defaults give the same world as no dials, over 300 steps', () => {
    const o = dialOptions(sw, dialDefaults());
    expect(o.overrides).toBeUndefined();
    expect(softRoamConfig(o)).toEqual(softRoamConfig({ seed: 2, size: 64, start: 'garden' }));
    const a = foundSoftRoam(o);
    const b = foundSoftRoam({ seed: 2, size: 64, start: 'garden' });
    for (let s = 0; s < 300; s++) { a.stepOnce(); b.stepOnce(); }
    expect(a.digest()).toBe(b.digest());
  });
  it('with kinds off on a plain start the defaults are exactly the plain grown world (no drain, seal, crack, grip), over 300 steps', () => {
    for (const start of ['grown-all', 'grown-lines', 'grown-specks'] as const) {
      const plain = { ...sw, start, kinds: false };
      const o = dialOptions(plain, dialDefaults());
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
        const o = dialOptions({ ...sw, start, kinds }, dialDefaults());
        const want = softRoamConfig({ seed: 2, size: 64, start, kinds });
        const got = softRoamConfig(o);
        if (start === 'garden' || !kinds) expect(got, `${start} kinds ${kinds}`).toEqual(want);
        // A plain start with kinds turned on is the garden's rules on that start's line-up.
        else expect(got).toEqual(softRoamConfig({ seed: 2, size: 64, start: 'garden', kinds: true }));
      }
    }
  });
  it('the garden and the plain start are different worlds on the page', () => {
    const garden = dialOptions({ ...sw, start: 'garden', kinds: true }, dialDefaults());
    const plain = dialOptions({ ...sw, start: 'grown-all', kinds: false }, dialDefaults());
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
    const d = dialDefaults();
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
      expect(dial.idle?.(dialDefaults(), plain), id).toEqual(expect.any(String));
      expect(dial.idle?.(dialDefaults(), sw) ?? null, id).toBeNull();
    }
  });
  it('every dial at its lowest and highest makes a valid world, and the value reaches the config', () => {
    for (const d of SOFT_DIALS) {
      for (const v of [d.min, d.max]) {
        const vals = { ...dialDefaults(), [d.id]: v };
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, v);
        if (d.id === 'birthStore') vals.minStore = Math.min(vals.minStore, v);
        expect(checkDials(sw, vals), `${d.id} = ${v}`).toBeNull();
        const w = foundSoftRoam(dialOptions(sw, vals));
        expect(w.census().cells, `${d.id} = ${v}`).toBeGreaterThan(0);
        for (let s = 0; s < 20; s++) w.stepOnce();
        w.checkInvariants();
        expect(w.census().residual).toBe(0);
      }
    }
    // Each dial's value, at both ends, lands in the config as the dial says (so a dial wired to the wrong field, or ignored, fails here).
    const area = (64 * 64) / (128 * 128);
    const want: Record<string, (v: number) => unknown> = {
      crack: (v) => (v === 0 ? undefined : v), shellBite: (v) => v, shellLeak: (v) => v, drain: (v) => (v === 0 ? undefined : v), seal: (v) => (dialDefaults().drain > 0 ? v : undefined),
      grip: (v) => (v === 0 ? undefined : v), flow: (v) => v / 100, life: (v) => (v === 0 ? undefined : v), birthStore: (v) => v, minStore: (v) => Math.min(v, 150), bite: (v) => v,
      leakSide: (v) => v / 1000, leakCell: (v) => v / 1000, moveCost: (v) => v / 1000, thrustMax: (v) => v, keep: (v) => v, turnMax: (v) => v / 1000,
      kBond: (v) => v, kBrace: (v) => v, kRep: (v) => v, patchFood: (v) => v, patchEvery: (v) => Math.max(1, Math.round(v / area)), patchRadius: (v) => v,
      foodSpread: (v) => (v === 0 ? undefined : v), scentDecayShift: (v) => v, scentIters: (v) => v, scentGain: (v) => v, mut: (v) => v, planMut: (v) => v,
    };
    expect(Object.keys(want).sort()).toEqual(SOFT_DIALS.map((x) => x.id).sort());
    for (const d of SOFT_DIALS) {
      for (const v of [d.min, d.max]) {
        const vals = { ...dialDefaults(), [d.id]: v };
        if (d.id === 'birthStore') vals.minStore = Math.min(vals.minStore, v);
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, v);
        const cfg = softRoamConfig(dialOptions(sw, vals)) as unknown as Record<string, unknown>;
        let expected = want[d.id](v);
        if (d.id === 'minStore') expected = Math.min(v, vals.birthStore);
        expect(cfg[d.id], `${d.id} = ${v}`).toEqual(expected);
      }
    }
    const cfg = softRoamConfig(dialOptions(sw, { ...dialDefaults(), crack: 750, shellBite: 0.3, bite: 5, leakSide: 20, patchEvery: 40, keep: 100, kBond: 120, thrustMax: 300, grip: 64, foodSpread: 0.2, scentDecayShift: 9, scentIters: 2, scentGain: 4, flow: 3, life: 0, mut: 0.04 }));
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
        const vals = { ...dialDefaults(), [d.id]: x };
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, x);
        expect(checkDials(sw, vals), `${d.id} = ${x}`).toBeNull();
      }
    }
  });
  it('an impossible combination says why instead of throwing', () => {
    const stiff = { ...dialDefaults(), kBond: 400, kBrace: 400, kRep: 600, keep: 0 };
    expect(checkDials(sw, stiff)).toMatch(/too stiff/);
    expect(checkDials(sw, dialDefaults())).toBeNull();
  });
  it('every dial has a plain-words label and a line that says what it does', () => {
    for (const d of SOFT_DIALS) {
      expect(d.label).toMatch(/^[A-Z][a-z]/);
      expect(d.label).not.toMatch(/^[a-z]+[A-Z]/);
      expect(d.say(d.def, dialDefaults()).length).toBeGreaterThan(15);
    }
  });

  it('choosing a start asks for one world, the one with its kinds switch set: no half-changed world is ever started', () => {
    // Plain start, kinds off, no hold and a long-reach copy dial: valid; the garden with kinds on then refuses them.
    const from: SoftSwitches = { ...sw, start: 'grown-all', kinds: false };
    const d = { ...dialDefaults(), keep: 0, kRep: 560 };
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
});
