// Launches the anomaly bell v2's GPU runs (docs/naturalist-bell-v2-2026-10-18.md, "Fixed before running", "Cap, pilot, scale-down"),
// serially, through tools/run.ts. Plan, checks, the cap arithmetic and the launch-log rules in tools/lib/bell2.ts.
//
//   deno run -A tools/bell2-launch.ts pilot --root <abs dir> [--record experiments/naturalist/bell-v2-pilot.json] [--dry-run]
//   deno run -A tools/bell2-launch.ts run   --root <abs dir> [--pilot experiments/naturalist/bell-v2-pilot.json]
//       [--nudges experiments/naturalist/bell-v2-nudges.json] [--deadline-hours 5] [--resume] [--dry-run]
//
// pilot: seed 3900 only (never scored): a base of 16,000 steps with a checkpoint at 10,000, a sham fork from 10,000 for 6,000 steps
//   (checkpoint at 15,000), then an L96 fork, an F fork and a nudge fork (r = 1 at the centre read from the sham's checkpoint), each
//   at 15,000. It measures the steps per second of a base and of a fork and the fixed cost per job, checks the fork mechanics (the sham
//   equals the base over (10,000, 16,000], series and lineage rows; each other fork equals it over (10,000, 15,000], and L96 and F
//   differ after; the manifests and interventions have the shape the scorer checks; the sham's checkpoint decodes and hashes to its
//   entry), projects the main run and picks the scale-down mode. It writes --record, with its wall time (the first part of the one
//   budget). Its own hard cap is PILOT_CAP_HOURS. Exit 1 when a check fails.
// run: the main run, in the fixed order: bases 3901-3910 (a base dead at S is replaced by the next seed from 3911, judged from its
//   series alone, before any of its twins run); the shams; the nudge centres (each from the sham's checkpoint at S, after the sham
//   passes its replay check over (C, 206,000], R's whole horizon, series and lineage rows), written to --nudges (an existing file that disagrees stops the
//   launch); then TWIN_ORDER (L96, F, nudge, nudge2, L64). If a base or a sham fails, R cannot be met: the nudge file is written and
//   the run stops (final) before any other twin. The pilot record must exist with its mechanics passed.
//
// The cap is one budget, CAP_HOURS (or --deadline-hours, lower) of wall time over the pilot and every launch of the main run together:
// each launch's clock starts where the budget stood (budgetUsed; the pilot's launches likewise share its own PILOT_CAP_HOURS, and the
// main run starts from the pilot's whole ledger, which the pilot record must close: pilotLedger). A launch killed without a closing
// event is charged a heartbeat, or, if it was killed while a child ran, through that child's alarm (orphanEndElapsed: the budget is
// then spent); while such a child still runs no launch starts. Every child runs under perl's alarm (it survives exec) set to the cap plus 90 s, so
// it cannot outlive a SIGKILLed launcher by more than that. A job starts only if its projected end fits (jobSeconds: the pilot's
// rates, or the slowest job of its kind seen so far in the main run, times 1.25), and a running job is killed at the cap (logged
// timeout: true, moved aside); the run then stops, final. The mode (full, drop-l64, stop-at-cap) is decided once, at the first launch;
// the stop in the L64 phase at the cap is that arm dropped, not an incomplete run. A final stop ends the main run: no later launch.
//
// Both modes: --root must be absolute, outside the repo's runs/ (main checkout and this one), with no symlink below it on any path the
// launcher writes, leaf files (jobs.jsonl, launch.jsonl, the lock, <id>.log/.err) included. A lock file <root>/bell-v2-launch/lock keeps two launches off one root (released on exit, on an uncaught error and
// on SIGINT/SIGTERM, which also stop the running child first). At least 2 GB must be free under the root. Before each job, `ps` is
// checked for another GPU user (tools/lib/bell2.ts gpuUsers); while one runs the launcher waits, polling every 60 s, and the wait
// counts toward the cap. A job that exits nonzero is rerun once, blind: its directory and logs are moved to <root>/bell-v2-launch/aside/
// first, never deleted. Every attempt logs "attempt-start" to launch.jsonl before it is spawned (an interrupted attempt counts as one);
// every finished attempt appends (on SIGINT/SIGTERM only one whose child had already exited 0 on its own) {id, exit, seconds, load1, uptime, waitedSeconds, rerun, startedAt[, timeout]} to jobs.jsonl
// (tools/bell2.ts reads it), with stdout/stderr in <id>.log / <id>.err. Every launch.jsonl event carries the launch id, the mode and the
// cumulative elapsed seconds; a heartbeat every 60 s bounds what a killed launch leaves uncounted.
// --resume: a destination that jobs.jsonl records with exit 0 and whose manifest passes the scorer's manifest check is skipped; one left
// by an interrupted attempt (started, no jobs.jsonl line, no live tools/run.ts for it) is moved aside and counted; any other existing
// destination stops the launch (move it by hand). Without --resume every destination must be absent.
// --dry-run: print the plan and the commands (each runs as `perl -e <alarm, exec> <seconds> deno run ...`); run nothing, write nothing.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { CH, decodeCheckpoint, stateHash } from "@bl/schema";
import { replayCheck } from "./lib/propose-fs.ts";
import { nearestBiomass } from "./lib/bell-v1-jobs.ts";
import {
  BASE_EXPERIMENT,
  BASE_STEPS,
  C,
  CAP_HOURS,
  HEARTBEAT_SECONDS,
  MIN_FREE_BYTES,
  NOTE2_PATH,
  NUDGE_TARGETS,
  PILOT,
  PILOT_CAP_HOURS,
  PILOT_SEED,
  S,
  TWIN_ORDER,
  attemptsOf,
  baseArgs,
  baseManifestProblem,
  baseSeeds,
  budgetUsed,
  cleanExit,
  forkArgs,
  forkManifestProblem,
  gpuUsers,
  reducedCommand,
  interventionProblem2,
  jobOfId,
  orphanAttempt,
  jobProblems2,
  jobSeconds,
  launchState,
  lineageRowsCheck,
  liveRunOf,
  mayStart,
  nudgeFileText,
  orphanEndElapsed,
  otherLaunchers,
  parseLaunchEvents,
  pickSeeds,
  pilotLedger,
  pilotArgs,
  pilotJobs,
  pilotNudge,
  planBases,
  planBigTwins,
  planNudgeTwins,
  planShams,
  relOf,
  replacementSeeds,
  ReplacementsExhausted,
  runLaunches,
  scaleDown,
  shamCheckpoint,
  unfinishedAttempts,
  type Job2,
  type JobLine,
  type LaunchEvent,
  type NudgeCentres2,
  type NudgeEntry2,
  type PilotRates,
  type ScaleMode,
} from "./lib/bell2.ts";

