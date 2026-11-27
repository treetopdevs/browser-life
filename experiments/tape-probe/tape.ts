// TAPE-R: a designed (ours) straight-line typed register program used as the "tape" controller.
// 40 instructions x 4 bytes = 160 bytes, the same byte budget as the weight controller's 160 weights.
// Registers: 32 x int32, re-initialised on EVERY call (no persistent memory): R0..R9 = sensors,
// R10..R17 = outputs o0..o7 (init 0), R18..R31 scratch (init 0).
// Instruction bytes [b0,b1,b2,b3]: op=b0&15, d=b1&31, a=b2&31, rb=b3&31, imm=clamp(int8(b3),-127,127), sh=(b3&3)+1.
// Every op saturates to [-127,127], so |a*b| <= 16129 < 2^14, sums <= 254, shifts <= 4; the only
// divisor is the constant 128, so no division by zero exists. Execution is straight-line (pc 0..39 once),
// so fuel is exactly 40 instructions and fuel exhaustion cannot occur.
// Ops: 0 NOP; 1 MOVI; 2 MOV; 3 ADD; 4 SUB; 5 MUL; 6 MAC; 7 MAX; 8 MIN; 9 RELU; 10 NEG; 11 ABS;
// 12 SELPOS (R[d] = R[a]>0 ? R[rb] : R[d]); 13 SHR; 14 MULI; 15 MACI (the NN weight-edge primitive: /128 truncating).
import { divi, clampi } from "@bl/schema";
import { GRID, NO, rd, rectify, sat } from "./common.ts";

export const N_INSTR = 40;
export const N_REGS = 32;
export const TAPE_BYTES = 160;
export const OUT_REG = 10;

export const OP = { NOP: 0, MOVI: 1, MOV: 2, ADD: 3, SUB: 4, MUL: 5, MAC: 6, MAX: 7, MIN: 8, RELU: 9, NEG: 10, ABS: 11, SELPOS: 12, SHR: 13, MULI: 14, MACI: 15 } as const;

const s8 = (b: number): number => (b > 127 ? b - 256 : b);
export const immOf = (b3: number): number => clampi(s8(b3 & 255), -127, 127);

export interface Instr { op: number; d: number; a: number; rb: number; imm: number; sh: number }
export function decode(prog: Uint8Array, i: number): Instr {
  const o = i * 4;
  return { op: prog[o] & 15, d: prog[o + 1] & 31, a: prog[o + 2] & 31, rb: prog[o + 3] & 31, imm: immOf(prog[o + 3]), sh: (prog[o + 3] & 3) + 1 };
}

/** Canonical decode: op plus only the live fields of that op, packed (for the decode-changing flag). */
export function canonical(prog: Uint8Array, i: number): number {
  const { op, d, a, rb, imm, sh } = decode(prog, i);
  let x = 0;
  switch (op) {
    case 0: return 0;
    case 1: x = (d << 16) | (imm + 128); break;
    case 2: case 9: case 10: case 11: x = (d << 16) | (a << 8); break;
    case 13: x = (d << 16) | (a << 8) | sh; break;
    case 14: case 15: x = (d << 16) | (a << 8) | (imm + 128); break;
    default: x = (d << 16) | (a << 8) | rb; // 3..8, 12
  }
  return (op << 24) | x;
}
export function canonicalProgram(prog: Uint8Array): number[] {
  const r: number[] = [];
  for (let i = 0; i < N_INSTR; i++) r.push(canonical(prog, i));
  return r;
}
export function decodeChanging(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < N_INSTR; i++) if (canonical(a, i) !== canonical(b, i)) return true;
  return false;
}

/** Assembler helper for tests: [op, d, a, b3]. */
export const I = (op: number, d: number, a: number, b: number): number[] => [op, d, a, b & 255];
export function asm(...ins: number[][]): Uint8Array {
  const p = new Uint8Array(TAPE_BYTES);
  ins.forEach((x, i) => p.set(x, i * 4));
  return p;
}

