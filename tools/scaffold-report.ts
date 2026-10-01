// Statistics over ecological-scaffolding run and assay directories (docs/scaffold-protocol-v1.md); prints JSON.
//
//   deno run -A tools/scaffold-report.ts p1 --runs <dir...>
//   deno run -A tools/scaffold-report.ts calibrate --p1 <p1.json> --assays <dir...>   (P1's R3 calibration)
//   deno run -A tools/scaffold-report.ts p2 --rank <dir...> --scaf <dir...> --rand <dir...> (--regime K PERIOD | --p1 <json>)
//   deno run -A tools/scaffold-report.ts r1 --assays <dir...> [--regime K PERIOD] [--runs <dir...>]    (transmission assays)
//   deno run -A tools/scaffold-report.ts r2 --assays <dir...> [--regime K PERIOD] [--runs <dir...>]    (garden assays)
//   deno run -A tools/scaffold-report.ts r3 --assays <dir...> [--regime K PERIOD] [--runs <dir...>]    (competence assays)
//   deno run -A tools/scaffold-report.ts r4 --assays <dir...> | --in <json...>
//   deno run -A tools/scaffold-report.ts decide --in <json...>    (the outputs of the stages above)
//   deno run -A tools/scaffold-report.ts tau --assays <dir...> [--regime K PERIOD]    (Amendment 2: the tau calibration)
//   deno run -A tools/scaffold-report.ts r1prime --assays <dir...> --tau <tau.json> [--regime K PERIOD] [--replay <replay-check.json>]    (Amendment 2: R1')
//   deno run -A tools/scaffold-report.ts r1dprime --assays <dir...> [--regime K PERIOD] [--runs <dir...>]    (docs/scaffold-heredity-replication-v1.md: R1'')
//   deno run -A tools/scaffold-report.ts r3rep --assays <dir...> [--runs <dir...>] [--v1 <r3.json>]    (docs/scaffold-r3-replication-v1.md: the R3 replication)
//
// A flag takes every argument up to the next flag. A directory that is not itself a run (meta.json) or an
// assay (assay.json) is searched for them up to four levels down. Every stage reports the truncation rule
// (a history with more than 1% truncated recipient rows is flagged; the verdict is repeated without the
// flagged ones, judged over the histories that remain, and reported as sensitive if it changes), beside a verdict that uses every history.
// Run directories are the ones tools/scaffold.ts writes (meta.json, ponds.tsv, lineages.tsv, done.json); assay
// directories are the ones tools/scaffold-assays.ts writes (assay.json, assay.tsv). ponds.tsv and lineages.tsv
// are streamed. A run with no done.json, or one that stopped short of its cycles without ending or violating
// conservation, is unfinished: it is left out and listed under `unfinished`, so it neither passes nor fails
// (only done.json's conservationOk = false fails P1's criterion (d)). An assay directory that is not 64 ponds x 2
// replicates, is outside the regime (--regime; without it every set must share one), has seeds that do not
// decode to its labels (smoke sets), is rejected and listed under `rejected`; two sets with one label throw.
// p2 pools only the protocol's runs at the frozen regime (--regime, or the `chosen` of a calibrate or p1 output
// given as --p1): the ranking runs (seeds 4,805,001 + s, arm cont, founders, mutation off, side 8, 1 cycle, the
// regime's period) and the scaf and rand selection runs (seeds 4,805,101 + 10 arm + s, founders, mutation off, side 8,
// the regime's k and period, 20 cycles, scored at boundary 20); any other run is listed under `skipped` with its
// reasons, and two runs with one seed throw. --runs on r1, r2 and r3 names the evolution histories (main-run
// directories, seeds 4,810,001 + 100 arm + i): a history with more than 1% truncated recipient rows is left out
// of the truncation sensitivity, whole (both times, every variant; for r3 the whole comparison i, quenched control
// included), beside decisions that use every history; r1 also reports the in-run donor-family repeatability of
// every cycle with a next boundary under `descriptive.donorRepeatability`, which no verdict reads. The sensitivity
// needs every (arm, history) of the readout loaded: otherwise (no --runs, or a history missing, rejected or
// unfinished) it is pending, with `truncation.evolutionKnown` false, `without` and `sensitive` null and the gaps
// listed under `truncation.evolutionMissing`.
// Each stage's output carries `stage`
// and `verdict` (true, false, or null while the data are incomplete), which `decide` reads. `p1` is a regime
// choice; `calibrate` walks its passing regimes through the R3 calibration and `decide` takes p1's verdict
// from it (a chosen regime that has not been calibrated leaves p1 pending). The two calibrations of a regime
// (ancestor and quenched, both seeded 4,802,011 + s) are paired by regime and must hold the same fragments; a
// quenched set seeded separately (4,802,021 + s) is rejected as not a matched control, and an unpaired regime is undecided.
//
// Amendment 2 (docs/scaffold-protocol-v1.md; post hoc and exploratory) has two stages of its own, over assay directories
// that scaffold-assays wrote with --traits (assay.json, assay.tsv and traits.tsv, which is streamed). r1, r2, r3 and
// calibrate skip these directories (counted under `skipped`). `tau` reads the tau calibration (competence --tau-calibration,
// 128 ancestor fragments, seeds 4,849,001 + s) and prints tau, the first census step at which the median trait is at
// least 0.25 ref (the set's own ref; the whole period if none), with the median curve; its verdict is null. In strict mode
// the set must be exactly Amendment 2's calibration (ref 103,058, k 8, period 10,000, side 8, 2 replicates, seeds
// 4,849,001 + s, an ancestor source path ending in calib/source/ckpt/b1-pre.blck.gz, labels.tauCalibration) and the output
// records that provenance with `validated: true`; --allow-any-seed (smoke runs) waives it and prints `validated: false`.
// `r1prime` takes that output (--tau) and the transmission sets labelled r1prime (replicate seed 4,845,001 + 250 h + 100 t' +
// s, h = 6 arm + i, t' = 0, 1, 2 for boundary 34, 67, 100): R1's statistic (OLS residuals on log1p retMass and log1p retE
// over all fragments, ICC(1) by donor, 1,000 permutations on the stream s = 8) on each fragment's trait at tau, with the end
// trait, the between-donor variances and the saturation share beside it. It refuses a tau.json that is not validated strict
// calibration output (unless --allow-any-seed). Its verdict is true or false by the rule at t' = 0 (at least 4 of 6 scaf
// histories with ICC > 0 and p < 0.05), or "uninformative" when fewer than 4 scaf histories are valid at t' = 0.
// Validity is availability, evaluated first: a history-time is unavailable, and counts as not demonstrated, when its set
// is missing, rejected or unreadable (a missing or malformed table is reported under `rejected`, not thrown), or, at
// t' = 0 and 1 (replayed states), unless --replay gives the evidence. --replay is required for those boundaries; without it
// every t' = 0 and 1 history is unavailable. The file is { "mechanismCheck": { "passed": true, "scaf-i0": { "replay": H,
// "saved": H }, "rand-i0": {...} }, "valid": ["scaf-i0-t0", ...], "failed": [{ "id": "scaf-i3-t1", "why": "..." }] }: a
// replayed history-time is valid only if mechanismCheck.passed is true (and no replay/saved pair differs) and `valid` lists
// it, and `failed` always wins; t' = 2 (the original b100-pre) needs no replay evidence. Every assay.tsv and every census
// step of traits.tsv must fill the (replicate, pond) grid, 2 x 64, exactly once. A set that is not 64 ponds x 2 replicates, is
// outside --regime, has seeds that do not match its labels, or has no trait at tau is rejected and listed; two sets for one
// history-time are both rejected. --allow-any-seed waives the side, replicate, row, regime and seed checks of both stages
// (smoke runs; the grid is then the one assay.json declares).
//
// R1'' (docs/scaffold-heredity-replication-v1.md) has its own stage over transmission sets that scaffold-assays wrote with
// --r1dprime --traits (labels.r1dprime, h = 0-17: 0-11 the fresh histories at boundary 34, h = 6 arm + i; 12-13 the positive-control
// worlds, 14-17 the negative-control worlds; replicate seeds 4,812,001 + 250 h + s). r1, r2, r3 and calibrate skip these directories
// (counted under `skipped`), and the other stages never read them. `r1dprime` takes each set's complete traits.tsv (2 x 64 at every census
// step 100..10,000, streamed) and scores each fragment by log T, T the first census step at which its trait reaches m* = 25,764.5
// (0.25 ref) or 10,100 if it never does; R1's statistic (OLS residuals on log1p retMass and log1p retE over all 128 fragments, ICC(1)
// by donor, 1,000 permutations on the stream r1dPrimeSeed(h, 8)) is applied to it, except that degenerate scores (every T equal, or OLS
// residuals at roundoff level) are not tested: ICC 0, p 1, not demonstrated, `degenerate` says why. The verdict follows the protocol's order: 1. the
// controls (both positive worlds ICC > 0 with p < 0.05; at most 1 of the 4 negative worlds with p < 0.05, all four tested), else
// "uninformative"; 2. availability (a set that is missing, rejected, unreadable or fails its analysis is unavailable and not
// demonstrated; --runs names the evolution histories (seeds 4,811,001 + 100 arm + i, 34 cycles), and one whose done.json says it ended
// before boundary 34, or with fewer than 2 eligible donors, is a valid biological outcome that is not demonstrated; fewer than 4 valid
// scaf histories is "uninformative"); 3. at least 4 of 6 scaf histories with ICC > 0 and p < 0.05. rand is reported with the same statistic.
// The endpoint fractions (T = 100, T = 10,100), the end trait and the trait at tau = 4,100, the between-donor variance component and the
// extinction counts are descriptive. In strict mode each set must be the protocol's (k 8, period 10,000, side 8, 2 replicates, census
// every 100, seeds r1dPrimeSeed, a recorded source provenance that is the labelled world at its pre-cycle checkpoint (path ending
// ckpt/b34-pre.blck.gz or ckpt/b1-pre.blck.gz, and a recorded phase check that says it is not a post-cycle state) and its protocol hash);
// --allow-any-seed waives those checks (smoke runs).
//
// The R3 replication (docs/scaffold-r3-replication-v1.md) has its own stage over the competence sets that scaffold-assays wrote with
// --r3rep (labels.r3rep: arm, history, timing, h = 6 arm + i or 18 for the ancestor; one directory per source, timing and variant, 62 in
// all). Every other stage skips these directories (counted under `skipped`), and `r3rep` reads nothing else (listed under `skipped` with
// why). Screening collects every problem of a set and rejects it with its reasons, never stopping the stage: labels consistent with h; the
// variant's recorded quench and swap (Ga-on-Fe's words M3_FOUNDERS[2]'s, Ge-on-Fa's its donor's recorded dominant genome, which a set with
// rows must have); in strict mode the regime (k 8, period 10,000, ref 103,058, side 8, 2 replicates, census 100), seeds r3RepSeed(h', t, s)
// (Ge-on-Fa's h' = 18), protocolSha256R3rep equal to the document's pinned SHA-256 (R3REP_SHA256 in tools/lib/pond-assay.ts, as committed
// before any run; protocol v1's in the runs' meta.json likewise; the documents as they are now, which dated amendments change, are only
// reported, under `protocolNow`), and a recorded provenance that is the protocol's for the labels and variant (timing (a): the run
// directory's b100-pre, or an ended history's terminal b<e>-pre, with its meta.json and done.json; timing (b): the continuation and its
// sidecar; Ge-on-Fa's donor and its dominant genome); assay.tsv filling the 2 x 64 (replicate, pond) grid exactly once with the variant's
// rows. Every checkpoint the provenance names that the report can reach (paths resolve from where it runs) is
// reloaded and must still hash, and have the seed, mutation rate, step and grid, the assay recorded, and a donor the recorded dominant
// genome; one it cannot reach is listed as unverifiable, and the set stands. A Ge-on-Fa set with no dominant genome is a valid
// biological record (no rows) only for swap-ea, and only if its donor, when reachable, indeed has none. Two sets for one (arm, history,
// timing, variant) are both rejected. The outcome follows the protocol's rule in order: 1. any available quenched control above 0.05 is
// "does not replicate" (unreliable), whatever else is missing, and otherwise any of the 12 unavailable is "uninformative"; 2. both ancestor
// sets, else "uninformative"; 3. a history is available when all 10 of its sets are (the biological record counts), and fewer than 4 is
// "uninformative"; 4. v1's r3Evaluate over the 6 comparisons on the available histories (an unavailable one fails both criteria; the
// biological record fails the swap criterion): "replicates" if decisive, else "does not replicate" with the failed criteria. Every
// competence, advantage and swap margin (in fragments of 128), each replicate alone, the retained B+P and E of every source and the
// truncated rows are descriptive; --runs (the history run directories, runs/scaffold/r3rep/main/<arm>/i<i>, 100 cycles; ponds.tsv streamed)
// adds each history's mean pond trait per boundary and its extinct ponds at boundary 100, and --v1 (v1's r3 readout) a side-by-side.
// --allow-any-seed waives the regime, seed, hash and provenance checks (smoke runs), not the reloading.
import {
  DECISION_TABLE,
  NO_REPLAY_CHECK,
  P2_CYCLES,
  P2_RANK_SEEDS,
  P2_SEEDS,
  R1_EXPECTED,
  R2_EXPECTED,
  R3_EXPECTED,
  assayLabels,
  assayRow,
  assaySensitivity,
  decide,
  founderRank,
  gridOfJson,
  highShareCounts,
  mainRunOf,
  p1Calibrate,
  p1Choose,
  p1Regimes,
  p1Row,
  p1RunOf,
  p1Sensitivity,
  p2Evaluate,
  p2Replicate,
  p2RunProblems,
  p2Sensitivity,
  parseReplayCheck,
  r1Evaluate,
  r1PrimeEvaluate,
  r1PrimeKeyOf,
  r1PrimeScreen,
  r1Verdict,
  r1dPrimeEvaluate,
  r1dPrimeHOf,
  r1dPrimeRunOf,
  r1dPrimeScreen,
  r2Evaluate,
  r3RepEvaluate,
  r3RepRecordedCheckpoints,
  r3RepRunOf,
  r3RepRunsSummary,
  r3RepScreen,
  r3RepSetIdOfJson,
  r3RepSideBySide,
  r3RepTrajectory,
  r2Verdict,
  r3Evaluate,
  r3Verdict,
  r4RowsOf,
  r4Table,
  readTraits,
  readTsv,
  runStatus,
  summariseHistory,
  tauJsonProblems,
  tauRule,
  tauScreen,
  validateAssayDirs,
  truncationOf,
  type AssayDir,
  type AssayRegime,
  type AssaySet,
  type DecisionInputs,
  type DoneJson,
  type DonorRepeatability,
  type HistoryTruncation,
  type P1Row,
  type P1Run,
  type P2Arm,
  type P2Role,
  type R1PrimeKey,
  type R1dPrimeRun,
  type R3RepReload,
  type R3RepRun,
  type R3RepSetDir,
  type R4Row,
  type TraitSetDir,
} from "./lib/scaffold-stats.ts";
import { R3REP_PROTOCOLS, R3REP_SHA256, r3RepCheckpointOf, r3RepDominantRecord, r3RepProtocolProblems } from "./lib/pond-assay.ts";
import { loadCheckpoint } from "./lib/pond-gpu.ts";
import { dominantGenome } from "./lib/ponds.ts";

