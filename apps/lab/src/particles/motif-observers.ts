import type { Family, Particle } from './model.ts';

export const MOTIF_SPATIAL_BINS = 12;
export const MOTIF_FAMILY_COUNT = 3;
export const MOTIF_HISTOGRAM_SIZE = MOTIF_SPATIAL_BINS * MOTIF_SPATIAL_BINS * MOTIF_FAMILY_COUNT;

/** Dense family-major-by-bin count vector, with index `(by * 12 + bx) * 3 + family`. */
export interface OccupancyHistogram {
  readonly population: number;
  readonly counts: readonly number[];
}

function validateCoordinate(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a finite torus coordinate from 0 through 1`);
  // A coordinate of exactly one can arise from numerical endpoint rounding.
  return Math.min(MOTIF_SPATIAL_BINS - 1, Math.floor(value * MOTIF_SPATIAL_BINS));
}

function validateHistogram(histogram: OccupancyHistogram): void {
  if (!histogram || typeof histogram !== 'object' || !Array.isArray(histogram.counts) || histogram.counts.length !== MOTIF_HISTOGRAM_SIZE) {
    throw new Error(`Histogram must contain exactly ${MOTIF_HISTOGRAM_SIZE} dense counts`);
  }
  if (!Number.isSafeInteger(histogram.population) || histogram.population < 0) throw new Error('Histogram population must be a non-negative safe integer');
  let total = 0;
  for (const count of histogram.counts) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Histogram counts must be non-negative safe integers');
    total += count;
  }
  if (total !== histogram.population) throw new Error('Histogram counts must sum to population');
}

/** Build a copied dense histogram without changing particles or any simulation state. */
export function buildOccupancyHistogram(particles: readonly Particle[]): OccupancyHistogram {
  if (!Array.isArray(particles)) throw new Error('Particles must be an array');
  const counts = new Array<number>(MOTIF_HISTOGRAM_SIZE).fill(0);
  for (const particle of particles) {
    if (particle.family !== 0 && particle.family !== 1 && particle.family !== 2) throw new Error('Particle family must be 0, 1, or 2');
    const bx = validateCoordinate(particle.x, 'Particle x');
    const by = validateCoordinate(particle.y, 'Particle y');
    counts[(by * MOTIF_SPATIAL_BINS + bx) * MOTIF_FAMILY_COUNT + particle.family as Family]++;
  }
  return Object.freeze({ population: particles.length, counts: Object.freeze(counts) });
}

/** Count spatial bins containing any of the three families. */
export function occupiedSpatialBins(histogram: OccupancyHistogram): number {
  validateHistogram(histogram);
  let occupied = 0;
  for (let bin = 0; bin < MOTIF_SPATIAL_BINS * MOTIF_SPATIAL_BINS; bin++) {
    const start = bin * MOTIF_FAMILY_COUNT;
    if (histogram.counts[start] + histogram.counts[start + 1] + histogram.counts[start + 2] > 0) occupied++;
  }
  return occupied;
}

/** Total variation between globally normalized family occupancy histograms. */
export function totalVariationDistance(current: OccupancyHistogram, previous: OccupancyHistogram): number {
  validateHistogram(current);
  validateHistogram(previous);
  if ((current.population === 0) !== (previous.population === 0)) return 1;
  let absoluteDifference = 0;
  for (let i = 0; i < MOTIF_HISTOGRAM_SIZE; i++) {
    const currentProbability = current.population === 0 ? 0 : current.counts[i] / current.population;
    const previousProbability = previous.population === 0 ? 0 : previous.counts[i] / previous.population;
    absoluteDifference += Math.abs(currentProbability - previousProbability);
  }
  return absoluteDifference / 2;
}
