// Engineered controllers with known history (I05 evidence fixtures), built by exact algebra, never searched.
// Each fools one naive metric: bytes changed, weight-space distance, edits applied, or sensor labels.
import { B1_OFF, G, IN, NN_BYTES, NN_H, NN_I, NN_O, OUT, decodeGenome, encodeGenome, generalistGenome, w1, w2, type Genome } from "@bl/schema";
import { slotValue } from "../genotype.ts";

export const weightsOf = (words: Uint32Array): Int8Array => { const b = new Int8Array(NN_BYTES); for (let s = 0; s < NN_BYTES; s++) b[s] = slotValue(words, s); return b; };

/** The words with the controller bytes replaced; everything else (mu, sigma, gain, lineage words) is kept. */
export function withWeights(words: Uint32Array, wb: Int8Array): Uint32Array {
  const g: Genome = decodeGenome(words);
  g.weights = wb.slice();
  return encodeGenome(g, words[G.LIN_HI], words[G.LIN_LO]);
}

export const generalistWords = (mu: number, sigma: number): Uint32Array => encodeGenome(generalistGenome(mu, sigma), 0, 0);

/** Swap hidden units a and b: columns of W1, entries of b1, rows of W2. The function is unchanged on every input. */
export function permuteHidden(words: Uint32Array, a: number, b: number): Uint32Array {
  const wb = weightsOf(words), out = wb.slice();
  for (let i = 0; i < NN_I; i++) { out[w1(i, a)] = wb[w1(i, b)]; out[w1(i, b)] = wb[w1(i, a)]; }
  out[B1_OFF + a] = wb[B1_OFF + b]; out[B1_OFF + b] = wb[B1_OFF + a];
  for (let k = 0; k < NN_O; k++) { out[w2(a, k)] = wb[w2(b, k)]; out[w2(b, k)] = wb[w2(a, k)]; }
  return withWeights(words, out);
}

/** Swap the W1 rows of sensors p and q: a different controller (not an ecological intervention), used as a negative fixture. */
export function permuteSensors(words: Uint32Array, p: number, q: number): Uint32Array {
  const wb = weightsOf(words), out = wb.slice();
  for (let j = 0; j < NN_H; j++) { out[w1(p, j)] = wb[w1(q, j)]; out[w1(q, j)] = wb[w1(p, j)]; }
  return withWeights(words, out);
}

/** The hidden pair (a < b) whose swap changes the most bytes (ties: lowest a, then b). Null when no swap changes anything. */
export function widestPermutation(words: Uint32Array): [number, number] | null {
  let best: [number, number] | null = null, bestN = 0;
  for (let a = 0; a < NN_H; a++) for (let b = a + 1; b < NN_H; b++) {
    const n = bytesChanged(words, permuteHidden(words, a, b));
    if (n > bestN) { bestN = n; best = [a, b]; }
  }
  return best;
}

export const deadHidden = (words: Uint32Array): number[] => {
  const wb = weightsOf(words);
  return Array.from({ length: NN_H }, (_, j) => j).filter((j) => Array.from({ length: NN_O }, (_, k) => wb[w2(j, k)]).every((v) => v === 0));
};

/** Zero a controller slot (an ablation, a genuine function change when the slot matters). */
export function zeroSlot(words: Uint32Array, slot: number): Uint32Array { const wb = weightsOf(words); wb[slot] = 0; return withWeights(words, wb); }

/** Naive metrics the fixtures are built to fool. */
export function bytesChanged(a: Uint32Array, b: Uint32Array): number { let n = 0; for (let s = 0; s < NN_BYTES; s++) if (slotValue(a, s) !== slotValue(b, s)) n++; return n; }
export function weightL1(a: Uint32Array, b: Uint32Array): number { let n = 0; for (let s = 0; s < NN_BYTES; s++) n += Math.abs(slotValue(a, s) - slotValue(b, s)); return n; }

/** Documented roles of the hand-built generalist's weights (packages/schema/src/genome.ts). */
export const GENERALIST_ROLES = {
  /** h1 follows light; this weight carries it to photosynthesis. */
  photoFromH1: w2(1, OUT.PHOTO),
  lightToH1: w1(IN.LIGHT, 1),
  epbToH0: w1(IN.EPB, 0),
} as const;
