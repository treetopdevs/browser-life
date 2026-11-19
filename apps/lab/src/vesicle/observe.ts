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
  /** Solute count by founder id. */
  founders: Map<number, number>;
  xs: Float64Array; ys: Float64Array;
}

export interface Census { loops: Loop[]; freeSolute: number; beads: number; particles: number; freeLipid: number; food: number; waste: number }

export function loops(w: VesicleWorld, withSolute = true): Loop[] {
  const seen = new Uint8Array(w.beadHi), out: Loop[] = [];
  for (let s = 0; s < w.beadHi; s++) {
    if (!w.alive[s] || seen[s]) continue;
    const idx: number[] = [];
    for (let i = s; !seen[i]; i = w.next[i]) { seen[i] = 1; idx.push(i); }
    const n = idx.length, xs = new Float64Array(n), ys = new Float64Array(n);
    let per = 0, a2 = 0, cx = 0, cy = 0;
    for (let k = 0; k < n; k++) { xs[k] = w.bx[idx[k]]; ys[k] = w.by[idx[k]]; }
    for (let k = 0; k < n; k++) {
      const m = (k + 1) % n, dx = xs[m] - xs[k], dy = ys[m] - ys[k], cr = xs[k] * ys[m] - xs[m] * ys[k];
      per += Math.sqrt(dx * dx + dy * dy); a2 += cr; cx += (xs[k] + xs[m]) * cr; cy += (ys[k] + ys[m]) * cr;
    }
    const area = a2 / 2;
    out.push({
      first: s, beads: n, perimeter: per, area, cx: a2 !== 0 ? cx / (3 * a2) : xs[0], cy: a2 !== 0 ? cy / (3 * a2) : ys[0],
      stretch: per / (n * w.p.l0) - 1, roundness: per > 0 ? (12.566370614359172 * area) / (per * per) : 0,
      solute: 0, geneMean: 0, markMean: 0, founders: new Map(), xs, ys,
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
  for (let i = 0; i < ls.length; i++) if (ls[i].solute) { ls[i].geneMean = gs[i] / ls[i].solute; ls[i].markMean = ms[i] / ls[i].solute; }
  return where;
}

export function census(w: VesicleWorld): Census {
  const ls = loops(w);
  let inLoops = 0, lipid = 0, food = 0, waste = 0;
  for (const l of ls) inLoops += l.solute;
  for (let c = 0; c < w.lipid.length; c++) { lipid += w.lipid[c]; food += w.food[c]; waste += w.waste[c]; }
  return { loops: ls, freeSolute: w.n - inLoops, beads: w.beadCount, particles: w.n, freeLipid: lipid, food, waste };
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
