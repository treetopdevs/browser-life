// Streaming sampler for movies: one frame in memory at a time. The only state carried between frames is the class
// tally and a ring of the last max(lags) class sets. Nothing here reads a run bundle.
import { canonicalKey, type Conn } from "./grammar.ts";
import { segment } from "./segment.ts";
import { ConstructionService } from "./construct.ts";
import { PROTOCOL } from "./protocol.ts";
import { rat, type Rat } from "./readouts.ts";

export interface MovieReadouts {
  seg: { conn: Conn; tau: number };
  frames: number;
  objectsPerFrame: Rat | null;
  largeCellShare: Rat | null;
  spansCellShare: Rat | null;
  largeObjects: number; spansObjects: number;
  classesT: number; classesD4: number;
  maxCopies: number; copyExcess: number;
  persistence: Record<string, Rat | null>;
  /**
   * Exact construction length for classes with 2 <= n <= exactMaxN, weighted by occurrences. Objects whose solve was not
   * exact (budget exhausted, fallback bound) are counted in inexactObjects and left out of the ratio.
   */
  construction: { reuseRatio: Rat | null; scoredObjects: number; unscoredObjects: number; inexactObjects: number };
}

export class StreamObserver {
  private held = 0;
  maxHeld = 0;
  private frames = 0;
  private objects = 0;
  private occupied = 0;
  private largeCells = 0;
  private spansCells = 0;
  private large = 0;
  private spans = 0;
  private maxCopies = 0;
  private copyExcess = 0;
  /** T class key -> total occurrences over the movie. */
  private tally = new Map<string, { n: number; count: number }>();
  private d4 = new Set<string>();
  private ring: Set<string>[] = [];
  private pnum: Record<number, number> = {};
  private pden: Record<number, number> = {};

  private readonly w: number;
  private readonly h: number;
  private readonly seg: { conn: Conn; tau: number };
  private readonly lags: readonly number[];

  constructor(w: number, h: number, seg: { conn: Conn; tau: number }, lags: readonly number[]) {
    this.w = w; this.h = h; this.seg = seg; this.lags = lags;
    for (const l of lags) { this.pnum[l] = 0; this.pden[l] = 0; }
  }

  /** Frames currently referenced by the observer (0 between pushes, 1 during one). */
  retainedFrames(): number { return this.held; }
  /** Length of the class-set ring; bounded by max(lags) however long the movie is. */
  ringLength(): number { return this.ring.length; }

  push(frame: Uint8Array): void {
    this.held++;
    if (this.held > this.maxHeld) this.maxHeld = this.held;
    const objs = segment(frame, this.w, this.h, this.seg);
    this.frames++;
    const set = new Set<string>();
    const counts = new Map<string, number>();
    for (const o of objs) {
      this.occupied += o.n;
      if (o.spans) { this.spans++; this.spansCells += o.n; continue; }
      this.objects++;
      if (o.n > PROTOCOL.objMaxN) { this.large++; this.largeCells += o.n; continue; }
      const k = o.cells.join(",");
      set.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      const e = this.tally.get(k);
      if (e) e.count++; else {
        this.tally.set(k, { n: o.n, count: 1 });
        this.d4.add(canonicalKey(o.cells, "D4"));
      }
    }
    for (const c of counts.values()) { if (c > this.maxCopies) this.maxCopies = c; this.copyExcess += c - 1; }
    // persistence: this frame against each earlier frame in the ring
    for (const l of this.lags) {
      const past = this.ring[this.ring.length - l];
      if (!past) continue;
      let inter = 0;
      for (const k of past) if (set.has(k)) inter++;
      this.pnum[l] += inter; this.pden[l] += past.size;
    }
    this.ring.push(set);
    if (this.ring.length > Math.max(...this.lags)) this.ring.shift();
    this.held--;
  }

  finish(svc: ConstructionService): MovieReadouts {
    let sumA = 0, sumNm1 = 0, scored = 0, unscored = 0, inexact = 0;
    for (const [k, e] of this.tally) {
      if (e.n < 2) continue;
      if (e.n > PROTOCOL.exactMaxN) { unscored += e.count; continue; }
      const cells = k.split(",").map(Number);
      const ans = svc.solve(cells, this.seg.conn);
      if (ans.status !== "exact") { inexact += e.count; continue; }
      sumA += ans.a * e.count;
      sumNm1 += (e.n - 1) * e.count;
      scored += e.count;
    }
    const persistence: Record<string, Rat | null> = {};
    for (const l of this.lags) persistence[String(l)] = this.pden[l] ? rat(this.pnum[l], this.pden[l]) : null;
    return {
      seg: this.seg, frames: this.frames,
      objectsPerFrame: this.frames ? rat(this.objects, this.frames) : null,
      largeCellShare: this.occupied ? rat(this.largeCells, this.occupied) : null,
      spansCellShare: this.occupied ? rat(this.spansCells, this.occupied) : null,
      largeObjects: this.large, spansObjects: this.spans,
      classesT: this.tally.size, classesD4: this.d4.size,
      maxCopies: this.maxCopies, copyExcess: this.copyExcess,
      persistence,
      construction: { reuseRatio: sumNm1 > 0 ? rat(sumA, sumNm1) : null, scoredObjects: scored, unscoredObjects: unscored, inexactObjects: inexact },
    };
  }
}

/** Feed a lazy frame source to one observer per stride (frame k goes to stride s iff k mod s = 0). The source is read once. */
export function observeMovie(frames: Iterable<Uint8Array>, w: number, h: number, seg: { conn: Conn; tau: number }, strides: readonly number[], lags: readonly number[], svc: ConstructionService): Record<string, MovieReadouts> {
  const obs = strides.map((s) => new StreamObserver(w, h, seg, lags));
  let k = 0;
  for (const f of frames) {
    strides.forEach((s, i) => { if (k % s === 0) obs[i].push(f); });
    k++;
  }
  return Object.fromEntries(strides.map((s, i) => [String(s), obs[i].finish(svc)]));
}
