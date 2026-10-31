import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Soup, type SoupParams } from "../soup/bff.ts";
import { decodeSnapshot, encodeSnapshot, HEADER_BYTES, resumeSoup, sha256Hex, snapshotOf } from "../soup/snapshot.ts";

const GRID: SoupParams = { num: 64, seed: 3, grid: { width: 8, height: 8, radius: 2 } };

const run = (soup: Soup, n: number) => { for (let i = 0; i < n; i++) soup.step(); return soup; };

describe("BLSOUP snapshots", () => {
  it("writes the header fields little-endian and round-trips", () => {
    const soup = run(new Soup(GRID), 3);
    const bytes = snapshotOf(GRID, soup);
    expect(bytes.length).toBe(HEADER_BYTES + 64 * 64);
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("BLSOUP\0\0");
    const v = new DataView(bytes.buffer);
    const u = (o: number) => v.getUint32(o, true);
    expect([8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map(u)).toEqual([1, 3, 64, 8, 8, 2, 1 << 18, 0, 3, 0]);
    expect(bytes.subarray(48, 64).every((b) => b === 0)).toBe(true);
    const d = decodeSnapshot(bytes);
    expect(d.epoch).toBe(3);
    expect(d.params).toEqual({ num: 64, seed: 3, mutation: 1 << 18, lang: "noheads", grid: { width: 8, height: 8, radius: 2 } });
    expect(Array.from(d.programs)).toEqual(Array.from(soup.programs));
  });

  it("writes a well-mixed soup with zero grid fields, the default grid radius as 2, and epochs past 2^32", () => {
    const wm = decodeSnapshot(encodeSnapshot({ num: 4, seed: 9, lang: "heads", mutation: 7 }, new Uint8Array(256), 2 ** 33 + 5));
    expect(wm.params).toEqual({ num: 4, seed: 9, lang: "heads", mutation: 7 });
    expect(wm.epoch).toBe(2 ** 33 + 5);
    const r = decodeSnapshot(encodeSnapshot({ num: 4, seed: 1, grid: { width: 2, height: 2 } }, new Uint8Array(256), 0));
    expect(r.params.grid).toEqual({ width: 2, height: 2, radius: 2 });
  });

  it("rejects a bad magic, version, length, lang or reserved byte", () => {
    const good = snapshotOf(GRID, new Soup(GRID));
    const bad = (f: (b: Uint8Array) => Uint8Array) => () => decodeSnapshot(f(good.slice()));
    expect(bad((b) => { b[0] = 0x58; return b; })).toThrow(/not a BLSOUP/);
    expect(bad((b) => { b[8] = 2; return b; })).toThrow(/version 2/);
    expect(bad((b) => b.subarray(0, b.length - 1))).toThrow(/length/);
    expect(bad((b) => b.subarray(0, 10))).toThrow(/shorter/);
    expect(bad((b) => { b[36] = 2; return b; })).toThrow(/lang/);
    expect(bad((b) => { b[63] = 1; return b; })).toThrow(/reserved/);
    expect(bad((b) => { b[20] = 9; return b; })).toThrow(/grid/);
  });

  it("rejects a mutation past 2^30, where the CPU and GPU would disagree", () => {
    const bytes = snapshotOf(GRID, new Soup(GRID));
    new DataView(bytes.buffer).setUint32(32, 2 ** 30 + 1, true);
    expect(() => decodeSnapshot(bytes)).toThrow(/exceeds 2\^30/);
  });

  it("resumes a huge grid radius as the grid's larger side, which reaches the same neighbours", () => {
    const wide: SoupParams = { ...GRID, grid: { width: 8, height: 8, radius: 8 } };
    const bytes = snapshotOf(wide, new Soup(wide));
    new DataView(bytes.buffer).setUint32(28, 0xffffffff, true);
    const { soup } = resumeSoup(bytes); // would loop for 2^32 steps per cell without the clamp
    expect(run(soup, 4).programs).toEqual(run(new Soup(wide), 4).programs);
  });

  it("hashes with SHA-256", async () => {
    const bytes = snapshotOf(GRID, new Soup(GRID));
    expect(await sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("a resumed soup equals a continuous run, byte for byte", async () => {
    const N = 6;
    const continuous = run(new Soup(GRID), 2 * N);
    const half = snapshotOf(GRID, run(new Soup(GRID), N));
    const { soup, params } = resumeSoup(half);
    expect(soup.epoch).toBe(N);
    run(soup, N);
    const a = snapshotOf(GRID, continuous), b = snapshotOf(params, soup);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(a.subarray(HEADER_BYTES))).not.toEqual(Array.from(half.subarray(HEADER_BYTES))); // the soup moved
    expect(await sha256Hex(b)).toBe(await sha256Hex(a));
  });
});
