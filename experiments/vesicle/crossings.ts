// Checks a heredity garden for wall crossings after every single step (run.ts only checks at each census).
// Usage: node experiments/vesicle/crossings.ts [--seed 1] [--steps 30000] [--wall]
// Prints one JSON line: the most crossings seen at once, how many steps had any, and the event counts.
import { check, countCrossings } from '../../apps/lab/src/vesicle/observe.ts';
import { HEREDITY, WALL_GENES, garden } from '../../apps/lab/src/vesicle/worlds.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const seed = Number(arg('seed') ?? 1), steps = Number(arg('steps') ?? 30000);
const w = garden(seed, { params: process.argv.includes('--wall') ? WALL_GENES : HEREDITY }), m0 = w.matter();
let worst = 0, stepsWithCrossing = 0;
for (let t = 0; t < steps; t++) {
  w.tick();
  const x = countCrossings(w);
  if (x) stepsWithCrossing++;
  if (x > worst) worst = x;
}
console.log(JSON.stringify({ seed, steps, worst, stepsWithCrossing, pinch: w.events.pinch, desorb: w.events.desorb, insert: w.events.insert, matterOk: w.matter() === m0, check: check(w) }));
if (worst > 0 || w.matter() !== m0) process.exitCode = 1;
