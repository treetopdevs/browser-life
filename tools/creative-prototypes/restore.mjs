// Restore the large replay files that docs/creative-prototypes/ARTIFACTS.md lists (both tables) into a checkout.
//
//   tools/creative-prototypes/restore.sh [TARGET] [--source DIR] [--check] [--dry-run] [--force]
//                                        [--artifacts FILE] [--exclude-file FILE] [--first-table-commit SHA] [--unexclude] [--help]
//
// TARGET        checkout to restore into (default: the checkout this script lives in).
// --source      runs directory holding food-line-101-119/ and creative-prototypes-85-100/, each mirroring repo paths
//               (default $BL_RUNS_DIR, else runs/ of the main checkout that owns TARGET's .git). Read only, never written.
// --check       verify only: change nothing, exit non-zero unless every file is present and matches.
// --dry-run     print what would be copied, from where, and what would be refused; change nothing.
// --force       replace an existing file whose hash or size differs (only with a verified replacement).
// --exclude-file  where to hide restored paths from git (default: git rev-parse --git-path info/exclude in TARGET,
//               which for a worktree is the main checkout's shared .git/info/exclude). One marked block, rewritten in place.
// --unexclude   remove the marked block from the exclude file and exit (undoes the hiding; touches nothing else).
// The exclude block is written BEFORE any file is copied, and also hides the temp directories (.restore-tmp-*), so an
// interrupted run cannot leave stageable files. The default exclude file of a linked worktree is the main checkout's
// shared .git/info/exclude: the anchored paths are hidden in every checkout that shares it. A target that tracks any
// listed path in its index is refused (an exclude rule cannot protect tracked files).
// Order per file: already correct -> report; else copy from source dirs; else `git show <commit>:<path>` (local objects only,
// no fetch). Every byte is hashed and size-checked before a temp file is renamed into place; a mismatch leaves nothing behind.
// Exit 0 only when every listed file is verified.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { constants as FS, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The first table has no commit column; the prose above it names this commit (a test pins the two together).
export const FIRST_TABLE_COMMIT = "511d76c6";
export const SOURCE_DIRS = ["food-line-101-119", "creative-prototypes-85-100"];
export const BLOCK_START = "# >>> restore.sh: out-of-git replay artifacts";
export const BLOCK_END = "# <<< restore.sh";
export const TEMP_PATTERN = ".restore-tmp-*";
const NEW_FILE = FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW; // never writes through a pre-planted symlink or file
export class PreflightError extends Error {}
const ROW = /^\| `([^`]+)` \| (\d+) \| `([0-9a-f]{64})`(?: \| `([0-9a-f]{7,40})`)? \|\s*$/;

/** Parse every `| \`path\` | bytes | sha |[ commit |]` row. A row that starts like one but does not parse is an error. */
export function parseArtifacts(markdown, firstTableCommit = FIRST_TABLE_COMMIT) {
  const out = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const m = ROW.exec(line);
    if (!m) throw new Error(`unparseable table row: ${line}`);
    const [, path, size, sha256, commit] = m;
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`unsafe path: ${path}`);
    out.push({ path, size: Number(size), sha256, commit: commit ?? firstTableCommit, table: commit ? 2 : 1 });
  }
  if (out.length === 0) throw new Error("no table rows found");
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const matches = (buf, e) => buf.length === e.size && sha(buf) === e.sha256;

function readIfFile(p) { // a regular file only: a symlink (even to matching bytes) does not count
  try { return lstatSync(p).isFile() ? readFileSync(p) : null; } catch { return null; }
}

function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

