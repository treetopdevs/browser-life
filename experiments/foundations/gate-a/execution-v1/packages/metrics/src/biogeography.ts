// Island-biogeography metrics over an archipelago run. Two distinct
// estimands, kept separate on purpose:
//   - founderPersistence*: nearest-fixed-anchor classification against the
//     M3_FOUNDERS, stable identity across time/tiles/runs -- used for
//     turnover (colonization/extinction of founder-like genetic classes).
//     This is genetic similarity, not ancestry: a living lineage that drifts
//     beyond CLUSTER_DISTANCE of its anchor registers as an extinction (and
//     drifting back, a colonization) without anything actually dying or
//     immigrating -- see experiments/biogeography-island.md's Turnover
//     section. Bounded 0..M3_FOUNDERS.length; a living cell farther than
//     CLUSTER_DISTANCE from every anchor is "unclustered" and reported
//     separately, never silently dropped.
//   - geneticRichness*: packages/schema's geneticClusters (real
//     single-linkage clustering, re-run fresh on each frame's living
//     genomes) -- the actual M3 "species" definition, unbounded, includes
//     in-situ drift/new clusters that founderPersistence cannot see. This is
//     the metric species-area/isolation analysis uses; founderPersistence
//     backs turnover only.
// Pure functions over decoded checkpoint state (packages/schema's
// decodeCheckpoint) -- no GPU/Deno dependency, unit-testable on hand-built
// synthetic data exactly like packages/metrics/src/census.ts's own functions.
import { G, GENOME_CHANNELS, cellCount, worldW, decodeGenome, lowbias32, draw, genomeDistance, geneticClusters, CLUSTER_DISTANCE, type Genome, type WorldConfig } from "@bl/schema";
import { linearFit, mean, sd, pearson, wilcoxonSignedRank, holm } from "./stats.ts";

/** One decoded full-genome snapshot of an archipelago run, e.g. from `decodeCheckpoint(bytes).state`. */
export interface SpeciesFrame {
  step: number;
  cfg: WorldConfig;
  /** Full GENOME_CHANNELS words per cell, channel-major -- NOT the genomeHead census.ts reads (only LIN_HI/LO/PARAM0/PARAM1); a checkpoint's `state.genome` already has every word. */
  genome: Uint32Array;
}

/** Sentinel species id for a living cell farther than `maxDistance` from every anchor (founderPersistence only -- geneticRichness has no sentinel, every living genome belongs to some cluster). */
export function unclusteredId(anchors: readonly unknown[]): number {
  return anchors.length;
}

function cellGenome(genome: Uint32Array, n: number, i: number): Genome {
  const words = new Uint32Array(GENOME_CHANNELS);
  for (let g = 0; g < GENOME_CHANNELS; g++) words[g] = genome[g * n + i];
  return decodeGenome(words);
}

function livingCellsByTile(frame: SpeciesFrame): { tile: number; i: number }[][] {
  const { cfg, genome } = frame;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const tiles = cfg.tilesX * cfg.tilesY;
  const out: { tile: number; i: number }[][] = Array.from({ length: tiles }, () => []);
  for (let i = 0; i < n; i++) {
    const hi = genome[G.LIN_HI * n + i], lo = genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const x = i % W, y = (i / W) | 0;
    const tile = Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    out[tile].push({ tile, i });
  }
  return out;
}

/** Bit-exact identity key for a genome's clustering-relevant fields (mu/sigma/motGain/weights). */
function genomeKey(g: Genome): string {
  return `${g.mu},${g.sigma},${g.motGain},${Array.from(g.weights).join(",")}`;
}

/**
 * Per-tile distinct living genomes (bit-exact dedup) plus the raw living-cell
 * count, shared by `geneticRichnessByTile` and `tileSpeciesCensus`. Single
 * linkage over distinct genomes is exactly equal to single linkage over every
 * living cell: identical genomes sit at distance 0, so duplicate cells always
 * join the same cluster as their first occurrence regardless of how many
 * cells carry that genome -- deduping first only removes redundant distance
 * computations, never changes which genomes end up in which cluster (proven
 * in packages/metrics/test/biogeography.test.ts). This is also the dominant
 * cost of analyzing a large tile (`geneticClusters` is O(genomes^2)), so the
 * dedup is a real performance win whenever a tile has few distinct genomes
 * relative to its living-cell count.
 */
