import { describe, expect, it } from 'vitest';
import { nextPairedEvidenceTick } from '../../../tools/particles/explore-motifs.ts';

describe('motif evidence paired clock', () => {
  it('visits every tick between comparison samples without stalling off-cadence', () => {
    const visited: number[] = [];
    let tick = 1500;
    while (tick < 1600) {
      tick = nextPairedEvidenceTick(tick, 1600);
      visited.push(tick);
    }
    expect(visited).toHaveLength(100);
    expect(visited).toEqual(Array.from({ length: 100 }, (_, i) => 1501 + i));
  });

  it('rejects attempts to advance beyond the fixed comparison window', () => {
    expect(() => nextPairedEvidenceTick(1600, 1600)).toThrow('must advance');
  });
});
