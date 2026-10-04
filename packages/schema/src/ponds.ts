// Pond cycle of the ecological-scaffolding protocol (docs/scaffold-protocol-v1.md, "Pond cycle";
// docs/scaffold-integration-v1.md). Tiles are ponds: at each boundary every pond is ground back to
// nutrient and reseeded by a k x k packet copied from a donor pond. The transform is host-side and pure
// -- it runs between steps (readState -> applyPondCycle -> assertConserved -> upload), like tile
// migration, and never touches the per-step rules. Matter (A+B+C+P) per pond is restored to its initial
// value M_r, and the energy ledger closes exactly through two gross bookings (heatOut for what is ground
// up, lightIn for what lands), the way applyLesion books its heat. All arithmetic is integer; ledger sums
// are bigint. Moved unchanged from tools/lib/ponds.ts, which re-exports it beside the sandbox's world
// builders and assay helpers.
//
// The transition hunt (docs/scaffold-transition-hunt-v1.md, "The current") adds the arms nat and shuf beside
// them: ponds die at random instead of all at once, and the dying ones are reseeded from the export zone of
// a donor drawn in proportion to its export (nat) or to a shuffled copy of it (shuf). Same ground rules --
// host-side, pure, integer, matter and ledger exact -- and applyPondCycle's behaviour and output are
// untouched; the two cycles share the landing and the measurements.
//
// The breeder (wild sandbox) adds the arm breed and the config key pondScore to applyPondCycle: the cycle is v1's,
// but the donors are the ponds with the largest *score* -- a named integer measure of the pre-cycle snapshot
// (`pondScores`) -- and, among ponds of equal score, the largest bound mass, as scaf's are. With pondScore set,
// arms scaf and rand record the same score while choosing donors as they always do: the breeder's controls with
// and without selection for mass. Without pondScore every v1 output is unchanged. A score is one term (its value is
// the score) or several joined by "+", under which a pond is as good as its worst term (`pondScores`). At any
// boundary the donors can instead be given by hand (`picks`), which is how the lab's breeder lets a person choose.
import { totalsOf } from "./accounting.ts";
import { cellCount, pondScoreTerms, worldW, type PondScore, type PondTerm, type WorldConfig } from "./config.ts";
import { cellBase, draw } from "./int.ts";
import { CELL_CHANNELS, CH, G, GENOME_CHANNELS } from "./layout.ts";
import { MOT_ZERO, motilityReader, type WorldState } from "./world.ts";

/** Salts every pond-cycle random key away from the physics and mutation streams ("POND"). */
export const POND_SALT = 0x504f4e44;

/** Column order of ponds.tsv. */
export const POND_COLUMNS = [
  "cycle", "step", "recipient", "donor", "cx", "cy", "landed", "reqMass", "retMass", "reqE", "retE", "truncated",
  "packetLineages", "domHi", "domLo", "domShare", "donorTrait", "recipientTrait", "recipientIndividuals", "recipientLineages", "heat", "light",
] as const;

/**
 * Column order of ponds.tsv for the hunt's arms nat and shuf: `POND_COLUMNS` plus the pond's death, export mass
 * and donor weight. The v1 arms keep `POND_COLUMNS`, so their files stay byte-identical.
 */
export const HUNT_POND_COLUMNS = [...POND_COLUMNS, "died", "exportMass", "weight"] as const;

/**
 * Column order of ponds.tsv for a run with `pondScore` (the breeder and its control): `POND_COLUMNS` plus the
 * recipient's pre-cycle score and its donor's. Runs without `pondScore` keep their own columns.
 */
export const BREED_POND_COLUMNS = [...POND_COLUMNS, "score", "donorScore"] as const;

/**
 * Column order of ponds.tsv for a run with `pondScore` `score`: `BREED_POND_COLUMNS`, and for a combined score one
 * more column per term, named by the term and in the score's order, holding the recipient's pre-cycle value of it
 * (the `score` column of a combined score is a rank, which says nothing across cycles).
 */
export function breedPondColumns(score: PondScore): readonly (keyof PondRow)[] {
  const terms = pondScoreTerms(score);
  return terms.length === 1 ? BREED_POND_COLUMNS : [...BREED_POND_COLUMNS, ...terms];
}

export type PondArm = "scaf" | "rand" | "cont" | "nat" | "shuf" | "breed";

/**
 * The scores with conditions of their own (packages/runner/src/conditions.ts): every term (`POND_TERMS` in config.ts,
 * which documents them; "mass" makes arm breed the scaf arm exactly) and two combinations, movement that founds
 * ponds which last ("drive+seed") and the same with large bodies ("drive+seed+body"). Any other combination is a
 * valid `pondScore` too (`pondScoreTerms`). Every term is an integer measure of one pre-cycle snapshot, so the cycle
 * stays a pure function of that snapshot.
 */
export const POND_SCORES: readonly PondScore[] = ["mass", "drive", "reach", "seed", "body", "drive+seed", "drive+seed+body"];

/**
 * One recipient's row of one cycle. Integers except `domShare`; `heat` and `light` are decimal strings
 * of bigints. `cx`, `cy` are the packet centre in the donor's tile-local coordinates. The packet
 * columns (`packetLineages`, `dom*`) describe the retained landed cells with B+P > 0.
 */
export interface PondRow {
  cycle: number;
  step: number;
  recipient: number;
  donor: number;
  cx: number;
  cy: number;
  landed: number;
  reqMass: number;
  retMass: number;
  reqE: number;
  retE: number;
  truncated: number;
  packetLineages: number;
  domHi: number;
  domLo: number;
  domShare: number;
  donorTrait: number;
  recipientTrait: number;
  recipientIndividuals: number;
  recipientLineages: number;
  heat: string;
  light: string;
  /**
   * Rows of the arms nat and shuf only (absent on scaf, rand and cont rows, so their formatting is unchanged;
   * see `HUNT_POND_COLUMNS`): 1 if the pond died at this boundary, its export mass X_p and its donor weight w_p.
   * On these rows `donor` is -1 for a dying pond with no packet (no export anywhere) and -2 for a survivor.
   */
  died?: number;
  exportMass?: number;
  weight?: number;
  /**
   * Rows of a run with `pondScore` only (`BREED_POND_COLUMNS`): the recipient's pre-cycle score and its donor's
   * (0 for a row without a donor).
   */
  score?: number;
  donorScore?: number;
  /**
   * Rows of a run with a combined `pondScore` only (`breedPondColumns`): the recipient's pre-cycle value of each of
   * the score's terms.
   */
  mass?: number;
  drive?: number;
  reach?: number;
  seed?: number;
  body?: number;
}