const a = parseArgs(Deno.args, {
  string: ["root", "record", "pilot", "nudges", "deadline-hours"],
  boolean: ["dry-run", "resume"],
  default: { record: "experiments/naturalist/bell-v2-pilot.json", pilot: "experiments/naturalist/bell-v2-pilot.json", nudges: "experiments/naturalist/bell-v2-nudges.json", "deadline-hours": String(CAP_HOURS) },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
const mode = String(a._[0] ?? "");
if ((mode !== "pilot" && mode !== "run") || a._.length !== 1) throw new Error("usage: bell2-launch.ts pilot|run --root <abs dir>");
if (!a.root || !a.root.startsWith("/")) throw new Error("--root must be an absolute path");
const root = a.root.replace(/\/+$/, "");
// No "." or ".." segment and no empty one: the path checked below is the path written to.
if (root.split("/").slice(1).some((seg) => seg === "" || seg === "." || seg === "..")) throw new Error(`--root ${a.root} must be a normalized absolute path (no ".", ".." or empty segments)`);
const dry = !!a["dry-run"];
const deadlineHours = Number(a["deadline-hours"]);
if (!(deadlineHours > 0 && deadlineHours <= CAP_HOURS)) throw new Error(`--deadline-hours ${a["deadline-hours"]} must be in (0, ${CAP_HOURS}]`);
if (mode === "pilot" && a.resume) throw new Error("--resume is for the run");
/** This launch's cap, hours of the one budget: the pilot's own, or the main run's. */
const capHours = mode === "pilot" ? PILOT_CAP_HOURS : deadlineHours;

// ---------------------------------------------------------------------------------------------
// Helpers.

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
};
const readOrNull = (p: string) => Deno.readTextFile(p).catch((e) => (e instanceof Deno.errors.NotFound ? null : Promise.reject(e)));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A command's stdout; a nonzero exit throws (fail closed: an unreadable `ps` is never taken for an idle GPU). */
async function sh(cmd: string, args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`${cmd} ${args.join(" ")} exited ${out.code}: ${new TextDecoder().decode(out.stderr).trim()}`);
  return new TextDecoder().decode(out.stdout);
}
const ps = () => sh("ps", ["-axo", "pid=,command="]);
const uptime = async () => (await sh("uptime", [])).trim();
const load1 = (u: string): number | null => {
  const m = /load averages?:\s*([\d.]+)/.exec(u);
  return m ? Number(m[1]) : null;
};
/** Bytes free on the filesystem holding `p` (its nearest existing ancestor). */
async function freeBytes(p: string): Promise<number> {
  let d = p;
  while (!(await exists(d))) d = d.slice(0, d.lastIndexOf("/")) || "/";
  const lines = (await sh("df", ["-k", d])).trim().split("\n");
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const kb = Number(cols[3]);
  if (!Number.isFinite(kb)) throw new Error(`df -k ${d}: cannot read the available space`);
  return kb * 1024;
}
/** perl -e program: alarm(first argument), then exec the rest (execvp, no shell). The pending alarm survives exec. */
const ALARM_EXEC = 'alarm shift @ARGV; exec { $ARGV[0] } @ARGV or die "exec $ARGV[0]: $!\\n"';
async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}
/** Refuses a path below the root that runs through a symlink (a link could redirect writes into the repo's runs/). */
async function noSymlinkBelowRoot(p: string) {
  if (p !== root && !p.startsWith(root + "/")) throw new Error(`STOP: ${p} is not under --root ${root}`);
  let cur = root;
  for (const seg of p.slice(root.length).split("/").filter(Boolean)) {
    cur += "/" + seg;
    let st: Deno.FileInfo;
    try {
      st = await Deno.lstat(cur);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return; // nothing below exists yet: the launcher or the runner creates it
      throw e;
    }
    if (st.isSymlink) throw new Error(`STOP: ${cur} is a symlink; v2 writes only to real directories under --root`);
  }
}

