// Headless runs for the set-loose bodies prototype. No clocks, no randomness beyond the world seeds.
//
// Rules v1 (2026-11-17, fed growth + wound, long runs with mutation off/on): `--rules 1` writes the original files.
// Rules v2 (foraging + transport, scarcity throughout): default; every file is prefixed `v2-`.
//
// Usage:
//   PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/bodies/run.ts \
//     [--rules 1|2] [--out docs/bodies-2026-11-17] [--steps 20000] \
//     [--only growth|wound|long|lone|woundv2|longv2|sweep|merge] [--arm off|on|neutral|on24|neutral24] [--seed N] [--lone-size 170] [--group sweep|ablation|variants|orphan]
// `--only` is required for rules 2 (there is no combined run: it exits with an error); rules 1 defaults to all of growth, wound, long.
// v2 jobs are independent (one process each): lone, woundv2, longv2 --arm A --seed S; `--only merge` joins the parts into v2-readouts.json.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BodiesWorld, FOUNDER_GENOME, GENE_NAMES, RULES_V2, census, shareWithinFactor2, soloWorld, validateWorld } from '../../apps/lab/src/bodies/model.ts';
import type { Genome } from '../../apps/lab/src/bodies/model.ts';
import { writeFrame } from './png.ts';

const SHAPE_GENOME: Genome = [16, 60, 0, 0]; // founder shape without budding
/** off = mutation off; on = mutation 3/256 per birth; neutral = same mutation, rules read the founder genome; on24/neutral24 = the same at 24/256 (8x). */
export type Arm = 'off' | 'on' | 'neutral' | 'on24' | 'neutral24';
const armRate = (a: Arm) => (a === 'off' ? 0 : a.endsWith('24') ? 24 : RULES_V2.MUT);

const row = (w: BodiesWorld, ref = 0) => {
  const c = census(w);
  const dead = w.rootsEnded;
  return {
    t: w.t, cells: c.cells, comps: c.comps, largest: c.largest, largestSharePermille: c.largestSharePermille, interiorPermille: c.interiorPermille,
    edgesPerCellPermille: c.edgesPerCellPermille, coveragePermille: c.coveragePermille, variants: c.genomeVariants, roots: c.roots, mutations: c.mutations,
    singletons: c.singletons, sizeHist: c.sizeHist, sizeQ: c.sizeQ, within2Permille: ref ? shareWithinFactor2(c, ref) : null,
    domains: { n: c.domains.n, q: c.domains.q, unrooted: c.domains.unrooted },
    domWithin2Permille: ref ? shareWithinFactor2({ allSizes: c.domains.sizes, cells: c.cells }, ref) : null, rootAge: c.rootAge,
    rootsCreated: w.rootsCreated, rootsEnded: dead, rootLifeMeanEnded: dead ? Math.floor(w.rootLifeSum / dead) : null,
    births: w.births, foraged: w.foraged, moved: w.moved, geneMeansX10: c.geneMeansX10,
  };
};
const v1row = (w: BodiesWorld) => {
  const c = census(w);
  return { t: w.t, cells: c.cells, comps: c.comps, largest: c.largest, largestSharePermille: c.largestSharePermille, interiorPermille: c.interiorPermille,
    edgesPerCellPermille: c.edgesPerCellPermille, coveragePermille: c.coveragePermille, variants: c.genomeVariants, roots: c.roots, mutations: c.mutations, singletons: c.singletons, sizeHist: c.sizeHist };
};
const pad = (t: number, n = 4) => String(t).padStart(n, '0');

// ------------------------------------------------------------------ rules v1 (history; reproduces the 2026-11-17 files)
export function runGrowth(seed: number, steps = 200, outDir?: string) {
  const w = soloWorld(SHAPE_GENOME, seed, { version: 1 }); const series = [v1row(w)];
  const frameAt = new Set([0, 10, 25, 50, 100, 200]);
  if (outDir && frameAt.has(0)) writeFrame(join(outDir, `growth-s${seed}-t0000.png`), w);
  for (let t = 1; t <= steps; t++) {
    w.step(1);
    if (t % 5 === 0) series.push(v1row(w));
    if (outDir && frameAt.has(t)) writeFrame(join(outDir, `growth-s${seed}-t${pad(t)}.png`), w);
  }
  return { seed, series, residual: w.residual(), stateHash: w.hashState() };
}

