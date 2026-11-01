// Known-mechanism fixtures with outcomes from paired CPU replays (PLAN.md, section 6). Small worlds (32 x 32, kernelRadius 4) run
// on `RefSim`. For one source history (a family) the generator
//   1. runs the history twice to the fork step C: instrumented (census series and frame samples taken every few steps) and plain
//      (state hashes only), and requires the two to agree on the full-state hash at every sampled step (observer neutrality);
//   2. builds one envelope per mechanism case from the instrumented run (only data at steps <= C goes in);
//   3. from the plain state at C runs a control arm (no operation) and, per case, a treated arm (advance to C+delta, apply, advance
//      to C+H), every arm on its own deep clone, and records effect = readout(treated) - readout(control) at C+H.
// Proposers see envelopes; only the scorer reads `effect`. Labels are derived from `effect` and the frozen `minEffect` at scoring time.
import { CH, RULE_VERSION, PRESETS, buildWorld, cellCount, generalistGenome, isLiving, lowbias32, presetConfig, stateHash, totalsOf, worldW, cloneState, type Founder, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { sha256Text, canonical } from "../propose.ts";
import type { ScheduledIntervention } from "@bl/runner";
import { CpuInterventionAdapter } from "./adapter.ts";
import { censusPoint, frameOf, sealEnvelope, standardMenu, type Direction3, type OpKind, type PredictionEnvelope, type Task, type TaskOp } from "./envelope.ts";
import { freeNutrient, livingCells, totalMass, type DiagnosticId, type ReadoutId } from "./readouts.ts";
import { taskSchedule } from "./validate.ts";

export interface FamilySpec {
  id: string;
  seed: number;
  light: "spots" | "gradient";
  nutrient: number;
  founders: number;
}
export interface MechanismSpec {
  id: string;
  kind: OpKind;
  where: "occupied" | "empty" | "none";
  r?: number;
  amount?: number;
  /** The mechanism's expectation. Measured outcomes are never relabelled to match it; disagreements are reported. */
  expected: Direction3;
}
export interface WindowSpec {
  forkStep: number;
  delta: number;
  horizon: number;
  censusEvery: number;
  frameSteps: number[];
}
export interface WorldSpec {
  side: number;
  kernelRadius: number;
  founderRadius: number;
  founderBiomass: number;
  founderEnergy: number;
}
export interface FixtureProtocol {
  world: WorldSpec;
  window: WindowSpec;
  menu: { rMax: number; amountMax: number };
  mechanisms: MechanismSpec[];
  seedVariantOffset: number;
}

/** Hooks for tests: an observer called on the instrumented runs (history and arm twins). A perturbing observer must make runFamily throw. */
export interface FixtureHooks {
  observer?: (state: WorldState, step: number, phase: "history" | "continuation") => void;
}

/** Bounds a protocol must satisfy before anything is simulated (PLAN.md, section 6: caps and bounds are checked first, variants included). */
export function assertFixtureBounds(p: FixtureProtocol): void {
  const int = (v: unknown, lo: number, hi: number, what: string): void => {
    if (!Number.isSafeInteger(v) || (v as number) < lo || (v as number) > hi) throw new Error(`protocol ${what} ${String(v)} is outside ${lo}..${hi}`);
  };
  const { world, window: w, menu } = p;
  int(world.side, 8, 256, "world.side");
  int(world.kernelRadius, 1, 16, "world.kernelRadius");
  int(w.forkStep, 1, 100_000, "window.forkStep");
  int(w.delta, 1, 10_000, "window.delta");
  int(w.horizon, w.delta, 100_000, "window.horizon");
  int(w.censusEvery, 1, w.forkStep, "window.censusEvery");
  for (const f of w.frameSteps) int(f, 0, w.forkStep, "window.frameSteps entry");
  int(menu.rMax, 1, 64, "menu.rMax");
  int(menu.amountMax, 1, 1 << 24, "menu.amountMax");
  if (p.mechanisms.length < 1 || p.mechanisms.length > 64) throw new Error("protocol needs 1..64 mechanisms");
  for (const m of p.mechanisms) {
    if (m.kind !== "none") int(m.r, 1, menu.rMax, `mechanism ${m.id} r`);
    if (m.kind === "feed" || m.kind === "drain") int(m.amount, 1, menu.amountMax, `mechanism ${m.id} amount`);
  }
}

/** Cell-steps one family run will simulate, every arm and check included: known before anything runs. */
export function plannedCellSteps(p: FixtureProtocol): number {
  assertFixtureBounds(p);
  const n = p.world.side * p.world.side;
  const { forkStep: C, horizon: H } = p.window;
  // two history runs to C; control + one arm per mechanism, each with an instrumented twin.
  return n * (2 * C + 2 * (1 + p.mechanisms.length) * H);
}

export function makeWorld(p: FixtureProtocol, fam: FamilySpec, seed = fam.seed): WorldState {
  const preset = PRESETS.find((x) => x.id === fam.light)!;
  const cfg = presetConfig(preset, seed, { tileW: p.world.side, tileH: p.world.side, kernelRadius: p.world.kernelRadius });
  const W = p.world.side;
  const founders: Founder[] = [];
  for (let i = 0; i < fam.founders; i++) {
    const h = lowbias32(seed * 31 + i);
    founders.push({ x: h % W, y: (h >>> 12) % W, radius: p.world.founderRadius, genome: generalistGenome(cfg.defaultMu, cfg.defaultSigma), biomass: p.world.founderBiomass, energy: p.world.founderEnergy });
  }
  return buildWorld(cfg, { nutrient: fam.nutrient, founders });
}

/** Cell index of the heaviest cell (B+P), ties to the lowest index. */
export function heaviestCell(s: WorldState): { x: number; y: number } {
  const n = cellCount(s.cfg), W = worldW(s.cfg);
  let best = -1, bi = 0;
  for (let i = 0; i < n; i++) {
    const m = s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
    if (m > best) {
      best = m;
      bi = i;
    }
  }
  return { x: bi % W, y: Math.floor(bi / W) };
}

/** The cell farthest (wrapped squared distance) from every living cell; ties to the lowest index. If nothing lives, the world centre. */
export function emptiestCell(s: WorldState): { x: number; y: number } {
  const n = cellCount(s.cfg), W = worldW(s.cfg), H = n / W;
  const live: number[] = [];
  for (let i = 0; i < n; i++) if (isLiving(s, i)) live.push(i);
  if (live.length === 0) return { x: W >> 1, y: H >> 1 };
  let best = -1, bi = 0;
  for (let i = 0; i < n; i++) {
    const x = i % W, y = Math.floor(i / W);
    let d = Infinity;
    for (const j of live) {
      const dx = Math.min(Math.abs(x - (j % W)), W - Math.abs(x - (j % W)));
      const dy = Math.min(Math.abs(y - Math.floor(j / W)), H - Math.abs(y - Math.floor(j / W)));
      d = Math.min(d, dx * dx + dy * dy);
    }
    if (d > best) {
      best = d;
      bi = i;
    }
  }
  return { x: bi % W, y: Math.floor(bi / W) };
}

export function taskOpFor(m: MechanismSpec, at: { x: number; y: number } | null): TaskOp {
  if (m.kind === "none") return { kind: "none" };
  const x = at!.x, y = at!.y, r = m.r!;
  return m.kind === "lesion" ? { kind: "lesion", x, y, r } : { kind: m.kind, x, y, r, amount: m.amount! };
}

export interface ArmRecord {
  caseId: string;
  mechanismId: string;
  effect: Record<ReadoutId | DiagnosticId, number>;
  treated: Record<ReadoutId | DiagnosticId, number>;
  control: Record<ReadoutId | DiagnosticId, number>;
  /** Hash of the treated arm's end state; for the sham equals the control's. */
  treatedHash: string;
  applied: { kind: string; deliveredMatter: number; refused: string | null; radius: number }[];
  energyResidual: string;
  matterResidual: string;
}
export interface FamilyResult {
  familyId: string;
  historyId: string;
  seed: number;
  envelopes: PredictionEnvelope[];
  arms: ArmRecord[];
  controlHash: string;
  /** Hashes compared between instrumented and plain history runs, and how many sampled steps they covered. */
  neutralityChecks: number;
  /** Simulated cell-steps spent on this family, every arm and check included. */
  cellSteps: number;
}

export const caseIdOf = (familyId: string, mechanismId: string): string => "c" + sha256Text(`${familyId}|${mechanismId}`).slice(0, 12);

/** Runs one family. `variantSeed` replaces the family's seed (for the cross-seed stability check); the family id stays. */
export function runFamily(p: FixtureProtocol, fam: FamilySpec, variantSeed?: number, hooks?: FixtureHooks): FamilyResult {
  const planned = plannedCellSteps(p);
  const seed = variantSeed ?? fam.seed;
  const { forkStep: C, delta, horizon: H, censusEvery, frameSteps } = p.window;
  const n = cellCount(makeWorld(p, fam, seed).cfg);
  let cellSteps = 0;
  const world0 = makeWorld(p, fam, seed);
  const startTotals = totalsOf(world0.cfg, world0.cells);

  // The sampled steps: every census step, plus the frame steps (all <= C).
  const sampled = [...new Set([...Array.from({ length: Math.floor(C / censusEvery) }, (_, i) => (i + 1) * censusEvery), ...frameSteps, C])].sort((a, b) => a - b);

  // Instrumented history.
  const inst = new RefSim(cloneState(world0));
  const census = [censusPoint(inst.state, livingCells(inst.state), freeNutrient(inst.state), totalMass(inst.state))];
  const frames = frameSteps.includes(0) ? [frameOf(inst.state)] : [];
  const instHash: string[] = [];
  for (const t of sampled) {
    inst.run(t - inst.state.step);
    hooks?.observer?.(inst.state, t, "history");
    if (t % censusEvery === 0) census.push(censusPoint(inst.state, livingCells(inst.state), freeNutrient(inst.state), totalMass(inst.state)));
    if (frameSteps.includes(t)) frames.push(frameOf(inst.state));
    instHash.push(stateHash(inst.state));
  }
  cellSteps += C * n;
  // Plain history: hashes only.
  const plain = new RefSim(cloneState(world0));
  const plainHash: string[] = [];
  for (const t of sampled) {
    plain.run(t - plain.state.step);
    plainHash.push(stateHash(plain.state));
  }
  cellSteps += C * n;
  for (let i = 0; i < sampled.length; i++) if (instHash[i] !== plainHash[i]) throw new Error(`observer neutrality failed for ${fam.id} at step ${sampled[i]}`);
  const forkState = plain.state;

  const historyId = `${fam.id}:s${seed}`;
  // Control arm.
  const ctl = new CpuInterventionAdapter(forkState, startTotals);
  ctl.advanceTo(C + H);
  cellSteps += H * n;
  checkBooks(ctl, `${fam.id} control`);
  const control = { bodyMass: totalMass(ctl.state), livingCells: livingCells(ctl.state), freeNutrient: freeNutrient(ctl.state) };
  const controlHash = stateHash(ctl.state);
  cellSteps += twinCheck(forkState, startTotals, null, C, C + H, censusEvery, controlHash, `${fam.id} control`, hooks) * n;

  const occupied = heaviestCell(forkState), empty = emptiestCell(forkState);
  const envelopes: PredictionEnvelope[] = [];
  const arms: ArmRecord[] = [];
  for (const m of p.mechanisms) {
    const at = m.where === "occupied" ? occupied : m.where === "empty" ? empty : null;
    const op = taskOpFor(m, at);
    const task: Task = { subject: "world", op, delta, readout: "bodyMass", forkStep: C, horizon: H };
    const env = sealEnvelope({
      version: 1,
      caseId: caseIdOf(fam.id, m.id),
      historyId,
      familyId: fam.id,
      ruleVersion: RULE_VERSION,
      config: inst.cfg,
      census,
      frames,
      menu: standardMenu(inst.cfg, delta + 50, p.menu.amountMax, p.menu.rMax),
      task,
    });
    const ts = taskSchedule(env);
    if (ts.errors.length) throw new Error(`fixture ${env.caseId} (${m.id}) is not a valid task: ${ts.errors.join("; ")}`);
    envelopes.push(env);

    const arm = new CpuInterventionAdapter(forkState, startTotals);
    if (ts.schedule) {
      arm.advanceTo(ts.schedule[0].step);
      arm.apply(ts.schedule[0]);
    }
    arm.advanceTo(C + H);
    cellSteps += H * n;
    checkBooks(arm, `${fam.id} ${m.id}`);
    const treated = { bodyMass: totalMass(arm.state), livingCells: livingCells(arm.state), freeNutrient: freeNutrient(arm.state) };
    const treatedHash = stateHash(arm.state);
    cellSteps += twinCheck(forkState, startTotals, ts.schedule ? ts.schedule[0] : null, C, C + H, censusEvery, treatedHash, `${fam.id} ${m.id}`, hooks) * n;
    if (m.kind === "none" && treatedHash !== controlHash) throw new Error(`sham twin differs from control for ${fam.id}`);
    arms.push({
      caseId: env.caseId,
      mechanismId: m.id,
      effect: { bodyMass: treated.bodyMass - control.bodyMass, livingCells: treated.livingCells - control.livingCells, freeNutrient: treated.freeNutrient - control.freeNutrient },
      treated,
      control,
      treatedHash,
      applied: arm.log.map((l) => ({ kind: l.kind, deliveredMatter: l.deliveredMatter, refused: l.refused, radius: l.radius })),
      energyResidual: arm.energyResidual().toString(),
      matterResidual: arm.matterResidual().toString(),
    });
  }
  if (cellSteps !== planned) throw new Error(`${fam.id}: simulated ${cellSteps} cell-steps, planned ${planned}`);
  return { familyId: fam.id, historyId, seed, envelopes, arms, controlHash, neutralityChecks: sampled.length + 1 + p.mechanisms.length, cellSteps };
}

/**
 * Observer neutrality through the endpoint (C+H), not just to C: an independent continuation from the fork with the same schedule,
 * advanced in observer-sized chunks with census/frame/readout instrumentation switched on, must end on the same full-state hash as
 * the plain arm. Returns the steps simulated (to be multiplied by the cell count).
 */
export function twinCheck(fork: WorldState, startTotals: { matter: bigint; energy: bigint }, op: ScheduledIntervention | null, from: number, end: number, every: number, plainFinalHash: string, what: string, hooks?: FixtureHooks): number {
  const tw = new CpuInterventionAdapter(fork, startTotals);
  const stops = new Set<number>([end]);
  for (let t = from + every; t < end; t += every) stops.add(t);
  if (op) stops.add(op.step);
  const observe = (): void => {
    const s = tw.state;
    censusPoint(s, livingCells(s), freeNutrient(s), totalMass(s));
    frameOf(s);
    hooks?.observer?.(s, s.step, "continuation");
  };
  for (const t of [...stops].sort((a, b) => a - b)) {
    tw.advanceTo(t);
    observe();
    if (op && t === op.step) {
      tw.apply(op);
      observe();
    }
  }
  const h = stateHash(tw.state);
  if (h !== plainFinalHash) throw new Error(`observer neutrality failed for ${what}: instrumented continuation ends on ${h}, plain on ${plainFinalHash}`);
  return end - from;
}

export function checkBooks(a: Pick<CpuInterventionAdapter, "energyResidual" | "matterResidual">, what: string): void {
  if (a.energyResidual() !== 0n) throw new Error(`${what}: energy ledger residual ${a.energyResidual()}`);
  if (a.matterResidual() !== 0n) throw new Error(`${what}: matter residual ${a.matterResidual()}`);
}

/** Label of an effect against a minimum effect in the readout's own unit. Inclusive at the boundary: an effect of exactly +minEffect is "up", exactly -minEffect is "down" (stated in PLAN.md, amendment 1). */
export function labelOf(effect: number, minEffect: number): Direction3 {
  return effect >= minEffect ? "up" : effect <= -minEffect ? "down" : "none";
}

export const recipeOf = (p: FixtureProtocol, fam: FamilySpec, seed: number): Record<string, unknown> => ({ family: fam, seed, world: p.world, window: p.window, menu: p.menu, mechanisms: p.mechanisms });
export const recipeHash = (r: unknown): string => sha256Text(canonical(r));
