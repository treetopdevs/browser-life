// The anomaly bell, v1, parts A and B (docs/naturalist-bell-v1-plan-2026-10-17.md, "Fixed before running"): a code detector scored on
// fresh neutral runs (A), and a twin bell scored on interventions at a known step (B). CPU only, streaming, no model calls. Logic and
// constants in tools/lib/bell1.ts (job list and nudge rule in tools/lib/bell-v1-jobs.ts, the v0 score in tools/lib/bell.ts); this
// file reads bundles, runs the scorers in lockstep and writes the records.
//
//   deno run -A tools/bell1.ts null   --runs <runs root> --base <runs root> --launch-log <jobs.jsonl> [--record <file>] [--allow-incomplete] [--force]
//   deno run -A tools/bell1.ts twins  --runs <runs root> --base <runs root> --launch-log <jobs.jsonl> [--nudges <file>] [--record <file>] [--allow-incomplete] [--force]
//
//   --runs            the root holding the v1 bundles: bell-v1-null/... (null) and bell-v1-twins-<arm>/... (twins), e.g. <main checkout>/runs
//   --base            the root holding the v0 bundles: replay-calib and replay-m4 (null: the 40 gradient-m3 envelope runs, the 30 spots-m3
//                     runs and the 10 treatment runs; twins: replay-m4 gradient-m3 treatment seeds 1 to 10, the twin bases)
//   --nudges          twins: the nudge centres (default experiments/naturalist/bell-v1-nudges.json, written by tools/bell-v1-launch.ts)
//   --launch-log      <runs>/bell-v1-launch/jobs.jsonl, required (only a --plan smoke test may go without): a fresh run or a twin counts only if
//                     the log lists its job with exit 0 (the last line for an id wins). The launcher writes a line for every job that
//                     finishes, so a job the log does not list is unfinished and does not count. The record says how many jobs matched.
//   --record          the compact record, written atomically (temp file, rename); default experiments/naturalist/bell-v1-null.json or
//                     bell-v1-twins.json, or the same with ".incomplete" before ".json" when an expected directory is missing and
//                     nothing is called. A record is complete:true when no expected directory is missing and called:true when a
//                     criterion is called (A1; or any of B2, B3); a void twin never makes a record "incomplete" by itself.
//   --allow-incomplete  go on when an expected bundle directory is missing (the record says complete:false; part A calls A1 only when its own corpus, the 70 fresh and 40 envelope runs, is whole, and a reported item missing runs is marked not called; part B calls only the criteria whose twins are all valid);
//                     default: stop. A bundle that is there but fails its checks never stops a run of the fresh nulls or the twins: a fresh
//                     run that fails counts as not loaded and a void twin is reported (the note); a v0 run or a base that fails stops it.
//   --force           replace a record that is complete:true and called. Without it a complete record that called a readout is never
//                     overwritten (one taken while jobs were still running calls nothing and may be replaced).
//   --plan <file>     twins only, a test hook: a JSON plan of explicit bases, twins and S, for smoke tests on other bundles (it needs an
//                     explicit --record, and takes the place of --runs, --base and --nudges). Not for the real readout.
// Unknown flags and extra arguments stop the run.
//
// Reads, per run, manifest.json, series.jsonl and lineages.tsv (twins also interventions.jsonl), one census at a time; no table is held
// whole. Nothing is aligned silently: every census must be at the cadence, the runs of a group share preset identity, and a lockstep
// mismatch stops the run naming the run.
//
// null (part A). The 40 gradient-m3 envelope runs are the envelope; the 70 fresh runs (seeds 2002 to 2071) and the 10 treatment runs are
// scored against all 40, each envelope run leave-one-out, up to step 300,000. A fresh run is first read end to end on its own
// (manifest summary, exit 0 in the launch log, exactly 3,000 censuses, and at every census finite livingCells and lineages with the
// lineage rows matching them exactly, which is stricter than v0's cross-check); one that fails is not loaded. The record is
// experiments/naturalist/bell-v1-null.json.
// twins (part B). The 10 treatment bases and the 50 twins (5 arms x 10 seeds) are read together, 60 streams, through step 300,000. A twin
// is valid per the note (manifest summary, exit 0, 3,000 censuses each passing the same strict check as a fresh null, exactly the scheduled
// intervention, equal to its base up to S, different after it); a twin that is not is void and only the criteria that need it are not called. The record is experiments/naturalist/bell-v1-twins.json.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { lineageCensuses } from "./lib/bundle.ts";
import { PRIMARY, SIGNALS, BURN_IN_STEP, SignalExtractor, mergeCensuses, parseSeries, splitLines, type BellScorer } from "./lib/bell.ts";
import {
  BELL1_VERSION,
  CADENCE,
  DROPPED_SIGNALS,
  EARLY_FROM,
  EARLY_TO,
  HORIZON,
  HORIZON_CENSUSES,
  MATTER_CHANNELS,
  NOTE1_PATH,
  PairScorer,
  W_PAIR,
  checkBaseManifest,
  checkCensusStream,
  checkHorizonIdentity,
  checkExactManifest,
  checkV0Manifest,
  defaultRecord,
  defaultTwinsPlan,
  freshRuns,
  interventionProblem,
  isV1Signal,
  judgeTwin,
  launchCoverage,
  launchProblem,
  newNullScorer,
  nullCalled,
  nullEntry,
  parseInterventions,
  parseLaunchLog,
  parseNudgeFile,
  planNull,
  recordRefusal1,
  strictCensuses,
  summarizeNull,
  summarizeTwins,
  twinsCalled,
  twinManifestProblem,
  v0Runs,
  type Census,
  type NullEntry,
  type NullRun,
  type TwinInput,
  type TwinOutcome,
  type TwinsPlan,
} from "./lib/bell1.ts";
import type { Job } from "./lib/bell-v1-jobs.ts";

