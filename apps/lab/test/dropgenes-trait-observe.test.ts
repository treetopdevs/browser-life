import { describe, expect, it } from 'vitest';
import { DG_SCALE } from '../src/dropgenes/kernel.ts';
import {
  CompartmentTracker,
  DescentWindow,
  heredity,
  heredityDelayed,
  heredityLastSeen,
  ladderComplete,
  ladderGene0Share,
  ladderLevelCounts,
  ladderMeanLevel,
  ladderTopShare,
  type FissionRecord,
} from '../src/dropgenes/observe.ts';

const SIZE = 16;
const K = 2;
const V = 3; // levels 0, 1 and the top level 2
const S = K * V;

/** A wall field with full wall on the listed [x0, y0, x1, y1] rectangles (inclusive). */
function walls(...rects: [number, number, number, number][]): Uint32Array {
  const W = new Uint32Array(SIZE * SIZE);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) W[y * SIZE + x] = DG_SCALE;
  return W;
}
/** On every walled tile of each rectangle: one copy of each gene at that rectangle's level. */
function copiesOn(rects: [number, number, number, number][], levels: number[]): Uint32Array {
  const T = new Uint32Array(SIZE * SIZE * S);
  rects.forEach(([x0, y0, x1, y1], r) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let k = 0; k < K; k++) T[(y * SIZE + x) * S + k * V + levels[r]] = 1;
      }
    }
  });
  return T;
}
const level = (c: number[]) => ladderMeanLevel(c, K, V);

