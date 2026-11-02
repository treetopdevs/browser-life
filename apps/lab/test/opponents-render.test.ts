import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cellView, esc, expectedShare, indexRuns, matrix, shadeFor, timeRows, type RunRec, type ViewConfig } from '../src/opponents/render.ts';

const cfg: ViewConfig = { ids: ['A', 'B'], seeds: [1, 2, 3, 4, 5], rareSeeds: [1, 2, 3, 4, 5, 6], rarePositions: 1 };
const run = (key: string, b0: [number, number], cps: [number, number][]): RunRec => ({ key, b0, e0: [0, 0], cp: cps.map(([a, b]) => [a, b, 1, 1]) });
function runs(over: Record<string, [number, number][]> = {}): RunRec[] {
  const out: RunRec[] = [];
  for (const seed of cfg.seeds) for (const pos of ['P1', 'P2']) {
    const k = `c|A|B|bal|${pos}|${seed}`;
    out.push(run(k, [1000, 1000], over[k] ?? [[700, 300], [800, 200]]));
  }
  for (const seed of cfg.rareSeeds) for (const arm of ['rA', 'rB']) {
    const k = `c|A|B|${arm}|R1|${seed}`;
    out.push(run(k, arm === 'rA' ? [500, 1500] : [1500, 500], over[k] ?? [[500, 1500], [500, 1500]]));
  }
  for (const seed of cfg.seeds) for (const m of ['m01', 'm23']) for (const id of ['A', 'B']) out.push(run(`s|${id}|${m}|${seed}`, [1000, 0], [[id === 'A' ? 3000 : 1000, 0], [id === 'A' ? 3000 : 1000, 0]]));
  return out;
}

it('matrix numbers equal the raw records; mirrored cells are complements', () => {
  const idx = indexRuns(runs());
  const ab = cellView(idx, cfg, 'A', 'B', 'bal', 'avg', 1), ba = cellView(idx, cfg, 'B', 'A', 'bal', 'avg', 1);
  expect(ab.value).toBeCloseTo(0.8);
  expect(ba.value).toBeCloseTo(0.2);
  expect(ab.text).toContain('0.80');
  expect(cellView(idx, cfg, 'A', 'A', 'bal', 'avg', 1).state).toBe('none');
});

it('uninformative cells are labelled, not coloured as ties', () => {
  const over: Record<string, [number, number][]> = {};
  for (const seed of [1, 2, 3]) over[`c|A|B|bal|P1|${seed}`] = [[1, 1], [1, 1]];
  const idx = indexRuns(runs(over));
  const c = cellView(idx, cfg, 'A', 'B', 'bal', 'avg', 1);
  expect(c.state).toBe('uninformative');
  expect(c.text).toContain('uninformative');
  const m = matrix(idx, cfg, 'bal', 'avg', 1, 'payoff');
  expect(shadeFor(m[0][1], 'bal', 'payoff')).toContain('repeating-linear-gradient');
  expect(shadeFor(m[0][1], 'bal', 'payoff')).not.toContain('rgba(124');
});

it('checkpoint, ratio and position toggles change the displayed numbers', () => {
  const over: Record<string, [number, number][]> = {};
  for (const seed of cfg.seeds) over[`c|A|B|bal|P2|${seed}`] = [[400, 600], [500, 500]];
  const idx = indexRuns(runs(over));
  const t0 = cellView(idx, cfg, 'A', 'B', 'bal', 'avg', 0).text, t1 = cellView(idx, cfg, 'A', 'B', 'bal', 'avg', 1).text;
  expect(t0).not.toBe(t1);
  expect(cellView(idx, cfg, 'A', 'B', 'bal', '1', 1).value).toBeCloseTo(0.8);
  expect(cellView(idx, cfg, 'A', 'B', 'bal', '2', 1).value).toBeCloseTo(0.5);
  const rare = cellView(idx, cfg, 'A', 'B', 'rare', 'avg', 1);
  expect(rare.value).toBeCloseTo(0.25 - 0.25);
  expect(timeRows(idx, cfg, 'A', 'B', 'bal', 'avg', [10, 20]).map((r) => r.text)).toEqual([t0, t1]);
});

