// The slab viewer's picture code against hand-built states: layer order, axis orientation and wrap cannot silently flip.
import { describe, expect, it } from "vitest";
import { CH, G, allocState3, cellCount, initWorld, presetById, presetConfig } from "@bl/schema";
import { renderRGBA } from "@bl/metrics";
import { RefSim3 } from "@bl/sim-ref";
import {
  CYCLIC_COLOURS, EMPTY_RGB, NO_LABEL, cellIndex, censusCyclic, censusEco, combinedColour, hashBytes, lineagePixel, paintCombined, paintLayer, projectCyclic,
  projectEcoLayer, rpsPixel, share, tileLayout, type CyclicFrame, type EcoFrame, type RGB,
} from "../src/slab/render.ts";

const eq = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const empty = (d: { W: number; H: number; D: number }) => new Uint8Array(d.W * d.H * d.D).fill(NO_LABEL);
const cyc = (d: { W: number; H: number; D: number }, labels: Uint8Array, step = 0): CyclicFrame => ({ kind: "cyclic", step, dims: d, labels });
const pixel = (rgba: Uint8ClampedArray, W: number, x: number, y: number): RGB => [rgba[(y * W + x) * 4], rgba[(y * W + x) * 4 + 1], rgba[(y * W + x) * 4 + 2]];

describe("tile layout and index convention", () => {
  it("tileLayout puts layer 0 top left and fills row by row", () => {
    const d = { W: 8, H: 6, D: 4 };
    const one = tileLayout(d, 1), two = tileLayout(d, 2), four = tileLayout(d, 4);
    expect([one.cols, one.rows, one.width, one.height]).toEqual([1, 4, 8, 24]);
    expect([two.cols, two.rows, two.width, two.height]).toEqual([2, 2, 16, 12]);
    expect([four.cols, four.rows, four.width, four.height]).toEqual([4, 1, 32, 6]);
    expect(two.tiles.map((t) => [t.z, t.x0, t.y0])).toEqual([[0, 0, 0], [1, 8, 0], [2, 0, 6], [3, 8, 6]]);
    expect(tileLayout({ W: 4, H: 4, D: 8 }, 4).tiles.map((t) => [t.z, t.x0, t.y0]).slice(4)).toEqual([[4, 0, 4], [5, 4, 4], [6, 8, 4], [7, 12, 4]]);
    expect(tileLayout(d, 9).cols).toBe(4);
  });

  it("index convention: a lone marker at (x=2, y=1, z=3) in an 8 x 8 x 4 label array lands on exactly one pixel of tile 3, at column 2, row 1", () => {
    const d = { W: 8, H: 8, D: 4 };
    const labels = empty(d);
    labels[(3 * 8 + 1) * 8 + 2] = 1;
    expect(cellIndex(d, 2, 1, 3)).toBe((3 * 8 + 1) * 8 + 2);
    const f = cyc(d, labels);
    for (let z = 0; z < 4; z++) {
      const px = paintLayer(f, z);
      const hits: [number, number][] = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (eq(pixel(px, 8, x, y), CYCLIC_COLOURS[1])) hits.push([x, y]);
      expect(hits).toEqual(z === 3 ? [[2, 1]] : []);
    }
  });

  it("corners: the first element and the last of a layer map to the top-left and bottom-right pixel of their tile", () => {
    const d = { W: 8, H: 8, D: 4 };
    const labels = empty(d);
    labels[cellIndex(d, 0, 0, 2)] = 0;
    labels[cellIndex(d, 7, 7, 2)] = 2;
    const px = paintLayer(cyc(d, labels), 2);
    expect(pixel(px, 8, 0, 0)).toEqual(CYCLIC_COLOURS[0]);
    expect(pixel(px, 8, 7, 7)).toEqual(CYCLIC_COLOURS[2]);
    expect(pixel(px, 8, 7, 0)).toEqual(EMPTY_RGB);
    expect(pixel(px, 8, 0, 7)).toEqual(EMPTY_RGB);
    expect(cellIndex(d, 0, 0, 2)).toBe(2 * 64);
    expect(cellIndex(d, 7, 7, 2)).toBe(2 * 64 + 63);
  });
});

