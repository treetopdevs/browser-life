/**
 * Predictability atlas evidence. CPU only. Run with Node 24 (relative imports only; @bl/* is resolved by the hook below
 * because the ecology clip reads the CPU reference simulator):
 *   node tools/predictability/atlas.ts --write         write evidence.json and manifest.json (once, deliberately)
 *   node tools/predictability/atlas.ts --check         validate the saved artifacts without simulating
 *   node tools/predictability/atlas.ts --replay-check  regenerate the payload and require byte equality
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { arch, platform } from "node:os";
import { buildPayload, canonical, relabel, sealPayload, sha256, verifySeal, type Payload } from "../../packages/metrics/src/predictability/atlas.ts";
import { baseFixtures, FIXTURE_SPECS } from "../../packages/metrics/src/predictability/fixtures.ts";
import { FFLATE_VERSION } from "../../packages/metrics/src/predictability/losses.ts";
import type { Movie } from "../../packages/metrics/src/predictability/movie.ts";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = `${REPO}docs/predictability-atlas-2026-11-01/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const BASE_COMMIT = "8d577be4";
const SRC_DIR = "packages/metrics/src/predictability/";

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

/** The ten fixtures and their parameter blocks. */
export async function allFixtures(): Promise<{ movies: Movie[]; meta: Record<string, unknown> }> {
  registerAliases();
  const { movies, blobs } = baseFixtures();
  const eco = await import("../../packages/metrics/src/predictability/ecology.ts");
  const clip = eco.ecologyClip();
  const meta: Record<string, unknown> = Object.fromEntries(FIXTURE_SPECS.map((s) => [s.id, s.params]));
  meta["blobs-diffuse"] = { ...(meta["blobs-diffuse"] as object), latentTotal: blobs.latentTotal, saturatedCellFrames: blobs.saturatedCellFrames, maxCount: blobs.maxCount, observed: "min(count, 15); saturation is counted, not hidden" };
  meta["ecology-clip"] = { protocol: eco.ECOLOGY, config: eco.ecologyConfig(), init: eco.ecologyInit() };
  return { movies: [...movies, clip], meta };
}

export async function generate(): Promise<Payload> {
  const { movies, meta } = await allFixtures();
  return sealPayload(buildPayload(movies, meta));
}

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
/** Directories whose .ts files feed the evidence: the library itself and what the ecology clip reads (presets, config, simulator). */
const SOURCE_DIRS = [SRC_DIR, "packages/schema/src/", "packages/sim-ref/src/"];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f));
  return [...dirs, "tools/predictability/atlas.ts"];
}
/** The installed fflate must be the version the compression numbers were recorded with. */
function installedFflate(root: string): string | null {
  const p = `${root}packages/metrics/node_modules/fflate/package.json`;
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { version: string }).version : null;
}
const sourceHashes = (): Record<string, string> => Object.fromEntries(sourceFiles().map((f) => [f, sha256(readFileSync(REPO + f))]));

export function makeManifest(payload: Payload, evidenceText: string): Record<string, unknown> {
  return {
    kind: "predictability-atlas-manifest",
    payloadFileSha256: sha256(evidenceText),
    integritySha256: payload.integritySha256,
    versions: payload.versions,
    sources: sourceHashes(),
    fixtures: payload.fixtures.map((f) => ({ id: f.id, sha256: f.sha256, params: f.params })),
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
  for (const f of payload.fixtures) {
    const m = (manifest.fixtures as { id: string; sha256: string }[]).find((x) => x.id === f.id);
    if (!m || m.sha256 !== f.sha256) problems.push(`fixture ${f.id}: manifest sha256 differs`);
  }
  const listed = Object.keys(manifest.sources as Record<string, string>);
  if (existsSync(root + SRC_DIR)) {
    for (const f of sourceFiles(root)) if (!listed.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  }
  const fflate = installedFflate(root);
  if (fflate !== null && fflate !== manifest.provenance?.fflate) problems.push(`installed fflate ${fflate} differs from the recorded ${manifest.provenance?.fflate}`);
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  const labels = relabel(payload);
  for (const [id, rec] of Object.entries(payload.labels)) if (labels[id] !== rec.label) problems.push(`label ${id} does not follow the stated rules`);
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
    const payload = await generate();
    const text = serialize(payload);
    writeFileSync(EVIDENCE, text);
    writeFileSync(MANIFEST, serialize(makeManifest(payload, text)));
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256}`);
  } else if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? checkSaved() : await replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`${mode} ok`);
  } else {
    console.error("usage: node tools/predictability/atlas.ts --write | --check | --replay-check");
    process.exit(2);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
