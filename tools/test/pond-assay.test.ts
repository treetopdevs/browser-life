import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_WORDS,
  buildWorld,
  cellCount,
  encodeGenome,
  founderGenome,
  stateHash,
  validateState,
  worldW,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO } from "@bl/sim-ref";
import { applyPondCycle, assaySeed, cloneWorld, dominantGenome, pondConfig, pondMatter, pondTraits, randomKey } from "../lib/ponds.ts";
import { assayLabels } from "../lib/scaffold-stats.ts";
import {
  ASSAY_COLUMNS,
  M_ASSAY,
  R1DP_REGIME,
  R1DP_SEED_BASE,
  R1DP_SEED_MAX,
  R1DP_SETS,
  R1_PRIME_SEED_MAX,
  R3REP_ANCESTOR_H,
  R3REP_CONTINUE_STEPS,
  R3REP_PROTOCOLS,
  R3REP_REGIME,
  R3REP_SEED_BASE,
  R3REP_SEED_MAX,
  R3REP_SHA256,
  R3REP_SWAP_AE_WORDS,
  TAU_LABELS,
  TAU_SEED_BASE,
  TRAIT_COLUMNS,
  assayJson,
  assayLine,
  assaySuccess,
  buildAssayWorld,
  censusSteps,
  checkAssaySeeds,
  checkR1PrimeDonorSeed,
  checkR1PrimeSeeds,
  checkR1dPrimeDonorSeed,
  checkR1dPrimeSeeds,
  checkR3RepSeeds,
  checkTauSeeds,
  distinctGenomes,
  fragmentDominant,
  parseR1PrimeLabels,
  parseR1dPrimeLabels,
  parseR3RepContinueLabels,
  parseR3RepLabels,
  postCycleOf,
  quench,
  r1Donors,
  r1PrimeDonorSeedOf,
  r1PrimeSeed,
  r1dPrimeCheckpointOf,
  r1dPrimeDonorSeedOf,
  r1dPrimeIdOf,
  r1dPrimeLabelsOf,
  r1dPrimePhase,
  r1dPrimeProvenance,
  r1dPrimeSeed,
  r1dPrimeSourceProblems,
  r3RepBoundaryOf,
  r3RepCheckpointOf,
  r3RepContinuationOf,
  r3RepContinuationPathOf,
  r3RepContinuationProblems,
  r3RepContinueProblems,
  r3RepContinueSeed,
  r3RepDominantRecord,
  r3RepExpectedSets,
  r3RepHistoryOf,
  r3RepIdOf,
  r3RepLabelsFromJson,
  r3RepLabelsOf,
  r3RepOriginProblems,
  r3RepProtocolProblems,
  r3RepProvenanceProblems,
  r3RepRegimeProblems,
  r3RepRunDirOf,
  r3RepRunRecordOf,
  r3RepSeed,
  r3RepSeedHOf,
  r3RepSeedOf,
  r3RepSetIdOf,
  r3RepSidecarPathOf,
  r3RepTreatmentProblems,
  r3RepUnavailableOf,
  r3RepUnavailableProblems,
  r3RepVariantProblems,
  r3RepWorldSeedOf,
  standardFragment,
  swapGenome,
  traitsTable,
  type AssayItem,
  type Fragment,
  type R3RepCheckpoint,
  type R3RepOrigin,
} from "../lib/pond-assay.ts";

const genomeA = founderGenome(M3_FOUNDERS[2]);
const genomeB = founderGenome(M3_FOUNDERS[5]);

/** An empty world (nutrient only) of side x side ponds, mutation off. */
function emptyWorld(side: number, seed = 7): WorldState {
  return buildWorld(pondConfig(side, seed, 0), { nutrient: 32, founders: [] });
}

const cellIdx = (s: WorldState, pond: number, x: number, y: number) => {
  const cfg = s.cfg;
  const tx = pond % cfg.tilesX;
  const ty = Math.floor(pond / cfg.tilesX);
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
};

/** Sets B (and E) of a cell of a crafted source to lineage `lin` of genome A or B. */
function plant(s: WorldState, pond: number, x: number, y: number, B: number, lin: number, E = 0, genome = genomeA): void {
  const n = cellCount(s.cfg);
  const i = cellIdx(s, pond, x, y);
  s.cells[CH.B * n + i] = B;
  s.cells[CH.E * n + i] = E;
  const w = encodeGenome(genome, 0, lin);
  for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = w[g];
}

/** A source of side x side ponds where pond p holds a blob of lineage p+1 (B 64, E 128) around (30..34, 30..34). */
function blobSource(side: number, only?: number[]): WorldState {
  const s = emptyWorld(side);
  for (let p = 0; p < side * side; p++) {
    if (only && !only.includes(p)) continue;
    for (let y = 30; y <= 34; y++) for (let x = 30; x <= 34; x++) plant(s, p, x, y, 64 + ((x + y + p) % 7), p + 1, 128, p % 2 ? genomeB : genomeA);
  }
  return s;
}

/** Pond 0 of a 2x2 source holds B 100 in every cell (409,600: far above M_ASSAY); the others hold a blob. */
function denseSource(): WorldState {
  const s = blobSource(2);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) plant(s, 0, x, y, 100, 1, 3);
  return s;
}

const strip = (f: Fragment) => f.cells.map((c) => [c.x, c.y, c.B, c.P, c.MOT]);

describe("standardFragment", () => {
  it("is deterministic and depends on sigma and f", () => {
    const s = blobSource(3);
    const a = standardFragment(s, 8, 4_820_001, 3)!;
    const b = standardFragment(s, 8, 4_820_001, 3)!;
    expect(b).toEqual(a);
    const seen = new Set<string>();
    for (let f = 0; f < 12; f++) {
      const x = standardFragment(s, 8, 4_820_001, f)!;
      seen.add(`${x.pond}:${x.cx}:${x.cy}`);
    }
    expect(seen.size).toBeGreaterThan(3);
    const other = standardFragment(s, 8, 4_820_002, 3)!;
    expect([other.pond, other.cx, other.cy]).not.toEqual([a.pond, a.cx, a.cy]);
  });

  it("draws the source pond from the eligible ponds by purposes 5 and 6, and the window by the packet rule", () => {
    const s = blobSource(3, [2, 4, 7]);
    for (let f = 0; f < 20; f++) {
      const x = standardFragment(s, 5, 4_820_003, f)!;
      expect([2, 4, 7]).toContain(x.pond);
      const hi = randomKey(4_820_003, 0, f, 5), lo = randomKey(4_820_003, 0, f, 6);
      expect(x.pond).toBe([2, 4, 7][(((hi >>> 0) * 2_097_152 + (lo >>> 11)) % 3)]);
      // The centre is inside the blob (the only eligible cells), the window is 5x5 landing about (32, 32).
      expect(x.cx).toBeGreaterThanOrEqual(30);
      expect(x.cx).toBeLessThanOrEqual(34);
      expect(x.cells).toHaveLength(25);
      expect(x.cells[0]).toMatchObject({ x: 30, y: 30 });
      expect(x.cells[24]).toMatchObject({ x: 34, y: 34 });
    }
  });

  it("returns null for a source with no eligible pond, and for an ineligible donor", () => {
    const s = emptyWorld(2);
    expect(standardFragment(s, 5, 4_820_001, 0)).toBeNull();
    const t = blobSource(2, [1]);
    expect(standardFragment(t, 9, 4_820_001, 0, 0)).toBeNull();
    expect(standardFragment(t, 5, 4_820_001, 0, 1)!.pond).toBe(1);
  });

  it("truncates against M_ASSAY in reverse raster order and records requested and retained mass and E", () => {
    const s = denseSource();
    let x: Fragment | null = null;
    for (let f = 0; f < 40 && !x?.truncated; f++) {
      const c = standardFragment(s, 64, 4_820_001, f, 0)!;
      if (c.truncated) x = c;
    }
    expect(x).not.toBeNull();
    expect(x!.reqMass).toBe(409_600);
    expect(x!.reqE).toBe(3 * 4096);
    expect(x!.retMass).toBeLessThanOrEqual(M_ASSAY);
    expect(x!.retMass).toBe(x!.cells.reduce((a, c) => a + c.B + c.P, 0));
    expect(x!.retMass + 100).toBeGreaterThan(M_ASSAY);
    expect(x!.cells).toHaveLength(Math.floor(M_ASSAY / 100));
    expect(x!.retE).toBe(3 * x!.cells.length);
    // A 64x64 window lands at (0, 0): the kept cells are the raster prefix.
    expect(x!.cells[0]).toMatchObject({ x: 0, y: 0 });
    expect(x!.cells[63]).toMatchObject({ x: 63, y: 0 });
  });
});

describe("r1Donors", () => {
  it("takes the 16 eligible ponds with the smallest purpose-1 keys when at least 16 are eligible", () => {
    const s = blobSource(5);
    const sigma = 4_821_509;
    const { donors, eligible, insufficient } = r1Donors(s, sigma);
    expect(insufficient).toBe(false);
    expect(eligible).toBe(25);
    const want = Array.from({ length: 25 }, (_, pond) => ({ pond, key: randomKey(sigma, 0, pond, 1) }))
      .sort((a, b) => a.key - b.key || a.pond - b.pond)
      .slice(0, 16)
      .map((e) => e.pond);
    expect(donors).toEqual(want);
    expect(new Set(donors).size).toBe(16);
  });

  it("takes every eligible pond, in index order, when 2-15 are eligible", () => {
    const s = blobSource(5, [3, 11, 4, 20]);
    const r = r1Donors(s, 4_821_509);
    expect(r).toEqual({ donors: [3, 4, 11, 20], eligible: 4, insufficient: false });
    expect(r1Donors(blobSource(5, [0, 1]), 4_821_509).donors).toEqual([0, 1]);
    const fifteen = Array.from({ length: 15 }, (_, i) => i + 2);
    expect(r1Donors(blobSource(5, fifteen), 4_821_509).donors).toEqual(fifteen);
  });

  it("is insufficient with fewer than 2 eligible ponds", () => {
    expect(r1Donors(blobSource(3, [4]), 4_821_509)).toEqual({ donors: [], eligible: 1, insufficient: true });
    expect(r1Donors(emptyWorld(3), 4_821_509)).toEqual({ donors: [], eligible: 0, insufficient: true });
  });

  it("does not count dust below the support threshold as eligible", () => {
    const s = emptyWorld(3);
    plant(s, 0, 5, 5, 47, 1);
    plant(s, 1, 5, 5, 48, 2);
    expect(r1Donors(s, 4_821_509).insufficient).toBe(true);
  });
});

describe("quench and swapGenome", () => {
  const s = blobSource(2);
  const frag = standardFragment(s, 6, 4_820_007, 1)!;

  it("quench zeroes the 40 weight words and E and nothing else, without mutating the fragment", () => {
    const before = structuredClone(frag);
    const q = quench(frag);
    expect(frag).toEqual(before);
    expect(q.cells).toHaveLength(frag.cells.length);
    expect(q.reqE).toBe(0);
    expect(q.retE).toBe(0);
    expect(frag.retE).toBeGreaterThan(0);
    q.cells.forEach((c, i) => {
      const o = frag.cells[i];
      expect([c.x, c.y, c.B, c.P, c.MOT]).toEqual([o.x, o.y, o.B, o.P, o.MOT]);
      expect(c.E).toBe(0);
      for (let w = 0; w < GENOME_CHANNELS; w++) {
        if (w >= G.W0 && w < G.W0 + NN_WORDS) expect(c.genome[w]).toBe(0);
        else expect(c.genome[w]).toBe(o.genome[w]);
      }
    });
    expect(frag.cells.some((c) => c.genome[G.W0] !== 0 || c.genome[G.W0 + 5] !== 0)).toBe(true);
  });

  it("swap replaces all 44 words of every genome-carrying cell with one genome, keeping B, P, E and MOT", () => {
    const words = encodeGenome(genomeB, 0, 9);
    const w = swapGenome(frag, words);
    let carrying = 0;
    w.cells.forEach((c, i) => {
      const o = frag.cells[i];
      expect([c.x, c.y, c.B, c.P, c.E, c.MOT]).toEqual([o.x, o.y, o.B, o.P, o.E, o.MOT]);
      if (o.B + o.P > 0 || (o.genome[G.LIN_HI] | o.genome[G.LIN_LO]) !== 0) {
        expect(Array.from(c.genome)).toEqual(Array.from(words));
        carrying++;
      } else expect(Array.from(c.genome)).toEqual(Array.from(o.genome));
    });
    expect(carrying).toBeGreaterThan(0);
    expect(() => swapGenome(frag, new Uint32Array(GENOME_CHANNELS))).toThrow();
    expect(() => swapGenome(frag, new Uint32Array(3))).toThrow();
  });

  it("gives identical fragments for the same sigma across the fragment, quench and swap variants", () => {
    const words = encodeGenome(genomeB, 0, 9);
    for (let f = 0; f < 8; f++) {
      const a = standardFragment(s, 7, 4_820_009, f)!;
      const b = standardFragment(s, 7, 4_820_009, f)!;
      for (const v of [quench(b), swapGenome(b, words)]) {
        expect([v.pond, v.cx, v.cy, v.reqMass, v.retMass, v.truncated]).toEqual([a.pond, a.cx, a.cy, a.reqMass, a.retMass, a.truncated]);
        expect(strip(v)).toEqual(strip(a));
      }
    }
  });
});

