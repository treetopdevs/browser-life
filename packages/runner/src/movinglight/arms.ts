// Arm construction. Body patches are built once (biomass, energy and lineage ids from buildWorld with a fixed seed), audited, and copied by
// torus translation into every strategy and placement, so identical bodies and input budgets hold by construction. Only existing genome
// fields are edited; each edit is listed in ARM_EDITS and hashed.
import {
  B2_OFF,
  CH,
  IN,
  MOT_ZERO,
  NN_O,
  OUT,
  W2_OFF,
  allocState,
  buildWorld,
  cellCount,
  darkFleeGenome,
  encodeGenome,
  generalistGenome,
  genomeHex,
  packLineageLo,
  sha256HexJS,
  sunFollowerGenome,
  validateState,
  totalsOf,
  G,
  type Genome,
  type WorldState,
} from "@bl/schema";
import { PROTOCOL, worldConfig, type Placement, type Protocol, type ScheduleId, type StrategyId } from "./protocol.ts";

export const ARM_EDITS: Record<StrategyId, string> = {
  sense: "darkFleeGenome as is (emits in the dark, moves down the signal gradient)",
  "sense-nosig": "darkFleeGenome with EMIT bias and the EMIT weight from hidden unit 1 zeroed; movement wiring kept (information-free, movement-capable)",
  "sense-nomot": "darkFleeGenome with motility gain 0 (emits, does not move)",
  drift: "sunFollowerGenome (blind east drifter, MX bias 32, gain 12)",
  still: "generalistGenome (motility gain 0)",
};

export function genomeOf(id: StrategyId, p: Protocol = PROTOCOL): Genome {
  const { defaultMu: mu, defaultSigma: sg } = p;
  if (id === "drift") return sunFollowerGenome(mu, sg);
  if (id === "still") return generalistGenome(mu, sg);
  const g = darkFleeGenome(mu, sg);
  if (id === "sense-nosig") {
    g.weights[W2_OFF + 1 * NN_O + OUT.EMIT] = 0;
    g.weights[B2_OFF + OUT.EMIT] = 0;
  }
  if (id === "sense-nomot") g.motGain = 0;
  return g;
}
export const genomeHash = (id: StrategyId, p: Protocol = PROTOCOL): string => sha256HexJS(new TextEncoder().encode(genomeHex(genomeOf(id, p))));

export interface PatchCell {
  dx: number;
  dy: number;
  B: number;
  E: number;
}
export interface Patch {
  /** Raw lineage id (1..n). */
  raw: number;
  cells: PatchCell[];
  B: number;
  E: number;
}

/** The n body patches, built once from buildWorld with a fixed seed: discs of the founder rule, noisy biomass, energy proportional. */
export function buildPatches(p: Protocol = PROTOCOL, patchSeed = 8_700_000): Patch[] {
  const cfg = worldConfig(patchSeed, "paused", p);
  const W = p.W;
  const founders = Array.from({ length: p.n }, (_, k) => ({
    x: 2 + k * 6,
    y: 8,
    radius: p.body.radius,
    genome: generalistGenome(p.defaultMu, p.defaultSigma),
    biomass: p.body.biomass,
    energy: p.body.energyPerBiomass * p.body.biomass,
  }));
  if (founders[p.n - 1].x + p.body.radius >= W) throw new Error("scratch world too narrow for the patches");
  const s = buildWorld(cfg, { nutrient: 0, founders });
  const n = cellCount(cfg);
  return founders.map((f, k) => {
    const cells: PatchCell[] = [];
    for (let dy = -f.radius; dy <= f.radius; dy++)
      for (let dx = -f.radius; dx <= f.radius; dx++) {
        if (dx * dx + dy * dy > f.radius * f.radius) continue;
        const i = (f.y + dy) * W + (f.x + dx);
        const B = s.cells[CH.B * n + i];
        if (B > 0) cells.push({ dx, dy, B, E: s.cells[CH.E * n + i] });
      }
    return { raw: k + 1, cells, B: cells.reduce((a, c) => a + c.B, 0), E: cells.reduce((a, c) => a + c.E, 0) };
  });
}