const a = parseArgs(Deno.args, {
  string: ["runs", "base", "record", "launch-log", "nudges", "plan"],
  boolean: ["allow-incomplete", "force"],
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
// A string flag with no operand (last, or followed by another flag) parses as "": stop before any I/O rather than resolve under "/".
for (const k of ["runs", "base", "record", "launch-log", "nudges", "plan"] as const) if (a[k] === "") throw new Error(`--${k} needs a path`);
const cmd = String(a._[0] ?? "");
if ((cmd !== "null" && cmd !== "twins") || a._.length > 1) throw new Error(`usage: bell1.ts null|twins --runs <root> --base <root> (got ${a._.map(String).join(" ") || "nothing"})`);
if (cmd === "null" && (a.nudges !== undefined || a.plan !== undefined)) throw new Error("--nudges and --plan are for the twins command");
const allowIncomplete = !!a["allow-incomplete"];
if (a.plan === undefined) {
  if (!a.runs || !a.base) throw new Error("--runs and --base are needed (the roots holding the v1 bundles and the v0 bundles)");
  if (a["launch-log"] === undefined) throw new Error("--launch-log is needed (<runs>/bell-v1-launch/jobs.jsonl): a run counts only if the log lists its job with exit 0");
} else {
  if (cmd !== "twins") throw new Error("--plan is for the twins command");
  if (a.record === undefined) throw new Error("--plan needs an explicit --record (a test plan never writes the official record)");
  if (a.runs !== undefined || a.base !== undefined || a.nudges !== undefined) throw new Error("--plan takes the place of --runs, --base and --nudges");
}
const runsRoot = a.runs?.replace(/\/+$/, "") ?? "";
const baseRoot = a.base?.replace(/\/+$/, "") ?? "";

// ---------------------------------------------------------------------------------------------
// File helpers.

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
const readOrNull = (p: string) => Deno.readTextFile(p).catch((e) => (e instanceof Deno.errors.NotFound ? null : Promise.reject(e)));
const hasBundle = async (dir: string) => (await Promise.all(["manifest.json", "series.jsonl", "lineages.tsv"].map((f) => exists(`${dir}/${f}`)))).every(Boolean);
/** series.jsonl, one record at a time. */
function seriesRecords(id: string, dir: string) {
  return (async function* () {
    const file = await Deno.open(`${dir}/series.jsonl`);
    yield* parseSeries(id, splitLines(file.readable.pipeThrough(new TextDecoderStream())));
  })();
}
/** One run's censuses: series records joined with lineage rows, cross-checked at every census (mergeCensuses). */
const merged = (id: string, dir: string) => mergeCensuses(id, seriesRecords(id, dir), lineageCensuses(dir));
/** merged() plus the note's strict per-census rule (finite livingCells and lineages, exact lineage match), for the fresh nulls and every twin. */
const strict = (id: string, dir: string) => strictCensuses(id, merged(id, dir));
let writes = 0;
/** Replaced whole: write a unique temp file in the same directory, sync, rename. */
async function writeAtomic(path: string, text: string) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  await Deno.mkdir(dir, { recursive: true });
  const tmp = `${path}.${Deno.pid}.${++writes}.tmp`;
  let wrote = false;
  try {
    await Deno.writeTextFile(tmp, text, { createNew: true });
    wrote = true;
    const f = await Deno.open(tmp, { read: true });
    try {
      await f.syncData();
    } finally {
      f.close();
    }
    await Deno.rename(tmp, path);
  } catch (e) {
    if (wrote || !(e instanceof Deno.errors.AlreadyExists)) await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}
const launchLog = a["launch-log"] !== undefined ? parseLaunchLog(await Deno.readTextFile(a["launch-log"]).catch((e) => {
  throw new Error(`cannot read --launch-log ${a["launch-log"]} (${(e as Error).message})`);
})) : null;
/** What the record says about the launch log: its path and how many of the expected jobs it lists, and how many of those exited 0. */
const launchLogInfo = (ids: string[]) => (launchLog === null ? { used: false } : { used: true, path: a["launch-log"], entries: launchLog.size, ...launchCoverage(launchLog, ids) });
const f3 = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? "n/a" : x.toFixed(d));
const cnt = (c: { k: number; of: number }) => `${c.k}/${c.of}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const parameters = {
  signals: SIGNALS.map((s) => ({ name: s.name, kind: s.kind, floor: s.floor, source: s.source, inV1Null: isV1Signal(s.name) })),
  dropped: DROPPED_SIGNALS,
};

if (cmd === "null") await runNull();
else await runTwins();

// =============================================================================================
// Part A.

async function runNull() {
  const v0 = v0Runs();
  const fresh = freshRuns();
  const dirOf = (r: NullRun) => `${r.set === "fresh" ? runsRoot : baseRoot}/${r.rel}`;
  const all = [...v0.envelope, ...v0.spots, ...v0.treatment, ...fresh];
  const missing: string[] = [];
  const present = new Set<string>();
  for (const r of all) {
    if (await hasBundle(dirOf(r))) present.add(r.id);
    else missing.push(r.id);
  }
  if (missing.length && !allowIncomplete) {
    throw new Error(`STOP: ${missing.length} of ${all.length} expected run directories are missing (first: ${missing[0]}); --allow-incomplete scores what exists, calls A1 only when its 70 fresh and 40 envelope runs are whole, and marks reported items missing runs not called`);
  }
  const complete = missing.length === 0;
  const have = (rs: NullRun[]) => rs.filter((r) => present.has(r.id));

  // v0 manifests: any failure stops (the envelope is fixed).
  const manifests = new Map<string, { presetIdentity: string }>();
  for (const r of [...have(v0.envelope), ...have(v0.spots), ...have(v0.treatment)]) {
    const m = checkV0Manifest(r, await Deno.readTextFile(`${dirOf(r)}/manifest.json`));
    manifests.set(r.id, m);
  }
  const grad = have(v0.envelope), spots = have(v0.spots), treat = have(v0.treatment);
  checkHorizonIdentity([...grad, ...treat].map((r) => ({ id: r.id, presetIdentity: manifests.get(r.id)!.presetIdentity, censusEvery: CADENCE })));
  checkHorizonIdentity(spots.map((r) => ({ id: r.id, presetIdentity: manifests.get(r.id)!.presetIdentity, censusEvery: CADENCE })));
  if (grad.length < 2) throw new Error(`STOP: ${grad.length} envelope runs found, the envelope needs ${v0.envelope.length}`);

  // Fresh runs: manifest, launch log, preset identity, then the whole stream on its own. A failure is "not loaded".
  const freshFailed: { id: string; reason: string }[] = [];
  const loaded: NullRun[] = [];
  const envIdentity = manifests.get(grad[0].id)!.presetIdentity;
  const freshHave = have(fresh);
  for (const [i, r] of freshHave.entries()) {
    try {
      const m = checkExactManifest(r, await Deno.readTextFile(`${dirOf(r)}/manifest.json`), HORIZON);
      if (m.presetIdentity !== envIdentity) throw new Error(`${r.id}: presetIdentity ${m.presetIdentity} differs from the envelope's ${envIdentity}`);
      const lp = launchProblem(launchLog, `null-${r.seed}`);
      if (lp) throw new Error(`${r.id}: ${lp}`);
      await checkCensusStream(r.id, strict(r.id, dirOf(r)), HORIZON_CENSUSES, CADENCE, true);
      loaded.push(r);
    } catch (e) {
      freshFailed.push({ id: r.id, reason: errMsg(e) });
      console.log(`  not loaded: ${errMsg(e)}`);
    }
    if ((i + 1) % 10 === 0) console.log(`  fresh runs checked: ${i + 1}/${freshHave.length}`);
  }
  console.log(`fresh runs: ${loaded.length} loaded, ${freshFailed.length} failed, ${fresh.length - freshHave.length} missing`);

  // Scoring passes in lockstep: gradient-m3 (envelope, treatment, fresh) and spots-m3.
  const entries: NullEntry[] = [];
  const pass = async (label: string, env: NullRun[], others: NullRun[]) => {
    const p = planNull(env.map((r) => r.id), others.map((r) => r.id));
    const runs = [...env, ...others];
    const scorer = newNullScorer(p);
    console.log(`${label}: ${runs.length} runs, envelope ${env.length}, ${p.scorings.length} scorings`);
    await lockstepNull(runs, scorer, label);
    scorer.results().forEach((res, k) => entries.push(nullEntry(runs[k], res)));
  };
  async function lockstepNull(runs: NullRun[], scorer: BellScorer, label: string) {
    const gens = runs.map((r) => (r.set === "fresh" ? strict : merged)(r.id, dirOf(r)));
    const ext = runs.map(() => new SignalExtractor());
    try {
      for (let c = 0; c < HORIZON_CENSUSES; c++) {
        const nexts = await Promise.all(gens.map((g, i) => g.next().catch((e) => {
          const msg = errMsg(e);
          throw new Error(msg.includes(runs[i].id) ? msg : `${runs[i].id}: ${msg}`);
        })));
        const ended = nexts.findIndex((n) => !!n.done);
        if (ended >= 0) throw new Error(`lockstep: ${runs[ended].id} ended after ${c} censuses, the horizon is ${HORIZON_CENSUSES}`);
        scorer.push(nexts.map((n, i) => {
          const { rec, rows } = n.value as { rec: Record<string, unknown> & { step: number }; rows: [string, number][] };
          return { step: rec.step, values: ext[i].push(rec, rows) };
        }));
        if (scorer.censuses % 1000 === 0) console.log(`  ${label}: ${scorer.censuses} censuses`);
      }
    } finally {
      await Promise.allSettled(gens.map((g) => g.return(undefined)));
    }
  }
  await pass("gradient-m3", grad, [...treat, ...loaded]);
  if (spots.length >= 2) await pass("spots-m3", spots, []);

  const summary = summarizeNull(entries, { complete, freshFailed });
  const called = nullCalled(summary);
  const recordPath = a.record ?? defaultRecord("null", complete || called);
  const refusal = recordRefusal1(await readOrNull(recordPath), { scored: entries.length, force: !!a.force });
  if (refusal) throw new Error(`STOP: not writing ${recordPath}: ${refusal}`);
  const record = {
    rule: "anomaly-bell-v1-null",
    version: BELL1_VERSION,
    note: NOTE1_PATH,
    complete,
    called,
    missing,
    parameters: { ...parameters, launchLog: launchLogInfo(fresh.map((r) => `null-${r.seed}`)), primary: PRIMARY, burnInStep: BURN_IN_STEP, horizonSteps: HORIZON, horizonCensuses: HORIZON_CENSUSES, rule: "D >= Z rings; D11 = max D over the eleven kept signals, D13 = over all thirteen (v0)" },
    corpus: {
      presetIdentity: envIdentity,
      envelope: grad.map((r) => r.id),
      spots: spots.map((r) => r.id),
      treatment: treat.map((r) => r.id),
      freshLoaded: loaded.map((r) => r.id),
    },
    summary,
    runs: entries,
  };
  await writeAtomic(recordPath, JSON.stringify(record, null, 1) + "\n");

  console.log("");
  console.log(`anomaly bell v1, part A${complete ? "" : " (INCOMPLETE: A1 is called only on a whole fresh and envelope corpus; reported items missing runs are not called)"}; Z=${PRIMARY.Z}, W=${PRIMARY.W}, horizon ${HORIZON}`);
  const A1 = summary.A1;
  console.log(`  A1 (at most ${A1.maxRings} of ${70} fresh runs ring, 11 signals): ${A1.status}; ${A1.k} of ${A1.n} ring, upper95 ${f3(A1.upper95)}${A1.reason ? ` (${A1.reason})` : ""}`);
  console.log(`  reading: ${A1.reading}`);
  const r = summary.reported;
  const rs = (x: { called: boolean; reason?: string }) => (x.called ? "" : ` [not called: ${x.reason}]`);
  console.log(`  reported: v1 rule on v0's 70 (leave-one-out): gradient ${cnt(r.v1OnV0.gradient)}, spots ${cnt(r.v1OnV0.spots)}, total ${cnt(r.v1OnV0.total)} (upper95 ${f3(r.v1OnV0.total.upper95)})${rs(r.v1OnV0)}`);
  console.log(`            v0's 13-signal rule on the fresh runs: ${cnt(r.v0RuleOnFresh)} (upper95 ${f3(r.v0RuleOnFresh.upper95)})${rs(r.v0RuleOnFresh)}`);
  console.log(`            treatment against the 40: v1 rule rings ${cnt(r.treatment.rings11)}, 13-signal rule ${cnt(r.treatment.rings13)}, effect vs neutral ${f3(r.treatment.effect11)}${rs(r.treatment)}`);
  console.log(`            calibrated Z*=${f3(r.calibrated.zStar)} (largest 13-signal D among the 40): fresh above ${cnt(r.calibrated.fresh)}, treatment above ${cnt(r.calibrated.treatment)}${rs(r.calibrated)}`);
  for (const e of entries.filter((x) => x.set === "fresh" && (x.ring11 || x.ring13))) {
    console.log(`  fresh ${e.id}: D11 ${f3(e.D11)}, D13 ${f3(e.D13)}${e.firstRing13 ? `, first ring ${e.firstRing13.signal} ${e.firstRing13.side} at ${e.firstRing13.startStep}-${e.firstRing13.endStep}` : ""}`);
  }
  console.log(`record: ${recordPath}`);
}

