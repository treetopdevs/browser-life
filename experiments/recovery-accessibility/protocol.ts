import { buildWorld, cellBase, decodeGenome, defaultConfig, draw, encodeGenome, founderGenome, generalistGenome, G, M3_FOUNDERS, NN_BYTES, RND, type Genome } from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { DEFAULT_EVAL, type Evaluation } from "@bl/search";
import { passesProbabilityGate } from "@bl/metrics";
import { validateObservation, type RecoveryObservation } from "./observer.ts";

export const PROTOCOL = "recovery-accessibility-v1";
export const ENGINEERING_SEEDS = Array.from({ length: 4 }, (_, i) => 2_026_102_301 + i);
export const SCIENCE_SEEDS = Array.from({ length: 128 }, (_, i) => 2_026_102_401 + i);
export const evalConfig = (seed: number) => ({ ...DEFAULT_EVAL, world: { ...DEFAULT_EVAL.world }, side: 1, reps: 1, seed, perRep: true });
export const worldConfig = (seed: number) => defaultConfig({ ...DEFAULT_EVAL.world, tileW: 64, tileH: 64, tilesX: 1, tilesY: 1, seed, mutRate: 0 });
export const initialState = (seed: number, genome: Genome) => buildWorld(worldConfig(seed), { nutrient: 32, founders: [{ x: 32, y: 32, radius: 10, genome, biomass: 64, energy: 128 }] });
export const genomeHex = (g: Genome) => Array.from(encodeGenome(g, 0, 0).subarray(G.PARAM0), w => w.toString(16).padStart(8, "0")).join("");
export function subjects() {
  const parent = founderGenome(M3_FOUNDERS[0]);
  const words = encodeGenome(parent, 0, 0), before = words.slice();
  const base = cellBase(4_100_000, 24, 138);
  const which = draw(base, RND.MUT_WHICH), delta = draw(base, RND.MUT_DELTA);
  if (which % (NN_BYTES + 3) !== 12 || (delta % 49) - 24 !== -20) throw new Error("mutation recipe mismatch");
  mutateInPlace(words, 1, 0, { ...defaultConfig(), mutStep: 24 }, which, delta);
  const mutant = decodeGenome(words);
  const reverted = words.slice();
  const wi = G.W0 + (12 >> 2), shift = (12 & 3) * 8;
  reverted[wi] = ((reverted[wi] & ~(255 << shift)) | (before[wi] & (255 << shift))) >>> 0;
  if (!reverted.every((w, i) => w === before[i])) throw new Error("mutation is not one reversible slot");
  return { parent, mutant, generalist: generalistGenome(60, 20) };
}
export interface CaseResult {
  protocol: string;
  manifestHash: string;
  id: string;
  seed: number;
  subject: "parent" | "mutant" | "generalist";
  genome: string;
  config: ReturnType<typeof worldConfig>;
  evaluation: Evaluation;
  observation: RecoveryObservation;
  artifacts: { path: string; sha256: string; bytes: number }[];
}
export interface Pair { seed: number; parent: CaseResult; mutant: CaseResult }

const boolean = (x: unknown) => typeof x === "boolean";
export function validateCase(c: CaseResult, binding: { manifestHash: string; seed: number; subject: CaseResult["subject"]; genome: string; id: string }) {
  if (c.protocol !== PROTOCOL || c.manifestHash !== binding.manifestHash || c.seed !== binding.seed || c.subject !== binding.subject || c.genome !== binding.genome || c.id !== binding.id) throw new Error("case identity mismatch");
  if (JSON.stringify(c.config) !== JSON.stringify(worldConfig(c.seed))) throw new Error("case configuration mismatch");
  const e = c.evaluation, o = c.observation;
  validateObservation(o);
  const effective = !!o.target?.lesion && o.originalCellsInRemnant > 0 && 5 * o.immediateMass <= 4 * (o.target?.mass ?? 0);
  const expectedR = e.survived === 1 && effective && o.tracks.normal.retained;
  if (o.R !== expectedR) throw new Error("legacy regeneration not supported by trace");
  if (e.perRep?.[0]?.regenerated !== (e.regenerated === 1) || e.perRep?.[0]?.alive !== (e.survived === 1) || e.perRep?.[0]?.lightDependent !== (e.lightDependent === 1)) throw new Error("per-replicate counts mismatch");
  if (e.reps !== 1 || e.perRep?.length !== 1 || ![0, 1].includes(e.survived) || ![0, 1].includes(e.lightDependent) || ![0, 1].includes(e.regenerated)) throw new Error("case counts malformed");
  if (![o.R, o.R_clean, o.sensitivity.low, o.sensitivity.high].every(boolean) || o.R !== (e.regenerated === 1) || (o.R_clean && !o.R)) throw new Error("recovery bits malformed");
  if (!Number.isSafeInteger(o.target?.mass ?? 0) || (o.target?.mass ?? 0) < 0) throw new Error("target mass malformed");
  if (Object.keys(o.states).length !== 7 || Object.values(o.states).some(s => s.residual !== "0" || !/^[0-9a-f]{16}$/.test(s.hash))) throw new Error("state evidence incomplete");
  if (Object.values(o.states).some(s => s.matter !== o.states.initial.matter)) throw new Error("matter evidence mismatch");
  if (o.tracks.fast.history.length !== 80 || o.tracks.normal.history.length !== 40) throw new Error("observation incomplete");
}

