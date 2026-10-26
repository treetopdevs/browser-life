import type { ParticleWorld } from './model.ts';

/** Complete a shared tick before yielding; empty worlds retain their last physical state. */
export function advanceComparison(worlds: readonly ParticleWorld[], tick: number, extinctionTicks: (number | null)[]): number {
  if (worlds.every(world => world.particles.length === 0) || tick >= 10_000_000) return tick;
  const nextTick = tick + 1;
  worlds.forEach((world, index) => {
    if (world.particles.length === 0) return;
    world.step();
    if (world.particles.length === 0) extinctionTicks[index] = nextTick;
  });
  return nextTick;
}
