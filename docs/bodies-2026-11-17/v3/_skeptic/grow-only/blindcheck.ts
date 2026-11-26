import { BodiesWorld, hashStateFull } from '/Users/nicholas/develop/browser-life-bodies/apps/lab/src/bodies/model.ts';
const base = { seed: 4, founders: 3, positions: [[24,24],[72,30],[46,72]] as [number,number][], founderTags: [0,85,170], genome: [16,60,16,0] as any, mutRate: 3, tagMutRate: 65536 };
const a = new BodiesWorld({ ...base, rules: { TAG_MUT_BUD: 1, TAG_STEP: 40 } });                  // gates off
const b = new BodiesWorld({ ...base, tagBlind: true, rules: { GATE_GROW: 1, TAG_MUT_BUD: 1, TAG_STEP: 40 } }); // gate on but tag-blind
for (let t = 0; t < 4000; t++) { a.step(1); b.step(1); }
let same = true; for (const k of ['cell','food','store','d','kin','g0','g1','g2','g3']) { const x = (a as any)[k], y = (b as any)[k]; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { same = false; console.log('differs', k, i); break; } }
console.log('4000 steps: arrays identical', same, 'hashFull', hashStateFull(a), hashStateFull(b), 'cells', a.cellCount(), b.cellCount());
