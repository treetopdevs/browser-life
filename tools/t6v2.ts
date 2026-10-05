// Test 6 of the foundations review, with its measures rebuilt (plans/005-rebuild-test6-measures.md): shadow excess
// with K shadows in two turnover modes plus the rank of each run among its shadows, persistent novelty and role
// clusters without lineage IDs, and the zero-flux share. Exploratory; same worlds and the same eligibility rules as
// tools/foundations.ts `t6` (whose output, experiments/foundations/t6.json, stays the record). CPU only, streaming.
//
//   deno run -A tools/t6v2.ts pilot    regression against the cached old shadow values on 2 runs, then timings and a projection
//   deno run -A tools/t6v2.ts all      every run of the four sets -> experiments/foundations/t6-v2.json (resumes from its cache)
//
// Every cache entry records the input it was computed from (the run's manifest ids and hashes plus the sizes of lineages.tsv
// and profiles.tsv); `all` refuses to use an entry whose input differs from the files now under --base. Entries from before
// that record existed ("legacy") are refused too, unless --adopt-legacy-cache says they came from the files under --base now:
// then the current input is stamped into them once. The record is the manifest's ids and hashes plus the byte sizes of the two
// tables, so it catches another run or a truncated or extended table, but not a same-size edit of a table's contents (the
// manifest hashes do not cover the TSVs); bundles are write-once outputs, which is what this relies on.
// Cache and result files are written atomically (unique temp file, sync, rename), so they are never torn. Run one `all` per
// cache file at a time: two concurrent runs on the same cache each keep their own in-memory copy, so the later flush wins and
// the other's new work is lost.
//
// Run directories are identified by their path relative to the repository root ("runs/replay-m4/.../seed-1"), the
// key of both caches; --base says where that "runs" directory really is (default "runs").
//   --base       directory standing in for "runs"                          (default runs)
//   --old-cache  the old test-6 cache, read-only                           (default runs/foundations/results/t6-runs.json)
//   --cache      this tool's cache (written by `all`; `pilot` writes none) (default runs/foundations/results/t6v2-runs.json)
//   --out        the result file                                           (default experiments/foundations/t6-v2.json)
//   --old-t6     the old result, for its eligible block                    (default experiments/foundations/t6.json)
//   --adopt-legacy-cache  `all` only: stamp the current input into cache entries that have none (default: refuse them)
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { binomialLowerBound, mannWhitney } from "@bl/metrics";
import { ACTIVITY_THRESHOLDS } from "../experiments/endpoints.ts";
import { lineageCensuses } from "./lib/bundle.ts";
import { tsv } from "./foundations.ts";
import { type ProfileResult, type ProfileRow, type RunInput, type ShadowResult, profileMeasuresV2, quantileSorted, rankUniformity, rng, runInputDifferences, shadowExcessStream, tieBrokenRanks } from "./lib/measures6.ts";

const a = parseArgs(Deno.args, {
  string: ["base", "old-cache", "cache", "out", "old-t6"],
  boolean: ["adopt-legacy-cache"],
  default: {
    base: "runs",
    "old-cache": "runs/foundations/results/t6-runs.json",
    cache: "runs/foundations/results/t6v2-runs.json",
    out: "experiments/foundations/t6-v2.json",
    "old-t6": "experiments/foundations/t6.json",
  },
});
const cmd = String(a._[0] ?? "");

const MEASURES6_VERSION = 2;
const SHADOW_SEED = 4_500_001; // same base as test 6
/** Shadows per run; fixed before any flag was computed (docs/plan.md, "Test 6 measures rebuilt"). 0 = not yet fixed. */
const K: number = 99;

// ---------------------------------------------------------------------------------------------
// Runs.

/** Where a run directory identifier ("runs/...") really lives. */
const disk = (dir: string) => {
  if (!dir.startsWith("runs/")) throw new Error(`run directory ${dir} does not start with runs/`);
  return `${a.base}${dir.slice("runs".length)}`;
};
interface RunRef { dir: string; seed: number; steps: number; preset: string }

