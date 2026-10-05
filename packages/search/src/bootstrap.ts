// What tools/bootstrap.ts reads back from the records it continues: the score and gate an archive was
// searched with (--confirm-only confirms under those, whatever its flags say) and the seeds an earlier
// confirmation spent (--resume confirms on seeds above them). Pure, so both are tested without a GPU.

import { quality, qualityMaintenance } from "./evaluate.ts";
import type { GateName, ScoreFn } from "./mapelites.ts";

export type ScoreName = "quality" | "maintenance";
/** The archive scores a search can use (`--score`). "quality" is the default. */
export const SCORES: Record<ScoreName, ScoreFn> = { quality, maintenance: qualityMaintenance };

/**
 * The score and gate an archive was searched with, from its `search` block. tools/bootstrap.ts records
 * `score` and `gate` only when they are not the defaults, so a missing one (or a missing block) means
 * "quality" or "m3"; a value it never writes is refused. `given` holds the --score and --gate flags that
 * were passed explicitly: the archive's settings stand, and each flag that differs from them is listed in
 * `ignored` (as "--flag value (searched with value)").
 */
export function searchedWith(
  search: { score?: unknown; gate?: unknown } | undefined,
  given: { score?: string; gate?: string } = {},
): { score: ScoreName; gate: GateName; ignored: string[] } {
  const score = search?.score ?? "quality", gate = search?.gate ?? "m3";
  if (score !== "quality" && score !== "maintenance") throw new Error(`archive search block records an unknown score ${JSON.stringify(score)}`);
  if (gate !== "m3" && gate !== "maintenance") throw new Error(`archive search block records an unknown gate ${JSON.stringify(gate)}`);
  const recorded = { score, gate };
  const ignored = (["score", "gate"] as const).filter((f) => given[f] !== undefined && given[f] !== recorded[f]).map((f) => `--${f} ${given[f]} (searched with ${recorded[f]})`);
  return { score, gate, ignored };
}

type Range = [number, number];

/** The seed-bearing parts of a confirm.json written by tools/bootstrap.ts. */
export interface ConfirmSeedRecord {
  gate: { confirmSeed?: unknown; confirmSeeds?: unknown[]; dependenceSeeds?: unknown[]; batchSize?: unknown };
  dependence?: { seeds?: unknown };
  dependenceHistory?: { seeds?: unknown }[];
  rows: unknown[];
}

/**
 * Seed ranges an earlier confirmation spent, as inclusive ranges: `confirm`, its confirmation batches
 * (confirmSeeds; records from before confirmSeeds hold one range from confirmSeed), and `dependence`, its
 * dependence re-screens (gate.dependenceSeeds, dependenceHistory and the dependence block, so records from
 * before the first two still count their one re-screen). Empty ranges ([c, c - 1]: a confirmation with no
 * rows) are dropped, a dependence range listed in several places is kept once, and anything malformed throws.
 */
export function recordedSeeds(prev: ConfirmSeedRecord | undefined, file: string): { confirm: Range[]; dependence: Range[] } {
  if (!prev) return { confirm: [], dependence: [] };
  const ranges = (what: string, rs: unknown[]): Range[] =>
    rs.filter((r): r is Range => {
      if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isSafeInteger) || r[1] < r[0] - 1) throw new Error(`${file}: ${what} seed range ${JSON.stringify(r)} is not a range`);
      return r[1] >= r[0];
    });
  const g = prev.gate;
  let confirm: unknown[];
  if (g.confirmSeeds !== undefined) {
    if (!Array.isArray(g.confirmSeeds)) throw new Error(`${file}: confirmSeeds is not a list of ranges`);
    confirm = g.confirmSeeds;
  } else if (Number.isSafeInteger(g.confirmSeed) && Number.isSafeInteger(g.batchSize) && (g.batchSize as number) > 0) {
    const c = g.confirmSeed as number;
    confirm = [[c, c + Math.ceil(prev.rows.length / (g.batchSize as number)) - 1]];
  } else throw new Error(`${file}: confirmation record lacks confirmSeeds and a usable confirmSeed/batchSize`);
  if (g.dependenceSeeds !== undefined && !Array.isArray(g.dependenceSeeds)) throw new Error(`${file}: dependenceSeeds is not a list of ranges`);
  if (prev.dependenceHistory !== undefined && !Array.isArray(prev.dependenceHistory)) throw new Error(`${file}: dependenceHistory is not a list`);
  const dependence = [...(g.dependenceSeeds ?? []), ...(prev.dependenceHistory ?? []).map((h) => h?.seeds), ...(prev.dependence ? [prev.dependence.seeds] : [])];
  const seen = new Set<string>();
  return { confirm: ranges("confirmation", confirm), dependence: ranges("dependence", dependence).filter((r) => !seen.has(`${r}`) && !!seen.add(`${r}`)) };
}

/**
 * The first seed of the next confirmation: above every range an earlier confirmation spent, its dependence
 * re-screens included, or `flag` (--confirm-seed) when it spent none. tools/bootstrap.ts starts the dependence
 * re-screen right after this confirmation's last batch, so neither reuses a recorded seed.
 */
export function nextConfirmSeed(recorded: { confirm: Range[]; dependence: Range[] }, flag: number): number {
  const all = [...recorded.confirm, ...recorded.dependence];
  return all.length ? Math.max(...all.map((r) => r[1])) + 1 : flag;
}
