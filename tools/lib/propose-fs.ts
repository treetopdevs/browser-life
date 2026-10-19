// The proposer's file side: reading a source bundle and its notes, checking a fork point against the bundle (step 0 by rebuilding
// the start world and matching the manifest's initHash, a checkpoint by decoding it, matching its stateHash and asking the runner's
// continuationError whether the fork's spec can continue it), the --out guard, the replay check that compares a fork's
// series.jsonl with its source's, streamed, and what `run` writes and exits with after tools/run.ts. The rules are
// docs/naturalist-proposer-v0-2026-10-18.md; the pure core is ./propose.ts. Written on node:fs so it runs under Deno (the CLI)
// and under vitest (its tests) alike.
import { createReadStream } from "node:fs";
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { cwd } from "node:process";
import { PRESETS, initWorld, sha256Hex, stateHash } from "@bl/schema";
import { continuationError, decodeArtifact, specConfig, type ObserverState, type RunSpec } from "@bl/runner";
import type { WorldState } from "@bl/schema";
import {
  BUNDLE_FILES,
  RULES_V0,
  bindNotesToManifest,
  buildForkSpec,
  canonical,
  parseNotes,
  parseSourceManifest,
  proposeFromNotes,
  randomBaseline,
  sourceRefusal,
  type ForkCheck,
  type NotesFile,
  type Proposal,
  type ProposeResult,
  type SourceManifest,
} from "./propose.ts";

export const fileSha256 = async (path: string): Promise<string> => sha256Hex(new Uint8Array(await readFile(path)));

/** A notes file's text and SHA-256 from one read, so the hash checked is the hash of the text parsed (a BOM is kept, as readFile's utf8 keeps it). */
export async function readNotesFile(path: string): Promise<{ text: string; sha256: string }> {
  const bytes = new Uint8Array(await readFile(path));
  return { text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), sha256: await sha256Hex(bytes) };
}

