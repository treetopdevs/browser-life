/** Pure preparation for an equal-frequency, genotype-only time-shift feasibility assay. */
import { createHash } from "node:crypto";
import {
  CH, G, GENOME_CHANNELS, M3_FOUNDERS, allocState, buildWorld, cellCount, cloneState,
  founderGenome, stateHash, totalsOf, validateState, type WorldConfig, type WorldState,
} from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { type ComponentRecord, type TimeCatalog } from "./foundation-extract.ts";
import { extractCellPacket, genomeOnlyArm, transplantCellPacket, type CellPacket,
  type TransplantAudit } from "./foundation-transplant.ts";

export const COMPETITION_STEPS = 3_000;
export const COMPETITION_CENSUS_EVERY = 100;
export const TEMPLATE_SEED = 630_009_999;
export const FIRST_COMPETITION_SEED = 630_010_001;
export const DISC_CENTERS = { left: [108, 128], right: [148, 128] } as const;
export const DISC_RADIUS = Math.floor(64 / 6);
export const COMPETITION_OVERRIDES = { mutRate: 0, lightMode: "uniform" as const,
  lightBase: 40, lightAmp: 160, seasonAmp: 0 };
const MOT_NEUTRAL = 128 | (128 << 8);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sameWords = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface RankedSelection { idx: number; rank: number; key: string; selected: boolean; reasons: string[] }
/** Rank every frozen selection before outcomes; an empty rank is an unavailable epoch. */
export function rankCatalogSelection(worldId: string, epoch: "early" | "late", ruleSha256: string,
  catalog: TimeCatalog): RankedSelection[] {
  if (!worldId || !/^[a-f0-9]{64}$/.test(ruleSha256) ||
      catalog.step !== (epoch === "early" ? 100_000 : 900_000)) throw new Error("selection source/epoch/rule invalid");
  const selected = catalog.components.filter((c) => c.selected);
  if (selected.some((c) => c.reasons.length || !c.cellIndices.length))
    throw new Error("frozen catalog selection contains an invalid or empty component");
  const entries = selected.map((c: ComponentRecord) => ({ idx: c.idx,
    key: sha(`${ruleSha256}/${worldId}/${epoch}/${c.idx}`), selected: c.selected, reasons: [...c.reasons] }));
  entries.sort((a, b) => a.key.localeCompare(b.key) || a.idx - b.idx);
  return entries.map((entry, rank) => ({ ...entry, rank }));
}

export function competitionSpec(source: RunSpec, seed: number): RunSpec {
  if (!Number.isSafeInteger(seed) || seed < 630_000_001 || seed > 630_099_999)
    throw new Error("competition seed outside reserved assay range");
  return { experiment: "foundation-competition", presetId: source.presetId, condition: source.condition,
    seed, steps: COMPETITION_STEPS, censusEvery: COMPETITION_CENSUS_EVERY, deepEvery: 10,
    checkpointEvery: COMPETITION_CENSUS_EVERY, overrides: COMPETITION_OVERRIDES };
}

export interface PoolInventory { A: string; B: string; C: string; P: string; E: string; S: string;
  matter: string; energy: string }
export interface PoolAudit { sourceStateHash: string; conditionedStateHash: string;
  before: PoolInventory; after: PoolInventory; exported: PoolInventory;
  retainedExtracellularE: string; removedBoundSiteE: string;
  intervention: "retain-A-C-S-and-unbound-E;remove-B-P-bound-E-genomes;neutral-MOT;reset-ledgers" }
const inv = (state: WorldState): PoolInventory => {
  const t = totalsOf(state.cfg, state.cells);
  return Object.fromEntries(["A", "B", "C", "P", "E", "S", "matter", "energy"].map((k) =>
    [k, String(t[k as keyof typeof t])])) as unknown as PoolInventory;
};

