// Enclosure census of a slab state (step A4 of docs/3d-expansion-plan-2026-11-15.md): living bodies, and living biomass
// inside closed polymer shells, the "cells with insides" signal. Descriptive only.
//
// Cell index i = z*W*H + y*W + x; x and y wrap, z is closed (layer 0 the surface, D - 1 the floor). Definitions:
// - living: lineage id nonzero. Bodies are the 26-connected components of living cells.
// - shell: a cell with P >= `shell`. Open space is every other cell.
// - outside: open space reachable through face (6-connected) steps from an open cell on the surface or floor layer. Face
//   steps are what dissolved matter takes (six-direction diffusion), so a shell whose cells touch only along edges or
//   corners still holds, and a gap one face wide leaks. The z walls are not shell: a cup pressed against the surface or
//   the floor is open, because its inside touches a wall layer. The shell has to close by itself.
// - pocket: a 6-connected component of open space that is not outside. A pocket that wraps around the torus in x or y
//   (two polymer lids spanning the jar, with a band of water between them) is reported apart as `bands`, because
//   carpets make those without enclosing anything in the sense meant here. Every other pocket is bounded.
// - enclosure: a bounded pocket that holds at least one living open cell with B > 0. Its biomass is the B of those cells.
//
// Memory is a few arrays of n words (marks, queue, two offsets), about 4 MB at 64^3; one pass per flood.

import { CH, G, cellCount, isSlab, worldH, worldW } from "@bl/schema";
import type { CensusInput } from "./census.ts";

export interface EnclosureOptions {
  /** A cell with P >= shell is shell (polymer wall). */
  shell: number;
}

export interface EnclosureStat {
  /** Open cells in the pocket. */
  cells: number;
  /** Living open cells with B > 0 in it. */
  living: number;
  /** Their B. */
  biomass: number;
}

export interface EnclosureCensus {
  /** 26-connected components of living cells, and the size of the largest (cells). */
  bodies: number;
  largestBody: number;
  shellCells: number;
  /** Bounded pockets, with or without life. */
  pockets: number;
  /** Bounded pockets holding living biomass. */
  enclosures: number;
  enclosedBiomass: number;
  enclosedLiving: number;
  /** The enclosure with the most biomass, or null. */
  largest: EnclosureStat | null;
  /** Pockets that wrap around x or y (bands between spanning lids), and the living biomass in them. */
  bands: number;
  bandBiomass: number;
}

export function enclosureCensus3(inp: Pick<CensusInput, "cfg" | "cells" | "genomeHead">, opt: EnclosureOptions): EnclosureCensus {
  const { cfg, cells, genomeHead } = inp;
  if (!isSlab(cfg)) throw new Error("enclosureCensus3 needs a slab config (tileD set)");
  const W = worldW(cfg), H = worldH(cfg), D = cfg.tileD!, n = cellCount(cfg);
  return enclosureCensusRaw(W, H, D, (i) => cells[CH.P * n + i], (i) => cells[CH.B * n + i], (i) => (genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) !== 0, opt);
}

/** The census on plain accessors (for tests and other layouts): P, B and living of cell i. */
export function enclosureCensusRaw(
  W: number, H: number, D: number,
  P: (i: number) => number, B: (i: number) => number, living: (i: number) => boolean,
  opt: EnclosureOptions,
): EnclosureCensus {
  const WH = W * H, n = WH * D;
  const shell = new Uint8Array(n);
  let shellCells = 0;
  for (let i = 0; i < n; i++) if (P(i) >= opt.shell) { shell[i] = 1; shellCells++; }
  const queue = new Int32Array(n);
  // mark: 0 unvisited, 1 outside, 2 visited pocket / body
  const mark = new Uint8Array(n);

  // Bodies: 26-connected living cells.
  let bodies = 0, largestBody = 0;
  for (let s = 0; s < n; s++) {
    if (mark[s] || !living(s)) continue;
    bodies++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; mark[s] = 2;
    while (head < tail) {
      const i = queue[head++]; size++;
      const x = i % W, y = Math.floor((i % WH) / W), z = Math.floor(i / WH);
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= D) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = (y + dy + H) % H;
          for (let dx = -1; dx <= 1; dx++) {
            const j = zz * WH + yy * W + ((x + dx + W) % W);
            if (!mark[j] && living(j)) { mark[j] = 2; queue[tail++] = j; }
          }
        }
      }
    }
    if (size > largestBody) largestBody = size;
  }
  mark.fill(0);

  // Outside: face flood through open cells from the surface and floor layers.
  let head = 0, tail = 0;
  for (const z of D > 1 ? [0, D - 1] : [0])
    for (let k = 0; k < WH; k++) {
      const i = z * WH + k;
      if (!shell[i] && !mark[i]) { mark[i] = 1; queue[tail++] = i; }
    }
  const faces = (i: number, visit: (j: number, ox: number, oy: number) => void) => {
    const x = i % W, y = Math.floor((i % WH) / W), z = Math.floor(i / WH), base = i - x - y * W;
    visit(base + y * W + ((x + 1) % W), 1, 0);
    visit(base + y * W + ((x + W - 1) % W), -1, 0);
    visit(base + ((y + 1) % H) * W + x, 0, 1);
    visit(base + ((y + H - 1) % H) * W + x, 0, -1);
    if (z + 1 < D) visit(i + WH, 0, 0);
    if (z > 0) visit(i - WH, 0, 0);
  };
  while (head < tail) faces(queue[head++], (j) => { if (!shell[j] && !mark[j]) { mark[j] = 1; queue[tail++] = j; } });

  // Pockets: the remaining open space, face-connected. Unwrapped offsets detect a pocket that wraps around x or y.
  const offX = new Int32Array(n), offY = new Int32Array(n);
  let pockets = 0, enclosures = 0, enclosedBiomass = 0, enclosedLiving = 0, bands = 0, bandBiomass = 0;
  let largest: EnclosureStat | null = null;
  for (let s = 0; s < n; s++) {
    if (shell[s] || mark[s]) continue;
    head = 0; tail = 0;
    queue[tail++] = s; mark[s] = 2; offX[s] = 0; offY[s] = 0;
    let wraps = false;
    const st: EnclosureStat = { cells: 0, living: 0, biomass: 0 };
    while (head < tail) {
      const i = queue[head++];
      st.cells++;
      if (living(i) && B(i) > 0) { st.living++; st.biomass += B(i); }
      faces(i, (j, ox, oy) => {
        if (shell[j]) return;
        const nx = offX[i] + ox, ny = offY[i] + oy;
        if (!mark[j]) { mark[j] = 2; offX[j] = nx; offY[j] = ny; queue[tail++] = j; }
        else if (offX[j] !== nx || offY[j] !== ny) wraps = true;
      });
    }
    if (wraps) { bands++; bandBiomass += st.biomass; continue; }
    pockets++;
    if (st.living === 0) continue;
    enclosures++;
    enclosedBiomass += st.biomass;
    enclosedLiving += st.living;
    if (!largest || st.biomass > largest.biomass) largest = st;
  }
  return { bodies, largestBody, shellCells, pockets, enclosures, enclosedBiomass, enclosedLiving, largest, bands, bandBiomass };
}