const STAGES = ["p1", "p2", "r1", "r2", "r3"] as const;

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: scaffold-report.ts p1 --runs <dir...> | calibrate --p1 <json> --assays <dir...> | p2 --rank <dir...> --scaf <dir...> --rand <dir...> (--regime K PERIOD | --p1 <json>) | r1|r2|r3 --assays <dir...> [--regime K PERIOD] [--runs <dir...>] | r4 --assays <dir...> | --in <json...> | decide --in <json...> | tau --assays <dir...> [--regime K PERIOD] | r1prime --assays <dir...> --tau <tau.json> [--regime K PERIOD] [--replay <json>] | r1dprime --assays <dir...> [--regime K PERIOD] [--runs <dir...>] | r3rep --assays <dir...> [--runs <dir...>] [--v1 <r3.json>]");
  Deno.exit(2);
}

/** `--flag a b c --other d` -> { flag: [a, b, c], other: [d] }. */
function parseFlags(args: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const a of args) {
    if (a.startsWith("--")) out.set(a.slice(2), (cur = []));
    else if (cur) cur.push(a);
    else usage(`unexpected argument ${a}`);
  }
  return out;
}

const need = (flags: Map<string, string[]>, name: string): string[] => {
  const v = flags.get(name);
  if (!v || v.length === 0) usage(`missing --${name}`);
  return v;
};

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const readJson = async (path: string): Promise<any> => JSON.parse(await Deno.readTextFile(path));

