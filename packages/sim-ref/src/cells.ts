// Declared cells (WorldConfig.cellPeriod, cells sandbox; absent = RULE_VERSION 1).
//
// A cell is declared, not inferred: it is a connected body of one lineage id,
// and an id names exactly one cell. The pass below restores that between
// steps. Its boundary is the census's: 4-connected sites of one id, each
// holding B + P >= CELL_THRESHOLD, inside one tile, with total bound mass
// >= CELL_MIN_MASS. Its division rule: when one id has several such bodies,
// the heaviest keeps the id and every other body is a daughter. A daughter
// gets a fresh id (the pass's step, its lowest site index) and, with
// probability cellMutProb / 2^32, one mutation (mutateInPlace), written to
// all of its sites. In-step mutation is off (validateConfig requires
// mutRate 0), so a genome changes only at a cell's birth and every site of a
// body carries the same genome. Only genome channels are written: matter and
// the energy ledger are untouched. Anything made of several cells is still
// never declared.
//
// A host-side transform between steps, like migration: the runner applies it
// at census boundaries where cellPeriod divides the absolute step
// (packages/runner/src/migrate.ts), to the state read back from the GPU.
import { CH, G, GENOME_CHANNELS, cellBase, cellCount, draw, packLineageLo, worldW, type WorldState } from "@bl/schema";
import { mutateInPlace } from "./step.ts";

/** Minimum B + P for a site to belong to a cell (the census's threshold). */
export const CELL_THRESHOLD = 48;
/** Minimum bound mass of a cell (the census's individual). */
export const CELL_MIN_MASS = 256;
/** Domain separation for the pass's draws (keyed on seed ^ salt, step, anchor site), apart from the physics streams. */
export const CELL_SEED_SALT = 0x43454c4c; // ASCII "CELL"

export interface CellBirth {
  /** The absolute step of the pass. */
  step: number;
  childHi: number;
  childLo: number;
  parentHi: number;
  parentLo: number;
  /** The daughter's lowest site index. */
  anchor: number;
  cells: number;
  mass: number;
  /** Whether the daughter's genome differs from its parent's. */
  mutated: boolean;
}

export interface CellBody {
  hi: number;
  lo: number;
  /** The body's lowest site index. */
  anchor: number;
  cells: number;
  mass: number;
  /** The body's sites, the anchor first. */
  sites: Int32Array;
}

/**
 * The bodies the pass sees, in anchor order: 4-connected sites of one id, each with B + P >=
 * CELL_THRESHOLD, inside one tile, with total bound mass >= CELL_MIN_MASS. Does not need cellPeriod.
 */
export function cellBodies(state: WorldState): CellBody[] {
  const cfg = state.cfg;
  const n = cellCount(cfg), W = worldW(cfg), { tileW, tileH } = cfg;
  const { cells, genome } = state;
  const mass = (i: number) => cells[CH.B * n + i] + cells[CH.P * n + i];
  const label = new Uint8Array(n);
  const queue = new Int32Array(n);
  const bodies: CellBody[] = [];
  let tail = 0;
  for (let start = 0; start < n; start++) {
    if (label[start]) continue;
    const hi = genome[G.LIN_HI * n + start], lo = genome[G.LIN_LO * n + start];
    if ((hi | lo) === 0 || mass(start) < CELL_THRESHOLD) continue;
    const from = tail;
    let head = tail, m = 0;
    queue[tail++] = start;
    label[start] = 1;
    const tx = Math.floor((start % W) / tileW), ty = Math.floor(Math.floor(start / W) / tileH);
    while (head < tail) {
      const i = queue[head++];
      m += mass(i);
      const lx = (i % W) - tx * tileW, ly = Math.floor(i / W) - ty * tileH;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const j = (ty * tileH + ((ly + dy + tileH) % tileH)) * W + tx * tileW + ((lx + dx + tileW) % tileW);
        if (label[j] || genome[G.LIN_HI * n + j] !== hi || genome[G.LIN_LO * n + j] !== lo || mass(j) < CELL_THRESHOLD) continue;
        label[j] = 1;
        queue[tail++] = j;
      }
    }
    if (m >= CELL_MIN_MASS) bodies.push({ hi, lo, anchor: start, cells: tail - from, mass: m, sites: queue.slice(from, tail) });
  }
  return bodies;
}

/** Applies the declared-cell pass to `state` in place (genome channels only) and returns the births, in anchor order. */
export function applyCellPass(state: WorldState): CellBirth[] {
  const cfg = state.cfg;
  // A daughter's id is (state.step, anchor): the id an in-step mutation at that site would have
  // minted during the step just finished, which mutRate 0 rules out in a history run under this
  // config, and the latest id validateState accepts at this step. Step 0 has no such id (hi 0 names
  // founders), so no pass there. A state that already holds an id of this step (one this pass did
  // not mint: an import, or a state from another config) could collide, so that is refused below.
  if (cfg.cellPeriod === undefined || state.step === 0) return [];
  const n = cellCount(cfg);
  const { genome } = state;
  const bodies = cellBodies(state);
  // The heaviest body of each id keeps it (ties: the lowest anchor, which comes first).
  const keeper = new Map<string, number>();
  bodies.forEach((b, k) => {
    const key = `${b.hi}:${b.lo}`, cur = keeper.get(key);
    if (cur === undefined || b.mass > bodies[cur].mass) keeper.set(key, k);
  });
  const daughters = bodies.filter((b, k) => keeper.get(`${b.hi}:${b.lo}`) !== k);
  if (!daughters.length) return [];
  const childHi = state.step >>> 0;
  const taken = new Set<number>();
  for (let i = 0; i < n; i++) if (genome[G.LIN_HI * n + i] === childHi) taken.add(genome[G.LIN_LO * n + i]);
  const births: CellBirth[] = [];
  const words = new Uint32Array(GENOME_CHANNELS);
  const prob = cfg.cellMutProb ?? 0;
  for (const b of daughters) {
    const anchor = b.anchor;
    const childLo = packLineageLo(cfg, anchor);
    if (taken.has(childLo)) throw new Error(`cell pass at t=${state.step}: id ${childHi}:${childLo} is already in use`);
    for (let g = 0; g < GENOME_CHANNELS; g++) words[g] = genome[g * n + anchor];
    const base = cellBase((cfg.seed ^ CELL_SEED_SALT) >>> 0, state.step, anchor);
    let mutated = false;
    if (draw(base, 0) < prob) {
      const before = words.slice();
      mutateInPlace(words, 1, 0, cfg, draw(base, 1), draw(base, 2));
      mutated = words.some((w, g) => w !== before[g]);
    }
    words[G.LIN_HI] = childHi;
    words[G.LIN_LO] = childLo;
    for (const site of b.sites) for (let g = 0; g < GENOME_CHANNELS; g++) genome[g * n + site] = words[g];
    births.push({ step: state.step, childHi, childLo, parentHi: b.hi, parentLo: b.lo, anchor, cells: b.cells, mass: b.mass, mutated });
  }
  return births;
}