/** Census support threshold: a cell counts toward a pond's trait, lineages and packet centre from B+P >= 48. */
const SUPPORT = 48;
/** Pond side and the landing centre, fixed by the protocol (tiles are 64x64, the packet lands at (32, 32)). */
const TILE = 64;
const CENTRE = 32;
/** Ranges of the config keys pondDeath and pondExport (config.ts), the current's per-boundary death and export threshold. */
const POND_DEATH_MAX = 65_536;
const POND_EXPORT_MAX = 32;
/** The export-zone threshold of score "reach": the hunt's zone (Chebyshev distance >= 28, 1,071 cells). */
const REACH_ZONE = 28;

const lineageKey = (hi: number, lo: number): string => `${hi}:${lo}`;
const pondCount = (cfg: WorldConfig): number => cfg.tilesX * cfg.tilesY;

function assertPondTiles(cfg: WorldConfig): void {
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
}

/** World cell index of tile-local (x, y) in `pond` (pond index = ty * tilesX + tx). */
function cellOf(cfg: WorldConfig, pond: number, x: number, y: number): number {
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
}

/** Per-pond sums of `f(cell)` over the world, in one pass. */
function perPond(state: WorldState, f: (i: number) => number): number[] {
  const cfg = state.cfg;
  const W = worldW(cfg);
  const n = cellCount(cfg);
  const out = new Array<number>(pondCount(cfg)).fill(0);
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    out[Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)] += f(i);
  }
  return out;
}

/** A+B+C+P per pond. */
export function pondMatter(state: WorldState): number[] {
  const n = cellCount(state.cfg);
  const c = state.cells;
  return perPond(state, (i) => c[CH.A * n + i] + c[CH.B * n + i] + c[CH.C * n + i] + c[CH.P * n + i]);
}

/** B+P per pond summed over cells with B+P >= 48 (the census support threshold). */
export function pondTraits(state: WorldState): number[] {
  const n = cellCount(state.cfg);
  const c = state.cells;
  return perPond(state, (i) => {
    const m = c[CH.B * n + i] + c[CH.P * n + i];
    return m >= SUPPORT ? m : 0;
  });
}

/**
 * Moving mass per pond: over cells with B+P >= 48, the sum of (B+P) * (|dx| + |dy|), where (dx, dy) is the
 * motility term `flow` adds to the cell's displacement (`motilityReader`: 1/64 cell per step, before the
 * displacement clamp, 0 without a lineage or with `motility` off, the reference gain in a neutral run).
 *
 * The support threshold is the census's and v1's trait's, on purpose: the score counts moving *bodies*. `flow`
 * moves thinner living cells too, and they are left out, so a film of cells under 48 scores nothing however it
 * is driven. |dx| + |dy| <= 254 (each axis reaches -127 at byte 0 and gain 255) and a pond's bound mass is at
 * most MATTER_MAX = 2^26, so the sum stays below 2^34 and is exact.
 */
export function pondDrives(state: WorldState): number[] {
  const n = cellCount(state.cfg);
  const c = state.cells;
  const motility = motilityReader(state);
  return perPond(state, (i) => {
    const m = c[CH.B * n + i] + c[CH.P * n + i];
    if (m < SUPPORT) return 0;
    const [dx, dy] = motility(i);
    return m * (Math.abs(dx) + Math.abs(dy));
  });
}

/** floor(a / b) for nonnegative safe integers a and b > 0, exactly (the remainder of doubles is exact). */
const floorDiv = (a: number, b: number): number => (a - (a % b)) / b;

/** Pond `p`'s B+P per cell as a tile-local raster (index y * tileW + x). */
function pondBound(state: WorldState, p: number): Float64Array {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const out = new Float64Array(cfg.tileW * cfg.tileH);
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) {
      const i = cellOf(cfg, p, x, y);
      out[y * cfg.tileW + x] = c[CH.B * n + i] + c[CH.P * n + i];
    }
  return out;
}

/**
 * Expected packet mass per pond: the mean, over the cycle's own packet-centre draw (`drawPacketCentre`: a cell with
 * B+P >= 48, probability proportional to its B+P), of the B+P in the `k` x `k` window about the centre
 * (`packetWindow`; the packet's `reqMass`, before any truncation), rounded down. 0 for a pond without such a cell.
 *
 * This is what decides whether a pond's offspring ponds last: in the first breeder run a packet under about 2,800
 * founded a pond that was empty a cycle later 19 times in 20, and one over about 3,200 a pond that lasted 19 times
 * in 20 (docs/sandbox-wild.md). The numerator is at most (a pond's bound mass)^2 <= MATTER_MAX^2 = 2^52, so every
 * sum is an exact integer.
 */
export function pondSeeds(state: WorldState, k: number): number[] {
  const cfg = state.cfg;
  const W = cfg.tileW, H = cfg.tileH;
  if (!Number.isInteger(k) || k < 1 || k > Math.min(W, H)) throw new Error(`packet size k must be in 1..${Math.min(W, H)}, got ${k}`);
  const half = k >> 1;
  const out: number[] = [];
  for (let p = 0; p < pondCount(cfg); p++) {
    const m = pondBound(state, p);
    // Window sums in two passes: along x, then along y, both wrapping inside the tile.
    const row = new Float64Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let i = 0; i < k; i++) sum += m[y * W + ((((x + i - half) % W) + W) % W)];
        row[y * W + x] = sum;
      }
    let num = 0, den = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const w = m[y * W + x];
        if (w < SUPPORT) continue;
        let window = 0;
        for (let j = 0; j < k; j++) window += row[((((y + j - half) % H) + H) % H) * W + x];
        num += w * window;
        den += w;
      }
    out.push(den > 0 ? floorDiv(num, den) : 0);
  }
  return out;
}

