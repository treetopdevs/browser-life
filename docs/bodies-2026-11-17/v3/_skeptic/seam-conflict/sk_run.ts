// Skeptic runner: reuses the explorer's flag parser, but writes raw state snapshots for independent analysis.
// extra flags: --sk-out DIR (required)  --sk-every N (snapshot interval, default 100)  --sk-pos "x,y;x,y;..." (founder positions override)
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { BodiesWorld, FOUNDER_GENOME, hashState, hashStateFull } from '/Users/nicholas/develop/browser-life-bodies/apps/lab/src/bodies/model.ts';
import { parseArgs } from '/Users/nicholas/develop/browser-life-bodies/experiments/bodies/v3.ts';

const argv = process.argv.slice(2); const mine: Record<string, string> = {}; const rest: string[] = [];
for (let k = 0; k < argv.length; k++) {
  if (['--sk-out', '--sk-every', '--sk-pos'].includes(argv[k])) { mine[argv[k]] = argv[++k]; } else rest.push(argv[k]);
}
rest.push('--out', '/tmp/unused-sk'); rest.push('--no-frames');
const o = parseArgs(rest);
const out = mine['--sk-out']; if (!out) throw new Error('--sk-out');
const every = Number(mine['--sk-every'] ?? 100);
const FOUNDER_SPOTS = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
const pair = o.scenario === 'pair'; const n = pair ? 2 : o.founders;
let positions: number[][] = pair ? [[48 - Math.floor(o.gap / 2), 48], [48 - Math.floor(o.gap / 2) + o.gap, 48]] : FOUNDER_SPOTS.slice(0, n);
if (mine['--sk-pos']) positions = mine['--sk-pos'].split(';').map((p) => p.split(',').map(Number));
if (positions.length !== n) throw new Error('positions count');
let tags: number[];
if (o.tags === 'same') tags = new Array(n).fill(0); else if (o.tags) tags = o.tags; else tags = pair ? [64, 192] : Array.from({ length: n }, (_, i) => Math.floor(i * 256 / n));
const genome = o.genome ?? (pair ? [16, 60, 0, 0] : FOUNDER_GENOME);
const w = new BodiesWorld({ seed: o.seed, founders: n, positions: positions as any, founderTags: tags, genome: genome as any, mutRate: o.mut ? o.mutRate : 0, blind: o.geneBlind, upkeep: o.upkeep, tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, rules: o.rules });
mkdirSync(out, { recursive: true });
const bin = join(out, 'snaps.bin'); writeFileSync(bin, new Uint8Array(0));
const snap = () => {
  const buf = new Uint8Array(4 * 9216); buf.set(w.cell, 0); buf.set(w.kin, 9216); buf.set(w.d, 2 * 9216); buf.set(w.kinTol, 3 * 9216);
  appendFileSync(bin, buf);
};
const times: number[] = [];
snap(); times.push(0);
for (let t = 1; t <= o.steps; t++) { w.step(1); if (t % every === 0) { snap(); times.push(t); } }
writeFileSync(join(out, 'meta.json'), JSON.stringify({ args: argv, steps: o.steps, every, times, positions, tags, hashFull: hashStateFull(w), hash: hashState(w), residual: w.residual(), cells: w.cellCount(),
  counters: { blockedGrow: w.blockedGrow, blockedBud: w.blockedBud, raided: w.raided, seamBurned: w.seamBurned, tagMutations: w.tagMutations, births: w.births }, rules: w.R }));
