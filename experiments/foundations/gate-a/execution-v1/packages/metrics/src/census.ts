// Census of a world state: lineages (genome identity) and individuals
// (connected bound-mass components). Individuals are inferred from the
// dynamics; nothing in the simulator declares them.

import { CH, G, cellCount, worldW, type WorldConfig } from "@bl/schema";

export interface Component {
  /** Index into Census.components. */
  idx: number;
  cells: number;
  mass: number;
  biomass: number;
  /** Centroid in world coordinates (torus-aware within the tile). */
  cx: number;
  cy: number;
  tile: number;
  /** Most common lineage key among the component's cells. */
  lineage: string;
  /** Share of cells carrying the dominant lineage. */
  purity: number;
  /** Mean Lenia growth parameters of the component's genomes. */
  mu: number;
  sigma: number;
}

export interface LineageStat {
  key: string;
  cells: number;
  mass: number;
}

export interface Census {
  step: number;
  /** Per-cell component label (-1 for background). */
  labels: Int32Array;
  components: Component[];
  lineages: LineageStat[];
  livingCells: number;
}

export interface CensusInput {
  cfg: WorldConfig;
  step: number;
  /** Full cell channels (channel-major). */
  cells: Uint32Array;
  /** Genome channels 0..3 at least (LIN_HI, LIN_LO, PARAM0, PARAM1), channel-major. */
  genomeHead: Uint32Array;
}

export interface CensusOptions {
  /** Minimum B+P for a cell to belong to an individual. */
  threshold: number;
  /** Minimum component mass to count as an individual. */
  minMass: number;
}

export const DEFAULT_CENSUS: CensusOptions = { threshold: 48, minMass: 256 };

export function census(inp: CensusInput, opt: CensusOptions = DEFAULT_CENSUS): Census {
  const { cfg, cells, genomeHead } = inp;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const { tileW, tileH } = cfg;
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
    const sy = Math.floor(start / W);
    const tx = Math.floor(sx / tileW);
    const ty = Math.floor(sy / tileH);
    let cellsN = 0, m = 0, bio = 0, ax = 0, ay = 0, mu = 0, sigma = 0, gcount = 0;
    const counts = new Map<string, number>();
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = Math.floor(i / W);
      const mi = mass(i);
      cellsN++;
      m += mi;
      bio += cells[CH.B * n + i];
      ax += offX[i] * mi;
      ay += offY[i] * mi;
      const k = lin(i);
      if (k) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const p0 = genomeHead[G.PARAM0 * n + i];
        mu += p0 & 0xffff;
        sigma += p0 >>> 16;
        gcount++;
      }
      const lx = x - tx * tileW;
      const ly = y - ty * tileH;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const nx = tx * tileW + ((lx + dx + tileW) % tileW);
        const ny = ty * tileH + ((ly + dy + tileH) % tileH);
        const j = ny * W + nx;
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
    const wrap = (v: number, lo: number, size: number) => lo + ((((v - lo) % size) + size) % size);
    components.push({
      idx,
      cells: cellsN,
      mass: m,
      biomass: bio,
      cx: wrap(sx + (m ? ax / m : 0), tx * tileW, tileW),
      cy: wrap(sy + (m ? ay / m : 0), ty * tileH, tileH),
      tile: ty * cfg.tilesX + tx,
      lineage: best,
      purity: cellsN ? bestN / cellsN : 0,
      mu: gcount ? mu / gcount : 0,
      sigma: gcount ? sigma / gcount : 0,
    });
  }

  const lineages = [...linStats.values()].sort((a, b) => b.mass - a.mass);
  return { step: inp.step, labels, components, lineages, livingCells: living };
}

export function individuals(c: Census, opt: CensusOptions = DEFAULT_CENSUS): Component[] {
  return c.components.filter((k) => k.mass >= opt.minMass);
}