/**
 * Body size per pond, in 1/256 cell: a body is a set of cells with B+P >= 48 connected through their four
 * neighbours on the pond's torus, and the value is the mean number of cells in the body a unit of that bound mass
 * sits in, floor(256 * sum(cells_i * mass_i) / sum(mass_i)) over the pond's bodies i. 0 for a pond without such a
 * cell. A pond of round dots scores what one dot covers; larger or merged bodies score more. At most
 * 256 * 4,096 * MATTER_MAX = 2^46, so every sum is an exact integer.
 */
export function pondBodies(state: WorldState): number[] {
  const cfg = state.cfg;
  const W = cfg.tileW, H = cfg.tileH;
  const out: number[] = [];
  const stack: number[] = [];
  for (let p = 0; p < pondCount(cfg); p++) {
    const m = pondBound(state, p);
    const seen = new Uint8Array(W * H);
    let num = 0, den = 0;
    for (let start = 0; start < W * H; start++) {
      if (seen[start] || m[start] < SUPPORT) continue;
      let cellsIn = 0, mass = 0;
      seen[start] = 1;
      stack.push(start);
      while (stack.length) {
        const at = stack.pop()!;
        cellsIn++;
        mass += m[at];
        const x = at % W, y = (at - x) / W;
        for (const next of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), ((y + 1) % H) * W + x, ((y + H - 1) % H) * W + x]) {
          if (seen[next] || m[next] < SUPPORT) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      num += cellsIn * mass;
      den += mass;
    }
    out.push(den > 0 ? floorDiv(256 * num, den) : 0);
  }
  return out;
}

/** Each pond's value of one term (`POND_TERMS` in config.ts) on the snapshot `state`; `k` is the packet side, which "seed" needs. */
export function pondTermValues(state: WorldState, term: PondTerm, k?: number): number[] {
  if (term === "mass") return pondTraits(state);
  if (term === "drive") return pondDrives(state);
  if (term === "reach") return pondExportMasses(state, REACH_ZONE);
  if (term === "body") return pondBodies(state);
  if (term === "seed") {
    if (k === undefined) throw new Error("pond term seed needs the packet side k");
    return pondSeeds(state, k);
  }
  throw new Error(`unknown pond term ${JSON.stringify(term)}`);
}

/**
 * The combined score of ponds with the term values `values[t][pond]`: for each pond, the smallest over the terms of
 * the number of ponds whose value of that term is strictly smaller. A pond is as good as its worst term, whatever
 * the terms' units, so no term can be bought with another; a pond at the bottom of any term (an empty pond, or one
 * that does not move while "drive" is a term) scores 0.
 */
export function worstRanks(values: number[][]): number[] {
  if (!values.length) throw new Error("worstRanks needs at least one term");
  return values[0].map((_, p) => Math.min(...values.map((v) => v.reduce((below, x) => below + (x < v[p] ? 1 : 0), 0))));
}

/**
 * Each pond's `score` on the snapshot `state` (see `PondScore`): nonnegative integers, indexed by pond. One term:
 * its values. Several: `worstRanks` of theirs. `k` is the packet side, needed when "seed" is a term.
 */
export function pondScores(state: WorldState, score: PondScore, k?: number): number[] {
  const values = pondScoreTerms(score).map((term) => pondTermValues(state, term, k));
  return values.length === 1 ? values[0] : worstRanks(values);
}

/**
 * `draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose)`. Purposes 0-4 cycle, 5-6 assay source pond, 8
 * permutation; the current (nat, shuf) uses 1 (shuf's permutation, slot = pond), 3 and 4 (packet centre, slot =
 * recipient), 10 and 11 (donor draw, slot = recipient) and 12 (death, slot = pond). Arm breed uses scaf's
 * purposes, so it is scaf wherever the score does not separate two ponds.
 */
export function randomKey(seed: number, b: number, slot: number, purpose: number): number {
  return draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose);
}

/** `(hi * 2^21 + (lo >>> 11)) mod total`, exact: the numerator stays below 2^53. */
export function weightedPick(hi: number, lo: number, total: number): number {
  if (!Number.isInteger(total) || total < 1) throw new Error(`weightedPick: total must be a positive integer, got ${total}`);
  return ((hi >>> 0) * 2_097_152 + (lo >>> 11)) % total;
}

/**
 * The lineage with the largest trait mass (B+P over cells with B+P >= 48) in `ponds` (default: every pond),
 * ties to the smallest (hi, lo). Cells without a lineage are ignored. `null` if there is none.
 */
export function dominantGenome(state: WorldState, ponds?: number[]): { hi: number; lo: number; words: Uint32Array } | null {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const g = state.genome;
  const list = ponds ?? Array.from({ length: pondCount(cfg) }, (_, p) => p);
  const mass = new Map<string, { hi: number; lo: number; mass: number; cell: number }>();
  for (const p of list) {
    for (let y = 0; y < cfg.tileH; y++) {
      for (let x = 0; x < cfg.tileW; x++) {
        const i = cellOf(cfg, p, x, y);
        const m = c[CH.B * n + i] + c[CH.P * n + i];
        if (m < SUPPORT) continue;
        const hi = g[G.LIN_HI * n + i], lo = g[G.LIN_LO * n + i];
        if ((hi | lo) === 0) continue;
        const key = lineageKey(hi, lo);
        const e = mass.get(key);
        if (e) e.mass += m;
        else mass.set(key, { hi, lo, mass: m, cell: i });
      }
    }
  }
  let best: { hi: number; lo: number; mass: number; cell: number } | null = null;
  for (const e of mass.values()) {
    if (!best || e.mass > best.mass || (e.mass === best.mass && (e.hi < best.hi || (e.hi === best.hi && e.lo < best.lo)))) best = e;
  }
  if (!best) return null;
  const words = new Uint32Array(GENOME_CHANNELS);
  for (let w = 0; w < GENOME_CHANNELS; w++) words[w] = g[w * n + best.cell];
  return { hi: best.hi, lo: best.lo, words };
}

