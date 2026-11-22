/**
 * Observers for the droplet genes sandbox. Nothing here feeds back into the kernel.
 *
 * A compartment is a 4-connected patch of tiles whose wall is at least `wallMin` (inferred, never declared).
 * The tracker follows compartments between censuses by tile overlap. Its fissions, fusions and deaths are
 * inferences from overlap, not events the kernel knows about; `denovo` counts compartments with no overlapping
 * predecessor, which the chemistry cannot produce (wall only grows from wall), so it measures tracking misses.
 */

import { DG_SCALE } from './kernel.ts';

export interface Compartment {
  /** Stable id: kept by the largest-overlap descendant, new for the other daughters of a fission. */
  readonly uid: number;
  readonly parentUid: number;
  readonly bornStep: number;
  readonly area: number;
  readonly wall: number;
  readonly cx: number;
  readonly cy: number;
  /** Copies per species summed over the compartment's tiles (essential genes first, parasite last). */
  readonly copies: number[];
  /** Every essential gene has at least `completeMin` copies. */
  readonly complete: boolean;
}

export interface FissionRecord {
  readonly step: number;
  readonly parentUid: number;
  /** Parent's copies at the census before the split. */
  readonly parent: number[];
  /** Copies of the nearest other compartment at that same census (the "neighbour, not parent" control). */
  readonly neighbour: number[] | null;
  /**
   * Copies of the nearest other compartment that is not a close relative by tracker id: not a daughter, the
   * parent or a sister of the splitting compartment. The nearest neighbour is often such a relative, which
   * makes it resemble the daughters by descent.
   */
  readonly unrelated: number[] | null;
  /** Each daughter's copies at the census after the split. */
  readonly daughters: number[][];
  readonly daughterUids: number[];
  /**
   * Each daughter's copies `heredityDelay` steps after the split, looked up by uid. null: that uid no longer
   * exists then (it died or was absorbed), or the run ended first. Filled in by later censuses.
   */
  readonly delayed: (number[] | null)[];
  /**
   * Why each delayed entry is what it is. 'read': copies recorded. 'gone': the uid no longer existed. 'fused':
   * the uid's holder merged with another compartment at the split census or during the delay, so its copies are a mixture and are not
   * recorded. 'pending': the run ended before the delay passed.
   */
  readonly delayedStatus: ('pending' | 'read' | 'gone' | 'fused')[];
}

export interface Census {
  readonly step: number;
  readonly compartments: Compartment[];
  /** Template copies on tiles outside every compartment (the sum of the three parts below). */
  readonly stranded: number[];
  /** Of those: on bare tiles, wall at or below `bareMax` (the gate is shut on every edge of such a tile). */
  readonly strandedBare: number[];
  /** On halo tiles, wall above `bareMax` and below `wallMin` (copies there still move and feed gene function). */
  readonly strandedHalo: number[];
  /** On tiles with wall at least `wallMin` in patches smaller than `minArea`. */
  readonly strandedSmall: number[];
}

export interface TrackerTotals {
  fissions: number;
  fusions: number;
  deaths: number;
  denovo: number;
  /** Deaths of compartments that were complete at their last census / that were not. */
  deathsComplete: number;
  deathsIncomplete: number;
  /** Age (step - bornStep) at death, observed deaths only: censored, it leaves out the two lists below. */
  lifetimes: number[];
  /** Age of compartments absorbed by a fusion (overlapped only as a non-primary parent). */
  absorbedAges: number[];
}

export interface TrackerOptions {
  readonly wallMin?: number; // wall fraction, default 0.125
  readonly bareMax?: number; // wall fraction at or below which a tile is bare, default 0.03 (the kernel's gateLo)
  readonly minArea?: number; // tiles, default 3
  readonly completeMin?: number; // copies, default 1
  readonly maxFissionRecords?: number; // default 20000
  readonly heredityDelay?: number; // steps after a split at which daughters are read again, default 500
}

export function labelCompartments(
  W: Uint32Array,
  width: number,
  height: number,
  wallMinInt: number,
  minArea: number,
): { labels: Int32Array; areas: number[] } {
  const n = width * height;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const areas: number[] = [0];
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (labels[start] !== 0 || W[start] < wallMinInt) continue;
    const id = ++next;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i / width) | 0;
      const e = y * width + (x + 1 < width ? x + 1 : 0);
      const w = y * width + (x > 0 ? x - 1 : width - 1);
      const s = (y + 1 < height ? y + 1 : 0) * width + x;
      const nn = (y > 0 ? y - 1 : height - 1) * width + x;
      if (labels[e] === 0 && W[e] >= wallMinInt) { labels[e] = id; queue[tail++] = e; }
      if (labels[w] === 0 && W[w] >= wallMinInt) { labels[w] = id; queue[tail++] = w; }
      if (labels[s] === 0 && W[s] >= wallMinInt) { labels[s] = id; queue[tail++] = s; }
      if (labels[nn] === 0 && W[nn] >= wallMinInt) { labels[nn] = id; queue[tail++] = nn; }
    }
    if (tail < minArea) {
      for (let q = 0; q < tail; q++) labels[queue[q]] = -1; // too small: not a compartment
      next--;
    } else {
      areas.push(tail);
    }
  }
  for (let i = 0; i < n; i++) if (labels[i] < 0) labels[i] = 0;
  return { labels, areas };
}

