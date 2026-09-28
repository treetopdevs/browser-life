/** Conservative continuity of material that was bound (B/P) at trace start.
 * A B/P quantum ceases to belong to this cohort when converted to C; if it is
 * later rebuilt from A/C it is newly bound material, regardless of atoms.
 * This is a passive calculation and never feeds a label into the simulator.
 */
import { CH, FLUX_NAMES, cellCount, type FluxName } from "@bl/schema";
import { transportDestinationAudit, validateTransportInput, type TransportInput } from
  "./foundation-material-flow.ts";

export interface Interval { lo: number; hi: number }
export interface BoundCohort { B: Interval[]; P: Interval[];
  /** Joint total cap prevents independent destination projections creating mass. */
  totalHi: number; totalLo: number }
export type CellFlux = Record<FluxName, number>;
export interface BoundStep { cohort: BoundCohort; transported: BoundCohort;
  /** The sum is tightened by global conservation; site bounds may be correlated. */
  global: Interval; witness: "exact-local-flux" | "conservative-unknown-reaction" }

const nonnegative = (v: number) => Number.isSafeInteger(v) && v >= 0;
const checked = (x: Interval, pool: number) => {
  if (!nonnegative(pool) || !nonnegative(x.lo) || !nonnegative(x.hi) || x.lo > x.hi || x.hi > pool)
    throw new Error("invalid cohort interval/pool");
};
const zero = (): Interval => ({ lo: 0, hi: 0 });
const add = (a: Interval, b: Interval): Interval => ({ lo: a.lo + b.lo, hi: a.hi + b.hi });
/** Any allocation among indistinguishable quanta consistent with the old interval. */
export function selectedInterval(old: Interval, pool: number, selected: number): Interval {
  checked(old, pool);
  if (!nonnegative(selected) || selected > pool) throw new Error("invalid selected amount");
  return { lo: Math.max(0, old.lo - (pool - selected)), hi: Math.min(old.hi, selected) };
}
const remainder = (old: Interval, pool: number, selected: number): Interval =>
  selectedInterval(old, pool, pool - selected);
const transfer = (source: Interval, sourcePool: number, amount: number,
  destination: Interval): { source: Interval; destination: Interval } => {
  const moved = selectedInterval(source, sourcePool, amount);
  return { source: remainder(source, sourcePool, amount), destination: add(destination, moved) };
};

export function initialBoundCohort(before: TransportInput, selectedSites: ReadonlySet<number>): BoundCohort {
  validateTransportInput(before);
  const n = cellCount(before.cfg);
  for (const i of selectedSites) if (!Number.isSafeInteger(i) || i < 0 || i >= n)
    throw new Error("invalid selected site");
  const B = Array.from({ length: n }, (_, i) => {
    const q = selectedSites.has(i) ? before.cells[CH.B * n + i] : 0;
    return { lo: q, hi: q };
  });
  const P = Array.from({ length: n }, (_, i) => {
    const q = selectedSites.has(i) ? before.cells[CH.P * n + i] : 0;
    return { lo: q, hi: q };
  });
  const total = B.reduce((s, x) => s + x.hi, 0) + P.reduce((s, x) => s + x.hi, 0);
  return { B, P, totalHi: total, totalLo: total };
}

export function transportBoundCohort(before: TransportInput,
  displacement: Uint32Array | ((sourceIndex: number) => number), transported: TransportInput,
  cohort: BoundCohort): BoundCohort {
  validateTransportInput(before); validateTransportInput(transported);
  const n = cellCount(before.cfg);
  if (before.step !== transported.step || JSON.stringify(before.cfg) !== JSON.stringify(transported.cfg) ||
      cohort.B.length !== n || cohort.P.length !== n) throw new Error("mismatched transport observation");
  for (let i = 0; i < n; i++) {
    checked(cohort.B[i], before.cells[CH.B * n + i]);
    checked(cohort.P[i], before.cells[CH.P * n + i]);
  }
  const B = Array.from({ length: n }, zero), P = Array.from({ length: n }, zero);
  for (let i = 0; i < n; i++) {
    const audit = transportDestinationAudit(before, displacement, i);
    if (audit.incoming.B !== transported.cells[CH.B * n + i] ||
        audit.incoming.P !== transported.cells[CH.P * n + i])
      throw new Error(`transport mismatch at ${i}`);
    for (const share of audit.sources) {
      // A local lower/upper projection does not assume independent destination
      // allocations. Summed upper bounds are tightened only at report time.
      B[i] = add(B[i], selectedInterval(cohort.B[share.sourceIndex],
        before.cells[CH.B * n + share.sourceIndex], share.B));
      P[i] = add(P[i], selectedInterval(cohort.P[share.sourceIndex],
        before.cells[CH.P * n + share.sourceIndex], share.P));
    }
  }
  const priorTotal = globalBound(cohort);
  return { B, P, totalHi: priorTotal.hi, totalLo: priorTotal.lo };
}

