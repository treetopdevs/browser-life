// The genotype core of the lineage inspector (docs/lineage-inspector.md): lineage keys, ancestry over
// mutation edges, exact genome replay of each mutation, and the controller probe. A lineage id is
// (birth step + 1, birth cell) and its genome is immutable, so a child's genome is `mutateInPlace`
// applied to its parent's with the draws keyed on (seed, birth step, birth cell). Pure: shared by the
// dossier tool (tools/lib/lineage.ts) and the lab worker.
import {
  B1_OFF,
  B2_OFF,
  G,
  GENOME_CHANNELS,
  NN_BYTES,
  NN_H,
  NN_I,
  NN_O,
  RING_CELL_MASK,
  RND,
  W2_OFF,
  cellBase,
  cellCount,
  draw,
  shapeRings,
  worldW,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { CELL_SEED_SALT, controllerForward, mutateInPlace } from "@bl/sim-ref";

export type Key = string;

const SLOTS = NN_BYTES + 3;
const INPUTS = ["A", "B", "C", "P", "E/B", "light", "S", "∇Sx", "∇Sy", "U"] as const;
export const OUTPUTS = ["photo", "resp", "decomp", "grow", "build", "emit", "moveX", "moveY"] as const;

export const parseKey = (key: Key): [number, number] => {
  const m = /^(\d+):(\d+)$/.exec(key);
  if (!m) throw new Error(`not a lineage key: ${key}`);
  return [Number(m[1]), Number(m[2])];
};
/** Orders keys by birth step, then birth cell (founders, hi 0, first). */
export const byBirth = (a: Key, b: Key): number => {
  const [ah, al] = parseKey(a), [bh, bl] = parseKey(b);
  return ah - bh || al - bl;
};

/** Where and when a lineage was minted. Founders (hi 0) carry their founder index instead. */
export function decodeKey(key: Key, cfg: WorldConfig): { founder: number } | { minted: number; cell: number; x: number; y: number; tile: number } {
  const [hi, lo] = parseKey(key);
  const raw = cfg.ringNamespace === undefined ? lo : lo & RING_CELL_MASK;
  if (hi === 0) return { founder: raw - 1 };
  const W = worldW(cfg), x = raw % W, y = Math.floor(raw / W);
  return { minted: hi - 1, cell: raw, x, y, tile: Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW) };
}

// ---- Ancestry -----------------------------------------------------------------------------------

/** The subject's ancestry, root first. The root is the first key with no parent row. Throws on a cycle. */
export function ancestry(subject: Key, parent: Map<Key, Key>): Key[] {
  const chain: Key[] = [];
  const seen = new Set<Key>();
  for (let k: Key | undefined = subject; k !== undefined; k = parent.get(k)) {
    if (seen.has(k)) throw new Error(`mutations.tsv parent links form a cycle at ${k}`);
    seen.add(k);
    chain.push(k);
  }
  return chain.reverse();
}

/**
 * Every lineage descending from `subject` (excluding it), independent of row order. A parent is
 * always minted at an earlier step than its child (`readMutationLog` enforces it; checked here
 * too), so a walk stops once it reaches the subject's birth step; walks are memoised.
 */
export function descendants(subject: Key, parent: Map<Key, Key>): Set<Key> {
  const [sHi] = parseKey(subject);
  const memo = new Map<Key, boolean>([[subject, true]]);
  const out = new Set<Key>();
  for (const child of parent.keys()) {
    if (parseKey(child)[0] <= sHi) continue;
    const path: Key[] = [];
    let k: Key | undefined = child, hit = false, below = Infinity;
    while (k !== undefined) {
      const m = memo.get(k);
      if (m !== undefined) {
        hit = m;
        break;
      }
      const hi = parseKey(k)[0];
      if (hi >= below) throw new Error(`parent links are not ordered by birth step at ${k}`);
      if (hi <= sHi) break;
      below = hi;
      path.push(k);
      k = parent.get(k);
    }
    for (const p of path) {
      memo.set(p, hit);
      if (hit) out.add(p);
    }
  }
  return out;
}

