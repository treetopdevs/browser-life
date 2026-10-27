// Bell v2 (docs/naturalist-bell-v2-2026-10-18.md): the post-hoc reading it tests, the one additive option on v1's PairScorer, the
// fresh seeds, the job plan, the fork stitching, validity, the readout, the cap and the dead-base rule. No GPU, no runs/.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SIGNALS, corpusRuns } from "../lib/bell.ts";
import { PairScorer, type Census, type PairResult } from "../lib/bell1.ts";
import { BASE_SEEDS, BIG_CENTRE, NULL_SEEDS } from "../lib/bell-v1-jobs.ts";
import { EXT_RUNS, EXT_SEED0, LAYOUT_SEED0, M4_RUNS } from "../lib/recurrence.ts";
import { R1_PRIME_SEED_BASE, R1_PRIME_SEED_MAX, REG1_SEED_BLOCK, TAU_SEED_BASE } from "../lib/pond-assay.ts";
import {
  ARMS2,
  BASE_STEPS,
  C,
  FORK_CENSUSES,
  GPU_TOOLS,
  HEARTBEAT_SECONDS,
  KEEP,
  NUDGE_TARGETS,
  PILOT_SEED,
  S,
  SEEDS,
  Stitch,
  TWIN_ORDER,
  Z1,
  absenceOf,
  attemptsOf,
  baseArgs,
  baseManifestProblem,
  budgetUsed,
  CAP_HOURS,
  defaultRecord2,
  denoScript,
  forkArgs,
  forkManifestProblem,
  gpuUsers,
  interventionProblem2,
  isDenoProcess,
  jobOfId,
  jobProblems2,
  jobSeconds,
  judge2,
  lastUnclosed,
  orphanAttempt,
  cleanExit,
  ReplacementsExhausted,
  orphanEndElapsed,
  pilotLedger,
  launchState,
  lineageRowsCheck,
  liveRunOf,
  mayStart,
  nudgeFileText,
  otherLaunchers,
  parseLaunchEvents,
  parseNudgeFile2,
  pickSeeds,
  pilotArgs,
  pilotJobs,
  pilotNudge,
  planBases,
  planBigTwins,
  planNudgeTwins,
  planShams,
  planTwins,
  posthocV1,
  project,
  relOf,
  replacementNeeded,
  replacementSeeds,
  runLaunches,
  scaleDown,
  seedRange,
  shamCheckpoint,
  summarizeTwins2,
  twins2Called,
  unfinishedAttempts,
  voidReasons2,
  type LaunchEvent,
  reducedCommand,
  scrubLaunchEvent,
  type Arm2,
  type NudgeCentres2,
} from "../lib/bell2.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const V1_TWINS = JSON.parse(readFileSync(join(REPO, "experiments/naturalist/bell-v1-twins.json"), "utf8"));
const SEEDS2 = seedRange(SEEDS);
const centres: NudgeCentres2 = Object.fromEntries(SEEDS2.map((s, i) => [s, { nudge: { x: 120 + i, y: 128 }, nudge2: { x: 64, y: 60 + i } }]));
const has = (argv: string[], ...seq: string[]) => (" " + argv.join(" ") + " ").includes(" " + seq.join(" ") + " ");
async function* gen<T>(xs: T[]): AsyncGenerator<T> {
  for (const x of xs) yield x;
}

// ---------------------------------------------------------------------------------------------

describe("v1 post-hoc reproduces from the committed record", () => {
  it("Z*11 = 2.580695652173913 (nudge seed 9, fusions) and the hits nudge 0, nudge2 1, L64 5, L96 10, F 8", () => {
    const p = posthocV1(V1_TWINS);
    expect(p.zStar).toBeCloseTo(2.580695652173913, 9);
    expect(p.zStar).toBe(Z1);
    expect(p.zStarSeed).toBe(9);
    expect(p.zStarSignal).toBe("fusions");
    expect(p.hits).toEqual({ nudge: 0, nudge2: 1, l64: 5, l96: 10, f: 8 });
    expect(p.of).toEqual({ nudge: 10, nudge2: 10, l64: 10, l96: 10, f: 10 });
  });
  it("the record's own 13-signal rule: Z*_pair 5.7026, L96 4 and F 4", () => {
    const p = posthocV1(V1_TWINS);
    expect(p.record13.zStar).toBeCloseTo(5.7026, 4);
    expect(p.record13.l96).toBe(4);
    expect(p.record13.f).toBe(4);
    expect(V1_TWINS.summary.zStarPair.value).toBe(p.record13.zStar);
  });
});

// ---------------------------------------------------------------------------------------------
// PairScorer.results(keep).

describe("PairScorer.results(keep)", () => {
  // Ten constant bases (livingCells 1000 + 20 i, rows a = 600 + 20 i, b = 400, maxGeneration 4). The twin of base 0 moves after S:
  // livingCells + 100 (a kept signal), maxGeneration 4 -> 7 and its rows to a = 1000, b = 100 (dominantShare); both dropped signals move
  // further in their own spread than livingCells does.
  const S0 = 1000, n = 80;
  const baseRec = (i: number, k: number): Census => ({
    rec: { step: (k + 1) * 100, livingCells: 1000 + 20 * i, individuals: 50, meanMass: 10, lineages: 2, lineageShannon: 1, patternEntropy: 1, bioticRecycling: 0.5, maxGeneration: 4, fissions: 0, fusions: 0, buddings: 0, mutations: 0 },
    rows: [["a", 600 + 20 * i], ["b", 400]],
  });
  const bases = Array.from({ length: 10 }, (_, i) => Array.from({ length: n }, (_, k) => baseRec(i, k)));
  const twin: Census[] = bases[0].map((c) => (c.rec.step <= S0 ? c : { rec: { ...c.rec, livingCells: 1100, maxGeneration: 7 }, rows: [["a", 1000], ["b", 100]] }));
  const scored = () => {
    const ps = new PairScorer(S0, 10, [{ id: "t", arm: "l96", seed: 1, base: 0 }]);
    for (let k = 0; k < n; k++) ps.push(bases.map((b) => b[k]), [twin[k]]);
    return ps;
  };
  it("the default, results(), is v1's rule: pinned to the output of v1's committed PairScorer (commit edba1ec0, before the keep option) on this input", () => {
    // Computed 2026-10-18 by running `git show edba1ec0:tools/lib/bell1.ts` (no keep parameter; a literal pin, not a compare with HEAD) on exactly this fixture.
    const r = scored().results();
    expect(r[0].D).toBe(9.76595744680851);
    expect(r[0].signal).toBe("dominantShare");
    expect(r[0].side).toBe("high");
    expect(r[0].dBySignal.filter((d) => d.D > 0)).toEqual([
      { signal: "livingCells", side: "high", D: 1.498888888888889 },
      { signal: "maxGeneration", side: "high", D: 3 },
      { signal: "dominantShare", side: "high", D: 9.76595744680851 },
    ]);
    expect(createHash("sha256").update(JSON.stringify(r)).digest("hex")).toBe("b8e2d9019e98b3202b5a7e4891f12e772691f7ae15ee4e67ae21d321f8c388be");
  });
  it("KEEP is exactly the note's eleven signals, in SIGNALS order", () => {
    expect(SIGNALS.filter((x) => KEEP(x.name)).map((x) => [x.name, x.kind, x.floor])).toEqual([
      ["livingCells", "level", 1],
      ["individuals", "level", 1],
      ["meanMass", "level", 1],
      ["lineages", "level", 1],
      ["lineageShannon", "level", 0.01],
      ["patternEntropy", "level", 0.01],
      ["bioticRecycling", "level", 0.01],
      ["fissions", "rate", 1],
      ["fusions", "rate", 1],
      ["buddings", "rate", 1],
      ["mutations", "rate", 1],
    ]);
    expect(SIGNALS.filter((x) => !KEEP(x.name)).map((x) => x.name).sort()).toEqual(["dominantShare", "maxGeneration"]);
  });
  it("results(KEEP) ignores both dropped signals for D, signal, side and windowMax, and still lists all 13 in dBySignal", () => {
    const ps = scored();
    const [all] = ps.results(), [kept] = ps.results(KEEP);
    expect(kept.D).toBe(1.498888888888889);
    expect(kept.signal).toBe("livingCells");
    expect(kept.side).toBe("high");
    expect(kept.dBySignal).toHaveLength(26);
    expect(kept.dBySignal).toEqual(all.dBySignal);
    expect(Math.max(...kept.windowMax)).toBe(kept.D);
    kept.windowMax.forEach((m, w) => expect(m).toBeLessThanOrEqual(all.windowMax[w]));
    // maxGeneration moved too: kept, it would set D.
    expect(ps.results((x) => x !== "dominantShare")[0]).toMatchObject({ D: 3, signal: "maxGeneration" });
  });
});

// ---------------------------------------------------------------------------------------------

