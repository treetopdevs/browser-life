import { describe, expect, it } from 'vitest';
import { observeFindDroplets } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { labelObjects, labelTotalWall, MOTIFS, ObjectTracker, OBJECT_THRESH, type TrackerResult } from '../b2check/observe.ts';
import { windowReadouts, type WindowReadouts } from '../b2check/readouts.ts';
import { buildSegments } from '../b2check/segments.ts';
import { answerWorld, classifyDivision, classifyWindow } from '../b2check/verdict.ts';

const SIZE = 32;

/** An empty wall field, and a helper that fills a rectangle (wrapping) with one wall type. */
function field(): Uint32Array {
  return new Uint32Array(SIZE * SIZE * MOTIFS);
}
function rect(W: Uint32Array, x0: number, y0: number, w: number, h: number, motif = 0, value = 600): Uint32Array {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = (x0 + dx + SIZE * 8) % SIZE;
      const y = (y0 + dy + SIZE * 8) % SIZE;
      W[(y * SIZE + x) * MOTIFS + motif] = value;
    }
  }
  return W;
}

/** Feeds frames 10 steps apart, starting at step 0. */
function track(frames: Uint32Array[], opts = {}): TrackerResult {
  const tr = new ObjectTracker(SIZE, SIZE, opts);
  frames.forEach((W, k) => tr.observe(k * 10, W));
  return tr.finish();
}

describe('labelObjects', () => {
  it('counts exactly what the confirmation counted, on a field with wrapping, small and mixed-type patches', () => {
    const W = field();
    rect(W, 30, 30, 5, 5, 0); // wraps both edges
    rect(W, 10, 10, 2, 1, 0); // two tiles: too small
    rect(W, 12, 20, 3, 1, 1);
    rect(W, 13, 20, 4, 4, 2); // overlaps the type 1 patch on other channels
    rect(W, 20, 5, 4, 4, 3, OBJECT_THRESH - 1); // just under the threshold
    rect(W, 20, 12, 4, 4, 3, OBJECT_THRESH);
    let rnd = 12345;
    for (let k = 0; k < 200; k++) {
      rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0;
      W[rnd % W.length] = 300;
    }
    const mine = labelObjects(W, SIZE, SIZE);
    const theirs = observeFindDroplets(W, SIZE, SIZE, 0.20);
    expect(mine.objects.length).toBe(theirs.length);
    const key = (o: { motif: number; area: number; mass: number; cx: number; cy: number }) => [o.motif, o.area, o.mass, o.cx, o.cy].join(' ');
    expect(mine.objects.map(key).sort()).toEqual(theirs.map(key).sort());
  });

  it('puts the centroid of a patch that straddles both edges on the seam', () => {
    const wrapped = labelObjects(rect(field(), 30, 30, 5, 5), SIZE, SIZE).objects[0];
    // Tiles 30, 31, 0, 1, 2: the centre is tile 0, which the circular mean may report as just under 32.
    expect(Math.min(wrapped.cx, SIZE - wrapped.cx)).toBeCloseTo(0, 6);
    expect(Math.min(wrapped.cy, SIZE - wrapped.cy)).toBeCloseTo(0, 6);
  });

  it('labels total wall blind to type', () => {
    const W = rect(rect(field(), 4, 4, 3, 3, 0, 120), 7, 4, 3, 3, 1, 120);
    expect(labelObjects(W, SIZE, SIZE).objects.length).toBe(0);
    const low = labelTotalWall(W, SIZE, SIZE, 51);
    expect(low.areas.length - 1).toBe(1);
    expect(low.above).toBe(18);
  });
});

