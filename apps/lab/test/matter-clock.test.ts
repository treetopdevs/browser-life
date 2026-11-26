import { describe, expect, it } from 'vitest';
import { advanceMatterComparison, MATTER_TICK_LIMIT } from '../src/matter/comparison-clock.ts';

describe('matter comparison clock', () => {
  it('advances every tank even when biomass has gone extinct', () => {
    const physical = [
      { extinctionTick: 4, tick: 4, nutrient: 12, sediment: 0, step() { this.tick++; this.nutrient--; this.sediment++; } },
      { extinctionTick: null, tick: 4, nutrient: 12, sediment: 0, step() { this.tick++; this.nutrient--; this.sediment++; } },
      { extinctionTick: null, tick: 4, nutrient: 12, sediment: 0, step() { this.tick++; this.nutrient--; this.sediment++; } },
    ];

    expect(advanceMatterComparison(physical, 4)).toBe(5);
    expect(physical.map(world => [world.tick, world.nutrient, world.sediment])).toEqual([[5, 11, 1], [5, 11, 1], [5, 11, 1]]);
  });

  it('stops only at the shared 6000-tick horizon', () => {
    let steps = 0;
    const world = { extinctionTick: 0, step: () => { steps++; } };
    expect(advanceMatterComparison([world], MATTER_TICK_LIMIT - 1)).toBe(MATTER_TICK_LIMIT);
    expect(steps).toBe(1);
    expect(advanceMatterComparison([world], MATTER_TICK_LIMIT)).toBe(MATTER_TICK_LIMIT);
    expect(steps).toBe(1);
  });

  it('validates clock values and does not step an empty comparison', () => {
    expect(advanceMatterComparison([], 0)).toBe(0);
    expect(() => advanceMatterComparison([], -1)).toThrow();
    expect(() => advanceMatterComparison([], 0, -1)).toThrow();
  });
});
