// Observer-only: tolerance distribution over live cells every 1000 steps. usage: node tolscan.ts <out.json> <same flags as v3.ts>
import { writeFileSync } from 'node:fs';
import { parseArgs, buildWorld } from '../../../../experiments/bodies/v3.ts';
const out = process.argv[2]; const o = parseArgs([...process.argv.slice(3), '--out', '/dev/null', '--no-frames', '--quiet']);
const { w } = buildWorld(o); const rows: unknown[] = [];
for (let t = 1; t <= o.steps; t++) {
  w.step(1);
  if (t % 1000 === 0) {
    const v: number[] = []; const kinSet = new Set<number>();
    for (let i = 0; i < w.R.N; i++) if (w.cell[i]) { v.push(w.kinTol[i]); kinSet.add(w.kin[i]); }
    v.sort((a, b) => a - b); const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    const hist: Record<number, number> = {}; for (const x of v) hist[x] = (hist[x] ?? 0) + 1;
    rows.push({ t, cells: v.length, min: v[0], q10: q(0.1), q50: q(0.5), q90: q(0.9), max: v.at(-1), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), kinDistinct: kinSet.size, tolDistinct: Object.keys(hist).length, hist, tagMut: w.tagMutations, blockedGrow: w.blockedGrow });
  }
}
writeFileSync(out, JSON.stringify(rows) + '\n');