// The repo's runs/ directories (this checkout's and the main checkout's) are read-only for v2.
{
  const common = (await sh("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  const forbidden = [`${Deno.cwd()}/runs`, ...(common ? [`${common.replace(/\/\.git\/?$/, "")}/runs`] : [])];
  let real = root;
  try {
    let d = root;
    while (!(await exists(d))) d = d.slice(0, d.lastIndexOf("/")) || "/";
    real = (await Deno.realPath(d)) + root.slice(d.length);
  } catch { /* keep the given path */ }
  for (const f of forbidden) {
    const rf = await Deno.realPath(f).catch(() => f);
    if (real === rf || real.startsWith(rf + "/") || root === f || root.startsWith(f + "/")) throw new Error(`STOP: --root ${root} is inside ${f}; v2 only reads the repo's runs/`);
  }
}

// One bell v2 launcher per machine (whatever its root): two would each see the other's idle moments and spawn together. Only deno
// processes count (a wrapper shell whose command text names this script is not a launcher).
{
  const others = otherLaunchers(await ps(), Deno.pid);
  if (others.length && !dry) throw new Error(`STOP: another bell v2 launcher is running (${others.join(", ")}); one at a time`);
}

const logDir = `${root}/bell-v2-launch`;
const jobsLog = `${logDir}/jobs.jsonl`;
const launchLog = `${logDir}/launch.jsonl`;
await noSymlinkBelowRoot(logDir);
// Every file the launcher writes under the log directory, leaf included: a planted link must not redirect a truncate or an append.
for (const f of [jobsLog, launchLog, `${logDir}/lock`]) await noSymlinkBelowRoot(f);
const launchId = `${Deno.pid}-${Date.now()}`;
const prior: LaunchEvent[] = parseLaunchEvents((await readOrNull(launchLog)) ?? "");
const jobLines: JobLine[] = ((await readOrNull(jobsLog)) ?? "").split("\n").map((l, i) => [l, i] as const).filter(([l]) => l.trim()).map(([l, i]) => {
  try {
    return JSON.parse(l) as JobLine;
  } catch (e) {
    throw new Error(`STOP: ${jobsLog} line ${i + 1} is not JSON (${errMsg(e)}; a launcher killed mid-write?); move the line aside by hand`);
  }
});

// The main run's pilot record and the budget it has already used.
const pilotRecord: { rule?: string; mechanicsOk?: boolean; rates?: PilotRates; wallSeconds?: number; root?: string; launch?: string } | null = mode === "run" ? JSON.parse((await readOrNull(a.pilot)) ?? "null") : null;
/** The pilot's share of the one budget: its whole ledger (every pilot launch), not only the record's wall time. */
let pilotUsed = 0;
if (mode === "run") {
  if (pilotRecord === null && !dry) throw new Error(`STOP: no pilot record at ${a.pilot}; run the pilot first`);
  if (pilotRecord !== null && (pilotRecord.rule !== "anomaly-bell-v2-pilot" || pilotRecord.mechanicsOk !== true || !pilotRecord.rates || typeof pilotRecord.wallSeconds !== "number")) {
    throw new Error(`STOP: the pilot record ${a.pilot} has no passed mechanics, rates and wall time`);
  }
  if (pilotRecord !== null) {
    // The record is bound to the pilot ledger it came from (its root's launch.jsonl): it must be that ledger's last pilot launch,
    // closed, and the main run starts from the ledger's whole time. A pilot ledger in this root that is not the record's is refused.
    const pilotRoot = typeof pilotRecord.root === "string" ? pilotRecord.root : "";
    if (!pilotRoot.startsWith("/")) throw new Error(`STOP: the pilot record ${a.pilot} names no absolute root`);
    const pilotEvents = pilotRoot === root ? prior : parseLaunchEvents((await readOrNull(`${pilotRoot}/bell-v2-launch/launch.jsonl`)) ?? "");
    if (pilotRoot !== root && runLaunches(prior, "pilot").length) throw new Error(`STOP: ${launchLog} holds pilot launches, but the pilot record ${a.pilot} ran in ${pilotRoot}; one pilot ledger only`);
    const pl = pilotLedger(pilotEvents, pilotRecord.launch, pilotRecord.wallSeconds!);
    if (pl.problem && !dry) throw new Error(`STOP: the pilot record ${a.pilot} does not close its ledger ${pilotRoot}/bell-v2-launch/launch.jsonl (${pl.problem})`);
    pilotUsed = pl.used;
  }
  const st = launchState(prior);
  if (st.over) throw new Error(`STOP: the main run is over (final stop: ${String(st.stop?.reason)}); the budget is one, so nothing resumes after it`);
}
/** Exit codes recorded by earlier attempts, the last one per job, and the attempts each job has had (a blind rerun is once, across launches). */
const recorded = new Map<string, number>();
for (const l of jobLines) recorded.set(l.id, l.exit);
const attempts = attemptsOf(prior, jobLines);
const unfinished = unfinishedAttempts(prior, jobLines);

// A launch killed without a closing event (SIGKILL) can leave its tools/run.ts running. Nothing records when that child ended (a stalled
// one can stop writing long before it dies), so the budget charges it through its perl alarm (orphanEndElapsed: the cap plus 90 s),
// and nothing starts while it still runs. Checked before this launch logs anything, so its own events never hide the dead launch.
let orphanEnd: number | null = null;
{
  const dead = orphanAttempt(prior, jobLines, mode === "run" ? "run" : "pilot");
  const job = dead ? jobOfId(dead.id) : null;
  if (dead && job) {
    const live = liveRunOf(await ps(), job);
    if (live.length && !dry) throw new Error(`STOP: launch ${dead.launch} was killed while ${dead.id} ran, and its tools/run.ts is still running (${live.join(", ")}); stop it first`);
    orphanEnd = orphanEndElapsed(prior, dead.launch, dead.id, dead.attempt);
    if (orphanEnd === null) throw new Error(`STOP: launch ${dead.launch} was killed while ${dead.id} ran, and its attempt-start has no elapsed and alarm to charge it by`);
  }
}
const usedAtStart = mode === "run" ? budgetUsed(prior, pilotUsed, "run", orphanEnd) : budgetUsed(prior, 0, "pilot", orphanEnd);
const t0 = performance.now() - usedAtStart * 1000;
/** Cumulative seconds of the budget (the pilot: of its own cap, over every pilot launch). */
const elapsed = () => (performance.now() - t0) / 1000;
const capSeconds = capHours * 3600;
const eventLine = (e: Record<string, unknown>) => JSON.stringify({ at: new Date().toISOString(), elapsed: Math.round(elapsed()), mode, launch: launchId, ...e }) + "\n";
const event = async (e: Record<string, unknown>) => {
  if (!dry) await Deno.writeTextFile(launchLog, eventLine(e), { append: true });
  if (e.event !== "heartbeat") console.log(`[${Math.round(elapsed())}s] ${JSON.stringify(e)}`);
};
const eventSync = (e: Record<string, unknown>) => {
  try {
    if (!dry) Deno.writeTextFileSync(launchLog, eventLine(e), { append: true });
  } catch { /* the log is gone: nothing more to record */ }
};

/**
 * The tools/run.ts child running now (stopped first on a signal or an uncaught error), and a promise attempt() resolves once it has
 * written the attempt's jobs.jsonl line or decided not to (the signal handler waits on it before it exits).
 */
let current: { child: Deno.ChildProcess; settled: Promise<void> } | null = null;
function stopChildSync() {
  if (!current) return;
  try {
    current.child.kill("SIGTERM");
  } catch { /* already exited */ }
}
let heartbeat: ReturnType<typeof setInterval> | null = null;
/** Set by the signal handler before it stops the child: attempt() then writes nothing (the attempt stays unfinished, and counts). */
let interrupting = false;

if (!dry) {
  await Deno.mkdir(logDir, { recursive: true });
  const lockPath = `${logDir}/lock`;
  try {
    await Deno.writeTextFile(lockPath, JSON.stringify({ pid: Deno.pid, launch: launchId, mode, started: new Date().toISOString() }) + "\n", { createNew: true });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) throw new Error(`STOP: ${lockPath} exists: another launch holds this root (remove it by hand if that launch is dead)`);
    throw e;
  }
  const unlock = () => {
    try {
      Deno.removeSync(lockPath);
    } catch { /* already gone */ }
  };
  // Deno.exit fires unload; an uncaught throw (every STOP below) fires unhandledrejection or error, not unload.
  globalThis.addEventListener("unload", unlock);
  const onUncaught = (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason ?? (e as ErrorEvent).error;
    stopChildSync();
    eventSync({ event: "error", message: errMsg(reason) });
    unlock();
  };
  globalThis.addEventListener("unhandledrejection", onUncaught);
  globalThis.addEventListener("error", onUncaught);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    Deno.addSignalListener(sig, async () => {
      interrupting = true;
      const cur = current;
      if (cur) {
        try {
          cur.child.kill("SIGTERM");
        } catch { /* already exited */ }
        const killer = setTimeout(() => {
          try {
            cur.child.kill("SIGKILL");
          } catch { /* exited */ }
        }, 30_000);
        await cur.settled;
        clearTimeout(killer);
      }
      eventSync({ event: "interrupted", signal: sig });
      unlock();
      Deno.exit(130);
    });
  }
  // The deadline's backstop: tools/run.ts runs under perl's alarm, which survives exec (same pid, deno's argv in ps), so a child
  // outlives a SIGKILLed launcher by at most the cap plus 90 s.
  await sh("perl", ["-e", "1"]).catch((e) => {
    throw new Error(`STOP: perl is needed for the deadline backstop (${errMsg(e)})`);
  });
  const free = await freeBytes(root);
  if (free < MIN_FREE_BYTES) throw new Error(`STOP: ${(free / 1e9).toFixed(2)} GB free under ${root}; the note needs at least ${MIN_FREE_BYTES / 1e9} GB at launch`);
  await event({ event: "start", pid: Deno.pid, freeBytes: free, uptime: await uptime(), capHours, usedAtStart: Math.round(usedAtStart) });
  heartbeat = setInterval(() => eventSync({ event: "heartbeat" }), HEARTBEAT_SECONDS * 1000);
}
/** Ends the launch: a final stop closes the main run for good (the pilot's stop is never final for the run). */
async function finish(reason: string, final: boolean, extra: Record<string, unknown> = {}, code = 0): Promise<never> {
  if (heartbeat !== null) clearInterval(heartbeat);
  await event({ event: "stop", reason, final, ...extra, freeBytes: dry ? null : await freeBytes(root), uptime: await uptime() });
  Deno.exit(code);
}