function distinctLivingGenomes(frame: SpeciesFrame): { tile: number; genomes: Genome[]; livingCells: number }[] {
  const byTile = livingCellsByTile(frame);
  const n = cellCount(frame.cfg);
  return byTile.map((cells, tile) => {
    const seen = new Map<string, Genome>();
    for (const { i } of cells) {
      const g = cellGenome(frame.genome, n, i);
      const k = genomeKey(g);
      if (!seen.has(k)) seen.set(k, g);
    }
    return { tile, genomes: [...seen.values()], livingCells: cells.length };
  });
}

/**
 * founderPersistence: per-tile set of founder-anchor ids present in `frame`
 * (nearest anchor within `maxDistance`), or `unclusteredId(anchors)` for a
 * living cell farther than that from every anchor. Index of the returned
 * array is the tile id (`ty * cfg.tilesX + tx`, matching census.ts's
 * `Component.tile`). NOT a re-run of geneticClusters -- see the module doc
 * comment for why that's a deliberate, named, different estimand.
 */
export function founderPersistenceSets(frame: SpeciesFrame, anchors: Genome[], maxDistance = CLUSTER_DISTANCE): Set<number>[] {
  const byTile = livingCellsByTile(frame);
  const n = cellCount(frame.cfg);
  return byTile.map((cells) => {
    const set = new Set<number>();
    for (const { i } of cells) {
      const g = cellGenome(frame.genome, n, i);
      let best = -1, bestD = Infinity;
      anchors.forEach((a, k) => {
        const d = genomeDistance(g, a, maxDistance);
        if (d <= maxDistance && d < bestD) { bestD = d; best = k; }
      });
      set.add(best === -1 ? unclusteredId(anchors) : best);
    }
    return set;
  });
}

/**
 * geneticRichness: per-tile count of *actual* genetic clusters among living
 * cells in `frame`, via a fresh geneticClusters() call per tile -- no fixed
 * anchor, no ceiling, no "unclustered" bucket (every living genome is in
 * some cluster). This is the estimand species-area/isolation analysis uses.
 * Cluster ids are NOT stable across frames (single linkage re-clusters from
 * scratch each call, so id 2 at step 1000 has no relation to id 2 at step
 * 2000) -- this function is for *counts* only; founderPersistenceSets is the
 * one with time-stable identity.
 */
export function geneticRichnessByTile(frame: SpeciesFrame, maxDistance = CLUSTER_DISTANCE): number[] {
  return distinctLivingGenomes(frame).map(({ genomes }) => (genomes.length === 0 ? 0 : new Set(geneticClusters(genomes, maxDistance)).size));
}

export interface TileSpeciesRow { tile: number; geneticRichness: number; livingCells: number; founderPresenceMask: number; }

/**
 * Per-tile census for one frame, for the runner's opt-in `species.tsv`
 * (packages/runner/src/runner.ts's `RunSpec.speciesCensus`): `geneticRichness`
 * is `geneticClusters`/`CLUSTER_DISTANCE` over the tile's distinct living
 * genomes (see `distinctLivingGenomes`'s doc for why that equals clustering
 * every living cell); `livingCells` counts every living cell, duplicates
 * included; `founderPresenceMask` sets bit k iff some living genome's nearest
 * anchor (within `maxDistance`) is `anchors[k]` -- the same nearest-anchor
 * rule `founderPersistenceSets` uses, with an unclustered genome setting no
 * bit (never a sentinel bit, since the bit position itself already means
 * "this exact anchor").
 */
export function tileSpeciesCensus(frame: SpeciesFrame, anchors: Genome[], maxDistance = CLUSTER_DISTANCE): TileSpeciesRow[] {
  return distinctLivingGenomes(frame).map(({ tile, genomes, livingCells }) => {
    const geneticRichness = genomes.length === 0 ? 0 : new Set(geneticClusters(genomes, maxDistance)).size;
    let founderPresenceMask = 0;
    for (const g of genomes) {
      let best = -1, bestD = Infinity;
      anchors.forEach((a, k) => {
        const d = genomeDistance(g, a, maxDistance);
        if (d <= maxDistance && d < bestD) { bestD = d; best = k; }
      });
      if (best !== -1) founderPresenceMask |= 1 << best;
    }
    return { tile, geneticRichness, livingCells, founderPresenceMask };
  });
}

export interface RichnessRow { step: number; tile: number; richness: number; unclustered: boolean; }

