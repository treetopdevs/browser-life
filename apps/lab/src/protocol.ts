import type { Intervention, WorldConfig, InitParams, PondArm, PondScore, PondTerm } from "@bl/schema";
import type { GpuViewMode, ViewRect } from "@bl/sim-gpu";
import type { ObserverSettings } from "@bl/runner";
import type { LineageView } from "@bl/lineage";
import type { FamilyEvent, FamilySummary, FamilyView, FirstsEntry, FirstsRule, FirstsSummary, NextUpItem } from "@bl/metrics";
import type { KeptPond } from "./pond-play.ts";
import type { SeriesFields } from "./naturalist-series.ts";

export interface RunManifest {
  /** Storage concurrency token; unrelated to physics or replay. Absent on a new run. */
  storageRevision?: string;
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

/**
 * Save the present first, download it first (for a browser that keeps no Checkpoints), or replace the Lab world
 * and drop what a Checkpoint does not cover.
 */
export type Keep = "save" | "download" | "discard";

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
  /** A waiting pond cycle, or the browser's storage, refused this command. The Lab world is usable. */
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
  /**
   * Display only, present only in a world with a polymer shell (`WorldConfig.injuryShell`; docs/pond-keeper-v3-2026-10-22.md,
   * section 3): the living cells at this census, and how many of them hold at least the shell's worth of membrane. A snapshot's
   * eligibility, not a forecast. Not part of any observer state, checkpoint or digest.
   */
  shell?: { wearing: number; living: number };
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
  /** Capability gene bits (WorldConfig.genes), present only in a genes world. */
  genes?: number;
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
  /**
   * The score `suggested` was ranked by: the dial's latest setting for this cycle (`PressureMsg`), else `score`. A cycle that waits
   * is posted again, with the same `step`, when the dial or Keep changes: the new survey replaces the old.
   */
  ruleScore: PondScore | null;
  /** The kept lineage as this pre-cycle state sees it (`ToWorker` "keep"), or null when none is kept. */
  kept: KeptPond | null;
  /** Which survey of the cycle this is (each refresh takes a new one): explicit donors in a "pick" name it back. */
  revision: number;
}

/**
 * The pressure dial of the world on screen (docs/pond-keeper-v1-2026-10-17.md, section 1). Posted when a world is adopted,
 * after the dial is set, and after a replay re-applies a pressure.
 */
export interface PressureMsg {
  type: "pressure";
  /** The worker's number for the world (PondAwaitMsg.world). */
  world: number;
  /** The config's own `pondScore`, or null. */
  base: PondScore | null;
  /** The score that governs the next cycle to be applied (the waiting cycle, else the next boundary); equals `base` before any pressure. */
  current: PondScore | null;
  /** The cycle of the latest pressure in force, or null when none. */
  fromCycle: number | null;
  /** How many pressures this history holds. */
  changes: number;
  /** Why the dial is unavailable (plain words), or null: the world's arm is not "breed". */
  unavailable: string | null;
}

/** One lineage, settled at a census (the lineage inspector's lab panel). */
export interface LineageMsg {
  type: "lineage";
  view: LineageView;
  /** Steps of the current run's checkpoints, the points a jump can restore. */
  checkpoints: number[];
}

/** What the session card says about the log of interventions and the picks (computed in the worker; the page only paints). */
export interface SessionFacts {
  /**
   * Pond cycles resolved by a pick in the log. The log does not say who chose, so the worker keeps a note beside it:
   * `byHand` is a pick whose donors differ from the rule's order for that cycle (a person's picks equal to the rule's
   * count as the rule's own), `byRule` one the rule chose, `unknown` a pick whose chooser no record says (a world opened
   * from a file, or restored from a checkpoint saved before its log was kept beside it, or whose sidecar is torn).
   */
  picks: { total: number; byHand: number; byRule: number; unknown: number };
  wounds: number;
  /** Feeds that added nutrient / drains that took it out. */
  feeds: number;
  drains: number;
  /**
   * Suns set in the log (kind "sun"), present only when there is one: no session file holds a sun yet (`exportRefusal`), so a
   * file's facts never carry the key, and the Session card shows the count.
   */
  suns?: number;
  /** The latest Replay twin check, as the session view holds it. */
  replay: ReplayReading | null;
  /** The world's step when these facts were taken: a replay check that ends before it covers an earlier stretch. */
  step: number;
  /** Pond boundaries whose cycle has run (or, for arm cont, been recorded) in the history this page holds, with or without a pick; 0 without ponds. */
  cycles: number;
  /** Pressures in the log (the pond keeper's dial), and the score of the latest one. */
  pressures: { changes: number; latest: PondScore | null };
  /** Pond cycles before that history (a world opened from a file mid-run): who chose their donors is not known here. */
  cyclesBefore: number;
  /**
   * The family tree's counts (rule set `families-v1`): families named (starting and split, and any root first seen later),
   * how many of each kind, and how many are living, gone to film and extinct. All 0 before the tree has watched a census.
   */
  families: Omit<FamilySummary, "rules" | "watchedFrom" | "step">;
}

