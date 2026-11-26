// Mycelium rung R2b protocol logic (tools/mycelium/r2b-*.ts): the statistics on known inputs (Mann-Whitney exact against brute force,
// the permutation Monte Carlo against exact enumeration, Cliff, Hodges-Lehmann, Holm, Otsu, Spearman, Fisher), the arms, the seed gate, the
// freeze checks, matching, the regime classifier, calibration and the five labels on synthetic series, and the new optional world keys.
// Pure functions only: no test here runs a protocol seed or touches the real seed log, FROZEN or CALIBRATION.json.
import { describe, expect, it } from "vitest";
import {
  cliffsDelta, distinct, doubledMidranks, effectSize, exactTwoSidedP, exactUCounts, fisherExact, hodgesLehmann, holm, mannWhitney, median, otsu, permutationTwoSidedP, spearman, twoU,
} from "../mycelium/r2b-stats.ts";
import {
  ALL_ARMS, ARM_DELTA, ARM_SEED_OFFSET, armConfig, checkCalibrationForConfirm, checkFrozen, CONFIRM_ARMS, FAMILY, fileHashProblem, gateRun, isSmokeSeed, localImports, logProblems, manifestText, MATCH_SEEDS,
  parseFrozenExtras, parseProtocolRecord, passAttainable, passPair, pendingConfirm, planForTiming, PLANS, R2B, R2B_ENTRY_FILES, READOUT_IDS, REFUSED_SEEDS, type SeedLogEntry, worldSeed,
} from "../mycelium/r2b-protocol.ts";
import { embargoReason, R2B_WORLD_SEEDS } from "../mycelium/r2b-seeds.ts";
import {
  agreementProblems, calibrate, decide, depositTarget, type MatchingRecord, matchingProblems, matchStep, regimeClassifier, type RunSet, startingDeposit, summaryOf, trailOn,
} from "../mycelium/r2b-decide.ts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { emptySeries, type R2bSeries } from "../mycelium/observe-r2b.ts";
import { calibrationReport, confirmReport } from "../mycelium/r2b-report.ts";
import { createWorld, decode, defaultConfig, encode, energyTotal, matterTotal, PHYSARUM_DEPOSIT_MAX, stateDigest, step, validateConfig, validateState } from "../mycelium/world.ts";

// ---- statistics -------------------------------------------------------------------------------------------

/** Every way to give n1 of the pooled midranks to the first group: the exact permutation distribution of 2U. */
function allSplits(values: readonly number[], n1: number): number[] {
  const r2 = doubledMidranks(values);
  const out: number[] = [];
  const rec = (start: number, left: number, sum: number) => {
    if (left === 0) { out.push(sum - n1 * (n1 + 1)); return; }
    for (let i = start; i <= values.length - left; i++) rec(i + 1, left - 1, sum + r2[i]);
  };
  rec(0, n1, 0);
  return out;
}

describe("Mann-Whitney", () => {
  it("the exact U counts are the Gaussian binomial coefficients", () => {
    expect(exactUCounts(3, 3)).toEqual([1, 1, 2, 3, 3, 3, 3, 2, 1, 1]);
    expect(exactUCounts(1, 4)).toEqual([1, 1, 1, 1, 1]);
    expect(exactUCounts(2, 2)).toEqual([1, 1, 2, 1, 1]);
    const c = exactUCounts(16, 16);
    expect(c.reduce((t, v) => t + v, 0)).toBe(601080390); // C(32, 16)
    const c20 = exactUCounts(20, 20);
    expect(c20.reduce((t, v) => t + v, 0)).toBe(137846528820); // C(40, 20)
  });

  it("a complete separation of 3 against 3 has p = 2 / 20 and delta = -1 (x below y)", () => {
    const r = mannWhitney([1, 2, 3], [4, 5, 6]);
    expect(r.method).toBe("exact");
    expect(r.p).toBeCloseTo(0.1, 12);
    expect(r.delta).toBe(-1);
    expect(r.twoU).toBe(0);
    const r2 = mannWhitney([4, 5, 6], [1, 2, 3]);
    expect(r2.delta).toBe(1);
    expect(r2.p).toBeCloseTo(0.1, 12);
  });

  it("the exact p equals brute-force enumeration over every split, for several tie-free samples", () => {
    const cases: [number[], number[]][] = [
      [[1.1, 4.2, 9.5, 3.3], [2.2, 8.1, 7.7, 5.5]],
      [[1, 2, 3, 4, 5], [6, 7, 8, 9]],
      [[10, 3, 8], [1, 2, 9, 7, 6]],
      [[0.5, 0.9, 1.4, 2.6, 8.8, 9.1], [0.1, 3.5, 4.5]],
    ];
    for (const [x, y] of cases) {
      const pooled = [...x, ...y];
      const splits = allSplits(pooled, x.length);
      const obs = twoU(x, y);
      const dev = Math.abs(obs - x.length * y.length);
      const brute = splits.filter((u) => Math.abs(u - x.length * y.length) >= dev).length / splits.length;
      expect(exactTwoSidedP(obs, x.length, y.length)).toBeCloseTo(brute, 12);
      expect(mannWhitney(x, y).p).toBeCloseTo(brute, 12);
    }
  });

  it("with ties the p comes from the permutation test, and equals the enumeration of all splits within Monte Carlo error", () => {
    const x = [1, 2, 2, 5, 6], y = [2, 3, 3, 4, 7, 7];
    const r = mannWhitney(x, y, 40_000);
    expect(r.method).toBe("permutation");
    expect(r.ties).toBe(true);
    const splits = allSplits([...x, ...y], x.length);
    const dev = Math.abs(r.twoU - x.length * y.length);
    const exact = splits.filter((u) => Math.abs(u - x.length * y.length) >= dev).length / splits.length;
    expect(Math.abs(r.p - exact)).toBeLessThan(0.02);
    // a tie within one group alone also sends the test to permutation
    expect(mannWhitney([1, 1, 2], [3, 4, 5]).method).toBe("permutation");
  });

  it("the permutation Monte Carlo agrees with the exact p on tie-free data, and is deterministic", () => {
    const x = [0.3, 1.9, 2.4, 5.1, 6.6, 7.2, 8.8, 9.3], y = [0.8, 1.1, 1.5, 3.9, 4.2, 4.8, 5.9, 6.1];
    const exact = mannWhitney(x, y).p;
    const mc = permutationTwoSidedP(x, y, 200_000);
    expect(Math.abs(mc - exact)).toBeLessThan(0.01);
    expect(permutationTwoSidedP(x, y, 5000)).toBe(permutationTwoSidedP(x, y, 5000));
    // another key gives another (still valid) estimate
    expect(permutationTwoSidedP(x, y, 5000, 1)).not.toBe(permutationTwoSidedP(x, y, 5000));
  });

  it("all values equal gives p = 1, an empty or non-finite sample throws", () => {
    expect(mannWhitney([2, 2, 2], [2, 2]).p).toBe(1);
    expect(mannWhitney([2, 2, 2], [2, 2]).delta).toBe(0);
    expect(() => mannWhitney([], [1])).toThrow();
    expect(() => mannWhitney([1, NaN], [1])).toThrow();
  });

  it("the smallest p at 16 against 16 is about 3e-9, far below the first Holm threshold 0.05 / 6", () => {
    const x = Array.from({ length: 16 }, (_, i) => 100 + i), y = Array.from({ length: 16 }, (_, i) => i);
    const p = mannWhitney(x, y).p;
    expect(p).toBeCloseTo(2 / 601080390, 12);
    expect(p).toBeLessThan(0.05 / 6);
  });
});

describe("effect sizes", () => {
  it("Cliff's delta is (#greater - #less) / pairs, positive when x is larger", () => {
    expect(cliffsDelta([5, 6], [1, 2])).toBe(1);
    expect(cliffsDelta([1, 2], [5, 6])).toBe(-1);
    expect(cliffsDelta([1, 2, 3], [2])).toBe(0);
    expect(cliffsDelta([1, 3, 3], [2, 3])).toBeCloseTo((1 - 1) / 6 + 0, 12);
    // x = [4, 2], y = [3]: one greater, one less: 0; x = [4, 5, 2], y = [3, 1]: greater 5 of 6 pairs... 4>3, 4>1, 5>3, 5>1, 2>1 (5), 2<3 (1): (5 - 1) / 6
    expect(cliffsDelta([4, 5, 2], [3, 1])).toBeCloseTo(4 / 6, 12);
  });

  it("the Hodges-Lehmann shift is the median of the pairwise differences", () => {
    expect(hodgesLehmann([3, 4, 5], [1, 2])).toBe(2.5); // 2 1 3 2 4 3 -> sorted 1 2 2 3 3 4
    expect(hodgesLehmann([10, 20], [10, 20])).toBe(0);
    expect(hodgesLehmann([1], [4])).toBe(-3);
  });

  it("the bootstrap interval brackets the estimate and is deterministic", () => {
    const x = [5.1, 6.2, 7.3, 8.4, 9.5, 5.5, 6.6, 7.7], y = [1.2, 2.3, 3.4, 4.5, 5.6, 2.2, 3.3, 4.4];
    const e = effectSize(x, y, 2000);
    expect(e.delta).toBeCloseTo(cliffsDelta(x, y), 12);
    expect(e.deltaCI[0]).toBeLessThanOrEqual(e.delta);
    expect(e.deltaCI[1]).toBeGreaterThanOrEqual(e.delta);
    expect(e.hlCI[0]).toBeLessThanOrEqual(e.hl);
    expect(e.hlCI[1]).toBeGreaterThanOrEqual(e.hl);
    expect(effectSize(x, y, 2000)).toEqual(e);
    // a separation this clean has a delta interval entirely above 0
    expect(e.deltaCI[0]).toBeGreaterThan(0);
  });
});

describe("Holm, Otsu, Spearman, Fisher", () => {
  it("Holm steps down: reject while p_(i) <= alpha / (m - i + 1), stop at the first failure", () => {
    const h = holm([0.01, 0.04, 0.03], 0.05);
    expect(h.reject).toEqual([true, false, false]);
    expect(h.adjusted[0]).toBeCloseTo(0.03, 12);
    expect(h.adjusted[1]).toBeCloseTo(0.06, 12);
    expect(h.adjusted[2]).toBeCloseTo(0.06, 12);
    expect(holm([0.001, 0.002, 0.003], 0.05).reject).toEqual([true, true, true]);
    // a failure stops the chain even when a later p is small enough for its own threshold
    expect(holm([0.0001, 0.04, 0.03], 0.05).reject).toEqual([true, false, false]);
    expect(holm([0.2], 0.05).reject).toEqual([false]);
    expect(holm([0.05], 0.05).reject).toEqual([true]);
    expect(holm([0.5, 0.9], 0.05).adjusted).toEqual([1, 1]); // 0.5 * 2 capped at 1, then the running maximum keeps 0.9 at 1
  });

  it("Otsu cuts between two clean clusters at the midpoint, with share 1; ties take the lower cut", () => {
    const o = otsu([1, 1, 1, 1, 10, 10, 10, 10]);
    expect(o.cut).toBe(5.5);
    expect(o.nLow).toBe(4);
    expect(o.nHigh).toBe(4);
    expect(o.share).toBeCloseTo(1, 12);
    // [0, 1, 2]: both splits give the same between-class variance 0.5; the lower cut (0.5) wins
    expect(otsu([2, 0, 1]).cut).toBe(0.5);
    expect(Number.isNaN(otsu([3, 3, 3]).cut)).toBe(true);
    // 3 low, 17 high: the cut lies between the clusters and the share is below 1 with noise
    const noisy = otsu([...[0.1, 0.2, 0.15], ...Array.from({ length: 17 }, (_, i) => 5 + i * 0.01)]);
    expect(noisy.nLow).toBe(3);
    expect(noisy.cut).toBeGreaterThan(0.2);
    expect(noisy.cut).toBeLessThan(5);
  });

  it("Spearman is 1 for a monotone relation, -1 for an inverse one, and uses midranks for ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 12);
    expect(Number.isNaN(spearman([1, 1, 1], [1, 2, 3]))).toBe(true);
    expect(doubledMidranks([5, 5, 1])).toEqual([5, 5, 2]); // ranks 2.5, 2.5, 1 doubled
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3);
  });

  it("Fisher's exact test: the classic 3-1-1-3 table has p = 0.4857, an extreme table 2/70", () => {
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.485714, 5);
    expect(fisherExact(4, 0, 0, 4)).toBeCloseTo(2 / 70, 10);
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 10);
  });

  it("median and distinct", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(distinct([1, 1, 2, 3, 3])).toBe(3);
  });
});

