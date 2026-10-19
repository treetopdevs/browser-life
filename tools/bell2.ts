// The anomaly bell, v2 (docs/naturalist-bell-v2-2026-10-18.md, "Fixed before running"): v1's twin bell on part A's eleven signals,
// scored on twins forked from fresh bases. CPU only, streaming, no model calls. Logic in tools/lib/bell2.ts (v1's PairScorer and
// summarizeTwins in tools/lib/bell1.ts are reused); this file reads bundles, runs the pair scorer in lockstep and writes the record.
//
//   deno run -A tools/bell2.ts twins --runs <v2 runs root> --launch-log <runs>/bell-v2-launch/jobs.jsonl
//       [--nudges experiments/naturalist/bell-v2-nudges.json] [--v1-record experiments/naturalist/bell-v1-twins.json]
//       [--pilot experiments/naturalist/bell-v2-pilot.json] [--record <file>] [--allow-incomplete] [--force]
//
//   --runs        the root tools/bell2-launch.ts ran into (bell-v2-base/... and bell-v2-twins-<arm>/...), not the repo's runs/
//   --launch-log  required: a base or twin counts only if the log lists its job with exit 0 (the last line for an id wins)
//   --nudges      the seeds, replacements and nudge centres the launcher wrote (default experiments/naturalist/bell-v2-nudges.json)
//   --v1-record   v1's committed twins record, for the post-hoc reading the note reproduces (provenance in the record)
//   --pilot       the pilot record (its rates, projection and wall time go into the record's run facts, with its SHA-256)
//   --record      default experiments/naturalist/bell-v2-twins.json, or bell-v2-twins.incomplete.json when a bundle the launch did
//                 not plan to leave out is missing and nothing is called; written atomically. A complete, called record is never
//                 replaced without --force.
//   --allow-incomplete  score when bundles the launch did not plan to leave out are missing (they are void; only criteria that do not
//                 need them are called)
//
// The launcher's launch.jsonl (beside --launch-log) must show the main run over: its last launch closed with a final stop. Bundles the
// launch planned to leave out are void with the reason, never "missing": an arm the scale-down dropped (L64; the run stays complete),
// and, after a final stop that is not "finished" (the cap, or a failed base or sham), every job that did not run (the run is then
// incomplete). Every launch's events (heartbeats left out) and its elapsed budget go into the record.
//
// Bases are checked first, each read end to end: manifest (spec, start at 0, summary at 206,000, the checkpoint at C listed and its
// file decoding to a state at C with the listed hash), exit 0 in the launch log, no interventions, exactly 2,060 censuses each passing
// v1's strict census rule. A base that fails is left out of the spread and its six twins are void. Then the 10 bases and the 60 twins
// are read together, 2,060 censuses: a twin's input at steps <= C is its base's census, after it the fork's (Stitch). Every twin's
// validity follows the note; the readout is summarizeTwins2.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { decodeCheckpoint, stateHash } from "@bl/schema";
import { lineageCensuses } from "./lib/bundle.ts";
import { replayCheck } from "./lib/propose-fs.ts";
import { SIGNALS, mergeCensuses, parseSeries, splitLines } from "./lib/bell.ts";
import { CADENCE, EARLY_FROM, EARLY_TO, MATTER_CHANNELS, PairScorer, W_PAIR, checkCensusStream, checkHorizonIdentity, launchCoverage, launchProblem, parseInterventions, parseLaunchLog, recordRefusal1, strictCensuses, type Census } from "./lib/bell1.ts";
import {
  CLOSING_EVENTS,
  BASE_CENSUSES,
  BASE_EXPERIMENT,
  BASE_STEPS,
  BELL2_VERSION,
  C,
  KEEP,
  absenceOf,
  budgetUsed,
  N_BASES,
  NOTE2_PATH,
  S,
  Stitch,
  Z1,
  baseManifestProblem,
  defaultRecord2,
  forkJob,
  forkManifestProblem,
  interventionProblem2,
  judge2,
  launchState,
  lineageRowsCheck,
  parseLaunchEvents,
  runLaunches,
  parseNudgeFile2,
  pickSeeds,
  ReplacementsExhausted,
  planBases,
  planBigTwins,
  planNudgeTwins,
  planShams,
  posthocV1,
  relOf,
  summarizeTwins2,
  twins2Called,
  windowSpan,
  type Arm2,
  type Job2,
  type Pre2,
} from "./lib/bell2.ts";

