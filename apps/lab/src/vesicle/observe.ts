// Observers for the vesicle world. Nothing here feeds back into the rules: a "vesicle" is a ring of bonds
// found by walking `next`, and its contents are the particles that fall inside its polygon.
import type { VesicleWorld } from './model.ts';

/** Wall colour for a bead's job bytes (as scaled to the shared budget): hue from the balance d / (h + d), green for a pure harvester
 *  through yellow and orange to magenta for a pure digester; lightness from the budget in use, (h + d) / 255. Pure function. */
export function jobHueLight(wh: number, wd: number): { hue: number; light: number } {
  const sum = wh + wd, h = sum <= 255 ? wh : Math.floor((wh * 255) / sum), d = sum <= 255 ? wd : 255 - h, t = h + d;
  const bal = t > 0 ? d / t : 0;
  return { hue: ((120 - 180 * bal) % 360 + 360) % 360, light: t / 255 };
}

export interface Loop {
  /** Lowest bead index in the ring: stable while that bead lives, not an identity. */
  first: number;
  beads: number; perimeter: number; area: number; cx: number; cy: number;
  /** Mean bond length over rest length, minus one. */
  stretch: number;
  /** 4*pi*area / perimeter^2: 1 for a circle, lower when there is wall to spare. */
  roundness: number;
  solute: number; geneMean: number; markMean: number;
  /** Threads inside the ring and the mean of thread genes 0 and 1 over them (0 when there are none or threads are off). */
  threads: number; thread0: number; thread1: number;
  /** Mean and spread of the wall's own bytes over the ring's beads (meaningful when `wallGenes` is on). */
  wallGene: number; wallGeneSd: number; wallMark: number;
  /** Solute count by founder id. */
  founders: Map<number, number>;
  xs: Float64Array; ys: Float64Array;
}

export interface Census { loops: Loop[]; freeThreads: number; threads: number; freeSolute: number; beads: number; particles: number; freeLipid: number; food: number; waste: number }

export function loops(w: VesicleWorld, withSolute = true): Loop[] {
  const seen = new Uint8Array(w.beadHi), out: Loop[] = [];
  for (let s = 0; s < w.beadHi; s++) {
    if (!w.alive[s] || seen[s]) continue;
    const idx: number[] = [];
    for (let i = s; !seen[i]; i = w.next[i]) { seen[i] = 1; idx.push(i); }
    const n = idx.length, xs = new Float64Array(n), ys = new Float64Array(n);
    let per = 0, a2 = 0, cx = 0, cy = 0;
    let wg = 0, wg2 = 0, wm = 0;
    for (let k = 0; k < n; k++) { xs[k] = w.bx[idx[k]]; ys[k] = w.by[idx[k]]; const g = w.wgene[idx[k]]; wg += g; wg2 += g * g; wm += w.wmark[idx[k]]; }
    for (let k = 0; k < n; k++) {
      const m = (k + 1) % n, dx = xs[m] - xs[k], dy = ys[m] - ys[k], cr = xs[k] * ys[m] - xs[m] * ys[k];
      per += Math.sqrt(dx * dx + dy * dy); a2 += cr; cx += (xs[k] + xs[m]) * cr; cy += (ys[k] + ys[m]) * cr;
    }
    const area = a2 / 2;
    out.push({
      first: s, beads: n, perimeter: per, area, cx: a2 !== 0 ? cx / (3 * a2) : xs[0], cy: a2 !== 0 ? cy / (3 * a2) : ys[0],
      stretch: per / (n * w.p.l0) - 1, roundness: per > 0 ? (12.566370614359172 * area) / (per * per) : 0,
      solute: 0, geneMean: 0, markMean: 0, threads: 0, thread0: 0, thread1: 0, founders: new Map(), xs, ys,
      wallGene: wg / n, wallGeneSd: Math.sqrt(Math.max(0, wg2 / n - (wg / n) * (wg / n))), wallMark: wm / n,
    });
  }
  if (withSolute) assign(w, out);
  return out;
}

/** How many rings there are (no allocation: `seen` is scratch of at least `beadHi` entries). */
export function ringCount(w: VesicleWorld, seen: Uint8Array): number {
  seen.fill(0, 0, w.beadHi);
  let n = 0;
  for (let s = 0; s < w.beadHi; s++) {
    if (!w.alive[s] || seen[s]) continue;
    n++;
    for (let i = s; !seen[i]; i = w.next[i]) seen[i] = 1;
  }
  return n;
}

function inside(l: Loop, x: number, y: number): boolean {
  let c = false;
  const { xs, ys } = l, n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
  }
  return c;
}