/** Per-tile, per-frame founder-persistence richness (anchor count present; `unclustered` excluded from the count and reported separately by default -- pass `includeUnclustered` to fold the sentinel bucket into `richness` instead). Turnover/colonization-extinction bookkeeping (below) uses this; species-area/isolation uses `geneticRichnessByTile` instead. */
export function founderRichnessSeries(frames: SpeciesFrame[], anchors: Genome[], maxDistance = CLUSTER_DISTANCE, includeUnclustered = false): RichnessRow[] {
  const out: RichnessRow[] = [];
  for (const frame of frames) {
    founderPersistenceSets(frame, anchors, maxDistance).forEach((set, tile) => {
      const hasUnclustered = set.has(unclusteredId(anchors));
      const richness = includeUnclustered ? set.size : set.size - (hasUnclustered ? 1 : 0);
      out.push({ step: frame.step, tile, richness, unclustered: hasUnclustered });
    });
  }
  return out;
}

export interface GeneticRichnessRow { step: number; tile: number; richness: number; }

/** Per-tile, per-frame geneticRichness (see geneticRichnessByTile) -- unbounded, zero is a real, retained value (0 living clusters if the tile is empty), never excluded here (exclusion, when it happens, is speciesAreaFit's decision, made explicitly and reported, not this function's). */
export function geneticRichnessSeries(frames: SpeciesFrame[], maxDistance = CLUSTER_DISTANCE): GeneticRichnessRow[] {
  const out: GeneticRichnessRow[] = [];
  for (const frame of frames) geneticRichnessByTile(frame, maxDistance).forEach((richness, tile) => out.push({ step: frame.step, tile, richness }));
  return out;
}

export interface SpeciesAreaFit { z: number; logC: number; ci: [number, number] | null; r2: number; n: number; excludedZeros: number; zs: readonly number[]; }

/**
 * log(S) = log(c) + z*log(A), one point per (area, richness) observation
 * -- **area, not tile side length**: callers MUST pass `tileW*tileH`, never
 * `tileW` -- fitting against width alone halves the true area-exponent
 * (S=cA^0.25 recovers 0.50 if width is passed instead of area).
 *
 * Zero-richness points: NOT silently dropped -- excluding every
 * non-positive-richness row unconditionally is survivor bias when
 * small/isolated islands are disproportionately the ones that go extinct.
 * This function still needs positive richness for the log-log fit itself
 * (log(0) is undefined), so it **excludes zero-richness rows from the
 * regression but reports how many** (`excludedZeros`) and requires the
 * caller to have already computed and reported the zero-richness
 * (extinction) rate by area separately -- never fit silently on survivors
 * alone without that companion number. A caller that needs the full
 * zero-inclusive picture can additionally fit `log(S+1)` as a documented
 * sensitivity check.
 *
 * CI on z from a seeded seed-block bootstrap (packages/schema's lowbias32/draw -- no Math.random,
 * deterministic in `bootstrapSeed`), not a closed-form t interval, matching this codebase's existing
 * preference for resampling/exact methods (mannWhitney/wilcoxonSignedRank's exact tails).
 * `seedIds[i]` is the simulation seed that produced observation `i`: the sweep (tools/biogeo-sweep.ts)
 * reuses the same seed list across every area, so a run's own founder layout/permutation
 * (packages/schema/src/world.ts's `archipelagoWorld`) is shared across that seed's area points --
 * resampling individual (area, richness) points independently would treat those correlated points
 * as independent draws, understating the true CI width (the same seed-blocking `isolationEffect`'s
 * own bootstrap already uses, and for the same reason: preserve the seed pairing, never resample
 * around it). Each resample draws `k` seeds with replacement (`k` the number of distinct seeds
 * present among the positive-richness points) and keeps every one of that seed's points -- a seed
 * with two positive-richness areas contributes two points per draw of that seed, exactly as in the
 * original data. Degenerate resamples are rejected and redrawn: a resample landing only distinct
 * areas that happen to coincide leaves OLS slope mathematically unidentified -- `linearFit` returns
 * 0 in that case (stt===0 guard), which is a real, silent zero that would otherwise bias the CI
 * toward 0. This function retries a degenerate draw (all-identical x) up to 20 times before giving
 * up on that resample (extremely unlikely with 2+ distinct areas and default resamples); a resample
 * still degenerate after 20 attempts is dropped entirely, never pushed to `zs` -- keeping it would
 * silently readmit the exact bias the retry loop exists to remove. Percentiles are taken over
 * however many non-degenerate draws survive, not over the nominal `resamples` count, so a large drop
 * rate widens/shifts the reported interval instead of silently indexing past a shorter array. `zs`
 * (sorted) is exposed so callers/tests can directly audit the degenerate-rejection rate instead of
 * only inferring it from the CI width.
 *
 * `ci` is `null` when fewer than 2 distinct seeds feed the positive-richness points: with only one
 * seed block, every whole-seed-block resample draws that same block every time (there is nothing
 * else to draw), so the "bootstrap" would silently report a zero-width point interval around the
 * single point estimate -- indistinguishable from real certainty. A null CI is a real "not enough
 * independent replicates" result, reported as such, never a degenerate `[z, z]`.
 */