const notFound = (e: unknown) => (e as { code?: string })?.code === "ENOENT" || (e as { code?: string })?.code === "ENOTDIR";
async function realOrNull(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

export interface LoadedSource {
  /** The bundle directory as an absolute real path. */
  dir: string;
  manifest: SourceManifest;
  manifestSha256: string;
  sizes: Record<(typeof BUNDLE_FILES)[number], number>;
}

/** Reads a bundle's manifest (with its SHA-256) and the byte sizes of its three files. Throws naming a missing file. */
export async function loadSource(dir: string): Promise<LoadedSource> {
  const real = await realOrNull(dir);
  if (!real) throw new Error(`no bundle at ${dir}`);
  const sizes = {} as LoadedSource["sizes"];
  for (const f of BUNDLE_FILES) {
    const st = await stat(join(real, f)).catch(() => null);
    if (!st?.isFile()) throw new Error(`${dir} has no ${f}`);
    sizes[f] = st.size;
  }
  const bytes = new Uint8Array(await readFile(join(real, "manifest.json")));
  return { dir: real, manifest: parseSourceManifest(new TextDecoder().decode(bytes)), manifestSha256: await sha256Hex(bytes), sizes };
}

/** Why step 0 of the source cannot be rebuilt here, or null: its config must be the spec's and the start world's stateHash its initHash. */
export function initError(m: SourceManifest): string | null {
  const preset = PRESETS.find((p) => p.id === m.spec.presetId);
  if (!preset) return `unknown preset ${m.spec.presetId}`;
  let cfg;
  try {
    cfg = specConfig(m.spec);
  } catch (e) {
    return `the source's spec does not build a config: ${(e as Error).message}`;
  }
  const a = cfg as unknown as Record<string, unknown>, b = m.cfg as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differs = [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (differs.length) return `the source's recorded config differs from the one its spec builds in this checkout (${differs.slice(0, 5).join(", ")})`;
  const h = stateHash(initWorld(cfg, preset.init));
  if (h !== m.initHash) return `the start world this checkout builds hashes to ${h}, the source's initHash is ${m.initHash}`;
  return null;
}

/**
 * A checkpoint of the manifest, decoded and checked (step, stateHash, and that `spec` can continue it: the runner's own
 * continuationError, so a checkpoint whose config or observer settings the fork cannot take is never chosen), or a thrown message.
 */
export async function readCheckpoint(dir: string, m: SourceManifest, step: number, spec: RunSpec): Promise<{ state: WorldState; observer: ObserverState; entry: { step: number; file: string; hash: string } }> {
  const entry = (m.checkpoints ?? []).find((c) => c.step === step);
  if (!entry) throw new Error(`the manifest lists no checkpoint at step ${step}`);
  if (isAbsolute(entry.file) || entry.file.split(/[/\\]/).includes("..")) throw new Error(`checkpoint ${entry.file} is not a path inside the bundle`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(join(dir, entry.file)));
  } catch (e) {
    throw new Error(`checkpoint ${entry.file} cannot be read: ${(e as Error).message}`);
  }
  const { state, observer } = decodeArtifact(bytes);
  if (state.step !== step) throw new Error(`checkpoint ${entry.file} holds step ${state.step}, not ${step}`);
  const h = stateHash(state);
  if (h !== entry.hash) throw new Error(`checkpoint ${entry.file} hashes to ${h}, the manifest says ${entry.hash}`);
  const cannot = continuationError(spec, state, observer);
  if (cannot) throw new Error(`checkpoint ${entry.file} cannot start the fork: ${cannot}`);
  return { state, observer, entry };
}

/**
 * The fork point for S, checked (the note, "Where a fork starts"): the largest checkpoint before S, on the census grid, that reads,
 * decodes, hashes to its entry and that the fork's spec can continue, else step 0 (whose initHash the caller has checked with
 * `initError`). Results are cached per step; `onSkip` hears about every checkpoint that fails.
 */
export function forkChecker(dir: string, m: SourceManifest, onSkip: (msg: string) => void = () => {}): (S: number) => Promise<ForkCheck> {
  const cache = new Map<number, ForkCheck | null>();
  return async (S: number) => {
    const candidates = [...new Set((m.checkpoints ?? []).map((c) => c.step))].filter((t) => t > 0 && t < S).sort((x, y) => y - x);
    for (const t of candidates) {
      if (!cache.has(t)) {
        if (t % m.spec.censusEvery !== 0) {
          onSkip(`checkpoint at step ${t} does not count: it is not a census step (cadence ${m.spec.censusEvery})`);
          cache.set(t, null);
        } else {
          try {
            // The fork's settings and config do not depend on its length or interventions: any fork spec from this source will do.
            const { entry } = await readCheckpoint(dir, m, t, buildForkSpec(m, t, t, RULES_V0.horizon, []));
            cache.set(t, { step: t, check: "checkpoint", hash: entry.hash, file: entry.file });
          } catch (e) {
            onSkip(`checkpoint at step ${t} does not count: ${(e as Error).message}`);
            cache.set(t, null);
          }
        }
      }
      const got = cache.get(t);
      if (got) return got;
    }
    return { step: 0, check: "initHash", hash: m.initHash! };
  };
}

/** Re-checks a stored fork point against the bundle and the fork's spec (run's gate): step 0 by initHash, a checkpoint by its file and continuationError. Null when it holds. */
export async function forkPointError(dir: string, m: SourceManifest, fork: ForkCheck, spec: RunSpec): Promise<string | null> {
  if (fork.step === 0) return fork.hash === m.initHash ? initError(m) : `the proposal's initHash ${fork.hash} is not the source's ${m.initHash}`;
  try {
    const { entry } = await readCheckpoint(dir, m, fork.step, spec);
    if (entry.hash !== fork.hash || entry.file !== fork.file) return `the checkpoint at step ${fork.step} is not the one the proposal names`;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * The rules' proposals for a bundle and its notes (`propose`, and `rederive` below): each ring's fork point checked against the
 * bundle (forkChecker), then proposeFromNotes. Throws as proposeFromNotes does.
 */
export async function proposalsFor(src: LoadedSource, notes: NotesFile, notesRef: { path: string; sha256: string }, onSkip: (msg: string) => void = () => {}): Promise<ProposeResult> {
  const check = forkChecker(src.dir, src.manifest, onSkip);
  const forks = new Map<number, ForkCheck>();
  for (const r of notes.rings) {
    const S = r.receipt.endStep;
    if (S + RULES_V0.horizon <= src.manifest.spec.steps && !forks.has(S)) forks.set(S, await check(S));
  }
  return proposeFromNotes({ notes, notesRef, manifest: src.manifest, source: { dir: src.dir, manifestSha256: src.manifestSha256 }, forkFor: (S) => forks.get(S)!, constants: RULES_V0 });
}

/**
 * Re-derives a proposal from the files it names, not from its own body (amendment 2026-10-18, "Pass 2: a body is re-derived from
 * its files"): the bundle at source.dir, which must be that bundle's absolute real path, with the manifest SHA-256 the body records,
 * a source v0 can fork and a start world that checks; the notes at notes.path, likewise an absolute real path, with the SHA-256 the
 * body records and describing this bundle; then the rules run again on them (fork points re-checked). A rules body must be one of
 * the proposals they give, in canonical JSON; a random fork must be its seed's baseline of the proposal it names. So the ring,
 * the fork step, the duplicates and the matched proposal are all bound to the notes and the bundle. Never throws: returns the
 * loaded source, or the refusal.
 */
export async function rederive(p: Proposal): Promise<{ src: LoadedSource; refusal?: undefined } | { src?: undefined; refusal: string }> {
  try {
    const b = p.body;
    if (typeof b?.source?.dir !== "string" || !isAbsolute(b.source.dir)) return { refusal: "source.dir is not an absolute path" };
    let src: LoadedSource;
    try {
      src = await loadSource(b.source.dir);
    } catch (e) {
      return { refusal: (e as Error).message };
    }
    if (src.dir !== b.source.dir) return { refusal: `source.dir ${b.source.dir} is not the bundle's real path ${src.dir}` };
    if (src.manifestSha256 !== b.source.manifestSha256) return { refusal: `the source manifest changed since the proposal (sha256 ${src.manifestSha256}, the proposal says ${b.source.manifestSha256})` };
    const why = sourceRefusal(src.manifest);
    if (why) return { refusal: why };
    const initBad = initError(src.manifest);
    if (initBad) return { refusal: `step 0 of the source does not check: ${initBad}` };
    const np = b.notes?.path;
    if (typeof np !== "string" || !isAbsolute(np) || (await realOrNull(np)) !== np) return { refusal: `notes.path ${JSON.stringify(np)} is not the absolute real path of a notes file` };
    const { text: notesText, sha256: sha } = await readNotesFile(np); // one read: the text parsed is the text hashed
    if (sha !== b.notes.sha256) return { refusal: `the notes file changed since the proposal (sha256 ${sha}, the proposal says ${b.notes.sha256})` };
    let notes: NotesFile;
    try {
      notes = parseNotes(notesText, RULES_V0);
      bindNotesToManifest(notes, src.manifest, src.sizes);
    } catch (e) {
      return { refusal: (e as Error).message };
    }
    let made: ProposeResult;
    try {
      made = await proposalsFor(src, notes, { path: np, sha256: sha });
    } catch (e) {
      return { refusal: `the rules no longer propose from these files: ${(e as Error).message}` };
    }
    const want = canonical(b);
    if (b.generator === "rules-v0") {
      if (!made.proposals.some((q) => canonical(q.body) === want)) return { refusal: "the body is not a proposal the rules give for its notes and bundle (its ring, fork, duplicates or text differ)" };
    } else {
      const matched = made.proposals.find((q) => q.id === b.baseline?.matches);
      if (!matched) return { refusal: `baseline.matches ${JSON.stringify(b.baseline?.matches)} is not a proposal the rules give for these notes and this bundle` };
      const again = randomBaseline(matched, b.baseline!.seed);
      if (!again || canonical(again.body) !== want) return { refusal: `the body is not the seed ${b.baseline!.seed} baseline of proposal ${matched.id}` };
    }
    return { src };
  } catch (e) {
    return { refusal: `the proposal is malformed (${(e as Error).message})` };
  }
}

// ---------------------------------------------------------------------------------------------
// --out guard (the note, "Where output goes"). The canonical form follows tools/notebook.ts's: resolved component by component, so a
// ".." after a symlink climbs from the link's target as the OS does; a part that does not exist is appended as written.

async function canonicalPath(p: string): Promise<string> {
  const abs = isAbsolute(p) ? p : `${cwd()}${sep}${p}`;
  const root = parse(abs).root;
  let cur = (await realOrNull(root)) ?? root;
  for (const part of abs.slice(root.length).split(/[/\\]+/)) {
    if (!part || part === ".") continue;
    const next = part === ".." ? dirname(cur) : join(cur, part);
    cur = (await realOrNull(next)) ?? next;
  }
  return cur;
}
const climbs = (rel: string) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
const inside = (child: string, parent: string) => !climbs(relative(parent, child));

/** The four path components a bundle of this run sits under in a runs tree. */
export interface RunKey {
  experiment: string;
  presetId: string;
  condition: string;
  seed: number;
}

/**
 * The runs tree that holds a bundle: the directory four levels above it when the bundle's last four path components are its
 * run's <experiment>/<preset>/<condition>/seed-<n> (compared without case), else null (a bundle outside a runs tree has only itself to guard).
 */
export function runsTreeOf(dir: string, key: RunKey): string | null {
  const parts = resolve(dir).split(sep);
  const want = [key.experiment, key.presetId, key.condition, `seed-${key.seed}`];
  if (parts.length < 5) return null; // "/" + four components: a runs tree at the root is "/"
  const tail = parts.slice(-4);
  // Without case, as guardOut compares: on a case-insensitive filesystem (macOS APFS) runs/x/Neutral is runs/x/neutral. On a
  // case-sensitive one this can guard a tree that is not the source's: a refusal too many, never a write too many.
  const fold = (x: string) => x.normalize("NFC").toLowerCase();
  return tail.every((p, i) => fold(p) === fold(want[i])) ? parts.slice(0, -4).join(sep) || sep : null;
}

/**
 * runsTreeOf, and when its spelling test fails, the filesystem's own answer (pass 4): the directory four levels up is the runs tree
 * when <it>/<experiment>/<preset>/<condition>/seed-<n>, spelled as the run key spells it, is the bundle itself (the same real
 * path: realpath returns the stored spelling). So any alias the filesystem folds (case beyond toLowerCase, such as "ſ" for "s" on
 * APFS, or Unicode normalisation) is caught too. Throws when a lookup fails other than "not found".
 */
export async function runsTreeOnDisk(dir: string, key: RunKey): Promise<string | null> {
  const byName = runsTreeOf(dir, key);
  if (byName) return byName;
  const parts = resolve(dir).split(sep);
  if (parts.length < 5) return null; // "/" + four components: a runs tree at the root is "/"
  const base = parts.slice(0, -4).join(sep) || sep;
  // Real paths, not inodes (a FUSE filesystem may repeat st_ino); a lookup that fails other than "not found" throws, so the guard
  // refuses rather than passing for want of an answer (pass 5).
  const a = await realOrNull(dir), b = await realOrNull(join(base, key.experiment, key.presetId, key.condition, `seed-${key.seed}`));
  return a !== null && a === b ? base : null;
}

/** The run key of a body's `source.runId` (<experiment>/<preset>/<condition>/seed-<n>), or null. */
export function runKeyOf(runId: string): RunKey | null {
  const p = runId.split("/");
  return p.length === 4 && /^seed-(0|[1-9]\d*)$/.test(p[3]) ? { experiment: p[0], presetId: p[1], condition: p[2], seed: Number(p[3].slice(5)) } : null;
}

/**
 * Throws (a refusal) when `out` lies inside the repository's runs/, the source's runs tree, or the source bundle: each checked as
 * given and by real path, without case. Creates nothing. `approve` passes the directory of the file it rewrites.
 */
export async function guardOut(out: string, repoRoot: string, source: { dir: string; given?: string; key: RunKey | null }, label = "--out"): Promise<void> {
  const fold = (p: string) => p.toLowerCase();
  const outs = [resolve(out), await canonicalPath(out), await canonicalPath(resolve(out))];
  const guarded: [string, string][] = [[join(repoRoot, "runs"), "the repository's runs/"], [source.dir, "the source bundle"]];
  if (source.given) guarded.push([source.given, "the source bundle"]);
  for (const d of [source.dir, source.given]) {
    if (!d || !source.key) continue;
    const tree = await runsTreeOnDisk(d, source.key);
    if (tree) guarded.push([tree, `the runs tree that holds the source (${tree})`]);
  }
  for (const [p, what] of guarded) {
    const pAbs = resolve(p), pCanon = await canonicalPath(p);
    for (const o of outs) for (const g of [pAbs, pCanon]) if (inside(fold(o), fold(g))) throw new Error(`refused: ${label} ${out} is inside ${what}; the proposer never writes into a runs tree or a bundle`);
  }
}

// ---------------------------------------------------------------------------------------------
// The replay check (the note, "The replay check"), streamed.

/** A file's lines, split on "\n" only: a "\r" stays part of its line, so the comparison is byte for byte. */
async function* fileLines(path: string): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    const parts = (rest + (chunk as string)).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest !== "") yield rest;
}

const STEP = /^\{"step":(\d+)[,}]/;
function stepOf(line: string, what: string, n: number): number {
  const m = STEP.exec(line);
  if (m) return Number(m[1]);
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    throw new Error(`${what} line ${n} is not JSON`);
  }
  const s = (rec as { step?: unknown } | null)?.step;
  if (typeof s !== "number") throw new Error(`${what} line ${n} has no numeric step`);
  return s;
}

