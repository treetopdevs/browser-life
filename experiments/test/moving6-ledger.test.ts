import { describe, expect, it } from 'vitest';
import { MOTIFS, ObjectTracker, type TrackerResult } from '../b2check/observe.ts';
import { BodyLog, type BodyLogResult } from '../spot6/bodylog.ts';
import { bodyReadouts, newBirths } from '../spot6/rule.ts';
import { buildChains, isBody, type Ledger, ledgerOf } from '../moving6/ledger.ts';
import { MoveLog, type MoveLogResult } from '../moving6/movelog.ts';

const SIZE = 32;
type Field = Uint32Array;
function field(): Field {
  return new Uint32Array(SIZE * SIZE * MOTIFS);
}
function rect(W: Field, x0: number, y0: number, w: number, h: number, motif = 0, value = 600): Field {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) W[(((y0 + dy) % SIZE) * SIZE + ((x0 + dx) % SIZE)) * MOTIFS + motif] = value;
  return W;
}
/** A frame from a list of rectangles: [x, y, w, h, type?, value?]. */
type Rect = [number, number, number, number, number?, number?];
const frame = (...rs: Rect[]): Field => rs.reduce((W, r) => rect(W, r[0], r[1], r[2], r[3], r[4] ?? 0, r[5] ?? 600), field());

interface Run {
  tr: TrackerResult;
  log: BodyLogResult;
  move: MoveLogResult;
}
/** `phases`: [number of frames, the frame] in order; frames are 10 steps apart from step 0, as the runner feeds them. */
function run(phases: [number, Field][]): Run {
  const tracker = new ObjectTracker(SIZE, SIZE);
  const log = new BodyLog(SIZE, SIZE);
  const move = new MoveLog(SIZE, SIZE);
  const none = field();
  let k = 0;
  for (const [n, W] of phases) {
    for (let q = 0; q < n; q++, k++) {
      const labelled = tracker.observe(k * 10, W, none);
      log.observe(k * 10, labelled, W, none);
      move.observe(k * 10, labelled, W);
    }
  }
  return { tr: tracker.finish(), log: log.finish(), move: move.finish() };
}
const ledger = (r: Run, within?: number): Ledger => ledgerOf(r.tr, r.log, r.move, 10, SIZE, buildChains(r.tr, r.log, within));
const births = (l: Ledger) => [l.births.division, l.births['split not shown apart'], l.births.relabel, l.births['from nothing'], l.births['returned piece']];
const deaths = (l: Ledger) => [l.deaths.fade, l.deaths.fusion, l.deaths['relabelled away']];

const LONG: Rect = [4, 4, 9, 3];
const LEFT: Rect = [4, 4, 3, 3];
const RIGHT: Rect = [10, 4, 3, 3];

