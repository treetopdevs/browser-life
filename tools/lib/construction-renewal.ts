// Renewal experiment v1 (experiments/construction/RENEWAL-PLAN.md): protocol
// validation, case enumeration and initialization. Nothing here steps a world.
import {
  b2,
  cellCount,
  CH,
  type Genome,
  genomeFromHex,
  genomeHex,
  OUT,
  totalsOf,
  validateConfig,
  validateState,
  type WorldConfig,
  type WorldState,
  worldW,
} from "@bl/schema";
import { constructionWorld } from "./construction.ts";

export type ArmId = "builder" | "matched" | "selected" | "ablation";
export type Phase = "controls" | "pilot" | "confirmation";
export type CaseKind = "capacity" | "division" | "small-founder" | "main";

export interface Founder {
  x: number;
  y: number;
  biomass: number;
  energy: number;
}

export interface ArmSpec {
  id: ArmId;
  genome: "witness" | "selected";
  buildBias?: { from: number; to: number };
  polymerTransport?: false;
  description: string;
}

export interface RenewalProtocol {
  id: string;
  protocolVersion: number;
  plan: { path: string; sha256: string };
  inputs: { witness: { path: string; sha256: string }; selected: { path: string; sha256: string } };
  configPolicy: { overrides: string[]; required: Record<string, unknown>; absent: string[] };
  arms: ArmSpec[];
  seeds: { controls: number; pilot: number; confirmation: number[] };
  reservoirLevels: number[];
  spreads: number[];
  censusEvery: number;
  checkpointSteps: number[];
  phases: {
    controls: ControlSpec[];
    pilot: { arms: ArmId[]; founder: Founder; spreads: number[]; reservoirLevels: number[]; horizon: number };
    confirmation: {
      arms: ArmId[];
      eligibleSpreads: number[];
      selectionOrder: { reservoir: number; spread: number }[];
      horizon: number;
      blocks: number;
      blocksRequired: number;
    };
  };
  endpoints: {
    V: number;
    Qmin: number;
    Rmin: number;
    mainWindow: { from: number; to: number };
    controlWindow: { from: number; to: number };
    censusesPerWindow: number;
  };
  budget: {
    pilotControlHistories: number;
    confirmationHistories: number;
    initialSteps: number;
    maxScientificSteps: number;
    verificationSteps: number;
  };
  verification: { replayCases: string[]; backends: string[] };
}

export type ControlSpec =
  | { kind: "capacity" | "division"; arm: ArmId; spread: number; horizon: number; reservoirLevels: number[]; founders: Founder[] }
  | {
    kind: "small-founder";
    arm: ArmId;
    spreads: number[];
    horizon: number;
    reservoirLevels: number[];
    site: { x: number; y: number };
    founderSizes: { biomass: number; energy: number }[];
  };

export interface CaseSpec {
  id: string;
  phase: Phase;
  kind: CaseKind;
  arm: ArmId;
  seed: number;
  reservoir: number;
  spread: number;
  horizon: number;
  /** In placement order; lineage ids are 1, 2, ... in this order. */
  founders: Founder[];
  /** Cell indices of the founders, the fixed observation masks. */
  sourceSites: number[];
  /** Habitat key shared by paired arms: phase, reservoir, spread, seed. */
  habitat: string;
}

export interface RenewalInputs {
  witness: { genomeHex: string; cfg: WorldConfig };
  selected: { genome: string };
}

const OPTIONAL_KEYS = [
  "polymerTransport",
  "polymerDrag",
  "adhesion",
  "kAdhesion",
  "migrationPeriod",
  "migrantCount",
  "ringNamespace",
  "pondPeriod",
  "pondK",
  "pondArm",
];

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const caseId = (c: Omit<CaseSpec, "id" | "sourceSites" | "habitat">): string => {
  if (c.kind === "main") {
    const seedPart = c.phase === "confirmation" ? `-seed${c.seed}` : "";
    return `${c.phase}-${c.arm}-A${c.reservoir}-s${c.spread}${seedPart}`;
  }
  if (c.kind === "small-founder") return `control-small-B${c.founders[0].biomass}-A${c.reservoir}-s${c.spread}`;
  return `control-${c.kind}-A${c.reservoir}`;
};

