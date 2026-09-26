// MAP-Elites archive over genomes (M3 bootstrap). The search only expands the
// repertoire of viable founders; ensemble runs switch it off, and none of the
// held-out observables is a descriptor or part of quality.

import { NN_BYTES, draw, lowbias32, type Genome } from "@bl/schema";
import { quality, type Evaluation } from "./evaluate.ts";

export interface Elite {
  genome: Genome;
  eval: Evaluation;
  quality: number;
  cell: [number, number];
  born: number;
}

export interface ArchiveSpec {
  /** Bins along each descriptor. */
  bins: number;
  /** log2 range of mean individual mass. */
  massRange: [number, number];
  /** Speed range (cells per 100 steps). */
  speedRange: [number, number];
}

export const DEFAULT_ARCHIVE: ArchiveSpec = { bins: 8, massRange: [7, 13], speedRange: [0, 4] };

export class Archive {
  readonly cells = new Map<string, Elite>();
  /** Every distinct genome that passed the M3 gate, kept even if displaced from its cell. */
  readonly passers = new Map<string, Elite>();
  evaluated = 0;

  constructor(readonly spec: ArchiveSpec = DEFAULT_ARCHIVE) {}

  cellOf(e: Evaluation): [number, number] {
    const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(this.spec.bins - 1, Math.floor(((v - lo) / (hi - lo)) * this.spec.bins)));
    return [bin(Math.log2(Math.max(1, e.meanMass)), this.spec.massRange), bin(e.speed, this.spec.speedRange)];
  }

  /** Inserts if the cell is empty or the candidate is better. Returns true when inserted. */
  offer(genome: Genome, e: Evaluation, born: number): boolean {
    this.evaluated++;
    const q = quality(e);
    if (q <= 0) return false;
    const cell = this.cellOf(e);
    if (passesGate(e)) {
      const key = genomeKey(genome);
      if (!this.passers.has(key)) this.passers.set(key, { genome, eval: e, quality: q, cell, born });
    }
    const key = cell.join(",");
    const cur = this.cells.get(key);
    if (cur && cur.quality >= q) return false;
    this.cells.set(key, { genome, eval: e, quality: q, cell, born });
    return true;
  }

  elites(): Elite[] {
    return [...this.cells.values()];
  }

  /**
   * Distinct genomes that passed the M3 gate (see passesGate): an individual
   * regenerates from a 30% lesion with p > 0.8 across replicates, and the form
   * dies without light while its illuminated control stays viable, in every
   * replicate (active, not passive, maintenance).
   */
  gatePassing(): Elite[] {
    return [...this.passers.values()];
  }

  coverage(): number {
    return this.cells.size / (this.spec.bins * this.spec.bins);
  }
}

export function passesGate(e: Evaluation, minRecovery = 0.8): boolean {
  return e.survived > 0 && e.regenerated / e.reps > minRecovery && e.lightDependent === e.reps;
}

/** Replicates per genome when confirming screening passers on fresh seeds. */
export const CONFIRM_REPS = 16;
/** Distinct genetic clusters of confirmed passers the M3 gate requires. */
export const M3_MIN_CLUSTERS = 20;
/**
 * Genomes at most this many slots apart belong to one cluster. mutateGenome
 * changes 1-4 slots per child, so this links a founder with its descendants
 * over several generations, while unrelated genomes differ in nearly all
 * NN_BYTES + 3 slots.
 */
export const CLUSTER_DISTANCE = 10;

/** Number of genome slots (weights, mu, sigma, motGain) that differ. */
export function genomeDistance(a: Genome, b: Genome): number {
  let d = Number(a.mu !== b.mu) + Number(a.sigma !== b.sigma) + Number(a.motGain !== b.motGain);
  for (let i = 0; i < a.weights.length; i++) if (a.weights[i] !== b.weights[i]) d++;
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
      if (genomeDistance(genomes[i], genomes[j]) <= maxDistance) parent[root(i)] = root(j);
    }
  }
  const ids = new Map<number, number>();
  return genomes.map((_, i) => {
    const r = root(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

export interface M3Gate {
  /** Screening passers re-evaluated. */
  screened: number;
  /** Of those, how many pass again on fresh seeds (confirmsGate). */
  confirmed: number;
  /** Genetic clusters among the confirmed passers (what the gate counts). */
  clusters: number;
  met: boolean;
}

/** A fresh-seed confirmation that counts toward the M3 gate: passesGate over at least `minReps` replicates. */
export function confirmsGate(e: Evaluation, minReps = CONFIRM_REPS): boolean {
  return e.reps >= minReps && passesGate(e);
}

/**
 * The M3 gate over fresh-seed confirmations of the screening passers: at
 * least M3_MIN_CLUSTERS genetically distinct clusters whose members still
 * regenerate with p > 0.8 and die without light over at least CONFIRM_REPS
 * replicates. Screening passes alone do not
 * count: with few replicates per candidate, many of thousands screened pass by
 * chance.
 */
export function m3Gate(confirmations: { genome: Genome; eval: Evaluation }[], minClusters = M3_MIN_CLUSTERS, minReps = CONFIRM_REPS): M3Gate {
  const ok = confirmations.filter((c) => confirmsGate(c.eval, minReps));
  const clusters = new Set(geneticClusters(ok.map((c) => c.genome))).size;
  return { screened: confirmations.length, confirmed: ok.length, clusters, met: clusters >= minClusters };
}

/** Identity of a genome by its parameters and weights. */
export function genomeKey(g: Genome): string {
  return `${g.mu}:${g.sigma}:${g.motGain}:${Array.from(g.weights).join(",")}`;
}

/** A few random weight/parameter perturbations, deterministic in `seed`. */
export function mutateGenome(g: Genome, seed: number, count = 3, step = 24): Genome {
  const out: Genome = { ...g, weights: g.weights.slice() };
  const base = lowbias32(seed ^ 0xa5a5a5a5);
  for (let k = 0; k < count; k++) {
    const slot = draw(base, 3 * k) % (NN_BYTES + 3);
    const d = (draw(base, 3 * k + 1) % (2 * step + 1)) - step || 1;
    if (slot < NN_BYTES) out.weights[slot] = Math.max(-127, Math.min(127, out.weights[slot] + d));
    else if (slot === NN_BYTES) out.mu = Math.max(16, Math.min(4095, out.mu + d));
    else if (slot === NN_BYTES + 1) out.sigma = Math.max(2, Math.min(1023, out.sigma + (d >> 2 || Math.sign(d))));
    else out.motGain = Math.max(0, Math.min(255, out.motGain + d));
  }
  return out;
}

export function pick<T>(xs: T[], seed: number): T {
  return xs[lowbias32(seed) % xs.length];
}
