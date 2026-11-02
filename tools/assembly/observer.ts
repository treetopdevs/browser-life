/**
 * Assembly-inspired observer evidence. CPU only. Run with Node 24 (relative imports only; @bl/* is resolved by the hook below
 * because the clips read the CPU reference simulator):
 *   node tools/assembly/observer.ts --write         write evidence.json and manifest.json (once, deliberately)
 *   node tools/assembly/observer.ts --check         validate the saved artifacts without simulating
 *   node tools/assembly/observer.ts --replay-check  regenerate the payload and require byte equality
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { arch, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPayload, canonical, deriveVerdicts, validateCalibration, sha256, verifySeal, type Payload } from "../../packages/metrics/src/assembly/observer.ts";
import { PROTOCOL } from "../../packages/metrics/src/assembly/protocol.ts";
import { CLASS_IDS, SEAM_IDS } from "../../packages/metrics/src/assembly/fixtures.ts";
import { FFLATE_VERSION } from "../../packages/metrics/src/predictability/losses.ts";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = `${REPO}docs/assembly-observer-2026-11-02/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const BASE_COMMIT = "c5098735";
const SRC_DIR = "packages/metrics/src/assembly/";
const FREEZE_FILES = ["docs/assembly-observer-2026-11-02/GRAMMAR.md", "docs/assembly-observer-2026-11-02/PROTOCOL.md"];

let hooked = false;
function registerAliases(): void {
  if (hooked || process.env.VITEST) return;
  hooked = true;
  try {
    registerHooks({
      resolve(specifier, context, next) {
        const m = /^@bl\/(.+)$/.exec(specifier);
        return m ? next(pathToFileURL(`${REPO}packages/${m[1]}/src/index.ts`).href, context) : next(specifier, context);
      },
    });
  } catch { /* already running under a loader that resolves @bl/* (vitest) */ }
}

export async function generate(log?: (s: string) => void): Promise<Payload> {
  registerAliases();
  const clips = await import("../../packages/metrics/src/assembly/clips.ts");
  return buildPayload((preset) => ({ frames: clips.clipFrames(preset), side: clips.clipSide() }), { log });
}

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
/** Directories whose .ts files feed the evidence: the library, the I14 helpers it imports, and what the clips read. */
const SOURCE_DIRS = [SRC_DIR, "packages/metrics/src/predictability/", "packages/schema/src/", "packages/sim-ref/src/"];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f));
  const amendDir = "docs/assembly-observer-2026-11-02/";
  const amendments = existsSync(`${root}${amendDir}`) ? readdirSync(`${root}${amendDir}`).filter((f) => /^amendment-.*\.(md|json)$/.test(f)).sort().map((f) => amendDir + f) : [];
  return [...dirs, "tools/assembly/observer.ts", ...FREEZE_FILES, ...amendments];
}
function installedFflate(root: string): string | null {
  const p = `${root}packages/metrics/node_modules/fflate/package.json`;
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { version: string }).version : null;
}
const sourceHashes = (): Record<string, string> => Object.fromEntries(sourceFiles().map((f) => [f, sha256(readFileSync(REPO + f))]));

export function freezeCommit(): string {
  const log = execFileSync("git", ["log", "--format=%H", "--diff-filter=A", "--", FREEZE_FILES[1]], { cwd: REPO, encoding: "utf8" }).trim().split("\n");
  return log[log.length - 1];
}

