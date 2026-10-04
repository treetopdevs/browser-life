import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  PRESETS,
  RULE_VERSION,
  buildWorld,
  cellCount,
  drawExportCentre,
  encodeCheckpoint,
  encodeGenome,
  exportDistance,
  founderGenome,
  initWorld,
  pondExportMasses,
  presetIdentity,
  stateHash,
  worldW,
  type WorldState,
} from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { ASSAY_COLUMNS, M_ASSAY, REG1_SEED_BLOCK, assaySuccess, buildAssayWorld, reg1PreCycleFileOf, standardFragment } from "../lib/pond-assay.ts";
import { pondConfig, pondMatter, randomKey, weightedPick } from "../lib/ponds.ts";
import { HUNT_SEEDS, HUNT1_PROTOCOL as HUNT_REPORT_PROTOCOL, huntExpectedSets, huntFragmentRow, huntScreenSets, huntSourceOriginOf, huntV1SourceProblems, huntWOf } from "../lib/hunt-stats.ts";
import {
  HUNT1_ANCESTOR_SEED_BASE,
  HUNT1_COLUMNS,
  HUNT1_DEATH,
  HUNT1_FRAGMENTS,
  HUNT1_G2_SEED_BASE,
  HUNT1_HISTORIES,
  HUNT1_HISTORY_ARMS,
  HUNT1_INOCULA,
  HUNT1_OWN_SCAFFOLD_SEED_BASE,
  HUNT1_PROTOCOL,
  HUNT1_REGIME,
  HUNT1_S1_SEED_MAX,
  HUNT1_SEED_BLOCK,
  HUNT1_SHA256,
  HUNT1_V1_PROTOCOL_SHA256,
  HUNT1_V1_SEED_BASE,
  checkHunt1Seeds,
  exportFamilies,
  exportFragment,
  familyOf,
  hunt1AncestorSeed,
  hunt1AssayJson,
  hunt1AssayOutProblems,
  hunt1BoundaryOf,
  hunt1BundleProblems,
  hunt1BundleTailsOf,
  hunt1BundleWant,
  hunt1D3Seed,
  hunt1D3WorldSeed,
  hunt1ExpectedSets,
  hunt1G2Seed,
  hunt1HistorySeed,
  hunt1Line,
  hunt1NoRows,
  hunt1OwnScaffoldSeed,
  hunt1ProtocolProblems,
  hunt1RegimeProblems,
  hunt1S1Seed,
  hunt1SeedOf,
  hunt1SetIdOf,
  hunt1SourceDirsOf,
  hunt1Summary,
  hunt1V1SourceProblems,
  hunt1V1WorldSeed,
  hunt1WaiverOutProblems,
  loadHunt1Source,
  parseHunt1Set,
  type Hunt1BundleWant,
  type Hunt1Row,
  type Hunt1Source,
} from "../lib/hunt-assay.ts";

const genomeA = founderGenome(M3_FOUNDERS[2]);
const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// ---------------------------------------------------------------------------------------------
// Crafted source worlds

/** An empty world (nutrient only) of side x side ponds, mutation off. */
const emptyWorld = (side: number, seed = 7): WorldState => buildWorld(pondConfig(side, seed, 0), { nutrient: 32, founders: [] });

/** Whether tile-local (x, y) is in the export zone at threshold 28, from the hunt's prose: x or y in {0-4, 60-63}. */
const inZone = (x: number, y: number): boolean => x <= 4 || x >= 60 || y <= 4 || y >= 60;

const cellIdx = (s: WorldState, pond: number, x: number, y: number): number => {
  const cfg = s.cfg;
  const tx = pond % cfg.tilesX;
  const ty = Math.floor(pond / cfg.tilesX);
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
};

/** Sets B, P and (with `lin`) the genome of a cell of a crafted world; matter is whatever the world then holds. */
function plant(s: WorldState, pond: number, x: number, y: number, p: { B?: number; P?: number; E?: number; lin?: number }): number {
  const n = cellCount(s.cfg);
  const i = cellIdx(s, pond, x, y);
  if (p.B !== undefined) s.cells[CH.B * n + i] = p.B;
  if (p.P !== undefined) s.cells[CH.P * n + i] = p.P;
  if (p.E !== undefined) s.cells[CH.E * n + i] = p.E;
  if (p.lin !== undefined) {
    const w = encodeGenome(genomeA, 0, p.lin);
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = w[g];
  }
  return i;
}

/**
 * The centre of `pond` for key (σ, 0, f) written from the hunt's prose: a cell of the export zone with B+P >= 48 drawn in proportion to B+P, walking
 * the tile in raster order, from purposes 3 and 4 of slot f (not from the implementation's zone mask).
 */
function oracleCentre(s: WorldState, pond: number, sigma: number, f: number): { x: number; y: number } {
  const n = cellCount(s.cfg);
  const weight = (x: number, y: number): number => {
    if (!inZone(x, y)) return 0;
    const i = cellIdx(s, pond, x, y);
    const m = s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
    return m >= 48 ? m : 0;
  };
  let total = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) total += weight(x, y);
  const v = weightedPick(randomKey(sigma, 0, f, 3), randomKey(sigma, 0, f, 4), total);
  let acc = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      acc += weight(x, y);
      if (acc > v) return { x, y };
    }
  }
  throw new Error("no centre");
}

/** A 2 x 2 source: pond 0 exports from three zone cells (and holds a big centre mass outside it), pond 1 holds mass only inside (occupied, not exporting), pond 2 exports one cell, pond 3 is empty. */
function craftedSource(): WorldState {
  const s = emptyWorld(2);
  plant(s, 0, 0, 0, { B: 100 });
  plant(s, 0, 62, 10, { B: 60, P: 40 });
  plant(s, 0, 20, 63, { B: 49 });
  plant(s, 0, 32, 32, { B: 5000 });
  plant(s, 0, 4, 4, { B: 47 }); // below the support threshold: never a centre, not counted
  plant(s, 1, 32, 32, { B: 300 });
  plant(s, 1, 10, 10, { B: 400, P: 100 });
  plant(s, 2, 59, 59, { B: 55 }); // x = 59 is outside the zone (60-63), y = 59 as well
  plant(s, 2, 60, 59, { B: 70 });
  return s;
}

