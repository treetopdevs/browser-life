// Mutation edges as the simulation's ledger reports them: 4 u32 per event (childHi, childLo, parentHi,
// parentLo), 16 bytes each, held sorted by child id. Ledger drains arrive in step order (a child's hi is its
// minting step + 1), so appending each drain sorted keeps the order: a child's parent is a binary search,
// and a lineage's children and descendants are one forward scan from its own birth, since every parent is
// minted before its children.
import { parseKey, type Key } from "./genotype.ts";

export interface EdgeEvent {
  childHi: number;
  childLo: number;
  parentHi: number;
  parentLo: number;
}

const W = 4;

export class MutationEdges {
  private data: Uint32Array;
  private n: number;

  /** From the words of an earlier `words()` (for example a saved file); checked edge by edge. */
  constructor(words?: Uint32Array) {
    if (words && words.length % W) throw new Error(`mutation edges: ${words.length} words is not a whole number of edges`);
    this.data = new Uint32Array(Math.max(1024 * W, words?.length ?? 0));
    this.n = 0;
    if (words) {
      const events: EdgeEvent[] = [];
      for (let o = 0; o < words.length; o += W) events.push({ childHi: words[o], childLo: words[o + 1], parentHi: words[o + 2], parentLo: words[o + 3] });
      this.append(events);
    }
  }

  get length(): number {
    return this.n;
  }

  /**
   * Appends one ledger drain, in child order. Throws, leaving the store unchanged, when an edge names a
   * parent minted no earlier than its child, a child repeats, or the drain reaches back before the edges held.
   */
  append(drain: readonly EdgeEvent[]): void {
    const events = [...drain].sort((a, b) => a.childHi - b.childHi || a.childLo - b.childLo);
    let hi = this.n ? this.data[(this.n - 1) * W] : -1, lo = this.n ? this.data[(this.n - 1) * W + 1] : -1;
    for (const e of events) {
      if (!(e.parentHi < e.childHi)) throw new Error(`mutation edge ${e.childHi}:${e.childLo} names parent ${e.parentHi}:${e.parentLo}, which was not minted before it`);
      if (e.childHi < hi || (e.childHi === hi && e.childLo <= lo)) throw new Error(`mutation edge ${e.childHi}:${e.childLo} does not follow ${hi}:${lo}`);
      hi = e.childHi;
      lo = e.childLo;
    }
    const need = (this.n + events.length) * W;
    if (need > this.data.length) {
      const grown = new Uint32Array(Math.max(need, this.data.length * 2));
      grown.set(this.data.subarray(0, this.n * W));
      this.data = grown;
    }
    for (const e of events) {
      const o = this.n++ * W;
      this.data[o] = e.childHi;
      this.data[o + 1] = e.childLo;
      this.data[o + 2] = e.parentHi;
      this.data[o + 3] = e.parentLo;
    }
  }

  /** Keeps the first `n` edges (a restored checkpoint's). */
  truncate(n: number): void {
    if (!(Number.isSafeInteger(n) && n >= 0 && n <= this.n)) throw new Error(`mutation edges: cannot keep ${n} of ${this.n}`);
    this.n = n;
  }

  /** How many edges were minted by steps before `step`: the edges a world at `step` has produced. */
  countBefore(step: number): number {
    return this.firstAfter(step);
  }

  /** The edges as words, ready to persist. */
  words(): Uint32Array {
    return this.data.slice(0, this.n * W);
  }

  parentOf(key: Key): Key | undefined {
    const [hi, lo] = parseKey(key);
    let a = 0, b = this.n;
    while (a < b) {
      const m = (a + b) >> 1, o = m * W;
      const h = this.data[o], l = this.data[o + 1];
      if (h < hi || (h === hi && l < lo)) a = m + 1;
      else b = m;
    }
    const o = a * W;
    return a < this.n && this.data[o] === hi && this.data[o + 1] === lo ? `${this.data[o + 2]}:${this.data[o + 3]}` : undefined;
  }

  /** Children minted from each of `parents`. */
  childCounts(parents: Iterable<Key>): Map<Key, number> {
    const want = new Set(parents);
    const out = new Map<Key, number>([...want].map((k) => [k, 0]));
    let first = this.n;
    for (const k of want) first = Math.min(first, this.firstAfter(parseKey(k)[0]));
    for (let i = first; i < this.n; i++) {
      const o = i * W, p = `${this.data[o + 2]}:${this.data[o + 3]}`;
      const c = out.get(p);
      if (c !== undefined) out.set(p, c + 1);
    }
    return out;
  }

  /** Every lineage descending from `key` (excluding it). */
  descendants(key: Key): Set<Key> {
    const clade = new Set<Key>([key]);
    for (let i = this.firstAfter(parseKey(key)[0]); i < this.n; i++) {
      const o = i * W;
      if (clade.has(`${this.data[o + 2]}:${this.data[o + 3]}`)) clade.add(`${this.data[o]}:${this.data[o + 1]}`);
    }
    clade.delete(key);
    return clade;
  }

  /** Index of the first edge whose child hi exceeds `hi`. */
  private firstAfter(hi: number): number {
    let a = 0, b = this.n;
    while (a < b) {
      const m = (a + b) >> 1;
      if (this.data[m * W] <= hi) a = m + 1;
      else b = m;
    }
    return a;
  }
}
