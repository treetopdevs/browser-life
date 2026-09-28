// CPU-only analysis of the fixed five-history competition matrix. Never acquires a GPU.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReplayCache, type FileDigest } from "./lib/foundation-replay.ts";
import { analyzeCompetition } from "./lib/foundation-competition-analysis.ts";
import type { CompetitionManifest } from "./foundation-competition.ts";

interface Options { plan: string; batches: string[]; out: string }
export function parseAnalysisArgs(args: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (!["--plan", "--batches", "--out"].includes(args[i]) ||
        !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i]))
      throw new Error(`invalid or duplicate option ${args[i]}`);
    values.set(args[i], args[++i]);
  }
  const plan = values.get("--plan"), out = values.get("--out"), batches = values.get("--batches")?.split(",");
  if (!plan || !out || !batches?.length || batches.some((v) => !v.trim()) ||
      new Set(batches.map((path) => resolve(path))).size !== batches.length)
    throw new Error("--plan, --batches and --out are required with distinct batch paths");
  return { plan: resolve(plan), batches: batches.map((path) => resolve(path)), out: resolve(out) };
}

function hash(bytes: Uint8Array): FileDigest {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}
async function hashFile(path: string): Promise<FileDigest> {
  const file = await Deno.open(path, { read: true });
  const digest = createHash("sha256"); let bytes = 0;
  for await (const chunk of file.readable) { digest.update(chunk); bytes += chunk.byteLength; }
  return { sha256: digest.digest("hex"), bytes };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function verifySourceArtifacts(plan: CompetitionManifest): Promise<void> {
  for (const source of plan.sources) {
    for (const [name, expected] of Object.entries(source.sourceFiles)) {
      const actual = await hashFile(join(source.sourcePath, name));
      if (!same(actual, expected)) throw new Error(`source ${source.worldId}/${name} changed after the fixed plan`);
    }
    if (!same(await hashFile(join(source.cachePath, "manifest.json")), source.cacheManifestFile) ||
        !same(await hashFile(source.catalogPath), source.catalogFile))
      throw new Error(`cache or catalog changed for ${source.worldId}`);
    const cache = await verifyReplayCache({ read: (name) => Deno.readFile(join(source.cachePath, name)) });
    if (cache.source.finalHashMode !== "artifact" ||
        cache.source.finalHash !== source.sourceFinalArtifactHash ||
        cache.source.codeRevision !== source.sourceCodeRevision ||
        cache.source.presetIdentity !== source.sourcePresetIdentity ||
        !same(cache.source.files, source.sourceFiles) ||
        !cache.observerCompatible)
      throw new Error(`replay cache provenance differs for ${source.worldId}`);
  }
}

async function main(): Promise<void> {
  const opt = parseAnalysisArgs(Deno.args), startedAt = new Date().toISOString();
  await Deno.mkdir(opt.out); // create-new reservation: never overwrite an analysis artifact
  try {
    const planBytes = await Deno.readFile(opt.plan);
    const plan = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(planBytes)) as CompetitionManifest;
    const batchInputs = await Promise.all(opt.batches.map(async (path) => {
      const bytes = await Deno.readFile(path);
      return { path, digest: hash(bytes), value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as CompetitionManifest };
    }));
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const analyzerFiles = Object.fromEntries(await Promise.all([
      "tools/foundation-competition-analysis.ts", "tools/lib/foundation-competition-analysis.ts",
      "tools/lib/foundation-lifecycle.ts", "tools/lib/foundation-competition.ts",
    ].map(async (name) => [name, await hashFile(join(projectRoot, name))] as const)));
    const analysis = analyzeCompetition(plan, batchInputs.map((b) => b.value));
    await verifySourceArtifacts(plan);
    const analyzerFilesAfter = Object.fromEntries(await Promise.all(Object.keys(analyzerFiles)
      .map(async (name) => [name, await hashFile(join(projectRoot, name))] as const)));
    if (!same(analyzerFilesAfter, analyzerFiles)) throw new Error("analysis code changed during execution");
    const output = { format: 1, status: "complete", createdAt: startedAt,
      inputs: { plan: { path: opt.plan, digest: hash(planBytes) },
        batches: batchInputs.map(({ path, digest }) => ({ path, digest })) },
      analyzerCodeFiles: analyzerFiles, sourceFilesRevalidated: true, analysis };
    await Deno.writeTextFile(join(opt.out, "analysis.json"), JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify({ status: "complete", out: opt.out, sourceHistories: 5,
      completedRuns: analysis.completeRunCount, unavailableRuns: analysis.unavailableRunCount,
      gpuStarted: false }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Deno.writeTextFile(join(opt.out, "failure.json"), JSON.stringify({ format: 1, status: "failed",
      startedAt, endedAt: new Date().toISOString(), failure: message, gpuStarted: false }, null, 2) + "\n");
    throw error;
  }
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); Deno.exitCode = 1; });