describe('ObjectTracker', () => {
  it('reads a patch that stays put as kept, unmoved, solid, isolated and moated', () => {
    const frames = Array.from({ length: 101 }, () => rect(field(), 10, 10, 5, 5));
    const res = track(frames);
    expect(res.records.length).toBe(1);
    expect(res.records[0].birth).toBe('initial');
    expect(res.records[0].end).toBeNull();
    const first = res.samples[0];
    expect(first.solid).toBe(true);
    expect(first.isolated).toBe(true);
    expect(first.moat).toBe(1);
    expect(first.purity).toBe(1);
    expect(first.peak).toBeCloseTo(600 / 1024, 9);
    const at1000 = first.lags.find((l) => l.lag === 1000)!;
    expect(at1000).toMatchObject({ alive: true, disp: 0, keepUid: 1, keepMask: 1 });
    expect(at1000.chance).toBeCloseTo(25 / (SIZE * SIZE), 9);
    // The sample at step 500 cannot be read 1,000 steps later, so that lag is dropped, not reported as a loss.
    const later = res.samples.find((s) => s.t === 500)!;
    expect(later.lags.map((l) => l.lag)).toEqual([100, 500]);
    const r = windowReadouts(res, [{ t: 500, drop: 1 }, { t: 1000, drop: 1 }], 10);
    expect(r.surv1000).toBe(1);
    expect(r.keepUid1000).toBe(1);
    expect(classifyWindow(r).label).toBe('bodies');
  });

  it('reads a band that travels one tile per frame as moved, with no tiles kept', () => {
    // Three tiles wide, the full height: the id survives by overlap, the place does not.
    const frames = Array.from({ length: 101 }, (_, k) => rect(field(), k, 0, 3, SIZE));
    const res = track(frames);
    expect(res.records.length).toBe(1);
    const lag = res.samples[0].lags.find((l) => l.lag === 100)!;
    expect(lag.alive).toBe(true);
    expect(lag.disp).toBeCloseTo(10, 6);
    expect(lag.keepUid).toBe(0);
    expect(lag.keepMask).toBe(0);
    const far = res.samples[0].lags.find((l) => l.lag === 1000)!;
    expect(far.disp).toBeCloseTo(100 % SIZE, 6);
    const r = windowReadouts(res, [{ t: 1000, drop: 1 }], 10);
    expect(r.keepUid1000).toBe(0);
    expect(classifyWindow(r).label).not.toBe('bodies');
  });

  it('marks a hollow ring as not solid', () => {
    const W = rect(field(), 8, 8, 9, 9);
    rect(W, 10, 10, 5, 5, 0, 0);
    const res = track([W]);
    expect(res.samples[0].solid).toBe(false);
  });

  it('records a fission with its parent, and the larger part keeps the id', () => {
    const whole = rect(field(), 5, 5, 9, 3);
    const split = rect(rect(field(), 5, 5, 5, 3), 11, 5, 3, 3);
    const res = track([whole, split]);
    expect(res.records.length).toBe(2);
    const [parent, daughter] = res.records;
    expect(parent.birth).toBe('initial');
    expect(parent.end).toBeNull();
    expect(daughter).toMatchObject({ birth: 'fission', parent: parent.uid, born: 10 });
    expect(daughter.maxArea).toBe(9);
    expect(parent.maxArea).toBe(27);
  });

  it('records a fusion as the smaller object absorbed into the larger', () => {
    const apart = rect(rect(field(), 5, 5, 5, 3), 11, 5, 3, 3);
    const joined = rect(field(), 5, 5, 9, 3);
    const res = track([apart, joined]);
    const big = res.records.find((r) => r.maxArea === 27)!;
    const small = res.records.find((r) => r.uid !== big.uid)!;
    expect(big.end).toBeNull();
    expect(small).toMatchObject({ end: 10, endKind: 'absorbed', into: big.uid });
  });

  it('reads an object that loses most of its tiles while a neighbour takes the rest as absorbed (any overlap, as documented)', () => {
    const before = rect(rect(field(), 5, 5, 3, 3), 8, 5, 4, 4, 0, 0); // a 3 x 3 object, nothing beside it yet
    rect(before, 9, 5, 4, 4); // a 4 x 4 neighbour one empty column away
    const after = rect(field(), 7, 5, 6, 4); // the neighbour has grown one column into the 3 x 3; the rest of the 3 x 3 is gone
    rect(after, 7, 8, 1, 1, 0, 0);
    const res = track([before, after]);
    const small = res.records.find((r) => r.maxArea === 9)!;
    const big = res.records.find((r) => r.uid !== small.uid)!;
    expect(small).toMatchObject({ end: 10, endKind: 'absorbed', into: big.uid });
  });

  it('refuses a frame spacing that skips a lag instead of reporting the object as gone', () => {
    const tr = new ObjectTracker(SIZE, SIZE, { sampleEvery: 30 });
    const W = rect(field(), 10, 10, 5, 5);
    tr.observe(0, W);
    tr.observe(30, W);
    tr.observe(60, W);
    tr.observe(90, W);
    expect(() => tr.observe(120, W)).toThrow(/does not divide the lag 100/);
  });

  it('records a fade, a type switch and a birth from nothing', () => {
    const a = rect(rect(field(), 4, 4, 4, 4, 0), 20, 20, 4, 4, 2);
    const b = rect(rect(field(), 4, 4, 4, 4, 1), 12, 26, 3, 3, 4); // type 0 patch now type 1; type 2 patch gone; new type 4 patch
    const res = track([a, b]);
    const by = (motif: number) => res.records.find((r) => r.motif === motif)!;
    expect(by(0)).toMatchObject({ end: 10, endKind: 'switch' });
    expect(by(1)).toMatchObject({ birth: 'switch', parent: by(0).uid });
    expect(by(2)).toMatchObject({ end: 10, endKind: 'fade' });
    expect(by(4)).toMatchObject({ birth: 'denovo', parent: 0 });
  });

  it('says two objects joined by low wall are not isolated', () => {
    const W = rect(rect(field(), 4, 4, 3, 3), 12, 4, 3, 3);
    rect(W, 7, 5, 5, 1, 1, 60); // a bridge of another type's wall above 0.05
    const res = track([W]);
    expect(res.samples.map((s) => s.isolated)).toEqual([false, false]);
    expect(res.census[0]).toMatchObject({ drop: 2, lowComps: 1, lowLargestShare: 1 });
  });
});