/**
 * World cell indices of the k x k window about `centreCell` (a cell of `pond`), row-major over (j, i), i.e.
 * offsets -floor(k/2) .. k-1-floor(k/2) on each axis, wrapping inside the pond's tile.
 */
export function packetWindow(state: WorldState, pond: number, k: number, centreCell: number): number[] {
  const cfg = state.cfg;
  if (!Number.isInteger(k) || k < 1 || k > Math.min(cfg.tileW, cfg.tileH)) throw new Error(`packet size k must be in 1..${Math.min(cfg.tileW, cfg.tileH)}, got ${k}`);
  const W = worldW(cfg);
  const cx = (centreCell % W) % cfg.tileW;
  const cy = Math.floor(centreCell / W) % cfg.tileH;
  const half = k >> 1;
  const out: number[] = [];
  for (let j = 0; j < k; j++) {
    const y = (((cy + j - half) % cfg.tileH) + cfg.tileH) % cfg.tileH;
    for (let i = 0; i < k; i++) {
      const x = (((cx + i - half) % cfg.tileW) + cfg.tileW) % cfg.tileW;
      out.push(cellOf(cfg, pond, x, y));
    }
  }
  return out;
}

/**
 * The weighted draw of drawPacketCentre and drawExportCentre: a cell of `pond` with B+P >= 48 (restricted to the
 * tile-local raster `zone`, index y * 64 + x, when given), probability proportional to its B+P, from purposes 3
 * (high) and 4 (low), walking the tile in raster order. `null` if there is no such cell.
 */
function drawCentre(state: WorldState, pond: number, seed: number, b: number, slot: number, zone: Uint8Array | null, who: string): number | null {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const weight = (x: number, y: number) => {
    if (zone !== null && zone[y * TILE + x] === 0) return 0;
    const i = cellOf(cfg, pond, x, y);
    const m = c[CH.B * n + i] + c[CH.P * n + i];
    return m >= SUPPORT ? m : 0;
  };
  let total = 0;
  for (let y = 0; y < cfg.tileH; y++) for (let x = 0; x < cfg.tileW; x++) total += weight(x, y);
  if (total === 0) return null;
  const v = weightedPick(randomKey(seed, b, slot, 3), randomKey(seed, b, slot, 4), total);
  let acc = 0;
  for (let y = 0; y < cfg.tileH; y++) {
    for (let x = 0; x < cfg.tileW; x++) {
      acc += weight(x, y);
      if (acc > v) return cellOf(cfg, pond, x, y);
    }
  }
  throw new Error(`${who}: unreachable, the weighted walk always ends past the draw`);
}

/**
 * The packet centre for `slot` (the recipient) in `pond` (the donor): an eligible cell (B+P >= 48) drawn with
 * probability proportional to its B+P from purposes 3 (high) and 4 (low), walking the tile in raster order.
 * `null` if the pond has no eligible cell.
 */
export function drawPacketCentre(state: WorldState, pond: number, seed: number, b: number, slot: number): number | null {
  return drawCentre(state, pond, seed, b, slot, null, "drawPacketCentre");
}

/**
 * Torus Chebyshev distance of tile-local (x, y) from the landing centre (32, 32) on the 64 x 64 torus:
 * max(dx, dy) with dx = min(|x - 32|, 64 - |x - 32|). A cell is in the export zone iff this is >= the zone's
 * threshold (config key `pondExport`); with threshold 28 that is x or y in {0..4, 60..63}, 1,071 of 4,096 cells.
 */
export function exportDistance(x: number, y: number): number {
  const dx = Math.abs(x - CENTRE), dy = Math.abs(y - CENTRE);
  return Math.max(Math.min(dx, TILE - dx), Math.min(dy, TILE - dy));
}

/** Tile-local raster mask (index y * 64 + x) of the export zone at `threshold`: 1 where `exportDistance` >= threshold. */
function exportZone(threshold: number): Uint8Array {
  if (!Number.isInteger(threshold) || threshold < 0) throw new Error(`export threshold must be a non-negative integer, got ${threshold}`);
  const zone = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) zone[y * TILE + x] = exportDistance(x, y) >= threshold ? 1 : 0;
  return zone;
}

/** Export mass X_p per pond: B+P summed over the cells of its export zone (`exportDistance` >= threshold) with B+P >= 48. */
export function pondExportMasses(state: WorldState, threshold: number): number[] {
  const cfg = state.cfg;
  assertPondTiles(cfg);
  const zone = exportZone(threshold);
  const n = cellCount(cfg);
  const c = state.cells;
  const out = new Array<number>(pondCount(cfg)).fill(0);
  for (let p = 0; p < out.length; p++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (zone[y * TILE + x] === 0) continue;
        const i = cellOf(cfg, p, x, y);
        const m = c[CH.B * n + i] + c[CH.P * n + i];
        if (m >= SUPPORT) out[p] += m;
      }
    }
  }
  return out;
}

/**
 * drawPacketCentre restricted to the donor's export zone: the same two draws (purposes 3 and 4 for `slot`) and
 * the same raster walk, with weight B+P for the zone's cells with B+P >= 48 and 0 elsewhere, so the two agree
 * when the zone is the whole tile (threshold 0). `null` if the zone has no eligible cell.
 */
export function drawExportCentre(state: WorldState, pond: number, threshold: number, seed: number, b: number, slot: number): number | null {
  assertPondTiles(state.cfg);
  return drawCentre(state, pond, seed, b, slot, exportZone(threshold), "drawExportCentre");
}

