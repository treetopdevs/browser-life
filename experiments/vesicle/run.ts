// Headless garden runs for the vesicle world: a census table, optional frames, structural checks.
// Usage: node experiments/vesicle/run.ts --out DIR [--seed 1] [--steps 50000] [--every 2500] [--frames]
//          [--params '{"kLip":0.001}'] [--heredity] [--neutral] [--wound-every N] [--founders 6] [--food N] [--colour founder|gene|mark]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Params } from '../../apps/lab/src/vesicle/model.ts';
import { census, check, loops } from '../../apps/lab/src/vesicle/observe.ts';
import { HEREDITY, garden } from '../../apps/lab/src/vesicle/worlds.ts';
import type { GardenOpts } from '../../apps/lab/src/vesicle/worlds.ts';
import { writeFrame } from './frame.ts';
import type { ColourBy } from './frame.ts';

export interface RunOpts extends GardenOpts { seed: number; steps: number; every: number; out?: string; frames?: boolean; colour?: ColourBy; quiet?: boolean; woundEvery?: number }

export function runGarden(o: RunOpts) {
  const w = garden(o.seed, o), m0 = w.matter(), rows: Record<string, number>[] = [];
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
    };
    rows.push(row);
    if (!o.quiet) console.log(JSON.stringify(row));
  };
  sample();
  if (o.frames && o.out) writeFrame(join(o.out, `s${o.seed}-t000000.png`), w, 4, o.colour);
  const t0 = Date.now();
  let wseed = (o.seed * 2654435761) >>> 0, wounds = 0;
  for (let t = 1; t <= o.steps; t++) {
    w.tick();
    if (o.woundEvery && t % o.woundEvery === 0) {
      // weather: burst one ring picked by the runner's own generator (the kernel's stream is untouched)
      const ls = loops(w, false);
      wseed = (Math.imul(wseed, 1664525) + 1013904223) >>> 0;
      if (ls.length) { w.dissolveLoop(ls[wseed % ls.length].first); wounds++; }
    }
    if (t % o.every === 0 || t === o.steps) {
      const bad = check(w);
      if (w.matter() !== m0) bad.push(`matter ${w.matter()} != ${m0}`);
      if (bad.length) throw new Error(`step ${w.step}: ${bad.join('; ')}`);
      sample();
      if (o.frames && o.out) writeFrame(join(o.out, `s${o.seed}-t${String(w.step).padStart(6, '0')}.png`), w, 4, o.colour);
    }
  }
  return { seed: o.seed, steps: o.steps, ms: Date.now() - t0, matter: m0, digest: w.digest(), rows, world: w };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const num = (k: string) => (arg(k) !== undefined ? Number(arg(k)) : undefined);
  const out = arg('out');
  if (out) mkdirSync(out, { recursive: true });
  const r = runGarden({
    seed: num('seed') ?? 1, steps: num('steps') ?? 50000, every: num('every') ?? 2500, out, frames: process.argv.includes('--frames'),
    colour: (arg('colour') as ColourBy) ?? 'founder', woundEvery: num('wound-every'), founders: num('founders'), food: num('food'), lipid: num('lipid'), solute: num('solute'),
    params: { ...(process.argv.includes('--heredity') ? HEREDITY : {}), ...(process.argv.includes('--neutral') ? { neutral: true } : {}), ...(arg('params') ? (JSON.parse(arg('params')!) as Partial<Params>) : {}) },
  });
  const { world: _w, ...rest } = r;
  if (out) writeFileSync(join(out, `s${r.seed}.json`), JSON.stringify(rest));
  console.log(`done ${r.steps} steps in ${r.ms} ms, digest ${r.digest}`);
}
