import { describe, expect, it } from 'vitest';
import { type PacerAction, SoftRoamPacer } from '../src/softroam/pacer.ts';

/** A pretend worker: answers every request at once (or never, when `slow`), counting the steps it ran. */
function rig(pace: number) {
  const p = new SoftRoamPacer(0);
  let now = 0;
  let step = 0;
  const log: { step: number; alpha: number; time: number }[] = [];
  const pending: PacerAction[] = [];
  p.reset(now);
  p.onFrame(0, now);
  const frame = (a: PacerAction): void => {
    if (a.kind === 'advance') step += a.steps;
    log.push({ step, alpha: a.alpha, time: step - 1 + a.alpha });
    p.onFrame(step, now);
  };
  const tick = (ms: number, answer = true): PacerAction | null => {
    now += ms;
    const a = p.tick(ms, pace);
    if (a) { if (answer) frame(a); else pending.push(a); }
    return a;
  };
  const answerPending = (): void => { const a = pending.shift(); if (a) frame(a); };
  return { p, tick, log, step: () => step, answerPending, now: () => now };
}

describe('soft roam pacer', () => {
  it('never moves the picture backwards over Pause, One step and Play (time is step + alpha)', () => {
    const r = rig(5);
    for (let i = 0; i < 30; i++) r.tick(16.7);
    r.p.toggle(); // pause
    r.p.stepOnce();
    r.tick(16.7); // the manual step, painted at alpha 1
    expect(r.log[r.log.length - 1].alpha).toBe(1);
    r.p.toggle(); // play
    for (let i = 0; i < 40; i++) r.tick(16.7);
    for (let k = 1; k < r.log.length; k++) expect(r.log[k].time).toBeGreaterThanOrEqual(r.log[k - 1].time - 1e-9);
  });

  it('resuming from a pause part-way through a step carries on from there', () => {
    const r = rig(5);
    while (r.p.owed < 0.9 || r.log.length < 3) r.tick(16.7);
    const last = r.log[r.log.length - 1].time;
    r.p.toggle();
    r.p.toggle();
    r.tick(16.7);
    expect(r.log[r.log.length - 1].time).toBeGreaterThanOrEqual(last - 1e-9);
  });

  it('keeps every manual step, also those clicked while a frame is pending', () => {
    const r = rig(30);
    r.p.toggle(); // pause
    r.tick(16.7);
    r.p.stepOnce();
    r.tick(16.7, false); // request out, frame not back yet
    r.p.stepOnce();
    r.p.stepOnce();
    r.tick(16.7, false); // nothing new while waiting
    r.answerPending();
    r.tick(16.7); // the two later clicks go out together
    expect(r.step()).toBe(3);
  });

  it('a manual step the worker cut short is asked again', () => {
    const p = new SoftRoamPacer(0);
    p.reset(0);
    p.onFrame(0, 0);
    p.toggle();
    p.stepOnce();
    p.stepOnce();
    const a = p.tick(16, 30)!;
    expect(a).toEqual({ kind: 'advance', steps: 2, alpha: 1 });
    p.onFrame(1, 20); // only one of the two ran
    expect(p.tick(16, 30)).toEqual({ kind: 'advance', steps: 1, alpha: 1 });
  });

  it('a failure stops requests, and Play starts again and then runs', () => {
    const r = rig(30);
    for (let i = 0; i < 5; i++) r.tick(16.7);
    r.p.onFailure();
    expect(r.p.playing).toBe(false);
    expect(r.p.waiting).toBe(false);
    expect(r.tick(16.7)).toBeNull();
    expect(r.p.toggle()).toBe(true); // the page makes a new world
    r.p.reset(r.now());
    r.p.onFrame(0, r.now());
    let got: PacerAction | null = null;
    for (let i = 0; i < 10 && !got; i++) got = r.tick(16.7);
    expect(got).not.toBeNull();
  });

  it('the rate readout starts from zero for a new world', () => {
    const p = new SoftRoamPacer(0);
    p.reset(0);
    p.onFrame(0, 0);
    p.onFrame(400, 1000);
    expect(p.rate).toBeCloseTo(400, 6);
    p.toggle();
    p.reset(1000);
    p.onFrame(0, 1100);
    expect(p.rate).toBe(0);
  });
});
