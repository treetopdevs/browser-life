// tools/lib/breed-stats.ts: per-cycle summaries of a breeder run's ponds.tsv.
import { describe, expect, it } from "vitest";
import { BREED_POND_COLUMNS, POND_COLUMNS, PRESETS, applyPondCycle, breedPondColumns, initWorld, pondBodies, pondMatter, pondSeeds, presetConfig, type PondTerm } from "@bl/schema";
import { cycleSummaries, tileShift, type CycleSummary } from "../lib/breed-stats.ts";
import { tsvRows } from "../lib/scaffold-stats.ts";

const collect = async (text: string, scoreTerm?: PondTerm): Promise<CycleSummary[]> => {
  const out: CycleSummary[] = [];
  for await (const c of cycleSummaries(tsvRows(text.split("\n")), scoreTerm)) out.push(c);
  return out;
};

/** A ponds.tsv of the given rows: [cycle, recipient, donor, mass, individuals, score, donorScore], every other column 0. */
function file(rows: number[][]): string {
  const line = ([cycle, recipient, donor, mass, individuals, score, donorScore]: number[]) =>
    BREED_POND_COLUMNS.map((c) => ({ cycle, step: 1000 * cycle, recipient, donor, recipientTrait: mass, recipientIndividuals: individuals, score, donorScore })[c as string] ?? 0).join("\t");
  return [BREED_POND_COLUMNS.join("\t"), ...rows.map(line)].join("\n") + "\n";
}

describe("cycleSummaries", () => {
  it("summarises each boundary over its ponds", async () => {
    const got = await collect(
      file([
        [1, 0, 2, 100, 3, 0, 40],
        [1, 1, 2, 300, 5, 10, 40],
        [1, 2, 3, 200, 4, 40, 90],
        [1, 3, 3, 0, 0, 90, 90],
        [2, 0, -1, 50, 1, 7, 0],
        [2, 1, -1, 50, 1, 0, 0],
      ]),
    );
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({
      cycle: 1, step: 1000, ponds: 4, occupied: 3, scoring: 3,
      scoreMedian: 25, scoreMean: 35, scoreMax: 90, scorePerMass: 140 / 600, massMedian: 150,
      donorScoreMean: 65, donors: 2, individualsMean: 3, terms: {},
    });
    // An ended history: no donors, so no donor mean.
    expect(got[1].donors).toBe(0);
    expect(got[1].donorScoreMean).toBeNaN();
    expect([got[1].cycle, got[1].ponds, got[1].scoring, got[1].scorePerMass]).toEqual([2, 2, 1, 0.07]);
  });

  it("reads a real cycle's rows", async () => {
    const preset = PRESETS.find((p) => p.id === "ponds-small")!;
    const pre = initWorld(presetConfig(preset, 1), preset.init);
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), undefined, "mass");
    const text = [BREED_POND_COLUMNS.join("\t"), ...rows.map((r) => BREED_POND_COLUMNS.map((c) => String(r[c])).join("\t"))].join("\n");
    const [c] = await collect(text);
    expect([c.cycle, c.ponds, c.occupied, c.scoring, c.donors]).toEqual([1, 4, 4, 4, 1]);
    // Score "mass" is the bound mass itself.
    expect(c.scorePerMass).toBe(1);
    expect(c.scoreMax).toBe(Math.max(...rows.map((r) => r.recipientTrait)));
  });

  it("summarises the score as a term when the caller names it", async () => {
    const [c] = await collect(file([[1, 0, 2, 100, 3, 0, 40], [1, 1, 2, 300, 5, 10, 40], [1, 2, 3, 200, 4, 40, 90], [1, 3, 3, 0, 0, 90, 90]]), "drive");
    // The median is over the occupied ponds (0, 10, 40); the pond without mass still counts toward the sum and the maximum.
    expect(c.terms).toEqual({ drive: { median: 10, max: 90, perMass: 140 / 600 } });
  });

  it("summarises every term column of a combined score", async () => {
    const preset = PRESETS.find((p) => p.id === "ponds-small")!;
    const pre = initWorld(presetConfig(preset, 1), preset.init);
    const score = "drive+seed+body";
    const { rows } = applyPondCycle(pre, 1, "breed", 8, pondMatter(pre), undefined, score);
    const columns = breedPondColumns(score);
    const [c] = await collect([columns.join("\t"), ...rows.map((r) => columns.map((k) => String(r[k])).join("\t"))].join("\n"));
    const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return (v[1] + v[2]) / 2; };
    const seeds = pondSeeds(pre, 8), bodies = pondBodies(pre), mass = rows.reduce((a, r) => a + r.recipientTrait, 0);
    expect(Object.keys(c.terms)).toEqual(["drive", "seed", "body"]);
    expect(c.terms.drive).toEqual({ median: 0, max: 0, perMass: 0 });
    expect(c.terms.seed).toEqual({ median: median(seeds), max: Math.max(...seeds), perMass: seeds.reduce((a, v) => a + v, 0) / mass });
    expect(c.terms.body!.median).toBe(median(bodies));
    // Naming the score's term is for one-term runs; here the columns win and the rank stays the score.
    expect(c.scoreMax).toBe(0);
    await expect(collect([columns.join("\t"), columns.map((k) => (k === "seed" ? "1.5" : "1")).join("\t")].join("\n"))).rejects.toThrow(/column "seed" is not an integer: "1.5"/);
  });

  it("refuses a run without a score, a non-integer cell and cycles out of order", async () => {
    const v1 = [POND_COLUMNS.join("\t"), POND_COLUMNS.map(() => "0").join("\t")].join("\n");
    await expect(collect(v1)).rejects.toThrow(/no "score" column \(the run has no pondScore\)/);
    await expect(collect(file([[1, 0, 0, 10, 1, 5, 5]]).replace("\t5\t5\n", "\t5.5\t5\n"))).rejects.toThrow(/column "score" is not an integer: "5.5"/);
    await expect(collect(file([[2, 0, 0, 10, 1, 5, 5], [1, 0, 0, 10, 1, 5, 5]]))).rejects.toThrow(/cycle 1 follows cycle 2/);
  });
});

