// Stage 1 + 3 analysis (thread and wild-dish runs): reads run bundles (s<seed>.json, s<seed>.pinch.tsv, s<seed>.cells.tsv), streams the logs
// line by line and prints markdown tables. Pure reader; changes no run.
// Usage: node experiments/vesicle/threads.ts report [--out runs/vesicle/s1/threads.json]
//        node experiments/vesicle/threads.ts copies [--steps 100000] [--seed 1]   (short wall and thread runs: copy events per division)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../runs/vesicle/', import.meta.url).pathname;
type Row = Record<string, number>;
const SEEDS = [1, 2, 3, 4];

interface Arm { key: string; label: string; dir: string; thread: boolean }
const ARMS: Arm[] = [
  { key: 'A0', label: 'A free thread, mut 0', dir: 's1/A-thread-mut0', thread: true },
  { key: 'A.01', label: 'A free thread, mut 0.01', dir: 's1/A-thread-mut0.01', thread: true },
  { key: 'A.1', label: 'A free thread, mut 0.1', dir: 's1/A-thread-mut0.1', thread: true },
  { key: 'A1', label: 'A free thread, mut 1.0', dir: 's1/A-thread-mut1.0', thread: true },
  { key: 'B.01', label: 'B anchored thread, mut 0.01', dir: 's1/B-anch-mut0.01', thread: true },
  { key: 'B.1', label: 'B anchored thread, mut 0.1', dir: 's1/B-anch-mut0.1', thread: true },
  { key: 'B1', label: 'B anchored thread, mut 1.0', dir: 's1/B-anch-mut1.0', thread: true },
  { key: 'C', label: 'C drift only (no heredity)', dir: 's1/C-drift', thread: false },
  { key: 'W.01', label: 'stage 0 wall heredity, mut 0.01', dir: 's0/wall-mut0.01', thread: false },
  { key: 'W.1', label: 'stage 0 wall heredity, mut 0.1', dir: 's0/wall-mut0.1', thread: false },
  { key: 'D', label: 'D wall heredity, mut 0.1, 1.5M', dir: 's1/D-wall-mut0.1-1.5M', thread: false },
  { key: 'E', label: 'E free thread, mut 0.1, 1.5M', dir: 's1/E-thread-mut0.1-1.5M', thread: true },
  { key: 'FW', label: 'F wild dish, wall, mut 0.01', dir: 's1/F-wild-wall-mut0.01', thread: false },
  { key: 'FT.01', label: 'F wild dish, thread, mut 0.01', dir: 's1/F-wild-thread-mut0.01', thread: true },
  { key: 'FT.1', label: 'F wild dish, thread, mut 0.1', dir: 's1/F-wild-thread-mut0.1', thread: true },
];

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : NaN; };
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
function slope(x: number[], y: number[]): { b: number; r: number } {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { b: sxx > 0 ? sxy / sxx : NaN, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN };
}
/** Visit a tsv one line at a time as objects keyed by header. */
function eachRow(path: string, fn: (r: Record<string, string>) => void): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  let head: string[] | undefined, i = 0;
  while (i < text.length) {
    let j = text.indexOf('\n', i); if (j < 0) j = text.length;
    const line = text.slice(i, j); i = j + 1;
    if (!line) continue;
    const cols = line.split('\t');
    if (!head) { head = cols; continue; }
    const r: Record<string, string> = {};
    for (let k = 0; k < head.length; k++) r[head[k]] = cols[k] ?? '';
    fn(r);
  }
}
const rowsOf = (dir: string, s: number): Row[] => {
  const p = join(ROOT, dir, `s${s}`, `s${s}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).rows as Row[]) : [];
};
const nearest = (rows: Row[], t: number) => rows.reduce((b, r) => (Math.abs(r.t - t) < Math.abs(b.t - t) ? r : b), rows[0]);

function report(): string {
  const out: string[] = [], J: Record<string, unknown> = {};
  const P = (s = '') => out.push(s);

  // ---- 1. cells alive and totals per run
  P('## 1. Cells alive at the last step, per seed (live = at least 5 solute)\n');
  P('| arm | steps | live s1 | s2 | s3 | s4 | mean | pinches (sum of 4) | min over rows 100k..end (per seed) | threads at end (per seed) |');
  P('|---|---|---|---|---|---|---|---|---|---|');
  const live: Record<string, number[]> = {};
  for (const a of ARMS) {
    const lives: number[] = [], pin: number[] = [], mins: number[] = [], th: number[] = []; let steps = 0;
    for (const s of SEEDS) {
      const rows = rowsOf(a.dir, s); if (!rows.length) continue;
      const last = rows[rows.length - 1]; steps = last.t; lives.push(last.live); pin.push(last.pinch);
      mins.push(Math.min(...rows.filter((r) => r.t >= 100000).map((r) => r.live))); if (a.thread) th.push(last.threads);
    }
    live[a.key] = lives;
    P(`| ${a.label} | ${steps} | ${lives.join(' | ')} | ${f(mean(lives))} | ${pin.reduce((x, y) => x + y, 0)} | ${mins.join(', ')} | ${a.thread ? th.join(', ') : '-'} |`);
  }
  J.live = live;

  P('\n## 1b. Live cells over time (mean over seeds; extinct seeds counted as 0)\n');
  P('| arm | t=0 | 25k | 50k | 100k | 200k | 400k |');
  P('|---|---|---|---|---|---|---|');
  for (const a of ARMS) {
    const cols = [0, 25000, 50000, 100000, 200000, 400000].map((t) => f(mean(SEEDS.map((s) => { const r = rowsOf(a.dir, s); return r.length ? nearest(r, t).live : NaN; }).filter(Number.isFinite))));
    P(`| ${a.label} | ${cols.join(' | ')} |`);
  }

  // ---- 2. heritable byte over time
  P('\n## 2. The heritable byte over time (mean over seeds of the run row; thread arms: thread gene 0, over all threads; wall arms: mean of cells wall gene; drift and old arms: solute gene per cell)\n');
  const times = [0, 100000, 200000, 300000, 400000, 800000, 1500000];
  P(`| arm | ${times.map((t) => `t=${t / 1000}k`).join(' | ')} | per-seed at end |`);
  P(`|---|${times.map(() => '---').join('|')}|---|`);
  const traj: Record<string, number[]> = {};
  for (const a of ARMS) {
    const cols: string[] = [], vals: number[] = [];
    const key = a.thread ? 'thread0' : (rowsOf(a.dir, 1)[0]?.wallGene !== undefined ? 'wallGene' : 'geneCell');
    for (const t of times) {
      const v = SEEDS.map((s) => { const r = rowsOf(a.dir, s); if (!r.length || r[r.length - 1].t < t) return NaN; const row = nearest(r, t); return a.thread && row.threads === 0 ? NaN : row[key]; }).filter(Number.isFinite);
      cols.push(v.length ? f(mean(v)) : '-'); if (v.length && t === 400000) vals.push(...v);
    }
    const endsAll = SEEDS.map((s) => { const r = rowsOf(a.dir, s); if (!r.length) return NaN; const l = r[r.length - 1]; return a.thread && l.threads === 0 ? NaN : l[key]; });
    const ends = endsAll.filter(Number.isFinite); traj[a.key] = ends;
    P(`| ${a.label} [${key}] | ${cols.join(' | ')} | ${endsAll.map((v) => f(v)).join(', ')} |`);
  }
  J.endByte = traj;

  // ---- 3. segregation
  P('\n## 3. Segregation: pinches whose mother held at least one thread (point-in-polygon, just before the pinch)\n');
  P('Daughters with zero threads, among daughters of such pinches. Rows of kind `end` (dissolve, burst) have no daughters and are skipped. A mother with exactly 1 thread cannot give one to both daughters, so the m=1 stratum is at least 50% by construction.\n');
  P('| arm | pinches with m>=1 | daughters with 0 threads | pinches where either daughter has 0 | m=1: daughters 0 | m=2: daughters 0 | m>=3: daughters 0 | daughters with >=1 thread, mean threads | viable daughters (>=5 solute) with 0 threads |');
  P('|---|---|---|---|---|---|---|---|---|');
  const seg: Record<string, unknown> = {};
  for (const a of ARMS.filter((x) => x.thread)) {
    let pin = 0, dz = 0, dn = 0, either = 0, vz = 0, vn = 0; const st = [[0, 0], [0, 0], [0, 0]]; const have: number[] = [];
    for (const s of SEEDS) eachRow(join(ROOT, a.dir, `s${s}`, `s${s}.pinch.tsv`), (r) => {
      if (r.ev !== 'pinch') return;
      const m = Number(r.m_threads), ta = Number(r.a_threads), tb = Number(r.b_threads);
      if (!(m >= 1)) return;
      pin++; dn += 2; const z = (ta === 0 ? 1 : 0) + (tb === 0 ? 1 : 0); dz += z; if (z) either++;
      const k = m >= 3 ? 2 : m - 1; st[k][0] += 2; st[k][1] += z;
      if (ta > 0) have.push(ta); if (tb > 0) have.push(tb);
      if (Number(r.a_solute) >= 5) { vn++; if (ta === 0) vz++; }
      if (Number(r.b_solute) >= 5) { vn++; if (tb === 0) vz++; }
    });
    seg[a.key] = { pinches: pin, daughters: dn, zero: dz, either, strata: st, viableDaughters: vn, viableZero: vz };
    P(`| ${a.label} | ${pin} | ${dz}/${dn} = ${pct(dz, dn)} | ${either}/${pin} = ${pct(either, pin)} | ${pct(st[0][1], st[0][0])} (n=${st[0][0]}) | ${pct(st[1][1], st[1][0])} (n=${st[1][0]}) | ${pct(st[2][1], st[2][0])} (n=${st[2][0]}) | ${f(mean(have), 2)} | ${vz}/${vn} = ${pct(vz, vn)} |`);
  }
  J.segregation = seg;

  // ---- 3b. threads per live cell
  P('\n## 3b. Threads per live cell (cells.tsv, solute >= 5), pooled over seeds and over the censuses at or after step 350,000 (or the last 20% of the run for 1.5M runs: step >= 1,200,000)\n');
  P('| arm | live cell-samples | 0 | 1 | 2 | 3 | 4 | 5+ | mean | sd |');
  P('|---|---|---|---|---|---|---|---|---|---|');
  const dist: Record<string, number[]> = {};
  for (const a of ARMS.filter((x) => x.thread)) {
    const h = [0, 0, 0, 0, 0, 0], vals: number[] = [];
    for (const s of SEEDS) {
      const rows = rowsOf(a.dir, s); if (!rows.length) continue;
      const end = rows[rows.length - 1].t, from = end > 500000 ? 0.8 * end : end - 50000;
      eachRow(join(ROOT, a.dir, `s${s}`, `s${s}.cells.tsv`), (r) => {
        if (Number(r.step) < from || Number(r.solute) < 5) return;
        const n = Number(r.threads); h[Math.min(5, n)]++; vals.push(n);
      });
    }
    dist[a.key] = h; const tot = h.reduce((x, y) => x + y, 0);
    P(`| ${a.label} | ${tot} | ${h.map((v) => pct(v, tot)).join(' | ')} | ${f(mean(vals), 2)} | ${f(sd(vals), 2)} |`);
  }
  J.perCell = dist;

  // ---- 4. linkage
  P('\n## 4. Linkage of gene 1 (neutral marker) with gene 0 (lipid share)\n');
  P('Daughters (of pinches whose mother held >=1 thread) that received >=1 thread: daughter mean gene vs mother mean gene (means over the threads inside). `same` = daughter mean equals mother mean exactly. slope/corr of daughter on mother. `cell corr(t0,t1)` = across live cells holding threads at the same late censuses as 3b.\n');
  P('| arm | pairs | t1 same | t0 same | both same | t1 same given t0 same | mean abs diff t0 | mean abs diff t1 | slope t1 (corr) | slope t0 (corr) | sd of t1 across cells | cell corr(t0,t1) |');
  P('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const link: Record<string, unknown> = {};
  for (const a of ARMS.filter((x) => x.thread)) {
    const m0: number[] = [], d0: number[] = [], m1: number[] = [], d1: number[] = [];
    for (const s of SEEDS) eachRow(join(ROOT, a.dir, `s${s}`, `s${s}.pinch.tsv`), (r) => {
      if (r.ev !== 'pinch' || Number(r.m_threads) < 1) return;
      for (const d of ['a', 'b']) if (Number(r[`${d}_threads`]) >= 1) { m0.push(Number(r.m_t0)); m1.push(Number(r.m_t1)); d0.push(Number(r[`${d}_t0`])); d1.push(Number(r[`${d}_t1`])); }
    });
    const n = m0.length; let s1 = 0, s0 = 0, sb = 0, s1g0 = 0, a0 = 0, a1 = 0;
    for (let i = 0; i < n; i++) {
      const e0 = Math.abs(d0[i] - m0[i]) < 1e-9, e1 = Math.abs(d1[i] - m1[i]) < 1e-9;
      if (e1) s1++; if (e0) s0++; if (e0 && e1) sb++; if (e0 && e1) s1g0++; a0 += Math.abs(d0[i] - m0[i]); a1 += Math.abs(d1[i] - m1[i]);
    }
    // cell-level association
    const c0: number[] = [], c1: number[] = [];
    for (const s of SEEDS) {
      const rows = rowsOf(a.dir, s); if (!rows.length) continue;
      const end = rows[rows.length - 1].t, from = end > 500000 ? 0.8 * end : end - 50000;
      eachRow(join(ROOT, a.dir, `s${s}`, `s${s}.cells.tsv`), (r) => { if (Number(r.step) >= from && Number(r.solute) >= 5 && Number(r.threads) >= 1) { c0.push(Number(r.t0)); c1.push(Number(r.t1)); } });
    }
    const sl1 = slope(m1, d1), sl0 = slope(m0, d0), cc = slope(c0, c1);
    // how often are both bytes unchanged given that mother and daughter t0 are the same (for 'both same' vs 't0 same')
    link[a.key] = { pairs: n, t1same: s1, t0same: s0, both: sb };
    P(`| ${a.label} | ${n} | ${pct(s1, n)} | ${pct(s0, n)} | ${pct(sb, n)} | ${pct(s1g0, s0)} | ${f(a0 / n, 2)} | ${f(a1 / n, 2)} | ${f(sl1.b, 2)} (${f(sl1.r, 2)}) | ${f(sl0.b, 2)} (${f(sl0.r, 2)}) | ${f(sd(c1), 2)} | ${f(cc.r, 2)} |`);
  }
  J.linkage = link;

  // ---- 5. divisions per cell per 100k steps, cells in the dish
  P('\n## 5. Divisions per live cell per 100,000 steps (pinches / mean live cells over the censuses from step 20,000, per 100k steps), and cells held\n');
  P('| arm | dish | pinches per 100k steps (mean over seeds) | mean live cells (censuses from 20k) | pinches per live cell per 100k | viable pinches (both daughters >=5 solute) per 100k | viable divisions per live cell per 100k | live at end (mean) | live at end per 192x192 area |');
  P('|---|---|---|---|---|---|---|---|---|');
  const rate: Record<string, number> = {};
  for (const a of ARMS) {
    const pr: number[] = [], lv: number[] = [], rr: number[] = [], ends: number[] = [], vp: number[] = [], vr: number[] = [];
    for (const s of SEEDS) {
      const rows = rowsOf(a.dir, s); if (!rows.length) continue;
      const late = rows.filter((r) => r.t >= 20000), last = rows[rows.length - 1], first = nearest(rows, 20000);
      const p = (last.pinch - first.pinch) / ((last.t - first.t) / 100000), l = mean(late.map((r) => r.live));
      pr.push(p); lv.push(l); rr.push(p / l); ends.push(last.live);
      let v = 0; eachRow(join(ROOT, a.dir, `s${s}`, `s${s}.pinch.tsv`), (r) => { if (r.ev === 'pinch' && Number(r.step) > first.t && Number(r.a_solute) >= 5 && Number(r.b_solute) >= 5) v++; });
      const vv = v / ((last.t - first.t) / 100000); vp.push(vv); vr.push(vv / l);
    }
    const wild = a.dir.includes('F-wild'), area = wild ? 4 : 1;
    rate[a.key] = mean(vr);
    P(`| ${a.label} | ${wild ? '384x384 (4x)' : '192x192'} | ${f(mean(pr))} | ${f(mean(lv))} | ${f(mean(rr), 2)} | ${f(mean(vp))} | ${f(mean(vr), 2)} | ${f(mean(ends))} | ${f(mean(ends) / area)} |`);
  }
  J.divisionsPerCellPer100k = rate;
  return out.join('\n');
}

async function copies(): Promise<string> {
  const { runGarden } = await import('./run.ts');
  const { THREAD, WALL_GENES } = await import('../../apps/lab/src/vesicle/worlds.ts');
  const args = process.argv.slice(2), g = (k: string, d: number) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
  const steps = g('steps', 100000), seed = g('seed', 1);
  const out: string[] = ['| arm | steps | live (mean of rows) | pinches | copy events of the heritable byte | copies per pinch | copy events per live cell per 100k steps | expected shifts per pinch at the arm\'s mut |', '|---|---|---|---|---|---|---|---|'];
  const arms: [string, Record<string, unknown>, (e: { insert: number; tcopy: number }) => number, string][] = [
    ['wall mut 0.1', { ...WALL_GENES, mut: 0.1 }, (e) => e.insert, 'insert (every new wall bead copies one byte from a neighbour)'],
    ['wall mut 0.01', { ...WALL_GENES, mut: 0.01 }, (e) => e.insert, 'insert'],
    ['thread mut 0.1', { ...THREAD, mut: 0.1 }, (e) => e.tcopy, 'tcopy (the thread copy copies gene 0 once)'],
  ];
  for (const [name, params, count] of arms) {
    const r = runGarden({ seed, steps, every: 5000, params, quiet: true } as never);
    const ev = r.world.events, n = count(ev), live = mean(r.rows.filter((x) => x.t >= 20000).map((x) => x.live)), pin = ev.pinch;
    const mut = (params as { mut: number }).mut;
    out.push(`| ${name} | ${steps} | ${f(live)} | ${pin} | ${n} | ${f(n / pin, 1)} | ${f(n / live / (steps / 100000), 1)} | ${f((n / pin) * mut, 2)} |`);
  }
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2];
  if (cmd === 'copies') console.log(await copies());
  else console.log(report());
}
