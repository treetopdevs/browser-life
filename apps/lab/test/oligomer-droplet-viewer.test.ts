import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CpuDropletEngine,
  ENGINE_PACES,
  ENGINE_SIZES,
  type DropletEngine,
  GpuDropletEngine,
  type SimLike,
  createEngine,
} from '../src/oligomer/droplet-engine.ts';
import { dropletInspectRows, dropletTileSpeech } from '../src/oligomer/droplet-inspect.ts';
import {
  DROPLET_CORE,
  DROPLET_EDGE,
  DROPLET_FULL,
  type DropletSource,
  PHAGE_HOST_DIM,
  SnapshotHolder,
  dominantMotif,
  dropletBufferSize,
  dropletPatternColour,
  dropletSourceOfRef,
  dropletSub,
  renderDropletChem,
  renderDropletPattern,
  renderDropletPhage,
  dropletRampScale,
} from '../src/oligomer/droplet-render.ts';
import {
  DROPLET_SETTLE,
  DropletRun,
  type RunOpts,
  clipSteps,
  dropletBadge,
  dropletResidual,
  leaderUpdate,
  newLeaderState,
  parseSeed,
  sampleDropletCensus,
} from '../src/oligomer/droplet-run.ts';
import {
  DROPLET_ARM_IDS,
  DROPLET_WORLD_OPTIONS,
  PHAGE_RUN_DEFAULTS,
  armById,
  buildDropletWorld,
  describeDropletArm,
  phageArms,
  seedPhageArena,
} from '../src/oligomer/droplet-worlds.ts';
import {
  DropletKernelRef,
  KERNEL_MOTIFS,
  defaultDropletKernelConfig,
  observeDigest,
  observeFindDroplets,
  observeMotifStats,
  observeTotalMatter,
} from '../src/oligomer/droplets-kernel.ts';
import type { DropletGpuSnapshot } from '../src/oligomer/droplets-gpu.ts';
import { BG, BRIGHT_FLOOR, WALL_PALETTE, contrastRatio, labDistance, rampScale } from '../src/oligomer/render.ts';
import { RingBuffer } from '../src/oligomer/viewer-observer.ts';
import { CONDITIONS } from '../src/oligomer/worlds.ts';

const SIZE = 24;
const copyOf = (s: DropletSource) => ({ A: s.A.slice(), F: s.F.slice(), W: s.W.slice(), P: s.P.slice() });

/** Run the whole read path of the droplet viewer once. */
function readEverything(src: DropletSource, ref: DropletKernelRef, tile: number): void {
  const px = new Uint8ClampedArray(src.width * src.height * 8 * 8 * 4);
  renderDropletPattern(src, px);
  renderDropletPhage(src, px, 8);
  renderDropletChem(src, px, 'food', 64);
  renderDropletChem(src, px, 'waste', 64);
  sampleDropletCensus(src, ref.stepCount);
  dropletResidual(src, ref.initTotalMatter);
  dropletInspectRows(src, tile);
  dropletTileSpeech(src, tile);
}

describe('droplet viewer purity', () => {
  for (const arm of DROPLET_ARM_IDS) {
    it(`reading every step changes nothing (${arm}): digest and full state equal at every step`, () => {
      const hot = { kInfect: 0.34, kDecayP: 0.02, diffP: 0.22, mutPhage: 0.001, mutMotif: 0.001 };
      const a = buildDropletWorld(arm, SIZE, 3, hot).ref, b = buildDropletWorld(arm, SIZE, 3, hot).ref;
      const src = dropletSourceOfRef(b);
      for (let t = 0; t < 120; t++) {
        a.step(); b.step();
        readEverything(src, b, t % (SIZE * SIZE));
        expect(observeDigest(b.A, b.F, b.W, b.P)).toBe(observeDigest(a.A, a.F, a.W, a.P));
        if (t % 20 === 0) { expect(b.A).toEqual(a.A); expect(b.F).toEqual(a.F); expect(b.W).toEqual(a.W); expect(b.P).toEqual(a.P); }
      }
    });
  }

  it('the comparison can fail: a reader that writes changes the digest (negative control)', () => {
    const a = buildDropletWorld('PHAGE', SIZE, 3).ref, b = buildDropletWorld('PHAGE', SIZE, 3).ref;
    const src = dropletSourceOfRef(b);
    for (let t = 0; t < 5; t++) { a.step(); b.step(); src.A[0]++; }
    expect(observeDigest(b.A, b.F, b.W, b.P)).not.toBe(observeDigest(a.A, a.F, a.W, a.P));
  });
});

