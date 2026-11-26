// Evidence assembly: dev (calibration) report, fresh (confirmation) report, fixtures, guards, the edge decision, and the seal.
// Pure and deterministic: no timestamps, no timings. Integers, integer rationals and decimal strings only.
import { canonicalJSON, sha256HexJS } from "@bl/schema";
import type { ArmId } from "./arms.ts";
import { runBlock, type ArmOutcome, type BlockResult, type Contrasts } from "./assay.ts";
import { ALPHA, decideCandidates, contrastResult, medianTimes2, panelVerdict, type CandidateInput, type CandidateResult, type ContrastResult, type PanelResult } from "./decision.ts";
import { GIFT, FIXTURE_SEEDS, decideFixture, fixtureProtocol, giftBlock, nullBlock, runGuards, takeoverBlock, wallBlock, wallGateBlock, type FixtureReport, type GiftVariant, type GuardResult, type WallKind } from "./fixtures.ts";
import { PROTOCOL, protocolHash, type Protocol } from "./protocol.ts";

export const EVIDENCE_VERSION = "niche-evidence-v1";

const OUT_FIELDS = ["y", "receiverB", "survived", "builderB", "synthesis", "decomp", "resp", "saturated", "growthAttributed", "energyEnd", "endHash"] as const;

export interface CompactBlock {
  seed: number;
  cluster: number;
  valid: boolean;
  invalidReason: string | null;
  nPlaced: number;
  dE: number;
  dB: number;
  costs: BlockResult["costs"];
  startTotals: BlockResult["startTotals"];
  /** Per arm: every transfer op (funding, removal, scramble, conversion, matched-control debit, placement) with its complete before/after inventories, detail and exact residuals. */
  transfers: BlockResult["transfers"];
  outcomes: Record<string, Pick<ArmOutcome, (typeof OUT_FIELDS)[number]>>;
  contrasts: Contrasts | null;
}

export function compactBlock(b: BlockResult): CompactBlock {
  return {
    seed: b.seed,
    cluster: b.cluster,
    valid: b.valid,
    invalidReason: b.invalidReason,
    nPlaced: b.nPlaced,
    dE: b.dE,
    dB: b.dB,
    costs: b.costs,
    startTotals: b.startTotals,
    transfers: b.transfers,
    outcomes: Object.fromEntries(Object.entries(b.outcomes).map(([k, v]) => [k, Object.fromEntries(OUT_FIELDS.map((f) => [f, (v as unknown as Record<string, unknown>)[f]]))])) as CompactBlock["outcomes"],
    contrasts: b.contrasts,
  };
}

/** Twice the median (sum of the two middle values for an even count): an integer, so nothing is rounded or floated; render by dividing by two. */
const medianOrNull = (xs: readonly number[]): number | null => (xs.length ? medianTimes2(xs) : null);

export interface WallReport {
  kind: WallKind;
  totalP: number;
  seeds: readonly number[];
  d: number[];
  k: number;
  p: { num: number; den: number };
  medianTimes2: number;
  passes: boolean;
  wallY: number[];
  scrambledY: number[];
}

export function wallReport(kind: WallKind, totalP: number, p: Protocol = PROTOCOL): WallReport {
  const pp: Protocol = { ...p, wall: { ...p.wall, totalP } };
  const runs = p.wallSeeds.map((s) => wallBlock(kind, s, pp));
  const delta = Math.ceil(p.reserve.B / 50);
  const r: ContrastResult = contrastResult(runs.map((x) => x.d), delta, ALPHA);
  return { kind, totalP, seeds: p.wallSeeds, d: runs.map((x) => x.d), k: r.k, p: r.p, medianTimes2: r.medianTimes2, passes: r.passes, wallY: runs.map((x) => x.wall.y), scrambledY: runs.map((x) => x.scrambled.y) };
}

