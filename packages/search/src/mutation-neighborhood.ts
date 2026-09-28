// Exploratory one-step neighborhoods of the fixed M3 founders. The proposal
// is applied by the CPU reference mutation routine, not by MAP-Elites' helper.
import { M3_FOUNDERS, M3_FOUNDER_SET, NN_BYTES, decodeGenome, draw, encodeGenome, founderGenome, lowbias32, defaultConfig, type Genome } from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { genomeKey } from "./mapelites.ts";

export const MUTATION_SCALES = [1, 4, 24] as const;
export const DRAW_SEED_RESERVATION = [610000001, 610099999] as const;
export const ASSAY_SEED_RESERVATION = [620000001, 620099999] as const;
export const ASSAY_SMOKE_START = 620090001;

export interface EncodedGenome {
  mu: number;
  sigma: number;
  motGain: number;
  weights: number[];
  /** Channel-major words from encodeGenome with lineage words zero. */
  words: number[];
  /** Exact parameter/weight identity, independent of lineage words. */
  key: string;
}

export interface MutationProposal {
  id: string;
  founderIndex: number;
  founderCluster: number;
  scale: (typeof MUTATION_SCALES)[number];
  sampleIndex: number;
  rawWhich: number;
  rawDelta: number;
  slot: number;
  locus: { kind: "weight" | "mu" | "sigma" | "motGain"; index: number | null };
  /** Reference routine converts a zero draw to +1 before locus-specific scaling. */
  signedDelta: number;
  before: number;
  after: number;
  effectiveChange: number;
  unchangedAfterClamp: boolean;
  /** Earlier proposal id, or `fN:parent` when the result equals the parent. */
  duplicateOf: string | null;
  genome: EncodedGenome;
}

export interface MutationNeighborhood {
  founderSetId: string;
  drawSeed: number;
  samplesPerFounderPerScale: number;
  scales: readonly number[];
  founders: { index: number; cluster: number; genome: EncodedGenome }[];
  proposals: MutationProposal[];
  counts: { proposals: number; effective: number; unchangedAfterClamp: number; duplicateResults: number };
}

export function encodeForManifest(g: Genome): EncodedGenome {
  return {
    mu: g.mu, sigma: g.sigma, motGain: g.motGain,
    weights: Array.from(g.weights),
    words: Array.from(encodeGenome(g, 0, 0)),
    key: genomeKey(g),
  };
}

export function genomeFromManifest(g: EncodedGenome): Genome {
  return { mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights) };
}

/** One independent proposal from each parent for each draw; duplicates are retained. */
export function mutationNeighborhood(drawSeed: number, samplesPerFounderPerScale = 16): MutationNeighborhood {
  if (!Number.isSafeInteger(drawSeed) || drawSeed < DRAW_SEED_RESERVATION[0] || drawSeed > DRAW_SEED_RESERVATION[1])
    throw new Error(`draw seed must be in reserved range ${DRAW_SEED_RESERVATION.join("..")} `);
  if (!Number.isSafeInteger(samplesPerFounderPerScale) || samplesPerFounderPerScale < 1 || samplesPerFounderPerScale > 1000)
    throw new Error("samples per founder per scale must be an integer in 1..1000");

  const founders = M3_FOUNDERS.map((f, index) => ({ index, cluster: f.cluster, genome: encodeForManifest(founderGenome(f)) }));
  const proposals: MutationProposal[] = [];
  for (const f of founders) {
    const parent = genomeFromManifest(f.genome);
    const seen = new Map<string, string>([[f.genome.key, `f${f.index}:parent`]]);
    for (const scale of MUTATION_SCALES) {
      // Domain-separated streams give each founder and scale independent,
      // reproducible raw words without consuming simulation seed numbers.
      const base = lowbias32(drawSeed ^ Math.imul(f.index + 1, 0x9e3779b9) ^ Math.imul(scale, 0x85ebca6b));
      const cfg = defaultConfig({ mutRate: 0, mutStep: scale });
      for (let sampleIndex = 0; sampleIndex < samplesPerFounderPerScale; sampleIndex++) {
        const rawWhich = draw(base, 2 * sampleIndex);
        const rawDelta = draw(base, 2 * sampleIndex + 1);
        const slot = rawWhich % (NN_BYTES + 3);
        const locus: MutationProposal["locus"] = slot < NN_BYTES ? { kind: "weight", index: slot }
          : slot === NN_BYTES ? { kind: "mu", index: null }
          : slot === NN_BYTES + 1 ? { kind: "sigma", index: null }
          : { kind: "motGain", index: null };
        const signedDelta = (rawDelta % (2 * scale + 1)) - scale || 1;
        const before = slot < NN_BYTES ? parent.weights[slot]
          : slot === NN_BYTES ? parent.mu : slot === NN_BYTES + 1 ? parent.sigma : parent.motGain;
        const words = encodeGenome(parent, 0, 0);
        mutateInPlace(words, 1, 0, cfg, rawWhich, rawDelta);
        const mutant = decodeGenome(words);
        const after = slot < NN_BYTES ? mutant.weights[slot]
          : slot === NN_BYTES ? mutant.mu : slot === NN_BYTES + 1 ? mutant.sigma : mutant.motGain;
        const genome = encodeForManifest(mutant);
        const id = `f${f.index}-s${scale}-p${sampleIndex}`;
        const duplicateOf = seen.get(genome.key) ?? null;
        if (duplicateOf === null) seen.set(genome.key, id);
        proposals.push({ id, founderIndex: f.index, founderCluster: f.cluster, scale, sampleIndex,
          rawWhich, rawDelta, slot, locus, signedDelta, before, after,
          effectiveChange: after - before, unchangedAfterClamp: after === before, duplicateOf, genome });
      }
    }
  }
  return {
    founderSetId: M3_FOUNDER_SET, drawSeed, samplesPerFounderPerScale,
    scales: MUTATION_SCALES, founders, proposals,
    counts: {
      proposals: proposals.length,
      effective: proposals.filter((p) => p.effectiveChange !== 0).length,
      unchangedAfterClamp: proposals.filter((p) => p.unchangedAfterClamp).length,
      duplicateResults: proposals.filter((p) => p.duplicateOf !== null).length,
    },
  };
}

/** Spread a small pilot across parents and scales without filtering proposals. */
export function selectPilotProposals(neighborhood: MutationNeighborhood, count: number): MutationProposal[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 12) throw new Error("pilot count must be in 0..12");
  // One predeclared scale per founder, rotated across the three scales. The
  // choice ignores the mutation result, so a clamp or duplicate stays chosen.
  return neighborhood.proposals.filter((p) => p.sampleIndex === 0 &&
    p.scale === MUTATION_SCALES[p.founderIndex % MUTATION_SCALES.length]).slice(0, count);
}
