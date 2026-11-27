import { describe, expect, it } from 'vitest';
import { DEEP_HOME, DEEP_SLANT, foundSoftRoam, paintSoftRoam, type SoftPaint, SoftPaintMemory, softFamily, softRoamConfig } from '../src/softroam/view.ts';
import { defaultSoftRoamConfig, KIND_LEAF, KIND_MOUTH, KIND_PLAIN, planEntry, SOFT_U, type SoftRoamConfig, SoftRoamWorld } from '../src/softroam/kernel.ts';

/**
 * Soft Roam depth (2026-11-26): levels in the top-down world. Bodies meet only on the same level, ground food is on the floor, light comes
 * from above and is dimmed and shaded on the way down, and a body moves one level at a time toward the level it wants. Small hand-built
 * worlds where nothing moves unless a test says so, then a run with everything on.
 */

const U = SOFT_U;
const genesOf = (chase: number, drive = 0): number[] => [chase, drive, -512, 0, 0];
const SITTER = genesOf(0);
const CHASER = genesOf(512);
const P = KIND_PLAIN;
const M = KIND_MOUTH;

const still = (over: Partial<SoftRoamConfig> = {}): SoftRoamConfig => ({
  ...defaultSoftRoamConfig(),
  size: 16,
  matter: 700_000,
  maxCells: 64,
  startPatches: 0,
  patchEvery: 1_000_000,
  mut: 0,
  planMut: 0,
  leakSide: 0,
  leakCell: 0,
  moveCost: 0,
  life: undefined,
  compost: undefined,
  turnMax: 0,
  minStore: 1,
  flow: 1 / 1024,
  kinds: true,
  drain: 3,
  seal: 0,
  depth: 3,
  depthDive: 0,
  ...over,
});

const restPlan = (w: SoftRoamWorld): number => w.addPlan(Array.from({ length: 16 }, (_, m) => planEntry(8, 0, m)));

type Priv = { _reverseScan: boolean; lvlCount: Uint16Array; lightOn(tx: number, ty: number, lv: number, step: number): number; lvlStep: Uint32Array };
const priv = (w: SoftRoamWorld): Priv => w as unknown as Priv;

function spawn(w: SoftRoamWorld, px: number, py: number, genes: readonly number[], store: number, plan: number, kind = P, level = 0, lift?: number): number {
  const a = w as unknown as { allocate(): number; place(c: number, x: number, y: number, g: readonly number[], f: number, s: number, p: number): void; labelHi: number };
  const c = a.allocate();
  a.place(c, px, py, genes, 0, store, plan);
  w.reservoir -= store;
  w.heading[c] = 0;
  w.orient[c] = 0;
  w.mother[c] = -1;
  w.kind[c] = kind;
  w.body[c] = ++a.labelHi;
  w.bodySize[w.body[c]] = 1;
  w.bodyCount++;
  w.setLevel(c, level, lift);
  return c;
}
function link(w: SoftRoamWorld, c: number, m: number, gx: number, gy: number): void {
  w.bodySize[w.body[c]]--;
  w.bodyCount--;
  w.mother[c] = m;
  w.body[c] = w.body[m];
  w.bodySize[w.body[m]]++;
  w.gx[c] = gx;
  w.gy[c] = gy;
}

describe('soft roam depth: config checks', () => {
  it('refuses bad levels and keys without depth', () => {
    const make = (o: Partial<SoftRoamConfig>) => () => new SoftRoamWorld(still(o));
    expect(make({ depth: 1 })).toThrow(/Invalid depth/);
    expect(make({ depth: 5 })).toThrow(/Invalid depth/);
    for (const k of ['depthGap', 'depthCost', 'depthDive', 'depthDim', 'depthShade'] as const) expect(make({ depth: undefined, depthDive: undefined, [k]: 1 })).toThrow(new RegExp(`${k} needs depth`));
    expect(make({ depthGap: 0 })).toThrow(/Invalid depthGap/);
    const w = new SoftRoamWorld(still({ depth: undefined, depthDive: undefined }));
    expect(() => w.setLevel(0, 0)).toThrow(/setLevel needs depth/);
    expect(w.census().levels).toEqual([]);
  });
});

describe('soft roam depth: bodies meet only on the same level', () => {
  it('overlapping cells push apart on one level and pass through each other on two', () => {
    const gapAfter = (lb: number): number => {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      const a = spawn(w, 8 * U, 8 * U, SITTER, 150, plan, P, 1);
      const b = spawn(w, 8 * U + 400, 8 * U, SITTER, 150, plan, P, lb);
      for (let t = 0; t < 20; t++) w.stepOnce();
      w.checkInvariants();
      return Math.abs(w.dlt(w.x[a], w.x[b]));
    };
    expect(gapAfter(1)).toBeGreaterThan(400);
    expect(gapAfter(2)).toBe(400);
    expect(gapAfter(0)).toBe(400);
  });

  it('a mouth feeds on prey on its own level only', () => {
    const drained = (lp: number): number => {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      const m0 = spawn(w, 6 * U, 8 * U, SITTER, 150, plan, M, 1);
      const m1 = spawn(w, 7 * U, 8 * U, SITTER, 150, plan, M, 1);
      link(w, m1, m0, 1, 0);
      spawn(w, 8 * U + 100, 8 * U, SITTER, 150, plan, P, lp);
      for (let t = 0; t < 5; t++) w.stepOnce();
      w.checkInvariants();
      return w.census().drained;
    };
    expect(drained(1)).toBeGreaterThan(0);
    expect(drained(0)).toBe(0);
    expect(drained(2)).toBe(0);
  });

  it('a birth spot is blocked only by a cell of the mother\'s level', () => {
    const cellsAfter = (lb: number): number => {
      const w = new SoftRoamWorld(still({ birthStore: 50 }));
      // Mode 0 keeps one daughter straight on, then rests.
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
      const rest = restPlan(w);
      const a = w.found(8 * U, 8 * U, SITTER, 1, 400, plan);
      w.setLevel(a, 1);
      // A resting cell sits where the daughter would be born (the founder's heading is drawn, so ring it on all four sides).
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) spawn(w, (8 + dx) * U, (8 + dy) * U, SITTER, 60, rest, P, lb);
      for (let t = 0; t < 3; t++) w.stepOnce();
      return w.census().cells;
    };
    expect(cellsAfter(1)).toBe(5);
    expect(cellsAfter(2)).toBe(6);
  });

  it('two births at one spot in one step block each other only on the same level', () => {
    const cellsAfter = (lb: number): number => {
      const w = new SoftRoamWorld(still({ birthStore: 50, depthGap: 1000 }));
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
      // Two ready mothers facing each other across one empty spot.
      const a = w.found(7 * U, 8 * U, SITTER, 1, 400, plan);
      const b = w.found(9 * U, 8 * U, SITTER, 2, 400, plan);
      w.heading[a] = 0;
      w.orient[a] = 0;
      w.heading[b] = 512;
      w.orient[b] = 2;
      w.setLevel(a, 1);
      w.setLevel(b, lb);
      w.stepOnce();
      return w.census().cells;
    };
    expect(cellsAfter(1)).toBe(3);
    expect(cellsAfter(2)).toBe(4);
  });
});