// ---- Genomes and mutations ----------------------------------------------------------------------

const signed = (b: number) => (b > 127 ? b - 256 : b);
const byteOf = (w: Uint32Array, b: number) => signed((w[G.W0 + (b >> 2)] >>> ((b & 3) * 8)) & 0xff);

export type LocusKind = "w1" | "b1" | "w2" | "b2" | "mu" | "sigma" | "gain" | "ring";

/**
 * The genome slot `mutateInPlace` changes for slot index `slot` (0 .. NN_BYTES + 2, then one slot per
 * kernel ring under WorldConfig.shapeReach).
 */
export function locusOf(slot: number): { kind: LocusKind; label: string } {
  if (slot < B1_OFF) return { kind: "w1", label: `${INPUTS[Math.floor(slot / NN_H)]}→h${slot % NN_H}` };
  if (slot < W2_OFF) return { kind: "b1", label: `bias h${slot - B1_OFF}` };
  if (slot < B2_OFF) return { kind: "w2", label: `h${Math.floor((slot - W2_OFF) / NN_O)}→${OUTPUTS[(slot - W2_OFF) % NN_O]}` };
  if (slot < NN_BYTES) return { kind: "b2", label: `bias ${OUTPUTS[slot - B2_OFF]}` };
  if (slot === NN_BYTES) return { kind: "mu", label: "μ" };
  if (slot === NN_BYTES + 1) return { kind: "sigma", label: "σ" };
  if (slot === NN_BYTES + 2) return { kind: "gain", label: "motility gain" };
  return { kind: "ring", label: `ring ${slot - (NN_BYTES + 3)} weight offset` };
}

export function slotValue(w: Uint32Array, slot: number): number {
  if (slot < NN_BYTES) return byteOf(w, slot);
  if (slot === NN_BYTES) return w[G.PARAM0] & 0xffff;
  if (slot === NN_BYTES + 1) return w[G.PARAM0] >>> 16;
  if (slot === NN_BYTES + 2) return w[G.PARAM1] & 0xff;
  return signed((w[G.PARAM1] >>> (8 * (slot - (NN_BYTES + 2)))) & 0xff);
}

export interface Mutation {
  child: Key;
  parent: Key;
  /** The step whose react phase minted the child (child hi - 1). */
  step: number;
  cell: number;
  slot: number;
  kind: LocusKind;
  locus: string;
  before: number;
  after: number;
  /** Clamping left the genome unchanged; a new id is minted regardless. */
  clamped: boolean;
  /**
   * Declared cells (WorldConfig.cellPeriod): the child is a daughter body given its id by the pass at
   * the boundary that ends `step` (so at step hi), at its anchor `cell`. `mutated` is whether the pass's
   * draw mutated it at all; when it did not, the genome is the parent's and `clamped` is true.
   */
  cellBirth?: { mutated: boolean };
}

/** The child's genome words and its mutation, recomputed from the counter PRNG exactly as `react` draws it. */
/** Where and in which genome slot the mutation that minted `child` struck: known from the draws alone, without the parent's genome. */
export function mutationSite(child: Key, cfg: WorldConfig): { step: number; cell: number; slot: number; kind: LocusKind; locus: string; which: number; delta: number; cellBirth?: { mutated: boolean } } {
  const [hi, lo] = parseKey(child);
  if (hi === 0) throw new Error(`${child} is a founder, not a mutant`);
  const cell = cfg.ringNamespace === undefined ? lo : lo & RING_CELL_MASK;
  if (cfg.cellPeriod !== undefined) {
    // Declared cells: every id past the founders is a daughter minted by applyCellPass (@bl/sim-ref) at
    // step hi, anchored at `cell`, from the pass's own salted draws: 0 decides whether it mutates at all,
    // 1 and 2 are mutateInPlace's `which` and `deltaRnd`.
    const base = cellBase((cfg.seed ^ CELL_SEED_SALT) >>> 0, hi, cell);
    const which = draw(base, 1);
    const slot = which % (SLOTS + shapeRings(cfg));
    const { kind, label } = locusOf(slot);
    // `step` keeps the convention of in-step mutations (hi - 1, the last step before the lineage exists):
    // the pass runs at the boundary that ends it, and the settled state at step hi is the first to hold the child.
    return { step: hi - 1, cell, slot, kind, locus: label, which, delta: draw(base, 2), cellBirth: { mutated: draw(base, 0) < (cfg.cellMutProb ?? 0) } };
  }
  const step = hi - 1;
  const base = cellBase(cfg.seed, step, cell);
  const which = draw(base, RND.MUT_WHICH);
  const slot = which % (SLOTS + shapeRings(cfg));
  const { kind, label } = locusOf(slot);
  return { step, cell, slot, kind, locus: label, which, delta: draw(base, RND.MUT_DELTA) };
}

