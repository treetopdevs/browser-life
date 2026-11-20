// Stage 2 ("jobs for genes") analysis: roles by what cells DO, byte classes, takeover, light, linkage. Streams the run bundles
// (s<seed>.json census, s<seed>.cells.tsv, s<seed>.pinch.tsv); pure reader, changes no run. The `linkage` mode re-runs one neutral
// twin (same options as the bundle; its final digest is printed to compare) and scans every bead; it reads the kernel, never edits it.
//
// Usage:
//   node experiments/vesicle/jobs.ts roles ROOT ARM[,ARM...] [--seeds 1,2,3,4] [--tau 20] [--window 100000] [--from 300000] [--grid 25000] [--json out.json]
//   node experiments/vesicle/jobs.ts track ROOT ARM[,ARM...] [--seeds ...]       (census trajectories per 100k, level-off, takeover)
//   node experiments/vesicle/jobs.ts light ROOT ARM[,ARM...] --area 4            (where byte classes sit relative to the light patches)
//   node experiments/vesicle/jobs.ts divisions ROOT ARM[,ARM...]                 (productive divisions per run, via divisions.ts)
//   node experiments/vesicle/jobs.ts linkage --seed 1 --mut 0 --out FILE.json    (neutral twin re-run, bead-level scan every 2500 steps)
//
// Roles (what cells DO): a live cell (solute >= 5 at a cells.tsv sweep T) is credited with the conversions of its own ring id AND of
// every ancestor id (a pinch ends the mother's id, the daughters get new ids), counting only tally rows stamped in (T-window, T].
// Tally rows are the cells.tsv rows plus the pinch/end rows (m_harvests, m_digests), so nothing is lost. A mother's conversions are
// credited in full to both daughters' lineages (f = digests / (harvests + digests) is unchanged if a shared past is split).
// A cell "converts" if harvests + digests in the window >= tau units; otherwise it is a consumer. Roles: f < 0.25 harvester,
// f > 0.75 digester, else mixed. Also a forward view: cells live at T-window, credited with their own and all descendant ids' tallies.
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { VesicleWorld } from '../../apps/lab/src/vesicle/model.ts';
import { garden, wild, JOBS_INERT, METABOLISM, Weather } from '../../apps/lab/src/vesicle/worlds.ts';
import { check, loops } from '../../apps/lab/src/vesicle/observe.ts';
import { divisions } from './divisions.ts';

interface Cell { step: number; id: number; beads: number; solute: number; cx: number; cy: number; h: number; d: number; hv: number; dg: number }
interface Run {
  dir: string; seed: number; rows: Record<string, number>[]; steps: number;
  sweeps: Map<number, Cell[]>; tally: Map<number, number[]>; parent: Map<number, number>; children: Map<number, number[]>;
}

async function lines(path: string, fn: (c: string[], head: string[]) => void): Promise<void> {
  let head: string[] | undefined;
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!line) continue;
    const c = line.split('\t');
    if (!head) { head = c; continue; }
    fn(c, head);
  }
}

export async function load(dir: string, seed: number): Promise<Run | undefined> {
  const json = join(dir, `s${seed}.json`);
  if (!existsSync(json)) return undefined;
  const rows = JSON.parse(readFileSync(json, 'utf8')).rows as Record<string, number>[];
  const run: Run = { dir, seed, rows, steps: rows[rows.length - 1].t, sweeps: new Map(), tally: new Map(), parent: new Map(), children: new Map() };
  const add = (id: number, step: number, hv: number, dg: number) => {
    if (hv === 0 && dg === 0) return;
    const a = run.tally.get(id); if (a) a.push(step, hv, dg); else run.tally.set(id, [step, hv, dg]);
  };
  let ix: Record<string, number> = {};
  await lines(join(dir, `s${seed}.cells.tsv`), (c, head) => {
    if (!ix.step) head.forEach((n, i) => (ix[n] = i + 1));
    const g = (n: string) => Number(c[ix[n] - 1]);
    const cell: Cell = { step: g('step'), id: g('id'), beads: g('beads'), solute: g('solute'), cx: g('cx'), cy: g('cy'), h: g('hMean'), d: g('dMean'), hv: g('harvests') || 0, dg: g('digests') || 0 };
    let l = run.sweeps.get(cell.step); if (!l) run.sweeps.set(cell.step, (l = []));
    l.push(cell); add(cell.id, cell.step, cell.hv, cell.dg);
  });
  ix = {};
  await lines(join(dir, `s${seed}.pinch.tsv`), (c, head) => {
    if (!ix.ev) head.forEach((n, i) => (ix[n] = i + 1));
    const g = (n: string) => Number(c[ix[n] - 1]), step = g('step'), id = g('id');
    if (c[0] === 'pinch') {
      const d1 = g('d1'), d2 = g('d2');
      run.parent.set(d1, id); run.parent.set(d2, id); run.children.set(id, [d1, d2]);
    }
    add(id, step, g('m_harvests') || 0, g('m_digests') || 0);
  });
  return run;
}

