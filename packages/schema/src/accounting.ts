import { cellCount, type WorldConfig } from "./config.ts";
import { CH, G, GENOME_CHANNELS } from "./layout.ts";
import type { WorldState } from "./world.ts";

export interface Totals {
  A: bigint;
  B: bigint;
  C: bigint;
  P: bigint;
  E: bigint;
  S: bigint;
  matter: bigint;
  /** Chemical potential + free pools + signal. */
  energy: bigint;
  living: number;
}

export function sumChannel(cells: Uint32Array, n: number, ch: number): bigint {
  let acc = 0;
  let big = 0n;
  const end = (ch + 1) * n;
  for (let i = ch * n; i < end; i++) {
    acc += cells[i];
    if (acc > 2 ** 50) {
      big += BigInt(acc);
      acc = 0;
    }
  }
  return big + BigInt(acc);
}

export function totalsOf(cfg: WorldConfig, cells: Uint32Array): Omit<Totals, "living"> {
  const n = cellCount(cfg);
  const A = sumChannel(cells, n, CH.A);
  const B = sumChannel(cells, n, CH.B);
  const C = sumChannel(cells, n, CH.C);
  const P = sumChannel(cells, n, CH.P);
  const E = sumChannel(cells, n, CH.E);
  const S = sumChannel(cells, n, CH.S);
  const energy = BigInt(cfg.eA) * A + BigInt(cfg.eB) * B + BigInt(cfg.eC) * C + BigInt(cfg.eP) * P + E + S;
  return { A, B, C, P, E, S, matter: A + B + C + P, energy };
}

/**
 * Energy ledger residual: (content now + heat exported) - (content at start + light absorbed).
 * Exactly zero when the rules conserve energy.
 */
export function ledgerResidual(start: { energy: bigint }, s: WorldState): bigint {
  const now = totalsOf(s.cfg, s.cells);
  return now.energy + s.heatOut - (start.energy + s.lightIn);
}

/** Order-dependent 64-bit digest of a word array, as 16 hex chars. */
export function digestWords(words: Uint32Array, h1 = 0x811c9dc5, h2 = 0x01000193): [number, number] {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    h1 = Math.imul(h1 ^ w, 0x85ebca6b) >>> 0;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h2 = Math.imul(h2 + w + i, 0xc2b2ae35) >>> 0;
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  }
  return [h1, h2];
}

/**
 * Genome words of empty cells (lineage 0:0) are never read by the rules and
 * may hold stale data; the canonical form zeroes them.
 */
export function canonicalGenome(genome: Uint32Array): Uint32Array {
  const n = genome.length / GENOME_CHANNELS;
  let dirty = false;
  for (let i = 0; i < n && !dirty; i++)
    if ((genome[G.LIN_HI * n + i] | genome[G.LIN_LO * n + i]) === 0)
      for (let g = 2; g < GENOME_CHANNELS; g++) if (genome[g * n + i] !== 0) { dirty = true; break; }
  if (!dirty) return genome;
  const out = genome.slice();
  for (let i = 0; i < n; i++)
    if ((out[G.LIN_HI * n + i] | out[G.LIN_LO * n + i]) === 0) for (let g = 2; g < GENOME_CHANNELS; g++) out[g * n + i] = 0;
  return out;
}

/** Config serialised with sorted keys (stable across key order). */
export function canonicalConfig(c: WorldState["cfg"]): string {
  const o = c as unknown as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

const u64Words = (v: bigint) => [Number(v & 0xffffffffn), Number((v >> 32n) & 0xffffffffn)];

/**
 * Canonical 64-bit digest of every persistent field: config, step, cells,
 * canonical genome and the full ledger (light, heat, fluxes). Used for pinned
 * hashes, checkpoint manifests, segment start checks and replay verification.
 */
export function stateHash(s: WorldState): string {
  const cfg = new TextEncoder().encode(canonicalConfig(s.cfg));
  const cfgWords = new Uint32Array(Math.ceil(cfg.length / 4));
  new Uint8Array(cfgWords.buffer).set(cfg);
  let [a, b] = digestWords(Uint32Array.of(cfg.length, ...cfgWords));
  [a, b] = digestWords(Uint32Array.of(s.step, ...u64Words(s.lightIn), ...u64Words(s.heatOut), ...s.flux.flatMap(u64Words)), a, b);
  [a, b] = digestWords(s.cells, a, b);
  [a, b] = digestWords(canonicalGenome(s.genome), a, b);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
