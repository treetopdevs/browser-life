/**
 * I07b destruction/reconstruction evidence. CPU only, observer only. Run with Node 24 (relative imports only):
 *   node tools/assembly/destruction.ts --make-freeze               write FREEZE.json (hashes of the decision path)
 *   node tools/assembly/destruction.ts --write --freeze <sha>      score the frozen protocol once (refuses unless <sha> is a freeze ancestor and hashes match)
 *   node tools/assembly/destruction.ts --write-dev <dir>           dev-namespace dry run into <dir> (never the docs folder)
 *   node tools/assembly/destruction.ts --check                     validate the saved artifacts without simulating
 *   node tools/assembly/destruction.ts --replay-check              regenerate the payload and require byte equality
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPayload, canonical, sha256, verifySeal, type Payload } from "../../packages/metrics/src/assembly/destruction/observer.ts";
import { DPROTOCOL } from "../../packages/metrics/src/assembly/destruction/protocol.ts";
import { deriveTables, validateRows } from "../../packages/metrics/src/assembly/destruction/verdict.ts";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const DOCS = "docs/assembly-destruction-2026-11-02/";
export const EVIDENCE = `${REPO}${DOCS}evidence.json`;
export const MANIFEST = `${REPO}${DOCS}manifest.json`;
export const FREEZE_JSON = `${DOCS}FREEZE.json`;
export const BASE_COMMIT = "f94bb52b568e33ec0bbe429370b1fbd3aad4ed8a";
const SRC = "packages/metrics/src/assembly/destruction/";

/** The decision path pinned by the freeze commit (PLAN R9): protocol, damage, regrowth, processes, readouts, verdict, assembly, CLI. */
export const FROZEN_FILES = [
  `${DOCS}PROTOCOL.md`,
  ...["protocol", "damage", "regrow", "processes", "readouts", "verdict", "observer"].map((n) => `${SRC}${n}.ts`),
  "tools/assembly/destruction.ts",
];
/** First-rung sources and grammar this assay reuses unchanged, hashed alongside. */
export const REUSED_FILES = [
  "docs/assembly-observer-2026-11-02/GRAMMAR.md",
  ...["version", "protocol", "grammar", "segment", "exact", "bound", "construct", "readouts", "fixtures"].map((n) => `packages/metrics/src/assembly/${n}.ts`),
  "packages/metrics/src/predictability/movie.ts", "packages/metrics/src/predictability/losses.ts",
];
const ALL_PINNED = [...FROZEN_FILES, ...REUSED_FILES];

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
const git = (root: string, ...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const hashOf = (root: string, f: string): string => sha256(readFileSync(root + f));

export function makeFreeze(root = REPO): Record<string, unknown> {
  return { kind: "assembly-destruction-freeze", note: "hashes of the decision path; the freeze commit holds these files and no outcome", files: Object.fromEntries(ALL_PINNED.map((f) => [f, hashOf(root, f)])) };
}

/** The seed namespaces must be disjoint (a score seed never used for development). */
export function seedsDisjoint(): boolean {
  const dev = new Set(Object.values(DPROTOCOL.seeds.dev)), score = Object.values(DPROTOCOL.seeds.score);
  return score.every((s) => !dev.has(s)) && new Set(score).size === score.length;
}

/**
 * Freeze guard: `sha` is a 40-hex ancestor of HEAD, holds FREEZE.json plus only the frozen files (no outcome), FREEZE.json
 * at that commit equals the working copy, and every pinned file hashes to its recorded value now and at the freeze commit.
 */
export function checkFreeze(sha: string, root = REPO): string[] {
  if (!/^[0-9a-f]{40}$/.test(sha)) return [`freeze commit "${sha}" is not a 40-hex commit id`];
  const problems: string[] = [];
  try { git(root, "cat-file", "-e", `${sha}^{commit}`); } catch { return [`freeze commit ${sha} does not exist`]; }
  try { git(root, "merge-base", "--is-ancestor", sha, "HEAD"); } catch { return [`freeze commit ${sha} is not an ancestor of HEAD`]; }
  if (git(root, "rev-list", "--parents", "-n", "1", sha).trim().split(" ").length > 2) problems.push("freeze commit is a merge commit");
  const tree = git(root, "ls-tree", "-r", "--name-only", sha).split("\n");
  for (const f of ["evidence.json", "manifest.json", "EVIDENCE.md"]) if (tree.includes(DOCS + f)) problems.push(`${f} is present in the tree at the freeze commit`);
  const files = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).split("\n").filter(Boolean);
  const allowed = new Set([...FROZEN_FILES, FREEZE_JSON]);
  for (const f of files) if (!allowed.has(f)) problems.push(`freeze commit holds ${f}, which is not a freeze file`);
  for (const f of ["evidence.json", "manifest.json", "EVIDENCE.md"]) if (files.includes(DOCS + f)) problems.push(`${f} is in the freeze commit`);
  let atFreeze: { files: Record<string, string> };
  try {
    const text = git(root, "show", `${sha}:${FREEZE_JSON}`);
    if (text !== readFileSync(root + FREEZE_JSON, "utf8")) problems.push("FREEZE.json differs from its bytes at the freeze commit");
    atFreeze = JSON.parse(text);
  } catch { return [...problems, "FREEZE.json is not in the freeze commit"]; }
  for (const f of ALL_PINNED) {
    const want = atFreeze.files[f];
    if (!want) { problems.push(`${f} is not pinned by FREEZE.json`); continue; }
    if (hashOf(root, f) !== want) problems.push(`${f} changed since the freeze (hash differs from FREEZE.json)`);
    try { if (sha256(git(root, "show", `${sha}:${f}`)) !== want) problems.push(`${f} at the freeze commit does not match FREEZE.json`); } catch { if (FROZEN_FILES.includes(f)) problems.push(`${f} is not in the freeze commit`); }
  }
  return problems;
}

