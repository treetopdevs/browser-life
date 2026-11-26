// Pure view helpers for the archive-tournament page. Reads numbers from evidence.json only; imports nothing from sim-ref.
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
export const f2 = (x: number): string => x.toFixed(2);

export interface PairView {
  a: string; b: string;
  summary: { complete: number; excluded: number; blocks: number; mean: number | null; interval: { lo: number; hi: number } | null; status: 'informative' | 'uninformative'; edge: string | null };
}
export interface Cell { state: 'self' | 'empty' | 'informative' | 'uninformative'; text: string; value: number | null }

/** Matrix with rows later snapshots and columns earlier ones: the cell is the row snapshot's share against the column snapshot. */
export function laterVsEarlier(ids: string[], pairs: PairView[]): Cell[][] {
  const by = new Map(pairs.map((p) => [`${p.a}|${p.b}`, p]));
  return ids.map((row, i) => ids.map((col, j) => {
    if (i === j) return { state: 'self', text: '', value: null } as Cell;
    if (j > i) return { state: 'empty', text: '', value: null } as Cell; // the column is later than the row: shown in the other triangle
    const p = by.get(`${col}|${row}`) as PairView; // stored as earlier|later, payoff is the earlier one's
    const s = p.summary;
    const ex = s.excluded ? `, ${s.excluded} of ${s.blocks} blocks excluded` : '';
    if (s.status === 'uninformative' || s.mean === null) return { state: 'uninformative', text: `uninformative (${s.complete} of ${s.blocks} blocks kept${ex})`, value: null } as Cell;
    const m = 1 - s.mean;
    const iv = s.interval ? ` [${f2(1 - s.interval.hi)}, ${f2(1 - s.interval.lo)}]` : '';
    return { state: 'informative', text: `${f2(m)}${iv}, n=${s.complete}${ex}${s.edge ? ', confirmed edge' : ''}`, value: m } as Cell;
  }));
}

export interface Histogram { lo: number; hi: number; counts: number[]; observedBin: number }
/** Histogram of the permuted statistic with the observed value's bin. */
export function histogram(values: number[], observed: number | null, bins = 24): Histogram {
  const lo = Math.min(...values, observed ?? Infinity), hi = Math.max(...values, observed ?? -Infinity);
  const w = (hi - lo) / bins || 1;
  const at = (v: number) => Math.min(bins - 1, Math.floor((v - lo) / w));
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[at(v)]++;
  return { lo, hi, counts, observedBin: observed === null ? -1 : at(observed) };
}

export function shade(v: number | null): string {
  if (v === null) return 'transparent';
  const t = Math.max(0, Math.min(1, Math.abs(v - 0.5) / 0.3));
  return v >= 0.5 ? `rgba(94,160,120,${0.12 + 0.5 * t})` : `rgba(190,120,80,${0.12 + 0.5 * t})`;
}
export const pct = (x: number): string => `${Math.round(100 * x)}%`;
export const rank = (x: number | null): string => (x === null ? 'n/a' : x.toFixed(3));
