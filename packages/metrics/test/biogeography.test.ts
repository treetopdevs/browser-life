// packages/metrics/src/biogeography.ts: founder-persistence vs. genetic-
// richness estimands, species-area fit, isolation effect and turnover.
// Style: like packages/schema/test/migration.test.ts for the state-shaped
// tests, like packages/metrics/test/stats.test.ts for the pure-math ones.
import { describe, expect, it } from "vitest";
import { CLUSTER_DISTANCE, GENOME_CHANNELS, cellCount, defaultConfig, emptyGenome, encodeGenome, geneticClusters, type Genome, type WorldConfig } from "@bl/schema";
import {
  founderPersistenceSets,
  founderRichnessSeries,
  geneticRichnessByTile,
  geneticRichnessSeries,
  isolationEffect,
  linearFit,
  speciesAreaFit,
  tileSpeciesCensus,
  turnoverEquilibrium,
  turnoverSeries,
  unclusteredId,
  type SpeciesFrame,
  type TurnoverRow,
} from "@bl/metrics";

function twoTileCfg(): WorldConfig {
  return defaultConfig({ tileW: 8, tileH: 8, tilesX: 2, tilesY: 1, kernelRadius: 2 });
}

/** Places `genomes` (living, distinct lineages) at the given cell indices of a fresh genome buffer; every other cell stays dead (all-zero). */
function makeFrame(cfg: WorldConfig, placed: { i: number; genome: Genome }[], step = 0): SpeciesFrame {
  const n = cellCount(cfg);
  const genome = new Uint32Array(n * GENOME_CHANNELS);
  placed.forEach(({ i, genome: g }, k) => {
    const words = encodeGenome(g, 1, k + 1);
    for (let c = 0; c < GENOME_CHANNELS; c++) genome[c * n + i] = words[c];
  });
  return { step, cfg, genome };
}

// A 20-byte-changed genome differs from `base` in `n` weight slots.
const withChangedWeights = (base: Genome, n: number): Genome => {
  const g: Genome = { ...base, weights: base.weights.slice() };
  for (let i = 0; i < n; i++) g.weights[i] = 1;
  return g;
};

describe("founderPersistenceSets", () => {
  const cfg = twoTileCfg();
  const anchorA = emptyGenome(60, 20);
  const anchorB = emptyGenome(80, 20);
  const nearB = withChangedWeights(anchorB, 3); // within CLUSTER_DISTANCE of B
  const far = withChangedWeights(anchorA, 100); // far past CLUSTER_DISTANCE from both

  it("classifies each tile's living cells against the nearest anchor, and buckets a far cell as unclustered", () => {
    // Tile 0 (x 0..7): anchorA exactly, and a near-B genome. Tile 1 (x 8..15): a far genome.
    const frame = makeFrame(cfg, [
      { i: 0, genome: anchorA },
      { i: 1, genome: nearB },
      { i: 8, genome: far },
    ]);
    const sets = founderPersistenceSets(frame, [anchorA, anchorB]);
    expect(sets[0]).toEqual(new Set([0, 1]));
    expect(sets[1]).toEqual(new Set([unclusteredId([anchorA, anchorB])]));
  });
});