function finish(c: Omit<CaseSpec, "id" | "sourceSites" | "habitat">, W: number): CaseSpec {
  return {
    ...c,
    id: caseId(c),
    sourceSites: c.founders.map((f) => f.y * W + f.x),
    habitat: `${c.phase}/A${c.reservoir}/s${c.spread}/seed${c.seed}`,
  };
}

/** The 16 controls followed by the 24 main-pilot cases, in execution order. */
export function enumerateInitialCases(p: RenewalProtocol, W = 32): CaseSpec[] {
  const out: CaseSpec[] = [];
  for (const ctl of p.phases.controls) {
    if (ctl.kind === "small-founder") {
      for (const size of ctl.founderSizes) {
        for (const reservoir of ctl.reservoirLevels) {
          for (const spread of ctl.spreads) {
            out.push(finish({
              phase: "controls",
              kind: "small-founder",
              arm: ctl.arm,
              seed: p.seeds.controls,
              reservoir,
              spread,
              horizon: ctl.horizon,
              founders: [{ x: ctl.site.x, y: ctl.site.y, ...size }],
            }, W));
          }
        }
      }
    } else {
      for (const reservoir of ctl.reservoirLevels) {
        out.push(finish({
          phase: "controls",
          kind: ctl.kind,
          arm: ctl.arm,
          seed: p.seeds.controls,
          reservoir,
          spread: ctl.spread,
          horizon: ctl.horizon,
          founders: ctl.founders.map((f) => ({ ...f })),
        }, W));
      }
    }
  }
  const pilot = p.phases.pilot;
  for (const reservoir of pilot.reservoirLevels) {
    for (const spread of pilot.spreads) {
      for (const arm of pilot.arms) {
        out.push(finish({
          phase: "pilot",
          kind: "main",
          arm,
          seed: p.seeds.pilot,
          reservoir,
          spread,
          horizon: pilot.horizon,
          founders: [{ ...pilot.founder }],
        }, W));
      }
    }
  }
  return out;
}

/** The 20 confirmation cases for one selected habitat, block (seed) by block. */
export function enumerateConfirmationCases(
  p: RenewalProtocol,
  habitat: { reservoir: number; spread: number },
  W = 32,
): CaseSpec[] {
  const conf = p.phases.confirmation;
  if (!conf.selectionOrder.some((h) => h.reservoir === habitat.reservoir && h.spread === habitat.spread)) {
    throw new Error(`habitat A${habitat.reservoir}/s${habitat.spread} is not in the frozen selection order`);
  }
  const out: CaseSpec[] = [];
  for (const seed of p.seeds.confirmation) {
    for (const arm of conf.arms) {
      out.push(finish({
        phase: "confirmation",
        kind: "main",
        arm,
        seed,
        reservoir: habitat.reservoir,
        spread: habitat.spread,
        horizon: conf.horizon,
        founders: [{ ...p.phases.pilot.founder }],
      }, W));
    }
  }
  return out;
}

export function stepBudget(cases: CaseSpec[]): number {
  return cases.reduce((s, c) => s + c.horizon, 0);
}