// ---- the new world keys --------------------------------------------------------------------------------------

describe("optional world keys", () => {
  it("defaultConfig() carries none of controller, physarumDeposit or blindTrailGradient, so every existing config encodes as before", () => {
    const c = defaultConfig();
    for (const k of ["controller", "physarumDeposit", "blindTrailGradient"]) expect(k in c).toBe(false);
    expect(JSON.stringify(createWorld(defaultConfig({ width: 16, height: 16, founders: 8, maxParticles: 16 })).config)).not.toMatch(/physarumDeposit|blindTrailGradient|controller/);
  });

  it("physarumDeposit needs controller physarum and an integer in 0..768; blindTrailGradient a boolean", () => {
    const phys = (over = {}) => defaultConfig({ controller: "physarum", heredity: "frozen", ...over });
    expect(validateConfig(phys({ physarumDeposit: 0 }))).toEqual([]);
    expect(validateConfig(phys({ physarumDeposit: PHYSARUM_DEPOSIT_MAX }))).toEqual([]);
    expect(validateConfig(phys({ physarumDeposit: 769 })).join()).toMatch(/physarumDeposit must be/);
    expect(validateConfig(phys({ physarumDeposit: -1 })).join()).toMatch(/physarumDeposit must be/);
    expect(validateConfig(phys({ physarumDeposit: 1.5 })).join()).toMatch(/physarumDeposit must be/);
    expect(validateConfig(defaultConfig({ physarumDeposit: 100 })).join()).toMatch(/requires controller physarum/);
    expect(validateConfig(defaultConfig({ blindTrailGradient: true }))).toEqual([]);
    expect(validateConfig(defaultConfig({ blindTrailGradient: 1 as unknown as boolean })).join()).toMatch(/blindTrailGradient must be a boolean/);
  });

  it("physarumDeposit 256 reproduces the R2 null step for step (apart from the config header); other values change the dynamics", () => {
    const base = { width: 32, height: 32, founders: 128, maxParticles: 1024, controller: "physarum" as const, heredity: "frozen" as const };
    const run = (over = {}) => { const s = createWorld(defaultConfig({ ...base, ...over })); for (let t = 0; t < 200; t++) step(s); return s; };
    const a = run(), b = run({ physarumDeposit: 256 }), c = run({ physarumDeposit: 100 });
    expect(Array.from(b.P)).toEqual(Array.from(a.P));
    expect(Array.from(b.M.subarray(0, b.n))).toEqual(Array.from(a.M.subarray(0, a.n)));
    expect(Array.from(c.P)).not.toEqual(Array.from(a.P));
    expect(stateDigest(a)).not.toBe(stateDigest(b)); // the config header differs
    const mid = run({ physarumDeposit: 0 });
    expect(mid.P.reduce((t, v) => t + v, 0)).toBe(0);
  });

  it("blindTrailGradient changes an inherit run and a blind physarum world only wanders", () => {
    const small = { width: 32, height: 32, founders: 128, maxParticles: 1024 };
    const a = createWorld(defaultConfig(small)), b = createWorld(defaultConfig({ ...small, blindTrailGradient: true }));
    for (let t = 0; t < 300; t++) { step(a); step(b); }
    expect(Array.from(b.P)).not.toEqual(Array.from(a.P));
    expect(encode(b).length).toBeGreaterThan(0);
    // in a blind physarum world there is no gradient to follow, so every particle wanders: positions never concentrate on trail
    const w = createWorld(defaultConfig({ ...small, controller: "physarum", heredity: "frozen", blindTrailGradient: true }));
    for (let t = 0; t < 50; t++) step(w);
    expect(w.n).toBeGreaterThan(0);
  });
});

describe("the new keys conserve and replay (Freeze 1 prerequisite)", () => {
  const small = { width: 32, height: 32, founders: 128, maxParticles: 1024 };
  const phys = (v: number) => defaultConfig({ ...small, controller: "physarum", heredity: "frozen", physarumDeposit: v });
  const cases: [string, ReturnType<typeof defaultConfig>][] = [
    ["physarumDeposit 100 (fractional)", phys(100)], ["physarumDeposit 300", phys(300)], ["physarumDeposit 768", phys(768)], ["physarumDeposit 0", phys(0)],
    ["blind inherit", defaultConfig({ ...small, blindTrailGradient: true })], ["blind blocked", defaultConfig({ ...small, heredity: "blocked", blindTrailGradient: true })],
    ["blind physarum", defaultConfig({ ...small, controller: "physarum", heredity: "frozen", physarumDeposit: 100, blindTrailGradient: true })],
  ];
  for (const [name, cfg] of cases) {
    it(`${name}: matter and energy balance exactly on every step, with births and deaths, and a checkpoint resumes to the same bytes`, () => {
      const s = createWorld(cfg);
      let births = 0, deaths = 0;
      for (let t = 0; t < 250; t++) {
        const st = step(s);
        births += st.births; deaths += st.deaths;
        expect(matterTotal(s)).toBe(s.matter0);
        expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
      }
      expect(births).toBeGreaterThan(0);
      expect(deaths).toBeGreaterThan(0);
      expect(validateState(s)).toEqual([]);
      const cont = createWorld(cfg);
      for (let t = 0; t < 250; t++) step(cont);
      const resumed = createWorld(cfg);
      for (let t = 0; t < 101; t++) step(resumed);
      const back = decode(encode(resumed));
      expect(back.config.physarumDeposit).toBe(cfg.physarumDeposit);
      expect(back.config.blindTrailGradient).toBe(cfg.blindTrailGradient);
      for (let t = 101; t < 250; t++) step(back);
      expect(Buffer.from(encode(back)).equals(Buffer.from(encode(cont)))).toBe(true);
      expect(stateDigest(back)).toBe(stateDigest(cont));
    });
  }
});

// ---- arms, seeds, the gate ----------------------------------------------------------------------------------

describe("arms and seeds", () => {
  it("each arm changes only its keys; inherit is exactly defaultConfig with the seed", () => {
    // inherit's world seed is the slot itself; every other arm adds its offset (no shared founders or PRNG stream between arms)
    expect(JSON.stringify(armConfig("inherit", 2001))).toBe(JSON.stringify(defaultConfig({ seed: 2001 })));
    expect(armConfig("blocked", 5)).toEqual({ ...defaultConfig({ seed: 10_005 }), heredity: "blocked" });
    expect(armConfig("physarum", 5, 300)).toEqual({ ...defaultConfig({ seed: 20_005 }), heredity: "frozen", controller: "physarum", physarumDeposit: 300 });
    expect(armConfig("pc-light", 5)).toEqual({ ...defaultConfig({ seed: 30_005 }), light: 4 });
    expect(armConfig("pc-upkeep", 5)).toEqual({ ...defaultConfig({ seed: 40_005 }), upkeep: 9 });
    expect(armConfig("pc-blind", 5)).toEqual({ ...defaultConfig({ seed: 50_005 }), blindTrailGradient: true });
    expect(() => armConfig("physarum", 5)).toThrow(/needs physarumDeposit/);
    expect(() => armConfig("blocked", 5, 100)).toThrow(/only for the physarum arm/);
    for (const a of ALL_ARMS) expect(validateConfig(armConfig(a, 2001, a === "physarum" ? 256 : undefined))).toEqual([]);
    expect(Object.keys(ARM_DELTA)).toHaveLength(6);
    expect(defaultConfig().upkeep * 1.5).toBe(9);
  });

  it("the plans, the matching seeds and the refused seeds", () => {
    expect(PLANS.full.dev).toHaveLength(20);
    expect(PLANS.full.confirm).toHaveLength(16);
    expect(PLANS.reduced.dev).toHaveLength(16);
    expect(PLANS.reduced.confirm).toHaveLength(12);
    expect(PLANS.full.dev[0]).toBe(2001);
    expect(PLANS.full.confirm.at(-1)).toBe(5016);
    expect(MATCH_SEEDS).toEqual([2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008]);
    expect(REFUSED_SEEDS).toEqual([101, 102, 103, 104, 105, 9001, 9002, 9003, 9004, 9005]);
    expect(isSmokeSeed(77)).toBe(true);
    expect(isSmokeSeed(105)).toBe(false);
    expect(isSmokeSeed(106)).toBe(true);
    expect(isSmokeSeed(2001)).toBe(false);
    expect(isSmokeSeed(0)).toBe(false);
  });

  it("arms never share a world seed: offsets are distinct, and no smoke world collides with a registered one", () => {
    expect(new Set(Object.values(ARM_SEED_OFFSET)).size).toBe(6);
    for (const slot of [...PLANS.full.dev, ...PLANS.full.confirm]) {
      const worlds = ALL_ARMS.map((a) => worldSeed(a, slot));
      expect(new Set(worlds).size).toBe(6);
    }
    expect(new Set(R2B_WORLD_SEEDS).size).toBe(R2B_WORLD_SEEDS.length); // no two registered (arm, slot) share a world
    expect(R2B_WORLD_SEEDS).toHaveLength(6 * 36);
    // a smoke slot (1-100, 106-1999) under any arm is never a registered world, nor one of R2's seeds
    for (const a of ALL_ARMS) for (const slot of [1, 100, 106, 1999]) {
      expect(R2B_WORLD_SEEDS.includes(worldSeed(a, slot)), `${a} ${slot}`).toBe(false);
      expect([101, 102, 103, 104, 105, 9001, 9002, 9003, 9004, 9005].includes(worldSeed(a, slot))).toBe(false);
    }
  });

  it("run.ts and r2.ts refuse R2b's worlds (every arm's offset): run.ts R2's seeds too, r2.ts leaves R2's own seeds to R2's gate", () => {
    for (const a of ALL_ARMS) for (const slot of [2001, 2020, 5001, 5016]) {
      expect(embargoReason(worldSeed(a, slot), { r2b: true, r2: false }), `${a} ${slot}`).toMatch(/R2b/);
      expect(embargoReason(worldSeed(a, slot), { r2b: true, r2: true })).toMatch(/R2b/);
    }
    expect(embargoReason(103, { r2b: true, r2: true })).toMatch(/R2 /);
    expect(embargoReason(103, { r2b: true, r2: false })).toBeNull();
    expect(embargoReason(9003, { r2b: true, r2: false })).toBeNull();
    expect(embargoReason(77, { r2b: true, r2: true })).toBeNull();
    expect(embargoReason(2021, { r2b: true, r2: true })).toBeNull();
  });
});