describe("export zone, families and fragments", () => {
  it("the zone has 1,071 cells at threshold 28 and is the prose's x or y in {0-4, 60-63}", () => {
    let zone = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        expect(exportDistance(x, y) >= 28).toBe(inZone(x, y));
        if (inZone(x, y)) zone++;
      }
    }
    expect(zone).toBe(1071);
  });

  it("families are the exporting ponds in ascending index, with their export masses X_p", () => {
    const s = craftedSource();
    const { families, exportMass } = exportFamilies(s, 28);
    expect(exportMass).toEqual([100 + 100 + 49, 0, 70, 0]);
    expect(exportMass).toEqual(pondExportMasses(s, 28));
    expect(families).toEqual([0, 2]);
    expect(exportFamilies(emptyWorld(2), 28)).toEqual({ families: [], exportMass: [0, 0, 0, 0] });
  });

  it("assigns fragment g = 64 s + f to family g mod m: m = 64 gives each pond four fragments, m = 3 the residues, m = 0 has no family", () => {
    const all = Array.from({ length: 64 }, (_, p) => p);
    const count = new Map<number, number>();
    for (let s = 0; s < 4; s++) {
      for (let f = 0; f < 64; f++) {
        const fam = familyOf(all, s, f);
        expect(fam).toBe(f);
        count.set(fam, (count.get(fam) ?? 0) + 1);
      }
    }
    expect([...count.values()]).toEqual(new Array(64).fill(4));
    const three = [5, 9, 40];
    const seen = [0, 0, 0];
    for (let s = 0; s < 4; s++) for (let f = 0; f < 64; f++) seen[three.indexOf(familyOf(three, s, f))]++;
    expect(seen).toEqual([86, 85, 85]); // 256 = 3 x 85 + 1: g = 0, 3, ..., 255 go to the first
    expect(familyOf(three, 0, 0)).toBe(5);
    expect(familyOf(three, 1, 0)).toBe(9); // g = 64, 64 mod 3 = 1
    expect(familyOf(three, 3, 63)).toBe(5); // g = 255 = 3 x 85: the first family again
    expect(familyOf(three, 3, 62)).toBe(40); // g = 254, 254 mod 3 = 2
    expect(() => familyOf([], 0, 0)).toThrow(/no families/);
  });

  it("draws its centre with keys (σ, 0, f) from the family's zone only, as the prose's oracle does", () => {
    const s = craftedSource();
    const sigma = 4_900_201;
    for (const pond of [0, 2]) {
      for (let f = 0; f < 64; f++) {
        const want = oracleCentre(s, pond, sigma, f);
        const fr = exportFragment(s, 8, 28, sigma, f, pond)!;
        expect({ x: fr.cx, y: fr.cy }).toEqual(want);
        expect(inZone(fr.cx, fr.cy)).toBe(true);
        expect(fr.pond).toBe(pond);
        const centre = drawExportCentre(s, pond, 28, sigma, 0, f)!;
        expect(cellIdx(s, pond, fr.cx, fr.cy)).toBe(centre);
      }
    }
    // pond 0 draws all three exporting cells over 64 keys, never the big mass at the pond centre
    const picked = new Set(Array.from({ length: 64 }, (_, f) => exportFragment(s, 8, 28, sigma, f, 0)!).map((fr) => `${fr.cx},${fr.cy}`));
    expect(picked).toEqual(new Set(["0,0", "62,10", "20,63"]));
    // the key matters: another σ or another f is another draw sequence
    const draws = (sg: number) => Array.from({ length: 64 }, (_, f) => exportFragment(s, 8, 28, sg, f, 0)!.cx).join();
    expect(draws(sigma + 1)).not.toBe(draws(sigma));
    // a pond with no eligible cell in its zone has no fragment
    expect(exportFragment(s, 8, 28, sigma, 0, 1)).toBeNull();
    expect(exportFragment(s, 8, 28, sigma, 0, 3)).toBeNull();
  });

  it("wraps the k x k window inside the family's tile and lands it at the assay pond's centre", () => {
    const s = emptyWorld(2);
    // a small mass (below the support threshold, so never a centre) at every cell of the wrapped window, the only eligible cell at its centre, and a lineage at one corner
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) plant(s, 3, (60 + i) % 64, (60 + j) % 64, { B: 1 + ((8 * j + i) % 40) });
    plant(s, 3, 0, 0, { B: 100 });
    plant(s, 3, 60, 60, { B: 7, lin: 5 });
    const fr = exportFragment(s, 8, 28, 4_901_001, 17, 3)!;
    expect({ cx: fr.cx, cy: fr.cy }).toEqual({ cx: 0, cy: 0 });
    expect(fr.cells).toHaveLength(64);
    // landing coordinates 28..35 on both axes, raster order; source cell of landing (28 + i, 28 + j) is ((60 + i) mod 64, (60 + j) mod 64)
    const n = cellCount(s.cfg);
    fr.cells.forEach((c, q) => {
      const i = q % 8, j = Math.floor(q / 8);
      expect({ x: c.x, y: c.y }).toEqual({ x: 28 + i, y: 28 + j });
      const src = cellIdx(s, 3, (60 + i) % 64, (60 + j) % 64);
      expect(c.B).toBe(s.cells[CH.B * n + src]);
      expect(c.P).toBe(0);
    });
    expect(fr.cells[0].B).toBe(7);
    expect(fr.cells[0].genome[G.LIN_LO]).toBe(5);
    expect(fr.cells[0].genome[G.LIN_HI]).toBe(0);
    expect(fr.reqMass).toBe(fr.retMass);
    expect(fr.truncated).toBe(false);
  });

  it("truncates against M_ASSAY in reverse raster order, as v1's fragments are", () => {
    const s = emptyWorld(2);
    // B = 3000 over both border bands (x or y within 8 of the tile's edge): the window of any centre in the zone lies inside them, 64 x 3000 = 192,000
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x <= 8 || x >= 56 || y <= 8 || y >= 56) plant(s, 0, x, y, { B: 3000 });
    const fr = exportFragment(s, 8, 28, 4_901_001, 3, 0)!;
    expect(fr.reqMass).toBe(192_000);
    expect(fr.truncated).toBe(true);
    expect(fr.cells).toHaveLength(50); // 50 x 3,000 = 150,000 <= 151,552 < 51 x 3,000
    expect(fr.retMass).toBe(150_000);
    expect(fr.retMass).toBeLessThanOrEqual(M_ASSAY);
    expect(fr.cells.at(-1)).toMatchObject({ x: 28 + (49 % 8), y: 28 + Math.floor(49 / 8) }); // the dropped cells are the last of the raster order
  });

  it("is v1's standardFragment when the zone is the whole tile (threshold 0): the same centre, window, truncation and cells", () => {
    const s = emptyWorld(2);
    for (let p = 0; p < 4; p++) {
      for (let k = 0; k < 40; k++) plant(s, p, (k * 7 + p) % 64, (k * 13 + 3 * p) % 64, { B: 40 + ((k * 31) % 90), P: k % 3 === 0 ? 20 : 0, E: k, lin: 1 + (k % 3) });
    }
    for (let p = 0; p < 4; p++) for (let f = 0; f < 24; f++) expect(exportFragment(s, 8, 0, 4_900_201, f, p)).toEqual(standardFragment(s, 8, 4_900_201, f, p));
    expect(exportFragment(emptyWorld(2), 8, 0, 4_900_201, 0, 0)).toBeNull();
  });

  it("plants a family's fragments into an assay world whose every pond holds exactly M_ASSAY, relabelled by v1's rule", () => {
    const s = emptyWorld(8);
    // every fourth pond exports (16 families), with a lineage in its zone cells
    for (let p = 0; p < 64; p += 4) for (let k = 0; k < 6; k++) plant(s, p, k, (k * 11 + p) % 64, { B: 60 + k, P: 5, E: 3, lin: 1 + (k % 2) });
    const { families, exportMass } = exportFamilies(s, 28);
    expect(families).toHaveLength(16);
    expect(exportMass.filter((x) => x > 0)).toHaveLength(16);
    const plans = Array.from({ length: 64 }, (_, f) => ({ family: familyOf(families, 1, f), fr: exportFragment(s, 8, 28, 4_902_001 + 1, f, familyOf(families, 1, f))! }));
    expect(plans.map((p) => p.family)).toEqual(Array.from({ length: 64 }, (_, f) => families[(64 + f) % 16]));
    const { state, planted } = buildAssayWorld(pondConfig(8, 4_902_002, 0), plans.map((p) => ({ kind: "fragment" as const, fragment: p.fr })));
    expect(pondMatter(state)).toEqual(new Array(64).fill(M_ASSAY));
    expect(planted.every((pl) => pl.retMass > 0 && pl.retMass <= M_ASSAY)).toBe(true);
    // lineage ids are relabelled to (0, k + 1) by first appearance
    const n = cellCount(state.cfg);
    const ids = new Set<number>();
    for (let i = 0; i < n; i++) if ((state.genome[G.LIN_HI * n + i] | state.genome[G.LIN_LO * n + i]) !== 0) ids.add(state.genome[G.LIN_LO * n + i]);
    expect(Math.max(...ids)).toBe(ids.size);
  });
});

// ---------------------------------------------------------------------------------------------
// The summary

