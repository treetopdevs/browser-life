import { describe, expect, it } from "vitest";
import {
  G, GENOME_CHANNELS3, IN, IN3, NN_BYTES, NN_BYTES3, NN_H, NN_I, NN_I3, NN_O, NN_O3, OUT, OUT3, b1, b1At3, b2, b2At3, decodeGenome3, emptyGenome3, encodeGenome3, generalistGenome,
  generalistGenome3, genomeFromHex3, genomeHex3, liftGenome, projectGenome, w1, w1At3, w2, w2At3, type Genome, type Genome3,
} from "@bl/schema";

let seed = 987654321;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 0xff;
const i8 = () => (rnd() << 24) >> 24;
const rand2d = (k: number): Genome => ({ mu: 16 + k, sigma: 2 + k, motGain: k % 256, weights: Int8Array.from({ length: NN_BYTES }, i8) });
const rand3 = (k: number): Genome3 => ({ mu: 16 + k, sigma: 2 + k, motGain: k % 256, weights: Int8Array.from({ length: NN_BYTES3 }, i8) });

describe("slab genome codec", () => {
  it("round trips 50 random genomes with zero padding", () => {
    for (let k = 0; k < 50; k++) {
      const g = rand3(k);
      const words = encodeGenome3(g, 3, 4);
      expect(words.length).toBe(GENOME_CHANNELS3);
      expect(words[G.LIN_HI]).toBe(3);
      expect(words[G.LIN_LO]).toBe(4);
      expect(words[GENOME_CHANNELS3 - 1] >>> 8).toBe(0);
      expect(decodeGenome3(words)).toEqual(g);
    }
  });
  it("hex has 376 digits and round trips; bad strings are rejected", () => {
    const g = rand3(7);
    const hex = genomeHex3(g);
    expect(hex).toMatch(/^[0-9a-f]{376}$/);
    expect(genomeFromHex3(hex)).toEqual(g);
    expect(() => genomeFromHex3(hex.slice(1))).toThrow();
    expect(() => genomeFromHex3(hex.toUpperCase())).toThrow();
    expect(() => genomeFromHex3(hex + "0")).toThrow();
    expect(() => genomeFromHex3("g".repeat(376))).toThrow();
  });
  it("refuses wrong lengths, non-int8 values and PARAM1 high bytes", () => {
    const g = rand3(1);
    expect(() => encodeGenome3({ ...g, weights: new Int8Array(NN_BYTES) }, 0, 0)).toThrow();
    expect(() => encodeGenome3({ ...g, weights: Array.from(g.weights).fill(200) as unknown as Int8Array }, 0, 0)).toThrow();
    const words = encodeGenome3(g, 0, 0);
    expect(() => decodeGenome3(words.subarray(0, 44))).toThrow();
    for (const sh of [8, 16, 24]) {
      const w = words.slice();
      w[G.PARAM1] |= 1 << sh;
      expect(() => decodeGenome3(w)).toThrow();
    }
    const padded = words.slice();
    padded[GENOME_CHANNELS3 - 1] |= 0x100;
    expect(() => decodeGenome3(padded)).toThrow();
  });
});

describe("liftGenome", () => {
  it("places every weight and zeroes the SGZ row, MZ column and MZ bias", () => {
    const g = rand2d(3);
    const l = liftGenome(g);
    expect([l.mu, l.sigma, l.motGain]).toEqual([g.mu, g.sigma, g.motGain]);
    for (let i = 0; i < NN_I; i++) for (let j = 0; j < NN_H; j++) expect(l.weights[w1At3(i, j)]).toBe(g.weights[w1(i, j)]);
    for (let j = 0; j < NN_H; j++) expect(l.weights[b1At3(j)]).toBe(g.weights[b1(j)]);
    for (let j = 0; j < NN_H; j++) for (let k = 0; k < NN_O; k++) expect(l.weights[w2At3(j, k)]).toBe(g.weights[w2(j, k)]);
    for (let k = 0; k < NN_O; k++) expect(l.weights[b2At3(k)]).toBe(g.weights[b2(k)]);
    for (let j = 0; j < NN_H; j++) expect(l.weights[w1At3(IN3.SGZ, j)]).toBe(0);
    for (let j = 0; j < NN_H; j++) expect(l.weights[w2At3(j, OUT3.MZ)]).toBe(0);
    expect(l.weights[b2At3(OUT3.MZ)]).toBe(0);
    expect(l.weights.length).toBe(NN_BYTES3);
  });
  it("projectGenome inverts it on 100 genomes", () => {
    for (let k = 0; k < 100; k++) {
      const g = rand2d(k);
      expect(projectGenome(liftGenome(g))).toEqual(g);
    }
  });
  it("computes the same first eight outputs, and MZ = 0, whatever SGZ is", () => {
    const fwd = (w: Int8Array, nin: number, nout: number, o: { w1: (i: number, j: number) => number; b1: (j: number) => number; w2: (j: number, k: number) => number; b2: (k: number) => number }, x: number[]) => {
      const h = Array.from({ length: NN_H }, (_, j) => Math.max(0, w[o.b1(j)] + x.slice(0, nin).reduce((a, v, i) => a + v * w[o.w1(i, j)], 0)));
      return Array.from({ length: nout }, (_, k) => w[o.b2(k)] + h.reduce((a, v, j) => a + v * w[o.w2(j, k)], 0));
    };
    for (let k = 0; k < 200; k++) {
      const g = rand2d(k);
      const l = liftGenome(g);
      const x = Array.from({ length: NN_I3 }, () => (rnd() - 128) * 7);
      const a = fwd(g.weights, NN_I, NN_O, { w1, b1, w2, b2 }, x);
      const b = fwd(l.weights, NN_I3, NN_O3, { w1: w1At3, b1: b1At3, w2: w2At3, b2: b2At3 }, x);
      expect(b.slice(0, NN_O)).toEqual(a);
      expect(b[OUT3.MZ]).toBe(0);
    }
  });
  it("lifts the generalist, and the neutral and evolving arms share one definition", () => {
    const l = generalistGenome3(154, 24);
    expect(l).toEqual(liftGenome(generalistGenome(154, 24)));
    expect(l.weights[w1At3(IN.EPB, 0)]).toBe(127);
    expect(l.weights[w1At3(IN.LIGHT, 1)]).toBe(127);
    expect(l.weights[b1At3(2)]).toBe(64);
    expect(l.weights[w2At3(1, OUT.PHOTO)]).toBe(110);
    expect(l.weights[b2At3(OUT.RESP)]).toBe(70);
    expect(l.weights[w2At3(0, OUT.RESP)]).toBe(-127);
    expect(l.weights[b2At3(OUT.GROW)]).toBe(-24);
    expect(l.weights[b2At3(OUT3.MZ)]).toBe(0);
  });
  it("refuses genomes with rings or genes", () => {
    expect(() => liftGenome({ ...rand2d(1), rings: [1, 0, 0] })).toThrow();
    expect(() => liftGenome({ ...rand2d(1), genes: 1 })).toThrow();
    expect(() => liftGenome({ ...rand2d(1), rings: [0, 0, 0] })).not.toThrow();
  });
  it("emptyGenome3 is all zero", () => {
    expect(Array.from(emptyGenome3(1, 2).weights).every((v) => v === 0)).toBe(true);
  });
});
