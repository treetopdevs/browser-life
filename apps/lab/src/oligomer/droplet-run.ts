/**
 * The droplet run controller: DOM-free, so vitest can drive it with a fake engine. One mutex (a promise
 * chain) covers everything that touches an engine, and a generation counter bumped by every reset makes
 * any result that lands afterwards a no-op.
 */

import type { DropletEngine, EngineMode } from './droplet-engine.ts';
import type { DropletSource } from './droplet-render.ts';
import { observeFindDroplets, observeMotifStats, observeTotalMatter } from './droplets-kernel.ts';
import { RingBuffer } from './viewer-observer.ts';

export const DROPLET_CENSUS_EVERY = 100;
/** Leader changes are sampled on multiples of this many steps ... */
export const LEADER_EVERY = 500;
/** ... from this step on (the six founders are still settling before that) ... */
export const DROPLET_SETTLE = 2000;
/** ... and only while the leader holds at least this share of all wall matter. */
export const LEADER_MIN_SHARE = 0.25;
/** The droplet counter's threshold (the runner and the docs use 0.20, the observer's own default is 0.25). */
export const DROPLET_CORE_FRAC = 0.2;

export interface DropletCensus {
  readonly step: number;
  readonly shares: number[];
  readonly droplets: number;
  readonly hillD1: number;
  readonly dominant: number;
  readonly dominantShare: number;
  readonly phageTotals: number[];
  readonly totalW: number;
}

export function sampleDropletCensus(src: DropletSource, step: number): DropletCensus {
  const W = src.W, P = src.P;
  const st = observeMotifStats(W, P);
  const droplets = observeFindDroplets(W, src.width, src.height, DROPLET_CORE_FRAC).length;
  return { step, shares: st.shares, droplets, hillD1: st.hillD1, dominant: st.dominant, dominantShare: st.dominantShare, phageTotals: st.phageTotals, totalW: st.totalW };
}

export interface LeaderState { last: number; changes: number }
export const newLeaderState = (): LeaderState => ({ last: -1, changes: 0 });

/** Counts a change only on multiples of 500 from step 2,000, while the leader holds at least 25 percent of the wall. */
export function leaderUpdate(s: LeaderState, row: { step: number; dominant: number; dominantShare: number }): void {
  if (row.step % LEADER_EVERY !== 0 || row.step < DROPLET_SETTLE || row.dominant < 0 || row.dominantShare < LEADER_MIN_SHARE) return;
  if (s.last >= 0 && row.dominant !== s.last) s.changes++;
  s.last = row.dominant;
}

/** Exactly one bigint: everything in the dish minus what was there at the start. */
export function dropletResidual(src: DropletSource, init: bigint): bigint {
  return observeTotalMatter(src.A, src.F, src.W, src.P) - init;
}

/** The one seed rule for every reset path: trimmed whole number 0 to 2^31 - 1, else seed 1 (and say so). */
export function parseSeed(raw: string): { seed: number; replaced: boolean } {
  const t = raw.trim();
  const n = t === '' ? NaN : Number(t);
  const replaced = !Number.isInteger(n) || n < 0 || n > 2 ** 31 - 1;
  return { seed: replaced ? 1 : n, replaced };
}

export function dropletBadge(res: bigint): { ok: boolean; text: string; label: string } {
  const ok = res === 0n;
  return { ok, text: ok ? 'res 0' : `res ${res}`, label: ok ? 'balanced' : 'NOT 0' };
}

/** Largest step count that keeps a frame from stepping past the next census boundary. */
export function clipSteps(n: number, step: number): number {
  const next = (Math.floor(step / DROPLET_CENSUS_EVERY) + 1) * DROPLET_CENSUS_EVERY;
  return Math.max(1, Math.min(n, next - step));
}

export interface RunOpts {
  readonly arm: string;
  /** 0 means the default size of whichever engine ends up running */
  readonly size: number;
  readonly seed: number;
  readonly engineMode: EngineMode;
  readonly restarted?: boolean;
}

export interface BuildResult { readonly engine: DropletEngine; readonly text: string }
export type BuildEngine = (opts: RunOpts) => Promise<BuildResult>;

export class DropletSession {
  readonly engine: DropletEngine;
  readonly opts: RunOpts;
  readonly text: string;
  readonly ring = new RingBuffer<DropletCensus>(200);
  readonly leader = newLeaderState();
  latest: DropletCensus;
  res: bigint;
  resStep: number;
  constructor(engine: DropletEngine, opts: RunOpts, text: string) {
    this.engine = engine;
    this.opts = opts;
    this.text = text;
    this.latest = sampleDropletCensus(engine.source, engine.step);
    this.res = dropletResidual(engine.source, engine.initTotalMatter);
    this.resStep = engine.step;
  }
  get step(): number { return this.engine.step; }
  get size(): number { return this.engine.width; }
  get kind(): 'gpu' | 'cpu' { return this.engine.kind; }
}

