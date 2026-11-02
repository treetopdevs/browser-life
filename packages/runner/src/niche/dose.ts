// I06b positive control at realistic scale (PLAN section 4.3): a hand-built polymer wall under the ORDINARY placement rule (no
// overwrite of polymer; same pool-cap and reserve guards), dose ladder ascending, the four gating contrasts per wall seed.
// W1 (ring around the footprint) is the only geometry that placement can legally accommodate; W2 (floor under the receiver) needs
// allowP and is probed here only to record why it is unavailable.
import { receiverAlone, placeAll } from "./arms.ts";
import { medianTimes2, signTestP } from "./decision.ts";
import { buildFreeMatched } from "./freeEnergy.ts";
import { buildWall, controlsAround, nominalBudget, wallCells } from "./fixtures.ts";
import { GATING_FE, PROTOCOL_FE, type GatingFe, type ProtocolFe } from "./protocol.ts";
import { contrastsOfFe, runArmReplicated, type ArmOutcomeFe } from "./replicate.ts";
import { NicheInvalid, cloneAudit, cloneState } from "./transfer.ts";
import type { PreArm } from "./arms.ts";

export interface WallSeedResult {
  seed: number;
  contrasts: Record<GatingFe, number>;
  /** Y of the wall arm b (summed over replicates) and receiver-present replicates. */
  yWall: number;
  viableReps: number;
}

/** One wall seed at one dose: wall W1 through every arm and replicate under ordinary placement. */
export function wallGateBlockFe(seed: number, totalP: number, p: ProtocolFe = PROTOCOL_FE): WallSeedResult {
  const pp: ProtocolFe = { ...p, wall: { ...p.wall, totalP } };
  const base = receiverAlone({ audit: nominalBudget(seed, pp) }, seed, pp);
  const wall: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  buildWall(wall, wallCells("W1", pp), totalP, pp);
  const arms = [...controlsAround(wall, base, seed, pp)];
  const fm = buildFreeMatched(arms[0], pp);
  if (fm.arms.length === 0) throw new NicheInvalid("every free-energy-matched comparator was refused");
  arms.push(...fm.arms);
  placeAll(arms, pp, { allowP: false });
  const out: Record<string, ArmOutcomeFe> = {};
  for (const x of arms) out[x.id] = runArmReplicated(x, seed, pp, pp.R);
  const c = contrastsOfFe(out);
  return { seed, contrasts: { builder: c.builder, poly: c.poly, space: c.space, inoc2: c.inoc2 }, yWall: out.b.y, viableReps: out.b.survivedReps };
}

export interface DoseRow {
  totalP: number;
  seeds: readonly number[];
  results: WallSeedResult[];
  /** Per gating contrast: seeds positive and twice the median difference. */
  stats: Record<GatingFe, { k: number; p: { num: number; den: number }; medianTimes2: number }>;
  /** The gating contrast with the smallest median effect: where G-NOISE is read. */
  limiting: GatingFe;
  limitingMedianTimes2: number;
}

export function doseRow(totalP: number, results: WallSeedResult[]): DoseRow {
  const stats = Object.fromEntries(
    GATING_FE.map((k) => {
      const d = results.map((r) => r.contrasts[k]);
      const kk = d.filter((x) => x > 0).length;
      return [k, { k: kk, p: signTestP(d.length, kk), medianTimes2: medianTimes2(d) }];
    }),
  ) as DoseRow["stats"];
  const limiting = GATING_FE.reduce((m, k) => (stats[k].medianTimes2 < stats[m].medianTimes2 ? k : m), GATING_FE[0]);
  return { totalP, seeds: results.map((r) => r.seed), results, stats, limiting, limitingMedianTimes2: stats[limiting].medianTimes2 };
}

/** Wall pass at a dose for a candidate: every gating contrast positive in at least wallPassMin seeds and median >= delta. */
export function wallPasses(row: DoseRow, delta: number, p: ProtocolFe = PROTOCOL_FE): boolean {
  return GATING_FE.every((k) => row.stats[k].k >= p.wallPassMin && row.stats[k].medianTimes2 >= 2 * delta);
}
/** G-NOISE: delta at most 1/noiseDivisor of the limiting contrast's median effect (twice-median integers: medianTimes2 >= 2 * noiseDivisor * delta). */
export function noiseGate(row: DoseRow, delta: number, p: ProtocolFe = PROTOCOL_FE): boolean {
  return row.limitingMedianTimes2 >= 2 * p.noiseDivisor * delta;
}

