// tools/lib/pond-sheet.ts: the state-only contact sheet, the founding-eligibility rule and the album.
import { describe, expect, it } from "vitest";
import { CH, PRESETS, cellCount, initWorld, presetConfig, worldW, type WorldState } from "@bl/schema";
import { ALBUM_ROWS, FOUNDING_MASS, LABEL_ELIGIBLE, LABEL_OTHER, SHEET_GAP, albumSheet, drawLabel, foundingEligible, hsv, massColour, pondSheet, sheetScale, tileRgb } from "../lib/pond-sheet.ts";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;

/** ponds-small's world with its cells replaced: `fill(pond, x, y)` is the bound mass B of that cell (P = 0). */
function world(fill: (pond: number, x: number, y: number) => number): WorldState {
  const s = initWorld(presetConfig(pondsSmall, 1), pondsSmall.init);
  const cfg = s.cfg, n = cellCount(cfg), W = worldW(cfg);
  s.cells.fill(0, CH.B * n, (CH.P + 1) * n);
  for (let p = 0; p < cfg.tilesX * cfg.tilesY; p++) {
    const tx = p % cfg.tilesX, ty = (p - tx) / cfg.tilesX;
    for (let y = 0; y < cfg.tileH; y++) for (let x = 0; x < cfg.tileW; x++) s.cells[CH.B * n + (ty * cfg.tileH + y) * W + tx * cfg.tileW + x] = fill(p, x, y);
  }
  return s;
}

const px = (rgb: Uint8Array, width: number, x: number, y: number) => Array.from(rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));

describe("sheetScale", () => {
  it("is the largest integer scale in 1..6 that keeps both edges within 1,536 px", () => {
    expect(sheetScale(4, 4, 64, 64)).toBe(5);
    expect(sheetScale(8, 8, 64, 64)).toBe(2);
    expect(sheetScale(2, 2, 64, 64)).toBe(6);
    expect(sheetScale(100, 100, 64, 64)).toBe(1);
    // Both axes constrain: a wide, short grid is limited by its width.
    expect(sheetScale(8, 1, 64, 64)).toBe(2);
    expect(sheetScale(1, 8, 64, 64)).toBe(2);
  });
});

describe("foundingEligible", () => {
  // k = 5: a pond of uniform mass m has an expected packet mass of 25 m. 112, 120 and 128 give 2,800, 3,000 and 3,200.
  const s = world((p) => [112, 120, 128, 0][p]);
  it("is occupied ponds whose expected packet mass reaches 3,000", () => {
    expect(FOUNDING_MASS).toBe(3000);
    expect(foundingEligible(s, 5)).toEqual({ occupied: [0, 1, 2], eligible: [1, 2] });
  });
  it("leaves a thinly bodied pond occupied but not eligible", () => {
    const sparse = world((p, x, y) => (p === 0 ? (x < 2 && y < 2 ? 100 : 0) : 60));
    expect(foundingEligible(sparse, 8)).toEqual({ occupied: [0, 1, 2, 3], eligible: [1, 2, 3] });
  });
  it("is derived from the state alone", () => {
    expect(foundingEligible(s, 5)).toEqual(foundingEligible(structuredClone(s), 5));
  });
});

describe("pondSheet", () => {
  const s = world((p, x, y) => (p === 1 ? 60 : p === 2 ? (x < 2 && y < 2 ? 100 : 0) : 0));
  const sheet = pondSheet(s);

  it("has the stated size and grid", () => {
    expect(sheet.scale).toBe(6);
    expect(sheet.grid).toEqual({ x: 2, y: 2 });
    expect(sheet.width).toBe(2 * (64 * 6 + SHEET_GAP) + SHEET_GAP);
    expect(sheet.height).toBe(sheet.width);
    expect(sheet.rgb.length).toBe(sheet.width * sheet.height * 3);
  });

  it("is deterministic and a function of the state alone", () => {
    expect(Array.from(pondSheet(s).rgb)).toEqual(Array.from(sheet.rgb));
    expect(Array.from(pondSheet(structuredClone(s)).rgb)).toEqual(Array.from(sheet.rgb));
  });

  it("draws each pond's index at its tile's top-left: white if eligible, grey otherwise", () => {
    const x0 = (p: number) => SHEET_GAP + (p % 2) * (64 * 6 + SHEET_GAP), y0 = (p: number) => SHEET_GAP + Math.floor(p / 2) * (64 * 6 + SHEET_GAP);
    // Row 0 of the glyphs: "0" and "2" are 0b01110 (first lit column 1), "1" is 0b00100 (column 2); a pixel is 2 px, after a 2 px pad.
    const lit = (p: number) => px(sheet.rgb, sheet.width, x0(p) + 2 + 2 * (p === 1 ? 2 : 1), y0(p) + 2);
    expect(foundingEligible(s, 8).eligible).toEqual([1]);
    expect(lit(1)).toEqual([...LABEL_ELIGIBLE]);
    expect(lit(2)).toEqual([...LABEL_OTHER]); // occupied, packet too thin
    expect(lit(0)).toEqual([...LABEL_OTHER]); // empty
    // The chip is dark under the label, and the label of pond 3 is a "3", not a "0": its row 0 (0b11110) lights column 0.
    expect(px(sheet.rgb, sheet.width, x0(3), y0(3))).toEqual([10, 10, 14]);
    expect(px(sheet.rgb, sheet.width, x0(3) + 2, y0(3) + 2)).toEqual([...LABEL_OTHER]);
  });

  it("colours by bound mass on one ramp and draws an empty pond dark", () => {
    const x0 = SHEET_GAP + 64 * 6 + SHEET_GAP, y0 = SHEET_GAP;
    expect(px(sheet.rgb, sheet.width, x0 + 200, y0 + 200)).toEqual(massColour(60));
    expect(px(sheet.rgb, sheet.width, SHEET_GAP + 200, SHEET_GAP + 200)).toEqual([0, 0, 0]);
    const ramp = [0, 10, 48, 64, 96, 128].map((m) => massColour(m));
    expect(ramp[0]).toEqual([0, 0, 0]);
    for (let i = 2; i < ramp.length; i++) expect(ramp[i][0] + ramp[i][1] + ramp[i][2]).toBeGreaterThan(ramp[i - 1][0] + ramp[i - 1][1] + ramp[i - 1][2] - 1);
  });

  it("refuses a world without a pond config", () => {
    const spots = initWorld(presetConfig(PRESETS.find((p) => p.id === "spots")!, 1), PRESETS.find((p) => p.id === "spots")!.init);
    expect(() => pondSheet(spots)).toThrow(/pondK/);
  });
});

