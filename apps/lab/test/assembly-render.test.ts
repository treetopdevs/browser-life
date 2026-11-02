import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { COLUMNS, accText, esc, rangeText, ratText, tableRow, verdictRows, type ClassView, type VerdictView } from '../src/assembly/render.ts';

const rep = (shared: number, ratio: Rat) => ({
  replicate: 0, sha256: 'x',
  primary: {
    objects: 20, spans: 0, large: 0,
    construction: { meanA: { num: 4, den: 1 }, reuseRatio: ratio, sharedBound: shared },
    copies: { T: { maxCopies: 20, copyWeightedConstruction: 76, classes: 1 }, D4: { classes: 1 } },
    equiv: { classesT: 1, classesD4: 1, classesD4on8: 1, spread: 0 },
    baselines: { occupied: 240, deflate: 300, objectCount: 20 },
  },
});
type Rat = { num: number; den: number };

it('formats numbers and ranges', () => {
  expect(ratText({ num: 1, den: 3 })).toBe('0.33');
  expect(ratText(null)).toBe('–');
  expect(rangeText([4, 4, 4])).toBe('4');
  expect(rangeText([3, 5, null])).toBe('3 to 5');
  expect(rangeText([null])).toBe('–');
  expect(accText({ num: 512, den: 512 })).toBe('all pairs');
  expect(accText({ num: 256, den: 512 })).toBe('50.0% of pairs');
  expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
});

it('each readout has its own column and the table repeats the card numbers', () => {
  const c: ClassView = { id: 'hier-12', role: 'r', matched: true, replicates: [rep(4, { num: 4, den: 11 }), rep(5, { num: 5, den: 11 })] };
  const row = tableRow(c);
  expect(row).toHaveLength(COLUMNS.length);
  expect(row[0]).toBe('hier-12');
  expect(row[2]).toBe('4 to 5');
  expect(COLUMNS.filter((x) => /Shared bound|Reuse ratio|Mean a|Max copies|Copy-weighted/.test(x))).toHaveLength(5);
});

it('verdict rows carry the frozen words', () => {
  const v: Record<string, VerdictView> = {
    copyWeightedConstruction: { direction: 'higher', verdict: 'fails to separate', sentence: 'fails to separate; no life-detection claim is made from this readout', cells: [{ id: 'spaced-4', separates: false }], accuracy: { lower: { num: 512, den: 512 }, higher: { num: 0, den: 512 } }, baselineBest: { num: 300, den: 512 } },
    maxCopies: { direction: null, verdict: 'not directional', sentence: 'x', cells: [], accuracy: { lower: { num: 256, den: 512 }, higher: { num: 256, den: 512 } }, baselineBest: { num: 1, den: 2 } },
  };
  const rows = verdictRows(v);
  expect(rows[0].sentence).toContain('fails to separate');
  expect(rows[0].accuracy).toBe('0.0% of pairs');
  expect(rows[1].direction).toBe('not directional');
});

it('the page markup has the caption, a real table and a status line', () => {
  const html = readFileSync(new URL('../assembly/index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<table id="table"><caption>/);
  expect(html).toContain('Why this is not yet evidence of life');
  expect(html).toContain('id="status"');
  expect(html).toContain('role="status"');
});

it('movie rows, the swing source and the exact-versus-bound gap sentence', async () => {
  const { movieRow, swingSource, gapText, frameFromCells, MOVIE_COLUMNS } = await import('../src/assembly/render.ts');
  const one = { frames: 96, objectsPerFrame: { num: 2, den: 1 }, classesT: 3, persistence: { '1': { num: 1, den: 2 }, '2': { num: 1, den: 4 }, '4': null }, construction: { reuseRatio: { num: 3, den: 7 }, scoredObjects: 1, unscoredObjects: 0, inexactObjects: 2 } };
  const m = { id: 'clip-x', sha256: 'x', variants: { 'conn4-tau1': { '1': one, '4': one } }, swing: { a: { factor2: true, connAtFixedTau: false, tauAtFixedConn: true } } };
  const row = movieRow(m);
  expect(row).toHaveLength(MOVIE_COLUMNS.length);
  expect(row[3]).toBe('0.50');
  expect(row[5]).toBe('–');
  expect(row[7]).toContain('2 objects not exact');
  expect(swingSource(m)).toBe('threshold only');
  expect(swingSource({ ...m, swing: undefined })).toContain('n/a');
  const g = gapText({ random_dup_12: { bound: [10, 11], exact: [6, 7] }, hier_12: { bound: [4], exact: [4] } });
  expect(g).toContain('10 to 11 against 6 to 7');
  expect(g).toContain('size of the gap does not');
  expect(Array.from(frameFromCells([1, 3], 5))).toEqual([0, 1, 0, 1, 0]);
});
