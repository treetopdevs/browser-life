/**
 * SPOT6: what is kept per frame beside the B2CHECK tracker's own output, because frames are not stored.
 *
 * Fed the labelled frame that `ObjectTracker.observe` returns (objects carry the tracker's ids). Pure: no Deno
 * or browser API, so vitest can import it. Nothing here feeds back into the kernel.
 *
 * - `series`: every `seriesEvery` steps, each object's id, area, own-type wall and own-type phage on its tiles.
 * - `ends`: for each id that disappears, those three numbers over its last frames (up to `history` of them).
 * - `births`: for each id that appears: whether it sits on the last footprint of a same-type object that ended
 *   earlier in this window (a body that dipped under the counting rule and came back, or two bodies that were
 *   bridged and came apart again); which object held those tiles at the window's first frame; which other
 *   objects of its type it is joined to by total wall (all types summed) of 0.20 or more (a patch cut in two by
 *   another type's wall, not by water); and whether, 500 steps on, it stands apart from the object it split
 *   from at the low-wall level of 0.05 (two lobes whose neck wobbles round 0.20 do not).
 */

import type { Labelled } from '../b2check/observe.ts';
import { labelTotalWall, LOW_THRESH, MOTIFS, OBJECT_THRESH } from '../b2check/observe.ts';

export interface SeriesFrame {
  readonly t: number;
  readonly uid: number[];
  readonly area: number[];
  /** Own-type wall on the object's tiles, in matter units (1024 = one full tile). */
  readonly mass: number[];
  /** Own-type phage on the object's tiles, in matter units. */
  readonly phage: number[];
}

export interface EndTrace {
  readonly uid: number;
  /** Step of the first frame at which the id was gone. */
  readonly t: number;
  /** The last frames before the end, oldest first; the last entry is the final frame the id was present. */
  readonly area: number[];
  readonly mass: number[];
  readonly phage: number[];
}

export interface BirthNote {
  readonly uid: number;
  readonly t: number;
  /** The ended same-type id whose last footprint holds most of the new object's tiles (0: none since the window began). */
  readonly of: number;
  /** Steps between that id's end and this appearance (0: the same frame). */
  readonly gap: number;
  /** Share of the new object's tiles inside that footprint. */
  readonly share: number;
  /** Ids of the other objects of the same type in the same connected patch of total wall >= 0.20 at this frame. */
  readonly mates: number[];
  /**
   * The same three numbers for the object that kept the id this one split from (the same-type object of the
   * previous frame sharing most tiles with it), read on that object's tiles at this frame. When two bodies are
   * bridged and come apart again, the larger part keeps the id and may be the one on the absorbed body's
   * footprint. null if this object overlapped no same-type object one frame earlier, or that id is gone.
   */
  readonly keeper: { readonly uid: number; readonly of: number; readonly gap: number; readonly share: number } | null;
  /** The same-type object that held most of this object's tiles at the window's first frame, and the share of its tiles that object held (uid 0: none). */
  readonly atStart: { readonly uid: number; readonly share: number };
  /**
   * `apartAfter` steps after this object appeared: it and the object it split from (`keeper.uid`) lie in
   * different connected patches of total wall >= 0.05. null if there was no such object, either id was gone by
   * then, or the window ended first.
   */
  apartLow: boolean | null;
}

export interface BodyLogResult {
  readonly seriesEvery: number;
  readonly history: number;
  readonly apartAfter: number;
  readonly series: SeriesFrame[];
  readonly ends: EndTrace[];
  readonly births: BirthNote[];
}

export interface BodyLogOptions {
  readonly seriesEvery?: number;
  readonly history?: number;
  readonly apartAfter?: number;
}

interface Trace {
  area: number[];
  mass: number[];
  phage: number[];
  motif: number;
  tiles: Int32Array;
}

export class BodyLog {
  private readonly n: number;
  private readonly seriesEvery: number;
  private readonly history: number;
  private readonly apartAfter: number;
  private readonly series: SeriesFrame[] = [];
  private readonly ends: EndTrace[] = [];
  private readonly births: BirthNote[] = [];
  private traces = new Map<number, Trace>();
  /** Per wall type and tile: the id of the last object that ended there, and the step it ended. */
  private readonly endedUid: Int32Array;
  private readonly endedStep: Int32Array;
  private firstStep = -1;
  private prev: Labelled | null = null;
  private start: Labelled | null = null;
  private pending: { note: BirthNote; parent: number; due: number }[] = [];

  constructor(private readonly width: number, private readonly height: number, opts: BodyLogOptions = {}) {
    this.n = width * height;
    this.seriesEvery = opts.seriesEvery ?? 50;
    this.history = opts.history ?? 20;
    this.apartAfter = opts.apartAfter ?? 500;
    this.endedUid = new Int32Array(MOTIFS * this.n);
    this.endedStep = new Int32Array(MOTIFS * this.n).fill(-1);
  }

