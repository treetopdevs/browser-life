/** Independently reconcile the main-session manifest with local hashes and pinned audit inputs. */
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";

const main = "/Users/nicholas/develop/browser-life";
const root = "/Users/nicholas/develop/browser-life-foundations";
const manifestPath = `${main}/experiments/foundations/probe-a-inputs.json`;
const localPath = `${root}/runs/foundational-reset/inputs-v2.json`;
const output = `${root}/runs/foundational-reset/main-manifest-reconciliation-v1.json`;
async function digest(path: string) {
  const h = createHash("sha256"); let bytes = 0;
  const f = await Deno.open(path);
  for await (const chunk of f.readable) { h.update(chunk); bytes += chunk.length; }
  return { sha256: h.digest("hex"), bytes };
}
const manifestIdentity = await digest(manifestPath), localIdentity = await digest(localPath);
const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
const local = JSON.parse(await Deno.readTextFile(localPath));
const localRows = new Map<string, { sha256: string; bytes: number }>(
  local.files.map((r: { path: string; sha256: string; bytes: number }) => [resolve(r.path), r]));
const receipt: Record<string, unknown> = { format: 1, status: "pending", manifestPath,
  manifestIdentity, localPath, localIdentity, comparisons: [], newlyPinnedFiles: [],
  sourceClaim: "Entry-by-entry file authentication; no new simulation or biological inference." };
const reserved = await Deno.open(output, { createNew: true, write: true }); reserved.close();
const began = performance.now();
try {
  const seen = new Set<string>();
  for (const [group, entries] of Object.entries(manifest.groups)) {
    if (!Array.isArray(entries)) throw new Error(`invalid group ${group}`);
    for (const entry of entries) {
      const path = resolve(main, entry.path), rel = relative(main, path);
      if (rel.startsWith("..") || rel === "" || !/^[a-f0-9]{64}$/.test(entry.sha256))
        throw new Error(`invalid manifest path or digest: ${entry.path}`);
      if (seen.has(path)) throw new Error(`duplicate manifest path: ${path}`);
      seen.add(path);
      const actual = await digest(path);
      if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes)
        throw new Error(`main manifest differs from actual bytes: ${path}`);
      const prior = localRows.get(path);
      if (prior && (prior.sha256 !== actual.sha256 || prior.bytes !== actual.bytes))
        throw new Error(`independent inventories disagree: ${path}`);
      (receipt.comparisons as unknown[]).push({ group, path, ...actual,
        matchedMainManifest: true, matchedEarlierLocalInventory: prior ? true : null });
      if (!prior) (receipt.newlyPinnedFiles as unknown[]).push({ path, ...actual });
    }
  }
  const required = local.files.filter((r: { path: string }) =>
    r.path.startsWith(`${main}/runs/replay-m4/gradient-m3/treatment/`) ||
    r.path === `${main}/runs/foundations/results/t1-pairs.json` ||
    r.path === `${main}/runs/foundations/results/validate.json`);
  const missing = required.filter((r: { path: string }) => !seen.has(resolve(r.path)));
  if (missing.length) throw new Error(`independent manifest omits ${missing.length} required local inputs`);
  receipt.requiredOverlap = required.length;
  for (let h = 1; h <= 10; h++) {
    const run = `runs/replay-m4/gradient-m3/treatment/seed-${h}`;
    const actual = JSON.parse(await Deno.readTextFile(`${main}/${run}/manifest.json`));
    const declared = manifest.replaySpecs[run];
    if (!declared || JSON.stringify(declared.spec) !== JSON.stringify(actual.spec) ||
        declared.finalHash !== actual.summary.finalHash || declared.validate !== "accepted" ||
        declared.ruleVersion !== actual.ruleVersion || declared.schemaVersion !== actual.schemaVersion ||
        declared.metricsVersion !== actual.metricsVersion)
      throw new Error(`replay spec mismatch ${run}`);
  }
  if (JSON.stringify(await digest(manifestPath)) !== JSON.stringify(manifestIdentity))
    throw new Error("main manifest changed during reconciliation");
  receipt.status = "complete";
} catch (error) {
  receipt.status = "failed"; receipt.error = String(error); throw error;
} finally {
  receipt.wallSeconds = (performance.now() - began) / 1000;
  await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ status: receipt.status, output,
    entries: (receipt.comparisons as unknown[]).length, overlap: receipt.requiredOverlap,
    wallSeconds: receipt.wallSeconds, error: receipt.error }));
}