/** Checks the protocol's internal arithmetic against the plan's fixed matrix and budget. */
export function validateProtocol(p: RenewalProtocol): string[] {
  const errs: string[] = [];
  const initial = enumerateInitialCases(p);
  const controls = initial.filter((c) => c.phase === "controls");
  const pilot = initial.filter((c) => c.phase === "pilot");
  if (controls.length !== 16) errs.push(`expected 16 controls, got ${controls.length}`);
  if (pilot.length !== 24) errs.push(`expected 24 main-pilot cases, got ${pilot.length}`);
  if (initial.length !== p.budget.pilotControlHistories) errs.push("pilot/control history cap mismatch");
  if (stepBudget(initial) !== p.budget.initialSteps) errs.push(`initial steps ${stepBudget(initial)} != ${p.budget.initialSteps}`);
  const conf = enumerateConfirmationCases(p, p.phases.confirmation.selectionOrder[0]);
  if (conf.length !== p.budget.confirmationHistories) errs.push("confirmation history cap mismatch");
  if (stepBudget(initial) + stepBudget(conf) !== p.budget.maxScientificSteps) errs.push("maximum scientific steps mismatch");
  const replaySteps = p.verification.replayCases.length * p.verification.backends.length * p.phases.pilot.horizon;
  if (replaySteps !== p.budget.verificationSteps) errs.push(`verification steps ${replaySteps} != ${p.budget.verificationSteps}`);
  for (const id of p.verification.replayCases) if (!pilot.some((c) => c.id === id)) errs.push(`replay case ${id} is not a pilot case`);
  if (new Set(initial.map((c) => c.id)).size !== initial.length) errs.push("duplicate case ids");
  const allSeeds = [p.seeds.controls, p.seeds.pilot, ...p.seeds.confirmation];
  if (new Set(p.seeds.confirmation).size !== p.seeds.confirmation.length) errs.push("duplicate confirmation seed");
  if (p.seeds.confirmation.includes(p.seeds.pilot)) errs.push("confirmation reuses the pilot seed");
  for (const s of allSeeds) if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) errs.push(`invalid seed ${s}`);
  for (const h of p.phases.confirmation.selectionOrder) {
    if (!p.phases.confirmation.eligibleSpreads.includes(h.spread)) errs.push("selection order contains an ineligible spread");
  }
  const e = p.endpoints;
  for (const w of [e.mainWindow, e.controlWindow]) {
    if ((w.to - w.from) / p.censusEvery + 1 !== e.censusesPerWindow) errs.push("window census count mismatch");
  }
  if (p.arms.map((a) => a.id).join() !== "builder,matched,selected,ablation") errs.push("arms must be builder, matched, selected, ablation");
  return errs;
}

