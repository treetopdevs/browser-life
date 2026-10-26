/** The clock deliberately depends only on the operations it performs. */
export interface ComparisonWorld {
  readonly particles: readonly unknown[];
  step(): void;
}

/** Complete a shared tick before yielding; empty worlds retain their last physical state. */
export function advanceComparison(worlds: readonly ComparisonWorld[], tick: number, extinctionTicks: (number | null)[]): number {
  if (worlds.every(world => world.particles.length === 0) || tick >= 10_000_000) return tick;
  const nextTick = tick + 1;
  worlds.forEach((world, index) => {
    if (world.particles.length === 0) return;
    world.step();
    if (world.particles.length === 0) extinctionTicks[index] = nextTick;
  });
  return nextTick;
}
