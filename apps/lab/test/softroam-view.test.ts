import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, ROAM_GENES, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam, paintSoftRoam, softTimeWords, SOFT_STARTS, type SoftRoamStart, SoftPaintMemory, SoftRoamSession, softCellPosition, softRoamConfig, foodTone, softFamilies, softFamily, SOFT_OWN, SEASONS_DEFAULTS, BODIES_DEFAULTS, softSeason, softSky, softYearLight } from '../src/softroam/view.ts';
import { KIND_LEAF, KIND_MOUTH, KIND_SHELL, softRoamLight } from '../src/softroam/kernel.ts';
import { ROAM_PLANS, ROAM_TYPES } from '../src/roam/view.ts';

const U = SOFT_U;
const SIZE = 16;
const SCALE = 6;
const SIDE = SIZE * SCALE;

/** A small world with no food and no founders but those a test puts in. */
function bare(over: Partial<SoftRoamConfig> = {}): SoftRoamWorld {
  const cfg: SoftRoamConfig = { ...defaultSoftRoamConfig(), size: SIZE, matter: 100_000, startPatches: 0, patchEvery: 1_000_000, maxCells: 256, ...over };
  const w = new SoftRoamWorld(cfg);
  w.addPlan(ROAM_PLANS.speck);
  return w;
}
const put = (w: SoftRoamWorld, xu: number, yu: number): number => w.found(xu, yu, ROAM_TYPES.chaser.genes, 1, undefined, 1);

function image(w: SoftRoamWorld, alpha: number, mem?: SoftPaintMemory, paint: 'garden' | 'plain' = 'garden'): Uint8Array {
  const out = new Uint8Array(SIDE * SIDE * 4);
  paintSoftRoam(w, paint, SCALE, alpha, out, mem);
  return out;
}

/** Brightness-weighted centre of the picture in tiles, and the total brightness. */
const BASE = (() => { const o = new Uint8Array(SIDE * SIDE * 4); paintSoftRoam(bare(), 'garden', SCALE, 1, o); return o; })();
function centre(px: Uint8Array): { x: number; y: number; sum: number } {
  let sx = 0, sy = 0, sum = 0;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const p = (y * SIDE + x) * 4;
      const v = Math.max(0, px[p] + px[p + 1] + px[p + 2] - BASE[p] - BASE[p + 1] - BASE[p + 2]);
      sx += v * (x + 0.5); sy += v * (y + 0.5); sum += v;
    }
  }
  return { x: sx / sum / SCALE, y: sy / sum / SCALE, sum };
}

describe('soft roam view: painter', () => {
  it('is deterministic, alike with and without a long-lived memory', () => {
    const a = foundSoftRoam({ seed: 3, size: 32, start: 'grown-all' });
    const b = foundSoftRoam({ seed: 3, size: 32, start: 'grown-all' });
    a.advance(120);
    b.advance(120);
    const out = (w: SoftRoamWorld, mem?: SoftPaintMemory) => { const o = new Uint8Array(32 * SCALE * 32 * SCALE * 4); paintSoftRoam(w, 'garden', SCALE, 0.4, o, mem); return o; };
    const m1 = new SoftPaintMemory();
    const m2 = new SoftPaintMemory();
    const first = out(a, m1);
    expect(first).toEqual(out(b, m2));
    // Painting again must not change anything (the buffers are left clean): compare with the first picture from the same memory.
    expect(out(a, m1)).toEqual(first);
    expect(out(a, m1)).toEqual(out(b, m2));
    // ... and the picture is a picture: many distinct colours, with bodies lit well above the dark ground.
    const px = out(a, m1);
    const colours = new Set<number>();
    let brightest = 0;
    for (let i = 0; i < px.length; i += 4) { colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); brightest = Math.max(brightest, px[i] + px[i + 1] + px[i + 2]); }
    expect(colours.size).toBeGreaterThan(200);
    expect(brightest).toBeGreaterThan(300);
    for (const paint of ['plain'] as const) {
      const o1 = new Uint8Array(32 * SCALE * 32 * SCALE * 4);
      const o2 = new Uint8Array(32 * SCALE * 32 * SCALE * 4);
      paintSoftRoam(a, paint, SCALE, 1, o1, m1);
      paintSoftRoam(b, paint, SCALE, 1, o2, m2);
      expect(o1).toEqual(o2);
    }
  });

  it('writes only inside its buffer, fills every pixel opaque, and refuses a wrong size', () => {
    const w = bare();
    put(w, 5 * U, 5 * U);
    const guard = 64;
    for (const paint of ['garden', 'plain'] as const) {
      const big = new Uint8Array(SIDE * SIDE * 4 + 2 * guard).fill(0xab);
      paintSoftRoam(w, paint, SCALE, 0.5, big.subarray(guard, guard + SIDE * SIDE * 4));
      for (let i = 0; i < guard; i++) {
        expect(big[i]).toBe(0xab);
        expect(big[guard + SIDE * SIDE * 4 + i]).toBe(0xab);
      }
      for (let p = 3; p < SIDE * SIDE * 4; p += 4) expect(big[guard + p]).toBe(255);
    }
    expect(() => paintSoftRoam(w, 'garden', SCALE, 0.5, new Uint8Array(10))).toThrow();
  });

  it('draws a cell on the torus seam on both edges and a cell mid-picture once', () => {
    const w = bare();
    put(w, 20, 8 * U); // 20 units from the left edge
    const px = image(w, 1);
    const lit = (x: number, y: number) => { const p = (y * SIDE + x) * 4; return px[p] + px[p + 1] + px[p + 2]; };
    const midY = 8 * SCALE;
    expect(lit(0, midY)).toBeGreaterThan(150);
    expect(lit(SIDE - 1, midY)).toBeGreaterThan(150);
    expect(lit(SIDE - 1, midY)).toBeGreaterThan(lit(SIDE - 5 * SCALE, midY) + 100);
    // The same cell, moved to the middle, makes the same blob: equal total light.
    const w2 = bare();
    put(w2, 8 * U + 20, 8 * U);
    expect(Math.abs(centre(image(w2, 1)).sum - centre(px).sum) / centre(px).sum).toBeLessThan(0.02);
  });

  it('alpha 0 and 1 land on the previous and the current positions, the short way across the seam', () => {
    const w = bare();
    const c = put(w, 8 * U, 8 * U);
    w.prevX[c] = 7 * U;
    w.prevY[c] = 8 * U;
    const p = [0, 0];
    softCellPosition(w, c, 0, p);
    expect(p[0]).toBeCloseTo(7, 6);
    softCellPosition(w, c, 1, p);
    expect(p[0]).toBeCloseTo(8, 6);
    softCellPosition(w, c, 0.5, p);
    expect(p[0]).toBeCloseTo(7.5, 6);
    // Across the seam: from just left of the edge to just right of it, halfway is the edge itself.
    w.prevX[c] = w.span - 100;
    w.x[c] = 100;
    softCellPosition(w, c, 0.5, p);
    const d = Math.min(p[0], SIZE - p[0]);
    expect(d).toBeLessThan(0.01);
    softCellPosition(w, c, 0, p);
    expect(p[0]).toBeCloseTo((w.span - 100) / U, 6);
    // And in the picture: the light moves from the previous place to the current one.
    w.prevX[c] = 6 * U; w.x[c] = 9 * U; w.prevY[c] = w.y[c] = 8 * U;
    const c0 = centre(image(w, 0));
    const c1 = centre(image(w, 1));
    expect(Math.abs(c0.x - 6)).toBeLessThan(0.25);
    expect(Math.abs(c1.x - 9)).toBeLessThan(0.25);
  });

  it('never draws a cell born in the last step from a stale previous position', () => {
    const w = foundSoftRoam({ seed: 2, size: 32, start: 'grown-all' });
    w.advance(60);
    const born = w.events.births.filter((c) => w.alive[c]);
    // Run on until a step has a birth.
    let tries = 0;
    let list = born;
    while (list.length === 0 && tries++ < 400) { w.stepOnce(); list = w.events.births.filter((c) => w.alive[c]); }
    expect(list.length).toBeGreaterThan(0);
    const c = list[0];
    w.prevX[c] = (w.x[c] + 5 * U) % w.span; // stale
    w.prevY[c] = (w.y[c] + 5 * U) % w.span;
    const p = [0, 0];
    for (const a of [0, 0.5, 1]) {
      softCellPosition(w, c, a, p);
      expect(p[0]).toBeCloseTo(w.x[c] / U, 6);
      expect(p[1]).toBeCloseTo(w.y[c] / U, 6);
    }
  });

  it('shows a death as a fading ghost kept by position, and the ghost is gone after its time', () => {
    const w = bare({ minStore: 16, leakCell: 0.5 });
    const c = put(w, 8 * U, 8 * U);
    w.store[c] = 17;
    const mem = new SoftPaintMemory();
    mem.observe(w);
    let n = 0;
    while (w.alive[c] && n++ < 100) { w.stepOnce(); mem.observe(w); }
    expect(w.alive[c]).toBe(0);
    expect(mem.ghosts.length).toBe(1);
    expect(mem.ghosts[0].x).toBeCloseTo(8, 0);
    const fresh = centre(image(w, 0, mem)).sum;
    expect(fresh).toBeGreaterThan(500); // light above the empty ground
    for (let k = 0; k < 25; k++) { w.stepOnce(); mem.observe(w); }
    expect(mem.ghosts.length).toBe(0);
  });

  it('keeps matter whole and the picture steady over a run (no frame differs wildly from the last)', () => {
    const w = foundSoftRoam({ seed: 5, size: 32, start: 'grown-all' });
    const mem = new SoftPaintMemory();
    mem.observe(w);
    let prev: Uint8Array | null = null;
    for (let k = 0; k < 40; k++) {
      w.stepOnce();
      mem.observe(w);
      const o = new Uint8Array(32 * SCALE * 32 * SCALE * 4);
      paintSoftRoam(w, 'garden', SCALE, 1, o, mem);
      if (prev) {
        let changed = 0;
        for (let i = 0; i < o.length; i += 4) if (Math.abs(o[i] - prev[i]) + Math.abs(o[i + 1] - prev[i + 1]) + Math.abs(o[i + 2] - prev[i + 2]) > 150) changed++;
        expect(changed / (o.length / 4)).toBeLessThan(0.02);
      }
      prev = o;
    }
    expect(w.census().residual).toBe(0);
  });
});

