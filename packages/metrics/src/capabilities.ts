// Capability arithmetic, the exact-ledger observer and the readouts of the
// discovery workbench's engineering assays
// (docs/evolvability-discovery-2026-10-04/DESIGN.md sections 1, 2 and 4).
//
// Nothing here steps a world: the observer is fed snapshots by the case runner
// (@bl/runner discovery.ts), and every readout is a pure function of the
// stored observation records, so the validator can re-derive it.
//
// The renewal assay is not implemented here. It belongs to the construction
// workstream (decision D2); the workbench consumes its observer through the
// same `CaseObserver` interface once Stage 1 delivers it. `maintainedSites`
// below is an exploratory secondary readout and never awards renewal.

import {
  CH,
  FLUX_NAMES,
  G,
  ROLE_WORDS,
  canonicalJSON,
  cellCount,
  stateHash,
  totalsOf,
  worldW,
  type CaseSpec,
  type EvidenceStatus,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";

export const EXACT_LEDGER_OBSERVER = "exact-ledger-v1";
export const ENGINEERING_READOUT = "engineering-readout-v1";

// ---------------------------------------------------------------------------
// Exact rule arithmetic (RESEARCH "Rule arithmetic")

/**
 * Bound matter leaving a cell with zero displacement in one step, for an
 * amount `q` at `spread` `s`: four cardinal and four diagonal integer shares,
 * `4·floor(64·s·q / (64+2s)²) + 4·floor(s²·q / (64+2s)²)`. This is the closed
 * form, written independently of the simulator; fixtures check it against
 * passive reference runs.
 */
export function transportOutflow(q: number, s: number): { cardinal: number; diagonal: number; total: number } {
  const d2 = (64 + 2 * s) ** 2;
  const cardinal = Math.floor((64 * s * q) / d2);
  const diagonal = Math.floor((s * s * q) / d2);
  return { cardinal, diagonal, total: 4 * cardinal + 4 * diagonal };
}

export interface TransportBands {
  spread: number;
  /** Large-amount share leaving per step, as an exact fraction. */
  shareNum: number;
  shareDen: number;
  /** Smallest amount that sends anything to a cardinal neighbour (null at spread 0). */
  firstCardinal: number | null;
  /** Largest amount that sends exactly one quantum to each cardinal neighbour. */
  oneQuantumUpTo: number | null;
  /** Smallest amount that sends anything diagonally. */
  firstDiagonal: number | null;
}

export function transportBands(s: number): TransportBands {
  const d2 = (64 + 2 * s) ** 2;
  if (s === 0) return { spread: 0, shareNum: 0, shareDen: 1, firstCardinal: null, oneQuantumUpTo: null, firstDiagonal: null };
  return {
    spread: s,
    shareNum: 4 * 64 * s + 4 * s * s,
    shareDen: d2,
    firstCardinal: Math.ceil(d2 / (64 * s)),
    oneQuantumUpTo: Math.ceil((2 * d2) / (64 * s)) - 1,
    firstDiagonal: Math.ceil(d2 / (s * s)),
  };
}

/**
 * Smallest summed polymer `P_s + P_t` on a pair of cells at which the gated
 * diffusion constant `floor(D·gateK / (gateK + P_s + P_t))` reaches zero.
 */
export function gateSealPolymer(D: number, gateK: number): number {
  return D === 0 ? 0 : gateK * (D - 1) + 1;
}

/**
 * Per-step role counters saturate at 65535. Every counted reaction moves at
 * most the matter present in one cell, so a world whose total matter is below
 * 65535 cannot saturate them: per-step counters are then exact.
 */
export function roleCountersExact(totalMatter: bigint): boolean {
  return totalMatter < 0xffffn;
}

/** A role word pair with a saturated half: the per-step value is a lower bound, not a measurement. */
export function roleWordSaturated(roles: Uint32Array, i: number): boolean {
  const a = roles[i * ROLE_WORDS];
  const b = roles[i * ROLE_WORDS + 1];
  return (a & 0xffff) === 0xffff || a >>> 16 === 0xffff || (b & 0xffff) === 0xffff || b >>> 16 === 0xffff;
}

// ---------------------------------------------------------------------------
// The exact-ledger observer

/** A read-only view of the world at a step boundary. The observer copies what it keeps; it never holds these buffers. */
export interface WorldView {
  state: WorldState;
  /** Last step's per-cell role counters (RefSim.roles), or null before any step. */
  roles: Uint32Array | null;
}

interface Tot {
  A: bigint;
  B: bigint;
  C: bigint;
  P: bigint;
  E: bigint;
  S: bigint;
  energy: bigint;
  matter: bigint;
}

const totals = (s: WorldState): Tot => totalsOf(s.cfg, s.cells);
const abs = (v: bigint) => (v < 0n ? -v : v);
const FX = Object.fromEntries(FLUX_NAMES.map((k, i) => [k, i])) as Record<(typeof FLUX_NAMES)[number], number>;

export interface SiteRecord {
  x: number;
  y: number;
  B: number;
  P: number;
  E: number;
  /** Integrated local synthesis Σ(PHOTO+GROW) at this cell since the start, exact only when `rolesExact`. */
  Q: string;
}

export interface CensusRecord {
  kind: "census";
  step: number;
  totals: { A: string; B: string; C: string; P: string; E: string; S: string; matter: string; energy: string };
  flux: string[];
  lightIn: string;
  heatOut: string;
  livingCells: number;
  occupiedB: number;
  occupiedBP: number;
  stateHash: string;
  sites: SiteRecord[];
}

export interface FinalRecord {
  kind: "final";
  step: number;
  matterResidualMax: string;
  energyResidualMax: string;
  fluxIdentityViolations: number;
  rolesExact: boolean;
  /** Each site's B, P and E after the first observed step (passive transport fixtures). */
  firstStep: { x: number; y: number; B: number; P: number; E: number }[];
  /** Initial B, P and E at each site. */
  initial: { x: number; y: number; B: number; P: number; E: number }[];
  extinctAtCensus: number | null;
  /** Census-checkpoint assay only: the in-process continuous reference and the segmented history. */
  continuity: { continuousEndStateHash: string; segmentedEndStateHash: string; continuousObserverDigest: string; segmentedObserverDigest: string } | null;
}

export type ObservationRecord = CensusRecord | FinalRecord;

/** Serializable observer state, carried in checkpoints so a segmented history continues exactly. */
export interface ExactLedgerState {
  version: typeof EXACT_LEDGER_OBSERVER;
  start: Record<keyof Tot, string>;
  startLight: string;
  startHeat: string;
  prev: Record<keyof Tot, string>;
  prevFlux: string[];
  matterResidualMax: string;
  energyResidualMax: string;
  fluxIdentityViolations: number;
  rolesExact: boolean;
  sites: { x: number; y: number }[];
  siteQ: string[];
  initial: { x: number; y: number; B: number; P: number; E: number }[];
  firstStep: { x: number; y: number; B: number; P: number; E: number }[] | null;
  extinctAtCensus: number | null;
}

const totStr = (t: Tot) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toString()])) as Record<keyof Tot, string>;
const totBig = (t: Record<keyof Tot, string>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, BigInt(v)])) as unknown as Tot;

