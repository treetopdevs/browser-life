import { describe, expect, it } from 'vitest';
import { DG_SCALE } from '../src/dropgenes/kernel.ts';
import { CompartmentTracker, deathReadout, gene0Share, heredity, heredityDelayed, labelCompartments, type FissionRecord } from '../src/dropgenes/observe.ts';

const SIZE = 12;
const S = 3; // two genes and the parasite
const K = 2;

/** A wall field with full wall on the listed [x, y] rectangles (inclusive). */
function walls(...rects: [number, number, number, number][]): Uint32Array {
  const W = new Uint32Array(SIZE * SIZE);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) W[y * SIZE + x] = DG_SCALE;
  return W;
}

/** One copy of each gene on every walled tile. */
function genesOn(W: Uint32Array): Uint32Array {
  const T = new Uint32Array(SIZE * SIZE * S);
  for (let i = 0; i < W.length; i++) if (W[i] > 0) { T[i * S] = 1; T[i * S + 1] = 1; }
  return T;
}

function tracker(): CompartmentTracker {
  return new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03 });
}

describe('droplet genes observer', () => {
  it('labels 4-connected patches and drops those below minArea', () => {
    const W = walls([1, 1, 2, 2], [5, 5, 5, 5], [8, 1, 8, 3]);
    W[3 * SIZE + 3] = DG_SCALE; // diagonal to (2, 2): not 4-connected
    const { labels, areas } = labelCompartments(W, SIZE, SIZE, 128, 3);
    expect(areas.slice(1).sort()).toEqual([3, 4]);
    expect(labels[5 * SIZE + 5]).toBe(0);
    expect(labels[3 * SIZE + 3]).toBe(0);
  });

  it('one blob splitting in two is one fission, with the parent and both daughters recorded', () => {
    const t = tracker();
    const W0 = walls([1, 1, 6, 2]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 2, 2], [5, 1, 6, 2]);
    const c = t.observe(50, W1, genesOn(W1));
    expect(c.compartments.length).toBe(2);
    expect(t.totals).toMatchObject({ fissions: 1, fusions: 0, deaths: 0, denovo: 0 });
    expect(t.fissionRecords.length).toBe(1);
    expect(t.fissionRecords[0].parent).toEqual([12, 12, 0]);
    expect(t.fissionRecords[0].daughters).toEqual([[4, 4, 0], [4, 4, 0]]);
    const uids = c.compartments.map((k) => k.uid);
    expect(new Set(uids).size).toBe(2);
    expect(c.compartments.filter((k) => k.parentUid === uids[0] || k.parentUid === uids[1]).length).toBe(1);
  });

  it('two blobs merging is one fusion and no death; the absorbed one leaves an age, not a lifetime', () => {
    const t = tracker();
    const W0 = walls([1, 1, 2, 2], [5, 1, 6, 2]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 6, 2]);
    const c = t.observe(50, W1, genesOn(W1));
    expect(c.compartments.length).toBe(1);
    expect(t.totals).toMatchObject({ fissions: 0, fusions: 1, deaths: 0, denovo: 0 });
    expect(t.totals.lifetimes).toEqual([]);
    expect(t.totals.absorbedAges).toEqual([50]);
  });

  it('an unmatched previous blob is a death (complete or not), an isolated new blob is denovo', () => {
    const t = tracker();
    const W0 = walls([1, 1, 2, 2], [5, 5, 6, 6]);
    const T0 = genesOn(W0);
    T0[(5 * SIZE + 5) * S + 1] = 0; // the second blob loses gene 1 on every tile
    T0[(5 * SIZE + 6) * S + 1] = 0;
    T0[(6 * SIZE + 5) * S + 1] = 0;
    T0[(6 * SIZE + 6) * S + 1] = 0;
    const c0 = t.observe(0, W0, T0);
    expect(c0.compartments.map((k) => k.complete).sort()).toEqual([false, true]);
    t.observe(50, W0, T0);
    const W2 = walls([9, 9, 10, 10]);
    t.observe(100, W2, genesOn(W2));
    expect(t.totals).toMatchObject({ deaths: 2, deathsComplete: 1, deathsIncomplete: 1, denovo: 1, fissions: 0, fusions: 0 });
    expect(t.totals.lifetimes).toEqual([100, 100]);
  });

  it('splits stranded copies into bare, halo and small-patch tiles', () => {
    const t = tracker();
    const W = walls([1, 1, 2, 2]);
    const T = genesOn(W);
    const bare = 5 * SIZE + 5;
    const halo = 7 * SIZE + 7;
    const small = 9 * SIZE + 9;
    W[bare] = 30; // at or below gateLo (31)
    W[halo] = 64;
    W[small] = DG_SCALE; // a one-tile patch, below minArea
    T[bare * S] = 3;
    T[halo * S + 1] = 5;
    T[small * S + 2] = 7;
    const c = t.observe(0, W, T);
    expect(c.strandedBare).toEqual([3, 0, 0]);
    expect(c.strandedHalo).toEqual([0, 5, 0]);
    expect(c.strandedSmall).toEqual([0, 0, 7]);
    expect(c.stranded).toEqual([3, 5, 7]);
    expect(c.compartments[0].copies).toEqual([4, 4, 0]);
  });

  it('heredity compares daughters with the parent and with the parent\'s neighbour', () => {
    const recs: FissionRecord[] = [0.1, 0.3, 0.5, 0.7, 0.9].map((p, i) => ({
      step: 50,
      parentUid: i + 1,
      parent: [p * 10, 10 - p * 10, 0],
      neighbour: [5, 5, 0],
      daughters: [[p * 10, 10 - p * 10, 0], [p * 10 + 1, 9 - p * 10, 0]],
      unrelated: i % 2 === 0 ? [3 + i, 7 - i, 0] : null,
      daughterUids: [i + 1, 100 + i],
      delayed: [[p * 10, 10 - p * 10, 0], null],
      delayedStatus: ['read', i === 0 ? 'fused' : 'gone'],
    }));
    const h = heredity(recs, (c) => c[0] / (c[0] + c[1]));
    expect(h.pairs).toBe(10);
    expect(h.parentR).toBeGreaterThan(0.95);
    expect(h.neighbourR).toBeNull(); // the neighbour trait has no variance
    const d = heredityDelayed(recs, (c) => c[0] / (c[0] + c[1]));
    expect(d.pairs).toBe(5);
    expect([d.read, d.gone, d.fused, d.pending]).toEqual([5, 4, 1, 0]);
    // the unrelated control only has a value on three of the five records, and both figures use those three
    expect(d.unrelatedPairs).toBe(3);
    expect(d.parentRUnrelatedSet).toBeGreaterThan(0.99);
    expect(d.unrelatedR).not.toBeNull();
    expect(d.parentR).toBeGreaterThan(0.99);
  });

  it('reads each daughter again after the heredity delay, by uid, and counts the ones that are gone', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100 });
    const W0 = walls([1, 1, 6, 2]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 2, 2], [5, 1, 6, 2]);
    t.observe(50, W1, genesOn(W1));
    expect(t.fissionRecords).toHaveLength(1);
    const rec = t.fissionRecords[0];
    expect(rec.delayed).toEqual([null, null]);
    // Step 100: not due yet (due at 150). The left daughter's copies change; the right one is still there.
    const T2 = genesOn(W1);
    T2[(1 * SIZE + 1) * S] = 7; // gene 0 on one left tile
    t.observe(100, W1, T2);
    expect(rec.delayed).toEqual([null, null]);
    // Step 150: due. The right daughter has dissolved; the left one is read with its copies as they are now.
    const W3 = walls([1, 1, 2, 2]);
    const T3 = genesOn(W3);
    T3[(1 * SIZE + 1) * S] = 7;
    t.observe(150, W3, T3);
    const left = rec.daughterUids.findIndex((_, i) => rec.delayed[i] !== null);
    expect(rec.delayed.filter((d) => d === null)).toHaveLength(1);
    expect(rec.delayed[left]).toEqual([10, 4, 0]);
    const h = heredityDelayed(t.fissionRecords, (c) => gene0Share(c, K));
    expect([h.read, h.gone, h.fused, h.pending]).toEqual([1, 1, 0, 0]);
    expect(h.pairs).toBe(0); // there was no other compartment before the split, so no matched neighbour control
    // A later census does not overwrite the delayed read.
    t.observe(200, W3, genesOn(W3));
    expect(rec.delayed[left]).toEqual([10, 4, 0]);
  });
  it('a daughter that merges with another compartment during the delay is left out as fused; one cut off by the end of the run stays pending', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100 });
    // A blob that will split, and a bystander below the right-hand daughter.
    const W0 = walls([1, 1, 6, 2], [5, 5, 6, 6]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 2, 2], [5, 1, 6, 2], [5, 5, 6, 6]);
    t.observe(50, W1, genesOn(W1));
    expect(t.totals.fissions).toBe(1);
    const rec = t.fissionRecords[0];
    // Step 100: the right-hand daughter grows down and merges with the bystander.
    const W2 = walls([1, 1, 2, 2], [5, 1, 6, 6]);
    t.observe(100, W2, genesOn(W2));
    expect(t.totals.fusions).toBe(1);
    // Step 150: both delayed reads are due.
    t.observe(150, W2, genesOn(W2));
    expect(rec.delayedStatus.slice().sort()).toEqual(['fused', 'read']);
    const fused = rec.delayedStatus.indexOf('fused');
    expect(rec.delayed[fused]).toBeNull();
    // A second split at step 200 with no census 100 steps later: its daughters stay pending.
    const W4 = walls([1, 1, 2, 2], [5, 1, 6, 2], [5, 5, 6, 6]);
    t.observe(200, W4, genesOn(W4));
    expect(t.fissionRecords).toHaveLength(2);
    expect(t.fissionRecords[1].delayedStatus).toEqual(['pending', 'pending']);
    const h = heredityDelayed(t.fissionRecords, (c) => gene0Share(c, K));
    expect([h.read, h.gone, h.fused, h.pending]).toEqual([1, 0, 1, 2]);
  });

  it('the unrelated control skips the nearest neighbour when it is a sister by tracker id', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100 });
    // One blob splits into a left keeper and a right daughter; a far compartment sits at the bottom.
    const W0 = walls([1, 1, 6, 4], [1, 9, 2, 10]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 2, 4], [5, 1, 6, 4], [1, 9, 2, 10]);
    const T1 = genesOn(W1);
    T1[(9 * SIZE + 1) * S] = 9; // mark the far compartment: gene 0 = 12 in all
    t.observe(50, W1, T1);
    expect(t.totals.fissions).toBe(1);
    // Now the right daughter splits again into a top row and a bottom block.
    const W2 = walls([1, 1, 2, 4], [5, 1, 7, 1], [5, 3, 6, 4], [1, 9, 2, 10]);
    t.observe(100, W2, genesOn(W2));
    expect(t.totals.fissions).toBe(2);
    const rec = t.fissionRecords[t.fissionRecords.length - 1];
    // Nearest to the splitting right daughter is the left keeper, its sister-and-parent lineage; the unrelated
    // control has to be the far compartment, whose copies were marked.
    expect(rec.neighbour).toEqual([8, 8, 0]);
    expect(rec.unrelated).toEqual([12, 4, 0]);
  });
  it('a daughter that overlaps a second compartment in the census of its own split is fused, not read', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, heredityDelay: 100 });
    // A blob about to split, and a bystander just below where its right half will be.
    const W0 = walls([1, 1, 6, 2], [5, 4, 6, 5]);
    t.observe(0, W0, genesOn(W0));
    // In one census the blob splits and its right half joins the bystander.
    const W1 = walls([1, 1, 2, 2], [5, 1, 6, 5]);
    t.observe(50, W1, genesOn(W1));
    expect(t.totals.fissions).toBe(1);
    expect(t.totals.fusions).toBe(1);
    t.observe(100, W1, genesOn(W1));
    t.observe(150, W1, genesOn(W1));
    const rec = t.fissionRecords[0];
    expect(rec.delayedStatus.slice().sort()).toEqual(['fused', 'read']);
  });

  // ---- LINKED2: which genes a compartment lacked when it ended ----

  /** Remove every copy of `gene` from the tiles of a rectangle. */
  function without(T: Uint32Array, gene: number, [x0, y0, x1, y1]: [number, number, number, number]): Uint32Array {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T[(y * SIZE + x) * S + gene] = 0;
    return T;
  }

  it('a death records the genes missing at the last census and since which census; a complete one records none', () => {
    const t = tracker();
    const A: [number, number, number, number] = [1, 1, 2, 2];
    const B: [number, number, number, number] = [5, 5, 6, 6];
    const W = walls(A, B);
    t.observe(0, W, genesOn(W));
    t.observe(50, W, without(genesOn(W), 1, B)); // B loses gene 1 here
    t.observe(100, W, without(genesOn(W), 1, B));
    t.observe(150, walls(), new Uint32Array(SIZE * SIZE * S)); // both gone
    expect(t.totals).toMatchObject({ deaths: 2, deathsComplete: 1, deathsIncomplete: 1 });
    expect(t.deathRecords.length).toBe(2);
    const a = t.deathRecords.find((r) => r.copies[1] > 0)!;
    const b = t.deathRecords.find((r) => r.copies[1] === 0)!;
    expect(a).toMatchObject({ step: 150, lastSeen: 100, bornStep: 0, area: 4, copies: [4, 4, 0], missingSince: [-1, -1] });
    expect(b).toMatchObject({ step: 150, lastSeen: 100, bornStep: 0, area: 4, copies: [4, 0, 0], missingSince: [-1, 50] });
    const d = deathReadout(t.deathRecords, K);
    expect(d).toEqual({ records: 2, withMissing: 1, missingByGene: [0, 1], byMissingCount: [1, 1, 0], medianMissingSteps: 100, missingAtTwoCensusesShare: 1 });
    // The readout agrees with the count the tracker already kept.
    expect(d.withMissing).toBe(t.totals.deathsIncomplete);
  });

  it('a gene that comes back clears its date; one missing only at the last census is not "seen at two censuses"', () => {
    const t = tracker();
    const B: [number, number, number, number] = [5, 5, 6, 6];
    const W = walls(B);
    t.observe(0, W, without(genesOn(W), 0, B)); // gene 0 missing at the first census
    t.observe(50, W, genesOn(W)); // and back
    t.observe(100, W, without(genesOn(W), 0, B)); // missing again, at the last census only
    t.observe(150, walls(), new Uint32Array(SIZE * SIZE * S));
    expect(t.deathRecords.length).toBe(1);
    expect(t.deathRecords[0].missingSince).toEqual([100, -1]);
    expect(deathReadout(t.deathRecords, K)).toMatchObject({ withMissing: 1, missingByGene: [1, 0], medianMissingSteps: 50, missingAtTwoCensusesShare: 0 });
  });

  it('a daughter born by a split keeps the date of a gene its parent already lacked', () => {
    const t = tracker();
    const W0 = walls([1, 1, 6, 2]);
    t.observe(0, W0, without(genesOn(W0), 1, [1, 1, 6, 2])); // the parent lacks gene 1 from step 0
    const W1 = walls([1, 1, 2, 2], [5, 1, 6, 2]);
    t.observe(50, W1, without(genesOn(W1), 1, [1, 1, 6, 2])); // it splits; neither daughter has gene 1
    expect(t.totals.fissions).toBe(1);
    t.observe(100, walls(), new Uint32Array(SIZE * SIZE * S));
    expect(t.deathRecords.length).toBe(2);
    expect(t.deathRecords.map((r) => r.missingSince)).toEqual([[-1, 0], [-1, 0]]);
    expect(t.deathRecords.map((r) => r.bornStep).sort()).toEqual([0, 50]);
  });

  it('a compartment absorbed by a fusion leaves no death record, and the record list is capped', () => {
    const t = new CompartmentTracker(SIZE, SIZE, S, K, { wallMin: 0.125, bareMax: 0.03, maxDeathRecords: 1 });
    const W0 = walls([1, 1, 2, 2], [5, 1, 6, 2]);
    t.observe(0, W0, genesOn(W0));
    const W1 = walls([1, 1, 6, 2]);
    t.observe(50, W1, genesOn(W1));
    expect(t.totals.fusions).toBe(1);
    expect(t.deathRecords.length).toBe(0);
    const W2 = walls([1, 1, 2, 2], [8, 8, 9, 9]);
    t.observe(100, W2, genesOn(W2)); // the merged blob shrinks; a far blob appears
    t.observe(150, walls(), new Uint32Array(SIZE * SIZE * S)); // two deaths, one record kept
    expect(t.totals.deaths).toBe(2);
    expect(t.deathRecords.length).toBe(1);
    expect(deathReadout(t.deathRecords, K).records).toBe(1);
  });

  it('three genes, several deaths: the span is from the earliest still-missing gene, the median is over deaths with a gene missing', () => {
    const S3 = 4; // three genes and the parasite
    const t = new CompartmentTracker(SIZE, SIZE, S3, 3, { wallMin: 0.125, bareMax: 0.03 });
    const rects: [number, number, number, number][] = [[0, 0, 1, 1], [4, 0, 5, 1], [8, 0, 9, 1], [0, 4, 1, 5], [4, 4, 5, 5]];
    /** All three genes on every walled tile, except the genes listed per rectangle. */
    const copies = (W: Uint32Array, lacking: number[][]): Uint32Array => {
      const T = new Uint32Array(SIZE * SIZE * S3);
      for (let i = 0; i < W.length; i++) if (W[i] > 0) for (let k = 0; k < 3; k++) T[i * S3 + k] = 1;
      rects.forEach(([x0, y0, x1, y1], r) => {
        for (const k of lacking[r] ?? []) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T[(y * SIZE + x) * S3 + k] = 0;
      });
      return T;
    };
    const W = walls(...rects);
    //            A        B        C     D   E
    t.observe(0, W, copies(W, [[2], [], [], [], []])); // A lacks gene 2 from step 0
    t.observe(50, W, copies(W, [[2], [0], [], [], []])); // B lacks gene 0 from step 50
    t.observe(100, W, copies(W, [[1, 2], [0], [], [], []])); // A lacks gene 1 as well from step 100
    t.observe(150, W, copies(W, [[1, 2], [0, 1], [2], [], []])); // B lacks gene 1 from 150; C lacks gene 2 at the last census only
    t.observe(200, walls(rects[4]), copies(walls(rects[4]), [])); // A, B, C and D are gone; E lives
    expect(t.totals).toMatchObject({ deaths: 4, deathsComplete: 1, deathsIncomplete: 3 });
    const withCopies = (x: number[]) => t.deathRecords.find((r) => r.copies[0] === x[0] && r.copies[1] === x[1] && r.copies[2] === x[2])!;
    expect(withCopies([4, 0, 0]).missingSince).toEqual([-1, 100, 0]); // A
    expect(withCopies([0, 0, 4]).missingSince).toEqual([50, 150, -1]); // B
    expect(withCopies([4, 4, 0]).missingSince).toEqual([-1, -1, 150]); // C
    expect(withCopies([4, 4, 4]).missingSince).toEqual([-1, -1, -1]); // D
    // Spans from the earliest still-missing gene to gone: A 200, B 150, C 50. Median 150; A and B seen at two censuses or more.
    expect(deathReadout(t.deathRecords, 3)).toEqual({
      records: 4,
      withMissing: 3,
      missingByGene: [1, 2, 2],
      byMissingCount: [1, 1, 2, 0],
      medianMissingSteps: 150,
      missingAtTwoCensusesShare: 2 / 3,
    });
  });
});
