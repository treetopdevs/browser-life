/** Deterministic *possible* allocations of indistinguishable B/P quanta.
 * This is a test oracle, not a claim that the simulator has hidden labels.
 */
import { CH, cellCount } from "@bl/schema";
import { transportDestinationAudit, type TransportInput } from "./foundation-material-flow.ts";
import type { CellFlux } from "./reset-material-bounds-v1.ts";

export interface TokenCohort { B: number[]; P: number[] }
export type AllocationChoice = "old-first" | "fresh-first";
export function initialTokenCohort(before: TransportInput, sites: ReadonlySet<number>): TokenCohort {
  const n = cellCount(before.cfg);
  return { B: Array.from({ length: n }, (_, i) => sites.has(i) ? before.cells[CH.B * n + i] : 0),
    P: Array.from({ length: n }, (_, i) => sites.has(i) ? before.cells[CH.P * n + i] : 0) };
}

function takeOld(old: number, pool: number, amount: number, choice: AllocationChoice): number {
  if (!Number.isSafeInteger(old) || !Number.isSafeInteger(pool) || !Number.isSafeInteger(amount) ||
      old < 0 || old > pool || amount < 0 || amount > pool) throw new Error("invalid token allocation");
  return choice === "old-first" ? Math.min(old, amount) :
    Math.max(0, amount - (pool - old));
}

export function transportTokenCohort(before: TransportInput, displacement: Uint32Array,
  old: TokenCohort, choice: AllocationChoice,
  prioritySites?: ReadonlySet<number>): TokenCohort {
  const n = cellCount(before.cfg);
  const remainingB = old.B.slice(), remainingP = old.P.slice();
  const poolsB = Array.from({ length: n }, (_, i) => before.cells[CH.B * n + i]);
  const poolsP = Array.from({ length: n }, (_, i) => before.cells[CH.P * n + i]);
  const B = new Array<number>(n).fill(0), P = new Array<number>(n).fill(0);
  const destinations = Array.from({ length: n }, (_, i) => i);
  if (prioritySites) destinations.sort((a, b) => Number(prioritySites.has(b)) - Number(prioritySites.has(a)) || a - b);
  for (const i of destinations) {
    const audit = transportDestinationAudit(before, displacement, i);
    for (const share of audit.sources) {
      const s = share.sourceIndex;
      const b = takeOld(remainingB[s], poolsB[s], share.B, choice);
      const p = takeOld(remainingP[s], poolsP[s], share.P, choice);
      B[i] += b; P[i] += p;
      remainingB[s] -= b; poolsB[s] -= share.B;
      remainingP[s] -= p; poolsP[s] -= share.P;
    }
  }
  if (remainingB.some(Boolean) || remainingP.some(Boolean) ||
      poolsB.some(Boolean) || poolsP.some(Boolean)) throw new Error("token transport did not close");
  return { B, P };
}

export function reactTokenCohort(transported: TransportInput, old: TokenCohort,
  flux: readonly CellFlux[], choice: AllocationChoice,
  buildChoice: AllocationChoice = choice === "old-first" ? "fresh-first" : "old-first"): TokenCohort {
  const n = cellCount(transported.cfg), B: number[] = [], P: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = flux[i];
    let bPool = transported.cells[CH.B * n + i], pPool = transported.cells[CH.P * n + i];
    let b = old.B[i], p = old.P[i];
    bPool += f.photo;
    b -= takeOld(b, bPool, f.resp, choice); bPool -= f.resp;
    bPool += f.grow;
    // For old-first loss, move fresh material to P when possible; for
    // fresh-first loss, move old to P. Both are valid real-pool allocations.
    const builtOld = takeOld(b, bPool, f.build, buildChoice);
    b -= builtOld; p += builtOld; bPool -= f.build; pPool += f.build;
    b -= takeOld(b, bPool, f.starve, choice); bPool -= f.starve;
    p -= takeOld(p, pPool, f.pdecay, choice); pPool -= f.pdecay;
    b -= takeOld(b, bPool, f.bdecay, choice);
    B.push(b); P.push(p);
  }
  return { B, P };
}

export function tokenTotal(old: TokenCohort, sites?: ReadonlySet<number>): number {
  let sum = 0;
  for (let i = 0; i < old.B.length; i++) if (!sites || sites.has(i)) sum += old.B[i] + old.P[i];
  return sum;
}