const a = parseArgs(Deno.args, {
  string: ["runs", "launch-log", "nudges", "v1-record", "pilot", "record"],
  boolean: ["allow-incomplete", "force"],
  default: { nudges: "experiments/naturalist/bell-v2-nudges.json", "v1-record": "experiments/naturalist/bell-v1-twins.json", pilot: "experiments/naturalist/bell-v2-pilot.json" },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
for (const k of ["runs", "launch-log", "nudges", "v1-record", "pilot", "record"] as const) if (a[k] === "") throw new Error(`--${k} needs a path`);
if (String(a._[0] ?? "") !== "twins" || a._.length !== 1) throw new Error(`usage: bell2.ts twins --runs <root> --launch-log <jobs.jsonl> (got ${a._.map(String).join(" ") || "nothing"})`);
if (!a.runs || !a["launch-log"]) throw new Error("--runs and --launch-log are needed");
const runsRoot = a.runs.replace(/\/+$/, "");
const allowIncomplete = !!a["allow-incomplete"];

// ---------------------------------------------------------------------------------------------
// File helpers (as tools/bell1.ts).

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
function seriesRecords(id: string, dir: string) {
  return (async function* () {
    const file = await Deno.open(`${dir}/series.jsonl`);
    yield* parseSeries(id, splitLines(file.readable.pipeThrough(new TextDecoderStream())));
  })();
}
const strict = (id: string, dir: string) => strictCensuses(id, mergeCensuses(id, seriesRecords(id, dir), lineageCensuses(dir)));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
let writes = 0;
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
/**
 * A base's livingCells at its census at S, from series.jsonl alone. undefined: the base was never launched (no jobs.jsonl line), so
 * the walk stops; null: launched but no readable census at S (a base that failed, or was moved aside after failing twice), so it
 * stays and fails its checks.
 */
async function livingAtS(seed: number): Promise<number | null | undefined> {
  const dir = `${runsRoot}/${relOf(BASE_EXPERIMENT, seed)}`;
  if (!(await exists(`${dir}/series.jsonl`))) return launchLog.has(`base-${seed}`) ? null : undefined;
  const it = seriesRecords(`base-${seed}`, dir);
  try {
    for await (const rec of it) {
      if (rec.step === S) return typeof rec.livingCells === "number" && Number.isFinite(rec.livingCells) ? rec.livingCells : null;
      if (rec.step > S) return null;
    }
  } catch {
    return null;
  } finally {
    await it.return(undefined);
  }
  return null;
}
async function* fileLines(p: string): AsyncGenerator<string> {
  const f = await Deno.open(p);
  let pending = "";
  for await (const chunk of f.readable.pipeThrough(new TextDecoderStream())) {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop()!;
    yield* parts;
  }
  if (pending) yield pending;
}
/** The byte-level replay check of a fork against its base over (C, through]: series lines and lineage rows. Null when both hold. */
async function bytesProblem(baseDir: string, dir: string, through: number): Promise<string | null> {
  const rc = await replayCheck(`${baseDir}/series.jsonl`, `${dir}/series.jsonl`, C, through, CADENCE).catch((e) => ({ ok: false, detail: errMsg(e) }));
  if (!rc.ok) return `series.jsonl over (${C}, ${through}]: ${rc.detail}`;
  const lr = await lineageRowsCheck(fileLines(`${baseDir}/lineages.tsv`), fileLines(`${dir}/lineages.tsv`), C, through);
  if (!lr.ok) return `lineages.tsv over (${C}, ${through}]: ${lr.detail}`;
  return null;
}
async function dirBytes(dir: string): Promise<number> {
  let n = 0;
  try {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) n += await dirBytes(p);
      else if (e.isFile) n += (await Deno.stat(p)).size;
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Inputs.

const launchText = await Deno.readTextFile(a["launch-log"]).catch((e) => {
  throw new Error(`cannot read --launch-log ${a["launch-log"]} (${(e as Error).message})`);
});
const launchLog = parseLaunchLog(launchText);
// Nothing is scored in between (the note): the main run's last launch must have closed with a final stop.
const launchDir = a["launch-log"].includes("/") ? a["launch-log"].slice(0, a["launch-log"].lastIndexOf("/")) : ".";
const launchEvents = parseLaunchEvents((await readOrNull(`${launchDir}/launch.jsonl`)) ?? "");
const lstate = launchState(launchEvents);
if (!lstate.over) {
  const ls = runLaunches(launchEvents);
  throw new Error(`STOP: ${launchDir}/launch.jsonl does not show the main run over (${ls.length} launches; the last closed by ${JSON.stringify(ls[ls.length - 1]?.close ?? null)}); nothing is scored in between`);
}
const finished = lstate.finished;
const launchLines = launchText.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
/** Each job's last jobs.jsonl line (exit, and whether the cap killed it). */
const lastLine = new Map<string, { exit: number; timeout?: boolean }>();
for (const l of launchLines) if (typeof l.id === "string" && typeof l.exit === "number") lastLine.set(l.id, { exit: l.exit, timeout: l.timeout === true });
/** Why a job's bundle is absent when the launch accounts for it, or null (missing): per job, from its own history (absenceOf). */
/** The launch-log check, and a last attempt killed at the cap (timeout: true) never counts, even when its child exited 0. */
const launchProblem2 = (id: string): string | null => (lastLine.get(id)?.timeout === true ? `launch log: ${id} was killed at the cap (timeout: true)` : launchProblem(launchLog, id));
const plannedAbsent = (id: string, arm: string): string | null =>
  absenceOf(arm, lastLine.get(id), { droppedWhy: lstate.droppedWhy, finished, stopReason: lstate.stop?.reason === undefined ? null : String(lstate.stop.reason) });
const pilotText = await readOrNull(a.pilot);
const pilotFacts = pilotText === null ? null : (() => {
  const p = JSON.parse(pilotText);
  return { path: a.pilot, rates: p.rates ?? null, projection: p.projection ?? null, wallSeconds: p.wallSeconds ?? null, mechanicsOk: p.mechanicsOk ?? null, checks: Array.isArray(p.checks) ? p.checks.length : null, at: p.at ?? null };
})();
const pilotSha = pilotText === null ? null : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pilotText))), (x) => x.toString(16).padStart(2, "0")).join("");
/** The run facts every record carries (the launches, their events and budget, the pilot's facts, the jobs). */
const runFactsOf = () => ({
  pilot: pilotFacts === null ? null : { ...pilotFacts, sha256: pilotSha },
  // Every main-run launch: its id, the cumulative budget it reached (seconds, the pilot's included) and how it closed.
  launches: runLaunches(launchEvents).map((l) => ({ launch: l.launch, budgetSeconds: l.maxElapsed, close: l.close })),
  budgetSeconds: budgetUsed(launchEvents, pilotFacts?.wallSeconds ?? 0),
  // The launch events (start, plan, waits, attempts, asides, replacements, drops, stops), heartbeats left out.
  events: launchEvents.filter((e) => e.event !== "heartbeat"),
  closingEvents: CLOSING_EVENTS,
  jobs: launchLines,
});
/**
 * A final stop before the shams' nudge file, or before every base ran (the cap, or a failed base), or fewer than two valid bases:
 * nothing can be scored, and the readout is "not called (incomplete)" (plain "not called" when the run finished). The record says so,
 * with the run facts, and the scorer ends.
 */
