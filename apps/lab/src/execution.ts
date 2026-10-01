// Cadence and observer integrity for one lab world. Callers serialize operations;
// the worker's generation predicate invalidates outstanding work on replacement.
import { cloneState, MAX_STEP, stateHash, type WorldState } from "@bl/schema";
import type { GpuSim } from "@bl/sim-gpu";
import type { Census } from "@bl/metrics";
import {
  applyBoundary,
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
} from "@bl/runner";
import { MutationEdges } from "@bl/lineage";

/** Real GPU simulation in the worker; reference physics with injectable readbacks in tests. */
export type LabSimulation = Pick<GpuSim, "cfg" | "step" | "run" | "drainLedger" | "readSnapshot" | "readState" | "upload" | "destroy">;
interface ExecutionOptions {
  observer?: ObserverState;
  /** The state the simulation was built from; required for a pond world, whose cycles check against it. */
  start?: WorldState;
  /** The run's mutation edges up to the simulation's step, and the events its ledger has dropped (lineage inspector). */
  lineage?: { edges: MutationEdges; dropped: number };
  waitForIdle: () => Promise<unknown>;
  isCurrent: () => boolean;
  onObservation?: (census: Census, dropped: number) => void;
  /** Display only, after a pond boundary's cycle (or, for arm cont, its record) has been applied at `step`. */
  onPondCycle?: (cycle: PondCycle, step: number) => void;
  onDisplayError?: (message: string) => void;
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** Raised before any submission, so the world is unchanged and remains usable. */
class StepLimitError extends Error {}

export class LabExecution {
  private readonly obs;
  private readonly cursor: { observed: number };
  private readonly ponds: PondContext | null;
  private lost: string | null = null;
  /** Mutation edges drained at each census, in step order: the lineage inspector's genealogy. */
  readonly edges: MutationEdges;
  private droppedEvents: number;

  constructor(private readonly sim: LabSimulation, private readonly settings: ObserverSettings, private readonly options: ExecutionOptions) {
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
    this.cursor = { observed: sim.step };
    this.edges = options.lineage?.edges ?? new MutationEdges();
    this.droppedEvents = options.lineage?.dropped ?? 0;
    if (this.edges.countBefore(sim.step) !== this.edges.length) throw new Error("mutation edges run past the simulation's step");
  }

  /** Mutation events the ledger dropped, so missing from `edges`. */
  get dropped(): number { return this.droppedEvents; }

  get failure(): string | null { return this.lost; }

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
    const from = this.sim.step;
    await this.advanceLive(Math.min(from + requested, this.boundary(this.cursor)));
    return this.sim.step - from;
  }

  /** A checkpoint always includes the observation, migration and pond cycle at its settled step. */
  async checkpoint() {
    this.check();
    const from = this.sim.step;
    if (from !== this.cursor.observed) await this.advanceLive(this.boundary(this.cursor));
    const state = await this.sim.readState();
    this.check();
    if (state.step !== this.cursor.observed) throw new Error(`observer state is at t=${this.cursor.observed}, not t=${state.step}`);
    return { state, observer: serializeObservers(this.obs, state.step, this.settings), advanced: state.step - from, edges: this.edges.length, dropped: this.droppedEvents };
  }

  /** Own the replay cursor and twin lifetime so verification cannot omit a migration or pond cycle. */
  async verify(steps: number, createTwin: (state: WorldState) => Promise<LabSimulation>) {
    this.check();
    this.checkSteps(steps);
    const start = await this.sim.readState();
    this.check();
    const twinCursor = { ...this.cursor };
    const twin = await createTwin(cloneState(start));
    try {
      this.check();
      await this.advanceLive(start.step + steps);
      await this.walk(twin, twinCursor, start.step + steps, async (step) => {
        await this.boundaryAt(twin, step);
        this.check();
      });
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

  private checkSteps(steps: number) {
    if (!Number.isSafeInteger(steps) || steps < 0) throw new Error("steps must be a nonnegative integer");
  }

  private boundary(cursor: { observed: number }): number {
    const every = this.settings.censusEvery;
    // Imported migration-enabled and pond worlds realign to the absolute census
    // grid, where their transforms fire. Otherwise retain the history's
    // original relative cadence.
    const absolute = (this.sim.cfg.migrationPeriod ?? 0) > 0 || this.sim.cfg.pondPeriod !== undefined;
    const rem = absolute ? cursor.observed % every : 0;
    return cursor.observed + (rem === 0 ? every : every - rem);
  }

  private async advanceLive(target: number) {
    this.check();
    try {
      await this.walk(this.sim, this.cursor, target, async (step) => {
        const ledger = await this.sim.drainLedger();
        this.check();
        this.edges.append(ledger.events);
        this.droppedEvents += ledger.dropped;
        const snap = await this.sim.readSnapshot(false);
        this.check();
        if (snap.step !== step) throw new Error(`observation at t=${snap.step}, expected the census boundary t=${step}`);
        const observed = observeCensus(this.obs, this.sim.cfg, snap, ledger.events.length + ledger.dropped);
        const { ponds } = await this.boundaryAt(this.sim, step);
        // As the runner records it: the last boundary whose cycle is applied (or recorded, for cont).
        if (ponds) this.obs.ponds = { lastCycle: ponds.b };
        this.check();
        this.display(() => this.options.onObservation?.(observed.census, ledger.dropped));
        if (ponds) this.display(() => this.options.onPondCycle?.(ponds, step));
      });
    } catch (e) {
      if (e instanceof StepLimitError) throw e;
      // Draining is destructive, observations mutate in place, and a failed
      // submission, migration or pond cycle may have partially changed physics.
      // Never retry.
      if (this.options.isCurrent() && !this.lost) {
        this.lost = `census at t=${this.sim.step} failed (${message(e)}); observer history is incomplete. Restore a checkpoint or reload to continue.`;
      }
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

  /** The runner's boundary helper: migration, then the pond cycle with this history's context. */
  private boundaryAt(sim: LabSimulation, step: number): Promise<BoundaryResult> {
    return applyBoundary({
      cfg: sim.cfg,
      readState: async () => {
        const state = await sim.readState();
        this.check();
        return state;
      },
      upload: (state) => sim.upload(state),
    }, step, this.ponds);
  }

  /** The single traversal for live worlds and physics-only replay twins. */
  private async walk(sim: LabSimulation, cursor: { observed: number }, target: number, observe: (step: number) => Promise<void>) {
    for (;;) {
      this.check();
      const boundary = this.boundary(cursor);
      if (sim.step === boundary) {
        await observe(boundary);
        this.check();
        cursor.observed = boundary;
        continue;
      }
      if (sim.step >= target) return;
      let n = Math.min(target, boundary) - sim.step;
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
