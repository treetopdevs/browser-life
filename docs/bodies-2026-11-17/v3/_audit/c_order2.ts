// swap marks so the first-in-scan side carries kin 128: does the winner follow position, not mark?
import { blank, put, at } from './lib.ts';
let f = 0, s = 0;
for (let seed = 1; seed <= 40; seed++) {
  const w = blank({ GATE_GROW: 1, FORAGE: 0, FLOW: 0 }, { seed });
  for (let u = 0; u < 20; u++) for (let v = 0; v < 6; v++) { put(w, 30 + u, 20 + v, { kin: 128, store: 24, d: 0, g1: 255 }); put(w, 30 + u, 28 + v, { kin: 0, store: 24, d: 0, g1: 255 }); }
  w.food.fill(10); w.initialMatter = w.matterTotal(); w.step(60);
  for (let u = 0; u < 24; u++) for (const g of [26, 27]) { const i = at(28 + u, g); if (w.cell[i]) { if (w.kin[i] === 128) f++; else s++; } }
}
console.log('marks swapped: north side (kin 128) gap tiles', f, 'south side (kin 0)', s);