export interface CycleResult {
  state: WorldState;
  rows: PondRow[];
  /** Gross heat booked (everything ground up) and light booked (everything landed). */
  heat: bigint;
  light: bigint;
  /** True when no pond was eligible: every pond is cleared and the history is over. */
  ended: boolean;
  /** Donor ponds in selection order. */
  donors: number[];
}

/**
 * Why `picks` cannot be the donors of a cycle over ponds of bound mass `traits` (`pondTraits` of its pre-cycle
 * snapshot), or null: they must be one or more distinct occupied ponds.
 */
export function pondPickError(traits: readonly number[], picks: readonly number[]): string | null {
  if (!picks.length) return "picks must name at least one pond";
  for (const p of picks) if (!Number.isInteger(p) || p < 0 || p >= traits.length || traits[p] === 0) return `picked pond ${p} is not an occupied pond`;
  if (new Set(picks).size !== picks.length) return `picks repeat a pond: ${picks.join(", ")}`;
  return null;
}

/** Per-pond census callback of applyPondCycle and contRows, indexed by pond. */
export type PondCensus = (s: WorldState) => { individuals: number[]; lineages: number[] };

/** Distinct lineage ids among each pond's cells with B+P >= 48. */
function pondLineages(state: WorldState): number[] {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const seen = Array.from({ length: pondCount(cfg) }, () => new Set<string>());
  const W = worldW(cfg);
  for (let i = 0; i < n; i++) {
    if (state.cells[CH.B * n + i] + state.cells[CH.P * n + i] < SUPPORT) continue;
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const x = i % W;
    seen[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)].add(lineageKey(hi, lo));
  }
  return seen.map((s) => s.size);
}

/** Heat of grinding each pond back to nutrient: sum of (eB-eA)B + (eP-eA)P + (eC-eA)C + E + S over its cells. */
function pondHeat(state: WorldState): bigint[] {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const c = state.cells;
  const W = worldW(cfg);
  const dB = BigInt(cfg.eB - cfg.eA), dP = BigInt(cfg.eP - cfg.eA), dC = BigInt(cfg.eC - cfg.eA);
  const out = new Array<bigint>(pondCount(cfg)).fill(0n);
  for (let i = 0; i < n; i++) {
    const B = c[CH.B * n + i], P = c[CH.P * n + i], C = c[CH.C * n + i], E = c[CH.E * n + i], S = c[CH.S * n + i];
    if ((B | P | C | E | S) === 0) continue;
    const x = i % W;
    out[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)] += BigInt(B) * dB + BigInt(P) * dP + BigInt(C) * dC + BigInt(E) + BigInt(S);
  }
  return out;
}

const cmpKey = (a: { key: number; pond: number }, b: { key: number; pond: number }): number => a.key - b.key || a.pond - b.pond;

/**
 * The donors arm `arm` chooses at boundary `b` among ponds of bound mass `traits` (and, for breed, score `scores`),
 * in selection order: up to a quarter of the ponds, from the occupied ones. scaf: the largest bound mass, then
 * `randomKey(seed, b, pond, 0)`; breed: the largest score, then as scaf; rand: the smallest
 * `randomKey(seed, b, pond, 1)`.
 */
function armDonors(cfg: WorldConfig, b: number, arm: "scaf" | "rand" | "breed", traits: number[], scores: number[] | null): number[] {
  const seed = cfg.seed;
  const eligible: number[] = [];
  for (let p = 0; p < traits.length; p++) if (traits[p] > 0) eligible.push(p);
  const Dp = Math.min(Math.max(1, Math.floor(traits.length / 4)), eligible.length);
  let order: { pond: number; key: number }[];
  if (arm === "scaf") {
    const ranked = eligible.map((pond) => ({ pond, key: randomKey(seed, b, pond, 0), trait: traits[pond] }));
    order = ranked.sort((x, y) => y.trait - x.trait || cmpKey(x, y));
  } else if (arm === "breed") {
    if (scores === null) throw new Error("pond arm breed needs pondScore");
    const ranked = eligible.map((pond) => ({ pond, key: randomKey(seed, b, pond, 0), trait: traits[pond], score: scores[pond] }));
    order = ranked.sort((x, y) => y.score - x.score || y.trait - x.trait || cmpKey(x, y));
  } else {
    order = eligible.map((pond) => ({ pond, key: randomKey(seed, b, pond, 1) })).sort(cmpKey);
  }
  return order.slice(0, Dp).map((o) => o.pond);
}

/**
 * The donors `applyPondCycle` would choose by itself at boundary `b` on the snapshot `pre`, in its order (empty when
 * no pond is occupied): what a host shows a person before they pick, and what passing it back as `picks` reproduces
 * bit for bit.
 */
export function pondDonors(pre: WorldState, b: number, arm: "scaf" | "rand" | "breed", k: number, score?: PondScore): number[] {
  assertPondTiles(pre.cfg);
  if (arm === "breed" && score === undefined) throw new Error("pond arm breed needs pondScore");
  return armDonors(pre.cfg, b, arm, pondTraits(pre), score === undefined ? null : pondScores(pre, score, k));
}

/** A pond's A refilled uniformly to `amount`, remainder one quantum per cell in raster order. */
function refillA(cells: Uint32Array, cfg: WorldConfig, pond: number, amount: number): void {
  const n = cellCount(cfg);
  const area = cfg.tileW * cfg.tileH;
  const each = Math.floor(amount / area);
  const rem = amount - each * area;
  let r = 0;
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) cells[CH.A * n + cellOf(cfg, pond, x, y)] = each + (r++ < rem ? 1 : 0);
}

/** The packet columns of a row (everything `makeRow` zeroes except the measurements and the donor). */
type PacketFields = Pick<PondRow, "cx" | "cy" | "landed" | "reqMass" | "retMass" | "reqE" | "retE" | "truncated" | "packetLineages" | "domHi" | "domLo" | "domShare">;

/**
 * Lands the k x k packet about `centre` (a cell of `donor`, read from `pre`) at the centre of recipient `r`'s tile
 * in the post-transform `cells` and `genome`: drops landing cells in reverse raster order until the packet's B+P
 * fits `Mr` (the recipient's matter), copies B, P, E, MOT and every genome word, and refills A to Mr - retMass.
 * Returns the row's packet fields and the light that landed (the energy of the retained cells above A's).
 * Shared by the v1 cycle and the current, so the two land a window identically.
 */
