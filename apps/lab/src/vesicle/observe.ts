// Observers for the vesicle world. Nothing here feeds back into the rules: a "vesicle" is a ring of bonds
// found by walking `next`, and its contents are the particles that fall inside its polygon.
import type { VesicleWorld } from './model.ts';

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
  if (bad.length) return bad;
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
}

/** Whole-ring record for the ring that holds bead `start`: wall bytes over its beads, solute bytes over the particles inside. */
export function ringStat(w: VesicleWorld, start: number): RingStat {
  const xs: number[] = [], ys: number[] = [];
  let wg = 0, wg2 = 0;
  for (let i = start; ;) {
    xs.push(w.bx[i]); ys.push(w.by[i]); const g = w.wgene[i]; wg += g; wg2 += g * g;
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
  };
}

export type LineageEvent =
  | { ev: 'pinch'; step: number; id: number; d1: number; d2: number; m: RingStat; a: RingStat; b: RingStat }
  | { ev: 'end'; step: number; id: number; kind: 'burst' | 'dissolve' | 'wound'; m: RingStat };

export const STAT_COLS = ['beads', 'solute', 'gMean', 'gSd', 'wMean', 'wSd', 'area'] as const;
/** Extra columns written when threads are on: how many threads the ring holds and the mean of thread genes 0 and 1. */
export const THREAD_COLS = ['threads', 't0', 't1'] as const;
export const EVENT_HEADER = ['ev', 'step', 'id', 'd1', 'd2', 'kind', ...['m', 'a', 'b'].flatMap((r) => STAT_COLS.map((c) => `${r}_${c}`))].join('\t');
export const CELL_HEADER = ['step', 'id', ...STAT_COLS, 'cx', 'cy'].join('\t');
export const eventHeader = (thread: boolean) => (thread ? [EVENT_HEADER, ...['m', 'a', 'b'].flatMap((r) => THREAD_COLS.map((c) => `${r}_${c}`))].join('\t') : EVENT_HEADER);
export const cellHeader = (thread: boolean) => (thread ? [CELL_HEADER, ...THREAD_COLS].join('\t') : CELL_HEADER);

const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
const statCells = (s?: RingStat) => (s ? STAT_COLS.map((c) => f(s[c])) : STAT_COLS.map(() => ''));
const threadCells = (s?: RingStat) => (s ? THREAD_COLS.map((c) => f(c === 'threads' ? s.threads : c === 't0' ? s.t0 : s.t1)) : THREAD_COLS.map(() => ''));
export const eventLine = (e: LineageEvent, thread = false) =>
  (e.ev === 'pinch'
    ? ['pinch', e.step, e.id, e.d1, e.d2, '', ...statCells(e.m), ...statCells(e.a), ...statCells(e.b), ...(thread ? [...threadCells(e.m), ...threadCells(e.a), ...threadCells(e.b)] : [])]
    : ['end', e.step, e.id, '', '', e.kind, ...statCells(e.m), ...statCells(undefined), ...statCells(undefined), ...(thread ? [...threadCells(e.m), ...threadCells(undefined), ...threadCells(undefined)] : [])]).join('\t');
export const cellLine = (step: number, id: number, s: RingStat, thread = false) => [step, id, ...statCells(s), f(s.cx), f(s.cy), ...(thread ? threadCells(s) : [])].join('\t');

export class LineageObserver {
  /** Cell id per bead slot (0 = none yet). Ids are 1, 2, 3, ... never reused. */
  readonly cid: Int32Array;
  nextId = 1;
  private pending: { m: RingStat; id: number } | null = null;

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
  }

  detach(): void { this.w.hooks.pinch = undefined; this.w.hooks.end = undefined; }

  private paint(start: number, id: number): void {
    for (let i = start; ;) { this.cid[i] = id; i = this.w.next[i]; if (i === start) break; }
  }

  private onPinch(stage: 0 | 1, c: number, a: number, pc: number, b: number): void {
    const w = this.w;
    if (stage === 0) { this.pending = { id: this.cid[c], m: ringStat(w, c) }; return; }
    const { id, m } = this.pending!; this.pending = null;
    const d1 = this.nextId++, d2 = this.nextId++;
    this.paint(c, d1); this.paint(b, d2);
    this.onEvent({ ev: 'pinch', step: w.step, id, d1, d2, m, a: ringStat(w, c), b: ringStat(w, b) });
    void a; void pc;
  }

  private onEnd(kind: 'burst' | 'dissolve' | 'wound', bead: number): void {
    // the anchor may be a bead born this step with no id yet: take the ring's id from any labelled bead, then clear
    // every bead's id now, because freed slots can be reused before the next sweep and would keep a dead id
    const { w, cid } = this;
    let id = 0;
    for (let i = bead; ;) { if (cid[i] !== 0) { id = cid[i]; break; } i = w.next[i]; if (i === bead) break; }
    if (id === 0) id = this.nextId++;
    this.onEvent({ ev: 'end', step: w.step, id, kind, m: ringStat(w, bead) });
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
  forEachCell(fn: (id: number, s: RingStat) => void): void {
    const { w } = this, seen = new Uint8Array(w.beadHi);
    for (let s = 0; s < w.beadHi; s++) {
      if (!w.alive[s] || seen[s]) continue;
      for (let i = s; !seen[i]; i = w.next[i]) seen[i] = 1;
      fn(this.cid[s], ringStat(w, s));
    }
  }
}
