// Pure founder-identity bookkeeping for tools/anticip.ts: which M3 founder
// cluster a census's living cells belong to, so a per-founder-cluster
// biomass/abundance breakdown can be reported alongside the world-level
// totals the primary analysis uses.
//
// With `mutRate: 0` (the FOUNDER control's condition), a component's
// dominant lineage key never changes identity: `packages/schema/src/world.ts`'s
// `buildWorld` assigns a founder's lineage id once, at placement, and the
// only other place a lineage id is ever minted is a mutation event --
// impossible at `mutRate: 0`. So the lineage key a census already computes
// (`Census.components[i].lineage`/`LineageStat.key`,
// `packages/metrics/src/census.ts`) identifies exactly which founder a
// component descends from throughout the whole run, with no genome-byte
// comparison needed. Under the EVOLVED arm (`mutRate > 0`), a mutation can
// mint a fresh, non-founder lineage id; such cells fall into
// `FounderAbundance.other` below rather than being misattributed.
//
// This deliberately does not touch packages/schema: it only reconstructs,
// from the outside, the exact deterministic mapping `buildWorld`/`m3World`
// already document as part of their public contract (a founder's raw
// lineage id is `founderIndex + 1`, packed through the same
// `packLineageLo`; m3World's founder `i` draws its genome from
// `M3_FOUNDERS[i % M3_FOUNDERS.length]`) -- not a new rule, and nothing
// here is imported by, or changes, sim-ref/sim-gpu.
import { M3_FOUNDERS, packLineageLo, type WorldConfig } from "@bl/schema";

/**
 * The `"hi:lo"` lineage key (`Census`/`LineageStat`'s own key format,
 * `census.ts`'s `lin()`) an `m3World` founder at 0-based `founderIndex` is
 * given at world construction. `LIN_HI` is always 0 for a founder
 * (`buildWorld`'s `encodeGenome(f.genome, 0, packLineageLo(cfg, rawId))`,
 * `rawId = founderIndex + 1`).
 */
export function founderLineageKey(cfg: Pick<WorldConfig, "ringNamespace">, founderIndex: number): string {
  const rawId = founderIndex + 1;
  return `0:${packLineageLo(cfg, rawId)}`;
}

/**
 * The M3-confirmed genetic cluster id `m3World`'s founder `i` (0-based)
 * actually draws its genome from (`M3_FOUNDERS[i % M3_FOUNDERS.length]`,
 * matching `m3World`'s own founder-to-genome assignment exactly). Only
 * meaningful for an `init.kind === "m3"` world.
 */
export function founderClusters(founderCount: number): number[] {
  return Array.from({ length: founderCount }, (_, i) => M3_FOUNDERS[i % M3_FOUNDERS.length].cluster);
}

/**
 * Maps every `m3World` founder's lineage key (0-based index
 * `0..founderCount-1`) to its M3-confirmed genetic cluster id (see
 * `founderClusters`). Only meaningful for an `init.kind === "m3"` world; a
 * generalist/soup world's founders have no cluster identity to map to and
 * should not call this.
 */
export function founderClusterMap(cfg: Pick<WorldConfig, "ringNamespace">, founderCount: number): Map<string, number> {
  const clusters = founderClusters(founderCount);
  const m = new Map<string, number>();
  for (let i = 0; i < founderCount; i++) m.set(founderLineageKey(cfg, i), clusters[i]);
  return m;
}

/** Per-founder-cluster abundance at one census, in whatever unit `metric` reports. */
export interface FounderAbundance {
  /** cluster id -> aggregated metric at this census. */
  byCluster: Record<number, number>;
  /** Cells belonging to a lineage key not traceable to any founder in
   * `clusterMap` -- possible only with `mutRate > 0` (a mutation mints a
   * fresh, non-founder lineage id) -- folded in here rather than silently
   * dropped, so `other` summed with every `byCluster` entry always accounts
   * for the census's full total. */
  other: number;
}

/**
 * Aggregates a census's already-computed per-lineage stats
 * (`Census.lineages`, a `LineageStat[]`) into per-founder-cluster abundance
 * via `clusterMap` (from `founderClusterMap`). `metric` picks which field of
 * each lineage stat to sum -- living-cell count by default, or biomass
 * (`l => l.mass`) for the descriptive per-founder biomass breakdown
 * `tools/anticip.ts` reports at the Phase A/B boundary.
 */
export function founderAbundance(
  clusterMap: Map<string, number>,
  lineages: { key: string; cells: number; mass?: number }[],
  metric: (l: { key: string; cells: number; mass?: number }) => number = (l) => l.cells,
): FounderAbundance {
  const byCluster: Record<number, number> = {};
  let other = 0;
  for (const l of lineages) {
    const v = metric(l);
    const cluster = clusterMap.get(l.key);
    if (cluster === undefined) {
      other += v;
      continue;
    }
    byCluster[cluster] = (byCluster[cluster] ?? 0) + v;
  }
  return { byCluster, other };
}