function woundRunV1(genome: Genome, seed: number, kind: 'spared' | 'killed', dist: number, outDir?: string, tag = '') {
  const w = soloWorld(genome, seed, { version: 1 }); w.step(200);
  const before = w.cellCount(); const killed = kind === 'spared' ? w.injure(48 + dist, 48, 4) : w.injure(48, 48, 4);
  const cellsAt: Record<string, number> = { '0': w.cellCount() };
  const frames = new Set([0, 25, 75, 150]);
  if (outDir) writeFrame(join(outDir, `wound-${kind}-s${seed}${tag}-p0000.png`), w);
  for (let k = 1; k <= 150; k++) {
    w.step(1);
    if (frames.has(k)) { cellsAt[String(k)] = w.cellCount(); if (outDir) writeFrame(join(outDir, `wound-${kind}-s${seed}${tag}-p${pad(k)}.png`), w); }
  }
  const c = census(w);
  return { seed, kind, before, killed, cellsAt, recoveredPermille: Math.floor(w.cellCount() * 1000 / before), roots: c.roots, comps: c.comps, residual: w.residual() };
}

function retestV1(genome: Genome) {
  const out = [];
  for (const seed of [11, 12, 13]) {
    const w = soloWorld(genome, seed, { version: 1 }); w.step(300); const c = census(w);
    const shape: Genome = [genome[0], genome[1], 0, genome[3]];
    const dist = Math.max(6, (genome[0] >> 1) - 2);
    const wr = woundRunV1(shape, seed, 'spared', dist);
    out.push({ seed, saturated: c.cells >= 9000, cellsAt300: c.cells, compsAt300: c.comps, roots: c.roots, woundDist: dist, woundKilled: wr.killed, woundBefore: wr.before, regrowPermille: wr.recoveredPermille });
  }
  return out;
}

/** Live cells carrying exactly this genome, counted independent of rank. */
export function cellsWithGenome(w: BodiesWorld, g: Genome): number {
  let n = 0;
  for (let i = 0; i < w.cell.length; i++) if (w.cell[i] && w.g0[i] === g[0] && w.g1[i] === g[1] && w.g2[i] === g[2] && w.g3[i] === g[3]) n++;
  return n;
}

export function runLongV1(seed: number, mutation: boolean, steps: number, outDir?: string) {
  const w = new BodiesWorld({ seed, founders: 3, genome: FOUNDER_GENOME, mutRate: 0, version: 1 }); w.setMutation(mutation);
  const frameAt = new Set([0, 1000, 5000, 10000, 20000, steps]); const series = [v1row(w)]; const tagName = mutation ? 'on' : 'off';
  const snap = (t: number) => { if (outDir) writeFrame(join(outDir, `long-${tagName}-s${seed}-t${pad(t, 5)}.png`), w); };
  snap(0);
  for (let t = 1; t <= steps; t++) {
    w.step(1);
    if (t % 200 === 0) series.push(v1row(w));
    if (t > 0 && frameAt.has(t)) snap(t);
  }
  const c = census(w);
  const retests = [{ label: 'founder', genome: [...FOUNDER_GENOME], cellsInWorld: null as number | null, runs: retestV1(FOUNDER_GENOME) }];
  c.top.forEach((g, i) => retests.push({ label: i === 0 ? 'dominant' : `top${i + 1}`, genome: [...g.genome], cellsInWorld: g.cells, runs: retestV1(g.genome) }));
  return {
    seed, mutation, steps, series, residual: w.residual(), validate: validateWorld(w), stateHash: w.hashState(),
    final: { ...v1row(w), sizesTop8: c.sizes, dominant: c.dominant, top3: c.top, geneNames: GENE_NAMES, geneMeansX10: c.geneMeansX10, founderGenomeCellsAtEnd: cellsWithGenome(w, FOUNDER_GENOME) },
    retests,
  };
}