function landPacket(pre: WorldState, cells: Uint32Array, genome: Uint32Array, k: number, r: number, donor: number, centre: number, Mr: number): { packet: PacketFields; light: bigint } {
  const cfg = pre.cfg;
  const n = cellCount(cfg);
  const half = k >> 1;
  const dB = BigInt(cfg.eB - cfg.eA), dP = BigInt(cfg.eP - cfg.eA);
  const window = packetWindow(pre, donor, k, centre);
  const mass = window.map((i) => pre.cells[CH.B * n + i] + pre.cells[CH.P * n + i]);
  const reqMass = mass.reduce((a, m) => a + m, 0);
  const reqE = window.reduce((a, i) => a + pre.cells[CH.E * n + i], 0);
  // Truncation: drop landing cells in reverse raster order (window order is raster order) until the packet fits.
  let kept = window.length;
  let retMass = reqMass;
  while (retMass > Mr) retMass -= mass[--kept];
  let retE = 0;
  let light = 0n;
  const packetMass = new Map<string, { hi: number; lo: number; mass: number }>();
  for (let q = 0; q < kept; q++) {
    const src = window[q];
    const dst = cellOf(cfg, r, CENTRE - half + (q % k), CENTRE - half + Math.floor(q / k));
    const B = pre.cells[CH.B * n + src], P = pre.cells[CH.P * n + src], E = pre.cells[CH.E * n + src];
    cells[CH.B * n + dst] = B;
    cells[CH.P * n + dst] = P;
    cells[CH.E * n + dst] = E;
    cells[CH.MOT * n + dst] = pre.cells[CH.MOT * n + src];
    for (let w = 0; w < GENOME_CHANNELS; w++) genome[w * n + dst] = pre.genome[w * n + src];
    retE += E;
    light += BigInt(B) * dB + BigInt(P) * dP + BigInt(E);
    const hi = pre.genome[G.LIN_HI * n + src], lo = pre.genome[G.LIN_LO * n + src];
    if (B + P > 0 && (hi | lo) !== 0) {
      const key = lineageKey(hi, lo);
      const e = packetMass.get(key);
      if (e) e.mass += B + P;
      else packetMass.set(key, { hi, lo, mass: B + P });
    }
  }
  refillA(cells, cfg, r, Mr - retMass);
  let dom: { hi: number; lo: number; mass: number } | null = null;
  for (const e of packetMass.values())
    if (!dom || e.mass > dom.mass || (e.mass === dom.mass && (e.hi < dom.hi || (e.hi === dom.hi && e.lo < dom.lo)))) dom = e;
  const W = worldW(cfg);
  const packet: PacketFields = {
    cx: (centre % W) % cfg.tileW,
    cy: Math.floor(centre / W) % cfg.tileH,
    landed: kept,
    reqMass,
    retMass,
    reqE,
    retE,
    truncated: kept < window.length ? 1 : 0,
    packetLineages: packetMass.size,
    domHi: dom?.hi ?? 0,
    domLo: dom?.lo ?? 0,
    domShare: dom && retMass > 0 ? dom.mass / retMass : 0,
  };
  return { packet, light };
}

/**
 * One cycle of the pond transform at boundary `b` (protocol steps 1-7), from the pre-cycle snapshot `pre`.
 * Pure: `pre` is not mutated. `Mr` is each pond's initial matter; the post-transform state has exactly that
 * matter in every pond and the same `ledgerEnergy` as `pre`. Throws if the pre-cycle matter of any pond is not
 * `Mr` (the ledger would not close) or the post-transform matter is not.
 *
 * `score` is the config's `pondScore`. Arm breed needs it: its donors are the D eligible ponds (bound mass > 0,
 * as for scaf) with the largest `pondScores`, equal scores ordered as scaf orders ponds (larger bound mass first,
 * then `randomKey(seed, b, pond, 0)`) -- so while no pond scores above 0 the breeder is scaf, which keeps ponds
 * productive, and a pond that scores at all outranks every pond that does not. Arms scaf and rand choose donors
 * as without it. With `score` every row also carries `score` and `donorScore`, and under a combined score each
 * term's value (`breedPondColumns`); without it the rows are v1's.
 *
 * `picks` are donors chosen by hand for this boundary (the lab's breeder): one or more distinct occupied ponds, which
 * replace the arm's choice and donate in the order given. Everything else -- which recipient takes which donor in
 * turn, the packet centres, the landing, the rows -- is the arm's, so a cycle whose picks are the arm's own donors
 * in the arm's order is the arm's cycle bit for bit. Throws on a pick that is not an occupied pond or is repeated.
 */
