/**
 * Which plans are alive in a roam world, and what each one grows when left alone.
 *
 *   deno run -A --no-lock experiments/roam/plans.ts --seed 1 --steps 150000 --start grown-all --drain 2 --top 4
 *
 * Runs the world, lists the plans holding the most cells, and for each grows one founder by itself (fed by hand,
 * never moving, with every daughter it lets go taken away) so its outline can be set beside the planted plans'. It
 * says whether that outline is the same as the one the planted ancestor grows alone, and how many entries differ
 * among the modes either plan could reach (following kept daughters and next modes from mode 0; a mode that could
 * be reached is not always entered, and a changed entry does not always change what grows).
 */

import { PLAN_MODES, PLAN_REST, RoamWorld, defaultRoamConfig } from '../../apps/lab/src/roam/kernel.ts';
import { foundRoam, roamShapes, type RoamStart, ROAM_STARTS } from '../../apps/lab/src/roam/view.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const int = (k: string, d: number) => {
  const v = args[k] === undefined ? d : Number(args[k]);
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`--${k} ${args[k]} must be a whole number`);
  return v;
};
const start = (args.start ?? 'grown-all') as RoamStart;
if (!(start in ROAM_STARTS)) throw new Error(`--start ${start}`);
const steps = int('steps', 150000);
const top = int('top', 4);
const drain = int('drain', 2);
const mut = args.mut === undefined ? 0.02 : Number(args.mut);
if (!(mut >= 0 && mut <= 1)) throw new Error(`--mut ${args.mut}`);

const world = foundRoam({ seed: int('seed', 1), start, mut, drain: drain > 0 ? drain : undefined });
if (!world.cfg.plan) throw new Error(`--start ${start} does not grow by plan`);
world.advance(steps);
if (world.census().residual !== 0) throw new Error('matter not conserved');

/** The modes a body could reach from one cell in mode 0, ignoring taken tiles and the size limit. */
function reach(plan: ArrayLike<number>): Set<number> {
  const seen = new Set<number>([0]);
  const todo = [0];
  while (todo.length) {
    const e = plan[todo.pop()!];
    const act = e & 15;
    if (act >= PLAN_REST) continue;
    // A kept daughter's mode counts; so does the cell's next mode. A daughter let go starts again at 0.
    for (const m of act < 4 ? [(e >>> 4) & 15, (e >>> 8) & 15] : [(e >>> 8) & 15]) if (!seen.has(m)) { seen.add(m); todo.push(m); }
  }
  return seen;
}

/**
 * Grow one founder alone and return its outline as rows of # and . It stops once neither the body's size nor any of
 * its cells' modes has changed for 1,500 steps (from there on it only repeats itself), or at 30,000 steps, in which
 * case `settled` is false.
 */
function alone(plan: ArrayLike<number>): { art: string; cells: number; released: number; settled: boolean } {
  const w = new RoamWorld({ ...defaultRoamConfig(), size: 96, seed: 1, matter: 90_000, patchFood: 90_000, startPatches: 0, mut: 0, leakSide: 0, leakCell: 0, moveCost: 0, plan: true });
  const at = 48 * 96 + 48;
  w.found(at, [0, 0, -512, 0, 0], 1, undefined, w.addPlan(plan));
  const bodyOf = new Int32Array(w.n);
  let size = 1;
  let modes = 0;
  let quiet = 0;
  for (let s = 0; s < 30000 && quiet < 1500; s++) {
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.reservoir > 0) { w.food[i]++; w.reservoir--; }
    w.stepOnce();
    // Take away every body but the founder's (cell number 1 is the founder).
    w.bodySizes(bodyOf);
    let mine = 0;
    for (let i = 0; i < w.n; i++) if (w.cid[i] === 1) mine = bodyOf[i];
    let now = 0;
    let modesNow = 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue;
      if (bodyOf[i] === mine) { now++; modesNow = (Math.imul(modesNow, 31) + i * 16 + w.mode[i]) | 0; continue; }
      w.reservoir += w.store[i];
      w.alive[i] = 0; w.store[i] = 0; w.cid[i] = 0; w.pid[i] = 0; w.mode[i] = 0; w.orient[i] = 0; w.grew[i] = 0; w.fam[i] = 0; w.heading[i] = 0; w.since[i] = 0;
    }
    quiet = now === size && modesNow === modes ? quiet + 1 : 0;
    size = now;
    modes = modesNow;
  }
  const o = roamShapes(w, 1).shapes[0];
  const art = Array.from({ length: o.h }, (_, y) => Array.from({ length: o.w }, (_, x) => (o.cells.some((p) => p[0] === x && p[1] === y) ? '#' : '.')).join('')).join('\n');
  return { art, cells: o.cells.length, released: w.releases, settled: quiet >= 1500 };
}

const cellsOf = new Map<number, number>();
for (let i = 0; i < world.n; i++) if (world.alive[i]) cellsOf.set(world.pid[i], (cellsOf.get(world.pid[i]) ?? 0) + 1);
const ranked = [...cellsOf.entries()].sort((a, b) => b[1] - a[1]);
const root = (id: number) => { let depth = 0; while (world.planParent[id] !== 0) { id = world.planParent[id]; depth++; } return { id, depth }; };
const planted = ROAM_STARTS[start];
console.log(`${start} seed ${world.cfg.seed} drain ${world.cfg.drain ?? 0} at step ${world.step}: ${ranked.length} plans alive of ${world.plans.length - 1} ever, ${world.census().cells} cells`);
const plantedAlone = planted.map((_, k) => alone(world.plans[k + 1]));
let same = 0;
let changed = 0;
let listed = 0;
for (const [id, cells] of ranked.slice(0, top)) {
  const r = root(id);
  const a = reach(world.plans[id]);
  const b = reach(world.plans[r.id]);
  let differ = 0;
  for (let m = 0; m < PLAN_MODES; m++) if ((a.has(m) || b.has(m)) && world.plans[id][m] !== world.plans[r.id][m]) differ++;
  const grown = alone(world.plans[id]);
  const was = plantedAlone[r.id - 1];
  const sameOutline = grown.art === was.art;
  listed += cells;
  if (sameOutline) same += cells; else changed += cells;
  console.log(`\nplan ${id}: ${cells} cells; descends from planted "${planted[r.id - 1]}" through ${r.depth} changed copies; ${differ} entries differ among the modes either could reach; alone it grows ${grown.cells} cells${grown.settled ? '' : ' (still changing when stopped)'} and lets go ${grown.released} daughters; outline alone is ${sameOutline ? 'THE SAME as' : 'DIFFERENT from'} its planted ancestor's${sameOutline ? '' : ':'}`);
  if (!sameOutline) console.log(grown.art);
}
console.log(`\nof ${world.census().cells} cells, the plans listed hold ${listed}: ${same} in plans that alone grow their planted ancestor's outline, ${changed} in plans that grow a different one`);
console.log('\nthe planted plans, grown alone the same way:');
for (let k = 0; k < planted.length; k++) {
  const grown = plantedAlone[k];
  console.log(`\n"${planted[k]}": ${grown.cells} cells${grown.settled ? '' : ' (still changing when stopped)'}, ${grown.released} daughters let go`);
  console.log(grown.art);
}
