import { B1_OFF, B2_OFF, G, GENOME_CHANNELS, IN, NN_BYTES, NN_H, NN_O, OUT, W1_OFF, W2_OFF } from "./layout.ts";
import { draw, lowbias32 } from "./int.ts";

/** A decoded genome: Lenia growth parameters plus int8 controller weights. */
export interface Genome {
  mu: number; // /1024
  sigma: number; // /1024
  motGain: number; // 0..255
  weights: Int8Array; // NN_BYTES
}

export function emptyGenome(mu: number, sigma: number): Genome {
  return { mu, sigma, motGain: 0, weights: new Int8Array(NN_BYTES) };
}

export const w1 = (i: number, j: number) => W1_OFF + i * NN_H + j;
export const b1 = (j: number) => B1_OFF + j;
export const w2 = (j: number, k: number) => W2_OFF + j * NN_O + k;
export const b2 = (k: number) => B2_OFF + k;

/** Pack into GENOME_CHANNELS words (lineage words left to the caller). */
export function encodeGenome(g: Genome, linHi: number, linLo: number): Uint32Array {
  const out = new Uint32Array(GENOME_CHANNELS);
  out[G.LIN_HI] = linHi >>> 0;
  out[G.LIN_LO] = linLo >>> 0;
  out[G.PARAM0] = ((g.mu & 0xffff) | ((g.sigma & 0xffff) << 16)) >>> 0;
  out[G.PARAM1] = g.motGain & 0xff;
  const bytes = new Uint8Array(g.weights.buffer, g.weights.byteOffset, NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) out[G.W0 + (b >> 2)] |= bytes[b] << ((b & 3) * 8);
  return out;
}

export function decodeGenome(words: ArrayLike<number>): Genome {
  const weights = new Int8Array(NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) {
    const byte = (words[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff;
    weights[b] = byte > 127 ? byte - 256 : byte;
  }
  return {
    mu: words[G.PARAM0] & 0xffff,
    sigma: words[G.PARAM0] >>> 16,
    motGain: words[G.PARAM1] & 0xff,
    weights,
  };
}

/**
 * Hand-built generalist: photosynthesises in light, respires when its energy
 * per biomass is low, grows when it is high, decomposes a little and builds
 * a thin membrane. Used to test the substrate before any search.
 */
export function generalistGenome(mu: number, sigma: number): Genome {
  const g = emptyGenome(mu, sigma);
  const w = g.weights;
  w[w1(IN.EPB, 0)] = 127; // h0 ~ energy per biomass
  w[w1(IN.LIGHT, 1)] = 127; // h1 ~ light
  w[b1(2)] = 64; // h2 = constant 64
  w[w2(1, OUT.PHOTO)] = 110; // photosynthesis follows light
  w[b2(OUT.RESP)] = 70;
  w[w2(0, OUT.RESP)] = -127; // respire when starved
  w[b2(OUT.GROW)] = -24;
  w[w2(0, OUT.GROW)] = 127; // grow when rich
  w[b2(OUT.DECOMP)] = 40;
  w[b2(OUT.BUILD)] = 12;
  return g;
}

/** Uniformly random weights in [-range, range] from a deterministic stream. */
export function randomGenome(seed: number, mu: number, sigma: number, range = 64): Genome {
  const g = emptyGenome(mu, sigma);
  const base = lowbias32(seed ^ 0x5eed);
  for (let b = 0; b < NN_BYTES; b++) g.weights[b] = (draw(base, b) % (2 * range + 1)) - range;
  g.mu = Math.max(16, mu + (draw(base, 1000) % 81) - 40);
  g.sigma = Math.max(4, sigma + (draw(base, 1001) % 17) - 8);
  return g;
}

export function lineageKey(hi: number, lo: number): string {
  return `${hi >>> 0}:${lo >>> 0}`;
}
