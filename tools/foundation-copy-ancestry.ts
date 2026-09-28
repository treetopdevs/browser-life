/** CPU-only, authenticated A1 source-1 preflight. No simulation or GPU is launched. */
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeArtifact } from "@bl/runner";
import { catalogAtTime, validateExtractionRule,
  type ExtractionCatalog, type ExtractionRule } from "./lib/foundation-extract.ts";
import { rankCatalogSelection } from "./lib/foundation-competition.ts";
import { OBSERVATION_FILES, sha256, verifyReplayCache,
  type FileDigest } from "./lib/foundation-replay.ts";
import { SERIAL_CATALOG_SHA256, SERIAL_RANK0_COMPONENT, SERIAL_RANK0_KEY,
  SERIAL_RULE_SHA256, SERIAL_SOURCE_RUN } from "./lib/foundation-serial-transfer.ts";
import { extractCellPacket } from "./lib/foundation-transplant.ts";
import { assertSamePacketPreflight, prepareSamePacketControls,
  type SamePacketArm } from "./lib/foundation-copy-ancestry.ts";

interface Options { source: string; cache: string; catalog: string; rule: string; out: string }
export function parseCopyAncestryArgs(args: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[i + 1];
    if (!["--source", "--cache", "--catalog", "--rule", "--out"].includes(key) ||
        !value || value.startsWith("--") || values.has(key))
      throw new Error(`invalid or duplicate option ${key}`);
    values.set(key, value); i++;
  }
  for (const key of ["--source", "--cache", "--catalog", "--rule", "--out"])
    if (!values.get(key)) throw new Error(`${key} is required`);
  return { source: resolve(values.get("--source")!), cache: resolve(values.get("--cache")!),
    catalog: resolve(values.get("--catalog")!), rule: resolve(values.get("--rule")!),
    out: resolve(values.get("--out")!) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const digestEqual = (a: FileDigest | undefined, b: FileDigest | undefined) =>
  !!a && !!b && a.sha256 === b.sha256 && a.bytes === b.bytes;
async function fileDigest(path: string): Promise<FileDigest> {
  const file = await Deno.open(path, { read: true });
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of file.readable) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}
export const COPY_ANCESTRY_CODE_FILES = [
  "tools/foundation-copy-ancestry.ts", "tools/lib/foundation-copy-ancestry.ts",
  "tools/lib/foundation-material-flow.ts", "tools/lib/foundation-serial-transfer.ts",
  "tools/lib/foundation-local-flow.ts", "tools/lib/foundation-component-material.ts",
  "tools/foundation-copy-diagnostic.ts",
  "tools/test/foundation-copy-ancestry.test.ts", "tools/test/foundation-copy-diagnostic.test.ts",
  "docs/foundations-copy-ancestry.md",
  "tools/lib/foundation-transplant.ts", "tools/lib/foundation-extract.ts",
  "tools/lib/foundation-replay.ts", "tools/lib/foundation-competition.ts",
  "packages/schema/src/world.ts", "packages/schema/src/layout.ts",
  "packages/schema/src/genome.ts", "packages/schema/src/accounting.ts",
  "packages/metrics/src/census.ts", "packages/sim-ref/src/step.ts",
] as const;
const armRecord = (arm: SamePacketArm) => ({ arm: arm.arm, packetSha256: arm.packetSha256,
  inoculumSha256: arm.inoculum?.sha256 ?? null, inventory: arm.inventory,
  step0: arm.preflight });