describe('stale buffers', () => {
  it('the ref source follows the swapped arrays, with and without motif mutation', () => {
    for (const mut of [0, 0.5]) {
      const cfg = defaultDropletKernelConfig({ width: 16, height: 16, seed: 1, mutMotif: mut });
      const ref = new DropletKernelRef(cfg);
      ref.seedDroplet(8, 8, 3, 0, 0.85);
      const s = dropletSourceOfRef(ref), firstW = ref.W, firstA = ref.A;
      let swapped = false;
      for (let k = 1; k <= 6; k++) {
        ref.step();
        expect(s.A).toBe(ref.A); expect(s.F).toBe(ref.F); expect(s.W).toBe(ref.W); expect(s.P).toBe(ref.P);
        if (k % 2 === 1 && ref.A !== firstA) swapped = true;
      }
      expect(swapped).toBe(true);
      void firstW;
    }
  });

  it('rendering after odd and even step counts equals rendering a frozen copy', () => {
    const { ref } = buildDropletWorld('PHAGE', 16, 2, { ...PHAGE_RUN_DEFAULTS, mutPhage: 0.01, mutMotif: 0.01 });
    const live = dropletSourceOfRef(ref), n = 16 * 16 * 8 * 8 * 4;
    for (const count of [1, 2, 3, 4, 7, 8]) {
      while (ref.stepCount < count) ref.step();
      const c = copyOf(live), frozen: DropletSource = { width: 16, height: 16, nTiles: 256, ...c };
      for (const render of [
        (s: DropletSource, o: Uint8ClampedArray) => renderDropletPattern(s, o),
        (s: DropletSource, o: Uint8ClampedArray) => renderDropletPhage(s, o, 8),
        (s: DropletSource, o: Uint8ClampedArray) => renderDropletChem(s, o, 'food', 64),
        (s: DropletSource, o: Uint8ClampedArray) => renderDropletChem(s, o, 'waste', 64),
      ]) {
        const x = new Uint8ClampedArray(n), y = new Uint8ClampedArray(n);
        render(live, x); render(frozen, y);
        expect(x).toEqual(y);
      }
    }
  });

  it('a source that captured arrays once renders stale pixels (the trap is real)', () => {
    const { ref } = buildDropletWorld('PHAGE', 16, 2);
    const W0 = ref.W, A0 = ref.A, F0 = ref.F, P0 = ref.P;
    const stale: DropletSource = { width: 16, height: 16, nTiles: 256, A: A0, F: F0, W: W0, P: P0 };
    const live = dropletSourceOfRef(ref), n = 16 * 16 * 8 * 8 * 4;
    ref.step();
    const x = new Uint8ClampedArray(n), y = new Uint8ClampedArray(n);
    renderDropletChem(stale, x, 'food', 64); renderDropletChem(live, y, 'food', 64);
    expect(x).not.toEqual(y);
  });

  it('the snapshot holder replaces its arrays on each readback', () => {
    const snap = (v: number): DropletGpuSnapshot => ({ step: v, A: new Uint32Array(4).fill(v), F: new Uint32Array(4), W: new Uint32Array(24), P: new Uint32Array(24) });
    const h = new SnapshotHolder(2, 2, snap(1));
    const a = h.A;
    h.current = snap(2);
    expect(h.A).not.toBe(a);
    expect(h.A[0]).toBe(2);
  });
});

// ---- exact pixels ------------------------------------------------------------------------------

/** A 2 x 2 grid: tile 0 gets W/P/F/A settings; the rest is empty. Returns the source and the pixel at (x, y) of a render. */
function fixture(w0: number[], p0: number[] = [0, 0, 0, 0, 0, 0], f = 0, a = 0): DropletSource {
  const W = new Uint32Array(24), P = new Uint32Array(24), F = new Uint32Array(4), A = new Uint32Array(4);
  w0.forEach((v, m) => { W[m] = v; });
  p0.forEach((v, m) => { P[m] = v; });
  F[0] = f; A[0] = a;
  return { width: 2, height: 2, nTiles: 4, A, F, W, P };
}
const SUBF = dropletSub(2);
const BUF = 2 * SUBF;
const px = (o: Uint8ClampedArray, x: number, y: number): number[] => { const i = (y * BUF + x) * 4; return [o[i], o[i + 1], o[i + 2], o[i + 3]]; };
const fresh = () => new Uint8ClampedArray(BUF * BUF * 4);
const only = (m: number, v: number) => { const w = [0, 0, 0, 0, 0, 0]; w[m] = v; return w; };

