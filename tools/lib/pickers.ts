// Pickers for tools/run.ts's `--picker` (wild sandbox; packages/runner/src/picks.ts): who chooses a pond boundary's donors
// when it is not the arm's rule. All I/O goes through `PickIo` and `RunCommand`, so vitest drives them with fakes; `denoIo`
// and `denoRun` are the real ones.
//
//   rule     the arm's own donors (`req.suggested`): reproduces the unpicked run exactly.
//   random   seeded and uniform over the ponds able to found a pond (all occupied ones when none is), the same count as
//            the rule's: the control for a judgment, with the same pool and count and none of the judgment.
//   file     writes b<NNN>-request.json and b<NNN>-sheet.png (and album.png) into the pick directory, then waits for the
//            file the request's `answer` names (b<NNN>-picks-<nonce>.json: one per request, so an answer to an earlier
//            attempt lands elsewhere) to appear, complete and valid: {"donors":[...]} or a bare array.
//            Once a boundary is committed, replayed ones included, b<NNN>-applied.json (the request's `applied`) holds the
//            donors the run applied there: what an answerer with a memory checks its own record against.
//   command  writes the same files, runs a command with the pick directory as its cwd and the request JSON on stdin, and
//            takes {"donors":[...]} (or a bare array) from its stdout. The command and its descendants are ended at the
//            deadline, and output past OUTPUT_LIMIT bytes on either stream fails the pick.
//
// The request a person or command sees (`requestJson`) never carries the arm's donors, scores or ranks; neither does
// the sheet (pond-sheet.ts). A pick directory belongs to one run (owner.json, `claimPickDir`): another run is refused.
import { cellBase, draw, type WorldState } from "@bl/schema";
import { thrownMessage, type PickRequest, type Picker } from "@bl/runner";
import { ALBUM_ROWS, ALBUM_TILES, FOUNDING_MASS, albumSheet, foundingEligible, pondSheet, tileRgb } from "./pond-sheet.ts";
import { encodePng } from "./png.ts";
import { OUTPUT_LIMIT, runBounded } from "./run-command.ts";

/** Everything a picker touches outside memory. */
export interface PickIo {
  mkdir(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  /** Size in bytes. */
  size(path: string): Promise<number>;
  /** Modification time, ms since the epoch. */
  mtime(path: string): Promise<number>;
  remove(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  /** Writes `text` to `path` only if nothing is there (atomically); whether it did. */
  createNew(path: string, text: string): Promise<boolean>;
  /** `path` as the file system knows it (`canonicalPath`): two spellings of one directory give one string. */
  canonical(path: string): Promise<string>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Milliseconds, monotonic or wall: only differences are used. */
  now(): number;
}

export interface CommandResult {
  /** Exit code; null when the process was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Either stream passed `opts.maxBytes`: the process was killed and its output is cut. */
  overflow?: boolean;
}
/** Runs `argv` with `cwd`, `stdin` on its standard input, ending it and its descendants at `timeoutMs` or when a stream passes `maxBytes`; the output of a timed-out run is never used. */
export type RunCommand = (argv: readonly string[], opts: { cwd: string; stdin: string; timeoutMs: number; maxBytes: number }) => Promise<CommandResult>;

/** The files of one boundary, as `requestJson` lists them. */
export interface PickFiles {
  nonce: string;
  dir: string;
  sheet: string;
  /** null before the first applied cycle. */
  album: string | null;
  answer: string;
  /** Written once the boundary is committed: `{cycle, step, donors, by}`, the donors the run applied. */
  applied: string;
}

/** What a person or command sees of a boundary. The key set is pinned by a test: no `suggested`, no scores, no ranks. */
export interface PickRequestJson {
  version: 1;
  nonce: string;
  cycle: number;
  step: number;
  dir: string;
  sheet: string;
  album: string | null;
  grid: { x: number; y: number };
  tile: number;
  ponds: number;
  occupied: number[];
  eligible: number[];
  foundingMass: number;
  donors: { min: 1; max: number };
  answer: string;
  applied: string;
}

export function requestJson(req: PickRequest, files: PickFiles): PickRequestJson {
  const cfg = req.pre.cfg;
  return {
    version: 1,
    nonce: files.nonce,
    cycle: req.cycle,
    step: req.step,
    dir: files.dir,
    sheet: files.sheet,
    album: files.album,
    grid: { x: cfg.tilesX, y: cfg.tilesY },
    tile: cfg.tileW,
    ponds: cfg.tilesX * cfg.tilesY,
    occupied: [...req.occupied],
    eligible: foundingEligible(req.pre, req.k).eligible,
    foundingMass: FOUNDING_MASS,
    donors: { min: 1, max: req.max },
    answer: files.answer,
    applied: files.applied,
  };
}

/** Donors out of an answer text: `{"donors":[...]}` or a bare array of numbers. Whether they are valid ponds is the runner's check. */
export function parseAnswer(text: string): number[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`the answer is not JSON: ${text.slice(0, 80)}`);
  }
  const donors = Array.isArray(v) ? v : (v as { donors?: unknown } | null)?.donors;
  if (!Array.isArray(donors) || !donors.every((d) => typeof d === "number")) throw new Error(`the answer has no donors array: ${text.slice(0, 80)}`);
  return donors as number[];
}

