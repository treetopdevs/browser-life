// Per-patch readouts (GRAMMAR.md 5). Kept separate; no combined statistic. All values are integers or exact rationals.
import { deflateSync } from "fflate";
import { canonicalKey, type Conn } from "./grammar.ts";
import { segment, type SegObject } from "./segment.ts";
import { ConstructionService, type Status } from "./construct.ts";
import { PROTOCOL } from "./protocol.ts";
import { packFrame, DEFLATE_OPTIONS } from "../predictability/losses.ts";

export interface Rat { num: number; den: number }
export const rat = (num: number, den: number): Rat => ({ num, den });
/** Sign of a - b for rationals with positive denominators. */
export const cmpRat = (a: Rat, b: Rat): number => Math.sign(a.num * b.den - b.num * a.den);

export interface CopyStats { classes: number; withCopies: number; maxCopies: number; copyExcess: number; copyPairs: number; copyWeightedConstruction: number }
export interface ClassRow { n: number; copies: number; a: number; status: Status }
export interface PatchReadouts {
  seg: { conn: Conn; tau: number };
  objects: number; spans: number; large: number; monomers: number;
  construction: { sumA: number; maxA: number; meanA: Rat | null; reuseRatio: Rat | null; sharedBound: number | null; eligibleForShared: number; statuses: Record<Status, number> };
  copies: { T: CopyStats; D4: CopyStats };
  equiv: { classesT: number; classesD4: number; classesD4on8: number; spread: number; copyPairsT: number; copyPairsD4: number; copyPairsD4on8: number };
  baselines: { occupied: number; deflate: number; objectCount: number; meanObjectSize: Rat | null; maxMultiplicity: number };
  classes: ClassRow[];
}

const D4_FROM = (cells: readonly number[]) => canonicalKey(cells, "D4");

function copyStats(counts: Map<string, number>, aOf: (key: string) => number): CopyStats {
  let withCopies = 0, maxCopies = 0, excess = 0, pairs = 0, weighted = 0;
  for (const [k, c] of counts) {
    if (c > maxCopies) maxCopies = c;
    excess += c - 1;
    pairs += (c * (c - 1)) / 2;
    if (c >= 2) { withCopies++; weighted += aOf(k) * (c - 1); }
  }
  return { classes: counts.size, withCopies, maxCopies, copyExcess: excess, copyPairs: pairs, copyWeightedConstruction: weighted };
}

export function occupiedOf(frame: Uint8Array, tau: number): number { let c = 0; for (let i = 0; i < frame.length; i++) if (frame[i] >= tau) c++; return c; }

export function deflateLength(frame: Uint8Array, tau: number): number {
  const bits = new Uint8Array(frame.length);
  for (let i = 0; i < frame.length; i++) bits[i] = frame[i] >= tau ? 1 : 0;
  return deflateSync(packFrame(bits, 2), DEFLATE_OPTIONS).length;
}

