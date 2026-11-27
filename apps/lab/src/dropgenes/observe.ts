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
  /**
   * Each daughter's copies at the last census, from the split to the delayed read, at which its uid existed
   * and had not merged with another compartment since the split (null: never seen unmerged). Unlike `delayed`
   * this is filled for daughters that are gone by the delayed read, so it does not condition on surviving.
   */
  readonly lastSeen?: (number[] | null)[];
  readonly lastSeenStep?: number[];
  /**
   * true for a daughter that merged with another compartment between its split and its delayed read, as
   * either part: the larger part (it kept its uid; if it is still there at the delayed read its
   * delayedStatus is 'fused', if it has dissolved by then it is 'gone') or the smaller part (its uid ended
   * there; delayedStatus 'gone'). This flag tells a merged daughter from one that dissolved as itself.
   */
  readonly merged?: boolean[];
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

/**
 * LINKED2. A compartment the tracker saw end (nothing overlaps it at the next census): what it held at its last
 * census. Inferred from censuses, so "missing" means no copy on the compartment's tiles at a census, single or
 * linked when the tracker is given gene copies; a gene lost and regained between two censuses is not seen.
 */
export interface DeathRecord {
  /** The census at which it was gone. */
  readonly step: number;
  /** The census before: its last. */
  readonly lastSeen: number;
  readonly uid: number;
  readonly bornStep: number;
  readonly area: number;
  /** Copies per species at its last census. */
  readonly copies: number[];
  /**
   * Per essential gene: -1 when the gene was present at the last census; otherwise the first census of the
   * unbroken run of censuses, up to the last, at which the compartment (or, at its birth, its parent) lacked it.
   */
  readonly missingSince: number[];
}