describe('droplet render, exact pixels', () => {
  it('sub pixels per tile', () => {
    expect(dropletSub(64)).toBe(8); expect(dropletSub(128)).toBe(4); expect(dropletSub(256)).toBe(2); expect(dropletSub(48)).toBe(8); expect(dropletSub(32)).toBe(8);
    expect(dropletBufferSize({ width: 128, height: 128 })).toEqual({ w: 512, h: 512, sub: 4 });
  });

  it('pattern view: background below the edge, fade, core at the brightness floor, full colour, ties to the lowest index', () => {
    const o = fresh();
    renderDropletPattern(fixture(only(0, DROPLET_EDGE - 1)), o);
    expect(px(o, 1, 1)).toEqual([BG[0], BG[1], BG[2], 255]);
    renderDropletPattern(fixture(only(0, DROPLET_EDGE)), o);
    expect(px(o, 1, 1)).toEqual([BG[0], BG[1], BG[2], 255]); // zero coverage exactly at the edge
    const mid = Math.round((DROPLET_EDGE + DROPLET_CORE) / 2);
    renderDropletPattern(fixture(only(1, mid)), o);
    const cov = (mid - DROPLET_EDGE) / (DROPLET_CORE - DROPLET_EDGE);
    expect(px(o, 1, 1).slice(0, 3)).toEqual([0, 1, 2].map((c) => Math.round(BG[c] + (WALL_PALETTE[1][c] * BRIGHT_FLOOR - BG[c]) * cov)));
    renderDropletPattern(fixture(only(2, DROPLET_CORE)), o);
    expect(px(o, 1, 1).slice(0, 3)).toEqual([0, 1, 2].map((c) => Math.round(WALL_PALETTE[2][c] * BRIGHT_FLOOR)));
    renderDropletPattern(fixture(only(3, DROPLET_FULL)), o);
    expect(px(o, 1, 1).slice(0, 3)).toEqual([...WALL_PALETTE[3]]);
    renderDropletPattern(fixture(only(3, DROPLET_FULL + 500)), o);
    expect(px(o, 1, 1).slice(0, 3)).toEqual([...WALL_PALETTE[3]]);
    renderDropletPattern(fixture([300, 300, 0, 0, 0, 0]), o);
    expect(px(o, 1, 1).slice(0, 3)).toEqual(dropletPatternColour(0, 300));
    expect(dominantMotif(fixture([300, 300, 0, 0, 0, 0]).W, 0)).toBe(0);
  });

  it('every pixel is opaque and a fade is monotone in lightness for every pattern', () => {
    const o = fresh();
    renderDropletPattern(fixture(only(4, 250)), o);
    for (let i = 3; i < o.length; i += 4) expect(o[i]).toBe(255);
    for (let m = 0; m < KERNEL_MOTIFS; m++) {
      let prev = -1;
      for (let wd = DROPLET_EDGE; wd <= DROPLET_FULL; wd++) {
        const l = dropletPatternColour(m, wd).reduce((a, c) => a + c, 0);
        expect(l).toBeGreaterThanOrEqual(prev);
        prev = l;
      }
    }
  });

  it('cores keep the legibility floor of the Phase A palette', () => {
    for (let m = 0; m < KERNEL_MOTIFS; m++) expect(contrastRatio(dropletPatternColour(m, DROPLET_CORE), BG)).toBeGreaterThanOrEqual(3);
  });

  it('phage view: a dot inside a dim host (sub 8 frame and interior), and no dot below the visibility rule', () => {
    const o = fresh();
    renderDropletPhage(fixture(only(0, 400), only(0, 8)), o, 8);
    const host = [0, 1, 2].map((c) => Math.round(BG[c] + (dropletPatternColour(0, 400)[c] - BG[c]) * PHAGE_HOST_DIM));
    expect(px(o, 0, 0).slice(0, 3)).toEqual(host);
    expect(px(o, 3, 3).slice(0, 3)).toEqual([...WALL_PALETTE[0]]); // pd = pScale: full brightness
    renderDropletPhage(fixture(only(0, 400), only(0, 1)), o, 64); // 1 * 8 < 64
    expect(px(o, 3, 3).slice(0, 3)).toEqual(host);
    renderDropletPhage(fixture(only(0, 10), only(4, 8)), o, 8); // phage over empty water: BG ring, pattern 4 core
    expect(px(o, 0, 0).slice(0, 3)).toEqual([...BG]);
    expect(px(o, 3, 3).slice(0, 3)).toEqual([...WALL_PALETTE[4]]);
  });

  it('phage view: the dimmest dot is legible over its host, and every pattern pair is told apart', () => {
    const lo = (m: number) => WALL_PALETTE[m].map((c) => Math.round(c * BRIGHT_FLOOR));
    const host = (m: number) => [0, 1, 2].map((c) => Math.round(BG[c] + (dropletPatternColour(m, DROPLET_CORE)[c] - BG[c]) * PHAGE_HOST_DIM));
    for (let m = 0; m < KERNEL_MOTIFS; m++) {
      expect(contrastRatio(lo(m), host(m))).toBeGreaterThanOrEqual(2.5);
      for (let k = 0; k < KERNEL_MOTIFS; k++) if (k !== m) { expect(labDistance(lo(m), host(k))).toBeGreaterThanOrEqual(20); expect(labDistance(lo(m), lo(k))).toBeGreaterThanOrEqual(20); }
    }
  });

  it('phage view: sub 2 draws a checkerboard', () => {
    const W = new Uint32Array(6 * 4), P = new Uint32Array(6 * 4);
    P[2] = 8;
    const src: DropletSource = { width: 4, height: 1, nTiles: 4, A: new Uint32Array(4), F: new Uint32Array(4), W, P };
    expect(dropletSub(256)).toBe(2);
    const sub = 2, o = new Uint8ClampedArray(4 * sub * sub * 4);
    // the 4 x 1 fixture still has sub = dropletSub(4) = 8, so draw the checkerboard through a 256-wide fake size instead
    const big: DropletSource = { width: 256, height: 1, nTiles: 256, A: new Uint32Array(256), F: new Uint32Array(256), W: new Uint32Array(6 * 256), P: new Uint32Array(6 * 256) };
    big.P[0] = 8;
    const out = new Uint8ClampedArray(256 * 2 * 2 * 4);
    renderDropletPhage(big, out, 8);
    const at = (x: number, y: number) => [out[(y * 512 + x) * 4], out[(y * 512 + x) * 4 + 1], out[(y * 512 + x) * 4 + 2]];
    expect(at(0, 0)).toEqual([...WALL_PALETTE[0]]);
    expect(at(1, 0)).toEqual([...BG]);
    expect(at(1, 1)).toEqual([...WALL_PALETTE[0]]);
    void src; void o;
  });

  it('chemistry view: ramp colour at 0, half and full scale, and a core dot over the ramp', () => {
    const o = fresh();
    const colourAt = (f: number) => { renderDropletChem(fixture(only(0, 10), [0, 0, 0, 0, 0, 0], f), o, 'food', 100); return px(o, 0, 0).slice(0, 3); };
    const c0 = colourAt(0), c50 = colourAt(50), c100 = colourAt(100);
    expect(c0).toEqual([16, 24, 40]);
    expect(c100).toEqual([250, 240, 150]);
    expect(c50).toEqual([40, 150, 160]);
    renderDropletChem(fixture(only(0, 10), undefined, 0, 100), o, 'waste', 100);
    expect(px(o, 0, 0).slice(0, 3)).toEqual([250, 240, 150]);
    renderDropletChem(fixture(only(1, 400), undefined, 50), o, 'food', 100);
    expect(px(o, 0, 0).slice(0, 3)).toEqual([40, 150, 160]); // ring is the ramp
    expect(px(o, 3, 3).slice(0, 3)).toEqual(dropletPatternColour(1, 400)); // core dot is the pattern
    expect(renderDropletChem(fixture(only(0, 10), undefined, 77), o, 'food', 100)).toBe(77);
  });

  it('colour scales rise at once and fall slowly', () => {
    expect(rampScale(10, 4)).toBe(10);
    expect(rampScale(0, 100)).toBeCloseTo(98);
    expect(dropletRampScale(10, 4, 1)).toBe(10);
    expect(dropletRampScale(0, 100, 1)).toBeCloseTo(98);
    expect(dropletRampScale(0, 10, 64)).toBe(64);
    expect(dropletRampScale(70, 10, 64)).toBe(70);
  });
});