it('growing-alone prediction and residual follow the isolated runs', () => {
  const idx = indexRuns(runs());
  expect(expectedShare(idx, cfg, 'A', 'B', 'avg', 1)).toBeCloseTo(0.75);
  const m = matrix(idx, cfg, 'bal', 'avg', 1, 'residual');
  expect(m[0][1].residual).toBeCloseTo(0.8 - 0.75);
});

it('escapes text and the page labels the cycle fixture synthetic', () => {
  expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  const html = readFileSync(new URL('../opponents/index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/synthetic/);
  const css = readFileSync(new URL('../src/opponents/style.css', import.meta.url), 'utf8');
  expect(css).toContain('prefers-reduced-motion');
});

const solo = (id: string, m: string, seed: number, v: number): RunRec => run(`s|${id}|${m}|${seed}`, [1000, 0], [[v, 0], [v, 0]]);

it('the solo expectation is derived in canonical pair order, so a reversed cell is the exact complement', () => {
  // A grows 3000 in the m01 slots and 1000 in m23; B grows 1000 in both. Position 1 puts A in m01 and B in m23.
  const c3: ViewConfig = { ids: ['A', 'B'], seeds: [1, 2, 3], rareSeeds: [], rarePositions: 0 };
  const out: RunRec[] = [];
  for (const seed of c3.seeds) {
    for (const pos of ['P1', 'P2']) out.push(run(`c|A|B|bal|${pos}|${seed}`, [1000, 1000], [[500, 500], [500, 500]]));
    out.push(solo('A', 'm01', seed, 3000), solo('A', 'm23', seed, 1000), solo('B', 'm01', seed, 1000), solo('B', 'm23', seed, 1000));
  }
  const idx = indexRuns(out);
  expect(expectedShare(idx, c3, 'A', 'B', '1', 1)).toBeCloseTo(0.75);
  expect(expectedShare(idx, c3, 'B', 'A', '1', 1)).toBeCloseTo(0.25);
  expect(expectedShare(idx, c3, 'A', 'B', '2', 1)).toBeCloseTo(0.5);
  expect(expectedShare(idx, c3, 'B', 'A', '2', 1)).toBeCloseTo(0.5);
  expect(expectedShare(idx, c3, 'A', 'B', 'avg', 1)! + expectedShare(idx, c3, 'B', 'A', 'avg', 1)!).toBeCloseTo(1);
  const m = matrix(idx, c3, 'bal', '1', 1, 'residual');
  expect(m[0][1].residual).toBeCloseTo(0.5 - 0.75);
  expect(m[1][0].residual).toBeCloseTo(0.5 - 0.25);
});

it('an excluded block influences neither the observed payoff nor the expectation', () => {
  const c10: ViewConfig = { ids: ['A', 'B'], seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rareSeeds: [], rarePositions: 0 };
  const out: RunRec[] = [];
  for (const seed of c10.seeds) {
    for (const pos of ['P1', 'P2']) out.push(run(`c|A|B|bal|${pos}|${seed}`, [1000, 1000], seed === 10 && pos === 'P1' ? [[1, 1], [1, 1]] : [[500, 500], [500, 500]]));
    // seed 10 would predict a share of 1 for A; the other nine predict 0.5
    const a = seed === 10 ? 1000 : 1000, b = seed === 10 ? 0 : 1000;
    out.push(solo('A', 'm01', seed, a), solo('A', 'm23', seed, a), solo('B', 'm01', seed, b), solo('B', 'm23', seed, b));
  }
  const idx = indexRuns(out);
  const v = cellView(idx, c10, 'A', 'B', 'bal', 'avg', 1);
  expect(v.n).toBe(9);
  expect(expectedShare(idx, c10, 'A', 'B', 'avg', 1)).toBeCloseTo(0.5);
  expect(matrix(idx, c10, 'bal', 'avg', 1, 'residual')[0][1].residual).toBeCloseTo(0);
});
