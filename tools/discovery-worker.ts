// Command-line worker of the discovery plane (PLAN Stage 3b; DESIGN section 6).
//
//   deno run -A tools/discovery-worker.ts --coordinator URL --host <physical-host-id> [--label NAME]
//       [--token JOIN_TOKEN] [--concurrency N] [--max-minutes 60] [--max-cases K] [--idle-exit SECONDS]
//
// One command, no per-case setup: it joins with the research join token
// (or BL_DISCOVERY_JOIN_TOKEN), qualifies on the campaign's reference case,
// then leases, runs, self-checks and uploads cases on the CPU reference until
// --max-minutes. No GPU is requested. --host is the operator-assigned
// physical machine ID; two processes on one machine must use the same one.
// Ctrl-C once drains (finishes the running case, takes no new one); twice
// abandons the running case, whose lease then expires and is reassigned.
//
// --fault is for the plane's failure tests only (tests/deno/discovery_plane.ts):
//   exit-after-lease | corrupt-upload | wrong-observer | late-upload | complete-twice

import { resolve } from "node:path";
import { decodeCheckpoint, encodeCheckpoint, sha256Hex, type CaseSpec, type ResultManifest } from "@bl/schema";
import { CPU_BACKEND, type CaseFiles } from "../packages/runner/src/discovery.ts";
import { DiscoveryClient, workLoop, type DiscoveryTask, type WorkerState } from "../packages/runner/src/discovery-transport.ts";
import { closureDigest } from "./lib/discovery-closure.ts";

const REPO = resolve(new URL("..", import.meta.url).pathname);

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i].replace(/^--/, "");
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = "true";
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

