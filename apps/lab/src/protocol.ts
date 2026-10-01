import type { Intervention, WorldConfig, InitParams, PondArm } from "@bl/schema";
import type { GpuViewMode, ViewRect } from "@bl/sim-gpu";
import type { ObserverSettings } from "@bl/runner";

export interface RunManifest {
  runId: string;
  presetId: string;
  seed: number;
  cfg: WorldConfig;
  init: InitParams;
  ruleVersion: number;
  createdAt: string;
  adapter: string;
  userAgent: string;
  interventions: Intervention[];
  checkpoints: { step: number; file: string; hash: string; interventions: number }[];
  /** Observation settings for this run's tracker/activity state (see `@bl/runner`'s `ObserverState`). */
  settings: ObserverSettings;
}

export interface CheckpointMeta {
  file: string;
  runId: string;
  step: number;
  bytes: number;
  savedAt: string;
}

export interface StatsMsg {
  type: "stats";
  step: number;
  stepsPerSec: number;
  fps: number;
  A: number;
  B: number;
  C: number;
  P: number;
  E: number;
  S: number;
  matter: number;
  living: number;
  dense: number;
  lightIn: number;
  heatOut: number;
  /** Exact energy ledger residual (should be 0). */
  residual: string;
  matterDelta: string;
}

export interface CensusMsg {
  type: "census";
  step: number;
  individuals: number;
  meanMass: number;
  lineageCount: number;
  top: { key: string; share: number; color: [number, number, number] }[];
  fissions: number;
  fusions: number;
  births: number;
  deaths: number;
  maxGen: number;
  mutations: number;
}

export interface ProbeMsg {
  type: "probe";
  x: number;
  y: number;
  step: number;
  cells: Record<string, number>;
  lineage: string;
  mu: number;
  sigma: number;
  motGain: number;
  weights: number[];
}

/** Display only: the pond cycle just applied (or, for arm cont, recorded) at `step`. */
export interface PondsMsg {
  type: "ponds";
  step: number;
  /** Cycle index b = step / pondPeriod. */
  cycle: number;
  arm: PondArm;
  /** Donor ponds in selection order; empty for cont and for a cycle with no eligible pond. */
  donors: number[];
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number }
  | { type: "load"; presetId: string; seed: number; overrides?: Partial<WorldConfig> }
  | { type: "play"; playing: boolean }
  | { type: "speed"; stepsPerFrame: number }
  | { type: "step"; count: number }
  | { type: "view"; mode: GpuViewMode; rect: ViewRect }
  | { type: "resize"; width: number; height: number }
  | { type: "lesion"; x: number; y: number; r: number }
  | { type: "probe"; x: number; y: number }
  | { type: "save" }
  | { type: "listCheckpoints" }
  | { type: "restore"; file: string }
  | { type: "deleteCheckpoint"; file: string }
  | { type: "export" }
  | { type: "import"; bytes: ArrayBuffer; name: string }
  | { type: "verify"; steps: number };

export type FromWorker =
  | { type: "ready"; adapter: string }
  | { type: "error"; message: string }
  | { type: "loaded"; manifest: RunManifest; step: number }
  | StatsMsg
  | CensusMsg
  | ProbeMsg
  | PondsMsg
  | { type: "checkpoints"; list: CheckpointMeta[] }
  | { type: "exported"; bytes: ArrayBuffer; name: string }
  | { type: "notice"; message: string }
  | { type: "verify"; ok: boolean; detail: string };
