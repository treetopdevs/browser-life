/** Opt-in exact original stream-format prefix control; no selected links. */
import { createHash } from "node:crypto";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { ResetProbeAObserver } from "../lib/reset-probe-a-observer.ts";
import { resetGpuWorkerPid } from "../lib/reset-probe-a-guard.ts";

const root = "/Users/nicholas/develop/browser-life-foundations";
const dir = "/Users/nicholas/develop/browser-life/runs/replay-m4/gradient-m3/treatment/seed-1";
const path = (name: string) => `${dir}/${name}`;
const identity = async (name: string) => {
  const bytes = await Deno.readFile(path(name));
  return { path: path(name), bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
};
async function originalPrefix(name: string, limit: number): Promise<string> {
  const file = await Deno.open(path(name));
  const decoder = new TextDecoder(); let pending = "", output = "";
  try {
    for await (const chunk of file.readable) {
      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (name === "mutations.tsv" && line.startsWith("childHi\t")) {
          output += line + "\n"; continue;
        }
        const step = name === "life.jsonl" ? JSON.parse(line).step : Number(line.split("\t", 1)[0]);
        if (step > limit) return output;
        output += line + "\n";
      }
    }
    return output;
  } finally { try { file.close(); } catch { /* stream may have closed it */ } }
}

const started = performance.now(), startedAt = new Date().toISOString();
await Deno.mkdir(`${root}/runs/foundational-reset`, { recursive: true });
const output = `${root}/runs/foundational-reset/gpu-stream-prefix-${Date.now()}.json`;
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const receipt: Record<string, unknown> = { status: "started-development-stream-prefix",
  startedAt, maxSeconds: 60, steps: 1000,
  sourceFiles: await Promise.all(["manifest.json", "mutations.tsv", "life.jsonl",
    "lineages.tsv"].map(identity)),
  scope: "original seed-1 prefix serializer/parity only; no selected Test 1 links" };
const pinnedPath = `${root}/runs/foundational-reset/inputs-v2.json`;
const pinnedBytes = await Deno.readFile(pinnedPath);
const pinned = JSON.parse(new TextDecoder().decode(pinnedBytes)) as {
  files: { path: string; bytes: number; sha256: string }[] };
receipt.pinnedInputs = { path: pinnedPath, bytes: pinnedBytes.length,
  sha256: createHash("sha256").update(pinnedBytes).digest("hex") };
const assertPinnedSources = (files: { path: string; bytes: number; sha256: string }[]) => {
  for (const file of files) {
    const expected = pinned.files.find(x => x.path === file.path);
    if (!expected || expected.bytes !== file.bytes || expected.sha256 !== file.sha256)
      throw new Error(`stream prefix source differs from pinned input: ${file.path}`);
  }
};
assertPinnedSources(receipt.sourceFiles as { path: string; bytes: number; sha256: string }[]);
const save = () => Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n");
await save();
const checkHostGpu = async () => {
  const ps = await new Deno.Command("ps", { args: ["-axo", "pid=,command="],
    stdout: "piped", stderr: "piped" }).output();
  if (ps.code !== 0) throw new Error("cannot authenticate host GPU occupancy");
  const worker = resetGpuWorkerPid(new TextDecoder().decode(ps.stdout), Deno.pid);
  if (worker !== null) throw new Error(`another known GPU worker is active (pid ${worker})`);
};
let sim: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
try {
  await checkHostGpu();
  const source = JSON.parse(await Deno.readTextFile(path("manifest.json")));
  const fresh = ResetProbeAObserver.fromFresh(source.spec, source.initHash);
  const device = await requestDevice(navigator.gpu, fresh.state.cfg);
  receipt.adapter = device.adapterInfo.description;
  sim = await GpuSim.create(device, fresh.state);
  audit = await ResetGpuCopyAudit.create(sim, fresh.state);
  let mutation = "childHi\tchildLo\tparentHi\tparentLo\n";
  let life = "", lineage = "step\tlineage\tcells\n";
  for (let i = 0; i < 10; i++) {
    if (performance.now() - started > 60000)
      throw new Error("stream prefix control exceeded 60s cap");
    await checkHostGpu();
    audit.run(100);
    const [frame, ledger, copied] = await Promise.all([
      sim.readSnapshot(), sim.drainLedger(), audit.readSnapshot()]);
    if (ledger.dropped || copied.step !== frame.step)
      throw new Error("stream prefix lost passive/physical alignment or mutation event");
    for (const e of ledger.events)
      mutation += `${e.childHi}\t${e.childLo}\t${e.parentHi}\t${e.parentLo}\n`;
    const observed = fresh.adapter.observeNext(frame, ledger.events.length);
    for (const e of observed.life) life += JSON.stringify(e) + "\n";
    for (const l of observed.census.lineages)
      lineage += `${frame.step}\t${l.key}\t${l.cells}\n`;
    audit.rebaseFromCurrentGpu(frame.step);
  }
  const replay = { "mutations.tsv": mutation, "life.jsonl": life,
    "lineages.tsv": lineage };
  const comparison: Record<string, unknown> = {};
  for (const name of Object.keys(replay) as (keyof typeof replay)[]) {
    const expected = await originalPrefix(name, 1000);
    if (expected !== replay[name]) {
      let at = 0;
      while (at < expected.length && at < replay[name].length &&
          expected[at] === replay[name][at]) at++;
      throw new Error(`${name} differs from original source at byte ${at}`);
    }
    comparison[name] = { bytes: expected.length,
      originalPrefixSha256: createHash("sha256").update(expected).digest("hex"),
      replayPrefixSha256: createHash("sha256").update(replay[name]).digest("hex") };
  }
  receipt.status = "passed-development-stream-prefix";
  receipt.comparison = comparison;
  receipt.sourceAfter = await Promise.all(["manifest.json", "mutations.tsv",
    "life.jsonl", "lineages.tsv"].map(identity));
  assertPinnedSources(receipt.sourceAfter as { path: string; bytes: number; sha256: string }[]);
  if (JSON.stringify(receipt.sourceAfter) !== JSON.stringify(receipt.sourceFiles))
    throw new Error("stream prefix source changed");
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  receipt.overrun = Number(receipt.totalElapsedMs) > 60000;
  if (receipt.overrun) throw new Error("stream prefix control exceeded 60s cap");
  await save(); console.log(output);
} catch (error) {
  receipt.status = "failed-development-stream-prefix";
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.finishedAt = new Date().toISOString();
  receipt.totalElapsedMs = performance.now() - started;
  await save(); throw error;
} finally { audit?.destroy(); sim?.destroy(); }
