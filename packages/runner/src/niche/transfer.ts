// Exact, audited transfers between the conditioning stage and the assay stage. Every operation is analytical (outside the step
// function), integer, and checked against the budget invariant: lattice + off-lattice reserve + cumulative analytic heat.
//   energy:  lattice.energy + heatOut + heatAnalytic + reserveEnergy  ==  energyStart + lightIn
//   matter:  lattice.matter + reserveB                                ==  matterStart
// `ledgerResidual` counts neither the reserve nor heatAnalytic, so the wrapper below is the audited quantity.
import { CELL_CHANNELS, CH, G, GENOME_CHANNELS, MOT_ZERO, POOL_MAX, cellCount, totalsOf, validateState, type WorldConfig, type WorldState } from "@bl/schema";

export class NicheInvalid extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export interface Audit {
  energyStart: bigint;
  matterStart: bigint;
  /** Receiver reserve still off the lattice: B valued at eB per quantum, E at one. */
  reserveB: number;
  reserveE: number;
  /** Cumulative energy released by analytical conversions, booked as heat. */
  heatAnalytic: bigint;
}

export const reserveEnergy = (cfg: WorldConfig, a: Audit): bigint => BigInt(cfg.eB) * BigInt(a.reserveB) + BigInt(a.reserveE);

export function residuals(s: WorldState, a: Audit): { energy: bigint; matter: bigint } {
  const t = totalsOf(s.cfg, s.cells);
  return {
    energy: t.energy + s.heatOut + a.heatAnalytic + reserveEnergy(s.cfg, a) - a.energyStart - s.lightIn,
    matter: t.matter + BigInt(a.reserveB) - a.matterStart,
  };
}

export function assertAudit(s: WorldState, a: Audit, where: string): void {
  const r = residuals(s, a);
  if (r.energy !== 0n || r.matter !== 0n) throw new NicheInvalid(`${where}: nonzero residual (energy ${r.energy}, matter ${r.matter})`);
}

export function cloneState(s: WorldState, cfg: WorldConfig = s.cfg): WorldState {
  return { cfg, step: s.step, cells: s.cells.slice(), genome: s.genome.slice(), lightIn: s.lightIn, heatOut: s.heatOut, flux: s.flux.slice() };
}
export const cloneAudit = (a: Audit): Audit => ({ ...a });

export interface Snap {
  A: string;
  B: string;
  C: string;
  P: string;
  E: string;
  S: string;
  matter: string;
  energy: string;
  reserveB: number;
  reserveE: number;
  heatAnalytic: string;
  living: number;
}
export function livingCount(s: WorldState): number {
  const n = cellCount(s.cfg);
  let k = 0;
  for (let i = 0; i < n; i++) if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) k++;
  return k;
}
export function snap(s: WorldState, a: Audit): Snap {
  const t = totalsOf(s.cfg, s.cells);
  return { A: `${t.A}`, B: `${t.B}`, C: `${t.C}`, P: `${t.P}`, E: `${t.E}`, S: `${t.S}`, matter: `${t.matter}`, energy: `${t.energy}`, reserveB: a.reserveB, reserveE: a.reserveE, heatAnalytic: `${a.heatAnalytic}`, living: livingCount(s) };
}

export interface TransferRecord {
  op: string;
  before: Snap;
  after: Snap;
  detail: Record<string, number | string>;
  /** Both exactly "0" for a valid record. */
  residual: string;
  matterResidual: string;
}

/** Run one mutation of (s, a) and record before/after; a nonzero residual or a failed validateState throws. */
export function audited(op: string, s: WorldState, a: Audit, fn: () => Record<string, number | string>): TransferRecord {
  assertAudit(s, a, `${op} (before)`);
  const before = snap(s, a);
  const detail = fn();
  const errs = validateState(s);
  if (errs.length) throw new NicheInvalid(`${op}: validateState: ${errs[0]}`);
  const r = residuals(s, a);
  if (r.energy !== 0n || r.matter !== 0n) throw new NicheInvalid(`${op}: nonzero residual (energy ${r.energy}, matter ${r.matter})`);
  return { op, before, after: snap(s, a), detail, residual: `${r.energy}`, matterResidual: `${r.matter}` };
}

/** Split `total` evenly over `cells` (floor share, remainder to the first cells in order) and take it from channel `ch`. */
export function debitEven(s: WorldState, ch: number, total: number, cells: readonly number[]): void {
  if (total === 0) return;
  const m = cells.length;
  if (m === 0) throw new NicheInvalid("no cell can fund the reserve");
  const n = cellCount(s.cfg);
  const base = Math.floor(total / m), rem = total % m;
  for (let j = 0; j < m; j++) {
    const share = base + (j < rem ? 1 : 0);
    if (s.cells[ch * n + cells[j]] < share) throw new NicheInvalid(`underfunded: cell ${cells[j]} holds ${s.cells[ch * n + cells[j]]} < ${share} of channel ${ch}`);
  }
  for (let j = 0; j < m; j++) s.cells[ch * n + cells[j]] -= base + (j < rem ? 1 : 0);
}

/**
 * Move `dB` quanta of lattice nutrient (matter) and `dEnergy` units of lattice free energy into the reserve. The reserve gains
 * B = dB (valued eB each) and E = dEnergy - (eB - eA) * dB, so the funded reserve energy is exactly what left the lattice.
 */
export function moveToReserve(s: WorldState, a: Audit, dB: number, dEnergy: number, from: readonly number[]): void {
  const { eA, eB } = s.cfg;
  const e = dEnergy - (eB - eA) * dB;
  if (e < 0) throw new NicheInvalid("reserve energy would be negative");
  debitEven(s, CH.A, dB, from);
  debitEven(s, CH.E, dEnergy, from);
  a.reserveB += dB;
  a.reserveE += e;
}

