// Skeptic: exact per-step event counting of "a tile is refilled by a cell whose mark does not match the mark of the last cell that stood there".
import { writeFileSync } from 'node:fs';
import { BodiesWorld, FOUNDER_GENOME } from '/Users/nicholas/develop/browser-life-bodies/apps/lab/src/bodies/model.ts';
import { parseArgs } from '/Users/nicholas/develop/browser-life-bodies/experiments/bodies/v3.ts';
const argv = process.argv.slice(2); const rest: string[] = []; let out = '';
for (let k = 0; k < argv.length; k++) { if (argv[k] === '--sk-out') out = argv[++k]; else rest.push(argv[k]); }
rest.push('--out', '/tmp/unused-sk', '--no-frames');
const o = parseArgs(rest); const N = 9216;
const FOUNDER_SPOTS = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
const n = o.founders; const tags = o.tags === 'same' ? new Array(n).fill(0) : Array.from({ length: n }, (_, i) => Math.floor(i * 256 / n));
const w = new BodiesWorld({ seed: o.seed, founders: n, positions: FOUNDER_SPOTS.slice(0, n) as any, founderTags: tags, genome: (o.genome ?? FOUNDER_GENOME) as any, mutRate: o.mut ? o.mutRate : 0, blind: o.geneBlind, upkeep: o.upkeep, tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, rules: o.rules });
const tol = w.R.TAG_TOL;
const prevLive = new Uint8Array(N), lastMark = new Int16Array(N).fill(-1), lastStep = new Int32Array(N).fill(-1);
for (let i = 0; i < N; i++) if (w.cell[i]) { prevLive[i] = 1; lastMark[i] = w.kin[i]; lastStep[i] = 0; }
const win = 1000; const rows: any[] = []; let cur = { births: 0, refillAny: 0, refill200: 0, refill1000: 0, deaths: 0 };
const dist = (a: number, b: number) => { let x = Math.abs(a - b); if (x > 128) x = 256 - x; return x; };
for (let t = 1; t <= o.steps; t++) {
  w.step(1);
  for (let i = 0; i < N; i++) {
    const live = w.cell[i];
    if (live && !prevLive[i]) {
      cur.births++;
      if (lastMark[i] >= 0 && dist(lastMark[i], w.kin[i]) > tol) { cur.refillAny++; const gap = t - lastStep[i]; if (gap <= 200) cur.refill200++; if (gap <= 1000) cur.refill1000++; }
    } else if (!live && prevLive[i]) cur.deaths++;
    if (live) { lastMark[i] = w.kin[i]; lastStep[i] = t; }
    prevLive[i] = live;
  }
  if (t % win === 0) { rows.push({ t, ...cur, cells: w.cellCount() }); cur = { births: 0, refillAny: 0, refill200: 0, refill1000: 0, deaths: 0 }; }
}
writeFileSync(out, JSON.stringify({ args: argv, rows, hashFull: undefined }));