export interface TrackerOptions {
  readonly wallMin?: number; // wall fraction, default 0.125
  readonly bareMax?: number; // wall fraction at or below which a tile is bare, default 0.03 (the kernel's gateLo)
  readonly minArea?: number; // tiles, default 3
  readonly completeMin?: number; // copies, default 1
  readonly maxFissionRecords?: number; // default 20000
  readonly heredityDelay?: number; // steps after a split at which daughters are read again, default 500
  /** Ladder worlds: levels per gene (species = genes * levels). `complete` then uses ladderComplete. */
  readonly ladderLevels?: number;
  readonly ladderNeutral?: boolean;
  readonly maxDeathRecords?: number; // default 50000 (LINKED2: see DeathRecord)
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
  private readonly ladderLevels: number;
  private readonly ladderNeutral: boolean;
  /** uids that ended by being absorbed into another compartment (the smaller part of a fusion). */
  private readonly absorbedUids = new Set<number>();
  // ---- LINKED2 (begin): which genes a compartment lacked when it ended. Additions only; nothing above reads them. ----
  /** One record per observed death (the same events `totals.deaths` counts), up to `maxDeathRecords`. */
  readonly deathRecords: DeathRecord[] = [];
  private readonly maxDeathRecords: number;
  private prevStep = 0;
  /** uid -> per gene, the first census of the unbroken run of censuses in which the gene was below completeMin (-1: present). */
  private missingSince = new Map<number, number[]>();
  // ---- LINKED2 (end) ----

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
    this.ladderLevels = opts.ladderLevels ?? 0;
    this.ladderNeutral = opts.ladderNeutral ?? false;
    this.maxDeathRecords = opts.maxDeathRecords ?? 50000; // LINKED2
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
            lastSeen: kids.map(() => null),
            lastSeenStep: kids.map(() => -1),
            merged: kids.map(() => false),
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
        if (overlapped && !childrenOf.has(pl)) this.absorbedUids.add(prev[pl - 1].uid);
        if (!overlapped) {
          const dead = prev[pl - 1];
          this.totals.deaths++;
          if (dead.complete) this.totals.deathsComplete++;
          else this.totals.deathsIncomplete++;
          this.totals.lifetimes.push(step - dead.bornStep);
          // LINKED2: the genes it lacked at its last census, and since when.
          if (this.deathRecords.length < this.maxDeathRecords) {
            const since = this.missingSince.get(dead.uid);
            this.deathRecords.push({
              step,
              lastSeen: this.prevStep,
              uid: dead.uid,
              bornStep: dead.bornStep,
              area: dead.area,
              copies: dead.copies,
              missingSince: since ? since.slice() : new Array<number>(K).fill(-1),
            });
          }
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
      if (this.ladderLevels > 0) complete = ladderComplete(copies[c], K, this.ladderLevels, this.completeMin, this.ladderNeutral);
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
    // Last-seen read (see FissionRecord.lastSeen): every daughter still waiting for its delayed read is looked
    // up by uid at every census. Runs before the delayed read so a daughter read now is also last seen now.
    if (this.pending.length > 0) {
      const seen = new Map<number, Compartment>();
      for (const c of compartments) seen.set(c.uid, c);
      for (const q of this.pending) {
        const found = seen.get(q.uid);
        const fusedSince = (this.lastFusion.get(q.uid) ?? -1) >= q.record.step;
        if (found && !fusedSince && q.record.lastSeen && q.record.lastSeenStep) {
          q.record.lastSeen[q.index] = found.copies;
          q.record.lastSeenStep[q.index] = step;
        }
        if (q.record.merged && ((found && fusedSince) || (!found && this.absorbedUids.has(q.uid)))) q.record.merged[q.index] = true;
      }
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
    // ---- LINKED2 (begin): per compartment, since which census each gene has been missing ----
    // A compartment born at this census by a split starts from its parent's record, so a gene the parent already
    // lacked keeps its date. A gene that comes back (copies hop in) clears its date.
    {
      const next = new Map<number, number[]>();
      for (const c of compartments) {
        const before = this.missingSince.get(c.uid) ?? (c.bornStep === step && c.parentUid !== 0 ? this.missingSince.get(c.parentUid) : undefined);
        const z = new Array<number>(K);
        for (let k = 0; k < K; k++) z[k] = c.copies[k] >= this.completeMin ? -1 : before && before[k] >= 0 ? before[k] : step;
        next.set(c.uid, z);
      }
      this.missingSince = next;
      this.prevStep = step;
    }
    // ---- LINKED2 (end) ----
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

// ---- Ladder (heritable trait) readouts; docs/droplet-genes-trait-2026-11-21/PLAN.md ---------------------------
// Species layout in a ladder world: copies[k * levels + v] is gene k at level v.

/** Copies at each level, summed over genes. */
export function ladderLevelCounts(copies: readonly number[], genes: number, levels: number): number[] {
  const out = new Array<number>(levels).fill(0);
  for (let k = 0; k < genes; k++) for (let v = 0; v < levels; v++) out[v] += copies[k * levels + v];
  return out;
}

/** Copy-weighted mean level over every gene (null if there are no copies). */
export function ladderMeanLevel(copies: readonly number[], genes: number, levels: number): number | null {
  let tot = 0;
  let sum = 0;
  for (let k = 0; k < genes; k++) {
    for (let v = 0; v < levels; v++) {
      const c = copies[k * levels + v];
      tot += c;
      sum += c * v;
    }
  }
  return tot > 0 ? sum / tot : null;
}

/** Share of the copies that are at the top level, the parasite end (null if there are no copies). */
export function ladderTopShare(copies: readonly number[], genes: number, levels: number): number | null {
  let tot = 0;
  let top = 0;
  for (let k = 0; k < genes; k++) {
    for (let v = 0; v < levels; v++) tot += copies[k * levels + v];
    top += copies[k * levels + levels - 1];
  }
  return tot > 0 ? top / tot : null;
}

/** Share of gene 0 (all its levels) among all copies (null if there are none). */
export function ladderGene0Share(copies: readonly number[], genes: number, levels: number): number | null {
  let tot = 0;
  let g0 = 0;
  for (let k = 0; k < genes; k++) {
    for (let v = 0; v < levels; v++) {
      tot += copies[k * levels + v];
      if (k === 0) g0 += copies[v];
    }
  }
  return tot > 0 ? g0 / tot : null;
}

/**
 * A ladder compartment is complete when every gene has at least `completeMin` copies that function: any level
 * below the top one (the top level has function 0). In the neutral twin every level functions.
 */
export function ladderComplete(copies: readonly number[], genes: number, levels: number, completeMin: number, neutral: boolean): boolean {
  if (genes <= 0) return false;
  const working = neutral ? levels : levels - 1;
  for (let k = 0; k < genes; k++) {
    let n = 0;
    for (let v = 0; v < working; v++) n += copies[k * levels + v];
    if (n < completeMin) return false;
  }
  return true;
}

export interface LastSeenHeredityReadout extends HeredityReadout {
  /** Daughters whose delayed read was made / that were gone by then, with a last-seen trait and a parent trait. */
  readonly read: number;
  readonly gone: number;
  /**
   * Left out: merged with another compartment (as either part, whether or not it was still there at the
   * delayed read), still pending at the end of the run, or no trait defined. `merged` is the merged ones.
   */
  readonly leftOut: number;
  readonly merged: number;
  /** Survivor bias, shown directly. Mean parent trait of the daughters that were read, and of those gone. */
  readonly parentTraitRead: number | null;
  readonly parentTraitGone: number | null;
  /** Mean trait of the daughter at the split census, for the daughters that were read, and for those gone. */
  readonly splitTraitRead: number | null;
  readonly splitTraitGone: number | null;
  /** Mean trait when last seen, for the daughters that were gone by the delayed read. */
  readonly lastTraitGone: number | null;
}

/**
 * Parent to daughter resemblance that does not condition on the daughter surviving the delay: each daughter
 * is scored by the copies it held when last seen unmerged, up to the delayed read. A daughter that lasted the
 * delay contributes its delayed read; one that dissolved contributes its last census. Daughters that merged
 * with another compartment at any time before the delayed read (as either part) and unresolved ('pending')
 * ones are left out and counted. The parent and control correlations are over the same daughters, as in
 * `heredity`.
 */
export function heredityLastSeen(records: readonly FissionRecord[], trait: (copies: number[]) => number | null): LastSeenHeredityReadout {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  let read = 0;
  let gone = 0;
  let leftOut = 0;
  let merged = 0;
  const isMerged = (r: FissionRecord, i: number) => r.delayedStatus[i] === 'fused' || (r.merged !== undefined && r.merged[i] === true);
  const pRead: number[] = [];
  const pGone: number[] = [];
  const sRead: number[] = [];
  const sGone: number[] = [];
  const lGone: number[] = [];
  for (const r of records) {
    const pv = trait(r.parent);
    r.delayedStatus.forEach((st, i) => {
      const last = r.lastSeen ? r.lastSeen[i] : null;
      const lv = last ? trait(last) : null;
      if (isMerged(r, i)) merged++;
      if ((st !== 'read' && st !== 'gone') || isMerged(r, i) || pv === null || lv === null) {
        leftOut++;
        return;
      }
      const sv = trait(r.daughters[i]);
      if (st === 'read') {
        read++;
        pRead.push(pv);
        if (sv !== null) sRead.push(sv);
      } else {
        gone++;
        pGone.push(pv);
        if (sv !== null) sGone.push(sv);
        lGone.push(lv);
      }
    });
  }
  const usable = (r: FissionRecord) => r.delayedStatus.map((st, i) => ((st === 'read' || st === 'gone') && !isMerged(r, i) && r.lastSeen ? r.lastSeen[i] : null));
  return {
    ...correlate(records, trait, usable),
    read,
    gone,
    leftOut,
    merged,
    parentTraitRead: mean(pRead),
    parentTraitGone: mean(pGone),
    splitTraitRead: mean(sRead),
    splitTraitGone: mean(sGone),
    lastTraitGone: mean(lGone),
  };
}

export interface ResponseReadout {
  /** Compartments at the start of the window with a defined trait. */
  readonly n: number;
  /**
   * Mean number of descendants of a start compartment: compartments at the end of the window that descend from
   * it and hold at least one copy (0 = line gone). A descendant with no copies has no level and cannot make
   * wall; it is not counted, here or in zEnd, so both Price terms are over the same descendants.
   */
  readonly meanW: number;
  /** Covariance, over the start compartments, of the trait with that number of descendants (population form). */
  readonly cov: number | null;
  /** cov / meanW: the change in the mean trait due to which compartments left descendants (Price's first term). */
  readonly between: number | null;
  /** Mean trait of the start compartments, and of the end compartments that descend from them. */
  readonly zStart: number | null;
  readonly zEnd: number | null;
  /** zEnd - zStart - between: the change inside lines of descent (Price's second term). */
  readonly within: number | null;
  /** End compartments with no ancestor at the start by tracker id (tracking misses), not in the figures above. */
  readonly orphans: number;
  /** End compartments that descend from a start compartment but hold no copies, not in the figures above. */
  readonly traitless: number;
}

/**
 * Response check over one window. Each compartment at the start is one unit; its descendants are the
 * compartments at the end that trace back to it by tracker id (a fission's other daughters carry their
 * parent's uid as parentUid). A compartment absorbed by a fusion loses its line to the one that absorbed it.
 * Compartments are weighted equally, not by copies. With descendants defined as above,
 * zEnd - zStart = between + within exactly (Price's equation with compartments as the units).
 */
export class DescentWindow {
  private readonly ancestor = new Map<number, number>();
  private readonly startTrait = new Map<number, number>();

  constructor(start: Census, private readonly trait: (copies: number[]) => number | null) {
    for (const c of start.compartments) {
      this.ancestor.set(c.uid, c.uid);
      const z = trait(c.copies);
      if (z !== null) this.startTrait.set(c.uid, z);
    }
  }

  /** Call at every census after the start, in order. */
  update(census: Census): void {
    for (const c of census.compartments) {
      if (this.ancestor.has(c.uid)) continue;
      const a = this.ancestor.get(c.parentUid);
      if (a !== undefined) this.ancestor.set(c.uid, a);
    }
  }

  /** Call with the last census of the window (after update). */
  finish(end: Census): ResponseReadout {
    const w = new Map<number, number>();
    for (const uid of this.startTrait.keys()) w.set(uid, 0);
    let orphans = 0;
    let traitless = 0;
    let zEndSum = 0;
    let zEndN = 0;
    for (const c of end.compartments) {
      const a = this.ancestor.get(c.uid);
      if (a === undefined) {
        orphans++;
        continue;
      }
      if (!w.has(a)) continue; // its ancestor had no trait at the start
      const z = this.trait(c.copies);
      if (z === null) {
        traitless++;
        continue;
      }
      w.set(a, (w.get(a) ?? 0) + 1);
      zEndSum += z;
      zEndN++;
    }
    const n = this.startTrait.size;
    if (n === 0) return { n: 0, meanW: 0, cov: null, between: null, zStart: null, zEnd: null, within: null, orphans, traitless };
    let mz = 0;
    let mw = 0;
    for (const [uid, z] of this.startTrait) {
      mz += z;
      mw += w.get(uid) ?? 0;
    }
    mz /= n;
    mw /= n;
    let cov = 0;
    for (const [uid, z] of this.startTrait) cov += (z - mz) * ((w.get(uid) ?? 0) - mw);
    cov /= n;
    const between = mw > 0 ? cov / mw : null;
    const zEnd = zEndN > 0 ? zEndSum / zEndN : null;
    return { n, meanW: mw, cov, between, zStart: mz, zEnd, within: between !== null && zEnd !== null ? zEnd - mz - between : null, orphans, traitless };
  }
}

// ---- LINKED (begin): readouts for linked templates (docs/droplet-genes-linked-2026-11-21/PLAN.md) ----
// Additions only. `L` is the kernel's linked-template array: L[tile * 2^genes + mask] molecules, bit k = gene k.

/**
 * Per-tile copies in the layout of T (stride genes + 1), with a gene counted wherever it sits: column k is the
 * single copies of gene k plus the linked templates that carry it; the parasite column is copied. Give this to
 * CompartmentTracker.observe in place of T and every count it reports is in gene copies (units of matter).
 */
export function geneCopiesWithLinked(T: Uint32Array, L: Uint32Array, genes: number, out?: Uint32Array): Uint32Array {
  const S = genes + 1;
  const M = 1 << genes;
  const n = T.length / S;
  if (L.length !== n * M) throw new Error(`geneCopiesWithLinked: L has ${L.length} entries, expected ${n * M}`);
  const G = out ?? new Uint32Array(T.length);
  G.set(T);
  for (let i = 0; i < n; i++) {
    const lb = i * M;
    const gb = i * S;
    for (let m = 3; m < M; m++) {
      const c = L[lb + m];
      if (c === 0) continue;
      for (let k = 0; k < genes; k++) if ((m >>> k) & 1) G[gb + k] += c;
    }
  }
  return G;
}

/** Raw counts over a whole arena (or summed over several censuses). The parasite is not counted anywhere here. */
export interface LinkedCounts {
  /** Gene-carrying template molecules by the number of genes they carry: byLength[len - 1]; singles first. */
  byLength: number[];
  /** Per gene: its copies that sit in linked templates (two or more genes). */
  linkedCopies: number[];
  /** Per gene: all its copies, single and linked. */
  allCopies: number[];
}

export function linkedCounts(T: Uint32Array, L: Uint32Array, genes: number): LinkedCounts {
  const S = genes + 1;
  const M = 1 << genes;
  const n = T.length / S;
  if (L.length !== n * M) throw new Error(`linkedCounts: L has ${L.length} entries, expected ${n * M}`);
  const byLength = new Array<number>(genes).fill(0);
  const linkedCopies = new Array<number>(genes).fill(0);
  const allCopies = new Array<number>(genes).fill(0);
  const len = new Uint8Array(M);
  for (let m = 1; m < M; m++) len[m] = len[m >>> 1] + (m & 1);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < genes; k++) {
      const t = T[i * S + k];
      byLength[0] += t;
      allCopies[k] += t;
    }
    const lb = i * M;
    for (let m = 3; m < M; m++) {
      const c = L[lb + m];
      if (c === 0) continue;
      if (len[m] < 2) throw new Error(`linkedCounts: a single gene (mask ${m}) is stored as a linked template`);
      byLength[len[m] - 1] += c;
      for (let k = 0; k < genes; k++) {
        if ((m >>> k) & 1) {
          linkedCopies[k] += c;
          allCopies[k] += c;
        }
      }
    }
  }
  return { byLength, linkedCopies, allCopies };
}

export function addLinkedCounts(into: LinkedCounts, more: LinkedCounts): void {
  for (let i = 0; i < into.byLength.length; i++) into.byLength[i] += more.byLength[i];
  for (let k = 0; k < into.linkedCopies.length; k++) {
    into.linkedCopies[k] += more.linkedCopies[k];
    into.allCopies[k] += more.allCopies[k];
  }
}

export interface LinkedReadout {
  /** Per gene: the share of its copies that sit in linked templates (null when the gene has no copy). */
  readonly linkedShare: (number | null)[];
  /** Mean number of genes per gene-carrying template molecule, a single copy counting as 1 (null when there is none). */
  readonly meanLength: number | null;
  /** Of the linked templates (two or more genes): the share that carry fewer than every gene (null when there is none). */
  readonly shortenedShare: number | null;
  /** Of all gene-carrying template molecules: the share that carry every gene. */
  readonly fullShare: number | null;
  /** Molecules by genes carried, byLength[len - 1]. With counts summed over censuses these are sums, not means. */
  readonly byLength: number[];
}

export function linkedReadout(c: LinkedCounts): LinkedReadout {
  const K = c.byLength.length;
  let molecules = 0;
  let matter = 0;
  let linked = 0;
  for (let i = 0; i < K; i++) {
    molecules += c.byLength[i];
    matter += c.byLength[i] * (i + 1);
    if (i >= 1) linked += c.byLength[i];
  }
  const full = K >= 2 ? c.byLength[K - 1] : 0;
  return {
    linkedShare: c.allCopies.map((all, k) => (all > 0 ? c.linkedCopies[k] / all : null)),
    meanLength: molecules > 0 ? matter / molecules : null,
    shortenedShare: linked > 0 ? (linked - full) / linked : null,
    fullShare: molecules > 0 ? full / molecules : null,
    byLength: c.byLength.slice(),
  };
}
// ---- LINKED (end) ----

// ---- LINKED2 (begin): readout of the death records (docs/droplet-genes-linked2-2026-11-21/PLAN.md) ----

export interface DeathReadout {
  /** Death records read (the tracker keeps at most `maxDeathRecords`; compare with totals.deaths). */
  readonly records: number;
  /** Deaths with at least one essential gene missing at the compartment's last census. */
  readonly withMissing: number;
  /** Per gene: deaths at which that gene was missing at the last census. A death can count for several genes. */
  readonly missingByGene: number[];
  /** Deaths by the number of genes missing at the last census: byMissingCount[n], n = 0..genes. */
  readonly byMissingCount: number[];
  /**
   * Over deaths with a gene missing: steps from the first census at which a still-missing gene was missing to the
   * census at which the compartment was gone (the longest such span of the death). Median, and the share of these
   * deaths where it is more than one census interval, that is where the gene was seen missing at two censuses or more.
   */
  readonly medianMissingSteps: number | null;
  readonly missingAtTwoCensusesShare: number | null;
}

export function deathReadout(records: readonly DeathRecord[], genes: number): DeathReadout {
  const missingByGene = new Array<number>(genes).fill(0);
  const byMissingCount = new Array<number>(genes + 1).fill(0);
  const spans: number[] = [];
  let twoCensuses = 0;
  for (const r of records) {
    let n = 0;
    let first = Infinity;
    for (let k = 0; k < genes; k++) {
      if (r.missingSince[k] < 0) continue;
      n++;
      missingByGene[k]++;
      if (r.missingSince[k] < first) first = r.missingSince[k];
    }
    byMissingCount[n]++;
    if (n > 0) {
      spans.push(r.step - first);
      if (first < r.lastSeen) twoCensuses++;
    }
  }
  spans.sort((a, b) => a - b);
  return {
    records: records.length,
    withMissing: spans.length,
    missingByGene,
    byMissingCount,
    medianMissingSteps: spans.length ? spans[spans.length >> 1] : null,
    missingAtTwoCensusesShare: spans.length ? twoCensuses / spans.length : null,
  };
}
// ---- LINKED2 (end) ----