/** Which loop each particle is in (-1 = outside all), and per-loop totals. */
export function assign(w: VesicleWorld, ls: Loop[]): Int32Array {
  const box = ls.map((l) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < l.xs.length; k++) { if (l.xs[k] < x0) x0 = l.xs[k]; if (l.xs[k] > x1) x1 = l.xs[k]; if (l.ys[k] < y0) y0 = l.ys[k]; if (l.ys[k] > y1) y1 = l.ys[k]; }
    return [x0, x1, y0, y1];
  });
  const where = new Int32Array(w.n).fill(-1), gs = new Float64Array(ls.length), ms = new Float64Array(ls.length);
  for (const l of ls) { l.solute = 0; l.geneMean = 0; l.markMean = 0; l.founders.clear(); }
  for (let k = 0; k < w.n; k++) {
    const x = w.px[k], y = w.py[k];
    for (let i = 0; i < ls.length; i++) {
      const b = box[i];
      if (x < b[0] || x > b[1] || y < b[2] || y > b[3] || !inside(ls[i], x, y)) continue;
      where[k] = i; ls[i].solute++; gs[i] += w.gene[k]; ms[i] += w.mark[k];
      ls[i].founders.set(w.founder[k], (ls[i].founders.get(w.founder[k]) ?? 0) + 1);
      break;
    }
  }
  if (w.p.thread) assignThreads(w, ls, box);
  for (let i = 0; i < ls.length; i++) if (ls[i].solute) { ls[i].geneMean = gs[i] / ls[i].solute; ls[i].markMean = ms[i] / ls[i].solute; }
  return where;
}

/** Which loop each thread is in (-1 = outside all); fills the per-loop thread counts and gene means. */
function assignThreads(w: VesicleWorld, ls: Loop[], box: number[][]): Int32Array {
  const where = new Int32Array(w.nt).fill(-1), G = w.p.tG, t0 = new Float64Array(ls.length), t1 = new Float64Array(ls.length);
  for (const l of ls) { l.threads = 0; l.thread0 = 0; l.thread1 = 0; }
  for (let k = 0; k < w.nt; k++) {
    const x = w.tx[k], y = w.ty[k];
    for (let i = 0; i < ls.length; i++) {
      const b = box[i];
      if (x < b[0] || x > b[1] || y < b[2] || y > b[3] || !inside(ls[i], x, y)) continue;
      where[k] = i; ls[i].threads++; t0[i] += w.tgene[k * G]; t1[i] += w.tgene[k * G + 1];
      break;
    }
  }
  for (let i = 0; i < ls.length; i++) if (ls[i].threads) { ls[i].thread0 = t0[i] / ls[i].threads; ls[i].thread1 = t1[i] / ls[i].threads; }
  return where;
}

export function census(w: VesicleWorld): Census {
  const ls = loops(w);
  let inLoops = 0, lipid = 0, food = 0, waste = 0;
  for (const l of ls) inLoops += l.solute;
  for (let c = 0; c < w.lipid.length; c++) { lipid += w.lipid[c]; food += w.food[c]; waste += w.waste[c]; }
  let tIn = 0;
  for (const l of ls) tIn += l.threads;
  return { loops: ls, threads: w.nt, freeThreads: w.nt - tIn, freeSolute: w.n - inLoops, beads: w.beadCount, particles: w.n, freeLipid: lipid, food, waste };
}

/** Structural checks used while tuning and in tests. Returns the list of problems (empty = sound). */
export function check(w: VesicleWorld, crossings = true): string[] {
  const bad: string[] = [];
  let live = 0;
  for (let i = 0; i < w.beadHi; i++) {
    if (!w.alive[i]) continue;
    live++;
    const j = w.next[i], q = w.prev[i];
    if (j < 0 || q < 0 || !w.alive[j] || !w.alive[q]) { bad.push(`bead ${i}: dangling link`); continue; }
    if (w.prev[j] !== i || w.next[q] !== i) bad.push(`bead ${i}: next/prev disagree`);
    if (!(w.bx[i] === w.bx[i]) || !(w.by[i] === w.by[i])) bad.push(`bead ${i}: NaN position`);
  }
  if (live !== w.beadCount) bad.push(`bead count ${w.beadCount} but ${live} alive`);
  if (w.p.ties) {
    // ties: never on a dead slot, always symmetric, never to oneself
    for (let i = 0; i < w.beadHi; i++) {
      const v = w.tie[i];
      if (v < 0) continue;
      if (!w.alive[i]) bad.push(`dead bead ${i} still has a tie`);
      else if (v === i || v >= w.beadHi || !w.alive[v]) bad.push(`bead ${i}: tie to ${v} (self or dead)`);
      else if (w.tie[v] !== i) bad.push(`bead ${i}: tie to ${v} is not returned`);
    }
  } else for (let i = 0; i < w.beadHi; i++) if (w.tie[i] >= 0) { bad.push(`bead ${i}: tie with ties off`); break; }
  if (bad.length) return bad;
  if (w.p.ties) {
    // a tie joins two different rings, never two beads of one
    for (let i = 0; i < w.beadHi; i++) {
      const v = w.tie[i];
      if (v <= i) continue;
      let k = 0;
      for (let m = w.next[i]; m !== i && k <= w.beadHi; m = w.next[m], k++) if (m === v) { bad.push(`bead ${i}: tie to ${v} within one ring`); break; }
    }
    if (bad.length) return bad;
  }
  const ls = loops(w, false);
  let total = 0;
  for (const l of ls) {
    total += l.beads;
    if (l.beads < 3) bad.push(`loop at ${l.first}: ${l.beads} beads`);
    if (!(l.area > 0)) bad.push(`loop at ${l.first}: area ${l.area} (not counter-clockwise)`);
  }
  if (total !== live) bad.push(`loops hold ${total} of ${live} beads (an open chain)`);
  for (let k = 0; k < w.n; k++) if (!(w.px[k] === w.px[k])) { bad.push(`particle ${k}: NaN`); break; }
  for (const f of [w.food, w.waste, w.lipid]) for (let c = 0; c < f.length; c++) if (f[c] < 0) { bad.push('negative field count'); break; }
  if (crossings) { const x = countCrossings(w); if (x) bad.push(`${x} bond crossings`); }
  return bad;
}

