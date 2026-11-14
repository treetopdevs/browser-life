// The slab genome (rung 1b): 11 -> 8 -> 9 controller, 177 int8 weights packed into 45 words, 49 words per cell.
// Header words (LIN_HI, LIN_LO, PARAM0, PARAM1) are the 2D ones; PARAM1 bytes 1..3 must be zero (no rings, no genes).
import { G } from "./layout.ts";
import { B1_OFF3, B2_OFF3, GENOME_CHANNELS3, IN3, NN_BYTES3, NN_H3, NN_I3, NN_O3, NN_PAD3, OUT3, W1_OFF3, W2_OFF3 } from "./layout3d.ts";
import { NN_H, NN_I, NN_O } from "./layout.ts";
import { ringsOf, w1, w2, b1, b2, generalistGenome, type Genome } from "./genome.ts";

/** A decoded slab genome: Lenia growth parameters plus int8 controller weights. */
export interface Genome3 {
  mu: number; // /1024
  sigma: number; // /1024
  motGain: number; // 0..255
  weights: Int8Array; // NN_BYTES3
}

export const w1At3 = (i: number, j: number) => W1_OFF3 + i * NN_H3 + j;
export const b1At3 = (j: number) => B1_OFF3 + j;
export const w2At3 = (j: number, k: number) => W2_OFF3 + j * NN_O3 + k;
export const b2At3 = (k: number) => B2_OFF3 + k;

export function emptyGenome3(mu: number, sigma: number): Genome3 {
  return { mu, sigma, motGain: 0, weights: new Int8Array(NN_BYTES3) };
}

/** Pack into GENOME_CHANNELS3 words (lineage words left to the caller). */
export function encodeGenome3(g: Genome3, linHi: number, linLo: number): Uint32Array {
  const out = new Uint32Array(GENOME_CHANNELS3);
  out[G.LIN_HI] = linHi >>> 0;
  out[G.LIN_LO] = linLo >>> 0;
  out[G.PARAM0] = ((g.mu & 0xffff) | ((g.sigma & 0xffff) << 16)) >>> 0;
  out[G.PARAM1] = g.motGain & 0xff;
  const w = g.weights as unknown as ArrayLike<number>;
  if (w.length !== NN_BYTES3) throw new Error(`encodeGenome3: ${w.length} weights; expected ${NN_BYTES3}`);
  for (let b = 0; b < NN_BYTES3; b++) {
    const v = w[b];
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`encodeGenome3: weight ${b} is ${v}; expected an int8`);
    out[G.W0 + (b >> 2)] |= (v & 0xff) << ((b & 3) * 8);
  }
  return out;
}

/** Inverse of `encodeGenome3`; throws when PARAM1 bytes 1..3 or the padding bytes are set. */
export function decodeGenome3(words: ArrayLike<number>): Genome3 {
  if (words.length !== GENOME_CHANNELS3) throw new Error(`decodeGenome3: ${words.length} words; expected ${GENOME_CHANNELS3}`);
  if (words[G.PARAM1] >>> 8 !== 0) throw new Error("decodeGenome3: PARAM1 bytes 1..3 must be zero in a slab (no rings, no genes)");
  const weights = new Int8Array(NN_BYTES3);
  for (let b = 0; b < NN_BYTES3; b++) {
    const byte = (words[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff;
    weights[b] = byte > 127 ? byte - 256 : byte;
  }
  for (let b = NN_BYTES3; b < NN_BYTES3 + NN_PAD3; b++)
    if (((words[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff) !== 0) throw new Error("decodeGenome3: padding bytes must be zero");
  return { mu: words[G.PARAM0] & 0xffff, sigma: words[G.PARAM0] >>> 16, motGain: words[G.PARAM1] & 0xff, weights };
}

const HEX_DIGITS3 = 8 * (GENOME_CHANNELS3 - G.PARAM0); // 376

/** Genome words from PARAM0 onwards as hex, 8 digits each. */
export function genomeHex3(g: Genome3): string {
  return Array.from(encodeGenome3(g, 0, 0).subarray(G.PARAM0), (x) => x.toString(16).padStart(8, "0")).join("");
}

/** Inverse of `genomeHex3`; throws unless `hex` holds exactly the words from PARAM0 onwards. */
export function genomeFromHex3(hex: string): Genome3 {
  if (!new RegExp(`^[0-9a-f]{${HEX_DIGITS3}}$`).test(hex)) throw new Error(`slab genome hex must be ${HEX_DIGITS3} lowercase hex digits`);
  const w = new Uint32Array(GENOME_CHANNELS3);
  for (let g = G.PARAM0; g < GENOME_CHANNELS3; g++) w[g] = parseInt(hex.slice((g - G.PARAM0) * 8, (g - G.PARAM0 + 1) * 8), 16) >>> 0;
  return decodeGenome3(w);
}

/**
 * Lifts a 2D genome into the slab layout. W1 moves by (input, hidden) and W2 by (hidden, output) because the
 * strides change (W1 rows 0..9 happen to keep their offsets, nothing after them does); B1, B2 and the header
 * are copied; the SGZ row, the MZ column and the MZ bias are zero, so the lift's first eight outputs equal the
 * 2D net's and MZ is 0. A genome with kernel rings or genes cannot be lifted (the slab has neither).
 */
export function liftGenome(g: Genome): Genome3 {
  if (ringsOf(g) !== undefined) throw new Error("liftGenome: a genome with kernel rings (shapeReach) has no slab form");
  if (g.genes) throw new Error("liftGenome: a genome with gene bits has no slab form");
  const out = emptyGenome3(g.mu, g.sigma);
  out.motGain = g.motGain;
  for (let i = 0; i < NN_I; i++) for (let j = 0; j < NN_H; j++) out.weights[w1At3(i, j)] = g.weights[w1(i, j)];
  for (let j = 0; j < NN_H; j++) out.weights[b1At3(j)] = g.weights[b1(j)];
  for (let j = 0; j < NN_H; j++) for (let k = 0; k < NN_O; k++) out.weights[w2At3(j, k)] = g.weights[w2(j, k)];
  for (let k = 0; k < NN_O; k++) out.weights[b2At3(k)] = g.weights[b2(k)];
  return out;
}

/** The inverse of `liftGenome` on its image: drops the SGZ row, the MZ column and the MZ bias. */
export function projectGenome(g: Genome3): Genome {
  const out: Genome = { mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: new Int8Array(NN_I * NN_H + NN_H + NN_H * NN_O + NN_O) };
  for (let i = 0; i < NN_I; i++) for (let j = 0; j < NN_H; j++) out.weights[w1(i, j)] = g.weights[w1At3(i, j)];
  for (let j = 0; j < NN_H; j++) out.weights[b1(j)] = g.weights[b1At3(j)];
  for (let j = 0; j < NN_H; j++) for (let k = 0; k < NN_O; k++) out.weights[w2(j, k)] = g.weights[w2At3(j, k)];
  for (let k = 0; k < NN_O; k++) out.weights[b2(k)] = g.weights[b2At3(k)];
  return out;
}

/** The hand-built generalist in slab layout: the lift of the 2D generalist, shared by the neutral and evolving arms. */
export function generalistGenome3(mu: number, sigma: number): Genome3 {
  return liftGenome(generalistGenome(mu, sigma));
}

// Referenced so the layout constants a reader looks for here stay one import away.
export const SLAB_CONTROLLER = { inputs: NN_I3, hidden: NN_H3, outputs: NN_O3, sgz: IN3.SGZ, mz: OUT3.MZ } as const;
