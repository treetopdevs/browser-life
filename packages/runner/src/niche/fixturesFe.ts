// I06b fixtures (PLAN section 4.5), 16x16 at unit scale. far-field-energy: a conditioned field that differs from its controls only by
// extra free energy laid in a band OUTSIDE the inoculum footprint plus halo (no polymer). The first rung's inoculum contrast
// (D_inoc: d1E, d1B only) can be fooled by it because those comparators read energy inside the region only; D_inoc2 adds fU/fS/fB.
// Ablation only converts P to C, so with no polymer D_poly = 0 and the full gate rejects it: what is tested is the inoculum contrast.
import { CH, cellCount, type Genome, type WorldState } from "@bl/schema";
import { disc, footprintCells, outsideRegion, placeAll, receiverAlone, regionCells, type PreArm } from "./arms.ts";
import { ALPHA, contrastResult, medianTimes2 } from "./decision.ts";
import { decideCandidatesFe, type CandidateResultFe } from "./decisionFe.ts";
import { buildFreeMatched, freeRows, fundBiomass, type FreeRow } from "./freeEnergy.ts";
import { buildWall, controlsAround, nominalBudget, regionCellsExcludingFootprint, uniformBudget, wallCells, inertReceiver } from "./fixtures.ts";
import { GATING_FE, PROTOCOL_FE, type GatingFe, type ProtocolFe } from "./protocol.ts";
import { contrastsOfFe, runArmReplicated, type ArmOutcomeFe, type ContrastsFe } from "./replicate.ts";
import { NicheInvalid, audited, cloneAudit, cloneState, debitEven } from "./transfer.ts";

export function fixtureProtocolFe(p: ProtocolFe = PROTOCOL_FE): ProtocolFe {
  return { ...p, grid: 16, T1: 0, T2: 40, injury: null, footprint: { x: 8, y: 8, radius: 2 }, halo: 2, nMin: 8, reserve: { B: 480, E: 24 }, nutrient: 100, R: p.fixtureR };
}

const setChannel = (s: WorldState, ch: number, cells: readonly number[], total: number): void => {
  const n = cellCount(s.cfg), m = cells.length, base = Math.floor(total / m), rem = total % m;
  cells.forEach((i, j) => (s.cells[ch * n + i] += base + (j < rem ? 1 : 0)));
};

export interface FeBlock {
  outcomes: Record<string, ArmOutcomeFe>;
  contrasts: ContrastsFe;
  freeBefore: FreeRow[];
  freeAfter: FreeRow[];
  refused: { id: string; reason: string }[];
}

/** Controls around a hand-built conditioned arm `b`, plus fU/fS/fB; shared placement; R replicates of every arm. */
export function runFeArms(b: PreArm, d0: PreArm, seed: number, p: ProtocolFe, opts: { allowP?: boolean; genome?: Genome } = {}): FeBlock {
  const arms = [...controlsAround(b, d0, seed, p)];
  const fm = buildFreeMatched(arms[0], p);
  if (fm.arms.length === 0) throw new NicheInvalid("every free-energy-matched comparator was refused");
  arms.push(...fm.arms);
  const freeBefore = freeRows(arms);
  placeAll(arms, p, opts);
  const freeAfter = freeRows(arms);
  const outcomes: Record<string, ArmOutcomeFe> = {};
  for (const x of arms) outcomes[x.id] = runArmReplicated(x, seed, p, p.R);
  return { outcomes, contrasts: contrastsOfFe(outcomes), freeBefore, freeAfter, refused: fm.refused };
}

const condOf = (base: PreArm): PreArm => ({ id: "b", state: cloneState(base.state), audit: cloneAudit(base.audit), records: [] });

// ---------------------------------------------------------------------------
// energy fields

export type FieldVariant = "far-field" | "uniform" | "footprint";
/** Extra stored free energy, sized so the naive metric clears the fixture delta. */
export const FIELD_GIFT: Record<FieldVariant, number> = { "far-field": 10000, uniform: 10000, footprint: 4000 };

/** Cells of the far-field band: outside the footprint-plus-halo region, within two more cells of radius. */
export function bandCells(p: ProtocolFe): number[] {
  const inR = new Set(regionCells(p));
  return disc(p.footprint.x, p.footprint.y, p.footprint.radius + p.halo + 2, p.grid, p.grid).filter((i) => !inR.has(i));
}