describe('soft roam depth: food on the floor, light from above', () => {
  it('only floor cells eat from the ground', () => {
    const w = new SoftRoamWorld(still());
    const plan = restPlan(w);
    const lo = spawn(w, 4 * U + 512, 4 * U + 512, SITTER, 100, plan, P, 0);
    const hi = spawn(w, 10 * U + 512, 10 * U + 512, SITTER, 100, plan, P, 2);
    w.food[4 * 16 + 4] += 50;
    w.food[10 * 16 + 10] += 50;
    w.reservoir -= 100;
    w.stepOnce();
    expect(w.store[lo]).toBeGreaterThan(100);
    expect(w.store[hi]).toBe(100);
    expect(w.food[10 * 16 + 10]).toBe(50);
    w.checkInvariants();
  });

  it('light is dimmed by each level under the surface and shaded by each cell above, at most eight', () => {
    const w = new SoftRoamWorld(still({ depthDim: 0.25, depthShade: 0.5 }));
    const p = priv(w);
    // No day: the tile's light is 256.
    expect(p.lightOn(3, 3, 2, 0)).toBe(256);
    expect(p.lightOn(3, 3, 1, 0)).toBe(192);
    expect(p.lightOn(3, 3, 0, 0)).toBe(128);
    p.lvlCount[(3 * 16 + 3) * 3 + 2] = 1;
    expect(p.lightOn(3, 3, 2, 0)).toBe(256);
    expect(p.lightOn(3, 3, 1, 0)).toBe(96);
    p.lvlCount[(3 * 16 + 3) * 3 + 1] = 1;
    expect(p.lightOn(3, 3, 0, 0)).toBe(32);
    p.lvlCount[(3 * 16 + 3) * 3 + 2] = 40;
    expect(p.lightOn(3, 3, 0, 0)).toBe(0);
    expect(p.lightOn(3, 3, 1, 0)).toBe(0);
    p.lvlCount.fill(0);
  });

  it('a leaf under another body earns less than a leaf in the open, and leaves on different levels do not share a tile\'s light', () => {
    const w = new SoftRoamWorld(still({ day: 16, leaf: 4, birthStore: 250, depthDim: 0, depthShade: 0.5 }));
    const plan = restPlan(w);
    // Three leaves in one column of tiles (the day band's light depends on x only): one alone on the surface, one on the floor under a
    // surface leaf, and that surface leaf.
    const open = spawn(w, 8 * U + 512, 2 * U + 512, SITTER, 100, plan, KIND_LEAF, 2);
    const under = spawn(w, 8 * U + 512, 9 * U + 512, SITTER, 100, plan, KIND_LEAF, 0);
    const over = spawn(w, 8 * U + 512, 9 * U + 512, SITTER, 100, plan, KIND_LEAF, 2);
    for (let t = 0; t < 64; t++) w.stepOnce();
    w.checkInvariants();
    const got = (c: number): number => w.store[c] - 100;
    expect(got(open)).toBeGreaterThan(0);
    // The surface leaf over another is not shaded and does not share with the one below.
    expect(Math.abs(got(over) - got(open))).toBeLessThanOrEqual(got(open) / 4);
    // The floor leaf gets about half.
    expect(got(under)).toBeLessThan((got(open) * 3) / 4);
    expect(got(under)).toBeGreaterThan(got(open) / 4);
  });
});

