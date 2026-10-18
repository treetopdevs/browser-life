// Clade measures from the mutation tree (docs/clade-measures-2026-10-18.md): TMRCA95 of the living population,
// mutant-clade sweeps and gross clade replacement, read from mutations.tsv (the mutation-lineage tree: each key is one
// mutation event's genome, though the same genome can recur under another key) and lineages.tsv (per-census
// abundance), both streamed. Pure: no Deno or filesystem access, so vitest
// can run it; tools/clade.ts does the I/O.
//
// The tree is pruned as it goes: a lineage absent from a census never regains cells (so it can never mint a child),
// and a node is dropped once neither it nor any descendant is alive. Retained state is the living lineages plus
// their ancestor paths, never the file length.
import { binomialLowerBound, mannWhitney } from "@bl/metrics";
import { rng } from "./measures6.ts";

/** Fixed in the note before computing: x, y, W (steps), Δ (steps), the MRCA cut. */
export const PARAMS = { x: 0.01, y: 0.5, W: 100_000, delta: 10_000, cut: 0.95 } as const;
export interface Params { x: number; y: number; W: number; delta: number; cut: number }

/** One census of lineages.tsv: [step, [lineage key, cells][]]. */
export type Census = [number, [string, number][]];
export interface Edge { childHi: number; childLo: number; parentHi: number; parentLo: number }

const UINT = /^\d+$/;

/** One mutations.tsv line; null for the header or a blank line; throws on anything else that is not 4 unsigned integers. */
export function parseEdgeLine(line: string): Edge | null {
  if (!line || line.startsWith("childHi")) return null;
  const f = line.split("\t");
  if (f.length !== 4 || !f.every((x) => UINT.test(x))) throw new Error(`mutations.tsv: malformed row ${JSON.stringify(line)}`);
  return { childHi: +f[0], childLo: +f[1], parentHi: +f[2], parentLo: +f[3] };
}

/** Lines of a text stream given as decoded chunks; a line may span chunks; a trailing CR is dropped. */
export async function* splitLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let pending: string[] = [];
  for await (const chunk of chunks) {
    let start = 0, nl: number;
    while ((nl = chunk.indexOf("\n", start)) >= 0) {
      const l = pending.length ? pending.join("") + chunk.slice(start, nl) : chunk.slice(start, nl);
      pending = [];
      yield l.endsWith("\r") ? l.slice(0, -1) : l;
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.slice(start));
  }
  const last = pending.join("");
  if (last) yield last.endsWith("\r") ? last.slice(0, -1) : last;
}

/** True when resolved path `p` is `base` or lies under it (both already resolved, no trailing slash on base). */
export const isUnder = (p: string, base: string): boolean => p === base || p.startsWith(base.endsWith("/") ? base : `${base}/`);

/** The hi half of a lineage key "hi:lo". */
export function keyHi(key: string): number {
  const i = key.indexOf(":");
  const hi = key.slice(0, i), lo = key.slice(i + 1);
  if (i < 0 || !UINT.test(hi) || !UINT.test(lo)) throw new Error(`malformed lineage key ${JSON.stringify(key)}`);
  return +hi;
}

/** A retained node of the genotype tree. `birth` is hi − 1 (founders: hi 0, birth 0); present at census t iff hi ≤ t. */
export interface CladeNode {
  readonly key: string;
  readonly hi: number;
  readonly birth: number;
  readonly parent: CladeNode | null;
  readonly depth: number;
  /** Cells at the last census (0 when absent). */
  cells: number;
  /** Cells of this node and its descendants at the last census. */
  sub: number;
  /** The child with the largest `sub` at the last census (null when no child holds cells). */
  heavy: CladeNode | null;
  /** The last evaluated census at which the clade share was below x (−Infinity if never). */
  lastLow: number;
  /** Part of (or an ancestor of) a recorded sweep event. */
  marked: boolean;
  pruned: boolean;
  /** Missing from a census at or after its birth: it can never hold cells again. */
  absent: boolean;
  memoStep: number;
  memoAnc: CladeNode | null;
}