/** Pairs of non-adjacent bonds that properly intersect. */
export function countCrossings(w: VesicleWorld): number {
  const cell = 8, gw = Math.ceil(w.p.W / cell), gh = Math.ceil(w.p.H / cell);
  const bins: number[][] = Array.from({ length: gw * gh }, () => []);
  const clampI = (v: number, hi: number) => (v < 0 ? 0 : v >= hi ? hi - 1 : v);
  for (let i = 0; i < w.beadHi; i++) {
    if (!w.alive[i]) continue;
    const j = w.next[i];
    const x0 = clampI(Math.floor(Math.min(w.bx[i], w.bx[j]) / cell), gw), x1 = clampI(Math.floor(Math.max(w.bx[i], w.bx[j]) / cell), gw);
    const y0 = clampI(Math.floor(Math.min(w.by[i], w.by[j]) / cell), gh), y1 = clampI(Math.floor(Math.max(w.by[i], w.by[j]) / cell), gh);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bins[y * gw + x].push(i);
  }
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const seen = new Set<number>();
  for (const bin of bins) {
    for (let u = 0; u < bin.length; u++) for (let v = u + 1; v < bin.length; v++) {
      const a = bin[u], c = bin[v], b = w.next[a], d = w.next[c];
      if (a === c || a === d || b === c || b === d) continue;
      const o1 = orient(w.bx[a], w.by[a], w.bx[b], w.by[b], w.bx[c], w.by[c]), o2 = orient(w.bx[a], w.by[a], w.bx[b], w.by[b], w.bx[d], w.by[d]);
      const o3 = orient(w.bx[c], w.by[c], w.bx[d], w.by[d], w.bx[a], w.by[a]), o4 = orient(w.bx[c], w.by[c], w.bx[d], w.by[d], w.bx[b], w.by[b]);
      if (o1 * o2 < 0 && o3 * o4 < 0) seen.add(Math.min(a, c) * 65536 + Math.max(a, c));
    }
  }
  return seen.size;
}

// ---- cell lineage observer ---------------------------------------------------------------------------------
// A pure observer: it keeps a cell id per wall bead on its own side and reads the world, never writes it and
// never draws a random number, so the world's state digest is the same with or without it. A bead born between
// two beads of a ring takes that ring's id; a pinch ends the mother's id and gives both daughters fresh ones.

export interface RingStat {
  beads: number; solute: number;
  /** Mean and sd of the solute lipid-share byte over the solute inside the ring (0 if none). */
  gMean: number; gSd: number;
  /** Mean and sd of the wall beads' lipid-share byte. */
  wMean: number; wSd: number;
  area: number; cx: number; cy: number;
  /** Threads inside the ring and the mean of thread genes 0 and 1 over them (zeros with threads off). */
  threads: number; t0: number; t1: number;
  /** Mean and sd over the ring's beads of the harvest and digest bytes after scaling to the shared budget (zeros unless `jobs` is on). */
  hMean: number; hSd: number; dMean: number; dSd: number;
  /** Mean glue byte over the ring's beads and the number of beads that hold a tie (zeros unless `ties` is on). */
  glue: number; ties: number;
}

