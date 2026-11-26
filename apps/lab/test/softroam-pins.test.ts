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