/**
 * The log of firsts of the world on screen, in full. Posted when a world is adopted, whenever an entry fires, with
 * each displayed census, and after a wound, feed, pick or replay check (the card's counts change then too).
 */
export interface FirstsMsg {
  type: "firsts";
  /** The worker's number for the world (PondAwaitMsg.world). */
  world: number;
  /** watchedFrom is the first census after a plant (== settings.censusEvery): the page says "watching since t=…" when this is false. */
  fromStart: boolean;
  entries: FirstsEntry[];
  summary: FirstsSummary;
  facts: SessionFacts;
  rules: FirstsRule[];
  /** The first rungs of the ladder not yet reached, each with its progress (`nextUp` in `@bl/metrics`). */
  nextUp: NextUpItem[];
  /**
   * The log stopped (a detector or tree error); entries stay as they were and export is refused. A tree that stopped alone (a dropped
   * ledger record) leaves this null: `refusal` says whether a session file can be made.
   */
  stopped: string | null;
  /** Why a session file can't be made from this log (`logRefusal`: a stopped log or a stopped tree), or null. */
  refusal: string | null;
}

/**
 * The family tree of the world on screen (`FamilyTree` in `@bl/metrics`, docs/pond-keeper-v2-2026-10-17.md section 3), in full.
 * Posted right after every `FirstsMsg` (same moments, same throttling: when a world is adopted, whenever an entry or a family
 * event fires, with each displayed census, and while paused after a step), so a page that handles both always sees them
 * for the same census. `world` is the same number as `FirstsMsg.world`.
 */
export interface FamiliesMsg {
  type: "families";
  world: number;
  /** The latest census the tree has watched, or null before the first (`summary.step`). */
  step: number | null;
  /**
   * Every family in tree order (parents before children, siblings by founding step): name, founding lineage, parent, status,
   * cells, bodies, purity (a fraction, null with no body) and share of the jar's living cells. `depth` indents the tree.
   */
  families: FamilyView[];
  /** The tree's log, oldest first (the page shows it newest first): splits, gone to film, back from film, extinct, and roots found later. */
  events: FamilyEvent[];
  summary: FamilySummary;
  /** Whether the tree watched from the first census after a plant: when false the page says "watching since t=…" (`summary.watchedFrom`). */
  fromStart: boolean;
  /**
   * Why the tree stopped (a ledger record was dropped while it watched, or a tree error), or null. The tree then keeps what it had, the
   * log of firsts goes on without its family input unless `FirstsMsg.stopped` says it stopped too, and a session file is refused.
   */
  stopped: string | null;
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number }
  | { type: "load"; presetId: string; seed: number; overrides?: Partial<WorldConfig>; keep?: Keep }
  | { type: "play"; playing: boolean }
  | { type: "speed"; stepsPerFrame: number }
  | { type: "step"; count: number }
  | { type: "view"; mode: GpuViewMode; rect: ViewRect }
  | { type: "resize"; width: number; height: number }
  /**
   * A wound in a disc. `world`, when set (Field notes' Try it here names the world its suggestion was made for), is the worker's
   * number for the world (`loaded`'s world): a lesion or feed for a world since replaced is refused (`refused` with its request)
   * and changes nothing. The brush omits it and edits whatever world is on screen when the message is handled.
   */
  | { type: "lesion"; x: number; y: number; r: number; world?: number }
  /** Feed (`amount` > 0) or drain (< 0) nutrient in a disc: a logged intervention that changes total matter. `world` as for "lesion". */
  | { type: "feed"; x: number; y: number; r: number; amount: number; world?: number }
  /**
   * A sun (@bl/schema's sun.ts, docs/garden-sun-2026-10-18.md): from the world's step its light is `percent` of its own (base,
   * amplitude and season) for `span` steps, then its own returns. A logged intervention. Refused (`refused` with request "sun")
   * when the world's light cannot take it or a sun already shines. `world` as for "lesion".
   */
  | { type: "sun"; percent: number; span: number; world?: number }
  | { type: "probe"; x: number; y: number }
  /** Breeder mode on or off: stop at each pond boundary and wait for "pick". Turning it off lets the rule choose for a cycle that is waiting. */
  | { type: "breeder"; on: boolean }
  /**
   * The donors of the pond cycle that world `world` (`PondAwaitMsg.world`) has waiting at `step`, in order (a logged
   * intervention). Explicit donors name the survey they were chosen from (`PondAwaitMsg.revision`): a pick from a survey the
   * dial or Keep has since replaced is refused (`refused` with request "pick"), and the cycle waits on. null lets the
   * world's own rule choose; with `withKeep`, the rule's choice as Keep adjusts it, read from the survey that waits when the
   * pick is applied (auto-breed's answer). Ignored unless that world is current and waits at that step: a repeated or late
   * message never reaches another boundary or another world.
   */
  | { type: "pick"; world: number; step: number; donors: number[]; revision: number }
  | { type: "pick"; world: number; step: number; donors: null; withKeep?: boolean }
  /**
   * Set the pressure dial of world `world` (`PressureMsg.world`): from the next cycle to be applied (the waiting one, if one
   * waits) the rule ranks donors by `score`. A logged intervention. Dropped for a world since replaced; refused (`refused`
   * with request "pressure") for a world whose arm is not breed, a failed world or a score that is not one. A score already
   * governing the next cycle is a no-op, with a notice.
   */
  | { type: "pressure"; world: number; score: PondScore }
  /**
   * The lineage to keep (genome identity key, "hi:lo"), or null to clear, asked of world `world` (the `keep` or `pressure`
   * message's world): dropped for a world since replaced. A lab setting like "breeder": a new plant or an import clears it, a
   * restore or jump keeps it.
   */
  | { type: "keep"; world: number; key: string | null }
  | { type: "save" }
  | { type: "listCheckpoints" }
  | { type: "restore"; file: string; keep?: Keep }
  | { type: "deleteCheckpoint"; file: string }
  | { type: "export" }
  /** The session file: the world settled at its census, its history and its firsts, as JSON (`FromWorker` "sessionFile"). A refusal arrives as `refused` with this request. */
  /** `world`: the worker's number for the world the card shows (`FirstsMsg.world`); a request for a world since replaced is refused. */
  | { type: "sessionExport"; world: number; id: number }
  | { type: "import"; bytes: ArrayBuffer; name: string; keep?: Keep }
  | { type: "verify"; steps: number }
  | { type: "lineage"; key: string }
  /** Draw this lineage's cells highlighted and dim the rest; null clears. */
  | { type: "highlight"; key: string | null }
  /** Save the present, restore the latest checkpoint at or before `step` and advance to it; then highlight `key`. */
  | { type: "jump"; step: number; key: string | null };