export function speciesAreaFit(areas: number[], richness: number[], seedIds: number[], bootstrapSeed: number, resamples = 2000): SpeciesAreaFit {
  if (areas.length !== richness.length || areas.length !== seedIds.length) throw new Error("speciesAreaFit: areas/richness/seedIds length mismatch");
  const keep = areas.map((a, i) => ({ a, r: richness[i], s: seedIds[i] })).filter(({ r }) => r > 0);
  const excludedZeros = areas.length - keep.length;
  const n = keep.length;
  if (n < 3) throw new Error(`speciesAreaFit needs at least 3 positive-richness points (got ${n} of ${areas.length}; ${excludedZeros} excluded as zero-richness -- report the zero rate separately, don't just lower this bar)`);
  if (keep.some(({ a }) => !(a > 0))) throw new Error("speciesAreaFit needs positive areas (pass tileW*tileH, not tileW)");
  const distinctAreas = new Set(keep.map(({ a }) => a)).size;
  if (distinctAreas < 2)
    throw new Error(
      `speciesAreaFit needs at least 2 distinct surviving areas to identify a slope (got ${distinctAreas} distinct area(s) among ${n} positive-richness points) -- extinction has left only one area value, so z is statistically unidentified, not precisely zero`,
    );
  const x = keep.map(({ a }) => Math.log(a)), y = keep.map(({ r }) => Math.log(r));
  const fit = linearFit(x, y);
  // Seed blocks: every kept point's index, grouped by the simulation seed that produced it.
  const bySeed = new Map<number, number[]>();
  keep.forEach(({ s }, i) => bySeed.set(s, [...(bySeed.get(s) ?? []), i]));
  const seedList = [...bySeed.keys()];
  const zs: number[] = [];
  // Fewer than 2 seed blocks: every whole-seed-block resample would draw the same single block
  // every time (nothing else to draw), producing a flood of identical, non-degenerate-looking
  // slopes and a zero-width CI that misrepresents a lack of replicates as certainty -- so the
  // bootstrap never runs at all in that case, and `ci` is reported as unavailable (null) below.
  if (seedList.length >= 2) {
    for (let b = 0; b < resamples; b++) {
      let idx: number[] = [];
      let ok = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const base = lowbias32(bootstrapSeed ^ (b + 1) ^ (attempt * 0x1000003));
        const resampledSeeds = Array.from({ length: seedList.length }, (_, k) => seedList[draw(base, k) % seedList.length]);
        idx = resampledSeeds.flatMap((sid) => bySeed.get(sid)!);
        if (new Set(idx.map((i) => x[i])).size > 1) { ok = true; break; } // reject degenerate (all-same-area) resamples
      }
      if (!ok) continue; // exhausted retries on a degenerate resample -- drop it, never keep a degenerate slope
      zs.push(linearFit(idx.map((i) => x[i]), idx.map((i) => y[i])).slope);
    }
    zs.sort((a, b) => a - b);
    if (zs.length < 2) throw new Error(`speciesAreaFit: only ${zs.length} of ${resamples} bootstrap resamples were non-degenerate -- too few to form a CI`);
  }
  const ci: [number, number] | null = seedList.length >= 2 ? [zs[Math.floor(0.025 * zs.length)], zs[Math.min(zs.length, Math.ceil(0.975 * zs.length)) - 1]] : null;
  return { z: fit.slope, logC: fit.intercept, ci, r2: fit.r2, n, excludedZeros, zs };
}

export interface IsolationObservation {
  /** This run's seed -- the sweep's matched-seed design reuses the same seed list across every
   * rate (including the no-migration control), so pairing observations by seed is what actually
   * removes seed-to-seed variance from the rate comparison. */
  seed: number;
  richness: number;
}