// ------------------------------------------------------------------ rules v2 (scarcity throughout)
/** One founder alone, upkeep on: does a single body persist, and at what size? */
export function runLone(seed: number, genome: Genome, steps: number, outDir?: string, label = 'shape') {
  const w = new BodiesWorld({ seed, founders: 1, genome, mutRate: 0 }); const series = [row(w)];
  const frames = new Set([0, 500, 5000, steps]);
  const snap = (t: number) => { if (outDir) writeFrame(join(outDir, `v2-lone-${label}-s${seed}-t${pad(t, 5)}.png`), w); };
  snap(0);
  for (let t = 1; t <= steps; t++) { w.step(1); if (t % 200 === 0) series.push(row(w)); if (frames.has(t)) snap(t); }
  return { seed, genome: [...genome], label, steps, series, residual: w.residual(), validate: validateWorld(w), stateHash: w.hashState() };
}

export type WoundClass = 'root-spared' | 'root-hit' | 'root-killed' | 'no-root';
/**
 * Choose and classify a radius-4 wound from the roots that are alive now (roots can move after re-rooting).
 * killed: centre on the oldest live root. spared: centre on the live cell whose nearest root is closest to `dist` tiles
 * and outside the disk; if no such cell exists the nominal spot is used and the class says root-hit when it overlaps a root.
 */
export function placeWound(w: BodiesWorld, kind: 'spared' | 'killed', dist: number, r = 4): { cx: number; cy: number; cls: WoundClass; rootsInDisk: number; rootsBefore: number } {
  const W = 96, H = 96, roots: number[] = [];
  for (let i = 0; i < W * H; i++) if (w.cell[i] && w.d[i] === 0) roots.push(i);
  const d2 = (a: number, b: number) => { const dx = Math.min((a % W - b % W + W) % W, (b % W - a % W + W) % W), dy = Math.min((((a / W) | 0) - ((b / W) | 0) + H) % H, (((b / W) | 0) - ((a / W) | 0) + H) % H); return dx * dx + dy * dy; };
  let c = -1;
  if (kind === 'killed') { for (const i of roots) if (c < 0 || w.rootSince[i] < w.rootSince[c]) c = i; }
  else {
    let bestGap = Infinity;
    for (let i = 0; i < W * H; i++) {
      if (!w.cell[i]) continue;
      let nd = Infinity; for (const q of roots) nd = Math.min(nd, d2(i, q));
      if (nd <= r * r) continue;
      const gap = Math.abs(nd - dist * dist); if (gap < bestGap) { bestGap = gap; c = i; }
    }
  }
  const nominal = kind === 'spared' ? 48 + dist + 48 * W : 48 + 48 * W;
  const centre = c >= 0 ? c : nominal;
  const rootsInDisk = roots.filter((q) => d2(centre, q) <= r * r).length;
  const cls: WoundClass = !roots.length ? 'no-root' : kind === 'killed' ? (rootsInDisk > 0 ? 'root-killed' : 'root-hit') : rootsInDisk === 0 ? 'root-spared' : 'root-hit';
  return { cx: centre % W, cy: (centre / W) | 0, cls, rootsInDisk, rootsBefore: roots.length };
}

