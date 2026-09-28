// The one place migration between tiles is scheduled against a running
// GpuSim, shared by the headless runner (runner.ts), the interactive lab
// worker (apps/lab/src/sim.worker.ts) and any future replay path. Before
// this existed, the lab worker never called packages/schema's
// `applyMigration` at all: an archipelago-preset world stepped in the lab (or
// continued/imported/replay-checked there) would silently diverge from the
// same history run through the headless runner, exactly the kind of
// same-inputs-same-outputs guarantee replay verification depends on. Calling
// `migrateAtBoundary` at every census boundary, in every place a world is
// stepped, keeps all of them bit-for-bit identical.
import { applyMigration, type MigrationEvent } from "@bl/schema";
import type { GpuSim } from "@bl/sim-gpu";

/**
 * If `sim.cfg.migrationPeriod` divides `step`, reads the full state back,
 * applies one migration event (packages/schema/src/migration.ts) and
 * re-uploads the result, returning the events for the caller to log (e.g.
 * runner.ts's `migrations.tsv`) — an empty array when migration doesn't
 * trigger at this step. `step` must be the *absolute* simulation step (as
 * `sim.step`/a census's own step already is), never a count relative to some
 * call's own start, so segmented/continued/imported histories agree with a
 * continuous one. runner.ts additionally requires a migration-enabled run's
 * own start to already be a multiple of censusEvery (its step loop chunks
 * relative to that start, unchanged from before migration existed), which is
 * what actually guarantees every call lands on the same absolute steps here;
 * the lab worker gets the same guarantee from the execution module's realignment
 * instead (apps/lab/src/execution.ts), since it can't refuse an
 * already-loaded world's start step the way a fresh runExperiment call can.
 *
 * Callers must call this at a *census* boundary — the same one
 * `migrationPeriod`'s validation (a multiple of `censusEvery`) assumes — and
 * before any checkpoint taken at that same step, so a checkpoint always
 * carries the post-migration state forward. Both runner.ts and the lab
 * worker do so right after recording/persisting that boundary's census.
 */
export async function migrateAtBoundary(sim: Pick<GpuSim, "cfg" | "readState" | "upload">, step: number): Promise<MigrationEvent[]> {
  const migrationPeriod = sim.cfg.migrationPeriod ?? 0;
  if (migrationPeriod === 0 || step % migrationPeriod !== 0) return [];
  const full = await sim.readState();
  const { state: migrated, events } = applyMigration(full, full.step);
  if (events.length) sim.upload(migrated);
  return events;
}