function siteIndex(cfg: WorldConfig, x: number, y: number): number {
  const W = worldW(cfg);
  const n = cellCount(cfg);
  const i = y * W + x;
  if (x < 0 || y < 0 || x >= W || i >= n) throw new Error(`site (${x}, ${y}) lies outside the world`);
  return i;
}

function siteCells(s: WorldState, sites: { x: number; y: number }[]) {
  const n = cellCount(s.cfg);
  return sites.map(({ x, y }) => {
    const i = siteIndex(s.cfg, x, y);
    return { x, y, B: s.cells[CH.B * n + i], P: s.cells[CH.P * n + i], E: s.cells[CH.E * n + i] };
  });
}

/**
 * Per-step exact checks (matter, the energy ledger, and the flux identities
 * of every channel) and per-census records. Totals are recomputed from the
 * state each step, so nothing depends on buffers the simulator reuses.
 */
export class ExactLedgerObserver {
  private st: ExactLedgerState;

  private constructor(st: ExactLedgerState) {
    this.st = st;
  }

  static start(s: WorldState, sites: { x: number; y: number }[]): ExactLedgerObserver {
    const t = totals(s);
    return new ExactLedgerObserver({
      version: EXACT_LEDGER_OBSERVER,
      start: totStr(t),
      startLight: s.lightIn.toString(),
      startHeat: s.heatOut.toString(),
      prev: totStr(t),
      prevFlux: s.flux.map((f) => f.toString()),
      matterResidualMax: "0",
      energyResidualMax: "0",
      fluxIdentityViolations: 0,
      // Any per-step value below 65535 is exact (the counters clamp); a clamped one at a site marks the measurement unsupported.
      rolesExact: true,
      sites: sites.map(({ x, y }) => ({ x, y })),
      siteQ: sites.map(() => "0"),
      initial: siteCells(s, sites),
      firstStep: null,
      extinctAtCensus: null,
    });
  }

