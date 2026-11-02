// I06b evidence assembly: dev (calibration) report, fresh (confirmation) report for qualified candidates only, fixtures, guards, the
// decision and the seal. Pure and deterministic; integers, integer rationals and decimal strings only. `--write` and `--replay-check`
// load the frozen calibration (dev) and regenerate only the fresh blocks and the fixtures.
import { canonicalJSON, sha256HexJS } from "@bl/schema";
import { medianTimes2 } from "./decision.ts";
import { decideCandidatesFe, panelVerdictFe, type CandidateInputFe, type CandidateResultFe, type PanelResultFe } from "./decisionFe.ts";
import { deltaOf } from "./evidence.ts";
import { runLadder, qualify, type LadderReport, type Qualification } from "./dose.ts";
import { fieldBlock, fixtureProtocolFe, decideFixtureFe, freeGapSeed, nullBlockFe, runGuardsFe, takeoverBlockFe, wallGateBlockFe2, type FieldVariant, type FixtureReportFe, type FreeGapSeed, type GuardFe } from "./fixturesFe.ts";
import { GATING_FE, PROTOCOL_FE, enumerateSeedsFe, protocolHashFe, type ProtocolFe } from "./protocol.ts";
import { noiseBlock, runBlockFe, ARMS_FE, type BlockResultFe, type ContrastsFe } from "./replicate.ts";

export const EVIDENCE_VERSION_FE = "niche-fe-evidence-v1";

export interface DevCandidateFe {
  cluster: number;
  blocks: BlockResultFe[];
  noise: { absBuilder: number[]; absNonbuilder: number[] };
  deltaProposed: number;
  /** Twice the median over dev blocks of the builder history's total polymer at the end of conditioning (also the realistic ceiling 2 x median). */
  builderPMedianTimes2: number;
}

export interface DevReportFe {
  purpose: "calibration";
  R: number;
  seeds: readonly number[];
  candidates: DevCandidateFe[];
  ladder: LadderReport;
  qualification: Qualification[];
}

export function devReportFe(p: ProtocolFe = PROTOCOL_FE, log: (s: string) => void = () => {}): DevReportFe {
  const candidates: DevCandidateFe[] = p.panel.map((cluster) => {
    const blocks = p.devSeeds.map((s) => runBlockFe(cluster, s, p));
    const invalid = blocks.filter((b) => !b.valid);
    if (invalid.length) throw new Error(`cluster ${cluster}: invalid dev block(s) ${invalid.map((b) => `${b.seed} (${b.invalidReason})`).join(", ")}`);
    const noiseBlocks = p.devReplicateSeeds.map((s) => noiseBlock(cluster, s, p));
    const noise = { absBuilder: noiseBlocks.map((n) => n.absBuilder), absNonbuilder: noiseBlocks.map((n) => n.absNonbuilder) };
    const pMed2 = medianTimes2(blocks.map((b) => Number(b.costs.find((c) => c.kind === "builder")?.P ?? 0)));
    const deltaProposed = deltaOf(p.reserve.B * p.R, [...noise.absBuilder, ...noise.absNonbuilder]);
    log(`cluster ${cluster}: delta ${deltaProposed}, builder P median x2 ${pMed2}`);
    return { cluster, blocks, noise, deltaProposed, builderPMedianTimes2: pMed2 };
  });
  const deltas = Object.fromEntries(candidates.map((c) => [String(c.cluster), c.deltaProposed]));
  const ceilings = Object.fromEntries(candidates.map((c) => [String(c.cluster), c.builderPMedianTimes2]));
  const ladder = runLadder(deltas, ceilings, p, (row) => log(`dose ${row.totalP}: ${GATING_FE.map((k) => `${k} ${row.stats[k].k}/${p.wallSeeds.length} med ${row.stats[k].medianTimes2 / 2}`).join(", ")}`));
  const qualification = candidates.map((c) => qualify(c.cluster, c.deltaProposed, c.builderPMedianTimes2, ladder.rows, p));
  return { purpose: "calibration", R: p.R, seeds: p.devSeeds, candidates, ladder, qualification };
}

