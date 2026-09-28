// CPU-only catalog of exact members, genomes and resource inventory from a verified replay cache.
// deno run -A tools/foundation-extract.ts --source /path/to/source-bundle \
//   --cache /path/to/verified-cache --rule /path/to/predeclared-rule.json --out /path/to/new-catalog.json
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OBSERVATION_FILES, type FileDigest } from "./lib/foundation-replay.ts";
import { EXTRACTOR_SOURCE_FILES, buildExtractionCatalog, type ExtractionRule } from "./lib/foundation-extract.ts";

function options(args: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || values.has(args[i])) throw new Error(`invalid or duplicate option ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  for (const key of values.keys()) if (!["--source", "--cache", "--rule", "--out"].includes(key)) throw new Error(`unknown option ${key}`);
  for (const key of ["--source", "--cache", "--rule", "--out"]) if (!values.get(key)) throw new Error(`${key} is required`);
  return { source: values.get("--source")!, cache: values.get("--cache")!, rule: values.get("--rule")!, out: values.get("--out")! };
}

async function digestFile(path: string): Promise<FileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const chunk of file.readable) { hash.update(chunk); bytes += chunk.byteLength; }
  return { sha256: hash.digest("hex"), bytes };
}

async function main() {
  const a = options(Deno.args);
  const ruleBytes = await Deno.readFile(a.rule);
  const rule = JSON.parse(new TextDecoder().decode(ruleBytes)) as ExtractionRule;
  const ruleFileSha256 = createHash("sha256").update(ruleBytes).digest("hex");
  const sourceFiles: Record<string, FileDigest> = {};
  for (const name of ["manifest.json", ...OBSERVATION_FILES]) sourceFiles[name] = await digestFile(join(a.source, name));
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const extractorFiles: Record<string, FileDigest> = {};
  for (const name of EXTRACTOR_SOURCE_FILES) extractorFiles[name] = await digestFile(join(projectRoot, name));
  const catalog = await buildExtractionCatalog({ read: (name) => Deno.readFile(join(a.cache, name)) }, sourceFiles, rule, ruleFileSha256,
    { extractorFiles, sourcePathHint: resolve(a.source), cachePathHint: resolve(a.cache), createdAt: new Date().toISOString() });
  await Deno.writeTextFile(a.out, JSON.stringify(catalog, null, 2) + "\n", { createNew: true });
  console.log(JSON.stringify({ status: catalog.status, source: catalog.sourceRunId, provenance: catalog.provenance,
    times: catalog.times.map((time) => ({ step: time.step, lineages: time.lineages.length,
      components: time.components.length, selected: time.components.filter((c) => c.selected).length,
      trackerIdentity: time.trackerIdentity, extinct: time.extinct })), out: a.out }));
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exitCode = 1;
});
