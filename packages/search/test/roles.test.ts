// The evaluator's optional role observer (EvalConfig.roles): per-cell role words summed into the tile
// that holds each cell, in the layout the react pass writes (ROLE_WORDS words per cell).
import { describe, expect, it } from "vitest";
import { G, ROLE_WORDS, cellCount, defaultConfig, packLineageLo, worldW } from "@bl/schema";
import { addLineageRoles, addTileRoles, type RoleSums } from "../src/evaluate.ts";

describe("addTileRoles", () => {
  it("adds each cell's photo, grow, decomp and resp into its own tile", () => {
    const cfg = defaultConfig({ tileW: 16, tileH: 16, tilesX: 3, tilesY: 2 });
    const n = cellCount(cfg), W = worldW(cfg);
    const roles = new Uint32Array(n * ROLE_WORDS);
    const put = (x: number, y: number, photo: number, grow: number, decomp: number, resp: number) => {
      const i = y * W + x;
      roles[i * ROLE_WORDS] = (photo | (grow << 16)) >>> 0;
      roles[i * ROLE_WORDS + 1] = (decomp | (resp << 16)) >>> 0;
    };
    put(0, 0, 1, 2, 3, 4); // tile 0
    put(15, 15, 10, 0, 0, 0); // tile 0
    put(16, 0, 0, 5, 0, 0); // tile 1
    put(47, 31, 0, 0, 7, 65535); // tile 5 (last)
    const into: RoleSums[] = Array.from({ length: 6 }, () => ({ photo: 0, grow: 0, decomp: 0, resp: 0 }));
    addTileRoles(cfg, roles, into);
    expect(into[0]).toEqual({ photo: 11, grow: 2, decomp: 3, resp: 4 });
    expect(into[1]).toEqual({ photo: 0, grow: 5, decomp: 0, resp: 0 });
    expect(into[5]).toEqual({ photo: 0, grow: 0, decomp: 7, resp: 65535 });
    expect(into[2].photo + into[3].photo + into[4].photo).toBe(0);
  });
});

describe("addLineageRoles", () => {
  it("splits each tile's fluxes between the candidate lineage and everything else", () => {
    const cfg = defaultConfig({ tileW: 16, tileH: 16, tilesX: 2, tilesY: 1 });
    const n = cellCount(cfg), W = worldW(cfg);
    const roles = new Uint32Array(n * ROLE_WORDS);
    const head = new Uint32Array(n * 4);
    const put = (x: number, y: number, rawId: number, photo: number, grow: number, decomp: number, resp: number) => {
      const i = y * W + x;
      roles[i * ROLE_WORDS] = (photo | (grow << 16)) >>> 0;
      roles[i * ROLE_WORDS + 1] = (decomp | (resp << 16)) >>> 0;
      head[G.LIN_HI * n + i] = 0;
      head[G.LIN_LO * n + i] = packLineageLo(cfg, rawId);
    };
    const candLo = [packLineageLo(cfg, 2), packLineageLo(cfg, 4)];
    put(1, 1, 2, 1, 2, 3, 4); // tile 0, candidate
    put(2, 2, 1, 10, 0, 0, 0); // tile 0, producer (raw id 1)
    put(17, 0, 3, 0, 5, 0, 0); // tile 1, producer (raw id 3)
    put(18, 0, 4, 0, 0, 7, 9); // tile 1, candidate
    const cand: RoleSums[] = Array.from({ length: 2 }, () => ({ photo: 0, grow: 0, decomp: 0, resp: 0 }));
    const other: RoleSums[] = Array.from({ length: 2 }, () => ({ photo: 0, grow: 0, decomp: 0, resp: 0 }));
    addLineageRoles(cfg, roles, head, candLo, cand, other);
    expect(cand[0]).toEqual({ photo: 1, grow: 2, decomp: 3, resp: 4 });
    expect(other[0]).toEqual({ photo: 10, grow: 0, decomp: 0, resp: 0 });
    expect(cand[1]).toEqual({ photo: 0, grow: 0, decomp: 7, resp: 9 });
    expect(other[1]).toEqual({ photo: 0, grow: 5, decomp: 0, resp: 0 });
  });

  it("treats a nonzero LIN_HI as another lineage", () => {
    const cfg = defaultConfig({ tileW: 16, tileH: 16, tilesX: 1, tilesY: 1 });
    const n = cellCount(cfg);
    const roles = new Uint32Array(n * ROLE_WORDS);
    const head = new Uint32Array(n * 4);
    roles[0] = 5;
    head[G.LIN_HI * n] = 1;
    head[G.LIN_LO * n] = packLineageLo(cfg, 1);
    const cand = [{ photo: 0, grow: 0, decomp: 0, resp: 0 }], other = [{ photo: 0, grow: 0, decomp: 0, resp: 0 }];
    addLineageRoles(cfg, roles, head, [packLineageLo(cfg, 1)], cand, other);
    expect(cand[0].photo).toBe(0);
    expect(other[0].photo).toBe(5);
  });
});
