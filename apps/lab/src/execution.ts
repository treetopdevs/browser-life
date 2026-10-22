// Cadence and observer integrity for one lab world. Callers serialize operations;
// the worker's generation predicate invalidates outstanding work on replacement.
import {
  cloneState, MAX_STEP, POND_TERMS, SUN_SPAN_MAX, sunError, sunLight, type LightParams, pondDonors, pondPickError, pondScoreTerms, pondTermValues, stateHash,
  type FeedResult, type Intervention, type PondScore, type PondTerm, type WorldConfig, type WorldState,
} from "@bl/schema";
import type { GpuSim } from "@bl/sim-gpu";
import { buildFamilyInput, buildFirstsInput, firstsContext, fluxRates, readLineageCells, type Census, type FamilyInput, type FirstsContext, type FirstsExtras, type FirstsInput, type LineageCells } from "@bl/metrics";
import {
  applyBoundary,
  cellsAtBoundary,
  observeCensus,
  pondContext,
  pondContinuationError,
  restoreObservers,
  serializeObservers,
  type BoundaryResult,
  type ObserverSettings,
  type ObserverState,
  type PondContext,
  type PondCycle,
  type PressureEntry,
  activePondScore,
  pressureCycleOf,
  pressureHook,
} from "@bl/runner";
import { MutationEdges } from "@bl/lineage";
import type { CellBirth } from "@bl/sim-ref";
import { donorsWithKeep, isLineageKey, keptPondOf, type KeptPond } from "./pond-play.ts";
import { shellCount, type ShellCount } from "./shell.ts";
import { lineageRows, seriesFields, type SeriesFields } from "./naturalist-series.ts";

/**
 * What a census says to the family tree (`FamilyTree.observe`): its input, and the ledger's parent link for a key. Both read the
 * same census as the log of firsts' input and share its per-cell lineage read; `parentOf` reads the run's edges as they stand.
 */
export interface CensusFamilies {
  input(): FamilyInput;
  parentOf(key: string): string | undefined;
}

/** Real GPU simulation in the worker; reference physics with injectable readbacks in tests. */
export type LabSimulation = Pick<GpuSim, "cfg" | "step" | "run" | "drainLedger" | "readSnapshot" | "readState" | "upload" | "destroy" | "lesion" | "feed"> &
  /** Sets the light (a sun's, or null for the world's own; `GpuSim.setLight`). A simulation without it takes no sun. */
  Partial<Pick<GpuSim, "setLight">>;

/** A sun as the observer carries it (`ObserverState.sun`): the light is the sun's for the steps step .. step + span - 1. */
export type SunSpan = { step: number; percent: number; span: number };

/** Where a traversal keeps the sun of the simulation it walks: the live world's is its observer's, a twin's its own. */
interface SunHold {
  get(): SunSpan | null;
  set(sun: SunSpan | null): void;
}

/** Raised when a sun cannot be set: a world that cannot take it, one already under a sun, a bad span. A refusal: nothing changed. */
export class SunRefusedError extends Error {}
interface ExecutionOptions {
  observer?: ObserverState;
  /** The state the simulation was built from; required for a pond world, whose cycles check against it. */
  start?: WorldState;
  /** The run's mutation edges up to the simulation's step, and the events its ledger has dropped (lineage inspector). */
  lineage?: { edges: MutationEdges; dropped: number };
  /**
   * The pressures of the history this execution continues (the manifest's `pressure` entries up to the simulation's
   * step), in log order: the dial's settings the rule has already been governed by. Only a breeder world has any.
   */
  pressures?: readonly PressureEntry[];
  /** The lineage the person keeps (genome identity key, "hi:lo"), or null/absent: a lab setting, not part of the history. */
  keep?: string | null;
  waitForIdle: () => Promise<unknown>;
  isCurrent: () => boolean;
  /**
   * Display and observers of the host, after a census is committed. `firsts` reads that census into the input of the
   * log of firsts (`@bl/metrics`), with the wounds since the previous census and the family tree's view when given
   * (`extras`); `families` reads the same census into the family tree's input. Both are pure reads sharing one per-cell
   * lineage read of the census's own captured genome words (never a later readback: births a boundary's transforms add
   * count from the next census), and call them synchronously inside this callback, since the tracker they read mutates
   * at the next census. The mutation edges are drained before each census, so `families.parentOf` knows every key minted
   * before it. `dropped`: the ledger records lost in that drain. `shell`: display only (docs/pond-keeper-v3-2026-10-22.md, section 3),
   * the cells of the census's own snapshot that hold at least the world's `injuryShell` of membrane, or null (absent in a
   * world without a shell); it is in no observer state, checkpoint or digest.
   */
  onObservation?: (census: Census, dropped: number, firsts?: (extras?: FirstsExtras) => FirstsInput, families?: CensusFamilies, shell?: ShellCount | null) => void;
  /**
   * Display only, right after `onObservation`: the census's series record as the runner writes it (naturalist-series.ts; its
   * counters and flux rates are read right after the census is observed, before the boundary's transforms, as the runner does),
   * its lineage rows, and the ledger records lost in its drain. Call `series` inside this callback, if at all.
   */
  onSeries?: (series: () => { rec: SeriesFields; rows: [string, number][] }, dropped: number) => void;
  /** Display only, after a pond boundary's cycle (or, for arm cont, its record) has been applied at `step`. */
  onPondCycle?: (cycle: PondCycle, step: number) => void;
  onDisplayError?: (message: string) => void;
  /** Display only, in breeder mode: the world has stopped at a pond boundary and waits for `resolvePond`. */
  onPondAwait?: (survey: PondSurvey) => void;
  /**
   * A queued intervention (`queueReplay`) has just been re-applied to the live world: the host books it
   * (its log, and for a feed its conservation baselines, by `result`). A lesion or a pick has no result.
   */
  onReplayed?: (iv: Intervention, result: FeedResult | null) => void;
  /** Display only: the live world's light changed (a sun began in a replay, or one ended), to `light` (null: the world's own). */
  onLight?: (light: LightParams | null) => void;
}

