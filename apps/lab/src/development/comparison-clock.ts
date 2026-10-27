export const DEVELOPMENT_TICK_LIMIT = 6000;

export interface DevelopmentClockWorld {
  readonly extinctionTick: number | null;
  step(count?: number): unknown;
}

/** Advance both live worlds by exactly one tick, freezing each at its own extinction. */
export function advanceDevelopmentComparison(
  worlds: readonly DevelopmentClockWorld[],
  comparisonTick: number,
  limit = DEVELOPMENT_TICK_LIMIT,
): number {
  if (!Number.isSafeInteger(comparisonTick) || comparisonTick < 0) throw new Error('Comparison tick must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Tick limit must be a non-negative safe integer');
  if (comparisonTick >= limit || worlds.length === 0 || worlds.every(world => world.extinctionTick !== null)) return comparisonTick;
  for (const world of worlds) if (world.extinctionTick === null) world.step(1);
  return comparisonTick + 1;
}
