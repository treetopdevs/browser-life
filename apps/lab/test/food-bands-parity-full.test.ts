/**
 * Full-horizon parity: ticks 0, 500 and each screen's final tick (3,000, 6,000 or 9,000) for every
 * screen, arm and seed, newest model against the screen's own model. Measured wall time on the
 * development Mac: about 6 seconds in total (stepping is cheap), so this file is always on.
 * Run it alone with: pnpm vitest run apps/lab/test/food-bands-parity-full.test.ts
 */
import { describe, expect, it } from 'vitest';
import { SCREENS, getScreen } from '../src/food-bands/screens.ts';
import { PARITY } from '../src/food-bands/models.ts';
import { measureScreen, parityTicks } from './support/food-bands-parity-lib.ts';

describe('food-bands model parity at the final tick', () => {
  it.each(SCREENS.map(s => s.id))('full horizon parity for %s', async id => {
    const screen = getScreen(id)!;
    const ticks = parityTicks(screen, 'full');
    expect(ticks.at(-1)).toBe(screen.horizon);
    const { cases, record } = await measureScreen(screen, ticks);
    expect(cases.length).toBe(screen.arms.length * (1 + screen.seeds.replication.length) * 3);
    expect(cases.filter(c => !c.dynamics), 'dynamics differences').toEqual([]);
    expect(record).toEqual(PARITY[id]);
  }, 120_000);
});
