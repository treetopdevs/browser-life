import { BodiesWorld, FOUNDER_GENOME, hashState } from '../../../../apps/lab/src/bodies/model.ts';
import { seamStats } from '../../../../apps/lab/src/bodies/observe.ts';
// One lone founder, GATE_GROW on, mark mutation on. If GATE_GROW really means "seam == 0 by construction" the seam stays 0.
for (const [tol, step, rate] of [[16,8,4000],[16,32,4000],[16,8,40000],[4,8,4000],[0,8,4000]] as const) {
  const w = new BodiesWorld({ seed: 5, founders: 1, genome: [16,60,0,0], upkeep: true, tagMutRate: rate, rules: { GATE_GROW: 1, TAG_TOL: tol, TAG_STEP: step } });
  w.step(1500);
  const s = seamStats(w);
  // count live pairs where mark differs beyond tol AND the cell pair is a parent/daughter-like neighbour
  console.log(`tol ${tol} step ${step} rate ${rate}: cells ${w.cellCount()} tagMut ${w.tagMutations} blockedGrow ${w.blockedGrow} seamPairs ${s.seamPairs}/${s.pairs} (${s.seamPermille} permille) residual ${w.residual()}`);
}