export interface ReplayCheck {
  ok: boolean;
  /** Census records compared, in (C, through]. */
  compared: number;
  expected: number;
  /** The first step at which they differ (or where one ran out), when not ok. */
  mismatchStep?: number;
  detail?: string;
}

/**
 * Every fork series record at steps in (C, through] equals, byte for byte, the source's at that step, and there is one at every
 * census step in that range. Both sides are line iterables (empty lines skipped), consumed once and in order.
 */
export async function replayCheckLines(source: AsyncIterable<string>, fork: AsyncIterable<string>, C: number, through: number, cadence: number): Promise<ReplayCheck> {
  if (!(Number.isSafeInteger(C) && Number.isSafeInteger(through) && C < through && (through - C) % cadence === 0)) throw new Error(`replay check: (${C}, ${through}] is not a non-empty census range at cadence ${cadence}`);
  const expected = (through - C) / cadence;
  const src = source[Symbol.asyncIterator](), frk = fork[Symbol.asyncIterator]();
  let compared = 0, ns = 0, nf = 0, last = C;
  try {
    let s = await src.next();
    for (;;) {
      const f = await frk.next();
      if (f.done) break;
      nf++;
      if (!f.value.trim()) continue;
      const tf = stepOf(f.value, "fork series.jsonl", nf);
      if (tf <= C) return { ok: false, compared, expected, mismatchStep: tf, detail: `the fork has a census at step ${tf}, at or before its fork step ${C}` };
      if (tf > through) break;
      if (tf <= last) return { ok: false, compared, expected, mismatchStep: tf, detail: `the fork's census at step ${tf} is out of order` };
      if (tf !== last + cadence) return { ok: false, compared, expected, mismatchStep: last + cadence, detail: `the fork has no census at step ${last + cadence}` };
      last = tf;
      let ts = -1;
      while (!s.done) {
        ns++;
        if (s.value.trim()) {
          ts = stepOf(s.value, "source series.jsonl", ns);
          if (ts >= tf) break;
        }
        s = await src.next();
      }
      if (s.done || ts !== tf) return { ok: false, compared, expected, mismatchStep: tf, detail: `the source has no census at step ${tf}` };
      if (s.value !== f.value) return { ok: false, compared, expected, mismatchStep: tf, detail: `the census at step ${tf} differs` };
      compared++;
      s = await src.next();
    }
  } finally {
    await src.return?.(undefined);
    await frk.return?.(undefined);
  }
  if (compared !== expected) return { ok: false, compared, expected, mismatchStep: last + cadence, detail: `the fork holds ${compared} of the ${expected} censuses in (${C}, ${through}]` };
  return { ok: true, compared, expected };
}