export class DropletRun {
  gen = 0;
  session: DropletSession | null = null;
  paused = true;
  busy = false;
  /** the options of the last reset, kept for the fallback after a device failure */
  current: RunOpts | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly build: BuildEngine;
  private readonly onChange: () => void;
  private readonly onNotice: (text: string) => void;

  constructor(build: BuildEngine, onChange: () => void = () => {}, onNotice: (text: string) => void = () => {}) {
    this.build = build;
    this.onChange = onChange;
    this.onNotice = onNotice;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.chain.then(fn, fn);
    this.chain = r.then(() => undefined, () => undefined);
    return r;
  }

  /** Unpublishes the old session at once, then rebuilds behind the mutex. A later reset supersedes this one. */
  reset(opts: RunOpts, notice?: string): Promise<void> {
    const mine = ++this.gen;
    const old = this.session;
    this.paused = true;
    this.session = null;
    this.current = opts;
    this.onChange();
    return this.exclusive(async () => {
      if (old) await old.engine.destroy();
      if (mine !== this.gen) return;
      let built: BuildResult;
      try {
        built = await this.build(opts);
      } catch (e) {
        if (mine === this.gen) this.onNotice(`The world could not be built: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (mine !== this.gen) { await built.engine.destroy(); return; }
      this.session = new DropletSession(built.engine, { ...opts, size: built.engine.width }, built.text);
      this.current = this.session.opts;
      if (notice) this.onNotice(notice);
      this.onChange();
    });
  }

  /** Leaving the droplet family: unpublish and free the engine behind the mutex. */
  dispose(): Promise<void> {
    ++this.gen;
    const old = this.session;
    this.paused = true;
    this.session = null;
    return this.exclusive(async () => { if (old) await old.engine.destroy(); });
  }

  /** The graphics card failed or was lost: rebuild the same world on the processor, from step 0. */
  fallback(why: string, device?: GPUDevice): Promise<void> | void {
    const cur = this.current;
    if (!cur) return;
    // A device event only counts for the session it belongs to. While a reset is rebuilding (no session), an event
    // from the superseded device must not replace the options that reset asked for; a failure of the new engine
    // surfaces through its own advance().
    if (device && (!this.session || this.session.engine.device !== device)) return;
    if (!device && this.session?.engine.kind === 'cpu') return;
    return this.reset({ ...cur, size: 0, engineMode: 'cpu', restarted: true }, `The graphics card stopped (${why.slice(0, 120)}). Restarted this world from step 0 on the processor.`);
  }

  setPlaying(play: boolean): void {
    if (play) { if (this.session) this.paused = false; return; }
    this.paused = true;
    // exact matter check on Pause; skipped when nothing is running
    void this.exclusive(async () => {
      const s = this.session, mine = this.gen;
      if (!s || mine !== this.gen) return;
      this.exactCheck(s);
      this.onChange();
    });
  }

  private exactCheck(s: DropletSession): void {
    s.res = dropletResidual(s.engine.source, s.engine.initTotalMatter);
    s.resStep = s.engine.step;
  }

  /** One frame of a playing run. Returns immediately when anything is in flight (frames are skipped, never queued). */
  tryAdvance(n: number, budgetMs?: number): boolean {
    if (this.busy || !this.session || this.paused) return false;
    this.busy = true;
    void this.exclusive(() => this.advanceInner(n, budgetMs, false)).finally(() => { this.busy = false; });
    return true;
  }

  /** Pause, then exactly one step; waits for any frame in flight. */
  stepOnce(): Promise<boolean> {
    if (!this.session) return Promise.resolve(false);
    this.paused = true;
    return this.exclusive(() => this.advanceInner(1, undefined, true));
  }

  private async advanceInner(n: number, budgetMs: number | undefined, exact: boolean): Promise<boolean> {
    const s = this.session, mine = this.gen;
    if (!s) return false;
    let taken = 0;
    try {
      taken = await s.engine.advance(clipSteps(n, s.engine.step), budgetMs);
    } catch (e) {
      if (mine === this.gen && s === this.session && s.engine.kind === 'gpu') void this.fallback(e instanceof Error ? e.message : String(e));
      return false;
    }
    if (mine !== this.gen || s !== this.session || taken === 0) return false;
    const step = s.engine.step;
    if (step % DROPLET_CENSUS_EVERY === 0) {
      const row = sampleDropletCensus(s.engine.source, step);
      s.ring.push(row);
      s.latest = row;
      leaderUpdate(s.leader, row);
      this.exactCheck(s);
    } else if (exact) this.exactCheck(s);
    this.onChange();
    return true;
  }
}
