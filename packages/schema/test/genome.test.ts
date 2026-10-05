import { describe, expect, it } from "vitest";
import { G, GENOME_CHANNELS, NN_BYTES, encodeGenome, founderGenome, M3_FOUNDERS, type Genome } from "@bl/schema";

/** The encoder as it was before this change, kept to prove the new one is byte-identical on valid input. */
function encodeGenomeRef(g: Genome, linHi: number, linLo: number): Uint32Array {
  const out = new Uint32Array(GENOME_CHANNELS);
  out[G.LIN_HI] = linHi >>> 0;
  out[G.LIN_LO] = linLo >>> 0;
  out[G.PARAM0] = ((g.mu & 0xffff) | ((g.sigma & 0xffff) << 16)) >>> 0;
  out[G.PARAM1] = g.motGain & 0xff;
  const bytes = new Uint8Array(g.weights.buffer, g.weights.byteOffset, NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) out[G.W0 + (b >> 2)] |= bytes[b] << ((b & 3) * 8);
  return out;
}

/** Deterministic pseudo-random genomes covering the full int8 range. */
function genomes(n: number): Genome[] {
  let s = 12345;
  const next = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) & 0xff;
  return Array.from({ length: n }, (_, k) => ({ mu: 16 + k, sigma: 2 + k, motGain: k % 256, weights: Int8Array.from({ length: NN_BYTES }, () => (next() << 24) >> 24) }));
}

describe("encodeGenome", () => {
  it("is byte-identical to the previous encoder on valid Int8Array genomes", () => {
    for (const g of [...genomes(50), ...M3_FOUNDERS.map(founderGenome)]) expect(Array.from(encodeGenome(g, 3, 7))).toEqual(Array.from(encodeGenomeRef(g, 3, 7)));
  });
  it("encodes a genome that went through JSON (weights become {\"0\": …}) like the original", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const rt = JSON.parse(JSON.stringify(g));
    expect(Array.from(encodeGenome(rt, 0, 0))).toEqual(Array.from(encodeGenome(g, 0, 0)));
  });
  it("encodes plain-array weights like the original", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    expect(Array.from(encodeGenome({ ...g, weights: Array.from(g.weights) as unknown as Int8Array }, 0, 0))).toEqual(Array.from(encodeGenome(g, 0, 0)));
  });
  it("refuses missing or out-of-range weights instead of encoding zeros", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const missing = JSON.parse(JSON.stringify(g));
    delete missing.weights["5"];
    expect(() => encodeGenome(missing, 0, 0)).toThrow(/weight 5/);
    const big = { ...g, weights: Array.from(g.weights, (v, i) => (i === 7 ? 200 : v)) as unknown as Int8Array };
    expect(() => encodeGenome(big, 0, 0)).toThrow(/weight 7/);
  });
});
