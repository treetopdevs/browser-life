// Engineering check (not study evidence): replay ONE existing frozen competition on this
// machine's GPU through the frozen executeAssay, to confirm reproduction and measure time
// for the divergence-control cost forecast. Produces no new biological observation.
// Usage: deno run --no-lock -A experiments/founder-discovery/v1/divergence-control/engineering-check.ts NEW_OUT.json
import { resolve } from "node:path";
import { sha256 } from "../../../../tools/lib/founder-policy.ts";
import {
  type AssayResult,
  validateAssayResult,
  validateManifest,
  writeNew,
} from "../../../../tools/lib/discovery-improvement-runtime.ts";
import { discoveryCompetitionConfig } from "../../../../tools/lib/discovery-competition.ts";
import {
  buildRoster,
  type ImprovementReport,
} from "../../../../tools/lib/discovery-divergence-control.ts";
import { REPORT_SHA256 } from "../../../../tools/discovery_divergence_control.ts";
import { adapterText } from "../../../../tools/discovery_improvement_shard.ts";

const STUDY = "experiments/founder-discovery/v1/improvement-study";
const [outPath] = Deno.args;
if (!outPath) throw Error("usage: engineering-check.ts NEW_OUT.json");
const manifest = validateManifest(JSON.parse(await Deno.readTextFile(`${STUDY}/manifest.json`)));
const reportBytes = await Deno.readFile(`${STUDY}/distribution-v1/analysis-v1/report.json`);
if (sha256(reportBytes) !== REPORT_SHA256) throw Error("report hash drift");
const roster = buildRoster(
  JSON.parse(new TextDecoder().decode(reportBytes)) as ImprovementReport,
  REPORT_SHA256,
  manifest,
);
const key = roster.replay[0].cacheKey;
const rawPath = `runs/founder-discovery-improvement-consolidated-v1/assays/${key}.json`;
const raw = await Deno.readFile(rawPath);
const expected = JSON.parse(new TextDecoder().decode(raw)) as AssayResult;
const request = {
  cacheKey: key,
  descendantHex: expected.descendantHex,
  founderHex: expected.founderHex,
  seed: expected.seed,
  assignment: expected.assignment,
};
validateAssayResult(expected, key, request.descendantHex, request.founderHex, request.seed, request.assignment, manifest.sourceManifestHash);

const source = await Deno.readTextFile("tools/discovery_improvement.ts");
if (sha256(new TextEncoder().encode(source)) !== manifest.sources["tools/discovery_improvement.ts"]) {
  throw Error("frozen runner source drift");
}
const adapterPath = resolve("tools/discovery_improvement_adapter.generated.ts");
if (await Deno.readTextFile(adapterPath) !== adapterText(source)) throw Error("generated adapter drift");
const helper = await import(new URL(`file://${adapterPath}`).href);

const t0 = performance.now();
const device = await (await import("@bl/sim-gpu")).requestDevice(
  navigator.gpu,
  discoveryCompetitionConfig(request.seed),
);
const t1 = performance.now();
let result: AssayResult;
try {
  result = await helper.executeAssay(device, manifest, request);
} finally {
  device.destroy();
}
const t2 = performance.now();
validateAssayResult(result, key, request.descendantHex, request.founderHex, request.seed, request.assignment, manifest.sourceManifestHash);
const same = JSON.stringify({ ...result, elapsedSeconds: 0 }) === JSON.stringify({ ...expected, elapsedSeconds: 0 });
const record = {
  format: "discovery-divergence-control-engineering-check/v1",
  purpose: "Reproduction and timing for the cost forecast; not study evidence.",
  cacheKey: key,
  expectedPath: rawPath,
  expectedSha256: sha256(raw),
  reproduced: same,
  differingFields: Object.keys(expected).filter((k) =>
    k !== "elapsedSeconds" &&
    JSON.stringify((expected as unknown as Record<string, unknown>)[k]) !==
      JSON.stringify((result as unknown as Record<string, unknown>)[k])
  ),
  expectedElapsedSeconds: expected.elapsedSeconds,
  measured: {
    deviceInitSeconds: (t1 - t0) / 1000,
    assayElapsedSeconds: result.elapsedSeconds,
    assayWallSeconds: (t2 - t1) / 1000,
  },
  host: { os: Deno.build.os, arch: Deno.build.arch, deno: Deno.version.deno },
  at: new Date().toISOString(),
};
await writeNew(outPath, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
if (!same) Deno.exit(1);
