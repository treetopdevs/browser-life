// Run-root layout, frozen-source execution and durable attempt records for
// the renewal experiment. Shared by the runner and the verifier; contains no
// endpoint or decision logic.
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath as fromFileUrl, pathToFileURL } from "node:url";
import { sha256Hex } from "./construction-renewal.ts";

export const PROTOCOL_PATH = "experiments/construction/renewal-v1/protocol.json";
export const ENTRYPOINTS = ["tools/construction-renewal.ts", "tools/construction-renewal-verify.ts"];

export const json = (value: unknown) =>
  JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";

export async function fileSha256(path: string): Promise<string> {
  return sha256Hex(await Deno.readFile(path));
}

/** Writes a JSON file that must not exist yet, atomically (temporary file, then rename). */
export async function writeJsonOnce(path: string, value: unknown): Promise<string> {
  const text = json(value);
  try {
    await Deno.lstat(path);
    throw new Error(`refusing to overwrite ${path}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const tmp = `${path}.tmp-${Deno.pid}`;
  const f = await Deno.open(tmp, { write: true, createNew: true });
  try {
    await f.write(new TextEncoder().encode(text));
    await f.syncData();
  } finally {
    f.close();
  }
  await Deno.rename(tmp, path);
  return sha256Hex(new TextEncoder().encode(text));
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** Repository root of the running module (the live workspace or a frozen source tree). */
export function moduleRoot(importMetaUrl: string): string {
  return resolve(dirname(fromFileUrl(importMetaUrl)), "..");
}

export function absoluteRoot(root: string): string {
  return isAbsolute(root) ? resolve(root) : resolve(Deno.cwd(), root);
}

/** Local source files in the runtime module graph of the entrypoints (via `deno info --json`). */
export async function sourceClosure(repo: string, entries: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const entry of entries) {
    const out = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json", entry],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!out.success) throw new Error(`deno info failed for ${entry}: ${new TextDecoder().decode(out.stderr)}`);
    const info = JSON.parse(new TextDecoder().decode(out.stdout)) as { modules: { kind: string; specifier: string; local?: string }[] };
    for (const m of info.modules) {
      if (m.kind !== "esm" || !m.specifier.startsWith("file://")) continue;
      const path = relative(repo, fromFileUrl(m.specifier));
      if (path.startsWith("..")) throw new Error(`module outside the repository: ${m.specifier}`);
      files.add(path);
    }
  }
  return [...files].sort();
}

export interface SourceSnapshot {
  files: Record<string, string>;
  digest: string;
}

export async function snapshotDigest(files: Record<string, string>): Promise<string> {
  const text = JSON.stringify(Object.keys(files).sort().map((p) => [p, files[p]]));
  return sha256Hex(new TextEncoder().encode(text));
}

/** Copies each file into <root>/source, verifying its bytes did not change while copying. */
export async function copySources(repo: string, root: string, paths: string[]): Promise<SourceSnapshot> {
  const files: Record<string, string> = {};
  for (const path of [...new Set(paths)].sort()) {
    const before = await Deno.readFile(join(repo, path));
    const hash = await sha256Hex(before);
    const dest = join(root, "source", path);
    await Deno.mkdir(dirname(dest), { recursive: true });
    await Deno.writeFile(dest, before, { createNew: true });
    if (await fileSha256(join(repo, path)) !== hash) throw new Error(`source changed while taking the snapshot: ${path}`);
    if (await fileSha256(dest) !== hash) throw new Error(`snapshot copy differs: ${path}`);
    files[path] = hash;
  }
  return { files, digest: await snapshotDigest(files) };
}

/** Rehashes every file of the frozen source tree against the manifest. */
export async function verifySources(root: string, snapshot: SourceSnapshot): Promise<void> {
  for (const [path, hash] of Object.entries(snapshot.files)) {
    const actual = await fileSha256(join(root, "source", path));
    if (actual !== hash) throw new Error(`frozen source ${path} changed: ${actual} != ${hash}`);
  }
  if (await snapshotDigest(snapshot.files) !== snapshot.digest) throw new Error("source digest mismatch");
}

/** Set by the launcher to the verified source digest; the frozen copy refuses to proceed without it. */
export const LAUNCH_ENV = "BL_RENEWAL_FROZEN_LAUNCH";

/**
 * The frozen source list of a root, verified: sources.json against FROZEN.json
 * (when the freeze has completed) and every copied file against its hash.
 */
export async function frozenSources(root: string): Promise<{ sources: SourceSnapshot; sourcesSha256: string; frozen: boolean }> {
  const path = join(root, "sources.json");
  const sourcesSha256 = await fileSha256(path);
  const sources = JSON.parse(await Deno.readTextFile(path)) as SourceSnapshot;
  const frozenPath = join(root, "FROZEN.json");
  const frozen = await exists(frozenPath);
  if (frozen) {
    const f = JSON.parse(await Deno.readTextFile(frozenPath));
    if (f.sourcesSha256 !== sourcesSha256) throw new Error("sources.json differs from FROZEN.json");
    if (f.manifestSha256 !== await fileSha256(join(root, "manifest.json"))) throw new Error("manifest.json differs from FROZEN.json");
    if (f.sourceDigest !== sources.digest) throw new Error("source digest differs from FROZEN.json");
  }
  await verifySources(root, sources);
  return { sources, sourcesSha256, frozen };
}

/**
 * Runs the current command from the verified frozen source tree. Every
 * invocation, including one started directly from the copy, verifies the
 * FROZEN -> manifest -> sources chain and is (re)launched with the copy's own
 * deno.json and with remote, npm and lock-resolved modules refused. Returns
 * only inside such a launch; otherwise exits with the launched child's code.
 */
export async function runFromSnapshot(importMetaUrl: string, entry: string, root: string, args: string[]): Promise<true> {
  const here = moduleRoot(importMetaUrl);
  const source = join(root, "source");
  const { sources } = await frozenSources(root);
  if (resolve(here) === resolve(source) && Deno.env.get(LAUNCH_ENV) === sources.digest) {
    if (resolve(fromFileUrl(Deno.mainModule)) !== resolve(join(source, entry))) throw new Error("frozen launch of an unexpected entrypoint");
    await checkEffectiveResolution(source);
    return true;
  }
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      `--config=${join(source, "deno.json")}`,
      // The closure is local files and node: built-ins only: refuse any remote,
      // npm or lock-resolved module so nothing outside the frozen tree can load.
      "--no-lock",
      "--no-remote",
      "--no-npm",
      join(source, entry),
      ...args,
    ],
    cwd: source,
    env: { [LAUNCH_ENV]: sources.digest },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  Deno.exit(status.code);
}

/**
 * The launch variable is public, so it attests nothing about how Deno was
 * started. What matters is checked directly: under the effective
 * configuration every local import-map alias resolves to its own path inside
 * the frozen copy (an alias whose target was not copied therefore cannot load
 * anything), and the copied files are the verified sources.
 */
export async function checkEffectiveResolution(source: string): Promise<void> {
  const config = JSON.parse(await Deno.readTextFile(join(source, "deno.json"))) as { imports: Record<string, string> };
  for (const [alias, target] of Object.entries(config.imports)) {
    if (!target.startsWith("./")) continue;
    const want = resolve(join(source, target));
    let got: string;
    try {
      got = resolve(fromFileUrl(import.meta.resolve(alias)));
    } catch (e) {
      throw new Error(`frozen launch: ${alias} does not resolve to a file (${(e as Error).message}); use the launcher`);
    }
    if (got !== want) throw new Error(`frozen launch: ${alias} resolves to ${got}, not the frozen ${want}; use the launcher`);
  }
}

/** [binding as the caller imported it, frozen repository path of the module that exports it, export name]. */
export type Binding = [unknown, string, string];

/**
 * Module identity: each binding a frozen module uses must be the very object
 * exported by the frozen file at its absolute URL. A loader that remaps a
 * package for one importer (an import-map scope) yields a different module
 * instance and is refused. This guards against running with the wrong loader
 * by accident; it is not a defence against deliberate subversion by someone
 * with local write access, who could change anything. For that, the run's
 * backstops are the independent native GPU replays and the audit's
 * reconstructed identities.
 */
export async function checkModuleIdentity(source: string, bindings: Binding[]): Promise<void> {
  for (const [value, path, name] of bindings) {
    const mod = await import(pathToFileURL(join(source, path)).href);
    if (mod[name] !== value) throw new Error(`frozen launch: ${name} is not the one exported by the frozen ${path}; use the launcher`);
  }
}

/** Numbered verification attempts: verify/<name>-attempt-<n>/, never overwritten. */
export async function newVerifyAttempt(root: string, name: string): Promise<string> {
  const base = join(root, "verify");
  await Deno.mkdir(base, { recursive: true });
  let last = 0;
  for await (const e of Deno.readDir(base)) {
    const m = new RegExp(`^${name}-attempt-(\\d+)$`).exec(e.name);
    if (m) last = Math.max(last, Number(m[1]));
  }
  const dir = join(base, `${name}-attempt-${last + 1}`);
  await Deno.mkdir(dir); // exclusive
  return dir;
}

/** The highest-numbered verification attempt whose audit passed, or null. */
export async function latestPassingAudit(root: string, name: string): Promise<{ dir: string; path: string; sha256: string; audit: Record<string, unknown> } | null> {
  const base = join(root, "verify");
  if (!(await exists(base))) return null;
  const found: { n: number; dir: string }[] = [];
  for await (const e of Deno.readDir(base)) {
    const m = new RegExp(`^${name}-attempt-(\\d+)$`).exec(e.name);
    if (m && e.isDirectory) found.push({ n: Number(m[1]), dir: join(base, e.name) });
  }
  for (const f of found.sort((a, b) => b.n - a.n)) {
    const path = join(f.dir, "audit.json");
    if (!(await exists(path))) continue;
    const audit = JSON.parse(await Deno.readTextFile(path));
    if (audit.status === "pass") return { dir: f.dir, path, sha256: await fileSha256(path), audit };
  }
  return null;
}

export interface AttemptState {
  attempt: number;
  dir: string;
  complete: boolean;
  failed: boolean;
  superseded: boolean;
}

export async function listAttempts(caseDir: string): Promise<AttemptState[]> {
  if (!(await exists(caseDir))) return [];
  const out: AttemptState[] = [];
  for await (const e of Deno.readDir(caseDir)) {
    const m = /^attempt-(\d+)$/.exec(e.name);
    if (!m || !e.isDirectory) continue;
    const dir = join(caseDir, e.name);
    out.push({
      attempt: Number(m[1]),
      dir,
      complete: await exists(join(dir, "result.json")),
      failed: await exists(join(dir, "failed.json")),
      superseded: await exists(join(dir, "superseded.json")),
    });
  }
  return out.sort((a, b) => a.attempt - b.attempt);
}

/** The single complete attempt of a case, or null. More than one is a provenance error. */
export async function completeAttempt(caseDir: string): Promise<AttemptState | null> {
  const done = (await listAttempts(caseDir)).filter((a) => a.complete);
  if (done.length > 1) throw new Error(`${caseDir} has ${done.length} complete attempts`);
  return done[0] ?? null;
}

/** Streams a JSON-lines file one record at a time. */
export async function* readJsonLines<T>(path: string): AsyncGenerator<T> {
  const f = await Deno.open(path);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of f.readable) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) yield JSON.parse(line) as T;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new Error(`${path} ends without a newline (truncated record)`);
  } finally {
    try {
      f.close();
    } catch { /* closed by the readable stream */ }
  }
}