describe("fragmentDominant", () => {
  it("picks the lineage with the most B+P, ties to the smallest id, and returns its words", () => {
    const s = emptyWorld(1);
    plant(s, 0, 30, 30, 10, 5);
    plant(s, 0, 31, 30, 6, 3, 0, genomeB);
    plant(s, 0, 32, 30, 4, 3, 0, genomeB);
    // No cell reaches 48, so the pond is ineligible and the fragment is absent.
    expect(standardFragment(s, 9, 4_820_001, 0)).toBeNull();
    plant(s, 0, 33, 30, 50, 8);
    const g = standardFragment(s, 9, 4_820_001, 0, 0)!;
    const d = fragmentDominant(g)!;
    expect([d.hi, d.lo]).toEqual([0, 8]);
    expect(Array.from(d.words)).toEqual(Array.from(encodeGenome(genomeA, 0, 8)));
    const t = emptyWorld(1);
    plant(t, 0, 30, 30, 60, 4);
    plant(t, 0, 31, 30, 30, 2, 0, genomeB);
    plant(t, 0, 32, 30, 30, 2, 0, genomeB);
    expect(fragmentDominant(standardFragment(t, 9, 4_820_001, 0, 0)!)!.lo).toBe(2);
    plant(t, 0, 33, 30, 60, 1);
    expect(fragmentDominant(standardFragment(t, 9, 4_820_001, 0, 0)!)!.lo).toBe(1);
    expect(fragmentDominant({ ...g, cells: [] })).toBeNull();
  });
});

describe("buildAssayWorld", () => {
  const cfg = pondConfig(2, 4_820_011, 0);
  const fragments = (s: WorldState, k: number, sigma: number): Fragment[] => Array.from({ length: 4 }, (_, f) => standardFragment(s, k, sigma, f)!);
  const items = (fs: Fragment[]): AssayItem[] => fs.map((fragment) => ({ kind: "fragment", fragment }));

  it("gives every pond exactly M_ASSAY matter, truncation included, and passes validateState", () => {
    const src = denseSource();
    const fs = [standardFragment(src, 64, 4_820_001, 0, 0)!, standardFragment(src, 64, 4_820_001, 1, 0)!, standardFragment(src, 9, 4_820_001, 2)!, standardFragment(src, 3, 4_820_001, 3)!];
    expect(fs[0].truncated).toBe(true);
    const { state, planted } = buildAssayWorld(cfg, items(fs));
    expect(validateState(state)).toEqual([]);
    expect(pondMatter(state)).toEqual([M_ASSAY, M_ASSAY, M_ASSAY, M_ASSAY]);
    expect(state.step).toBe(0);
    expect(state.heatOut).toBe(0n);
    expect(state.lightIn).toBe(0n);
    expect(state.flux.every((x) => x === 0n)).toBe(true);
    expect(planted[0].truncated).toBe(true);
    expect(planted[0].reqMass).toBe(409_600);
    expect(planted[0].retMass).toBe(fs[0].retMass);
    // No cell carries a C, S or waste; A holds the rest of the budget with a raster remainder.
    const n = cellCount(state.cfg);
    const A0 = Array.from({ length: 4096 }, (_, i) => state.cells[CH.A * n + cellIdx(state, 3, i % 64, Math.floor(i / 64))]);
    const rem = M_ASSAY - fs[3].retMass;
    expect(A0.reduce((a, x) => a + x, 0)).toBe(rem);
    expect(Math.max(...A0) - Math.min(...A0)).toBeLessThanOrEqual(1);
    expect(A0.slice(0, rem % 4096).every((x) => x === Math.floor(rem / 4096) + 1)).toBe(true);
    for (const ch of [CH.C, CH.S]) for (let i = 0; i < n; i++) expect(state.cells[ch * n + i]).toBe(0);
  });

  it("relabels every distinct genome to (0, k+1) in world raster order of first appearance", () => {
    const src = blobSource(2);
    const fs = fragments(src, 6, 4_820_013);
    const { state } = buildAssayWorld(cfg, items(fs));
    const n = cellCount(state.cfg);
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
      if ((hi | lo) === 0) continue;
      expect(hi).toBe(0);
      if (!seen.includes(String(lo))) seen.push(String(lo));
    }
    expect(seen).toEqual(seen.map((_, k) => String(k + 1)));
    // Source lineages of the four fragments are all distinct (p + 1), so four ids appear if every fragment landed.
    const origin = new Set(fs.map((f) => f.pond));
    expect(seen).toHaveLength(origin.size);
    // The first cell in raster order of the world holds id 1: pond 0's fragment starts at (30, 30).
    expect(state.genome[G.LIN_LO * n + cellIdx(state, 0, 29, 29)]).toBe(1);
  });

  it("gives a swapped or quenched fragment set the same layout as the plain one, with one fresh id per swap", () => {
    const src = blobSource(2);
    const fs = fragments(src, 6, 4_820_013);
    const plain = buildAssayWorld(cfg, items(fs)).state;
    const q = buildAssayWorld(cfg, items(fs.map(quench))).state;
    const sw = buildAssayWorld(cfg, items(fs.map((f) => swapGenome(f, encodeGenome(genomeB, 0, 77))))).state;
    const n = cellCount(plain.cfg);
    for (let i = 0; i < n; i++) {
      for (const s of [q, sw]) {
        expect(s.cells[CH.B * n + i]).toBe(plain.cells[CH.B * n + i]);
        expect(s.cells[CH.A * n + i]).toBe(plain.cells[CH.A * n + i]);
        expect(s.cells[CH.MOT * n + i]).toBe(plain.cells[CH.MOT * n + i]);
      }
      // Quench keeps the ids of the plain world; the swap world has one lineage.
      expect(q.genome[G.LIN_LO * n + i]).toBe(plain.genome[G.LIN_LO * n + i]);
      const lo = sw.genome[G.LIN_LO * n + i];
      if (lo !== 0) expect(lo).toBe(1);
      if (q.cells[CH.E * n + i] !== 0) throw new Error("quench left E");
    }
    expect(validateState(q)).toEqual([]);
    expect(validateState(sw)).toEqual([]);
  });

  it("plants a standard disc as cloneWorld does and matches its cells exactly", () => {
    const disc: AssayItem[] = [0, 1, 2, 3].map(() => ({ kind: "disc", genome: genomeA }));
    const { state, planted } = buildAssayWorld(cfg, disc);
    const clone = cloneWorld(cfg, genomeA);
    const n = cellCount(cfg);
    for (const ch of [CH.B, CH.P, CH.E, CH.MOT]) for (let i = 0; i < n; i++) expect(state.cells[ch * n + i]).toBe(clone.cells[ch * n + i]);
    expect(pondMatter(state)).toEqual([M_ASSAY, M_ASSAY, M_ASSAY, M_ASSAY]);
    expect(planted[0].truncated).toBe(false);
    let discMass = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) discMass += clone.cells[CH.B * n + cellIdx(clone, 0, x, y)] + clone.cells[CH.P * n + cellIdx(clone, 0, x, y)];
    expect(planted[0].retMass).toBe(discMass);
    expect(validateState(state)).toEqual([]);
    // Every pond's disc is genome A under its own relabelled id, in pond order.
    expect(state.genome[G.LIN_LO * n + cellIdx(state, 0, 32, 32)]).toBe(1);
    expect(state.genome[G.LIN_LO * n + cellIdx(state, 3, 32, 32)]).toBe(4);
  });

  it("leaves an absent item's pond holding only nutrient, and rejects a wrong item count", () => {
    const fs = fragments(blobSource(2), 5, 4_820_001);
    const { state } = buildAssayWorld(cfg, [{ kind: "fragment", fragment: fs[0] }, null, null, null]);
    expect(pondMatter(state)).toEqual([M_ASSAY, M_ASSAY, M_ASSAY, M_ASSAY]);
    expect(pondTraits(state)[1]).toBe(0);
    expect(() => buildAssayWorld(cfg, [null])).toThrow();
    expect(state.cells[CH.MOT * cellCount(cfg) + cellIdx(state, 1, 0, 0)]).toBe(MOT_ZERO);
  });

  it("is deterministic", () => {
    const fs = fragments(blobSource(2), 6, 4_820_013);
    const a = buildAssayWorld(cfg, items(fs)).state;
    const b = buildAssayWorld(cfg, items(fs)).state;
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(Array.from(b.genome)).toEqual(Array.from(a.genome));
  });

  it("rejects a fragment above the budget", () => {
    const fs = fragments(blobSource(2), 5, 4_820_001);
    expect(() => buildAssayWorld(cfg, items([{ ...fs[0], retMass: M_ASSAY + 1 }, fs[1], fs[2], fs[3]]))).toThrow();
  });
});

describe("assaySuccess", () => {
  it("applies the P1 rule: at least a quarter of ref and at least 4x the retained mass", () => {
    expect(assaySuccess(250, 10, 1000)).toBe(1);
    expect(assaySuccess(249, 10, 1000)).toBe(0);
    expect(assaySuccess(300, 100, 1000)).toBe(0);
    expect(assaySuccess(400, 100, 1000)).toBe(1);
    expect(assaySuccess(5, 0, undefined)).toBe(-1);
  });
});

describe("assayLine", () => {
  it("writes every ASSAY_COLUMNS field, with the requested and retained E and the truncation flag last", () => {
    expect(ASSAY_COLUMNS.slice(-3)).toEqual(["reqE", "retE", "truncated"]);
    const planted = { reqMass: 300, retMass: 250, reqE: 900, retE: 800, landed: 9, truncated: true };
    const cells = assayLine({ assay: "transmission", source: "s", replicate: 1, pond: 3, family: 7, inoculum: "fragment", planted, endTrait: 1234, success: 1 }).split("\t");
    expect(cells).toHaveLength(ASSAY_COLUMNS.length);
    expect(cells).toEqual(["transmission", "s", "1", "3", "7", "fragment", "300", "250", "1234", "1", "900", "800", "1"]);
    expect(assayLine({ assay: "a", source: "s", replicate: 0, pond: 0, family: -1, inoculum: "disc", planted: { ...planted, truncated: false }, endTrait: 0, success: -1 }).endsWith("\t900\t800\t0")).toBe(true);
  });
});