describe('soft roam depth: changing level', () => {
  it('a body moves one level at a time toward its home level, once in depthGap steps, each cell paying depthCost', () => {
    const w = new SoftRoamWorld(still({ depthGap: 10, depthCost: 2 }));
    const plan = restPlan(w);
    // On the floor with a lift that says surface.
    const a = spawn(w, 8 * U, 8 * U, SITTER, 100, plan, P, 0, 250);
    const b = spawn(w, 9 * U, 8 * U, SITTER, 100, plan, P, 0, 250);
    link(w, b, a, 1, 0);
    w.stepOnce();
    expect([w.level[a], w.level[b]]).toEqual([1, 1]);
    expect([w.store[a], w.store[b]]).toEqual([98, 98]);
    for (let t = 0; t < 9; t++) w.stepOnce();
    expect(w.level[a]).toBe(1);
    w.stepOnce();
    expect([w.level[a], w.level[b]]).toEqual([2, 2]);
    expect(w.store[a]).toBe(96);
    for (let t = 0; t < 30; t++) w.stepOnce();
    expect(w.level[a]).toBe(2);
    expect(w.store[a]).toBe(96);
    const cs = w.census();
    expect(cs.levels).toEqual([0, 0, 2]);
    expect(cs.levelMoves).toBe(2);
    expect(cs.residual).toBe(0);
  });

  it('the home level is the mean lift of the body', () => {
    const w = new SoftRoamWorld(still({ depthGap: 1, depthCost: 0 }));
    const plan = restPlan(w);
    const a = spawn(w, 8 * U, 8 * U, SITTER, 100, plan, P, 0, 0);
    const b = spawn(w, 9 * U, 8 * U, SITTER, 100, plan, P, 0, 255);
    link(w, b, a, 1, 0);
    for (let t = 0; t < 5; t++) w.stepOnce();
    // Mean 127.5: floor(127.5 * 3 / 256) = 1.
    expect([w.level[a], w.level[b]]).toEqual([1, 1]);
    // Lifts 85 and 86: the exact mean 85.5 gives floor(256.5 / 256) = 1 (a mean floored first would give 0).
    const c = spawn(w, 3 * U, 3 * U, SITTER, 100, plan, P, 0, 85);
    const d = spawn(w, 4 * U, 3 * U, SITTER, 100, plan, P, 0, 86);
    link(w, d, c, 1, 0);
    for (let t = 0; t < 3; t++) w.stepOnce();
    expect([w.level[c], w.level[d]]).toEqual([1, 1]);
  });

  it('a half-fed prey flees a threat on its level toward its home level, not by the hunger rule', () => {
    const w = new SoftRoamWorld(still({ size: 32, fear: 4, steer: true, depthGap: 1, depthCost: 0, depthDive: 1, birthStore: 100, drain: 1 }));
    const plan = restPlan(w);
    const h0 = spawn(w, 8 * U, 8 * U, SITTER, 300, plan, M, 1, 128);
    const h1 = spawn(w, 9 * U, 8 * U, SITTER, 300, plan, M, 1, 128);
    link(w, h1, h0, 1, 0);
    // Holding 150 (between one and two birth stores, so hunger says stay), on level 1 with the floor as home.
    const prey = spawn(w, 12 * U, 8 * U, CHASER, 150, plan, P, 1, 0);
    w.stepOnce();
    expect(w.level[prey]).toBe(0);
  });

  it('a hungry body goes to the floor, a half-fed one stays where it is, a fed one goes home', () => {
    const w = new SoftRoamWorld(still({ depthGap: 1, depthCost: 0, depthDive: 1, birthStore: 100 }));
    const plan = restPlan(w);
    // All at home on the surface; mean stores 60 (hungry), 120 (half fed) and 260 (fed).
    const hungry = spawn(w, 3 * U, 3 * U, SITTER, 60, plan, P, 2);
    const half = spawn(w, 8 * U, 8 * U, SITTER, 120, plan, P, 1, 250);
    const fed = spawn(w, 12 * U, 12 * U, SITTER, 260, plan, P, 0, 250);
    for (let t = 0; t < 4; t++) w.stepOnce();
    expect(w.level[hungry]).toBe(0);
    expect(w.level[half]).toBe(1);
    expect(w.level[fed]).toBe(2);
    // Food under the hungry one: it eats on the floor and comes back up once it holds 200.
    w.food[3 * 16 + 3] += 400;
    w.reservoir -= 400;
    for (let t = 0; t < 120 && w.level[hungry] !== 2; t++) w.stepOnce();
    expect(w.level[hungry]).toBe(2);
    expect(w.store[hungry]).toBeGreaterThanOrEqual(200);
    w.checkInvariants();
  });

  it('with steer a hunter goes to its prey\'s level and prey leaves a threat\'s level', () => {
    const w = new SoftRoamWorld(still({ size: 32, sight: 8, fear: 4, steer: true, depthGap: 1, depthCost: 0, drain: 1 }));
    const plan = restPlan(w);
    // A two-mouth hunter at home on the floor; a lone prey at home in mid-water, three tiles from the nearer mouth.
    const h0 = spawn(w, 8 * U, 8 * U, CHASER, 150, plan, M, 0, 0);
    const h1 = spawn(w, 9 * U, 8 * U, CHASER, 150, plan, M, 0, 0);
    link(w, h1, h0, 1, 0);
    const prey = spawn(w, 12 * U, 8 * U, CHASER, 150, plan, P, 1, 128);
    w.stepOnce();
    // The hunter rises to the prey's level; the prey saw the threat on another level and stayed.
    expect(w.level[h0]).toBe(1);
    expect(w.level[prey]).toBe(1);
    w.stepOnce();
    // Now they share a level and the prey is at home there: it goes up.
    expect(w.level[prey]).toBe(2);
    w.checkInvariants();
  });

  it('a daughter is born on her mother\'s level with her lift', () => {
    const w = new SoftRoamWorld(still({ birthStore: 50, depthGap: 1000 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
    const a = w.found(8 * U, 8 * U, SITTER, 1, 400, plan);
    w.setLevel(a, 2);
    for (let t = 0; t < 3; t++) w.stepOnce();
    const cells = [...Array(w.cap).keys()].filter((c) => w.alive[c]);
    expect(cells.length).toBe(2);
    for (const c of cells) { expect(w.level[c]).toBe(2); expect(w.lift[c]).toBe(w.lift[a]); }
  });
});

describe('soft roam depth: a run with everything on', () => {
  it('keeps matter exactly, uses every level, and has one history whatever the slot and scan order', () => {
    const run = (rev: boolean): { digest: number; levels: number[]; moves: number; seen: number[] } => {
      const w = new SoftRoamWorld(still({ size: 24, matter: 200_000, maxCells: 512, sight: 6, fear: 3, steer: true, pack: 2, crowd: 2, heal: true, pace: 0.25, shellThrust: 0.5, leakCell: 0.01, life: 400, grip: 64, birthStore: 40, startPatches: 6, patchEvery: 20, patchFood: 2000, turnMax: 1 / 32, planMut: 0.05, mut: 0.05,
        day: 100, year: 400, winter: 0.2, leaf: 1, leafPool: 0.5, leafPoolMax: 500, patchSeason: true, winterCost: 0.05, truce: true, compost: true, depth: 3, depthGap: 20, depthDive: 1 }));
      if (rev) w._testSlotOrder([...Array(512).keys()].reverse());
      priv(w)._reverseScan = rev;
      const grow = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 1, 2, P) : m === 1 ? planEntry(0, 15, 15, M) : m === 2 ? planEntry(1, 15, 3, KIND_LEAF) : m === 3 ? planEntry(2, 15, 4, P) : m === 4 ? planEntry(7, 0, 4, P) : planEntry(8, 0, m))));
      for (let k = 0; k < 12; k++) {
        const c = w.found(((k * 7) % 24) * U + 300, ((k * 11) % 24) * U + 300, genesOf(256 - 64 * (k % 3), 128), 1 + (k % 3), 300, grow);
        w.setLevel(c, k % 3);
      }
      // Cell-steps spent on each level over the run.
      const seen = [0, 0, 0];
      for (let t = 0; t < 600; t++) {
        w.stepOnce();
        if (t % 50 === 0) { w.checkInvariants(); w.census().levels.forEach((v, k) => { seen[k] += v; }); }
      }
      w.checkInvariants();
      const cs = w.census();
      expect(cs.residual).toBe(0);
      return { digest: w.digest(), levels: cs.levels, moves: cs.levelMoves, seen };
    };
    const a = run(false);
    const b = run(true);
    expect(b).toEqual(a);
    expect(a.levels.reduce((s, v) => s + v, 0)).toBeGreaterThan(12);
    expect(a.seen.every((v) => v > 0)).toBe(true);
    expect(a.moves).toBeGreaterThan(0);
  });
});