/**
 * A pond cycle waiting for its donors (breeder mode): what the person choosing is shown of the pre-cycle world.
 * Every value is a pure function of that world's state.
 */
export interface PondSurvey {
  /** The boundary's step and its cycle index b = step / pondPeriod. */
  step: number;
  cycle: number;
  /** The donors the world's own arm would choose, in its order: what `resolvePond(null)` applies. Never empty. */
  suggested: number[];
  /** Each term's value per pond (`POND_TERMS`); a pond whose "mass" is 0 is empty and cannot donate. */
  terms: Record<PondTerm, number[]>;
  /** The score `suggested` was ranked by: the active pressure's, else the config's `pondScore` (null for an arm without one). */
  ruleScore: PondScore | null;
  /** The kept lineage as this pre-cycle state sees it, or null when none is kept. */
  kept: KeptPond | null;
  /**
   * Which survey this is: every survey, a re-survey of a waiting cycle included, takes the next number. Explicit donors name
   * the revision they were chosen from (`resolvePond`), so donors chosen from a survey the dial or Keep has since replaced are refused.
   */
  revision: number;
}

/** The pond arms whose cycle chooses donors, so that a person can choose them instead. */
type DonorArm = "scaf" | "rand" | "breed";
const donorArm = (cfg: Pick<WorldConfig, "pondArm">): DonorArm | null => (cfg.pondArm === "scaf" || cfg.pondArm === "rand" || cfg.pondArm === "breed" ? cfg.pondArm : null);
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** Raised before any submission, so the world is unchanged and remains usable. */
class StepLimitError extends Error {}
/**
 * Raised when a request cannot be met because a pond cycle is waiting for its donors (breeder mode). A refusal, not
 * a failure: the world is usable and at most has advanced to that boundary, where it waits.
 */
export class PondWaitingError extends Error {}
/**
 * Raised when explicit donors name a survey revision that is no longer the waiting cycle's (the dial or Keep re-surveyed it
 * since they were chosen). A refusal, like `PondWaitingError`: the cycle still waits, under its newer survey.
 */
export class StaleSurveyError extends PondWaitingError {}
/**
 * Raised when the pressure dial cannot be set: a world whose arm does not breed for a score, a score that is not one, or a
 * world that has failed. A refusal: nothing was logged, and the world is exactly as it was.
 */
export class PressureRefusedError extends Error {}

/**
 * Why the lab will not take a world with `cfg`, or null. The transition hunt's pond arms (`pondArm` "nat" and "shuf",
 * docs/scaffold-transition-hunt-v1.md) run only in the headless runner and on islands, never in the lab: a world that
 * has one is refused wherever it can enter (a preset with overrides, an import, a restore or jump), and by
 * `LabExecution` itself, so no cycle, replay twin or checkpoint of one is ever made here.
 */
export function huntArmError(cfg: Pick<WorldConfig, "pondArm">): string | null {
  const arm = cfg.pondArm;
  if (arm !== "nat" && arm !== "shuf") return null;
  return `This world uses pond arm "${arm}", one of the transition hunt's (docs/scaffold-transition-hunt-v1.md); the lab does not run the hunt's arms yet. Run it with tools/run.ts or on an island.`;
}

export class LabExecution {
  private readonly obs;
  private readonly cursor: { observed: number };
  private readonly ponds: PondContext | null;
  private lost: string | null = null;
  /**
   * Logged interventions still to re-apply, in order, each when the world reaches its step. The single
   * traversal (`walk`) owns them, so frames, checkpoint settlement and replay verification all stop at an
   * intervention's step and apply it: none can step past one.
   */
  private replay: Intervention[] = [];
  /**
   * Breeder mode: at each pond boundary of an arm that chooses donors, the census is taken and the world then
   * waits, pre-cycle, for `resolvePond`. Not part of the world's config: what a person chose is in the log (a
   * "pick" intervention), and a replay takes it from there.
   */
  private hand = false;
  private awaitingPond: PondSurvey | null = null;
  /** The revision the last survey took (`PondSurvey.revision`). */
  private surveyRevision = 0;
  /**
   * The pressure dial's history, in log order: each replaces the config's `pondScore` for the donors the rule chooses from its
   * `cycle` on. The log holds them too (a "pressure" intervention); this is what the boundaries read, so a replay, a
   * restore and the verification twin all see the score the live world was governed by.
   */
  private readonly pressures: PressureEntry[];
  /** The kept lineage, or null. Display and Keep's donor rule only: a hand pick is never changed. */
  private keepKey: string | null;
  /** Boundaries before this step belong to a history being replayed: they take a logged pick or the arm's own donors and never wait. */
  private replayUntil = 0;
  /** Mutation edges drained at each census, in step order: the lineage inspector's genealogy. */
  readonly edges: MutationEdges;
  private droppedEvents: number;
  /** What the log of firsts needs of this world's config, built once. */
  private readonly firstsCtx: FirstsContext;
  /** The flux counters and step of the last census observed (the start state's before the first): the series record's rates. Null without a start state. */
  private prevFlux: bigint[] | null;
  private prevStep: number;
  /** Whether the live simulation runs under the observer's sun yet (`installSun`; the traversal installs it if the host did not). */
  private sunInstalled: boolean;
  /** The live world's sun: its observer's. */
  private readonly liveSun: SunHold = {
    get: () => this.obs.sun ?? null,
    set: (sun) => {
      if (sun) this.obs.sun = { ...sun };
      else delete this.obs.sun;
      this.display(() => this.options.onLight?.(sun ? sunLight(this.sim.cfg, sun.percent) : null));
    },
  };

