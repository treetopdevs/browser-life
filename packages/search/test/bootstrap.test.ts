import { describe, expect, it } from "vitest";
import { NN_BYTES, type Genome } from "@bl/schema";
import { Archive, DEFAULT_ARCHIVE, GATES, SCORES, nextConfirmSeed, quality, qualityMaintenance, recordedSeeds, searchedWith, usedSeeds, type Evaluation } from "@bl/search";

const genome = (fill: number): Genome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });
const ev = (partial: Partial<Evaluation>): Evaluation => ({
  survived: 4,
  recovered: 4,
  lightDependent: 4,
  reps: 4,
  individuals: 1,
  meanMass: 256,
  speed: 1,
  mass: 256,
  recovery: 1,
  regenerated: 4,
  reproduction: 0,
  ...partial,
});

describe("the score and gate an archive was searched with", () => {
  it("reads a missing score as quality and a missing gate as m3", () => {
    expect(searchedWith(undefined)).toEqual({ score: "quality", gate: "m3", ignored: [] });
    expect(searchedWith({ select: "lineages", passBias: 0.5, random: 0.25 } as { score?: unknown })).toEqual({ score: "quality", gate: "m3", ignored: [] });
    expect(searchedWith({ score: "maintenance", gate: "maintenance" })).toEqual({ score: "maintenance", gate: "maintenance", ignored: [] });
    expect(SCORES.quality).toBe(quality);
    expect(SCORES.maintenance).toBe(qualityMaintenance);
  });

  it("keeps the archive's settings over flags passed against them and lists those flags", () => {
    // A score-less archive was searched with quality: --score maintenance must not re-score it.
    expect(searchedWith({}, { score: "maintenance" })).toEqual({ score: "quality", gate: "m3", ignored: ["--score maintenance (searched with quality)"] });
    expect(searchedWith({ score: "maintenance" }, { score: "quality", gate: "maintenance" })).toEqual({
      score: "maintenance",
      gate: "m3",
      ignored: ["--score quality (searched with maintenance)", "--gate maintenance (searched with m3)"],
    });
    expect(searchedWith({ score: "maintenance", gate: "maintenance" }, { score: "maintenance", gate: "maintenance" }).ignored).toEqual([]);
  });

  it("refuses a score or gate it never records", () => {
    expect(() => searchedWith({ score: "regen" })).toThrow(/unknown score "regen"/);
    expect(() => searchedWith({ gate: "toString" })).toThrow(/unknown gate "toString"/);
  });

  it("replays a quality archive with the passers its search kept, whatever --score says", () => {
    // Regenerates and dies without light (an m3 passer), but never recovers: quality 0.5, qualityMaintenance 0.
    const e = ev({ recovered: 0, recovery: 0 });
    expect(quality(e)).toBeGreaterThan(0);
    expect(qualityMaintenance(e)).toBe(0);
    const log = [{ genome: genome(1), eval: e, born: 0 }];
    const { score, gate } = searchedWith(undefined, { score: "maintenance" });
    expect(Archive.replay(log, 1, DEFAULT_ARCHIVE, SCORES[score], GATES[gate]).gatePassing()).toHaveLength(1);
    // What re-scoring with the flag did: the passer is not even viable, so it would never be confirmed.
    expect(Archive.replay(log, 1, DEFAULT_ARCHIVE, SCORES.maintenance, GATES[gate]).gatePassing()).toHaveLength(0);
  });
});

