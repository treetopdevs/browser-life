import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { assertSafeOutput, loadPinned, reconstruct } from "./lib/selection-funnel-audit.ts";

function arg(name: string): string { const i = Deno.args.indexOf(name); if (i < 0 || !Deno.args[i + 1]) throw Error(`usage: --manifest PATH --out DIR (missing ${name})`); return Deno.args[i + 1]; }
const start = performance.now();
const manifestPath = resolve(arg("--manifest")), out = resolve(arg("--out"));
const { manifest, data } = await loadPinned(manifestPath);
assertSafeOutput(manifestPath, out, manifest);
const result = reconstruct(data);
try { if ((await Array.fromAsync(Deno.readDir(out))).length) throw Error("output directory is nonempty; use a fresh directory to preserve receipts"); }
catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
await Deno.mkdir(out, { recursive: true });
const outputs: Record<string, string> = {};
function csvValue(v: unknown): string { const s = typeof v === "string" ? v : JSON.stringify(v); return `"${s.replaceAll('"', '""')}"`; }
async function put(name: string, content: string) { await Deno.writeTextFile(join(out, name), content); outputs[name] = createHash("sha256").update(content).digest("hex"); }
await put("input-provenance.json", JSON.stringify({ sourceManifestPath: manifestPath, sourceManifestSha256: createHash("sha256").update(await Deno.readFile(manifestPath)).digest("hex"), manifest }, null, 2) + "\n");
await put("observation-ledger.json", JSON.stringify(result.ledger, null, 2) + "\n");
await put("histories.json", JSON.stringify(result.histories, null, 2) + "\n");
await put("seven-summary.json", JSON.stringify(result.summary, null, 2) + "\n");
const fields = ["subject", "label", "counts", "diagnosticCluster", "historicalCluster", "classification", "admission", "confirmationFailures", "retestFailures", "replicationFailures", "founderIndex"] as const;
await put("seven-summary.csv", fields.join(",") + "\n" + result.summary.map((h) => fields.map((f) => csvValue(h[f])).join(",")).join("\n") + "\n");
await put("reconciliation.json", JSON.stringify(result.reconciliation, null, 2) + "\n");
await put("findings.json", JSON.stringify(result.findings, null, 2) + "\n");
const lines = ["# Selection funnel audit", "", `Status: **${result.reconciliation.status}**. Historical rule interpretations are consistent with pinned code, not proof of the historical executable version.`, "", "| Subject | Counts | Historical cluster | Classification | Evidence |", "|---|---:|---:|---|---|"];
for (const h of result.histories) lines.push(`| ${h.label} | ${h.counts} | ${h.historicalCluster ?? "—"} | ${h.classification} | screen ${h.observations.gate.length}, confirm ${h.observations.confirm.length}, retest ${h.observations.retest.length}, replication ${h.observations.replicate.length} |`);
lines.push("", "The seven targets are defined by the later exploratory uniform-garden `counts=true` outcome. The other nine archive subjects are context. No population-wide or causal effect is estimated.", "", "## Reconciliation", "", "```json", JSON.stringify(result.reconciliation, null, 2), "```", "", "## Findings", "", ...result.findings.map((x) => `- ${x.severity}: ${x.code}: ${x.detail}`), "");
await put("audit-report.md", lines.join("\n"));
const receipt = { command: "deno run --allow-read --allow-write tools/selection-funnel-audit.ts --manifest PATH --out DIR", manifestPath, out, elapsedMs: Math.round(performance.now() - start), executionSourceSha256: { "tools/selection-funnel-audit.ts": createHash("sha256").update(await Deno.readFile(import.meta.dirname + "/selection-funnel-audit.ts")).digest("hex"), "tools/lib/selection-funnel-audit.ts": createHash("sha256").update(await Deno.readFile(import.meta.dirname + "/lib/selection-funnel-audit.ts")).digest("hex") }, outputs };
await Deno.writeTextFile(join(out, "run-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ status: result.reconciliation.status, summary: result.summary.length, findings: result.findings, elapsedMs: receipt.elapsedMs }));
if (result.reconciliation.status !== "reconciled") Deno.exitCode = 1;
