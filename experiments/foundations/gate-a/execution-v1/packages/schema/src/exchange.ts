// Cross-browser ("archipelago") migration between separate runs of a
// metapopulation — see docs/plan.md §7: "Each browser tab is an island
// running an independent world. The coordinator ... exchanges migration
// packets ... between islands of the same metapopulation."
//
// This is the same ring-rotation mechanism as migration.ts (tile migration
// within one run), scaled up: instead of tiles of one grid, the "islands" are
// the whole grids of separate runs (same preset/condition, different seeds).
// At a segment boundary, a run's chosen cells are overwritten by its
// ring-predecessor's own accepted end-of-segment cells at the same
// positions — symmetric by construction, so "emigrants leave the source's
// own continuation exactly as they enter the destination's" needs no separate
// bookkeeping: what a run's own cells held at those positions *before* this
// overwrite is exactly its own emigrant packet to its ring-successor (see
// `applyExchange`'s `exports`), and archipelago-wide matter is conserved
// because this only ever relocates existing cell content, never creates or
// destroys it.
//
// The packet itself is never a separate uploaded artifact: it is a pure
// function of the ring-predecessor's own accepted checkpoint (already
// content-addressed in the coordinator's store) plus the metapopulation's
// salt and the boundary step, so a producer, an importer and a verifier all
// derive the identical packet independently — the coordinator only needs to
// hand out a *reference* to the predecessor's segment (see
// packages/runner/src/island.ts's `importFrom`), not the packet's bytes.
//
// Deliberately not sharing code with migration.ts's own offset-reprobing loop
// (a few lines, easy to duplicate) rather than refactoring already-reviewed,
// already-shipped tile-migration code to share it — lower risk than editing
// tested code for a modest de-duplication.

import { cellCount, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, CH, CROSS_MIGRATION_SEED_SALT, G, GENOME_CHANNELS } from "./layout.ts";
import { cellBase, draw } from "./int.ts";
import type { WorldState } from "./world.ts";

/** One cell's exchange at a metapopulation boundary, for `exchanges.tsv` (see runner.ts). `direction` distinguishes what a run received from its predecessor from what it gave up to its successor — both logged from the *same* run's own perspective, at the same boundary (see the module doc). */
export interface ExchangeEvent {
  step: number;
  slot: number;
  cell: number;
  /** A + B + C + P quanta carried by this cell (for per-run ledger closure checks). */
  matter: number;
  lineageHi: number;
  lineageLo: number;
}

/**
 * The global cell positions exchanged at one metapopulation boundary — the
 * same positions for every run in the ring, which is the entire point of a
 * shared `salt` (an experiment-level value, resolved and stored once by the
 * coordinator at experiment creation — see docs on `Coordinator.Queue`'s
 * `:metapopulation` spec — never independently derived here). Offsets are
 * made unique the same way migration.ts's tile offsets are: a slot whose
 * drawn offset was already claimed by an earlier slot linearly reprobes,
 * wrapping around the grid, so two slots never pick the same cell within one
 * boundary (which would otherwise double-log a transfer that only happened
 * once). `boundaryStep` is the destination segment's own start step —
 * intentionally not the source's, so a barrier where the ring's segments have
 * different `segmentSteps`-relative timing still trigger identically; in
 * practice a metapopulation's runs share one `segmentSteps`, so this is the
 * same value everywhere.
 */
