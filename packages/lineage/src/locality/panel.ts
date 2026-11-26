// Panels of the I05 locality study (I05b power-up, docs/controller-locality-power-2026-11-02/AMENDMENT.md).
// A panel fixes everything that differs between the original assay and the larger one: salt, assay seeds, draw counts,
// allocation, candidate list, null tag namespace and the PR136 hashes excluded from the draw. The decision rule, the
// operator, the scenarios, tau and the gate are NOT panel parameters. Pure, integer and browser-safe.
import type { Allocation, NbParams } from "./neighbourhood.ts";

export type SlotSpec = { slot: "sparse" | "dense"; clusters: number[] };

export interface Panel {
  id: string;
  nb: NbParams;
  /** Assay seeds. The count is part of tau and the viable floor, so a panel must keep the original count. */
  seeds: readonly number[];
  allocM3: Allocation;
  allocControl: Allocation;
  /** Per start genome allocation, when pools differ between genomes (overrides allocM3 / allocControl). */
  allocByGenome?: Record<string, Allocation>;
  slots: SlotSpec[];
  /** Prefix of the degree-matched null replicate tags (`${prefix}${genome}:null:${r}`). */
  nullPrefix: string;
  /** Genome id -> sorted genome hashes (any earlier panel's edits of that start genome) that have zero inclusion probability. */
  exclude: Record<string, string[]>;
}

export const allocFor = (panel: Panel, genomeId: string, control: boolean): Allocation => panel.allocByGenome?.[genomeId] ?? (control ? panel.allocControl : panel.allocM3);
export const excludeSet = (panel: Panel, genomeId: string): ReadonlySet<string> | undefined => (panel.exclude[genomeId]?.length ? new Set(panel.exclude[genomeId]) : undefined);

// ---- The power panel --------------------------------------------------------------------------------------

export const POWER_ID = "power-v1";
export const POWER_SALT = 0x1c0de06;
export const POWER_SEEDS = [101, 102] as const;
/** Same families as PR136, wider draws: the b kinds exhaust their pools (8 hidden units, 8 actuators). */
export const POWER_NB: NbParams = { salt: POWER_SALT, singleSlots: { w1: 40, b1: 8, w2: 32, b2: 8 }, drawsPerMulti: 64, secondary: false };
export const POWER_NULL_PREFIX = "power:";
/** One candidate per slot: if a genome fails the gate under the new seeds there is no substitution. */
export const POWER_SLOTS: SlotSpec[] = [{ slot: "sparse", clusters: [4] }, { slot: "dense", clusters: [9] }];
/** Control (generalist) allocation is PR136's, 8 edits: it serves the sensitivity and neutral controls only. */
export const POWER_ALLOC_CONTROL: Allocation = { "single24/w1": 2, "single24/w2": 2, "single24/b1": 1, "single24/b2": 1, "single24/physics": 1, "multi2/multi": 1 };

export const SINGLE_FAMILIES = ["single6", "single24"] as const;
export const MULTI_FAMILIES = ["multi2", "multi4"] as const;
/** Fixed order of the single-locus kinds: used for ties in rounding and as the spill order of a deficit. */
export const KIND_ORDER = ["w1", "b1", "w2", "b2", "physics"] as const;

/**
 * The structural allocation rule, written before any pool was counted and independent of any outcome.
 * Per family an equal share N/4 (families single6, single24, multi2, multi4). Within a single-locus family, the share is split
 * over the five kinds proportionally to their ELIGIBLE pool sizes by largest remainder (ties by KIND_ORDER); a kind is capped at
 * its pool, and the deficit is moved to w1 of the same family, then to w2, b1, b2, physics while capacity remains.
 * A multi family takes min(share, pool); its deficit is moved to the other multi family, then to w1 of single24, then of single6.
 * Throws when the total cannot be placed (the freeze then stops; no third path).
 */