/** `replayCheckLines` on two series.jsonl files, streamed. */
export const replayCheck = (sourceSeries: string, forkSeries: string, C: number, through: number, cadence: number): Promise<ReplayCheck> =>
  replayCheckLines(fileLines(sourceSeries), fileLines(forkSeries), C, through, cadence);

/** What `finishRun` checks about the run's identity, besides the series (amendment 2026-10-18, "Pass 2"). */
export interface FinishIdentity {
  /** The fork bundle's manifest.json: its startStep must be C, and from step 0 its initHash the source's. */
  forkManifest: string;
  start: { step: number; initHash?: string };
  /** The source's manifest.json and the SHA-256 checked before the run: it must be unchanged after it. */
  sourceManifest: string;
  sourceSha256: string;
}

/** Why the fork bundle or the source is not the one the proposal names, or null. */
async function identityError(id: FinishIdentity): Promise<string | null> {
  const now = await fileSha256(id.sourceManifest).catch(() => null);
  if (now !== id.sourceSha256) return `the source manifest changed during the run (sha256 ${now ?? "unreadable"}, checked ${id.sourceSha256})`;
  let m: { startStep?: unknown; initHash?: unknown };
  try {
    m = JSON.parse(await readFile(id.forkManifest, "utf8"));
  } catch (e) {
    return `the fork's manifest.json does not read (${(e as Error).message})`;
  }
  if (m?.startStep !== id.start.step) return `the fork's manifest says it starts at step ${JSON.stringify(m?.startStep)}, not the fork step ${id.start.step} (a reused or foreign bundle)`;
  if (id.start.initHash !== undefined && m.initHash !== id.start.initHash) return `the fork's start world hashes to ${JSON.stringify(m.initHash)}, not the source's initHash ${id.start.initHash}`;
  return null;
}