describe("colours", () => {
  it("cyclic colours: three labels give three distinct opaque colours and the empty cell the dark one", () => {
    const set = new Set([0, 1, 2, NO_LABEL].map((l) => rpsPixel(l).join(",")));
    expect(set.size).toBe(4);
    expect(eq(rpsPixel(NO_LABEL), EMPTY_RGB)).toBe(true);
    const px = paintLayer(cyc({ W: 2, H: 1, D: 1 }, Uint8Array.of(0, NO_LABEL)), 0);
    expect(px[3]).toBe(255);
    expect(px[7]).toBe(255);
  });

  it("the three types stay apart under protanopia, deuteranopia and tritanopia (Machado 2009, severity 1)", () => {
    const M: Record<string, number[][]> = {
      protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
      deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
      tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
    };
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const enc = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
    for (const [name, m] of Object.entries(M)) {
      const sim = CYCLIC_COLOURS.map((c) => m.map((row) => enc(Math.min(1, Math.max(0, row[0] * lin(c[0]) + row[1] * lin(c[1]) + row[2] * lin(c[2]))))));
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const dist = Math.hypot(sim[a][0] - sim[b][0], sim[a][1] - sim[b][1], sim[a][2] - sim[b][2]);
        expect(dist, `${name} ${a}-${b}`).toBeGreaterThan(60);
      }
    }
  });

  it("lineage colour matches the lab renderer (ids above 2^16, saturated cells, dead cells lit by nutrient)", () => {
    const cfg = presetConfig(presetById("slab-spots")!, 7, { tileW: 8, tileH: 8, tileD: 4 });
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    const cells = [
      { hi: 0x12345, lo: 0x6789a, B: 100, P: 20, A: 5 },
      { hi: 0xdeadbeef, lo: 3, B: 1000, P: 0, A: 0 },
      { hi: 1, lo: 0, B: 7, P: 1, A: 40 },
      { hi: 0, lo: 0, B: 0, P: 0, A: 0 },
      { hi: 0, lo: 0, B: 0, P: 0, A: 64 },
      { hi: 0, lo: 0, B: 0, P: 0, A: 9000 },
      { hi: 0, lo: 9, B: 256, P: 0, A: 3 },
    ];
    cells.forEach((c, i) => {
      s.genome[G.LIN_HI * n + i] = c.hi; s.genome[G.LIN_LO * n + i] = c.lo;
      s.cells[CH.B * n + i] = c.B; s.cells[CH.P * n + i] = c.P; s.cells[CH.A * n + i] = c.A;
    });
    const ref = renderRGBA(s, "lineage");
    cells.forEach((c, i) => expect(lineagePixel(c.hi, c.lo, c.B, c.P, c.A), `cell ${i}`).toEqual([ref[i * 4], ref[i * 4 + 1], ref[i * 4 + 2]]));
    // literal values, worked out by hand: a dead cell with A = 64 is 0.06 * min(1, 64 / 128) = 0.03 -> 7.65 -> 8; saturated A gives 0.06 -> 15.3 -> 15
    expect(lineagePixel(0, 0, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(lineagePixel(0, 0, 0, 0, 64)).toEqual([8, 8, 8]);
    expect(lineagePixel(0, 0, 0, 0, 9000)).toEqual([15, 15, 15]);
  });
});

describe("projection", () => {
  it("cyclic: majority type per column, ties to the type met first from the surface; empty stays empty", () => {
    const d = { W: 3, H: 3, D: 4 };
    const labels = empty(d);
    const put = (x: number, y: number, col: number[]) => col.forEach((t, z) => (labels[cellIndex(d, x, y, z)] = t));
    put(0, 0, [2, 1, 1, 255]); // type 1 holds two layers
    put(1, 0, [2, 1, 255, 255]); // tie 1 : 1, the surface type (2) wins
    put(2, 0, [255, 0, 1, 255]); // tie, type 0 met first (z = 1)
    put(0, 1, [255, 255, 255, 2]); // one cell deep down
    put(1, 1, [255, 255, 255, 255]); // empty
    expect(projectCyclic(labels, d, 0, 0)).toBe(1);
    expect(projectCyclic(labels, d, 1, 0)).toBe(2);
    expect(projectCyclic(labels, d, 2, 0)).toBe(0);
    expect(projectCyclic(labels, d, 0, 1)).toBe(2);
    expect(projectCyclic(labels, d, 1, 1)).toBe(NO_LABEL);
    expect(eq(combinedColour(cyc(d, labels), 1, 1), EMPTY_RGB)).toBe(true);
    expect(pixel(paintCombined(cyc(d, labels)), 3, 0, 1)).toEqual(CYCLIC_COLOURS[2]);
  });

  it("ecology: the densest layer wins and the isolate view shows exactly that layer", () => {
    const d = { W: 2, H: 2, D: 3 };
    const n = 12;
    const B = new Uint32Array(n), P = new Uint32Array(n), A = new Uint32Array(n), hi = new Uint32Array(n), lo = new Uint32Array(n);
    const set = (x: number, y: number, z: number, b: number, p: number, id: number) => { const i = cellIndex(d, x, y, z); B[i] = b; P[i] = p; hi[i] = id; lo[i] = 1; };
    set(0, 0, 0, 10, 0, 5); set(0, 0, 1, 50, 5, 6); set(0, 0, 2, 20, 0, 7);
    set(1, 1, 2, 30, 0, 8); set(1, 1, 0, 30, 0, 9); // tie: the surface
    const f: EcoFrame = { kind: "eco", step: 0, dims: d, B, P, A, hi, lo };
    expect(projectEcoLayer(B, P, d, 0, 0)).toBe(1);
    expect(projectEcoLayer(B, P, d, 1, 1)).toBe(0);
    expect(combinedColour(f, 0, 0)).toEqual(lineagePixel(6, 1, 50, 5, 0));
    const layer1 = paintLayer(f, 1);
    expect(pixel(layer1, 2, 0, 0)).toEqual(lineagePixel(6, 1, 50, 5, 0));
    expect(pixel(layer1, 2, 1, 1)).toEqual(lineagePixel(0, 0, 0, 0, 0));
  });

  it("x and y wrap, z is closed: edges are not stitched and the projection reads one column only", () => {
    const d = { W: 8, H: 8, D: 4 };
    const labels = empty(d);
    for (let z = 0; z < 4; z++) for (let y = 0; y < 8; y++) labels[cellIndex(d, 7, y, z)] = 1; // the whole east edge
    expect(projectCyclic(labels, d, 0, 3)).toBe(NO_LABEL); // column (0, y) never reads column (7, y)
    expect(projectCyclic(labels, d, 7, 3)).toBe(1);
    const px = paintLayer(cyc(d, labels), 0);
    expect(pixel(px, 8, 0, 3)).toEqual(EMPTY_RGB);
    const edge = new Uint8Array(8 * 8 * 4).fill(NO_LABEL);
    edge[cellIndex(d, 0, 0, 0)] = 0;
    expect(projectCyclic(edge, d, 0, 0)).toBe(0);
    expect(projectCyclic(edge, d, 7, 7)).toBe(NO_LABEL);
  });
});

describe("census", () => {
  it("censusCyclic counts add up per layer and in total", () => {
    const d = { W: 4, H: 4, D: 4 };
    const labels = empty(d);
    for (let i = 0; i < 16; i++) labels[i] = i % 3; // layer 0 fully occupied
    labels[cellIndex(d, 0, 0, 3)] = 2;
    const c = censusCyclic(labels, d);
    expect(c.counts[0]).toEqual([6, 5, 5, 0]);
    expect(c.counts[3]).toEqual([0, 0, 1, 15]);
    expect(c.total.reduce((a, b) => a + b, 0)).toBe(64);
    expect(c.total).toEqual([6, 5, 6, 47]);
    expect([0, 1, 2, 3].map((t) => share(c.total[t], 64)).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("censusEco: living fraction per layer on a hand-built mask", () => {
    const d = { W: 2, H: 2, D: 3 };
    const hi = new Uint32Array(12), lo = new Uint32Array(12);
    lo[cellIndex(d, 0, 0, 0)] = 1; hi[cellIndex(d, 1, 0, 0)] = 4; lo[cellIndex(d, 1, 1, 2)] = 2;
    const c = censusEco(hi, lo, d);
    expect(c.living).toEqual([2, 0, 1]);
    expect(c.total).toBe(3);
    expect(share(c.living[0], 4)).toBe(0.5);
  });
});

describe("pinned slab picture", () => {
  it("a stock ecology fixture through the CPU reference keeps its picture and per-layer histogram", () => {
    const cfg = presetConfig(presetById("slab-spots")!, 11, { tileW: 16, tileH: 16, tileD: 4, defaultMu: 40, defaultSigma: 20, lightK: 1024 });
    const ref = new RefSim3(initWorld(cfg, presetById("slab-spots")!.init));
    for (let i = 0; i < 20; i++) ref.step();
    const s = ref.state, n = cellCount(cfg);
    const f: EcoFrame = {
      kind: "eco", step: s.step, dims: { W: 16, H: 16, D: 4 },
      B: s.cells.subarray(CH.B * n, (CH.B + 1) * n), P: s.cells.subarray(CH.P * n, (CH.P + 1) * n), A: s.cells.subarray(CH.A * n, (CH.A + 1) * n),
      hi: s.genome.subarray(G.LIN_HI * n, (G.LIN_HI + 1) * n), lo: s.genome.subarray(G.LIN_LO * n, (G.LIN_LO + 1) * n),
    };
    const tiles = [0, 1, 2, 3].map((z) => hashBytes(paintLayer(f, z)));
    const combined = hashBytes(paintCombined(f));
    const living = censusEco(f.hi, f.lo, f.dims).living;
    // regenerate with: BL_PRINT_PIN=1 pnpm vitest run apps/lab/test/slab-render.test.ts -t pinned
    if (process.env.BL_PRINT_PIN) console.log(JSON.stringify({ tiles, combined, living }));
    expect({ tiles, combined, living }).toEqual(PIN);
  });
});

const PIN = { tiles: ["0234e1a9", "0f76f35a", "1e40a58a", "03622969"], combined: "aa19e717", living: [246, 242, 245, 246] } as { tiles: string[]; combined: string; living: number[] };