export function fieldBlock(variant: FieldVariant, seed: number, p: ProtocolFe, gift = FIELD_GIFT[variant]): FeBlock {
  const base = receiverAlone({ audit: uniformBudget(p) }, seed, p);
  const cond = condOf(base);
  const cells = variant === "far-field" ? bandCells(p) : variant === "uniform" ? Array.from({ length: p.grid * p.grid }, (_, i) => i) : footprintCells(p);
  setChannel(cond.state, CH.E, cells, gift);
  cond.audit.energyStart += BigInt(gift);
  return runFeArms(cond, base, seed, p);
}

/** Non-living detritus B on the halo ring (funded from A there and from E outside): bound energy instead of free, equal totals with receiver alone. An inert receiver is placed. */
export function detritusField(seed: number, p: ProtocolFe, detritus = 200): { base: PreArm; cond: PreArm } {
  const base = receiverAlone({ audit: uniformBudget(p) }, seed, p);
  const cond = condOf(base);
  const ring = regionCellsExcludingFootprint(p);
  audited("detritus", cond.state, cond.audit, () => {
    const s = cond.state;
    debitEven(s, CH.A, detritus, ring);
    setChannel(s, CH.B, ring, detritus);
    debitEven(s, CH.E, (s.cfg.eB - s.cfg.eA) * detritus, outsideRegion(p));
    return { detritus };
  });
  return { base, cond };
}
export const takeoverBlockFe = (seed: number, p: ProtocolFe): FeBlock => {
  const { base, cond } = detritusField(seed, p);
  return runFeArms(cond, base, seed, p, { genome: inertReceiver(p) });
};
export const nullBlockFe = (seed: number, p: ProtocolFe): FeBlock => {
  const base = receiverAlone({ audit: uniformBudget(p) }, seed, p);
  return runFeArms(condOf(base), base, seed, p);
};

/** The rung-1 hand wall W2 (polymer floor under the receiver, allowP) at the frozen scale through the second-rung arms: a diagnostic, never qualifying. */
export function wallGateBlockFe2(seed: number, p: ProtocolFe): FeBlock {
  const base = receiverAlone({ audit: nominalBudget(seed, p) }, seed, p);
  const wall = condOf(base);
  buildWall(wall, wallCells("W2", p), p.wall.totalP, p);
  return runFeArms(wall, base, seed, p, { allowP: true });
}

// ---------------------------------------------------------------------------
// free-gap-replay

export interface FreeGapSeed {
  seed: number;
  /** Rung-1 observed direction: receiver alone holds MORE free E than b with equal totals. */
  d0FreeE: string;
  bFreeE: string;
  d0Total: string;
  bTotal: string;
  d0HoldsMoreFree: boolean;
  totalsEqual: boolean;
  /** Free-energy difference to b for each comparator, before and after placement (all zero). */
  freeDiffBefore: Record<string, string>;
  freeDiffAfter: Record<string, string>;
  constructionGap: Record<string, string>;
  flags: Record<string, string>;
  residualsZero: boolean;
}

export function freeGapSeed(seed: number, p: ProtocolFe): FreeGapSeed {
  const { base, cond } = detritusField(seed, p);
  const b = runFeArmsPre(cond, base, seed, p);
  const row = (rows: FreeRow[], id: string) => rows.find((r) => r.id === id)!;
  const ids = ["fU", "fS", "fB"].filter((id) => b.before.some((r) => r.id === id));
  const d0 = row(b.before, "d0"), bb = row(b.before, "b");
  return {
    seed,
    d0FreeE: d0.freeE,
    bFreeE: bb.freeE,
    d0Total: d0.total,
    bTotal: bb.total,
    d0HoldsMoreFree: BigInt(d0.freeE) > BigInt(bb.freeE),
    totalsEqual: d0.total === bb.total,
    freeDiffBefore: Object.fromEntries(ids.map((id) => [id, row(b.before, id).freeGapToB])),
    freeDiffAfter: Object.fromEntries(ids.map((id) => [id, row(b.after, id).freeGapToB])),
    constructionGap: Object.fromEntries(["d0", ...ids].map((id) => [id, row(b.before, id).constructionGap])),
    flags: Object.fromEntries(["d0", ...ids].map((id) => [id, row(b.before, id).flag])),
    residualsZero: b.residualsZero,
  };
}

