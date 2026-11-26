import { describe, expect, it } from 'vitest';
import { advanceMotifComparison, MOTIF_TICK_LIMIT } from '../src/particles/motif-clock.ts';

function world(extinctionTick: number | null = null) {
  return { extinctionTick, steps: 0, step() { this.steps++; } };
}

describe('motif comparison clock', () => {
  it('advances every live world by one shared tick and leaves extinct worlds frozen', () => {
    const worlds = [world(), world(4)];
    const tick = advanceMotifComparison(worlds as never[], 0);
    expect(tick).toBe(1);
    expect(worlds.map(item => item.steps)).toEqual([1, 0]);
    expect(advanceMotifComparison(worlds as never[], 1)).toBe(2);
    expect(worlds.map(item => item.steps)).toEqual([2, 0]);
  });

  it('honors the 6000 tick cap without overshooting', () => {
    const worlds = [world()];
    expect(advanceMotifComparison(worlds as never[], MOTIF_TICK_LIMIT - 1)).toBe(MOTIF_TICK_LIMIT);
    expect(worlds[0].steps).toBe(1);
    expect(advanceMotifComparison(worlds as never[], MOTIF_TICK_LIMIT)).toBe(MOTIF_TICK_LIMIT);
    expect(worlds[0].steps).toBe(1);
  });

  it('does not advance if every world is extinct', () => {
    const extinct = world(12);
    expect(advanceMotifComparison([extinct] as never[], 5)).toBe(5);
    expect(extinct.steps).toBe(0);
  });
});
