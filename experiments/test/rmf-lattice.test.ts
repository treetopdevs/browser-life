// Tests for experiments/3d-rps/rmf-lattice.ts, rmf-sweep.ts and (through a spawned deno) rmf-worker.ts: the RMF lattice reference of
// plan 6 and rule draft 2.1 to 2.4 and 2.9. What is checked: the PRNG (published xoshiro128** vector), the derived constants, the
// registered grid and Appendix A's seeds against plan 6's cost figures, the rules of the model (the cycle; reproduction only into empty
// sites and selection only by the killing species, one reaction step at a time; swaps conserve the counts), the module against a second,
// independent implementation of the plan's text (BigInt arithmetic, coordinates computed rather than looked up), the exchange-count
// distribution from the real hot path, absorption and the t = N stop, determinism and a pinned 50-generation hash, the add-one SE, chunks
// and cells (splitting a cell into chunks changes nothing), the sweep's argument and plan code, that a type-stripped copy of the module
// reproduces it hash for hash, and one tiny sweep run through a spawned deno.
// Seeds: every realization run here uses seeds 900 and up (Appendix A: plumbing only); the registered block 2,000,000+ is only
// computed, never run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ABSORB_BINS,
  CONTINGENCY_IM,
  LATTICE_SIZES,
  MAIN_R,
  MAIN_SIZES,
  M_GRID,
  absorptionBin,
  addOneP,
  addOneSE,
  createLattice,
  estimatedEvents,
  finalizeCell,
  generationsRun,
  gridHash,
  hashBytes,
  latticeConstants,
  neighbourTable,
  nextU32,
  preyOf,
  realizationSeed,
  recountGrid,
  runCell,
  runChunk,
  runRealization,
  runSteps,
  setMobility,
  splitmix32Expand,
  stateHash,
  type CellRecord,
  type ChunkJob,
} from "../3d-rps/rmf-lattice.ts";
import {
  REHEARSAL_SEED_BASE_MAX,
  REHEARSAL_SEED_MIN,
  UsageError,
  chunkFileName,
  contingencyPlan,
  describePlan,
  mainPlan,
  parseSweepArgs,
  planChunks,
  planEvents,
  queueOrder,
  rehearsalPlan,
  sweepRefusal,
} from "../3d-rps/rmf-sweep.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const LATTICE_SRC = join(REPO, "experiments/3d-rps/rmf-lattice.ts");

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

/** A second implementation of the PRNG in BigInt arithmetic (no shared code with the module). */
const M32 = 0xffffffffn;
const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & M32;
class RefRng {
  s: bigint[];
  constructor(seed: number) {
    let a = BigInt(seed) & M32;
    this.s = [];
    for (let i = 0; i < 4; i++) {
      a = (a + 0x9e3779b9n) & M32;
      let z = a;
      z = ((z ^ (z >> 16n)) * 0x21f0aaadn) & M32;
      z = ((z ^ (z >> 15n)) * 0x735a2d97n) & M32;
      this.s.push(z ^ (z >> 15n));
    }
  }
  next(): bigint {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & M32, 7n) * 9n) & M32;
    const t = (s[1] << 9n) & M32;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11n);
    return result;
  }
}

/** The model, written again from the plan's text: BigInt draws, neighbours from coordinates, species present recounted every step. */
function refRun(L: number, M: number, K: number, seed: number, maxSteps: number) {
  const N = L * L;
  const eps = (M * N) / 2;
  const q = eps / (1 + 1 + eps);
  const thr = BigInt(Math.min(2 ** 32 - 1, Math.floor(q * 2 ** 32)));
  const rng = new RefRng(seed);
  const grid: number[] = [];
  for (let i = 0; i < N; i++) grid.push(Number((rng.next() * BigInt(K + 1)) >> 32n));
  const neighbour = (i: number, d: number) => {
    const x = i % L;
    const y = Math.floor(i / L);
    const [nx, ny] = d === 0 ? [(x + 1) % L, y] : d === 1 ? [(x - 1 + L) % L, y] : d === 2 ? [x, (y + 1) % L] : [x, (y - 1 + L) % L];
    return ny * L + nx;
  };
  const alive = () => new Set(grid.filter((v) => v > 0)).size;
  let steps = 0;
  let exchanges = 0;
  let absorbedAt = alive() <= 1 ? 0 : -1;
  while (steps < maxSteps && absorbedAt < 0) {
    steps++;
    let e = 0;
    while (rng.next() < thr) e++;
    for (let j = 0; j < e; j++) {
      const a = Number((rng.next() * BigInt(N)) >> 32n);
      const b = neighbour(a, Number(rng.next() >> 30n));
      [grid[a], grid[b]] = [grid[b], grid[a]];
    }
    exchanges += e;
    const a = Number((rng.next() * BigInt(N)) >> 32n);
    const b = neighbour(a, Number(rng.next() >> 30n));
    const u = rng.next();
    if (grid[a] > 0) {
      if (u < 2n ** 31n) {
        if (grid[b] === 0) grid[b] = grid[a];
      } else if (grid[b] === (grid[a] % K) + 1) grid[b] = 0;
    }
    if (alive() <= 1) absorbedAt = steps;
  }
  return { grid, steps, exchanges, absorbedAt };
}

/** Neighbours of site i by coordinates (not the module's table). */
function around(L: number, i: number): number[] {
  const x = i % L;
  const y = Math.floor(i / L);
  return [y * L + ((x + 1) % L), y * L + ((x + L - 1) % L), ((y + 1) % L) * L + x, ((y + L - 1) % L) * L + x];
}

// ---------------------------------------------------------------------------------------------------------------------
// PRNG and constants
// ---------------------------------------------------------------------------------------------------------------------

describe("PRNG", () => {
  it("xoshiro128** reproduces the published vector for the state (1, 2, 3, 4)", () => {
    const s = { s0: 1, s1: 2, s2: 3, s3: 4 };
    expect(Array.from({ length: 10 }, () => nextU32(s))).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804]);
  });

  it("splitmix32 expansion is pinned (the plan does not fix its constants; the module header names them)", () => {
    expect(splitmix32Expand(0)).toEqual([1684164658, 3653269916, 2939563536, 2141751570]);
    expect(splitmix32Expand(900)).toEqual([3112718434, 81025945, 1791630517, 1809561345]);
  });

  it("the BigInt reference RNG draws the same stream as the module's", () => {
    for (const seed of [0, 900, 2_310_599, 4294967295]) {
      const w = splitmix32Expand(seed);
      const mod = { s0: w[0] | 0, s1: w[1] | 0, s2: w[2] | 0, s3: w[3] | 0 };
      const ref = new RefRng(seed);
      for (let i = 0; i < 200; i++) expect(BigInt(nextU32(mod))).toBe(ref.next());
    }
  });
});

