// Actuator-response locality descriptors on the predefined probe grid (PROBE_AXES; no new grid).
// All integers: counts, permille computed from counts, max deltas in output units. The fractional summaries of
// `Probe` (meanOut, regimeEntropy) never enter the payload; `expressionOf` is used only for its class.
import { B1_OFF, B2_OFF, NN_BYTES, NN_H, NN_I, NN_O, W2_OFF } from "@bl/schema";
import { expressionOf, locusOf, slotValue, PROBE_AXES, type Expression, type Mutation, type Probe } from "../genotype.ts";
import type { Edit } from "./neighbourhood.ts";

/** Derived, never hard-coded: 3^8 x 2^2 = 26,244 grid points. */
export const GRID_POINTS: number = PROBE_AXES.reduce((p, a) => p * a.length, 1);
export const OUTPUT_VALUES: number = GRID_POINTS * NN_O;
/** An actuator "moves" when at least this many permille of grid points change in it. */
export const BREADTH_FLOOR_PERMILLE = 10;
/** Participation: an actuator takes part when its largest change reaches this many output units. */
export const PARTICIPATION_DELTA = 4;

const bits = (m: number): number => { let c = 0; for (; m; m &= m - 1) c++; return c; };
export const popcount = bits;

const wbytes = (w: Uint32Array): Int8Array => { const b = new Int8Array(NN_BYTES); for (let s = 0; s < NN_BYTES; s++) b[s] = slotValue(w, s); return b; };

/** Which sensors change the (after - before) response table: for each axis, does the delta differ across that axis's levels? */
export function sensorReachMask(before: Probe, after: Probe): number {
  const strides: number[] = [];
  for (let d = 0; d < NN_I; d++) strides.push(PROBE_AXES.slice(d + 1).reduce((p, a) => p * a.length, 1));
  let mask = 0;
  for (let p = 0; p < GRID_POINTS; p++) {
    for (let d = 0; d < NN_I; d++) {
      if (mask & (1 << d)) continue;
      const level = Math.floor(p / strides[d]) % PROBE_AXES[d].length;
      if (level === 0) continue;
      const q = p - level * strides[d];
      for (let k = 0; k < NN_O; k++) {
        if (after.outs[p * NN_O + k] - before.outs[p * NN_O + k] !== after.outs[q * NN_O + k] - before.outs[q * NN_O + k]) { mask |= 1 << d; break; }
      }
    }
    if (mask === (1 << NN_I) - 1) break;
  }
  return mask;
}

/** Wiring reach of the slots in an edit, on the base genome's nonzero weights. An upper bound on what the probe can show. */
export function structuralReach(base: Uint32Array, slots: number[]): { actuators: number; sensors: number } {
  const w = wbytes(base);
  const w1 = (i: number, j: number) => w[i * NN_H + j], w2 = (j: number, k: number) => w[W2_OFF + j * NN_O + k];
  const sensorsInto = (j: number) => { let m = 0; for (let i = 0; i < NN_I; i++) if (w1(i, j) !== 0) m |= 1 << i; return m; };
  const actuatorsFrom = (j: number) => { let m = 0; for (let k = 0; k < NN_O; k++) if (w2(j, k) !== 0) m |= 1 << k; return m; };
  const sensorsReaching = (k: number) => { let m = 0; for (let j = 0; j < NN_H; j++) if (w2(j, k) !== 0) m |= sensorsInto(j); return m; };
  let act = 0, sen = 0;
  for (const s of slots) {
    if (s < B1_OFF) {
      const i = Math.floor(s / NN_H), j = s % NN_H;
      act |= actuatorsFrom(j);
      sen |= (1 << i) | sensorsInto(j);
    } else if (s < W2_OFF) {
      const j = s - B1_OFF;
      act |= actuatorsFrom(j);
      sen |= sensorsInto(j);
    } else if (s < B2_OFF) {
      const j = Math.floor((s - W2_OFF) / NN_O), k = (s - W2_OFF) % NN_O;
      act |= 1 << k;
      sen |= sensorsInto(j);
    } else if (s < NN_BYTES) act |= 1 << (s - B2_OFF);
  }
  // Rectification and the +-127 clamp make an output depend on every sensor that reaches it through any hidden unit.
  for (let k = 0; k < NN_O; k++) if (act & (1 << k)) sen |= sensorsReaching(k);
  return { actuators: act, sensors: sen };
}

export interface ProbeDiff {
  changed: number[];
  permille: number[];
  maxDelta: number[];
  /** Total changed output values over the whole grid. */
  totalChanged: number;
  breadth: number;
  participation: number;
  sensorReach: number;
  sensorMask: number;
}

/** Integer comparison of two probes on the shared grid. */
export function describeProbes(before: Probe, after: Probe): ProbeDiff {
  const changed = new Array<number>(NN_O).fill(0), maxDelta = new Array<number>(NN_O).fill(0);
  for (let i = 0; i < before.outs.length; i++) {
    const d = Math.abs(after.outs[i] - before.outs[i]);
    if (!d) continue;
    changed[i % NN_O]++;
    if (d > maxDelta[i % NN_O]) maxDelta[i % NN_O] = d;
  }
  const permille = changed.map((c) => Math.floor((1000 * c) / GRID_POINTS));
  let breadth = 0, participation = 0;
  for (let k = 0; k < NN_O; k++) {
    if (permille[k] >= BREADTH_FLOOR_PERMILLE) breadth++;
    if (maxDelta[k] >= PARTICIPATION_DELTA) participation++;
  }
  const totalChanged = changed.reduce((x, y) => x + y, 0);
  const sensorMask = totalChanged > 0 ? sensorReachMask(before, after) : 0;
  return { changed, permille, maxDelta, totalChanged, breadth, participation, sensorReach: bits(sensorMask), sensorMask };
}

export interface Descriptor extends ProbeDiff {
  /** Class only: the fractional summaries of `Probe` and the shares of `expressionOf` stay out of the payload. */
  expression: Expression;
  /** Upper bound by wiring: bitmasks of actuators / sensors reachable through nonzero weights from the edited slots. */
  structActuators: number;
  structSensors: number;
}

export function describeEdit(edit: Pick<Edit, "cls" | "slots">, baseWords: Uint32Array, editedWords: Uint32Array, before: Probe, after: Probe): Descriptor {
  // A synthetic Mutation carries only what `expressionOf` reads (its kind and clamped flag).
  const m = { kind: edit.slots[0].kind, clamped: edit.cls === "unchanged" } as Mutation;
  const { expression } = expressionOf(m, before, after);
  const diff = describeProbes(before, after);
  // Union of the wiring before and after the edit, so an edit that newly connects a path is inside its own bound.
  const slots = edit.slots.map((s) => s.slot);
  const r0 = structuralReach(baseWords, slots), r1 = structuralReach(editedWords, slots);
  return { ...diff, expression, structActuators: r0.actuators | r1.actuators, structSensors: r0.sensors | r1.sensors };
}

/** Sanity check, never a gate: the realised reach is within the wiring bound. */
export const withinStructural = (d: Descriptor): boolean => {
  let realisedAct = 0;
  d.changed.forEach((c, k) => { if (c > 0) realisedAct |= 1 << k; });
  return (realisedAct & ~d.structActuators) === 0 && (d.sensorMask & ~d.structSensors) === 0;
};

export const edgeLabel = (slot: number): string => locusOf(slot).label;
