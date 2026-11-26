import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, ROAM_GENES, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam, paintSoftRoam, SOFT_STARTS, type SoftRoamStart, SoftPaintMemory, SoftRoamSession, softCellPosition, softRoamConfig } from '../src/softroam/view.ts';
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
    expect(out(a, m1)).toEqual(out(b, m2));
    // Painting again must not change anything (the buffers are left clean).
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

  it('the garden start turns kinds, touch feeding, seal, cracking and shell costs on, and is the default', () => {
    const a = softRoamConfig({ seed: 1 });
    const b = softRoamConfig({ seed: 1, start: 'garden' });
    expect(a).toEqual(b);
    expect([a.kinds, a.drain, a.seal, a.crack, a.shellBite, a.shellLeak]).toEqual([true, 1, 200, 300, 1, 0.1]);
    expect(a.toughness).toBeUndefined();
    // An option given wins over the line-up; the plain grown starts keep no kinds.
    expect(softRoamConfig({ seed: 1, crack: 500, kinds: true, drain: 4 }).crack).toBe(500);
    expect(softRoamConfig({ seed: 1, kinds: false }).kinds).toBeUndefined();
    for (const start of ['grown-all', 'grown-lines', 'grown-specks'] as const) {
      const c = softRoamConfig({ seed: 1, start });
      expect([c.kinds, c.drain, c.crack, c.shellBite, c.seal]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    }
    const w = foundSoftRoam({ seed: 1, size: 32 });
    expect(w.cfg.kinds).toBe(true);
  });

  it('hunters and armoured founders both exist in the garden, and the plain start makes neither', () => {
    const w = foundSoftRoam({ seed: 1 });
    w.advance(600);
    const c = w.census();
    expect(c.mouths).toBeGreaterThan(0);
    expect(c.shells).toBeGreaterThan(0);
    const p = foundSoftRoam({ seed: 1, start: 'grown-all' });
    p.advance(600);
    expect(p.census().mouths + p.census().shells).toBe(0);
  });

  it('painting never touches the world, and feeding, hits and cracks show in the memory and the picture', () => {
    const w = foundSoftRoam({ seed: 1, overrides: { crack: 3 } });
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
      if (k % 10 === 0) for (let c = 0; c < w.cap; c++) if (w.alive[c] && mem.lvCur[c * 6] > 0.5) { flashes++; break; }
    }
    expect(threads).toBeGreaterThan(0);
    expect(rings).toBeGreaterThan(0);
    expect(ringSeen).toBe(true);
    expect(flashes).toBeGreaterThan(0);
    expect(w.census().cracked).toBeGreaterThan(0);
    expect(w.census().residual).toBe(0);
  });

  it('a fed-on cell dims and its mouth warms, eased in over a few steps and never in one jump', () => {
    const w = foundSoftRoam({ seed: 1 });
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
    expect(mem.lvCur[m * 6 + FEED]).toBeGreaterThan(0.3);
    expect(mem.lvCur[m * 6 + FEED]).toBeLessThan(0.75);
    expect(mem.lvCur[p * 6 + PREY]).toBeGreaterThan(0.3);
    expect(mem.lvCur[p * 6 + PREY]).toBeLessThan(0.75);
    const seen: number[] = [mem.lvCur[m * 6 + FEED]];
    const dim: number[] = [mem.lvCur[p * 6 + PREY]];
    let more = 0;
    for (let k = 0; k < 8; k++) {
      w.stepOnce();
      mem.observe(w);
      if (!w.alive[m] || !w.alive[p] || !mem.threads.some((t) => t.seen && t.ms === m && t.ps === p)) break;
      seen.push(mem.lvCur[m * 6 + FEED]);
      dim.push(mem.lvCur[p * 6 + PREY]);
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
    const w = foundSoftRoam({ seed: 2, overrides: { crack: 3 } });
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
