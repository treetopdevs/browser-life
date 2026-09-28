/** Read-only historical Probe A input validation. No simulator or GPU acquisition. */
import { createHash } from "node:crypto";
import { artifactDigest, stateHash } from "@bl/schema";
import { decodeArtifact, continuationError } from "@bl/runner";

const root = "/Users/nicholas/develop/browser-life-foundations";
const main = "/Users/nicholas/develop/browser-life";
const indexPath = `${root}/runs/foundational-reset/inputs-v2.json`;
const output = `${root}/runs/foundational-reset/input-preflight-v3.json`;
const index = JSON.parse(await Deno.readTextFile(indexPath));
const began = performance.now();
const result: Record<string, unknown> = { format: 1, status: "pending", indexPath,
  indexSha256: createHash("sha256").update(await Deno.readFile(indexPath)).digest("hex"),
  startedAt: new Date().toISOString(), sourceReconciliation: [], checkpoints: [], links: [],
  claim: "Input integrity, checkpoint identity and sampled-row reconciliation only; no replay or ancestry result." };
const reserved = await Deno.open(output, { createNew: true, write: true });
reserved.close();
async function* lines(path: string): AsyncGenerator<string> {
  const f = await Deno.open(path); let pending = "";
  for await (const chunk of f.readable.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    const parts = pending.split("\n"); pending = parts.pop()!;
    for (const line of parts) yield line;
  }
  if (pending) yield pending;
}
try {
  for (const entry of index.files) {
    const hash = createHash("sha256"); let bytes = 0;
    const f = await Deno.open(entry.path);
    for await (const chunk of f.readable) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== entry.bytes || hash.digest("hex") !== entry.sha256)
      throw new Error(`pinned input drift: ${entry.path}`);
  }
  result.verifiedInputFiles = index.files.length;
  const pairs = JSON.parse(await Deno.readTextFile(`${main}/runs/foundations/results/t1-pairs.json`));
  if (pairs.length !== 200) throw new Error("expected exactly 200 fixed links");
  const unique = new Set<string>();
  for (let h = 1; h <= 10; h++) {
    const dir = `${main}/runs/replay-m4/gradient-m3/treatment/seed-${h}`;
    const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    const selected = pairs.filter((p: { h: number }) => p.h === h);
    if (selected.length !== 20 || manifest.spec.seed !== h || !manifest.summary.conservationOk)
      throw new Error(`invalid history ${h}`);
    for (const cp of manifest.checkpoints) {
      const decoded = decodeArtifact(await Deno.readFile(`${dir}/${cp.file}`));
      const digest = artifactDigest(decoded.state, decoded.observer);
      const error = continuationError(manifest.spec, decoded.state, decoded.observer);
      if (decoded.state.step !== cp.step || stateHash(decoded.state) !== cp.hash || error)
        throw new Error(`checkpoint ${h}/${cp.step}: ${error ?? "identity mismatch"}`);
      (result.checkpoints as unknown[]).push({ h, step: cp.step, artifactHash: digest,
        physicsHash: stateHash(decoded.state), mutRate: decoded.state.cfg.mutRate,
        manifestHashKind: "physics", continuationCompatible: true });
    }
    const found = new Map<string, Record<string, string>>();
    let header: string[] | undefined;
    const wanted = new Set(selected.map((p: { step: number; kind: string; parent: number; child: number }) =>
      `${p.step}/${p.kind}/${p.parent}/${p.child}`));
    for await (const line of lines(`${dir}/births.tsv`)) {
      if (!header) { header = line.split("\t"); continue; }
      if (!line) continue;
      const row = Object.fromEntries(line.split("\t").map((v, i) => [header![i], v]));
      const key = `${row.step}/${row.kind}/${row.parent}/${row.child}`;
      if (wanted.has(key)) {
        if (found.has(key)) throw new Error(`duplicate birth row ${h}/${key}`);
        found.set(key, row);
      }
    }
    for (const p of selected) {
      const key = `${p.step}/${p.kind}/${p.parent}/${p.child}`, fullKey = `${h}/${key}`;
      if (unique.has(fullKey)) throw new Error(`duplicate selected link ${fullKey}`);
      unique.add(fullKey);
      const row = found.get(key);
      if (!row || row.parentLineage !== p.parentLineage || row.childLineage !== p.childLineage ||
          Number(row.parentPurity) !== p.parentPurity || Number(row.childPurity) !== p.childPurity)
        throw new Error(`selected link disagrees with birth output ${fullKey}`);
      (result.links as unknown[]).push({ ...p, originalRowMatched: true,
        checkpointBeforeStep: Math.floor((p.step - 1) / 100000) * 100000,
        beforeCheckpointProvenance: "unknown" });
    }
    (result.sourceReconciliation as unknown[]).push({ h, links: selected.length,
      ruleVersion: manifest.ruleVersion, schemaVersion: manifest.schemaVersion,
      metricsVersion: manifest.metricsVersion, checkpointCount: manifest.checkpoints.length,
      mutationRetained: manifest.cfg.mutRate > 0 });
  }
  result.status = "complete";
} catch (error) {
  result.status = "failed"; result.error = String(error);
  throw error;
} finally {
  result.wallSeconds = (performance.now() - began) / 1000;
  await Deno.writeTextFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, output,
    checkpoints: (result.checkpoints as unknown[]).length, links: (result.links as unknown[]).length,
    wallSeconds: result.wallSeconds, error: result.error }));
}
