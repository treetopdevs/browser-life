import { blank, put } from './lib.ts';
import { PatchTracker } from '../../../../apps/lab/src/bodies/observe.ts';
const rect = (w: any, x0: number, y0: number, nx: number, ny: number, kin: number) => { for (let x = x0; x < x0 + nx; x++) for (let y = y0; y < y0 + ny; y++) put(w, x, y, { kin }); };
// (a) takeover: same tiles live, marks replaced by a foreign mark between samples
{
  const w = blank(); const tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); w.t = 0; tr.sample(w);
  rect(w, 10, 10, 10, 10, 100); w.t = 200; const r = tr.sample(w);
  console.log('(a) takeover, same tiles new mark: births', r.births, 'deaths', r.deaths, 'ageMax', r.ageMax, '(a clade replaced in place; ideal: death 1, birth 1)');
}
// (b) replacement: A dies and a foreign block appears over A's old footprint plus margin, via an intermediate where it is empty? (no: sampled directly)
{
  const w = blank(); const tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); w.t = 0; tr.sample(w);
  w.cell.fill(0); rect(w, 9, 9, 12, 12, 100); w.t = 200; const r = tr.sample(w);
  console.log('(b) A gone, bigger foreign block over its footprint: births', r.births, 'deaths', r.deaths, 'ageMax', r.ageMax);
}
// (c) partial takeover: left half of A is retaken by a different mark
{
  const w = blank(); const tr = new PatchTracker(10); rect(w, 10, 10, 10, 10, 0); w.t = 0; tr.sample(w);
  rect(w, 10, 10, 5, 10, 100); w.t = 200; const r = tr.sample(w);
  console.log('(c) left half retaken: births', r.births, 'deaths', r.deaths, 'nBig', r.nBig, 'ages', r.ageMedian, r.ageMax);
}