function node(key: string, hi: number, parent: CladeNode | null): CladeNode {
  return { key, hi, birth: Math.max(0, hi - 1), parent, depth: parent ? parent.depth + 1 : 0, cells: 0, sub: 0, heavy: null, lastLow: -Infinity, marked: false, pruned: false, absent: false, memoStep: -1, memoAnc: null };
}

/** The pruned genotype tree. Add every edge with childHi ≤ t, then `observe` census t; queries describe that census. */
export class CladeTree {
  private nodes = new Map<string, CladeNode>();
  /** Non-founder nodes in insertion order, which is non-decreasing hi, so a child always follows its parent. */
  private order: CladeNode[] = [];
  private roots: CladeNode[] = [];
  private deadFounders = new Set<string>();
  private lastHi = 0;
  private hiGroup = new Set<string>();
  private lastStep = -Infinity;
  private livingNodes: CladeNode[] = [];
  private peak = 0;
  /** Living cells at the last census. */
  total = 0;

  get retained(): number {
    return this.nodes.size;
  }
  get peakRetained(): number {
    return this.peak;
  }
  get step(): number {
    return this.lastStep;
  }
  get living(): readonly CladeNode[] {
    return this.livingNodes;
  }
  /** Retained founders (roots). */
  get rootNodes(): readonly CladeNode[] {
    return this.roots;
  }
  /** Deepest retained node (mutations from its founder). */
  get maxDepth(): number {
    let d = 0;
    for (const n of this.order) if (n.depth > d) d = n.depth;
    return d;
  }
  /** Every retained node (founders first, then by hi). */
  *all(): Generator<CladeNode> {
    yield* this.roots;
    yield* this.order;
  }

  private lookup(key: string, hi: number, what: string): CladeNode {
    const n = this.nodes.get(key);
    if (n) return n;
    if (hi === 0 && !this.deadFounders.has(key)) {
      const f = node(key, 0, null);
      this.nodes.set(key, f);
      this.roots.push(f);
      this.peak = Math.max(this.peak, this.nodes.size);
      return f;
    }
    throw new Error(`${what} ${key} is not a known living lineage${this.deadFounders.has(key) ? " (its founder clade died out)" : ""}`);
  }

  addEdge(e: Edge): void {
    if (e.childHi < this.lastHi) throw new Error(`mutations.tsv: childHi ${e.childHi} follows ${this.lastHi}; rows must be ordered by childHi`);
    if (e.childHi <= this.lastStep) throw new Error(`mutations.tsv: child ${e.childHi}:${e.childLo} arrives after census ${this.lastStep}`);
    if (e.parentHi >= e.childHi) throw new Error(`mutations.tsv: parent ${e.parentHi}:${e.parentLo} is not older than child ${e.childHi}:${e.childLo}`);
    if (e.childHi !== this.lastHi) {
      this.hiGroup.clear();
      this.lastHi = e.childHi;
    }
    const ck = `${e.childHi}:${e.childLo}`;
    if (this.hiGroup.has(ck) || this.nodes.has(ck)) throw new Error(`mutations.tsv: child ${ck} repeats`);
    this.hiGroup.add(ck);
    const parent = this.lookup(`${e.parentHi}:${e.parentLo}`, e.parentHi, `parent of ${ck}`);
    const n = node(ck, e.childHi, parent);
    this.nodes.set(ck, n);
    this.order.push(n);
    this.peak = Math.max(this.peak, this.nodes.size);
  }