function torusDist2(ax: number, ay: number, bx: number, by: number, w: number, h: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > w / 2) dx = w - dx;
  let dy = Math.abs(ay - by);
  if (dy > h / 2) dy = h - dy;
  return dx * dx + dy * dy;
}

export class CompartmentTracker {
  readonly totals: TrackerTotals = { fissions: 0, fusions: 0, deaths: 0, denovo: 0, deathsComplete: 0, deathsIncomplete: 0, lifetimes: [], absorbedAges: [] };
  readonly fissionRecords: FissionRecord[] = [];
  private prevLabels: Int32Array | null = null;
  private prev: Compartment[] = [];
  private nextUid = 1;
  private readonly wallMinInt: number;
  private readonly bareMaxInt: number;
  private readonly minArea: number;
  private readonly completeMin: number;
  private readonly maxRecords: number;
  private readonly heredityDelay: number;
  private pending: { record: FissionRecord; index: number; uid: number; due: number }[] = [];
  /** uid -> step of the last census at which its holder overlapped two or more previous compartments. */
  private readonly lastFusion = new Map<number, number>();

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly species: number,
    private readonly genes: number,
    opts: TrackerOptions = {},
  ) {
    this.wallMinInt = Math.round((opts.wallMin ?? 0.125) * DG_SCALE);
    this.bareMaxInt = Math.round((opts.bareMax ?? 0.03) * DG_SCALE);
    this.minArea = opts.minArea ?? 3;
    this.completeMin = opts.completeMin ?? 1;
    this.maxRecords = opts.maxFissionRecords ?? 20000;
    this.heredityDelay = opts.heredityDelay ?? 500;
  }

  observe(step: number, W: Uint32Array, T: Uint32Array): Census {
    const { width, height, species: S, genes: K } = this;
    const n = width * height;
    const { labels, areas } = labelCompartments(W, width, height, this.wallMinInt, this.minArea);
    const count = areas.length - 1;

    const wall = new Float64Array(count + 1);
    const sxC = new Float64Array(count + 1);
    const sxS = new Float64Array(count + 1);
    const syC = new Float64Array(count + 1);
    const syS = new Float64Array(count + 1);
    const copies: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(S).fill(0));
    const stranded = new Array<number>(S).fill(0);
    const strandedBare = new Array<number>(S).fill(0);
    const strandedHalo = new Array<number>(S).fill(0);
    const strandedSmall = new Array<number>(S).fill(0);
    for (let i = 0; i < n; i++) {
      const id = labels[i];
      if (id === 0) {
        const part = W[i] <= this.bareMaxInt ? strandedBare : W[i] < this.wallMinInt ? strandedHalo : strandedSmall;
        for (let s = 0; s < S; s++) {
          stranded[s] += T[i * S + s];
          part[s] += T[i * S + s];
        }
        continue;
      }
      const w = W[i];
      wall[id] += w;
      const ax = (2 * Math.PI * (i % width)) / width;
      const ay = (2 * Math.PI * ((i / width) | 0)) / height;
      sxC[id] += Math.cos(ax) * w;
      sxS[id] += Math.sin(ax) * w;
      syC[id] += Math.cos(ay) * w;
      syS[id] += Math.sin(ay) * w;
      const c = copies[id];
      for (let s = 0; s < S; s++) c[s] += T[i * S + s];
    }

    // Overlap with the previous census: overlap[cur][prevIndex] = shared tiles.
    const prev = this.prev;
    const prevLabels = this.prevLabels;
    const curParents: Map<number, number>[] = Array.from({ length: count + 1 }, () => new Map<number, number>());
    if (prevLabels) {
      for (let i = 0; i < n; i++) {
        const c = labels[i];
        const pl = prevLabels[i];
        if (c === 0 || pl === 0) continue;
        const m = curParents[c];
        m.set(pl, (m.get(pl) ?? 0) + 1);
      }
    }
    // Primary parent of each current compartment = the previous compartment it shares most tiles with.
    const primary = new Int32Array(count + 1);
    const childrenOf = new Map<number, number[]>(); // prev label -> current labels whose primary parent it is
    for (let c = 1; c <= count; c++) {
      let best = 0;
      let bestN = 0;
      for (const [pl, shared] of curParents[c]) {
        if (shared > bestN || (shared === bestN && pl < best)) { best = pl; bestN = shared; }
      }
      primary[c] = best;
      if (best !== 0) {
        const list = childrenOf.get(best);
        if (list) list.push(c);
        else childrenOf.set(best, [c]);
      }
    }

    const compartments: Compartment[] = new Array(count);
    const uidOf = new Int32Array(count + 1);
    const parentUidOf = new Int32Array(count + 1);
    const bornOf = new Float64Array(count + 1);
    // Continuation: among a previous compartment's children, the one sharing most tiles keeps its uid.
    for (const [pl, kids] of childrenOf) {
      const parent = prev[pl - 1];
      let keep = kids[0];
      let keepN = -1;
      for (const c of kids) {
        const shared = curParents[c].get(pl) ?? 0;
        if (shared > keepN) { keep = c; keepN = shared; }
      }
      for (const c of kids) {
        if (c === keep) {
          uidOf[c] = parent.uid;
          parentUidOf[c] = parent.parentUid;
          bornOf[c] = parent.bornStep;
        } else {
          uidOf[c] = this.nextUid++;
          parentUidOf[c] = parent.uid;
          bornOf[c] = step;
        }
      }
      if (kids.length >= 2) {
        this.totals.fissions += kids.length - 1;
        if (this.fissionRecords.length < this.maxRecords) {
          let nb: number[] | null = null;
          let nbD = Infinity;
          let un: number[] | null = null;
          let unD = Infinity;
          for (const other of prev) {
            if (other === parent) continue;
            const d = torusDist2(parent.cx, parent.cy, other.cx, other.cy, width, height);
            if (d < nbD) { nbD = d; nb = other.copies; }
            const related =
              other.parentUid === parent.uid ||
              other.uid === parent.parentUid ||
              (parent.parentUid !== 0 && other.parentUid === parent.parentUid);
            if (!related && d < unD) { unD = d; un = other.copies; }
          }
          const record: FissionRecord = {
            step,
            parentUid: parent.uid,
            parent: parent.copies,
            neighbour: nb,
            unrelated: un,
            daughters: kids.map((c) => copies[c]),
            daughterUids: kids.map((c) => uidOf[c]),
            delayed: kids.map(() => null),
            delayedStatus: kids.map(() => 'pending' as const),
          };
          this.fissionRecords.push(record);
          kids.forEach((c, index) => this.pending.push({ record, index, uid: uidOf[c], due: step + this.heredityDelay }));
        }
      }
    }
    for (let c = 1; c <= count; c++) {
      if (primary[c] === 0) {
        uidOf[c] = this.nextUid++;
        parentUidOf[c] = 0;
        bornOf[c] = step;
        if (prevLabels) this.totals.denovo++;
      }
      // A fusion: this compartment overlaps two or more previous compartments.
      if (curParents[c].size >= 2) {
        this.totals.fusions += curParents[c].size - 1;
        this.lastFusion.set(uidOf[c], step);
      }
    }
    if (prevLabels) {
      for (let pl = 1; pl <= prev.length; pl++) {
        // A death: nothing now overlaps this previous compartment. (A previous compartment that only overlaps a
        // current one as a non-primary parent was absorbed by a fusion and is not counted as a death.)
        let overlapped = false;
        for (let c = 1; c <= count && !overlapped; c++) if (curParents[c].has(pl)) overlapped = true;
        if (overlapped && !childrenOf.has(pl)) this.totals.absorbedAges.push(step - prev[pl - 1].bornStep);
        if (!overlapped) {
          const dead = prev[pl - 1];
          this.totals.deaths++;
          if (dead.complete) this.totals.deathsComplete++;
          else this.totals.deathsIncomplete++;
          this.totals.lifetimes.push(step - dead.bornStep);
        }
      }
    }

    for (let c = 1; c <= count; c++) {
      let cx = (Math.atan2(sxS[c], sxC[c]) / (2 * Math.PI)) * width;
      if (cx < 0) cx += width;
      let cy = (Math.atan2(syS[c], syC[c]) / (2 * Math.PI)) * height;
      if (cy < 0) cy += height;
      let complete = K > 0;
      for (let k = 0; k < K; k++) if (copies[c][k] < this.completeMin) complete = false;
      compartments[c - 1] = {
        uid: uidOf[c],
        parentUid: parentUidOf[c],
        bornStep: bornOf[c],
        area: areas[c],
        wall: wall[c],
        cx,
        cy,
        copies: copies[c],
        complete,
      };
    }
    // Delayed heredity read: daughters whose time has come are looked up by uid in this census.
    if (this.pending.length > 0 && this.pending[0].due <= step) {
      const byUid = new Map<number, Compartment>();
      for (const c of compartments) byUid.set(c.uid, c);
      let done = 0;
      while (done < this.pending.length && this.pending[done].due <= step) {
        const q = this.pending[done++];
        const found = byUid.get(q.uid);
        if (!found) {
          q.record.delayedStatus[q.index] = 'gone';
        } else if ((this.lastFusion.get(q.uid) ?? -1) >= q.record.step) {
          // >= : a daughter that overlapped a second compartment in the very census of its split is a mixture too.
          q.record.delayedStatus[q.index] = 'fused';
        } else {
          q.record.delayed[q.index] = found.copies;
          q.record.delayedStatus[q.index] = 'read';
        }
      }
      this.pending.splice(0, done);
    }
    this.prev = compartments;
    this.prevLabels = labels;
    return { step, compartments, stranded, strandedBare, strandedHalo, strandedSmall };
  }
}

