import { BodiesWorld, hash32 } from '../../../../apps/lab/src/bodies/model.ts';
const mk = () => new BodiesWorld({ seed: 4, founders: 3, positions: [[40, 48], [54, 48], [47, 60]], founderTags: [0, 100, 200], mutRate: 12, tagMutRate: 3000,
  rules: { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1, SEAM_COST: 2, RAID: 4, TAG_TOL_GENE: 1 } });
const a = mk(), b = mk();
for (let blk = 0; blk < 12; blk++) {
  a.step(150); b.step(150);
  // scramble every observer-only field of b
  for (let i = 0; i < 9216; i++) { b.gen[i] = hash32(blk, i, 1, 1); b.rootSince[i] = (hash32(blk, i, 2, 1) & 1) ? -1 : hash32(blk, i, 3, 1) % 1000; }
  b.rootsCreated += 7777; b.rootsEnded += 5; b.rootLifeSum += 99999; b.moved += 11; b.foraged += 13;
}
const same = (x: ArrayLike<number>, y: ArrayLike<number>) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
console.log('physics equal after scrambling observer-only fields:', ['cell', 'food', 'store', 'd', 'g0', 'g1', 'g2', 'g3', 'tag', 'kin', 'kinTol'].every((k) => same((a as any)[k], (b as any)[k])), a.births === b.births, a.raided === b.raided);