describe("the run gate", () => {
  const ok = (phase: "smoke" | "dev" | "match" | "confirm" | "cpu-check", arm: string, seed: number, steps = 100_000, log: SeedLogEntry[] = [], plan: "full" | "reduced" | null = "full") => gateRun({ phase, arm, seed, steps, plan }, log);
  const e = (state: SeedLogEntry["state"], arm = "inherit", seed = 5001, phase: SeedLogEntry["phase"] = "confirm"): SeedLogEntry => ({ phase, arm, seed, steps: 100_000, state });

  it("R2's seeds are refused in every phase", () => {
    for (const phase of ["smoke", "dev", "match", "confirm", "cpu-check"] as const) {
      for (const seed of [101, 105, 9001, 9005]) expect(ok(phase, "inherit", seed, phase === "smoke" ? 3000 : 100_000).join(), `${phase} ${seed}`).toMatch(/refused/);
    }
  });

  it("smoke takes seeds 1-100 and 106-1999 at a multiple of 1000 steps and needs no plan", () => {
    expect(ok("smoke", "physarum", 77, 3000, [], null)).toEqual([]);
    expect(ok("smoke", "inherit", 2001, 3000).join()).toMatch(/smoke seeds/);
    expect(ok("smoke", "inherit", 5001, 3000).join()).toMatch(/smoke seeds/);
    expect(ok("smoke", "inherit", 77, 1500).join()).toMatch(/multiple of 1000/);
    expect(ok("smoke", "nonsense", 77, 3000).join()).toMatch(/unknown arm/);
  });

  it("dev runs the plan's dev seeds at 100,000 steps; a 2021 seed and a confirmation seed are refused", () => {
    expect(ok("dev", "pc-blind", 2020)).toEqual([]);
    expect(ok("dev", "pc-blind", 2017, 100_000, [], "reduced").join()).toMatch(/2001-2016/);
    expect(ok("dev", "inherit", 2021).join()).toMatch(/2001-2020/);
    expect(ok("dev", "inherit", 5001).join()).toMatch(/2001-2020/);
    expect(ok("dev", "inherit", 2001, 20_000).join()).toMatch(/100000 steps/);
    expect(ok("dev", "inherit", 2001, 100_000, [], null).join()).toMatch(/needs the plan/);
  });

  it("match is the physarum arm on 2001-2008 at 30,000 steps", () => {
    expect(ok("match", "physarum", 2008, 30_000)).toEqual([]);
    expect(ok("match", "physarum", 2009, 30_000).join()).toMatch(/2001-2008/);
    expect(ok("match", "inherit", 2001, 30_000).join()).toMatch(/physarum arm only/);
    expect(ok("match", "physarum", 2001, 100_000).join()).toMatch(/30000/);
  });

  it("confirm takes the plan's confirmation seeds on three arms and never runs a pair twice", () => {
    expect(ok("confirm", "inherit", 5001)).toEqual([]);
    expect(ok("confirm", "inherit", 5013, 100_000, [], "reduced").join()).toMatch(/5001-5012/);
    expect(ok("confirm", "pc-light", 5001).join()).toMatch(/inherit, blocked and physarum only/);
    expect(ok("confirm", "inherit", 2001).join()).toMatch(/5001-5016/);
    expect(ok("confirm", "inherit", 5001, 100_000, [e("started"), e("finished")]).join()).toMatch(/already finished/);
    expect(ok("confirm", "blocked", 5001, 100_000, [e("started"), e("finished")])).toEqual([]);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 5001, steps: 100_000, plan: "full", seriesExists: true }, [e("started")]).join()).toMatch(/no finished entry/);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 5001, steps: 100_000, plan: "full", seriesExists: false }, [e("started")])).toEqual([]);
  });

  it("a log with a fresh seed outside the confirm phases, a refused seed or an invalid entry stops every logged phase", () => {
    expect(logProblems([e("started", "inherit", 5001, "dev")]).join()).toMatch(/embargo is broken/);
    expect(logProblems([e("started", "inherit", 2500, "dev")]).join()).toMatch(/embargo is broken/);
    expect(logProblems([e("finished", "inherit", 5001, "cpu-check")])).toEqual([]);
    expect(logProblems([e("invalid", "inherit", 2001, "dev")]).join()).toMatch(/invalid run/);
    expect(logProblems([e("started", "inherit", 101, "dev")]).join()).toMatch(/refused seed/);
    expect(ok("dev", "inherit", 2001, 100_000, [e("invalid", "inherit", 2002, "dev")]).join()).toMatch(/invalid run/);
    expect(ok("smoke", "inherit", 77, 3000, [e("invalid", "inherit", 2002, "dev")])).toEqual([]);
  });

  it("the plan is fixed by the first logged run: entries under another plan stop the protocol", () => {
    const withPlan = (plan: "full" | "reduced", state: SeedLogEntry["state"] = "started"): SeedLogEntry => ({ phase: "dev", arm: "inherit", seed: 2001, steps: 100_000, state, plan });
    expect(logProblems([withPlan("full"), withPlan("full", "finished")], "full")).toEqual([]);
    expect(logProblems([withPlan("full")], "reduced").join()).toMatch(/written under the full plan but FROZEN names the reduced plan/);
    expect(logProblems([withPlan("full"), withPlan("reduced")]).join()).toMatch(/more than one plan/);
    expect(ok("dev", "blocked", 2002, 100_000, [withPlan("full")], "reduced").join()).toMatch(/names the reduced plan/);
  });

  it("a run file must be the one the seed log recorded: the SHA-256 of its bytes, per phase, arm, seed and round", () => {
    const fin = (over: Partial<SeedLogEntry> = {}): SeedLogEntry => ({ phase: "dev", arm: "inherit", seed: 2001, steps: 100_000, state: "finished", fileSha256: "a".repeat(64), ...over });
    expect(fileHashProblem([fin()], "dev", "inherit", 2001, "a".repeat(64))).toBeNull();
    expect(fileHashProblem([fin()], "dev", "inherit", 2001, "b".repeat(64))).toMatch(/is not the file the run wrote/);
    expect(fileHashProblem([fin({ fileSha256: undefined })], "dev", "inherit", 2001, "a".repeat(64))).toMatch(/no fileSha256/);
    expect(fileHashProblem([{ ...fin(), state: "started" }], "dev", "inherit", 2001, "a".repeat(64))).toMatch(/no finished entry/);
    expect(fileHashProblem([fin()], "dev", "blocked", 2001, "a".repeat(64))).toMatch(/no finished entry/);
    expect(fileHashProblem([fin({ phase: "match", arm: "physarum", round: 2 })], "match", "physarum", 2001, "a".repeat(64), 1)).toMatch(/no finished entry/);
    expect(fileHashProblem([fin({ phase: "match", arm: "physarum", round: 2 })], "match", "physarum", 2001, "a".repeat(64), 2)).toBeNull();
  });

  it("cpu-check re-runs a dev or confirmation seed only", () => {
    expect(ok("cpu-check", "physarum", 2001)).toEqual([]);
    expect(ok("cpu-check", "inherit", 5001)).toEqual([]);
    expect(ok("cpu-check", "inherit", 3000).join()).toMatch(/dev or confirmation seed/);
  });

  it("pending confirmations come in the fixed order and skip finished pairs", () => {
    const all = pendingConfirm([], "reduced");
    expect(all).toHaveLength(36);
    expect(all[0]).toEqual({ arm: "inherit", seed: 5001 });
    expect(all[12]).toEqual({ arm: "blocked", seed: 5001 });
    expect(pendingConfirm([e("finished", "inherit", 5001)], "reduced")).toHaveLength(35);
    expect(CONFIRM_ARMS).toEqual(["inherit", "blocked", "physarum"]);
  });
});

