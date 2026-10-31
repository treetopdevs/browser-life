import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluate, selfRep, gridNeighbours, parse, show, Soup, splitmix64, STEPS } from "../soup/bff.ts";
import { drawGrid, encodePng } from "../soup/png.ts";
import { inflateSync } from "node:zlib";
import { brotliSize, byteEntropy, census } from "../soup/stats.ts";

const refSplitmix = (x: bigint): bigint => {
  let z = BigInt.asUintN(64, x + 0x9e3779b97f4a7c15n);
  z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  return z ^ (z >> 31n);
};

const tape = (text: string): Uint8Array => {
  const t = new Uint8Array(128);
  t.set(parse(text));
  return t;
};

describe("SplitMix64 on u32 halves", () => {
  it("matches a BigInt reference", () => {
    const xs = [0n, 1n, 0xffffffffn, 0x100000000n, 0x123456789abcdefn, 0xfffffffffffffffen, 0xffffffffffffffffn];
    for (let k = 0n; k < 200n; k++) xs.push(refSplitmix(k * 7919n));
    for (const x of xs) expect(splitmix64(x)).toBe(refSplitmix(x));
  });
});

describe("BFF interpreter", () => {
  it("copies tape[head0] to tape[head1]", () => {
    const t = tape(">."); // head0 -> 1, then tape[0] = tape[1] = '.'
    expect(evaluate(t)).toBe(2);
    expect(String.fromCharCode(t[0])).toBe(".");
  });

  it("halts on an unmatched ]", () => {
    expect(evaluate(tape("]"))).toBe(1);
  });

  it("halts on an unmatched [ when tape[head0] is 0", () => {
    expect(evaluate(tape("<["))).toBe(2); // head0 -> 127 (zero), [ finds no ]
  });

  it("stops at the step limit in an endless loop", () => {
    expect(evaluate(tape("[]"))).toBe(STEPS);
  });

  it("decrements with wraparound and moves heads modulo 128", () => {
    const t = tape("<-"); // head0 -> 127, tape[127]: 0 -> 255
    evaluate(t);
    expect(t[127]).toBe(255);
  });

  it("reads starting heads from bytes 0 and 1 in the heads variant", () => {
    const t = new Uint8Array(128);
    t[0] = 10; t[1] = 20; t[2] = ".".charCodeAt(0); t[10] = 7;
    evaluate(t, "heads");
    expect(t[20]).toBe(7);
  });

  it("round-trips the display form", () => {
    expect(show(parse("[]+-.,<>{}0"))).toBe("[]+-.,<>{}0");
  });
});