/** The slowest finished main-run job of each kind so far (seconds), for the projection: the pilot's young world can overstate the rate. */
const observedMax: Record<"base" | "fork", number | null> = { base: null, fork: null };
const observe = (id: string, seconds: number) => {
  if (mode !== "run" || id.endsWith(`-${PILOT_SEED}`)) return;
  const k = id.startsWith("base-") ? "base" : "fork";
  observedMax[k] = Math.max(observedMax[k] ?? 0, seconds);
};
for (const l of jobLines) if (l.exit === 0 && l.timeout !== true && typeof l.seconds === "number") observe(l.id, l.seconds);

/** Whether a job of this kind may start now: the main run's projection, or (the pilot) only that the cap has not passed. */
const fits = (rates: PilotRates | null, kind: "base" | "fork", at = elapsed()) => (rates ? mayStart(at, rates, kind, capHours, observedMax[kind]) : at < capSeconds);

/** Waits while another GPU user runs. Returns the seconds waited, or null when the cap would pass while waiting. */
async function waitForGpu(kind: "base" | "fork", rates: PilotRates | null): Promise<number | null> {
  const w0 = performance.now();
  for (;;) {
    const users = gpuUsers(await ps(), [Deno.pid]);
    if (!users.length) return (performance.now() - w0) / 1000;
    if (!fits(rates, kind, elapsed() + 60)) return null;
    console.log(`  waiting for another GPU user: ${users.map((u) => `${u.pid} ${u.command.slice(0, 120)}`).join(" | ")}`);
    await event({ event: "gpu-wait", users: users.map((u) => ({ pid: u.pid, command: reducedCommand(u.command) })) });
    await sleep(60_000);
  }
}

/**
 * One attempt of tools/run.ts with these arguments; logs attempt-start before the spawn and appends its line to jobs.jsonl after.
 * `mayGo` is checked last, immediately before the spawn: when it fails nothing is spawned or logged and "deadline" is returned. A child
 * still running at the cap is killed (SIGTERM, then SIGKILL after 30 s) and its line says timeout: true.
 */
async function attempt(job: Job2, args: string[], waited: number, rerun: boolean, mayGo: () => boolean): Promise<{ exit: number; seconds: number; timeout: boolean } | "deadline"> {
  const startedAt = new Date().toISOString();
  const u = await uptime();
  await noSymlinkBelowRoot(`${root}/${job.rel}`);
  for (const ext of ["log", "err"]) await noSymlinkBelowRoot(`${logDir}/${job.id}.${ext}`);
  const out = await Deno.open(`${logDir}/${job.id}.log`, { write: true, create: true, truncate: true });
  const err = await Deno.open(`${logDir}/${job.id}.err`, { write: true, create: true, truncate: true });
  if (!mayGo()) {
    out.close();
    err.close();
    return "deadline";
  }
  const n = (attempts.get(job.id) ?? 0) + 1;
  // perl's alarm is the backstop if this launcher dies (SIGKILL) before its own timer below kills the child at the cap. Logged with the
  // attempt: a later launch charges an orphaned child through it (orphanEndElapsed).
  const alarm = Math.max(1, Math.ceil(capSeconds - elapsed()) + 90);
  await event({ event: "attempt-start", id: job.id, attempt: n, rerun, alarmSeconds: alarm });
  attempts.set(job.id, n);
  const t = performance.now();
  const child = new Deno.Command("perl", { args: ["-e", ALARM_EXEC, String(alarm), "deno", "run", "--no-lock", "-A", "tools/run.ts", ...args], stdout: "piped", stderr: "piped" }).spawn();
  let settle!: () => void;
  current = { child, settled: new Promise<void>((r) => (settle = r)) };
  let timedOut = false;
  let killer: ReturnType<typeof setTimeout> | null = null;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch { /* exited */ }
    killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* exited */ }
    }, 30_000);
  }, Math.max(0, (capSeconds - elapsed()) * 1000));
  let code: number, signal: Deno.Signal | null;
  try {
    await Promise.all([child.stdout.pipeTo(out.writable), child.stderr.pipeTo(err.writable)]);
    ({ code, signal } = await child.status);
  } catch (e) {
    settle();
    throw e;
  }
  clearTimeout(timer);
  if (killer !== null) clearTimeout(killer);
  // A signal is stopping the launcher, and its handler owns the exit. A child that had finished cleanly on its own (exit 0, no signal;
  // tools/run.ts has no signal handler, so one our SIGTERM stopped never looks like this) is recorded; anything else writes nothing, so
  // a --resume finds the attempt unfinished and counts it.
  const clean = code === 0 && signal === null && !timedOut;
  if (interrupting && !clean) {
    settle();
    await new Promise<never>(() => {});
  }
  const seconds = Math.round((performance.now() - t) / 1000);
  const line = { id: job.id, launch: launchId, attempt: n, exit: code, seconds, load1: load1(u), uptime: u, waitedSeconds: Math.round(waited), rerun, startedAt, ...(timedOut ? { timeout: true } : {}) };
  try {
    // Synchronous, so the handler's exit cannot land between a partial write and its end.
    Deno.writeTextFileSync(jobsLog, JSON.stringify(line) + "\n", { append: true });
  } finally {
    settle();
  }
  if (interrupting) await new Promise<never>(() => {});
  current = null;
  jobLines.push(line);
  recorded.set(job.id, code);
  if (timedOut) attempts.set(job.id, n - 1); // the cap, not the job, ended it
  else if (code === 0) observe(job.id, seconds);
  console.log(`${job.id}: exit ${code} in ${seconds}s${rerun ? " (rerun)" : ""}${timedOut ? " (killed at the cap)" : ""}`);
  return { exit: code, seconds, timeout: timedOut };
}
/** Moves a failed attempt's directory and logs aside (never deletes them). */
async function moveAside(job: Job2, dest: string, why: string) {
  const aside = `${logDir}/aside/${job.id}-${Date.now()}`;
  await noSymlinkBelowRoot(aside);
  await noSymlinkBelowRoot(dest);
  await Deno.mkdir(aside, { recursive: true });
  if (await exists(dest)) await Deno.rename(dest, `${aside}/bundle`);
  for (const ext of ["log", "err"]) if (await exists(`${logDir}/${job.id}.${ext}`)) await Deno.rename(`${logDir}/${job.id}.${ext}`, `${aside}/${job.id}.${ext}`);
  await event({ event: "moved-aside", id: job.id, to: aside, why });
}
/**
 * Runs a job (GPU check, cap, one blind rerun). Returns "ok", "failed" (nonzero twice) or "deadline" (not started because its projected
 * end would pass the cap, or killed at the cap). `rates` null: the pilot, held only to its own cap.
 */
