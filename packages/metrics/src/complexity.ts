// Held-out complexity observables. None of these is used by any search or
// selection mechanism; they are only measured. Report them side by side:
// compressibility and predictability together distinguish structure from noise.

import { CH, G, cellCount, worldW, type WorldConfig } from "@bl/schema";
import type { Census } from "./census.ts";

/** 2x2-block occupancy symbols (4 bits) on a coarse grid; bound mass >= threshold. */
export function blockSymbols(cfg: WorldConfig, cells: Uint32Array, threshold = 48): Uint8Array {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const H = n / W;
  const bw = W >> 1;
  const bh = H >> 1;
  const out = new Uint8Array(bw * bh);
  const occ = (x: number, y: number) => (cells[CH.B * n + y * W + x] + cells[CH.P * n + y * W + x] >= threshold ? 1 : 0);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      out[y * bw + x] = occ(2 * x, 2 * y) | (occ(2 * x + 1, 2 * y) << 1) | (occ(2 * x, 2 * y + 1) << 2) | (occ(2 * x + 1, 2 * y + 1) << 3);
  return out;
}

/** Shannon entropy (bits/symbol) of a symbol array. */
export function entropy(sym: Uint8Array, k = 16): number {
  const c = new Float64Array(k);
  for (const s of sym) c[s]++;
  let h = 0;
  for (const v of c) if (v > 0) h -= (v / sym.length) * Math.log2(v / sym.length);
  return h;
}

/**
 * Predictive-information proxy: mutual information (bits/block) between the
 * local pattern at time t and at t + Δ at the same location.
 */
export function temporalMI(a: Uint8Array, b: Uint8Array, k = 16): number {
  const joint = new Float64Array(k * k);
  const pa = new Float64Array(k);
  const pb = new Float64Array(k);
  const N = Math.min(a.length, b.length);
  for (let i = 0; i < N; i++) {
    joint[a[i] * k + b[i]]++;
    pa[a[i]]++;
    pb[b[i]]++;
  }
  let mi = 0;
  for (let x = 0; x < k; x++)
    for (let y = 0; y < k; y++) {
      const j = joint[x * k + y];
      if (j > 0) mi += (j / N) * Math.log2((j * N) / (pa[x] * pb[y]));
    }
  return mi;
}

/** Deflate compression ratio (compressed/raw) using the platform stream. */
export async function compressionRatio(bytes: Uint8Array): Promise<number> {
  if (!bytes.length) return 0;
  const cs = new CompressionStream("deflate-raw");
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(cs));
  const out = await res.arrayBuffer();
  return out.byteLength / bytes.length;
}

/** Lineage map quantised to one byte per cell (hash of lineage id; 0 = empty). */
export function lineageBytes(cfg: WorldConfig, genomeHead: Uint32Array): Uint8Array {
  const n = cellCount(cfg);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const hi = genomeHead[G.LIN_HI * n + i];
    const lo = genomeHead[G.LIN_LO * n + i];
    if (hi | lo) out[i] = 1 + ((Math.imul(hi ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(lo, 0xc2b2ae35)) >>> 24) % 255;
  }
  return out;
}

export interface Morphology {
  individuals: number;
  /** Entropy (bits) of the log2 size-class distribution of individuals. */
  sizeEntropy: number;
  /** Mean membrane fraction P/(B+P) of individuals. */
  membraneFraction: number;
  /** Mean within-individual std of cell membrane fraction (internal differentiation). */
  differentiation: number;
  /** Individuals with a membrane-rich rim and a biomass-rich core. */
  compartmentalised: number;
}

export function morphology(cfg: WorldConfig, cells: Uint32Array, c: Census, minMass: number): Morphology {
  const n = cellCount(cfg);
  const inds = c.components.filter((k) => k.mass >= minMass);
  const idx = new Map<number, number>();
  inds.forEach((k, j) => idx.set(k.idx, j));
  const sum = new Float64Array(inds.length);
  const sum2 = new Float64Array(inds.length);
  const cnt = new Float64Array(inds.length);
  const P = new Float64Array(inds.length);
  const M = new Float64Array(inds.length);
  const rimP = new Float64Array(inds.length);
  const rimN = new Float64Array(inds.length);
  const coreP = new Float64Array(inds.length);
  const coreN = new Float64Array(inds.length);
  const W = worldW(cfg);
  for (let i = 0; i < n; i++) {
    const l = c.labels[i];
    if (l < 0) continue;
    const j = idx.get(l);
    if (j === undefined) continue;
    const b = cells[CH.B * n + i];
    const p = cells[CH.P * n + i];
    const f = p / Math.max(1, b + p);
    sum[j] += f;
    sum2[j] += f * f;
    cnt[j]++;
    P[j] += p;
    M[j] += b + p;
    // Rim: any 4-neighbour (tile-local, toroidal) outside the component.
    const x = i % W;
    const y = (i - x) / W;
    const ox = x - (x % cfg.tileW);
    const oy = y - (y % cfg.tileH);
    const at = (dx: number, dy: number) =>
      (oy + ((y - oy + dy + cfg.tileH) % cfg.tileH)) * W + ox + ((x - ox + dx + cfg.tileW) % cfg.tileW);
    const out = c.labels[at(1, 0)] !== l || c.labels[at(-1, 0)] !== l || c.labels[at(0, 1)] !== l || c.labels[at(0, -1)] !== l;
    if (out) {
      rimP[j] += f;
      rimN[j]++;
    } else {
      coreP[j] += f;
      coreN[j]++;
    }
  }
  let diff = 0, mf = 0, comp = 0;
  const classes = new Map<number, number>();
  inds.forEach((k, j) => {
    const mean = sum[j] / Math.max(1, cnt[j]);
    diff += Math.sqrt(Math.max(0, sum2[j] / Math.max(1, cnt[j]) - mean * mean));
    mf += P[j] / Math.max(1, M[j]);
    if (rimN[j] > 0 && coreN[j] > 0 && rimP[j] / rimN[j] > coreP[j] / coreN[j] + 0.15) comp++;
    const cls = Math.floor(Math.log2(Math.max(1, k.mass)));
    classes.set(cls, (classes.get(cls) ?? 0) + 1);
  });
  let se = 0;
  for (const v of classes.values()) se -= (v / inds.length) * Math.log2(v / inds.length);
  return {
    individuals: inds.length,
    sizeEntropy: inds.length ? se : 0,
    membraneFraction: inds.length ? mf / inds.length : 0,
    differentiation: inds.length ? diff / inds.length : 0,
    compartmentalised: comp,
  };
}