  constructor(private readonly sim: LabSimulation, private readonly settings: ObserverSettings, private readonly options: ExecutionOptions) {
    const huntError = huntArmError(sim.cfg);
    if (huntError) throw new Error(huntError);
    if (!Number.isSafeInteger(settings.censusEvery) || settings.censusEvery <= 0) throw new Error("censusEvery must be a positive integer");
    const period = sim.cfg.migrationPeriod ?? 0;
    if (period > 0 && period % settings.censusEvery !== 0) {
      throw new Error(`migrationPeriod ${period} is not a multiple of this world's censusEvery (${settings.censusEvery}); migration would fire at the wrong cadence in the lab`);
    }
    // The pond cycle is keyed on the absolute step like migration, so it takes the same cadence check.
    const pondPeriod = sim.cfg.pondPeriod;
    if (pondPeriod !== undefined && pondPeriod % settings.censusEvery !== 0) {
      throw new Error(`pondPeriod ${pondPeriod} is not a multiple of this world's censusEvery (${settings.censusEvery}); the pond cycle would fire at the wrong cadence in the lab`);
    }
    const cellPeriod = sim.cfg.cellPeriod;
    if (cellPeriod !== undefined && cellPeriod % settings.censusEvery !== 0) {
      throw new Error(`cellPeriod ${cellPeriod} is not a multiple of this world's censusEvery (${settings.censusEvery}); the declared-cell pass would fire at the wrong cadence in the lab`);
    }
    if (options.observer && options.observer.step !== sim.step) throw new Error("observer and simulation steps differ");
    const pondError = pondContinuationError(sim.cfg, options.observer, sim.step);
    if (pondError) throw new Error(pondError);
    if (options.start && options.start.step !== sim.step) throw new Error("start state and simulation steps differ");
    // M_r and the conservation baseline of every cycle, from this history's own
    // start (the runner's PondContext); the replay twin checks against the same.
    // Lesions turn B+P into C in place and book the heat, so neither changes.
    this.ponds = options.start ? pondContext(options.start) : null;
    if (pondPeriod !== undefined && !this.ponds) throw new Error("a pond world needs its start state for the pond cycle's conservation checks");
    this.obs = restoreObservers(options.observer, settings, sim.cfg);
    // A checkpoint taken during a sun: its light governs the steps from here to the sun's end (installed before the first).
    const sun = this.obs.sun;
    if (sun) {
      if (!(sun.step <= sim.step && sim.step < sun.step + sun.span)) throw new Error(`the observer's sun (from t=${sun.step} for ${sun.span} steps) is not active at t=${sim.step}`);
      const bad = sunError(sim.cfg, sun.percent);
      if (bad) throw new Error(`the observer's sun: ${bad}`);
      if (!sim.setLight) throw new Error("this world was saved during a sun, and this simulation cannot change its light");
    }
    this.sunInstalled = !sun;
    this.cursor = { observed: sim.step };
    this.edges = options.lineage?.edges ?? new MutationEdges();
    this.droppedEvents = options.lineage?.dropped ?? 0;
    this.firstsCtx = firstsContext(sim.cfg, settings.censusEvery);
    this.prevFlux = options.start ? options.start.flux.slice() : null;
    this.prevStep = sim.step;
    this.pressures = (options.pressures ?? []).map((e) => ({ step: e.step, cycle: e.cycle, score: e.score }));
    if (this.pressures.length && sim.cfg.pondArm !== "breed") throw new Error(`the history holds pressures, but this world's pond arm is ${JSON.stringify(sim.cfg.pondArm)}: only a breeder world has a pressure dial`);
    this.keepKey = options.keep ?? null;
    if (this.edges.countBefore(sim.step) !== this.edges.length) throw new Error("mutation edges run past the simulation's step");
  }

  /** Mutation events the ledger dropped, so missing from `edges`. */
  get dropped(): number { return this.droppedEvents; }

  get failure(): string | null { return this.lost; }

  /** Net nutrient this history's logged feeds have added and their number (ObserverState.fed; zeros when never fed). */
  get fed(): { matter: number; feeds: number } { return this.obs.fed ?? { matter: 0, feeds: 0 }; }

  /** The sun the live world runs under, or null (the world's own light). */
  get sun(): SunSpan | null {
    const s = this.obs.sun;
    return s ? { ...s } : null;
  }

  /** The light the live world uses now, or null for the world's own: the Light view draws it. */
  get light(): LightParams | null {
    const s = this.obs.sun;
    return s ? sunLight(this.sim.cfg, s.percent) : null;
  }

  /** Puts the live simulation under the observer's sun, if it has one (a world loaded mid-span). Idempotent. */
  async installSun() {
    this.check();
    if (this.sunInstalled) return;
    const sun = this.obs.sun;
    if (sun) await this.sim.setLight!(sunLight(this.sim.cfg, sun.percent));
    this.check();
    this.sunInstalled = true;
  }

  /**
   * Why a sun of `percent` for `span` steps cannot be set on the live world now, or null: a simulation that cannot change its
   * light, a world whose light cannot take it (`sunError`), one already under a sun, a span outside 1..2^24 or past the step limit.
   */
  sunRefusal(percent: number, span: number): string | null {
    if (!this.sim.setLight) return "This simulation cannot change its light.";
    const bad = sunError(this.sim.cfg, percent);
    if (bad) return `This world’s light cannot take that sun: ${bad.replace(/^this world's light cannot take a sun of \d+%: /, "")}.`;
    const cur = this.obs.sun;
    if (cur) return `A sun is already shining (${cur.percent}% from t=${cur.step}); the world’s own light returns at step ${cur.step + cur.span}.`;
    if (!Number.isSafeInteger(span) || span < 1 || span > SUN_SPAN_MAX) return `A sun lasts from 1 to ${SUN_SPAN_MAX} steps.`;
    if (this.sim.step + span > MAX_STEP) return `A sun of ${span} steps would end past the step limit.`;
    return null;
  }