describe("geneticRichnessByTile vs. founderPersistenceSets: the chain/bridge disagreement", () => {
  const cfg = twoTileCfg();
  const G0 = emptyGenome(60, 20);

  it("a chain (G0 -> G1 -> G2) is one genetic cluster, but founder-persistence's nearest-anchor rule strands G2 as unclustered", () => {
    const G1 = withChangedWeights(G0, 8); // 8 from G0
    const G2 = withChangedWeights(G0, 16); // 16 from G0, only 8 from G1
    const frame = makeFrame(cfg, [
      { i: 0, genome: G0 },
      { i: 1, genome: G1 },
      { i: 2, genome: G2 },
    ]);
    expect(geneticRichnessByTile(frame)[0]).toBe(1); // single linkage: G0-G1-G2 chain into one cluster
    const sets = founderPersistenceSets(frame, [G0]);
    expect(sets[0]).toEqual(new Set([0, unclusteredId([G0])])); // G2 too far from the only anchor
    // The two estimands disagree on this fixture: one merged cluster vs. two founder-persistence buckets.
    expect(geneticRichnessByTile(frame)[0]).not.toBe(sets[0].size);
  });

  it("a bridge between two founder anchors merges them into one genetic cluster while founder-persistence still reports both anchors present", () => {
    const A = G0;
    const B = withChangedWeights(G0, 20); // 20 from A -- a distinct anchor
    const bridge = withChangedWeights(G0, 10); // 10 from A, 10 from B (exactly at the threshold both ways)
    const frame = makeFrame(cfg, [
      { i: 0, genome: A },
      { i: 1, genome: B },
      { i: 2, genome: bridge },
    ]);
    expect(geneticRichnessByTile(frame)[0]).toBe(1); // bridge merges A's and B's genomes into one cluster
    const sets = founderPersistenceSets(frame, [A, B]);
    expect(sets[0]).toEqual(new Set([0, 1])); // both A and B still counted as present
    expect(sets[0].size).toBe(2);
  });
});

describe("founderRichnessSeries", () => {
  const cfg = twoTileCfg();
  const anchorA = emptyGenome(60, 20);
  const anchorB = emptyGenome(80, 20);
  const nearB = withChangedWeights(anchorB, 3);
  const far = withChangedWeights(anchorA, 100);

  it("tracks a tile's founder richness across frames, and the unclustered flag separately", () => {
    const frame0 = makeFrame(cfg, [{ i: 0, genome: anchorA }, { i: 1, genome: nearB }, { i: 8, genome: far }], 0);
    const frame1 = makeFrame(cfg, [{ i: 0, genome: anchorA }, { i: 8, genome: far }], 100); // tile 0 loses the B-like cell
    const rows = founderRichnessSeries([frame0, frame1], [anchorA, anchorB]);
    const byTileStep = (tile: number, step: number) => rows.find((r) => r.tile === tile && r.step === step)!;
    expect(byTileStep(0, 0).richness).toBe(2);
    expect(byTileStep(0, 100).richness).toBe(1);
    expect(byTileStep(0, 0).unclustered).toBe(false);
    expect(byTileStep(0, 100).unclustered).toBe(false);
    expect(byTileStep(1, 0).unclustered).toBe(true);
    expect(byTileStep(1, 100).unclustered).toBe(true);
    expect(byTileStep(1, 0).richness).toBe(0); // includeUnclustered defaults to false

    const withUnclustered = founderRichnessSeries([frame0], [anchorA, anchorB], undefined, true);
    expect(withUnclustered.find((r) => r.tile === 1)!.richness).toBe(1);
  });
});

describe("geneticRichnessSeries never excludes a populated-but-anchor-distant tile", () => {
  it("reports a real cluster where founderRichnessSeries (default) reports 0", () => {
    const cfg = twoTileCfg();
    const anchorA = emptyGenome(60, 20);
    const far = withChangedWeights(anchorA, 100);
    const frame = makeFrame(cfg, [{ i: 0, genome: anchorA }, { i: 8, genome: far }]);
    expect(geneticRichnessSeries([frame]).find((r) => r.tile === 1)!.richness).toBe(1);
    expect(founderRichnessSeries([frame], [anchorA]).find((r) => r.tile === 1)!.richness).toBe(0);
  });
});