async function stopRecord(why: string, extra: Record<string, unknown> = {}): Promise<never> {
  const recordPath = a.record ?? defaultRecord2(true);
  const old = await readOrNull(recordPath);
  if (old !== null && !a.force) throw new Error(`STOP: not writing ${recordPath}: it exists (pass --force to replace it, or choose another --record)`);
  const record = {
    rule: "anomaly-bell-v2-twins",
    version: BELL2_VERSION,
    note: NOTE2_PATH,
    complete: false,
    called: false,
    reading: finished ? "not called" : "not called (incomplete)",
    why,
    ...extra,
    launch: { finished, stop: lstate.stop, dropped: lstate.droppedWhy },
    runFacts: runFactsOf(),
  };
  await writeAtomic(recordPath, JSON.stringify(record, null, 1) + "\n");
  console.log(`anomaly bell v2: ${finished ? "not called" : "not called (incomplete)"}: ${why}`);
  console.log(`record: ${recordPath}`);
  Deno.exit(0);
}
const nudgeText = await readOrNull(a.nudges);
if (nudgeText === null) {
  if (!finished) await stopRecord(`the launch stopped before the nudge file was written (${String(lstate.stop?.reason)})`);
  throw new Error(`STOP: cannot read the nudge file ${a.nudges}; tools/bell2-launch.ts writes it after the shams`);
}
const nudgeFile = parseNudgeFile2(nudgeText);
// The seeds the dead-base rule gives, re-derived from the bases' own series, must be the launcher's.
const derived = await pickSeeds(livingAtS).catch((e) => (e instanceof ReplacementsExhausted ? stopRecord(`the replacement seeds are used up (${e.message})`) : Promise.reject(e)));
if (derived.pending !== null) {
  if (!finished) await stopRecord(`the launch stopped before base seed ${derived.pending} ran (${String(lstate.stop?.reason)})`);
  throw new Error(`STOP: base seed ${derived.pending} has no series.jsonl, so the base seeds cannot be re-derived`);
}
if (JSON.stringify(derived.seeds) !== JSON.stringify(nudgeFile.seeds) || JSON.stringify(derived.replacements) !== JSON.stringify(nudgeFile.replacements))
  throw new Error(`STOP: the dead-base rule gives seeds ${derived.seeds.join(",")} (replacements ${JSON.stringify(derived.replacements)}), the nudge file says ${nudgeFile.seeds.join(",")} (${JSON.stringify(nudgeFile.replacements)})`);
