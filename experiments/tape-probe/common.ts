// Shared measurement for the tape-vs-weights mutation probe (exploratory first rung, no gate).
//
// Every controller representation is run through the SAME probe: the 26,244-point sensor grid of
// @bl/lineage (PROBE_AXES, last axis fastest), 10 sensors in, 8 actuators out, integer outputs in
// [-127,127] with catalytic channels 0..5 rectified (negative -> 0) exactly as probeGenome does.
//
// Integer-bounds argument: every register/output is in [-127,127], products |a*b| <= 16129 < 2^14,
// sums <= 254. Per-mutant accumulators: sumAbsDelta <= 26244*8*254 < 2^26; per-cell sums
// <= 8000*2^26 < 2^39, safe in a double (asserted with Number.isSafeInteger). All randomness is
// counter-based (lowbias32/draw keyed on salt, panel, parent, mutant, attempt); no Math.random, no
// Date. Floats appear only inside wilson() at the reporting boundary and results are stored as
// integer permille plus raw counts.
import { NN_H, NN_I, NN_O, clampi, divi, draw, lowbias32 } from "@bl/schema";
import { PROBE_AXES, GRID_POINTS } from "@bl/lineage";
import { controllerForward } from "@bl/sim-ref";

export const SALT = 0x7a9e0b11;
export const NO = NN_O; // 8 actuator channels
export const NI = NN_I; // 10 sensors
export const NCAT = 6; // channels 0..5 are catalytic (rectified)
export { GRID_POINTS };

/** The probe grid, same last-axis-fastest recursion as @bl/lineage's (unexported) grid(). */
export const GRID: Int32Array[] = (() => {
  const out: Int32Array[] = [];
  const x = new Int32Array(NI);
  const rec = (d: number): void => {
    if (d === NI) { out.push(x.slice()); return; }
    for (const v of PROBE_AXES[d]) { x[d] = v; rec(d + 1); }
  };
  rec(0);
  if (out.length !== GRID_POINTS) throw new Error("grid size mismatch");
  return out;
})();

export const rectify = (k: number, v: number): number => (k < NCAT && v < 0 ? 0 : v);

/** Weight controller over the grid: int8 weights (160) -> Int16Array(GRID*8), probeGenome layout. */
export function nnOuts(weights: Int8Array): Int16Array {
  const h = new Int32Array(NN_H), o = new Int32Array(NN_O);
  const outs = new Int16Array(GRID.length * NO);
  for (let p = 0; p < GRID.length; p++) {
    controllerForward(weights, GRID[p], h, o);
    for (let k = 0; k < NO; k++) outs[p * NO + k] = rectify(k, o[k]);
  }
  return outs;
}

/** Two independent 32-bit FNV-1a style hashes over the Int16 values, joined: exact-distinct counts. */
export function hashOuts(outs: Int16Array): string {
  let a = 0x811c9dc5 | 0, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < outs.length; i++) {
    const v = outs[i] & 0xffff;
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ ((v << 3) ^ (v >>> 5) ^ i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** At least 2 of the 8 channels vary by >= 16 over the grid: the controller does something. */
export function functional(outs: Int16Array): boolean {
  let n = 0;
  for (let k = 0; k < NO; k++) {
    let lo = 32767, hi = -32768;
    for (let p = 0; p < GRID.length; p++) { const v = outs[p * NO + k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo >= 16) n++;
  }
  return n >= 2;
}

/** Integer grid mean (floor of sum/GRID_POINTS) per channel. */
export function channelMeans(outs: Int16Array): number[] {
  const s = new Array<number>(NO).fill(0);
  for (let p = 0; p < GRID.length; p++) for (let k = 0; k < NO; k++) s[k] += outs[p * NO + k];
  return s.map((v) => Math.floor(v / GRID_POINTS));
}

// ---- counter-based randomness ----
export const keyedWith = (salt: number, ...parts: number[]): number => {
  let h = salt >>> 0;
  for (const p of parts) h = lowbias32((h ^ lowbias32(p >>> 0)) >>> 0);
  return h >>> 0;
};
export const keyed = (...parts: number[]): number => keyedWith(SALT, ...parts);
export const rd = (base: number, k: number, mod: number): number => draw(base, k) % mod;
export const strId = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };

// ---- reporting boundary (floats allowed here only) ----
/** Wilson 95% interval as integer permille: floor lower, ceil upper. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1000];
  const z = 1.96, p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den;
  const w = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, Math.floor(1000 * (c - w) + 1e-9)), Math.min(1000, Math.ceil(1000 * (c + w) - 1e-9))];
}

export const permille = (k: number, n: number): number => (n === 0 ? 0 : Math.floor((1000 * k) / n));

/** Parent-resampled percentile interval (2.5/97.5) of sum(num)/sum(den), integer permille. */
export function parentBootstrap(num: number[], den: number[], tag: number, resamples = 1000): [number, number] {
  const P = num.length;
  if (P === 0) return [0, 0];
  const base = keyed(0xb007, tag);
  const vals: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let a = 0, b = 0;
    for (let j = 0; j < P; j++) { const i = rd(base, r * P + j, P); a += num[i]; b += den[i]; }
    vals.push(permille(a, b));
  }
  vals.sort((x, y) => x - y);
  return [vals[Math.floor(0.025 * resamples)], vals[Math.floor(0.975 * resamples)]];
}

export function assertIntegers(o: unknown, path = "$"): void {
  if (typeof o === "number") { if (!Number.isSafeInteger(o)) throw new Error(`non-integer at ${path}: ${o}`); return; }
  if (Array.isArray(o)) { o.forEach((v, i) => assertIntegers(v, `${path}[${i}]`)); return; }
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) assertIntegers(v, `${path}.${k}`);
}

export const sat = (v: number): number => clampi(v, -127, 127);
export { divi };