/** Apply ordered local reaction extents. The supplied extents must have an
 * independent provenance; endpoint balance is only a consistency check.
 * Cumulative flux and packed roles alone cannot supply the full local witness. */
export function reactBoundCohort(transported: TransportInput, after: TransportInput,
  cohort: BoundCohort, flux: readonly CellFlux[]): BoundCohort {
  validateTransportInput(transported); validateTransportInput(after);
  const n = cellCount(transported.cfg);
  if (after.step !== transported.step + 1 || JSON.stringify(after.cfg) !== JSON.stringify(transported.cfg) ||
      flux.length !== n || cohort.B.length !== n || cohort.P.length !== n)
    throw new Error("mismatched reaction observation");
  const B: Interval[] = [], P: Interval[] = [];
  let maximumOldLoss = 0, guaranteedOldLoss = 0;
  for (let i = 0; i < n; i++) {
    const f = flux[i];
    if (!f || FLUX_NAMES.some((k) => !nonnegative(f[k]))) throw new Error(`invalid local flux at ${i}`);
    let bPool = transported.cells[CH.B * n + i], pPool = transported.cells[CH.P * n + i];
    let b = cohort.B[i], p = cohort.P[i];
    checked(b, bPool); checked(p, pPool);
    bPool += f.photo; // A→B; no initial continuously bound cohort enters.
    if (f.resp > bPool) throw new Error(`resp exceeds B at ${i}`);
    maximumOldLoss += f.resp;
    guaranteedOldLoss += selectedInterval(b, bPool, f.resp).lo;
    b = remainder(b, bPool, f.resp); bPool -= f.resp;
    bPool += f.grow; // A→B.
    if (f.build > bPool) throw new Error(`build exceeds B at ${i}`);
    ({ source: b, destination: p } = transfer(b, bPool, f.build, p));
    bPool -= f.build; pPool += f.build;
    if (f.starve > bPool || f.pdecay > pPool) throw new Error(`loss exceeds bound pool at ${i}`);
    maximumOldLoss += f.starve + f.pdecay;
    guaranteedOldLoss += selectedInterval(b, bPool, f.starve).lo +
      selectedInterval(p, pPool, f.pdecay).lo;
    b = remainder(b, bPool, f.starve); bPool -= f.starve;
    p = remainder(p, pPool, f.pdecay); pPool -= f.pdecay;
    if (f.bdecay > bPool) throw new Error(`B decay exceeds pool at ${i}`);
    maximumOldLoss += f.bdecay;
    guaranteedOldLoss += selectedInterval(b, bPool, f.bdecay).lo;
    b = remainder(b, bPool, f.bdecay); bPool -= f.bdecay;
    if (bPool !== after.cells[CH.B * n + i] || pPool !== after.cells[CH.P * n + i])
      throw new Error(`local reaction bound balance mismatch at ${i}`);
    // The full A/C balance rejects fabricated extents that happen to fit B/P.
    const a = transported.cells[CH.A * n + i] - f.photo - f.grow + f.decomp + f.abio;
    const c = transported.cells[CH.C * n + i] + f.resp - f.decomp + f.starve +
      f.pdecay + f.bdecay - f.abio;
    if (a !== after.cells[CH.A * n + i] || c !== after.cells[CH.C * n + i])
      throw new Error(`local reaction dissolved balance mismatch at ${i}`);
    B.push(b); P.push(p);
  }
  const priorTotal = globalBound(cohort);
  const raw = { B, P, totalHi: Math.max(0, priorTotal.hi - guaranteedOldLoss),
    totalLo: Math.max(0, priorTotal.lo - maximumOldLoss) };
  const tightened = globalBound(raw);
  return { ...raw, totalHi: tightened.hi, totalLo: tightened.lo };
}

