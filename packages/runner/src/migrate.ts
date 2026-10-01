// The one place host-side transforms between steps -- migration between tiles
// and the pond cycle -- are scheduled against a running GpuSim, shared by the
// headless runner (runner.ts), the interactive lab worker
// (apps/lab/src/sim.worker.ts) and any future replay path. Before this
// existed, the lab worker never called packages/schema's `applyMigration` at
// all: an archipelago-preset world stepped in the lab (or
// continued/imported/replay-checked there) would silently diverge from the
// same history run through the headless runner, exactly the kind of
// same-inputs-same-outputs guarantee replay verification depends on. Calling
// `applyBoundary` (or, for migration alone, `migrateAtBoundary`, which
// refuses a pond config) at every census boundary, in every place a world is
// stepped, keeps all of them bit for bit identical.
import {
  POND_COLUMNS,
  applyMigration,
  applyPondCycle,
  assertConserved,
  contRows,
  ledgerEnergy,
  pondMatter,
  totalsOf,
  type MigrationEvent,
  type PondRow,
  type WorldState,
} from "@bl/schema";
import { census, individuals } from "@bl/metrics";
import type { GpuSim } from "@bl/sim-gpu";

type BoundarySim = Pick<GpuSim, "cfg" | "readState" | "upload">;

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
 *
 * A config with the pond cycle (`pondPeriod`) throws, at any step: a caller
 * that only migrates would step such a world without its cycles and silently
 * diverge from the runner's history of it. Pond worlds go through
 * `applyBoundary`; until the lab calls it (docs/scaffold-integration-v1.md,
 * step I2), the lab marks a pond world lost at its first census instead.
 */
export async function migrateAtBoundary(sim: BoundarySim, step: number): Promise<MigrationEvent[]> {
  if (sim.cfg.pondPeriod !== undefined) throw new Error("a pond config needs applyBoundary (the lab gains the pond cycle in I2)");
  return migrate(sim, step);
}

/** `migrateAtBoundary`'s migration itself, which `applyBoundary` also runs for a pond config (where it never fires). */
async function migrate(sim: BoundarySim, step: number): Promise<MigrationEvent[]> {
  const migrationPeriod = sim.cfg.migrationPeriod ?? 0;
  if (migrationPeriod === 0 || step % migrationPeriod !== 0) return [];
  const full = await sim.readState();
  const { state: migrated, events } = applyMigration(full, full.step);
  if (events.length) sim.upload(migrated);
  return events;
}

/**
 * What the pond cycle needs besides the simulation, fixed for one history and
 * computed from wherever a caller starts stepping it: each pond's matter M_r
 * (`pondMatter`; the physics conserves it per pond and the cycle restores it,
 * so every state of the run gives the same values and nothing about it is
 * carried between segments -- docs/scaffold-integration-v1.md, "Per-pond
 * matter M_r"), and the total matter and `ledgerEnergy` each cycle's
 * `assertConserved` checks against.
 */
export interface PondContext {
  Mr: number[];
  startMatter: bigint;
  baseline: bigint;
}

/** The pond context of a history that starts (or continues) from `start`, or null when its config has no pond cycle. */
export function pondContext(start: WorldState): PondContext | null {
  if (start.cfg.pondPeriod === undefined) return null;
  return { Mr: pondMatter(start), startMatter: totalsOf(start.cfg, start.cells).matter, baseline: ledgerEnergy(start) };
}

/**
 * The census callback behind ponds.tsv's `recipientIndividuals`: the M3
 * census's individuals per pond and the distinct lineages among them, from
 * `census()`/`individuals()` with their default parameters on the pre-cycle
 * state. The same calls as tools/scaffold.ts's `pondCensus`, so the column
 * keeps protocol v1's definition.
 */