export async function buildCopyPreflight(opt: Options) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const store = { read: (name: string) => Deno.readFile(join(opt.cache, name)) };
  const cache = await verifyReplayCache(store);
  if (cache.source.runId !== SERIAL_SOURCE_RUN || cache.source.finalHashMode !== "artifact" ||
      cache.observerCompatible !== true || !same(cache.requestedSteps, [100_000, 500_000, 900_000]))
    throw new Error("source-1 cache lacks the required authenticated observer-compatible replay");
  const sourceFiles: Record<string, FileDigest> = {};
  for (const name of ["manifest.json", ...OBSERVATION_FILES])
    sourceFiles[name] = await fileDigest(join(opt.source, name));
  if (!same(sourceFiles, cache.source.files))
    throw new Error("original source files differ from authenticated cache");
  const [catalogBytes, ruleBytes] = await Promise.all([Deno.readFile(opt.catalog), Deno.readFile(opt.rule)]);
  const catalogFile = sha256(catalogBytes), ruleFile = sha256(ruleBytes);
  if (catalogFile.sha256 !== SERIAL_CATALOG_SHA256 || ruleFile.sha256 !== SERIAL_RULE_SHA256)
    throw new Error("source-1 catalog or fixed selection rule digest mismatch");
  const catalog = JSON.parse(new TextDecoder().decode(catalogBytes)) as ExtractionCatalog;
  const rule = JSON.parse(new TextDecoder().decode(ruleBytes)) as ExtractionRule;
  validateExtractionRule(rule);
  const cp = cache.checkpoints.find((row) => row.step === 900_000);
  const time = catalog.times.find((row) => row.step === 900_000);
  if (!cp || !time || time.checkpointSha256 !== cp.fileDigest.sha256)
    throw new Error("late catalog/checkpoint identity is missing");
  const { state, observer } = decodeArtifact(await store.read(cp.file));
  if (!same(catalogAtTime(state, observer, cp.file, cp.fileDigest.sha256, true, rule), time))
    throw new Error("late catalog differs from authenticated checkpoint");
  const selected = rankCatalogSelection(cache.source.runId, "late", ruleFile.sha256, time)[0];
  if (!selected || selected.idx !== SERIAL_RANK0_COMPONENT || selected.key !== SERIAL_RANK0_KEY)
    throw new Error("fixed source-1 rank-zero donor differs");
  const component = time.components.find((row) => row.idx === selected.idx);
  if (!component) throw new Error("fixed source component unavailable");
  const packet = extractCellPacket(state, component.cellIndices);
  const arms = prepareSamePacketControls(cache.source, packet);
  const codeFiles: Record<string, FileDigest> = {};
  for (const name of new Set([...COPY_ANCESTRY_CODE_FILES, ...Object.keys(cache.source.replayCodeFiles)]))
    codeFiles[name] = await fileDigest(join(root, name));
  for (const [name, expected] of Object.entries(cache.source.replayCodeFiles))
    if (!digestEqual(codeFiles[name], expected)) throw new Error(`authenticated replay code changed: ${name}`);
  let gate: "pass" | "blocked-preflight" = "pass", reason: string | null = null;
  try { assertSamePacketPreflight(arms); }
  catch (error) { gate = "blocked-preflight"; reason = error instanceof Error ? error.message : String(error); }
  return { format: 1, status: gate, createdAt: new Date().toISOString(),
    purpose: "A1 CPU-only physical initialization preflight, not a transmission result",
    inputs: opt, sourceRunId: cache.source.runId, sourceRevision: cache.source.codeRevision,
    sourceFinalArtifactHash: cache.final?.artifactHash, sourceFiles,
    cacheManifestFile: await fileDigest(join(opt.cache, "manifest.json")), catalogFile, ruleFile,
    checkpoint: { step: cp.step, file: cp.file, digest: cp.fileDigest },
    selectedComponent: { idx: selected.idx, key: selected.key, packetSha256: packet.sha256 },
    codeFiles, arms: arms.map(armRecord), reason,
    limitations: ["Founder's genotype is expressed on evolved geometry and is not natural founder morphology.",
      "Empty garden is not resource matched to inoculated arms.",
      "Topology at step 0 does not establish later reproduction or ancestry."] };
}

async function main() {
  const opt = parseCopyAncestryArgs(Deno.args);
  const output = await Deno.open(opt.out, { write: true, createNew: true });
  try {
    const report = await buildCopyPreflight(opt);
    await output.write(new TextEncoder().encode(JSON.stringify(report, null, 2) + "\n"));
    if (report.status !== "pass") Deno.exitCode = 2;
  } catch (error) {
    await output.write(new TextEncoder().encode(JSON.stringify({ format: 1, status: "failed-authentication",
      createdAt: new Date().toISOString(), inputs: opt,
      error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"));
    throw error;
  } finally { output.close(); }
}
if (import.meta.main) await main();
