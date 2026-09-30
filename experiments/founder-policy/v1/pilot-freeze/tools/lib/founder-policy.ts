// Pure, outcome-independent founder-policy design and analysis primitives.
import { createHash } from "node:crypto";
import { CH, G, GENOME_CHANNELS, M3_FOUNDER_SET, PRESETS, RING_CELL_MASK, RULE_VERSION, cellCount, cloneState, decodeGenome, encodeGenome, geneticClusters, initWorld, lineageKey, packLineageLo, type Genome, type WorldConfig, type WorldState } from "@bl/schema";
import { fromHex, normalizeGenome, toHex } from "./selection-funnel-audit.ts";

export const COHORT_SEEDS = Array.from({ length: 8 }, (_, i) => 6200001 + i);
export const EVOLUTION_SEEDS = Array.from({ length: 4 }, (_, i) => 6210001 + i);
export const PILOT_ASSAY_SEEDS = Array.from({ length: 4 }, (_, i) => 6220101 + i);
export const MAIN_ASSAY_SEEDS = Array.from({ length: 4 }, (_, i) => 6230001 + i);
export const REPAIR_ASSAY_SEEDS = Array.from({ length: 4 }, (_, i) => 6260101 + i);
export const POSITION_SEEDS = Array.from({ length: 4 }, (_, i) => 6270001 + i);
export const SAMPLE_SEED_FIRST = 6240001;
export const BOOTSTRAP_SEED = 6250001;

export type PolicyGenome = ReturnType<typeof normalizeGenome>;
export interface EligibleGenome { hex: string; firstObservation: number; observations: number[]; cluster: number }
export interface Cohort { id: string; source: "historical" | "random"; drawSeed: number | null; clusterIds: number[]; genomeHex: string[] }
export interface HistoryUnit { id: string; cohort: string; seed: number; seedIndex: number; mode: "normal" | "off"; slots: number[] }
export interface SampleUnit { history: string; time: number; root: number; draw: number; seed: number }
export interface ResolvedConfigs { evolution: { seed: number; normal: WorldConfig; off: WorldConfig }[]; pilotAssay: { seed: number; cfg: WorldConfig }[]; mainAssay: { seed: number; cfg: WorldConfig }[]; repairAssay: { seed: number; cfg: WorldConfig }[] }
export interface Design { format: 1; ruleVersion: number; founderSetId: string; inputManifestSha256: string; sourceHashes: Record<string, string>; resolvedConfigs: ResolvedConfigs; thresholds: { pilotBothPositiveGenotypes: 7; pilotOverallMeanAbsoluteMax: 0.05; pilotPerGenotypeMeanAbsoluteMax: 0.15; pilotCompetentMinusDisabledMin: 0.20; pilotCompetentGenotypes: 7; meaningfulGain: 0.10; meaningfulPolicyDifference: 0.10; retentionNoninferiority: -0.05; bootstrapReplicates: 10000 }; caveats: string[]; eligible: EligibleGenome[]; cohorts: Cohort[]; pilotGenomeHex: string[]; seeds: { cohort: number[]; evolution: number[]; pilotAssay: number[]; mainAssay: number[]; repairAssay: number[]; position: number[]; sampleFirst: number; bootstrap: number }; times: number[]; assays: { seeds: number[]; steps: number; repeats: number; assignments: number }; histories: HistoryUnit[]; sampleUnits: SampleUnit[]; requestedTechnicalAssays: number; stockDiscs: 12; budgetUSD: { global: 50; pilotRepair: 10; completeComparison: 35; closeout: 5 } }

export function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
export function asSimGenome(g: PolicyGenome): Genome { return { mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights) }; }
export function simHex(g: Genome): string { return toHex({ ...g, weights: Array.from(g.weights) }); }