/** Lone body under scarcity, settle, wound radius 4 (root spared, or killed on the oldest live root), watch. The class is recorded. */
export function woundRunV2(genome: Genome, seed: number, kind: 'spared' | 'killed', dist: number, outDir?: string, settle = 2000, watch = 1500, tag = '', rules: Record<string, number> = {}) {
  const w = new BodiesWorld({ seed, founders: 1, genome, mutRate: 0, rules }); w.step(settle);
  const before = w.cellCount(); const c0 = census(w);
  const pl = placeWound(w, kind, dist); const killed = w.injure(pl.cx, pl.cy, 4);
  const cellsAt: Record<string, number> = { '0': w.cellCount() }, rootsAt: Record<string, number> = { '0': census(w).roots };
  const frames = new Set([0, 150, watch]); const at = new Set([25, 75, 150, 500, watch]);
  const snap = (k: number) => { if (outDir) writeFrame(join(outDir, `v2-wound-${kind}-s${seed}${tag}-p${pad(k)}.png`), w); };
  snap(0);
  for (let k = 1; k <= watch; k++) {
    w.step(1);
    if (at.has(k)) { cellsAt[String(k)] = w.cellCount(); rootsAt[String(k)] = census(w).roots; }
    if (frames.has(k)) snap(k);
  }
  const c = census(w);
  return {
    seed, kind, settle, before, rootsBefore: c0.roots, woundClass: pl.cls, woundCentre: [pl.cx, pl.cy], rootsInDisk: pl.rootsInDisk, killed, cellsAt, rootsAt, recoveredPermille: Math.floor(w.cellCount() * 1000 / before),
    roots: c.roots, comps: c.comps, residual: w.residual(),
  };
}

/** Late-genome retest under scarcity: genome alone (as evolved), and a budding-off copy wounded with the root spared. */
export function retestV2(genome: Genome, seeds = [11, 12, 13], steps = 3000) {
  const out = [];
  for (const seed of seeds) {
    const w = new BodiesWorld({ seed, founders: 1, genome, mutRate: 0 }); const cells: Record<string, number> = {};
    for (let t = 1; t <= steps; t++) { w.step(1); if (t === 1000 || t === steps) cells[String(t)] = w.cellCount(); }
    const c = census(w);
    const shape: Genome = [genome[0], genome[1], 0, genome[3]];
    const dist = Math.max(6, (genome[0] >> 1) - 2);
    const wr = woundRunV2(shape, seed, 'spared', dist, undefined, 2000, 1500);
    out.push({
      seed, cells, comps: c.comps, roots: c.roots, rootsEnded: w.rootsEnded, rootAgeMedian: c.rootAge.median, saturated: c.cells >= 4500,
      woundDist: dist, woundClass: wr.woundClass, woundCentre: wr.woundCentre, woundRootsInDisk: wr.rootsInDisk, woundBefore: wr.before, woundKilled: wr.killed, woundCellsAfter: wr.cellsAt[String(1500)], regrowPermille: wr.recoveredPermille, regrowCounts: wr.woundClass === 'root-spared',
      woundSaturated: wr.before >= 4500,
    });
  }
  return out;
}

export function runLongV2(seed: number, arm: Arm, steps: number, outDir?: string, lone = 170) {
  const w = new BodiesWorld({ seed, founders: 3, genome: FOUNDER_GENOME, mutRate: armRate(arm), blind: arm.startsWith('neutral') });
  const frameAt = new Set([1000, 5000, 10000, steps]); const series = [row(w, lone)];
  const snap = (t: number) => { if (outDir) writeFrame(join(outDir, `v2-long-${arm}-s${seed}-t${pad(t, 5)}.png`), w); };
  for (let t = 1; t <= steps; t++) { w.step(1); if (t % 200 === 0) series.push(row(w, lone)); if (frameAt.has(t)) snap(t); }
  const c = census(w);
  const retests: { label: string; genome: number[]; cellsInWorld: number | null; runs: ReturnType<typeof retestV2> }[] = [];
  if (arm === 'off') retests.push({ label: 'founder', genome: [...FOUNDER_GENOME], cellsInWorld: null, runs: retestV2(FOUNDER_GENOME) });
  else c.top.slice(0, 2).forEach((g, i) => retests.push({ label: i === 0 ? 'dominant' : 'top2', genome: [...g.genome], cellsInWorld: g.cells, runs: retestV2(g.genome) }));
  return {
    seed, arm, steps, loneRef: lone, series, residual: w.residual(), validate: validateWorld(w), stateHash: w.hashState(),
    final: { ...row(w, lone), sizesTop8: c.sizes, dominant: c.dominant, top3: c.top, geneNames: GENE_NAMES, founderGenomeCellsAtEnd: cellsWithGenome(w, FOUNDER_GENOME), domainSizesTop8: c.domains.sizes.slice(0, 8) },
    retests,
  };
}

