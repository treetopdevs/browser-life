// Slab (3D) layout constants, rung 1b. Constants only: the 2D layout in layout.ts is untouched.
// The slab controller is 11 inputs (adds SGZ) -> 8 hidden -> 9 outputs (adds MZ), so every row
// after W1 row 9 moves; genome3.ts remaps by (i, j) and (j, k), never by byte offset.
import { G, IN, OUT, RND } from "./layout.ts";

export const NN_I3 = 11;
export const NN_H3 = 8;
export const NN_O3 = 9;
export const W1_OFF3 = 0;
export const B1_OFF3 = W1_OFF3 + NN_I3 * NN_H3; // 88
export const W2_OFF3 = B1_OFF3 + NN_H3; // 96
export const B2_OFF3 = W2_OFF3 + NN_H3 * NN_O3; // 168
export const NN_BYTES3 = B2_OFF3 + NN_O3; // 177
/** Packed words: 177 bytes round up to 45 words, leaving NN_PAD3 = 3 zero padding bytes. */
export const NN_WORDS3 = Math.ceil(NN_BYTES3 / 4); // 45
export const NN_PAD3 = NN_WORDS3 * 4 - NN_BYTES3; // 3
export const GENOME_CHANNELS3 = G.W0 + NN_WORDS3; // 49

export const IN3 = { ...IN, SGZ: 10 } as const;
export const OUT3 = { ...OUT, MZ: 8 } as const;
/** Genome header words are the same in the slab. */
export const G3 = { ...G } as const;

/**
 * Random-draw purposes for the slab: the 2D table with diffusion widened to six directions
 * (DIFF + dir * 3 + species uses slots 1..18), so DIFF_ROT (19) is the one slot the 2D table
 * leaves free below PHOTO (20). Slots 20 and up are the 2D ones.
 */
export const RND3 = { ...RND, DIFF: 1, DIFF_ROT: 19 } as const;

/** CH.MOT of a slab cell at rest: three biased bytes (m + 128), x in the low byte. */
export const MOT_ZERO3 = 0x808080;

const s8 = (v: number, what: string) => {
  if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`packMot3: ${what} is ${v}; expected an int in -128..127`);
  return v + 128;
};

export function packMot3(mx: number, my: number, mz: number): number {
  return (s8(mx, "mx") | (s8(my, "my") << 8) | (s8(mz, "mz") << 16)) >>> 0;
}

export function unpackMot3(mot: number): [number, number, number] {
  return [(mot & 0xff) - 128, ((mot >>> 8) & 0xff) - 128, ((mot >>> 16) & 0xff) - 128];
}
