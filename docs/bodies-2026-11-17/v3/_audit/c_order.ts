import { blank, put, at } from './lib.ts';
import type { BodiesWorld } from '../../../../apps/lab/src/bodies/model.ts';
// Two fed blocks of live cells facing each other across a 2-tile gap, GATE_GROW on, equal in every respect except position.
// Count gap tiles won by the first-in-raster-order side (north / west) vs the other, over many seeds.
function run(orient: 'ns' | 'we', g1: number, seeds: number) {
  let first = 0, second = 0, firstOnlyWins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0 }, { seed });
    const L = 20; // block length along the seam
    const cells: [number, number, number][] = [];
    for (let u = 0; u < L; u++) for (let v = 0; v < 6; v++) {
      const a = orient === 'ns' ? [30 + u, 20 + v] : [20 + v, 30 + u];       // first-side block (north or west), kin 0
      const b = orient === 'ns' ? [30 + u, 28 + v] : [28 + v, 30 + u];       // second-side block (south or east), kin 128; gap rows/cols 26,27
      cells.push([a[0], a[1], 0], [b[0], b[1], 128]);
    }
    for (const [x, y, k] of cells) put(w, x, y, { kin: k, store: 24, d: 0, g1 });
    w.food.fill(10); w.initialMatter = w.matterTotal();
    w.step(60);
    let f = 0, s = 0;
    for (let u = 0; u < L + 4; u++) for (const g of [26, 27]) {
      const i = orient === 'ns' ? at(28 + u, g) : at(g, 28 + u);
      if (w.cell[i]) { if (w.kin[i] === 0) f++; else s++; }
    }
    first += f; second += s; if (f > s) firstOnlyWins++;
  }
  console.log(`${orient} g1=${g1}: gap tiles won by first-in-scan side ${first}, other side ${second}, seeds where first side won more ${firstOnlyWins}/${seeds}`);
}
for (const o of ['ns', 'we'] as const) for (const g1 of [255, 60]) run(o, g1, 40);