/**
 * What `run` does after tools/run.ts exits (the note's "run", amendment 2026-10-18): a non-zero exit is recorded and returned as
 * the exit code with nothing compared; otherwise the fork bundle's identity (its start step, its start world from step 0, and the
 * source manifest unchanged) and its series are checked, the latter replay-checked over (C, through], and the receipt records
 * both: exit 0 when they hold and 4 when they do not. run-receipt.json is written in `target` either way, with that exit code as
 * exitCode and tools/run.ts's own as runExitCode. Returns the exit code and
 * the lines to print.
 */
export async function finishRun(o: { target: string; receipt: Record<string, unknown>; exitCode: number; sourceSeries: string; forkSeries: string; C: number; through: number; cadence: number; identity?: FinishIdentity }): Promise<{ exit: number; lines: string[] }> {
  // exitCode is what `run` exits with; runExitCode is tools/run.ts's own.
  const write = (exit: number, extra: Record<string, unknown>) => writeAtomic(join(o.target, "run-receipt.json"), JSON.stringify({ ...o.receipt, exitCode: exit, runExitCode: o.exitCode, ...extra, finishedAt: new Date().toISOString() }, null, 2) + "\n");
  if (o.exitCode !== 0) {
    await write(o.exitCode, {});
    return { exit: o.exitCode, lines: [`tools/run.ts exited ${o.exitCode}; nothing was compared`] };
  }
  const identity = o.identity ? await identityError(o.identity) : null;
  let check: ReplayCheck;
  try {
    check = await replayCheck(o.sourceSeries, o.forkSeries, o.C, o.through, o.cadence);
  } catch (e) {
    check = { ok: false, compared: 0, expected: (o.through - o.C) / o.cadence, detail: (e as Error).message };
  }
  await write(identity || !check.ok ? 4 : 0, { ...(o.identity ? { identityCheck: identity === null ? { ok: true } : { ok: false, detail: identity } } : {}), replayCheck: { from: o.C, to: o.through, ...check } });
  if (identity) return { exit: 4, lines: [`IDENTITY MISMATCH: ${identity}`] };
  if (!check.ok) return { exit: 4, lines: [`REPLAY MISMATCH: ${check.detail}; the fork is not the source's history up to step ${o.through}`] };
  return { exit: 0, lines: [`replay check: ${check.compared} censuses in (${o.C}, ${o.through}] equal the source's, byte for byte`] };
}

/**
 * finishRun's input for an approved proposal (`run`'s one call site, kept here so a test pins its wiring): the replay check runs over
 * (C, body.replayThrough], S for a rules proposal and a random fork's first entry.
 */
export function finishInput(p: Proposal, o: { srcDir: string; sourceSha256: string; target: string; forkDir: string; exitCode: number; receipt: Record<string, unknown> }): Parameters<typeof finishRun>[0] {
  const b = p.body;
  return {
    target: o.target,
    receipt: o.receipt,
    exitCode: o.exitCode,
    sourceSeries: join(o.srcDir, "series.jsonl"),
    forkSeries: join(o.forkDir, "series.jsonl"),
    C: b.fork.step,
    through: b.replayThrough,
    cadence: b.spec.censusEvery,
    identity: { forkManifest: join(o.forkDir, "manifest.json"), start: { step: b.fork.step, ...(b.fork.step === 0 ? { initHash: b.fork.hash } : {}) }, sourceManifest: join(o.srcDir, "manifest.json"), sourceSha256: o.sourceSha256 },
  };
}

/** Writes text to a temp file beside `path` and renames it into place. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(tmp, text);
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