const seeds = derived.seeds;
const v1Record = JSON.parse(await Deno.readTextFile(a["v1-record"]));
const posthoc = posthocV1(v1Record);

// ---------------------------------------------------------------------------------------------
// Bases.

interface BaseState {
  job: Job2;
  dir: string;
  problem: string | null;
  presetIdentity: string | null;
  /** Index among the valid bases (the scorer's base), or -1. */
  idx: number;
}
const bases: BaseState[] = [];
for (const job of planBases(seeds)) {
  const dir = `${runsRoot}/${job.rel}`;
  const b: BaseState = { job, dir, problem: null, presetIdentity: null, idx: -1 };
  bases.push(b);
  try {
    if (!(await hasBundle(dir))) throw new Error(plannedAbsent(job.id, "base") ?? "bundle missing");
    const m = baseManifestProblem(job, await Deno.readTextFile(`${dir}/manifest.json`));
    if ("problem" in m) throw new Error(m.problem);
    b.presetIdentity = m.presetIdentity;
    const lp = launchProblem2(job.id);
    if (lp) throw new Error(lp);
    const ip = interventionProblem2(job, await readOrNull(`${dir}/interventions.jsonl`));
    if (ip) throw new Error(ip);
    const { state } = decodeCheckpoint(await Deno.readFile(`${dir}/${m.checkpoint.file}`));
    if (state.step !== C) throw new Error(`${m.checkpoint.file} holds step ${state.step}, not ${C}`);
    const h = stateHash(state);
    if (h !== m.checkpoint.hash) throw new Error(`${m.checkpoint.file} hashes to ${h}, the manifest says ${m.checkpoint.hash}`);
    await checkCensusStream(job.id, strict(job.id, dir), BASE_CENSUSES, CADENCE, true);
  } catch (e) {
    b.problem = errMsg(e);
    console.log(`  base ${job.id} VOID: ${b.problem}`);
  }
}
const valid = bases.filter((b) => b.problem === null);
valid.forEach((b, i) => (b.idx = i));
if (valid.length < 2) {
  await stopRecord(`${valid.length} valid bases; the spread needs at least two`, {
    corpus: { seeds, replacements: derived.replacements, nudgeFailed: nudgeFile.failed, bases: bases.map((b) => ({ id: b.job.id, seed: b.job.seed, valid: b.problem === null, ...(b.problem ? { reason: b.problem } : {}) })) },
  });
}
checkHorizonIdentity(valid.map((b) => ({ id: b.job.id, presetIdentity: b.presetIdentity!, censusEvery: CADENCE })));
console.log(`bases: ${valid.length} of ${bases.length} valid (seeds ${seeds.join(", ")}${derived.replacements.length ? `; replacements ${derived.replacements.map((r) => `${r.seed}->${r.replacedBy}`).join(", ")}` : ""})`);