export interface DevCandidate {
  cluster: number;
  blocks: CompactBlock[];
  /** |Y(b|X, seed) - Y(b|X, replicate seed)| for X in builder, nonbuilder, over the dev blocks. */
  replicateAbs: number[];
  deltaProposed: number;
  /** Twice the median over dev blocks of the builder history's total polymer P at the end of conditioning. */
  builderPMedianTimes2: number;
  /** PLAN 5.3: 2 * median(P) > 2 * deltaProposed, i.e. the builder left more polymer than the Stage-2 replicate noise floor. */
  polymerAdequate: boolean;
}

export interface DevReport {
  purpose: "calibration";
  seeds: readonly number[];
  candidates: DevCandidate[];
  wall: { W1: WallReport; W2: WallReport; builderScale: { W1: WallReport; W2: WallReport }; positiveControlPassed: boolean; used: WallKind | null; note: string };
}

/** PLAN 5.3 adequacy: the builder's median polymer at the end of conditioning, as twice the median, exceeds twice the candidate's dev replicate floor. */
export const isPolymerAdequate = (pMedianTimes2: number, delta: number): boolean => pMedianTimes2 > 2 * delta;

export function deltaOf(reserveB: number, replicateAbs: readonly number[]): number {
  const m = replicateAbs.length ? Math.max(...replicateAbs) : 0;
  return Math.max(Math.ceil(reserveB / 50), Math.ceil((3 * m) / 2));
}

export function devReport(p: Protocol = PROTOCOL): DevReport {
  const candidates: DevCandidate[] = p.panel.map((cluster) => {
    const blocks = p.devSeeds.map((s, i) => compactBlock(runBlock(cluster, s, p, p.devReplicateSeeds[i])));
    const invalid = blocks.filter((b) => !b.valid);
    if (invalid.length) throw new Error(`cluster ${cluster}: invalid dev block(s) ${invalid.map((b) => `${b.seed} (${b.invalidReason})`).join(", ")}`);
    const rep = blocks.flatMap((b) => (b.contrasts ? [Math.abs(b.contrasts.replicateBuilder ?? 0), Math.abs(b.contrasts.replicateNonbuilder ?? 0)] : []));
    const pMed2 = medianTimes2(blocks.map((b) => Number(b.costs.find((c) => c.kind === "builder")?.P ?? 0)));
    const deltaProposed = deltaOf(p.reserve.B, rep);
    return { cluster, blocks, replicateAbs: rep, deltaProposed, builderPMedianTimes2: pMed2, polymerAdequate: isPolymerAdequate(pMed2, deltaProposed) };
  });
  const W1 = wallReport("W1", p.wall.totalP, p), W2 = wallReport("W2", p.wall.totalP, p);
  const bs = { W1: wallReport("W1", p.wall.builderScaleP, p), W2: wallReport("W2", p.wall.builderScaleP, p) };
  return { purpose: "calibration", seeds: p.devSeeds, candidates, wall: { W1, W2, builderScale: bs, positiveControlPassed: W1.passes || W2.passes, used: W2.passes ? "W2" : W1.passes ? "W1" : null, note: "Structure detection only: the wall-versus-P-scrambled contrast. W2 puts polymer under the receiver (allowP), a placement the real assay forbids, and neither wall exercises the builder, ablation or inoculum contrasts. The four-contrast gate on a hand-built field is run separately (fixtures.handWallGate)." } };
}

export interface FreshCandidate {
  cluster: number;
  blocks: CompactBlock[];
  input: CandidateInput;
  /** Per-arm twice-the-median receiver-labelled biomass at T2 over the fresh blocks (integer; divide by two to read it). */
  medianYTimes2: Record<string, number | null>;
  /** Per arm: blocks in which the receiver-labelled biomass at T2 was above zero, out of the blocks that ran the arm. */
  survivedByArm: Record<string, { survived: number; of: number }>;
  fluxAttribution: { available: boolean; reason: string; growthAttributedBlocks: number; coCulture: "unavailable" };
}