/** The directories at or below each path (up to four levels) that hold `marker`, in sorted order. */
/**
 * `expandDirs` for one root that never throws for a subdirectory or exits on an empty result: a subdirectory that cannot be read is
 * pushed to `skipped` with its reason and the walk goes on; the caller decides what an empty result means.
 */
async function expandDirsTolerant(root: string, marker: string, skipped: { dir: string; why: string }[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (await exists(`${dir}/${marker}`)) {
      out.push(dir);
      return;
    }
    if (depth === 0) return;
    const subs: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) if (e.isDirectory) subs.push(e.name);
    } catch (e) {
      skipped.push({ dir, why: `could not be walked: ${message(e)}` });
      return;
    }
    for (const s of subs.sort()) await walk(`${dir}/${s}`, depth - 1);
  };
  await walk(root, 4);
  return out;
}

async function expandDirs(paths: string[], marker: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (await exists(`${dir}/${marker}`)) {
      out.push(dir);
      return;
    }
    if (depth === 0) return;
    const subs: string[] = [];
    for await (const e of Deno.readDir(dir)) if (e.isDirectory) subs.push(e.name);
    for (const s of subs.sort()) await walk(`${dir}/${s}`, depth - 1);
  };
  for (const p of paths) await walk(p, 4);
  if (out.length === 0) usage(`no directory with ${marker} under ${paths.join(" ")}`);
  return out;
}

/** A run's done.json, or null when it has none. */
async function readDone(dir: string): Promise<DoneJson | null> {
  return (await exists(`${dir}/done.json`)) ? await readJson(`${dir}/done.json`) : null;
}

async function loadP1Run(dir: string): Promise<P1Run | null> {
  const meta = await readJson(`${dir}/meta.json`);
  const done = await readDone(dir);
  if (runStatus(done, meta.cycles) === "unfinished") return null;
  const rows: P1Row[] = [];
  for await (const r of readTsv(`${dir}/ponds.tsv`)) rows.push(p1Row(r));
  return p1RunOf(meta, done, rows);
}

async function p1(flags: Map<string, string[]>) {
  const runs: P1Run[] = [];
  const unfinished: string[] = [];
  const skipped: { dir: string; why: string }[] = [];
  const seen = new Set<string>();
  const anySide = flags.has("allow-any-seed");
  for (const d of await expandDirs(need(flags, "runs"), "meta.json")) {
    // P1 is the ancestor clone under `rand` with mutation on, at 16 ponds (protocol, P1 setup);
    // anything else found under --runs is listed, never pooled into ref or the per-seed criteria.
    const meta = await readJson(`${d}/meta.json`);
    const why = meta.arm !== "rand" ? `arm ${meta.arm}` : meta.init !== "clone" ? `init ${meta.init}` : !(meta.mutRate > 0) ? "mutation off" : !anySide && meta.side !== 4 ? `side ${meta.side}` : null;
    if (why) {
      skipped.push({ dir: d, why });
      continue;
    }
    const key = `${meta.k}/${meta.period}/${meta.seed}`;
    if (seen.has(key)) throw new Error(`two P1 runs share k/period/seed ${key} (${d})`);
    seen.add(key);
    const run = await loadP1Run(d);
    if (run) runs.push(run);
    else unfinished.push(d);
  }
  const { refs, regimes } = p1Regimes(runs);
  const choice = p1Choose(regimes);
  const truncation = p1Sensitivity(runs);
  return { stage: "p1", verdict: choice.verdict, choice, refs: Object.fromEntries(refs), regimes, runs: runs.length, unfinished, skipped, truncation };
}

