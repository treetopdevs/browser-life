// Stage 4 ("bodies", ties) analysis. Streams run bundles (s<seed>.json, .cells.tsv, .pinch.tsv, .ties.tsv); changes no run.
// Usage: node experiments/vesicle/clusters.ts ROOT [--json out.json]
//   ROOT holds the arm folders mech T I R R0 T255 (each with s1..s4). Prints markdown tables:
//   (a) mechanics, (b) glue trajectories and last-200k comparison with the inert twin, (c) life cycle, (d) stop condition,
//   plus divisions per arm and tied versus single cells (division and end rates per cell, stratified by cell age).
//
// Cluster tracking rests on one fact of the rules: ties form only between the two daughters of a pinch, so clusters never merge.
// A cluster at census k is the set of live cells (solute >= 5) sharing a handle in cells.tsv. Its children at census k+1 are the clusters
// that hold a live descendant of one of its cells (descent follows the pinch log). Sizes are in live cells unless stated.
// Lineage of clusters: a lineage starts either (E1) when a node of size >= 2 has a parent of size 1 (a single cell divided and tied), or
// (E2) when a non-main child of a node of size >= 2 has size >= 2 (a piece shed from a cluster). It follows main children (the largest
// child; the lowest handle on ties) until the size falls below 2.
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { divisions } from './divisions.ts';

