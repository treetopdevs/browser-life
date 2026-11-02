// Readouts, version 1 (docs/prediction-envelope-2026-11-01/PLAN.md, section 5). Evaluated directly from a WorldState, with no tracker and no
// census history. The primary world-level readout is `bodyMass`: total bound mass B+P. The plan named `livingCells` (cells whose
// lineage word is non-zero, which a test cross-checks against @bl/metrics `census().livingCells`); the dev probe found it does not
// move under a feed (effect 0 in every probed world, because a lineage persists on a cell while its mass grows), so no "up" outcome
// was reachable, and the primary readout was changed to `bodyMass` before the freeze (EVIDENCE.md, "Deviations"). `livingCells`
// and `freeNutrient` (total A in the field) remain as diagnostics. Each readout has its own unit; effects are never pooled.
import { CH, cellCount, isLiving, type WorldState } from "@bl/schema";

export const READOUTS_VERSION = 1;
export type ReadoutId = "bodyMass";
export const PRIMARY_READOUT: ReadoutId = "bodyMass";
export type DiagnosticId = "livingCells" | "freeNutrient";
export const READOUT_UNITS: Readonly<Record<ReadoutId | DiagnosticId, string>> = Object.freeze({ bodyMass: "mass quanta (B+P)", livingCells: "cells", freeNutrient: "nutrient quanta" });

export function livingCells(s: WorldState): number {
  const n = cellCount(s.cfg);
  let k = 0;
  for (let i = 0; i < n; i++) if (isLiving(s, i)) k++;
  return k;
}

export function freeNutrient(s: WorldState): number {
  const n = cellCount(s.cfg);
  let t = 0;
  for (let i = 0; i < n; i++) t += s.cells[CH.A * n + i];
  return t;
}

export function totalMass(s: WorldState): number {
  const n = cellCount(s.cfg);
  let t = 0;
  for (let i = 0; i < n; i++) t += s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
  return t;
}

export function readout(s: WorldState, id: ReadoutId): number {
  if (id === "bodyMass") return totalMass(s);
  throw new Error(`unknown readout ${String(id)}`);
}