/** Conversions credited to `id` and its ancestors with tally rows in (lo, hi]. */
function ancestry(run: Run, id: number, lo: number, hi: number): [number, number] {
  let h = 0, d = 0;
  for (let k: number | undefined = id; k !== undefined; k = run.parent.get(k)) {
    const a = run.tally.get(k); if (!a) continue;
    for (let i = 0; i < a.length; i += 3) if (a[i] > lo && a[i] <= hi) { h += a[i + 1]; d += a[i + 2]; }
  }
  return [h, d];
}
/** Conversions of `id` and all of its descendants with tally rows in (lo, hi]. */
function clade(run: Run, id: number, lo: number, hi: number): [number, number] {
  let h = 0, d = 0;
  const stack = [id];
  while (stack.length) {
    const k = stack.pop()!, a = run.tally.get(k);
    if (a) for (let i = 0; i < a.length; i += 3) if (a[i] > lo && a[i] <= hi) { h += a[i + 1]; d += a[i + 2]; }
    const ch = run.children.get(k); if (ch) stack.push(...ch);
  }
  return [h, d];
}

export interface Roles { T: number; live: number; conv: number; consumers: number; harv: number; dig: number; mixed: number; fs: number[]; totals: number[] }
const live = (run: Run, T: number) => (run.sweeps.get(T) ?? []).filter((c) => c.solute >= 5);
const classify = (pairs: [number, number][], tau: number, T: number, nLive: number): Roles => {
  const r: Roles = { T, live: nLive, conv: 0, consumers: 0, harv: 0, dig: 0, mixed: 0, fs: [], totals: pairs.map(([h, d]) => h + d) };
  for (const [h, d] of pairs) {
    if (h + d < tau) { r.consumers++; continue; }
    r.conv++;
    const f = d / (h + d); r.fs.push(f);
    if (f < 0.25) r.harv++; else if (f > 0.75) r.dig++; else r.mixed++;
  }
  return r;
};
export const rolesAt = (run: Run, T: number, tau: number, window: number): Roles => {
  const cs = live(run, T);
  return classify(cs.map((c) => ancestry(run, c.id, T - window, T)), tau, T, cs.length);
};
/** Forward view: cells live at T0 (the window's start), each credited with itself and all its descendants over (T0, T0 + window]. */
export const cladeRolesAt = (run: Run, T0: number, tau: number, window: number): Roles => {
  const cs = live(run, T0);
  return classify(cs.map((c) => clade(run, c.id, T0, T0 + window)), tau, T0 + window, cs.length);
};
/** Byte classes: f = d / (h + d) over the ring's mean scaled bytes; "idle" when h + d < 10. */
export interface ByteClasses { T: number; live: number; harv: number; dig: number; mixed: number; idle: number }
export const bytesAt = (run: Run, T: number): ByteClasses => {
  const cs = live(run, T), r: ByteClasses = { T, live: cs.length, harv: 0, dig: 0, mixed: 0, idle: 0 };
  for (const c of cs) {
    const s = c.h + c.d;
    if (s < 10) { r.idle++; continue; }
    const f = c.d / s;
    if (f < 0.25) r.harv++; else if (f > 0.75) r.dig++; else r.mixed++;
  }
  return r;
};

function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
/** Correlation ratio (eta squared) of y on a class label: share of the variance of y that the classes explain (0..1, sign-free). */
function eta2(cls: number[], y: number[]): number {
  const n = y.length; if (n < 3) return NaN;
  const my = y.reduce((a, b) => a + b, 0) / n, g = new Map<number, [number, number]>();
  for (let k = 0; k < n; k++) { const e = g.get(cls[k]) ?? [0, 0]; e[0]++; e[1] += y[k]; g.set(cls[k], e); }
  let between = 0, total = 0; for (const [, [c, sm]] of g) between += c * (sm / c - my) ** 2; for (const v of y) total += (v - my) ** 2;
  return total > 0 ? between / total : NaN;
}
const quant = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const grid = (run: Run, from: number, step: number) => [...run.sweeps.keys()].filter((t) => t >= from && (t - from) % step === 0).sort((a, b) => a - b);