describe('droplet telemetry', () => {
  it('the residual is exactly one bigint', () => {
    expect(dropletBadge(0n)).toEqual({ ok: true, text: 'res 0', label: 'balanced' });
    expect(dropletBadge(1n)).toEqual({ ok: false, text: 'res 1', label: 'NOT 0' });
    expect(dropletBadge(-3n).text).toBe('res -3');
    const { ref } = buildDropletWorld('PHAGE', 24, 1);
    for (let t = 0; t < 300; t++) ref.step();
    const src = dropletSourceOfRef(ref);
    expect(dropletResidual(src, ref.initTotalMatter)).toBe(0n);
    ref.A[0]++;
    expect(dropletResidual(src, ref.initTotalMatter)).toBe(1n);
  });

  it('a census row matches the observers (droplets counted at 0.20)', () => {
    const { ref } = buildDropletWorld('PHAGE', 32, 1);
    for (let t = 0; t < 150; t++) ref.step();
    const row = sampleDropletCensus(dropletSourceOfRef(ref), ref.stepCount);
    const st = observeMotifStats(ref.W, ref.P);
    expect(row.droplets).toBe(observeFindDroplets(ref.W, 32, 32, 0.2).length);
    expect(row.shares).toEqual(st.shares);
    expect(row.dominant).toBe(st.dominant);
    expect(row.shares.reduce((a, c) => a + c, 0)).toBeCloseTo(1, 9);
    expect(row.phageTotals).toEqual(st.phageTotals);
  });

  it('the leader counter counts only multiples of 500, from step 2,000, at 25 percent or more', () => {
    const s = newLeaderState();
    const row = (step: number, dominant: number, dominantShare = 0.3) => ({ step, dominant, dominantShare });
    leaderUpdate(s, row(1500, 0)); leaderUpdate(s, row(1600, 1)); // before settling, and not a multiple of 500 anyway
    expect(s).toEqual({ last: -1, changes: 0 });
    leaderUpdate(s, row(2000, 0));
    leaderUpdate(s, row(2100, 3)); // not a sampling step
    leaderUpdate(s, row(2500, 0, 0.24)); // flicker below 25 percent
    leaderUpdate(s, row(3000, 0, 0.26));
    expect(s.changes).toBe(0);
    leaderUpdate(s, row(3500, 2));
    leaderUpdate(s, row(4000, 2));
    leaderUpdate(s, row(4500, 5));
    expect(s.changes).toBe(2);
    expect(DROPLET_SETTLE).toBe(2000);
  });

  it('the ring keeps the newest 200', () => {
    const r = new RingBuffer<number>(200);
    for (let i = 0; i < 250; i++) r.push(i);
    expect(r.length).toBe(200);
    expect(r.at(0)).toBe(50);
  });

  it('clipSteps lands a census on a multiple of 100', () => {
    expect(clipSteps(25, 0)).toBe(25);
    expect(clipSteps(25, 90)).toBe(10);
    expect(clipSteps(100, 100)).toBe(100);
    expect(clipSteps(100, 150)).toBe(50);
    expect(clipSteps(10, 99)).toBe(1);
  });
});

// ---- the run controller with a fake engine -----------------------------------------------------

class FakeEngine implements DropletEngine {
  readonly kind: 'gpu' | 'cpu';
  readonly width = 8;
  readonly height = 8;
  readonly initTotalMatter: bigint;
  readonly source: DropletSource;
  readonly device: GPUDevice | null;
  step = 0;
  destroyed = 0;
  pending: (() => void)[] = [];
  advances: number[] = [];
  reject: ((e: Error) => void)[] = [];
  constructor(kind: 'gpu' | 'cpu' = 'cpu', device: GPUDevice | null = null) {
    const ref = new DropletKernelRef(defaultDropletKernelConfig({ width: 8, height: 8 }));
    this.initTotalMatter = ref.initTotalMatter;
    this.source = dropletSourceOfRef(ref);
    this.kind = kind;
    this.device = device;
  }
  advance(n: number): Promise<number> {
    this.advances.push(n);
    return new Promise((res, rej) => { this.pending.push(() => { this.step += n; res(n); }); this.reject.push(rej); });
  }
  release(): void { this.pending.shift()?.(); this.reject.shift(); }
  fail(): void { this.pending.shift(); this.reject.shift()?.(new Error('readback failed')); }
  async destroy(): Promise<void> { this.destroyed++; }
}

const OPTS: RunOpts = { arm: 'PHAGE', size: 0, seed: 1, engineMode: 'auto' };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness() {
  const engines: FakeEngine[] = [];
  const gates: (() => void)[] = [];
  const notices: string[] = [];
  let builds = 0, changes = 0, optsSeen: RunOpts[] = [], kind: 'gpu' | 'cpu' = 'cpu';
  const run = new DropletRun(
    async (o) => {
      builds++; optsSeen = [...optsSeen, o];
      await new Promise<void>((r) => { gates.push(r); });
      const e = new FakeEngine(kind, kind === 'gpu' ? ({} as GPUDevice) : null);
      engines.push(e);
      return { engine: e, text: 'fake' };
    },
    () => { changes++; },
    (t) => { notices.push(t); },
  );
  const open = async () => { const p = run.reset(OPTS); await flush(); gates.shift()?.(); await p; };
  return { run, engines, gates, notices, builds: () => builds, changes: () => changes, opts: () => optsSeen, setKind: (k: 'gpu' | 'cpu') => { kind = k; }, open };
}