describe("tileRgb", () => {
  it("is the pond at an integer scale", () => {
    const s = world((p, x, y) => (p === 0 ? x + y : 0));
    const t = tileRgb(s, 0, 2);
    expect(t.length).toBe(128 * 128 * 3);
    expect(px(t, 128, 2, 2)).toEqual(massColour(2));
    expect(px(t, 128, 3, 3)).toEqual(massColour(2));
    expect(px(t, 128, 4, 2)).toEqual(massColour(3));
  });
});

describe("albumSheet", () => {
  const tile = (v: number) => new Uint8Array(32 * 32 * 3).fill(v);
  it("lays one row per cycle, newest at the bottom, the picked tiles beside the cycle number", () => {
    const a = albumSheet([
      { cycle: 1, tiles: [tile(10), tile(20)], size: 32 },
      { cycle: 2, tiles: [tile(30)], size: 32 },
    ]);
    expect(a.grid).toEqual({ x: 2, y: 2 });
    expect(a.height).toBe(SHEET_GAP + 2 * (32 + SHEET_GAP));
    const labelW = (3 * 6 - 1) * 2 + 4;
    expect(px(a.rgb, a.width, SHEET_GAP + labelW + 5, SHEET_GAP + 5)).toEqual([10, 10, 10]);
    expect(px(a.rgb, a.width, SHEET_GAP + labelW + 32 + SHEET_GAP + 5, SHEET_GAP + 5)).toEqual([20, 20, 20]);
    expect(px(a.rgb, a.width, SHEET_GAP + labelW + 5, SHEET_GAP + 32 + SHEET_GAP + 5)).toEqual([30, 30, 30]);
    expect(px(a.rgb, a.width, SHEET_GAP, SHEET_GAP)).toEqual([10, 10, 14]);
  });
  it("keeps the last 8 cycles and refuses an empty album, a mixed size and a wrong-sized tile", () => {
    const rows = Array.from({ length: ALBUM_ROWS + 3 }, (_, i) => ({ cycle: i + 1, tiles: [tile(i)], size: 32 }));
    expect(albumSheet(rows).grid.y).toBe(ALBUM_ROWS);
    expect(() => albumSheet([])).toThrow(/at least one/);
    expect(() => albumSheet([{ cycle: 1, tiles: [tile(0)], size: 32 }, { cycle: 2, tiles: [tile(0)], size: 16 }])).toThrow(/same size/);
    expect(() => albumSheet([{ cycle: 1, tiles: [new Uint8Array(5)], size: 32 }])).toThrow(/expected/);
  });
});

describe("drawLabel and hsv", () => {
  it("draws digits only and sizes its chip", () => {
    const img = new Uint8Array(40 * 20 * 3);
    const { w, h } = drawLabel(img, 40, 0, 0, "12", LABEL_ELIGIBLE);
    expect([w, h]).toEqual([(2 * 6 - 1) * 2 + 4, 7 * 2 + 4]);
  });
  it("hsv matches the breeder's frames: the function moved here unchanged", () => {
    expect(hsv(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsv(1 / 3, 1, 1)).toEqual([0, 255, 0]);
    expect(hsv(0.5, 0, 0.5)).toEqual([128, 128, 128]);
  });
});
