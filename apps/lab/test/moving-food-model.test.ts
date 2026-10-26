import { describe, expect, it } from 'vitest';
import {
  GENOME_PRESETS, HungryWorld, RULES, createHungryFixture, isMovingBandTile, movingBandGeometry,
  movingBandLeftEdge, movingBandPulseTargetTile, movingBandTargetTile,
} from '../src/moving-food/model';

const founder = { tile: 48 * RULES.width + 90, heading: 0 as const, genome: GENOME_PRESETS[0]!, age: 0, store: 160 };

describe('moving-food geometry and pulse schedule', () => {
  it('uses the frozen eastward stripe position at boundary ticks and wraps', () => {
    expect([0, 5, 45, 49, 50, 55, 2_995, 3_000, 4_800].map(movingBandLeftEdge))
      .toEqual([0, 0, 0, 0, 1, 1, 59, 60, 0]);
    for (const [tick, left] of [[0, 0], [50, 1], [2_995, 59], [3_000, 60], [4_800, 0]] as const) {
      const geometry = movingBandGeometry(tick);
      expect(geometry).toMatchObject({ left, width: 48 });
      expect(geometry.tiles).toHaveLength(4_608);
      expect(new Set(geometry.tiles).size).toBe(4_608);
      expect(geometry.tiles[0]).toBe(left);
      expect(geometry.tiles[47]).toBe((left + 47) % 96);
      expect(geometry.tiles[48]).toBe(96 + left);
      expect(geometry.tiles.every((tile) => isMovingBandTile(tile, tick))).toBe(true);
    }
    expect(movingBandTargetTile(0, 50)).toBe(1);
    expect(movingBandTargetTile(47, 50)).toBe(48);
    expect(movingBandTargetTile(48, 50)).toBe(97);
    expect(movingBandGeometry(2_995).tiles[47]).toBe(10);
    expect(movingBandGeometry(3_000).tiles[47]).toBe(11);
  });

  it('covers all 4,608 fixed-left targets in six scheduled 768-slot pulses', () => {
    const targets = Array.from({ length: 6 }, (_, pulse) => Array.from({ length: 768 }, (_, slot) =>
      movingBandPulseTargetTile(pulse, slot, 1_201, 5 * (pulse + 1)))).flat();
    expect(new Set(targets).size).toBe(4_608);
    expect([...targets].sort((a, b) => a - b)).toEqual([...movingBandGeometry(5).tiles].sort((a, b) => a - b));
    expect(() => movingBandPulseTargetTile(0, 768, 1_201, 5)).toThrow(/slot/);
  });

  it('preserves identical initial biology and food while keeping uniform environment keys exact', () => {
    const uniform = new HungryWorld(1_201, true, 'uniform');
    const moving = new HungryWorld(1_201, true, 'moving-band');
    expect(moving.snapshot()).toEqual(uniform.snapshot());
    expect(moving.food).toEqual(uniform.food);
    expect(Object.keys(uniform.environment).sort()).toEqual([
      'version', 'mode', 'pulseBudget', 'targetCount', 'pulses', 'offered', 'accepted', 'overflow', 'initialFoodPerTile',
    ].sort());
    expect(moving.environment).toMatchObject({ mode: 'moving-band', targetCount: 4_608, bandLeft: 0, bandWidth: 48 });
    expect(uniform.environment).toMatchObject({ mode: 'uniform', targetCount: 9_216 });
  });

  it('offers 768 additions at the first moving pulse and accounts for acceptance plus overflow', () => {
    const world = createHungryFixture({ seed: 1_201, mutation: false, food: 0, founders: [founder] }, 'moving-band');
    world.step(5);
    expect(world.environment).toMatchObject({ mode: 'moving-band', pulses: 1, offered: 768, accepted: 768, overflow: 0,
      targetCount: 4_608, bandLeft: 0, bandWidth: 48 });
    expect(world.environment.accepted).toBe(world.ledger.supplied);
    expect(world.environment.offered).toBe(world.environment.accepted + world.environment.overflow);
    expect(world.ledger.residual).toBe(0);
    expect(world.food.reduce((sum, value) => sum + value, 0)).toBe(768);
  });

  it('keeps actual stripe food increments in columns 0–47 through tick 45', () => {
    const world = createHungryFixture({ seed: 1_201, mutation: false, food: 0, founders: [founder] }, 'moving-band');
    world.step(45);
    expect(world.environment.bandLeft).toBe(0);
    const additions = world.food.map((n) => n);
    expect(additions.reduce((sum, n) => sum + n, 0)).toBe(9 * 768);
    expect(additions.every((n, tile) => n === 0 || tile % 96 < 48)).toBe(true);
  });

  it('hands the world over to columns 1–48 on the tick-50 pulse', () => {
    const world = createHungryFixture({ seed: 1_201, mutation: false, food: 0, founders: [founder] }, 'moving-band');
    world.step(45); const before = world.food.slice();
    world.step(5);
    const additions = world.food.map((n, tile) => n - before[tile]!);
    expect(world.environment).toMatchObject({ pulses: 10, offered: 10 * 768, bandLeft: 1 });
    expect(additions.reduce((sum, n) => sum + n, 0)).toBe(768);
    expect(additions.every((n, tile) => n === 0 || (tile % 96 >= 1 && tile % 96 <= 48))).toBe(true);
    expect(additions.some((n, tile) => tile % 96 === 48 && n > 0)).toBe(true);
    expect(world.ledger.residual).toBe(0);
  });

  it('matches every real food increment to the helper for twelve pulses and conserves all offers', () => {
    const seed = 1_201; const world = createHungryFixture({ seed, mutation: false, food: 0, founders: [founder] }, 'moving-band');
    for (let pulse = 0; pulse < 12; pulse++) {
      const before = world.food.slice(); world.step(5);
      const expected = new Uint16Array(RULES.tileCount);
      for (let slot = 0; slot < 768; slot++) expected[movingBandPulseTargetTile(pulse, slot, seed, 5 * (pulse + 1))]++;
      for (let tile = 0; tile < RULES.tileCount; tile++) expect(world.food[tile]! - before[tile]!).toBe(expected[tile]);
      expect(world.environment.offered).toBe(768 * (pulse + 1));
      expect(world.environment.accepted + world.environment.overflow).toBe(world.environment.offered);
      expect(world.ledger.residual).toBe(0);
    }
  });
});
