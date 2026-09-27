// Pure genome-distance/clustering utilities, used by the M3 gate
// (packages/search) and by island-biogeography analysis (packages/metrics).
// Lives in @bl/schema (not @bl/search) because it has zero dependency on
// search's MAP-Elites/GPU-evaluation machinery -- only on the Genome type --
// and because packages/metrics needs it too: @bl/search's own barrel
// (index.ts) re-exports retest.ts, which imports @bl/metrics, and
// mapelites.ts itself imports evaluate.ts, which also imports @bl/metrics --
// so any import of anything in @bl/search from @bl/metrics creates a real
// module cycle back through @bl/metrics's own barrel. @bl/schema imports
// nothing from search, metrics, runner, sim-gpu or sim-ref, so importing
// these three functions from here instead introduces no cycle at all.
import type { Genome } from "./genome.ts";

/**
 * Genomes at most this many slots apart belong to one cluster. mutateGenome
 * changes 1-4 slots per child, so this links a founder with its descendants
 * over several generations, while unrelated genomes differ in nearly all
 * NN_BYTES + 3 slots.
 */
export const CLUSTER_DISTANCE = 10;

/** Number of genome slots (weights, mu, sigma, motGain) that differ; stops counting once past `limit`. */
export function genomeDistance(a: Genome, b: Genome, limit = Infinity): number {
  let d = Number(a.mu !== b.mu) + Number(a.sigma !== b.sigma) + Number(a.motGain !== b.motGain);
  for (let i = 0; i < a.weights.length && d <= limit; i++) if (a.weights[i] !== b.weights[i]) d++;
  return d;
}

/**
 * Single-linkage clusters: a genome within `maxDistance` slots of any member
 * joins its cluster. Returns a cluster index per genome, numbered from 0 in
 * order of first appearance.
 */
export function geneticClusters(genomes: Genome[], maxDistance = CLUSTER_DISTANCE): number[] {
  const parent = genomes.map((_, i) => i);
  // Iterative with path halving: unions are unranked, so chains can be long.
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < genomes.length; i++) {
    for (let j = i + 1; j < genomes.length; j++) {
      if (genomeDistance(genomes[i], genomes[j], maxDistance) <= maxDistance) parent[root(i)] = root(j);
    }
  }
  const ids = new Map<number, number>();
  return genomes.map((_, i) => {
    const r = root(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}
