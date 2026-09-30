import { CELL_CHANNELS, CH, G, buildWorld, cellCount, lineageKey, packLineageLo, stateHash, type WorldConfig, type WorldState } from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { specConfig, type RunSpec } from "@bl/runner";
import { fromHex } from "./selection-funnel-audit.ts";
import { ancestryResolver, asSimGenome, competitionScore, policyWorld, rootMasses, sampleRoot, type Cohort, type HistoryUnit, type MutationEdge, type SampleUnit, type SampledRoot, type Score } from "./founder-policy.ts";

export const ASSAY_STEPS = 20000;
const CENTER_LEFT = { x: 32, y: 64 }, CENTER_RIGHT = { x: 96, y: 64 };

export function evolutionConfig(unit: HistoryUnit): WorldConfig {
  const spec: RunSpec = { experiment: "founder-policy", presetId: "gradient-m3", condition: unit.mode === "normal" ? "treatment" : "no-mutation", seed: unit.seed, steps: 1000000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
  return specConfig(spec);
}

export function assayConfig(seed: number): WorldConfig {
  const spec: RunSpec = { experiment: "founder-policy-assay", presetId: "gradient-m3", condition: "no-mutation", seed, steps: ASSAY_STEPS, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, overrides: { tileW: 128, tileH: 128 } };
  const cfg = specConfig(spec);
  if (cfg.mutRate !== 0 || cfg.tileW !== 128 || cfg.tileH !== 128 || cfg.tilesX !== 1 || cfg.tilesY !== 1 || cfg.lightMode !== "gradient") throw Error("assay configuration drift");
  return cfg;
}

export interface CompetitionInit { state: WorldState; descendantLineage: string; ancestorLineage: string; assignment: number; positions: { descendant: "left" | "right"; ancestor: "left" | "right" } }
export function competitionWorld(cfg: WorldConfig, descendantHex: string, ancestorHex: string, assignment: number): CompetitionInit {
  if (!Number.isInteger(assignment) || assignment < 0 || assignment > 3) throw Error("invalid assay assignment");
  const descendantLeft = (assignment & 1) === 0, descendantFirst = (assignment & 2) === 0;
  const descendant = { ...(descendantLeft ? CENTER_LEFT : CENTER_RIGHT), radius: 10, genome: asSimGenome(fromHex(descendantHex)), biomass: 64, energy: 128 };
  const ancestor = { ...(descendantLeft ? CENTER_RIGHT : CENTER_LEFT), radius: 10, genome: asSimGenome(fromHex(ancestorHex)), biomass: 64, energy: 128 };
  const state = buildWorld(cfg, { nutrient: 32, founders: descendantFirst ? [descendant, ancestor] : [ancestor, descendant] });
  const template = buildWorld(cfg, { nutrient: 32, founders: [{ ...CENTER_LEFT, radius: 10, genome: asSimGenome(fromHex(descendantHex)), biomass: 64, energy: 128 }] });
  const n = cellCount(cfg), W = cfg.tileW * cfg.tilesX;
  // The fixed, one-founder template is independent of assignment and label.
  // Copy its complete physical material onto both discs; leave their genomes
  // and lineage labels from the two-founder initialization intact.
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    if (dx * dx + dy * dy > 100) continue;
    const left = (CENTER_LEFT.y + dy) * W + CENTER_LEFT.x + dx, right = (CENTER_RIGHT.y + dy) * W + CENTER_RIGHT.x + dx;
    for (let ch = 0; ch < CELL_CHANNELS; ch++) state.cells[ch * n + left] = state.cells[ch * n + right] = template.cells[ch * n + left];
  }
  const leftMass = discMaterial(state, CENTER_LEFT.x, CENTER_LEFT.y), rightMass = discMaterial(state, CENTER_RIGHT.x, CENTER_RIGHT.y);
  if (JSON.stringify(leftMass) !== JSON.stringify(rightMass)) throw Error("assay initial material is unequal");
  return { state, descendantLineage: lineageKey(0, packLineageLo(cfg, descendantFirst ? 1 : 2)), ancestorLineage: lineageKey(0, packLineageLo(cfg, descendantFirst ? 2 : 1)), assignment, positions: { descendant: descendantLeft ? "left" : "right", ancestor: descendantLeft ? "right" : "left" } };
}

function discMaterial(state: WorldState, cx: number, cy: number): number[][] { const n = cellCount(state.cfg), W = state.cfg.tileW * state.cfg.tilesX, result: number[][] = []; for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (dx * dx + dy * dy <= 100) { const i = (cy + dy) * W + cx + dx; result.push(Array.from({ length: CELL_CHANNELS }, (_, ch) => state.cells[ch * n + i])); } return result; }

export function competitionMasses(state: WorldState, descendantLineage: string, ancestorLineage: string): { descendant: number; ancestor: number; unknown: number } {
  if (state.step !== ASSAY_STEPS) throw Error(`assay endpoint is ${state.step}, expected ${ASSAY_STEPS}`);
  const n = cellCount(state.cfg); let descendant = 0, ancestor = 0, unknown = 0;
  for (let i = 0; i < n; i++) { const mass = state.cells[CH.B * n + i] + state.cells[CH.P * n + i]; if (!mass) continue; const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i]; if (!hi && !lo) continue; const key = lineageKey(hi, lo); if (key === descendantLineage) descendant += mass; else if (key === ancestorLineage) ancestor += mass; else unknown += mass; }
  return { descendant, ancestor, unknown };
}

