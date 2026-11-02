// Fixtures: the negative case that fools the naive metric (energy-gift), the positive control (hand-wall), the relabelling trap
// (takeover-only), a null field, and the guard checks. Unit-scale fixtures use 16x16 worlds with kernelRadius 5 (schema validation
// needs dimensions divisible by eight and 2*kernelRadius+1 <= tile); the positive control is also qualified at the frozen scale.
import { CH, cellCount, encodeGenome, founderGenome, lowbias32, packLineageLo, type Genome, type WorldState } from "@bl/schema";
import { disc, footprintCells, matchedControls, outsideRegion, placeAll, receiverAlone, regionCells, startWorld, type ArmId, type Budget, type PreArm } from "./arms.ts";
import { contrastsOf, runArm, type ArmOutcome, type Contrasts } from "./assay.ts";
import { decideCandidates, medianTimes2, type CandidateResult } from "./decision.ts";
import { PROTOCOL, candidateOf, founderOf, type Protocol } from "./protocol.ts";
import { NicheInvalid, audited, cloneAudit, cloneState, convertPolymer, debitEven, openAudit, placeInoculum, scrambleChannels, type Audit } from "./transfer.ts";

export const FIXTURE_SEEDS: readonly number[] = [8_600_401, 8_600_402, 8_600_403, 8_600_404, 8_600_405, 8_600_406, 8_600_407, 8_600_408];

export function fixtureProtocol(): Protocol {
  return { ...PROTOCOL, grid: 16, T1: 0, T2: 40, injury: null, footprint: { x: 8, y: 8, radius: 2 }, halo: 2, nMin: 8, reserve: { B: 480, E: 24 }, nutrient: 100 };
}

/** Uniform-A / uniform-E budget of a w x w lattice with the reserve inside it (no founders). */
export const uniformBudget = (p: Protocol): Budget => {
  const n = p.grid * p.grid;
  return { matterStart: BigInt(p.nutrient * n), energyStart: BigInt(p.backgroundE * n + 10 * p.reserve.B + p.reserve.E) };
};

const setChannel = (s: WorldState, ch: number, cells: readonly number[], total: number): void => {
  const n = cellCount(s.cfg), m = cells.length, base = Math.floor(total / m), rem = total % m;
  cells.forEach((i, j) => (s.cells[ch * n + i] += base + (j < rem ? 1 : 0)));
};

/** Run all pre-inoculum arms of a fixture block through the shared placement and Stage 2. */
export function runPre(arms: PreArm[], p: Protocol, opts: { allowP?: boolean; genome?: Genome } = {}): Partial<Record<ArmId, ArmOutcome>> {
  placeAll(arms, p, opts);
  const out: Partial<Record<ArmId, ArmOutcome>> = {};
  for (const x of arms) out[x.id] = runArm(x, p);
  return out;
}

/** Controls around a conditioned pre-arm `b` (any hand-built field): scrambles, ablation, receiver-alone and matched-inventory. */
export function controlsAround(b: PreArm, d0: PreArm, seed: number, p: Protocol): PreArm[] {
  const mk = (id: ArmId, ...ops: ((s: WorldState, a: Audit) => unknown)[]): PreArm => {
    const state = cloneState(b.state), audit = cloneAudit(b.audit);
    ops.forEach((f) => f(state, audit));
    return { id, state, audit, records: [] };
  };
  const ALL = [CH.A, CH.B, CH.C, CH.P, CH.E, CH.S];
  const sc = (chs: number[]) => (s: WorldState, a: Audit) => scrambleChannels(s, a, seed, chs, lowbias32);
  const { d1E, d1B } = matchedControls(b, d0, p);
  const nb = { id: "nb" as ArmId, state: cloneState(d0.state), audit: cloneAudit(d0.audit), records: [] };
  return [
    { ...b, id: "b" },
    mk("c", sc(ALL)),
    mk("cP", sc([CH.P])),
    mk("cNP", sc(ALL.filter((c) => c !== CH.P))),
    mk("ab", (s, a) => convertPolymer(s, a)),
    nb,
    d0,
    d1E,
    d1B,
  ];
}