describe('buildSegments', () => {
  it('cuts tracked windows whole and untracked stretches every 20,000 steps', () => {
    expect(buildSegments(80_000, [[0, 10_000], [60_000, 80_000]], 500)).toEqual([
      { from: 0, to: 10_000, tracked: true },
      { from: 10_000, to: 20_000, tracked: false },
      { from: 20_000, to: 40_000, tracked: false },
      { from: 40_000, to: 60_000, tracked: false },
      { from: 60_000, to: 80_000, tracked: true },
    ]);
    expect(() => buildSegments(10_000, [[0, 6_000], [5_000, 10_000]], 500)).toThrow();
    expect(() => buildSegments(10_000, [[0, 10_250]], 500)).toThrow();
  });
});

describe('the pre-stated reading', () => {
  const base: WindowReadouts = {
    from: 0, to: 20_000, count: 70, countMin: 68, countMax: 72, countFirstHalf: 70, countSecondHalf: 70, samples: 100,
    surv100: 1, surv500: 1, surv1000: 0.9, read1000: 95, disp100: 0, disp1000: 0.2, disp1000N: 90, keepUid1000: 0.8,
    keepMask100: 0.9, keepMask1000: 0.8, chance1000: 0.1, solid: 0.95, isolated: 0.8, moatMedian: 0.9,
    peakMedian: 0.6, peakP90: 0.7, meanDensityMedian: 0.4, purityMedian: 1, areaMedian: 20, maxW: 0.8, maxPeak: 0.8,
    dropBlind: 70, lowComps: 70, lowLargestShare: 0.03, lowCover: 0.2, cover: 0.1,
    births: { fission: 0, switch: 0, denovo: 0 }, ends: { fade: 0, absorbed: 0, switch: 0 },
    objectKiloSteps: 1400, birthRate: 0, endRate: 0, daughters: 0, daughtersHeld500: null, daughtersRejoined500: null,
    lastingBirths: { fission: 0, switch: 0, denovo: 0 }, lifetimeMedian: null, lifetimeN: 0,
  };

  it('reads bodies, wave patches, persistent domains and mixed', () => {
    expect(classifyWindow(base).label).toBe('bodies');
    expect(classifyWindow({ ...base, surv1000: 0.5, keepUid1000: 0.5, solid: 0.8, isolated: 0.5, moatMedian: 0.5 }).label).toBe('bodies');
    expect(classifyWindow({ ...base, surv1000: 0.49 }).label).toBe('mixed');
    expect(classifyWindow({ ...base, isolated: 0.2, moatMedian: 0.1 }).label).toBe('persistent domains, not bounded');
    const wave = { ...base, surv1000: 0, keepUid1000: 0, keepMask1000: 0.2, chance1000: 0.19, isolated: 0, moatMedian: 0, solid: 0.6 };
    expect(classifyWindow(wave).label).toBe('wave patches');
    expect(classifyWindow({ ...wave, keepMask1000: 0.4 }).label).toBe('mixed');
    // "Within 0.10 of chance" cuts both ways: far below chance is not a wave reading either.
    expect(classifyWindow({ ...wave, keepMask1000: 0, chance1000: 0.8 }).checks.V2).toBe(false);
    expect(classifyWindow({ ...wave, keepMask1000: 0.1, chance1000: 0.2 }).checks.V2).toBe(true);
    expect(classifyWindow({ ...wave, isolated: 0.3 }).label).toBe('mixed');
    expect(classifyWindow({ ...base, samples: 0 }).label).toBe('no objects');
  });

  it('flags a window whose count is still moving', () => {
    expect(classifyWindow(base).settled).toBe(true);
    expect(classifyWindow({ ...base, countFirstHalf: 60, countSecondHalf: 50 }).settled).toBe(false);
  });

  it('reads division from lasting births pooled over windows', () => {
    const w = (fission: number, sw: number, denovo: number) => ({ ...base, lastingBirths: { fission, switch: sw, denovo } });
    expect(classifyDivision([w(10, 0, 0), w(5, 1, 3)])).toMatchObject({ lasting: 19, label: 'division not observed' });
    expect(classifyDivision([w(10, 0, 0), w(5, 1, 4)])).toMatchObject({ lasting: 20, withParent: 16, label: 'division holds' });
    expect(classifyDivision([w(10, 0, 0), w(5, 0, 5)])).toMatchObject({ lasting: 20, label: 'division does not hold' });
  });

  it('answers for a world from its settled windows', () => {
    const holds = classifyDivision([{ ...base, lastingBirths: { fission: 30, switch: 0, denovo: 0 } }]);
    const none = classifyDivision([base]);
    expect(answerWorld(['bodies', 'bodies', 'bodies', 'mixed'], holds)).toBe('compartments');
    expect(answerWorld(['bodies', 'bodies', 'bodies', 'bodies'], none)).toBe('bodies, division not shown');
    expect(answerWorld(['wave patches', 'wave patches', 'wave patches', 'bodies'], holds)).toBe('wave patches');
    expect(answerWorld(['bodies', 'bodies', 'wave patches', 'mixed'], holds)).toBe('mixed');
    expect(answerWorld(['persistent domains, not bounded', 'persistent domains, not bounded', 'persistent domains, not bounded', 'mixed'], holds)).toBe('persistent domains, not bounded');
  });
});