export function pondCensus(state: WorldState): { individuals: number[]; lineages: number[] } {
  const cfg = state.cfg;
  const c = census({ cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
  const R = cfg.tilesX * cfg.tilesY;
  const count = new Array<number>(R).fill(0);
  const seen = Array.from({ length: R }, () => new Set<string>());
  for (const k of individuals(c)) {
    count[k.tile]++;
    seen[k.tile].add(k.lineage);
  }
  return { individuals: count, lineages: seen.map((s) => s.size) };
}

/** ponds.tsv's header line: `POND_COLUMNS`, tab-separated. */
export const PONDS_HEADER = POND_COLUMNS.join("\t") + "\n";

/** One boundary's ponds.tsv rows, in `POND_COLUMNS` order and formatted (`String` of each value) as tools/scaffold.ts writes them. */
export function pondTsvRows(rows: PondRow[]): string {
  return rows.map((r) => POND_COLUMNS.map((c) => String(r[c])).join("\t")).join("\n") + "\n";
}

/** One pond boundary, as `applyBoundary` handled it. */
export interface PondCycle {
  /** Cycle index: the boundary's absolute step / `pondPeriod`. */
  b: number;
  /** ponds.tsv rows: one per recipient (scaf, rand) or one per pond (cont). */
  rows: PondRow[];
  /**
   * No pond was eligible, so every pond was cleared to nutrient (protocol
   * v1's end of a history). The run keeps stepping the A-only world, and
   * every later cycle takes the same no-donor path (donor -1 rows). Always
   * false for cont.
   */
  ended: boolean;
  /** Donor ponds in selection order (empty for cont and for an ended cycle). */
  donors: number[];
}

export interface BoundaryResult {
  /** Migration events at this step (`migrateAtBoundary`'s migration). */
  migrations: MigrationEvent[];
  /** The pond cycle at this step, or null when no pond boundary falls here. */
  ponds: PondCycle | null;
  /**
   * The state after this boundary when the helper read it back (every pond
   * boundary: the post-cycle state, or for cont the unchanged one), exactly
   * what a further `readState` would return; null otherwise. A caller that
   * reads the full state at this step anyway (a checkpoint, the species
   * census) can use it instead of a second readback.
   */
  state: WorldState | null;
}

/**
 * Every host-side transform due at census step `step`: migration
 * (as `migrateAtBoundary`, unchanged) and then, when `sim.cfg.pondPeriod`
 * divides `step` (> 0), the pond cycle with b = step / `pondPeriod`: read the
 * state, transform it (`applyPondCycle` for scaf/rand, with `pondCensus` for
 * `recipientIndividuals`) or only measure it (`contRows` for cont), check
 * matter and the energy ledger exactly (`assertConserved`, which throws), and
 * upload the post-cycle state (scaf/rand only). `ponds` is the history's
 * `pondContext`, required when the config has the pond cycle.
 *
 * The same contract as `migrateAtBoundary`: `step` is the absolute step, the
 * call comes after that step's census and observers (which see the
 * pre-cycle state) and before any checkpoint at it (which carries the
 * post-cycle state forward), and never at a history's own start step. A pond
 * config excludes migration (`validateConfig`), so at most one of the two
 * transforms fires.
 */
export async function applyBoundary(sim: BoundarySim, step: number, ponds: PondContext | null): Promise<BoundaryResult> {
  const migrations = await migrate(sim, step);
  const period = sim.cfg.pondPeriod;
  if (period === undefined || step === 0 || step % period !== 0) return { migrations, ponds: null, state: null };
  if (!ponds) throw new Error("a pond config needs its pond context (pondContext of the history's start state) at every boundary");
  const pre = await sim.readState();
  if (pre.step !== step) throw new Error(`pond boundary at t=${step}, but the simulation is at t=${pre.step}`);
  const b = step / period;
  const arm = sim.cfg.pondArm;
  if (arm === "cont") {
    const rows = contRows(pre, b, pondCensus);
    assertConserved(pre, ponds.startMatter, ponds.baseline);
    return { migrations, ponds: { b, rows, ended: false, donors: [] }, state: pre };
  }
  if (arm !== "scaf" && arm !== "rand") throw new Error(`pondArm must be scaf, rand or cont, got ${JSON.stringify(arm)}`);
  const cycle = applyPondCycle(pre, b, arm, sim.cfg.pondK!, ponds.Mr, pondCensus);
  assertConserved(cycle.state, ponds.startMatter, ponds.baseline);
  sim.upload(cycle.state);
  return { migrations, ponds: { b, rows: cycle.rows, ended: cycle.ended, donors: cycle.donors }, state: cycle.state };
}
