import { describe, expect, it } from 'vitest';
import {
  HungryWorld, MOVING_BAND_TARGET_COUNT, MOVING_BAND_WIDTH, RULES, isMovingBandTile,
  isStationaryBandTile, movingBandGeometry, movingBandLeftEdge, stationaryBandGeometry,
} from '../../apps/lab/src/stationary-food/model.ts';

type Mode = 'moving-band' | 'stationary-band';

function comparableEnvironment(mode: Mode, world: HungryWorld) {
  const { mode: _mode, ...rest } = world.environment;
  return rest;
}

describe('stationary-food mode wiring', () => {
  it('uses the tick-zero moving-band target mapping and stays at left edge zero through wrap', () => {
    const fixed = stationaryBandGeometry();
    expect(fixed.left).toBe(0);
    expect(fixed.width).toBe(48);
    expect(fixed.tiles).toHaveLength(4_608);
    expect(new Set(fixed.tiles).size).toBe(4_608);
    expect(fixed.tiles).toEqual(movingBandGeometry(0).tiles);
    expect(fixed.tiles.every((tile) => tile % RULES.width < 48)).toBe(true);
    expect(isStationaryBandTile(0)).toBe(true);
    expect(isStationaryBandTile(47)).toBe(true);
    expect(isStationaryBandTile(48)).toBe(false);
    expect(isStationaryBandTile(95)).toBe(false);

    const stationary = new HungryWorld(1202, true, 'stationary-band');
    const moving = new HungryWorld(1202, true, 'moving-band');
    for (const world of [stationary, moving]) {
      expect(world.environment.targetCount).toBe(MOVING_BAND_TARGET_COUNT);
      expect(world.environment.bandWidth).toBe(MOVING_BAND_WIDTH);
    }
    expect(stationary.environment.bandLeft).toBe(0);
    expect(stationary.foodTargets).toEqual(fixed.tiles);
    expect(movingBandLeftEdge(4_799)).toBe(95);
    expect(movingBandLeftEdge(4_800)).toBe(0);
    expect(isMovingBandTile(0, 4_800)).toBe(true);
    expect(isStationaryBandTile(0)).toBe(true);
    expect(stationaryBandGeometry().left).toBe(0);
    expect(stationaryBandGeometry().tiles).toEqual(fixed.tiles);
    expect(movingBandGeometry(4_800).tiles).toEqual(fixed.tiles);
    expect(movingBandGeometry(4_799).left).toBe(95);
  });

  it('keeps every snapshot, food byte, and non-mode environment field equal through tick 49', () => {
    const moving = new HungryWorld(1202, true, 'moving-band');
    const stationary = new HungryWorld(1202, true, 'stationary-band');
    expect(moving.foodTargets).toEqual(stationary.foodTargets);
    for (let tick = 1; tick <= 49; tick++) {
      moving.step();
      stationary.step();
      expect(stationary.snapshot(), `snapshot tick ${tick}`).toEqual(moving.snapshot());
      expect(stationary.food, `food bytes tick ${tick}`).toEqual(moving.food);
      expect(comparableEnvironment('moving-band', moving), `environment tick ${tick}`).toEqual(comparableEnvironment('stationary-band', stationary));
      expect(stationary.environment.bandLeft).toBe(0);
      if (tick === 45) {
        expect(stationary.environment.pulses).toBe(9);
        expect(stationary.environment.offered).toBe(9 * 768);
      }
    }
    expect(moving.foodTargets).toEqual(stationary.foodTargets);
    moving.step();
    stationary.step();
    expect(moving.tick).toBe(50);
    expect(stationary.tick).toBe(50);
    expect(moving.environment.offered).toBe(stationary.environment.offered);
    expect(moving.environment.offered).toBe(10 * 768);
    expect(moving.environment.bandLeft).toBe(1);
    expect(stationary.environment.bandLeft).toBe(0);
    expect(moving.foodTargets).not.toEqual(stationary.foodTargets);
    expect(moving.food).not.toEqual(stationary.food);
    expect(stationary.foodTargets).toEqual(stationaryBandGeometry().tiles);
  });
});