describe('soft roam view: starts and session', () => {
  it('places founders of every start, well apart, and the world passes its invariants', () => {
    for (const start of Object.keys(SOFT_STARTS) as SoftRoamStart[]) {
      const w = foundSoftRoam({ seed: 7, size: 64, start });
      const cells: number[] = [];
      for (let c = 0; c < w.cap; c++) if (w.alive[c]) cells.push(c);
      expect(cells.length).toBeGreaterThan(5);
      for (let a = 0; a < cells.length; a++) {
        for (let b = a + 1; b < cells.length; b++) {
          const dx = w.dlt(w.x[cells[a]], w.x[cells[b]]);
          const dy = w.dlt(w.y[cells[a]], w.y[cells[b]]);
          expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(717 * 717);
        }
      }
      expect(w.census().residual).toBe(0);
      w.checkInvariants();
    }
    expect(() => foundSoftRoam({ seed: 1, start: 'nope' as SoftRoamStart })).toThrow();
  });

  it('builds a config that scales matter with the area', () => {
    const a = softRoamConfig({ seed: 1 });
    const b = softRoamConfig({ seed: 1, size: 64 });
    expect(b.matter).toBe(Math.round(a.matter / 4));
    expect(b.planMut).toBe(a.planMut);
    expect(softRoamConfig({ seed: 1, size: 64, mut: 0.04 }).planMut).toBeCloseTo(0.1, 9);
    expect(ROAM_GENES).toBe(5);
  });

  it('a session steps, paints at an alpha without stepping, and returns transferable pixels', () => {
    const s = new SoftRoamSession({ seed: 4, size: 32, start: 'grown-all' }, 4);
    const done = s.advance(30, 10_000);
    expect(done).toBe(30);
    const f1 = s.frame('garden', 0.5);
    expect(f1.step).toBe(30);
    expect(f1.side).toBe(128);
    expect(f1.pixels.length).toBe(128 * 128 * 4);
    expect(f1.census.residual).toBe(0);
    const f2 = s.frame('garden', 0.5);
    expect(f2.step).toBe(30);
    expect(f2.pixels).toEqual(f1.pixels);
    expect(f2.pixels.buffer).not.toBe(f1.pixels.buffer);
    const f3 = s.frame('plain', 1);
    expect(f3.step).toBe(30);
    expect(f1.readouts.families.reduce((a, r) => a + r.cells, 0)).toBe(f1.census.cells);
  });
});