/** All readouts for one frame. `svc` is shared so identical classes are solved once. */
export function patchReadouts(frame: Uint8Array, w: number, h: number, seg: { conn: Conn; tau: number }, svc: ConstructionService): PatchReadouts {
  const all = segment(frame, w, h, seg);
  const objs: SegObject[] = all.filter((o) => !o.spans);
  const spans = all.length - objs.length;
  const classT = new Map<string, { cells: number[]; copies: number }>();
  const countsD4 = new Map<string, number>();
  let large = 0, monomers = 0, totalCells = 0;
  const d4ToT = new Map<string, string>();
  for (const o of objs) {
    const k = o.cells.join(",");
    const e = classT.get(k);
    if (e) e.copies++; else classT.set(k, { cells: o.cells, copies: 1 });
    const d = D4_FROM(o.cells);
    countsD4.set(d, (countsD4.get(d) ?? 0) + 1);
    if (!d4ToT.has(d)) d4ToT.set(d, k);
    if (o.n > PROTOCOL.objMaxN) large++;
    if (o.n === 1) monomers++;
    totalCells += o.n;
  }
  // D4 on 8-connectivity: a segmentation variant only for the uncertainty readout
  const objs8 = segment(frame, w, h, { conn: 8, tau: seg.tau }).filter((o) => !o.spans);
  const counts8 = new Map<string, number>();
  for (const o of objs8) { const d = D4_FROM(o.cells); counts8.set(d, (counts8.get(d) ?? 0) + 1); }

  const answers = new Map<string, { a: number; status: Status }>();
  for (const [k, e] of classT) answers.set(k, svc.solve(e.cells, seg.conn));
  const statuses: Record<Status, number> = { exact: 0, bound: 0, limited: 0 };
  let sumA = 0, maxA = 0, sumA2 = 0, sumNm1 = 0;
  for (const [k, e] of classT) {
    const ans = answers.get(k)!;
    const n = e.cells.length;
    sumA += ans.a * e.copies;
    if (ans.a > maxA) maxA = ans.a;
    if (n >= 2) { sumA2 += ans.a * e.copies; sumNm1 += (n - 1) * e.copies; }
    if (n >= 2) statuses[ans.status] += e.copies;
  }
  const eligible = [...classT.entries()].filter(([, e]) => e.cells.length >= 2 && e.cells.length <= PROTOCOL.objMaxN).map(([key, e]) => ({ key, cells: e.cells }));
  const sharedBound = svc.shared(eligible, seg.conn);
  const countsT = new Map([...classT].map(([k, e]) => [k, e.copies] as const));
  const T = copyStats(countsT, (k) => answers.get(k)!.a);
  const D4 = copyStats(countsD4, (d) => answers.get(d4ToT.get(d)!)!.a);
  const D48 = copyStats(counts8, () => 0);
  const classCounts = [T.classes, D4.classes, D48.classes];
  const classes: ClassRow[] = [...classT.entries()]
    .map(([, e]) => ({ n: e.cells.length, copies: e.copies, ...answers.get(e.cells.join(","))! }))
    .sort((p, q) => p.n - q.n || q.copies - p.copies || p.a - q.a);
  return {
    seg: { conn: seg.conn, tau: seg.tau },
    objects: objs.length, spans, large, monomers,
    construction: {
      sumA, maxA,
      meanA: objs.length ? rat(sumA, objs.length) : null,
      reuseRatio: sumNm1 > 0 ? rat(sumA2, sumNm1) : null,
      sharedBound, eligibleForShared: eligible.length, statuses,
    },
    copies: { T, D4 },
    equiv: { classesT: T.classes, classesD4: D4.classes, classesD4on8: D48.classes, spread: Math.max(...classCounts) - Math.min(...classCounts), copyPairsT: T.copyPairs, copyPairsD4: D4.copyPairs, copyPairsD4on8: D48.copyPairs },
    baselines: {
      occupied: occupiedOf(frame, seg.tau), deflate: deflateLength(frame, seg.tau), objectCount: objs.length,
      meanObjectSize: objs.length ? rat(totalCells, objs.length) : null, maxMultiplicity: T.maxCopies,
    },
    classes,
  };
}

export const READOUTS = ["meanA", "sharedBound", "reuseRatio", "maxCopies", "copyWeightedConstruction"] as const;
export type ReadoutName = (typeof READOUTS)[number];
/** Declared direction for the hierarchical positive: null means not directional (cannot separate at matched size and multiplicity). */
export const DIRECTION: Record<ReadoutName, "lower" | "higher" | null> = { meanA: null, sharedBound: "lower", reuseRatio: "lower", maxCopies: null, copyWeightedConstruction: "higher" };

export function scalars(r: PatchReadouts): Record<ReadoutName, Rat | null> {
  return {
    meanA: r.construction.meanA,
    sharedBound: r.construction.sharedBound === null ? null : rat(r.construction.sharedBound, 1),
    reuseRatio: r.construction.reuseRatio,
    maxCopies: rat(r.copies.T.maxCopies, 1),
    copyWeightedConstruction: rat(r.copies.T.copyWeightedConstruction, 1),
  };
}

/** The baselines as rationals (or null), each scored in both directions by the caller. */
export function baselineScalars(r: PatchReadouts): Record<string, Rat | null> {
  return {
    occupied: rat(r.baselines.occupied, 1), deflate: rat(r.baselines.deflate, 1), objectCount: rat(r.baselines.objectCount, 1),
    meanObjectSize: r.baselines.meanObjectSize, maxMultiplicity: rat(r.baselines.maxMultiplicity, 1),
  };
}