// Mulberry32 with rejection so every bounded draw is uniform over u32 states.
export class Random {
  private state: number;
  constructor(seed: number) { if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error("seed must be u32"); this.state = seed >>> 0; }
  u32(): number { this.state = (this.state + 0x6d2b79f5) >>> 0; let t = this.state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; }
  int(bound: number): number { if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000) throw Error("invalid random bound"); const limit = Math.floor(0x100000000 / bound) * bound; let n: number; do n = this.u32(); while (n >= limit); return n % bound; }
  int53(bound: number): number { if (!Number.isSafeInteger(bound) || bound < 1) throw Error("invalid 53-bit random bound"); if (bound <= 0x100000000) return this.int(bound); const space = 0x20000000000000; const limit = Math.floor(space / bound) * bound; let n: number; do n = (this.u32() & 0x1fffff) * 0x100000000 + this.u32(); while (n >= limit); return n % bound; }
  shuffle<T>(values: readonly T[]): T[] { const v = [...values]; for (let i = v.length - 1; i > 0; i--) { const j = this.int(i + 1); [v[i], v[j]] = [v[j], v[i]]; } return v; }
}

export function eligibleFromViable(rows: unknown[], committedCount: number): EligibleGenome[] {
  if (!Number.isSafeInteger(committedCount) || committedCount < 0 || committedCount > rows.length) throw Error("invalid committed viable prefix");
  const map = new Map<string, EligibleGenome>();
  for (let i = 0; i < committedCount; i++) {
    const row = rows[i] as { genome?: unknown; eval?: { survived?: unknown } };
    if (!row || !Number.isSafeInteger(row.eval?.survived)) throw Error(`malformed viable evaluation ${i}`);
    const g = normalizeGenome(row.genome);
    if ((row.eval!.survived as number) < 1) continue;
    const hex = toHex(g), prior = map.get(hex);
    if (prior) prior.observations.push(i);
    else map.set(hex, { hex, firstObservation: i, observations: [i], cluster: -1 });
  }
  const eligible = [...map.values()];
  const ids = geneticClusters(eligible.map((e) => asSimGenome(fromHex(e.hex))), 10);
  eligible.forEach((e, i) => e.cluster = ids[i]);
  return eligible;
}

export function drawCohort(eligible: EligibleGenome[], seed: number, id: string): Cohort {
  const groups = new Map<number, EligibleGenome[]>();
  for (const e of eligible) groups.set(e.cluster, [...(groups.get(e.cluster) ?? []), e]);
  if (groups.size < 12) throw Error(`only ${groups.size} eligible clusters`);
  const rng = new Random(seed), chosen = rng.shuffle([...groups.keys()]).slice(0, 12);
  return { id, source: "random", drawSeed: seed, clusterIds: chosen, genomeHex: chosen.map((cluster) => groups.get(cluster)![rng.int(groups.get(cluster)!.length)].hex) };
}

export function pilotArchiveGenomes(eligible: EligibleGenome[]): string[] {
  const rng = new Random(6220001), groups = new Map<number, EligibleGenome[]>();
  for (const e of eligible) groups.set(e.cluster, [...(groups.get(e.cluster) ?? []), e]);
  if (groups.size < 4) throw Error("pilot needs four clusters");
  return rng.shuffle([...groups.keys()]).slice(0, 4).map((id) => groups.get(id)![rng.int(groups.get(id)!.length)].hex);
}

