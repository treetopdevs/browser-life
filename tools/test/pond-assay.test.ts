import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  NN_WORDS,
  PRESETS,
  buildWorld,
  cellCount,
  encodeCheckpoint,
  encodeGenome,
  founderGenome,
  initWorld,
  presetIdentity,
  stateHash,
  validateState,
  worldW,
  type WorldState,
} from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
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
  REG1_CAPABILITY_LABELS,
  REG1_CONTINUE_SEED_MAX,
  REG1_DEVICE_SEED,
  REG1_GARDEN_SEED_MAX,
  REG1_HEREDITY_SEED_MAX,
  REG1_PONDS_IDENTITY,
  REG1_PROTOCOL,
  REG1_REGIME,
  REG1_REPRO_SEED,
  REG1_S1_BOOTSTRAP_SEED,
  REG1_SEED_BLOCK,
  REG1_SEED_MAX,
  REG1_SHA256,
  REG1_SOURCES,
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
  checkReg1DonorSeed,
  checkReg1Seeds,
  checkTauSeeds,
  distinctGenomes,
  fragmentDominant,
  loadReg1Source,
  parseR1PrimeLabels,
  parseR1dPrimeLabels,
  parseR3RepContinueLabels,
  parseR3RepLabels,
  parseReg1CompetenceLabels,
  parseReg1ContinueLabels,
  parseReg1GardenLabels,
  parseReg1HeredityLabels,
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
  reg1AssayDirOf,
  reg1AssayOutProblems,
  reg1BoundaryAOf,
  reg1BundleDirOf,
  reg1BundleWantOf,
  reg1BundleWantsOf,
  reg1CapabilitySources,
  reg1CompetenceLabelsOf,
  reg1ContinuationOf,
  reg1ContinuationPathOf,
  reg1ContinuationProblems,
  reg1ContinueProblems,
  reg1ContinueSeed,
  reg1ControlPathOf,
  reg1ControlProblems,
  reg1DonorSeedOf,
  reg1ExpectedSets,
  reg1GardenLabelsOf,
  reg1GardenSeed,
  reg1H,
  reg1HereditySeed,
  reg1HeredityLabelsOf,
  reg1HistoryOf,
  reg1InitialWorld,
  reg1LabelsFromJson,
  reg1NegativeRunProblems,
  reg1NegativeSeed,
  reg1NegativeWorldOf,
  reg1PreCycleFileOf,
  reg1ProtocolProblems,
  reg1ProvenanceProblems,
  reg1RegimeProblems,
  reg1ReplicatesOf,
  reg1Seed,
  reg1SeedsOf,
  reg1SetIdOf,
  reg1SourceProblems,
  reg1WaiverOutProblems,
  reg1WorldSeedOf,
  standardFragment,
  swapGenome,
  traitsTable,
  type AssayItem,
  type Fragment,
  type R3RepCheckpoint,
  type R3RepOrigin,
  type Reg1BundleWant,
  type Reg1LabelSet,
  type Reg1Source,
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