  static restore(json: unknown): ExactLedgerObserver {
    const o = json as ExactLedgerState;
    if (!o || o.version !== EXACT_LEDGER_OBSERVER) throw new Error(`observer: expected ${EXACT_LEDGER_OBSERVER}`);
    // Round-trip through canonical JSON: rejects anything that is not plain data.
    return new ExactLedgerObserver(JSON.parse(canonicalJSON(o)) as ExactLedgerState);
  }

  toJSON(): ExactLedgerState {
    return JSON.parse(canonicalJSON(this.st)) as ExactLedgerState;
  }

  /** Call after every `RefSim.step()`, with that step's role counters. */
  afterStep(v: WorldView): void {
    const s = v.state;
    const st = this.st;
    const t = totals(s);
    const start = totBig(st.start);
    const prev = totBig(st.prev);
    const mres = abs(t.matter - start.matter);
    if (mres > BigInt(st.matterResidualMax)) st.matterResidualMax = mres.toString();
    const eres = abs(t.energy + (s.heatOut - BigInt(st.startHeat)) - (start.energy + (s.lightIn - BigInt(st.startLight))));
    if (eres > BigInt(st.energyResidualMax)) st.energyResidualMax = eres.toString();
    const d = s.flux.map((f, k) => f - BigInt(st.prevFlux[k]));
    const f = (k: keyof typeof FX) => d[FX[k]];
    const ok =
      t.A - prev.A === f("decomp") + f("abio") - f("photo") - f("grow") &&
      t.B - prev.B === f("photo") + f("grow") - f("resp") - f("build") - f("starve") - f("bdecay") &&
      t.C - prev.C === f("resp") + f("starve") + f("bdecay") + f("pdecay") - f("decomp") - f("abio") &&
      t.P - prev.P === f("build") - f("pdecay");
    if (!ok) st.fluxIdentityViolations++;
    st.prev = totStr(t);
    st.prevFlux = s.flux.map((x) => x.toString());
    if (v.roles) {
      st.sites.forEach(({ x, y }, k) => {
        const i = siteIndex(s.cfg, x, y);
        const a = v.roles![i * ROLE_WORDS];
        if (roleWordSaturated(v.roles!, i)) st.rolesExact = false;
        st.siteQ[k] = (BigInt(st.siteQ[k]) + BigInt((a & 0xffff) + (a >>> 16))).toString();
      });
    }
    if (st.firstStep === null) st.firstStep = siteCells(s, st.sites);
  }

