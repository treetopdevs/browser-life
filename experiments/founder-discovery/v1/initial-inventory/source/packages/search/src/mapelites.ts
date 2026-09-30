// MAP-Elites archive over genomes (M3 bootstrap). The search only expands the
// repertoire of viable founders; ensemble runs switch it off, and none of the
// held-out observables is a descriptor or part of quality.

import { CLUSTER_DISTANCE, NN_BYTES, draw, genomeDistance, geneticClusters, lowbias32, type Genome } from "@bl/schema";
import { quality, type Evaluation } from "./evaluate.ts";

// CLUSTER_DISTANCE/genomeDistance/geneticClusters used to be defined here;
// they now live in @bl/schema's genetics.ts (island-biogeography analysis in
// @bl/metrics needs them too, and importing anything from @bl/search into
// @bl/metrics would otherwise be circular -- see genetics.ts's own doc
// comment). Re-exported here so every existing caller of this module
// (tools/retest.ts, tools/bootstrap.ts, packages/search/test/gate.test.ts,
// this file's own M3Gate code below) keeps importing them from `@bl/search`
// unchanged.
export { CLUSTER_DISTANCE, genomeDistance, geneticClusters };

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

export interface Lineage {
  /** Members tied at the highest quality (several once quality saturates at 1). */
  best: Elite[];
  size: number;
  /** Members that passed screening (passesGate). */
  passers: number;
}

export const DEFAULT_ARCHIVE: ArchiveSpec = { bins: 8, massRange: [7, 13], speedRange: [0, 4] };

export type ScoreFn = (e: Evaluation) => number;

export class Archive {
  readonly cells = new Map<string, Elite>();
  /** Every distinct genome that passed the M3 gate, kept even if displaced from its cell. */
  readonly passers = new Map<string, Elite>();
  evaluated = 0;
  /** Every viable genome offered (quality > 0); `link` joins them into lineages (union-find). */
  private readonly viable: Elite[] = [];
  private readonly link: number[] = [];
  private lineageCache?: Lineage[];

  constructor(
    readonly spec: ArchiveSpec = DEFAULT_ARCHIVE,
    /** Archive insertion score; defaults to `quality`. `--score maintenance` passes `qualityMaintenance`. */
    readonly score: ScoreFn = quality,
  ) {}

  cellOf(e: Evaluation): [number, number] {
    const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(this.spec.bins - 1, Math.floor(((v - lo) / (hi - lo)) * this.spec.bins)));
    return [bin(Math.log2(Math.max(1, e.meanMass)), this.spec.massRange), bin(e.speed, this.spec.speedRange)];
  }

  /** Inserts if the cell is empty or the candidate is better. Returns true when inserted. */
  offer(genome: Genome, e: Evaluation, born: number): boolean {
    this.evaluated++;
    const q = this.score(e);
    if (q <= 0) return false;
    const cell = this.cellOf(e);
    const idx = this.viable.length;
    this.viable.push({ genome, eval: e, quality: q, cell, born });
    this.link.push(idx);
    this.lineageCache = undefined;
    for (let j = 0; j < idx; j++) {
      const rj = this.root(j), ri = this.root(idx);
      if (rj !== ri && genomeDistance(genome, this.viable[j].genome, CLUSTER_DISTANCE) <= CLUSTER_DISTANCE) this.link[rj] = ri;
    }
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

  private root(i: number): number {
    while (this.link[i] !== i) i = this.link[i] = this.link[this.link[i]];
    return i;
  }

  /**
   * Genetic lineages: single-linkage clusters (CLUSTER_DISTANCE) over every
   * viable genome offered, the relation the M3 gate counts, including members
   * since displaced from their cells.
   */
  lineages(): Lineage[] {
    if (this.lineageCache) return this.lineageCache;
    const by = new Map<number, Lineage>();
    this.viable.forEach((el, i) => {
      const r = this.root(i);
      const l = by.get(r) ?? { best: [], size: 0, passers: 0 };
      if (!l.best.length || el.quality > l.best[0].quality) l.best = [el];
      else if (el.quality === l.best[0].quality) l.best.push(el);
      l.size++;
      if (passesGate(el.eval)) l.passers++;
      by.set(r, l);
    });
    return (this.lineageCache = [...by.values()]);
  }

  /**
   * A parent chosen by lineage rather than by cell, so that one lineage
   * holding many cells does not crowd out the others: with probability
   * `passBias` a lineage with a screening passer (if any), otherwise any
   * lineage, uniformly; then one of that lineage's best members, uniformly,
   * so that equally good descendants keep carrying the lineage forward.
   */
  pickParent(seed: number, passBias = 0.5): Elite | undefined {
    const ls = this.lineages();
    if (!ls.length) return undefined;
    const withPass = ls.filter((l) => l.passers > 0);
    const u = lowbias32(seed ^ 0x5bd1e995) / 2 ** 32;
    return pick(pick(withPass.length && u < passBias ? withPass : ls, seed).best, seed ^ 0x27d4eb2f);
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

  /** Viable offers in order, from index `from`; `Archive.replay` of the whole log rebuilds this archive exactly. */
  viableLog(from = 0): Elite[] {
    return this.viable.slice(from);
  }

  /**
   * Rebuilds an archive from a viable-offer log (see viableLog) and the total
   * number of candidates evaluated. Non-viable offers change nothing but the
   * count, so replaying the viable ones in order reproduces cells, passers and
   * lineages exactly.
   */
  static replay(log: { genome: Genome; eval: Evaluation; born: number }[], evaluated: number, spec = DEFAULT_ARCHIVE, score: ScoreFn = quality): Archive {
    const a = new Archive(spec, score);
    for (const r of log) a.offer(r.genome, r.eval, r.born);
    a.evaluated = evaluated;
    return a;
  }
}

/** Parses a CLI probability such as --pass-bias, refusing blank, non-numeric and out-of-range values. */
export function parseProbability(flag: string, raw: string | undefined): number {
  const v = raw !== undefined && /^\s*[0-9.eE+-]+\s*$/.test(raw) ? Number(raw) : NaN;
  if (!(v >= 0 && v <= 1)) throw new Error(`${flag} must be a probability in [0, 1], not ${JSON.stringify(raw ?? null)}`);
  return v;
}

export function passesGate(e: Evaluation, minRecovery = 0.8): boolean {
  return e.survived > 0 && e.regenerated / e.reps > minRecovery && e.lightDependent === e.reps;
}

/** Replicates per genome when confirming screening passers on fresh seeds. */
export const CONFIRM_REPS = 16;
/** Distinct genetic clusters of confirmed passers the M3 gate requires. */
export const M3_MIN_CLUSTERS = 20;

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