export interface Qualification {
  cluster: number;
  delta: number;
  /** 2 x the median dev builder polymer at T1 = twice-the-median integer builderPMedianTimes2. */
  ceiling: number;
  /** Smallest dose at which the wall passes ignoring the ceiling (the minimum detectable dose), or null if none on the ladder. */
  minDetectableDose: number | null;
  /** Smallest dose <= ceiling where the wall passes and G-NOISE holds, or null. */
  qualifyingDose: number | null;
  /** Doses <= ceiling on the ladder. */
  dosesWithinCeiling: number[];
  qualified: boolean;
  reason: string;
}

export function qualify(cluster: number, delta: number, builderPMedianTimes2: number, rows: readonly DoseRow[], p: ProtocolFe = PROTOCOL_FE): Qualification {
  const ceiling = builderPMedianTimes2;
  const within = rows.filter((r) => r.totalP <= ceiling);
  const mdd = rows.find((r) => wallPasses(r, delta, p)) ?? null;
  const q = within.find((r) => wallPasses(r, delta, p) && noiseGate(r, delta, p)) ?? null;
  const reason = q
    ? `W1 passes at ${q.totalP} (<= ceiling ${ceiling}) and delta ${delta} is at most half of the limiting contrast (${q.limiting}) median effect`
    : mdd === null
      ? `W1 is not detected at any ladder dose up to ${rows.length ? rows[rows.length - 1].totalP : 0} (passing needs ${p.wallPassMin} of ${p.wallSeeds.length} seeds positive on all four contrasts and median >= delta ${delta})`
      : mdd.totalP > ceiling
        ? `minimum detectable dose ${mdd.totalP} exceeds the realistic ceiling ${ceiling} (2 x dev builder polymer median)`
        : `W1 passes at ${mdd.totalP} but delta ${delta} exceeds half of the limiting contrast (${mdd.limiting}) median effect ${mdd.limitingMedianTimes2 / 2} (G-NOISE)`;
  return { cluster, delta, ceiling, minDetectableDose: mdd?.totalP ?? null, qualifyingDose: q?.totalP ?? null, dosesWithinCeiling: within.map((r) => r.totalP), qualified: q !== null, reason };
}

export interface LadderReport {
  geometry: "W1";
  rows: DoseRow[];
  w2: { status: "unavailable"; reason: string } | { status: "available"; reason: string };
}

/** Probe W2 (polymer floor under the receiver) under ordinary placement: expected to refuse, which is recorded as the reason it is unavailable. */
export function probeW2(p: ProtocolFe = PROTOCOL_FE): LadderReport["w2"] {
  const seed = p.wallSeeds[0];
  const pp: ProtocolFe = { ...p, wall: { ...p.wall, totalP: p.doses[0] } };
  const base = receiverAlone({ audit: nominalBudget(seed, pp) }, seed, pp);
  const wall: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  buildWall(wall, wallCells("W2", pp), p.doses[0], pp);
  try {
    placeAll([wall, base], pp, { allowP: false });
    return { status: "available", reason: "ordinary placement found enough common cells over the floor" };
  } catch (e) {
    if (e instanceof NicheInvalid) return { status: "unavailable", reason: `ordinary placement refuses a polymer floor under the receiver: ${e.reason}` };
    throw e;
  }
}

/**
 * A candidate is settled once the ladder cannot teach more about it: it has qualified (a dose within its ceiling passes the wall
 * rule and G-NOISE), or it has a passing dose (its minimum detectable dose is known) and every dose within its ceiling has run.
 * Otherwise the ladder continues, to the top if need be, to state the minimum detectable dose or its absence.
 */
export function settled(rows: readonly DoseRow[], delta: number, ceiling: number, p: ProtocolFe = PROTOCOL_FE): boolean {
  if (rows.some((r) => r.totalP <= ceiling && wallPasses(r, delta, p) && noiseGate(r, delta, p))) return true;
  const eligibleDone = p.doses.filter((d) => d <= ceiling).every((d) => rows.some((r) => r.totalP === d));
  return eligibleDone && rows.some((r) => wallPasses(r, delta, p));
}

/** Run the ladder ascending until every candidate is settled (see settled) or the ladder is exhausted. */
export function runLadder(deltas: Readonly<Record<string, number>>, ceilings: Readonly<Record<string, number>>, p: ProtocolFe = PROTOCOL_FE, onDose?: (row: DoseRow) => void): LadderReport {
  const rows: DoseRow[] = [];
  for (const dose of p.doses) {
    const row = doseRow(dose, p.wallSeeds.map((s) => wallGateBlockFe(s, dose, p)));
    rows.push(row);
    onDose?.(row);
    if (Object.keys(deltas).every((c) => settled(rows, deltas[c], ceilings[c], p))) break;
  }
  return { geometry: "W1", rows, w2: probeW2(p) };
}
