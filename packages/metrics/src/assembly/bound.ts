// Bounded grammar search for larger objects (GRAMMAR.md 4). The result is the join count of a COMPLETED construction DAG,
// an upper bound on the construction length under this grammar. It is never called an assembly index.
import { canonicalKey, cx, cy, code, isConnected, keyCells, log2ceil, NEIGHBOURS, normalise, toPoints, type Conn } from "./grammar.ts";
import type { DagEntry } from "./exact.ts";

export interface BoundOptions { conn: Conn; beamW: number; nodeCap: number; maxCand: number; free?: ReadonlySet<string> }
export interface BoundResult { cost: number; nodes: number; dag: DagEntry[]; fallback: boolean }

interface State { entries: Map<string, DagEntry>; pending: Map<string, number[]>; }

const size = (s: State) => s.entries.size + s.pending.size;
const pendingSize = (s: State) => { let t = 0; for (const c of s.pending.values()) t += c.length; return t; };
const stateKey = (s: State) => [...s.entries.keys()].sort().join(";") + "#" + [...s.pending.keys()].sort().join(";");
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function bfsOrder(cells: readonly number[], conn: Conn, from: number): number[] {
  const set = new Set(cells);
  const seen = new Set<number>([from]);
  const out = [from];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    for (const [dx, dy] of NEIGHBOURS[conn]) {
      const x = cx(c) + dx, y = cy(c) + dy;
      if (x < 0 || y < 0) continue;
      const n = code(x, y);
      if (set.has(n) && !seen.has(n)) { seen.add(n); out.push(n); }
    }
  }
  return out;
}

/** Monomer chain: add one cell at a time in BFS order. Always valid; cost n-1. */
export function chainDag(cells: readonly number[], conn: Conn): DagEntry[] {
  const order = bfsOrder(cells, conn, cells[0]);
  const dag: DagEntry[] = [];
  for (let i = 2; i <= order.length; i++) {
    const cur = order.slice(0, i);
    dag.push({ key: canonicalKey(cur), cells: cur.slice().sort((a, b) => a - b), a: order.slice(0, i - 1).sort((a, b) => a - b), b: [order[i - 1]] });
  }
  return dag;
}

interface Cand { a: number[]; b: number[]; ka: string; kb: string }

function candidates(c: readonly number[], st: State, known: Map<string, number[]>, free: ReadonlySet<string>, conn: Conn): Cand[] {
  const n = c.length;
  const set = new Set(c);
  const seenPair = new Set<string>();
  const out: Cand[] = [];
  const push = (a: number[], b: number[]): void => {
    if (a.length === 0 || b.length === 0) return;
    const ka = canonicalKey(a), kb = canonicalKey(b);
    const pk = ka < kb ? ka + "|" + kb : kb + "|" + ka;
    if (seenPair.has(pk)) return;
    if (!isConnected(a, conn) || !isConnected(b, conn)) return;
    seenPair.add(pk);
    out.push({ a, b, ka, kb });
  };
  // copy-aware: place a known pattern inside c so that the remainder is connected
  for (const [key, pat] of known) {
    if (pat.length < 2 || pat.length >= n) continue;
    const base = pat[0];
    for (const anchor of c) {
      const dx = cx(anchor) - cx(base), dy = cy(anchor) - cy(base);
      let ok = true;
      const placed: number[] = [];
      for (const p of pat) {
        const x = cx(p) + dx, y = cy(p) + dy;
        if (x < 0 || y < 0) { ok = false; break; }
        const q = code(x, y);
        if (!set.has(q)) { ok = false; break; }
        placed.push(q);
      }
      if (!ok) continue;
      const ps = new Set(placed);
      push(placed.sort((a, b) => a - b), c.filter((q) => !ps.has(q)));
    }
    void key;
  }
  // sweeps: prefixes of fixed orders
  const orders: number[][] = [
    c.slice(),
    c.slice().sort((a, b) => cx(a) - cx(b) || cy(a) - cy(b)),
    c.slice().reverse(),
    c.slice().sort((a, b) => cx(b) - cx(a) || cy(b) - cy(a)),
    bfsOrder(c, conn, c[0]),
    bfsOrder(c, conn, c[n - 1]),
  ];
  const lens = n <= 16 ? Array.from({ length: n - 1 }, (_, i) => i + 1) : [1, n >> 1, (n + 1) >> 1, n - 1];
  for (const ord of orders) for (const L of lens) {
    const pre = new Set(ord.slice(0, L));
    push(ord.slice(0, L).sort((a, b) => a - b), c.filter((q) => !pre.has(q)));
  }
  void st; void free;
  return out;
}