export interface IsolationSummary {
  meanByRate: { rate: number; mean: number; sd: number; n: number }[];
  /**
   * Prespecified primary test: does richness trend with rate at all, after removing each seed's
   * own location (a seed-blocked/demeaned Pearson correlation -- see this function's own doc for
   * why the raw pooled correlation is not safe here). NaN when no seed contributes more than one
   * rate (nothing left to correlate after demeaning), matching `pearson`'s own zero-variance
   * convention -- a real "no seed-blocked signal available" result, not a computation failure.
   */
  trendCorrelation: number;
  /** Number of (seed, rate) observations that fed `trendCorrelation` (after demeaning) -- a seed
   * observed at only one rate still counts here (its demeaned value is exactly 0, contributing no
   * trend evidence but not excluded from `n` either). */
  trendN: number;
  /** 95% CI on `trendCorrelation` from a seed-block bootstrap (resampling whole seeds, each with
   * every rate it was observed at, WITH replacement -- never resampling individual (seed,rate)
   * points independently, which would break the seed pairing the point estimate itself relies on),
   * deterministic via this codebase's existing lowbias32/draw resampling idiom (see
   * `speciesAreaFit`). `null` when fewer than 2 seeds are actually *paired* -- observed at more
   * than one rate, the only seeds that can contribute real trend evidence. A seed observed at a
   * single rate contributes a centered (0,0) to every resample; that point can sit exactly on the
   * line two truly paired seeds' points already define, so it does not reliably show up as
   * degenerate on its own -- counting genuine pairs directly is what catches it.
   *
   * A resample whose demeaned richness happens to be constant (e.g. it omits the only seed that
   * shows any response) makes Pearson's correlation mathematically undefined (0/0) -- that
   * resample carries genuine "no linear signal detected" evidence, not a computation error, so it
   * counts as `0` toward the percentile distribution rather than being dropped. Dropping it instead
   * would condition the CI on the resample having kept a responsive seed, which with few paired
   * seeds inflates the interval away from 0 -- e.g. with 5 paired seeds and only one showing a
   * response, ~31% of resamples are degenerate this way, and dropping them would report
   * [0.4472, 0.7746] (excluding 0 entirely) instead of the honest [0, 0.7746] that counting them as
   * 0 produces. */
  trendCI: [number, number] | null;
  /** Exploratory only: best observed positive rate vs. no-migration, Holm-corrected across the `positive.length` comparisons actually available, i.e. treated as if every positive rate had been compared to zero and only the best survived correction -- a conservative stand-in for a full run-level permutation test over the selection procedure, not a substitute for prespecifying the contrast. A Wilcoxon matched-pairs signed-rank test over this rate's seed-paired difference from the no-migration control (never an unpaired Mann-Whitney -- see this function's own doc), so `effect` is the matched-pairs rank-biserial correlation `(2*W - n(n+1)/2) / (n(n+1)/2)`, not mannWhitney's U-based effect; both range -1..1 with the same sign convention (positive: the rate tends to exceed the control). Labeled explicitly `exploratory: true` so report code can't present it as confirmatory. */
  bestRateVsNoMigration: ReturnType<typeof wilcoxonSignedRank> & { rate: number | undefined; exploratory: true; holmAdjustedP: number; effect: number };
}

