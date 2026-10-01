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
  r2Evaluate,
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
  type R4Row,
  type TraitSetDir,
} from "./lib/scaffold-stats.ts";

const STAGES = ["p1", "p2", "r1", "r2", "r3"] as const;

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("usage: scaffold-report.ts p1 --runs <dir...> | calibrate --p1 <json> --assays <dir...> | p2 --rank <dir...> --scaf <dir...> --rand <dir...> (--regime K PERIOD | --p1 <json>) | r1|r2|r3 --assays <dir...> [--regime K PERIOD] [--runs <dir...>] | r4 --assays <dir...> | --in <json...> | decide --in <json...> | tau --assays <dir...> [--regime K PERIOD] | r1prime --assays <dir...> --tau <tau.json> [--regime K PERIOD] [--replay <json>]");
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
    // Amendment 2's R1' sets and tau calibration belong to the tau and r1prime stages.
    if (json.labels?.r1prime === true || json.labels?.tauCalibration === true) {
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
    case "decide":
      out = await decideCmd(flags);
      break;
    default:
      usage(`unknown subcommand ${cmd}`);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.main) await main();
