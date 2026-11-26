// I06 protocol: every number the assay depends on, frozen before the first fresh-seed run (docs/niche-construction-2026-11-01/PLAN.md
// sections 4 and 5). Dev (calibration) seeds may set the free parameters below; fresh (confirmation) seeds never tune anything.
// Only integers and strings, so the protocol canonicalizes and hashes (canonicalJSON refuses floats).
import { M3_FOUNDERS, canonicalJSON, defaultConfig, founderGenome, sha256HexJS, type Genome, type WorldConfig } from "@bl/schema";

export const PROTOCOL = {
  id: "niche-v1",
  question: "builder->receiver dependency edge, first causal rung, mutation off",
  grid: 24,
  kernelRadius: 5,
  genes: "ladder",
  kGene: 200,
  geneFlip: 0,
  geneDrive: 40,
  light: { mode: "uniform", base: 40, amp: 0 },
  /** Recurring injury shared by every arm, or null (the calibration decides; absent keys otherwise). */
  injury: { period: 10, radius: 2, prob: 22_000_000, shell: 15 } as null | { period: number; radius: number; prob: number; shell: number | null },
  /** Conditioning and assay horizons, steps (each at most 120 so the regeneration budget holds). */
  T1: 60,
  T2: 80,
  /** Nutrient A per lattice cell and free energy E per cell at step 0 (the declared background of the initial budget). */
  nutrient: 160,
  backgroundE: 40,
  founders: { x: 5, y: 12, radius: 2, biomass: 200, energy: 400 },
  /** Receiver reserve R = (B, E) carried off-lattice from step 0 and inert until the transfer. */
  reserve: { B: 480, E: 960 },
  footprint: { x: 14, y: 12, radius: 3 },
  halo: 2,
  /** Bound matter of the biomass-matched control d1B is B in the footprint-plus-halo region (A + B + C + P would be vacuous for nutrient that detritus replaced on the same cells; B + P handed structural polymer over as living inoculum and beat a pure polymer wall, see REVIEW.md). Fixed before the amended fresh run. */
  biomassMatch: "B",
  nMin: 12,
  /** Gene bytes: builder carries decomposition + build, nonbuilder and receiver decomposition only. */
  geneBits: { builder: 3, nonbuilder: 1, receiver: 1 },
  /** Raw lineage ids (hi = 0): the builder founder is 1; the receiver id is reserved and disjoint. */
  builderRaw: 1,
  receiverRaw: 2,
  panel: [0, 4, 9] as readonly number[],
  receiverCluster: 12,
  /** Roles counters saturate at this value in the reference step; attribution is unavailable when one reaches it. */
  roleSaturation: 65535,
  census: 10,
  /** Seeds: dev (calibration), fresh (confirmation), and the Stage-2 replicate seeds that give the delta floor on dev. All inside the registry range reserved for this slice. */
  seedRange: { first: 8_600_001, last: 8_600_999 },
  devSeeds: [8_600_001, 8_600_002, 8_600_003, 8_600_004] as readonly number[],
  devReplicateSeeds: [8_600_201, 8_600_202, 8_600_203, 8_600_204] as readonly number[],
  freshSeeds: [8_600_501, 8_600_502, 8_600_503, 8_600_504, 8_600_505, 8_600_506, 8_600_507, 8_600_508] as readonly number[],
  /** Dev-only seeds of the hand-wall positive control (8, so an exact sign test can reach 9/256 <= 1/20). */
  wallSeeds: [8_600_301, 8_600_302, 8_600_303, 8_600_304, 8_600_305, 8_600_306, 8_600_307, 8_600_308] as readonly number[],
  /** Per-candidate delta from the dev stage-2 replicate control; filled in by --calibrate then frozen here. */
  delta: { "0": 341, "4": 291, "9": 404 } as Readonly<Record<string, number>>,
  /** Hand-built positive control. totalP is deliberately about ten times the dev builders' polymer at T1 (about 60 to 160), so the control can show the assay sees a structural effect at all; builderScaleP re-runs it at builder scale and is reported, never gating. */
  wall: { totalP: 1200, builderScaleP: 120, ringGap: 1 },
  /** PLAN 5.3: a candidate is adequately measured only when its dev builder polymer total at T1 (median over the dev blocks, compared as twice the median) exceeds that candidate's dev replicate floor delta (the Stage-2 noise floor, same integer units). Amended from a fixed 10 to match the PLAN text; see REVIEW.md. */
  polymerAdequacy: "builder P median at T1 over dev blocks > candidate delta",
};

export type Protocol = typeof PROTOCOL;

export interface Candidate {
  cluster: number;
  builder: Genome;
  nonbuilder: Genome;
}
export const founderOf = (cluster: number) => {
  const f = M3_FOUNDERS.find((x) => x.cluster === cluster);
  if (!f) throw new Error(`no M3 founder for cluster ${cluster}`);
  return f;
};
export const candidateOf = (cluster: number, p: Protocol = PROTOCOL): Candidate => {
  const g = founderGenome(founderOf(cluster));
  return { cluster, builder: { ...g, genes: p.geneBits.builder }, nonbuilder: { ...g, genes: p.geneBits.nonbuilder } };
};
export const receiverGenome = (p: Protocol = PROTOCOL): Genome => ({ ...founderGenome(founderOf(p.receiverCluster)), genes: p.geneBits.receiver });

export function worldConfig(seed: number, p: Protocol = PROTOCOL): WorldConfig {
  return defaultConfig({
    tileW: p.grid,
    tileH: p.grid,
    kernelRadius: p.kernelRadius,
    seed,
    mutRate: 0,
    genes: p.genes as "ladder",
    kGene: p.kGene,
    geneFlip: p.geneFlip,
    geneDrive: p.geneDrive,
    lightMode: p.light.mode as "uniform",
    lightBase: p.light.base,
    lightAmp: p.light.amp,
    ...(p.injury ? { injuryPeriod: p.injury.period, injuryRadius: p.injury.radius, injuryProb: p.injury.prob, ...(p.injury.shell ? { injuryShell: p.injury.shell } : {}) } : {}),
  });
}

