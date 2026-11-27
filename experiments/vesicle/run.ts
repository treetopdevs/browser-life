// Headless garden runs for the vesicle world: a census table, optional frames, structural checks.
// Usage: node experiments/vesicle/run.ts --out DIR [--seed 1] [--steps 50000] [--every 2500] [--frames]
//          [--params '{"kLip":0.001}'] [--heredity] [--neutral] [--wound-every N] (one ring burst every N steps; overrides --wild's weather) [--founders 6] [--food N] [--colour founder|gene|mark]
//          [--mut 0.01] (shift rate per copy; overrides the arm's default) [--pinch-log] (needs --out: writes s<seed>.pinch.tsv and s<seed>.cells.tsv, pure observer)
//          [--thread] (stage 1: one genome object per cell, free-floating) [--founder-mark 96 | 96,160] (thread marker gene)
//          [--wild] (stage 3: big dish, drifting light patches, weather in proportion to the rings; combine with --wall/--gate/--thread/--heredity) [--wild-area 4 (default) | 1 | 9 | 16] [--no-light] [--no-weather]
//          [--jobs] (stage 2: the wall genome also carries harvest and digest bytes; beads turn waste to food in light and free lipid to food; implies --wall;
//             composes with --wild) [--jobs-inert] (its neutral twin: same genome, enzymes do nothing, free light and lipid decay stay on) [--founder-jobs "255,0;0,255;128,128"]
//             (harvest,digest per founder, cycled; default 255,0) [--k-harvest 0.01 (0.04 with --wild and light on)] [--k-digest 0.35] [--colour job] (walls by job: green harvester to magenta digester)
//          [--ties] (stage 4, bodies: the wall also carries a glue byte; a pinch ties the daughters with probability glue/255; implies --wall; composes with --wild and --jobs)
//             [--ties-inert] (its twin: glue carried and shifted, no tie ever forms) [--founder-glue 255 | 0,255] (glue byte per founder, cycled; default 0)
//             [--tie-k 0.1] [--tie-rest 2] [--tie-break 6] [--refuge [P]] (weather spares a ring that holds a tie with probability P, default 0.8, from its own generator)
//             [--colour cluster] (frames: one hue per cluster of tied cells, single cells grey, ties as bright lines); with --pinch-log also writes s<seed>.ties.tsv
//          [--wall] (heredity in the wall beads) [--gate] (control: solute heredity, copies only at the inner face) [--founder-gene 96 | 96,160] [--chimera 64,192]
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scaleJobs } from '../../apps/lab/src/vesicle/model.ts';
import type { Params } from '../../apps/lab/src/vesicle/model.ts';
import { LineageObserver, TIE_HEADER, TieObserver, cellHeader, cellLine, census, check, eventHeader, eventLine, loops, tieLine, tieStats } from '../../apps/lab/src/vesicle/observe.ts';
import { HEREDITY, JOBS, JOBS_INERT, JOBS_WILD_KHARVEST, THREAD, TIES, TIES_INERT, WALL_GATE, WALL_GENES, Weather, garden, wild } from '../../apps/lab/src/vesicle/worlds.ts';
import type { GardenOpts } from '../../apps/lab/src/vesicle/worlds.ts';
import { writeFrame } from './frame.ts';
import type { ColourBy } from './frame.ts';