export function designFromInputs(inputManifestSha256: string, sourceHashes: Record<string, string>, resolvedConfigs: ResolvedConfigs, archive: { viableCount: number; resumes?: unknown }, viable: unknown[], founderHex: string[]): Design {
  if (founderHex.length !== 12) throw Error("historical founder roster must contain 12 genomes");
  const eligible = eligibleFromViable(viable, archive.viableCount);
  const cohorts: Cohort[] = [{ id: "historical", source: "historical", drawSeed: null, clusterIds: [], genomeHex: founderHex.map((x) => toHex(fromHex(x))) }, ...COHORT_SEEDS.map((seed, i) => drawCohort(eligible, seed, `random-${i + 1}`))];
  const histories: HistoryUnit[] = cohorts.flatMap((cohort) => EVOLUTION_SEEDS.flatMap((seed, seedIndex) => (["normal", "off"] as const).map((mode) => ({ id: `${cohort.id}-seed-${seed}-${mode}`, cohort: cohort.id, seed, seedIndex, mode, slots: positionSlots(seedIndex) }))));
  let nextSampleSeed = SAMPLE_SEED_FIRST;
  const sampleUnits = histories.flatMap((h) => [0, 100000, 1000000].flatMap((time) => Array.from({ length: 12 }, (_, root) => [0, 1].map((draw) => ({ history: h.id, time, root, draw, seed: nextSampleSeed++ }))).flat()));
  if (histories.length !== 72 || sampleUnits.length !== 5184 || nextSampleSeed !== 6245185) throw Error("design roster cardinality drift");
  return { format: 1, ruleVersion: RULE_VERSION, founderSetId: M3_FOUNDER_SET, inputManifestSha256, sourceHashes, resolvedConfigs, thresholds: { pilotBothPositiveGenotypes: 7, pilotOverallMeanAbsoluteMax: 0.05, pilotPerGenotypeMeanAbsoluteMax: 0.15, pilotCompetentMinusDisabledMin: 0.20, pilotCompetentGenotypes: 7, meaningfulGain: 0.10, meaningfulPolicyDifference: 0.10, retentionNoninferiority: -0.05, bootstrapReplicates: 10000 }, caveats: [`legacy resume: ${JSON.stringify(archive.resumes ?? null)}`, "quality-zero evaluations are not recorded at genome level", "eligible archive is a biased, survival-filtered sample"], eligible, cohorts, pilotGenomeHex: [...[0, 2, 5, 9].map((i) => founderHex[i]), ...pilotArchiveGenomes(eligible)], seeds: { cohort: COHORT_SEEDS, evolution: EVOLUTION_SEEDS, pilotAssay: PILOT_ASSAY_SEEDS, mainAssay: MAIN_ASSAY_SEEDS, repairAssay: REPAIR_ASSAY_SEEDS, position: POSITION_SEEDS, sampleFirst: SAMPLE_SEED_FIRST, bootstrap: BOOTSTRAP_SEED }, times: [0, 100000, 1000000], assays: { seeds: MAIN_ASSAY_SEEDS, steps: 20000, repeats: 2, assignments: 4 }, histories, sampleUnits, requestedTechnicalAssays: 82944, stockDiscs: 12, budgetUSD: { global: 50, pilotRepair: 10, completeComparison: 35, closeout: 5 } };
}

export function positionSlots(seedIndex: number): number[] {
  if (!Number.isInteger(seedIndex) || seedIndex < 0 || seedIndex > 3) throw Error("invalid seed block");
  return new Random(POSITION_SEEDS[seedIndex]).shuffle(Array.from({ length: 12 }, (_, i) => i));
}

