/**
 * The page's clock for Soft Roam, with no browser in it so it can be tested: how many steps are owed at the chosen pace, how
 * far between the last two steps the picture sits, one request in flight at a time, manual steps that are never lost, and
 * recovery after a failure. Time is "step + alpha": it only ever moves forward, also over Pause, One step and Play.
 */

export type PacerAction =
  | { kind: 'advance'; steps: number; alpha: number }
  | { kind: 'paint'; alpha: number };

export class SoftRoamPacer {
  playing = true;
  /** The world could not be made or stepped: nothing is requested until `startAgain`. */
  failed = false;
  /** A request is out; the next goes when its frame (or its failure) arrives. */
  waiting = false;
  /** Steps' worth of time not yet spent; its fraction is how far between the last two steps the picture sits. */
  owed = 0;
  /** The alpha of the picture on screen. */
  alpha = 1;
  shownStep = 0;
  /** Steps per second, measured over about half a second. */
  rate = 0;
  private manual = 0;
  private repaint = false;
  private sent = 0;
  private sentManual = false;
  private stepAtSend = 0;
  private rateStep = 0;
  private rateTime = 0;

  constructor(now = 0) {
    this.rateTime = now;
  }

  /** A new world was asked for: everything starts over, and the request for it is out. */
  reset(now: number): void {
    this.failed = false;
    this.waiting = true;
    this.owed = 0;
    this.alpha = 1;
    this.shownStep = 0;
    this.manual = 0;
    this.repaint = false;
    this.sent = 0;
    this.sentManual = false;
    this.stepAtSend = 0;
    this.rate = 0;
    this.rateStep = 0;
    this.rateTime = now;
  }

  /** The Play / Pause button. Returns true when the page must start a new world first (after a failure). */
  toggle(): boolean {
    if (this.failed) {
      this.playing = true;
      return true;
    }
    this.playing = !this.playing;
    // Carry on from where the picture is, never from the start of a step.
    if (this.playing) this.owed = this.alpha;
    return false;
  }

  /** One manual step (only while paused); every click counts, also while a frame is still pending. */
  stepOnce(): void {
    if (!this.playing && !this.failed) this.manual++;
  }

  /** Something about the picture changed (the look): draw it again when the worker is free. */
  wantRepaint(): void {
    this.repaint = true;
  }

  /** Advance the clock by `dtMs` at `pace` steps a second and say what to ask the worker for, if anything. */
  tick(dtMs: number, pace: number): PacerAction | null {
    if (this.playing && !this.failed) {
      // Never let a stalled tab or a slow worker pile up a burst of steps.
      this.owed = Math.min(this.owed + (pace * dtMs) / 1000, Math.max(2, pace / 10));
    }
    if (this.failed || this.waiting) return null;
    if (this.manual > 0) {
      const k = this.manual;
      this.manual = 0;
      this.send(k, true);
      this.alpha = 1;
      // Play pressed while these clicks were queued: carry on from the end of the manual step (alpha 1), keeping any larger credit.
      if (this.playing) this.owed = Math.max(this.owed, 1);
      this.repaint = false;
      return { kind: 'advance', steps: k, alpha: 1 };
    }
    if (this.playing && this.owed >= 1) {
      const k = Math.floor(this.owed);
      this.owed -= k;
      this.send(k, false);
      this.alpha = this.owed;
      this.repaint = false;
      return { kind: 'advance', steps: k, alpha: this.owed };
    }
    if (this.playing || this.repaint) {
      if (this.playing) this.alpha = Math.min(1, this.owed);
      this.repaint = false;
      this.waiting = true;
      return { kind: 'paint', alpha: this.alpha };
    }
    return null;
  }

  private send(steps: number, manual: boolean): void {
    this.waiting = true;
    this.sent = steps;
    this.sentManual = manual;
    this.stepAtSend = this.shownStep;
  }

  /** A frame of the current world arrived, showing `step`. */
  onFrame(step: number, now: number): void {
    this.waiting = false;
    // Steps the worker ran out of time for are owed again.
    if (this.sent > 0) {
      const done = step - this.stepAtSend;
      if (done < this.sent) {
        if (this.sentManual) this.manual += this.sent - done;
        else this.owed += this.sent - done;
      }
      this.sent = 0;
    }
    this.shownStep = step;
    if (now - this.rateTime > 500) {
      this.rate = ((step - this.rateStep) * 1000) / (now - this.rateTime);
      this.rateStep = step;
      this.rateTime = now;
    }
  }

  /** The worker failed (to load, to make the world or to step it): stop asking, and let Play start again. */
  onFailure(): void {
    this.failed = true;
    this.playing = false;
    this.waiting = false;
    this.sent = 0;
    this.manual = 0;
  }
}