export function exchangePositions(cfg: WorldConfig, salt: number, boundaryStep: number, migrantCount: number): number[] {
  const area = cellCount(cfg);
  // Validated *before* the reprobe loop below, not left for it to discover:
  // once every cell is already claimed, `while (used.has(offset))` never
  // terminates (review P2 -- a 64-cell config with migrantCount 65 hung).
  // Callers (runner.ts's specConfig, the coordinator's own experiment-
  // creation bound) are expected to already enforce this; this is the last
  // line of defense, in the one place that would otherwise hang instead of
  // failing loudly.
  if (!Number.isInteger(migrantCount) || migrantCount < 0) throw new Error(`exchangePositions: migrantCount must be a non-negative integer, got ${migrantCount}`);
  if (migrantCount > area) throw new Error(`exchangePositions: migrantCount (${migrantCount}) exceeds cell count (${area})`);
  if (!Number.isInteger(boundaryStep) || boundaryStep < 0) throw new Error(`exchangePositions: boundaryStep must be a non-negative integer, got ${boundaryStep}`);
  if (!Number.isInteger(salt) || salt < 0 || salt > 0xffffffff) throw new Error(`exchangePositions: salt must be a u32 integer, got ${salt}`);
  const seed = ((salt ^ CROSS_MIGRATION_SEED_SALT) >>> 0) >>> 0;
  const used = new Set<number>();
  const positions: number[] = [];
  for (let slot = 0; slot < migrantCount; slot++) {
    const base = cellBase(seed, boundaryStep, slot);
    let offset = draw(base, 0) % area;
    while (used.has(offset)) offset = (offset + 1) % area;
    used.add(offset);
    positions.push(offset);
  }
  return positions;
}

function cellEntry(state: WorldState, i: number, n: number) {
  return {
    cells: Array.from({ length: CELL_CHANNELS }, (_, ch) => state.cells[ch * n + i]),
    genome: Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + i]),
  };
}

const matterOf = (c: number[]) => c[CH.A] + c[CH.B] + c[CH.C] + c[CH.P];

/**
 * Overwrites `destState` (this run's own raw predecessor checkpoint — its
 * `startFrom` target) at `positions` with `sourceState`'s cells there (the
 * ring-predecessor's own accepted end checkpoint — this run's `importFrom`
 * target), producing the state this segment actually starts from.
 *
 * Returns both directions the run's bundle records at this boundary (see
 * `exchanges.tsv` in runner.ts): `imports` (what arrived from the
 * predecessor — real, new information) and `exports` (this run's *own*
 * pre-overwrite content at the same positions — exactly what this run's own
 * successor will independently derive later from this run's unmodified,
 * already-accepted checkpoint; logged here purely as a bookkeeping
 * convenience, computed while already looking at this state). Because this
 * only relocates existing cell content between two buffers — never merges,
 * never zeroes without a matching write — archipelago-wide matter is
 * conserved by construction, the same way migration.ts's tile rotation is.
 */
export function applyExchange(destState: WorldState, sourceState: WorldState, positions: number[], step: number): { state: WorldState; imports: ExchangeEvent[]; exports: ExchangeEvent[] } {
  const n = cellCount(destState.cfg);
  const srcN = cellCount(sourceState.cfg);
  const cells = destState.cells.slice();
  const genome = destState.genome.slice();
  const imports: ExchangeEvent[] = [];
  const exports: ExchangeEvent[] = [];

  positions.forEach((i, slot) => {
    const before = cellEntry(destState, i, n);
    const incoming = cellEntry(sourceState, i, srcN);
    for (let ch = 0; ch < CELL_CHANNELS; ch++) cells[ch * n + i] = incoming.cells[ch];
    for (let g = 0; g < GENOME_CHANNELS; g++) genome[g * n + i] = incoming.genome[g];
    exports.push({ step, slot, cell: i, matter: matterOf(before.cells), lineageHi: before.genome[G.LIN_HI], lineageLo: before.genome[G.LIN_LO] });
    imports.push({ step, slot, cell: i, matter: matterOf(incoming.cells), lineageHi: incoming.genome[G.LIN_HI], lineageLo: incoming.genome[G.LIN_LO] });
  });

  return { state: { ...destState, cells, genome }, imports, exports };
}

/** Total matter (A+B+C+P) of a list of exchange events, for ledger-closure checks (net = imports - exports should equal a run's own matter delta at this boundary). */
export function exchangeMatterTotal(events: ExchangeEvent[]): number {
  return events.reduce((a, e) => a + e.matter, 0);
}