const POOL_SALT = 0x5049434b;

/** `count` ponds of `pool` (ascending), by ascending key `draw(cellBase((seed ^ POOL_SALT) >>> 0, b, pond), 0)`, ties by pond. Pure. */
export function randomPicks(seed: number, b: number, pool: readonly number[], count: number): number[] {
  return pool
    .map((pond) => ({ pond, key: draw(cellBase((seed ^ POOL_SALT) >>> 0, b, pond), 0) }))
    .sort((x, y) => x.key - y.key || x.pond - y.pond)
    .slice(0, Math.min(count, pool.length))
    .map((o) => o.pond);
}

export function rulePicker(): Picker {
  return { name: "rule", pick: async (req) => [...req.suggested] };
}

/** Uniform over the ponds able to found a pond (all occupied ones when none is), `req.max` of them (the whole pool when smaller). */
export function randomPicker(seed: number): Picker {
  return {
    name: "random",
    pick: async (req) => {
      const { occupied, eligible } = foundingEligible(req.pre, req.k);
      return randomPicks(seed, req.cycle, eligible.length ? eligible : occupied, req.max);
    },
  };
}

/** A deadline for a message: whole seconds, milliseconds under one. */
const span = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
const b3 = (cycle: number) => String(cycle).padStart(3, "0");
/** A nonce as a file name part. */
const fileSafe = (nonce: string) => nonce.replace(/[^A-Za-z0-9_.-]/g, "-");
const ALBUM_FILE = "album.png";

const OWNER_FILE = "owner.json";

/**
 * Makes `dir` the pick directory of `run` (a run's identity: its bundle directory), or says why it cannot be: it belongs
 * to another run. One run to a directory: the notebook, the album and the applied records in it are that run's memory,
 * and what a second run wrote there would pass for the first's.
 */
export async function claimPickDir(io: PickIo, dir: string, run: string): Promise<string | null> {
  await io.mkdir(dir);
  if (await io.createNew(`${dir}/${OWNER_FILE}`, JSON.stringify({ run: await io.canonical(run) }) + "\n")) return null;
  return pickDirTaken(io, dir, run);
}

/**
 * Why `dir` cannot be `run`'s pick directory, or null: it is claimed by another run. Reads only, so it can be asked
 * before anything is changed. Runs are compared by their canonical bundle directory, on both sides: a recovery through
 * another spelling of the same directory (a symbolic link, /tmp for /private/tmp) is the same run.
 */
export async function pickDirTaken(io: PickIo, dir: string, run: string): Promise<string | null> {
  const path = `${dir}/${OWNER_FILE}`;
  if (!(await io.exists(path))) return null;
  let owner: unknown;
  try {
    owner = (JSON.parse(await io.readText(path)) as { run?: unknown } | null)?.run;
  } catch {
    owner = undefined;
  }
  if (typeof owner === "string" && (await io.canonical(owner)) === (await io.canonical(run))) return null;
  return `${dir} is the pick directory of another run (${typeof owner === "string" ? owner : `its ${OWNER_FILE} is unreadable`}); give this run its own --pick-dir`;
}

/** What a dir picker hands its answerer. */
export interface AnswerContext {
  req: PickRequest;
  json: PickRequestJson;
  dir: string;
  /** Absolute path of the request file this answer follows. */
  requestPath: string;
  answerPath: string;
}
export type Answerer = (ctx: AnswerContext) => Promise<number[]>;