describe("soup", () => {
  it("is deterministic and keeps the soup size", () => {
    const a = new Soup({ num: 512, seed: 3 }), b = new Soup({ num: 512, seed: 3 });
    for (let e = 0; e < 20; e++) { a.step(); b.step(); }
    expect(a.programs).toEqual(b.programs);
    expect(a.programs.length).toBe(512 * 64);
  });

  it("pins the noheads and heads soups after 30 epochs (regression)", () => {
    const hash = (lang: "noheads" | "heads") => {
      const s = new Soup({ num: 1024, seed: 11, lang, mutation: 1 << 22 });
      for (let e = 0; e < 30; e++) s.step();
      return createHash("sha256").update(s.programs).digest("hex").slice(0, 16);
    };
    expect({ noheads: hash("noheads"), heads: hash("heads") }).toMatchInlineSnapshot(`
      {
        "heads": "c8ae5e5846d48580",
        "noheads": "42e81659e983be93",
      }
    `);
  });

  it("refuses sizes and seeds outside the exact range", () => {
    expect(() => new Soup({ num: 2 ** 25, seed: 0 })).toThrow();
    expect(() => new Soup({ num: 2, seed: 2 ** 32 })).toThrow();
    expect(() => new Soup({ num: 3, seed: 0 })).toThrow();
  });

  it("plants over the start of a slot and keeps the rest, as cubff does", () => {
    const s = new Soup({ num: 4, seed: 5 });
    const tail = s.programs.slice(1, 64);
    s.plant(0, parse("+"));
    expect(s.programs[0]).toBe("+".charCodeAt(0));
    expect(s.programs.slice(1, 64)).toEqual(tail);
  });

  it("scores an inert program 0 and an evolved replicator 64 on cubff's self-replication test", () => {
    expect(selfRep(new Uint8Array(64).fill(200))).toBe(0);
    // The most common program after seed 2's transition (2^17 programs, epoch 12609).
    const hex = "80b6f65bf6b6ff81dca81f73a13d3cb6a12c4cee7de6b4262836a9363636924c4c5d36bb3636362826e0e67d4c4c2ca1b63c3da1b61f4fdc6e0f5b265bf6b6a1";
    const replicator = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
    expect(selfRep(replicator)).toBe(64);
  });

  it("measures entropy and census", () => {
    const flat = new Uint8Array(64 * 4).fill(7);
    expect(byteEntropy(flat)).toBe(0);
    const c = census(flat);
    expect(c.distinct).toBe(1);
    expect(c.topCount).toBe(4);
    expect(brotliSize(flat)).toBeLessThan(32);
  });

  // cubff testdata/bff_noheads.txt: seed 10248, 2^17 programs. Under Node,
  // node:zlib is the C brotli cubff links, so sizes match exactly. About a
  // minute; run with BL_SOUP_GOLDEN=1.
  it.runIf(process.env.BL_SOUP_GOLDEN === "1")("matches cubff's logged brotli sizes for seed 10248", () => {
    const s = new Soup({ num: 131072, seed: 10248 });
    const got: number[] = [];
    for (let e = 0; e <= 64; e++) {
      s.step();
      if (e % 64 === 0) got.push(brotliSize(s.programs));
    }
    expect(got).toEqual([8388776, 8286015]);
  }, 600_000);
});

describe("grid soup", () => {
  const g = { width: 12, height: 8, radius: 2 };

  it("lists neighbours within the radius, without wraparound, as make_2d_pattern.py", () => {
    const { start, list } = gridNeighbours(g);
    const deg = (i: number) => start[i + 1] - start[i];
    expect(deg(0)).toBe(8); // corner: 3x3 minus self
    expect(deg(2 * 12 + 2)).toBe(24); // interior: 5x5 minus self
    expect(Array.from(list.subarray(start[0], start[1]))).toEqual([1, 2, 12, 13, 14, 24, 25, 26]);
  });

  it("pairs only neighbours, each program at most once, and keeps every slot", () => {
    const s = new Soup({ num: 96, seed: 4, grid: g });
    const nb = gridNeighbours(g);
    for (let e = 0; e < 5; e++) {
      const { order, active } = s.prepare();
      expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: 96 }, (_, i) => i));
      expect(active).toBeGreaterThan(20);
      for (let p = 0; p < active; p++) {
        const i = order[2 * p], j = order[2 * p + 1];
        expect(Array.from(nb.list.subarray(nb.start[i], nb.start[i + 1]))).toContain(j);
      }
      s.step();
    }
  });

  it("pins the grid soup after 30 epochs (regression)", () => {
    const s = new Soup({ num: 96, seed: 4, grid: g, mutation: 1 << 22 });
    for (let e = 0; e < 30; e++) s.step();
    expect(createHash("sha256").update(s.programs).digest("hex").slice(0, 16)).toMatchInlineSnapshot(`"ead2c684f5fe846f"`);
  });

  it("draws a valid PNG of 8x8 blocks", async () => {
    const s = new Soup({ num: 96, seed: 4, grid: g });
    const { width, height, rgb } = drawGrid(s.programs, g);
    expect([width, height]).toEqual([96, 64]);
    const png = await encodePng(width, height, rgb);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatLen = new DataView(png.buffer).getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((width * 3 + 1) * height);
    expect(raw.subarray(1, 1 + width * 3)).toEqual(Buffer.from(rgb.subarray(0, width * 3)));
  });
});
