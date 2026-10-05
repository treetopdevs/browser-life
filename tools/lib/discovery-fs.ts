// On-disk layout of a discovery campaign root (DESIGN section 5), shared by
// tools/discovery.ts (shards), tools/discovery-worker.ts and the plane's
// export. Every reader re-validates: a directory's existence is never
// acceptance.
//
//   protocol.json                 the authored protocol, as frozen
//   manifest.json                 canonical JSON of the CampaignManifest
//   MANIFEST-DIGEST               SHA-256 of manifest.json
//   initial/<sha256>.blck         immutable initial-state artifacts
//   cases/<caseId>/case.json      canonical CaseSpec
//   cases/<caseId>/attempts/<attemptId>/        primary attempts
//   replays/<caseId>/<host>/<attemptId>/        replay attempts
//   .../.partial-<attemptId>/     an attempt in progress or interrupted; retained, never reused
//   acceptance.json, report.json, report.md, runlog.jsonl

import {
  RESULT_FILES,
  campaignCoreDigest,
  canonicalJSON,
  caseIdOf,
  manifestDigest,
  sha256Hex,
  validateCaseSpec,
  validateManifest,
  type CampaignManifest,
  type CaseSpec,
  type ResultFile,
  type ResultManifest,
} from "@bl/schema";
import { decideCase, validateAttempt, type AcceptanceIndex, type AttemptInfo, type CaseAcceptance, type CaseContext, type CaseFiles } from "../../packages/runner/src/discovery.ts";

import { pinnedValidator } from "./discovery-pin.ts";
import { fileURLToPath } from "node:url";

/** Repository root of this checkout, where the vendored pin lives. */
const PIN_REPO = fileURLToPath(new URL("../..", import.meta.url));
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface Campaign {
  root: string;
  manifest: CampaignManifest;
  manifestDigest: string;
  campaignDigest: string;
  specs: Map<string, CaseSpec>;
  /** Verified initial artifacts by digest; null when missing or corrupt. */
  initials: Map<string, Uint8Array | null>;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** Writes bytes and flushes them to stable storage before returning. */
export async function writeDurable(path: string, bytes: Uint8Array): Promise<void> {
  const f = await Deno.open(path, { write: true, createNew: true });
  try {
    let off = 0;
    while (off < bytes.length) off += await f.write(bytes.subarray(off));
    await f.sync();
  } finally {
    f.close();
  }
}

/**
 * Flushes a directory entry so a rename into it is durable. Supported on
 * macOS and Linux; a failure there is a real storage error and propagates.
 * Windows cannot open directories for sync, so it is skipped only there.
 */
export async function syncDir(path: string): Promise<void> {
  if (Deno.build.os === "windows") return;
  const d = await Deno.open(path, { read: true });
  try {
    await d.sync();
  } finally {
    d.close();
  }
}

/**
 * Creates `dir` and any missing ancestors, then flushes every ancestor's
 * directory entries up to the filesystem root, whether or not this call
 * created them: another process may have created an entry and not flushed it
 * yet, and success here must not depend on that process.
 */
export async function mkdirDurable(dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  for (let d = dir; d !== "/" && d !== ""; d = d.slice(0, d.lastIndexOf("/")) || "/") await syncDir(d.slice(0, d.lastIndexOf("/")) || "/");
}

/** Atomically and durably replaces `path`: a unique temporary file, fsync, rename, directory fsync. */
export async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeDurable(tmp, bytes);
    await Deno.rename(tmp, path);
  } catch (e) {
    await Deno.remove(tmp).catch(() => {});
    throw e;
  }
  await syncDir(dir);
}

