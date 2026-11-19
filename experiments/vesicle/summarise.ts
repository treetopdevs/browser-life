// Reads the census logs that run.ts prints and gives one line per run, plus (with --corr-after STEP) the
// correlation, within each run, between the number of living cells and the two lipid-share averages over the
// samples after STEP. Samples of one run are not independent; this is a description, not a test.
// Usage: node experiments/vesicle/summarise.ts runs/vesicle/r6/*.log [--corr-after 300000]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

type Row = Record<string, number>;
const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

const args = process.argv.slice(2), ci = args.indexOf('--corr-after');
const after = ci >= 0 ? Number(args[ci + 1]) : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1));
for (const f of files) {
  const rows: Row[] = readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Row);
  if (!rows.length) { console.log(basename(f), 'no rows'); continue; }
  const last = rows[rows.length - 1], pick = [0, 1, 2, 3, 4].map((i) => rows[Math.floor((i * (rows.length - 1)) / 4)]);
  const col = (k: string) => pick.map((r) => (r[k] === undefined ? '-' : Math.round(r[k]))).join(' ');
  let line = `${basename(f).replace(/\.log$/, '').padEnd(16)} t=${last.t} live [${col('live')}] gene [${col('gene')}] perCell [${col('geneCell')}] mark [${col('mark')}] pinch ${last.pinch} burst ${last.burst}`;
  if (last.wallGene !== undefined) line += ` wall [${col('wallGene')}] wallMark [${col('wallMark')}]`;
  if (after !== undefined) {
    const late = rows.filter((r) => r.t >= after && r.live > 0);
    if (late.length >= 3) {
      line += ` | ${late.length} samples after ${after}: corr(live, perCell) ${pearson(late.map((r) => r.live), late.map((r) => r.geneCell)).toFixed(2)}, corr(live, gene) ${pearson(late.map((r) => r.live), late.map((r) => r.gene)).toFixed(2)}`;
    }
  }
  console.log(line);
}
