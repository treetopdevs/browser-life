// Cadence and observer integrity for one lab world. Callers serialize operations;
// the worker's generation predicate invalidates outstanding work on replacement.
import { cloneState, MAX_STEP, stateHash, type WorldState } from "@bl/schema";
import type { GpuSim } from "@bl/sim-gpu";
import type { Census } from "@bl/metrics";
import { migrateAtBoundary, observeCensus, restoreObservers, serializeObservers, type ObserverSettings, type ObserverState } from "@bl/runner";

/** Real GPU simulation in the worker; reference physics with injectable readbacks in tests. */
export type LabSimulation = Pick<GpuSim, "cfg" | "step" | "run" | "drainLedger" | "readSnapshot" | "readState" | "upload" | "destroy">;
interface ExecutionOptions {
  observer?: ObserverState;
  waitForIdle: () => Promise<unknown>;
  isCurrent: () => boolean;
  onObservation?: (census: Census, dropped: number) => void;
  onDisplayError?: (message: string) => void;
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** Raised before any submission, so the world is unchanged and remains usable. */
class StepLimitError extends Error {}

export class LabExecution {
  private readonly obs;
  private readonly cursor: { observed: number };
  private lost: string | null = null;

  constructor(private readonly sim: LabSimulation, private readonly settings: ObserverSettings, private readonly options: ExecutionOptions) {
    if (!Number.isSafeInteger(settings.censusEvery) || settings.censusEvery <= 0) throw new Error("censusEvery must be a positive integer");
    const period = sim.cfg.migrationPeriod ?? 0;
    if (period > 0 && period % settings.censusEvery !== 0) {
      throw new Error(`migrationPeriod ${period} is not a multiple of this world's censusEvery (${settings.censusEvery}); migration would fire at the wrong cadence in the lab`);
    }
    if (options.observer && options.observer.step !== sim.step) throw new Error("observer and simulation steps differ");
    this.obs = restoreObservers(options.observer, settings);
    this.cursor = { observed: sim.step };
  }

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

  /** A checkpoint always includes the observation and migration at its settled step. */
  async checkpoint() {
    this.check();
    const from = this.sim.step;
    if (from !== this.cursor.observed) await this.advanceLive(this.boundary(this.cursor));
    const state = await this.sim.readState();
    this.check();
    if (state.step !== this.cursor.observed) throw new Error(`observer state is at t=${this.cursor.observed}, not t=${state.step}`);
    return { state, observer: serializeObservers(this.obs, state.step, this.settings), advanced: state.step - from };
  }

  /** Own the replay cursor and twin lifetime so verification cannot omit a migration. */
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
        await this.migrate(twin, step);
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
    // Imported migration-enabled worlds realign to the absolute census grid.
    // Without migration, retain the history's original relative cadence.
    const rem = (this.sim.cfg.migrationPeriod ?? 0) === 0 ? 0 : cursor.observed % every;
    return cursor.observed + (rem === 0 ? every : every - rem);
  }

  private async advanceLive(target: number) {
    this.check();
    try {
      await this.walk(this.sim, this.cursor, target, async (step) => {
        const ledger = await this.sim.drainLedger();
        this.check();
        const snap = await this.sim.readSnapshot(false);
        this.check();
        if (snap.step !== step) throw new Error(`observation at t=${snap.step}, expected the census boundary t=${step}`);
        const observed = observeCensus(this.obs, this.sim.cfg, snap, ledger.events.length + ledger.dropped);
        await this.migrate(this.sim, step);
        this.check();
        // Presentation failure must not invalidate a successfully committed census.
        try {
          this.options.onObservation?.(observed.census, ledger.dropped);
        } catch (e) {
          try { this.options.onDisplayError?.(message(e)); } catch { /* Display is best effort. */ }
        }
      });
    } catch (e) {
      if (e instanceof StepLimitError) throw e;
      // Draining is destructive, observations mutate in place, and a failed
      // submission/migration may have partially changed physics. Never retry.
      if (this.options.isCurrent() && !this.lost) {
        this.lost = `census at t=${this.sim.step} failed (${message(e)}); observer history is incomplete. Restore a checkpoint or reload to continue.`;
      }
      throw e;
    }
  }

  private async migrate(sim: LabSimulation, step: number) {
    await migrateAtBoundary({
      cfg: sim.cfg,
      readState: async () => {
        const state = await sim.readState();
        this.check();
        return state;
      },
      upload: (state) => sim.upload(state),
    }, step);
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
