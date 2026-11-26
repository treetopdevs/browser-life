// The genotype panel: the hand-built generalist, three genetically separated M3 founders, and a weakened generalist.
import { M3_FOUNDERS, M3_FOUNDER_SET, OUT, defaultConfig, founderGenome, generalistGenome, genomeDistance, genomeHex, w2, type Genome } from "@bl/schema";

export const PANEL_IDS = ["G", "F1", "F2", "F3", "W"] as const;
export type GenotypeId = (typeof PANEL_IDS)[number];

export const generalist = (): Genome => { const c = defaultConfig(); return generalistGenome(c.defaultMu, c.defaultSigma); };

/** Photosynthesis output weight of the generalist (w2(1, PHOTO) = 110). */
export const photoIndex = (): number => w2(1, OUT.PHOTO);

/** Weakened copy: the photosynthesis output weight reduced by `percent`, rounded toward zero. Nothing else changes. */
export function weaken(g: Genome, percent: number): Genome {
  const w = Int8Array.from(g.weights);
  const i = photoIndex();
  w[i] = Math.trunc((w[i] * (100 - percent)) / 100);
  return { ...g, weights: w };
}

/** Deterministic farthest-point pick on genomeDistance, starting from `start`; ties go to the lower founder index. Returns founder indices. */
export function farthestPoints(start: Genome, pool: readonly Genome[], count: number): number[] {
  const chosen: number[] = [];
  const have: Genome[] = [start];
  for (let k = 0; k < count; k++) {
    let best = -1, bestD = -1;
    pool.forEach((g, i) => {
      if (chosen.includes(i)) return;
      const d = Math.min(...have.map((h) => genomeDistance(g, h)));
      if (d > bestD) { bestD = d; best = i; }
    });
    chosen.push(best);
    have.push(pool[best]);
  }
  return chosen;
}

export interface Panel {
  founderSet: string;
  founderIndices: number[];
  genomes: Record<GenotypeId, Genome>;
  hex: Record<GenotypeId, string>;
  distances: Record<string, number>;
  weakenPercent: number;
}

export function buildPanel(weakenPercent: number): Panel {
  const g = generalist();
  const pool = M3_FOUNDERS.map(founderGenome);
  const idx = farthestPoints(g, pool, 3);
  const genomes = { G: g, F1: pool[idx[0]], F2: pool[idx[1]], F3: pool[idx[2]], W: weaken(g, weakenPercent) } as Record<GenotypeId, Genome>;
  const hex = Object.fromEntries(PANEL_IDS.map((id) => [id, genomeHex(genomes[id])])) as Record<GenotypeId, string>;
  const distances: Record<string, number> = {};
  for (let a = 0; a < PANEL_IDS.length; a++) for (let b = a + 1; b < PANEL_IDS.length; b++) distances[`${PANEL_IDS[a]}-${PANEL_IDS[b]}`] = genomeDistance(genomes[PANEL_IDS[a]], genomes[PANEL_IDS[b]]);
  return { founderSet: M3_FOUNDER_SET, founderIndices: idx, genomes, hex, distances, weakenPercent };
}
