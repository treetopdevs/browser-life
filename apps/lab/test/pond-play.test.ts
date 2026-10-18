import { describe, expect, it } from "vitest";
import { CH, G, cellCount, initWorld, presetConfig, PRESETS, pondTraits, worldW, type WorldState } from "@bl/schema";
import { census } from "@bl/metrics";
import { AUTO_BREED_CHOICES, donorsWithKeep, isLineageKey, keptPondOf, lineageCellsByPond, type KeptPond } from "../src/pond-play.ts";

// ponds-small's world at seed 1 (2 x 2 ponds of 64 x 64, one founder lineage per pond), as the other lab tests use it; these
// functions only read a state, so none of it runs.
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const world = (): WorldState => initWorld(presetConfig(pondsSmall, 1, { pondArm: "breed", pondScore: "mass" }), pondsSmall.init);
/** The pond (0..3) a cell is in. */
const pondOf = (s: WorldState, i: number) => { const W = worldW(s.cfg); return Math.floor(Math.floor(i / W) / s.cfg.tileH) * s.cfg.tilesX + Math.floor((i % W) / s.cfg.tileW); };
/** The first lineage key of `s`'s cells that lives in pond `p`, and its cells. */
function lineageIn(s: WorldState, p: number): string {
  const n = cellCount(s.cfg);
  for (let i = 0; i < n; i++) if (pondOf(s, i) === p && (s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) return `${s.genome[G.LIN_HI * n + i]}:${s.genome[G.LIN_LO * n + i]}`;
  throw new Error(`no lineage in pond ${p}`);
}
/** Gives `count` more cells of pond `from`'s lineage `key` to pond `to` (the first living cells found there are relabelled), so a lineage lives in two ponds. */
function spread(s: WorldState, key: string, to: number, count: number): void {
  const n = cellCount(s.cfg), [hi, lo] = key.split(":").map(Number);
  let left = count;
  for (let i = 0; i < n && left > 0; i++) {
    if (pondOf(s, i) !== to || (s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) continue;
    s.genome[G.LIN_HI * n + i] = hi;
    s.genome[G.LIN_LO * n + i] = lo;
    left--;
  }
  expect(left).toBe(0);
}
/** Empties pond `p` of living cells (so it cannot donate), keeping its lineage words as they are. */
function thin(s: WorldState, p: number): void {
  const n = cellCount(s.cfg);
  for (let i = 0; i < n; i++) if (pondOf(s, i) === p) { s.cells[CH.B * n + i] = 0; s.cells[CH.P * n + i] = 0; }
}

describe("keptPondOf", () => {
  it("is the pond holding the most living cells of the lineage", () => {
    const s = world();
    const key = lineageIn(s, 1);
    const own = lineageCellsByPond(s, key)[1];
    expect(own).toBeGreaterThan(10);
    spread(s, key, 3, 5);
    expect(lineageCellsByPond(s, key)).toEqual([0, own, 0, 5]);
    expect(keptPondOf(s, key)).toEqual({ key, pond: 1, cells: own, living: own + 5 });
  });

  it("breaks a tie by the lower pond index", () => {
    const s = world();
    const key = lineageIn(s, 2);
    const n = lineageCellsByPond(s, key)[2];
    // Relabel pond 0's lineage to this one too, down to exactly pond 2's count there.
    spread(s, key, 0, n);
    expect(lineageCellsByPond(s, key)).toEqual([n, 0, n, 0]);
    expect(keptPondOf(s, key).pond).toBe(0);
  });

  it("skips a pond too thin to donate, while the lineage still counts as living", () => {
    const s = world();
    const key = lineageIn(s, 1);
    spread(s, key, 2, 3);
    thin(s, 1);
    expect(pondTraits(s)[1]).toBe(0);
    // Most of its cells are in pond 1, which cannot donate: pond 2 is where it can.
    const got = keptPondOf(s, key);
    expect(got.pond).toBe(2);
    expect(got.cells).toBe(3);
    expect(got.living).toBeGreaterThan(got.cells);
    // Thin the other pond too: it lives, but nowhere that can donate.
    thin(s, 2);
    expect(keptPondOf(s, key)).toMatchObject({ pond: null, cells: 0 });
    expect(keptPondOf(s, key).living).toBeGreaterThan(0);
  });

  it("says gone for a lineage no cell carries, and nothing for a key that is not one", () => {
    const s = world();
    expect(keptPondOf(s, "9:9")).toEqual({ key: "9:9", pond: null, cells: 0, living: 0 });
    for (const bad of ["", "0:0", "x", "1", "1:2:3", "-1:2"]) expect(keptPondOf(s, bad)).toMatchObject({ pond: null, cells: 0, living: 0 });
    expect(lineageCellsByPond(s, "x")).toEqual([0, 0, 0, 0]);
    expect([isLineageKey("12:7"), isLineageKey("12"), isLineageKey("a:b")]).toEqual([true, false, false]);
  });

  it("counts, per pond, the cells the census counts for the lineage on a real world", () => {
    const s = world();
    const n = cellCount(s.cfg);
    const c = census({ cfg: s.cfg, step: s.step, cells: s.cells, genomeHead: s.genome.slice(0, n * 4) });
    expect(c.lineages.length).toBeGreaterThan(1);
    for (const l of c.lineages) {
      const per = lineageCellsByPond(s, l.key);
      expect(per.reduce((a, b) => a + b, 0)).toBe(l.cells);
      expect(keptPondOf(s, l.key).living).toBe(l.cells);
    }
  });
});

describe("donorsWithKeep", () => {
  const kept = (pond: number | null): KeptPond => ({ key: "0:1", pond, cells: pond === null ? 0 : 7, living: 7 });

  it("leaves the rule's donors when the kept pond is already among them", () => {
    expect(donorsWithKeep([2, 0, 3], kept(0))).toEqual([2, 0, 3]);
    expect(donorsWithKeep([2], kept(2))).toEqual([2]);
  });

  it("replaces the last donor with the kept pond when it is not among them", () => {
    expect(donorsWithKeep([2, 0, 3], kept(1))).toEqual([2, 0, 1]);
    expect(donorsWithKeep([2], kept(1))).toEqual([1]);
  });

  it("leaves the rule's donors when nothing is kept, or the lineage lives in no pond that can donate", () => {
    expect(donorsWithKeep([2, 0], null)).toEqual([2, 0]);
    expect(donorsWithKeep([2, 0], kept(null))).toEqual([2, 0]);
    expect(donorsWithKeep([], kept(1))).toEqual([]);
  });

  it("never repeats a pond, never changes the count, and never touches its input", () => {
    const suggested = [3, 1, 2];
    for (const pond of [0, 1, 2, 3, null]) {
      const out = donorsWithKeep(suggested, kept(pond));
      expect(new Set(out).size).toBe(out.length);
      expect(out).toHaveLength(suggested.length);
      if (pond !== null) expect(out).toContain(pond);
    }
    expect(suggested).toEqual([3, 1, 2]);
  });
});

describe("AUTO_BREED_CHOICES", () => {
  it("offers 1, 5 and 20 cycles, and until stopped", () => {
    expect(AUTO_BREED_CHOICES.map((c) => [c.id, c.cycles])).toEqual([["1", 1], ["5", 5], ["20", 20], ["inf", Infinity]]);
    expect(AUTO_BREED_CHOICES.map((c) => c.label)).toEqual(["1 cycle", "5 cycles", "20 cycles", "Until I stop it"]);
  });
});