export function deriveAllocation(n: number, pools: Record<string, number>): Allocation {
  if (n % 4 !== 0) throw new Error("N must be divisible by 4 (equal share per family)");
  const share = n / 4;
  const alloc: Allocation = {};
  const cap = (k: string) => pools[k] ?? 0;
  for (const fam of SINGLE_FAMILIES) {
    const keys = KIND_ORDER.map((k) => `${fam}/${k}`);
    const total = keys.reduce((a, k) => a + cap(k), 0);
    if (total === 0) throw new Error(`no eligible edits in ${fam}`);
    // Largest-remainder quotas (integer arithmetic).
    const quota = keys.map((k) => Math.floor((share * cap(k)) / total));
    let left = share - quota.reduce((a, b) => a + b, 0);
    const order = keys.map((k, i) => ({ i, rem: (share * cap(k)) % total })).sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i } of order) { if (left === 0) break; quota[i]++; left--; }
    let deficit = 0;
    keys.forEach((k, i) => { const t = Math.min(quota[i], cap(k)); deficit += quota[i] - t; quota[i] = t; });
    for (const i of [0, 2, 1, 3, 4]) { // w1, w2, b1, b2, physics
      const room = cap(keys[i]) - quota[i], mv = Math.min(room, deficit);
      quota[i] += mv; deficit -= mv;
    }
    if (deficit) throw new Error(`${fam}: cannot place ${deficit} edits within its pools`);
    keys.forEach((k, i) => { if (quota[i] > 0) alloc[k] = quota[i]; });
  }
  let spill = 0;
  const multi: Record<string, number> = {};
  for (const fam of MULTI_FAMILIES) { const k = `${fam}/multi`; multi[k] = Math.min(share, cap(k)); spill += share - multi[k]; }
  for (const k of Object.keys(multi)) { const mv = Math.min(spill, cap(k) - multi[k]); multi[k] += mv; spill -= mv; }
  for (const fam of ["single24", "single6"]) { const k = `${fam}/w1`, mv = Math.min(spill, cap(k) - (alloc[k] ?? 0)); if (mv) alloc[k] = (alloc[k] ?? 0) + mv; spill -= mv; }
  if (spill) throw new Error(`cannot place ${spill} edits within the pools`);
  for (const [k, v] of Object.entries(multi)) if (v > 0) alloc[k] = v;
  const sum = Object.values(alloc).reduce((a, b) => a + b, 0);
  if (sum !== n) throw new Error(`allocation sums to ${sum}, not ${n}`);
  return alloc;
}

export function powerPanel(exclude: Record<string, string[]>, allocByGenome: Record<string, Allocation>): Panel {
  return { id: POWER_ID, nb: POWER_NB, seeds: POWER_SEEDS, allocM3: {}, allocControl: POWER_ALLOC_CONTROL, allocByGenome, slots: POWER_SLOTS, nullPrefix: POWER_NULL_PREFIX, exclude };
}

// ---- Disjointness from an earlier panel ---------------------------------------------------------------------

/** Each reason is independent, so a fixture that overlaps in one respect only fails for that reason. */
export function disjointnessProblems(panel: Panel, earlier: { seeds: readonly number[]; salt: number; nullPrefix: string; hashes: Record<string, readonly string[]> }, assayedHashes: Record<string, readonly string[]>): string[] {
  const out: string[] = [];
  const seeds = new Set(earlier.seeds);
  if (panel.seeds.some((s) => seeds.has(s))) out.push("assay seeds overlap the earlier panel's");
  if (panel.nb.salt === earlier.salt) out.push("neighbourhood salt equals the earlier panel's");
  if (panel.nullPrefix === earlier.nullPrefix) out.push("null replicate namespace equals the earlier panel's");
  if (panel.seeds.length !== earlier.seeds.length) out.push("seed count differs from the earlier panel's (tau and the viable floor use it)");
  for (const [g, hs] of Object.entries(assayedHashes)) {
    const prior = new Set(earlier.hashes[g] ?? []);
    if (hs.some((h) => prior.has(h))) out.push(`${g}: an assayed genome hash occurs among the earlier panel's edits`);
  }
  return out;
}

// ---- Exact binomial tail --------------------------------------------------------------------------------------

const C = (n: number, k: number): bigint => { let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i); return r; };
/** P(X >= k) for X ~ Binomial(n, pn/pd), as an exact rational {num, den}. */
export function binomialAtLeast(n: number, k: number, pn: number, pd: number): { num: bigint; den: bigint } {
  const den = BigInt(pd) ** BigInt(n);
  let below = 0n;
  for (let a = 0; a < k; a++) below += C(n, a) * BigInt(pn) ** BigInt(a) * BigInt(pd - pn) ** BigInt(n - a);
  return { num: den - below, den };
}
/** The probability rounded down to `digits` decimals, as a string such as "0.905". */
export function decimal(r: { num: bigint; den: bigint }, digits: number): string {
  const scaled = (r.num * 10n ** BigInt(digits)) / r.den;
  const s = scaled.toString().padStart(digits + 1, "0");
  return `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}`;
}