export function makeManifest(payload: Payload, evidenceText: string): Record<string, unknown> {
  return {
    kind: "assembly-observer-manifest",
    payloadFileSha256: sha256(evidenceText),
    integritySha256: payload.integritySha256,
    versions: payload.versions,
    freezeCommit: freezeCommit(),
    sources: sourceHashes(),
    calibration: payload.calibration.map((c) => ({ id: c.id, sha256: sha256(c.replicates.map((r) => r.sha256).join(",")) })),
    fixtures: [...payload.fixtures, ...payload.clips].map((f) => ({ id: f.id, sha256: f.sha256 })),
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, node: process.version, fflate: FFLATE_VERSION, platform: `${platform()}-${arch()}`, generatedAt: new Date().toISOString() },
  };
}

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export function checkSaved(evidencePath = EVIDENCE, manifestPath = MANIFEST, root = REPO): string[] {
  const problems: string[] = [];
  if (!existsSync(evidencePath) || !existsSync(manifestPath)) return ["evidence.json or manifest.json is missing"];
  const text = readFileSync(evidencePath, "utf8");
  const payload = JSON.parse(text) as Payload;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== sha256(text)) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (canonical(manifest.versions) !== canonical(payload.versions)) problems.push("manifest versions differ from the payload");
  for (const c of payload.calibration) {
    const m = (manifest.calibration as { id: string; sha256: string }[]).find((x) => x.id === c.id);
    if (!m || m.sha256 !== sha256(c.replicates.map((r) => r.sha256).join(","))) problems.push(`calibration ${c.id}: manifest sha256 differs`);
  }
  for (const f of [...payload.fixtures, ...payload.clips]) {
    const m = (manifest.fixtures as { id: string; sha256: string }[]).find((x) => x.id === f.id);
    if (!m || m.sha256 !== f.sha256) problems.push(`fixture ${f.id}: manifest sha256 differs`);
  }
  const listed = Object.keys(manifest.sources as Record<string, string>);
  if (existsSync(root + SRC_DIR)) for (const f of sourceFiles(root)) if (!listed.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  const fflate = installedFflate(root);
  if (fflate !== null && fflate !== manifest.provenance?.fflate) problems.push(`installed fflate ${fflate} differs from the recorded ${manifest.provenance?.fflate}`);
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  // structure first: a verdict derived from a missing or empty class would be vacuous
  const wantIds = [...CLASS_IDS, ...SEAM_IDS] as string[];
  if (payload.replicates !== PROTOCOL.replicates) problems.push(`replicates ${payload.replicates} differ from the protocol (${PROTOCOL.replicates})`);
  if (canonical(payload.calibration.map((c) => c.id)) !== canonical(wantIds)) problems.push("calibration classes differ from the protocol's thirteen");
  problems.push(...validateCalibration(payload.calibration, PROTOCOL.replicates));
  if (canonical(payload.fixtures.map((f) => f.id)) !== canonical(PROTOCOL.movieFixtures)) problems.push("movie fixtures differ from the protocol list");
  if (canonical(payload.clips.map((c) => c.preset)) !== canonical(PROTOCOL.clips.presets)) problems.push("clips differ from the protocol list");
  if (canonical(payload.protocol) !== canonical(PROTOCOL)) problems.push("payload protocol differs from protocol.ts");
  if (!problems.some((x) => x.startsWith("required class") || x.includes("replicates"))) {
    // verdicts must follow the stated rule from the stored rows
    const again = deriveVerdicts(payload.calibration);
    if (canonical(again.verdicts) !== canonical(payload.verdicts)) problems.push("verdicts do not follow the frozen rule from the stored rows");
  }
  problems.push(...checkFreeze(String(manifest.freezeCommit ?? ""), root));
  problems.push(...checkPins(root));
  return problems;
}

const FREEZE_DOCS = FREEZE_FILES.map((f) => f.slice(f.lastIndexOf("/") + 1));
const DOCS_DIR = "docs/assembly-observer-2026-11-02/";

/**
 * The freeze commit must be a real, well-formed ancestor that holds exactly the two frozen documents with today's bytes
 * and no outcome file. Skipped only when git history is genuinely unavailable (no repository, or a shallow clone lacking it).
 */