// ---------------------------------------------------------------------------------------------
// Twins.

const failedNudge = new Map(nudgeFile.failed.map((f) => [f.seed, f.reason]));
const twinJobs: Job2[] = [
  ...planShams(seeds),
  ...planBigTwins(seeds),
  ...planNudgeTwins(seeds.filter((s) => !failedNudge.has(s)), nudgeFile.centres),
  ...seeds.filter((s) => failedNudge.has(s)).flatMap((s) => (["nudge", "nudge2"] as const).map((arm) => forkJob(arm, s, null))),
];
const baseOf = new Map(bases.map((b) => [b.job.seed, b]));
const pre: Pre2[] = [];
const matter: (number | null)[] = [];
const stitches: Stitch[] = [];
const missing: string[] = [];
for (const t of twinJobs) {
  const dir = `${runsRoot}/${t.rel}`;
  const b = baseOf.get(t.seed)!;
  const p: Pre2 = {};
  let m: number | null = null;
  let dead: string | null = null;
  if ((t.arm === "nudge" || t.arm === "nudge2") && failedNudge.has(t.seed)) p.interventions = `no nudge centre: ${failedNudge.get(t.seed)}`;
  if (b.problem !== null) {
    p.base = b.problem;
    dead = "its base is void";
  }
  if (!(await hasBundle(dir))) {
    const why = plannedAbsent(t.id, t.arm);
    if (why === null) {
      p.missing = true;
      missing.push(t.id);
    } else p.notRun = why;
    dead ??= why ?? "bundle missing";
  } else {
    p.manifest = b.presetIdentity === null ? null : forkManifestProblem(t, await Deno.readTextFile(`${dir}/manifest.json`), b.presetIdentity);
    if (p.manifest) dead ??= "not read: manifest check failed";
    p.launch = launchProblem2(t.id);
    if (b.problem === null && !p.manifest) p.replay = await bytesProblem(b.dir, dir, t.arm === "sham" ? BASE_STEPS : S);
    const text = await readOrNull(`${dir}/interventions.jsonl`);
    if (!p.interventions) p.interventions = interventionProblem2(t, text);
    try {
      const e = parseInterventions(text ?? "")[0];
      m = e && typeof e.matter === "number" ? e.matter : null;
    } catch {
      m = null;
    }
  }
  pre.push(p);
  matter.push(m);
  stitches.push(dead === null ? new Stitch(strict(t.id, dir)) : new Stitch(null, C, CADENCE, dead));
}
const missingBases = bases.filter((b) => b.problem === "bundle missing").map((b) => b.job.id);
if ((missing.length || missingBases.length) && !allowIncomplete) {
  throw new Error(`STOP: ${missing.length + missingBases.length} expected bundles are missing (first: ${missingBases[0] ?? missing[0]}); --allow-incomplete reports them as void and calls only what does not need them`);
}
const complete = finished && missing.length === 0 && missingBases.length === 0;

// ---------------------------------------------------------------------------------------------
// Lockstep.