/** P1's R3 calibration over the competence sets labelled --calibration 1 (ancestor) and 2 (quenched). */
async function calibrate(flags: Map<string, string[]>) {
  const p1 = await readJson(need(flags, "p1")[0]);
  if (!p1.choice) throw new Error("--p1 needs the JSON output of the p1 stage");
  // Calibration sets are at the regimes p1 found passing, whichever the walk ends up choosing.
  const { sets, skipped, rejected } = await loadAssays(flags, "competence", true, p1.choice.passing);
  const r = p1Calibrate(p1.choice, sets);
  return { stage: "calibrate", skipped, rejected, p1: p1.choice, ...r };
}

/** The pre-cycle trait of each pond at `boundary` (cycle rows carry the recipients' pre-cycle traits), and the truncated share of the rows. */
async function pondTraitsAt(dir: string, boundary: number): Promise<{ traits: Map<number, number>; truncation: ReturnType<typeof truncationOf> }> {
  const traits = new Map<number, number>();
  let rows = 0;
  let truncated = 0;
  for await (const r of readTsv(`${dir}/ponds.tsv`)) {
    const p = p1Row(r);
    rows++;
    if (p.truncated > 0) truncated++;
    if (p.cycle === boundary) traits.set(p.recipient, p.recipientTrait);
  }
  return { traits, truncation: truncationOf(truncated, rows) };
}

async function p2(flags: Map<string, string[]>) {
  const regime = await frozenRegime(flags);
  if (!regime) usage("p2 needs the frozen regime: --regime K PERIOD, or --p1 <json> with a chosen regime");
  // Only the protocol's runs at the frozen regime are pooled; anything else under the paths is listed, never read.
  const skipped: { dir: string; why: string }[] = [];
  // Unfinished (or violated) runs are not present: a ranking run still going would rank its founders last.
  const notRead: { dir: string; status: string }[] = [];
  /** The valid, distinct-seed runs of `role` under `flag`, each with its meta and replicate s. */
  const runsOf = async (flag: string, role: P2Role) => {
    const out: { dir: string; meta: any; s: number }[] = [];
    const seen = new Set<number>();
    for (const dir of await expandDirs(need(flags, flag), "meta.json")) {
      const meta = await readJson(`${dir}/meta.json`);
      const why = p2RunProblems(meta, role, regime);
      if (why.length > 0) {
        skipped.push({ dir, why: why.join("; ") });
        continue;
      }
      if (seen.has(meta.seed)) throw new Error(`two ${role} runs share seed ${meta.seed} (${dir})`);
      seen.add(meta.seed);
      const status = runStatus(await readDone(dir), meta.cycles);
      if (status !== "finished") notRead.push({ dir, status });
      else out.push({ dir, meta, s: p2Replicate(meta.seed, role)! });
    }
    return out;
  };

  const obs: { founder: number; trait: number }[] = [];
  const rankSeeds = new Set<number>();
  for (const { dir, meta } of await runsOf("rank", "rank")) {
    const { traits } = await pondTraitsAt(dir, 1);
    if (traits.size !== meta.side * meta.side) {
      skipped.push({ dir, why: `boundary 1 has ${traits.size} ponds, want ${meta.side * meta.side}` });
      continue;
    }
    rankSeeds.add(meta.seed);
    for (const [pond, trait] of traits) obs.push({ founder: meta.plantingToFounder[pond], trait });
  }
  // The rank score pools both ranking seeds; with fewer the high set is not the protocol's, so P2 waits.
  if (rankSeeds.size < P2_RANK_SEEDS) {
    return { stage: "p2", verdict: null, reason: `the ranking assay needs ${P2_RANK_SEEDS} finished seeds, found ${rankSeeds.size}`, regime, rankingSeeds: [...rankSeeds], notRead, skipped };
  }
  const { scores, high } = founderRank(obs, undefined, undefined, rankSeeds.size);
  const highSet = new Set(high);

  const load = async (role: "scaf" | "rand") => {
    const m = new Map<number, P2Arm>();
    const flagged = new Set<number>();
    for (const { dir, meta, s } of await runsOf(role, role)) {
      // A finished run has every pond's row at the last boundary; only a history that ended has none (a share of 0).
      const ended = (await readDone(dir))?.ended === true;
      const shares = await highShareCounts(readTsv(`${dir}/lineages.tsv`), highSet, meta.plantingToFounder, [1, P2_CYCLES]);
      const { traits, truncation } = await pondTraitsAt(dir, P2_CYCLES);
      const ponds = meta.side * meta.side;
      if (!ended && traits.size !== ponds) {
        skipped.push({ dir, why: `boundary ${P2_CYCLES} has ${traits.size} ponds, want ${ponds}` });
        continue;
      }
      let traitSum = 0;
      for (const t of traits.values()) traitSum += t;
      const first = shares.get(1)!, last = shares.get(P2_CYCLES)!;
      m.set(s, { high1: first.high, total1: first.total, highEnd: last.high, totalEnd: last.total, traitSum, ponds });
      if (truncation.flagged) flagged.add(s);
    }
    return { m, flagged };
  };
  const scaf = await load("scaf");
  const rand = await load("rand");
  const perSeed = P2_SEEDS.map((s) => ({ s, scaf: scaf.m.get(s) ?? null, rand: rand.m.get(s) ?? null }));
  const result = p2Evaluate(perSeed);
  const flagged = [...new Set([...scaf.flagged, ...rand.flagged])].sort((a, b) => a - b);
  return { stage: "p2", regime, highSet: high, founderScores: scores, notRead, skipped, ...result, truncation: p2Sensitivity(perSeed, flagged) };
}

/** `--regime K PERIOD`, the frozen regime the assays ran at; null when not given. */
function regimeFlag(flags: Map<string, string[]>): AssayRegime[] | null {
  const v = flags.get("regime");
  if (v === undefined) return null;
  const [k, period] = v.map(Number);
  if (v.length !== 2 || !Number.isInteger(k) || !Number.isInteger(period)) usage("--regime takes K PERIOD");
  return [{ k, period }];
}

/**
 * The frozen regime for p2: `--regime K PERIOD`, else the `chosen` regime of `--p1 <json>` (a calibrate output's,
 * or a p1 output's `choice.chosen`); both given must agree. null when neither is.
 */
