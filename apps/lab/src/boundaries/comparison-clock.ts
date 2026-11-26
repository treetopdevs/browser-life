import type { BoundaryWorld } from './model.ts';

export const BOUNDARY_MAX_TICKS = 100_000;
export const BOUNDARY_MAX_TICKS_PER_FRAME = 8;

export function canAdvanceBoundaryComparison(worlds: readonly BoundaryWorld[], comparisonTick: number): boolean {
  return comparisonTick < BOUNDARY_MAX_TICKS && worlds.some(world => world.extinctionTick === null);
}

/** Advance each living field once, then advance their shared comparison age. */
export function advanceBoundaryComparison(
  worlds: readonly BoundaryWorld[],
  comparisonTick: number,
): number {
  if (!Number.isInteger(comparisonTick) || comparisonTick < 0 || comparisonTick > BOUNDARY_MAX_TICKS) {
    throw new RangeError('comparisonTick must be an integer between 0 and 100000');
  }
  if (!canAdvanceBoundaryComparison(worlds, comparisonTick)) return comparisonTick;
  const living = worlds.filter(world => world.extinctionTick === null);
  if (living.length === 0) return comparisonTick;
  for (const world of living) world.step();
  return comparisonTick + 1;
}

/** Bound work in one animation frame even when the requested pace is high. */
export function ticksForFrame(requested: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.max(1, Math.min(BOUNDARY_MAX_TICKS_PER_FRAME, Math.floor(requested)));
}
