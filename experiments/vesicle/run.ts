// Headless garden runs for the vesicle world: a census table, optional frames, structural checks.
// Usage: node experiments/vesicle/run.ts --out DIR [--seed 1] [--steps 50000] [--every 2500] [--frames]
//          [--params '{"kLip":0.001}'] [--heredity] [--neutral] [--wound-every N] [--founders 6] [--food N] [--colour founder|gene|mark]
//          [--mut 0.01] (shift rate per copy; overrides the arm's default) [--pinch-log] (needs --out: writes s<seed>.pinch.tsv and s<seed>.cells.tsv, pure observer)
//          [--thread] (stage 1: one genome object per cell, free-floating) [--thread-anchored] (threads ride on a wall bead's inner face) [--founder-mark 96 | 96,160] (thread marker gene)
//          [--wild] (stage 3: big dish, drifting light patches, weather; combine with --wall/--gate/--thread/--heredity) [--wild-area 4 (default) | 1 | 9 | 16] [--no-light] [--no-weather]
//          [--wall] (heredity in the wall beads) [--gate] (control: solute heredity, copies only at the inner face) [--founder-gene 96 | 96,160] [--chimera 64,192]
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Params } from '../../apps/lab/src/vesicle/model.ts';
import { LineageObserver, cellHeader, cellLine, census, check, eventHeader, eventLine, loops } from '../../apps/lab/src/vesicle/observe.ts';
import { HEREDITY, THREAD, THREAD_ANCHORED, WALL_GATE, WALL_GENES, Weather, garden, wild } from '../../apps/lab/src/vesicle/worlds.ts';
import type { GardenOpts } from '../../apps/lab/src/vesicle/worlds.ts';
import { writeFrame } from './frame.ts';
import type { ColourBy } from './frame.ts';

export interface RunOpts extends GardenOpts { seed: number; steps: number; every: number; out?: string; frames?: boolean; colour?: ColourBy; quiet?: boolean; woundEvery?: number; pinchLog?: boolean }

