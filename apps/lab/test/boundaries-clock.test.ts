import { describe, expect, it } from 'vitest';
import { advanceBoundaryComparison, BOUNDARY_MAX_TICKS, canAdvanceBoundaryComparison, ticksForFrame } from '../src/boundaries/comparison-clock.ts';
import type { BoundaryWorld } from '../src/boundaries/model.ts';

function clockWorld(extinctionTick: number | null = null): BoundaryWorld & { steps: number } {
  const world = {
    extinctionTick,
    steps: 0,
    step() { this.steps++; },
  };
  return world as unknown as BoundaryWorld & { steps: number };
}

describe('boundary comparison clock', () => {
  it('advances every living world once and leaves extinct fields frozen', () => {
    const worlds = [clockWorld(2), clockWorld(), clockWorld()];
    expect(advanceBoundaryComparison(worlds, 8)).toBe(9);
    expect(worlds.map(world => world.steps)).toEqual([0, 1, 1]);
    expect(advanceBoundaryComparison(worlds, 9)).toBe(10);
    expect(worlds.map(world => world.steps)).toEqual([0, 2, 2]);
  });

  it('holds the comparison age when every field is extinct or the tick cap is reached', () => {
    const dead = [clockWorld(2), clockWorld(5)];
    expect(canAdvanceBoundaryComparison(dead, 5)).toBe(false);
    expect(advanceBoundaryComparison(dead, 5)).toBe(5);
    expect(dead.map(world => world.steps)).toEqual([0, 0]);
    const living = [clockWorld()];
    expect(canAdvanceBoundaryComparison(living, BOUNDARY_MAX_TICKS - 1)).toBe(true);
    expect(canAdvanceBoundaryComparison(living, BOUNDARY_MAX_TICKS)).toBe(false);
    expect(advanceBoundaryComparison(living, BOUNDARY_MAX_TICKS)).toBe(BOUNDARY_MAX_TICKS);
    expect(living[0].steps).toBe(0);
  });

  it('bounds work to eight ticks per frame', () => {
    expect(ticksForFrame(0)).toBe(1);
    expect(ticksForFrame(4)).toBe(4);
    expect(ticksForFrame(80)).toBe(8);
    expect(ticksForFrame(Number.NaN)).toBe(1);
  });

  it('rejects invalid comparison ages', () => {
    expect(() => advanceBoundaryComparison([clockWorld()], -1)).toThrow(RangeError);
    expect(() => advanceBoundaryComparison([clockWorld()], 1.5)).toThrow(RangeError);
    expect(() => advanceBoundaryComparison([clockWorld()], BOUNDARY_MAX_TICKS + 1)).toThrow(RangeError);
  });
});
