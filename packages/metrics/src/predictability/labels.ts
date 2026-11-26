// Frozen decision table (reference observer r=1, h=1). Labels describe predictor behaviour on a movie, not the substrate.

export const LABELS = ["uninformative", "exact", "noise-like", "partial"] as const;
export type Label = (typeof LABELS)[number];

export interface LabelInput {
  cells: number;
  erased: boolean;
  /** Lowest error count over the four predictors. */
  lBest: number;
  /** Error count of the marginal baseline. */
  lMarginal: number;
  /** Lowest error count over the four predictors on the time-shuffled movie (same origins, same cells). */
  lBestShuffled: number;
}

/** Rules apply in order; every comparison is by integer cross-multiplication. */
export function decideLabel(x: LabelInput): Label {
  if (x.cells === 0 || x.erased) return "uninformative";
  if (x.lBest === 0) return "exact";
  if (100 * x.lBest >= 95 * x.lMarginal && 50 * Math.abs(x.lBestShuffled - x.lBest) <= x.cells) return "noise-like";
  return "partial";
}
