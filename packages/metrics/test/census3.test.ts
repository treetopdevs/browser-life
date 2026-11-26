import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, G, ROLE_WORDS, cellCount, defaultConfig, worldH, worldW, type WorldConfig } from "@bl/schema";
import { LAYERS_HEADER, Tracker, census, census3, layerRoles, layersRows } from "@bl/metrics";

const slabCfg = (extra: Partial<WorldConfig> = {}) => defaultConfig({ tileW: 16, tileH: 16, tileD: 8, lightK: 1024, kernelRadius: 3, ...extra });
const flatCfg = () => defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3 });

/** A slab state's census inputs: mass B at the listed (x, y, z), lineage `lin` (hi 0, lo lin) on every listed cell. */
function world(cfg: WorldConfig, set: [number, number, number][], B = 100, lin = 1) {
  const n = cellCount(cfg), W = worldW(cfg), H = worldH(cfg);
  const cells = new Uint32Array(n * CELL_CHANNELS);
  const genomeHead = new Uint32Array(n * 4);
  for (const [x, y, z] of set) {
    const i = z * W * H + y * W + x;
    cells[CH.B * n + i] = B;
    genomeHead[G.LIN_LO * n + i] = lin;
    genomeHead[G.PARAM0 * n + i] = 60 | (20 << 16);
  }
  return { cfg, step: 10, cells, genomeHead };
}
const block = (x0: number, y0: number, z0: number, w: number, h: number, d: number) => {
  const out: [number, number, number][] = [];
  for (let z = z0; z < z0 + d; z++) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y, z]);
  return out;
};
const opt = { threshold: 48, minMass: 1 };

describe("census3", () => {
  it("needs a slab config", () => {
    expect(() => census3({ ...world(flatCfg(), []), cfg: flatCfg() })).toThrow(/slab/);
  });

  it("joins face neighbours and not cells that touch only at an edge or a corner", () => {
    const cfg = slabCfg();
    const c = census3(world(cfg, [[2, 2, 2], [3, 3, 3]]), opt);
    expect(c.components.length).toBe(2);
    const face = census3(world(cfg, [[2, 2, 2], [3, 2, 2], [3, 2, 3]]), opt);
    expect(face.components.length).toBe(1);
    expect(face.components[0].cells).toBe(3);
  });

  it("wraps x and y within the tile, with centroids back in range", () => {
    const cfg = slabCfg();
    const xs = census3(world(cfg, [[15, 5, 4], [0, 5, 4], [1, 5, 4]]), opt);
    expect(xs.components.length).toBe(1);
    expect(xs.components[0].cx).toBeCloseTo(0, 9);
    const ys = census3(world(cfg, [[5, 14, 1], [5, 15, 1], [5, 0, 1]]), opt);
    expect(ys.components.length).toBe(1);
    expect(ys.components[0].cy).toBeCloseTo(15, 9);
    for (const k of [...xs.components, ...ys.components]) {
      expect(k.cx).toBeGreaterThanOrEqual(0);
      expect(k.cx).toBeLessThan(16);
      expect(k.cy).toBeGreaterThanOrEqual(0);
      expect(k.cy).toBeLessThan(16);
    }
  });

  it("does not wrap z: layers 0 and 7 never connect, 0 and 1 do", () => {
    const cfg = slabCfg();
    expect(census3(world(cfg, [[4, 4, 0], [4, 4, 7]]), opt).components.length).toBe(2);
    expect(census3(world(cfg, [[4, 4, 0], [4, 4, 1]]), opt).components.length).toBe(1);
  });

  it("reports the mass-weighted mean layer and the dominant lineage", () => {
    const cfg = slabCfg();
    const c = census3(world(cfg, block(3, 3, 2, 1, 1, 3)), opt);
    expect(c.components[0].cz).toBeCloseTo(3, 9);
    expect(c.components[0].lineage).toBe("0:1");
    expect(c.components[0].tile).toBe(0);
    expect(c.components[0].mu).toBe(60);
    expect(c.components[0].sigma).toBe(20);
  });

  it("labels every cell and applies the threshold and the individual minimum", () => {
    const cfg = slabCfg();
    const w = world(cfg, block(2, 2, 2, 2, 2, 2));
    const c = census3(w);
    expect(c.labels.length).toBe(cellCount(cfg));
    expect(c.labels.filter((l) => l >= 0).length).toBe(8);
    expect(c.labels.filter((l) => l === -1).length).toBe(cellCount(cfg) - 8);
    // threshold: cells under 48 are background, though their lineage still counts as living
    const dim = census3(world(cfg, [[1, 1, 1]], 47));
    expect(dim.components.length).toBe(0);
    expect(dim.livingCells).toBe(1);
    // minMass (256) is the tracker's individual rule: eight cells of 100 = 800 pass, three cells of 50 = 150 do not
    const t = new Tracker();
    t.update(c);
    expect(t.alive.size).toBe(1);
    const small = new Tracker();
    small.update(census3(world(cfg, block(0, 0, 0, 3, 1, 1), 50)));
    expect(small.alive.size).toBe(0);
  });

  it("equals the 2D census on a slab with all its mass in one layer", () => {
    const cfg3 = slabCfg(), cfg2 = flatCfg();
    const n2 = cellCount(cfg2);
    // Two blobs, one across the x seam, with two lineages.
    const cells: [number, number][] = [...block(14, 3, 0, 4, 3, 1).map(([x, y]) => [x % 16, y] as [number, number]), ...block(6, 9, 0, 3, 3, 1).map(([x, y]) => [x, y] as [number, number])];
    const w3 = world(cfg3, cells.map(([x, y]) => [x, y, 5]));
    // lineage 2 for the second blob
    const W = 16;
    for (let y = 9; y < 12; y++) for (let x = 6; x < 9; x++) w3.genomeHead[G.LIN_LO * cellCount(cfg3) + 5 * W * 16 + y * W + x] = 2;
    const cells2 = new Uint32Array(n2 * CELL_CHANNELS);
    const head2 = new Uint32Array(n2 * 4);
    const n3 = cellCount(cfg3);
    for (let ch = 0; ch < CELL_CHANNELS; ch++) cells2.set(w3.cells.subarray(ch * n3 + 5 * n2, ch * n3 + 6 * n2), ch * n2);
    for (let ch = 0; ch < 4; ch++) head2.set(w3.genomeHead.subarray(ch * n3 + 5 * n2, ch * n3 + 6 * n2), ch * n2);
    const a = census3(w3), b = census({ cfg: cfg2, step: 10, cells: cells2, genomeHead: head2 });
    expect(a.components.length).toBe(2);
    const strip = (cs: typeof a.components) => cs.map(({ cz: _cz, ...k }) => k);
    expect(strip(a.components)).toEqual(b.components);
    expect(a.lineages).toEqual(b.lineages);
    expect(a.livingCells).toBe(b.livingCells);
    // the 2D census carries no cz key at all
    expect("cz" in b.components[0]).toBe(false);
  });

  it("feeds the tracker: a ball that moves keeps its identity, labelCount covers every cell", () => {
    const cfg = slabCfg();
    const t = new Tracker();
    const a = census3(world(cfg, block(4, 4, 2, 3, 3, 2)));
    const b = census3(world(cfg, block(5, 4, 2, 3, 3, 2)));
    expect(t.update(a)).toEqual([]);
    const id = [...t.alive.keys()];
    expect(id.length).toBe(1);
    expect(t.update(b)).toEqual([]);
    expect([...t.alive.keys()]).toEqual(id);
    expect(t.update(census3(world(cfg, []))).map((e) => e.kind)).toEqual(["death"]);
    expect(a.labels.length).toBe(cellCount(cfg));
    expect(t.labelCount()).toBe(cellCount(cfg));
  });
});