async function runJob(job: Job2, args: string[], rates: PilotRates | null): Promise<"ok" | "failed" | "deadline"> {
  const dest = `${root}/${job.rel}`;
  while ((attempts.get(job.id) ?? 0) < 2) {
    if (!fits(rates, job.kind)) return "deadline";
    const waited = await waitForGpu(job.kind, rates);
    if (waited === null) return "deadline";
    // Checked again inside attempt(), immediately before the spawn: the wait, the poll and the log setup may have used the margin.
    const r = await attempt(job, args, waited, (attempts.get(job.id) ?? 0) > 0, () => fits(rates, job.kind));
    if (r === "deadline") return "deadline";
    if (r.timeout) {
      await moveAside(job, dest, "killed at the cap");
      return "deadline";
    }
    if (r.exit === 0) return "ok";
    await moveAside(job, dest, `exit ${r.exit}`);
  }
  return "failed";
}
const lines = async function* (p: string) {
  const f = await Deno.open(p);
  let pending = "";
  for await (const chunk of f.readable.pipeThrough(new TextDecoderStream())) {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop()!;
    yield* parts;
  }
  if (pending) yield pending;
};
/** The B channel of a checkpoint's state and the world size (for the nudge centres). */
function biomass(state: ReturnType<typeof decodeCheckpoint>["state"]) {
  const W = state.cfg.tileW * state.cfg.tilesX, H = state.cfg.tileH * state.cfg.tilesY, n = W * H;
  return { W, H, B: state.cells.subarray(CH.B * n, (CH.B + 1) * n) };
}

// =============================================================================================
// Pilot.