export interface FreshReport {
  purpose: "confirmation";
  seeds: readonly number[];
  candidates: FreshCandidate[];
  results: CandidateResult[];
  panel: PanelResult;
  /** false when the positive control failed on dev: no confirmation seed was run (PLAN gate G3). */
  ran: boolean;
  /** Stated caveats that qualify how to read the panel verdict (sensitivity at builder-scale polymer, replicate noise). */
  caveats: string[];
}

const ARMS: ArmId[] = ["a", "b", "c", "cP", "cNP", "nb", "ab", "d0", "d1E", "d1B"];

export function freshReport(dev: DevReport, p: Protocol = PROTOCOL): FreshReport {
  if (!dev.wall.positiveControlPassed) {
    // G3: the assay is insensitive; stop with no fresh run and say so.
    const zeros = Array(p.freshSeeds.length).fill(0);
    const inputs: CandidateInput[] = p.panel.map((c) => ({ id: `cluster-${c}`, status: "ok", invalidReasons: [], contrasts: { builder: zeros, poly: zeros, space: zeros, inoc: zeros, spaceP: zeros, spaceNP: zeros }, delta: p.delta[String(c)], survivedBlocks: 0, blocks: p.freshSeeds.length, polymerAdequate: true, expectedBlocks: p.freshSeeds.length }));
    const results = decideCandidates(inputs, false);
    return { purpose: "confirmation", seeds: p.freshSeeds, candidates: [], results, panel: panelVerdict(results), ran: false, caveats: ["The hand-built positive control showed no spatial dependence on dev, so no confirmation seed was run."] };
  }
  const candidates: FreshCandidate[] = p.panel.map((cluster) => {
    const raw = p.freshSeeds.map((s) => compactBlock(runBlock(cluster, s, p)));
    const devC = dev.candidates.find((c) => c.cluster === cluster)!;
    const col = (k: keyof Contrasts) => raw.map((b) => (b.contrasts ? (b.contrasts[k] as number) : 0));
    const validBlocks = raw.filter((b) => b.valid).length;
    const reasons = raw.filter((b) => !b.valid).map((b) => `seed ${b.seed}: ${b.invalidReason}`);
    const sat = raw.filter((b) => Object.values(b.outcomes).some((o) => o.saturated)).length;
    const input: CandidateInput = {
      id: `cluster-${cluster}`,
      status: validBlocks === raw.length ? "ok" : "invalid",
      invalidReasons: reasons,
      contrasts: { builder: col("builder"), poly: col("poly"), space: col("space"), inoc: col("inoc"), spaceP: col("spaceP"), spaceNP: col("spaceNP") },
      delta: p.delta[String(cluster)],
      survivedBlocks: raw.filter((b) => b.outcomes.b?.survived).length,
      blocks: validBlocks,
      polymerAdequate: devC.polymerAdequate,
      expectedBlocks: p.freshSeeds.length,
    };
    const medianYTimes2 = Object.fromEntries(ARMS.map((a) => [a, medianOrNull(raw.filter((b) => b.outcomes[a]).map((b) => b.outcomes[a].y))]));
    const survivedByArm = Object.fromEntries(ARMS.map((a) => [a, { survived: raw.filter((b) => b.outcomes[a]?.survived).length, of: raw.filter((b) => b.outcomes[a]).length }]));
    return {
      cluster,
      blocks: raw,
      input,
      medianYTimes2,
      survivedByArm,
      fluxAttribution: validBlocks === 0 ? { available: false, reason: "no valid block produced a measurement", growthAttributedBlocks: 0, coCulture: "unavailable" } : sat === 0 ? { available: true, reason: "no role counter reached saturation in any block; the co-culture arm (a) is never attributed", growthAttributedBlocks: raw.filter((b) => b.outcomes.b?.growthAttributed).length, coCulture: "unavailable" } : { available: false, reason: `a role counter reached ${p.roleSaturation} in ${sat} block(s)`, growthAttributedBlocks: 0, coCulture: "unavailable" },
    };
  });
  const results = decideCandidates(candidates.map((c) => c.input), dev.wall.positiveControlPassed);
  const bs = dev.wall.builderScale;
  const caveats: string[] = [];
  if (!(bs.W1.passes || bs.W2.passes)) caveats.push(`The hand-built wall at builder-scale polymer (${p.wall.builderScaleP}) was not detected on dev (W1 ${bs.W1.k}/${bs.W1.d.length}, W2 ${bs.W2.k}/${bs.W2.d.length} positive), so the assay is shown to see a structure ${Math.round(p.wall.totalP / p.wall.builderScaleP)} times builder scale and a null for builder-scale polymer is weak evidence of absence.`);
  const noise = Math.max(...dev.candidates.map((c) => c.deltaProposed));
  caveats.push(`Stage-2 replicate noise sets delta (largest ${noise}) against a receiver inoculum of ${p.reserve.B}: only a large effect could pass.`);
  return { purpose: "confirmation", seeds: p.freshSeeds, candidates, results, panel: panelVerdict(results), ran: true, caveats };
}