/** This deliberately changes the source world into a resident-free chemical intervention. */
export function conditionChemicalPool(source: WorldState, gardenCfg: WorldConfig): { state: WorldState; audit: PoolAudit } {
  const sourceErrors = validateState(source);
  if (sourceErrors.length) throw new Error(`chemical source invalid: ${sourceErrors.join("; ")}`);
  if (source.cfg.tileW !== gardenCfg.tileW || source.cfg.tileH !== gardenCfg.tileH ||
      source.cfg.tilesX !== gardenCfg.tilesX || source.cfg.tilesY !== gardenCfg.tilesY ||
      source.cfg.ruleVersion !== gardenCfg.ruleVersion ||
      ["eA", "eB", "eC", "eP"].some((k) => source.cfg[k as keyof WorldConfig] !== gardenCfg[k as keyof WorldConfig]))
    throw new Error("chemical pool source and assay geometry/rule/energy coefficients differ");
  const n = cellCount(gardenCfg);
  const state = allocState(gardenCfg);
  let retainedExtracellularE = 0n, removedBoundSiteE = 0n;
  for (let i = 0; i < n; i++) {
    for (const ch of [CH.A, CH.C, CH.S]) state.cells[ch * n + i] = source.cells[ch * n + i];
    const e = source.cells[CH.E * n + i];
    if (source.cells[CH.B * n + i] + source.cells[CH.P * n + i] === 0) {
      state.cells[CH.E * n + i] = e; retainedExtracellularE += BigInt(e);
    } else removedBoundSiteE += BigInt(e);
    state.cells[CH.MOT * n + i] = MOT_NEUTRAL;
  }
  const errors = validateState(state);
  if (errors.length) throw new Error(`conditioned pool invalid: ${errors.join("; ")}`);
  const before = inv(source), after = inv(state);
  const exported = Object.fromEntries((Object.keys(before) as (keyof PoolInventory)[]).map((k) =>
    [k, String(BigInt(before[k]) - BigInt(after[k]))])) as unknown as PoolInventory;
  if (Object.values(exported).some((v) => BigInt(v) < 0n) ||
      BigInt(exported.E) !== removedBoundSiteE || BigInt(after.E) !== retainedExtracellularE ||
      ["A", "C", "S"].some((k) => exported[k as keyof PoolInventory] !== "0") ||
      state.genome.some((v) => v !== 0) || state.lightIn !== 0n || state.heatOut !== 0n)
    throw new Error("chemical pool accounting or resident removal failed");
  return { state, audit: { sourceStateHash: stateHash(source), conditionedStateHash: stateHash(state),
    before, after, exported, retainedExtracellularE: String(retainedExtracellularE),
    removedBoundSiteE: String(removedBoundSiteE),
    intervention: "retain-A-C-S-and-unbound-E;remove-B-P-bound-E-genomes;neutral-MOT;reset-ledgers" } };
}

export function standardizedPool(cfg: WorldConfig): WorldState {
  const state = allocState(cfg), n = cellCount(cfg);
  state.cells.fill(32, CH.A * n, (CH.A + 1) * n);
  state.cells.fill(MOT_NEUTRAL, CH.MOT * n, (CH.MOT + 1) * n);
  return state;
}

/** One fixed noisy evaluator disc; positive-B cells form both genetically matched inocula. */
export function standardTemplate(source: RunSpec): CellPacket {
  const cfg = specConfig(competitionSpec(source, TEMPLATE_SEED));
  if (cfg.tileW !== 256 || cfg.tileH !== 256 || cfg.tilesX !== 1 || cfg.tilesY !== 1)
    throw new Error("competition template requires one 256×256 tile");
  const world = buildWorld(cfg, { nutrient: 32, founders: [{ x: 128, y: 128, radius: DISC_RADIUS,
    genome: founderGenome(M3_FOUNDERS[0]), biomass: 64, energy: 128 }] });
  const n = cellCount(cfg), indices: number[] = [];
  for (let i = 0; i < n; i++) if (world.cells[CH.B * n + i] > 0) indices.push(i);
  return extractCellPacket(world, indices);
}

export type Side = "left" | "right";
export interface CompetitionStart { state: WorldState; audits: [TransplantAudit, TransplantAudit];
  initial: { earlyB: string; lateB: string; matter: string; energy: string }; stateHash: string }
export function startCompetition(pool: WorldState, template: CellPacket,
  earlyWords: readonly number[], lateWords: readonly number[], earlySide: Side): CompetitionStart {
  const n = cellCount(pool.cfg);
  if (pool.step !== 0 || pool.cfg.mutRate !== 0 || pool.cfg.tileW !== 256 || pool.cfg.tileH !== 256 ||
      pool.cfg.tilesX !== 1 || pool.cfg.tilesY !== 1 || earlyWords.length !== GENOME_CHANNELS ||
      lateWords.length !== GENOME_CHANNELS) throw new Error("invalid competition garden or genotype words");
  const placement = (side: Side) => ({ sourceTileX: 0, sourceTileY: 0, destinationTileX: 0, destinationTileY: 0,
    shiftX: DISC_CENTERS[side][0] - 128, shiftY: DISC_CENTERS[side][1] - 128 });
  const donor = (words: readonly number[]) => genomeOnlyArm(template, [0, 0, ...words.slice(2)]);
  const early = donor(earlyWords), late = donor(lateWords);
  const a = transplantCellPacket(pool, early, placement(earlySide), [{ from: { hi: 0, lo: 1 }, to: { hi: 0, lo: 1 } }]);
  const lateSide = earlySide === "left" ? "right" : "left";
  const b = transplantCellPacket(a.state, late, placement(lateSide), [{ from: { hi: 0, lo: 1 }, to: { hi: 0, lo: 2 } }]);
  let earlyB = 0n, lateB = 0n;
  for (let i = 0; i < n; i++) {
    const id = b.state.genome[G.LIN_LO * n + i];
    if (id === 1) earlyB += BigInt(b.state.cells[CH.B * n + i]);
    if (id === 2) lateB += BigInt(b.state.cells[CH.B * n + i]);
  }
  if (earlyB === 0n || lateB === 0n || earlyB !== lateB)
    throw new Error("matched equal-frequency inocula require equal positive initial biomass");
  const totals = totalsOf(b.state.cfg, b.state.cells);
  return { state: b.state, audits: [a.audit, b.audit],
    initial: { earlyB: String(earlyB), lateB: String(lateB), matter: String(totals.matter), energy: String(totals.energy) },
    stateHash: stateHash(b.state) };
}