describe('droplet genes ladder readouts', () => {
  it('mean level, level counts, top share and gene-0 share read the layout copies[k * levels + v]', () => {
    //                 gene 0: v0 v1 v2   gene 1: v0 v1 v2
    const copies = [4, 2, 0, 1, 1, 2];
    expect(ladderLevelCounts(copies, K, V)).toEqual([5, 3, 2]);
    expect(ladderMeanLevel(copies, K, V)).toBeCloseTo((3 * 1 + 2 * 2) / 10, 12);
    expect(ladderTopShare(copies, K, V)).toBeCloseTo(0.2, 12);
    expect(ladderGene0Share(copies, K, V)).toBeCloseTo(0.6, 12);
    expect(ladderMeanLevel([0, 0, 0, 0, 0, 0], K, V)).toBeNull();
    expect(ladderTopShare([0, 0, 0, 0, 0, 0], K, V)).toBeNull();
    expect(ladderGene0Share([0, 0, 0, 0, 0, 0], K, V)).toBeNull();
  });

  it('complete needs a working copy of every gene: the top level does not count, except in the neutral twin', () => {
    expect(ladderComplete([1, 0, 0, 0, 1, 0], K, V, 1, false)).toBe(true);
    expect(ladderComplete([1, 0, 0, 0, 0, 9], K, V, 1, false)).toBe(false); // gene 1 only at the top level
    expect(ladderComplete([1, 0, 0, 0, 0, 9], K, V, 1, true)).toBe(true);
    expect(ladderComplete([0, 0, 0, 3, 3, 3], K, V, 1, true)).toBe(false); // no gene 0 at all
    expect(ladderComplete([1, 1, 0, 1, 0, 0], K, V, 2, false)).toBe(false); // completeMin 2: gene 1 has one
  });

  it('the tracker uses the ladder rule for complete when given ladderLevels, and the first-rung rule otherwise', () => {
    const W = walls([1, 1, 3, 2], [8, 1, 10, 2]);
    // left: both genes at level 0. right: gene 0 at level 0, gene 1 only at the top level.
    const T = copiesOn([[1, 1, 3, 2]], [0]);
    for (let y = 1; y <= 2; y++) for (let x = 8; x <= 10; x++) { T[(y * SIZE + x) * S] = 1; T[(y * SIZE + x) * S + V + 2] = 1; }
    const ladder = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, ladderLevels: V });
    const c = ladder.observe(0, W, T).compartments.slice().sort((a, b) => a.cx - b.cx);
    expect(c.map((k) => k.complete)).toEqual([true, false]);
    const neutral = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, ladderLevels: V, ladderNeutral: true });
    expect(neutral.observe(0, W, T).compartments.map((k) => k.complete)).toEqual([true, true]);
    // Without the option the first-rung rule reads species 0 and 1 as the two genes: gene 0 at levels 0 and 1 here.
    const first = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03 });
    expect(first.observe(0, W, T).compartments.map((k) => k.complete)).toEqual([false, false]);
  });

  it('last seen: a daughter gone by the delayed read is scored by the copies it had at its last census', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 150, ladderLevels: V });
    // A far compartment gives every split a neighbour control.
    const far: [number, number, number, number] = [1, 10, 3, 11];
    const parent: [number, number, number, number] = [1, 1, 6, 2];
    const left: [number, number, number, number] = [1, 1, 2, 2];
    const right: [number, number, number, number] = [5, 1, 6, 2];
    t.observe(0, walls(parent, far), copiesOn([parent, far], [0, 0]));
    // step 50: split. Left daughter at level 0, right daughter at level 1.
    t.observe(50, walls(left, right, far), copiesOn([left, right, far], [0, 1, 0]));
    const rec = t.fissionRecords[0];
    expect(rec.lastSeenStep).toEqual([50, 50]);
    // step 100: the right daughter has moved to the top level.
    t.observe(100, walls(left, right, far), copiesOn([left, right, far], [0, 2, 0]));
    expect(rec.lastSeenStep).toEqual([100, 100]);
    // step 150: the right daughter is gone. step 200 (due): the left one is read.
    t.observe(150, walls(left, far), copiesOn([left, far], [0, 0]));
    t.observe(200, walls(left, far), copiesOn([left, far], [1, 0]));
    const iLeft = rec.delayedStatus.indexOf('read');
    const iRight = rec.delayedStatus.indexOf('gone');
    expect(iLeft).toBeGreaterThanOrEqual(0);
    expect(iRight).toBeGreaterThanOrEqual(0);
    expect(rec.lastSeenStep?.[iRight]).toBe(100);
    expect(level(rec.lastSeen?.[iRight] as number[])).toBe(2); // the level it had when last seen
    expect(rec.lastSeenStep?.[iLeft]).toBe(200);
    expect(rec.lastSeen?.[iLeft]).toEqual(rec.delayed[iLeft]);
    const h = heredityLastSeen(t.fissionRecords, level);
    expect([h.read, h.gone, h.leftOut]).toEqual([1, 1, 0]);
    expect(h.pairs).toBe(2); // both daughters are in, the gone one included
    expect(h.lastTraitGone).toBe(2);
    expect(h.splitTraitGone).toBe(1);
    expect(h.splitTraitRead).toBe(0);
    expect(h.parentTraitRead).toBe(0);
    // The survivors-only read has one daughter.
    const d = heredityDelayed(t.fissionRecords, level);
    expect([d.read, d.gone]).toEqual([1, 1]);
    expect(d.pairs).toBe(1);
    // A later census does not move a resolved daughter's last-seen entry.
    t.observe(250, walls(left, far), copiesOn([left, far], [2, 0]));
    expect(rec.lastSeenStep?.[iLeft]).toBe(200);
  });

  it('last seen stops at a merger: a daughter that merges keeps the copies it had before, and is left out as fused', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100, ladderLevels: V });
    const parent: [number, number, number, number] = [1, 1, 7, 2];
    const left: [number, number, number, number] = [1, 1, 2, 2];
    const right: [number, number, number, number] = [4, 1, 7, 2];
    const other: [number, number, number, number] = [9, 1, 10, 2];
    t.observe(0, walls(parent, other), copiesOn([parent, other], [0, 2]));
    t.observe(50, walls(left, right, other), copiesOn([left, right, other], [0, 1, 2]));
    // step 100: the right daughter and the other compartment are one patch now (the daughter is the larger part,
    // so the patch carries the daughter's id).
    const merged: [number, number, number, number] = [4, 1, 10, 2];
    t.observe(100, walls(left, merged), copiesOn([left, merged], [0, 2]));
    t.observe(150, walls(left, merged), copiesOn([left, merged], [0, 2]));
    const rec = t.fissionRecords[0];
    const iFused = rec.delayedStatus.indexOf('fused');
    expect(iFused).toBeGreaterThanOrEqual(0);
    expect(rec.lastSeenStep?.[iFused]).toBe(50);
    expect(level(rec.lastSeen?.[iFused] as number[])).toBe(1);
    const h = heredityLastSeen(t.fissionRecords, level);
    expect([h.read, h.gone, h.leftOut]).toEqual([1, 0, 1]);
    expect(h.merged).toBe(1);
    expect(rec.merged?.[iFused]).toBe(true);
  });

  it('a daughter absorbed by a larger compartment is flagged as merged and left out of the last-seen sample, not scored as dissolved', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100, ladderLevels: V });
    const parent: [number, number, number, number] = [1, 1, 6, 2];
    const left: [number, number, number, number] = [1, 1, 2, 2];
    const right: [number, number, number, number] = [5, 1, 6, 2]; // 4 tiles
    const big: [number, number, number, number] = [8, 1, 12, 2]; // 10 tiles
    const far: [number, number, number, number] = [1, 10, 3, 11];
    t.observe(0, walls(parent, big, far), copiesOn([parent, big, far], [0, 2, 0]));
    t.observe(50, walls(left, right, big, far), copiesOn([left, right, big, far], [0, 1, 2, 0]));
    // step 100: the right daughter is swallowed by the big compartment (the big one keeps its id).
    const merged: [number, number, number, number] = [5, 1, 12, 2];
    t.observe(100, walls(left, merged, far), copiesOn([left, merged, far], [0, 2, 0]));
    t.observe(150, walls(left, merged, far), copiesOn([left, merged, far], [0, 2, 0]));
    const rec = t.fissionRecords[0];
    const i = rec.delayedStatus.indexOf('gone');
    expect(i).toBeGreaterThanOrEqual(0); // the first-rung status is unchanged: its uid no longer exists
    expect(rec.merged?.[i]).toBe(true);
    expect(rec.merged?.[1 - i]).toBe(false);
    expect(rec.lastSeenStep?.[i]).toBe(50); // last seen as itself, before the merger
    const h = heredityLastSeen(t.fissionRecords, level);
    expect([h.read, h.gone, h.leftOut, h.merged]).toEqual([1, 0, 1, 1]);
    expect(h.pairs).toBe(1);
    // A daughter that simply dissolves is not flagged.
    const t2 = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100, ladderLevels: V });
    t2.observe(0, walls(parent, far), copiesOn([parent, far], [0, 0]));
    t2.observe(50, walls(left, right, far), copiesOn([left, right, far], [0, 1, 0]));
    t2.observe(100, walls(left, far), copiesOn([left, far], [0, 0]));
    t2.observe(150, walls(left, far), copiesOn([left, far], [0, 0]));
    const h2 = heredityLastSeen(t2.fissionRecords, level);
    expect(t2.fissionRecords[0].merged).toEqual([false, false]);
    expect([h2.read, h2.gone, h2.leftOut, h2.merged]).toEqual([1, 1, 0, 0]);
  });

  it('a daughter that takes in another compartment and then dissolves before its delayed read is merged, not dissolved', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 150, ladderLevels: V });
    const parent: [number, number, number, number] = [1, 1, 7, 2];
    const left: [number, number, number, number] = [1, 1, 2, 2];
    const right: [number, number, number, number] = [4, 1, 7, 2]; // 8 tiles: the larger part of the merger below
    const other: [number, number, number, number] = [9, 1, 10, 2];
    const far: [number, number, number, number] = [1, 10, 3, 11];
    t.observe(0, walls(parent, other, far), copiesOn([parent, other, far], [0, 2, 0]));
    t.observe(50, walls(left, right, other, far), copiesOn([left, right, other, far], [0, 1, 2, 0]));
    // step 100: the right daughter takes in the other compartment and keeps its id. step 150: it is gone.
    const merged: [number, number, number, number] = [4, 1, 10, 2];
    t.observe(100, walls(left, merged, far), copiesOn([left, merged, far], [0, 2, 0]));
    t.observe(150, walls(left, far), copiesOn([left, far], [0, 0]));
    t.observe(200, walls(left, far), copiesOn([left, far], [0, 0]));
    const rec = t.fissionRecords[0];
    const i = rec.delayedStatus.indexOf('gone'); // the first-rung status: its uid is not there at the delayed read
    expect(i).toBeGreaterThanOrEqual(0);
    expect(rec.merged?.[i]).toBe(true);
    expect(rec.lastSeenStep?.[i]).toBe(50); // last seen as itself, before the merger
    const h = heredityLastSeen(t.fissionRecords, level);
    expect([h.read, h.gone, h.leftOut, h.merged]).toEqual([1, 0, 1, 1]);
  });

  it('heredityLastSeen correlates the parent with last-seen daughters and shows the survivor bias beside it', () => {
    // Hand-built records. Parents at mean level p; the daughter that lasts keeps p, the one that is gone was
    // last seen one level higher. Survivors are the low-level ones.
    const at = (lv: number): number[] => {
      const c = new Array<number>(S).fill(0);
      c[Math.floor(lv)] = 10 - Math.round((lv % 1) * 10);
      if (lv % 1 > 0) c[Math.floor(lv) + 1] = Math.round((lv % 1) * 10);
      return c;
    };
    const rec = (p: number, goneToo: boolean, nb: number): FissionRecord => ({
      step: 100,
      parentUid: 1,
      parent: at(p),
      neighbour: at(nb),
      unrelated: at(nb),
      daughters: [at(p), at(p)],
      daughterUids: [1, 2],
      delayed: [at(p), null],
      delayedStatus: ['read', goneToo ? 'gone' : 'fused'],
      lastSeen: [at(p), at(Math.min(2, p + 1))],
      lastSeenStep: [600, 300],
    });
    const records = [rec(0, true, 0.5), rec(0.2, true, 0.1), rec(0.5, true, 0.9), rec(0.8, true, 0.3), rec(1, false, 0.7)];
    const h = heredityLastSeen(records, level);
    expect([h.read, h.gone, h.leftOut]).toEqual([5, 4, 1]);
    expect(h.pairs).toBe(9);
    // The daughters that lasted match their parents exactly; with the gone ones scored too the figure is lower.
    expect(heredityDelayed(records, level).parentR).toBeCloseTo(1, 12);
    expect(h.parentR).toBeCloseTo(0.4664, 3);
    expect(h.parentTraitRead).toBeCloseTo(0.5, 12);
    expect(h.parentTraitGone).toBeCloseTo(0.375, 12);
    expect(h.lastTraitGone).toBeCloseTo(1.375, 12);
    // Records made before the last-seen field existed (first-rung files) are counted as left out, not read.
    const old = records.map((r) => ({ ...r, lastSeen: undefined, lastSeenStep: undefined }));
    const ho = heredityLastSeen(old, level);
    expect([ho.read, ho.gone, ho.leftOut, ho.pairs]).toEqual([0, 0, 10, 0]);
    // The survivors-only read on the same records sees only the five that lasted.
    expect(heredityDelayed(records, level).pairs).toBe(5);
    expect(heredity(records, level).pairs).toBe(10);
  });

  it('response check: descendants are traced by tracker id, and the two Price terms add up to the change in the mean', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, ladderLevels: V });
    const a: [number, number, number, number] = [1, 1, 6, 2]; // level 0, will split in two
    const b: [number, number, number, number] = [1, 6, 3, 7]; // level 1, will die
    const c: [number, number, number, number] = [9, 6, 11, 7]; // level 2, stays
    const c0 = t.observe(0, walls(a, b, c), copiesOn([a, b, c], [0, 1, 2]));
    const win = new DescentWindow(c0, level);
    const aL: [number, number, number, number] = [1, 1, 2, 2];
    const aR: [number, number, number, number] = [5, 1, 6, 2];
    const c1 = t.observe(50, walls(aL, aR, b, c), copiesOn([aL, aR, b, c], [0, 0, 1, 2]));
    win.update(c1);
    // b is gone; one of a's daughters has moved up a level; a new patch appears from nowhere (an orphan).
    const stray: [number, number, number, number] = [12, 12, 14, 13];
    const c2 = t.observe(100, walls(aL, aR, c, stray), copiesOn([aL, aR, c, stray], [0, 1, 2, 2]));
    win.update(c2);
    const r = win.finish(c2);
    expect(r.n).toBe(3);
    expect(r.orphans).toBe(1);
    // descendants: a -> 2, b -> 0, c -> 1
    expect(r.meanW).toBeCloseTo(1, 12);
    expect(r.zStart).toBeCloseTo(1, 12);
    // cov = mean((z - 1) * (w - 1)) = ((-1)(1) + 0 + (1)(0)) / 3
    expect(r.cov).toBeCloseTo(-1 / 3, 12);
    expect(r.between).toBeCloseTo(-1 / 3, 12);
    // descendants at the end: levels 0, 1 (from a) and 2 (c): mean 1
    expect(r.zEnd).toBeCloseTo(1, 12);
    expect(r.within).toBeCloseTo(1 / 3, 12);
    expect((r.zEnd as number) - (r.zStart as number)).toBeCloseTo((r.between as number) + (r.within as number), 12);
  });

  it('response check: a descendant holding no copies is not a descendant in either Price term, and the split stays exact', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, ladderLevels: V });
    const a: [number, number, number, number] = [1, 1, 3, 2]; // level 0, stays
    const b: [number, number, number, number] = [8, 1, 10, 2]; // level 2, keeps its wall but loses every copy
    const c0 = t.observe(0, walls(a, b), copiesOn([a, b], [0, 2]));
    const win = new DescentWindow(c0, level);
    const c1 = t.observe(50, walls(a, b), copiesOn([a], [0]));
    win.update(c1);
    const r = win.finish(c1);
    expect(r.n).toBe(2);
    expect(r.traitless).toBe(1);
    expect(r.meanW).toBeCloseTo(0.5, 12); // a -> 1, b -> 0
    expect(r.zStart).toBeCloseTo(1, 12);
    expect(r.zEnd).toBeCloseTo(0, 12);
    // cov = ((0 - 1)(1 - 0.5) + (2 - 1)(0 - 0.5)) / 2 = -0.5; between = -0.5 / 0.5 = -1: all of the change
    expect(r.cov).toBeCloseTo(-0.5, 12);
    expect(r.between).toBeCloseTo(-1, 12);
    expect(r.within).toBeCloseTo(0, 12);
  });

  it('response check: no compartments at the start gives an empty readout, and a dead population gives zero descendants', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, ladderLevels: V });
    const empty = t.observe(0, walls(), new Uint32Array(SIZE * SIZE * S));
    expect(new DescentWindow(empty, level).finish(empty)).toMatchObject({ n: 0, cov: null, between: null, within: null });
    const a: [number, number, number, number] = [1, 1, 3, 2];
    const c1 = t.observe(50, walls(a), copiesOn([a], [1]));
    const win = new DescentWindow(c1, level);
    const c2 = t.observe(100, walls(), new Uint32Array(SIZE * SIZE * S));
    win.update(c2);
    const r = win.finish(c2);
    expect(r).toMatchObject({ n: 1, meanW: 0, cov: 0, between: null, zEnd: null, within: null });
  });
});