describe("tileSpeciesCensus", () => {
  const cfg = twoTileCfg();
  const anchorA = emptyGenome(60, 20);
  const anchorB = emptyGenome(80, 20);
  const nearB = withChangedWeights(anchorB, 3);
  const far = withChangedWeights(anchorA, 100);

  it("reports geneticRichness/livingCells/founderPresenceMask per tile on a small hand-built frame", () => {
    const frame = makeFrame(cfg, [
      { i: 0, genome: anchorA },
      { i: 1, genome: nearB },
      { i: 8, genome: far },
    ]);
    const rows = tileSpeciesCensus(frame, [anchorA, anchorB]);
    expect(rows).toHaveLength(2);
    // Tile 0: anchorA and the near-B genome are themselves within CLUSTER_DISTANCE of each other
    // (mu alone separates anchorA/anchorB), so single linkage merges them into one genetic
    // cluster -- but nearest-anchor classification still finds both anchors present (each genome
    // is nearest to a different anchor), matching the founderPersistenceSets fixture above.
    expect(rows[0]).toEqual({ tile: 0, geneticRichness: 1, livingCells: 2, founderPresenceMask: 0b11 });
    // Tile 1: one far-from-both genome -- one cluster, no anchor bit set (unclustered).
    expect(rows[1]).toEqual({ tile: 1, geneticRichness: 1, livingCells: 1, founderPresenceMask: 0 });
  });

  it("single linkage over distinct genomes equals single linkage over cells: duplicate-genome cells don't inflate geneticRichness (and it matches geneticRichnessByTile)", () => {
    const G0 = emptyGenome(60, 20);
    const G1 = withChangedWeights(G0, 20); // >CLUSTER_DISTANCE from G0 -- a distinct cluster
    // 10 cells of G0, 10 cells of G1, all in tile 0 (indices 0..7 for tile 0's 8 cells, tile 0 is
    // x 0..7 of an 8x8 tile in a 2-tile-wide config -- reuse both x=0..7 columns via y as well).
    const many = [
      ...Array.from({ length: 4 }, (_, k) => ({ i: k, genome: G0 })),
      ...Array.from({ length: 4 }, (_, k) => ({ i: 4 + k, genome: G1 })),
    ];
    const frameMany = makeFrame(cfg, many);
    const frameOne = makeFrame(cfg, [{ i: 0, genome: G0 }, { i: 4, genome: G1 }]);
    expect(geneticRichnessByTile(frameMany)[0]).toBe(2);
    expect(geneticRichnessByTile(frameMany)[0]).toBe(geneticRichnessByTile(frameOne)[0]);
    const censusMany = tileSpeciesCensus(frameMany, [G0]);
    const censusOne = tileSpeciesCensus(frameOne, [G0]);
    expect(censusMany[0].geneticRichness).toBe(censusOne[0].geneticRichness);
    expect(censusMany[0].livingCells).toBe(8); // duplicates ARE counted here, unlike geneticRichness
    expect(censusOne[0].livingCells).toBe(2);
  });

  it("clusters the raw duplicate-containing per-cell genome list the same as the deduplicated set, including chain and bridge cases -- not routed through this module's own dedup helper", () => {
    // Unlike the test above (which only ever compares geneticRichnessByTile/tileSpeciesCensus,
    // both of which dedupe via the same internal helper before clustering), this calls
    // geneticClusters directly on a genome array built with real duplicate entries, so a bug
    // shared by the dedup step itself couldn't hide behind both sides of the comparison agreeing.
    const G0 = emptyGenome(60, 20);
    const G1 = withChangedWeights(G0, 8); // one chain step from G0
    const G2 = withChangedWeights(G0, 16); // a second chain step, only reachable via G1 as a bridge
    // Changed at the opposite end of the weight vector (not the first N slots G1/G2 use), so B
    // shares none of their changed slots and sits far (20) from every one of them, not just G0.
    const B: Genome = { ...G0, weights: G0.weights.slice() };
    for (let i = B.weights.length - 20; i < B.weights.length; i++) B.weights[i] = 1;
    const raw = [G0, G0, G0, G1, G1, G1, G2, G2, B, B, B, B]; // duplicates included, unsorted by cluster
    const distinct = [...new Set(raw)]; // dedup by reference identity -- these are shared objects, not clones
    const rawIds = geneticClusters(raw, CLUSTER_DISTANCE);
    const distinctIds = geneticClusters(distinct, CLUSTER_DISTANCE);
    expect(new Set(rawIds).size).toBe(new Set(distinctIds).size);
    expect(new Set(rawIds).size).toBe(2); // {G0,G1,G2} chain-bridged into one cluster, {B} its own
    // Every duplicate of the same genome lands in the same cluster as its first occurrence.
    const idByGenome = new Map<Genome, number>();
    raw.forEach((g, i) => idByGenome.set(g, rawIds[i]));
    expect(idByGenome.get(G0)).toBe(idByGenome.get(G1));
    expect(idByGenome.get(G1)).toBe(idByGenome.get(G2));
    expect(idByGenome.get(B)).not.toBe(idByGenome.get(G0));
  });
});