  census(s: WorldState): CensusRecord {
    const n = cellCount(s.cfg);
    const t = totals(s);
    let living = 0;
    let occB = 0;
    let occBP = 0;
    for (let i = 0; i < n; i++) {
      const B = s.cells[CH.B * n + i];
      const P = s.cells[CH.P * n + i];
      if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) living++;
      if (B > 0) occB++;
      if (B + P > 0) occBP++;
    }
    const sites = siteCells(s, this.st.sites).map((c, k) => ({ ...c, Q: this.st.siteQ[k] }));
    return {
      kind: "census",
      step: s.step,
      totals: { A: t.A.toString(), B: t.B.toString(), C: t.C.toString(), P: t.P.toString(), E: t.E.toString(), S: t.S.toString(), matter: t.matter.toString(), energy: t.energy.toString() },
      flux: s.flux.map((f) => f.toString()),
      lightIn: s.lightIn.toString(),
      heatOut: s.heatOut.toString(),
      livingCells: living,
      occupiedB: occB,
      occupiedBP: occBP,
      stateHash: stateHash(s),
      sites,
    };
  }

  /** Records the first census at which no living cell remains. */
  noteCensus(rec: CensusRecord): void {
    if (rec.livingCells === 0 && this.st.extinctAtCensus === null) this.st.extinctAtCensus = rec.step;
  }

  final(s: WorldState, continuity: FinalRecord["continuity"]): FinalRecord {
    const st = this.st;
    return {
      kind: "final",
      step: s.step,
      matterResidualMax: st.matterResidualMax,
      energyResidualMax: st.energyResidualMax,
      fluxIdentityViolations: st.fluxIdentityViolations,
      rolesExact: st.rolesExact,
      firstStep: st.firstStep ?? siteCells(s, st.sites),
      initial: st.initial,
      extinctAtCensus: st.extinctAtCensus,
      continuity,
    };
  }
}

// ---------------------------------------------------------------------------
// Readouts (pure functions of the stored observations)

export interface MaintainedSite {
  x: number;
  y: number;
  /** B ≥ threshold at every census in the window. */
  sustained: boolean;
  /** Integrated local synthesis over the window. */
  synthesis: string;
  /** Sustained and locally synthesizing at least `threshold` over the window. */
  maintained: boolean;
}

/**
 * Exploratory maintained-site readout (DESIGN 2, secondary readouts): a fixed
 * site counts only if its B stays at or above `threshold` at every census in
 * `[fromStep, toStep]` and its own integrated synthesis over that window is at
 * least `threshold`. A passive deposit fails the second test; an active patch
 * that moves away from a fixed site fails the first. Returns
 * "unsupported-measurement" when the per-step counters could have saturated.
 * It never awards renewal: that is the construction workstream's observer.
 */
export function maintainedSites(
  records: ObservationRecord[],
  fromStep: number,
  toStep: number,
  threshold: number,
): { status: "measured"; sites: MaintainedSite[] } | { status: "unsupported-measurement"; reason: string } {
  const fin = records.find((r): r is FinalRecord => r.kind === "final");
  if (!fin) return { status: "unsupported-measurement", reason: "no final record" };
  if (!fin.rolesExact) return { status: "unsupported-measurement", reason: "per-step role counters can saturate in this world" };
  const window = records.filter((r): r is CensusRecord => r.kind === "census" && r.step >= fromStep && r.step <= toStep);
  if (window.length < 2) return { status: "unsupported-measurement", reason: "fewer than two censuses in the window" };
  const first = window[0];
  const last = window[window.length - 1];
  const sites = first.sites.map((s0, k) => {
    const sustained = window.every((r) => r.sites[k].B >= threshold);
    const synthesis = BigInt(last.sites[k].Q) - BigInt(s0.Q);
    return { x: s0.x, y: s0.y, sustained, synthesis: synthesis.toString(), maintained: sustained && synthesis >= BigInt(threshold) };
  });
  return { status: "measured", sites };
}