export async function executeCompetition(device: GPUDevice, descendantHex: string, ancestorHex: string, seed: number, assignment: number, deadline = Infinity): Promise<{ score: Score; startHash: string; finalHash: string; cfg: WorldConfig; assignment: number; initialMaterialEqual: true }> {
  const cfg = assayConfig(seed), init = competitionWorld(cfg, descendantHex, ancestorHex, assignment), sim = await GpuSim.create(device, init.state);
  try {
    for (let t = 0; t < ASSAY_STEPS; t += 100) { if (performance.now() > deadline) throw Error("assay time limit"); sim.run(100); if ((t + 100) % 1000 === 0) { await device.queue.onSubmittedWorkDone(); if (performance.now() > deadline) throw Error("assay time limit"); } }
    const final = await sim.readState(), mass = competitionMasses(final, init.descendantLineage, init.ancestorLineage);
    if (mass.unknown) throw Error(`assay has ${mass.unknown} bound mass with unexpected lineage`);
    return { score: competitionScore(mass.descendant, mass.ancestor), startHash: stateHash(init.state), finalHash: stateHash(final), cfg, assignment, initialMaterialEqual: true };
  } finally { sim.destroy(); }
}

export interface EvolutionSample { time: number; roots: SampledRoot[]; rootMasses: number[]; unknownAncestryMass: number; unassociatedMass: number; stateHash: string }
export function sampleEvolutionState(state: WorldState, founderRoots: Record<string, number>, edges: MutationEdge[], sampleUnits: SampleUnit[]): EvolutionSample {
  if (![0, 100000, 1000000].includes(state.step)) throw Error(`unplanned sample step ${state.step}`);
  if (sampleUnits.length !== 24 || sampleUnits.some((x) => x.time !== state.step)) throw Error("sample seed roster must have 24 exact-time entries");
  const masses = rootMasses(state, ancestryResolver(founderRoots, edges));
  const roots = masses.roots.map((root) => { const drawSeeds = sampleUnits.filter((x) => x.root === root.root).sort((a, b) => a.draw - b.draw); if (drawSeeds.length !== 2 || drawSeeds[0].draw !== 0 || drawSeeds[1].draw !== 1) throw Error(`bad draw seeds for root ${root.root}`); return sampleRoot(root, [drawSeeds[0].seed, drawSeeds[1].seed], masses.unknownAncestryMass); });
  return { time: state.step, roots, rootMasses: masses.roots.map((x) => x.totalMass), unknownAncestryMass: masses.unknownAncestryMass, unassociatedMass: masses.unassociatedMass, stateHash: stateHash(state) };
}

export interface EvolutionProgress { unit: HistoryUnit; cohortHex: string[]; step: number; samples: EvolutionSample[]; mutationEdges: MutationEdge[]; founderRoots: Record<string, number>; stateHash: string; startedAt: string; updatedAt: string; complete: boolean }
export async function advanceEvolution(device: GPUDevice, cohort: Cohort, unit: HistoryUnit, sampleUnits: SampleUnit[], prior: { state: WorldState; progress: EvolutionProgress } | null, deadline: number, onCheckpoint: (state: WorldState, progress: EvolutionProgress) => Promise<void>): Promise<EvolutionProgress> {
  const cfg = evolutionConfig(unit), built = policyWorld(cfg, cohort, unit.seedIndex);
  const startedAt = prior?.progress.startedAt ?? new Date().toISOString();
  let state = prior?.state ?? built.state;
  if (JSON.stringify(state.cfg) !== JSON.stringify(cfg) || ![0, 100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000].includes(state.step)) throw Error("invalid evolution resume state");
  let edges = prior?.progress.mutationEdges ?? [];
  let samples = prior?.progress.samples ?? [sampleEvolutionState(state, built.founderRoots, edges, sampleUnits.filter((x) => x.time === 0))];
  const sim = await GpuSim.create(device, state);
  try {
    for (let end = state.step + 100000; end <= 1000000; end += 100000) {
      for (let t = state.step; t < end; t += 100) {
        if (performance.now() > deadline) throw Error("evolution time limit before next checkpoint");
        sim.run(100); const ledger = await sim.drainLedger();
        if (ledger.step !== t + 100 || ledger.dropped) throw Error(`mutation event loss at ${ledger.step}: ${ledger.dropped}`);
        edges.push(...ledger.events.map((e) => ({ child: lineageKey(e.childHi, e.childLo), parent: lineageKey(e.parentHi, e.parentLo) })));
      }
      state = await sim.readState();
      if (state.step !== end) throw Error("evolution state step mismatch");
      if (end === 100000 || end === 1000000) samples.push(sampleEvolutionState(state, built.founderRoots, edges, sampleUnits.filter((x) => x.time === end)));
      const progress: EvolutionProgress = { unit, cohortHex: cohort.genomeHex, step: end, samples, mutationEdges: edges, founderRoots: built.founderRoots, stateHash: stateHash(state), startedAt, updatedAt: new Date().toISOString(), complete: end === 1000000 };
      await onCheckpoint(state, progress);
    }
    return { unit, cohortHex: cohort.genomeHex, step: state.step, samples, mutationEdges: edges, founderRoots: built.founderRoots, stateHash: stateHash(state), startedAt, updatedAt: new Date().toISOString(), complete: true };
  } finally { sim.destroy(); }
}
