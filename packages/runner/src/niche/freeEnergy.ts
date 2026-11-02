// I06b free-energy-matched comparators (PLAN section 4.1). Each comparator is a separately constructed receiver-alone lattice
// whose free energy E (the lattice channel) equals that of the builder-removed arm `b`, with `b`'s matter and reserve. Its ledger
// starts at its own constructed total and conserves exactly: no credit enters the audit. The comparison-budget difference
// constructionGap = total(b) - total(f) is signed, a BigInt, and lives in evidence only.
import { CH, MOT_ZERO, allocState, cellCount, totalsOf, validateState, type WorldState } from "@bl/schema";
import { outsideRegion, regionCells, type PreArm } from "./arms.ts";
import { PROTOCOL_FE, type ProtocolFe } from "./protocol.ts";
import { NicheInvalid, assertAudit, debitEven, reserveEnergy, type Audit } from "./transfer.ts";

export const FREE_IDS = ["fU", "fS", "fB"] as const;
export type FreeId = (typeof FREE_IDS)[number];

/** Sum of the lattice free-energy channel E. */
export const latticeE = (s: WorldState): bigint => totalsOf(s.cfg, s.cells).E;
/** Total energy of an arm: lattice (all channels at their chemical value) plus the off-lattice reserve. */
export const totalEnergyOf = (s: WorldState, a: Audit): bigint => totalsOf(s.cfg, s.cells).energy + reserveEnergy(s.cfg, a);

export interface FreeRow {
  id: string;
  /** Lattice free energy E, and total energy including the reserve, at the stated phase. */
  freeE: string;
  total: string;
  /** total(b) - total(arm): gap > 0 means the comparator holds less total energy than b (weaker on total), gap < 0 more. */
  constructionGap: string;
  /** Free-energy difference to b (arm - b). */
  freeGapToB: string;
  flag: "comparator-excess" | "comparator-deficit" | "total-matched" | "reference";
}

export function freeRows(arms: readonly PreArm[]): FreeRow[] {
  const b = arms.find((x) => x.id === "b");
  if (!b) return [];
  const bTotal = totalEnergyOf(b.state, b.audit), bFree = latticeE(b.state);
  return arms.map((x) => {
    const total = totalEnergyOf(x.state, x.audit), free = latticeE(x.state);
    const gap = bTotal - total;
    return { id: x.id, freeE: `${free}`, total: `${total}`, constructionGap: `${gap}`, freeGapToB: `${free - bFree}`, flag: x.id === "b" ? "reference" : gap < 0n ? "comparator-excess" : gap > 0n ? "comparator-deficit" : "total-matched" };
  });
}

/** A receiver-alone lattice with b's matter spread uniformly as nutrient A and a caller-chosen E field; reserve as b's. Own audit baseline. */
function freshLattice(b: PreArm, id: FreeId, efield: (n: number) => number[]): PreArm {
  const cfg = b.state.cfg;
  const n = cellCount(cfg);
  const s = allocState(cfg);
  const matter = totalsOf(cfg, b.state.cells).matter;
  const base = matter / BigInt(n), rem = Number(matter % BigInt(n));
  for (let i = 0; i < n; i++) s.cells[CH.A * n + i] = Number(base) + (i < rem ? 1 : 0);
  const e = efield(n);
  for (let i = 0; i < n; i++) s.cells[CH.E * n + i] = e[i];
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  s.step = b.state.step;
  const audit: Audit = { energyStart: 0n, matterStart: 0n, reserveB: b.audit.reserveB, reserveE: b.audit.reserveE, heatAnalytic: 0n };
  return { id, state: s, audit, records: [] };
}

/** Own baseline: the constructed start (lattice plus reserve, no analytic heat, lightIn and heatOut zero). */
function openOwnBaseline(x: PreArm): void {
  const t = totalsOf(x.state.cfg, x.state.cells);
  x.audit.energyStart = t.energy + reserveEnergy(x.state.cfg, x.audit);
  x.audit.matterStart = t.matter + BigInt(x.audit.reserveB);
  assertAudit(x.state, x.audit, `${x.id} start`);
  const errs = validateState(x.state);
  if (errs.length) throw new NicheInvalid(`credit-overdraw: ${x.id} fails validateState: ${errs[0]}`);
}

export const uniformSplit = (total: bigint, n: number): number[] => {
  const base = total / BigInt(n), rem = Number(total % BigInt(n));
  return Array.from({ length: n }, (_, i) => Number(base) + (i < rem ? 1 : 0));
};

/**
 * fB: fS plus the biomass the field held in the footprint-plus-halo region (the first rung's d1B quantity), handed over in the reserve
 * as bound matter taken from the lattice outside the region. NO lattice energy debit, so free E stays equal to b cell for cell
 * before and after placement. Relative to fS, fB holds (eB - eA) * dB more total energy; its own gap to b is recorded with its
 * sign (it can be positive: a field that binds energy in polymer or waste still holds more than fB; negative or zero otherwise).
 */
export function fundBiomass(f: PreArm, dB: number, outside: readonly number[]): void {
  try {
    debitEven(f.state, CH.A, dB, outside);
  } catch (e) {
    if (e instanceof NicheInvalid) throw new NicheInvalid(`credit-overdraw: matched biomass ${dB} cannot be funded from the lattice outside the region (${e.reason})`);
    throw e;
  }
  f.audit.reserveB += dB;
}

export interface FreeMatched {
  arms: PreArm[];
  /** Comparators that could not be built (refused, never clamped): id and reason. */
  refused: { id: FreeId; reason: string }[];
  dB: number;
}

/** Build fU, fS and fB around the conditioned builder-removed arm `b` (before placement). A refused one is reported, not dropped silently. */
export function buildFreeMatched(b: PreArm, p: ProtocolFe = PROTOCOL_FE): FreeMatched {
  const arms: PreArm[] = [];
  const refused: FreeMatched["refused"] = [];
  const n = cellCount(b.state.cfg);
  const bE = latticeE(b.state);
  const copyE = (): number[] => Array.from({ length: n }, (_, i) => b.state.cells[CH.E * n + i]);
  const region = regionCells(p), outside = outsideRegion(p);
  const sumB = (cells: readonly number[]) => cells.reduce((t, i) => t + b.state.cells[CH.B * n + i], 0);
  const dB = sumB(region);
  const attempt = (id: FreeId, make: () => PreArm): void => {
    try {
      const f = make();
      openOwnBaseline(f);
      arms.push(f);
    } catch (e) {
      if (!(e instanceof NicheInvalid)) throw e;
      refused.push({ id, reason: e.reason });
    }
  };
  attempt("fU", () => freshLattice(b, "fU", () => uniformSplit(bE, n)));
  attempt("fS", () => freshLattice(b, "fS", copyE));
  attempt("fB", () => {
    const f = freshLattice(b, "fB", copyE);
    fundBiomass(f, dB, outside);
    return f;
  });
  return { arms, refused, dB };
}