export interface FreshCandidateFe {
  cluster: number;
  blocks: BlockResultFe[];
  input: CandidateInputFe;
  /** Per arm: twice the median of Y (sum over replicates) over the fresh blocks. */
  medianYTimes2: Record<string, number | null>;
  survivedByArm: Record<string, { reps: number; of: number }>;
  /** Paired survival contrast: blocks where the field arm had strictly more surviving replicates than the best comparator (attribution only). */
  survivalPositiveBlocks: number;
  fluxAttribution: { available: boolean; reason: string; growthAttributedBlocks: number; coCulture: "unavailable" };
  /** Secondary, never gating: twice the median of the per-arm AUC. */
  aucMedianTimes2: Record<string, number | null>;
}

export interface FreshReportFe {
  purpose: "confirmation";
  seeds: readonly number[];
  /** false when no candidate qualified: no fresh seed was simulated. */
  ran: boolean;
  candidates: FreshCandidateFe[];
  inputs: CandidateInputFe[];
  results: CandidateResultFe[];
  panel: PanelResultFe;
  caveats: string[];
}

const med = (xs: readonly number[]): number | null => (xs.length ? medianTimes2(xs) : null);

export function freshReportFe(dev: DevReportFe, p: ProtocolFe = PROTOCOL_FE, log: (s: string) => void = () => {}): FreshReportFe {
  const n = p.freshSeeds.length;
  const zeros = Array(n).fill(0);
  const candidates: FreshCandidateFe[] = [];
  const inputs: CandidateInputFe[] = [];
  for (const q of dev.qualification) {
    const delta = p.delta[String(q.cluster)];
    if (!q.qualified) {
      inputs.push({ id: `cluster-${q.cluster}`, status: "not-simulated", invalidReasons: [], contrasts: { builder: zeros, poly: zeros, space: zeros, inoc2: zeros, spaceP: zeros, spaceNP: zeros, inoc: zeros, inocMatched: zeros, naive: zeros }, delta, viableBlocks: 0, blocks: n, expectedBlocks: n, notSimulatedReasons: [q.reason] });
      continue;
    }
    const raw = p.freshSeeds.map((s) => runBlockFe(q.cluster, s, p));
    log(`cluster ${q.cluster}: fresh ${raw.filter((b) => b.valid).length}/${n} valid`);
    const col = (k: keyof ContrastsFe) => raw.map((b) => (b.contrasts ? b.contrasts[k] : 0));
    const valid = raw.filter((b) => b.valid).length;
    const input: CandidateInputFe = {
      id: `cluster-${q.cluster}`,
      status: valid === n ? "ok" : "invalid",
      invalidReasons: raw.filter((b) => !b.valid).map((b) => `seed ${b.seed}: ${b.invalidReason}`),
      contrasts: { builder: col("builder"), poly: col("poly"), space: col("space"), inoc2: col("inoc2"), spaceP: col("spaceP"), spaceNP: col("spaceNP"), inoc: col("inoc"), inocMatched: col("inocMatched"), naive: col("naive") },
      delta,
      viableBlocks: raw.filter((b) => b.viable).length,
      blocks: valid,
      expectedBlocks: n,
      notSimulatedReasons: [],
    };
    inputs.push(input);
    const sat = raw.filter((b) => Object.values(b.outcomes).some((o) => o.saturated)).length;
    candidates.push({
      cluster: q.cluster,
      blocks: raw,
      input,
      medianYTimes2: Object.fromEntries(ARMS_FE.map((a) => [a, med(raw.filter((b) => b.outcomes[a]).map((b) => b.outcomes[a].y))])),
      survivedByArm: Object.fromEntries(ARMS_FE.map((a) => [a, { reps: raw.reduce((t, b) => t + (b.outcomes[a]?.survivedReps ?? 0), 0), of: raw.filter((b) => b.outcomes[a]).length * p.R }])),
      survivalPositiveBlocks: raw.filter((b) => (b.contrasts?.survivalVsInoc2 ?? 0) > 0).length,
      fluxAttribution: valid === 0 ? { available: false, reason: "no valid block produced a measurement", growthAttributedBlocks: 0, coCulture: "unavailable" } : sat === 0 ? { available: true, reason: "no role counter reached saturation in any replicate; the co-culture arm (a) is never attributed", growthAttributedBlocks: raw.filter((b) => (b.outcomes.b?.growthAttributedReps ?? 0) * 2 >= p.R).length, coCulture: "unavailable" } : { available: false, reason: `a role counter reached ${p.roleSaturation} in ${sat} block(s)`, growthAttributedBlocks: 0, coCulture: "unavailable" },
      aucMedianTimes2: Object.fromEntries(ARMS_FE.map((a) => [a, med(raw.filter((b) => b.outcomes[a]).map((b) => b.outcomes[a].auc))])),
    });
  }
  const results = decideCandidatesFe(inputs, p.viableBlocksMin);
  const caveats = [p.powerStatement];
  if (candidates.length === 0) caveats.push("No candidate qualified on the dev positive control, so no fresh seed was simulated: this is a statement about the sensitivity of the assay at realistic polymer doses, not about niche construction.");
  return { purpose: "confirmation", seeds: p.freshSeeds, ran: candidates.length > 0, candidates, inputs, results, panel: panelVerdictFe(results), caveats };
}