  /**
   * Sets a sun on the live world from its step: `percent` of the world's light for `span` steps (@bl/schema's sun.ts). Throws
   * `SunRefusedError` (`sunRefusal`, or a cycle waiting for donors) with nothing changed but a sun that ends at this step
   * setting first. Returns the entry the host logs; the
   * observer carries the sun until its end, where the traversal restores the world's own light.
   */
  async applySun(percent: number, span: number): Promise<Extract<Intervention, { kind: "sun" }>> {
    this.check();
    if (this.awaitingPond) throw new SunRefusedError(this.waitingMessage("set a sun"));
    // A sun that ends at this very step has gone: a new one may start here (back to back), as in the runner.
    await this.installSun();
    await this.sundown(this.sim, this.liveSun);
    const why = this.sunRefusal(percent, span);
    if (why) throw new SunRefusedError(why);
    const step = this.sim.step;
    await this.sim.setLight!(sunLight(this.sim.cfg, percent));
    this.check();
    this.liveSun.set({ step, percent, span });
    return { step, kind: "sun", percent, span };
  }

  /** Books one feed of `matter` net quanta into the observer state, which the next checkpoint carries. */
  recordFeed(matter: number) {
    this.check();
    if (!Number.isSafeInteger(matter)) throw new Error(`feed amount ${matter} is not an integer`);
    const f = this.fed;
    this.obs.fed = { matter: f.matter + matter, feeds: f.feeds + 1 };
  }

  /**
   * Queues logged interventions for re-application on the way forward (a jump back across them). They
   * must be in step order and not behind the world. Replaces any queue already there. `until` is the step
   * the replayed history runs to: in breeder mode, pond boundaries before it do not wait for donors (the
   * history already says what happened there: a queued pick, or the arm's own choice).
   */
  queueReplay(list: readonly Intervention[], until = 0) {
    this.check();
    if (this.awaitingPond) throw new PondWaitingError(this.waitingMessage("queue a replay"));
    if (!Number.isSafeInteger(until) || until < 0) throw new Error(`replay horizon ${until} is not a step`);
    let at = this.sim.step;
    for (const iv of list) {
      if (!Number.isSafeInteger(iv.step) || iv.step < at) throw new Error(`replay entry at t=${iv.step} is behind t=${at}; a log replays in step order from the world's step`);
      at = iv.step;
    }
    this.replay = list.slice();
    this.replayUntil = until;
  }

  /** What `queueReplay` queued and the traversal has not yet re-applied. */
  get pendingReplay(): readonly Intervention[] { return this.replay; }

  /** `queueReplay`'s horizon: the replayed history runs to the step before it (0 when none is, or after a fork). */
  get replayHorizon(): number { return this.replayUntil; }

  /** A manual intervention forks the history: what was still queued no longer applies. Returns how many were dropped. */
  dropReplay(): number {
    const n = this.replay.length;
    this.replay = [];
    this.replayUntil = 0;
    return n;
  }

  /** Breeder mode on or off. It cannot be left while a cycle waits: resolve that first (`resolvePond`). */
  setHandPicks(on: boolean) {
    this.check();
    if (!on && this.awaitingPond) throw new PondWaitingError(this.waitingMessage("leave breeder mode"));
    this.hand = on;
  }

  get handPicks(): boolean { return this.hand; }

  /** The pond cycle waiting for donors, or null. While one waits the world does not advance, save or verify. */
  get awaiting(): PondSurvey | null { return this.awaitingPond; }

  /** The first pond cycle not yet applied: the waiting one, else the next boundary after the world's step. 0 without a pond cycle. */
  private nextCycle(): number {
    const period = this.sim.cfg.pondPeriod;
    return period === undefined ? 0 : pressureCycleOf(this.sim.step, period, this.awaitingPond !== null);
  }

  /** The score the rule ranks donors by at cycle `cycle` under `list`: the latest pressure that governs it, else the config's. */
  private activeScore(cycle: number, list: readonly PressureEntry[] = this.pressures): PondScore | undefined {
    return activePondScore(list, cycle) ?? this.sim.cfg.pondScore;
  }

  /**
   * The pressure dial: `base` is the config's own score, `current` the one that governs the next cycle to be applied
   * (`nextCycle`), `fromCycle` the cycle of the latest pressure (null when none), `changes` how many this history holds.
   */
  get pressure(): { base: PondScore | undefined; current: PondScore | undefined; fromCycle: number | null; changes: number; nextCycle: number } {
    const nextCycle = this.nextCycle();
    return {
      base: this.sim.cfg.pondScore,
      current: this.activeScore(nextCycle),
      fromCycle: this.pressures.length ? this.pressures[this.pressures.length - 1].cycle : null,
      changes: this.pressures.length,
      nextCycle,
    };
  }

  /** The kept lineage, or null. */
  get keep(): string | null { return this.keepKey; }