export function applyMutation(parentWords: Uint32Array, child: Key, parent: Key, cfg: WorldConfig): { words: Uint32Array; mutation: Mutation } {
  const { step, cell, slot, kind, locus, which, delta, cellBirth } = mutationSite(child, cfg);
  const [hi, lo] = parseKey(child);
  const words = parentWords.slice();
  if (!cellBirth || cellBirth.mutated) mutateInPlace(words, 1, 0, cfg, which, delta);
  words[G.LIN_HI] = hi;
  words[G.LIN_LO] = lo;
  const before = slotValue(parentWords, slot), after = slotValue(words, slot);
  return { words, mutation: { child, parent, step, cell, slot, kind, locus, before, after, clamped: before === after, ...(cellBirth ? { cellBirth } : {}) } };
}

/** Genome words from PARAM0 onwards as hex, the genomes.tsv / genomeHex column. */
export const wordsHex = (w: Uint32Array): string => Array.from(w.subarray(G.PARAM0), (v) => v.toString(16).padStart(8, "0")).join("");

export function wordsFromHex(key: Key, hex: string): Uint32Array {
  if (hex.length !== (GENOME_CHANNELS - G.PARAM0) * 8) throw new Error(`genome of ${key}: expected ${(GENOME_CHANNELS - G.PARAM0) * 8} hex digits, got ${hex.length}`);
  const w = new Uint32Array(GENOME_CHANNELS);
  const [hi, lo] = parseKey(key);
  w[G.LIN_HI] = hi;
  w[G.LIN_LO] = lo;
  for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) w[g] = parseInt(hex.slice((g - G.PARAM0) * 8, (g - G.PARAM0 + 1) * 8), 16) >>> 0;
  return w;
}

/** Genome words of every lineage present in a world state (each lineage's first cell). */
export function genomesOf(s: WorldState, cfg: WorldConfig): Map<Key, Uint32Array> {
  const n = cellCount(cfg);
  const out = new Map<Key, Uint32Array>();
  for (let i = 0; i < n; i++) {
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if (hi === 0 && lo === 0) continue;
    const k = `${hi}:${lo}`;
    if (out.has(k)) continue;
    const w = new Uint32Array(GENOME_CHANNELS);
    for (let g = 0; g < GENOME_CHANNELS; g++) w[g] = s.genome[g * n + i];
    out.set(k, w);
  }
  return out;
}

// ---- Controller probe ---------------------------------------------------------------------------

/**
 * Probe values per sensor (A, B, C, P, E/B, light, S, ∇Sx, ∇Sy, U), in sensor units. A canonical
 * grid, not the inputs a lineage meets: an effect on it is real, but no effect here is not proof of
 * no effect where the lineage lives.
 */
export const PROBE_AXES: readonly (readonly number[])[] = [
  [0, 32, 127], [16, 64, 127], [0, 32, 127], [0, 32], [0, 32, 127], [10, 60, 120], [0, 32], [-16, 0, 16], [-16, 0, 16], [-64, 0, 64],
];
let probeGrid: Int32Array[] | undefined;
function grid(): Int32Array[] {
  if (probeGrid) return probeGrid;
  const out: Int32Array[] = [];
  const x = new Int32Array(NN_I);
  const rec = (d: number) => {
    if (d === NN_I) return void out.push(x.slice());
    for (const v of PROBE_AXES[d]) {
      x[d] = v;
      rec(d + 1);
    }
  };
  rec(0);
  return (probeGrid = out);
}
/** Light curve inputs: light swept 0..127 with the other sensors fixed at these values. */
const CURVE_BASE = [32, 64, 32, 0, 32, 0, 0, 0, 0, 0];