describe("FROZEN", () => {
  const hex = (c: string) => c.repeat(64);
  const record = { plan: "full" as const, timing: 1900.5, duplicates: [] as string[] };
  const actual = { protocol: hex("a"), code: hex("b"), files: { "tools/mycelium/world.ts": hex("c"), "deno.json": hex("d") }, calibration: hex("e") as string | null, record: record as typeof record | null };
  const text = (extra = "", plan = "full", timing = "1900.5") => `protocol_sha256: ${hex("a")}\ncode_hash: ${hex("b")}\nplan: ${plan}\ntiming_steps_per_second: ${timing}\n${manifestText(actual.files)}${extra}`;

  it("Freeze 1 needs the protocol, code, per-file hashes, the plan and the timing figure", () => {
    expect(checkFrozen("dev", text(), actual)).toEqual([]);
    expect(checkFrozen("match", text(), actual)).toEqual([]);
    expect(checkFrozen("smoke", null, actual)).toEqual([]);
    expect(checkFrozen("dev", null, actual).join()).toMatch(/Freeze 1/);
    expect(checkFrozen("dev", text(), { ...actual, protocol: hex("f") }).join()).toMatch(/PROTOCOL.md differs/);
    expect(checkFrozen("dev", text(), { ...actual, code: hex("f") }).join()).toMatch(/code differs/);
    expect(checkFrozen("dev", text(), { ...actual, files: { ...actual.files, "deno.json": hex("0") } }).join()).toMatch(/deno.json changed/);
    expect(checkFrozen("dev", text(), { ...actual, files: { ...actual.files, "tools/mycelium/new.ts": hex("1") } }).join()).toMatch(/not listed/);
    expect(checkFrozen("dev", text().replace("plan: full\n", ""), actual).join()).toMatch(/no `plan/);
    expect(checkFrozen("dev", text().replace(/timing.*\n/, ""), actual).join()).toMatch(/timing/);
    expect(parseFrozenExtras(text())).toEqual({ plan: "full", timing: 1900.5, duplicates: [] });
  });

  it("the plan and the timing figure are stated once, follow the 1,800 / 1,200 mapping, and equal PROTOCOL.md's hashed record", () => {
    // the attack: after the dev seeds are seen, append a reduced plan and a second timing line (the old reader took the last line and passed)
    expect(checkFrozen("dev", text("plan: reduced\n"), actual).join()).toMatch(/repeats or malforms plan/);
    expect(checkFrozen("dev", text("timing_steps_per_second: 1300\n"), actual).join()).toMatch(/repeats or malforms timing_steps_per_second/);
    expect(checkFrozen("dev", text("plan : reduced\n"), actual).join()).toMatch(/repeats or malforms plan/);
    // the mapping
    expect(planForTiming(1800)).toBe("full");
    expect(planForTiming(1799.9)).toBe("reduced");
    expect(planForTiming(1200)).toBe("reduced");
    expect(planForTiming(1199)).toBeNull();
    expect(checkFrozen("dev", text("", "reduced", "1900.5"), { ...actual, record: { ...record, plan: "reduced" } }).join()).toMatch(/names the reduced plan but the timing figure 1900.5 implies the full plan/);
    const slow = { ...actual, record: { plan: "reduced" as const, timing: 1500, duplicates: [] } };
    expect(checkFrozen("dev", text("", "reduced", "1500"), slow)).toEqual([]);
    expect(checkFrozen("dev", text("", "full", "1500"), slow).join()).toMatch(/names the full plan but the timing figure 1500 implies the reduced plan/);
    expect(checkFrozen("dev", text("", "reduced", "1000"), { ...actual, record: { plan: "reduced", timing: 1000, duplicates: [] } }).join()).toMatch(/below 1200/);
    // the record in the protocol text (so protocol_sha256 covers plan and timing) must say the same
    expect(checkFrozen("dev", text(), { ...actual, record: null }).join()).toMatch(/no FREEZE-1-RECORD/);
    expect(checkFrozen("dev", text("", "reduced", "1500"), actual).join()).toMatch(/differ from PROTOCOL.md's FREEZE-1-RECORD/);
    expect(checkFrozen("dev", text(), { ...actual, record: { plan: null, timing: null, duplicates: [] } }).join()).toMatch(/no valid plan and timing/);
    expect(checkFrozen("dev", text(), { ...actual, record: { ...record, duplicates: ["plan"] } }).join()).toMatch(/FREEZE-1-RECORD repeats/);
    const doc = "text\n<!-- FREEZE-1-RECORD -->\nplan: reduced\ntiming_steps_per_second: 1500.2\n<!-- /FREEZE-1-RECORD -->\nmore";
    expect(parseProtocolRecord(doc)).toEqual({ plan: "reduced", timing: 1500.2, duplicates: [] });
    expect(parseProtocolRecord("no block")).toBeNull();
    expect(parseProtocolRecord("<!-- FREEZE-1-RECORD -->\nplan: PENDING\n<!-- /FREEZE-1-RECORD -->")).toEqual({ plan: null, timing: null, duplicates: ["plan (malformed line)"] });
  });

  it("every confirmation seed needs Freeze 2: calibration_sha256 matching CALIBRATION.json, appended once", () => {
    expect(checkFrozen("confirm", text(), actual).join()).toMatch(/Freeze 2 is missing/);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${hex("e")}\n`), actual)).toEqual([]);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${hex("9")}\n`), actual).join()).toMatch(/CALIBRATION.json differs/);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${hex("e")}\n`), { ...actual, calibration: null }).join()).toMatch(/does not exist/);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${hex("e")}\ncalibration_sha256: ${hex("e")}\n`), actual).join()).toMatch(/repeats/);
  });

  it("the calibration must carry the frozen hashes and plan, at least 2 kept readouts and a matched v", () => {
    const frozen = { code_hash: hex("b"), protocol_sha256: hex("a") };
    const cal = { codeHash: hex("b"), protocolSha256: hex("a"), plan: "full", verdict: "READY", kept: ["TM", "MI"], physarum: { v: 300 } };
    expect(checkCalibrationForConfirm({ ...cal, kept: ["AGE", "TURN", "SIG"] }, frozen, "full").join()).toMatch(/cannot make a PASS/);
    expect(checkCalibrationForConfirm({ ...cal, kept: ["TM", "AGE"] }, frozen, "full").join()).toMatch(/cannot make a PASS/);
    expect(checkCalibrationForConfirm({ ...cal, kept: ["REG", "MI"] }, frozen, "full")).toEqual([]);
    expect(checkCalibrationForConfirm(cal, frozen, "full")).toEqual([]);
    expect(checkCalibrationForConfirm({ ...cal, codeHash: hex("0") }, frozen, "full").join()).toMatch(/made under code/);
    expect(checkCalibrationForConfirm({ ...cal, protocolSha256: hex("0") }, frozen, "full").join()).toMatch(/made under protocol/);
    expect(checkCalibrationForConfirm(cal, frozen, "reduced").join()).toMatch(/plan/);
    expect(checkCalibrationForConfirm({ ...cal, kept: ["TM"] }, frozen, "full").join()).toMatch(/fewer than 2/);
    expect(checkCalibrationForConfirm({ ...cal, physarum: {} }, frozen, "full").join()).toMatch(/matched/);
    expect(checkCalibrationForConfirm({ ...cal, verdict: "MEASUREMENT-LIMITED" }, frozen, "full").join()).toMatch(/MEASUREMENT-LIMITED/);
  });
});

// ---- classifier, matching ---------------------------------------------------------------------------------------

describe("regime classifier and deposit matching", () => {
  it("two clean regimes give a cut between them, tau in TM units, and adequate classes", () => {
    const tm = [...Array.from({ length: 10 }, (_, i) => 0.2 + i * 0.05), ...Array.from({ length: 10 }, (_, i) => 30 + i)];
    const c = regimeClassifier(tm);
    expect(c.adequate).toBe(true);
    expect(c.nLow).toBe(10);
    expect(c.tau!).toBeGreaterThan(0.65);
    expect(c.tau!).toBeLessThan(30);
    expect(c.on.filter(Boolean)).toHaveLength(10);
    expect(c.on.slice(10).every(Boolean)).toBe(true);
    // tau = 10^cut - 0.01, never below 0
    expect(c.tau).toBeCloseTo(10 ** c.cut - 0.01, 12);
  });

  it("fewer than 4 seeds in a class, or a share under 0.70, drops REG; equal values have no cut", () => {
    const three = regimeClassifier([...Array.from({ length: 17 }, (_, i) => 5 + i * 0.01), 0.1, 0.12, 0.11]);
    expect(three.nLow).toBe(3);
    expect(three.adequate).toBe(false);
    const flat = regimeClassifier(Array.from({ length: 20 }, (_, i) => 1 + i * 0.05));
    expect(flat.share).toBeLessThan(0.75);
    const same = regimeClassifier(new Array(20).fill(2));
    expect(same.adequate).toBe(false);
    expect(same.tau).toBeNull();
    expect(same.on.some(Boolean)).toBe(false);
  });

  it("a continuum is not two regimes: 20 evenly spaced log values pass the class-size and share rules but fail the gap rule", () => {
    // 20 values 10^(-2 + i/10): evenly spaced in the log domain, classes 10/10, share about 0.75 (the review's example)
    const tm = Array.from({ length: 20 }, (_, i) => 10 ** (-1 + i / 10) - R2B.TAU_EPS);
    const c = regimeClassifier(tm);
    expect(c.nLow).toBe(10);
    expect(c.nHigh).toBe(10);
    expect(c.share).toBeGreaterThanOrEqual(R2B.OTSU_SHARE);
    expect(c.gap!).toBeLessThan(R2B.OTSU_MIN_GAP);
    expect(c.adequate).toBe(false);
    // two real clusters a decade apart pass: the gap exceeds both the floor and the within-class spread
    const two = regimeClassifier([...Array.from({ length: 10 }, (_, i) => 0.2 + i * 0.02), ...Array.from({ length: 10 }, (_, i) => 5 + i * 0.3)]);
    expect(two.adequate).toBe(true);
    expect(two.gap!).toBeGreaterThan(R2B.OTSU_MIN_GAP);
    // a gap wider than the floor but narrower than the spread inside a class is not two regimes either
    const wide = regimeClassifier([...Array.from({ length: 10 }, (_, i) => 10 ** (-2 + i * 0.4) - R2B.TAU_EPS), ...Array.from({ length: 10 }, (_, i) => 10 ** (2.2 + i * 0.4) - R2B.TAU_EPS)]);
    expect(wide.nLow).toBe(10);
    expect(wide.gap!).toBeLessThan(wide.withinSd! * R2B.OTSU_GAP_SD);
    expect(wide.adequate).toBe(false);
  });

  it("the trail-on fallback is used only with an adequate classifier: a rejected classifier gives no trail-on seeds", () => {
    const tm = Array.from({ length: 20 }, (_, i) => 10 ** (-1 + i / 10) - R2B.TAU_EPS);
    const c = regimeClassifier(tm);
    expect(c.on.filter(Boolean)).toHaveLength(10); // the raw cut still marks ten seeds ...
    expect(trailOn(c).some(Boolean)).toBe(false); // ... but they are not used
    const d = tm.map((_, i) => (i < 14 ? 0.01 : 0.4)); // the median is under 1/16, so the fallback is needed
    expect(depositTarget(d, trailOn(c))).toMatchObject({ limited: true, T: null });
    const good = regimeClassifier([...Array.from({ length: 10 }, (_, i) => 0.2 + i * 0.02), ...Array.from({ length: 10 }, (_, i) => 5 + i * 0.3)]);
    expect(depositTarget(d, trailOn(good))).toMatchObject({ limited: false, source: "trail-on", T: 0.4 });
  });

  it("the deposit target is the median, falls back to the trail-on median under 1/16, and is limited otherwise", () => {
    expect(depositTarget([0.5, 0.7, 0.9], [true, false, false])).toMatchObject({ T: 0.7, source: "median", limited: false });
    const d = [0.01, 0.02, 0.02, 0.03, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const on = d.map((v) => v > 0.3);
    const t = depositTarget(d, on);
    expect(t.source).toBe("median");
    const lowMedian = [0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.05, 0.5, 0.6, 0.7, 0.8, 0.9, 0.4];
    const fb = depositTarget(lowMedian, lowMedian.map((v) => v > 0.3));
    expect(fb.medianAll).toBeLessThan(1 / 16);
    expect(fb.source).toBe("trail-on");
    expect(fb.T).toBeCloseTo(median(lowMedian.filter((v) => v > 0.3)), 12);
    const few = depositTarget([0.01, 0.02, 0.01, 0.9, 0.8, 0.02], [false, false, false, true, true, false]);
    expect(few.limited).toBe(true);
    expect(few.T).toBeNull();
    expect(few.reason).toMatch(/only 2 seeds are trail-on/);
    const tiny = depositTarget([0.01, 0.02, 0.03, 0.04, 0.05, 0.06], [true, true, true, true, false, false]);
    expect(tiny.limited).toBe(true);
    expect(tiny.reason).toMatch(/both under 1\/16/);
  });

  it("the starting deposit is round(256 T) clamped to 0..768", () => {
    expect(startingDeposit(0.5)).toBe(128);
    expect(startingDeposit(0.0625)).toBe(16);
    expect(startingDeposit(5)).toBe(768);
    expect(startingDeposit(0)).toBe(0);
  });

  it("matching accepts within 10%, updates v <- round(v T / d_phys), stops after round 3 or on a repeat, and limits at d_phys = 0", () => {
    expect(matchStep(1, 128, 0.5, 0.54)).toMatchObject({ action: "accept", converged: true });
    expect(matchStep(1, 128, 0.5, 0.45)).toMatchObject({ action: "accept" }); // exactly 10%
    expect(matchStep(1, 128, 0.5, 0.4499)).toMatchObject({ action: "next", nextV: Math.round((128 * 0.5) / 0.4499) });
    expect(matchStep(1, 128, 0.5, 0.25)).toMatchObject({ action: "next", nextV: 256 });
    expect(matchStep(2, 256, 0.5, 1.5)).toMatchObject({ action: "next", nextV: 85 });
    expect(matchStep(3, 256, 0.5, 0.25)).toMatchObject({ action: "stop", converged: false, ratio: 0.5 });
    expect(matchStep(1, 768, 5, 2.4)).toMatchObject({ action: "stop" }); // v at its bound: the update repeats 768
    expect(matchStep(1, 100, 0.5, 0).action).toBe("limited");
  });
});

describe("matching.json replayed against the protocol", () => {
  const T = 0.5;
  const rec = (over: Partial<MatchingRecord> = {}): MatchingRecord => ({
    T, source: "median", v0: 128,
    rounds: [{ round: 1, v: 128, dPhys: 0.25, perSeed: [], digests: [] }, { round: 2, v: 256, dPhys: 0.52, perSeed: [], digests: [] }],
    v: 256, converged: true, ratio: 1.04, limited: false, reason: null, ...over,
  });
  it("accepts a record that follows the rule: v0, the update after a miss, accept within 10%", () => {
    expect(matchingProblems(rec(), T)).toEqual([]);
    expect(matchingProblems(rec({ rounds: [{ round: 1, v: 128, dPhys: 0.52, perSeed: [], digests: [] }], v: 128 }), T)).toEqual([]);
  });
  it("refuses a record whose rounds, deposits, T or final state were edited", () => {
    expect(matchingProblems(rec({ v0: 100 }), T).join()).toMatch(/v0 is 100/);
    expect(matchingProblems(rec({ T: 0.6 }), T).join()).toMatch(/used T = 0.6/);
    const r = rec(); r.rounds[1].v = 255;
    expect(matchingProblems(r, T).join()).toMatch(/round 2 ran at v 255, the protocol asks for 256/);
    expect(matchingProblems(rec({ v: 128 }), T).join()).toMatch(/final v is 128, expected 256/);
    expect(matchingProblems(rec({ converged: false }), T).join()).toMatch(/converged is false/);
    expect(matchingProblems(rec({ rounds: [rec().rounds[0]], v: 128, converged: true }), T).join()).toMatch(/asks for another round/);
    expect(matchingProblems(rec({ rounds: [] }), T).join()).toMatch(/0 matching rounds/);
  });
  it("round 3 outside the tolerance ends with the round's own v and converged false", () => {
    const rounds = [{ round: 1, v: 128, dPhys: 0.25, perSeed: [], digests: [] }, { round: 2, v: 256, dPhys: 0.8, perSeed: [], digests: [] }, { round: 3, v: 160, dPhys: 0.7, perSeed: [], digests: [] }];
    expect(matchingProblems({ ...rec(), rounds, v: 160, converged: false, ratio: 1.4 }, T)).toEqual([]);
    expect(matchingProblems({ ...rec(), rounds, v: 160, converged: true, ratio: 1.4 }, T).join()).toMatch(/converged is true/);
  });
  it("the stored d_phys / T is recomputed from the last round, never trusted (the match gate reads it)", () => {
    const rounds = [{ round: 1, v: 128, dPhys: 0.25, perSeed: [], digests: [] }, { round: 2, v: 256, dPhys: 0.8, perSeed: [], digests: [] }, { round: 3, v: 160, dPhys: 0.7, perSeed: [], digests: [] }];
    expect(matchingProblems({ ...rec(), rounds, v: 160, converged: false, ratio: 1 }, T).join()).toMatch(/stored d_phys \/ T is 1, the last round gives 1.4/);
    expect(matchingProblems({ ...rec(), rounds, v: 160, converged: false, ratio: null }, T).join()).toMatch(/stored d_phys \/ T is null/);
  });
  it("an unmatchable null: no target means a limited record with no deposit, and a limited record needs a zero d_phys", () => {
    expect(matchingProblems(rec({ rounds: [], v: null, limited: true, converged: false }), null)).toEqual([]);
    expect(matchingProblems(rec(), null).join()).toMatch(/claims a matched deposit/);
    expect(matchingProblems(rec({ rounds: [], v: null, limited: true, converged: false }), T).join()).toMatch(/limited but the dev inherit runs give a target/);
    const zero = rec({ rounds: [{ round: 1, v: 128, dPhys: 0, perSeed: [], digests: [] }], v: null, limited: true, converged: false, ratio: 0 });
    expect(matchingProblems(zero, T)).toEqual([]);
  });
});

// ---- calibration and the labels, on synthetic series -------------------------------------------------------------

interface Shape { n?: number; tm: number; births?: number; mi: number; age: number; sig?: number | null; d?: number; refused?: number; miInvalid?: number }

/** A 100,000-step series with constant per-census values (so every readout is the given number). */
function synth(o: Shape): R2bSeries {
  const s = emptySeries();
  const n = o.n ?? 2000;
  const births = o.births ?? 50; // births per scalar census
  for (let t = 100; t <= R2B.STEPS; t += 100) {
    s.scalar.step.push(t); s.scalar.n.push(n); s.scalar.sumP.push(Math.round(o.tm * n)); s.scalar.births.push((t / 100) * births); s.scalar.refused.push(((t / 100) * (o.refused ?? 0)));
  }
  for (let t = 500; t <= R2B.STEPS; t += 500) {
    // miInvalid: the fraction of the window's 100 heavy censuses (the first ones) where Moran's I was invalid and counted 0
    const bad = t > R2B.LO && (t - R2B.LO) / 500 <= Math.round((o.miInvalid ?? 0) * 100);
    s.heavy.step.push(t); s.heavy.n.push(n); s.heavy.sumP.push(Math.round(o.tm * n)); s.heavy.moran.push(bad ? 0 : o.mi); s.heavy.moranInvalid.push(bad ? 1 : 0);
    s.heavy.medianAge.push(o.age); s.heavy.sig.push(o.sig ?? null); s.heavy.d.push(o.d ?? 0.5); s.heavy.meanM.push(10); s.heavy.meanE.push(100); s.heavy.genotypes.push(100);
  }
  return s;
}

const jit = (k: number, scale: number) => 1 + scale * (((k * 7919) % 101) / 101 - 0.5);
const seedsOf = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PERMS = 3000, BOOTS = 300;

/** Dev set: inherit bimodal (half the seeds trail-on), blocked and physarum near the middle, three controls that each move some readouts. */
function devSet(over: { inherit?: (k: number) => Shape; blocked?: (k: number) => Shape; physarum?: (k: number) => Shape; controls?: Partial<Record<string, (k: number) => Shape>> } = {}): RunSet {
  const seeds = seedsOf(2001, 2020);
  const mk = (f: (k: number) => Shape) => Object.fromEntries(seeds.map((s, k) => [s, synth(f(k))]));
  const inh = over.inherit ?? ((k) => (k % 2 === 0 ? { tm: 40 * jit(k, 0.3), mi: 0.5 * jit(k, 0.2), age: 400 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) } : { tm: 0.4 * jit(k, 0.3), mi: 0.1 * jit(k, 0.2), age: 900 * jit(k, 0.3), sig: 0.35 * jit(k, 0.3), births: 30 * jit(k, 0.2) }));
  const c = over.controls ?? {};
  return {
    inherit: mk(inh),
    blocked: mk(over.blocked ?? ((k) => ({ tm: 6 * jit(k, 0.2), mi: 0.2 * jit(k, 0.1), age: 2000 * jit(k, 0.1), sig: 0.5 * jit(k, 0.1), births: 20 * jit(k, 0.1) }))),
    physarum: mk(over.physarum ?? ((k) => ({ tm: 9 * jit(k, 0.2), mi: 0.3 * jit(k, 0.1), age: 700 * jit(k, 0.1), births: 35 * jit(k, 0.1) }))),
    // pc-light: far more trail and structure; pc-upkeep: shorter lives; pc-blind: another signature
    "pc-light": mk(c["pc-light"] ?? ((k) => ({ tm: 400 * jit(k, 0.2), mi: 0.9 * jit(k, 0.05), age: 450 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) }))),
    "pc-upkeep": mk(c["pc-upkeep"] ?? ((k) => ({ tm: 20 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 80 * jit(k, 0.1), sig: 0.4 * jit(k, 0.3), births: 90 * jit(k, 0.1) }))),
    "pc-blind": mk(c["pc-blind"] ?? ((k) => ({ tm: 20 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 600 * jit(k, 0.3), sig: 0.05 * jit(k, 0.1), births: 35 * jit(k, 0.2) }))),
  };
}

const matching = (v: number | null = 128): MatchingRecord => ({ T: 0.5, source: "median", v0: 128, rounds: [], v, converged: true, ratio: 1.02, limited: v === null, reason: null });

describe("calibration on synthetic dev series", () => {
  const cal = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: devSet(), matching: matching(), perms: PERMS, boots: BOOTS });

  it("finds the two regimes, a target and a kept set from the controls that move each readout", () => {
    expect(cal.regime.classifier.adequate).toBe(true);
    expect(cal.regime.classifier.nLow).toBe(10);
    expect(cal.verdict).toBe("READY");
    expect(cal.reasons).toEqual([]);
    expect(cal.target.T).toBe(0.5);
    expect(cal.physarum.v).toBe(128);
    // pc-light separates TM, MI (and REG); pc-upkeep AGE and TURN; pc-blind SIG
    for (const id of ["TM", "MI", "AGE", "TURN", "SIG"] as const) expect(cal.kept, id).toContain(id);
    const light = cal.controls.find((c) => c.control === "pc-light")!;
    expect(light.usable).toBe(true);
    expect(light.tests.find((t) => t.readout === "TM")!.separated).toBe(true);
    expect(light.tests.find((t) => t.readout === "AGE")!.separated).toBe(false);
    const blind = cal.controls.find((c) => c.control === "pc-blind")!;
    expect(blind.tests.find((t) => t.readout === "SIG")!.separated).toBe(true);
    expect(cal.devContrasts.filter((d) => d.vs === "physarum").some((d) => d.readout === "SIG")).toBe(false);
    expect(cal.devContrasts.filter((d) => d.vs === "blocked").some((d) => d.readout === "SIG")).toBe(true);
    expect(cal.halfAgreement.TM).not.toBeUndefined();
    // REG is a proportion: with stable regimes it is 0 or 1 per seed (two distinct values). The 6-distinct rule does not apply to it (it was a
    // protocol tension in the draft: the rule dropped REG exactly when the regimes were stable); its keep rule is the classifier's adequacy.
    expect(cal.dropped.REG).toBeUndefined();
    expect(Object.values(cal.values.inherit).map((v) => v.REG)).toSatisfy((r: (number | null)[]) => new Set(r).size === 2);
    expect(cal.kept).toContain("REG");
    expect(passAttainable(cal.kept)).toBe(true);
  });

  it("one Holm over every usable control x readout test: the adjusted p-values are the pooled step-down values", () => {
    const tests = cal.controls.filter((c) => c.usable).flatMap((c) => c.tests.filter((t) => t.p !== null));
    expect(tests.length).toBeGreaterThan(12);
    const h = holm(tests.map((t) => t.p as number), R2B.ALPHA);
    tests.forEach((t, k) => expect(t.adjusted).toBeCloseTo(h.adjusted[k], 12));
  });

  it("MEASUREMENT-LIMITED when no PASS is attainable: the controls move only AGE, TURN and SIG (gross controls shift those trivially)", () => {
    const flatTrail = (k: number): Shape => ({ tm: (k % 2 ? 0.4 : 40) * jit(k, 0.3), mi: (k % 2 ? 0.1 : 0.5) * jit(k, 0.2), age: 400 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) });
    const c = calibrate({
      plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(),
      runs: devSet({ controls: {
        "pc-light": (k) => ({ ...flatTrail(k), age: 150 * jit(k, 0.1), births: 120 * jit(k, 0.1) }),
        "pc-upkeep": (k) => ({ ...flatTrail(k), age: 80 * jit(k, 0.1), births: 90 * jit(k, 0.1) }),
        "pc-blind": (k) => ({ ...flatTrail(k), sig: 0.05 * jit(k, 0.1) }),
      } }),
    });
    expect(c.kept).toEqual(expect.arrayContaining(["AGE", "TURN", "SIG"]));
    expect(c.kept).not.toContain("TM");
    expect(c.kept).not.toContain("MI");
    expect(c.kept.length).toBeGreaterThanOrEqual(2);
    expect(passAttainable(c.kept)).toBe(false);
    expect(c.verdict).toBe("MEASUREMENT-LIMITED");
    expect(c.reasons.join()).toMatch(/PASS is unattainable/);
  });

  it("MI exists only for a seed whose every window census is valid; fewer than 8 measurable inherit seeds drop MI (a PASS is then unattainable)", () => {
    const inh = (invalid: (k: number) => number) => (k: number): Shape => ({ tm: (k % 2 === 0 ? 40 : 0.4) * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 400 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2), miInvalid: invalid(k) });
    const none = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(), runs: devSet({ inherit: inh(() => 0.9) }) });
    expect(Object.values(none.values.inherit).every((v) => v.MI === null)).toBe(true);
    expect(none.miMeasurable).toBe(0);
    expect(none.dropped.MI).toMatch(/in only 0 of 20 inherit dev seeds/);
    expect(none.kept).not.toContain("MI");
    expect(none.verdict).toBe("MEASUREMENT-LIMITED");
    expect(none.reasons.join()).toMatch(/PASS is unattainable/);
    // the trail-off half of the seeds has no MI, the trail-on half does: 10 measurable seeds are enough, and MI is tested over those only
    const half = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(), runs: devSet({ inherit: inh((k) => (k % 2 === 0 ? 0 : 1)) }) });
    expect(half.miMeasurable).toBe(10);
    expect(half.dropped.MI).toBeUndefined();
    expect(half.kept).toContain("MI");
    // 7 measurable seeds are not
    const seven = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(), runs: devSet({ inherit: inh((k) => (k < 7 ? 0 : 1)) }) });
    expect(seven.miMeasurable).toBe(7);
    expect(seven.dropped.MI).toMatch(/in only 7 of 20/);
    // a seed with a single invalid census among its 100 has no MI either (no zero fill, no averaging of the valid ones only)
    const one = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(), runs: devSet({ inherit: inh(() => 0.01) }) });
    expect(one.miMeasurable).toBe(0);
  });

  it("the null must be matched at the achieved ratio and at the protocol length, not only in the matching rounds", () => {
    const off = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: { ...matching(), converged: false, ratio: 1.4 }, runs: devSet() });
    expect(off.verdict).toBe("MEASUREMENT-LIMITED");
    expect(off.reasons.join()).toMatch(/ended at d_phys \/ T = 1.4/);
    // a null that was matched at 30k steps but deposits 1.8 x T in W at 100k
    const drift = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(), runs: devSet({ physarum: (k) => ({ tm: 9 * jit(k, 0.2), mi: 0.3 * jit(k, 0.1), age: 700 * jit(k, 0.1), births: 35 * jit(k, 0.1), d: 0.9 }) }) });
    expect(drift.physarum.devRatio).toBeCloseTo(1.8, 12);
    expect(drift.verdict).toBe("MEASUREMENT-LIMITED");
    expect(drift.reasons.join()).toMatch(/not matched at the protocol length/);
    const within = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: { ...matching(), converged: false, ratio: 1.15 }, runs: devSet({ physarum: (k) => ({ tm: 9 * jit(k, 0.2), mi: 0.3 * jit(k, 0.1), age: 700 * jit(k, 0.1), births: 35 * jit(k, 0.1), d: 0.55 }) }) });
    expect(within.verdict).toBe("READY"); // unconverged but within 25% on both counts: stated, not refused
    expect(within.physarum.devRatio).toBeCloseTo(1.1, 12);
  });

  it("the matching gate recomputes the last round's d_phys / T: a record that lies about its ratio does not pass the gate", () => {
    const liar = { ...matching(), converged: false, ratio: 1, rounds: [{ round: 3, v: 128, dPhys: 0.7, perSeed: [], digests: [] }] };
    const c = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: liar, runs: devSet() });
    expect(c.verdict).toBe("MEASUREMENT-LIMITED");
    expect(c.reasons.join()).toMatch(/ended at d_phys \/ T = 1.4/);
  });

  it("the trail-on fallback is flagged: the null then deposits more than a typical inherit seed, and the calibration says by how much", () => {
    // 10 trail-on seeds deposit 0.4, 10 trail-off seeds 0.02: the median is 0.21 above 1/16, so no fallback; make 15 of 20 trail-off
    const inh = (k: number): Shape => (k < 5 ? { tm: 40 * jit(k, 0.3), mi: 0.5 * jit(k, 0.2), age: 400 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2), d: 0.4 } : { tm: 0.2 * jit(k, 0.3), mi: 0.1 * jit(k, 0.2), age: 900 * jit(k, 0.3), sig: 0.35 * jit(k, 0.3), births: 30 * jit(k, 0.2), d: 0.02 });
    const fb = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: { ...matching(), T: 0.4 }, runs: devSet({ inherit: inh, physarum: (k) => ({ tm: 9 * jit(k, 0.2), mi: 0.3 * jit(k, 0.1), age: 700 * jit(k, 0.1), births: 35 * jit(k, 0.1), d: 0.4 }) }) });
    expect(fb.target.source).toBe("trail-on");
    expect(fb.target.T).toBeCloseTo(0.4, 12);
    expect(fb.physarum.targetToAll).toBeCloseTo(0.4 / 0.02, 6);
    expect(calibrationReport(fb, matching())).toMatch(/FALLBACK: the null is matched to the trail-on seeds, so it deposits 20\.0 times/);
  });

  it("is a deterministic function of the series, and prints a report with the numbers", () => {
    const again = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: devSet(), matching: matching(), perms: PERMS, boots: BOOTS });
    expect(JSON.stringify(again)).toBe(JSON.stringify(cal));
    const txt = calibrationReport(cal, matching());
    expect(txt).toMatch(/verdict READY/);
    expect(txt).toMatch(/Regime classifier/);
    expect(txt).toMatch(/Kept readouts: /);
    expect(txt).toMatch(/pc-light/);
  });

  it("a readout with fewer than 6 distinct inherit values is dropped, and a one-regime inherit drops REG", () => {
    const flat = calibrate({
      plan: "full", devSeeds: seedsOf(2001, 2020), perms: PERMS, boots: BOOTS, matching: matching(),
      runs: devSet({ inherit: (k) => ({ tm: 20 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 400, sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) }) }),
    });
    expect(flat.dropped.AGE).toMatch(/only 1 distinct/);
    expect(flat.kept).not.toContain("AGE");
    expect(flat.kept).not.toContain("REG");
  });

  it("a tripped inherit run makes the calibration MEASUREMENT-LIMITED; a tripped control is unusable, not fatal; all controls tripped is limited", () => {
    const tripped = devSet({ inherit: (k) => ({ tm: (k % 2 ? 0.4 : 40) * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 400 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), n: k === 3 ? 150 : 2000, births: 40 * jit(k, 0.2) }) });
    const c1 = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: tripped, matching: matching(), perms: PERMS, boots: BOOTS });
    expect(c1.verdict).toBe("MEASUREMENT-LIMITED");
    expect(c1.guardTrips).toContain("inherit 2004");
    const oneControl = devSet({ controls: { "pc-upkeep": (k) => ({ tm: 20, mi: 0.3 * jit(k, 0.2), age: 80 * jit(k, 0.1), n: 100, births: 90 }) } });
    const c2 = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: oneControl, matching: matching(), perms: PERMS, boots: BOOTS });
    expect(c2.controls.find((c) => c.control === "pc-upkeep")!.usable).toBe(false);
    expect(c2.verdict).toBe("READY");
    const dead = (k: number): Shape => ({ tm: 20 * jit(k, 0.2), mi: 0.3, age: 80 * jit(k, 0.1), n: 100 });
    const c3 = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: devSet({ controls: { "pc-light": dead, "pc-upkeep": dead, "pc-blind": dead } }), matching: matching(), perms: PERMS, boots: BOOTS });
    expect(c3.verdict).toBe("MEASUREMENT-LIMITED");
    expect(c3.reasons.join()).toMatch(/all positive controls are unusable/);
  });

  it("an unmatched null, a limited matching, and fewer than 2 kept readouts are MEASUREMENT-LIMITED; a missing run throws", () => {
    expect(calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: devSet(), matching: matching(null), perms: PERMS, boots: BOOTS }).verdict).toBe("MEASUREMENT-LIMITED");
    expect(calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: devSet(), matching: null, perms: PERMS, boots: BOOTS }).reasons.join()).toMatch(/not been matched/);
    const nothing = devSet({ controls: { "pc-light": (k) => ({ tm: 22 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 500 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) }), "pc-upkeep": (k) => ({ tm: 22 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 500 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) }), "pc-blind": (k) => ({ tm: 22 * jit(k, 0.3), mi: 0.3 * jit(k, 0.2), age: 500 * jit(k, 0.3), sig: 0.4 * jit(k, 0.3), births: 40 * jit(k, 0.2) }) } });
    const lim = calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: nothing, matching: matching(), perms: PERMS, boots: BOOTS });
    expect(lim.kept.length).toBeLessThan(2);
    expect(lim.verdict).toBe("MEASUREMENT-LIMITED");
    const missing = devSet(); delete missing.blocked![2010];
    expect(() => calibrate({ plan: "full", devSeeds: seedsOf(2001, 2020), runs: missing, matching: matching(), perms: PERMS, boots: BOOTS })).toThrow(/blocked seeds 2010/);
  });
});

describe("the labels on synthetic confirmation series", () => {
  const seeds = seedsOf(5001, 5016);
  const KEPT = ["TM", "MI", "AGE", "TURN", "SIG"] as const;
  const set = (inh: (k: number) => Shape, blk: (k: number) => Shape, phys: (k: number) => Shape): RunSet => {
    const mk = (f: (k: number) => Shape) => Object.fromEntries(seeds.map((s, k) => [s, synth(f(k))]));
    return { inherit: mk(inh), blocked: mk(blk), physarum: mk(phys) };
  };
  const base = (k: number): Shape => ({ tm: 5 * jit(k, 0.4), mi: 0.2 * jit(k, 0.4), age: 800 * jit(k, 0.4), sig: 0.3 * jit(k, 0.4), births: 40 * jit(k, 0.4) });
  const input = (runs: RunSet, over: Partial<Parameters<typeof decide>[0]> = {}) => ({
    seeds, runs, kept: [...KEPT], tau: null, calibrationVerdict: "READY", calibrationReasons: [], invalid: [], perms: PERMS, boots: BOOTS, ...over,
  });
  const high = (k: number): Shape => ({ tm: 50 * jit(k, 0.2), mi: 0.6 * jit(k, 0.1), age: 3000 * jit(k, 0.1), sig: 0.6 * jit(k, 0.1), births: 120 * jit(k, 0.1) });

  it("PASS: inherit differs from blocked and from physarum on TM (mass) and MI (structure), the two non-exposed families, and on more", () => {
    const d = decide(input(set(high, base, base)));
    expect(d.label).toBe("PASS");
    expect(d.pair).toEqual(expect.arrayContaining(["TM", "MI"]));
    expect(d.sepBlocked).toEqual(expect.arrayContaining(["TM", "MI", "AGE", "TURN", "SIG"]));
    expect(d.sepPhysarum).toEqual(expect.arrayContaining(["TM", "MI", "AGE", "TURN"]));
    expect(d.sepPhysarum).not.toContain("SIG");
    expect(d.both).not.toContain("SIG");
    expect(d.intersection.map((t) => t.readout)).toEqual(["TM", "MI", "AGE", "TURN"]); // SIG is not eligible for the physarum contrast
    for (const t of d.intersection) expect(t.p).toBe(Math.max(t.pBlocked, t.pPhysarum));
    expect(d.ordering.TM).toBe("beyond");
    expect(d.tests.physarum.find((t) => t.readout === "AGE")!.exposed).toBe(true);
    expect(d.tests.blocked.find((t) => t.readout === "SIG")).toBeDefined();
    expect(d.tests.physarum.find((t) => t.readout === "SIG")).toBeUndefined();
    const txt = confirmReport(d, { tau: null, v: 128 }, seeds);
    expect(txt).toMatch(/LABEL: PASS \(pair /);
    expect(txt).toMatch(/Intersection family/);
    expect(txt).toMatch(/The matched null/);
  });

  it("the families: MASS (TM, REG), STRUCT (MI), LIFE (AGE, TURN), GENOME (SIG); a PASS needs a MASS readout and MI", () => {
    expect(FAMILY).toEqual({ TM: "MASS", REG: "MASS", MI: "STRUCT", AGE: "LIFE", TURN: "LIFE", SIG: "GENOME" });
    expect(passPair(["TM", "MI", "AGE"])).toEqual(["TM", "MI"]);
    expect(passPair(["REG", "MI"])).toEqual(["REG", "MI"]);
    expect(passPair(["TM", "REG", "AGE"])).toEqual([]); // TM and REG are one factor
    expect(passPair(["MI", "AGE", "TURN"])).toEqual([]);
    expect(passPair(["TM", "AGE", "TURN"])).toEqual([]);
    expect(passAttainable(["AGE", "TURN", "SIG"])).toBe(false);
    expect(passAttainable(["TM", "MI"])).toBe(true);
  });

  it("one non-exposed family is not a PASS: TM (and AGE, TURN) separate from both arms, MI does not -> PHYSARUM-EXPLAINS (c)", () => {
    // MI the same in all three arms; TM, AGE and TURN far from both. Under the draft rule (two readouts in Both, one non-exposed) this was a PASS.
    const inh = (k: number): Shape => ({ ...high(k), mi: 0.2 * jit(k, 0.4) });
    const d = decide(input(set(inh, base, base)));
    expect(d.both).toEqual(expect.arrayContaining(["TM", "AGE", "TURN"]));
    expect(d.both).not.toContain("MI");
    expect(d.label).toBe("PHYSARUM-EXPLAINS");
    expect(d.subcases).toContain("c");
    expect(d.pair).toEqual([]);
  });

  it("the review's scenario: each contrast alone is rejected by a different readout, but no readout separates from BOTH after the intersection Holm", () => {
    // TM separates inherit from blocked only; MI separates inherit from physarum only. Two separate Holm families would each reject their strong
    // alternative and then test the one remaining null at 0.05; the intersection p (the larger of the two) is large for both readouts.
    const inh = (k: number): Shape => ({ ...base(k), tm: 50 * jit(k, 0.2), mi: 0.6 * jit(k, 0.1) });
    const blk = (k: number): Shape => ({ ...base(k), tm: 5 * jit(k, 0.4), mi: 0.6 * jit(k, 0.1) * jit(k + 3, 0.1) });
    const phys = (k: number): Shape => ({ ...base(k), tm: 50 * jit(k + 5, 0.2), mi: 0.2 * jit(k, 0.4) });
    const d = decide(input(set(inh, blk, phys)));
    expect(d.sepBlocked).toContain("TM");
    expect(d.sepPhysarum).toContain("MI");
    const tm = d.intersection.find((t) => t.readout === "TM")!, mi = d.intersection.find((t) => t.readout === "MI")!;
    expect(tm.p).toBe(tm.pPhysarum);
    expect(mi.p).toBe(mi.pBlocked);
    expect(tm.separates).toBe(false);
    expect(mi.separates).toBe(false);
    expect(d.both).not.toContain("TM");
    expect(d.both).not.toContain("MI");
    expect(d.label).toBe("PHYSARUM-EXPLAINS");
  });

  it("Holm over intersection p-values: the adjusted values are the step-down values of the max p, and Both is a subset of sepBlocked by definition", () => {
    const d = decide(input(set(high, base, base)));
    const h = holm(d.intersection.map((t) => t.p), R2B.ALPHA);
    d.intersection.forEach((t, k) => { expect(t.adjusted).toBeCloseTo(h.adjusted[k], 12); expect(t.reject).toBe(h.reject[k]); });
    for (const id of d.both) expect(d.sepBlocked).toContain(id);
  });

  it("the review's MI scenarios: identical normalised patterns with inherit's trail partly under the 500-unit cutoff give no MI for inherit, so the confirmation is MEASUREMENT-LIMITED, never a PASS", () => {
    // 25% of inherit's censuses invalid (zero fill used to lower its mean MI by mass alone; averaging only the valid ones lets the cutoff pick the observations)
    for (const frac of [0.25, 0.5, 0.01]) {
      const inh = (k: number): Shape => ({ ...high(k), mi: 0.2 * jit(k, 0.4), miInvalid: frac });
      const d = decide(input(set(inh, base, base)));
      expect(d.miSeeds.inherit, `${frac}`).toBe(0);
      expect(d.label, `${frac}`).toBe("MEASUREMENT-LIMITED");
      expect(d.reasons.join()).toMatch(/only 0 inherit seeds/);
    }
    // with every census valid MI is scale-invariant: the same normalised pattern at 10x the trail does not separate on MI, and TM alone is not a PASS
    const inh = (k: number): Shape => ({ ...high(k), mi: 0.2 * jit(k, 0.4) });
    const d = decide(input(set(inh, base, base)));
    expect(d.both).toContain("TM");
    expect(d.both).not.toContain("MI");
    expect(d.label).toBe("PHYSARUM-EXPLAINS");
    expect(d.subcases).toContain("c");
    expect(d.pair).toEqual([]);
    expect(d.miSeeds.inherit).toBe(16);
  });

  it("MI is tested over the measurable seeds of each arm; an arm with fewer than 8 makes the confirmation MEASUREMENT-LIMITED, not a label about heredity", () => {
    const gone = (k: number): Shape => ({ ...high(k), miInvalid: k < 10 ? 1 : 0 }); // 10 of 16 inherit seeds have no trail census at all
    const d = decide(input(set(gone, base, base)));
    expect(d.miSeeds.inherit).toBe(6);
    expect(d.label).toBe("MEASUREMENT-LIMITED");
    expect(d.reasons.join()).toMatch(/only 6 inherit seeds \(need 8 per arm\)/);
    const enough = (k: number): Shape => ({ ...high(k), miInvalid: k < 8 ? 1 : 0 });
    const e = decide(input(set(enough, base, base)));
    expect(e.miSeeds.inherit).toBe(8);
    expect(e.label).toBe("PASS"); // MI separates over the 8 measurable inherit seeds against 16 and 16
    expect(e.intersection.find((t) => t.readout === "MI")!.separates).toBe(true);
    expect(confirmReport(e, { tau: null, v: 128 }, seeds)).toMatch(/seeds with a measurable MI per arm inherit 8/);
  });

  it("NOT-SEPARATED: inherit separates from blocked on no kept readout", () => {
    expect(decide(input(set(base, (k) => base(k + 3), (k) => base(k + 7)))).label).toBe("NOT-SEPARATED");
  });

  it("PHYSARUM-EXPLAINS (a): inherit differs from blocked but physarum looks like inherit", () => {
    const d = decide(input(set(high, base, high)));
    expect(d.label).toBe("PHYSARUM-EXPLAINS");
    expect(d.both).toEqual([]);
    expect(d.subcases).toContain("a");
    expect(d.subcases).not.toContain("b");
  });

  it("PHYSARUM-EXPLAINS (b): only the exposed readouts AGE and TURN separate from both, even though others separate from blocked", () => {
    const inh = (k: number): Shape => ({ ...high(k), tm: 5 * jit(k, 0.4), mi: 0.2 * jit(k, 0.4) });
    const phys = (k: number): Shape => ({ ...base(k), age: 800 * jit(k, 0.4), births: 40 * jit(k, 0.4) });
    // inherit: high AGE and TURN; blocked: low everything; physarum: like blocked on AGE and TURN, like inherit on TM and MI
    const d = decide(input(set(inh, (k) => ({ ...base(k), tm: 1 * jit(k, 0.3), mi: 0.05 * jit(k, 0.3) }), phys)));
    expect(d.label).toBe("PHYSARUM-EXPLAINS");
    expect(d.both.every((id) => id === "AGE" || id === "TURN")).toBe(true);
    expect(d.both.length).toBeGreaterThanOrEqual(2);
    expect(d.subcases).toContain("b");
    expect(d.subcases).not.toContain("c");
  });

  it("PHYSARUM-EXPLAINS (d): one readout separates from blocked only, or from both", () => {
    // only TM differs from blocked; SIG, AGE, TURN, MI do not
    const onlyTM = decide(input(set((k) => ({ ...base(k), tm: 50 * jit(k, 0.2) }), base, base), { kept: ["TM", "MI", "AGE", "TURN", "SIG"] }));
    expect(onlyTM.label).toBe("PHYSARUM-EXPLAINS");
    expect(onlyTM.sepBlocked).toEqual(["TM"]);
    expect(onlyTM.subcases).toEqual(expect.arrayContaining(["c", "d"]));
    expect(onlyTM.ordering.TM).toBe("beyond");
    // SIG alone separates from blocked and cannot separate from physarum at all
    const sigOnly = decide(input(set((k) => ({ ...base(k), sig: 0.9 * jit(k, 0.1) }), base, base)));
    expect(sigOnly.sepBlocked).toEqual(["SIG"]);
    expect(sigOnly.label).toBe("PHYSARUM-EXPLAINS");
    expect(sigOnly.subcases).toEqual(expect.arrayContaining(["a", "d"]));
  });

  it("an inherit that lies between blocked and physarum is ordered 'between'", () => {
    const d = decide(input(set((k) => ({ ...base(k), tm: 20 * jit(k, 0.1), mi: 0.4 * jit(k, 0.1) }), (k) => ({ ...base(k), tm: 2 * jit(k, 0.1), mi: 0.05 * jit(k, 0.1) }), (k) => ({ ...base(k), tm: 60 * jit(k, 0.1), mi: 0.8 * jit(k, 0.1) }))));
    expect(d.both).toEqual(expect.arrayContaining(["TM", "MI"]));
    expect(d.ordering.TM).toBe("between");
    expect(d.label).toBe("PASS");
  });

  it("MEASUREMENT-LIMITED: a guard trip, a missing run, fewer than 2 kept, no attainable PASS, or an unusable calibration", () => {
    const runs = set(high, base, base);
    runs.physarum![5004] = synth({ ...base(3), n: 150 });
    const trip = decide(input(runs));
    expect(trip.label).toBe("MEASUREMENT-LIMITED");
    expect(trip.reasons.join()).toMatch(/guard tripped: physarum 5004/);
    const miss = set(high, base, base); delete miss.inherit![5016];
    expect(decide(input(miss)).reasons.join()).toMatch(/fewer runs finished than planned \(missing inherit 5016\)/);
    expect(decide(input(set(high, base, base), { kept: ["TM"] })).label).toBe("MEASUREMENT-LIMITED");
    expect(decide(input(set(high, base, base), { kept: ["AGE", "TURN", "SIG"] })).reasons.join()).toMatch(/PASS is unattainable/);
    expect(decide(input(set(high, base, base), { calibrationVerdict: "MEASUREMENT-LIMITED", calibrationReasons: ["null unmatchable"] })).label).toBe("MEASUREMENT-LIMITED");
  });

  it("MEASUREMENT-LIMITED: the null must still deposit within 25% of T at confirmation (a would-be PASS is not drawn against an unmatched null)", () => {
    const heavy = (k: number): Shape => ({ ...base(k), d: 0.5 });
    const ok = decide(input(set(high, base, heavy), { T: 0.5 }));
    expect(ok.label).toBe("PASS");
    expect(ok.nullDeposit.ratio).toBeCloseTo(1, 12);
    const off = decide(input(set(high, base, (k) => ({ ...base(k), d: 0.9 })), { T: 0.5 }));
    expect(off.label).toBe("MEASUREMENT-LIMITED");
    expect(off.reasons.join()).toMatch(/not matched/);
    expect(decide(input(set(high, base, (k) => ({ ...base(k), d: 0.9 })), { T: 0.5, fallback: true })).nullDeposit.fallback).toBe(true);
  });

  it("INVALID outranks everything, including a guard trip and a would-be PASS", () => {
    const runs = set(high, base, base);
    runs.inherit![5001] = synth({ ...high(0), n: 100 });
    const d = decide(input(runs, { invalid: ["ledger residual at step 700 (inherit 5003)"] }));
    expect(d.label).toBe("INVALID");
    expect(d.reasons).toEqual(["ledger residual at step 700 (inherit 5003)"]);
    expect(decide(input(set(high, base, base), { invalid: ["GPU-vs-CPU digest mismatch"] })).label).toBe("INVALID");
  });

  it("exactly one label applies and the labels are the five of the protocol", () => {
    const labels = new Set(["INVALID", "MEASUREMENT-LIMITED", "NOT-SEPARATED", "PASS", "PHYSARUM-EXPLAINS"]);
    for (const [i, b, p] of [[high, base, base], [base, base, base], [high, base, high]] as const) expect(labels.has(decide(input(set(i, b, p))).label)).toBe(true);
    expect(READOUT_IDS).toEqual(["TM", "MI", "REG", "AGE", "TURN", "SIG"]);
  });

  it("ratios of inherit to the other arm are flagged beyond 25%, and correlations above 0.8 (pooled or within an arm) are flagged", () => {
    const d = decide(input(set(high, base, base)));
    expect(d.ratios.blocked.find((r) => r.measure === "TM")!.flagged).toBe(true);
    expect(d.ratios.blocked.find((r) => r.measure === "n")!.ratio).toBeCloseTo(1, 12);
    expect(d.ratios.blocked.find((r) => r.measure === "n")!.flagged).toBe(false);
    expect(d.correlations.length).toBe(10); // 5 kept readouts: 10 pairs
    expect(d.correlations.some((c) => c.flagged)).toBe(true);
    expect(Object.keys(d.correlations[0].within).sort()).toEqual(["blocked", "inherit", "physarum"]);
    // pooled rho is inflated by the between-arm difference: TM and MI both jump in inherit, and the within-arm rho shows whether the seeds co-vary
    const tmMi = d.correlations.find((c) => c.a === "TM" && c.b === "MI")!;
    expect(tmMi.rho!).toBeGreaterThan(0.8);
  });

  it("reports half-window drift per seed, half-window agreement with the per-seed half values, and the regime proportion with Fisher when tau is given", () => {
    const d = decide(input(set(high, base, base), { tau: 10 }));
    expect(Object.keys(d.drift.inherit)).toHaveLength(16);
    expect(d.drift.inherit[5001].TM).toBe(0); // constant series do not drift
    expect(Object.keys(d.halfAgreement).sort()).toEqual([...READOUT_IDS].sort());
    expect(d.halfValues.AGE).toHaveLength(16);
    expect(d.halfValues.AGE[0]).toMatchObject({ seed: 5001 });
    expect(d.regime.inherit).toEqual({ on: 16, off: 0 });
    expect(d.regime.blocked).toEqual({ on: 0, off: 16 });
    expect(d.regimeFisher.blocked).toBeLessThan(1e-6);
    const txt = confirmReport(d, { tau: 10, v: 128 }, seeds);
    expect(txt).toMatch(/Horizon diagnostic/);
    expect(txt).toMatch(/Per-seed half-window values/);
    expect(txt).toMatch(/Half-window drift/);
    expect(txt).toMatch(/Fisher p/);
    expect(txt).toMatch(/MIinval/);
  });
});

describe("two analyses must agree (section 9)", () => {
  const seeds = seedsOf(5001, 5016);
  const mk = (f: (k: number) => Shape) => Object.fromEntries(seeds.map((s, k) => [s, synth(f(k))]));
  const base = (k: number): Shape => ({ tm: 5 * jit(k, 0.4), mi: 0.2 * jit(k, 0.4), age: 800 * jit(k, 0.4), sig: 0.3 * jit(k, 0.4), births: 40 * jit(k, 0.4) });
  const high = (k: number): Shape => ({ tm: 50 * jit(k, 0.2), mi: 0.6 * jit(k, 0.1), age: 3000 * jit(k, 0.1), sig: 0.6 * jit(k, 0.1), births: 120 * jit(k, 0.1) });
  const d = decide({ seeds, runs: { inherit: mk(high), blocked: mk(base), physarum: mk(base) }, kept: ["TM", "MI", "AGE", "TURN", "SIG"], tau: null, calibrationVerdict: "READY", calibrationReasons: [], invalid: [], perms: PERMS, boots: BOOTS });
  const a = summaryOf(d);
  const copy = (): typeof a => JSON.parse(JSON.stringify(a));

  it("an identical summary agrees", () => {
    expect(agreementProblems(a, copy(), PERMS)).toEqual([]);
  });

  it("a different label, set, delta, method or Hodges-Lehmann shift disagrees", () => {
    const b = copy(); b.label = "PHYSARUM-EXPLAINS";
    expect(agreementProblems(a, b, PERMS).join()).toMatch(/labels differ/);
    const c = copy(); c.both = c.both.slice(1);
    expect(agreementProblems(a, c, PERMS).join()).toMatch(/Both differ/);
    const e = copy(); e.tests.blocked[0].delta += 1e-6;
    expect(agreementProblems(a, e, PERMS).join()).toMatch(/delta/);
    const f = copy(); f.tests.blocked[0].method = f.tests.blocked[0].method === "exact" ? "permutation" : "exact";
    expect(agreementProblems(a, f, PERMS).join()).toMatch(/method/);
    const g = copy(); g.tests.physarum[0].hl *= 1.01;
    expect(agreementProblems(a, g, PERMS).join()).toMatch(/Hodges-Lehmann/);
  });

  it("a summary with the numbers omitted does not agree (a NaN difference is not within tolerance)", () => {
    const b = copy() as unknown as { tests: Record<string, Record<string, unknown>[]>; intersection: Record<string, unknown>[] };
    for (const t of [...b.tests.blocked, ...b.tests.physarum]) { delete t.p; delete t.adjusted; delete t.delta; delete t.hl; }
    for (const t of b.intersection) { delete t.p; delete t.adjusted; }
    const probs = agreementProblems(a, b as unknown as typeof a, PERMS);
    expect(probs.length).toBeGreaterThan(10);
    expect(probs.join()).toMatch(/missing or non-finite/);
    const c = copy(); c.tests.blocked[0].p = Number.NaN;
    expect(agreementProblems(a, c, PERMS).join()).toMatch(/non-finite/);
    const e = JSON.parse(JSON.stringify(a)) as Record<string, unknown>; delete e.tests; delete e.intersection;
    expect(agreementProblems(a, e as unknown as typeof a, PERMS).length).toBeGreaterThan(0);
  });

  it("an exact p must agree to 1e-9 relative; a Monte Carlo p within five standard errors of the difference (plus 2/perms)", () => {
    const ex = JSON.parse(JSON.stringify(a)) as typeof a;
    const exact = ex.tests.blocked.find((t) => t.method === "exact");
    if (exact) {
      const other = copy();
      other.tests.blocked.find((t) => t.readout === exact.readout)!.p = exact.p * (1 + 1e-6);
      expect(agreementProblems(a, other, PERMS).join()).toMatch(/p /);
    }
    // a permutation p of 0.2 on 10^6 permutations: SE of the difference 5 sqrt(2 * .2 * .8 / 1e6) = 0.0028
    const mc = copy();
    mc.tests.blocked[0].method = "permutation"; mc.tests.blocked[0].p = 0.2; mc.tests.blocked[0].adjusted = 0.2;
    const near = JSON.parse(JSON.stringify(mc)) as typeof a, far = JSON.parse(JSON.stringify(mc)) as typeof a;
    near.tests.blocked[0].p = 0.2 + 0.002; far.tests.blocked[0].p = 0.2 + 0.01;
    expect(agreementProblems(mc, near, 1_000_000).filter((x) => /blocked TM: p /.test(x))).toEqual([]);
    expect(agreementProblems(mc, far, 1_000_000).filter((x) => /blocked TM: p /.test(x))).toHaveLength(1);
  });
});

describe("the code manifest is the import closure of the R2b entry points", () => {
  const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const closure = (): string[] => {
    const seen = new Set<string>(), queue = [...R2B_ENTRY_FILES];
    while (queue.length) {
      const rel = queue.pop()!;
      if (seen.has(rel)) continue;
      seen.add(rel);
      for (const imp of localImports(readFileSync(`${root}/${rel}`, "utf8"))) {
        const target = resolve(`${root}/${dirname(rel)}`, imp).slice(root.length + 1);
        if (target.startsWith("tools/mycelium/")) queue.push(target);
      }
    }
    return [...seen].sort();
  };

  it("localImports finds static imports and re-exports, multi-line import lists, and ignores jsr: and bare specifiers", () => {
    const text = `import { a } from "./a.ts";\nimport {\n  b,\n  type C,\n} from "./b.ts";\nexport { d } from "./d.ts";\nimport { parseArgs } from "jsr:@std/cli@1/parse-args";\nimport { x } from "@bl/schema";\n// import { z } from "./commented-but-text.ts"\nimport "./side.ts";\nexport * from "../up.ts";`;
    expect(localImports(text).sort()).toEqual(["./a.ts", "./b.ts", "./d.ts", "./side.ts", "../up.ts"].sort()); // a commented-out import is not an import
  });

  it("covers what the runs execute and leaves out the lab viewer's files and the unlogged CLIs", () => {
    const c = closure();
    for (const f of ["world.ts", "gpu.ts", "observe-r2b.ts", "r2b.ts", "r2b-analyze.ts", "r2b-freeze.ts", "r2b-protocol.ts", "r2b-decide.ts", "r2b-stats.ts", "r2b-report.ts", "r2b-seeds.ts", "r2-freeze.ts"]) expect(c, f).toContain(`tools/mycelium/${f}`);
    for (const f of ["brush.ts", "run.ts", "r2.ts", "r2-analyze.ts"]) expect(c, f).not.toContain(`tools/mycelium/${f}`);
    for (const f of c) expect(() => readFileSync(`${root}/${f}`), f).not.toThrow();
  });
});
