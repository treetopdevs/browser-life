// Stage 2 and the readouts. Observers are read-only: they look at sim.state and sim.roles after each step and never write.
import { CH, G, cellCount, packLineageLo, stateHash, totalsOf, validateState, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { buildArms, placeAll, type ArmId, type BlockArms, type PreArm } from "./arms.ts";
import { PROTOCOL, candidateOf, type Protocol } from "./protocol.ts";
import { NicheInvalid, assertAudit, snap, type Snap, type TransferRecord } from "./transfer.ts";

export interface ArmOutcome {
  id: ArmId;
  /** Receiver-labelled biomass inventory B at the start of Stage 2 and at each census (last entry is T2). */
  receiverB: number[];
  /** Receiver-labelled B at T2: the primary endpoint Y. */
  y: number;
  survived: boolean;
  builderB: number;
  /** Receiver-cell PHOTO + GROW quanta summed over every Stage 2 step (synthesis), and DECOMP, RESP. null = unavailable: the co-culture arm (a) has no accurate producing-cell ownership (reactions are counted after the step, and injury can clear a lineage after it reacted), so it is never attributed. */
  synthesis: number | null;
  decomp: number | null;
  resp: number | null;
  /** A role counter reached its saturation value at some step: flux attribution is unavailable. */
  saturated: boolean;
  /** Y - B_r gain is at least half synthesis: "growth" may be said. Otherwise "inventory benefit, growth not attributed". */
  growthAttributed: boolean;
  energyEnd: string;
  endHash: string;
}

export interface Hooks {
  /** Called after each step with the state and the roles buffer (read only). */
  onStep?: (state: WorldState, roles: Uint32Array, step: number) => void;
}

const lin = (s: WorldState, raw: number) => packLineageLo(s.cfg, raw);

function receiverB(s: WorldState, raw: number): number {
  const n = cellCount(s.cfg);
  const lo = lin(s, raw);
  let t = 0;
  for (let i = 0; i < n; i++) if (s.genome[G.LIN_HI * n + i] === 0 && s.genome[G.LIN_LO * n + i] === lo) t += s.cells[CH.B * n + i];
  return t;
}

/** Run Stage 2 on a placed arm for T2 steps; throws NicheInvalid on any residual. */
export function runArm(x: PreArm, p: Protocol = PROTOCOL, hooks: Hooks = {}): ArmOutcome {
  const sim = new RefSim(x.state);
  const n = cellCount(x.state.cfg);
  const blo = lin(x.state, p.builderRaw);
  const y0 = receiverB(sim.state, p.receiverRaw);
  const series = [y0];
  let synthesis = 0, decomp = 0, resp = 0, saturated = false;
  for (let t = 1; t <= p.T2; t++) {
    sim.step();
    const s = sim.state, roles = sim.roles;
    for (let i = 0; i < n; i++) {
      const w0 = roles[2 * i], w1 = roles[2 * i + 1];
      if ((w0 & 0xffff) >= p.roleSaturation || w0 >>> 16 >= p.roleSaturation || (w1 & 0xffff) >= p.roleSaturation || w1 >>> 16 >= p.roleSaturation) saturated = true;
      // Roles are counted on every cell where the builder was removed (only receivers react there; injury may clear a lineage after it synthesized). The co-culture arm would need pre-reaction producing-cell ownership, which is not observed, so it is reported unavailable.
      if (x.id !== "a") {
        synthesis += (w0 & 0xffff) + (w0 >>> 16);
        decomp += w1 & 0xffff;
        resp += w1 >>> 16;
      }
    }
    hooks.onStep?.(s, roles, s.step);
    if (t % p.census === 0 || t === p.T2) {
      assertAudit(s, x.audit, `stage 2 ${x.id} step ${t}`);
      series.push(receiverB(s, p.receiverRaw));
    }
  }
  const s = sim.state;
  const errs = validateState(s);
  if (errs.length) throw new NicheInvalid(`stage 2 ${x.id}: ${errs[0]}`);
  let builderB = 0;
  for (let i = 0; i < n; i++) if (s.genome[G.LIN_HI * n + i] === 0 && s.genome[G.LIN_LO * n + i] === blo) builderB += s.cells[CH.B * n + i];
  const y = series[series.length - 1];
  const gain = y - y0;
  return {
    id: x.id,
    receiverB: series,
    y,
    survived: y > 0,
    builderB,
    synthesis: x.id === "a" ? null : synthesis,
    decomp: x.id === "a" ? null : decomp,
    resp: x.id === "a" ? null : resp,
    saturated,
    growthAttributed: x.id !== "a" && !saturated && gain > 0 && 2 * synthesis >= gain,
    energyEnd: `${totalsOf(s.cfg, s.cells).energy}`,
    endHash: stateHash(s),
  };
}

export interface HistoryCost {
  kind: "builder" | "nonbuilder";
  B: string;
  P: string;
  E: string;
  A: string;
  C: string;
  lightIn: string;
  heatOut: string;
  builderLineageB: number;
  living: number;
  /** kGene maintenance is not separable from catalytic and ordinary maintenance in react(); stated, not inferred. */
  kGeneMaintenance: "unavailable";
}

export function historyCost(kind: "builder" | "nonbuilder", s: WorldState, p: Protocol): HistoryCost {
  const t = totalsOf(s.cfg, s.cells);
  const n = cellCount(s.cfg);
  let b = 0, living = 0;
  for (let i = 0; i < n; i++) {
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if ((hi | lo) !== 0) living++;
    if (hi === 0 && lo === lin(s, p.builderRaw)) b += s.cells[CH.B * n + i];
  }
  return { kind, B: `${t.B}`, P: `${t.P}`, E: `${t.E}`, A: `${t.A}`, C: `${t.C}`, lightIn: `${s.lightIn}`, heatOut: `${s.heatOut}`, builderLineageB: b, living, kGeneMaintenance: "unavailable" };
}

export interface BlockResult {
  seed: number;
  cluster: number;
  valid: boolean;
  invalidReason: string | null;
  nPlaced: number;
  dE: number;
  dB: number;
  costs: HistoryCost[];
  startTotals: Record<string, Snap>;
  transfers: Record<string, TransferRecord[]>;
  outcomes: Partial<Record<ArmId, ArmOutcome>>;
  /** Integer contrasts (null when invalid). */
  contrasts: Contrasts | null;
}

export interface Contrasts {
  builder: number;
  poly: number;
  space: number;
  inoc: number;
  spaceP: number;
  spaceNP: number;
  naive: number;
  /** Stage-2 replicate differences (dev only). */
  replicateBuilder: number | null;
  replicateNonbuilder: number | null;
}

export function contrastsOf(o: Partial<Record<ArmId, ArmOutcome>>): Contrasts {
  const y = (id: ArmId): number => {
    const v = o[id];
    if (!v) throw new NicheInvalid(`arm ${id} missing`);
    return v.y;
  };
  const yb = y("b");
  return {
    builder: yb - y("nb"),
    poly: yb - y("ab"),
    space: yb - y("c"),
    inoc: yb - Math.max(y("d1E"), y("d1B")),
    spaceP: yb - y("cP"),
    spaceNP: yb - y("cNP"),
    naive: yb - y("d0"),
    replicateBuilder: o.rb ? yb - o.rb.y : null,
    replicateNonbuilder: o.rnb ? y("nb") - o.rnb.y : null,
  };
}

/** One block: Stage 1 histories, transfers, shared placement, all Stage 2 arms. An invalid block is reported, never dropped. */
export function runBlock(cluster: number, seed: number, p: Protocol = PROTOCOL, replicateSeed?: number, hooks: Hooks = {}): BlockResult {
  const base: BlockResult = { seed, cluster, valid: false, invalidReason: null, nPlaced: 0, dE: 0, dB: 0, costs: [], startTotals: {}, transfers: {}, outcomes: {}, contrasts: null };
  let built: BlockArms | null = null;
  try {
    built = buildArms(candidateOf(cluster, p), seed, p, replicateSeed);
    base.dE = built.dE;
    base.dB = built.dB;
    base.costs = [historyCost("builder", built.histories.builder.state, p), historyCost("nonbuilder", built.histories.nonbuilder.state, p)];
    base.nPlaced = placeAll(built.arms, p).length;
    for (const x of built.arms) {
      base.startTotals[x.id] = snap(x.state, x.audit);
      base.transfers[x.id] = x.records;
    }
    for (const x of built.arms) base.outcomes[x.id] = runArm(x, p, hooks);
    base.contrasts = contrastsOf(base.outcomes);
    base.valid = true;
  } catch (e) {
    if (!(e instanceof NicheInvalid)) throw e;
    base.invalidReason = e.reason;
    if (built) for (const x of built.arms) base.transfers[x.id] ??= x.records;
  }
  return base;
}

