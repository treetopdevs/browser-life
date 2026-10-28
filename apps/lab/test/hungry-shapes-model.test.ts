import { describe, expect, it } from 'vitest';
import {
  DevelopmentWorld, GENOME_PRESETS, RULES, createDevelopmentFixture, createHungryFixture,
  type FoodMode, type HungryWorld,
} from '../src/hungry-shapes/model';
import { DevelopmentWorld as OriginalWorld } from '../src/development/model';

const FOUNDER_TILE = 48 * RULES.width + 48;
const founder = (tile = FOUNDER_TILE) => ({ tile, heading: 0, genome: GENOME_PRESETS[0], age: 0, store: 160 });
const fixture = (mode: FoodMode, food: number, tile = FOUNDER_TILE) =>
  createHungryFixture({ seed: 1201, mutation: true, food, founders: [founder(tile)] }, mode);

function pulseTiles(targets: readonly number[], pulse: number, seed: number, budget: number): number[] {
  const rotation = seed % targets.length;
  return Array.from({ length: budget }, (_, j) => targets[((pulse * budget + j) * 2053 + rotation) % targets.length]);
}

describe('hungry-shapes food schedule', () => {
  it('builds sorted, distinct target masks with the frozen counts', () => {
    const uniform = new DevelopmentWorld(1, false, 'uniform').foodTargets;
    const patches = new DevelopmentWorld(1, false, 'patches').foodTargets;
    expect(uniform).toHaveLength(9_216);
    expect(patches).toHaveLength(972);
    expect(uniform).toEqual(Array.from({ length: 9_216 }, (_, tile) => tile));
    expect([...patches].sort((a, b) => a - b)).toEqual([...patches]);
    expect(new Set(patches).size).toBe(972);
    expect(Object.isFrozen(patches)).toBe(true);
  });

  it.each(['uniform', 'patches'] as const)('%s offers exactly 768 distinct scheduled additions per pulse', (mode) => {
    const world = new DevelopmentWorld(1201, false, mode);
    const { foodTargets: targets } = world;
    const expected0 = pulseTiles(targets, 0, 1201, 768);
    const expected1 = pulseTiles(targets, 1, 1201, 768);
    expect(new Set(expected0).size).toBe(768);
    expect(new Set(expected1).size).toBe(768);

    const selected = new Set([...expected0, ...expected1]);
    const expectedAmounts = new Map<number, number>();
    for (const tile of [...expected0, ...expected1]) expectedAmounts.set(tile, (expectedAmounts.get(tile) ?? 0) + 1);
    let founderTile = 0;
    while (selected.has(founderTile)) founderTile++;
    const actual = createHungryFixture({ seed: 1201, mutation: false, food: 0, founders: [founder(founderTile)] }, mode);
    actual.step(10);
    const food = actual.food;
    for (const tile of targets) {
      expect(food[tile]).toBe(expectedAmounts.get(tile) ?? 0);
    }
    expect(actual.environment).toMatchObject({ mode, pulseBudget: 768, targetCount: targets.length,
      pulses: 2, offered: 1_536, accepted: 1_536, overflow: 0, initialFoodPerTile: 20 });
    expect(actual.environment.accepted).toBe(actual.ledger.supplied);
    expect(actual.environment.offered).toBe(actual.environment.accepted + actual.environment.overflow);
    expect(actual.ledger.residual).toBe(0);
  });

  it('keeps initial reserves and founder state identical across food modes', () => {
    const worlds = (['original', 'uniform', 'patches'] as const).map((mode) => new DevelopmentWorld(733, true, mode));
    expect(worlds.map((world) => world.snapshot())).toEqual([worlds[0].snapshot(), worlds[0].snapshot(), worlds[0].snapshot()]);
    expect(worlds.map((world) => world.food[FOUNDER_TILE])).toEqual([20, 20, 20]);
    expect(worlds.map((world) => world.organisms.map(({ id, family, generation, cells, genome }) =>
      ({ id, family, generation, cells, genome })))).toEqual([worlds[0].organisms.map(({ id, family, generation, cells, genome }) =>
      ({ id, family, generation, cells, genome })), worlds[0].organisms.map(({ id, family, generation, cells, genome }) =>
      ({ id, family, generation, cells, genome })), worlds[0].organisms.map(({ id, family, generation, cells, genome }) =>
      ({ id, family, generation, cells, genome }))]);
  });

  it.each(['uniform', 'patches'] as const)('%s counts cap overflow without changing the matter ledger', (mode) => {
    const targets = pulseTiles(new DevelopmentWorld(1201, false, mode).foodTargets, 0, 1201, 768);
    const selected = new Set(targets);
    let founderTile = 0;
    while (selected.has(founderTile)) founderTile++;
    const world = fixture(mode, 40, founderTile);
    world.step(5);
    expect(world.environment).toMatchObject({ mode, pulses: 1, offered: 768, accepted: 0, overflow: 768 });
    expect(world.environment.accepted).toBe(world.ledger.supplied);
    expect(world.environment.offered).toBe(world.environment.accepted + world.environment.overflow);
    expect(world.ledger.residual).toBe(0);
  });

  it('counts original supply offers and overflow separately while preserving its legacy ledger', () => {
    const world = fixture('original', 40);
    world.step(5);
    expect(world.environment).toMatchObject({ mode: 'original', pulseBudget: 9_216, targetCount: 9_216,
      pulses: 1, offered: 9_216, accepted: world.ledger.supplied, overflow: 9_216 - world.ledger.supplied });
    expect(world.environment.offered).toBe(world.environment.accepted + world.environment.overflow);
    expect(world.ledger.residual).toBe(0);
  });
});

describe('hungry-shapes original-mode compatibility', () => {
  it('matches the untouched DevelopmentWorld census every 20 ticks and snapshots at 0/1000/2000/3000', () => {
    const copied: HungryWorld = new DevelopmentWorld(1201, true, 'original');
    const original = new OriginalWorld(1201, true);
    expect(copied.snapshot()).toEqual(original.snapshot());
    for (let tick = 1; tick <= 3_000; tick++) {
      copied.step();
      original.step();
      if (tick % 20 === 0) expect(copied.census()).toEqual(original.census());
      if (tick === 1_000 || tick === 2_000 || tick === 3_000) expect(copied.snapshot()).toEqual(original.snapshot());
    }
    expect(copied.environment.accepted).toBe(copied.ledger.supplied);
    expect(copied.environment.offered).toBe(copied.environment.accepted + copied.environment.overflow);
  });

  it('supports mode-aware fixtures without changing the original fixture helper contract', () => {
    const spec = { seed: 4, mutation: false, food: 40, founders: [founder()] };
    const copied = createDevelopmentFixture(spec);
    const hungry = createHungryFixture(spec, 'patches');
    expect(copied.snapshot()).toEqual(hungry.snapshot());
    expect(hungry.environment.mode).toBe('patches');
    expect(hungry.environment.targetCount).toBe(972);
    expect(() => new DevelopmentWorld(1, false, 'invalid' as FoodMode)).toThrow();
  });
});
