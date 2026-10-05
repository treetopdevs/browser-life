// The browser route of the discovery plane (PLAN Stage 3b): one page, one
// click. Served by the coordinator itself (same origin, /discovery/), it joins
// with the research join token and an operator-assigned physical host ID,
// qualifies, and runs cases on the CPU in Web Workers through the same
// transport as tools/discovery-worker.ts.
import type { CaseSpec, ResultManifest } from "@bl/schema";
import { CPU_BACKEND, type CaseFiles } from "../../../packages/runner/src/discovery.ts";
import { DiscoveryClient, workLoop, type WorkerState } from "../../../packages/runner/src/discovery-transport.ts";

declare const __BL_DISCOVERY_CLOSURE__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`bl-discovery-${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`bl-discovery-${k}`, v);
    } catch {
      // storage unavailable: the fields simply are not remembered
    }
  },
};

// Always the page's own origin: no link parameter may redirect the join token or worker credentials elsewhere.
const coordinator = location.origin;
const host = $<HTMLInputElement>("host");
const token = $<HTMLInputElement>("token");
const threads = $<HTMLInputElement>("threads");
const minutes = $<HTMLInputElement>("minutes");
const maxThreads = Math.max(1, navigator.hardwareConcurrency || 1);
threads.max = String(maxThreads);
host.value = params.get("host") ?? store.get("host") ?? "";
// The join token travels only in the URL fragment (#token=…), which is never sent to a server or logged,
// and is removed from the address bar at once; it is kept for this tab's session only.
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has("token")) history.replaceState(null, "", location.pathname + location.search);
const session = {
  get: () => {
    try {
      return sessionStorage.getItem("bl-discovery-token");
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      sessionStorage.setItem("bl-discovery-token", v);
    } catch {
      // not remembered
    }
  },
};
token.value = fragment.get("token") ?? session.get() ?? "";
if (params.get("threads")) threads.value = params.get("threads")!;
if (params.get("minutes")) minutes.value = params.get("minutes")!;
$("coord").textContent = coordinator;
$("closure").textContent = __BL_DISCOVERY_CLOSURE__;

const allowance = () => {
  const n = Math.min(maxThreads, Math.max(1, +threads.value || 1));
  $("allowance").textContent = `Requested compute allowance: up to ${n} CPU thread${n > 1 ? "s" : ""} for ${Math.max(1, +minutes.value || 60)} minutes, on cases of about a few seconds each. CPU only: no GPU is requested. Pause finishes the running case and takes no new one; closing the tab abandons it, and another worker repeats it.`;
};
threads.oninput = allowance;
minutes.oninput = allowance;
allowance();

const logEl = $("log");
const log = (line: string) => {
  logEl.textContent = `${new Date().toLocaleTimeString()} ${line}\n${logEl.textContent ?? ""}`.slice(0, 20_000);
};

if (!globalThis.crypto?.subtle) log("this page is not a secure context; hashing falls back to the built-in SHA-256");

function execute(spec: CaseSpec, initial: Uint8Array, opts: Record<string, unknown>, timeoutMs: number): Promise<{ result: ResultManifest; files: CaseFiles }> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL("./discovery-case.worker.ts", import.meta.url), { type: "module" });
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
      rej(new Error(e.message));
    };
    workers.add(w);
    w.postMessage({ spec, initial, opts });
  });
}

const workers = new Set<Worker>();
let draining = false;
let done = 0;

$("start").onclick = async () => {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(host.value)) {
    log("enter this machine's physical host ID (lowercase letters, digits and dashes); every browser or process on one machine uses the same one");
    return;
  }
  store.set("host", host.value);
  session.set(token.value);
  $<HTMLButtonElement>("start").disabled = true;
  $<HTMLButtonElement>("pause").disabled = false;
  $<HTMLButtonElement>("stop").disabled = false;
  const n = Math.min(maxThreads, Math.max(1, +threads.value || 1));
  const info = {
    label: `${host.value}-browser`,
    physicalHostId: host.value,
    backend: CPU_BACKEND,
    sourceClosureDigest: __BL_DISCOVERY_CLOSURE__,
    runtime: navigator.userAgent.slice(0, 180),
    concurrency: n,
    environment: "local" as const,
  };
  const client = new DiscoveryClient(coordinator, token.value || null);
  try {
    $("state").textContent = "joining";
    await client.join(info);
    log(`joined as ${client.workerId}`);
  } catch (e) {
    log(`could not join: ${(e as Error).message}`);
    $("state").textContent = "not joined";
    $<HTMLButtonElement>("start").disabled = false;
    return;
  }
  const until = Date.now() + Math.max(1, +minutes.value || 60) * 60_000;
  const setState = (s: WorkerState) => ($("state").textContent = s);
  await Promise.all(
    Array.from({ length: n }, () =>
      workLoop(client, {
        info,
        execute,
        backendBuild: `browser ${CPU_BACKEND}`,
        until,
        idleExitMs: params.get("idle-exit") ? +params.get("idle-exit")! * 1000 : undefined,
        log: (l) => {
          log(l);
          if (/: valid/.test(l) && !/^qualify/.test(l)) $("done").textContent = String(++done);
        },
        onState: setState,
        draining: () => draining,
      }).catch((e) => log(`worker slot stopped: ${(e as Error).message}`)),
    ),
  );
  $("state").textContent = draining ? "paused" : "finished";
  $<HTMLButtonElement>("pause").disabled = true;
  $<HTMLButtonElement>("stop").disabled = true;
};

$("pause").onclick = () => {
  draining = true;
  $("state").textContent = "draining";
  log("pausing: finishing the running case, taking no new one");
};

$("stop").onclick = () => {
  for (const w of workers) w.terminate();
  log("stopped: running cases abandoned; their leases expire and other workers repeat them");
  location.reload();
};
