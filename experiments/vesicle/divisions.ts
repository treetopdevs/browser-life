// Productive divisions: a pinch counts as productive when both of its daughters later divide themselves (each daughter's id
// appears as the mother of a later pinch). Reads run bundles (s<seed>.json, s<seed>.pinch.tsv); streams the pinch log line by
// line. Pure reader; changes no run.
// Usage: node experiments/vesicle/divisions.ts DIR [DIR ...] [--from 20000] [--pinch-from 0] [--tail 20000] [--json out.json]
//   DIR is an arm folder holding s<seed>/ run folders (or one run folder). Counted: pinches from step `pinch-from` to `tail` steps
//   before the run's last step (later daughters had no time to divide); live cells are the mean of the census rows from `from` on.
//   The rate is productive pinches per mean live cell per 100,000 steps of the pinch window.
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export interface Divisions { run: string; steps: number; pinches: number; inWindow: number; productive: number; meanLive: number; rate: number }

/** One run folder holding s<seed>.json and s<seed>.pinch.tsv. */
export async function divisions(dir: string, from = 20000, tail = 20000, pinchFrom = 0): Promise<Divisions | undefined> {
  const seed = basename(dir).replace(/^s/, ''), json = join(dir, `s${seed}.json`), log = join(dir, `s${seed}.pinch.tsv`);
  if (!existsSync(json) || !existsSync(log)) return undefined;
  const rows = (JSON.parse(readFileSync(json, 'utf8')).rows as Record<string, number>[]), steps = rows[rows.length - 1].t;
  const live = rows.filter((r) => r.t >= from).map((r) => r.live), meanLive = live.length ? live.reduce((a, b) => a + b, 0) / live.length : NaN;
  const mothers = new Set<number>(), kept: [number, number][] = [];
  let head: string[] | undefined, pinches = 0;
  for await (const line of createInterface({ input: createReadStream(log), crlfDelay: Infinity })) {
    if (!line) continue;
    const c = line.split('\t');
    if (!head) { head = c; continue; }
    if (c[0] !== 'pinch') continue;
    const step = Number(c[1]);
    pinches++; mothers.add(Number(c[2]));
    if (step >= pinchFrom && step <= steps - tail) kept.push([Number(c[3]), Number(c[4])]);
  }
  const productive = kept.filter(([a, b]) => mothers.has(a) && mothers.has(b)).length, span = steps - tail - pinchFrom;
  return { run: dir, steps, pinches, inWindow: kept.length, productive, meanLive, rate: span > 0 && meanLive > 0 ? (productive / meanLive) * (100000 / span) : NaN };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), opt = (k: string) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const from = Number(opt('from') ?? 20000), pinchFrom = Number(opt('pinch-from') ?? 0), tail = Number(opt('tail') ?? 20000), out = opt('json');
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-'), all: Record<string, Divisions[]> = {};
  console.log(`| arm | run | steps | pinches (all) | pinches ${pinchFrom / 1000}k..end-${tail / 1000}k | productive | share | mean live (censuses ${from / 1000}k on) | productive / live cell / 100k steps |`);
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const arm of args) {
    const runs = existsSync(join(arm, `${basename(arm)}.json`)) ? [arm] : readdirSync(arm).filter((d) => /^s\d+$/.test(d)).sort().map((d) => join(arm, d));
    const got: Divisions[] = [];
    for (const r of runs) {
      const d = await divisions(r, from, tail, pinchFrom);
      if (!d) continue;
      got.push(d);
      console.log(`| ${arm} | ${basename(r)} | ${d.steps} | ${d.pinches} | ${d.inWindow} | ${d.productive} | ${f((100 * d.productive) / d.inWindow)}% | ${f(d.meanLive)} | ${f(d.rate, 2)} |`);
    }
    const m = (k: keyof Divisions) => got.reduce((a, d) => a + (d[k] as number), 0) / got.length;
    if (got.length > 1) console.log(`| ${arm} | mean of ${got.length} | | ${f(m('pinches'))} | ${f(m('inWindow'))} | ${f(m('productive'))} | ${f((100 * m('productive')) / m('inWindow'))}% | ${f(m('meanLive'))} | ${f(m('rate'), 2)} |`);
    all[arm] = got;
  }
  if (out) writeFileSync(out, JSON.stringify(all, null, 1));
}