export interface Probe {
  /** Output per grid point (NN_O each); catalytic outputs rectified as `react` uses them. */
  outs: Int16Array;
  meanOut: number[];
  /** Hidden units active anywhere on the grid. */
  activeHidden: number;
  /** Distinct hidden activation patterns (each unit off, linear or saturated) and their entropy in bits. */
  regimes: number;
  regimeEntropy: number;
  /** [light, ...outputs] for light 0, 8, .., 120. */
  lightCurve: number[][];
}

export function probeGenome(w: Uint32Array): Probe {
  const wb = new Int8Array(NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) wb[b] = byteOf(w, b);
  const h = new Int32Array(NN_H), o = new Int32Array(NN_O);
  const g = grid();
  const outs = new Int16Array(g.length * NN_O);
  const sums = new Float64Array(NN_O);
  const patterns = new Uint32Array(3 ** NN_H);
  let active = 0;
  for (let p = 0; p < g.length; p++) {
    controllerForward(wb, g[p], h, o);
    let pat = 0;
    for (let j = 0; j < NN_H; j++) {
      pat = pat * 3 + (h[j] === 0 ? 0 : h[j] === 127 ? 2 : 1);
      if (h[j] > 0) active |= 1 << j;
    }
    patterns[pat]++;
    for (let k = 0; k < NN_O; k++) {
      const v = k < 6 && o[k] < 0 ? 0 : o[k];
      outs[p * NN_O + k] = v;
      sums[k] += v;
    }
  }
  let regimes = 0, H = 0;
  for (const c of patterns) {
    if (!c) continue;
    regimes++;
    const q = c / g.length;
    H -= q * Math.log2(q);
  }
  const lightCurve: number[][] = [];
  const x = Int32Array.from(CURVE_BASE);
  for (let L = 0; L < 128; L += 8) {
    x[5] = L;
    controllerForward(wb, x, h, o);
    lightCurve.push([L, ...Array.from(o, (v, k) => (k < 6 && v < 0 ? 0 : v))]);
  }
  let activeHidden = 0;
  for (let j = 0; j < NN_H; j++) if (active & (1 << j)) activeHidden++;
  return { outs, meanOut: Array.from(sums, (s) => Math.round((10 * s) / g.length) / 10), activeHidden, regimes, regimeEntropy: Math.round(H * 1000) / 1000, lightCurve };
}

/**
 * How a mutation shows: `physics` (μ, σ, motility gain act through affinity and transport, which
 * the controller probe cannot see), `clamped` (no genome change), `controller` (some output moves
 * on the probe grid) or `probe-silent` (a controller byte changed but no output moves on the grid).
 */
export type Expression = "physics" | "clamped" | "controller" | "probe-silent";

export function expressionOf(m: Mutation, before: Probe, after: Probe): { expression: Expression; maxDelta: number[]; changedShare: number[] } {
  const maxDelta = new Array<number>(NN_O).fill(0), changed = new Array<number>(NN_O).fill(0);
  const n = before.outs.length / NN_O;
  for (let i = 0; i < before.outs.length; i++) {
    const d = Math.abs(after.outs[i] - before.outs[i]);
    if (!d) continue;
    const k = i % NN_O;
    changed[k]++;
    if (d > maxDelta[k]) maxDelta[k] = d;
  }
  const expression: Expression = m.clamped ? "clamped" : m.kind === "mu" || m.kind === "sigma" || m.kind === "gain" || m.kind === "ring" ? "physics" : maxDelta.some((d) => d > 0) ? "controller" : "probe-silent";
  return { expression, maxDelta, changedShare: changed.map((c) => Math.round((1000 * c) / n) / 1000) };
}
