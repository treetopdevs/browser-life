// Feeding: an experimenter intervention between steps that adds dissolved
// nutrient A to every cell of a disc, or drains it from them. Unlike a lesion,
// which only converts matter in place, it changes the world's total matter:
// the world is then closed in matter only between such interventions. So it
// is never part of the rules or of a config. It is applied by a host (the
// lab), logged (Intervention, kind "feed") with the exact amount moved, and
// the host moves its conservation baselines by that amount: total matter by
// `matter`, the energy ledger by `matter * eA`. With the log, a history is
// still replayable exactly: the disc, the amount and the state at that step
// determine the result.
//
// The disc is a lesion's: centre (cx, cy), radius clamped by
// clampLesionRadius, wrapping inside the centre's tile. Feeding adds `amount`
// quanta to each cell; draining (a negative amount) removes up to that many
// from each cell and stops at zero.
import { CH } from "./layout.ts";
import { MATTER_MAX, cellCount, clampLesionRadius, worldW, type WorldConfig } from "./config.ts";
import { totalsOf } from "./accounting.ts";
import type { WorldState } from "./world.ts";

/** Largest per-cell amount one application may add or remove. */
export const FEED_MAX = 4096;

export interface FeedResult {
  /** The effective radius (clamped, as a lesion's). */
  radius: number;
  /** Cells in the disc. */
  cells: number;
  /** Quanta of A added to the world: negative when drained, 0 when a drain found nothing. */
  matter: number;
  /** Chemical energy that came with it, `matter * eA`: what the energy ledger's baseline moves by. */
  energy: bigint;
}

/** Why `amount` cannot be fed over `radius` to a world of this config, or null. */
export function feedError(cfg: WorldConfig, amount: number, radius: number): string | null {
  // A non-finite radius would clamp to NaN, feed nothing, and be logged as null: a log that replays differently.
  if (!Number.isFinite(radius)) return `feed radius must be a finite number, got ${radius}`;
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > FEED_MAX) return `feed amount must be a non-zero integer within ±${FEED_MAX} per cell, got ${amount}`;
  // Each pond's matter is fixed by its cycle and checked against the history's start (PondContext).
  if (cfg.pondPeriod !== undefined) return "feeding is not defined for pond worlds: the pond cycle fixes each pond's matter";
  return null;
}

/**
 * Feeds the nutrient channel `A` (one word per cell) in place. `matterNow` is the world's total
 * matter before the call; a feed that would take it past MATTER_MAX is refused and changes nothing.
 */
export function feedNutrient(cfg: WorldConfig, A: Uint32Array, matterNow: bigint, cx: number, cy: number, radius: number, amount: number): FeedResult {
  const err = feedError(cfg, amount, radius);
  if (err) throw new Error(err);
  const W = worldW(cfg), n = cellCount(cfg), H = n / W;
  if (A.length !== n) throw new Error(`feed: nutrient channel has ${A.length} cells, expected ${n}`);
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cx >= W || cy < 0 || cy >= H) throw new Error(`feed centre (${cx}, ${cy}) is outside the world`);
  const r = clampLesionRadius(cfg, radius);
  const { tileW, tileH } = cfg;
  const tx = Math.floor(cx / tileW), ty = Math.floor(cy / tileH);
  const disc: number[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const lx = (cx - tx * tileW + dx + tileW) % tileW, ly = (cy - ty * tileH + dy + tileH) % tileH;
      disc.push((ty * tileH + ly) * W + tx * tileW + lx);
    }
  let matter = 0;
  if (amount > 0) {
    matter = amount * disc.length;
    if (matterNow + BigInt(matter) > BigInt(MATTER_MAX)) throw new Error(`feed refused: ${matter} quanta would take the world past MATTER_MAX (${MATTER_MAX}); it holds ${matterNow}`);
    for (const j of disc) A[j] += amount;
  } else {
    for (const j of disc) {
      const take = Math.min(A[j], -amount);
      A[j] -= take;
      matter -= take;
    }
  }
  return { radius: r, cells: disc.length, matter, energy: BigInt(matter) * BigInt(cfg.eA) };
}

/** `feedNutrient` on a whole state, in place: the reference a host's own path (GpuSim.feed) must equal. */
export function applyFeed(state: WorldState, cx: number, cy: number, radius: number, amount: number): FeedResult {
  const n = cellCount(state.cfg);
  return feedNutrient(state.cfg, state.cells.subarray(CH.A * n, (CH.A + 1) * n), totalsOf(state.cfg, state.cells).matter, cx, cy, radius, amount);
}

/** Net quanta of nutrient a log's feeds added (negative: drained). */
export function fedMatter(interventions: readonly { kind: string; matter?: number }[]): number {
  let total = 0;
  for (const i of interventions) if (i.kind === "feed") total += i.matter ?? 0;
  return total;
}
