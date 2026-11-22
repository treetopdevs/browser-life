/**
 * Reads the segment files of the B2 compartment check and prints the readouts per world, seed and tracked window.
 *
 *   deno run -A --no-lock experiments/b2check/summarize.ts --runs runs/b2check --json docs/b2-compartment-check-2026-11-21/summary.json
 *   deno run -A --no-lock experiments/b2check/summarize.ts --runs runs/b2check/dev        # the seed 1 development runs
 */

import { argOf } from '../confirm/io.ts';
import type { TrackerResult } from './observe.ts';
import { windowReadouts, type WindowReadouts } from './readouts.ts';
import { answerWorld, classifyDivision, classifyWindow, type Reading } from './verdict.ts';

interface SegmentFile {
  meta: { world: string; seed: number; size: number; dt: number };
  segment: { from: number; to: number; tracked: boolean };
  rows: { t: number; drop: number; d1: number; phage: number; res: number }[];
  tracker: TrackerResult | null;
}

export interface WindowSummary {
  world: string;
  seed: number;
  size: number;
  readouts: WindowReadouts;
  reading: Reading;
  d1: number;
  phageAlive: boolean;
}

const runs = argOf('runs');
const jsonOut = argOf('json', '');
const WORLDS = ['PHAGE', 'NO_PHAGE', 'SINGLE_WALL', 'ONE64_B2', 'ONE64_SPOT'];
/** First step of each world's settled window (PLAN.md, "Windows and run lengths"). */
const SETTLED_FROM: Record<string, number> = { PHAGE: 60_000, SINGLE_WALL: 60_000, NO_PHAGE: 220_000, ONE64_B2: 10_000, ONE64_SPOT: 10_000 };
const REPORT_SEEDS = [13, 14, 15, 16];
const summaries: WindowSummary[] = [];
const countSeries: { world: string; seed: number; rows: { t: number; drop: number; d1: number }[] }[] = [];

for (const world of WORLDS) {
  let seedDirs: string[] = [];
  try {
    seedDirs = [...Deno.readDirSync(`${runs}/${world}`)].filter((e) => e.isDirectory && e.name.startsWith('seed-')).map((e) => e.name);
  } catch {
    continue;
  }
  seedDirs.sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  for (const sd of seedDirs) {
    const dir = `${runs}/${world}/${sd}`;
    const segs = [...Deno.readDirSync(dir)].filter((e) => e.name.startsWith('seg-') && e.name.endsWith('.json')).map((e) => e.name);
    segs.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    const all: { t: number; drop: number; d1: number }[] = [];
    for (const name of segs) {
      const file = JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as SegmentFile;
      if (file.rows.some((r) => r.res !== 0)) throw new Error(`matter residual in ${dir}/${name}`);
      for (const r of file.rows) all.push({ t: r.t, drop: r.drop, d1: r.d1 });
      if (!file.tracker) continue;
      const readouts = windowReadouts(file.tracker, file.rows, file.meta.dt);
      const last = file.rows[file.rows.length - 1];
      summaries.push({
        world,
        seed: file.meta.seed,
        size: file.meta.size,
        readouts,
        reading: classifyWindow(readouts),
        d1: file.rows.reduce((a, r) => a + r.d1, 0) / file.rows.length,
        phageAlive: last.phage > 0,
      });
    }
    countSeries.push({ world, seed: Number(sd.slice(5)), rows: all });
  }
}