/** Scratch-style design comparisons, kept reproducible: lone body, seeds 1-3, 4000 steps, upkeep on. */
export function loneSummary(genome: Genome, seed: number, rules: Record<string, number>, version: 1 | 2 = 2, steps = 4000) {
  const w = new BodiesWorld({ seed, founders: 1, genome, mutRate: 0, version, rules });
  const at: Record<string, number> = {};
  for (let t = 1; t <= steps; t++) { w.step(1); if (t === 1000 || t === 2000 || t === steps) at[String(t)] = w.cellCount(); }
  const c = census(w);
  return { seed, cellsAt: at, comps: c.comps, roots: c.roots, rootsCreated: w.rootsCreated, residual: w.residual() };
}
export const SWEEP_DMAX = [8, 12, 14, 16, 20, 24, 32];
export const ABLATIONS: [string, Record<string, number>][] = [['full v2', {}], ['no transport (FLOW 0)', { FLOW: 0 }], ['no foraging (FORAGE 0)', { FORAGE: 0 }], ['neither (retuned constants only)', { FORAGE: 0, FLOW: 0 }]];
/** Variants tried while designing v2, expressed as overrides of the final v2 constants (dmax 16, shape genome). */
export const VARIANTS: [string, Record<string, number>][] = [
  ['A: forage + transport on the v1 constants (UPK 4, INIT_FOOD 32)', { UPK: 4, INIT_FOOD: 32 }],
  ['B: A with INIT_FOOD 4', { UPK: 4 }],
  ['C: UPK 6', { UPK: 6 }],
  ['D: final constants but orphan rooting at the v1 rate (ORPHP 2/256 per step; ORPH16 0)', { ORPH16: 0 }],
  ['E: KEEP 0 (foraging may drain a tile to zero)', { KEEP: 0 }],
  ['F: KEEP 1', { KEEP: 1 }],
  ['final v2: UPK 8, INIT_FOOD 4, ORPH16 16, KEEP 3', {}],
];

