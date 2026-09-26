// Island client: joins a coordinator, pulls segment tasks, runs or replays
// them on the local GPU and reports end-state digests. Works in browsers
// (worker or page) and in Deno.
//
// Protocol: a private token (from join) authenticates every call; each task
// carries a lease that must accompany heartbeats, uploads and completion. A
// start checkpoint whose digest differs from the predecessor's report is
// rejected, which makes the coordinator recompute that predecessor.

import { decodeCheckpoint, encodeCheckpoint, stateHash, type WorldState } from "@bl/schema";
import { bytesDigest, continuationError, runExperiment, type HostInfo, type ObserverState, type RunSpec, type Sink } from "./runner.ts";

export interface Task {
  kind: "run" | "verify" | "idle";
  lease?: string;
  segment?: { id: string; run: string; index: number; startStep: number; steps: number };
  spec?: RunSpec;
  startFrom?: string | null;
  startHash?: string | null;
}

export interface IslandOptions {
  coordinator: string;
  host: HostInfo;
  log?: (msg: string) => void;
  /** Stop after this many tasks, or when idle (0 = forever). */
  maxTasks?: number;
  idleMs?: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
}

/** Collects bundle files in memory for upload after the segment finishes. */
class MemorySink implements Sink {
  readonly files = new Map<string, string>();
  readonly bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) {
    this.files.set(p, t);
  }
  async appendText(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? "") + t);
  }
  async writeBytes(p: string, b: Uint8Array) {
    this.bytes.set(p, b);
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function runIsland(device: GPUDevice, opt: IslandOptions): Promise<number> {
  const log = opt.log ?? (() => {});
  const base = opt.coordinator.replace(/\/$/, "");
  const joined = await fetch(`${base}/api/islands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter: opt.host.adapter, userAgent: opt.host.host }),
  });
  if (!joined.ok) throw new Error(`join: ${joined.status} ${await joined.text()}`);
  const { id, token } = (await joined.json()) as { id: string; token: string };
  const q = (extra = "") => `island=${encodeURIComponent(id)}${extra}`;
  const call = async <T>(path: string, init: RequestInit = {}, raw = false): Promise<T> => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
    if (!res.ok) throw new HttpError(res.status, `${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") && !raw ? res.json() : res.arrayBuffer()) as Promise<T>;
  };
  const postJson = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  log(`joined as ${id}`);
  let done = 0;
  while (!opt.signal?.aborted && (!opt.maxTasks || done < opt.maxTasks)) {
    const task = await call<Task>(`/api/next?${q()}`, { method: "POST" });
    if (task.kind === "idle" || !task.segment || !task.spec || !task.lease) {
      if (opt.maxTasks) break;
      await new Promise<void>((r) => {
        const t = setTimeout(wake, opt.idleMs ?? 10_000);
        function wake() {
          clearTimeout(t);
          opt.signal?.removeEventListener("abort", wake);
          r();
        }
        opt.signal?.addEventListener("abort", wake);
      });
      continue;
    }
    const seg = task.segment;
    const lease = task.lease;
    log(`${task.kind} ${seg.run} #${seg.index} (${seg.steps} steps from t=${seg.startStep})`);
    const beat = setInterval(() => {
      postJson(`/api/segments/${seg.id}/heartbeat?${q()}`, { lease }).catch((e) => log(`  heartbeat: ${e.message}`));
    }, opt.heartbeatMs ?? 60_000);
    try {
      let start: WorldState | undefined;
      let observer: ObserverState | undefined;
      if (task.startFrom) {
        // Every defect of the predecessor's artifacts (undecodable or invalid
        // state, wrong step or digest, missing, malformed or mismatched
        // observers) rejects the predecessor for recomputation instead of
        // failing this island; only transport errors propagate.
        const bytes = new Uint8Array(await call<ArrayBuffer>(`/api/segments/${task.startFrom}/start?${q()}`));
        let raw: ArrayBuffer | null = null;
        try {
          raw = await call<ArrayBuffer>(`/api/segments/${task.startFrom}/files/observer.json?${q()}`, {}, true);
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 404)) throw e;
        }
        let bad: string | null = null;
        try {
          start = decodeCheckpoint(bytes);
          const digest = stateHash(start);
          if (start.step !== seg.startStep || (task.startHash && digest !== task.startHash))
            bad = `start checkpoint t=${start.step} digest ${digest}, expected t=${seg.startStep} digest ${task.startHash}`;
          else if (raw === null) bad = "predecessor uploaded no observer state";
          else {
            observer = JSON.parse(new TextDecoder().decode(raw)) as ObserverState;
            bad = continuationError(task.spec, start, observer);
          }
        } catch (e) {
          bad = `invalid predecessor artifact: ${(e as Error).message}`;
        }
        if (bad) {
          log(`  rejecting: ${bad}`);
          await postJson(`/api/segments/${seg.id}/reject?${q()}`, { lease, reason: bad.slice(0, 500) });
          continue;
        }
      }
      const sink = new MemorySink();
      const out = await runExperiment(device, task.spec, sink, opt.host, (m) => log(`  ${m}`), { start, observer, keepFinal: task.kind === "run" });
      const lq = q(`&lease=${encodeURIComponent(lease)}`);
      const observerBytes = new TextEncoder().encode(JSON.stringify(out.observer));
      const observerHash = bytesDigest(observerBytes);
      if (task.kind === "run") {
        const octet = { "content-type": "application/octet-stream" };
        await call(`/api/segments/${seg.id}/checkpoint?${lq}`, { method: "PUT", headers: octet, body: encodeCheckpoint(out.final!) as BodyInit });
        await call(`/api/segments/${seg.id}/files/observer.json?${lq}`, { method: "PUT", headers: octet, body: observerBytes as BodyInit });
        for (const [name, text] of sink.files) {
          const safe = name.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase();
          await call(`/api/segments/${seg.id}/files/${safe}?${lq}`, { method: "PUT", headers: octet, body: text });
        }
      }
      const r = await postJson<{ status: string }>(`/api/segments/${seg.id}/complete?${q()}`, {
        kind: task.kind,
        lease,
        endHash: out.summary.finalHash,
        observerHash,
        summary: out.summary,
      });
      log(`  ${task.kind} complete: ${out.summary.finalHash} → ${r.status}`);
      done++;
    } catch (e) {
      // A lost lease (reassigned after a long stall, or the run was blocked) is not fatal.
      if (e instanceof HttpError && e.status === 409) log(`  task abandoned: ${e.message}`);
      else throw e;
    } finally {
      clearInterval(beat);
    }
  }
  return done;
}