/** Start an audit for `s` as it is (nothing off the lattice yet). */
export function openAudit(s: WorldState): Audit {
  const t = totalsOf(s.cfg, s.cells);
  return { energyStart: t.energy + s.heatOut - s.lightIn, matterStart: t.matter, reserveB: 0, reserveE: 0, heatAnalytic: 0n };
}

/** Fund the reserve (Br, Er) from the lattice: A down by Br, E down by (eB - eA) * Br + Er, over `from`. */
export function fundReserve(s: WorldState, a: Audit, Br: number, Er: number, from: readonly number[]): TransferRecord {
  return audited("fund-reserve", s, a, () => {
    moveToReserve(s, a, Br, (s.cfg.eB - s.cfg.eA) * Br + Er, from);
    return { reserveB: Br, reserveE: Er, cells: from.length };
  });
}

const livingAt = (s: WorldState, i: number): boolean => {
  const n = cellCount(s.cfg);
  return (s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0;
};

/** Builder removal: living cells become non-living (lineage and genome cleared); B, P, E, A, C, S stay in place. */
export function relabelLiving(s: WorldState, a: Audit): TransferRecord {
  return audited("relabel-living", s, a, () => {
    const n = cellCount(s.cfg);
    let cells = 0, B = 0;
    for (let i = 0; i < n; i++) {
      if (!livingAt(s, i)) continue;
      cells++;
      B += s.cells[CH.B * n + i];
      for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = 0;
      s.cells[CH.MOT * n + i] = MOT_ZERO;
    }
    return { cells, relabelledB: B };
  });
}

/** Ablation: every structural polymer quantum becomes waste C; the released energy (eP - eC) * P is booked as heatAnalytic. */
export function convertPolymer(s: WorldState, a: Audit): TransferRecord {
  return audited("polymer-to-waste", s, a, () => {
    const n = cellCount(s.cfg);
    let P = 0;
    for (let i = 0; i < n; i++) {
      const p = s.cells[CH.P * n + i];
      P += p;
      s.cells[CH.C * n + i] += p;
      s.cells[CH.P * n + i] = 0;
    }
    a.heatAnalytic += BigInt(s.cfg.eP - s.cfg.eC) * BigInt(P);
    return { convertedP: P, heatAnalytic: `${BigInt(s.cfg.eP - s.cfg.eC) * BigInt(P)}` };
  });
}

/** Deterministic permutation of 0..n-1 from (seed, channel) alone, never from cell contents, so every history is scrambled the same way. */
export function permutation(n: number, seed: number, ch: number, mix: (x: number) => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let j = n - 1; j > 0; j--) {
    const r = mix((seed ^ Math.imul(ch + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca6b)) >>> 0) % (j + 1);
    const t = p[j];
    p[j] = p[r];
    p[r] = t;
  }
  return p;
}

/** Independently permute the listed channels over all lattice cells; each channel total is preserved exactly, structure is not. */
export function scrambleChannels(s: WorldState, a: Audit, seed: number, channels: readonly number[], mix: (x: number) => number, op = "scramble"): TransferRecord {
  return audited(op, s, a, () => {
    const n = cellCount(s.cfg);
    for (const ch of channels) {
      const p = permutation(n, seed, ch, mix);
      const old = s.cells.slice(ch * n, (ch + 1) * n);
      for (let i = 0; i < n; i++) s.cells[ch * n + i] = old[p[i]];
    }
    return { channels: channels.join(",") };
  });
}

/** A cell that may take receiver inoculum: nothing bound, no lineage, and room in E. `allowP` is for the hand-wall floor only. */
export function placeable(s: WorldState, i: number, perE: number, allowP = false): boolean {
  const n = cellCount(s.cfg);
  return s.cells[CH.B * n + i] === 0 && (allowP || s.cells[CH.P * n + i] === 0) && !livingAt(s, i) && s.cells[CH.E * n + i] + perE <= POOL_MAX;
}

/** Cells that are placeable in every state of the block (the intersection), in raster order. */
export function commonCells(states: readonly WorldState[], disc: readonly number[], perE: number, allowP = false): number[] {
  return disc.filter((i) => states.every((s) => placeable(s, i, perE, allowP)));
}

/** Move the whole reserve onto `cells` (even split, remainder to the first): empty cells only, nothing overwritten. */
export function placeInoculum(s: WorldState, a: Audit, cells: readonly number[], words: Uint32Array, allowP = false): TransferRecord {
  return audited("place-inoculum", s, a, () => {
    const n = cellCount(s.cfg);
    const m = cells.length;
    if (m === 0) throw new NicheInvalid("no cell to place the inoculum on");
    if (a.reserveB === 0 && a.reserveE === 0) throw new NicheInvalid("reserve exhausted: nothing left to place");
    const bBase = Math.floor(a.reserveB / m), bRem = a.reserveB % m;
    const eBase = Math.floor(a.reserveE / m), eRem = a.reserveE % m;
    const perE = eBase + (eRem > 0 ? 1 : 0);
    for (const i of cells) if (!placeable(s, i, perE, allowP)) throw new NicheInvalid(`placement refused: cell ${i} is occupied or at its pool cap`);
    const B = a.reserveB, E = a.reserveE;
    cells.forEach((i, j) => {
      s.cells[CH.B * n + i] += bBase + (j < bRem ? 1 : 0);
      s.cells[CH.E * n + i] += eBase + (j < eRem ? 1 : 0);
      for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
    });
    a.reserveB = 0;
    a.reserveE = 0;
    return { placedCells: m, placedB: B, placedE: E };
  });
}

export const CELLS_LEN = (cfg: WorldConfig): number => cellCount(cfg) * CELL_CHANNELS;
