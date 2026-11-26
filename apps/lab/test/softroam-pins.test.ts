import { describe, expect, it } from 'vitest';
import { foundSoftRoam } from '../src/softroam/view.ts';

// Digests of the worlds as they stood at commit d9a53cdd (2026-11-25), before the seasons chunk. Every later mechanism is optional and
// absent from these starts, so these numbers must never move: a change here means an old world's history changed.
const PINS: [number, 'garden' | 'grown-all', number][] = [
  [1, 'garden', 2936453350],
  [1, 'grown-all', 2598010214],
  [2, 'garden', 1886343843],
  [2, 'grown-all', 1772697730],
];

describe('soft roam: the worlds before seasons are unchanged', () => {
  for (const [seed, start, digest] of PINS) {
    it(`seed ${seed}, ${start}, 64 tiles, 600 steps`, () => {
      const w = foundSoftRoam({ seed, size: 64, start });
      w.advance(600);
      expect(w.digest()).toBe(digest);
    });
  }
});

// The seasons start as it stood at commit b62f26c2 (2026-11-26), before chunk 3 (big bodies): every chunk 3 key is absent from it.
const SEASON_PINS: [number, number][] = [
  [1, 4007348550],
  [2, 2171747202],
];

describe('soft roam: the seasons start is unchanged', () => {
  for (const [seed, digest] of SEASON_PINS) {
    it(`seed ${seed}, seasons, 64 tiles, 1500 steps`, () => {
      const w = foundSoftRoam({ seed, size: 64, start: 'seasons' });
      w.advance(1500);
      expect(w.digest()).toBe(digest);
    });
  }
});

// The bodies start as it stood at commit be4430ac (2026-11-26), before chunk 4: with pace and shellThrust off and no founder drive
// spread it must still make the same history.
describe('soft roam: the bodies start with chunk 4 switched off is chunk 3', () => {
  it('seed 2, bodies, 64 tiles, 800 steps', () => {
    const w = foundSoftRoam({ seed: 2, size: 64, start: 'bodies', pace: false as unknown as number, shellThrust: false as unknown as number, driveSpread: 1 });
    w.advance(800);
    expect(w.digest()).toBe(3291049832);
  });
});