async function frozenRegime(flags: Map<string, string[]>): Promise<AssayRegime | null> {
  const given = regimeFlag(flags)?.[0] ?? null;
  const path = flags.get("p1")?.[0];
  if (path === undefined) return given;
  const j = await readJson(path);
  const c = j.stage === "calibrate" ? j.chosen : j.choice?.chosen;
  if (!c || !Number.isInteger(c.k) || !Number.isInteger(c.period)) usage(`${path} has no chosen regime`);
  if (given && (given.k !== c.k || given.period !== c.period)) usage(`--regime ${given.k} ${given.period} disagrees with the chosen regime k ${c.k} period ${c.period} of ${path}`);
  return { k: c.k, period: c.period };
}

/**
 * The evolution histories under --runs (main-run directories), or null without the flag: each one's truncation
 * over its recipient rows and, for scaf and rand, its in-run donor repeatability (`withDonors`). Directories that
 * are not main runs of `regime`, and runs not finished, are listed and never read; two runs of one (arm, history) throw.
 */
async function loadHistories(flags: Map<string, string[]>, regime: AssayRegime | null, withDonors: boolean) {
  if (!flags.has("runs")) return null;
  const histories: (HistoryTruncation & { dir: string; repeatability: DonorRepeatability | null })[] = [];
  const skipped: { dir: string; why: string }[] = [];
  const notRead: { dir: string; status: string }[] = [];
  const seen = new Set<string>();
  for (const dir of await expandDirs(need(flags, "runs"), "meta.json")) {
    const meta = await readJson(`${dir}/meta.json`);
    const { key, why } = mainRunOf(meta, regime);
    if (key === null) {
      skipped.push({ dir, why: why.join("; ") });
      continue;
    }
    const id = `${key.arm}-${key.history}`;
    if (seen.has(id)) throw new Error(`two runs are history ${id} (${dir})`);
    seen.add(id);
    const status = runStatus(await readDone(dir), meta.cycles);
    if (status !== "finished") {
      notRead.push({ dir, status });
      continue;
    }
    const { truncation, repeatability } = await summariseHistory(readTsv(`${dir}/ponds.tsv`), meta.cycles, withDonors && key.arm !== "cont");
    histories.push({ ...key, ...truncation, dir, repeatability });
  }
  histories.sort((a, b) => a.arm.localeCompare(b.arm) || a.history - b.history);
  return { histories, skipped, notRead };
}

/**
 * Assay directories whose assay matches `assay` (or that do not say which assay they are); calibration sets only if
 * `calibration`. Sets that fail validateAssayDirs (wrong side or replicates, outside `regimes` or the --regime flag,
 * seeds that do not decode to the labels, e.g. a smoke set) are dropped and returned as `rejected`.
 */
async function loadAssays(flags: Map<string, string[]>, assay: string, calibration = false, regimes: readonly AssayRegime[] | null = regimeFlag(flags)): Promise<{ sets: AssaySet[]; skipped: number; rejected: { dir: string; reasons: string[] }[]; regime: AssayRegime | null }> {
  const dirs: AssayDir[] = [];
  let skipped = 0;
  for (const d of await expandDirs(need(flags, "assays"), "assay.json")) {
    const json = await readJson(`${d}/assay.json`);
    // Amendment 2's R1' sets and tau calibration belong to the tau and r1prime stages, R1'' sets to r1dprime and the R3 replication's to r3rep.
    if (json.labels?.r1prime === true || json.labels?.tauCalibration === true || json.labels?.r1dprime === true || json.labels?.r3rep === true) {
      skipped++;
      continue;
    }
    const rows = [];
    for await (const r of readTsv(`${d}/assay.tsv`)) rows.push(assayRow(r));
    const name: string | undefined = json.assay ?? rows[0]?.assay;
    if (name !== undefined && name !== assay) {
      skipped++;
      continue;
    }
    const labels = assayLabels(json);
    // P1's calibration sets are ancestor competence sets of their own; R3 never sees them.
    if ((labels.calibration !== null) !== calibration) {
      skipped++;
      continue;
    }
    dirs.push({ dir: d, json, labels, rows });
  }
  const { accepted, rejected, regime } = validateAssayDirs(dirs, regimes);
  return { sets: accepted.map(({ labels, rows }) => ({ labels, rows })), skipped, rejected, regime };
}

/** The evolution histories as a stage prints them: their truncation (not the per-cycle repeatability rows), or `loaded: false`. */
function evolutionOut(e: Awaited<ReturnType<typeof loadHistories>>) {
  if (e === null) return { loaded: false };
  return { loaded: true, histories: e.histories.map(({ repeatability: _, ...h }) => h), skipped: e.skipped, notRead: e.notRead };
}