  /** Sets census `step`: cells, subtree sums, heavy children; then prunes every node whose subtree is empty. */
  observe(step: number, rows: readonly [string, number][]): void {
    if (!(step > this.lastStep)) throw new Error(`census ${step} follows ${this.lastStep}`);
    for (const n of this.livingNodes) n.cells = 0;
    this.livingNodes = [];
    let total = 0;
    for (const [k, c] of rows) {
      if (!Number.isInteger(c) || c <= 0) throw new Error(`census ${step}: ${k} has ${c} cells`);
      const hi = keyHi(k);
      if (hi > step) throw new Error(`census ${step}: ${k} is present before its birth`);
      const n = this.lookup(k, hi, `census ${step}: living`);
      if (n.absent) throw new Error(`census ${step}: ${k} holds cells again after a census without any`);
      if (n.cells) throw new Error(`census ${step}: ${k} repeats`);
      n.cells = c;
      this.livingNodes.push(n);
      total += c;
    }
    this.total = total;
    this.lastStep = step;
    this.peak = Math.max(this.peak, this.nodes.size);
    for (const n of this.roots) (n.sub = n.cells), (n.heavy = null), n.cells || (n.absent = true);
    for (const n of this.order) (n.sub = n.cells), (n.heavy = null), n.cells || n.hi > step || (n.absent = true);
    // Reverse insertion order visits every child before its parent (a child's hi is strictly larger).
    for (let i = this.order.length - 1; i >= 0; i--) {
      const n = this.order[i];
      const p = n.parent!;
      p.sub += n.sub;
      if (n.sub > 0 && (!p.heavy || n.sub > p.heavy.sub)) p.heavy = n;
    }
    let j = 0;
    for (const n of this.order) {
      if (n.sub > 0) this.order[j++] = n;
      else this.drop(n);
    }
    this.order.length = j;
    j = 0;
    for (const n of this.roots) {
      if (n.sub > 0) this.roots[j++] = n;
      else {
        this.drop(n);
        this.deadFounders.add(n.key);
      }
    }
    this.roots.length = j;
  }

  private drop(n: CladeNode) {
    this.nodes.delete(n.key);
    n.pruned = true;
    n.heavy = null;
  }

  get(key: string): CladeNode | undefined {
    return this.nodes.get(key);
  }
  /** Clade share of `key` at the last census (0 for an unknown or pruned key). */
  share(key: string): number {
    const n = this.nodes.get(key);
    return n && this.total ? n.sub / this.total : 0;
  }
  birth(key: string): number {
    const n = this.nodes.get(key);
    if (!n) throw new Error(`unknown lineage ${key}`);
    return n.birth;
  }

  /** Nodes with clade share strictly above y, from the root down (one path, since y ≥ 0.5). */
  majorityPathNodes(y: number = PARAMS.y): CladeNode[] {
    const out: CladeNode[] = [];
    const lim = y * this.total;
    let n: CladeNode | null = this.roots.find((r) => r.sub > lim) ?? null;
    while (n) {
      out.push(n);
      n = n.heavy && n.heavy.sub > lim ? n.heavy : null;
    }
    return out;
  }
  majorityPath(y: number = PARAMS.y): string[] {
    return this.majorityPathNodes(y).map((n) => n.key);
  }

  /** The youngest node whose clade share is at least `cut` (cut > 0.5); null when no root holds it. */
  mrcaNode(cut: number = PARAMS.cut): CladeNode | null {
    const lim = cut * this.total;
    let n: CladeNode | null = this.roots.find((r) => r.sub >= lim) ?? null;
    while (n && n.heavy && n.heavy.sub >= lim) n = n.heavy;
    return n;
  }
  mrca(cut: number = PARAMS.cut): string | null {
    return this.mrcaNode(cut)?.key ?? null;
  }
  /** The exact MRCA of every living cell; null when the population is not one founder's clade. */
  mrcaExactNode(): CladeNode | null {
    if (!this.total) return null;
    let n: CladeNode | null = this.roots.find((r) => r.sub === this.total) ?? null;
    while (n && n.heavy && n.heavy.sub === this.total) n = n.heavy;
    return n;
  }

