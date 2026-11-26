/**
 * Observer for the B2 compartment check. Nothing here feeds back into the kernel, and nothing here uses a
 * Deno or browser API, so vitest can import it.
 *
 * An object is exactly what the confirmation counted (`observeFindDroplets(W, w, h, 0.20)`): for one wall type,
 * a 4-connected patch (torus) of tiles whose wall of that type is at least 205 of 1024, with at least 3 tiles.
 * The tracker follows objects between frames by tile overlap within one wall type. Its fissions, fusions,
 * fades and type switches are inferences from overlap, not events the kernel knows about.
 *
 * 'absorbed' means: the object kept no id, and at least one of its tiles is now inside an object that kept
 * another id. That is any overlap, not all of its tiles (a departure from PLAN.md's wording, stated in
 * RESULT.md), so an object that mostly faded while touching a neighbour is read as absorbed by it.
 */

export const MOTIFS = 6;
export const SCALE = 1024;
/** Math.round(0.20 * 1024): the threshold the confirmation runner passed to observeFindDroplets. */
export const OBJECT_THRESH = 205;
export const OBJECT_MIN_AREA = 3;
/** Total wall (all types) below this is "low wall": 0.05 of a tile. */
export const LOW_THRESH = 51;

export type BirthKind = 'initial' | 'fission' | 'switch' | 'denovo';
export type EndKind = 'fade' | 'absorbed' | 'switch';

export interface FrameObject {
  uid: number;
  readonly motif: number;
  readonly area: number;
  readonly mass: number;
  readonly cx: number;
  readonly cy: number;
  /** Largest own-type wall on one tile of the object. */
  readonly peak: number;
  readonly tiles: Int32Array;
}

export interface Labelled {
  /** labels[m * n + i]: 1-based index into `objects` for wall type m at tile i, 0 if none. */
  readonly labels: Int32Array;
  readonly objects: FrameObject[];
}

/** The confirmation's droplet rule, with the tiles of each object kept. */
export function labelObjects(W: Uint32Array, width: number, height: number, thresh = OBJECT_THRESH, minArea = OBJECT_MIN_AREA): Labelled {
  const n = width * height;
  const labels = new Int32Array(MOTIFS * n);
  const queue = new Int32Array(n);
  const objects: FrameObject[] = [];
  for (let m = 0; m < MOTIFS; m++) {
    const off = m * n;
    for (let start = 0; start < n; start++) {
      if (labels[off + start] !== 0 || W[start * MOTIFS + m] < thresh) continue;
      const id = objects.length + 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      labels[off + start] = id;
      let mass = 0;
      let peak = 0;
      let sxC = 0;
      let sxS = 0;
      let syC = 0;
      let syS = 0;
      while (head < tail) {
        const i = queue[head++];
        const wm = W[i * MOTIFS + m];
        mass += wm;
        if (wm > peak) peak = wm;
        const x = i % width;
        const y = (i / width) | 0;
        const ax = (2 * Math.PI * x) / width;
        const ay = (2 * Math.PI * y) / height;
        sxC += Math.cos(ax) * wm;
        sxS += Math.sin(ax) * wm;
        syC += Math.cos(ay) * wm;
        syS += Math.sin(ay) * wm;
        const e = y * width + (x + 1 < width ? x + 1 : 0);
        const w = y * width + (x > 0 ? x - 1 : width - 1);
        const s = (y + 1 < height ? y + 1 : 0) * width + x;
        const nn = (y > 0 ? y - 1 : height - 1) * width + x;
        if (labels[off + e] === 0 && W[e * MOTIFS + m] >= thresh) { labels[off + e] = id; queue[tail++] = e; }
        if (labels[off + w] === 0 && W[w * MOTIFS + m] >= thresh) { labels[off + w] = id; queue[tail++] = w; }
        if (labels[off + s] === 0 && W[s * MOTIFS + m] >= thresh) { labels[off + s] = id; queue[tail++] = s; }
        if (labels[off + nn] === 0 && W[nn * MOTIFS + m] >= thresh) { labels[off + nn] = id; queue[tail++] = nn; }
      }
      if (tail < minArea) {
        // Too small to be an object. Mark the tiles visited (-1) so they are not searched again.
        for (let q = 0; q < tail; q++) labels[off + queue[q]] = -1;
        continue;
      }
      let cx = (Math.atan2(sxS, sxC) / (2 * Math.PI)) * width;
      if (cx < 0) cx += width;
      let cy = (Math.atan2(syS, syC) / (2 * Math.PI)) * height;
      if (cy < 0) cy += height;
      objects.push({ uid: 0, motif: m, area: tail, mass, cx, cy, peak, tiles: queue.slice(0, tail) });
    }
  }
  for (let k = 0; k < labels.length; k++) if (labels[k] < 0) labels[k] = 0;
  return { labels, objects };
}