describe("speciesAreaFit", () => {
  // These fixtures have no real seed-pairing structure (each point stands alone), so each gets
  // its own singleton seed block -- block resampling over singletons is exactly per-point
  // resampling, the case the "seed-block resampling preserves seed pairing" test below contrasts
  // against.
  const ownSeeds = (areas: number[]) => areas.map((_, i) => i);

  it("recovers z from area, not from raw width (negative control: raw width roughly doubles the recovered exponent)", () => {
    const widths = [24, 32, 48, 64, 96, 128];
    const c = 1.5, z = 0.28;
    const areas = widths.map((w) => w * w);
    const richness = areas.map((a) => Math.round(c * a ** z));
    const fit = speciesAreaFit(areas, richness, ownSeeds(areas), 42);
    expect(fit.z).toBeGreaterThan(z - 0.03);
    expect(fit.z).toBeLessThan(z + 0.03);
    expect(fit.ci).not.toBeNull();
    expect(fit.ci![0]).toBeLessThanOrEqual(z);
    expect(fit.ci![1]).toBeGreaterThanOrEqual(z);

    const badFit = speciesAreaFit(widths, richness, ownSeeds(widths), 42);
    expect(badFit.z).toBeGreaterThan(1.7 * z);
    expect(badFit.z).toBeLessThan(2.3 * z);
  });

  it("excludes zero-richness rows from the log-log fit but reports how many", () => {
    const areas = [24, 32, 48, 64, 96, 128].map((w) => w * w);
    const richness = [0, 3, 5, 8, 11, 14];
    const fit = speciesAreaFit(areas, richness, ownSeeds(areas), 1);
    expect(fit.n).toBe(5);
    expect(fit.excludedZeros).toBe(1);
  });

  it("throws with fewer than 3 positive-richness points", () => {
    const areas = [24, 32, 48].map((w) => w * w);
    expect(() => speciesAreaFit(areas, [0, 0, 5], ownSeeds(areas), 1)).toThrow(/at least 3/);
  });

  it("bootstrap rejects degenerate (all-same-area) resamples instead of returning a flood of exact-zero slopes", () => {
    const areas = [576, 1024, 4096]; // 24^2, 32^2, 64^2
    const richness = [3, 5, 9];
    const fit = speciesAreaFit(areas, richness, ownSeeds(areas), 7, 2000);
    expect(fit.ci).not.toBeNull();
    expect(Number.isFinite(fit.ci![0])).toBe(true);
    expect(Number.isFinite(fit.ci![1])).toBe(true);
    // With degenerate resamples rejected, exact-zero slopes should be rare, not one-ninth of the sample.
    expect(fit.ci![1] - fit.ci![0]).toBeGreaterThan(0);
    // Directly audit the rejection this test is named for (not just an incidental CI-width
    // side effect): a naive single-draw-per-resample bootstrap at n=3 produces exact-zero
    // slopes for ~1/9 of resamples (one of the 9 equally-likely index multisets is
    // all-identical); with degenerate resamples rejected outright, that should collapse to
    // a rare coincidence, well under the naive rate.
    const zeros = fit.zs.filter((z) => z === 0).length;
    expect(zeros).toBeLessThanOrEqual(fit.zs.length / 20);
  });

  it("rejects a fit where extinction has left only one distinct surviving area (unidentified, not a real zero slope)", () => {
    const areas = [576, 576, 576, 1024, 2304];
    const richness = [3, 4, 5, 0, 0];
    expect(() => speciesAreaFit(areas, richness, ownSeeds(areas), 1)).toThrow(/distinct surviving areas/);
  });

  it("reports a null CI (not a degenerate zero-width point interval) when every positive-richness point shares one seed", () => {
    const areas = [576, 1024, 4096];
    const richness = [3, 4, 8];
    const fit = speciesAreaFit(areas, richness, [7, 7, 7], 1);
    // z itself is still a real point estimate -- only the CI, which would otherwise resample the
    // same single seed block every time and report [z, z] as if that were certainty, is withheld.
    expect(Number.isFinite(fit.z)).toBe(true);
    expect(fit.ci).toBeNull();
  });

  it("resamples whole seed blocks, never splitting one seed's points across a resample", () => {
    // The sweep reuses each seed's own founder layout across every area, so a seed's points are
    // correlated, not independent replicates -- resampling must move a seed's whole point set
    // together or not at all. With only 2 seeds, whole-block resampling with replacement can only
    // ever produce one of 3 outcomes: seed 1's own 4 points (doubled), seed 2's own 4 points
    // (doubled), or both seeds together (order doesn't affect OLS slope) -- never some other split
    // like 3 points from seed 1 and 5 from seed 2, which per-point resampling could produce.
    const areas = [576, 1024, 4096, 9216]; // 24^2, 32^2, 64^2, 96^2
    const steepRichness = areas.map((a) => Math.round(2 * Math.log2(a)));
    const flatRichness = areas.map(() => 6);
    const allAreas = [...areas, ...areas];
    const allRichness = [...steepRichness, ...flatRichness];
    const seedIds = [...areas.map(() => 1), ...areas.map(() => 2)];
    const logArea = areas.map((a) => Math.log(a));

    const slopeSeed1 = linearFit(logArea, steepRichness.map((r) => Math.log(r))).slope;
    const slopeSeed2 = linearFit(logArea, flatRichness.map((r) => Math.log(r))).slope; // 0: richness is constant
    const slopeBoth = linearFit([...logArea, ...logArea], allRichness.map((r) => Math.log(r))).slope;
    const possibleSlopes = [slopeSeed1, slopeSeed2, slopeBoth];

    const fit = speciesAreaFit(allAreas, allRichness, seedIds, 1, 500);
    for (const z of fit.zs) expect(possibleSlopes.some((p) => Math.abs(p - z) < 1e-9)).toBe(true);
    // All 3 outcomes are reachable in 500 draws over only 2 seed blocks (each ~25-50% likely).
    expect(new Set(fit.zs.map((z) => possibleSlopes.findIndex((p) => Math.abs(p - z) < 1e-9))).size).toBe(3);
  });
});