  /** The youngest ancestor of `n` (itself included) present at census t (hi ≤ t), memoised per t. */
  ancestorPresentAtNode(n: CladeNode, t: number): CladeNode {
    const path: CladeNode[] = [];
    let x: CladeNode | null = n, found: CladeNode | null = null;
    while (x) {
      if (x.memoStep === t) {
        found = x.memoAnc;
        break;
      }
      if (x.hi <= t) {
        found = x;
        break;
      }
      path.push(x);
      x = x.parent;
    }
    if (!found) throw new Error(`${n.key} has no ancestor present at ${t}`);
    for (const y of path) (y.memoStep = t), (y.memoAnc = found);
    return found;
  }
  ancestorPresentAt(key: string, t: number): string {
    const n = this.nodes.get(key);
    if (!n) throw new Error(`unknown lineage ${key}`);
    return this.ancestorPresentAtNode(n, t).key;
  }
}

/** True when `q` is a strict descendant of `a`. */
function descends(q: CladeNode, a: CladeNode): boolean {
  for (let n = q.parent; n; n = n.parent) {
    if (n === a) return true;
    if (n.hi < a.hi) return false;
  }
  return false;
}

interface Snapshot { step: number; total: number; cells: Map<CladeNode, number> }
const snapshot = (tree: CladeTree): Snapshot => ({ step: tree.step, total: tree.total, cells: new Map(tree.living.map((n) => [n, n.cells])) });
/**
 * 1 − Σ_A min(p_A, q_A) between a snapshot and the tree's current census, classes = lineages alive at the snapshot.
 * Integer arithmetic until the final division (cells and totals are well under 2^26).
 */
function replacement(tree: CladeTree, snap: Snapshot): number {
  const q = new Map<CladeNode, number>();
  for (const n of tree.living) {
    const a = tree.ancestorPresentAtNode(n, snap.step);
    if (!snap.cells.has(a)) throw new Error(`census ${tree.step}: ${n.key} descends from ${a.key}, which is not in census ${snap.step}`);
    q.set(a, (q.get(a) ?? 0) + n.cells);
  }
  let overlap = 0;
  for (const [a, c] of q) overlap += Math.min(snap.cells.get(a)! * tree.total, c * snap.total);
  return 1 - overlap / (snap.total * tree.total);
}

export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface SweepEvent { step: number; clade: string; founder: boolean; from: number }
export interface CladeOptions {
  /** The run's last step (10⁶ for the corpora). */
  horizon: number;
  /** 1: evaluate every census; 10: every 10th (steps divisible by 10 × censusEvery). */
  cadence: 1 | 10;
  censusEvery?: number;
  /**
   * Censuses a complete run has (10⁴ for the corpora); when given, a run is `complete` only with exactly that many
   * censuses, the k-th at step k × censusEvery (so an off-grid census cannot stand in for a missing one).
   */
  expectedCensuses?: number;
  params?: Params;
}
export interface CladeResult {
  /** Median TMRCA95 over evaluated censuses with t > horizon/2; null with none. */
  tmrca95Median2: number | null;
  /** Null, like `flaggedTmrca`, `tmrcaAllFinal` and `netReplacement2`, when the run is not `complete`. */
  tmrca95Final: number | null;
  flaggedTmrca: boolean | null;
  tmrcaAllFinal: number | null;
  firstMonophyly95: number | null;
  mutantSweeps: number;
  founderSweeps: number;
  /** Founder sweeps from a census below x (not from the step-0 "born within W" clause, which founders at ~1/12 share meet early). */
  founderSweepsFromLow: number;
  /** Null when the run is not `complete`, so an incomplete run drops out of the flag rate. */
  flaggedSweeps: boolean | null;
  sweeps: SweepEvent[];
  /** Mean G_k over intervals ending after horizon/2; null with none. */
  grossReplacement2: number | null;
  /** Clade change from horizon/2 to the horizon census, classes at horizon/2; null when either census is missing. */
  netReplacement2: number | null;
  intervals: number;
  meanCells2: number | null;
  mutationsPer1e5_2: number;
  mutationRows: number;
  censuses: number;
  evaluated: number;
  lastCensus: number | null;
  /** The last census is the horizon and, when `expectedCensuses` is given, the censuses are exactly the grid. */
  complete: boolean;
  /** Edges with childHi after the last census: counted, never added to the tree (no census observes them). */
  trailingEdges: number;
  peakRetained: number;
  /** At the last census: living lineages, retained nodes, deepest retained node. */
  livingLast: number;
  retainedLast: number;
  depthLast: number;
  /** Diagnostics per tenth of the horizon (max over its censuses): retained nodes, living lineages, max retained depth. */
  retainedByDecile: number[];
  livingByDecile: number[];
  depthByDecile: number[];
  cadence: 1 | 10;
}

