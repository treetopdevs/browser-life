import { blank, put } from './lib.ts';
import { hash32 } from '../../../../apps/lab/src/bodies/model.ts';
for (const orient of ['ns', 'we'] as const) {
  const xs: number[] = [];
  for (let seed = 1; seed <= 1500; seed++) {
    const w = blank({ RAID: 2, FORAGE: 0, FLOW: 0 }, { seed });
    for (let u = 0; u < 30; u++) for (let v = 0; v < 4; v++) {
      const a = orient === 'ns' ? [30 + u, 20 + v] : [20 + v, 30 + u], b = orient === 'ns' ? [30 + u, 24 + v] : [24 + v, 30 + u];
      put(w, a[0], a[1], { kin: 0, store: hash32(seed, a[0], a[1], 777) % 25, d: 0 }); put(w, b[0], b[1], { kin: 128, store: hash32(seed, b[0], b[1], 777) % 25, d: 0 });
    }
    let f0 = 0; for (let i = 0; i < 9216; i++) if (w.cell[i] && w.kin[i] === 0) f0 += w.store[i];
    w.step(1); let f1 = 0; for (let i = 0; i < 9216; i++) if (w.cell[i] && w.kin[i] === 0) f1 += w.store[i];
    xs.push(f1 - f0);
  }
  const m = xs.reduce((a, b) => a + b, 0) / xs.length, v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  console.log(orient, 'mean net gain of first-in-scan side per step', m.toFixed(3), 'SE', Math.sqrt(v / xs.length).toFixed(3));
}
