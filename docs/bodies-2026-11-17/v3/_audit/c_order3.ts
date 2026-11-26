// control for c_order: the same block geometry with GATE_GROW 0 (no cross-tile dependency in growth): gap tiles won by each side
import { blank, put, at } from './lib.ts';
for (const gg of [0, 1]) for (const orient of ['ns', 'we'] as const) {
  let f = 0, s = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = blank({ GATE_GROW: gg, FORAGE: 0, FLOW: 0 }, { seed });
    for (let u = 0; u < 20; u++) for (let v = 0; v < 6; v++) {
      const a = orient === 'ns' ? [30 + u, 20 + v] : [20 + v, 30 + u], b = orient === 'ns' ? [30 + u, 28 + v] : [28 + v, 30 + u];
      put(w, a[0], a[1], { kin: 0, store: 24, d: 0, g1: 255 }); put(w, b[0], b[1], { kin: 128, store: 24, d: 0, g1: 255 });
    }
    w.food.fill(10); w.initialMatter = w.matterTotal(); w.step(60);
    for (let u = 0; u < 24; u++) for (const g of [26, 27]) { const i = orient === 'ns' ? at(28 + u, g) : at(g, 28 + u); if (w.cell[i]) { if (w.kin[i] === 0) f++; else s++; } }
  }
  console.log(`GATE_GROW ${gg} ${orient}: gap tiles first-in-scan side ${f}, other side ${s}`);
}