describe('droplet run controller', () => {
  it('a readback that lands after a reset is discarded (no census, no publish)', async () => {
    const h = harness();
    await h.open();
    const old = h.run.session!;
    h.run.setPlaying(true);
    expect(h.run.tryAdvance(100)).toBe(true);
    await flush();
    const e0 = h.engines[0];
    expect(e0.pending.length).toBe(1);
    const resetP = h.run.reset(OPTS);
    expect(h.run.session).toBeNull();
    e0.release();
    await flush();
    h.gates.shift()?.();
    await resetP;
    expect(h.run.session).not.toBe(old);
    expect(old.ring.length).toBe(0);
    expect(h.run.session!.ring.length).toBe(0);
    expect(h.run.session!.step).toBe(0);
  });

  it('a reset during an in-flight advance waits, destroys the old engine exactly once and builds the new', async () => {
    const h = harness();
    await h.open();
    h.run.setPlaying(true);
    h.run.tryAdvance(10);
    await flush();
    const resetP = h.run.reset(OPTS);
    await flush();
    expect(h.engines[0].destroyed).toBe(0); // still waiting for the in-flight frame
    expect(h.builds()).toBe(1);
    h.engines[0].release();
    await flush();
    expect(h.engines[0].destroyed).toBe(1);
    h.gates.shift()?.();
    await resetP;
    expect(h.builds()).toBe(2);
    expect(h.engines[0].destroyed).toBe(1);
    expect(h.run.session!.engine).toBe(h.engines[1]);
  });

  it('two resets back to back: only the last is published and the first built engine is destroyed', async () => {
    const h = harness();
    const a = h.run.reset(OPTS);
    await flush();
    const b = h.run.reset({ ...OPTS, seed: 2 });
    await flush();
    h.gates.shift()?.();
    await flush();
    h.gates.shift()?.();
    await Promise.all([a, b]);
    expect(h.engines.length).toBe(2);
    expect(h.engines[0].destroyed).toBe(1);
    expect(h.engines[1].destroyed).toBe(0);
    expect(h.run.session!.engine).toBe(h.engines[1]);
    expect(h.run.session!.opts.seed).toBe(2);
  });

  it('frames never overlap (tryAdvance returns false while one is in flight)', async () => {
    const h = harness();
    await h.open();
    h.run.setPlaying(true);
    expect(h.run.tryAdvance(10)).toBe(true);
    expect(h.run.tryAdvance(10)).toBe(false);
    await flush();
    expect(h.engines[0].advances).toEqual([10]);
    h.engines[0].release();
    await flush();
    expect(h.run.busy).toBe(false);
    expect(h.run.tryAdvance(10)).toBe(true);
  });

  it('One step pauses first, waits for a frame in flight, then steps exactly once; ignored while building', async () => {
    const h = harness();
    expect(await h.run.stepOnce()).toBe(false);
    await h.open();
    h.run.setPlaying(true);
    h.run.tryAdvance(10);
    await flush();
    const stepP = h.run.stepOnce();
    expect(h.run.paused).toBe(true);
    h.engines[0].release();
    await flush();
    expect(h.engines[0].advances).toEqual([10, 1]);
    h.engines[0].release();
    expect(await stepP).toBe(true);
    expect(h.run.session!.step).toBe(11);
    expect(h.run.session!.resStep).toBe(11); // One step runs the exact matter check
    const during = h.run.reset(OPTS);
    expect(await h.run.stepOnce()).toBe(false);
    await flush();
    h.gates.shift()?.();
    await during;
    expect(h.run.session!.step).toBe(0);
  });

  it('every kind of reset bumps the generation; census lands on multiples of 100 and counts leader rows', async () => {
    const h = harness();
    const g0 = h.run.gen;
    await h.open();
    expect(h.run.gen).toBe(g0 + 1);
    h.run.setPlaying(true);
    h.run.tryAdvance(250);
    await flush();
    expect(h.engines[0].advances).toEqual([100]);
    h.engines[0].release();
    await flush();
    expect(h.run.session!.ring.length).toBe(1);
    expect(h.run.session!.ring.at(0).step).toBe(100);
    h.run.tryAdvance(30);
    await flush();
    h.engines[0].release();
    await flush();
    expect(h.run.session!.ring.length).toBe(1); // step 130 is not a census step
    const p = h.run.dispose();
    await p;
    expect(h.run.session).toBeNull();
    expect(h.engines[0].destroyed).toBe(1);
  });

  it('past 200 census rows the ring stays full but latest.step keeps moving (the page keys its chart redraw on it)', async () => {
    const h = harness();
    await h.open();
    h.run.setPlaying(true);
    const seen: number[] = [];
    for (let i = 0; i < 205; i++) {
      h.run.tryAdvance(100);
      await flush();
      h.engines[0].release();
      await flush();
      seen.push(h.run.session!.latest.step);
    }
    expect(h.run.session!.ring.length).toBe(200);
    expect(new Set(seen).size).toBe(205);
    expect(h.run.session!.latest.step).toBe(20500);
  });

  it('one seed rule for every reset path', () => {
    expect(parseSeed('7')).toEqual({ seed: 7, replaced: false });
    expect(parseSeed(' 42 ')).toEqual({ seed: 42, replaced: false });
    expect(parseSeed('0')).toEqual({ seed: 0, replaced: false });
    expect(parseSeed('')).toEqual({ seed: 1, replaced: true });
    expect(parseSeed('abc')).toEqual({ seed: 1, replaced: true });
    expect(parseSeed('-3')).toEqual({ seed: 1, replaced: true });
    expect(parseSeed('1.5')).toEqual({ seed: 1, replaced: true });
    expect(parseSeed('2147483647')).toEqual({ seed: 2147483647, replaced: false });
    expect(parseSeed('2147483648')).toEqual({ seed: 1, replaced: true });
    expect(parseSeed('3000000000')).toEqual({ seed: 1, replaced: true });
  });

  it('parseSeed agrees with the rule page.ts uses for the Reset button', () => {
    const page = readFileSync(new URL('../src/oligomer/page.ts', import.meta.url), 'utf8');
    expect(page).toContain("let seed = raw === '' ? NaN : Number(raw);");
    expect(page).toContain('seed < 0 || seed > 2 ** 31 - 1');
    const pageRule = (input: string) => {
      const raw = input.trim();
      let seed = raw === '' ? NaN : Number(raw);
      const replaced = !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1;
      if (replaced) seed = 1;
      return { seed, replaced };
    };
    for (const v of ['', ' ', '0', '5', ' 9 ', '-1', '2.5', 'x', '2147483647', '2147483648', '4294967296', '1e3']) expect(parseSeed(v), v).toEqual(pageRule(v));
  });

  it('a failed readback on the graphics card restarts the world on the processor with a notice', async () => {
    const h = harness();
    h.setKind('gpu');
    await h.open();
    h.run.setPlaying(true);
    h.run.tryAdvance(10);
    await flush();
    h.engines[0].fail();
    await flush();
    expect(h.run.session).toBeNull();
    h.setKind('cpu');
    h.gates.shift()?.();
    await flush();
    expect(h.opts()[1]).toMatchObject({ engineMode: 'cpu', restarted: true, size: 0 });
    expect(h.engines[0].destroyed).toBe(1);
    expect(h.notices.join(' ')).toContain('Restarted this world from step 0 on the processor');
    expect(h.run.session!.step).toBe(0);
  });

  it('device loss triggers one processor reset, only for the device in use', async () => {
    const h = harness();
    h.setKind('gpu');
    await h.open();
    const dev = h.engines[0].device!;
    await h.run.fallback('lost', {} as GPUDevice); // some other device: ignored
    expect(h.builds()).toBe(1);
    void h.run.fallback('lost', dev);
    h.setKind('cpu');
    await flush();
    h.gates.shift()?.();
    await flush();
    expect(h.builds()).toBe(2);
    expect(h.opts()[1].engineMode).toBe('cpu');
  });

  it('a late loss event from the old device during a reset does not override that reset', async () => {
    const h = harness();
    h.setKind('gpu');
    await h.open();
    const dev = h.engines[0].device!;
    const before = h.builds();
    void h.run.reset({ ...h.run.current!, seed: 9 });
    await h.run.fallback('lost', dev); // the session is unpublished: ignored
    await flush();
    h.gates.shift()?.();
    await flush();
    expect(h.builds()).toBe(before + 1);
    expect(h.opts()[h.opts().length - 1].seed).toBe(9);
    expect(h.opts()[h.opts().length - 1].restarted).toBeUndefined();
    expect(h.notices.join(' ')).not.toContain('Restarted this world');
  });
});