describe('moving6 ledger: what is a birth', () => {
  it('a body that grows and pinches in two, the parts apart by water, is one birth by division', () => {
    const r = run([[40, frame(LEFT)], [20, frame(LONG)], [191, frame(LEFT, RIGHT)]]);
    const l = ledger(r);
    expect([l.from, l.to]).toEqual([500, 1500]);
    expect(births(l)).toEqual([1, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 2]);
    expect(l.newBodies[0].apart).toBe('apart');
    expect(l.newBodies[0].distance).toBeCloseTo(6, 5);
    expect(l.newBodies[0].lived).toBeNull();
  });

  it('a split whose parts stay joined by wall of 0.05 or more is set aside as not shown apart', () => {
    const bridge: Rect = [7, 4, 3, 3, 0, 100];
    const l = ledger(run([[40, frame(LEFT)], [20, frame(LONG)], [191, frame(LEFT, RIGHT, bridge)]]));
    expect(births(l)).toEqual([0, 1, 0, 0, 0]);
    expect(l.notApart).toEqual({ samePatch: 1, notRead: 0 });
    expect(l.newFirstHalf.division + l.newSecondHalf.division).toBe(0);
  });

  it('without a move log the apart reading falls back to the earlier id-based note', () => {
    const r = run([[40, frame(LEFT)], [20, frame(LONG)], [191, frame(LEFT, RIGHT)]]);
    const l = ledgerOf(r.tr, r.log, null, 10, SIZE);
    expect(births(l)).toEqual([1, 0, 0, 0, 0]);
    expect(l.newBodies[0].distance).toBeNull();
  });

  it('a body appearing where nothing was is a birth from nothing', () => {
    const l = ledger(run([[80, frame(LEFT)], [171, frame(LEFT, [20, 20, 3, 3])]]));
    expect(births(l)).toEqual([0, 0, 0, 1, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 2]);
  });

  it('a split that does not hold 500 steps is nothing, whichever part keeps the id', () => {
    // The right part is the daughter. They rejoin 200 steps later as one object that sits mostly on the right
    // part, so the tracker keeps the daughter's id and ends the parent's by absorption.
    const rejoined = ledger(run([[60, frame(LONG)], [20, frame(LEFT, RIGHT)], [171, frame([6, 4, 9, 3])]]));
    expect(births(rejoined)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(rejoined)).toEqual([0, 0, 0]);
    expect([rejoined.bodiesAtStart, rejoined.bodiesAtEnd]).toEqual([1, 1]);
    expect(rejoined.continuations['handed on']).toBe(1);
    // The part that kept the parent's id fades 200 steps after the split: the body goes on in the other part.
    const shed = ledger(run([[60, frame(LONG)], [20, frame(LEFT, RIGHT)], [171, frame(RIGHT)]]));
    expect(births(shed)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(shed)).toEqual([0, 0, 0]);
    expect([shed.bodiesAtStart, shed.bodiesAtEnd]).toEqual([1, 1]);
    // Held 600 steps, then the parent's part fades: a division, and later a death.
    const held = ledger(run([[60, frame(LONG)], [60, frame(LEFT, RIGHT)], [171, frame(RIGHT)]]));
    expect(births(held)).toEqual([1, 0, 0, 0, 0]);
    expect(deaths(held)).toEqual([1, 0, 0]);
    expect([held.bodiesAtStart, held.bodiesAtEnd]).toEqual([1, 1]);
  });

  it('a neck that wobbles across the counting line makes no body', () => {
    const phases: [number, Field][] = [];
    for (let k = 0; k < 25; k++) phases.push([5, frame(LONG)], [5, frame([4, 4, 4, 3], [9, 4, 4, 3])]);
    phases.push([1, frame(LONG)]);
    const r = run(phases);
    const l = ledger(r);
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 1]);
    expect(l.flickerShare).toBeGreaterThan(0);
    expect(buildChains(r.tr, r.log).chains.filter(isBody)).toHaveLength(1);
  });
});