/**
 * A picker that shows each boundary as files in `dir` and gets the donors from `answer`. Writes
 * b<NNN>-request.json and b<NNN>-sheet.png (the sheet of the state alone) before asking, removing any stale answer
 * and applied file first; after the boundary is committed (`applied`, replayed boundaries included) it writes the donors
 * the run applied to b<NNN>-applied.json and adds their tiles to album.png, so both are rebuilt from state and donors
 * when a run is replayed. `name` is what the log's `by` says. With `run` (the run's identity), the directory is claimed
 * for that run before anything is written (`claimPickDir`), and a directory of another run is an error.
 */
export function dirPicker(opts: { dir: string; io: PickIo; answer: Answerer; name: string; nonce?: (cycle: number) => string; run?: string }): Picker {
  const { dir, io, answer, name } = opts;
  let mine = opts.run === undefined;
  const claim = async () => {
    if (mine) return;
    const bad = await claimPickDir(io, dir, opts.run!);
    if (bad) throw new Error(bad);
    mine = true;
  };
  const rows: { cycle: number; tiles: Uint8Array[]; size: number }[] = [];
  const nonceOf = opts.nonce ?? ((cycle: number) => `c${cycle}-${Math.floor(io.now()).toString(16)}`);
  const writeAlbum = async () => {
    if (rows.length) {
      const sheet = albumSheet(rows);
      await io.writeBytes(`${dir}/${ALBUM_FILE}`, await encodePng(sheet.width, sheet.height, sheet.rgb));
    }
  };
  return {
    name,
    async pick(req) {
      await claim();
      const n = b3(req.cycle);
      const nonce = nonceOf(req.cycle);
      const files: PickFiles = { nonce, dir, sheet: `b${n}-sheet.png`, album: rows.length ? ALBUM_FILE : null, answer: `b${n}-picks-${fileSafe(nonce)}.json`, applied: `b${n}-applied.json` };
      const answerPath = `${dir}/${files.answer}`;
      await io.mkdir(dir);
      // A boundary that is being asked is not committed: what an earlier use of the directory left for it is stale.
      for (const stale of [answerPath, `${dir}/${files.applied}`]) if (await io.exists(stale)) await io.remove(stale);
      const sheet = pondSheet(req.pre);
      await io.writeBytes(`${dir}/${files.sheet}`, await encodePng(sheet.width, sheet.height, sheet.rgb));
      const json = requestJson(req, files);
      const requestPath = `${dir}/b${n}-request.json`;
      await io.writeText(requestPath, JSON.stringify(json, null, 2) + "\n");
      return answer({ req, json, dir, requestPath, answerPath });
    },
    async applied(req: PickRequest, donors: readonly number[], by: string) {
      await claim();
      const scale = 2;
      const state: WorldState = req.pre;
      rows.push({ cycle: req.cycle, tiles: donors.slice(0, ALBUM_TILES).map((p) => tileRgb(state, p, scale)), size: state.cfg.tileW * scale });
      if (rows.length > ALBUM_ROWS) rows.splice(0, rows.length - ALBUM_ROWS);
      await io.mkdir(dir);
      // First, so that a failing album still leaves the commitment on record.
      await io.writeText(`${dir}/b${b3(req.cycle)}-applied.json`, JSON.stringify({ cycle: req.cycle, step: req.step, donors: [...donors], by }) + "\n");
      await writeAlbum();
    },
  };
}

/** The result of `p` if it settles within `ms`, else undefined (a hung read: the answer path may be a pipe). */
async function inTime<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  try {
    return await Promise.race([p, new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), Math.max(ms, 0))))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits for the answer file the request names (one path per request, so an answer to an earlier attempt of the boundary
 * lands elsewhere). Publication contract: the answerer writes the file and renames it into place (atomic), or a person
 * does; since a size check alone cannot tell a paused writer from a finished one, the file is read only once its size is
 * unchanged between two polls and it parses. An unparsable stable file at the deadline is an invalid answer, not a retry;
 * a `{donors, nonce}` object with another nonce is a stale answer and is ignored; an answer without this request's nonce
 * (a bare array, an object with none) is taken only if the file is newer than the request. Stops at the deadline: each
 * poll's I/O is bounded by it, and an answer that completes after it is not taken.
 */
