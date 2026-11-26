/**
 * A look at a soft roam world (apps/lab/src/softroam/kernel.ts): runs one world, prints a row every --report steps, and
 * writes a picture sheet (one column per --frames steps) and, with --movie N, a numbered frame every N steps for a video.
 *
 *   deno run -A --no-lock experiments/softroam/look.ts --seed 1 --steps 6000 --start grown-all --out runs/softroam/a
 *
 * Options: --seed, --steps, --size (128), --start (garden, the default, as before: grown-all with kinds, touch feeding, shells and cracking on | bodies, the page's own start: the seasons with herds, groves and pack hunters of 21 to 25 cells that heal, steer as one body and hunt in packs, a leaf pool and a winter upkeep | seasons, chunk 2's start: armoured grazers, leaf bushes, hunters and plates, with a day and a year, leaves, sight, fear, truce, jaws and a release cap on |
 * grown-all | grown-lines | grown-plates | grown-crosses | grown-blocks |
 * grown-specks | grown-bushes), --planMut, --founders, --mut, --report (1000), --frames, --scale (4), --movie N (with
 * --movieFrom S to start the frames at step S, and --sub K for K frames per step at alpha k/K),  --paint (garden | plain),
 * --ov '{json}' (config overrides), --opt '{json}' (start options, e.g. '{"pace":false,"shellThrust":false,"driveSpread":1}' for the bodies start without chunk 4), --lag (200), --out dir, --series FILE (a TSV with one row every --every steps, default 50: step, cells, bodies, singles,
 * largest, plain, shells, mouths, leaves, food, reservoir, leafIncome, drained, hunting, targets, fleeing, releasesHeld, meanLight, seasonLight, splits, steering, leafPool; the cumulative
 * columns leafIncome, drained and releasesHeld are totals so far; meanLight is the light over the world now, 0 to 1, seasonLight the year's light as a share of
 * midsummer's, 1 with no year).
 * Each row's "travel" is the mean straight-line distance, in tiles, that cells alive at both ends moved over the last
 * --lag steps, and "moved" the share that ended 2 or more tiles away. "smooth" is the largest and mean displacement of a
 * cell in one step, in tiles, taken over the steps since the last row (the largest is the worst step of any cell).
 * "alarms" are bonds past 2 L / overlapping pairs / cells at the speed clamp, and must stay 0: they are read every step and a row
 * shows the most of each at once since the previous row (the last line says when the first alarm came). Unknown options, an option
 * without a value or one given twice stop the run with a message.
 * Rows also show shells and mouths alive, matter taken by touch feeding (drained/k) and shells cracked (cracked/k) per 1000 steps, then leaves alive, leaf income
 * (leafInc/k), mouths hunting and distinct cells they steer toward (hunt, targ: their ratio is the target concentration), cells fleeing (flee), releases held back by the
 * release cap per 1000 steps (held/k, 'rhold'), the mean light over the world (light, 0 to 1) and how far through the year it is (year%, '-' with no year).
 * The last line reports milliseconds per frame of the painter. A probe, not an experiment runner.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { SoftRoamConfig } from '../../apps/lab/src/softroam/kernel.ts';
import { foundSoftRoam, paintSoftRoam, type SoftRoamOptions, type SoftPaint, SoftPaintMemory, softFamilies, softSky, SOFT_STARTS, type SoftRoamStart, softSmoothness, softTravel, softYearLight } from '../../apps/lab/src/softroam/view.ts';
import { writePng } from '../bodies/png.ts';

const KNOWN = ['series', 'every', 'seed', 'steps', 'size', 'start', 'planMut', 'founders', 'mut', 'report', 'frames', 'scale', 'movie', 'movieFrom', 'sub', 'paint', 'ov', 'opt', 'lag', 'out'];
const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) {
  const name = Deno.args[i];
  if (!name.startsWith('--') || !KNOWN.includes(name.slice(2))) throw new Error(`Unknown option ${name}; the options are ${KNOWN.map((k) => `--${k}`).join(', ')}`);
  const val = Deno.args[i + 1];
  if (val === undefined || val.startsWith('--')) throw new Error(`${name} needs a value`);
  if (name.slice(2) in args) throw new Error(`${name} given twice`);
  args[name.slice(2)] = val;
}
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
const steps = int('steps', 6000, 1);
const report = int('report', 1000, 1);
const lag = int('lag', 200, 1);
if (!(lag > 0 && lag < report)) throw new Error(`--lag ${lag} must be above 0 and below --report ${report}`);
const framesEvery = int('frames', Math.max(50, Math.round(steps / 8 / 50) * 50), 1);
const scale = int('scale', 4, 1);
const movie = int('movie', 0, 0);
const movieFrom = int('movieFrom', 0, 0);
const sub = int('sub', 1, 1);
const paint = (args.paint ?? 'garden') as SoftPaint;
if (!['garden', 'plain'].includes(paint)) throw new Error(`--paint ${paint}: garden or plain`);
// The garden by default, as this tool has always run (the notes' commands name no --start); the page's own start, the seasons, is `--start seasons`.
const start = (args.start ?? 'garden') as SoftRoamStart;
if (!(start in SOFT_STARTS)) throw new Error(`--start ${start}: one of ${Object.keys(SOFT_STARTS).join(', ')}`);
const out = args.out ?? 'runs/softroam/look';
const seriesFile = args.series;
const every = int('every', 50, 1);
// The report files are written after the series, so a series path that is one of them would be overwritten at the end.
if (seriesFile) for (const f of ['rows.json', 'sheet.png']) if (resolve(seriesFile) === resolve(`${out}/${f}`)) throw new Error(`--series ${seriesFile} is the run's own ${f}; pick another file`);
// With --movie the frames are written into out/frames; a series file inside that folder would replace a frame with TSV text.
if (seriesFile && movie > 0) {
  const rel = relative(resolve(out, 'frames'), resolve(seriesFile));
  // Outside means a first path segment of exactly '..' (a name like '..notes.tsv' is inside), or another root.
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error(`--series ${seriesFile} is inside the movie frames folder ${out}/frames; pick a path outside it`);
}
const overrides = JSON.parse(args.ov ?? '{}') as Partial<SoftRoamConfig>;
if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error(`--ov ${args.ov} must be a JSON object`);
// Start options (SoftRoamOptions, e.g. '{"pace":false,"shellThrust":false,"driveSpread":1}' for the bodies start without chunk 4), applied over the ones above.
const startOpts = JSON.parse(args.opt ?? '{}') as Partial<SoftRoamOptions>;
if (startOpts === null || typeof startOpts !== 'object' || Array.isArray(startOpts)) throw new Error(`--opt ${args.opt} must be a JSON object`);

const world = foundSoftRoam({
  seed: num('seed', 1),
  size: args.size === undefined ? undefined : num('size', 128),
  start,
  founders: args.founders === undefined ? undefined : int('founders', 48, 1),
  mut: args.mut === undefined ? undefined : num('mut', 0.02),
  planMut: args.planMut === undefined ? undefined : num('planMut', 0.05),
  overrides,
  ...startOpts,
});
const side = world.size * scale;
const memory = new SoftPaintMemory();
memory.observe(world);

mkdirSync(out, { recursive: true });
// The series file's folder is made now, so a long run is not lost at the end to a missing one.
if (seriesFile) mkdirSync(dirname(seriesFile), { recursive: true });
if (movie > 0) {
  const dir = `${out}/frames`;
  if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.png'))) throw new Error(`${dir} already holds frames; pick a fresh --out`);
  mkdirSync(dir, { recursive: true });
}

let paintMs = 0;
let paintN = 0;
const px = new Uint8Array(side * side * 4);
function picture(alpha = 1): Uint8Array {
  const t = performance.now();
  paintSoftRoam(world, paint, scale, alpha, px, memory);
  paintMs += performance.now() - t;
  paintN++;
  return px.slice();
}

const columns: Uint8Array[] = [];
const rows: unknown[] = [];
const travel = softTravel(world);
let lastTravel = { cells: 0, mean: 0, movedShare: 0 };
let movieN = 0;
const t0 = performance.now();
const fmt = (x: number) => x.toFixed(0).padStart(5);
let smoothMax = 0;
let smoothSum = 0;
let smoothN = 0;
let worstMax = 0;
// The alarms are read every step, and a row shows the most of each since the last row, so a spell between rows is not lost.
const alarmSeen = { bonds: 0, overlap: 0, speed: 0 };
const alarmEver = { bonds: 0, overlap: 0, speed: 0, first: -1 };

console.log(`softroam ${start} seed ${world.cfg.seed} size ${world.size} matter ${world.total} mut ${world.cfg.mut} paint ${paint} scale ${scale}`);
console.log('   step bodies   one cells   big   food   held   resv res  div/k rel/k die/k worn/k shell mouth drain/k crack/k leaf leafInc/k hunt targ flee rhold/k light year%  travel moved  smooth(max/mean)  alarms(b/o/s)  ' + 'genes');
const series: string[] = seriesFile ? ['step\tcells\tbodies\tsingles\tlargest\tplain\tshells\tmouths\tleaves\tfood\treservoir\tleafIncome\tdrained\thunting\ttargets\tfleeing\treleasesHeld\tmeanLight\tseasonLight\tsplits\tsteering\tleafPool'] : [];
let prev = world.census();
for (let s = 0; s <= steps; s++) {
  if (movie > 0 && s >= movieFrom && (s - movieFrom) % movie === 0) {
    // Frames at alpha k/K between the previous step and this one (alpha 1 is this step); the first frame has none before it.
    for (let k = s === 0 ? sub : 1; k <= sub; k++) writePng(`${out}/frames/f${String(movieN++).padStart(5, '0')}.png`, side, side, picture(k / sub));
  }
  if (s % framesEvery === 0) columns.push(picture(1));
  if (seriesFile && s % every === 0) {
    const c = world.census();
    const sky = softSky(world);
    series.push([s, c.cells, c.bodies, c.singles, c.largest, c.cells - c.shells - c.mouths - c.leaves, c.shells, c.mouths, c.leaves, c.food, c.reservoir, c.leafIncome, c.drained, c.hunting, c.targets, c.fleeing, c.releasesHeld, sky.meanLight.toFixed(4), softYearLight(world.cfg, s).toFixed(4), c.splits, c.steering, c.leafPool].join('\t'));
  }
  if (s % report === report - lag) travel();
  if (s % report === 0) {
    if (s > 0) lastTravel = travel();
    const c = world.census();
    if (c.residual !== 0) throw new Error(`matter not conserved at step ${s}: residual ${c.residual}`);
    const per = 1000 / report;
    const fams = softFamilies(world).filter((f) => f.cells > 0).map((f) => `${f.name} ${f.cells}`).join(', ');
    const meanSm = smoothN ? smoothSum / smoothN : 0;
    const sky = softSky(world);
    console.log(
      `${String(s).padStart(7)} ${fmt(c.bodies)} ${fmt(c.singles)} ${fmt(c.cells)} ${fmt(c.largest)} ${String(c.food).padStart(6)} ${String(c.held).padStart(6)} ${String(c.reservoir).padStart(6)} ${c.residual}  ` +
        `${fmt((c.divisions - prev.divisions) * per)} ${fmt((c.releases - prev.releases) * per)} ${fmt((c.cellDeaths - prev.cellDeaths) * per)} ${fmt((c.worn - prev.worn) * per)} ${fmt(c.shells)} ${fmt(c.mouths)} ${fmt((c.drained - prev.drained) * per)} ${fmt((c.cracked - prev.cracked) * per)} ${fmt(c.leaves)} ${fmt((c.leafIncome - prev.leafIncome) * per)} ${fmt(c.hunting)} ${fmt(c.targets)} ${fmt(c.fleeing)} ${fmt((c.releasesHeld - prev.releasesHeld) * per)} ${sky.meanLight.toFixed(2)} ${(world.cfg.year === undefined ? '-' : (sky.yearShare * 100).toFixed(0)).padStart(4)}  ${lastTravel.mean.toFixed(1).padStart(6)} ${(lastTravel.movedShare * 100).toFixed(0).padStart(4)}%  ` +
        `${smoothMax.toFixed(2)}/${meanSm.toFixed(3)}  ${alarmSeen.bonds}/${alarmSeen.overlap}/${alarmSeen.speed}  ` +
        c.genes.map((g) => g.toFixed(0).padStart(5)).join(' ') + `  | ${fams}`,
    );
    if (alarmSeen.bonds > 0 || alarmSeen.overlap > 0 || alarmSeen.speed > 0) console.log(`        ALARM since the last row (most at once): bonds ${alarmSeen.bonds}, overlaps ${alarmSeen.overlap}, speed ${alarmSeen.speed}`);
    rows.push({ ...c, sky, shells: c.shells, mouths: c.mouths, drainedPerK: (c.drained - prev.drained) * per, crackedPerK: (c.cracked - prev.cracked) * per, alarmsSince: { ...alarmSeen }, travelLag: lastTravel, smooth: { max: smoothMax, mean: meanSm }, families: softFamilies(world) });
    smoothMax = 0; smoothSum = 0; smoothN = 0;
    alarmSeen.bonds = 0; alarmSeen.overlap = 0; alarmSeen.speed = 0;
    prev = c;
  }
  if (s < steps) {
    world.stepOnce();
    memory.observe(world);
    const sm = softSmoothness(world);
    if (sm.max > smoothMax) smoothMax = sm.max;
    if (sm.max > worstMax) worstMax = sm.max;
    const al = world.alarms();
    if (al.bonds > alarmSeen.bonds) alarmSeen.bonds = al.bonds;
    if (al.overlap > alarmSeen.overlap) alarmSeen.overlap = al.overlap;
    if (al.speed > alarmSeen.speed) alarmSeen.speed = al.speed;
    if (al.bonds > alarmEver.bonds) alarmEver.bonds = al.bonds;
    if (al.overlap > alarmEver.overlap) alarmEver.overlap = al.overlap;
    if (al.speed > alarmEver.speed) alarmEver.speed = al.speed;
    if (alarmEver.first < 0 && (al.bonds > 0 || al.overlap > 0 || al.speed > 0)) alarmEver.first = world.step;
    smoothSum += sm.mean * sm.cells;
    smoothN += sm.cells;
  }
}

// Sheet: the columns side by side with a 2-pixel gap.
const gap = 2;
const w = columns.length * side + (columns.length - 1) * gap;
const sheet = new Uint8Array(w * side * 4).fill(255);
columns.forEach((col, k) => {
  for (let y = 0; y < side; y++) sheet.set(col.subarray(y * side * 4, (y + 1) * side * 4), (y * w + k * (side + gap)) * 4);
});
writePng(`${out}/sheet.png`, w, side, sheet);
if (seriesFile) writeFileSync(seriesFile, series.join('\n') + '\n');
writeFileSync(`${out}/rows.json`, JSON.stringify({ config: world.cfg, start, rows }, null, 1));
const secs = (performance.now() - t0) / 1000;
console.log(`${steps} steps in ${secs.toFixed(1)} s (${Math.round(steps / secs)} steps/s); digest ${world.digest().toString(16)}; worst single-step displacement ${worstMax.toFixed(2)} tiles; alarms: ${alarmEver.first < 0 ? 'none' : `first at step ${alarmEver.first}, most at once bonds ${alarmEver.bonds} / overlaps ${alarmEver.overlap} / speed ${alarmEver.speed}`}; ${out}/sheet.png has a column every ${framesEvery} steps`);
{
  // Warm timing: the same state painted repeatedly at alpha 0.5.
  for (let k = 0; k < 5; k++) paintSoftRoam(world, paint, scale, 0.5, px, memory);
  const tb = performance.now();
  const reps = 40;
  for (let k = 0; k < reps; k++) paintSoftRoam(world, paint, scale, 0.5, px, memory);
  console.log(`painter warm: ${((performance.now() - tb) / reps).toFixed(2)} ms per frame at scale ${scale} with ${world.census().cells} cells`);
}
console.log(`painter: ${(paintMs / Math.max(1, paintN)).toFixed(2)} ms per frame over ${paintN} frames at scale ${scale} (${world.census().cells} cells now)`);