/** Loads and checks a campaign root's frozen files: manifest digest, case specs, case IDs. */
export async function loadCampaign(root: string): Promise<Campaign> {
  const mBytes = await Deno.readFile(`${root}/manifest.json`);
  const manifest = JSON.parse(dec.decode(mBytes)) as CampaignManifest;
  if (canonicalJSON(manifest) !== dec.decode(mBytes)) throw new Error("manifest.json is not canonical");
  const merrs = validateManifest(manifest);
  if (merrs.length) throw new Error(`manifest.json: ${merrs.join("; ")}`);
  const md = await manifestDigest(manifest);
  const recorded = (await Deno.readTextFile(`${root}/MANIFEST-DIGEST`)).trim();
  if (recorded !== md) throw new Error(`MANIFEST-DIGEST ${recorded} does not match manifest.json (${md})`);
  const campaignDigest = await campaignCoreDigest(manifest);
  const specs = new Map<string, CaseSpec>();
  for (const id of manifest.orderedCaseIds) {
    const text = await Deno.readTextFile(`${root}/cases/${id}/case.json`);
    const spec = JSON.parse(text) as CaseSpec;
    if (canonicalJSON(spec) !== text) throw new Error(`case ${id}: case.json is not canonical`);
    const serrs = validateCaseSpec(spec);
    if (serrs.length) throw new Error(`case ${id}: ${serrs.join("; ")}`);
    if ((await caseIdOf(spec)) !== id) throw new Error(`case ${id}: case.json does not hash to its ID`);
    if (spec.campaignDigest !== campaignDigest) throw new Error(`case ${id}: binds a different campaign`);
    specs.set(id, spec);
  }
  return { root, manifest, manifestDigest: md, campaignDigest, specs, initials: new Map() };
}

/** The case's initial artifact if present and intact, else null (cached per load). */
export async function initialFor(c: Campaign, spec: CaseSpec): Promise<Uint8Array | null> {
  const d = spec.initialArtifactDigest;
  if (!c.initials.has(d)) {
    const p = `${c.root}/initial/${d}.blck`;
    const bytes = (await exists(p)) ? await Deno.readFile(p) : null;
    c.initials.set(d, bytes && (await sha256Hex(bytes)) === d ? bytes : null);
  }
  return c.initials.get(d)!;
}

export async function readInitial(c: Campaign, spec: CaseSpec): Promise<Uint8Array> {
  const bytes = await initialFor(c, spec);
  if (!bytes) throw new Error(`initial artifact ${spec.initialArtifactDigest} is missing or corrupt`);
  return bytes;
}

export interface AttemptDir {
  dir: string;
  attemptId: string;
  role: "primary" | "replay";
  /** The host label in the directory layout (replays) or parsed from the attempt ID. */
  host: string;
  partial: boolean;
  /** Rejected by the plane's coordinator (for example a completion after its lease expired): kept, never counted. */
  planeRejected?: boolean;
}

async function listDir(p: string): Promise<string[]> {
  if (!(await exists(p))) return [];
  const out: string[] = [];
  for await (const e of Deno.readDir(p)) if (e.isDirectory) out.push(e.name);
  return out.sort();
}

/** Attempt IDs are `<host>.<role>.<k>`. */
export const attemptHost = (attemptId: string) => attemptId.split(".")[0];

export async function listAttempts(root: string, caseId: string): Promise<AttemptDir[]> {
  const out: AttemptDir[] = [];
  const add = (dir: string, name: string, role: "primary" | "replay", host: string) => {
    const prefix = /^\.(partial|rejected)-/.exec(name);
    const attemptId = prefix ? name.slice(prefix[0].length) : name;
    out.push({ dir: `${dir}/${name}`, attemptId, role, host, partial: prefix?.[1] === "partial", planeRejected: prefix?.[1] === "rejected" });
  };
  const pdir = `${root}/cases/${caseId}/attempts`;
  for (const name of await listDir(pdir)) add(pdir, name, "primary", attemptHost(name.replace(/^\.(partial|rejected)-/, "")));
  for (const host of await listDir(`${root}/replays/${caseId}`)) {
    const rdir = `${root}/replays/${caseId}/${host}`;
    for (const name of await listDir(rdir)) add(rdir, name, "replay", host);
  }
  return out;
}

export async function readAttemptFiles(dir: string): Promise<{ result: Uint8Array | null; files: Partial<Record<ResultFile, Uint8Array>> }> {
  const read = async (n: string) => ((await exists(`${dir}/${n}`)) ? await Deno.readFile(`${dir}/${n}`) : null);
  const files: Partial<Record<ResultFile, Uint8Array>> = {};
  for (const f of RESULT_FILES) {
    const b = await read(f);
    if (b) files[f] = b;
  }
  return { result: await read("result.json"), files };
}