/** Connected patches of total wall (all types summed) at or above `thresh`. comp[i] is 1-based, 0 if none. */
export function labelTotalWall(W: Uint32Array, width: number, height: number, thresh: number, minArea = OBJECT_MIN_AREA): { comp: Int32Array; areas: number[]; above: number } {
  const n = width * height;
  const tot = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let m = 0; m < MOTIFS; m++) s += W[i * MOTIFS + m];
    tot[i] = s;
  }
  const comp = new Int32Array(n);
  const queue = new Int32Array(n);
  const areas: number[] = [0];
  let above = 0;
  for (let start = 0; start < n; start++) {
    if (comp[start] !== 0 || tot[start] < thresh) continue;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    comp[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i / width) | 0;
      const nb = [
        y * width + (x + 1 < width ? x + 1 : 0),
        y * width + (x > 0 ? x - 1 : width - 1),
        (y + 1 < height ? y + 1 : 0) * width + x,
        (y > 0 ? y - 1 : height - 1) * width + x,
      ];
      for (const j of nb) if (comp[j] === 0 && tot[j] >= thresh) { comp[j] = id; queue[tail++] = j; }
    }
    above += tail;
    if (tail < minArea) {
      for (let q = 0; q < tail; q++) comp[queue[q]] = -1;
    } else {
      areas.push(tail);
    }
  }
  for (let i = 0; i < n; i++) if (comp[i] < 0) comp[i] = 0;
  return { comp, areas, above };
}

export function torusDist(ax: number, ay: number, bx: number, by: number, w: number, h: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > w / 2) dx = w - dx;
  let dy = Math.abs(ay - by);
  if (dy > h / 2) dy = h - dy;
  return Math.hypot(dx, dy);
}

export interface UidRecord {
  uid: number;
  motif: number;
  born: number;
  birth: BirthKind;
  /** Parent by overlap: for a fission the object it split from, for a switch the other-type object it replaced. 0 if none. */
  parent: number;
  /** Step of the first frame at which the object was gone. null: still present at the last frame. */
  end: number | null;
  endKind: EndKind | null;
  /** For 'absorbed': the uid of the object that took its tiles. */
  into: number;
  frames: number;
  areaSum: number;
  maxArea: number;
  maxPeak: number;
}

export interface LagReadout {
  readonly lag: number;
  /** The same uid is present `lag` steps later. */
  alive: boolean;
  /** Torus distance between the two centroids, in tiles. null if the uid is gone. */
  disp: number | null;
  /** Share of the object's tiles at t that are inside the same uid at t + lag (0 if the uid is gone). */
  keepUid: number;
  /** Share of the object's tiles at t whose own-type wall is at or above the threshold at t + lag (no tracking used). */
  keepMask: number;
  /** Share of all tiles whose wall of this type is at or above the threshold at t + lag (the chance level of keepMask). */
  chance: number;
}

export interface Sample {
  readonly t: number;
  readonly uid: number;
  readonly motif: number;
  readonly area: number;
  readonly age: number;
  readonly cx: number;
  readonly cy: number;
  /** Peak and mean own-type wall on the object's tiles, as a fraction of a tile. */
  readonly peak: number;
  readonly mean: number;
  /** The tile nearest the mass centroid belongs to the object (false for rings and arcs). */
  readonly solid: boolean;
  /** Share of the tiles at 4-neighbour distance 2 and 3 from the object whose total wall is below LOW_THRESH. */
  readonly moat: number;
  /** No other object lies in the same connected patch of total wall >= LOW_THRESH. */
  readonly isolated: boolean;
  /** Own-type wall as a share of all wall on the object's tiles. */
  readonly purity: number;
  /** Own-type phage on the object's tiles, in matter units. */
  readonly phage: number;
  readonly lags: LagReadout[];
}

export interface CensusRow {
  t: number;
  /** Objects by the confirmation's rule (one count per wall type, summed). */
  drop: number;
  /** Patches of total wall >= OBJECT_THRESH with at least 3 tiles (blind to wall type). */
  dropBlind: number;
  /** Patches of total wall >= LOW_THRESH with at least 3 tiles. */
  lowComps: number;
  /** Largest such patch as a share of all tiles with total wall >= LOW_THRESH. */
  lowLargestShare: number;
  /** Share of all tiles with total wall >= LOW_THRESH. */
  lowCover: number;
  /** Share of all tiles inside an object. */
  cover: number;
  /** Largest single-type wall on any tile, as a fraction of a tile. */
  maxW: number;
  meanArea: number;
}