export function runGarden(o: RunOpts) {
  const w = garden(o.seed, o), m0 = w.matter(), rows: Record<string, number>[] = [];
  let weather: Weather | undefined, t0 = Date.now();
  const sample = () => {
    const c = census(w), live = c.loops.filter((l) => l.solute >= 5);
    let g = 0, mk = 0;
    for (let k = 0; k < w.n; k++) { g += w.gene[k]; mk += w.mark[k]; }
    const founders = new Set<number>();
    for (const l of live) { let best = 0, bn = 0; for (const [f, n] of l.founders) if (n > bn) { bn = n; best = f; } founders.add(best); }
    const row = {
      t: w.step, loops: c.loops.length, live: live.length, solute: c.particles, freeSolute: c.freeSolute, beads: c.beads, freeLipid: c.freeLipid, food: c.food, waste: c.waste,
      pinch: w.events.pinch, dissolve: w.events.dissolve, burst: w.events.burst, births: w.events.birth, founders: founders.size,
      medSolute: live.length ? live.map((l) => l.solute).sort((a, b) => a - b)[live.length >> 1] : 0,
      // geneCell: every cell counts once, however much solute it holds (gene is the mean over particles)
      geneCell: live.length ? Math.round((10 * live.reduce((a, l) => a + l.geneMean, 0)) / live.length) / 10 : 0,
      gene: w.n ? Math.round((10 * g) / w.n) / 10 : 0, mark: w.n ? Math.round((10 * mk) / w.n) / 10 : 0,
    } as Record<string, number>;
    if (w.p.thread) {
      // threads: totals, those outside every ring, copies and decays so far; live cells holding none; gene means over threads
      let t0 = 0, t1 = 0;
      for (let k = 0; k < w.nt; k++) { t0 += w.tgene[k * w.p.tG]; t1 += w.tgene[k * w.p.tG + 1]; }
      row.threads = w.nt; row.threadsOut = c.freeThreads; row.tcopy = w.events.tcopy; row.tdecay = w.events.tdecay;
      row.liveNoThread = live.filter((l) => l.threads === 0).length;
      row.liveThreads1 = live.filter((l) => l.threads === 1).length;
      row.liveThreads2 = live.filter((l) => l.threads === 2).length;
      row.liveThreads3p = live.filter((l) => l.threads >= 3).length;
      row.thread0 = w.nt ? Math.round((10 * t0) / w.nt) / 10 : 0; row.thread1 = w.nt ? Math.round((10 * t1) / w.nt) / 10 : 0;
    }
    if (w.p.wallGenes) {
      // every living cell counts once: mean of the cells' wall bytes, how far cells differ, how mixed one wall is
      const r1 = (v: number) => Math.round(10 * v) / 10, n = live.length, mean = n ? live.reduce((a, l) => a + l.wallGene, 0) / n : 0;
      row.wallGene = r1(mean); row.wallMark = r1(n ? live.reduce((a, l) => a + l.wallMark, 0) / n : 0);
      row.wallBetween = r1(n ? Math.sqrt(live.reduce((a, l) => a + (l.wallGene - mean) ** 2, 0) / n) : 0);
      row.wallWithin = r1(n ? live.reduce((a, l) => a + l.wallGeneSd, 0) / n : 0);
      row.medBeads = n ? live.map((l) => l.beads).sort((a, b) => a - b)[n >> 1] : 0;
      // with shifts off every wall keeps its founder's byte exactly, so cells can be counted by it
      // (a cell whose wall is mixed is counted under `cells@mixed`); and all beads can be counted by their byte
      if (w.p.mut === 0) {
        for (const l of live) { const key = l.wallGeneSd > 0 ? 'cells@mixed' : `cells@${Math.round(l.wallGene)}`; row[key] = (row[key] ?? 0) + 1; }
        for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) { const key = `beads@${w.wgene[i]}`; row[key] = (row[key] ?? 0) + 1; }
        // and, within rings whose wall is still mixed, beads by byte (a change here is not a contest between cells)
        const seen = new Uint8Array(w.beadHi);
        for (let i = 0; i < w.beadHi; i++) {
          if (!w.alive[i] || seen[i]) continue;
          const tally = new Map<number, number>();
          for (let m = i; !seen[m]; m = w.next[m]) { seen[m] = 1; tally.set(w.wgene[m], (tally.get(w.wgene[m]) ?? 0) + 1); }
          if (tally.size > 1) for (const [g, n] of tally) row[`mixedBeads@${g}`] = (row[`mixedBeads@${g}`] ?? 0) + n;
          // chimera starts mark each founder's wall: per founder, its rings and its beads by byte
          if (o.chimera) {
            const f = w.wmark[i];
            row[`clan${f}:rings`] = (row[`clan${f}:rings`] ?? 0) + 1;
            for (const [g, n] of tally) row[`clan${f}:beads@${g}`] = (row[`clan${f}:beads@${g}`] ?? 0) + n;
          }
        }
      }
    }
    if (o.woundEvery) row.wounds = weather?.wounds ?? 0;
    row.ms = Date.now() - t0;
    rows.push(row);
    if (!o.quiet) console.log(JSON.stringify(row));
  };
  // lineage observer: streams events and per-cell records to disk; reads the world, never changes it
  let obs: LineageObserver | undefined, fdE = -1, fdC = -1, bufE: string[] = [], bufC: string[] = [];
  const flush = (force = false) => {
    if (fdE >= 0 && (force || bufE.length > 2000)) { writeSync(fdE, bufE.join('')); bufE = []; }
    if (fdC >= 0 && (force || bufC.length > 2000)) { writeSync(fdC, bufC.join('')); bufC = []; }
  };
  const cells = () => { obs!.forEachCell((id, s) => bufC.push(cellLine(w.step, id, s, w.p.thread) + '\n')); flush(); };
  if (o.pinchLog) {
    if (!o.out) throw new Error('--pinch-log needs --out');
    fdE = openSync(join(o.out, `s${o.seed}.pinch.tsv`), 'w'); fdC = openSync(join(o.out, `s${o.seed}.cells.tsv`), 'w');
    bufE.push(eventHeader(w.p.thread) + '\n'); bufC.push(cellHeader(w.p.thread) + '\n');
    obs = new LineageObserver(w, (e) => { bufE.push(eventLine(e, w.p.thread) + '\n'); flush(); });
    cells();
  }
  sample();
  t0 = Date.now();
  try {
  if (o.frames && o.out) writeFrame(join(o.out, `s${o.seed}-t000000.png`), w, 4, o.colour);
  weather = new Weather(o.seed, o.woundEvery ?? 0);
  for (let t = 1; t <= o.steps; t++) {
    w.tick();
    obs?.afterTick(); // label newborn beads before any wound reads ids
    weather.after(w, t);
    if (t % o.every === 0 || t === o.steps) {
      const bad = check(w);
      if (w.matter() !== m0) bad.push(`matter ${w.matter()} != ${m0}`);
      if (bad.length) throw new Error(`step ${w.step}: ${bad.join('; ')}`);
      sample();
      if (obs) cells();
      if (o.frames && o.out) writeFrame(join(o.out, `s${o.seed}-t${String(w.step).padStart(6, '0')}.png`), w, 4, o.colour);
    }
  }
  } finally {
    // a failed run still leaves the events written up to the failure
    if (obs) { try { flush(true); } finally { closeSync(fdE); closeSync(fdC); obs.detach(); } }
  }
  return { seed: o.seed, steps: o.steps, ms: Date.now() - t0, matter: m0, digest: w.digest(), rows, world: w };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const num = (k: string) => (arg(k) !== undefined ? Number(arg(k)) : undefined);
  if (process.argv.includes('--thread') && process.argv.includes('--thread-anchored')) throw new Error('--thread and --thread-anchored are different arms: pick one');
  if (process.argv.includes('--wall') && process.argv.includes('--gate')) throw new Error('--wall and --gate are different arms: pick one');
  const out = arg('out');
  const wl = process.argv.includes('--wild') ? wild(num('wild-area') ?? 4, { lit: !process.argv.includes('--no-light'), weather: !process.argv.includes('--no-weather') }) : undefined;
  if (out) mkdirSync(out, { recursive: true });
  const r = runGarden({
    seed: num('seed') ?? 1, steps: num('steps') ?? 50000, every: num('every') ?? 2500, out, frames: process.argv.includes('--frames'),
    colour: (arg('colour') as ColourBy) ?? 'founder', woundEvery: num('wound-every') ?? wl?.woundEvery, pinchLog: process.argv.includes('--pinch-log'), founders: num('founders') ?? wl?.founders,
    chimera: arg('chimera') ? (arg('chimera')!.split(',').map(Number) as [number, number]) : undefined,
    founderGene: arg('founder-gene') ? (arg('founder-gene')!.includes(',') ? arg('founder-gene')!.split(',').map(Number) : Number(arg('founder-gene'))) : undefined, founderMark: arg('founder-mark') ? (arg('founder-mark')!.includes(',') ? arg('founder-mark')!.split(',').map(Number) : Number(arg('founder-mark'))) : undefined, food: num('food'), lipid: num('lipid'), solute: num('solute'),
    params: { ...wl?.params, ...(process.argv.includes('--heredity') ? HEREDITY : {}), ...(process.argv.includes('--wall') ? WALL_GENES : {}), ...(process.argv.includes('--thread') ? THREAD : {}), ...(process.argv.includes('--thread-anchored') ? THREAD_ANCHORED : {}), ...(process.argv.includes('--gate') ? WALL_GATE : {}), ...(process.argv.includes('--neutral') ? { neutral: true } : {}), ...(num('mut') !== undefined ? { mut: num('mut') } : {}), ...(arg('params') ? (JSON.parse(arg('params')!) as Partial<Params>) : {}) },
  });
  const { world: _w, ...rest } = r;
  if (out) writeFileSync(join(out, `s${r.seed}.json`), JSON.stringify(rest));
  console.log(`done ${r.steps} steps in ${r.ms} ms, digest ${r.digest}`);
}