/** One call. x: 10 sensors; regs: Int32Array(32) scratch; outs: Int32Array(8) receives R10..R17 (not rectified). */
export function runTape(prog: Uint8Array, x: ArrayLike<number>, regs: Int32Array, outs: Int32Array): void {
  regs.fill(0);
  for (let i = 0; i < 10; i++) regs[i] = x[i];
  for (let pc = 0; pc < N_INSTR; pc++) {
    const o = pc * 4, op = prog[o] & 15;
    if (op === 0) continue;
    const d = prog[o + 1] & 31, a = prog[o + 2] & 31, b3 = prog[o + 3];
    const rb = b3 & 31, imm = immOf(b3);
    switch (op) {
      case 1: regs[d] = imm; break;
      case 2: regs[d] = regs[a]; break;
      case 3: regs[d] = sat(regs[a] + regs[rb]); break;
      case 4: regs[d] = sat(regs[a] - regs[rb]); break;
      case 5: regs[d] = sat(divi(regs[a] * regs[rb], 128)); break;
      case 6: regs[d] = sat(regs[d] + divi(regs[a] * regs[rb], 128)); break;
      case 7: regs[d] = regs[a] > regs[rb] ? regs[a] : regs[rb]; break;
      case 8: regs[d] = regs[a] < regs[rb] ? regs[a] : regs[rb]; break;
      case 9: regs[d] = regs[a] > 0 ? regs[a] : 0; break;
      case 10: regs[d] = sat(-regs[a]); break;
      case 11: regs[d] = sat(regs[a] < 0 ? -regs[a] : regs[a]); break;
      case 12: if (regs[a] > 0) regs[d] = regs[rb]; break;
      case 13: regs[d] = regs[a] >> ((b3 & 3) + 1); break;
      case 14: regs[d] = sat(divi(regs[a] * imm, 128)); break;
      case 15: regs[d] = sat(regs[d] + divi(regs[a] * imm, 128)); break;
    }
  }
  for (let k = 0; k < NO; k++) outs[k] = regs[OUT_REG + k];
}

/** Probe outputs over the grid (rectified), Int16Array(GRID*8) in probeGenome layout. */
export function tapeOuts(prog: Uint8Array): Int16Array {
  const regs = new Int32Array(N_REGS), o = new Int32Array(NO);
  const outs = new Int16Array(GRID.length * NO);
  for (let p = 0; p < GRID.length; p++) {
    runTape(prog, GRID[p], regs, o);
    for (let k = 0; k < NO; k++) outs[p * NO + k] = rectify(k, o[k]);
  }
  return outs;
}

export function nonNopCount(prog: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < N_INSTR; i++) if ((prog[i * 4] & 15) !== 0) n++;
  return n;
}

// ---- random tapes and mutators. `sub` is a per-attempt counter key; callers redraw until the genome differs. ----
export function randomTape(base: number): Uint8Array {
  const t = new Uint8Array(TAPE_BYTES);
  for (let b = 0; b < TAPE_BYTES; b++) t[b] = rd(base, b, 256);
  return t;
}
export function byteResample(p: Uint8Array, sub: number): Uint8Array {
  const t = p.slice(); t[rd(sub, 0, TAPE_BYTES)] = rd(sub, 1, 256); return t;
}
/** byte += delta, mod 256. delta follows the weight operator's draw: uniform over the 49 values [-24,24], with 0 remapped to +1
 *  (so +1 has twice the mass of any other step), as in `mutateInPlace`. The one difference is the edge: weights clamp to +-127,
 *  bytes here wrap mod 256 (an instruction byte has no sign or limit to clamp to). */
export function byteStep(p: Uint8Array, sub: number): Uint8Array {
  const t = p.slice(), pos = rd(sub, 0, TAPE_BYTES);
  let dl = rd(sub, 1, 49) - 24; if (dl === 0) dl = 1;
  t[pos] = (t[pos] + dl) & 255; return t;
}
export function instrResample(p: Uint8Array, sub: number): Uint8Array {
  const t = p.slice(), i = rd(sub, 0, N_INSTR);
  for (let j = 0; j < 4; j++) t[i * 4 + j] = rd(sub, 1 + j, 256);
  return t;
}
export function insertInstr(p: Uint8Array, sub: number): Uint8Array {
  const pos = rd(sub, 0, N_INSTR), t = new Uint8Array(TAPE_BYTES);
  t.set(p.subarray(0, pos * 4), 0);
  for (let j = 0; j < 4; j++) t[pos * 4 + j] = rd(sub, 1 + j, 256);
  t.set(p.subarray(pos * 4, TAPE_BYTES - 4), pos * 4 + 4);
  return t;
}
export function deleteInstr(p: Uint8Array, sub: number): Uint8Array {
  const pos = rd(sub, 0, N_INSTR), t = new Uint8Array(TAPE_BYTES);
  t.set(p.subarray(0, pos * 4), 0);
  t.set(p.subarray(pos * 4 + 4, TAPE_BYTES), pos * 4); // last instruction slot stays 00 00 00 00 (NOP)
  return t;
}
export function dupInstr(p: Uint8Array, sub: number): Uint8Array {
  const pos = rd(sub, 0, N_INSTR), t = new Uint8Array(TAPE_BYTES);
  t.set(p.subarray(0, pos * 4 + 4), 0);
  t.set(p.subarray(pos * 4, pos * 4 + 4), pos * 4 + 4 > TAPE_BYTES - 4 ? TAPE_BYTES - 4 : pos * 4 + 4);
  if (pos < N_INSTR - 1) t.set(p.subarray(pos * 4 + 4, TAPE_BYTES - 4), pos * 4 + 8);
  return t;
}
