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
  HUNT_POND_COLUMNS,
  POND_COLUMNS,
  applyCurrentCycle,
  applyMigration,
  applyPondCycle,
  assertConserved,
  breedPondColumns,
  contRows,
  ledgerEnergy,
  pondMatter,
  totalsOf,
  type CycleResult,
  type MigrationEvent,
  type PondArm,
  type PondRow,
  type PondScore,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { census, individuals } from "@bl/metrics";
import { applyCellPass, type CellBirth } from "@bl/sim-ref";
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
 * `applyBoundary`, as runner.ts and the lab (apps/lab/src/execution.ts) do.
 */
export async function migrateAtBoundary(sim: BoundarySim, step: number): Promise<MigrationEvent[]> {
  if (sim.cfg.pondPeriod !== undefined) throw new Error("a pond config needs applyBoundary, which runs its pond cycle");
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

/** ponds.tsv's header line for the v1 arms (scaf, rand, cont): `POND_COLUMNS`, tab-separated. */
export const PONDS_HEADER = POND_COLUMNS.join("\t") + "\n";

/**
 * ponds.tsv's columns for a run of pond arm `arm` and config key `pondScore` `score`: `HUNT_POND_COLUMNS` for the
 * hunt's nat and shuf, `breedPondColumns` for a run with a score (the breeder and its controls: `BREED_POND_COLUMNS`,
 * plus a column per term under a combined score), `POND_COLUMNS` otherwise.
 */
export function pondColumns(arm: PondArm | undefined, score?: PondScore): readonly (keyof PondRow)[] {
  if (arm === "nat" || arm === "shuf") return HUNT_POND_COLUMNS;
  return score !== undefined ? breedPondColumns(score) : POND_COLUMNS;
}

/** ponds.tsv's header line for a run of pond arm `arm` and score `score` (`PONDS_HEADER` for the v1 arms without a score, whose files stay byte-identical). */
export function pondsHeader(arm: PondArm | undefined, score?: PondScore): string {
  return pondColumns(arm, score).join("\t") + "\n";
}

/** One boundary's ponds.tsv rows, in `columns` order (default `POND_COLUMNS`) and formatted (`String` of each value) as tools/scaffold.ts writes them. */
export function pondTsvRows(rows: PondRow[], columns: readonly (keyof PondRow)[] = POND_COLUMNS): string {
  return rows.map((r) => columns.map((c) => String(r[c])).join("\t")).join("\n") + "\n";
}

/** One pond boundary, as `applyBoundary` handled it. */
export interface PondCycle {
  /** Cycle index: the boundary's absolute step / `pondPeriod`. */
  b: number;
  /** ponds.tsv rows: one per recipient (scaf, rand) or one per pond (cont, nat, shuf). */
  rows: PondRow[];
  /**
   * No pond was eligible, so every pond was cleared to nutrient (protocol
   * v1's end of a history). The run keeps stepping the A-only world, and
   * every later cycle takes the same no-donor path (donor -1 rows). Always
   * false for cont. For nat and shuf, no pond is occupied after the cycle (the
   * history has ended and keeps stepping).
   */
  ended: boolean;
  /** Donor ponds in selection order (empty for cont and for an ended cycle; for nat and shuf, one per dying pond, empty when none died or nothing exports). */
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
 * state, transform it (`applyPondCycle` for scaf/rand, `applyCurrentCycle` for
 * the hunt's nat/shuf, with `pondCensus` for `recipientIndividuals`) or only
 * measure it (`contRows` for cont), check matter and the energy ledger exactly
 * (`assertConserved`, which throws), and upload the post-cycle state (every
 * arm but cont). `ponds` is the history's
 * `pondContext`, required when the config has the pond cycle. `picks` are
 * donors chosen by hand for the pond cycle at this step (`applyPondCycle`'s
 * `picks`, the lab's breeder); they are refused, before anything is read,
 * unless `step` is a pond boundary of arm scaf, rand or breed.
 *
 * The same contract as `migrateAtBoundary`: `step` is the absolute step, the
 * call comes after that step's census and observers (which see the
 * pre-cycle state) and before any checkpoint at it (which carries the
 * post-cycle state forward), and never at a history's own start step. A pond
 * config excludes migration (`validateConfig`), so at most one of the two
 * transforms fires.
 */
export async function applyBoundary(sim: BoundarySim, step: number, ponds: PondContext | null, picks?: readonly number[]): Promise<BoundaryResult> {
  const migrations = await migrate(sim, step);
  const period = sim.cfg.pondPeriod;
  const boundary = period !== undefined && step !== 0 && step % period === 0;
  // Picks belong to one pond cycle: with none here, or an arm that chooses no donors, they would be dropped silently.
  if (picks !== undefined && !(boundary && (sim.cfg.pondArm === "scaf" || sim.cfg.pondArm === "rand" || sim.cfg.pondArm === "breed")))
    throw new Error(`donors were picked for t=${step}, which is not a pond boundary of an arm that takes donors (scaf, rand or breed)`);
  if (period === undefined || !boundary) return { migrations, ponds: null, state: null };
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
  const cycle = transformPonds(sim.cfg, pre, b, ponds, picks);
  sim.upload(cycle.state);
  return { migrations, ponds: { b, rows: cycle.rows, ended: cycle.ended, donors: cycle.donors }, state: cycle.state };
}

/**
 * The pond cycle of arm scaf, rand, breed, nat or shuf at boundary `b` on the pre-cycle state `pre` (`applyPondCycle`
 * with the config's `pondScore`, or `applyCurrentCycle` with the config's `pondDeath` and `pondExport`, both with `pondCensus` for
 * `recipientIndividuals`), with matter and the energy ledger checked exactly (`assertConserved`, which throws).
 * `cfg` is the simulation's config (its arm and keys). Shared by `applyBoundary` and a branch's first transform
 * (`branchTransform`), so both agree bit for bit.
 */
function transformPonds(cfg: WorldConfig, pre: WorldState, b: number, ponds: PondContext, picks?: readonly number[]): CycleResult {
  const arm = cfg.pondArm;
  let cycle: CycleResult;
  if (arm === "scaf" || arm === "rand" || arm === "breed") cycle = applyPondCycle(pre, b, arm, cfg.pondK!, ponds.Mr, pondCensus, cfg.pondScore, picks);
  else if (arm === "nat" || arm === "shuf") cycle = applyCurrentCycle(pre, b, arm, cfg.pondK!, cfg.pondDeath!, cfg.pondExport!, ponds.Mr, pondCensus);
  else throw new Error(`pondArm must be scaf, rand, cont, nat, shuf or breed, got ${JSON.stringify(arm)}`);
  assertConserved(cycle.state, ponds.startMatter, ponds.baseline);
  return cycle;
}

/**
 * A branch run's first transform (docs/scaffold-transition-hunt-v1.md, "Branch contract"): boundary `b` of the hunt's
 * current (arm nat or shuf, with the branch's seed in `source.cfg`) applied on the CPU to the decoded pre-cycle
 * `source`, before any simulation exists. `ponds` is the source's own `pondContext`, so M_r and the ledger baseline are
 * the source's. Returns the cycle exactly as `applyBoundary` would (its rows go to ponds.tsv) and the post-transform
 * state the run starts stepping from. Throws if matter or the ledger is off.
 */
export function branchTransform(source: WorldState, b: number, ponds: PondContext): { ponds: PondCycle; state: WorldState } {
  const arm = source.cfg.pondArm;
  if (arm !== "nat" && arm !== "shuf") throw new Error(`a branch transform needs pondArm nat or shuf, got ${JSON.stringify(arm)}`);
  const cycle = transformPonds(source.cfg, source, b, ponds);
  return { ponds: { b, rows: cycle.rows, ended: cycle.ended, donors: cycle.donors }, state: cycle.state };
}

/**
 * Declared cells (WorldConfig.cellPeriod, cells sandbox): when `cellPeriod`
 * divides the absolute step `step` (> 0), reads the state back (or takes
 * `known`, a readback of this same step), applies `applyCellPass` to it and
 * uploads it when a cell was born. Same contract as `applyBoundary`: after
 * that step's census and observers, before any checkpoint at it. `state` is
 * the post-pass state whenever the pass ran, for a caller that needs the full
 * state at this step anyway. Only the headless runner calls this; the lab
 * does not step declared-cell worlds.
 */
export async function cellsAtBoundary(sim: BoundarySim, step: number, known: WorldState | null = null): Promise<{ births: CellBirth[]; state: WorldState | null }> {
  const period = sim.cfg.cellPeriod;
  if (period === undefined || step === 0 || step % period !== 0) return { births: [], state: null };
  const st = known ?? (await sim.readState());
  if (st.step !== step) throw new Error(`cell pass at t=${step}, but the simulation is at t=${st.step}`);
  const births = applyCellPass(st);
  if (births.length) sim.upload(st);
  return { births, state: st };
}
