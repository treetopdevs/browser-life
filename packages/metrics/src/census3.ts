// Census of a slab state (rung 1b, docs/3d-rung1b-plan-2026-10-23.md section 2): lineages and individuals of a
// W x H x D world (cell index i = z*W*H + y*W + x), and the per-layer activity sums of the role buffer. The same
// `Census` shape as `census()`, so the tracker and the activity tracker consume it unchanged. Individuals are the
// 6-connected components of cells with B + P >= threshold: x and y wrap within the tile as the dynamics do, z does not
// (the slab is closed above and below).

import { CH, G, ROLE_WORDS, cellCount, isSlab, worldH, worldW, type WorldConfig } from "@bl/schema";
import { DEFAULT_CENSUS, type Census, type CensusInput, type CensusOptions, type Component, type LineageStat } from "./census.ts";

export function census3(inp: CensusInput, opt: CensusOptions = DEFAULT_CENSUS): Census {
  const { cfg, cells, genomeHead } = inp;
  if (!isSlab(cfg)) throw new Error("census3 needs a slab config (tileD set)");
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD!;
  const WH = W * H;
  const labels = new Int32Array(n).fill(-1);
  const mass = (i: number) => cells[CH.B * n + i] + cells[CH.P * n + i];
  const lin = (i: number) => {
    const hi = genomeHead[G.LIN_HI * n + i];
    const lo = genomeHead[G.LIN_LO * n + i];
    return hi | lo ? `${hi}:${lo}` : "";
  };

  const linStats = new Map<string, LineageStat>();
  let living = 0;
  for (let i = 0; i < n; i++) {
    const k = lin(i);
    if (!k) continue;
    living++;
    let s = linStats.get(k);
    if (!s) linStats.set(k, (s = { key: k, cells: 0, mass: 0 }));
    s.cells++;
    s.mass += mass(i);
  }

  const components: Component[] = [];
  const queue = new Int32Array(n);
  const offX = new Int32Array(n);
  const offY = new Int32Array(n);
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || mass(start) < opt.threshold) continue;
    const idx = components.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = idx;
    offX[start] = 0;
    offY[start] = 0;
    const sx = start % W;
    const sy = Math.floor((start % WH) / W);
    let cellsN = 0, m = 0, bio = 0, ax = 0, ay = 0, az = 0, mu = 0, sigma = 0, gcount = 0;
    const counts = new Map<string, number>();
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = Math.floor((i % WH) / W);
      const z = Math.floor(i / WH);
      const mi = mass(i);
      cellsN++;
      m += mi;
      bio += cells[CH.B * n + i];
      ax += offX[i] * mi;
      ay += offY[i] * mi;
      az += z * mi;
      const k = lin(i);
      if (k) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const p0 = genomeHead[G.PARAM0 * n + i];
        mu += p0 & 0xffff;
        sigma += p0 >>> 16;
        gcount++;
      }
      for (let d = 0; d < 6; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const dz = d === 4 ? 1 : d === 5 ? -1 : 0;
        const nz = z + dz;
        if (nz < 0 || nz >= D) continue;
        const nx = (x + dx + W) % W;
        const ny = (y + dy + H) % H;
        const j = nz * WH + ny * W + nx;
        if (labels[j] !== -1 || mass(j) < opt.threshold) continue;
        labels[j] = idx;
        offX[j] = offX[i] + dx;
        offY[j] = offY[i] + dy;
        queue[tail++] = j;
      }
    }
    let best = "";
    let bestN = 0;
    for (const [k, c] of counts) if (c > bestN) [best, bestN] = [k, c];
    components.push({
      idx,
      cells: cellsN,
      mass: m,
      biomass: bio,
      cx: wrap(sx + (m ? ax / m : 0), W),
      cy: wrap(sy + (m ? ay / m : 0), H),
      cz: m ? az / m : 0,
      tile: 0,
      lineage: best,
      purity: cellsN ? bestN / cellsN : 0,
      mu: gcount ? mu / gcount : 0,
      sigma: gcount ? sigma / gcount : 0,
    });
  }

  const lineages = [...linStats.values()].sort((a, b) => b.mass - a.mass);
  return { step: inp.step, labels, components, lineages, livingCells: living };
}

/** Sums of the last step's reaction counts over one layer of the slab, and how many 16-bit count fields sit at their cap. */
export interface LayerRoles {
  z: number;
  photo: number;
  grow: number;
  decomp: number;
  resp: number;
  /** Count fields (photo, grow, decomp, resp of every cell) equal to 65,535 in this layer. Reported, never corrected. */
  saturated: number;
}

/**
 * Per-layer sums of the role buffer (`roles`, cell-major: word 0 = photo | grow << 16, word 1 = decomp | resp << 16).
 * Plain numbers: a layer has at most 65,536 cells of at most 65,535 each, far below 2^53, so the sums are exact.
 */
export function layerRoles(cfg: WorldConfig, roles: Uint32Array): LayerRoles[] {
  if (!isSlab(cfg)) throw new Error("layerRoles needs a slab config (tileD set)");
  const D = cfg.tileD!;
  const WH = worldW(cfg) * worldH(cfg);
  if (roles.length !== cellCount(cfg) * ROLE_WORDS) throw new Error(`layerRoles: roles has ${roles.length} words, expected ${cellCount(cfg) * ROLE_WORDS}`);
  const out: LayerRoles[] = [];
  for (let z = 0; z < D; z++) {
    let photo = 0, grow = 0, decomp = 0, resp = 0, saturated = 0;
    for (let i = z * WH; i < (z + 1) * WH; i++) {
      const a = roles[i * ROLE_WORDS];
      const b = roles[i * ROLE_WORDS + 1];
      const p = a & 0xffff, g = a >>> 16, d = b & 0xffff, r = b >>> 16;
      photo += p;
      grow += g;
      decomp += d;
      resp += r;
      if (p === 0xffff) saturated++;
      if (g === 0xffff) saturated++;
      if (d === 0xffff) saturated++;
      if (r === 0xffff) saturated++;
    }
    out.push({ z, photo, grow, decomp, resp, saturated });
  }
  return out;
}

/** The header of a slab bundle's layers.tsv. */
export const LAYERS_HEADER = "step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated\n";

/** One line per layer, ascending z, for the census at `step`. */
export function layersRows(step: number, rows: readonly LayerRoles[]): string {
  return rows.map((r) => `${step}\t${r.z}\t${r.photo}\t${r.grow}\t${r.decomp}\t${r.resp}\t${r.saturated}\n`).join("");
}