/**
 * `byRate.get(0)` is the no-migration control; each entry is one point per
 * **independent run** (see the module's callers -- never one point per tile
 * within a migration-connected run; only no-migration tiles are physically
 * independent of each other), tagged with the seed that produced it.
 *
 * `bestRateVsNoMigration` pairs observations **by seed**, not by pooling: the
 * sweep (`tools/biogeo-sweep.ts`'s `buildSweepPoints`) reuses the same seed
 * list across every rate including the zero-rate control, a matched design an
 * unpaired test throws away -- pooling into an unpaired Mann-Whitney can miss
 * a real, consistent per-seed effect that the correct paired signed-rank test
 * over the same seed-matched differences detects -- Holm correction cannot
 * repair a wrong sampling model. A seed present on one side only (e.g. an
 * eligibility rejection) contributes no pair and is silently excluded from
 * that rate's comparison, never treated as a zero difference.
 *
 * Throws if `byRate` has no rate-0 entry, rather than silently degrading
 * `bestRateVsNoMigration` to all-NaN and `trendCorrelation` to a trend over
 * an incomplete rate family -- a caller that can't find the control point
 * must reject the analysis, not report a NaN-corrupted one as if it were
 * real (see tools/biogeo-analyze.ts's arm-membership pooling, the usual
 * reason a rate-0 point goes missing when it's actually present on disk).
 *
 * `trendCorrelation` is seed-blocked -- both rate and richness demeaned per seed (the panel-data
 * "within" estimator: differencing out each seed's own fixed effect from both variables before
 * correlating) -- never a raw pool of every (rate, richness) observation across every rate.
 * Pooling raw values confounds migration rate with *seed composition* whenever the surviving seed
 * set differs across rates (e.g. after upstream eligibility rejections) or seeds are observed over
 * different rate ranges, which the matched-seed design's own point estimate (`meanByRate`) does not
 * control for on its own. Demeaning richness alone is not enough: leaving rate raw still lets
 * between-seed differences in *which rates a seed was observed at* leak into the pooled correlation
 * through rate's own variance term. Centering both removes this: a seed observed at only one rate
 * contributes a centered value of exactly 0 on both axes (correctly no trend evidence from a single
 * point), and a seed observed at several rates contributes only its own within-seed covariation, the
 * same "incomplete block" handling `bestRateVsNoMigration`'s pairing already uses (a seed missing
 * from one side is simply not paired there, never synthesized as a zero difference).
 */
export function isolationEffect(byRate: Map<number, IsolationObservation[]>, bootstrapSeed = 1, bootstrapResamples = 2000): IsolationSummary {
  if (!byRate.has(0))
    throw new Error(`isolationEffect requires a no-migration (rate=0) control; got rates [${[...byRate.keys()].sort((a, b) => a - b).join(",")}] with no rate=0 entry`);
  const rates = [...byRate.keys()].sort((a, b) => a - b);
  const meanByRate = rates.map((rate) => { const xs = byRate.get(rate)!.map((o) => o.richness); return { rate, mean: mean(xs), sd: sd(xs), n: xs.length }; });
  // Per-seed (rate, richness) pairs, across every rate that seed was actually observed at --
  // the seed-blocking unit for both the trend point estimate and its bootstrap CI below.
  const bySeed = new Map<number, { rate: number; richness: number }[]>();
  for (const [rate, obs] of byRate) for (const o of obs) bySeed.set(o.seed, [...(bySeed.get(o.seed) ?? []), { rate, richness: o.richness }]);
  // Both variables centered per seed (the "within" estimator): leaving rate raw while only
  // demeaning richness would still let between-seed differences in *which rates a seed was
  // observed at* leak into the pooled correlation through rate's own between-seed variance.
  const demeanedTrend = (seeds: number[]): { xs: number[]; ys: number[] } => {
    const xs: number[] = [], ys: number[] = [];
    for (const s of seeds) {
      const entries = bySeed.get(s)!;
      const seedRateMean = mean(entries.map((e) => e.rate));
      const seedRichnessMean = mean(entries.map((e) => e.richness));
      for (const e of entries) { xs.push(e.rate - seedRateMean); ys.push(e.richness - seedRichnessMean); }
    }
    return { xs, ys };
  };
  const seedIds = [...bySeed.keys()];
  const { xs: trendRates, ys: trendCentered } = demeanedTrend(seedIds);
  const trendCorrelation = pearson(trendRates, trendCentered);
  const trendN = trendRates.length;
  // Seed-block bootstrap CI: resample whole seeds (with replacement), never individual (seed,
  // rate) points -- resampling points independently would discard the very seed pairing the
  // demeaning above relies on. Deterministic via lowbias32/draw (this codebase's existing
  // seeded-resampling idiom; see speciesAreaFit's bootstrap CI on z).
  //
  // Gated on seeds actually *paired* (observed at more than one rate), not merely `seedIds.length`:
  // a seed observed at a single rate always centers to exactly (0,0), and that point can sit right
  // on the line two truly paired seeds' points already define -- so a resample mixing one paired
  // seed with any number of unpaired ones can still look perfectly correlated, silently treating an
  // effectively single-seed estimate as if it had independent replicates behind it.
  const pairedSeeds = seedIds.filter((s) => new Set(bySeed.get(s)!.map((e) => e.rate)).size > 1);
  const boot: number[] = [];
  if (pairedSeeds.length >= 2) {
    for (let b = 0; b < bootstrapResamples; b++) {
      const base = lowbias32(bootstrapSeed ^ (b + 1));
      const resampledSeeds = Array.from({ length: seedIds.length }, (_, k) => seedIds[draw(base, k) % seedIds.length]);
      const { xs, ys } = demeanedTrend(resampledSeeds);
      const c = pearson(xs, ys);
      // Undefined (0/0) means this resample's demeaned richness was constant -- a real "no
      // linear signal in this resample" outcome, not a failure -- so it counts as 0 rather than
      // being dropped (dropping would condition the CI on resamples that happened to keep a
      // responsive seed; see this field's doc comment above).
      boot.push(Number.isFinite(c) ? c : 0);
    }
    boot.sort((a, b) => a - b);
  }
  // An undefined point estimate (no within-seed variance in richness) has no meaningful CI.
  const trendCI: [number, number] | null = Number.isFinite(trendCorrelation) && boot.length >= 2 ? [boot[Math.floor(0.025 * boot.length)], boot[Math.min(boot.length, Math.ceil(0.975 * boot.length)) - 1]] : null;
  const zeroBySeed = new Map(byRate.get(0)!.map((o) => [o.seed, o.richness]));
  const positive = rates.filter((r) => r > 0);
  const pairedDiffs = positive.map((r) => byRate.get(r)!.filter((o) => zeroBySeed.has(o.seed)).map((o) => o.richness - zeroBySeed.get(o.seed)!));
  const signedRank = pairedDiffs.map((d) => wilcoxonSignedRank(d));
  const pValues = signedRank.map((r) => r.p);
  const adjusted = holm(pValues);
  let bestIdx = -1;
  positive.forEach((r, i) => { if (bestIdx === -1 || mean(byRate.get(r)!.map((o) => o.richness)) > mean(byRate.get(positive[bestIdx])!.map((o) => o.richness))) bestIdx = i; });
  const best = bestIdx === -1 ? undefined : positive[bestIdx];
  const bestResult = bestIdx === -1 ? { n: 0, W: 0, p: NaN, pGreater: NaN, exact: false } : signedRank[bestIdx];
  const bestTotal = (bestResult.n * (bestResult.n + 1)) / 2;
  const bestEffect = bestTotal > 0 ? (2 * bestResult.W - bestTotal) / bestTotal : NaN;
  return {
    meanByRate,
    trendCorrelation,
    trendN,
    trendCI,
    bestRateVsNoMigration: { ...bestResult, rate: best, exploratory: true, holmAdjustedP: bestIdx === -1 ? NaN : adjusted[bestIdx], effect: bestEffect },
  };
}