export interface TrackerOptions {
  readonly thresh?: number;
  readonly minArea?: number;
  /** Steps between sampled censuses. */
  readonly sampleEvery?: number;
  readonly lags?: readonly number[];
}

export interface TrackerResult {
  readonly firstStep: number;
  readonly lastStep: number;
  readonly frames: number;
  readonly records: UidRecord[];
  readonly samples: Sample[];
  readonly census: CensusRow[];
}

interface Pending {
  readonly sample: Sample;
  readonly tiles: Int32Array;
  readonly due: number;
  readonly lagIndex: number;
}

export class ObjectTracker {
  private readonly n: number;
  private readonly thresh: number;
  private readonly minArea: number;
  private readonly sampleEvery: number;
  private readonly lags: readonly number[];
  private prev: Labelled | null = null;
  private nextUid = 1;
  private firstStep = -1;
  private lastStep = -1;
  private frames = 0;
  private readonly records = new Map<number, UidRecord>();
  private readonly samples: Sample[] = [];
  private readonly census: CensusRow[] = [];
  private pending: Pending[] = [];
  private readonly stamp: Int32Array;
  private stampGen = 0;

  constructor(private readonly width: number, private readonly height: number, opts: TrackerOptions = {}) {
    this.n = width * height;
    this.thresh = opts.thresh ?? OBJECT_THRESH;
    this.minArea = opts.minArea ?? OBJECT_MIN_AREA;
    this.sampleEvery = opts.sampleEvery ?? 500;
    this.lags = opts.lags ?? [100, 500, 1000];
    this.stamp = new Int32Array(this.n);
  }

