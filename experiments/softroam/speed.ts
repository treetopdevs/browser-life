/**
 * How fast bodies move in a soft roam world: a probe for the speed spread (CONTRACT-4). Runs the bodies start (or --start) and, at three
 * looks (--at, --at + 1500, --at + 3000), measures every body's speed over 10 steps (tiles per step, from the mean displacement of its
 * cells alive at both ends). Prints the share stopped (under 0.01), the spread of the moving ones (p10, p50, p90, p90/p10), medians by
 * size and by founder family, the share of moving bodies grazing (an eater on a tile with at least 4 bites of food at the look) and their
 * median against the rest. Seen seeds only; a probe, not an experiment.
 *
 *   deno run -A --no-lock experiments/softroam/speed.ts --seed 1 --at 6000 [--start bodies] [--ov '{json}']
 */
import { foundSoftRoam, softFamilies, type SoftRoamOptions, type SoftRoamStart } from '../../apps/lab/src/softroam/view.ts';
import { KIND_LEAF, KIND_PLAIN, type SoftRoamConfig } from '../../apps/lab/src/softroam/kernel.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, '')] = Deno.args[i + 1];
const seed = Number(args.seed ?? 1), at = Number(args.at ?? 6000);
const w = foundSoftRoam({ seed, start: (args.start ?? 'bodies') as SoftRoamStart, overrides: JSON.parse(args.ov ?? '{}') as Partial<SoftRoamConfig>, ...(JSON.parse(args.opt ?? '{}') as Partial<SoftRoamOptions>) });
const U = 1024, W = 10;
const names = new Map(softFamilies(w).map((f) => [f.family, f.name]));
type Row = { n: number; v: number; fam: number; graze: boolean };
const rows: Row[] = [];
for (const t of [at, at + 1500, at + 3000]) {
  w.advance(t - w.step);
  const bite = w.cfg.bite;
  const x0 = Int32Array.from(w.x), y0 = Int32Array.from(w.y), c0 = Uint32Array.from(w.cid), a0 = Uint8Array.from(w.alive);
  const grazing = new Set<number>();
  for (let c = 0; c < w.cap; c++) {
    if (!w.alive[c]) continue;
    const eater = !w.cfg.kinds || w.kind[c] === KIND_PLAIN || (w.bodySize[w.body[c]] === 1 && w.kind[c] !== KIND_LEAF);
    if (eater && w.food[(w.y[c] >>> 10) * w.size + (w.x[c] >>> 10)] >= 4 * bite) grazing.add(w.body[c]);
  }
  // Bodies are taken as they are at the look (labels at the look), so a split or a join during the 10 steps does not move a cell's body.
  const b0 = Int32Array.from(w.body);
  // The size a body has at the look (a body losing a cell during the 10 steps stays in its bin).
  const size0 = new Map<number, number>();
  for (let c = 0; c < w.cap; c++) if (w.alive[c]) size0.set(w.body[c], (size0.get(w.body[c]) ?? 0) + 1);
  w.advance(W);
  const g = new Map<number, { sx: number; sy: number; n: number; fam: number; graze: boolean }>();
  for (let c = 0; c < w.cap; c++) {
    if (!w.alive[c] || !a0[c] || w.cid[c] !== c0[c]) continue;
    const b = b0[c];
    const e = g.get(b) ?? { sx: 0, sy: 0, n: 0, fam: w.fam[c], graze: false };
    e.sx += w.dlt(x0[c], w.x[c]) / U; e.sy += w.dlt(y0[c], w.y[c]) / U; e.n++;
    if (grazing.has(b)) e.graze = true;
    g.set(b, e);
  }
  for (const [b, e] of g) rows.push({ n: size0.get(b) ?? e.n, v: Math.hypot(e.sx / e.n, e.sy / e.n) / W, fam: e.fam, graze: e.graze });
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const f3 = (x: number) => x.toFixed(3);
const mv = rows.filter((r) => r.v >= 0.01);
const sp = mv.map((r) => r.v);
console.log(`seed ${w.cfg.seed} looks ${at},+1500,+3000: bodies ${rows.length}, stopped ${(100 * (1 - mv.length / rows.length)).toFixed(0)}%; moving p10 ${f3(q(sp, .1))} p50 ${f3(q(sp, .5))} p90 ${f3(q(sp, .9))} max ${f3(q(sp, 1))} p90/p10 ${(q(sp, .9) / q(sp, .1)).toFixed(2)}`);
const hist = new Array(10).fill(0); for (const v of sp) hist[Math.min(9, Math.floor(v / 0.025))]++;
console.log(`  histogram (0.025 tiles/step bins, last open): ${hist.join(' ')}`);
const sizes: [number, number][] = [[1, 1], [2, 5], [6, 12], [13, 99]];
console.log('  by size: ' + sizes.map(([lo, hi]) => { const s = mv.filter((r) => r.n >= lo && r.n <= hi).map((r) => r.v); return `${lo}-${hi} n${s.length} ${f3(q(s, .5))}`; }).join(', '));
console.log('  by family: ' + [...new Set(mv.map((r) => r.fam))].sort((a, b) => a - b).map((f) => { const s = mv.filter((r) => r.fam === f).map((r) => r.v); return `${names.get(f) ?? f} n${s.length} ${f3(q(s, .5))}`; }).join(', '));
const gz = rows.filter((r) => r.graze).map((r) => r.v), ng = rows.filter((r) => !r.graze).map((r) => r.v);
console.log(`  grazing bodies ${gz.length} median ${f3(q(gz, .5))}; others ${ng.length} median ${f3(q(ng, .5))} (all bodies, stopped included)`);
