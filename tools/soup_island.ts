// An island for the shared program soup (docs/soup-garden-2026-10-31.md, Part B;
// Coordinator.Soup): joins the coordinator as an ordinary island, then takes soup
// segments from POST /api/soup/next until told to stop.
//
//   deno run -A tools/soup_island.ts --url http://localhost:4000 [--cpu] [--once]
//     [--max-segments n] [--adapter label]
//
// A run task fetches the start snapshot (segment 0 starts from the seed), runs the
// segment's epochs, uploads the end snapshot (PUT /api/soup/segments/:id/snapshot)
// and completes with its SHA-256. A verify task does the same without uploading;
// the coordinator compares the hash with the run's. Runs on WebGPU
// (tools/soup/gpu.ts, byte-identical to the CPU port) when navigator.gpu has an
// adapter, unless --cpu is given.
//
// A 429 is waited out (retryAfterMs, else Retry-After) and retried; a task whose
// lease would end first is given up, as is one whose start snapshot is gone.
//
// --once stops at the first idle answer; otherwise the island waits and asks again
// until the coordinator says every world is finished, or --max-segments tasks are
// done.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION } from "@bl/schema";
import { type Lang, Soup, type SoupParams } from "./soup/bff.ts";
import { GpuSoup, soupDevice } from "./soup/gpu.ts";
import { decodeSnapshot, encodeSnapshot, resumeGpuSoup, resumeSoup, sha256Hex } from "./soup/snapshot.ts";

/** A task from POST /api/soup/next (Coordinator.Soup's `task/3`). */
export interface SoupTask {
  kind: "run" | "verify";
  segment: string;
  lease: string;
  /** When the lease ends (coordinator clock, ms since the epoch). */
  expiresAt: number;
  world: string;
  params: { seed: number; num: number; width: number; height: number; radius: number; mutation: number; lang: Lang };
  startEpoch: number;
  epochs: number;
  endEpoch: number;
  start: string | null;
  startSha: string | null;
}

export interface SoupIslandOptions {
  url: string;
  /** Joins once when absent. */
  identity?: { id: string; token: string };
  adapter?: string;
  /** WebGPU device, or null for the CPU. */
  device?: GPUDevice | null;
  once?: boolean;
  maxSegments?: number;
  /** Wait between idle answers (default: the coordinator's retryAfterMs). */
  idleMs?: number;
  log?: (line: string) => void;
  /** Test hook: replaces a run's end snapshot before upload (a lying island). */
  tamper?: (snapshot: Uint8Array<ArrayBuffer>, task: SoupTask) => Uint8Array<ArrayBuffer>;
}

export interface SoupIslandResult { id: string; runs: number; verifies: number; refused: number }

export const soupParams = (p: SoupTask["params"]): SoupParams => ({
  num: p.num, seed: p.seed, mutation: p.mutation, lang: p.lang,
  ...(p.width ? { grid: { width: p.width, height: p.height, radius: p.radius } } : {}),
});

/** A task that can no longer be finished: its lease ran out, or its start is gone (the chain diverged). */
class TaskGone extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a 429 asks to wait: the body's retryAfterMs, else Retry-After (seconds), else a second. */
async function retryAfterMs(res: Response): Promise<number> {
  const header = Number(res.headers.get("retry-after"));
  const body = await res.json().catch(() => null);
  const ms = typeof body?.retryAfterMs === "number" ? body.retryAfterMs : Number.isFinite(header) && header > 0 ? header * 1000 : 1000;
  return Math.max(100, ms);
}

/**
 * fetch, with a 429 waited out and retried. With a `deadline` (a lease's end, on
 * the coordinator's clock, compared with ours) a wait that would pass it gives
 * the task up (TaskGone) instead.
 */
async function fetchRetrying(url: string, init: RequestInit, log: (s: string) => void, deadline?: number): Promise<Response> {
  for (;;) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const what = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const wait = await retryAfterMs(res);
    if (deadline !== undefined && Date.now() + wait >= deadline) throw new TaskGone(`${what}: rate limited past the lease`);
    log(`${what}: rate limited, retrying in ${wait} ms`);
    await sleep(wait);
  }
}