/** Whole-ring record for the ring that holds bead `start`: wall bytes over its beads, solute bytes over the particles inside. */
export function ringStat(w: VesicleWorld, start: number): RingStat {
  const xs: number[] = [], ys: number[] = [];
  let wg = 0, wg2 = 0, jh = 0, jh2 = 0, jd = 0, jd2 = 0, gl = 0, tn = 0;
  const jobs = w.p.jobs, tied = w.p.ties;
  for (let i = start; ;) {
    xs.push(w.bx[i]); ys.push(w.by[i]); const g = w.wgene[i]; wg += g; wg2 += g * g;
    if (jobs) { const sum = w.wh[i] + w.wd[i], h = sum <= 255 ? w.wh[i] : Math.floor((w.wh[i] * 255) / sum), d = sum <= 255 ? w.wd[i] : 255 - h; jh += h; jh2 += h * h; jd += d; jd2 += d * d; }
    if (tied) { gl += w.wglue[i]; if (w.tie[i] >= 0) tn++; }
    i = w.next[i]; if (i === start) break;
  }
  const n = xs.length;
  let a2 = 0, cx = 0, cy = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const m = k + 1 === n ? 0 : k + 1, cr = xs[k] * ys[m] - xs[m] * ys[k];
    a2 += cr; cx += (xs[k] + xs[m]) * cr; cy += (ys[k] + ys[m]) * cr;
    if (xs[k] < x0) x0 = xs[k]; if (xs[k] > x1) x1 = xs[k]; if (ys[k] < y0) y0 = ys[k]; if (ys[k] > y1) y1 = ys[k];
  }
  let s = 0, g1 = 0, g2 = 0;
  const hit = (x: number, y: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
    return c;
  };
  for (let k = 0; k < w.n; k++) if (hit(w.px[k], w.py[k])) { s++; const g = w.gene[k]; g1 += g; g2 += g * g; }
  let nt = 0, tg0 = 0, tg1 = 0;
  if (w.p.thread) for (let k = 0; k < w.nt; k++) if (hit(w.tx[k], w.ty[k])) { nt++; tg0 += w.tgene[k * w.p.tG]; tg1 += w.tgene[k * w.p.tG + 1]; }
  const sd = (sum: number, sq: number, m: number) => (m ? Math.sqrt(Math.max(0, sq / m - (sum / m) * (sum / m))) : 0);
  return {
    beads: n, solute: s, gMean: s ? g1 / s : 0, gSd: sd(g1, g2, s), wMean: wg / n, wSd: sd(wg, wg2, n),
    area: a2 / 2, cx: a2 !== 0 ? cx / (3 * a2) : xs[0], cy: a2 !== 0 ? cy / (3 * a2) : ys[0],
    threads: nt, t0: nt ? tg0 / nt : 0, t1: nt ? tg1 / nt : 0,
    hMean: jh / n, hSd: sd(jh, jh2, n), dMean: jd / n, dSd: sd(jd, jd2, n),
    glue: gl / n, ties: tn,
  };
}

/** Conversions credited to a ring's id since the last cell record, written on the row that ends the id (so a pinch or an end loses none). */
export interface JobTally { harvests: number; digests: number }
export type LineageEvent =
  | { ev: 'pinch'; step: number; id: number; d1: number; d2: number; m: RingStat; a: RingStat; b: RingStat; jobs?: JobTally }
  | { ev: 'end'; step: number; id: number; kind: 'burst' | 'dissolve' | 'wound'; m: RingStat; jobs?: JobTally };

export const STAT_COLS = ['beads', 'solute', 'gMean', 'gSd', 'wMean', 'wSd', 'area'] as const;
/** Extra columns written when threads are on: how many threads the ring holds and the mean of thread genes 0 and 1. */
export const THREAD_COLS = ['threads', 't0', 't1'] as const;
export const EVENT_HEADER = ['ev', 'step', 'id', 'd1', 'd2', 'kind', ...['m', 'a', 'b'].flatMap((r) => STAT_COLS.map((c) => `${r}_${c}`))].join('\t');
export const CELL_HEADER = ['step', 'id', ...STAT_COLS, 'cx', 'cy'].join('\t');
/** Extra columns written when jobs are on: pinch rows get the mean harvest and digest byte (scaled) of each ring; cell rows get the mean
 *  and sd of both over the ring's beads and the conversions credited to the ring's id since the last cell record. */
export const JOB_EVENT_COLS = ['hMean', 'dMean'] as const;
/** The last two jobs columns of a pinch or end row: what the mother's id had done since the last cell record. */
export const JOB_TALLY_COLS = ['m_harvests', 'm_digests'] as const;
export const JOB_CELL_COLS = ['hMean', 'hSd', 'dMean', 'dSd', 'harvests', 'digests'] as const;
export const eventHeader = (thread: boolean, jobs = false) =>
  [EVENT_HEADER, ...(thread ? ['m', 'a', 'b'].flatMap((r) => THREAD_COLS.map((c) => `${r}_${c}`)) : []), ...(jobs ? [...['m', 'a', 'b'].flatMap((r) => JOB_EVENT_COLS.map((c) => `${r}_${c}`)), ...JOB_TALLY_COLS] : [])].join('\t');
/** Extra columns of cells.tsv when ties are on: the ring's mean glue byte, how many of its beads hold a tie, the number of rings in its cluster
 *  (itself alone = 1) and the cluster's handle (the smallest cell id in it). */