describe('soft roam view: kinds', () => {
  const paintAt = (w: SoftRoamWorld, mem: SoftPaintMemory, alpha: number): Uint8Array => {
    const o = new Uint8Array(w.size * SCALE * w.size * SCALE * 4);
    paintSoftRoam(w, 'garden', SCALE, alpha, o, mem);
    return o;
  };

  it('the garden start turns kinds, touch feeding, seal, cracking and shell costs on (and the seasons start, the default, is the garden with more)', () => {
    const a = softRoamConfig({ seed: 1, start: 'garden' });
    const b = softRoamConfig({ seed: 1, start: 'garden' });
    expect(a).toEqual(b);
    const d = softRoamConfig({ seed: 1 });
    expect(d).toEqual(softRoamConfig({ seed: 1, start: 'seasons' }));
    for (const k of ['kinds', 'drain', 'seal', 'shellBite', 'shellLeak', 'grip'] as const) expect(d[k]).toBe(a[k]);
    // The seasons has its own economy (cheaper cells, small frequent patches, hard shells); the garden keeps the page world.
    expect(d.crack).toBe(10000);
    expect([d.birthStore, d.minStore, d.patchFood, d.patchEvery, d.leakSide, d.leakCell]).toEqual([60, 15, 1000, 12, 0.008, 0.004]);
    expect([a.birthStore, a.minStore, a.patchFood, a.patchEvery, a.leakSide, a.leakCell]).toEqual([150, 30, 4000, 20, 0.002, 0.001]);
    expect([a.kinds, a.drain, a.seal, a.crack, a.shellBite, a.shellLeak]).toEqual([true, 1, 200, 300, 1, 0.1]);
    expect(a.toughness).toBeUndefined();
    // An option given wins over the line-up; the plain grown starts keep no kinds.
    expect(softRoamConfig({ seed: 1, crack: 500, kinds: true, drain: 4 }).crack).toBe(500);
    expect(softRoamConfig({ seed: 1, kinds: false }).kinds).toBeUndefined();
    for (const start of ['grown-all', 'grown-lines', 'grown-specks'] as const) {
      const c = softRoamConfig({ seed: 1, start });
      expect([c.kinds, c.drain, c.crack, c.shellBite, c.seal]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    }
    const w = foundSoftRoam({ seed: 1, size: 32, start: 'garden' });
    expect(w.cfg.kinds).toBe(true);
  });

  it('hunters and armoured founders both exist in the garden, and the plain start makes neither', () => {
    const w = foundSoftRoam({ seed: 1, start: 'garden' });
    w.advance(600);
    const c = w.census();
    expect(c.mouths).toBeGreaterThan(0);
    expect(c.shells).toBeGreaterThan(0);
    const p = foundSoftRoam({ seed: 1, start: 'grown-all' });
    p.advance(600);
    expect(p.census().mouths + p.census().shells).toBe(0);
  });

  it('painting never touches the world, and feeding, hits and cracks show in the memory and the picture', () => {
    const w = foundSoftRoam({ seed: 1, start: 'garden', overrides: { crack: 3 } });
    const mem = new SoftPaintMemory();
    mem.observe(w);
    let threads = 0, rings = 0, flashes = 0;
    let withFeed: Uint8Array | null = null;
    let ringSeen = false;
    for (let k = 0; k < 1800; k++) {
      w.stepOnce();
      mem.observe(w);
      threads = Math.max(threads, mem.threads.filter((t) => t.seen).length);
      rings = Math.max(rings, mem.rings.length);
      if (!withFeed && mem.threads.some((t) => t.seen)) {
        const digest = w.digest();
        withFeed = paintAt(w, mem, 0.5);
        expect(w.digest()).toBe(digest);
        // The feeding picture is not the picture of the same cells without the kind effects.
        const plain = paintAt(w, new SoftPaintMemory(), 0.5);
        expect(plain.length).toBe(withFeed.length);
        // The threads themselves are in the picture: the same memory with them taken out paints different pixels.
        const kept = mem.threads;
        mem.threads = [];
        const noThreads = paintAt(w, mem, 0.5);
        mem.threads = kept;
        expect(noThreads.some((v, i) => v !== withFeed![i])).toBe(true);
      }
      if (!ringSeen && mem.rings.some((r) => r.step === w.step)) {
        ringSeen = true;
        const withRing = paintAt(w, mem, 0.5);
        const kept = mem.rings;
        mem.rings = [];
        const noRing = paintAt(w, mem, 0.5);
        mem.rings = kept;
        expect(noRing.some((v, i) => v !== withRing[i])).toBe(true);
      }
      if (k % 10 === 0) for (let c = 0; c < w.cap; c++) if (w.alive[c] && mem.lvCur[c * 7] > 0.5) { flashes++; break; }
    }
    expect(threads).toBeGreaterThan(0);
    expect(rings).toBeGreaterThan(0);
    expect(ringSeen).toBe(true);
    expect(flashes).toBeGreaterThan(0);
    expect(w.census().cracked).toBeGreaterThan(0);
    expect(w.census().residual).toBe(0);
  });

  it('a fed-on cell dims and its mouth warms, eased in over a few steps and never in one jump', () => {
    const w = foundSoftRoam({ seed: 1, start: 'garden' });
    const mem = new SoftPaintMemory();
    mem.observe(w);
    let found: { m: number; p: number } | null = null;
    let steps = 0;
    while (!found && steps < 1500) {
      w.stepOnce(); steps++;
      mem.observe(w);
      const th = mem.threads.find((t) => t.seen && t.prv === 0 && w.alive[t.ms] && w.alive[t.ps] && mem.feedT[t.ps] === 0);
      if (th) found = { m: th.ms, p: th.ps };
    }
    expect(found).not.toBeNull();
    const { m, p } = found!;
    // Levels are 0..1 and move by less than the whole range in one step: the thread's first step lifts the mouth's warmth and the
    // prey's dimming to about half (1 - exp(-1 / 1.5)), neither zero nor a jump to full.
    const FEED = 1, PREY = 2;
    expect(mem.lvCur[m * 7 + FEED]).toBeGreaterThan(0.3);
    expect(mem.lvCur[m * 7 + FEED]).toBeLessThan(0.75);
    expect(mem.lvCur[p * 7 + PREY]).toBeGreaterThan(0.3);
    expect(mem.lvCur[p * 7 + PREY]).toBeLessThan(0.75);
    const seen: number[] = [mem.lvCur[m * 7 + FEED]];
    const dim: number[] = [mem.lvCur[p * 7 + PREY]];
    let more = 0;
    for (let k = 0; k < 8; k++) {
      w.stepOnce();
      mem.observe(w);
      if (!w.alive[m] || !w.alive[p] || !mem.threads.some((t) => t.seen && t.ms === m && t.ps === p)) break;
      seen.push(mem.lvCur[m * 7 + FEED]);
      dim.push(mem.lvCur[p * 7 + PREY]);
      more++;
    }
    for (let k = 1; k < seen.length; k++) {
      expect(Math.abs(seen[k] - seen[k - 1])).toBeLessThan(0.75);
      expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1] - 1e-9);
      expect(dim[k]).toBeGreaterThanOrEqual(dim[k - 1] - 1e-9);
    }
    // While the feeding goes on the levels keep rising toward 1.
    if (more >= 2) { expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]); expect(dim[dim.length - 1]).toBeGreaterThan(dim[0]); }
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it('the picture with kinds on stays steady from frame to frame', () => {
    const w = foundSoftRoam({ seed: 2, start: 'garden', overrides: { crack: 3 } });
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.advance(900);
    mem.observe(w);
    let prev: Uint8Array | null = null;
    let worst = 0;
    for (let k = 0; k < 60; k++) {
      w.stepOnce();
      mem.observe(w);
      const o = paintAt(w, mem, 1);
      if (prev) {
        let changed = 0;
        for (let i = 0; i < o.length; i += 4) if (Math.abs(o[i] - prev[i]) + Math.abs(o[i + 1] - prev[i + 1]) + Math.abs(o[i + 2] - prev[i + 2]) > 150) changed++;
        worst = Math.max(worst, changed / (o.length / 4));
      }
      prev = o;
    }
    expect(worst).toBeLessThan(0.02);
  });
});