/** Pearson correlation, or null when either side has no variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let num = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 1e-12 && vy > 1e-12 ? num / Math.sqrt(vx * vy) : null;
}

/** Share of gene 0 among the essential copies of a compartment (null if it has none). */
export function gene0Share(copies: number[], genes: number): number | null {
  let tot = 0;
  for (let k = 0; k < genes; k++) tot += copies[k];
  return tot > 0 ? copies[0] / tot : null;
}

/** Parasite share of all copies (null if there are none). */
export function parasiteShare(copies: number[], genes: number): number | null {
  let tot = 0;
  for (let s = 0; s <= genes; s++) tot += copies[s];
  return tot > 0 ? copies[genes] / tot : null;
}

export interface HeredityReadout {
  /** Daughters with a defined trait for themselves, their parent and the nearest neighbour (matched triples). */
  readonly pairs: number;
  /** Daughter trait against its parent's trait before the split, over those triples. */
  readonly parentR: number | null;
  /** The same daughters against the parent's nearest neighbour: resemblance that is not through this split. */
  readonly neighbourR: number | null;
  /** The same two figures over the triples whose control is the nearest compartment that is not a close relative. */
  readonly unrelatedPairs: number;
  readonly parentRUnrelatedSet: number | null;
  readonly unrelatedR: number | null;
}

