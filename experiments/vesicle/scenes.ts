// Rung 0 of the vesicle world: three scripted scenes with mechanics only (no chemistry, no heredity).
//   inflate: one vesicle, more solute inside -> larger area
//   theft:   two vesicles share a fixed stock of lipid; the swollen one gains wall, the slack one loses it
//   pinch:   one vesicle is fed lipid until it has wall to spare and a neck closes into two
// Usage: node experiments/vesicle/scenes.ts [--only inflate|theft|pinch] [--seeds 1,2,3] [--out DIR] [--frames]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VesicleWorld } from '../../apps/lab/src/vesicle/model.ts';
import type { Params } from '../../apps/lab/src/vesicle/model.ts';
import { check, loops } from '../../apps/lab/src/vesicle/observe.ts';
import { writeFrame } from './frame.ts';

export interface SceneOpts { out?: string; frames?: boolean; params?: Partial<Params>; checkEvery?: number; feed?: number }

function run(w: VesicleWorld, steps: number, o: SceneOpts, tag: string, each?: (t: number) => void): void {
  const m0 = w.matter(), every = o.checkEvery ?? 500;
  for (let t = 1; t <= steps; t++) {
    w.tick();
    if (t % every === 0 || t === steps) {
      const bad = check(w);
      if (w.matter() !== m0) bad.push(`matter ${w.matter()} != ${m0}`);
      if (bad.length) throw new Error(`${tag} step ${w.step}: ${bad.join('; ')}`);
    }
    each?.(t);
    if (o.frames && o.out && t % Math.max(1, Math.floor(steps / 8)) === 0) writeFrame(join(o.out, `${tag}-t${String(w.step).padStart(6, '0')}.png`), w);
  }
}

/** Area of one vesicle against the solute it holds. */
export function inflate(seed: number, o: SceneOpts = {}) {
  const rows: { solute: number; loops: number; inside: number; area: number; beads: number; stretch: number; roundness: number }[] = [];
  for (const solute of [40, 80, 160, 320]) {
    const w = new VesicleWorld(seed, { W: 96, H: 96, ...o.params });
    w.addLoop(48, 48, 10); w.addSolute(48, 48, 8, solute); w.scatter(w.lipid, 250);
    run(w, 8000, o, `inflate-s${seed}-n${solute}`);
    const l = loops(w);
    rows.push({ solute, loops: l.length, inside: l[0]?.solute ?? 0, area: l[0]?.area ?? 0, beads: l[0]?.beads ?? 0, stretch: l[0]?.stretch ?? 0, roundness: l[0]?.roundness ?? 0 });
  }
  const pass = rows.every((r, i) => r.loops === 1 && r.inside >= 0.97 * r.solute && (i === 0 || r.area > 1.3 * rows[i - 1].area));
  return { scene: 'inflate', seed, pass, rows };
}

/** Two vesicles and a fixed stock of lipid. */
export function theft(seed: number, o: SceneOpts = {}) {
  const w = new VesicleWorld(seed, { W: 128, H: 64, ...o.params });
  w.addLoop(38, 32, 10); w.addSolute(38, 32, 8, 240, 128, 1);
  w.addLoop(90, 32, 10); w.addSolute(90, 32, 8, 60, 128, 2);
  const lipid0 = w.matter() - w.n, series: { t: number; rich: number; poor: number; free: number }[] = [];
  const sample = () => {
    const l = loops(w), rich = l.find((x) => (x.founders.get(1) ?? 0) > 0), poor = l.find((x) => (x.founders.get(2) ?? 0) > 0);
    series.push({ t: w.step, rich: rich?.beads ?? 0, poor: poor?.beads ?? 0, free: lipid0 - w.beadCount });
  };
  sample();
  run(w, 12000, o, `theft-s${seed}`, (t) => { if (t % 1000 === 0) sample(); });
  const a = series[0], z = series[series.length - 1], l = loops(w);
  const pass = l.length === 2 && z.rich >= a.rich + 6 && z.poor <= a.poor - 6 && w.matter() - w.n === lipid0;
  return { scene: 'theft', seed, pass, lipid: lipid0, start: a, end: z, series };
}

/** Feed one vesicle lipid until a neck closes. */
export function pinch(seed: number, o: SceneOpts = {}) {
  const w = new VesicleWorld(seed, { W: 96, H: 96, ...o.params });
  w.addLoop(48, 48, 10); w.addSolute(48, 48, 8, 120); w.scatter(w.lipid, 150);
  run(w, 2000, o, `pinch-s${seed}-settle`);
  const before = loops(w);
  w.scatter(w.lipid, o.feed ?? 400);
  let firstPinch = -1;
  const series: { t: number; loops: number; beads: number; roundness: number }[] = [];
  run(w, 20000, o, `pinch-s${seed}`, (t) => {
    if (firstPinch < 0 && w.events.pinch > 0) firstPinch = w.step;
    if (t % 1000 === 0) { const l = loops(w, false); series.push({ t: w.step, loops: l.length, beads: w.beadCount, roundness: Math.min(...l.map((x) => x.roundness)) }); }
  });
  const after = loops(w), holding = after.filter((l) => l.solute > 0), inside = after.reduce((s, l) => s + l.solute, 0);
  const big = holding.filter((l) => l.solute >= 12);
  const pass = before.length === 1 && w.events.pinch > 0 && big.length >= 2 && inside >= 96 && w.n === 120;
  return { scene: 'pinch', seed, pass, firstPinch, pinches: w.events.pinch, dissolved: w.events.dissolve, loops: after.length, holding: holding.map((l) => l.solute), soluteInside: inside, soluteTotal: w.n, series };
}

const SCENES = { inflate, theft, pinch };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const only = arg('only'), seeds = (arg('seeds') ?? '1,2,3').split(',').map(Number), out = arg('out');
  const params = arg('params') ? (JSON.parse(arg('params')!) as Partial<Params>) : undefined;
  if (out) mkdirSync(out, { recursive: true });
  const results = [];
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only && only !== name) continue;
    for (const seed of seeds) {
      const t0 = Date.now(), r = fn(seed, { out, frames: process.argv.includes('--frames'), params });
      results.push(r);
      const { series: _s, ...brief } = r as Record<string, unknown>;
      console.log(JSON.stringify(brief), `${Date.now() - t0} ms`);
    }
  }
  if (out) writeFileSync(join(out, 'scenes.json'), JSON.stringify(results, null, 1));
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}
