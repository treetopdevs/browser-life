// The evaluator's optional role observer (EvalConfig.roles): per-cell role words summed into the tile
// that holds each cell, in the layout the react pass writes (ROLE_WORDS words per cell).
import { describe, expect, it } from "vitest";
import { ROLE_WORDS, cellCount, defaultConfig, worldW } from "@bl/schema";
import { addTileRoles, type RoleSums } from "../src/evaluate.ts";

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