function opts(args: string[]) {
  return (k: string, d?: string) => { const i = args.indexOf(`--${k}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const o = opts(args);
  if (mode === 'linkage') return linkage(o);
  const seeds = (o('seeds', '1,2,3,4') ?? '').split(',').map(Number);
  const tau = Number(o('tau', '20')), window = Number(o('window', '100000')), from = Number(o('from', '300000')), gstep = Number(o('grid', '25000')), area = Number(o('area', '4')), js = o('json');
  const [root, armList] = args, arms = (armList ?? '').split(',');
  const out: Record<string, unknown> = {};
  if (mode === 'roles') {
    console.log(`tau ${tau} units per ${window / 1000}k window; grid from ${from / 1000}k every ${gstep / 1000}k; a cell is credited with its own and its ancestors' conversions`);
    for (const arm of arms) {
      for (const seed of seeds) {
        const run = await load(join(root, arm, `s${seed}`), seed);
        if (!run) continue;
        const G = grid(run, from, gstep);
        if (!G.length || !live(run, G[G.length - 1]).length) { console.log(`${arm} s${seed}: no live cells in the last window (final step ${run.steps})`); continue; }
        const act = G.map((T) => rolesAt(run, T, tau, window)), byt = G.map((T) => bytesAt(run, T));
        const end = act[act.length - 1], bend = byt[byt.length - 1];
        const fwd = cladeRolesAt(run, run.steps - window, tau, window);
        const two = (r: Roles) => r.conv > 0 && r.harv / r.conv >= 0.2 && r.dig / r.conv >= 0.2;
        const twoB = (b: ByteClasses) => b.live > 0 && b.harv / b.live >= 0.2 && b.dig / b.live >= 0.2;
        console.log(`${arm} s${seed} end live ${end.live}: converting ${end.conv} (harv ${end.harv} mixed ${end.mixed} dig ${end.dig}), consumers ${end.consumers}; two-roles(end) ${two(end)}, whole-window ${act.every(two)}; ` +
          `shares harv/dig of converting by grid: ${act.map((r) => `${pct(r.harv, r.conv)}/${pct(r.dig, r.conv)}`).join(' ')}; consumers of live by grid: ${act.map((r) => pct(r.consumers, r.live)).join(' ')}; ` +
          `bytes(end) harv ${bend.harv} mixed ${bend.mixed} dig ${bend.dig} idle ${bend.idle}, two-byte-roles(end) ${twoB(bend)} whole-window ${byt.every(twoB)}; ` +
          `bytes shares h/m/d by grid: ${byt.map((b) => `${pct(b.harv, b.live)}/${pct(b.mixed, b.live)}/${pct(b.dig, b.live)}`).join(' ')}; ` +
          `clade view (live at ${(run.steps - window) / 1000}k): ${fwd.live} cells, converting ${fwd.conv}, harv ${fwd.harv} mixed ${fwd.mixed} dig ${fwd.dig}, consumers ${fwd.consumers}; conv quantiles(end) p10 ${f1(quant(end.totals, 0.1), 0)} p50 ${f1(quant(end.totals, 0.5), 0)} p90 ${f1(quant(end.totals, 0.9), 0)}; median f ${f1(quant(end.fs, 0.5), 2)}`);
        // diagnostics: how well the unit-based f follows the bytes, and whether clades of each role leave live descendants
        const cs = live(run, G[G.length - 1]), fu: number[] = [], fb: number[] = [];
        for (const c of cs) { const [h, d] = ancestry(run, c.id, run.steps - window, run.steps); if (h + d >= tau && c.h + c.d >= 10) { fu.push(d / (h + d)); fb.push(c.d / (c.h + c.d)); } }
        const liveEnd = new Set(cs.map((c) => c.id)), survives = (id: number): boolean => liveEnd.has(id) || (run.children.get(id) ?? []).some(survives);
        const sv = { harv: [0, 0], mixed: [0, 0], dig: [0, 0], cons: [0, 0] };
        for (const c of live(run, run.steps - window)) {
          const [h, d] = clade(run, c.id, run.steps - window, run.steps), k = h + d < tau ? 'cons' : d / (h + d) < 0.25 ? 'harv' : d / (h + d) > 0.75 ? 'dig' : 'mixed';
          sv[k][1]++; if (survives(c.id)) sv[k][0]++;
        }
        console.log(`   corr(f units, f bytes) over live cells at end ${f1(pearson(fu, fb), 2)}; clades with a live descendant at the end: harv ${sv.harv[0]}/${sv.harv[1]}, mixed ${sv.mixed[0]}/${sv.mixed[1]}, dig ${sv.dig[0]}/${sv.dig[1]}, consumers ${sv.cons[0]}/${sv.cons[1]}`);
        out[`${arm}/s${seed}`] = { grid: G, act: act.map(({ totals: _t, ...r }) => r), byt, fwd: { ...fwd, totals: undefined } };
      }
    }
  } else if (mode === 'track') {
    for (const arm of arms) for (const seed of seeds) {
      const j = join(root, arm, `s${seed}`, `s${seed}.json`);
      if (!existsSync(j)) continue;
      const rows = JSON.parse(readFileSync(j, 'utf8')).rows as Record<string, number>[];
      const at = (t: number) => rows.find((r) => r.t === t);
      const mean = (lo: number, hi: number, k: string) => { const rs = rows.filter((r) => r.t > lo && r.t <= hi); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
      const per = [100000, 200000, 300000, 400000].map((t) => {
        const a = at(t), b = at(t - 100000);
        return a ? `${t / 1000}k: live ${a.live}, h ${a.hMean ?? '-'}, d ${a.dMean ?? '-'}, harv/100k ${a.harvests !== undefined ? a.harvests - (b?.harvests ?? 0) : '-'}, dig/100k ${a.digests !== undefined ? a.digests - (b?.digests ?? 0) : '-'}` : '';
      });
      // takeover: first census step after which bead-mean harvest stays above 150 and digest below 50 to the end
      let take = -1;
      if (rows[0].hMean !== undefined) for (let i = rows.length - 1; i >= 0 && rows[i].hMean > 150 && rows[i].dMean < 50; i--) take = rows[i].t;
      const lv = rows.filter((r) => r.t % 100000 === 0).map((r) => r.live);
      console.log(`${arm} s${seed}: ${per.join(' | ')} | takeover(h>150,d<50 from here to end) ${take} | 200-300k -> 300-400k means: food ${f1(mean(200000, 300000, 'food'), 0)} -> ${f1(mean(300000, 400000, 'food'), 0)}, waste ${f1(mean(200000, 300000, 'waste'), 0)} -> ${f1(mean(300000, 400000, 'waste'), 0)}, freeLipid ${f1(mean(200000, 300000, 'freeLipid'), 0)} -> ${f1(mean(300000, 400000, 'freeLipid'), 0)}, live ${f1(mean(200000, 300000, 'live'))} -> ${f1(mean(300000, 400000, 'live'))}; live at 0,100k..: ${lv.join(',')}`);
    }
  } else if (mode === 'light') {
    const wl = wild(area), w = new VesicleWorld(1, { ...METABOLISM, ...wl.params });
    for (const arm of arms) {
      const tot = { h: [0, 0], m: [0, 0], d: [0, 0], a: [0, 0] }; let litFrac = 0, nT = 0;
      for (const seed of seeds) {
        const run = await load(join(root, arm, `s${seed}`), seed);
        if (!run) continue;
        for (const T of grid(run, from, 2500)) {
          (w as unknown as { step: number }).step = T;
          const n = w.lightMask(); litFrac += n / (w.gw * w.gh); nT++;
          for (const c of live(run, T)) {
            const s = c.h + c.d; if (s < 10) continue;
            const f = c.d / s, k = f < 0.25 ? 'h' : f > 0.75 ? 'd' : 'm';
            const cell = Math.min(w.gh - 1, Math.floor(c.cy / w.p.cell)) * w.gw + Math.min(w.gw - 1, Math.floor(c.cx / w.p.cell));
            for (const key of [k, 'a'] as const) { tot[key][1]++; tot[key][0] += w.litMask[cell]; }
          }
        }
      }
      console.log(`${arm}: lit share of dish ${f1((100 * litFrac) / nT)}%; centroid in light: harvest-leaning ${tot.h[0]}/${tot.h[1]} (${pct(tot.h[0], tot.h[1])}), mixed ${tot.m[0]}/${tot.m[1]} (${pct(tot.m[0], tot.m[1])}), digest-leaning ${tot.d[0]}/${tot.d[1]} (${pct(tot.d[0], tot.d[1])}), all ${tot.a[0]}/${tot.a[1]} (${pct(tot.a[0], tot.a[1])}) [cell-sweeps from ${from}]`);
    }
  } else if (mode === 'divisions') {
    for (const arm of arms) {
      const rs = [];
      for (const seed of seeds) { const d = await divisions(join(root, arm, `s${seed}`)); if (d) rs.push(d); }
      const m = (k: 'pinches' | 'inWindow' | 'productive' | 'meanLive' | 'rate') => rs.reduce((a, d) => a + d[k], 0) / (rs.length || 1);
      console.log(`${arm}: ${rs.map((d) => `s${d.run.split('/').pop()?.slice(1)} ${d.productive}/${d.inWindow} (${f1((100 * d.productive) / d.inWindow, 0)}%) live ${f1(d.meanLive)} rate ${f1(d.rate, 2)}`).join('; ')} | mean productive/window ${f1(m('productive'))}/${f1(m('inWindow'))}, live ${f1(m('meanLive'))}, rate ${f1(m('rate'), 2)}`);
    }
  } else throw new Error('modes: roles | track | light | divisions | linkage');
  if (js) writeFileSync(js, JSON.stringify(out));
}

/** Neutral-twin re-run (same options as arms N and N-mut0), bead-level scans every 2500 steps:
 *  mut 0: every live bead's (wgene, wmark, wh, wd) must equal one founder's triple: counts of violations and of rings holding more than one triple.
 *  mut > 0: over live cells (solute >= 5), Pearson correlation across cells of ring-mean marker with ring-mean raw h (and d), and over their beads. */
async function linkage(o: ReturnType<typeof opts>) {
  const seed = Number(o('seed', '1')), mut = Number(o('mut', '0')), steps = Number(o('steps', '400000')), every = 2500, out = o('out');
  const founderJobs = [[255, 0], [0, 255], [128, 128]] as [number, number][], founderMark = [11, 22, 33];
  const w = garden(seed, { founderJobs, founderMark, params: { ...JOBS_INERT, mut } });
  const m0 = w.matter(), weather = new Weather(seed, 0, 0);
  const keyOf = (i: number) => `${w.wgene[i]},${w.wmark[i]},${w.wh[i]},${w.wd[i]}`;
  const founderKeys = new Set<string>(); for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) founderKeys.add(keyOf(i));
  // marker class = which founder marker (11, 22, 33) a value is nearest to; the founders' h are 255, 0, 128, so marker and h are linked but not monotonically
  const nearest = (m: number) => (m < 16.5 ? 0 : m < 27.5 ? 1 : 2);
  const scans: Record<string, number | string>[] = [];
  let violations = 0, scanned = 0, ringsSeen = 0, mixedSeen = 0;
  const scan = (t: number) => {
    // every alive bead against the founder triples (all rings, live or not)
    let bad = 0, beads = 0; const kinds = new Map<string, number>();
    for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) { beads++; const k = keyOf(i); kinds.set(k, (kinds.get(k) ?? 0) + 1); if (mut === 0 && !founderKeys.has(k)) bad++; }
    violations += bad; scanned += beads;
    const rm: number[] = [], rh: number[] = [], rd: number[] = [], bm: number[] = [], bh: number[] = [], bd: number[] = [];
    let cells = 0, mixed = 0;
    for (const l of loops(w, true)) {
      if (l.solute < 5) continue;
      cells++; let n = 0, sm = 0, sh = 0, sd = 0; const ks = new Set<string>();
      for (let i = l.first, first = true; first || i !== l.first; i = w.next[i], first = false) { n++; sm += w.wmark[i]; sh += w.wh[i]; sd += w.wd[i]; ks.add(keyOf(i)); bm.push(w.wmark[i]); bh.push(w.wh[i]); bd.push(w.wd[i]); }
      if (ks.size > 1) mixed++;
      rm.push(sm / n); rh.push(sh / n); rd.push(sd / n);
    }
    ringsSeen += cells; mixedSeen += mixed;
    scans.push({ t, liveCells: cells, mixedCells: mixed, beads, offFounder: bad, kinds: kinds.size, corrCellsMarkH: pearson(rm, rh), corrCellsMarkD: pearson(rm, rd), corrBeadsMarkH: pearson(bm, bh), corrBeadsMarkD: pearson(bm, bd), etaCellsMarkClassH: eta2(rm.map(nearest), rh), etaBeadsMarkClassH: eta2(bm.map(nearest), bh),
      topKinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' ') });
  };
  scan(0);
  for (let t = 1; t <= steps; t++) {
    w.tick(); weather.after(w, t);
    if (t % every === 0 || t === steps) {
      const bad = check(w); if (w.matter() !== m0) bad.push('matter');
      if (bad.length) throw new Error(`step ${w.step}: ${bad.join('; ')}`);
      scan(t);
    }
  }
  const res = { seed, mut, steps, digest: w.digest(), founderKeys: [...founderKeys], violations, scannedBeads: scanned, liveCellScans: ringsSeen, mixedCellScans: mixedSeen, scans };
  if (out) writeFileSync(out, JSON.stringify(res));
  console.log(`linkage seed ${seed} mut ${mut}: digest ${res.digest}, bead-scans ${scanned}, beads off every founder triple ${violations}, live-cell scans ${ringsSeen} of which holding more than one triple ${mixedSeen}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