describe('food haze tone', () => {
  it('is compressive: thin food reads, a fresh patch does not blow out, and it never falls', () => {
    expect(foodTone(0)).toBe(0);
    expect(foodTone(1)).toBeGreaterThan(0.2);
    expect(foodTone(1)).toBeGreaterThan((1 / 120) * 10); // far above a straight line
    expect(foodTone(4000)).toBe(1);
    expect(foodTone(120)).toBeLessThan(1);
    let prev = -1;
    for (let f = 0; f <= 400; f += 0.5) {
      const t = foodTone(f);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('shows spread food as a visible haze, and a fresh patch brighter still, without touching the world', () => {
    const w = bare();
    const mem = new SoftPaintMemory();
    w.food[8 * SIZE + 8] = 1;
    w.food[3 * SIZE + 3] = 150;
    const d0 = w.digest();
    mem.observe(w);
    const o = image(w, 1, mem);
    const blueAt = (tx: number, ty: number): number => o[((ty * SCALE + SCALE / 2) * SIDE + tx * SCALE + SCALE / 2) * 4 + 2];
    const empty = blueAt(13, 13);
    expect(blueAt(8, 8)).toBeGreaterThan(empty + 6);
    expect(blueAt(3, 3)).toBeGreaterThan(blueAt(8, 8) + 20);
    expect(w.digest()).toBe(d0);
  });
});

describe('soft roam view: the seasons start and its founders', () => {
  it('the seasons start is the default, has every chunk 2 key on, and the garden has none of them', () => {
    const c = softRoamConfig({ seed: 1, start: 'seasons' });
    expect(softRoamConfig({ seed: 1 })).toEqual(c);
    for (const [k, v] of Object.entries(SEASONS_DEFAULTS)) expect((c as unknown as Record<string, unknown>)[k], k).toBe(v);
    const g = softRoamConfig({ seed: 1, start: 'garden' }) as unknown as Record<string, unknown>;
    for (const k of Object.keys(SEASONS_DEFAULTS)) expect(g[k], k).toBeUndefined();
    // An explicit option wins, and false or an override does too; any start takes the keys when given.
    expect(softRoamConfig({ seed: 1, start: 'seasons', day: 600, leaf: 0, truce: false }).day).toBe(600);
    expect(softRoamConfig({ seed: 1, start: 'seasons', leaf: 0 }).leaf).toBe(0);
    expect(softRoamConfig({ seed: 1, start: 'seasons', truce: false }).truce).toBeUndefined();
    expect(softRoamConfig({ seed: 1, start: 'seasons', overrides: { sight: 2 } }).sight).toBe(2);
    expect(softRoamConfig({ seed: 1, start: 'garden', day: 400 }).day).toBe(400);
    expect(softRoamConfig({ seed: 1, start: 'seasons', size: 64 }).matter).toBe(softRoamConfig({ seed: 1, start: 'seasons' }).matter / 4);
  });

  it('seasons founders hold all four types, well apart, with their own family numbers; the garden rows are unchanged', () => {
    const w = foundSoftRoam({ seed: 3, size: 64, start: 'seasons' });
    w.checkInvariants();
    const rows = softFamilies(w);
    expect(rows.slice(0, 11).map((r) => r.name)).toEqual(['chasers', 'wanderers', 'sitters', 'single cells', 'big bodies', 'lines', 'plates', 'crosses', 'blocks', 'specks', 'bushes']);
    for (const id of ['grazer', 'leafbush', 'hunter'] as const) {
      const row = rows[softFamily(id) - 1];
      expect(row.name).toBe(SOFT_OWN[id].name);
      expect(softFamily(id)).toBeGreaterThan(11);
      expect(row.cells).toBeGreaterThan(0);
    }
    expect(rows[softFamily('plate' as never) - 1].cells).toBeGreaterThan(0);
  });

  /** One founder of a type of its own alone in plenty of food; the body it grows and the size it had when it first let a daughter go. */
  function grownAlone(id: 'grazer' | 'leafbush' | 'hunter'): { size: number; atRelease: number; kinds: string[] } {
    const cfg = softRoamConfig({ seed: 1, size: 32, start: 'seasons', overrides: { startPatches: 0, patchEvery: 1_000_000, matter: 400_000, releaseGap: 100_000 } });
    delete cfg.life;
    const w = new SoftRoamWorld(cfg);
    const info = SOFT_OWN[id];
    w.found(16 * U, 16 * U, info.genes, softFamily(id), undefined, w.addPlan(info.plan));
    for (let i = 0; i < 1024; i++) { w.food[i] += 150; w.reservoir -= 150; }
    let atRelease = 0;
    for (let t = 0; t < 600 && atRelease === 0; t++) {
      let big = 0;
      for (let c = 0; c < w.cap; c++) if (w.alive[c]) big = Math.max(big, w.bodySize[w.body[c]]);
      const before = w.census().releases;
      w.stepOnce();
      if (w.census().releases > before) atRelease = big;
    }
    for (let t = 0; t < 100; t++) w.stepOnce();
    let best = -1, bs = 0;
    for (let c = 0; c < w.cap; c++) if (w.alive[c] && w.bodySize[w.body[c]] > bs) { bs = w.bodySize[w.body[c]]; best = c; }
    const kinds: string[] = [];
    for (let c = 0; c < w.cap; c++) if (w.alive[c] && w.body[c] === w.body[best]) kinds.push('.SML'[w.kind[c]]);
    return { size: bs, atRelease, kinds };
  }

  it('the armoured grazer grows to 12 cells (plain eaters inside shells) before it lets any daughter go', () => {
    const g = grownAlone('grazer');
    expect(g.atRelease).toBeGreaterThanOrEqual(9);
    expect(g.size).toBe(12);
    expect(g.kinds.filter((k) => k === 'S').length).toBe(8);
    expect(g.kinds.filter((k) => k === '.').length).toBe(4);
  });
  it('the leaf bush grows to 12 cells (five plain, seven leaves) before it lets any daughter go', () => {
    const g = grownAlone('leafbush');
    expect(g.atRelease).toBeGreaterThanOrEqual(9);
    expect(g.kinds.filter((k) => k === 'L').length).toBeGreaterThanOrEqual(6);
    expect(g.kinds.filter((k) => k === '.').length).toBeGreaterThanOrEqual(5);
  });
  it('the hunter grows to 8 cells (two mouths in front, six plain behind) before it lets any daughter go', () => {
    const g = grownAlone('hunter');
    expect(g.atRelease).toBeGreaterThanOrEqual(8);
    expect(g.size).toBe(8);
    expect(g.kinds.filter((k) => k === 'M').length).toBe(2);
    expect(g.kinds.filter((k) => k === '.').length).toBe(6);
    expect(KIND_SHELL + KIND_MOUTH + KIND_LEAF).toBe(6);
  });

  it('every founder type of its own releases at the page defaults (releaseMin 8), unmutated: a plan smaller than the release cap would be sterile', () => {
    for (const id of ['grazer', 'leafbush', 'hunter'] as const) {
      const cfg = softRoamConfig({ seed: 1, size: 32, start: 'seasons', mut: 0, planMut: 0, overrides: { startPatches: 0, patchEvery: 1_000_000, matter: 400_000 } });
      expect(cfg.releaseMin, id).toBe(SEASONS_DEFAULTS.releaseMin);
      delete cfg.life;
      const w = new SoftRoamWorld(cfg);
      const info = SOFT_OWN[id];
      w.found(16 * U, 16 * U, info.genes, softFamily(id), undefined, w.addPlan(info.plan));
      for (let i = 0; i < 1024; i++) { w.food[i] += 150; w.reservoir -= 150; }
      for (let t = 0; t < 1500; t++) w.stepOnce();
      expect(w.census().releases, id).toBeGreaterThan(0);
    }
  });

  it('a seasons world keeps matter whole, releases happen, and a body is at least releaseMin cells when it releases', () => {
    const w = foundSoftRoam({ seed: 1, size: 128, start: 'seasons' });
    let releases = 0;
    for (let t = 0; t < 4000; t++) {
      const before = w.census().releases;
      const start = (w as unknown as { bodyStart: Int32Array }).bodyStart;
      w.stepOnce();
      const made = w.census().releases - before;
      if (made > 0) {
        releases += made;
        // A release writes this step's record into every cell of the releasing body; a released daughter starts with none. Each releasing body must have held releaseMin cells.
        let seen = 0;
        for (let c = 0; c < w.cap; c++) {
          if (!w.alive[c] || w.relRec[c] !== w.step) continue;
          // The size the releaser's body had as the division stage began (deaths come before it), which is what releaseMin tests.
          seen++;
          expect(start[w.body[c]], `step ${t}`).toBeGreaterThanOrEqual(SEASONS_DEFAULTS.releaseMin);
        }
        expect(seen, `step ${t}`).toBeGreaterThan(0);
      }
    }
    expect(releases).toBeGreaterThan(0);
    expect(w.census().releasesHeld).toBeGreaterThan(0);
    expect(w.census().residual).toBe(0);
    w.checkInvariants();
  });
});

describe('soft roam view: the big bodies start (chunk 3)', () => {
  it('each big type grows alone to its full plan (25, 21, 23 cells) with the kinds it says, and releases a daughter that grows to 20 cells or more and releases in turn', () => {
    const want = { herd: { size: 25, shells: 10, mouths: 0, leaves: 0 }, grove: { size: 21, shells: 0, mouths: 0, leaves: 6 }, pack: { size: 23, shells: 0, mouths: 3, leaves: 0 } } as const;
    for (const id of ['herd', 'grove', 'pack'] as const) {
      const cfg = softRoamConfig({ seed: 1, size: 40, start: 'bodies', mut: 0, planMut: 0, overrides: { startPatches: 0, patchEvery: 1_000_000, matter: 400_000, maxCells: 200 } });
      delete cfg.life;
      const w = new SoftRoamWorld(cfg);
      const info = SOFT_OWN[id];
      const f = w.found(20 * U, 20 * U, info.genes, softFamily(id), undefined, w.addPlan(info.plan));
      const founderCid = w.cid[f];
      for (let i = 0; i < w.n; i++) { w.food[i] += 200; w.reservoir -= 200; }
      // Until a body that does not hold the founder (a released daughter grown up: with heal and no wear the founder's body does not split) reaches 20 cells.
      let grown = false;
      let t = 0;
      for (; t < 3000 && !grown; t++) {
        const releases = w.census().releases;
        const fb = [...Array(w.cap).keys()].find((c) => w.alive[c] && w.cid[c] === founderCid);
        w.stepOnce();
        if (w.census().releases > releases) {
          const sizes = new Map<number, number>();
          for (let c = 0; c < w.cap; c++) if (w.alive[c]) sizes.set(w.body[c], (sizes.get(w.body[c]) ?? 0) + 1);
          const founderBody = fb !== undefined && w.alive[fb] ? w.body[fb] : -1;
          for (const [b, s2] of sizes) if (b !== founderBody && s2 >= 20) grown = true;
        }
      }
      expect(grown, `${id} (step ${t})`).toBe(true);
      // The founder's body is whole, with its kinds.
      const fb = [...Array(w.cap).keys()].find((c) => w.alive[c] && w.cid[c] === founderCid)!;
      const k = [0, 0, 0, 0];
      let size = 0;
      for (let c = 0; c < w.cap; c++) if (w.alive[c] && w.body[c] === w.body[fb]) { size++; k[w.kind[c]]++; }
      expect({ size, shells: k[KIND_SHELL], mouths: k[KIND_MOUTH], leaves: k[KIND_LEAF] }, id).toEqual(want[id]);
      // Then the founder's body is taken away (its cells starve this step, matter kept): a release after that comes from a descendant.
      for (let c = 0; c < w.cap; c++) if (w.alive[c] && w.body[c] === w.body[fb]) { w.reservoir += w.store[c]; w.store[c] = 0; }
      w.stepOnce();
      expect(w.alive[fb]).toBe(0);
      const before = w.census().releases;
      for (let u = 0; u < 2000 && w.census().releases === before; u++) w.stepOnce();
      expect(w.census().releases, `${id}: a descendant releases`).toBeGreaterThan(before);
      expect(w.census().residual).toBe(0);
    }
  });

  it('the bodies start is the seasons plus the chunk 3 keys, with its own release, shell, patch and life values', () => {
    const cfg = softRoamConfig({ seed: 1, size: 64, start: 'bodies' });
    expect(cfg).toMatchObject({ ...BODIES_DEFAULTS, releaseMin: 8, crack: 2000, life: 20000, day: 400, year: 12000, sight: 8, fear: 4 });
    expect(cfg.patchSun).toBeUndefined();
    expect(foundSoftRoam({ seed: 1, size: 64, start: 'bodies' }).census().cells).toBeGreaterThan(0);
  });
});

describe('soft roam view: the seasons start, edges', () => {
  it('a seasons start with kinds off, or touch feeding off, or no day, is a world with the keys that need them left out (and an explicit key that cannot work is still refused)', () => {
    const noKinds = foundSoftRoam({ seed: 1, size: 32, kinds: false });
    expect(noKinds.cfg.kinds).toBeUndefined();
    for (const k of ['sight', 'fear', 'leaf'] as const) expect(noKinds.cfg[k], k).toBeUndefined();
    expect(noKinds.cfg.day).toBe(SEASONS_DEFAULTS.day);
    noKinds.advance(50);
    expect(noKinds.census().residual).toBe(0);
    const noDrain = foundSoftRoam({ seed: 1, size: 32, drain: 0 });
    for (const k of ['sight', 'fear'] as const) expect(noDrain.cfg[k], k).toBeUndefined();
    expect(noDrain.cfg.leaf).toBe(SEASONS_DEFAULTS.leaf);
    const noDay = foundSoftRoam({ seed: 1, size: 32, day: false as unknown as number });
    for (const k of ['day', 'year', 'winter', 'patchSun', 'leaf'] as const) expect(noDay.cfg[k], k).toBeUndefined();
    expect(noDay.cfg.sight).toBe(SEASONS_DEFAULTS.sight);
    expect(() => foundSoftRoam({ seed: 1, size: 32, kinds: false, sight: 3 })).toThrow(/sight and fear need kinds and drain/);
  });

  it('the family colours of the seasons types are not the kind colours drawn over them (a leaf bush is not leaf green, a hunter is not mouth red)', () => {
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const kinds = { mouth: [255, 60, 50], leaf: [70, 220, 80], shell: [215, 210, 180] };
    // Each body's plain cells sit beside the kind that is drawn in the same body: a bush beside its leaves, a hunter beside its mouths, a grazer beside its shells.
    expect(dist(SOFT_OWN.leafbush.colour, kinds.leaf)).toBeGreaterThan(90);
    expect(dist(SOFT_OWN.hunter.colour, kinds.mouth)).toBeGreaterThan(90);
    expect(dist(SOFT_OWN.grazer.colour, kinds.shell)).toBeGreaterThan(90);
  });

  it('the seasons start adds its implicit year (and winter) only when that year can hold the day asked for', () => {
    const long = softRoamConfig({ seed: 1, day: 20000 });
    expect(long.day).toBe(20000);
    expect(long.year).toBeUndefined();
    expect(long.winter).toBeUndefined();
    expect(() => foundSoftRoam({ seed: 1, size: 32, day: 20000 })).not.toThrow();
    const usual = softRoamConfig({ seed: 1, day: 400 });
    expect(usual.year).toBe(SEASONS_DEFAULTS.year);
    expect(usual.winter).toBe(SEASONS_DEFAULTS.winter);
    // A year the caller gives is kept, and still refused if it cannot hold the day.
    expect(() => foundSoftRoam({ seed: 1, size: 32, day: 20000, year: 12000 })).toThrow(/year/);
  });

  it('the time in words counts a short last day of a year that is not a whole number of days', () => {
    const f = (step: number, day: number, year: number) => ({ step, sky: { day, year, dayShare: (step % day) / day, yearShare: (step % year) / year } });
    expect(softTimeWords(f(400, 400, 401))).toMatch(/day 2 of the year's 2, days running on over the turn of the year/);
    // Step 401 starts year 2 inside the day that began at step 400 (the sky does not restart its day there): still that day, now day 1 of year 2.
    expect(softTimeWords(f(401, 400, 401))).toMatch(/day 1 of the year's 2.* \(year 2\)/);
    expect(softTimeWords(f(799, 400, 401))).toMatch(/day 1 of the year's 2/);
    expect(softTimeWords(f(800, 400, 401))).toMatch(/day 2 of the year's 2/);
    expect(softTimeWords(f(0, 400, 12000))).toMatch(/day 1 of the year's 30 \(year 1\)/);
    expect(softTimeWords(f(12000 + 11999 % 12000, 400, 12000))).toMatch(/day 30 of the year's 30/);
    for (const [day, year] of [[400, 401], [64, 1000], [100, 250], [16, 17]]) {
      for (let t = 0; t < 3 * year; t += 7) {
        const m = /day (\d+) of the year's (\d+)/.exec(softTimeWords(f(t, day, year)));
        expect(Number(m![1]), `${day}/${year} at ${t}`).toBeLessThanOrEqual(Number(m![2]));
      }
    }
    expect(softTimeWords(f(5, 0, 0))).toMatch(/^no sun/);
  });

  it('the time in words does not place a lit band in complete darkness', () => {
    const dark = { step: 0, sky: { day: 400, year: 12000, dayShare: 0, yearShare: 0, meanLight: 0 } };
    expect(softTimeWords(dark)).toMatch(/dark everywhere/);
    expect(softTimeWords(dark)).not.toMatch(/lit band/);
    expect(softTimeWords({ ...dark, sky: { ...dark.sky, meanLight: 0.3 } })).toMatch(/lit band/);
    // A real world with a winter of 0 at step 0 has no light on any tile, and says so.
    const w = foundSoftRoam({ seed: 1, size: 16, start: 'seasons', winter: 0 });
    expect(softSky(w).meanLight).toBe(0);
    expect(softTimeWords({ step: w.step, sky: { day: w.cfg.day!, year: w.cfg.year!, dayShare: 0, yearShare: 0, meanLight: softSky(w).meanLight } })).toMatch(/dark everywhere/);
  });

  it('an override that turns kinds off on the seasons start gives a world without kinds, sight, fear or leaves rather than a refusal', () => {
    const w = foundSoftRoam({ seed: 1, size: 32, start: 'seasons', overrides: { kinds: false } });
    expect(w.cfg.kinds).toBe(false);
    expect(w.cfg.sight).toBeUndefined();
    expect(w.cfg.fear).toBeUndefined();
    expect(w.cfg.leaf).toBeUndefined();
    expect(w.cfg.day).toBe(SEASONS_DEFAULTS.day);
  });
});

describe('soft roam view: the sky', () => {
  const sky = (over: Partial<SoftRoamConfig> = {}): SoftRoamWorld => bare({ kinds: true, drain: 1, day: 64, ...over });
  const column = (px: Uint8Array, tx: number, ty = 2): number => {
    const p = ((ty * SCALE + 2) * SIDE + tx * SCALE + 3) * 4;
    return px[p] + px[p + 1] + px[p + 2];
  };
  const brightest = (px: Uint8Array): number => {
    let best = 0, bv = -1;
    for (let tx = 0; tx < SIZE; tx++) { const v = column(px, tx); if (v > bv) { bv = v; best = tx; } }
    return best;
  };

  it('year and day shares: winter floor at the start of a year, midsummer halfway, and the kernel light never above them', () => {
    const cfg = { size: 64, day: 64, year: 1024, winter: 0.25 };
    expect(softSeason(cfg, 0)).toBe(0);
    expect(softSeason(cfg, 512)).toBe(1);
    expect(softSeason({}, 5)).toBe(1);
    expect(softYearLight(cfg, 0)).toBeCloseTo(0.25, 6);
    expect(softYearLight(cfg, 512)).toBe(1);
    expect(softYearLight({}, 7)).toBe(1);
    for (const t of [0, 100, 512, 777]) {
      let max = 0;
      for (let tx = 0; tx < 64; tx++) max = Math.max(max, softRoamLight(cfg, tx, 0, t));
      expect(max / 256).toBeLessThanOrEqual(softYearLight(cfg, t) + 1e-9);
      expect(max / 256).toBeGreaterThan(softYearLight(cfg, t) - 0.05);
    }
    const w = sky({ year: 128 });
    expect(softSky(w).yearShare).toBe(0);
    expect(softSky(w).meanLight).toBeGreaterThan(0);
    expect(softSky(bare()).meanLight).toBe(1);
  });

  it('night dims the ground and food haze, day warms it, and the band visibly sweeps round the world', () => {
    const w = sky();
    const mem = new SoftPaintMemory();
    const a = image(w, 1, mem);
    const lit0 = brightest(a);
    let dim = 1e9, bright = 0;
    for (let tx = 0; tx < SIZE; tx++) { const v = column(a, tx); dim = Math.min(dim, v); bright = Math.max(bright, v); }
    expect(bright).toBeGreaterThan(dim + 40);
    // The warm side is redder than it is blue; the night side is not.
    const p = (tx: number) => ((2 * SCALE + 2) * SIDE + tx * SCALE + 3) * 4;
    let lo = 0;
    for (let tx = 0; tx < SIZE; tx++) if (column(a, tx) === dim) lo = tx;
    expect(a[p(lit0)] - a[p(lit0) + 2]).toBeGreaterThan(a[p(lo)] - a[p(lo) + 2]);
    for (let i = 0; i < 16; i++) w.stepOnce();
    const b = image(w, 1, mem);
    const shift = (brightest(b) - lit0 + SIZE) % SIZE;
    expect(shift).toBeGreaterThanOrEqual(3);
    expect(shift).toBeLessThanOrEqual(5);
  });

  it('shows no column edges: neighbouring pixels of the ground never jump, and a half-step frame sits between its neighbours', () => {
    const w = sky();
    for (let i = 0; i < 5; i++) w.stepOnce();
    const mem = new SoftPaintMemory();
    const f0 = image(w, 0, mem), fh = image(w, 0.5, mem), f1 = image(w, 1, mem);
    for (const f of [f0, fh, f1]) {
      let worst = 0;
      for (let x = 1; x < SIDE; x++) { const p = (40 * SIDE + x) * 4, q = p - 4; worst = Math.max(worst, Math.abs(f[p] - f[q]) + Math.abs(f[p + 1] - f[q + 1]) + Math.abs(f[p + 2] - f[q + 2])); }
      expect(worst).toBeLessThanOrEqual(20);
    }
    for (let x = 0; x < SIDE; x += 7) {
      const p = (40 * SIDE + x) * 4;
      const s = (i: number) => f0[p + i] + f1[p + i];
      for (let i = 0; i < 3; i++) expect(Math.abs(2 * fh[p + i] - s(i))).toBeLessThanOrEqual(6);
    }
  });

  it('winter is cooler and dimmer than summer at the same hour of the day', () => {
    const cfg = { year: 400, winter: 0.2 };
    const win = sky(cfg);
    const sum = sky(cfg);
    // Year step 0 is deepest winter, step 200 midsummer; both at day step 0 mod 64 is not needed: compare the brightest column of each.
    while (sum.step < 192) sum.stepOnce();
    while (win.step < 0) win.stepOnce();
    const a = image(win, 1, new SoftPaintMemory()), b = image(sum, 1, new SoftPaintMemory());
    let wm = 0, sm = 0;
    for (let tx = 0; tx < SIZE; tx++) { wm = Math.max(wm, column(a, tx)); sm = Math.max(sm, column(b, tx)); }
    expect(sm).toBeGreaterThan(wm + 20);
  });

  it('a leaf is green, brighter in the light than in the dark, and eases rather than pops', () => {
    const w = bare({ kinds: true, drain: 1, day: 64, leaf: 1, size: SIZE });
    // A founder with a plain plan, then flip its kind to a leaf for the picture (found makes plain cells).
    const c = put(w, 8 * U, 8 * U);
    w.kind[c] = KIND_LEAF;
    const mem = new SoftPaintMemory();
    const at = [0, 0];
    const cellPix = (px: Uint8Array) => { softCellPosition(w, c, 1, at); const p = ((Math.floor(at[1] * SCALE)) * SIDE + Math.floor(at[0] * SCALE)) * 4; return [px[p], px[p + 1], px[p + 2]]; };
    const px0 = cellPix(image(w, 1, mem));
    expect(px0[1]).toBeGreaterThan(px0[0] + 15);
    expect(px0[1]).toBeGreaterThan(px0[2] + 15);
    let lastG = px0[1];
    let maxJump = 0;
    for (let i = 0; i < 40; i++) {
      w.stepOnce();
      const g = cellPix(image(w, 1, mem))[1];
      maxJump = Math.max(maxJump, Math.abs(g - lastG));
      lastG = g;
    }
    expect(maxJump).toBeLessThan(25);
  });

  it('a world without a day paints exactly as before: no sky work, the ground untouched', () => {
    const a = image(bare(), 1, new SoftPaintMemory());
    expect(a).toEqual(BASE);
  });
  it('food haze is dimmed by night and shows through it: the same food is brighter in the light, and brighter than bare ground in the same light', () => {
    const mk = (): SoftRoamWorld => {
      const w = sky();
      // The same heap of food on two tiles in one row: one under the lit band and one in the night.
      const lit = [...Array(SIZE).keys()].filter((tx) => softRoamLight(w.cfg, tx, 2, w.step) === 256);
      const dark = [...Array(SIZE).keys()].filter((tx) => softRoamLight(w.cfg, tx, 2, w.step) === 0);
      expect(lit.length).toBeGreaterThan(0);
      expect(dark.length).toBeGreaterThan(0);
      return Object.assign(w, { litTile: lit[0], darkTile: dark[0] });
    };
    const w = mk() as SoftRoamWorld & { litTile: number; darkTile: number };
    const bareW = mk() as SoftRoamWorld & { litTile: number; darkTile: number };
    for (const tx of [w.litTile, w.darkTile]) { w.food[2 * SIZE + tx] += 200; w.reservoir -= 200; }
    const withFood = image(w, 1, new SoftPaintMemory());
    const without = image(bareW, 1, new SoftPaintMemory());
    const at = (px: Uint8Array, tx: number) => { const p = ((2 * SCALE + 2) * SIDE + tx * SCALE + 3) * 4; return px[p] + px[p + 1] + px[p + 2]; };
    expect(at(withFood, w.litTile)).toBeGreaterThan(at(without, w.litTile) + 25);
    expect(at(withFood, w.darkTile)).toBeGreaterThan(at(without, w.darkTile) + 5);
    expect(at(withFood, w.litTile)).toBeGreaterThan(at(withFood, w.darkTile) + 25);
  });

  it('the winter floor shows: a winter of 0 is dark all over at the bottom of the year, a winter of 1 looks like midsummer', () => {
    const spread = (px: Uint8Array): number => { let lo = 1e9, hi = 0; for (let tx = 0; tx < SIZE; tx++) { const v = column(px, tx); lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    const dark = image(sky({ year: 384, winter: 0 }), 1, new SoftPaintMemory());
    const full = image(sky({ year: 384, winter: 1 }), 1, new SoftPaintMemory());
    const some = image(sky({ year: 384, winter: 0.5 }), 1, new SoftPaintMemory());
    expect(spread(dark)).toBeLessThanOrEqual(6);
    expect(spread(full)).toBeGreaterThan(40);
    expect(spread(some)).toBeGreaterThan(spread(dark) + 10);
    expect(spread(some)).toBeLessThan(spread(full));
    // Winter 1 is no winter: the bottom of the year is the same picture as the top (192 is midsummer at the same hour of a 64-step day).
    const w = sky({ year: 384, winter: 1 });
    while (w.step < 192) w.stepOnce();
    expect(image(w, 1, new SoftPaintMemory())).toEqual(full);
    // Brightness follows the floor in order.
    const mean = (px: Uint8Array) => { let t = 0; for (let tx = 0; tx < SIZE; tx++) t += column(px, tx); return t; };
    expect(mean(dark)).toBeLessThan(mean(some));
    expect(mean(some)).toBeLessThan(mean(full));
  });

  it('a leaf shows what it earns: brighter in the light than in the dark, and not at all lit when leaf income is 0', () => {
    const leafWorld = (leaf: number, lit: boolean) => {
      const w = bare({ kinds: true, drain: 1, day: 64, leaf, size: SIZE });
      const tx = [...Array(SIZE).keys()].find((t) => softRoamLight(w.cfg, t, 8, 0) === (lit ? 256 : 0))!;
      const c = put(w, tx * U + U / 2, 8 * U);
      w.kind[c] = KIND_LEAF;
      return { w, c };
    };
    const green = (leaf: number, lit: boolean): number => {
      const { w, c } = leafWorld(leaf, lit);
      const mem = new SoftPaintMemory();
      // The light the leaf stands in eases over many steps; the day moves on meanwhile, so hold the cell's light by taking the picture at once and again after some steps.
      for (let i = 0; i < 3; i++) w.stepOnce();
      const at = [0, 0];
      let g = 0;
      const frame = image(w, 1, mem);
      softCellPosition(w, c, 1, at);
      const p = ((Math.floor(at[1] * SCALE)) * SIDE + Math.floor(at[0] * SCALE)) * 4;
      g = frame[p + 1];
      return g;
    };
    expect(green(2, true)).toBeGreaterThan(green(2, false) + 8);
    expect(green(4, true)).toBeGreaterThan(green(0, true) + 8);
    expect(green(1, true)).toBeGreaterThan(green(0, true) + 8);
    expect(green(0, true)).toBeLessThanOrEqual(green(0, false) + 1);
  });

  it('a leaf shows what it was paid, not what it could have been: a lit leaf on an empty reservoir looks like an unlit one', () => {
    const run = (funded: boolean): number => {
      const w = bare({ kinds: true, drain: 1, day: 64, leaf: 4, size: SIZE });
      const tx = [...Array(SIZE).keys()].find((t) => softRoamLight(w.cfg, t, 8, 0) === 256)!;
      const c = put(w, tx * U + U / 2, 8 * U);
      w.kind[c] = KIND_LEAF;
      if (!funded) { w.food[0] += w.reservoir; w.reservoir = 0; }
      const mem = new SoftPaintMemory();
      for (let i = 0; i < 3; i++) w.stepOnce();
      const at = [0, 0];
      const frame = image(w, 1, mem);
      softCellPosition(w, c, 1, at);
      return frame[((Math.floor(at[1] * SCALE)) * SIDE + Math.floor(at[0] * SCALE)) * 4 + 1];
    };
    expect(run(true)).toBeGreaterThan(run(false) + 8);
  });

  // Pinned from the painter before the sun was added; the garden pins re-pinned on purpose in chunk 4 (grazing motes, the muted idle mouth,
  // attack beads and bite marks: CONTRACT-4.md), the plain pin untouched. What this guards still holds: without a day the sun adds nothing.
  it('a world without a day paints exactly as the painter before the sun was added did (pinned from that painter)', () => {
    const fnv = (b: Uint8Array) => { let h = 0x811c9dc5; for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
    const grown = foundSoftRoam({ seed: 3, size: 32, start: 'grown-all' });
    grown.advance(120);
    const side = 32 * SCALE;
    const px = (w: SoftRoamWorld, paint: 'garden' | 'plain', alpha: number) => { const o = new Uint8Array(side * side * 4); paintSoftRoam(w, paint, SCALE, alpha, o, new SoftPaintMemory()); return o; };
    expect(fnv(px(grown, 'garden', 0.4))).toBe(3315934054);
    expect(fnv(px(grown, 'plain', 0.4))).toBe(3348190510);
    const gar = foundSoftRoam({ seed: 5, size: 32, start: 'garden' });
    gar.advance(400);
    expect(fnv(px(gar, 'garden', 0.7))).toBe(1208747482);
  });
});