  observe(step: number, frame: Labelled, W: Uint32Array, P: Uint32Array): void {
    const first = this.firstStep < 0;
    if (first) {
      this.firstStep = step;
      this.start = frame;
    }
    const next = new Map<number, Trace>();
    const take = (step - this.firstStep) % this.seriesEvery === 0;
    const row: SeriesFrame | null = take ? { t: step, uid: [], area: [], mass: [], phage: [] } : null;
    const fresh: { uid: number; motif: number; tiles: Int32Array }[] = [];
    for (const o of frame.objects) {
      let phage = 0;
      let mass = 0;
      for (let q = 0; q < o.tiles.length; q++) {
        const k = o.tiles[q] * MOTIFS + o.motif;
        mass += W[k];
        phage += P[k];
      }
      let tr = this.traces.get(o.uid);
      if (!tr) {
        tr = { area: [], mass: [], phage: [], motif: o.motif, tiles: o.tiles };
        if (!first) fresh.push({ uid: o.uid, motif: o.motif, tiles: o.tiles });
      }
      tr.area.push(o.area);
      tr.mass.push(mass);
      tr.phage.push(phage);
      if (tr.area.length > this.history) {
        tr.area.shift();
        tr.mass.shift();
        tr.phage.shift();
      }
      tr.tiles = o.tiles;
      next.set(o.uid, tr);
      if (row) {
        row.uid.push(o.uid);
        row.area.push(o.area);
        row.mass.push(mass);
        row.phage.push(phage);
      }
    }
    // Ids present one frame ago and gone now: keep their last frames and stamp their last footprint.
    for (const [uid, tr] of this.traces) {
      if (next.has(uid)) continue;
      this.ends.push({ uid, t: step, area: tr.area, mass: tr.mass, phage: tr.phage });
      const off = tr.motif * this.n;
      for (let q = 0; q < tr.tiles.length; q++) {
        this.endedUid[off + tr.tiles[q]] = uid;
        this.endedStep[off + tr.tiles[q]] = step;
      }
    }
    // New ids, noted after the stamping so an object that replaces one in the same frame is a return with gap 0.
    if (fresh.length > 0) {
      const blind = labelTotalWall(W, this.width, this.height, OBJECT_THRESH, 1).comp;
      const inPatch = new Map<number, number[]>();
      for (const o of frame.objects) {
        const k = blind[o.tiles[0]] * MOTIFS + o.motif;
        const list = inPatch.get(k);
        if (list) list.push(o.uid);
        else inPatch.set(k, [o.uid]);
      }
      const byUid = new Map<number, Int32Array>();
      for (const o of frame.objects) byUid.set(o.uid, o.tiles);
      const start = this.start as Labelled;
      for (const o of fresh) {
        const mates = (inPatch.get(blind[o.tiles[0]] * MOTIFS + o.motif) ?? []).filter((u) => u !== o.uid);
        // The previous-frame object of this type sharing most tiles (ties to the lower label, as the tracker does).
        let keeper: BirthNote['keeper'] = null;
        if (this.prev) {
          const shared = new Map<number, number>();
          const off = o.motif * this.n;
          for (let q = 0; q < o.tiles.length; q++) {
            const pl = this.prev.labels[off + o.tiles[q]];
            if (pl !== 0) shared.set(pl, (shared.get(pl) ?? 0) + 1);
          }
          let best = 0;
          let bestN = 0;
          for (const [pl, k] of shared) if (k > bestN || (k === bestN && pl < best)) { best = pl; bestN = k; }
          if (best !== 0) {
            const uid = this.prev.objects[best - 1].uid;
            const tiles = byUid.get(uid);
            if (tiles) keeper = { uid, ...this.linkReturn(step, o.motif, tiles) };
          }
        }
        // Who held these tiles at the window's first frame.
        const held = new Map<number, number>();
        const off0 = o.motif * this.n;
        for (let q = 0; q < o.tiles.length; q++) {
          const sl = start.labels[off0 + o.tiles[q]];
          if (sl !== 0) held.set(sl, (held.get(sl) ?? 0) + 1);
        }
        let startBest = 0;
        let startN = 0;
        for (const [sl, k] of held) if (k > startN || (k === startN && sl < startBest)) { startBest = sl; startN = k; }
        const atStart = { uid: startBest !== 0 ? start.objects[startBest - 1].uid : 0, share: startN / o.tiles.length };
        const note: BirthNote = { uid: o.uid, t: step, ...this.linkReturn(step, o.motif, o.tiles), mates, keeper, atStart, apartLow: null };
        this.births.push(note);
        if (keeper) this.pending.push({ note, parent: keeper.uid, due: step + this.apartAfter });
      }
    }
    // Births whose low-wall separation is due at this frame.
    if (this.pending.length > 0 && this.pending[0].due <= step) {
      let low: Int32Array | null = null;
      const tilesOf = new Map<number, Int32Array>();
      for (const o of frame.objects) tilesOf.set(o.uid, o.tiles);
      const rest: typeof this.pending = [];
      for (const q of this.pending) {
        if (q.due > step) {
          rest.push(q);
          continue;
        }
        if (q.due < step) continue; // no frame fell on its step: left unread
        const mine = tilesOf.get(q.note.uid);
        const theirs = tilesOf.get(q.parent);
        if (!mine || !theirs) continue;
        low ??= labelTotalWall(W, this.width, this.height, LOW_THRESH, 1).comp;
        q.note.apartLow = low[mine[0]] !== low[theirs[0]];
      }
      this.pending = rest;
    }
    if (row) this.series.push(row);
    this.traces = next;
    this.prev = frame;
  }

  private linkReturn(step: number, motif: number, tiles: Int32Array): { of: number; gap: number; share: number } {
    const off = motif * this.n;
    const votes = new Map<number, { n: number; at: number }>();
    for (let q = 0; q < tiles.length; q++) {
      const at = this.endedStep[off + tiles[q]];
      if (at < 0) continue;
      const id = this.endedUid[off + tiles[q]];
      const v = votes.get(id);
      if (v) v.n++;
      else votes.set(id, { n: 1, at });
    }
    let best = 0;
    let bestN = 0;
    let bestAt = step;
    for (const [id, v] of votes) {
      if (v.n > bestN || (v.n === bestN && id < best)) {
        best = id;
        bestN = v.n;
        bestAt = v.at;
      }
    }
    return { of: best, gap: step - bestAt, share: bestN / tiles.length };
  }

  finish(): BodyLogResult {
    return { seriesEvery: this.seriesEvery, history: this.history, apartAfter: this.apartAfter, series: this.series, ends: this.ends, births: this.births };
  }
}