export function applyPondCycle(pre: WorldState, b: number, arm: "scaf" | "rand" | "breed", k: number, Mr: number[], census?: PondCensus, score?: PondScore, picks?: readonly number[]): CycleResult {
  const cfg = pre.cfg;
  assertPondTiles(cfg);
  const R = pondCount(cfg);
  const n = cellCount(cfg);
  if (Mr.length !== R) throw new Error(`Mr has ${Mr.length} ponds, the world has ${R}`);
  const preMatter = pondMatter(pre);
  for (let p = 0; p < R; p++) if (preMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${preMatter[p]} before the cycle, not ${Mr[p]}`);

  if (arm === "breed" && score === undefined) throw new Error("pond arm breed needs pondScore");
  const seed = cfg.seed;
  const traits = pondTraits(pre);
  const terms = score === undefined ? null : pondScoreTerms(score);
  const termValues = terms === null ? null : terms.map((term) => pondTermValues(pre, term, k));
  const scores = termValues === null ? null : termValues.length === 1 ? termValues[0] : worstRanks(termValues);
  const pickError = picks === undefined ? null : pondPickError(traits, picks);
  if (pickError) throw new Error(pickError);
  const donors = picks !== undefined ? [...picks] : armDonors(cfg, b, arm, traits, scores);
  const Dp = donors.length;

  const heatPond = pondHeat(pre);
  const lightPond = new Array<bigint>(R).fill(0n);
  const cells = new Uint32Array(pre.cells.length);
  cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const genome = new Uint32Array(pre.genome.length);
  const cen = census?.(pre);
  const lineages = pondLineages(pre);
  const rows: PondRow[] = [];

  if (Dp === 0) {
    for (let p = 0; p < R; p++) {
      refillA(cells, cfg, p, Mr[p]);
      rows.push(makeRow(pre, b, p, -1, traits, cen, lineages, heatPond[p], 0n));
    }
  } else {
    const recipients = Array.from({ length: R }, (_, pond) => ({ pond, key: randomKey(seed, b, pond, 2) }));
    recipients.sort(cmpKey);
    const donorOf = new Array<number>(R).fill(-1);
    recipients.forEach((r, p) => (donorOf[r.pond] = donors[p % Dp]));

    for (let r = 0; r < R; r++) {
      const donor = donorOf[r];
      const centre = drawPacketCentre(pre, donor, seed, b, r);
      if (centre === null) throw new Error(`donor pond ${donor} has no eligible cell`);
      const { packet, light } = landPacket(pre, cells, genome, k, r, donor, centre, Mr[r]);
      lightPond[r] = light;
      rows.push(Object.assign(makeRow(pre, b, r, donor, traits, cen, lineages, heatPond[r], light), packet));
    }
  }

  if (scores)
    for (const row of rows) {
      row.score = scores[row.recipient];
      row.donorScore = row.donor >= 0 ? scores[row.donor] : 0;
      if (terms!.length > 1) terms!.forEach((term, t) => (row[term] = termValues![t][row.recipient]));
    }

  const heat = heatPond.reduce((a, h) => a + h, 0n);
  const light = lightPond.reduce((a, l) => a + l, 0n);
  const post: WorldState = { cfg, step: pre.step, cells, genome, lightIn: pre.lightIn + light, heatOut: pre.heatOut + heat, flux: pre.flux.slice() };
  const postMatter = pondMatter(post);
  for (let p = 0; p < R; p++) if (postMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${postMatter[p]} after the cycle, not ${Mr[p]}`);
  return { state: post, rows, heat, light, ended: Dp === 0, donors };
}

/** A row with the recipient's pre-cycle measurements and every packet field zeroed (donor -1 and cx = cy = -1 unless set). */
function makeRow(pre: WorldState, b: number, recipient: number, donor: number, traits: number[], cen: { individuals: number[]; lineages: number[] } | undefined, lineages: number[], heat: bigint, light: bigint): PondRow {
  return {
    cycle: b,
    step: pre.step,
    recipient,
    donor,
    cx: -1,
    cy: -1,
    landed: 0,
    reqMass: 0,
    retMass: 0,
    reqE: 0,
    retE: 0,
    truncated: 0,
    packetLineages: 0,
    domHi: 0,
    domLo: 0,
    domShare: 0,
    donorTrait: donor >= 0 ? traits[donor] : 0,
    recipientTrait: traits[recipient],
    recipientIndividuals: cen ? cen.individuals[recipient] : -1,
    recipientLineages: lineages[recipient],
    heat: heat.toString(),
    light: light.toString(),
  };
}

/** The `cont` arm's summary rows at boundary `b`: one per pond, donor -1, cx = cy = -1, every packet field 0. */
export function contRows(pre: WorldState, b: number, census?: PondCensus): PondRow[] {
  const traits = pondTraits(pre);
  const cen = census?.(pre);
  const lineages = pondLineages(pre);
  return traits.map((_, p) => makeRow(pre, b, p, -1, traits, cen, lineages, 0n, 0n));
}

/** Pond `p`'s cells and genome words copied from `pre` into the post-transform arrays, bit for bit. */
function copyPond(pre: WorldState, cells: Uint32Array, genome: Uint32Array, p: number): void {
  const cfg = pre.cfg;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const tx = p % cfg.tilesX;
  const ty = (p - tx) / cfg.tilesX;
  for (let y = 0; y < cfg.tileH; y++) {
    const at = (ty * cfg.tileH + y) * W + tx * cfg.tileW;
    for (let ch = 0; ch < CELL_CHANNELS; ch++) cells.set(pre.cells.subarray(ch * n + at, ch * n + at + cfg.tileW), ch * n + at);
    for (let w = 0; w < GENOME_CHANNELS; w++) genome.set(pre.genome.subarray(w * n + at, w * n + at + cfg.tileW), w * n + at);
  }
}

/**
 * One boundary of the hunt's current (arms nat and shuf; docs/scaffold-transition-hunt-v1.md, "The current"),
 * from the pre-cycle snapshot `pre`. Pure: `pre` is not mutated; the seed is `pre.cfg.seed`. A pond dies if it
 * is unoccupied (trait 0) or `randomKey(seed, b, p, 12) < death * 65536` (`death` = `pondDeath`, 1..65,536, so
 * 65,536 kills every pond). Each dying pond r, in ascending index, draws a donor among the ponds with weight
 * w_p > 0 with probability w_p / Σw -- nat: w_p = X_p, the export mass of `pondExportMasses`; shuf: the same
 * multiset of X values dealt to the exporting ponds in the order of `randomKey(seed, b, p, 1)` -- then lands a
 * packet from the export zone of the donor's snapshot (`drawExportCentre`, window k x k) at r's centre, with
 * v1's landing. Donors may be dying ponds or r itself (propagules are released before the disturbance, and
 * read from the snapshot). Survivors are copied bit for bit. With no export anywhere (Σw = 0) every dying pond
 * is refilled with A only and gets donor -1; `ended` is true when no pond is occupied afterwards. `death` and
 * `threshold` (`pondExport`, 1..32) are the config's keys; `Mr`, `census` and the matter checks are as for
 * `applyPondCycle`. heat books only the dying ponds' grind and light only the packets that landed, so the
 * ledger closes exactly.
 *
 * Rows: one per pond in ascending index (HUNT_POND_COLUMNS). `died`, `exportMass` and `weight` on every row;
 * `donor` is the donor (packet fields as applyPondCycle's), -1 for a dying pond without a packet and -2 for a
 * survivor, whose packet fields are v1's no-packet row (cx = cy = -1, the rest 0). `donors` lists each
 * recipient's donor in ascending recipient order (empty when Σw = 0 or nobody died).
 */
