import { describe, expect, it } from "vitest";
import { ATLAS_OCC_MIN, TileDescriptor, atlasCell, sameAtlasSpec, spearman, summarizeAtlas, type AtlasEval, type AtlasSpec } from "@bl/search";
import { FIXTURE_CADENCE, FIXTURE_TILE, fixtures, runFixture } from "../src/atlas-fixtures.ts";

const within = (v: number | null, want: number | [number, number] | null | undefined) => {
  if (want === undefined) return;
  if (want === null || v === null) return expect(v).toBe(want);
  if (Array.isArray(want)) {
    expect(v).toBeGreaterThanOrEqual(want[0]);
    expect(v).toBeLessThanOrEqual(want[1]);
  } else expect(v).toBe(want);
};

describe("descriptor fixtures: known values", () => {
  for (const f of fixtures())
    it(`${f.id}: ${f.note.slice(0, 70)}`, () => {
      const r = runFixture(f);
      within(r.d1, f.expect.d1);
      within(r.d2, f.expect.d2);
      within(r.comPath ?? null, f.expect.comPath);
    });
});

describe("descriptor fixtures: negative cases against the naive descriptors", () => {
  const by = Object.fromEntries(fixtures().map((f) => [f.id, f]));
  const r = (id: string) => runFixture(by[id]);
  it("path-length COM is fooled by out-and-back and by flicker; net displacement is not", () => {
    const o = r("out-and-back"), fl = r("flickering-edge"), slow = r("slow-disc");
    expect(o.comPath).toBeCloseTo(slow.comPath!, 6); // naive: identical to a steady mover
    expect(o.d1).toBeLessThan(1e-9);
    expect(fl.comPath!).toBeGreaterThan(10 * fl.d1! + 0.1);
  });
  it("occupied fraction cannot separate static from alternating checkerboards; Jaccard persistence can", () => {
    const frac = (id: string) => by[id].frames.map((f) => f.filter((v) => v >= ATLAS_OCC_MIN).length / f.length);
    expect(frac("checker-alternating")).toEqual(frac("checker-static"));
    expect(r("checker-static").d2).toBe(1);
    expect(r("checker-alternating").d2).toBe(0);
  });
  it("orders persistence static > slow > fast > noise > alternating", () => {
    const d = ["static-disc", "slow-disc", "fast-disc", "noise", "checker-alternating"].map((id) => r(id).d2!);
    for (let i = 1; i < d.length; i++) expect(d[i - 1]).toBeGreaterThan(d[i]);
  });
  it("is invariant to mass scale (recolour/re-render) and to translation of the whole trajectory", () => {
    const base = r("slow-disc");
    expect(r("recoloured-copy").d1).toBeCloseTo(base.d1!, 9);
    expect(r("recoloured-copy").d2).toBe(base.d2);
    expect(r("translated-copy").d1).toBeCloseTo(base.d1!, 9);
    expect(r("translated-copy").d2).toBe(base.d2);
  });
  it("reports no centre of mass for spread-out mass instead of an invented number", () => {
    for (const id of ["checker-alternating", "checker-static", "noise", "texture-drift", "extinct"]) expect(r(id).d1).toBeNull();
  });
  it("documents the symmetric-split blind spot: D1 is net transport", () => {
    expect(r("symmetric-split").d1!).toBeLessThan(1e-9);
    expect(r("symmetric-split").d2!).toBeLessThan(0.9);
  });
  it("uses the cadence it was fed: halving the cadence doubles cells per 100 steps", () => {
    const d = new TileDescriptor(FIXTURE_TILE);
    by["slow-disc"].frames.forEach((m, k) => d.push(m, 2000 + (k * FIXTURE_CADENCE) / 2));
    expect(d.result().d1!).toBeCloseTo(2, 6);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(fixtures().map(runFixture))).toBe(JSON.stringify(fixtures().map(runFixture)));
  });
});

describe("candidate summary and atlas cell", () => {
  const t = (d1: number | null, d2: number | null) => ({ d1, d2, comPath: d1, frames: 11 });
  it("takes the lower median of defined tiles and needs half the replicates defined", () => {
    expect(summarizeAtlas([t(1, 0.5), t(3, 0.7), t(2, 0.9), t(null, 0.1)])).toMatchObject({ d1: 2, d1Defined: 3, d2: 0.5, d2Defined: 4, reps: 4 });
    expect(summarizeAtlas([t(1, 0.5), t(null, 0.7), t(null, 0.9), t(null, 0.1)]).d1).toBeNull();
    expect(summarizeAtlas([t(1, 0.5), t(5, 0.7), t(null, 0.9), t(null, 0.1)]).d1).toBe(1);
  });
  const spec: AtlasSpec = { id: "atlas-v1", bins: 8, displacementRange: [0, 4], persistenceRange: [0, 1], calibration: "passed" };
  const a = (d1: number | null, d2: number | null): AtlasEval => ({ reps: 4, d1, d2, comPath: d1, d1Defined: 4, d2Defined: 4 });
  it("bins like the existing archive (clamped) and gives null for an undefined descriptor", () => {
    expect(atlasCell(spec, { atlas: a(0, 0) })).toEqual([0, 0]);
    expect(atlasCell(spec, { atlas: a(1.99, 0.51) })).toEqual([3, 4]);
    expect(atlasCell(spec, { atlas: a(99, 1) })).toEqual([7, 7]);
    expect(atlasCell(spec, { atlas: a(null, 0.5) })).toBeNull();
  });
  it("throws on non-finite descriptors and empty ranges instead of binning them", () => {
    expect(() => atlasCell(spec, { atlas: a(Number.NaN, 0.5) })).toThrow(/non-finite/);
    expect(() => atlasCell(spec, { atlas: a(0.5, Number.POSITIVE_INFINITY) })).toThrow(/non-finite/);
    expect(() => atlasCell({ ...spec, displacementRange: [1, 1] }, { atlas: a(0.5, 0.5) })).toThrow(/empty/);
  });
  it("compares atlas specs by definition, not by the calibration note", () => {
    expect(sameAtlasSpec(spec, { ...spec, calibration: "failed" })).toBe(true);
    expect(sameAtlasSpec(spec, { ...spec, displacementRange: [0, 5] })).toBe(false);
  });
  it("throws on an evaluation without descriptors rather than binning it as 0", () => {
    expect(() => atlasCell(spec, {})).toThrow(/no atlas descriptors/);
  });
});

describe("spearman", () => {
  it("handles ties, sign and degenerate input", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, 1, 2, 2], [1, 2, 1, 2])).toBeCloseTo(0, 12);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNaN();
    expect(spearman([1], [1])).toBeNaN();
  });
});