function ratioAtLeast(ratios: [number, number][], num: bigint, den: bigint): boolean {
  if (!ratios.length) return false;
  ratios.sort((a, b) => {
    const d = BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  });
  const a = ratios[Math.floor((ratios.length - 1) / 2)], b = ratios[Math.floor(ratios.length / 2)];
  return den * (BigInt(a[0]) * BigInt(b[1]) + BigInt(b[0]) * BigInt(a[1])) >= 2n * num * BigInt(a[1]) * BigInt(b[1]);
}
export function pairedTest(wins: number, losses: number) {
  const n = wins + losses;
  let bin = 1n, tail = 0n;
  for (let k = 0; k <= n; k++) {
    if (k >= wins) tail += bin;
    if (k < n) bin = bin * BigInt(n - k) / BigInt(k + 1);
  }
  const denominator = 1n << BigInt(n);
  return { wins, losses, numerator: tail.toString(), denominator: denominator.toString(), p: Number(tail) / Number(denominator), pass: 20n * tail <= denominator };
}
export function summarize(pairs: Pair[], seeds: number[], stage: "first32" | "final128") {
  const n = stage === "first32" ? 32 : 128;
  if (pairs.length !== n || seeds.length !== n || new Set(pairs.map(p => p.seed)).size !== n || pairs.some((p, i) => p.seed !== seeds[i])) throw new Error("incomplete, duplicated or unordered pair set");
  const totals = (s: "parent" | "mutant") => ({
    R: pairs.filter(p => p[s].observation.R).length,
    clean: pairs.filter(p => p[s].observation.R_clean).length,
    survived: pairs.reduce((v, p) => v + p[s].evaluation.survived, 0),
    light: pairs.reduce((v, p) => v + p[s].evaluation.lightDependent, 0),
    low: pairs.filter(p => p[s].observation.sensitivity.low).length,
    high: pairs.filter(p => p[s].observation.sensitivity.high).length,
  });
  const parent = totals("parent"), mutant = totals("mutant");
  const ratios: [number, number][] = pairs.filter(p => (p.parent.observation.target?.mass ?? 0) > 0 && (p.mutant.observation.target?.mass ?? 0) > 0)
    .map(p => [p.mutant.observation.target!.mass, p.parent.observation.target!.mass]);
  const massOK = ratioAtLeast(ratios, 4n, 5n);
  const test = (key: "R" | "R_clean") => pairedTest(pairs.filter(p => p.mutant.observation[key] && !p.parent.observation[key]).length, pairs.filter(p => !p.mutant.observation[key] && p.parent.observation[key]).length);
  const tests = { R: test("R"), clean: test("R_clean") };
  const viability = stage === "first32"
    ? parent.survived >= 29 && mutant.survived >= 29 && parent.light >= 29 && mutant.light >= 29 && mutant.survived >= parent.survived - 1 && mutant.light >= parent.light - 1
    : [parent.survived, mutant.survived, parent.light, mutant.light].every(k => passesProbabilityGate(k, 128, 0.8)) && mutant.survived >= parent.survived - 6 && mutant.light >= parent.light - 6;
  const masses = ratios.length >= (stage === "first32" ? 29 : 116) && massOK;
  const gains = stage === "first32" ? mutant.R - parent.R >= 2 && mutant.clean - parent.clean >= 2
    : mutant.R - parent.R >= 7 && mutant.clean - parent.clean >= 7 && tests.R.pass && tests.clean.pass;
  const sensitivity = mutant.low > parent.low && mutant.high > parent.high;
  const status = stage === "first32" ? (viability && masses && gains ? "EXTEND-TO-128" : "NO-LEAD-IN-FIRST-32")
    : viability && masses && gains ? (sensitivity ? "ACCESSIBLE-ASSAY-IMPROVEMENT" : "ASSAY-SENSITIVE") : "NOT-CONFIRMED";
  // Conservative paired-difference interval via Bonferroni Hoeffding bounds for the two discordant proportions.
  const eps = Math.sqrt(Math.log(80) / (2 * n));
  const interval = (t: ReturnType<typeof pairedTest>) => [Math.max(-1, (t.wins - t.losses) / n - 2 * eps), Math.min(1, (t.wins - t.losses) / n + 2 * eps)];
  return { status, n, parent, mutant, tests, pairedDifference95: { method: "Bonferroni-Hoeffding (conservative)", R: interval(tests.R), clean: interval(tests.clean) },
    gates: { viability, masses, gains, sensitivity }, pairedTargets: ratios.length,
    reasons: Object.fromEntries(["parent", "mutant"].map(s => [s, pairs.reduce((a, p) => { const reason = p[s as "parent" | "mutant"].observation.reason; a[reason] = (a[reason] ?? 0) + 1; return a; }, {} as Record<string, number>)])) };
}