describe("layerRoles and layersRows", () => {
  const cfg = slabCfg();
  const n = cellCount(cfg), WH = 16 * 16;
  const roles = () => new Uint32Array(n * ROLE_WORDS);
  const put = (r: Uint32Array, i: number, photo: number, grow: number, decomp: number, resp: number) => {
    r[i * ROLE_WORDS] = (photo | (grow << 16)) >>> 0;
    r[i * ROLE_WORDS + 1] = (decomp | (resp << 16)) >>> 0;
  };

  it("sums the four counts per layer by cell index", () => {
    const r = roles();
    put(r, 0, 1, 2, 3, 4);
    put(r, 5, 10, 20, 30, 40);
    put(r, WH + 3, 7, 0, 0, 1);
    put(r, 7 * WH + 255, 100, 200, 300, 400);
    const L = layerRoles(cfg, r);
    expect(L.length).toBe(8);
    expect(L.map((l) => l.z)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(L[0]).toMatchObject({ photo: 11, grow: 22, decomp: 33, resp: 44, saturated: 0 });
    expect(L[1]).toMatchObject({ photo: 7, grow: 0, decomp: 0, resp: 1 });
    expect(L[7]).toMatchObject({ photo: 100, grow: 200, decomp: 300, resp: 400 });
    expect(L[3]).toMatchObject({ photo: 0, grow: 0, decomp: 0, resp: 0, saturated: 0 });
  });

  it("counts saturation per 16-bit field", () => {
    const r = roles();
    put(r, 0, 65535, 65535, 5, 0);
    put(r, 1, 65535, 1, 65535, 65535);
    put(r, 2 * WH, 0, 0, 0, 65535);
    const L = layerRoles(cfg, r);
    expect(L[0].saturated).toBe(2 + 3);
    expect(L[0].photo).toBe(131070);
    expect(L[2].saturated).toBe(1);
  });

  it("refuses a 2D config and a mis-sized buffer", () => {
    expect(() => layerRoles(flatCfg(), new Uint32Array(0))).toThrow(/slab/);
    expect(() => layerRoles(cfg, new Uint32Array(8))).toThrow(/roles has 8 words/);
  });

  it("writes one line per layer in ascending z", () => {
    const r = roles();
    put(r, 0, 1, 2, 3, 4);
    const text = layersRows(1000, layerRoles(cfg, r));
    const lines = text.split("\n");
    expect(lines.length).toBe(9);
    expect(lines[8]).toBe("");
    expect(lines[0]).toBe("1000\t0\t1\t2\t3\t4\t0");
    expect(lines[7]).toBe("1000\t7\t0\t0\t0\t0\t0");
    expect(LAYERS_HEADER).toBe("step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated\n");
    expect(LAYERS_HEADER.split("\t").length).toBe(lines[0].split("\t").length);
  });
});