/** Halo ring cells: in the footprint-plus-halo region but not in the footprint. */
export const regionCellsExcludingFootprint = (p: Protocol): number[] => {
  const fp = new Set(footprintCells(p));
  return regionCells(p).filter((i) => !fp.has(i));
};

// ---------------------------------------------------------------------------
// energy-gift

export type GiftVariant = "uniform" | "footprint" | "annulus";
/** Extra stored free energy per variant, sized so the naive metric clears the fixture delta in each. */
export const GIFT: Record<GiftVariant, number> = { uniform: 10000, footprint: 4000, annulus: 4000 };

/** A world that differs from receiver-alone only by extra stored free energy, declared in its budget (it is a different budget on purpose). */
export function giftBlock(variant: GiftVariant, seed: number, p: Protocol = fixtureProtocol(), gift = GIFT[variant]): { outcomes: Partial<Record<ArmId, ArmOutcome>>; contrasts: Contrasts; gift: number } {
  const cfgSeed = seed;
  const budget = uniformBudget(p);
  const base = receiverAlone({ audit: budget }, cfgSeed, p);
  const cond: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  const W = p.grid;
  const cells = variant === "uniform" ? Array.from({ length: W * W }, (_, i) => i) : variant === "footprint" ? footprintCells(p) : regionCellsExcludingFootprint(p);
  setChannel(cond.state, CH.E, cells, gift);
  cond.audit.energyStart += BigInt(gift);
  const arms = controlsAround(cond, base, seed, p);
  const outcomes = runPre(arms, p);
  return { outcomes, contrasts: contrastsOf(outcomes), gift };
}

// ---------------------------------------------------------------------------
// hand-wall

export type WallKind = "W1" | "W2";

/** W1: a polymer ring around the footprint (gates A/C diffusion). W2: a polymer floor under the footprint cells (a local-P shield under injuryShell). */
export function wallCells(kind: WallKind, p: Protocol): number[] {
  const f = p.footprint;
  if (kind === "W2") return footprintCells(p);
  const inner = new Set(disc(f.x, f.y, f.radius + p.wall.ringGap - 1, p.grid, p.grid));
  return disc(f.x, f.y, f.radius + p.wall.ringGap + 1, p.grid, p.grid).filter((i) => !inner.has(i));
}

/** Build P on `cells` out of lattice nutrient on the same cells and pay (eP - eA) * P from lattice E outside the region. */
export function buildWall(x: PreArm, cells: readonly number[], totalP: number, p: Protocol): void {
  audited("build-wall", x.state, x.audit, () => {
    const s = x.state;
    debitEven(s, CH.A, totalP, cells);
    setChannel(s, CH.P, cells, totalP);
    debitEven(s, CH.E, (s.cfg.eP - s.cfg.eA) * totalP, outsideRegion(p));
    return { totalP, cells: cells.length };
  });
}

/** One hand-wall block: the wall against the same P inventory scrambled. D = Y(wall) - Y(P scrambled). */
export function wallBlock(kind: WallKind, seed: number, p: Protocol = PROTOCOL, budget?: Budget): { d: number; wall: ArmOutcome; scrambled: ArmOutcome } {
  const bud = budget ?? nominalBudget(seed, p);
  const base = receiverAlone({ audit: bud }, seed, p);
  const wall: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  buildWall(wall, wallCells(kind, p), p.wall.totalP, p);
  const scr: PreArm = { id: "cP", state: cloneState(wall.state), audit: cloneAudit(wall.audit), records: [] };
  scrambleChannels(scr.state, scr.audit, seed, [CH.P], lowbias32, "scramble-P");
  const out = runPre([wall, scr], p, { allowP: true });
  return { d: out.b!.y - out.cP!.y, wall: out.b!, scrambled: out.cP! };
}