export const TIE_CELL_COLS = ['glue', 'ties', 'cluster', 'handle'] as const;
export const cellHeader = (thread: boolean, jobs = false, ties = false) => [CELL_HEADER, ...(thread ? THREAD_COLS : []), ...(jobs ? JOB_CELL_COLS : []), ...(ties ? TIE_CELL_COLS : [])].join('\t');

const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
const statCells = (s?: RingStat) => (s ? STAT_COLS.map((c) => f(s[c])) : STAT_COLS.map(() => ''));
const threadCells = (s?: RingStat) => (s ? THREAD_COLS.map((c) => f(c === 'threads' ? s.threads : c === 't0' ? s.t0 : s.t1)) : THREAD_COLS.map(() => ''));
const jobEventCells = (s?: RingStat) => (s ? [f(s.hMean), f(s.dMean)] : ['', '']);
export const eventLine = (e: LineageEvent, thread = false, jobs = false) =>
  (e.ev === 'pinch'
    ? ['pinch', e.step, e.id, e.d1, e.d2, '', ...statCells(e.m), ...statCells(e.a), ...statCells(e.b), ...(thread ? [...threadCells(e.m), ...threadCells(e.a), ...threadCells(e.b)] : []), ...(jobs ? [...jobEventCells(e.m), ...jobEventCells(e.a), ...jobEventCells(e.b), e.jobs?.harvests ?? 0, e.jobs?.digests ?? 0] : [])]
    : ['end', e.step, e.id, '', '', e.kind, ...statCells(e.m), ...statCells(undefined), ...statCells(undefined), ...(thread ? [...threadCells(e.m), ...threadCells(undefined), ...threadCells(undefined)] : []), ...(jobs ? [...jobEventCells(e.m), ...jobEventCells(undefined), ...jobEventCells(undefined), e.jobs?.harvests ?? 0, e.jobs?.digests ?? 0] : [])]).join('\t');
/** `jobs` (conversions credited to this id since the last record) given = write the jobs columns. */
export const cellLine = (step: number, id: number, s: RingStat, thread = false, jobs?: { harvests: number; digests: number }, cluster?: { size: number; handle: number }) =>
  [step, id, ...statCells(s), f(s.cx), f(s.cy), ...(thread ? threadCells(s) : []), ...(jobs ? [f(s.hMean), f(s.hSd), f(s.dMean), f(s.dSd), jobs.harvests, jobs.digests] : []), ...(cluster ? [f(s.glue), s.ties, cluster.size, cluster.handle] : [])].join('\t');

export class LineageObserver {
  /** Cell id per bead slot (0 = none yet). Ids are 1, 2, 3, ... never reused. */
  readonly cid: Int32Array;
  nextId = 1;
  private pending: { m: RingStat; id: number } | null = null;
  /** Conversions by job credited to each ring id since the last `forEachCell` sweep (units, not events). A pinch ends the mother's id, so
   *  what it had counted is dropped with it, as is a ring that ends before a sweep. */
  private harvests = new Map<number, number>(); private digests = new Map<number, number>();

  readonly w: VesicleWorld;
  readonly onEvent: (e: LineageEvent) => void;

  constructor(w: VesicleWorld, onEvent: (e: LineageEvent) => void) {
    this.w = w; this.onEvent = onEvent;
    this.cid = new Int32Array(w.p.maxBeads);
    const seen = new Uint8Array(w.beadHi);
    for (let s = 0; s < w.beadHi; s++) {
      if (!w.alive[s] || seen[s]) continue;
      const id = this.nextId++;
      for (let i = s; !seen[i]; i = w.next[i]) { seen[i] = 1; this.cid[i] = id; }
    }
    w.hooks.pinch = (stage, c, a, pc, b) => this.onPinch(stage, c, a, pc, b);
    w.hooks.end = (kind, bead) => this.onEnd(kind, bead);
    if (w.p.jobs) {
      w.hooks.harvest = (bead, n) => { const id = this.idOf(bead); this.harvests.set(id, (this.harvests.get(id) ?? 0) + n); };
      w.hooks.digest = (bead, n) => { const id = this.idOf(bead); this.digests.set(id, (this.digests.get(id) ?? 0) + n); };
    }
  }

  detach(): void { this.w.hooks.pinch = undefined; this.w.hooks.end = undefined; this.w.hooks.harvest = undefined; this.w.hooks.digest = undefined; }

  /** What id `id` has done since the last sweep, removed from the tallies (it is written on the row that ends the id). */
  private takeTally(id: number): JobTally | undefined {
    if (!this.w.p.jobs) return undefined;
    const t = { harvests: this.harvests.get(id) ?? 0, digests: this.digests.get(id) ?? 0 };
    this.harvests.delete(id); this.digests.delete(id);
    return t;
  }

