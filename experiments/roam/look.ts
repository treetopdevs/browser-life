/**
 * A look at a roam world (apps/lab/src/roam/kernel.ts): runs one world, prints a row every --report steps, and writes
 * a picture sheet (one column per --frames steps) and, with --movie N, a numbered frame every N steps for a video.
 *
 *   deno run -A --no-lock experiments/roam/look.ts --seed 1 --steps 20000 --start chasers --out runs/roam/a
 *
 * Options: --seed, --steps, --size (128), --start (chasers | wanderers | sitters | singles | chasers-sitters | chasers-singles |
 * chasers-wanderers | all | grown-lines | grown-plates | grown-crosses | grown-blocks | grown-specks | grown-bushes |
 * grown-four | grown-all; the grown starts use growth by plan), --planMut, --founders, --mut (chance per gene per division), --report (1000), --frames,
 * --scale (4), --movie N (with --movieFrom S to start the frames at step S), --paint (garden | family | genes | plan), --ov '{json}' (config overrides), --out dir.
 * Each row's "travel" is the mean straight-line distance, in tiles, that cells alive at both ends moved over the last
 * --lag steps (200), and "moved" the share of them that ended 2 or more tiles away.
 * A probe, not an experiment runner: no arms, no summary beyond rows.json.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { ROAM_GENE_NAMES, ROAM_GENES, type RoamConfig } from '../../apps/lab/src/roam/kernel.ts';
import { foundRoam, paintRoam, roamFamilies, type RoamPaint, roamShapes, type RoamStart, ROAM_STARTS, roamTravel } from '../../apps/lab/src/roam/view.ts';
import { writePng } from '../bodies/png.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const num = (k: string, d: number) => {
  if (args[k] === undefined) return d;
  const v = Number(args[k]);
  if (!Number.isFinite(v)) throw new Error(`--${k} ${args[k]} is not a number`);
  return v;
};

const int = (k: string, d: number, min: number) => {
  const v = num(k, d);
  if (!Number.isSafeInteger(v) || v < min) throw new Error(`--${k} ${v} must be a whole number of at least ${min}`);
  return v;
};
const steps = int('steps', 20000, 1);
const report = int('report', 1000, 1);
const lag = int('lag', 200, 1);
if (!(lag > 0 && lag < report)) throw new Error(`--lag ${lag} must be above 0 and below --report ${report}`);
const framesEvery = int('frames', Math.max(50, Math.round(steps / 8 / 50) * 50), 1);
const scale = int('scale', 4, 1);
const movie = int('movie', 0, 0);
const movieFrom = int('movieFrom', 0, 0);
const paint = (args.paint ?? 'family') as RoamPaint;
if (!['garden', 'family', 'genes', 'plan'].includes(paint)) throw new Error(`--paint ${paint}: garden, family, genes or plan`);
const start = (args.start ?? 'chasers') as RoamStart;
if (!(start in ROAM_STARTS)) throw new Error(`--start ${start}: one of ${Object.keys(ROAM_STARTS).join(', ')}`);
const out = args.out ?? 'runs/roam/look';
const overrides = JSON.parse(args.ov ?? '{}') as Partial<RoamConfig>;

const world = foundRoam({ seed: num('seed', 1), size: args.size === undefined ? undefined : num('size', 128), start, founders: args.founders === undefined ? undefined : int('founders', 48, 1), mut: args.mut === undefined ? undefined : num('mut', 0.02), planMut: args.planMut === undefined ? undefined : num('planMut', 0.05), overrides });
const side = world.size * scale;
const bodyOf = new Int32Array(world.n);

mkdirSync(out, { recursive: true });
if (movie > 0) {
  const dir = `${out}/frames`;
  if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.png'))) throw new Error(`${dir} already holds frames; pick a fresh --out`);
  mkdirSync(dir, { recursive: true });
}

function picture(): Uint8Array {
  const px = new Uint8Array(side * side * 4);
  paintRoam(world, scale, paint, px, bodyOf);
  return px;
}

const columns: Uint8Array[] = [];
const rows: unknown[] = [];
const travel = roamTravel(world);
let lastTravel = { cells: 0, mean: 0, movedShare: 0 };
let movieN = 0;
const t0 = performance.now();
const fmt = (x: number) => x.toFixed(0).padStart(5);

console.log(`roam ${start} seed ${world.cfg.seed} size ${world.size} matter ${world.total} mut ${world.cfg.mut}`);
console.log('   step bodies   one cells   big   food   held   resv res  div/k rel/k die/k newb/k taken/k travel moved  ' + ROAM_GENE_NAMES.join('  '));
let prev = world.census();
for (let s = 0; s <= steps; s++) {
  if (movie > 0 && s >= movieFrom && (s - movieFrom) % movie === 0) writePng(`${out}/frames/f${String(movieN++).padStart(5, '0')}.png`, side, side, picture());
  if (s % framesEvery === 0) columns.push(picture());
  if (s % report === report - lag) travel();
  if (s % report === 0) {
    if (s > 0) lastTravel = travel();
    const c = world.census();
    if (c.residual !== 0) throw new Error(`matter not conserved at step ${s}: residual ${c.residual}`);
    const per = 1000 / report;
    const fams = roamFamilies(world).filter((f) => f.cells > 0).map((f) => `${f.name} ${f.cells}`).join(', ');
    console.log(
      `${String(s).padStart(7)} ${fmt(c.bodies)} ${fmt(c.singles)} ${fmt(c.cells)} ${fmt(c.largest)} ${String(c.food).padStart(6)} ${String(c.held).padStart(6)} ${String(c.reservoir).padStart(6)} ${c.residual}  ` +
        `${fmt((c.divisions - prev.divisions) * per)} ${fmt((c.releases - prev.releases) * per)} ${fmt((c.bodyDeaths - prev.bodyDeaths) * per)} ${fmt((c.newbornDeaths - prev.newbornDeaths) * per)} ${String(Math.round((c.drained - prev.drained) * per)).padStart(7)}  ${lastTravel.mean.toFixed(1).padStart(6)} ${(lastTravel.movedShare * 100).toFixed(0).padStart(4)}%  ` +
        c.genes.map((g) => g.toFixed(0).padStart(5)).join(' ') + `  | ${fams}`,
    );
    const sh = roamShapes(world, 6);
    if (world.cfg.flow !== undefined) {
      const sizes = world.bodySizes().sort((x, y) => y - x);
      const big = sizes.filter((x) => x >= 8).length;
      // Spread of the movement genes over bodies (each body's cell average, weighted by its cells): two kinds of body
      // would show as a wide gap between the 10th and 90th percentile.
      const groups = new Int32Array(world.n);
      const gs = world.bodySizes(groups);
      const sum = gs.map(() => [0, 0]);
      for (let i = 0; i < world.n; i++) {
        if (!world.alive[i]) continue;
        sum[groups[i] - 1][0] += world.genes[i * ROAM_GENES + 0];
        sum[groups[i] - 1][1] += world.genes[i * ROAM_GENES + 1];
      }
      const pct = (gi: number) => {
        const rows = gs.map((z, g) => ({ v: sum[g][gi] / z, z })).sort((x, y) => x.v - y.v);
        const tot = rows.reduce((a2, r) => a2 + r.z, 0);
        return [0.1, 0.5, 0.9].map((q) => { let acc = 0; for (const r of rows) { acc += r.z; if (acc >= q * tot) return Math.round(r.v); } return 0; }).join('/');
      };
      if (world.cfg.kinds) console.log(`        kinds: ${c.shells} shells, ${c.mouths} mouths of ${c.cells} cells; cracked/k ${Math.round((c.cracked - prev.cracked) * per)}; shell toughness ${c.shellTough.toFixed(2)}; taken by touch/k ${Math.round((c.drained - prev.drained) * per)}`);
      console.log(`        spread by body (p10/p50/p90, cell-weighted): chase ${pct(0)}, drive ${pct(1)}`);
      console.log(`        flow: splits/k ${Math.round((c.splits - prev.splits) * per)}, buds/k ${Math.round((c.releases - prev.releases) * per)}, cell deaths/k ${Math.round((c.cellDeaths - prev.cellDeaths) * per)} (worn ${Math.round((c.worn - prev.worn) * per)}), left on the ground/k ${Math.round((c.composted - prev.composted) * per)}, moved along bonds/k ${Math.round((c.flowed - prev.flowed) * per)}; bodies of 8+ cells ${big}; ten largest ${sizes.slice(0, 10).join(' ')}`);
    }
    if (world.cfg.plan) {
      // The outlines holding the most cells, each as rows of # and . with the number of bodies that have it.
      const art = (cells: number[][], w: number, h: number) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (cells.some((p) => p[0] === x && p[1] === y) ? '#' : '.')).join('')).join('/');
      console.log(`        ${sh.plans} plans alive of ${world.plans.length - 1} ever, ${sh.outlines} outlines: ` + sh.shapes.map((q) => `${q.count}x ${art(q.cells, q.w, q.h)}`).join('  '));
    }
    rows.push({ ...c, travel: lastTravel, families: roamFamilies(world), plans: sh.plans, outlines: sh.outlines, shapes: sh.shapes });
    prev = c;
  }
  if (s < steps) world.stepOnce();
}

// Sheet: the columns side by side with a 2-pixel gap.
const gap = 2;
const w = columns.length * side + (columns.length - 1) * gap;
const sheet = new Uint8Array(w * side * 4).fill(255);
columns.forEach((col, k) => {
  for (let y = 0; y < side; y++) sheet.set(col.subarray(y * side * 4, (y + 1) * side * 4), (y * w + k * (side + gap)) * 4);
});
writePng(`${out}/sheet.png`, w, side, sheet);
writeFileSync(`${out}/rows.json`, JSON.stringify({ config: world.cfg, start, rows }, null, 1));
const secs = (performance.now() - t0) / 1000;
console.log(`${steps} steps in ${secs.toFixed(1)} s (${Math.round(steps / secs)} steps/s); digest ${world.digest().toString(16)}; ${out}/sheet.png has a column every ${framesEvery} steps`);