export interface FixturesReport {
  protocol: { grid: number; kernelRadius: number; T2: number; reserve: { B: number; E: number }; delta: number };
  reports: FixtureReport[];
  gift: Record<GiftVariant, number>;
  guards: GuardResult[];
  /** The hand-built wall (W2, polymer under the receiver) through all arms and the four gating contrasts at the frozen scale; outside the real placement rule. */
  handWallGate: FixtureReport;
}

export function fixturesReport(p: Protocol = PROTOCOL): FixturesReport {
  const fp = fixtureProtocol();
  const delta = Math.ceil(fp.reserve.B / 50);
  const reports: FixtureReport[] = [];
  for (const v of ["uniform", "footprint", "annulus"] as const) reports.push(decideFixture(`energy-gift-${v}`, FIXTURE_SEEDS, FIXTURE_SEEDS.map((s) => giftBlock(v, s, fp)), delta));
  reports.push(decideFixture("takeover-only", FIXTURE_SEEDS, FIXTURE_SEEDS.map((s) => takeoverBlock(s, fp)), delta));
  reports.push(decideFixture("null-field", FIXTURE_SEEDS, FIXTURE_SEEDS.map((s) => nullBlock(s, fp)), delta));
  const handWallGate = decideFixture("hand-wall-gate-W2", FIXTURE_SEEDS, FIXTURE_SEEDS.map((s) => wallGateBlock("W2", s, p)), Math.ceil(p.reserve.B / 50));
  return { protocol: { grid: fp.grid, kernelRadius: fp.kernelRadius, T2: fp.T2, reserve: fp.reserve, delta }, reports, gift: GIFT, guards: runGuards(), handWallGate };
}

/** Block, step and cost accounting of one regeneration (informational; timings are measured by the tool, never sealed). */
export function stepProjection(p: Protocol = PROTOCOL): { formula: string; blocks: number; steps: number } {
  const blocks = p.panel.length * (p.devSeeds.length + p.freshSeeds.length);
  const devExtra = p.panel.length * p.devSeeds.length * 2 * p.T2;
  const perBlock = 2 * p.T1 + 10 * p.T2;
  const fp = fixtureProtocol();
  // Fixtures: five unit-scale fixtures x seeds x 9 arms x fixture T2, plus the hand-wall gate (9 arms at the frozen T2).
  const fixtureSteps = 5 * FIXTURE_SEEDS.length * 9 * fp.T2 + FIXTURE_SEEDS.length * 9 * p.T2;
  return { formula: "blocks * (2*T1 + 10*T2) + devBlocks * 2*T2 + wall runs (4 * 2 * wallSeeds * T2) + fixtures (5 * seeds * 9 * fixtureT2 + seeds * 9 * T2)", blocks, steps: blocks * perBlock + devExtra + 4 * 2 * p.wallSeeds.length * p.T2 + fixtureSteps };
}

