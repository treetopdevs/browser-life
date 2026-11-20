/**
 * The viewer's read-only observer. It composes the library OligomerObserver (census
 * rows) and keeps its own per-tile feed/secondary cleave counters (private in the
 * library observer) and live running totals. It never writes to the world.
 */

import { NUM_WALL_SPECIES } from './chem.ts';
import type { OligomerWorld, StepObserver } from './model.ts';
import { type CensusRow, OligomerObserver } from './observe.ts';

export class RingBuffer<T> {
  readonly capacity: number;
  private readonly buf: (T | undefined)[];
  private head = 0;
  private count = 0;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }
  get length(): number {
    return this.count;
  }
  push(v: T): void {
    this.buf[(this.head + this.count) % this.capacity] = v;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }
  /** i = 0 is the oldest kept item. */
  at(i: number): T {
    return this.buf[(this.head + i) % this.capacity] as T;
  }
  toArray(): T[] {
    const a: T[] = [];
    for (let i = 0; i < this.count; i++) a.push(this.at(i));
    return a;
  }
  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}

export const CENSUS_EVERY = 200;
export const DECAY_EVERY = 64;
/** Leader changes are counted only from this step on, like the pilot's last 20,000 steps; before that the six founders are still settling. */
export const SETTLE_STEPS = 20000;

export interface ViewerTotals {
  divisions: number;
  deathsStarve: number;
  deathsLyse: number;
  lyseEvents: number;
  feedCleaves: number;
  secCleaves: number;
}

export function badgeState(res0: number, res1: number): { ok: boolean; text: string; label: string } {
  const ok = res0 === 0 && res1 === 0;
  return { ok, text: `res ${res0}, ${res1}`, label: ok ? 'balanced' : 'NOT 0' };
}

export class ViewerObserver implements StepObserver {
  readonly census: OligomerObserver;
  readonly feed: Int32Array;
  readonly sec: Int32Array;
  readonly ring = new RingBuffer<CensusRow>(200);
  readonly totals: ViewerTotals = { divisions: 0, deathsStarve: 0, deathsLyse: 0, lyseEvents: 0, feedCleaves: 0, secCleaves: 0 };
  readonly lyseByWall = new Int32Array(NUM_WALL_SPECIES);
  private readonly feedstocks: Set<number>;
  private lastLeader = -1;
  private switches = 0;

  constructor(world: OligomerWorld) {
    this.census = new OligomerObserver(world);
    this.feed = new Int32Array(world.nTiles);
    this.sec = new Int32Array(world.nTiles);
    this.feedstocks = new Set(world.cfg.feedstocks);
  }

  onCleave(tile: number, spId: number, count: number): void {
    if (this.feedstocks.has(spId)) {
      this.feed[tile] += count;
      this.totals.feedCleaves += count;
    } else {
      this.sec[tile] += count;
      this.totals.secCleaves += count;
    }
    this.census.onCleave(tile, spId, count);
  }

  onLyse(attacker: number, victim: number, wallIndex: number, count: number): void {
    this.totals.lyseEvents += count;
    this.lyseByWall[wallIndex] += count;
    this.census.onLyse(attacker, victim, wallIndex, count);
  }

  onDivide(parent: number, child: number): void {
    this.totals.divisions += 1;
    this.feed[child] = 0;
    this.sec[child] = 0;
    this.census.onDivide(parent, child);
  }

  onDeath(tile: number, byLysis: boolean): void {
    if (byLysis) this.totals.deathsLyse += 1;
    else this.totals.deathsStarve += 1;
    this.feed[tile] = 0;
    this.sec[tile] = 0;
    this.census.onDeath(tile, byLysis);
  }

  onSwap(a: number, b: number): void {
    const f = this.feed[a];
    this.feed[a] = this.feed[b];
    this.feed[b] = f;
    const s = this.sec[a];
    this.sec[a] = this.sec[b];
    this.sec[b] = s;
    this.census.onSwap(a, b);
  }

  /** Call after each world.step(viewer): halves the per-tile counters every 64 steps (window about 128). */
  endStep(step: number): void {
    if (step % DECAY_EVERY !== 0) return;
    for (let i = 0; i < this.feed.length; i++) {
      this.feed[i] >>= 1;
      this.sec[i] >>= 1;
    }
  }

  sampleCensus(world: OligomerWorld): CensusRow {
    const row = this.census.sample(world);
    this.ring.push(row);
    if (row.step >= SETTLE_STEPS && row.dominantWall >= 0) {
      if (this.lastLeader >= 0 && row.dominantWall !== this.lastLeader) this.switches++;
      this.lastLeader = row.dominantWall;
    }
    // the library observer keeps every row; the viewer has its own bounded ring, so drop the old ones
    if (this.census.rows.length > this.ring.capacity) this.census.rows.splice(0, this.census.rows.length - this.ring.capacity);
    return row;
  }

  residuals(world: OligomerWorld): { res0: number; res1: number } {
    const t = world.monomerTotals();
    return { res0: t.n0 - world.initN0, res1: t.n1 - world.initN1 };
  }

  /** Leader changes from step SETTLE_STEPS on, seen at census cadence (founder settling is not counted). */
  leaderChanges(): number {
    return this.switches;
  }
}