function correlate(
  records: readonly FissionRecord[],
  trait: (copies: number[]) => number | null,
  daughtersOf: (r: FissionRecord) => readonly (number[] | null)[],
): HeredityReadout {
  const d1: number[] = [];
  const p1: number[] = [];
  const n1: number[] = [];
  const d2: number[] = [];
  const p2: number[] = [];
  const u2: number[] = [];
  for (const r of records) {
    const pv = trait(r.parent);
    if (pv === null) continue;
    const nv = r.neighbour ? trait(r.neighbour) : null;
    const uv = r.unrelated ? trait(r.unrelated) : null;
    for (const d of daughtersOf(r)) {
      if (d === null) continue;
      const dv = trait(d);
      if (dv === null) continue;
      if (nv !== null) { d1.push(dv); p1.push(pv); n1.push(nv); }
      if (uv !== null) { d2.push(dv); p2.push(pv); u2.push(uv); }
    }
  }
  return {
    pairs: d1.length,
    parentR: pearson(p1, d1),
    neighbourR: pearson(n1, d1),
    unrelatedPairs: d2.length,
    parentRUnrelatedSet: pearson(p2, d2),
    unrelatedR: pearson(u2, d2),
  };
}

/** Parent-daughter resemblance for one trait over the recorded fissions, daughters read at the next census. */
export function heredity(records: readonly FissionRecord[], trait: (copies: number[]) => number | null): HeredityReadout {
  return correlate(records, trait, (r) => r.daughters);
}

export interface DelayedHeredityReadout extends HeredityReadout {
  /** Delayed entries by outcome (see FissionRecord.delayedStatus). */
  readonly read: number;
  readonly gone: number;
  readonly fused: number;
  readonly pending: number;
}

/**
 * The same resemblance, with each daughter read `heredityDelay` steps after the split instead of at the next
 * census. A template copy lasts about 1 / kDecT steps, so at a delay of several lifetimes the daughter's copies
 * are copies of copies. The daughter is followed by tracker id: when it splits again the id stays with the
 * fragment that overlaps it most, and a daughter that merged with another compartment during the delay is
 * left out ('fused'). A correlation here says the trait persisted along the lineage; it does not by itself
 * separate copying inside the compartment from exchange with close neighbours, which is what the neighbour
 * and unrelated-neighbour controls are for.
 */
export function heredityDelayed(records: readonly FissionRecord[], trait: (copies: number[]) => number | null): DelayedHeredityReadout {
  const counts = { read: 0, gone: 0, fused: 0, pending: 0 };
  for (const r of records) for (const st of r.delayedStatus) counts[st]++;
  return { ...correlate(records, trait, (r) => r.delayed), ...counts };
}
