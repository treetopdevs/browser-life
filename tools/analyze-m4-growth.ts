// deno run -A tools/analyze-m4-growth.ts --root <preset bundles> --manifest <json with seeds> --out <new json>
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { loadRunsUnder } from "./lib/bundle.ts";
import { analyzeGrowthRuns } from "./lib/m4-growth-runs.ts";
const a = parseArgs(Deno.args, { string: ["root", "manifest", "out"] });
if (!a.root || !a.manifest || !a.out) throw new Error("--root, --manifest and --out required");
const manifest = JSON.parse(await Deno.readTextFile(a.manifest));
if (!Array.isArray(manifest.seeds)) throw new Error("manifest.seeds required");
const report = await analyzeGrowthRuns(await loadRunsUnder(a.root), manifest.seeds, { kind: "real" });
await Deno.writeTextFile(a.out, JSON.stringify(report, null, 2) + "\n", { createNew: true });
console.log(JSON.stringify({ preset: report.presetId, endpoint2: report.endpoint2, m4: report.m4 }));