/** Joins as an island (POST /api/islands, the body packages/runner/src/island.ts sends); a 429 is waited out. */
export async function joinIsland(url: string, adapter = "soup-island", log: (s: string) => void = console.log): Promise<{ id: string; token: string }> {
  const res = await fetchRetrying(`${url}/api/islands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter, userAgent: `deno ${Deno.version.deno}`, metricsVersion: METRICS_VERSION }),
  }, log);
  if (!res.ok) throw new Error(`join: ${res.status} ${await res.text()}`);
  const { id, token } = await res.json();
  return { id, token };
}

/** Runs one task's epochs from its start and returns the encoded end snapshot. */
export async function computeSegment(task: SoupTask, start: Uint8Array | null, device: GPUDevice | null): Promise<Uint8Array<ArrayBuffer>> {
  const params = soupParams(task.params);
  if (start) {
    const d = decodeSnapshot(start);
    if (d.epoch !== task.startEpoch) throw new Error(`start snapshot is at epoch ${d.epoch}, expected ${task.startEpoch}`);
  } else if (task.startEpoch !== 0) throw new Error("only segment 0 starts from the seed");
  if (device) {
    let g: GpuSoup | undefined;
    try {
      g = start ? (await resumeGpuSoup(device, start)).soup : await GpuSoup.create(device, params);
      // Bounded batches, so a long segment does not queue every epoch at once.
      for (let left = task.epochs; left > 0; left -= 256) {
        g.step(Math.min(256, left));
        await device.queue.onSubmittedWorkDone();
      }
      await g.read();
      return encodeSnapshot(params, g.cpu.programs, g.cpu.epoch);
    } finally {
      g?.destroy();
    }
  }
  const soup = start ? resumeSoup(start).soup : new Soup(params);
  for (let i = 0; i < task.epochs; i++) soup.step();
  return encodeSnapshot(params, soup.programs, soup.epoch);
}

/** The island loop: next, compute, upload (runs only), complete. */
export async function runSoupIsland(opt: SoupIslandOptions): Promise<SoupIslandResult> {
  const base = opt.url.replace(/\/$/, "");
  const log = opt.log ?? ((s: string) => console.log(s));
  const { id, token } = opt.identity ?? await joinIsland(base, opt.adapter, log);
  const q = `island=${encodeURIComponent(id)}`;
  // A task's requests (`deadline`: its lease end) give the task up on a 404 (its
  // start is gone) or a rate limit that outlasts the lease.
  const call = async (path: string, init: RequestInit = {}, deadline?: number): Promise<Response> => {
    const res = await fetchRetrying(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } }, log, deadline);
    const what = `${init.method ?? "GET"} ${path.split("?")[0]}`;
    if (res.status === 404 && deadline !== undefined) throw new TaskGone(`${what}: ${await res.text()}`);
    if (!res.ok && res.status !== 409) throw new Error(`${what}: ${res.status} ${await res.text()}`);
    return res;
  };
  const result: SoupIslandResult = { id, runs: 0, verifies: 0, refused: 0 };
  const device = opt.device ?? null;

  const runTask = async (task: SoupTask): Promise<void> => {
    let start: Uint8Array | null = null;
    if (task.start) {
      start = new Uint8Array(await (await call(`${task.start}?${q}`, {}, task.expiresAt)).arrayBuffer());
      if (await sha256Hex(start) !== task.startSha) throw new Error(`${task.segment}: start snapshot does not hash to ${task.startSha}`);
    }
    const t0 = performance.now();
    let end = await computeSegment(task, start, device);
    if (task.kind === "run" && opt.tamper) end = opt.tamper(end, task);
    const sha = await sha256Hex(end);
    const lease = encodeURIComponent(task.lease);
    if (task.kind === "run") {
      const put = await call(`/api/soup/segments/${task.segment}/snapshot?${q}&lease=${lease}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: end,
      }, task.expiresAt);
      if (put.status === 409) {
        log(`${task.segment}: upload refused: ${(await put.json()).error}`);
        result.refused++;
        return;
      }
      await put.body?.cancel();
    }
    const done = await call(`/api/soup/segments/${task.segment}/complete?${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lease: task.lease, sha }),
    }, task.expiresAt);
    const body = await done.json();
    if (done.status === 409) {
      log(`${task.segment}: ${task.kind} refused: ${body.error}`);
      result.refused++;
      return;
    }
    if (task.kind === "run") result.runs++; else result.verifies++;
    log(`${id.slice(0, 8)} ${task.kind} ${task.segment} epochs ${task.startEpoch}..${task.endEpoch} ${sha.slice(0, 12)} -> ${body.status} (${((performance.now() - t0) / 1000).toFixed(2)} s)`);
  };

  while (opt.maxSegments === undefined || result.runs + result.verifies < opt.maxSegments) {
    const reply = await (await call(`/api/soup/next?${q}`, { method: "POST" })).json();
    if (reply.idle) {
      if (reply.finished || opt.once) break;
      await sleep(opt.idleMs ?? reply.retryAfterMs ?? 2000);
      continue;
    }
    const task = reply as SoupTask;
    try {
      await runTask(task);
    } catch (e) {
      if (!(e instanceof TaskGone)) throw e;
      log(`${task.segment}: ${task.kind} given up: ${e.message}`);
      result.refused++;
    }
  }
  return result;
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { boolean: ["cpu", "once"], string: ["url", "max-segments", "adapter"], default: { url: "http://localhost:4000" } });
  let device: GPUDevice | null = null;
  if (!a.cpu && typeof navigator !== "undefined" && navigator.gpu) {
    try {
      device = await soupDevice();
    } catch (e) {
      console.warn(`no WebGPU (${(e as Error).message}); running on the CPU`);
    }
  }
  const maxSegments = a["max-segments"] === undefined ? undefined : Number(a["max-segments"]);
  if (maxSegments !== undefined && !(Number.isInteger(maxSegments) && maxSegments > 0)) throw new Error("--max-segments must be a positive integer");
  console.log(`soup island on ${device ? "WebGPU" : "the CPU"}, coordinator ${a.url}`);
  const r = await runSoupIsland({ url: a.url, device, once: a.once, maxSegments, adapter: a.adapter });
  console.log(`done: ${r.runs} runs, ${r.verifies} verifies, ${r.refused} refused`);
}