export function checkFreeze(freeze: string, root = REPO): string[] {
  if (!/^[0-9a-f]{40}$/.test(freeze) || /^0{40}$/.test(freeze)) return [`freezeCommit "${freeze}" is not a 40-hex commit id`];
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let shallow = false;
  try { shallow = git("rev-parse", "--is-shallow-repository").trim() === "true"; } catch { return []; }
  try { git("cat-file", "-e", `${freeze}^{commit}`); } catch { return shallow ? [] : [`freeze commit ${freeze} does not exist in this repository`]; }
  // a shallow clone may cut the history between the freeze and HEAD: ancestry is then unverifiable, but the commit's contents are not
  try { git("merge-base", "--is-ancestor", freeze, "HEAD"); } catch { if (!shallow) return [`freeze commit ${freeze} is not an ancestor of HEAD`]; }
  const problems: string[] = [];
  const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", freeze).split("\n").filter(Boolean).sort();
  if (canonical(files) !== canonical(FREEZE_FILES.slice().sort())) problems.push(`freeze commit holds ${files.join(", ")}, expected only ${FREEZE_FILES.join(", ")}`);
  for (const f of FREEZE_DOCS) {
    try {
      if (git("show", `${freeze}:${DOCS_DIR}${f}`) !== readFileSync(`${root}${DOCS_DIR}${f}`, "utf8")) problems.push(`${f} differs from its bytes at the freeze commit`);
    } catch { problems.push(`${f} is not in the freeze commit`); }
  }
  for (const f of ["evidence.json", "manifest.json"]) {
    try { git("cat-file", "-e", `${freeze}:${DOCS_DIR}${f}`); problems.push(`${f} already existed at the freeze commit`); } catch { /* absent: as required */ }
  }
  return problems;
}

/** Hashes of the algorithm files named in PROTOCOL.md, or the post-freeze value recorded in an outcomeExposed amendment. */
export function checkPins(root = REPO): string[] {
  const problems: string[] = [];
  const md = readFileSync(`${root}${DOCS_DIR}PROTOCOL.md`, "utf8");
  const rows = [...md.matchAll(/\| `(packages\/metrics\/src\/assembly\/[a-z0-9]+\.ts)` \| `([0-9a-f]{64})` \|/g)];
  if (rows.length !== 7) problems.push(`PROTOCOL.md pins ${rows.length} files, expected 7`);
  const amended = new Map<string, string>();
  for (const f of readdirSync(`${root}${DOCS_DIR}`).filter((x) => /^amendment-.*\.json$/.test(x)).sort()) {
    const a = JSON.parse(readFileSync(`${root}${DOCS_DIR}${f}`, "utf8")) as { outcomeExposed?: boolean; pins?: Record<string, string> };
    if (!a.pins) continue;
    if (a.outcomeExposed !== true) problems.push(`${f} records pins but is not marked outcomeExposed`);
    for (const [file, hash] of Object.entries(a.pins)) amended.set(file, hash);
  }
  for (const [, file, hash] of rows) {
    const have = sha256(readFileSync(root + file));
    if (have !== hash && have !== amended.get(file)) problems.push(`pinned ${file} matches neither PROTOCOL.md nor an amendment pin`);
  }
  for (const [file, hash] of amended) if (sha256(readFileSync(root + file)) !== hash) problems.push(`amendment pin for ${file} no longer matches`);
  return problems;
}

export async function replayCheck(evidencePath = EVIDENCE): Promise<string[]> {
  const fresh = serialize(await generate());
  return fresh === readFileSync(evidencePath, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    const t0 = Date.now();
    const payload = await generate((s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`));
    const text = serialize(payload);
    const manifestText = serialize(makeManifest(payload, text));
    writeFileSync(`${EVIDENCE}.tmp`, text);
    writeFileSync(`${MANIFEST}.tmp`, manifestText);
    renameSync(`${EVIDENCE}.tmp`, EVIDENCE);
    renameSync(`${MANIFEST}.tmp`, MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? checkSaved() : await replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`${mode} ok`);
  } else {
    console.error("usage: node tools/assembly/observer.ts --write | --check | --replay-check");
    process.exit(2);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
