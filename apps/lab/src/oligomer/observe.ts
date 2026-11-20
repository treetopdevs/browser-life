/**
 * Pure observers for Phase A OligomerWorld.
 * Never mutate world state; attaching or detaching produces bit-identical world digests.
 */

import { NUM_WALL_SPECIES, SPECIES, WALL_SPECIES } from './chem.ts';
import type { OligomerWorld, StepObserver } from './model.ts';

export interface CensusRow {
  readonly step: number;
  readonly live: number;
  readonly divisions: number;
  readonly deathsStarve: number;
  readonly deathsLyse: number;
  readonly lyseEvents: number;
  readonly res0: number;
  readonly res1: number;
  readonly wallShares: readonly number[]; // length 6, fraction of total wall mass
  readonly dominantWall: number; // 0..5 or -1 if dead
  readonly dominantWallShare: number;
  readonly wallHillD1: number; // exp(H) over 6 wall motifs
  readonly genomeHillD1: number; // exp(H) over distinct sorted genomes
  readonly primaryFrac: number; // fraction of active cells with fSecondary < 0.25
  readonly mixedFrac: number; // 0.25..0.75
  readonly secondaryFrac: number; // > 0.75 (cross-feeders / scavengers)
  readonly activeCells: number;
  readonly totalFeedCleaves: number;
  readonly totalSecCleaves: number;
}

function hillD1(counts: Iterable<number>): number {
  const arr = Array.isArray(counts) ? counts : Array.from(counts);
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += arr[i];
  if (total <= 0) return 0;
  let H = 0;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c > 0) {
      const p = c / total;
      H -= p * Math.log(p);
    }
  }
  return Math.exp(H);
}

export class OligomerObserver implements StepObserver {
  private readonly feedstockSet: Set<number>;
  private readonly feedCleaves: Int32Array;
  private readonly secCleaves: Int32Array;

  private winDivisions = 0;
  private winDeathsStarve = 0;
  private winDeathsLyse = 0;
  private winLyseEvents = 0;
  private winFeedCleaves = 0;
  private winSecCleaves = 0;

  readonly rows: CensusRow[] = [];
  readonly lyseByWall = new Int32Array(NUM_WALL_SPECIES);

  constructor(world: OligomerWorld) {
    this.feedstockSet = new Set(world.cfg.feedstocks);
    this.feedCleaves = new Int32Array(world.nTiles);
    this.secCleaves = new Int32Array(world.nTiles);
  }

  onCleave(tile: number, spId: number, count: number): void {
    if (this.feedstockSet.has(spId)) {
      this.feedCleaves[tile] += count;
      this.winFeedCleaves += count;
    } else {
      this.secCleaves[tile] += count;
      this.winSecCleaves += count;
    }
  }

  onLyse(_attacker: number, _victim: number, wallIndex: number, count: number): void {
    this.winLyseEvents += count;
    this.lyseByWall[wallIndex] += count;
  }

  onDivide(_parent: number, child: number): void {
    this.winDivisions += 1;
    // Reset child's window tallies cleanly
    this.feedCleaves[child] = 0;
    this.secCleaves[child] = 0;
  }

  onDeath(tile: number, byLysis: boolean): void {
    if (byLysis) this.winDeathsLyse += 1;
    else this.winDeathsStarve += 1;
    this.feedCleaves[tile] = 0;
    this.secCleaves[tile] = 0;
  }

  onSwap(a: number, b: number): void {
    const tf = this.feedCleaves[a]; this.feedCleaves[a] = this.feedCleaves[b]; this.feedCleaves[b] = tf;
    const ts = this.secCleaves[a]; this.secCleaves[a] = this.secCleaves[b]; this.secCleaves[b] = ts;
  }

  /** Record a census snapshot and reset per-window counters. */
  sample(world: OligomerWorld): CensusRow {
    const N = world.nTiles;
    const G = world.cfg.genomeSlots;
    let live = 0;
    const wallTotals = new Float64Array(NUM_WALL_SPECIES);
    let wallSum = 0;
    const genomeCounts = new Map<string, number>();

    let primary = 0;
    let mixed = 0;
    let secondary = 0;
    let activeCells = 0;

    for (let i = 0; i < N; i++) {
      if (!world.alive[i]) continue;
      live++;
      const wBase = i * NUM_WALL_SPECIES;
      for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
        const wc = world.wall[wBase + wi];
        wallTotals[wi] += wc;
        wallSum += wc;
      }

      // Ordered genome signature (slot execution order is phenotypically meaningful)
      const gBase = i * G;
      let sig = '';
      for (let s = 0; s < G; s++) sig += (s ? ',' : '') + world.genome[gBase + s];
      genomeCounts.set(sig, (genomeCounts.get(sig) ?? 0) + 1);

      // Trophic flux classification
      const fc = this.feedCleaves[i];
      const sc = this.secCleaves[i];
      const tot = fc + sc;
      if (tot >= 4) {
        activeCells++;
        const fSec = sc / tot;
        if (fSec < 0.25) primary++;
        else if (fSec > 0.75) secondary++;
        else mixed++;
      }
    }

    const wallShares: number[] = [];
    let domWall = -1;
    let domShare = 0;
    for (let wi = 0; wi < NUM_WALL_SPECIES; wi++) {
      const sh = wallSum > 0 ? wallTotals[wi] / wallSum : 0;
      wallShares.push(sh);
      if (sh > domShare) {
        domShare = sh;
        domWall = wi;
      }
    }

    const totals = world.monomerTotals();
    const row: CensusRow = {
      step: world.stepCount,
      live,
      divisions: this.winDivisions,
      deathsStarve: this.winDeathsStarve,
      deathsLyse: this.winDeathsLyse,
      lyseEvents: this.winLyseEvents,
      res0: totals.n0 - world.initN0,
      res1: totals.n1 - world.initN1,
      wallShares,
      dominantWall: domWall,
      dominantWallShare: domShare,
      wallHillD1: hillD1(wallTotals),
      genomeHillD1: hillD1(genomeCounts.values()),
      primaryFrac: activeCells > 0 ? primary / activeCells : 0,
      mixedFrac: activeCells > 0 ? mixed / activeCells : 0,
      secondaryFrac: activeCells > 0 ? secondary / activeCells : 0,
      activeCells,
      totalFeedCleaves: this.winFeedCleaves,
      totalSecCleaves: this.winSecCleaves,
    };

    this.rows.push(row);

    // Reset window tallies
    this.winDivisions = 0;
    this.winDeathsStarve = 0;
    this.winDeathsLyse = 0;
    this.winLyseEvents = 0;
    this.winFeedCleaves = 0;
    this.winSecCleaves = 0;
    this.feedCleaves.fill(0);
    this.secCleaves.fill(0);

    return row;
  }

  /** Count dominant-wall-motif switches after `fromStep`. */
  motifSwitches(fromStep: number): number {
    let switches = 0;
    let prev = -1;
    for (const r of this.rows) {
      if (r.step < fromStep || r.dominantWall < 0) continue;
      if (prev >= 0 && r.dominantWall !== prev) switches++;
      prev = r.dominantWall;
    }
    return switches;
  }

  /** Wall species label helper. */
  static wallLabel(wi: number): string {
    return wi >= 0 && wi < NUM_WALL_SPECIES ? SPECIES[WALL_SPECIES[wi]].label : 'none';
  }
}
