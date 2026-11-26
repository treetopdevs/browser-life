// Pure helpers for the assembly page: formatting and table rows. No DOM lookups.
export interface Rat { num: number; den: number }
export interface ReplicateView {
  replicate: number; sha256: string; cells?: number[];
  primary: {
    objects: number; spans: number; large: number;
    construction: { meanA: Rat | null; reuseRatio: Rat | null; sharedBound: number | null };
    copies: { T: { maxCopies: number; copyWeightedConstruction: number; classes: number }; D4: { classes: number } };
    equiv: { classesT: number; classesD4: number; classesD4on8: number; spread: number };
    baselines: { occupied: number; deflate: number; objectCount: number };
  };
}
export interface ClassView { id: string; role: string; matched: boolean; replicates: ReplicateView[] }
export interface VerdictView { direction: string | null; verdict: string; sentence: string; cells: { id: string; separates: boolean }[]; accuracy: { lower: Rat; higher: Rat }; baselineBest: Rat }

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ratText = (r: Rat | null | undefined, digits = 2): string => (r && r.den ? (r.num / r.den).toFixed(digits) : '–');
export const accText = (r: Rat): string => (r.num === r.den ? 'all pairs' : `${((100 * r.num) / r.den).toFixed(1)}% of pairs`);

/** "min to max" over the replicates of a numeric getter; a single value when they agree. */
export function rangeText(values: (number | null)[], digits = 0): string {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return '–';
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? lo.toFixed(digits) : `${lo.toFixed(digits)} to ${hi.toFixed(digits)}`;
}
const r2n = (r: Rat | null) => (r && r.den ? r.num / r.den : null);

export const COLUMNS = ['Class', 'Objects', 'Shared bound (cost)', 'Reuse ratio (cost)', 'Mean a per object', 'Max copies', 'Copy-weighted a', 'Classes T / D4 / D4 on 8-conn', 'Occupied', 'Deflate bytes'] as const;

export function tableRow(c: ClassView): string[] {
  const rs = c.replicates.map((r) => r.primary);
  return [
    c.id,
    rangeText(rs.map((p) => p.objects)),
    rangeText(rs.map((p) => p.construction.sharedBound)),
    rangeText(rs.map((p) => r2n(p.construction.reuseRatio)), 2),
    rangeText(rs.map((p) => r2n(p.construction.meanA)), 2),
    rangeText(rs.map((p) => p.copies.T.maxCopies)),
    rangeText(rs.map((p) => p.copies.T.copyWeightedConstruction)),
    `${rangeText(rs.map((p) => p.equiv.classesT))} / ${rangeText(rs.map((p) => p.equiv.classesD4))} / ${rangeText(rs.map((p) => p.equiv.classesD4on8))}`,
    rangeText(rs.map((p) => p.baselines.occupied)),
    rangeText(rs.map((p) => p.baselines.deflate)),
  ];
}

export function verdictRows(v: Record<string, VerdictView>) {
  return Object.entries(v).map(([name, x]) => ({
    name, direction: x.direction ?? 'not directional', verdict: x.verdict, sentence: x.sentence,
    cells: x.cells.map((c) => `${c.id}: ${c.separates ? 'separates' : 'does not'}`).join('; ') || '–',
    accuracy: x.direction ? accText(x.accuracy[x.direction as 'lower' | 'higher']) : `lower ${accText(x.accuracy.lower)}, higher ${accText(x.accuracy.higher)}`,
  }));
}

export function shade(v: number): [number, number, number] { return v ? [159, 228, 196] : [14, 28, 36]; }

export function drawPatch(canvas: HTMLCanvasElement, frame: Uint8Array, w: number, h: number, scratch: HTMLCanvasElement): void {
  scratch.width = w; scratch.height = h;
  const img = new ImageData(w, h);
  for (let c = 0; c < w * h; c++) { const [r, g, b] = shade(frame[c]); img.data[c * 4] = r; img.data[c * 4 + 1] = g; img.data[c * 4 + 2] = b; img.data[c * 4 + 3] = 255; }
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
}

/** Frame bytes for a patch from its saved occupied-cell list. */
export function frameFromCells(cells: readonly number[], size: number): Uint8Array {
  const f = new Uint8Array(size);
  for (const c of cells) f[c] = 1;
  return f;
}

export interface MovieView {
  id: string; sha256: string;
  variants: Record<string, Record<string, {
    frames: number; objectsPerFrame: Rat | null; classesT: number; persistence: Record<string, Rat | null>;
    construction: { reuseRatio: Rat | null; scoredObjects: number; unscoredObjects: number; inexactObjects?: number };
  }>>;
  swing?: Record<string, { factor2: boolean; connAtFixedTau?: boolean; tauAtFixedConn?: boolean }>;
  segmentationDominated?: boolean;
}

export const MOVIE_COLUMNS = ['Movie', 'Objects per frame', 'Classes', 'Persistence lag 1', 'lag 2', 'lag 4', 'Persistence lag 1, every 4th frame', 'Reuse ratio (exact, small objects)', 'Segmentation swing'] as const;

/** Which part of the grid moves a clip's counts by a factor of two: connectivity at a fixed threshold, the threshold at fixed connectivity, or neither. */
export function swingSource(m: MovieView): string {
  if (!m.swing) return 'n/a (one variant)';
  const all = Object.values(m.swing);
  const conn = all.some((x) => x.connAtFixedTau), tau = all.some((x) => x.tauAtFixedConn);
  return conn && tau ? 'connectivity and threshold' : conn ? 'connectivity' : tau ? 'threshold only' : 'under factor 2';
}

export function movieRow(m: MovieView, variant = 'conn4-tau1'): string[] {
  const one = m.variants[variant]?.['1'], four = m.variants[variant]?.['4'];
  if (!one) return [m.id, ...Array(MOVIE_COLUMNS.length - 1).fill('–')];
  return [
    m.id, ratText(one.objectsPerFrame), String(one.classesT),
    ratText(one.persistence['1']), ratText(one.persistence['2']), ratText(one.persistence['4']),
    four ? ratText(four.persistence['1']) : '–',
    ratText(one.construction.reuseRatio) + (one.construction.inexactObjects ? ` (${one.construction.inexactObjects} objects not exact)` : ''),
    swingSource(m),
  ];
}

export interface GapView { random_dup_12: { bound: number[]; exact: (number | null)[] }; hier_12: { bound: number[]; exact: (number | null)[] } }

/** The amendment-1 exact-versus-bound gap, as one sentence to sit next to the matched-pair verdicts. */
export function gapText(g: GapView): string {
  const r = (xs: (number | null)[]) => rangeText(xs);
  return `The 12-cell negatives are picked by the beam bound, which favours shapes the beam handles worst. Beam bound against exact: random-dup-12 ${r(g.random_dup_12.bound)} against ${r(g.random_dup_12.exact)}; hier-12 ${r(g.hier_12.bound)} against ${r(g.hier_12.exact)}. The ordering survives with exact values, but the size of the gap does not: the table above overstates it by about four joins.`;
}
