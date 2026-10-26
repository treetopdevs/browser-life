export const MATTER_TICK_LIMIT = 6000;

export interface MatterClockWorld {
  readonly extinctionTick: number | null;
  step(count?: number): unknown;
}

/** Advance every tank together. Extinction is an observation, never a clock condition. */
export function advanceMatterComparison(
  worlds: readonly MatterClockWorld[],
  comparisonTick: number,
  limit = MATTER_TICK_LIMIT,
): number {
  if (!Number.isSafeInteger(comparisonTick) || comparisonTick < 0) throw new Error('Comparison tick must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Tick limit must be a non-negative safe integer');
  if (comparisonTick >= limit || worlds.length === 0) return comparisonTick;
  for (const world of worlds) world.step(1);
  return comparisonTick + 1;
}
