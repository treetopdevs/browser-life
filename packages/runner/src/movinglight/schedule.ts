// Exact integer sun paths. The sweep light is a staircase (rotation floors, wander phase is quantised to 512 bins, amplitude scaling
// floors), so every schedule is frozen as the integer meridian path m(t) the rule produces; "speed" is nominal, the realised mean
// speed, first-move step and turning step are reported. Mirrors packages/sim-ref/src/step.ts `light` (sweep branch).
import { divu, mulu } from "@bl/schema";
import { PROTOCOL, type Protocol, type ScheduleId } from "./protocol.ts";

/** The meridian cell of the sweep rule at `step` for a config's day/wander keys (the argmax of RefSim.light over x). */
export function meridianAt(cfg: { tileW: number; dayPeriod?: number; wanderPeriod?: number; wanderAmp?: number }, step: number): number {
  const P = cfg.dayPeriod ?? 0;
  let sun = P > 0 ? divu(mulu(step % P, cfg.tileW), P) : 0;
  const WP = cfg.wanderPeriod ?? 0;
  if (WP > 0) {
    const ph = divu(mulu(step % WP, 512), WP);
    const tri = 256 - Math.abs(ph - 256);
    sun = (sun + (((cfg.wanderAmp ?? 0) * tri) >> 8)) % cfg.tileW;
  }
  return sun;
}

export const keysOf = (schedule: ScheduleId, p: Protocol = PROTOCOL): { dayPeriod: number; wanderPeriod?: number; wanderAmp?: number } =>
  schedule === "fixed" ? { dayPeriod: p.fixed.P } : schedule === "paused" ? { dayPeriod: 0 } : { dayPeriod: 0, wanderPeriod: p.wander.WP, wanderAmp: p.wander.A };

/** The meridian cell at steps 0..T inclusive. */
export function meridianPath(schedule: ScheduleId, p: Protocol = PROTOCOL): number[] {
  const k = { tileW: p.W, ...keysOf(schedule, p) };
  return Array.from({ length: p.T + 1 }, (_, t) => meridianAt(k, t));
}

/** Signed circular distance in (-W/2, W/2]: positive when `x` is east of `m`. */
export function circ(x: number, m: number, W: number): number {
  let d = (((x - m) % W) + W) % W;
  if (d > W >> 1) d -= W;
  return d;
}

export interface ScheduleReport {
  schedule: ScheduleId;
  keys: ReturnType<typeof keysOf>;
  /** Steps of the path; the path itself is stored so a reader can verify it. */
  pathHash: string;
  firstMoveStep: number | null;
  /** Realised turning step (the first step after which the meridian moves west), or null. */
  turnStep: number | null;
  /** Unwrapped east travel in cells over the first leg and mean speed in cells per 1000 steps (integer). */
  eastLegSteps: number;
  westLegSteps: number;
  meanSpeedPer1000: number;
  /** Realised mean speed over the drifter's 1/64 cell per step, in per-mille. */
  speedRatioPermille: number;
}

/** Unwrapped sun displacement between steps (positive east), assuming under half a tile per call. */
export const sunDelta = (path: readonly number[], a: number, b: number, W: number): number => {
  let d = 0;
  for (let t = a; t < b; t++) d += circ(path[t + 1], path[t], W);
  return d;
};

export function reportOf(schedule: ScheduleId, path: readonly number[], hash: string, p: Protocol = PROTOCOL): ScheduleReport {
  let first: number | null = null, turn: number | null = null, east = 0, west = 0, total = 0;
  for (let t = 0; t < path.length - 1; t++) {
    const d = circ(path[t + 1], path[t], p.W);
    total += Math.abs(d);
    if (d !== 0 && first === null) first = t;
    if (d < 0 && turn === null) turn = t;
  }
  const steps = path.length - 1;
  // Leg durations in steps: east from the first move to the turn (or the end), west from the turn to the end.
  east = first === null ? 0 : (turn ?? steps) - first;
  west = turn === null ? 0 : steps - turn;
  const perStep1000 = Math.floor((total * 1000) / steps);
  return { schedule, keys: keysOf(schedule, p), pathHash: hash, firstMoveStep: first, turnStep: turn, eastLegSteps: east, westLegSteps: west, meanSpeedPer1000: perStep1000, speedRatioPermille: Math.floor((perStep1000 * 64 * 1000) / 1000) };
}

/** Start of the scored window: the warm-up end, or for the reversed schedule the realised turning step. */
export const scoredFrom = (schedule: ScheduleId, path: readonly number[], p: Protocol = PROTOCOL): number => {
  if (schedule === "reversed") {
    // The post-turn window starts at the realised turn step itself (observe.ts takes an extra census there), not at the next census.
    for (let t = 0; t < path.length - 1; t++) if (circ(path[t + 1], path[t], p.W) < 0) return t;
  }
  return p.T0;
};