/** Every measure of one run, from its census stream and its mutations.tsv lines (header allowed). */
export async function cladeMeasures(censuses: AsyncIterable<Census>, edgeLines: AsyncIterable<string>, opts: CladeOptions): Promise<CladeResult> {
  const P = opts.params ?? PARAMS;
  const { horizon, cadence } = opts;
  const half = horizon / 2;
  const censusEvery = opts.censusEvery ?? 100;
  const evalEvery = cadence * censusEvery;
  if (P.W % evalEvery || P.delta % evalEvery || half % P.delta) throw new Error(`W ${P.W}, Δ ${P.delta} and horizon/2 ${half} must be multiples of the evaluation step ${evalEvery} (and horizon/2 of Δ)`);
  const tree = new CladeTree();
  const it = edgeLines[Symbol.asyncIterator]();
  const nextEdge = async (): Promise<Edge | null> => {
    for (;;) {
      const r = await it.next();
      if (r.done) return null;
      const e = parseEdgeLine(r.value);
      if (e) return e;
    }
  };
  let mutationRows = 0, mutations2 = 0;
  let lastEdgeHi = 0;
  const add = (e: Edge) => {
    lastEdgeHi = e.childHi;
    mutationRows++;
    if (e.childHi > half && e.childHi <= horizon) mutations2++;
    tree.addEdge(e);
  };

  const dec = (t: number) => Math.min(9, Math.max(0, Math.floor((t - 1) / (horizon / 10))));
  const retainedByDecile = new Array<number>(10).fill(0), livingByDecile = new Array<number>(10).fill(0), depthByDecile = new Array<number>(10).fill(0);
  const tmrca2: number[] = [];
  let tmrca95Final: number | null = null, tmrcaAllFinal: number | null = null, firstMonophyly95: number | null = null;
  // Completed events keep only scalars; the last event keeps its node while a refinement (within W) is possible.
  const events: { step: number; key: string; founder: boolean; from: number }[] = [];
  let lastNode: CladeNode | null = null;
  let snap: Snapshot | null = null, halfSnap: Snapshot | null = null;
  let gSum = 0, gN = 0, intervals = 0, net: number | null = null;
  let cells2 = 0, censuses2 = 0, nCensuses = 0, evaluated = 0, lastCensus: number | null = null, onGrid = true;

  let pending = await nextEdge();
  for await (const [t, rows] of censuses) {
    while (pending && pending.childHi <= t) {
      add(pending);
      pending = await nextEdge();
    }
    const d = dec(t);
    retainedByDecile[d] = Math.max(retainedByDecile[d], tree.retained);
    tree.observe(t, rows);
    nCensuses++;
    if (t !== nCensuses * censusEvery) onGrid = false;
    lastCensus = t;
    livingByDecile[d] = Math.max(livingByDecile[d], tree.living.length);
    if (t > half && t <= horizon) (cells2 += tree.total), censuses2++;
    if (t % evalEvery || !tree.total) continue;
    evaluated++;

    // TMRCA95 (censored at t when no founder clade holds the cut) and the exact TMRCA.
    const m = tree.mrcaNode(P.cut);
    const tm = m ? t - m.birth : t;
    if (m && firstMonophyly95 === null) firstMonophyly95 = t;
    if (t > half) tmrca2.push(tm);
    tmrca95Final = tm;
    const ex = tree.mrcaExactNode();
    tmrcaAllFinal = ex ? t - ex.birth : t;

    // Sweeps: the youngest node on the majority path that was below x within [t − W, t) or was born after t − W.
    let q: CladeNode | null = null;
    for (const n of tree.majorityPathNodes(P.y)) if (t - n.lastLow <= P.W || t - n.birth < P.W) q = n;
    const prev = events[events.length - 1];
    if (lastNode && t - prev.step > P.W) lastNode = null;
    if (q && !q.marked) {
      if (lastNode && descends(q, lastNode)) (prev.key = q.key), (prev.founder = q.hi === 0);
      else events.push({ step: t, key: q.key, founder: q.hi === 0, from: Number.isFinite(q.lastLow) && t - q.lastLow <= P.W ? q.lastLow : q.birth });
      lastNode = q;
      for (let n: CladeNode | null = q; n && !n.marked; n = n.parent) n.marked = true;
    }
    const low = P.x * tree.total;
    for (const n of tree.all()) {
      if (n.sub < low) n.lastLow = t;
      if (n.depth > depthByDecile[d]) depthByDecile[d] = n.depth;
    }

    // Replacement over Δ intervals; snapshots at every multiple of Δ.
    if (t % P.delta === 0) {
      if (snap && snap.step === t - P.delta) {
        const g = replacement(tree, snap);
        intervals++;
        if (t > half && t <= horizon) (gSum += g), gN++;
      }
      if (t === horizon && halfSnap) net = replacement(tree, halfSnap);
      snap = snapshot(tree);
      if (t === half) halfSnap = snap;
    }
  }
  let trailingEdges = 0;
  while (pending) {
    if (pending.childHi < lastEdgeHi) throw new Error(`mutations.tsv: childHi ${pending.childHi} follows ${lastEdgeHi}; rows must be ordered by childHi`);
    lastEdgeHi = pending.childHi;
    mutationRows++, trailingEdges++;
    if (pending.childHi > half && pending.childHi <= horizon) mutations2++;
    pending = await nextEdge();
  }

  // The note's extinction policy: a run that does not reach the horizon (or misses a census) has no final-census values.
  const complete = lastCensus === horizon && (opts.expectedCensuses === undefined || (nCensuses === opts.expectedCensuses && onGrid));
  if (!complete) (tmrca95Final = null), (tmrcaAllFinal = null), (net = null);
  const sweeps = events.map((e) => ({ step: e.step, clade: e.key, founder: e.founder, from: e.from }));
  const mutantSweeps = sweeps.filter((e) => !e.founder).length;
  return {
    tmrca95Median2: median(tmrca2),
    tmrca95Final,
    flaggedTmrca: tmrca95Final === null ? null : tmrca95Final < half,
    tmrcaAllFinal,
    firstMonophyly95,
    mutantSweeps,
    founderSweeps: sweeps.length - mutantSweeps,
    founderSweepsFromLow: sweeps.filter((e) => e.founder && e.from > 0).length,
    flaggedSweeps: complete ? mutantSweeps > 0 : null,
    sweeps,
    grossReplacement2: gN ? gSum / gN : null,
    netReplacement2: net,
    intervals,
    meanCells2: censuses2 ? cells2 / censuses2 : null,
    mutationsPer1e5_2: mutations2 / ((horizon - half) / 1e5),
    mutationRows,
    censuses: nCensuses,
    evaluated,
    lastCensus,
    complete,
    trailingEdges,
    peakRetained: tree.peakRetained,
    livingLast: tree.living.length,
    retainedLast: tree.retained,
    depthLast: tree.maxDepth,
    retainedByDecile,
    livingByDecile,
    depthByDecile,
    cadence,
  };
}