export function applyCurrentCycle(
  pre: WorldState,
  b: number,
  arm: "nat" | "shuf",
  k: number,
  death: number,
  threshold: number,
  Mr: number[],
  census?: PondCensus,
): CycleResult {
  const cfg = pre.cfg;
  assertPondTiles(cfg);
  if (arm !== "nat" && arm !== "shuf") throw new Error(`the current's arm must be nat or shuf, got ${JSON.stringify(arm)}`);
  if (!Number.isInteger(death) || death < 1 || death > POND_DEATH_MAX) throw new Error(`pondDeath must be an integer in 1..${POND_DEATH_MAX}, got ${death}`);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > POND_EXPORT_MAX) throw new Error(`pondExport must be an integer in 1..${POND_EXPORT_MAX}, got ${threshold}`);
  const R = pondCount(cfg);
  const n = cellCount(cfg);
  if (Mr.length !== R) throw new Error(`Mr has ${Mr.length} ponds, the world has ${R}`);
  const preMatter = pondMatter(pre);
  for (let p = 0; p < R; p++) if (preMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${preMatter[p]} before the cycle, not ${Mr[p]}`);

  const seed = cfg.seed;
  const traits = pondTraits(pre);
  // death * 65536 <= 2^32, exact in a double, and compared with the u32 key.
  const dies = traits.map((t, p) => t === 0 || randomKey(seed, b, p, 12) < death * 65_536);

  const X = pondExportMasses(pre, threshold);
  let weight = X;
  if (arm === "shuf") {
    const exporters: number[] = [];
    for (let p = 0; p < R; p++) if (X[p] > 0) exporters.push(p);
    const order = exporters.map((pond) => ({ pond, key: randomKey(seed, b, pond, 1) }));
    order.sort(cmpKey);
    weight = new Array<number>(R).fill(0);
    order.forEach((o, j) => (weight[o.pond] = X[exporters[j]]));
  }
  const cumulative: number[] = [];
  let totalWeight = 0;
  for (let p = 0; p < R; p++) cumulative.push((totalWeight += weight[p]));

  const donorOf = dies.map((d): number => (d ? -1 : -2));
  const donors: number[] = [];
  if (totalWeight > 0) {
    for (let r = 0; r < R; r++) {
      if (!dies[r]) continue;
      const v = weightedPick(randomKey(seed, b, r, 10), randomKey(seed, b, r, 11), totalWeight);
      let donor = 0;
      while (cumulative[donor] <= v) donor++;
      donorOf[r] = donor;
      donors.push(donor);
    }
  }

  const heatPond = pondHeat(pre);
  const heatRow = heatPond.map((h, p) => (dies[p] ? h : 0n));
  const lightRow = new Array<bigint>(R).fill(0n);
  const cells = new Uint32Array(pre.cells.length);
  cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const genome = new Uint32Array(pre.genome.length);
  const cen = census?.(pre);
  const lineages = pondLineages(pre);
  const packets: (PacketFields | null)[] = new Array(R).fill(null);

  for (let r = 0; r < R; r++) {
    if (!dies[r]) copyPond(pre, cells, genome, r);
    else if (donorOf[r] < 0) refillA(cells, cfg, r, Mr[r]);
    else {
      const donor = donorOf[r];
      const centre = drawExportCentre(pre, donor, threshold, seed, b, r);
      if (centre === null) throw new Error(`donor pond ${donor} has no eligible cell in its export zone`);
      const landed = landPacket(pre, cells, genome, k, r, donor, centre, Mr[r]);
      packets[r] = landed.packet;
      lightRow[r] = landed.light;
    }
  }

  const rows: PondRow[] = [];
  for (let p = 0; p < R; p++) {
    const row = makeRow(pre, b, p, donorOf[p], traits, cen, lineages, heatRow[p], lightRow[p]);
    const packet = packets[p];
    if (packet) Object.assign(row, packet);
    row.died = dies[p] ? 1 : 0;
    row.exportMass = X[p];
    row.weight = weight[p];
    rows.push(row);
  }

  const heat = heatRow.reduce((a, h) => a + h, 0n);
  const light = lightRow.reduce((a, l) => a + l, 0n);
  const post: WorldState = { cfg, step: pre.step, cells, genome, lightIn: pre.lightIn + light, heatOut: pre.heatOut + heat, flux: pre.flux.slice() };
  const postMatter = pondMatter(post);
  for (let p = 0; p < R; p++) if (postMatter[p] !== Mr[p]) throw new Error(`pond ${p} holds matter ${postMatter[p]} after the cycle, not ${Mr[p]}`);
  return { state: post, rows, heat, light, ended: pondTraits(post).every((t) => t === 0), donors };
}

/** Σ e·X + E + S + heatOut − lightIn over the full state: the quantity the energy ledger holds constant. */
export function ledgerEnergy(state: WorldState): bigint {
  return totalsOf(state.cfg, state.cells).energy + state.heatOut - state.lightIn;
}

/** Throws unless total matter equals `startMatter` and the ledger equals `baseline` (`ledgerEnergy` of the initial state). */
export function assertConserved(state: WorldState, startMatter: bigint, baseline: bigint): void {
  const t = totalsOf(state.cfg, state.cells);
  if (t.matter !== startMatter) throw new Error(`matter not conserved at step ${state.step}: ${t.matter} != ${startMatter}`);
  const residual = ledgerEnergy(state) - baseline;
  if (residual !== 0n) throw new Error(`energy ledger residual ${residual} at step ${state.step}`);
}