export interface Position {
  x: number;
  y: number;
}
/** Centres of the n bodies. Grouped: a compact 2 x 2 block; dispersed: the maximal spacing; both centred `offset` cells west of the t=0 meridian. */
export function positions(placement: Placement, p: Protocol = PROTOCOL): Position[] {
  const cx = (((0 - p.placement.offset) % p.W) + p.W) % p.W;
  const g = p.placement.groupedSpacing;
  if (placement === "grouped") {
    const r = Math.floor(p.n / 2) || 1;
    return Array.from({ length: p.n }, (_, k) => ({
      x: (((cx + (k % r) * g - Math.floor(((r - 1) * g) / 2)) % p.W) + p.W) % p.W,
      y: p.placement.groupedY + Math.floor(k / r) * g - Math.floor(g / 2),
    }));
  }
  const r = Math.floor(p.n / 2) || 1;
  const dx = Math.floor(p.W / r);
  return Array.from({ length: p.n }, (_, k) => ({
    x: (((cx + (k % r) * dx - Math.floor(((r - 1) * dx) / 2)) % p.W) + p.W) % p.W,
    y: p.placement.dispersedY[Math.floor(k / r) % p.placement.dispersedY.length],
  }));
}

export interface Arm {
  strategy: StrategyId;
  placement: Placement;
  schedule: ScheduleId;
  seed: number;
  state: WorldState;
  /** Audited input: biomass B, free energy E in bodies, and the inoculum input energy E + eB * B. */
  inputB: number;
  inputE: number;
  inputEnergy: number;
}

/** One arm: nutrient everywhere, the patches stamped (copied by translation) at the placement's centres with the strategy's genome. */
export function buildArm(strategy: StrategyId, placement: Placement, schedule: ScheduleId, seed: number, patches: Patch[], p: Protocol = PROTOCOL, positionsOverride?: Position[]): Arm {
  const cfg = worldConfig(seed, schedule, p);
  const s = allocState(cfg);
  const n = cellCount(cfg);
  s.cells.fill(p.nutrient, CH.A * n, (CH.A + 1) * n);
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const pos = positionsOverride ?? positions(placement, p);
  const g = genomeOf(strategy, p);
  let inputB = 0, inputE = 0;
  patches.forEach((patch, k) => {
    const words = encodeGenome(g, 0, packLineageLo(cfg, patch.raw));
    for (const c of patch.cells) {
      const x = (((pos[k].x + c.dx) % p.W) + p.W) % p.W;
      const y = (((pos[k].y + c.dy) % p.H) + p.H) % p.H;
      const i = y * p.W + x;
      if (s.cells[CH.B * n + i] !== 0) throw new Error(`patches overlap at cell ${i}`);
      s.cells[CH.B * n + i] = c.B;
      s.cells[CH.E * n + i] = c.E;
      for (let w = 0; w < words.length; w++) s.genome[w * n + i] = words[w];
      inputB += c.B;
      inputE += c.E;
    }
  });
  const errs = validateState(s);
  if (errs.length) throw new Error(`invalid arm: ${errs[0]}`);
  return { strategy, placement, schedule, seed, state: s, inputB, inputE, inputEnergy: inputE + cfg.eB * inputB };
}

/** Audit of a built arm against the patches: totals equal the patch sums. */
export function auditArm(a: Arm, patches: Patch[]): string[] {
  const out: string[] = [];
  const B = patches.reduce((x, q) => x + q.B, 0), E = patches.reduce((x, q) => x + q.E, 0);
  if (a.inputB !== B) out.push(`arm ${a.strategy}/${a.placement}: B ${a.inputB} != patches ${B}`);
  if (a.inputE !== E) out.push(`arm ${a.strategy}/${a.placement}: E ${a.inputE} != patches ${E}`);
  const t = totalsOf(a.state.cfg, a.state.cells);
  if (t.B !== BigInt(B)) out.push("state B total differs from the patches");
  void G; void IN;
  return out;
}