describe("fresh seeds are disjoint", () => {
  it("the v2 seeds, the pilot seed and the replacements share nothing with any earlier corpus", () => {
    const v2 = [...SEEDS2, PILOT_SEED, ...replacementSeeds()];
    expect(SEEDS2).toEqual([3901, 3902, 3903, 3904, 3905, 3906, 3907, 3908, 3909, 3910]);
    expect(replacementSeeds()).toEqual(seedRange([3911, 3920]));
    expect(new Set(v2).size).toBe(v2.length);
    const used = new Set<number>([...corpusRuns().map((r) => r.seed), ...seedRange(NULL_SEEDS), ...seedRange(BASE_SEEDS), 2001]);
    // Every number under a key naming a seed, at any depth, in every committed experiments/ record (v2's own records, written later,
    // are excluded); a two-number array under such a key is also read as a range [a, b].
    const ranges: [string, number, number][] = [];
    const walk = (o: unknown, file: string, key?: string) => {
      if (Array.isArray(o)) {
        if (key && /seed/i.test(key) && o.length === 2 && o.every((x) => typeof x === "number") && o[0] < o[1]) ranges.push([`${file} ${key}`, o[0], o[1]]);
        for (const x of o) walk(x, file, key);
      } else if (o !== null && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, file, k);
      else if (typeof o === "number" && key && /seed/i.test(key)) used.add(o);
    };
    const files: string[] = [];
    const find = (dir: string) => {
      for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
        if (e.isDirectory()) find(`${dir}/${e.name}`);
        else if (e.name.endsWith(".json") && !e.name.startsWith("bell-v2-")) files.push(`${dir}/${e.name}`);
      }
    };
    find("experiments");
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) walk(JSON.parse(readFileSync(join(REPO, f), "utf8")), f);
    expect(ranges.filter(([, lo, hi]) => v2.some((x) => x >= lo && x <= hi))).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
    expect(v2.filter((s) => used.has(s))).toEqual([]);
  });
  it("and lie outside every other seed family the code defines (m4, the extension, the founder layouts, the pond assays)", () => {
    const v2 = [...SEEDS2, PILOT_SEED, ...replacementSeeds()];
    const lo = Math.min(...v2), hi = Math.max(...v2);
    const blocks: [string, number, number][] = [
      ["m4 replay seeds 1..20", 1, Math.max(...Object.values(M4_RUNS))],
      ["the 10^7 extension", EXT_SEED0, EXT_SEED0 + EXT_RUNS - 1],
      // Founder layouts: LAYOUT_SEED0[family] + 10 g + j; a block of 100,000 above each base is far more than any layout uses.
      ...Object.entries(LAYOUT_SEED0).map(([k, v]) => [`layout ${k}`, v, v + 99_999] as [string, number, number]),
      ["R1' assays", R1_PRIME_SEED_BASE, R1_PRIME_SEED_MAX],
      ["tau calibration", TAU_SEED_BASE, TAU_SEED_BASE + 1],
      ["registration 1", REG1_SEED_BLOCK.min, REG1_SEED_BLOCK.max],
    ];
    for (const [name, a, b] of blocks) expect([name, b < lo || a > hi]).toEqual([name, true]);
  });
  it("no TypeScript source outside bell v2 names a number from 3,900 to 3,920 (tools, experiments, packages/*/src, apps/lab/src)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== "node_modules") walk(rel);
          continue;
        }
        if (!e.name.endsWith(".ts") || /(^|\/)bell2/.test(rel)) continue;
        const text = readFileSync(join(REPO, rel), "utf8");
        // Long hex runs (hashes) are not seeds; blank them so their digits cannot match, keeping offsets.
        const scan = text.replace(/\b[0-9a-f]{16,}\b/gi, (m) => " ".repeat(m.length));
        for (const m of scan.matchAll(/(?<![\d_.])(3_?9[01]\d|3_?920)(?![\d_])/g)) hits.push(`${rel}: ${text.slice(Math.max(0, m.index! - 30), m.index! + 10).replace(/\s+/g, " ")}`);
      }
    };
    for (const d of ["tools", "experiments", "apps/lab/src", ...readdirSync(join(REPO, "packages")).map((p) => `packages/${p}/src`)]) {
      try {
        walk(d);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("plan", () => {
  const bases = planBases(SEEDS2), twins = planTwins(SEEDS2, centres);
  const all = [...bases, ...twins];
  it("10 bases and 60 forks, unique ids and destinations, valid experiment names", () => {
    expect(bases).toHaveLength(10);
    expect(twins).toHaveLength(60);
    expect(jobProblems2(all)).toEqual([]);
    expect(new Set(all.map((j) => j.rel)).size).toBe(70);
    for (const j of all) expect(j.experiment).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(new Set(twins.map((j) => j.arm))).toEqual(new Set(ARMS2));
    expect(bases[0].rel).toBe("bell-v2-base/gradient-m3/treatment/seed-3901");
    expect(twins.find((j) => j.id === "twin-l96-3905")!.rel).toBe("bell-v2-twins-l96/gradient-m3/treatment/seed-3905");
  });
  it("a base: 206,000 steps, one checkpoint at C, no interventions, no --lineage-obs", () => {
    const argv = baseArgs(bases[0], "/out");
    expect(has(argv, "--steps", "206000", "--census", "100", "--deep", "10", "--checkpoint", "190000")).toBe(true);
    expect(has(argv, "--seeds", "3901")).toBe(true);
    expect(argv).not.toContain("--lineage-obs");
    expect(argv.some((x) => x === "--lesion" || x === "--feed" || x === "--start-from")).toBe(false);
    expect(BASE_STEPS).toBe(206_000);
  });
  it("a fork: from its base's checkpoint at C for 16,000 steps; the sham writes the checkpoint at S and has no intervention", () => {
    const sham = twins.find((j) => j.id === "twin-sham-3901")!;
    const argv = forkArgs(sham, "/out", "/out/bell-v2-base/gradient-m3/treatment/seed-3901");
    expect(has(argv, "--start-from", "/out/bell-v2-base/gradient-m3/treatment/seed-3901", "--start-step", "190000")).toBe(true);
    expect(has(argv, "--steps", "16000")).toBe(true);
    expect(has(argv, "--checkpoint", "10000")).toBe(true);
    expect(argv.some((x) => x === "--lesion" || x === "--feed" || x === "--lineage-obs")).toBe(false);
    expect(sham.expected).toBeNull();
    for (const j of twins.filter((t) => t.arm !== "sham")) expect(has(forkArgs(j, "/out", "/b"), "--checkpoint", "0")).toBe(true);
    expect(() => forkArgs(bases[0], "/out", "/b")).toThrow(/not a fork/);
    expect(() => baseArgs(sham, "/out")).toThrow(/not a base/);
  });
  it("v1's interventions: lesions r 64 and 96 and the feed r 32 x 64 at (128, 128), nudges r 1 at their centres, all at S", () => {
    const get = (id: string) => twins.find((j) => j.id === id)!;
    expect(get("twin-l64-3902").intervention).toEqual(["--lesion", "200000:128,128,64"]);
    expect(get("twin-l96-3902").intervention).toEqual(["--lesion", "200000:128,128,96"]);
    expect(get("twin-f-3902").intervention).toEqual(["--feed", "200000:128,128,32,64"]);
    expect(get("twin-nudge-3902").intervention).toEqual(["--lesion", "200000:121,128,1"]);
    expect(get("twin-nudge2-3902").intervention).toEqual(["--lesion", "200000:64,61,1"]);
    expect(get("twin-f-3902").expected).toEqual({ step: S, kind: "feed", x: 128, y: 128, r: 32, amount: 64 });
    for (const j of twins) if (j.expected) expect(j.expected.step).toBe(S);
  });
  it("shams and the big twins need no centres; a missing nudge centre throws", () => {
    expect(planShams(SEEDS2)).toHaveLength(10);
    expect(planBigTwins(SEEDS2)).toHaveLength(30);
    const short: NudgeCentres2 = { ...centres, 3905: { nudge: { x: 1, y: 1 } } };
    expect(() => planNudgeTwins(SEEDS2, short)).toThrow(/no nudge2 centre for seed 3905/);
    expect(() => planTwins(SEEDS2, {})).toThrow(/no nudge centre for seed 3901/);
  });
  it("the launch order after bases and shams: L96, F, nudge, nudge2, then L64 (the launcher loops over TWIN_ORDER)", () => {
    expect(TWIN_ORDER).toEqual(["l96", "f", "nudge", "nudge2", "l64"]);
    expect(new Set(["sham", ...TWIN_ORDER])).toEqual(new Set(ARMS2));
  });
  it("v1's targets: nudges nearest (128, 128) and (64, 64), the big arms at (128, 128)", () => {
    expect(NUDGE_TARGETS).toEqual({ nudge: [128, 128], nudge2: [64, 64] });
    expect(BIG_CENTRE).toEqual([128, 128]);
  });
  it("the pilot: base 16,000 steps (checkpoint 10,000), sham from 10,000 for 6,000 (checkpoint at 15,000), L96, F and a nudge at 15,000", () => {
    const { base, sham, l96, f } = pilotJobs();
    expect(has(pilotArgs(f, "/p", "/b"), "--feed", "15000:128,128,32,64")).toBe(true);
    expect(has(pilotArgs(f, "/p", "/b"), "--checkpoint", "0")).toBe(true);
    const nudge = pilotNudge({ x: 120, y: 131 });
    expect(nudge.id).toBe("twin-nudge-3900");
    expect(has(pilotArgs(nudge, "/p", "/b"), "--lesion", "15000:120,131,1", "--start-from", "/b", "--start-step", "10000")).toBe(true);
    expect(has(pilotArgs(nudge, "/p", "/b"), "--steps", "6000")).toBe(true);
    expect(base.seed).toBe(3900);
    expect(has(pilotArgs(base, "/p"), "--steps", "16000", "--census", "100", "--deep", "10", "--checkpoint", "10000")).toBe(true);
    expect(has(pilotArgs(sham, "/p", "/b"), "--steps", "6000")).toBe(true);
    expect(has(pilotArgs(sham, "/p", "/b"), "--checkpoint", "5000")).toBe(true);
    expect(has(pilotArgs(sham, "/p", "/b"), "--start-from", "/b", "--start-step", "10000")).toBe(true);
    expect(has(pilotArgs(l96, "/p", "/b"), "--lesion", "15000:128,128,96")).toBe(true);
    expect(() => pilotArgs(l96, "/p")).toThrow(/base directory/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("stitching", () => {
  const cen = (step: number, lc = 10): Census => ({ rec: { step, livingCells: lc, lineages: 1 }, rows: [["a", lc]] });
  it("at steps <= C the twin's input is its base's census object, and the fork is not read until after C", async () => {
    let pulls = 0;
    async function* fork() {
      for (let s = 600; s <= 800; s += 100) {
        pulls++;
        yield cen(s, 99);
      }
    }
    const st = new Stitch(fork(), 500, 100);
    for (let s = 100; s <= 500; s += 100) {
      const b = cen(s);
      expect(await st.next(s, b)).toBe(b);
    }
    expect(pulls).toBe(0);
    const x = await st.next(600, cen(600));
    expect((x as Census).rec.livingCells).toBe(99);
    expect(pulls).toBe(1);
    await st.next(700, cen(700));
    await st.next(800, cen(800));
    expect(await st.finish(3)).toBeNull();
  });
  it("a fork whose first census is not at C + 100 fails, named", async () => {
    const st = new Stitch(gen([cen(700)]), 500, 100);
    await st.next(500, cen(500));
    const x = await st.next(600, cen(600));
    expect(x).toEqual({ fail: "the fork's first census is at step 700, expected 600" });
    expect(await st.next(700, cen(700))).toEqual({ fail: "the fork's first census is at step 700, expected 600" });
  });
  it("a short fork, a long fork and a gap fail", async () => {
    const short = new Stitch(gen([cen(600)]), 500, 100);
    await short.next(600, cen(600));
    expect(await short.next(700, cen(700))).toEqual({ fail: "the fork ended after 1 censuses, expected 160" });
    const long = new Stitch(gen([cen(600), cen(700)]), 500, 100);
    await long.next(600, cen(600));
    expect(await long.finish(1)).toMatch(/more than 1 censuses/);
    const gap = new Stitch(gen([cen(600), cen(800)]), 500, 100);
    await gap.next(600, cen(600));
    expect(await gap.next(700, cen(700))).toEqual({ fail: "the fork's census 2 is at step 800, expected 700" });
    const none = new Stitch(null, 500, 100, "bundle missing");
    expect(await none.next(100, cen(100))).toEqual({ fail: "bundle missing" });
    expect(FORK_CENSUSES).toBe(160);
  });
  it("with v1's PairScorer: a sham scores D 0 with no difference; a lesion fork equals its base to S and differs after", async () => {
    const S0 = 1000, C0 = 500, n = 80;
    const baseRec = (i: number, k: number): Census => ({
      rec: { step: (k + 1) * 100, livingCells: 1000 + 20 * i, individuals: 50, meanMass: 10, lineages: 2, lineageShannon: 1, patternEntropy: 1, bioticRecycling: 0.5, maxGeneration: 4, fissions: 0, fusions: 0, buddings: 0, mutations: 0 },
      rows: [["a", 600 + 20 * i], ["b", 400]],
    });
    const bases = Array.from({ length: 10 }, (_, i) => Array.from({ length: n }, (_, k) => baseRec(i, k)));
    const after = bases[0].filter((c) => c.rec.step > C0);
    const sham = new Stitch(gen(after.map((c) => ({ rec: { ...c.rec }, rows: c.rows.map((r) => [...r] as [string, number]) }))), C0, 100);
    const lesion = new Stitch(gen(after.map((c) => (c.rec.step <= S0 ? { rec: { ...c.rec }, rows: c.rows } : { rec: { ...c.rec, livingCells: 600 }, rows: [["a", 200], ["b", 400]] as [string, number][] }))), C0, 100);
    const ps = new PairScorer(S0, 10, [{ id: "twin-sham-1", arm: "sham", seed: 1, base: 0 }, { id: "twin-l96-1", arm: "l96", seed: 1, base: 0 }]);
    for (let k = 0; k < n; k++) {
      const step = (k + 1) * 100;
      ps.push(bases.map((b) => b[k]), [await sham.next(step, bases[0][k]), await lesion.next(step, bases[0][k])]);
    }
    expect(await sham.finish(n - C0 / 100)).toBeNull();
    expect(await lesion.finish(n - C0 / 100)).toBeNull();
    const [rs, rl] = ps.results(KEEP);
    expect(rs.D).toBe(0);
    expect(rs.diffAtOrBeforeS).toBeNull();
    expect(rs.firstDiffStep).toBeNull();
    expect(judge2(rs, "sham", {}, null, S0).valid).toBe(true);
    expect(rl.D).toBeGreaterThan(4);
    expect(rl.firstDiffStep).toBe(S0 + 100);
    expect(judge2(rl, "l96", {}, null, S0).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

const result = (o: Partial<PairResult> & { id: string; arm: string; seed: number }): PairResult => ({
  failed: null,
  censuses: 2060,
  diffAtOrBeforeS: null,
  firstDiffStep: o.arm === "sham" ? null : S + 100,
  firstSignalDiffStep: o.arm === "sham" ? null : S + 100,
  D: 0,
  signal: null,
  side: null,
  dBySignal: [],
  windowMax: new Array(50).fill(0),
  dose: { step: S + 100, livingCells: { twin: 1, base: 1, delta: 0 }, matter: { twin: 1, base: 1, delta: 0 } },
  ...o,
});

describe("validity", () => {
  it("a sham that differs anywhere is the replay failing; any other twin must equal its base to S and differ after", () => {
    expect(voidReasons2(result({ id: "s", arm: "sham", seed: 1 }), "sham", {})).toEqual([]);
    expect(voidReasons2(result({ id: "s", arm: "sham", seed: 1, firstDiffStep: 200500 }), "sham", {})).toEqual(["replay: the sham differs from its base at step 200500"]);
    expect(voidReasons2(result({ id: "s", arm: "sham", seed: 1, diffAtOrBeforeS: 190100 }), "sham", {})).toEqual(["replay: the sham differs from its base at step 190100"]);
    expect(voidReasons2(result({ id: "t", arm: "l96", seed: 1 }), "l96", {})).toEqual([]);
    expect(voidReasons2(result({ id: "t", arm: "l96", seed: 1, diffAtOrBeforeS: 195000 }), "l96", {})).toEqual(["differs from its base at step 195000, at or before S = 200000"]);
    expect(voidReasons2(result({ id: "t", arm: "f", seed: 1, firstDiffStep: null }), "f", {})).toEqual(["no difference from its base after S = 200000"]);
    expect(voidReasons2(result({ id: "t", arm: "f", seed: 1, failed: "the fork ended after 159 censuses, expected 160" }), "f", { launch: "launch log: twin-f-1 exited 1" })).toEqual([
      "launch log: twin-f-1 exited 1",
      "stream: the fork ended after 159 censuses, expected 160",
    ]);
    expect(voidReasons2(result({ id: "t", arm: "f", seed: 1 }), "f", { missing: true, base: "bundle missing" })).toEqual(["bundle missing", "its base is void: bundle missing"]);
  });
  it("the byte-level replay check: a sham that fails it is the replay failing (R called and missed); another twin is void", () => {
    expect(voidReasons2(result({ id: "s", arm: "sham", seed: 1 }), "sham", { replay: "series.jsonl over (190000, 206000]: the census at step 200300 differs" })).toEqual([
      "replay: series.jsonl over (190000, 206000]: the census at step 200300 differs",
    ]);
    expect(voidReasons2(result({ id: "t", arm: "l96", seed: 1 }), "l96", { replay: "lineages.tsv over (190000, 200000]: row 3 differs" })).toEqual([
      "not its base's history up to S: lineages.tsv over (190000, 200000]: row 3 differs",
    ]);
  });

  const forkManifest = (over: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) =>
    JSON.stringify({
      spec: { experiment: "bell-v2-twins-l96", presetId: "gradient-m3", condition: "treatment", seed: 3901, steps: 16000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, ...spec },
      presetIdentity: "pid",
      startStep: 190000,
      checkpoints: [],
      summary: { steps: 206000 },
      ...over,
    });
  const l96 = planBigTwins([3901]).find((j) => j.arm === "l96")!;
  const sham = planShams([3901])[0];
  it("a fork manifest: spec, start at C without initHash, summary at 206,000, the base's identity, the sham's one checkpoint", () => {
    expect(forkManifestProblem(l96, forkManifest(), "pid")).toBeNull();
    expect(forkManifestProblem(l96, forkManifest({}, { steps: 206000 }), "pid")).toMatch(/spec.steps 206000, expected 16000/);
    expect(forkManifestProblem(l96, forkManifest({}, { seed: 3902 }), "pid")).toMatch(/seed-3902/);
    expect(forkManifestProblem(l96, forkManifest({}, { lineageObs: true }), "pid")).toMatch(/lineageObs/);
    expect(forkManifestProblem(l96, forkManifest({ startStep: 0 }), "pid")).toMatch(/startStep 0/);
    expect(forkManifestProblem(l96, forkManifest({ initHash: "x" }), "pid")).toMatch(/initHash/);
    expect(forkManifestProblem(l96, forkManifest({ summary: null }), "pid")).toMatch(/no summary/);
    expect(forkManifestProblem(l96, forkManifest({ summary: { steps: 16000 } }), "pid")).toMatch(/summary.steps 16000/);
    expect(forkManifestProblem(l96, forkManifest(), "other")).toMatch(/presetIdentity/);
    expect(forkManifestProblem(l96, forkManifest({ checkpoints: [{ step: 200000, file: "f", hash: "h" }] }), "pid")).toMatch(/writes none/);
    const shamM = (cks: unknown[]) => forkManifest({ checkpoints: cks }, { experiment: "bell-v2-twins-sham", checkpointEvery: 10000 });
    expect(forkManifestProblem(sham, shamM([{ step: 200000, file: "checkpoints/t000200000.blck", hash: "h" }]), "pid")).toBeNull();
    expect(forkManifestProblem(sham, shamM([]), "pid")).toMatch(/exactly one, at 200000/);
    expect(forkManifestProblem(sham, shamM([{ step: 200000, file: "a", hash: "h" }, { step: 206000, file: "b", hash: "h" }]), "pid")).toMatch(/exactly one/);
    expect(forkManifestProblem(l96, "{", "pid")).toMatch(/not JSON/);
    expect(shamCheckpoint(shamM([{ step: 200000, file: "checkpoints/t000200000.blck", hash: "h" }]))).toEqual({ step: 200000, file: "checkpoints/t000200000.blck", hash: "h" });
    expect(shamCheckpoint(shamM([{ step: 195000, file: "x", hash: "h" }]))).toBeNull();
    expect(shamCheckpoint(shamM([{ step: 15000, file: "p", hash: "h" }]), 15000)).toMatchObject({ file: "p" });
    expect(shamCheckpoint("{")).toBeNull();
  });
  it("a base manifest: spec, start at 0 with initHash, summary at 206,000, one checkpoint at C", () => {
    const [b] = planBases([3901]);
    const m = (over: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) =>
      JSON.stringify({ spec: { experiment: "bell-v2-base", presetId: "gradient-m3", condition: "treatment", seed: 3901, steps: 206000, censusEvery: 100, deepEvery: 10, ...spec }, presetIdentity: "pid", initHash: "ih", startStep: 0, checkpoints: [{ step: 190000, file: "checkpoints/t000190000.blck", hash: "h" }], summary: { steps: 206000 }, ...over });
    expect(baseManifestProblem(b, m())).toEqual({ presetIdentity: "pid", checkpoint: { step: 190000, file: "checkpoints/t000190000.blck", hash: "h" } });
    expect(baseManifestProblem(b, m({ checkpoints: [] }))).toEqual({ problem: "0 checkpoint entries at step 190000, expected exactly 1" });
    expect(baseManifestProblem(b, m({}, { interventions: [] }))).toEqual({ problem: "spec.interventions is set; a base has none" });
    expect(baseManifestProblem(b, m({ startStep: 190000 }))).toHaveProperty("problem");
    expect(baseManifestProblem(b, m({ summary: { steps: 300000 } }))).toEqual({ problem: "summary.steps 300000, expected 206000" });
    expect(baseManifestProblem(b, m({}, { steps: 300000 }))).toEqual({ problem: "spec.steps 300000, expected 206000" });
  });
  it("interventions: exactly the scheduled entry; none (and no file) for a base and a sham", () => {
    expect(interventionProblem2(sham, null)).toBeNull();
    expect(interventionProblem2(sham, "")).toMatch(/exists; this run must have none/);
    expect(interventionProblem2(sham, '{"step":200000,"kind":"lesion","x":1,"y":1,"r":1}\n')).toMatch(/holds 1 entry; this run must have none/);
    const ok = '{"step":200000,"kind":"lesion","x":128,"y":128,"r":96,"matter":5}\n';
    expect(interventionProblem2(l96, ok)).toBeNull();
    expect(interventionProblem2(l96, ok + ok)).toMatch(/holds 2 entries/);
    expect(interventionProblem2(l96, null)).toMatch(/holds 0 entries/);
    expect(interventionProblem2(l96, "x\n")).toMatch(/not JSON/);
  });
});

// ---------------------------------------------------------------------------------------------

/** A judged outcome of one twin with D11 = d (window 0 at d) and D13 = d13 (default d). */
function outcome(arm: Arm2, seed: number, d: number, opts: { d13?: number; pre?: Record<string, unknown>; r?: Partial<PairResult> } = {}) {
  const wm = new Array(50).fill(0);
  wm[3] = d;
  const r11 = result({ id: `twin-${arm}-${seed}`, arm, seed, D: d, signal: d > 0 ? "livingCells" : null, side: d > 0 ? "high" : null, windowMax: wm, dBySignal: [{ signal: "livingCells", side: "high", D: d }], ...opts.r });
  const r13 = { ...r11, D: opts.d13 ?? d, signal: opts.d13 !== undefined ? "dominantShare" : r11.signal };
  return { o11: judge2(r11, arm, opts.pre ?? {}, null), o13: judge2(r13, arm, opts.pre ?? {}, null) };
}
type Spec = Partial<Record<Arm2, (seed: number, i: number) => number>>;
function scenario(spec: Spec, tweak: (arm: Arm2, i: number) => Parameters<typeof outcome>[3] | undefined = () => undefined) {
  const o11 = [], o13 = [];
  const def: Record<Arm2, (s: number, i: number) => number> = { sham: () => 0, nudge: (_s, i) => 1 + i / 10, nudge2: () => 1, l64: () => 3, l96: () => 5, f: () => 5 };
  for (const arm of ARMS2) {
    for (const [i, seed] of SEEDS2.entries()) {
      const x = outcome(arm, seed, (spec[arm] ?? def[arm])(seed, i), tweak(arm, i));
      o11.push(x.o11);
      o13.push(x.o13);
    }
  }
  return { o11, o13 };
}

describe("summary", () => {
  it("all bars met: hears events; Z*2 is the largest nudge D11, a tie is not a hit, and the doses and first windows are kept", () => {
    const { o11, o13 } = scenario({ nudge2: (_s, i) => (i < 2 ? 3 : 1), f: (_s, i) => (i < 2 ? (i === 0 ? 1.9 : 1.5) : 4) });
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.R).toMatchObject({ called: true, met: true, n: 10, differ: [] });
    expect(s.primary.zStarPair.value).toBe(1.9);
    expect(s.primary.B2.l96).toMatchObject({ called: true, met: true, k: 10 });
    expect(s.primary.B2.f).toMatchObject({ called: true, met: true, k: 8 }); // the F twin at exactly 1.9 is not a hit
    expect(s.primary.B3).toMatchObject({ called: true, met: true, k: 2 });
    expect(s.primary.reading).toBe("hears events (exploratory): the post-hoc rule holds on fresh twins");
    expect(s.primary.v1Reading).toBe("hears events (exploratory)");
    const f0 = s.twins.find((t) => t.id === "twin-f-3901")!;
    expect(f0.hit).toBe(false);
    expect(s.twins.find((t) => t.id === "twin-f-3903")!.firstWindowAboveZ).toBe(S + 100 + 3 * 100);
    expect(s.twins.filter((t) => t.arm === "sham")).toHaveLength(10);
    expect(s.twins.find((t) => t.arm === "sham")!.hit).toBeNull();
    expect(s.twins).toHaveLength(60);
  });
  it("B3 at 3 of 10: its threshold does not hold out, whatever B2 says", () => {
    const { o11, o13 } = scenario({ nudge2: (_s, i) => (i < 3 ? 3 : 1) });
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.primary.B3).toMatchObject({ called: true, met: false, k: 3 });
    expect(s.primary.reading).toBe("its threshold does not hold out");
  });
  it("B2 missed for both arms: the post-hoc rule did not replicate; for one: hears some events", () => {
    const none = scenario({ l96: () => 1.5, f: () => 1.5 });
    expect(summarizeTwins2(none.o11, none.o13, { complete: true }).primary.reading).toBe("the post-hoc rule did not replicate");
    const one = scenario({ f: (_s, i) => (i < 3 ? 1 : 5) });
    const s = summarizeTwins2(one.o11, one.o13, { complete: true });
    expect(s.primary.reading).toBe("hears some events");
    expect(s.primary.armsMet).toEqual(["L96"]);
  });
  it("one void L96 twin: B2 L96 is not called, and so is the reading", () => {
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "l96" && i === 4 ? { pre: { manifest: "bad" } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.primary.B2.l96.called).toBe(false);
    expect(s.primary.B2.f.called).toBe(true);
    expect(s.primary.reading).toBe("not called");
  });
  it("a sham that differs from its base: R missed, nothing is called", () => {
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "sham" && i === 6 ? { r: { firstDiffStep: 200700 } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.R).toMatchObject({ called: true, met: false, differ: [{ seed: 3907, step: 200700 }] });
    expect(s.primary.reading).toBe("not called: a fork is not its base's history");
    expect(s.primary.B2.l96.called).toBe(false);
    expect(s.primary.B3.called).toBe(false);
    expect(s.atZ1.reading).toBe("not called: a fork is not its base's history");
    expect(s.v1Rule13.gated).toMatch(/R missed/);
  });
  it("with R missed, v1's 13-signal criteria are gated too, and no hit is marked from either threshold", () => {
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "sham" && i === 2 ? { pre: { replay: "series differs" } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.R).toMatchObject({ called: true, met: false });
    for (const c of [s.v1Rule13.B2.l96, s.v1Rule13.B2.f, s.v1Rule13.B2_l64, s.v1Rule13.B3]) expect(c).toMatchObject({ called: false, met: null, bound95: null });
    expect(s.v1Rule13.reading).toBe("not called");
    expect(s.atZ1.B2.l96.called).toBe(false);
    for (const t of s.twins) {
      expect(t.hit).toBeNull();
      expect(t.hitZ1).toBeNull();
      expect(t.firstWindowAboveZ).toBeNull();
    }
  });
  it("a criterion at Z1 also needs all 10 nudge twins valid", () => {
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "nudge" && i === 1 ? { pre: { launch: "launch log: exited 1" } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.atZ1.B2.f.called).toBe(false);
    expect(s.atZ1.B2.f.reason).toMatch(/9 of 10 nudge twins/);
    expect(s.atZ1.B3.nudge2.called).toBe(false);
    expect(s.atZ1.reading).toBe("not called");
    expect(s.primary.reading).toBe("not called");
  });
  it("a missing sham: R not called, and nothing is called (incomplete)", () => {
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "sham" && i === 0 ? { pre: { missing: true }, r: { failed: "bundle missing" } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: false });
    expect(s.R.called).toBe(false);
    expect(s.primary.reading).toBe("not called (incomplete)");
  });
  it("a cap stop halfway through nudge2 calls nothing, though L96, F and the nudges all ran (Codex pass 3)", () => {
    const why = "not run: the launch stopped (the cap)";
    const { o11, o13 } = scenario({}, (arm, i) => (arm === "nudge2" && i >= 5 ? { pre: { notRun: why }, r: { failed: why } } : arm === "l64" ? { pre: { notRun: why }, r: { failed: why } } : undefined));
    // Without the stop the B2 criteria would be called (all ten L96, F and nudge twins are valid).
    expect(summarizeTwins2(o11, o13, { complete: false }).primary.B2.l96.called).toBe(true);
    const s = summarizeTwins2(o11, o13, { complete: false, stopped: "the cap: twin-nudge2-3906 would end past the 5 h budget" });
    expect(s.complete).toBe(false);
    expect(twins2Called(s)).toBe(false);
    for (const c of [s.primary.B2.l96, s.primary.B2.f, s.primary.B3, s.primary.B2_l64, s.atZ1.B2.l96, s.atZ1.B2.f, s.atZ1.B3.nudge, s.atZ1.B3.nudge2, s.v1Rule13.B2.l96, s.v1Rule13.B2.f, s.v1Rule13.B3]) {
      expect(c.called).toBe(false);
      expect(c.reason).toMatch(/^the run stopped before it finished \(the cap: /);
    }
    expect(s.primary.B2.l96.k).toBe(10); // the counts stay, reported
    expect(s.primary.reading).toBe("not called (incomplete)");
    expect(s.atZ1.reading).toBe("not called (incomplete)");
    expect(s.v1Rule13.reading).toBe("not called");
    expect(s.twins.every((t) => t.hit === null && t.hitZ1 === null)).toBe(true);
    // R missed still reads as R missed, stop or not.
    const rMissed = scenario({}, (arm, i) => (arm === "sham" && i === 0 ? { r: { firstDiffStep: 200100 } } : undefined));
    expect(summarizeTwins2(rMissed.o11, rMissed.o13, { complete: false, stopped: "void: R cannot be met" }).primary.reading).toBe("not called: a fork is not its base's history");
  });
  it("Z1 counts nudge and nudge2 as held out; it is reported and does not change the primary reading", () => {
    const { o11, o13 } = scenario({ nudge: (_s, i) => (i < 3 ? 2.6 + i / 10 : 1) });
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.primary.zStarPair.value).toBeCloseTo(2.8, 12);
    expect(s.primary.reading).toBe("hears events (exploratory): the post-hoc rule holds on fresh twins");
    expect(s.atZ1.value).toBe(Z1);
    expect(s.atZ1.B3.nudge).toMatchObject({ called: true, met: false, k: 3 });
    expect(s.atZ1.B3.nudge2).toMatchObject({ called: true, met: true, k: 0 });
    expect(s.atZ1.reading).toBe("its threshold does not hold out");
  });
  it("a twin exactly at Z1 is not a hit at Z1 (strict), at B2 and at B3", () => {
    const { o11, o13 } = scenario({ f: (_s, i) => (i < 3 ? Z1 : 5), nudge2: (_s, i) => (i < 3 ? Z1 : 1) });
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.atZ1.B2.f).toMatchObject({ called: true, met: false, k: 7 }); // three at exactly Z1: 7 hits, under the bar of 8
    expect(s.atZ1.B3.nudge2).toMatchObject({ called: true, met: true, k: 0 });
    expect(s.twins.find((t) => t.id === "twin-f-3901")!.hitZ1).toBe(false);
    expect(s.twins.find((t) => t.id === "twin-f-3904")!.hitZ1).toBe(true);
  });
  it("L64 dropped by the scale-down (absent, void with that reason, not missing): the run stays complete and the reading is called", () => {
    const why = "dropped by the scale-down (drop-l64)";
    const { o11, o13 } = scenario({}, (arm) => (arm === "l64" ? { pre: { notRun: why }, r: { failed: why } } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true, dropped: { l64: "the scale-down (drop-l64)" } });
    expect(s.complete).toBe(true);
    expect(s.primary.reading).toBe("hears events (exploratory): the post-hoc rule holds on fresh twins");
    expect(s.primary.B2_l64.called).toBe(false);
    expect(s.primary.B2_l64.reason).toMatch(/^L64 dropped by the pre-stated scale-down \(the scale-down \(drop-l64\)\)/);
    expect(s.atZ1.B2_l64.reason).toMatch(/^L64 dropped/);
    expect(s.v1Rule13.B2_l64.reason).toMatch(/^L64 dropped/);
    const t = s.twins.find((x) => x.id === "twin-l64-3901")!;
    expect(t.valid).toBe(false);
    expect(t.voidReasons).toContain(why);
    expect(twins2Called(s)).toBe(true);
  });
  it("twins2Called: only with R met and some criterion called; the record path follows it", () => {
    const ok = scenario({});
    expect(twins2Called(summarizeTwins2(ok.o11, ok.o13, { complete: true }))).toBe(true);
    const rMissed = scenario({}, (arm, i) => (arm === "sham" && i === 0 ? { r: { firstDiffStep: 200100 } } : undefined));
    expect(twins2Called(summarizeTwins2(rMissed.o11, rMissed.o13, { complete: true }))).toBe(false);
    const noNudges = scenario({}, (arm) => (arm === "nudge" ? { pre: { notRun: "not run: the launch stopped (the cap)" } } : undefined));
    expect(twins2Called(summarizeTwins2(noNudges.o11, noNudges.o13, { complete: false }))).toBe(false);
    expect(defaultRecord2(true)).toBe("experiments/naturalist/bell-v2-twins.json");
    expect(defaultRecord2(false)).toBe("experiments/naturalist/bell-v2-twins.incomplete.json");
  });
  it("v1's 13-signal rule is scored on D13 with Z*13 from the fresh nudges", () => {
    const { o11, o13 } = scenario({}, (arm) => (arm === "nudge" ? { d13: 9 } : undefined));
    const s = summarizeTwins2(o11, o13, { complete: true });
    expect(s.v1Rule13.zStarPair.value).toBe(9);
    expect(s.v1Rule13.B2.l96).toMatchObject({ called: true, met: false, k: 0 });
    expect(s.v1Rule13.reading).toBe("did not meet the exploratory bar");
    expect(s.v1Rule13.gated).toBeNull();
    expect(s.twins.find((t) => t.id === "twin-nudge-3901")!.D13).toBe(9);
  });
});

// ---------------------------------------------------------------------------------------------

describe("projection and scale-down", () => {
  it("full: 1.25 x (10 x 206,000 / 1000 + 60 x (16,000 / 1000 + 30)) s = 1.6736 h", () => {
    const p = { rBase: 1000, rFork: 1000, o: 30 };
    expect(project(p, { bases: 10, forks: 60 })).toBeCloseTo((1.25 * (2060 + 60 * 46)) / 3600, 12);
    expect(scaleDown(p)).toMatchObject({ mode: "full", drop: [] });
    expect(scaleDown(p).hours.full).toBeCloseTo(1.673611, 5);
  });
  it("drop-l64: 5.2361 h with all six arms, 4.8403 h without L64", () => {
    const p = { rBase: 250, rFork: 250, o: 50 };
    const s = scaleDown(p);
    expect(s.hours.full).toBeCloseTo(5.236111, 5);
    expect(s.hours.dropL64).toBeCloseTo(4.840278, 5);
    expect(s).toMatchObject({ mode: "drop-l64", drop: ["l64"] });
  });
  it("stop-at-cap: still over without L64, and no job starts once its projected end would pass the cap", () => {
    const p = { rBase: 100, rFork: 100, o: 60 };
    const s = scaleDown(p);
    expect(s.hours.full).toBeCloseTo(11.736111, 5);
    expect(s.hours.dropL64).toBeCloseTo(10.972222, 5);
    expect(s).toMatchObject({ mode: "stop-at-cap", drop: ["l64"] });
    expect(jobSeconds(p, "fork")).toBeCloseTo(1.25 * 220, 9);
    expect(jobSeconds(p, "base")).toBeCloseTo(1.25 * 2060, 9);
    expect(mayStart(18000 - 275, p, "fork")).toBe(true);
    expect(mayStart(18000 - 274, p, "fork")).toBe(false);
  });
  it("a slower job seen in the main run raises the projection (1.25 x the slowest of its kind); a faster one never lowers it", () => {
    const p = { rBase: 1000, rFork: 1000, o: 30 };
    expect(jobSeconds(p, "fork", null)).toBeCloseTo(1.25 * 46, 9);
    expect(jobSeconds(p, "fork", 10)).toBeCloseTo(1.25 * 46, 9);
    expect(jobSeconds(p, "fork", 80)).toBeCloseTo(100, 9);
    expect(jobSeconds(p, "base", 4000)).toBeCloseTo(5000, 9);
    expect(mayStart(18000 - 100, p, "fork", 5, 80)).toBe(true);
    expect(mayStart(18000 - 99, p, "fork", 5, 80)).toBe(false);
  });
  it("the budget the pilot used counts: the projection adds it", () => {
    const p = { rBase: 250, rFork: 250, o: 50 };
    expect(scaleDown(p, 5, 0).mode).toBe("drop-l64");
    const s = scaleDown(p, 5, 0.2 * 3600);
    expect(s.hours.used).toBeCloseTo(0.2, 12);
    expect(s.hours.dropL64).toBeCloseTo(5.040278, 5);
    expect(s.mode).toBe("stop-at-cap");
  });
});

describe("the launch log: one budget, attempts, the run's end", () => {
  const ev = (launch: string, event: string, elapsed: number, more: Record<string, unknown> = {}): LaunchEvent => ({ event, elapsed, mode: "run", launch, ...more });
  it("the budget is cumulative over the pilot and every launch; a launch killed without a closing event adds a heartbeat", () => {
    expect(budgetUsed([], 600)).toBe(600);
    const log = [ev("a", "start", 600), ev("a", "heartbeat", 4000), ev("a", "interrupted", 4020), ev("b", "start", 4080), ev("b", "heartbeat", 9000)];
    expect(budgetUsed(log, 600)).toBe(9000 + HEARTBEAT_SECONDS);
    // Pilot-mode events in the same file never count twice.
    expect(budgetUsed([{ event: "stop", elapsed: 99_999, mode: "pilot", launch: "p" }], 600)).toBe(600);
    expect(parseLaunchEvents(log.map((e) => JSON.stringify(e)).join("\n") + "\n")).toEqual(log);
    expect(() => parseLaunchEvents("{}\n")).toThrow(/no event/);
  });
  it("a killed launch's allowance is charged once: its successor's clock already holds it", () => {
    // a killed at 1,000; b started at 1,060 (1,000 + the heartbeat) and stopped at 1,070; c must start at 1,070, not 1,130.
    const log = [ev("a", "start", 600), ev("a", "heartbeat", 1000), ev("b", "start", 1060), ev("b", "stop", 1070, { final: false })];
    expect(budgetUsed(log, 600)).toBe(1070);
    expect(budgetUsed([...log, ev("c", "start", 1070), ev("c", "heartbeat", 1200)], 600)).toBe(1200 + HEARTBEAT_SECONDS);
    expect(runLaunches(log).map((l) => [l.launch, l.maxElapsed, l.start?.elapsed, l.close?.event ?? null])).toEqual([["a", 1000, 600, null], ["b", 1070, 1060, "stop"]]);
  });
  it("the pilot's launches share its own cap the same way, and never count in the main run's events", () => {
    const p = (launch: string, event: string, elapsed: number, more: Record<string, unknown> = {}): LaunchEvent => ({ event, elapsed, mode: "pilot", launch, ...more });
    // An interrupted pilot (50 min waiting for another GPU user), then a pilot that ran from where it stood.
    const log = [p("p1", "start", 0), p("p1", "gpu-wait", 3000), p("p1", "interrupted", 3010), p("p2", "start", 3010), p("p2", "stop", 4210)];
    expect(budgetUsed(log, 0, "pilot")).toBe(4210);
    expect(budgetUsed(log.slice(0, 2), 0, "pilot")).toBe(3000 + HEARTBEAT_SECONDS);
    expect(budgetUsed(log, 4210)).toBe(4210);
    expect(runLaunches(log)).toEqual([]);
    expect(runLaunches(log, "pilot").length).toBe(2);
  });
  it("a child that outlived its killed launch is charged through its alarm, with no wall clock (Codex passes 3 to 5)", () => {
    // Attempt-start at 610 with an alarm of 17,480 s (the 5 h cap less 610, plus 90): the orphan is charged to 18,090, the budget spent.
    const log = [ev("a", "start", 600, { at: "2026-10-18T10:00:00.000Z" }), ev("a", "attempt-start", 610, { id: "twin-f-3901", attempt: 1, at: "2026-10-18T10:00:10.000Z", alarmSeconds: 17_480 }), ev("a", "heartbeat", 700)];
    expect(orphanEndElapsed(log, "a", "twin-f-3901", 1)).toBe(18_090);
    expect(budgetUsed(log, 0, "run", 18_090)).toBe(18_090);
    // Pass 5's case (a stalled orphan, the wall clock stepped back 600 s): nothing read from the wall clock, so nothing undercharged.
    expect(budgetUsed(log, 0, "run", orphanEndElapsed(log, "a", "twin-f-3901", 1))).toBeGreaterThanOrEqual(CAP_HOURS * 3600);
    // Another attempt number, another launch, or no alarm logged: null (the launcher stops rather than guess).
    expect(orphanEndElapsed(log, "a", "twin-f-3901", 2)).toBeNull();
    expect(orphanEndElapsed(log, "b", "twin-f-3901", 1)).toBeNull();
    expect(orphanEndElapsed([ev("a", "attempt-start", 610, { id: "base-3901", attempt: 1 })], "a", "base-3901", 1)).toBeNull();
    // No orphan: the heartbeat.
    expect(budgetUsed(log, 0, "run", null)).toBe(700 + HEARTBEAT_SECONDS);
  });
  it("an orphan is matched per attempt: a finished retry after an interrupted attempt is not one (Codex pass 4)", () => {
    const att = (launch: string, id: string, attempt: number, elapsed: number) => ev(launch, "attempt-start", elapsed, { id, attempt, alarmSeconds: 17_000 });
    // A left attempt 1 unfinished; B ran attempt 2, wrote its line, then died before closing; C must charge B a heartbeat, not an alarm.
    const log = [ev("a", "start", 0), att("a", "base-3901", 1, 10), ev("a", "heartbeat", 100), ev("b", "start", 160), att("b", "base-3901", 2, 170), ev("b", "heartbeat", 900)];
    const lines = [{ id: "base-3901", launch: "b", attempt: 2, exit: 0 }];
    expect(unfinishedAttempts(log, lines).get("base-3901")).toBe(1); // per job, A's attempt is still open
    expect(orphanAttempt(log, lines)).toBeNull();
    expect(budgetUsed(log, 0, "run", orphanAttempt(log, lines) ? Date.now() : null)).toBe(900 + HEARTBEAT_SECONDS);
    // B died while attempt 2 ran: that attempt is the orphan. A line without launch and attempt never matches (charged more, not less).
    expect(orphanAttempt(log, [])).toEqual({ launch: "b", id: "base-3901", attempt: 2 });
    expect(orphanAttempt(log, [{ id: "base-3901", exit: 0 }])).toEqual({ launch: "b", id: "base-3901", attempt: 2 });
    expect(orphanAttempt([...log, ev("b", "stop", 950)], [])).toBeNull();
  });
  it("a line killed at the cap is never a clean finish, even when its child exited 0", () => {
    expect(cleanExit({ exit: 0 })).toBe(true);
    expect(cleanExit({ exit: 0, timeout: true })).toBe(false);
    expect(cleanExit({ exit: 143, timeout: true })).toBe(false);
    expect(cleanExit(undefined)).toBe(false);
    const stopped = { droppedWhy: {}, finished: false, stopReason: "the cap" };
    expect(absenceOf("nudge2", { exit: 0, timeout: true }, stopped)).toBe("killed at the cap (moved aside)");
  });
  it("the main run starts from the pilot's whole ledger, which the pilot record must close", () => {
    const p = (launch: string, event: string, elapsed: number, more: Record<string, unknown> = {}): LaunchEvent => ({ event, elapsed, mode: "pilot", launch, ...more });
    const one = [p("p1", "start", 0), p("p1", "stop", 600)];
    expect(pilotLedger(one, "p1", 600)).toEqual({ used: 600, problem: null });
    // Codex pass 3's case: a later pilot (another --record) took the ledger to 1,800 s; the old record no longer closes it.
    const two = [...one, p("p2", "start", 600), p("p2", "stop", 1800)];
    expect(pilotLedger(two, "p1", 600)).toEqual({ used: 1800, problem: "the record is from launch p1, but the last pilot launch in the ledger is p2" });
    expect(pilotLedger(two, "p2", 1800).problem).toBeNull();
    // Killed after writing its record, before its closing stop: accepted, charged the heartbeat.
    expect(pilotLedger([p("p1", "start", 0), p("p1", "heartbeat", 590)], "p1", 600)).toEqual({ used: 650, problem: null });
    expect(pilotLedger([], "p1", 600).problem).toMatch(/no pilot launch/);
  });
  it("lastUnclosed: the killed launch's last attempt-start, with its attempt number", () => {
    const log = [ev("a", "start", 600), ev("a", "attempt-start", 610, { id: "twin-f-3901", attempt: 2 }), ev("a", "heartbeat", 700)];
    expect(lastUnclosed(log)).toEqual({ launch: "a", attemptId: "twin-f-3901", attempt: 2 });
    expect(budgetUsed(log, 0, "run", 650)).toBe(700 + HEARTBEAT_SECONDS); // never less than the heartbeat
    expect(lastUnclosed([...log, ev("a", "error", 701)])).toBeNull();
    expect(lastUnclosed([ev("a", "start", 0)])).toEqual({ launch: "a", attemptId: null, attempt: null });
  });
  it("job ids map back to their experiment, seed and destination", () => {
    expect(jobOfId("base-3904")).toEqual({ experiment: planBases([3904])[0].experiment, seed: 3904, rel: planBases([3904])[0].rel });
    const f = planBigTwins([3905]).find((j) => j.arm === "f")!;
    expect(jobOfId("twin-f-3905")).toEqual({ experiment: f.experiment, seed: 3905, rel: f.rel });
    const n2 = planNudgeTwins([3906], { 3906: { nudge: { x: 1, y: 1 }, nudge2: { x: 9, y: 9 } } })[1];
    expect(jobOfId("twin-nudge2-3906")?.rel).toBe(n2.rel);
    expect(jobOfId("twin-x-3906")).toBeNull();
    expect(jobOfId("base-")).toBeNull();
    expect(relOf(f.experiment, 3905)).toBe(f.rel);
  });
  it("an absent bundle is accounted for per job: a clean exit 0 makes it missing, whatever the run's stop", () => {
    const stopped = { droppedWhy: {}, finished: false, stopReason: "the cap" };
    const done = { droppedWhy: {}, finished: true, stopReason: "finished" };
    const dropped = { droppedWhy: { l64: "the scale-down (drop-l64)" }, finished: true, stopReason: "finished" };
    expect(absenceOf("f", { exit: 0 }, stopped)).toBeNull();
    expect(absenceOf("l64", { exit: 0 }, dropped)).toBeNull();
    expect(absenceOf("f", undefined, stopped)).toBe("not run: the launch stopped (the cap)");
    expect(absenceOf("f", undefined, done)).toBeNull();
    expect(absenceOf("l64", undefined, dropped)).toBe("dropped by the scale-down (drop-l64)");
    expect(absenceOf("l64", { exit: 143, timeout: true }, dropped)).toBe("dropped by the scale-down (drop-l64)");
    expect(absenceOf("f", { exit: 143, timeout: true }, stopped)).toBe("killed at the cap (moved aside)");
    expect(absenceOf("f", { exit: 1 }, done)).toBe("exited 1 on its last attempt (moved aside)");
    expect(absenceOf("base", { exit: 2 }, stopped)).toBe("exited 2 on its last attempt (moved aside)");
  });
  it("attempts count every start, an interrupted one too, but not one the cap killed", () => {
    const log = [ev("a", "attempt-start", 1, { id: "base-3901" }), ev("a", "attempt-start", 2, { id: "base-3902" }), ev("b", "attempt-start", 3, { id: "base-3902" }), ev("b", "attempt-start", 4, { id: "twin-f-3901" })];
    const jobs = [{ id: "base-3901", exit: 0 }, { id: "base-3902", exit: 1 }, { id: "twin-f-3901", exit: 143, timeout: true }];
    const n = attemptsOf(log, jobs);
    expect(n.get("base-3901")).toBe(1);
    expect(n.get("base-3902")).toBe(2);
    expect(n.get("twin-f-3901")).toBe(0);
    expect([...unfinishedAttempts(log, jobs)]).toEqual([["base-3902", 1]]);
  });
  it("the run is over only when its last launch closed with a final stop; drops are read from the run's events", () => {
    expect(launchState([]).over).toBe(false);
    expect(launchState([ev("a", "start", 0), ev("a", "error", 5)]).over).toBe(false);
    expect(launchState([ev("a", "stop", 5, { final: true, reason: "finished" }), ev("b", "start", 6)]).over).toBe(false);
    const st = launchState([ev("a", "dropped", 1, { arm: "l64", why: "the scale-down (drop-l64)" }), ev("a", "stop", 5, { final: true, reason: "finished" })]);
    expect(st).toMatchObject({ over: true, finished: true, dropped: ["l64"], droppedWhy: { l64: "the scale-down (drop-l64)" } });
    const cap = launchState([ev("a", "stop", 5, { final: true, reason: "the cap: twin-f-3904 would end past the 5 h budget" })]);
    expect(cap).toMatchObject({ over: true, finished: false });
    expect(launchState([{ event: "stop", final: true, reason: "pilot done", mode: "pilot", launch: "p" }]).over).toBe(false);
  });
});

describe("replacement", () => {
  it("livingCells 0 at S means replace; 1 (or unreadable) means stay", () => {
    expect(replacementNeeded(0)).toBe(true);
    expect(replacementNeeded(1)).toBe(false);
    expect(replacementNeeded(null)).toBe(false);
    expect(replacementNeeded(undefined)).toBe(false);
  });
  it("a dead base is replaced by the next unused seed, in order; an unrun base leaves the walk pending", async () => {
    const living: Record<number, number | null> = Object.fromEntries([...SEEDS2, ...replacementSeeds()].map((s) => [s, 500]));
    living[3903] = 0;
    living[3911] = 0;
    living[3906] = null;
    const r = await pickSeeds((s) => living[s]);
    expect(r.pending).toBeNull();
    expect(r.seeds).toEqual([3901, 3902, 3912, 3904, 3905, 3906, 3907, 3908, 3909, 3910]);
    expect(r.replacements).toEqual([
      { slot: 2, seed: 3903, livingCellsAtS: 0, replacedBy: 3911 },
      { slot: 2, seed: 3911, livingCellsAtS: 0, replacedBy: 3912 },
    ]);
    const p = await pickSeeds((s) => (s >= 3905 && s <= 3910 ? undefined : living[s]));
    expect(p.pending).toBe(3905);
    expect(p.seeds).toEqual([3901, 3902, 3912, 3904]);
    await expect(pickSeeds(() => 0)).rejects.toThrow(ReplacementsExhausted);
    await expect(pickSeeds(() => 0)).rejects.toThrow(/replacement seeds are used up/);
  });
});

describe("the nudge file", () => {
  it("round-trips; every seed has both centres or is listed as failed", () => {
    const cs = SEEDS2.flatMap((seed) => (["nudge", "nudge2"] as const).map((arm) => ({ seed, arm, target: [128, 128] as const, x: 1, y: 2, d2: 0, B: 3, checkpoint: "c", manifestHash: "h", fileSha256: "s" })));
    const text = nudgeFileText({ seeds: SEEDS2, replacements: [], centres: cs.filter((c) => c.seed !== 3904), failed: [{ seed: 3904, reason: "replay" }] });
    const p = parseNudgeFile2(text);
    expect(p.seeds).toEqual(SEEDS2);
    expect(p.centres[3901]).toEqual({ nudge: { x: 1, y: 2 }, nudge2: { x: 1, y: 2 } });
    expect(p.centres[3904]).toBeUndefined();
    expect(() => parseNudgeFile2(nudgeFileText({ seeds: SEEDS2, replacements: [], centres: cs.filter((c) => c.seed !== 3904), failed: [] }))).toThrow(/3904 has no centres and is not listed as failed/);
    expect(() => parseNudgeFile2(nudgeFileText({ seeds: SEEDS2.slice(1), replacements: [], centres: [], failed: [] }))).toThrow(/9 seeds/);
  });
});

describe("other GPU users", () => {
  it("finds deno GPU tools and a Playwright Chrome, not the bell scorers, wrapper shells, Claude or the Playwright MCP node", () => {
    const ps = [
      " 101 deno run -A --no-lock tools/run.ts --experiment x",
      " 102 /opt/homebrew/bin/deno run -A tests/deno/gpu_golden.ts",
      " 103 deno run -A --no-lock tools/bell1.ts twins --runs /r",
      " 104 /Users/n/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium.app/Contents/MacOS/Chromium --headless --enable-unsafe-webgpu",
      " 105 /Users/n/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium.app/Contents/Frameworks/Chromium Framework.framework/Helpers/Chromium Helper (Renderer).app/Contents/MacOS/Chromium Helper (Renderer) --type=renderer",
      " 106 /Users/n/.local/bin/claude --chrome-native-host",
      " 107 node /Users/n/.npm/_npx/x/node_modules/.bin/playwright-mcp",
      " 108 deno run -A tools/island.ts --coordinator http://x",
      " 109 deno run -A tools/bell2-launch.ts run --root /r",
      " 110 deno run -A tools/scaffold.ts evolve --out /x",
      " 111 /Users/n/.deno/bin/deno run -A /abs/repo/tools/breed.ts --steps 10",
      " 112 /bin/zsh -c eval 'cd /repo && deno run -A tools/run.ts --experiment y'",
      " 113 sh -c nohup deno run -A tools/bell2-launch.ts run --root /r",
      " 114 deno -A tools/horizon.ts twins",
      " 115 deno run -A apps/lab/scripts/social-cards.ts",
      " 116 grep tools/run.ts",
    ].join("\n");
    expect(gpuUsers(ps).map((u) => u.pid)).toEqual([101, 102, 104, 108, 110, 111, 114, 115]);
    expect(gpuUsers(ps, [101]).map((u) => u.pid)).toEqual([102, 104, 108, 110, 111, 114, 115]);
    expect(isDenoProcess("/bin/zsh -c deno run x.ts")).toBe(false);
    expect(denoScript("deno run -A --no-lock tools/run.ts --out /a.ts")).toBe("tools/run.ts");
    // Another launcher is a deno process running bell2-launch.ts (not a dry run, not this one, not a wrapper shell).
    const launchers = [" 201 deno run -A tools/bell2-launch.ts run --root /r", " 202 /bin/zsh -c deno run -A tools/bell2-launch.ts run --root /r", " 203 deno run -A tools/bell2-launch.ts run --root /r --dry-run", " 204 deno run -A tools/bell2-launch.ts pilot --root /p"].join("\n");
    expect(otherLaunchers(launchers, 204)).toEqual([201]);
    expect(otherLaunchers(launchers, 1)).toEqual([201, 204]);
    // A live tools/run.ts for one job, by its experiment and seed.
    const runs = [" 301 deno run --no-lock -A tools/run.ts --experiment bell-v2-twins-f --preset gradient-m3 --seeds 3904 --steps 16000", " 302 deno run --no-lock -A tools/run.ts --experiment bell-v2-twins-f --seeds 3905"].join("\n");
    expect(liveRunOf(runs, { experiment: "bell-v2-twins-f", seed: 3904 })).toEqual([301]);
    expect(liveRunOf(runs, { experiment: "bell-v2-twins-l96", seed: 3904 })).toEqual([]);
  });
  it("GPU_TOOLS is every tools/*.ts that opens a WebGPU device or runs runExperiment (plus calibrate.ts, which the note names)", () => {
    const opens = readdirSync(join(REPO, "tools"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /navigator\.gpu|requestDevice\(|requestAdapter\(|runExperiment\(/.test(readFileSync(join(REPO, "tools", f), "utf8")))
      .map((f) => f.slice(0, -3));
    expect([...GPU_TOOLS].sort()).toEqual([...new Set([...opens, "calibrate"])].sort());
    for (const t of GPU_TOOLS) expect(gpuUsers(` 9 deno run -A tools/${t}.ts`).length).toBe(1);
  });
  it("a GPU tool run from inside tools/ (a bare or ./ script name) counts; the same name in another directory does not", () => {
    const ps = [" 401 deno run -A run.ts --experiment x", " 402 deno run -A ./island.ts", " 403 deno run -A other/run.ts", " 404 deno run -A ../tools/breed.ts", " 405 deno run -A bell1.ts"].join("\n");
    expect(gpuUsers(ps).map((u) => u.pid)).toEqual([401, 402, 404]);
  });
});

describe("lineage rows over (from, to]", () => {
  const src = ["step\tlineage\tcells", "100\ta\t5", "200\ta\t6", "300\ta\t7", "300\tb\t1", "400\ta\t9"];
  it("equal rows in the range pass; a different row, a missing row and a row at or before the fork step fail", async () => {
    expect(await lineageRowsCheck(gen(src), gen(["step\tlineage\tcells", "300\ta\t7", "300\tb\t1", "400\ta\t1"]), 200, 300)).toEqual({ ok: true, compared: 2 });
    expect((await lineageRowsCheck(gen(src), gen(["h", "300\ta\t7", "300\tb\t2"]), 200, 300)).ok).toBe(false);
    expect((await lineageRowsCheck(gen(src), gen(["h", "300\ta\t7"]), 200, 300)).detail).toMatch(/the fork has fewer/);
    expect((await lineageRowsCheck(gen(src), gen(["h", "200\ta\t6", "300\ta\t7"]), 200, 300)).detail).toMatch(/at or before its fork step 200/);
  });
});

describe("constants", () => {
  it("S, C and the windows fit inside the fork", () => {
    expect(S).toBe(200_000);
    expect(C).toBe(190_000);
    expect(C < S).toBe(true);
    expect(S + 5000 + 900).toBeLessThanOrEqual(BASE_STEPS);
    expect(Z1).toBe(2.580695652173913);
  });
});

describe("records carry no ps argv or home paths", () => {
  it("reducedCommand keeps the program and script basename only", () => {
    expect(reducedCommand("deno run -A --no-lock /Users/x/repo/tests/deno/garden_e2e.ts --out /private/tmp/y")).toBe("deno garden_e2e.ts");
    expect(reducedCommand("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --enable-unsafe-webgpu")).not.toMatch(/\/|--/);
    expect(reducedCommand("")).toBe("unknown");
  });
  it("scrubLaunchEvent reduces gpu-wait users and redacts paths outside the root, keeping the root's", () => {
    const root = "/Users/x/out/runs";
    const w = scrubLaunchEvent({ event: "gpu-wait", users: [{ pid: 7, command: "deno run -A /Users/x/repo/tools/run.ts --out /Users/x/out" }] } as LaunchEvent, root);
    expect(w).toEqual({ event: "gpu-wait", users: [{ pid: 7, command: "deno run.ts" }] });
    const m = scrubLaunchEvent({ event: "moved-aside", id: "a", to: `${root}/bell-v2-launch/aside/a`, why: "read /private/tmp/z failed" } as LaunchEvent, root);
    expect(m).toEqual({ event: "moved-aside", id: "a", to: `${root}/bell-v2-launch/aside/a`, why: "read [redacted] failed" });
    expect(scrubLaunchEvent(m, root)).toEqual(m);
    expect(scrubLaunchEvent({ event: "x", why: "/Users/x/out/runsX" } as LaunchEvent, root)).toEqual({ event: "x", why: "[redacted]" });
    // A root path inside free text (an error message) is redacted too; only a field that is one root path is kept.
    expect(scrubLaunchEvent({ event: "error", message: `No space: mkdir '${root}/bell-v2-launch/aside/b'` } as LaunchEvent, root)).toEqual({ event: "error", message: "No space: mkdir '[redacted]'" });
  });
});