describe("W, Wexport and edgeShare", () => {
  const row = (replicate: number, pond: number, family: number, endTrait: number, exportMass: number): Hunt1Row => ({ replicate, pond, family, endTrait, exportMass });
  const rows = [row(0, 0, 3, 100, 10), row(0, 1, 7, 200, 40), row(0, 2, 3, 300, 20), row(1, 0, 7, 400, 50)];

  it("W is the mean over families of each family's mean X_f, Wexport weights the family means by X_p, edgeShare is ΣX_f / Σ trait", () => {
    const s = hunt1Summary(rows, [3, 7], [100, 300]);
    expect(s.W).toBe((15 + 45) / 2);
    expect(s.Wexport).toBe((100 * 15 + 300 * 45) / 400);
    expect(s.families).toBe(2);
    expect(s.fragments).toBe(4);
    expect(s.edgeShare).toBe(120 / 1000);
    // the row order does not change a float
    expect(hunt1Summary([...rows].reverse(), [3, 7], [100, 300])).toEqual(s);
    // equal weight per family, whatever the fragments per family: a family with one fragment weighs as much as one with three
    expect(hunt1Summary([row(0, 0, 3, 10, 0), row(0, 1, 7, 10, 30), row(0, 2, 7, 10, 30), row(0, 3, 7, 10, 30)], [3, 7], [1, 1]).W).toBe(15);
  });

  it("is 0 where a denominator is 0: no trait, no export mass, no family, no row", () => {
    expect(hunt1Summary([row(0, 0, 3, 0, 0), row(0, 1, 7, 0, 0)], [3, 7], [10, 10])).toEqual({ W: 0, Wexport: 0, families: 2, fragments: 2, edgeShare: 0 });
    expect(hunt1Summary(rows, [3, 7], [0, 0]).Wexport).toBe(0);
    expect(hunt1Summary([], [], [])).toEqual({ W: 0, Wexport: 0, families: 0, fragments: 0, edgeShare: 0 });
    expect(() => hunt1Summary(rows, [3, 7], [1])).toThrow(/export masses/);
  });

  it("the m = 0 and no-genome records: W = 0, no fragment, the header only", () => {
    const none = hunt1NoRows("noFamilies", 0);
    expect(none.flags).toEqual({ noFamilies: true });
    expect(none.summary).toEqual({ W: 0, Wexport: 0, families: 0, fragments: 0, edgeShare: 0 });
    expect(none.tsv).toBe(`${HUNT1_COLUMNS.join("\t")}\n`);
    const noGenome = hunt1NoRows("noGenome", 64);
    expect(noGenome.flags).toEqual({ noGenome: true });
    expect(noGenome.summary).toEqual({ W: 0, Wexport: 0, families: 64, fragments: 0, edgeShare: 0 });
    expect(noGenome.tsv).toBe(none.tsv);
    // an empty source has no family, so nothing to plant
    expect(exportFamilies(emptyWorld(2), 28).families).toEqual([]);
  });

  it("writes v1's columns and then X_f, and the existing assay.json fields, `export` and the extras", () => {
    expect(HUNT1_COLUMNS).toEqual([...ASSAY_COLUMNS, "exportMass"]);
    const planted = { reqMass: 6000, retMass: 5000, reqE: 40, retE: 30, landed: 60, truncated: false };
    const cells = hunt1Line({ set: "g2-scaf-i0", replicate: 1, pond: 5, family: 3, inoculum: "fragment", planted, endTrait: 120_000, success: assaySuccess(120_000, 5000, 103_058), exportMass: 31_000 }).split("\t");
    expect(cells).toHaveLength(HUNT1_COLUMNS.length);
    expect(Object.fromEntries(HUNT1_COLUMNS.map((c, q) => [c, cells[q]]))).toMatchObject({ assay: "export", source: "g2-scaf-i0", replicate: "1", pond: "5", family: "3", inoculum: "fragment", retMass: "5000", endTrait: "120000", success: "1", exportMass: "31000", truncated: "0" });
    const set = parseHunt1Set("g2", "g2-scaf-i0");
    const json = hunt1AssayJson({ protocolSha256: "p", set: "g2-scaf-i0", source: "src", labels: set.labels, inoculum: "fragment", k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 4, censusEvery: 100, threshold: 28, seeds: [{ physics: 1, fragment: 1 }], extra: { provenance: { x: 1 } }, summary: { W: 1, Wexport: 2, families: 3, fragments: 4, edgeShare: 0.5 }, wallSeconds: 2 });
    expect(Object.keys(json)).toEqual(["tool", "protocolSha256", "assay", "source", "tag", "k", "period", "ref", "side", "replicates", "mutRate", "censusEvery", "export", "inoculum", "seeds", "labels", "provenance", "summary", "conservationOk", "wallSeconds"]);
    expect(json).toMatchObject({ assay: "export", tag: "g2-scaf-i0", mutRate: 0, export: 28, conservationOk: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Seeds, labels and sets

describe("the hunt's seeds and set labels", () => {
  it("has the document's seed formulas and maxima", () => {
    expect(hunt1G2Seed(0, 0)).toBe(4_900_201);
    expect(hunt1G2Seed(11, 3)).toBe(4_900_314);
    expect(hunt1G2Seed(6, 2)).toBe(4_900_201 + 60 + 2);
    expect(hunt1D3Seed(0, 0, 0)).toBe(4_900_501);
    expect(hunt1D3Seed(1, 3, 3)).toBe(4_900_574);
    expect(hunt1D3Seed(1, 2, 1)).toBe(4_900_501 + 10 * 6 + 1);
    expect(hunt1D3WorldSeed(0, 0)).toBe(4_900_401);
    expect(hunt1D3WorldSeed(1, 3)).toBe(4_900_414);
    expect(hunt1HistorySeed(0, 0)).toBe(4_901_001);
    expect(hunt1HistorySeed(3, 23)).toBe(4_901_324);
    expect(hunt1AncestorSeed(3)).toBe(4_901_404);
    expect(hunt1OwnScaffoldSeed(23)).toBe(4_901_524);
    expect(hunt1S1Seed(0, 0)).toBe(4_902_001);
    expect(hunt1S1Seed(123, 3)).toBe(4_903_234);
    expect(hunt1S1Seed(123, 8)).toBe(4_903_239); // the permutation stream of the last h: the document's maximum
    expect(HUNT1_S1_SEED_MAX).toBe(4_903_239);
    expect(hunt1V1WorldSeed("scaf", 0)).toBe(4_810_001);
    expect(hunt1V1WorldSeed("rand", 5)).toBe(4_810_106);
  });

  it("refuses an out-of-range field of every seed function", () => {
    expect(() => hunt1G2Seed(12, 0)).toThrow(/h must be an integer in 0\.\.11/);
    expect(() => hunt1G2Seed(0, 4)).toThrow(/s must be an integer in 0\.\.3/);
    expect(() => hunt1D3Seed(2, 0, 0)).toThrow(/arm/);
    expect(() => hunt1D3Seed(0, 4, 0)).toThrow(/j/);
    expect(() => hunt1D3WorldSeed(0, 4)).toThrow(/j/);
    expect(() => hunt1HistorySeed(4, 0)).toThrow(/a/);
    expect(() => hunt1HistorySeed(0, 24)).toThrow(/i/);
    expect(() => hunt1AncestorSeed(4)).toThrow(/j/);
    expect(() => hunt1OwnScaffoldSeed(24)).toThrow(/i/);
    expect(() => hunt1S1Seed(124, 0)).toThrow(/h must be an integer in 0\.\.123/);
    for (const s of [4, 7, 9, -1, 0.5]) expect(() => hunt1S1Seed(0, s)).toThrow(/0-3 \(a replicate\) or 8/);
    expect(() => hunt1V1WorldSeed("scaf", 6)).toThrow(/i/);
    expect(() => hunt1G2Seed(1.5, 0)).toThrow(/h/);
  });

  it("keeps every seed in the reserved block, above every earlier block, with no collision among the hunt's own", () => {
    expect(HUNT1_SEED_BLOCK).toEqual({ min: 4_900_001, max: 4_949_999 });
    // the registration's block ends where the hunt's begins, and the earlier blocks (sandbox 4,800,001-4,849,999, v1's main runs) lie below it
    expect(HUNT1_SEED_BLOCK.min).toBe(REG1_SEED_BLOCK.max + 2);
    expect(hunt1V1WorldSeed("rand", 5)).toBeLessThan(4_820_001);
    const all: number[] = [];
    // G1 (4,900,001 + 10 arm + s; the fallback's 4,900,101 + ...), the device check and the reproducibility draw
    for (const base of [4_900_001, 4_900_101]) for (let arm = 0; arm < 2; arm++) for (let s = 0; s < 2; s++) all.push(base + 10 * arm + s);
    all.push(4_905_001, 4_905_101);
    for (let h = 0; h < 12; h++) for (let s = 0; s < 4; s++) all.push(hunt1G2Seed(h, s));
    for (let arm = 0; arm < 2; arm++) {
      for (let j = 0; j < 4; j++) {
        all.push(hunt1D3WorldSeed(arm, j));
        for (let s = 0; s < 4; s++) all.push(hunt1D3Seed(arm, j, s));
      }
    }
    for (let a = 0; a < 4; a++) for (let i = 0; i < 24; i++) all.push(hunt1HistorySeed(a, i));
    for (let j = 0; j < 4; j++) all.push(hunt1AncestorSeed(j));
    for (let i = 0; i < 24; i++) all.push(hunt1OwnScaffoldSeed(i));
    for (let h = 0; h < 124; h++) for (const s of [0, 1, 2, 3, 8]) all.push(hunt1S1Seed(h, s));
    expect(new Set(all).size).toBe(all.length);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(HUNT1_SEED_BLOCK.min);
    expect(Math.max(...all)).toBeLessThanOrEqual(HUNT1_SEED_BLOCK.max);
  });

  it("names 295 sets (G2's 18, D3's 8, Stage 1's 269) whose ids round-trip through the parser", () => {
    const sets = hunt1ExpectedSets();
    expect(hunt1ExpectedSets("g2")).toHaveLength(18);
    expect(hunt1ExpectedSets("d3")).toHaveLength(8);
    expect(hunt1ExpectedSets("s1")).toHaveLength(269);
    expect(sets).toHaveLength(295);
    expect(new Set(sets.map((s) => s.labels.set)).size).toBe(295);
    const count = (variant: string) => hunt1ExpectedSets("s1").filter((s) => s.labels.variant === variant).length;
    expect({ w: count("w"), quench: count("quench"), genome: count("genome"), control: count("genome-control") }).toEqual({ w: 96 + 4 + 24, quench: 48, genome: 96, control: 1 });
    for (const set of sets) {
      expect(hunt1SetIdOf(set.labels)).toBe(set.labels.set);
      expect(parseHunt1Set(set.labels.stage, set.labels.set)).toEqual(set);
      expect(set.labels.hunt1).toBe(true);
      expect(set.inoculum).toBe(HUNT1_INOCULA[set.labels.variant]);
      expect(set.replicates).toBe(set.labels.variant === "quench" ? 1 : 4);
    }
  });

  it("has the labels and sources the document names", () => {
    expect(parseHunt1Set("g2", "g2-scaf-i3")).toEqual({ labels: { hunt1: true, stage: "g2", set: "g2-scaf-i3", arm: "scaf", history: 3, h: 3, variant: "w", control: null }, replicates: 4, inoculum: "fragment", source: { kind: "v1", arm: "scaf", i: 3 }, donor: null });
    expect(parseHunt1Set("g2", "g2-rand-i5").labels).toMatchObject({ arm: "rand", history: 5, h: 11 });
    expect(parseHunt1Set("g2", "g2-scaf-i5-quench")).toMatchObject({ labels: { variant: "quench", h: 5 }, replicates: 1, inoculum: "quenched", source: { kind: "v1", arm: "scaf", i: 5 } });
    expect(parseHunt1Set("d3", "d3-shuf-j2")).toMatchObject({ labels: { arm: "shuf", history: 2, h: 6 }, source: { kind: "d3", arm: "shuf", j: 2 } });
    expect(parseHunt1Set("s1", "s1-shuf-s-i23")).toMatchObject({ labels: { arm: "shuf-s", history: 23, h: 24 * 3 + 23 }, source: { kind: "hist", arm: "shuf-s", i: 23 } });
    expect(parseHunt1Set("s1", "s1-nat-s-i07-quench")).toMatchObject({ labels: { variant: "quench", h: 48 + 7 }, replicates: 1, source: { kind: "hist", arm: "nat-s", i: 7 } });
    // a genome-only set fragments ancestor world 0 (seeds σ(96, s)) and plants the dominant genome of its history's time C; its control plants M3_FOUNDERS[2]
    expect(parseHunt1Set("s1", "s1-shuf-a-i04-genome")).toMatchObject({ labels: { arm: "shuf-a", history: 4, h: 96, variant: "genome", control: null }, inoculum: "swap-ea", source: { kind: "anc", j: 0 }, donor: { kind: "hist", arm: "shuf-a", i: 4 } });
    expect(parseHunt1Set("s1", "s1-genome-control")).toEqual({ labels: { hunt1: true, stage: "s1", set: "s1-genome-control", arm: null, history: null, h: 96, variant: "genome-control", control: "ancestor-genome" }, replicates: 4, inoculum: "swap-aa", source: { kind: "anc", j: 0 }, donor: null });
    expect(parseHunt1Set("s1", "s1-anc-j2")).toMatchObject({ labels: { arm: "anc", history: 2, h: 98 }, source: { kind: "anc", j: 2 } });
    expect(parseHunt1Set("s1", "s1-src-i11")).toMatchObject({ labels: { arm: "src", history: 11, h: 111 }, source: { kind: "src", i: 11 } });
  });

  it("refuses an id that is no set of its stage", () => {
    expect(() => parseHunt1Set("g1", "g2-scaf-i0")).toThrow(/--stage must be g2\|d3\|s1/);
    expect(() => parseHunt1Set(undefined, "g2-scaf-i0")).toThrow(/--stage/);
    expect(() => parseHunt1Set("g2", undefined)).toThrow(/--set is required/);
    for (const [stage, id] of [
      ["s1", "g2-scaf-i0"], // another stage's set
      ["g2", "d3-nat-j0"],
      ["d3", "g2-scaf-i0"],
      ["g2", "g2-scaf-i6"],
      ["g2", "g2-rand-i0-quench"], // only scaf sources have a quenched control
      ["g2", "g2-scaf-i0-genome"],
      ["g2", "g2-cont-i0"],
      ["g2", "g2-scaf-i00"],
      ["d3", "d3-nat-j4"],
      ["d3", "d3-nat-j0-quench"],
      ["s1", "s1-shuf-a-i03-quench"], // nat histories only
      ["s1", "s1-shuf-s-i03-quench"],
      ["s1", "s1-nat-a-i24"],
      ["s1", "s1-nat-a-i3"], // two digits
      ["s1", "s1-nat-x-i03"],
      ["s1", "s1-anc-j4"],
      ["s1", "s1-anc-j0-genome"],
      ["s1", "s1-src-i24"],
      ["s1", "s1-src-i03-quench"],
      ["s1", "s1-genome-control-quench"],
      ["g2", "s1-genome-control"],
    ] as const) {
      expect(() => parseHunt1Set(stage, id), `${stage} ${id}`).toThrow(/is not a (g2|d3|s1) set/);
    }
  });

  it("accepts the document's seeds for every set and replicate, and refuses every mismatch", () => {
    for (const set of hunt1ExpectedSets()) {
      const l = set.labels;
      for (let s = 0; s < set.replicates; s++) {
        const sigma = hunt1SeedOf(l, s);
        expect(() => checkHunt1Seeds(l, { physics: sigma, fragment: sigma }, s), `${l.set} s${s}`).not.toThrow();
        expect(() => checkHunt1Seeds(l, { physics: sigma + 1, fragment: sigma }, s)).toThrow(/does not match the hunt's labels/);
        expect(() => checkHunt1Seeds(l, { physics: sigma, fragment: sigma - 1 }, s)).toThrow(/fragment seed/);
      }
      // the seeds of replicate 0 are not replicate 1's
      expect(() => checkHunt1Seeds(l, { physics: hunt1SeedOf(l, 0), fragment: hunt1SeedOf(l, 0) }, 1)).toThrow(/does not match/);
    }
    // the document's σ(h, s) for particular sets
    const sigma = (stage: string, id: string) => hunt1SeedOf(parseHunt1Set(stage, id).labels, 0);
    expect(sigma("g2", "g2-scaf-i0")).toBe(4_900_201);
    expect(sigma("g2", "g2-rand-i5")).toBe(4_900_311);
    expect(sigma("d3", "d3-nat-j3")).toBe(4_900_531);
    expect(sigma("d3", "d3-shuf-j2")).toBe(4_900_561);
    expect(sigma("s1", "s1-nat-a-i00")).toBe(4_902_001);
    expect(sigma("s1", "s1-shuf-s-i23")).toBe(4_902_001 + 10 * 95);
    expect(sigma("s1", "s1-anc-j3")).toBe(4_902_001 + 10 * 99);
    expect(sigma("s1", "s1-src-i23")).toBe(4_902_001 + 10 * 123);
    // genome-only sets and their control share ancestor world 0's σ(96, s); a quenched set uses its source's σ(h, 0)
    expect(sigma("s1", "s1-nat-a-i05-genome")).toBe(4_902_961);
    expect(sigma("s1", "s1-genome-control")).toBe(4_902_961);
    expect(sigma("s1", "s1-nat-a-i05-quench")).toBe(sigma("s1", "s1-nat-a-i05"));
    expect(sigma("g2", "g2-scaf-i4-quench")).toBe(sigma("g2", "g2-scaf-i4"));
    // one set's seeds are not another's
    const a = parseHunt1Set("g2", "g2-scaf-i0").labels;
    expect(() => checkHunt1Seeds(a, { physics: hunt1G2Seed(1, 0), fragment: hunt1G2Seed(1, 0) }, 0)).toThrow(/want σ\(0, 0\) = 4900201/);
    expect(() => checkHunt1Seeds(parseHunt1Set("s1", "s1-nat-a-i00-genome").labels, { physics: 4_902_001, fragment: 4_902_001 }, 0)).toThrow(/σ\(96, 0\)/);
  });

  it("holds the hunt's regime: k 8, period 10,000, ref 103,058, side 8, census 100, zone 28, four replicates", () => {
    const ok = { k: 8, period: 10_000, ref: 103_058, side: 8, censusEvery: 100, export: 28, replicates: 4 };
    expect(HUNT1_REGIME).toEqual(ok);
    expect(hunt1RegimeProblems(ok)).toEqual([]);
    for (const key of Object.keys(ok) as (keyof typeof ok)[]) expect(hunt1RegimeProblems({ ...ok, [key]: 1 }), key).toEqual([`${key} 1, want ${ok[key]}`]);
    expect(hunt1RegimeProblems({ ...ok, ref: null })).toEqual(["ref null, want 103058"]);
    expect(HUNT1_FRAGMENTS).toBe(64);
  });

  it("writes a set into runs/scaffold/hunt1/assays/<set id>, and a smoke test never into that tree", () => {
    const l = parseHunt1Set("g2", "g2-scaf-i0").labels;
    expect(hunt1AssayOutProblems(l, "runs/scaffold/hunt1/assays/g2-scaf-i0")).toEqual([]);
    expect(hunt1AssayOutProblems(l, "/repo/runs/scaffold/hunt1/assays/g2-scaf-i0/")).toEqual([]);
    expect(hunt1AssayOutProblems(l, "runs/scaffold/hunt1/assays/g2-scaf-i1").join()).toMatch(/does not end in scaffold\/hunt1\/assays\/g2-scaf-i0/);
    expect(hunt1AssayOutProblems(l, "runs/scaffold/reg1/assays/g2-scaf-i0")).toHaveLength(1);
    expect(hunt1AssayOutProblems(l, "/tmp/g2-scaf-i0")).toHaveLength(1);
    const production = "/repo/runs/scaffold/hunt1";
    expect(hunt1WaiverOutProblems("/repo/runs/scaffold/hunt1/assays/g2-scaf-i0", production)).toHaveLength(1);
    expect(hunt1WaiverOutProblems("/repo/runs/scaffold/hunt1", production)).toHaveLength(1);
    expect(hunt1WaiverOutProblems("/repo/runs/scaffold/hunt1/", production)).toHaveLength(1);
    expect(hunt1WaiverOutProblems("/repo/runs/scaffold/hunt1-smoke/x", production)).toEqual([]);
    expect(hunt1WaiverOutProblems("/repo/runs/scaffold/reg1/assays/x", production)).toEqual([]);
    expect(hunt1WaiverOutProblems("/tmp/smoke", production)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The pinned hunt

describe("the pinned hunt document", () => {
  const doc = new Uint8Array(readFileSync(root("docs/scaffold-transition-hunt-v1.md")));
  const text = new TextDecoder().decode(doc);
  const enc = (s: string) => new TextEncoder().encode(s);

  it("is the frozen document's SHA-256 and length, as experiments/scaffold/HUNT-v1 records it", () => {
    expect(HUNT1_SHA256).toBe(HUNT1_PROTOCOL.sha256);
    expect(readFileSync(root("experiments/scaffold/HUNT-v1"), "utf8").split(/\s+/)[0]).toBe(HUNT1_SHA256);
    expect(createHash("sha256").update(doc.slice(0, HUNT1_PROTOCOL.bytes)).digest("hex")).toBe(HUNT1_SHA256);
    expect(doc.length).toBeGreaterThanOrEqual(HUNT1_PROTOCOL.bytes);
  });

  it("accepts the document and the document with an amendment appended, and refuses an edit inside the pinned text", async () => {
    expect(await hunt1ProtocolProblems(doc)).toEqual([]);
    expect(await hunt1ProtocolProblems(enc(`${text}\n## Amendment 1 (2026-10-05)\n\nAn amendment goes at the end.\n`))).toEqual([]);
    const at = Math.floor(HUNT1_PROTOCOL.bytes / 2);
    const edited = doc.slice();
    edited[at] = edited[at] === 0x61 ? 0x62 : 0x61;
    expect((await hunt1ProtocolProblems(edited)).join()).toMatch(/no longer begins with its pinned text/);
    expect((await hunt1ProtocolProblems(enc(`${text.slice(0, 100)}X${text.slice(100)}`))).join()).toMatch(/no longer begins with its pinned text/);
    expect((await hunt1ProtocolProblems(doc.slice(0, HUNT1_PROTOCOL.bytes - 1))).join()).toMatch(/fewer than the 38736 it had when pinned/);
    expect((await hunt1ProtocolProblems(new Uint8Array(0))).join()).toMatch(/fewer than/);
  });
});

// ---------------------------------------------------------------------------------------------
// Sources: protocol v1's main runs

describe("protocol v1's main-run source (G2)", () => {
  const mut = pondConfig(8, 0).mutRate;
  const origin = (arm: "scaf" | "rand", i: number, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}, done: Record<string, unknown> = {}) => ({
    source: `runs/scaffold/main/${arm}/i${i}/ckpt/b100-pre.blck.gz`,
    stateHash: "0123456789abcdef",
    seed: hunt1V1WorldSeed(arm, i),
    mutRate: mut,
    step: 1_000_000,
    tilesX: 8,
    tilesY: 8,
    run: {
      meta: { arm, k: 8, period: 10_000, cycles: 100, side: 8, seed: hunt1V1WorldSeed(arm, i), mutRate: mut, init: "clone", censusEvery: 100, protocolSha256: HUNT1_V1_PROTOCOL_SHA256, ...meta },
      done: { ok: true, conservationOk: true, cycles: 100, ended: false, ...done },
    },
    ...over,
  });

  it("accepts scaf and rand i0-i5 as the main runs recorded them", () => {
    for (const arm of ["scaf", "rand"] as const) for (let i = 0; i < 6; i++) expect(hunt1V1SourceProblems(arm, i, origin(arm, i))).toEqual([]);
    expect(hunt1V1SourceProblems("scaf", 2, JSON.parse(JSON.stringify(origin("scaf", 2))))).toEqual([]);
    expect(hunt1V1SourceProblems("scaf", 2, origin("scaf", 2, { source: "/home/x/browser-life/runs/scaffold/main/scaf/i2/ckpt/b100-pre.blck.gz" }))).toEqual([]);
  });

  it("refuses every way the checkpoint or its run can be wrong", () => {
    const why = (o: unknown, arm: "scaf" | "rand" = "scaf", i = 3) => hunt1V1SourceProblems(arm, i, o).join(" | ");
    expect(why(origin("scaf", 3, { seed: 4_810_005 }))).toMatch(/source seed 4810005, want 4810004/);
    expect(why(origin("scaf", 3, { step: 340_000 }))).toMatch(/source step 340000, want 1000000/);
    expect(why(origin("scaf", 3, { mutRate: 0 }))).toMatch(/source mutRate 0, want 429497/);
    expect(why(origin("scaf", 3, { tilesX: 2, tilesY: 2 }))).toMatch(/source has 2 x 2 ponds, want 8 x 8/);
    // a path that is not the main run's b100-pre: another boundary, the post-cycle state, another history or arm, the replication's tree, a bare name
    for (const source of ["runs/scaffold/main/scaf/i3/ckpt/b34-pre.blck.gz", "runs/scaffold/main/scaf/i3/ckpt/b100-post.blck.gz", "runs/scaffold/main/scaf/i2/ckpt/b100-pre.blck.gz", "runs/scaffold/main/rand/i3/ckpt/b100-pre.blck.gz", "runs/scaffold/r3rep/main/scaf/i3/ckpt/b100-pre.blck.gz", "runs/scaffold/main/scaf/i3/ckpt/b100-pre.blck", "b100-pre.blck.gz", "runs/scaffold/main/cont/i3/ckpt/b100-pre.blck.gz"]) {
      expect(why(origin("scaf", 3, { source })), source).toMatch(/does not end in scaffold\/main\/scaf\/i3\/ckpt\/b100-pre\.blck\.gz/);
    }
    expect(why(origin("scaf", 3, {}, { arm: "rand" }))).toMatch(/run meta.json arm "rand", want "scaf"/);
    expect(why(origin("scaf", 3, {}, { seed: 4_810_004 + 100 }))).toMatch(/run meta.json seed/);
    expect(why(origin("scaf", 3, {}, { k: 5 }))).toMatch(/run meta.json k 5, want 8/);
    expect(why(origin("scaf", 3, {}, { period: 3000 }))).toMatch(/run meta.json period 3000, want 10000/);
    expect(why(origin("scaf", 3, {}, { cycles: 15 }))).toMatch(/run meta.json cycles 15, want 100/);
    expect(why(origin("scaf", 3, {}, { side: 4 }))).toMatch(/run meta.json side 4, want 8/);
    expect(why(origin("scaf", 3, {}, { init: "founders" }))).toMatch(/run meta.json init "founders", want "clone"/);
    expect(why(origin("scaf", 3, {}, { mutRate: 0 }))).toMatch(/run meta.json mutRate 0/);
    expect(why(origin("scaf", 3, {}, { censusEvery: 1000 }))).toMatch(/run meta.json censusEvery 1000, want 100/);
    expect(why(origin("scaf", 3, {}, { protocolSha256: "0".repeat(64) }))).toMatch(/run meta.json protocolSha256/);
    expect(why(origin("scaf", 3, { run: { meta: null, done: { ok: true } } }))).toMatch(/not inside a run directory with a readable meta.json/);
    expect(why(origin("scaf", 3, { run: { meta: origin("scaf", 3).run.meta, done: null } }))).toMatch(/no readable done.json/);
    expect(why(origin("scaf", 3, {}, {}, { ok: false }))).toMatch(/run done.json ok false, want true/);
    expect(why(origin("scaf", 3, {}, {}, { conservationOk: false }))).toMatch(/run done.json conservationOk false, want true/);
    expect(why(origin("scaf", 3, {}, {}, { conservationOk: undefined }))).toMatch(/conservationOk undefined/);
    expect(why(origin("scaf", 3, {}, {}, { cycles: 99 }))).toMatch(/run done.json cycles 99, want 100/);
    expect(why(origin("scaf", 3, {}, {}, { ended: true }))).toMatch(/the history ended/);
    expect(why(null)).toMatch(/no source record/);
    expect(why({ source: "x" })).toMatch(/has no state hash/);
  });
});

// ---------------------------------------------------------------------------------------------
// Sources: runner bundles (a tiny bundle, ponds-small, written as tools/run.ts writes one)

describe("runner-bundle sources (D3 and Stage 1)", () => {
  const small = PRESETS.find((p) => p.id === "ponds-small")!;
  const smallIdentity = presetIdentity(small);
  const read = (p: string) => readFile(p).then((b) => new Uint8Array(b));
  const mut = pondConfig(2, 0).mutRate;
  const B = 3;
  /** `want` for a source on the small preset (2 x 2 ponds, period 1,000), read at boundary 3 (and a branch from boundary 1). */
  const wantOf = (source: Exclude<Hunt1Source, { kind: "v1" }>, death?: number): Hunt1BundleWant => {
    const w = hunt1BundleWant(source, death);
    return { ...w, presetId: "ponds-small", presetIdentity: smallIdentity, period: 1000, side: 2, boundary: B, mutRate: w.mutRate === 0 ? 0 : mut, branch: w.branch && { ...w.branch, boundary: 1 } };
  };
  const specOf = (w: Hunt1BundleWant, over: Partial<RunSpec> = {}): RunSpec => ({
    experiment: w.experiment ?? "hist",
    presetId: w.presetId,
    condition: w.condition,
    seed: w.seed,
    steps: 4000,
    censusEvery: 1000,
    deepEvery: 10,
    checkpointEvery: 0,
    ...(w.overrides ? { overrides: w.overrides } : {}),
    preCycleCheckpoints: [B],
    ...over,
  });

  /**
   * Writes the run bundle of `w` under `root` as the runner writes one: manifest.json (runId, spec, cfg, presetIdentity, ruleVersion, startStep,
   * preCycleCheckpoints, summary, finishedAt, and `branch` for a branch run) and checkpoints/b003-pre.blck. `state` changes the checkpointed state (and the
   * hash recorded for it), `edit` the manifest (and the directory) before it is written.
   */
  function writeBundle(dir: string, w: Hunt1BundleWant, o: { spec?: RunSpec; state?: (init: WorldState) => WorldState; edit?: (m: Record<string, unknown>, dir: string) => void; branch?: Record<string, unknown> | null } = {}): string {
    const spec = o.spec ?? specOf(w);
    const cfg = specConfig(spec);
    const init = initWorld(cfg, small.init);
    const at = join(dir, `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`);
    mkdirSync(join(at, "checkpoints"), { recursive: true });
    const state = o.state ? o.state(init) : { ...init, step: B * 1000 };
    const file = reg1PreCycleFileOf(B);
    writeFileSync(join(at, file), encodeCheckpoint(state, { ponds: { lastCycle: B - 1 } }));
    const branch = o.branch === undefined ? (w.branch ? { source: w.branch.sources?.[0] ?? "runs/x/b001-pre", sourceHash: "a".repeat(16), boundary: w.branch.boundary, postHash: "b".repeat(16) } : null) : o.branch;
    const m: Record<string, unknown> = {
      runId: `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`,
      spec,
      cfg,
      presetIdentity: smallIdentity,
      ruleVersion: RULE_VERSION,
      startStep: 0,
      startedAt: "2026-10-02T00:00:00.000Z",
      checkpoints: [],
      preCycleCheckpoints: [{ boundary: B, step: state.step, file, hash: stateHash(state) }],
      ...(branch !== null ? { branch } : {}),
      summary: { conservationOk: true, finalHash: "f".repeat(16) },
      finishedAt: "2026-10-02T01:00:00.000Z",
    };
    o.edit?.(m, at);
    writeFileSync(join(at, "manifest.json"), JSON.stringify(m, null, 2));
    return at;
  }

  const kinds: { name: string; source: Exclude<Hunt1Source, { kind: "v1" }> }[] = [
    { name: "D3 nat world", source: { kind: "d3", arm: "nat", j: 2 } },
    { name: "D3 shuf world", source: { kind: "d3", arm: "shuf", j: 0 } },
    { name: "nat-a history", source: { kind: "hist", arm: "nat-a", i: 5 } },
    { name: "shuf-a history", source: { kind: "hist", arm: "shuf-a", i: 23 } },
    { name: "nat-s history (a branch)", source: { kind: "hist", arm: "nat-s", i: 0 } },
    { name: "shuf-s history (a branch)", source: { kind: "hist", arm: "shuf-s", i: 11 } },
    { name: "ancestor world", source: { kind: "anc", j: 3 } },
    { name: "own scaffold-phase source", source: { kind: "src", i: 7 } },
  ];

  it("states what each source must be: seed, condition, overrides, boundary and branch", () => {
    expect(hunt1BundleWant({ kind: "d3", arm: "nat", j: 2 })).toMatchObject({ experiment: "d3", presetId: "ponds", presetIdentity: "56526b894cfccf3f", condition: "pond-nat", seed: 4_900_403, overrides: { mutRate: 0 }, boundary: 30, period: 10_000, side: 8, mutRate: 0, branch: null });
    expect(hunt1BundleWant({ kind: "d3", arm: "shuf", j: 3 })).toMatchObject({ condition: "pond-shuf", seed: 4_900_414 });
    expect(hunt1BundleWant({ kind: "hist", arm: "nat-a", i: 0 })).toMatchObject({ experiment: null, condition: "pond-nat", seed: 4_901_001, overrides: null, boundary: 200, mutRate: 429_497, branch: null });
    expect(hunt1BundleWant({ kind: "hist", arm: "shuf-a", i: 23 })).toMatchObject({ condition: "pond-shuf", seed: 4_901_124, branch: null });
    expect(hunt1BundleWant({ kind: "hist", arm: "nat-s", i: 1 })).toMatchObject({ condition: "pond-nat", seed: 4_901_202, boundary: 200, branch: { boundary: 100 } });
    expect(hunt1BundleWant({ kind: "hist", arm: "shuf-s", i: 23 })).toMatchObject({ condition: "pond-shuf", seed: 4_901_324, branch: { boundary: 100 } });
    expect(hunt1BundleWant({ kind: "anc", j: 1 })).toMatchObject({ condition: "pond-cont", seed: 4_901_401 + 1, overrides: null, boundary: 1, mutRate: 429_497, branch: null });
    expect(hunt1BundleWant({ kind: "src", i: 4 })).toMatchObject({ condition: "treatment", seed: 4_901_505, boundary: 100, overrides: null, branch: null });
    // G1's e = 1 fallback: D3's worlds and the histories override pondDeath too; the ancestor worlds and the sources run no cycle of the hunt's
    expect(hunt1BundleWant({ kind: "d3", arm: "nat", j: 0 }, HUNT1_DEATH.fallback).overrides).toEqual({ mutRate: 0, pondDeath: 65_536 });
    expect(hunt1BundleWant({ kind: "hist", arm: "shuf-s", i: 0 }, HUNT1_DEATH.fallback).overrides).toEqual({ pondDeath: 65_536 });
    expect(hunt1BundleWant({ kind: "anc", j: 0 }, HUNT1_DEATH.fallback).overrides).toBeNull();
    expect(hunt1BundleWant({ kind: "src", i: 0 }, HUNT1_DEATH.fallback).overrides).toBeNull();
    expect(() => hunt1BundleWant({ kind: "anc", j: 0 }, 1000)).toThrow(/pondDeath must be 32768 or 65536/);
    expect([{ kind: "d3", arm: "nat", j: 0 }, { kind: "hist", arm: "nat-a", i: 0 }, { kind: "anc", j: 0 }, { kind: "src", i: 0 }].map((s) => hunt1BoundaryOf(s as Hunt1Source & { kind: "d3" }))).toEqual([30, 200, 1, 100]);
    expect(HUNT1_HISTORY_ARMS).toEqual(["nat-a", "shuf-a", "nat-s", "shuf-s"]);
    expect(HUNT1_HISTORIES).toBe(24);
    expect(HUNT1_ANCESTOR_SEED_BASE).toBe(4_901_401);
    expect(HUNT1_G2_SEED_BASE).toBe(4_900_201);
  });

  it("loads each kind of source from its bundle by the hash its manifest records, and records the manifest's branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt1-bundle-"));
    try {
      for (const { name, source } of kinds) {
        const w = wantOf(source);
        const at = writeBundle(join(dir, name.replace(/\W+/g, "-")), w);
        const { state, record } = await loadHunt1Source(at, B, read, w);
        expect(state.step, name).toBe(B * 1000);
        expect(record).toMatchObject({ source: at, boundary: B, checkpoint: `${at}/checkpoints/b003-pre.blck`, stateHash: stateHash(state), seed: w.seed, mutRate: w.mutRate, step: B * 1000, tilesX: 2, tilesY: 2, sameConfig: true });
        expect(record.run).toMatchObject({ complete: true, conservationOk: true, ruleVersion: RULE_VERSION, presetIdentity: smallIdentity, preCycle: { boundary: B, step: 3000, file: "checkpoints/b003-pre.blck", hash: stateHash(state) } });
        expect(record.run.spec).toMatchObject({ seed: w.seed, condition: w.condition });
        expect(record.run.branch === null, name).toBe(w.branch === null);
        expect(hunt1BundleProblems(w, record), name).toEqual([]);
        expect(hunt1BundleProblems(w, JSON.parse(JSON.stringify(record))), `${name} as assay.json records it`).toEqual([]);
        expect(hunt1BundleProblems(w, (await loadHunt1Source(`${at}/`, B, read, w)).record), `${name} (a trailing slash)`).toEqual([]);
      }
      // D3 with mutation off: the state's own mutation rate is 0
      const d3Want = wantOf({ kind: "d3", arm: "nat", j: 0 });
      const d3 = await loadHunt1Source(writeBundle(join(dir, "d3-mut"), d3Want), B, read, d3Want);
      expect(d3.state.cfg.mutRate).toBe(0);
      expect(d3.record.run.spec?.overrides).toEqual({ mutRate: 0 });
      // the e = 1 fallback's bundles carry the pondDeath override, and are accepted only when it is expected
      const fb = wantOf({ kind: "hist", arm: "nat-a", i: 1 }, HUNT1_DEATH.fallback);
      const fbRecord = (await loadHunt1Source(writeBundle(join(dir, "fb"), fb), B, read, fb)).record;
      expect(fbRecord.run.spec?.overrides).toEqual({ pondDeath: 65_536 });
      expect(hunt1BundleProblems(fb, fbRecord)).toEqual([]);
      expect(hunt1BundleProblems(wantOf({ kind: "hist", arm: "nat-a", i: 1 }), fbRecord).join()).toMatch(/spec.overrides {"pondDeath":65536}, want none/);
      // a bundle without a manifest: the checkpoint loads under its conventional name, and the record says what is missing
      const bare = writeBundle(join(dir, "bare"), wantOf({ kind: "d3", arm: "shuf", j: 1 }), { edit: () => undefined });
      rmSync(join(bare, "manifest.json"));
      const orphan = hunt1BundleProblems(wantOf({ kind: "d3", arm: "shuf", j: 1 }), (await loadHunt1Source(bare, B, read, wantOf({ kind: "d3", arm: "shuf", j: 1 }))).record).join(" | ");
      expect(orphan).toMatch(/no readable manifest.json with a spec/);
      expect(orphan).toMatch(/run is incomplete/);
      await expect(loadHunt1Source(writeBundle(join(dir, "nofile"), wantOf({ kind: "anc", j: 0 })), 4, read, wantOf({ kind: "anc", j: 0 }))).rejects.toThrow(/b004-pre\.blck/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses every way a bundle can be wrong (D3 and Stage 1 alike)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt1-refuse-"));
    try {
      let n = 0;
      const problems = async (w: Hunt1BundleWant, o: Parameters<typeof writeBundle>[2] = {}, want: Hunt1BundleWant = w): Promise<string> => {
        const at = writeBundle(join(dir, `case${n++}`), w, o);
        return hunt1BundleProblems(want, (await loadHunt1Source(at, B, read, want)).record).join(" | ");
      };
      const d3 = wantOf({ kind: "d3", arm: "nat", j: 1 });
      const histA = wantOf({ kind: "hist", arm: "nat-a", i: 2 });
      const histS = wantOf({ kind: "hist", arm: "nat-s", i: 2 });
      // incomplete (not finished), or conservation broken
      for (const w of [d3, histA]) {
        expect(await problems(w, { edit: (m) => (delete m.summary, delete m.finishedAt) })).toBe("source run is incomplete: its manifest.json has no summary and finishedAt");
        expect(await problems(w, { edit: (m) => delete m.finishedAt })).toMatch(/run is incomplete/);
        expect(await problems(w, { edit: (m) => delete m.summary })).toMatch(/run is incomplete/);
        expect(await problems(w, { edit: (m) => (m.summary = { conservationOk: false }) })).toBe('source run summary.conservationOk false, want true');
        expect(await problems(w, { edit: (m) => (m.summary = {}) })).toMatch(/run summary.conservationOk undefined|null, want true/);
        expect(await problems(w, { edit: (m) => (m.ruleVersion = 2) })).toMatch(/run ruleVersion 2, want 1/);
        expect(await problems(w, { edit: (m) => (m.presetIdentity = "0".repeat(16)) })).toMatch(/run presetIdentity "0{16}"/);
        expect(await problems(w, { edit: (m) => delete m.presetIdentity })).toMatch(/run presetIdentity null/);
      }
      // a wrong seed or condition: the bundle of another world
      const seed = await problems({ ...d3, seed: d3.seed + 1 }, {}, d3);
      expect(seed).toMatch(/source seed 4900415|source seed \d+, want/);
      expect(seed).toMatch(/spec.seed \d+, want \d+/);
      expect(seed).toMatch(/directory .* is not d3\/ponds-small\/pond-nat\/seed-\d+/);
      expect(await problems({ ...d3, condition: "pond-shuf" }, {}, d3)).toMatch(/spec.condition "pond-shuf", want "pond-nat"/);
      expect(await problems({ ...histA, condition: "pond-shuf" }, {}, histA)).toMatch(/spec.condition "pond-shuf", want "pond-nat"/);
      expect(await problems({ ...histA, condition: "treatment" }, {}, histA)).toMatch(/spec.condition "treatment", want "pond-nat"/);
      expect(await problems(histA, { edit: (m) => ((m.spec as RunSpec).presetId = "ponds") })).toMatch(/spec.presetId "ponds", want "ponds-small"/);
      // D3 is its own experiment
      expect(await problems({ ...d3, experiment: "hist" }, {}, d3)).toMatch(/spec.experiment "hist", want "d3"/);
      // overrides: absent, wrong value, an extra key, or present where there are none
      expect(await problems(d3, { spec: specOf(d3, { overrides: undefined }) })).toMatch(/source spec.overrides null, want {"mutRate":0}/);
      expect(await problems(d3, { spec: specOf(d3, { overrides: { mutRate: 1 } }) })).toMatch(/source spec.overrides {"mutRate":1}, want {"mutRate":0}/);
      expect(await problems(d3, { spec: specOf(d3, { overrides: { mutRate: 0, pondDeath: 65_536 } }) }, d3)).toMatch(/source spec.overrides {"mutRate":0,"pondDeath":65536}, want {"mutRate":0}/);
      expect(await problems(d3, { spec: specOf(d3, { overrides: { pondDeath: 65_536 } }) })).toMatch(/spec.overrides/);
      expect(await problems(histA, { spec: specOf(histA, { overrides: { mutRate: 0 } }) })).toMatch(/source spec.overrides {"mutRate":0}, want none/);
      expect(await problems(histA, { spec: specOf(histA, { overrides: { pondDeath: 65_536 } }) })).toMatch(/spec.overrides {"pondDeath":65536}, want none/);
      expect(await problems(d3, { spec: { ...specOf(d3), soloFounder: 2 } as unknown as RunSpec })).toMatch(/spec sets soloFounder, which no hunt run does/);
      // the manifest is not the directory's: a run id that is not the spec's
      expect(await problems(d3, { edit: (m) => (m.runId = "other/ponds-small/pond-nat/seed-1") })).toMatch(/manifest runId "other\/ponds-small\/pond-nat\/seed-1" is not its spec's/);
      // the boundary: unlisted in the spec, unlisted in the manifest, or no file
      expect(await problems(d3, { spec: specOf(d3, { preCycleCheckpoints: [2] }) })).toMatch(/spec.preCycleCheckpoints \[2\] does not list boundary 3/);
      const unlisted = await problems(d3, { edit: (m) => (m.preCycleCheckpoints = []) });
      expect(unlisted).toMatch(/manifest lists no pre-cycle checkpoint at boundary 3/);
      expect(await problems(d3, { edit: (m) => ((m.preCycleCheckpoints as Record<string, unknown>[])[0].boundary = 2) })).toMatch(/manifest lists no pre-cycle checkpoint at boundary 3/);
      // a hash mismatch: the file is not the state the manifest recorded
      expect(await problems(d3, { edit: (m) => ((m.preCycleCheckpoints as Record<string, unknown>[])[0].hash = "0".repeat(16)) })).toMatch(/^source state hash [0-9a-f]{16}, but the manifest records "0{16}" for boundary 3$/);
      expect(await problems(histS, { edit: (m) => ((m.preCycleCheckpoints as Record<string, unknown>[])[0].hash = "0".repeat(16)) })).toMatch(/but the manifest records "0{16}"/);
      // the manifest's file must be the runner's name for the boundary
      const renamed = (m: Record<string, unknown>, d: string) => {
        renameSync(join(d, "checkpoints/b003-pre.blck"), join(d, "checkpoints/t000003000.blck"));
        (m.preCycleCheckpoints as Record<string, unknown>[])[0].file = "checkpoints/t000003000.blck";
      };
      expect(await problems(d3, { edit: renamed })).toMatch(/manifest pre-cycle file "checkpoints\/t000003000.blck", want "checkpoints\/b003-pre.blck"/);
      // a wrong step: the state, and the manifest's own entry
      const step = await problems(d3, { state: (init) => ({ ...init, step: 3100 }) });
      expect(step).toMatch(/source step 3100, want 3000/);
      expect(step).toMatch(/manifest pre-cycle step 3100, want 3000/);
      expect(await problems(d3, { edit: (m) => ((m.preCycleCheckpoints as Record<string, unknown>[])[0].step = 2000) })).toBe("source manifest pre-cycle step 2000, want 3000");
      // D3 mutation off: a state whose config is not the spec's (mutation on), and a spec without the override
      const rate = await problems(d3, { state: (init) => ({ ...init, cfg: { ...init.cfg, mutRate: mut }, step: 3000 }) });
      expect(rate).toMatch(/source mutRate 429497, want 0/);
      expect(rate).toMatch(/state's config is not its spec's/);
      // a branch run: the -s histories must record their branch (from boundary 1 on the small preset), the -a histories and every other source none
      expect(await problems(histS, { branch: null })).toMatch(/manifest records no branch, but it is a branch run from boundary 1/);
      expect(await problems(histS, { branch: { source: "x", sourceHash: "a".repeat(16), boundary: 2, postHash: "b".repeat(16) } })).toMatch(/branch.boundary 2, want 1/);
      expect(await problems(histS, { branch: { source: "x", boundary: 1, postHash: "b".repeat(16) } })).toMatch(/branch.sourceHash undefined is not a state hash/);
      expect(await problems(histS, { branch: { source: "x", sourceHash: "a".repeat(16), boundary: 1 } })).toMatch(/branch.postHash undefined is not a state hash/);
      expect(await problems(histS, { branch: "x" as unknown as Record<string, unknown> })).toMatch(/manifest records no branch/);
      expect(await problems(histA, { branch: { source: "x", sourceHash: "a".repeat(16), boundary: 1, postHash: "b".repeat(16) } })).toBe("source manifest records a branch, but it is not a branch run");
      expect(await problems(wantOf({ kind: "anc", j: 0 }), { branch: { source: "x", sourceHash: "a", boundary: 1, postHash: "b" } })).toMatch(/records a branch, but it is not a branch run/);
      // the wrong source for the set: a history's bundle read as a D3 world, an ancestor world as a history
      expect((await problems(histA, {}, d3)).length).toBeGreaterThan(0);
      expect(await problems(wantOf({ kind: "anc", j: 0 }), {}, histA)).toMatch(/source seed \d+, want 4901001|spec.condition "pond-cont", want "pond-nat"/);
      // a boundary the bundle was not read at
      const at = writeBundle(join(dir, `case${n++}`), d3);
      expect(hunt1BundleProblems({ ...d3, boundary: 4 }, (await loadHunt1Source(at, B, read, d3)).record).join(" | ")).toMatch(/source boundary 3, want 4/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires a -s history's branch.source to end in its source's directory, in either origin", async () => {
    // Source i's bundle: the registration's scaf history (or its census-100 rerun), or the hunt's own scaffold phase (condition treatment, seed 4,901,501 + i).
    expect(hunt1SourceDirsOf(5)).toEqual(["scaffold/reg1/hist/ponds/treatment/seed-4850006", "scaffold/reg1/hist-c100/ponds/treatment/seed-4850006", "ponds/treatment/seed-4901506"]);
    expect(hunt1SourceDirsOf(0)[0]).toBe("scaffold/reg1/hist/ponds/treatment/seed-4850001");
    expect(hunt1SourceDirsOf(23)[2]).toBe("ponds/treatment/seed-4901524");
    expect(hunt1BundleWant({ kind: "hist", arm: "nat-s", i: 5 }).branch).toEqual({ boundary: 100, sources: hunt1SourceDirsOf(5) });
    expect(hunt1BundleWant({ kind: "hist", arm: "shuf-s", i: 5 }).branch).toEqual({ boundary: 100, sources: hunt1SourceDirsOf(5) });
    expect(hunt1BundleWant({ kind: "hist", arm: "nat-a", i: 5 }).branch).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "hunt1-branchsrc-"));
    try {
      let n = 0;
      const histS = wantOf({ kind: "hist", arm: "nat-s", i: 5 });
      const problems = async (source: unknown) => {
        const at = writeBundle(join(dir, `case${n++}`), histS, { branch: source === undefined ? { sourceHash: "a".repeat(16), boundary: 1, postHash: "b".repeat(16) } : { source, sourceHash: "a".repeat(16), boundary: 1, postHash: "b".repeat(16) } });
        return hunt1BundleProblems(histS, (await loadHunt1Source(at, B, read, histS)).record);
      };
      for (const good of ["/data/runs/scaffold/reg1/hist/ponds/treatment/seed-4850006", "runs/scaffold/reg1/hist/ponds/treatment/seed-4850006/", "/data/runs/scaffold/reg1/hist-c100/ponds/treatment/seed-4850006", "/data/runs/scaffold/hunt1/scaf/ponds/treatment/seed-4901506", "ponds/treatment/seed-4901506"]) {
        expect(await problems(good), good).toEqual([]);
      }
      // another index, the other arm's or condition's bundle, a ponds-small copy, a file in the bundle, a hash in place of a path, no path at all
      for (const bad of ["/data/runs/scaffold/reg1/hist/ponds/treatment/seed-4850007", "/data/runs/scaffold/hunt1/scaf/ponds/treatment/seed-4901507", "/data/runs/scaffold/reg1/hist/ponds/pond-rand/seed-4850106", "/data/runs/scaffold/reg1/hist/ponds/pond-cont/seed-4850206", "/data/runs/scaffold/reg1/hist/ponds/treatment/seed-4850006/checkpoints/b100-pre.blck", "/data/runs/scaffold/reg1/hist/ponds/treatment/seed-48500061", "runs/x/b001-pre", "", 7, null, undefined]) {
        const why = await problems(bad);
        expect(why.length, String(bad)).toBeGreaterThan(0);
        expect(why.join(" | "), String(bad)).toMatch(/source branch\.source .* does not end in its source's directory \(scaffold\/reg1\/hist\/ponds\/treatment\/seed-4850006 or scaffold\/reg1\/hist-c100\/ponds\/treatment\/seed-4850006 or ponds\/treatment\/seed-4901506\)/);
      }
      // The -a histories and the other sources have no branch to check; a want without `sources` (a caller that does not care) checks the boundary and hashes only.
      expect(hunt1BundleProblems({ ...histS, branch: { boundary: 1 } }, (await loadHunt1Source(writeBundle(join(dir, `case${n++}`), histS, { branch: { source: "runs/x/b001-pre", sourceHash: "a".repeat(16), boundary: 1, postHash: "b".repeat(16) } }), B, read, histS)).record)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names a bundle's twin: the run and its overflow rerun at census 100, whichever it is given", () => {
    const want = (over: Partial<Hunt1BundleWant> = {}): Hunt1BundleWant => ({ ...hunt1BundleWant({ kind: "d3", arm: "nat", j: 2 }), ...over });
    const d3 = want();
    expect(hunt1BundleTailsOf(d3, "/r/hunt1/d3/ponds/pond-nat/seed-4900403")).toEqual(["d3/ponds/pond-nat/seed-4900403", "d3-c100/ponds/pond-nat/seed-4900403"]);
    expect(hunt1BundleTailsOf(d3, "/r/hunt1/d3-c100/ponds/pond-nat/seed-4900403/")).toEqual(["d3/ponds/pond-nat/seed-4900403", "d3-c100/ponds/pond-nat/seed-4900403"]);
    // D3's experiment is named: no other experiment, nor another seed, condition or preset, is its twin.
    for (const other of ["/r/hunt1/hist/ponds/pond-nat/seed-4900403", "/r/hunt1/d3-c200/ponds/pond-nat/seed-4900403", "/r/hunt1/d3/ponds/pond-shuf/seed-4900403", "/r/hunt1/d3/ponds/pond-nat/seed-4900404", "/r/hunt1/d3/ponds-small/pond-nat/seed-4900403", "d3-c100", "/ponds/pond-nat/seed-4900403"]) expect(hunt1BundleTailsOf(d3, other), other).toBeNull();
    // A history's experiment is free (the queue names it): the directory's own, with and without its rerun suffix.
    const hist = hunt1BundleWant({ kind: "hist", arm: "shuf-a", i: 4 });
    expect(hunt1BundleTailsOf(hist, "runs/scaffold/hunt1/hist/ponds/pond-shuf/seed-4901105")).toEqual(["hist/ponds/pond-shuf/seed-4901105", "hist-c100/ponds/pond-shuf/seed-4901105"]);
    expect(hunt1BundleTailsOf(hist, "runs/scaffold/hunt1/hist-c100/ponds/pond-shuf/seed-4901105")).toEqual(["hist/ponds/pond-shuf/seed-4901105", "hist-c100/ponds/pond-shuf/seed-4901105"]);
    expect(hunt1BundleTailsOf(hist, "hist/ponds/pond-shuf/seed-4901105")).toEqual(["hist/ponds/pond-shuf/seed-4901105", "hist-c100/ponds/pond-shuf/seed-4901105"]);
    expect(hunt1BundleTailsOf(hist, "ponds/pond-shuf/seed-4901105")).toBeNull();
    expect(hunt1BundleTailsOf(hist, "-c100/ponds/pond-shuf/seed-4901105")).toBeNull();
    // The ancestor worlds and the hunt's own scaffold sources pair the same way.
    expect(hunt1BundleTailsOf(hunt1BundleWant({ kind: "anc", j: 1 }), "r/anc/ponds/pond-cont/seed-4901402")).toEqual(["anc/ponds/pond-cont/seed-4901402", "anc-c100/ponds/pond-cont/seed-4901402"]);
    expect(hunt1BundleTailsOf(hunt1BundleWant({ kind: "src", i: 3 }), "r/scaf/ponds/treatment/seed-4901504")).toEqual(["scaf/ponds/treatment/seed-4901504", "scaf-c100/ponds/treatment/seed-4901504"]);
  });

  it("takes the single complete bundle among <experiment> and <experiment>-c100, and refuses a source for which both are complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt1-c100-"));
    try {
      let n = 0;
      const incomplete = (m: Record<string, unknown>) => (delete m.summary, delete m.finishedAt);
      const d3 = wantOf({ kind: "d3", arm: "nat", j: 1 });
      const rerunOf = (w: Hunt1BundleWant) => ({ ...w, experiment: w.experiment === null ? "hist-c100" : `${w.experiment}-c100` });
      /** Writes the run (`first`: its manifest edit) and its rerun (`second`) side by side under one root; null leaves a bundle out. */
      const pair = (w: Hunt1BundleWant, first: ((m: Record<string, unknown>) => void) | null, second: ((m: Record<string, unknown>) => void) | null) => {
        const root = join(dir, `pair${n++}`);
        const normal = first === null ? null : writeBundle(root, w, { edit: first });
        const rerun = second === null ? null : writeBundle(root, rerunOf(w), { spec: specOf(w, { experiment: rerunOf(w).experiment! }), edit: second });
        return { normal, rerun, root };
      };
      const load = async (given: string, w: Hunt1BundleWant) => {
        const { state, record } = await loadHunt1Source(given, B, read, w);
        return { state, record, problems: hunt1BundleProblems(w, record), asJson: hunt1BundleProblems(w, JSON.parse(JSON.stringify(record))) };
      };
      // The census-1000 run overflowed (no summary: unfinished), its rerun d3-c100 finished: named by the normal directory, the source is the rerun.
      const a = pair(d3, incomplete, () => undefined);
      for (const given of [a.normal!, a.rerun!]) {
        const r = await load(given, d3);
        expect(r.record.source, given).toBe(a.rerun);
        expect(r.problems, given).toEqual([]);
        expect(r.asJson, given).toEqual([]);
        expect(r.record.candidates.map((c) => [c.dir.replace(`${a.root}/`, ""), c.complete])).toEqual([["d3/ponds-small/pond-nat/seed-4900402", false], ["d3-c100/ponds-small/pond-nat/seed-4900402", true]]);
        expect(r.record.run.spec?.experiment).toBe("d3-c100");
      }
      // Only the run finished and no rerun was made: the source is the run; the rerun is looked for, and absent.
      const b = pair(d3, () => undefined, null);
      const rb = await load(b.normal!, d3);
      expect(rb.record.source).toBe(b.normal);
      expect(rb.problems).toEqual([]);
      expect(rb.record.candidates.map((c) => c.manifest)).toEqual([true, false]);
      // Both finished: the source is ambiguous and refused, whichever directory it is named by.
      const c = pair(d3, () => undefined, () => undefined);
      for (const given of [c.normal!, c.rerun!]) expect((await load(given, d3)).problems.join(" | ")).toMatch(/^source is ambiguous: 2 complete runs of it \(.*d3\/ponds-small.*d3-c100\/ponds-small.*\), want one$/);
      // Neither finished: incomplete, as for a lone unfinished run.
      const d = pair(d3, incomplete, incomplete);
      expect((await load(d.normal!, d3)).problems.join(" | ")).toMatch(/source run is incomplete/);
      // A history's experiment is free: hist and hist-c100 (a -a and a -s history alike), the rerun named by its own directory.
      for (const source of [{ kind: "hist", arm: "nat-a", i: 3 }, { kind: "hist", arm: "shuf-s", i: 3 }, { kind: "anc", j: 2 }, { kind: "src", i: 3 }] as const) {
        const w = wantOf(source);
        const e = pair(w, incomplete, () => undefined);
        for (const given of [e.normal!, e.rerun!]) {
          const r = await load(given, w);
          expect(r.record.source, `${source.kind} ${given}`).toBe(e.rerun);
          expect(r.problems, `${source.kind} ${given}`).toEqual([]);
        }
        const f = pair(w, () => undefined, () => undefined);
        expect((await load(f.normal!, w)).problems.join(" | "), source.kind).toMatch(/is ambiguous: 2 complete runs/);
      }
      // D3's rerun is spec.experiment d3-c100 and no other: a bundle of another experiment under the d3 name, or an unnamed rerun, is refused.
      const g = pair(d3, incomplete, (m) => ((m.spec as RunSpec).experiment = "d3-c200"));
      expect((await load(g.normal!, d3)).problems.join(" | ")).toMatch(/spec\.experiment "d3-c200", want "d3" or "d3-c100"/);
      const h = pair(d3, () => undefined, null);
      expect((await loadHunt1Source(h.normal!, B, read)).record.candidates).toHaveLength(1);
      // A record made without looking at the rerun (a loader that was not given `want`) is refused: the rerun must have been in view.
      expect(hunt1BundleProblems(d3, (await loadHunt1Source(h.normal!, B, read)).record).join(" | ")).toMatch(/source was not chosen with d3-c100\/ponds-small\/pond-nat\/seed-4900402 in view/);
      expect(hunt1BundleProblems(d3, { ...(await loadHunt1Source(h.normal!, B, read, d3)).record, candidates: undefined }).join(" | ")).toMatch(/source records no candidate bundles/);
      // The directory must be D3's or its rerun's.
      const wrong = writeBundle(join(dir, "wrong"), { ...d3, experiment: "hist" });
      expect((await load(wrong, d3)).problems.join(" | ")).toMatch(/directory .* is not d3\/ponds-small\/pond-nat\/seed-4900402 or its -c100 rerun/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The assay and the report define the same sets, seeds and sources (tools/lib/hunt-stats.ts reads what this module writes)

describe("the assay and the report agree", () => {
  it("name the same 295 sets with the same stage, variant, h, replicates and seeds", () => {
    const report = [...huntExpectedSets("g2"), ...huntExpectedSets("d3"), ...huntExpectedSets("s1")];
    const assay = hunt1ExpectedSets();
    expect(report).toHaveLength(295);
    expect(assay.map((s) => s.labels.set).sort()).toEqual(report.map((s) => s.id).sort());
    const byId = new Map(report.map((r) => [r.id, r]));
    for (const a of assay) {
      const r = byId.get(a.labels.set)!;
      expect([r.stage, r.kind, r.labelH, r.replicates], a.labels.set).toEqual([a.labels.stage, a.labels.variant, a.labels.h, a.replicates]);
      expect(r.seeds.map((x) => x.physics), a.labels.set).toEqual(Array.from({ length: a.replicates }, (_, k) => hunt1SeedOf(a.labels, k)));
      expect(r.seeds.every((x) => x.physics === x.fragment), a.labels.set).toBe(true);
    }
  });

  it("compute the same W, edge share and family count from the same fragments", () => {
    // A deterministic stand-in for random rows: m families (1-64) over 256 fragments, X_f below the trait.
    let x = 12_345;
    const next = (n: number) => ((x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0) % n);
    for (let t = 0; t < 200; t++) {
      const m = 1 + next(64);
      const families = Array.from({ length: 64 }, (_, i) => i).sort(() => next(3) - 1).slice(0, m).sort((a, b) => a - b);
      const rows: Hunt1Row[] = [];
      for (let s = 0; s < 4; s++) for (let f = 0; f < 64; f++) { const endTrait = next(100_000); rows.push({ replicate: s, pond: f, family: familyOf(families, s, f), endTrait, exportMass: next(endTrait + 1) }); }
      const a = hunt1Summary(rows, families, families.map(() => 1 + next(1000)));
      const b = huntWOf(rows.map((r) => ({ ...r, assay: "export", inoculum: "fragment", retMass: 0, retE: 0, success: 0 })));
      expect([a.W, a.edgeShare, a.families, a.fragments]).toEqual([b.W, b.edgeShare, b.families, b.fragments]);
    }
  });

  it("agree on a set's format: what the assay writes for G2 passes the report's strict screen, quenched and no-family records included", () => {
    const mut = pondConfig(8, 0).mutRate;
    const v1 = (arm: "scaf" | "rand", i: number) => ({ source: `/data/runs/scaffold/main/${arm}/i${i}/ckpt/b100-pre.blck.gz`, stateHash: "0123456789abcdef", seed: hunt1V1WorldSeed(arm, i), mutRate: mut, step: 1_000_000, tilesX: 8, tilesY: 8, run: { meta: {}, done: {} } });
    const written = (id: string, o: { families: number[]; quench?: boolean; record?: boolean }) => {
      const set = parseHunt1Set("g2", id);
      const runs = set.replicates;
      const seeds = Array.from({ length: runs }, (_, s) => ({ physics: hunt1SeedOf(set.labels, s), fragment: hunt1SeedOf(set.labels, s) }));
      const planted = { reqMass: 6000, retMass: 5000, reqE: 40, retE: 30, landed: 60, truncated: false };
      const lines = [HUNT1_COLUMNS.join("\t")];
      const rows: Hunt1Row[] = [];
      for (let s = 0; !o.record && s < runs; s++) {
        for (let f = 0; f < 64; f++) {
          const family = familyOf(o.families, s, f);
          const endTrait = 5_000 + 7 * f;
          const exportMass = o.quench ? 0 : (31 * f) % 4_000;
          lines.push(hunt1Line({ set: id, replicate: s, pond: f, family, inoculum: set.inoculum, planted, endTrait, success: assaySuccess(endTrait, 5_000, 103_058), exportMass }));
          rows.push({ replicate: s, pond: f, family, endTrait, exportMass });
        }
      }
      const arm = id.startsWith("g2-scaf") ? "scaf" : "rand";
      const index = Number(/-i(\d)/.exec(id)![1]);
      const record = o.record ? hunt1NoRows("noFamilies", 0) : null;
      const json = hunt1AssayJson({ protocolSha256: "p", set: id, source: `src-${id}`, labels: set.labels, inoculum: set.inoculum, k: 8, period: 10_000, ref: 103_058, side: 8, replicates: runs, censusEvery: 100, threshold: 28, seeds, extra: { provenance: v1(arm, index), protocolSha256Hunt1: HUNT1_SHA256, ...(record?.flags ?? {}) }, summary: record?.summary ?? hunt1Summary(rows, o.families, o.families.map(() => 1_000)), wallSeconds: 3 });
      const [head, ...body] = (record?.tsv ?? lines.join("\n") + "\n").trim().split("\n");
      const cols = head.split("\t");
      return { dir: `/sets/${id}`, json: JSON.parse(JSON.stringify(json)) as Record<string, unknown>, rows: body.map((l) => huntFragmentRow(Object.fromEntries(l.split("\t").map((v, q) => [cols[q], v])))) };
    };
    const dirs = [written("g2-scaf-i2", { families: [1, 4, 9] }), written("g2-rand-i5", { families: Array.from({ length: 64 }, (_, i) => i) }), written("g2-scaf-i2-quench", { families: [1, 4, 9], quench: true }), written("g2-scaf-i0", { families: [], record: true })];
    const r = huntScreenSets(dirs, { stage: "g2", sha: HUNT_REPORT_PROTOCOL.sha256 });
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((a) => a.id)).toEqual(["g2-scaf-i2", "g2-rand-i5", "g2-scaf-i2-quench", "g2-scaf-i0"]);
    expect(r.accepted[0].w.families).toBe(3);
    expect(r.accepted[3]).toMatchObject({ noFamilies: true, rows: [] });
    expect(HUNT_REPORT_PROTOCOL.sha256).toBe(HUNT1_SHA256);
    // The waiver the tool records under --allow-any-seed is what the strict screen refuses.
    expect(huntScreenSets([{ ...dirs[0], json: { ...dirs[0].json, allowAnySeed: true } }], { stage: "g2", sha: HUNT1_SHA256 }).rejected[0].reasons[0]).toMatch(/allowAnySeed true/);
  });

  it("read the same sources: protocol v1's seeds, the registration's and the hunt's own, and the directories a -s source may have", () => {
    expect(HUNT_SEEDS.v1).toBe(HUNT1_V1_SEED_BASE);
    expect(HUNT_SEEDS.ownScaffold).toBe(HUNT1_OWN_SCAFFOLD_SEED_BASE);
    for (const arm of ["scaf", "rand"] as const) {
      for (let i = 0; i < 6; i++) {
        const source = `runs/scaffold/main/${arm}/i${i}/ckpt/b100-pre.blck.gz`;
        expect(huntV1SourceProblems(arm, i, { source, seed: hunt1V1WorldSeed(arm, i), step: 1_000_000 }), `${arm} i${i}`).toEqual([]);
        expect(huntV1SourceProblems(arm, i, { source, seed: hunt1V1WorldSeed(arm, i) + 1, step: 1_000_000 }).join()).toMatch(/provenance\.seed/);
      }
    }
    for (let i = 0; i < 24; i++) {
      // Every directory the assay accepts for -s source i is an origin the report classifies for i, and for no other index.
      const tails = hunt1SourceDirsOf(i);
      expect(tails.map((t) => huntSourceOriginOf(`/data/runs/${t}`, i))).toEqual(["registration", "registration", "own"]);
      for (const t of tails) expect(huntSourceOriginOf(`/data/runs/${t}`, (i + 1) % 24)).toBeNull();
      expect(hunt1OwnScaffoldSeed(i)).toBe(HUNT_SEEDS.ownScaffold + i);
    }
  });
});
