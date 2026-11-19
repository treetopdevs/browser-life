import { blank, put } from './lib.ts';
import { PatchTracker, seamStats } from '../../../../apps/lab/src/bodies/observe.ts';
function fresh() { return blank({ TAG_TOL: 16 }); }
const rect = (w: any, x0: number, y0: number, nx: number, ny: number, kin: number) => { for (let x = x0; x < x0 + nx; x++) for (let y = y0; y < y0 + ny; y++) put(w, (x + 96) % 96, (y + 96) % 96, { kin }); };
const clear = (w: any) => { w.cell.fill(0); w.kin.fill(0); w.store.fill(0); };
const w = fresh(); const tr = new PatchTracker(10);
const show = (tag: string, r: any, ex: any) => console.log(tag, 'births', r.births, 'deaths', r.deaths, 'nBig', r.nBig, 'ageMedian', r.ageMedian, 'ageMax', r.ageMax, 'dead', r.deadCount, 'life', r.deadLifeMean, ' expected', JSON.stringify(ex));
rect(w, 10, 10, 10, 10, 0); rect(w, 40, 40, 10, 5, 100); rect(w, 80, 80, 2, 2, 50); // A 100, B 50, dust 4
w.t = 0; show('S0', tr.sample(w), 'births null');
clear(w); rect(w, 10, 10, 10, 10, 0); rect(w, 60, 60, 10, 5, 100); rect(w, 80, 80, 2, 2, 50);
w.t = 200; show('S1 (B vanished, B2 appeared; A stays)', tr.sample(w), { births: 1, deaths: 1, ageMax: 200, deadLife: 0 });
clear(w); rect(w, 10, 10, 6, 10, 0); rect(w, 17, 10, 3, 10, 0); rect(w, 60, 60, 10, 5, 100);
w.t = 400; show('S2 (A splits 60/30 with a gap column)', tr.sample(w), { births: 0, deaths: 0, nBig: 3 });
clear(w); rect(w, 10, 10, 6, 10, 0); rect(w, 60, 60, 10, 5, 100);  // A2 (30 tiles) disappears
w.t = 600; show('S3 (A2 vanishes)', tr.sample(w), { births: 0, deaths: 1 });
// shift test: P 100 tiles moves 6 columns -> overlap 40 <50 -> death+birth; moves 5 -> overlap 50 -> linked
for (const sh of [5, 6]) {
  const w2 = fresh(); const t2 = new PatchTracker(10); rect(w2, 10, 10, 10, 10, 0); w2.t = 0; t2.sample(w2);
  clear(w2); rect(w2, 10 + sh, 10, 10, 10, 0); w2.t = 100; const r = t2.sample(w2); console.log('shift', sh, 'births', r.births, 'deaths', r.deaths, 'age', r.ageMax);
}
// torus wrap: seam across x=95|0, and patch across the wrap is one patch
{
  const w3 = fresh(); put(w3, 95, 5, { kin: 0 }); put(w3, 0, 5, { kin: 100 }); put(w3, 95, 6, { kin: 0 }); put(w3, 0, 6, { kin: 100 });
  const s = seamStats(w3); console.log('wrap seam pairs', s.pairs, s.seamPairs, 'expected pairs 4 (2 horizontal across wrap, 2 vertical) seam 2');
}
// merge: two big patches merge into one through a bridge
{
  const w4 = fresh(); const t4 = new PatchTracker(10); rect(w4, 10, 10, 6, 10, 0); rect(w4, 20, 10, 6, 10, 0); w4.t = 0; t4.sample(w4);
  rect(w4, 16, 10, 4, 10, 0); w4.t = 100; const r = t4.sample(w4); console.log('merge births', r.births, 'deaths', r.deaths, 'nBig', r.nBig, 'age', r.ageMax);
}
