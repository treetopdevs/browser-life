import { BodiesWorld } from '../../../../apps/lab/src/bodies/model.ts';
import { seamStats, PatchTracker } from '../../../../apps/lab/src/bodies/observe.ts';
// (fed world so stores reach BUDMIN) Bud path: budding genome (bud 4), TAG_MUT_BUD=1, TAG_STEP (64) above TAG_TOL (16), mark mutation on every bud (rate 65536), GATE_GROW on.
for (const gg of [0, 1]) {
  const w = new BodiesWorld({ seed: 2, founders: 1, genome: [16, 60, 200, 0], upkeep: false, tagMutRate: 65536, rules: { GATE_GROW: gg, TAG_MUT_BUD: 1, TAG_STEP: 64, TAG_TOL: 16 } });
  w.step(800);
  const s = seamStats(w);
  console.log(`GATE_GROW ${gg}: cells ${w.cellCount()} births ${w.births} tagMutations ${w.tagMutations} blockedGrow ${w.blockedGrow} blockedBud ${w.blockedBud} seamPairs ${s.seamPairs}/${s.pairs} seamCells ${s.seamCells} patches ${new PatchTracker(5).sample(w).n} residual ${w.residual()}`);
}
