import { fromHex, toHex } from "./selection-funnel-audit.ts";
import { type Design, sha256 } from "./founder-policy.ts";

export type PilotKind = "identical" | "disabled";
export interface PilotRequest { id: string; genotypeIndex: number; kind: PilotKind; seed: number; assignment: number; descendantHex: string; ancestorHex: string; assayKey: string }
export interface PilotResult { request: PilotRequest; status: "scored" | "both-extinct"; score: number | null; descendantMass: number; ancestorMass: number; startHash: string; finalHash: string; cfg: unknown; startedAt: string; finishedAt: string; wallSeconds: number; manifestSha256: string; reusedFrom?: string }
export interface PilotGate { complete: boolean; pass: boolean; reasons: string[]; identicalBothPositiveGenotypes: number; overallIdenticalMean: number | null; perGenotypeMeanAbsoluteIdentical: (number | null)[]; perGenotypeCompetentMinusDisabled: (number | null)[]; expectedRequests: number; observedRequests: number }

export function zeroController(hex: string): string { const g = fromHex(hex); return toHex({ ...g, weights: Array(160).fill(0) }); }
export function assayIdentity(descendantHex: string, ancestorHex: string, seed: number, assignment: number, cfg: unknown): string {
  return sha256(JSON.stringify({ assay: "founder-policy-competition/v1", descendantHex, ancestorHex, seed, assignment, cfg, chamber: { tile: [128, 128], nutrient: 32, biomass: 64, energy: 128, radius: 10, centers: [[32, 64], [96, 64]], steps: 20000, equalMaterialTemplate: "one-founder-left" } }));
}
export function pilotRequests(design: Design, cfgForSeed: (seed: number) => unknown): PilotRequest[] {
  if (design.pilotGenomeHex.length !== 8) throw Error("pilot requires eight frozen genotypes");
  const requests: PilotRequest[] = [];
  for (let genotypeIndex = 0; genotypeIndex < 8; genotypeIndex++) {
    const original = design.pilotGenomeHex[genotypeIndex];
    for (const kind of ["identical", "disabled"] as const) for (const seed of design.seeds.pilotAssay) for (let assignment = 0; assignment < 4; assignment++) {
      const ancestorHex = kind === "identical" ? original : zeroController(original);
      requests.push({ id: `g${genotypeIndex}-${kind}-s${seed}-a${assignment}`, genotypeIndex, kind, seed, assignment, descendantHex: original, ancestorHex, assayKey: assayIdentity(original, ancestorHex, seed, assignment, cfgForSeed(seed)) });
    }
  }
  if (requests.length !== 256) throw Error("pilot request count drift");
  return requests;
}

const average = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export function evaluatePilot(requests: PilotRequest[], results: PilotResult[], replayPassed: boolean | null): PilotGate {
  const byId = new Map(results.map((r) => [r.request.id, r]));
  if (byId.size !== results.length) throw Error("duplicate pilot result id");
  for (const r of results) {
    const expected = requests.find((x) => x.id === r.request.id); if (!expected || JSON.stringify(expected) !== JSON.stringify(r.request)) throw Error(`pilot request identity drift ${r.request.id}`);
    if (![r.descendantMass, r.ancestorMass].every((x) => Number.isSafeInteger(x) && x >= 0)) throw Error(`pilot malformed masses ${r.request.id}`);
    const denominator = r.descendantMass + r.ancestorMass;
    if (denominator === 0) { if (r.status !== "both-extinct" || r.score !== null) throw Error(`pilot both-extinct mismatch ${r.request.id}`); }
    else if (r.status !== "scored" || !Number.isFinite(r.score) || r.score !== (r.descendantMass - r.ancestorMass) / denominator) throw Error(`pilot score mismatch ${r.request.id}`);
  }
  const reasons: string[] = [], missing = requests.filter((r) => !byId.has(r.id));
  const complete = missing.length === 0 && replayPassed !== null;
  if (missing.length) reasons.push(`${missing.length} pilot technical replicates missing`);
  if (replayPassed === null) reasons.push("deterministic replay missing");
  else if (!replayPassed) reasons.push("deterministic replay failed");
  const all = requests.map((r) => byId.get(r.id)).filter((r): r is PilotResult => !!r);
  if (all.some((r) => r.status === "both-extinct")) reasons.push("both-extinct control replicate");
  const identical = all.filter((r) => r.request.kind === "identical"), disabled = all.filter((r) => r.request.kind === "disabled");
  const bothPositive = Array.from({ length: 8 }, (_, i) => identical.filter((r) => r.request.genotypeIndex === i).length === 16 && identical.filter((r) => r.request.genotypeIndex === i).every((r) => r.descendantMass > 0 && r.ancestorMass > 0));
  const identicalBothPositiveGenotypes = bothPositive.filter(Boolean).length;
  if (complete && identicalBothPositiveGenotypes < 7) reasons.push(`identical both-positive genotypes ${identicalBothPositiveGenotypes}/8 < 7/8`);
  const overallIdenticalMean = identical.length === 128 && identical.every((r) => r.score !== null) ? average(identical.map((r) => r.score!)) : null;
  if (overallIdenticalMean !== null && Math.abs(overallIdenticalMean) > 0.05) reasons.push(`overall identical mean ${overallIdenticalMean} outside ±0.05`);
  const perGenotypeMeanAbsoluteIdentical = Array.from({ length: 8 }, (_, i) => { const x = identical.filter((r) => r.request.genotypeIndex === i); return x.length === 16 && x.every((r) => r.score !== null) ? average(x.map((r) => Math.abs(r.score!))) : null; });
  perGenotypeMeanAbsoluteIdentical.forEach((x, i) => { if (x !== null && x > 0.15) reasons.push(`genotype ${i} mean absolute identical score ${x} > 0.15`); });
  const perGenotypeCompetentMinusDisabled = Array.from({ length: 8 }, (_, i) => { const x = disabled.filter((r) => r.request.genotypeIndex === i); return x.length === 16 && x.every((r) => r.score !== null) ? average(x.map((r) => r.score!)) : null; });
  // The strict boundary should not flip because summing sixteen binary
  // approximations of exactly 0.2 lands one ulp above the literal 0.2.
  if (complete && perGenotypeCompetentMinusDisabled.filter((x) => x !== null && x > 0.2 + 1e-12).length < 7) reasons.push("competent-minus-disabled >0.20 in fewer than 7/8 genotypes");
  return { complete, pass: complete && reasons.length === 0, reasons, identicalBothPositiveGenotypes, overallIdenticalMean, perGenotypeMeanAbsoluteIdentical, perGenotypeCompetentMinusDisabled, expectedRequests: requests.length, observedRequests: results.length };
}