/** Finished runs (manifest with a summary) directly under `root`, ordered by seed, as tools/foundations.ts runDirs. */
async function runDirs(root: string, preset: string): Promise<RunRef[]> {
  const out: RunRef[] = [];
  for await (const e of Deno.readDir(disk(root))) {
    const d = `${root}/${e.name}`;
    try {
      const m = JSON.parse(await Deno.readTextFile(`${disk(d)}/manifest.json`));
      if (m.summary) out.push({ dir: d, seed: m.spec.seed, steps: m.summary.steps, preset });
    } catch { /* not a finished run */ }
  }
  return out.sort((x, y) => x.seed - y.seed);
}
/** The four run sets of test 6, with their expected sizes. */
const SETS: { name: "treatment" | "noMutation" | "soloNoMutation" | "neutral"; expected: number; roots: [string, string][] }[] = [
  { name: "treatment", expected: 10, roots: [["runs/replay-m4/gradient-m3/treatment", "gradient-m3"]] },
  { name: "noMutation", expected: 5, roots: [["runs/replay-m4/gradient-m3/no-mutation", "gradient-m3"]] },
  { name: "soloNoMutation", expected: 36, roots: [["runs/solo/gradient-m3/no-mutation", "gradient-m3"]] },
  {
    name: "neutral",
    expected: 70,
    roots: [
      ["runs/replay-calib/gradient-m3/neutral", "gradient-m3"],
      ["runs/replay-calib/spots-m3/neutral", "spots-m3"],
      ["runs/replay-m4/gradient-m3/neutral", "gradient-m3"],
      ["runs/replay-m4/spots-m3/neutral", "spots-m3"],
    ],
  },
];
async function listSets(): Promise<Record<string, RunRef[]>> {
  const out: Record<string, RunRef[]> = {};
  for (const s of SETS) {
    out[s.name] = [];
    for (const [root, preset] of s.roots) out[s.name].push(...(await runDirs(root, preset)));
    if (out[s.name].length !== s.expected) throw new Error(`STOP: run set ${s.name} has ${out[s.name].length} runs, expected ${s.expected}`);
  }
  return out;
}