describe("constants and the registered grid", () => {
  it("reports epsilon, N, epsilon / N and 2 epsilon / N and the integer thresholds", () => {
    const c = latticeConstants(60, 2e-3);
    expect(c.N).toBe(3600);
    expect(c.epsilon).toBeCloseTo(3.6, 12);
    expect(c.epsOverN).toBeCloseTo(1e-3, 15);
    expect(c.twoEpsOverN).toBeCloseTo(2e-3, 15);
    expect(c.q).toBeCloseTo(3.6 / 5.6, 14);
    expect(c.exchangeThreshold).toBe(Math.floor((3.6 / 5.6) * 2 ** 32));
    expect(c.pExchange).toBe(c.exchangeThreshold / 2 ** 32);
    expect(c.reproduceThreshold).toBe(2 ** 31);
    const none = latticeConstants(20, 0);
    expect(none.epsilon).toBe(0);
    expect(none.exchangeThreshold).toBe(0);
  });

  it("refuses values outside the model", () => {
    expect(() => latticeConstants(2, 1e-3)).toThrow(RangeError);
    expect(() => latticeConstants(20, -1e-3)).toThrow(RangeError);
    expect(() => latticeConstants(20, Number.NaN)).toThrow(RangeError);
    expect(() => latticeConstants(20, 1e-3, 2)).toThrow(RangeError);
    expect(() => createLattice({ L: 20, M: 1e-3, seed: -1 })).toThrow(RangeError);
    expect(() => createLattice({ L: 4, M: 1e-3, seed: 900, initial: new Uint8Array(15) })).toThrow(RangeError);
    expect(() => createLattice({ L: 4, M: 1e-3, seed: 900, initial: new Uint8Array(16).fill(4) })).toThrow(RangeError);
  });

  it("the grid, the Appendix A seed rule and the cost figures are plan 6's", () => {
    expect(MAIN_SIZES).toEqual([20, 30, 40, 60]);
    expect(LATTICE_SIZES).toEqual([20, 30, 40, 60, 100]);
    expect(M_GRID).toHaveLength(11);
    expect(MAIN_R).toBe(600);
    expect(CONTINGENCY_IM.map((i) => M_GRID[i])).toEqual([2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4]);
    expect(realizationSeed(0, 0, 0)).toBe(2_000_000);
    expect(realizationSeed(3, 10, 599)).toBe(2_310_599);
    expect(realizationSeed(4, 8, 299)).toBe(2_408_299);
    expect(() => realizationSeed(0, 0, 1000)).toThrow(RangeError);
    expect(() => realizationSeed(5, 0, 0)).toThrow(RangeError);
    expect(() => realizationSeed(0, 11, 0)).toThrow(RangeError);
    const main = mainPlan();
    expect(main).toHaveLength(44);
    expect(planEvents(main) / 1.5477e11).toBeCloseTo(1, 3); // plan 6: 1.55 x 10^11 (the review recomputed 1.5476 x 10^11)
    expect(planEvents(contingencyPlan()) / 3.9e11).toBeCloseTo(1, 6); // plan 6: 3.9 x 10^11
    expect(estimatedEvents(60, 2e-3, 1)).toBeCloseTo(60 ** 4 * 2.8, 3); // N^2 (1 + epsilon / 2)
    const seeds = new Set<number>();
    for (const c of main) for (const r of [0, MAIN_R - 1]) seeds.add(realizationSeed(c.iL, c.iM, r));
    expect(seeds.size).toBe(88);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The rules of the model
// ---------------------------------------------------------------------------------------------------------------------

describe("the cycle", () => {
  it("species s kills exactly (s mod K) + 1: a single cycle of length K, nobody kills itself", () => {
    expect([1, 2, 3].map((s) => preyOf(s, 3))).toEqual([2, 3, 1]);
    for (const K of [3, 4, 5, 8]) {
      const seen = new Set<number>();
      let s = 1;
      for (let i = 0; i < K; i++) {
        const p = preyOf(s, K);
        expect(p).not.toBe(s);
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(K);
        seen.add(s);
        s = p;
      }
      expect(s).toBe(1); // back at the start after K kills
      expect(seen.size).toBe(K); // through every species once
      expect(preyOf(0, K)).toBe(0);
    }
    expect(Array.from(createLattice({ L: 5, M: 0, seed: 900, K: 5 }).prey)).toEqual([0, 2, 3, 4, 5, 1]);
  });
});

describe("one reaction step at a time (M = 0, so no exchange)", () => {
  for (const K of [3, 4, 5]) {
    it(`K = ${K}: every change is a reproduction into an empty site next to the species, or a selection by a killer next to the victim`, () => {
      const L = 6;
      const bad: string[] = [];
      let none = 0;
      let repro = 0;
      let select = 0;
      let total = 0;
      for (let seed = 900; total < 30_000; seed++) {
        // at K = 4 and 5 and M = 0 a lattice soon freezes full, so each seed contributes its first 800 steps only
        const st = createLattice({ L, M: 0, seed, K });
        for (let own = 0; own < 800 && !st.absorbed && total < 30_000; own++) {
          const before = Uint8Array.from(st.grid);
          if (runSteps(st, 1) !== 1) bad.push("runSteps(1) did not run one step");
          total++;
          const changed: number[] = [];
          for (let i = 0; i < st.N; i++) if (before[i] !== st.grid[i]) changed.push(i);
          if (changed.length === 0) {
            none++;
            continue;
          }
          if (changed.length !== 1) {
            bad.push(`${changed.length} sites changed in one step`);
            continue;
          }
          const b = changed[0];
          const nbr = around(L, b).map((i) => before[i]);
          if (before[b] === 0 && st.grid[b] > 0) {
            repro++;
            if (!nbr.includes(st.grid[b])) bad.push(`species ${st.grid[b]} appeared at ${b} with no such neighbour`);
          } else if (before[b] > 0 && st.grid[b] === 0) {
            select++;
            if (!nbr.some((s) => s > 0 && preyOf(s, K) === before[b])) bad.push(`species ${before[b]} vanished at ${b} with no killer next to it`);
          } else bad.push(`illegal change ${before[b]} -> ${st.grid[b]} at ${b}`);
          if (st.exchanges !== 0) bad.push("an exchange happened at M = 0");
        }
      }
      expect(bad).toEqual([]);
      expect(repro).toBeGreaterThan(300);
      expect(select).toBeGreaterThan(300);
      expect(none).toBeGreaterThan(1000); // attempts that do nothing still count
    });
  }
});

describe("exchanges conserve the species counts", () => {
  it("at large M the counts change only by one reproduction or one selection per step, and always equal a recount of the grid", () => {
    const bad: string[] = [];
    for (const K of [3, 5]) {
      const st = createLattice({ L: 8, M: 0.5, seed: 910 + K, K }); // epsilon = 16: about 8 exchanges per reaction step
      for (let step = 0; step < 4000 && !st.absorbed; step++) {
        const before = Int32Array.from(st.counts);
        runSteps(st, 1);
        const recount = recountGrid(st);
        if (recount.some((v, i) => v !== st.counts[i])) bad.push(`counts differ from a recount at step ${step}`);
        if (st.counts.reduce((a, b) => a + b, 0) !== st.N) bad.push("counts do not sum to N");
        const delta = Array.from(st.counts, (v, i) => v - before[i]);
        const nonzero = delta.filter((d) => d !== 0).length;
        const ok = nonzero === 0 || (nonzero === 2 && delta[0] !== 0 && Math.abs(delta[0]) === 1 && delta.reduce((a, b) => a + b, 0) === 0);
        if (!ok) bad.push(`count change ${delta.join(",")} at step ${step}`);
      }
      expect(st.exchanges / st.steps).toBeGreaterThan(5);
    }
    expect(bad).toEqual([]);
  });

  it("heavy exchange (epsilon 25, hops into empty sites and swaps of species alike) moves the grid exactly as the reference does", () => {
    const ref = refRun(5, 2, 3, 920, 300); // epsilon = 25: about 12 exchanges per reaction step
    const st = createLattice({ L: 5, M: 2, seed: 920 });
    runSteps(st, 300);
    expect(Array.from(st.grid)).toEqual(ref.grid);
    expect(st.exchanges).toBe(ref.exchanges);
    expect(ref.exchanges).toBeGreaterThan(1000);
  });
});

describe("the module against an independent implementation of the plan's text", () => {
  const cases: Array<[number, number, number, number, number]> = [
    // L, M, K, seed, max steps
    [6, 0, 3, 900, 3000],
    [8, 1e-3, 3, 901, 5000],
    [10, 0.02, 3, 902, 4000],
    [20, 2e-3, 3, 903, 60_000],
    [7, 0.5, 4, 904, 400],
    [9, 0.1, 5, 905, 2000],
    [20, 3e-4, 3, 906, 20_000],
    [12, 2e-3, 3, 907, 30_000],
  ];
  for (const [L, M, K, seed, steps] of cases) {
    it(`L ${L}, M ${M}, K ${K}, seed ${seed}: same grid, counters and absorption step after up to ${steps} steps`, () => {
      const ref = refRun(L, M, K, seed, steps);
      const st = createLattice({ L, M, seed, K });
      runSteps(st, steps);
      expect(Array.from(st.grid)).toEqual(ref.grid);
      expect(st.steps).toBe(ref.steps);
      expect(st.exchanges).toBe(ref.exchanges);
      expect(st.absorbedAtStep).toBe(ref.absorbedAt);
      expect(st.absorbed).toBe(ref.absorbedAt >= 0);
      expect(neighbourTable(L)).toHaveLength(4 * L * L);
    });
  }
  it("the cases include runs that absorbed and runs that did not", () => {
    const absorbed = (L: number, M: number, K: number, seed: number, steps: number) => {
      const st = createLattice({ L, M, seed, K });
      runSteps(st, steps);
      return st.absorbed;
    };
    expect(absorbed(12, 2e-3, 3, 907, 30_000)).toBe(true);
    expect(absorbed(6, 0, 3, 900, 3000)).toBe(true);
    expect(absorbed(20, 2e-3, 3, 903, 60_000)).toBe(false);
    expect(absorbed(7, 0.5, 4, 904, 400)).toBe(false);
  });
});

describe("the neighbour table is a torus", () => {
  it("four distinct neighbours, symmetric, wrapping at every edge", () => {
    for (const L of [3, 5, 20]) {
      const t = neighbourTable(L);
      for (let i = 0; i < L * L; i++) {
        expect(Array.from(t.subarray(4 * i, 4 * i + 4))).toEqual(around(L, i));
        expect(t[4 * t[4 * i] + 1]).toBe(i); // +x then -x
        expect(t[4 * t[4 * i + 2] + 3]).toBe(i); // +y then -y
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The exchange count
// ---------------------------------------------------------------------------------------------------------------------

describe("the exchange count per reaction step", () => {
  for (const [L, M, seed] of [[60, 2e-3, 900], [40, 3e-4, 901]] as const) {
    it(`L ${L}, M ${M}: the histogram of E from the real loop is geometric with the trial probability floor(q 2^32) / 2^32`, () => {
      const st = createLattice({ L, M, seed, exchangeHistogramBins: 12 });
      const n = 300_000;
      expect(runSteps(st, n)).toBe(n); // no absorption in this many steps
      const p = st.constants.pExchange;
      const h = st.exchangeHistogram!;
      let chi2 = 0;
      for (let e = 0; e < 12; e++) {
        const pe = e < 11 ? p ** e * (1 - p) : p ** 11; // the last bin is "11 or more"
        const expected = n * pe;
        chi2 += (h[e] - expected) ** 2 / expected;
      }
      expect(Array.from(h).reduce((a, b) => a + b, 0)).toBe(n);
      expect(chi2).toBeLessThan(31.3); // df = 11, p = 0.001 (the seed is fixed: this is a pinned outcome, not a flaky test)
      const mean = p / (1 - p); // = q / (1 - q) = epsilon / 2 up to the rounding of the threshold
      expect(st.exchanges / st.steps).toBeGreaterThan(mean - 0.02);
      expect(st.exchanges / st.steps).toBeLessThan(mean + 0.02);
      expect(mean).toBeCloseTo(st.constants.epsilon / 2, 6);
    });
  }

  it("no exchange at M = 0, and exchanges per step ~ epsilon / 2 across the grid's range of M", () => {
    const none = createLattice({ L: 20, M: 0, seed: 902 });
    runSteps(none, 5000);
    expect(none.exchanges).toBe(0);
    const low = createLattice({ L: 20, M: 1e-5, seed: 903 }); // epsilon = 0.002
    runSteps(low, 160_000);
    expect(low.exchanges).toBeGreaterThan(40); // expected 160
    expect(low.exchanges).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Absorption and the t = N stop
// ---------------------------------------------------------------------------------------------------------------------

describe("absorption and the horizon", () => {
  it("a start with at most one species is absorbed at step 0 and nothing runs", () => {
    for (const species of [0, 1, 3]) {
      const initial = new Uint8Array(25);
      if (species) for (let i = 0; i < 25; i += 2) initial[i] = species;
      const st = createLattice({ L: 5, M: 1e-3, seed: 900, initial });
      expect(st.absorbed).toBe(true);
      expect(st.absorbedAtStep).toBe(0);
      const hash = stateHash(st);
      expect(runSteps(st, 1000)).toBe(0);
      expect(st.steps).toBe(0);
      expect(stateHash(st)).toBe(hash);
    }
  });

  it("a lone prey next to its predator is eaten, the run stops that step, and a second species dying with two left is not absorption", () => {
    // K = 3, M = 0: species 1 everywhere except one site of species 2, which species 1 kills (2 is not empty-adjacent: no free site)
    const initial = new Uint8Array(25).fill(1);
    initial[12] = 2;
    const st = createLattice({ L: 5, M: 0, seed: 900, initial });
    expect(st.alive).toBe(2);
    expect(st.absorbed).toBe(false);
    const ran = runSteps(st, 100_000);
    expect(st.absorbed).toBe(true);
    expect(ran).toBe(st.steps);
    expect(st.absorbedAtStep).toBe(st.steps);
    expect(st.steps).toBeGreaterThan(0);
    expect(st.steps).toBeLessThan(100_000);
    expect(Array.from(st.counts)).toEqual([1, 24, 0, 0]); // the victim's site is empty now
    expect(runSteps(st, 10)).toBe(0);
    // K = 4: species 1 and 3 never touch each other (1 kills 2, 3 kills 4); a lone 2 is eaten by 1 and two species remain
    const four = new Uint8Array(36);
    for (let i = 0; i < 36; i++) four[i] = i % 3 === 0 ? 3 : 1;
    four[1] = 2;
    const s4 = createLattice({ L: 6, M: 0, seed: 901, K: 4, initial: four });
    expect(s4.alive).toBe(3);
    runSteps(s4, 100_000);
    expect(s4.counts[2]).toBe(0);
    expect(s4.alive).toBe(2);
    expect(s4.absorbed).toBe(false);
  });

  it("without absorption a run stops after exactly N generations (N^2 reaction steps)", () => {
    // K = 4 with only species 1 and 3 present: they never interact, so nothing can absorb the lattice
    const initial = new Uint8Array(16);
    initial[0] = 1;
    initial[5] = 3;
    const st = createLattice({ L: 4, M: 1e-3, seed: 902, K: 4, initial });
    expect(runSteps(st, 16 * 16)).toBe(256);
    expect(st.steps).toBe(256);
    expect(generationsRun(st)).toBe(16);
    expect(st.absorbed).toBe(false);
    expect(st.alive).toBe(2);
  });

  it("runRealization: invariants for both outcomes (L 20)", () => {
    let absorbedRuns = 0;
    let openRuns = 0;
    for (let seed = 900; seed < 912; seed++) {
      for (const M of [1e-5, 2e-3]) {
        const r = runRealization(20, M, seed);
        expect(r.constants).toEqual(latticeConstants(20, M)); // epsilon, N, epsilon / N, 2 epsilon / N come with every run
        const present = r.counts.slice(1).filter((c) => c > 0).length;
        expect(r.counts.reduce((a, b) => a + b, 0)).toBe(400);
        if (r.absorbed) {
          absorbedRuns++;
          expect(present).toBeLessThanOrEqual(1);
          expect(r.absorbedAtStep).toBeGreaterThanOrEqual(0);
          expect(r.absorbedAtStep).toBe(r.steps);
          expect(r.steps).toBeLessThanOrEqual(400 * 400);
        } else {
          openRuns++;
          expect(present).toBeGreaterThanOrEqual(2);
          expect(r.steps).toBe(400 * 400); // t = N generations
          expect(r.absorbedAtStep).toBe(-1);
        }
      }
    }
    expect(absorbedRuns).toBeGreaterThan(3);
    expect(openRuns).toBeGreaterThan(3);
  });

  it("the absorption histogram bins are tenths of N generations, (b N / 10, (b + 1) N / 10]", () => {
    const N = 400;
    const N2 = N * N;
    expect(absorptionBin(0, N)).toBe(0);
    expect(absorptionBin(1, N)).toBe(0);
    expect(absorptionBin(N2 / 10, N)).toBe(0);
    expect(absorptionBin(N2 / 10 + 1, N)).toBe(1);
    expect(absorptionBin((N2 * 5) / 10, N)).toBe(4);
    expect(absorptionBin(N2 - 1, N)).toBe(9);
    expect(absorptionBin(N2, N)).toBe(9);
    expect(ABSORB_BINS).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Mean-field sanity (rule draft: at large M the densities stay near 1/4)
// ---------------------------------------------------------------------------------------------------------------------

describe("well mixed", () => {
  it("at large M the densities of empty, 1, 2, 3 stay near 1/4 over the first generations (a wrong mu : sigma would put empty at 0.1 or 0.4)", () => {
    const L = 20;
    const sums = [0, 0, 0, 0];
    let samples = 0;
    let worst = 0;
    for (let seed = 930; seed < 938; seed++) {
      const st = createLattice({ L, M: 1, seed }); // epsilon = 200: about 100 exchanges per reaction step
      for (let g = 1; g <= 5; g++) {
        runSteps(st, st.N);
        for (let s = 0; s < 4; s++) {
          const d = st.counts[s] / st.N;
          sums[s] += d;
          worst = Math.max(worst, Math.abs(d - 0.25));
        }
        samples++;
      }
    }
    for (let s = 0; s < 4; s++) expect(Math.abs(sums[s] / samples - 0.25)).toBeLessThan(0.03);
    expect(worst).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------------------------------------------------

/** Hash of the 50-generation trajectory: the grid hash after every generation, chained. */
function trajectoryHash(L: number, M: number, seed: number, generations: number): { chain: string; state: string; grid: string } {
  const st = createLattice({ L, M, seed });
  const parts: number[] = [];
  for (let g = 0; g < generations; g++) {
    runSteps(st, st.N);
    for (const ch of gridHash(st)) parts.push(ch.charCodeAt(0));
  }
  return { chain: hashBytes(Uint8Array.from(parts)), state: stateHash(st), grid: gridHash(st) };
}

describe("determinism", () => {
  it("the same seed gives the same trajectory hash, another seed another one", () => {
    const a = trajectoryHash(20, 3e-4, 900, 50);
    const b = trajectoryHash(20, 3e-4, 900, 50);
    expect(b).toEqual(a);
    expect(trajectoryHash(20, 3e-4, 901, 50).chain).not.toBe(a.chain);
    expect(trajectoryHash(20, 4e-4, 900, 50).chain).not.toBe(a.chain);
  });

  it("pinned: L 20, M 3e-4, seed 900, after 50 generations", () => {
    // gridHash is also what the independent C implementation of the draw order printed for the same configuration
    const a = trajectoryHash(20, 3e-4, 900, 50);
    expect(a.grid).toBe("7e1cc45a6fd59745");
    expect(a.state).toBe("ae485a6f0090347d");
    expect(a.chain).toBe("638df29dae264a8b"); // the grid hash after each of the 50 generations, chained
  });

  it("a run in pieces is the same trajectory as one run", () => {
    const whole = createLattice({ L: 20, M: 3e-4, seed: 900 });
    runSteps(whole, 20_000);
    const parts = createLattice({ L: 20, M: 3e-4, seed: 900 });
    for (let done = 0; done < 20_000; ) done += runSteps(parts, Math.min(37, 20_000 - done));
    expect(stateHash(parts)).toBe(stateHash(whole));
    expect(parts.steps).toBe(20_000);
  });

  it("setMobility changes only the exchange constants: grid and stream are untouched, and the change is deterministic", () => {
    const a = createLattice({ L: 20, M: 1e-4, seed: 900 });
    runSteps(a, 8000);
    const hash = stateHash(a);
    setMobility(a, 1e-3);
    expect(stateHash(a)).toBe(hash);
    expect(a.constants.M).toBe(1e-3);
    expect(a.constants.epsilon).toBeCloseTo(0.2, 12);
    const b = createLattice({ L: 20, M: 1e-4, seed: 900 });
    runSteps(b, 8000);
    setMobility(b, 1e-3);
    runSteps(a, 8000);
    runSteps(b, 8000);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(() => setMobility(a, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The add-one estimate
// ---------------------------------------------------------------------------------------------------------------------

describe("the add-one standard error", () => {
  it("is never 0, also for a count of 0 or R", () => {
    expect(addOneSE(0, 600)).toBeGreaterThan(0);
    expect(addOneSE(600, 600)).toBeGreaterThan(0);
    expect(addOneSE(0, 600)).toBeCloseTo(addOneSE(600, 600), 14); // symmetric (not bit for bit: 1 - 601/602 is not 1/602 in floating point)
    expect(addOneP(0, 600)).toBe(1 / 602);
    expect(addOneSE(0, 600)).toBeCloseTo(Math.sqrt(((1 / 602) * (601 / 602)) / 602), 14);
    expect(addOneSE(0, 600)).toBeCloseTo(0.0016597, 7); // hand value: sqrt(601) / 602^1.5
  });
  it("matches p' = (k + 1) / (R + 2) and sqrt(p' (1 - p') / (R + 2))", () => {
    expect(addOneP(299, 598)).toBe(0.5);
    expect(addOneSE(300, 600)).toBeCloseTo(Math.sqrt(((301 / 602) * (301 / 602)) / 602), 15);
    expect(addOneSE(300, 600)).toBeCloseTo(0.02038, 5);
    expect(addOneSE(1, 1)).toBeCloseTo(Math.sqrt(((2 / 3) * (1 / 3)) / 3), 15);
  });
  it("refuses a count outside 0..R", () => {
    expect(() => addOneSE(-1, 600)).toThrow(RangeError);
    expect(() => addOneSE(601, 600)).toThrow(RangeError);
    expect(() => addOneSE(0, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Chunks and cells (tiny runs)
// ---------------------------------------------------------------------------------------------------------------------

const JOB = { L: 20, M: 2e-3, K: 3, iL: 0, iM: 10, seedBase: 900 };

describe("chunks and cells", () => {
  it("a tiny cell: L 20, M 2e-3, 40 realizations from seed 900 (the rehearsal's cell, shorter)", () => {
    const cell = runCell({ ...JOB, R: 40 });
    expect(cell.format).toBe("rmf-cell/1");
    expect(cell.R).toBe(40);
    expect(cell.k).toBeGreaterThan(26); // P_ext(20, 2e-3) is about 0.87 in the scratch grid
    expect(cell.k).toBeLessThanOrEqual(40);
    expect(cell.pExt).toBe(cell.k / 40);
    expect(cell.pAddOne).toBe((cell.k + 1) / 42);
    expect(cell.se).toBe(addOneSE(cell.k, 40));
    expect(cell.absorbedBy).toHaveLength(10);
    expect(cell.absorbedBy.reduce((a, b) => a + b, 0)).toBe(cell.k);
    expect(cell.seeds).toEqual([900, 939]);
    expect(cell.events).toBe(cell.reactionSteps + cell.exchanges);
    expect(cell.exchanges / cell.reactionSteps).toBeGreaterThan(0.19); // epsilon / 2 = 0.2
    expect(cell.exchanges / cell.reactionSteps).toBeLessThan(0.21);
    expect(cell.N).toBe(400);
    expect(cell.epsilon).toBeCloseTo(0.4, 12);
    expect(cell.epsOverN).toBeCloseTo(1e-3, 15);
    expect(cell.twoEpsOverN).toBeCloseTo(2e-3, 15);
    expect(cell.seconds).toBe(0); // no clock given
    expect(cell.eventsPerSecond).toBeNull();
    expect(runCell({ ...JOB, R: 40 })).toEqual(cell); // deterministic
  });

  it("the cell is the sum of its realizations, whatever the chunking and the order they arrive in", () => {
    const whole = runCell({ ...JOB, R: 12 });
    const jobs: ChunkJob[] = [
      { ...JOB, rStart: 0, rEnd: 5 },
      { ...JOB, rStart: 5, rEnd: 10 },
      { ...JOB, rStart: 10, rEnd: 12 },
    ];
    const parts = jobs.map((j) => runChunk(j));
    const merged = finalizeCell([parts[2], parts[0], parts[1]]);
    expect(merged.k).toBe(whole.k);
    expect(merged.absorbedBy).toEqual(whole.absorbedBy);
    expect(merged.reactionSteps).toBe(whole.reactionSteps);
    expect(merged.exchanges).toBe(whole.exchanges);
    expect(merged.seeds).toEqual(whole.seeds);
    expect(merged.chunks).toBe(3);
    // and each realization is what runRealization says
    let k = 0;
    for (let r = 0; r < 12; r++) if (runRealization(20, 2e-3, 900 + r).absorbed) k++;
    expect(k).toBe(whole.k);
  });

  it("k counts the realizations with at most one species left, not those where only species 1 is gone (conformance F11, m35)", () => {
    const R = 30;
    const cell = runCell({ ...JOB, R });
    let k = 0;
    let onlyOneGone = 0;
    for (let r = 0; r < R; r++) {
      const x = runRealization(20, 2e-3, 900 + r);
      if (x.absorbed) k++;
      else if (x.counts[1] === 0) onlyOneGone++;
    }
    // seed 926: species 2 and 3 are both still there at t = N, species 1 is gone; it is not an absorbed run
    expect(onlyOneGone).toBeGreaterThan(0);
    expect(cell.k).toBe(k);
    expect(cell.absorbedBy.reduce((a, b) => a + b, 0)).toBe(k);
  });

  it("measures seconds, steps per second and events per second from the clock it is given", () => {
    let now = 0;
    const clock = () => (now += 500); // 500 ms between the two readings of one chunk
    const cell = runCell({ ...JOB, R: 6 }, clock);
    expect(cell.seconds).toBe(0.5);
    expect(cell.stepsPerSecond).toBe(cell.reactionSteps / 0.5);
    expect(cell.eventsPerSecond).toBe(cell.events / 0.5);
  });

  it("refuses chunks that do not tile one cell", () => {
    const a = runChunk({ ...JOB, rStart: 0, rEnd: 3 });
    const b = runChunk({ ...JOB, rStart: 3, rEnd: 6 });
    const gap = runChunk({ ...JOB, rStart: 4, rEnd: 6 });
    const other = runChunk({ ...JOB, iM: 9, M: 1e-3, rStart: 3, rEnd: 6 });
    expect(() => finalizeCell([])).toThrow();
    expect(() => finalizeCell([a, gap])).toThrow(/tile/);
    expect(() => finalizeCell([a, a])).toThrow(/tile/);
    expect(() => finalizeCell([a, other])).toThrow(/different cells/);
    expect(finalizeCell([b.rStart === 3 ? a : b, b]).R).toBe(6);
    expect(() => runChunk({ ...JOB, rStart: 5, rEnd: 4 })).toThrow(RangeError);
    expect(() => runChunk({ ...JOB, rStart: 0, rEnd: 1001 })).toThrow(RangeError);
  });

  it("registered seeds follow Appendix A when no seed base is given", () => {
    const job = { L: 20, M: 2e-3, K: 3, iL: 0, iM: 10, seedBase: null } as const;
    // computed, not run: the registered block is never used by a test
    expect(realizationSeed(job.iL, job.iM, 0)).toBe(2_010_000);
    expect(realizationSeed(job.iL, job.iM, 7)).toBe(2_010_007);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The sweep's pure code
// ---------------------------------------------------------------------------------------------------------------------

describe("sweep arguments and plans", () => {
  it("exactly one of --sweep and --rehearsal, and a registered sweep has no default output directory", () => {
    expect(() => parseSweepArgs([])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--sweep", "--rehearsal"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--sweep"])).toThrow(/--out/);
    expect(() => parseSweepArgs(["--out=x"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--sweep", "--out=x", "--R=5"])).toThrow(/not allowed/);
    expect(() => parseSweepArgs(["--sweep", "--out=x", "--seed-base=900"])).toThrow(/not allowed/);
    expect(() => parseSweepArgs(["--sweep", "--out=x", "--iM=3"])).toThrow(/not allowed/);
    expect(() => parseSweepArgs(["--sweep", "--out=x", "--contingency", "--sizes=20"])).toThrow(/not allowed/);
    expect(() => parseSweepArgs(["--sweep", "--out=x", "--sizes=100"])).toThrow(/main grid/);
    expect(() => parseSweepArgs(["--rehearsal", "--contingency"])).toThrow(/not allowed/);
    expect(() => parseSweepArgs(["--rehearsal", "--sizes=25"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--rehearsal", "--iM=11"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--rehearsal", "--R=0"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--rehearsal", "--workers=x"])).toThrow(UsageError);
    expect(() => parseSweepArgs(["--rehearsal", "--bogus"])).toThrow(/unknown flag/);
    expect(() => parseSweepArgs(["--rehearsal", "--out"])).toThrow(/needs a value/);
    expect(() => parseSweepArgs(["--rehearsal=1"])).toThrow(/no value/);
    expect(() => parseSweepArgs(["--rehearsal", "--only=L99-iM1"])).toThrow(/not a cell/);
    expect(() => parseSweepArgs(["stray"])).toThrow(/unrecognized/);
  });

  it("the defaults: the rehearsal is rule draft 2.9's, the sweep is the grid of 2.2", () => {
    const reh = parseSweepArgs(["--rehearsal"]);
    expect(reh.mode).toBe("rehearsal");
    expect(reh.out).toBe("runs/rps/rehearsal");
    expect(reh.plan).toHaveLength(1);
    expect(reh.plan[0]).toMatchObject({ id: "L20-iM10", L: 20, M: 2e-3, R: 50, seedBase: 900, K: 3 });
    const sw = parseSweepArgs(["--sweep", "--out=some/dir/"]);
    expect(sw).toMatchObject({ mode: "sweep", out: "some/dir", workers: 8, chunk: 50 });
    expect(sw.plan).toHaveLength(44);
    expect(sw.plan.every((c) => c.R === 600 && c.seedBase === null)).toBe(true);
    const con = parseSweepArgs(["--sweep", "--out=x", "--contingency"]);
    expect(con.plan.map((c) => c.id)).toEqual(["L100-iM3", "L100-iM4", "L100-iM5", "L100-iM6", "L100-iM7", "L100-iM8"]);
    expect(con.plan.every((c) => c.R === 300 && c.L === 100)).toBe(true);
    expect(parseSweepArgs(["--sweep", "--out=x", "--sizes=20,30"]).plan).toHaveLength(22);
    expect(parseSweepArgs(["--sweep", "--out=x", "--only=L60-iM4,L20-iM0"]).plan.map((c) => c.id)).toEqual(["L20-iM0", "L60-iM4"]);
    expect(parseSweepArgs(["--rehearsal", "--sizes=20,30", "--iM=3,4", "--R=7", "--seed-base=910", "--chunk=3", "--workers=2"]).plan).toHaveLength(4);
  });

  it("a rehearsal never takes seeds from the registered block or a review's scratch block: --seed-base is 900 to 999,000 (conformance F14)", () => {
    expect(REHEARSAL_SEED_MIN).toBe(900);
    expect(REHEARSAL_SEED_BASE_MAX).toBe(999_000);
    expect(parseSweepArgs(["--rehearsal", "--seed-base=900"]).plan[0].seedBase).toBe(900);
    expect(parseSweepArgs(["--rehearsal", "--seed-base=999000", "--R=1000"]).plan[0].seedBase).toBe(999_000);
    for (const bad of ["0", "899", "999001", "2000000", "2100000", "3500000", "4294966295"]) {
      expect(() => parseSweepArgs(["--rehearsal", `--seed-base=${bad}`]), bad).toThrow(/--seed-base must be an integer in \[900, 999000\]/);
    }
  });

  it("a registered sweep starts only after the freeze: RULES.md must exist and have its SHA-256 recorded in FROZEN (conformance F14)", () => {
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const rules = new TextEncoder().encode("rules v1\n");
    const frozen = `${sha("rules v1\n")}  RULES.md\n`;
    expect(sweepRefusal(rules, frozen)).toBeNull();
    expect(sweepRefusal(null, frozen)).toMatch(/experiments\/3d-rps\/RULES\.md does not exist/);
    expect(sweepRefusal(rules, null)).toMatch(/experiments\/3d-rps\/FROZEN does not exist/);
    expect(sweepRefusal(new TextEncoder().encode("rules v2\n"), frozen)).toMatch(/starts only after the freeze: RULES\.md has sha256/);
    expect(sweepRefusal(rules, "")).toMatch(/FROZEN has no hash for RULES\.md/);
    // any recorded hash of the file counts (a dated amendment records its new one beside the old), bare or named
    expect(sweepRefusal(rules, `# frozen\n${sha("old")}  RULES.md\n${sha("rules v1\n")}\n`)).toBeNull();
    expect(sweepRefusal(rules, `${sha("rules v1\n")}  GATE0-RECORD.md\n`)).toMatch(/FROZEN has no hash for RULES\.md/);
    // a dated line records a file too (the Gate-0 record is appended in one), and the sweep needs RULES.md's own
    expect(sweepRefusal(rules, `2026-10-26  ${sha("rules v1\n")}  RULES.md\n`)).toBeNull();
  });

  it("chunks tile each cell exactly; the queue starts with the dearest cell", () => {
    for (const [R, chunk] of [[600, 50], [300, 50], [50, 10], [7, 3], [1, 5]] as const) {
      const cell = rehearsalPlan({ sizes: [20], iMs: [3], R, seedBase: 900 })[0];
      const chunks = planChunks(cell, chunk);
      expect(chunks[0].rStart).toBe(0);
      expect(chunks[chunks.length - 1].rEnd).toBe(R);
      for (let i = 1; i < chunks.length; i++) expect(chunks[i].rStart).toBe(chunks[i - 1].rEnd);
      expect(chunks.every((c) => c.rEnd - c.rStart <= chunk && c.rEnd > c.rStart)).toBe(true);
    }
    expect(chunkFileName({ ...JOB, rStart: 0, rEnd: 50 })).toBe("L20-iM10-r0000-0050.json");
    const order = queueOrder(mainPlan(), false).map((c) => c.id);
    expect(order.slice(0, 11).every((id) => id.startsWith("L60-"))).toBe(true);
    expect(order[0]).toBe("L60-iM10");
    expect(order[43]).toBe("L20-iM0");
    expect(queueOrder(mainPlan(), true)[0].id).toBe("L20-iM0");
    expect(describePlan(parseSweepArgs(["--sweep", "--out=x", "--sizes=20"]))).toHaveLength(13); // header, 11 cells, bound
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The module in a browser: a type-stripped copy reproduces it hash for hash
// ---------------------------------------------------------------------------------------------------------------------

describe("type-stripped copy (the companion page's)", () => {
  it("has no imports and touches no host API", () => {
    // code only: the header comments name the APIs the module does not use
    const src = readFileSync(LATTICE_SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(|\bDeno\b|\bprocess\b|\bwindow\b|\bdocument\b|\bglobalThis\b|performance\.|Date\.now|Math\.random|crypto\./);
    expect(src).not.toMatch(/^\s*(export\s+)?(enum|namespace)\b/m);
    expect(src).not.toMatch(/constructor\s*\(\s*(public|private|protected|readonly)\b/);
  });

  it("strips with Node's type stripper and the copy draws the same first frame and the same state after 20,000 steps", async () => {
    const mod = (await import("node:module")) as unknown as { stripTypeScriptTypes?: (code: string, o?: { mode?: string }) => string };
    if (typeof mod.stripTypeScriptTypes !== "function") return; // an older Node: nothing to strip with
    const js = mod.stripTypeScriptTypes(readFileSync(LATTICE_SRC, "utf8"), { mode: "strip" }).replace(/^export /gm, "");
    const copy = new Function(`${js}\nreturn { createLattice, runSteps, gridHash, stateHash, runRealization };`)() as {
      createLattice: typeof createLattice;
      runSteps: typeof runSteps;
      gridHash: typeof gridHash;
      stateHash: typeof stateHash;
      runRealization: typeof runRealization;
    };
    const a = createLattice({ L: 20, M: 3e-4, seed: 900 });
    const b = copy.createLattice({ L: 20, M: 3e-4, seed: 900 });
    expect(copy.gridHash(b)).toBe(gridHash(a)); // the first frame
    runSteps(a, 20_000);
    copy.runSteps(b, 20_000);
    expect(copy.stateHash(b)).toBe(stateHash(a));
    expect(copy.runRealization(20, 2e-3, 905)).toEqual(runRealization(20, 2e-3, 905));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// One tiny sweep through a spawned deno (the worker path, the files, the resume)
// ---------------------------------------------------------------------------------------------------------------------

const HAS_DENO = spawnSync("deno", ["--version"], { encoding: "utf8" }).status === 0;
const tmp = mkdtempSync(join(tmpdir(), "rmf-sweep-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const sweep = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "experiments/3d-rps/rmf-sweep.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 120_000 });

describe.skipIf(!HAS_DENO)("rmf-sweep.ts, spawned", () => {
  const out = join(tmp, "reh");
  const args = ["--rehearsal", `--out=${out}`, "--sizes=20", "--iM=9,10", "--R=6", "--chunk=2", "--workers=2", "--seed-base=910"];

  it("writes one JSON per cell, equal to the in-process cell, and one file per chunk", () => {
    const r = sweep(args);
    expect(r.status, r.stderr).toBe(0);
    for (const iM of [9, 10]) {
      const rec = JSON.parse(readFileSync(join(out, `L20-iM${iM}.json`), "utf8")) as CellRecord & Record<string, unknown>;
      const mine = runCell({ L: 20, M: M_GRID[iM], K: 3, iL: 0, iM, seedBase: 910, R: 6 });
      expect(rec).toMatchObject({ L: 20, iM, R: 6, K: 3, mode: "rehearsal", chunks: 3, chunkSize: 2, workers: 2 });
      expect(rec.k).toBe(mine.k);
      expect(rec.absorbedBy).toEqual(mine.absorbedBy);
      expect(rec.reactionSteps).toBe(mine.reactionSteps);
      expect(rec.exchanges).toBe(mine.exchanges);
      expect(rec.seeds).toEqual([910, 915]);
      expect(rec.pExt).toBe(rec.k / 6);
      expect(rec.se).toBe(addOneSE(rec.k, 6));
      expect(rec.seconds).toBeGreaterThan(0);
      expect(rec.eventsPerSecond).toBeGreaterThan(0);
      expect(typeof rec.host).toBe("string");
      expect(String(rec.runtime)).toMatch(/^deno /);
      expect(Array.isArray(rec.loadavg)).toBe(true);
      expect(String(rec.latticeSha256)).toMatch(/^[0-9a-f]{64}$/);
      expect(readdirSync(join(out, "chunks")).filter((f) => f.startsWith(`L20-iM${iM}-`))).toHaveLength(3);
    }
  });

  it("a second run skips finished cells, and a lost cell file is rebuilt from the chunk files without running anything", () => {
    const first = statSync(join(out, "L20-iM10.json")).mtimeMs;
    const again = sweep(args);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/2 already done, 0 chunks to run/);
    expect(statSync(join(out, "L20-iM10.json")).mtimeMs).toBe(first);
    const before = JSON.parse(readFileSync(join(out, "L20-iM9.json"), "utf8")) as CellRecord;
    rmSync(join(out, "L20-iM9.json"));
    const rebuilt = sweep(args);
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    expect(rebuilt.stdout).toMatch(/1 already done, 0 chunks to run \(3 chunk files reused\)/);
    const after = JSON.parse(readFileSync(join(out, "L20-iM9.json"), "utf8")) as CellRecord;
    expect(after.k).toBe(before.k);
    expect(after.reactionSteps).toBe(before.reactionSteps);
    expect(after.seconds).toBe(before.seconds);
  });

  it("refuses to skip a cell file written under other settings, and a registered sweep without --out or with --R", () => {
    const mismatch = sweep([...args.filter((a) => !a.startsWith("--R=")), "--R=8"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toMatch(/written under other settings/);
    expect(sweep(["--sweep"]).status).toBe(2);
    expect(sweep(["--sweep", `--out=${join(tmp, "never")}`, "--R=3"]).status).toBe(2);
    expect(sweep([]).status).toBe(2);
    expect(existsSync(join(tmp, "never"))).toBe(false);
  });

  it("refuses cell files and chunk files written by another version of rmf-lattice.ts", () => {
    const stale = join(tmp, "stale");
    const a = ["--rehearsal", `--out=${stale}`, "--sizes=20", "--iM=10", "--R=4", "--chunk=2", "--workers=1", "--seed-base=910"];
    expect(sweep(a).status).toBe(0);
    const cellFile = join(stale, "L20-iM10.json");
    const chunkFile = join(stale, "chunks", "L20-iM10-r0000-0002.json");
    const wrongSha = (file: string) => writeFileSync(file, readFileSync(file, "utf8").replace(/"latticeSha256": "[0-9a-f]{64}"/, `"latticeSha256": "${"0".repeat(64)}"`));
    const sound = readFileSync(cellFile, "utf8");
    wrongSha(cellFile);
    const cellRun = sweep(a);
    expect(cellRun.status).toBe(1);
    expect(cellRun.stderr).toMatch(/another version of rmf-lattice\.ts/);
    writeFileSync(cellFile, sound);
    expect(sweep(a).status).toBe(0); // the sound cell file is skipped again
    rmSync(cellFile); // now the chunk files are consulted
    wrongSha(chunkFile);
    const chunkRun = sweep(a);
    expect(chunkRun.status).toBe(1);
    expect(chunkRun.stderr).toMatch(/another version of rmf-lattice\.ts/);
    expect(existsSync(cellFile)).toBe(false); // nothing was merged
  });

  it("--dry-run prints the plan and writes nothing", () => {
    const dry = sweep(["--sweep", `--out=${join(tmp, "dry")}`, "--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/44 cells/);
    expect(dry.stdout).toMatch(/events upper bound 1\.548e\+11/);
    expect(existsSync(join(tmp, "dry"))).toBe(false);
  });
});
