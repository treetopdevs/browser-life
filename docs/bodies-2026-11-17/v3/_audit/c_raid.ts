import { blank, put, at } from './lib.ts';
import { hash32 } from '../../../../apps/lab/src/bodies/model.ts';
function run(orient: 'ns' | 'we', raid: number, seeds: number, steps: number) {
  let dFirst = 0, dSecond = 0, tot = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const w = blank({ RAID: raid, FORAGE: 0, FLOW: 0 }, { seed });
    const L = 30;
    for (let u = 0; u < L; u++) for (let v = 0; v < 4; v++) {
      const a = orient === 'ns' ? [30 + u, 20 + v] : [20 + v, 30 + u];
      const b = orient === 'ns' ? [30 + u, 24 + v] : [24 + v, 30 + u];
      // iid stores, same distribution for both sides, derived from a hash independent of the world's PRNG
      put(w, a[0], a[1], { kin: 0, store: hash32(seed, a[0], a[1], 777) % 25, d: 0 });
      put(w, b[0], b[1], { kin: 128, store: hash32(seed, b[0], b[1], 777) % 25, d: 0 });
    }
    const sumSide = () => { let f = 0, s = 0; for (let i = 0; i < 9216; i++) if (w.cell[i]) { if (w.kin[i] === 0) f += w.store[i]; else s += w.store[i]; } return [f, s]; };
    const [f0, s0] = sumSide(); w.step(steps); const [f1, s1] = sumSide();
    dFirst += f1 - f0; dSecond += s1 - s0; tot += w.raided;
    if (w.residual() !== 0) console.log('RESIDUAL', w.residual());
  }
  console.log(`${orient} RAID ${raid} steps ${steps}: net store change first-in-scan side ${dFirst}, other side ${dSecond}, total raided ${tot}`);
}
for (const o of ['ns', 'we'] as const) run(o, 2, 200, 1);
for (const o of ['ns', 'we'] as const) run(o, 12, 200, 1);
