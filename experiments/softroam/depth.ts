/**
 * A first look at Soft Roam with depth (levels in the top-down world; see the kernel header): the bodies start with `depth` on, herds
 * founded on the floor, pack hunters in mid-water and groves at the surface, and a row every --report steps of who lives on which level.
 *
 *   deno run -A --no-lock experiments/softroam/depth.ts --seed 1 --steps 12000 --ov '{"depthGap":40}'
 *
 * Options: --start (bodies; deep has depth on by itself), --seed (1), --steps (12000), --size (128), --depth (3; 0 runs the start flat, for comparison), --report (1000),
 * --ov '{json}' (config overrides). Columns: cells and bodies, the largest body, then per level (floor first) cells as
 * plain/shell/mouth/leaf, then level changes, matter taken by touch and earned by leaves per 1000 steps, the mean lift, and the
 * residual (must be 0). A probe on seen seeds, not an experiment runner.
 */

import { KIND_LEAF, KIND_MOUTH, KIND_SHELL, type SoftRoamConfig } from '../../apps/lab/src/softroam/kernel.ts';
import { foundSoftRoam, type SoftRoamStart } from '../../apps/lab/src/softroam/view.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const seed = Number(args.seed ?? 1);
const steps = Number(args.steps ?? 12000);
const depthArg = Number(args.depth ?? 3);
const report = Number(args.report ?? 1000);
const ov: Partial<SoftRoamConfig> = args.ov ? JSON.parse(args.ov) : {};

const world = foundSoftRoam({ seed, start: (args.start ?? 'bodies') as SoftRoamStart, size: args.size ? Number(args.size) : undefined, depth: depthArg > 0 ? depthArg : (false as unknown as number), overrides: ov });
// The levels are the world's own (an override may set them).
const depth = world.cfg.depth ?? 0;
// The founders' levels are the view's (DEEP_HOME): herds (family 15) on the floor, pack hunters (17) in the middle, groves (16) at the surface.

console.log(`seed ${seed} depth ${depth} ${JSON.stringify(ov)}`);
console.log('step\tcells\tbodies\tlargest\t' + Array.from({ length: Math.max(depth, 1) }, (_, k) => `L${k} p/s/m/l`).join('\t') + '\tmoves\tdrained/k\tleafInc/k\tlift\tfam 15/16/17\tresidual');
let lastDrained = 0;
let lastLeaf = 0;
for (let t = 0; t <= steps; t++) {
  if (t % report === 0) {
    const cs = world.census();
    const n = Math.max(depth, 1);
    const per = Array.from({ length: n }, () => [0, 0, 0, 0]);
    const fam: Record<number, number> = { 15: 0, 16: 0, 17: 0 };
    let lift = 0;
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const lv = depth > 0 ? world.level[c] : 0;
      const k = world.kind[c];
      per[lv][k === KIND_SHELL ? 1 : k === KIND_MOUTH ? 2 : k === KIND_LEAF ? 3 : 0]++;
      fam[world.fam[c]] = (fam[world.fam[c]] ?? 0) + 1;
      if (depth > 0) lift += world.lift[c];
    }
    console.log([t, cs.cells, cs.bodies, cs.largest, ...per.map((p) => p.join('/')), cs.levelMoves, Math.round(((cs.drained - lastDrained) * 1000) / report), Math.round(((cs.leafIncome - lastLeaf) * 1000) / report), cs.cells > 0 ? Math.round(lift / cs.cells) : 0, `${fam[15]}/${fam[16]}/${fam[17]}`, cs.residual].join('\t'));
    lastDrained = cs.drained;
    lastLeaf = cs.leafIncome;
  }
  if (t < steps) world.stepOnce();
}