if (mode === "pilot") {
  const { base, sham, l96, f } = pilotJobs();
  const baseDir = `${root}/${base.rel}`;
  const fixed: [Job2, string[]][] = [[base, pilotArgs(base, root)], [sham, pilotArgs(sham, root, baseDir)], [l96, pilotArgs(l96, root, baseDir)], [f, pilotArgs(f, root, baseDir)]];
  const nudgeRel = pilotNudge({ x: 0, y: 0 }).rel;
  for (const rel of [...fixed.map(([j]) => j.rel), nudgeRel]) if (await exists(`${root}/${rel}`)) throw new Error(`STOP: ${root}/${rel} exists; the pilot runs into an empty root`);
  if (await exists(a.record)) throw new Error(`STOP: ${a.record} exists; a pilot record is never replaced (move it by hand, or pass another --record)`);
  if (dry) {
    for (const [, args] of fixed) console.log(["deno", "run", "--no-lock", "-A", "tools/run.ts", ...args].join(" "));
    console.log("(then the nudge fork: r = 1 at the centre read from the sham's checkpoint at 15,000)");
    Deno.exit(0);
  }
  const before = await uptime();
  const times: Record<string, { exit: string; seconds: number | null; stepsPerSecond: number | null; summarySteps: number | null }> = {};
  const checks: { name: string; ok: boolean; required: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string, required = true) => checks.push({ name, ok, required, ...(detail ? { detail } : {}) });
  const runOne = async (j: Job2, args: string[]) => {
    const r = await runJob(j, args, null);
    const last = jobLines.filter((l) => l.id === j.id).pop();
    const m = JSON.parse((await readOrNull(`${root}/${j.rel}/manifest.json`)) ?? "{}");
    times[j.id] = { exit: r, seconds: last?.seconds ?? null, stepsPerSecond: m.summary?.stepsPerSecond ?? null, summarySteps: m.summary?.steps ?? null };
    return r === "ok";
  };
  let nudge: Job2 | null = null;
  let allRan = true;
  for (const [j, args] of fixed) {
    if (!(await runOne(j, args))) {
      allRan = false;
      break;
    }
    if (j === sham) {
      // The nudge centre, read from the sham's checkpoint at 15,000 the way the main run reads it at S.
      const ck = shamCheckpoint(await Deno.readTextFile(`${root}/${sham.rel}/manifest.json`), PILOT.S);
      if (!ck) {
        check("sham checkpoint at 15,000 listed", false);
        allRan = false;
        break;
      }
      const { state } = decodeCheckpoint(await Deno.readFile(`${root}/${sham.rel}/${ck.file}`));
      const h = stateHash(state);
      check("sham checkpoint at 15,000 decodes to its step with the listed hash", state.step === PILOT.S && h === ck.hash, `step ${state.step}, hash ${h} vs ${ck.hash}`);
      const { W, H, B } = biomass(state);
      const c = nearestBiomass(B, W, H, NUDGE_TARGETS.nudge[0], NUDGE_TARGETS.nudge[1]);
      check("a nudge centre can be found in it", c !== null, JSON.stringify(c));
      if (c) nudge = pilotNudge(c);
    }
  }
  if (allRan && nudge) allRan = await runOne(nudge, pilotArgs(nudge, root, baseDir));
  const after = await uptime();

  // Mechanics.
  const forks = [sham, l96, f, ...(nudge ? [nudge] : [])];
  const dirOf = (j: Job2) => `${root}/${j.rel}`;
  allRan = allRan && nudge !== null && Object.values(times).length === 5 && Object.values(times).every((t) => t.exit === "ok");
  check("all five pilot jobs exited 0", allRan, JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v.exit]))));
  let rates: PilotRates | null = null;
  if (allRan) {
    const bm = baseManifestProblem(base, await Deno.readTextFile(`${baseDir}/manifest.json`), { steps: PILOT.baseSteps, C: PILOT.C });
    check("base manifest", !("problem" in bm), "problem" in bm ? bm.problem : undefined);
    const identity = "problem" in bm ? "" : bm.presetIdentity;
    const opts = { steps: PILOT.forkSteps, C: PILOT.C, shamCheckpointStep: PILOT.S };
    for (const j of forks) {
      const mp = forkManifestProblem(j, await Deno.readTextFile(`${dirOf(j)}/manifest.json`), identity, opts);
      check(`${j.arm} manifest (startStep, no initHash, summary at 16,000, base identity, ${j.arm === "sham" ? "one checkpoint at 15,000" : "no checkpoint"})`, mp === null, mp ?? undefined);
      const ip = interventionProblem2(j, await readOrNull(`${dirOf(j)}/interventions.jsonl`));
      check(`${j.arm} holds ${j.expected ? `exactly its ${j.expected.kind} at 15,000` : "no interventions"}`, ip === null, ip ?? undefined);
    }
    const rs = await replayCheck(`${baseDir}/series.jsonl`, `${dirOf(sham)}/series.jsonl`, PILOT.C, PILOT.baseSteps, 100);
    check("sham series equals the base's over (10000, 16000]", rs.ok && rs.compared === 60, JSON.stringify(rs));
    const ls = await lineageRowsCheck(lines(`${baseDir}/lineages.tsv`), lines(`${dirOf(sham)}/lineages.tsv`), PILOT.C, PILOT.baseSteps);
    check("sham lineage rows equal the base's over (10000, 16000]", ls.ok && ls.compared > 0, JSON.stringify(ls));
    for (const j of forks.filter((x) => x.arm !== "sham")) {
      const rl = await replayCheck(`${baseDir}/series.jsonl`, `${dirOf(j)}/series.jsonl`, PILOT.C, PILOT.S, 100);
      check(`${j.arm} series equals the base's over (10000, 15000]`, rl.ok && rl.compared === 50, JSON.stringify(rl));
      const ll = await lineageRowsCheck(lines(`${baseDir}/lineages.tsv`), lines(`${dirOf(j)}/lineages.tsv`), PILOT.C, PILOT.S);
      check(`${j.arm} lineage rows equal the base's over (10000, 15000]`, ll.ok && ll.compared > 0, JSON.stringify(ll));
      const rd = await replayCheck(`${baseDir}/series.jsonl`, `${dirOf(j)}/series.jsonl`, PILOT.C, PILOT.baseSteps, 100);
      // A one-site nudge in a young world may not show within 1,000 steps: reported, not required.
      check(`${j.arm} series differs from the base's after 15000`, !rd.ok && typeof rd.mismatchStep === "number" && rd.mismatchStep > PILOT.S, JSON.stringify(rd), j.arm !== "nudge");
    }
    const tb = times[base.id], tf = forks.map((j) => times[j.id]);
    if (tb.stepsPerSecond && tb.seconds !== null && tf.every((t) => t.stepsPerSecond && t.seconds !== null)) {
      const rBase = tb.stepsPerSecond, rFork = tf.reduce((x, t) => x + t.stepsPerSecond!, 0) / tf.length;
      const o = Math.max(0, tf.reduce((x, t) => x + (t.seconds! - PILOT.forkSteps / t.stepsPerSecond!), 0) / tf.length);
      rates = { rBase, rFork, o };
    }
  }
  const mechanicsOk = checks.every((c) => c.ok || !c.required) && rates !== null;
  const wallSeconds = Math.ceil(elapsed());
  const scale = rates ? scaleDown(rates, CAP_HOURS, wallSeconds) : null;
  const record = {
    rule: "anomaly-bell-v2-pilot",
    note: NOTE2_PATH,
    seed: PILOT.seed,
    pilot: PILOT,
    root,
    at: new Date().toISOString(),
    launch: launchId,
    uptimeBefore: before,
    uptimeAfter: after,
    /** The pilot's wall time, waits included: the first part of the one budget the main run is held to. */
    wallSeconds,
    jobs: times,
    nudgeCentre: nudge?.expected ? { x: nudge.expected.x, y: nudge.expected.y } : null,
    rates,
    baseOverheadSeconds: times[base.id]?.seconds != null && times[base.id]?.stepsPerSecond ? times[base.id].seconds! - PILOT.baseSteps / times[base.id].stepsPerSecond! : null,
    checks,
    mechanicsOk,
    projection: scale,
    freeBytes: await freeBytes(root),
  };
  const text = JSON.stringify(record, null, 1) + "\n";
  const tmp = `${a.record}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(tmp, text);
  await Deno.rename(tmp, a.record);
  for (const c of checks) console.log(`  ${c.ok ? "ok  " : c.required ? "FAIL" : "note"} ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
  console.log(`rates ${JSON.stringify(rates)}; projection ${JSON.stringify(scale)}`);
  console.log(`pilot record: ${a.record}`);
  await finish("pilot done", false, { mechanicsOk, wallSeconds }, mechanicsOk ? 0 : 1);
}

// =============================================================================================
// Main run.

/** A dry run without a pilot record prints the plan with placeholder rates (1 step/s), which decide nothing. */
const rates = (pilotRecord?.rates ?? { rBase: 1, rFork: 1, o: 0 }) as PilotRates;
// The mode is decided once, at the first launch, and kept by every --resume.
const earlier = prior.find((e) => e.mode === "run" && e.event === "plan" && e.scale && typeof e.scale === "object");
const scale = earlier ? (earlier.scale as { mode: ScaleMode; drop: string[] }) : scaleDown(rates, deadlineHours, usedAtStart);
await event({ event: "plan", scale, ...(earlier ? { keptFrom: earlier.launch } : {}) });
const dropped = new Set<string>(scale.drop);