  /** The id of the ring that holds bead `bead`; a bead born this step has none yet, so take it from the nearest labelled bead behind it. */
  idOf(bead: number): number {
    const { w, cid } = this;
    for (let i = bead; ;) { if (cid[i] !== 0) return cid[i]; i = w.prev[i]; if (i === bead) return 0; }
  }

  private paint(start: number, id: number): void {
    for (let i = start; ;) { this.cid[i] = id; i = this.w.next[i]; if (i === start) break; }
  }

  private onPinch(stage: 0 | 1, c: number, a: number, pc: number, b: number): void {
    const w = this.w;
    if (stage === 0) { this.pending = { id: this.cid[c], m: ringStat(w, c) }; return; }
    const { id, m } = this.pending!; this.pending = null;
    const d1 = this.nextId++, d2 = this.nextId++;
    this.paint(c, d1); this.paint(b, d2);
    this.onEvent({ ev: 'pinch', step: w.step, id, d1, d2, m, a: ringStat(w, c), b: ringStat(w, b), jobs: this.takeTally(id) });
    void a; void pc;
  }

  private onEnd(kind: 'burst' | 'dissolve' | 'wound', bead: number): void {
    // the anchor may be a bead born this step with no id yet: take the ring's id from any labelled bead, then clear
    // every bead's id now, because freed slots can be reused before the next sweep and would keep a dead id
    const { w, cid } = this;
    let id = 0;
    for (let i = bead; ;) { if (cid[i] !== 0) { id = cid[i]; break; } i = w.next[i]; if (i === bead) break; }
    if (id === 0) id = this.nextId++;
    this.onEvent({ ev: 'end', step: w.step, id, kind, m: ringStat(w, bead), jobs: this.takeTally(id) });
    for (let i = bead; ;) { cid[i] = 0; i = w.next[i]; if (i === bead) break; }
  }

  /** Call once per step, after `tick()`: gives beads born this step their ring's id and clears freed slots. */
  afterTick(): void {
    const { w, cid } = this;
    for (let i = 0; i < w.beadHi; i++) {
      if (!w.alive[i]) { cid[i] = 0; continue; }
      if (cid[i] !== 0) continue;
      let m = w.prev[i];
      while (cid[m] === 0 && m !== i) m = w.prev[m];
      cid[i] = cid[m] !== 0 ? cid[m] : this.nextId++;
    }
  }

  /** One record per living ring, by id (the periodic baseline for contemporaries). */
  forEachCell(fn: (id: number, s: RingStat, jobs: { harvests: number; digests: number }) => void): void {
    const { w } = this, seen = new Uint8Array(w.beadHi);
    for (let s = 0; s < w.beadHi; s++) {
      if (!w.alive[s] || seen[s]) continue;
      for (let i = s; !seen[i]; i = w.next[i]) seen[i] = 1;
      const id = this.cid[s];
      fn(id, ringStat(w, s), { harvests: this.harvests.get(id) ?? 0, digests: this.digests.get(id) ?? 0 });
    }
    this.harvests.clear(); this.digests.clear();
  }
}

// ---- ties (stage 4) ------------------------------------------------------------------------------------------
// Clusters are never stored in the physics: they are found by walking ties between rings (two rings are in one cluster if a chain of ties
// joins them). Everything here reads the world and draws nothing.

export interface TieGraph {
  /** Ring index of each bead slot (-1 for a dead slot), the first bead of each ring, its cluster (0..clusters-1), and per cluster the number of
   *  rings and the handle (lowest first-bead index among them, or the smallest cell id when `idOf` is given). */
  ringOf: Int32Array; first: Int32Array; comp: Int32Array; compRings: Int32Array; compHandle: Int32Array; rings: number; clusters: number;
}

/** Union of rings joined by ties (union-find over the rings, one pass over the beads that hold a tie). */
export function tieGraph(w: VesicleWorld, idOf?: (bead: number) => number): TieGraph {
  const ringOf = new Int32Array(w.beadHi).fill(-1), first: number[] = [];
  for (let s = 0; s < w.beadHi; s++) {
    if (!w.alive[s] || ringOf[s] >= 0) continue;
    const r = first.length; first.push(s);
    for (let i = s; ringOf[i] < 0; i = w.next[i]) ringOf[i] = r;
  }
  const n = first.length, parent = new Int32Array(n);
  for (let r = 0; r < n; r++) parent[r] = r;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let u = 0; u < w.beadHi; u++) {
    const v = w.tie[u];
    if (v <= u || !w.alive[u]) continue;
    const a = find(ringOf[u]), b = find(ringOf[v]);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); // the root is the ring with the lowest first bead (rings are numbered by first bead)
  }
  const comp = new Int32Array(n), id = new Int32Array(n).fill(-1);
  let k = 0;
  for (let r = 0; r < n; r++) { const root = find(r); if (id[root] < 0) id[root] = k++; comp[r] = id[root]; }
  const compRings = new Int32Array(k), compHandle = new Int32Array(k).fill(-1);
  // handle: the lowest first-bead index in the cluster, or with `idOf` (a cell id per bead, e.g. the lineage observer's) the smallest cell id
  for (let r = 0; r < n; r++) { const c = comp[r], h = idOf ? idOf(first[r]) : first[r]; compRings[c]++; if (compHandle[c] < 0 || h < compHandle[c]) compHandle[c] = h; }
  return { ringOf, first: Int32Array.from(first), comp, compRings, compHandle, rings: n, clusters: k };
}