/** Conservative fallback when full local fluxes cannot be authenticated.
 * Individual old molecules can be selectively lost at every site. */
export function unknownReactionBoundCohort(transported: TransportInput, after: TransportInput,
  cohort: BoundCohort): BoundCohort {
  validateTransportInput(transported); validateTransportInput(after);
  const n = cellCount(transported.cfg);
  if (after.step !== transported.step + 1 || JSON.stringify(after.cfg) !== JSON.stringify(transported.cfg) ||
      cohort.B.length !== n || cohort.P.length !== n) throw new Error("mismatched reaction observation");
  const B: Interval[] = [], P: Interval[] = [];
  for (let i = 0; i < n; i++) {
    checked(cohort.B[i], transported.cells[CH.B * n + i]);
    checked(cohort.P[i], transported.cells[CH.P * n + i]);
    const boundHi = cohort.B[i].hi + cohort.P[i].hi;
    B.push({ lo: 0, hi: Math.min(boundHi, after.cells[CH.B * n + i]) });
    P.push({ lo: 0, hi: Math.min(boundHi, after.cells[CH.P * n + i]) });
  }
  const priorTotal = globalBound(cohort);
  const raw = { B, P, totalHi: priorTotal.hi, totalLo: 0 };
  const tightened = globalBound(raw);
  return { ...raw, totalHi: tightened.hi, totalLo: tightened.lo };
}

export function globalBound(cohort: BoundCohort): Interval {
  if (cohort.B.length !== cohort.P.length) throw new Error("mismatched cohort arrays");
  if (!nonnegative(cohort.totalLo) || !nonnegative(cohort.totalHi) ||
      cohort.totalLo > cohort.totalHi) throw new Error("invalid global cohort cap");
  let lo = 0, hi = 0;
  for (let i = 0; i < cohort.B.length; i++) {
    checked(cohort.B[i], cohort.B[i].hi);
    checked(cohort.P[i], cohort.P[i].hi);
    lo += cohort.B[i].lo + cohort.P[i].lo;
    hi += cohort.B[i].hi + cohort.P[i].hi;
  }
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi))
    throw new Error("unsafe global cohort sum");
  const out = { lo: Math.max(lo, cohort.totalLo), hi: Math.min(hi, cohort.totalHi) };
  if (out.lo > out.hi) throw new Error("inconsistent global cohort bounds");
  return out;
}

/** Region projection with the complementary sites enforcing the joint total. */
export function regionBound(cohort: BoundCohort, sites: ReadonlySet<number>): Interval {
  const n = cohort.B.length, total = globalBound(cohort);
  let regionLo = 0, regionHi = 0, otherLo = 0, otherHi = 0;
  for (const i of sites) if (!Number.isSafeInteger(i) || i < 0 || i >= n)
    throw new Error("invalid region site");
  for (let i = 0; i < n; i++) {
    const lo = cohort.B[i].lo + cohort.P[i].lo;
    const hi = cohort.B[i].hi + cohort.P[i].hi;
    if (sites.has(i)) { regionLo += lo; regionHi += hi; }
    else { otherLo += lo; otherHi += hi; }
  }
  const out = { lo: Math.max(regionLo, total.lo - otherHi),
    hi: Math.min(regionHi, total.hi - otherLo) };
  if (out.lo > out.hi) throw new Error("inconsistent regional cohort bounds");
  return out;
}

export function boundStep(before: TransportInput, displacement: Uint32Array | ((i: number) => number),
  transported: TransportInput, after: TransportInput, cohort: BoundCohort,
  flux?: readonly CellFlux[]): BoundStep {
  const t = transportBoundCohort(before, displacement, transported, cohort);
  const next = flux ? reactBoundCohort(transported, after, t, flux) :
    unknownReactionBoundCohort(transported, after, t);
  return { cohort: next, transported: t, global: globalBound(next),
    witness: flux ? "exact-local-flux" : "conservative-unknown-reaction" };
}