describe("the scaffolding registration's seeds, labels and sources (docs/scaffold-registration-v1.md)", () => {
  const mut = pondConfig(8, 0).mutRate;
  const REG = "5".repeat(64); // a stand-in for the registration's SHA-256 in a sidecar

  it("is the document's seed block: worlds, continuations, competence, S2 and S3 at their corners and maxima", () => {
    // source worlds by h: 24 arm + i for the histories, 72 + i for the ancestor worlds
    expect([reg1H("scaf", 0), reg1H("scaf", 23), reg1H("rand", 0), reg1H("cont", 23), reg1H("ancestor", 0), reg1H("ancestor", 23)]).toEqual([0, 23, 24, 71, 72, 95]);
    for (let h = 0; h < REG1_SOURCES; h++) {
      const l = reg1HistoryOf(h);
      expect(reg1H(l.arm, l.history)).toBe(h);
    }
    expect(reg1HistoryOf(30)).toEqual({ arm: "rand", history: 6, h: 30 });
    expect(reg1HistoryOf(77)).toEqual({ arm: "ancestor", history: 5, h: 77 });
    expect([0, 23, 24, 47, 48, 71, 72, 95].map(reg1WorldSeedOf)).toEqual([4_850_001, 4_850_024, 4_850_101, 4_850_124, 4_850_201, 4_850_224, 4_850_401, 4_850_424]);
    expect([reg1ContinueSeed(0), reg1ContinueSeed(72), reg1ContinueSeed(95)]).toEqual([4_850_501, 4_850_573, 4_850_596]);
    expect(REG1_CONTINUE_SEED_MAX).toBe(4_850_596);
    // σ(h, t, s): the swap pair's replicates 4-7 exist only at an ancestor world's (a)
    expect([reg1Seed(0, 0, 0), reg1Seed(0, 1, 0), reg1Seed(0, 0, 3), reg1Seed(1, 0, 0), reg1Seed(72, 0, 7), reg1Seed(95, 0, 7), reg1Seed(95, 1, 3)]).toEqual([4_851_001, 4_851_011, 4_851_004, 4_851_101, 4_858_208, 4_860_508, 4_860_514]);
    expect(REG1_SEED_MAX).toBe(4_860_514);
    expect([reg1GardenSeed(0, 0, 0, 0), reg1GardenSeed(0, 1, 0, 0), reg1GardenSeed(0, 0, 1, 0), reg1GardenSeed(0, 0, 0, 1), reg1GardenSeed(47, 1, 1, 1)]).toEqual([4_861_001, 4_861_021, 4_861_011, 4_861_002, 4_865_732]);
    expect(REG1_GARDEN_SEED_MAX).toBe(4_865_732);
    expect([reg1HereditySeed(0, 0), reg1HereditySeed(0, 9), reg1HereditySeed(1, 0), reg1HereditySeed(53, 9)]).toEqual([4_866_001, 4_866_010, 4_866_251, 4_879_260]);
    expect(REG1_HEREDITY_SEED_MAX).toBe(4_879_260);
    expect([0, 1, 2, 3].map(reg1NegativeSeed)).toEqual([4_880_001, 4_880_002, 4_880_003, 4_880_004]);
    expect([4_880_000, 4_880_001, 4_880_004, 4_880_005, 4_811_201].map(reg1NegativeWorldOf)).toEqual([null, 0, 3, null, null]);
    expect([REG1_REPRO_SEED, REG1_S1_BOOTSTRAP_SEED, REG1_DEVICE_SEED]).toEqual([4_880_101, 4_880_201, 4_880_301]);
    expect(REG1_REGIME).toEqual({ k: 8, period: 10_000, ref: 103_058, side: 8, censusEvery: 100 });
  });

  it("range-checks every field", () => {
    for (const h of [-1, 96, 1.5, NaN]) expect(() => reg1HistoryOf(h)).toThrow(/reg1HistoryOf/);
    for (const i of [-1, 24, 0.5]) expect(() => reg1H("scaf", i)).toThrow(/reg1H/);
    expect(() => reg1H("control" as "scaf", 0)).toThrow(/arm must be/);
    for (const h of [-1, 96, NaN]) expect(() => reg1ContinueSeed(h)).toThrow(/reg1ContinueSeed/);
    for (const [h, t, s] of [[96, 0, 0], [-1, 0, 0], [0, 2, 0], [0, 0, 4], [71, 0, 4], [72, 1, 4], [72, 0, 8], [0, 0, -1], [0.5, 0, 0], [0, 0, NaN]] as const) expect(() => reg1Seed(h, t, s)).toThrow(/reg1Seed/);
    for (const [h, t, v, s] of [[48, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 2], [-1, 0, 0, 0], [0, 0, 0, 0.5]] as const) expect(() => reg1GardenSeed(h, t, v, s)).toThrow(/reg1GardenSeed/);
    for (const [h, s] of [[54, 0], [-1, 0], [0, 10], [0, -1], [1.5, 0], [0, 2], [0, 3], [0, 7], [0, 1.5]] as const) expect(() => reg1HereditySeed(h, s)).toThrow(/reg1HereditySeed/);
    expect(() => reg1HereditySeed(0, 4)).toThrow(/s must be 0-1 \(replicates\), 8 \(permutations\) or 9 \(donors\), got 4/);
    for (const j of [-1, 4, 0.5]) expect(() => reg1NegativeSeed(j)).toThrow(/reg1NegativeSeed/);
  });

  it("cannot collide with itself or with any earlier block, and stays inside 4,850,001-4,899,999", () => {
    const worlds = Array.from({ length: REG1_SOURCES }, (_, h) => reg1WorldSeedOf(h));
    const cont = Array.from({ length: REG1_SOURCES }, (_, h) => reg1ContinueSeed(h));
    const comp: number[] = [];
    for (let h = 0; h < REG1_SOURCES; h++) for (let t = 0; t <= 1; t++) for (let s = 0; s <= (h >= 72 && t === 0 ? 7 : 3); s++) comp.push(reg1Seed(h, t, s));
    expect(comp).toHaveLength(96 * 2 * 4 + 24 * 4);
    const garden: number[] = [];
    for (let h = 0; h < 48; h++) for (let t = 0; t <= 1; t++) for (let v = 0; v <= 1; v++) for (let s = 0; s <= 1; s++) garden.push(reg1GardenSeed(h, t, v, s));
    const heredity: number[] = [];
    for (let h = 0; h < 54; h++) for (const s of [0, 1, 8, 9]) heredity.push(reg1HereditySeed(h, s));
    const negative = [0, 1, 2, 3].map(reg1NegativeSeed);
    const other = [REG1_REPRO_SEED, REG1_S1_BOOTSTRAP_SEED, REG1_DEVICE_SEED];
    const blocks = [worlds, cont, comp, garden, heredity, negative, other];
    const all = blocks.flat();
    expect(new Set(all).size).toBe(all.length);
    for (const x of all) expect(x >= REG1_SEED_BLOCK.min && x <= REG1_SEED_BLOCK.max).toBe(true);
    // each formula's range lies below the next one's
    for (let k = 1; k < blocks.length; k++) expect(Math.max(...blocks[k - 1])).toBeLessThan(Math.min(...blocks[k]));
    // every earlier block's formulas and worlds
    const earlier = new Set<number>();
    for (let r = 0; r <= 4; r++) for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let v = 0; v <= 4; v++) for (let s = 0; s <= 9; s++) earlier.add(assaySeed(r, h, t, v, s));
    for (let h = 0; h <= 11; h++) for (let t = 0; t <= 2; t++) for (let s = 0; s <= 9; s++) earlier.add(r1PrimeSeed(h, t, s));
    for (let h = 0; h < R1DP_SETS; h++) for (let s = 0; s <= 9; s++) earlier.add(r1dPrimeSeed(h, s));
    for (let h = 0; h <= 18; h++) for (let t = 0; t <= 1; t++) for (let s = 0; s <= 1; s++) earlier.add(r3RepSeed(h, t, s));
    for (let h = 0; h <= 18; h++) earlier.add(r3RepContinueSeed(h)), earlier.add(r3RepWorldSeedOf(h));
    for (let s = 0; s <= 9; s++) earlier.add(TAU_SEED_BASE + s);
    for (let g = 0; g <= 14; g++) for (let s = 0; s <= 9; s++) earlier.add(4_800_001 + 100 * g + s); // P1
    for (let x = 4_802_001; x <= 4_802_022; x++) earlier.add(x); // calibration
    for (const x of [4_805_001, 4_805_002]) earlier.add(x); // P2 ranking worlds
    for (let arm = 0; arm <= 1; arm++) for (let s = 0; s <= 1; s++) earlier.add(4_805_101 + 10 * arm + s); // P2 selection runs
    for (let arm = 0; arm <= 2; arm++) for (let i = 0; i <= 5; i++) earlier.add(4_810_001 + 100 * arm + i); // main run
    for (let j = 0; j <= 3; j++) earlier.add(4_811_201 + j); // R1'''s negative-control worlds
    expect(Math.max(...earlier)).toBeLessThan(REG1_SEED_BLOCK.min);
    for (const x of all) expect(earlier.has(x)).toBe(false);
  });

  it("labels every set of the table, and its flags, seeds, regime and directory check out", () => {
    const sets = reg1ExpectedSets();
    expect(sets).toHaveLength(24 * 23 + 7);
    const ids = sets.map(reg1SetIdOf);
    expect(new Set(ids).size).toBe(sets.length);
    const count = (set: string) => sets.filter((l) => l.set === set).length;
    expect(["source", "ge-on-fa", "ga-on-fa", "ga-on-fe", "quench", "garden-raw", "garden-disc", "heredity", "capability"].map(count)).toEqual([192, 24, 24, 24, 48, 96, 96, 54, 1]);
    expect(ids.slice(0, 23)).toEqual([
      "scaf-i00-a", "scaf-i00-b", "rand-i00-a", "rand-i00-b", "cont-i00-a", "cont-i00-b", "ancestor-i00-a", "ancestor-i00-b",
      "scaf-i00-ge-on-fa", "scaf-i00-ga-on-fa", "scaf-i00-ga-on-fe", "scaf-i00-quench-a", "scaf-i00-quench-b",
      "garden-scaf-i00-t0-raw", "garden-scaf-i00-t0-disc", "garden-scaf-i00-t1-raw", "garden-scaf-i00-t1-disc",
      "garden-rand-i00-t0-raw", "garden-rand-i00-t0-disc", "garden-rand-i00-t1-raw", "garden-rand-i00-t1-disc",
      "heredity-scaf-i00", "heredity-rand-i00",
    ]);
    expect(ids.slice(-7)).toEqual(["heredity-pos-s0", "heredity-pos-s1", "heredity-neg-j0", "heredity-neg-j1", "heredity-neg-j2", "heredity-neg-j3", "capability"]);
    expect(ids).toContain("ancestor-i23-b");
    for (const l of sets) {
      expect(Object.keys(l)).toEqual(["reg1", "set", "arm", "history", "timing", "time", "h", "control"]);
      expect(reg1LabelsFromJson(JSON.parse(JSON.stringify(l)))).toEqual({ labels: l });
      expect(reg1AssayOutProblems(l, `runs/${reg1AssayDirOf(l)}`)).toEqual([]);
      if (l.set === "capability") continue;
      // the CLI flags of the set parse back to its labels
      const parsed =
        l.set === "heredity"
          ? parseReg1HeredityLabels({ h: String(l.h), arm: l.arm!, history: l.control === null ? String(l.history) : undefined, control: l.control ?? undefined })
          : l.set === "garden-raw" || l.set === "garden-disc"
            ? parseReg1GardenLabels({ arm: l.arm!, history: String(l.history), time: String(l.time), inoculum: l.set === "garden-disc" ? "disc" : "fragment" })
            : parseReg1CompetenceLabels({ set: l.set, arm: l.arm!, history: String(l.history), timing: l.timing!, h: String(l.h) });
      expect(parsed).toEqual(l);
      const reps = reg1ReplicatesOf(l);
      for (let s = 0; s < reps; s++) expect(() => checkReg1Seeds(l, reg1SeedsOf(l, s), s)).not.toThrow();
      expect(reg1RegimeProblems(l, { ...REG1_REGIME, ref: l.set === "heredity" ? null : REG1_REGIME.ref, replicates: reps })).toEqual([]);
    }
    // h is the seed index (and the fragment source): the swap pair carries ancestor world i's, Ga-on-Fe and the quenched controls scaf_i's
    const ea = reg1CompetenceLabelsOf("ge-on-fa", "scaf", 5, "a");
    expect(ea).toEqual({ reg1: true, set: "ge-on-fa", arm: "scaf", history: 5, timing: "a", time: null, h: 77, control: null });
    expect(reg1CompetenceLabelsOf("ga-on-fa", "scaf", 5, "a").h).toBe(77);
    expect(reg1CompetenceLabelsOf("ga-on-fe", "scaf", 5, "a").h).toBe(5);
    expect(reg1CompetenceLabelsOf("quench", "scaf", 5, "b").h).toBe(5);
    expect(reg1CompetenceLabelsOf("source", "cont", 5, "b").h).toBe(53);
    expect(reg1CompetenceLabelsOf("source", "ancestor", 5, "a")).toMatchObject({ arm: "ancestor", history: 5, h: 77 });
    for (let s = 0; s < 4; s++) {
      // the swap pair's first four replicates are ancestor world i's own fragments at (a); Ga-on-Fe and quench-a scaf_i's
      expect(reg1SeedsOf(ea, s)).toEqual(reg1SeedsOf(reg1CompetenceLabelsOf("source", "ancestor", 5, "a"), s));
      expect(reg1SeedsOf(reg1CompetenceLabelsOf("ga-on-fa", "scaf", 5, "a"), s)).toEqual(reg1SeedsOf(ea, s));
      expect(reg1SeedsOf(reg1CompetenceLabelsOf("ga-on-fe", "scaf", 5, "a"), s)).toEqual(reg1SeedsOf(reg1CompetenceLabelsOf("source", "scaf", 5, "a"), s));
      expect(reg1SeedsOf(reg1CompetenceLabelsOf("quench", "scaf", 5, "b"), s)).toEqual({ physics: reg1Seed(5, 1, s), fragment: reg1Seed(5, 1, s) });
    }
    expect(reg1SeedsOf(ea, 7)).toEqual({ physics: 4_858_708, fragment: 4_858_708 });
    // S2: the physics takes the inoculum's v, the fragments v = 0, so the disc inoculum plants the raw inoculum's fragments' genomes
    expect(reg1SeedsOf(reg1GardenLabelsOf("rand", 2, 1, "disc"), 1)).toEqual({ physics: reg1GardenSeed(26, 1, 1, 1), fragment: reg1GardenSeed(26, 1, 0, 1) });
    expect(reg1SeedsOf(reg1GardenLabelsOf("rand", 2, 1, "fragment"), 1)).toEqual({ physics: reg1GardenSeed(26, 1, 0, 1), fragment: reg1GardenSeed(26, 1, 0, 1) });
    // S3 and R4
    expect(reg1HeredityLabelsOf(49)).toEqual({ reg1: true, set: "heredity", arm: "control", history: null, timing: null, time: null, h: 49, control: "positive" });
    expect(reg1HeredityLabelsOf(50)).toMatchObject({ arm: "control", history: null, control: "negative" });
    expect(reg1HeredityLabelsOf(31)).toMatchObject({ arm: "rand", history: 7, control: null });
    expect(reg1DonorSeedOf(reg1HeredityLabelsOf(31))).toBe(reg1HereditySeed(31, 9));
    expect(REG1_CAPABILITY_LABELS).toEqual({ reg1: true, set: "capability", arm: null, history: null, timing: "a", time: null, h: null, control: null });
    expect(() => reg1SeedsOf(REG1_CAPABILITY_LABELS, 0)).toThrow(/capability/);
  });

  it("refuses a mismatched set: a swap set on its history's seeds, the wrong replicates, the wrong timing or time, and flags that disagree", () => {
    const at = (seed: number) => ({ physics: seed, fragment: seed });
    const ea = reg1CompetenceLabelsOf("ge-on-fa", "scaf", 5, "a");
    const aa = reg1CompetenceLabelsOf("ga-on-fa", "scaf", 5, "a");
    const ae = reg1CompetenceLabelsOf("ga-on-fe", "scaf", 5, "a");
    // a wrong h for a swap set: the swap pair takes ancestor world i's seeds, Ga-on-Fe scaf_i's
    expect(() => checkReg1Seeds(ea, at(reg1Seed(5, 0, 0)), 0)).toThrow(/does not match the reg1 labels \(scaf-i05-ge-on-fa, h 77\): want 4858701/);
    expect(() => checkReg1Seeds(aa, at(reg1Seed(5, 0, 0)), 0)).toThrow(/want 4858701/);
    expect(() => checkReg1Seeds(ae, at(reg1Seed(77, 0, 0)), 0)).toThrow(/want 4851501/);
    expect(() => checkReg1Seeds(ea, { physics: reg1Seed(77, 0, 0), fragment: reg1Seed(77, 0, 1) }, 0)).toThrow(/^fragment seed/);
    // the wrong replicate counts
    expect(reg1RegimeProblems(ea, { ...REG1_REGIME, replicates: 4 })).toEqual(["replicates 4, want 8"]);
    expect(reg1RegimeProblems(aa, { ...REG1_REGIME, replicates: 2 })).toEqual(["replicates 2, want 8"]);
    expect(reg1RegimeProblems(ae, { ...REG1_REGIME, replicates: 8 })).toEqual(["replicates 8, want 4"]);
    expect(reg1RegimeProblems(reg1GardenLabelsOf("scaf", 0, 0, "disc"), { ...REG1_REGIME, replicates: 4 })).toEqual(["replicates 4, want 2"]);
    expect(reg1RegimeProblems(reg1HeredityLabelsOf(0), { ...REG1_REGIME, replicates: 2 })).toEqual(["ref 103058, want null"]);
    expect(reg1RegimeProblems(ae, { k: 5, period: 3000, ref: null, side: 2, replicates: 2, censusEvery: 1000 })).toHaveLength(6);
    expect(() => checkReg1Seeds(reg1CompetenceLabelsOf("source", "scaf", 5, "a"), at(reg1Seed(5, 0, 3) + 1), 4)).toThrow(/reg1Seed: s must be an integer in 0..3/);
    // the wrong t: (b) and time C take their own seeds
    expect(() => checkReg1Seeds(reg1CompetenceLabelsOf("quench", "scaf", 5, "b"), at(reg1Seed(5, 0, 0)), 0)).toThrow(/want 4851511/);
    expect(() => checkReg1Seeds(reg1CompetenceLabelsOf("source", "ancestor", 5, "b"), at(reg1Seed(77, 0, 0)), 0)).toThrow(/want 4858711/);
    const g = reg1GardenLabelsOf("rand", 2, 1, "disc");
    expect(() => checkReg1Seeds(g, { physics: reg1GardenSeed(26, 1, 1, 0), fragment: reg1GardenSeed(26, 1, 0, 0) }, 0)).not.toThrow();
    expect(() => checkReg1Seeds(g, { physics: reg1GardenSeed(26, 0, 1, 0), fragment: reg1GardenSeed(26, 0, 0, 0) }, 0)).toThrow(/does not match/); // time 0's
    expect(() => checkReg1Seeds(g, at(reg1GardenSeed(26, 1, 0, 0)), 0)).toThrow(/^seed/); // the raw inoculum's physics
    expect(() => checkReg1Seeds(g, at(reg1GardenSeed(26, 1, 1, 0)), 0)).toThrow(/^fragment seed/);
    // S3's donors, and earlier blocks' seeds of the same index
    expect(() => checkReg1DonorSeed(reg1HeredityLabelsOf(30), reg1HereditySeed(30, 9))).not.toThrow();
    expect(() => checkReg1DonorSeed(reg1HeredityLabelsOf(30), reg1HereditySeed(30, 8))).toThrow(/donor seed/);
    expect(() => reg1DonorSeedOf(ea)).toThrow(/S3/);
    expect(() => checkReg1Seeds(reg1CompetenceLabelsOf("source", "scaf", 3, "a"), at(r3RepSeed(3, 0, 0)), 0)).toThrow(/does not match/);
    expect(() => checkReg1Seeds(reg1HeredityLabelsOf(3), at(r1dPrimeSeed(3, 0)), 0)).toThrow(/does not match/);
    // competence flags
    expect(parseReg1CompetenceLabels({ set: "ge-on-fa", arm: "scaf", history: "5", timing: "a", h: "77" })).toEqual(ea);
    expect(() => parseReg1CompetenceLabels({ set: "ge-on-fa", arm: "scaf", history: "5", timing: "a", h: "5" })).toThrow(/--h 5 disagrees .*here 77/);
    expect(() => parseReg1CompetenceLabels({ set: "swap-ea", arm: "scaf", history: "0", timing: "a" })).toThrow(/--set must be/);
    expect(() => parseReg1CompetenceLabels({ arm: "scaf", history: "0", timing: "a" })).toThrow(/--set must be/);
    expect(() => parseReg1CompetenceLabels({ set: "ge-on-fa", arm: "ancestor", history: "0", timing: "a" })).toThrow(/--arm must be scaf/);
    expect(() => parseReg1CompetenceLabels({ set: "quench", arm: "rand", history: "0", timing: "a" })).toThrow(/--arm must be scaf/);
    expect(() => parseReg1CompetenceLabels({ set: "ge-on-fa", arm: "scaf", history: "0", timing: "b" })).toThrow(/ge-on-fa runs at timing a only/);
    expect(() => parseReg1CompetenceLabels({ set: "ga-on-fe", arm: "scaf", history: "0", timing: "b" })).toThrow(/ga-on-fe runs at timing a only/);
    expect(() => parseReg1CompetenceLabels({ set: "source", arm: "scaf", history: "24", timing: "a" })).toThrow(/--history must be 0-23/);
    expect(() => parseReg1CompetenceLabels({ set: "source", arm: "ancestor", timing: "a" })).toThrow(/--history/);
    expect(() => parseReg1CompetenceLabels({ set: "source", arm: "scaf", history: "0" })).toThrow(/--timing/);
    expect(() => parseReg1CompetenceLabels({ set: "source", arm: "scaf", history: "0", timing: "a", time: "0" })).toThrow(/--time/);
    expect(() => parseReg1CompetenceLabels({ set: "source", arm: "scaf", history: "0", timing: "a", control: "positive" })).toThrow(/--control/);
    // continue, S2 and S3 flags
    expect(parseReg1ContinueLabels({ arm: "ancestor", history: "3" })).toEqual(reg1HistoryOf(75));
    expect(parseReg1ContinueLabels({ arm: "rand", history: "3", h: "27" })).toEqual(reg1HistoryOf(27));
    expect(() => parseReg1ContinueLabels({ arm: "rand", history: "3", h: "3" })).toThrow(/--h 3 disagrees/);
    expect(() => parseReg1ContinueLabels({ arm: "scaf", history: "3", timing: "b" })).toThrow(/--timing/);
    expect(() => parseReg1ContinueLabels({ arm: "scaf", history: "3", set: "source" })).toThrow(/--set/);
    expect(() => parseReg1GardenLabels({ arm: "cont", history: "0", time: "0", inoculum: "disc" })).toThrow(/--arm must be scaf\|rand/);
    expect(() => parseReg1GardenLabels({ arm: "scaf", history: "0", time: "2", inoculum: "disc" })).toThrow(/--time/);
    expect(() => parseReg1GardenLabels({ arm: "scaf", history: "0", time: "0", inoculum: "raw" })).toThrow(/--inoculum/);
    expect(() => parseReg1GardenLabels({ arm: "scaf", history: "0", timing: "a", inoculum: "disc" })).toThrow(/--timing/);
    expect(() => parseReg1HeredityLabels({ h: "54", arm: "control", control: "negative" })).toThrow(/--h must be 0-53/);
    expect(() => parseReg1HeredityLabels({ h: "30", arm: "scaf", history: "6" })).toThrow(/--arm must be rand for --h 30/);
    expect(() => parseReg1HeredityLabels({ h: "30", arm: "rand", history: "5" })).toThrow(/--history must be 6 for --h 30/);
    expect(() => parseReg1HeredityLabels({ h: "48", arm: "control", control: "negative" })).toThrow(/--control must be positive/);
    expect(() => parseReg1HeredityLabels({ h: "50", arm: "control", control: "negative", history: "1" })).toThrow(/--history must be 0 for --h 50/);
    expect(parseReg1HeredityLabels({ h: "53", arm: "control", control: "negative", history: "3" })).toEqual(reg1HeredityLabelsOf(53));
    expect(() => parseReg1HeredityLabels({ h: "3", arm: "scaf", history: "3", timing: "a" })).toThrow(/--timing/);
    // labels read back from assay.json must be consistent with their h, set and world
    expect(reg1LabelsFromJson({ ...ea, h: 5 })).toMatchObject({ error: expect.stringMatching(/labels.h 5, want 77/) });
    expect(reg1LabelsFromJson({ ...ea, timing: "b" })).toMatchObject({ error: expect.stringMatching(/timing a only/) });
    expect(reg1LabelsFromJson({ ...ea, set: "swap" })).toMatchObject({ error: expect.stringMatching(/not a reg1 set/) });
    expect(reg1LabelsFromJson({ ...ea, reg1: undefined })).toEqual({ error: "labels.reg1 is not true" });
    expect(reg1AssayOutProblems(ea, "runs/scaffold/reg1/assays/scaf-i05-ga-on-fa").join(" ")).toMatch(/does not end in scaffold\/reg1\/assays\/scaf-i05-ge-on-fa/);
  });

  // ------------------------------------------------------------------------------------------
  // Run-bundle sources: a tiny bundle (ponds-small) written as tools/run.ts writes one

  const SMALL_DIR = "scaffold/reg1/hist/ponds-small/treatment/seed-4850001";
  const smallSpec = (over: Partial<RunSpec> = {}): RunSpec => ({ experiment: "hist", presetId: "ponds-small", condition: "treatment", seed: 4_850_001, steps: 4000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: [2, 3], ...over });
  /** What a ponds-small history at seed 4,850,001 must be: the production want of h = 0 with the small preset's directory, steps, period and ponds. */
  const smallWant = (): Reg1BundleWant => ({ ...reg1BundleWantOf(0), dir: SMALL_DIR, presetId: "ponds-small", presetIdentity: presetIdentity(PRESETS.find((p) => p.id === "ponds-small")!), steps: 4000, period: 1000, side: 2 });
  const read = (p: string) => readFile(p).then((b) => new Uint8Array(b));

  /**
   * Writes a run bundle under `root` (at `dir`): manifest.json as the runner writes it (runId, spec, cfg, initHash, ruleVersion, startStep,
   * preCycleCheckpoints, summary, finishedAt) and checkpoints/b<NNN>-pre.blck for each of `states` (boundary -> state; by default the
   * initial world at step 2,000 as boundary 2's). `edit` changes the manifest (and the directory) before it is written.
   */
  function writeBundle(root: string, o: { spec?: RunSpec; dir?: string; states?: (init: WorldState) => Record<number, WorldState>; edit?: (m: Record<string, unknown>, dir: string) => void } = {}): string {
    const spec = o.spec ?? smallSpec();
    const cfg = specConfig(spec);
    const init = initWorld(cfg, PRESETS.find((p) => p.id === spec.presetId)!.init);
    const dir = join(root, o.dir ?? SMALL_DIR);
    mkdirSync(join(dir, "checkpoints"), { recursive: true });
    const states = o.states ? o.states(init) : { 2: { ...init, step: 2000 } };
    const preCycleCheckpoints = Object.entries(states).map(([b, s]) => {
      const file = reg1PreCycleFileOf(Number(b));
      writeFileSync(join(dir, file), encodeCheckpoint(s, { ponds: { lastCycle: Number(b) - 1 } }));
      return { boundary: Number(b), step: s.step, file, hash: stateHash(s) };
    });
    const preset = PRESETS.find((p) => p.id === spec.presetId)!;
    const m: Record<string, unknown> = { runId: `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`, spec, cfg, presetIdentity: presetIdentity(preset), initHash: stateHash(init), ruleVersion: 1, startStep: 0, startedAt: "2026-10-02T00:00:00.000Z", checkpoints: [], preCycleCheckpoints, summary: { conservationOk: true, finalHash: "f".repeat(16) }, finishedAt: "2026-10-02T01:00:00.000Z" };
    o.edit?.(m, dir);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2));
    return dir;
  }

  it("loads a source from a run bundle by the hash its manifest records, and refuses every way the bundle can be wrong", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg1-bundle-"));
    try {
      const want = smallWant();
      const dir = writeBundle(join(root, "ok"));
      const { state, record } = await loadReg1Source(dir, 2, read);
      expect(state.step).toBe(2000);
      expect(record).toMatchObject({ source: dir, boundary: 2, checkpoint: `${dir}/checkpoints/b002-pre.blck`, stateHash: stateHash(state), seed: 4_850_001, mutRate: mut, step: 2000, tilesX: 2, tilesY: 2, sameConfig: true });
      expect(record.run).toMatchObject({ manifest: `${dir}/manifest.json`, runId: "hist/ponds-small/treatment/seed-4850001", complete: true, conservationOk: true, ruleVersion: 1, preCycle: { boundary: 2, step: 2000, file: "checkpoints/b002-pre.blck", hash: stateHash(state) } });
      expect(reg1SourceProblems(want, 2, record)).toEqual([]);
      expect(reg1SourceProblems(want, 2, (await loadReg1Source(`${dir}/`, 2, read)).record)).toEqual([]); // a trailing slash
      expect(reg1SourceProblems(want, 2, JSON.parse(JSON.stringify(record)))).toEqual([]); // as assay.json records it

      let n = 0;
      const problems = async (o: Parameters<typeof writeBundle>[1], boundary: number | null = 2) => {
        const d = writeBundle(join(root, `case${n++}`), o);
        return reg1SourceProblems(want, boundary, (await loadReg1Source(d, boundary, read)).record).join(" ");
      };
      // an incomplete manifest (the run has not finished), or conservation broken
      expect(await problems({ edit: (m) => (delete m.summary, delete m.finishedAt) })).toMatch(/^source run is incomplete: its manifest.json has no summary and finishedAt$/);
      expect(await problems({ edit: (m) => delete m.finishedAt })).toMatch(/run is incomplete/);
      expect(await problems({ edit: (m) => (m.summary = { conservationOk: false }) })).toMatch(/^source run summary.conservationOk false, want true$/);
      expect(await problems({ edit: (m) => (m.ruleVersion = 2) })).toMatch(/run ruleVersion 2, want 1/);
      // a wrong seed, condition or steps
      const seed = await problems({ spec: smallSpec({ seed: 4_850_002 }) });
      expect(seed).toMatch(/source seed 4850002, want 4850001/);
      expect(seed).toMatch(/spec.seed 4850002, want 4850001/);
      const cond = await problems({ spec: smallSpec({ condition: "pond-rand" }) });
      expect(cond).toMatch(/spec.condition "pond-rand", want "treatment"/);
      expect(await problems({ spec: smallSpec({ steps: 3000 }) })).toMatch(/^source spec.steps 3000, want 4000$/);
      expect(await problems({ spec: smallSpec({ censusEvery: 100 }) })).toMatch(/^source spec.censusEvery 100, want 1000$/);
      expect(await problems({ spec: smallSpec({ overrides: { mutRate: 0 } }) })).toMatch(/spec sets overrides/);
      expect(await problems({ spec: smallSpec({ deepEvery: 1 }) })).toMatch(/^source spec.deepEvery 1, want 10$/);
      expect(await problems({ spec: smallSpec({ checkpointEvery: 1000 }) })).toMatch(/^source spec.checkpointEvery 1000, want 0$/);
      // the preset's identity, as the manifest records it
      expect(await problems({ edit: (m) => (m.presetIdentity = "0".repeat(16)) })).toMatch(/^source run presetIdentity "0{16}", want "eb17008775286308"$/);
      expect(await problems({ edit: (m) => delete m.presetIdentity })).toMatch(/run presetIdentity null, want/);
      // one uninterrupted run: a segment continued from a checkpoint has another start step and no initHash
      expect(await problems({ edit: (m) => (m.startStep = 1000) })).toMatch(/^source run startStep 1000, want 0$/);
      expect(await problems({ edit: (m) => delete m.initHash })).toMatch(/^source manifest has no initHash \(a run continued from a checkpoint, not one run from the preset\)$/);
      // run ids cannot hold "/": the runs are made with --out runs/scaffold/reg1 --experiment hist, so another experiment is another run
      expect(await problems({ spec: smallSpec({ experiment: "anc" }), dir: "scaffold/reg1/hist/anc/ponds-small/treatment/seed-4850001" })).toMatch(/spec.experiment "anc", want "hist"/);
      // a wrong path: the right bundle in another history's directory, or a manifest that is not the directory's
      const path = await problems({ dir: "scaffold/reg1/hist/ponds-small/treatment/seed-4850002" });
      expect(path).toMatch(/directory .*seed-4850002" is not scaffold\/reg1\/hist\/ponds-small\/treatment\/seed-4850001/);
      expect(path).toMatch(/does not end in its manifest's runId/);
      expect(await problems({ dir: "scaffold/reg1/anc/ponds-small/treatment/seed-4850001" })).toMatch(/is not scaffold\/reg1\/hist/);
      expect(await problems({ edit: (m) => (m.runId = "other/ponds-small/treatment/seed-4850001") })).toMatch(/^source manifest runId "other\/ponds-small\/treatment\/seed-4850001" is not its spec's/);
      // a missing boundary: neither the spec nor the manifest lists it (the file alone does not make it one), or there is no such file
      const missing = await problems({ spec: smallSpec({ preCycleCheckpoints: [2] }), states: (init) => ({ 2: { ...init, step: 2000 }, 3: { ...init, step: 3000 } }), edit: (m) => (m.preCycleCheckpoints = (m.preCycleCheckpoints as unknown[]).slice(0, 1)) }, 3);
      expect(missing).toMatch(/spec.preCycleCheckpoints \[2\] does not list boundary 3/);
      expect(missing).toMatch(/manifest lists no pre-cycle checkpoint at boundary 3/);
      await expect(loadReg1Source(writeBundle(join(root, `case${n++}`)), 3, read)).rejects.toThrow(/b003-pre\.blck/);
      // a hash mismatch: the file is not the state the manifest recorded
      expect(await problems({ edit: (m) => ((m.preCycleCheckpoints as Record<string, unknown>[])[0].hash = "0".repeat(16)) })).toMatch(/^source state hash [0-9a-f]{16}, but the manifest records "0{16}" for boundary 2$/);
      // the manifest's file for the boundary must be the runner's name for it
      const renamed = await problems({ edit: (m, d) => (renameSync(join(d, "checkpoints/b002-pre.blck"), join(d, "checkpoints/t000002000.blck")), ((m.preCycleCheckpoints as Record<string, unknown>[])[0].file = "checkpoints/t000002000.blck")) });
      expect(renamed).toMatch(/manifest pre-cycle file "checkpoints\/t000002000.blck", want "checkpoints\/b002-pre.blck"/);
      // a wrong step
      const step = await problems({ states: (init) => ({ 2: { ...init, step: 2100 } }) });
      expect(step).toMatch(/source step 2100, want 2000/);
      expect(step).toMatch(/manifest pre-cycle step 2100, want 2000/);
      // a wrong mutation rate: the state's config is not the spec's
      const rate = await problems({ states: (init) => ({ 2: { ...init, cfg: { ...init.cfg, mutRate: 0 }, step: 2000 } }) });
      expect(rate).toMatch(/source mutRate 0, want 429497/);
      expect(rate).toMatch(/state's config is not its spec's/);
      // no manifest at all: the checkpoint loads under its conventional name, and the record says what is missing
      const bare = writeBundle(join(root, `case${n++}`));
      unlinkSync(join(bare, "manifest.json"));
      const orphan = reg1SourceProblems(want, 2, (await loadReg1Source(bare, 2, read)).record).join(" ");
      expect(orphan).toMatch(/no readable manifest.json with a spec/);
      expect(orphan).toMatch(/run is incomplete/);
      expect(orphan).toMatch(/manifest lists no pre-cycle checkpoint at boundary 2/);
      // a source labelled as another boundary
      expect(reg1SourceProblems(want, 3, record).join(" ")).toMatch(/source boundary 2, want 3/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("takes the one complete run of a world, at census 1,000 or its census-100 overflow rerun, and refuses two", async () => {
    const C100_DIR = "scaffold/reg1/hist-c100/ponds-small/treatment/seed-4850001";
    const wants = [smallWant(), { ...smallWant(), dir: C100_DIR, experiment: "hist-c100", censusEvery: 100 }];
    const c100 = { spec: smallSpec({ experiment: "hist-c100", censusEvery: 100 }), dir: C100_DIR };
    const incomplete = (m: Record<string, unknown>) => (delete m.summary, delete m.finishedAt);
    const root = mkdtempSync(join(tmpdir(), "reg1-rerun-"));
    try {
      const at = (name: string) => ({ hist: join(root, name, SMALL_DIR), c100: join(root, name, C100_DIR) });
      const load = async (dir: string) => (await loadReg1Source(dir, 2, read, wants)).record;
      // only the census-1,000 run
      writeBundle(join(root, "hist"));
      const hist = await load(at("hist").hist);
      expect(hist.source).toBe(at("hist").hist);
      expect(hist.candidates).toEqual([
        { dir: at("hist").hist, complete: true, manifest: true, summary: true, startedAt: "2026-10-02T00:00:00.000Z", finishedAt: "2026-10-02T01:00:00.000Z" },
        { dir: at("hist").c100, complete: false, manifest: false, summary: false, startedAt: null, finishedAt: null },
      ]);
      expect(reg1SourceProblems(wants, 2, hist)).toEqual([]);
      // only the census-100 rerun: --source may name either directory
      writeBundle(join(root, "c100"), c100);
      for (const dir of [at("c100").hist, at("c100").c100, `${at("c100").hist}/`]) {
        const r = await load(dir);
        expect(r.source).toBe(at("c100").c100);
        expect(r.run).toMatchObject({ runId: "hist-c100/ponds-small/treatment/seed-4850001", complete: true });
        expect(reg1SourceProblems(wants, 2, r)).toEqual([]);
      }
      // an overflowed (incomplete) run beside its complete rerun: the rerun is the source, with the same pre-cycle state
      writeBundle(join(root, "both"), { edit: incomplete });
      writeBundle(join(root, "both"), c100);
      const rerun = await load(at("both").hist);
      expect(rerun.source).toBe(at("both").c100);
      expect(rerun.stateHash).toBe(hist.stateHash);
      // the overflowed run's manifest says why: it started and has no summary
      expect(rerun.candidates).toEqual([
        { dir: at("both").hist, complete: false, manifest: true, summary: false, startedAt: "2026-10-02T00:00:00.000Z", finishedAt: null },
        { dir: at("both").c100, complete: true, manifest: true, summary: true, startedAt: "2026-10-02T00:00:00.000Z", finishedAt: "2026-10-02T01:00:00.000Z" },
      ]);
      expect(reg1SourceProblems(wants, 2, rerun)).toEqual([]);
      // two complete runs of one world: ambiguous, whichever is named
      writeBundle(join(root, "two"));
      writeBundle(join(root, "two"), c100);
      for (const dir of [at("two").hist, at("two").c100]) {
        const r = await load(dir);
        expect(r.source).toBe(dir);
        expect(reg1SourceProblems(wants, 2, r).join(" ")).toMatch(/^source is ambiguous: 2 complete runs of it \(.*seed-4850001, .*seed-4850001\), want one$/);
      }
      // a census-100 directory holding a census-1,000 run, and the reverse
      writeBundle(join(root, "c1000"), { dir: C100_DIR, spec: smallSpec({ experiment: "hist-c100" }) });
      expect(reg1SourceProblems(wants, 2, await load(at("c1000").c100)).join(" ")).toMatch(/^source spec.censusEvery 1000, want 100$/);
      writeBundle(join(root, "h100"), { spec: smallSpec({ censusEvery: 100 }) });
      expect(reg1SourceProblems(wants, 2, await load(at("h100").hist)).join(" ")).toMatch(/^source spec.censusEvery 100, want 1000$/);
      // neither complete: the named one, refused as incomplete
      writeBundle(join(root, "none"), { edit: incomplete });
      const none = await load(at("none").hist);
      expect(none.source).toBe(at("none").hist);
      expect(reg1SourceProblems(wants, 2, none).join(" ")).toMatch(/run is incomplete/);
      // without `wants` the loader reads the named bundle only, and a production check then sees the rerun's directory was not looked at
      expect(reg1SourceProblems(wants, 2, (await loadReg1Source(at("both").hist, 2, read)).record).join(" ")).toMatch(/was not chosen with scaffold\/reg1\/hist-c100\/ponds-small\/treatment\/seed-4850001 in view.*run is incomplete/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rebuilds the initial world from the spec as the runner does and holds it to the manifest's initHash", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg1-init-"));
    try {
      const want = smallWant();
      const spec = smallSpec();
      const dir = writeBundle(join(root, "ok"));
      const { state, record } = await loadReg1Source(dir, null, read);
      expect(state.step).toBe(0);
      expect(stateHash(state)).toBe(stateHash(initWorld(specConfig(spec), PRESETS.find((p) => p.id === "ponds-small")!.init)));
      expect(record).toMatchObject({ boundary: null, checkpoint: null, sameConfig: true, step: 0, seed: 4_850_001, mutRate: mut });
      expect(reg1SourceProblems(want, null, record)).toEqual([]);
      const problems = async (edit: (m: Record<string, unknown>) => void, name: string) => reg1SourceProblems(want, null, (await loadReg1Source(writeBundle(join(root, name), { edit }), null, read)).record).join(" ");
      expect(await problems((m) => (m.initHash = "0".repeat(16)), "hash")).toMatch(/^source initial world rebuilt from the spec hashes to [0-9a-f]{16}, but the manifest's initHash is 0{16}$/);
      expect(await problems((m) => delete m.initHash, "none")).toMatch(/manifest has no initHash/);
      expect(await problems((m) => (m.startStep = 10_000), "start")).toMatch(/run startStep 10000, want 0/);
      // the time-0 world and boundary 2's are not each other
      expect(reg1SourceProblems(want, 2, record).length).toBeGreaterThan(0);
      // the runner's founding only: a spec that founds its world otherwise, or an unknown preset, is refused
      expect(() => reg1InitialWorld(smallSpec({ soloFounder: 3 }))).toThrow(/soloFounder/);
      expect(() => reg1InitialWorld(smallSpec({ presetId: "nope" }))).toThrow(/unknown preset/);
      // the production preset: 64 ponds, the history's seed, the default mutation rate, its arm's pond cycle
      const ponds = reg1InitialWorld({ ...smallSpec(), presetId: "ponds", condition: "pond-rand", seed: 4_850_101, steps: 1_000_000 });
      expect([ponds.cfg.tilesX, ponds.cfg.tilesY, ponds.cfg.seed, ponds.cfg.mutRate, ponds.cfg.pondPeriod, ponds.cfg.pondArm, ponds.step]).toEqual([8, 8, 4_850_101, mut, 10_000, "rand", 0]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * A source record of h as `loadReg1Source` gives it for a production bundle under runs/ (no state needed): the run at census 1,000, or
   * with `c100` its overflow rerun at census 100, the other candidate incomplete.
   */
  const rec = (h: number, boundary: number | null = reg1BoundaryAOf(h), over: Partial<Reg1Source> = {}, c100 = false): Reg1Source => {
    const ws = reg1BundleWantsOf(h);
    const w = ws[c100 ? 1 : 0];
    const dir = `runs/${w.dir}`;
    const ancestor = reg1HistoryOf(h).arm === "ancestor";
    const spec = { experiment: w.experiment, presetId: "ponds", condition: w.condition, seed: w.seed, steps: w.steps, censusEvery: w.censusEvery, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: ancestor ? [1] : [34, 100] };
    const hash = boundary === null ? `i${h}`.padEnd(16, "0") : `b${h}-${boundary}`.padEnd(16, "0");
    return {
      source: dir,
      stateHash: hash,
      seed: w.seed,
      mutRate: mut,
      step: boundary === null ? 0 : boundary * 10_000,
      tilesX: 8,
      tilesY: 8,
      boundary,
      checkpoint: boundary === null ? null : `${dir}/${reg1PreCycleFileOf(boundary)}`,
      sameConfig: true,
      run: { manifest: `${dir}/manifest.json`, runId: `${spec.experiment}/ponds/${w.condition}/seed-${w.seed}`, spec, presetIdentity: REG1_PONDS_IDENTITY, ruleVersion: 1, startStep: 0, initHash: `i${h}`.padEnd(16, "0"), complete: true, conservationOk: true, preCycle: boundary === null ? null : { boundary, step: boundary * 10_000, file: reg1PreCycleFileOf(boundary), hash } },
      candidates: ws.map((x) => ({ dir: `runs/${x.dir}`, complete: x === w, manifest: true, summary: x === w, startedAt: "2026-10-02T00:00:00.000Z", finishedAt: x === w ? "2026-10-02T01:00:00.000Z" : null })),
      ...over,
    };
  };

  it("names every source's production bundle and holds a recorded source to the labelled world", () => {
    expect([0, 30, 71, 72, 95].map(reg1BundleDirOf)).toEqual([
      "scaffold/reg1/hist/ponds/treatment/seed-4850001",
      "scaffold/reg1/hist/ponds/pond-rand/seed-4850107",
      "scaffold/reg1/hist/ponds/pond-cont/seed-4850224",
      "scaffold/reg1/anc/ponds/pond-cont/seed-4850401",
      "scaffold/reg1/anc/ponds/pond-cont/seed-4850424",
    ]);
    expect(reg1BundleWantOf(0)).toEqual({ dir: reg1BundleDirOf(0), experiment: "hist", presetId: "ponds", presetIdentity: "56526b894cfccf3f", condition: "treatment", seed: 4_850_001, steps: 1_000_000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, period: 10_000, side: 8, mutRate: 429_497 });
    // the identity the document names is the ponds preset's in the code that runs
    expect(presetIdentity(PRESETS.find((p) => p.id === "ponds")!)).toBe(REG1_PONDS_IDENTITY);
    expect(reg1SourceProblems(reg1BundleWantsOf(0), 100, { ...rec(0), run: { ...rec(0).run, presetIdentity: "eb17008775286308" } }).join(" ")).toMatch(/run presetIdentity "eb17008775286308", want "56526b894cfccf3f"/);
    expect(reg1BundleWantOf(72)).toMatchObject({ experiment: "anc", condition: "pond-cont", seed: 4_850_401, steps: 10_000 });
    expect(reg1BundleWantsOf(30)).toEqual([reg1BundleWantOf(30), { ...reg1BundleWantOf(30), dir: "scaffold/reg1/hist-c100/ponds/pond-rand/seed-4850107", experiment: "hist-c100", censusEvery: 100 }]);
    expect(reg1BundleWantsOf(72)[1]).toMatchObject({ dir: "scaffold/reg1/anc-c100/ponds/pond-cont/seed-4850401", experiment: "anc-c100", censusEvery: 100, steps: 10_000 });
    // either run of a world is its source, with the other in view and incomplete
    for (const h of [0, 47, 71, 95]) expect(reg1SourceProblems(reg1BundleWantsOf(h), reg1BoundaryAOf(h), rec(h, reg1BoundaryAOf(h), {}, true))).toEqual([]);
    expect(reg1SourceProblems(reg1BundleWantsOf(3), 100, { ...rec(3), candidates: rec(3).candidates.map((c) => ({ ...c, complete: true })) }).join(" ")).toMatch(/source is ambiguous: 2 complete runs of it/);
    expect(reg1SourceProblems(reg1BundleWantsOf(3), 100, { ...rec(3), candidates: rec(3).candidates.slice(0, 1) }).join(" ")).toMatch(/was not chosen with scaffold\/reg1\/hist-c100\/ponds\/treatment\/seed-4850004 in view/);
    expect(reg1SourceProblems(reg1BundleWantsOf(3), 100, { ...rec(3), candidates: undefined as never }).join(" ")).toMatch(/records no candidate bundles/);
    expect([0, 72].map(reg1BoundaryAOf)).toEqual([100, 1]);
    expect([reg1PreCycleFileOf(1), reg1PreCycleFileOf(34), reg1PreCycleFileOf(100)]).toEqual(["checkpoints/b001-pre.blck", "checkpoints/b034-pre.blck", "checkpoints/b100-pre.blck"]);
    for (const h of [0, 23, 24, 47, 48, 71, 72, 95]) expect(reg1SourceProblems(reg1BundleWantOf(h), reg1BoundaryAOf(h), rec(h))).toEqual([]);
    for (const h of [0, 47]) expect(reg1SourceProblems(reg1BundleWantOf(h), 34, rec(h, 34))).toEqual([]);
    expect(reg1SourceProblems(reg1BundleWantOf(5), null, rec(5, null))).toEqual([]);
    // the path can be relative to runs/ or absolute
    expect(reg1SourceProblems(reg1BundleWantOf(0), 100, { ...rec(0), source: "/home/u/bl/runs/scaffold/reg1/hist/ponds/treatment/seed-4850001", checkpoint: "/home/u/bl/runs/scaffold/reg1/hist/ponds/treatment/seed-4850001/checkpoints/b100-pre.blck" })).toEqual([]);
    // another world's bundle under these labels
    expect(reg1SourceProblems(reg1BundleWantOf(1), 100, rec(0)).join(" ")).toMatch(/is not scaffold\/reg1\/hist\/ponds\/treatment\/seed-4850002.*source seed 4850001, want 4850002/);
    expect(reg1SourceProblems(reg1BundleWantOf(24), 100, rec(0)).join(" ")).toMatch(/spec.condition "treatment", want "pond-rand"/);
    expect(reg1SourceProblems(reg1BundleWantOf(72), 1, rec(72, 100)).join(" ")).toMatch(/source boundary 100, want 1/);
    expect(reg1SourceProblems(reg1BundleWantOf(72), 1, rec(72, 1, { run: { ...rec(72).run, spec: { ...rec(72).run.spec, experiment: "hist" }, runId: "hist/ponds/pond-cont/seed-4850401" } })).join(" ")).toMatch(/spec.experiment "hist", want "anc".*does not end in its manifest's runId/);
    // every problem is listed, and a record without a run says so
    expect(reg1SourceProblems(reg1BundleWantOf(0), 100, { ...rec(0), seed: 1, mutRate: 0, step: 5 }).length).toBe(3);
    expect(reg1SourceProblems(reg1BundleWantOf(0), 100, undefined)).toEqual(["no source record"]);
  });

  it("validates a continuation's sidecar against its source as it is now and the checkpoint beside it", () => {
    expect([reg1ContinuationPathOf(0), reg1ContinuationPathOf(77)]).toEqual(["scaffold/reg1/cont200k/scaf-i00.blck.gz", "scaffold/reg1/cont200k/ancestor-i05.blck.gz"]);
    const continued = (h: number, from: Reg1Source, over: Partial<R3RepCheckpoint> = {}): R3RepCheckpoint => ({ source: `runs/${reg1ContinuationPathOf(h)}`, stateHash: `e${h}`.padEnd(16, "0"), seed: reg1ContinueSeed(h), mutRate: mut, step: from.step + 200_000, tilesX: 8, tilesY: 8, ...over });
    const sidecarOf = (h: number, from: Reg1Source, end: R3RepCheckpoint) => reg1ContinuationOf({ h, origin: from, end, steps: 200_000, censusEvery: 100, protocolSha256Reg1: REG });
    for (const h of [0, 30, 60, 77]) {
      const from = rec(h);
      const end = continued(h, from);
      const c = sidecarOf(h, from, end);
      expect(c).toMatchObject({ reg1: true, h, boundary: reg1BoundaryAOf(h), source: from.source, sourceStateHash: from.stateHash, sourceSeed: from.seed, sourceStep: from.step, seed: 4_850_501 + h, steps: 200_000, mutRate: mut, censusEvery: 100, endStateHash: end.stateHash, endStep: from.step + 200_000, origin: from, protocolSha256Reg1: REG });
      expect(reg1ContinuationProblems(h, c, from, end, REG)).toEqual([]);
    }
    // a source that is its world's census-100 rerun
    const rerun = rec(2, 100, {}, true);
    expect(rerun.source).toBe("runs/scaffold/reg1/hist-c100/ponds/treatment/seed-4850003");
    expect(reg1ContinuationProblems(2, sidecarOf(2, rerun, continued(2, rerun)), rerun, continued(2, rerun), REG)).toEqual([]);
    expect(reg1ContinuationProblems(2, sidecarOf(2, rerun, continued(2, rerun)), rec(2), continued(2, rerun), REG).join(" ")).toMatch(/continuation source ".*hist-c100.*", want ".*\/hist\/ponds.*"/); // the source named now is another run
    const from = rec(2);
    const end = continued(2, from);
    const c = sidecarOf(2, from, end);
    expect(reg1ContinuationProblems(2, c, { ...from, stateHash: "f".repeat(16) }, end, REG).join(" ")).toMatch(/continuation sourceStateHash "b2-100.*", want "f{16}"/); // the source changed since
    expect(reg1ContinuationProblems(2, sidecarOf(2, from, { ...end, seed: 4_850_502 }), from, { ...end, seed: 4_850_502 }, REG).join(" ")).toMatch(/continuation seed 4850502, want 4850503/);
    expect(reg1ContinuationProblems(2, { ...c, steps: 100_000, endStep: 1_100_000 }, from, { ...end, step: 1_100_000 }, REG).join(" ")).toMatch(/continuation steps 100000, want 200000/);
    expect(reg1ContinuationProblems(2, { ...c, censusEvery: 1000 }, from, end, REG).join(" ")).toMatch(/censusEvery 1000, want 100/);
    expect(reg1ContinuationProblems(2, c, from, { ...end, stateHash: "d".repeat(16) }, REG).join(" ")).toMatch(/the continued checkpoint's stateHash "d{16}" is not the continuation's endStateHash/);
    expect(reg1ContinuationProblems(3, c, from, end, REG).join(" ")).toMatch(/continuation history 2, want 3/);
    expect(reg1ContinuationProblems(2, c, from, end, "4".repeat(64)).join(" ")).toMatch(/protocolSha256Reg1/);
    expect(reg1ContinuationProblems(2, null, from, end, REG)).toEqual(["no continuation sidecar (the <checkpoint>.json that continue --reg1 writes last)"]);
    // a smoke test's sidecar says so, and is never a source
    expect("allowAnySeed" in c).toBe(false);
    const smoke = reg1ContinuationOf({ h: 2, origin: from, end, steps: 200_000, censusEvery: 100, protocolSha256Reg1: REG, allowAnySeed: true });
    expect(smoke.allowAnySeed).toBe(true);
    expect(reg1ContinuationProblems(2, smoke, from, end, REG)).toEqual(["continuation was written under --allow-any-seed (allowAnySeed true): a smoke test's, not a source"]);
    expect(reg1ContinuationProblems(2, c, null, end, REG).join(" ")).toMatch(/source was not read/);
    // what continue --reg1 checks before it runs
    expect(reg1ContinueProblems(2, { seed: 4_850_503, steps: 200_000, censusEvery: 100, out: "runs/scaffold/reg1/cont200k/scaf-i02.blck.gz" })).toEqual([]);
    expect(reg1ContinueProblems(77, { seed: 4_850_578, steps: 200_000, censusEvery: 100, out: "scaffold/reg1/cont200k/ancestor-i05.blck.gz" })).toEqual([]);
    expect(reg1ContinueProblems(2, { seed: r3RepContinueSeed(2), steps: 20_000, censusEvery: 1000, out: "runs/scaffold/r3rep/cont200k/scaf-i2.blck.gz" })).toEqual([
      `seed ${r3RepContinueSeed(2)}, want reg1ContinueSeed(2) = 4850503`,
      "steps 20000, want 200000",
      "census every 1000, want 100",
      'output "runs/scaffold/r3rep/cont200k/scaf-i2.blck.gz" does not end in scaffold/reg1/cont200k/scaf-i02.blck.gz',
    ]);
  });

  it("checks each set's whole provenance: sources at a and b, the swap pair's ancestor fragments and Ge-on-Fa's donor, S2's times and S3's sources", () => {
    const dom = r3RepDominantRecord(dominantGenome(blobSource(2)));
    const l = (set: "source" | "ge-on-fa" | "ga-on-fa" | "ga-on-fe" | "quench", arm: "scaf" | "rand" | "cont" | "ancestor", i: number, timing: "a" | "b") => reg1CompetenceLabelsOf(set, arm, i, timing);
    // timing a: the source itself; the swap pair's source is ancestor world i's (a), Ge-on-Fa's donor scaf_i's (a)
    expect(reg1ProvenanceProblems(l("source", "rand", 4, "a"), rec(28), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("source", "ancestor", 4, "a"), rec(76), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("quench", "scaf", 4, "a"), rec(4), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("ga-on-fe", "scaf", 4, "a"), rec(4), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("ga-on-fa", "scaf", 4, "a"), rec(76), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), { ...rec(76), donor: { ...rec(4), dominant: dom } }, REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), { ...rec(76), donor: { ...rec(4), dominant: null } }, REG)).toEqual([]); // the biological record
    expect(reg1ProvenanceProblems(l("ga-on-fa", "scaf", 4, "a"), rec(4), REG).join(" ")).toMatch(/directory .* is not scaffold\/reg1\/anc\/ponds\/pond-cont\/seed-4850405/); // scaf_i's fragments
    expect(reg1ProvenanceProblems(l("ga-on-fe", "scaf", 4, "a"), rec(76), REG).join(" ")).toMatch(/is not scaffold\/reg1\/hist\/ponds\/treatment\/seed-4850005/); // the ancestor's
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), { ...rec(76), donor: { ...rec(5), dominant: dom } }, REG).join(" ")).toMatch(/^donor directory .* is not scaffold\/reg1\/hist\/ponds\/treatment\/seed-4850005/);
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), rec(76), REG).join(" ")).toMatch(/no donor record/);
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), { ...rec(76), donor: { ...rec(4), dominant: { ...dom!, words: "00" } } }, REG).join(" ")).toMatch(/not a dominant genome record/);
    expect(reg1ProvenanceProblems(l("ga-on-fa", "scaf", 4, "a"), { ...rec(76), donor: { ...rec(4), dominant: dom } }, REG).join(" ")).toMatch(/names a genome donor, but ga-on-fa has none/);
    expect(reg1ProvenanceProblems(l("source", "scaf", 4, "a"), undefined, REG)).toEqual(["assay.json has no provenance of its source (run the assay with --reg1)"]);
    // timing b: the continued checkpoint, its sidecar and the timing (a) source the sidecar names
    for (const [set, h] of [["source", 4], ["quench", 4], ["source", 64], ["source", 76]] as const) {
      const from = rec(h);
      const end = { source: `runs/${reg1ContinuationPathOf(h)}`, stateHash: "e".repeat(16), seed: reg1ContinueSeed(h), mutRate: mut, step: from.step + 200_000, tilesX: 8, tilesY: 8 };
      const c = reg1ContinuationOf({ h, origin: from, end, steps: 200_000, censusEvery: 100, protocolSha256Reg1: REG });
      const hist = reg1HistoryOf(h);
      expect(reg1ProvenanceProblems(l(set, hist.arm, hist.history, "b"), { ...end, continuation: c, origin: from }, REG)).toEqual([]);
      if (h === 4) {
        expect(reg1ProvenanceProblems(l(set, "scaf", 4, "b"), { ...end, continuation: null, origin: from }, REG).join(" ")).toMatch(/no continuation sidecar/);
        expect(reg1ProvenanceProblems(l(set, "scaf", 4, "b"), { ...end, continuation: c, origin: rec(4, 100, { run: { ...rec(4).run, complete: false } }) }, REG).join(" ")).toMatch(/continuation source run is incomplete/);
        expect(reg1ProvenanceProblems(l(set, "scaf", 4, "b"), { ...end, source: "runs/scaffold/r3rep/cont200k/scaf-i4.blck.gz", continuation: c, origin: from }, REG).join(" ")).toMatch(/does not end in scaffold\/reg1\/cont200k\/scaf-i04\.blck\.gz/);
        expect(reg1ProvenanceProblems(l(set, "scaf", 4, "a"), { ...end, continuation: c, origin: from }, REG).length).toBeGreaterThan(0); // a (b) source for (a)
        expect(reg1ProvenanceProblems(l(set, "scaf", 4, "b"), rec(4), REG).length).toBeGreaterThan(0); // and the reverse
      }
    }
    // census-100 reruns: a source at (a), a continuation's source at (b), Ge-on-Fa's donor, S2's time 0 and S3's boundary 34
    expect(reg1ProvenanceProblems(l("source", "rand", 4, "a"), rec(28, 100, {}, true), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(l("ge-on-fa", "scaf", 4, "a"), { ...rec(76, 1, {}, true), donor: { ...rec(4, 100, {}, true), dominant: dom } }, REG)).toEqual([]);
    {
      const from = rec(64, 100, {}, true);
      const end = { source: `runs/${reg1ContinuationPathOf(64)}`, stateHash: "e".repeat(16), seed: reg1ContinueSeed(64), mutRate: mut, step: from.step + 200_000, tilesX: 8, tilesY: 8 };
      const c = reg1ContinuationOf({ h: 64, origin: from, end, steps: 200_000, censusEvery: 100, protocolSha256Reg1: REG });
      expect(c.source).toBe("runs/scaffold/reg1/hist-c100/ponds/pond-cont/seed-4850217");
      expect(reg1ProvenanceProblems(l("source", "cont", 16, "b"), { ...end, continuation: c, origin: from }, REG)).toEqual([]);
    }
    expect(reg1ProvenanceProblems(reg1GardenLabelsOf("scaf", 4, 0, "disc"), rec(4, null, {}, true), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(reg1HeredityLabelsOf(4), rec(4, 34, {}, true), REG)).toEqual([]);
    // S2: time 0 is the initial world, time C boundary 100
    expect(reg1ProvenanceProblems(reg1GardenLabelsOf("rand", 4, 0, "disc"), rec(28, null), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(reg1GardenLabelsOf("rand", 4, 1, "fragment"), rec(28), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(reg1GardenLabelsOf("rand", 4, 0, "disc"), rec(28), REG).join(" ")).toMatch(/source boundary 100, want null/);
    // S3: a history's boundary 34, a control's checkpoint as R1'' records it
    expect(reg1ProvenanceProblems(reg1HeredityLabelsOf(28), rec(28, 34), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(reg1HeredityLabelsOf(28), rec(28), REG).join(" ")).toMatch(/source boundary 100, want 34/);
    const pre = { totalC: 85_566, totalS: 204_772, carrying: 94_592, outsideWindow: 92_766, postCycle: false };
    const control = (h: number) => ({ source: `runs/${reg1ControlPathOf(h)}`, stateHash: "c".repeat(16), seed: h < 50 ? 4_805_001 + h - 48 : 4_880_001 + h - 50, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: h < 50 ? 12 : 1, phase: pre });
    for (let h = 48; h <= 53; h++) expect(reg1ProvenanceProblems(reg1HeredityLabelsOf(h), control(h), REG)).toEqual([]);
    expect(reg1ProvenanceProblems(reg1HeredityLabelsOf(50), rec(0), REG).join(" ")).toMatch(/not an S3 control's record/);
  });

  it("holds S3's controls to the P2 ranking worlds and this block's negative-control worlds, and the tool that grows the latter to that world", () => {
    expect([48, 49, 50, 53].map(reg1ControlPathOf)).toEqual(["scaffold/p2/rank/s0/ckpt/b1-pre.blck.gz", "scaffold/p2/rank/s1/ckpt/b1-pre.blck.gz", "scaffold/reg1/neg/j0/ckpt/b1-pre.blck.gz", "scaffold/reg1/neg/j3/ckpt/b1-pre.blck.gz"]);
    const pre = { totalC: 462_380, totalS: 864_659, carrying: 194_040, outsideWindow: 190_125, postCycle: false };
    const neg = (j: number, over = {}) => ({ source: `runs/scaffold/reg1/neg/j${j}/ckpt/b1-pre.blck.gz`, seed: 4_880_001 + j, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: 1, phase: pre, ...over });
    for (let j = 0; j <= 3; j++) expect(reg1ControlProblems(50 + j, neg(j))).toEqual([]);
    expect(reg1ControlProblems(50, neg(0, { source: "runs/scaffold/rep/neg/j0/ckpt/b1-pre.blck.gz", seed: 4_811_201 })).join(" ")).toMatch(/does not end in scaffold\/reg1\/neg\/j0.*seed 4811201, want 4880001/); // R1'''s control
    expect(reg1ControlProblems(51, neg(0)).join(" ")).toMatch(/seed 4880001, want 4880002/);
    expect(reg1ControlProblems(50, neg(0, { distinctGenomes: 12 })).join(" ")).toMatch(/want 1 \(a clone world\)/);
    expect(reg1ControlProblems(50, neg(0, { mutRate: 429_497 })).join(" ")).toMatch(/mutRate 429497, want 0/);
    expect(reg1ControlProblems(50, neg(0, { phase: { totalC: 0, totalS: 0, carrying: 2014, outsideWindow: 0, postCycle: true } })).join(" ")).toMatch(/looks post-cycle/);
    expect(reg1ControlProblems(48, { ...neg(0), source: "runs/scaffold/p2/rank/s0/ckpt/b1-pre.blck.gz", seed: 4_805_001, distinctGenomes: 12 })).toEqual([]);
    expect(reg1ControlProblems(48, { ...neg(0), source: "runs/scaffold/p2/rank/s0/ckpt/b1-pre.blck.gz", seed: 4_805_001 }).join(" ")).toMatch(/more than 1 \(a founders world\)/);
    expect(reg1ControlProblems(3, neg(0))).toEqual(["h 3 is a history, not an S3 control"]);
    // tools/scaffold.ts grows a negative-control world at its seed only as the heredity replication grew its controls
    const run = { arm: "cont", init: "clone", mutOff: true, period: 10_000, cycles: 1, side: 8 };
    expect(reg1NegativeRunProblems(run)).toEqual([]);
    expect(reg1NegativeRunProblems({ ...run, arm: "scaf", mutOff: false, cycles: 100 })).toEqual(['arm "scaf", want "cont"', "mutOff false, want true", "cycles 100, want 1"]);
    expect(reg1NegativeRunProblems({ ...run, init: "founders", period: 3000, side: 2 })).toHaveLength(3);
  });

  it("keeps a waived (smoke) run out of the repository's production tree, and lets it write anywhere else", () => {
    const prod = "/repo/runs/scaffold/reg1";
    for (const out of ["/repo/runs/scaffold/reg1", "/repo/runs/scaffold/reg1/", "/repo/runs/scaffold/reg1/assays/scaf-i00-a", "/repo/runs/scaffold/reg1/cont200k/scaf-i00.blck.gz"]) {
      expect(reg1WaiverOutProblems(out, prod).join(" ")).toMatch(/^--allow-any-seed writes .* inside the registration's production tree \/repo\/runs\/scaffold\/reg1: a smoke test writes elsewhere$/);
    }
    for (const out of ["/tmp/scratchpad/reg1-smoke/runs/scaffold/reg1/assays/scaf-i00-a", "/repo/runs/scaffold/reg1x/a", "/repo/runs/scaffold/reg2", "/repo/runs/scaffold", "/other/repo/runs/scaffold/reg1/a"]) {
      expect(reg1WaiverOutProblems(out, prod)).toEqual([]);
    }
  });

  it("lists R4's sources in a fixed order: every history's (a), then every ancestor world's", () => {
    const srcs = reg1CapabilitySources();
    expect(srcs).toHaveLength(96);
    expect(srcs[0]).toEqual({ arm: "scaf", history: 0, h: 0, dir: reg1BundleDirOf(0), boundary: 100 });
    expect(srcs[47]).toMatchObject({ arm: "rand", history: 23, boundary: 100 });
    expect(srcs[95]).toEqual({ arm: "ancestor", history: 23, h: 95, dir: "scaffold/reg1/anc/ponds/pond-cont/seed-4850424", boundary: 1 });
    expect(srcs.map((s) => s.h)).toEqual(Array.from({ length: 96 }, (_, h) => h));
  });

  it("writes the reg1 labels, provenance and registration hash into assay.json, and leaves other keys alone", () => {
    const base = { protocolSha256: "0".repeat(64), assay: "competence", source: "s", tag: "t", k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 8, censusEvery: 100, inoculum: "swap-aa", seeds: [], extra: {}, summary: {}, wallSeconds: 1 };
    const labels: Reg1LabelSet = reg1CompetenceLabelsOf("ga-on-fa", "scaf", 3, "a");
    const json = JSON.parse(JSON.stringify(assayJson({ ...base, labels, extra: { quench: false, provenance: rec(75), protocolSha256Reg1: REG1_SHA256 } })));
    expect(json.labels).toEqual({ reg1: true, set: "ga-on-fa", arm: "scaf", history: 3, timing: "a", time: null, h: 75, control: null });
    expect(json.provenance).toEqual(rec(75));
    expect(json.protocolSha256Reg1).toBe(REG1_SHA256);
    expect(json.protocolSha256).toBe("0".repeat(64));
    expect(reg1LabelsFromJson(json.labels)).toEqual({ labels });
  });

  it("pins the registration as frozen: it still begins with its pinned text, which an amendment at the end keeps", async () => {
    const doc = new Uint8Array(readFileSync(fileURLToPath(new URL(`../../${REG1_PROTOCOL.doc}`, import.meta.url))));
    expect(REG1_SHA256).toBe("8a1b00ec5bd1440e8c4ab4ea61f3816dee0dbe110cb2052f0ae0ca785a817f69");
    expect(REG1_PROTOCOL.bytes).toBe(31_675);
    expect(createHash("sha256").update(doc.subarray(0, REG1_PROTOCOL.bytes)).digest("hex")).toBe(REG1_SHA256);
    // the freeze record says the same
    const frozen = readFileSync(fileURLToPath(new URL("../../experiments/scaffold/REGISTRATION-v1", import.meta.url)), "utf8");
    expect(frozen.trim().split(/\s+/)[0]).toBe(REG1_SHA256);
    expect(await reg1ProtocolProblems(doc)).toEqual([]);
    const amended = new Uint8Array([...doc, ...new TextEncoder().encode("\n## Amendment 1 (2026-10-03)\n\nA dated amendment at the end.\n")]);
    expect(await reg1ProtocolProblems(amended)).toEqual([]);
    for (const at of [0, 5000, REG1_PROTOCOL.bytes - 1]) {
      const edited = amended.slice();
      edited[at] ^= 1;
      expect((await reg1ProtocolProblems(edited)).join(" ")).toMatch(/^docs\/scaffold-registration-v1\.md no longer begins with its pinned text \(SHA-256 8a1b00ec.*; its first 31675 bytes hash to [0-9a-f]{64}\)/);
    }
    expect(await reg1ProtocolProblems(doc.subarray(0, 100))).toEqual(["docs/scaffold-registration-v1.md has 100 bytes, fewer than the 31675 it had when pinned"]);
  });
});