function main() {
  const args = process.argv.slice(2); const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const out = opt('out', 'docs/bodies-2026-11-17'), steps = Number(opt('steps', '20000')), only = opt('only', 'all'), rules = Number(opt('rules', '2'));
  if (rules !== 1 && !['lone', 'woundv2', 'longv2', 'sweep', 'merge'].includes(only)) {
    console.error(`rules 2 has no combined run: pass --only lone|woundv2|longv2|sweep|merge (got '${only}'); see the header and the README for the job list`);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  if (rules === 1) {
    const res: Record<string, unknown> = { meta: { rulesVersion: 1, steps, founderGenome: FOUNDER_GENOME, shapeGenome: SHAPE_GENOME, note: 'growth and wound runs are fed (upkeep off, one founder, no budding); long runs have upkeep on and three founders' } };
    if (only === 'all' || only === 'growth') { res.growth = [1, 2, 3].map((s) => runGrowth(s, 200, out)); console.log('growth done'); }
    if (only === 'all' || only === 'wound') {
      res.wound = [1, 2, 3].flatMap((s) => (['spared', 'killed'] as const).map((k) => woundRunV1(SHAPE_GENOME, s, k, 6, out)));
      console.log('wound done');
    }
    if (only === 'all' || only === 'long') {
      const long = [];
      for (const seed of [1, 2, 3]) for (const mutation of [false, true]) {
        const r = runLongV1(seed, mutation, steps, out); long.push(r);
        console.log(`long seed ${seed} mutation ${mutation ? 'on' : 'off'}: cells ${r.final.cells} comps ${r.final.comps} variants ${r.final.variants} residual ${r.residual}`);
      }
      res.long = long;
    }
    writeFileSync(join(out, only === 'all' ? 'readouts.json' : `readouts-${only}.json`), JSON.stringify(res, null, 1) + '\n');
    return;
  }
  const part = (name: string, data: unknown) => writeFileSync(join(out, `v2-part-${name}.json`), JSON.stringify(data) + '\n');
  if (only === 'lone') {
    const lone = [];
    for (const [label, genome] of [['shape', SHAPE_GENOME], ['founder', FOUNDER_GENOME]] as const) for (const seed of [1, 2, 3]) {
      const r = runLone(seed, genome, steps, out, label); lone.push(r);
      console.log(`lone ${label} s${seed}: cells ${r.series.at(-1)!.cells} roots ${r.series.at(-1)!.roots} residual ${r.residual}`);
    }
    part('lone', lone);
  } else if (only === 'woundv2') {
    const wound = [1, 2, 3].flatMap((s) => (['spared', 'killed'] as const).map((k) => woundRunV2(SHAPE_GENOME, s, k, 6, out)));
    for (const r of wound) console.log(`wound ${r.kind} s${r.seed}: before ${r.before} killed ${r.killed} after ${JSON.stringify(r.cellsAt)}`);
    part('wound', wound);
  } else if (only === 'longv2') {
    const arm = opt('arm', 'off') as Arm, seed = Number(opt('seed', '1'));
    const r = runLongV2(seed, arm, steps, out, Number(opt('lone-size', '170')));
    console.log(`long ${arm} s${seed}: cells ${r.final.cells} comps ${r.final.comps} domains ${r.final.domains.n} variants ${r.final.variants} residual ${r.residual}`);
    part(`long-${arm}-s${seed}`, r);
  } else if (only === 'sweep') {
    const group = opt('group', 'sweep'); const res: unknown[] = [];
    if (group === 'sweep') for (const dm of SWEEP_DMAX) res.push({ dmax: dm, runs: [1, 2, 3].map((s) => loneSummary([dm, 60, 0, 0], s, {})) });
    if (group === 'ablation') for (const [name, o] of ABLATIONS) for (const dm of [12, 16]) res.push({ name, dmax: dm, runs: [1, 2, 3].map((s) => loneSummary([dm, 60, 0, 0], s, o)) });
    if (group === 'orphan') for (const o16 of [0, 16]) res.push({ ORPH16: o16, note: 'lone shape genome, 2000 steps settle, root killed, 1500 steps watched', runs: [1, 2, 3].map((s) => woundRunV2(SHAPE_GENOME, s, 'killed', 6, undefined, 2000, 1500, '', { ORPH16: o16 })) });
    if (group === 'variants') for (const [name, o] of VARIANTS) res.push({ name, rules: o, runs: [1, 2, 3].map((s) => loneSummary(SHAPE_GENOME, s, o)) });
    writeFileSync(join(out, `v2-sweep-${group}.json`), JSON.stringify(res, null, 1) + '\n'); console.log(`sweep ${group} done`);
  } else if (only === 'merge') {
    const merged: Record<string, unknown> = { meta: { rulesVersion: 2, steps, rules: RULES_V2, founderGenome: FOUNDER_GENOME, shapeGenome: SHAPE_GENOME, note: 'every run has upkeep on; lone/wound use one founder, long runs three founders; neutral arm reads the founder genome in the dynamics' } };
    const long: unknown[] = [];
    for (const f of readdirSync(out).sort()) {
      if (!f.startsWith('v2-part-')) continue;
      const data = JSON.parse(readFileSync(join(out, f), 'utf8'));
      if (f.includes('part-lone')) merged.lone = data; else if (f.includes('part-wound')) merged.wound = data; else long.push(data);
    }
    merged.long = long;
    writeFileSync(join(out, 'v2-readouts.json'), JSON.stringify(merged) + '\n');
    console.log(`merged ${long.length} long parts; has lone ${'lone' in merged} wound ${'wound' in merged}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
