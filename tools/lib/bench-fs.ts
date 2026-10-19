// The proposer bench's file side (docs/naturalist-bench-v0-2026-10-18.md): loading the sources and their notes by the fixed rule and
// running the proposer on them, re-deriving a manifest from the files it names, running an approved manifest's forks (resume, time
// cap, an injectable executor, the proposer's replay and identity checks per fork), and scoring the finished forks with bell v1's
// pair scorer, streamed in lockstep with the ten sources. The pure core is ./bench.ts. Written on node:fs so it runs under Deno (the
// CLI, tools/bench.ts) and under vitest (its tests) alike; nothing here spawns a process (the CLI passes the executor).
import { createHash, randomUUID } from "node:crypto";
import { constants as FS, createReadStream } from "node:fs";
import { link, mkdir, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { loadavg } from "node:os";
import { pid } from "node:process";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInterventionLog, runId, type InterventionLogEntry, type ScheduledIntervention } from "@bl/runner";
import { SignalExtractor, mergeCensuses, parseSeries, splitLines } from "./bell.ts";
import { lineageBlocksThrough, seriesThrough } from "./bell-digest.ts";
import { PairScorer, isV1Signal, strictCensuses, type Census, type TwinInput } from "./bell1.ts";
import {
  BENCH_V0,
  BenchPlanError,
  appliedFeedMatter,
  benchVoidReasons,
  entryCommand,
  notesNameOf,
  planBench,
  rulesPredictions,
  runRefusal,
  scoredFieldProblem,
  seedsOf,
  serializeManifest,
  sourceDirOf,
  summarizeBench,
  versionRefusal,
  type BenchBody,
  type BenchConstants,
  type BenchEntry,
  type BenchInput,
  type BenchManifest,
  type BenchSummary,
  type ForkScore,
  type PredictionOutcome,
} from "./bench.ts";
import { RULES_V0, bindNotesToManifest, canonical, parseNotes, predictionHolds, sourceRefusal, type SignalTrack } from "./propose.ts";
import { fileSha256, finishRun, forkPointError, guardOut, initError, loadSource, proposalsFor, readNotesFile, runKeyOf, writeAtomic, type LoadedSource } from "./propose-fs.ts";

/** The repository root (tools/lib/../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** A refusal: the CLI exits 2 on it, before anything is written or run. */
export class BenchRefusal extends Error {}
const refuse = (msg: string): never => {
  throw new BenchRefusal(msg);
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notFound = (e: unknown) => (e as { code?: string })?.code === "ENOENT" || (e as { code?: string })?.code === "ENOTDIR";
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if (notFound(e)) return false;
    throw e;
  }
}
const readOrNull = (p: string) => readFile(p, "utf8").catch((e) => (notFound(e) ? null : Promise.reject(e)));

/**
 * A file's SHA-256, streamed (a source's lineages.tsv is tens of MB). Never memoised: an integrity check that trusted size and mtime
 * would miss an equal-length edit that keeps them (Codex pass 2).
 */
export async function streamSha256(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Uint8Array);
  return h.digest("hex");
}

/**
 * A file read as UTF-8 text while the SHA-256 of exactly the bytes read is kept: `text` yields the decoded chunks; `digest()` reads on
 * through the same open stream to its end and gives the hash of every byte, those the consumer saw first. So the digest score checks
 * is of the bytes it scored, not of a second read that could see another file (amendment 2).
 */
