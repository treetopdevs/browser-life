// Exact construction length for small objects (GRAMMAR.md 3): minimum number of joins to build the target from monomers,
// every intermediate a connected sub-object of the target, reuse free. Search is over connected sub-masks of the target.
import { canonicalKey, cx, cy, isConnected, log2ceil, NEIGHBOURS, code, type Conn, type Group } from "./grammar.ts";

export const EXACT_MAX_N = 10;

export interface DagEntry {
  /** Class key under the group the search used. */
  key: string;
  /** Cells of this sub-object in the target's frame. */
  cells: number[];
  /** The two parts joined (cells in the target's frame); both connected and disjoint. */
  a: number[];
  b: number[];
}
export interface Construction { cost: number; status: "exact" | "bound"; nodes: number; dag: DagEntry[] }

interface Space {
  cells: number[];
  n: number;
  /** Per connected mask: class index. */
  classOf: Map<number, number>;
  classes: { key: string; size: number; rep: number; splits: [number, number][] }[];
  adj: number[];
}

const lowBit = (m: number): number => m & -m;

function connectedMask(m: number, adj: number[]): boolean {
  if (m === 0) return false;
  let comp = lowBit(m);
  for (;;) {
    let next = comp;
    for (let r = comp; r; r &= r - 1) next |= adj[31 - Math.clz32(lowBit(r))] & m;
    if (next === comp) break;
    comp = next;
  }
  return comp === m;
}

export function buildSpace(cells: readonly number[], conn: Conn, group: Group): Space {
  const n = cells.length;
  const index = new Map(cells.map((c, i) => [c, i] as const));
  const adj = cells.map((c) => {
    let m = 0;
    for (const [dx, dy] of NEIGHBOURS[conn]) { const j = index.get(code(cx(c) + dx, cy(c) + dy)); if (j !== undefined && cx(c) + dx >= 0 && cy(c) + dy >= 0) m |= 1 << j; }
    return m;
  });
  const classOf = new Map<number, number>();
  const classes: Space["classes"] = [];
  const byKey = new Map<string, number>();
  const full = (1 << n) - 1;
  const masks: number[] = [];
  for (let m = 1; m <= full; m++) {
    if (!connectedMask(m, adj)) continue;
    const sub: number[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) sub.push(cells[i]);
    const key = canonicalKey(sub, group);
    let ci = byKey.get(key);
    if (ci === undefined) { ci = classes.length; byKey.set(key, ci); classes.push({ key, size: sub.length, rep: m, splits: [] }); }
    classOf.set(m, ci);
    masks.push(m);
  }
  for (const c of classes) {
    if (c.size < 2) continue;
    const seen = new Set<number>();
    const m = c.rep, low = lowBit(m);
    for (let s = (m - 1) & m; s > 0; s = (s - 1) & m) {
      if (!(s & low)) continue;
      const r = m ^ s;
      if (r === 0) continue;
      const ca = classOf.get(s), cb = classOf.get(r);
      if (ca === undefined || cb === undefined) continue; // a part must itself be connected
      const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
      seen.add(lo * 4096 + hi);
    }
    c.splits = [...seen].sort((p, q) => p - q).map((v) => [Math.floor(v / 4096), v % 4096] as [number, number]);
  }
  return { cells: cells.slice(), n, classOf, classes, adj };
}

/** Exact state identity: two bitsets over class indices, packed 16 bits per char. */
function stateKey(nClasses: number, inS: Set<number>, todo: readonly number[]): string {
  const words = (nClasses + 15) >> 4;
  const w = new Uint16Array(2 * words);
  for (const c of inS) w[c >> 4] |= 1 << (c & 15);
  for (const c of todo) w[words + (c >> 4)] |= 1 << (c & 15);
  return String.fromCharCode.apply(null, w as unknown as number[]);
}

interface Search { space: Space; target: number; free: Set<number>; budget: number; nodes: number; exhausted: boolean; chosen: Map<number, [number, number]> }

