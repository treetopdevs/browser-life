// Pairwise contest arenas on the CPU reference. Mutation off, genome-only, standard inoculum. Observer only:
// the simulator is stepped with RefSim.run and its state is read, never written after step zero.
// Imports @bl/* (the CLI and its workers register a resolver; vitest and vite alias it). Not in the metrics barrel.
import { CH, G, GENOME_CHANNELS, buildWorld, defaultConfig, genomeFromHex, lowbias32, packLineageLo, type Founder, type Genome, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

/** Planting parameters (not inventories: buildWorld draws per-cell biomass in 0..2*biomass; the measured step-zero totals are what count). */
export const PLANT = { biomass: 256, energy: 512, nutrient: 256 } as const;
export const SLOTS = 4;
export const JITTER = 2;
export const SALT_JITTER = 0x1a2b3c4d;
/** A label is at the extinction floor when its biomass is below 1/FLOOR_DIV of its own measured step-zero biomass. Frozen, never tuned. */
export const FLOOR_DIV = 16;

export interface ArenaParams {
  tile: number;
  radius: number;
  /** Steps of the last checkpoint. Checkpoints are at steps/4, steps/2, 3*steps/4, steps. */
  steps: number;
  /** Optional overrides applied to defaultConfig (used only by the depletion arena). */
  override?: Partial<WorldConfig>;
}

export const checkpointSteps = (steps: number): number[] => [1, 2, 3, 4].map((k) => (steps * k) / 4);

/** Nominal slot centres: a quarter / three quarters of the tile. Slots 0 and 1 sit on one diagonal, 2 and 3 on the other. */
export function slotCentres(tile: number, seed: number): { x: number; y: number }[] {
  const q = tile / 4;
  const nominal = [[q, q], [3 * q, 3 * q], [3 * q, q], [q, 3 * q]];
  return nominal.map(([nx, ny], slot) => {
    const j = (axis: number): number =>
      (lowbias32((seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(axis + 1, 0x85ebca6b) ^ SALT_JITTER) >>> 0) % (2 * JITTER + 1)) - JITTER;
    return { x: nx + j(0), y: ny + j(1) };
  });
}

/** Throws unless every pair of discs stays apart (toroidally) at worst-case jitter. */
export function assertNonOverlap(tile: number, radius: number): void {
  const q = tile / 4;
  const nominal = [[q, q], [3 * q, 3 * q], [3 * q, q], [q, 3 * q]];
  for (let a = 0; a < SLOTS; a++) {
    for (let b = a + 1; b < SLOTS; b++) {
      const tor = (d: number): number => { const m = Math.abs(d) % tile; return Math.min(m, tile - m); };
      const sep = Math.max(tor(nominal[a][0] - nominal[b][0]), tor(nominal[a][1] - nominal[b][1])) - 2 * JITTER;
      if (sep <= 2 * radius) throw new Error(`slots ${a} and ${b} may overlap: separation ${sep} <= 2R = ${2 * radius}`);
    }
  }
}

export function contestConfig(seed: number, p: ArenaParams): WorldConfig {
  return defaultConfig({ seed, tileW: p.tile, tileH: p.tile, mutRate: 0, ...p.override });
}

export interface Job {
  /** Stable key; results are ordered by it. */
  key: string;
  seed: number;
  /** genomeHex of label A and of label B (null for a solo arena). */
  hexA: string;
  hexB: string | null;
  /** Slots each label occupies. Slots in neither set are emptied. */
  slotsA: number[];
  slotsB: number[];
}

export interface CheckpointCounts { step: number; bA: number; bB: number; cellsA: number; cellsB: number }
export interface JobResult {
  key: string;
  /** Measured step-zero biomass per label, and the step-zero discs' cell counts. */
  b0A: number; b0B: number; e0A: number; e0B: number;
  cp: CheckpointCounts[];
}

/** Step-zero world: all four slots built, in slot order, then slots in neither set are emptied (biomass, energy and genome zeroed; nutrient kept). */
export function buildContestWorld(job: Job, p: ArenaParams): WorldState {
  assertNonOverlap(p.tile, p.radius);
  const cfg = contestConfig(job.seed, p);
  const centres = slotCentres(p.tile, job.seed);
  const gA = genomeFromHex(job.hexA);
  const gB: Genome = job.hexB === null ? gA : genomeFromHex(job.hexB);
  const founders: Founder[] = centres.map((c, slot) => ({
    x: c.x, y: c.y, radius: p.radius, genome: job.slotsB.includes(slot) ? gB : gA, biomass: PLANT.biomass, energy: PLANT.energy,
  }));
  const s = buildWorld(cfg, { nutrient: PLANT.nutrient, founders });
  const n = p.tile * p.tile;
  for (let slot = 0; slot < SLOTS; slot++) {
    if (job.slotsA.includes(slot) || job.slotsB.includes(slot)) continue;
    const c = centres[slot];
    for (let dy = -p.radius; dy <= p.radius; dy++) for (let dx = -p.radius; dx <= p.radius; dx++) {
      if (dx * dx + dy * dy > p.radius * p.radius) continue;
      const i = ((((c.y + dy) % p.tile) + p.tile) % p.tile) * p.tile + ((((c.x + dx) % p.tile) + p.tile) % p.tile);
      s.cells[CH.B * n + i] = 0;
      s.cells[CH.E * n + i] = 0;
      for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = 0;
    }
  }
  return s;
}

/** Biomass and cell counts per label, read from a state. Throws if a living lineage is not a founder or labelled biomass differs from total biomass. */
export function readLabels(s: WorldState, job: Pick<Job, "slotsA" | "slotsB">): { bA: number; bB: number; cellsA: number; cellsB: number } {
  const cfg = s.cfg;
  const n = cfg.tileW * cfg.tileH;
  const lab = new Map<number, "A" | "B">();
  for (const slot of job.slotsA) lab.set(packLineageLo(cfg, slot + 1), "A");
  for (const slot of job.slotsB) lab.set(packLineageLo(cfg, slot + 1), "B");
  let bA = 0, bB = 0, cellsA = 0, cellsB = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const b = s.cells[CH.B * n + i];
    total += b;
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) { if (b !== 0) throw new Error(`biomass ${b} without a lineage at cell ${i}`); continue; }
    const l = hi === 0 ? lab.get(lo) : undefined;
    if (l === undefined) throw new Error(`cell ${i} carries lineage ${hi}:${lo}, not a labelled founder (mutation must be off)`);
    if (l === "A") { bA += b; if (b > 0) cellsA++; } else { bB += b; if (b > 0) cellsB++; }
  }
  if (bA + bB !== total) throw new Error(`labelled biomass ${bA + bB} differs from total ${total}`);
  return { bA, bB, cellsA, cellsB };
}