  /**
   * Sets the pressure dial: from `nextCycle` on, the rule ranks donors by `score`. Throws `PressureRefusedError` for a world
   * whose arm is not breed, a score that is not one, and a failed world, with nothing changed. Returns `entry: null`, logging
   * nothing, when `score` is already the one governing `nextCycle`. Otherwise `entry` is what the host logs, in the same
   * synchronous step as this returns (the lab logs a pressure at the world's step, ahead of the pick of the cycle it governs
   * when that cycle waits). While a cycle waits it is re-surveyed under the new score first, so a failed readback changes
   * nothing, and `survey` is the waiting cycle's new survey (also given to `onPondAwait`).
   */
  async setPressure(score: PondScore): Promise<{ entry: PressureEntry | null; survey: PondSurvey | null }> {
    if (!this.options.isCurrent()) throw new Error("lab world was replaced");
    if (this.lost) throw new PressureRefusedError(this.lost);
    const cfg = this.sim.cfg, period = cfg.pondPeriod;
    if (cfg.pondArm !== "breed" || period === undefined) {
      throw new PressureRefusedError(`This world’s rule doesn’t breed for a score (its arm is ${cfg.pondArm ?? "none"}), so there is no pressure to set.`);
    }
    try {
      pondScoreTerms(score);
    } catch (e) {
      throw new PressureRefusedError(message(e));
    }
    if (score === this.activeScore(this.nextCycle())) return { entry: null, survey: null };
    const entry: PressureEntry = { step: this.sim.step, cycle: pressureCycleOf(this.sim.step, period, this.awaitingPond !== null), score };
    const waiting = this.awaitingPond;
    const survey = waiting ? await this.surveyAgain(waiting, [...this.pressures, entry]) : null;
    this.pressures.push(entry);
    if (survey) {
      this.awaitingPond = survey;
      this.display(() => this.options.onPondAwait?.(survey));
    }
    return { entry, survey };
  }

  /** Keeps lineage `key` (or, for null, none). While a cycle waits it is surveyed again, and that survey returned. */
  async setKeep(key: string | null): Promise<PondSurvey | null> {
    this.check();
    if (key !== null && !isLineageKey(key)) throw new Error(`${JSON.stringify(key)} is not a lineage key (hi:lo)`);
    this.keepKey = key;
    return this.resurvey();
  }

  /** Rebuilds the waiting cycle's survey under the current pressures and keep, and shows it. Null when no cycle waits. */
  async resurvey(): Promise<PondSurvey | null> {
    this.check();
    const waiting = this.awaitingPond;
    if (!waiting) return null;
    const survey = await this.surveyAgain(waiting, this.pressures);
    // What waited may have been answered while the world was read: nothing waits for this survey then.
    if (this.awaitingPond !== waiting) return null;
    this.awaitingPond = survey;
    this.display(() => this.options.onPondAwait?.(survey));
    return survey;
  }

  /** The waiting cycle's survey, read again from its held pre-cycle world (terms are of that world, so unchanged). */
  private async surveyAgain(waiting: PondSurvey, list: readonly PressureEntry[]): Promise<PondSurvey> {
    const pre = await this.sim.readState();
    this.check();
    if (pre.step !== waiting.step) throw new Error(`pond cycle waits at t=${waiting.step}, but the simulation is at t=${pre.step}`);
    return this.survey(pre, list, waiting.terms);
  }

  /**
   * Applies the waiting pond cycle with `picks` as its donors, in that order, or with the arm's own (`null`; with
   * `withKeep`, the arm's own as Keep adjusts them, `donorsWithKeep`, read from the survey that waits now).
   * Returns the donors applied: the host logs them as a "pick" intervention either way, so a replay of this
   * history never has to ask again. Bad picks (`pondPickError`) throw and leave the world waiting, unchanged; so do
   * explicit picks whose `revision` is not the waiting survey's (`StaleSurveyError`).
   */
  async resolvePond(picks: readonly number[] | null, options: { revision?: number; withKeep?: boolean } = {}): Promise<{ step: number; cycle: number; donors: number[] }> {
    this.check();
    const waiting = this.awaitingPond;
    if (!waiting) throw new Error("no pond cycle is waiting for donors");
    if (picks !== null && options.revision !== undefined && options.revision !== waiting.revision)
      throw new StaleSurveyError(`The ponds of cycle ${waiting.cycle} were surveyed again (the dial or Keep changed) after these donors were chosen. Check the picks and breed again.`);
    const donors = picks !== null ? [...picks] : options.withKeep ? donorsWithKeep(waiting.suggested, waiting.kept) : waiting.suggested.slice();
    const error = pondPickError(waiting.terms.mass, donors);
    if (error) throw new Error(error);
    try {
      const ponds = await this.settle(waiting.step, donors);
      this.awaitingPond = null;
      if (ponds) this.display(() => this.options.onPondCycle?.(ponds, waiting.step));
      // The walk stopped at this boundary before a sun ending here could set: it sets now, after the cycle, as it would have.
      await this.sundown(this.sim, this.liveSun);
    } catch (e) {
      this.fail(e);
      throw e;
    }
    return { step: waiting.step, cycle: waiting.cycle, donors };
  }

  /** Display totals only; callers never receive mutable observers or the cadence cursor. */
  counts() {
    const t = this.obs.tracker;
    const counts = t.eventCounts();
    return { fissions: t.fissions, fusions: t.fusions, births: counts.birth, deaths: counts.death, maxGen: t.maxGeneration(), mutations: this.obs.mutations };
  }

  /** One frame consumes at most the next census interval; remaining requests stay with the caller. */
  async advanceFrame(requested: number): Promise<number> {
    this.check();
    this.checkSteps(requested);
    // A cycle waiting for donors holds the world at its boundary; the request stays with the caller.
    if (this.awaitingPond) return 0;
    const from = this.sim.step;
    await this.advanceLive(Math.min(from + requested, this.boundary(this.cursor)));
    return this.sim.step - from;
  }