export interface FixturesReportFe {
  protocol: { grid: number; kernelRadius: number; T2: number; R: number; reserve: { B: number; E: number }; delta: number };
  seeds: readonly number[];
  reports: FixtureReportFe[];
  freeGap: FreeGapSeed[];
  guards: GuardFe[];
  /** Rung-1 W2 wall (allowP) at the frozen scale through the second-rung arms; diagnostic, never qualifying. */
  handWallGate: FixtureReportFe;
}

export function fixturesReportFe(p: ProtocolFe = PROTOCOL_FE): FixturesReportFe {
  const fp = fixtureProtocolFe(p);
  const seeds = p.fixtureSeeds;
  const delta = Math.ceil((fp.reserve.B * fp.R) / 50);
  const reports: FixtureReportFe[] = [];
  for (const v of ["far-field", "uniform", "footprint"] as FieldVariant[]) reports.push(decideFixtureFe(v === "far-field" ? "far-field-energy" : `energy-${v}`, seeds, seeds.map((s) => fieldBlock(v, s, fp)), delta));
  reports.push(decideFixtureFe("takeover-only", seeds, seeds.map((s) => takeoverBlockFe(s, fp)), delta));
  reports.push(decideFixtureFe("null-field", seeds, seeds.map((s) => nullBlockFe(s, fp)), delta));
  const wp: ProtocolFe = { ...p, R: p.fixtureR };
  const handWallGate = decideFixtureFe("hand-wall-gate-W2", seeds, seeds.map((s) => wallGateBlockFe2(s, wp)), Math.ceil((p.reserve.B * p.fixtureR) / 50));
  return { protocol: { grid: fp.grid, kernelRadius: fp.kernelRadius, T2: fp.T2, R: fp.R, reserve: fp.reserve, delta }, seeds, reports, freeGap: seeds.map((s) => freeGapSeed(s, fp)), guards: runGuardsFe(fp), handWallGate };
}

export function stepProjectionFe(p: ProtocolFe = PROTOCOL_FE): { formula: string; freshBlocks: number; stepsPerBlock: number; devBlocks: number } {
  const perBlock = 2 * p.T1 + 13 * p.R * p.T2;
  return { formula: "per block 2*T1 + 13 arms * R * T2; dev blocks, replicate-noise, wall ladder (12 arms * R * T2 per wall seed per dose) and fixtures are calibration or unit scale", freshBlocks: p.panel.length * p.freshSeeds.length, stepsPerBlock: perBlock, devBlocks: p.panel.length * p.devSeeds.length };
}

