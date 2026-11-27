import * as O from './model_orig.ts';
import * as N from '../../../../apps/lab/src/bodies/model.ts';
const cfgs: any[] = [];
for (const seed of [1,2,3,7]) {
  cfgs.push({seed, founders:3, upkeep:true});
  cfgs.push({seed, founders:3, upkeep:true, mutRate:3});
  cfgs.push({seed, founders:3, upkeep:true, mutRate:24, blind:true});
  cfgs.push({seed, founders:1, upkeep:false, genome:[16,60,0,0]});
  cfgs.push({seed, founders:5, upkeep:true, mutRate:12, version:1});
  cfgs.push({seed, founders:2, upkeep:true, mutRate:12, rules:{UPK:6, FLOW:0}});
}
let bad=0;
for (const c of cfgs) {
  const a = new O.BodiesWorld(c), b = new N.BodiesWorld(c);
  for (let s=0;s<2000;s++){ a.step(1); b.step(1); if (s===700){ a.injure(48,48,5); b.injure(48,48,5);} 
    if (s%250===0 && O.hashState(a)!==N.hashState(b)) { console.log('DIVERGE at', s, JSON.stringify(c)); bad++; break; } }
  const ha=O.hashState(a), hb=N.hashState(b);
  if (ha!==hb) {bad++; console.log('FINAL MISMATCH', JSON.stringify(c), ha, hb);}
  if (b.residual()!==0) console.log('resid', b.residual());
}
console.log('cfgs', cfgs.length, 'bad', bad);