async function r4(flags: Map<string, string[]>) {
  const rows: R4Row[] = [];
  for (const f of flags.get("in") ?? []) rows.push(...r4RowsOf(await readJson(f)));
  for (const d of flags.has("assays") ? await expandDirs(need(flags, "assays"), "assay.json") : []) {
    const j = await readJson(`${d}/assay.json`);
    if (j.assay === "capability") rows.push(...r4RowsOf(j));
  }
  if (rows.length === 0) usage("r4 needs --assays <dir...> or --in <json...> with capability rows");
  return { stage: "r4", verdict: null, ...r4Table(rows) };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** An assay directory with its traits.tsv streamed (null when absent), keeping only the steps `keep` names (all when it returns undefined). Throws on a missing or malformed table. */
async function loadTraitSet(dir: string, json: Record<string, any>, keep: (period: unknown) => ReadonlySet<number> | undefined): Promise<TraitSetDir> {
  const rows = [];
  for await (const r of readTsv(`${dir}/assay.tsv`)) rows.push(assayRow(r));
  const traits = (await exists(`${dir}/traits.tsv`)) ? await readTraits(readTsv(`${dir}/traits.tsv`), keep(json.period), gridOfJson(json)) : null;
  return { dir, json, rows, traits };
}

/** Amendment 2's tau: the tau calibration's traits.tsv through `tauRule`; tau null while the set is missing or rejected. */
async function tauStage(flags: Map<string, string[]>) {
  const strict = !flags.has("allow-any-seed");
  const dirs: TraitSetDir[] = [];
  const rejected: { dir: string; reasons: string[] }[] = [];
  let skipped = 0;
  for (const d of await expandDirs(need(flags, "assays"), "assay.json")) {
    let json;
    try {
      json = await readJson(`${d}/assay.json`);
    } catch (e) {
      rejected.push({ dir: d, reasons: [`assay.json: ${message(e)}`] });
      continue;
    }
    if (json?.labels?.tauCalibration !== true) {
      skipped++;
      continue;
    }
    try {
      dirs.push(await loadTraitSet(d, json, () => undefined));
    } catch (e) {
      rejected.push({ dir: d, reasons: [`could not read the set: ${message(e)}`] });
    }
  }
  const screened = tauScreen(dirs, { regimes: regimeFlag(flags), allowAnySeed: !strict });
  rejected.push(...screened.rejected);
  if (screened.accepted.length > 1) throw new Error(`${screened.accepted.length} tau calibration sets (${screened.accepted.map((x) => x.dir).join(", ")}); the stage takes one`);
  if (screened.accepted.length === 0) return { stage: "tau", verdict: null, validated: false, tau: null, reason: "no valid tau calibration set", skipped, rejected };
  const set = screened.accepted[0];
  const byStep = new Map<number, number[]>();
  for (const [step, rows] of set.traits!.rows) byStep.set(step, rows.map((t) => t.trait));
  const ref = set.json.ref as number;
  const r = tauRule(byStep, ref, set.json.period as number);
  // `validated` is true only for a strict screen: r1prime refuses a tau.json that is not (a smoke run's tau is a test of the tools, not a calibration).
  const { source, k, period, side, replicates, seeds, labels } = set.json;
  return { stage: "tau", verdict: null, validated: strict, provenance: { source, ref, k, period, side, replicates, seeds, labels }, dir: set.dir, ref, k: k ?? null, period, fragments: set.rows.length, ...r, skipped, rejected };
}

/** Amendment 2's R1': every R1' set's statistic at tau and at the end, and the rule at t' = 0 (see the header). */
async function r1primeStage(flags: Map<string, string[]>) {
  const strict = !flags.has("allow-any-seed");
  const tauPath = need(flags, "tau")[0];
  const tauJson = await readJson(tauPath);
  // tau must be the output of a strict calibration (validated, at the frozen regime and ancestor source); a smoke run reads any integer tau.
  const tauProblems = strict ? tauJsonProblems(tauJson) : Number.isInteger(tauJson.tau) && tauJson.tau >= 1 ? [] : [`tau ${JSON.stringify(tauJson.tau)}, want a positive integer`];
  if (tauProblems.length > 0) usage(`${tauPath} cannot fix tau for R1': ${tauProblems.join("; ")}`);
  const tau: number = tauJson.tau;
  const dirs: TraitSetDir[] = [];
  // A set that cannot be read (a missing or malformed table) makes its history-time unavailable; it does not stop the others.
  const rejected: { dir: string; key: R1PrimeKey | null; reasons: string[] }[] = [];
  let skipped = 0;
  for (const d of await expandDirs(need(flags, "assays"), "assay.json")) {
    let json;
    try {
      json = await readJson(`${d}/assay.json`);
    } catch (e) {
      rejected.push({ dir: d, key: null, reasons: [`assay.json: ${message(e)}`] });
      continue;
    }
    if (json?.labels?.r1prime !== true) {
      skipped++;
      continue;
    }
    try {
      // Only the traits at tau and at the end of the period are kept; the rest of traits.tsv is counted and dropped.
      dirs.push(await loadTraitSet(d, json, (period) => new Set([tau, Number.isInteger(period) ? (period as number) : tau])));
    } catch (e) {
      rejected.push({ dir: d, key: r1PrimeKeyOf(json), reasons: [`could not read the set: ${message(e)}`] });
    }
  }
  const screened = r1PrimeScreen(dirs, { tau, regimes: regimeFlag(flags), allowAnySeed: !strict });
  rejected.push(...screened.rejected);
  const replay = flags.has("replay") ? parseReplayCheck(await readJson(need(flags, "replay")[0])) : NO_REPLAY_CHECK;
  const r = r1PrimeEvaluate(screened.accepted, replay, rejected);
  return {
    stage: "r1prime",
    verdict: r.verdict,
    tau,
    tauFrom: tauPath,
    tauValidated: tauJson.validated === true,
    regime: screened.regime,
    skipped,
    rejected,
    replay,
    arms: r.arms,
    histories: r.histories,
    descriptive: {
      note: "per (arm, history, t'): atTau is R1's statistic on the trait at tau, atEnd on the end trait; varianceComponent is the one-way ANOVA between-donor component (MS_between - MS_within) / n0 on the OLS-adjusted trait (negative kept), rawFamilyMeanVariance the sample variance of the raw donor means, saturation the fraction of fragments at 80% or more of the assay budget; `demonstrated` and the verdict read atTau at t' = 0 only; an unavailable history (no valid set, a failed or missing replay check at t' = 0 and 1, a set that could not be read) counts as not demonstrated",
    },
  };
}

/**
 * The fresh-history run directories under --runs (meta.json seeds 4,811,001 + 100 arm + i, 34 cycles), or null without the flag:
 * each one's status and whether its history ended, and at which cycle. Directories that are not such runs are listed and never
 * read; two runs of one (arm, history) throw.
 */
async function r1dprimeRuns(flags: Map<string, string[]>): Promise<{ histories: R1dPrimeRun[]; skipped: { dir: string; why: string }[] } | null> {
  if (!flags.has("runs")) return null;
  const histories: R1dPrimeRun[] = [];
  const skipped: { dir: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const dir of await expandDirs(need(flags, "runs"), "meta.json")) {
    const meta = await readJson(`${dir}/meta.json`);
    const { key, why } = r1dPrimeRunOf(meta);
    if (key === null) {
      skipped.push({ dir, why: why.join("; ") });
      continue;
    }
    const id = `${key.arm}-i${key.history}`;
    if (seen.has(id)) throw new Error(`two runs are history ${id} (${dir})`);
    seen.add(id);
    const done = await readDone(dir);
    histories.push({ ...key, dir, status: runStatus(done, meta.cycles), ended: done?.ended === true, endedAt: typeof done?.endedAt === "number" ? done.endedAt : null });
  }
  histories.sort((a, b) => a.arm.localeCompare(b.arm) || a.history - b.history);
  return { histories, skipped };
}

/** R1'' (docs/scaffold-heredity-replication-v1.md): the controls, availability and the rule over the crossing-time sets (see the header). */
async function r1dprimeStage(flags: Map<string, string[]>) {
  const strict = !flags.has("allow-any-seed");
  const dirs: TraitSetDir[] = [];
  // A set that cannot be read (a missing or malformed table) makes its h unavailable; it does not stop the others.
  const rejected: { dir: string; h: number | null; reasons: string[] }[] = [];
  let skipped = 0;
  for (const d of await expandDirs(need(flags, "assays"), "assay.json")) {
    let json;
    try {
      json = await readJson(`${d}/assay.json`);
    } catch (e) {
      rejected.push({ dir: d, h: null, reasons: [`assay.json: ${message(e)}`] });
      continue;
    }
    if (json?.labels?.r1dprime !== true) {
      skipped++;
      continue;
    }
    try {
      // Every census step is kept: T is the first of them at which a fragment's trait reaches m*.
      dirs.push(await loadTraitSet(d, json, () => undefined));
    } catch (e) {
      rejected.push({ dir: d, h: r1dPrimeHOf(json), reasons: [`could not read the set: ${message(e)}`] });
    }
  }
  const screened = r1dPrimeScreen(dirs, { regimes: regimeFlag(flags), allowAnySeed: !strict });
  rejected.push(...screened.rejected);
  const runs = await r1dprimeRuns(flags);
  const r = r1dPrimeEvaluate(screened.accepted, runs?.histories ?? null, rejected);
  return {
    stage: "r1dprime",
    verdict: r.verdict,
    regime: screened.regime,
    skipped,
    rejected,
    runs: runs === null ? { loaded: false } : { loaded: true, ...runs },
    controls: r.controls,
    arms: r.arms,
    histories: r.histories,
    sources: screened.accepted.map(({ h, dir, provenance, protocolSha256R1dp }) => ({ h, dir, provenance, protocolSha256R1dp })).sort((x, y) => x.h - y.h),
    descriptive: {
      note: "per set: fractionAt100 and fractionCensored are the fractions of fragments at T = 100 (their pond reached m* = 25,764.5 by the first census) and at T = 10,100 (never did); atEnd and atTau are R1's statistic on the end trait and the trait at tau = 4,100 (R1' as reported); varianceComponent is the one-way ANOVA between-donor component (MS_between - MS_within) / n0 on the OLS-adjusted log T (negative kept), rawFamilyMeanVariance the sample variance of the raw donor means of log T; extinctFragments counts fragments with no trait at the end; `degenerate` marks scores that cannot carry the test (every value equal, or residuals at roundoff level: ICC 0, p 1); extinction counts, per arm, the histories whose run ended before boundary 34 (needs --runs) and those with fewer than 2 donors; no decision reads any of it. The verdict applies the controls first, then availability, then the rule; arms.<arm>.verdict is the availability and the rule for that arm alone (rand is reported, never decided)",
      ...r.descriptive,
    },
  };
}

/**
 * A pinned protocol document as it is now (descriptive; the screen checks the pinned hashes): its SHA-256, which a dated amendment at
 * the end changes, and whether it still begins with its pinned text.
 */
async function protocolNow(which: keyof typeof R3REP_PROTOCOLS): Promise<{ doc: string; sha256: string; pinnedTextIntact: boolean }> {
  const bytes = await Deno.readFile(new URL(`../${R3REP_PROTOCOLS[which].doc}`, import.meta.url));
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { doc: R3REP_PROTOCOLS[which].doc, sha256, pinnedTextIntact: (await r3RepProtocolProblems(which, bytes)).length === 0 };
}

/**
 * The replication's history run directories under --runs (meta.json of a history at 100 cycles, `r3RepRunOf`), or null without the flag:
 * each one's status, whether it ended, and (finished runs) its ponds.tsv streamed into a per-boundary summary. Directories that are not
 * such runs, runs that cannot be read, and both runs of an (arm, history) given twice are listed under `skipped` and not summarised.
 */
async function r3repRuns(flags: Map<string, string[]>): Promise<{ runs: R3RepRun[]; skipped: { dir: string; why: string }[] } | null> {
  if (!flags.has("runs")) return null;
  const runs: R3RepRun[] = [];
  const skipped: { dir: string; why: string }[] = [];
  const seen = new Set<string>();
  // Descriptive only: a root that cannot be walked, or that holds no run, and a run that cannot be read are listed with their
  // reason and never stop the readout.
  const dirs: string[] = [];
  for (const root of flags.get("runs") ?? []) {
    try {
      const found = await expandDirsTolerant(root, "meta.json", skipped);
      if (found.length === 0) skipped.push({ dir: root, why: "no run directory (meta.json) under it" });
      dirs.push(...found);
    } catch (e) {
      skipped.push({ dir: root, why: `could not be walked: ${message(e)}` });
    }
  }
  for (const dir of dirs) {
    try {
      const meta = await readJson(`${dir}/meta.json`);
      const { key, why } = r3RepRunOf(meta);
      if (key === null) {
        skipped.push({ dir, why: why.join("; ") });
        continue;
      }
      const id = `${key.arm}-i${key.history}`;
      if (seen.has(id)) {
        skipped.push({ dir, why: `a second run of history ${id}; neither is summarised` });
        continue;
      }
      seen.add(id);
      const done = await readDone(dir);
      const status = runStatus(done, meta.cycles);
      const trajectory = status === "finished" ? await r3RepTrajectory(readTsv(`${dir}/ponds.tsv`)) : null;
      runs.push({ ...key, dir, status, ended: done?.ended === true, endedAt: typeof done?.endedAt === "number" ? done.endedAt : null, trajectory });
    } catch (e) {
      skipped.push({ dir, why: `could not be read: ${message(e)}` });
    }
  }
  // A history with two runs is summarised by neither: the first one is listed beside the second.
  for (const s of [...skipped]) {
    const m = /^a second run of history (\S+);/.exec(s.why);
    if (!m) continue;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (`${runs[i].arm}-i${runs[i].history}` !== m[1]) continue;
      skipped.push({ dir: runs[i].dir, why: `the first run of history ${m[1]}, which has a second; neither is summarised` });
      runs.splice(i, 1);
    }
  }
  return { runs, skipped };
}

