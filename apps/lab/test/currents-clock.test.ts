import { describe, expect, it } from 'vitest';
import { advanceCurrentComparison, CURRENTS_TICK_LIMIT } from '../src/currents/comparison-clock.ts';

describe('currents comparison clock', () => {
  it('advances every tank after biomass extinction', () => {
    const worlds = [
      { extinctionTick: 3, tick: 3, nutrient: 9, step() { this.tick++; this.nutrient--; } },
      { extinctionTick: null, tick: 3, nutrient: 9, step() { this.tick++; this.nutrient--; } },
      { extinctionTick: 1, tick: 3, nutrient: 9, step() { this.tick++; this.nutrient--; } },
      { extinctionTick: null, tick: 3, nutrient: 9, step() { this.tick++; this.nutrient--; } },
    ];
    expect(advanceCurrentComparison(worlds, 3)).toBe(4);
    expect(worlds.map(world => [world.tick, world.nutrient])).toEqual([[4, 8], [4, 8], [4, 8], [4, 8]]);
  });

  it('holds every tank at the common 6000 tick limit', () => {
    let steps = 0;
    const worlds = Array.from({ length: 4 }, () => ({ step() { steps++; } }));
    expect(advanceCurrentComparison(worlds, CURRENTS_TICK_LIMIT - 1)).toBe(CURRENTS_TICK_LIMIT);
    expect(advanceCurrentComparison(worlds, CURRENTS_TICK_LIMIT)).toBe(CURRENTS_TICK_LIMIT);
    expect(steps).toBe(4);
  });

  it('validates tick values and preserves an empty clock', () => {
    expect(advanceCurrentComparison([], 0)).toBe(0);
    expect(() => advanceCurrentComparison([], -1)).toThrow();
    expect(() => advanceCurrentComparison([], 0, -1)).toThrow();
  });
});