describe('moving6 ledger: bodies of one type that touch and part', () => {
  // Two bodies are bridged for 200 steps and come apart again. The second has drifted while joined, so it does
  // not come back on its old footprint, and a little wall stays between them.
  const touch = (): Run => run([[80, frame(LEFT, RIGHT)], [20, frame(LONG)], [151, frame(LEFT, [11, 6, 3, 3], [7, 5, 4, 2, 0, 100])]]);

  it('is nothing in this ledger', () => {
    const l = ledger(touch());
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([2, 2]);
    expect(l.continuations.parted).toBe(1);
  });

  it('read by the earlier rule as an end with no birth, although the count did not change', () => {
    const { tr, log } = touch();
    const old = bodyReadouts(tr, 10, log);
    expect(newBirths(old)).toBe(0);
    expect(old.lastingEnds - old.returnedEnds).toBe(1);
    expect(tr.census[0].drop).toBe(2);
    expect(tr.census[tr.census.length - 1].drop).toBe(2);
  });

  it('a merge held more than 500 steps is a death by fusion, and a later pinch elsewhere a birth by division', () => {
    const limb: Rect = [4, 7, 3, 6];
    const r = run([[60, frame(LEFT, RIGHT)], [70, frame(LONG)], [10, frame(LONG, limb)], [171, frame(LONG, [4, 9, 3, 4])]]);
    const l = ledger(r);
    expect(births(l)).toEqual([1, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 1, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([2, 2]);
    // Described-only variant: with no limit on how long a merge may last, the pinch is read as the two coming apart.
    const any = ledger(r, Infinity);
    expect(births(any)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(any)).toEqual([0, 0, 0]);
  });
});

describe('moving6 ledger: hand-ons keep what hangs on the body', () => {
  it('a body that merged into one that is then handed on can still part from it', () => {
    // Two bodies merge at step 600. At 700 a relabelling cuts a piece off the merged object; at 800 the rest
    // fades, so the body goes on in the piece. At 950 the piece splits: the merged body coming apart again.
    const piece: Rect = [10, 4, 3, 3, 1];
    const r = run([
      [60, frame(LEFT, RIGHT)],
      [10, frame(LONG)],
      [10, frame([4, 4, 6, 3], piece)],
      [10, frame(piece)],
      [5, frame([10, 4, 3, 9, 1])],
      [171, frame(piece, [10, 10, 3, 3, 1])],
    ]);
    const l = ledger(r);
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([2, 2]);
    expect(l.continuations).toMatchObject({ 'handed on': 1, parted: 1 });
  });

  it('a daughter of a piece is read against the body that took the piece over', () => {
    // 600: the body splits (right part the daughter). 700: the right part splits again. 800: the left part,
    // which kept the body's id, fades: the body goes on in the right part, and the second split is its division.
    const r = run([[60, frame(LONG)], [10, frame(LEFT, [10, 4, 3, 9])], [10, frame(LEFT, RIGHT, [10, 10, 3, 3])], [171, frame(RIGHT, [10, 10, 3, 3])]]);
    const l = ledger(r);
    expect(births(l)).toEqual([1, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 2]);
    expect(l.newBodies[0].apart).toBe('apart');
  });
});

describe('moving6 ledger: dips and relabellings', () => {
  it('a body that dips under the counting line for 200 steps and comes back is nothing', () => {
    const l = ledger(run([[80, frame(LEFT)], [20, field()], [151, frame(LEFT)]]));
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect(l.continuations.returned).toBe(1);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 1]);
  });

  it('a body that dips and comes back as two objects: one is the body, the other a returned piece, not a body from nothing', () => {
    const l = ledger(run([[80, frame(LONG)], [20, field()], [151, frame(LEFT, RIGHT)]]));
    expect(births(l)).toEqual([0, 0, 0, 0, 1]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect(l.continuations.returned).toBe(1);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 2]);
    expect(l.newFirstHalf.nothing + l.newSecondHalf.nothing).toBe(0);
  });

  it('gone for 600 steps is a death, and what comes back a body from nothing', () => {
    const l = ledger(run([[80, frame(LEFT)], [60, field()], [171, frame(LEFT)]]));
    expect(births(l)).toEqual([0, 0, 0, 1, 0]);
    expect(deaths(l)).toEqual([1, 0, 0]);
  });

  it('a whole body relabelled is the same body: no birth, no death', () => {
    const l = ledger(run([[80, frame(LEFT)], [171, frame([4, 4, 3, 3, 1])]]));
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect(l.continuations.relabelled).toBe(1);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 1]);
  });

  it('part of a body relabelled, the rest going on, is a birth by relabelling and not a new body for the division rule', () => {
    const l = ledger(run([[80, frame(LONG)], [171, frame([4, 4, 6, 3], [10, 4, 3, 3, 1])]]));
    expect(births(l)).toEqual([0, 0, 1, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 2]);
    expect(l.newFirstHalf).toEqual({ division: 0, nothing: 0 });
    expect(l.newSecondHalf).toEqual({ division: 0, nothing: 0 });
  });

  it('a body cut in two by a relabelled strip gives two births by relabelling and no division', () => {
    const l = ledger(run([[80, frame(LONG)], [171, frame(LEFT, RIGHT, [7, 4, 3, 3, 1])]]));
    expect(births(l)).toEqual([0, 0, 2, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 3]);
  });

  it('part relabelled and the old part gone inside 500 steps is one body that changed type', () => {
    const l = ledger(run([[80, frame(LONG)], [20, frame([4, 4, 6, 3], [10, 4, 3, 3, 1])], [171, frame([10, 4, 3, 3, 1])]]));
    expect(births(l)).toEqual([0, 0, 0, 0, 0]);
    expect(deaths(l)).toEqual([0, 0, 0]);
    expect([l.bodiesAtStart, l.bodiesAtEnd]).toEqual([1, 1]);
  });
});

