import { describe, expect, it } from "vitest";
import { founderGenome, M3_FOUNDER_SET, M3_FOUNDERS } from "@bl/schema";
import { checkFresh, poolCounts, replicatedFounders, usedSeeds, founderSetId, passesStrictM3, selectFounders, type Evaluation, type ReplicateRow, type RetestRow } from "@bl/search";

const record: { provenance: { seeds: [number, number]; used: [number, number][] }; rows: RetestRow[] } = JSON.parse(
  await (await import("node:fs/promises")).readFile(new URL("../../../experiments/m3/retest.json", import.meta.url), "utf8"),
);
const replication: { provenance: { seeds: [number, number]; used: [number, number][] }; rows: ReplicateRow[] } = JSON.parse(
  await (await import("node:fs/promises")).readFile(new URL("../../../experiments/m3/replicate.json", import.meta.url), "utf8"),
);
const ev = (survived: number, regenerated: number, lightDependent: number, reps = 32): Evaluation => ({
  survived, recovered: survived, lightDependent, reps, individuals: 1, meanMass: 256, speed: 1, mass: 256, recovery: 1, regenerated, reproduction: 0,
});
const row = (label: string, cluster: number, e: Evaluation, fill = 1): RetestRow => ({
  label, cluster, weak: false, prior: null, eval: e, genome: { mu: 60, sigma: 20, motGain: 0, weights: new Array(160).fill(fill) },
});

describe("M3 founder set", () => {
  it("regenerates exactly from the committed retest and replication records", () => {
    checkFresh(record.provenance);
    checkFresh(replication.provenance);
    for (const r of [...record.provenance.used, record.provenance.seeds]) expect(replication.provenance.used).toContainEqual(r);
    const kept = replicatedFounders(selectFounders(record.rows), replication.rows);
    expect(kept.length).toBe(M3_FOUNDERS.length);
    kept.forEach(({ row: r, replication: p, pooled: q }, i) => {
      const f = M3_FOUNDERS[i];
      expect([f.cluster, f.survived, f.regenerated, f.lightDependent, f.reps]).toEqual([r.cluster, q.survived, q.regenerated, q.lightDependent, q.reps]);
      expect(f.retest).toEqual({ survived: r.eval.survived, regenerated: r.eval.regenerated, lightDependent: r.eval.lightDependent, reps: r.eval.reps });
      expect(f.replication).toEqual({ survived: p.eval.survived, regenerated: p.eval.regenerated, lightDependent: p.eval.lightDependent, reps: p.eval.reps });
      const g = founderGenome(f);
      expect({ ...g, weights: Array.from(g.weights) }).toEqual(r.genome);
    });
    expect(founderSetId(kept.map((k) => k.row.genome))).toBe(M3_FOUNDER_SET);
    // Cluster 23's candidate regenerated 31/32 then 25/32: 56/64 has a lower bound below 0.8.
    expect(M3_FOUNDERS.some((f) => f.cluster === 23)).toBe(false);
  });

  it("is pinned: presets gradient-m3 and spots-m3 are defined by this set (manifests record it via presetIdentity)", () => {
    expect(M3_FOUNDER_SET).toBe("m3-50886563ec90fb39");
  });
});

describe("replication", () => {
  it("pools counts and drops candidates that fail pooled, erroring on a missing replication", () => {
    const a = row("a", 1, ev(31, 31, 31), 1), b = row("b", 2, ev(32, 30, 32), 2);
    const rep = (r: RetestRow, e: Evaluation): ReplicateRow => ({ label: r.label, cluster: r.cluster!, genome: r.genome, eval: e });
    expect(poolCounts(ev(31, 31, 31), ev(29, 25, 32))).toMatchObject({ survived: 60, regenerated: 56, lightDependent: 63, reps: 64 });
    const kept = replicatedFounders([a, b], [rep(a, ev(32, 29, 32)), rep(b, ev(32, 25, 32))]);
    expect(kept.map((k) => k.row.label)).toEqual(["a"]);
    expect(() => replicatedFounders([a, b], [rep(a, ev(32, 32, 32))])).toThrow(/no replication/);
  });
});

describe("strict M3 test (32 replicates, lower bound > 0.8 on each probability)", () => {
  it("passes 30 of 32 on every criterion and fails 29 on any one", () => {
    expect(passesStrictM3(ev(30, 30, 30))).toBe(true);
    expect(passesStrictM3(ev(29, 32, 32))).toBe(false);
    expect(passesStrictM3(ev(32, 29, 32))).toBe(false);
    expect(passesStrictM3(ev(32, 32, 29))).toBe(false);
    expect(passesStrictM3(ev(16, 16, 16, 16))).toBe(false);
  });

  it("picks each cluster's best passer by regenerations, then dark deaths, then survivals, then retest order", () => {
    const picked = selectFounders([
      row("a", 2, ev(32, 30, 32), 1),
      row("b", 2, ev(30, 31, 30), 2),
      row("c", 2, ev(32, 31, 30), 3),
      row("d", 1, ev(31, 32, 31), 4),
      row("e", 1, ev(31, 32, 31), 5),
      row("f", 3, ev(32, 29, 32), 6),
    ]);
    expect(picked.map((r) => r.label)).toEqual(["d", "c"]);
  });
});

describe("retest seed freshness", () => {
  it("rejects overlapping, empty or malformed provenance", () => {
    expect(() => checkFresh({ seeds: [10, 20], used: [[1, 5]] })).not.toThrow();
    expect(() => checkFresh({ seeds: [10, 20], used: [[1, 10]] })).toThrow(/overlap/);
    expect(() => checkFresh({ seeds: [10, 20], used: [] })).toThrow(/no search/);
    expect(() => checkFresh({ seeds: [20, 10], used: [[1, 5]] })).toThrow(/not a range/);
    expect(() => checkFresh({ seeds: [10, 20], used: [[null, null]] as unknown as [number, number][] })).toThrow(/not a range/);
    expect(() => checkFresh({ seeds: [10, 20], used: [[1]] as unknown as [number, number][] })).toThrow(/not a range/);
    expect(() => checkFresh({ seeds: [10, 20], used: [[30, 25]] })).toThrow(/not a range/);
  });
});

describe("seed ranges from a confirmation record", () => {
  it("drops only a well-formed empty confirmation and derives legacy ranges", () => {
    expect(usedSeeds({ searchSeeds: [1, 5], confirmSeeds: [[100, 99], [100, 103]] }, 16)).toEqual([[1, 5], [100, 103]]);
    expect(usedSeeds({ searchSeeds: [1, 5], confirmSeed: 100, batchSize: 4 }, 9)).toEqual([[1, 5], [100, 102]]);
    expect(() => usedSeeds({ searchSeeds: [1, 5] }, 9)).toThrow(/confirmSeed/);
    expect(() => usedSeeds({ confirmSeeds: [] }, 0)).toThrow(/searchSeeds/);
  });

  it("keeps malformed ranges so checkFresh refuses them", () => {
    for (const bad of [[null, -1], ["100", 99], [2.5, 1.5]]) {
      const used = usedSeeds({ searchSeeds: [1, 5], confirmSeeds: [bad] }, 0) as [number, number][];
      expect(used).toContainEqual(bad);
      expect(() => checkFresh({ seeds: [10, 20], used })).toThrow(/not a range/);
    }
  });
});