const baseGens = valid.map((b) => strict(b.job.id, b.dir));
const scorer = new PairScorer(S, valid.length, twinJobs.map((t) => ({ id: t.id, arm: t.arm, seed: t.seed, base: Math.max(0, baseOf.get(t.seed)!.idx) })));
console.log(`${valid.length} bases, ${twinJobs.length} twins (${stitches.filter((s) => s.failure === null).length} readable), ${BASE_CENSUSES} censuses, S ${S}, fork step ${C}`);
try {
  for (let c = 0; c < BASE_CENSUSES; c++) {
    const step = (c + 1) * CADENCE;
    const bn = await Promise.all(baseGens.map((g, i) => g.next().catch((e) => {
      const msg = errMsg(e);
      throw new Error(msg.includes(valid[i].job.id) ? msg : `${valid[i].job.id}: ${msg}`);
    })));
    const ended = bn.findIndex((n) => !!n.done);
    if (ended >= 0) throw new Error(`lockstep: base ${valid[ended].job.id} ended after ${c} censuses, expected ${BASE_CENSUSES}`);
    const bc = bn.map((n) => n.value as Census);
    const tn = await Promise.all(stitches.map((s, i) => {
      const b = baseOf.get(twinJobs[i].seed)!;
      return s.next(step, b.idx >= 0 ? bc[b.idx] : bc[0]);
    }));
    scorer.push(bc, tn);
    if (scorer.censuses % 500 === 0) console.log(`  ${scorer.censuses} censuses`);
  }
  for (const [i, s] of stitches.entries()) {
    const f = await s.finish();
    if (f) scorer.fail(i, f);
  }
} finally {
  await Promise.allSettled([...baseGens.map((g) => g.return(undefined)), ...stitches.map((s) => s.close())]);
}

// ---------------------------------------------------------------------------------------------
// Readout.

const r11 = scorer.results(KEEP), r13 = scorer.results();
const o11 = r11.map((r, i) => judge2(r, twinJobs[i].arm as Arm2, pre[i], matter[i]));
const o13 = r13.map((r, i) => judge2(r, twinJobs[i].arm as Arm2, pre[i], matter[i]));
// A final stop that was not "finished" gates every criterion (the note: "not called (incomplete)"), whatever the twins that ran show.
const summary = summarizeTwins2(o11, o13, { complete, dropped: lstate.droppedWhy, stopped: finished ? null : String(lstate.stop?.reason) });
const { twins: twinReports, ...rest } = summary;
const called = twins2Called(summary);
// Official unless a bundle the launch did not plan to leave out is missing and nothing is called.
const recordPath = a.record ?? defaultRecord2((missing.length === 0 && missingBases.length === 0) || called);
const refusal = recordRefusal1(await readOrNull(recordPath), { scored: o11.length, force: !!a.force });
if (refusal) throw new Error(`STOP: not writing ${recordPath}: ${refusal}`);
const disk: Record<string, number> = {};
for (const b of bases) disk[b.job.id] = await dirBytes(b.dir);
for (const t of twinJobs) disk[t.id] = await dirBytes(`${runsRoot}/${t.rel}`);
const ids = [...bases.map((b) => b.job.id), ...twinJobs.map((t) => t.id)];
const record = {
  rule: "anomaly-bell-v2-twins",
  version: BELL2_VERSION,
  note: NOTE2_PATH,
  complete,
  called,
  missing: [...missingBases, ...missing],
  launch: { finished, stop: lstate.stop, dropped: lstate.droppedWhy },
  parameters: {
    signals: SIGNALS.map((s) => ({ name: s.name, kind: s.kind, floor: s.floor, source: s.source, inRule: KEEP(s.name) })),
    S,
    C,
    censuses: BASE_CENSUSES,
    ...windowSpan,
    earlyWindowFirstCensus: [S + EARLY_FROM, S + EARLY_TO],
    W_pair: W_PAIR,
    Z1,
    dose: `at S + ${CADENCE}: livingCells, and matter = ${MATTER_CHANNELS.join("+")} of the series pools, twin and base and twin - base; interventionMatter is the intervention log's own matter field`,
    rule: "z = (twin - base) / spread over the valid v2 bases at t; D11 = max over the eleven signals and both sides of the counted windows' minimum side*z, floored at 0; hit iff D11 > Z*2 (strict); Z*2 = the largest D11 among the 10 nudge twins",
    input: `a twin's census at steps <= ${C} is its base's (the fork starts there); from ${C + CADENCE} on, the fork's`,
    launchLog: { path: a["launch-log"], entries: launchLog.size, ...launchCoverage(launchLog, ids), reruns: launchLines.filter((l) => l.rerun === true).map((l) => l.id) },
  },
  corpus: {
    seeds,
    replacements: derived.replacements,
    nudgeFailed: nudgeFile.failed,
    bases: bases.map((b) => ({ id: b.job.id, seed: b.job.seed, presetIdentity: b.presetIdentity, valid: b.problem === null, ...(b.problem ? { reason: b.problem } : {}) })),
    spreadBases: valid.length,
    expectedBases: N_BASES,
  },
  posthocV1: { record: a["v1-record"], ...posthoc },
  runFacts: {
    ...runFactsOf(),
    diskBytes: Object.values(disk).reduce((x, y) => x + y, 0),
    bundleBytes: disk,
  },
  summary: rest,
  twins: twinReports,
};
await writeAtomic(recordPath, JSON.stringify(record, null, 1) + "\n");