/** SHA-256 of the canonical protocol plus the seed-registry digest it was checked against. */
export function protocolHash(registryDigest: string, p: Protocol = PROTOCOL): string {
  return sha256HexJS(new TextEncoder().encode(canonicalJSON({ protocol: p, registryDigest })));
}

// ---------------------------------------------------------------------------
// Second rung (I06b): free-energy-matched comparators, replicated readout, dose-ladder positive control.
// docs/niche-construction-fe-2026-11-02/PLAN.md. A second protocol object: PROTOCOL above is untouched, so the first rung's sealed
// evidence verifies byte for byte. Integers and strings only.

/** The four gating contrasts of the second rung: inoc2 replaces the first rung's inoc. */
export const GATING_FE = ["builder", "poly", "space", "inoc2"] as const;
export type GatingFe = (typeof GATING_FE)[number];

export const PROTOCOL_FE = {
  ...PROTOCOL,
  id: "niche-fe-v1",
  question: "builder->receiver dependency edge, second rung: free-energy-matched comparators, replicated readout, ordinary-placement positive control",
  /** Stage-2 replicate sims per arm (block seed + k * stride, k = 0..R-1); Y is the integer sum over them. At most 4: the replicate-noise control needs a disjoint second set inside the reserved offsets 0..7. */
  R: 4,
  replicateStride: 1000,
  /** Largest offset index reserved in the registry (R = 8 would use all of them for the primary readout). */
  maxOffsetIndex: 7,
  /** Replicates used by the fixtures (unit scale, cheap). */
  fixtureR: 2,
  /** Field arm viable (receiver B above zero) in at least R - 1 of R replicates counts the block; at least this many of the fresh blocks. */
  viableBlocksMin: 14,
  seedRange: { first: 8_601_001, last: 8_608_999 },
  devSeeds: [8_601_001, 8_601_002, 8_601_003, 8_601_004, 8_601_005, 8_601_006, 8_601_007, 8_601_008] as readonly number[],
  devReplicateSeeds: [8_601_201, 8_601_202, 8_601_203, 8_601_204] as readonly number[],
  wallSeeds: [8_601_301, 8_601_302, 8_601_303, 8_601_304, 8_601_305, 8_601_306, 8_601_307, 8_601_308] as readonly number[],
  fixtureSeeds: [8_601_401, 8_601_402, 8_601_403, 8_601_404, 8_601_405, 8_601_406, 8_601_407, 8_601_408] as readonly number[],
  freshSeeds: [8_601_501, 8_601_502, 8_601_503, 8_601_504, 8_601_505, 8_601_506, 8_601_507, 8_601_508, 8_601_509, 8_601_510, 8_601_511, 8_601_512, 8_601_513, 8_601_514, 8_601_515, 8_601_516] as readonly number[],
  /** Per-candidate delta from the dev replicate-noise control (summed-R units); filled in by --calibrate, then frozen here. */
  delta: { "0": 1152, "4": 1031, "9": 1169 } as Readonly<Record<string, number>>,
  /** Positive-control dose ladder: total hand-built polymer, ascending. Qualifying doses are at most the candidate's ceiling (2 x the dev median builder polymer at T1). */
  doses: [60, 120, 240, 600, 1200] as readonly number[],
  /** Wall pass rule on dev: at least this many of the wall seeds positive on each of the four gating contrasts, and the median at least delta_c. */
  wallPassMin: 7,
  /** G-NOISE: delta_c at most 1/noiseDivisor of the limiting contrast's median effect at the qualifying dose. */
  noiseDivisor: 2,
  /** Frozen wording of the power statement (verified exactly in tests; never computed with floats in the payload). */
  powerStatement:
    "With three candidates running, the first Holm rejection needs at least 13 of 16 blocks positive (p = 697/65,536; 12 if only one candidate runs). A contrast whose true per-block positive probability is 0.75 passes that single threshold about 40.5% of the time, 0.85 about 79%, 0.90 about 93%, 0.95 about 99%; four contrasts, delta and viability can only lower the pass rate. A negative is therefore a failure to detect a consistent benefit under these rules (a sign test on D > 0, the median at least delta, four contrasts and viability), not an exclusion bound on the effect size and not evidence that there is no benefit.",
};
export type ProtocolFe = typeof PROTOCOL_FE;

/** Every seed that can run in this rung: block, replicate (primary and noise-control offsets), wall, fixture. Sorted, unique. */
export function enumerateSeedsFe(p: ProtocolFe = PROTOCOL_FE): number[] {
  const out = new Set<number>();
  const offs = (n: number, s: number) => {
    for (let k = 0; k < n; k++) out.add(s + k * p.replicateStride);
  };
  for (const s of [...p.devSeeds, ...p.freshSeeds, ...p.wallSeeds]) offs(p.R, s);
  for (const s of p.fixtureSeeds) offs(p.fixtureR, s);
  for (const s of p.devReplicateSeeds) offs(2 * p.R, s);
  return [...out].sort((a, b) => a - b);
}

/** SHA-256 of the canonical second-rung protocol, the registry digest it was checked against, and the enumerated seed list. */
export function protocolHashFe(registryDigest: string, p: ProtocolFe = PROTOCOL_FE): string {
  return sha256HexJS(new TextEncoder().encode(canonicalJSON({ protocol: p, registryDigest, seeds: enumerateSeedsFe(p) })));
}
