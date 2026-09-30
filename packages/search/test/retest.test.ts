import { describe, expect, it } from "vitest";
import { founderGenome, M3_FOUNDER_SET, M3_FOUNDERS } from "@bl/schema";
import { checkFresh, poolCounts, replicatedFounders, selectRetestItems, shuffledOrder, usedSeeds, founderSetId, passesStrictM3, selectFounders, type EncGenome, type Evaluation, type ReplicateRow, type RetestRow, type RetestSelection } from "@bl/search";

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

describe("retest item selection", () => {
  const gen: EncGenome = { mu: 60, sigma: 20, motGain: 0, weights: new Array(160).fill(0) };
  const g = (fill: number): EncGenome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Array(160).fill(fill) });
  const crow = (cluster: number, fill: number, regenLowerBound: number, pass = true) => ({ pass, cluster, regenLowerBound, eval: ev(16, 14, 16, 16), genome: g(fill) });
  // Cluster 3 is weak (no member's 16-replicate bound exceeds 0.8): both members are kept. Cluster 5 is strong:
  // six strong members, one weaker member (not strong, so never taken) and one non-passer, in row order.
  const rows = [
    crow(3, 1, 0.7), crow(5, 10, 0.9), crow(5, 11, 0.9), crow(5, 12, 0.85), crow(5, 13, 0.7), crow(3, 2, 0.5),
    crow(5, 14, 0.95), crow(5, 15, 0.9), crow(5, 16, 0.9), crow(9, 99, 0.99, false), crow(5, 17, 0.9, false),
  ];
  const rowOrder: RetestSelection = { perStrong: 4, rank: "row-order", seed: null, confirm: "confirm.json" };
  const fillOf = (items: { genome: EncGenome }[]) => items.map((i) => i.genome.weights[0]);

  it("row-order takes the generalist, every weak member and the first perStrong strong members, in first-seen cluster order", () => {
    const items = selectRetestItems(rows, rowOrder, gen);
    expect(items.map((i) => i.label)).toEqual(["generalistGenome(60,20)", "c3.0", "c3.1", "c5.0", "c5.1", "c5.2", "c5.3"]);
    expect(items.map((i) => i.cluster)).toEqual([null, 3, 3, 5, 5, 5, 5]);
    expect(items.map((i) => i.weak)).toEqual([null, true, true, false, false, false, false]);
    expect(fillOf(items)).toEqual([0, 1, 2, 10, 11, 12, 14]);
    expect(items[0]).toMatchObject({ prior: null, genome: gen });
    expect(items[1].prior).toBe("14/16");
  });

  it("row-order reproduces the inline rule it replaced, whatever the cap", () => {
    // The code tools/retest.ts ran before selectRetestItems, verbatim, as the reference.
    const old = (perStrong: number) => {
      const by = new Map<number, typeof rows>();
      for (const r of rows.filter((r) => r.pass)) by.set(r.cluster, [...(by.get(r.cluster) ?? []), r]);
      const items: { label: string; cluster: number | null; weak: boolean | null; prior: string | null; genome: EncGenome }[] = [{ label: "generalistGenome(60,20)", cluster: null, weak: null, prior: null, genome: gen }];
      for (const [id, rs] of by) {
        const weak = !rs.some((r) => r.regenLowerBound > 0.8);
        (weak ? rs : rs.filter((r) => r.regenLowerBound > 0.8).slice(0, perStrong)).forEach((r, i) => items.push({ label: `c${id}.${i}`, cluster: id, weak, prior: `${r.eval.regenerated}/${r.eval.reps}`, genome: r.genome }));
      }
      return items;
    };
    for (const perStrong of [0, 1, 4, 6, 10]) expect(selectRetestItems(rows, { ...rowOrder, perStrong }, gen)).toEqual(old(perStrong));
  });

  it("seeded takes perStrong strong members of a strong cluster, deterministically, and differs from row order for some seed", () => {
    const strongFills = new Set([10, 11, 12, 14, 15, 16]);
    const pick = (seed: number) => selectRetestItems(rows, { perStrong: 4, rank: "seeded", seed, confirm: "confirm.json" }, gen);
    const first = pick(1);
    expect(pick(1)).toEqual(first);
    const c5 = first.filter((i) => i.cluster === 5);
    expect(c5.map((i) => i.label)).toEqual(["c5.0", "c5.1", "c5.2", "c5.3"]);
    expect(new Set(fillOf(c5)).size).toBe(4);
    for (const f of fillOf(c5)) expect(strongFills.has(f)).toBe(true);
    // The generalist and the weak cluster are unaffected by the shuffle.
    expect(first.filter((i) => i.cluster !== 5)).toEqual(selectRetestItems(rows, rowOrder, gen).filter((i) => i.cluster !== 5));
    const inRowOrder = fillOf(selectRetestItems(rows, rowOrder, gen).filter((i) => i.cluster === 5));
    const differs = Array.from({ length: 10 }, (_, k) => k + 1).some((s) => fillOf(pick(s).filter((i) => i.cluster === 5)).join() !== inRowOrder.join());
    expect(differs).toBe(true);
  });

  it("refuses an unusable selection", () => {
    expect(() => selectRetestItems(rows, { ...rowOrder, rank: "seeded" }, gen)).toThrow(/seed/);
    expect(() => selectRetestItems(rows, { ...rowOrder, perStrong: -1 }, gen)).toThrow(/perStrong/);
    expect(() => selectRetestItems(rows, { ...rowOrder, rank: "random" as "seeded", seed: 1 }, gen)).toThrow(/rank/);
  });

  it("shuffledOrder is a stable permutation", () => {
    const o = shuffledOrder(10, 7);
    expect([...o].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(shuffledOrder(10, 7)).toEqual(o);
    expect(shuffledOrder(10, 8)).not.toEqual(o);
    expect(shuffledOrder(0, 7)).toEqual([]);
    expect(shuffledOrder(1, 7)).toEqual([0]);
  });
});

describe("dependence seeds in a confirmation record", () => {
  const gate = { searchSeeds: [1, 5], confirmSeeds: [[100, 103]] };

  it("counts the dependence re-screen's seeds as used, so a retest cannot reuse them", () => {
    const used = usedSeeds({ ...gate, dependenceSeeds: [[50, 60]] }, 16);
    expect(used).toEqual([[1, 5], [100, 103], [50, 60]]);
    expect(used).toContainEqual([50, 60]);
    expect(() => checkFresh({ seeds: [55, 56], used: used as [number, number][] })).toThrow(/overlap/);
    // Without the record the same retest seeds look fresh, which is the gap this closes.
    expect(() => checkFresh({ seeds: [55, 56], used: usedSeeds(gate, 16) as [number, number][] })).not.toThrow();
  });

  it("keeps every re-screen's range, drops an empty one and refuses a malformed list", () => {
    expect(usedSeeds({ ...gate, dependenceSeeds: [[50, 60], [70, 69], [80, 82]] }, 16)).toEqual([[1, 5], [100, 103], [50, 60], [80, 82]]);
    expect(() => usedSeeds({ ...gate, dependenceSeeds: "50 to 60" as unknown as unknown[] }, 16)).toThrow(/dependenceSeeds/);
    const used = usedSeeds({ ...gate, dependenceSeeds: [[null, 60]] }, 16) as [number, number][];
    expect(() => checkFresh({ seeds: [200, 201], used })).toThrow(/not a range/);
  });
});