const f = (x: number | null, d = 2) => (x === null ? 'n/a' : x.toFixed(d));
const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(0)}%`);

console.log('## Readouts per world, seed and tracked window\n');
console.log('| World | Seed | Window | Count (min to max) | Kept id +100 / +500 / +1,000 | Moved in 1,000 steps (tiles, n) | Tiles kept +1,000 (same id) | Tiles still wall +100 / +1,000 (chance) | Solid | Isolated | Moat | Peak wall median / p90 / largest at a census | Area | Reading |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summaries) {
  const r = s.readouts;
  console.log(
    `| ${s.world} | ${s.seed} | ${r.from} to ${r.to} | ${f(r.count, 1)} (${r.countMin} to ${r.countMax}) | ${pct(r.surv100)} / ${pct(r.surv500)} / ${pct(r.surv1000)} | ${f(r.disp1000, 1)} (${r.disp1000N}) | ${pct(r.keepUid1000)} | ${pct(r.keepMask100)} / ${pct(r.keepMask1000)} (${pct(r.chance1000)}) | ${pct(r.solid)} | ${pct(r.isolated)} | ${f(r.moatMedian)} | ${f(r.peakMedian)} / ${f(r.peakP90)} / ${f(r.maxW)} | ${f(r.areaMedian, 0)} | ${s.reading.label} |`,
  );
}

console.log('\n## Births, ends and division per world, seed and tracked window\n');
console.log('| World | Seed | Window | Object-steps (thousands) | Births: fission / switch / from nothing | Births still present after 500: fission / switch / from nothing | Ends: fade / absorbed / switch | Births per object per 1,000 steps | Fission daughters (n): present after 500 / rejoined parent | Median lifetime of objects born and ended in window (n) | Displacement in 100 steps | Type-blind count | Low-wall patches (largest share) | Tiles in objects | Tiles with total wall of 0.05 or more | Mean D1 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summaries) {
  const r = s.readouts;
  console.log(
    `| ${s.world} | ${s.seed} | ${r.from} to ${r.to} | ${f(r.objectKiloSteps, 0)} | ${r.births.fission} / ${r.births.switch} / ${r.births.denovo} | ${r.lastingBirths.fission} / ${r.lastingBirths.switch} / ${r.lastingBirths.denovo} | ${r.ends.fade} / ${r.ends.absorbed} / ${r.ends.switch} | ${f(r.birthRate, 3)} | ${r.daughters}: ${pct(r.daughtersHeld500)} / ${pct(r.daughtersRejoined500)} | ${f(r.lifetimeMedian, 0)} (${r.lifetimeN}) | ${f(r.disp100)} | ${f(r.dropBlind, 1)} | ${f(r.lowComps, 1)} (${pct(r.lowLargestShare)}) | ${pct(r.cover)} | ${pct(r.lowCover)} | ${f(s.d1)} |`,
  );
}

console.log('\n## Droplet count by stretch of the run (settling check)\n');
console.log('| World | Seed | Stretch | Mean count | Mean D1 |');
console.log('|---|---|---|---|---|');
for (const cs of countSeries) {
  const end = cs.rows.length ? cs.rows[cs.rows.length - 1].t : 0;
  const edges = [0, 10_000, 20_000, 40_000, 60_000, 80_000, 120_000, 160_000, 200_000, 220_000, 240_000].filter((e) => e < end);
  edges.push(end);
  for (let k = 0; k + 1 < edges.length; k++) {
    const w = cs.rows.filter((r) => r.t > edges[k] && r.t <= edges[k + 1]);
    if (w.length === 0) continue;
    console.log(`| ${cs.world} | ${cs.seed} | ${edges[k]} to ${edges[k + 1]} | ${f(w.reduce((a, r) => a + r.drop, 0) / w.length, 1)} | ${f(w.reduce((a, r) => a + r.d1, 0) / w.length)} |`);
  }
}

// Range over the reported seeds, per world and tracked window.
const range = (xs: (number | null)[], fmt: (x: number) => string): string => {
  const v = xs.filter((x): x is number => x !== null);
  if (v.length === 0) return 'n/a';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const text = fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
  return v.length < xs.length ? `${text} (${v.length} of ${xs.length} seeds)` : text;
};
const p0 = (x: number) => `${(100 * x).toFixed(0)}%`;
const endShare = (r: WindowReadouts, k: 'fade' | 'absorbed' | 'switch'): number | null => {
  const all = r.ends.fade + r.ends.absorbed + r.ends.switch;
  return all > 0 ? r.ends[k] / all : null;
};
const n1 = (x: number) => x.toFixed(1);
const n2 = (x: number) => x.toFixed(2);
console.log('\n## Range over seeds 13 to 16, per world and tracked window\n');
console.log('| World | Window | Seeds | Count | Kept id +100 | Kept id +1,000 | Moved in 100 steps (tiles) | Moved in 1,000 steps (tiles) | Tiles kept +1,000 (same id) | Tiles still wall +100 | Tiles still wall +1,000 | Chance | Solid | Isolated | Moat | Median peak wall | Largest wall on a tile of an object, any frame | Median area (tiles) | Tiles in objects | Tiles with total wall of 0.05 or more | Largest low-wall patch share | Median purity | Median lifetime, objects born and ended in window (steps) | Ends: fade | Ends: absorbed | Ends: switch | Readings |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const world of WORLDS) {
  const mine = summaries.filter((s) => s.world === world && REPORT_SEEDS.includes(s.seed));
  const froms = [...new Set(mine.map((s) => s.readouts.from))].sort((a, b) => a - b);
  for (const from of froms) {
    const w = mine.filter((s) => s.readouts.from === from);
    const col = (pick: (r: WindowReadouts) => number | null, fmt: (x: number) => string) => range(w.map((s) => (s.readouts.samples === 0 ? null : pick(s.readouts))), fmt);
    const labels = new Map<string, number>();
    for (const s of w) labels.set(s.reading.label, (labels.get(s.reading.label) ?? 0) + 1);
    console.log(
      `| ${world} | ${from} to ${w[0].readouts.to} | ${w.map((s) => s.seed).join(', ')} | ${range(w.map((s) => s.readouts.count), n1)} | ${col((r) => r.surv100, p0)} | ${col((r) => r.surv1000, p0)} | ${col((r) => r.disp100, n1)} | ${col((r) => r.disp1000, n1)} | ${col((r) => r.keepUid1000, p0)} | ${col((r) => r.keepMask100, p0)} | ${col((r) => r.keepMask1000, p0)} | ${col((r) => r.chance1000, p0)} | ${col((r) => r.solid, p0)} | ${col((r) => r.isolated, p0)} | ${col((r) => r.moatMedian, n2)} | ${col((r) => r.peakMedian, n2)} | ${col((r) => r.maxPeak, n2)} | ${col((r) => r.areaMedian, n1)} | ${col((r) => r.cover, p0)} | ${col((r) => r.lowCover, p0)} | ${col((r) => r.lowLargestShare, p0)} | ${col((r) => r.purityMedian, n2)} | ${col((r) => r.lifetimeMedian, (x) => x.toFixed(0))} | ${col((r) => endShare(r, 'fade'), p0)} | ${col((r) => endShare(r, 'absorbed'), p0)} | ${col((r) => endShare(r, 'switch'), p0)} | ${[...labels].map(([l, k]) => `${l}: ${k}`).join('; ')} |`,
    );
  }
}

console.log('\n## Answer per world (settled window, seeds 13 to 16; division pooled over all tracked windows of those seeds)\n');
console.log('| World | Settled window | Reading per seed | Bodies criteria not met (seed: criteria) | Wave criteria not met (seed: criteria) | Count not settled in window (seeds) | Lasting births: with a parent / all | Division | Answer |');
console.log('|---|---|---|---|---|---|---|---|---|');
const answers: Record<string, unknown> = {};
for (const world of WORLDS) {
  const mine = summaries.filter((s) => s.world === world && REPORT_SEEDS.includes(s.seed));
  const settled = mine.filter((s) => s.readouts.from === SETTLED_FROM[world]);
  if (settled.length === 0) continue;
  const division = classifyDivision(mine.map((s) => s.readouts));
  const answer = settled.length === REPORT_SEEDS.length ? answerWorld(settled.map((s) => s.reading.label), division) : `incomplete (${settled.length} of ${REPORT_SEEDS.length} seeds)`;
  const notMet = (keys: readonly ('B1' | 'B2' | 'B3' | 'V1' | 'V2' | 'V3')[]) =>
    settled
      .map((s) => {
        const bad = keys.filter((k) => s.reading.checks[k] !== true);
        return bad.length ? `${s.seed}: ${bad.join(' ')}` : '';
      })
      .filter((x) => x.length > 0)
      .join('; ') || 'none';
  const unsettled = settled.filter((s) => !s.reading.settled).map((s) => s.seed).join(', ');
  console.log(
    `| ${world} | ${SETTLED_FROM[world]} to ${settled[0].readouts.to} | ${settled.map((s) => `${s.seed}: ${s.reading.label}`).join('; ')} | ${notMet(['B1', 'B2', 'B3'])} | ${notMet(['V1', 'V2', 'V3'])} | ${unsettled || 'none'} | ${division.withParent} / ${division.lasting} | ${division.label} | ${answer} |`,
  );
  answers[world] = { settledWindow: [SETTLED_FROM[world], settled[0].readouts.to], perSeed: Object.fromEntries(settled.map((s) => [s.seed, s.reading])), division, answer };
}

if (jsonOut) {
  await Deno.writeTextFile(jsonOut, JSON.stringify({ answers, summaries, countSeries: countSeries.map((c) => ({ world: c.world, seed: c.seed, censuses: c.rows.length })) }, null, 1) + '\n');
  console.log(`\nwrote ${jsonOut}`);
}
