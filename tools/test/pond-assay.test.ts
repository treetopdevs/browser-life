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
import { applyPondCycle, assaySeed, cloneWorld, pondConfig, pondMatter, pondTraits, randomKey } from "../lib/ponds.ts";
import {
  ASSAY_COLUMNS,
  M_ASSAY,
  R1DP_REGIME,
  R1DP_SEED_BASE,
  R1DP_SEED_MAX,
  R1DP_SETS,
  R1_PRIME_SEED_MAX,
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
  checkTauSeeds,
  distinctGenomes,
  fragmentDominant,
  parseR1PrimeLabels,
  parseR1dPrimeLabels,
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
  standardFragment,
  swapGenome,
  traitsTable,
  type AssayItem,
  type Fragment,
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