export interface PayloadFe {
  kind: "niche-fe-evidence";
  version: string;
  protocol: ProtocolFe;
  protocolHash: string;
  registryDigest: string;
  seedCount: number;
  stepProjection: ReturnType<typeof stepProjectionFe>;
  dev: DevReportFe;
  fresh: FreshReportFe;
  fixtures: FixturesReportFe;
  powerStatement: string;
  limits: string[];
  amendments: string[];
  integritySha256: string;
}

export const LIMITS_FE: readonly string[] = [
  "Exploratory, CPU only (sim-ref), mutation off. No GPU evidence, no physics change, not part of the frozen preregistration.",
  "Free energy cannot be matched together with total energy at equal matter: fU, fS and fB match free E exactly and carry a signed, evidence-only constructionGap in total energy. They sit on the weaker side of total energy, so they screen free-energy alone, not bound inventories.",
  "The positive control is a hand-built polymer ring under ordinary placement (W1). It shows the assay can detect a polymer structure of that dose, not that a builder's field can pass. The polymer floor under the receiver (W2) is outside ordinary placement and is reported unavailable.",
  "Sixteen fresh blocks with exact sign tests can only certify a benefit that is positive in about nine of ten blocks or more and clears delta on four contrasts and viability. A negative is a failure to detect such a benefit under these rules, not an exclusion bound on the effect size and not evidence that there is no benefit.",
  "Summing R replicates reduces assay-seed noise, not block-to-block field variance; the block count carries that.",
  "A negative does not say a second link is impossible, does not test mutation reaching builder or receiver, and does not test A+B->C. One receiver genome, one field per candidate, T1 = 60, T2 = 80, 24 x 24, single tile.",
  "Receiver-labelled biomass inventory can rise by relabelling detritus; growth is claimed only where flux attribution is available and synthesis is at least half the gain. Survival is a viability requirement on the field arm, not a claimed benefit.",
  "The ablation arm is analytical (polymer converted to waste at transfer, released energy booked as named heat); co-culture (arm a) flux attribution is unavailable.",
  "Builder founder-biomass dose response and a polymer-bearing full-gate trap fixture are left to a later rung.",
];

export function amendmentsFe(dev: DevReportFe, p: ProtocolFe): string[] {
  const d = dev.candidates.map((c) => `cluster ${c.cluster}: delta ${p.delta[String(c.cluster)]}, ceiling ${c.builderPMedianTimes2}`).join("; ");
  return [`Amendment 3 (2026-11-02, PLAN section 10): R = ${p.R}; doses ${p.doses.join(", ")}; ${d}; block, replicate, noise, wall and fixture seeds as enumerated in the protocol (${enumerateSeedsFe(p).length} seeds); frozen and pushed before any fresh seed was read. Rung 1 (docs/niche-construction-2026-11-01) is superseded only by a rung-2 label, not rewritten.`];
}

export function sealPayloadFe(body: Omit<PayloadFe, "integritySha256">): PayloadFe {
  return { ...body, integritySha256: sha256HexJS(new TextEncoder().encode(canonicalJSON(body))) };
}
export function verifySealFe(p: PayloadFe): boolean {
  const { integritySha256, ...body } = p;
  return integritySha256 === sha256HexJS(new TextEncoder().encode(canonicalJSON(body)));
}

/** Build the sealed payload around a FROZEN dev report (calibration.json): only the fixtures and the fresh blocks are simulated here. */
export function buildPayloadFe(registryDigest: string, dev: DevReportFe, p: ProtocolFe = PROTOCOL_FE, log: (s: string) => void = () => {}): PayloadFe {
  const fresh = freshReportFe(dev, p, log);
  return sealPayloadFe({ kind: "niche-fe-evidence", version: EVIDENCE_VERSION_FE, protocol: p, protocolHash: protocolHashFe(registryDigest, p), registryDigest, seedCount: enumerateSeedsFe(p).length, stepProjection: stepProjectionFe(p), dev, fresh, fixtures: fixturesReportFe(p), powerStatement: p.powerStatement, limits: [...LIMITS_FE], amendments: amendmentsFe(dev, p) });
}