function gitShow(target, commit, path) {
  try {
    return execFileSync("git", ["show", `${commit}:${path}`], { cwd: target, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const msg = String(err.stderr ?? err.message).trim().split("\n")[0];
    return { error: `git show ${commit}:${path} failed (${msg}); if the commit is absent run: git fetch origin <branch>` };
  }
}

const inside = (rootReal, real) => real === rootReal || real.startsWith(rootReal + sep);

/** Null when every existing ancestor of dest stays inside the target; otherwise why not. Changes nothing. */
function parentProblem(target, dest) {
  let rootReal;
  try { rootReal = realpathSync(target); } catch (err) { return `target unreadable: ${err.message}`; }
  let cur = target;
  for (const part of relative(target, dirname(dest)).split(sep).filter(Boolean)) {
    cur = join(cur, part);
    const st = lstatOrNull(cur);
    if (st === null) return null; // everything below is created fresh
    if (st.isSymbolicLink()) return `${cur} is a symlink; index and exclude rules apply to the path, not its target`;
    let real;
    try { real = realpathSync(cur); } catch { return `${cur} is a dangling link`; }
    if (!inside(rootReal, real)) return `${cur} resolves outside the target checkout`;
    if (!lstatSync(real).isDirectory()) return `${cur} is not a directory`;
  }
  return null;
}

function placeVerified(target, dest, buf, entry, force) {
  const problem = parentProblem(target, dest);
  if (problem) throw new Error(problem);
  mkdirSync(dirname(dest), { recursive: true });
  const after = parentProblem(target, dest);
  if (after) throw new Error(after);
  const tdir = mkdtempSync(join(dirname(dest), ".restore-tmp-")); // private 0700 directory, hidden by the exclude block
  const tmp = join(tdir, "f");
  try {
    writeFileSync(tmp, buf, { flag: NEW_FILE, mode: 0o644 });
    if (!matches(readFileSync(tmp), entry)) throw new Error("temp file does not match after write");
    if (force) renameSync(tmp, dest);
    else linkSync(tmp, dest); // fails with EEXIST rather than replacing anything that appeared since the check
  } finally {
    rmSync(tdir, { recursive: true, force: true });
  }
}

function resolveExcludeFile(target, explicit) {
  if (explicit) return resolve(explicit);
  try {
    const p = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return isAbsolute(p) ? p : join(target, p);
  } catch (err) {
    throw new PreflightError(`cannot resolve the git exclude file for ${target} (not a git checkout?): ${String(err.stderr ?? err.message).trim().split("\n")[0]}; nothing was copied. Pass --exclude-file to choose one.`);
  }
}

function trackedPaths(target, paths) {
  try { execFileSync("git", ["rev-parse", "--git-dir"], { cwd: target, stdio: ["ignore", "pipe", "pipe"] }); }
  catch { return new Set(); } // not a git checkout: nothing can be tracked
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--", ...paths], { cwd: target, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }).toString();
    return new Set(out.split("\0").filter(Boolean));
  } catch (err) { // a git checkout whose index cannot be read: fail closed
    throw new PreflightError(`cannot read the git index of ${target}: ${String(err.stderr ?? err.message).trim().split("\n")[0]}; nothing was changed.`);
  }
}

/** Core: returns { rows, ok, verified, total, bytes, excludeFile }. Writes nothing in check/dryRun. */
export function restore(opts) {
  const target = resolve(opts.target);
  const entries = parseArtifacts(readFileSync(opts.artifacts ?? join(target, "docs/creative-prototypes/ARTIFACTS.md"), "utf8"), opts.firstTableCommit ?? FIRST_TABLE_COMMIT);
  const source = resolve(opts.source);
  const sourceDirs = opts.sourceDirs ?? SOURCE_DIRS;
  const readOnly = Boolean(opts.check || opts.dryRun);
  const tracked = trackedPaths(target, entries.map((e) => e.path));
  // Hide first, copy second: a crash or a failed exclude write must not leave restored files stageable.
  let excludeFile = null;
  if (!readOnly) {
    excludeFile = resolveExcludeFile(target, opts.excludeFile);
    writeExcludeBlock(excludeFile, entries.map((e) => e.path));
  }
  const rows = [];
  let verified = 0;
  let bytes = 0;
  for (const e of entries) {
    const dest = join(target, e.path);
    const row = (status, detail = "") => { rows.push({ path: e.path, status, detail }); };
    if (tracked.has(e.path)) { row("REFUSED", "tracked in this checkout's git index; an exclude rule cannot keep it out of commits"); continue; }
    const problem = parentProblem(target, dest);
    if (problem) { row("REFUSED", problem); continue; }
    const existing = readIfFile(dest);
    const present = existing !== null || lstatOrNull(dest) !== null; // unreadable, a symlink or a directory still counts as present
    if (existing && matches(existing, e)) { verified++; row("ok", "already present"); continue; }
    if (present && !opts.force) { row("REFUSED", `exists with different, unreadable or non-regular content${existing ? ` (${existing.length} bytes)` : ""}; use --force`); continue; }
    if (opts.check) { row(present ? "HASH MISMATCH" : "MISSING"); continue; }
    // Find a verified replacement: source dirs first, then git.
    let buf = null, from = "", why = [];
    for (const d of sourceDirs) {
      const p = join(source, d, e.path);
      const b = readIfFile(p);
      if (!b) continue;
      if (matches(b, e)) { buf = b; from = `source ${d}`; break; }
      why.push(`${d} copy has wrong hash/size`);
    }
    if (!buf) {
      const g = gitShow(target, e.commit, e.path);
      if (Buffer.isBuffer(g) && matches(g, e)) { buf = g; from = `git ${e.commit}`; }
      else why.push(Buffer.isBuffer(g) ? `git ${e.commit} copy has wrong hash/size` : g.error);
    }
    if (!buf) { row(present ? "HASH MISMATCH" : "MISSING", why.join("; ") || "not in source and no git fallback"); continue; }
    if (opts.dryRun) { row("would copy", `from ${from}${present ? " (replacing differing file)" : ""}`); continue; }
    try { placeVerified(target, dest, buf, e, Boolean(opts.force)); }
    catch (err) { row(err.code === "EEXIST" ? "REFUSED" : "MISSING", err.code === "EEXIST" ? "appeared while restoring; not overwritten (use --force)" : `write failed: ${err.message}`); continue; }
    verified++; bytes += buf.length;
    row("copied", `from ${from}`);
  }
  return { rows, ok: verified === entries.length, verified, total: entries.length, bytes, excludeFile };
}

/** Rewrite the marked block in place (or append it); other lines are untouched. No paths removes the block. */
export function writeExcludeBlock(file, paths) {
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = prior.split("\n");
  const s = lines.indexOf(BLOCK_START);
  const e = s >= 0 ? lines.indexOf(BLOCK_END, s) : -1;
  const kept = s >= 0 && e >= 0 ? [...lines.slice(0, s), ...lines.slice(e + 1)] : lines;
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  const block = paths.length ? [BLOCK_START, ...paths.map((p) => `/${p}`), TEMP_PATTERN, BLOCK_END] : [];
  const next = [...kept, ...block, ""].join("\n");
  if (next !== prior) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.restore-tmp-${process.pid}-${randomBytes(4).toString("hex")}`; // atomic; O_EXCL|O_NOFOLLOW refuses a planted link
    try { writeFileSync(tmp, next, { flag: NEW_FILE, mode: 0o644 }); renameSync(tmp, file); } catch (err) { rmSync(tmp, { force: true }); throw err; }
  }
}

export function main(argv, log = console.log) {
  const o = { target: join(dirname(fileURLToPath(import.meta.url)), "../.."), source: process.env.BL_RUNS_DIR };
  const val = (i, f) => { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${f} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") o.check = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--force") o.force = true;
    else if (a === "--unexclude") o.unexclude = true;
    else if (a === "--help" || a === "-h") { log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); return 0; }
    else if (a === "--source") o.source = val(i++, a);
    else if (a === "--artifacts") o.artifacts = val(i++, a);
    else if (a === "--exclude-file") o.excludeFile = val(i++, a);
    else if (a === "--first-table-commit") o.firstTableCommit = val(i++, a);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else o.target = a;
  }
  // Default source: runs/ of the main checkout (the one that owns the shared .git directory), which is where the copies were left.
  if (!o.source) {
    try { o.source = join(dirname(resolve(o.target, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: o.target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim())), "runs"); }
    catch { o.source = join(o.target, "runs"); }
  }
  let r;
  try {
    if (o.unexclude) {
      if (o.check || o.dryRun) throw new Error("--unexclude cannot be combined with --check or --dry-run");
      const file = resolveExcludeFile(resolve(o.target), o.excludeFile);
      writeExcludeBlock(file, []);
      log(`removed the restore.sh block from ${file}; restored files are visible to git again`);
      return 0;
    }
    r = restore(o);
  } catch (err) {
    if (!(err instanceof PreflightError)) throw err;
    console.error(`restore: ${err.message}`);
    return 1;
  }
  for (const x of r.rows) log(`${x.status.padEnd(13)} ${x.path}${x.detail ? `  (${x.detail})` : ""}`);
  const count = (s) => r.rows.filter((x) => x.status === s).length;
  log(`copied ${count("copied")}, already ok ${count("ok")}, would copy ${count("would copy")}, missing ${count("MISSING")}, mismatch ${count("HASH MISMATCH")}, refused ${count("REFUSED")}; ${r.bytes} bytes written`);
  log(r.excludeFile ? `exclude file: ${r.excludeFile}` : "exclude file: not touched");
  log(`RESULT: ${r.verified}/${r.total} verified`);
  const bad = r.rows.some((x) => x.status === "MISSING" || x.status === "HASH MISMATCH" || x.status === "REFUSED");
  return (o.dryRun ? !bad : r.ok) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (err) { console.error(`restore: ${err.message}`); process.exit(2); }
}
