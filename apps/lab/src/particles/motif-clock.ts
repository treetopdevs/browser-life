import type { MotifWorld } from './motifs.ts';

export const MOTIF_TICK_LIMIT = 6000;

/** Advance each live world once under one shared comparison tick. Extinction belongs to MotifWorld. */
export function advanceMotifComparison(
  worlds: readonly MotifWorld[],
  comparisonTick: number,
  limit = MOTIF_TICK_LIMIT,
): number {
  if (!Number.isSafeInteger(comparisonTick) || comparisonTick < 0) throw new Error('Comparison tick must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Tick limit must be a non-negative safe integer');
  if (comparisonTick >= limit || worlds.every(world => world.extinctionTick !== null)) return comparisonTick;
  for (const world of worlds) if (world.extinctionTick === null) world.step(1);
  return comparisonTick + 1;
}