  /** A checkpoint always includes the observation, migration and pond cycle at its settled step. */
  async checkpoint() {
    this.check();
    if (this.awaitingPond) throw new PondWaitingError(this.waitingMessage("save or read this world"));
    const from = this.sim.step;
    if (from !== this.cursor.observed) await this.advanceLive(this.boundary(this.cursor));
    // Already at a census: still apply any queued intervention due at this very step first.
    else if (this.replay.length && this.replay[0].step <= from) await this.advanceLive(from);
    // Settling reached a pond boundary that waits for donors: the state there is pre-cycle, which no checkpoint may hold.
    if (this.awaitingPond) throw new PondWaitingError(this.waitingMessage("save or read this world"));
    const state = await this.sim.readState();
    this.check();
    if (state.step !== this.cursor.observed) throw new Error(`observer state is at t=${this.cursor.observed}, not t=${state.step}`);
    return { state, observer: serializeObservers(this.obs, state.step, this.settings), advanced: state.step - from, edges: this.edges.length, dropped: this.droppedEvents };
  }

  /** Own the replay cursor and twin lifetime so verification cannot omit a migration or pond cycle. */
  async verify(steps: number, createTwin: (state: WorldState) => Promise<LabSimulation>) {
    this.check();
    this.checkSteps(steps);
    if (this.awaitingPond) throw new PondWaitingError(this.waitingMessage("verify"));
    // A boundary that would wait for donors inside the window cannot be replayed unattended.
    const period = this.sim.cfg.pondPeriod;
    if (period !== undefined) {
      for (let at = (Math.floor(this.sim.step / period) + 1) * period; at <= this.sim.step + steps; at += period) {
        if (this.pausesAt(at) && !this.replay.some((iv) => iv.kind === "pick" && iv.step === at))
          throw new PondWaitingError(`verifying ${steps} steps would pass the pond boundary at t=${at}, which waits for donors in breeder mode; choose them first or verify fewer steps`);
      }
    }
    const start = await this.sim.readState();
    this.check();
    const twinCursor = { ...this.cursor };
    // The twin replays the same queued interventions as the live world, physics only.
    const twinReplay = this.replay.slice();
    // And is governed by the same pressures: its own copy, since consuming the queue's pressures must not touch the live list.
    const twinPressures = this.pressures.slice();
    // And under the same sun, its own copy.
    let twinSunNow = this.sun;
    const twinSun: SunHold = { get: () => twinSunNow, set: (sun) => { twinSunNow = sun; } };
    const twin = await createTwin(cloneState(start));
    try {
      this.check();
      if (twinSunNow) {
        if (!twin.setLight) throw new Error("the replay twin cannot change its light, and this world is under a sun");
        await twin.setLight(sunLight(twin.cfg, twinSunNow.percent));
      }
      await this.advanceLive(start.step + steps);
      await this.walk(twin, twinCursor, start.step + steps, async (step, picks) => {
        await this.boundaryAt(twin, step, picks, twinPressures);
        this.check();
        return false;
      }, twinReplay, undefined, twinPressures, twinSun);
      const [a, b] = await Promise.all([this.sim.readState(), twin.readState()]);
      this.check();
      return { from: start.step, steps, liveHash: stateHash(a), twinHash: stateHash(b) };
    } finally {
      twin.destroy();
    }
  }

  private check() {
    if (!this.options.isCurrent()) throw new Error("lab world was replaced");
    if (this.lost) throw new Error(this.lost);
  }

  private waitingMessage(what: string): string {
    const w = this.awaitingPond!;
    return `pond cycle ${w.cycle} at t=${w.step} is waiting for its donors; choose them before you ${what}`;
  }

  /** Whether the live world stops at census step `step` to wait for donors (breeder mode, a donor-choosing arm's boundary, past any replayed history). */
  private pausesAt(step: number): boolean {
    const period = this.sim.cfg.pondPeriod;
    return this.hand && period !== undefined && step > 0 && step % period === 0 && step >= this.replayUntil && donorArm(this.sim.cfg) !== null;
  }

  /** What a person choosing donors is shown of the pre-cycle state `pre`. */
  private survey(pre: WorldState, list: readonly PressureEntry[] = this.pressures, known?: Record<PondTerm, number[]>): PondSurvey {
    const cfg = pre.cfg, k = cfg.pondK!, cycle = pre.step / cfg.pondPeriod!;
    const terms = known ?? Object.fromEntries(POND_TERMS.map((term) => [term, pondTermValues(pre, term, k)])) as Record<PondTerm, number[]>;
    const score = this.activeScore(cycle, list);
    return {
      step: pre.step, cycle, suggested: pondDonors(pre, cycle, donorArm(cfg)!, k, score), terms,
      ruleScore: score ?? null, kept: this.keepKey === null ? null : keptPondOf(pre, this.keepKey), revision: ++this.surveyRevision,
    };
  }

  /**
   * The host-side transforms of census step `step` on the live world (migration, the pond cycle with `picks`
   * when given, the declared-cell pass), booked into the observers: the second half of a census boundary.
   */
  private async settle(step: number, picks?: readonly number[]): Promise<PondCycle | null> {
    const { ponds, births } = await this.boundaryAt(this.sim, step, picks, this.pressures);
    // As the runner records it: the last boundary whose cycle is applied (or recorded, for cont).
    if (ponds) this.obs.ponds = { lastCycle: ponds.b };
    // Declared cells: births are lineage edges and count as mutations, as in the runner.
    if (births.length) {
      this.edges.append(births);
      this.obs.mutations += births.length;
    }
    this.check();
    return ponds;
  }

  /**
   * Draining is destructive, observations mutate in place, and a failed submission, migration or pond cycle may
   * have partially changed physics: the world is marked failed and never retried.
   */
  private fail(e: unknown) {
    if (e instanceof StepLimitError || e instanceof PondWaitingError) return;
    if (this.options.isCurrent() && !this.lost) {
      this.lost = `census at t=${this.sim.step} failed (${message(e)}); observer history is incomplete. Restore a checkpoint or reload to continue.`;
    }
  }

