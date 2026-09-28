// Single-pass source reconstruction with authenticated intermediate checkpoints.
// Build (new output directory only):
//   deno run -A tools/foundation-replay.ts build --source /path/to/seed-1 \
//     --out /path/to/new-cache --source-revision b7fd4c1 --hash-mode artifact \
//     --steps 100000,500000,900000 [--max-seconds 2700]
// Verify (re-hashes source, code and every cache checkpoint):
//   deno run -A tools/foundation-replay.ts verify --source /path/to/seed-1 \
//     --out /path/to/cache --source-revision b7fd4c1 --hash-mode artifact
// No original source file is written. The command never resumes or overwrites a cache.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment } from "@bl/runner";
import {
  OBSERVATION_FILES, buildReplayCache, parseMaxSeconds, replayBoundaries, sha256, sourceIdentity, verifyReplayCache,
  type FileDigest, type FinalHashMode, type ReplayStore, type SourceManifest,
} from "./lib/foundation-replay.ts";

function options(args: string[]): { command: "build" | "verify"; source: string; out: string; sourceRevision: string; hashMode: FinalHashMode; steps: number[]; maxSeconds: number } {
  const [command, ...rest] = args;
  if (command !== "build" && command !== "verify") throw new Error("first argument must be build or verify");
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith("--") || rest[i + 1] === undefined || values.has(rest[i])) throw new Error(`invalid or duplicate option ${rest[i]}`);
    values.set(rest[i], rest[i + 1]);
  }
  for (const name of values.keys()) if (!["--source", "--out", "--source-revision", "--hash-mode", "--steps", "--max-seconds"].includes(name)) throw new Error(`unknown option ${name}`);
  const source = values.get("--source"), out = values.get("--out"), sourceRevision = values.get("--source-revision"), hashMode = values.get("--hash-mode");
  if (!source || !out || !sourceRevision || (hashMode !== "artifact" && hashMode !== "physics"))
    throw new Error("--source, --out, --source-revision and explicit --hash-mode artifact|physics are required");
  const steps = (values.get("--steps") ?? "100000,500000,900000").split(",").map(Number);
  return { command, source, out, sourceRevision, hashMode, steps, maxSeconds: parseMaxSeconds(values.get("--max-seconds")) };
}

