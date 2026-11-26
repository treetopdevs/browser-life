// Enclosure census (enclosure3.ts) on synthetic shells: closed, open, without corners, nested, across the wrapped x/y
// edges, against the z walls, and spanning lids (bands).
import { describe, expect, it } from "vitest";
import { CH, G, allocState3, cellCount, defaultConfig } from "@bl/schema";
import { enclosureCensus3, enclosureCensusRaw } from "@bl/metrics";

const W = 16, H = 16, D = 16;
const SHELL = 64;

function world() {
  const n = W * H * D;
  const P = new Uint32Array(n), B = new Uint32Array(n), live = new Uint8Array(n);
  const at = (x: number, y: number, z: number) => z * W * H + (((y % H) + H) % H) * W + (((x % W) + W) % W);
  const run = () => enclosureCensusRaw(W, H, D, (i) => P[i], (i) => B[i], (i) => live[i] === 1, { shell: SHELL });
  /** Hollow box of polymer, half-width r around (cx, cy, cz); z outside the slab is skipped. */
  const box = (cx: number, cy: number, cz: number, r: number, skip?: (dx: number, dy: number, dz: number) => boolean) => {
    for (let dz = -r; dz <= r; dz++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
          if (skip?.(dx, dy, dz)) continue;
          const z = cz + dz;
          if (z < 0 || z >= D) continue;
          P[at(cx + dx, cy + dy, z)] = SHELL;
        }
  };
  const life = (x: number, y: number, z: number, b = 10) => { const i = at(x, y, z); live[i] = 1; B[i] = b; };
  return { P, B, live, at, run, box, life };
}

describe("enclosure census", () => {
  it("counts life inside a closed shell, and only inside", () => {
    const w = world();
    w.box(8, 8, 8, 2);
    w.life(8, 8, 8, 30); w.life(7, 8, 8, 5); // inside, two cells
    w.life(2, 2, 2, 7); // outside
    const c = w.run();
    expect(c).toMatchObject({ enclosures: 1, pockets: 1, enclosedBiomass: 35, enclosedLiving: 2, bands: 0, bodies: 2, largestBody: 2 });
    expect(c.largest).toEqual({ cells: 27, living: 2, biomass: 35 });
    expect(c.shellCells).toBe(5 ** 3 - 3 ** 3);
  });

  it("an empty pocket is a pocket, not an enclosure; a polymer threshold below the shell's P makes no shell", () => {
    const w = world();
    w.box(8, 8, 8, 2);
    expect(w.run()).toMatchObject({ pockets: 1, enclosures: 0, enclosedBiomass: 0, largest: null });
    w.life(8, 8, 8);
    expect(enclosureCensusRaw(W, H, D, (i) => w.P[i], (i) => w.B[i], (i) => w.live[i] === 1, { shell: SHELL + 1 })).toMatchObject({ shellCells: 0, pockets: 0, enclosures: 0 });
  });

  it("one missing face cell opens the shell; missing corners and edges do not (only face steps leak)", () => {
    const open = world();
    open.box(8, 8, 8, 1, (dx, dy, dz) => dx === 1 && dy === 0 && dz === 0);
    open.life(8, 8, 8);
    expect(open.run()).toMatchObject({ enclosures: 0, pockets: 0 });
    const corners = world();
    corners.box(8, 8, 8, 1, (dx, dy, dz) => Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1); // only the six face cells remain
    corners.life(8, 8, 8);
    expect(corners.run()).toMatchObject({ enclosures: 1, enclosedLiving: 1 });
  });

  it("nested shells are separate pockets", () => {
    const w = world();
    w.box(8, 8, 8, 4);
    w.box(8, 8, 8, 1);
    w.life(8, 8, 8, 3); // inner
    expect(w.run()).toMatchObject({ pockets: 2, enclosures: 1, enclosedBiomass: 3 });
    w.life(5, 8, 8, 9); // between the shells
    const c = w.run();
    expect(c).toMatchObject({ pockets: 2, enclosures: 2, enclosedBiomass: 12, bodies: 2 });
    expect(c.largest!.biomass).toBe(9);
  });

  it("a shell across the wrapped x and y edges still encloses", () => {
    const w = world();
    w.box(0, 0, 8, 2);
    w.life(0, 0, 8, 4); w.life(W - 1, H - 1, 8, 6);
    const c = w.run();
    expect(c).toMatchObject({ enclosures: 1, enclosedBiomass: 10, bands: 0 });
    expect(c.bodies).toBe(1); // diagonal across both seams: one 26-connected body
  });

  it("the z walls are not shell: a cup open against the surface or the floor encloses nothing; a shell closed on the wall layer does", () => {
    const top = world();
    top.box(8, 8, 0, 2); // centre on the surface layer: the shell's top half is clipped away
    top.life(8, 8, 0); top.life(8, 8, 1);
    expect(top.run()).toMatchObject({ enclosures: 0, pockets: 0 });
    const floor = world();
    floor.box(8, 8, D - 1, 2);
    floor.life(8, 8, D - 2);
    expect(floor.run()).toMatchObject({ enclosures: 0 });
    const sits = world();
    sits.box(8, 8, 1, 1); // its bottom face is on layer 0, the inside at z = 1 touches no wall layer
    sits.life(8, 8, 1, 2);
    expect(sits.run()).toMatchObject({ enclosures: 1, enclosedBiomass: 2 });
  });

  it("two lids spanning the jar make a band, reported apart and not as an enclosure", () => {
    const w = world();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { w.P[w.at(x, y, 3)] = SHELL; w.P[w.at(x, y, 9)] = SHELL; }
    w.life(4, 4, 6, 11);
    expect(w.run()).toMatchObject({ bands: 1, bandBiomass: 11, enclosures: 0, pockets: 0 });
    // A closed box inside the band is still an enclosure.
    w.box(10, 10, 6, 1);
    w.life(10, 10, 6, 5);
    expect(w.run()).toMatchObject({ bands: 1, bandBiomass: 11, enclosures: 1, enclosedBiomass: 5 });
  });

  it("reads a slab state: P and B channels and the lineage words", () => {
    const cfg = defaultConfig({ kernelRadius: 3, tileW: 16, tileH: 16, tileD: 16, lightK: 1024, lightMode: "uniform" });
    const s = allocState3(cfg);
    const n = cellCount(cfg);
    const w = world();
    w.box(8, 8, 8, 2);
    for (let i = 0; i < n; i++) s.cells[CH.P * n + i] = w.P[i];
    const i = w.at(8, 8, 8);
    s.cells[CH.B * n + i] = 21;
    s.genome[G.LIN_LO * n + i] = 1;
    expect(enclosureCensus3({ cfg, cells: s.cells, genomeHead: s.genome }, { shell: SHELL })).toMatchObject({ enclosures: 1, enclosedBiomass: 21, bodies: 1 });
    expect(() => enclosureCensus3({ cfg: defaultConfig(), cells: s.cells, genomeHead: s.genome }, { shell: SHELL })).toThrow(/slab/);
  });
});