const f3 = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? "n/a" : x.toFixed(d));
const crit = (name: string, c: { called: boolean; met: boolean | null; k: number | null; n: number; bound95: number | null; reason?: string }) =>
  console.log(`  ${name}: ${c.called ? (c.met ? "met" : "missed") : "not called"}; ${c.k ?? "n/a"} of ${c.n}; 95% bound ${f3(c.bound95)}${c.reason ? ` (${c.reason})` : ""}`);
console.log("");
console.log(`anomaly bell v2${complete ? "" : " (INCOMPLETE)"}; S=${S}, C=${C}, W_pair=${W_PAIR}, eleven signals`);
console.log(`  R (replay): ${summary.R.called ? (summary.R.met ? "met" : `MISSED (${summary.R.differ.map((d) => `seed ${d.seed} at ${d.step}`).join(", ")})`) : `not called (${summary.R.reason})`}`);
const zp = summary.primary.zStarPair;
console.log(`  Z*2 = ${zp.called ? f3(zp.value) : `not called (provisional ${f3(zp.provisional)})`} over ${zp.n} valid nudge twins`);
for (const [arm, r] of Object.entries(summary.primary.arms)) console.log(`  ${arm}: ${r.valid} valid (void ${r.voidSeeds.join(",") || "none"}); above Z*2 ${r.hits ? `${r.hits.k}/${r.hits.of}` : "n/a"}; median D11 ${f3(r.medianD)}; P(D > nudge) ${f3(r.effectVsNudge.effect)}`);
crit("B2 L96", summary.primary.B2.l96);
crit("B2 F", summary.primary.B2.f);
crit("B2 L64 (reported)", summary.primary.B2_l64);
crit("B3 nudge2", summary.primary.B3);
console.log(`  reading: ${summary.primary.reading}${summary.primary.armsMet.length === 1 ? `: ${summary.primary.armsMet[0]}` : ""}`);
console.log(`  at Z1 = ${f3(Z1, 4)} (reported): L96 ${summary.atZ1.B2.l96.k}, F ${summary.atZ1.B2.f.k}, L64 ${summary.atZ1.B2_l64.k}, nudge ${summary.atZ1.B3.nudge.k}, nudge2 ${summary.atZ1.B3.nudge2.k}; reading: ${summary.atZ1.reading}`);
const v = summary.v1Rule13;
console.log(`  v1's 13-signal rule (reported): Z*13 ${f3(v.zStarPair.value)}; L96 ${v.B2.l96.k}, F ${v.B2.f.k}, nudge2 ${v.B3.k}; v1 reading: ${v.reading}${v.gated ? ` [${v.gated}]` : ""}`);
for (const t of twinReports) console.log(`  ${t.id}: ${t.valid ? "valid" : `VOID (${t.voidReasons.join("; ")})`}; D11 ${f3(t.D)} ${t.signal ?? ""} ${t.side ?? ""}; hit ${t.hit}; D13 ${f3(t.D13)}; first above ${t.firstWindowAboveZ ?? "-"}; first diff ${t.firstDiffStep ?? "-"}; cells ${t.dose.livingCells.base}->${t.dose.livingCells.twin}`);
console.log(`record: ${recordPath}`);
