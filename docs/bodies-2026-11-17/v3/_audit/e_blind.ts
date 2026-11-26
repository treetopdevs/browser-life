import { BodiesWorld, hashState } from '../../../../apps/lab/src/bodies/model.ts';
const pos = [[40, 48], [54, 48], [47, 60]] as const;
let bad = 0;
for (const seed of [1, 2, 3]) for (const extra of [{}, { TAG_TOL_GENE: 1 }, { TAG_MUT_BUD: 1, TAG_STEP: 40 }]) for (const mut of [0, 6]) for (const gb of [false, true]) {
  const common: any = { seed, founders: 3, positions: pos, founderTags: [0, 100, 200], mutRate: mut, blind: gb, tagMutRate: 5000 };
  const a = new BodiesWorld({ ...common, tagBlind: true, rules: { GATE_SHARE: 1, GATE_GROW: 1, GATE_SIGNAL: 1, SEAM_COST: 3, RAID: 6, ...extra } });
  const b = new BodiesWorld({ ...common, rules: { ...extra } });  // no gates at all
  a.step(1800); b.step(1800);
  const same = hashState(a) === hashState(b) && a.births === b.births && a.burned === b.burned && a.moved === b.moved && a.foraged === b.foraged && a.rootings === b.rootings
    && a.kin.every((v, i) => v === b.kin[i]) && a.kinTol.every((v, i) => v === b.kinTol[i]) && a.tagMutations === b.tagMutations && a.rootSince.every((v, i) => v === b.rootSince[i]);
  if (!same || a.raided || a.seamBurned || a.blockedGrow) { bad++; console.log('DIFF', seed, JSON.stringify(extra), mut, gb); }
}
console.log('tagBlind vs gates-off bad', bad, '/ 36');
