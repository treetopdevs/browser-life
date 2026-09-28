// Read-only event-graph audit of complete saved run bundles. Writes a new report.
// deno run --allow-read --allow-write tools/foundation-life.ts --out <new.json> <bundle>...
import { createHash } from "node:crypto";
import { FoundationLifeAudit } from "./lib/foundation-life.ts";

async function* rows(path: string, hash: ReturnType<typeof createHash>) {
  const file = await Deno.open(path, { read: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  try {
    for await (const bytes of file.readable) {
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      let at: number;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (line.trim()) yield JSON.parse(line);
      }
      if (pending.length > 10_000_000) throw new Error("unexpectedly long JSONL record");
    }
    pending += decoder.decode();
    if (pending.trim()) yield JSON.parse(pending);
  } finally { try { file.close(); } catch { /* readable closes at EOF */ } }
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function auditBundle(path: string) {
  const manifestBytes = await Deno.readFile(`${path}/manifest.json`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const { spec, summary } = manifest;
  if (!spec || !summary || manifest.startStep !== 0 || spec.metapopulation || summary.steps !== spec.steps || summary.conservationOk !== true) throw new Error("requires a completed, conserved, standalone source run");
  const audit = new FoundationLifeAudit(spec.steps, spec.censusEvery);
  const seriesHash = createHash("sha256"), lifeHash = createHash("sha256");
  let n = 0;
  let finalIndividuals = -1;
  const censusCounts: { step: number; individuals: number }[] = [];
  for await (const row of rows(`${path}/series.jsonl`, seriesHash)) {
    n++;
    if (row.step !== Math.min(n * spec.censusEvery, spec.steps) || n > Math.ceil(spec.steps / spec.censusEvery)) throw new Error("series is incomplete or out of census order");
    if (!Number.isSafeInteger(row.individuals) || row.individuals < 0) throw new Error("series lacks individual counts");
    if (row.conservationOk !== true) throw new Error("series contains a conservation failure");
    if (n === 1) audit.seedInitialIndividuals(row.individuals);
    censusCounts.push({ step: row.step, individuals: row.individuals });
    finalIndividuals = row.individuals;
  }
  if (n !== Math.ceil(spec.steps / spec.censusEvery)) throw new Error("series is truncated");
  const events = rows(`${path}/life.jsonl`, lifeHash)[Symbol.asyncIterator]();
  let next = await events.next();
  for (const census of censusCounts.slice(1)) {
    while (!next.done && next.value.step <= census.step) {
      audit.push(next.value);
      next = await events.next();
    }
    audit.reconcileCensus(census.step, census.individuals);
  }
  if (!next.done) throw new Error("life event after final series census");
  const result = audit.finish();
  for (const [event, key] of [["fission", "fissions"], ["fusion", "fusions"], ["budding", "buddings"]] as const) {
    if (result.counts[event] !== summary[key]) throw new Error(`life count ${event} disagrees with manifest`);
  }
  if (result.finalTrackedIndividuals !== summary.finalIndividuals || finalIndividuals !== summary.finalIndividuals) throw new Error("final identity count disagrees with source summary");
  return {
    status: "audited" as const, path, runId: manifest.runId, spec,
    versions: { schema: manifest.schemaVersion, rule: manifest.ruleVersion, metrics: manifest.metricsVersion },
    sourceDigests: { manifest: sha(manifestBytes), series: seriesHash.digest("hex"), life: lifeHash.digest("hex") },
    verification: "internal saved-log consistency; no physics replay", seriesRows: n, result,
  };
}

if (Deno.args[0] !== "--out" || !Deno.args[1] || Deno.args.length < 3) throw new Error("usage: --out <new.json> <bundle>...");
const output = Deno.args[1], sources = Deno.args.slice(2);
if (new Set(sources).size !== sources.length) throw new Error("duplicate source paths");
const initial = {
  format: "foundation-life-audit-v1", createdAt: new Date().toISOString(), status: "running",
  sourceSelection: "explicit input paths; observational feasibility, not fresh confirmation",
  code: await Promise.all(["tools/foundation-life.ts", "tools/lib/foundation-life.ts"].map(async (path) => ({ path, sha256: sha(await Deno.readFile(new URL(`../${path}`, import.meta.url))) }))),
  sources,
};
await Deno.writeTextFile(output, JSON.stringify(initial, null, 2) + "\n", { createNew: true });
const results: unknown[] = [];
for (const path of sources) {
  try {
    const result = await auditBundle(path);
    results.push(result);
    console.log(`${result.runId}: ${result.result.threeIdentityFissionChains} linked event chains; ${result.seriesRows} censuses checked`);
  } catch (error) {
    results.push({ path, status: "unavailable", error: String(error) });
    console.error(`${path}: ${error}`);
  }
  await Deno.writeTextFile(output, JSON.stringify({ ...initial, results }, null, 2) + "\n");
}
const unavailable = results.filter((r) => (r as { status: string }).status === "unavailable").length;
await Deno.writeTextFile(output, JSON.stringify({ ...initial, status: "completed", independentSources: sources.length, audited: sources.length - unavailable, unavailable, results }, null, 2) + "\n");
if (unavailable) Deno.exitCode = 1;