async function digestFile(path: string, checkBudget: (stage: string) => void = () => {}): Promise<FileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  const file = await Deno.open(path, { read: true });
  for await (const chunk of file.readable) {
    checkBudget(`hashing ${path}`);
    hash.update(chunk);
    bytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function codeFiles(checkBudget: (stage: string) => void = () => {}): Promise<Record<string, FileDigest>> {
  const names: string[] = ["tools/foundation-replay.ts", "tools/lib/foundation-replay.ts"];
  for (const dir of ["packages/schema/src", "packages/sim-gpu/src", "packages/metrics/src", "packages/runner/src"]) {
    for await (const entry of Deno.readDir(dir)) if (entry.isFile && entry.name.endsWith(".ts")) names.push(`${dir}/${entry.name}`);
  }
  const result: Record<string, FileDigest> = {};
  for (const name of names.sort()) result[name] = await digestFile(name, checkBudget);
  return result;
}

class DirectoryStore implements ReplayStore {
  reserved = false;
  constructor(readonly dir: string) {}
  async reserve(): Promise<void> { await Deno.mkdir(this.dir); this.reserved = true; }
  async write(name: string, bytes: Uint8Array): Promise<void> {
    if (name.startsWith("checkpoints/") || name.startsWith("terminal/"))
      await Deno.mkdir(join(this.dir, name.split("/")[0]), { recursive: true });
    await Deno.writeFile(join(this.dir, name), bytes, { createNew: name !== "manifest.json" });
  }
  read(name: string): Promise<Uint8Array> { return Deno.readFile(join(this.dir, name)); }
}

async function main() {
  const a = options(Deno.args);
  const store = new DirectoryStore(a.out);
  const began = performance.now();
  const startedAt = new Date().toISOString();
  const host = `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`;
  const checkBudget = (stage: string) => {
    const elapsed = (performance.now() - began) / 1000;
    if (elapsed > a.maxSeconds) throw new Error(`replay time cap ${a.maxSeconds}s exceeded at ${stage} after ${elapsed.toFixed(3)}s`);
  };
  try {
    checkBudget("before source validation");
    const manifestBytes = await Deno.readFile(join(a.source, "manifest.json"));
    checkBudget("after source manifest read");
    const sourceManifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SourceManifest;
    const files: Record<string, FileDigest> = { "manifest.json": sha256(manifestBytes) };
    for (const name of OBSERVATION_FILES) files[name] = await digestFile(join(a.source, name), checkBudget);
    const code = await codeFiles(checkBudget);
    checkBudget("before source identity validation");
    const source = sourceIdentity(sourceManifest, files, a.hashMode, a.sourceRevision, code);
    checkBudget("after source identity validation");
    if (a.command === "verify") {
      const cache = await verifyReplayCache(store, source);
      console.log(JSON.stringify({ status: cache.status, source: cache.source.runId, checkpoints: cache.checkpoints.length, observerCompatible: cache.observerCompatible }));
      return;
    }
    replayBoundaries(source.spec, a.steps);
    const runMetadata = { maxSeconds: a.maxSeconds, startedAt, host,
      adapter: null as { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null };
    const gpu: { device?: GPUDevice } = {};
    const sourceStillCurrent = async () => {
      const currentFiles: Record<string, FileDigest> = { "manifest.json": await digestFile(join(a.source, "manifest.json"), checkBudget) };
      for (const name of OBSERVATION_FILES) currentFiles[name] = await digestFile(join(a.source, name), checkBudget);
      const current = sourceIdentity(sourceManifest, currentFiles, a.hashMode, a.sourceRevision, await codeFiles(checkBudget));
      if (JSON.stringify(current) !== JSON.stringify(source)) throw new Error("source bundle or replay code changed during reconstruction");
    };
    let cache;
    try {
      cache = await buildReplayCache(store, source, a.steps, async () => {
        checkBudget("before device request");
        gpu.device = await requestDevice(navigator.gpu, sourceManifest.cfg);
        const info = (gpu.device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
        runMetadata.adapter = info ? { vendor: info.vendor || null, architecture: info.architecture || null,
          device: info.device || null, description: info.description || null } : null;
        checkBudget("after device request");
        return async (spec, sink, start, observer) => runExperiment(
          gpu.device!, spec, sink,
          { host, adapter: info?.description || "unknown" },
          (message) => { checkBudget("runner progress"); console.log(message); },
          { start, observer, keepFinal: true },
        );
      }, sourceStillCurrent, checkBudget, runMetadata);
    } finally {
      gpu.device?.destroy();
    }
    await verifyReplayCache(store, source);
    console.log(JSON.stringify({
      status: cache.status, source: cache.source.runId, checkpoints: cache.checkpoints.length,
      checkpointBytes: cache.checkpoints.map((p) => p.fileDigest.bytes), terminalBytes: cache.final?.fileDigest.bytes,
      final: cache.final, observerCompatible: cache.observerCompatible, timing: cache.timing,
      observationMatches: Object.fromEntries(OBSERVATION_FILES.map((name) => [name, cache.observationComparison?.[name].matched])),
    }));
  } catch (error) {
    if (a.command === "build" && !store.reserved) {
      try {
        await store.reserve();
        await store.write("failure.json", new TextEncoder().encode(JSON.stringify({
          status: "failed", startedAt, maxSeconds: a.maxSeconds,
          failure: error instanceof Error ? error.message : String(error),
        }, null, 2)));
      } catch { /* Existing output stays untouched; retain the original failure. */ }
    }
    throw error;
  }
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exitCode = 1;
});
