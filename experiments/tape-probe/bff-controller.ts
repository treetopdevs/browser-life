// Secondary robustness arm: a BFF-style tape run for fixed fuel on the sensor vector (tools/soup/bff.ts).
// Genome = 100 bytes at tape[0..100). Per call, a fresh 128-byte tape: program, sensors at tape[100..110)
// as byte = x+128 (grid range -64..127 -> 64..255), outputs at tape[110..118) initialised to 128 and read
// as o = clamp(byte-128,-127,127), tape[118..128) = 0. Language "noheads", fuel 1024 steps; on fuel
// exhaustion outputs are read as they stand. Program bytes are restored per call: no persistent memory.
// 246 of 256 byte values are no-ops, so uniform random tapes are mostly output-inert for an encoding reason.
import { evaluate } from "../../tools/soup/bff.ts";
import { GRID, NO, rd, rectify, sat } from "./common.ts";

export const BFF_PROG = 100;
export const BFF_FUEL = 1024;
const CHARS = "<>{}+-.,[]";
export const BFF_CODES = Array.from(CHARS, (c) => c.charCodeAt(0));

export function bffOuts(prog: Uint8Array): Int16Array {
  const outs = new Int16Array(GRID.length * NO);
  const tape = new Uint8Array(128);
  for (let p = 0; p < GRID.length; p++) {
    tape.fill(0);
    tape.set(prog.subarray(0, BFF_PROG), 0);
    for (let i = 0; i < 10; i++) tape[100 + i] = GRID[p][i] + 128;
    for (let k = 0; k < 8; k++) tape[110 + k] = 128;
    evaluate(tape, "noheads", BFF_FUEL);
    for (let k = 0; k < NO; k++) outs[p * NO + k] = rectify(k, sat(tape[110 + k] - 128));
  }
  return outs;
}

export type BffPrior = "uniform" | "dense";
export function randomBff(base: number, prior: BffPrior): Uint8Array {
  const t = new Uint8Array(BFF_PROG);
  for (let b = 0; b < BFF_PROG; b++) t[b] = prior === "uniform" ? rd(base, b, 256) : BFF_CODES[rd(base, b, BFF_CODES.length)];
  return t;
}
export function bffByteResample(p: Uint8Array, sub: number, prior: BffPrior): Uint8Array {
  const t = p.slice(), pos = rd(sub, 0, BFF_PROG);
  t[pos] = prior === "uniform" ? rd(sub, 1, 256) : BFF_CODES[rd(sub, 1, BFF_CODES.length)];
  return t;
}