export function startSingleGenotype(pool: WorldState, template: CellPacket,
  genotypeWords: readonly number[]): { state: WorldState; audit: TransplantAudit; initialB: string; stateHash: string } {
  if (pool.step !== 0 || pool.cfg.mutRate !== 0 || genotypeWords.length !== GENOME_CHANNELS)
    throw new Error("invalid single-genotype control start");
  const packet = genomeOnlyArm(template, [0, 0, ...genotypeWords.slice(2)]);
  const placed = transplantCellPacket(pool, packet, { sourceTileX: 0, sourceTileY: 0,
    destinationTileX: 0, destinationTileY: 0, shiftX: 0, shiftY: 0 },
  [{ from: { hi: 0, lo: 1 }, to: { hi: 0, lo: 1 } }]);
  const n = cellCount(pool.cfg);
  let initialB = 0n;
  for (let i = 0; i < n; i++) if (placed.state.genome[G.LIN_LO * n + i] === 1)
    initialB += BigInt(placed.state.cells[CH.B * n + i]);
  if (initialB <= 0n) throw new Error("single-genotype template has no living biomass");
  return { state: placed.state, audit: placed.audit, initialB: String(initialB), stateHash: stateHash(placed.state) };
}

/** Reciprocal swaps have identical physical initial state and common random stream. */
export function assertReciprocalPhysicalMatch(left: CompetitionStart, right: CompetitionStart): void {
  if (left.state.cfg.seed !== right.state.cfg.seed || !sameWords(left.state.cells, right.state.cells) ||
      left.state.step !== right.state.step || left.state.lightIn !== right.state.lightIn ||
      left.state.heatOut !== right.state.heatOut ||
      JSON.stringify(left.state.flux.map(String)) !== JSON.stringify(right.state.flux.map(String)) ||
      JSON.stringify(left.initial) !== JSON.stringify(right.initial))
    throw new Error("reciprocal genotype swaps changed physical initial state, resources, or seed");
}

/** Exact toroidal distance at a census; halos indicate only possible local exposure. */
export function interfaceOpportunity(state: WorldState): { minChebyshevDistance: number | null;
  adjacent: boolean; kernelHalosOverlap: boolean; kernelRadius: number } {
  const n = cellCount(state.cfg), w = state.cfg.tileW, h = state.cfg.tileH;
  if (n !== w * h || state.cfg.tilesX !== 1 || state.cfg.tilesY !== 1)
    throw new Error("interface metric requires one tile");
  const distance = new Int16Array(n).fill(-1), queue = new Int32Array(n);
  let tail = 0, late = 0;
  for (let i = 0; i < n; i++) {
    if (state.cells[CH.B * n + i] === 0 || state.genome[G.LIN_HI * n + i] !== 0) continue;
    const id = state.genome[G.LIN_LO * n + i];
    if (id === 1) { distance[i] = 0; queue[tail++] = i; }
    else if (id === 2) late++;
  }
  if (!tail || !late) return { minChebyshevDistance: null, adjacent: false,
    kernelHalosOverlap: false, kernelRadius: state.cfg.kernelRadius };
  let head = 0, min: number | null = null;
  while (head < tail && min === null) {
    const at = queue[head++], x = at % w, y = Math.floor(at / w), d = distance[at] + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = (x + dx + w) % w, yy = (y + dy + h) % h, j = yy * w + xx;
      if (distance[j] !== -1) continue;
      if (state.cells[CH.B * n + j] > 0 && state.genome[G.LIN_HI * n + j] === 0 &&
          state.genome[G.LIN_LO * n + j] === 2) { min = d; break; }
      distance[j] = d; queue[tail++] = j;
    }
  }
  return { minChebyshevDistance: min, adjacent: min !== null && min <= 1,
    kernelHalosOverlap: min !== null && min <= 2 * state.cfg.kernelRadius, kernelRadius: state.cfg.kernelRadius };
}

/** No pseudocount: extinction makes the log ratio undefined and is reported separately. */
export function relativeGrowthContrast(initialEarly: bigint, initialLate: bigint, finalEarly: bigint, finalLate: bigint):
  { logRelativeGrowth: number | null; survival: "both" | "early-only" | "late-only" | "neither" } {
  if (initialEarly <= 0n || initialLate <= 0n || finalEarly < 0n || finalLate < 0n)
    throw new Error("invalid early/late biomass for relative growth");
  const survival = finalEarly > 0n && finalLate > 0n ? "both" :
    finalEarly > 0n ? "early-only" : finalLate > 0n ? "late-only" : "neither";
  return { survival, logRelativeGrowth: survival === "both" ?
    Math.log(Number(finalLate) / Number(initialLate)) - Math.log(Number(finalEarly) / Number(initialEarly)) : null };
}