/** Why an existing destination is not this job's finished run, or null when it is. `identity`: the base's presetIdentity (forks). */
const lastLineOf = (id: string): JobLine | undefined => jobLines.filter((l) => l.id === id).pop();
async function notDone(j: Job2, dest: string, identity: string | null): Promise<string | null> {
  const last = lastLineOf(j.id);
  if (!cleanExit(last)) return last?.timeout === true ? "its last attempt was killed at the cap" : "no exit-0 record in jobs.jsonl";
  const text = await readOrNull(`${dest}/manifest.json`);
  if (text === null) return "no manifest.json";
  if (j.kind === "base") {
    const m = baseManifestProblem(j, text);
    return "problem" in m ? m.problem : null;
  }
  if (identity === null) return "its base is not done";
  return forkManifestProblem(j, text, identity) ?? interventionProblem2(j, await readOrNull(`${dest}/interventions.jsonl`));
}
const identityOf = async (seed: number): Promise<string | null> => {
  const text = await readOrNull(`${root}/${relOf(BASE_EXPERIMENT, seed)}/manifest.json`);
  if (text === null) return null;
  const m = baseManifestProblem({ experiment: BASE_EXPERIMENT, seed }, text);
  return "problem" in m ? null : m.presetIdentity;
};
/** "run" (absent, or left by an interrupted attempt and now moved aside), "done" (finished; --resume skips it) or throws STOP. */
async function destState(j: Job2, act = true): Promise<"run" | "done"> {
  const dest = `${root}/${j.rel}`;
  await noSymlinkBelowRoot(dest);
  if (!(await exists(dest))) {
    // A job whose last jobs.jsonl line is a clean exit 0 has run: its bundle is missing, and running it again would spend an attempt
    // on a job that succeeded (and could turn missing data into a failed job).
    if (cleanExit(lastLineOf(j.id))) throw new Error(`STOP: ${dest} is gone, but jobs.jsonl records ${j.id} as finished with exit 0; put its bundle back (it is never rerun)`);
    return "run";
  }
  // Killed at the cap, its line written but the launcher gone before it moved the bundle aside: moved aside now (it is never read);
  // the budget is spent, so the job cannot start again and the run stops at the cap, as it would have.
  if (a.resume && lastLineOf(j.id)?.timeout === true) {
    if (act) await moveAside(j, dest, "killed at the cap (moved aside on resume)");
    return "run";
  }
  if (a.resume && unfinished.has(j.id) && recorded.get(j.id) !== 0) {
    const live = liveRunOf(await ps(), j);
    if (live.length) throw new Error(`STOP: ${dest} belongs to an interrupted attempt whose tools/run.ts is still running (${live.join(", ")}); stop it first`);
    if (act) {
      await moveAside(j, dest, "an interrupted attempt");
      unfinished.delete(j.id);
    }
    return "run";
  }
  const why = await notDone(j, dest, j.kind === "fork" ? await identityOf(j.seed) : null);
  if (a.resume && why === null) return "done";
  throw new Error(`STOP: ${dest} already exists${why === null ? " (finished; pass --resume to skip it)" : ` and is not this job's finished run (${why}); move it by hand`}`);
}

// Preflight: every destination the plan can reach (bases including the replacements, shams, the big twins) distinct, and absent or done.
const firstSeeds = baseSeeds();
{
  // Placeholder centres: a destination does not depend on the centre.
  const every = [...firstSeeds, ...replacementSeeds()];
  const anyCentre: NudgeCentres2 = Object.fromEntries(every.map((s) => [s, { nudge: { x: 0, y: 0 }, nudge2: { x: 0, y: 0 } }]));
  const nudgeReach = planNudgeTwins(every, anyCentre);
  const reach = [...planBases(every), ...planShams(every), ...planBigTwins(every)];
  const problems = jobProblems2([...reach, ...nudgeReach]);
  if (problems.length) throw new Error(`STOP: ${problems.join("; ")}`);
  for (const j of reach) await destState(j, false);
  // A nudge twin's intervention depends on its centre, known only after the shams: here only its absence is checked (or, with --resume,
  // it is left to the full check once the centres are rebuilt, before any nudge twin runs).
  for (const j of nudgeReach) if (!a.resume && (await exists(`${root}/${j.rel}`))) throw new Error(`STOP: ${root}/${j.rel} already exists; move it by hand`);
}
if (dry) {
  if (pilotRecord === null) console.log(`no pilot record at ${a.pilot}: the mode below uses placeholder rates and means nothing`);
  const hours = (scale as { hours?: { full: number; dropL64: number } }).hours;
  console.log(`mode ${scale.mode}${hours ? ` (projected ${hours.full.toFixed(2)} h full, ${hours.dropL64.toFixed(2)} h without L64, budget used ${(usedAtStart / 3600).toFixed(2)} h; cap ${deadlineHours} h)` : " (kept from the first launch)"}`);
  for (const j of planBases(firstSeeds)) console.log(["deno", "run", "--no-lock", "-A", "tools/run.ts", ...baseArgs(j, root)].join(" "));
  for (const j of [...planShams(firstSeeds), ...planBigTwins(firstSeeds)]) console.log(["deno", "run", "--no-lock", "-A", "tools/run.ts", ...forkArgs(j, root, `${root}/${relOf(BASE_EXPERIMENT, j.seed)}`)].join(" "));
  console.log("(nudge twins: centres from the shams' checkpoints at S)");
  Deno.exit(0);
}

let stopped: string | null = null;
const failedJobs: string[] = [];
async function runOrSkip(j: Job2, args: string[]): Promise<"ok" | "failed" | "deadline" | "done"> {
  if (stopped) return "deadline";
  const st = await destState(j);
  if (st === "done") return "done";
  const r = await runJob(j, args, rates);
  if (r === "deadline") stopped = `the cap: ${j.id} would end past the ${capHours} h budget, or was killed at it (projected ${Math.round(jobSeconds(rates, j.kind, observedMax[j.kind]))} s at ${Math.round(elapsed())} s)`;
  if (r === "failed") failedJobs.push(j.id);
  return r;
}

// 1. Bases, with the dead-base rule.
async function seriesAtS(seed: number): Promise<number | null> {
  const p = `${root}/${relOf(BASE_EXPERIMENT, seed)}/series.jsonl`;
  const text = await readOrNull(p);
  if (text === null) return null;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (r.step === S) return typeof r.livingCells === "number" && Number.isFinite(r.livingCells) ? r.livingCells : null;
  }
  return null;
}
const picked = await pickSeeds(async (seed) => {
  const [j] = planBases([seed]);
  const r = await runOrSkip(j, baseArgs(j, root));
  if (r === "deadline") return undefined;
  if (r === "failed") return null;
  return await seriesAtS(seed);
}).catch((e) => {
  // The note: replacements used up, the launch stops and nothing is called. A final stop, so the scorer records it.
  if (e instanceof ReplacementsExhausted) return finish(`void: ${e.message}`, true, { failed: failedJobs });
  throw e;
});
for (const rep of picked.replacements) await event({ event: "replacement", ...rep });
if (picked.pending !== null) await finish(stopped ?? "bases incomplete", true, { failed: failedJobs });
const seeds = picked.seeds;

