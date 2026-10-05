// Worker transport of the discovery plane (DESIGN section 6), shared by the
// command-line worker (tools/discovery-worker.ts) and the browser worker page
// (apps/lab/discovery). fetch only; the caller supplies how a case executes
// (a Deno Worker or a browser Web Worker), so the same lease, upload and
// completion logic serves both routes.
//
// Worker states: joining -> qualifying -> idle -> leased -> executing ->
// uploading -> acknowledged, with draining (pause: finish the current case,
// take no new one) and retrying (transport errors back off and retry the
// same idempotent request; a retry never changes the case or its seed).

import { RESULT_FILES, campaignCoreDigest, canonicalJSON, sha256Hex, type CampaignManifest, type CaseSpec, type ResultManifest } from "@bl/schema";
import { validateAttempt, type CaseFiles } from "./discovery.ts";

export type WorkerState = "joining" | "qualifying" | "idle" | "leased" | "executing" | "uploading" | "acknowledged" | "draining" | "retrying" | "stopped";

export interface JoinInfo {
  label: string;
  physicalHostId: string;
  backend: "cpu-ref-v1";
  sourceClosureDigest: string;
  runtime: string;
  concurrency: number;
  environment: "local" | "cloud";
}

export interface DiscoveryTask {
  leaseId: string;
  attemptId: string;
  role: "primary" | "replay" | "qualify";
  caseId: string;
  manifestDigest: string;
  manifestSha: string;
  initialSha: string;
  expiresAt: number;
  leaseMs: number;
  caseWallSeconds: number;
  /** Milliseconds left before the campaign's wall-time cap; the case is stopped then. */
  remainingMs: number;
}

export interface Idle {
  idle: true;
  reason: string;
  retryAfterMs: number;
}

export interface Verdict {
  attemptId: string;
  status: string;
  errors: string[];
  decision: string;
  qualified: boolean;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DiscoveryClient {
  private auth: string | null = null;
  workerId: string | null = null;
  leaseMs = 120_000;

  constructor(
    readonly base: string,
    private readonly joinToken: string | null = null,
  ) {}

  private async req(method: string, path: string, body?: BodyInit | null, json = true, auth = this.auth): Promise<Response> {
    const headers: Record<string, string> = {};
    if (auth) headers.authorization = `Bearer ${auth}`;
    if (body && json) headers["content-type"] = "application/json";
    if (body && !json) headers["content-type"] = "application/octet-stream";
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body ?? undefined });
    if (!res.ok) throw new HttpError(res.status, `${method} ${path}: ${res.status} ${await res.text()}`);
    return res;
  }

  /** Retries transport failures and 5xx with backoff; 4xx are answers, not failures. */
  async retrying<T>(what: () => Promise<T>, onRetry?: (e: Error, n: number) => void, tries = 8): Promise<T> {
    for (let n = 1; ; n++) {
      try {
        return await what();
      } catch (e) {
        const http = e instanceof HttpError ? e.status : 0;
        if ((http >= 400 && http < 500) || n >= tries) throw e;
        onRetry?.(e as Error, n);
        await sleep(Math.min(30_000, 500 * 2 ** (n - 1)));
      }
    }
  }

  async join(info: JoinInfo): Promise<void> {
    const r = (await (await this.req("POST", "/api/discovery/workers", JSON.stringify(info), true, this.joinToken)).json()) as { workerId: string; token: string; leaseMs: number };
    this.workerId = r.workerId;
    this.auth = `${r.workerId}:${r.token}`;
    this.leaseMs = r.leaseMs;
  }

  async next(): Promise<DiscoveryTask | Idle> {
    return (await this.req("POST", "/api/discovery/next", "{}")).json();
  }

  async heartbeat(leaseId: string): Promise<void> {
    await this.req("POST", `/api/discovery/leases/${leaseId}/heartbeat`, "{}");
  }

  async blob(sha: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(await (await this.req("GET", `/api/discovery/blobs/${sha}`)).arrayBuffer());
    if ((await sha256Hex(bytes)) !== sha) throw new Error(`blob ${sha} arrived corrupted`);
    return bytes;
  }

  async putFile(leaseId: string, name: string, bytes: Uint8Array): Promise<void> {
    await this.req("PUT", `/api/discovery/leases/${leaseId}/files/${name}`, bytes as BodyInit, false);
  }

  async complete(leaseId: string): Promise<Verdict> {
    return (await this.req("POST", `/api/discovery/leases/${leaseId}/complete`, "{}")).json();
  }
}

/** How one case executes on this worker: in a terminable Worker, under the case's wall-time limit. */
export type Executor = (spec: CaseSpec, initial: Uint8Array, opts: Record<string, unknown>, timeoutMs: number) => Promise<{ result: ResultManifest; files: CaseFiles }>;

export interface LoopOptions {
  info: JoinInfo;
  execute: Executor;
  backendBuild: string;
  /** Stop taking new cases after this time (ms since epoch). */
  until: number;
  maxCases?: number;
  log: (line: string) => void;
  onState?: (s: WorkerState) => void;
  /** Stop after this long without work (a finished campaign); absent: keep polling until `until`. */
  idleExitMs?: number;
  /** Returns true once the operator has paused: finish the current case, take no new one. */
  draining?: () => boolean;
  /** Test hook only: while true, no heartbeats are sent (a partitioned or frozen worker). */
  heartbeatsPaused?: () => boolean;
  /** Test hooks only. */
  fault?: (stage: "leased" | "files" | "completed", task: DiscoveryTask, out?: { result: ResultManifest; files: CaseFiles }) => Promise<{ result: ResultManifest; files: CaseFiles } | void>;
}