/** The R3 replication (docs/scaffold-r3-replication-v1.md): screening, availability and the rule over the 62 sets (see the header). */
async function r3repStage(flags: Map<string, string[]>) {
  const strict = !flags.has("allow-any-seed");
  const sha = R3REP_SHA256;
  const dirs: R3RepSetDir[] = [];
  // A set that cannot be read (a missing or malformed table) is unavailable with its reason; it does not stop the others.
  const rejected: { dir: string; id: string | null; reasons: string[] }[] = [];
  const skipped: { dir: string; why: string }[] = [];
  for (const d of await expandDirs(need(flags, "assays"), "assay.json")) {
    let json;
    try {
      json = await readJson(`${d}/assay.json`);
    } catch (e) {
      rejected.push({ dir: d, id: null, reasons: [`assay.json: ${message(e)}`] });
      continue;
    }
    if (json?.labels?.r3rep !== true) {
      skipped.push({ dir: d, why: "not an R3-replication set (labels.r3rep is not true)" });
      continue;
    }
    try {
      const rows = [];
      for await (const r of readTsv(`${d}/assay.tsv`)) rows.push(assayRow(r));
      dirs.push({ dir: d, json, rows });
    } catch (e) {
      rejected.push({ dir: d, id: r3RepSetIdOfJson(json), reasons: [`could not read the set: ${message(e)}`] });
    }
  }
  // Every checkpoint the sets' provenance names that is reachable from here, reloaded once: its record and its dominant genome.
  const reloaded = new Map<string, R3RepReload>();
  for (const path of new Set(dirs.flatMap((d) => r3RepRecordedCheckpoints(d.json).map((c) => c.record.source as string)))) {
    if (!(await exists(path))) continue;
    try {
      const state = await loadCheckpoint(path);
      reloaded.set(path, { record: r3RepCheckpointOf(path, state), dominant: r3RepDominantRecord(dominantGenome(state)) });
    } catch (e) {
      reloaded.set(path, { error: message(e) });
    }
  }
  const screened = r3RepScreen(dirs, { sha, reloaded, allowAnySeed: !strict });
  rejected.push(...screened.rejected);
  const r = r3RepEvaluate(screened.accepted, rejected);
  const runs = await r3repRuns(flags);
  let v1 = null;
  if (flags.has("v1")) {
    const path = need(flags, "v1")[0];
    try {
      v1 = { from: path, ...r3RepSideBySide(await readJson(path), r.evaluation, r.quenched.max) };
    } catch (e) {
      usage(`--v1 ${path}: ${message(e)}`);
    }
  }
  const unverifiable = screened.accepted.filter((s) => s.unverifiable.length > 0).map((s) => ({ id: s.id, checkpoints: s.unverifiable }));
  return {
    stage: "r3rep",
    outcome: r.outcome,
    reasons: r.reasons,
    failed: r.failed,
    protocolSha256R3rep: sha.r3rep,
    protocolSha256: sha.protocol,
    protocolNow: { r3rep: await protocolNow("r3rep"), protocol: await protocolNow("protocol") },
    validated: strict,
    availability: r.availability,
    quenched: r.quenched,
    histories: r.histories,
    counts: r.counts,
    checkpoints: { reloaded: [...reloaded.values()].filter((x) => !("error" in x)).length, unreadable: [...reloaded].filter(([, x]) => "error" in x).map(([path]) => path), unverifiable },
    descriptive: {
      note: "never a decision input. competences: every available set's competence over both replicates and each replicate alone, with its truncated rows; histories: v1's r3Evaluate over every available set (an unavailable history's remaining sets included), with the margins in fragments of 128 (adv_i(X) per X and timing; swap: (gain - 0.5 adv_i(ancestor)) x 128 at (a), gain = Ge-on-Fa - ancestor); perReplicate: the rule's counts on each replicate's fragments alone, over the available histories; unmatched: the retained B+P and E of every source's fragments; truncation: the sets with more than 1% truncated rows; runs (--runs): per history its mean pre-cycle pond trait per boundary (extinct ponds count 0), its extinct ponds at boundary 100 (null when it has no boundary-100 rows) and its truncation, and per arm the medians at boundaries 1, 10, 25, 50, 75 and 100; v1 (--v1): v1's R3 numbers beside the replication's",
      ...r.descriptive,
      runs: runs === null ? { loaded: false } : { loaded: true, ...r3RepRunsSummary(runs.runs), skipped: runs.skipped },
      v1,
    },
    rejected,
    skipped,
  };
}