const threshold = (preset: string) => ACTIVITY_THRESHOLDS[preset].value!;
const shadow = (ref: RunRef, k: number, mode: "full" | "observed") => shadowExcessStream(lineageCensuses(disk(ref.dir)), threshold(ref.preset), k, SHADOW_SEED, mode);
async function* profileRows(dir: string): AsyncGenerator<ProfileRow> {
  for await (const r of tsv(`${dir}/profiles.tsv`)) yield { step: +r.step, lineage: r.lineage, cells: +r.cells, photo: +r.photo, grow: +r.grow, decomp: +r.decomp, resp: +r.resp, role: r.role, mu: +r.mu, sigma: +r.sigma };
}
const profile = (ref: RunRef) => profileMeasuresV2(profileRows(disk(ref.dir)), ref.steps);
const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};
async function sync(path: string) {
  const f = await Deno.open(path, { read: true });
  try {
    await f.syncData();
  } finally {
    f.close();
  }
}
// Replaced whole (write, sync, rename), as tools/bootstrap.ts does for its checkpoints, so an interrupted run leaves
// either the old file or the new one, never a torn one. Each write has its own temp file in the same directory (pid and a
// counter in the name, created with createNew), so concurrent writers never share one; on a failure before the rename the
// temp file is removed, unless it was another file that blocked its creation.
let writes = 0;
async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${Deno.pid}.${++writes}.tmp`;
  let wrote = false;
  try {
    await Deno.writeTextFile(tmp, text, { createNew: true });
    wrote = true;
    await sync(tmp);
    await Deno.rename(tmp, path);
  } catch (e) {
    if (wrote || !(e instanceof Deno.errors.AlreadyExists)) await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}
/** Size in bytes of a file, null when it does not exist. */
async function sizeOrNull(path: string): Promise<number | null> {
  try {
    return (await Deno.stat(path)).size;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}
/** What a run's cached values depend on, read from its manifest and the sizes of its two tables (no table reads). */
async function runInput(ref: RunRef): Promise<RunInput> {
  const dir = disk(ref.dir);
  const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  return {
    runId: m.runId ?? null,
    initHash: m.initHash ?? null,
    finalHash: m.summary?.finalHash ?? null,
    steps: m.summary?.steps ?? null,
    metricsVersion: m.metricsVersion ?? null,
    lineagesBytes: await sizeOrNull(`${dir}/lineages.tsv`),
    profilesBytes: await sizeOrNull(`${dir}/profiles.tsv`),
  };
}
const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const v = await f();
  return [v, (performance.now() - t0) / 1000];
};
const mb = (n: number) => `${(n / 1e6).toFixed(0)}MB`;
const hms = (s: number) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
const load = () => Deno.loadavg().map((x) => x.toFixed(2)).join(" ");

// ---------------------------------------------------------------------------------------------
// Pilot.

async function pilot() {
  const regression = ["runs/replay-calib/gradient-m3/neutral/seed-1001", "runs/replay-m4/gradient-m3/treatment/seed-1"];
  const old: Record<string, any> = JSON.parse(await Deno.readTextFile(a["old-cache"]));
  const refOf = async (dir: string): Promise<RunRef> => {
    const m = JSON.parse(await Deno.readTextFile(`${disk(dir)}/manifest.json`));
    return { dir, seed: m.spec.seed, steps: m.summary.steps, preset: m.spec.presetId };
  };
  // Shadow regressions fail the pilot; profile differences (novelty and rolesPresent against the old cache) are informational.
  const shadowDiffs: string[] = [], profileDiffs: string[] = [];
  console.log(`pilot: load average ${load()} (1 5 15 min)`);
  console.log("regression of the full-mode shadow at K = 20 against the old cache (same seed, same algorithm):");
  for (const dir of regression) {
    const ref = await refOf(dir);
    const o = old[dir];
    if (!o) {
      shadowDiffs.push(`${dir}: no entry in ${a["old-cache"]}`);
      continue;
    }
    const [s, secs] = await timed(() => shadow(ref, 20, "full"));
    for (const f of ["real", "shadowMedian", "shadowMax", "excess", "flagged"] as const) if (s[f] !== o[f]) shadowDiffs.push(`${dir}: ${f} new ${s[f]} old ${o[f]}`);
    console.log(`  ${dir}: real ${s.real} median ${s.shadowMedian} max ${s.shadowMax} excess ${s.excess} flagged ${s.flagged} rank ${s.rank}/20 (${secs.toFixed(1)}s)   old: ${o.real} ${o.shadowMedian} ${o.shadowMax} ${o.excess} ${o.flagged}`);
    const [p, psecs] = await timed(() => profile(ref));
    // novelty and rolesPresent are unchanged definitions: they should agree with the old cache too (informational).
    const same = p.novelty === o.novelty && p.rolesPresent === o.rolesPresent;
    console.log(`    profile (${psecs.toFixed(1)}s): novelty ${p.novelty} (old ${o.novelty}), rolesPresent ${p.rolesPresent} (old ${o.rolesPresent}) ${same ? "same" : "DIFFERENT"}; persistentNovelty old ${o.persistentNovelty} -> v2 ${p.persistentNoveltyV2}; roleClusters old ${o.roleClusters} -> v2 ${p.roleClustersV2}; zeroFluxShare ${p.zeroFluxShare.toFixed(3)}`);
    if (!same) profileDiffs.push(`${dir}: profile novelty/rolesPresent differ from the old cache`);
  }
  console.log(shadowDiffs.length ? `regression: DIFFERENT\n  ${shadowDiffs.join("\n  ")}` : "regression: OK");
  if (profileDiffs.length) console.log(`profile differences (informational, the pilot goes on):\n  ${profileDiffs.join("\n  ")}`);
  // A changed shadow value means the stream or the sampler no longer reproduces the old numbers: stop before any timing work.
  if (shadowDiffs.length) throw new Error(`STOP: shadow regression DIFFERENT (${shadowDiffs.length}): ${shadowDiffs.join("; ")}`);

  // Timings, one run from each size class, at K = 1 (parsing and the real run's bookkeeping) and K = 199; the cost of the
  // shadows is linear in K, and everything scales by lineages.tsv bytes (cost is per row).
  const sets = await listSets();
  const bytes = async (r: RunRef) => (await Deno.stat(`${disk(r.dir)}/lineages.tsv`)).size;
  const spots = sets.neutral.find((r) => r.preset === "spots-m3" && r.dir.includes("replay-m4"))!;
  const timing: [string, RunRef][] = [["gradient neutral", await refOf(regression[0])], ["gradient treatment", await refOf(regression[1])], ["spots neutral", spots]];
  const rate: Record<string, Record<"full" | "observed", { k1: number; k199: number }>> = {};
  console.log(`timings (load average ${load()}):`);
  for (const [cls, ref] of timing) {
    const b = await bytes(ref);
    rate[cls] = { full: { k1: 0, k199: 0 }, observed: { k1: 0, k199: 0 } };
    for (const mode of ["full", "observed"] as const) {
      const [, s1] = await timed(() => shadow(ref, 1, mode));
      const [s, secs] = await timed(() => shadow(ref, 199, mode));
      rate[cls][mode] = { k1: s1 / b, k199: secs / b };
      console.log(`  ${cls} ${ref.dir} (${mb(b)}) ${mode}: K=1 ${s1.toFixed(0)}s, K=199 ${secs.toFixed(0)}s (${(secs / (b / 1e6)).toFixed(2)} s/MB); K=199: real ${s.real} median ${s.shadowMedian} max ${s.shadowMax} rank ${s.rank}/199`);
    }
  }
  // Project: treatment and no-mutation runs at the treatment rate, spots at the spots rate, the other gradient/solo runs at the neutral-gradient rate.
  const classOf = (name: string, r: RunRef) => (name === "treatment" || name === "noMutation" ? "gradient treatment" : r.preset === "spots-m3" ? "spots neutral" : "gradient neutral");
  const projected = async (K: number) => {
    const total: Record<"full" | "observed", number> = { full: 0, observed: 0 };
    let n = 0, totalBytes = 0;
    for (const [name, runs] of Object.entries(sets))
      for (const r of runs) {
        const b = await bytes(r);
        totalBytes += b;
        n++;
        for (const mode of ["full", "observed"] as const) {
          const t = rate[classOf(name, r)][mode];
          total[mode] += (t.k1 + ((t.k199 - t.k1) * (K - 1)) / 198) * b;
        }
      }
    return { ...total, all: total.full + total.observed, n, totalBytes };
  };
  const p199 = await projected(199), p99 = await projected(99);
  for (const [K, p] of [[199, p199], [99, p99]] as const)
    console.log(`projection at K = ${K} for ${p.n} runs (${mb(p.totalBytes)} of lineages.tsv): full ${hms(p.full)}, observed ${hms(p.observed)}, both modes ${hms(p.all)} (${(p.all / 3600).toFixed(2)} h) at load average ${load()}; profile measures are negligible beside this`);
  console.log(`plan rule: K = 199 if the projection is at most 8 h, else K = 99 (STOP if that is still over 8 h) -> ${p199.all <= 8 * 3600 ? "K = 199" : p99.all <= 8 * 3600 ? "K = 99" : "STOP: K = 99 projects over 8 h"}`);
}

// ---------------------------------------------------------------------------------------------
// The full computation.

/** `input` is absent only on legacy entries (computed before inputs were recorded); `all` stamps or refuses those. */
interface Entry { preset: string; k: number; input?: RunInput; shadowFull?: ShadowResult; shadowObserved?: ShadowResult; profile?: ProfileResult; seconds: Record<string, number> }

const binomialUpperBound = (k: number, n: number) => 1 - binomialLowerBound(n - k, n);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => quantileSorted(xs.slice().sort((p, q) => p - q), 0.5);

async function all() {
  if (!K) throw new Error("K is not fixed yet (step 5 of the plan fixes it in this file before any flag is computed)");
  if ((K + 1) % 10 !== 0) throw new Error(`K + 1 = ${K + 1} must be a multiple of 10 for the 10-bin rank test`);
  const sets = await listSets();
  const cacheFile = a.cache;
  const cache: Record<string, Entry> = (await exists(cacheFile)) ? JSON.parse(await Deno.readTextFile(cacheFile)) : {};
  const flush = () => writeAtomic(cacheFile, JSON.stringify(cache));
  const total = Object.values(sets).reduce((s, r) => s + r.length, 0);
  const cacheKey = (ref: RunRef) => `${ref.dir}|v${MEASURES6_VERSION}|k${K}`;

  // Before anything is computed or reused: every cached entry must have been computed from the files now under --base.
  const inputs = new Map<string, RunInput>();
  for (const runs of Object.values(sets)) for (const ref of runs) inputs.set(cacheKey(ref), await runInput(ref));
  for (const [key, now] of inputs) {
    const cached = cache[key]?.input;
    if (!cached) continue;
    const diffs = runInputDifferences(cached, now);
    if (diffs.length) throw new Error(`STOP: cache entry ${key} was computed from different inputs (${diffs.join("; ")}); use another --cache`);
  }
  const legacy = [...inputs.keys()].filter((key) => cache[key] && !cache[key].input);
  if (legacy.length) {
    if (!a["adopt-legacy-cache"])
      throw new Error(`STOP: ${legacy.length} entries of ${cacheFile} have no input record (computed before inputs were checked), so they cannot be checked against the files under ${a.base}; if they were computed from those files, rerun with --adopt-legacy-cache, otherwise use another --cache`);
    for (const key of legacy) cache[key].input = inputs.get(key)!;
    await flush();
    console.log(`adopted ${legacy.length} legacy cache entries: stamped the current input of ${a.base} into them`);
  }

  const t00 = performance.now();
  let done = 0;
  for (const [name, runs] of Object.entries(sets))
    for (const ref of runs) {
      done++;
      const key = cacheKey(ref);
      const e = (cache[key] ??= { preset: ref.preset, k: K, input: inputs.get(key)!, seconds: {} });
      const part: string[] = [];
      for (const mode of ["full", "observed"] as const) {
        const field = mode === "full" ? "shadowFull" : "shadowObserved";
        if (e[field]) continue;
        const [s, secs] = await timed(() => shadow(ref, K, mode));
        e[field] = s;
        e.seconds[mode] = secs;
        part.push(`${mode} ${secs.toFixed(0)}s`);
        await flush();
      }
      if (!e.profile && (await exists(`${disk(ref.dir)}/profiles.tsv`))) {
        const [p, secs] = await timed(() => profile(ref));
        e.profile = p;
        e.seconds.profile = secs;
        part.push(`profile ${secs.toFixed(0)}s`);
        await flush();
      }
      console.log(`[${done}/${total}] ${name} ${ref.dir}: ${part.join(", ") || "cached"}; rss ${mb(Deno.memoryUsage().rss)}, load ${Deno.loadavg()[0].toFixed(1)}, elapsed ${hms((performance.now() - t00) / 1000)}`);
    }

  // Per-run records, flat as in tools/foundations.ts t6.
  const rec = (ref: RunRef) => {
    const e = cache[cacheKey(ref)];
    const f = e.shadowFull!, o = e.shadowObserved!, p = e.profile;
    return {
      seed: ref.seed, preset: ref.preset, dir: ref.dir,
      real: f.real,
      shadowMedianFull: f.shadowMedian, shadowMaxFull: f.shadowMax, excessFull: f.excess, flaggedFull: f.flagged, rankFull: f.rank,
      shadowMedianObserved: o.shadowMedian, shadowMaxObserved: o.shadowMax, excessObserved: o.excess, flaggedObserved: o.flagged, rankObserved: o.rank,
      // Shadows exactly equal to the real value; undefined (so absent from the JSON) for cache entries that predate the field.
      tiesFull: f.ties, tiesObserved: o.ties,
      ...(p ?? {}),
    } as Record<string, any>;
  };
  const T = sets.treatment.map(rec), NM = sets.noMutation.map(rec), soloNM = sets.soloNoMutation.map(rec), neutral = sets.neutral.map(rec);

  const effect = (x: number[], y: number[]) => (x.length && y.length ? mannWhitney(x, y).effect : null);
  const vals = (xs: Record<string, any>[], k: string) => xs.map((x) => x[k]).filter((v) => v !== null && v !== undefined) as number[];
  const flagRate = (k: string, test: (x: any) => boolean) => {
    const xs = neutral.filter((x) => x[k] !== undefined && x[k] !== null);
    const f = xs.filter(test).length;
    return { flagged: f, of: xs.length, upper95: xs.length ? binomialUpperBound(f, xs.length) : null, passes: xs.length === 70 && binomialUpperBound(f, xs.length) < 0.1 };
  };
  // Between-condition sanity check: 1,000 random 10/10 splits of each preset's pilot, one-sided at alpha 0.05 (as test 6).
  const splits = (k: string) => {
    const r = rng(4_500_101);
    const res: Record<string, number> = {};
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const xs = neutral.filter((x) => x.preset === preset && x.seed >= 1001 && x.seed <= 1020 && x[k] != null).map((x) => x[k] as number);
      if (xs.length !== 20) continue;
      let rej = 0;
      for (let b = 0; b < 1000; b++) {
        const idx = xs.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        const A = idx.slice(0, 10).map((i) => xs[i]), B = idx.slice(10).map((i) => xs[i]);
        if (mannWhitney(A, B).pGreater < 0.05) rej++;
      }
      res[preset] = rej / 1000;
    }
    return res;
  };
  const tieAwareUniformity = (mode: "Full" | "Observed") => {
    const ties = neutral.map((x) => x[`ties${mode}`]);
    if (!ties.every((t) => typeof t === "number")) return { available: false, reason: "cache entries predate the ties field; recompute the shadows to fill it" };
    const seed = mode === "Full" ? 4_500_201 : 4_500_202;
    const items = neutral.map((x) => ({ rank: x[`rank${mode}`] as number, ties: x[`ties${mode}`] as number }));
    return {
      ...rankUniformity(tieBrokenRanks(items, seed), K, 10),
      runsWithTies: items.filter((x) => x.ties > 0).length,
      seed,
      pMethod: "chi-square survival function, regularised incomplete gamma (exact), on ranks with randomised tie-breaking: rank + floor(u * (ties + 1)), u from rng(seed), one draw per run in neutral-set order; under exchangeability the randomised rank is uniform on 0..K for an ideal uniform u (exact in the idealised formula; the 32-bit PRNG grid adds a negligible bias)",
    };
  };
  const shadowBlock = (mode: "Full" | "Observed") => ({
    treatmentVsNoMutation: effect(vals(T, `excess${mode}`), vals(NM, `excess${mode}`)),
    null: { ...flagRate(`flagged${mode}`, (x) => x[`flagged${mode}`]), expectedFlagged: neutral.length / (K + 1) },
    splits: splits(`excess${mode}`),
    // The 70 neutral ranks (runs the real run strictly exceeds, 0..K) in 10 equal bins; exact chi-square survival function, 9 df.
    rankUniformity: { ...rankUniformity(vals(neutral, `rank${mode}`), K, 10), pMethod: "chi-square survival function, regularised incomplete gamma (exact, not Monte Carlo)" },
    // Tie-aware companion: strict ranks pile up at the low end when the real run ties shadows (a static run ties all K), so
    // the strict test above rejects on agreement alone. Each rank is raised by a uniform draw over its ties; under
    // exchangeability the randomised rank is uniform on 0..K for an ideal uniform draw (exact in the idealised formula; the
    // 32-bit PRNG grid adds a negligible bias). Fixed seeds, one draw per run in the order of `neutral`.
    rankUniformityTieAware: tieAwareUniformity(mode),
  });
  const measures = {
    shadowExcessFull: shadowBlock("Full"),
    shadowExcessObserved: shadowBlock("Observed"),
    novelty: {
      treatmentVsNoMutation: effect(vals(T, "novelty"), vals(NM, "novelty")),
      noMutationMedian: median(vals(NM, "novelty")),
      soloNoMutationMedian: median(vals(soloNM, "novelty")),
      null: flagRate("novelty", (x) => x.novelty > 0),
      splits: splits("novelty"),
    },
    persistentNoveltyV2: {
      treatmentVsNoMutation: effect(vals(T, "persistentNoveltyV2"), vals(NM, "persistentNoveltyV2")),
      treatment: vals(T, "persistentNoveltyV2"),
      noMutationMedian: median(vals(NM, "persistentNoveltyV2")),
      soloNoMutationMedian: median(vals(soloNM, "persistentNoveltyV2")),
      null: flagRate("persistentNoveltyV2", (x) => x.persistentNoveltyV2 > 0),
      splits: splits("persistentNoveltyV2"),
    },
    roleClustersV2: {
      noMutationVsSoloNoMutation: effect(vals(NM, "roleClustersV2"), vals(soloNM, "roleClustersV2")),
      treatmentMean: mean(vals(T, "roleClustersV2")),
      splits: splits("roleClustersV2"),
    },
    zeroFluxShare: {
      treatment: mean(vals(T, "zeroFluxShare")),
      noMutation: mean(vals(NM, "zeroFluxShare")),
      soloNoMutation: mean(vals(soloNM, "zeroFluxShare")),
      neutral: mean(vals(neutral, "zeroFluxShare")),
    },
  };
  // Eligibility for a future registration, the rules of test 6 unchanged: each expected pair separated with effect >= 0.8,
  // the per-run null check passed, and the pilot splits rejecting in at most 2 alpha = 0.10.
  const splitsOk = (x: Record<string, number>) => Object.keys(x).length === 2 && Object.values(x).every((v) => v <= 0.1);
  const big = (e: number | null) => e !== null && e >= 0.8;
  const fewerRoles = mean(vals(soloNM, "rolesPresent")) < mean(vals(NM, "rolesPresent"));
  const complete = T.length === 10 && NM.length === 5 && soloNM.length === 36 && neutral.length === 70;
  const eligible = {
    complete,
    specialisationPairCounts: fewerRoles,
    rolesPresent: { noMutation: mean(vals(NM, "rolesPresent")), soloNoMutation: mean(vals(soloNM, "rolesPresent")) },
    shadowExcessFull: big(measures.shadowExcessFull.treatmentVsNoMutation) && measures.shadowExcessFull.null.passes && splitsOk(measures.shadowExcessFull.splits),
    shadowExcessObserved: big(measures.shadowExcessObserved.treatmentVsNoMutation) && measures.shadowExcessObserved.null.passes && splitsOk(measures.shadowExcessObserved.splits),
    novelty: big(measures.novelty.treatmentVsNoMutation) && measures.novelty.null.passes && splitsOk(measures.novelty.splits),
    persistentNoveltyV2: big(measures.persistentNoveltyV2.treatmentVsNoMutation) && measures.persistentNoveltyV2.null.passes && splitsOk(measures.persistentNoveltyV2.splits),
    roleClustersV2: fewerRoles ? big(measures.roleClustersV2.noMutationVsSoloNoMutation) && splitsOk(measures.roleClustersV2.splits) : null,
  };
  const old = JSON.parse(await Deno.readTextFile(a["old-t6"])).eligible;
  const note = `Exploratory rebuild of test 6's measures (plans/005; docs/plan.md "Test 6 measures rebuilt"); eligibility rules as in t6.json, which stays the record. ` +
    `Shadow excess with K = ${K} shadows in two turnover modes (Full = every surviving cell redrawn each census, the original; Observed = a Binomial(x, 1 - tau) share of each component kept, tau the real census-to-census turnover). ` +
    `Persistent novelty v2 and role clusters v2 are keyed on phenotype bins and profiles, not lineage IDs.`;
  await writeAtomic(a.out, JSON.stringify({ note, version: MEASURES6_VERSION, K, eligible, measures, runs: { treatment: T, noMutation: NM, soloNoMutation: soloNM, neutral }, old }, null, 1));
  console.log(`wrote ${a.out}`);
  console.log(JSON.stringify(eligible, null, 1));
  console.log(JSON.stringify(measures, null, 1));
}

if (import.meta.main) {
  if (cmd === "pilot") await pilot();
  else if (cmd === "all") await all();
  else {
    console.error("usage: deno run -A tools/t6v2.ts pilot|all [--base D] [--old-cache F] [--cache F] [--out F] [--old-t6 F] [--adopt-legacy-cache]");
    Deno.exit(2);
  }
}