export function policyWorld(cfg: WorldConfig, cohort: Cohort, seedIndex: number, testSlots?: number[]): { state: WorldState; founderRoots: Record<string, number>; discSlots: number[] } {
  if (cohort.genomeHex.length !== 12) throw Error("invalid cohort genome count");
  const slots = testSlots ?? positionSlots(seedIndex);
  if (slots.length !== 12 || new Set(slots).size !== 12 || slots.some((x) => !Number.isInteger(x) || x < 0 || x >= 12)) throw Error("invalid founder-position permutation");
  const preset = PRESETS.find((x) => x.id === "gradient-m3")!;
  if (preset.init.founders !== 12 || preset.init.nutrient !== 32 || preset.init.biomass !== 64) throw Error("stock gradient-m3 initialization drift");
  const state = cloneState(initWorld(cfg, preset.init)), n = cellCount(cfg);
  for (let i = 0; i < n; i++) {
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
    if (hi !== 0 || lo === 0) continue;
    const physical = (lo & RING_CELL_MASK) - 1;
    if (physical < 0 || physical >= 12) throw Error(`unexpected stock founder lineage ${lo}`);
    const words = encodeGenome(asSimGenome(fromHex(cohort.genomeHex[slots[physical]])), hi, lo);
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  const founderRoots = Object.fromEntries(slots.map((slot, i) => [lineageKey(0, packLineageLo(cfg, i + 1)), slot]));
  return { state, founderRoots, discSlots: slots };
}

export interface MutationEdge { child: string; parent: string }
export function parseMutationTsv(text: string): MutationEdge[] {
  const lines = text.trim().split(/\r?\n/); if (lines[0] !== "childHi\tchildLo\tparentHi\tparentLo") throw Error("invalid mutation header");
  return lines.slice(1).filter(Boolean).map((line, i) => { const n = line.split("\t").map(Number); if (n.length !== 4 || n.some((x) => !Number.isSafeInteger(x) || x < 0 || x > 0xffffffff)) throw Error(`invalid mutation row ${i}`); return { child: lineageKey(n[0], n[1]), parent: lineageKey(n[2], n[3]) }; });
}
export function ancestryResolver(founderRoots: Record<string, number>, edges: MutationEdge[]): (id: string) => number | null {
  const parent = new Map<string, string>(), memo = new Map<string, number | null>();
  for (const { child, parent: p } of edges) { if (parent.has(child) && parent.get(child) !== p) throw Error(`conflicting mutation parents ${child}`); if (child in founderRoots) throw Error(`founder appears as mutation child ${child}`); parent.set(child, p); }
  return (id: string) => { if (memo.has(id)) return memo.get(id)!; const seen = new Set<string>(), path: string[] = []; let cur = id; while (!(cur in founderRoots) && parent.has(cur)) { if (seen.has(cur)) throw Error(`ancestry cycle ${cur}`); seen.add(cur); path.push(cur); cur = parent.get(cur)!; } const root = cur in founderRoots ? founderRoots[cur] : null; for (const p of path) memo.set(p, root); return root; };
}

export interface RootMass { root: number; totalMass: number; byGenome: { hex: string; mass: number }[] }
export interface SampledRoot { root: number; status: "present" | "absent" | "unresolved"; mass: number; draws: string[]; unresolvedMass: number }
export function rootMasses(state: WorldState, resolveRoot: (id: string) => number | null): { roots: RootMass[]; unknownAncestryMass: number; unassociatedMass: number } {
  const n = cellCount(state.cfg); if (state.cells.length !== n * 7 || state.genome.length !== n * GENOME_CHANNELS) throw Error("malformed state buffer");
  const byLineage = new Map<string, string>(), roots = Array.from({ length: 12 }, (_, root) => ({ root, totalMass: 0, byGenome: new Map<string, number>() })); let unknownAncestryMass = 0, unassociatedMass = 0;
  for (let i = 0; i < n; i++) {
    const mass = state.cells[CH.B * n + i] + state.cells[CH.P * n + i]; if (!mass) continue;
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i], id = lineageKey(hi, lo);
    if (!hi && !lo) { unassociatedMass += mass; continue; }
    const words = Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + i]);
    if ((words[G.PARAM1] >>> 8) !== 0) throw Error(`malformed genome parameter padding ${id}`);
    const hex = simHex(decodeGenome(words));
    const prior = byLineage.get(id); if (prior !== undefined && prior !== hex) throw Error(`conflicting genome words for lineage ${id}`); byLineage.set(id, hex);
    const root = resolveRoot(id); if (root === null || !Number.isInteger(root) || root < 0 || root > 11) { unknownAncestryMass += mass; continue; }
    const r = roots[root]; r.totalMass += mass; r.byGenome.set(hex, (r.byGenome.get(hex) ?? 0) + mass);
  }
  return { roots: roots.map((r) => ({ root: r.root, totalMass: r.totalMass, byGenome: [...r.byGenome].map(([hex, mass]) => ({ hex, mass })) })), unknownAncestryMass, unassociatedMass };
}
export function sampleRoot(root: RootMass, drawSeeds: [number, number], unknownAncestryMass = 0): SampledRoot {
  if (!Number.isSafeInteger(root.totalMass) || root.totalMass < 0) throw Error("invalid root mass");
  if (unknownAncestryMass > 0) return { root: root.root, status: "unresolved", mass: root.totalMass, draws: [], unresolvedMass: unknownAncestryMass };
  if (root.totalMass === 0) return { root: root.root, status: "absent", mass: 0, draws: [], unresolvedMass: 0 };
  if (root.byGenome.reduce((a, b) => a + b.mass, 0) !== root.totalMass) throw Error("root mass disagreement");
  const draws: string[] = [];
  for (let k = 0; k < 2; k++) { const v = new Random(drawSeeds[k]).int53(root.totalMass); let sum = 0; const picked = root.byGenome.find((x) => (sum += x.mass) > v); if (!picked) throw Error("weighted sample failed"); draws.push(picked.hex); }
  return { root: root.root, status: "present", mass: root.totalMass, draws, unresolvedMass: 0 };
}

