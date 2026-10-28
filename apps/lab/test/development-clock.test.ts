import { describe, expect, it } from 'vitest';
import { advanceDevelopmentComparison, DEVELOPMENT_TICK_LIMIT } from '../src/development/comparison-clock.ts';

function world(extinctionTick: number | null = null) {
  return { extinctionTick, steps: 0, step() { this.steps++; } };
}

describe('development comparison clock', () => {
  it('advances both live worlds and leaves an extinct world frozen', () => {
    const worlds = [world(), world(4)];
    expect(advanceDevelopmentComparison(worlds, 0)).toBe(1);
    expect(worlds.map(item => item.steps)).toEqual([1, 0]);
    expect(advanceDevelopmentComparison(worlds, 1)).toBe(2);
    expect(worlds.map(item => item.steps)).toEqual([2, 0]);
  });

  it('stops at the shared 6000 tick limit', () => {
    const item = world();
    expect(advanceDevelopmentComparison([item], DEVELOPMENT_TICK_LIMIT - 1)).toBe(DEVELOPMENT_TICK_LIMIT);
    expect(advanceDevelopmentComparison([item], DEVELOPMENT_TICK_LIMIT)).toBe(DEVELOPMENT_TICK_LIMIT);
    expect(item.steps).toBe(1);
  });

  it('freezes when all worlds are extinct', () => {
    const worlds = [world(7), world(9)];
    expect(advanceDevelopmentComparison(worlds, 10)).toBe(10);
    expect(worlds.map(item => item.steps)).toEqual([0, 0]);
  });

  it('rejects invalid clocks', () => {
    expect(() => advanceDevelopmentComparison([], -1)).toThrow(/non-negative/);
    expect(() => advanceDevelopmentComparison([], 0, 1.5)).toThrow(/non-negative/);
  });
});