  /** Feed one frame. Frames must be evenly spaced; lags and sampleEvery must be multiples of the spacing. */
  observe(step: number, W: Uint32Array, P: Uint32Array | null = null): Labelled {
    const { n, width, height } = this;
    const cur = labelObjects(W, width, height, this.thresh, this.minArea);
    const prev = this.prev;
    const count = cur.objects.length;
    if (this.firstStep < 0) this.firstStep = step;
    this.lastStep = step;
    this.frames++;

    // Overlap with the previous frame, within one wall type.
    const parents: Map<number, number>[] = cur.objects.map(() => new Map<number, number>());
    if (prev) {
      for (let c = 0; c < count; c++) {
        const o = cur.objects[c];
        const off = o.motif * n;
        const m = parents[c];
        for (let q = 0; q < o.tiles.length; q++) {
          const pl = prev.labels[off + o.tiles[q]];
          if (pl !== 0) m.set(pl, (m.get(pl) ?? 0) + 1);
        }
      }
    }
    // Primary parent: the previous object sharing most tiles (ties to the lower label).
    const primary = new Int32Array(count);
    const childrenOf = new Map<number, number[]>();
    for (let c = 0; c < count; c++) {
      let best = 0;
      let bestN = 0;
      for (const [pl, shared] of parents[c]) {
        if (shared > bestN || (shared === bestN && pl < best)) { best = pl; bestN = shared; }
      }
      primary[c] = best;
      if (best !== 0) {
        const list = childrenOf.get(best);
        if (list) list.push(c);
        else childrenOf.set(best, [c]);
      }
    }
    // The child sharing most tiles with a previous object keeps its uid. The others are fission daughters.
    for (const [pl, kids] of childrenOf) {
      const parent = prev!.objects[pl - 1];
      let keep = kids[0];
      let keepN = -1;
      for (const c of kids) {
        const shared = parents[c].get(pl) ?? 0;
        if (shared > keepN) { keep = c; keepN = shared; }
      }
      for (const c of kids) {
        if (c === keep) cur.objects[c].uid = parent.uid;
        else cur.objects[c].uid = this.newRecord(cur.objects[c].motif, step, 'fission', parent.uid);
      }
    }
    // Objects with no same-type predecessor.
    for (let c = 0; c < count; c++) {
      if (primary[c] !== 0) continue;
      const o = cur.objects[c];
      if (!prev) {
        o.uid = this.newRecord(o.motif, step, 'initial', 0);
        continue;
      }
      // Type switch: at least half of its tiles were inside an object of another type one frame ago.
      const other = new Map<number, number>();
      let inOther = 0;
      for (let q = 0; q < o.tiles.length; q++) {
        const i = o.tiles[q];
        for (let m = 0; m < MOTIFS; m++) {
          if (m === o.motif) continue;
          const pl = prev.labels[m * n + i];
          if (pl !== 0) {
            inOther++;
            other.set(pl, (other.get(pl) ?? 0) + 1);
            break;
          }
        }
      }
      if (2 * inOther >= o.tiles.length) {
        let best = 0;
        let bestN = 0;
        for (const [pl, shared] of other) if (shared > bestN) { best = pl; bestN = shared; }
        o.uid = this.newRecord(o.motif, step, 'switch', prev.objects[best - 1].uid);
      } else {
        o.uid = this.newRecord(o.motif, step, 'denovo', 0);
      }
    }
    // Ends of previous objects.
    if (prev) {
      const absorbedBy = new Map<number, { c: number; shared: number }>();
      for (let c = 0; c < count; c++) {
        for (const [pl, shared] of parents[c]) {
          if (childrenOf.has(pl)) continue;
          const best = absorbedBy.get(pl);
          if (!best || shared > best.shared) absorbedBy.set(pl, { c, shared });
        }
      }
      for (let pl = 1; pl <= prev.objects.length; pl++) {
        if (childrenOf.has(pl)) continue;
        const dead = prev.objects[pl - 1];
        const rec = this.records.get(dead.uid)!;
        rec.end = step;
        const taker = absorbedBy.get(pl);
        if (taker) {
          rec.endKind = 'absorbed';
          rec.into = cur.objects[taker.c].uid;
          continue;
        }
        let inOther = 0;
        for (let q = 0; q < dead.tiles.length; q++) {
          const i = dead.tiles[q];
          for (let m = 0; m < MOTIFS; m++) {
            if (m !== dead.motif && cur.labels[m * n + i] !== 0) { inOther++; break; }
          }
        }
        rec.endKind = 2 * inOther >= dead.tiles.length ? 'switch' : 'fade';
      }
    }
    for (const o of cur.objects) {
      const rec = this.records.get(o.uid)!;
      rec.frames++;
      rec.areaSum += o.area;
      if (o.area > rec.maxArea) rec.maxArea = o.area;
      if (o.peak > rec.maxPeak) rec.maxPeak = o.peak;
    }

    this.resolveLags(step, W, cur);
    if ((step - this.firstStep) % this.sampleEvery === 0) this.takeSamples(step, W, P, cur);
    this.prev = cur;
    return cur;
  }

  private newRecord(motif: number, step: number, birth: BirthKind, parent: number): number {
    const uid = this.nextUid++;
    this.records.set(uid, { uid, motif, born: step, birth, parent, end: null, endKind: null, into: 0, frames: 0, areaSum: 0, maxArea: 0, maxPeak: 0 });
    return uid;
  }

  private resolveLags(step: number, W: Uint32Array, cur: Labelled): void {
    if (this.pending.length === 0) return;
    const { n } = this;
    const byUid = new Map<number, number>();
    cur.objects.forEach((o, k) => byUid.set(o.uid, k + 1));
    const cover = new Float64Array(MOTIFS).fill(-1);
    const rest: Pending[] = [];
    for (const q of this.pending) {
      if (q.due < step) throw new Error(`no frame at step ${q.due}: the frame spacing does not divide the lag ${q.sample.lags[q.lagIndex].lag}`);
      if (q.due > step) {
        rest.push(q);
        continue;
      }
      const s = q.sample;
      const m = s.motif;
      if (cover[m] < 0) {
        let c = 0;
        for (let i = 0; i < n; i++) if (W[i * MOTIFS + m] >= this.thresh) c++;
        cover[m] = c / n;
      }
      const label = byUid.get(s.uid) ?? 0;
      let same = 0;
      let mask = 0;
      for (let k = 0; k < q.tiles.length; k++) {
        const i = q.tiles[k];
        if (label !== 0 && cur.labels[m * n + i] === label) same++;
        if (W[i * MOTIFS + m] >= this.thresh) mask++;
      }
      const r = s.lags[q.lagIndex];
      r.alive = label !== 0;
      r.disp = label !== 0 ? torusDist(s.cx, s.cy, cur.objects[label - 1].cx, cur.objects[label - 1].cy, this.width, this.height) : null;
      r.keepUid = same / q.tiles.length;
      r.keepMask = mask / q.tiles.length;
      r.chance = cover[m];
    }
    this.pending = rest;
  }

