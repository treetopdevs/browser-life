import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { histogram, laterVsEarlier, shade, type PairView } from '../src/opponents/archive/render.ts';

const pair = (a: string, b: string, mean: number | null, over: Partial<PairView['summary']> = {}): PairView => ({
  a, b, summary: { complete: 10, excluded: 0, blocks: 10, mean, interval: mean === null ? null : { lo: mean - 0.02, hi: mean + 0.02 }, status: mean === null ? 'uninformative' : 'informative', edge: null, ...over },
});
const ids = ['x0', 'x1', 'x2'];

describe('archive page view helpers', () => {
  it('matrix numbers equal the table: rows are later snapshots, cells are the later share', () => {
    const m = laterVsEarlier(ids, [pair('x0', 'x1', 0.3), pair('x0', 'x2', 0.4, { excluded: 2, blocks: 10, complete: 8 }), pair('x1', 'x2', 0.45, { edge: 'B>A' })]);
    expect(m[1][0].value).toBeCloseTo(0.7);
    expect(m[1][0].text).toContain('0.70');
    expect(m[2][0].value).toBeCloseTo(0.6);
    expect(m[2][0].text).toContain('2 of 10 blocks excluded');
    expect(m[2][1].text).toContain('confirmed edge');
    expect(m[0][1].state).toBe('empty');
    expect(m[1][1].state).toBe('self');
  });
  it('uninformative is its own state and is not shaded as a tie', () => {
    const m = laterVsEarlier(ids, [pair('x0', 'x1', null, { complete: 3, excluded: 7 }), pair('x0', 'x2', 0.5), pair('x1', 'x2', 0.2)]);
    expect(m[1][0].state).toBe('uninformative');
    expect(m[1][0].text).toContain('uninformative');
    expect(m[1][0].text).toContain('7 of 10 blocks excluded');
    expect(m[1][0].value).toBeNull();
    expect(shade(m[1][0].value)).toBe('transparent');
  });
  it('the histogram observed marker lands in the bin that holds the observed value', () => {
    const vals = [-0.1, -0.05, 0, 0, 0.05, 0.1];
    const h = histogram(vals, 0.1, 6);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(vals.length);
    expect(h.observedBin).toBe(5);
    expect(histogram(vals, null).observedBin).toBe(-1);
  });
  const ev = new URL('../../../docs/historical-opponents-archive-2026-11-02/evidence.json', import.meta.url);
  it.skipIf(!existsSync(ev))('the marker matches the saved evidence and the page names the synthetic fixtures', () => {
    const p = JSON.parse(readFileSync(ev, 'utf8'));
    for (const s of p.summary.sources) {
      const a = s.tournament.analysis, h = histogram(s.tournament.permuted, a.rank.observed);
      expect(h.counts.reduce((x: number, y: number) => x + y, 0)).toBe(s.tournament.permuted.length);
      const atLeast = s.tournament.permuted.filter((v: number) => v >= a.rank.observed - 1e-8).length / a.rank.perms;
      expect(atLeast).toBeCloseTo(a.rank.rDir, 6);
      expect(h.counts[h.observedBin]).toBeGreaterThan(0);
    }
    const synthetic = p.summary.fixtures.filter((f: { synthetic: boolean }) => f.synthetic).map((f: { id: string }) => f.id);
    expect(synthetic).toEqual(expect.arrayContaining(['cycle-fools-naive', 'long-cycle-fools-naive', 'vigour-only']));
    for (const f of p.summary.fixtures) expect(f.naive.fraction).toBeGreaterThanOrEqual(0);
    expect(p.summary.naiveVersusSealed.length).toBe(p.summary.fixtures.length + p.summary.sources.length);
  });
});
