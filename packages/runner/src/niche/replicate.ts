// I06b replicated Stage 2 (PLAN section 4.2): every arm's Stage 2 is run for R sim seeds (block seed + k * stride), the same
// offsets in every arm, so injury steps and RNG keys coincide across arms. Stage 1 histories and transfers are shared.
// Primary endpoint Y = integer sum over the R replicates of the receiver-labelled biomass at T2.
import { cloneAudit, cloneState, NicheInvalid, snap, type Snap, type TransferRecord } from "./transfer.ts";
import { buildArms, placeAll, type PreArm } from "./arms.ts";
import { runArm, historyCost, type ArmOutcome, type Hooks, type HistoryCost } from "./assay.ts";
import { buildFreeMatched, freeRows, type FreeRow } from "./freeEnergy.ts";
import { PROTOCOL_FE, candidateOf, type ProtocolFe } from "./protocol.ts";

export const ARMS_FE = ["a", "b", "c", "cP", "cNP", "nb", "ab", "d0", "d1E", "d1B", "fU", "fS", "fB"] as const;
export type ArmIdFe = (typeof ARMS_FE)[number] | string;

export interface ArmOutcomeFe {
  id: string;
  /** Receiver-labelled B at T2 per replicate, and their sum Y. */
  ys: number[];
  y: number;
  /** Replicates in which the receiver B at T2 was above zero. */
  survivedReps: number;
  /** Secondary, never gating: area under the receiver-B census curve summed over replicates (each curve: sum over the censuses after the start). */
  auc: number;
  builderB: number;
  synthesis: number | null;
  saturated: boolean;
  growthAttributedReps: number;
  energyEnd: string;
  endHashes: string[];
}

export const seedFor = (seed: number, k: number, p: { replicateStride: number } = PROTOCOL_FE): number => seed + k * p.replicateStride;

/** Run the same placed arm for R replicate sim seeds; every census of every replicate is audited to an exact zero residual (runArm throws otherwise). */
export function runArmReplicated(x: PreArm, seed: number, p: ProtocolFe, R: number = p.R, hooks: Hooks = {}, offsets?: readonly number[]): ArmOutcomeFe {
  const ks = offsets ?? Array.from({ length: R }, (_, k) => k);
  const outs: ArmOutcome[] = ks.map((k) => {
    const rep: PreArm = { id: x.id, state: cloneState(x.state, { ...x.state.cfg, seed: seedFor(seed, k, p) }), audit: cloneAudit(x.audit), records: [] };
    return runArm(rep, p, hooks);
  });
  const sum = (f: (o: ArmOutcome) => number) => outs.reduce((t, o) => t + f(o), 0);
  return {
    id: x.id,
    ys: outs.map((o) => o.y),
    y: sum((o) => o.y),
    survivedReps: outs.filter((o) => o.survived).length,
    auc: sum((o) => o.receiverB.slice(1).reduce((t, v) => t + v, 0)),
    builderB: sum((o) => o.builderB),
    synthesis: x.id === "a" ? null : sum((o) => o.synthesis ?? 0),
    saturated: outs.some((o) => o.saturated),
    growthAttributedReps: outs.filter((o) => o.growthAttributed).length,
    energyEnd: outs[0].energyEnd,
    endHashes: outs.map((o) => o.endHash),
  };
}

export interface ContrastsFe {
  builder: number;
  poly: number;
  space: number;
  /** Free-energy-matched: Y(b) - max over every constructed comparator (d1E, d1B, fU, fS, fB). */
  inoc2: number;
  /** First rung's contrast, reported next to inoc2 (summed-R units). */
  inoc: number;
  /** Reported, never gating: Y(b) minus the best of the three free-energy-matched comparators alone (fU, fS, fB), so the matching is read without the first rung's comparators in the max. */
  inocMatched: number;
  spaceP: number;
  spaceNP: number;
  naive: number;
  /** Paired survival (replicates with receiver present): b minus the best comparator. Attribution only. */
  survivalVsInoc2: number;
}

export function contrastsOfFe(o: Partial<Record<string, ArmOutcomeFe>>): ContrastsFe {
  const g = (id: string): ArmOutcomeFe => {
    const v = o[id];
    if (!v) throw new NicheInvalid(`arm ${id} missing`);
    return v;
  };
  const yb = g("b").y;
  const comps = ["d1E", "d1B", "fU", "fS", "fB"].filter((id) => o[id]);
  return {
    builder: yb - g("nb").y,
    poly: yb - g("ab").y,
    space: yb - g("c").y,
    inoc2: yb - Math.max(...comps.map((id) => g(id).y)),
    inoc: yb - Math.max(g("d1E").y, g("d1B").y),
    inocMatched: yb - Math.max(...["fU", "fS", "fB"].filter((id) => o[id]).map((id) => g(id).y)),
    spaceP: yb - g("cP").y,
    spaceNP: yb - g("cNP").y,
    naive: yb - g("d0").y,
    survivalVsInoc2: g("b").survivedReps - Math.max(...comps.map((id) => g(id).survivedReps)),
  };
}