describe('soft roam depth: a dive threshold that is not a whole number of matter', () => {
  it('holds a body on the floor until its cells hold twice the threshold exactly', () => {
    // Half of 1.25 birth stores of 50 is 62.5 a cell: a cell with 124 (under 125) stays down, one with 125 rises.
    for (const [store, level] of [[124, 0], [125, 1]] as const) {
      const w = new SoftRoamWorld(still({ birthStore: 50, depthDive: 1.25, depthCost: 0, depthGap: 1 }));
      const c = w.found(8 * U, 8 * U, SITTER, 1, store, restPlan(w));
      w.setLevel(c, 0, 255);
      w.stepOnce();
      expect(w.level[c], `store ${store}`).toBe(level);
    }
  });
});

describe('soft roam depth: the deep start', () => {
  it('is the bodies start with three levels, and no other start has levels', () => {
    const deep = softRoamConfig({ seed: 1, start: 'deep' });
    expect(deep.depth).toBe(3);
    expect({ ...deep, depth: undefined }).toEqual({ ...softRoamConfig({ seed: 1, start: 'bodies' }), depth: undefined });
    expect(softRoamConfig({ seed: 1, start: 'bodies' }).depth).toBeUndefined();
    expect('depth' in softRoamConfig({ seed: 1, start: 'bodies' })).toBe(false);
    expect(softRoamConfig({ seed: 1, start: 'deep', depth: false as unknown as number }).depth).toBeUndefined();
    // The other depth keys reach a world with levels (0 is a value), and no world without them.
    expect(softRoamConfig({ seed: 1, start: 'deep', depth: 4, depthDive: 0, depthCost: 0, depthGap: 10 })).toMatchObject({ depth: 4, depthDive: 0, depthCost: 0, depthGap: 10 });
    expect(softRoamConfig({ seed: 1, start: 'bodies', depthDive: 0 }).depthDive).toBeUndefined();
    expect(softRoamConfig({ seed: 1, start: 'bodies', depth: 2 }).depth).toBe(2);
  });

  it('founds herds on the floor, pack hunters in the middle and groves at the surface, each with the lift that keeps it there', () => {
    for (const depth of [2, 3, 4]) {
      const w = foundSoftRoam({ seed: 3, size: 64, start: 'deep', depth });
      const seen = new Set<string>();
      for (let c = 0; c < w.cap; c++) {
        if (!w.alive[c]) continue;
        const type = (['herd', 'pack', 'grove'] as const).find((t) => softFamily(t) === w.fam[c])!;
        const lv = Math.round(DEEP_HOME[type]! * (depth - 1));
        expect(w.level[c], `${type} at depth ${depth}`).toBe(lv);
        expect(Math.floor((w.lift[c] * depth) / 256)).toBe(lv);
        seen.add(type);
      }
      expect(seen.size).toBe(3);
    }
    const flat = foundSoftRoam({ seed: 3, size: 64, start: 'bodies' });
    expect(flat.level.length).toBe(0);
  });
});

