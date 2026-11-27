// Matching: find tapes (TAPE-R) that approximate a weight controller's grid behaviour, by a capped
// (1+1) hill climb with plateau moves. A function-on-grid match only; says nothing off-grid.
// Success rule (declared in advance): full-grid mean |error| per output value <= 6 AND at most half the
// all-zero tape's error AND functional(tape).
import { GRID, GRID_POINTS, NO, functional, keyedWith, rd, rectify, SALT } from "./common.ts";
import { N_REGS, byteResample, instrResample, randomTape, runTape, tapeOuts } from "./tape.ts";

export const MATCH = { sub: 1024, restarts: 4, evals: 30000, maxMeanErr: 6 } as const;

/** Fixed stratified subsample of the grid: floor(i*G/1024) + jitter within the stratum (counter draw). */
export function sampleIdx(n: number = MATCH.sub, salt: number = SALT): number[] {
  const out: number[] = [];
  const w = Math.floor(GRID_POINTS / n);
  const base = keyedWith(salt, 0x5a3b1e);
  for (let i = 0; i < n; i++) out.push(Math.min(GRID_POINTS - 1, Math.floor((i * GRID_POINTS) / n) + rd(base, i, w)));
  return out;
}

export function subOuts(prog: Uint8Array, idx: number[], regs = new Int32Array(N_REGS), o = new Int32Array(NO)): Int16Array {
  const out = new Int16Array(idx.length * NO);
  for (let j = 0; j < idx.length; j++) {
    runTape(prog, GRID[idx[j]], regs, o);
    for (let k = 0; k < NO; k++) out[j * NO + k] = rectify(k, o[k]);
  }
  return out;
}
export const sumAbs = (a: Int16Array, b: Int16Array): number => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; };

export interface HillResult { tape: Uint8Array; subError: number; evals: number }
export function hillClimb(targetSub: Int16Array, idx: number[], base: number, restarts: number = MATCH.restarts, evals: number = MATCH.evals): HillResult {
  const regs = new Int32Array(N_REGS), o = new Int32Array(NO);
  let best: HillResult | null = null;
  for (let r = 0; r < restarts; r++) {
    const rb = keyedWith(base, r);
    let cur = randomTape(keyedWith(rb, 0));
    let err = sumAbs(subOuts(cur, idx, regs, o), targetSub);
    for (let e = 0; e < evals; e++) {
      const sub = keyedWith(rb, 1, e);
      const cand = rd(sub, 7, 2) === 0 ? byteResample(cur, sub) : instrResample(cur, sub);
      const ce = sumAbs(subOuts(cand, idx, regs, o), targetSub);
      if (ce <= err) { cur = cand; err = ce; }
    }
    if (!best || err < best.subError) best = { tape: cur, subError: err, evals: restarts * evals };
  }
  return best!;
}

export interface MatchRecord {
  cluster: number; subError: number; fullErrorMilli: number; zeroErrorMilli: number; functionalTape: boolean; matched: boolean; tapeHex: string;
}
/** Full-grid verdict for a found tape against target outs (per-value mean error reported in milli-units). */
export function verdict(cluster: number, tape: Uint8Array, target: Int16Array, subError: number): MatchRecord {
  const outs = tapeOuts(tape);
  const full = sumAbs(outs, target), zero = sumAbs(new Int16Array(target.length), target);
  const vals = GRID_POINTS * NO;
  const fn = functional(outs);
  const matched = full <= MATCH.maxMeanErr * vals && 2 * full <= zero && fn;
  return {
    cluster, subError, fullErrorMilli: Math.floor((1000 * full) / vals), zeroErrorMilli: Math.floor((1000 * zero) / vals),
    functionalTape: fn, matched, tapeHex: Array.from(tape, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}