export function makeManifest(payload: Payload, evidenceText: string, freezeSha: string): Record<string, unknown> {
  return {
    kind: "assembly-destruction-manifest",
    payloadFileSha256: sha256(evidenceText), integritySha256: payload.integritySha256, versions: payload.versions,
    freezeCommit: freezeSha,
    sources: Object.fromEntries(ALL_PINNED.map((f) => [f, hashOf(REPO, f)])),
    rows: DPROTOCOL.processes.map((p) => ({ process: p, sha256: sha256(payload.rows.filter((r) => r.process === p).map((r) => r.sha256).join(",")) })),
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, node: process.version, platform: `${platform()}-${arch()}`, generatedAt: new Date().toISOString() },
  };
}

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export function checkSaved(evidencePath = EVIDENCE, manifestPath = MANIFEST, root = REPO, withFreeze = true): string[] {
  if (!existsSync(evidencePath) || !existsSync(manifestPath)) return ["evidence.json or manifest.json is missing"];
  const problems: string[] = [];
  const text = readFileSync(evidencePath, "utf8");
  const payload = JSON.parse(text) as Payload;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== sha256(text)) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (canonical(manifest.versions) !== canonical(payload.versions)) problems.push("manifest versions differ from the payload");
  if (canonical(payload.protocol) !== canonical(DPROTOCOL)) problems.push("payload protocol differs from protocol.ts");
  if (payload.namespace !== "score") problems.push(`payload namespace is ${payload.namespace}, not score`);
  if (!seedsDisjoint()) problems.push("dev and score seeds intersect");
  for (const r of manifest.rows as { process: string; sha256: string }[]) {
    if (r.sha256 !== sha256(payload.rows.filter((x) => x.process === r.process).map((x) => x.sha256).join(","))) problems.push(`rows ${r.process}: manifest sha256 differs`);
  }
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  for (const f of ALL_PINNED) if (!(f in (manifest.sources as Record<string, string>))) problems.push(`source ${f} is not in the manifest`);
  for (const r of payload.rows) { const { sha256: s, ...rest } = r; if (s !== sha256(canonical(rest))) problems.push(`row ${r.process} r${r.replicate}: hash differs from its content`); }
  const structural = validateRows(payload.rows);
  problems.push(...structural);
  if (structural.length === 0 && canonical(deriveTables(payload.rows)) !== canonical(payload.tables)) problems.push("tables do not follow the frozen rules from the stored rows");
  if (withFreeze) problems.push(...checkFreeze(String(manifest.freezeCommit ?? ""), root));
  return problems;
}

export async function replayCheck(evidencePath = EVIDENCE): Promise<string[]> {
  // never generate score rows unless the artifacts and the freeze are already sound
  const pre = checkSaved();
  if (pre.length) return pre;
  const fresh = serialize(buildPayload({ ns: "score" }));
  return fresh === readFileSync(evidencePath, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

function atomicWrite(path: string, text: string): void { writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path); }

async function main(): Promise<void> {
  const [mode, arg] = [process.argv[2], process.argv[3]];
  if (mode === "--make-freeze") {
    atomicWrite(REPO + FREEZE_JSON, serialize(makeFreeze()));
    console.log(`wrote ${FREEZE_JSON}`);
  } else if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    if (!seedsDisjoint()) throw new Error("dev and score seeds intersect");
    const sha = arg === "--freeze" ? process.argv[4] ?? "" : "";
    const bad = checkFreeze(sha);
    if (bad.length) { console.error(`refusing to write evidence:\n${bad.join("\n")}`); process.exit(1); }
    const t0 = Date.now();
    const payload = buildPayload({ ns: "score", log: (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`) });
    const text = serialize(payload);
    atomicWrite(EVIDENCE, text);
    atomicWrite(MANIFEST, serialize(makeManifest(payload, text, sha)));
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else if (mode === "--write-dev") {
    if (!arg) throw new Error("--write-dev needs an output directory");
    mkdirSync(arg, { recursive: true });
    const payload = buildPayload({ ns: "dev" });
    atomicWrite(`${arg}/evidence.json`, serialize(payload));
    console.log(`wrote dev evidence to ${arg}, seal ${payload.integritySha256}`);
  } else if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? checkSaved() : await replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`${mode} ok`);
  } else {
    console.error("usage: node tools/assembly/destruction.ts --make-freeze | --write --freeze <sha> | --write-dev <dir> | --check | --replay-check");
    process.exit(2);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