export interface TransferLite {
  op: string;
  energyBefore: string;
  energyAfter: string;
  residual: string;
  matterResidual: string;
  detail: Record<string, number | string>;
}
export const liteTransfers = (rs: readonly TransferRecord[]): TransferLite[] => rs.map((r) => ({ op: r.op, energyBefore: r.before.energy, energyAfter: r.after.energy, residual: r.residual, matterResidual: r.matterResidual, detail: r.detail }));

export interface BlockResultFe {
  seed: number;
  cluster: number;
  valid: boolean;
  invalidReason: string | null;
  nPlaced: number;
  dE: number;
  dB: number;
  dBFree: number;
  refused: { id: string; reason: string }[];
  costs: HistoryCost[];
  /** Free energy and total energy per arm, before and after the shared inoculum placement. */
  freeBefore: FreeRow[];
  freeAfter: FreeRow[];
  startTotals: Record<string, Snap>;
  transfers: Record<string, TransferLite[]>;
  outcomes: Record<string, ArmOutcomeFe>;
  contrasts: ContrastsFe | null;
  /** Receiver survived (B > 0) in at least R - 1 of R replicates in the field arm b. */
  viable: boolean;
}

/** One block: Stage 1 histories (shared), transfers, shared placement, free-energy-matched comparators, R replicates of every Stage 2 arm. An invalid block is reported, never dropped. */
export function runBlockFe(cluster: number, seed: number, p: ProtocolFe = PROTOCOL_FE, hooks: Hooks = {}): BlockResultFe {
  const base: BlockResultFe = { seed, cluster, valid: false, invalidReason: null, nPlaced: 0, dE: 0, dB: 0, dBFree: 0, refused: [], costs: [], freeBefore: [], freeAfter: [], startTotals: {}, transfers: {}, outcomes: {}, contrasts: null, viable: false };
  let arms: PreArm[] = [];
  try {
    const built = buildArms(candidateOf(cluster, p), seed, p);
    arms = built.arms;
    base.dE = built.dE;
    base.dB = built.dB;
    base.costs = [historyCost("builder", built.histories.builder.state, p), historyCost("nonbuilder", built.histories.nonbuilder.state, p)];
    const fm = buildFreeMatched(arms.find((x) => x.id === "b")!, p);
    base.refused = fm.refused;
    base.dBFree = fm.dB;
    if (fm.arms.length === 0) throw new NicheInvalid(`every free-energy-matched comparator was refused: ${fm.refused.map((r) => `${r.id} (${r.reason})`).join("; ")}`);
    arms = [...arms, ...fm.arms];
    base.freeBefore = freeRows(arms);
    base.nPlaced = placeAll(arms, p).length;
    base.freeAfter = freeRows(arms);
    for (const x of arms) {
      base.startTotals[x.id] = snap(x.state, x.audit);
      base.transfers[x.id] = liteTransfers(x.records);
    }
    for (const x of arms) base.outcomes[x.id] = runArmReplicated(x, seed, p, p.R, hooks);
    base.contrasts = contrastsOfFe(base.outcomes);
    base.viable = base.outcomes.b.survivedReps >= p.R - 1;
    base.valid = true;
  } catch (e) {
    if (!(e instanceof NicheInvalid)) throw e;
    base.invalidReason = e.reason;
    for (const x of arms) base.transfers[x.id] ??= liteTransfers(x.records);
  }
  return base;
}

/** Replicate-noise control for one block: the builder-removed (b) and nonbuilder-removed (nb) arms, Y over replicate set A = offsets 0..R-1 against a disjoint set B = offsets R..2R-1. */
export function noiseBlock(cluster: number, seed: number, p: ProtocolFe = PROTOCOL_FE): { absBuilder: number; absNonbuilder: number } {
  if (2 * p.R - 1 > p.maxOffsetIndex) throw new NicheInvalid(`R = ${p.R} needs offsets above the reserved ${p.maxOffsetIndex}; extend the registry reservation before escalating`);
  const built = buildArms(candidateOf(cluster, p), seed, p);
  placeAll(built.arms, p);
  const A = Array.from({ length: p.R }, (_, k) => k), B = Array.from({ length: p.R }, (_, k) => k + p.R);
  const y = (id: string, offs: number[]) => runArmReplicated(built.arms.find((x) => x.id === id)!, seed, p, p.R, {}, offs).y;
  return { absBuilder: Math.abs(y("b", A) - y("b", B)), absNonbuilder: Math.abs(y("nb", A) - y("nb", B)) };
}
