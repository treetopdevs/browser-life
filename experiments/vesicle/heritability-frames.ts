// One frame of one arm at a chosen step, coloured by founder (a clone's descendants share a hue), for the stage-0 write-up.
// Usage: node experiments/vesicle/heritability-frames.ts free|gate|wall MUT SEED STEP OUTDIR
import { join } from 'node:path';
import { HEREDITY, WALL_GATE, WALL_GENES } from '../../apps/lab/src/vesicle/worlds.ts';
import { runGarden } from './run.ts';
import { writeFrame } from './frame.ts';

const [arm, mut, seed, steps, dir, colour = 'founder'] = process.argv.slice(2);
const params = { ...(arm === 'free' ? HEREDITY : arm === 'wall' ? WALL_GENES : WALL_GATE), mut: Number(mut) };
const r = runGarden({ seed: +seed, steps: +steps, every: +steps, quiet: true, params });
writeFrame(join(dir, `${arm}-mut${mut}-s${seed}-t${String(steps).padStart(6, '0')}-${colour}.png`), r.world, 4, colour as 'founder' | 'gene' | 'mark', 'none');
console.log(arm, 'live', r.rows[r.rows.length - 1].live, 'digest', r.digest);
