import { describe, expect, it } from 'vitest';
import { dialDefaults, dialOptions, fixDial, ROAM_DIALS, type RoamSwitches } from '../src/roam/dials.ts';
import { foundRoam, roamConfig } from '../src/roam/view.ts';

const sw: RoamSwitches = { seed: 2, size: 64, start: 'grown-all', compost: true, kinds: true, toughness: false };

describe('roam page dials', () => {
  it('at their defaults give the same world as the page before dials (half-bite shells, crack 2,000)', () => {
    const before = { seed: 2, size: 64, start: 'grown-all' as const, mut: 0.02, drain: 2, flow: 0.015625, life: 2000, compost: true, kinds: true, crack: 2000, toughness: false, shellBite: 0.5 };
    const a = foundRoam(dialOptions(sw, dialDefaults()));
    const b = foundRoam(before);
    for (let s = 0; s < 400; s++) { a.stepOnce(); b.stepOnce(); }
    expect(a.digest()).toBe(b.digest());
    expect(dialOptions(sw, dialDefaults()).overrides).toBeUndefined();
  });
  it('every dial at its lowest and highest makes a valid world, and the value reaches the config', () => {
    for (const d of ROAM_DIALS) {
      for (const v of [d.min, d.max]) {
        const vals = { ...dialDefaults(), [d.id]: v };
        if (d.id === 'minStore') vals.birthStore = Math.max(vals.birthStore, v);
        if (d.id === 'birthStore') vals.minStore = Math.min(vals.minStore, v);
        const w = foundRoam(dialOptions(sw, vals));
        for (let s = 0; s < 20; s++) w.stepOnce();
        expect(w.census().residual).toBe(0);
      }
    }
    const cfg = roamConfig(dialOptions(sw, { ...dialDefaults(), crack: 750, shellBite: 0.3, bite: 5, leakSide: 20, patchEvery: 40 }));
    expect(cfg.crack).toBe(750);
    expect(cfg.shellBite).toBe(0.3);
    expect(cfg.bite).toBe(5);
    expect(cfg.leakSide).toBe(0.02);
    expect(cfg.patchEvery).toBe(160); // 40 in a 128 arena is 160 in a 64 one (a quarter of the area)
  });
  it('any value typed or linked becomes one the world accepts, and store limits that cross are held apart', () => {
    for (const d of ROAM_DIALS) {
      for (const v of [Number.NaN, -1e9, 1e9, d.min + 1e-6, (d.min + d.max) / 3, d.max - 1e-6, 1e-7, 1.5]) {
        const vals = { ...dialDefaults(), [d.id]: fixDial(d, v) };
        const w = foundRoam(dialOptions(sw, vals));
        w.stepOnce();
        expect(w.census().residual).toBe(0);
      }
    }
    const crossed = roamConfig(dialOptions(sw, { ...dialDefaults(), birthStore: 10, minStore: 16 }));
    expect(crossed.minStore).toBe(10);
    expect(() => foundRoam(dialOptions(sw, { ...dialDefaults(), birthStore: 10 }))).not.toThrow();
    expect(() => foundRoam(dialOptions(sw, { ...dialDefaults(), minStore: 150 }))).not.toThrow();
  });
  it('turns off what its switches turn off', () => {
    const cfg = roamConfig(dialOptions(sw, { ...dialDefaults(), flow: 0 }));
    expect(cfg.flow).toBeUndefined();
    expect(cfg.kinds).toBeUndefined();
    expect(cfg.crack).toBeUndefined();
    expect(cfg.shellBite).toBeUndefined();
    const noTouch = roamConfig(dialOptions(sw, { ...dialDefaults(), drain: 0, seal: 300 }));
    expect(noTouch.drain).toBeUndefined();
    expect(noTouch.seal).toBeUndefined();
    expect(noTouch.crack).toBeUndefined();
  });
});