describe('soft roam depth: the picture', () => {
  const SC = 6;
  const SIDE = 16 * SC;
  // The layering tests look from straight above (`top`), where bodies at one place overlap; the slanted garden has its own tests below.
  const shot = (w: SoftRoamWorld, paint: SoftPaint = 'top'): Uint8Array => { const o = new Uint8Array(SIDE * SIDE * 4); paintSoftRoam(w, paint, SC, 1, o); return o; };
  const sum = (o: Uint8Array, x: number, y: number): number => { const p = (Math.floor(y * SC) * SIDE + Math.floor(x * SC)) * 4; return o[p] + o[p + 1] + o[p + 2]; };
  const one = (cells: Array<[x: number, y: number, level: number, fam: number]>): SoftRoamWorld => {
    const w = new SoftRoamWorld(still());
    const rest = restPlan(w);
    for (const [x, y, lv, fam] of cells) w.setLevel(w.found(Math.round(x * U), Math.round(y * U), SITTER, fam, 400, rest), lv);
    return w;
  };
  const ground = shot(new SoftRoamWorld(still()));

  it('draws a body on a higher level whole over a lower one, the lower one right up to its edge, whichever was founded first', () => {
    const both = shot(one([[8.5, 8.5, 2, 2], [9.4, 8.5, 0, 1]]));
    const swapped = shot(one([[9.4, 8.5, 0, 1], [8.5, 8.5, 2, 2]]));
    const upper = shot(one([[8.5, 8.5, 2, 2]]));
    const lower = shot(one([[9.4, 8.5, 0, 1]]));
    expect(Buffer.compare(both, swapped)).toBe(0);
    // The upper body's middle is its own (only the lower cell's faint glow is added), and so is the lower body's far side.
    expect(Math.abs(sum(both, 8.5, 8.5) - sum(upper, 8.5, 8.5))).toBeLessThan(40);
    expect(Math.abs(sum(both, 9.75, 8.5) - sum(lower, 9.75, 8.5))).toBeLessThan(40);
    expect(sum(both, 8.5, 8.5)).toBeGreaterThan(sum(lower, 8.5, 8.5) + 60);
    // No ring of bare ground between them: every pixel from one middle to the other is a body's.
    for (let x = 8.5; x <= 9.75; x += 1 / SC) expect(sum(both, x, 8.5), `x ${x}`).toBeGreaterThan(sum(ground, x, 8.5) + 60);
  });

  it('keeps a floor body showing where a middle body over it is only a faint edge under a surface body', () => {
    // Floor at 8.5, middle and surface together at 9.4: at the floor body's middle neither of them shows.
    const three = shot(one([[8.5, 8.5, 0, 1], [9.4, 8.5, 1, 2], [9.4, 8.5 + 0.75, 2, 3]]));
    const floor = shot(one([[8.5, 8.5, 0, 1]]));
    // (The two bodies beside it add their glow, so it is a little brighter than alone, never darker.)
    for (const x of [8.2, 8.5]) { expect(sum(three, x, 8.5), `x ${x}`).toBeGreaterThanOrEqual(sum(floor, x, 8.5)); expect(sum(three, x, 8.5) - sum(floor, x, 8.5), `x ${x}`).toBeLessThan(100); }
    expect(sum(three, 8.5, 8.5)).toBeGreaterThan(sum(ground, 8.5, 8.5) + 90);
  });

  it('gives one picture for four overlapping bodies on three levels whatever order they were founded in', () => {
    // A floor body, two middle bodies whose fields cancel over it, and a surface body beside them.
    const cells: Array<[number, number, number, number]> = [[9, 8.5, 0, 1], [8.5, 8.5, 1, 2], [9.5, 8.5, 1, 3], [9, 9.4, 2, 4]];
    // The picture goes by body label; founding the same four in other orders gives other labels.
    const other = (perm: number[]): Uint8Array => {
      const w = new SoftRoamWorld(still());
      const rest = restPlan(w);
      perm.forEach((i, k) => {
        const [x, y, lv, fam] = cells[i];
        const c = w.found((2 + 3 * k) * U, 14 * U, SITTER, fam, 400, rest);
        w.x[c] = Math.round(x * U); w.y[c] = Math.round(y * U);
        w.setLevel(c, lv);
      });
      return shot(w);
    };
    const first = other([0, 1, 2, 3]);
    for (const perm of [[0, 1, 3, 2], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) expect(Buffer.compare(other(perm), first), perm.join()).toBe(0);
    // Where the two middle bodies cancel, the floor body under them shows.
    expect(sum(first, 9, 8.5)).toBeGreaterThan(sum(ground, 9, 8.5) + 60);
  });

  it('draws the same body smaller and dimmer the lower it is', () => {
    const lit = (o: Uint8Array): number => { let k = 0; for (let p = 0; p < o.length; p += 4) if (o[p] + o[p + 1] + o[p + 2] > ground[p] + ground[p + 1] + ground[p + 2] + 90) k++; return k; };
    const shots = [0, 1, 2].map((lv) => shot(one([[8.5, 8.5, lv, 1]])));
    for (let lv = 0; lv < 2; lv++) {
      expect(sum(shots[lv + 1], 8.5, 8.5)).toBeGreaterThan(sum(shots[lv], 8.5, 8.5) + 20);
      expect(lit(shots[lv + 1])).toBeGreaterThan(lit(shots[lv]));
    }
  });

  it('shades a body under one that is above and to the upper left of it', () => {
    const alone = shot(one([[9.5, 10, 0, 1]]));
    const under = shot(one([[9.5, 10, 0, 1], [8.8, 9, 2, 2]]));
    expect(sum(under, 9.5, 10)).toBeLessThan(sum(alone, 9.5, 10) - 15);
    // A body on the same level casts none.
    const beside = shot(one([[9.5, 10, 0, 1], [8.8, 9, 0, 2]]));
    expect(sum(beside, 9.5, 10)).toBeGreaterThanOrEqual(sum(alone, 9.5, 10));
  });

  it('does not shade a body with its own shadow while it sinks', () => {
    // The drawn height eases over some steps after the level has changed: a body on its way down is between the two pictures, never darker than the lower one.
    const w = new SoftRoamWorld(still({ depthGap: 1, depthCost: 0 }));
    const c = w.found(Math.round(8.5 * U), Math.round(8.5 * U), SITTER, 1, 400, restPlan(w));
    w.setLevel(c, 2, 0);
    const mem = new SoftPaintMemory();
    const o = new Uint8Array(SIDE * SIDE * 4);
    paintSoftRoam(w, 'top', SC, 1, o, mem);
    const settled = [0, 1].map((lv) => sum(shot(one([[8.5, 8.5, lv, 1]])), 8.5, 8.5));
    for (let t = 0; t < 4; t++) {
      w.stepOnce();
      paintSoftRoam(w, 'top', SC, 1, o, mem);
      expect(sum(o, 8.5, 8.5), `step ${t + 1}, level ${w.level[c]}`).toBeGreaterThanOrEqual(settled[w.level[c]] - 6);
    }
    expect(w.level[c]).toBe(0);
  });

  it('leaves the marks of a covered cell off the body above it', () => {
    // A mother and her kept daughter on the floor (a strand joins them), or two unjoined cells in the same places; then a surface cell over the middle.
    const build = (joined: boolean, cover: boolean): { o: Uint8Array; x: number; y: number } => {
      const w = new SoftRoamWorld(still());
      const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
      const a = w.found(8 * U, 8 * U, SITTER, 1, joined ? 400 : 50, plan);
      for (let t = 0; t < 20; t++) w.stepOnce();
      const live = (): number[] => { const l: number[] = []; for (let c = 0; c < w.cap; c++) if (w.alive[c]) l.push(c); return l; };
      if (joined) expect(live().length).toBe(2);
      else w.found(JOIN.x, JOIN.y, SITTER, 1, 50, plan);
      const [p, q] = live();
      if (joined) { JOIN.x = w.x[q === a ? p : q]; JOIN.y = w.y[q === a ? p : q]; }
      for (const c of [p, q]) w.store[c] = 100;
      const mx = w.x[a] + w.dlt(w.x[a], w.x[a === p ? q : p]) / 2, my = w.y[a] + w.dlt(w.y[a], w.y[a === p ? q : p]) / 2;
      if (cover) {
        // A founder may not be placed this close to another cell, so it is founded apart and put over them (the picture reads positions only).
        const u = w.found(3 * U, 3 * U, SITTER, 2, 400, restPlan(w));
        w.setLevel(u, 2);
        w.x[u] = Math.round(mx);
        w.y[u] = Math.round(my);
      }
      return { o: shot(w), x: mx / U, y: my / U };
    };
    const JOIN = { x: 0, y: 0 };
    const open = build(true, false), covered = build(true, true);
    const openTwo = build(false, false), coveredTwo = build(false, true);
    expect(sum(open.o, open.x, open.y)).not.toBe(sum(openTwo.o, openTwo.x, openTwo.y));
    for (let d = -1; d <= 1; d++) expect(sum(covered.o, covered.x + d / SC, covered.y)).toBe(sum(coveredTwo.o, coveredTwo.x + d / SC, coveredTwo.y));
  });

  it('leaves the strand to a covered mother off the body above her', () => {
    // A floor mother and her kept daughter; a surface cell over the mother only. The strand from the open daughter must stop at the cover.
    const build = (joined: boolean): { o: Uint8Array; mx: number; my: number } => {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      const m = spawn(w, 8 * U + 800, 8 * U + 512, SITTER, 400, plan, P, 0);
      const d = spawn(w, 7 * U + 800, 8 * U + 512, SITTER, 100, plan, P, 0);
      if (joined) link(w, d, m, -1, 0);
      spawn(w, 8 * U + 800, 8 * U + 512, SITTER, 400, plan, P, 2);
      return { o: shot(w), mx: (8 * U + 800) / U, my: (8 * U + 512) / U };
    };
    const joined = build(true), apart = build(false);
    // Over the mother (under the cover) nothing differs; out by the daughter the strand is there.
    for (let d = -2; d <= 2; d++) expect(sum(joined.o, joined.mx + d / SC, joined.my), `d ${d}`).toBe(sum(apart.o, apart.mx + d / SC, apart.my));
    // The mother is covered, yet the open end of her strand, by the daughter, still shows.
    const dx = (7 * U + 800) / U - 0.1;
    expect(sum(joined.o, dx, joined.my)).toBeGreaterThan(sum(apart.o, dx, apart.my));
  });

  it('leaves a strand between two open floor cells off a surface body it would cross', () => {
    // Two linked floor cells either side of a surface cell, both centres in the open: the strand runs under the cover, not over it.
    const build = (joined: boolean): Uint8Array => {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      const m = spawn(w, Math.round(9.25 * U), Math.round(8.5 * U), SITTER, 400, plan, P, 0);
      const d = spawn(w, Math.round(7.75 * U), Math.round(8.5 * U), SITTER, 100, plan, P, 0);
      if (joined) link(w, d, m, 1, 0);
      spawn(w, Math.round(8.5 * U), Math.round(8.5 * U), SITTER, 400, plan, P, 2);
      return shot(w);
    };
    const joined = build(true), apart = build(false);
    for (let d = -2; d <= 2; d++) expect(sum(joined, 8.5 + d / SC, 8.5), `d ${d}`).toBe(sum(apart, 8.5 + d / SC, 8.5));
    // Out in the open, between each floor cell and the cover, the strand still shows.
    for (const x of [7.75 - 0.1, 9.25 + 0.1]) expect(sum(joined, x, 8.5), `x ${x}`).toBeGreaterThan(sum(apart, x, 8.5));
  });

  it('leaves a feeding thread off a body that covers the mouth and its prey', () => {
    // Two joined mouths feed on a plain cell, all in the middle level; then the same with a surface cell over the feeding mouth and the prey.
    const build = (cover: boolean): { with: Uint8Array; without: Uint8Array } => {
      const w = new SoftRoamWorld(still());
      const plan = restPlan(w);
      const m0 = spawn(w, 6 * U, 8 * U, SITTER, 150, plan, M, 1);
      const m1 = spawn(w, 7 * U, 8 * U, SITTER, 150, plan, M, 1);
      link(w, m1, m0, 1, 0);
      spawn(w, 8 * U + 100, 8 * U, SITTER, 150, plan, P, 1);
      if (cover) spawn(w, 7 * U + 560, 8 * U, SITTER, 400, plan, P, 2);
      const mem = new SoftPaintMemory();
      const o = new Uint8Array(SIDE * SIDE * 4);
      for (let t = 0; t < 5; t++) { w.stepOnce(); paintSoftRoam(w, 'top', SC, 1, o, mem); }
      expect(w.census().drained).toBeGreaterThan(0);
      expect(mem.threads.length).toBeGreaterThan(0);
      const withThread = Uint8Array.from(o);
      // The same frame again without the threads (nothing else differs: the step has been seen).
      mem.threads.length = 0;
      paintSoftRoam(w, 'top', SC, 1, o, mem);
      return { with: withThread, without: Uint8Array.from(o) };
    };
    const open = build(false), covered = build(true);
    const differs = (a: Uint8Array, b: Uint8Array): number => { let k = 0; for (let x = 7.1; x <= 8.0; x += 1 / SC) for (let dy = -1; dy <= 1; dy++) if (sum(a, x, 8 + dy / SC) !== sum(b, x, 8 + dy / SC)) k++; return k; };
    expect(differs(open.with, open.without)).toBeGreaterThan(0);
    expect(differs(covered.with, covered.without)).toBe(0);
  });
});

describe('soft roam depth: the slanted garden', () => {
  const SC = 6;
  const SIDE = 16 * SC;
  const shot = (w: SoftRoamWorld, paint: SoftPaint): Uint8Array => { const o = new Uint8Array(SIDE * SIDE * 4); paintSoftRoam(w, paint, SC, 1, o); return o; };
  const sum = (o: Uint8Array, x: number, y: number): number => { const p = (Math.floor(y * SC) * SIDE + Math.floor(x * SC)) * 4; return o[p] + o[p + 1] + o[p + 2]; };
  const one = (cells: Array<[x: number, y: number, level: number, fam: number]>, over: Partial<SoftRoamConfig> = {}): SoftRoamWorld => {
    const w = new SoftRoamWorld(still(over));
    const rest = restPlan(w);
    // A founder may not be placed on another cell, so each is founded apart and then put in its place (the picture reads positions only).
    cells.forEach(([x, y, lv, fam], i) => {
      const c = w.found((2 + 3 * i) * U, 14 * U, SITTER, fam, 400, rest);
      w.x[c] = Math.round(x * U);
      w.y[c] = Math.round(y * U);
      if (w.cfg.depth !== undefined) w.setLevel(c, lv);
    });
    return w;
  };
  const ground = shot(new SoftRoamWorld(still()), 'garden');
  /** A floor body is at least this share as bright as the same body at the surface (the painter's DEEP_DIM, with room for its blue tint). */
  const DEEP_DIM_FLOOR = 0.5;
  /** The middle of what is clearly a body, in tiles. */
  const middle = (o: Uint8Array): { x: number; y: number; n: number } => {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const p = (y * SIDE + x) * 4;
      if (o[p] + o[p + 1] + o[p + 2] > ground[p] + ground[p + 1] + ground[p + 2] + 90) { sx += x + 0.5; sy += y + 0.5; n++; }
    }
    return { x: sx / n / SC, y: sy / n / SC, n };
  };

  it('draws a body up the screen by its level and leaves the floor, a flat world and the view from above where they were', () => {
    for (const lv of [0, 1, 2]) {
      const m = middle(shot(one([[8.5, 10.5, lv, 1]]), 'garden'));
      expect(m.x, `level ${lv}`).toBeCloseTo(8.5, 1);
      expect(m.y, `level ${lv}`).toBeCloseTo(10.5 - DEEP_SLANT * lv, 1);
      expect(middle(shot(one([[8.5, 10.5, lv, 1]]), 'top')).y).toBeCloseTo(10.5, 1);
    }
    // The slanted floor is a little paler than the ground seen from above (so shadows show on it); a flat world is the same picture either way.
    const p = (Math.floor(2.5 * SC) * SIDE + Math.floor(2.5 * SC)) * 4;
    const above = shot(new SoftRoamWorld(still()), 'top');
    expect(ground[p] + ground[p + 1] + ground[p + 2]).toBeGreaterThan(above[p] + above[p + 1] + above[p + 2]);
    const flat = (): SoftRoamWorld => one([[8.5, 10.5, 0, 1]], { depth: undefined, depthDive: undefined });
    expect(Buffer.compare(shot(flat(), 'garden'), shot(flat(), 'top'))).toBe(0);
  });

  it('wraps a body lifted past the top edge to the bottom', () => {
    const m = middle(shot(one([[8.5, 1.5, 2, 1]]), 'garden'));
    expect(m.n).toBeGreaterThan(20);
    expect(m.y).toBeCloseTo(16 + 1.5 - DEEP_SLANT * 2, 1);
  });

  it('puts the shadow of a body straight under it: a floor body at the same place shows and is darker, one beside it is not', () => {
    const alone = shot(one([[8.5, 10.5, 0, 1]]), 'garden');
    const under = shot(one([[8.5, 10.5, 0, 1], [8.5, 10.5, 2, 2]]), 'garden');
    expect(sum(under, 8.5, 10.5)).toBeGreaterThan(sum(ground, 8.5, 10.5) + 60);
    expect(sum(under, 8.5, 10.5)).toBeLessThan(sum(alone, 8.5, 10.5) - 15);
    // The bare floor under a surface body is darker too, and the floor where that body is drawn (not under it) is not.
    const over = shot(one([[8.5, 10.5, 2, 2]]), 'garden');
    expect(sum(over, 8.5, 10.5)).toBeLessThan(sum(ground, 8.5, 10.5) - 8);
    expect(sum(over, 5, 10.5 - 2 * DEEP_SLANT)).toBe(sum(ground, 5, 10.5 - 2 * DEEP_SLANT));
    // A floor body three tiles to the side keeps its light.
    const side = shot(one([[5.5, 10.5, 0, 1]]), 'garden');
    const sideUnder = shot(one([[5.5, 10.5, 0, 1], [8.5, 10.5, 2, 2]]), 'garden');
    expect(sum(sideUnder, 5.5, 10.5)).toBeGreaterThanOrEqual(sum(side, 5.5, 10.5));
    // A middle body under a surface one is shaded at the place it is drawn.
    const mid = shot(one([[8.5, 10.5, 1, 1]]), 'garden');
    const midUnder = shot(one([[8.5, 10.5, 1, 1], [8.5, 10.5, 2, 2]]), 'garden');
    expect(sum(midUnder, 8.5, 10.5 - DEEP_SLANT)).toBeLessThan(sum(mid, 8.5, 10.5 - DEEP_SLANT) - 10);
  });

  it('slides a sinking body down the screen over some steps, never in one jump', () => {
    const w = one([], { depthGap: 1, depthCost: 0 });
    const c = w.found(Math.round(8.5 * U), Math.round(10.5 * U), SITTER, 1, 400, restPlan(w));
    w.setLevel(c, 2, 0);
    const mem = new SoftPaintMemory();
    const o = new Uint8Array(SIDE * SIDE * 4);
    paintSoftRoam(w, 'garden', SC, 1, o, mem);
    let last = middle(o).y;
    expect(last).toBeCloseTo(10.5 - 2 * DEEP_SLANT, 1);
    for (let t = 0; t < 60; t++) {
      w.stepOnce();
      // Between two steps the picture is between the two heights too.
      paintSoftRoam(w, 'garden', SC, 0.5, o, mem);
      const half = middle(o).y;
      paintSoftRoam(w, 'garden', SC, 1, o, mem);
      const y = middle(o).y;
      expect(half, `step ${t + 1}`).toBeGreaterThanOrEqual(last - 0.1);
      expect(y, `step ${t + 1}`).toBeGreaterThanOrEqual(half - 0.1);
      expect(y - last, `step ${t + 1}`).toBeLessThan(0.7);
      last = y;
    }
    expect(w.level[c]).toBe(0);
    expect(last).toBeCloseTo(10.5, 1);
  });

  it('keeps the ground shadow of a sinking body until it lands, and never shades it with its own shadow', () => {
    const w = one([], { depthGap: 1, depthCost: 0 });
    const c = w.found(Math.round(8.5 * U), Math.round(10.5 * U), SITTER, 1, 400, restPlan(w));
    w.setLevel(c, 2, 0);
    const mem = new SoftPaintMemory();
    const o = new Uint8Array(SIDE * SIDE * 4);
    paintSoftRoam(w, 'garden', SC, 1, o, mem);
    const lit = sum(o, 8.5, 10.5 - 2 * DEEP_SLANT);
    const NLX = mem.lxCur.length / w.cap;
    for (let t = 0; t < 12; t++) {
      w.stepOnce();
      paintSoftRoam(w, 'garden', SC, 1, o, mem);
      const h = mem.lxCur[c * NLX + 2] * 2;
      // Its level is the floor after two steps, but while it is drawn a level or more up the floor under it is still in its shadow...
      if (h >= 1) expect(sum(o, 8.5, 10.5), `step ${t + 1}, height ${h}`).toBeLessThan(sum(ground, 8.5, 10.5) - 8);
      // ... and the body itself is as bright as a body in the open at that height (never darker than the dimmest, a floor body's).
      expect(sum(o, 8.5, 10.5 - h * DEEP_SLANT), `step ${t + 1}`).toBeGreaterThan(lit * DEEP_DIM_FLOOR - 12);
    }
    expect(w.level[c]).toBe(0);
  });

  it('starts a daughter at her mother\'s drawn height while the mother sinks', () => {
    const w = new SoftRoamWorld(still({ depthGap: 1, depthCost: 0 }));
    const plan = w.addPlan(Array.from({ length: 16 }, (_, m) => (m === 0 ? planEntry(0, 15, 15) : planEntry(8, 0, m))));
    const a = w.found(8 * U, 10 * U, SITTER, 1, 400, plan);
    w.setLevel(a, 2, 0);
    const mem = new SoftPaintMemory();
    const o = new Uint8Array(SIDE * SIDE * 4);
    paintSoftRoam(w, 'garden', SC, 1, o, mem);
    let born = -1;
    for (let t = 0; t < 30 && born < 0; t++) {
      w.stepOnce();
      paintSoftRoam(w, 'garden', SC, 1, o, mem);
      for (let c = 0; c < w.cap; c++) if (w.alive[c] && c !== a) born = c;
    }
    expect(born).toBeGreaterThanOrEqual(0);
    const NLX = mem.lxCur.length / w.cap;
    const h = (c: number): number => mem.lxCur[c * NLX + 2];
    expect(h(a)).toBeGreaterThan(0.01);
    expect(h(a)).toBeLessThan(0.99);
    expect(h(born)).toBe(h(a));
  });
});