/** Step-zero inventories of a job (biomass and energy per label), from the built world alone: no simulation step. */
export function stepZero(state: WorldState, job: Pick<Job, "slotsA" | "slotsB">, p: Pick<ArenaParams, "tile">): { b0A: number; b0B: number; e0A: number; e0B: number } {
  const z = readLabels(state, job);
  const n = p.tile * p.tile;
  let e0A = 0, e0B = 0;
  for (let i = 0; i < n; i++) {
    const lo = state.genome[G.LIN_LO * n + i];
    if (state.cells[CH.B * n + i] === 0) continue;
    if (job.slotsA.includes(lo - 1)) e0A += state.cells[CH.E * n + i]; else e0B += state.cells[CH.E * n + i];
  }
  return { b0A: z.bA, b0B: z.bB, e0A, e0B };
}

export function runJob(job: Job, p: ArenaParams, observe?: (sim: RefSim, step: number) => void): JobResult {
  const sim = new RefSim(buildContestWorld(job, p));
  const z0 = stepZero(sim.state, job, p);
  const cp: CheckpointCounts[] = [];
  for (const target of checkpointSteps(p.steps)) {
    sim.run(target - sim.state.step);
    observe?.(sim, target);
    cp.push({ step: target, ...readLabels(sim.state, job) });
  }
  return { key: job.key, ...z0, cp };
}