describe("seeds an earlier confirmation spent", () => {
  const gate = { confirmSeed: 1000001, confirmSeeds: [[1000001, 1000003]], batchSize: 4 };

  it("starts a resumed confirmation, and the dependence re-screen after it, above the last re-screen", () => {
    // Confirmed on 1000001..1000003, re-screened on 1000004..1000005.
    const prev = { gate: { ...gate, dependenceSeeds: [[1000004, 1000005]] }, dependence: { seeds: [1000004, 1000005] }, rows: new Array(12) };
    const seeds = recordedSeeds(prev, "confirm.json");
    expect(seeds).toEqual({ confirm: [[1000001, 1000003]], dependence: [[1000004, 1000005]] });
    const next = nextConfirmSeed(seeds, 1000001);
    expect(next).toBe(1000006);
    // tools/bootstrap.ts starts the re-screen after this run's confirmation batches: with no new passers it
    // starts at `next`, not back on 1000004.
    for (const batches of [0, 2]) expect(next + batches).toBeGreaterThan(1000005);
  });

  it("counts a dependence block recorded before dependenceSeeds and dependenceHistory existed", () => {
    // The shape of runs/bootstrap-medium-waste/confirm.json.
    const prev = { gate: { confirmSeed: 4710001, confirmSeeds: [[4710001, 4710058]], batchSize: 4 }, dependence: { seeds: [4710059, 4710095] }, rows: new Array(232) };
    expect(nextConfirmSeed(recordedSeeds(prev, "confirm.json"), 1000001)).toBe(4710096);
  });

  it("takes every re-screen from dependenceSeeds, dependenceHistory and the block, once each", () => {
    // As tools/bootstrap.ts writes a second re-screen: dependenceSeeds lists the history's ranges, then the block's.
    const prev = {
      gate: { ...gate, dependenceSeeds: [[1000004, 1000005], [1000006, 1000007]] },
      dependenceHistory: [{ seeds: [1000004, 1000005] }],
      dependence: { seeds: [1000006, 1000007] },
      rows: new Array(12),
    };
    const seeds = recordedSeeds(prev, "confirm.json");
    expect(seeds.dependence).toEqual([[1000004, 1000005], [1000006, 1000007]]);
    expect(nextConfirmSeed(seeds, 1)).toBe(1000008);
    // The same ranges usedSeeds (retest freshness) reads from the gate record, less the search seeds.
    expect(new Set(usedSeeds({ searchSeeds: [1, 5], ...prev.gate }, 12).slice(1).map(String))).toEqual(new Set([...seeds.confirm, ...seeds.dependence].map(String)));
    // A range in only one of the three places still counts; an empty one does not.
    const partial = { gate: { ...gate, dependenceSeeds: [[1000009, 1000008]] }, dependenceHistory: [{ seeds: [1000010, 1000011] }], rows: new Array(12) };
    expect(recordedSeeds(partial, "confirm.json").dependence).toEqual([[1000010, 1000011]]);
    expect(nextConfirmSeed(recordedSeeds(partial, "confirm.json"), 1)).toBe(1000012);
  });

  it("derives a legacy confirmation range and falls back to --confirm-seed when nothing was spent", () => {
    expect(recordedSeeds({ gate: { confirmSeed: 100, batchSize: 4 }, rows: new Array(9) }, "c.json")).toEqual({ confirm: [[100, 102]], dependence: [] });
    expect(nextConfirmSeed(recordedSeeds({ gate: { confirmSeed: 100, batchSize: 4 }, rows: [] }, "c.json"), 7)).toBe(7);
    expect(nextConfirmSeed(recordedSeeds({ gate: { confirmSeed: 100, confirmSeeds: [[100, 99]], batchSize: 4 }, rows: [] }, "c.json"), 7)).toBe(7);
    expect(nextConfirmSeed(recordedSeeds(undefined, "c.json"), 7)).toBe(7);
    // Confirmation ranges keep their recorded order (they are written back as confirmSeeds).
    expect(recordedSeeds({ gate: { confirmSeed: 1, confirmSeeds: [[1, 3], [100, 99], [4, 6]], batchSize: 4 }, rows: [] }, "c.json").confirm).toEqual([[1, 3], [4, 6]]);
  });

  it("refuses a record whose seeds cannot be read", () => {
    expect(() => recordedSeeds({ gate: { confirmSeed: 100 }, rows: [] }, "c.json")).toThrow(/c\.json: .*confirmSeed\/batchSize/);
    expect(() => recordedSeeds({ gate: { ...gate, confirmSeeds: [[5, 3]] }, rows: [] }, "c.json")).toThrow(/confirmation seed range \[5,3\]/);
    expect(() => recordedSeeds({ gate: { ...gate, dependenceSeeds: [[null, 3]] }, rows: [] }, "c.json")).toThrow(/dependence seed range \[null,3\]/);
    expect(() => recordedSeeds({ gate: { ...gate, dependenceSeeds: "1..3" as unknown as unknown[] }, rows: [] }, "c.json")).toThrow(/dependenceSeeds/);
    expect(() => recordedSeeds({ gate, dependence: {}, rows: [] }, "c.json")).toThrow(/dependence seed range undefined/);
    expect(() => recordedSeeds({ gate, dependenceHistory: [{ seeds: [1.5, 2] }], rows: [] }, "c.json")).toThrow(/dependence seed range/);
  });
});