describe('moving6 ledger: the balance', () => {
  it('bodies at the end less bodies at the start is births less deaths, on scrambled frames', () => {
    // Blobs that come, go, grow, join and change type on a fixed pseudo-random schedule.
    let s = 12345;
    const rnd = (n: number) => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return (s >>> 8) % n;
    };
    for (let trial = 0; trial < 5; trial++) {
      const phases: [number, Field][] = [];
      let blobs: Rect[] = Array.from({ length: 6 }, () => [rnd(28), rnd(28), 2 + rnd(4), 2 + rnd(3), rnd(2)] as Rect);
      for (let p = 0; p < 40; p++) {
        blobs = blobs.map((b) => (rnd(4) === 0 ? ([(b[0] + rnd(3)) % SIZE, (b[1] + rnd(2)) % SIZE, 2 + rnd(5), 2 + rnd(3), rnd(6) === 0 ? rnd(2) : b[4]] as Rect) : b));
        if (rnd(5) === 0) blobs.pop();
        if (rnd(4) === 0) blobs.push([rnd(28), rnd(28), 2 + rnd(4), 2 + rnd(3), rnd(2)]);
        phases.push([5 + rnd(40), frame(...blobs)]);
      }
      const r = run(phases);
      const l = ledger(r); // throws if the bodies do not balance
      expect(l.bodiesAtEnd - l.bodiesAtStart).toBe(l.birthsTotal - l.deathsTotal);
      const chains = buildChains(r.tr, r.log);
      // Every tracker id belongs to exactly one chain at a time, and no chain holds two ids at once.
      for (const c of chains.chains) {
        c.parts.forEach((part, k) => {
          if (k > 0) expect(part.from).toBeGreaterThanOrEqual(c.parts[k - 1].to as number);
        });
      }
      const owned = new Map<number, number>();
      for (const c of chains.chains) for (const part of c.parts) owned.set(part.uid, (owned.get(part.uid) ?? 0) + (part.to ?? r.tr.lastStep + 10) - part.from);
      for (const rec of r.tr.records) expect(owned.get(rec.uid)).toBe((rec.end ?? r.tr.lastStep + 10) - rec.born);
    }
  });
});

describe('move log', () => {
  it('keeps, every 50 steps, each object\'s id, low-wall patch and centre', () => {
    const r = run([[11, frame(LEFT, RIGHT, [7, 4, 3, 3, 0, 100], [20, 20, 3, 3, 1])]]);
    expect(r.move.every).toBe(50);
    expect(r.move.frames.map((x) => x.t)).toEqual([0, 50, 100]);
    const f0 = r.move.frames[0];
    expect(f0.uid).toHaveLength(3);
    // The two type-0 bodies are joined by thin wall; the third stands alone.
    expect(f0.low[0]).toBe(f0.low[1]);
    expect(f0.low[2]).not.toBe(f0.low[0]);
    expect([f0.cx[0], f0.cy[0]]).toEqual([5, 5]);
  });
});
