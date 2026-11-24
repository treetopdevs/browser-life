/**
 * What becomes of the pieces bodies break into (roam world with flow): follows every body step by step by the cells it
 * holds, and when one body's cells end up in two or more bodies, the largest piece keeps the body's name and each other
 * piece is a new body born by breaking. Budded bodies (a single let-go cell) are counted apart. At the end it says, for
 * bodies born by breaking: how many, how large at birth, how many grew to twice that, how many broke again themselves
 * (had a piece of their own, which counts a one-cell crumb the same as a half), and how long they lived.
 *
 *   deno run -A --no-lock experiments/roam/pieces.ts --seed 1 --steps 30000 --flow 0.015625 [--life 2000] [--from 10000]
 *
 * Counting starts at --from (default 10,000) so the founders' first growth is left out. A probe tool, not a test.
 */

import { foundRoam } from '../../apps/lab/src/roam/view.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const num = (k: string, d: number) => (args[k] === undefined ? d : Number(args[k]));
const steps = num('steps', 30000);
const from = num('from', 10000);
const life = num('life', 0);
const world = foundRoam({ seed: num('seed', 1), start: (args.start ?? 'grown-all') as never, drain: 2, flow: num('flow', 1 / 64), life: life > 0 ? life : undefined });
if (world.cfg.flow === undefined) throw new Error('needs a grown start with flow');

interface Life { born: number; how: 'split' | 'bud' | 'founder'; size0: number; max: number; died: number; pieces: number; parent: number }
const lives: Life[] = [];
const tagOf = new Map<number, number>(); // cell serial -> body name
const groups = new Int32Array(world.n);

for (let s = 0; s <= steps; s++) {
  const sizes = world.bodySizes(groups);
  // Cells of each group, by the name their cells carried.
  const byGroup: Map<number, number>[] = sizes.map(() => new Map());
  for (let i = 0; i < world.n; i++) {
    if (!world.alive[i]) continue;
    const tag = tagOf.get(world.cid[i]) ?? -1;
    const m = byGroup[groups[i] - 1];
    m.set(tag, (m.get(tag) ?? 0) + 1);
  }
  const next = new Map<number, number>();
  const name = new Int32Array(sizes.length).fill(-1);
  // Which group keeps a name: the largest (by cells now) of those holding any of its old cells; ties go to the one
  // holding more of its old cells, then to the lower group number.
  const best = new Map<number, { g: number; z: number; n: number }>();
  byGroup.forEach((m, g) => {
    for (const [tag, n] of m) {
      if (tag < 0) continue;
      const b = best.get(tag);
      if (!b || sizes[g] > b.z || (sizes[g] === b.z && n > b.n)) best.set(tag, { g, z: sizes[g], n });
    }
  });
  for (const [tag, { g }] of best) if (name[g] < 0) name[g] = tag;
  byGroup.forEach((m, g) => {
    if (name[g] >= 0) return;
    // A new body: its biggest old name is its parent; with no old cells it is a bud or a founder.
    let parent = -1;
    let most = 0;
    for (const [tag, n] of m) if (tag >= 0 && n > most) { most = n; parent = tag; }
    const how: Life['how'] = parent >= 0 ? 'split' : s === 0 ? 'founder' : 'bud';
    if (parent >= 0 && s >= from) lives[parent].pieces++;
    lives.push({ born: s, how, size0: sizes[g], max: sizes[g], died: -1, pieces: 0, parent });
    name[g] = lives.length - 1;
  });
  const alive = new Set<number>();
  for (let i = 0; i < world.n; i++) if (world.alive[i]) next.set(world.cid[i], name[groups[i] - 1]);
  sizes.forEach((z, g) => { const L = lives[name[g]]; if (z > L.max) L.max = z; alive.add(name[g]); });
  for (const tag of new Set(tagOf.values())) if (!alive.has(tag) && lives[tag].died < 0) lives[tag].died = s;
  tagOf.clear();
  for (const [k, v] of next) tagOf.set(k, v);
  if (s < steps) world.stepOnce();
}

const median = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : 0);
for (const how of ['split', 'bud'] as const) {
  const born = lives.filter((L) => L.how === how && L.born >= from);
  const ended = born.filter((L) => L.died >= 0);
  const grew = born.filter((L) => L.max >= 2 * L.size0);
  const bred = born.filter((L) => L.pieces > 0);
  const big = born.filter((L) => L.size0 >= 4);
  console.log(
    `${how}: ${born.length} born after step ${from}; size at birth median ${median(born.map((L) => L.size0))} (${big.length} of 4+ cells); ` +
      `${grew.length} grew to twice their birth size; ${bred.length} broke off pieces of their own; ` +
      `${ended.length} died, median life ${median(ended.map((L) => L.died - L.born))} steps; ${born.length - ended.length} still alive at the end`,
  );
  if (how === 'split') {
    const bigBred = big.filter((L) => L.pieces > 0).length;
    const bigGrew = big.filter((L) => L.max >= 2 * L.size0).length;
    console.log(`  of the ${big.length} pieces of 4+ cells: ${bigGrew} grew to twice their size, ${bigBred} broke off pieces of their own`);
  }
}
// Generations: the longest chain of bodies each born by breaking from the one before, all after --from.
const depth = new Map<number, number>();
let deepest = 0;
lives.forEach((L, k) => {
  const d = L.how === 'split' && L.born >= from && L.parent >= 0 ? (depth.get(L.parent) ?? 0) + 1 : 0;
  depth.set(k, d);
  if (d > deepest) deepest = d;
});
console.log(`longest line of bodies each broken from the one before: ${deepest} generations`);
