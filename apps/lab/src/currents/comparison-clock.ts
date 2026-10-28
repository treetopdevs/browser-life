export const CURRENTS_TICK_LIMIT = 6000;

export interface CurrentClockWorld {
  step(count?: number): unknown;
}

/** All four supplied conditions share one physical tick, including after extinction. */
export function advanceCurrentComparison(worlds: readonly CurrentClockWorld[], tick: number, limit = CURRENTS_TICK_LIMIT): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Comparison tick must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Tick limit must be a non-negative safe integer');
  if (tick >= limit || worlds.length === 0) return tick;
  for (const world of worlds) world.step(1);
  return tick + 1;
}