export interface TurnoverRow { step: number; tile: number; colonizations: number; extinctions: number; richness: number; elapsedSteps: number; }

/**
 * One tile's ordered founder-identity history (founderPersistenceSets output
 * with the unclustered sentinel already filtered out by the caller).
 * Colonization = present now, absent last frame; extinction = the reverse.
 * `elapsedSteps` is `history[i].step - history[i-1].step` (0 for the first
 * row) -- callers MUST use this to normalize rates before comparing runs
 * with different checkpoint cadences: a coarser `--checkpoint` merges
 * several true events into one observed transition, so raw per-frame counts
 * are not comparable across cadences, only per-step-normalized ones are, and
 * even those should be reported with the cadence stated, not treated as
 * continuous-time rates.
 *
 * `history[0]` MUST be the run's true initial state (step of the very first
 * archipelago-init, not the first *checkpoint*, which under a coarse
 * `checkpointEvery` happens well after founders were placed) -- treating the
 * first *available checkpoint* as the baseline mislabels every surviving
 * founder as a "new colonist" at that first checkpoint. Callers must supply
 * species.tsv's own step-0 row as `history[0]` (the runner writes it from the
 * real initial state before its step loop -- already the true baseline, no
 * reconstruction needed; see tools/biogeo-analyze.ts's `runTurnoverFromSpecies`),
 * never a checkpoint-only history.
 */
export function turnoverSeries(history: { step: number; species: Set<number> }[]): TurnoverRow[] {
  const out: TurnoverRow[] = [];
  for (let i = 0; i < history.length; i++) {
    const cur = history[i].species;
    const prev = i > 0 ? history[i - 1].species : new Set<number>();
    let colonizations = 0, extinctions = 0;
    for (const s of cur) if (!prev.has(s)) colonizations++;
    for (const s of prev) if (!cur.has(s)) extinctions++;
    out.push({ step: history[i].step, tile: -1, colonizations, extinctions, richness: cur.size, elapsedSteps: i > 0 ? history[i].step - history[i - 1].step : 0 });
  }
  return out;
}