/**
 * The wall field pushed through every arm and all four gating contrasts, the way a conditioned field would be. The "nonbuilder"
 * is the receiver alone (there is no history). Placement allows polymer under the receiver (allowP): that is outside the real
 * placement rule, so this shows what the gate returns for a hand-built structure, not for a builder's field.
 */
export function wallGateBlock(kind: WallKind, seed: number, p: Protocol = PROTOCOL): { outcomes: Partial<Record<ArmId, ArmOutcome>>; contrasts: Contrasts } {
  const base = receiverAlone({ audit: nominalBudget(seed, p) }, seed, p);
  const wall: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  buildWall(wall, wallCells(kind, p), p.wall.totalP, p);
  const outcomes = runPre(controlsAround(wall, base, seed, p), p, { allowP: true });
  return { outcomes, contrasts: contrastsOf(outcomes) };
}

/** The declared initial budget of a real block at this seed (founders included), without running anything. */
export function nominalBudget(seed: number, p: Protocol = PROTOCOL): Budget {
  const a = openAudit(startWorld(candidateOf(p.panel[0], p), "builder", seed, p));
  return { matterStart: a.matterStart, energyStart: a.energyStart };
}

// ---------------------------------------------------------------------------
// takeover-only

/** A receiver that cannot synthesize anything: zero controller weights, no gene bits. */
export const inertReceiver = (p: Protocol = PROTOCOL): Genome => ({ ...founderGenome(founderOf(p.receiverCluster)), weights: new Int8Array(160), genes: 0 });

/** Non-living detritus B on the halo ring next to the footprint (funded from A there and from E elsewhere); an inert receiver is placed. */
export function takeoverBlock(seed: number, p: Protocol = fixtureProtocol(), detritus = 200): { outcomes: Partial<Record<ArmId, ArmOutcome>>; contrasts: Contrasts } {
  const base = receiverAlone({ audit: uniformBudget(p) }, seed, p);
  const cond: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  const ring = regionCellsExcludingFootprint(p);
  audited("detritus", cond.state, cond.audit, () => {
    const s = cond.state;
    debitEven(s, CH.A, detritus, ring);
    setChannel(s, CH.B, ring, detritus);
    debitEven(s, CH.E, (s.cfg.eB - s.cfg.eA) * detritus, outsideRegion(p));
    return { detritus };
  });
  const outcomes = runPre(controlsAround(cond, base, seed, p), p, { genome: inertReceiver(p) });
  return { outcomes, contrasts: contrastsOf(outcomes) };
}

// ---------------------------------------------------------------------------
// null field and guards

export function nullBlock(seed: number, p: Protocol = fixtureProtocol()): { outcomes: Partial<Record<ArmId, ArmOutcome>>; contrasts: Contrasts } {
  const base = receiverAlone({ audit: uniformBudget(p) }, seed, p);
  const cond: PreArm = { id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] };
  const outcomes = runPre(controlsAround(cond, base, seed, p), p);
  return { outcomes, contrasts: contrastsOf(outcomes) };
}

export interface GuardResult {
  id: string;
  ok: boolean;
  detail: string;
}

