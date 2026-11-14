/**
 * Does the newest model (food-schedule-769) reproduce each screen's own model?
 * Always-on version: ticks 0, 500 and 1000 for every screen, arm and seed.
 * The full-horizon version is food-bands-parity-full.test.ts (same code, final tick).
 */
import { describe, expect, it } from 'vitest';
import { SCREENS, getScreen } from '../src/food-bands/screens.ts';
import { loadModel, makeWorld, NEWEST_MODEL, PARITY, resolveFromMeasurement, resolveModelKey, type ParityRecord, type WorldApi } from '../src/food-bands/models.ts';
import { differingRules, measureScreen, normalisedSnapshotHash, parityTicks, sameDynamics, stateDigest } from './support/food-bands-parity-lib.ts';

describe('food-bands model parity (ticks 0, 500, 1000)', () => {
  it.each(SCREENS.map(s => s.id))('dynamics and observation parity for %s', async id => {
    const screen = getScreen(id)!;
    const { cases, record } = await measureScreen(screen, parityTicks(screen, 'short'));
    expect(cases.length).toBe(screen.arms.length * (1 + screen.seeds.replication.length) * 3);
    expect(cases.filter(c => !c.dynamics), 'dynamics differences').toEqual([]);
    // the checked-in table equals the measurement for the fields this version of the test can see
    expect(PARITY[id]!.ownKey).toBe(record.ownKey);
    expect(PARITY[id]!.dynamics).toBe(record.dynamics);
    expect(PARITY[id]!.differingRules).toEqual(record.differingRules);
    expect(PARITY[id]!.observation).toBe(record.observation);
    expect(PARITY[id]!.resolvedKey).toBe(record.resolvedKey);
  });

  it('uniform-food always resolves to hungry-shapes', () => {
    expect(resolveModelKey('uniform-food')).toBe('hungry-shapes');
    expect(PARITY['uniform-food']!.resolvedKey).toBe('hungry-shapes');
    expect(resolveFromMeasurement('uniform-food', 'hungry-shapes', true, true)).toBe('hungry-shapes');
  });

  it('the PARITY table has exactly the screens, and resolution follows the stated rule', () => {
    expect(Object.keys(PARITY).sort()).toEqual(SCREENS.map(s => s.id).sort());
    for (const screen of SCREENS) {
      const record = PARITY[screen.id]!;
      expect(record.resolvedKey).toBe(resolveFromMeasurement(screen.id, record.ownKey, record.dynamics, record.differingRules.length === 0));
      expect(record.ownKey).toBe(screen.ownModel);
    }
  });

  it('a false predicate resolves to the own model, never the newest', () => {
    const lookup = (dynamics: boolean, rulesEqual: boolean) => resolveFromMeasurement('moving-food', 'moving-food', dynamics, rulesEqual);
    expect(lookup(true, true)).toBe(NEWEST_MODEL);
    expect(lookup(false, true)).toBe('moving-food');
    expect(lookup(true, false)).toBe('moving-food');
    const fake: Record<string, ParityRecord> = { x: { ownKey: 'split-food', dynamics: false, observation: false, differingRules: [], resolvedKey: 'split-food' } };
    expect(resolveModelKey('x', fake)).toBe('split-food');
  });

  it('lists RULES differences instead of hiding them', async () => {
    const newest = await loadModel(NEWEST_MODEL);
    const diffs = new Map<string, string[]>();
    for (const screen of SCREENS) diffs.set(screen.id, differingRules(await loadModel(screen.ownModel), newest));
    expect(diffs.get('uniform-food')).toEqual(['maxHistory: 301/451']);
    for (const [id, list] of diffs) if (id !== 'uniform-food') expect(list, id).toEqual([]);
  });

  it('negative control: one changed food byte fails the dynamics predicate', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const a = makeWorld(mod, 1202, 'split-band');
    const b = makeWorld(mod, 1202, 'split-band');
    a.step(200); b.step(200);
    expect(sameDynamics(stateDigest(a), stateDigest(b))).toBe(true);
    // Perturb through the model's own private array, the way a rule change would.
    const food = (b as unknown as { _food: Uint8Array })._food;
    food[food.findIndex(v => v > 0 && v < 40)] += 1;
    expect(sameDynamics(stateDigest(a), stateDigest(b))).toBe(false);
    expect(normalisedSnapshotHash(a)).not.toBe(normalisedSnapshotHash(b));
  });

  it('the host runtime label is the only thing normalised', async () => {
    const mod = await loadModel(NEWEST_MODEL);
    const world = makeWorld(mod, 1201, 'uniform');
    world.step(200);
    const base = normalisedSnapshotHash(world);
    const wrap = (change: (snapshot: Record<string, unknown>) => Record<string, unknown>): WorldApi => ({
      ...world, environment: world.environment, snapshot: () => change({ ...world.snapshot() }),
    }) as unknown as WorldApi;
    // a different runtime label alone: equal
    expect(normalisedSnapshotHash(wrap(s => ({ ...s, runtime: 'Browser 99' })))).toBe(base);
    // anything else, however small: different
    const snapshot = world.snapshot() as Record<string, any>;
    expect(snapshot.history.length).toBeGreaterThan(1);
    expect(snapshot.lineage.length).toBeGreaterThan(1);
    expect(normalisedSnapshotHash(wrap(s => ({ ...s, history: (s.history as unknown[]).slice(1) })))).not.toBe(base);
    expect(normalisedSnapshotHash(wrap(s => ({ ...s, lineage: (s.lineage as unknown[]).slice(1) })))).not.toBe(base);
    expect(normalisedSnapshotHash(wrap(s => ({ ...s, tick: (s.tick as number) + 1 })))).not.toBe(base);
    expect(normalisedSnapshotHash(wrap(s => ({ ...s, seed: 1 })))).not.toBe(base);
  });
});