export type Score = { status: "scored"; value: number; descendantMass: number; ancestorMass: number } | { status: "both-extinct"; descendantMass: 0; ancestorMass: 0 };
export function competitionScore(descendantMass: number, ancestorMass: number): Score {
  if (![descendantMass, ancestorMass].every((x) => Number.isSafeInteger(x) && x >= 0)) throw Error("invalid competition masses");
  if (!descendantMass && !ancestorMass) return { status: "both-extinct", descendantMass: 0, ancestorMass: 0 };
  return { status: "scored", value: (descendantMass - ancestorMass) / (descendantMass + ancestorMass), descendantMass, ancestorMass };
}

// A symbolic linear estimator. One coefficient per exact assay identity makes
// cancellation of shared baseline and cached/missing observations exact.
export interface LinearScore { constant: number; terms: Record<string, number> }
export function linear(...parts: { score: LinearScore; weight: number }[]): LinearScore { const out: LinearScore = { constant: 0, terms: {} }; for (const { score, weight } of parts) { out.constant += score.constant * weight; for (const [key, value] of Object.entries(score.terms)) out.terms[key] = (out.terms[key] ?? 0) + value * weight; } for (const [k, v] of Object.entries(out.terms)) if (Math.abs(v) < 1e-14) delete out.terms[k]; return out; }
export function assayTerm(key: string): LinearScore { return { constant: 0, terms: { [key]: 1 } }; }
export function interval(score: LinearScore, observed: Record<string, number>): { lower: number; upper: number; missing: string[] } { let lower = score.constant, upper = score.constant; const missing: string[] = []; for (const [key, coefficient] of Object.entries(score.terms)) { const value = observed[key]; if (value === undefined) { lower -= Math.abs(coefficient); upper += Math.abs(coefficient); missing.push(key); } else { if (!Number.isFinite(value) || value < -1 || value > 1) throw Error(`invalid score ${key}`); lower += coefficient * value; upper += coefficient * value; } } return { lower, upper, missing }; }
export function percentile(sorted: number[], p: number): number { if (!sorted.length || p < 0 || p > 1) throw Error("invalid percentile"); const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at); return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo); }
export function crossedBootstrap<T>(cohorts: readonly T[], seeds: readonly number[], n: number, evaluate: (cohortIndices: number[], seedIndices: number[]) => number, seed = BOOTSTRAP_SEED): number[] { if (cohorts.length !== 8 || seeds.length !== 4 || n < 1) throw Error("crossed bootstrap requires eight cohorts and four seed blocks"); const rng = new Random(seed), out = []; for (let b = 0; b < n; b++) out.push(evaluate(Array.from({ length: 8 }, () => rng.int(8)), Array.from({ length: 4 }, () => rng.int(4)))); return out.sort((a, b) => a - b); }