export function boundConstruction(cells: readonly number[], opt: BoundOptions): BoundResult {
  const n = cells.length;
  if (n <= 1) return { cost: 0, nodes: 0, dag: [], fallback: false };
  const free = opt.free ?? new Set<string>();
  const tkey = canonicalKey(cells);
  const chain = (nodes: number): BoundResult => ({ cost: n - 1, nodes, dag: chainDag(cells, opt.conn), fallback: true });
  if (free.has(tkey)) return { cost: 0, nodes: 0, dag: [], fallback: false };
  const init: State = { entries: new Map(), pending: new Map([[tkey, cells.slice()]]) };
  let beam: State[] = [init];
  let nodes = 0;
  const freePatterns = new Map<string, number[]>();
  for (const k of free) freePatterns.set(k, keyCells(k));
  while (beam.length) {
    if (beam[0].pending.size === 0) {
      const dag = [...beam[0].entries.values()];
      const ordered = orderDag(dag);
      const cost = ordered.length;
      if (cost <= n - 1 || free.size > 0) return { cost, nodes, dag: ordered, fallback: false };
      return chain(nodes);
    }
    if (nodes >= opt.nodeCap) return chain(nodes);
    const next: State[] = [];
    const seen = new Set<string>();
    for (const s of beam) {
      if (s.pending.size === 0) { const k = stateKey(s); if (!seen.has(k)) { seen.add(k); next.push(s); } continue; }
      // expand the largest pending class (ties: smallest key)
      let bk = "";
      let bn = -1;
      for (const [k, v] of s.pending) if (v.length > bn || (v.length === bn && k < bk)) { bk = k; bn = v.length; }
      const cc = s.pending.get(bk)!;
      const known = new Map<string, number[]>(freePatterns);
      for (const [k, e] of s.entries) known.set(k, keyCells(k).length ? keyCells(k) : e.cells);
      for (const [k] of s.pending) known.set(k, keyCells(k));
      known.delete(bk);
      const cands = candidates(cc, s, known, free, opt.conn);
      const scored = cands.map((cd) => {
        const fresh = new Set<string>();
        for (const [k, p] of [[cd.ka, cd.a], [cd.kb, cd.b]] as const) if (p.length >= 2 && !s.entries.has(k) && !s.pending.has(k) && !free.has(k) && k !== bk) fresh.add(k);
        return { cd, fresh: fresh.size, bal: Math.max(cd.a.length, cd.b.length) };
      }).sort((p, q) => p.fresh - q.fresh || p.bal - q.bal || cmpStr(p.cd.ka + p.cd.kb, q.cd.ka + q.cd.kb)).slice(0, opt.maxCand);
      for (const { cd } of scored) {
        // the cap binds child creation, not only layer boundaries
        if (nodes >= opt.nodeCap) return chain(nodes);
        nodes++;
        const entries = new Map(s.entries);
        const pending = new Map(s.pending);
        pending.delete(bk);
        entries.set(bk, { key: bk, cells: cc.slice().sort((a, b) => a - b), a: cd.a, b: cd.b });
        for (const [k, p] of [[cd.ka, cd.a], [cd.kb, cd.b]] as const) if (p.length >= 2 && !entries.has(k) && !free.has(k)) pending.set(k, p);
        const child: State = { entries, pending };
        const k = stateKey(child);
        if (!seen.has(k)) { seen.add(k); next.push(child); }
      }
    }
    next.sort((p, q) => size(p) - size(q) || pendingSize(p) - pendingSize(q) || cmpStr(stateKey(p), stateKey(q)));
    beam = next.slice(0, opt.beamW);
  }
  return chain(nodes);
}

/** Parts before wholes: sort by cell count (a part is strictly smaller than its whole), ties by key. */
export function orderDag(dag: readonly DagEntry[]): DagEntry[] {
  return dag.slice().sort((p, q) => p.cells.length - q.cells.length || cmpStr(p.key, q.key));
}

export interface Validation { ok: boolean; problems: string[] }

/** Independent re-check of a construction DAG against the grammar. Does not use the search code. */
export function validateDag(target: readonly number[], dag: readonly DagEntry[], conn: Conn, free: ReadonlySet<string> = new Set()): Validation {
  const problems: string[] = [];
  const tset = new Set(target);
  const built = new Set<string>(free);
  const keyOf = (cells: readonly number[]) => normalise(toPoints(cells)).join(",");
  for (const e of dag) {
    const aset = new Set(e.a);
    if (e.a.length === 0 || e.b.length === 0) problems.push(`${e.key}: empty part`);
    if (e.b.some((c) => aset.has(c))) problems.push(`${e.key}: parts overlap`);
    const union = [...e.a, ...e.b].sort((p, q) => p - q);
    if (union.join(",") !== e.cells.slice().sort((p, q) => p - q).join(",")) problems.push(`${e.key}: parts do not make the whole`);
    if (union.some((c) => !tset.has(c))) problems.push(`${e.key}: not a sub-object of the target`);
    if (!isConnected(e.a, conn) || !isConnected(e.b, conn) || !isConnected(union, conn)) problems.push(`${e.key}: a part or the whole is not connected`);
    for (const part of [e.a, e.b]) if (part.length >= 2 && !built.has(keyOf(part))) problems.push(`${e.key}: part ${keyOf(part)} is not built yet`);
    if (keyOf(union) !== e.key) problems.push(`${e.key}: key does not match the cells`);
    built.add(e.key);
  }
  const want = keyOf(target);
  if (target.length >= 2 && !built.has(want)) problems.push("target is not built");
  return { ok: problems.length === 0, problems };
}

export { log2ceil };