// ---- the GPU engine with a fake sim ------------------------------------------------------------

function fakeSim() {
  const log: string[] = [];
  const reads: { res: (s: DropletGpuSnapshot) => void; rej: (e: Error) => void }[] = [];
  let step = 0;
  const snap = (): DropletGpuSnapshot => ({ step, A: new Uint32Array(4), F: new Uint32Array(4), W: new Uint32Array(24), P: new Uint32Array(24) });
  const sim: SimLike = {
    uploadFromRef() { log.push('upload'); },
    step(n) { step += n; log.push(`step ${n}`); },
    readback() { log.push('readback'); return new Promise((res, rej) => { reads.push({ res, rej }); }); },
    destroy() { log.push('destroy'); },
  };
  return { sim, log, reads, snap };
}
const tinyRef = () => new DropletKernelRef(defaultDropletKernelConfig({ width: 2, height: 2 }));

describe('gpu engine with a fake sim', () => {
  const make = async (f: ReturnType<typeof fakeSim>) => {
    const p = GpuDropletEngine.create({} as GPUDevice, tinyRef(), () => f.sim);
    await flush();
    f.reads.shift()!.res(f.snap());
    return p;
  };

  it('reads the first snapshot at build and the step comes from the snapshot', async () => {
    const f = fakeSim();
    const e = await make(f);
    expect(f.log).toEqual(['upload', 'readback']);
    expect(e.step).toBe(0);
    const p = e.advance(7);
    await flush();
    f.reads.shift()!.res(f.snap());
    expect(await p).toBe(7);
    expect(e.step).toBe(7);
  });

  it('destroy during a pending readback waits, frees once, and the late snapshot is not published', async () => {
    const f = fakeSim();
    const e = await make(f);
    const adv = e.advance(5);
    await flush();
    const d1 = e.destroy(), d2 = e.destroy();
    await flush();
    expect(f.log).not.toContain('destroy');
    f.reads.shift()!.res(f.snap());
    await Promise.all([d1, d2, adv]);
    expect(f.log.filter((l) => l === 'destroy')).toHaveLength(1);
    expect(e.step).toBe(0);
  });

  it('a second advance while one is in flight throws', async () => {
    const f = fakeSim();
    const e = await make(f);
    void e.advance(1);
    await flush();
    expect(() => e.advance(1)).toThrow(/in flight/);
  });

  it('a rejected readback surfaces as a rejection and destroy still frees', async () => {
    const f = fakeSim();
    const e = await make(f);
    const adv = e.advance(1);
    await flush();
    f.reads.shift()!.rej(new Error('Buffer is already mapped'));
    await expect(adv).rejects.toThrow(/already mapped/);
    await e.destroy();
    expect(f.log.at(-1)).toBe('destroy');
  });

  it('a build whose error scope reports a validation error yields a processor engine', async () => {
    const f = fakeSim();
    const device = { pushErrorScope() {}, popErrorScope: async () => ({ message: 'bad pipeline' }) } as unknown as GPUDevice;
    const p = createEngine('auto', tinyRef(), { getDevice: async () => device, makeSim: () => f.sim });
    await flush();
    f.reads.shift()!.res(f.snap());
    const built = await p;
    expect(built.engine.kind).toBe('cpu');
    expect(built.text).toContain('failed to start: bad pipeline');
    expect(f.log).toContain('destroy');
  });

  it('no device gives the processor with its own sentence; processor-only never asks for a device', async () => {
    let asked = 0;
    const none = await createEngine('auto', tinyRef(), { getDevice: async () => { asked++; return null; } });
    expect(none.text).toContain('no usable WebGPU');
    const chosen = await createEngine('cpu', tinyRef(), { getDevice: async () => { asked++; return null; } });
    expect(chosen.text).toContain('you chose processor only');
    expect(asked).toBe(1);
  });
});

