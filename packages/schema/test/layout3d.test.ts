import { describe, expect, it } from "vitest";
import {
  B1_OFF3, B2_OFF3, G, G3, GENOME_CHANNELS, GENOME_CHANNELS3, IN, IN3, MOT_ZERO, MOT_ZERO3, NN_BYTES, NN_BYTES3, NN_H, NN_H3, NN_I, NN_I3, NN_O, NN_O3,
  NN_PAD3, NN_WORDS, NN_WORDS3, OUT, OUT3, RND, RND3, W1_OFF3, W2_OFF3, packMot3, unpackMot3,
} from "@bl/schema";

describe("slab layout constants", () => {
  it("fixes offsets and sizes", () => {
    expect([NN_I3, NN_H3, NN_O3]).toEqual([11, 8, 9]);
    expect([W1_OFF3, B1_OFF3, W2_OFF3, B2_OFF3]).toEqual([0, 88, 96, 168]);
    expect([NN_BYTES3, NN_WORDS3, NN_PAD3, GENOME_CHANNELS3]).toEqual([177, 45, 3, 49]);
  });
  it("leaves the 2D constants alone", () => {
    expect([NN_BYTES, NN_WORDS, GENOME_CHANNELS]).toEqual([160, 40, 44]);
    expect([NN_I, NN_H, NN_O]).toEqual([10, 8, 8]);
  });
  it("adds only SGZ and MZ", () => {
    expect(IN3.SGZ).toBe(10);
    expect(OUT3.MZ).toBe(8);
    expect({ ...IN3, SGZ: undefined }).toEqual({ ...IN, SGZ: undefined });
    expect({ ...OUT3, MZ: undefined }).toEqual({ ...OUT, MZ: undefined });
    expect(G3).toEqual(G);
  });
  it("RND3 widens diffusion to 18 slots and keeps 20+", () => {
    expect(RND3.DIFF).toBe(1);
    expect(RND3.DIFF + 17).toBe(18);
    expect(RND3.DIFF_ROT).toBe(19);
    const { DIFF: _d, DIFF_ROT: _r, ...rest } = RND3;
    const { DIFF: _d2, ...rest2 } = RND;
    expect(rest).toEqual(rest2);
    const slots = [RND3.LOTTERY, ...Array.from({ length: 18 }, (_, k) => RND3.DIFF + k), RND3.DIFF_ROT];
    expect(slots.slice(1)).toEqual(Array.from({ length: 19 }, (_, k) => k + 1));
    for (const [k, v] of Object.entries(RND3)) if (v >= 20) expect(v).toBe((RND as Record<string, number>)[k]);
  });
});

describe("MOT packing", () => {
  it("round trips and matches the 2D zero", () => {
    const vs = [-128, -1, 0, 1, 127];
    for (const x of vs) for (const y of vs) for (const z of vs) expect(unpackMot3(packMot3(x, y, z))).toEqual([x, y, z]);
    expect(MOT_ZERO3).toBe(0x808080);
    expect(packMot3(0, 0, 0)).toBe(MOT_ZERO3);
    expect(MOT_ZERO3 & 0xffff).toBe(MOT_ZERO);
  });
  it("refuses out-of-range and non-integer values", () => {
    expect(() => packMot3(128, 0, 0)).toThrow();
    expect(() => packMot3(0, -129, 0)).toThrow();
    expect(() => packMot3(0, 0, 1.5)).toThrow();
    expect(() => packMot3(0, NaN, 0)).toThrow();
  });
});