describe("traits.tsv writer", () => {
  it("lists the census steps of a period, the last chunk included", () => {
    expect(censusSteps(1000, 100)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(censusSteps(10_000, 100)).toHaveLength(100);
    expect(censusSteps(10_000, 100).at(0)).toBe(100);
    expect(censusSteps(10_000, 100).at(-1)).toBe(10_000);
    expect(censusSteps(250, 100)).toEqual([100, 200, 250]);
    expect(censusSteps(50, 100)).toEqual([50]);
    expect(() => censusSteps(0, 100)).toThrow();
    expect(() => censusSteps(100, 0)).toThrow();
  });

  it("writes the header, then every replicate's ponds in step order", () => {
    expect(TRAIT_COLUMNS).toEqual(["replicate", "pond", "step", "trait"]);
    const text = traitsTable([
      { replicate: 0, steps: [100, 200], traits: [[10, 20, 30], [11, 21, 31]] },
      { replicate: 1, steps: [100, 200], traits: [[40, 50, 60], [41, 51, 61]] },
    ]);
    const lines = text.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toEqual([
      "replicate\tpond\tstep\ttrait",
      "0\t0\t100\t10", "0\t0\t200\t11", "0\t1\t100\t20", "0\t1\t200\t21", "0\t2\t100\t30", "0\t2\t200\t31",
      "1\t0\t100\t40", "1\t0\t200\t41", "1\t1\t100\t50", "1\t1\t200\t51", "1\t2\t100\t60", "1\t2\t200\t61",
    ]);
  });

  it("writes only the header for no replicate (an insufficient set) and rejects a census count that is not the step count", () => {
    expect(traitsTable([])).toBe("replicate\tpond\tstep\ttrait\n");
    expect(traitsTable([{ replicate: 0, steps: [], traits: [] }])).toBe("replicate\tpond\tstep\ttrait\n");
    expect(() => traitsTable([{ replicate: 0, steps: [100, 200], traits: [[1]] }])).toThrow(/1 censuses for 2 steps/);
  });

  it("matches pondTraits: the census trait is B+P over cells with B+P >= 48", () => {
    // pondTraits is the one definition of the trait; the writer only formats what it is given.
    const s = blobSource(2);
    const traits = pondTraits(s);
    const rows = traitsTable([{ replicate: 0, steps: [100], traits: [traits] }]).trim().split("\n").slice(1);
    expect(rows.map((r) => Number(r.split("\t")[3]))).toEqual(traits);
  });
});

describe("R1' seeds (Amendment 2)", () => {
  it("is 4,845,001 + 250 h + 100 t' + s, ending at 4,847,960", () => {
    expect(r1PrimeSeed(0, 0, 0)).toBe(4_845_001);
    expect(r1PrimeSeed(1, 0, 0)).toBe(4_845_251);
    expect(r1PrimeSeed(0, 1, 0)).toBe(4_845_101);
    expect(r1PrimeSeed(0, 0, 9)).toBe(4_845_010);
    expect(r1PrimeSeed(7, 2, 8)).toBe(4_845_001 + 1750 + 200 + 8);
    expect(r1PrimeSeed(11, 2, 9)).toBe(4_847_960);
    expect(R1_PRIME_SEED_MAX).toBe(4_847_960);
  });

  it("range-checks every field", () => {
    for (const bad of [[12, 0, 0], [-1, 0, 0], [0, 3, 0], [0, -1, 0], [0, 0, 10], [0, 0, -1], [0.5, 0, 0], [0, 1.5, 0], [0, 0, NaN]] as const) expect(() => r1PrimeSeed(...bad)).toThrow(/r1PrimeSeed/);
  });

  it("cannot collide with assaySeed, itself, the tau calibration, P1, the calibration or the main run", () => {
    const prime = new Set<number>();
    for (let h = 0; h <= 11; h++) for (let t = 0; t <= 2; t++) for (let s = 0; s <= 9; s++) prime.add(r1PrimeSeed(h, t, s));
    expect(prime.size).toBe(12 * 3 * 10);
    const others = new Set<number>();
    let maxAssay = 0;
    for (let r = 0; r <= 4; r++) for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let v = 0; v <= 4; v++) for (let s = 0; s <= 9; s++) {
      const x = assaySeed(r, h, t, v, s);
      others.add(x);
      maxAssay = Math.max(maxAssay, x);
    }
    expect(maxAssay).toBe(4_844_690);
    expect(Math.min(...prime)).toBeGreaterThan(maxAssay);
    for (let s = 0; s <= 9; s++) others.add(TAU_SEED_BASE + s);
    for (let g = 0; g <= 14; g++) for (let s = 0; s <= 9; s++) others.add(4_800_001 + 100 * g + s);
    for (let x = 4_802_001; x <= 4_802_022; x++) others.add(x);
    for (let arm = 0; arm <= 2; arm++) for (let i = 0; i <= 5; i++) others.add(4_810_001 + 100 * arm + i);
    for (const x of prime) expect(others.has(x)).toBe(false);
    expect(Math.max(...prime)).toBeLessThan(TAU_SEED_BASE);
  });

  it("parses --arm, --history and --time as t', and refuses R1's flags", () => {
    expect(parseR1PrimeLabels({ arm: "scaf", history: "3", time: "2" })).toEqual({ arm: "scaf", history: 3, r1prime: true, timePrime: 2 });
    expect(parseR1PrimeLabels({ arm: "rand", history: "0", time: "0" })).toEqual({ arm: "rand", history: 0, r1prime: true, timePrime: 0 });
    expect(() => parseR1PrimeLabels({ arm: "cont", history: "0", time: "0" })).toThrow(/--arm/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", history: "6", time: "0" })).toThrow(/--history/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", time: "0" })).toThrow(/--history/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", history: "0", time: "3" })).toThrow(/--time/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", history: "0" })).toThrow(/--time/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", history: "0", time: "0", timing: "a" })).toThrow(/--timing/);
    expect(() => parseR1PrimeLabels({ arm: "scaf", history: "0", time: "0", calibration: "1" })).toThrow(/--calibration/);
  });

  it("checks each replicate's seeds and the donor seed against the labels", () => {
    const l = parseR1PrimeLabels({ arm: "rand", history: "2", time: "1" }); // h = 8, t' = 1
    const at = (s: number) => ({ physics: r1PrimeSeed(8, 1, s), fragment: r1PrimeSeed(8, 1, s) });
    expect(() => checkR1PrimeSeeds(l, at(0), 0)).not.toThrow();
    expect(() => checkR1PrimeSeeds(l, at(1), 1)).not.toThrow();
    expect(() => checkR1PrimeSeeds(l, at(0), 1)).toThrow(/want r1PrimeSeed\(h, t', 1\) = 4847102/);
    expect(() => checkR1PrimeSeeds(l, { physics: r1PrimeSeed(8, 1, 0), fragment: r1PrimeSeed(8, 1, 1) }, 0)).toThrow(/fragment seed/);
    expect(() => checkR1PrimeSeeds(l, { physics: r1PrimeSeed(8, 0, 0), fragment: r1PrimeSeed(8, 0, 0) }, 0)).toThrow(/does not match/); // another boundary
    expect(() => checkR1PrimeSeeds(l, { physics: r1PrimeSeed(2, 1, 0), fragment: r1PrimeSeed(2, 1, 0) }, 0)).toThrow(/does not match/); // the scaf history of that index
    expect(r1PrimeDonorSeedOf(l)).toBe(r1PrimeSeed(8, 1, 9));
    expect(() => checkR1PrimeDonorSeed(l, r1PrimeSeed(8, 1, 9))).not.toThrow();
    expect(() => checkR1PrimeDonorSeed(l, r1PrimeSeed(8, 1, 8))).toThrow(/donor seed/); // the permutation stream
    expect(() => checkR1PrimeDonorSeed(l, assaySeed(1, 8, 1, 0, 9))).toThrow(/donor seed/); // R1's donor seed
  });

  it("checks the tau calibration's seeds 4,849,001 + s, in checkAssaySeeds too", () => {
    expect(TAU_SEED_BASE).toBe(4_849_001);
    expect(() => checkTauSeeds({ physics: 4_849_001, fragment: 4_849_001 }, 0)).not.toThrow();
    expect(() => checkTauSeeds({ physics: 4_849_002, fragment: 4_849_002 }, 1)).not.toThrow();
    expect(() => checkTauSeeds({ physics: 4_849_001, fragment: 4_849_001 }, 1)).toThrow(/needs seed 4849002/);
    expect(() => checkTauSeeds({ physics: 4_849_001, fragment: 4_849_002 }, 0)).toThrow(/needs seed 4849001/);
    expect(() => checkAssaySeeds("competence", TAU_LABELS, "fragment", { physics: 4_849_002, fragment: 4_849_002 }, 1)).not.toThrow();
    expect(() => checkAssaySeeds("competence", TAU_LABELS, "fragment", { physics: 4_802_011, fragment: 4_802_011 }, 0)).toThrow(/tau calibration/);
  });

  it("writes the R1' and tau labels into assay.json, and leaves other assay.json keys alone", () => {
    const base = { protocolSha256: "0".repeat(64), assay: "transmission", source: "ckpt", tag: "t", k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 2, censusEvery: 100, inoculum: "fragment", seeds: [], extra: {}, summary: {}, wallSeconds: 1 };
    const prime = JSON.parse(JSON.stringify(assayJson({ ...base, labels: parseR1PrimeLabels({ arm: "scaf", history: "1", time: "0" }), extra: { traitsRecorded: true } })));
    expect(prime.labels).toEqual({ arm: "scaf", history: 1, r1prime: true, timePrime: 0 });
    expect(prime.traitsRecorded).toBe(true);
    const tau = JSON.parse(JSON.stringify(assayJson({ ...base, assay: "competence", labels: TAU_LABELS })));
    expect(tau.labels).toEqual({ arm: "ancestor", time: 0, timing: "a", tauCalibration: true });
    // without --traits the keys are exactly the old ones
    expect("traitsRecorded" in JSON.parse(JSON.stringify(assayJson({ ...base, labels: TAU_LABELS })))).toBe(false);
  });
});

