// Mycelium rung R2b: the hashes the two freezes record and the runner checks (PROTOCOL.md section 10).
//
//   deno run -A --no-lock tools/mycelium/r2b-freeze.ts --plan full|reduced --timing <steps per second>   # the Freeze 1 block for docs/mycelium-r2b-2026-11-13/FROZEN
//   deno run -A --no-lock tools/mycelium/r2b-freeze.ts --freeze2                                         # the one line Freeze 2 appends (needs CALIBRATION.json)
//
// It writes nothing: whoever freezes redirects or copies the lines into FROZEN deliberately. The same functions verify the
// hashes before a dev, matching or confirmation run (r2b.ts) and before the analysis (r2b-analyze.ts). code_hash is the SHA-256 of a
// manifest of file contents (as R2's) but over R2b's own file set: the import closure of r2b.ts, r2b-analyze.ts and r2b-freeze.ts under
// tools/mycelium, RULES.md, every .ts under packages/schema/src and packages/sim-ref/src, and deno.json. A file the runner does not
// import (the lab viewer's brush.ts, run.ts) is outside it. The plan and timing figure are also recorded in PROTOCOL.md's
// FREEZE-1-RECORD block so protocol_sha256 covers them; this tool refuses to print a Freeze 1 block that disagrees with it.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { REPO, sha256Hex } from "./r2-freeze.ts";
import { checkFrozen, type FreezeHashesR2b, localImports, manifestText, parseProtocolRecord, type Phase, planForTiming, R2B_ENTRY_FILES } from "./r2b-protocol.ts";

export { REPO, sha256Hex };
export const R2B_DOC_DIR = `${REPO}/docs/mycelium-r2b-2026-11-13`;
export const PROTOCOL_PATH = `${R2B_DOC_DIR}/PROTOCOL.md`;
export const FROZEN_PATH = `${R2B_DOC_DIR}/FROZEN`;
export const CALIBRATION_PATH = `${R2B_DOC_DIR}/CALIBRATION.json`;
/** The seed log lives beside the protocol (not in the gitignored runs/), so it travels with the commit. */
export const SEED_LOG_PATH = `${R2B_DOC_DIR}/seed-log.jsonl`;

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

/**
 * The repo-relative paths code_hash covers, in plain string order: the import closure under tools/mycelium of the R2b runner, freeze tool and
 * analysis (R2B_ENTRY_FILES; so world.ts, gpu.ts, observe-r2b.ts, the r2b-*.ts modules and whatever of R2's they import), RULES.md (the
 * protocol cites it), every .ts under packages/schema/src and packages/sim-ref/src (world.ts imports from them) and deno.json (which maps @bl/*).
 * Files the runner does not import, such as the lab viewer's tools/mycelium/brush.ts or tools/mycelium/run.ts, are outside the freeze.
 */
export async function manifestPaths(): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...R2B_ENTRY_FILES];
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

/** Per-file SHA-256 of everything code_hash covers. */
export async function manifestFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const p of await manifestPaths()) files[p] = (await fileHash(`${REPO}/${p}`))!;
  return files;
}

export async function codeHashOf(files: Record<string, string>): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(manifestText(files)));
}

/** The code hash of the files on disk now (the R2b manifest, not R2's). */
export async function codeHash(): Promise<string> {
  return await codeHashOf(await manifestFiles());
}

export async function actualHashes(): Promise<FreezeHashesR2b> {
  const protocol = await fileHash(PROTOCOL_PATH);
  if (protocol === null) throw new Error(`${PROTOCOL_PATH} does not exist`);
  const files = await manifestFiles();
  return { protocol, code: await codeHashOf(files), files, calibration: await fileHash(CALIBRATION_PATH), record: parseProtocolRecord(await Deno.readTextFile(PROTOCOL_PATH)) };
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
  const a = parseArgs(Deno.args, { string: ["plan", "timing"], boolean: ["freeze2"] });
  const h = await actualHashes();
  const when = await sh("date -u +%Y-%m-%dT%H:%M:%SZ");
  if (a.freeze2) {
    if (h.calibration === null) { console.error("CALIBRATION.json does not exist; Freeze 2 needs it"); Deno.exit(1); }
    console.log(`# Freeze 2, ${when}: appended after calibration, before any confirmation run. Nothing above this line changes.`);
    console.log(`calibration_sha256: ${h.calibration}`);
  } else {
    if (a.plan !== "full" && a.plan !== "reduced") { console.error("give --plan full|reduced (the timing gate's choice, PROTOCOL.md section 3)"); Deno.exit(2); }
    if (!(Number(a.timing) > 0)) { console.error("give --timing <aggregate steps per second> from the timing gate"); Deno.exit(2); }
    if (planForTiming(Number(a.timing)) !== a.plan) { console.error(`the timing figure ${a.timing} implies the ${planForTiming(Number(a.timing)) ?? "NO (below 1,200: not started)"} plan, not ${a.plan}`); Deno.exit(2); }
    if (h.record === null || h.record.plan !== a.plan || h.record.timing !== Number(a.timing) || h.record.duplicates.length) { console.error(`PROTOCOL.md's FREEZE-1-RECORD must say plan: ${a.plan} and timing_steps_per_second: ${Number(a.timing)} (once each) before Freeze 1, so protocol_sha256 covers them`); Deno.exit(2); }
    console.log(`# Mycelium R2b FROZEN. Freeze 1, ${when}. Format and rules: PROTOCOL.md section 10.`);
    console.log(`# frozen_at: ${when}`);
    const base = await sh("git rev-parse HEAD").catch(() => "unknown");
    console.log(`# base_commit: ${base} (informational; the hashes below do not depend on git)`);
    console.log(`# deno: ${Deno.version.deno}, v8 ${Deno.version.v8}, typescript ${Deno.version.typescript} (informational)`);
    console.log(`protocol_sha256: ${h.protocol}`);
    console.log(`code_hash: ${h.code}`);
    console.log(`plan: ${a.plan}`);
    console.log(`timing_steps_per_second: ${Number(a.timing)}`);
    console.log("# per-file SHA-256 of everything code_hash covers (shasum -a 256 format); r2b.ts and r2b-analyze.ts verify each line");
    console.log(manifestText(h.files).trimEnd());
  }
}