export interface TieStats {
  /** Ties in the dish (pairs of beads). */
  ties: number;
  /** Clusters of live cells (solute 5 or more) by the number of live cells in them: 1, 2, 3, 4 to 7, 8 or more; clusters with no live cell are left out. */
  c1: number; c2: number; c3: number; c4to7: number; c8p: number;
  /** Largest cluster, in live cells. */
  max: number;
  /** Mean glue byte over all wall beads. */
  glue: number;
  /** Share of live cells that are in a cluster with at least one other live cell. */
  share: number;
}

/** Census numbers on ties, from the census's rings (`ls` as `loops(w)` returns them; a ring is a live cell with 5 or more solute). */
export function tieStats(w: VesicleWorld, ls: Loop[]): TieStats {
  const g = tieGraph(w), live = new Int32Array(g.clusters);
  let nLive = 0, ties = 0, glue = 0, beads = 0;
  for (const l of ls) if (l.solute >= 5) { live[g.comp[g.ringOf[l.first]]]++; nLive++; }
  for (let i = 0; i < w.beadHi; i++) if (w.alive[i]) { beads++; glue += w.wglue[i]; if (w.tie[i] > i) ties++; }
  const o: TieStats = { ties, c1: 0, c2: 0, c3: 0, c4to7: 0, c8p: 0, max: 0, glue: beads ? glue / beads : 0, share: 0 };
  let inCluster = 0;
  for (let c = 0; c < g.clusters; c++) {
    const m = live[c];
    if (m === 0) continue;
    if (m === 1) o.c1++; else if (m === 2) o.c2++; else if (m === 3) o.c3++; else if (m < 8) o.c4to7++; else o.c8p++;
    if (m > o.max) o.max = m;
    if (m >= 2) inCluster += m;
  }
  o.share = nLive ? inCluster / nLive : 0;
  return o;
}

/** A hue (degrees) for cluster handle `h`, spread by the golden angle. */
export const clusterHue = (h: number) => (h * 137.50776405003785 + 20) % 360;

export type TieEvent =
  | { ev: 'form'; step: number; a: number; b: number; glue: number }
  | { ev: 'end'; step: number; a: number; b: number; reason: 'stretch' | 'desorb-no-neighbour' | 'ring-end' }
  | { ev: 'split'; step: number; cause: 'stretch' | 'desorb-no-neighbour' | 'ring-end' | 'pinch'; sizes: number[]; handles: number[] };

export const TIE_HEADER = ['ev', 'step', 'a', 'b', 'glue', 'reason', 'sizes', 'handles'].join('\t');
/** One row of ties.tsv. form: the two cell ids and the glue byte of the bead that closed the neck. end: the two cell ids and why. split: the cause,
 *  then the sizes of the pieces in cells (rings), comma-separated, and for each piece its smallest cell id. */
export const tieLine = (e: TieEvent) =>
  (e.ev === 'form' ? ['form', e.step, e.a, e.b, e.glue, '', '', '']
    : e.ev === 'end' ? ['end', e.step, e.a, e.b, '', e.reason, '', '']
      : ['split', e.step, '', '', '', e.cause, e.sizes.join(','), e.handles.join(',')]).join('\t');

/** Writes the tie events of a run and answers cluster questions by cell id. A pure observer: it needs the lineage observer's cell ids, keeps its
 *  own set of tied beads, never draws a random number and never writes the world. Create it after the `LineageObserver`; `detach` it first. */
export class TieObserver {
  /** The beads that hold a tie, as this observer has followed them (tests compare it with a scan of the world). */
  readonly tied = new Set<number>();
  private prevEnd: VesicleWorld['hooks']['end'];
  readonly w: VesicleWorld;
  private lin: LineageObserver; private onEvent: (e: TieEvent) => void;

  constructor(w: VesicleWorld, lin: LineageObserver, onEvent: (e: TieEvent) => void) {
    this.w = w; this.lin = lin; this.onEvent = onEvent;
    for (let i = 0; i < w.beadHi; i++) if (w.alive[i] && w.tie[i] >= 0) this.tied.add(i);
    w.hooks.tie = (kind, u, v, x) => this.onTie(kind, u, v, x);
    this.prevEnd = w.hooks.end;
    w.hooks.end = (kind, bead) => { this.onRingEnd(bead); this.prevEnd?.(kind, bead); };
  }

  detach(): void { this.w.hooks.tie = undefined; this.w.hooks.end = this.prevEnd; }

