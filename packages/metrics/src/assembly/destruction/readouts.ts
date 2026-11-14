// Reconstruction readouts (PLAN R3, R4). Kept separate; integers and exact rationals only.
import { canonicalKey, keyCells, type Conn } from "../grammar.ts";
import { segment } from "../segment.ts";
import { ConstructionService } from "../construct.ts";
import { patchReadouts, rat, type Rat } from "../readouts.ts";
import { DPROTOCOL } from "./protocol.ts";

const W = DPROTOCOL.patch.w, H = DPROTOCOL.patch.h, M = DPROTOCOL.patch.mass;

export interface Measure {
  occupied: number;
  objects: number;
  /** copy-weighted construction (first rung readout, key ignored) */
  cw: number;
  sharedBound: number | null;
  reuseRatio: Rat | null;
  /** distinct non-monomer keys in the patch's shared construction DAG (targets and sub-objects) */
  dagKeys: number;
  /** copies per T-key among non-spanning objects */
  copies: Record<string, number>;
}

/** Full frame bytes as the memo key (no hash, so distinct patches never alias). */
const frameKey = (frame: Uint8Array): string => Buffer.from(frame).toString("latin1");

/** Measures with a shared construction service; memoised by frame content and connectivity. */
export class Measurer {
  readonly svc = new ConstructionService();
  private memo = new Map<string, Measure>();
  measure(frame: Uint8Array, conn: Conn): Measure {
    const key = `${conn}:${frameKey(frame)}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    this.svc.trace = [];
    const r = patchReadouts(frame, W, H, { conn, tau: 1 }, this.svc);
    const keys = new Set<string>();
    for (const t of this.svc.trace) { keys.add(canonicalKey(t.target)); for (const e of t.dag) keys.add(e.key); }
    this.svc.trace = null;
    const copies: Record<string, number> = {};
    for (const o of segment(frame, W, H, { conn, tau: 1 })) if (!o.spans) copies[o.cells.join(",")] = (copies[o.cells.join(",")] ?? 0) + 1;
    const m: Measure = {
      occupied: r.baselines.occupied, objects: r.objects, cw: r.copies.T.copyWeightedConstruction,
      sharedBound: r.construction.sharedBound, reuseRatio: r.construction.reuseRatio, dagKeys: keys.size, copies,
    };
    this.memo.set(key, m);
    return m;
  }
  /** Copies of the class `key` (a T key). With `d4`, objects equal to it up to rotation and reflection also count (equivalence-class uncertainty). */
  copiesOf(frame: Uint8Array, conn: Conn, key: string, d4 = false): number {
    let n = 0;
    const want = d4 ? canonicalKey(keyCells(key), "D4") : key;
    for (const o of segment(frame, W, H, { conn, tau: 1 })) if (!o.spans && (d4 ? canonicalKey(o.cells, "D4") : o.cells.join(",")) === want) n++;
    return n;
  }
}

/**
 * identityReturn = (n2 - n1) / (n0 - n1), clamped to [0, 1]. Defined only if n0 >= minCopies and the damage removed
 * target copies (n1 < n0). A survival-only outcome (n1 = n2) is 0.
 */
export function identityReturn(n0: number, n1: number, n2: number): Rat | null {
  if (n0 < DPROTOCOL.minCopies || n1 >= n0) return null;
  const gain = Math.max(0, n2 - n1), lost = n0 - n1;
  return gain >= lost ? rat(1, 1) : rat(gain, lost);
}
export const identityAtLeastHalf = (r: Rat | null): boolean => r !== null && r.num * DPROTOCOL.identityDen >= r.den * DPROTOCOL.identityNum;

/** Key count at each of the last `persistenceRounds` rounds is at least ceil(n0 / 2). */
export function persistent(roundCounts: readonly number[], n0: number): boolean {
  const need = Math.ceil(n0 / 2);
  const last = roundCounts.slice(-DPROTOCOL.persistenceRounds);
  return last.length === DPROTOCOL.persistenceRounds && last.every((c) => c >= need);
}

/** levelReturn: true / false, or null (undefined) on a zero baseline or an empty regrowth (occupied < 3/4 M). Never true when undefined. */
export function levelReturn(cwBefore: number, cwAfter: number, occupiedAfter: number): boolean | null {
  if (cwBefore <= 0) return null;
  if (occupiedAfter * DPROTOCOL.occupancyFloorDen < M * DPROTOCOL.occupancyFloorNum) return null;
  return cwAfter * DPROTOCOL.levelKeepDen >= cwBefore * DPROTOCOL.levelKeepNum;
}

/** highAssembly: construction readouts eligible (>= 2 distinct non-monomer keys) and cw >= 1/2 of the pre-damage hier-12 reference. A level gate only. */
export function highAssembly(m: Measure, hierReferenceCw: number): boolean {
  return m.dagKeys >= DPROTOCOL.highMinKeys && m.cw * DPROTOCOL.highRefDen >= hierReferenceCw * DPROTOCOL.highRefNum;
}
