// What the pond keeper's play verbs need of a pre-cycle state, as pure functions of it (docs/pond-keeper-v1-2026-10-17.md,
// sections 2 and 3): where a kept lineage lives, and what Keep does to the donors the rule suggests. No DOM, no worker
// state: the execution surveys a waiting cycle with these, the page only paints the survey, and a vitest checks the rule.
import { G, cellCount, pondTraits, worldW, type WorldState } from "@bl/schema";

/** The kept lineage as one pre-cycle state sees it. */
export interface KeptPond {
  /** The lineage key, "hi:lo" as the census names it. */
  key: string;
  /** The pond holding the most living cells of it among ponds that can donate (ties: the lower index), or null. */
  pond: number | null;
  /** Its living cells in `pond` (0 when pond is null). */
  cells: number;
  /** Its living cells anywhere in the world: 0 means gone; above 0 with `pond` null means it lives only in ponds too thin to donate. */
  living: number;
}

/** Whether `key` has the shape of a lineage key, "hi:lo" (the census's names; whether any cell carries it is another matter). */
export const isLineageKey = (key: string): boolean => /^\d+:\d+$/.test(key);

/** "hi:lo" as two whole numbers, or null for anything else (and for 0:0, which no living cell carries). */
function parseLineageKey(key: string): [number, number] | null {
  if (!isLineageKey(key)) return null;
  const [hi, lo] = key.split(":").map(Number);
  return Number.isSafeInteger(hi) && Number.isSafeInteger(lo) && (hi | lo) !== 0 ? [hi, lo] : null;
}

/**
 * Living cells of lineage `key` per pond: a cell is living when its lineage words are not both zero (the census's
 * definition, whatever its mass), and its pond is the tile it sits in, as `pondTraits` counts them. All zeros for a key
 * that names no lineage.
 */
export function lineageCellsByPond(state: WorldState, key: string): number[] {
  const cfg = state.cfg;
  const out = new Array<number>(cfg.tilesX * cfg.tilesY).fill(0);
  const want = parseLineageKey(key);
  if (!want) return out;
  const n = cellCount(cfg), W = worldW(cfg);
  const hiWords = state.genome.subarray(G.LIN_HI * n, (G.LIN_HI + 1) * n), loWords = state.genome.subarray(G.LIN_LO * n, (G.LIN_LO + 1) * n);
  for (let i = 0; i < n; i++) {
    if (hiWords[i] !== want[0] || loWords[i] !== want[1]) continue;
    const x = i % W;
    out[Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW)]++;
  }
  return out;
}

/** Where lineage `key` lives in `state`, among the ponds that can donate (`pondTraits` above 0). */
export function keptPondOf(state: WorldState, key: string): KeptPond {
  const per = lineageCellsByPond(state, key);
  const traits = pondTraits(state);
  let living = 0, pond: number | null = null, cells = 0;
  for (let p = 0; p < per.length; p++) {
    living += per[p];
    if (traits[p] > 0 && per[p] > cells) {
      pond = p;
      cells = per[p];
    }
  }
  return { key, pond, cells, living };
}

/**
 * Keep's donor rule (contract section 3): if the kept pond is not among the rule's `suggested` donors it replaces the last
 * one (a one-donor list becomes just that pond); if it is, or there is no kept pond (nothing kept, the lineage gone, or
 * living only in ponds too thin to donate), the rule's donors stand. Never repeats a pond, never changes the count.
 */
export function donorsWithKeep(suggested: readonly number[], kept: KeptPond | null): number[] {
  const donors = suggested.slice();
  if (!kept || kept.pond === null || !donors.length || donors.includes(kept.pond)) return donors;
  donors[donors.length - 1] = kept.pond;
  return donors;
}

/** Auto-breed's choices: a number of cycles, or until stopped (`Infinity`). */
export const AUTO_BREED_CHOICES: readonly { id: string; cycles: number; label: string }[] = [
  { id: "1", cycles: 1, label: "1 cycle" },
  { id: "5", cycles: 5, label: "5 cycles" },
  { id: "20", cycles: 20, label: "20 cycles" },
  { id: "inf", cycles: Infinity, label: "Until I stop it" },
];
