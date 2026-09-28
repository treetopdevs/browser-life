// Per-tile, growth-census observations for exploratory paired assays. Roles
// reuse the fixed four-class observer; a changed label is not a novel function.
import { CH, G, ROLE_WORDS, cellCount, worldW, type WorldConfig } from "@bl/schema";
import { ROLES, classify, type Role } from "@bl/metrics";

export interface MovementInterval {
  /** Sum of tracked component-centroid displacements in this census interval. */
  distanceCells: number;
  /** Number of tracked components seen at both ends of the interval. */
  observedIntervals: number;
  intervalSteps: number;
}

export interface BehaviorSample {
  step: number;
  phase: "growth";
  tile: number;
  livingCells: number;
  biomass: number;
  polymer: number;
  boundMass: number;
  /** P/(B+P), null if no bound mass exists in the tile. */
  membraneFraction: number | null;
  roles: {
    source: "last-step per-cell catalytic flux, classified by lineage into four fixed roles";
    availability: "available" | "no-living-cells" | "no-catalytic-activity" | "missing-role-buffer";
    denominatorLivingCells: number;
    /** Living cells in lineages with no catalytic flux in this snapshot. */
    zeroFluxLineageCells: number | null;
    totalCatalyticQuanta: number | null;
    shares: Record<Role, number> | null;
    /** exp(Shannon entropy) over the four fixed role shares; at most 4. */
    effectiveDiversity: number | null;
  };
  movement: {
    source: "tracked component-centroid displacement between growth censuses";
    observedIntervals: number;
    intervalSteps: number | null;
    /** Mean displacement per observed component per 100 simulation steps. */
    meanCellsPer100Steps: number | null;
  };
}

interface LineageFlux { cells: number; photo: number; grow: number; decomp: number; resp: number }

/** Pure observer over a coherent readback. Missing data stays null, not zero. */
export function behaviorSamples(
  cfg: WorldConfig, step: number, cells: Uint32Array, genomeHead: Uint32Array,
  roles?: Uint32Array, movement?: readonly MovementInterval[],
): BehaviorSample[] {
  const n = cellCount(cfg), tiles = cfg.tilesX * cfg.tilesY, W = worldW(cfg);
  if (cells.length !== n * 7 || genomeHead.length !== n * 4 || (roles && roles.length !== n * ROLE_WORDS))
    throw new Error("behavior snapshot buffer length mismatch");
  if (movement && movement.length !== tiles) throw new Error("movement interval count must match tiles");
  const acc = Array.from({ length: tiles }, () => ({ living: 0, biomass: 0, polymer: 0, flux: 0, lineages: new Map<string, LineageFlux>() }));
  for (let i = 0; i < n; i++) {
    const x = i % W, y = Math.floor(i / W);
    const tile = Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    const a = acc[tile];
    a.biomass += cells[CH.B * n + i];
    a.polymer += cells[CH.P * n + i];
    const hi = genomeHead[G.LIN_HI * n + i], lo = genomeHead[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    a.living++;
    if (!roles) continue;
    const key = `${hi}:${lo}`;
    let p = a.lineages.get(key);
    if (!p) a.lineages.set(key, (p = { cells: 0, photo: 0, grow: 0, decomp: 0, resp: 0 }));
    const r0 = roles[i * ROLE_WORDS], r1 = roles[i * ROLE_WORDS + 1];
    const photo = r0 & 0xffff, grow = r0 >>> 16, decomp = r1 & 0xffff, resp = r1 >>> 16;
    p.cells++;
    p.photo += photo; p.grow += grow; p.decomp += decomp; p.resp += resp;
    a.flux += photo + grow + decomp + resp;
  }
  return acc.map((a, tile) => {
    const boundMass = a.biomass + a.polymer;
    const shares = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
    let zeroFluxLineageCells = 0;
    if (roles && a.living && a.flux) {
      for (const p of a.lineages.values()) {
        if (p.photo + p.grow + p.decomp + p.resp === 0) zeroFluxLineageCells += p.cells;
        shares[classify(p.photo, p.grow, p.decomp)] += p.cells / a.living;
      }
    } else if (roles && a.living) {
      zeroFluxLineageCells = a.living;
    }
    const available = !!roles && a.living > 0 && a.flux > 0;
    const interval = movement?.[tile];
    if (interval && (!(interval.intervalSteps > 0) || interval.observedIntervals < 0 || interval.distanceCells < 0))
      throw new Error("invalid movement interval");
    return {
      step, phase: "growth" as const, tile, livingCells: a.living,
      biomass: a.biomass, polymer: a.polymer, boundMass,
      membraneFraction: boundMass ? a.polymer / boundMass : null,
      roles: {
        source: "last-step per-cell catalytic flux, classified by lineage into four fixed roles" as const,
        availability: !roles ? "missing-role-buffer" as const : !a.living ? "no-living-cells" as const
          : !a.flux ? "no-catalytic-activity" as const : "available" as const,
        denominatorLivingCells: a.living,
        zeroFluxLineageCells: roles ? zeroFluxLineageCells : null,
        totalCatalyticQuanta: roles ? a.flux : null,
        shares: available ? shares : null,
        effectiveDiversity: available ? Math.exp(-ROLES.reduce((h, r) => shares[r] ? h + shares[r] * Math.log(shares[r]) : h, 0)) : null,
      },
      movement: {
        source: "tracked component-centroid displacement between growth censuses" as const,
        observedIntervals: interval?.observedIntervals ?? 0,
        intervalSteps: interval?.intervalSteps ?? null,
        meanCellsPer100Steps: interval && interval.observedIntervals
          ? interval.distanceCells / interval.observedIntervals * (100 / interval.intervalSteps) : null,
      },
    };
  });
}

export interface BehaviorComparison {
  step: number;
  tile: number;
  boundMassDifference: number;
  membraneFractionDifference: number | null;
  effectiveRoleDiversityDifference: number | null;
  fixedRoleShareDifferences: Record<Role, number> | null;
  movementDifference: number | null;
}

/** Pointwise mutant minus parent; unavailable components remain null. */
export function compareBehaviorTraces(parent: readonly BehaviorSample[], mutant: readonly BehaviorSample[]): BehaviorComparison[] {
  if (parent.length !== mutant.length) throw new Error("paired behavior traces have different lengths");
  return parent.map((a, i) => {
    const b = mutant[i];
    if (a.step !== b.step || a.tile !== b.tile || a.phase !== b.phase)
      throw new Error(`paired behavior trace schedule differs at sample ${i}`);
    return {
      step: a.step, tile: a.tile, boundMassDifference: b.boundMass - a.boundMass,
      membraneFractionDifference: a.membraneFraction === null || b.membraneFraction === null
        ? null : b.membraneFraction - a.membraneFraction,
      effectiveRoleDiversityDifference: a.roles.effectiveDiversity === null || b.roles.effectiveDiversity === null
        ? null : b.roles.effectiveDiversity - a.roles.effectiveDiversity,
      fixedRoleShareDifferences: a.roles.shares && b.roles.shares
        ? Object.fromEntries(ROLES.map((r) => [r, b.roles.shares![r] - a.roles.shares![r]])) as Record<Role, number> : null,
      movementDifference: a.movement.meanCellsPer100Steps === null || b.movement.meanCellsPer100Steps === null
        ? null : b.movement.meanCellsPer100Steps - a.movement.meanCellsPer100Steps,
    };
  });
}