export interface TurnoverEquilibrium { crossingStep: number | null; equilibriumRichness: number | null; }

/**
 * MacArthur-Wilson equilibrium: the step after which a smoothed extinction
 * rate first reaches or exceeds the smoothed colonization rate, **richness
 * over the remaining tail is approximately flat** (within `flatTolerance`
 * of its own mean, a prespecified tolerance, not "whatever the data does"),
 * **and at least `minSpan` observations remain** from the crossing point.
 * The naive criterion (extinction >= colonization for the rest of the
 * series) is also satisfied by pure decline with zero colonizations, and by
 * a single final extinction-heavy observation with no evidence after it;
 * neither is equilibrium. A tail that crosses but keeps declining, or is too
 * short to judge, returns nulls -- "not yet at equilibrium" is a real,
 * reportable result, not a function failure.
 */
export function turnoverEquilibrium(allRows: TurnoverRow[], smoothWindow = 3, minSpan = 5, flatTolerance = 0.15): TurnoverEquilibrium {
  // Rates per elapsed step, so intervals of different lengths (e.g. a short final census) are
  // comparable; the zero-duration baseline row carries no rate and is excluded.
  const rows = allRows.filter((r) => r.elapsedSteps > 0);
  const smooth = (get: (r: TurnoverRow) => number) => rows.map((_, i) => mean(rows.slice(Math.max(0, i - smoothWindow + 1), i + 1).map(get)));
  const col = smooth((r) => r.colonizations / r.elapsedSteps), ext = smooth((r) => r.extinctions / r.elapsedSteps);
  for (let i = 0; i < rows.length; i++) {
    if (ext[i] < col[i]) continue;
    const tail = rows.slice(i);
    if (tail.length < minSpan) continue;
    // Aggregate (not pointwise) dominance over the remaining tail: total smoothed extinction
    // pressure must at least match total smoothed colonization pressure, not exceed it at *every*
    // single observation. Balanced, sustained turnover legitimately oscillates locally (a frame
    // with col>ext right after one with ext>col, richness bouncing between e.g. 9 and 10 forever)
    // without that meaning the population is still net-growing -- a pointwise "ext>=col at every
    // single step" requirement would reject exactly that case as "nonequilibrium" forever, no
    // matter how long the series ran. The flatness/no-drift/anyColonization checks below still do
    // the real work of rejecting pure decline and monotonic drift; this aggregate check only rules
    // out a tail that is still net colonizing on the whole.
    const tailColSum = col.slice(i).reduce((a, c) => a + c, 0);
    const tailExtSum = ext.slice(i).reduce((a, c) => a + c, 0);
    if (tailExtSum < tailColSum) continue;
    const tailRichness = tail.map((r) => r.richness);
    const tailSteps = tail.map((r) => r.step);
    const m = mean(tailRichness);
    const pointwiseFlat = m > 0 && tailRichness.every((r) => Math.abs(r - m) <= flatTolerance * m);
    // Reject directional drift: a monotonic decline (or incline) small enough to keep every
    // point within `flatTolerance` of the tail's own mean still passes the pointwise check
    // above (e.g. richness 11,11,10,10,9 across a tail is "flat" by that measure alone).
    // Fit a trend line over the tail and require its *total* predicted change across the tail's
    // span -- not just each point's deviation from the mean -- to stay within the same
    // tolerance, so continuing decline is rejected even when it never wanders far from its own
    // average.
    const trend = linearFit(tailSteps, tailRichness);
    const span = tailSteps[tailSteps.length - 1] - tailSteps[0];
    const noDrift = m > 0 ? Math.abs(trend.slope * span) <= flatTolerance * m : true;
    const flat = pointwiseFlat && noDrift;
    // Reject pure decline: colonizations must not be uniformly zero across the whole tail
    // (that's extinction-dominated collapse, not turnover balance). Necessary but not
    // sufficient on its own -- a single colonization event doesn't rule out drift, which is why
    // `noDrift` above is checked separately.
    const anyColonization = tail.some((r) => r.colonizations > 0);
    if (flat && anyColonization) return { crossingStep: rows[i].step, equilibriumRichness: m };
  }
  return { crossingStep: null, equilibriumRichness: null };
}