describe("isolationEffect", () => {
  const seeded = (rate: number, seeds: number[]) => seeds.map((seed) => ({ seed, richness: rate * 2 + seed }));

  it("finds a positive trend, an exploratory best-rate comparison, and a Holm adjustment that never lowers p", () => {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    for (const rate of [0, 1, 2, 4, 8]) byRate.set(rate, seeded(rate, [1, 2, 3]));
    const result = isolationEffect(byRate);
    expect(result.trendCorrelation).toBeGreaterThan(0.8);
    expect(result.bestRateVsNoMigration.rate).toBe(8);
    expect(result.bestRateVsNoMigration.exploratory).toBe(true);
    expect(result.bestRateVsNoMigration.holmAdjustedP).toBeGreaterThanOrEqual(result.bestRateVsNoMigration.p);
  });

  it("throws rather than silently degrading to NaN when the no-migration control is missing", () => {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    for (const rate of [1, 2, 4, 8]) byRate.set(rate, seeded(rate, [1, 2, 3]));
    expect(() => isolationEffect(byRate)).toThrow(/rate=0/);
  });

  it("pairs observations by seed (the sweep's matched-seed design), not an unpaired test, so a consistent per-seed effect is detected", () => {
    // 10 matched seeds; every seed's treatment richness is exactly one higher than its own
    // no-migration control -- a real, consistent per-seed effect. Pooling these into an unpaired
    // Mann-Whitney (discarding seed identity) reports p=0.739 (non-significant) for these exact
    // values, because the two *pooled* distributions overlap heavily even though every single
    // seed-level difference has the same sign and magnitude. The correct paired signed-rank test
    // recovers the small p an all-same-sign, all-tied-magnitude difference at n=10 implies
    // (2 * 2^-10 ~= 0.00195).
    const control = Array.from({ length: 10 }, (_, i) => 1 + i * 10); // 1,11,21,...,91
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, control.map((richness, seed) => ({ seed, richness })));
    byRate.set(5, control.map((richness, seed) => ({ seed, richness: richness + 1 })));
    const result = isolationEffect(byRate);
    expect(result.bestRateVsNoMigration.rate).toBe(5);
    expect(result.bestRateVsNoMigration.p).toBeLessThan(0.01);
    expect(result.bestRateVsNoMigration.effect).toBeGreaterThan(0);
  });

  it("excludes a seed missing from one side of a comparison rather than treating it as a zero difference", () => {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, [1, 2, 3, 4].map((seed) => ({ seed, richness: 10 })));
    // Rate 5 is missing seed 4 (e.g. that run was rejected upstream) -- only seeds 1-3 should
    // contribute a paired difference, never a synthetic 0 for the missing seed.
    byRate.set(5, [1, 2, 3].map((seed) => ({ seed, richness: 12 })));
    const result = isolationEffect(byRate);
    expect(result.bestRateVsNoMigration.n).toBe(3);
  });

  it("does not report a spurious trend purely from seed-set drift across rates", () => {
    // Zero true migration effect: richness is identically equal to seed, regardless of rate.
    // But the surviving seed set drifts across rates (as upstream eligibility rejections would
    // cause in practice) -- {1,2} at rate 0, {2,3} at rate 1, {3,4} at rate 2. A raw pooled
    // Pearson correlation over every (rate, richness) pair reports a strong spurious trend here
    // (~0.85) purely because later rates happen to keep higher-numbered (and so higher-richness)
    // seeds, not because of any real migration effect. The seed-blocked (demeaned) trend must not
    // reproduce that: every seed contributes an identical richness at every rate it appears in
    // (or only one observation), so once each seed's own mean is subtracted out, nothing but zero
    // variance remains.
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, [1, 2].map((seed) => ({ seed, richness: seed })));
    byRate.set(1, [2, 3].map((seed) => ({ seed, richness: seed })));
    byRate.set(2, [3, 4].map((seed) => ({ seed, richness: seed })));
    const result = isolationEffect(byRate);
    expect(Number.isNaN(result.trendCorrelation)).toBe(true);
  });

  it("reports a seed-blocked trend and a bootstrap CI for a real, consistent per-seed effect", () => {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    for (const rate of [0, 1, 2, 4, 8]) byRate.set(rate, seeded(rate, [1, 2, 3]));
    const result = isolationEffect(byRate);
    expect(result.trendCorrelation).toBeGreaterThan(0.8);
    expect(result.trendN).toBe(5 * 3);
    expect(result.trendCI).not.toBeNull();
    expect(result.trendCI![0]).toBeLessThanOrEqual(result.trendCI![1]);
  });

  it("reports a null trend CI when only one seed is actually paired across rates, even though a second seed contributes a single-rate observation", () => {
    // seed 1 is observed at both rates (a genuine pair); seed 2 only at rate 0 -- its centered
    // contribution is always (0,0), which can sit exactly on the line seed 1's own two points
    // define, so a resample mixing it with seed 1 can still look perfectly correlated. Only one
    // seed actually contributes paired evidence, so the CI must be withheld, not report [1,1].
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, [{ seed: 1, richness: 2 }, { seed: 2, richness: 3 }]);
    byRate.set(5, [{ seed: 1, richness: 4 }]);
    const result = isolationEffect(byRate);
    expect(result.trendCI).toBeNull();
  });

  it("reports a null trend CI when richness never varies within any seed", () => {
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, [{ seed: 1, richness: 3 }, { seed: 2, richness: 5 }]);
    byRate.set(5, [{ seed: 1, richness: 3 }, { seed: 2, richness: 5 }]);
    const result = isolationEffect(byRate);
    expect(Number.isFinite(result.trendCorrelation)).toBe(false);
    expect(result.trendCI).toBeNull();
  });

  it("does not condition the trend CI on resamples that happen to keep the only responsive seed", () => {
    // 5 paired seeds; only seed 1 responds (2 -> 3), the other 4 are flat (2 -> 2). A resample
    // that omits seed 1 has zero-variance demeaned richness -- Pearson's correlation is
    // mathematically undefined (0/0) for that resample, not merely "hard to compute". Silently
    // dropping those resamples (rather than counting them as 0) conditions the interval on having
    // kept the one responsive seed, which for this exact data previously reported [0.4472, 0.7746]
    // -- a CI that excludes 0 despite only one of five seeds showing any response at all.
    const byRate = new Map<number, { seed: number; richness: number }[]>();
    byRate.set(0, [1, 2, 3, 4, 5].map((seed) => ({ seed, richness: 2 })));
    byRate.set(5, [1, 2, 3, 4, 5].map((seed) => ({ seed, richness: seed === 1 ? 3 : 2 })));
    const result = isolationEffect(byRate);
    expect(result.trendCorrelation).toBeCloseTo(0.4472135954999579, 9);
    expect(result.trendCI).not.toBeNull();
    // The honest interval spans down to (or through) 0, unlike the biased [0.4472, 0.7746] that
    // dropping degenerate resamples used to produce.
    expect(result.trendCI![0]).toBeLessThanOrEqual(0);
  });
});