/**
 * One census of a world the naturalist may hold a baseline for (naturalist-series.ts NATURALIST_PRESETS), every census, unthrottled:
 * the series record the runner would write, the census's lineage rows, the earliest logged intervention's step (null when none),
 * and the mutation records its ledger drain lost. `world` and `runId` say which world and history it is of.
 */
export interface NaturalistMsg {
  type: "naturalist";
  world: number;
  runId: string;
  step: number;
  rec: SeriesFields;
  rows: [string, number][];
  touched: number | null;
  dropped: number;
}

export type FromWorker =
  /** `storage`: why this browser keeps no Checkpoints here (its own words), or null when it does. Known before any world. */
  | { type: "ready"; adapter: string; storage: string | null }
  /** `failed`: the world itself has failed (its execution's failure, or the GPU device lost) and cannot go on; other errors leave it usable. */
  | { type: "error"; message: string; failed?: boolean }
  /** `world`: the worker's number for the adopted world (the one later messages carry), absent from older senders. */
  | { type: "loaded"; manifest: RunManifest; step: number; world?: number }
  | NaturalistMsg
  /** A wound, feed or drain was just logged at `step` on that world (the naturalist marks its notes without waiting for a census). */
  | { type: "naturalistTouched"; world: number; runId: string; step: number }
  | StatsMsg
  | CensusMsg
  | ProbeMsg
  | PondsMsg
  | PondAwaitMsg
  | PressureMsg
  /** The sun the world `world` runs under (null: its own light), posted when a world is adopted and whenever its light changes. */
  | { type: "sun"; world: number; sun: { step: number; percent: number; span: number } | null }
  /** The kept lineage of the lab (`ToWorker` "keep"), posted when a world is adopted and when it changes; `world` is the one it is posted for. */
  | { type: "keep"; world: number; key: string | null }
  | LineageMsg
  | { type: "highlight"; key: string | null }
  | { type: "session"; view: SessionView }
  | { type: "exported"; bytes: ArrayBuffer; name: string }
  | FirstsMsg
  | FamiliesMsg
  | { type: "sessionFile"; world: number; id: number; text: string; name: string }
  | { type: "notice"; message: string }
  /**
   * Request `request` was refused because a pond cycle is waiting for its donors, or because the browser would not
   * keep or read a Checkpoint. Not a failure: the world is usable, and whoever made the request (the lineage
   * panel's inspection or jump) must stop waiting for it.
   */
  | { type: "refused"; request: ToWorker["type"]; message: string; /** The page's request id, when the request carried one ("sessionExport"). */ id?: number }
  /** A replay check of `steps` steps from step `from`, which the live world has now run: its state hash and the twin's. */
  | { type: "verify"; ok: boolean; detail: string; from: number; steps: number; live: string; twin: string };