// ---------------------------------------------------------------------------------------------
// Eligibility (the note's rules 1–5).

/** Spearman's correlation, the Pearson correlation of the midranks; null when undefined (fewer than two pairs, or one side constant). Copied from tools/lib/hunt-stats.ts. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) throw new Error("spearman: xs and ys differ in length");
  const n = xs.length;
  if (n < 2) return null;
  const midranks = (v: readonly number[]) => {
    const order = v.map((_, i) => i).sort((p, q) => v[p] - v[q] || p - q);
    const rank = new Array<number>(v.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && v[order[j + 1]] === v[order[i]]) j++;
      for (let k = i; k <= j; k++) rank[order[k]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return rank;
  };
  const rx = midranks(xs), ry = midranks(ys), m = (n + 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - m) * (ry[i] - m);
    sxx += (rx[i] - m) * (rx[i] - m);
    syy += (ry[i] - m) * (ry[i] - m);
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export type RunSet = "treatment" | "neutral" | "noMutation";
export const PRESETS = ["gradient-m3", "spots-m3"] as const;
/** One run's scalars as the record keeps them. */
export interface RunRecord {
  set: RunSet;
  preset: string;
  seed: number;
  dir: string;
  [k: string]: unknown;
}
export interface MeasureSpec { name: string; scalar: string; flag: string | null; higher: "treatment" | "neutral" }
export const MEASURES: readonly MeasureSpec[] = [
  { name: "tmrca95", scalar: "tmrca95Median2", flag: "flaggedTmrca", higher: "neutral" },
  { name: "mutantSweeps", scalar: "mutantSweeps", flag: "flaggedSweeps", higher: "treatment" },
  { name: "grossReplacement", scalar: "grossReplacement2", flag: null, higher: "treatment" },
];
export const COVARIATES = ["meanCells2", "mutationsPer1e5_2"] as const;
export interface EligibilityOptions {
  expected: Record<RunSet, Record<string, number>>;
  /** Seeds of each preset's neutral runs used for the splits (replay-calib 1001–1020). */
  splitSeeds: [number, number];
  splitSeed: number;
  nSplits: number;
  effectBar: number;
  flagBar: number;
  splitBar: number;
  rhoBar: number;
}
export const ELIGIBILITY: EligibilityOptions = {
  expected: { treatment: { "gradient-m3": 20, "spots-m3": 10 }, neutral: { "gradient-m3": 40, "spots-m3": 30 }, noMutation: { "gradient-m3": 20, "spots-m3": 10 } },
  splitSeeds: [1001, 1020],
  splitSeed: 4_500_101,
  nSplits: 1000,
  effectBar: 0.8,
  flagBar: 0.1,
  splitBar: 0.1,
  rhoBar: 0.9,
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Rule 4's test for one split: A takes the treatment role. Rejects when A is shifted in the treatment's expected
 * direction (higher for "treatment", lower for "neutral") at one-sided α = 0.05.
 */
export const splitRejects = (A: number[], B: number[], higher: MeasureSpec["higher"]): boolean =>
  (higher === "treatment" ? mannWhitney(A, B) : mannWhitney(B, A)).pGreater < 0.05;
export const binomialUpperBound = (k: number, n: number) => 1 - binomialLowerBound(n - k, n);

/** Rules 1–5 of the note for each measure; `eligible` is true, false, or "incomplete" (a required run or value is missing). */
export function eligibility(records: readonly RunRecord[], o: EligibilityOptions = ELIGIBILITY) {
  const of = (set: RunSet, preset?: string) => records.filter((r) => r.set === set && (!preset || r.preset === preset));
  const counts = Object.fromEntries((["treatment", "neutral", "noMutation"] as const).map((s) => [s, Object.fromEntries(PRESETS.map((p) => [p, of(s, p).length]))]));
  const complete = (["treatment", "neutral", "noMutation"] as const).every((s) => PRESETS.every((p) => counts[s][p] === o.expected[s][p]));
  const neutralN = PRESETS.reduce((s, p) => s + o.expected.neutral[p], 0);
  const out: Record<string, unknown> = {};
  const eligible: Record<string, boolean | "incomplete"> = {};
  for (const m of MEASURES) {
    const vals = (rs: RunRecord[]) => rs.map((r) => num(r[m.scalar]));
    // A run that is not complete (extinct, truncated, a census missing) makes every measure incomplete (the note's policy).
    const have = [...of("treatment"), ...of("neutral")].every((r) => num(r[m.scalar]) !== null) && records.every((r) => r.complete !== false);
    const sep: Record<string, number | null> = {}, sanity: Record<string, Record<string, number | null>> = {}, descr: Record<string, unknown> = {};
    let sepOk = true, sanityOk = true;
    for (const p of PRESETS) {
      const T = vals(of("treatment", p)).filter((v): v is number => v !== null), N = vals(of("neutral", p)).filter((v): v is number => v !== null);
      const e = T.length && N.length ? (m.higher === "treatment" ? mannWhitney(T, N) : mannWhitney(N, T)).effect : null;
      sep[p] = e;
      if (e === null || e < o.effectBar) sepOk = false;
      sanity[p] = {};
      const nr = of("neutral", p).filter((r) => num(r[m.scalar]) !== null);
      for (const c of COVARIATES) {
        const pairs = nr.filter((r) => num(r[c]) !== null);
        const rho = spearman(pairs.map((r) => num(r[m.scalar])!), pairs.map((r) => num(r[c])!));
        sanity[p][c] = rho;
        if (rho !== null && Math.abs(rho) >= o.rhoBar) sanityOk = false;
      }
      const tr = of("treatment", p).filter((r) => num(r[m.scalar]) !== null);
      descr[p] = {
        treatmentMedian: median(T),
        neutralMedian: median(N),
        noMutationMedian: median(vals(of("noMutation", p)).filter((v): v is number => v !== null)),
        treatmentRho: Object.fromEntries(COVARIATES.map((c) => {
          const pairs = tr.filter((r) => num(r[c]) !== null);
          return [c, spearman(pairs.map((r) => num(r[m.scalar])!), pairs.map((r) => num(r[c])!))];
        })),
      };
    }
    let flags: { flagged: number; of: number; upper95: number | null; passes: boolean } | null = null;
    if (m.flag) {
      const xs = of("neutral").filter((r) => typeof r[m.flag!] === "boolean");
      const f = xs.filter((r) => r[m.flag!] === true).length;
      const upper = xs.length ? binomialUpperBound(f, xs.length) : null;
      flags = { flagged: f, of: xs.length, upper95: upper, passes: xs.length === neutralN && upper !== null && upper < o.flagBar };
    }
    const r = rng(o.splitSeed);
    const splits: Record<string, number | null> = {};
    for (const p of PRESETS) {
      const xs = of("neutral", p).filter((x) => x.seed >= o.splitSeeds[0] && x.seed <= o.splitSeeds[1] && num(x[m.scalar]) !== null).map((x) => num(x[m.scalar])!);
      if (xs.length !== o.splitSeeds[1] - o.splitSeeds[0] + 1) {
        splits[p] = null;
        continue;
      }
      const h = xs.length / 2;
      let rej = 0;
      for (let b = 0; b < o.nSplits; b++) {
        const idx = xs.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        const A = idx.slice(0, h).map((i) => xs[i]), B = idx.slice(h).map((i) => xs[i]);
        if (splitRejects(A, B, m.higher)) rej++;
      }
      splits[p] = rej / o.nSplits;
    }
    const splitsOk = PRESETS.every((p) => splits[p] !== null && splits[p]! <= o.splitBar);
    const covariateEffects = Object.fromEntries(
      PRESETS.map((p) => [p, Object.fromEntries(COVARIATES.map((c) => {
        const T = of("treatment", p).map((x) => num(x[c])).filter((v): v is number => v !== null), N = of("neutral", p).map((x) => num(x[c])).filter((v): v is number => v !== null);
        return [c, T.length && N.length ? mannWhitney(T, N).effect : null];
      }))]),
    );
    const rules = { complete: complete && have, separation: sepOk, nullFlags: flags ? flags.passes : null, splits: splitsOk, sanity: sanityOk };
    eligible[m.name] = !rules.complete ? "incomplete" : rules.separation && (rules.nullFlags ?? true) && rules.splits && rules.sanity;
    out[m.name] = { scalar: m.scalar, flag: m.flag, higher: m.higher, rules, separation: sep, nullFlags: flags, splits, sanity, covariateEffects, descriptive: descr };
  }
  return { counts, complete, incompleteRuns: records.filter((r) => r.complete === false).map((r) => r.dir), eligible, measures: out };
}