describe("turnoverSeries", () => {
  it("the first frame's whole species set counts as colonizing", () => {
    const history = [
      { step: 0, species: new Set([0, 1]) },
      { step: 100, species: new Set([0, 1, 2]) },
      { step: 200, species: new Set([1, 2]) },
      { step: 300, species: new Set([1, 2]) },
    ];
    const rows = turnoverSeries(history);
    expect(rows.map((r) => r.colonizations)).toEqual([2, 1, 0, 0]);
    expect(rows.map((r) => r.extinctions)).toEqual([0, 0, 1, 0]);
    expect(rows.map((r) => r.richness)).toEqual([2, 3, 2, 2]);
    expect(rows.map((r) => r.elapsedSteps)).toEqual([0, 100, 100, 100]);
  });
});

describe("turnoverEquilibrium", () => {
  const row = (step: number, colonizations: number, extinctions: number, richness: number): TurnoverRow => ({
    step,
    tile: 0,
    colonizations,
    extinctions,
    richness,
    elapsedSteps: step === 0 ? 0 : 100,
  });

  it("rejects pure decline (satisfies the naive ext>=col criterion but is collapse, not equilibrium)", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(i * 100, 0, 1, 10 - i));
    expect(turnoverEquilibrium(rows)).toEqual({ crossingStep: null, equilibriumRichness: null });
  });

  it("normalizes by elapsed steps, so a short final interval is not weighted like a full census interval", () => {
    const founders = Array.from({ length: 13 }, (_, i) => i);
    const history = [0, 100, 200, 300, 400, 500, 600, 700, 701].map((step) => ({
      step,
      species: new Set(step === 0 || step === 701 ? founders : founders.slice(1)),
    }));
    expect(turnoverEquilibrium(turnoverSeries(history))).toEqual({ crossingStep: null, equilibriumRichness: null });
  });

  it("finds the crossing step and plateau richness when colonization/extinction cross and richness settles", () => {
    const col = [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0];
    const ext = [0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5];
    const richness = [2, 3, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    const rows = col.map((c, i) => row(i * 100, c, ext[i], richness[i]));
    expect(turnoverEquilibrium(rows, 1, 5, 0.15)).toEqual({ crossingStep: 300, equilibriumRichness: 6 });
  });

  it("returns null when fewer than minSpan observations remain after the crossing", () => {
    const col = [5, 4, 3, 2, 1, 0, 0];
    const ext = [0, 1, 2, 3, 4, 5, 5];
    const richness = [2, 3, 4, 6, 6, 6, 6];
    const rows = col.map((c, i) => row(i * 100, c, ext[i], richness[i]));
    expect(turnoverEquilibrium(rows, 1, 5, 0.15)).toEqual({ crossingStep: null, equilibriumRichness: null });
  });

  it("returns null when colonizations never fall behind extinctions (no crossing)", () => {
    const col = [1, 2, 3, 4, 5];
    const ext = [0, 0, 0, 0, 0];
    const richness = [1, 3, 6, 10, 15];
    const rows = col.map((c, i) => row(i * 100, c, ext[i], richness[i]));
    expect(turnoverEquilibrium(rows, 1, 5, 0.15)).toEqual({ crossingStep: null, equilibriumRichness: null });
  });

  it("finds equilibrium in balanced, sustained turnover even though colonization briefly exceeds extinction at every other frame", () => {
    // Built from the real turnoverSeries pipeline (not hand-built TurnoverRow numbers, which can
    // silently encode combinations turnoverSeries itself could never produce -- e.g. the older
    // version of the "finds the crossing step" fixture above recorded 5 extinctions and 0
    // colonizations per step while richness stayed flat at 6, an internally impossible history
    // since richness can only stay flat there if colonizations offset extinctions). A fixed
    // 9-species base persists throughout; a 10th species colonizes on every odd frame and goes
    // extinct on the very next frame, forever -- textbook balanced turnover, richness oscillating
    // between 9 and 10, never settling into "extinction dominates every single remaining frame"
    // (col=1,ext=0 on every colonizing frame), which the old pointwise ext>=col-forever check
    // rejected as "nonequilibrium" no matter how long the series ran.
    const base = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const history = Array.from({ length: 31 }, (_, i) => {
      const species = new Set(base);
      if (i % 2 === 1) species.add(1000 + i); // a distinct extra species colonizes, then goes extinct next frame
      return { step: i * 100, species };
    });
    const rows = turnoverSeries(history);
    const eq = turnoverEquilibrium(rows);
    expect(eq.crossingStep).not.toBeNull();
    expect(eq.equilibriumRichness).not.toBeNull();
    expect(eq.equilibriumRichness!).toBeGreaterThan(9);
    expect(eq.equilibriumRichness!).toBeLessThan(10);
  });

  it("rejects a slow decline that a single mid-series colonization would otherwise let pass", () => {
    // richness 13,12,11,11,11,10,10,9 (every 100 steps): one founder disappears and another
    // returns at step 300 (net-zero richness change, one colonization + one extinction), then
    // only losses follow. The naive "any colonization in the tail" guard alone accepts this at
    // crossingStep=300 (tail [11,11,10,10,9], mean 10.2, every point within 15% of the mean) even
    // though the tail is a monotonic decline, not equilibrium -- the drift check must reject it.
    const col = [13, 0, 0, 1, 0, 0, 0, 0]; // row 0's colonizations = its own richness, matching turnoverSeries' "first frame counts as colonizing" convention
    const ext = [0, 1, 1, 1, 0, 1, 0, 1];
    const richness = [13, 12, 11, 11, 11, 10, 10, 9];
    const rows = col.map((c, i) => row(i * 100, c, ext[i], richness[i]));
    expect(turnoverEquilibrium(rows)).toEqual({ crossingStep: null, equilibriumRichness: null });
  });
});