  private checkSteps(steps: number) {
    if (!Number.isSafeInteger(steps) || steps < 0) throw new Error("steps must be a nonnegative integer");
  }

  private boundary(cursor: { observed: number }): number {
    const every = this.settings.censusEvery;
    // Imported migration-enabled and pond worlds realign to the absolute census
    // grid, where their transforms fire. Otherwise retain the history's
    // original relative cadence.
    const absolute = (this.sim.cfg.migrationPeriod ?? 0) > 0 || this.sim.cfg.pondPeriod !== undefined || this.sim.cfg.cellPeriod !== undefined;
    const rem = absolute ? cursor.observed % every : 0;
    return cursor.observed + (rem === 0 ? every : every - rem);
  }

  private async advanceLive(target: number) {
    this.check();
    try {
      await this.installSun();
      await this.walk(this.sim, this.cursor, target, async (step, picks) => {
        const ledger = await this.sim.drainLedger();
        this.check();
        this.edges.append(ledger.events);
        this.droppedEvents += ledger.dropped;
        const snap = await this.sim.readSnapshot(false);
        this.check();
        if (snap.step !== step) throw new Error(`observation at t=${snap.step}, expected the census boundary t=${step}`);
        const observed = observeCensus(this.obs, this.sim.cfg, snap, ledger.events.length + ledger.dropped);
        // The series record's counters and rates, as the runner reads them: after the census, before the boundary's transforms.
        const t = this.obs.tracker;
        const counters = { fissions: t.fissions, fusions: t.fusions, buddings: this.obs.buddings, maxGeneration: t.maxGeneration(), mutations: this.obs.mutations };
        const rates = this.prevFlux ? fluxRates(this.prevFlux, snap.flux, step - this.prevStep) : null;
        this.prevFlux = snap.flux.slice();
        this.prevStep = step;
        const series = () => ({ rec: seriesFields(observed.census, observed.sym, rates, counters), rows: lineageRows(observed.census) });
        // The census's own phase: its snapshot's genome words, read once and shared by the log of firsts and the family tree.
        let cells: LineageCells | undefined;
        const lineageCells = () => (cells ??= readLineageCells(observed.census, this.obs.tracker, snap.genomeHead, this.firstsCtx));
        const firsts = (extras?: FirstsExtras) => buildFirstsInput(observed.census, this.obs.tracker, snap.genomeHead, observed.events, this.firstsCtx, { ...extras, lineageCells: lineageCells() });
        const families: CensusFamilies = { input: () => buildFamilyInput(observed.census, lineageCells()), parentOf: (key) => this.edges.parentOf(key) };
        // Display only: the shell's cells of this census's own snapshot, taken before any boundary transform below (null without a shell).
        const shell = shellCount(this.sim.cfg, snap.cells, snap.genomeHead);
        // Breeder mode: the census is taken, and the cycle waits for a person's donors (`resolvePond`).
        if (picks === undefined && this.pausesAt(step)) {
          const pre = await this.sim.readState();
          this.check();
          if (pre.step !== step) throw new Error(`pond boundary at t=${step}, but the simulation is at t=${pre.step}`);
          const survey = this.survey(pre);
          // With no pond occupied there is nothing to choose: the history has ended and its cycle runs as ever.
          if (survey.suggested.length) {
            this.awaitingPond = survey;
            this.display(() => this.options.onObservation?.(observed.census, ledger.dropped, firsts, families, shell));
            this.display(() => this.options.onSeries?.(series, ledger.dropped));
            this.display(() => this.options.onPondAwait?.(survey));
            return true;
          }
        }
        const ponds = await this.settle(step, picks);
        this.display(() => this.options.onObservation?.(observed.census, ledger.dropped, firsts, families, shell));
        this.display(() => this.options.onSeries?.(series, ledger.dropped));
        if (ponds) this.display(() => this.options.onPondCycle?.(ponds, step));
        return false;
      }, this.replay, (iv, result) => {
        if (result) this.recordFeed(result.matter);
        this.options.onReplayed?.(iv, result);
      });
    } catch (e) {
      this.fail(e);
      throw e;
    }
  }

  /** Presentation failure must not invalidate a successfully committed census or cycle. */
  private display(show: () => void) {
    try {
      show();
    } catch (e) {
      try { this.options.onDisplayError?.(message(e)); } catch { /* Display is best effort. */ }
    }
  }

  /**
   * The runner's boundary helpers: migration, then the pond cycle with this history's context, then the
   * declared-cell pass (WorldConfig.cellPeriod), in the runner's order.
   */
  private async boundaryAt(sim: LabSimulation, step: number, picks: readonly number[] | undefined, pressures: readonly PressureEntry[]): Promise<BoundaryResult & { births: CellBirth[] }> {
    const host = {
      cfg: sim.cfg,
      readState: async () => {
        const state = await sim.readState();
        this.check();
        return state;
      },
      upload: (state: WorldState) => sim.upload(state),
    };
    // No pick here and a pressure in the history: the rule's donors under the score that governs this cycle (`pressureHook`, which
    // leaves the arm's own cycle, byte for byte, when that is the config's own score). A world with no pressure passes `picks` as ever.
    const period = sim.cfg.pondPeriod;
    const governed = picks === undefined && pressures.length > 0 && sim.cfg.pondArm === "breed" && period !== undefined && step !== 0 && step % period === 0;
    const boundary = await applyBoundary(host, step, this.ponds, governed ? pressureHook(sim.cfg, () => pressures) : picks);
    const cells = await cellsAtBoundary(host, step, boundary.state);
    return { ...boundary, state: cells.state ?? boundary.state, births: cells.births };
  }

