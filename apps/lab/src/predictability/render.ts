// Pure helpers for the predictability page: formatting, table rows, frame drawing. No DOM lookups.
export interface Rational { num: number; den: number }
export interface LossCell { errors: number; cells: number; skillVsBest: Rational | null }
export interface FixtureView {
  id: string; family: string; q: number;
  byResolution: Record<string, { erased: boolean; loss: Record<string, Record<string, LossCell>> }>;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (n: number) => n.toLocaleString('en-US');
export const pct = (errors: number, cells: number) => (cells === 0 ? '-' : `${((100 * errors) / cells).toFixed(2)}%`);
export function skillText(s: Rational | null): string {
  if (!s || s.den === 0) return '–';
  const v = (100 * s.num) / s.den;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export const LABEL_TEXT: Record<string, string> = {
  exact: 'a predictor gets it exactly right',
  'noise-like': 'the best predictor is within 5% of the constant guess, and shuffling time moves its error by at most 2% of the cells',
  partial: 'predictors do some of the job',
  uninformative: 'nothing to score',
};

export function observerCell(f: FixtureView, r: number, h: number, p: string): { cell: LossCell; erased: boolean } {
  const res = f.byResolution[String(r)];
  return { cell: res.loss[String(h)][p], erased: res.erased };
}

export function tableRows(fixtures: readonly FixtureView[], r: number, h: number, p: string) {
  return fixtures.map((f) => {
    const { cell, erased } = observerCell(f, r, h, p);
    return { id: f.id, family: f.family, alphabet: f.q, errors: fmt(cell.errors), cells: fmt(cell.cells), rate: pct(cell.errors, cell.cells), skill: erased ? '– (erased)' : skillText(cell.skillVsBest) };
  });
}

/** Evenly spaced frame indices for the static strip shown under prefers-reduced-motion. */
export function stripIndices(total: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.floor((i * (total - 1)) / Math.max(1, count - 1)));
}

/** Greyscale-to-mint ramp over 0..q-1. Returns RGBA for one value. */
export function shade(v: number, q: number): [number, number, number] {
  const t = q <= 1 ? 0 : v / (q - 1);
  return [Math.round(14 + 145 * t), Math.round(28 + 200 * t), Math.round(36 + 160 * t)];
}

export function frameToImage(frame: Uint8Array, w: number, h: number, q: number): ImageData {
  const img = new ImageData(w, h);
  for (let c = 0; c < w * h; c++) { const [r, g, b] = shade(frame[c], q); img.data[c * 4] = r; img.data[c * 4 + 1] = g; img.data[c * 4 + 2] = b; img.data[c * 4 + 3] = 255; }
  return img;
}

/** Draw a frame scaled to the canvas without smoothing. */
export function drawFrame(canvas: HTMLCanvasElement, frame: Uint8Array, w: number, h: number, q: number, scratch: HTMLCanvasElement): void {
  scratch.width = w; scratch.height = h;
  scratch.getContext('2d')!.putImageData(frameToImage(frame, w, h, q), 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
}