export function fileAnswerer(opts: { io: PickIo; timeoutMs: number; pollMs?: number }): Answerer {
  const { io, timeoutMs } = opts;
  const pollMs = opts.pollMs ?? 500;
  return async ({ json, requestPath, answerPath }) => {
    const deadline = io.now() + timeoutMs;
    let lastSize = -1;
    let invalid: string | null = null;
    /** One poll: the donors when a stable, valid, current answer is there. */
    const poll = async (): Promise<number[] | undefined> => {
      if (!(await io.exists(answerPath))) {
        lastSize = -1;
        return undefined;
      }
      const size = await io.size(answerPath);
      const stable = size === lastSize;
      lastSize = size;
      if (!stable) return undefined;
      try {
        const text = await io.readText(answerPath);
        const v = JSON.parse(text) as unknown;
        const nonce = Array.isArray(v) ? undefined : (v as { nonce?: unknown } | null)?.nonce;
        const mine = typeof nonce === "string" && nonce === json.nonce;
        const stale = typeof nonce === "string" && !mine;
        const old = !mine && (await io.mtime(answerPath)) <= (await io.mtime(requestPath));
        invalid = null;
        if (!stale && !old) return parseAnswer(text);
      } catch (e) {
        invalid = thrownMessage(e);
      }
      return undefined;
    };
    while (io.now() < deadline) {
      const got = await inTime(poll(), deadline - io.now());
      // An answer that finished after the deadline is as late as one that appears after it.
      if (got && io.now() < deadline) return got;
      await io.sleep(pollMs);
    }
    throw new Error(invalid ? `${json.answer} was not a valid answer by the deadline: ${invalid}` : `no answer in ${json.answer} within ${span(timeoutMs)}`);
  };
}

/** Runs `argv` (cwd = the pick directory) with the request JSON on stdin; the answer is its stdout. A non-zero exit, output past the cap or the deadline is a failure. */
export function commandAnswerer(opts: { argv: readonly string[]; run: RunCommand; timeoutMs: number; maxBytes?: number }): Answerer {
  const maxBytes = opts.maxBytes ?? OUTPUT_LIMIT;
  return async ({ json, dir }) => {
    const res = await opts.run(opts.argv, { cwd: dir, stdin: JSON.stringify(json), timeoutMs: opts.timeoutMs, maxBytes });
    if (res.timedOut) throw new Error(`${opts.argv[0]} did not answer within ${span(opts.timeoutMs)}`);
    if (res.overflow) throw new Error(`${opts.argv[0]} wrote more than ${maxBytes} bytes and was stopped`);
    if (res.code !== 0) throw new Error(`${opts.argv[0]} exited with ${res.code === null ? "a signal" : `code ${res.code}`}${res.stderr.trim() ? `: ${res.stderr.trim().slice(0, 500)}` : ""}`);
    return parseAnswer(res.stdout);
  };
}

/**
 * `path` as an absolute path the way the file system resolves it: symbolic links followed for as much of it as exists
 * (a fresh bundle directory does not yet), `..` taken from the resolved directory, not from the spelling.
 */
export async function canonicalPath(path: string): Promise<string> {
  let at = "/";
  let exists = true;
  for (const part of (path.startsWith("/") ? path : `${Deno.cwd()}/${path}`).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      at = at.replace(/\/[^/]*$/, "") || "/";
      continue;
    }
    const next = at === "/" ? `/${part}` : `${at}/${part}`;
    if (exists)
      try {
        at = await Deno.realPath(next);
        continue;
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
        exists = false;
      }
    at = next;
  }
  return at;
}

export const denoIo: PickIo = {
  mkdir: (dir) => Deno.mkdir(dir, { recursive: true }),
  exists: (path) => Deno.stat(path).then(() => true, () => false),
  readText: (path) => Deno.readTextFile(path),
  size: async (path) => (await Deno.stat(path)).size,
  mtime: async (path) => (await Deno.stat(path)).mtime?.getTime() ?? 0,
  remove: (path) => Deno.remove(path),
  writeText: (path, text) => Deno.writeTextFile(path, text),
  createNew: (path, text) => Deno.writeTextFile(path, text, { createNew: true }).then(() => true, (e) => (e instanceof Deno.errors.AlreadyExists ? false : Promise.reject(e))),
  canonical: canonicalPath,
  writeBytes: (path, bytes) => Deno.writeFile(path, bytes),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export const denoRun: RunCommand = (argv, { cwd, stdin, timeoutMs, maxBytes }) => runBounded(argv, { cwd, stdin, timeoutMs, maxBytes });