/** Explanations that mean this worker can never get work from this coordinator; the loop stops on them. */
const FATAL = [/source closure/, /needs backend/, /no qualification case/, /qualification failed/, /wall-time cap reached/, /storage cap reached/];

/** One worker slot: lease, execute, self-check, upload, complete, repeat. */
export async function workLoop(client: DiscoveryClient, o: LoopOptions): Promise<{ completed: number; verdicts: Verdict[] }> {
  const cache = new Map<string, Uint8Array>();
  const blob = async (sha: string) => {
    if (!cache.has(sha)) cache.set(sha, await client.retrying(() => client.blob(sha)));
    return cache.get(sha)!;
  };
  const verdicts: Verdict[] = [];
  let completed = 0;
  let idleSince: number | null = null;
  const dec = new TextDecoder();
  while (Date.now() < o.until && completed < (o.maxCases ?? Infinity)) {
    if (o.draining?.()) {
      o.onState?.("draining");
      break;
    }
    o.onState?.("idle");
    const t = await client.retrying(() => client.next(), (e) => (o.onState?.("retrying"), o.log(`retrying next: ${e.message}`)));
    if ("idle" in t) {
      if (FATAL.some((r) => r.test(t.reason))) {
        o.log(`cannot take work: ${t.reason}`);
        o.onState?.("stopped");
        break;
      }
      idleSince ??= Date.now();
      if (o.idleExitMs !== undefined && Date.now() - idleSince >= o.idleExitMs) {
        o.log(`idle for ${Math.round((Date.now() - idleSince) / 1000)} s (${t.reason}); stopping`);
        break;
      }
      await sleep(Math.min(t.retryAfterMs, Math.max(0, o.until - Date.now())));
      continue;
    }
    idleSince = null;
    o.onState?.(t.role === "qualify" ? "qualifying" : "leased");
    // The campaign's wall-time cap, fixed when the lease is granted: downloads and retries count against it.
    const campaignDeadline = Date.now() + t.remainingMs;
    // Keep the lease alive from acquisition through acknowledgment: downloads, execution, self-check, uploads and server validation.
    const beat = setInterval(() => {
      if (!o.heartbeatsPaused?.()) void client.heartbeat(t.leaseId).catch((e) => o.log(`heartbeat: ${(e as Error).message}`));
    }, Math.max(1000, Math.floor(t.leaseMs / 3)));
    try {
    await o.fault?.("leased", t);
    const manifestBytes = await blob(t.manifestSha);
    const manifest = JSON.parse(dec.decode(manifestBytes)) as CampaignManifest;
    const specText = dec.decode(await blob(t.caseId));
    const spec = JSON.parse(specText) as CaseSpec;
    if (canonicalJSON(spec) !== specText) throw new Error(`case ${t.caseId} is not canonical`);
    const initial = await blob(t.initialSha);
    o.onState?.("executing");
    let out: { result: ResultManifest; files: CaseFiles };
    try {
      out = await o.execute(
        spec,
        initial,
        {
          attemptId: t.attemptId,
          role: t.role === "qualify" ? "primary" : t.role,
          leaseId: t.leaseId,
          workerId: client.workerId,
          physicalHostId: o.info.physicalHostId,
          backendBuild: o.backendBuild,
          sourceClosureDigest: o.info.sourceClosureDigest,
          deadline: Math.min(Date.now() + t.caseWallSeconds * 1000, campaignDeadline),
        },
        Math.max(1, Math.min(t.caseWallSeconds * 1000 + 5000, campaignDeadline - Date.now())),
      );
    } catch (e) {
      o.log(`${t.role} ${t.caseId.slice(0, 12)} failed: ${(e as Error).message}; the lease will expire and the case is retried`);
      clearInterval(beat);
      continue;
    }
    // Self-check with the same validator the coordinator runs; upload regardless, so a bad attempt is kept and explained.
    const self = await validateAttempt({ manifest, campaignDigest: await campaignCoreDigest(manifest), caseId: t.caseId, spec }, new TextEncoder().encode(canonicalJSON(out.result)), out.files, initial);
    if (!self.valid) o.log(`self-check failed (uploading anyway): ${self.errors.join("; ")}`);
    const up = (await o.fault?.("files", t, out)) ?? out;
    o.onState?.("uploading");
    for (const name of RESULT_FILES) await client.retrying(() => client.putFile(t.leaseId, name, up.files[name]));
    const resultBytes = new TextEncoder().encode(canonicalJSON(up.result));
    await client.retrying(() => client.putFile(t.leaseId, "result.json", resultBytes));
    const v = await client.retrying(() => client.complete(t.leaseId));
    await o.fault?.("completed", t);
    o.onState?.("acknowledged");
    verdicts.push(v);
    if (t.role !== "qualify") completed++;
    o.log(`${t.role} ${t.caseId.slice(0, 12)} ${t.attemptId}: ${v.status}${v.errors.length ? ` (${v.errors.join("; ")})` : ""}; case ${v.decision}`);
    } catch (e) {
      // One bad case does not stop the worker; the lease expires and the case is retried. A refused upload that names a campaign cap does.
      const msg = e instanceof Error ? e.message : "unknown worker error";
      o.log(`${t.role} ${t.caseId.slice(0, 12)} errored: ${msg}; the lease will expire and the case is retried`);
      if (FATAL.some((r) => r.test(msg))) {
        o.onState?.("stopped");
        break;
      }
    } finally {
      clearInterval(beat);
    }
  }
  o.onState?.("stopped");
  return { completed, verdicts };
}