/** Resolved configuration: the witness cfg with only seed, spread and (ablation) polymerTransport overridden. */
export function resolveConfig(
  p: RenewalProtocol,
  inputs: RenewalInputs,
  c: Pick<CaseSpec, "seed" | "spread" | "arm">,
): WorldConfig {
  const base = inputs.witness.cfg as unknown as Record<string, unknown>;
  for (const key of OPTIONAL_KEYS) if (key in base) throw new Error(`witness cfg unexpectedly carries ${key}`);
  for (const key of p.configPolicy.absent) if (key in base) throw new Error(`witness cfg carries forbidden key ${key}`);
  const arm = armSpec(p, c.arm);
  const overrides: Record<string, unknown> = { seed: c.seed, spread: c.spread };
  if (arm.polymerTransport === false) overrides.polymerTransport = false;
  for (const key of Object.keys(overrides)) {
    if (!p.configPolicy.overrides.includes(key)) throw new Error(`unspecified override ${key}`);
  }
  const cfg = { ...base, ...overrides } as unknown as WorldConfig;
  for (const [key, value] of Object.entries(p.configPolicy.required)) {
    if ((cfg as unknown as Record<string, unknown>)[key] !== value) throw new Error(`config ${key} must be ${value}`);
  }
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid resolved config: ${errs.join("; ")}`);
  return cfg;
}

export function armSpec(p: RenewalProtocol, id: ArmId): ArmSpec {
  const arm = p.arms.find((a) => a.id === id);
  if (!arm) throw new Error(`unknown arm ${id}`);
  return arm;
}

export function armGenome(p: RenewalProtocol, inputs: RenewalInputs, id: ArmId): Genome {
  const arm = armSpec(p, id);
  const genome = genomeFromHex(arm.genome === "witness" ? inputs.witness.genomeHex : inputs.selected.genome);
  if (arm.buildBias) {
    const k = b2(OUT.BUILD);
    if (genome.weights[k] !== arm.buildBias.from) {
      throw new Error(`matched comparator expects b2(OUT.BUILD) = ${arm.buildBias.from}, found ${genome.weights[k]}`);
    }
    genome.weights[k] = arm.buildBias.to;
  }
  return genome;
}

/** Number of differing bytes between two genome hex strings of equal length. */
export function genomeByteDiff(a: string, b: string): number[] {
  if (a.length !== b.length) throw new Error("genome lengths differ");
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 2) if (a.slice(i, i + 2) !== b.slice(i, i + 2)) out.push(i / 2);
  return out;
}

/** Exact initial state of one case: founders by placement order, then A = reservoir in every cell. */
export function initialState(p: RenewalProtocol, inputs: RenewalInputs, c: CaseSpec): WorldState {
  const cfg = resolveConfig(p, inputs, c);
  const genome = armGenome(p, inputs, c.arm);
  const s = constructionWorld(cfg, c.founders.map((f) => ({ ...f, genome })));
  const n = cellCount(cfg);
  if (worldW(cfg) * cfg.tileH !== n) throw new Error("unexpected world shape");
  for (let i = 0; i < n; i++) {
    if (s.cells[CH.A * n + i] !== 0) throw new Error("constructionWorld supplied nutrient");
    s.cells[CH.A * n + i] = c.reservoir;
  }
  const errs = validateState(s);
  if (errs.length) throw new Error(`invalid initial state ${c.id}: ${errs.join("; ")}`);
  return s;
}

/** Expected initial totals from the plan's resource table (section 4). */
export function expectedTotals(p: RenewalProtocol, inputs: RenewalInputs, c: CaseSpec): { B: bigint; E: bigint; matter: bigint; energy: bigint } {
  const cfg = resolveConfig(p, inputs, c), n = BigInt(cfg.tileW * cfg.tileH);
  const B = c.founders.reduce((s, f) => s + BigInt(f.biomass), 0n);
  const E = c.founders.reduce((s, f) => s + BigInt(f.energy), 0n);
  const A = n * BigInt(c.reservoir);
  return { B, E, matter: A + B, energy: A * BigInt(cfg.eA) + B * BigInt(cfg.eB) + E };
}

/** Throws unless paired arms in one habitat start from byte-identical cell arrays. */
export function checkPairedArrays(states: { spec: CaseSpec; state: WorldState }[]): void {
  const byHabitat = new Map<string, { spec: CaseSpec; state: WorldState }[]>();
  for (const s of states) {
    if (s.spec.kind !== "main") continue;
    const list = byHabitat.get(s.spec.habitat) ?? [];
    list.push(s);
    byHabitat.set(s.spec.habitat, list);
  }
  for (const [habitat, list] of byHabitat) {
    const ref = list[0].state.cells;
    for (const { spec, state } of list) {
      if (state.cells.length !== ref.length || !state.cells.every((v, i) => v === ref[i])) {
        throw new Error(`initial cell arrays differ within ${habitat} (${spec.id})`);
      }
      const t = totalsOf(state.cfg, state.cells), r = totalsOf(list[0].state.cfg, ref);
      if (t.matter !== r.matter || t.energy !== r.energy) throw new Error(`initial totals differ within ${habitat}`);
    }
  }
}

export function genomeHexOf(p: RenewalProtocol, inputs: RenewalInputs, id: ArmId): string {
  return genomeHex(armGenome(p, inputs, id));
}

/** Bindings this module uses, for the frozen launch's module-identity check. */
export const RENEWAL_LIB_BINDINGS: [unknown, string, string][] = [
  [constructionWorld, "tools/lib/construction.ts", "constructionWorld"],
  [validateState, "packages/schema/src/index.ts", "validateState"],
  [genomeFromHex, "packages/schema/src/index.ts", "genomeFromHex"],
  [totalsOf, "packages/schema/src/index.ts", "totalsOf"],
];
