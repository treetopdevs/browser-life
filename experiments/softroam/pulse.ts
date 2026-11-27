/**
 * A first look at Soft Roam's inner pulse (a small heritable network in every cell and two signals along the bonds; see the kernel header):
 * a start with `pulse` on and a network of its own for every founder, and a row every --report steps of how many cells and bodies beat.
 *
 *   deno run -A --no-lock experiments/softroam/pulse.ts --seed 1 --steps 12000
 *
 * Options: --start (bodies), --seed (1), --steps (12000), --size (128), --report (2000), --window (128), --pulse (1; 0 runs the start
 * without the pulse), --opt '{json}' (start options, e.g. '{"pulseThrust":0,"pulseFlex":0}' for signals that run and do nothing, or
 * '{"pulseSpread":0}' for still founders), --ov '{json}' (config overrides).
 *
 * Before each report every live cell's go and flex outputs are kept for --window steps. A cell "beats" when one of the two swings by 24 or
 * more over the window, crosses its own mean at least four times, and no more than once in three steps (a rhythm of 3 steps or longer; the
 * period given is twice the window over the crossings); it "flickers" when it swings that much faster than that; else it is still. A body of 4 or more
 * cells beats when half or more of its cells do. Columns: cells, bodies, the largest; cells beating / flickering / still; bodies of 4+
 * and how many beat; the median and the 10th to 90th percentile period of beating cells; the census's `pulsing` and mean thrust share (%);
 * travel per cell per 1000 steps (tiles); the mean absolute weight; the median swing of the bond to the mother over the window (longest less shortest, in bond lengths) for beating cells and for the rest; the residual (must be 0). A probe on seen seeds, not an experiment runner.
 */

import { PULSE_W, type SoftRoamConfig } from '../../apps/lab/src/softroam/kernel.ts';
import { foundSoftRoam, type SoftRoamOptions, type SoftRoamStart } from '../../apps/lab/src/softroam/view.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const seed = Number(args.seed ?? 1);
const steps = Number(args.steps ?? 12000);
const report = Number(args.report ?? 2000);
const win = Number(args.window ?? 128);
const on = Number(args.pulse ?? 1) > 0;
const opt: Partial<SoftRoamOptions> = args.opt ? JSON.parse(args.opt) : {};
const ov: Partial<SoftRoamConfig> = args.ov ? JSON.parse(args.ov) : {};
if (report < win) throw new Error('--report must be at least --window');

const world = foundSoftRoam({ seed, start: (args.start ?? 'bodies') as SoftRoamStart, size: args.size ? Number(args.size) : undefined, ...(on ? { pulse: true } : {}), ...opt, overrides: ov });
const pulse = world.cfg.pulse === true;
console.log(`seed ${seed} start ${args.start ?? 'bodies'} pulse ${pulse} ${JSON.stringify(opt)} ${JSON.stringify(ov)}`);
console.log('step\tcells\tbodies\tlargest\tbeat/flick/still\tbodies4+\tbeating\tperiod med (p10-p90)\tpulsing\tthrust%\ttravel/k\t|w|\tbond swing beat/rest\tresidual');