// 2. Shams, each checked and read for the nudge centres.
const centres: NudgeEntry2[] = [];
const nudgeFailed: { seed: number; reason: string }[] = [];
for (const j of planShams(seeds)) {
  const baseDir = `${root}/${relOf(BASE_EXPERIMENT, j.seed)}`;
  const identity = await identityOf(j.seed);
  if (identity === null) {
    nudgeFailed.push({ seed: j.seed, reason: "its base did not finish" });
    continue;
  }
  const r = await runOrSkip(j, forkArgs(j, root, baseDir));
  if (r === "deadline") break;
  if (r === "failed") {
    nudgeFailed.push({ seed: j.seed, reason: "the sham exited nonzero twice" });
    continue;
  }
  const dir = `${root}/${j.rel}`;
  try {
    const mtext = await Deno.readTextFile(`${dir}/manifest.json`);
    const mp = forkManifestProblem(j, mtext, identity);
    if (mp) throw new Error(mp);
    // R's whole horizon, (C, 206,000], not only up to S: a sham that differs later fails R just the same, and the 50 other twins
    // would then be spent on a run that cannot be called.
    const rc = await replayCheck(`${baseDir}/series.jsonl`, `${dir}/series.jsonl`, C, BASE_STEPS, 100);
    if (!rc.ok) throw new Error(`replay over (${C}, ${BASE_STEPS}]: ${rc.detail}`);
    const lr = await lineageRowsCheck(lines(`${baseDir}/lineages.tsv`), lines(`${dir}/lineages.tsv`), C, BASE_STEPS);
    if (!lr.ok) throw new Error(`lineage rows over (${C}, ${BASE_STEPS}]: ${lr.detail}`);
    const entry = shamCheckpoint(mtext)!;
    const bytes = await Deno.readFile(`${dir}/${entry.file}`);
    const { state } = decodeCheckpoint(bytes);
    if (state.step !== S) throw new Error(`${entry.file}: state at step ${state.step}, expected ${S}`);
    if (stateHash(state) !== entry.hash) throw new Error(`${entry.file}: state hash ${stateHash(state)}, the manifest says ${entry.hash}`);
    if (state.cfg.seed !== j.seed) throw new Error(`${entry.file}: seed ${state.cfg.seed}, expected ${j.seed}`);
    const { W, H, B } = biomass(state);
    const sha = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    for (const arm of ["nudge", "nudge2"] as const) {
      const [cx, cy] = NUDGE_TARGETS[arm];
      const c = nearestBiomass(B, W, H, cx, cy);
      if (!c) throw new Error(`no biomass anywhere at step ${S}`);
      centres.push({ seed: j.seed, arm, target: [cx, cy], x: c.x, y: c.y, d2: c.d2, B: B[c.y * W + c.x], checkpoint: entry.file, manifestHash: entry.hash, fileSha256: sha });
    }
  } catch (e) {
    for (let i = centres.length - 1; i >= 0; i--) if (centres[i].seed === j.seed) centres.splice(i, 1);
    nudgeFailed.push({ seed: j.seed, reason: errMsg(e) });
    await event({ event: "sham-failed", seed: j.seed, reason: errMsg(e) });
  }
}
if (stopped) await finish(stopped, true, { failed: failedJobs });
const nudgeText = nudgeFileText({ seeds, replacements: picked.replacements, centres, failed: nudgeFailed });
{
  const old = await readOrNull(a.nudges);
  if (old !== null && old !== nudgeText) throw new Error(`STOP: ${a.nudges} exists and disagrees with the centres computed now`);
  if (old === null) await Deno.writeTextFile(a.nudges, nudgeText);
}
console.log(centres.map((c) => `seed ${c.seed} ${c.arm}: (${c.x}, ${c.y}) d2=${c.d2} B=${c.B}`).join("\n"));
// A base or a sham that failed: R (all ten shams equal their bases) cannot be met, so no criterion can be called. Stop before the 50
// other twins; their reported numbers are lost, no called outcome is.
if (nudgeFailed.length) await finish(`void: R cannot be met (${nudgeFailed.map((x) => `seed ${x.seed}: ${x.reason}`).join("; ")})`, true, { failed: failedJobs });

// 3. The other twins, in the fixed order.
const nudges: NudgeCentres2 = {};
for (const c of centres) (nudges[c.seed] ??= {})[c.arm] = { x: c.x, y: c.y };
const big = planBigTwins(seeds), nudgeJobs = planNudgeTwins(seeds, nudges);
{
  const problems = jobProblems2([...planBases(seeds), ...planShams(seeds), ...big, ...nudgeJobs]);
  if (problems.length) throw new Error(`STOP: ${problems.join("; ")}`);
  for (const j of nudgeJobs) await destState(j, false);
}
const arm = (x: string) => [...big, ...nudgeJobs].filter((j) => j.arm === x);
for (const name of TWIN_ORDER) {
  if (dropped.has(name)) {
    await event({ event: "dropped", arm: name, why: `the scale-down (${scale.mode})` });
    continue;
  }
  for (const j of arm(name)) {
    const r = await runOrSkip(j, forkArgs(j, root, `${root}/${relOf(BASE_EXPERIMENT, j.seed)}`));
    if (r === "deadline") break;
  }
  if (stopped && name === "l64") {
    // L64 is last and only reported: the cap reached in its phase drops it, every criterion's twins have run.
    await event({ event: "dropped", arm: "l64", why: `the cap, in the L64 phase (${stopped})` });
    stopped = null;
    break;
  }
  if (stopped) break;
}
await finish(stopped ?? "finished", true, { failed: failedJobs });
