// Pure helpers for the opponents page: read the saved raw run records and compute the displayed numbers. No DOM lookups,
// no simulator import (payoff.ts is arithmetic only), so every number on the page can be recomputed from evidence.json.
import { blockPayoff, shareA, summarizeInvasion, summarizePair, tInterval, vigourExpected, type Obs } from '../../../../packages/metrics/src/opponents/payoff.ts';

export interface RunRec { key: string; b0: [number, number]; e0: [number, number]; cp: [number, number, number, number][] }
export interface ViewConfig { ids: string[]; seeds: number[]; rareSeeds: number[]; rarePositions: number }
export type Ratio = 'bal' | 'rare';
export type Position = 'avg' | '1' | '2';
export type Metric = 'payoff' | 'expected' | 'residual';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const f2 = (v: number) => v.toFixed(2);
export const fmt = (n: number) => n.toLocaleString('en-US');

export type Index = Map<string, RunRec>;
export const indexRuns = (runs: readonly RunRec[]): Index => new Map(runs.map((r) => [r.key, r]));

export interface CellView {
  state: 'ok' | 'uninformative' | 'none';
  value: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
  total: number;
  excluded: number;
  text: string;
}
const NONE: CellView = { state: 'none', value: null, lo: null, hi: null, n: 0, total: 0, excluded: 0, text: '–' };

const obs = (r: RunRec, k: number): Obs => ({ b0A: r.b0[0], b0B: r.b0[1], bA: r.cp[k][0], bB: r.cp[k][1] });

function describe(values: number[], total: number, minFraction: number, signed: boolean): CellView {
  const n = values.length;
  if (n === 0 || n < minFraction * total - 1e-9) return { state: 'uninformative', value: null, lo: null, hi: null, n, total, excluded: total - n, text: `uninformative (${total - n} of ${total} dropped)` };
  const iv = tInterval(values);
  const m = values.reduce((a, b) => a + b, 0) / n;
  const sign = signed && m > 0 ? '+' : '';
  const val = `${sign}${f2(m)}`;
  const text = iv ? `${val} [${signed && iv.lo > 0 ? '+' : ''}${f2(iv.lo)}, ${signed && iv.hi > 0 ? '+' : ''}${f2(iv.hi)}] n=${n}` : `${val} n=${n}`;
  return { state: 'ok', value: m, lo: iv?.lo ?? null, hi: iv?.hi ?? null, n, total, excluded: total - n, text: total - n ? `${text}, ${total - n} dropped` : text };
}

/**
 * Cell (row X, column Y). Balanced: X's share of biomass against Y at checkpoint k (1:1 start, both slot sets averaged by default).
 * Rare: change in X's share from its measured starting share when X starts as one of four discs against Y's three.
 */
export function cellView(idx: Index, cfg: ViewConfig, x: string, y: string, ratio: Ratio, pos: Position, k: number): CellView {
  if (x === y) return NONE;
  const first = cfg.ids.indexOf(x) < cfg.ids.indexOf(y);
  const pair = first ? `${x}|${y}` : `${y}|${x}`;
  if (ratio === 'bal') {
    const vals: (number | null)[] = [];
    for (const seed of cfg.seeds) {
      const rs = (pos === 'avg' ? ['P1', 'P2'] : [`P${pos}`]).map((p) => idx.get(`c|${pair}|bal|${p}|${seed}`));
      if (rs.some((r) => !r)) return NONE;
      const b = blockPayoff(seed, rs.map((r) => obs(r!, k)));
      vals.push(b.payoff === null ? null : first ? b.payoff : 1 - b.payoff);
    }
    return describe(vals.filter((v): v is number => v !== null), vals.length, 0.8, false);
  }
  if (!cfg.rarePositions) return NONE;
  const arm = first ? 'rA' : 'rB';
  const positions = pos === 'avg' ? (cfg.rarePositions === 2 ? ['R1', 'R2'] : ['R1']) : [`R${pos}`];
  if (positions.some((p) => p === 'R2') && cfg.rarePositions < 2) return NONE;
  const per: (number | null)[] = cfg.rareSeeds.map((seed) => {
    const ex = positions.map((p) => {
      const r = idx.get(`c|${pair}|${arm}|${p}|${seed}`);
      if (!r) return null;
      const o = obs(r, k);
      const sh = first ? shareA(o.b0A, o.b0B, o.bA, o.bB) : shareA(o.b0B, o.b0A, o.bB, o.bA);
      return sh === null ? null : sh - (first ? o.b0A : o.b0B) / (o.b0A + o.b0B);
    });
    return ex.every((v) => v !== null) ? ex.reduce((a, b) => a! + b!, 0)! / ex.length : null;
  });
  return describe(per.filter((v): v is number => v !== null), per.length, 5 / 6, true);
}

/**
 * Retained seeds of a canonical pair (first, second in panel order) for the balanced arm: those whose blocks are complete at
 * checkpoint k. The same seeds feed the observed payoff and the solo-growth expectation, so excluded blocks influence neither.
 */