describe('droplet engine', () => {
  it('the processor engine advances within a budget and its source follows the swaps', async () => {
    const { ref } = buildDropletWorld('PHAGE', 16, 1);
    const e = new CpuDropletEngine(ref);
    expect(await e.advance(5)).toBe(5);
    expect(e.step).toBe(5);
    expect(e.source.W).toBe(ref.W);
    expect(await e.advance(1000, 0)).toBe(1); // a zero budget still takes one step
  });

  it('sizes and paces: exactly the planned lists, defaults inside them, GPU paces divide 100', () => {
    expect(ENGINE_SIZES.gpu.sizes).toEqual([64, 128, 256]);
    expect(ENGINE_SIZES.cpu.sizes).toEqual([32, 48, 64]);
    for (const k of ['gpu', 'cpu'] as const) {
      expect(ENGINE_SIZES[k].sizes).toContain(ENGINE_SIZES[k].default);
      expect(ENGINE_PACES[k].paces).toContain(ENGINE_PACES[k].default);
    }
    for (const n of ENGINE_PACES.gpu.paces) expect(100 % n).toBe(0);
  });
});

// ---- the arm table ----------------------------------------------------------------------------

describe('arm table', () => {
  it('builds every droplet world with residual 0n', () => {
    for (const id of DROPLET_ARM_IDS) {
      const { ref } = buildDropletWorld(id, 24, 1);
      for (let t = 0; t < 30; t++) ref.step();
      expect(observeTotalMatter(ref.A, ref.F, ref.W, ref.P) - ref.initTotalMatter).toBe(0n);
    }
  });

  it('the four arms equal the runner table, for default and for custom parameters', () => {
    const d = PHAGE_RUN_DEFAULTS;
    expect(d).toEqual({ kInfect: 0.34, kDecayP: 0.02, diffP: 0.22, mutPhage: 0.00001, mutMotif: 0.00002 });
    const [p, n, s, u] = phageArms(d);
    expect(p).toEqual({ name: 'PHAGE', ov: { ...d, neutralPhage: false }, single: false });
    expect(n.ov).toEqual({ kInfect: 0, kDecayP: d.kDecayP, diffP: d.diffP, mutPhage: 0, mutMotif: d.mutMotif, neutralPhage: false });
    expect(s.single).toBe(true);
    expect(s.ov.mutMotif).toBe(0);
    expect(u.ov.neutralPhage).toBe(true);
    const c = { kInfect: 0.2, kDecayP: 0.03, diffP: 0.15, mutPhage: 0.0003, mutMotif: 0.0005 };
    expect(phageArms(c)[0].ov).toEqual({ ...c, neutralPhage: false });
    expect(armById('NO_PHAGE', c).ov.kInfect).toBe(0);
    expect(() => armById('NOPE')).toThrow();
  });

  it('seeding matches the digests recorded from the runner before it was edited', () => {
    const digest = (size: number, single: boolean) => {
      const ref = new DropletKernelRef(defaultDropletKernelConfig({ width: size, height: size, seed: 1 }));
      seedPhageArena(ref, size, single, 'mixed');
      return observeDigest(ref.A, ref.F, ref.W, ref.P).toString(16);
    };
    expect(digest(32, false)).toBe('44fc7673');
    expect(digest(32, true)).toBe('e17bb823');
    expect(digest(48, false)).toBe('fcc1f91f');
    expect(digest(48, true)).toBe('efda1b8f');
  });

  it('option values are namespaced and never collide with Phase A ids; text avoids bare codes and differs per arm', () => {
    const ids = new Set(CONDITIONS.map((c) => c.id as string));
    expect(DROPLET_WORLD_OPTIONS.map((o) => o.value)).toEqual(DROPLET_ARM_IDS.map((a) => `D_${a}`));
    for (const o of DROPLET_WORLD_OPTIONS) {
      expect(ids.has(o.value)).toBe(false);
      expect(o.label).not.toMatch(/\b(PHAGE|NO_PHAGE|SINGLE_WALL|NEUTRAL_PHAGE|D_[A-Z_]+)\b/);
    }
    expect(new Set(DROPLET_ARM_IDS.map((a) => describeDropletArm(a))).size).toBe(4);
  });
});

// ---- markup, copy and the doc ------------------------------------------------------------------