export function hashedText(path: string): { text: AsyncIterable<string>; digest: () => Promise<string>; close: () => Promise<void> } {
  const h = createHash("sha256");
  const stream = createReadStream(path);
  const raw = (stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const dec = new TextDecoder("utf-8");
  let ended = false, reading = false;
  const next = async () => {
    if (reading) throw new Error(`${path}: read twice at once`);
    reading = true;
    try {
      const n = await raw.next();
      if (n.done) ended = true;
      else h.update(n.value);
      return n;
    } finally {
      reading = false;
    }
  };
  async function* text(): AsyncGenerator<string> {
    while (!ended) {
      const n = await next();
      const s = n.done ? dec.decode() : dec.decode(n.value, { stream: true });
      if (s) yield s;
    }
  }
  const digest = async () => {
    while (!ended) await next();
    return h.digest("hex");
  };
  /** Closes the open file whether or not it was read to its end (a scoring refusal never leaves it open; Codex pass 3). */
  const close = async () => {
    ended = true;
    if (stream.closed) return;
    // Waits for the descriptor itself to be released ("close"), which comes after destroy() returns.
    const closed = once(stream, "close").catch(() => {});
    stream.destroy();
    await closed;
  };
  return { text: text(), digest, close };
}
/** The two files of a source the bench reads beyond its manifest: the replay check's and the scorer's input (amendment 1). */
export const SOURCE_CONTENT = [["series.jsonl", "seriesSha256"], ["lineages.tsv", "lineagesSha256"]] as const;
/** Why a source's series.jsonl or lineages.tsv is not the content the plan recorded, or null. */
async function contentProblem(s: { runId: string; dir: string; seriesSha256: string; lineagesSha256: string }): Promise<string | null> {
  for (const [file, key] of SOURCE_CONTENT) {
    const now = await streamSha256(join(s.dir, file)).catch(() => null);
    if (now !== s[key]) return `the source ${file} of ${s.runId} changed since the plan (sha256 ${now ?? "unreadable"}, the plan says ${s[key]})`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inputs and the plan.

export interface LoadedInputs {
  where: { base: string; notesDir: string };
  inputs: BenchInput[];
  sources: LoadedSource[];
}

/**
 * The sources by the fixed rule (<base>/<experiment>/<preset>/<condition>/seed-1..pairs) and their notes files (<notesDir>/<name>),
 * each checked as the proposer checks them (a source v0 can fork, a start world that matches initHash, notes that parse and describe
 * this bundle), then the proposer's own proposals for each. Paths are taken as absolute real paths. Throws naming the source.
 */
export async function loadBenchInputs(where: { base: string; notesDir: string }, k: BenchConstants = BENCH_V0, repoRoot: string = REPO_ROOT): Promise<LoadedInputs> {
  const base = await realpath(where.base).catch((e) => refuse(`--base ${where.base}: ${errMsg(e)}`));
  const notesDir = await realpath(where.notesDir).catch((e) => refuse(`--notes ${where.notesDir}: ${errMsg(e)}`));
  const inputs: BenchInput[] = [], sources: LoadedSource[] = [];
  for (const seed of seedsOf(k.pairs)) {
    const dir = sourceDirOf(base, k.selection, seed);
    const at = `seed-${seed} (${dir})`;
    try {
      const src = await loadSource(dir);
      const why = sourceRefusal(src.manifest);
      if (why) throw new Error(`v0 cannot fork it: ${why}`);
      const initBad = initError(src.manifest);
      if (initBad) throw new Error(`step 0 does not check: ${initBad}`);
      const notesPath = join(notesDir, notesNameOf(k.selection, seed));
      const real = await realpath(notesPath).catch((e) => {
        throw new Error(`no notes file ${notesPath} (${errMsg(e)})`);
      });
      if (real !== notesPath) throw new Error(`the notes file ${notesPath} is a link to ${real}`);
      const read = await readNotesFile(notesPath);
      const notes = parseNotes(read.text, RULES_V0);
      bindNotesToManifest(notes, src.manifest, src.sizes);
      const result = await proposalsFor(src, notes, { path: notesPath, sha256: read.sha256 });
      const seriesSha256 = await streamSha256(join(src.dir, "series.jsonl")), lineagesSha256 = await streamSha256(join(src.dir, "lineages.tsv"));
      inputs.push({ seed, src: { dir: src.dir, manifest: src.manifest, manifestSha256: src.manifestSha256, seriesSha256, lineagesSha256 }, notesPath, notesSha256: read.sha256, result });
      sources.push(src);
    } catch (e) {
      if (e instanceof BenchRefusal) throw e;
      refuse(`${at}: ${errMsg(e)}`);
    }
  }
  // The notes directory is durable and outside the repository and every runs tree (the note, "The notes files").
  const repoReal = await realpath(repoRoot).catch(() => repoRoot);
  const rel = relative(repoReal, notesDir);
  if (rel === "" || !(rel === ".." || rel.startsWith("../") || isAbsolute(rel))) refuse(`refused: the notes directory ${notesDir} is inside the repository; notes live outside it`);
  for (const s of sources) await guardOut(notesDir, repoRoot, { dir: s.dir, key: s.manifest.spec }, "the notes directory").catch((e) => refuse(errMsg(e)));
  return { where: { base, notesDir }, inputs, sources };
}

/** `plan`: the body the fixed rule gives from these files. Throws a BenchRefusal naming the source on any failure. */
export async function planFromDisk(where: { base: string; notesDir: string }, k: BenchConstants = BENCH_V0): Promise<{ body: BenchBody; sources: LoadedSource[] }> {
  const loaded = await loadBenchInputs(where, k);
  try {
    return { body: planBench(loaded.where, loaded.inputs, k), sources: loaded.sources };
  } catch (e) {
    if (e instanceof BenchPlanError) refuse(e.message);
    throw e;
  }
}

/** The constants a body's plan is re-derived with: the note's, with the body's own number of pairs (a fixture's is smaller). */
export const constantsFor = (body: BenchBody): BenchConstants => ({ ...BENCH_V0, pairs: body.constants?.pairs ?? BENCH_V0.pairs });

/**
 * Re-derives a body from the files it names (the note, "The yes gate"): this checkout's versions equal the recorded ones, every
 * source manifest, series.jsonl, lineages.tsv and notes file has its recorded SHA-256 (amendment 1), the plan rebuilt by the fixed rule from the recorded base and notes
 * directory is the body exactly (canonical JSON), and every entry's fork point re-checks against its bundle (the checkpoint's hash
 * and the runner's continuationError for that entry's spec, or step 0's initHash). Never throws: the loaded sources, or the refusal.
 */
export async function rederiveBench(body: BenchBody, k: BenchConstants = constantsFor(body)): Promise<{ sources: LoadedSource[]; refusal?: undefined } | { sources?: undefined; refusal: string }> {
  try {
    const v = versionRefusal(body);
    if (v) return { refusal: v };
    for (const s of body.sources) {
      const now = await fileSha256(join(s.dir, "manifest.json")).catch(() => null);
      if (now !== s.manifestSha256) return { refusal: `the source manifest of ${s.runId} changed since the plan (sha256 ${now ?? "unreadable"}, the plan says ${s.manifestSha256})` };
      const notes = await fileSha256(s.notesPath).catch(() => null);
      if (notes !== s.notesSha256) return { refusal: `the notes file ${s.notesPath} changed since the plan (sha256 ${notes ?? "unreadable"}, the plan says ${s.notesSha256})` };
      const content = await contentProblem(s);
      if (content) return { refusal: content };
    }
    let again: Awaited<ReturnType<typeof planFromDisk>>;
    try {
      again = await planFromDisk({ base: body.selection.base, notesDir: body.selection.notesDir }, k);
    } catch (e) {
      return { refusal: `the plan no longer derives from its files: ${errMsg(e)}` };
    }
    if (canonical(again.body) !== canonical(body)) {
      const ids = new Map(again.body.entries.map((e) => [e.id, canonical(e)]));
      const first = body.entries.find((e) => ids.get(e.id) !== canonical(e));
      return { refusal: `the body is not the plan its files give${first ? ` (entry ${first.id} differs)` : " (outside the entries)"}; a plan is re-derived, not trusted` };
    }
    for (const e of body.entries) {
      const src = again.sources[e.source];
      const bad = await forkPointError(src.dir, src.manifest, e.fork, e.spec);
      if (bad) return { refusal: `entry ${e.id}: the fork point does not re-check: ${bad}` };
    }
    return { sources: again.sources };
  } catch (e) {
    return { refusal: `the manifest is malformed (${errMsg(e)})` };
  }
}

/** guardOut against every source: the repository's runs/, the runs tree that holds each source, and each bundle. */
export async function guardOutAll(out: string, repo: string, body: BenchBody, label = "--out"): Promise<void> {
  if (!Array.isArray(body.sources) || body.sources.length === 0) refuse(`refused: the manifest names no sources, so ${label} cannot be guarded`);
  for (const s of body.sources) await guardOut(out, repo, { dir: s.dir, key: runKeyOf(s.runId) }, label).catch((e) => refuse(errMsg(e)));
}

// ---------------------------------------------------------------------------------------------
// run.

/** Runs one fork's command (argv[0] is "deno") from `cwd`, its output to `logPath`; resolves to its exit code. */
export type Exec = (argv: string[], cwd: string, logPath: string) => Promise<number>;
export interface RunOptions {
  out: string;
  repo: string;
  jobs: number;
  maxMinutes: number;
  exec: Exec;
  /** The number of pairs the caller accepts (the note's 10 unless a test fixture names its own). */
  pairs?: number;
  now?: () => number;
  log?: (line: string) => void;
}
export interface RunReport {
  out: string;
  skipped: string[];
  finished: { id: string; exit: number }[];
  notStarted: string[];
  capped: boolean;
  /** Entries that hit a file-system error (or were claimed by another process) and have no receipt from this run. */
  errors: { id: string; error: string }[];
}
export const RECEIPT = "run-receipt.json";
export const RUN_LOG = "bench-run.jsonl";
export const MANIFEST_COPY = "bench-manifest.json";

/**
 * Opens <out>/bench-run.jsonl for appending: never through a symbolic link (O_NOFOLLOW gives ELOOP), and only when the opened file is
 * a regular file with one link (fstat on the handle, so nothing can swap it between the check and the writes). If its last byte is not
 * a newline (a line torn by an interruption), a newline is appended first. Refuses, naming the file, otherwise.
 */
export async function openRunLog(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  const h = await open(path, FS.O_RDWR | FS.O_APPEND | FS.O_CREAT | FS.O_NOFOLLOW).catch((e) =>
    refuse(`refused: ${path} cannot be opened as the run log without following a link (${errMsg(e)}); it must be a regular file, never a link or a directory`)
  );
  try {
    const st = await h.stat();
    if (!st.isFile()) refuse(`refused: ${path} is not a regular file; the run log is never a link or a directory`);
    if (st.nlink !== 1) refuse(`refused: ${path} has ${st.nlink} links (a hard link to another file?); the run log must be a file of its own`);
    if (st.size > 0) {
      const last = new Uint8Array(1);
      await h.read(last, 0, 1, st.size - 1);
      if (last[0] !== 0x0a) await h.appendFile("\n");
    }
    return h;
  } catch (e) {
    await h.close().catch(() => {});
    throw e;
  }
}

/**
 * Writes `text` to `path` once: a complete temporary file is hard-linked into place, which fails if `path` exists, so a file another
 * process published first is never replaced (amendment 2). An existing identical file is left as it is; a different one is refused.
 */
export async function publishOnce(path: string, text: string, what = path): Promise<"wrote" | "unchanged"> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    // Inside the cleanup scope: a write that fails part way (ENOSPC) leaves no temporary file behind (Codex pass 3).
    await writeFile(tmp, text, { flag: "wx" });
    await link(tmp, path);
    return "wrote";
  } catch (e) {
    if ((e as { code?: string })?.code !== "EEXIST") throw e;
    const had = await readFile(path, "utf8").catch(() => null);
    if (had === text) return "unchanged";
    refuse(`refused: ${what} exists and differs; it is never replaced`);
    throw e;
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Replaces `path` with `next` only if it still holds `expected` (approve: Codex pass 3). Writers that share this function are
 * serialised by `<path>.lock`, created exclusively and held across the re-read and the atomic rename, so of two approvals of one
 * file exactly one is written and the other is refused; a lock left by a crash is named, never broken. An editor that ignores the
 * lock can still race the final rename; the hash bound into the approval then refuses the edited body at `run` and `score`.
 */
export async function replaceIfUnchanged(path: string, expected: string, next: string, what = path): Promise<void> {
  const lock = `${path}.lock`;
  await writeFile(lock, `${pid}\n`, { flag: "wx" }).catch((e) =>
    (e as { code?: string })?.code === "EEXIST" ? refuse(`refused: ${lock} exists: another approval of ${what} is under way (or one crashed; remove the lock once none is)`) : Promise.reject(e)
  );
  try {
    const now = await readFile(path, "utf8").catch(() => null);
    if (now !== expected) refuse(`refused: ${what} changed while it was being approved (another approval or an edit); read it again`);
    await writeAtomic(path, next);
  } finally {
    await rm(lock, { force: true }).catch(() => {});
  }
}

/** Why an entry directory's receipt does not mark that entry finished, or null when it does (exit 0, this manifest, this entry). */
async function receiptProblem(target: string, e: BenchEntry, sha: string): Promise<string | null> {
  const text = await readOrNull(join(target, RECEIPT));
  if (text === null) return "no run receipt";
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    return "its run receipt is not JSON";
  }
  if (!isObj(r)) return "its run receipt is not a JSON object";
  if (r.benchManifestSha256 !== sha) return "its receipt is another manifest's";
  if (r.entryId !== e.id || r.specSha256 !== e.specSha256) return "its receipt is another entry's";
  if (r.exitCode !== 0) return `its receipt has exit code ${JSON.stringify(r.exitCode)}`;
  return null;
}

/**
 * `run` (the note, "Running"): refuses unless the manifest is approved for exactly this body (runRefusal) and re-derives from its
 * files (rederiveBench), and unless --out is outside every runs tree and bundle; then skips every entry whose receipt has exit code 0,
 * refuses by name any other entry directory (nothing is deleted or overwritten), and runs the rest, `jobs` at a time, starting none
 * after `maxMinutes`. An error on one entry is recorded in `errors` and the others go on (amendment 1); the run log is opened once,
 * without following a link. Each fork goes to <out>/<id>/ with entry.json, run.log, the fork bundle and run-receipt.json (the proposer's
 * replay check over (C, replayThrough] and its identity check); each finished fork appends a line to <out>/bench-run.jsonl.
 */
export async function runBench(m: BenchManifest, o: RunOptions): Promise<RunReport> {
  const why = runRefusal(m, o.pairs);
  if (why) refuse(`refused: ${why}`);
  const again = await rederiveBench(m.body);
  if (again.refusal !== undefined) refuse(`refused: ${again.refusal}`);
  const sources = again.sources!;
  const out = resolve(o.out);
  await guardOutAll(out, o.repo, m.body);
  if (!(Number.isInteger(o.jobs) && o.jobs >= 1)) refuse(`--jobs ${o.jobs} is not a positive integer`);
  if (!(Number.isFinite(o.maxMinutes) && o.maxMinutes > 0)) refuse(`--max-minutes ${o.maxMinutes} is not a positive number`);
  const sha = m.manifestSha256;
  const skipped: string[] = [], pending: BenchEntry[] = [], incomplete: string[] = [];
  for (const e of m.body.entries) {
    const target = join(out, e.id);
    if (!(await exists(target))) {
      pending.push(e);
      continue;
    }
    const p = await receiptProblem(target, e, sha);
    if (p === null) skipped.push(e.id);
    else incomplete.push(`${e.id} (${p})`);
  }
  if (incomplete.length) refuse(`refused: ${incomplete.length} entry director${incomplete.length === 1 ? "y" : "ies"} under ${out} hold no finished fork of this manifest: ${incomplete.join(", ")}. A run that was stopped or a fork that failed leaves one; move ${incomplete.length === 1 ? "it" : "them"} aside (for example into ${join(out, "aside")}/) and run again, which re-runs ${incomplete.length === 1 ? "that fork" : "those forks"} from the start (nothing is deleted or overwritten; bench-run.jsonl keeps every launch)`);
  const copy = join(out, MANIFEST_COPY), text = serializeManifest(m);
  const had = await readOrNull(copy);
  if (had !== null && had !== text) refuse(`refused: ${copy} is another manifest's (or another approval's); choose another --out`);
  await mkdir(out, { recursive: true });
  // The launch log is opened once, without following a symbolic link (O_NOFOLLOW), and checked on that open handle: a regular file
  // with one name, so a hard link into a source bundle is refused too (amendment 2); every line goes through that handle. A log whose
  // last line was torn by an interruption gets a newline first, so the next start line is a line of its own.
  const runLog = await openRunLog(join(out, RUN_LOG));
  if (had === null) await publishOnce(copy, text, `${copy} (another manifest's or another approval's copy; choose another --out)`).catch(async (e) => {
    await runLog.close();
    throw e;
  });
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const t0 = now(), capMs = o.maxMinutes * 60_000;
  const queue = [...pending];
  const finished: RunReport["finished"] = [];
  const errors: RunReport["errors"] = [];
  let capped = false;
  /** Runs one fork; false (and nothing left behind) when the cap passed while its directory was being claimed. */
  const runOne = async (e: BenchEntry): Promise<boolean> => {
    const target = join(out, e.id), src = sources[e.source];
    await mkdir(target); // fails when it exists: two runs never share an entry directory
    await writeAtomic(join(target, "entry.json"), JSON.stringify(e, null, 2) + "\n");
    if (now() - t0 >= capMs) {
      // No fork starts after the cap: undo this run's own claim (a directory it just made, holding only entry.json).
      await rm(target, { recursive: true });
      return false;
    }
    const argv = entryCommand(e, out);
    const startedAt = new Date().toISOString(), t = now();
    // A start line before the spawn, so a launch that never finishes (an interrupted run) is still counted (amendment 1, "Re-runs").
    await runLog.appendFile(JSON.stringify({ id: e.id, event: "start", startedAt }) + "\n");
    log(`start ${e.id} (${e.role}, ${e.steps} steps)`);
    let code: number;
    try {
      code = await o.exec(argv, o.repo, join(target, "run.log"));
    } catch (err) {
      log(`${e.id}: the executor failed: ${errMsg(err)}`);
      code = 1;
    }
    const forkDir = join(target, runId(e.spec));
    const done = await finishRun({
      target,
      receipt: { benchManifestSha256: sha, entryId: e.id, role: e.role, specSha256: e.specSha256, approval: m.approval, argv, cwd: o.repo, startedAt, forkBundle: forkDir },
      exitCode: code,
      sourceSeries: join(src.dir, "series.jsonl"),
      forkSeries: join(forkDir, "series.jsonl"),
      C: e.C,
      through: e.replayThrough,
      cadence: e.spec.censusEvery,
      identity: { forkManifest: join(forkDir, "manifest.json"), start: { step: e.C, ...(e.C === 0 ? { initHash: e.fork.hash } : {}) }, sourceManifest: join(src.dir, "manifest.json"), sourceSha256: src.manifestSha256 },
    });
    const seconds = (now() - t) / 1000;
    await runLog.appendFile(JSON.stringify({ id: e.id, event: "finish", exit: done.exit, runExit: code, seconds, steps: e.steps, load: loadavg(), startedAt, finishedAt: new Date().toISOString() }) + "\n");
    finished.push({ id: e.id, exit: done.exit });
    log(`${done.exit === 0 ? "done" : "FAILED"} ${e.id} (exit ${done.exit}, ${seconds.toFixed(0)} s): ${done.lines.join("; ")}`);
    return true;
  };
  // A file-system error on one entry (its claim, its entry.json, its receipt, the log) is recorded against that entry and the
  // workers go on, so no started fork is left running unwatched; an entry another process claimed first stays not started.
  const worker = async () => {
    for (;;) {
      if (!queue.length) return;
      if (now() - t0 >= capMs) {
        capped = true;
        return;
      }
      const e = queue.shift()!;
      try {
        if (!(await runOne(e))) {
          queue.unshift(e);
          capped = true;
          return;
        }
      } catch (err) {
        const claimed = (err as { code?: string })?.code === "EEXIST";
        errors.push({ id: e.id, error: claimed ? `${join(out, e.id)} appeared before this run claimed it (another run?); not started here` : errMsg(err) });
        log(`${e.id}: ${errors.at(-1)!.error}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(o.jobs, queue.length) }, worker));
  } finally {
    await runLog.close();
  }
  return { out, skipped, finished, notStarted: queue.map((e) => e.id), capped, errors };
}

// ---------------------------------------------------------------------------------------------
// score.

const text = (p: string) => createReadStream(p, { encoding: "utf8" }) as AsyncIterable<string>;
/** A census stream that throws, naming the run, at the first census whose scored fields are not all finite numbers (amendment 1). */
async function* scoredFields<T extends { rec: Record<string, unknown> & { step: number } }>(id: string, it: AsyncIterable<T>): AsyncGenerator<T> {
  for await (const c of it) {
    const p = scoredFieldProblem(c.rec);
    if (p) throw new Error(`${id}: ${p}`);
    yield c;
  }
}
/**
 * A source's censuses cut at the horizon (series by line, lineages.tsv by block), cross-checked at every census (mergeCensuses), every
 * scored field finite; `digests()` then gives the SHA-256 of the bytes of each file that were read, through to its end (hashedText).
 */
const sourceCensuses = (id: string, dir: string, horizon: number) => {
  const series = hashedText(join(dir, "series.jsonl")), lineages = hashedText(join(dir, "lineages.tsv"));
  const gen = scoredFields(id, mergeCensuses(id, seriesThrough(parseSeries(id, splitLines(series.text)), horizon), lineageBlocksThrough(id, splitLines(lineages.text), horizon)));
  return {
    gen,
    digests: async () => ({ seriesSha256: await series.digest(), lineagesSha256: await lineages.digest() }),
    close: () => Promise.allSettled([series.close(), lineages.close()]).then(() => {}),
  };
};
/** A fork's censuses, whole, with bell v1's strict per-census rule (censusProblem) and every scored field finite. */
const forkCensuses = (id: string, dir: string) => scoredFields(id, strictCensuses(id, mergeCensuses(id, parseSeries(id, splitLines(text(join(dir, "series.jsonl")))), lineageBlocksThrough(id, splitLines(text(join(dir, "lineages.tsv"))), Infinity))));

/** Why an applied log is not exactly the entry's schedule, or null (each entry's step, kind, centre, radius and, for a feed, amount). */
export function interventionLogProblem(scheduled: readonly ScheduledIntervention[], applied: readonly InterventionLogEntry[]): string | null {
  if (applied.length !== scheduled.length) return `interventions.jsonl holds ${applied.length} entries, ${scheduled.length} were scheduled`;
  for (let i = 0; i < scheduled.length; i++) {
    const a = applied[i], e = scheduled[i];
    // A sun has no centre (a bench forks with lesions and feeds; tools/lib/propose.ts refuses a sun): equal by step, percent and span.
    if (a.kind === "sun" || e.kind === "sun") {
      if (!(a.kind === "sun" && e.kind === "sun" && a.step === e.step && a.percent === e.percent && a.span === e.span)) return `interventions.jsonl entry ${i} is not the scheduled one`;
      continue;
    }
    if (a.step !== e.step || a.kind !== e.kind || a.x !== e.x || a.y !== e.y || a.r !== e.r || (e.kind === "feed" && (a.kind !== "feed" || a.amount !== e.amount))) return `interventions.jsonl entry ${i} is not the scheduled one`;
  }
  return null;
}

/**
 * The checks made before a fork is streamed (the note, "Valid forks"): its receipt, its manifest, its applied interventions. Never
 * throws: a file that cannot be read voids its own fork, with the reason (amendment 1). `applied` is the parsed log when it parsed.
 */
async function preProblems(e: BenchEntry, target: string, sha: string): Promise<{ problems: string[]; applied: InterventionLogEntry[] | null }> {
  const box: { applied: InterventionLogEntry[] | null } = { applied: null };
  try {
    return { problems: await preChecks(e, target, sha, box), applied: box.applied };
  } catch (err) {
    return { problems: [`a file of the fork could not be read: ${errMsg(err)}`], applied: null };
  }
}
async function preChecks(e: BenchEntry, target: string, sha: string, box: { applied: InterventionLogEntry[] | null }): Promise<string[]> {
  const out: string[] = [];
  const rt = await readOrNull(join(target, RECEIPT));
  if (rt === null) return ["no run receipt"];
  let r: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(rt);
    if (!isObj(v)) return ["the run receipt is not a JSON object"];
    r = v;
  } catch {
    return ["the run receipt is not JSON"];
  }
  if (r.benchManifestSha256 !== sha || r.entryId !== e.id || r.specSha256 !== e.specSha256) out.push("the run receipt is not this manifest's entry");
  if (r.exitCode !== 0) {
    const detail = [(r.identityCheck as { detail?: string } | undefined)?.detail, (r.replayCheck as { detail?: string } | undefined)?.detail].filter(Boolean).join("; ");
    out.push(`the run receipt has exit code ${JSON.stringify(r.exitCode)} (tools/run.ts ${JSON.stringify(r.runExitCode)})${detail ? `: ${detail}` : ""}`);
    return out;
  }
  const forkDir = join(target, runId(e.spec));
  const mt = await readOrNull(join(forkDir, "manifest.json"));
  if (mt === null) return [...out, "the fork bundle has no manifest.json"];
  let fm: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(mt);
    if (!isObj(v)) return [...out, "the fork's manifest.json is not a JSON object"];
    fm = v;
  } catch {
    return [...out, "the fork's manifest.json is not JSON"];
  }
  if (fm.summary === null || fm.summary === undefined) out.push("the fork's manifest has no summary (the run did not finish)");
  if (fm.startStep !== e.C) out.push(`the fork's manifest starts at step ${JSON.stringify(fm.startStep)}, not C = ${e.C}`);
  const it = await readOrNull(join(forkDir, "interventions.jsonl"));
  if (it === null) out.push("the fork bundle has no interventions.jsonl");
  else {
    try {
      box.applied = parseInterventionLog(it);
      const p = interventionLogProblem(e.spec.interventions ?? [], box.applied);
      if (p) out.push(p);
    } catch (err) {
      out.push(errMsg(err));
    }
  }
  return out;
}

export interface BenchRecord {
  rule: "proposer-bench-v0";
  note: string;
  manifestSha256: string;
  approval: BenchManifest["approval"];
  out: string;
  parameters: Record<string, unknown>;
  forks: ForkScore[];
  summary: BenchSummary;
}

/**
 * `score` (the note, "The departure score", "Valid forks", "The predictions"): an approved manifest with a receipt for every entry
 * (any exit code; a non-zero one voids its fork). The ten sources are streamed in lockstep to the last fork's end; every fork gets its
 * own PairScorer anchored at its first entry step, with all the sources as bases at every census and the source's own censuses as its
 * input up to C. A fork's stream must hold exactly its steps / cadence censuses, each passing censusProblem. Rules predictions (and
 * their alsoAnswers) are decided by predictionHolds on the source's and the fork's signal tracks, and applied to the source's count
 * and dose forks for specificity. Throws (a refusal) on an unapproved or changed manifest, a missing receipt or a source that ends early.
 */
export async function scoreBench(m: BenchManifest, o: { out: string; pairs?: number; beforeStream?: () => Promise<void> | void }): Promise<BenchRecord> {
  const why = runRefusal(m, o.pairs);
  if (why) refuse(`refused: ${why}`);
  const body = m.body, sha = m.manifestSha256, out = resolve(o.out);
  for (const s of body.sources) {
    const now = await fileSha256(join(s.dir, "manifest.json")).catch(() => null);
    if (now !== s.manifestSha256) refuse(`refused: the source manifest of ${s.runId} changed since the plan`);
    const content = await contentProblem(s);
    if (content) refuse(`refused: ${content}`);
  }
  const copy = await readOrNull(join(out, MANIFEST_COPY));
  if (copy !== serializeManifest(m)) refuse(`refused: ${join(out, MANIFEST_COPY)} is missing or is another manifest's; --out is not this bench's run`);
  const missing: string[] = [];
  // Only a receipt that is not there refuses the score; any other error reaching it (an unreadable entry directory) is left to that
  // fork's pre-checks, which void it with the reason (amendment 2).
  for (const e of body.entries) if (!(await exists(join(out, e.id, RECEIPT)).catch(() => true))) missing.push(e.id);
  if (missing.length) refuse(`refused: ${missing.length} of ${body.entries.length} entries have no run receipt (first: ${missing[0]}); score needs every receipt (finish the run first)`);

  const cadence = body.sources.length ? body.entries[0].spec.censusEvery : 100;
  if (body.entries.some((e) => e.spec.censusEvery !== cadence)) refuse("refused: the entries do not share one census cadence");
  const horizon = Math.max(...body.entries.map((e) => e.C + e.steps));
  const N = body.sources.length;
  const preAll = await Promise.all(body.entries.map((e) => preProblems(e, join(out, e.id), sha)));
  const pre = preAll.map((p) => p.problems);
  const launches = new Map<string, number>();
  for (const line of ((await readOrNull(join(out, RUN_LOG)).catch(() => null)) ?? "").split("\n")) {
    try {
      const r = JSON.parse(line) as { id?: unknown; event?: unknown } | null;
      if (typeof r?.id === "string" && r.event === "start") launches.set(r.id, (launches.get(r.id) ?? 0) + 1);
    } catch {
      // a blank or torn line counts no launch
    }
  }

  // Each source's prediction window: the union of its rules entry's predictions' windows.
  const window = body.sources.map((_, i) => {
    const r = body.entries.find((e) => e.role === "rules" && e.source === i)!;
    const ps = rulesPredictions(r).map((x) => x.prediction).filter((p) => p.kind === "directional" || p.kind === "replay");
    return ps.length ? { from: Math.min(...ps.map((p) => p.fromStep!)), to: Math.max(...ps.map((p) => p.toStep!)) } : { from: Infinity, to: -Infinity };
  });
  const srcTrack = body.sources.map(() => new Map<number, (number | null)[]>());
  const srcExt = body.sources.map(() => new SignalExtractor());

  type Fork = { e: BenchEntry; end: number; scorer: PairScorer; ext: SignalExtractor; track: Map<number, (number | null)[]>; gen: AsyncGenerator<Census> | null; dead: string | null; n: number; expected: number };
  const forks: Fork[] = body.entries.map((e, j) => {
    const skip = pre[j].length ? `not read: ${pre[j].join("; ")}` : null;
    return {
      e,
      end: e.C + e.steps,
      scorer: new PairScorer(e.anchor, N, [{ id: e.id, arm: e.role, seed: e.draw ?? 0, base: e.source }], cadence),
      ext: new SignalExtractor(),
      track: new Map(),
      gen: skip ? null : (forkCensuses(e.id, join(out, e.id, runId(e.spec))) as AsyncGenerator<Census>),
      dead: skip,
      n: 0,
      expected: e.steps / cadence,
    };
  });
  const nextFork = async (f: Fork): Promise<TwinInput> => {
    if (f.dead !== null || f.gen === null) return { fail: f.dead ?? "no stream" };
    try {
      const n = await f.gen.next();
      if (n.done) {
        f.dead = `ended after ${f.n} censuses, expected ${f.expected}`;
        return { fail: f.dead };
      }
      f.n++;
      return n.value;
    } catch (err) {
      f.dead = errMsg(err);
      await f.gen.return(undefined).catch(() => {});
      return { fail: f.dead };
    }
  };
  await o.beforeStream?.();
  const srcReads = body.sources.map((s) => sourceCensuses(s.runId, s.dir, horizon));
  const srcGens = srcReads.map((r) => r.gen);
  // Every source file is closed on every exit, a refusal included (Codex pass 3); on success only after its digest is read.
  try {
    try {
      for (let t = cadence; t <= horizon; t += cadence) {
        const bn = await Promise.all(srcGens.map((g, i) => g.next().catch((err) => refuse(`${body.sources[i].runId}: ${errMsg(err)}`))));
        bn.forEach((n, i) => {
          if (n.done) refuse(`${body.sources[i].runId} ended before step ${t}; the forks run to ${horizon}`);
          if (n.value.rec.step !== t) refuse(`${body.sources[i].runId}: census at step ${n.value.rec.step} where step ${t} was expected`);
        });
        const bases = bn.map((n) => n.value as Census);
        bases.forEach((b, i) => {
          const v = srcExt[i].push(b.rec, b.rows);
          if (t >= window[i].from && t <= window[i].to) srcTrack[i].set(t, v);
        });
        const live = forks.filter((f) => t <= f.end);
        const inputs = await Promise.all(live.map((f) => (t <= f.e.C ? Promise.resolve<TwinInput>(bases[f.e.source]) : nextFork(f))));
        live.forEach((f, j) => {
          const inp = inputs[j];
          f.scorer.push(bases, [inp]);
          if (!("fail" in inp) && f.dead === null) {
            const v = f.ext.push(inp.rec, inp.rows);
            const w = window[f.e.source];
            if (t >= w.from && t <= w.to) f.track.set(t, v);
          }
        });
        // A fork must hold exactly its censuses: at its last step, one more read must find its stream finished.
        for (const f of live) {
          if (t !== f.end || f.dead !== null || f.gen === null) continue;
          try {
            const n = await f.gen.next();
            if (!n.done) f.scorer.fail(0, `more than ${f.expected} censuses`);
          } catch (err) {
            f.scorer.fail(0, errMsg(err));
          }
        }
      }
    } finally {
      await Promise.allSettled([...srcGens, ...forks.map((f) => f.gen).filter((g) => g !== null)].map((g) => g!.return(undefined)));
    }
    // The bytes scored are the bytes the plan bound: each source file's digest over what was read, read on to its end (amendment 2).
    for (const [i, s] of body.sources.entries()) {
      const got = await srcReads[i].digests().catch((e) => refuse(`refused: ${s.runId}: its files could not be read to the end after scoring (${errMsg(e)})`));
      for (const [file, key] of SOURCE_CONTENT) if (got[key] !== s[key]) refuse(`refused: the source ${file} of ${s.runId} that was scored is not the one the plan bound (sha256 ${got[key]}, the plan says ${s[key]}); it changed during scoring`);
    }
  } finally {
    await Promise.allSettled(srcReads.map((r) => r.close()));
  }

  const kindsOf = (e: BenchEntry) => (e.spec.interventions ?? []).map((x) => (x.kind === "lesion" ? "lesion" : x.kind === "sun" ? "sun" : x.amount > 0 ? "feed" : "drain"));
  const scores: ForkScore[] = forks.map((f, j) => {
    const r = f.scorer.results()[0];
    const reasons = benchVoidReasons(r, f.e.anchor, pre[j].length ? pre[j].join("; ") : null);
    const valid = reasons.length === 0;
    const d11 = r.dBySignal.filter((x) => isV1Signal(x.signal)).reduce((mx, x) => Math.max(mx, x.D), 0);
    const applied = preAll[j].applied;
    const delivered = { feedMatter: applied ? appliedFeedMatter(applied) : null, step: r.dose.step, livingCellsDelta: r.dose.livingCells.delta, matterDelta: r.dose.matter.delta };
    return { id: f.e.id, role: f.e.role, source: f.e.source, anchor: f.e.anchor, valid, voidReasons: reasons, D: valid ? r.D : null, D11: valid ? d11 : null, signal: valid ? r.signal : null, side: valid ? r.side : null, firstDiffStep: r.firstDiffStep, kinds: kindsOf(f.e), delivered };
  });
  const predictions: PredictionOutcome[] = [];
  body.sources.forEach((_, i) => {
    const idx = (role: string) => forks.map((f, j) => ({ f, j })).filter(({ f }) => f.e.role === role && f.e.source === i).sort((a, b) => (a.f.e.draw ?? 0) - (b.f.e.draw ?? 0));
    const rules = idx("rules")[0];
    for (const p of rulesPredictions(rules.f.e)) {
      const decide = (x: { f: Fork; j: number }): { holds: boolean | null; reason: string | null } => {
        if (!scores[x.j].valid) return { holds: null, reason: `${x.f.e.id} is void` };
        try {
          return { holds: predictionHolds(p.prediction, cadence, srcTrack[i] as SignalTrack, x.f.track as SignalTrack), reason: null };
        } catch (err) {
          return { holds: null, reason: errMsg(err) };
        }
      };
      const main = decide(rules);
      predictions.push({ source: i, ring: p.ring, signal: p.signal, statement: p.prediction.statement, rules: main.holds, reason: main.reason, count: idx("count").map((x) => decide(x).holds), dose: idx("dose").map((x) => decide(x).holds) });
    }
  });
  return {
    rule: "proposer-bench-v0",
    note: body.note,
    manifestSha256: sha,
    approval: m.approval,
    out,
    parameters: {
      constants: body.constants,
      cadence,
      horizon,
      score: "bell v1 PairScorer, unchanged: z = (fork - source) / spread over the sources at t (v0's spread); 13 signals; windows of W_pair censuses whose first census is from anchor + earlyFrom to anchor + earlyTo; D = max over windows, sides and signals of the window minimum of side*z, floored at 0; the anchor is the fork's first entry step; a fork that passes every check and never differs from its source after the anchor is valid with D = 0 (amendment 1)",
      test: "per baseline role: a rules win iff D_rules > the median of its source's three draws (ties are not wins); rules beat the role iff wins >= winsToBeat; a role beats the rules iff losses >= winsToBeat; called only when every pair is valid and the bench has the bars' number of pairs",
    },
    forks: scores,
    summary: summarizeBench(body, scores, predictions, BENCH_V0, launches),
  };
}