/** Arms and free-energy rows only, no Stage 2 (the replay is about construction). */
function runFeArmsPre(b: PreArm, d0: PreArm, seed: number, p: ProtocolFe): { before: FreeRow[]; after: FreeRow[]; residualsZero: boolean } {
  const arms = [...controlsAround(b, d0, seed, p)];
  const fm = buildFreeMatched(arms[0], p);
  arms.push(...fm.arms);
  const before = freeRows(arms);
  placeAll(arms, p, { genome: inertReceiver(p) });
  const after = freeRows(arms);
  const residualsZero = arms.every((x) => x.records.every((r) => r.residual === "0" && r.matterResidual === "0"));
  return { before, after, residualsZero };
}

// ---------------------------------------------------------------------------
// guards

export interface GuardFe {
  id: string;
  ok: boolean;
  detail: string;
}
export function runGuardsFe(p: ProtocolFe): GuardFe[] {
  const out: GuardFe[] = [];
  const attempt = (id: string, fn: () => void, want: RegExp): void => {
    try {
      fn();
      out.push({ id, ok: false, detail: "no refusal" });
    } catch (e) {
      out.push({ id, ok: e instanceof NicheInvalid && want.test(e.reason), detail: e instanceof NicheInvalid ? e.reason : String(e) });
    }
  };
  attempt("credit-overdraw", () => {
    const base = receiverAlone({ audit: uniformBudget(p) }, 1, p);
    const f = buildFreeMatched(condOf(base), p).arms.find((x) => x.id === "fB")!;
    fundBiomass(f, 10 ** 9, outsideRegion(p));
  }, /credit-overdraw/);
  return out;
}

// ---------------------------------------------------------------------------
// fixture decisions

export interface FixtureReportFe {
  id: string;
  seeds: readonly number[];
  contrasts: ContrastsFe[];
  naiveK: number;
  naiveWouldSay: "benefit" | "no benefit";
  /** The first rung's inoculum contrast alone passes its sign test with median >= delta: it is fooled. */
  inocFooledOld: boolean;
  /** The free-energy-matched inoculum contrast does not pass. */
  inocCaughtNew: boolean;
  kOld: number;
  kNew: number;
  gatingK: Record<GatingFe, number>;
  /** Gating contrasts that fail (these reject the field in the full gate). */
  caughtBy: GatingFe[];
  fullGateLabel: CandidateResultFe["label"];
  synthesis: number[];
  /** Free energy of every arm for the first seed, before placement (the 9,917 vs 22,169 style table). */
  freeBefore: FreeRow[];
  freeAfter: FreeRow[];
}

export function decideFixtureFe(id: string, seeds: readonly number[], blocks: FeBlock[], delta: number): FixtureReportFe {
  const cs = blocks.map((b) => b.contrasts);
  const col = (k: keyof ContrastsFe) => cs.map((c) => c[k]);
  const n = blocks.length;
  const dec = decideCandidatesFe([{ id, status: "ok", invalidReasons: [], contrasts: { builder: col("builder"), poly: col("poly"), space: col("space"), inoc2: col("inoc2"), spaceP: col("spaceP"), spaceNP: col("spaceNP"), inoc: col("inoc"), inocMatched: col("inocMatched"), naive: col("naive") }, delta, viableBlocks: n, blocks: n, expectedBlocks: n, notSimulatedReasons: [] }], 1)[0];
  const old = contrastResult(col("inoc"), delta, ALPHA), nw = contrastResult(col("inoc2"), delta, ALPHA);
  const naiveK = col("naive").filter((x) => x > 0).length;
  const naivePositive = naiveK * 2 > n && medianTimes2(col("naive")) >= 2 * delta;
  return {
    id,
    seeds,
    contrasts: cs,
    naiveK,
    naiveWouldSay: naivePositive ? "benefit" : "no benefit",
    inocFooledOld: old.passes,
    inocCaughtNew: !nw.passes,
    kOld: old.k,
    kNew: nw.k,
    gatingK: Object.fromEntries(GATING_FE.map((k) => [k, dec.gating[k].k])) as Record<GatingFe, number>,
    caughtBy: GATING_FE.filter((k) => !dec.gating[k].passes),
    fullGateLabel: dec.label,
    synthesis: blocks.map((b) => b.outcomes.b?.synthesis ?? 0),
    freeBefore: blocks[0].freeBefore,
    freeAfter: blocks[0].freeAfter,
  };
}