// =============================================================================================
// Part B.

async function runTwins() {
  let tp: TwinsPlan;
  if (a.plan !== undefined) {
    tp = JSON.parse(await Deno.readTextFile(a.plan)) as TwinsPlan;
    if (!tp || !Number.isInteger(tp.S) || !Number.isInteger(tp.steps) || !Array.isArray(tp.bases) || !Array.isArray(tp.twins)) throw new Error(`--plan ${a.plan}: need S, steps, bases and twins`);
  } else {
    const nudgePath = a.nudges ?? "experiments/naturalist/bell-v1-nudges.json";
    const nudges = parseNudgeFile(await Deno.readTextFile(nudgePath).catch((e) => {
      throw new Error(`cannot read the nudge centres ${nudgePath} (${(e as Error).message}); tools/bell-v1-launch.ts writes them`);
    }));
    tp = defaultTwinsPlan(runsRoot, baseRoot, nudges);
  }
  const N = tp.steps / CADENCE;
  if (!Number.isInteger(N) || N <= 0) throw new Error(`steps ${tp.steps} is not a whole number of censuses`);
  if (tp.S + EARLY_TO + (W_PAIR - 1) * CADENCE > tp.steps) throw new Error(`S ${tp.S} leaves no room for the early windows within ${tp.steps} steps`);

  // Bases: any problem stops.
  const missingBase = [];
  for (const b of tp.bases) if (!(await hasBundle(b.dir))) missingBase.push(b.id);
  if (missingBase.length) throw new Error(`STOP: ${missingBase.length} base bundle(s) missing (first: ${missingBase[0]}); every base is needed for the spread`);
  const baseIdentity: string[] = [];
  for (const b of tp.bases) {
    const m = checkBaseManifest(b, await Deno.readTextFile(`${b.dir}/manifest.json`), tp.steps);
    baseIdentity.push(m.presetIdentity);
    const ivs = b.spreadOnly ? [] : parseInterventions((await readOrNull(`${b.dir}/interventions.jsonl`)) ?? "");
    if (ivs.length) throw new Error(`STOP: base ${b.id} holds ${ivs.length} intervention(s); a base must have none`);
  }
  checkHorizonIdentity(tp.bases.map((b, i) => ({ id: b.id, presetIdentity: baseIdentity[i], censusEvery: CADENCE })));

  // Twins: checks that need no stream.
  type Pre = { missing?: boolean; manifest?: string | null; launch?: string | null; interventions?: string | null };
  const pre: Pre[] = [];
  const matter: (number | null)[] = [];
  const missingTwin: string[] = [];
  for (const t of tp.twins) {
    const p: Pre = {};
    let m: number | null = null;
    if (!(await hasBundle(t.dir))) {
      p.missing = true;
      missingTwin.push(t.id);
    } else {
      p.manifest = twinManifestProblem(t, await Deno.readTextFile(`${t.dir}/manifest.json`), tp.steps, baseIdentity[t.base]);
      p.launch = launchProblem(launchLog, t.id);
      const text = await readOrNull(`${t.dir}/interventions.jsonl`);
      p.interventions = interventionProblem(t.job as Job, text);
      try {
        const e = parseInterventions(text ?? "")[0];
        m = e && typeof e.matter === "number" ? e.matter : null;
      } catch {
        m = null;
      }
    }
    pre.push(p);
    matter.push(m);
  }
  if (missingTwin.length && !allowIncomplete) {
    throw new Error(`STOP: ${missingTwin.length} of ${tp.twins.length} twin directories are missing (first: ${missingTwin[0]}); --allow-incomplete reports them as void and calls only the criteria that do not need them`);
  }
  const complete = missingTwin.length === 0;

  // Lockstep: bases and twins together. A twin whose manifest failed is not streamed; a twin stream that fails is dropped, not fatal.
  const baseGens = tp.bases.map((b) => merged(b.id, b.dir));
  type Reader = { gen: ReturnType<typeof merged> | null; dead: string | null; n: number };
  const readers: Reader[] = tp.twins.map((t, i) => {
    const skip = pre[i].missing ? "bundle missing" : pre[i].manifest ? "not read: manifest check failed" : null;
    return { gen: skip ? null : strict(t.id, t.dir), dead: skip, n: 0 };
  });
  const scorer = new PairScorer(tp.S, tp.bases.length, tp.twins.map((t) => ({ id: t.id, arm: t.arm, seed: t.seed, base: t.base })));
  const nextTwin = async (rd: Reader): Promise<TwinInput> => {
    if (rd.dead !== null || rd.gen === null) return { fail: rd.dead ?? "no stream" };
    try {
      const n = await rd.gen.next();
      if (n.done) {
        rd.dead = `ended after ${rd.n} censuses, expected ${N}`;
        return { fail: rd.dead };
      }
      rd.n++;
      return n.value as Census;
    } catch (e) {
      rd.dead = errMsg(e);
      await rd.gen.return(undefined).catch(() => {});
      return { fail: rd.dead };
    }
  };
  console.log(`${tp.bases.length} bases, ${tp.twins.length} twins (${readers.filter((r) => r.gen).length} readable), ${N} censuses, S ${tp.S}`);
  try {
    for (let c = 0; c < N; c++) {
      const [bn, tn] = await Promise.all([
        Promise.all(baseGens.map((g, i) => g.next().catch((e) => {
          const msg = errMsg(e);
          throw new Error(msg.includes(tp.bases[i].id) ? msg : `${tp.bases[i].id}: ${msg}`);
        }))),
        Promise.all(readers.map(nextTwin)),
      ]);
      const ended = bn.findIndex((n) => !!n.done);
      if (ended >= 0) throw new Error(`lockstep: base ${tp.bases[ended].id} ended after ${c} censuses, the horizon is ${N}`);
      scorer.push(bn.map((n) => n.value as Census), tn);
      if (scorer.censuses % 500 === 0) console.log(`  ${scorer.censuses} censuses`);
    }
    // A twin must have exactly N censuses: one more read must find its stream finished.
    for (const [i, rd] of readers.entries()) {
      if (rd.dead !== null || rd.gen === null) continue;
      try {
        const n = await rd.gen.next();
        if (!n.done) scorer.fail(i, `more than ${N} censuses`);
      } catch (e) {
        scorer.fail(i, errMsg(e));
      }
    }
  } finally {
    await Promise.allSettled([...baseGens, ...readers.map((r) => r.gen).filter((g) => g !== null)].map((g) => g!.return(undefined)));
  }

  const results = scorer.results();
  const outcomes: TwinOutcome[] = results.map((r, i) => judgeTwin(r, tp.S, pre[i], matter[i]));
  const summary = summarizeTwins(outcomes, { S: tp.S, complete });
  const { twins: twinReports, ...rest } = summary;
  const called = twinsCalled(summary);
  const recordPath = a.record ?? defaultRecord("twins", complete || called);
  const refusal = recordRefusal1(await readOrNull(recordPath), { scored: outcomes.length, force: !!a.force });
  if (refusal) throw new Error(`STOP: not writing ${recordPath}: ${refusal}`);
  const record = {
    rule: "anomaly-bell-v1-twins",
    version: BELL1_VERSION,
    note: NOTE1_PATH,
    complete,
    called,
    missing: missingTwin,
    testPlan: a.plan !== undefined ? a.plan : undefined,
    parameters: {
      ...parameters,
      launchLog: launchLogInfo(tp.twins.map((t) => t.id)),
      S: tp.S,
      steps: tp.steps,
      censuses: N,
      W_pair: W_PAIR,
      earlyWindowFirstCensus: [tp.S + EARLY_FROM, tp.S + EARLY_TO],
      dose: `at S + ${CADENCE}: livingCells, and matter = ${MATTER_CHANNELS.join("+")} of the series pools (E and S are energy), twin and base and twin - base; interventionMatter is the intervention log's own matter field`,
      rule: "z = (twin - base) / spread over the bases at t; D_pair = max over signals and sides of the window minimum of side*z, floored at 0; hit iff D > Z*_pair (strict)",
    },
    bases: tp.bases.map((b, i) => ({ id: b.id, presetIdentity: baseIdentity[i] })),
    summary: rest,
    twins: twinReports,
  };
  await writeAtomic(recordPath, JSON.stringify(record, null, 1) + "\n");

  console.log("");
  console.log(`anomaly bell v1, part B${complete ? "" : " (INCOMPLETE: missing twins are void, only the criteria that need them are not called)"}; S=${tp.S}, W_pair=${W_PAIR}, windows starting ${tp.S + EARLY_FROM}..${tp.S + EARLY_TO}`);
  const zp = summary.zStarPair;
  console.log(`  Z*_pair = ${zp.called ? f3(zp.value) : `not called (provisional max ${f3(zp.provisional)}; no hits are marked from it)`} over ${zp.n} valid nudge twins; nudge median D ${f3(summary.nudge.medianD)}; first differences ${summary.nudge.firstDiffSteps.join(", ")}`);
  for (const [arm, r] of Object.entries(summary.arms)) {
    console.log(`  ${arm}: ${r.valid} valid (void seeds ${r.voidSeeds.join(",") || "none"}); above Z* ${r.hits ? cnt(r.hits) : "n/a"}; median D ${f3(r.medianD)}; P(D > nudge) ${f3(r.effectVsNudge.effect)}`);
  }
  const crit = (name: string, c: { called: boolean; met: boolean | null; k: number | null; n: number; bound95: number | null; reason?: string }) =>
    console.log(`  ${name}: ${c.called ? (c.met ? "met" : "missed") : "not called"}; ${c.k ?? "n/a"} of ${c.n}; 95% bound ${f3(c.bound95)}${c.reason ? ` (${c.reason})` : ""}`);
  crit("B2 L96", summary.B2.l96);
  crit("B2 F", summary.B2.f);
  crit("B2 L64 (reported)", summary.B2_l64);
  crit("B3 nudge2", summary.B3);
  console.log(`  reading: ${summary.reading}${summary.armsMet.length === 1 ? `: ${summary.armsMet[0]}` : ""}`);
  for (const t of twinReports) {
    console.log(`  ${t.id}: ${t.valid ? "valid" : `VOID (${t.voidReasons.join("; ")})`}; D ${f3(t.D)} ${t.signal ?? ""} ${t.side ?? ""}; hit ${t.hit}; first window above ${t.firstWindowAboveZ ?? "-"}; first diff ${t.firstDiffStep ?? "-"}; cells ${t.dose.livingCells.base}->${t.dose.livingCells.twin} (${t.dose.livingCells.delta}); matter ${t.dose.matter.base}->${t.dose.matter.twin} (${t.dose.matter.delta}); logged ${t.dose.interventionMatter ?? "-"}`);
  }
  console.log(`record: ${recordPath}`);
}