  /**
   * The end of the sun `sun` holds, when `sim` stands at it: the world's own light returns. Called by the walk after its step's
   * census and boundary, and after a pond cycle that waited for donors there (`resolvePond`), whose walk stopped before it.
   * Returns whether a sun ended.
   */
  private async sundown(sim: LabSimulation, sun: SunHold): Promise<boolean> {
    const lit = sun.get();
    if (!lit || lit.step + lit.span !== sim.step) return false;
    await sim.setLight!(null);
    this.check();
    sun.set(null);
    return true;
  }

  /** One logged lesion, feed or sun re-applied to `sim`; a feed must move exactly what the log says it moved. */
  private async reapply(sim: LabSimulation, iv: Exclude<Intervention, { kind: "pick" | "pressure" }>, sun: SunHold): Promise<FeedResult | null> {
    if (iv.kind === "sun") {
      const cur = sun.get();
      if (cur) throw new Error(`replayed sun at t=${iv.step} starts while the sun from t=${cur.step} still shines (until t=${cur.step + cur.span}): this is not the observed history`);
      const bad = sunError(sim.cfg, iv.percent);
      if (bad) throw new Error(`replayed sun at t=${iv.step}: ${bad}`);
      if (!sim.setLight) throw new Error(`replayed sun at t=${iv.step}: this simulation cannot change its light`);
      await sim.setLight(sunLight(sim.cfg, iv.percent));
      this.check();
      sun.set({ step: iv.step, percent: iv.percent, span: iv.span });
      return null;
    }
    if (iv.kind === "lesion") {
      sim.lesion(iv.x, iv.y, iv.r);
      return null;
    }
    const result = await sim.feed(iv.x, iv.y, iv.r, iv.amount);
    this.check();
    if (result.matter !== iv.matter) throw new Error(`replayed feed at t=${iv.step} moved ${result.matter} quanta, the log says ${iv.matter}: this is not the observed history`);
    return result;
  }

  /**
   * The single traversal for live worlds and physics-only replay twins. `replay` is consumed from the
   * front: an entry is applied when the world is at its step, after that step's census (a manual
   * intervention always came after the census of the step it was made at), and no chunk steps past one.
   * A logged pick is the exception: it is part of its step's boundary, so `observe` receives its donors
   * for the pond cycle there. `observe` returns true to stop the traversal at that boundary (a cycle
   * waiting for donors), with the census counted as observed.
   * A logged pressure is consumed into `pressures` (the list `observe` reads for this traversal): one for the cycle
   * of the boundary the world is at comes before that boundary's census, so the pick (or the rule) that follows is
   * governed by it; one for a later cycle is consumed where it stands, with no physics, after the census of its step.
   */
  private async walk(
    sim: LabSimulation, cursor: { observed: number }, target: number, observe: (step: number, picks?: readonly number[]) => Promise<boolean>,
    replay: Intervention[] = [], applied?: (iv: Intervention, result: FeedResult | null) => void, pressures: PressureEntry[] = this.pressures,
    sun: SunHold = this.liveSun,
  ) {
    const period = sim.cfg.pondPeriod;
    const take = (iv: Extract<Intervention, { kind: "pressure" }>) => {
      pressures.push({ step: iv.step, cycle: iv.cycle, score: iv.score });
      replay.shift();
      applied?.(iv, null);
    };
    for (;;) {
      this.check();
      const boundary = this.boundary(cursor);
      if (sim.step === boundary) {
        for (let at = replay[0]; period !== undefined && at && at.kind === "pressure" && at.step === boundary && at.cycle * period === boundary; at = replay[0]) take(at);
        const first = replay[0];
        const pick = first && first.kind === "pick" && first.step === boundary ? first : undefined;
        const stop = await observe(boundary, pick?.donors);
        this.check();
        cursor.observed = boundary;
        if (pick) {
          replay.shift();
          applied?.(pick, null);
        }
        if (stop) return;
        continue;
      }
      // A sun's end: after its step's census and boundary, before anything logged at that step (as the runner orders it), so a
      // checkpoint there carries no sun and a sun logged there starts after this one has gone.
      if (await this.sundown(sim, sun)) continue;
      const lit = sun.get();
      if (lit && lit.step + lit.span < sim.step) throw new Error(`the sun from t=${lit.step} should have ended at t=${lit.step + lit.span}, and the world is at t=${sim.step}`);
      const due = replay[0];
      if (due && due.step <= sim.step) {
        if (due.step < sim.step) throw new Error(`replay passed a logged ${due.kind} at t=${due.step}: this is not the observed history`);
        if (due.kind === "pick") throw new Error(`replay met a logged pick at t=${due.step} away from its pond boundary: this is not the observed history`);
        if (due.kind === "pressure") {
          if (period !== undefined && due.cycle * period === due.step) throw new Error(`replay met a logged pressure for cycle ${due.cycle} at t=${due.step} after that boundary had passed: this is not the observed history`);
          take(due);
          continue;
        }
        const result = await this.reapply(sim, due, sun);
        // Removed only once applied: a failure leaves it queued and the world marked as failed.
        replay.shift();
        applied?.(due, result);
        continue;
      }
      if (sim.step >= target) return;
      const lit2 = sun.get();
      let n = Math.min(target, boundary, due ? due.step : Infinity, lit2 ? lit2.step + lit2.span : Infinity) - sim.step;
      if (n <= 0) throw new Error("simulation passed an unobserved census");
      if (sim.step + n > MAX_STEP) throw new StepLimitError(`step limit ${MAX_STEP} reached`);
      while (n > 0) {
        const k = Math.min(n, 64);
        sim.run(k);
        n -= k;
      }
      await this.options.waitForIdle();
    }
  }
}