function retainedSeeds(idx: Index, cfg: ViewConfig, a: string, b: string, pos: Position, k: number): number[] {
  const out: number[] = [];
  for (const seed of cfg.seeds) {
    const rs = (pos === 'avg' ? ['P1', 'P2'] : [`P${pos}`]).map((p) => idx.get(`c|${a}|${b}|bal|${p}|${seed}`));
    if (rs.some((r) => !r)) continue;
    if (blockPayoff(seed, rs.map((r) => obs(r!, k))).payoff !== null) out.push(seed);
  }
  return out;
}

/**
 * Solo-growth prediction of the same cell: the share X would have if its isolated growth at the same positions decided it.
 * Derived in canonical pair order (the first panel id holds m01 at position 1), then complemented for a reversed cell, over
 * exactly the blocks the observed cell retains.
 */
export function expectedShare(idx: Index, cfg: ViewConfig, x: string, y: string, pos: Position, k: number): number | null {
  const first = cfg.ids.indexOf(x) < cfg.ids.indexOf(y);
  const [a, b] = first ? [x, y] : [y, x];
  const sets: [string, string][] = pos === '1' ? [['m01', 'm23']] : pos === '2' ? [['m23', 'm01']] : [['m01', 'm23'], ['m23', 'm01']];
  const vals: number[] = [];
  for (const seed of retainedSeeds(idx, cfg, a, b, pos, k)) {
    const e = sets.map(([ma, mb]) => {
      const va = idx.get(`s|${a}|${ma}|${seed}`), vb = idx.get(`s|${b}|${mb}|${seed}`);
      return va && vb ? vigourExpected(va.cp[k][0], vb.cp[k][0]) : null;
    });
    if (e.some((v) => v === null)) return null;
    vals.push(e.reduce((p, q) => p! + q!, 0)! / e.length);
  }
  if (!vals.length) return null;
  const m = vals.reduce((p, q) => p + q, 0) / vals.length;
  return first ? m : 1 - m;
}

export interface MatrixCell { row: string; col: string; view: CellView; shown: string; expected: number | null; residual: number | null }
export function matrix(idx: Index, cfg: ViewConfig, ratio: Ratio, pos: Position, k: number, metric: Metric): MatrixCell[][] {
  return cfg.ids.map((x) => cfg.ids.map((y) => {
    const view = cellView(idx, cfg, x, y, ratio, pos, k);
    const exp = ratio === 'bal' && x !== y ? expectedShare(idx, cfg, x, y, pos, k) : null;
    const residual = view.value !== null && exp !== null ? view.value - exp : null;
    let shown = view.text;
    if (view.state === 'ok' && ratio === 'bal') {
      if (metric === 'expected') shown = exp === null ? 'no solo prediction' : f2(exp);
      else if (metric === 'residual') shown = residual === null ? 'n/a' : `${residual > 0 ? '+' : ''}${f2(residual)}`;
    }
    return { row: x, col: y, view, shown, expected: exp, residual };
  }));
}

/** Background for a payoff cell: neutral near 0.5, never a tie colour for uninformative cells. */
export function shadeFor(cell: MatrixCell, ratio: Ratio, metric: Metric): string {
  if (cell.view.state === 'none') return 'transparent';
  if (cell.view.state === 'uninformative') return 'repeating-linear-gradient(45deg,#2b281f,#2b281f 6px,#1c1a15 6px,#1c1a15 12px)';
  let d: number | null;
  if (ratio === 'bal') d = metric === 'payoff' ? (cell.view.value ?? 0.5) - 0.5 : metric === 'expected' ? (cell.expected ?? 0.5) - 0.5 : cell.residual;
  else d = cell.view.value;
  if (d === null) return 'transparent';
  const a = Math.min(0.55, Math.abs(d) * 1.1);
  return d >= 0 ? `rgba(124,201,160,${a.toFixed(2)})` : `rgba(214,142,110,${a.toFixed(2)})`;
}

export interface TimeRow { step: number; text: string }
export function timeRows(idx: Index, cfg: ViewConfig, x: string, y: string, ratio: Ratio, pos: Position, steps: number[]): TimeRow[] {
  return steps.map((step, k) => ({ step, text: cellView(idx, cfg, x, y, ratio, pos, k).text }));
}

export function invasionText(idx: Index, cfg: ViewConfig, pair: string, arm: 'rA' | 'rB', k: number): string {
  const [a, b] = pair.split('|');
  const x = arm === 'rA' ? a : b, y = arm === 'rA' ? b : a;
  const v = cellView(idx, cfg, x, y, 'rare', 'avg', k);
  if (v.state !== 'ok') return v.text;
  const per = cfg.rareSeeds.map((seed) => {
    const vals = (cfg.rarePositions === 2 ? ['R1', 'R2'] : ['R1']).map((p) => {
      const r = idx.get(`c|${pair}|${arm}|${p}|${seed}`)!;
      const o = obs(r, k);
      const sh = arm === 'rA' ? shareA(o.b0A, o.b0B, o.bA, o.bB) : shareA(o.b0B, o.b0A, o.bB, o.bA);
      return sh === null ? null : sh - (arm === 'rA' ? o.b0A : o.b0B) / (o.b0A + o.b0B);
    });
    return vals.every((q) => q !== null) ? vals.reduce((p, q) => p! + q!, 0)! / vals.length : null;
  });
  return summarizeInvasion(per, Math.ceil((5 / 6) * per.length)).class;
}

export { summarizePair };
