import type { Intervention, WorldConfig, InitParams, PondArm, PondScore, PondTerm } from "@bl/schema";
import type { GpuViewMode, ViewRect } from "@bl/sim-gpu";
import type { ObserverSettings } from "@bl/runner";
import type { LineageView } from "@bl/lineage";

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
  /**
   * Lineage inspector fields, absent on older checkpoints: `edges`, how many mutation edges the checkpoint's
   * sidecar (`<file>.edges`) holds; `dropped`, the events its ledger had dropped by then; `edgesFrom`, the step
   * from which those edges are complete. `auto`: saved automatically.
   */
  checkpoints: { step: number; file: string; hash: string; interventions: number; edges?: number; dropped?: number; edgesFrom?: number; auto?: boolean }[];
  /** Observation settings for this run's tracker/activity state (see `@bl/runner`'s `ObserverState`). */
  settings: ObserverSettings;
  /** stateHash of the world this run started from, when it was built here: its founders' genomes can be rebuilt. */
  startHash?: string;
  /** The step from which this run's mutation edges are complete: 0, or where it was loaded from a file. */
  edgesFrom?: number;
}

export interface CheckpointMeta {
  file: string;
  runId: string;
  step: number;
  bytes: number;
  savedAt: string;
  /** Saved automatically (kept for jumping back; the oldest are pruned). */
  auto?: boolean;
}

/** Save the present first, or replace the Lab world and drop what a Checkpoint does not cover. */
export type Keep = "save" | "discard";

export type SessionCommand = "save" | "plant" | "restore" | "jump" | "deleteCheckpoint" | "export" | "import";

/** The latest Replay twin check. `handAtEnd` means a hand edit was logged at `to`. */
export interface ReplayReading {
  ok: boolean;
  from: number;
  to: number;
  live: string;
  twin: string;
  handAtEnd: boolean;
}

/**
 * The Lab session: which Checkpoints cover the Lab world on screen, what replacing it would lose,
 * and whether the latest Replay twin reading still describes it. The page paints this and does not keep another.
 */
export interface SessionView {
  /** Increments when a Lab world is adopted. */
  epoch: number;
  world: null | { runId: string; presetId: string; seed: number; step: number; ruleVersion: number };
  /** Null when a Checkpoint covers the settled step and every hand edit. */
  loss: null | { text: string; hand: number; step: number; coveredStep: number };
  /** Hand edits since this Lab world was adopted that no manual Checkpoint holds. */
  hand: number;
  checkpoints: CheckpointMeta[];
  /** A waiting pond cycle refused this command. The Lab world is usable. */
  refusal: null | { command: SessionCommand; message: string };
  failure: null | string;
  /** plant, restore, or import left this Lab world in place because `loss` was set and `keep` was omitted. */
  held: null | "plant" | "restore" | "import";
  /** A jump wrote this manual Checkpoint of the pre-jump Lab world. */
  keptPresent: null | { file: string; step: number };
  replay: ReplayReading | null;
  /** A Replay twin check is in flight. The previous reading is cleared. */
  checking: boolean;
  /** A pond cycle is waiting. Told by Lab execution; the session does not decide it. */
  waiting: null | { cycle: number; step: number };
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
  /** Total matter against the ledger's baseline, which each feed moves by what it added (should be 0). */
  matterDelta: string;
  /** Net nutrient this run's logged feeds have added (negative: drained), and how many feeds: the world is closed in matter only between them. */
  fed: string;
  feeds: number;
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
  /** Kernel ring offsets (WorldConfig.shapeReach), present only when some offset is non-zero. */
  rings?: [number, number, number];
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
  /** The donors were given in breeder mode (a person's picks, or the rule's own applied on request) rather than chosen by the cycle itself. */
  hand: boolean;
}

/** Breeder mode: the world has stopped at a pond boundary, before its cycle, and waits for the donors (`ToWorker` "pick"). */
export interface PondAwaitMsg {
  type: "pondAwait";
  /** Which world waits: the worker's number for it, which a "pick" must name back. */
  world: number;
  step: number;
  /** Cycle index b = step / pondPeriod. */
  cycle: number;
  arm: PondArm;
  /** The world's own score (config key pondScore), or null without one. */
  score: PondScore | null;
  /** The donors the world's own rule would choose, in its order. */
  suggested: number[];
  /** Each term's value per pond; a pond whose "mass" is 0 is empty and cannot donate. */
  terms: Record<PondTerm, number[]>;
}

/** One lineage, settled at a census (the lineage inspector's lab panel). */
export interface LineageMsg {
  type: "lineage";
  view: LineageView;
  /** Steps of the current run's checkpoints, the points a jump can restore. */
  checkpoints: number[];
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number }
  | { type: "load"; presetId: string; seed: number; overrides?: Partial<WorldConfig>; keep?: Keep }
  | { type: "play"; playing: boolean }
  | { type: "speed"; stepsPerFrame: number }
  | { type: "step"; count: number }
  | { type: "view"; mode: GpuViewMode; rect: ViewRect }
  | { type: "resize"; width: number; height: number }
  | { type: "lesion"; x: number; y: number; r: number }
  /** Feed (`amount` > 0) or drain (< 0) nutrient in a disc: a logged intervention that changes total matter. */
  | { type: "feed"; x: number; y: number; r: number; amount: number }
  | { type: "probe"; x: number; y: number }
  /** Breeder mode on or off: stop at each pond boundary and wait for "pick". Turning it off lets the rule choose for a cycle that is waiting. */
  | { type: "breeder"; on: boolean }
  /**
   * The donors of the pond cycle that world `world` (`PondAwaitMsg.world`) has waiting at `step`, in order (a logged
   * intervention); null lets the world's own rule choose. Ignored unless that world is current and waits at that
   * step: a repeated or late message never reaches another boundary or another world.
   */
  | { type: "pick"; world: number; step: number; donors: number[] | null }
  | { type: "save" }
  | { type: "listCheckpoints" }
  | { type: "restore"; file: string; keep?: Keep }
  | { type: "deleteCheckpoint"; file: string }
  | { type: "export" }
  | { type: "import"; bytes: ArrayBuffer; name: string; keep?: Keep }
  | { type: "verify"; steps: number }
  | { type: "lineage"; key: string }
  /** Draw this lineage's cells highlighted and dim the rest; null clears. */
  | { type: "highlight"; key: string | null }
  /** Save the present, restore the latest checkpoint at or before `step` and advance to it; then highlight `key`. */
  | { type: "jump"; step: number; key: string | null };

export type FromWorker =
  | { type: "ready"; adapter: string }
  | { type: "error"; message: string }
  | { type: "loaded"; manifest: RunManifest; step: number }
  | StatsMsg
  | CensusMsg
  | ProbeMsg
  | PondsMsg
  | PondAwaitMsg
  | LineageMsg
  | { type: "highlight"; key: string | null }
  | { type: "session"; view: SessionView }
  | { type: "exported"; bytes: ArrayBuffer; name: string }
  | { type: "notice"; message: string }
  /**
   * Request `request` was refused because a pond cycle is waiting for its donors. Not a failure: the world is
   * usable, and whoever made the request (the lineage panel's inspection or jump) must stop waiting for it.
   */
  | { type: "refused"; request: ToWorker["type"]; message: string }
  /** A replay check of `steps` steps from step `from`, which the live world has now run: its state hash and the twin's. */
  | { type: "verify"; ok: boolean; detail: string; from: number; steps: number; live: string; twin: string };