export interface Payload {
  kind: "niche-evidence";
  version: string;
  protocol: Protocol;
  protocolHash: string;
  registryDigest: string;
  stepProjection: ReturnType<typeof stepProjection>;
  dev: DevReport;
  fresh: FreshReport;
  fixtures: FixturesReport;
  limits: string[];
  /** Rule amendments made after a first pass had been observed (REVIEW.md); sealed so the page can state them. */
  amendments: string[];
  integritySha256: string;
}

export const AMENDMENTS: readonly string[] = [
  "Amendments after a first pass (REVIEW.md): polymer adequacy compares builder polymer with the dev replicate floor as PLAN 5.3 states (the first pass used a fixed 10); the receiver-alone comparator carries the conditioning stage's net dissipation as named analytic heat; the biomass-matched control matches bound biomass B only; co-culture flux attribution is unavailable; medians are reported as twice-the-median integers; sealed evidence keeps every arm's full before/after inventories.",
  "A first fresh pass (seeds 8600101-8600108) was observed under the earlier rules and is superseded and not reported as confirmation. The amended rules were frozen, then run once on new fresh seeds 8600501-8600508 that had not been run before.",
];

export const LIMITS: readonly string[] = [
  "Exploratory, CPU only (sim-ref), mutation off. No GPU evidence, no physics change, not part of the frozen preregistration.",
  "A negative bounds this panel (3 builders, 1 receiver), these horizons, this field and this injury regime only; it does not say a second link is impossible.",
  "Eight fresh blocks with exact sign tests and Holm across candidates can only certify an effect that is positive in all or nearly all blocks; a modest real effect reads as unsupported.",
  "The inoculum-matched controls screen resource totals delivered as inoculum; they do not prove that no spatial resource effect exists.",
  "The ablation arm is analytical (polymer converted to waste at transfer, released energy booked as named heat): it tests whether the polymer itself carries the benefit, not the pinned in-sim polymerTransport ablation.",
  "kGene maintenance is not separable from catalytic and ordinary maintenance in the reference step and is reported unavailable.",
  "Receiver-labelled biomass inventory can rise by relabelling existing detritus; growth is claimed only where flux attribution is available and synthesis is at least half the gain.",
  "Builder polymer at this scale is far below the hand-wall control's; the builder-scale wall result is reported, not gating.",
  "The receiver-alone comparator (d0, and so d1E and d1B) carries the same net energy dissipation as the conditioned field (booked as named analytic heat), so it does not start richer simply for skipping the conditioning stage. The matched-inventory controls still hand matter or energy to the receiver as inoculum, which a structure with a strong enough effect can still beat (the hand-wall gate fixture does, by +33 to +270), but a modest spatial benefit may not; they screen resource totals and do not prove that no spatial resource effect exists.",
  "Co-culture (arm a) flux attribution is unavailable: producing-cell ownership is not observed before injury can clear a lineage.",
  "The dev hand-wall positive control (W2) places polymer under the receiver, which the real placement rule forbids; it shows structure can be detected, not that the four-contrast gate can certify a builder's field.",
];

export function sealPayload(body: Omit<Payload, "integritySha256">): Payload {
  const integritySha256 = sha256HexJS(new TextEncoder().encode(canonicalJSON(body)));
  return { ...body, integritySha256 };
}
export function verifySeal(p: Payload): boolean {
  const { integritySha256, ...body } = p;
  return integritySha256 === sha256HexJS(new TextEncoder().encode(canonicalJSON(body)));
}

export function buildPayload(registryDigest: string, p: Protocol = PROTOCOL): Payload {
  const dev = devReport(p);
  const fresh = freshReport(dev, p);
  return sealPayload({ kind: "niche-evidence", version: EVIDENCE_VERSION, protocol: p, protocolHash: protocolHash(registryDigest, p), registryDigest, stepProjection: stepProjection(p), dev, fresh, fixtures: fixturesReport(p), limits: [...LIMITS], amendments: [...AMENDMENTS] });
}