describe('droplet page markup and copy', () => {
  const html = readFileSync(new URL('../oligomer/index.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/oligomer/page.ts', import.meta.url), 'utf8');
  const dpage = readFileSync(new URL('../src/oligomer/droplet-page.ts', import.meta.url), 'utf8');
  const doc = readFileSync(new URL('../../../docs/oligomer-2026-11-20/PHASE-B2-GPU.md', import.meta.url), 'utf8');

  it('every id the scripts use exists in the markup, and every droplet control has a label', () => {
    const used = new Set<string>();
    for (const src of [page, dpage]) {
      for (const m of src.matchAll(/\bel(?:<[^>]*>)?\('([\w-]+)'\)/g)) used.add(m[1]);
      for (const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) used.add(m[1]);
    }
    for (const id of ['intro-a', 'intro-d', 'readout-a', 'readout-d', 'engine', 'engine-mode', 'dsize', 'dview', 'dchem', 'dpace', 'start-droplets', 'd-res', 'd-res-word', 'd-res-step', 'd-t', 'd-drops', 'd-lead', 'd-d1', 'd-sw', 'd-phage']) used.add(id);
    expect(used.size).toBeGreaterThan(40);
    for (const id of used) expect(html, id).toContain(`id="${id}"`);
    for (const id of ['dsize', 'dview', 'dchem', 'dpace', 'engine-mode']) expect(html, id).toContain(`for="${id}"`);
    expect(dpage).not.toMatch(/localStorage|fetch\(|window\.__/);
    expect(page).not.toMatch(/localStorage|fetch\(|window\.__/);
  });

  it('the droplet optgroup is empty in the markup (script-filled), so the Phase A option test is untouched', () => {
    const m = html.match(/<optgroup id="start-droplets"[^>]*><\/optgroup>/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain('value=');
    expect(html).toContain('id="engine" class="note" data-engine=""');
  });

  it('static droplet option text avoids bare codes', () => {
    for (const m of html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)) expect(m[1]).not.toMatch(/\b(PHAGE|NO_PHAGE|SINGLE_WALL|NEUTRAL_PHAGE|D_[A-Z_]+)\b/);
  });

  const dropletCopy = () => {
    const a = html.indexOf('id="intro-d"'), b = html.indexOf('</section>', a);
    const c = html.indexOf('id="explain-d"'), d = html.indexOf('</section>', c);
    return html.slice(a, b) + html.slice(c, d) + [...DROPLET_ARM_IDS].map((x) => describeDropletArm(x)).join(' ') + dpage;
  };

  it('copy makes no promise in seconds or minutes, and every quoted figure sits beside its setting', () => {
    const copy = dropletCopy().replace(/<[^>]+>/g, ' ');
    expect(copy).not.toMatch(/\b(seconds?|minutes?)\b/i);
    for (const id of DROPLET_ARM_IDS) {
      const t = describeDropletArm(id);
      if (/\d+ to \d+ droplets late/.test(t)) { expect(t).toContain('128 x 128'); expect(t).toContain('20,000 steps'); }
    }
    const intro = html.slice(html.indexOf('What this has shown so far'), html.indexOf('Our own test runs'));
    expect(intro).toContain('128 x 128');
    expect(intro).toContain('20,000 steps');
    expect(intro).toContain('256 x 256');
    expect(intro).toContain('10,000 steps');
  });

  it('every figure quoted from the doc is in the doc table', () => {
    const rows = (name: string) => doc.split('\n').find((l) => l.includes(name))!;
    const range = (cell: string) => { const n = [...cell.matchAll(/\d+\.?\d*/g)].map((x) => Number(x[0])); return [Math.round(Math.min(...n)), Math.round(Math.max(...n))]; };
    const cells = (line: string) => line.split('|').map((c) => c.trim().replace(/\*/g, ''));
    const phage = cells(rows('`PHAGE` (motif-specific)')), none = cells(rows('`NO_PHAGE` (no phage)')), single = cells(rows('`SINGLE_WALL` (1 motif + phage)')), neutral = cells(rows('`NEUTRAL_PHAGE` (motif-blind)'));
    expect(range(phage[2])).toEqual([65, 70]); expect(range(phage[4])).toEqual([6, 9]);
    expect(range(none[2])).toEqual([59, 65]); expect(range(none[4])).toEqual([0, 2]);
    expect(range(single[2])).toEqual([17, 25]);
    expect(range(neutral[2])).toEqual([10, 19]); expect(range(neutral[4])).toEqual([1, 9]);
    expect(doc).toContain('287.3 late droplets');
    expect(describeDropletArm('PHAGE')).toContain('65 to 70 droplets late'); expect(describeDropletArm('PHAGE')).toContain('6 to 9 times');
    expect(describeDropletArm('NO_PHAGE')).toContain('59 to 65'); expect(describeDropletArm('NO_PHAGE')).toContain('0 to 2 times');
    expect(describeDropletArm('SINGLE_WALL')).toContain('17 to 25');
    expect(describeDropletArm('NEUTRAL_PHAGE')).toContain('10 to 19');
    expect(html).toContain('about 287 droplets late');
  });

  it('the page quotes the doc table beside our own re-run on the current kernel, and says which is which', () => {
    const intro = html.slice(html.indexOf('What this has shown so far'), html.indexOf('Our own test runs'));
    expect(intro).toMatch(/before a later fix/);
    expect(intro).toMatch(/re-run/);
    for (const id of DROPLET_ARM_IDS) expect(describeDropletArm(id)).toMatch(/re-run/);
  });

  it('wall patterns are described as six display-labelled patterns, not a kernel mapping', () => {
    const copy = html.slice(html.indexOf('id="intro-d"'), html.indexOf('</section>', html.indexOf('id="intro-d"')));
    expect(copy).not.toContain('one for each four-letter');
    expect(copy).toMatch(/display labels/);
    for (const id of DROPLET_ARM_IDS) expect(describeDropletArm(id)).not.toContain('four-letter');
  });

  it('the page swaps accessible names with the family', () => {
    expect(dpage).toContain("'Number of droplets over time.'");
    expect(dpage).toMatch(/setAttribute\('aria-label', d \? dropletName : aText\)/);
    expect(dpage).toContain('latest.step');
    expect(dpage).not.toContain('chartsStep !== s.ring.length');
  });

  it('the neutral world note claims only what the table and the rule show', () => {
    const t = describeDropletArm('NEUTRAL_PHAGE');
    expect(t).not.toMatch(/harder|more lysis|crash/);
    expect(t).toContain('0011 colour');
  });

  it('the tile speech and inspector name a droplet core', () => {
    const { ref } = buildDropletWorld('PHAGE', 24, 1);
    const src = dropletSourceOfRef(ref);
    const core = Array.from({ length: 576 }, (_, i) => i).find((i) => ref.W[i * 6] >= DROPLET_CORE)!;
    expect(dropletTileSpeech(src, core)).toContain('droplet core');
    expect(dropletTileSpeech(src, 0)).toContain('thin wall or empty');
    const rows = dropletInspectRows(src, core);
    expect(rows.map((r) => r[0])).toEqual(['Square', 'Loose pieces (A)', 'Food (F)', 'Wall matter', 'Phage', 'In a droplet core?', 'All matter on this square']);
    expect(rows[3][1].split('\n').length).toBe(7);
    expect(rows[4][1].split('\n').length).toBe(6);
  });
});
