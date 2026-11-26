// What the lab shows of a polymer shell (docs/pond-keeper-v3-2026-10-22.md, section 3): how many living cells hold at
// least the shell's worth of membrane (the lab's name for polymer) at one census. A pure function of that census's own
// snapshot, in the style of pond-play.ts: no DOM, no worker state, and nothing it returns enters the observers, a
// checkpoint, the session file or any digest. The page paints it; a vitest holds it to the rule.
import { CH, G, cellCount, worldW, type WorldConfig } from "@bl/schema";

/** The cells of one census that could weather a wound, and the living cells they are counted among. */
export interface ShellCount {
  /** Living cells whose membrane (channel P) is at least the world's `injuryShell`. */
  wearing: number;
  /** Living cells: lineage words not both zero, the census's own definition, whatever the cell's mass. */
  living: number;
}

/**
 * The census's eligibility, not a forecast: the rule reads a cell's membrane after the step's BUILD and decay, so a cell below
 * the shell now can build up to it before the next wound round, and a cell at it can decay or be spent by an earlier hit.
 * Whole world, not per pond.
 *
 * `cells` is the full channel-major cell array and `genome` any channel-major genome array holding at least the two lineage
 * channels (a census's `genomeHead` or a state's `genome`). Null when the config has no shell, so a world without one pays
 * nothing and shows nothing.
 */
export function shellCount(cfg: WorldConfig, cells: Uint32Array, genome: Uint32Array): ShellCount | null {
  const shell = cfg.injuryShell;
  if (shell === undefined) return null;
  const n = cellCount(cfg);
  const hi = G.LIN_HI * n, lo = G.LIN_LO * n, membrane = CH.P * n;
  let wearing = 0, living = 0;
  for (let i = 0; i < n; i++) {
    if ((genome[hi + i] | genome[lo + i]) === 0) continue;
    living++;
    if (cells[membrane + i] >= shell) wearing++;
  }
  return { wearing, living };
}

/**
 * A share of living cells, as the chart and the row print it: one decimal and a percent sign. A share above zero that one decimal
 * would print as "0.0%" prints "<0.1%", so a row that counts cells never reads zero.
 */
export function fmtShare(percent: number): string {
  return percent > 0 && percent < 0.05 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

/** Display-only counts per tile from the held pre-cycle state; never used by the breeder's rule. */
export function shellCountsByPond(cfg: WorldConfig, cells: Uint32Array, genome: Uint32Array): ShellCount[] | null {
  if (cfg.injuryShell === undefined) return null;
  const counts = Array.from({ length: cfg.tilesX * cfg.tilesY }, () => ({ wearing: 0, living: 0 }));
  const n = cellCount(cfg), width = worldW(cfg);
  for (let i = 0; i < n; i++) {
    if ((genome[G.LIN_HI * n + i] | genome[G.LIN_LO * n + i]) === 0) continue;
    const pond = Math.floor(Math.floor(i / width) / cfg.tileH) * cfg.tilesX + Math.floor((i % width) / cfg.tileW);
    counts[pond].living++;
    if (cells[CH.P * n + i] >= cfg.injuryShell) counts[pond].wearing++;
  }
  return counts;
}