function dfs(sr: Search, inS: Set<number>, todo: number[], cost: number, K: number, failed: Set<string>): boolean {
  if (todo.length === 0) return true;
  if (++sr.nodes > sr.budget) { sr.exhausted = true; return false; }
  const key = stateKey(sr.space.classes.length, inS, todo);
  if (failed.has(key)) return false;
  // expand the largest pending class (ties: smallest class index)
  let bi = 0;
  for (let i = 1; i < todo.length; i++) {
    const a = sr.space.classes[todo[i]], b = sr.space.classes[todo[bi]];
    if (a.size > b.size || (a.size === b.size && todo[i] < todo[bi])) bi = i;
  }
  const c = todo[bi];
  const rest = todo.filter((_, i) => i !== bi);
  const cls = sr.space.classes;
  const room = K - cost;
  const opts: { pa: number; pb: number; add: number[] }[] = [];
  for (let pass = 0; pass <= Math.min(2, room); pass++) {
    for (const [pa, pb] of cls[c].splits) {
      const na = cls[pa].size >= 2 && !sr.free.has(pa) && !inS.has(pa);
      const nb = pb !== pa && cls[pb].size >= 2 && !sr.free.has(pb) && !inS.has(pb);
      const cnt = (na ? 1 : 0) + (nb ? 1 : 0);
      if (cnt !== pass) continue;
      const add: number[] = [];
      if (na) add.push(pa);
      if (nb) add.push(pb);
      opts.push({ pa, pb, add });
    }
  }
  for (const { pa, pb, add } of opts) {
    for (const p of add) inS.add(p);
    sr.chosen.set(c, [pa, pb]);
    if (dfs(sr, inS, rest.concat(add), cost + add.length, K, failed)) return true;
    for (const p of add) inS.delete(p);
    sr.chosen.delete(c);
    if (sr.exhausted) return false;
  }
  failed.add(key);
  return false;
}

function dagFrom(sp: Space, sr: Search, target: number): DagEntry[] {
  // Entries in dependency order (parts before wholes). Each class is realised by its representative mask.
  const order: number[] = [];
  const mark = new Set<number>();
  const visit = (c: number): void => {
    if (mark.has(c) || sp.classes[c].size < 2 || sr.free.has(c)) return;
    mark.add(c);
    const [a, b] = sr.chosen.get(c)!;
    visit(a); visit(b);
    order.push(c);
  };
  visit(target);
  return order.map((c) => {
    const rep = sp.classes[c].rep;
    const [pa, pb] = sr.chosen.get(c)!;
    // find a concrete partition of rep realising the chosen class pair
    let a = 0;
    const low = lowBit(rep);
    for (let s = (rep - 1) & rep; s > 0; s = (s - 1) & rep) {
      if (!(s & low)) continue;
      const ca = sp.classOf.get(s), cb = sp.classOf.get(rep ^ s);
      if (ca === undefined || cb === undefined) continue;
      if (Math.min(ca, cb) === Math.min(pa, pb) && Math.max(ca, cb) === Math.max(pa, pb)) { a = s; break; }
    }
    const toCells = (m: number) => sp.cells.filter((_, i) => m & (1 << i));
    return { key: sp.classes[c].key, cells: toCells(rep), a: toCells(a), b: toCells(rep ^ a) };
  });
}

export interface ExactOptions { conn: Conn; group: Group; budget: number; free?: Set<string> }

/** Exact minimum, or `undefined` result status "bound" with `cost` unset when the budget runs out (callers fall back). */
export function exactConstruction(cells: readonly number[], opt: ExactOptions): { cost: number; exact: boolean; nodes: number; dag: DagEntry[] } {
  const n = cells.length;
  if (n > 12) throw new Error("exact search is limited to 12 cells");
  if (n <= 1) return { cost: 0, exact: true, nodes: 0, dag: [] };
  const sp = buildSpace(cells, opt.conn, opt.group);
  const target = sp.classOf.get((1 << n) - 1)!;
  const freeIdx = new Set<number>();
  if (opt.free) sp.classes.forEach((c, i) => { if (opt.free!.has(c.key)) freeIdx.add(i); });
  const sr: Search = { space: sp, target, free: freeIdx, budget: opt.budget, nodes: 0, exhausted: false, chosen: new Map() };
  if (freeIdx.has(target)) return { cost: 0, exact: true, nodes: 0, dag: [] };
  for (let K = freeIdx.size ? 1 : Math.min(log2ceil(n), n - 1); K <= n - 1; K++) {
    sr.chosen.clear();
    const inS = new Set<number>([target]);
    if (dfs(sr, inS, [target], 1, K, new Set<string>())) return { cost: K, exact: true, nodes: sr.nodes, dag: dagFrom(sp, sr, target) };
    if (sr.exhausted) return { cost: -1, exact: false, nodes: sr.nodes, dag: [] };
  }
  throw new Error("unreachable: the monomer chain always exists");
}

/** Decision form used by motif selection: is a(cells) <= k ? (false also when the budget runs out). */
export function atMost(cells: readonly number[], k: number, opt: ExactOptions): boolean | null {
  const n = cells.length;
  if (k >= n - 1 || n <= 1) return true;
  if (k < log2ceil(n)) return false;
  const sp = buildSpace(cells, opt.conn, opt.group);
  const target = sp.classOf.get((1 << n) - 1)!;
  const sr: Search = { space: sp, target, free: new Set(), budget: opt.budget, nodes: 0, exhausted: false, chosen: new Map() };
  const ok = dfs(sr, new Set([target]), [target], 1, k, new Set());
  return sr.exhausted ? null : ok;
}

export { isConnected };