  /** The cell-id graph of the ties now, leaving out the ties for which `skip(u, v)` is true (u is the lower bead). */
  private adjacency(skip: (u: number, v: number) => boolean): Map<number, number[]> {
    const adj = new Map<number, number[]>(), add = (a: number, b: number) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
    for (const u of this.tied) {
      const v = this.w.tie[u];
      if (v < u || skip(u, v)) continue;
      const a = this.lin.idOf(u), b = this.lin.idOf(v);
      if (a === b) continue;
      add(a, b); add(b, a);
    }
    return adj;
  }

  private static component(adj: Map<number, number[]>, start: number): number[] {
    const seen = new Set<number>([start]), stack = [start];
    while (stack.length) for (const y of adj.get(stack.pop()!) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    return [...seen];
  }

  /** Cluster of cell `id` right now: its size in cells (rings) and its handle (the smallest cell id in it). */
  cluster(id: number, adj = this.adjacency(() => false)): { size: number; handle: number } {
    const comp = TieObserver.component(adj, id);
    return { size: comp.length, handle: Math.min(...comp) };
  }

  /** One adjacency for a whole sweep of cells.tsv rows. */
  sweep(): (id: number) => { size: number; handle: number } {
    const adj = this.adjacency(() => false), memo = new Map<number, { size: number; handle: number }>();
    return (id) => {
      let r = memo.get(id);
      if (!r) {
        const comp = TieObserver.component(adj, id), size = comp.length, handle = Math.min(...comp);
        for (const c of comp) memo.set(c, { size, handle });
        r = memo.get(id)!;
      }
      return r;
    };
  }

  private onTie(kind: 'form' | 'end' | 'hop' | 'none', u: number, v: number, x: number): void {
    const { w } = this, step = w.step;
    if (kind === 'none') {
      // a pinch that made no tie: if the mother held ties, her cluster may now be in two pieces (each daughter kept the ties of the beads she kept)
      const d1 = this.lin.idOf(u), d2 = this.lin.idOf(v), adj = this.adjacency(() => false), c1 = TieObserver.component(adj, d1);
      if (!c1.includes(d2)) { const c2 = TieObserver.component(adj, d2); if (c1.length > 1 || c2.length > 1) this.pieces(step, 'pinch', [c1, c2]); }
      return;
    }
    if (kind === 'form') { this.tied.add(u); this.tied.add(v); this.onEvent({ ev: 'form', step, a: this.lin.idOf(u), b: this.lin.idOf(v), glue: x }); return; }
    if (kind === 'hop') { this.tied.delete(u); this.tied.add(v); return; }
    // the tie between u and v ends (rings as they are now): did a cluster fall in two?
    const reason = x === 1 ? 'stretch' : 'desorb-no-neighbour', a = this.lin.idOf(u), b = this.lin.idOf(v), lo = Math.min(u, v);
    this.onEvent({ ev: 'end', step, a, b, reason });
    const adj = this.adjacency((p) => p === lo), ca = TieObserver.component(adj, a);
    if (a !== b && !ca.includes(b)) this.pieces(step, reason, [ca, TieObserver.component(adj, b)]);
    this.tied.delete(u); this.tied.delete(v);
  }

  private pieces(step: number, cause: 'stretch' | 'desorb-no-neighbour' | 'ring-end' | 'pinch', comps: number[][]): void {
    const ps = comps.map((c) => ({ size: c.length, handle: Math.min(...c) })).sort((p, q) => p.handle - q.handle);
    this.onEvent({ ev: 'split', step, cause, sizes: ps.map((p) => p.size), handles: ps.map((p) => p.handle) });
  }

  /** Called with the ring about to return to free lipid (before the lineage observer forgets its ids): its ties end with it. */
  private onRingEnd(bead: number): void {
    const { w } = this, step = w.step, x = this.lin.idOf(bead), mine: number[] = [];
    for (let i = bead; ;) { if (w.tie[i] >= 0) mine.push(i); i = w.next[i]; if (i === bead) break; }
    if (mine.length === 0) return;
    const partners = new Set<number>(), gone = new Set<number>();
    for (const u of mine) {
      const v = w.tie[u];
      gone.add(u); gone.add(v); partners.add(this.lin.idOf(v));
      this.onEvent({ ev: 'end', step, a: x, b: this.lin.idOf(v), reason: 'ring-end' });
    }
    // what is left of the cluster once this ring is out of it: in how many pieces?
    const adj = this.adjacency((u, v) => gone.has(u) || gone.has(v)), seen = new Set<number>(), comps: number[][] = [];
    for (const y of partners) {
      if (seen.has(y)) continue;
      const c = TieObserver.component(adj, y);
      for (const z of c) seen.add(z);
      comps.push(c);
    }
    if (comps.length >= 2) this.pieces(step, 'ring-end', comps);
    for (const b of gone) this.tied.delete(b);
  }
}
