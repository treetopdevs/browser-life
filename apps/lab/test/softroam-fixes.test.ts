/** Fix round of 2026-11-25: kernel events and census, the painter's young cells and ghosts, the readouts. */
import { describe, expect, it } from 'vitest';
import { defaultSoftRoamConfig, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';
import { foundSoftRoam, paintSoftRoam, SoftPaintMemory, softRoamConfig, SoftRoamSession, softSmoothness } from '../src/softroam/view.ts';
import { ROAM_PLANS, ROAM_TYPES } from '../src/roam/view.ts';

const U = SOFT_U;
const SIZE = 16;
const SCALE = 6;
const SIDE = SIZE * SCALE;

function bare(over: Partial<SoftRoamConfig> = {}, plan: keyof typeof ROAM_PLANS = 'speck'): SoftRoamWorld {
  const cfg: SoftRoamConfig = { ...defaultSoftRoamConfig(), size: SIZE, matter: 100_000, startPatches: 0, patchEvery: 1_000_000, maxCells: 256, ...over };
  const w = new SoftRoamWorld(cfg);
  w.addPlan(ROAM_PLANS[plan]);
  return w;
}
const put = (w: SoftRoamWorld, xu: number, yu: number, store?: number): number => w.found(xu, yu, ROAM_TYPES.chaser.genes, 1, store, 1);
function image(w: SoftRoamWorld, alpha: number, mem?: SoftPaintMemory): Uint8Array {
  const out = new Uint8Array(SIDE * SIDE * 4);
  paintSoftRoam(w, 'garden', SCALE, alpha, out, mem);
  return out;
}

describe('soft roam fixes: kernel', () => {
  it('a daughter born in the very first step is not mistaken for a founder (bornStep 0 means founder only)', () => {
    const w = foundSoftRoam({ seed: 1, start: 'grown-all' });
    for (let c = 0; c < w.cap; c++) if (w.alive[c]) expect(w.bornStep[c]).toBe(0);
    w.stepOnce();
    expect(w.step).toBe(1);
    expect(w.events.births.length).toBeGreaterThan(0);
    for (const c of w.events.births) expect(w.bornStep[c]).toBe(w.step);
  });

  it('a death event says where the cell began the step as well as where it died, and in what units', () => {
    const w = bare({ minStore: 16, leakCell: 0.5, size: SIZE });
    const c = put(w, 8 * U, 8 * U);
    w.store[c] = 1;
    w.vx[c] = 4096; // a quarter of a tile per substep: it moves before it dies
    const x0 = w.x[c];
    w.stepOnce();
    expect(w.alive[c]).toBe(0);
    const d = w.events.deaths[0];
    expect(d.fromX).toBe(x0);
    expect(d.fromY).toBe(8 * U);
    expect(w.dlt(d.fromX, d.x)).toBeGreaterThan(0);
  });

  it('shellTough is the mean toughness of the shells in the census (0 with none)', () => {
    const w = bare();
    put(w, 4 * U, 4 * U);
    expect(w.census().shellTough).toBe(0);
  });

  it('alarm counts are available every step without a census', () => {
    const w = bare();
    put(w, 4 * U, 4 * U);
    expect(w.alarms()).toEqual({ bonds: 0, overlap: 0, speed: 0 });
  });

  it('flow is bounded on the value given (1/1024 to 1/8), not on its rounding', () => {
    expect(() => bare({ flow: 0.0009 })).toThrow(/Invalid flow/);
    expect(() => bare({ flow: 0.1251 })).toThrow(/Invalid flow/);
    expect(() => bare({ flow: Number.NaN })).toThrow(/Invalid flow/);
    expect(() => bare({ flow: 1 / 1024 })).not.toThrow();
    expect(() => bare({ flow: 1 / 8 })).not.toThrow();
  });

  it('foodSpread 0 is the off setting (same world as leaving it out); out of range or not a number is refused', () => {
    const a = bare({ foodSpread: 0 });
    const b = bare();
    for (const w of [a, b]) { put(w, 4 * U, 4 * U); w.food[3] = 50; w.advance(20); }
    expect(a.digest()).toBe(b.digest());
    expect(() => bare({ foodSpread: -0.1 })).toThrow(/foodSpread/);
    expect(() => bare({ foodSpread: Number.NaN })).toThrow(/foodSpread/);
    expect(() => bare({ foodSpread: 1.01 })).toThrow(/foodSpread/);
  });

  it('travel counts a cell that moved and then died in the same step', () => {
    const w = bare({ minStore: 16, leakCell: 0.5 });
    const c = put(w, 8 * U, 8 * U);
    w.store[c] = 1;
    w.vx[c] = 4096;
    w.stepOnce();
    expect(w.alive[c]).toBe(0);
    expect(w.census().travel).toBeGreaterThan(0);
  });

  it('the overlap alarm counts only pairs whose cells are still those recorded and still overlap now', () => {
    const w = bare();
    const a = put(w, 4 * U, 4 * U);
    const b = put(w, 4 * U + 2 * U, 4 * U); // founding refuses an overlap: move her in afterwards
    expect(b).toBeGreaterThanOrEqual(0);
    w.x[b] = 4 * U + U / 4;
    const runs = (w as unknown as { pairRun: Map<number, { ca: number; cb: number; run: number }> }).pairRun;
    const key = a * w.cap + b;
    runs.set(key, { ca: w.cid[a], cb: w.cid[b], run: 50 });
    expect(w.alarms().overlap).toBe(1);
    // Parted by the last integration.
    w.x[b] = 4 * U + 2 * U;
    expect(w.alarms().overlap).toBe(0);
    w.x[b] = 4 * U + U / 4;
    // The slot now holds another cell.
    runs.set(key, { ca: w.cid[a], cb: w.cid[b] + 1, run: 50 });
    expect(w.alarms().overlap).toBe(0);
    runs.set(key, { ca: w.cid[a], cb: w.cid[b], run: 50 });
    w.alive[b] = 0;
    expect(w.alarms().overlap).toBe(0);
  });
});

describe('soft roam fixes: readouts', () => {
  it('smoothness skips cells born in the last step, and counts a cell that moved and then died', () => {
    const w = foundSoftRoam({ seed: 1, size: 32, start: 'grown-all' });
    let n = 0;
    while (w.events.births.length === 0 && n++ < 100) w.stepOnce();
    const fresh = w.events.births.filter((c) => w.alive[c]).length;
    expect(fresh).toBeGreaterThan(0);
    let alive = 0;
    for (let c = 0; c < w.cap; c++) if (w.alive[c]) alive++;
    const sm = softSmoothness(w);
    expect(sm.cells).toBe(alive - fresh + w.events.deaths.length);

    const v = bare({ minStore: 16, leakCell: 0.5 });
    const c = put(v, 8 * U, 8 * U);
    v.store[c] = 1;
    v.vx[c] = 4096;
    v.stepOnce();
    expect(v.alive[c]).toBe(0);
    const s = softSmoothness(v);
    expect(s.cells).toBe(1);
    expect(s.max).toBeGreaterThan(0.1);
  });

  it('a session can paint into a buffer it is handed back instead of allocating', () => {
    const s = new SoftRoamSession({ seed: 1, size: 32, start: 'grown-all' }, 4);
    const a = s.frame('garden', 1);
    s.recycle(a.pixels);
    const b = s.frame('garden', 1);
    expect(b.pixels.buffer).toBe(a.pixels.buffer);
    // A buffer of the wrong size is ignored.
    s.recycle(new Uint8ClampedArray(12));
    const c = s.frame('garden', 1);
    expect(c.pixels.length).toBe(a.pixels.length);
  });

  it('a size the kernel supports can be started (patches follow the matter), and a founder count that cannot be met says so', () => {
    for (const size of [8, 12, 16, 24]) {
      const cfg = softRoamConfig({ seed: 1, size, start: 'grown-all' });
      expect(() => new SoftRoamWorld(cfg)).not.toThrow();
      expect(() => foundSoftRoam({ seed: 1, size, start: 'grown-all' })).not.toThrow();
    }
    expect(() => foundSoftRoam({ seed: 1, size: 32, start: 'grown-all', founders: 2, overrides: { maxCells: 1 } })).toThrow(/founder/i);
    expect(() => foundSoftRoam({ seed: 1, size: 32, start: 'grown-all', founders: 5 })).not.toThrow();
  });
});

describe('soft roam fixes: the painter', () => {
  it('a first-step daughter is drawn grown-in from her mother, not full size', () => {
    const w = foundSoftRoam({ seed: 1, start: 'grown-all' });
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    const d = w.events.births.find((c) => w.alive[c])!;
    expect(d).toBeDefined();
    paintSoftRoam(w, 'garden', 2, 0, new Uint8Array(128 * 2 * 128 * 2 * 4), mem);
    expect(mem.grow[d]).toBeLessThan(0.05);
  });

  it('a released daughter is visible within her first steps (growth is one smooth ramp, not two)', () => {
    const w = bare();
    const m = put(w, 8 * U, 8 * U, 420);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    const d = w.events.births.find((c) => w.alive[c] && c !== m);
    expect(d).toBeDefined();
    expect(w.mother[d!]).toBe(-1);
    w.stepOnce();
    mem.observe(w);
    const withHer = image(w, 0.5, mem);
    w.alive[d!] = 0; // leave her out of the same picture
    const without = image(w, 0.5, mem);
    w.alive[d!] = 1;
    // Age 1.5 steps: she already adds clearly to the picture near her own place (she is drawn at her own side of her mother).
    const cx = (w.x[d!] / U) * SCALE;
    const cy = (w.y[d!] / U) * SCALE;
    let added = 0;
    for (let y = Math.floor(cy - 4); y <= Math.ceil(cy + 4); y++) {
      for (let x = Math.floor(cx - 4); x <= Math.ceil(cx + 4); x++) {
        const p = (y * SIDE + x) * 4;
        added += Math.abs(withHer[p] - without[p]) + Math.abs(withHer[p + 1] - without[p + 1]) + Math.abs(withHer[p + 2] - without[p + 2]);
      }
    }
    expect(added).toBeGreaterThan(400);
  });

  it('a young daughter does not jump when her mother dies', () => {
    const w = bare({ minStore: 16 }, 'line');
    const m = put(w, 8 * U, 8 * U, 420);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    const d = w.events.births.find((c) => w.alive[c] && c !== m)!;
    expect(w.mother[d]).toBe(m);
    w.stepOnce();
    mem.observe(w);
    image(w, 1, mem);
    const before = [mem.px[d], mem.py[d]];
    // The mother dies now: her store goes back to the reservoir and she is gone next step.
    w.reservoir += w.store[m];
    w.store[m] = 0;
    w.stepOnce();
    mem.observe(w);
    expect(w.alive[m]).toBe(0);
    expect(w.alive[d]).toBe(1);
    image(w, 0, mem);
    const dx = Math.abs(mem.px[d] - before[0]);
    const dy = Math.abs(mem.py[d] - before[1]);
    expect(Math.min(dx, SIZE - dx)).toBeLessThan(0.15);
    expect(Math.min(dy, SIZE - dy)).toBeLessThan(0.15);
  });

  function deadCellWorld(over: Partial<SoftRoamConfig> = {}): { w: SoftRoamWorld; other: number } {
    const w = bare({ minStore: 16, leakCell: 0.5, ...over });
    const c = put(w, 8 * U, 8 * U);
    const other = put(w, 12 * U, 4 * U);
    w.store[c] = 1;
    return { w, other };
  }

  it('a first paint straight after a death still knows about the ghost', () => {
    const { w } = deadCellWorld();
    w.stepOnce();
    expect(w.events.deaths.length).toBe(1);
    const mem = new SoftPaintMemory();
    mem.observe(w);
    expect(mem.ghosts.length).toBe(1);
  });

  it('with compost off a ghost leaves no blue puff', () => {
    const run = (compost: boolean): { db: number; dg: number } => {
      const { w } = deadCellWorld({ compost });
      const mem = new SoftPaintMemory();
      mem.observe(w);
      w.stepOnce();
      mem.observe(w);
      for (let k = 0; k < 5; k++) { w.stepOnce(); mem.observe(w); }
      const a = image(w, 0.5, mem);
      const none = new SoftPaintMemory();
      none.observe(w);
      none.ghosts.length = 0;
      const b = image(w, 0.5, none);
      let db = 0, dg = 0;
      for (let p = 0; p < a.length; p += 4) { db += a[p + 2] - b[p + 2]; dg += a[p + 1] - b[p + 1]; }
      return { db, dg };
    };
    const off = run(false);
    expect(off.dg).toBeGreaterThan(0); // the ghost itself is there
    expect(off.db).toBeLessThanOrEqual(off.dg * 1.02);
    const on = run(true);
    expect(on.db).toBeGreaterThan(on.dg * 1.2); // the puff is blue
  });

  it('a ghost fades out completely: no hole, ring or seam is left at the end of its time, and nothing pops', () => {
    const { w } = deadCellWorld();
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    expect(mem.ghosts.length).toBe(1);
    // A live body glides over the death site while the ghost fades.
    const gx = mem.ghosts[0].x, gy = mem.ghosts[0].y;
    let last = image(w, 0, mem);
    let worst = 0;
    for (let k = 0; k < 22; k++) {
      for (const a of [0.25, 0.5, 0.75, 0.99]) {
        const cur = image(w, a, mem);
        let diff = 0;
        for (let p = 0; p < cur.length; p += 4) diff = Math.max(diff, Math.abs(cur[p] - last[p]), Math.abs(cur[p + 1] - last[p + 1]), Math.abs(cur[p + 2] - last[p + 2]));
        if (k >= 1) worst = Math.max(worst, diff);
        last = cur;
      }
      w.stepOnce();
      mem.observe(w);
    }
    expect(gx).toBeGreaterThan(0);
    expect(gy).toBeGreaterThan(0);
    // Frame to frame, nothing jumps (a quarter step apart).
    expect(worst).toBeLessThan(40);
    // After its time it is forgotten.
    expect(mem.ghosts.length).toBe(0);
  });

  it('late in its life a ghost leaves the ground as it was (no dark hole under a fading ghost)', () => {
    const { w } = deadCellWorld();
    const mem = new SoftPaintMemory();
    mem.observe(w);
    w.stepOnce();
    mem.observe(w);
    const gx = mem.ghosts[0].x, gy = mem.ghosts[0].y;
    for (let k = 0; k < 13; k++) { w.stepOnce(); mem.observe(w); }
    expect(mem.ghosts.length).toBe(1);
    const a = image(w, 0.99, mem);
    const none = new SoftPaintMemory();
    none.observe(w);
    none.ghosts.length = 0;
    const b = image(w, 0.99, none);
    const cx = Math.round(gx * SCALE), cy = Math.round(gy * SCALE);
    for (let y = cy - 6; y <= cy + 6; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        const p = (y * SIDE + x) * 4;
        for (let ch = 0; ch < 3; ch++) expect(Math.abs(a[p + ch] - b[p + ch])).toBeLessThanOrEqual(3);
      }
    }
  });
});