async function decideCmd(flags: Map<string, string[]>) {
  const inputs: DecisionInputs = {};
  let p1: boolean | null | undefined;
  let cal: boolean | null | undefined;
  for (const f of need(flags, "in")) {
    const j = await readJson(f);
    if (j.stage === "p1") p1 = j.verdict ?? null;
    else if (j.stage === "calibrate") cal = j.verdict ?? null;
    else if ((STAGES as readonly string[]).includes(j.stage)) inputs[j.stage as (typeof STAGES)[number]] = j.verdict ?? null;
    else Object.assign(inputs, j);
  }
  // A regime is chosen only once it passes the R3 calibration: p1 = true without a calibration stays pending.
  const notes: string[] = [];
  if (p1 !== undefined || cal !== undefined) {
    inputs.p1 = p1 === false ? false : cal !== undefined ? cal : null;
    if (p1 === true && cal === undefined) notes.push("p1 chose a regime but no calibrate output was given, so p1 is pending");
  }
  return { stage: "decide", inputs, ...decide(inputs), notes, table: DECISION_TABLE };
}

async function main() {
  const [cmd, ...rest] = Deno.args;
  if (!cmd) usage();
  const flags = parseFlags(rest);
  let out: unknown;
  switch (cmd) {
    case "p1":
      out = await p1(flags);
      break;
    case "calibrate":
      out = await calibrate(flags);
      break;
    case "p2":
      out = await p2(flags);
      break;
    case "r1": {
      const { sets, skipped, rejected, regime } = await loadAssays(flags, "transmission");
      const r = r1Evaluate(sets);
      const evolution = await loadHistories(flags, regime, true);
      // Descriptive only: no verdict reads the in-run repeatability.
      const donorRepeatability = evolution?.histories.filter((h) => h.repeatability !== null).map(({ arm, history, repeatability }) => ({ arm, history, ...repeatability! })) ?? null;
      const descriptive = {
        note: "in-run donor-family repeatability: for every cycle b with a next boundary, the ICC(1) by actual donor of the recipients' next-boundary traits, residualised on log(1 + retained B+P) within the cycle; `all` is the mean over those cycles and `lastHalf` over b > C/2; confounded by truncation and copied physical state; no verdict reads it",
        donorRepeatability,
      };
      out = { stage: "r1", verdict: r1Verdict(r), skipped, rejected, regime, ...r, truncation: assaySensitivity(sets, (x, e) => r1Verdict(r1Evaluate(x), e), R1_EXPECTED, evolution?.histories ?? null), evolution: evolutionOut(evolution), descriptive };
      break;
    }
    case "r2": {
      const { sets, skipped, rejected, regime } = await loadAssays(flags, "garden");
      const r = r2Evaluate(sets);
      const evolution = await loadHistories(flags, regime, false);
      out = { stage: "r2", verdict: r2Verdict(r), skipped, rejected, regime, ...r, truncation: assaySensitivity(sets, (x, e) => r2Verdict(r2Evaluate(x), e), R2_EXPECTED, evolution?.histories ?? null), evolution: evolutionOut(evolution) };
      break;
    }
    case "r3": {
      const { sets, skipped, rejected, regime } = await loadAssays(flags, "competence");
      const r = r3Evaluate(sets);
      const evolution = await loadHistories(flags, regime, false);
      out = { stage: "r3", verdict: r3Verdict(r), skipped, rejected, regime, ...r, truncation: assaySensitivity(sets, (x, e) => r3Verdict(r3Evaluate(x), e), R3_EXPECTED, evolution?.histories ?? null, true), evolution: evolutionOut(evolution) };
      break;
    }
    case "r4":
      out = await r4(flags);
      break;
    case "tau":
      out = await tauStage(flags);
      break;
    case "r1prime":
      out = await r1primeStage(flags);
      break;
    case "r1dprime":
      out = await r1dprimeStage(flags);
      break;
    case "r3rep":
      out = await r3repStage(flags);
      break;
    case "decide":
      out = await decideCmd(flags);
      break;
    default:
      usage(`unknown subcommand ${cmd}`);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.main) await main();