const f = flags(Deno.args);
if (!f.coordinator || !f.host) {
  console.error("usage: tools/discovery-worker.ts --coordinator URL --host <physical-host-id> [--label NAME] [--token T] [--concurrency N] [--max-minutes M] [--max-cases K]");
  Deno.exit(2);
}
function operand(name: string, dflt: number, whole: boolean): number {
  const raw = f[name];
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (raw === "true" || raw === "" || !Number.isFinite(n) || n <= 0) {
    console.error(`--${name} needs a positive number, got ${raw === "true" ? "nothing" : JSON.stringify(raw)}`);
    Deno.exit(2);
  }
  return whole ? Math.max(1, Math.floor(n)) : n;
}
const concurrency = operand("concurrency", 1, true);
const maxMinutes = operand("max-minutes", 60, false);
const fault = f.fault ?? "";
const closure = closureDigest(REPO).digest;
const client = new DiscoveryClient(f.coordinator.replace(/\/$/, ""), f.token ?? Deno.env.get("BL_DISCOVERY_JOIN_TOKEN") ?? null);
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${f.host} ${line}`);

let draining = false;
let sigints = 0;
Deno.addSignalListener("SIGINT", () => {
  sigints++;
  if (sigints === 1) {
    draining = true;
    log("pausing: finishing the running case, taking no new one (Ctrl-C again to abandon it)");
  } else {
    log("abandoning the running case; its lease will expire and another worker repeats it");
    Deno.exit(130);
  }
});

function execute(spec: CaseSpec, initial: Uint8Array, opts: Record<string, unknown>, timeoutMs: number): Promise<{ result: ResultManifest; files: CaseFiles }> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL("./discovery-case-worker.ts", import.meta.url).href, { type: "module" });
    const timer = setTimeout(() => {
      w.terminate();
      rej(new Error(`case exceeded its wall-time limit (${timeoutMs / 1000} s)`));
    }, timeoutMs);
    w.onmessage = (ev) => {
      clearTimeout(timer);
      w.terminate();
      const d = ev.data as { ok: boolean; error?: string; result?: ResultManifest; files?: CaseFiles };
      d.ok ? res({ result: d.result!, files: d.files! }) : rej(new Error(d.error));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      e.preventDefault();
      rej(new Error(e.message));
    };
    w.postMessage({ spec, initial, opts });
  });
}

async function reseal(r: ResultManifest, files: CaseFiles): Promise<ResultManifest> {
  const out = structuredClone(r);
  for (const k of Object.keys(files) as (keyof CaseFiles)[]) {
    out.execution.files[k] = await sha256Hex(files[k]);
    out.execution.artifactSizes[k] = files[k].byteLength;
  }
  out.canonical.endArtifactDigest = out.execution.files["end.blck"];
  out.canonical.canonicalObservationDigests.observations = out.execution.files["observations.jsonl"];
  out.canonical.readoutDigest = out.execution.files["readout.json"];
  return out;
}

let faulted = false;
let partitioned = false;
async function faultHook(stage: "leased" | "files" | "completed", t: DiscoveryTask, out?: { result: ResultManifest; files: CaseFiles }) {
  if (!fault || faulted || t.role === "qualify") return;
  if (stage === "leased" && fault === "exit-after-lease") {
    log(`fault: exiting while holding lease ${t.leaseId} (${t.attemptId})`);
    Deno.exit(3);
  }
  if (stage === "files" && out) {
    if (fault === "corrupt-upload") {
      faulted = true;
      const obs = out.files["observations.jsonl"].slice();
      obs[30] ^= 0x01;
      log(`fault: corrupting observations.jsonl of ${t.attemptId}`);
      return { result: out.result, files: { ...out.files, "observations.jsonl": obs } };
    }
    if (fault === "wrong-observer") {
      faulted = true;
      const { state, observer } = decodeCheckpoint(out.files["end.blck"]);
      (observer as { exactLedger: { version: string } }).exactLedger.version = "exact-ledger-v0";
      const files = { ...out.files, "end.blck": encodeCheckpoint(state, observer) };
      log(`fault: wrong observer version in ${t.attemptId}, digests resealed`);
      return { result: await reseal(out.result, files), files };
    }
    if (fault === "late-upload") {
      faulted = true;
      const wait = t.leaseMs * 2;
      log(`fault: partitioned for ${wait} ms (no heartbeats) before uploading ${t.attemptId}`);
      partitioned = true;
      await new Promise((r) => setTimeout(r, wait));
      partitioned = false;
      return;
    }
  }
  if (stage === "completed" && fault === "complete-twice") {
    faulted = true;
    const again = await client.complete(t.leaseId);
    log(`fault: completed ${t.attemptId} a second time -> ${again.status}, case ${again.decision}`);
  }
}

log(`joining ${f.coordinator} as ${f.label ?? f.host} (closure ${closure.slice(0, 12)}, backend ${CPU_BACKEND}, ${concurrency} slot(s), ${maxMinutes} min)`);
await client.retrying(() => client.join({
  label: f.label ?? f.host,
  physicalHostId: f.host,
  backend: CPU_BACKEND,
  sourceClosureDigest: closure,
  runtime: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`,
  concurrency,
  environment: f.cloud ? "cloud" : "local",
}), (e, n) => log(`retrying join (${n}): ${e.message}`));
log(`joined as ${client.workerId}`);
let state: WorkerState = "joining";
const until = Date.now() + maxMinutes * 60_000;
const results = await Promise.all(
  Array.from({ length: concurrency }, () =>
    workLoop(client, {
      info: { label: f.label ?? f.host, physicalHostId: f.host, backend: CPU_BACKEND, sourceClosureDigest: closure, runtime: "", concurrency, environment: "local" },
      execute,
      backendBuild: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch} ${CPU_BACKEND}`,
      until,
      maxCases: f["max-cases"] ? +f["max-cases"] : undefined,
      idleExitMs: f["idle-exit"] ? +f["idle-exit"] * 1000 : undefined,
      log,
      onState: (s) => {
        if (s !== state && (s === "draining" || s === "stopped")) log(`state ${s}`);
        state = s;
      },
      draining: () => draining,
      heartbeatsPaused: () => partitioned,
      fault: faultHook,
    }),
  ),
);
const done = results.reduce((a, r) => a + r.completed, 0);
log(`finished: ${done} case(s) completed`);
Deno.exit(0);
