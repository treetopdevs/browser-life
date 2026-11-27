// Skeptic: repeated wound test. Run one world to t=T0, then clone it K times; wound a disk (radius R) at a chosen centre in each clone,
// run WATCH steps, and compare each disk tile with its pre-wound mark. A no-wound clone (same centre, no injure) gives the background rate.
// Usage: node --no-warnings wound2.ts <out.json> <K> [v3 flags...]    env T0, WATCH, RAD, NEAR (boundary = foreign cell within NEAR tiles, Chebyshev)
import { writeFileSync } from 'node:fs';
import { BodiesWorld, FOUNDER_GENOME } from '/Users/nicholas/develop/browser-life-bodies/apps/lab/src/bodies/model.ts';
import { parseArgs } from '/Users/nicholas/develop/browser-life-bodies/experiments/bodies/v3.ts';

const [outFile, Kstr, ...flags] = process.argv.slice(2);
const K = Number(Kstr), o = parseArgs(flags);
const T0 = Number(process.env.T0 ?? 12000), WATCH = Number(process.env.WATCH ?? 1500), RAD = Number(process.env.RAD ?? 4), NEAR = Number(process.env.NEAR ?? 3);
const W = 96, H = 96, N = W * H;
const SPOTS: [number, number][] = [[24, 24], [72, 30], [46, 72], [20, 68], [74, 74]];
const positions = SPOTS.slice(0, o.founders);
const tags = o.tags === 'same' ? new Array(positions.length).fill(0) : o.tags ?? Array.from({ length: positions.length }, (_, i) => Math.floor(i * 256 / positions.length));
const mk = () => new BodiesWorld({ seed: o.seed, founders: positions.length, positions, founderTags: tags, genome: (o.genome ?? FOUNDER_GENOME) as any, mutRate: o.mut ? o.mutRate : 0, blind: o.geneBlind, upkeep: o.upkeep, tagMutRate: o.tagMutRate, tagBlind: o.tagBlind, rules: o.rules });
const w0 = mk(); w0.step(T0);
function clone(src: BodiesWorld): BodiesWorld {
  const c = mk();
  for (const k of Object.keys(src)) { const v = (src as any)[k]; if (ArrayBuffer.isView(v)) (c as any)[k].set(v); else if (typeof v === 'number' || typeof v === 'boolean') (c as any)[k] = v; }
  return c;
}
const TOL = w0.R.TAG_TOL;
const circ = (a: number, b: number) => { let x = a - b; if (x < 0) x = -x; return x > 128 ? 256 - x : x; };
// foreign distance of each live cell: Chebyshev distance (<= 8) to the nearest live cell with a non-matching mark
const near = (w: BodiesWorld, i: number): number => {
  const x = i % W, y = (i - x) / W; let best = 99;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const p = ((y + dy + H) % H) * W + ((x + dx + W) % W);
    if (w.cell[p] && circ(w.kin[i], w.kin[p]) > TOL) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
  }
  return best;
};
const live = [] as number[]; for (let i = 0; i < N; i++) if (w0.cell[i] && w0.d[i] !== 0) live.push(i);
const bnd = live.filter((i) => near(w0, i) <= NEAR), inn = live.filter((i) => near(w0, i) > 8);
// deterministic spread: take every (len/K)-th, skipping centres within 2*RAD of an earlier one
const pick = (arr: number[], k: number) => { const out: number[] = []; const stride = Math.max(1, Math.floor(arr.length / (k * 3))); for (let a = 0; a < arr.length && out.length < k; a += stride) { const c = arr[a]; const cx = c % W, cy = (c - cx) / W; if (out.every((q) => { const dx = Math.min(Math.abs(q % W - cx), W - Math.abs(q % W - cx)), dy = Math.min(Math.abs(((q / W) | 0) - cy), H - Math.abs(((q / W) | 0) - cy)); return Math.max(dx, dy) > 2 * RAD + 2; })) out.push(c); } return out; };
const trials: any[] = [];
for (const [kind, arr] of [['boundary', bnd], ['interior', inn]] as const) {
  for (const c of pick(arr, K)) {
    const cx = c % W, cy = (c - cx) / W;
    const disk: number[] = []; for (let dy = -RAD; dy <= RAD; dy++) for (let dx = -RAD; dx <= RAD; dx++) if (dx * dx + dy * dy <= RAD * RAD) disk.push((((cy + dy) % H + H) % H) * W + (((cx + dx) % W + W) % W));
    const pre = disk.filter((i) => w0.cell[i]).map((i) => ({ i, kin: w0.kin[i] }));
    const preForeign = pre.filter((p) => circ(p.kin, pre[0].kin) > TOL).length; // disk straddles >=2 marks if > 0
    const res: any = { kind, centre: [cx, cy], preLive: pre.length, straddles: preForeign > 0 };
    for (const wounded of [true, false]) {
      const w = clone(w0); if (wounded) w.injure(cx, cy, RAD); w.step(WATCH);
      let live1 = 0, same = 0, foreign = 0;
      for (const p of pre) if (w.cell[p.i]) { live1++; if (circ(w.kin[p.i], p.kin) <= TOL) same++; else foreign++; }
      res[wounded ? 'wound' : 'noWound'] = { live1, same, foreign, residual: w.residual() };
    }
    trials.push(res);
  }
}
writeFileSync(outFile, JSON.stringify({ flags, T0, WATCH, RAD, NEAR, nBoundaryCandidates: bnd.length, nInteriorCandidates: inn.length, trials }) + '\n');
const sum = (kind: string, key: string, f: string) => trials.filter((t) => t.kind === kind).reduce((a, t) => a + t[key][f], 0);
for (const kind of ['boundary', 'interior']) console.log(kind, 'trials', trials.filter((t) => t.kind === kind).length, 'wound: live', sum(kind, 'wound', 'live1'), 'foreign', sum(kind, 'wound', 'foreign'), ' | noWound: live', sum(kind, 'noWound', 'live1'), 'foreign', sum(kind, 'noWound', 'foreign'));
