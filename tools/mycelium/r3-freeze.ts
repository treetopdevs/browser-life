// Mycelium rung R3: the hashes the two freezes record and the runners check (PROTOCOL.md section 9).
//
//   deno run -A --no-lock tools/mycelium/r3-freeze.ts             # the Freeze 1 block for docs/mycelium-r3-2026-11-13/FROZEN
//   deno run -A --no-lock tools/mycelium/r3-freeze.ts --freeze2   # the one line Freeze 2 appends (needs CALIBRATION.json)
//
// It writes nothing: whoever freezes redirects the lines into FROZEN deliberately. code_hash is the SHA-256 of a manifest of file contents over
// the import closure of r3.ts, r3-analyze.ts and r3-freeze.ts under tools/mycelium (world.ts, gpu.ts, observe-r2b.ts and what of R2/R2b they import),
// RULES.md, every .ts under packages/schema/src and packages/sim-ref/src, and deno.json (as R2b's, over R3's entry files).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { REPO, sha256Hex } from "./r2-freeze.ts";
import { checkFrozen, type FreezeHashesR3, localImports, manifestText, type Phase, R3_ENTRY_FILES } from "./r3-protocol.ts";

export { REPO, sha256Hex };
export const R3_DOC_DIR = `${REPO}/docs/mycelium-r3-2026-11-13`;
export const PROTOCOL_PATH = `${R3_DOC_DIR}/PROTOCOL.md`;
export const FROZEN_PATH = `${R3_DOC_DIR}/FROZEN`;
export const CALIBRATION_PATH = `${R3_DOC_DIR}/CALIBRATION.json`;
export const SEED_LOG_PATH = `${R3_DOC_DIR}/seed-log.jsonl`;

async function fileHash(path: string): Promise<string | null> {
  try { return await sha256Hex(await Deno.readFile(path)); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; }
}

async function listTs(dirRel: string): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(`${REPO}/${dirRel}`)) {
    if (e.isFile && e.name.endsWith(".ts")) out.push(`${dirRel}/${e.name}`);
    else if (e.isDirectory) out.push(...(await listTs(`${dirRel}/${e.name}`)));
  }
  return out;
}

/** The repo-relative paths code_hash covers, in plain string order. */
export async function manifestPaths(): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...R3_ENTRY_FILES];
  while (queue.length) {
    const rel = queue.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = await Deno.readTextFile(`${REPO}/${rel}`);
    for (const imp of localImports(text)) {
      const target = new URL(imp, `file:///${rel}`).pathname.slice(1);
      if (target.startsWith("tools/mycelium/")) queue.push(target);
    }
  }
  const paths = [...seen, "tools/mycelium/RULES.md", ...(await listTs("packages/schema/src")), ...(await listTs("packages/sim-ref/src")), "deno.json"];
  return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function manifestFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const p of await manifestPaths()) files[p] = (await fileHash(`${REPO}/${p}`))!;
  return files;
}

export async function codeHashOf(files: Record<string, string>): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(manifestText(files)));
}

export async function codeHash(): Promise<string> {
  return await codeHashOf(await manifestFiles());
}

export async function actualHashes(): Promise<FreezeHashesR3> {
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
  const a = parseArgs(Deno.args, { boolean: ["freeze2"] });
  const h = await actualHashes();
  const when = await sh("date -u +%Y-%m-%dT%H:%M:%SZ");
  if (a.freeze2) {
    if (h.calibration === null) { console.error("CALIBRATION.json does not exist; Freeze 2 needs it"); Deno.exit(1); }
    console.log(`# Freeze 2, ${when}: appended after calibration, before any confirmation run. Nothing above this line changes.`);
    console.log(`calibration_sha256: ${h.calibration}`);
  } else {
    console.log(`# Mycelium R3 FROZEN. Freeze 1, ${when}. Format and rules: PROTOCOL.md section 9.`);
    console.log(`# frozen_at: ${when}`);
    const base = await sh("git rev-parse HEAD").catch(() => "unknown");
    console.log(`# base_commit: ${base} (informational; the hashes below do not depend on git)`);
    console.log(`# deno: ${Deno.version.deno}, v8 ${Deno.version.v8}, typescript ${Deno.version.typescript} (informational)`);
    console.log(`protocol_sha256: ${h.protocol}`);
    console.log(`code_hash: ${h.code}`);
    console.log("# per-file SHA-256 of everything code_hash covers (shasum -a 256 format); r3.ts and r3-analyze.ts verify each line");
    console.log(manifestText(h.files).trimEnd());
  }
}
