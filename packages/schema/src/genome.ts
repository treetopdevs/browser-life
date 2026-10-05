import { B1_OFF, B2_OFF, G, GENOME_CHANNELS, IN, NN_BYTES, NN_H, NN_O, OUT, W1_OFF, W2_OFF } from "./layout.ts";
import { draw, lowbias32 } from "./int.ts";

/** A decoded genome: Lenia growth parameters plus int8 controller weights. */
export interface Genome {
  mu: number; // /1024
  sigma: number; // /1024
  motGain: number; // 0..255
  weights: Int8Array; // NN_BYTES
  /**
   * Kernel ring weights as signed offsets from the neutral (64, 64, 0), bytes 1..3 of PARAM1
   * (WorldConfig.shapeReach). Absent when all three are zero, which is every RULE_VERSION 1 genome.
   */
  rings?: [number, number, number];
}

/** A genome's kernel ring offsets when any is non-zero, else undefined: absence and (0, 0, 0) are one genome. */
export function ringsOf(g: { rings?: ArrayLike<number> }): [number, number, number] | undefined {
  const r = g.rings;
  return r && (r[0] || r[1] || r[2]) ? [r[0], r[1], r[2]] : undefined;
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
  if (g.rings) {
    for (let k = 0; k < 3; k++) {
      const v = g.rings[k];
      if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`encodeGenome: ring ${k} is ${v}; expected an int8`);
      out[G.PARAM1] = (out[G.PARAM1] | ((v & 0xff) << (8 * (k + 1)))) >>> 0;
    }
  }
  // Index access works for an Int8Array, a plain array, and the {"0": …} object JSON.stringify
  // makes of an Int8Array; anything missing or outside int8 is refused rather than encoded as 0.
  const w = g.weights as unknown as ArrayLike<number>;
  for (let b = 0; b < NN_BYTES; b++) {
    const v = w[b];
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`encodeGenome: weight ${b} is ${v}; expected an int8 (did a genome lose its Int8Array in a JSON round-trip?)`);
    out[G.W0 + (b >> 2)] |= (v & 0xff) << ((b & 3) * 8);
  }
  return out;
}

export function decodeGenome(words: ArrayLike<number>): Genome {
  const weights = new Int8Array(NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) {
    const byte = (words[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff;
    weights[b] = byte > 127 ? byte - 256 : byte;
  }
  const g: Genome = {
    mu: words[G.PARAM0] & 0xffff,
    sigma: words[G.PARAM0] >>> 16,
    motGain: words[G.PARAM1] & 0xff,
    weights,
  };
  if (words[G.PARAM1] >>> 8 !== 0) {
    const s8 = (b: number) => ((b & 0xff) > 127 ? (b & 0xff) - 256 : b & 0xff);
    g.rings = [s8(words[G.PARAM1] >>> 8), s8(words[G.PARAM1] >>> 16), s8(words[G.PARAM1] >>> 24)];
  }
  return g;
}

/** Genome words from PARAM0 onwards as hex, 8 digits each (the runner's `genomes.tsv` column). */
export function genomeHex(g: Genome): string {
  return Array.from(encodeGenome(g, 0, 0).subarray(G.PARAM0), (x) => x.toString(16).padStart(8, "0")).join("");
}

/** Inverse of `genomeHex`; throws unless `hex` holds exactly the words from PARAM0 onwards. */
export function genomeFromHex(hex: string): Genome {
  if (!new RegExp(`^[0-9a-f]{${8 * (GENOME_CHANNELS - G.PARAM0)}}$`).test(hex)) throw new Error(`genome hex must be ${8 * (GENOME_CHANNELS - G.PARAM0)} lowercase hex digits`);
  const w = new Uint32Array(GENOME_CHANNELS);
  for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) w[g] = parseInt(hex.slice((g - G.PARAM0) * 8, (g - G.PARAM0 + 1) * 8), 16) >>> 0;
  return decodeGenome(w);
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