describe("R1'' seeds, labels and sources (docs/scaffold-heredity-replication-v1.md)", () => {
  it("is 4,812,001 + 250 h + s, ending at 4,816,260", () => {
    expect(r1dPrimeSeed(0, 0)).toBe(4_812_001);
    expect(r1dPrimeSeed(1, 0)).toBe(4_812_251);
    expect(r1dPrimeSeed(0, 1)).toBe(4_812_002);
    expect(r1dPrimeSeed(0, 8)).toBe(4_812_009);
    expect(r1dPrimeSeed(0, 9)).toBe(4_812_010);
    expect(r1dPrimeSeed(12, 0)).toBe(4_812_001 + 3000);
    expect(r1dPrimeSeed(17, 9)).toBe(4_816_260);
    expect(R1DP_SEED_BASE).toBe(4_812_001);
    expect(R1DP_SEED_MAX).toBe(4_816_260);
    expect(R1DP_SETS).toBe(18);
  });

  it("range-checks every field", () => {
    for (const [h, s] of [[18, 0], [-1, 0], [0, 10], [0, -1], [0.5, 0], [0, 1.5], [0, NaN], [NaN, 0]] as const) expect(() => r1dPrimeSeed(h, s)).toThrow(/r1dPrimeSeed/);
  });

  it("cannot collide with assaySeed, R1', the tau calibration, P1, P2, the calibration, the main run or the worlds it assays", () => {
    const block = new Set<number>();
    for (let h = 0; h < R1DP_SETS; h++) for (let s = 0; s <= 9; s++) block.add(r1dPrimeSeed(h, s));
    expect(block.size).toBe(18 * 10);
    expect(Math.min(...block)).toBe(4_812_001);
    expect(Math.max(...block)).toBe(4_816_260);
    // inside the reserved range
    expect(Math.min(...block)).toBeGreaterThanOrEqual(4_800_001);
    expect(Math.max(...block)).toBeLessThanOrEqual(4_849_999);
    const others = new Set<number>();
    let minAssay = Infinity;
    for (let r = 0; r <= 4; r++) for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let v = 0; v <= 4; v++) for (let s = 0; s <= 9; s++) {
      const x = assaySeed(r, h, t, v, s);
      others.add(x);
      minAssay = Math.min(minAssay, x);
    }
    expect(minAssay).toBe(4_820_001);
    expect(Math.max(...block)).toBeLessThan(minAssay);
    for (let h = 0; h <= 11; h++) for (let t = 0; t <= 2; t++) for (let s = 0; s <= 9; s++) others.add(r1PrimeSeed(h, t, s));
    expect(Math.max(...block)).toBeLessThan(R1_PRIME_SEED_MAX);
    for (let s = 0; s <= 9; s++) others.add(TAU_SEED_BASE + s);
    for (let g = 0; g <= 14; g++) for (let s = 0; s <= 9; s++) others.add(4_800_001 + 100 * g + s); // P1
    for (let x = 4_802_001; x <= 4_802_022; x++) others.add(x); // calibration
    for (const x of [4_805_001, 4_805_002]) others.add(x); // P2 ranking worlds
    for (let arm = 0; arm <= 1; arm++) for (let s = 0; s <= 1; s++) others.add(4_805_101 + 10 * arm + s); // P2 selection runs
    for (let arm = 0; arm <= 2; arm++) for (let i = 0; i <= 5; i++) others.add(4_810_001 + 100 * arm + i); // main run
    for (let arm = 0; arm <= 1; arm++) for (let i = 0; i <= 5; i++) others.add(4_811_001 + 100 * arm + i); // fresh histories
    for (let j = 0; j <= 3; j++) others.add(4_811_201 + j); // negative-control worlds
    for (const x of block) expect(others.has(x)).toBe(false);
  });

  it("labels the 18 sets by h: scaf 0-5, rand 6-11, positive controls 12-13, negative controls 14-17", () => {
    expect(r1dPrimeLabelsOf(0)).toEqual({ arm: "scaf", history: 0, r1dprime: true, h: 0 });
    expect(r1dPrimeLabelsOf(5)).toEqual({ arm: "scaf", history: 5, r1dprime: true, h: 5 });
    expect(r1dPrimeLabelsOf(6)).toEqual({ arm: "rand", history: 0, r1dprime: true, h: 6 });
    expect(r1dPrimeLabelsOf(11)).toEqual({ arm: "rand", history: 5, r1dprime: true, h: 11 });
    expect(r1dPrimeLabelsOf(12)).toEqual({ arm: "control", history: 0, r1dprime: true, h: 12, control: "positive" });
    expect(r1dPrimeLabelsOf(13)).toEqual({ arm: "control", history: 1, r1dprime: true, h: 13, control: "positive" });
    expect(r1dPrimeLabelsOf(14)).toEqual({ arm: "control", history: 0, r1dprime: true, h: 14, control: "negative" });
    expect(r1dPrimeLabelsOf(17)).toEqual({ arm: "control", history: 3, r1dprime: true, h: 17, control: "negative" });
    expect(Array.from({ length: 18 }, (_, h) => r1dPrimeIdOf(r1dPrimeLabelsOf(h)))).toEqual([
      "scaf-i0", "scaf-i1", "scaf-i2", "scaf-i3", "scaf-i4", "scaf-i5", "rand-i0", "rand-i1", "rand-i2", "rand-i3", "rand-i4", "rand-i5", "pos-s0", "pos-s1", "neg-j0", "neg-j1", "neg-j2", "neg-j3",
    ]);
    for (const bad of [-1, 18, 1.5, NaN]) expect(() => r1dPrimeLabelsOf(bad)).toThrow(/R1'' h/);
  });

  it("parses --h with the --arm, --history and --control it implies, and refuses what disagrees", () => {
    expect(parseR1dPrimeLabels({ h: "3", arm: "scaf", history: "3" })).toEqual(r1dPrimeLabelsOf(3));
    expect(parseR1dPrimeLabels({ h: "8", arm: "rand", history: "2" })).toEqual(r1dPrimeLabelsOf(8));
    expect(parseR1dPrimeLabels({ h: "13", arm: "control", control: "positive" })).toEqual(r1dPrimeLabelsOf(13));
    expect(parseR1dPrimeLabels({ h: "13", arm: "control", control: "positive", history: "1" })).toEqual(r1dPrimeLabelsOf(13));
    expect(parseR1dPrimeLabels({ h: "17", arm: "control", control: "negative", history: "3" })).toEqual(r1dPrimeLabelsOf(17));
    // h is required and in range
    for (const h of [undefined, "", "18", "-1", "1.5", "x"]) expect(() => parseR1dPrimeLabels({ h, arm: "scaf", history: "0" })).toThrow(/--h/);
    // a fresh history needs the arm and history that h names
    expect(() => parseR1dPrimeLabels({ h: "3", arm: "rand", history: "3" })).toThrow(/--arm must be scaf for --h 3/);
    expect(() => parseR1dPrimeLabels({ h: "3", arm: "control", history: "3" })).toThrow(/--arm must be scaf/);
    expect(() => parseR1dPrimeLabels({ h: "3", arm: "scaf", history: "4" })).toThrow(/--history must be 3 for --h 3/);
    expect(() => parseR1dPrimeLabels({ h: "3", arm: "scaf" })).toThrow(/--history/);
    expect(() => parseR1dPrimeLabels({ h: "8", arm: "rand", history: "8" })).toThrow(/--history must be 2/);
    expect(() => parseR1dPrimeLabels({ h: "3", arm: "scaf", history: "3", control: "positive" })).toThrow(/--control applies to --arm control/);
    // a control needs --arm control and the matching --control; --history only if it agrees
    expect(() => parseR1dPrimeLabels({ h: "12", arm: "scaf", control: "positive" })).toThrow(/--arm must be control for --h 12/);
    expect(() => parseR1dPrimeLabels({ h: "12", arm: "control" })).toThrow(/--control must be positive for --h 12/);
    expect(() => parseR1dPrimeLabels({ h: "12", arm: "control", control: "negative" })).toThrow(/--control must be positive/);
    expect(() => parseR1dPrimeLabels({ h: "14", arm: "control", control: "positive" })).toThrow(/--control must be negative for --h 14/);
    expect(() => parseR1dPrimeLabels({ h: "14", arm: "control", control: "negative", history: "1" })).toThrow(/--history must be 0 for --h 14/);
    // R1's flags do not apply
    expect(() => parseR1dPrimeLabels({ h: "0", arm: "scaf", history: "0", time: "0" })).toThrow(/--time/);
    expect(() => parseR1dPrimeLabels({ h: "0", arm: "scaf", history: "0", timing: "a" })).toThrow(/--timing/);
    expect(() => parseR1dPrimeLabels({ h: "0", arm: "scaf", history: "0", calibration: "1" })).toThrow(/--calibration/);
  });

  it("checks each replicate's seeds and the donor seed against the labels", () => {
    const l = r1dPrimeLabelsOf(8);
    const at = (h: number, s: number) => ({ physics: r1dPrimeSeed(h, s), fragment: r1dPrimeSeed(h, s) });
    expect(() => checkR1dPrimeSeeds(l, at(8, 0), 0)).not.toThrow();
    expect(() => checkR1dPrimeSeeds(l, at(8, 1), 1)).not.toThrow();
    expect(() => checkR1dPrimeSeeds(l, at(8, 0), 1)).toThrow(/want r1dPrimeSeed\(h, 1\) = 4814002/);
    expect(() => checkR1dPrimeSeeds(l, { physics: r1dPrimeSeed(8, 0), fragment: r1dPrimeSeed(8, 1) }, 0)).toThrow(/fragment seed/);
    expect(() => checkR1dPrimeSeeds(l, at(9, 0), 0)).toThrow(/does not match the R1'' labels \(h 8\)/); // another history
    expect(() => checkR1dPrimeSeeds(l, { physics: assaySeed(1, 8, 0, 0, 0), fragment: assaySeed(1, 8, 0, 0, 0) }, 0)).toThrow(/does not match/); // R1's seed of that history
    expect(() => checkR1dPrimeSeeds(l, { physics: r1PrimeSeed(8, 0, 0), fragment: r1PrimeSeed(8, 0, 0) }, 0)).toThrow(/does not match/); // R1''s
    expect(r1dPrimeDonorSeedOf(l)).toBe(r1dPrimeSeed(8, 9));
    expect(() => checkR1dPrimeDonorSeed(l, r1dPrimeSeed(8, 9))).not.toThrow();
    expect(() => checkR1dPrimeDonorSeed(l, r1dPrimeSeed(8, 8))).toThrow(/donor seed/); // the permutation stream
    expect(() => checkR1dPrimeDonorSeed(l, assaySeed(1, 8, 0, 0, 9))).toThrow(/donor seed/); // R1's donor seed
  });

  it("holds a source to its labels: fresh histories, positive and negative controls", () => {
    const mut = pondConfig(8, 0).mutRate;
    expect(mut).toBe(429_497);
    // a grown pre-cycle state: C and S held, bound mass far outside the landing windows
    const pre = { totalC: 85_566, totalS: 204_772, carrying: 94_592, outsideWindow: 92_766, postCycle: false };
    const fresh = (arm: number, i: number) => ({ source: `runs/scaffold/rep/main/${arm ? "rand" : "scaf"}/i${i}/ckpt/b34-pre.blck.gz`, seed: 4_811_001 + 100 * arm + i, mutRate: mut, step: 340_000, tilesX: 8, tilesY: 8, distinctGenomes: 1019, phase: pre });
    for (const [h, arm, i] of [[0, 0, 0], [5, 0, 5], [6, 1, 0], [11, 1, 5]] as const) expect(r1dPrimeSourceProblems({ h }, fresh(arm, i))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(0, 1)).join(" ")).toMatch(/source seed 4811002, want 4811001/);
    expect(r1dPrimeSourceProblems({ h: 6 }, fresh(0, 0)).join(" ")).toMatch(/source seed 4811001, want 4811101/); // the scaf history's checkpoint under a rand label
    expect(r1dPrimeSourceProblems({ h: 0 }, { ...fresh(0, 0), step: 1_000_000 }).join(" ")).toMatch(/source step 1000000, want 340000/);
    expect(r1dPrimeSourceProblems({ h: 0 }, { ...fresh(0, 0), step: 330_000 }).join(" ")).toMatch(/step 330000/);
    expect(r1dPrimeSourceProblems({ h: 0 }, { ...fresh(0, 0), mutRate: 0 }).join(" ")).toMatch(/mutRate 0, want 429497/);
    expect(r1dPrimeSourceProblems({ h: 0 }, { ...fresh(0, 0), tilesX: 4, tilesY: 4 }).join(" ")).toMatch(/4 x 4 ponds, want 8 x 8/);

    const positive = (s: number) => ({ source: `runs/scaffold/p2/rank/s${s}/ckpt/b1-pre.blck.gz`, seed: 4_805_001 + s, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: 12, phase: pre });
    expect(r1dPrimeSourceProblems({ h: 12 }, positive(0))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 13 }, positive(1))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 13 }, positive(0)).join(" ")).toMatch(/seed 4805001, want 4805002/);
    expect(r1dPrimeSourceProblems({ h: 12 }, { ...positive(0), mutRate: 429_497 }).join(" ")).toMatch(/mutRate 429497, want 0/);
    expect(r1dPrimeSourceProblems({ h: 12 }, { ...positive(0), distinctGenomes: 1 }).join(" ")).toMatch(/1 distinct genomes, want more than 1 \(a founders world\)/);
    expect(r1dPrimeSourceProblems({ h: 12 }, { ...positive(0), step: 340_000 }).join(" ")).toMatch(/step 340000, want 10000/);

    const negative = (j: number) => ({ source: `runs/scaffold/rep/neg/j${j}/ckpt/b1-pre.blck.gz`, seed: 4_811_201 + j, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: 1, phase: pre });
    for (let j = 0; j <= 3; j++) expect(r1dPrimeSourceProblems({ h: 14 + j }, negative(j))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 15 }, negative(0)).join(" ")).toMatch(/seed 4811201, want 4811202/);
    expect(r1dPrimeSourceProblems({ h: 14 }, { ...negative(0), distinctGenomes: 12 }).join(" ")).toMatch(/12 distinct genomes, want 1 \(a clone world\)/);
    expect(r1dPrimeSourceProblems({ h: 14 }, { ...negative(0), mutRate: 429_497 }).join(" ")).toMatch(/mutRate 429497, want 0/);
    // a positive control's world is not a negative control's, and the reverse
    expect(r1dPrimeSourceProblems({ h: 14 }, positive(0)).length).toBeGreaterThan(0);
    expect(r1dPrimeSourceProblems({ h: 12 }, negative(0)).length).toBeGreaterThan(0);
    // every problem is listed, not only the first
    expect(r1dPrimeSourceProblems({ h: 0 }, { source: "x.blck.gz", seed: 1, mutRate: 0, step: 0, tilesX: 2, tilesY: 2, distinctGenomes: 1, phase: pre })).toHaveLength(5);
  });

  it("holds a source to the pre-cycle checkpoint: its path names it, and its content is not a post-cycle state's", () => {
    const pre = { totalC: 85_566, totalS: 204_772, carrying: 94_592, outsideWindow: 92_766, postCycle: false };
    const post = { totalC: 0, totalS: 0, carrying: 2014, outsideWindow: 0, postCycle: true };
    const fresh = (source: string, phase = pre) => ({ source, seed: 4_811_001, mutRate: 429_497, step: 340_000, tilesX: 8, tilesY: 8, distinctGenomes: 1019, phase });
    const dir = "runs/scaffold/rep/main/scaf/i0/ckpt";
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-pre.blck.gz`))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh("ckpt/b34-pre.blck.gz"))).toEqual([]); // from inside the run directory
    // b34-post has the same seed, mutation rate and step: only its name and its content tell it from b34-pre
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-post.blck.gz`)).join(" ")).toMatch(/does not end in ckpt\/b34-pre\.blck\.gz/);
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-post.blck.gz`, post)).length).toBe(2);
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-pre.blck.gz`, post)).join(" ")).toMatch(/looks post-cycle \(C 0, S 0; 0 of 2014 cells.*want the pre-cycle state/);
    // other names: another boundary's pre-cycle checkpoint, the initial state, a path that only looks like it, a non-ckpt directory
    for (const bad of [`${dir}/b100-pre.blck.gz`, `${dir}/b33-pre.blck.gz`, `${dir}/init.blck.gz`, `${dir}/b34-pre.blck`, `${dir}/xb34-pre.blck.gz`, "runs/main/b34-pre.blck.gz", `${dir}/b34-pre.blck.gz.tmp`, `${dir}/b34-pre.blck.gz/`]) {
      expect(r1dPrimeSourceProblems({ h: 0 }, fresh(bad)).join(" ")).toMatch(/does not end in ckpt\/b34-pre\.blck\.gz/);
    }
    // controls are b1-pre, and a fresh history's name is not a control's
    const control = (source: string, phase = pre) => ({ source, seed: 4_805_001, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: 12, phase });
    expect(r1dPrimeSourceProblems({ h: 12 }, control("runs/scaffold/p2/rank/s0/ckpt/b1-pre.blck.gz"))).toEqual([]);
    expect(r1dPrimeSourceProblems({ h: 12 }, control("runs/scaffold/p2/rank/s0/ckpt/b1-post.blck.gz")).join(" ")).toMatch(/does not end in ckpt\/b1-pre\.blck\.gz/);
    expect(r1dPrimeSourceProblems({ h: 12 }, control("runs/scaffold/p2/rank/s0/ckpt/init.blck.gz")).join(" ")).toMatch(/b1-pre/);
    expect(r1dPrimeSourceProblems({ h: 12 }, control("runs/scaffold/p2/rank/s0/ckpt/b34-pre.blck.gz")).join(" ")).toMatch(/b1-pre/);
    expect(r1dPrimeSourceProblems({ h: 12 }, control("runs/scaffold/p2/rank/s0/ckpt/b1-pre.blck.gz", post)).join(" ")).toMatch(/looks post-cycle/);
    expect(r1dPrimeCheckpointOf(0)).toBe("b34-pre");
    expect(r1dPrimeCheckpointOf(11)).toBe("b34-pre");
    expect(r1dPrimeCheckpointOf(12)).toBe("b1-pre");
    expect(r1dPrimeCheckpointOf(17)).toBe("b1-pre");
    // the recorded flag must be the one its own measures give
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-pre.blck.gz`, { ...post, postCycle: false })).join(" ")).toMatch(/phase flag postCycle false disagrees with its measures \(true\)/);
    expect(r1dPrimeSourceProblems({ h: 0 }, fresh(`${dir}/b34-pre.blck.gz`, { ...pre, postCycle: true })).join(" ")).toMatch(/phase flag postCycle true disagrees with its measures \(false\)/);
  });

  it("tells a post-cycle state from a pre-cycle one by its content: C and S, and where its bound mass sits", () => {
    // postCycleOf: C = S = 0 everywhere, or bound mass and lineages only inside the landing windows
    expect(postCycleOf({ totalC: 0, totalS: 0, carrying: 0, outsideWindow: 0 })).toBe(true);
    expect(postCycleOf({ totalC: 0, totalS: 0, carrying: 100, outsideWindow: 50 })).toBe(true);
    expect(postCycleOf({ totalC: 5, totalS: 0, carrying: 100, outsideWindow: 0 })).toBe(true);
    expect(postCycleOf({ totalC: 5, totalS: 0, carrying: 100, outsideWindow: 1 })).toBe(false);
    expect(postCycleOf({ totalC: 0, totalS: 5, carrying: 100, outsideWindow: 1 })).toBe(false);
    expect(postCycleOf({ totalC: 5, totalS: 5, carrying: 0, outsideWindow: 0 })).toBe(false); // no bound mass: nothing confined (an extinct pre-cycle state)

    // a world with a blob of bound mass inside every pond's 8 x 8 window (28..35): C and S are 0, so it looks post-cycle
    const confined = blobSource(2);
    expect(r1dPrimePhase(confined)).toEqual({ totalC: 0, totalS: 0, carrying: 100, outsideWindow: 0, postCycle: true });
    const n = cellCount(confined.cfg);
    const grown = (s: WorldState): WorldState => {
      const g = { ...s, cells: s.cells.slice(), genome: s.genome.slice() };
      g.cells[CH.C * n + cellIdx(g, 1, 5, 5)] = 40;
      g.cells[CH.S * n + cellIdx(g, 2, 9, 9)] = 7;
      return g;
    };
    // C and S held, but the mass still confined: the window clause alone says post-cycle
    expect(r1dPrimePhase(grown(confined))).toMatchObject({ totalC: 40, totalS: 7, carrying: 100, outsideWindow: 0, postCycle: true });
    // bound mass one cell outside the window, with C and S held: a pre-cycle state; each side of each edge
    const edge = (x: number, y: number): WorldState => {
      const g = grown(confined);
      g.cells[CH.B * n + cellIdx(g, 3, x, y)] = 60;
      return g;
    };
    for (const [x, y] of [[27, 30], [36, 30], [30, 27], [30, 36], [0, 0], [63, 63]] as const) expect(r1dPrimePhase(edge(x, y))).toMatchObject({ outsideWindow: 1, postCycle: false });
    for (const [x, y] of [[28, 28], [35, 35], [28, 35], [35, 28]] as const) expect(r1dPrimePhase(edge(x, y))).toMatchObject({ outsideWindow: 0, postCycle: true });
    // a lineage id with no bound mass counts as carrying; nutrient alone does not
    const lineage = grown(confined);
    lineage.genome[G.LIN_LO * n + cellIdx(lineage, 0, 3, 3)] = 9;
    expect(r1dPrimePhase(lineage)).toMatchObject({ carrying: 101, outsideWindow: 1, postCycle: false });
    expect(r1dPrimePhase(grown(emptyWorld(2)))).toMatchObject({ carrying: 0, outsideWindow: 0, postCycle: false });
    // C = S = 0 with mass far outside the windows (a fresh state at step 0) is not a pre-cycle state either
    const spread = emptyWorld(2);
    spread.cells[CH.B * n + cellIdx(spread, 0, 3, 3)] = 60;
    expect(r1dPrimePhase(spread)).toMatchObject({ totalC: 0, totalS: 0, outsideWindow: 1, postCycle: true });
  });

  it("sees the pond cycle's own output as post-cycle and the state it was made from as pre-cycle", () => {
    // a grown pre-cycle state: blobs, bound mass all over the ponds, and C and S held
    const pre = blobSource(2);
    const n = cellCount(pre.cfg);
    for (let p = 0; p < 4; p++) for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) plant(pre, p, x, y, 50, p + 1, 20, p % 2 ? genomeB : genomeA);
    pre.cells[CH.C * n + cellIdx(pre, 0, 50, 50)] = 33;
    pre.cells[CH.S * n + cellIdx(pre, 3, 40, 40)] = 21;
    expect(r1dPrimePhase(pre)).toMatchObject({ totalC: 33, totalS: 21, postCycle: false });
    expect(r1dPrimePhase(pre).outsideWindow).toBeGreaterThan(1000);
    for (const arm of ["scaf", "rand"] as const) {
      const res = applyPondCycle(pre, 1, arm, 8, pondMatter(pre));
      expect(res.state.step).toBe(pre.step);
      const post = r1dPrimePhase(res.state);
      expect(post).toMatchObject({ totalC: 0, totalS: 0, outsideWindow: 0, postCycle: true });
      expect(post.carrying).toBeGreaterThan(0);
      // the post-cycle state has the same seed, mutation rate and step as the one it was made from: the content is what differs
      expect(res.state.cfg.seed).toBe(pre.cfg.seed);
      expect(res.state.cfg.mutRate).toBe(pre.cfg.mutRate);
    }
  });

  it("reads a source's provenance from its checkpoint state: state hash, config seed and mutRate, step, ponds and distinct genomes", () => {
    const two = blobSource(2); // ponds alternate genome A and genome B
    expect(distinctGenomes(two)).toBe(2);
    expect(distinctGenomes(blobSource(2, [0, 2]))).toBe(1); // genome A only, in two lineages
    expect(distinctGenomes(emptyWorld(2))).toBe(0);
    expect(r1dPrimeProvenance("runs/x/ckpt/b1-pre.blck.gz", two)).toEqual({
      source: "runs/x/ckpt/b1-pre.blck.gz",
      stateHash: stateHash(two),
      seed: 7,
      mutRate: 0,
      step: 0,
      tilesX: 2,
      tilesY: 2,
      distinctGenomes: 2,
      phase: { totalC: 0, totalS: 0, carrying: 100, outsideWindow: 0, postCycle: true },
    });
    // the hash follows the state
    const other = blobSource(2, [0]);
    expect(r1dPrimeProvenance("p", other).stateHash).not.toBe(r1dPrimeProvenance("p", two).stateHash);
  });

  it("writes the R1'' labels, provenance and protocol hash into assay.json, and leaves other keys alone", () => {
    const base = { protocolSha256: "0".repeat(64), assay: "transmission", source: "ckpt", tag: "t", k: 8, period: 10_000, ref: null, side: 8, replicates: 2, censusEvery: 100, inoculum: "fragment", seeds: [], extra: {}, summary: {}, wallSeconds: 1 };
    const provenance = r1dPrimeProvenance("ckpt", blobSource(2));
    const dp = JSON.parse(JSON.stringify(assayJson({ ...base, labels: r1dPrimeLabelsOf(13), extra: { traitsRecorded: true, provenance, protocolSha256R1dp: "1".repeat(64) } })));
    expect(dp.labels).toEqual({ arm: "control", history: 1, r1dprime: true, h: 13, control: "positive" });
    expect(dp.provenance).toEqual(provenance);
    expect(dp.protocolSha256R1dp).toBe("1".repeat(64));
    expect(dp.protocolSha256).toBe("0".repeat(64));
    expect(dp.traitsRecorded).toBe(true);
    const fresh = JSON.parse(JSON.stringify(assayJson({ ...base, labels: r1dPrimeLabelsOf(2) })));
    expect(fresh.labels).toEqual({ arm: "scaf", history: 2, r1dprime: true, h: 2 });
    expect("provenance" in fresh).toBe(false);
    expect(R1DP_REGIME).toEqual({ k: 8, period: 10_000, side: 8, replicates: 2, censusEvery: 100 });
  });
});

describe("R3 replication seeds, labels and sources (docs/scaffold-r3-replication-v1.md)", () => {
  const mut = pondConfig(8, 0).mutRate;
  const V1 = "1".repeat(64); // protocol v1's SHA-256, as recorded in a run's meta.json
  const R3 = "3".repeat(64); // the replication protocol's

  /** A timing (a) source of h as a run would record it: N = 100 (1 for the ancestor), the run's meta.json and done.json. */
  const origin = (h: number, over: { source?: string; seed?: number; mutRate?: number; step?: number; meta?: Record<string, unknown>; done?: Record<string, unknown> | null; N?: number } = {}): R3RepOrigin => {
    const l = r3RepHistoryOf(h);
    const ancestor = l.arm === "ancestor";
    const N = over.N ?? (ancestor ? 1 : 100);
    const seed = r3RepWorldSeedOf(h);
    return {
      source: over.source ?? `runs/scaffold/${r3RepRunDirOf(h)}/ckpt/b${N}-pre.blck.gz`,
      stateHash: `a${h}`.padEnd(16, "0"),
      seed: over.seed ?? seed,
      mutRate: over.mutRate ?? mut,
      step: over.step ?? N * 10_000,
      tilesX: 8,
      tilesY: 8,
      run: {
        meta: { arm: ancestor ? "cont" : l.arm, k: l.arm === "scaf" || l.arm === "rand" ? 8 : 0, period: 10_000, cycles: ancestor ? 1 : 100, side: 8, seed, mutRate: mut, init: "clone", censusEvery: 100, protocolSha256: V1, ...over.meta },
        done: over.done === null ? null : { ok: true, conservationOk: true, cycles: N, ended: false, ...over.done },
      },
    };
  };
  /** The continued checkpoint of h, 2 x 10^5 steps past `from`. */
  const continued = (h: number, from: R3RepCheckpoint, over: Partial<R3RepCheckpoint> = {}): R3RepCheckpoint => ({ source: `runs/scaffold/${r3RepContinuationPathOf(h)}`, stateHash: `e${h}`.padEnd(16, "0"), seed: r3RepContinueSeed(h), mutRate: mut, step: from.step + 200_000, tilesX: 8, tilesY: 8, ...over });
  const sidecarOf = (h: number, from: R3RepCheckpoint, end: R3RepCheckpoint) => r3RepContinuationOf({ h, origin: from, end, steps: 200_000, protocolSha256R3rep: R3 });
  const sha = { protocol: V1, r3rep: R3 };

  it("is 4,816,301 + 100 h + 10 t + s, ending at 4,818,112; continuations are 4,818,301 + h", () => {
    expect(r3RepSeed(0, 0, 0)).toBe(4_816_301);
    expect(r3RepSeed(1, 0, 0)).toBe(4_816_401);
    expect(r3RepSeed(0, 1, 0)).toBe(4_816_311);
    expect(r3RepSeed(0, 0, 1)).toBe(4_816_302);
    expect(r3RepSeed(18, 0, 0)).toBe(4_818_101);
    expect(r3RepSeed(18, 1, 1)).toBe(4_818_112);
    expect(R3REP_SEED_BASE).toBe(4_816_301);
    expect(R3REP_SEED_MAX).toBe(4_818_112);
    expect(r3RepContinueSeed(0)).toBe(4_818_301);
    expect(r3RepContinueSeed(18)).toBe(4_818_319);
    expect(R3REP_CONTINUE_STEPS).toBe(200_000);
    expect(R3REP_REGIME).toEqual({ k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 2, censusEvery: 100 });
  });

  it("range-checks every field", () => {
    for (const [h, t, s] of [[19, 0, 0], [-1, 0, 0], [0, 2, 0], [0, -1, 0], [0, 0, 2], [0, 0, -1], [0.5, 0, 0], [0, 0.5, 0], [0, 0, NaN], [NaN, 0, 0]] as const) expect(() => r3RepSeed(h, t, s)).toThrow(/r3RepSeed/);
    for (const h of [19, -1, 1.5, NaN]) expect(() => r3RepContinueSeed(h)).toThrow(/r3RepContinueSeed/);
  });

  it("cannot collide with assaySeed, R1', R1'', the tau calibration, P1, P2, the calibration, the main run or the worlds", () => {
    const block = new Set<number>();
    for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let s = 0; s <= 1; s++) block.add(r3RepSeed(h, t, s));
    expect(block.size).toBe(19 * 2 * 2);
    for (let h = 0; h <= 18; h++) block.add(r3RepContinueSeed(h));
    const worlds = Array.from({ length: 19 }, (_, h) => r3RepWorldSeedOf(h));
    expect(new Set(worlds).size).toBe(19);
    expect(worlds.slice(12, 18)).toEqual([4_811_301, 4_811_302, 4_811_303, 4_811_304, 4_811_305, 4_811_306]);
    expect(worlds[18]).toBe(4_818_401);
    for (const x of worlds.slice(12)) block.add(x);
    expect(block.size).toBe(76 + 19 + 7);
    for (const x of block) expect(x >= 4_800_001 && x <= 4_849_999).toBe(true);
    expect(Math.min(...[...block].filter((x) => x >= R3REP_SEED_BASE))).toBe(R3REP_SEED_BASE);
    expect(R3REP_SEED_BASE).toBeGreaterThan(R1DP_SEED_MAX);
    const others = new Set<number>();
    for (let r = 0; r <= 4; r++) for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let v = 0; v <= 4; v++) for (let s = 0; s <= 9; s++) others.add(assaySeed(r, h, t, v, s));
    for (let h = 0; h <= 11; h++) for (let t = 0; t <= 2; t++) for (let s = 0; s <= 9; s++) others.add(r1PrimeSeed(h, t, s));
    for (let h = 0; h < R1DP_SETS; h++) for (let s = 0; s <= 9; s++) others.add(r1dPrimeSeed(h, s));
    for (let s = 0; s <= 9; s++) others.add(TAU_SEED_BASE + s);
    for (let g = 0; g <= 14; g++) for (let s = 0; s <= 9; s++) others.add(4_800_001 + 100 * g + s); // P1
    for (let x = 4_802_001; x <= 4_802_022; x++) others.add(x); // calibration
    for (const x of [4_805_001, 4_805_002]) others.add(x); // P2 ranking worlds
    for (let arm = 0; arm <= 1; arm++) for (let s = 0; s <= 1; s++) others.add(4_805_101 + 10 * arm + s); // P2 selection runs
    for (let arm = 0; arm <= 2; arm++) for (let i = 0; i <= 5; i++) others.add(4_810_001 + 100 * arm + i); // main run
    for (let j = 0; j <= 3; j++) others.add(4_811_201 + j); // the R1'' negative-control worlds (the formula's arm-2 seeds are not used)
    for (const x of block) expect(others.has(x)).toBe(false);
    // the scaf and rand worlds are the R1'' fresh histories, reused
    expect(worlds.slice(0, 12)).toEqual([0, 1].flatMap((arm) => [0, 1, 2, 3, 4, 5].map((i) => 4_811_001 + 100 * arm + i)));
  });

  it("gives Ge-on-Fa the ancestor's seeds (h = 18 at t = 0), and every other variant its source's", () => {
    const l = r3RepLabelsOf(3, "a");
    expect(r3RepSeedHOf(l, "swap-ea")).toBe(R3REP_ANCESTOR_H);
    for (const v of ["fragment", "swap-ae", "quenched"]) expect(r3RepSeedHOf(l, v)).toBe(3);
    for (let s = 0; s <= 1; s++) {
      expect(r3RepSeedOf(l, "swap-ea", s)).toBe(r3RepSeed(18, 0, s));
      expect(r3RepSeedOf(l, "swap-ea", s)).toBe(r3RepSeedOf(r3RepLabelsOf(18, "a"), "fragment", s)); // the ancestor's own set at (a)
      expect(r3RepSeedOf(l, "swap-ae", s)).toBe(r3RepSeed(3, 0, s));
      expect(r3RepSeedOf(r3RepLabelsOf(3, "b"), "quenched", s)).toBe(r3RepSeed(3, 1, s));
    }
    const at = (seed: number) => ({ physics: seed, fragment: seed });
    expect(() => checkR3RepSeeds(l, "swap-ea", at(r3RepSeed(18, 0, 0)), 0)).not.toThrow();
    expect(() => checkR3RepSeeds(l, "swap-ea", at(r3RepSeed(18, 0, 1)), 1)).not.toThrow();
    expect(() => checkR3RepSeeds(l, "swap-ea", at(r3RepSeed(3, 0, 0)), 0)).toThrow(/want r3RepSeed\(18, 0, 0\) = 4818101/); // the history's own
    expect(() => checkR3RepSeeds(l, "swap-ae", at(r3RepSeed(18, 0, 0)), 0)).toThrow(/want r3RepSeed\(3, 0, 0\) = 4816601/);
    expect(() => checkR3RepSeeds(l, "fragment", at(r3RepSeed(3, 0, 0)), 0)).not.toThrow();
    expect(() => checkR3RepSeeds(l, "fragment", at(r3RepSeed(3, 0, 0)), 1)).toThrow(/want r3RepSeed\(3, 0, 1\)/);
    expect(() => checkR3RepSeeds(l, "fragment", { physics: r3RepSeed(3, 0, 0), fragment: r3RepSeed(3, 0, 1) }, 0)).toThrow(/fragment seed/);
    expect(() => checkR3RepSeeds(l, "fragment", at(r3RepSeed(3, 1, 0)), 0)).toThrow(/does not match/); // the other timing
    expect(() => checkR3RepSeeds(l, "fragment", at(assaySeed(3, 3, 0, 0, 0)), 0)).toThrow(/does not match/); // v1's R3 seed of that history
  });

  it("labels the 19 sources by h, derives h from --arm and --history, and refuses what disagrees", () => {
    expect(r3RepHistoryOf(0)).toEqual({ arm: "scaf", history: 0, h: 0 });
    expect(r3RepHistoryOf(11)).toEqual({ arm: "rand", history: 5, h: 11 });
    expect(r3RepHistoryOf(12)).toEqual({ arm: "cont", history: 0, h: 12 });
    expect(r3RepHistoryOf(18)).toEqual({ arm: "ancestor", history: -1, h: 18 });
    for (const bad of [-1, 19, 1.5, NaN]) expect(() => r3RepHistoryOf(bad)).toThrow(/R3-replication h/);
    expect(r3RepLabelsOf(8, "b")).toEqual({ arm: "rand", history: 2, timing: "b", r3rep: true, h: 8 });
    expect(Array.from({ length: 19 }, (_, h) => r3RepIdOf(r3RepHistoryOf(h))).join(" ")).toBe(
      "scaf-i0 scaf-i1 scaf-i2 scaf-i3 scaf-i4 scaf-i5 rand-i0 rand-i1 rand-i2 rand-i3 rand-i4 rand-i5 cont-i0 cont-i1 cont-i2 cont-i3 cont-i4 cont-i5 ancestor",
    );
    expect(r3RepSetIdOf(r3RepLabelsOf(0, "a"), "swap-ea")).toBe("scaf-i0-a-swap-ea");
    expect(r3RepSetIdOf(r3RepLabelsOf(18, "b"), "fragment")).toBe("ancestor-b");

    expect(parseR3RepLabels({ arm: "scaf", history: "3", timing: "a" })).toEqual(r3RepLabelsOf(3, "a"));
    expect(parseR3RepLabels({ arm: "cont", history: "5", timing: "b" })).toEqual(r3RepLabelsOf(17, "b"));
    expect(parseR3RepLabels({ arm: "ancestor", timing: "b" })).toEqual(r3RepLabelsOf(18, "b"));
    // --h is derived: it may be given only when it agrees
    expect(parseR3RepLabels({ arm: "rand", history: "2", timing: "a", h: "8" })).toEqual(r3RepLabelsOf(8, "a"));
    expect(parseR3RepLabels({ arm: "ancestor", timing: "a", h: "18" })).toEqual(r3RepLabelsOf(18, "a"));
    expect(() => parseR3RepLabels({ arm: "rand", history: "2", timing: "a", h: "2" })).toThrow(/--h 2 disagrees with --arm rand --history 2: .* here 8/);
    expect(() => parseR3RepLabels({ arm: "ancestor", timing: "a", h: "0" })).toThrow(/--h 0 disagrees/);
    expect(() => parseR3RepLabels({ arm: "scaf", history: "0", timing: "a", h: "" })).toThrow(/--h/);
    // arm, history and timing
    expect(() => parseR3RepLabels({ arm: "control", history: "0", timing: "a" })).toThrow(/--arm/);
    expect(() => parseR3RepLabels({ history: "0", timing: "a" })).toThrow(/--arm/);
    expect(() => parseR3RepLabels({ arm: "scaf", timing: "a" })).toThrow(/--history/);
    expect(() => parseR3RepLabels({ arm: "scaf", history: "6", timing: "a" })).toThrow(/--history/);
    expect(() => parseR3RepLabels({ arm: "ancestor", history: "0", timing: "a" })).toThrow(/--history does not apply to the ancestor/);
    expect(() => parseR3RepLabels({ arm: "scaf", history: "0" })).toThrow(/--timing/);
    expect(() => parseR3RepLabels({ arm: "scaf", history: "0", timing: "c" })).toThrow(/--timing/);
    // the R1 and R1'' flags do not apply
    expect(() => parseR3RepLabels({ arm: "scaf", history: "0", timing: "a", time: "0" })).toThrow(/--time/);
    expect(() => parseR3RepLabels({ arm: "ancestor", timing: "a", calibration: "1" })).toThrow(/--calibration/);
    expect(() => parseR3RepLabels({ arm: "scaf", history: "0", timing: "a", control: "positive" })).toThrow(/--control/);
    // continue names the source world only
    expect(parseR3RepContinueLabels({ arm: "cont", history: "1" })).toEqual(r3RepHistoryOf(13));
    expect(parseR3RepContinueLabels({ arm: "ancestor", h: "18" })).toEqual(r3RepHistoryOf(18));
    expect(() => parseR3RepContinueLabels({ arm: "cont", history: "1", timing: "b" })).toThrow(/--timing/);
    expect(() => parseR3RepContinueLabels({ arm: "cont", history: "1", h: "12" })).toThrow(/--h 12 disagrees/);
  });

  it("reads the labels back from assay.json, for the stage and for v1's AssaySet (arm, history, timing)", () => {
    expect(r3RepLabelsFromJson(r3RepLabelsOf(4, "b"))).toEqual({ labels: r3RepLabelsOf(4, "b") });
    expect(r3RepLabelsFromJson({ arm: "scaf", history: 4, timing: "b", h: 4 })).toEqual({ error: "labels.r3rep is not true" });
    expect(r3RepLabelsFromJson({ ...r3RepLabelsOf(4, "b"), h: 19 })).toMatchObject({ error: expect.stringMatching(/labels.h 19/) });
    expect(r3RepLabelsFromJson({ ...r3RepLabelsOf(4, "b"), timing: "c" })).toMatchObject({ error: expect.stringMatching(/labels.timing/) });
    expect(r3RepLabelsFromJson({ ...r3RepLabelsOf(4, "b"), arm: "rand" })).toMatchObject({ error: expect.stringMatching(/labels.arm "rand", want "scaf" for h 4/) });
    expect(r3RepLabelsFromJson({ ...r3RepLabelsOf(4, "b"), history: 5 })).toMatchObject({ error: expect.stringMatching(/labels.history 5, want 4/) });
    expect(r3RepLabelsFromJson(undefined)).toEqual({ error: "labels.r3rep is not true" });
    const base = { protocolSha256: V1, assay: "competence", source: "s", tag: "t", k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 2, censusEvery: 100, inoculum: "quenched", seeds: [], extra: {}, summary: {}, wallSeconds: 1 };
    for (const [h, timing, arm, history] of [[2, "b", "scaf", 2], [15, "a", "cont", 3], [18, "a", "ancestor", -1]] as const) {
      const json = JSON.parse(JSON.stringify(assayJson({ ...base, labels: r3RepLabelsOf(h, timing), extra: { provenance: { source: "s" }, protocolSha256R3rep: R3 } })));
      expect(json.labels).toEqual({ arm, history, timing, r3rep: true, h });
      expect(json.protocolSha256R3rep).toBe(R3);
      expect(assayLabels(json)).toMatchObject({ arm, history, timing, ref: 103_058, k: 8, period: 10_000, calibration: null });
    }
  });

  it("plans the 62 sets: 38 sources, 12 swaps and 12 quenched controls", () => {
    const sets = r3RepExpectedSets();
    expect(sets).toHaveLength(62);
    expect(new Set(sets.map((s) => r3RepSetIdOf(s.labels, s.inoculum))).size).toBe(62);
    expect(sets.filter((s) => s.inoculum === "fragment")).toHaveLength(38);
    expect(sets.filter((s) => s.inoculum.startsWith("swap-"))).toHaveLength(12);
    expect(sets.filter((s) => s.inoculum === "quenched")).toHaveLength(12);
    for (const s of sets) expect(r3RepVariantProblems(s.labels, s.inoculum)).toEqual([]);
  });

  it("allows the swaps on a scaf history at timing a and the quenched control on a scaf history at either timing", () => {
    expect(r3RepVariantProblems(r3RepLabelsOf(0, "b"), "quenched")).toEqual([]);
    expect(r3RepVariantProblems(r3RepLabelsOf(0, "b"), "swap-ea").join(" ")).toMatch(/swap-ea runs at timing a only/);
    expect(r3RepVariantProblems(r3RepLabelsOf(0, "b"), "swap-ae").join(" ")).toMatch(/swap-ae runs at timing a only/);
    expect(r3RepVariantProblems(r3RepLabelsOf(6, "a"), "quenched").join(" ")).toMatch(/quenched labels a scaf history, not rand/);
    expect(r3RepVariantProblems(r3RepLabelsOf(18, "a"), "swap-ea").join(" ")).toMatch(/not ancestor/);
    expect(r3RepVariantProblems(r3RepLabelsOf(12, "b"), "swap-ae")).toHaveLength(2);
    expect(r3RepVariantProblems(r3RepLabelsOf(0, "a"), "disc").join(" ")).toMatch(/inoculum "disc"/);
    expect(r3RepRegimeProblems(R3REP_REGIME)).toEqual([]);
    expect(r3RepRegimeProblems({ ...R3REP_REGIME, k: 5, ref: null })).toEqual(["k 5, want 8", "ref null, want 103058"]);
    expect(r3RepRegimeProblems({ k: 8, period: 3000, ref: 103_058, side: 2, replicates: 1, censusEvery: 50 })).toHaveLength(4);
  });

  it("holds a timing (a) source to its history: the run directory's meta.json and done.json, and the state's seed, mutation rate and step", () => {
    for (const h of [0, 5, 6, 11, 12, 17, 18]) expect(r3RepOriginProblems(h, origin(h), V1)).toEqual([]);
    expect(r3RepOriginProblems(0, origin(0, { source: "runs/scaffold/r3rep/main/scaf/i0/ckpt/b100-pre.blck.gz" }), V1)).toEqual([]);
    expect(r3RepOriginProblems(0, origin(0, { source: "r3rep/main/scaf/i0/ckpt/b100-pre.blck.gz" }), V1)).toEqual([]);
    expect(r3RepOriginProblems(0, origin(0, { source: "/home/u/bl/runs/scaffold/r3rep/main/scaf/i0/ckpt/b100-pre.blck.gz" }), V1)).toEqual([]);
    // wrong seed: another history's checkpoint, or the run's meta.json says another world
    expect(r3RepOriginProblems(0, origin(0, { seed: 4_811_002 }), V1).join(" ")).toMatch(/source seed 4811002, want 4811001/);
    expect(r3RepOriginProblems(6, origin(0), V1).join(" ")).toMatch(/does not end in r3rep\/main\/rand\/i0\/ckpt\/b<N>-pre\.blck\.gz/);
    expect(r3RepOriginProblems(12, origin(12, { meta: { seed: 4_811_201 } }), V1).join(" ")).toMatch(/run meta.json seed 4811201, want 4811301/); // the formula's arm-2 seed
    expect(r3RepOriginProblems(0, origin(0, { mutRate: 0 }), V1).join(" ")).toMatch(/source mutRate 0, want 429497/);
    // wrong step
    expect(r3RepOriginProblems(0, origin(0, { step: 340_000 }), V1).join(" ")).toMatch(/source step 340000, want 1000000/);
    expect(r3RepOriginProblems(18, origin(18, { step: 210_000 }), V1).join(" ")).toMatch(/source step 210000, want 10000/);
    // wrong path: another boundary, the post-cycle state, v1's histories, the R1'' originals, a name that only looks like it
    const dir = "runs/scaffold/r3rep/main/scaf/i0/ckpt";
    for (const bad of [`${dir}/b100-post.blck.gz`, `${dir}/init.blck.gz`, `${dir}/b100-pre.blck`, `${dir}/b100-pre.blck.gz.tmp`, `${dir}/xb100-pre.blck.gz`, `${dir}/b0100-pre.blck.gz`, `${dir}/b101-pre.blck.gz`, "runs/scaffold/main/scaf/i0/ckpt/b100-pre.blck.gz", "runs/scaffold/rep/main/scaf/i0/ckpt/b34-pre.blck.gz", "runs/scaffold/xr3rep/main/scaf/i0/ckpt/b100-pre.blck.gz", "runs/scaffold/r3rep/main/scaf/i0/b100-pre.blck.gz"]) {
      expect(r3RepOriginProblems(0, origin(0, { source: bad }), V1).join(" ")).toMatch(/does not end in r3rep\/main\/scaf\/i0\/ckpt\/b<N>-pre\.blck\.gz/);
    }
    expect(r3RepOriginProblems(18, origin(18, { source: "runs/scaffold/r3rep/anc/ckpt/b2-pre.blck.gz" }), V1).join(" ")).toMatch(/does not end in r3rep\/anc\/ckpt\/b1-pre\.blck\.gz/);
    expect(r3RepOriginProblems(18, origin(18, { source: "runs/scaffold/calib/source/ckpt/b1-pre.blck.gz" }), V1).join(" ")).toMatch(/r3rep\/anc/); // v1's ancestor source
    // wrong protocol SHA: the run was made under another protocol v1 document
    expect(r3RepOriginProblems(0, origin(0), "2".repeat(64)).join(" ")).toMatch(/run meta.json protocolSha256 "1{64}", want "2{64}"/);
    // the rest of meta.json
    expect(r3RepOriginProblems(0, origin(0, { meta: { k: 5 } }), V1).join(" ")).toMatch(/meta.json k 5, want 8/);
    expect(r3RepOriginProblems(12, origin(12, { meta: { k: 8 } }), V1).join(" ")).toMatch(/meta.json k 8, want 0/);
    expect(r3RepOriginProblems(0, origin(0, { meta: { arm: "rand" } }), V1).join(" ")).toMatch(/meta.json arm "rand", want "scaf"/);
    expect(r3RepOriginProblems(0, origin(0, { meta: { init: "founders" } }), V1).join(" ")).toMatch(/init "founders", want "clone"/);
    expect(r3RepOriginProblems(0, origin(0, { meta: { censusEvery: 50 } }), V1).join(" ")).toMatch(/censusEvery 50, want 100/);
    expect(r3RepOriginProblems(0, origin(0, { meta: { mutRate: 0 } }), V1).join(" ")).toMatch(/meta.json mutRate 0, want 429497/);
    expect(r3RepOriginProblems(18, origin(18, { meta: { cycles: 2 } }), V1).join(" ")).toMatch(/meta.json cycles 2, want 1/);
    expect(r3RepOriginProblems(18, origin(18, { meta: { arm: "scaf" } }), V1).join(" ")).toMatch(/meta.json arm "scaf", want "cont"/);
    // not inside a run directory, or the run is unfinished, failed or not extended to 100 cycles
    expect(r3RepOriginProblems(0, { ...origin(0), run: r3RepRunRecordOf(null, null) }, V1).join(" ")).toMatch(/not inside a run directory.*no readable done.json/);
    expect(r3RepOriginProblems(0, origin(0, { done: null }), V1).join(" ")).toMatch(/no readable done.json \(unfinished\)/);
    expect(r3RepOriginProblems(0, origin(0, { done: { ok: false } }), V1).join(" ")).toMatch(/done.json ok false, want true/);
    expect(r3RepOriginProblems(0, origin(0, { N: 34, done: { cycles: 34 } }), V1).join(" ")).toMatch(/cycles 34, want 100.*b34-pre, but the history did not end/); // the copy before its extension
    expect(r3RepOriginProblems(18, origin(18, { done: { cycles: 2 } }), V1).join(" ")).toMatch(/want 1 cycle run through/);
    // every problem is listed, not only the first
    expect(r3RepOriginProblems(0, origin(0, { source: "x.blck.gz", seed: 1, mutRate: 0, done: null }), V1)).toHaveLength(4);
    expect(r3RepOriginProblems(0, undefined, V1)).toEqual(["no source record"]);
    expect(r3RepOriginProblems(0, { source: 3 }, V1, "donor").join(" ")).toMatch(/^donor has no path/);
  });

  it("takes an ended scaf or rand history's terminal b<e>-pre as its source, as its done.json says", () => {
    const ended = (h: number, e: number, endedAt = e) => origin(h, { N: e, done: { cycles: endedAt, ended: true, endedAt } });
    expect(r3RepBoundaryOf(0, "runs/scaffold/r3rep/main/scaf/i0/ckpt/b57-pre.blck.gz")).toBe(57);
    expect(r3RepOriginProblems(0, ended(0, 57), V1)).toEqual([]);
    expect(r3RepOriginProblems(7, ended(7, 35), V1)).toEqual([]);
    expect(r3RepOriginProblems(0, ended(0, 100), V1)).toEqual([]); // ended at the last boundary
    expect(r3RepOriginProblems(0, { ...ended(0, 57), step: 1_000_000 }, V1).join(" ")).toMatch(/source step 1000000, want 570000/);
    // the path and done.json must name the same boundary
    expect(r3RepOriginProblems(0, ended(0, 57, 58), V1).join(" ")).toMatch(/run ended at boundary 58, but the source is b57-pre/);
    expect(r3RepOriginProblems(0, origin(0, { done: { cycles: 57, ended: true, endedAt: 57 } }), V1).join(" ")).toMatch(/ended at boundary 57, but the source is b100-pre/);
    // cont has no cycle and never ends; the ancestor world runs its one cycle through
    expect(r3RepOriginProblems(12, ended(12, 57), V1).join(" ")).toMatch(/cont has no cycle/);
    expect(r3RepOriginProblems(18, origin(18, { done: { ended: true, endedAt: 1 } }), V1).join(" ")).toMatch(/\(ended\), want 1 cycle/);
  });

  it("validates a continuation's sidecar against the timing (a) source as it is now and the checkpoint beside it", () => {
    expect(r3RepSidecarPathOf("runs/scaffold/r3rep/cont200k/scaf-i0.blck.gz")).toBe("runs/scaffold/r3rep/cont200k/scaf-i0.json");
    expect(() => r3RepSidecarPathOf("runs/scaffold/r3rep/cont200k/scaf-i0.blck")).toThrow(/\.blck\.gz/);
    expect(r3RepContinuationPathOf(0)).toBe("r3rep/cont200k/scaf-i0.blck.gz");
    expect(r3RepContinuationPathOf(18)).toBe("r3rep/cont200k/ancestor.blck.gz");
    for (const h of [0, 9, 16, 18]) {
      const from = origin(h);
      const end = continued(h, from);
      const c = sidecarOf(h, from, end);
      expect(c).toMatchObject({ r3rep: true, h, source: from.source, sourceStateHash: from.stateHash, sourceSeed: from.seed, sourceStep: from.step, seed: 4_818_301 + h, steps: 200_000, mutRate: mut, endStateHash: end.stateHash, endStep: from.step + 200_000, protocolSha256R3rep: R3 });
      expect(r3RepContinuationProblems(h, c, from, end, R3)).toEqual([]);
    }
    const from = origin(2);
    const end = continued(2, from);
    const c = sidecarOf(2, from, end);
    // the source checkpoint has changed since the continuation read it
    expect(r3RepContinuationProblems(2, c, { ...from, stateHash: "f".repeat(16) }, end, R3).join(" ")).toMatch(/continuation sourceStateHash "a20{14}", want "f{16}"/);
    // another source path, seed or step
    expect(r3RepContinuationProblems(2, { ...c, source: "runs/scaffold/r3rep/main/scaf/i3/ckpt/b100-pre.blck.gz" }, from, end, R3).join(" ")).toMatch(/continuation source/);
    expect(r3RepContinuationProblems(2, { ...c, sourceStep: 990_000, endStep: 1_190_000 }, from, { ...end, step: 1_190_000 }, R3).join(" ")).toMatch(/continuation sourceStep 990000, want 1000000/);
    // wrong seed, steps or mutation rate
    expect(r3RepContinuationProblems(2, sidecarOf(2, from, { ...end, seed: 4_818_302 }), from, { ...end, seed: 4_818_302 }, R3).join(" ")).toMatch(/continuation seed 4818302, want 4818303/);
    expect(r3RepContinuationProblems(2, { ...c, steps: 100_000, endStep: 1_100_000 }, from, { ...end, step: 1_100_000 }, R3).join(" ")).toMatch(/continuation steps 100000, want 200000/);
    expect(r3RepContinuationProblems(2, sidecarOf(2, from, { ...end, mutRate: 1 }), from, { ...end, mutRate: 1 }, R3).join(" ")).toMatch(/continuation mutRate 1, want 429497/);
    expect(r3RepContinuationProblems(2, { ...c, endStep: 1_000_001 }, from, { ...end, step: 1_000_001 }, R3).join(" ")).toMatch(/endStep 1000001 is not sourceStep 1000000 \+ steps 200000/);
    // the checkpoint beside it is not the one it wrote
    expect(r3RepContinuationProblems(2, c, from, { ...end, stateHash: "d".repeat(16) }, R3).join(" ")).toMatch(/the continued checkpoint's stateHash "d{16}" is not the continuation's endStateHash/);
    expect(r3RepContinuationProblems(2, c, from, { ...end, step: 1_000_000 }, R3).join(" ")).toMatch(/the continued checkpoint's step 1000000 is not the continuation's endStep 1200000/);
    expect(r3RepContinuationProblems(2, c, from, { ...end, seed: 4_811_003 }, R3).join(" ")).toMatch(/the continued checkpoint's seed 4811003/);
    // another world's sidecar, another protocol document, or none
    expect(r3RepContinuationProblems(3, c, from, end, R3).join(" ")).toMatch(/continuation history 2, want 3.*continuation h 2, want 3/);
    expect(r3RepContinuationProblems(2, c, from, end, "4".repeat(64)).join(" ")).toMatch(/protocolSha256R3rep "3{64}", want "4{64}"/);
    expect(r3RepContinuationProblems(2, { ...c, r3rep: undefined }, from, end, R3).join(" ")).toMatch(/continuation r3rep undefined, want true/);
    expect(r3RepContinuationProblems(2, null, from, end, R3)).toEqual(["no continuation sidecar (the <checkpoint>.json that continue --r3rep writes last)"]);
    expect(r3RepContinuationProblems(2, c, null, end, R3).join(" ")).toMatch(/source checkpoint was not read/);
    // what continue --r3rep itself checks before it runs
    expect(r3RepContinueProblems(2, { seed: 4_818_303, steps: 200_000, censusEvery: 100, out: "runs/scaffold/r3rep/cont200k/scaf-i2.blck.gz" })).toEqual([]);
    expect(r3RepContinueProblems(18, { seed: 4_818_319, steps: 200_000, censusEvery: 100, out: "r3rep/cont200k/ancestor.blck.gz" })).toEqual([]);
    expect(r3RepContinueProblems(2, { seed: assaySeed(0, 2, 1, 0, 0), steps: 20_000, censusEvery: 10, out: "runs/scaffold/cont200k/scaf-i2.blck.gz" })).toEqual([
      `seed ${assaySeed(0, 2, 1, 0, 0)}, want r3RepContinueSeed(2) = 4818303`,
      "steps 20000, want 200000",
      "census every 10, want 100",
      'output "runs/scaffold/cont200k/scaf-i2.blck.gz" does not end in r3rep/cont200k/scaf-i2.blck.gz',
    ]);
  });

  it("checks a set's whole provenance: timing a and b sources, Ge-on-Fa's ancestor fragments and donor, and no donor elsewhere", () => {
    const dom = r3RepDominantRecord(dominantGenome(blobSource(2)));
    // timing a: the source itself; Ge-on-Fa's source is the ancestor's (a) and its donor the scaf history's (a)
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "fragment", origin(4), sha)).toEqual([]);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "quenched", origin(4), sha)).toEqual([]);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ae", origin(4), sha)).toEqual([]);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(18), donor: { ...origin(4), dominant: dom } }, sha)).toEqual([]);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(18), donor: { ...origin(4), dominant: null } }, sha)).toEqual([]); // the biological record
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(4), donor: { ...origin(4), dominant: dom } }, sha).join(" ")).toMatch(/^source path .* does not end in r3rep\/anc\/ckpt\/b1-pre/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(18), donor: { ...origin(5), dominant: dom } }, sha).join(" ")).toMatch(/donor path .* does not end in r3rep\/main\/scaf\/i4/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", origin(18), sha).join(" ")).toMatch(/no donor record/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(18), donor: { ...origin(4), dominant: { ...dom!, id: "9:9" } } }, sha).join(" ")).toMatch(/not a dominant genome record/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ea", { ...origin(18), donor: { ...origin(4), dominant: { ...dom!, words: "00" } } }, sha).join(" ")).toMatch(/not a dominant genome record/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "swap-ae", { ...origin(4), donor: { ...origin(4), dominant: dom } }, sha).join(" ")).toMatch(/names a genome donor, but swap-ae has none/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "fragment", undefined, sha)).toEqual(["assay.json has no provenance of its source (run the assay with --r3rep)"]);
    // timing b: the continued checkpoint, its sidecar and the timing (a) source the sidecar names
    for (const [h, inoculum] of [[4, "fragment"], [4, "quenched"], [10, "fragment"], [18, "fragment"]] as const) {
      const from = origin(h);
      const end = continued(h, from);
      const prov = { ...end, continuation: sidecarOf(h, from, end), origin: from };
      expect(r3RepProvenanceProblems(r3RepLabelsOf(h, "b"), inoculum, prov, sha)).toEqual([]);
    }
    const from = origin(4);
    const end = continued(4, from);
    const prov = { ...end, continuation: sidecarOf(4, from, end), origin: from };
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", { ...prov, source: "runs/scaffold/cont200k/scaf-i4.blck.gz" }, sha).join(" ")).toMatch(/source path .* does not end in r3rep\/cont200k\/scaf-i4\.blck\.gz/); // v1's continuation
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", { ...prov, continuation: null }, sha).join(" ")).toMatch(/no continuation sidecar/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", { ...prov, origin: origin(4, { done: null }) }, sha).join(" ")).toMatch(/continuation source run has no readable done.json/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", { ...prov, stateHash: "d".repeat(16) }, sha).join(" ")).toMatch(/endStateHash/);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", prov, { ...sha, r3rep: "4".repeat(64) }).join(" ")).toMatch(/protocolSha256R3rep/);
    // a timing a set given a timing b source, and the reverse
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "a"), "fragment", prov, sha).length).toBeGreaterThan(0);
    expect(r3RepProvenanceProblems(r3RepLabelsOf(4, "b"), "fragment", origin(4), sha).length).toBeGreaterThan(0);
  });

  it("records checkpoints, run records and the dominant genome from their state and files", () => {
    const s = blobSource(2);
    expect(r3RepCheckpointOf("p/ckpt/b1-pre.blck.gz", s)).toEqual({ source: "p/ckpt/b1-pre.blck.gz", stateHash: stateHash(s), seed: 7, mutRate: 0, step: 0, tilesX: 2, tilesY: 2 });
    expect(r3RepRunRecordOf({ arm: "scaf", seed: 1, Mr: [1, 2], config: {} }, { ok: true, cycles: 100, ended: false, wallSeconds: 3 })).toEqual({ meta: { arm: "scaf", seed: 1 }, done: { ok: true, cycles: 100, ended: false } });
    expect(r3RepRunRecordOf(null, [1])).toEqual({ meta: null, done: null });
    const dom = dominantGenome(s)!;
    const rec = r3RepDominantRecord(dom)!;
    expect(rec).toEqual({ id: `${dom.hi}:${dom.lo}`, hi: dom.hi, lo: dom.lo, words: Array.from(dom.words, (x) => x.toString(16).padStart(8, "0")).join("") });
    expect(rec.words).toHaveLength(8 * GENOME_CHANNELS);
    expect(r3RepDominantRecord(dominantGenome(emptyWorld(2)))).toBeNull();
  });

  it("validates a biologically unavailable Ge-on-Fa record: swap-ea of a scaf history at a, a donor with no dominant genome, no rows", () => {
    const donor = { ...origin(1), dominant: null };
    const json = { labels: r3RepLabelsOf(1, "a"), inoculum: "swap-ea", provenance: { ...origin(18), donor }, biologicallyUnavailable: r3RepUnavailableOf(donor), summary: { rows: 0, competence: null } };
    expect(JSON.parse(JSON.stringify(json.biologicallyUnavailable))).toEqual({ reason: "no dominant genome", donor: donor.source, donorStateHash: donor.stateHash });
    expect(r3RepUnavailableProblems(JSON.parse(JSON.stringify(json)))).toEqual([]);
    expect(r3RepUnavailableProblems({ ...json, inoculum: "swap-ae" }).join(" ")).toMatch(/only Ge-on-Fa/);
    expect(r3RepUnavailableProblems({ ...json, labels: r3RepLabelsOf(7, "a") }).join(" ")).toMatch(/not rand/);
    expect(r3RepUnavailableProblems({ ...json, summary: { rows: 128 } }).join(" ")).toMatch(/summary.rows 128, want 0/);
    expect(r3RepUnavailableProblems({ ...json, provenance: { ...origin(18), donor: { ...donor, dominant: r3RepDominantRecord(dominantGenome(blobSource(2))) } } }).join(" ")).toMatch(/dominant .* want null/);
    expect(r3RepUnavailableProblems({ ...json, biologicallyUnavailable: { ...json.biologicallyUnavailable, donorStateHash: "x" } }).join(" ")).toMatch(/biologicallyUnavailable/);
    expect(r3RepUnavailableProblems({ ...json, provenance: origin(18) }).join(" ")).toMatch(/no donor/);
  });

  it("checks each variant's recorded treatment against its provenance: Ge-on-Fa's words its donor's dominant genome, Ga-on-Fe's M3_FOUNDERS[2]'s", () => {
    const hex = (w: Uint32Array) => Array.from(w, (x) => x.toString(16).padStart(8, "0")).join("");
    expect(R3REP_SWAP_AE_WORDS).toBe(hex(encodeGenome(founderGenome(M3_FOUNDERS[2]), 0, 1))); // what --swap-founder 2 plants
    const dom = r3RepDominantRecord(dominantGenome(blobSource(2)))!;
    const ea = { ...origin(18), donor: { ...origin(4), dominant: dom } };
    // as competence --r3rep writes each variant
    const sets: Record<string, unknown>[] = [
      { inoculum: "fragment", quench: false, swap: null, provenance: origin(4) },
      { inoculum: "quenched", quench: true, swap: null, provenance: origin(4) },
      { inoculum: "swap-ae", quench: false, swap: { label: "swap-ae", from: "M3_FOUNDERS[2]", words: R3REP_SWAP_AE_WORDS }, provenance: origin(4) },
      { inoculum: "swap-ea", quench: false, swap: { label: "swap-ea", from: `x (dominant ${dom.id})`, words: dom.words }, provenance: ea },
      { inoculum: "swap-ea", quench: false, swap: { label: "swap-ea", from: "x", words: null }, provenance: { ...ea, donor: { ...ea.donor, dominant: null } }, biologicallyUnavailable: r3RepUnavailableOf(ea.donor) },
    ];
    for (const json of sets) expect(r3RepTreatmentProblems(json)).toEqual([]);
    const [fragment, quenched, ae, eaSet, bio] = sets;
    // (A) Ge-on-Fa with rows and a donor that records no dominant genome
    expect(r3RepTreatmentProblems({ ...eaSet, provenance: { ...ea, donor: { ...ea.donor, dominant: null } } }).join(" ")).toMatch(/^provenance\.donor\.dominant null: a Ge-on-Fa set with rows plants its donor's dominant genome/);
    expect(r3RepTreatmentProblems({ ...eaSet, provenance: origin(18) }).join(" ")).toMatch(/^provenance\.donor\.dominant undefined/);
    // (B) planted words other than the donor's dominant genome
    expect(r3RepTreatmentProblems({ ...eaSet, swap: { label: "swap-ea", from: "x", words: R3REP_SWAP_AE_WORDS } })).toEqual([`swap words are not the donor's dominant genome ${dom.id} (provenance.donor.dominant.words)`]);
    expect(r3RepTreatmentProblems({ ...eaSet, swap: { ...(eaSet.swap as object), label: "swap-ae" } }).join(" ")).toMatch(/want the swap-ea genome it planted/);
    expect(r3RepTreatmentProblems({ ...bio, swap: { label: "swap-ea", from: "x", words: dom.words } })).toEqual(["swap words are recorded, but a biologically unavailable record plants no genome (words null)"]);
    // Ga-on-Fe, the quenched control and the source's own fragments
    expect(r3RepTreatmentProblems({ ...ae, swap: { label: "swap-ae", from: "M3_FOUNDERS[1]", words: hex(encodeGenome(founderGenome(M3_FOUNDERS[1]), 0, 1)) } })).toEqual(["swap words are not M3_FOUNDERS[2]'s: Ga-on-Fe plants the ancestor's genome and nothing else"]);
    expect(r3RepTreatmentProblems({ ...ae, swap: null }).join(" ")).toMatch(/^swap null, want the swap-ae genome it planted/);
    expect(r3RepTreatmentProblems({ ...ae, quench: true })).toEqual(["quench true, want false for swap-ae"]);
    expect(r3RepTreatmentProblems({ ...quenched, quench: false })).toEqual(["quench false, want true for quenched"]);
    expect(r3RepTreatmentProblems({ ...quenched, swap: ae.swap }).join(" ")).toMatch(/want null: quenched plants no swapped genome/);
    expect(r3RepTreatmentProblems({ ...fragment, quench: true })).toEqual(["quench true, want false for fragment"]);
    expect(r3RepTreatmentProblems({ ...fragment, swap: undefined }).join(" ")).toMatch(/^swap undefined, want null/);
    expect(r3RepTreatmentProblems({ ...fragment, inoculum: "disc" })).toEqual([]); // r3RepVariantProblems says why
  });

  it("pins the protocol documents: each still begins with its pinned text, which an amendment at the end keeps", async () => {
    expect(R3REP_SHA256).toEqual({ protocol: R3REP_PROTOCOLS.protocol.sha256, r3rep: R3REP_PROTOCOLS.r3rep.sha256 });
    for (const which of ["r3rep", "protocol"] as const) {
      const pin = R3REP_PROTOCOLS[which];
      const doc = new Uint8Array(readFileSync(fileURLToPath(new URL(`../../${pin.doc}`, import.meta.url))));
      expect(createHash("sha256").update(doc.subarray(0, pin.bytes)).digest("hex")).toBe(pin.sha256);
      expect(await r3RepProtocolProblems(which, doc)).toEqual([]);
      const amended = new Uint8Array([...doc, ...new TextEncoder().encode("\n## Amendment 3 (2026-10-02)\n\nA dated amendment at the end.\n")]);
      expect(await r3RepProtocolProblems(which, amended)).toEqual([]);
      const edited = doc.slice();
      edited[200] ^= 1;
      expect((await r3RepProtocolProblems(which, edited)).join(" ")).toMatch(new RegExp(`^${pin.doc.replace(/[.]/g, "\\.")} no longer begins with its pinned text \\(SHA-256 ${pin.sha256}; its first ${pin.bytes} bytes hash to [0-9a-f]{64}\\)`));
      expect(await r3RepProtocolProblems(which, doc.subarray(0, 100))).toEqual([`${pin.doc} has 100 bytes, fewer than the ${pin.bytes} it had when pinned`]);
    }
  });
});
