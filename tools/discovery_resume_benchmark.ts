import { dirname } from "node:path";
// CPU-only synthetic checkpoint fixture; no simulation, pilot acceptance or study evidence.
import { DEFAULT_RULE_VERSION } from "@bl/schema";
import { sha256 } from "./lib/founder-policy.ts";
import { discoveryEvolutionWorld } from "./lib/discovery-evolution.ts";
import {
  buildManifest,
  CHECKPOINT_STEPS,
  loadCheckpointChain,
  type LoadedCheckpoint,
  loadVerifiedChainCache,
  writeCheckpoint,
  writeVerifiedChainCache,
} from "./lib/discovery-improvement-runtime.ts";

const [pilotDesignPath, rawDir, reportPath] = Deno.args;
if (
  !pilotDesignPath || !rawDir || !reportPath ||
  !/^runs\/[A-Za-z0-9_/-]+$/.test(rawDir) || rawDir.includes("..")
) {
  throw Error(
    "usage: discovery_resume_benchmark.ts PILOT_DESIGN NEW_runs/DIR NEW_REPORT",
  );
}
const inputBytes = await Deno.readFile(pilotDesignPath);
const design = JSON.parse(new TextDecoder().decode(inputBytes));
const files = [
  ...new Set([
    ...Object.keys(design.sources),
    "tools/discovery_resume_benchmark.ts",
    "tools/lib/discovery-improvement-runtime.ts",
    "tools/lib/discovery-evolution.ts",
    "tools/lib/discovery-improvement-summary.ts",
    "tools/lib/discovery-competition.ts",
    "tools/lib/founder-policy.ts",
  ]),
].sort();
const sourceHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, sha256(await Deno.readFile(p))]),
  ),
);
for (const [path, expected] of Object.entries(design.sources)) {
  if (sourceHashes[path] !== expected) {
    throw Error(`Pinned pilot source drift: ${path}`);
  }
}
const marker =
  "SYNTHETIC ENGINEERING FIXTURE: NO EVOLUTION OR PILOT ACCEPTANCE";
const manifest = buildManifest({
  format: "discovery-improvement-manifest/v1",
  ruleVersion: DEFAULT_RULE_VERSION,
  sourceRoot: Deno.cwd(),
  pilotDesignSha256: sha256(inputBytes),
  pilotAnalysisSha256: sha256(marker),
  inputs: { [pilotDesignPath]: sha256(inputBytes) },
  sources: sourceHashes,
  sourceManifestHash: sha256(JSON.stringify(sourceHashes)),
  founders: design.founders.map((
    { id, hex, cluster }: { id: string; hex: string; cluster: number },
  ) => ({ id, hex, cluster })),
});
await Deno.mkdir(dirname(rawDir), { recursive: true });
await Deno.mkdir(rawDir);
await Deno.writeTextFile(
  `${rawDir}/ENGINEERING-NOT-STUDY.json`,
  JSON.stringify({ marker, fixtureManifest: manifest }, null, 2) + "\n",
  { createNew: true },
);
const chainDir = `${rawDir}/chain`;
const unit = manifest.units[0],
  base = discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
let latest: LoadedCheckpoint | null = null;
const writeStarted = performance.now();
for (const step of CHECKPOINT_STEPS) {
  // Deliberately unchanged material at artificial timestamps: filesystem fixture only.
  const state = { ...base, step };
  latest = await writeCheckpoint(
    chainDir,
    manifest,
    unit,
    state,
    [],
    [],
    latest,
  );
}
const fixtureWriteSeconds = (performance.now() - writeStarted) / 1000;
const fullStarted = performance.now(),
  full = await loadCheckpointChain(chainDir, manifest, unit);
const fullValidationSeconds = (performance.now() - fullStarted) / 1000;
if (!full || full.receiptSha256 !== latest!.receiptSha256) {
  throw Error("Fixture full validation mismatch");
}
await writeVerifiedChainCache(chainDir, manifest, unit, full);
const cachedSeconds: number[] = [];
for (let i = 0; i < 3; i++) {
  const start = performance.now(),
    cached = await loadVerifiedChainCache(chainDir, manifest, unit);
  cachedSeconds.push((performance.now() - start) / 1000);
  if (
    !cached || cached.receiptSha256 !== full.receiptSha256 ||
    JSON.stringify(cached.samples) !== JSON.stringify(full.samples)
  ) throw Error("Fixture cached validation mismatch");
}
let bytes = 0;
for await (const entry of Deno.readDir(chainDir)) {
  if (entry.isFile) {
    bytes += (await Deno.stat(`${chainDir}/${entry.name}`)).size;
  }
}
for (const [path, hash] of Object.entries(sourceHashes)) {
  if (sha256(await Deno.readFile(path)) !== hash) {
    throw Error("Benchmark source drift");
  }
}
const report = {
  format: "discovery-resume-benchmark/v1",
  marker,
  rawDir,
  chainDir,
  inputSha256: sha256(inputBytes),
  sourceHashes,
  unitId: unit.id,
  checkpoints: 11,
  bytes,
  fixtureWriteSeconds,
  fullValidationSeconds,
  cachedSeconds,
  maxObservedLinear64HistorySeconds: 64 * Math.max(...cachedSeconds),
  paidUSD: 0,
  limitations:
    "Single founder, no mutation edges, warm local filesystem. Artificial timestamps do not establish evolution. Linear extrapolation excludes growing ancestry metadata, file-cache eviction and process startup; resource release needs headroom.",
};
await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
  createNew: true,
});
console.log(JSON.stringify(report));