async function* lines(path: string): AsyncGenerator<string[]> {
  let head = true;
  for await (const l of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) { if (!l) continue; if (head) { head = false; continue; } yield l.split('\t'); }
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const quant = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

type Row = Record<string, number>;
interface Cell { id: number; solute: number; glue: number; ties: number; handle: number }
interface Census { t: number; cells: Cell[] }
interface Pinch { step: number; mother: number; d1: number; d2: number }
interface End { step: number; id: number; kind: string }

export interface RunData { seeds: number; rows: Row[]; censuses: Census[]; pinches: Pinch[]; ends: End[]; ties: string[][] }

export async function load(dir: string): Promise<RunData> {
  const seed = dir.split('/').pop()!.replace(/^s/, '');
  const rows = JSON.parse(readFileSync(join(dir, `s${seed}.json`), 'utf8')).rows as Row[];
  const censuses: Census[] = [];
  for await (const c of lines(join(dir, `s${seed}.cells.tsv`))) {
    const t = Number(c[0]);
    if (!censuses.length || censuses[censuses.length - 1].t !== t) censuses.push({ t, cells: [] });
    // step id beads solute gMean gSd wMean wSd area cx cy glue ties cluster handle
    censuses[censuses.length - 1].cells.push({ id: Number(c[1]), solute: Number(c[3]), glue: Number(c[11]), ties: Number(c[12]), handle: Number(c[14]) });
  }
  const pinches: Pinch[] = [], ends: End[] = [];
  for await (const c of lines(join(dir, `s${seed}.pinch.tsv`))) {
    if (c[0] === 'pinch') pinches.push({ step: Number(c[1]), mother: Number(c[2]), d1: Number(c[3]), d2: Number(c[4]) });
    else if (c[0] === 'end') ends.push({ step: Number(c[1]), id: Number(c[2]), kind: c[5] });
  }
  const ties: string[][] = [];
  const tp = join(dir, `s${seed}.ties.tsv`);
  if (existsSync(tp)) for await (const c of lines(tp)) ties.push(c);
  return { seeds: Number(seed), rows, censuses, pinches, ends, ties };
}

// ---- (c) life cycle -------------------------------------------------------------------------------------------------------------------
interface Node { k: number; handle: number; members: number[]; size: number; parent?: Node; children: Node[]; lineage?: number }
interface Lineage { id: number; start: Node; kind: 'E1' | 'E2'; startSize: number; path: Node[]; mother?: number; maxSize: number; rounds: number; depth: number }

export function lifeCycle(d: RunData) {
  const cs = d.censuses, K = cs.length;
  // nodes per census
  const nodes: Map<number, Node>[] = cs.map((c, k) => {
    const m = new Map<number, Node>();
    for (const x of c.cells) {
      if (x.solute < 5) continue;
      let n = m.get(x.handle);
      if (!n) { n = { k, handle: x.handle, members: [], size: 0, children: [] }; m.set(x.handle, n); }
      n.members.push(x.id); n.size++;
    }
    return m;
  });
  const cellNode: Map<number, Node>[] = nodes.map((m) => { const o = new Map<number, Node>(); for (const n of m.values()) for (const id of n.members) o.set(id, n); return o; });
  const kids = new Map<number, number[]>();
  for (const p of d.pinches) kids.set(p.mother, [p.d1, p.d2]);
  const desc = (id: number, k1: number, out: number[]) => {
    if (cellNode[k1].has(id)) { out.push(id); return; }
    for (const c of kids.get(id) ?? []) desc(c, k1, out);
  };
  let merges = 0, orphans = 0;
  for (let k = 0; k + 1 < K; k++) {
    for (const a of nodes[k].values()) {
      const seen = new Set<Node>();
      for (const id of a.members) { const ds: number[] = []; desc(id, k + 1, ds); for (const x of ds) seen.add(cellNode[k + 1].get(x)!); }
      for (const b of seen) { if (b.parent && b.parent !== a) merges++; b.parent = a; a.children.push(b); }
    }
    for (const b of nodes[k + 1].values()) if (!b.parent) orphans++;
  }
  const mainChild = (n: Node) => [...n.children].sort((x, y) => y.size - x.size || x.handle - y.handle)[0];
  // lineage starts
  const lineages: Lineage[] = [];
  const startAt = (n: Node, kind: 'E1' | 'E2') => {
    const L: Lineage = { id: lineages.length, start: n, kind, startSize: n.size, path: [], maxSize: 0, rounds: 0, depth: 0 };
    lineages.push(L);
    let cur: Node | undefined = n, prev: Node | undefined, grew = false, maxS = 0;
    while (cur && cur.size >= 2) {
      cur.lineage = L.id; L.path.push(cur); maxS = Math.max(maxS, cur.size);
      if (prev && cur.size > prev.size) grew = true;
      if (prev && prev.children.length >= 2 && grew && maxS >= 3 && prev.size >= 2) { L.rounds++; grew = false; }
      prev = cur; cur = mainChild(cur);
    }
    // the split that ended the path counts too (the cluster fell below 2 live cells after shedding)
    if (prev && prev.children.length >= 2 && grew && maxS >= 3 && prev.size >= 2) L.rounds++;
    L.maxSize = maxS;
  };
  for (let k = 1; k < K; k++) {
    for (const n of nodes[k].values()) {
      if (n.size < 2 || !n.parent) continue;
      if (n.parent.size === 1) startAt(n, 'E1');
      else if (mainChild(n.parent) !== n) startAt(n, 'E2');
    }
  }
  // mother lineage: nearest ancestor node of size >= 2 on the way up (through singles), if it sits on a lineage path
  const gaps: number[] = [];
  for (const L of lineages) {
    let a: Node | undefined = L.start.parent;
    while (a && a.size < 2) a = a.parent;
    if (a && a.lineage !== undefined) { L.mother = a.lineage; gaps.push(cs[L.start.k].t - cs[a.k].t); }
  }
  for (const L of lineages) { let dpt = 0, x: Lineage | undefined = L; while (x?.mother !== undefined && dpt < 50) { dpt++; x = lineages[x.mother]; } L.depth = dpt; }
  // lifetime: from start to the last census on the path (size >= 2); censored when the path reaches the last census
  const life = lineages.map((L) => ({ steps: cs[L.path[L.path.length - 1].k].t - cs[L.start.k].t + (cs[1]?.t ?? 5000), censored: L.path[L.path.length - 1].k === K - 1, reach3: L.maxSize >= 3, kind: L.kind, startSize: L.startSize }));
  return { lineages, life, merges, orphans, gaps, nodesPerCensus: nodes.map((m) => m.size) };
}

/** Piece sizes (in rings) from split events in ties.tsv. */
export function splitPieces(ties: string[][]) {
  const by: Record<string, number[][]> = {}, forms = { n: 0 }, ends: Record<string, number> = {};
  for (const c of ties) {
    if (c[0] === 'form') forms.n++;
    else if (c[0] === 'end') ends[c[5]] = (ends[c[5]] ?? 0) + 1;
    else if (c[0] === 'split') (by[c[5]] ??= []).push(c[6].split(',').map(Number));
  }
  return { by, forms: forms.n, ends };
}

// ---- tied versus single ------------------------------------------------------------------------------------------------------------------
const AGE_BINS = [5000, 15000, 30000, Infinity];
const ageBin = (a: number) => AGE_BINS.findIndex((x) => a < x);
export interface Expo { n: number; div: number; end: number }
export function outcomes(d: RunData, from = 50000) {
  const birth = new Map<number, number>();
  for (const p of d.pinches) { birth.set(p.d1, p.step); birth.set(p.d2, p.step); }
  const mother = new Map<number, number>(), endAt = new Map<number, number>();
  for (const p of d.pinches) mother.set(p.mother, p.step);
  for (const e of d.ends) endAt.set(e.id, e.step);
  const cs = d.censuses;
  // [tied?][ageBin]
  const tab: Expo[][] = [0, 1].map(() => AGE_BINS.map(() => ({ n: 0, div: 0, end: 0 })));
  const win = [0, 0];
  for (let k = 0; k + 1 < cs.length; k++) {
    if (cs[k].t < from) continue;
    const t0 = cs[k].t, t1 = cs[k + 1].t, size = new Map<number, number>();
    for (const c of cs[k].cells) if (c.solute >= 5) size.set(c.handle, (size.get(c.handle) ?? 0) + 1);
    for (const c of cs[k].cells) {
      if (c.solute < 5) continue;
      const tied = (size.get(c.handle) ?? 1) >= 2 ? 1 : 0, age = t0 - (birth.get(c.id) ?? 0), b = tab[tied][ageBin(age)];
      const m = mother.get(c.id), e = endAt.get(c.id);
      b.n++; win[tied] += t1 - t0;
      if (m !== undefined && m > t0 && m <= t1) b.div++;
      else if (e !== undefined && e > t0 && e <= t1) b.end++;
    }
  }
  return { tab, win };
}

// ---- main ------------------------------------------------------------------------------------------------------------------------------
const ARMS = ['mech', 'T', 'I', 'I0', 'R', 'R0', 'T255'];
const SEEDS = [1, 2, 3, 4];

async function main() {
  const args = process.argv.slice(2), root = args[0], jo = args.indexOf('--json'), jout = jo >= 0 ? args[jo + 1] : undefined;
  if (!root) { console.error('usage: node experiments/vesicle/clusters.ts ROOT [--json out.json]'); process.exit(1); }
  const data: Record<string, RunData[]> = {};
  for (const a of ARMS) { data[a] = []; for (const s of SEEDS) { const dir = join(root, a, `s${s}`); if (existsSync(join(dir, `s${s}.json`))) data[a].push(await load(dir)); } }
  const out: Record<string, unknown> = {};
  const at = (r: RunData, t: number) => r.rows.find((x) => x.t === t);
  const last200 = (r: RunData, key = 'glueMean') => { const end = r.rows[r.rows.length - 1].t; return mean(r.rows.filter((x) => x.t > end - 200000).map((x) => x[key])); };

  // (a)
  console.log('## (a) Mechanics: glue 255, mutation 0, 400k steps\n');
  console.log('| seed | live at 400k | min live t>=100k | censuses t>100k | with a cluster of >=3 cells | max cluster | cluster share (mean t>100k) | ties formed | tieBlocked | ended: stretch / desorb / ring-end | hops |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of data.mech) {
    const post = r.rows.filter((x) => x.t > 100000), c3 = post.filter((x) => x.tc3 + x.tc4to7 + x.tc8p >= 1), e = r.rows[r.rows.length - 1];
    console.log(`| ${r.seeds} | ${at(r, 400000)?.live} | ${Math.min(...r.rows.filter((x) => x.t >= 100000).map((x) => x.live))} | ${post.length} | ${c3.length} | ${Math.max(...r.rows.map((x) => x.tcMax))} | ${f(mean(post.map((x) => x.clusterShare)), 3)} | ${e.tieFormed} | ${e.tieBlocked} | ${e.tieStretch} / ${e.tieDesorb} / ${e.tieRingEnd} | ${e.tieHop} |`);
  }

  // (b) trajectories
  console.log('\n## (b) Bead-mean glue every 100k steps (census glueMean)\n');
  const ts = [0, 100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000];
  console.log(`| arm | seed | ${ts.map((t) => `${t / 1000}k`).join(' | ')} | mean last 200k |`);
  console.log(`|---|---|${ts.map(() => '---').join('|')}|---|`);
  const traj: Record<string, Record<number, number[]>> = {};
  for (const a of ['T', 'R', 'R0', 'T255', 'I', 'I0']) for (const r of data[a]) {
    (traj[a] ??= {})[r.seeds] = ts.map((t) => at(r, t)?.glueMean ?? NaN);
    console.log(`| ${a} | ${r.seeds} | ${ts.map((t) => f(at(r, t)?.glueMean ?? NaN, 0)).join(' | ')} | ${f(last200(r), 1)} |`);
  }
  console.log('\nLast-200k mean glue minus the inert twin (arm I, same seed, founder glue 64), and the arm sign count:\n');
  console.log('| arm | s1 | s2 | s3 | s4 | up / down | arm mean | I mean (sd across seeds) |');
  console.log('|---|---|---|---|---|---|---|---|');
  const iv = data.I.map((r) => last200(r)), diffs: Record<string, number[]> = {};
  for (const a of ['T', 'R', 'R0', 'T255']) {
    const dv = data[a].map((r, i) => last200(r) - iv[data[a][i].seeds - 1]);
    diffs[a] = dv;
    console.log(`| ${a} | ${dv.map((x) => f(x, 1)).join(' | ')} | ${dv.filter((x) => x > 0).length} / ${dv.filter((x) => x < 0).length} | ${f(mean(data[a].map((r) => last200(r))), 1)} | ${f(mean(iv), 1)} (${f(sd(iv), 1)}) |`);
  }
  out.glueDiffs = diffs; out.glueTraj = traj;
  // robustness: other windows, and R0 against its own twin I0 (founder glue 0, no ties) when that arm exists
  console.log('\nSame comparison over other windows (arm minus the same-seed twin; up / down; twin = I, and I0 for R0 when run):\n');
  console.log('| arm (twin) | window | s1 | s2 | s3 | s4 | up / down | mean diff |');
  console.log('|---|---|---|---|---|---|---|---|');
  const win = (r: RunData, lo: number, hi: number) => mean(r.rows.filter((x) => x.t > lo && x.t <= hi).map((x) => x.glueMean));
  const wins: [string, number, number][] = [['last 200k', 800000, 1e9], ['last 500k', 500000, 1e9], ['100k..end', 100000, 1e9], ['200k..600k', 200000, 600000]];
  const pairs: [string, string][] = [['T', 'I'], ['R', 'I'], ['R0', 'I'], ['T255', 'I'], ['R0', 'I0'], ['I0', 'I']];
  for (const [a, tw] of pairs) {
    if (!data[a].length || !data[tw].length || data[tw].length < 4) continue;
    for (const [nm, lo, hi] of wins) {
      const dv = data[a].map((r) => win(r, lo, hi) - win(data[tw].find((x) => x.seeds === r.seeds)!, lo, hi));
      console.log(`| ${a} (${tw}) | ${nm} | ${dv.map((x) => f(x, 1)).join(' | ')} | ${dv.filter((x) => x > 0).length} / ${dv.filter((x) => x < 0).length} | ${f(mean(dv), 1)} |`);
    }
  }
  console.log('\nSpread of the last-200k mean across seeds (sd): ' + ARMS.filter((a) => data[a].length > 1 && a !== 'mech').map((a) => `${a} ${f(sd(data[a].map((r) => last200(r))), 1)}`).join(', '));
  // drift scale in the twin: how far glue moves in I from 64 over 1M
  console.log(`\nInert twin drift from 64: last-200k mean per seed ${iv.map((x) => f(x, 1)).join(', ')}; each ties arm minus the I mean: ${['T', 'R', 'R0', 'T255'].map((a) => `${a} ${f(mean(data[a].map((r) => last200(r))) - mean(iv), 1)}`).join(', ')}.`);

  // (d)
  console.log('\n## (d) Stop condition: bead-mean glue under 16\n');
  console.log('| arm | seed | glue at end | min glue t>=200k | last-200k mean | censuses with glue < 16 (t>=20k; of all) | first census < 16 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of ['T', 'T255', 'R', 'R0']) for (const r of data[a]) {
    const lo = r.rows.filter((x) => x.t >= 20000 && x.glueMean < 16), e = r.rows[r.rows.length - 1];
    console.log(`| ${a} | ${r.seeds} | ${f(e.glueMean, 1)} | ${f(Math.min(...r.rows.filter((x) => x.t >= 200000).map((x) => x.glueMean)), 1)} | ${f(last200(r), 1)} | ${lo.length} / ${r.rows.length} | ${lo.length ? lo[0].t : '-'} |`);
  }

  // divisions
  console.log('\n## Live cells and productive divisions (divisions.ts: window 20k..end-20k, live = mean of censuses from 20k)\n');
  console.log('| arm | seed | mean live | productive pinches | productive / live cell / 100k | pinches (all) | ring ends (all) | mean cluster share t>=200k | mean cells in clusters of >=3 |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const divAgg: Record<string, { live: number; rate: number; share: number }> = {};
  for (const a of ARMS) {
    const lv: number[] = [], rt: number[] = [], sh: number[] = [];
    for (const r of data[a]) {
      const dv = await divisions(join(root, a, `s${r.seeds}`));
      if (!dv) continue;
      const post = r.rows.filter((x) => x.t >= 200000), share = mean(post.map((x) => x.clusterShare));
      const c3 = mean(post.map((x) => (x.tc3 * 3 + x.tc4to7 * 5 + x.tc8p * 9)));
      lv.push(dv.meanLive); rt.push(dv.rate); sh.push(share);
      console.log(`| ${a} | ${r.seeds} | ${f(dv.meanLive)} | ${dv.productive} | ${f(dv.rate, 2)} | ${dv.pinches} | ${r.ends.length} | ${f(share, 3)} | ${f(c3, 1)} (rough) |`);
    }
    divAgg[a] = { live: mean(lv), rate: mean(rt), share: mean(sh) };
    console.log(`| **${a}** | mean | ${f(mean(lv))} | | ${f(mean(rt), 2)} | | | ${f(mean(sh), 3)} | |`);
  }
  out.divAgg = divAgg;

  // tied vs single
  console.log('\n## Tied versus single cells (censuses from 50k; per cell per census window of 5000 steps; ages from the pinch log)\n');
  console.log('Division = the cell is the mother of a pinch inside the window; end = a ring-end row (dissolve, burst, wound) inside the window. Rates are per cell per 100k steps.\n');
  console.log('| arm | cell-windows tied / single | division rate tied | division rate single | end rate tied | end rate single | division, single re-weighted to the tied age mix | end, single re-weighted | per-seed tied division rate minus single (age-weighted) |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const tv: Record<string, unknown> = {};
  for (const a of ['mech', 'T', 'R', 'R0', 'T255']) {
    const pooled = [0, 1].map(() => AGE_BINS.map(() => ({ n: 0, div: 0, end: 0 }))), per: number[] = [];
    let win = [0, 0];
    const stdz = (tab: Expo[][], key: 'div' | 'end') => { // single rate re-weighted to the tied age mix
      const nT = tab[1].reduce((x, y) => x + y.n, 0); let s = 0;
      for (let b = 0; b < AGE_BINS.length; b++) { const sg = tab[0][b]; if (tab[1][b].n && sg.n) s += (tab[1][b].n / nT) * (sg[key] / sg.n); else if (tab[1][b].n) return NaN; }
      return s;
    };
    for (const r of data[a]) {
      const o = outcomes(r);
      win = [win[0] + o.win[0], win[1] + o.win[1]];
      for (const t of [0, 1]) for (let b = 0; b < AGE_BINS.length; b++) { pooled[t][b].n += o.tab[t][b].n; pooled[t][b].div += o.tab[t][b].div; pooled[t][b].end += o.tab[t][b].end; }
      const nT = o.tab[1].reduce((x, y) => x + y.n, 0), divT = o.tab[1].reduce((x, y) => x + y.div, 0) / (nT || 1);
      per.push((divT - stdz(o.tab, 'div')) * (100000 / 5000));
    }
    const sum = (t: number, k: 'n' | 'div' | 'end') => pooled[t].reduce((x, y) => x + y[k], 0), per100k = 100000 / 5000;
    const rt = (t: number, k: 'div' | 'end') => (sum(t, k) / (sum(t, 'n') || 1)) * per100k;
    const nT = sum(1, 'n');
    console.log(`| ${a} | ${nT} / ${sum(0, 'n')} | ${f(rt(1, 'div'), 2)} | ${f(rt(0, 'div'), 2)} | ${f(rt(1, 'end'), 2)} | ${f(rt(0, 'end'), 2)} | ${f(stdz(pooled, 'div') * per100k, 2)} | ${f(stdz(pooled, 'end') * per100k, 2)} | ${per.map((x) => f(x, 2)).join(', ')} |`);
    tv[a] = pooled;
  }
  console.log('\nBy cell age at the census (pooled over seeds; counts n / div / end), tied | single:\n');
  console.log('| arm | age <5k | 5k-15k | 15k-30k | 30k+ |');
  console.log('|---|---|---|---|---|');
  for (const a of ['T', 'R', 'R0', 'T255']) {
    const pooled = tv[a] as Expo[][];
    console.log(`| ${a} | ${AGE_BINS.map((_, b) => { const t = pooled[1][b], s = pooled[0][b]; return `${t.n}/${t.div}/${t.end} \\| ${s.n}/${s.div}/${s.end}`; }).join(' | ').replace(/ \| (\d+\/)/g, ' | $1')} |`);
  }

  // (c)
  console.log('\n## (c) Life cycle of clusters\n');
  console.log('Piece sizes from ties.tsv split events (rings), per arm pooled over seeds. Every piece counted; "shed" = all but the largest piece of a split.\n');
  console.log('| arm | ties formed | split events (pinch / ring-end / stretch / desorb) | pieces of 1 | 2 | 3 | 4-7 | 8+ | shed pieces of 1 | 2 | 3+ | tie ends (ring-end / stretch / desorb) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const lcAll: Record<string, ReturnType<typeof lifeCycle>[]> = {};
  for (const a of ['mech', 'T', 'R', 'R0', 'T255']) {
    const hist = [0, 0, 0, 0, 0], shed = [0, 0, 0], sc: Record<string, number> = {}, en: Record<string, number> = {};
    let forms = 0;
    for (const r of data[a]) {
      const sp = splitPieces(r.ties); forms += sp.forms;
      for (const [k, v] of Object.entries(sp.ends)) en[k] = (en[k] ?? 0) + v;
      for (const [cause, evs] of Object.entries(sp.by)) {
        sc[cause] = (sc[cause] ?? 0) + evs.length;
        for (const sizes of evs) {
          for (const s of sizes) hist[s === 1 ? 0 : s === 2 ? 1 : s === 3 ? 2 : s < 8 ? 3 : 4]++;
          const big = Math.max(...sizes); let skipped = false;
          for (const s of sizes) { if (!skipped && s === big) { skipped = true; continue; } shed[s === 1 ? 0 : s === 2 ? 1 : 2]++; }
        }
      }
    }
    console.log(`| ${a} | ${forms} | ${sc.pinch ?? 0} / ${sc['ring-end'] ?? 0} / ${sc.stretch ?? 0} / ${sc['desorb-no-neighbour'] ?? 0} | ${hist.join(' | ')} | ${shed.join(' | ')} | ${en['ring-end'] ?? 0} / ${en.stretch ?? 0} / ${en['desorb-no-neighbour'] ?? 0} |`);
  }
  console.log('\nLineages of clusters from census tracking (sizes in live cells; lineage definitions in the file header):\n');
  console.log('| arm | seed | lineages | start E1 (single divided and tied) | start E2 (piece shed, size >= 2) | of those starting at size <= 2: reached >= 3 (E1 / E2) | share of reach-3 lineages that began as a single (E1) | lineages with >= 2 grow-then-split rounds | max rounds | with a mother lineage | max generation depth (reach-3 chain) | lifetime median / q75 / max (steps; censored) | merges / orphans |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const summ: Record<string, { e1: number; e2: number; r1: number; r2: number }> = {};
  for (const a of ['mech', 'T', 'R', 'R0', 'T255']) {
    lcAll[a] = [];
    for (const r of data[a]) {
      const lc = lifeCycle(r); lcAll[a].push(lc);
      const L = lc.lineages, e1 = L.filter((x) => x.kind === 'E1'), e2 = L.filter((x) => x.kind === 'E2'), small = L.filter((x) => x.startSize <= 2);
      const r1 = small.filter((x) => x.kind === 'E1' && x.maxSize >= 3).length, r2 = small.filter((x) => x.kind === 'E2' && x.maxSize >= 3).length;
      const two = L.filter((x) => x.rounds >= 2).length, withM = L.filter((x) => x.mother !== undefined).length;
      // reach-3 chain depth: depth counted only through mothers that themselves reached 3
      let maxd = 0;
      for (const x of L) { let dpt = 0, y: Lineage | undefined = x; while (y && y.maxSize >= 3 && y.mother !== undefined && L[y.mother].maxSize >= 3) { dpt++; y = L[y.mother]; } if (x.maxSize >= 3) maxd = Math.max(maxd, dpt); }
      const lt = lc.life.map((x) => x.steps), cens = lc.life.filter((x) => x.censored).length;
      const sh = { e1: r1, e2: r2, r1: 0, r2: 0 };
      summ[`${a}/${r.seeds}`] = sh;
      console.log(`| ${a} | ${r.seeds} | ${L.length} | ${e1.length} | ${e2.length} | ${r1 + r2} (${r1} / ${r2}) | ${r1 + r2 ? f((100 * r1) / (r1 + r2), 0) + '%' : '-'} | ${two} | ${Math.max(0, ...L.map((x) => x.rounds))} | ${withM} | ${maxd} | ${f(quant(lt, 0.5), 0)} / ${f(quant(lt, 0.75), 0)} / ${f(Math.max(0, ...lt), 0)} (${cens} cens) | ${lc.merges} / ${lc.orphans} |`);
    }
  }
  console.log('\nGeneration chains (pooled over seeds): lineages that reached >= 3 cells, by how many generations of reach-3 mother lineages stand behind them (cluster -> shed piece or divided single -> ...):\n');
  console.log('| arm | reach-3 lineages | generation 0 | 1 | 2 | 3+ | median mother gap (steps) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of ['mech', 'T', 'R', 'R0', 'T255']) {
    const g = [0, 0, 0, 0]; let n = 0; const gaps: number[] = [];
    for (const lc of lcAll[a]) {
      const L = lc.lineages; gaps.push(...lc.gaps);
      for (const x of L) {
        if (x.maxSize < 3) continue; n++;
        let dpt = 0, y: Lineage | undefined = x;
        while (y && y.mother !== undefined && L[y.mother].maxSize >= 3) { dpt++; y = L[y.mother]; }
        g[Math.min(3, dpt)]++;
      }
    }
    console.log(`| ${a} | ${n} | ${g.join(' | ')} | ${f(quant(gaps, 0.5), 0)} |`);
  }
  console.log('\nLifetimes of cluster lineages (start to the last census with >= 2 live cells on the main path; +1 census), pooled; censored = still a cluster at the end:\n');
  console.log('| arm | lineages | median | q25 | q75 | q90 | max | censored | reach-3 median |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const a of ['mech', 'T', 'R', 'R0', 'T255']) {
    const lt = lcAll[a].flatMap((l) => l.life), s = lt.map((x) => x.steps), s3 = lt.filter((x) => x.reach3).map((x) => x.steps);
    console.log(`| ${a} | ${lt.length} | ${f(quant(s, 0.5), 0)} | ${f(quant(s, 0.25), 0)} | ${f(quant(s, 0.75), 0)} | ${f(quant(s, 0.9), 0)} | ${f(Math.max(0, ...s), 0)} | ${lt.filter((x) => x.censored).length} | ${f(quant(s3, 0.5), 0)} |`);
  }
  if (jout) writeFileSync(jout, JSON.stringify(out, null, 1));
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
