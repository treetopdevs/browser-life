// The fixed evidence envelope, version 1 (PLAN.md, sections 1-2). One envelope per case: the world's config, a census series and K
// registered frame samples, all at steps <= the fork step C, the menu of allowed intervention operations, and exactly one frozen
// task. It holds no post-C data and no outcome. Identity is the SHA-256 of its canonical JSON (without the `envelopeHash` field).
import { cellCount, worldW, CH, type WorldConfig, type WorldState } from "@bl/schema";
import { canonical, sha256Text } from "../propose.ts";
import { PRIMARY_READOUT, type ReadoutId } from "./readouts.ts";

export const ENVELOPE_VERSION = 1;
export const PREDICTION_VERSION = 1;
export const CLASSES = ["up", "down", "none"] as const;
export type Direction3 = (typeof CLASSES)[number];
export type OpKind = "lesion" | "feed" | "drain" | "none";

/** One operation. A drain's `amount` is positive (nutrient taken per cell); the scheduled feed carries it negated. A sham has no other key. */
export interface TaskOp {
  kind: OpKind;
  x?: number;
  y?: number;
  r?: number;
  amount?: number;
}
export interface Task {
  subject: "world";
  op: TaskOp;
  /** The operation lands at step forkStep + delta (delta >= 1: strictly after the fork, as tools/lib/propose.ts requires). */
  delta: number;
  readout: ReadoutId;
  forkStep: number;
  /** The readout is read at forkStep + horizon. */
  horizon: number;
}
export interface MenuEntry {
  kind: OpKind;
  /** Radius bounds (inclusive); radius 0 is not offered (a radius-0 lesion still destroys its centre cell, so it is no sham). */
  rMin?: number;
  rMax?: number;
  amountMin?: number;
  amountMax?: number;
}
export interface Menu {
  ops: MenuEntry[];
  deltaMin: number;
  deltaMax: number;
}
export interface CensusPoint {
  step: number;
  livingCells: number;
  freeNutrient: number;
  mass: number;
}
/** A registered frame sample: the world's B+P mass summed over `side` x `side` blocks, row-major (a copy, never an alias of a sim buffer). */
export interface Frame {
  step: number;
  side: number;
  mass: number[];
}
export interface PredictionEnvelope {
  version: number;
  caseId: string;
  historyId: string;
  /** All windows and seed variants of one source history share this id, and so share a split. */
  familyId: string;
  ruleVersion: number;
  config: WorldConfig;
  census: CensusPoint[];
  frames: Frame[];
  menu: Menu;
  task: Task;
  envelopeHash: string;
}

export const FRAME_SIDE = 8;

export function standardMenu(cfg: WorldConfig, deltaMax: number, amountMax: number, rMax: number): Menu {
  void cfg;
  return {
    ops: [
      { kind: "lesion", rMin: 1, rMax },
      { kind: "feed", rMin: 1, rMax, amountMin: 1, amountMax },
      { kind: "drain", rMin: 1, rMax, amountMin: 1, amountMax },
      { kind: "none" },
    ],
    deltaMin: 1,
    deltaMax,
  };
}

export function censusPoint(s: WorldState, living: number, free: number, mass: number): CensusPoint {
  return { step: s.step, livingCells: living, freeNutrient: free, mass };
}

/** A frame sample copied out of a state: B+P mass per block. */
export function frameOf(s: WorldState, side = FRAME_SIDE): Frame {
  const n = cellCount(s.cfg);
  const W = worldW(s.cfg);
  const H = n / W;
  const bw = Math.floor(W / side), bh = Math.floor(H / side);
  const mass = new Array<number>(side * side).fill(0);
  for (let y = 0; y < bh * side; y++) {
    for (let x = 0; x < bw * side; x++) {
      const i = y * W + x;
      mass[Math.floor(y / bh) * side + Math.floor(x / bw)] += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
    }
  }
  return { step: s.step, side, mass };
}

export function envelopeBody(e: PredictionEnvelope): Omit<PredictionEnvelope, "envelopeHash"> {
  const { envelopeHash: _h, ...rest } = e;
  void _h;
  return rest;
}
export const hashEnvelopeBody = (b: Omit<PredictionEnvelope, "envelopeHash">): string => sha256Text(canonical(b));

export function sealEnvelope(b: Omit<PredictionEnvelope, "envelopeHash">): PredictionEnvelope {
  assertNoPostFork(b);
  return { ...b, envelopeHash: hashEnvelopeBody(b) };
}

/** Throws unless every census point and frame is at a step <= the fork step. */
export function assertNoPostFork(b: Omit<PredictionEnvelope, "envelopeHash">): void {
  const C = b.task.forkStep;
  const max = Math.max(-1, ...b.census.map((c) => c.step), ...b.frames.map((f) => f.step));
  if (max > C) throw new Error(`envelope ${b.caseId} holds data at step ${max}, after its fork step ${C}`);
}

export function envelopeIntact(e: PredictionEnvelope): boolean {
  return e.envelopeHash === hashEnvelopeBody(envelopeBody(e));
}

export const taskKey = (t: Task): string => canonical(t);
export const PRIMARY = PRIMARY_READOUT;