export interface RunOpts extends GardenOpts { seed: number; steps: number; every: number; out?: string; frames?: boolean; colour?: ColourBy; quiet?: boolean; woundEvery?: number;
  /** Weather in proportion to the rings (one wound per this many ring-steps; see `Weather`); ignored when `woundEvery` is set. */
  weatherRings?: number; pinchLog?: boolean;
  /** With ties: the weather spares a ring that holds a tie with this probability (see `Weather`). */
  pRefuge?: number }

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
    if (w.p.jobs) {
      // dish totals of the two jobs so far (units converted), and the job bytes (scaled to the shared budget) averaged over beads and over live cells
      let sh = 0, sd = 0, nb = 0;
      for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) { const [h, d] = scaleJobs(w.wh[i], w.wd[i]); sh += h; sd += d; nb++; }
      const r1 = (v: number) => Math.round(10 * v) / 10;
      row.harvests = w.events.harvest; row.digests = w.events.digest; row.hMean = r1(nb ? sh / nb : 0); row.dMean = r1(nb ? sd / nb : 0);
    }
    if (w.p.ties) {
      // ties: pairs now, clusters of live cells by size (1, 2, 3, 4 to 7, 8 or more), the largest, the bead-mean glue byte, the share of live cells in a cluster of 2 or more,
      // and the events so far (formed; ended by stretching, by a bead leaving with no free neighbour, by the ring ending; hops)
      const ts = tieStats(w, c.loops), r3 = (v: number) => Math.round(1000 * v) / 1000, e = w.events;
      Object.assign(row, { ties: ts.ties, tc1: ts.c1, tc2: ts.c2, tc3: ts.c3, tc4to7: ts.c4to7, tc8p: ts.c8p, tcMax: ts.max, glueMean: Math.round(10 * ts.glue) / 10, clusterShare: r3(ts.share),
        tieFormed: e.tie, tieStretch: e.tieStretch, tieDesorb: e.tieDesorb, tieRingEnd: e.tieRingEnd, tieHop: e.tieHop, tieBlocked: e.tieBlocked });
    }
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
    if (o.woundEvery || o.weatherRings) row.wounds = weather?.wounds ?? 0;
    if (o.pRefuge) row.spared = weather?.spared ?? 0;
    row.ms = Date.now() - t0;
    rows.push(row);
    if (!o.quiet) console.log(JSON.stringify(row));
  };
  // lineage observer: streams events and per-cell records to disk; reads the world, never changes it
  let obs: LineageObserver | undefined, tobs: TieObserver | undefined, fdE = -1, fdC = -1, fdT = -1, bufE: string[] = [], bufC: string[] = [], bufT: string[] = [];
  const flush = (force = false) => {
    if (fdE >= 0 && (force || bufE.length > 2000)) { writeSync(fdE, bufE.join('')); bufE = []; }
    if (fdC >= 0 && (force || bufC.length > 2000)) { writeSync(fdC, bufC.join('')); bufC = []; }
    if (fdT >= 0 && (force || bufT.length > 2000)) { writeSync(fdT, bufT.join('')); bufT = []; }
  };
  const cells = () => {
    const cl = tobs?.sweep();
    obs!.forEachCell((id, s, j) => bufC.push(cellLine(w.step, id, s, w.p.thread, w.p.jobs ? j : undefined, cl?.(id)) + '\n'));
    flush();
  };
  if (o.pinchLog) {
    if (!o.out) throw new Error('--pinch-log needs --out');
    fdE = openSync(join(o.out, `s${o.seed}.pinch.tsv`), 'w'); fdC = openSync(join(o.out, `s${o.seed}.cells.tsv`), 'w');
    bufE.push(eventHeader(w.p.thread, w.p.jobs) + '\n'); bufC.push(cellHeader(w.p.thread, w.p.jobs, w.p.ties) + '\n');
    obs = new LineageObserver(w, (e) => { bufE.push(eventLine(e, w.p.thread, w.p.jobs) + '\n'); flush(); });
    if (w.p.ties) {
      fdT = openSync(join(o.out, `s${o.seed}.ties.tsv`), 'w'); bufT.push(TIE_HEADER + '\n');
      tobs = new TieObserver(w, obs, (e) => { bufT.push(tieLine(e) + '\n'); flush(); });
    }
    cells();
  }
  sample();
  t0 = Date.now();
  try {
  if (o.frames && o.out) writeFrame(join(o.out, `s${o.seed}-t000000.png`), w, 4, o.colour);
  weather = new Weather(o.seed, o.woundEvery ?? 0, o.weatherRings ?? 0, o.pRefuge ?? 0);
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
    if (obs) { try { flush(true); } finally { closeSync(fdE); closeSync(fdC); if (fdT >= 0) closeSync(fdT); tobs?.detach(); obs.detach(); } }
  }
  return { seed: o.seed, steps: o.steps, ms: Date.now() - t0, matter: m0, digest: w.digest(), rows, world: w };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const num = (k: string) => (arg(k) !== undefined ? Number(arg(k)) : undefined);
  if (process.argv.includes('--thread-anchored')) throw new Error('--thread-anchored was retired (it died out in 8 of 8 worlds); use --thread');
  if (process.argv.includes('--jobs') && process.argv.includes('--jobs-inert')) throw new Error('--jobs and --jobs-inert are different arms: pick one');
  if ((process.argv.includes('--jobs') || process.argv.includes('--jobs-inert')) && (process.argv.includes('--gate') || process.argv.includes('--thread') || process.argv.includes('--heredity'))) throw new Error('jobs ride on wall heredity: do not combine with --gate, --thread or --heredity');
  const tiesOn = process.argv.includes('--ties') || process.argv.includes('--ties-inert');
  if (process.argv.includes('--ties') && process.argv.includes('--ties-inert')) throw new Error('--ties and --ties-inert are different arms: pick one');
  if (tiesOn && (process.argv.includes('--gate') || process.argv.includes('--thread') || process.argv.includes('--heredity'))) throw new Error('ties ride on wall heredity: do not combine with --gate, --thread or --heredity');
  if (!tiesOn && (process.argv.includes('--refuge') || process.argv.includes('--founder-glue'))) throw new Error('--refuge and --founder-glue need --ties or --ties-inert');
  if (process.argv.includes('--wall') && process.argv.includes('--gate')) throw new Error('--wall and --gate are different arms: pick one');
  const out = arg('out');
  const refugeIdx = process.argv.indexOf('--refuge'), pRefuge = refugeIdx < 0 ? undefined : (process.argv[refugeIdx + 1] && !process.argv[refugeIdx + 1].startsWith('--') ? Number(process.argv[refugeIdx + 1]) : 0.8);
  if (pRefuge !== undefined && !(pRefuge > 0 && pRefuge <= 1)) throw new Error('--refuge takes a probability above 0 and at most 1 (default 0.8)');
  const wl = process.argv.includes('--wild') ? wild(num('wild-area') ?? 4, { lit: !process.argv.includes('--no-light'), weather: !process.argv.includes('--no-weather') }) : undefined;
  if (out) mkdirSync(out, { recursive: true });
  const r = runGarden({
    seed: num('seed') ?? 1, steps: num('steps') ?? 50000, every: num('every') ?? 2500, out, frames: process.argv.includes('--frames'),
    colour: (arg('colour') as ColourBy) ?? 'founder', woundEvery: num('wound-every'), weatherRings: num('wound-every') === undefined ? wl?.weatherRings : undefined, pinchLog: process.argv.includes('--pinch-log'), pRefuge, founders: num('founders') ?? wl?.founders,
    chimera: arg('chimera') ? (arg('chimera')!.split(',').map(Number) as [number, number]) : undefined,
    founderGene: arg('founder-gene') ? (arg('founder-gene')!.includes(',') ? arg('founder-gene')!.split(',').map(Number) : Number(arg('founder-gene'))) : undefined, founderMark: arg('founder-mark') ? (arg('founder-mark')!.includes(',') ? arg('founder-mark')!.split(',').map(Number) : Number(arg('founder-mark'))) : undefined, founderJobs: arg('founder-jobs') ? (arg('founder-jobs')!.split(';').map((p) => { const v = p.split(',').map(Number); if (v.length !== 2 || v.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error(`--founder-jobs: each pair is two integers 0..255, got '${p}'`); return v as [number, number]; })) : undefined, founderGlue: arg('founder-glue') ? (arg('founder-glue')!.includes(',') ? arg('founder-glue')!.split(',').map(Number) : Number(arg('founder-glue'))) : undefined, food: num('food'), lipid: num('lipid'), solute: num('solute'),
    params: { ...wl?.params, ...(process.argv.includes('--heredity') ? HEREDITY : {}), ...(process.argv.includes('--wall') ? WALL_GENES : {}), ...(process.argv.includes('--jobs') ? JOBS : {}), ...(process.argv.includes('--jobs-inert') ? JOBS_INERT : {}), ...(process.argv.includes('--ties') ? TIES : {}), ...(process.argv.includes('--ties-inert') ? TIES_INERT : {}), ...(num('tie-k') !== undefined ? { tieK: num('tie-k') } : {}), ...(num('tie-rest') !== undefined ? { tieRest: num('tie-rest') } : {}), ...(num('tie-break') !== undefined ? { tieBreak: num('tie-break') } : {}), ...((process.argv.includes('--jobs') || process.argv.includes('--jobs-inert')) && (wl?.params.lightPatches ?? 0) > 0 ? { kHarvest: JOBS_WILD_KHARVEST } : {}), ...(num('k-harvest') !== undefined ? { kHarvest: num('k-harvest') } : {}), ...(num('k-digest') !== undefined ? { kDigest: num('k-digest') } : {}), ...(process.argv.includes('--thread') ? THREAD : {}), ...(process.argv.includes('--gate') ? WALL_GATE : {}), ...(process.argv.includes('--neutral') ? { neutral: true } : {}), ...(num('mut') !== undefined ? { mut: num('mut') } : {}), ...(arg('params') ? (JSON.parse(arg('params')!) as Partial<Params>) : {}) },
  });
  const { world: _w, ...rest } = r;
  if (out) writeFileSync(join(out, `s${r.seed}.json`), JSON.stringify(rest));
  console.log(`done ${r.steps} steps in ${r.ms} ms, digest ${r.digest}`);
}
