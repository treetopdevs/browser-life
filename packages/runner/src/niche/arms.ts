// Arm construction: conditioning histories (builder, nonbuilder), transfers (a co-culture, b builder removed, c matched-inventory
// scramble, cP P-only scramble, cNP non-P scramble, ablation), history-independent controls (d0 receiver alone, d1E energy-matched,
// d1B biomass-matched) and the shared inoculum placement. All arms of a block start at the same absolute step T1 with the same seed.
import { CH, buildWorld, cellCount, encodeGenome, lowbias32, packLineageLo, MOT_ZERO, allocState, type Genome, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { PROTOCOL, receiverGenome, worldConfig, type Candidate, type Protocol } from "./protocol.ts";
import {
  NicheInvalid,
  assertAudit,
  audited,
  cloneAudit,
  cloneState,
  commonCells,
  convertPolymer,
  fundReserve,
  moveToReserve,
  openAudit,
  placeInoculum,
  relabelLiving,
  scrambleChannels,
  type Audit,
  type TransferRecord,
} from "./transfer.ts";

export const ARM_IDS = ["a", "b", "c", "cP", "cNP", "nb", "ab", "d0", "d1E", "d1B"] as const;
export type ArmId = (typeof ARM_IDS)[number] | "rb" | "rnb";

export interface PreArm {
  id: ArmId;
  state: WorldState;
  audit: Audit;
  records: TransferRecord[];
}

export const disc = (cx: number, cy: number, r: number, W: number, H: number): number[] => {
  const out: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out.push(y * W + x);
  return out;
};
export const footprintCells = (p: Protocol = PROTOCOL): number[] => disc(p.footprint.x, p.footprint.y, p.footprint.radius, p.grid, p.grid);
/** Footprint plus halo: where inoculum-matching is measured. */
export const regionCells = (p: Protocol = PROTOCOL): number[] => disc(p.footprint.x, p.footprint.y, p.footprint.radius + p.halo, p.grid, p.grid);
export const outsideRegion = (p: Protocol = PROTOCOL): number[] => {
  const inR = new Set(regionCells(p));
  return Array.from({ length: p.grid * p.grid }, (_, i) => i).filter((i) => !inR.has(i));
};

export function startWorld(cand: Candidate, kind: "builder" | "nonbuilder", seed: number, p: Protocol = PROTOCOL): WorldState {
  const cfg = worldConfig(seed, p);
  const f = p.founders;
  const s = buildWorld(cfg, { nutrient: p.nutrient, founders: [{ x: f.x, y: f.y, radius: f.radius, genome: cand[kind], biomass: f.biomass, energy: f.energy }] });
  const n = cellCount(cfg);
  for (let i = 0; i < n; i++) s.cells[CH.E * n + i] += p.backgroundE;
  return s;
}

export interface History {
  state: WorldState;
  audit: Audit;
  records: TransferRecord[];
}

/** Stage 1: declared budget, reserve funded at step 0 and inert, T1 steps with the audit checked at every census. */
export function runHistory(cand: Candidate, kind: "builder" | "nonbuilder", seed: number, p: Protocol = PROTOCOL): History {
  const state = startWorld(cand, kind, seed, p);
  const audit = openAudit(state);
  const records = [fundReserve(state, audit, p.reserve.B, p.reserve.E, outsideRegion(p))];
  const sim = new RefSim(state);
  for (let t = 1; t <= p.T1; t++) {
    sim.step();
    if (t % p.census === 0 || t === p.T1) assertAudit(sim.state, audit, `stage 1 step ${t}`);
  }
  return { state: sim.state, audit, records };
}

const sumChan = (s: WorldState, chs: readonly number[], idx: readonly number[]): number => {
  const n = cellCount(s.cfg);
  let t = 0;
  for (const ch of chs) for (const i of idx) t += s.cells[ch * n + i];
  return t;
};

/**
 * Receiver alone: the same total budget as uniform A and uniform E plus the reserve, nothing conditioned, at absolute step T1.
 * `dissipation` (conditioned arms: heatOut - lightIn of the history, the net energy the conditioning stage released) is booked as
 * named analytic heat and taken out of the uniform free E, so the comparator carries the same free-energy total as the conditioned
 * field instead of a richer, never-dissipated one. Fixtures that have no history leave it zero.
 */
export interface Budget {
  matterStart: bigint;
  energyStart: bigint;
}
export function receiverAlone(h: { audit: Budget; dissipation?: bigint }, seed: number, p: Protocol = PROTOCOL): PreArm {
  const cfg = worldConfig(seed, p);
  const s = allocState(cfg);
  const n = cellCount(cfg);
  const dissipation = h.dissipation ?? 0n;
  const a: Audit = { energyStart: h.audit.energyStart, matterStart: h.audit.matterStart, reserveB: p.reserve.B, reserveE: p.reserve.E, heatAnalytic: dissipation };
  if (a.energyStart - BigInt(cfg.eB) * BigInt(p.reserve.B) - BigInt(p.reserve.E) - dissipation < 0n) throw new NicheInvalid("receiver-alone: dissipation exceeds the free energy");
  const spread = (ch: number, total: bigint) => {
    const base = total / BigInt(n), rem = Number(total % BigInt(n));
    for (let i = 0; i < n; i++) s.cells[ch * n + i] = Number(base) + (i < rem ? 1 : 0);
  };
  spread(CH.A, a.matterStart - BigInt(p.reserve.B));
  spread(CH.E, a.energyStart - BigInt(cfg.eB) * BigInt(p.reserve.B) - BigInt(p.reserve.E) - dissipation);
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  s.step = p.T1;
  assertAudit(s, a, "receiver-alone start");
  return { id: "d0", state: s, audit: a, records: [] };
}

export interface BlockArms {
  arms: PreArm[];
  histories: { builder: History; nonbuilder: History };
  dE: number;
  dB: number;
}

/**
 * The "more stored energy / more bound matter explains it" controls: the receiver-alone world with the reserve raised by what the
 * conditioned arm `b` holds in the inoculum footprint plus halo beyond receiver-alone (taken from the lattice outside the region,
 * debits recorded, totals unchanged). d1E raises free energy, d1B raises bound matter with its (eB - eA) chemical-energy debit.
 */
export function matchedControls(b: PreArm, d0: PreArm, p: Protocol = PROTOCOL): { d1E: PreArm; d1B: PreArm; dE: number; dB: number } {
  const region = regionCells(p), outside = outsideRegion(p);
  const dE = Math.max(0, sumChan(b.state, [CH.E], region) - sumChan(d0.state, [CH.E], region));
  // Matched bound matter is B only: biomass, which a receiver can take over. (Summing A and C too would be vacuous: detritus that replaced nutrient on the same cells leaves the total unchanged. Adding P handed structural polymer to the receiver as living inoculum, so a pure polymer shield, 1200 P under the receiver, lost to the control by about 800 and the gate could never certify a structure; polymer is tested by the ablation and the scramble instead.)
  const dB = Math.max(0, sumChan(b.state, [CH.B], region) - sumChan(d0.state, [CH.B], region));
  const d1E: PreArm = { id: "d1E", state: cloneState(d0.state), audit: cloneAudit(d0.audit), records: [] };
  d1E.records.push(audited("matched-energy-debit", d1E.state, d1E.audit, () => (moveToReserve(d1E.state, d1E.audit, 0, dE, outside), { dE })));
  const d1B: PreArm = { id: "d1B", state: cloneState(d0.state), audit: cloneAudit(d0.audit), records: [] };
  d1B.records.push(audited("matched-matter-debit", d1B.state, d1B.audit, () => (moveToReserve(d1B.state, d1B.audit, dB, (d1B.state.cfg.eB - d1B.state.cfg.eA) * dB, outside), { dB })));
  return { d1E, d1B, dE, dB };
}

/** Build every pre-inoculum arm of one block (nothing placed yet). `replicates` adds the dev-only Stage-2 seed replicates. */
export function buildArms(cand: Candidate, seed: number, p: Protocol = PROTOCOL, replicateSeed?: number): BlockArms {
  const hb = runHistory(cand, "builder", seed, p);
  const hn = runHistory(cand, "nonbuilder", seed, p);
  if (hb.audit.energyStart !== hn.audit.energyStart || hb.audit.matterStart !== hn.audit.matterStart) throw new NicheInvalid("builder and nonbuilder histories start with different budgets");
  const arm = (id: ArmId, h: History, ...ops: ((s: WorldState, a: Audit) => TransferRecord)[]): PreArm => {
    const state = cloneState(h.state), audit = cloneAudit(h.audit);
    return { id, state, audit, records: [...h.records, ...ops.map((f) => f(state, audit))] };
  };
  const mix = lowbias32;
  const bRemoved = (s: WorldState, a: Audit) => relabelLiving(s, a);
  const scr = (chs: number[], op: string) => (s: WorldState, a: Audit) => scrambleChannels(s, a, seed, chs, mix, op);
  const ALL = [CH.A, CH.B, CH.C, CH.P, CH.E, CH.S];
  const arms: PreArm[] = [
    arm("a", hb),
    arm("b", hb, bRemoved),
    arm("c", hb, bRemoved, scr(ALL, "scramble")),
    arm("cP", hb, bRemoved, scr([CH.P], "scramble-P")),
    arm("cNP", hb, bRemoved, scr(ALL.filter((c) => c !== CH.P), "scramble-nonP")),
    arm("nb", hn, bRemoved),
    arm("ab", hb, bRemoved, convertPolymer),
  ];
  const d0 = receiverAlone({ audit: hb.audit, dissipation: hb.state.heatOut - hb.state.lightIn }, seed, p);
  const { d1E, d1B, dE, dB } = matchedControls(arms[1], d0, p);
  arms.push(d0, d1E, d1B);
  if (replicateSeed !== undefined) {
    const rep = (id: ArmId, src: PreArm): PreArm => ({ id, state: cloneState(src.state, { ...src.state.cfg, seed: replicateSeed }), audit: cloneAudit(src.audit), records: [...src.records] });
    arms.push(rep("rb", arms[1]), rep("rnb", arms[5]));
  }
  return { arms, histories: { builder: hb, nonbuilder: hn }, dE, dB };
}

/** Place the same inoculum on the same cells in every arm: the intersection of placeable footprint cells. Needs at least nMin. */
export function placeAll(arms: PreArm[], p: Protocol = PROTOCOL, opts: { allowP?: boolean; genome?: Genome } = {}): number[] {
  const cfg = arms[0].state.cfg;
  const maxE = Math.max(...arms.map((x) => x.audit.reserveE));
  const cells = commonCells(arms.map((x) => x.state), footprintCells(p), Math.ceil(maxE / p.nMin), opts.allowP ?? false);
  if (cells.length < p.nMin) throw new NicheInvalid(`only ${cells.length} common placeable cells (< ${p.nMin})`);
  const words = encodeGenome(opts.genome ?? receiverGenome(p), 0, packLineageLo(cfg, p.receiverRaw));
  for (const x of arms) x.records.push(placeInoculum(x.state, x.audit, cells, words, opts.allowP ?? false));
  return cells;
}