  private takeSamples(step: number, W: Uint32Array, P: Uint32Array | null, cur: Labelled): void {
    const { n, width, height } = this;
    const low = labelTotalWall(W, width, height, LOW_THRESH, this.minArea);
    const blind = labelTotalWall(W, width, height, this.thresh, this.minArea);
    const perComp = new Map<number, number>();
    for (const o of cur.objects) {
      const c = low.comp[o.tiles[0]];
      perComp.set(c, (perComp.get(c) ?? 0) + 1);
    }
    let covered = 0;
    let maxW = 0;
    for (let k = 0; k < W.length; k++) if (W[k] > maxW) maxW = W[k];
    for (const o of cur.objects) {
      covered += o.area;
      const off = o.motif * n;
      const label = cur.labels[off + o.tiles[0]];
      // Total wall and own-type phage on the footprint.
      let totWall = 0;
      let phage = 0;
      for (let q = 0; q < o.tiles.length; q++) {
        const base = o.tiles[q] * MOTIFS;
        for (let m = 0; m < MOTIFS; m++) totWall += W[base + m];
        if (P) phage += P[base + o.motif];
      }
      // Moat: tiles at 4-neighbour distance 2 and 3 from the object.
      const gen = ++this.stampGen;
      let frontier: number[] = [];
      for (let q = 0; q < o.tiles.length; q++) { this.stamp[o.tiles[q]] = gen; frontier.push(o.tiles[q]); }
      let shell = 0;
      let shellLow = 0;
      for (let d = 1; d <= 3; d++) {
        const next: number[] = [];
        for (const i of frontier) {
          const x = i % width;
          const y = (i / width) | 0;
          const nb = [
            y * width + (x + 1 < width ? x + 1 : 0),
            y * width + (x > 0 ? x - 1 : width - 1),
            (y + 1 < height ? y + 1 : 0) * width + x,
            (y > 0 ? y - 1 : height - 1) * width + x,
          ];
          for (const j of nb) {
            if (this.stamp[j] === gen) continue;
            this.stamp[j] = gen;
            next.push(j);
            if (d >= 2) {
              let t = 0;
              for (let m = 0; m < MOTIFS; m++) t += W[j * MOTIFS + m];
              shell++;
              if (t < LOW_THRESH) shellLow++;
            }
          }
        }
        frontier = next;
      }
      const ci = (Math.round(o.cy) % height) * width + (Math.round(o.cx) % width);
      const lags: LagReadout[] = this.lags.map((lag) => ({ lag, alive: false, disp: null, keepUid: 0, keepMask: 0, chance: 0 }));
      const sample: Sample = {
        t: step,
        uid: o.uid,
        motif: o.motif,
        area: o.area,
        age: step - this.records.get(o.uid)!.born,
        cx: o.cx,
        cy: o.cy,
        peak: o.peak / SCALE,
        mean: o.mass / o.area / SCALE,
        solid: cur.labels[off + ci] === label,
        moat: shell > 0 ? shellLow / shell : 1,
        isolated: perComp.get(low.comp[o.tiles[0]]) === 1,
        purity: totWall > 0 ? o.mass / totWall : 0,
        phage,
        lags,
      };
      this.samples.push(sample);
      this.lags.forEach((lag, lagIndex) => this.pending.push({ sample, tiles: o.tiles, due: step + lag, lagIndex }));
    }
    let lowLargest = 0;
    for (let k = 1; k < low.areas.length; k++) if (low.areas[k] > lowLargest) lowLargest = low.areas[k];
    this.census.push({
      t: step,
      drop: cur.objects.length,
      dropBlind: blind.areas.length - 1,
      lowComps: low.areas.length - 1,
      lowLargestShare: low.above > 0 ? lowLargest / low.above : 0,
      lowCover: low.above / n,
      cover: covered / n,
      maxW: maxW / SCALE,
      meanArea: cur.objects.length > 0 ? covered / cur.objects.length : 0,
    });
  }

  /** Lag readouts whose time had not come by the last frame are dropped from their samples. */
  finish(): TrackerResult {
    const open = new Set<LagReadout>();
    for (const q of this.pending) open.add(q.sample.lags[q.lagIndex]);
    const samples = this.samples.map((s) => ({ ...s, lags: s.lags.filter((r) => !open.has(r)) }));
    return { firstStep: this.firstStep, lastStep: this.lastStep, frames: this.frames, records: [...this.records.values()], samples, census: this.census };
  }
}