/** Guards that must refuse or flag: each returns ok when the bad input was refused as designed. */
export function runGuards(): GuardResult[] {
  const p = fixtureProtocol();
  const out: GuardResult[] = [];
  const attempt = (id: string, fn: () => void, want: RegExp): void => {
    try {
      fn();
      out.push({ id, ok: false, detail: "no refusal" });
    } catch (e) {
      const ok = e instanceof NicheInvalid && want.test(e.reason);
      out.push({ id, ok, detail: e instanceof NicheInvalid ? e.reason : String(e) });
    }
  };
  const fresh = () => receiverAlone({ audit: uniformBudget(p) }, 1, p);
  const words = encodeGenome(founderGenome(founderOf(p.receiverCluster)), 0, packLineageLo(fresh().state.cfg, p.receiverRaw));
  attempt("overwrite-attempt", () => {
    const x = fresh();
    x.state.cells[CH.B * cellCount(x.state.cfg) + footprintCells(p)[0]] = 5;
    x.audit.energyStart += 50n;
    x.audit.matterStart += 5n;
    placeInoculum(x.state, x.audit, footprintCells(p), words);
  }, /refused/);
  attempt("pool-cap", () => {
    const x = fresh();
    const i = footprintCells(p)[0];
    const old = x.state.cells[CH.E * cellCount(x.state.cfg) + i];
    x.state.cells[CH.E * cellCount(x.state.cfg) + i] = 2 ** 28 - 1;
    x.audit.energyStart += BigInt(2 ** 28 - 1 - old);
    placeInoculum(x.state, x.audit, footprintCells(p), words);
  }, /refused/);
  attempt("underfunded-reserve", () => {
    const x = fresh();
    debitEven(x.state, CH.A, 10 ** 9, [0]);
  }, /underfunded/);
  attempt("empty-receiver-reserve", () => {
    const x = fresh();
    placeInoculum(x.state, x.audit, footprintCells(p), words);
    // A second spend of the spent reserve on disjoint, still-empty cells must be refused as an exhausted reserve (not as occupied cells).
    placeInoculum(x.state, x.audit, regionCellsExcludingFootprint(p), words);
  }, /exhausted/);
  return out;
}

// ---------------------------------------------------------------------------
// fixture decisions

export interface FixtureReport {
  id: string;
  seeds: readonly number[];
  contrasts: Contrasts[];
  naiveK: number;
  naiveWouldSay: "benefit" | "no benefit";
  /** "caught" only when the naive metric says benefit, the label is not supported, and at least one of the two matched controls (space, inoc) itself fails its gating test. */
  matchedControls: "caught" | "not caught" | "n/a";
  /** Which gating contrasts among space and inoc did not pass: the controls that actually did the catching. */
  caughtBy: ("space" | "inoc")[];
  /** Per gating contrast: blocks strictly positive out of the total. */
  gatingK: Record<string, number>;
  label: CandidateResult["label"];
  growthAttributed: boolean[];
  synthesis: number[];
}

const col = (cs: Contrasts[], k: keyof Contrasts): number[] => cs.map((c) => c[k] as number);

export function decideFixture(id: string, seeds: readonly number[], results: { outcomes: Partial<Record<ArmId, ArmOutcome>>; contrasts: Contrasts }[], delta: number): FixtureReport {
  const cs = results.map((r) => r.contrasts);
  const dec = decideCandidates(
    [
      {
        id,
        status: "ok",
        invalidReasons: [],
        contrasts: { builder: col(cs, "builder"), poly: col(cs, "poly"), space: col(cs, "space"), inoc: col(cs, "inoc"), spaceP: col(cs, "spaceP"), spaceNP: col(cs, "spaceNP") },
        delta,
        survivedBlocks: results.filter((r) => r.outcomes.b?.survived).length,
        blocks: results.length,
        polymerAdequate: true,
        expectedBlocks: results.length,
      },
    ],
    true,
  )[0];
  const caughtBy = (["space", "inoc"] as const).filter((k) => !dec.gating[k].passes);
  const gatingK = Object.fromEntries((["builder", "poly", "space", "inoc"] as const).map((k) => [k, dec.gating[k].k]));
  const naiveK = col(cs, "naive").filter((x) => x > 0).length;
  const naivePositive = naiveK * 2 > results.length && medianTimes2(col(cs, "naive")) >= 2 * delta;
  return {
    id,
    seeds,
    contrasts: cs,
    naiveK,
    naiveWouldSay: naivePositive ? "benefit" : "no benefit",
    matchedControls: naivePositive ? (dec.label !== "supported" && caughtBy.length > 0 ? "caught" : "not caught") : "n/a",
    caughtBy,
    gatingK,
    label: dec.label,
    growthAttributed: results.map((r) => !!r.outcomes.b?.growthAttributed),
    synthesis: results.map((r) => r.outcomes.b?.synthesis ?? 0),
  };
}