/** Validates one attempt directory, including that its location agrees with its own record. */
export async function checkAttempt(c: Campaign, caseId: string, a: AttemptDir): Promise<AttemptInfo> {
  const ctx: CaseContext = { manifest: c.manifest, campaignDigest: c.campaignDigest, caseId, spec: c.specs.get(caseId)! };
  if (a.partial) return { attemptId: a.attemptId, role: a.role, physicalHostId: a.host, partial: true, canonical: null, verdict: { valid: false, errors: ["interrupted: partial attempt retained"], readout: null } };
  if (a.planeRejected) {
    const why = (JSON.parse(await Deno.readTextFile(`${a.dir}/plane-status.json`).catch(() => '{"errors":[]}')) as { errors: string[] }).errors;
    return { attemptId: a.attemptId, role: a.role, physicalHostId: a.host, partial: false, canonical: null, verdict: { valid: false, errors: [`rejected by the coordinator: ${why.join("; ") || "no reason recorded"}`], readout: null } };
  }
  const { result, files } = await readAttemptFiles(a.dir);
  const verdict = await validateAttempt(ctx, result, files, await initialFor(c, ctx.spec), pinnedValidator(PIN_REPO));
  let r: ResultManifest | null = null;
  try {
    r = result ? (JSON.parse(dec.decode(result)) as ResultManifest) : null;
  } catch {
    r = null;
  }
  if (verdict.valid && r) {
    const where: string[] = [];
    if (r.execution.attemptId !== a.attemptId) where.push("attempt ID differs from its directory");
    if (r.execution.role !== a.role) where.push(`recorded role ${r.execution.role} differs from its location (${a.role})`);
    if (r.execution.physicalHostId !== a.host) where.push(`recorded host ${r.execution.physicalHostId} differs from its location (${a.host})`);
    if (where.length) return { attemptId: a.attemptId, role: a.role, physicalHostId: a.host, partial: false, canonical: null, verdict: { valid: false, errors: where, readout: null } };
  }
  return { attemptId: a.attemptId, role: a.role, physicalHostId: r?.execution.physicalHostId ?? a.host, partial: false, canonical: verdict.valid ? r!.canonical : null, verdict };
}

export async function decideFromDisk(c: Campaign, caseId: string): Promise<CaseAcceptance> {
  const infos: AttemptInfo[] = [];
  for (const a of await listAttempts(c.root, caseId)) infos.push(await checkAttempt(c, caseId, a));
  return decideCase(caseId, infos);
}

export async function buildAcceptanceIndex(c: Campaign): Promise<AcceptanceIndex> {
  const cases: CaseAcceptance[] = [];
  for (const id of c.manifest.orderedCaseIds) cases.push(await decideFromDisk(c, id));
  const known = new Set(c.manifest.orderedCaseIds);
  const strays = [...(await listDir(`${c.root}/cases`)), ...(await listDir(`${c.root}/replays`))].filter((d) => !known.has(d)).sort();
  return { schemaVersion: "discovery-v1", manifestDigest: c.manifestDigest, policy: c.manifest.verificationPolicy, cases, strays };
}

/**
 * Publishes a finished attempt: writes every file durably into the attempt's
 * `.partial-` directory, then renames it into place. The partial directory
 * already exists (created when the attempt started), so an interruption at
 * any point leaves it behind as a retained partial attempt.
 */
export async function publishAttempt(partialDir: string, finalDir: string, result: ResultManifest, files: CaseFiles): Promise<void> {
  for (const f of RESULT_FILES) await writeDurable(`${partialDir}/${f}`, files[f]);
  await writeDurable(`${partialDir}/result.json`, enc.encode(canonicalJSON(result)));
  await syncDir(partialDir);
  if (await exists(finalDir)) throw new Error(`refusing to overwrite attempt ${finalDir}`);
  await Deno.rename(partialDir, finalDir);
  await syncDir(finalDir.slice(0, finalDir.lastIndexOf("/")));
}

export async function dirBytes(p: string): Promise<number> {
  if (!(await exists(p))) return 0;
  let total = 0;
  for await (const e of Deno.readDir(p)) {
    const q = `${p}/${e.name}`;
    if (e.isDirectory) total += await dirBytes(q);
    else if (e.isFile) total += (await Deno.stat(q)).size;
  }
  return total;
}
