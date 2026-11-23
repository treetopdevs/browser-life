/**
 * MOVING6: one more thing kept per frame beside the compartment check's tracker and the earlier screen's body
 * log, because frames are not stored and ids rarely last 500 steps where bodies move.
 *
 * Every `every` steps (50, the body log's series spacing), for each counted object: the tracker's id, the id
 * of the connected patch of total wall (all types summed) of 0.05 or more that it lies in, and its centre.
 * With this the ledger (ledger.ts) can ask, for two bodies followed through their changes of id, whether
 * they stand in different low-wall patches at a later frame, and how far apart they are.
 *
 * Pure: no Deno or browser API. Nothing here feeds back into the kernel.
 */

import type { Labelled } from '../b2check/observe.ts';
import { labelTotalWall, LOW_THRESH } from '../b2check/observe.ts';
import type { SegmentFile } from '../spot6/rule.ts';

export interface MoveFrame {
  readonly t: number;
  readonly uid: number[];
  /** Id (within this frame only) of the patch of total wall >= 0.05 the object lies in. */
  readonly low: number[];
  /** Centre of mass, in tiles, to two decimals (torus coordinates). */
  readonly cx: number[];
  readonly cy: number[];
}

export interface MoveLogResult {
  readonly every: number;
  readonly frames: MoveFrame[];
}

export class MoveLog {
  private readonly frames: MoveFrame[] = [];
  private firstStep = -1;

  constructor(private readonly width: number, private readonly height: number, private readonly every = 50) {}

  observe(step: number, frame: Labelled, W: Uint32Array): void {
    if (this.firstStep < 0) this.firstStep = step;
    if ((step - this.firstStep) % this.every !== 0) return;
    // minArea 1: an object's tiles each carry 0.20 or more of one type, so they are always inside a patch.
    const low = labelTotalWall(W, this.width, this.height, LOW_THRESH, 1).comp;
    const row: MoveFrame = { t: step, uid: [], low: [], cx: [], cy: [] };
    for (const o of frame.objects) {
      row.uid.push(o.uid);
      row.low.push(low[o.tiles[0]]);
      row.cx.push(Math.round(o.cx * 100) / 100);
      row.cy.push(Math.round(o.cy * 100) / 100);
    }
    this.frames.push(row);
  }

  finish(): MoveLogResult {
    return { every: this.every, frames: this.frames };
  }
}

/** One finished segment of a run, as this line's runner writes it: the earlier screen's segment file plus the move log. */
export interface MovingSegmentFile extends SegmentFile {
  /** null in untracked segments, and absent in segment files copied from the earlier screen. */
  movelog?: MoveLogResult | null;
}