describe("tileShift", () => {
  const side = 64;
  /** A few soft blobs at irregular places, shifted by (sx, sy) on the torus (fractional shifts by sampling). */
  const pattern = (sx: number, sy: number): Float64Array => {
    const out = new Float64Array(side * side);
    const blobs = [[9, 12, 3], [40, 20, 4], [25, 47, 2.5], [55, 55, 3.5], [14, 36, 2]];
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++)
        for (const [cx, cy, r] of blobs) {
          const dx = ((x - cx - sx + 1.5 * side) % side) - side / 2, dy = ((y - cy - sy + 1.5 * side) % side) - side / 2;
          out[y * side + x] += 200 * Math.exp(-(dx * dx + dy * dy) / (2 * r * r));
        }
    return out;
  };

  it("finds no movement in an unmoved pattern", () => {
    const s = tileShift(pattern(0, 0), pattern(0, 0), side, 6)!;
    expect(Math.abs(s.dx)).toBeLessThan(1e-9);
    expect(Math.abs(s.dy)).toBeLessThan(1e-9);
    expect(s.corr).toBeCloseTo(1, 12);
    expect(s.corr0).toBe(s.corr);
  });

  it("finds a whole-cell shift on both axes, across the torus seam", () => {
    for (const [sx, sy] of [[3, 0], [0, -4], [-5, 2], [6, 6]]) {
      const s = tileShift(pattern(0, 0), pattern(sx, sy), side, 6)!;
      expect(Math.abs(s.dx - sx)).toBeLessThan(0.05);
      expect(Math.abs(s.dy - sy)).toBeLessThan(0.05);
      expect(s.corr).toBeGreaterThan(0.999);
      expect(s.corr0).toBeLessThan(s.corr);
    }
  });

  it("refines to a fraction of a cell", () => {
    const s = tileShift(pattern(0, 0), pattern(1.4, -0.3), side, 6)!;
    expect(Math.abs(s.dx - 1.4)).toBeLessThan(0.15);
    expect(Math.abs(s.dy + 0.3)).toBeLessThan(0.15);
  });

  it("returns null for an empty tile and refuses a bad window or size", () => {
    expect(tileShift(new Float64Array(side * side), pattern(0, 0), side, 6)).toBeNull();
    expect(tileShift(pattern(0, 0), new Float64Array(side * side).fill(7), side, 6)).toBeNull();
    expect(() => tileShift(pattern(0, 0), pattern(0, 0), side, 32)).toThrow(/window must be an integer in 1\.\.31/);
    expect(() => tileShift(new Float64Array(10), pattern(0, 0), side, 6)).toThrow(/must hold 4096 cells/);
  });
});
