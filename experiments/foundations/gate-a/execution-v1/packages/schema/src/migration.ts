// Migration between tiles ("islands" of one archipelago run — see
// docs/plan.md §7, "Exchanges migration packets ... between islands of the
// same metapopulation").
//
// Design note: the plan's coordinator (apps/coordinator) schedules segments
// of *one* (experiment, preset, condition, seed) run one after another, each
// possibly executed by a different browser tab; there is no cross-run
// scheduling. Rather than teach the coordinator to interleave several
// independent run queues (a large change to Coordinator.Queue's per-run
// segment chain), this reuses the batching mechanism the schema already has
// for exactly this purpose: one run's world is tiled into `tilesX * tilesY`
// tiles, and "one tile is an independent torus" (see config.ts) — i.e. a
// single run with tilesX*tilesY > 1 already *is* an archipelago of
// islands sharing one dispatch. Migration moves cell packets between those
// tiles. This keeps determinism, replay verification and checkpoint/hash
// compatibility for free: migration is just another deterministic
// transformation of the WorldState between simulation chunks, applied by the
// same code every island runs, so two islands computing the same segment
// still agree bit-for-bit (see runner.ts's use of this module).

import { cellCount, worldW, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, CH, G, GENOME_CHANNELS, MIGRATION_SEED_SALT } from "./layout.ts";
import { cellBase, draw } from "./int.ts";
import type { WorldState } from "./world.ts";

/** One cell-packet's move from one island to its ring neighbour, for the migration log (`migrations.tsv`). */
export interface MigrationEvent {
  step: number;
  /** Which of `migrantCount` packets this event is (0-based). */
  slot: number;
  fromTile: number;
  toTile: number;
  fromCell: number;
  toCell: number;
  /** A + B + C + P quanta carried by the packet (matter moved, for per-island ledger closure checks). */
  matter: number;
  lineageHi: number;
  lineageLo: number;
}

/**
 * Applies one migration event to `state`, if `state.cfg.migrationPeriod > 0`
 * and `step` is one of its multiples (the caller checks this against the
 * *absolute* step so segmented and continuous runs trigger it at the same
 * steps — never from wall-clock time or which island happened to finish
 * first). A no-op (same state, no events) otherwise.
 *
 * For each of `migrantCount` "slots", a within-tile offset is drawn from a
 * counter-based PRNG keyed on `(seed, step, slot)`, salted so its hash chain
 * never coincides with a physics draw for the same step (see
 * `MIGRATION_SEED_SALT`'s doc), and used identically in every tile. Offsets
 * are also made unique *within one migration event*: a slot whose drawn
 * offset was already claimed by an earlier slot (0-based, so deterministic
 * regardless of iteration order) linearly reprobes the next tile-relative
 * cell index, wrapping around the tile, until it finds a free one — a
 * config-validated `migrantCount <= tileW * tileH` guarantees one exists. This
 * matters because the packets rotate by overwriting each other in place: two
 * slots landing on the same offset would silently double-log a transfer that
 * only physically happened once (the second slot's snapshot would just be a
 * copy of the first's already-rotated result), corrupting the per-island
 * ledger the event log is supposed to make exact.
 *
 * The whole cell at the chosen offset (every species channel, free energy,
 * signal, motility *and* the complete genome, lineage id included) then
 * rotates one position around the tile ring (tile t's packet lands at tile
 * `(t + 1) % T`; tile t receives tile `(t - 1) % T`'s). Because this only
 * *permutes* existing cell content — nothing is created, merged or destroyed
 * — matter (and every other conserved quantity) is exact both per island and
 * archipelago-wide, and the moved genome's lineage id is unchanged, so it
 * stays traceable across islands from the returned event log alone (append it
 * to `mutations.tsv`'s sibling `migrations.tsv`, not the mutation log itself:
 * a migration mints no new lineage id).
 */
export function applyMigration(state: WorldState, step: number): { state: WorldState; events: MigrationEvent[] } {
  const cfg: WorldConfig = state.cfg;
  const migrationPeriod = cfg.migrationPeriod ?? 0;
  const migrantCount = cfg.migrantCount ?? 0;
  const tiles = cfg.tilesX * cfg.tilesY;
  if (migrationPeriod === 0 || migrantCount === 0 || tiles < 2 || step % migrationPeriod !== 0) {
    return { state, events: [] };
  }
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const tileArea = cfg.tileW * cfg.tileH;
  const migrationSeed = (cfg.seed ^ MIGRATION_SEED_SALT) >>> 0;
  const cells = state.cells.slice();
  const genome = state.genome.slice();
  const events: MigrationEvent[] = [];
  const usedOffsets = new Set<number>();

  const cellOfTile = (t: number, lx: number, ly: number): number => {
    const tx = t % cfg.tilesX;
    const ty = (t / cfg.tilesX) | 0;
    return (ty * cfg.tileH + ly) * W + (tx * cfg.tileW + lx);
  };

  for (let slot = 0; slot < migrantCount; slot++) {
    const base = cellBase(migrationSeed, step, slot);
    let offset = draw(base, 0) % tileArea;
    while (usedOffsets.has(offset)) offset = (offset + 1) % tileArea;
    usedOffsets.add(offset);
    const lx = offset % cfg.tileW;
    const ly = (offset / cfg.tileW) | 0;
    const idx = Array.from({ length: tiles }, (_, t) => cellOfTile(t, lx, ly));

    // Snapshot every tile's packet from the *original* state before any tile
    // is overwritten, then rotate: tile t's old packet lands at tile t + 1.
    const snapCells = idx.map((i) => Array.from({ length: CELL_CHANNELS }, (_, ch) => state.cells[ch * n + i]));
    const snapGenome = idx.map((i) => Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + i]));

    for (let t = 0; t < tiles; t++) {
      const to = (t + 1) % tiles;
      const dst = idx[to];
      for (let ch = 0; ch < CELL_CHANNELS; ch++) cells[ch * n + dst] = snapCells[t][ch];
      for (let g = 0; g < GENOME_CHANNELS; g++) genome[g * n + dst] = snapGenome[t][g];
      events.push({
        step,
        slot,
        fromTile: t,
        toTile: to,
        fromCell: idx[t],
        toCell: dst,
        matter: snapCells[t][CH.A] + snapCells[t][CH.B] + snapCells[t][CH.C] + snapCells[t][CH.P],
        lineageHi: snapGenome[t][G.LIN_HI],
        lineageLo: snapGenome[t][G.LIN_LO],
      });
    }
  }
  return { state: { ...state, cells, genome }, events };
}

/** Per-tile matter (A+B+C+P quanta) totals, for ledger-closure checks around `applyMigration`. */
export function tileMatterTotals(state: WorldState): number[] {
  const cfg = state.cfg;
  const tiles = cfg.tilesX * cfg.tilesY;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const totals = new Array<number>(tiles).fill(0);
  for (let t = 0; t < tiles; t++) {
    const tx = t % cfg.tilesX;
    const ty = (t / cfg.tilesX) | 0;
    let sum = 0;
    for (let y = 0; y < cfg.tileH; y++) {
      const row = (ty * cfg.tileH + y) * W + tx * cfg.tileW;
      for (let x = 0; x < cfg.tileW; x++) {
        const i = row + x;
        sum += state.cells[CH.A * n + i] + state.cells[CH.B * n + i] + state.cells[CH.C * n + i] + state.cells[CH.P * n + i];
      }
    }
    totals[t] = sum;
  }
  return totals;
}
