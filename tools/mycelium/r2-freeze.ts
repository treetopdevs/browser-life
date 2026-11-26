// Mycelium rung R2: the hashes the two freezes record and the runner checks (PROTOCOL.md section 10).
//
//   deno run -A --no-lock tools/mycelium/r2-freeze.ts            # the Freeze 1 block for docs/mycelium-r2-2026-11-13/FROZEN
//   deno run -A --no-lock tools/mycelium/r2-freeze.ts --freeze2  # the one line Freeze 2 appends (needs CALIBRATION.json)
//
// It writes nothing: whoever freezes redirects or copies the lines into FROZEN deliberately. The same
// functions verify the hashes before a pass1, dev or confirm run (r2.ts) and before the analysis (r2-analyze.ts).
//
// code_hash is the SHA-256 of a manifest of file CONTENTS, one `<sha256>  <repo-relative path>` line per file,
// sorted by path. It does not depend on git, on HEAD, on whether the files are committed, or on the checkout's
// location. It covers everything the protocol executes: tools/mycelium/*.ts and RULES.md, every .ts file under
// packages/schema/src and packages/sim-ref/src (world.ts imports cellBase, draw, mulFrac, divi, controllerForward,
// diffOut from them), and deno.json (which maps @bl/*). The only code outside it is the jsr:@std/cli argument
// parser (version-pinned by specifier) and the Deno runtime itself, whose version is recorded as a comment.
import { checkFrozen, type FreezeHashes, manifestText, type Phase } from "./r2-protocol.ts";

const url = (rel: string) => new URL(rel, import.meta.url);
/** The checkout root (two levels above tools/mycelium/). */
export const REPO = decodeURIComponent(url("../../").pathname).replace(/\/$/, "");
export const R2_DOC_DIR = `${REPO}/docs/mycelium-r2-2026-11-13`;
export const PROTOCOL_PATH = `${R2_DOC_DIR}/PROTOCOL.md`;
export const FROZEN_PATH = `${R2_DOC_DIR}/FROZEN`;
export const CALIBRATION_PATH = `${R2_DOC_DIR}/CALIBRATION.json`;
/** The seed log lives beside the protocol (not in the gitignored runs/), so it travels with the commit and every checkout of it sees it. */
export const SEED_LOG_PATH = `${R2_DOC_DIR}/seed-log.jsonl`;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fileHash(path: string): Promise<string | null> {
  try { return await sha256Hex(await Deno.readFile(path)); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

async function listTs(dirRel: string, recursive: boolean, ext: (n: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(`${REPO}/${dirRel}`)) {
    if (e.isFile && ext(e.name)) out.push(`${dirRel}/${e.name}`);
    else if (e.isDirectory && recursive) out.push(...(await listTs(`${dirRel}/${e.name}`, true, ext)));
  }
  return out;
}

/** The repo-relative paths code_hash covers, in plain string order. */
export async function manifestPaths(): Promise<string[]> {
  const paths = [
    ...(await listTs("tools/mycelium", false, (n) => n.endsWith(".ts") || n === "RULES.md")),
    ...(await listTs("packages/schema/src", true, (n) => n.endsWith(".ts"))),
    ...(await listTs("packages/sim-ref/src", true, (n) => n.endsWith(".ts"))),
    "deno.json",
  ];
  return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Per-file SHA-256 of everything code_hash covers. */
export async function manifestFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const p of await manifestPaths()) files[p] = (await fileHash(`${REPO}/${p}`))!;
  return files;
}

export async function codeHashOf(files: Record<string, string>): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(manifestText(files)));
}

/** The code hash of the files on disk now. */
export async function codeHash(): Promise<string> {
  return await codeHashOf(await manifestFiles());
}

export async function actualHashes(): Promise<FreezeHashes> {
  const protocol = await fileHash(PROTOCOL_PATH);
  if (protocol === null) throw new Error(`${PROTOCOL_PATH} does not exist`);
  const files = await manifestFiles();
  return { protocol, code: await codeHashOf(files), files, calibration: await fileHash(CALIBRATION_PATH) };
}

export async function readFrozen(): Promise<string | null> {
  try { return await Deno.readTextFile(FROZEN_PATH); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

/** Problems that stop a run or an analysis in this phase (empty = frozen as required). */
export async function verifyFrozen(phase: Phase): Promise<string[]> {
  if (phase === "smoke") return [];
  return checkFrozen(phase, await readFrozen(), await actualHashes());
}

async function sh(cmd: string): Promise<string> {
  const r = await new Deno.Command("sh", { args: ["-c", cmd], cwd: REPO, stdout: "piped", stderr: "piped" }).output();
  if (!r.success) throw new Error(`${cmd} failed: ${new TextDecoder().decode(r.stderr)}`);
  return new TextDecoder().decode(r.stdout).trim();
}

if (import.meta.main) {
  const h = await actualHashes();
  const when = await sh("date -u +%Y-%m-%dT%H:%M:%SZ");
  if (Deno.args.includes("--freeze2")) {
    if (h.calibration === null) { console.error("CALIBRATION.json does not exist; Freeze 2 needs it"); Deno.exit(1); }
    console.log(`# Freeze 2, ${when}: appended after calibration, before any fresh-seed run. Nothing above this line changes.`);
    console.log(`calibration_sha256: ${h.calibration}`);
  } else {
    console.log(`# Mycelium R2 FROZEN. Freeze 1, ${when}. Format and rules: PROTOCOL.md section 10.`);
    console.log(`# frozen_at: ${when}`);
    const base = await sh("git rev-parse HEAD").catch(() => "unknown");
    console.log(`# base_commit: ${base} (informational; the hashes below do not depend on git)`);
    console.log(`# deno: ${Deno.version.deno}, v8 ${Deno.version.v8}, typescript ${Deno.version.typescript} (informational)`);
    console.log(`protocol_sha256: ${h.protocol}`);
    console.log(`code_hash: ${h.code}`);
    console.log("# per-file SHA-256 of everything code_hash covers (shasum -a 256 format); r2.ts and r2-analyze.ts verify each line");
    console.log(manifestText(h.files).trimEnd());
  }
}