export interface EngineeringReadout {
  readoutVersion: typeof ENGINEERING_READOUT;
  fixtureId: string;
  assayId: string;
  status: EvidenceStatus;
  /** The fixture's expectation, from the CPU reference's rules. */
  expectation: string;
  met: boolean;
  invariantsPassed: boolean;
  extinct: boolean;
  details: Record<string, unknown>;
}

/** Re-derivable readout of one engineering case, from its spec and observation records only. */
export function engineeringReadout(spec: CaseSpec, records: ObservationRecord[]): EngineeringReadout {
  const fin = records.find((r): r is FinalRecord => r.kind === "final");
  const censuses = records.filter((r): r is CensusRecord => r.kind === "census");
  const base = { readoutVersion: ENGINEERING_READOUT, fixtureId: spec.fixtureId, assayId: spec.assayId } as const;
  if (!fin || censuses.length === 0 || fin.step !== spec.steps || censuses[censuses.length - 1].step !== spec.steps)
    return { ...base, status: "invalid-or-incomplete", expectation: "a complete history", met: false, invariantsPassed: false, extinct: false, details: { reason: "missing final record or census" } };
  const invariantsPassed = fin.matterResidualMax === "0" && fin.energyResidualMax === "0" && fin.fluxIdentityViolations === 0;
  const extinct = censuses[censuses.length - 1].livingCells === 0;
  const verdict = (expectation: string, met: boolean, details: Record<string, unknown>): EngineeringReadout => ({
    ...base,
    status: !invariantsPassed ? "invalid-or-incomplete" : met ? "supported" : "unsupported-within-tested-domain",
    expectation,
    met: invariantsPassed && met,
    invariantsPassed,
    extinct,
    details,
  });
  switch (spec.assayId) {
    case "passive-transport": {
      const s = spec.resolvedWorldConfig.spread;
      const rows = fin.initial.map((i0, k) => {
        const f1 = fin.firstStep[k];
        const pred = { B: transportOutflow(i0.B, s).total, P: transportOutflow(i0.P, s).total, E: transportOutflow(i0.E, s).total };
        const obs = { B: i0.B - f1.B, P: i0.P - f1.P, E: i0.E - f1.E };
        return { x: i0.x, y: i0.y, q: { B: i0.B, P: i0.P, E: i0.E }, predicted: pred, observed: obs, equal: pred.B === obs.B && pred.P === obs.P && pred.E === obs.E };
      });
      return verdict(`one-step outflow of every deposit equals the closed form at spread ${s}`, rows.every((r) => r.equal), { spread: s, bands: transportBands(s), deposits: rows });
    }
    case "reacting-ledger":
      return verdict("exact matter, energy and flux ledgers; population alive at the end", !extinct, {
        finalLiving: censuses[censuses.length - 1].livingCells,
        flux: censuses[censuses.length - 1].flux,
      });
    case "extinction":
      return verdict("every living cell is gone by the last census", extinct, { extinctAtCensus: fin.extinctAtCensus });
    case "census-checkpoint": {
      const c = fin.continuity;
      const met = !!c && c.continuousEndStateHash === c.segmentedEndStateHash && c.continuousObserverDigest === c.segmentedObserverDigest && c.segmentedEndStateHash === censuses[censuses.length - 1].stateHash;
      const v = verdict("a history segmented through checkpoints equals the continuous one, state and observers", met, { continuity: c, segmentAt: spec.observationSchedule.segmentAt });
      // A continuity failure is a technical defect of the checkpoint path, never a scientific negative.
      return met ? v : { ...v, status: "invalid-or-incomplete", met: false };
    }
    default:
      return { ...base, status: "unsupported-measurement", expectation: "none: unknown assay", met: false, invariantsPassed, extinct, details: {} };
  }
}