/** Per cid: the go and flex outputs over the window. */
const seriesGo = new Map<number, number[]>();
const seriesFlex = new Map<number, number[]>();
/** Per cid: the shortest and longest its bond to its mother was over the window (units). */
const bondLo = new Map<number, number>();
const bondHi = new Map<number, number>();
const classify = (v: number[]): { kind: 0 | 1 | 2; period: number } => {
  let lo = Infinity, hi = -Infinity, mean = 0;
  for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; mean += x; }
  if (hi - lo < 24) return { kind: 0, period: 0 };
  mean /= v.length;
  let cross = 0;
  for (let t = 1; t < v.length; t++) if ((v[t] > mean) !== (v[t - 1] > mean)) cross++;
  // Fewer than four crossings in the window is a drift or one change, not a rhythm.
  if (cross < 4) return { kind: 0, period: 0 };
  const period = (2 * v.length) / cross;
  return period >= 3 ? { kind: 2, period } : { kind: 1, period };
};
let lastTravel = 0;
let lastCellSteps = 0;
let cellSteps = 0;
for (let t = 0; t <= steps; t++) {
  const toReport = (report - (t % report)) % report;
  if (pulse && t > 0 && toReport < win) {
    if (toReport === win - 1) { seriesGo.clear(); seriesFlex.clear(); bondLo.clear(); bondHi.clear(); }
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const id = world.cid[c];
      let g = seriesGo.get(id);
      if (!g) { g = []; seriesGo.set(id, g); seriesFlex.set(id, []); }
      g.push(world.pulseGo[c]);
      seriesFlex.get(id)!.push(world.pulseFlex[c]);
      const m = world.mother[c];
      if (m >= 0) {
        const d = Math.hypot(world.dlt(world.x[c], world.x[m]), world.dlt(world.y[c], world.y[m]));
        if (d < (bondLo.get(id) ?? Infinity)) bondLo.set(id, d);
        if (d > (bondHi.get(id) ?? -Infinity)) bondHi.set(id, d);
      }
    }
  }
  if (t % report === 0) {
    const cs = world.census();
    let beat = 0, flick = 0, still = 0, wsum = 0;
    const periods: number[] = [];
    const swingBeat: number[] = [], swingRest: number[] = [];
    const bodyN = new Map<number, number>();
    const bodyBeat = new Map<number, number>();
    for (let c = 0; c < world.cap; c++) {
      if (!world.alive[c]) continue;
      const l = world.body[c];
      bodyN.set(l, (bodyN.get(l) ?? 0) + 1);
      if (!pulse) continue;
      for (let i = 0; i < PULSE_W; i++) wsum += Math.abs(world.pulseW[c * PULSE_W + i]);
      const g = seriesGo.get(world.cid[c]);
      // A cell born inside the window has a short record: it is judged on what there is, if that is at least a quarter of the window.
      if (!g || g.length < win / 4) { still++; continue; }
      const a = classify(g), b = classify(seriesFlex.get(world.cid[c])!);
      const best = a.kind >= b.kind ? a : b;
      const sw = bondHi.has(world.cid[c]) ? (bondHi.get(world.cid[c])! - bondLo.get(world.cid[c])!) / 1024 : -1;
      if (sw >= 0) (best.kind === 2 ? swingBeat : swingRest).push(sw);
      if (best.kind === 2) { beat++; periods.push(best.period); bodyBeat.set(l, (bodyBeat.get(l) ?? 0) + 1); }
      else if (best.kind === 1) flick++;
      else still++;
    }
    let big = 0, bigBeat = 0;
    for (const [l, n] of bodyN) if (n >= 4) { big++; if (2 * (bodyBeat.get(l) ?? 0) >= n) bigBeat++; }
    periods.sort((x, y) => x - y);
    const pct = (q: number): string => (periods.length === 0 ? '-' : periods[Math.min(periods.length - 1, Math.floor(q * periods.length))].toFixed(0));
    const med = (a: number[]): string => (a.length === 0 ? '-' : a.sort((x, y) => x - y)[a.length >> 1].toFixed(2));
    const dTravel = world.travel - lastTravel;
    const dCells = cellSteps - lastCellSteps;
    console.log([t, cs.cells, cs.bodies, cs.largest, pulse && t > 0 ? `${beat}/${flick}/${still}` : '-', big, pulse && t > 0 ? bigBeat : '-', pulse && t > 0 ? `${pct(0.5)} (${pct(0.1)}-${pct(0.9)})` : '-', cs.pulsing, Math.round((cs.pulseGo * 100) / 256),
      dCells > 0 ? ((dTravel / 1024 / dCells) * 1000).toFixed(1) : '-', pulse && cs.cells > 0 ? (wsum / cs.cells / PULSE_W).toFixed(1) : '-', pulse && t > 0 ? `${med(swingBeat)}/${med(swingRest)}` : '-', cs.residual].join('\t'));
    lastTravel = world.travel;
    lastCellSteps = cellSteps;
  }
  if (t < steps) { world.stepOnce(); cellSteps += liveCount(); }
}
function liveCount(): number { let n = 0; for (let c = 0; c < world.cap; c++) if (world.alive[c]) n++; return n; }
